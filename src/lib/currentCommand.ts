/**
 * Shell-integration sequence parser for the "current command" + per-command
 * exit-code features.
 *
 * The backend injects snippets (`src-tauri/src/shell_integration.rs`) into
 * bash/zsh/fish that emit OSC 1337 sequences around command execution. This
 * module parses them out of the raw PTY byte stream *before* it reaches xterm
 * — xterm silently drops unknown OSC sequences, so they never pollute the
 * visible terminal.
 *
 * Protocol (OSC 1337 sub-parameters; ST = BEL or ESC\):
 *   ESC ] 1337 ; CurrentCommand=<cmd> ST      — preexec: the command line about to run
 *   ESC ] 1337 ; CurrentCommandExit=<code> ST — precmd: the previous command's exit code
 *
 * A chunk may contain several sequences, so `feed` returns a list in order.
 * The payload may be split across chunks; a bounded `pending` buffer carries
 * the trailing partial sequence to the next call.
 *
 * Pure logic (no React) per the lib/ layering rule.
 */

// OSC = ESC ]  (0x1b 0x5d); ST (string terminator) = ESC \  (0x1b 0x5c) or BEL (0x07).
const ESC = 0x1b;
const BEL = 0x07;

const PREFIX_CMD = "\x1b]1337;CurrentCommand=";
const PREFIX_EXIT = "\x1b]1337;CurrentCommandExit=";

export type CommandParseEvent =
    | {type: "command"; value: string}
    | {type: "exit"; code: number};

/**
 * A small stateful parser. Construct one per terminal (keep it in a ref) and
 * feed every `term-write` payload to {@link feed}.
 */
export class CurrentCommandParser {
    // Leftover bytes from the previous chunk that might be the start of a
    // sequence spanning the boundary. Bounded so it can never grow unbounded.
    private pending = "";

    /**
     * Feed a chunk of PTY output. Returns the shell-integration events found in
     * this chunk, in order (`command` from preexec, `exit` with the previous
     * command's code from precmd). Empty if no complete sequence was present.
     */
    feed(data: string): CommandParseEvent[] {
        let buf = this.pending + data;
        const events: CommandParseEvent[] = [];

        while (true) {
            // Find the earliest of the two prefixes. PREFIX_CMD is NOT a prefix
            // of PREFIX_EXIT (one ends in '=', the other in 'E'), so the raw
            // indexOf results are safe to compare by position.
            const cmdIdx = buf.indexOf(PREFIX_CMD);
            const exitIdx = buf.indexOf(PREFIX_EXIT);
            let idx = -1;
            let isExit = false;
            let prefixLen = 0;
            if (cmdIdx !== -1 && (exitIdx === -1 || cmdIdx < exitIdx)) {
                idx = cmdIdx;
                prefixLen = PREFIX_CMD.length;
            } else if (exitIdx !== -1) {
                idx = exitIdx;
                isExit = true;
                prefixLen = PREFIX_EXIT.length;
            }
            if (idx === -1) break;

            const valueStart = idx + prefixLen;
            // The ST can be either ESC \ or a single BEL. Find the earliest one.
            let end = -1;
            let endLen = 0;
            for (let i = valueStart; i < buf.length; i++) {
                const code = buf.charCodeAt(i);
                if (code === BEL) {
                    end = i;
                    endLen = 1;
                    break;
                }
                if (code === ESC && i + 1 < buf.length && buf.charCodeAt(i + 1) === 0x5c /* \ */) {
                    end = i;
                    endLen = 2;
                    break;
                }
            }

            if (end === -1) {
                // Sequence is incomplete: keep from the PREFIX onward so the
                // next chunk can finish it. Cap the retained tail to avoid
                // pathological growth on streams that contain our PREFIX without
                // ever closing it.
                const tail = buf.slice(idx);
                this.pending = tail.length > 4096 ? tail.slice(-4096) : tail;
                return events;
            }

            const value = buf.slice(valueStart, end);
            if (isExit) {
                const code = parseInt(value, 10);
                if (!Number.isNaN(code)) {
                    events.push({type: "exit", code});
                }
            } else if (value !== "") {
                // Non-empty CurrentCommand = preexec command line. (An empty
                // CurrentCommand= was the legacy "back at prompt" signal; we no
                // longer emit it — CurrentCommandExit covers command-done now.)
                events.push({type: "command", value});
            }

            buf = buf.slice(end + endLen);
        }

        // No full sequence remains. Keep a short tail in case a PREFIX starts
        // right at the end of this chunk (partial PREFIX).
        const keep = Math.min(buf.length, PREFIX_CMD.length);
        this.pending = buf.slice(-keep);
        return events;
    }

    /** Reset internal state (e.g. on terminal reset/re-init). */
    reset(): void {
        this.pending = "";
    }
}
