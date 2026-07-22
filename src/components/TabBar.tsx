import {useEffect, useRef, type RefObject} from "react";
import { Plus, X, Settings, Info, Sparkles } from "lucide-react";
import Icon from "../assets/icon.svg";
import { isMacOS } from "../lib/platform.ts";
import { SETTINGS_TAB_ID, ABOUT_TAB_ID } from "../constants.ts";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import {useI18n} from "../hooks/i18n.tsx";
import ShellIcon from "./ShellIcon.tsx";
import {ShellType} from "../lib/shellIcon.ts";
import {info} from "@tauri-apps/plugin-log";
import {emit, emitTo, listen} from "@tauri-apps/api/event";
import {cursorPosition, getCurrentWindow} from "@tauri-apps/api/window";
import {
    DRAG_END_EVENT,
    DRAG_HOVER_EVENT,
    DRAG_START_EVENT,
    TAB_DRAG_MIME,
    type TabDragHover,
} from "../lib/tearoff.ts";

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
    /** Called when the user drags a terminal tab out of the window and
     * releases it. `opts.mergeTarget` (another window's label) → merge into
     * that window; `opts.position` (screen CSS px) → place a new window's
     * top-left there; absent → spawn a new window at the OS default. Ignored
     * for Settings/About. */
    onTearOff?: (id: string, opts?: {mergeTarget?: string; position?: {x: number; y: number}}) => void;
    /** App-owned ref tracking the last hover heartbeat during a drag from
     * this window. Foreign windows set `merge: true` only over their sidebar;
     * content drops set `merge: false` (cancel). Passed down so TabBar
     * doesn't re-derive it. */
    mergeTargetRef?: RefObject<TabDragHover | null>;
    /** App-owned ref where the last in-window cursor screen position (CSS px)
     * during a drag is recorded. dragend reads it to position a torn-off window
     * at the release point. Passed down so TabBar doesn't re-derive it. */
    dragScreenPosRef?: RefObject<{x: number; y: number} | null>;
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

/**
 * Full-window transparent layer so HTML5 `dragover` keeps firing over xterm's
 * canvas/WebGL (which otherwise swallows the event → stale heartbeat → false
 * "tear off onto desktop"). Removed when the drag ends.
 */
function mountTabDragOverlay(onDragOver: (ev: DragEvent) => void): () => void {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-lumina-tab-drag-overlay", "");
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        // Above the terminal surface; below native OS UI.
        zIndex: "2147483646",
        // Keep the drag image visible; we only need hit-testing.
        background: "transparent",
    });
    const handler = (ev: DragEvent) => {
        // Required for continuous dragover across the webview (incl. canvas).
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        onDragOver(ev);
    };
    overlay.addEventListener("dragover", handler);
    document.body.appendChild(overlay);
    return () => {
        overlay.removeEventListener("dragover", handler);
        overlay.remove();
    };
}

export default function TabBar(props: TabBarProps) {
    const { tabs, activeId, onSelect, onClose, onNew, onTearOff, mergeTargetRef, dragScreenPosRef, backgroundColor, foregroundColor, dangerColor, collapsed, defaultProfileName, updateVersion, onUpdateClick } = props;
    const t = useI18n();

    // Cleanup for the overlay + listeners attached during a drag we started.
    // Kept in a ref so onDragEnd always reaches the latest cleanup across renders.
    const dragCleanupRef = useRef<(() => void) | null>(null);
    // Sidebar root — sentinel uses its bounding rect to decide merge vs cancel.
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    // Sentinel mode: while ANOTHER Lumina window is dragging a tab, THIS window
    // mounts a full-window overlay and reports hover via DRAG_HOVER_EVENT.
    // `merge: true` only when the cursor is over our sidebar; over terminal /
    // title bar / settings we report `merge: false` so the source cancels
    // instead of merging or spawning a window on top of our content.
    // Armed only when the drag started elsewhere; stands down on DRAG_END_EVENT.
    useEffect(() => {
        let unlistenStart: (() => void) | undefined;
        let unlistenEnd: (() => void) | undefined;
        let cancelled = false;
        let disarm: (() => void) | undefined;
        const myLabel = getCurrentWindow().label;

        const arm = (sourceLabel: string) => {
            disarm?.();
            let lastReport = 0;
            const removeOverlay = mountTabDragOverlay((ev) => {
                const now = Date.now();
                if (now - lastReport < 120) return;
                lastReport = now;
                const rect = sidebarRef.current?.getBoundingClientRect();
                // Collapsed sidebar (width 0) never accepts merge.
                const overSidebar = !!rect
                    && rect.width > 0
                    && ev.clientX >= rect.left
                    && ev.clientX <= rect.right
                    && ev.clientY >= rect.top
                    && ev.clientY <= rect.bottom;
                emitTo(sourceLabel, DRAG_HOVER_EVENT, {label: myLabel, merge: overSidebar}).catch((e) =>
                    info(`Failed to emit hover to ${sourceLabel}: ${e}`).catch(() => {})
                );
            });
            disarm = removeOverlay;
            info(`Sentinel armed for source ${sourceLabel}`);
        };

        listen<{sourceLabel: string}>(DRAG_START_EVENT, (event) => {
            const sourceLabel = event.payload?.sourceLabel;
            if (!sourceLabel || sourceLabel === myLabel) return; // source is us
            arm(sourceLabel);
        }).then((un) => {
            if (cancelled) un();
            else unlistenStart = un;
        }).catch((e) => {
            info(`Failed to listen for ${DRAG_START_EVENT}: ${e}`).catch(() => {});
        });

        listen(DRAG_END_EVENT, () => {
            disarm?.();
            disarm = undefined;
        }).then((un) => {
            if (cancelled) un();
            else unlistenEnd = un;
        }).catch((e) => {
            info(`Failed to listen for ${DRAG_END_EVENT}: ${e}`).catch(() => {});
        });

        return () => {
            cancelled = true;
            disarm?.();
            unlistenStart?.();
            unlistenEnd?.();
        };
    }, []);

    const colors = useSurfaceColors(backgroundColor);

    const borderStyle = collapsed ? "none" : `1px solid ${colors.borderColor}`;

    return (
        <div
            ref={sidebarRef}
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
                    // Only real terminal tabs are draggable for tear-off;
                    // Settings/About have no standalone-window semantics.
                    const isTerminalTab =
                        tab.id !== SETTINGS_TAB_ID && tab.id !== ABOUT_TAB_ID;
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
                            draggable={isTerminalTab}
                            onDragStart={(e) => {
                                if (!isTerminalTab) return;
                                // effectAllowed + setData are required for the
                                // browser to start a drag. Use a proprietary MIME
                                // only — `text/plain` makes macOS Finder drop a
                                // .textClipping on the Desktop and lets text
                                // fields treat the gesture as copy/paste.
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
                                // Clear any stale merge target from a previous
                                // drag — only heartbeats during THIS drag count.
                                if (mergeTargetRef) mergeTargetRef.current = null;
                                if (dragScreenPosRef) dragScreenPosRef.current = null;
                                dragCleanupRef.current?.();
                                // Document dragover (with preventDefault) still
                                // refreshes the self-heartbeat over non-canvas
                                // chrome. Over xterm/WebGL it is unreliable on
                                // macOS — dragend uses screenX/Y + cursorPosition.
                                const myLabel = getCurrentWindow().label;
                                const onDragOver = (ev: DragEvent) => {
                                    ev.preventDefault();
                                    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
                                    if (mergeTargetRef) {
                                        mergeTargetRef.current = {
                                            label: myLabel,
                                            time: Date.now(),
                                            merge: false,
                                        };
                                    }
                                    if (dragScreenPosRef) {
                                        dragScreenPosRef.current = {x: ev.screenX, y: ev.screenY};
                                    }
                                };
                                document.addEventListener("dragover", onDragOver);
                                dragCleanupRef.current = () => {
                                    document.removeEventListener("dragover", onDragOver);
                                };
                                info(`dragstart: broadcasting ${DRAG_START_EVENT} sourceLabel=${myLabel}`);
                                emit(DRAG_START_EVENT, {sourceLabel: myLabel}).catch((err) =>
                                    info(`Failed to broadcast ${DRAG_START_EVENT}: ${err}`).catch(() => {})
                                );
                            }}
                            onDragEnd={(e) => {
                                if (!isTerminalTab) return;
                                dragCleanupRef.current?.();
                                dragCleanupRef.current = null;
                                emit(DRAG_END_EVENT).catch((err) =>
                                    info(`Failed to broadcast ${DRAG_END_EVENT}: ${err}`).catch(() => {})
                                );
                                if (!onTearOff) return;
                                // Capture release coords sync from the DragEvent
                                // (always present, unlike mid-drag dragover which
                                // dies over xterm on macOS WebKit).
                                const endScreen = {x: e.screenX, y: e.screenY};
                                // Prefer DragEvent.screenX/Y for "still over us":
                                // during an HTML5 drag on macOS, Tauri's
                                // cursorPosition() often still reports a point
                                // inside the source window even after release on
                                // the desktop — that falsely cancelled every tear-off.
                                const endInsideSelf =
                                    endScreen.x >= window.screenX
                                    && endScreen.x < window.screenX + window.outerWidth
                                    && endScreen.y >= window.screenY
                                    && endScreen.y < window.screenY + window.outerHeight;
                                void (async () => {
                                    const HOVER_FRESH_MS = 400;
                                    const now = Date.now();
                                    const mt = mergeTargetRef?.current ?? null;
                                    const myLabel = getCurrentWindow().label;
                                    let action: "merge" | "new" | "cancel";
                                    let mergeTarget: string | null = null;
                                    if (mt && now - mt.time <= HOVER_FRESH_MS) {
                                        if (mt.label === myLabel || !mt.merge) {
                                            action = "cancel";
                                        } else {
                                            action = "merge";
                                            mergeTarget = mt.label;
                                        }
                                    } else {
                                        action = "new";
                                    }
                                    if (mergeTargetRef) mergeTargetRef.current = null;
                                    if (dragScreenPosRef) dragScreenPosRef.current = null;

                                    // Stale heartbeat + release still over us →
                                    // cancel (do not spawn on top of ourselves).
                                    if (action === "new" && endInsideSelf) {
                                        action = "cancel";
                                        info(`dragend release still inside window → cancel`);
                                    }

                                    // Place the new window at the release point.
                                    // Prefer Tauri cursor (physical→logical) when
                                    // available; otherwise DragEvent.screenX/Y.
                                    let dropPos = endScreen;
                                    if (action === "new") {
                                        try {
                                            const win = getCurrentWindow();
                                            const [cursor, factor] = await Promise.all([
                                                cursorPosition(),
                                                win.scaleFactor(),
                                            ]);
                                            dropPos = {
                                                x: cursor.x / factor,
                                                y: cursor.y / factor,
                                            };
                                        } catch (err) {
                                            info(`dragend cursorPosition failed, using screenX/Y: ${err}`).catch(() => {});
                                        }
                                    }

                                    info(`dragend dispatch: action=${action} mergeTarget=${mergeTarget} lastHeartbeatMs=${mt ? now - mt.time : -1} lastLabel=${mt?.label ?? "<none>"} merge=${mt?.merge ?? false} myLabel=${myLabel} dropPos=${dropPos.x},${dropPos.y} endInsideSelf=${endInsideSelf}`);
                                    if (action === "merge" && mergeTarget) {
                                        info(`Drag → merge tab ${tab.id} into ${mergeTarget}`);
                                        onTearOff(tab.id, {mergeTarget});
                                    } else if (action === "new") {
                                        info(`Drag → tear off tab ${tab.id} into new window at ${dropPos.x},${dropPos.y}`);
                                        onTearOff(tab.id, {position: dropPos});
                                    }
                                })();
                            }}
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
                                // draggable={false} so a press-drag starting on the
                                // close button doesn't initiate the parent tab's
                                // HTML5 tear-off drag — a click (no movement) still
                                // closes normally via the handler below.
                                draggable={false}
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
                    The background borrows the app icon's cinnabar→lavender gradient
                    (#FF461F → #A892C7, see src/assets/icon.svg) as a subtle brand
                    accent so it stands out from the neutral tab chrome. */}
                {!collapsed && updateVersion && (
                    <div
                        style={{
                            // Static brand gradient (cinnabar→lavender from the app icon)
                            // lives on this wrapper. The hover highlight is layered ON
                            // TOP by the inner button, so it stays visible and smooth.
                            // Opacity is high enough that the button's white wash
                            // (0.5 → 0.3 on hover) reads as a clear brightness shift.
                            background:
                                "linear-gradient(135deg, rgba(255,70,31,0.55), rgba(168,146,199,0.55))",
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
                            <Sparkles size={14} className="shrink-0" style={{ color: "#A892C7" }} />
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
