import {useCallback, useEffect, useRef, useState} from "react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {error, info} from "@tauri-apps/plugin-log";

/**
 * Per-window "always on top" toggle. Each window (main and every tear-off)
 * owns its own state — pinning one does not pin the others, and nothing is
 * persisted to config.
 *
 * The pinned flag is updated optimistically rather than re-read after each
 * toggle: on Linux `isAlwaysOnTop` reports a value that tao caches from an
 * asynchronous GTK window-state event, so an immediate read-back can still
 * return the old state. The mount-time read only seeds the initial value.
 *
 * Callers must gate this on the session type — tao maps `setAlwaysOnTop` to
 * GTK's keep-above hint, which only X11 honors, so the call is a silent no-op
 * under Wayland (see the disabled pin button in TitleBar).
 */
export function useAlwaysOnTop() {
    const [pinned, setPinned] = useState(false);
    // Tracks the value of `pinned` as of the latest commit so `toggle` (a
    // useCallback) can read the current flag without depending on it. Keeping
    // `pinned` out of the deps array means rapid clicks all dispatch against
    // the committed value instead of a stale closure, and the callback never
    // changes identity mid-render.
    const pinnedRef = useRef(false);
    pinnedRef.current = pinned;
    // Set true the first time the user toggles. The mount-time read resolves
    // asynchronously and would otherwise clobber an optimistic update if the
    // user clicks before it settles — e.g. window starts unpinned, user pins
    // fast, then the stale `isAlwaysOnTop()` → false lands and reverts the UI
    // while the window itself stayed on top.
    const interactedRef = useRef(false);

    useEffect(() => {
        getCurrentWindow().isAlwaysOnTop()
            .then((v) => {
                if (interactedRef.current) return;
                setPinned(v);
            })
            .catch((e) => {
                error(`Failed to read always-on-top state: ${e}`).catch(() => {});
            });
    }, []);

    const toggle = useCallback(() => {
        const next = !pinnedRef.current;
        interactedRef.current = true;
        setPinned(next);
        getCurrentWindow().setAlwaysOnTop(next)
            .then(() => {
                info(`Window always-on-top ${next ? "enabled" : "disabled"}`).catch(() => {});
            })
            .catch((e) => {
                // Roll back to whatever the committed value actually is now,
                // not the pre-toggle snapshot — a second click landing in the
                // meantime would otherwise be undone alongside this failure.
                setPinned(pinnedRef.current);
                error(`Failed to set always-on-top to ${next}: ${e}`).catch(() => {});
            });
    }, []);

    return {pinned, toggle};
}
