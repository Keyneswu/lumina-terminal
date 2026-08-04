/**
 * Application icon resolution: given a running command line, decide which
 * (if any) built-in app brand icon the tab should show.
 *
 * Pure logic (no React) per the lib/ layering rule. The single source of
 * truth for the command→icon mapping; components consume {@link getAppIcon}.
 *
 * Mirrors the organization of `shellIcon.ts`, but maps a *running command* to
 * a branded app icon rather than a shell category. App icons are rendered by
 * `components/AppIcon.tsx` and take precedence over the shell icon when set.
 */

/** Supported app brand icons. Add an id here, a row in {@link APP_COMMANDS},
 * and a case in `AppIcon.tsx` to register a new app. */
export type AppIconId = "opencode";

/** Command basename (lowercase) → app icon id. The single mapping table; all
 * matching goes through this. Keys are argv[0] basenames as reported by the
 * backend's `foreground_command` / shell-integration CurrentCommand stream. */
const APP_COMMANDS: Record<string, AppIconId> = {
    opencode: "opencode",
};

/** argv[0] basenames that wrap another command. When extracting the "real"
 * app from a command line, these are skipped so e.g. "sudo opencode" resolves
 * to opencode. Extends the PRIVILEGED_COMMANDS idea from command_tracker.rs
 * with non-privileged wrappers (env, time, strace, ...). */
const WRAPPERS = new Set([
    // privilege escalation
    "sudo", "doas", "su", "pkexec", "gsudo", "runuser",
    // generic wrappers
    "env", "exec", "nohup", "time", "timed",
    // observation / scheduling
    "strace", "ltrace", "nice", "ionice",
    // misc
    "xargs", "watch",
]);

/** Extract the executable basename (no dir, no `.exe`) from a path string. */
function exeBasename(exe: string): string {
    const base = exe.split(/[\\/]/).pop() ?? exe;
    return base.toLowerCase().replace(/\.exe$/, "");
}

/** Extract the "real" app basename from a full command line, skipping wrapper
 * commands. Returns the first non-wrapper, non-env-assignment token's basename.
 * e.g. "sudo nvim file.txt" → "nvim"; "env FOO=bar opencode" → "opencode".
 * Returns null for an empty/all-wrapper command line. */
export function resolveAppFromCommand(line: string): string | null {
    const tokens = line.trim().split(/\s+/);
    for (const tok of tokens) {
        const base = exeBasename(tok);
        if (!base) continue;
        if (WRAPPERS.has(base)) continue;
        if (base.includes("=")) continue; // env VAR=val assignment
        return base;
    }
    return null;
}

/** Given a command line, return the app icon id to display, or null when the
 * command is not a supported app (caller falls back to the shell icon).
 * This is the single entry point components/App should call. */
export function getAppIcon(line: string): AppIconId | null {
    const app = resolveAppFromCommand(line);
    if (!app) return null;
    return APP_COMMANDS[app] ?? null;
}
