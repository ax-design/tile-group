import { describe, expect, test } from 'bun:test';
import { layoutTiles } from '../src/layout.js';
import fixtures from './oracle/winjs-fixtures.json';

const spans = (items: number[][]) => items.map((it) => ({ columns: it[0], rows: it[1], newColumn: !!it[2] }));
const cells = (r: ReturnType<typeof layoutTiles>) => r.placements.map((p) => [p.column, p.row]);

describe('layoutTiles', () => {
    test('matches the WinJS cell-spanning layout', () => {
        // Recorded from WinJS by test/oracle/generate.ts.
        for (const f of fixtures as { rows: number; items: number[][]; winjs: number[][] }[]) {
            expect(cells(layoutTiles(spans(f.items), { rows: f.rows }))).toEqual(f.winjs);
        }
    });

    test('medium tiles fill a column of the group top to bottom', () => {
        const r = layoutTiles(spans([[2, 2], [2, 2], [2, 2], [2, 2]]), { rows: 4 });
        expect(cells(r)).toEqual([[0, 0], [0, 2], [2, 0], [2, 2]]);
        expect(r.columns).toBe(4);
    });

    test('strips of two medium tiles fill row by row', () => {
        const r = layoutTiles(spans([[2, 2], [2, 2], [2, 2], [2, 2], [4, 2]]), { rows: 4, strip: 4 });
        expect(cells(r)).toEqual([[0, 0], [2, 0], [0, 2], [2, 2], [4, 0]]);
    });

    test('a tile never goes in front of the one before it', () => {
        // The wide tile goes below the medium one and leaves the top right free; the small
        // tile after it takes the top of column 2, the medium tile after that the top of
        // column 3. A later small tile does not go back to the free cell at (2, 1): it takes
        // the next free cell after the medium tile, below it.
        const r = layoutTiles(spans([[2, 2], [4, 2], [1, 1], [2, 2], [1, 1]]), { rows: 4 });
        expect(cells(r)).toEqual([[0, 0], [0, 2], [2, 0], [3, 0], [4, 2]]);
    });

    test('a tile taller than the group starts a new column at the top', () => {
        const r = layoutTiles(spans([[1, 1], [2, 6]]), { rows: 4 });
        expect(cells(r)).toEqual([[0, 0], [1, 0]]);
    });

    test('newColumn starts the next column', () => {
        const r = layoutTiles(spans([[1, 1], [1, 1, 1]]), { rows: 4 });
        expect(cells(r)).toEqual([[0, 0], [1, 0]]);
    });
});

describe('vertical orientation', () => {
    const v = (items: number[][], columns: number, strip = 2) => layoutTiles(spans(items), { orientation: 'vertical', columns, strip });

    test('medium tiles fill a six-cell group row by row', () => {
        const r = v([[2, 2], [2, 2], [2, 2], [2, 2]], 6);
        expect(cells(r)).toEqual([[0, 0], [2, 0], [4, 0], [0, 2]]);
        expect([r.columns, r.rows]).toEqual([6, 4]);
    });

    test('a wide tile and medium tiles', () => {
        const r = v([[4, 2], [2, 2], [2, 2], [4, 4]], 6);
        expect(cells(r)).toEqual([[0, 0], [4, 0], [0, 2], [2, 2]]);
        expect(r.rows).toBe(6);
    });

    test('it is the horizontal layout of the turned tiles, turned back', () => {
        for (const f of (fixtures as { rows: number; items: number[][] }[]).slice(0, 60)) {
            const across = layoutTiles(spans(f.items.map((it) => [it[1], it[0], it[2]])), { rows: f.rows, strip: 2 });
            const down = layoutTiles(spans(f.items), { orientation: 'vertical', columns: f.rows, strip: 2 });
            expect(cells(down)).toEqual(across.placements.map((p) => [p.row, p.column]));
            expect([down.columns, down.rows]).toEqual([across.rows, across.columns]);
        }
    });
});
