import {useMemo} from "react";
import {adjustColor, isColorDark} from "../lib/color.ts";
import {elevationShadow, glassBorder} from "../lib/glass.ts";

export interface SurfaceColors {
    dark: boolean;
    borderColor: string;
    activeOverlay: string;
    hoverOverlay: string;
    inactiveText: string;
    /** Soft elevation shadow (sm) for floating chrome above the terminal. */
    elevationShadow: string;
    /** Hairline border tuned to read on a translucent (glass) surface. */
    glassBorder: string;
    /** A subtle surface one step above the bg — used for inset fields and
     *  collapsed sections so they recede behind the panel. */
    recessedBg: string;
    /** Brand-tinted focus ring (cinnabar at low alpha), for keyboard focus. */
    focusRing: string;
    /** Stronger active-tab accent overlay tinted with the brand lavender so
     *  the selected tab carries a hint of identity. */
    accentOverlay: string;
}

export function useSurfaceColors(backgroundColor: string): SurfaceColors {
    return useMemo(() => {
        const dark = isColorDark(backgroundColor);
        const borderColor = adjustColor(backgroundColor, dark ? 20 : -20);
        const activeOverlay = dark
            ? "rgba(255,255,255,0.10)"
            : "rgba(0,0,0,0.08)";
        const hoverOverlay = dark
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.04)";
        const inactiveText = dark
            ? "rgba(255,255,255,0.5)"
            : "rgba(0,0,0,0.45)";
        // Recessed surface: nudge the bg slightly *toward* the opposite
        // luminance so the inset reads as lower, not as a different color.
        const recessedBg = adjustColor(backgroundColor, dark ? -10 : 8);
        // Brand-tinted accents. The active tab/section gets a whisper of the
        // lavender; the focus ring uses the cinnabar so it stays warm + visible.
        const accentOverlay = dark
            ? "rgba(168,146,199,0.16)"
            : "rgba(168,146,199,0.12)";
        const focusRing = dark
            ? "rgba(255,70,31,0.55)"
            : "rgba(255,70,31,0.45)";
        return {
            dark,
            borderColor,
            activeOverlay,
            hoverOverlay,
            inactiveText,
            elevationShadow: elevationShadow("sm"),
            glassBorder: glassBorder(backgroundColor),
            recessedBg,
            focusRing,
            accentOverlay,
        };
    }, [backgroundColor]);
}
