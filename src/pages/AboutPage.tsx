import {useEffect, useMemo, useState} from "react";
import { ITheme } from "@xterm/xterm";
import { useI18n } from "../hooks/i18n.tsx";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import { useUpdater } from "../hooks/useUpdater.ts";
import iconSvg from "../assets/icon.svg";
import readmeRaw from "../../README.md?raw";
import {invoke} from "@tauri-apps/api/core";
import {getVersion} from "@tauri-apps/api/app";
import {Button} from "@heroui/react";
import {
	AlertCircle,
	CheckCircle2,
	Download,
	LoaderCircle,
	RefreshCw,
} from "lucide-react";

// Inline GitHub mark SVG; inherits text color via currentColor.
function GithubMark({ size = 14 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="select-none"
        >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    );
}

interface TechItem {
    name: string;
    url: string;
}

function parseTechStack(readme: string): TechItem[] {
    // Match the "Technology Used" section
    const sectionRegex = /^## Technology Used\s*$[\s\S]*?(?=^## |\Z)/m;
    const section = readme.match(sectionRegex);
    if (!section) return [];

    // Parse markdown list items: * [Name](url)
    const items: TechItem[] = [];
    const itemRegex = /^\*\s+\[(.+?)]\((.+?)\)/gm;
    let match;
    while ((match = itemRegex.exec(section[0])) !== null) {
        items.push({ name: match[1], url: match[2] });
    }
    return items;
}

export default function AboutPage({ theme }: { theme: ITheme | null }) {
    const t = useI18n();
    const bg = theme?.background ?? "#000000";
    const fg = theme?.foreground ?? "#ffffff";
    const colors = useSurfaceColors(bg);

    const technologies = useMemo(() => parseTechStack(readmeRaw), []);
    const [commitHash, setCommitHash] = useState<string>("");
    const [version, setVersion] = useState<string>("");

    // Updater state. useUpdater seeds from the startup-check cache, so if an
    // update was found at boot this already shows "available".
    const updater = useUpdater();
    const [showNotes, setShowNotes] = useState(false);

    useEffect(() => {
        invoke<string>("get_commit_hash").then((hash) => {
            setCommitHash(hash);
        });
        getVersion().then((version) => {
            setVersion(version);
        });
    }, []);

    return (
        <div
            className="flex flex-col items-center h-full overflow-y-auto px-6 py-8"
            style={{ background: bg, color: fg }}
        >
            <div className="flex flex-col items-center gap-6 max-w-sm w-full">
                <img
                    src={iconSvg}
                    alt="Lumina Terminal"
                    className="w-24 h-24 select-none pointer-events-none"
                />

                <h1 className="text-xl font-semibold select-none">Lumina Terminal</h1>

                <div className="flex flex-col gap-3 w-full text-sm">
                    {/* Version */}
                    <div
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["Version"]}</span>
                        <span style={{ color: fg }}>
                            {version} ({commitHash})
                        </span>
                    </div>

                    {/* Updates */}
                    <div
                        className="flex flex-col gap-2 py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-muted">{t["Updates"]}</span>
                            <div className="flex items-center" style={{ color: fg }}>
                                {/* Status text (always present) */}
                                {updater.status === "checking" ? (
                                    <span className="flex items-center gap-1.5 text-muted">
                                        <LoaderCircle size={14} className="animate-spin" />
                                        {t["Checking for updates..."]}
                                    </span>
                                ) : updater.status === "upToDate" ? (
                                    <span className="flex items-center gap-1.5" style={{ color: "#22c55e" }}>
                                        <CheckCircle2 size={14} />
                                        {t["You're up to date"]}
                                    </span>
                                ) : updater.status === "error" ? (
                                    <span className="flex items-center gap-1.5" style={{ color: "#ef4444" }}>
                                        <AlertCircle size={14} />
                                        {t["Update check failed"]}
                                    </span>
                                ) : (
                                    <span className="text-muted">
                                        {t["Check for Updates"]}
                                    </span>
                                )}

                                {/* Compact refresh/retry icon button — shown in every
                                    non-busy state so the user can re-check regardless of
                                    the current result. */}
                                {updater.status !== "checking" && (
                                    <button
                                        type="button"
                                        onClick={updater.check}
                                        aria-label={t["Check for Updates"]}
                                        title={t["Check for Updates"]}
                                        // The row's height is set by the text line-height (~20px).
                                        // A generous tap target is good UX, but it must not make this
                                        // row taller than the text-only rows. So we fix the box to the
                                        // line height and use negative vertical margin to keep the
                                        // surrounding flex row's height driven by the text, not the button.
                                        className="-my-2 flex items-center justify-center h-8 w-8 rounded transition-colors hover:bg-white/10 text-muted hover:text-current cursor-pointer"
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Available update: version + install + release notes */}
                        {updater.status === "available" && updater.info && (
                            <div className="flex flex-col gap-2 pl-1">
                                <div className="flex items-center justify-between">
                                    <span style={{ color: fg }}>
                                        {t["Update available: v{version}"].replace("{version}", updater.info.version)}
                                    </span>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onPress={updater.install}
                                    >
                                        <Download size={14} />
                                        {t["Install and Restart"]}
                                    </Button>
                                </div>
                                {updater.info.body && (
                                    <div className="flex flex-col gap-1">
                                        <button
                                            onClick={() => setShowNotes((v) => !v)}
                                            className="text-xs text-muted hover:underline self-start"
                                        >
                                            {t["Release notes"]}
                                        </button>
                                        {showNotes && (
                                            <pre
                                                className="text-xs whitespace-pre-wrap break-words rounded-md p-2 max-h-40 overflow-y-auto"
                                                style={{
                                                    background: colors.hoverOverlay,
                                                    color: fg,
                                                }}
                                            >
                                                {updater.info.body}
                                            </pre>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Downloading: progress bar */}
                        {updater.status === "downloading" && (
                            <div className="flex flex-col gap-1 pl-1" style={{ color: fg }}>
                                <span className="text-xs text-muted">
                                    {t["Downloading update..."]}
                                    {updater.progress?.fraction !== undefined
                                        ? ` ${Math.round(updater.progress.fraction * 100)}%`
                                        : ""}
                                </span>
                                <div
                                    className="h-1.5 w-full overflow-hidden rounded-full"
                                    style={{ background: colors.hoverOverlay }}
                                >
                                    <div
                                        className="h-full rounded-full transition-[width] duration-150"
                                        style={{
                                            width: `${Math.round((updater.progress?.fraction ?? 0) * 100)}%`,
                                            background: fg,
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Installing */}
                        {updater.status === "installing" && (
                            <span className="flex items-center gap-1.5 pl-1 text-muted">
                                <LoaderCircle size={14} className="animate-spin" />
                                {t["Installing..."]}
                            </span>
                        )}
                    </div>

                    {/* Author */}
                    <div
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["Author"]}</span>
                        <a
                            href="https://iewnfod.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            style={{ color: fg }}
                        >
                            Iewnfod
                        </a>
                    </div>

                    {/* Contributors */}
                    <div
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["Contributors"]}</span>
                        <a
                            href="https://github.com/iewnfod/lumina-terminal/graphs/contributors"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:underline"
                            style={{ color: fg }}
                        >
                            <GithubMark size={14} />
                            {t["View Contributors"]}
                        </a>
                    </div>

                    {/* GitHub Repo */}
                    <div
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["Repository"]}</span>
                        <a
                            href="https://github.com/iewnfod/lumina-terminal"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:underline text-sm"
                            style={{ color: fg }}
                        >
                            <GithubMark size={14} />
                            iewnfod/lumina-terminal
                        </a>
                    </div>

                    {/* License */}
                    <div
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["License"]}</span>
                        <a
                            href="https://opensource.org/licenses/MPL-2.0"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            style={{ color: fg }}
                        >
                            MPL-2.0
                        </a>
                    </div>

                    {/* Technologies */}
                    <div className="flex flex-col gap-2 py-2">
                        <span className="text-muted text-sm">{t["Technology Stack"]}</span>
                        <div className="flex flex-wrap gap-2">
                            {technologies.map((tech) => (
                                <a
                                    key={tech.name}
                                    href={tech.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2.5 py-1 rounded-md text-xs transition-colors hover:opacity-80"
                                    style={{
                                        background: colors.hoverOverlay,
                                        color: fg,
                                    }}
                                >
                                    {tech.name}
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
