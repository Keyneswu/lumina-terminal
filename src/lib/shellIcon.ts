import {TerminalProfile} from "../types/terminal.ts";

/** Coarse shell category used to pick a tab icon. `"default"` covers any
 * shell without a dedicated icon (sh, dash, ksh, tcsh, cmd, wsl, ...). */
export type ShellType = "bash" | "zsh" | "fish" | "nu" | "pwsh" | "ssh" | "default";

/** Shells that map to the generic terminal icon (no dedicated logo). Kept as a
 * Set so the mapping stays declarative and cheap to extend. */
const GENERIC_SHELLS = new Set([
    "sh", "dash", "ksh", "tcsh", "csh", "elvish", "cmd", "wsl", "xonsh",
]);

/** Extract the executable basename (no dir, no `.exe`) from a path string. */
function exeBasename(exePath: string): string {
    const base = exePath.split(/[\\/]/).pop() ?? exePath;
    return base.toLowerCase().replace(/\.exe$/, "");
}

/** Determine a terminal's icon category from its profile. SSH wins over the
 * local shell so a remote tab always shows the cloud icon even when its
 * `exePath` happens to name a shell. */
export function getShellType(profile: TerminalProfile): ShellType {
    if (profile.ssh || profile.type === "remote") return "ssh";
    const name = exeBasename(profile.exePath ?? "");
    if (!name) return "default";
    if (name.includes("powershell")) return "pwsh";
    switch (name) {
        case "bash":
            return "bash";
        case "zsh":
            return "zsh";
        case "fish":
            return "fish";
        case "nu":
            return "nu";
        case "pwsh":
            return "pwsh";
        default:
            return GENERIC_SHELLS.has(name) ? "default" : "default";
    }
}
