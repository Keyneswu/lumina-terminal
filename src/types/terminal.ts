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
