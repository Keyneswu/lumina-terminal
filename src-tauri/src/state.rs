use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex, atomic::AtomicBool},
};

use portable_pty::{Child, PtyPair};
use tauri::ipc::Channel;

pub type CommandChild = Box<dyn Child + Send + Sync>;
pub type SharedChild = Arc<Mutex<CommandChild>>;
type TerminalWriter = Box<dyn Write + Send>;

/// The output sink the reader thread forwards decoded PTY bytes to. Stored as
/// a swappable `Option` so the PTY can be reattached to a different window
/// (tab tear-off): the new window's `reattach_terminal` call replaces this in
/// place, and the reader thread picks up the new channel on its next flush —
/// the old window stops receiving immediately. `None` means no window is
/// currently attached (the reader keeps draining the PTY and discards output
/// until a window reattaches, so the child process never blocks on a full
/// pipe).
pub type OutputChannel = Arc<Mutex<Option<Channel<String>>>>;

/// Soft cap on retained recent output, per terminal, for the read-only MCP
/// server's `get_recent_output` tool. 64 KiB captures the last few screenfuls
/// of a build log / error trace without growing unbounded.
const MAX_RECENT_OUTPUT_BYTES: usize = 64 * 1024;

/// A bounded tail buffer of a terminal's decoded output, kept on the backend
/// so the read-only MCP server can expose "recent output" without round-
/// tripping to the frontend's xterm scrollback. The reader thread appends
/// every flushed chunk here in addition to forwarding it over the IPC channel.
/// Only output produced after the terminal was created is captured. Trims from
/// the front on overflow, snapping to a UTF-8 char boundary so a multi-byte
/// sequence is never split.
#[derive(Default)]
pub struct RecentOutput {
    buf: String,
}

impl RecentOutput {
    /// Append a decoded chunk, trimming the front on overflow.
    pub fn push_str(&mut self, s: &str) {
        self.buf.push_str(s);
        if self.buf.len() > MAX_RECENT_OUTPUT_BYTES {
            let cut = self.buf.len() - MAX_RECENT_OUTPUT_BYTES;
            // Advance to the next UTF-8 char boundary so we never slice a
            // multi-byte sequence in half (which would invalidate the buffer).
            let mut at = cut;
            while at < self.buf.len() && !self.buf.is_char_boundary(at) {
                at += 1;
            }
            self.buf.drain(..at);
        }
    }

    /// Return the full retained tail, or only its last `lines` lines.
    pub fn snapshot(&self, lines: Option<usize>) -> String {
        match lines {
            None => self.buf.clone(),
            Some(n) => {
                let tail: Vec<&str> = self.buf.lines().rev().take(n).collect();
                tail.into_iter().rev().collect::<Vec<_>>().join("\n")
            }
        }
    }
}

/// Everything the backend tracks per terminal. Fields are read/written from
/// the terminal commands and the watcher thread.
pub struct TerminalEntry {
    pub pty_pair: PtyPair,
    pub child: SharedChild,
    pub writer: TerminalWriter,
    /// PID of the spawned shell, captured right after spawn via
    /// `Child::process_id()`. Used to distinguish "shell is the foreground
    /// process group" (= idle at prompt) from "a child command is running".
    pub shell_pid: Option<u32>,
    /// Frontend-driven flag: when true, the reader thread flushes every read
    /// immediately (LowLatency) instead of coalescing into large bursts. Set
    /// by the `set_output_mode` command while the user is interacting
    /// (typing / mouse / resize). Default `false`.
    pub force_low_latency: Arc<AtomicBool>,
    /// Frontend-driven flag: when true, the reader thread pauses reading
    /// (backpressure). Set by the `set_throttle` command when the frontend's
    /// write backlog exceeds a high watermark, and cleared once it drains back
    /// below a low watermark — so the reader can never outrun xterm and pile
    /// up unbounded data in the IPC bridge / JS heap (which triggers GC
    /// stalls and freezes on workloads like vtebench unicode / vim sessions).
    /// The PTY's own pipe buffer backpressures the child process while we
    /// stop reading, so no data is lost. Default `false`.
    pub throttled: Arc<AtomicBool>,
    /// Swappable output channel shared with the reader thread. Replaced in
    /// place by `reattach_terminal` when a tab is torn off into a new window,
    /// so the live PTY process can keep streaming to whichever window now
    /// owns it.
    pub output_channel: OutputChannel,
    /// Bounded tail of this terminal's decoded output (see `RecentOutput`),
    /// fed by the reader thread on every flush. Kept on the backend so the
    /// read-only MCP server's `get_recent_output` tool can expose "recent
    /// output" without round-tripping to the frontend xterm scrollback. Only
    /// output produced after the terminal was created is captured.
    pub recent_output: Arc<Mutex<RecentOutput>>,
    /// Executable path of the shell/program this tab runs (the local shell
    /// path, or the `ssh` binary for remote profiles). Surfaced to the
    /// read-only MCP server so an AI client can tell what each tab is.
    pub exe_path: String,
    /// `"local"` or `"remote"` (SSH). Surfaced to the MCP server.
    pub profile_type: Option<String>,
    /// For SSH profiles, the resolved `Host`; `None` for local tabs.
    pub ssh_host: Option<String>,
}

#[derive(Default, Clone)]
pub struct TerminalState {
    pub terminals: Arc<Mutex<HashMap<String, TerminalEntry>>>,
    /// The terminal id currently focused in the UI, mirrored from the
    /// frontend via the `set_active_tab` command so the read-only MCP server
    /// can answer `get_active_tab`. The frontend remains the single source of
    /// truth; this is only a cached mirror for the backend's MCP surface.
    pub active_id: Arc<Mutex<Option<String>>>,
}
