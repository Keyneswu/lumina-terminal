import {useCallback, useEffect, useState} from "react";
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

    useEffect(() => {
        getCurrentWindow().isAlwaysOnTop()
            .then(setPinned)
            .catch((e) => {
                error(`Failed to read always-on-top state: ${e}`).catch(() => {});
            });
    }, []);

    const toggle = useCallback(() => {
        const next = !pinned;
        setPinned(next);
        getCurrentWindow().setAlwaysOnTop(next)
            .then(() => {
                info(`Window always-on-top ${next ? "enabled" : "disabled"}`).catch(() => {});
            })
            .catch((e) => {
                setPinned(!next);
                error(`Failed to set always-on-top to ${next}: ${e}`).catch(() => {});
            });
    }, [pinned]);

    return {pinned, toggle};
}
