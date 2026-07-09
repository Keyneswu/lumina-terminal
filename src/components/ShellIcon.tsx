import {Cloud, SquareTerminal} from "lucide-react";
import {ShellType} from "../lib/shellIcon.ts";

interface ShellIconProps {
    shell: ShellType;
    size?: number;
    className?: string;
}

/**
 * Per-shell tab icon. Falls back to lucide icons for SSH (Cloud) and the
 * generic case (SquareTerminal); bash/zsh/fish/nu/pwsh use hand-drawn
 * single-color SVGs that follow lucide's stroke style (width 2, round caps/
 * joins, `stroke="currentColor"`), so they inherit the tab's foreground color.
 */
export default function ShellIcon({shell, size = 14, className}: ShellIconProps) {
    switch (shell) {
        case "ssh":
            return <Cloud size={size} className={className} />;
        case "default":
            return <SquareTerminal size={size} className={className} />;
        case "bash":
            return (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    className={className}>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="m7 9 3 3-3 3" />
                    <path d="M13 15h4" />
                    <path d="m14 5 5 6" opacity={0.5} />
                    <path d="m11 5 5 6" opacity={0.5} />
                </svg>
            );
        case "zsh":
            return (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    className={className}>
                    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                </svg>
            );
        case "fish":
            return (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    className={className}>
                    <path d="M2 12c3-5 8-5 11 0-3 5-8 5-11 0z" />
                    <path d="M13 12c2-4 5-5 9-5-1 3-1 7 0 10-4 0-7-1-9-5z" />
                    <path d="M18 11v.01" />
                </svg>
            );
        case "nu":
            return (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    className={className}>
                    <path d="M4 19V5c2 4 6 9 11 10" />
                    <path d="M8 12c2-2 5-3 8-1" />
                </svg>
            );
        case "pwsh":
            return (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    className={className}>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="m7 9 3 3-3 3" />
                    <path d="M13 15h4" />
                </svg>
            );
    }
}
