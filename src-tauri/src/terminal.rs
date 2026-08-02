use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, PtySize};
use tauri::{ipc::Channel, AppHandle, Emitter, State};

use crate::command_tracker::{foreground_command, CommandInfo};
use crate::ssh::SshConfig;
use crate::state::{CommandChild, OutputChannel, SharedChild, TerminalEntry, TerminalState};

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
    startup_command: Option<String>,
) {
    {
        let terminals = state.terminals.try_lock().unwrap_or_else(|e| {
            log::error!("Failed to lock terminals for start {}: {}", id, e);
            panic!("Failed to lock terminals: {}", e);
        });
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
    let pty_pair = pty_system.openpty(size).unwrap_or_else(|e| {
        log::error!("Failed to open pty for terminal {}: {}", id, e);
        panic!("Failed to open pty: {}", e);
    });

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
        // Run a command on the remote host instead of an interactive session.
        // `ssh user@host <cmd>` runs the command then disconnects on exit, so
        // the tab closes (matching local startup_command behavior).
        if let Some(ref cmd) = startup_command {
            c.arg(cmd);
        }
        log::debug!("Creating terminal with ssh");
        c
    } else {
        let mut c = CommandBuilder::new(&exe_path);
        if let Some(ref cmd) = startup_command {
            // Run a single command then exit: the shell exits when the command
            // does, so the watcher emits `term-exit-<id>` and the tab closes —
            // the desired behavior for a "launch opencode/vim" profile.
            c.args(&["--login", "-i", "-c", cmd]);
        } else {
            c.args(&["--login", "-i"]);
        }
        c.env("TERM", "xterm-256color");
        if let Some(ref dir) = cwd {
            c.cwd(dir);
        }
        log::debug!("Creating terminal {:?} with cwd {:?}", exe_path, c.get_cwd());
        c
    };
    let child: CommandChild = pty_pair.slave.spawn_command(cmd).unwrap_or_else(|e| {
        log::error!("Failed to spawn terminal {}: {}", id, e);
        panic!("Failed to spawn terminal: {}", e);
    });

    pty_pair.master.resize(size).unwrap_or_else(|e| {
        log::error!("Failed to resize pty for terminal {}: {}", id, e);
        panic!("Failed to resize pty: {}", e);
    });

    let mut reader = pty_pair.master.try_clone_reader().unwrap_or_else(|e| {
        log::error!("Failed to clone reader for terminal {}: {}", id, e);
        panic!("Failed to clone reader: {}", e);
    });
    let writer = pty_pair.master.take_writer().unwrap_or_else(|e| {
        log::error!("Failed to clone writer for terminal {}: {}", id, e);
        panic!("Failed to clone writer: {}", e);
    });

    let shared_child: SharedChild = Arc::new(std::sync::Mutex::new(child));
    let shell_pid = {
        let guard = shared_child.try_lock().unwrap_or_else(|e| {
            log::error!("Failed to lock child for terminal {}: {}", id, e);
            panic!("Failed to lock child: {}", e);
        });
        guard.process_id()
    };
    let force_low_latency = Arc::new(AtomicBool::new(false));
    // Output channel shared with the reader thread. Stored as a swappable
    // Option so `reattach_terminal` (tab tear-off) can redirect the live PTY
    // stream to a different window without respawning the process.
    let output_channel: OutputChannel = Arc::new(std::sync::Mutex::new(Some(on_output)));

    // Store in state
    {
        let mut terminals = state.terminals.try_lock().unwrap_or_else(|e| {
            log::error!("Failed to lock terminals for state insert {}: {}", id, e);
            panic!("Failed to lock terminals: {}", e);
        });
        terminals.insert(
            id.clone(),
            TerminalEntry {
                pty_pair,
                child: shared_child.clone(),
                writer,
                shell_pid,
                force_low_latency: force_low_latency.clone(),
                output_channel: output_channel.clone(),
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
        //
        // The channel is read from the shared `output_channel` field on every
        // flush rather than captured by value, so `reattach_terminal` (tab
        // tear-off) can swap it atomically: the reader picks up the new
        // channel on the next flush and the old window stops receiving.
        let output_channel_reader = output_channel.clone();
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
                // Hold the channel lock only long enough to send. If no window
                // is attached (`None`, e.g. mid-tear-off), drop the bytes but
                // keep draining the PTY so the child never blocks on a full
                // pipe.
                let channel_guard = output_channel_reader.lock().unwrap_or_else(|e| {
                    log::error!("Failed to lock output channel for terminal {}: {}", id_reader, e);
                    panic!("Failed to lock output channel: {}", e);
                });
                if let Some(ch) = channel_guard.as_ref() {
                    if let Err(e) = ch.send(s) {
                        log::warn!("Terminal {} output channel send failed: {}", id_reader, e);
                    }
                }
                drop(channel_guard);
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
                let mut child_guard = shared_child.try_lock().unwrap_or_else(|e| {
                    log::error!("Failed to lock child in watcher {}: {}", id_watcher, e);
                    panic!("Failed to lock child in watcher: {}", e);
                });
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
                        if let Err(e) = app_watcher.emit(&term_command_event_name, next) {
                            log::warn!("Failed to emit term-command for {}: {}", id_watcher, e);
                        }
                    }
                }
            }

            thread::sleep(Duration::from_millis(200));
        }

        // Clean up terminal state
        log::debug!("Cleaning up state for terminal {}", id_watcher);
        {
            let mut terminals = state_watcher.terminals.try_lock().unwrap_or_else(|e| {
                log::error!("Failed to lock terminals in watcher {}: {}", id_watcher, e);
                panic!("Failed to lock terminals in watcher: {}", e);
            });
            let removed = terminals.remove(&id_watcher);
            log::debug!(
                "Terminal {} removed from state: {:?}",
                id_watcher,
                removed.is_some()
            );
        }

        // Notify frontend
        log::debug!("Emitting term-exit event for {}", id_watcher);
        app_watcher.emit(&term_exit_event_name, ()).unwrap_or_else(|e| {
            log::error!("Failed to emit term-exit event for {}: {}", id_watcher, e);
        });
        log::debug!("term-exit event emitted for {}", id_watcher);
    });
}

/// Atomically redirect a terminal's PTY output stream to a new channel.
///
/// This is the backend half of "tear off tab into a new window": the original
/// window keeps the PTY process alive (it does NOT call `kill_terminal`), and
/// the new window — after replaying the serialized scrollback into its own
/// xterm — calls this with a fresh `Channel` owned by its webview. The reader
/// thread reads the channel from the shared `output_channel` field on every
/// flush, so this in-place swap takes effect on the very next flush: the old
/// window stops receiving immediately and the new window picks up the live
/// stream. There is no separate "detach" call — replacing the channel IS the
/// detach for the previous holder.
#[tauri::command]
pub fn reattach_terminal(id: String, on_output: Channel<String>, state: State<TerminalState>) {
    let terminals = state.terminals.try_lock().unwrap_or_else(|e| {
        log::error!("Failed to lock terminals for reattach {}: {}", id, e);
        panic!("Failed to lock terminals: {}", e);
    });
    if let Some(entry) = terminals.get(&id) {
        let mut guard = entry.output_channel.lock().unwrap_or_else(|e| {
            log::error!("Failed to lock output channel for reattach {}: {}", id, e);
            panic!("Failed to lock output channel: {}", e);
        });
        *guard = Some(on_output);
        log::info!("Reattached terminal {} to a new window", id);
    } else {
        log::warn!("reattach_terminal: terminal {} not found", id);
    }
}

#[tauri::command]
pub fn kill_terminal(id: String, state: State<TerminalState>) {
    let mut terminals = state.terminals.try_lock().unwrap_or_else(|e| {
        log::error!("Failed to lock terminals for kill {}: {}", id, e);
        panic!("Failed to lock terminals: {}", e);
    });
    if let Some(entry) = terminals.remove(&id) {
        log::info!("Killing terminal {}", id);
        let mut child = entry.child.try_lock().unwrap_or_else(|e| {
            log::error!("Failed to lock child for kill {}: {}", id, e);
            panic!("Failed to lock child: {}", e);
        });
        if let Err(e) = child.kill() {
            log::error!("Failed to kill child process {}: {}", id, e);
        }
    } else {
        log::warn!("Terminal with id {} not found", id);
    }
}

#[tauri::command]
pub fn write_to_terminal(id: String, content: &[u8], state: State<TerminalState>) {
    let mut terminals = state.terminals.try_lock().unwrap_or_else(|e| {
        log::error!("Failed to lock terminals for write {}: {}", id, e);
        panic!("Failed to lock terminals: {}", e);
    });
    if let Some(entry) = terminals.get_mut(&id) {
        entry.writer.write_all(content).unwrap_or_else(|e| {
            log::error!("Failed to write to terminal {}: {}", id, e);
            panic!("Failed to write to terminal: {}", e);
        });
        entry.writer.flush().unwrap_or_else(|e| {
            log::error!("Failed to flush writer for terminal {}: {}", id, e);
            panic!("Failed to flush writer: {}", e);
        });
    } else {
        log::warn!("write_to_terminal: terminal {} not found", id);
    }
}

#[tauri::command]
pub fn resize_terminal(id: String, cols: u16, rows: u16, state: State<TerminalState>) {
    let mut terminals = state.terminals.try_lock().unwrap_or_else(|e| {
        log::error!("Failed to lock terminals for resize {}: {}", id, e);
        panic!("Failed to lock terminals: {}", e);
    });
    if let Some(entry) = terminals.get_mut(&id) {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        entry.pty_pair.master.resize(size).unwrap_or_else(|e| {
            log::error!("Failed to resize terminal {}: {}", id, e);
            panic!("Failed to resize terminal: {}", e);
        });
    } else {
        log::warn!("resize_terminal: terminal {} not found", id);
    }
}

/// Toggle the per-terminal LowLatency override. While `low_latency` is true the
/// reader thread flushes every read immediately instead of coalescing, so user
/// interaction (typing / mouse / resize) sees the lowest possible output delay.
/// Called by the frontend's `useOutputMode` hook, debounced so it only fires on
/// boolean transitions — never per input event.
#[tauri::command]
pub fn set_output_mode(id: String, low_latency: bool, state: State<TerminalState>) {
    let terminals = state.terminals.try_lock().unwrap_or_else(|e| {
        log::error!("Failed to lock terminals for set_output_mode {}: {}", id, e);
        panic!("Failed to lock terminals: {}", e);
    });
    if let Some(entry) = terminals.get(&id) {
        entry.force_low_latency.store(low_latency, Ordering::Relaxed);
    } else {
        log::warn!("set_output_mode: terminal {} not found", id);
    }
}
