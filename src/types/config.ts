import {TerminalProfile, TerminalRenderOptions} from "./terminal.ts";
import {Languages} from "../hooks/i18n.tsx";

export type Actions = "newTab" | "openConfigFile" | "closeTab" | "openCommandPalette" | "openSettings" | "toTab" | "toggleSidebar" | "tearOffTab" | "search";
export type WithKeys = "ctrl" | "shift" | "alt" | "command" | "CtrlOrCommand";

export interface Binding {
    key: string;
    with: WithKeys[];
    action: Actions;
    args?: Record<string, string>;
}

export interface GlobalConfig {
    language: Languages;
    profiles: TerminalProfile[];
    globalProfile?: TerminalRenderOptions;
    showTabBar?: boolean;
    bindings?: Binding[];
    closeWindowOnLastTab?: boolean;
    copyWithCtrl?: boolean;
    /** When true (default), a fullscreen TUI's uniform edge background "spreads"
     *  across the whole window chrome. When false, the app keeps the terminal
     *  theme's background and the sampling/polling is disabled. */
    enableColorSpread?: boolean;
    autoUpdateOnStartup?: boolean;
    /** When true, restore the main window to its last position on startup
     * (main window only; tear-off windows are positioned by their spawner). */
    rememberWindowPosition?: boolean;
    /** When true, restore the main window to its last size on startup. */
    rememberWindowSize?: boolean;
    /** Persisted main-window outer position in physical pixels. Written by
     * the runtime move listener while rememberWindowPosition is on; read once
     * at startup to restore. */
    rememberedWindowPosition?: {x: number; y: number};
    /** Persisted main-window inner size in physical pixels. Written by the
     * runtime resize listener while rememberWindowSize is on; read once at
     * startup to restore. */
    rememberedWindowSize?: {width: number; height: number};
}
