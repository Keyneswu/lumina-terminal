//! Read-only MCP (Model Context Protocol) server.
//!
//! Exposes what the user is doing in their terminals to local AI clients over
//! a loopback Streamable HTTP endpoint, so an assistant can see open tabs, the
//! running command, the live cwd, and recent output — and give context-aware
//! help. Read-only by design: there is deliberately NO tool to write to the
//! PTY. Letting an AI type into a terminal can execute arbitrary commands
//! (sudo, rm, git push --force …) and is irreversible, so it must be a
//! separate, explicitly-enabled decision — not part of this surface.
//!
//! The server runs inside the GUI process and shares `TerminalState` directly
//! (same process, no IPC), so it always reflects the live tabs the user sees.
//! It is bound to 127.0.0.1 only, and rmcp's default `allowed_hosts`
//! (localhost/127.0.0.1/::1) guards against DNS rebinding. A per-launch random
//! token in the URL path is a second layer against other local processes
//! guessing the endpoint.
//!
//! Lifecycle is config-driven from the frontend: `start_mcp_server` /
//! `stop_mcp_server` are invoked when the user toggles the setting, keeping
//! the "config.json is frontend-owned" invariant intact.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rmcp::{
    handler::server::wrapper::{Json, Parameters},
    schemars, ServerHandler, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::command_tracker::CommandInfo;
use crate::state::TerminalState;

// ---- tool parameter / output shapes ----

/// Input identifying a single terminal by id.
#[derive(Deserialize, schemars::JsonSchema)]
struct IdParams {
    /// The terminal id (from `list_tabs`).
    id: String,
}

/// Input for `get_recent_output`.
#[derive(Deserialize, schemars::JsonSchema)]
struct RecentOutputParams {
    /// The terminal id (from `list_tabs`).
    id: String,
    /// If set, return only the last N lines. If omitted, the whole retained
    /// tail (up to ~64 KiB) is returned.
    #[serde(default)]
    lines: Option<usize>,
}

/// Lightweight per-tab info returned by `list_tabs`. Heavier per-call data
/// (cwd, running command) is intentionally omitted here to keep `list_tabs`
/// cheap; ask for it explicitly with `get_tab` / `get_terminal_cwd` /
/// `get_foreground_command`.
#[derive(Serialize, schemars::JsonSchema)]
struct TabBrief {
    id: String,
    /// Shell or program executable path this tab runs.
    shell: String,
    /// True for SSH (remote) profiles.
    is_ssh: bool,
}

/// Detailed per-tab info returned by `get_tab` / `get_active_tab`.
#[derive(Serialize, schemars::JsonSchema)]
struct TabDetail {
    id: String,
    shell: String,
    is_ssh: bool,
    /// Resolved SSH host for remote profiles; null for local tabs.
    ssh_host: Option<String>,
    /// Current working directory of the tab's shell (best effort; null on
    /// platforms without a cwd lookup, e.g. Windows, or for SSH tabs).
    cwd: Option<String>,
    /// The command currently running in the tab's foreground, or null when
    /// the shell is idle at the prompt / on non-Unix / SSH tabs (where the
    /// foreground process group can't be inspected locally).
    foreground_command: Option<CommandInfo>,
}

// ---- helpers (reuse existing backend logic — no duplication) ----

/// Foreground command of a tab. Unix-only; `None` elsewhere (non-Unix or idle
/// at the prompt). Wraps the cfg-gated `command_tracker::foreground_command`.
fn foreground(state: &TerminalState, id: &str) -> Option<CommandInfo> {
    #[cfg(unix)]
    {
        crate::command_tracker::foreground_command(state, id)
    }
    #[cfg(not(unix))]
    {
        let _ = (state, id);
        None
    }
}

/// Live cwd of a tab's shell process (best effort; null on Windows / SSH).
fn live_cwd(state: &TerminalState, id: &str) -> Option<String> {
    let shell_pid = {
        let terminals = state.terminals.try_lock().ok()?;
        terminals.get(id)?.shell_pid
    };
    shell_pid.and_then(crate::terminal::process_cwd)
}

/// Build a `TabDetail` for a tab id, reusing `foreground` / `live_cwd`.
fn tab_detail(state: &TerminalState, id: &str) -> Option<TabDetail> {
    let (shell, is_ssh, ssh_host) = {
        let terminals = state.terminals.try_lock().ok()?;
        let entry = terminals.get(id)?;
        (
            entry.exe_path.clone(),
            entry.profile_type.as_deref() == Some("remote"),
            entry.ssh_host.clone(),
        )
    };
    Some(TabDetail {
        id: id.to_string(),
        shell,
        is_ssh,
        ssh_host,
        cwd: live_cwd(state, id),
        foreground_command: foreground(state, id),
    })
}

/// Strip ANSI escape sequences and most C0 control characters from terminal
/// output, leaving plain readable text for the read-only MCP server. Removes
/// SGR (colors/attributes), cursor movement, screen clears, OSC (title)
/// sequences and the like, so AI clients don't burn tokens on meaningless
/// escapes. `\n` and `\t` are preserved; other control bytes (incl. `\r`,
/// BEL, backspace, DEL) are dropped.
///
/// This is a simple escape stripper, NOT a terminal emulator: it doesn't honor
/// cursor overwrites or screen clears, so output with heavy cursor
/// repositioning (progress bars, full-screen TUIs) may include stale or
/// repeated text. Good enough for the common case — reading a build / error
/// log tail — which is what the MCP server is for.
fn strip_ansi(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            0x1b => {
                // Escape sequence — dispatch on the next byte (consume both).
                let Some(&c) = bytes.get(i + 1) else { break };
                i += 2;
                match c {
                    b'[' => {
                        // CSI: params (0x30-0x3F)*, intermediates (0x20-0x2F)*,
                        // final (0x40-0x7E).
                        while i < bytes.len() && (0x30..=0x3f).contains(&bytes[i]) {
                            i += 1;
                        }
                        while i < bytes.len() && (0x20..=0x2f).contains(&bytes[i]) {
                            i += 1;
                        }
                        if i < bytes.len() && (0x40..=0x7e).contains(&bytes[i]) {
                            i += 1;
                        }
                    }
                    b']' | b'P' | b'X' | b'^' | b'_' => {
                        // OSC/DCS/SOS/PM/APC: data until BEL (0x07) or ST (ESC \).
                        while i < bytes.len() {
                            if bytes[i] == 0x07 {
                                i += 1;
                                break;
                            }
                            if bytes[i] == 0x1b && bytes.get(i + 1) == Some(&b'\\') {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                    }
                    0x40..=0x5f => {
                        // Other escapes: ESC + one byte (ESC =, ESC M, ESC 7, …)
                        // — both bytes already consumed above.
                    }
                    _ => {
                        // ESC + unexpected byte — both already consumed.
                    }
                }
            }
            b'\n' | b'\t' => {
                out.push(b);
                i += 1;
            }
            b if b < 0x20 || b == 0x7f => {
                // Other control chars (CR, BEL, BS, DEL, …) — drop.
                i += 1;
            }
            _ => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---- the MCP server: tool handlers reuse TerminalState directly ----

#[derive(Clone)]
pub struct LuminaMcpServer {
    state: TerminalState,
}

#[tool_router]
impl LuminaMcpServer {
    #[tool(name = "list_tabs", description = "List all currently open terminal tabs (id, shell, isSsh). Use get_tab / get_active_tab for per-tab details.")]
    fn list_tabs(&self) -> Json<Vec<TabBrief>> {
        let terminals = match self.state.terminals.try_lock() {
            Ok(t) => t,
            Err(e) => {
                // Returning empty rather than panicking keeps the MCP session
                // alive — a transient lock failure shouldn't kill the server.
                log::error!("MCP list_tabs: failed to lock terminals: {}", e);
                return Json(Vec::new());
            }
        };
        let tabs = terminals
            .iter()
            .map(|(id, entry)| TabBrief {
                id: id.clone(),
                shell: entry.exe_path.clone(),
                is_ssh: entry.profile_type.as_deref() == Some("remote"),
            })
            .collect::<Vec<_>>();
        Json(tabs)
    }

    #[tool(name = "get_active_tab", description = "Get details (shell, isSsh, sshHost, cwd, foregroundCommand) of the currently focused terminal tab, or null if no terminal is focused.")]
    fn get_active_tab(&self) -> Json<Option<TabDetail>> {
        let active_id = self
            .state
            .active_id
            .try_lock()
            .ok()
            .and_then(|g| g.clone());
        match active_id {
            Some(id) => Json(tab_detail(&self.state, &id)),
            None => Json(None),
        }
    }

    #[tool(name = "get_tab", description = "Get details (shell, isSsh, sshHost, cwd, foregroundCommand) of a terminal tab by id.")]
    fn get_tab(
        &self,
        Parameters(IdParams { id }): Parameters<IdParams>,
    ) -> Json<Option<TabDetail>> {
        Json(tab_detail(&self.state, &id))
    }

    #[tool(name = "get_foreground_command", description = "Get the command currently running in a tab's foreground ({command, privileged}), or null when the shell is idle at the prompt / on SSH / non-Unix.")]
    fn get_foreground_command(
        &self,
        Parameters(IdParams { id }): Parameters<IdParams>,
    ) -> Json<Option<CommandInfo>> {
        Json(foreground(&self.state, &id))
    }

    #[tool(name = "get_recent_output", description = "Get the recent decoded output of a terminal tab as plain text (ANSI escapes stripped) — the last ~64 KiB tail, or the last N lines if `lines` is given. Covers output produced after the tab was created.")]
    fn get_recent_output(
        &self,
        Parameters(RecentOutputParams { id, lines }): Parameters<RecentOutputParams>,
    ) -> Json<String> {
        let out = {
            let terminals = match self.state.terminals.try_lock() {
                Ok(t) => t,
                Err(e) => {
                    log::warn!("MCP get_recent_output {}: failed to lock terminals: {}", id, e);
                    return Json(String::new());
                }
            };
            match terminals.get(&id) {
                Some(entry) => entry
                    .recent_output
                    .try_lock()
                    .ok()
                    .map(|g| g.snapshot(lines)),
                None => {
                    log::warn!("MCP get_recent_output: terminal {} not found", id);
                    None
                }
            }
        };
        Json(strip_ansi(&out.unwrap_or_default()))
    }

    #[tool(name = "get_terminal_cwd", description = "Get the current working directory of a tab's shell process (best effort; null on Windows / SSH).")]
    fn get_terminal_cwd(
        &self,
        Parameters(IdParams { id }): Parameters<IdParams>,
    ) -> Json<Option<String>> {
        Json(live_cwd(&self.state, &id))
    }
}

#[tool_handler]
impl ServerHandler for LuminaMcpServer {}

// ---- HTTP server lifecycle (config-driven from the frontend) ----

/// Connection info returned by `start_mcp_server`: the URL an AI client uses
/// (already includes the per-launch token in the path) and the token itself.
#[derive(Serialize, Clone)]
pub struct McpEndpoint {
    pub url: String,
    pub token: String,
}

/// Managed state holding the spawned MCP HTTP server task so it can be
/// stopped. At most one server per Lumina instance.
#[derive(Default)]
pub struct McpServerHandle {
    task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    /// The endpoint of the currently-running server, so `start_mcp_server` can
    /// be idempotent (return it instead of erroring "already running").
    endpoint: Arc<Mutex<Option<McpEndpoint>>>,
}

/// Start the read-only MCP HTTP server on 127.0.0.1:port. Returns the
/// connection URL (with a random token in the path) for the AI client.
/// Called by the frontend when the user enables MCP.
#[tauri::command]
pub async fn start_mcp_server(
    port: u16,
    app: AppHandle,
    state: State<'_, TerminalState>,
    handle: State<'_, McpServerHandle>,
) -> Result<McpEndpoint, String> {
    // Idempotent: if a server is already running, return its stored endpoint
    // instead of erroring. This is routine in dev — React StrictMode double-
    // invokes effects, and the settings panel remounts on tab switches — so
    // neither should look like a failure to the caller.
    {
        let task = handle
            .task
            .lock()
            .map_err(|e| format!("failed to lock mcp handle: {e}"))?;
        if task.is_some() {
            log::debug!("start_mcp_server: already running, returning current endpoint");
            let ep = handle
                .endpoint
                .lock()
                .map_err(|e| format!("failed to lock mcp endpoint: {e}"))?;
            if let Some(e) = ep.clone() {
                return Ok(e);
            }
            // Brief race: task is set but endpoint isn't stored yet.
            return Err("MCP server already starting".into());
        }
    }

    let token = load_or_create_token(&app)?;
    let shared_state = state.inner().clone();
    let mount_path = format!("/{}/mcp", token);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            log::error!("MCP bind 127.0.0.1:{} failed: {}", port, e);
            format!("failed to bind 127.0.0.1:{port}: {e}")
        })?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("failed to resolve bound address: {e}"))?
        .port();

    // Each MCP session gets its own handler instance, but all of them share
    // the same TerminalState (cheap Arc clone) — so every client always sees
    // the live tabs the user sees.
    let service = StreamableHttpService::new(
        move || Ok(LuminaMcpServer { state: shared_state.clone() }),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );
    let app = axum::Router::new().nest_service(&mount_path, service);

    let join = tauri::async_runtime::spawn(async move {
        log::info!("MCP server serving on 127.0.0.1:{}", bound_port);
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("MCP server exited with error: {}", e);
        } else {
            log::info!("MCP server stopped");
        }
    });

    let endpoint = McpEndpoint {
        url: format!("http://127.0.0.1:{}/{}/mcp", bound_port, token),
        token: token.clone(),
    };
    {
        let mut task = handle
            .task
            .lock()
            .map_err(|e| format!("failed to lock mcp handle: {e}"))?;
        *task = Some(join);
        if let Ok(mut ep) = handle.endpoint.lock() {
            *ep = Some(endpoint.clone());
        }
    }

    log::info!("MCP server started at {}", endpoint.url);
    Ok(endpoint)
}

/// Stop the MCP HTTP server if one is running. Called by the frontend when the
/// user disables MCP. Aborts the serve task, which drops the TcpListener and
/// frees the port.
#[tauri::command]
pub fn stop_mcp_server(handle: State<'_, McpServerHandle>) {
    let mut task = match handle.task.lock() {
        Ok(t) => t,
        Err(e) => {
            log::error!("stop_mcp_server: failed to lock handle: {}", e);
            return;
        }
    };
    if let Some(join) = task.take() {
        join.abort();
        log::info!("MCP server stop requested");
    } else {
        log::debug!("stop_mcp_server: no running server");
    }
    if let Ok(mut ep) = handle.endpoint.lock() {
        *ep = None;
    }
}

/// Load the persisted MCP URL token, creating + saving it on first run. The
/// token is stable across restarts so an AI client's configured URL doesn't
/// break every launch — only a port change (or deleting the token file)
/// regenerates it. Stored as plain text in the app data dir; non-cryptographic
/// (the server is loopback-only and rmcp guards the Host header). A write
/// failure is logged but non-fatal: the token still works for this session,
/// it just won't persist.
fn load_or_create_token(app: &AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("Failed to create app data dir for MCP token: {}", e);
    }
    let path = dir.join("mcp-token");
    if let Ok(tok) = std::fs::read_to_string(&path) {
        let tok = tok.trim().to_string();
        if !tok.is_empty() {
            return Ok(tok);
        }
    }
    let tok = generate_token();
    if let Err(e) = std::fs::write(&path, &tok) {
        log::warn!("Failed to persist MCP token to {}: {}", path.display(), e);
    }
    log::info!("Generated new MCP token (saved to {})", path.display());
    Ok(tok)
}

/// Generate a fresh non-cryptographic URL token. The server is loopback-only
/// and rmcp already validates the Host header (DNS-rebinding guard), so this
/// token is a second layer against other local processes guessing the endpoint
/// — not a password. Combining wall-clock nanos with the pid is enough for that.
fn generate_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("lumina-{:x}-{:x}", nanos, std::process::id())
}
