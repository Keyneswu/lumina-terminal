/**
 * Updater wrapper (pure, React-free).
 *
 * Wraps `@tauri-apps/plugin-updater` (check/download/install) and
 * `@tauri-apps/plugin-process` (relaunch) so components never call those
 * plugins directly — per AGENTS.md §3.2, all Tauri plugin access lives here.
 */

import { check, type Update, type CheckOptions } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Lifecycle of a single update cycle. */
export type UpdateStatus =
	| "idle"
	| "checking"
	| "upToDate"
	| "available"
	| "downloading"
	| "installing"
	| "error";

/** Metadata about an available update. */
export interface UpdateInfo {
	version: string;
	date?: string;
	body?: string;
}

/** Result of {@link checkForUpdate}. */
export interface CheckResult {
	status: "upToDate" | "available";
	info?: UpdateInfo;
}

/** Result of an operation that may fail. */
export interface UpdateError {
	status: "error";
	error: string;
}

/** Progress reported while downloading an update. */
export interface DownloadProgress {
	/** Downloaded bytes. */
	downloaded: number;
	/** Total bytes (may be 0 if unknown). */
	total: number;
	/** 0–1 fraction, or undefined if total is unknown. */
	fraction?: number;
}

/**
 * Holds an in-flight `Update` handle between check and install.
 *
 * The Tauri v2 API returns an `Update` object from `check()`; the download/
 * install methods live on that object. We keep it module-local so callers only
 * deal with plain data ({@link UpdateInfo}) through this module's functions.
 */
let pendingUpdate: Update | null = null;

/**
 * Check the configured endpoints for an update.
 *
 * Returns `{ status: "available", info }` when a newer version exists, or
 * `{ status: "upToDate" }` otherwise. On any failure (network, signature,
 * missing updater plugin, dev build) returns an `error` result so the UI can
 * show a friendly message instead of throwing.
 *
 * Pass `options` to forward headers / timeout to the underlying `check()`.
 */
export async function checkForUpdate(
	options?: CheckOptions,
): Promise<CheckResult | UpdateError> {
	// In debug/dev builds the app is unsigned, so the updater almost always
	// errors. Catch and report rather than letting it throw in the UI.
	try {
		const update = await check(options);
		if (update?.available) {
			pendingUpdate = update;
			return {
				status: "available",
				info: {
					version: update.version,
					date: update.date,
					body: update.body,
				},
			};
		}
		pendingUpdate = null;
		return { status: "upToDate" };
	} catch (e) {
		// dev builds have no updater endpoint that resolves; keep noise down.
		if (!import.meta.env.DEV) {
			console.error("Update check failed:", e);
		}
		return {
			status: "error",
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Download and install the pending update (the one found by the last
 * {@link checkForUpdate}), then relaunch the app.
 *
 * `onProgress` is called repeatedly with download progress. Throws if no
 * update is pending or if download/install fails — callers should catch and
 * surface the error.
 */
export async function downloadAndInstall(
	onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
	if (!pendingUpdate) {
		throw new Error("No pending update — call checkForUpdate() first.");
	}

	// Track total size across events: `Started` gives contentLength once,
	// `Progress` gives per-chunk sizes we accumulate, `Finished` marks 100%.
	let total = 0;
	let downloaded = 0;
	await pendingUpdate.downloadAndInstall((event) => {
		if (!onProgress) return;
		if (event.event === "Started" && event.data.contentLength) {
			total = event.data.contentLength;
		} else if (event.event === "Progress") {
			downloaded += event.data.chunkLength;
		}
		if (event.event === "Finished") {
			onProgress({ downloaded: total || downloaded, total, fraction: 1 });
		} else if (total > 0) {
			onProgress({ downloaded, total, fraction: downloaded / total });
		} else {
			onProgress({ downloaded, total: 0, fraction: undefined });
		}
	});

	pendingUpdate = null;
	await relaunch();
}

/** True when an update is currently pending (checked, not yet installed). */
export function hasPendingUpdate(): boolean {
	return pendingUpdate !== null;
}

/** Forget the pending update without installing it. */
export function clearPendingUpdate(): void {
	pendingUpdate = null;
}
