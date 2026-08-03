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
}

#[derive(Default, Clone)]
pub struct TerminalState {
    pub terminals: Arc<Mutex<HashMap<String, TerminalEntry>>>,
}
