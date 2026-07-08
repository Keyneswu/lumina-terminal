import { useMemo } from "react";
import { adjustColor, isColorDark } from "../lib/color.ts";

export interface SurfaceColors {
    dark: boolean;
    borderColor: string;
    activeOverlay: string;
    hoverOverlay: string;
    inactiveText: string;
}

export function useSurfaceColors(backgroundColor: string): SurfaceColors {
    return useMemo(() => {
        const dark = isColorDark(backgroundColor);
        const borderColor = adjustColor(backgroundColor, dark ? 20 : -20);
        const activeOverlay = dark
            ? "rgba(255,255,255,0.1)"
            : "rgba(0,0,0,0.08)";
        const hoverOverlay = dark
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.04)";
        const inactiveText = dark
            ? "rgba(255,255,255,0.5)"
            : "rgba(0,0,0,0.45)";
        return { dark, borderColor, activeOverlay, hoverOverlay, inactiveText };
    }, [backgroundColor]);
}
