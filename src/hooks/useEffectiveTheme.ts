import {useEffect, useState} from "react";
import {ITheme} from "@xterm/xterm";
import {TerminalProfile} from "../types/terminal.ts";
import {parseProfileTheme} from "../lib/term.ts";
import {foregroundFor, isColorDark} from "../lib/color.ts";

export interface EffectiveTheme {
    // The ITheme with bg/fg overridden to the effective values (TUI edge color
    // takes priority), or null when no profile is active yet.
    theme: ITheme | null;
    // Effective background color (edge bg if a fullscreen TUI set one, else
    // theme.background), or undefined before the theme resolves.
    bg: string | undefined;
    // Effective foreground color — a readable contrast color for bg.
    fg: string | undefined;
}

/**
 * Derive the effective theme for the whole app from the active profile and the
 * edge background reported by the active terminal.
 *
 * - Resolves the profile's theme (themePath + inline theme) asynchronously.
 * - When a fullscreen TUI reports a uniform edge background, that color becomes
 *   the effective background and a readable contrast foreground is picked for
 *   it, so chrome (tab bar, title bar, settings) stays legible.
 * - Syncs the HeroUI light/dark class on <html> with the effective background.
 *
 * Returns the effective theme/bg/fg plus a setter to report edge background
 * changes from the active terminal (null clears it).
 */
export function useEffectiveTheme(
    currentProfile: TerminalProfile | null,
    currentId: string | null,
): EffectiveTheme & { setEdgeBg: (color: string | null) => void } {
    const [currentTheme, setCurrentTheme] = useState<ITheme | null>(null);
    // Uniform background color sampled from the active terminal's outer ring
    // (a fullscreen TUI's own bg). When set, the whole app follows it so the
    // TUI bleeds seamlessly to the window edges; null => use theme.background.
    const [edgeBg, setEdgeBg] = useState<string | null>(null);

    // Resolve the active profile's theme.
    useEffect(() => {
        if (currentProfile) {
            parseProfileTheme(currentProfile).then((theme) => {
                setCurrentTheme(theme);
            });
        }
    }, [currentProfile]);

    // Clear the sampled edge background whenever the active tab changes, so a
    // previously fullscreen TUI's color doesn't bleed into the next tab. The
    // active terminal will re-report its own value shortly after.
    useEffect(() => {
        setEdgeBg(null);
    }, [currentId]);

    // Effective background = TUI edge color if present, else terminal theme bg.
    const effectiveBg = edgeBg ?? currentTheme?.background;
    // Effective foreground: when a TUI overrides the background, pick a
    // readable contrast color for it instead of trusting the terminal theme's
    // foreground (which may clash, e.g. black text on a now-dark TUI bg).
    const effectiveFg = edgeBg && effectiveBg
        ? foregroundFor(effectiveBg)
        : currentTheme?.foreground;
    // Theme object with bg/fg overridden to the effective values, so children
    // that read theme.background / theme.foreground stay consistent.
    const effectiveTheme = currentTheme
        ? {...currentTheme, background: effectiveBg ?? currentTheme.background, foreground: effectiveFg ?? currentTheme.foreground}
        : currentTheme;

    // Sync HeroUI theme class with the effective background. When a fullscreen
    // TUI sets its own background, the light/dark decision follows that color so
    // text/icons stay legible against it.
    useEffect(() => {
        const bg = effectiveBg;
        if (!bg) return;
        const dark = isColorDark(bg);
        const root = document.documentElement;
        root.classList.toggle("dark", dark);
        root.classList.toggle("light", !dark);
        root.setAttribute("data-theme", dark ? "dark" : "light");
    }, [effectiveBg]);

    return {
        theme: effectiveTheme,
        bg: effectiveBg,
        fg: effectiveFg,
        setEdgeBg,
    };
}
