import type {CSSProperties, ReactNode} from "react";

/**
 * Clips its children to a rounded-rectangle shape via an SVG mask, so the
 * corners are transparent and whatever sits behind this component shows
 * through. This is how the terminal gets its rounded inner corners: a chrome
 * layer underneath, the terminal (wrapped here) on top with the corners cut
 * away.
 *
 * Why SVG mask instead of `border-radius` or `clip-path`?
 *  - `border-radius` only rounds the box; it can't express per-corner cuts,
 *    notches, or asymmetric shapes, and it fails when the rounded region and
 *    its background are the same color.
 *  - `clip-path: inset(round)` works but is harder to extend toward more
 *    complex masks (irregular shapes, feathered edges, holes-within-holes).
 *  - An SVG `<rect rx>` fed to CSS `mask` is trivial to grow: swap the rect
 *    for a `<path>` later and the same wrapper gains arbitrary silhouettes.
 *
 * The mask is generated as an inline SVG (no extra HTTP), stretched to the
 * element's box via `mask-size: 100% 100%`.
 */

export type MaskShape = "rounded";

export interface MaskedSurfaceProps {
    children: ReactNode;
    /** Corner radius in px. Defaults to the --radius-lg token (14). */
    radius?: number;
    /** Custom mask shape. Currently only "rounded"; reserved for future
     *  complex silhouettes (notches, etc.). */
    shape?: MaskShape;
    className?: string;
    style?: CSSProperties;
}

/** Build an SVG mask data URI that is opaque (white) inside a rounded rect
 *  and transparent (black) outside. Stretched to fill the element.
 *
 *  The SVG uses a large fixed viewBox (VB) and `preserveAspectRatio="none"`, so
 *  it is stretched across the element by `mask-size: 100% 100%`. Because the
 *  stretch is uniform in each axis, a corner radius expressed as a fraction of
 *  VB maps to the same fraction of the element's width/height. We convert the
 *  requested pixel radius into that fraction using a reference size, so the
 *  rendered corner is roughly the requested px on a typical element — and we
 *  clamp it so it can never exceed half the shorter side (which would invert
 *  the corner). */
const VB = 1000;
function roundedMaskSvg(radiusPx: number): string {
    // Express the radius as viewBox units. We treat 1 vb-unit ≈ 1px at a
    // 1000px reference, then clamp to the valid range [0, VB/2].
    const rx = Math.max(0, Math.min(radiusPx, VB / 2));
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}" preserveAspectRatio="none">`
        + `<rect x="0" y="0" width="${VB}" height="${VB}" rx="${rx}" ry="${rx}" fill="#ffffff"/>`
        + `</svg>`;
    // encodeURIComponent keeps it URL-safe without the bulk of base64.
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function MaskedSurface({
    children,
    radius,
    shape = "rounded",
    className = "",
    style,
}: MaskedSurfaceProps) {
    // Read the default radius from the design token once; fall back to 14
    // (the literal --radius-lg value) if the var isn't resolvable yet.
    const r = radius ?? readRadiusToken();

    // For the common rounded-rectangle case we use border-radius + overflow
    // hidden: it gives a precise pixel radius with no aspect-ratio distortion,
    // unlike an SVG mask stretched via preserveAspectRatio="none". The SVG mask
    // path below is kept for future complex shapes (notches, asymmetric cuts)
    // where border-radius can't express the silhouette.
    const isPlainRounded = shape === "rounded";
    const mask = !isPlainRounded ? roundedMaskSvg(r) : undefined;

    const maskStyle: CSSProperties = mask
        ? {
            WebkitMaskImage: mask,
            maskImage: mask,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
        }
        : {};

    const roundedStyle: CSSProperties = isPlainRounded
        ? {borderRadius: r, overflow: "hidden"}
        : {};

    return (
        <div
            className={className}
            style={{...roundedStyle, ...maskStyle, ...style}}
        >
            {children}
        </div>
    );
}

function readRadiusToken(): number {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--radius-lg")
        .trim();
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}
