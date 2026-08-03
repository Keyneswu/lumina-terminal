import {TerminalProfile, TerminalRenderOptions} from "../types/terminal.ts";
import {ITheme} from "@xterm/xterm";
import {
    DEFAULT_TERMINAL_THEME,
    TERMINAL_CORNER_CONTENT_INSET,
    TERMINAL_LEFT_CONTENT_INSET,
} from "../constants.ts";
import {invoke} from "@tauri-apps/api/core";
import {appDataDir, join} from "@tauri-apps/api/path";
import {error} from "@tauri-apps/plugin-log";

export function parseProfilePadding(profile: TerminalProfile, paddingOffset: number) {
    let paddingLeft = 0, paddingRight = 0, paddingTop = 0, paddingBottom = 0;
    if (profile.padding) {
        if (typeof profile.padding === "number") {
            paddingLeft = profile.padding; paddingRight = profile.padding;
            paddingTop = profile.padding; paddingBottom = profile.padding;
        } else {
            // x, y
            paddingLeft = profile.padding.x ?? paddingLeft; paddingRight = profile.padding.x ?? paddingRight;
            paddingTop = profile.padding.y ?? paddingTop; paddingBottom = profile.padding.y ?? paddingBottom;
            // left, right, top, bottom
            paddingLeft = profile.padding.left ?? paddingLeft;
            paddingRight = profile.padding.right ?? paddingRight;
            paddingTop = profile.padding.top ?? paddingTop;
            paddingBottom = profile.padding.bottom ?? paddingBottom;
        }
    }
    // The terminal surface is clipped to a 14px rounded rectangle. A zero
    // profile padding would put the first/last cells inside those clipped
    // corners, so preserve a small content-safe inset on every side. The first
    // column gets a little more room for prompts/cursors. Profile padding
    // remains the total requested padding: values above the minimum win rather
    // than having another hidden inset added to them.
    paddingLeft = Math.max(paddingLeft, TERMINAL_LEFT_CONTENT_INSET) + paddingOffset;
    paddingRight = Math.max(paddingRight, TERMINAL_CORNER_CONTENT_INSET) + paddingOffset;
    paddingTop = Math.max(paddingTop, TERMINAL_CORNER_CONTENT_INSET) + paddingOffset;
    paddingBottom = Math.max(paddingBottom, TERMINAL_CORNER_CONTENT_INSET) + paddingOffset;
    return {
        left: paddingLeft,
        right: paddingRight,
        top: paddingTop,
        bottom: paddingBottom,
    };
}

export async function parseProfileTheme(profile: TerminalRenderOptions, defaultTheme?: ITheme) {
    let theme: ITheme = defaultTheme ?? DEFAULT_TERMINAL_THEME;
    if (profile.themePath) {
        const basePath = await appDataDir();
        const fullPath = await join(basePath, profile.themePath);
        const paths = [
            fullPath,
            profile.themePath,
        ];
        for (const path of paths) {
            const exists = await invoke<boolean>("path_exist", {path: path});
            if (exists) {
                const readTheme = await invoke<string>("read_file", {path: path});
                if (readTheme) {
                    try {
                        const t = JSON.parse(readTheme);
                        theme = {...theme, ...t};
                    } catch (e) {
                        error(`Failed to parse theme at ${path}: ${e}`).catch(() => {});
                    }
                }
                break;
            }
        }
    }
    if (profile.theme) {
        theme = {...theme, ...profile.theme};
    }
    return theme;
}

export async function parseProfile(profile: TerminalProfile, globalProfile?: TerminalRenderOptions): Promise<TerminalProfile> {
    const cleanGlobal = globalProfile ? Object.fromEntries(Object.entries(globalProfile).filter(([_, v]) => v !== undefined)) : {};
    const cleanProfile = Object.fromEntries(Object.entries(profile).filter(([_, v]) => v !== undefined));
    const p = {...cleanGlobal, ...cleanProfile} as TerminalProfile;
    if (globalProfile) {
        let globalTheme = await parseProfileTheme(globalProfile);
        p.theme = await parseProfileTheme(profile, globalTheme);
    } else {
        p.theme = await parseProfileTheme(p);
    }
    delete p.themePath;
    return p;
}
