import { useCallback, useState } from "react";
import {
	checkForUpdate,
	downloadAndInstall,
	type DownloadProgress,
	type UpdateInfo,
	type UpdateStatus,
} from "../lib/updater.ts";
import {
	setStartupUpdate,
	getStartupUpdate,
} from "../lib/updateAvailable.ts";

export interface UpdaterState {
	status: UpdateStatus;
	info: UpdateInfo | null;
	progress: DownloadProgress | null;
	error: string | null;
	/** Re-run the update check. No-op while a check/transfer is in flight. */
	check: () => void;
	/** Download, install, and relaunch the pending update. */
	install: () => void;
}

/**
 * React state machine for the update cycle, for use in the About page.
 *
 * Pure logic lives in `lib/updater.ts`; this hook only owns React state and
 * guards against concurrent operations. It does NOT auto-check — that is the
 * responsibility of {@link useStartupUpdateCheck}, keeping single-responsibility.
 */
export function useUpdater(): UpdaterState {
	// Seed from the startup-check cache so the About page immediately shows
	// "available" if an update was already found at boot.
	const initial = getStartupUpdate();
	const [status, setStatus] = useState<UpdateStatus>(
		initial ? "available" : "idle",
	);
	const [info, setInfo] = useState<UpdateInfo | null>(initial);
	const [progress, setProgress] = useState<DownloadProgress | null>(null);
	const [error, setError] = useState<string | null>(null);

	const busy =
		status === "checking" ||
		status === "downloading" ||
		status === "installing";

	const check = useCallback(() => {
		if (busy) return;
		setStatus("checking");
		setError(null);
		checkForUpdate().then((res) => {
			if (res.status === "available") {
				setInfo(res.info ?? null);
				setStatus("available");
				// share with anyone reading the startup cache
				setStartupUpdate(res.info ?? null);
			} else if (res.status === "upToDate") {
				setInfo(null);
				setStatus("upToDate");
			} else if (res.status === "error") {
				setError(res.error);
				setStatus("error");
			}
		});
	}, [busy]);

	const install = useCallback(() => {
		if (busy) return;
		setStatus("downloading");
		setError(null);
		setProgress(null);
		downloadAndInstall((p) => {
			setProgress(p);
			if (p.fraction === undefined || p.fraction >= 1) {
				// download finished → installer takes over
				setStatus("installing");
			}
		}).catch((e) => {
			setError(e instanceof Error ? e.message : String(e));
			setStatus("error");
		});
	}, [busy]);

	return { status, info, progress, error, check, install };
}
