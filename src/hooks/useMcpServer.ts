import {useEffect, useSyncExternalStore} from "react";
import {error as logError, info} from "@tauri-apps/plugin-log";
import {useGlobalConfig} from "./config.tsx";
import {MCP_DEFAULT_PORT} from "../constants.ts";
import {startMcpServer, stopMcpServer, type McpEndpoint} from "../lib/mcpApi.ts";

// The MCP HTTP server is a single process-wide resource (one port, one token),
// so its status is held in a module-level singleton and published to any
// component via `useMcpStatus`. Only the lifecycle hook below ever starts /
// stops it; readers just observe.

export interface McpStatus {
    /** The running server's endpoint, or null when off / starting / failed. */
    endpoint: McpEndpoint | null;
    /** Last start error, or null. Cleared on a successful start or a stop. */
    error: string | null;
}

let status: McpStatus = {endpoint: null, error: null};
const listeners = new Set<() => void>();
function emit() {
    listeners.forEach((l) => l());
}
function setStatus(next: McpStatus) {
    const same =
        (status.endpoint?.url ?? null) === (next.endpoint?.url ?? null) &&
        (status.endpoint !== null) === (next.endpoint !== null) &&
        status.error === next.error;
    if (same) return;
    status = next;
    emit();
}

/**
 * Reactively read the MCP server status (endpoint + last error). Used by the
 * settings UI to show the connection URL, a starting state, or a failure — so
 * a start problem is never silent.
 */
export function useMcpStatus(): McpStatus {
    return useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => {
                listeners.delete(cb);
            };
        },
        () => status,
        () => ({endpoint: null, error: null}),
    );
}

/**
 * Drive the MCP server lifecycle from `config.enableMcp`. Call this ONCE, at
 * the app root (App.tsx), so the server follows the app lifecycle — not the
 * settings panel's mount/unmount. That keeps it running while settings is
 * closed and (later) when only the tray remains.
 *
 * Port changes intentionally do NOT restart the server (avoids flapping on
 * every keystroke in the port field); toggle off/on to apply a new port.
 */
// In-flight start promise, shared across concurrent callers so that React
// StrictMode's dev double-invocation (and settings-panel remounts) issue only
// ONE `start_mcp_server` — two concurrent binds on the same port would race.
// The backend is also idempotent as a second line of defense.
let startingPromise: Promise<void> | null = null;

export function useMcpServerLifecycle() {
    const {config} = useGlobalConfig();
    const enabled = config.enableMcp ?? false;
    const port = config.mcpPort ?? MCP_DEFAULT_PORT;

    useEffect(() => {
        if (!enabled) {
            startingPromise = null;
            stopMcpServer().catch((e) => {
                logError(`Failed to stop MCP server: ${e}`).catch(() => {});
            });
            setStatus({endpoint: null, error: null});
            return;
        }
        if (!startingPromise) {
            info(`Starting MCP server on 127.0.0.1:${port}`);
            startingPromise = startMcpServer(port)
                .then((ep) => setStatus({endpoint: ep, error: null}))
                .catch((e) => {
                    logError(`MCP server failed to start: ${e}`).catch(() => {});
                    setStatus({endpoint: null, error: String(e)});
                })
                .finally(() => {
                    startingPromise = null;
                });
        }
        // The server is app-lifecycle-scoped (it intentionally outlives this
        // component), so cleanup does NOT stop it — only a transition to
        // enabled=false (above) stops the server.
        return;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
}
