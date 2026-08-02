import {Terminal} from "@xterm/xterm";
import {safeCodeUnitLength} from "./text.ts";

/**
 * Bounded-chunk feeder for `term.write()`.
 *
 * When PTY output arrives in bursts (e.g. `cat bigfile`), feeding it straight
 * to xterm one `write()` per IPC message blocks the main thread for tens of ms
 * per call (jank) while xterm parses thousands of lines. This coalesces pending
 * data into bounded chunks with a microtask gap between them so the main thread
 * stays responsive during large output.
 *
 * The chunk size is a trade-off: too large and one `term.write()` blocks a
 * frame; too small and per-write overhead dominates. 16KB stays well under a
 * frame while keeping the number of `write()` calls (and parse/render passes)
 * low.
 *
 * UTF-16 safety: the cut point never lands between the two halves of a
 * surrogate pair (emoji / astral-plane chars) — otherwise both pieces carry a
 * lone surrogate and render as a replacement-char glitch. This is the real
 * cause of "PTY string truncation" visual errors, not the backend (the backend
 * already streams UTF-8-safe). See `safeCodeUnitLength`.
 *
 * Pure logic (no React) per the lib/ layering rule.
 */
export class ChunkedWriter {
    private readonly term: Terminal;
    private readonly chunkSize: number;
    private readonly pending: string[] = [];
    private scheduled = false;

    constructor(term: Terminal, chunkSize = 1024 * 16) {
        this.term = term;
        this.chunkSize = chunkSize;
    }

    /** Enqueue a decoded string chunk of PTY output for writing. */
    push(data: string): void {
        this.pending.push(data);
        if (!this.scheduled) {
            this.scheduled = true;
            queueMicrotask(() => this.drain());
        }
    }

    /** Flush any pending data synchronously (e.g. on dispose). */
    dispose(): void {
        if (this.pending.length > 0) {
            // Concatenate and write whatever remains without scheduling.
            this.term.write(this.pending.join(""));
            this.pending.length = 0;
            this.scheduled = false;
        }
    }

    private drain(): void {
        if (this.pending.length === 0) {
            this.scheduled = false;
            return;
        }

        // Build one chunk by consuming items from the front of the queue.
        // The cut point is UTF-16-safe: if it would land between the two
        // halves of a surrogate pair, back up by one code unit so the pair
        // stays intact.
        let chunk = "";
        let taken = 0;
        while (this.pending.length > 0 && taken < this.chunkSize) {
            const next = this.pending[0];
            const remaining = this.chunkSize - taken;
            if (next.length <= remaining) {
                chunk += this.pending.shift()!;
                taken += next.length;
            } else {
                const cut = safeCodeUnitLength(next, remaining);
                chunk += next.slice(0, cut);
                this.pending[0] = next.slice(cut);
                taken = this.chunkSize;
            }
        }

        // Drive the queue forward via microtask regardless of whether more
        // data remains, instead of waiting for term.write()'s render callback.
        // The callback model serialized writes behind xterm's render time,
        // which throttled throughput to "one chunk per frame" and made large
        // chunks *worse* (longer single write blocking). Microtask draining
        // keeps the queue moving while still yielding between chunks.
        this.term.write(chunk);
        this.scheduled = this.pending.length > 0;
        if (this.scheduled) {
            queueMicrotask(() => this.drain());
        }
    }
}
