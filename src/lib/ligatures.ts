/**
 * Programming-ligature support for xterm.js, using the font's real GSUB table.
 *
 * xterm.js renders text on a cell grid and doesn't natively merge adjacent
 * cells for ligatures (e.g. `->` rendered as `→`). The `registerCharacterJoiner`
 * API lets us tell xterm which character ranges to join, and the renderer
 * (WebGL or canvas) then draws them as a single glyph — applying the font's
 * OpenType `calt` ligature substitutions.
 *
 * To know WHICH ranges to join we need the font's GSUB table. In a Tauri
 * webview there's no Node.js `fs` to read the font file, so the binary data
 * comes from the Rust backend (`find_font` command). `font-ligatures`'
 * `loadBuffer()` then parses the GSUB `calt` lookups entirely client-side
 * (via `opentype.js`, pure JS) and returns a `Font` object whose
 * `findLigatureRanges(text)` tells us exactly which substrings the font
 * ligates — including font-specific ones like Fira Code's `www` or `//`.
 *
 * If the backend can't find the font, we fall back to a hardcoded list of
 * ~50 common programming ligatures (the same list xterm.js addon-ligatures
 * uses). This covers the most common cases but misses font-specific ligatures.
 *
 * Pure logic (no React) per the lib/ layering rule.
 */
import {Terminal} from "@xterm/xterm";
import {loadBuffer, type Font} from "font-ligatures";

// Caches 100K characters worth of ligatures (~650 KB with moderate ligatures).
const CACHE_SIZE = 100000;

/**
 * Fallback ligature list used when the font file can't be loaded. Sourced from
 * Iosevka's default "calt" ligation set (same as xterm.js addon-ligatures).
 * Sorted longest-first so the greedy matcher prefers longer matches.
 */
const FALLBACK_LIGATURES = [
    "<--", "<---", "<<-", "<-", "->", "->>", "-->", "--->",
    "<==", "<===", "<<=", "<=", "=>", "=>>", "==>", "===>", ">=", ">>=",
    "<->", "<-->", "<--->", "<---->", "<=>", "<==>", "<===>", "<====>", "::", ":::",
    "<~~", "</", "</>", "/>", "~~>", "==", "!=", "/=", "~=", "<>", "===", "!==", "!===",
    "<:", ":=", "*=", "*+", "<*", "<*>", "*>", "<|", "<|>", "|>", "+*", "=*", "=:", ":>",
    "/*", "*/", "+++", "<!--", "<!---",
].sort((a, b) => b.length - a.length);

/** A [start, end) pair into a text string indicating a ligature range. */
type Range = [number, number];

/**
 * Enable ligature rendering for a terminal. Must be called AFTER
 * `terminal.open()`.
 *
 * @param term The xterm.js Terminal instance.
 * @param fontData A promise that resolves to the font's binary data
 *   (`ArrayBuffer`) from the Rust backend, or `null` if the font couldn't be
 *   found (triggers fallback mode).
 * @returns The character-joiner ID (for deregistration), or `undefined` if
 *   registration failed.
 */
export function enableLigatures(
    term: Terminal,
    fontData: Promise<ArrayBuffer | null>,
): number | undefined {
    let font: Font | undefined;

    // Kick off font parsing. When it's done, refresh the terminal so already-
    // rendered text picks up the real ligature ranges (the joiner is called
    // lazily during render, so a refresh forces re-evaluation). Until the font
    // is parsed, the joiner below uses the fallback list.
    fontData.then((buffer) => {
        if (!buffer) return; // Font not found — stay in fallback mode.
        try {
            font = loadBuffer(buffer, {cacheSize: CACHE_SIZE});
            // Force a re-render so existing text gets real ligatures.
            term.refresh(0, term.rows - 1);
        } catch {
            // GSUB parse failure — fall back to the hardcoded list (font stays undefined).
        }
    }).catch(() => {
        // Backend error — stay in fallback mode.
    });

    return term.registerCharacterJoiner((text: string): Range[] => {
        // If the font's GSUB table is loaded, use it for precise, font-specific
        // ligature ranges (including Fira Code's `www`, `//`, etc.).
        if (font) {
            return font.findLigatureRanges(text).map((r) => [r[0], r[1]] as Range);
        }
        // Font not loaded yet or unavailable — use the hardcoded fallback list.
        return fallbackRanges(text);
    });
}

/** Match text against the fallback ligature list (greedy, longest-first). */
function fallbackRanges(text: string): Range[] {
    const ranges: Range[] = [];
    for (let i = 0; i < text.length; i++) {
        for (const lig of FALLBACK_LIGATURES) {
            if (text.startsWith(lig, i)) {
                ranges.push([i, i + lig.length]);
                i += lig.length - 1;
                break;
            }
        }
    }
    return ranges;
}
