import type {Terminal} from "@xterm/xterm";

/**
 * Inspect the outermost ring of the visible terminal buffer and, when every
 * edge cell shares the same explicit background color, return that color so it
 * can be painted into the padding/margin area around the canvas. This lets a
 * fullscreen TUI (vim, htop, lazygit, ...) that sets its own background bleed
 * seamlessly to the terminal edges instead of revealing a theme.background
 * border.
 *
 * Returns `null` (=> no override) when:
 *  - the terminal/core is not ready,
 *  - the edge colors are not all identical,
 *  - the edge is entirely default background (no TUI changed it) — in that
 *    case the surrounding theme.background already matches, so overriding it
 *    would be a no-op and we keep things transparent.
 */
export function sampleEdgeBackground(term: Terminal): string | null {
    const buffer = term.buffer.active;
    const cols = term.cols;
    const rows = term.rows;
    if (cols < 2 || rows < 2) return null;

    // v6 moved the palette from `_colorManager` to `_themeService`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (term as any)._core;
    const colors = core?._themeService?.colors;
    if (!colors) return null;

    const top = buffer.baseY;
    const reusableCell = buffer.getNullCell();

    let firstColor: string | null = null;
    let sawExplicit = false;

    // Resolve a single cell's background to a CSS string.
    // Returns null for width-0 continuation cells (part of a wide char) so they
    // are skipped rather than breaking the uniformity check.
    const resolveBg = (row: number, col: number): string | null => {
        const line = buffer.getLine(top + row);
        if (!line) return null;
        const cell = line.getCell(col, reusableCell);
        if (!cell) return null;
        if (cell.getWidth() === 0) return null; // wide-char tail, skip
        if (cell.isBgDefault()) {
            return colors.background.css;
        }
        sawExplicit = true; // at least one edge cell sets its own bg
        if (cell.isBgRGB()) {
            const v = cell.getBgColor();
            return "#" + (v >>> 0).toString(16).padStart(6, "0");
        }
        if (cell.isBgPalette()) {
            const idx = cell.getBgColor();
            return colors.ansi?.[idx]?.css ?? colors.background.css;
        }
        return colors.background.css;
    };

    const consider = (row: number, col: number): boolean => {
        const css = resolveBg(row, col);
        if (css === null) return true; // skip continuation cells
        if (firstColor === null) {
            firstColor = css;
        } else if (css !== firstColor) {
            return false; // mismatch => abort
        }
        return true;
    };

    // Top + bottom rows (all columns).
    for (let c = 0; c < cols; c++) {
        if (!consider(0, c)) return null;
        if (!consider(rows - 1, c)) return null;
    }
    // Left + right columns (inner rows only — corners already covered above).
    for (let r = 1; r < rows - 1; r++) {
        if (!consider(r, 0)) return null;
        if (!consider(r, cols - 1)) return null;
    }

    // All edge cells agree. If none of them set an explicit background, the
    // surrounding theme.background already matches — no override needed.
    if (!sawExplicit) return null;
    return firstColor;
}
