/**
 * Data-driven app icon registry. SVG assets live as files on disk (one
 * directory per app); this module loads them all at build time via
 * `import.meta.glob` and exposes a lookup by icon id.
 *
 * Adding a new icon = drop SVG file(s) under `<id>/` here, then map a command
 * name to the id in `lib/appIcon.ts`. No component changes.
 *
 * File-name convention (by the BACKGROUND the icon is placed on, NOT the logo's
 * own tone):
 *   `<id>/<id>-light.svg` → variant for LIGHT backgrounds (logo itself tends dark)
 *   `<id>/<id>-dark.svg`  → variant for DARK backgrounds  (logo itself tends light)
 *   `<id>/<id>.svg`       → NEUTRAL single-color variant (used when neither
 *                           light nor dark exists; fine for monochrome logos)
 * Most apps ship a light/dark pair. A monochrome logo may ship just the neutral
 * file, or a neutral + one variant — the lookup falls back gracefully.
 */

// Match every SVG one level deep. Eager + ?url so Vite emits each as a static
// asset and returns its URL string at build time (synchronous at runtime).
const allSvgs = import.meta.glob<string>("./*/*.svg", {
    eager: true,
    query: "?url",
    import: "default",
});

export interface AppIconAssets {
    /** SVG url variant for light backgrounds (absent if not provided). */
    light?: string;
    /** SVG url variant for dark backgrounds (absent if not provided). */
    dark?: string;
    /** Neutral monochrome SVG url (used when the matching variant is absent). */
    neutral?: string;
}

/** Pull the app id out of a glob path: "./opencode/opencode-light.svg" → "opencode". */
function idFromPath(path: string): string | null {
    const m = path.match(/^\.\/([^/]+)\/[^/]+\.svg$/);
    return m ? m[1] : null;
}

/** Classify a file by its name suffix: "opencode-light" → "light", ".svg" stripped. */
function variantFromName(file: string): "light" | "dark" | "neutral" {
    if (file.endsWith("-light")) return "light";
    if (file.endsWith("-dark")) return "dark";
    return "neutral";
}

/** icon id → variant → SVG url, derived from the directory structure. */
function buildAssetMap(): Record<string, AppIconAssets> {
    const map: Record<string, AppIconAssets> = {};
    for (const [path, url] of Object.entries(allSvgs)) {
        const id = idFromPath(path);
        if (!id) continue;
        // Basename without ".svg": "opencode-light" / "opencode" / ...
        const file = path.slice(path.lastIndexOf("/") + 1, -4);
        const variant = variantFromName(file);
        (map[id] ??= {})[variant] = url;
    }
    return map;
}

export const APP_ICON_ASSETS: Record<string, AppIconAssets> = buildAssetMap();

/** All registered icon ids (derived from the asset directories). */
export const APP_ICON_IDS: string[] = Object.keys(APP_ICON_ASSETS);

/**
 * Resolve the SVG url for an icon id on a given background. Falls back to the
 * neutral variant, then to the opposite variant, so a monochrome logo (single
 * `<id>.svg`) or a lone light/dark file still renders on any background.
 * Returns null only when the id has no SVGs at all.
 */
export function getAppIconSrc(id: string, dark: boolean): string | null {
    const a = APP_ICON_ASSETS[id];
    if (!a) return null;
    if (dark) return a.dark || a.neutral || a.light || null;
    return a.light || a.neutral || a.dark || null;
}
