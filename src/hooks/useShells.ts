import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { error } from "@tauri-apps/plugin-log";

let cached: string[] | null = null;
let pending: Promise<string[]> | null = null;

export function useShells(): string[] {
    const [shells, setShells] = useState<string[]>(cached ?? []);

    useEffect(() => {
        if (cached) {
            setShells(cached);
            return;
        }
        if (!pending) {
            pending = invoke<string[]>("find_shells")
                .then((result) => {
                    cached = result;
                    return result;
                })
                .catch((e) => {
                    error(`Failed to discover shells: ${e}`).catch(() => {});
                    cached = [];
                    return [];
                });
        }
        pending.then(setShells);
    }, []);

    return shells;
}
