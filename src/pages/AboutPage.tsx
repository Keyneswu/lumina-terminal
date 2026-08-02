import {useEffect, useMemo, useState} from "react";
import { ITheme } from "@xterm/xterm";
import { useI18n } from "../hooks/i18n.tsx";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import type { UpdaterState } from "../hooks/useUpdater.ts";
import type { InstallSource } from "../hooks/useInstallSource.ts";
import { fetchReleaseNotes } from "../lib/releaseNotes.ts";
import iconSvg from "../assets/icon.svg";
import readmeRaw from "../../README.md?raw";
import {invoke} from "@tauri-apps/api/core";
import {getVersion} from "@tauri-apps/api/app";
import {Button, Modal} from "@heroui/react";
import {
	AlertCircle,
	CheckCircle2,
	Download,
	LoaderCircle,
	RefreshCw,
} from "lucide-react";
import Markdown from "../components/Markdown.tsx";

interface AboutPageProps {
	theme: ITheme | null;
	/** Shared updater state (owned by App so the sidebar/modal stay in sync). */
	updater: UpdaterState;
	/** Detected install source; when set, the in-app updater is disabled. */
	installSource?: InstallSource | null;
	/** Open the update-detail modal (About never installs directly). */
	onShowUpdateModal: () => void;
}

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

export default function AboutPage({ theme, updater, installSource, onShowUpdateModal }: AboutPageProps) {
    const t = useI18n();
    const bg = theme?.background ?? "#000000";
    const fg = theme?.foreground ?? "#ffffff";
    const colors = useSurfaceColors(bg);

    const technologies = useMemo(() => parseTechStack(readmeRaw), []);
    const [commitHash, setCommitHash] = useState<string>("");
    const [version, setVersion] = useState<string>("");

    // Updater state comes from props (owned by App). The About page only reads
    // it; installing is gated behind the update modal (onShowUpdateModal).

    // Easter-egg: double-click "You're up to date" to view the CURRENT version's
    // release notes (fetched on demand from the GitHub Releases API).
    const [currentNotes, setCurrentNotes] = useState<string | null>(null);
    const [notesLoading, setNotesLoading] = useState(false);
    const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);

    const openCurrentReleaseNotes = () => {
        if (!version) return;
        setIsNotesModalOpen(true);
        setNotesLoading(true);
        setCurrentNotes(null);
        fetchReleaseNotes(version)
            .then((body) => setCurrentNotes(body))
            .finally(() => setNotesLoading(false));
    };

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
                        className="flex items-center justify-between py-2"
                        style={{ borderBottom: `1px solid ${colors.borderColor}` }}
                    >
                        <span className="text-muted">{t["Updates"]}</span>
                        <div className="flex items-center" style={{ color: fg }}>
                            {/* Status text (always present) */}
                            {updater.status === "checking" ? (
                                <span className="flex items-center gap-1.5 text-muted">
                                    <LoaderCircle size={14} className="animate-spin translate-y-px" />
                                    {t["Checking for updates..."]}
                                </span>
                            ) : updater.status === "downloading" ? (
                                <span className="flex items-center gap-1.5 text-muted">
                                    <LoaderCircle size={14} className="animate-spin" />
                                    {t["Downloading update..."]}
                                    {updater.progress?.fraction !== undefined
                                        ? ` ${Math.round(updater.progress.fraction * 100)}%`
                                        : ""}
                                </span>
                            ) : updater.status === "installing" ? (
                                <span className="flex items-center gap-1.5 text-muted">
                                    <LoaderCircle size={14} className="animate-spin" />
                                    {t["Installing..."]}
                                </span>
                            ) : updater.status === "available" ? (
                                <span
                                    className="flex items-center gap-1.5 cursor-pointer hover:underline -translate-y-px"
                                    style={{ color: fg }}
                                    title={t["What's New"]}
                                    onClick={onShowUpdateModal}
                                >
								<Download size={14} className="translate-y-px" />
								{updater.info
									? t["Update available: v{version}"].replace("{version}", updater.info.version)
									: t["A new version is available"]}
								{installSource && (
									<span className="text-muted">
										{" · "}
										{installSource.manager}
									</span>
								)}
							</span>
                            ) : updater.status === "upToDate" ? (
                                <span
                                    className="flex items-center gap-1.5 cursor-pointer select-none"
                                    style={{ color: "#22c55e" }}
                                    title={t["What's New"]}
                                    onDoubleClick={openCurrentReleaseNotes}
                                >
                                    <CheckCircle2 size={14} className="translate-y-px" />
                                    {t["You're up to date"]}
                                </span>
                            ) : updater.status === "error" ? (
                                <span className="flex items-center gap-1.5" style={{color: "var(--color-danger-500, #ef4444)"}}>
                                    <AlertCircle size={14} className="translate-y-px" />
                                    {t["Update check failed"]}
                                </span>
                            ) : (
                                <span className="text-muted -translate-y-px">
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
                                    className="lum-tech-chip px-2.5 py-1 rounded-[var(--radius-sm)] text-xs transition-colors duration-[var(--duration-fast)] ease-[var(--ease-glass)] hover:opacity-80"
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

            {/* Current-version release notes (double-click "You're up to date") */}
            <Modal.Backdrop
                isOpen={isNotesModalOpen}
                onOpenChange={setIsNotesModalOpen}
                isDismissable={true}
                variant="blur"
            >
                <Modal.Container placement="center">
                    <Modal.Dialog className="sm:max-w-lg w-full">
                        <Modal.Header>
                            <h2 className="text-lg font-semibold">
                                {t["What's New"]}
                                {version && (
                                    <span className="text-sm font-normal text-muted ml-2">v{version}</span>
                                )}
                            </h2>
                        </Modal.Header>
                        <Modal.Body className="max-h-96 overflow-y-auto">
                            {notesLoading ? (
                                <div className="flex items-center justify-center py-8 text-muted">
                                    <LoaderCircle size={18} className="animate-spin" />
                                </div>
                            ) : currentNotes ? (
                                <div
                                    className="rounded-md p-3 overflow-y-auto"
                                    style={{ background: colors.hoverOverlay, color: fg }}
                                >
                                    <Markdown>{currentNotes}</Markdown>
                                </div>
                            ) : (
                                <p className="text-sm text-muted text-center py-8">
                                    {t["Release notes"]}
                                </p>
                            )}
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="outline" onPress={() => setIsNotesModalOpen(false)}>
                                {t["Close"]}
                            </Button>
                        </Modal.Footer>
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </div>
    );
}
