import {useEffect, useState} from "react";
import {getCliArgs} from "../lib/cliApi.ts";
import type {CliArgs} from "../types/cli.ts";

// Module-level cache: CLI args are parsed once at process startup and never
// change, so every window shares the same result without re-invoking. Mirrors
// the useShells/useSshConfig caching pattern.
let cached: CliArgs | null = null;
let pending: Promise<CliArgs> | null = null;

/**
 * Read the parsed launch flags (Alacritty-style) from the backend, once.
 *
 * Returns `undefined` while the first fetch is in flight, then the `CliArgs`
 * (which default to `{command: [], hold: false}` when no flags were given).
 * The consumer treats "no launch args" as a normal boot. Process-global, so
 * the value is identical in every window — but only the main window's seed
 * effect actually consumes it to shape the initial tab.
 */
export function useCliArgs(): CliArgs | undefined {
    const [args, setArgs] = useState<CliArgs | undefined>(cached ?? undefined);

    useEffect(() => {
        if (cached) {
            setArgs(cached);
            return;
        }
        if (!pending) {
            pending = getCliArgs().then((result) => {
                cached = result;
                return result;
            });
        }
        pending.then(setArgs);
    }, []);

    return args;
}
