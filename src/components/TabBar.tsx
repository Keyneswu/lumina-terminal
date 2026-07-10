import { Plus, X, Settings, Info, Sparkles } from "lucide-react";
import Icon from "../assets/icon.svg";
import { isMacOS } from "../lib/platform.ts";
import { SETTINGS_TAB_ID, ABOUT_TAB_ID } from "../constants.ts";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import {useI18n} from "../hooks/i18n.tsx";
import ShellIcon from "./ShellIcon.tsx";
import {ShellType} from "../lib/shellIcon.ts";

export interface TabInfo {
    id: string;
    name: string;
    /** Optional small subtitle shown under the title (e.g. running command). */
    subtitle?: string;
    /** When true, the running command is a privileged/elevated operation
     * (sudo/su/doas/pkexec or root); a red dot is shown before it. */
    commandPrivileged?: boolean;
    /** Shell category used to pick the leading tab icon. Falls back to the
     * generic terminal icon when absent. Ignored for Settings/About tabs. */
    shellType?: ShellType;
}

interface TabBarProps {
    tabs: TabInfo[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
    backgroundColor: string;
    foregroundColor: string;
    /** Theme-aware red used for danger indicators (privileged-command dot). */
    dangerColor: string;
    collapsed: boolean;
    defaultProfileName?: string;
    /** When set, an update is available — show a banner above "New Tab". */
    updateVersion?: string | null;
    onUpdateClick?: () => void;
}

export default function TabBar(props: TabBarProps) {
    const { tabs, activeId, onSelect, onClose, onNew, backgroundColor, foregroundColor, dangerColor, collapsed, defaultProfileName, updateVersion, onUpdateClick } = props;
    const t = useI18n();

    const colors = useSurfaceColors(backgroundColor);

    const borderStyle = collapsed ? "none" : `1px solid ${colors.borderColor}`;

    return (
        <div
            className="flex flex-col h-full select-none transition-all duration-300 ease-in-out overflow-hidden"
            style={{
                width: collapsed ? 0 : 180,
                minWidth: collapsed ? 0 : 180,
                background: backgroundColor,
            }}
        >
            <div
                data-tauri-drag-region
                className="shrink-0 px-3 py-2 border-b"
                style={{
                    borderColor: colors.borderColor,
                    color: foregroundColor,
                }}
            >
                <div className="flex flex-row items-center gap-1.5 h-5" data-tauri-drag-region>
                    {!isMacOS() && (
                        <>
                            <img
                                src={Icon}
                                alt=""
                                className="h-5 w-5 pointer-events-none"
                            />
                            <span className="text-sm font-medium truncate leading-tight translate-y-px">
                                Lumina
                            </span>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden" data-tauri-drag-region style={{
                borderRight: borderStyle,
            }}>
                {tabs.map((tab) => {
                    const isActive = tab.id === activeId;
                    return (
                        <div
                            key={tab.id}
                            className="flex flex-row items-center justify-between px-3 py-2.5 cursor-pointer group transition-colors"
                            style={{
                                background: isActive ? colors.activeOverlay : "transparent",
                            }}
                            onClick={() => onSelect(tab.id)}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = colors.hoverOverlay;
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = "transparent";
                                }
                            }}
                            title={tab.name}
                        >
                            <div className="flex flex-col items-start flex-1 w-[70%] overflow-hidden">
                                <div className="flex items-start gap-2 w-full">
                                    {tab.id === SETTINGS_TAB_ID && (
                                        <Settings size={14} className="shrink-0 mt-0.5" />
                                    )}
                                    {tab.id === ABOUT_TAB_ID && (
                                        <Info size={14} className="shrink-0 mt-0.5" />
                                    )}
                                    {tab.id !== SETTINGS_TAB_ID && tab.id !== ABOUT_TAB_ID && (
                                        <ShellIcon
                                            shell={tab.shellType ?? "default"}
                                            size={14}
                                            className="shrink-0 mt-0.5"
                                        />
                                    )}
                                    <div className="flex flex-col min-w-0">
                                    <span
                                        className="text-sm truncate leading-tight"
                                        style={{
                                            color: isActive ? foregroundColor : colors.inactiveText,
                                        }}
                                    >
                                        {tab.name}
                                    </span>
                                    </div>
                                </div>
                                {tab.subtitle && (
                                    <div
                                        className="text-xs leading-tight flex items-center gap-1.5 min-w-0 overflow-hidden max-w-full"
                                        style={{
                                            color: colors.inactiveText,
                                            opacity: 0.6,
                                        }}
                                    >
                                        {tab.commandPrivileged && (
                                            <span
                                                className="inline-block w-2 h-2 rounded-full shrink-0 translate-y-0.5"
                                                style={{ backgroundColor: dangerColor }}
                                                title="Privileged / elevated command"
                                            />
                                        )}
                                        <span className="truncate min-w-0 w-full">{tab.subtitle}</span>
                                    </div>
                                )}
                            </div>
                            <button
                                className="opacity-0 group-hover:opacity-100 rounded p-0.5 shrink-0 transition-all ml-1"
                                style={{
                                    color: isActive ? foregroundColor : colors.inactiveText,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose(tab.id);
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = colors.activeOverlay;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "transparent";
                                }}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div
                className="shrink-0"
                style={{
                    borderRight: borderStyle,
                }}
            >
                {/* Update-available banner: shows above "New Tab" when an update
                    is available. Hidden when the sidebar is collapsed (no room).
                    The background borrows the app icon's blue→purple gradient
                    (#8CD5FF → #A668C3, see src/assets/icon.svg) as a subtle brand
                    accent so it stands out from the neutral tab chrome. */}
                {!collapsed && updateVersion && (
                    <div
                        style={{
                            // Static brand gradient (blue→purple from the app icon)
                            // lives on this wrapper. The hover highlight is layered ON
                            // TOP by the inner button, so it stays visible and smooth.
                            // Opacity is high enough that the button's white wash
                            // (0.5 → 0.3 on hover) reads as a clear brightness shift.
                            background:
                                "linear-gradient(135deg, rgba(140,213,255,0.55), rgba(166,104,195,0.55))",
                        }}
                    >
                        <button
                            className="flex flex-row items-center gap-2 w-full px-3 py-2 cursor-pointer transition-color duration-200 bg-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.3)]"
                            style={{
                                color: foregroundColor,
                            }}
                            onClick={onUpdateClick}
                            title={t["New version available: v{version}"].replace("{version}", updateVersion)}
                        >
                            <Sparkles size={14} className="shrink-0" style={{ color: "#A668C3" }} />
                            <span className="text-xs truncate">
                                {t["New version available: v{version}"].replace("{version}", updateVersion)}
                            </span>
                        </button>
                    </div>
                )}

                <button
                    className="flex flex-row items-center gap-2 w-full px-3 py-2.5 transition-colors cursor-pointer border-t"
                    style={{
                        color: colors.inactiveText,
                        borderColor: colors.borderColor,
                    }}
                    onClick={onNew}
                    onMouseEnter={(e) => (e.currentTarget.style.background = colors.hoverOverlay)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                    <Plus size={16} />
                    <div className="flex flex-col w-full justify-start items-start">
                        <span className="text-sm">{t["New Tab"]}</span>
                        {defaultProfileName && (
                            <div
                                className="text-xs truncate"
                                style={{ color: colors.inactiveText, opacity: 0.5 }}
                            >
                                {defaultProfileName}
                            </div>
                        )}
                    </div>
                </button>
            </div>
        </div>
    );
}
