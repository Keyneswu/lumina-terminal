import {useEffect, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {error} from "@tauri-apps/plugin-log";

/**
 * How this copy of the app was installed, when it is owned by a system package
 * manager. Mirrors the backend `InstallSource` struct in `utils.rs`.
 */
export interface InstallSource {
	/** Lowercase package-manager family: "pacman" | "dpkg" | "rpm". */
	manager: string;
	/** Owning package name as reported by that manager. */
	package: string;
}

// Module-level cache, mirroring useShells: the install source never changes
// during a run, so one backend call is enough no matter how many components
// mount this hook.
//   undefined → not queried yet (still loading)
//   null      → queried; NOT managed by a package manager (in-app updater OK)
//   object    → queried; managed → disable in-app updater
let cached: InstallSource | null | undefined;
let pending: Promise<InstallSource | null> | null = null;

/**
 * Detect whether this app was installed by a system package manager
 * (pacman/dpkg/rpm). When it is, the in-app self-updater is disabled and the
 * UI shows the package-manager update command instead — Tauri v2's updater
 * only supports AppImage on Linux, so it fails on `.deb`/pacman-managed
 * installs. Cached module-wide after the first check.
 *
 * Returns:
 *   - `undefined` while the check is in flight (caller may treat as "unknown")
 *   - `null`      when the app is NOT package-manager-managed
 *   - `InstallSource` when it is
 */
export function useInstallSource(): InstallSource | null | undefined {
	const [source, setSource] = useState<InstallSource | null | undefined>(cached);

	useEffect(() => {
		if (cached !== undefined) {
			setSource(cached);
			return;
		}
		if (!pending) {
			pending = invoke<InstallSource | null>("install_source")
				.then((result) => {
					cached = result ?? null;
					return cached;
				})
				.catch((e) => {
					error(`install_source failed: ${e}`).catch(() => {});
					cached = null;
					return null;
				});
		}
		pending.then(setSource);
	}, []);

	return source;
}
