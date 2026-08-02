import type {CSSProperties, ReactNode} from "react";

/**
 * Unified settings row primitive. Collapses three hand-rolled patterns that
 * were copy-pasted across the settings panels:
 *
 *  - "field"  : a labeled control stacked vertically (`flex flex-col gap-1.5`).
 *  - "toggle" : a label (optional description) on the left, a Switch on the
 *               right (`flex flex-row items-center justify-between`).
 *  - "action" : a label/description on the left, a Button on the right.
 *  - "info"   : a key/value row separated by a hairline (AboutPage facts).
 *
 * Spacing is fixed by this component (no more `gap-1` vs `gap-1.5` drift) so
 * every settings page breathes at the same rhythm.
 */

export type SettingRowVariant = "field" | "toggle" | "action" | "info";

export interface SettingRowProps {
    variant?: SettingRowVariant;
    /** Primary label (shown on top for `field`, on the left for others). */
    label?: ReactNode;
    /** Optional secondary description under the label (toggle/action/info). */
    description?: ReactNode;
    /** The control: a Switch, Input, Select, Button, or raw value. */
    children?: ReactNode;
    /** For `info` rows: the trailing value when `children` is not used. */
    trailing?: ReactNode;
    /** Extra className on the row wrapper. */
    className?: string;
    /** Inline style overrides (e.g. for theme-derived borders on info rows). */
    style?: CSSProperties;
    /** Click handler for toggle rows (clicking the label toggles). */
    onClick?: () => void;
}

export default function SettingRow({
    variant = "field",
    label,
    description,
    children,
    trailing,
    className = "",
    style,
    onClick,
}: SettingRowProps) {
    const base = "lum-setting-row";

    if (variant === "field") {
        return (
            <div className={`${base} flex flex-col gap-1.5 ${className}`} style={style}>
                {label != null && <div className="text-sm">{label}</div>}
                {children}
            </div>
        );
    }

    if (variant === "info") {
        return (
            <div
                className={`${base} flex items-center justify-between py-2.5 text-sm ${className}`}
                style={style}
            >
                <span className="text-muted">{label}</span>
                <span className="text-right">{trailing ?? children}</span>
            </div>
        );
    }

    // toggle | action — both are a left label/description + right control.
    return (
        <div
            className={`${base} flex flex-row items-center justify-between gap-4 ${onClick ? "cursor-pointer" : ""} ${className}`}
            style={style}
            onClick={onClick}
        >
            <div className="flex flex-col gap-0.5 min-w-0">
                {label != null && <div className="text-sm">{label}</div>}
                {description != null && (
                    <p className="text-xs text-muted">{description}</p>
                )}
            </div>
            <div className="shrink-0 flex items-center">{children}</div>
        </div>
    );
}
