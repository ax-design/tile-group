// Where a dragged tile goes. While a tile is dragged, the others make room for it at once, as on
// the Windows 8 Start screen: the group shows the layout with the dragged tile moved to the
// place that lands it closest to where it is held. No DOM.
import { layoutTiles } from './layout.js';
import type { LayoutOptions, LayoutResult, TileSpan } from './layout.js';

// The order with the tile at `from` moved to `to` (an index in the resulting list).
export function moveIndex<T>(list: T[], from: number, to: number): T[] {
    const out = list.slice();
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
}

export interface DropTarget {
    // Index of the dragged tile in the new order.
    index: number;
    // The layout of the new order.
    layout: LayoutResult;
    // Distance in cells from the dragged tile's place to where it is held.
    distance: number;
}

export interface DropOptions extends LayoutOptions {
    // The index chosen last time. It is kept unless another one is closer by more than
    // `hysteresis` cells, so the others do not flicker back and forth at a boundary.
    current?: number;
    // Default 0.5.
    hysteresis?: number;
}

// `at` is the top left corner of the dragged tile, in cells (fractions allowed).
export function dropTarget(spans: TileSpan[], dragged: number, at: { column: number; row: number }, options: DropOptions): DropTarget {
    const hysteresis = options.hysteresis === undefined ? 0.5 : options.hysteresis;
    let best: DropTarget | null = null;
    let kept: DropTarget | null = null;
    for (let index = 0; index < spans.length; index++) {
        const layout = layoutTiles(moveIndex(spans, dragged, index), options);
        const p = layout.placements[index];
        const distance = Math.hypot(p.column - at.column, p.row - at.row);
        const candidate = { index, layout, distance };
        if (!best || distance < best.distance) best = candidate;
        if (index === options.current) kept = candidate;
    }
    if (kept && best && kept.distance - best.distance <= hysteresis) return kept;
    return best!;
}
