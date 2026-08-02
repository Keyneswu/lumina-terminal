import type {CSSProperties, ReactNode} from "react";

/**
 * Section title for settings panels. Replaces the hand-rolled
 * `<h2 className="text-lg font-semibold mb-6">` (and its `mb-2` drift) so
 * every panel's heading has identical type and spacing. An optional `subtitle`
 * renders underneath (used by BindingsSettings), and `mb` can be overridden
 * for the rare panel that needs a different gap.
 */
export interface SectionTitleProps {
    children: ReactNode;
    subtitle?: ReactNode;
    /** Bottom margin. Defaults to `1.5rem`; pass a CSS length to override. */
    mb?: string;
    /** Inline style (e.g. theme-derived color). */
    style?: CSSProperties;
    className?: string;
}

export default function SectionTitle({
    children,
    subtitle,
    mb = "1.5rem",
    style,
    className = "",
}: SectionTitleProps) {
    return (
        <div className={className} style={{marginBottom: mb, ...style}}>
            <h2 className="text-lg font-semibold leading-tight">{children}</h2>
            {subtitle != null && (
                <p className="text-xs text-muted mt-1">{subtitle}</p>
            )}
        </div>
    );
}
