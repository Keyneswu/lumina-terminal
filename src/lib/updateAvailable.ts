/**
 * Module-level cache of the last update found by a startup check.
 *
 * The startup check (useStartupUpdateCheck) runs once at boot. The About page
 * wants to reflect "an update is available" without re-checking, so it reads
 * this shared value. This is the only cross-hook coupling for the updater and
 * is intentionally tiny (no React here, per AGENTS.md layering).
 */

import type { UpdateInfo } from "./updater.ts";

let cached: UpdateInfo | null = null;

/** Record an update found by the startup check (or null when none). */
export function setStartupUpdate(info: UpdateInfo | null): void {
	cached = info;
}

/** Read the update found at startup, if any. */
export function getStartupUpdate(): UpdateInfo | null {
	return cached;
}
