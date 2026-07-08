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
import { info, debug } from "@tauri-apps/plugin-log";
import {getCurrentWebview} from "@tauri-apps/api/webview";
import {WebLinksAddon} from "@xterm/addon-web-links";
import {openUrl} from "@tauri-apps/plugin-opener";
import {ImageAddon} from "@xterm/addon-image";
import {IMAGE_ADDON_SETTINGS} from "../constants.ts";
import {resizeTerminal, startTerminal, writeToTerminal} from "../lib/terminalApi.ts";
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
}

export default function Term(props : TermProps) {
    const {id, profile, isActive, bindings, paddingOffset} = props;
    const term = useRef<Terminal | null>(null);
    const termRef = useRef<HTMLDivElement>(null);
    const isInitialized = useRef<boolean>(false);
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

        let observer: ResizeObserver | undefined;

        if (!hasAppliedInitialWindowSize) {
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

        if (profile.webgl) {
            try {
                const webglAddon = new WebglAddon();
                term.current.loadAddon(webglAddon);
                debug(`WebGL addon loaded for terminal id=${id}`);
            } catch (e) {
                info(`WebGL addon failed to load, falling back to canvas: ${e}`);
            }
        }

        if (termRef.current) {
            term.current.open(termRef.current);
            fitAddon.fit();
            debug(`Terminal opened: id=${id}`);
        }

        // Load keybindings right after terminal is ready
        loadBindings(term.current, bindings, (action, args) => {
            handleActionsRef.current(action, args);
        }, config.copyWithCtrl ?? false, (data) => {
            writeToTerminal(id, data).then();
        });
        info(`Bindings loaded for terminal with id ${id}`);

        term.current.onData((data) => {
            writeToTerminal(id, data).then();
            markInteractive();
        });
        term.current.onResize(({cols, rows}) => {
            resizeTerminal(id, cols, rows).then();
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

        startTerminal(id, profile, outputChannel).then(() => {
            info(`Terminal started: id=${id} profile=${profile.name}`);
            resizeTerminal(id, term.current!.cols, term.current!.rows).then();
        });

        // Backend fallback: reports the foreground process-group command
        // (from /proc on Linux, ps on macOS) as { command, privileged }. Only
        // honored when the shell is NOT emitting OSC sequences — once OSC takes
        // over, it is authoritative (OSC cannot currently report privilege).
        listen<CurrentCommand>(`term-command-${id}`, (event) => {
            if (oscActiveRef.current) return;
            const info = event.payload;
            const cmd = (info?.command ?? "").trim();
            reportCommand(cmd === "" ? null : { command: cmd, privileged: !!info?.privileged });
        });

        listen(`term-exit-${id}`, () => {
            info(`Terminal exited: id=${id}`);
            onCloseRef.current?.();
        });

        const handleResize = () => {
            fitAddon.fit();
        };
        observer = new ResizeObserver(handleResize);
        if (termRef.current) {
            observer.observe(termRef.current);
        }
    }, [id]);

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
