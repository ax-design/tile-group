import { describe, expect, test } from 'bun:test';
import { dropTarget, keyboardTarget, moveIndex } from '../src/reorder.js';
import { layoutTiles } from '../src/layout.js';
import type { Direction } from '../src/reorder.js';

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

describe('dropTarget, vertical', () => {
    test('the dragged tile goes where it is held', () => {
        // Four medium tiles in a six-cell group: three in the first row, one below.
        const spans = [medium, medium, medium, medium];
        const t = dropTarget(spans, 0, { column: 0, row: 2 }, { orientation: 'vertical', columns: 6, strip: 2 });
        expect(t.index).toBe(3);
        expect(t.layout.placements[3]).toEqual({ column: 0, row: 2 });
    });
});

describe('keyboardTarget', () => {
    const DIRECTIONS: Direction[] = ['left', 'right', 'up', 'down'];
    const grid = { rows: 4, strip: 4 };

    test('a medium tile moves to the neighbour in each direction', () => {
        // Four medium tiles in two columns: 0 and 1 side by side, 2 and 3 below them.
        const spans = [medium, medium, medium, medium];
        const to = (from: number, direction: Direction) => keyboardTarget(spans, from, direction, grid);
        expect([to(0, 'right'), to(0, 'down')]).toEqual([1, 2]);
        expect([to(1, 'left'), to(1, 'down')]).toEqual([0, 3]);
        expect([to(2, 'right'), to(2, 'up')]).toEqual([3, 0]);
        expect([to(3, 'left'), to(3, 'up')]).toEqual([2, 1]);
    });

    test('a vertical group moves a medium tile across its rows', () => {
        // Four medium tiles in a six-cell group: three in the first row, one below.
        const spans = [medium, medium, medium, medium];
        const options = { orientation: 'vertical' as const, columns: 6, strip: 2 };
        const to = (from: number, direction: Direction) => keyboardTarget(spans, from, direction, options);
        expect([to(0, 'right'), to(0, 'down')]).toEqual([1, 3]);
        // Nothing below the last tile of the first row: the way down is the same place.
        expect([to(2, 'left'), to(2, 'down')]).toEqual([1, 2]);
        expect(to(3, 'up')).toBe(0);
    });

    test('mixed sizes: a move goes the way of the key', () => {
        const spans = [small, medium, wide, small, medium, small];
        for (const options of [{ rows: 4 }, { rows: 2, strip: 1 }, { orientation: 'vertical' as const, columns: 6, strip: 2 }]) {
            const before = layoutTiles(spans, options).placements;
            spans.forEach((_, from) => {
                for (const direction of DIRECTIONS) {
                    const to = keyboardTarget(spans, from, direction, options);
                    if (to === from) continue;
                    // The tile ends up further along the key, the others keep their order.
                    const after = layoutTiles(moveIndex(spans, from, to), options).placements[to];
                    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
                    const along = (after.column - before[from].column) * dx + (after.row - before[from].row) * dy;
                    expect(along).toBeGreaterThan(0);
                }
            });
        }
    });

    test('the edges of the group stop a tile', () => {
        const spans = [medium, medium, medium, medium];
        expect(keyboardTarget(spans, 0, 'left', grid)).toBe(0);
        expect(keyboardTarget(spans, 0, 'up', grid)).toBe(0);
        expect(keyboardTarget(spans, 3, 'right', grid)).toBe(3);
        expect(keyboardTarget(spans, 3, 'down', grid)).toBe(3);
        // A vertical group grows downward: the last tile can not move on from its row.
        const vertical = { orientation: 'vertical' as const, columns: 6, strip: 2 };
        expect(keyboardTarget(spans, 2, 'right', vertical)).toBe(2);
        expect(keyboardTarget([small], 0, 'right', { rows: 1 })).toBe(0);
        expect(keyboardTarget([small], 0, 'down', { rows: 1 })).toBe(0);
    });
});
