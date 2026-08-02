import Term from "./components/Term.tsx";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {TerminalProfile, CurrentCommand} from "./types/terminal.ts";
import {useGlobalConfig} from "./hooks/config.tsx";
import {useI18n} from "./hooks/i18n.tsx";
import WelcomePage from "./pages/WelcomePage.tsx";
import {getCurrentWindow, PhysicalPosition, PhysicalSize} from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar.tsx";
import TabBar, { type TabInfo } from "./components/TabBar.tsx";
import {parseProfile} from "./lib/term.ts";
import {getShellType} from "./lib/shellIcon.ts";
import {killTerminal} from "./lib/terminalApi.ts";
import {visibleRed} from "./lib/color.ts";
import CommandPalette, {CommandAction} from "./components/CommandPalette.tsx";
import {useEffectiveTheme} from "./hooks/useEffectiveTheme.ts";
import {bindingToShortcut, findBinding, parseBindings, useKeyboardBindings, matchBinding} from "./lib/bindings.ts";
import {Actions} from "./types/config.ts";
import {X, PanelLeftClose, PanelLeftOpen, Terminal as TerminalIcon, Monitor, MonitorOff, Settings as SettingsIcon, Info} from "lucide-react";
import SettingsPage from "./pages/SettingsPage.tsx";
import AboutPage from "./pages/AboutPage.tsx";
import {SETTINGS_TAB_ID, ABOUT_TAB_ID} from "./constants.ts";
import { info, debug, error, warn } from "@tauri-apps/plugin-log";
import {usePaddingOffset} from "./hooks/paddingOffset.ts";
import {useMaximized} from "./hooks/maximized.ts";
import {useStartupUpdateCheck} from "./hooks/useStartupUpdateCheck.ts";
import {useUpdater} from "./hooks/useUpdater.ts";
import UpdateModal from "./components/UpdateModal.tsx";
import {emitTo, listen} from "@tauri-apps/api/event";
import {useTearoffSession} from "./hooks/useTearoffSession.ts";
import {useIsWayland} from "./hooks/useIsWayland.ts";
import {
    consumeTearoff,
    createTearoffWindow,
    DRAG_HOVER_EVENT,
    MERGE_ACK_EVENT,
    MERGE_TAB_EVENT,
    newTearoffLabel,
    stashTearoff,
    type TabDragHover,
    type TearoffPayload,
} from "./lib/tearoff.ts";
import {ExternalLink} from "lucide-react";

const OPEN_ABOUT_EVENT = "lumina-open-about";

function InnerApp({isMaximized, paddingOffset}: {isMaximized: boolean, paddingOffset: number}) {
    const {config, updateConfig} = useGlobalConfig();
    const t = useI18n();
    // If this window was spawned as a torn-off tab, `tearoff` carries the
    // stashed payload (profile + PTY id + scrollback) once consumed. `null`
    // = still resolving; `"no"` = this is the main window (or a tear-off
    // window with no payload). Drives initial tab seeding below.
    const tearoff = useTearoffSession();
    // Wayland forbids knowing/setting absolute window position, so the position
    // restore + persist paths are short-circuited there (they'd only ever
    // read and write 0,0). Size is unaffected.
    const isWayland = useIsWayland();
    const [ids, setIds] = useState<string[]>([]);
    const [terminals, setTerminals] = useState<Record<string, TerminalProfile>>({});
    const [currentId, setCurrentId] = useState<string | null>(null);
    // Per-terminal serialize functions (captured by Term on mount). Used to
    // grab the xterm buffer right before tearing a tab off into a new window.
    const serializeFns = useRef<Map<string, () => string>>(new Map());
    // Tabs that arrived via merge-from-another-window and need the reattach
    // render path (replay scrollback, then reattachTerminal instead of spawn).
    // Also seeded by useTearoffSession for a torn-off window's single boot tab.
    // Stored as state (not ref) because adding one must trigger a re-render so
    // the new Term mounts with its reattach prop.
    const [reattachTabs, setReattachTabs] = useState<Record<string, {ptyId: string; scrollback: string}>>({});
    // During a tab drag from THIS window, holds the last hover report (self
    // heartbeat or foreign DRAG_HOVER). Fresh = cursor still over a Lumina
    // window. `merge: true` only when over another window's sidebar — content
    // drops cancel so we never tear off / merge onto a terminal surface.
    const mergeTargetRef = useRef<TabDragHover | null>(null);
    // Last-known screen position (CSS px = logical px under Tauri) of the
    // cursor during a tab drag from THIS window, refreshed by our own dragover.
    // Used to position a torn-off window at the release point. Wayland forbids
    // reading the global cursor, so we can only track it while it's over a
    // webview — the last in-window position is the best approximation for a
    // drop on the desktop (the tab is "thrown out" anyway, so small error is
    // fine). Held at the App layer so TabBar reads + App's tearOffTab consumes.
    const dragScreenPosRef = useRef<{x: number; y: number} | null>(null);
    // True while the startup geometry restore is applying setPosition/setSize.
    // The onMoved/onResized listeners skip while this is set, so restoring the
    // saved geometry doesn't get written straight back (feedback loop). Cleared
    // on a short timeout after the restore calls return.
    const applyingRestoredGeometryRef = useRef(false);
    // Guards the restore effect to run at most once per window lifetime.
    const restoredGeometryOnceRef = useRef(false);
    // Per-terminal currently-running command (subtitle under the tab title).
    // null/undefined = idle at the shell prompt; an object = a command is running.
    const [commands, setCommands] = useState<Record<string, CurrentCommand | null>>({});
    const currentProfile = useMemo(() => {
        if (currentId) {
            return terminals[currentId] ?? null;
        } else {
            return null;
        }
    }, [currentId, terminals]);
    const {theme: effectiveTheme, bg: effectiveBg, fg: effectiveFg, isSpread, setEdgeBg} = useEffectiveTheme(currentProfile, currentId);
    // Danger color for the privileged-command indicator: follows the theme's
    // ANSI reds so it stays visible even on red-dominant backgrounds.
    const dangerColor = useMemo(
        () => visibleRed(effectiveTheme?.red, effectiveTheme?.brightRed, effectiveBg),
        [effectiveTheme?.red, effectiveTheme?.brightRed, effectiveBg],
    );
    const tabBarVisible = config.showTabBar ?? false;
    const parsedBindings = useMemo(() => parseBindings(config.bindings), [config.bindings]);
    // Check for updates once on startup unless the user opted out. Runs after
    // config loads; only checks (never auto-installs).
    useStartupUpdateCheck(config.autoUpdateOnStartup !== false);
    // Single updater instance for the whole app — owned here so the sidebar
    // banner, the update modal, and the About page all share one state machine.
    const updater = useUpdater();
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    const defaultProfile = useMemo(() => {
        return config.profiles.find(p => p.default) || config.profiles[0];
    }, [config.profiles]);
    // Resolve a profile by name, falling back to the default profile. Centralized
    // so newTab handlers (command palette, keybinding, drag) all share one path.
    const findProfile = useCallback((name?: string) => {
        if (name) {
            const found = config.profiles.find(p => p.name === name);
            if (found) return found;
        }
        return defaultProfile;
    }, [config.profiles, defaultProfile]);
    const isInitialized = useRef<boolean>(false);
    const closeOnLastTabRef = useRef(config.closeWindowOnLastTab);
    closeOnLastTabRef.current = config.closeWindowOnLastTab;

    // Refs to avoid stale closures in closeTerminal (called from term-exit listeners)
    const idsRef = useRef(ids);
    idsRef.current = ids;
    const currentIdRef = useRef(currentId);
    currentIdRef.current = currentId;
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    const newTerminal = useCallback(async (profile: TerminalProfile) => {
        const id = crypto.randomUUID();
        const p = await parseProfile(profile, config.globalProfile);
        setTerminals((prevState) => {
            let newState = {...prevState};
            newState[id] = p;
            return newState;
        });
        setIds((prevState) => [...prevState, id]);
        setCurrentId(id);
        info(`New terminal: profile=${profile.name} id=${id}`);
    }, [config]);

    const closeTerminal = (id: string) => {
        debug(`closeTerminal called for id=${id}`);
        const currentIds = idsRef.current;
        const currentActiveId = currentIdRef.current;

        // Settings tab: no PTY process, just remove from list
        if (id === SETTINGS_TAB_ID || id === ABOUT_TAB_ID) {
            info("Closing settings/about tab");
            const newIds = currentIds.filter((i) => i !== id);
            let newCurrentId = currentActiveId;
            if (currentActiveId === id) {
                if (newIds.length > 0) {
                    newCurrentId = newIds[newIds.length - 1];
                } else if (closeOnLastTabRef.current !== false) {
                    info("No tabs left, closing window");
                    getCurrentWindow().close().catch((e) =>
                        error(`Failed to close window on last tab: ${e}`)
                    );
                    return;
                }
            }
            setIds(newIds);
            setCurrentId(newCurrentId);
            return;
        }
        // Kill the PTY process on the backend
        killTerminal(id).catch((e) =>
            error(`Failed to kill terminal: ${e}`)
        );

        // Compute new ID list
        const newIds = currentIds.filter((i) => i !== id);

        // Determine which tab should become active
        let newCurrentId = currentActiveId;
        if (currentActiveId === id) {
            if (newIds.length > 0) {
                const idx = currentIds.indexOf(id);
                newCurrentId = newIds[Math.min(idx, newIds.length - 1)];
            } else if (closeOnLastTabRef.current !== false) {
                // No tabs left, close the window (default behavior)
                info("No tabs left after close, closing window");
                getCurrentWindow().close().catch((e) =>
                    error(`Failed to close window on last tab: ${e}`)
                );
                return;
            }
            // If closeWindowOnLastTab is false, fall through to clear state
        }

        setTerminals((prevState) => {
            const newState = {...prevState};
            delete newState[id];
            return newState;
        });
        setIds(newIds);
        setCurrentId(newCurrentId);
        info(`Terminal closed: id=${id}, remaining=${newIds.length}`);
    };

    const switchTab = (id: string) => {
        debug(`Switch tab to ${id}`);
        setCurrentId(id);
    };

    /**
     * Tear a terminal tab off — either into a NEW window (default) or by
     * MERGING into another existing Lumina window (`opts.mergeTarget` = that
     * window's label). Captures scrollback, stashes the payload, then:
     *   - new window: spawns a hidden WebviewWindow and detaches the tab here.
     *   - merge: emits MERGE_TAB to the target, waits for MERGE_ACK, then
     *     detaches. The PTY is never killed — the target reattaches to it.
     * Any failure is logged; the tab stays put if stashing or (for merge) the
     * ack times out.
     */
    const tearOffTab = useCallback(async (id: string, opts?: {mergeTarget?: string; position?: {x: number; y: number}}) => {
        const profile = terminals[id];
        if (!profile) {
            warn(`tearOffTab: no profile for id=${id} (not a terminal tab)`);
            return;
        }
        const scrollback = serializeFns.current.get(id)?.() ?? "";

        // Shared detach: remove the tab from this window without killing the
        // PTY. Index-aware active-tab fallback mirrors closeTerminal.
        const detachTab = () => {
            const currentIds = idsRef.current;
            const currentActiveId = currentIdRef.current;
            const newIds = currentIds.filter((i) => i !== id);
            let newCurrentId = currentActiveId;
            if (currentActiveId === id) {
                if (newIds.length > 0) {
                    const idx = currentIds.indexOf(id);
                    newCurrentId = newIds[Math.min(idx, newIds.length - 1)];
                } else if (closeOnLastTabRef.current !== false) {
                    info("No tabs left after detach, closing source window");
                    getCurrentWindow().close().catch((e) =>
                        error(`Failed to close source window after detach: ${e}`)
                    );
                }
            }
            setTerminals((prevState) => {
                const newState = {...prevState};
                delete newState[id];
                return newState;
            });
            setIds(newIds);
            setCurrentId(newCurrentId);
            setReattachTabs((prev) => {
                if (!(id in prev)) return prev;
                const next = {...prev};
                delete next[id];
                return next;
            });
            info(`Tab id=${id} detached from source window (PTY kept alive)`);
        };

        const target = opts?.mergeTarget;
        if (target) {
            // ---- Merge into an existing window ----
            // Use a fresh stash key (NOT a window label) since the target
            // window already has its own label.
            const stashKey = newTearoffLabel();
            info(`Merging tab id=${id} into window ${target} (stashKey=${stashKey})`);
            try {
                await stashTearoff(stashKey, {profile, ptyId: id, scrollback});
            } catch (e) {
                error(`tearOffTab merge: stash failed for ${stashKey}, aborting: ${e}`).catch(() => {});
                return;
            }
            const sourceLabel = getCurrentWindow().label;
            // Correct ordering for a reliable ack handshake:
            //   1. await listen() so the handler is registered before we emit
            //      (a fast target would otherwise ack before we listen).
            //   2. emitTo target.
            //   3. race the ack against a 3s timeout.
            //   4. unlisten (whether acked or timed out).
            let ackResolve!: (v: boolean) => void;
            const ackPromise = new Promise<boolean>((resolve) => {
                ackResolve = resolve;
            });
            let ackUnlisten: (() => void) | undefined;
            try {
                ackUnlisten = await listen(MERGE_ACK_EVENT, (event) => {
                    const payload = event.payload as {stashKey?: string} | null;
                    if (payload?.stashKey === stashKey) {
                        info(`Merge acked by ${target}`);
                        ackResolve(true);
                    }
                });
            } catch (e) {
                error(`Failed to listen for ${MERGE_ACK_EVENT}: ${e}`).catch(() => {});
                return;
            }
            emitTo(target, MERGE_TAB_EVENT, {stashKey, sourceLabel}).catch((e) =>
                error(`Failed to emit ${MERGE_TAB_EVENT} to ${target}: ${e}`).catch(() => {})
            );
            const acked = await Promise.race([
                ackPromise,
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
            ]);
            ackUnlisten();
            if (!acked) {
                warn(`Merge ack timed out for ${stashKey} into ${target}; keeping tab`);
                return;
            }
            detachTab();
            return;
        }

        // ---- New window (existing path) ----
        const label = newTearoffLabel();
        info(`Tearing off tab id=${id} into new window ${label}`);
        try {
            await stashTearoff(label, {profile, ptyId: id, scrollback});
        } catch (e) {
            error(`tearOffTab: stash failed for ${label}, aborting: ${e}`).catch(() => {});
            return;
        }
        const sourceInnerSize = {
            width: window.innerWidth,
            height: window.innerHeight,
        };
        try {
            await createTearoffWindow(label, sourceInnerSize, opts?.position);
        } catch (e) {
            error(`tearOffTab: window creation failed for ${label}: ${e}`).catch(() => {});
            // Leave the tab in place — the new window never came up.
            return;
        }
        detachTab();
    }, [terminals]);

    const toTab = useCallback((index: number) => {
        if (ids.length === 0) return;
        const idx = index < 0 ? ids.length - 1 : Math.min(index, ids.length - 1);
        setCurrentId(ids[idx]);
    }, [ids]);

    const openSettings = useCallback(() => {
        info("Opening settings");
        if (ids.includes(SETTINGS_TAB_ID)) {
            setCurrentId(SETTINGS_TAB_ID);
            return;
        }
        setIds((prevState) => [...prevState, SETTINGS_TAB_ID]);
        setCurrentId(SETTINGS_TAB_ID);
    }, [ids]);

    const openAbout = useCallback(() => {
        info("Opening about");
        setIds((prevState) => {
            if (prevState.includes(ABOUT_TAB_ID)) return prevState;
            return [...prevState, ABOUT_TAB_ID];
        });
        setCurrentId(ABOUT_TAB_ID);
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;

        listen(OPEN_ABOUT_EVENT, () => {
            openAbout();
        }).then((cleanup) => {
            if (cancelled) {
                cleanup();
            } else {
                unlisten = cleanup;
            }
        }).catch((e) => {
            error(`Failed to listen for About menu event: ${e}`);
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [openAbout]);

    // Merge receiver: accept a tab dragged in from another Lumina window.
    // Runs in EVERY window (main + tear-off). Payload: {stashKey, sourceLabel}.
    // We consume the stashed {profile, ptyId, scrollback}, seed a reattach tab,
    // and ack so the source can remove the tab from its state. The PTY is not
    // killed on the source's side — our Term reattaches to the live process.
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;

        listen(MERGE_TAB_EVENT, async (event) => {
            const payload = event.payload as {stashKey?: string; sourceLabel?: string} | null;
            const stashKey = payload?.stashKey;
            const sourceLabel = payload?.sourceLabel ?? "unknown";
            if (!stashKey) {
                warn(`Merge received with no stashKey from ${sourceLabel}`);
                return;
            }
            let loaded: TearoffPayload | null = null;
            try {
                loaded = await consumeTearoff(stashKey);
            } catch (e) {
                error(`Merge consume failed for ${stashKey}: ${e}`).catch(() => {});
            }
            // Always ack so the source isn't stuck waiting for the 3s timeout.
            // (Even on failure — the source keeps its tab; nothing is lost.)
            emitTo(sourceLabel, MERGE_ACK_EVENT, {stashKey}).catch((e) =>
                error(`Failed to ack merge ${stashKey} to ${sourceLabel}: ${e}`).catch(() => {})
            );
            if (!loaded) {
                error(`Merge received but stash empty for ${stashKey}; tab not seeded`).catch(() => {});
                return;
            }
            const {ptyId, profile: seedProfile, scrollback} = loaded;
            info(`Merge tab received: ptyId=${ptyId} from ${sourceLabel}`);
            setTerminals((s) => ({...s, [ptyId]: seedProfile}));
            setIds((s) => (s.includes(ptyId) ? s : [...s, ptyId]));
            setReattachTabs((s) => ({...s, [ptyId]: {ptyId, scrollback}}));
            setCurrentId(ptyId);
        }).then((cleanup) => {
            if (cancelled) {
                cleanup();
            } else {
                unlisten = cleanup;
            }
        }).catch((e) => {
            error(`Failed to listen for ${MERGE_TAB_EVENT}: ${e}`);
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    // Track which other window the cursor is hovering during a drag FROM this
    // window. TabBar's dragend reads mergeTargetRef to pick merge vs. cancel
    // vs. new-window (`merge` is true only over a foreign sidebar).
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        listen<{label?: string; merge?: boolean}>(DRAG_HOVER_EVENT, (event) => {
            const label = event.payload?.label;
            if (label) {
                mergeTargetRef.current = {
                    label,
                    time: Date.now(),
                    // Default false so a stale payload shape never merges by accident.
                    merge: event.payload?.merge === true,
                };
            }
            // Ignore empty reports — the heartbeat model only relies on the
            // freshness of positive reports, so explicit leaves aren't needed.
        }).then((cleanup) => {
            if (cancelled) {
                cleanup();
            } else {
                unlisten = cleanup;
            }
        }).catch((e) => {
            error(`Failed to listen for ${DRAG_HOVER_EVENT}: ${e}`);
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    // Initial tab seeding. Three cases:
    //   - tear-off window (tearoff carries payload): seed ONE reattach-mode
    //     terminal from the stashed profile + PTY id. Do NOT call startTerminal
    //     — the PTY is alive on the backend; Term's reattach path handles it.
    //   - main window with configured profiles: open the default profile.
    //   - main window with no profiles yet: WelcomePage handles onboarding.
    // `tearoff === null` means the session probe is still pending — wait.
    useEffect(() => {
        if (isInitialized.current) return;
        if (tearoff === null) return; // tear-off probe in flight
        if (tearoff === "no") {
            if (config.profiles.length && ids.length === 0) {
                isInitialized.current = true;
                getCurrentWindow().setResizable(true).catch((e) =>
                    error(`Failed to set window resizable: ${e}`)
                );
                newTerminal(defaultProfile).catch((e) =>
                    error(`Failed to create initial terminal: ${e}`)
                );
            }
            return;
        }
        // Tear-off window: seed exactly one tab whose id is the live PTY id.
        // The profile in the payload is already resolved (post parseProfile),
        // so we insert it directly without re-merging globalProfile.
        isInitialized.current = true;
        const {ptyId, profile: seedProfile} = tearoff.payload;
        getCurrentWindow().setResizable(true).catch((e) =>
            error(`Failed to set tear-off window resizable: ${e}`)
        );
        setTerminals({[ptyId]: seedProfile});
        setIds([ptyId]);
        setCurrentId(ptyId);
        setReattachTabs({[ptyId]: {ptyId, scrollback: tearoff.payload.scrollback}});
        info(`Tear-off window seeded with ptyId=${ptyId}`);
    }, [config, tearoff, defaultProfile]);

    // ---- Main-window geometry: restore on startup, persist on move/resize ----
    // Only the main window participates — tear-off windows are positioned by
    // createTearoffWindow and are transient, so remembering them is pointless.
    const isMainWindow = getCurrentWindow().label === "main";

    // One-shot restore: when config has loaded and either toggle is on, apply
    // the saved position/size before the user sees the window (the show() in
    // hooks/config.tsx races with this; setPosition/setSize are fast and idempotent).
    // Gated by restoredGeometryOnceRef so toggling the settings later does NOT
    // re-jump the window — restore is strictly a startup behavior.
    useEffect(() => {
        if (!isMainWindow) return;
        if (restoredGeometryOnceRef.current) return;
        // Wait until config has actually loaded (it loads in GlobalConfigProvider;
        // we can't read isLoading here, but config fields beyond DEFAULT_CONFIG
        // only become meaningful once the store read resolves. The config object
        // identity changes on load, so depending on `config` is sufficient.)
        restoredGeometryOnceRef.current = true;

        const wantPos = !isWayland && config.rememberWindowPosition && config.rememberedWindowPosition;
        const wantSize = config.rememberWindowSize && config.rememberedWindowSize;
        if (!wantPos && !wantSize) return;

        applyingRestoredGeometryRef.current = true;
        const win = getCurrentWindow();
        const tasks: Promise<unknown>[] = [];
        if (wantPos) {
            const {x, y} = config.rememberedWindowPosition!;
            tasks.push(win.setPosition(new PhysicalPosition(x, y)));
            info(`Restoring main window position: ${x},${y}`);
        }
        if (wantSize) {
            const {width, height} = config.rememberedWindowSize!;
            tasks.push(win.setSize(new PhysicalSize(width, height)));
            info(`Restoring main window size: ${width}x${height}`);
        }
        Promise.all(tasks).catch((e) =>
            error(`Failed to restore main window geometry: ${e}`).catch(() => {})
        ).finally(() => {
            // Release the feedback-lock after the OS has settled the move/resize
            // events our calls produced. 200ms is generous for compositor dispatch.
            setTimeout(() => {
                applyingRestoredGeometryRef.current = false;
            }, 200);
        });
    }, [config, isMainWindow, isWayland]);

    // Runtime persistence: while either toggle is on, write position/size back
    // to config on move/resize. Skips writes during the startup restore
    // (applyingRestoredGeometryRef) and when the value hasn't changed (avoid
    // spurious writes + secondary feedback). Re-arms only when the toggles
    // flip — the last-known geometry is read via refs so a write doesn't re-arm
    // (which would churn listeners on every move tick).
    const lastPosRef = useRef(config.rememberedWindowPosition);
    lastPosRef.current = config.rememberedWindowPosition;
    const lastSizeRef = useRef(config.rememberedWindowSize);
    lastSizeRef.current = config.rememberedWindowSize;
    useEffect(() => {
        if (!isMainWindow) return;
        // Position is untrackable on Wayland (onMoved yields 0,0), so never
        // arm the move listener there — otherwise it'd persist garbage.
        const rememberPos = !isWayland && config.rememberWindowPosition;
        const rememberSize = config.rememberWindowSize;
        if (!rememberPos && !rememberSize) return;

        const win = getCurrentWindow();
        let unlistenMoved: (() => void) | undefined;
        let unlistenResized: (() => void) | undefined;
        let cancelled = false;

        if (rememberPos) {
            win.onMoved(({payload}) => {
                if (applyingRestoredGeometryRef.current) return;
                const next = {x: payload.x, y: payload.y};
                const prev = lastPosRef.current;
                if (prev && prev.x === next.x && prev.y === next.y) return;
                updateConfig({rememberedWindowPosition: next});
                debug(`Persisted main window position: ${next.x},${next.y}`);
            }).then((un) => {
                if (cancelled) un();
                else unlistenMoved = un;
            }).catch((e) =>
                error(`Failed to listen for window move: ${e}`).catch(() => {})
            );
        }
        if (rememberSize) {
            win.onResized(({payload}) => {
                if (applyingRestoredGeometryRef.current) return;
                const next = {width: payload.width, height: payload.height};
                const prev = lastSizeRef.current;
                if (prev && prev.width === next.width && prev.height === next.height) return;
                updateConfig({rememberedWindowSize: next});
                debug(`Persisted main window size: ${next.width}x${next.height}`);
            }).then((un) => {
                if (cancelled) un();
                else unlistenResized = un;
            }).catch((e) =>
                error(`Failed to listen for window resize: ${e}`).catch(() => {})
            );
        }

        return () => {
            cancelled = true;
            unlistenMoved?.();
            unlistenResized?.();
        };
    }, [config.rememberWindowPosition, config.rememberWindowSize, isMainWindow, isWayland, updateConfig]);

    // Keyboard bindings for non-terminal tabs (Settings, About, etc.)
    const isNonTerminalTab = currentId === SETTINGS_TAB_ID || currentId === ABOUT_TAB_ID;
    const handleNonTerminalAction = useCallback((action: Actions, args?: Record<string, string>) => {
        info(`Keybinding action from non-terminal tab: ${action}`);
        switch (action) {
            case "closeTab":
                if (currentId) closeTerminal(currentId);
                break;
            case "newTab": {
                newTerminal(findProfile(args?.profileName));
                break;
            }
            case "openSettings":
                openSettings();
                break;
            case "openCommandPalette":
                setIsCommandPaletteOpen(true);
                break;
            case "toggleSidebar":
                updateConfig({ showTabBar: !tabBarVisible });
                break;
            case "toTab":
                if (args?.index !== undefined) {
                    const idx = args.index === "last" ? -1 : parseInt(args.index, 10);
                    if (!isNaN(idx)) toTab(idx);
                }
                break;
            case "tearOffTab":
                // Only meaningful for terminal tabs; the command palette only
                // shows this action when currentId is a real terminal, and
                // Term handles the keybinding via its own onTearOff. No-op here.
                break;
        }
    }, [currentId, findProfile, openSettings, toTab, tabBarVisible, updateConfig]);
    useKeyboardBindings(parsedBindings, handleNonTerminalAction, isNonTerminalTab);

    // Global: prevent browser defaults for configured shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (matchBinding(e, parsedBindings)) {
                e.preventDefault();
            }
            // Prevent Ctrl+Shift+C from opening DevTools "Inspect Element"
            if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "c") {
                e.preventDefault();
            }
        };

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    }, [parsedBindings]);

    // Build command palette actions
    const commandActions: CommandAction[] = useMemo(() => {
        const actions: CommandAction[] = [];
        if (!config.profiles.length) return actions;

        // New terminal with each profile
        const newLabel = t["New {name}"];
        const newDesc = t['Create a new terminal with profile "{name}"'];
        for (const profile of config.profiles) {
            const isDefault = profile.default;
            const profileArgs = isDefault ? undefined : { profileName: profile.name };
            const profileBinding = findBinding(parsedBindings, "newTab", profileArgs);
            actions.push({
                id: `new-terminal-${profile.name}`,
                label: newLabel.replace("{name}", profile.name),
                description: newDesc.replace("{name}", profile.name),
                icon: <TerminalIcon size={18} />,
                shortcut: profileBinding ? bindingToShortcut(profileBinding) : undefined,
                category: t["Terminal"],
                keywords: ["new", "terminal", "新建", profile.name],
                onSelect: () => newTerminal(profile),
            });
        }

        // Close current tab
        if (currentId) {
            const closeBinding = findBinding(parsedBindings, "closeTab");
            actions.push({
                id: "close-tab",
                label: t["Close Current Tab"],
                description: t["Close the current terminal tab"],
                icon: <X size={18} />,
                shortcut: closeBinding ? bindingToShortcut(closeBinding) : undefined,
                category: t["Terminal"],
                keywords: ["close", "关闭", "tab", "kill"],
                onSelect: () => closeTerminal(currentId),
            });

            // Tear off current tab into its own window (terminal tabs only —
            // currentId is a real terminal here because Settings/About never
            // match the `id in terminals` filter below).
            if (currentId in terminals) {
                const tearoffBinding = findBinding(parsedBindings, "tearOffTab");
                actions.push({
                    id: "tear-off-tab",
                    label: t["Tear Off Tab"],
                    description: t["Tear off tab into a new window"],
                    icon: <ExternalLink size={18} />,
                    shortcut: tearoffBinding ? bindingToShortcut(tearoffBinding) : undefined,
                    category: t["Terminal"],
                    keywords: ["tear off", "window", "窗口", "拖出", "分离", "detach", "pop out"],
                    onSelect: () => tearOffTab(currentId),
                });
            }
        }

        // Toggle tab bar
        actions.push({
            id: "toggle-tab-bar",
            label: tabBarVisible ? t["Hide Tab Bar"] : t["Show Tab Bar"],
            description: tabBarVisible
                ? t["Hide the sidebar tab bar"]
                : t["Show the sidebar tab bar"],
            icon: tabBarVisible ? (
                <PanelLeftClose size={18} />
            ) : (
                <PanelLeftOpen size={18} />
            ),
            category: t["View"],
            keywords: ["tab bar", "标签栏", "sidebar", "toggle", "hide", "show", "隐藏", "显示"],
            onSelect: () => updateConfig({ showTabBar: !tabBarVisible }),
        });

        // Toggle close window on last tab
        const closeOnLast = config.closeWindowOnLastTab !== false;
        actions.push({
            id: "toggle-close-window-last-tab",
            label: closeOnLast ? t["Keep Window on Last Tab Closed"] : t["Close Window on Last Tab Closed"],
            description: closeOnLast
                ? t["Keep the window open after closing the last tab"]
                : t["Close the window after closing the last tab"],
            icon: closeOnLast ? (
                <MonitorOff size={18} />
            ) : (
                <Monitor size={18} />
            ),
            category: t["View"],
            keywords: ["window", "窗口", "close", "关闭", "last", "最后", "tab", "exit"],
            onSelect: () => updateConfig({ closeWindowOnLastTab: !closeOnLast }),
        });

        // Open settings
        const settingsBinding = findBinding(parsedBindings, "openSettings");
        actions.push({
            id: "open-settings",
            label: t["Settings"],
            description: t["Open Settings"],
            icon: <SettingsIcon size={18} />,
            shortcut: settingsBinding ? bindingToShortcut(settingsBinding) : undefined,
            category: t["Settings"],
            keywords: ["settings", "设置", "config", "配置", "preferences", "options"],
            onSelect: () => {
                openSettings();
            },
        });

        // Open about
        actions.push({
            id: "open-about",
            label: t["About"],
            description: t["About"],
            icon: <Info size={18} />,
            category: t["Settings"],
            keywords: ["about", "关于", "info", "version", "版本"],
            onSelect: () => {
                openAbout();
            },
        });

        return actions;
    }, [config.profiles, currentId, terminals, tabBarVisible, config.closeWindowOnLastTab, parsedBindings, t, openSettings, openAbout, tearOffTab]);

    // Close command palette when Escape is pressed while it's open
    const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
        setIsCommandPaletteOpen(open);
    }, []);

    if (config.profiles.length) {
        const tabs = ids
            .map((id) => {
                if (id === SETTINGS_TAB_ID) {
                    return { id, name: t["Settings"] };
                }
                if (id === ABOUT_TAB_ID) {
                    return { id, name: t["About"] };
                }
                if (id in terminals) {
                    const cmd = commands[id];
                    return {
                        id,
                        name: terminals[id].name,
                        subtitle: cmd ? cmd.command : undefined,
                        commandPrivileged: cmd ? cmd.privileged : false,
                        shellType: getShellType(terminals[id]),
                    };
                }
                return null;
            })
            .filter(Boolean) as TabInfo[];

        return (
            <div
                className="w-full h-full overflow-hidden flex flex-row"
                style={{background: effectiveBg ?? "black"}}
            >
                <CommandPalette
                    isOpen={isCommandPaletteOpen}
                    onOpenChange={handleCommandPaletteOpenChange}
                    actions={commandActions}
                />
                <UpdateModal
                    isOpen={isUpdateModalOpen}
                    onOpenChange={setIsUpdateModalOpen}
                    info={updater.info}
                    status={updater.status}
                    progress={updater.progress}
                    error={updater.error}
                    onInstall={updater.install}
                    theme={effectiveTheme}
                />
                <TabBar
                    tabs={tabs}
                    activeId={currentId}
                    onSelect={switchTab}
                    onClose={closeTerminal}
                    onNew={() => newTerminal(defaultProfile)}
                    onTearOff={tearOffTab}
                    mergeTargetRef={mergeTargetRef}
                    dragScreenPosRef={dragScreenPosRef}
                    backgroundColor={effectiveBg ?? "#000000"}
                    foregroundColor={effectiveFg ?? "#ffffff"}
                    dangerColor={dangerColor}
                    bgSpread={isSpread}
                    collapsed={!tabBarVisible}
                    defaultProfileName={defaultProfile?.name}
                    updateVersion={updater.status === "available" && updater.info ? updater.info.version : null}
                    onUpdateClick={() => setIsUpdateModalOpen(true)}
                />
                <div className="flex-1 flex flex-col min-w-0">
                    <TitleBar
                        theme={effectiveTheme}
                        bgSpread={isSpread}
                        tabBarVisible={tabBarVisible}
                        onToggleTabBar={() => updateConfig({ showTabBar: !tabBarVisible })}
                        onOpenSettings={openSettings}
                        isMaximized={isMaximized}
                    />
                    <div className="flex-1 relative overflow-hidden">
                        {currentId === SETTINGS_TAB_ID && (
                            <div
                                className="absolute inset-0"
                                style={{ zIndex: 1 }}
                            >
                                <SettingsPage theme={effectiveTheme} openAbout={openAbout} />
                            </div>
                        )}
                        {currentId === ABOUT_TAB_ID && (
                            <div
                                className="absolute inset-0"
                                style={{ zIndex: 1 }}
                            >
                                <AboutPage
                                    theme={effectiveTheme}
                                    updater={updater}
                                    onShowUpdateModal={() => setIsUpdateModalOpen(true)}
                                />
                            </div>
                        )}
                        {ids.filter((id) => id in terminals).map((id) => {
                            // A tab reattaches (replay scrollback + swap the PTY's
                            // output channel instead of spawning) when it is a
                            // torn-off window's boot tab OR a tab merged in from
                            // another window — both register in `reattachTabs`.
                            const reattachEntry = reattachTabs[id];
                            const reattach = reattachEntry
                                ? {ptyId: reattachEntry.ptyId, scrollback: reattachEntry.scrollback}
                                : undefined;
                            return (
                            <div
                                key={id}
                                className="absolute inset-0"
                                style={{
                                    zIndex: id === currentId ? 1 : 0,
                                    pointerEvents: id === currentId ? "auto" : "none",
                                    opacity: id === currentId ? 1 : 0,
                                }}
                            >
                                <Term
                                    id={id}
                                    profile={terminals[id]}
                                    paddingOffset={paddingOffset}
                                    isActive={id === currentId}
                                    bindings={parsedBindings}
                                    reattach={reattach}
                                    onClose={() => closeTerminal(id)}
                                    onNewTab={(profileName?: string) => {
                                        newTerminal(findProfile(profileName));
                                    }}
                                    onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                                    onOpenSettings={openSettings}
                                    onToTab={toTab}
                                    onToggleSidebar={() => updateConfig({ showTabBar: !tabBarVisible })}
                                    onTearOff={() => tearOffTab(id)}
                                    onRegisterSerialize={(fn) => {
                                        serializeFns.current.set(id, fn);
                                        return () => {
                                            // Only delete if it's still ours (avoids wiping a
                                            // re-registered fn after a rapid remount).
                                            if (serializeFns.current.get(id) === fn) {
                                                serializeFns.current.delete(id);
                                            }
                                        };
                                    }}
                                    onEdgeBackgroundChange={(color) => {
                                        // Only the active tab's report is honored;
                                        // inactive tabs report null and are ignored.
                                        if (id === currentId) setEdgeBg(color);
                                    }}
                                    onCommandChange={(cmd) => {
                                        setCommands((prev) =>
                                            prev[id] === cmd ? prev : { ...prev, [id]: cmd }
                                        );
                                    }}
                                />
                            </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    } else {
        return (
            <WelcomePage/>
        );
    }
}

function App() {
    const isMaximized = useMaximized();
    const paddingOffset = usePaddingOffset(isMaximized);

    return (
        <div
            className="w-screen h-screen overflow-hidden relative"
            style={{
                padding: paddingOffset,
                background: "transparent",
            }}
        >
            <div className={`w-full h-full overflow-hidden ${isMaximized ? "" : "rounded-lg"}`}>
                <InnerApp isMaximized={isMaximized} paddingOffset={paddingOffset}/>
            </div>
        </div>
    );
}

export default App;
