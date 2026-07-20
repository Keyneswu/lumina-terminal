import {useEffect, useState} from "react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {consumeTearoff, isTearoffLabel, type TearoffPayload} from "../lib/tearoff.ts";
import {error} from "@tauri-apps/plugin-log";

/**
 * Detect whether this window is a torn-off tab window and, if so, hand its
 * stashed payload (profile + PTY id + scrollback) to the App so it can seed a
 * single reattach-mode terminal instead of booting the default profile.
 *
 * Runs once on mount. Returns `null` while pending and for the main window;
 * returns `{label, payload}` only for a tear-off window that successfully
 * consumed its stash. A failed consume still resolves (to null) so the window
 * falls back to a normal boot rather than hanging.
 */
export interface TearoffSession {
    label: string;
    payload: TearoffPayload;
}

export function useTearoffSession(): TearoffSession | "no" | null {
    const [session, setSession] = useState<TearoffSession | "no" | null>(null);

    useEffect(() => {
        let cancelled = false;
        const label = getCurrentWindow().label;
        if (!isTearoffLabel(label)) {
            setSession("no");
            return;
        }
        consumeTearoff(label)
            .then((payload) => {
                if (cancelled) return;
                if (payload) {
                    setSession({label, payload});
                } else {
                    // Tear-off label but no payload — nothing to reattach to.
                    // Treat as a normal window boot.
                    error(`Tear-off window ${label} had no payload; booting empty`).catch(() => {});
                    setSession("no");
                }
            })
            .catch((e) => {
                if (cancelled) return;
                error(`useTearoffSession failed for ${label}: ${e}`).catch(() => {});
                setSession("no");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return session;
}
