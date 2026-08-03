import {LucideMaximize, LucideMinimize, LucideMinus, LucideX, PanelLeftClose, PanelLeftOpen, Search, Settings} from "lucide-react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {ITheme} from "@xterm/xterm";
import {isMacOS} from "../lib/platform.ts";
import {useSurfaceColors} from "../hooks/surfaceColors.ts";
import {useGlass} from "../hooks/useGlass.ts";
import {glassSurface} from "../lib/glass.ts";
import { info } from "@tauri-apps/plugin-log";
import IconButton from "./ui/IconButton.tsx";
import {CHROME_TITLE_BAR_HEIGHT} from "../constants.ts";

interface WindowControlProps {
    size: number;
    isMaximized: boolean;
    hoverOverlay: string;
    activeOverlay: string;
    /** Brand-tinted wash for the close button on hover. */
    closeHover: string;
    fg: string;
}

function WindowControl({size, isMaximized, hoverOverlay, activeOverlay, closeHover, fg}: WindowControlProps) {
    const handleMinimize = () => {
        info("Window minimized");
        getCurrentWindow().minimize().then();
    }

    const handleMaximize = () => {
        info("Window maximized");
        getCurrentWindow().maximize().then();
    }

    const handleUnmaximize = () => {
        info("Window unmaximized");
        getCurrentWindow().unmaximize().then();
    }

    const handleClose = () => {
        info("Window close requested");
        getCurrentWindow().close().then();
    }

    return (
        <div className="flex flex-row justify-end items-center" style={{height: size}}>
            <IconButton
                size={size}
                hoverOverlay={hoverOverlay}
                activeOverlay={activeOverlay}
                style={{color: fg, borderRadius: 0}}
                onClick={handleMinimize}
            >
                <LucideMinus size={16}/>
            </IconButton>
            {isMaximized ? (
                <IconButton
                    size={size}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, borderRadius: 0}}
                    onClick={handleUnmaximize}
                >
                    <LucideMinimize size={16}/>
                </IconButton>
            ) : (
                <IconButton
                    size={size}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, borderRadius: 0}}
                    onClick={handleMaximize}
                >
                    <LucideMaximize size={16}/>
                </IconButton>
            )}
            <IconButton
                size={size}
                hoverOverlay={closeHover}
                activeOverlay={closeHover}
                style={{color: fg, borderRadius: 0}}
                onClick={handleClose}
            >
                <LucideX size={16}/>
            </IconButton>
        </div>
    );
}

export default function TitleBar({
    theme,
    bgSpread,
    tabBarVisible,
    onToggleTabBar,
    onOpenCommandPalette,
    onOpenSettings,
    isMaximized,
} : {
    theme: ITheme | null,
    /** True when the bg comes from a fullscreen TUI's spread edge color —
     *  the glass drops its tint so the TUI color passes through unmodified. */
    bgSpread?: boolean,
    tabBarVisible: boolean,
    onToggleTabBar: () => void,
    onOpenCommandPalette: () => void,
    onOpenSettings: () => void,
    isMaximized: boolean,
}) {
    const bg = theme?.background ?? "black";
    const fg = theme?.foreground ?? "white";

    const { hoverOverlay, activeOverlay } = useSurfaceColors(bg);
    const {supportsGlass} = useGlass();
    const glass = glassSurface(bg, supportsGlass, {blurPx: 14, spread: bgSpread});
    const macOSTitleButtonMarginLeft = tabBarVisible ? 8 : 88;
    const size = CHROME_TITLE_BAR_HEIGHT;
    // Brand cinnabar wash for the close button hover — replaces the isolated
    // `text-red-500` literal with the brand accent so window controls feel
    // part of the app identity.
    const closeHover = "rgba(255,70,31,0.18)";

    if (isMacOS()) {
        return (
            <div
                data-tauri-drag-region
                className="w-full flex flex-row items-center select-none shrink-0"
                style={{
                    height: size,
                    ...glass,
                    color: fg,
                }}
            >
                <IconButton
                    size={28}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, marginLeft: macOSTitleButtonMarginLeft}}
                    onClick={() => { info(`Tab bar ${tabBarVisible ? "hidden" : "shown"}`); onToggleTabBar(); }}
                >
                    {tabBarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                </IconButton>
                <div className="flex-1" data-tauri-drag-region />
                <IconButton
                    size={28}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg}}
                    onClick={() => { info("Command palette opened from title bar"); onOpenCommandPalette(); }}
                    aria-label="Command Palette"
                >
                    <Search size={18} />
                </IconButton>
                <IconButton
                    size={28}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, marginRight: 8}}
                    onClick={() => { info("Settings opened from title bar"); onOpenSettings(); }}
                >
                    <Settings size={18} />
                </IconButton>
            </div>
        );
    }

    return (
        <div
            data-tauri-drag-region
            className="w-full flex flex-row items-center justify-between select-none shrink-0"
            style={{
                height: size,
                ...glass,
                color: fg,
            }}
        >
            <IconButton
                size={size}
                hoverOverlay={hoverOverlay}
                activeOverlay={activeOverlay}
                style={{color: fg, borderRadius: 0}}
                onClick={() => { info(`Tab bar ${tabBarVisible ? "hidden" : "shown"}`); onToggleTabBar(); }}
            >
                {tabBarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </IconButton>
            <div className="flex-1" data-tauri-drag-region />
            <div className="flex flex-row items-center h-full">
                <IconButton
                    size={size}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, borderRadius: 0}}
                    onClick={() => { info("Command palette opened from title bar"); onOpenCommandPalette(); }}
                    aria-label="Command Palette"
                >
                    <Search size={18} />
                </IconButton>
                <IconButton
                    size={size}
                    hoverOverlay={hoverOverlay}
                    activeOverlay={activeOverlay}
                    style={{color: fg, borderRadius: 0}}
                    onClick={() => { info("Settings opened from title bar"); onOpenSettings(); }}
                >
                    <Settings size={18} />
                </IconButton>
                <WindowControl size={size} isMaximized={isMaximized} hoverOverlay={hoverOverlay} activeOverlay={activeOverlay} closeHover={closeHover} fg={fg} />
            </div>
        </div>
    );
}
