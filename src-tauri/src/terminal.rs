use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Emitter, State};

use crate::state::{CommandChild, SharedChild, TerminalEntry, TerminalState};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

/// Payload for the `term-command-<id>` event: the currently-running command
/// and whether it looks like a privileged/elevated operation (sudo, su, doas,
/// pkexec, or a process running as root). The frontend shows a red dot before
/// the command name when `privileged` is true.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    /// argv[0] basename (e.g. "npm", "sudo"). Empty string = idle at prompt.
    pub command: String,
    pub privileged: bool,
}

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    id: String,
    exe_path: String,
    on_output: Channel<String>,
    state: State<TerminalState>,
    cols: Option<u16>,
    rows: Option<u16>,
    profile_type: Option<String>,
    ssh_config: Option<SshConfig>,
    cwd: Option<String>,
) {
    {
        let terminals = state
            .terminals
            .try_lock()
            .expect("Failed to lock terminals");
        if terminals.contains_key(&id) {
            log::warn!("Terminal with id {} already exists", id);
            return;
        }
    }

    let pty_system = portable_pty::native_pty_system();
    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pty_pair = pty_system.openpty(size).unwrap();

    let cmd = if profile_type.as_deref() == Some("remote") {
        let ssh = ssh_config.as_ref().expect("SSH config required for remote profile");
        let ssh_exe = if exe_path.is_empty() { "ssh".to_string() } else { exe_path };
        let mut c = CommandBuilder::new(ssh_exe);
        let user_host = if let Some(ref user) = ssh.user {
            format!("{}@{}", user, ssh.host)
        } else {
            ssh.host.clone()
        };
        c.arg(&user_host);
        if let Some(port) = ssh.port {
            c.args(&["-p", &port.to_string()]);
        }
        if let Some(ref identity_file) = ssh.identity_file {
            c.args(&["-i", identity_file]);
        } else {
            c.args(&["-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password"]);
        }
        c.env("TERM", "xterm-256color");
        if let Some(ref dir) = cwd {
            c.cwd(dir);
        }
        log::debug!("Creating terminal with ssh");
        c
    } else {
        let mut c = CommandBuilder::new(&exe_path);
        c.args(&["--login", "-i"]);
        c.env("TERM", "xterm-256color");
        if let Some(ref dir) = cwd {
            c.cwd(dir);
        }
        log::debug!("Creating terminal {:?} with cwd {:?}", exe_path, c.get_cwd());
        c
    };
    let child: CommandChild = pty_pair
        .slave
        .spawn_command(cmd)
        .expect("Failed to spawn terminal");

    pty_pair.master.resize(size).expect("Failed to resize pty");

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .expect("Failed to clone reader");
    let writer = pty_pair
        .master
        .take_writer()
        .expect("Failed to clone writer");

    let shared_child: SharedChild = Arc::new(std::sync::Mutex::new(child));
    let shell_pid = {
        let guard = shared_child
            .try_lock()
            .expect("Failed to lock child to read pid");
        guard.process_id()
    };
    let force_low_latency = Arc::new(AtomicBool::new(false));

    // Store in state
    {
        let mut terminals = state
            .terminals
            .try_lock()
            .expect("Failed to lock terminals");
        terminals.insert(
            id.clone(),
            TerminalEntry {
                pty_pair,
                child: shared_child.clone(),
                writer,
                shell_pid,
                force_low_latency: force_low_latency.clone(),
            },
        );
    }

    // Reader thread: forwards terminal output to the frontend over a Channel,
    // coalescing bursts into large chunks during high-throughput output (e.g.
    // `cat bigfile`) and flushing immediately when output is sparse or the user
    // is interacting. Output is also decoded streaming-UTF-8 safe: a multi-byte
    // character split across two reads is never dropped (the previous code did
    // `if let Ok(str::from_utf8(..))` which silently discarded the whole chunk
    // on an unlucky split — invisible for ASCII/base64 but dropped CJK/emoji).
    let id_reader = id.clone();
    thread::spawn(move || {
        log::debug!("Reader thread started for {}", id_reader);
        // 64KB read buffer (was 8KB): fewer, larger reads for bursty output.
        const READ_BUF_SIZE: usize = 1024 * 64;
        // Enter HighThroughput (coalesce) after this many consecutive full reads.
        const BURST_FULL_READS: u32 = 2;
        // In HighThroughput, flush once pending reaches this size.
        const HIGH_FLUSH_CAP: usize = 1024 * 64;
        // Drop back to LowLatency when the gap between reads exceeds this.
        const LOW_SPARSE_GAP: Duration = Duration::from_millis(100);

        let mut buffer = vec![0u8; READ_BUF_SIZE];
        // Accumulator holding decoded-pending bytes (also carries an unfinished
        // UTF-8 character across a read boundary).
        let mut pending: Vec<u8> = Vec::with_capacity(READ_BUF_SIZE * 2);
        let mut full_read_streak: u32 = 0;
        let mut last_read = Instant::now();

        // Flush the longest valid UTF-8 prefix of `pending` over the channel.
        // Any trailing incomplete multi-byte sequence is retained for the next
        // read; nothing is ever dropped.
        let flush = |pending: &mut Vec<u8>| {
            if pending.is_empty() {
                return;
            }
            let valid_len = match std::str::from_utf8(pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            if valid_len > 0 {
                let s = std::str::from_utf8(&pending[..valid_len])
                    .expect("valid UTF-8 prefix verified above")
                    .to_string();
                let _ = on_output.send(s);
                pending.drain(..valid_len);
            }
        };

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    log::debug!("Terminal {} reader got EOF", id_reader);
                    break;
                }
                Ok(n) => {
                    pending.extend_from_slice(&buffer[..n]);

                    let now = Instant::now();
                    let gap = now - last_read;
                    last_read = now;

                    // Data-driven mode detection. `full_read_streak` counts
                    // consecutive reads that returned a full buffer (the pipe
                    // clearly has more waiting). A partial read usually means
                    // the pipe drained, so we reset and treat it as sparse.
                    if n == READ_BUF_SIZE {
                        full_read_streak = full_read_streak.saturating_add(1);
                    } else {
                        full_read_streak = 0;
                    }
                    let data_driven_high =
                        full_read_streak >= BURST_FULL_READS && gap < LOW_SPARSE_GAP;
                    let force_low = force_low_latency.load(Ordering::Relaxed);
                    let high_throughput = data_driven_high && !force_low;

                    if high_throughput {
                        // Coalesce: flush only once we've accumulated enough, or
                        // when this read was partial (pipe likely drained →
                        // finish the burst so the tail isn't delayed until the
                        // next read, which may never come for an idle shell).
                        if pending.len() >= HIGH_FLUSH_CAP || n < READ_BUF_SIZE {
                            flush(&mut pending);
                        }
                    } else {
                        // LowLatency (default / sparse / user interacting): flush
                        // immediately for the lowest possible output delay.
                        flush(&mut pending);
                    }
                }
                Err(e) => {
                    log::error!("Terminal {} reader error: {}", id_reader, e);
                    break;
                }
            }
        }
        // Flush any tail (including a stranded incomplete UTF-8 prefix, though
        // in practice EOF means the stream ended cleanly).
        flush(&mut pending);
        log::debug!("Reader thread ended for {}", id_reader);
    });

    // Watcher thread: polls child process exit, then cleans up. Also tracks
    // the foreground process group of the pty (the fallback path for the
    // "current command" feature) and emits `term-command-<id>` when it changes.
    let term_exit_event_name = format!("term-exit-{}", id);
    let term_command_event_name = format!("term-command-{}", id);
    let app_watcher = app.clone();
    let state_watcher = state.inner().clone();
    let id_watcher = id.clone();
    thread::spawn(move || {
        log::debug!("Watcher thread started for {}", id_watcher);
        // The last foreground command reported to the frontend. `None` means
        // nothing reported yet; `Some(CommandInfo { command: "", .. })` means
        // idle at the shell prompt.
        let mut last_command: Option<CommandInfo> = None;
        let mut tick: u32 = 0;
        loop {
            let exited = {
                let mut child_guard = shared_child
                    .try_lock()
                    .expect("Failed to lock child in watcher");
                match child_guard.try_wait() {
                    Ok(Some(status)) => {
                        log::info!(
                            "Child process {} exited with {:?}",
                            id_watcher, status
                        );
                        true
                    }
                    Ok(None) => false,
                    Err(e) => {
                        log::error!("Child process {} wait error: {}", id_watcher, e);
                        true
                    }
                }
            };
            if exited {
                break;
            }

            // Foreground-command tracking runs on Unix only (the master pty
            // exposes the foreground process group there). Throttled to once
            // per second (every 5 ticks of the 200ms exit-poll).
            #[cfg(unix)]
            {
                tick = tick.wrapping_add(1);
                if tick % 5 == 0 {
                    let next = match foreground_command(&state_watcher, &id_watcher) {
                        Some(info) => info,
                        None => CommandInfo {
                            command: String::new(), // idle at the shell prompt
                            privileged: false,
                        },
                    };
                    if Some(&next) != last_command.as_ref() {
                        last_command = Some(next.clone());
                        let _ = app_watcher.emit(&term_command_event_name, next);
                    }
                }
            }

            thread::sleep(Duration::from_millis(200));
        }

        // Clean up terminal state
        log::debug!("Cleaning up state for terminal {}", id_watcher);
        {
            let mut terminals = state_watcher
                .terminals
                .try_lock()
                .expect("Failed to lock terminals in watcher");
            let removed = terminals.remove(&id_watcher);
            log::debug!(
                "Terminal {} removed from state: {:?}",
                id_watcher,
                removed.is_some()
            );
        }

        // Notify frontend
        log::debug!("Emitting term-exit event for {}", id_watcher);
        app_watcher
            .emit(&term_exit_event_name, ())
            .expect("Failed to emit exit event");
        log::debug!("term-exit event emitted for {}", id_watcher);
    });
}

/// Resolve the command name of the terminal's foreground process group, for
/// the "current command" fallback path. Returns `None` when the foreground
/// process group is the shell itself (i.e. idle at the prompt), and `Some`
/// when a child command is running. Unix-only; reads `/proc/<pgid>/cmdline`
/// on Linux and shells out to `ps` on macOS/other Unix. The returned
/// `CommandInfo.privileged` flag is true for elevated commands (sudo/su/doas/
/// pkexec, or a process whose effective uid is 0).
#[cfg(unix)]
fn foreground_command(state: &TerminalState, id: &str) -> Option<CommandInfo> {
    let (shell_pid, fg_pgid) = {
        let terminals = state.terminals.try_lock().ok()?;
        let entry = terminals.get(id)?;
        // process_group_leader() returns libc::pid_t (i32); process_id() is u32.
        // Normalize to u32 — a real pid/gid is always non-negative.
        let fg = entry.pty_pair.master.process_group_leader()?.max(0) as u32;
        (entry.shell_pid, fg)
    };

    // The shell is the foreground process group -> idle at the prompt.
    if shell_pid == Some(fg_pgid) {
        return None;
    }

    proc_command_info(fg_pgid)
}

/// Names of argv[0] basenames that indicate elevation/privilege escalation.
const PRIVILEGED_COMMANDS: &[&str] = &["sudo", "su", "doas", "pkexec", "gsudo", "runuser"];

/// True if the command basename is a known privilege-escalation wrapper.
#[cfg(unix)]
fn is_privileged_name(basename: &str) -> bool {
    PRIVILEGED_COMMANDS.iter().any(|&p| p == basename)
}

#[cfg(unix)]
fn proc_command_info(pid: u32) -> Option<CommandInfo> {
    #[cfg(target_os = "linux")]
    {
        // `/proc/<pid>/cmdline` is NUL-separated argv. We join argv[0..] into a
        // single space-separated command line (argv[0] reduced to its basename,
        // the rest verbatim), so e.g. "sudo sleep 10" shows in full. The
        // frontend truncates the overflow.
        let path = format!("/proc/{}/cmdline", pid);
        let raw = std::fs::read(&path).ok()?;
        let argv: Vec<String> = raw
            .split(|&b| b == 0)
            .filter(|p| !p.is_empty())
            .map(|p| String::from_utf8_lossy(p).into_owned())
            .collect();
        let argv0 = argv.first()?;
        let base0 = basename(argv0);
        if base0.is_empty() {
            return None;
        }
        let mut line = String::from(base0);
        for arg in argv.iter().skip(1) {
            line.push(' ');
            line.push_str(arg);
        }
        let privileged = is_privileged_name(base0) || proc_euid_is_root(pid);
        Some(CommandInfo {
            command: line,
            privileged,
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        // macOS and other Unix without /proc: ask `ps` for the full command
        // line (`args=`), which is already space-joined with argv[0].
        let out = std::process::Command::new("ps")
            .args(["-o", "args=", "-p"])
            .arg(pid.to_string())
            .output()
            .ok()?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if line.is_empty() {
            return None;
        }
        // argv[0] basename is the first whitespace-delimited token's basename;
        // re-normalize argv[0] to its basename to match the Linux path.
        let base0 = line.split_whitespace().next().unwrap_or("");
        let base0 = basename(base0);
        let privileged = is_privileged_name(base0);
        Some(CommandInfo {
            command: line,
            privileged,
        })
    }
}

/// Return the final path component of `s` (e.g. "/usr/bin/npm" -> "npm").
#[cfg(unix)]
fn basename(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}

/// On Linux, read `/proc/<pid>/status` and return true if the effective uid is
/// 0 (root). This catches binaries with the setuid bit, `sudoedit`, or any
/// process that ended up privileged without argv[0] naming a wrapper.
#[cfg(target_os = "linux")]
fn proc_euid_is_root(pid: u32) -> bool {
    let path = format!("/proc/{}/status", pid);
    let status = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("Uid:") {
            // Fields are: real, effective, saved set, fs uid.
            let mut fields = rest.split_whitespace();
            fields.next(); // real uid
            if let Some(euid) = fields.next() {
                if euid == "0" {
                    return true;
                }
            }
            return false;
        }
    }
    false
}

#[tauri::command]
pub fn kill_terminal(id: String, state: State<TerminalState>) {
    let mut terminals = state
        .terminals
        .try_lock()
        .expect("Failed to lock terminals");
    if let Some(entry) = terminals.remove(&id) {
        log::info!("Killing terminal {}", id);
        let mut child = entry
            .child
            .try_lock()
            .expect("Failed to lock child in kill_terminal");
        let _ = child.kill();
    } else {
        log::warn!("Terminal with id {} not found", id);
    }
}

#[tauri::command]
pub fn write_to_terminal(id: String, content: &[u8], state: State<TerminalState>) {
    let mut terminals = state
        .terminals
        .try_lock()
        .expect("Failed to lock terminals");
    if let Some(entry) = terminals.get_mut(&id) {
        entry
            .writer
            .write_all(content)
            .expect("Failed to write to terminal");
        entry.writer.flush().expect("Failed to flush writer");
    }
}

#[tauri::command]
pub fn resize_terminal(id: String, cols: u16, rows: u16, state: State<TerminalState>) {
    let mut terminals = state
        .terminals
        .try_lock()
        .expect("Failed to lock terminals");
    if let Some(entry) = terminals.get_mut(&id) {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        entry
            .pty_pair
            .master
            .resize(size)
            .expect("Failed to resize terminal");
    }
}

/// Toggle the per-terminal LowLatency override. While `low_latency` is true the
/// reader thread flushes every read immediately instead of coalescing, so user
/// interaction (typing / mouse / resize) sees the lowest possible output delay.
/// Called by the frontend's `useOutputMode` hook, debounced so it only fires on
/// boolean transitions — never per input event.
#[tauri::command]
pub fn set_output_mode(id: String, low_latency: bool, state: State<TerminalState>) {
    let terminals = state
        .terminals
        .try_lock()
        .expect("Failed to lock terminals");
    if let Some(entry) = terminals.get(&id) {
        entry.force_low_latency.store(low_latency, Ordering::Relaxed);
    } else {
        log::warn!("set_output_mode: terminal {} not found", id);
    }
}
