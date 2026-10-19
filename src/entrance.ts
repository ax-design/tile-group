// The entrance and the exit of the tile group, as Windows draws them: the parameters, read from
// the custom properties of the group, and the state of a tile at a moment. No DOM, apart from
// readParams() reading a style declaration.
import { bezierAt, parseEasing } from '@ax-design/surface';
import type { Bezier } from '@ax-design/surface';
import { parseLength } from '@ax-design/typed-om';

export type EntranceVariant = 'desktop' | 'mobile';

// The values read from the group when an animation starts.
export interface Params {
    // px to the right of the place, where a desktop band starts on top of its spread; null for 1%
    // of the width of the viewport.
    enterOffset: number | null;
    // The bands start at this share of their distance from the middle of the viewport, along the
    // group, and open out to their places.
    enterSpread: number;
    // ms, of the move.
    enterDuration: number;
    enterEasing: Bezier;
    // The scale a band starts at, and the ms and curve of its growth to 1.
    enterScale: number;
    enterScaleDuration: number;
    enterScaleEasing: Bezier;
    // ms, of the fade in, linear.
    enterFade: number;
    // Columns (rows, vertical) in a band: the tiles that enter together, as one picture. null for
    // the strip of the group, a column of the Start screen.
    enterBand: number | null;
    // ms between two bands.
    enterStagger: number;
    // ms before the first column.
    enterDelay: number;
    // ms.
    exitDuration: number;
    turnstilePerspective: number;
    // px to the left of the left edge of the viewport, where the vertical axis of the turn is.
    turnstileOrigin: number;
    // ms.
    turnstileDuration: number;
    turnstileEasing: Bezier;
    // Scale and duration of the tiles left when another one is launched.
    launchScale: number;
    launchDuration: number;
}

// The tile state at a moment: px to the right, scale about its middle, degrees turned about the
// axis of the turnstile (see turnstileOrigin), and opacity.
export interface EntranceFrame {
    dx: number;
    scale: number;
    rotateY: number;
    enter: number;
}

// The desktop numbers are fitted, tile by tile, to a 60 fps recording of Windows 8.1 (within 2 px
// of every tile in every frame), with curves of the Windows animation theme. The Start screen
// enters in bands, the columns of the Start screen (two medium tiles wide), 35 ms apart across all the groups. A band is one picture:
// it grows from 0.8 with curve 4 in about 450 ms, about the middle of its width and of the height
// of the group, and fades in, linear, in about 133 ms. The bands start drawn together toward the
// middle of the screen (at 93% of their distance from it) and 1% of its width to the right, and
// open out with curve 61 in about 530 ms: the bands on the left travel the most. Windows Phone
// turnstile: easeOutQuint.
const DESKTOP_EASING: Bezier = [0.17, 0.55, 0.3, 0.95];
const DESKTOP_SCALE_EASING: Bezier = [0.1, 0.9, 0.2, 1];
const TURNSTILE_EASING: Bezier = [0.22, 1, 0.36, 1];

export function readParams(style: CSSStyleDeclaration): Params {
    const value = (name: string) => style.getPropertyValue(name).trim();
    return {
        enterOffset: parseLengthOr(value('--tile-enter-offset'), null),
        enterSpread: parseNumber(value('--tile-enter-spread'), 0.93),
        enterDuration: parseTime(value('--tile-enter-duration'), 530),
        enterEasing: parseEasingOr(value('--tile-enter-easing'), DESKTOP_EASING),
        enterScale: parseNumber(value('--tile-enter-scale'), 0.8),
        enterScaleDuration: parseTime(value('--tile-enter-scale-duration'), 450),
        enterScaleEasing: parseEasingOr(value('--tile-enter-scale-easing'), DESKTOP_SCALE_EASING),
        enterFade: parseTime(value('--tile-enter-fade'), 133),
        enterBand: parseBand(value('--tile-enter-band')),
        enterStagger: parseTime(value('--tile-enter-stagger'), 35),
        enterDelay: parseTime(value('--tile-enter-delay'), 0),
        exitDuration: parseTime(value('--tile-exit-duration'), 200),
        turnstilePerspective: parseLengthOr(value('--tile-turnstile-perspective'), 1000),
        turnstileOrigin: parseLengthOr(value('--tile-turnstile-origin'), 0),
        turnstileDuration: parseTime(value('--tile-turnstile-duration'), 600),
        turnstileEasing: parseEasingOr(value('--tile-turnstile-easing'), TURNSTILE_EASING),
        launchScale: parseNumber(value('--tile-launch-exit-scale'), 0.9),
        // About 100 ms in a 60 fps recording of Windows 8.1.
        launchDuration: parseTime(value('--tile-launch-exit-duration'), 100),
    };
}

// <time>: milliseconds or seconds. Anything else, or a negative time, is the fallback.
export function parseTime(text: string, fallback: number): number {
    const m = /^(\d*\.?\d+)(ms|s)$/.exec(text);
    return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : fallback;
}

// <length>, in px only (as typed-om reads it); "0" is a length too.
function parseLengthOr<T>(text: string, fallback: T): number | T {
    const px = parseLength(text);
    return px === null || !isFinite(px) ? fallback : px;
}

// A whole number of columns, 1 or more; null for anything else.
function parseBand(text: string): number | null {
    const n = parseNumber(text, NaN);
    return n >= 1 ? Math.round(n) : null;
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

// Desktop entrance: a band starts `delay` ms after the start; it moves from `shift` px away from
// its place (see bandShift) and grows from enterScale while it fades in. The fade is the fastest,
// the move the slowest.
export function enterDesktop(t: number, delay: number, shift: number, p: Params): EntranceFrame {
    const move = bezierAt(p.enterEasing, progress(t - delay, p.enterDuration));
    const grow = bezierAt(p.enterScaleEasing, progress(t - delay, p.enterScaleDuration));
    return { dx: shift * (1 - move), scale: p.enterScale + (1 - p.enterScale) * grow, rotateY: 0, enter: progress(t - delay, p.enterFade) };
}

// Where a band starts, in px from its place along the group: drawn toward the middle of the
// viewport by its spread, and enterOffset further on (to the right, or down when vertical).
// `middle` is the middle of the band, `center` the one of the viewport, `size` its width (height).
export function bandShift(middle: number, center: number, size: number, p: Params): number {
    const offset = p.enterOffset === null ? size * 0.01 : p.enterOffset;
    return (1 - p.enterSpread) * (center - middle) + offset;
}

// The length of a desktop entrance of one tile: the longest of its move, its growth and its fade.
export function enterLength(p: Params): number {
    return Math.max(p.enterDuration, p.enterScaleDuration, p.enterFade);
}

// Desktop exit: the tiles fade out, without moving.
export function exitDesktop(t: number, p: Params): EntranceFrame {
    return { dx: 0, scale: 1, rotateY: 0, enter: 1 - progress(t, p.exitDuration) };
}

// The origin of a tile's turn, in its own px, from its resting place (`left`, `top`, in px of the
// viewport): every tile turns about the same vertical line, `origin` px left of the viewport, with
// one vanishing point at the middle of the viewport's height, as WinJS does
// (collectTurnstileTransformOrigins, with 40 px).
export function turnstileOrigin(left: number, top: number, origin: number, viewportHeight: number): { x: number; y: number } {
    return { x: -(origin + left), y: viewportHeight / 2 - top };
}

// Mobile entrance and exit: the turnstile. `fraction` is the share of the duration that has
// passed, `begin` the share at which the tile starts (see turnstileBegin).
export function turnstile(fraction: number, begin: number, entering: boolean, p: Params): EntranceFrame {
    const e = bezierAt(p.turnstileEasing, clamp01((fraction - begin) / (1 - begin)));
    return entering ? { dx: 0, scale: 1, rotateY: 90 * (1 - e), enter: e } : { dx: 0, scale: 1, rotateY: 90 * e, enter: 1 - e };
}

// The share of the duration at which a tile starts its turn. Tiles lower in the group start
// later, tiles to the right start later when entering and earlier when exiting, and a random
// part of 10% varies the rest.
export function turnstileBegin(x: number, y: number, entering: boolean, random: number): number {
    const k = entering ? 0.00047 : -0.00047;
    // At most 0.9, so every turn has some time to run.
    return Math.min(0.9, Math.max(0, y * 0.001714 + x * k + random * 0.1));
}
