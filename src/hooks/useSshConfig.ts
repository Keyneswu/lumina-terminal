import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {SSHHostEntry} from "../types/terminal.ts";

// Module-level cache so the SSH config is parsed once per session, no matter
// how many components (AddProfileModal, WelcomePage, ...) call this hook.
let cached: SSHHostEntry[] | null = null;
let pending: Promise<SSHHostEntry[]> | null = null;

export function useSshConfig(): SSHHostEntry[] {
    const [entries, setEntries] = useState<SSHHostEntry[]>(cached ?? []);

    useEffect(() => {
        if (cached) {
            setEntries(cached);
            return;
        }
        if (!pending) {
            pending = invoke<SSHHostEntry[]>("parse_ssh_config")
                .then((result) => {
                    cached = result;
                    return result;
                })
                .catch(() => {
                    cached = [];
                    return [];
                });
        }
        pending.then(setEntries);
    }, []);

    return entries;
}
