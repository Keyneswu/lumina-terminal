import {ITerminalOptions} from "@xterm/xterm";

export type TerminalPadding = number | {x?: number, y?: number, left?: number, right?: number, top?: number, bottom?: number};
export type FontStyle = "normal" | "italic";
export type ProfileType = "local" | "remote";

export interface SSHConfig {
    host: string;
    port?: number;
    user?: string;
    identityFile?: string;
}

export interface SSHHostEntry {
    host: string;
    config: SSHConfig;
}

export interface TerminalRenderOptions extends ITerminalOptions {
    cols?: number; rows?: number;
    webgl?: boolean;
    /** Enable grapheme-cluster unicode width rules (xterm.js addon-unicode-
     * graphemes). Experimental: correctly measures complex emoji (ZWJ sequences,
     * combining marks) that Unicode 11 still splits, at the cost of higher CPU.
     * Off by default; when on it supersedes the Unicode 11 width table. */
    graphemeClusters?: boolean;
    /** Enable programming-ligature rendering. Uses the font's real GSUB table
     * for precise, font-specific ligatures (Fira Code's `www`, `//`, etc.):
     * the Rust backend reads the font file and returns its binary, then
     * `font-ligatures` parses the GSUB `calt` lookups client-side via
     * `opentype.js`. If the font can't be found, falls back to a hardcoded
     * list of ~50 common programming ligatures. Best results require a
     * ligature font (Fira Code, JetBrains Mono, …) set in `fontFamily`.
     * Off by default. */
    ligatures?: boolean;
    padding?: TerminalPadding;
    themePath?: string;
    fontStyle?: FontStyle;
}

export interface TerminalProfile extends TerminalRenderOptions {
    name: string;
    exePath: string;
    cwd?: string;
    /** Command to run on startup instead of dropping into an interactive
     * shell, e.g. "vim" or "opencode". Locally executed as
     * `<exe> --login -i -c "<cmd>"` (so the shell exits when the command does
     * → the tab closes); for SSH profiles it is passed to the remote host
     * (`ssh user@host <cmd>`). Empty/undefined = interactive shell. */
    startupCommand?: string;
    default?: boolean;
    type?: ProfileType;
    ssh?: SSHConfig;
}

/** Currently-running command in a terminal, for the tab subtitle. `null` means
 * the terminal is idle at the shell prompt (nothing to show). */
export interface CurrentCommand {
    /** argv[0] basename of the foreground process (e.g. "npm", "sudo"). */
    command: string;
    /** True for elevated/privileged operations (sudo, su, doas, pkexec, or a
     * process running as root). The tab subtitle shows a red dot before the
     * command name when this is true. */
    privileged: boolean;
}
