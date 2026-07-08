import {invoke} from "@tauri-apps/api/core";
import {TerminalProfile} from "../types/terminal.ts";

/** Write input/data to a running terminal's PTY. */
export function writeToTerminal(id: string, content: string) {
    return invoke("write_to_terminal", {id, content});
}

/** Resize a terminal's PTY to the given cols/rows. */
export function resizeTerminal(id: string, cols: number, rows: number) {
    return invoke("resize_terminal", {id, cols, rows});
}

/** Kill a terminal's PTY process and remove it from backend state. */
export function killTerminal(id: string) {
    return invoke("kill_terminal", {id});
}

/** Spawn a terminal's PTY process on the backend. */
export function startTerminal(id: string, profile: TerminalProfile) {
    return invoke("start_terminal", {
        id,
        exePath: profile.exePath,
        cols: profile.cols,
        rows: profile.rows,
        profileType: profile.type ?? "local",
        sshConfig: profile.type === "remote" ? profile.ssh : undefined,
        cwd: profile.cwd || undefined,
    });
}
