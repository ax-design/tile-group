// <ax-tile-group>: tiles on a grid of cells, laid out and reordered like the tile groups of the
// Windows 8 Start screen. Every element child is a tile; its `columns` and `rows` attributes
// give its size in cells (2 x 2 when missing). The order of the children is the order of the
// tiles.
//
// Sizes come from custom properties on the group: --tile-cell-width, --tile-cell-height,
// --tile-gap and --tile-rows (a number, or auto for as many rows as the group's height holds).
// With orientation="vertical" the group has a fixed width and grows downward, like the groups
// of the Windows 10 Start menu: --tile-columns (a number, default 6, or auto for as many columns
// as its width holds) takes the place of --tile-rows.
// They are read again whenever the style may have changed, with the triggers of Surface (class
// and attribute changes, hover, media queries and so on); refresh() covers the rest.
//
// The strip attribute sets the fill order (see layout.ts): 4 (default) fills columns two medium
// tiles wide row by row, as the Start screen does; 1 is the column by column order of WinJS,
// which reorders poorly while dragging. Vertical groups take 2 by default: medium tiles fill
// the group row by row.
//
// Gestures, set with attributes:
//   drag="press"    a tile follows the pointer once it moves
//   drag="hold"     a tile lifts after a press of hold-delay ms, then follows the pointer
//   drag="cross-slide"  as on the touch screens of Windows 8, in a horizontal scroller such as
//                   <ax-scroll>: a finger that starts moving up or down drags the tile, one
//                   that starts sideways is left to the scroller; a held tile lifts and drags
//                   in any direction; a mouse drags as with press
//   drag="none"     (default) no dragging
//   contextmenu     a right click, the context menu key, and a touch or pen press held for
//                   hold-delay ms and released without moving fire one event: tilecontextmenu
//   grouping        reserved for dragging tiles onto each other; no events yet
//   Alt+Shift+arrows  moves the focused tile, as the Start menu of Windows does (needs drag)
//
// Events (on the tile, bubbling): tiledragstart (cancelable), tiledragend, tilereorder
// (cancelable, detail { from, to, reason }, reason being pointer, keyboard or api), tilecontextmenu
// (detail { clientX, clientY, pointerType }).
//
// The motion is the one of WinJS (Microsoft's controls for Windows 8 apps): tiles move to new
// places in 367 ms, one after another 33 ms apart (at most 250 ms); a dragged tile grows to 1.05
// and fades to 0.65 in 240 ms while the others shrink to 0.95, and everything settles in 500 ms
// on drop; all on cubic-bezier(0.1, 0.9, 0.2, 1). With prefers-reduced-motion: reduce the same
// end states are set at once, with no motion (as Windows does with "Show animations" off).
//
// The entrance and exit (enter(), exit()) and the launch of a tile (tilelaunchstart and
// tilelaunchend) are drawn by writeTile(), the one writer of a tile's transform, opacity and
// turn. A surface gets its turn and its opacity through motion(), a plain element on its host.
// In an <ax-tile-bound> (see boundary.ts) the desktop entrances of the groups run as one.
import { services } from '@ax-design/surface';
import type { MotionState } from '@ax-design/surface';
import { parseLength, probeLengthPercentage } from '@ax-design/typed-om';
import { bandShift, clamp01, enterDesktop, enterLength, exitDesktop, parseVariant, readParams, turnstile, turnstileBegin, turnstileOrigin } from './entrance.js';
import type { EntranceVariant, EntranceFrame, Params } from './entrance.js';
import { layoutTiles } from './layout.js';
import type { LayoutResult } from './layout.js';
import { dropTarget, keyboardTarget, moveIndex } from './reorder.js';
import type { Direction } from './reorder.js';
import { bandCount, closestBoundary } from './boundary.js';
import type { AxTileBoundary } from './boundary.js';
import { tileSpan } from './tile.js';

const REPOSITION_MS = 367;
const STAGGER_MS = 33;
const STAGGER_CAP_MS = 250;
const LIFT_MS = 240;
const DROP_MS = 500;
const DRAG_SCALE = 1.05;
const DRAG_OPACITY = 0.65;
const OTHERS_SCALE = 0.95;
// Movement in px before a press becomes a drag (or, before a hold, a pan of the page).
const SLOP = 6;
const DEFAULT_HOLD_MS = 500;
const DEFAULT_STRIP = 4;
const DEFAULT_STRIP_VERTICAL = 2;
const DEFAULT_COLUMNS = 6;
// The perspective of a tile that is not turned (the default of a surface's motion).
const DEFAULT_PERSPECTIVE = 1000;

type ReorderReason = 'pointer' | 'keyboard' | 'api';
// How a reorder lays the tiles out: a drop settles them all at once, a move goes one by one.
interface Settle {
    duration: number;
    together: boolean;
}
const MOVE_SETTLE: Settle = { duration: REPOSITION_MS, together: false };
const DROP_SETTLE: Settle = { duration: DROP_MS, together: true };

const STYLE = `
/* Tiles tilt when pressed, like the tiles of Windows. The other tilt properties keep the
   defaults of Surface, which are the ones of the original ax-pressure. Inherited, so a style on
   the group or on one tile overrides it. */
:host { display: block; position: relative; --ax-tilt-mode: absolute; }
::slotted(*) { position: absolute; left: 0; top: 0; box-sizing: border-box; margin: 0;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
:host([drag="press"]) ::slotted(*) { touch-action: none; }
:host([drag="cross-slide"]) ::slotted(*) { touch-action: pan-x pinch-zoom; }
/* The live region of the announcements: read out, never shown. */
.announce { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
`;

interface Metrics {
    cellWidth: number;
    cellHeight: number;
    gap: number;
    // null: as many as the height holds.
    rows: number | null;
    columns: number | null;
}

interface Shown {
    x: number;
    y: number;
    scale: number;
    animation: Motion | null;
}

interface Gesture {
    tile: HTMLElement;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    timer: number;
    held: boolean;
    lifted: boolean;
    dragging: boolean;
    // Pointer minus the tile's top left corner, in px.
    grabX: number;
    grabY: number;
    // Order and index of the dragged tile when the drag started, and the drop index now.
    order: HTMLElement[];
    from: number;
    to: number;
    frame: number;
}

// Where a tile is drawn by the layout, before its look.
interface Placed {
    x: number;
    y: number;
    scale: number;
}

// What the entrance, the launch and the drag add to the drawing of a tile (see writeTile). Each
// one writes its own fields; the opacity is their product.
interface Look {
    // Entrance (desktop): px from the place, and scale about the middle of the tile.
    dx: number;
    dy: number;
    grow: number;
    // Entrance (mobile): degrees turned, the perspective, and the origin of the turn in the tile's
    // own px (see turnstileOrigin).
    rotateY: number;
    perspective: number;
    originX: number;
    originY: number;
    // Opacity of the entrance and the exit.
    enter: number;
    // Launch of another tile: scale about the middle of the group, and its opacity.
    launch: number;
    launchAlpha: number;
    // Opacity of a dragged tile, --tile-drag-opacity.
    drag: number;
    // What the group wrote last, so that it can be taken back.
    wroteOpacity: boolean;
    wroteOrigin: boolean;
    motionKey: string;
}

// The state an entrance leaves its tiles in: before it plays (enter, the tiles wait hidden for
// the group to show), or after an exit (the tiles stay hidden until the next entrance or a
// re-layout).
interface Hold {
    kind: 'enter' | 'exit';
    dx: number;
    dy: number;
    grow: number;
    rotateY: number;
    perspective: number;
    // px left of the viewport, the axis of the turn (--tile-turnstile-origin).
    origin: number;
    enter: number;
}

// An entrance or an exit in progress. `randoms` holds, per tile, the random part of its turn's
// start (mobile). The places and the delays are read from the layout at every frame.
interface Run {
    kind: 'enter' | 'exit';
    variant: EntranceVariant;
    start: number;
    duration: number;
    params: Params;
    randoms: Map<HTMLElement, number>;
    done: () => void;
}

interface Launch {
    // The launched tile when it is a child of this group; null when it is elsewhere on the page.
    source: HTMLElement | null;
    // The middle of the viewport in the group's px, read at the start: every group of the page
    // shrinks toward it, as the whole Start screen of Windows does.
    cx: number;
    cy: number;
    start: number;
    duration: number;
    scale: number;
}

// A child with a motion() method is a surface: its turn and opacity go through it. The group
// does not need the element class for that.
type Motional = HTMLElement & { motion?: (state: MotionState | null) => void };

export interface EntranceOptions {
    variant?: EntranceVariant;
}

const template = typeof document !== 'undefined' ? document.createElement('template') : null;
if (template) template.innerHTML = `<style>${STYLE}</style><slot></slot>`;

export class AxTileGroup extends HTMLElement {
    static readonly ElementName: string = 'ax-tile-group';

    static get observedAttributes() {
        return ['drag', 'strip', 'orientation'];
    }

    private root: ShadowRoot;
    private shown = new Map<HTMLElement, Shown>();
    private resizeObserver: ResizeObserver | null = null;
    private mutationObserver: MutationObserver | null = null;
    private pending = 0;
    private pendingAnimate = false;
    private gesture: Gesture | null = null;
    private lastPointerType = '';
    private lastPointerTime = 0;
    private metrics: Metrics | null = null;
    // The rows (horizontal) or columns (vertical) that auto gave last.
    private autoAcross = 0;
    // Whether the inline width and height are set by the group.
    private ownWidth = false;
    private ownHeight = false;
    private live: HTMLElement | null = null;
    private announceTimer = 0;
    // The look of each tile, and the place it was drawn at before the look (see writeTile).
    private looks = new WeakMap<HTMLElement, Look>();
    private painted = new WeakMap<HTMLElement, Placed>();
    // The entrance or exit running; the state the tiles are left in (null: at rest); the launch in
    // progress; the frame of the loop that runs them; the watch that starts an entrance when the
    // group shows; and whether an entrance has played (it plays once by itself).
    private run: Run | null = null;
    private hold: Hold | null = null;
    private launch: Launch | null = null;
    private animFrame = 0;
    private visibility: IntersectionObserver | null = null;
    private entered = false;
    // The variant of --tile-entrance as the group last read it (see styleTarget).
    private seenVariant: EntranceVariant | null = null;
    // The <ax-tile-bound> around the group, which couples the desktop entrances of its groups;
    // the extent of the layout along the group, in cells; and the band size of the last desktop
    // entrance, in cells.
    private boundary: AxTileBoundary | null = null;
    private extent = 0;
    private bandSize = DEFAULT_STRIP;

    // The words said after a move, for screen readers: position is 1-based, count the tiles. Assign
    // a function to say them in another language.
    describeMove: DescribeMove = describeMoved;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
        this.root.appendChild(template!.content.cloneNode(true));
    }

    connectedCallback() {
        this.addEventListener('pointerdown', this.onPointerDown);
        this.addEventListener('contextmenu', this.onContextMenu);
        // Not passive: a held or dragged touch must not scroll the page.
        this.addEventListener('touchmove', this.onTouchMove, { passive: false } as AddEventListenerOptions);
        this.addEventListener('keydown', this.onKeyMove);
        this.addEventListener('focusin', this.onFocusIn);
        // On the document: a launch anywhere on the page takes the whole screen, not only the group
        // of the tile.
        document.addEventListener('tilelaunchstart', this.onLaunchStart);
        document.addEventListener('tilelaunchend', this.onLaunchEnd);
        if (typeof MutationObserver !== 'undefined') {
            this.mutationObserver = new MutationObserver((records) => this.onMutations(records));
            // Any element can be a tile, so the group watches the size attributes of its children
            // itself: a tile has no way to tell it.
            this.mutationObserver.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['columns', 'rows'] });
        }
        if (typeof ResizeObserver !== 'undefined') {
            // With auto rows or columns, they follow the size.
            this.resizeObserver = new ResizeObserver(() => {
                if (this.isAuto() && this.acrossForSize() !== this.autoAcross) this.schedule(true);
            });
            this.resizeObserver.observe(this);
        }
        // Created once, and in place before any text goes into it: a live region must exist to be read.
        if (!this.live) {
            this.live = document.createElement('div');
            this.live.className = 'announce';
            this.live.setAttribute('role', 'status');
            this.live.setAttribute('aria-live', 'polite');
            this.root.appendChild(this.live);
        }
        services().triggers.add(this, this.styleTarget);
        this.boundary = closestBoundary(this);
        if (this.boundary) this.boundary.add(this);
        this.layout(false);
        this.seenVariant = this.entranceVariant();
        this.watchEntrance();
    }

    // Called by the triggers when the style may have changed: the sizes are read again, and the
    // tiles move only when they changed.
    private styleTarget = {
        invalidateStyle: () => {
            if (this.styleCheck) return;
            this.styleCheck = requestAnimationFrame(() => {
                this.styleCheck = 0;
                // A new variant of the entrance (a media query, a class) ends a running one at once.
                const variant = this.entranceVariant();
                if (variant !== this.seenVariant) {
                    this.seenVariant = variant;
                    if (this.run) this.finishRun();
                    this.primeHold();
                }
                const next = this.readMetrics();
                const now = this.metrics;
                if (now && next.cellWidth === now.cellWidth && next.cellHeight === now.cellHeight && next.gap === now.gap && next.rows === now.rows && next.columns === now.columns) return;
                this.metrics = next;
                this.schedule(true);
            });
        },
    };
    private styleCheck = 0;

    disconnectedCallback() {
        services().triggers.delete(this);
        if (this.styleCheck) cancelAnimationFrame(this.styleCheck);
        this.styleCheck = 0;
        this.removeEventListener('pointerdown', this.onPointerDown);
        this.removeEventListener('contextmenu', this.onContextMenu);
        this.removeEventListener('touchmove', this.onTouchMove);
        this.removeEventListener('keydown', this.onKeyMove);
        this.removeEventListener('focusin', this.onFocusIn);
        document.removeEventListener('tilelaunchstart', this.onLaunchStart);
        document.removeEventListener('tilelaunchend', this.onLaunchEnd);
        if (this.mutationObserver) this.mutationObserver.disconnect();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.mutationObserver = this.resizeObserver = null;
        this.endGesture();
        if (this.pending) cancelAnimationFrame(this.pending);
        this.pending = 0;
        this.stopWatching();
        this.finishRun();
        this.endLaunch();
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        this.animFrame = 0;
        if (this.boundary) this.boundary.delete(this);
        this.boundary = null;
    }

    /**
     * For <ax-tile-bound>: the axis of the group, and the bands of its desktop entrance.
     * @internal
     */
    boundaryInfo(): { vertical: boolean; bands: number } {
        return { vertical: this.vertical, bands: bandCount(this.extent, this.bandSize) };
    }

    attributeChangedCallback(name: string) {
        // touch-action follows the drag mode through the stylesheet.
        if ((name === 'strip' || name === 'orientation') && this.isConnected) this.schedule(true);
    }

    // The tiles, in order.
    get tiles(): HTMLElement[] {
        const out: HTMLElement[] = [];
        for (let el = this.firstElementChild; el; el = el.nextElementSibling) out.push(el as HTMLElement);
        return out;
    }

    // Reads the sizes and lays the tiles out again, for style changes the triggers cannot see
    // (see Surface). Changes of the children, of their columns and rows, and most style changes
    // are picked up by the group itself.
    refresh(): void {
        this.metrics = null;
        this.schedule(true);
    }

    // A layout pass for the records of the observer that concern the children: their list, and
    // their columns and rows. The subtree is observed for the attributes only, so a change inside
    // a tile (a link, a field) is not a change of the layout.
    private onMutations(records: MutationRecord[]) {
        for (const record of records) {
            const ours = record.type === 'childList' ? record.target === this : record.target.parentNode === this;
            if (ours) {
                this.schedule(true);
                return;
            }
        }
    }

    /**
     * Lays the tiles out again, animated.
     * @deprecated The group observes the columns and rows of its children itself. Kept for code
     * written for <ax-tile>, which called this when its size changed.
     */
    tileChanged(): void {
        this.schedule(true);
    }

    private get dragMode(): string {
        const mode = this.getAttribute('drag');
        return mode === 'press' || mode === 'hold' || mode === 'cross-slide' ? mode : 'none';
    }

    private get vertical(): boolean {
        return this.getAttribute('orientation') === 'vertical';
    }

    private get strip(): number {
        const n = parseInt(this.getAttribute('strip') || '', 10);
        return n > 0 ? n : this.vertical ? DEFAULT_STRIP_VERTICAL : DEFAULT_STRIP;
    }

    private get holdDelay(): number {
        const n = parseFloat(this.getAttribute('hold-delay') || '');
        return n >= 0 ? n : DEFAULT_HOLD_MS;
    }

    private schedule(animate: boolean) {
        this.pendingAnimate = this.pendingAnimate || animate;
        if (this.pending) return;
        this.pending = requestAnimationFrame(() => {
            this.pending = 0;
            const a = this.pendingAnimate;
            this.pendingAnimate = false;
            // A drag lays the tiles out itself; the rest waits for its end.
            if (!this.gesture || !this.gesture.dragging) this.layout(a);
        });
    }

    // ----- Sizes -----

    private length(style: CSSStyleDeclaration, name: string, fallback: number): number {
        const text = style.getPropertyValue(name).trim();
        if (!text) return fallback;
        const px = parseLength(text);
        if (px !== null) return px;
        // Unregistered values in other units: resolved by the engine.
        return probeLengthPercentage(this.root, name).px;
    }

    private readMetrics(): Metrics {
        const style = getComputedStyle(this);
        const count = (name: string, fallback: number) => {
            const text = style.getPropertyValue(name).trim();
            return text === 'auto' ? null : Math.max(1, Math.floor(parseFloat(text) || fallback));
        };
        return {
            cellWidth: Math.max(1, this.length(style, '--tile-cell-width', 70)),
            cellHeight: Math.max(1, this.length(style, '--tile-cell-height', 70)),
            gap: Math.max(0, this.length(style, '--tile-gap', 10)),
            rows: count('--tile-rows', 6),
            columns: count('--tile-columns', DEFAULT_COLUMNS),
        };
    }

    // The sizes, read again after refresh().
    private get m(): Metrics {
        if (!this.metrics) this.metrics = this.readMetrics();
        return this.metrics;
    }

    // Rows of a horizontal group, columns of a vertical one: null when auto.
    private fixedAcross(): number | null {
        return this.vertical ? this.m.columns : this.m.rows;
    }

    private isAuto(): boolean {
        return this.fixedAcross() === null;
    }

    // As many as the height (horizontal) or the width (vertical) holds.
    private acrossForSize(): number {
        const m = this.m;
        return this.vertical
            ? Math.max(1, Math.floor((this.clientWidth + m.gap) / (m.cellWidth + m.gap)))
            : Math.max(1, Math.floor((this.clientHeight + m.gap) / (m.cellHeight + m.gap)));
    }

    private across(): number {
        const fixed = this.fixedAcross();
        if (fixed !== null) return fixed;
        this.autoAcross = this.acrossForSize();
        return this.autoAcross;
    }

    private layoutOptions() {
        const across = this.across();
        return this.vertical
            ? { orientation: 'vertical' as const, columns: across, strip: this.strip }
            : { orientation: 'horizontal' as const, rows: across, strip: this.strip };
    }

    // ----- Layout -----

    private layoutOf(order: HTMLElement[]): LayoutResult {
        return layoutTiles(order.map(tileSpan), this.layoutOptions());
    }

    private layout(animate: boolean, order = this.tiles) {
        const result = this.layoutOf(order);
        this.applyLayout(order, result, { animate, scale: 1 });
    }

    // Tiles that move go one after another (the reposition of WinJS), unless `together` is set:
    // settling after a drop starts everywhere at once, so the dropped tile never waits.
    private applyLayout(order: HTMLElement[], result: LayoutResult, options: { animate: boolean; scale: number; skip?: HTMLElement; duration?: number; together?: boolean }) {
        // An entrance reads the places at every frame, so it goes on over a new layout, and the
        // tiles take their new places at once: a move under an entrance would draw them sliding
        // while they come in. Any other run (an exit) ends where it is, and the new layout is then
        // applied as usual.
        if (this.run && this.run.kind !== 'enter' && this.layoutChanges(order, result)) this.finishRun();
        // Nobody sees the moves of tiles that are not shown yet: an entrance waiting or running, or
        // a group the page hides. They take their places at once (an order restored before the page
        // shows the group, for one).
        if (options.animate && !this.movesSeen()) options = { ...options, animate: false };
        // A re-layout brings the tiles of an exit back.
        if (this.hold && this.hold.kind === 'exit') {
            this.hold = null;
            this.showHold();
        }
        const m = this.m;
        const stepX = m.cellWidth + m.gap;
        const stepY = m.cellHeight + m.gap;
        const s = this.style;
        // The group grows along its direction; across it, it is as wide or tall as its fixed
        // rows or columns, or left to the page with auto.
        // Only sizes set here are taken back, never a size of the page's own.
        const fixed = this.fixedAcross();
        const width = this.vertical ? (fixed !== null ? fixed * stepX - m.gap : null) : result.columns * stepX - m.gap;
        const height = this.vertical ? result.rows * stepY - m.gap : fixed !== null ? fixed * stepY - m.gap : null;
        if (width !== null) s.width = `${Math.max(0, width)}px`;
        else if (this.ownWidth) s.width = '';
        if (height !== null) s.height = `${Math.max(0, height)}px`;
        else if (this.ownHeight) s.height = '';
        this.ownWidth = width !== null;
        this.ownHeight = height !== null;
        // The boundary measures the wave of the group again: its size or its bands may have changed.
        this.extent = this.vertical ? result.rows : result.columns;
        if (this.boundary) this.boundary.changed(this);
        let moved = 0;
        order.forEach((tile, i) => {
            const span = tileSpan(tile);
            const p = result.placements[i];
            const ts = tile.style;
            const width = `${span.columns * stepX - m.gap}px`;
            const height = `${span.rows * stepY - m.gap}px`;
            if (ts.width !== width) ts.width = width;
            if (ts.height !== height) ts.height = height;
            if (tile === options.skip) return;
            if (this.place(tile, p.column * stepX, p.row * stepY, options.scale, options.animate, options.together ? 0 : moved, options.duration || REPOSITION_MS)) moved++;
        });
        for (const tile of Array.from(this.shown.keys())) if (tile.parentElement !== this) this.shown.delete(tile);
    }

    // Whether moves of the tiles would be seen: not while an entrance waits or runs, nor while the
    // group is hidden (visibility: hidden, or no box at all).
    private movesSeen(): boolean {
        if (this.hold && this.hold.kind === 'enter') return false;
        if (this.run && this.run.kind === 'enter') return false;
        if (!this.getClientRects().length) return false;
        return getComputedStyle(this).visibility !== 'hidden';
    }

    // Moves a tile to (x, y) at a scale. Returns true when it animates, for the stagger.
    private place(tile: HTMLElement, x: number, y: number, scale: number, animate: boolean, staggerIndex: number, duration: number): boolean {
        const before = this.shown.get(tile);
        if (before && before.x === x && before.y === y && before.scale === scale) return false;
        // Where the tile is drawn now, also in the middle of an animation.
        const from = before ? this.painted.get(tile) : undefined;
        if (before && before.animation) before.animation.cancel();
        let animation: Motion | null = null;
        // Read when the move starts, so a change of the setting applies to the next one.
        if (animate && before && from && !reducedMotion()) {
            const delay = Math.min(STAGGER_CAP_MS, staggerIndex * STAGGER_MS);
            animation = new ScriptedMove((p) => this.paint(tile, p.x, p.y, p.scale), from, { x, y, scale }, duration, delay);
        } else this.paint(tile, x, y, scale);
        this.shown.set(tile, { x, y, scale, animation });
        return !!animation;
    }

    // Whether the layout that is about to be applied moves a tile, resizes one, or changes the set of
    // the tiles.
    private layoutChanges(order: HTMLElement[], result: LayoutResult): boolean {
        if (Array.from(this.shown.keys()).some((tile) => tile.parentElement !== this)) return true;
        const m = this.m;
        const stepX = m.cellWidth + m.gap;
        const stepY = m.cellHeight + m.gap;
        return order.some((tile, i) => {
            const p = result.placements[i];
            const at = this.shown.get(tile);
            const span = tileSpan(tile);
            return !at || at.x !== p.column * stepX || at.y !== p.row * stepY || tile.style.width !== `${span.columns * stepX - m.gap}px` || tile.style.height !== `${span.rows * stepY - m.gap}px`;
        });
    }

    // Draws a tile at a place (before its look): the one call that places a tile.
    private paint(tile: HTMLElement, x: number, y: number, scale: number) {
        this.painted.set(tile, { x, y, scale });
        this.writeTile(tile);
    }

    // ----- Entrance, exit and launch -----

    /**
     * Plays the entrance: the tiles come in from the right (desktop) or turn in from the left edge
     * of the group (mobile). Resolves when the last tile has arrived. The variant defaults to the
     * --tile-entrance, else to "desktop".
     */
    enter(options: EntranceOptions = {}): Promise<void> {
        return this.play('enter', this.variantOf(options));
    }

    /**
     * Plays the exit: the tiles fade out (desktop) or turn away (mobile), and stay invisible until
     * the next enter() or a re-layout. Resolves when the last tile has gone.
     */
    exit(options: EntranceOptions = {}): Promise<void> {
        return this.play('exit', this.variantOf(options));
    }

    private variantOf(options: EntranceOptions): EntranceVariant {
        return parseVariant(options.variant || '') || this.entranceVariant() || 'desktop';
    }

    // The variant the page sets with --tile-entrance (none, or anything else: null).
    private entranceVariant(): EntranceVariant | null {
        return parseVariant(getComputedStyle(this).getPropertyValue('--tile-entrance').trim());
    }

    private play(kind: 'enter' | 'exit', variant: EntranceVariant): Promise<void> {
        // An entrance that is played by hand is not played again when the group shows.
        if (kind === 'enter') {
            this.entered = true;
            this.stopWatching();
        }
        // The one in progress ends where it is, and its promise resolves.
        this.finishRun();
        // The variant the page sets now is the one this run plays: a page that sets
        // --tile-entrance and calls enter() at once must not see the run ended by the style check
        // of the next frame, as a change of variant would end it.
        this.seenVariant = this.entranceVariant();
        const params = readParams(getComputedStyle(this));
        // In a boundary, a desktop entrance joins the wave of the entrances that start with it; any
        // other run leaves it.
        const desktopEnter = kind === 'enter' && variant === 'desktop' && !reducedMotion();
        if (desktopEnter) this.bandSize = params.enterBand || this.strip;
        if (this.boundary) {
            if (desktopEnter) this.boundary.join(this, performance.now());
            else this.boundary.leave(this);
        }
        // The user wants no motion: the end state at once, and the promise on the next frame.
        if (reducedMotion()) {
            this.hold = kind === 'exit' ? holdFor(kind, variant, params) : null;
            this.showHold();
            return nextFrame();
        }
        const duration = variant === 'mobile' ? params.turnstileDuration : kind === 'enter' ? enterLength(params) : params.exitDuration;
        // Mobile: each tile's share of the duration at which its turn starts is worked out from its
        // place at every frame, with this random part.
        const randoms = new Map<HTMLElement, number>();
        for (const tile of this.tiles) randoms.set(tile, Math.random());
        return new Promise<void>((resolve) => {
            this.run = { kind, variant, start: performance.now(), duration, params, randoms, done: resolve };
            this.hold = null;
            this.runFrame(performance.now());
            this.kick();
        });
    }

    // Sets the look of every tile for the moment `now` of the run. The places are read from the
    // layout now, not at the start, so a tile is where the layout puts it.
    private runFrame(now: number) {
        const run = this.run;
        if (!run) return;
        const t = now - run.start;
        const p = run.params;
        const m = this.m;
        let total = run.duration;
        // Desktop entrance: the bands, the middle of the viewport along the group, and the middle of
        // the group across it, in the px of the group.
        const vertical = this.vertical;
        const step = vertical ? m.cellHeight + m.gap : m.cellWidth + m.gap;
        const desktopEnter = run.variant !== 'mobile' && run.kind === 'enter';
        const mobile = run.variant === 'mobile';
        // One layout read per frame: the middle of the viewport (desktop), the origins of the turns
        // (mobile).
        const box = desktopEnter || mobile ? this.getBoundingClientRect() : null;
        const viewport = vertical ? window.innerHeight : window.innerWidth;
        const center = box ? viewport / 2 - (vertical ? box.top : box.left) : 0;
        // In a boundary, the bands go on from those of the groups before this one in the wave, and
        // grow about the middle of the whole wave across the axis (see AxTileBoundary).
        const place = desktopEnter && this.boundary ? this.boundary.place(this) : null;
        const across = place ? place.across : vertical ? this.clientWidth / 2 : this.clientHeight / 2;
        const offset = place ? place.offset : 0;
        const bandSize = p.enterBand || this.strip;
        for (const tile of this.tiles) {
            const at = this.shown.get(tile);
            if (!at) continue;
            let frame: EntranceFrame;
            if (mobile) {
                const begin = turnstileBegin(at.x, at.y, run.kind === 'enter', run.randoms.get(tile) || 0);
                frame = turnstile(run.duration > 0 ? t / run.duration : 1, begin, run.kind === 'enter', p);
                const origin = turnstileOrigin(box!.left + at.x, box!.top + at.y, p.turnstileOrigin, window.innerHeight);
                const look = this.lookOf(tile);
                look.originX = origin.x;
                look.originY = origin.y;
            } else if (desktopEnter) {
                // The band of the tile sets its delay, and it grows as one picture with the other
                // tiles of the band: about the middle of the band along the group, and the middle of
                // the group (or of the wave) across it.
                const band = Math.floor(Math.round((vertical ? at.y : at.x) / step) / bandSize);
                const delay = p.enterDelay + (offset + band) * p.enterStagger;
                total = Math.max(total, delay + run.duration);
                const middle = band * bandSize * step + (bandSize * step - m.gap) / 2;
                frame = enterDesktop(t, delay, bandShift(middle, center, viewport, p), p);
                const half = { x: tile.offsetWidth / 2, y: tile.offsetHeight / 2 };
                const along = (vertical ? at.y + half.y : at.x + half.x) - middle;
                const off = (vertical ? at.x + half.x : at.y + half.y) - across;
                const pull = frame.scale - 1;
                const look = this.lookOf(tile);
                look.dx = vertical ? pull * off : frame.dx + pull * along;
                look.dy = vertical ? frame.dx + pull * along : pull * off;
                look.grow = frame.scale;
                look.rotateY = 0;
                look.perspective = p.turnstilePerspective;
                look.enter = frame.enter;
                this.writeTile(tile);
                continue;
            } else frame = exitDesktop(t, p);
            const look = this.lookOf(tile);
            look.dx = frame.dx;
            look.dy = 0;
            look.grow = frame.scale;
            look.rotateY = frame.rotateY;
            look.perspective = p.turnstilePerspective;
            look.enter = frame.enter;
            this.writeTile(tile);
        }
        if (t >= total) this.finishRun();
    }

    // Ends the entrance or exit in progress at its end state, and resolves its promise.
    private finishRun() {
        const run = this.run;
        if (!run) return;
        this.run = null;
        this.hold = run.kind === 'exit' ? holdFor('exit', run.variant, run.params) : null;
        this.showHold();
        run.done();
    }

    // A drag or a keyboard move ends an entrance or an exit where it is, at its end state; a
    // group that has not shown yet is shown.
    private jumpEntrance() {
        this.finishRun();
        if (this.hold && this.hold.kind === 'enter') {
            this.stopWatching();
            this.entered = true;
            this.hold = null;
            this.showHold();
        }
    }

    // Focus inside the group shows its tiles at once: a keyboard user must see what has the focus,
    // not wait for an entrance to bring it in. An exit is left to run, its tiles are going away.
    private onFocusIn = () => {
        if (this.run && this.run.kind === 'enter') this.finishRun();
        if (this.hold && this.hold.kind === 'enter') this.jumpEntrance();
    };

    // Draws the state of the hold (or none) on every tile.
    private showHold() {
        const hold = this.hold;
        // A turned hold (a waiting turnstile, or the end of its exit) turns about the axis of the
        // turnstile too, from the resting places.
        const box = hold && hold.rotateY ? this.getBoundingClientRect() : null;
        for (const tile of this.tiles) {
            const look = this.lookOf(tile);
            setEntrance(look, hold);
            const at = this.shown.get(tile);
            if (box && hold && at) {
                const origin = turnstileOrigin(box.left + at.x, box.top + at.y, hold.origin, window.innerHeight);
                look.originX = origin.x;
                look.originY = origin.y;
            }
            this.writeTile(tile);
        }
    }

    // The look of a tile; a tile not seen before gets the state of the hold.
    private lookOf(tile: HTMLElement): Look {
        let look = this.looks.get(tile);
        if (!look) {
            look = { dx: 0, dy: 0, grow: 1, rotateY: 0, perspective: DEFAULT_PERSPECTIVE, originX: 0, originY: 0, enter: 1, launch: 1, launchAlpha: 1, drag: 1, wroteOpacity: false, wroteOrigin: false, motionKey: '' };
            setEntrance(look, this.hold);
            this.looks.set(tile, look);
        }
        return look;
    }

    // An entrance that has not played waits for the group to show, and plays the variant the page
    // sets then. Until then its tiles are in their first state, so none shows at rest for a moment.
    private watchEntrance() {
        if (this.entered) return;
        this.primeHold();
        if (typeof IntersectionObserver === 'undefined') {
            const variant = this.entranceVariant();
            if (variant) this.enter({ variant });
            return;
        }
        this.visibility = new IntersectionObserver((entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            const variant = this.entranceVariant();
            if (variant) this.enter({ variant });
        });
        this.visibility.observe(this);
    }

    // The hold of a waiting entrance follows the variant the page sets (none: no hold).
    private primeHold() {
        if (this.entered || (this.hold && this.hold.kind === 'exit')) return;
        const variant = this.entranceVariant();
        this.hold = variant ? holdFor('enter', variant, readParams(getComputedStyle(this))) : null;
        this.showHold();
    }

    private stopWatching() {
        if (this.visibility) this.visibility.disconnect();
        this.visibility = null;
    }

    // The loop that runs the entrance, the exit and the launch, one frame at a time.
    private kick() {
        if (!this.animFrame) this.animFrame = requestAnimationFrame(this.tick);
    }

    private tick = () => {
        this.animFrame = 0;
        const now = performance.now();
        this.runFrame(now);
        const launching = this.launchFrame(now);
        if (this.run || launching) this.kick();
    };

    // A tile launched somewhere on the page: the other tiles shrink toward the middle of the screen
    // and fade, in every group. A listener may still cancel the event after the document, so the
    // decision waits until it has passed them all.
    private onLaunchStart = (event: Event) => {
        const source = this.tileOf(event);
        Promise.resolve().then(() => {
            if (!event.defaultPrevented) this.startLaunch(source);
        });
    };

    // The launched tile is back: the others are restored at once, and an entrance plays again.
    private onLaunchEnd = () => {
        this.endLaunch();
        const variant = this.entranceVariant();
        if (variant) this.enter({ variant });
    };

    private startLaunch(source: HTMLElement | null) {
        const params = readParams(getComputedStyle(this));
        this.clearLaunch();
        // The user wants no motion: the end of the launch at once.
        const duration = reducedMotion() ? 0 : params.launchDuration;
        const rect = this.getBoundingClientRect();
        const cx = window.innerWidth / 2 - rect.left;
        const cy = window.innerHeight / 2 - rect.top;
        this.launch = { source, cx, cy, start: performance.now(), duration, scale: params.launchScale };
        // The launched tile grows toward the middle of the screen: above the others while it does.
        if (source) source.style.zIndex = '2';
        this.launchFrame(performance.now());
        this.kick();
    }

    // Shrinks and fades the others; true while the launch goes on.
    private launchFrame(now: number): boolean {
        const l = this.launch;
        if (!l) return false;
        const t = l.duration > 0 ? clamp01((now - l.start) / l.duration) : 1;
        const e = t >= 1 ? 1 : ease(t);
        for (const tile of this.tiles) {
            if (tile === l.source) continue;
            const look = this.lookOf(tile);
            look.launch = 1 + (l.scale - 1) * e;
            look.launchAlpha = 1 - e;
            this.writeTile(tile);
        }
        return t < 1;
    }

    private endLaunch() {
        if (this.launch && this.launch.source && (!this.gesture || this.gesture.tile !== this.launch.source)) this.launch.source.style.zIndex = '';
        this.launch = null;
        this.clearLaunch();
    }

    private clearLaunch() {
        for (const tile of this.tiles) {
            const look = this.lookOf(tile);
            look.launch = 1;
            look.launchAlpha = 1;
            this.writeTile(tile);
        }
    }

    // The one writer of a tile's drawing. The place and scale come from the layout (or from a
    // move in progress); the look adds the entrance, the launch and the drag fade. A surface gets
    // its turn and its opacity through motion(), and its host only the 2D transform, as acrylic
    // needs (no 3D transform above it in Firefox, no opacity above it anywhere). Any other element
    // gets them on its host, the turn in 3D. Both turn about the origin of the look, which puts the
    // perspective of every tile at the same point (see turnstileOrigin).
    private writeTile(tile: HTMLElement) {
        const at = this.painted.get(tile);
        if (!at) return;
        const look = this.lookOf(tile);
        let x = at.x + look.dx;
        let y = at.y + look.dy;
        // The growth of the entrance is about the middle of the tile, the transform origin.
        let scale = at.scale * look.grow;
        if (look.launch !== 1) {
            // Scaled about the middle of the screen (see Launch). The translate below assumes the
            // transform origin is the middle of the tile, which is the default.
            const l = look.launch;
            const cx = this.launch ? this.launch.cx : this.clientWidth / 2;
            const cy = this.launch ? this.launch.cy : this.clientHeight / 2;
            x = cx + l * (x - cx) - (1 - l) * (tile.offsetWidth / 2);
            y = cy + l * (y - cy) - (1 - l) * (tile.offsetHeight / 2);
            scale *= l;
        }
        const turned = look.rotateY !== 0;
        const alpha = look.enter * look.launchAlpha * look.drag;
        let transform = transformOf(x, y, scale);
        const motion = (tile as Motional).motion;
        if (typeof motion === 'function') {
            tile.style.transform = transform;
            // Written before the child was a surface (the group can connect first): taken back here.
            if (look.wroteOpacity) tile.style.opacity = '';
            if (look.wroteOrigin) tile.style.transformOrigin = '';
            look.wroteOpacity = look.wroteOrigin = false;
            const state: MotionState | null = turned || alpha < 1 ? { opacity: alpha } : null;
            if (state && turned) {
                state.rotateY = look.rotateY;
                state.perspective = look.perspective;
                state.originX = look.originX;
                state.originY = look.originY;
            }
            const key = state ? JSON.stringify(state) : '';
            if (key !== look.motionKey) {
                look.motionKey = key;
                motion.call(tile, state);
            }
            return;
        }
        if (turned) transform += ` perspective(${look.perspective}px) rotateY(${look.rotateY}deg)`;
        tile.style.transform = transform;
        if (turned || look.wroteOrigin) tile.style.transformOrigin = turned ? `${look.originX}px ${look.originY}px` : '';
        look.wroteOrigin = turned;
        if (alpha < 1 || look.wroteOpacity) tile.style.opacity = alpha < 1 ? String(alpha) : '';
        look.wroteOpacity = alpha < 1;
    }

    // The fade of a dragged tile, one frame at a time; a new fade stops the one running.
    private fadeDrag(tile: HTMLElement, to: number, duration: number, done?: () => void) {
        const look = this.lookOf(tile);
        const running = fades.get(tile);
        if (running) cancelAnimationFrame(running);
        fades.delete(tile);
        const from = look.drag;
        const reduced = reducedMotion();
        if (from === to || reduced) {
            look.drag = to;
            this.writeTile(tile);
            // The same moment as a fade: a dropped tile stays above the others until it has landed.
            if (done) window.setTimeout(done, reduced ? 0 : duration);
            return;
        }
        const start = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            if (t >= 1) {
                look.drag = to;
                this.writeTile(tile);
                fades.delete(tile);
                if (done) done();
                return;
            }
            look.drag = from + (to - from) * ease(t);
            this.writeTile(tile);
            fades.set(tile, requestAnimationFrame(step));
        };
        fades.set(tile, requestAnimationFrame(step));
    }

    // ----- Gestures -----

    private tileOf(event: Event): HTMLElement | null {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        for (const node of path) if (node instanceof HTMLElement && node.parentElement === this) return node;
        let el = event.target as Element | null;
        while (el && el.parentElement !== this) el = el.parentElement;
        return el as HTMLElement | null;
    }

    private onPointerDown = (event: PointerEvent) => {
        this.lastPointerType = event.pointerType;
        this.lastPointerTime = Date.now();
        if (this.gesture || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const tile = this.tileOf(event);
        if (!tile) return;
        const mode = this.dragMode;
        const hasMenu = this.hasAttribute('contextmenu') && event.pointerType !== 'mouse';
        if (mode === 'none' && !hasMenu) return;
        this.gesture = {
            tile,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(this.onHold, this.holdDelay),
            held: false,
            lifted: false,
            dragging: false,
            grabX: 0,
            grabY: 0,
            order: [],
            from: 0,
            to: 0,
            frame: 0,
        };
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerCancel);
        window.addEventListener('keydown', this.onKeyDown);
    };

    private onHold = () => {
        const g = this.gesture;
        if (!g || g.dragging) return;
        g.held = true;
        const mode = this.dragMode;
        // In cross-slide, holding still lifts a tile under a finger or a pen, which can not tell a
        // drag from a pan otherwise. A mouse drags only once it moves, as on Windows: holding it
        // still is a press, and letting go a click.
        if (mode === 'hold' || (mode === 'cross-slide' && g.pointerType !== 'mouse')) this.lift();
    };

    private onPointerMove = (event: PointerEvent) => {
        const g = this.gesture;
        if (!g || event.pointerId !== g.pointerId) return;
        g.x = event.clientX;
        g.y = event.clientY;
        if (g.dragging) {
            if (!g.frame) g.frame = requestAnimationFrame(this.dragFrame);
            return;
        }
        if (Math.hypot(g.x - g.startX, g.y - g.startY) <= SLOP) return;
        const mode = this.dragMode;
        const vertical = Math.abs(g.y - g.startY) > Math.abs(g.x - g.startX);
        const crossSlide = mode === 'cross-slide' && (g.pointerType === 'mouse' || g.held || vertical);
        if (mode === 'press' || crossSlide || (mode === 'hold' && g.held)) this.startDrag();
        // Moved before the hold, or without dragging: not ours (a click, or a pan of the page).
        else this.endGesture();
    };

    private onPointerUp = (event: PointerEvent) => {
        const g = this.gesture;
        if (!g || event.pointerId !== g.pointerId) return;
        if (g.dragging) {
            this.drop(false);
            return;
        }
        if (g.held && g.pointerType !== 'mouse' && this.hasAttribute('contextmenu')) {
            this.fireContextMenu(g.tile, g.x, g.y, g.pointerType);
            // The click that follows a held touch is not a tap.
            suppressNextClick();
        }
        this.endGesture();
    };

    private onPointerCancel = (event: PointerEvent) => {
        const g = this.gesture;
        if (!g || event.pointerId !== g.pointerId) return;
        if (g.dragging) this.drop(true);
        else this.endGesture();
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.gesture && this.gesture.dragging) {
            event.preventDefault();
            this.drop(true);
        }
    };

    private onTouchMove = (event: TouchEvent) => {
        const g = this.gesture;
        if (g && (g.lifted || g.dragging) && event.cancelable) event.preventDefault();
    };

    // The browser's context menu: from a right click or the keyboard it becomes tilecontextmenu.
    // A touch or pen press fires it from the hold instead, so it is only kept from the browser.
    private onContextMenu = (event: MouseEvent) => {
        const tile = this.tileOf(event);
        if (!tile) return;
        const g = this.gesture;
        if (g && g.pointerType !== 'mouse') {
            if (this.hasAttribute('contextmenu') || this.dragMode !== 'none') event.preventDefault();
            return;
        }
        if (!this.hasAttribute('contextmenu')) return;
        event.preventDefault();
        const recent = Date.now() - this.lastPointerTime < 1000;
        const keyboard = !recent || (event.clientX === 0 && event.clientY === 0 && event.button !== 2);
        let x = event.clientX;
        let y = event.clientY;
        if (keyboard) {
            const r = tile.getBoundingClientRect();
            x = r.left + r.width / 2;
            y = r.top + r.height / 2;
        }
        this.fireContextMenu(tile, x, y, keyboard ? 'keyboard' : this.lastPointerType || 'mouse');
    };

    private fireContextMenu(tile: HTMLElement, clientX: number, clientY: number, pointerType: string) {
        tile.dispatchEvent(new CustomEvent('tilecontextmenu', { bubbles: true, composed: true, detail: { clientX, clientY, pointerType } }));
    }

    // The dragged tile grows and fades, the others shrink.
    private lift() {
        const g = this.gesture!;
        if (g.lifted) return;
        g.lifted = true;
        this.jumpEntrance();
        const release = (g.tile as HTMLElement & { release?: () => void }).release;
        if (typeof release === 'function') release.call(g.tile);
        const shown = this.shown.get(g.tile);
        if (shown) this.place(g.tile, shown.x, shown.y, DRAG_SCALE, true, 0, LIFT_MS);
        g.tile.style.zIndex = '1';
        this.fadeDrag(g.tile, dragOpacity(g.tile), LIFT_MS);
        for (const tile of this.tiles) {
            if (tile === g.tile) continue;
            const s = this.shown.get(tile);
            if (s) this.place(tile, s.x, s.y, OTHERS_SCALE, true, 0, LIFT_MS);
        }
    }

    private startDrag() {
        const g = this.gesture!;
        window.clearTimeout(g.timer);
        const start = new CustomEvent('tiledragstart', { bubbles: true, composed: true, cancelable: true });
        if (!g.tile.dispatchEvent(start)) {
            this.endGesture();
            return;
        }
        g.dragging = true;
        g.order = this.tiles;
        g.from = g.to = g.order.indexOf(g.tile);
        const shown = this.shown.get(g.tile);
        const rect = this.getBoundingClientRect();
        g.grabX = g.startX - rect.left - (shown ? shown.x : 0);
        g.grabY = g.startY - rect.top - (shown ? shown.y : 0);
        this.lift();
        g.frame = requestAnimationFrame(this.dragFrame);
    }

    private dragFrame = () => {
        const g = this.gesture;
        if (!g || !g.dragging) return;
        g.frame = 0;
        const m = this.m;
        const rect = this.getBoundingClientRect();
        const x = g.x - rect.left - g.grabX;
        const y = g.y - rect.top - g.grabY;
        // The dragged tile follows the pointer directly.
        const shown = this.shown.get(g.tile);
        if (shown && shown.animation) shown.animation.cancel();
        this.paint(g.tile, x, y, DRAG_SCALE);
        this.shown.set(g.tile, { x, y, scale: DRAG_SCALE, animation: null });
        const target = dropTarget(g.order.map(tileSpan), g.from, { column: x / (m.cellWidth + m.gap), row: y / (m.cellHeight + m.gap) }, { ...this.layoutOptions(), current: g.to });
        if (target.index === g.to) return;
        g.to = target.index;
        // The others make room at once.
        this.applyLayout(moveIndex(g.order, g.from, g.to), target.layout, { animate: true, scale: OTHERS_SCALE, skip: g.tile });
    };

    private drop(cancel: boolean) {
        const g = this.gesture!;
        if (g.frame) cancelAnimationFrame(g.frame);
        g.frame = 0;
        const tile = g.tile;
        this.gesture = null;
        this.removeListeners(g);
        // The pointerup of a drag is followed by a click on the tile.
        suppressNextClick();
        const to = this.reorder(tile, g.from, cancel ? g.from : g.to, 'pointer', DROP_SETTLE);
        this.fadeDrag(tile, 1, DROP_MS, () => {
            if (!this.gesture || this.gesture.tile !== tile) tile.style.zIndex = '';
        });
        tile.dispatchEvent(new CustomEvent('tiledragend', { bubbles: true, composed: true, detail: { from: g.from, to } }));
    }

    // The one move of a tile, for a drag, the keyboard and moveTile(). Fires the cancelable
    // tilereorder (not when `to` is `from`), moves the tile unless a listener canceled it, and
    // lays the tiles out again. Returns the index the tile ends at.
    private reorder(tile: HTMLElement, from: number, to: number, reason: ReorderReason, settle: Settle): number {
        if (to !== from) {
            const event = new CustomEvent('tilereorder', { bubbles: true, composed: true, cancelable: true, detail: { from, to, reason } });
            if (!tile.dispatchEvent(event)) to = from;
        }
        const order = moveIndex(this.tiles, from, to);
        if (to !== from) {
            this.moveNode(tile, order[to + 1] || null);
            this.announceMove(tile, to + 1);
            this.reveal(tile, settle.duration);
        }
        this.applyLayout(order, this.layoutOf(order), { animate: true, scale: 1, duration: settle.duration, together: settle.together });
        return to;
    }

    // Moves the tile in front of `next` (null: to the end). moveBefore (Chromium 133) keeps the
    // focus where it is; insertBefore takes it away from a focused element of the tile, which is
    // focused again here.
    private moveNode(tile: HTMLElement, next: HTMLElement | null) {
        const self = this as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
        if (typeof self.moveBefore === 'function') self.moveBefore(tile, next);
        else {
            const focused = deepActiveElement();
            this.insertBefore(tile, next);
            // focus() takes preventScroll where it is supported; older engines scroll to it.
            if (focused && within(focused, tile)) focused.focus({ preventScroll: true });
        }
        // Our own change of the children: no layout pass from the observer.
        if (this.mutationObserver) this.mutationObserver.takeRecords();
    }

    // Says where a moved tile is. The region is emptied at once and written after 150 ms, so a run of
    // moves says only the last place, and the same place twice is said twice.
    private announceMove(tile: HTMLElement, position: number) {
        const live = this.live;
        if (!live) return;
        window.clearTimeout(this.announceTimer);
        live.textContent = '';
        if (this.getAttribute('announce') === 'off') return;
        this.announceTimer = window.setTimeout(() => {
            live.textContent = this.describeMove(tile, position, this.tiles.length);
        }, 150);
    }

    // Scrolls a moved tile into view once it has settled, if it sticks out of the viewport or of
    // a scroll container around it. Under reduced motion it has settled at once.
    private reveal(tile: HTMLElement, duration: number) {
        const check = () => {
            if (clipped(tile)) tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        if (reducedMotion()) check();
        else window.setTimeout(check, duration);
    }

    // Moves a tile to the index `to` of the order (the `to` of tilereorder), animated. Returns
    // false, and fires nothing, when the tile is not one of the group's tiles, `to` is out of
    // range or nothing would change. Works with drag="none" too: the tile is moved by the page.
    moveTile(tile: Element, to: number): boolean {
        const from = this.tiles.indexOf(tile as HTMLElement);
        if (from < 0 || !Number.isInteger(to) || to < 0 || to >= this.tiles.length || to === from) return false;
        return this.reorder(tile as HTMLElement, from, to, 'api', MOVE_SETTLE) !== from;
    }

    // Alt+Shift+arrows move the focused tile, as the Start menu of Windows does. Keys are the
    // same in every engine; key repeat keeps moving the tile.
    private onKeyMove = (event: KeyboardEvent) => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        const direction = directionOf(event.key);
        if (!direction) return;
        // Off unless the tiles can be dragged, and not while a gesture is going on. A nested group
        // has handled the key already (defaultPrevented), so only the innermost group moves.
        if (this.dragMode === 'none' || this.gesture) return;
        // Typing keeps its keys: the arrows of a field in a tile are not for the tile.
        const target = (typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target) as HTMLElement | null;
        if (!target || isEditable(target)) return;
        const tile = this.tileOf(event);
        if (!tile) return;
        // The layout is the same in both writing directions, so the keys follow the screen: right
        // moves a tile to the right in a right-to-left page too.
        event.preventDefault();
        const from = this.tiles.indexOf(tile);
        const to = keyboardTarget(this.tiles.map(tileSpan), from, direction, this.layoutOptions());
        if (to === from) return;
        this.jumpEntrance();
        this.reorder(tile, from, to, 'keyboard', MOVE_SETTLE);
    };

    private endGesture() {
        const g = this.gesture;
        if (!g) return;
        this.gesture = null;
        this.removeListeners(g);
        if (g.lifted) {
            // Lifted but not dragged: back to normal.
            for (const tile of this.tiles) {
                const s = this.shown.get(tile);
                if (s) this.place(tile, s.x, s.y, 1, true, 0, DROP_MS);
            }
            this.fadeDrag(g.tile, 1, DROP_MS, () => (g.tile.style.zIndex = ''));
        }
    }

    private removeListeners(g: Gesture) {
        window.clearTimeout(g.timer);
        if (g.frame) cancelAnimationFrame(g.frame);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerCancel);
        window.removeEventListener('keydown', this.onKeyDown);
    }
}

// Tiles move and fade by script, frame by frame, not with the Web Animations API: Firefox draws
// a backdrop-filter (acrylic) in a tile clear while a transform animation of the tile runs, and
// Chromium leaves a dropped acrylic tile clear for a moment. Changing the style every frame
// keeps the glass in both, and every engine moves the same way.
interface Motion {
    readonly playState: string;
    cancel(): void;
}

// cubic-bezier(0.1, 0.9, 0.2, 1), the curve of every motion (WinJS).
function ease(t: number): number {
    const [x1, y1, x2, y2] = [0.1, 0.9, 0.2, 1];
    const at = (a: number, b: number, u: number) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < t) lo = mid;
        else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
}

// A tile moving from one place to another by script, frame by frame, with the timing of the
// animations: a delay showing the start, then the curve of ease(). `draw` shows each frame.
class ScriptedMove implements Motion {
    playState = 'running';
    private frame = 0;
    private readonly start = performance.now();

    constructor(
        private readonly draw: (p: Placed) => void,
        private readonly from: Placed,
        private readonly to: Placed,
        private readonly duration: number,
        private readonly delay: number
    ) {
        draw(from);
        this.frame = requestAnimationFrame(this.step);
    }

    private step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - this.start - this.delay) / this.duration));
        if (t >= 1) {
            this.draw(this.to);
            this.playState = 'finished';
            this.frame = 0;
            return;
        }
        const k = ease(t);
        const { from, to } = this;
        this.draw({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale: from.scale + (to.scale - from.scale) * k });
        this.frame = requestAnimationFrame(this.step);
    };

    cancel() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.playState = 'idle';
    }
}

function transformOf(x: number, y: number, scale: number): string {
    return scale === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${scale})`;
}

// The state of a hold: what the tiles show between an entrance and the next one.
function holdFor(kind: 'enter' | 'exit', variant: EntranceVariant, p: Params): Hold {
    const mobile = variant === 'mobile';
    const desktopEnter = kind === 'enter' && !mobile;
    return { kind, dx: 0, dy: 0, grow: desktopEnter ? p.enterScale : 1, rotateY: mobile ? 90 : 0, perspective: p.turnstilePerspective, origin: p.turnstileOrigin, enter: 0 };
}

// The entrance fields of a look: those of the hold, or none.
function setEntrance(look: Look, hold: Hold | null) {
    look.dx = hold ? hold.dx : 0;
    look.dy = hold ? hold.dy : 0;
    look.grow = hold ? hold.grow : 1;
    look.rotateY = hold ? hold.rotateY : 0;
    look.perspective = hold ? hold.perspective : DEFAULT_PERSPECTIVE;
    look.enter = hold ? hold.enter : 1;
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// The opacity of a dragged tile: --tile-drag-opacity, or the 0.65 of Windows. Below 1 the tile
// is a backdrop root, so a backdrop-filter in it (acrylic) shows nothing behind the tile while
// it is dragged; such tiles set 1.
function dragOpacity(tile: HTMLElement): number {
    const value = parseFloat(getComputedStyle(tile).getPropertyValue('--tile-drag-opacity'));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DRAG_OPACITY;
}

// The user's wish for less motion: the "Show animations" setting of Windows. Moves and fades then
// end at once.
function reducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The drag fade running on each tile, so a new one stops it.
const fades = new WeakMap<HTMLElement, number>();

// A drag or a held touch ends with a click on the tile; it is not a click.
function suppressNextClick() {
    const stop = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
        window.removeEventListener('click', stop, true);
    };
    window.addEventListener('click', stop, true);
    window.setTimeout(() => window.removeEventListener('click', stop, true), 400);
}

export type DescribeMove = (tile: Element, position: number, count: number) => string;

function describeMoved(tile: Element, position: number, count: number): string {
    return `${labelOf(tile)}, moved to position ${position} of ${count}`;
}

// What a tile is called: its aria-label, else the one of the first element in it that has one, else
// its text.
function labelOf(tile: Element): string {
    const own = (tile.getAttribute('aria-label') || '').trim();
    if (own) return own;
    const inner = tile.querySelectorAll('[aria-label]');
    for (let i = 0; i < inner.length; i++) {
        const label = (inner[i].getAttribute('aria-label') || '').trim();
        if (label) return label;
    }
    return (tile.textContent || '').trim();
}

// The direction of an arrow key, or null for any other key. The legacy names are those of old Edge.
function directionOf(key: string): Direction | null {
    switch (key) {
        case 'ArrowLeft':
        case 'Left':
            return 'left';
        case 'ArrowRight':
        case 'Right':
            return 'right';
        case 'ArrowUp':
        case 'Up':
            return 'up';
        case 'ArrowDown':
        case 'Down':
            return 'down';
        default:
            return null;
    }
}


// The arrows of a field are for the field.
function isEditable(el: HTMLElement): boolean {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

// The focused element, also inside the shadow root of a component that has it.
function deepActiveElement(): HTMLElement | null {
    let el = document.activeElement as HTMLElement | null;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
    return el;
}

// Whether `node` is `root` or inside it, through shadow roots.
function within(node: Node, root: Node): boolean {
    for (let n: Node | null = node; n; n = n.parentNode || (n as ShadowRoot).host || null) if (n === root) return true;
    return false;
}

// Whether the tile sticks out of the viewport or of a scroll container around it.
function clipped(tile: HTMLElement): boolean {
    const r = tile.getBoundingClientRect();
    let left = 0;
    let top = 0;
    let right = window.innerWidth;
    let bottom = window.innerHeight;
    for (let el = tile.parentElement; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const b = el.getBoundingClientRect();
        left = Math.max(left, b.left);
        top = Math.max(top, b.top);
        right = Math.min(right, b.right);
        bottom = Math.min(bottom, b.bottom);
    }
    return r.left < left || r.top < top || r.right > right || r.bottom > bottom;
}
