import {AppIconId} from "../lib/appIcon.ts";

interface AppIconProps {
    app: AppIconId;
    /** True when the icon renders on a dark background. Brand logos ship a
     * light and a dark variant; pass the effective-bg darkness so the logo
     * stays legible (e.g. when a fullscreen TUI spreads its own bg color). */
    dark: boolean;
    size?: number;
    className?: string;
}

/**
 * Branded app logo icons, shown in the tab when a recognized app is running.
 * Unlike {@link ShellIcon}, these keep each app's brand colors (the point of a
 * brand logo is recognizability), so they do NOT use currentColor. Each app
 * provides a light-on-dark and dark-on-light variant; pick via {@link dark}.
 *
 * Add a `case` per {@link AppIconId}; SVGs are inlined to inherit size/className
 * and to avoid an extra asset load. Paths are simplified from the official
 * brand SVGs (masks/clips dropped — only the visible geometry is kept).
 *
 * Takes precedence over ShellIcon: when a tab has a running command that maps
 * to a known app (see `lib/appIcon.ts`), this icon replaces the shell icon.
 */
export default function AppIcon({app, dark, size = 14, className}: AppIconProps) {
    switch (app) {
        case "opencode":
            // Official opencode mark: an outer rounded frame with a smaller
            // rectangle nested in its lower-left. The brand ships two variants
            // named after the logo's OWN tone (not the bg it's placed on):
            //   - light variant: frame #211E1E (deep) + inset #CFCECD (pale)
            //   - dark variant:  frame #F1ECEC (pale) + inset #4B4646 (deep)
            // Pick by the surrounding background: dark bg → dark variant,
            // light bg → light variant. viewBox 0 0 240 300 (source SVG).
            return (
                <svg width={size} height={size} viewBox="0 0 240 300" fill="none"
                    className={className} aria-hidden>
                    <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
                        fill={dark ? "#F1ECEC" : "#211E1E"} />
                    <path d="M180 240H60V120H180V240Z"
                        fill={dark ? "#4B4646" : "#CFCECD"} />
                </svg>
            );
    }
}
