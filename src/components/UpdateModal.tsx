import { Modal, Button } from "@heroui/react";
import { Download, LoaderCircle, AlertCircle } from "lucide-react";
import { ITheme } from "@xterm/xterm";
import { useI18n } from "../hooks/i18n.tsx";
import { useSurfaceColors } from "../hooks/surfaceColors.ts";
import type { DownloadProgress, UpdateInfo, UpdateStatus } from "../lib/updater.ts";

interface UpdateModalProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	info: UpdateInfo | null;
	status: UpdateStatus;
	progress: DownloadProgress | null;
	error: string | null;
	onInstall: () => void;
	/** Theme used to derive surface colors (matches the About page treatment). */
	theme: ITheme | null;
}

/**
 * Update-available modal. Surfaced from the sidebar banner and the About page
 * "Install and Restart" action. Shows the new version + release notes and
 * requires an explicit confirm before downloading/installing.
 *
 * Install state (downloading / installing / error) is owned by the shared
 * `useUpdater` instance in App and passed in, so this modal reflects whatever
 * App-level state is current.
 */
export default function UpdateModal({
	isOpen,
	onOpenChange,
	info,
	status,
	progress,
	error,
	onInstall,
	theme,
}: UpdateModalProps) {
	const t = useI18n();
	const bg = theme?.background ?? "#000000";
	const fg = theme?.foreground ?? "#ffffff";
	const colors = useSurfaceColors(bg);

	const installing = status === "downloading" || status === "installing";
	const version = info?.version ?? "";

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				// Don't allow closing mid-install (the installer is running).
				if (installing && !open) return;
				onOpenChange(open);
			}}
			isDismissable={!installing}
			variant="blur"
		>
			<Modal.Container placement="center">
				<Modal.Dialog className="sm:max-w-lg w-full">
					<Modal.Header>
						<h2 className="text-lg font-semibold">
							{t["New version available: v{version}"].replace("{version}", version)}
						</h2>
					</Modal.Header>

					<Modal.Body className="max-h-96 overflow-y-auto">
						{info?.body ? (
							<div className="flex flex-col gap-2">
								<span className="text-xs font-medium text-muted uppercase tracking-wider">
									{t["What's New"]}
								</span>
								<pre
									className="text-sm whitespace-pre-wrap break-words rounded-md p-3 overflow-y-auto"
									style={{ background: colors.hoverOverlay, color: fg }}
								>
									{info.body}
								</pre>
							</div>
						) : (
							<p className="text-sm text-muted">{t["A new version is available"]}</p>
						)}
					</Modal.Body>

					<Modal.Footer className="flex-col items-stretch gap-2">
						{/* Download progress bar (shown while downloading/installing) */}
						{installing && (
							<div className="flex flex-col gap-1">
								<span className="text-xs text-muted">
									{status === "installing"
										? t["Installing..."]
										: t["Downloading update..."]}
									{status === "downloading" && progress?.fraction !== undefined
										? ` ${Math.round(progress.fraction * 100)}%`
										: ""}
								</span>
								<div
									className="h-1.5 w-full overflow-hidden rounded-full"
									style={{ background: colors.hoverOverlay }}
								>
									<div
										className="h-full rounded-full transition-[width] duration-150"
										style={{
											width: `${Math.round((progress?.fraction ?? 0) * 100)}%`,
											background: fg,
										}}
									/>
								</div>
							</div>
						)}

						{/* Install error */}
						{status === "error" && error && (
							<span
								className="flex items-center gap-1.5 text-xs"
								style={{ color: "#ef4444" }}
							>
								<AlertCircle size={14} />
								{error}
							</span>
						)}

						<div className="flex items-center justify-end gap-2">
							<Button
								variant="outline"
								isDisabled={installing}
								onPress={() => onOpenChange(false)}
							>
								{t["Later"]}
							</Button>
							<Button
								variant="primary"
								isDisabled={installing || !info}
								onPress={onInstall}
							>
								{installing ? (
									<LoaderCircle size={14} className="animate-spin" />
								) : (
									<Download size={14} />
								)}
								{installing
									? t["Installing..."]
									: t["Update to v{version}"].replace("{version}", version)}
							</Button>
						</div>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
