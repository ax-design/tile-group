import { describe, expect, test } from 'bun:test';
import { enterDesktop, exitDesktop, parseTime, parseVariant, readParams, turnstile, turnstileBegin } from '../src/entrance.js';

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
        expect(p.enterOffset).toBe(225);
        expect(p.enterDuration).toBe(1000);
        expect(p.enterStagger).toBe(33);
        expect(p.enterDelay).toBe(0);
        expect(p.exitDuration).toBe(200);
        expect(p.turnstilePerspective).toBe(1000);
        expect(p.turnstileDuration).toBe(600);
        expect(p.launchScale).toBe(0.9);
        expect(p.launchDuration).toBe(150);
        expect(p.enterEasing).toEqual([0, 0.5, 0.5, 1]);
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
        expect(p.enterEasing).toEqual([0, 0.5, 0.5, 1]);
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

    test('a desktop tile starts offset and transparent, and ends in place', () => {
        expect(enterDesktop(0, 0, p)).toEqual({ dx: 225, rotateY: 0, enter: 0 });
        const end = enterDesktop(1000, 0, p);
        expect(end.dx).toBeCloseTo(0, 9);
        expect(end.enter).toBeCloseTo(1, 9);
        // A delayed tile waits.
        expect(enterDesktop(100, 200, p).enter).toBe(0);
    });

    test('the desktop exit fades without moving', () => {
        expect(exitDesktop(0, p).enter).toBe(1);
        expect(exitDesktop(200, p).enter).toBe(0);
        expect(exitDesktop(100, p).dx).toBe(0);
    });

    test('a turnstile turns from 90 degrees to 0 and back', () => {
        expect(turnstile(0, 0, true, p)).toEqual({ dx: 0, rotateY: 90, enter: 0 });
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
