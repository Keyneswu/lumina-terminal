/**
 * Full-window transparent overlay mounted during a cross-window tab drag so
 * HTML5 `dragover` keeps firing over xterm's canvas/WebGL (which otherwise
 * swallows the event → stale heartbeat → false "tear off onto desktop").
 *
 * The overlay is transparent and pointer-event-transparent for hit-testing
 * purposes only — its job is to keep `dragover` events flowing so the caller's
 * `onDragOver` callback can throttle-emit hover heartbeats to the source
 * window. Removed by the returned cleanup (typically on drag end).
 *
 * Pure DOM utility (no React) per the lib/ layering rule.
 */
export function mountTabDragOverlay(onDragOver: (ev: DragEvent) => void): () => void {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-lumina-tab-drag-overlay", "");
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        // Above the terminal surface; below native OS UI.
        zIndex: "2147483646",
        // Keep the drag image visible; we only need hit-testing.
        background: "transparent",
    });
    const handler = (ev: DragEvent) => {
        // Required for continuous dragover across the webview (incl. canvas).
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        onDragOver(ev);
    };
    overlay.addEventListener("dragover", handler);
    document.body.appendChild(overlay);
    return () => {
        overlay.removeEventListener("dragover", handler);
        overlay.remove();
    };
}
