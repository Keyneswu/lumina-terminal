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
import {getCurrentWindow} from "@tauri-apps/api/window";
import {
    DRAG_END_EVENT,
    DRAG_HOVER_EVENT,
    DRAG_START_EVENT,
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
     * that window; absent → spawn a new window. Ignored for Settings/About. */
    onTearOff?: (id: string, opts?: {mergeTarget?: string}) => void;
    /** App-owned ref tracking the last hover heartbeat from another window
     * during a drag from this window ({label, time}). dragend reads it, with a
     * freshness check, to pick merge vs. new-window. Passed down so TabBar
     * doesn't re-derive it. */
    mergeTargetRef?: RefObject<{label: string; time: number} | null>;
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
    const { tabs, activeId, onSelect, onClose, onNew, onTearOff, mergeTargetRef, backgroundColor, foregroundColor, dangerColor, collapsed, defaultProfileName, updateVersion, onUpdateClick } = props;
    const t = useI18n();

    // Cleanup function for the document-level drag listeners attached during a
    // drag. Kept in a ref (not a local) so onDragEnd can always reach the
    // latest one even if onDragStart/onDragEnd close over different renders.
    const dragCleanupRef = useRef<(() => void) | null>(null);

    // Sentinel mode: while ANOTHER Lumina window is dragging a tab, THIS window
    // watches its own document for dragenter/leave and reports hover state to
    // the source window (DRAG_HOVER_EVENT). The source then knows — at dragend,
    // without reliable cursor coordinates — whether to merge into us. We only
    // arm this when the drag started elsewhere (sourceLabel !== our label); the
    // source window itself never enters sentinel mode (it tracks its own
    // dragOutsideRef instead). Stands down on DRAG_END_EVENT.
    useEffect(() => {
        let unlistenStart: (() => void) | undefined;
        let unlistenEnd: (() => void) | undefined;
        let cancelled = false;
        // Active sentinel cleanup (document listeners), swapped as drags
        // start/end. Held in a closure-local so the handlers below can disarm.
        let disarm: (() => void) | undefined;
        const myLabel = getCurrentWindow().label;

        const arm = (sourceLabel: string) => {
            // Already armed (nested drag)? Disarm first.
            disarm?.();
            // We report hover via `dragover`, NOT dragenter/dragleave. Reason:
            // under Tauri's webview, dragenter is followed almost immediately
            // by a spurious dragleave (relatedTarget === null) while the cursor
            // is still inside — so a leave-based "I left" signal is unusable.
            // dragover, by contrast, fires continuously (~per animation frame)
            // while the cursor is actually over this document, and stops firing
            // the instant it leaves. So a steady stream of dragover = "cursor
            // is here right now", which is exactly what the source needs at
            // dragend. Throttled to once per 120ms to avoid flooding IPC.
            let lastReport = 0;
            const onDragOver = () => {
                const now = Date.now();
                if (now - lastReport >= 120) {
                    lastReport = now;
                    emitTo(sourceLabel, DRAG_HOVER_EVENT, {label: myLabel}).catch((e) =>
                        info(`Failed to emit hover to ${sourceLabel}: ${e}`).catch(() => {})
                    );
                }
            };
            document.addEventListener("dragover", onDragOver);
            disarm = () => {
                document.removeEventListener("dragover", onDragOver);
            };
            // info (not debug) for now so users can confirm sentinel mode works
            // during testing; demote to debug once merge is verified in the field.
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
                                // effectAllowed + setData are both required for
                                // the browser to actually start a drag; without
                                // them some webviews swallow dragstart.
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", tab.id);
                                // Clear any stale merge target from a previous
                                // drag — only heartbeats during THIS drag count.
                                if (mergeTargetRef) mergeTargetRef.current = null;
                                // If a previous drag's cleanup is still around
                                // (e.g. dragend never fired), clear it first so
                                // we don't stack listeners.
                                dragCleanupRef.current?.();
                                // Record our own dragover as a self-heartbeat in
                                // mergeTargetRef. This is what lets dragend tell
                                // "dropped back on me" (cancel) apart from "dropped
                                // on the desktop" (new window): while the cursor is
                                // over OUR document we keep refreshing the heartbeat
                                // with our own label; other windows refresh it with
                                // theirs; over the desktop nobody does, so the last
                                // heartbeat goes stale. Freshness at dragend then
                                // distinguishes "on some Lumina window" (cancel or
                                // merge) from "off-window" (new window), and the
                                // label distinguishes merge-target from self.
                                const myLabel = getCurrentWindow().label;
                                const onDragOver = () => {
                                    if (mergeTargetRef) {
                                        mergeTargetRef.current = {label: myLabel, time: Date.now()};
                                    }
                                };
                                document.addEventListener("dragover", onDragOver);
                                dragCleanupRef.current = () => {
                                    document.removeEventListener("dragover", onDragOver);
                                };
                                // Broadcast the drag start so OTHER Lumina windows
                                // enter sentinel mode and report hover → we learn
                                // at dragend whether to merge into one of them.
                                info(`dragstart: broadcasting ${DRAG_START_EVENT} sourceLabel=${myLabel}`);
                                emit(DRAG_START_EVENT, {sourceLabel: myLabel}).catch((e) =>
                                    info(`Failed to broadcast ${DRAG_START_EVENT}: ${e}`).catch(() => {})
                                );
                            }}
                            onDragEnd={() => {
                                if (!isTerminalTab) return;
                                // Always remove the document-level listeners
                                // attached in onDragStart, whether or not we
                                // tear off — and tell other windows to stand down.
                                dragCleanupRef.current?.();
                                dragCleanupRef.current = null;
                                emit(DRAG_END_EVENT).catch((e) =>
                                    info(`Failed to broadcast ${DRAG_END_EVENT}: ${e}`).catch(() => {})
                                );
                                if (!onTearOff) return;
                                // Three-way dispatch from the LAST heartbeat:
                                //   - fresh, label = another window → merge into it
                                //   - fresh, label = self             → cancel (dropped on us)
                                //   - stale (no heartbeat for 400ms)  → cursor on desktop → new window
                                // Both other windows (sentinel) and this window (self-
                                // heartbeat in onDragStart) refresh mergeTargetRef while
                                // the cursor is over them, so freshness reliably means
                                // "cursor was on a Lumina window at release". Only a drop
                                // on the desktop leaves every heartbeat stale.
                                const HOVER_FRESH_MS = 400;
                                const now = Date.now();
                                const mt = mergeTargetRef?.current ?? null;
                                const myLabel = getCurrentWindow().label;
                                let action: "merge" | "new" | "cancel";
                                let mergeTarget: string | null = null;
                                if (mt && now - mt.time <= HOVER_FRESH_MS) {
                                    if (mt.label === myLabel) {
                                        action = "cancel";
                                    } else {
                                        action = "merge";
                                        mergeTarget = mt.label;
                                    }
                                } else {
                                    action = "new";
                                }
                                if (mergeTargetRef) mergeTargetRef.current = null;
                                // DIAGNOSTIC: demote once verified.
                                info(`dragend dispatch: action=${action} mergeTarget=${mergeTarget} lastHeartbeatMs=${mt ? now - mt.time : -1} lastLabel=${mt?.label ?? "<none>"} myLabel=${myLabel}`);
                                if (action === "merge" && mergeTarget) {
                                    info(`Drag → merge tab ${tab.id} into ${mergeTarget}`);
                                    onTearOff(tab.id, {mergeTarget});
                                } else if (action === "new") {
                                    info(`Drag → tear off tab ${tab.id} into new window`);
                                    onTearOff(tab.id);
                                }
                                // action === "cancel": no-op.
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
