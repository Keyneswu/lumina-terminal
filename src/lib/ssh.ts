import {SSHConfig, SSHHostEntry} from "../types/terminal.ts";

/**
 * Format an SSH host entry as "user@host:port" for compact display.
 * Omits user/port when absent so the string stays clean.
 */
export function formatSshAddress(config: SSHConfig): string {
    const userPart = config.user ? `${config.user}@` : "";
    const portPart = config.port ? `:${config.port}` : "";
    return `${userPart}${config.host}${portPart}`;
}

/** Convenience wrapper for SSHHostEntry (the parsed-config shape). */
export function formatSshEntry(entry: SSHHostEntry): string {
    return formatSshAddress(entry.config);
}
