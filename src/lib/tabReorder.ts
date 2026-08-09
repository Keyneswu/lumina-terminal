/**
 * Pure geometry + list math behind sidebar tab drag-reordering.
 *
 * Kept out of TabBar so the "where does this drop land" rule is testable and
 * has one definition. The component only measures rects and renders the drop
 * indicator; every index decision happens here.
 */

/**
 * Insertion index for a pointer at `clientY`, given the tab rows' bounding
 * rects in render order. A row claims the slot *above* itself once the pointer
 * is past its vertical midpoint, so the returned value is a gap index in
 * `[0, rects.length]` — `rects.length` meaning "after the last row".
 */
export function dropTargetFor(rects: DOMRect[], clientY: number): number {
    for (let i = 0; i < rects.length; i++) {
        if (clientY < rects[i].top + rects[i].height / 2) return i;
    }
    return rects.length;
}

/**
 * Move `list[fromIndex]` into the gap at `insertIndex` (as produced by
 * {@link dropTargetFor}). Returns the ORIGINAL array reference when the move
 * is a no-op — dropping into the gap just above or just below yourself leaves
 * the order untouched — so callers can skip the state update entirely.
 */
export function reorderByDrop<T>(list: T[], fromIndex: number, insertIndex: number): T[] {
    if (fromIndex < 0 || fromIndex >= list.length) return list;
    if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return list;
    const next = [...list];
    const [item] = next.splice(fromIndex, 1);
    // Removing the item shifts everything after it up by one, so a gap that
    // was to the right of the source is now one slot earlier.
    next.splice(insertIndex > fromIndex ? insertIndex - 1 : insertIndex, 0, item);
    return next;
}
