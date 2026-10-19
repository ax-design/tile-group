// The entrance and the exit of the tile group, as Windows draws them: the parameters, read from
// the custom properties of the group, and the state of a tile at a moment. No DOM, apart from
// readParams() reading a style declaration.
import { bezierAt, parseEasing } from '@ax-design/surface';
import type { Bezier } from '@ax-design/surface';
import { parseLength } from '@ax-design/typed-om';

export type EntranceVariant = 'desktop' | 'mobile';

// The values read from the group when an animation starts.
export interface Params {
    // px to the right of the place, where a desktop tile starts.
    enterOffset: number;
    // ms.
    enterDuration: number;
    enterEasing: Bezier;
    // ms between two columns (rows, vertical).
    enterStagger: number;
    // ms before the first column.
    enterDelay: number;
    // ms.
    exitDuration: number;
    turnstilePerspective: number;
    // ms.
    turnstileDuration: number;
    turnstileEasing: Bezier;
    // Scale and duration of the tiles left when another one is launched.
    launchScale: number;
    launchDuration: number;
}

// The tile state at a moment: px to the right, degrees turned about the left edge of the group,
// and opacity.
export interface EntranceFrame {
    dx: number;
    rotateY: number;
    enter: number;
}

// Windows 8 Start screen: cubic-bezier(0, 0.5, 0.5, 1). Windows Phone turnstile: easeOutQuint.
const DESKTOP_EASING: Bezier = [0, 0.5, 0.5, 1];
const TURNSTILE_EASING: Bezier = [0.22, 1, 0.36, 1];

export function readParams(style: CSSStyleDeclaration): Params {
    const value = (name: string) => style.getPropertyValue(name).trim();
    return {
        enterOffset: parseLengthOr(value('--tile-enter-offset'), 225),
        enterDuration: parseTime(value('--tile-enter-duration'), 1000),
        enterEasing: parseEasingOr(value('--tile-enter-easing'), DESKTOP_EASING),
        enterStagger: parseTime(value('--tile-enter-stagger'), 33),
        enterDelay: parseTime(value('--tile-enter-delay'), 0),
        exitDuration: parseTime(value('--tile-exit-duration'), 200),
        turnstilePerspective: parseLengthOr(value('--tile-turnstile-perspective'), 1000),
        turnstileDuration: parseTime(value('--tile-turnstile-duration'), 600),
        turnstileEasing: parseEasingOr(value('--tile-turnstile-easing'), TURNSTILE_EASING),
        launchScale: parseNumber(value('--tile-launch-exit-scale'), 0.9),
        launchDuration: parseTime(value('--tile-launch-exit-duration'), 150),
    };
}

// <time>: milliseconds or seconds. Anything else, or a negative time, is the fallback.
export function parseTime(text: string, fallback: number): number {
    const m = /^(\d*\.?\d+)(ms|s)$/.exec(text);
    return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : fallback;
}

// <length>, in px only (as typed-om reads it); "0" is a length too.
function parseLengthOr(text: string, fallback: number): number {
    const px = parseLength(text);
    return px === null || !isFinite(px) ? fallback : px;
}

function parseNumber(text: string, fallback: number): number {
    return /^[+-]?(\d*\.?\d+)(e[+-]?\d+)?$/i.test(text) ? parseFloat(text) : fallback;
}

function parseEasingOr(text: string, fallback: Bezier): Bezier {
    return parseEasing(text) || fallback;
}

// A variant name, or null for none (and for anything else).
export function parseVariant(attribute: string | null): EntranceVariant | null {
    return attribute === 'desktop' || attribute === 'mobile' ? attribute : null;
}

export function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

// The share of a duration that t (in the same unit) makes.
function progress(t: number, duration: number): number {
    return duration > 0 ? clamp01(t / duration) : 1;
}

// Desktop entrance: a tile starts `delay` ms after the start, and moves from enterOffset px to
// the right while it fades in.
export function enterDesktop(t: number, delay: number, p: Params): EntranceFrame {
    const e = bezierAt(p.enterEasing, progress(t - delay, p.enterDuration));
    return { dx: p.enterOffset * (1 - e), rotateY: 0, enter: e };
}

// Desktop exit: the tiles fade out, without moving.
export function exitDesktop(t: number, p: Params): EntranceFrame {
    return { dx: 0, rotateY: 0, enter: 1 - progress(t, p.exitDuration) };
}

// Mobile entrance and exit: the turnstile. `fraction` is the share of the duration that has
// passed, `begin` the share at which the tile starts (see turnstileBegin).
export function turnstile(fraction: number, begin: number, entering: boolean, p: Params): EntranceFrame {
    const e = bezierAt(p.turnstileEasing, clamp01((fraction - begin) / (1 - begin)));
    return entering ? { dx: 0, rotateY: 90 * (1 - e), enter: e } : { dx: 0, rotateY: 90 * e, enter: 1 - e };
}

// The share of the duration at which a tile starts its turn. Tiles lower in the group start
// later, tiles to the right start later when entering and earlier when exiting, and a random
// part of 10% varies the rest.
export function turnstileBegin(x: number, y: number, entering: boolean, random: number): number {
    const k = entering ? 0.00047 : -0.00047;
    // At most 0.9, so every turn has some time to run.
    return Math.min(0.9, Math.max(0, y * 0.001714 + x * k + random * 0.1));
}
