import type {CSSProperties, ReactNode} from "react";

/**
 * Settings panel shell — the page-frame shared by every settings sub-page.
 *
 * Replaces the `flex flex-col h-full` + `flex-1 overflow-y-auto pb-4 pl-1 pr-6`
 * + `shrink-0 border-t` triplet that was duplicated verbatim (with minor
 * spacing drift) across GeneralSettings, GlobalProfileSettings,
 * ProfileSettings, BindingsSettings, and DeveloperSettings. The shell renders
 * the scroll region and optionally a footer slot; panels plug their content
 * and footer in as children.
 */
export interface SettingsShellProps {
    /** Scrollable body content (fields, toggles, etc.). */
    children: ReactNode;
    /** Fixed bottom footer (typically `<SaveFooter>`). Omit for panels with no
     *  save affordance (e.g. DeveloperSettings). */
    footer?: ReactNode;
    /** Horizontal padding on the right; mirrors the original `pr-6`. */
    bodyClassName?: string;
    style?: CSSProperties;
}

export default function SettingsShell({
    children,
    footer,
    bodyClassName = "",
    style,
}: SettingsShellProps) {
    return (
        <div className="flex flex-col h-full" style={style}>
            <div className={`flex-1 overflow-y-auto pb-4 pl-1 pr-6 w-full ${bodyClassName}`}>
                {children}
            </div>
            {footer && <>{footer}</>}
        </div>
    );
}
