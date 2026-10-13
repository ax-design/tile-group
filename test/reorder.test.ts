import { describe, expect, test } from 'bun:test';
import { dropTarget, moveIndex } from '../src/reorder.js';

const medium = { columns: 2, rows: 2 };
const wide = { columns: 4, rows: 2 };
const small = { columns: 1, rows: 1 };

describe('dropTarget', () => {
    test('moveIndex', () => {
        expect(moveIndex(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(moveIndex(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    });

    test('the dragged tile goes where it is held, the others make room', () => {
        // Four medium tiles in two columns; hold the first one over the top of column 2.
        const spans = [medium, medium, medium, medium];
        const t = dropTarget(spans, 0, { column: 2, row: 0 }, { rows: 4 });
        expect(t.index).toBe(2);
        expect(t.layout.placements[2]).toEqual({ column: 2, row: 0 });
        expect(t.distance).toBe(0);
    });

    test('held between places, the closer one wins', () => {
        const spans = [medium, medium, medium, medium];
        expect(dropTarget(spans, 0, { column: 2.2, row: 1.4 }, { rows: 4 }).index).toBe(3);
        expect(dropTarget(spans, 0, { column: 2.2, row: 0.6 }, { rows: 4 }).index).toBe(2);
    });

    test('the current place is kept near a boundary', () => {
        const spans = [medium, medium, medium, medium];
        // Exactly between rows 0 and 2 of column 2: both are 1 cell away.
        expect(dropTarget(spans, 0, { column: 2, row: 1.2 }, { rows: 4, current: 2 }).index).toBe(2);
        expect(dropTarget(spans, 0, { column: 2, row: 1.2 }, { rows: 4, current: 3 }).index).toBe(3);
        // Far enough from it, it changes.
        expect(dropTarget(spans, 0, { column: 2, row: 2 }, { rows: 4, current: 2 }).index).toBe(3);
    });

    test('a wide tile pushes the rest along when dropped in front', () => {
        const spans = [medium, medium, small, wide];
        const t = dropTarget(spans, 3, { column: 0, row: 0 }, { rows: 4 });
        expect(t.index).toBe(0);
        // Wide on top, the two medium tiles side by side below it, the small tile in the next
        // column.
        expect(t.layout.placements.map((p) => [p.column, p.row])).toEqual([[0, 0], [0, 2], [2, 2], [4, 0]]);
    });
});
