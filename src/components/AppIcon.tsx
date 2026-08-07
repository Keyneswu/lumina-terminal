import {AppIconId} from "../lib/appIcon.ts";
import {getAppIconSrc} from "../assets/app-icons/index.ts";

interface AppIconProps {
    app: AppIconId;
    /** True when the icon renders on a dark background. The matching SVG
     *  variant (dark-bg vs light-bg) is picked from the asset registry. */
    dark: boolean;
    size?: number;
    className?: string;
}

/**
 * Branded app logo icon, shown in the tab when a recognized app is running.
 * The SVGs live as files under `src/assets/app-icons/<id>/` and are looked up
 * by id + background darkness — so adding an icon needs no change here (see
 * `lib/appIcon.ts` for the command→id mapping and the asset registry for the
 * SVG file convention).
 *
 * Takes precedence over ShellIcon: when a tab has a running command that maps
 * to a known app, this icon replaces the shell icon.
 */
export default function AppIcon({app, dark, size = 14, className}: AppIconProps) {
    const src = getAppIconSrc(app, dark);
    if (!src) return null; // unknown id — shouldn't happen (getAppIcon filters)
    return (
        <img
            src={src}
            alt=""
            width={size}
            height={size}
            className={className}
            style={{objectFit: "contain"}}
            draggable={false}
        />
    );
}
