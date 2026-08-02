import {Terminal} from "@xterm/xterm";
import {LogicalSize} from "@tauri-apps/api/window";
import {TerminalProfile} from "../types/terminal.ts";
import {parseProfilePadding} from "./term.ts";

/**
 * Compute the OS window size (logical px) needed to display a profile's
 * configured rows/cols exactly, accounting for chrome insets and the
 * terminal's own padding.
 *
 * Spawns an off-screen xterm to measure the actual per-cell dimensions of the
 * profile's font, since xterm renders glyphs at a size that depends on the
 * font family/size/style and isn't computable from CSS metrics alone. The
 * measurement terminal is disposed before returning.
 *
 * Pure-ish logic (DOM + xterm, but no React) per the lib/ layering rule.
 * `containerClientWidth/Height` is the terminal mount element's inner size;
 * pass the same `<div>` Term opens xterm into so the chrome inset is accurate.
 */
export function profileWindowSize(
    profile: TerminalProfile,
    paddingOffset: number,
    containerClientWidth: number,
    containerClientHeight: number,
): LogicalSize {
    // Off-screen measurement terminal. Must match the profile's font options so
    // the measured cell size reflects what the real terminal will render.
    const dummyTerm = new Terminal({...profile});
    const dummyDiv = document.createElement("div");
    dummyDiv.style.position = "absolute";
    dummyDiv.style.visibility = "hidden";
    dummyDiv.style.top = "-9999px";
    dummyDiv.style.width = "500px";
    dummyDiv.style.height = "500px";
    dummyDiv.style.fontStyle = profile.fontStyle ?? "normal";
    document.body.appendChild(dummyDiv);
    dummyTerm.open(dummyDiv);
    // @ts-ignore — _charSizeService is internal; measure explicitly for accuracy.
    if (dummyTerm._core?._charSizeService) {
        // @ts-ignore
        dummyTerm._core._charSizeService.measure();
    }
    const renderDimensions = (dummyTerm as any)._core?._renderService?.dimensions;
    const charSizeService = (dummyTerm as any)._core?._charSizeService;
    const charWidth = renderDimensions?.actualCellWidth || charSizeService?.width;
    const charHeight = renderDimensions?.actualCellHeight || charSizeService?.height;
    dummyTerm.dispose();
    dummyDiv.remove();

    // Chrome inset: window inner size minus the terminal mount element's
    // inner size (sidebar, title bar, padding). Measured against the live
    // container so a 0-size container (not yet mounted) falls back to 0.
    const widthOffset = Math.max(0, window.innerWidth - containerClientWidth);
    const heightOffset = Math.max(0, window.innerHeight - containerClientHeight);
    const padding = parseProfilePadding(profile, paddingOffset);
    const pixelWidth = Math.floor(
        (profile.cols ?? 80) * charWidth,
    ) + widthOffset + padding.left + padding.right;
    const pixelHeight = Math.floor(
        (profile.rows ?? 24) * charHeight,
    ) + heightOffset + padding.top + padding.bottom;
    return new LogicalSize({width: pixelWidth, height: pixelHeight});
}
