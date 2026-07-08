/**
 * Shell-integration sequence parser for the "current command" feature.
 *
 * Shells inject snippets (see the Rust side of `start_terminal`) that emit
 * custom OSC sequences around command execution. This module parses them out
 * of the raw PTY byte stream *before* it reaches xterm — xterm silently drops
 * unknown OSC sequences, so they never pollute the visible terminal.
 *
 * Protocol (Lumina-specific OSC 1337 sub-parameters):
 *   ESC ] 1337 ; CurrentCommand=<cmd> ST   — the command line the shell is
 *                                             about to run (sent in preexec)
 *   ESC ] 1337 ; CurrentCommand= ST         — empty: command finished, back at
 *                                             the prompt (sent in precmd)
 *
 * The OSC payload may be split across several `term-write` chunks, so the
 * parser keeps a small internal buffer of trailing bytes until a sequence is
 * either complete or definitely not one of ours.
 *
 * This module is pure logic (no React) per the lib/ layering rule.
 */

// OSC = ESC ]  (0x1b 0x5d); ST (string terminator) = ESC \  (0x1b 0x5c) or BEL (0x07).
const ESC = 0x1b;
const BEL = 0x07;

const PREFIX = "\x1b]1337;CurrentCommand=";

/**
 * A small stateful parser. Construct one per terminal (keep it in a ref) and
 * feed every `term-write` payload to {@link feed}.
 */
export class CurrentCommandParser {
    // Leftover bytes from the previous chunk that might be the start of a
    // sequence spanning the boundary. Bounded so it can never grow unbounded.
    private pending = "";

    /**
     * Feed a chunk of PTY output. Returns the new command string when a
     * `CurrentCommand` sequence is completed in this chunk, `""` when the
     * shell reports the prompt (command finished), or `null` when there is
     * nothing to report yet (no relevant sequence completed).
     *
     * Values are de-duplicated by the caller (Term.tsx keeps the last value);
     * here we only surface what the stream says.
     */
    feed(data: string): string | null {
        let buf = this.pending + data;
        let result: string | null = null;

        // Process every complete PREFIX...ST occurrence currently in the buffer.
        while (true) {
            const start = buf.indexOf(PREFIX);
            if (start === -1) break;

            const valueStart = start + PREFIX.length;
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
                // pathological growth on streams that happen to contain our
                // PREFIX without ever closing it.
                const tail = buf.slice(start);
                this.pending = tail.length > 4096 ? tail.slice(-4096) : tail;
                return result;
            }

            // A complete sequence: surface its value.
            const value = buf.slice(valueStart, end);
            result = value;

            // Continue scanning the remainder for further sequences in the
            // same chunk.
            buf = buf.slice(end + endLen);
        }

        // No full sequence remains. Keep a short tail in case a PREFIX starts
        // right at the end of this chunk (partial PREFIX).
        const keep = Math.min(buf.length, PREFIX.length);
        this.pending = buf.slice(-keep);
        return result;
    }

    /** Reset internal state (e.g. on terminal reset/re-init). */
    reset(): void {
        this.pending = "";
    }
}
