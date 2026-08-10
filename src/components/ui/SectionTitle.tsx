import type {CSSProperties, ReactNode} from "react";

/**
 * Section title for settings panels. Replaces the hand-rolled
 * `<h2 className="text-lg font-semibold mb-6">` (and its `mb-2` drift) so
 * every panel's heading has identical type and spacing. An optional `subtitle`
 * renders underneath (used by BindingsSettings), and `mb` can be overridden
 * for the rare panel that needs a different gap.
 *
 * `variant` establishes the page-vs-subsection heading hierarchy:
 *  - "page"       → the single title at the top of a settings page
 *                   (`text-lg font-semibold`, default mb `1.5rem`)
 *  - "subsection" → a smaller in-page group heading used to break a long page
 *                   into related rows (`text-sm font-semibold`, default mb
 *                   `0.75rem`)
 */
export type SectionTitleVariant = "page" | "subsection";

export interface SectionTitleProps {
    children: ReactNode;
    subtitle?: ReactNode;
    variant?: SectionTitleVariant;
    /** Bottom margin. Defaults to `1.5rem` for "page", `0.75rem` for
     *  "subsection"; pass a CSS length to override. */
    mb?: string;
    /** Inline style (e.g. theme-derived color). */
    style?: CSSProperties;
    className?: string;
}

export default function SectionTitle({
    children,
    subtitle,
    variant = "page",
    mb,
    style,
    className = "",
}: SectionTitleProps) {
    const resolvedMb = mb ?? (variant === "subsection" ? "0.75rem" : "1.5rem");
    const heading =
        variant === "subsection"
            ? "text-sm font-semibold leading-tight"
            : "text-lg font-semibold leading-tight";
    return (
        <div className={className} style={{marginBottom: resolvedMb, ...style}}>
            <h2 className={heading}>{children}</h2>
            {subtitle != null && (
                <p className="text-xs text-muted mt-1">{subtitle}</p>
            )}
        </div>
    );
}
