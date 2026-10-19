import { describe, expect, test } from 'bun:test';
import { bandShift, enterDesktop, exitDesktop, parseTime, parseVariant, readParams, turnstile, turnstileBegin } from '../src/entrance.js';

// A style declaration with only the given custom properties.
const style = (values: Record<string, string>) => ({ getPropertyValue: (name: string) => values[name] || '' }) as CSSStyleDeclaration;

describe('parseTime', () => {
    test('reads milliseconds and seconds', () => {
        expect(parseTime('1000ms', 5)).toBe(1000);
        expect(parseTime('1s', 5)).toBe(1000);
        expect(parseTime('0.5s', 5)).toBe(500);
        expect(parseTime('33ms', 5)).toBe(33);
    });

    test('falls back on anything else', () => {
        expect(parseTime('', 7)).toBe(7);
        expect(parseTime('100', 7)).toBe(7);
        expect(parseTime('-1s', 7)).toBe(7);
        expect(parseTime('calc(1s)', 7)).toBe(7);
    });
});

describe('readParams', () => {
    test('uses the defaults when nothing is set', () => {
        const p = readParams(style({}));
        expect(p.enterOffset).toBe(null);
        expect(p.enterSpread).toBe(0.93);
        expect(p.enterBand).toBe(null);
        expect(p.enterDuration).toBe(530);
        expect(p.enterScale).toBe(0.8);
        expect(p.enterScaleDuration).toBe(450);
        expect(p.enterScaleEasing).toEqual([0.1, 0.9, 0.2, 1]);
        expect(p.enterFade).toBe(133);
        expect(p.enterStagger).toBe(35);
        expect(p.enterDelay).toBe(0);
        expect(p.exitDuration).toBe(200);
        expect(p.turnstilePerspective).toBe(1000);
        expect(p.turnstileDuration).toBe(600);
        expect(p.launchScale).toBe(0.9);
        expect(p.launchDuration).toBe(100);
        expect(p.enterEasing).toEqual([0.17, 0.55, 0.3, 0.95]);
        expect(p.turnstileEasing).toEqual([0.22, 1, 0.36, 1]);
    });

    test('reads the custom properties, and falls back on invalid ones', () => {
        const p = readParams(style({ '--tile-enter-offset': ' 100px ', '--tile-enter-duration': '2s', '--tile-enter-easing': 'linear', '--tile-enter-delay': 'soon', '--tile-launch-exit-scale': '0.5', '--tile-turnstile-easing': 'cubic-bezier(0, 0, 1, 1)' }));
        expect(p.enterOffset).toBe(100);
        expect(p.enterDuration).toBe(2000);
        expect(p.enterEasing).toEqual([0, 0, 1, 1]);
        expect(p.enterDelay).toBe(0);
        expect(p.launchScale).toBe(0.5);
        expect(p.turnstileEasing).toEqual([0, 0, 1, 1]);
    });

    test('takes 0 as a length, and a bad easing as the default', () => {
        const p = readParams(style({ '--tile-enter-offset': '0', '--tile-enter-easing': 'steps(4)' }));
        expect(p.enterOffset).toBe(0);
        expect(p.enterEasing).toEqual([0.17, 0.55, 0.3, 0.95]);
    });
});

describe('parseVariant', () => {
    test('is desktop or mobile, or none', () => {
        expect(parseVariant('desktop')).toBe('desktop');
        expect(parseVariant('mobile')).toBe('mobile');
        expect(parseVariant('')).toBe(null);
        expect(parseVariant('Mobile')).toBe(null);
        expect(parseVariant(null)).toBe(null);
    });
});

describe('the curves', () => {
    const p = readParams(style({}));

    test('a desktop band starts shifted, small and transparent, and ends in place', () => {
        expect(enterDesktop(0, 0, 60, p)).toEqual({ dx: 60, scale: 0.8, rotateY: 0, enter: 0 });
        // It has faded in before it has grown, and grown before it has arrived, as in Windows.
        const faded = enterDesktop(133, 0, 60, p);
        expect(faded.enter).toBe(1);
        expect(faded.scale).toBeLessThan(1);
        expect(1 - faded.scale).toBeLessThan(0.2 * (faded.dx / 60));
        const end = enterDesktop(530, 0, 60, p);
        expect(end.scale).toBeCloseTo(1, 9);
        expect(end.dx).toBeCloseTo(0, 9);
        expect(end.enter).toBeCloseTo(1, 9);
        // A delayed band waits.
        expect(enterDesktop(100, 200, 60, p).enter).toBe(0);
    });

    test('a band starts drawn toward the middle of the viewport, and 1% of it further on', () => {
        // 1000 px wide viewport: the middle is at 500, the offset 10 px.
        expect(bandShift(500, 500, 1000, p)).toBeCloseTo(10, 9);
        // Left of the middle: it starts to the right, 7% of the way, and the other way on the right.
        expect(bandShift(100, 500, 1000, p)).toBeCloseTo(0.07 * 400 + 10, 9);
        expect(bandShift(900, 500, 1000, p)).toBeCloseTo(-0.07 * 400 + 10, 9);
        // A set offset takes the place of the 1%.
        expect(bandShift(500, 500, 1000, readParams(style({ '--tile-enter-offset': '24px' })))).toBeCloseTo(24, 9);
    });

    test('the desktop exit fades without moving', () => {
        expect(exitDesktop(0, p).enter).toBe(1);
        expect(exitDesktop(200, p).enter).toBe(0);
        expect(exitDesktop(100, p).dx).toBe(0);
    });

    test('a turnstile turns from 90 degrees to 0 and back', () => {
        expect(turnstile(0, 0, true, p)).toEqual({ dx: 0, scale: 1, rotateY: 90, enter: 0 });
        const end = turnstile(1, 0.3, true, p);
        expect(end.rotateY).toBeCloseTo(0, 9);
        expect(end.enter).toBeCloseTo(1, 9);
        expect(turnstile(1, 0.3, false, p).rotateY).toBeCloseTo(90, 9);
        expect(turnstile(1, 0.3, false, p).enter).toBeCloseTo(0, 9);
    });

    test('a turn starts after its share of the duration, with a bounded start', () => {
        expect(turnstileBegin(0, 0, true, 0)).toBe(0);
        expect(turnstileBegin(0, 100000, true, 0)).toBe(0.9);
        expect(turnstileBegin(100000, 0, false, 0)).toBe(0);
        expect(turnstileBegin(0, 300, true, 0)).toBeCloseTo(0.5142, 3);
        expect(turnstileBegin(1000, 0, true, 0)).toBeCloseTo(0.47, 9);
        expect(turnstileBegin(1000, 0, false, 0)).toBe(0);
    });
});
