import {invoke, Channel} from "@tauri-apps/api/core";
import {error} from "@tauri-apps/plugin-log";
import {TerminalProfile} from "../types/terminal.ts";

/**
 * Run an invoke() and log any rejection as an error before rethrowing, so a
 * backend failure is always recorded even when a caller treats the promise as
 * fire-and-forget (most PTY call sites do). Callers that attach their own
 * `.catch` still see the rejection; the log happens exactly once here.
 */
function invokeWithLog<T>(command: string, id: string, args: Record<string, unknown>): Promise<T> {
    return invoke<T>(command, {...args, id}).catch((e) => {
        // Re-log then rethrow so callers that catch (e.g. App.tsx killTerminal)
        // still get the rejection, and fire-and-forget callers at least log it.
        error(`[pty] ${command} failed for terminal ${id}: ${e}`).catch(() => {});
        throw e;
    });
}

/** Write input/data to a running terminal's PTY. */
export function writeToTerminal(id: string, content: string) {
    return invokeWithLog<void>("write_to_terminal", id, {content});
}

/** Resize a terminal's PTY to the given cols/rows. */
export function resizeTerminal(id: string, cols: number, rows: number) {
    return invokeWithLog<void>("resize_terminal", id, {cols, rows});
}

/** Kill a terminal's PTY process and remove it from backend state. */
export function killTerminal(id: string) {
    return invokeWithLog<void>("kill_terminal", id, {});
}

/**
 * Spawn a terminal's PTY process on the backend. `onOutput` is a Channel the
 * backend streams PTY output over (low-overhead, binary-safe UTF-8). Set its
 * `.onmessage` before calling this.
 */
export function startTerminal(id: string, profile: TerminalProfile, onOutput: Channel<string>) {
    return invokeWithLog<void>("start_terminal", id, {
        exePath: profile.exePath,
        cols: profile.cols,
        rows: profile.rows,
        profileType: profile.type ?? "local",
        sshConfig: profile.type === "remote" ? profile.ssh : undefined,
        cwd: profile.cwd || undefined,
        onOutput,
    });
}

/**
 * Toggle the per-terminal LowLatency output override. When true the backend
 * flushes every read immediately instead of coalescing into large bursts, so
 * user interaction (typing / mouse / resize) sees the lowest output delay.
 * Only call on boolean transitions — it is not debounced here.
 */
export function setOutputMode(id: string, lowLatency: boolean) {
    return invokeWithLog<void>("set_output_mode", id, {lowLatency});
}
