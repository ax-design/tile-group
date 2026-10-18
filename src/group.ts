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
import { services } from '@ax-design/surface';
import { parseLength, probeLengthPercentage } from '@ax-design/typed-om';
import { layoutTiles } from './layout.js';
import type { LayoutResult } from './layout.js';
import { dropTarget, keyboardTarget, moveIndex } from './reorder.js';
import type { Direction } from './reorder.js';
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
        if (typeof MutationObserver !== 'undefined') {
            this.mutationObserver = new MutationObserver(() => this.schedule(true));
            this.mutationObserver.observe(this, { childList: true });
        }
        if (typeof ResizeObserver !== 'undefined') {
            // With auto rows or columns, they follow the size.
            this.resizeObserver = new ResizeObserver(() => {
                if (this.isAuto() && this.acrossForSize() !== this.autoAcross) this.schedule(true);
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
        if (this.mutationObserver) this.mutationObserver.disconnect();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.mutationObserver = this.resizeObserver = null;
        this.endGesture();
        if (this.pending) cancelAnimationFrame(this.pending);
        this.pending = 0;
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

    // Called by <ax-tile> when its size changes.
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

    // Moves a tile to (x, y) at a scale. Returns true when it animates, for the stagger.
    private place(tile: HTMLElement, x: number, y: number, scale: number, animate: boolean, staggerIndex: number, duration: number): boolean {
        const before = this.shown.get(tile);
        const to = transformOf(x, y, scale);
        if (before && before.x === x && before.y === y && before.scale === scale) return false;
        // Where the tile is on screen now, also in the middle of an animation.
        const from = before ? currentTransform(tile, before) : '';
        if (before && before.animation) before.animation.cancel();
        tile.style.transform = to;
        let animation: Motion | null = null;
        // Read when the move starts, so a change of the setting applies to the next one.
        if (animate && before && !reducedMotion()) {
            const delay = Math.min(STAGGER_CAP_MS, staggerIndex * STAGGER_MS);
            animation = new ScriptedMove(tile, from, to, duration, delay);
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
        const release = (g.tile as HTMLElement & { release?: () => void }).release;
        if (typeof release === 'function') release.call(g.tile);
        const shown = this.shown.get(g.tile);
        if (shown) this.place(g.tile, shown.x, shown.y, DRAG_SCALE, true, 0, LIFT_MS);
        g.tile.style.zIndex = '1';
        fadeTo(g.tile, dragOpacity(g.tile), LIFT_MS);
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
        g.tile.style.transform = transformOf(x, y, DRAG_SCALE);
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
        fadeTo(tile, 1, DROP_MS, () => {
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
        let direction = directionOf(event.key);
        if (!direction) return;
        // Off unless the tiles can be dragged, and not while a gesture is going on. A nested group
        // has handled the key already (defaultPrevented), so only the innermost group moves.
        if (this.dragMode === 'none' || this.gesture) return;
        // Typing keeps its keys: the arrows of a field in a tile are not for the tile.
        const target = (typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target) as HTMLElement | null;
        if (!target || isEditable(target)) return;
        const tile = this.tileOf(event);
        if (!tile) return;
        // The layout is not mirrored by direction, so the keys of a right-to-left group swap.
        if (!this.vertical && getComputedStyle(this).direction === 'rtl') direction = mirrored(direction);
        event.preventDefault();
        const from = this.tiles.indexOf(tile);
        const to = keyboardTarget(this.tiles.map(tileSpan), from, direction, this.layoutOptions());
        if (to !== from) this.reorder(tile, from, to, 'keyboard', MOVE_SETTLE);
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

interface Placed {
    x: number;
    y: number;
    scale: number;
}

// translate(x, y) scale(s) as transformOf writes it, or a matrix of one as getComputedStyle
// returns it (the origin is applied apart, so the matrix is matrix(s, 0, 0, s, x, y)).
function placedOf(transform: string): Placed {
    const matrix = /^matrix\(([^)]+)\)$/.exec(transform);
    if (matrix) {
        const m = matrix[1].split(',').map(parseFloat);
        return { x: m[4], y: m[5], scale: m[0] };
    }
    const t = /translate\((-?[\d.e-]+)px(?:,\s*(-?[\d.e-]+)px)?\)/.exec(transform);
    const s = /scale\((-?[\d.e-]+)\)/.exec(transform);
    return { x: t ? +t[1] : 0, y: t && t[2] ? +t[2] : 0, scale: s ? +s[1] : 1 };
}

// A tile moving from one transform to another by script, frame by frame, with the timing of
// the animations: a delay showing the start, then the curve of ease().
class ScriptedMove implements Motion {
    playState = 'running';
    private frame = 0;
    private readonly start = performance.now();
    private readonly from: Placed;
    private readonly to: Placed;

    constructor(
        private readonly tile: HTMLElement,
        from: string,
        private readonly end: string,
        private readonly duration: number,
        private readonly delay: number
    ) {
        this.from = placedOf(from);
        this.to = placedOf(end);
        tile.style.transform = from;
        this.frame = requestAnimationFrame(this.step);
    }

    private step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - this.start - this.delay) / this.duration));
        if (t >= 1) {
            this.tile.style.transform = this.end;
            this.playState = 'finished';
            this.frame = 0;
            return;
        }
        const k = ease(t);
        const { from, to } = this;
        this.tile.style.transform = transformOf(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.scale + (to.scale - from.scale) * k);
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

// The transform on screen: the running animation's current value, or the last one set.
function currentTransform(tile: HTMLElement, shown: Shown): string {
    if (shown.animation && shown.animation.playState === 'running') {
        const value = getComputedStyle(tile).transform;
        if (value && value !== 'none') return value;
    }
    return transformOf(shown.x, shown.y, shown.scale);
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

// The fade running on each tile, so a new one stops it.
const fades = new WeakMap<HTMLElement, number>();

function fadeTo(tile: HTMLElement, opacity: number, duration: number, done?: () => void) {
    const running = fades.get(tile);
    if (running) cancelAnimationFrame(running);
    fades.delete(tile);
    const from = parseFloat(getComputedStyle(tile).opacity);
    const end = opacity === 1 ? '' : String(opacity);
    const reduced = reducedMotion();
    if (from === opacity || reduced) {
        tile.style.opacity = end;
        // The same moment as a fade: a dropped tile stays above the others until it has landed.
        if (done) window.setTimeout(done, reduced ? 0 : duration);
        return;
    }
    const start = performance.now();
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        if (t >= 1) {
            tile.style.opacity = end;
            fades.delete(tile);
            if (done) done();
            return;
        }
        tile.style.opacity = String(from + (opacity - from) * ease(t));
        fades.set(tile, requestAnimationFrame(step));
    };
    tile.style.opacity = String(from);
    fades.set(tile, requestAnimationFrame(step));
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

// Right-to-left groups swap the horizontal keys: their reading order runs from the right.
function mirrored(direction: Direction): Direction {
    return direction === 'left' ? 'right' : direction === 'right' ? 'left' : direction;
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
