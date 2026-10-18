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

export type Direction = 'left' | 'right' | 'up' | 'down';

// Cells per step in each direction.
const STEPS: Record<Direction, { x: number; y: number }> = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
};

// The index a tile moves to with the keyboard, or `from` when it cannot move that way. The target
// steps a cell at a time from the tile's place; the first index that moves the tile on in that
// direction wins, so a step that only shifts the tile back (or lands it where it was) goes on.
export function keyboardTarget(spans: TileSpan[], from: number, direction: Direction, options: LayoutOptions): number {
    const layout = layoutTiles(spans, options);
    const at = layout.placements[from];
    const d = STEPS[direction];
    // Across the group is fixed (its rows or columns); along it the group grows, one cell past
    // its layout is as far as a tile goes.
    const vertical = options.orientation === 'vertical';
    const across = vertical ? options.columns || 1 : options.rows || 1;
    const limitColumn = vertical ? across : layout.columns + 1;
    const limitRow = vertical ? layout.rows + 1 : across;
    for (let k = 1; ; k++) {
        const target = { column: at.column + d.x * k, row: at.row + d.y * k };
        if (target.column < 0 || target.row < 0 || target.column >= limitColumn || target.row >= limitRow) return from;
        const r = dropTarget(spans, from, target, { ...options, current: from, hysteresis: 0 });
        if (r.index === from) continue;
        const p = r.layout.placements[r.index];
        if ((p.column - at.column) * d.x + (p.row - at.row) * d.y > 0) return r.index;
    }
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
