use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
};

use portable_pty::{Child, PtyPair};

pub type CommandChild = Box<dyn Child + Send + Sync>;
pub type SharedChild = Arc<Mutex<CommandChild>>;
type TerminalWriter = Box<dyn Write + Send>;

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
}

#[derive(Default, Clone)]
pub struct TerminalState {
    pub terminals: Arc<Mutex<HashMap<String, TerminalEntry>>>,
}
