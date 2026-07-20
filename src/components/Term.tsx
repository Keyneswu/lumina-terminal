import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Terminal} from "@xterm/xterm";
import {listen} from "@tauri-apps/api/event";
import {Channel} from "@tauri-apps/api/core";
import {TerminalProfile, CurrentCommand} from "../types/terminal.ts";
import {FloatingFitAddon} from "../lib/FloatingFitAddon.ts";
import {WebglAddon} from "@xterm/addon-webgl";
import {getCurrentWindow, LogicalSize} from "@tauri-apps/api/window";
import {parseProfilePadding} from "../lib/term.ts";
import {sampleEdgeBackground} from "../lib/edgeBackground.ts";
import {loadBindings} from "../lib/bindings.ts";
import type {Binding} from "../types/config.ts";
import {Actions} from "../types/config.ts";
import {isMacOS} from "../lib/platform.ts";
import {openConfigFile} from "../lib/configFile.ts";
import {useGlobalConfig} from "../hooks/config.tsx";
import {useI18n} from "../hooks/i18n.tsx";
import {useOutputMode} from "../hooks/useOutputMode.ts";
import { info, debug, error } from "@tauri-apps/plugin-log";
import {getCurrentWebview} from "@tauri-apps/api/webview";
import {WebLinksAddon} from "@xterm/addon-web-links";
import {openUrl} from "@tauri-apps/plugin-opener";
import {ImageAddon} from "@xterm/addon-image";
import {SerializeAddon} from "@xterm/addon-serialize";
import {IMAGE_ADDON_SETTINGS} from "../constants.ts";
import {reattachTerminal, resizeTerminal, startTerminal, writeToTerminal} from "../lib/terminalApi.ts";
import {CurrentCommandParser} from "../lib/currentCommand.ts";

let hasAppliedInitialWindowSize = false;

interface TermProps {
    id: string;
    profile: TerminalProfile;
    // Pre-parsed bindings (merged defaults + user overrides), shared from App
    // so every terminal uses the same parsed set instead of re-parsing each.
    bindings: Binding[];
    // Padding offset shared from App (derived from window maximize state +
    // platform), so every terminal shares one source of truth.
    paddingOffset: number;
    isActive?: boolean;
    onClose?: () => void;
    onNewTab?: (profileName?: string) => void;
    onOpenCommandPalette?: () => void;
    onOpenSettings?: () => void;
    onToTab?: (index: number) => void;
    onToggleSidebar?: () => void;
    // Reports the uniform background color sampled from the terminal's outer
    // ring (a fullscreen TUI's own bg), or null when there is none. Only the
    // active tab reports; inactive tabs report null.
    onEdgeBackgroundChange?: (color: string | null) => void;
    // Reports the currently-running command for this terminal, or null when
    // idle at the shell prompt. Drives the small subtitle under the tab title.
    onCommandChange?: (command: CurrentCommand | null) => void;
    // When set, this Term reattaches to an existing live PTY (torn-off-tab
    // window) instead of spawning a new one: it replays `scrollback` into
    // xterm, then calls `reattachTerminal(ptyId, …)` so the running process
    // streams to this window. The `id` prop is ignored for backend calls in
    // this mode — `reattach.ptyId` is the canonical PTY id.
    reattach?: { ptyId: string; scrollback: string };
    // Register a serialize function (captures the xterm buffer for tear-off)
    // with the parent. The parent stores it and calls it right before tearing
    // the tab off. Returns a cleanup that deregisters the function.
    onRegisterSerialize?: (fn: () => string) => () => void;
    // Tear this tab off into its own window. Wired to the `tearOffTab` action.
    onTearOff?: () => void;
}

export default function Term(props : TermProps) {
    const {id, profile, isActive, bindings, paddingOffset} = props;
    const term = useRef<Terminal | null>(null);
    const termRef = useRef<HTMLDivElement>(null);
    const isInitialized = useRef<boolean>(false);
    // SerializeAddon instance (loaded once at init). Used by the parent to
    // capture the buffer when tearing this tab off into a new window.
    const serializeAddonRef = useRef<SerializeAddon | null>(null);
    // FitAddon instance (loaded once at init). Held in a ref so the separate
    // resize-observer effect (which re-runs normally under StrictMode, unlike
    // the one-shot init effect) can call fit() without re-deriving it.
    const fitAddonRef = useRef<FloatingFitAddon | null>(null);
    const padding = useMemo(() => parseProfilePadding(profile, paddingOffset), [profile, paddingOffset]);
    const {config} = useGlobalConfig();
    const t = useI18n();
    const {markInteractive} = useOutputMode(id);
    const [isDragOver, setIsDragOver] = useState(false);
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;

    const getWindowSizeFromRowsAndColumns = useCallback(() => {
        const term = new Terminal({...profile});
        const dummyDiv = document.createElement("div");
        dummyDiv.style.position = "absolute";
        dummyDiv.style.visibility = "hidden"; // 隐形，用户看不到
        dummyDiv.style.top = "-9999px";
        dummyDiv.style.width = "500px";
        dummyDiv.style.height = "500px";
        dummyDiv.style.fontStyle = profile.fontStyle ?? "normal";
        document.body.appendChild(dummyDiv);
        term.open(dummyDiv);
        // @ts-ignore
        if (term._core?._charSizeService) {
            // @ts-ignore
            term._core._charSizeService.measure();
        }
        const renderDimensions = (term as any)._core?._renderService?.dimensions;
        const charSizeService = (term as any)._core?._charSizeService;
        let charWidth = renderDimensions?.actualCellWidth || charSizeService?.width;
        let charHeight = renderDimensions?.actualCellHeight || charSizeService?.height;
        debug(`Char size measured: ${charWidth}x${charHeight}`);
        term.dispose();
        dummyDiv.remove();
        let widthOffset = 0; let heightOffset = 0;
        if (termRef.current) {
            widthOffset = window.innerWidth - termRef.current.clientWidth;
            heightOffset = window.innerHeight - termRef.current.clientHeight;
        }
        const padding = parseProfilePadding(profile, paddingOffset);
        const pixelWidth = Math.floor((profile.cols ?? 80) * charWidth) + widthOffset + padding.left + padding.right;
        const pixelHeight = Math.floor((profile.rows ?? 24) * charHeight) + heightOffset + padding.top + padding.bottom;
        return {width: pixelWidth, height: pixelHeight};
    }, [profile, paddingOffset]);

    const handleActions = (action: Actions, args?: Record<string, string>) => {
        info(`Term action: ${action}${args ? ` args=${JSON.stringify(args)}` : ""}`);
        switch (action) {
            case "closeTab":
                props.onClose?.();
                break;
            case "newTab":
                props.onNewTab?.(args?.profileName);
                break;
            case "openConfigFile":
                openConfigFile().then();
                break;
            case "openCommandPalette":
                props.onOpenCommandPalette?.();
                break;
            case "openSettings":
                props.onOpenSettings?.();
                break;
            case "toggleSidebar":
                props.onToggleSidebar?.();
                break;
            case "toTab":
                if (args?.index !== undefined) {
                    const idx = args.index === "last" ? -1 : parseInt(args.index, 10);
                    if (!isNaN(idx)) props.onToTab?.(idx);
                }
                break;
            case "tearOffTab":
                props.onTearOff?.();
                break;
        }
    };

    // Keep handleActions ref fresh for the bindings callback
    const handleActionsRef = useRef(handleActions);
    handleActionsRef.current = handleActions;

    // Keep onClose ref fresh for the term-exit listener (avoid stale closure)
    const onCloseRef = useRef(props.onClose);
    onCloseRef.current = props.onClose;

    // Keep onCommandChange ref fresh and track the current command.
    const onCommandChangeRef = useRef(props.onCommandChange);
    onCommandChangeRef.current = props.onCommandChange;
    // Last command reported upward. `null` = nothing reported yet / idle.
    const currentCommandRef = useRef<CurrentCommand | null>(null);
    const commandParserRef = useRef<CurrentCommandParser | null>(null);
    // True once the shell has emitted an OSC sequence this session — used to
    // decide whether the backend's process-group fallback should be honored.
    const oscActiveRef = useRef<boolean>(false);

    const reportCommand = useCallback((cmd: CurrentCommand | null) => {
        // Compare structurally (command name + privileged flag) before notifying.
        const prev = currentCommandRef.current;
        const changed =
            prev === null
                ? cmd !== null
                : cmd === null
                    ? true
                    : prev.command !== cmd.command || prev.privileged !== cmd.privileged;
        if (changed) {
            currentCommandRef.current = cmd;
            onCommandChangeRef.current?.(cmd);
        }
    }, []);

    // Drag-and-drop: insert file path into terminal
    const lastDropRef = useRef(0);
    useEffect(() => {
        let unlistenFn: (() => void) | undefined;

        getCurrentWebview().onDragDropEvent((event) => {
            if (!isActiveRef.current) return;

            if (event.payload.type === 'enter' || event.payload.type === 'over') {
                setIsDragOver(true);
            } else if (event.payload.type === 'drop') {
                setIsDragOver(false);
                if (event.payload.paths.length > 0) {
                    markInteractive();
                    const now = Date.now();
                    if (now - lastDropRef.current < 200) return;
                    lastDropRef.current = now;
                    const filePaths = event.payload.paths.map(p =>
                        p.includes(' ') ? `"${p}"` : p
                    ).join(' ');
                    writeToTerminal(id, filePaths + ' ').then();
                }
            } else if (event.payload.type === 'leave') {
                setIsDragOver(false);
            }
        }).then((fn) => {
            unlistenFn = fn;
        }).catch((e) => {
            error(`Failed to attach drag-drop listener for terminal ${id}: ${e}`).catch(() => {});
        });

        return () => {
            unlistenFn?.();
        };
    }, [id]);

    // Initialize terminal
    useEffect(() => {
        if (isInitialized.current) return;
        isInitialized.current = true;

        // Create terminal inside effect so StrictMode remount gets a fresh instance
        // Strip non-xterm properties (fontStyle, padding, name, exePath, etc.) so they
        // don't interfere with xterm's canvas font measurement and rendering.
        const {
            cols: _cols, rows: _rows, webgl: _webgl, padding: _padding,
            themePath: _themePath, theme: _theme, fontStyle: _fontStyle,
            name: _name, exePath: _exePath, cwd: _cwd, default: _default,
            type: _type, ssh: _ssh,
            ...xtermOptions
        } = profile;
        term.current = new Terminal({
            allowProposedApi: true,
            ...xtermOptions,
        });

        // The PTY id used for backend calls. In reattach mode the canonical id
        // is the torn-off tab's original PTY (still alive on the backend); in
        // normal mode it is this tab's own freshly-minted id. Declared up here
        // so onData/onResize/loadBindings all route to the right PTY.
        const ptyId = props.reattach?.ptyId ?? id;

        // Only the main window applies the profile's default rows/cols as an
        // initial OS window size. Torn-off windows keep whatever size the
        // source window handed them (createTearoffWindow), so a tab torn out
        // of a 120x40 window doesn't snap back to 80x24 on mount.
        if (!hasAppliedInitialWindowSize && getCurrentWindow().label === "main") {
            hasAppliedInitialWindowSize = true;
            const windowSize = getWindowSizeFromRowsAndColumns();
            getCurrentWindow().setSize(new LogicalSize(windowSize)).then();
        }

        // profile is already the product of parseProfile(), which resolved
        // themePath into an inline theme and stripped it — no need to re-read.
        if (profile.theme) {
            term.current!.options.theme = profile.theme;
        }

        const webLinksAddon = new WebLinksAddon((event, uri) => {
            if ((event.metaKey && isMacOS()) || event.ctrlKey) {
                openUrl(uri).then();
            }
        });
        term.current.loadAddon(webLinksAddon);

        const imageAddon = new ImageAddon(IMAGE_ADDON_SETTINGS);
        term.current.loadAddon(imageAddon);

        const fitAddon = new FloatingFitAddon();
        term.current.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        if (profile.webgl) {
            try {
                const webglAddon = new WebglAddon();
                term.current.loadAddon(webglAddon);
                debug(`WebGL addon loaded for terminal id=${id}`);
            } catch (e) {
                info(`WebGL addon failed to load, falling back to canvas: ${e}`);
            }
        }

        // SerializeAddon captures the xterm buffer (scrollback + viewport) so a
        // torn-off tab can replay its history in the new window. Loaded for
        // every terminal since any tab can be torn off at any time.
        const serializeAddon = new SerializeAddon();
        term.current.loadAddon(serializeAddon);
        serializeAddonRef.current = serializeAddon;

        if (termRef.current) {
            term.current.open(termRef.current);
            fitAddon.fit();
            debug(`Terminal opened: id=${id}`);
        }

        // Load keybindings right after terminal is ready
        loadBindings(term.current, bindings, (action, args) => {
            handleActionsRef.current(action, args);
        }, config.copyWithCtrl ?? false, (data) => {
            writeToTerminal(ptyId, data).then();
        });
        info(`Bindings loaded for terminal with id ${id}`);

        term.current.onData((data) => {
            writeToTerminal(ptyId, data).then();
            markInteractive();
        });
        term.current.onResize(({cols, rows}) => {
            resizeTerminal(ptyId, cols, rows).then();
            markInteractive();
        });

        // Chunked write: feed pending PTY data to xterm in bounded chunks, with a
        // microtask gap between chunks so the main thread stays responsive during
        // large output (e.g. cat bigfile).
        //
        // The chunk size is a trade-off: too large and one term.write() blocks the
        // main thread for tens of ms while xterm parses thousands of lines (jank);
        // too small and per-write overhead dominates. 16KB stays well under a frame
        // while keeping the number of write() calls (and parse/render passes) low.
        const pendingWrites: string[] = [];
        let writeScheduled = false;
        const CHUNK_SIZE = 1024 * 16;

        function drainWrites(term: Terminal) {
            if (pendingWrites.length === 0) {
                writeScheduled = false;
                return;
            }

            // Build one chunk by consuming items from the front of the queue.
            let chunk = '';
            let taken = 0;
            while (pendingWrites.length > 0 && taken < CHUNK_SIZE) {
                const next = pendingWrites[0];
                const remaining = CHUNK_SIZE - taken;
                if (next.length <= remaining) {
                    chunk += pendingWrites.shift()!;
                    taken += next.length;
                } else {
                    chunk += next.slice(0, remaining);
                    pendingWrites[0] = next.slice(remaining);
                    taken = CHUNK_SIZE;
                }
            }

            // Drive the queue forward via microtask regardless of whether more
            // data remains, instead of waiting for term.write()'s render callback.
            // The callback model serialized writes behind xterm's render time,
            // which throttled throughput to "one chunk per frame" and made large
            // chunks *worse* (longer single write blocking). Microtask draining
            // keeps the queue moving while still yielding between chunks.
            term.write(chunk);
            writeScheduled = pendingWrites.length > 0;
            if (writeScheduled) {
                queueMicrotask(() => drainWrites(term));
            }
        }

        // Lazily create the OSC parser (one per terminal, kept in a ref).
        if (!commandParserRef.current) {
            commandParserRef.current = new CurrentCommandParser();
        }

        // Backend streams PTY output over this Channel (low-overhead,
        // binary-safe UTF-8, with dynamic burst coalescing). The handler does
        // the same OSC parse → pendingWrites → drainWrites the old
        // `term-write` event listener did.
        const outputChannel = new Channel<string>();
        outputChannel.onmessage = (data) => {
            if (term.current && data) {
                // Parse shell-integration sequences BEFORE writing to xterm;
                // xterm drops unknown OSC, so the visible output is unaffected.
                const parsed = commandParserRef.current!.feed(data);
                if (parsed !== null) {
                    oscActiveRef.current = true;
                    reportCommand(
                        parsed === "" ? null : { command: parsed, privileged: false }
                    );
                }
                pendingWrites.push(data);
                if (!writeScheduled) {
                    writeScheduled = true;
                    queueMicrotask(() => drainWrites(term.current!));
                }
            }
        };

        if (props.reattach) {
            // Tear-off window: replay the captured scrollback first so the new
            // xterm shows the history, then swap the backend's output channel
            // to this window's Channel. The PTY process is NOT respawned.
            if (props.reattach.scrollback) {
                term.current.write(props.reattach.scrollback);
            }
            reattachTerminal(ptyId, outputChannel).then(() => {
                info(`Terminal reattached: ptyId=${ptyId} in window for tab ${id}`);
                resizeTerminal(ptyId, term.current!.cols, term.current!.rows).then();
            }).catch((e) => {
                error(`Failed to reattach terminal ptyId=${ptyId}: ${e}`).catch(() => {});
            });
        } else {
            startTerminal(id, profile, outputChannel).then(() => {
                info(`Terminal started: id=${id} profile=${profile.name}`);
                resizeTerminal(id, term.current!.cols, term.current!.rows).then();
            }).catch((e) => {
                error(`Failed to start terminal id=${id} (profile=${profile.name}): ${e}`).catch(() => {});
            });
        }
    }, [id]);

    // Register this terminal's serialize function with the parent so the
    // "tear off tab" command can capture the xterm buffer right before opening
    // the new window. Re-runs only if the parent hands us a new registrar
    // (it won't in practice — App passes a stable callback); the cleanup
    // deregisters so a closed/removed tab's stale fn is never called.
    useEffect(() => {
        if (!props.onRegisterSerialize) return;
        const serialize = () => {
            try {
                return serializeAddonRef.current?.serialize() ?? "";
            } catch (e) {
                error(`Failed to serialize terminal ${id} for tear-off: ${e}`).catch(() => {});
                return "";
            }
        };
        return props.onRegisterSerialize(serialize);
    }, [props.onRegisterSerialize, id]);

    // ResizeObserver: refit the terminal whenever its container changes size.
    // Lives in its own effect (NOT inside the one-shot init effect) so that:
    //   1. React StrictMode's mount→unmount→remount cycle doesn't leave us
    //      with a disconnected observer — this effect has no isInitialized
    //      guard, so it re-runs and re-attaches cleanly on the second mount.
    //   2. Real unmount (tab close / tear-off) disconnects the observer so we
    //      never call fit() on a disposed terminal.
    // The init effect must have run first (it creates the Terminal + addons);
    // we check termRef + fitAddonRef and bail otherwise. Re-running before
    // init completes is harmless — there's just nothing to observe yet.
    useEffect(() => {
        const container = termRef.current;
        const fit = fitAddonRef.current;
        if (!container || !fit) return;
        const observer = new ResizeObserver(() => {
            fit.fit();
        });
        observer.observe(container);
        // Fit once on attach: this catches the case where the OS window was
        // resized (e.g. the initial setSize call) between terminal init and
        // this observer attaching.
        fit.fit();
        return () => observer.disconnect();
    }, [id]);

    // term-command / term-exit event listeners. Lives in its own effect (with
    // a real cleanup) for the same StrictMode + real-unmount reasons as the
    // ResizeObserver above. Critical for tear-off: when a tab is torn off, the
    // source Term unmounts WITHOUT the PTY exiting, so a leaked term-exit
    // listener would later fire onClose on an unmounted component. The cleanup
    // here unregisters both listeners so only the currently-mounted Term (in
    // whichever window owns the PTY now) reacts to events.
    useEffect(() => {
        const ptyId = props.reattach?.ptyId ?? id;
        let unlistenCommand: (() => void) | undefined;
        let unlistenExit: (() => void) | undefined;

        listen<CurrentCommand>(`term-command-${ptyId}`, (event) => {
            if (oscActiveRef.current) return;
            const cmdInfo = event.payload;
            const cmd = (cmdInfo?.command ?? "").trim();
            reportCommand(cmd === "" ? null : { command: cmd, privileged: !!cmdInfo?.privileged });
        }).then((fn) => {
            unlistenCommand = fn;
        }).catch((e) => {
            error(`Failed to listen for term-command-${ptyId}: ${e}`).catch(() => {});
        });

        listen(`term-exit-${ptyId}`, () => {
            info(`Terminal exited: ptyId=${ptyId}`);
            onCloseRef.current?.();
        }).then((fn) => {
            unlistenExit = fn;
        }).catch((e) => {
            error(`Failed to listen for term-exit-${ptyId}: ${e}`).catch(() => {});
        });

        return () => {
            unlistenCommand?.();
            unlistenExit?.();
        };
    }, [id, props.reattach, reportCommand]);

    // Hot-reload keybindings + copyWithCtrl when the config changes (e.g. after the user edits
    // a shortcut in Settings). attachCustomKeyEventHandler replaces the previous handler, so
    // already-open terminals pick up the new bindings live without needing a tab restart.
    useEffect(() => {
        if (!isInitialized.current || !term.current) return;
        loadBindings(term.current, bindings, (action, args) => {
            handleActionsRef.current(action, args);
        }, config.copyWithCtrl ?? false, (data) => {
            writeToTerminal(id, data).then();
        });
        debug(`Bindings hot-reloaded for terminal ${id}`);
    }, [bindings, config.copyWithCtrl, id]);

    // Auto-focus xterm when this tab becomes active
    useEffect(() => {
        if (isActive && term.current) {
            term.current.focus();
        }
    }, [isActive]);

    // Re-focus xterm when the OS window itself regains focus and this tab is
    // the active one — so clicking into the window (or alt-tabbing back) puts
    // keyboard input straight into the terminal without an extra click. Each
    // Term registers its own listener; only the active one's `isActive` gate
    // fires the focus(). Cleanup on unmount.
    useEffect(() => {
        if (!isActive) return;
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        getCurrentWindow().onFocusChanged(({payload: focused}) => {
            if (focused && isActiveRef.current && term.current) {
                term.current.focus();
            }
        }).then((un) => {
            if (cancelled) un();
            else unlisten = un;
        }).catch((e) => {
            error(`Failed to listen for window focus for terminal ${id}: ${e}`).catch(() => {});
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [id, isActive]);

    // Poll the outermost ring of the buffer. When it is a uniform explicit
    // color (a fullscreen TUI's own bg), report it up so the whole app
    // background can follow it, and sync the xterm-owned layers (.xterm and
    // .xterm-viewport, which otherwise paint theme.background over the sub-cell
    // gap to the right/bottom of the canvas). Only the active tab reports;
    // inactive tabs clear it.
    const onEdgeRef = useRef(props.onEdgeBackgroundChange);
    onEdgeRef.current = props.onEdgeBackgroundChange;
    useEffect(() => {
        if (!term.current) return;
        const xtermEl = termRef.current?.querySelector(".xterm") as HTMLElement | null;
        const viewportEl = termRef.current?.querySelector(".xterm-viewport") as HTMLElement | null;

        const apply = (next: string | null) => {
            onEdgeRef.current?.(next);
            // Clearing (empty string) lets the CSS default show through again.
            const value = next ?? "";
            if (xtermEl && xtermEl.style.backgroundColor !== value) {
                xtermEl.style.backgroundColor = value;
            }
            if (viewportEl && viewportEl.style.backgroundColor !== value) {
                viewportEl.style.backgroundColor = value;
            }
        };

        let lastReported: string | null = null;
        const tick = () => {
            if (!term.current) return;
            if (!isActiveRef.current) {
                if (lastReported !== null) {
                    lastReported = null;
                    apply(null);
                }
                return;
            }
            const next = sampleEdgeBackground(term.current);
            if (next !== lastReported) {
                lastReported = next;
                apply(next);
            }
        };
        tick();
        const handle = setInterval(tick, 200);
        return () => {
            clearInterval(handle);
            if (xtermEl) xtermEl.style.backgroundColor = "";
            if (viewportEl) viewportEl.style.backgroundColor = "";
        };
    }, [id]);

    return (
        <div className="w-full h-full overflow-hidden relative" style={{
            paddingLeft: padding.left,
            paddingRight: padding.right,
            paddingTop: padding.top,
            paddingBottom: padding.bottom,
        }} onPointerDown={markInteractive} onWheel={markInteractive}>
            <div ref={termRef} className="w-full h-full overflow-hidden" style={{
                fontStyle: profile.fontStyle ?? "normal",
            }}/>
            {isDragOver && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-500/20 border-2 border-blue-400 border-dashed pointer-events-none">
                    <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-sm">
                        {t["Drop file to insert path"]}
                    </div>
                </div>
            )}
        </div>
    );
}
