// <ax-tile-group>: tiles on a grid of cells, laid out and reordered like the tile groups of the
// Windows 8 Start screen. Every element child is a tile; its `columns` and `rows` attributes
// give its size in cells (2 x 2 when missing). The order of the children is the order of the
// tiles.
//
// Sizes come from custom properties on the group: --tile-cell-width, --tile-cell-height,
// --tile-gap and --tile-rows (a number, or auto for as many rows as the group's height holds).
// They are read again whenever the style may have changed, with the triggers of Surface (class
// and attribute changes, hover, media queries and so on); refresh() covers the rest.
//
// The strip attribute sets the fill order (see layout.ts): 4 (default) fills columns two medium
// tiles wide row by row, as the Start screen does; 1 is the column by column order of WinJS,
// which reorders poorly while dragging.
//
// Gestures, set with attributes:
//   drag="press"    a tile follows the pointer once it moves
//   drag="hold"     a tile lifts after a press of hold-delay ms, then follows the pointer
//   drag="none"     (default) no dragging
//   contextmenu     a right click, the context menu key, and a touch or pen press held for
//                   hold-delay ms and released without moving fire one event: tilecontextmenu
//   grouping        reserved for dragging tiles onto each other; no events yet
//
// Events (on the tile, bubbling): tiledragstart (cancelable), tiledragend, tilereorder
// (cancelable, detail { from, to }), tilecontextmenu (detail { clientX, clientY, pointerType }).
//
// The motion is the one of WinJS (Microsoft's controls for Windows 8 apps): tiles move to new
// places in 367 ms, one after another 33 ms apart (at most 250 ms); a dragged tile grows to 1.05
// and fades to 0.65 in 240 ms while the others shrink to 0.95, and everything settles in 500 ms
// on drop; all on cubic-bezier(0.1, 0.9, 0.2, 1).
import { services } from '@ax-design/surface';
import { parseLength, probeLengthPercentage } from '@ax-design/typed-om';
import { layoutTiles } from './layout.js';
import type { LayoutResult } from './layout.js';
import { dropTarget, moveIndex } from './reorder.js';
import { tileSpan } from './tile.js';

const EASE = 'cubic-bezier(0.1, 0.9, 0.2, 1)';
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

const STYLE = `
:host { display: block; position: relative; }
::slotted(*) { position: absolute; left: 0; top: 0; box-sizing: border-box; margin: 0;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
:host([drag="press"]) ::slotted(*) { touch-action: none; }
`;

interface Metrics {
    cellWidth: number;
    cellHeight: number;
    gap: number;
    // null: as many as the height holds.
    rows: number | null;
}

interface Shown {
    x: number;
    y: number;
    scale: number;
    animation: Animation | null;
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

const template = typeof document !== 'undefined' ? document.createElement('template') : null;
if (template) template.innerHTML = `<style>${STYLE}</style><slot></slot>`;

export class AxTileGroup extends HTMLElement {
    static readonly ElementName: string = 'ax-tile-group';

    static get observedAttributes() {
        return ['drag', 'strip'];
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
    private autoRows = 0;

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
        if (typeof MutationObserver !== 'undefined') {
            this.mutationObserver = new MutationObserver(() => this.schedule(true));
            this.mutationObserver.observe(this, { childList: true });
        }
        if (typeof ResizeObserver !== 'undefined') {
            // For --tile-rows: auto, the rows follow the height.
            this.resizeObserver = new ResizeObserver(() => {
                if (this.m.rows === null && this.rowsForHeight() !== this.autoRows) this.schedule(true);
            });
            this.resizeObserver.observe(this);
        }
        services().triggers.add(this, this.styleTarget);
        this.layout(false);
    }

    // Called by the triggers when the style may have changed: the sizes are read again, and the
    // tiles move only when they changed.
    private styleTarget = {
        invalidateStyle: () => {
            if (this.styleCheck) return;
            this.styleCheck = requestAnimationFrame(() => {
                this.styleCheck = 0;
                const next = this.readMetrics();
                const now = this.metrics;
                if (now && next.cellWidth === now.cellWidth && next.cellHeight === now.cellHeight && next.gap === now.gap && next.rows === now.rows) return;
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
        if (this.mutationObserver) this.mutationObserver.disconnect();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.mutationObserver = this.resizeObserver = null;
        this.endGesture();
        if (this.pending) cancelAnimationFrame(this.pending);
        this.pending = 0;
    }

    attributeChangedCallback(name: string) {
        // touch-action follows the drag mode through the stylesheet.
        if (name === 'strip' && this.isConnected) this.schedule(true);
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

    // Called by <ax-tile> when its size changes.
    tileChanged(): void {
        this.schedule(true);
    }

    private get dragMode(): string {
        const mode = this.getAttribute('drag');
        return mode === 'press' || mode === 'hold' ? mode : 'none';
    }

    private get strip(): number {
        const n = parseInt(this.getAttribute('strip') || '', 10);
        return n > 0 ? n : DEFAULT_STRIP;
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
        const rowsText = style.getPropertyValue('--tile-rows').trim();
        const rows = rowsText === 'auto' ? null : Math.max(1, Math.floor(parseFloat(rowsText) || 6));
        return {
            cellWidth: Math.max(1, this.length(style, '--tile-cell-width', 70)),
            cellHeight: Math.max(1, this.length(style, '--tile-cell-height', 70)),
            gap: Math.max(0, this.length(style, '--tile-gap', 10)),
            rows,
        };
    }

    // The sizes, read again after refresh().
    private get m(): Metrics {
        if (!this.metrics) this.metrics = this.readMetrics();
        return this.metrics;
    }

    private rowsForHeight(): number {
        const m = this.m;
        return Math.max(1, Math.floor((this.clientHeight + m.gap) / (m.cellHeight + m.gap)));
    }

    private rows(): number {
        const m = this.m;
        if (m.rows !== null) return m.rows;
        this.autoRows = this.rowsForHeight();
        return this.autoRows;
    }

    // ----- Layout -----

    private layoutOf(order: HTMLElement[]): LayoutResult {
        return layoutTiles(order.map(tileSpan), { rows: this.rows(), strip: this.strip });
    }

    private layout(animate: boolean, order = this.tiles) {
        const result = this.layoutOf(order);
        this.applyLayout(order, result, { animate, scale: 1 });
    }

    private applyLayout(order: HTMLElement[], result: LayoutResult, options: { animate: boolean; scale: number; skip?: HTMLElement; duration?: number }) {
        const m = this.m;
        const stepX = m.cellWidth + m.gap;
        const stepY = m.cellHeight + m.gap;
        const s = this.style;
        s.width = `${Math.max(0, result.columns * stepX - m.gap)}px`;
        if (m.rows !== null) s.height = `${Math.max(0, m.rows * stepY - m.gap)}px`;
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
            if (this.moveTile(tile, p.column * stepX, p.row * stepY, options.scale, options.animate, moved, options.duration || REPOSITION_MS)) moved++;
        });
        for (const tile of Array.from(this.shown.keys())) if (tile.parentElement !== this) this.shown.delete(tile);
    }

    // Moves a tile to (x, y) at a scale. Returns true when it animates, for the stagger.
    private moveTile(tile: HTMLElement, x: number, y: number, scale: number, animate: boolean, staggerIndex: number, duration: number): boolean {
        const before = this.shown.get(tile);
        const to = transformOf(x, y, scale);
        if (before && before.x === x && before.y === y && before.scale === scale) return false;
        // Where the tile is on screen now, also in the middle of an animation.
        const from = before ? currentTransform(tile, before) : '';
        if (before && before.animation) before.animation.cancel();
        tile.style.transform = to;
        let animation: Animation | null = null;
        if (animate && before && typeof tile.animate === 'function') {
            const delay = Math.min(STAGGER_CAP_MS, staggerIndex * STAGGER_MS);
            animation = tile.animate([{ transform: from }, { transform: to }], { duration, delay, easing: EASE, fill: 'backwards' });
        }
        this.shown.set(tile, { x, y, scale, animation });
        return !!animation;
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
        if (this.dragMode === 'hold') this.lift();
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
        if (mode === 'press' || (mode === 'hold' && g.held)) this.startDrag();
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
        const release = (g.tile as HTMLElement & { release?: () => void }).release;
        if (typeof release === 'function') release.call(g.tile);
        const shown = this.shown.get(g.tile);
        if (shown) this.moveTile(g.tile, shown.x, shown.y, DRAG_SCALE, true, 0, LIFT_MS);
        g.tile.style.zIndex = '1';
        fadeTo(g.tile, DRAG_OPACITY, LIFT_MS);
        for (const tile of this.tiles) {
            if (tile === g.tile) continue;
            const s = this.shown.get(tile);
            if (s) this.moveTile(tile, s.x, s.y, OTHERS_SCALE, true, 0, LIFT_MS);
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
        g.tile.style.transform = transformOf(x, y, DRAG_SCALE);
        this.shown.set(g.tile, { x, y, scale: DRAG_SCALE, animation: null });
        const target = dropTarget(g.order.map(tileSpan), g.from, { column: x / (m.cellWidth + m.gap), row: y / (m.cellHeight + m.gap) }, { rows: this.rows(), strip: this.strip, current: g.to });
        if (target.index === g.to) return;
        g.to = target.index;
        // The others make room at once.
        this.applyLayout(moveIndex(g.order, g.from, g.to), target.layout, { animate: true, scale: OTHERS_SCALE, skip: g.tile });
    };

    private drop(cancel: boolean) {
        const g = this.gesture!;
        if (g.frame) cancelAnimationFrame(g.frame);
        g.frame = 0;
        let to = cancel ? g.from : g.to;
        if (!cancel && to !== g.from) {
            const reorder = new CustomEvent('tilereorder', { bubbles: true, composed: true, cancelable: true, detail: { from: g.from, to } });
            if (!g.tile.dispatchEvent(reorder)) to = g.from;
        }
        const order = moveIndex(g.order, g.from, to);
        if (to !== g.from) {
            // Our own change of the children: no layout pass from the observer.
            const next = order[to + 1] || null;
            this.insertBefore(g.tile, next);
            if (this.mutationObserver) this.mutationObserver.takeRecords();
        }
        const tile = g.tile;
        this.gesture = null;
        this.removeListeners(g);
        // The pointerup of a drag is followed by a click on the tile.
        suppressNextClick();
        // Everything settles: the dragged tile into its place, the others back to full size.
        this.applyLayout(order, this.layoutOf(order), { animate: true, scale: 1, duration: DROP_MS });
        fadeTo(tile, 1, DROP_MS, () => {
            if (!this.gesture || this.gesture.tile !== tile) tile.style.zIndex = '';
        });
        tile.dispatchEvent(new CustomEvent('tiledragend', { bubbles: true, composed: true, detail: { from: g.from, to } }));
    }

    private endGesture() {
        const g = this.gesture;
        if (!g) return;
        this.gesture = null;
        this.removeListeners(g);
        if (g.lifted) {
            // Lifted but not dragged: back to normal.
            for (const tile of this.tiles) {
                const s = this.shown.get(tile);
                if (s) this.moveTile(tile, s.x, s.y, 1, true, 0, DROP_MS);
            }
            fadeTo(g.tile, 1, DROP_MS, () => (g.tile.style.zIndex = ''));
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

function transformOf(x: number, y: number, scale: number): string {
    return scale === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${scale})`;
}

// The transform on screen: the running animation's current value, or the last one set.
function currentTransform(tile: HTMLElement, shown: Shown): string {
    if (shown.animation && shown.animation.playState === 'running') {
        const value = getComputedStyle(tile).transform;
        if (value && value !== 'none') return value;
    }
    return transformOf(shown.x, shown.y, shown.scale);
}

function fadeTo(tile: HTMLElement, opacity: number, duration: number, done?: () => void) {
    const from = getComputedStyle(tile).opacity;
    tile.style.opacity = opacity === 1 ? '' : String(opacity);
    if (typeof tile.animate !== 'function') {
        if (done) done();
        return;
    }
    const animation = tile.animate([{ opacity: from }, { opacity: String(opacity) }], { duration, easing: EASE });
    if (done) animation.onfinish = done;
}

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
