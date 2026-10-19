import { describe, expect, test } from 'bun:test';
import { bandCount, bandOffsets, spanMiddle } from '../src/boundary.js';

describe('bandOffsets', () => {
    test('counts the bands of the members before each one along the axis', () => {
        // Given out of order: the one at 0 comes first, then 300, then 600.
        expect(bandOffsets([300, 0, 600], [2, 3, 1])).toEqual([3, 0, 5]);
    });

    test('keeps the order of the lists for equal edges', () => {
        expect(bandOffsets([0, 0, 0], [1, 2, 4])).toEqual([0, 1, 3]);
        expect(bandOffsets([50, 0, 50], [1, 2, 4])).toEqual([2, 0, 3]);
    });

    test('is 0 for a member alone', () => {
        expect(bandOffsets([420], [5])).toEqual([0]);
        expect(bandOffsets([], [])).toEqual([]);
    });
});

describe('spanMiddle', () => {
    test('is the middle of the union of the spans', () => {
        expect(spanMiddle([100, 160], [272, 332])).toBe(216);
        expect(spanMiddle([0], [10])).toBe(5);
    });
});

describe('bandCount', () => {
    test('rounds a partial band up', () => {
        expect(bandCount(8, 4)).toBe(2);
        expect(bandCount(6, 4)).toBe(2);
        expect(bandCount(4, 4)).toBe(1);
        expect(bandCount(0, 4)).toBe(0);
        expect(bandCount(3, 0)).toBe(3);
    });
});
