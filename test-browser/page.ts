// Browser checks for <ax-tile-group>. Gestures are synthetic pointer events, so every engine
// (and Safari through WebDriver) runs the same steps.
import { AxSurface, register as registerSurface } from '@ax-design/surface';
import * as pkg from '../src/index.js';
import { layoutTiles, register } from '../src/index.js';
import type { AxTileGroup } from '../src/index.js';

// The <ax-tile> of these checks: a surface and nothing else. The real one is @ax-design/tile.
class AxTileFixture extends AxSurface {
    static readonly ElementName: string = 'ax-tile';
}

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}
declare global {
    interface Window {
        __result?: unknown;
        __step?: string;
        __ack?: string;
        __keys?: boolean;
    }
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
const frames = (n: number) =>
    new Promise<void>((resolve) => {
        const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
    });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const STEP = 44;

// Tile positions in cells, from the resting transform (animations finish or are skipped).
const cellsOf = (group: HTMLElement) =>
    Array.from(group.children).map((tile) => {
        // Firefox writes translate(x, 0) as translate(x).
        const m = /translate\((-?[\d.]+)px(?:, (-?[\d.]+)px)?\)/.exec((tile as HTMLElement).style.transform);
        return m ? [Math.round(+m[1] / STEP), Math.round(+(m[2] || 0) / STEP)] : null;
    });
const expectedCells = (group: HTMLElement, rows = 4) =>
    layoutTiles(
        Array.from(group.children).map((t) => ({ columns: +(t.getAttribute('columns') || 2), rows: +(t.getAttribute('rows') || 2) })),
        { rows, strip: +(group.getAttribute('strip') || 4) }
    ).placements.map((p) => [p.column, p.row]);
const ids = (group: HTMLElement) => Array.from(group.children).map((t) => t.id).join('');
// A surface's motion (null at rest); plain elements have none.
type Surfaceish = HTMLElement & { debugState?: { motion: { opacity?: number; rotateY?: number; originX?: number; originY?: number } | null } };
const motionOf = (el: Element) => (el as Surfaceish).debugState?.motion ?? null;
// The opacity a tile is drawn with: a surface's motion, else the host's computed opacity.
const opacityOf = (el: Element) => {
    const m = motionOf(el);
    return m ? (m.opacity === undefined ? 1 : m.opacity) : parseFloat(getComputedStyle(el as HTMLElement).opacity);
};
// Every tile of the group drawn at its place, fully opaque, with no turn and no scale.
const rest = (group: HTMLElement) =>
    Array.from(group.children).every((c) => {
        const el = c as HTMLElement;
        const m = motionOf(el);
        return opacityOf(el) === 1 && (!m || !m.rotateY) && !/scale|perspective|rotate/.test(el.style.transform) && !el.style.transformOrigin;
    });

// Synthetic pointer input at a point of the page.
let pointerId = 10;
const pointer = (type: string, x: number, y: number, pointerType = 'mouse', target?: Element, button = 0) => {
    const init = { clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true, pointerId, pointerType, isPrimary: true, button, buttons: type === 'pointerup' ? 0 : 1 };
    (target || document.elementFromPoint(x, y) || document.body).dispatchEvent(new PointerEvent(type, init));
};
const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
// Steps for run.ts: keys are Playwright's, so the driver presses them and answers here. Each step
// is named, and the page waits until run.ts has done it.
let steps = 0;
const driverStep = async (step: string) => {
    window.__step = step;
    while (window.__ack !== step) await wait(20);
};
const press = (keys: string) => driverStep(`${++steps}:${keys}`);
const events: string[] = [];
const record = (group: HTMLElement) => {
    for (const type of ['tiledragstart', 'tiledragend', 'tilereorder', 'tilecontextmenu'])
        group.addEventListener(type, (e) => events.push(`${type}:${(e.target as Element).id}:${JSON.stringify((e as CustomEvent).detail || null)}`));
};

async function run() {
    // The group is registered first, so the check sees whether the package defines <ax-tile>.
    registerSurface();
    register();
    const definedByPackage = customElements.get('ax-tile') !== undefined;
    customElements.define('ax-tile', AxTileFixture);
    check('register() leaves <ax-tile> to @ax-design/tile', !definedByPackage && !('AxTile' in pkg) && customElements.get('ax-tile') === AxTileFixture, String(definedByPackage));
    await frames(4);
    const g = byId('g') as AxTileGroup;
    record(g);
    record(byId('h'));

    // 1. Layout: the tiles sit where layoutTiles puts them; any element child is a tile.
    check('initial layout follows layoutTiles', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)), JSON.stringify(cellsOf(g)));
    check('tile sizes follow columns and rows', byId('e').style.width === '172px' && byId('e').style.height === '84px' && byId('f').style.width === '40px', byId('e').style.width);
    check('group size fits the tiles', g.style.height === '172px' && g.style.width === `${(Math.max(...expectedCells(g).map((c, i) => c[0] + [2, 2, 2, 2, 4, 1][i]))) * STEP - 4}px`, `${g.style.width} x ${g.style.height}`);

    // 1a. The group's pressed tilt, below any author style. (The border of a tile is a default of
    // @ax-design/tile, not of the group.)
    {
        const tile = byId('c') as HTMLElement & { debugState: { values: { keyword(n: string): string } } };
        const v = () => tile.debugState.values;
        check('tiles tilt when pressed by default', v().keyword('--ax-tilt-mode') === 'absolute', v().keyword('--ax-tilt-mode'));
        g.style.setProperty('--ax-tilt-mode', 'off');
        await frames(4);
        check('author styles override the tile defaults', v().keyword('--ax-tilt-mode') === 'off', v().keyword('--ax-tilt-mode'));
        g.style.removeProperty('--ax-tilt-mode');
        await frames(4);
    }

    // 1b. Style changes are picked up without refresh(): a class sets other sizes.
    g.classList.add('roomy');
    await frames(4);
    check('a style change lays the group out again', byId('a').style.width === '100px' && g.style.height === '268px', `${byId('a').style.width} ${g.style.height}`);
    g.classList.remove('roomy');
    await frames(4);
    await wait(600);
    check('and back', byId('a').style.width === '84px' && g.style.height === '172px', `${byId('a').style.width} ${g.style.height}`);
    // The strip attribute changes the fill order.
    g.setAttribute('strip', '1');
    await frames(3);
    await wait(650);
    check('strip 1 is the WinJS order', JSON.stringify(cellsOf(g).slice(0, 4)) === JSON.stringify([[0, 0], [0, 2], [2, 0], [2, 2]]), JSON.stringify(cellsOf(g)));
    g.removeAttribute('strip');
    await frames(3);
    await wait(650);
    check('strip 4 (default) fills two medium tiles wide, row by row', JSON.stringify(cellsOf(g).slice(0, 4)) === JSON.stringify([[0, 0], [2, 0], [0, 2], [2, 2]]), JSON.stringify(cellsOf(g)));
    await wait(600);

    // 2. Resizing a tile lays the group out again.
    byId('b').setAttribute('columns', '4');
    await frames(3);
    // Tiles move by script, frame by frame, with no animation of the browser: those turn acrylic
    // in a tile clear (Firefox while they run, Chromium after a drop).
    const moving = Array.from(g.children).flatMap((t) => t.getAnimations());
    check('tiles move without animations of the browser', moving.length === 0, String(moving.length));
    await wait(650);
    check('a tile resize moves the others', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)), JSON.stringify(cellsOf(g)));
    byId('b').setAttribute('columns', '2');
    await frames(3);
    await wait(700);

    // 2b. A child changing its columns lays the group out again, an <ax-tile> and a plain <div>
    // alike. The group watches the children itself: no call from the tile.
    {
        const cg = byId('cg') as AxTileGroup;
        const resting = cellsOf(cg);
        // The first and the third child widen into places that move the others (the second would not).
        for (const id of ['cg1', 'cg3']) {
            const tile = byId(id);
            tile.setAttribute('columns', '4');
            await wait(700);
            const moved = cellsOf(cg);
            check(`columns of a ${tile.tagName.toLowerCase()} child lay the group out again`, JSON.stringify(moved) !== JSON.stringify(resting) && JSON.stringify(moved) === JSON.stringify(expectedCells(cg)), JSON.stringify(moved));
            tile.setAttribute('columns', '2');
            await wait(700);
        }
        // tileChanged() still works: the change is taken out of the observer's queue here, so only
        // the call can lay the group out.
        const observer = (cg as unknown as { mutationObserver: MutationObserver }).mutationObserver;
        byId('cg3').setAttribute('columns', '4');
        observer.takeRecords();
        cg.tileChanged();
        await wait(700);
        check('tileChanged() lays the group out again', JSON.stringify(cellsOf(cg)) !== JSON.stringify(resting) && JSON.stringify(cellsOf(cg)) === JSON.stringify(expectedCells(cg)), JSON.stringify(cellsOf(cg)));
        byId('cg3').setAttribute('columns', '2');
        await wait(700);
        check('and back to the resting layout', JSON.stringify(cellsOf(cg)) === JSON.stringify(resting), JSON.stringify(cellsOf(cg)));
    }

    // 3. Press drag: the others make room while dragging; the drop reorders the children.
    events.length = 0;
    const a = byId('a');
    const start = center(a);
    pointer('pointerdown', start.x, start.y, 'mouse', a);
    pointer('pointermove', start.x + 2, start.y + 2);
    check('a small move is no drag', events.length === 0, events.join(' '));
    // Over the place of B (column 2, row 0): two cells right.
    pointer('pointermove', start.x + 2 * STEP, start.y);
    await frames(3);
    // The surface tilt goes back in 50 ms.
    await wait(150);
    const surface = a as HTMLElement & { debugState?: { tilt: unknown } };
    check('drag start fires tiledragstart', events[0] === 'tiledragstart:a:null', events.join(' '));
    check('the dragged tile ends its surface press', !surface.debugState || !surface.debugState.tilt);
    // The lift fades in 240 ms.
    await wait(150);
    check('the dragged tile lifts', /scale\(1\.05\)/.test(a.style.transform) && opacityOf(a) === 0.65, `${a.style.transform} ${opacityOf(a)}`);
    // Wait for the others to arrive (the dragged tile has lifted by now).
    await wait(650);
    const preview = cellsOf(g);
    // B moves to the front, A's place.
    check('the others make room while dragging', JSON.stringify(preview[1]) === JSON.stringify([0, 0]) && /scale\(0\.95\)/.test(byId('b').style.transform), JSON.stringify(preview));
    // With reduced motion (the mode of the second run) the drop lands at once, in the same call.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pointer('pointerup', start.x + 2 * STEP, start.y);
    if (reduced)
        check('reduced motion: the drop lands the tiles at once', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)) && opacityOf(a) === 1 && !/scale/.test(a.style.transform), JSON.stringify(cellsOf(g)));
    let clicked = false;
    a.addEventListener('click', () => (clicked = true), { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('the click after a drop is swallowed', !clicked);
    await frames(2);
    check('the drop fires tilereorder', events.some((e) => e === 'tilereorder:a:{"from":0,"to":1,"reason":"pointer"}'), events.join(' '));
    check('the drop reorders the children', ids(g) === 'bacdef', ids(g));
    await wait(700);
    check('after the drop the tiles rest in the new layout', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)) && opacityOf(a) === 1 && !/scale/.test(a.style.transform), JSON.stringify(cellsOf(g)));
    clicked = false;
    a.addEventListener('click', () => (clicked = true), { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('a later click goes through', clicked);

    // 4. Escape cancels, and a cancelled tilereorder keeps the order.
    const before = ids(g);
    let p = center(byId('b'));
    pointer('pointerdown', p.x, p.y, 'mouse', byId('b'));
    pointer('pointermove', p.x + 4 * STEP, p.y);
    await frames(3);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer('pointerup', p.x + 4 * STEP, p.y);
    await frames(2);
    check('Escape cancels the drag', ids(g) === before, ids(g));
    await wait(700);
    const veto = (e: Event) => e.preventDefault();
    g.addEventListener('tilereorder', veto);
    p = center(byId('b'));
    pointer('pointerdown', p.x, p.y, 'mouse', byId('b'));
    pointer('pointermove', p.x + 4 * STEP, p.y);
    await frames(3);
    pointer('pointerup', p.x + 4 * STEP, p.y);
    await frames(2);
    g.removeEventListener('tilereorder', veto);
    check('a cancelled tilereorder keeps the order', ids(g) === before, ids(g));
    await wait(700);
    check('and the tiles go back', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)), JSON.stringify(cellsOf(g)));

    // 4b. The dropped tile settles at once, also when it lands late in the order: the stagger
    // of a reposition used to hold it at the drop point for up to 250 ms (the other tiles all
    // move back from 0.95 and each took 33 ms of delay before it).
    {
        const first = g.children[0] as HTMLElement;
        const q = center(first);
        pointer('pointerdown', q.x, q.y, 'mouse', first);
        pointer('pointermove', q.x + 7 * STEP, q.y + STEP);
        await frames(3);
        pointer('pointermove', q.x + 7 * STEP + 2, q.y + STEP);
        await frames(3);
        const atDrop = getComputedStyle(first).transform;
        pointer('pointerup', q.x + 7 * STEP + 2, q.y + STEP);
        const late = Array.prototype.indexOf.call(g.children, first);
        await frames(3);
        check('the dropped tile starts moving at once', late >= 3 && getComputedStyle(first).transform !== atDrop, `index ${late} ${atDrop}`);
        await wait(700);
    }

    // 5. Hold drag: a quick move is not a drag, a move after the hold is.
    const h = byId('h');
    events.length = 0;
    p = center(byId('h1'));
    pointer('pointerdown', p.x, p.y, 'touch', byId('h1'));
    pointer('pointermove', p.x + 3 * STEP, p.y, 'touch');
    await frames(2);
    pointer('pointerup', p.x + 3 * STEP, p.y, 'touch');
    check('hold mode: moving at once is no drag', events.length === 0 && ids(h) === 'h1h2h3', events.join(' '));
    await wait(100);
    pointer('pointerdown', p.x, p.y, 'touch', byId('h1'));
    await wait(300);
    await wait(300);
    check('hold mode: the held tile lifts', /scale\(1\.05\)/.test(byId('h1').style.transform), byId('h1').style.transform);
    pointer('pointermove', p.x + 2 * STEP, p.y, 'touch');
    await frames(3);
    pointer('pointerup', p.x + 2 * STEP, p.y, 'touch');
    await frames(2);
    // Two cells right is the place of h2, to the right in the first row.
    check('hold mode: a move after the hold drags', ids(h) === 'h2h1h3', ids(h) + ' ' + events.join(' '));
    await wait(700);

    // 5b. Cross-slide: a finger that starts sideways is the scroller's, one that starts up or
    // down drags; a mouse drags either way.
    {
        const x = byId('x');
        record(x);
        check('cross-slide tiles pan sideways only', /pan-x/.test(getComputedStyle(byId('x1')).touchAction), getComputedStyle(byId('x1')).touchAction);
        events.length = 0;
        let q = center(byId('x1'));
        pointer('pointerdown', q.x, q.y, 'touch', byId('x1'));
        pointer('pointermove', q.x + 20, q.y + 3, 'touch');
        pointer('pointermove', q.x + 2 * STEP, q.y, 'touch');
        await frames(2);
        pointer('pointerup', q.x + 2 * STEP, q.y, 'touch');
        check('cross-slide: a sideways touch is no drag', events.length === 0 && ids(x) === 'x1x2x3', events.join(' '));
        await wait(100);
        // Down first, then over the place of x2 (two cells right).
        pointer('pointerdown', q.x, q.y, 'touch', byId('x1'));
        pointer('pointermove', q.x + 3, q.y + 20, 'touch');
        await frames(2);
        pointer('pointermove', q.x + 2 * STEP, q.y, 'touch');
        await frames(3);
        pointer('pointerup', q.x + 2 * STEP, q.y, 'touch');
        await frames(2);
        check('cross-slide: a touch that starts down drags', events[0] === 'tiledragstart:x1:null' && ids(x) === 'x2x1x3', ids(x) + ' ' + events.join(' '));
        await wait(700);
        events.length = 0;
        q = center(byId('x1'));
        pointer('pointerdown', q.x, q.y, 'mouse', byId('x1'));
        pointer('pointermove', q.x - 2 * STEP, q.y, 'mouse');
        await frames(3);
        pointer('pointerup', q.x - 2 * STEP, q.y, 'mouse');
        await frames(2);
        check('cross-slide: a mouse drags sideways too', ids(x) === 'x1x2x3', ids(x) + ' ' + events.join(' '));
        await wait(700);
        // A held mouse is a press, not a drag; a held finger lifts the tile.
        events.length = 0;
        q = center(byId('x1'));
        pointer('pointerdown', q.x, q.y, 'mouse', byId('x1'));
        await wait(650);
        const mouseHeld = byId('x1').style.transform;
        pointer('pointerup', q.x, q.y, 'mouse');
        let mouseClicked = false;
        byId('x1').addEventListener('click', () => (mouseClicked = true), { once: true });
        byId('x1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        check('cross-slide: a held mouse does not lift the tile', !/scale/.test(mouseHeld) && events.length === 0 && mouseClicked, `${mouseHeld} ${events.join(' ')} clicked=${mouseClicked}`);
        await wait(100);
        pointer('pointerdown', q.x, q.y, 'touch', byId('x1'));
        // The hold (500 ms) and the lift (240 ms).
        await wait(900);
        const touchHeld = byId('x1').style.transform;
        pointer('pointerup', q.x, q.y, 'touch');
        check('cross-slide: a held finger lifts the tile', /scale\(1\.05\)/.test(touchHeld), touchHeld);
        await wait(700);
    }

    // 5c. Vertical groups: a fixed width, growing downward, medium tiles row by row.
    {
        const v = byId('v');
        check('vertical: medium tiles fill rows of three', JSON.stringify(cellsOf(v)) === JSON.stringify([[0, 0], [2, 0], [4, 0], [0, 2]]), JSON.stringify(cellsOf(v)));
        check('vertical: fixed width, height from the tiles', v.style.width === `${6 * STEP - 4}px` && v.style.height === `${4 * STEP - 4}px`, `${v.style.width} x ${v.style.height}`);
        // Drag v1 down two cells: its place is below, where v4 is.
        record(v);
        events.length = 0;
        const q = center(byId('v1'));
        pointer('pointerdown', q.x, q.y, 'mouse', byId('v1'));
        pointer('pointermove', q.x, q.y + 2 * STEP, 'mouse');
        await frames(3);
        pointer('pointerup', q.x, q.y + 2 * STEP, 'mouse');
        await frames(2);
        check('vertical: dragging reorders', ids(v) === 'v2v3v4v1', ids(v) + ' ' + events.join(' '));
        await wait(700);
        // auto columns: as many as the width holds (180px: four 40px cells and their gaps).
        const va = byId('va');
        check('vertical: auto columns follow the width', JSON.stringify(cellsOf(va)) === JSON.stringify([[0, 0], [2, 0], [0, 2]]) && va.style.width === '', JSON.stringify(cellsOf(va)) + ' ' + va.style.width);
        // A height of the page's own stays with auto rows.
        const ha = byId('ha');
        check('auto rows keep the page\'s own height', ha.style.height === '90px' && JSON.stringify(cellsOf(ha)) === JSON.stringify([[0, 0], [2, 0]]), ha.style.height + ' ' + JSON.stringify(cellsOf(ha)));
    }

    // 6. One context menu event: right click, the menu key, and a held touch.
    events.length = 0;
    const d = byId('d');
    p = center(d);
    pointer('pointerdown', p.x, p.y, 'mouse', d, 2);
    const right = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 });
    d.dispatchEvent(right);
    pointer('pointerup', p.x, p.y, 'mouse', d, 2);
    check('right click fires tilecontextmenu', events.length === 1 && /^tilecontextmenu:d:.*"pointerType":"mouse"/.test(events[0]) && right.defaultPrevented, events.join(' '));
    await wait(1100);
    events.length = 0;
    const key = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 });
    d.dispatchEvent(key);
    check('the menu key fires tilecontextmenu', events.length === 1 && /"pointerType":"keyboard"/.test(events[0]), events.join(' '));
    events.length = 0;
    pointer('pointerdown', p.x, p.y, 'touch', d);
    await wait(650);
    const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y });
    d.dispatchEvent(native);
    pointer('pointerup', p.x, p.y, 'touch', d);
    check('a held touch fires tilecontextmenu once', events.length === 1 && /"pointerType":"touch"/.test(events[0]) && native.defaultPrevented, events.join(' '));
    events.length = 0;
    pointer('pointerdown', p.x, p.y, 'touch', d);
    await wait(100);
    pointer('pointerup', p.x, p.y, 'touch', d);
    check('a short touch is no context menu', events.length === 0, events.join(' '));

    // 7. --tile-drag-opacity: a tile with acrylic stays opaque while dragged.
    await wait(700);
    const dragBefore = g.getAttribute('drag');
    g.setAttribute('drag', 'press');
    const glass = byId('a');
    glass.style.setProperty('--tile-drag-opacity', '1');
    const from = center(glass);
    pointer('pointerdown', from.x, from.y, 'mouse', glass);
    pointer('pointermove', from.x + 2 * STEP, from.y);
    await frames(1);
    // A running opacity animation, even from 1 to 1, would make the tile a backdrop root.
    const opacityAnimations = glass.getAnimations().filter((x) => ((x.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some((k) => 'opacity' in k)).length;
    check('an opaque dragged tile runs no opacity animation', opacityAnimations === 0, String(opacityAnimations));
    await frames(2);
    await wait(300);
    check('--tile-drag-opacity: 1 keeps a dragged tile opaque', /scale\(1\.05\)/.test(glass.style.transform) && opacityOf(glass) === 1, `${glass.style.transform} ${opacityOf(glass)}`);
    pointer('pointermove', from.x, from.y);
    pointer('pointerup', from.x, from.y);
    await wait(100);
    // Under reduced motion the landing takes no time: the tile is back among the others at once.
    check('an opaque dropped tile stays above the others while it lands', glass.style.zIndex === (reduced ? '' : '1'), glass.style.zIndex);
    await wait(600);
    check('and goes back among them once it has landed', glass.style.zIndex === '', glass.style.zIndex);
    glass.style.removeProperty('--tile-drag-opacity');
    if (dragBefore === null) g.removeAttribute('drag');
    else g.setAttribute('drag', dragBefore);

    // 8. Keyboard: Alt+Shift+arrows move the focused tile, with the keys of Playwright. Safari has
    // no such keys here, so the checks are left out there.
    await driverStep('probe');
    if (window.__keys) {
        const k = byId('k') as AxTileGroup;
        record(k);
        const focusOn = (id: string) => (byId(id) as HTMLElement).focus();
        focusOn('k1a');
        events.length = 0;
        await press('Alt+Shift+ArrowRight');
        await wait(700);
        check('keyboard: Alt+Shift+ArrowRight moves the tile', ids(k) === 'k2k1k3k4' && JSON.stringify(cellsOf(k)) === JSON.stringify(expectedCells(k)), ids(k));
        check('keyboard: the move fires tilereorder with reason keyboard', events.join(' ') === 'tilereorder:k1:{"from":0,"to":1,"reason":"keyboard"}', events.join(' '));
        check('keyboard: the focus stays on the link of the moved tile', document.activeElement === byId('k1a'), document.activeElement ? document.activeElement.id : 'none');

        // The right edge: nothing moves, and no event.
        focusOn('k4a');
        events.length = 0;
        await press('Alt+Shift+ArrowRight');
        await wait(200);
        check('keyboard: a tile at the edge does not move', ids(k) === 'k2k1k3k4' && events.length === 0, `${ids(k)} ${events.join(' ')}`);

        // drag="none": nothing happens.
        const n = byId('n') as AxTileGroup;
        record(n);
        events.length = 0;
        focusOn('n1a');
        await press('Alt+Shift+ArrowRight');
        await wait(200);
        check('keyboard: drag="none" moves nothing', ids(n) === 'n1n2' && events.length === 0, `${ids(n)} ${events.join(' ')}`);

        // The arrows of a field in a tile are the field's.
        focusOn('k3i');
        events.length = 0;
        await press('Alt+Shift+ArrowRight');
        await wait(200);
        check('keyboard: a field in a tile keeps its arrow keys', ids(k) === 'k2k1k3k4' && events.length === 0, `${ids(k)} ${events.join(' ')}`);

        // A cancelled tilereorder keeps the order, and the focus.
        const veto = (e: Event) => e.preventDefault();
        k.addEventListener('tilereorder', veto);
        focusOn('k2a');
        events.length = 0;
        await press('Alt+Shift+ArrowDown');
        await wait(200);
        k.removeEventListener('tilereorder', veto);
        check('keyboard: a cancelled tilereorder keeps the order', ids(k) === 'k2k1k3k4' && events.join(' ') === 'tilereorder:k2:{"from":0,"to":2,"reason":"keyboard"}', `${ids(k)} ${events.join(' ')}`);
        check('keyboard: the focus stays after a cancelled move', document.activeElement === byId('k2a'), document.activeElement ? document.activeElement.id : 'none');
        await wait(600);

        // Right-to-left: the layout is not mirrored, so the keys follow the screen and ArrowRight
        // still moves the tile to the right.
        const r = byId('r') as AxTileGroup;
        record(r);
        focusOn('r1a');
        events.length = 0;
        const leftBefore = byId('r1').getBoundingClientRect().left;
        await press('Alt+Shift+ArrowRight');
        await wait(700);
        const leftAfter = byId('r1').getBoundingClientRect().left;
        check('rtl: ArrowRight moves the tile to the right on screen', leftAfter > leftBefore && events.length === 1 && events[0].indexOf('"reason":"keyboard"') > 0, `${leftBefore} -> ${leftAfter} ${ids(r)} ${events.join(' ')}`);
        await wait(300);
    }

    // 9. moveTile(): a move by the page, whatever the drag attribute says.
    {
        const m = byId('m') as AxTileGroup;
        const m1 = byId('m1');
        const m2 = byId('m2');
        const m3 = byId('m3');
        record(m);
        events.length = 0;
        check('moveTile moves a tile and fires tilereorder with reason api', m.moveTile(m1, 1) === true && ids(m) === 'm2m1m3' && events.join(' ') === 'tilereorder:m1:{"from":0,"to":1,"reason":"api"}', `${ids(m)} ${events.join(' ')}`);
        await wait(700);
        check('moveTile lays the tiles out', JSON.stringify(cellsOf(m)) === JSON.stringify(expectedCells(m)), JSON.stringify(cellsOf(m)));
        events.length = 0;
        check('moveTile to the place a tile has is false, with no event', m.moveTile(m1, 1) === false && events.length === 0, events.join(' '));
        check('moveTile out of range is false, with no event', m.moveTile(m2, 3) === false && m.moveTile(m2, -1) === false && m.moveTile(m2, 1.5) === false && events.length === 0, events.join(' '));
        check('moveTile of an element that is no tile is false', m.moveTile(byId('m1a'), 0) === false && m.moveTile(byId('k1'), 0) === false && m.moveTile(document.body, 0) === false && events.length === 0, events.join(' '));
        const veto = (e: Event) => e.preventDefault();
        m.addEventListener('tilereorder', veto);
        const vetoed = m.moveTile(m3, 0);
        m.removeEventListener('tilereorder', veto);
        check('moveTile is false when the event is cancelled, and keeps the order', vetoed === false && events.join(' ') === 'tilereorder:m3:{"from":2,"to":0,"reason":"api"}' && ids(m) === 'm2m1m3', `${vetoed} ${ids(m)} ${events.join(' ')}`);
        await wait(700);
    }

    // 10. Drag keeps the focus, and fires tilereorder with reason pointer.
    {
        const p = byId('p') as AxTileGroup;
        const p1 = byId('p1');
        record(p);
        (byId('p1a') as HTMLElement).focus();
        events.length = 0;
        const c = center(p1);
        pointer('pointerdown', c.x, c.y, 'mouse', p1);
        pointer('pointermove', c.x + 2, c.y + 2);
        pointer('pointermove', c.x + 2 * STEP, c.y);
        await frames(3);
        pointer('pointerup', c.x + 2 * STEP, c.y);
        await frames(2);
        // Where the tile lands depends on the window size of the engine: the check follows the event.
        const dropped = events.filter((e) => e.indexOf('tilereorder:p1:') === 0).map((e) => JSON.parse(e.slice('tilereorder:p1:'.length)))[0];
        const landed = Array.from(p.children).indexOf(p1);
        check('a drag fires tilereorder with reason pointer', !!dropped && dropped.from === 0 && dropped.to > 0 && dropped.reason === 'pointer' && landed === dropped.to, `${ids(p)} ${events.join(' ')}`);
        check('a drop keeps the focus on the link of the tile', document.activeElement === byId('p1a'), document.activeElement ? document.activeElement.id : 'none');
        await wait(700);
        const said = (p.shadowRoot!.querySelector('[role="status"]') as HTMLElement).textContent;
        check('a drag announces the new place too', !!dropped && said === `P1, moved to position ${dropped.to + 1} of 4`, said || '');
    }

    // 11. Announcements: the new place of a moved tile, in a live region of the shadow root.
    {
        const k = byId('k') as AxTileGroup;
        const said = (group: AxTileGroup) => {
            const live = group.shadowRoot!.querySelector('[role="status"]') as HTMLElement;
            return live ? live.textContent || '' : '';
        };
        const region = (group: AxTileGroup) => group.shadowRoot!.querySelector('[role="status"]') as HTMLElement;
        check('the live region is polite and in the shadow root', !!region(k) && region(k).getAttribute('aria-live') === 'polite' && getComputedStyle(region(k)).width === '1px', region(k) ? getComputedStyle(region(k)).width : 'none');
        if (window.__keys) {
            // The text follows the keyboard move, once the move has settled.
            (byId('k2a') as HTMLElement).focus();
            await press('Alt+Shift+ArrowRight');
            await wait(600);
            check('keyboard: the live region says where the tile is', said(k) === 'Two, moved to position 2 of 4', said(k));

            // A run of moves says only its last place: the region is emptied at each move.
            const seen: string[] = [];
            const observer = new MutationObserver(() => {
                if (said(k)) seen.push(said(k));
            });
            observer.observe(region(k), { childList: true, characterData: true, subtree: true });
            (byId('k2a') as HTMLElement).focus();
            await press('Alt+Shift+ArrowLeft|Alt+Shift+ArrowRight|Alt+Shift+ArrowLeft');
            await wait(600);
            observer.disconnect();
            check('a run of moves announces the last place only', JSON.stringify(seen) === JSON.stringify(['Two, moved to position 1 of 4']) && ids(k) === 'k2k1k3k4', JSON.stringify(seen) + ' ' + ids(k));

            // describeMove says it, when assigned.
            const describe = k.describeMove;
            k.describeMove = (tile, position, count) => `${tile.id} at ${position}/${count}`;
            (byId('k1a') as HTMLElement).focus();
            await press('Alt+Shift+ArrowLeft');
            await wait(600);
            k.describeMove = describe;
            check('a custom describeMove is used', said(k) === 'k1 at 1/4', said(k));

            // The region is emptied at once, and written only after the debounce (150 ms): still
            // empty after 60 ms, with the place after the wait. A key event made in the page.
            (byId('k2a') as HTMLElement).focus();
            byId('k2a').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true, composed: true, cancelable: true }));
            const at = said(k);
            await wait(60);
            const early = said(k);
            await wait(400);
            check('the announcement waits for the debounce', at === '' && early === '' && said(k) === 'Two, moved to position 1 of 4', `"${at}" "${early}" "${said(k)}"`);
        }

        // The API moves announce too, and a label is the aria-label of the tile, else of an element in
        // it, else the text.
        const l = byId('l') as AxTileGroup;
        l.moveTile(byId('l1'), 1);
        await wait(400);
        check('the label is the aria-label of the tile', said(l) === 'Mail, moved to position 2 of 3', said(l));
        l.moveTile(byId('l3'), 0);
        await wait(400);
        check('the label is the text of a tile without one', said(l) === 'Notes, moved to position 1 of 3', said(l));
        l.moveTile(byId('l2'), 2);
        await wait(400);
        check('the label is the aria-label of an element in the tile', said(l) === 'Calendar, moved to position 3 of 3', said(l));
        await wait(300);

        // announce="off": the move happens, the region stays empty.
        const o = byId('o') as AxTileGroup;
        o.moveTile(byId('o1'), 1);
        await wait(500);
        check('announce="off" keeps the region empty', ids(o) === 'o2o1' && said(o) === '', `${ids(o)} "${said(o)}"`);
    }

    // 12. Without moveBefore (Chromium before 133) the focus is taken away by insertBefore, and the
    // group gives it back. The check takes moveBefore away from the prototype for its run.
    {
        const proto = Element.prototype as Element & { moveBefore?: unknown };
        const native = proto.moveBefore;
        delete proto.moveBefore;
        try {
            const q = byId('q') as AxTileGroup;
            record(q);
            if (window.__keys) {
                (byId('q1a') as HTMLElement).focus();
                events.length = 0;
                await press('Alt+Shift+ArrowRight');
                await wait(700);
                check('without moveBefore: a keyboard move keeps the focus', ids(q) === 'q2q1q3q4' && document.activeElement === byId('q1a') && events.join(' ') === 'tilereorder:q1:{"from":0,"to":1,"reason":"keyboard"}', `${ids(q)} ${document.activeElement && document.activeElement.id} ${events.join(' ')}`);
            }
            // The first tile, dragged over the second place, with the focus on its link.
            const first = q.children[0] as HTMLElement;
            (first.querySelector('a') as HTMLElement).focus();
            const c = center(first);
            events.length = 0;
            pointer('pointerdown', c.x, c.y, 'mouse', first);
            pointer('pointermove', c.x + 2, c.y + 2);
            pointer('pointermove', c.x + 2 * STEP, c.y);
            await frames(3);
            pointer('pointerup', c.x + 2 * STEP, c.y);
            await frames(2);
            check('without moveBefore: a drop keeps the focus', document.activeElement === first.querySelector('a') && events.indexOf(`tilereorder:${first.id}:{"from":0,"to":1,"reason":"pointer"}`) >= 0, `${ids(q)} ${document.activeElement && document.activeElement.id}`);
            await wait(700);
        } finally {
            if (native) proto.moveBefore = native as typeof proto.moveBefore;
        }
    }

    // 13. Entrance, exit and launch: "ea" has no entrance, "en" (surfaces) and "ep" (plain elements)
    // have one; "en" plays it once it is scrolled into view.
    {
        const ea = byId('ea') as AxTileGroup;
        const en = byId('en') as AxTileGroup;
        const ep = byId('ep') as AxTileGroup;
        const enTiles = ['en1', 'en2', 'en3', 'en4'];
        record(en);
        const launch = (from: Element) => from.dispatchEvent(new CustomEvent('tilelaunchstart', { bubbles: true, composed: true, cancelable: true, detail: {} }));
        const launched = (from: Element) => from.dispatchEvent(new CustomEvent('tilelaunchend', { bubbles: true, composed: true, detail: {} }));

        // 13a. Without the attribute nothing animates on load.
        // 13a. --tile-entrance is none by default: nothing plays by itself, on load or later.
        check('--tile-entrance none (the default): the tiles are at rest on load', rest(ea) && Array.from(ea.children).every((c) => !motionOf(c)), Array.from(ea.children).map((c) => JSON.stringify(motionOf(c))).join(' '));
        await wait(1000);
        check('--tile-entrance none: nothing plays later either', rest(ea) && Array.from(ea.children).every((c) => !motionOf(c)), Array.from(ea.children).map((c) => JSON.stringify(motionOf(c))).join(' '));

        // 13b. The desktop entrance plays once the group is shown. The stagger is set long, so the
        // columns can be told apart.
        en.style.setProperty('--tile-enter-stagger', '300ms');
        check('entrance: the tiles wait hidden until the group shows', enTiles.every((id) => opacityOf(byId(id)) === 0), enTiles.map((id) => opacityOf(byId(id))).join(' '));
        byId('en').scrollIntoView({ block: 'start' });
        await wait(300);
        if (!reduced) {
            // en4, in the third band (four columns each), starts 2 x 300 ms after the first.
            check('entrance: the first column starts before the last', opacityOf(byId('en1')) > 0 && opacityOf(byId('en1')) < 1 && opacityOf(byId('en4')) === 0, `${opacityOf(byId('en1'))} ${opacityOf(byId('en4'))}`);
        }
        await wait(2300);
        check('entrance: the tiles end at their places, fully opaque', rest(en) && JSON.stringify(cellsOf(en)) === JSON.stringify(expectedCells(en)), JSON.stringify(cellsOf(en)));
        en.style.removeProperty('--tile-enter-stagger');
        // It plays once: a scroll away and back starts nothing.
        window.scrollTo(0, 0);
        await wait(200);
        byId('en').scrollIntoView({ block: 'start' });
        await wait(300);
        check('entrance: it plays once, not again when scrolled back in', rest(en), enTiles.map((id) => opacityOf(byId(id))).join(' '));

        // 13c. enter() and exit() of the desktop variant, with the timing of the page (1000 ms each)
        // and the default stagger.
        const exiting = en.exit({ variant: 'desktop' });
        if (!reduced) {
            await wait(100);
            check('desktop exit: midway the tiles fade, without turning', opacityOf(byId('en1')) > 0 && opacityOf(byId('en1')) < 1 && !motionOf(byId('en1'))?.rotateY, String(opacityOf(byId('en1'))));
        }
        await exiting;
        check('desktop exit: the tiles end invisible', enTiles.every((id) => opacityOf(byId(id)) === 0), enTiles.map((id) => opacityOf(byId(id))).join(' '));
        const t0 = performance.now();
        let arrived = false;
        let midBand: { dy: number; dx: number; s1: number; s2: number } | null = null;
        // Bands four columns wide: en1 and en2, side by side, enter together.
        en.style.setProperty('--tile-enter-band', '4');
        const entering = en.enter({ variant: 'desktop' }).then(() => (arrived = true));
        if (!reduced) {
            await wait(300);
            const m = motionOf(byId('en1'));
            const grown = /scale\(([\d.]+)\)/.exec(byId('en1').style.transform);
            check('desktop enter: midway a tile grows, on its host, between 0.8 and 1', !!grown && +grown[1] > 0.8 && +grown[1] < 1, byId('en1').style.transform);
            // en1 and en2 share the first band: one picture, scaled about one point. The distance of
            // their middles is the scale times the one at rest, and they are level.
            const middleOf = (id: string) => {
                const el = byId(id);
                const t = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
                return t ? { x: +t[1] + el.offsetWidth / 2, y: +t[2] + el.offsetHeight / 2 } : { x: NaN, y: NaN };
            };
            const scaleOf = (id: string) => {
                const g = /scale\(([\d.]+)\)/.exec(byId(id).style.transform);
                return g ? +g[1] : 1;
            };
            const a1 = middleOf('en1');
            const a2 = middleOf('en2');
            const s1 = scaleOf('en1');
            midBand = { dy: a2.y - a1.y, dx: a2.x - a1.x, s1, s2: scaleOf('en2') };
            check('desktop enter: midway a surface fades in, with its host 2D and opaque', !!m && m.opacity! > 0 && m.opacity! < 1 && getComputedStyle(byId('en1')).opacity === '1' && !/matrix3d/.test(getComputedStyle(byId('en1')).transform), `${JSON.stringify(m)} ${getComputedStyle(byId('en1')).transform}`);
        }
        await entering;
        en.style.removeProperty('--tile-enter-band');
        if (midBand) {
            const restDx = parseFloat(/translate\(([-\d.]+)px/.exec(byId('en2').style.transform)![1]) - parseFloat(/translate\(([-\d.]+)px/.exec(byId('en1').style.transform)![1]);
            const b = midBand as { dy: number; dx: number; s1: number; s2: number };
            check('desktop enter: the tiles of a band grow as one picture', restDx > 0 && b.s1 === b.s2 && b.s1 < 1 && Math.abs(b.dx - b.s1 * restDx) < 0.5 && Math.abs(b.dy) < 0.5, `${JSON.stringify(b)} rest ${restDx}`);
        }
        const took = performance.now() - t0;
        check('enter() resolves when the last tile arrived', arrived && (reduced ? took < 200 : took >= 1000 && took < 1400), `${Math.round(took)} ms`);
        check('enter() brings the tiles back to rest', rest(en), enTiles.map((id) => opacityOf(byId(id))).join(' '));

        // The plain elements: their hosts fade, and the timing is the same.
        const pe = ep.enter({ variant: 'desktop' });
        if (!reduced) {
            await wait(300);
            const o = parseFloat(getComputedStyle(byId('ep1')).opacity);
            check('desktop enter: midway a plain element fades in on its host', o > 0 && o < 1, String(o));
        }
        await pe;
        check('desktop enter of a plain element ends at rest', rest(ep), '');

        // 13d. The mobile variant: the turn about the left edge of the group, from 90 degrees.
        await en.exit({ variant: 'mobile' });
        check('mobile exit: the tiles end turned away and invisible', enTiles.every((id) => { const m = motionOf(byId(id)); return !!m && m.rotateY === 90 && m.opacity === 0; }), enTiles.map((id) => JSON.stringify(motionOf(byId(id)))).join(' '));
        const turning = en.enter({ variant: 'mobile' });
        if (!reduced) {
            await wait(300);
            const x4 = cellsOf(en)[3][0] * STEP;
            const m = motionOf(byId('en4'));
            check('mobile enter: midway a surface turns about the left edge of the group', !!m && m.rotateY! > 0 && m.rotateY! < 90 && Math.abs(m.originX! + x4) < 0.01 && x4 > 0, `${JSON.stringify(m)} x=${x4}`);
            check('mobile enter: no surface has a 3D transform on its host', enTiles.every((id) => !/matrix3d/.test(getComputedStyle(byId(id)).transform)), enTiles.map((id) => getComputedStyle(byId(id)).transform).join(' | '));
        }
        await turning;
        check('mobile enter ends at rest', rest(en), enTiles.map((id) => JSON.stringify(motionOf(byId(id)))).join(' '));

        const turningPlain = ep.enter({ variant: 'mobile' });
        if (!reduced) {
            await wait(300);
            const p3 = byId('ep3');
            const style = getComputedStyle(p3);
            const x3 = cellsOf(ep)[2][0] * STEP;
            check('mobile enter of a plain element: a 3D turn on its host, about the left edge', /matrix3d/.test(style.transform) && Math.abs(parseFloat(style.transformOrigin) + x3) < 0.01, `${style.transform} ${style.transformOrigin}`);
        }
        await turningPlain;
        check('mobile enter of a plain element ends at rest', rest(ep) && getComputedStyle(byId('ep3')).transformOrigin !== '', getComputedStyle(byId('ep3')).transformOrigin);

        // 13e. The exits: the plain elements end invisible, and an enter brings them back.
        await ep.exit({ variant: 'desktop' });
        check('exit of a plain element: invisible at its end', ['ep1', 'ep2', 'ep3', 'ep4'].every((id) => getComputedStyle(byId(id)).opacity === '0'), '');
        await ep.enter({ variant: 'desktop' });
        check('enter after an exit brings a plain element back', rest(ep), '');

        // 13f. Launch: the others shrink toward the middle of the screen and fade, in this group and
        // in every other group of the page; the launched tile stays. A canceled launch changes nothing, and tilelaunchend restores the group at once.
        launch(byId('en1'));
        await wait(300);
        {
            const box = en.getBoundingClientRect();
            const cx = window.innerWidth / 2 - box.left;
            const cy = window.innerHeight / 2 - box.top;
            const e2 = byId('en2') as HTMLElement;
            const [c2, r2] = cellsOf(en)[1];
            const tr = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/.exec(e2.style.transform);
            const wantX = cx + 0.9 * (c2 * STEP - cx) - 0.1 * (e2.offsetWidth / 2);
            const wantY = cy + 0.9 * (r2 * STEP - cy) - 0.1 * (e2.offsetHeight / 2);
            check('launch: the others shrink to 0.9 and fade', ['en2', 'en3', 'en4'].every((id) => opacityOf(byId(id)) === 0 && /scale\(0\.9\)/.test(byId(id).style.transform)), ['en2', 'en3', 'en4'].map((id) => byId(id).style.transform + ' ' + opacityOf(byId(id))).join(' | '));
            const others = Array.from(byId('ep').children) as HTMLElement[];
            check('launch: the tiles of another group shrink and fade too', others.length > 0 && others.every((t) => /scale\(0\.9\)/.test(t.style.transform) && getComputedStyle(t).opacity === '0'), others.map((t) => t.style.transform + ' ' + getComputedStyle(t).opacity).join(' | '));
            check('launch: the shrink is about the middle of the screen', !!tr && Math.abs(+tr[1] - wantX) < 0.5 && Math.abs(+tr[2] - wantY) < 0.5, `${e2.style.transform} want ${wantX.toFixed(1)} ${wantY.toFixed(1)}`);
        }
        check('launch: the launched tile is raised above the others', byId('en1').style.zIndex === '2', byId('en1').style.zIndex);
        check('launch: the launched tile is left alone', motionOf(byId('en1')) === null && !/scale/.test(byId('en1').style.transform), byId('en1').style.transform);
        // The synchronous restore: the others are back at once, and the entrance plays again.
        launched(byId('en1'));
        // Under reduced motion the entrance it starts is at its end at once.
        check('tilelaunchend puts the launched tile back in line', byId('en1').style.zIndex === '', byId('en1').style.zIndex);
        check('tilelaunchend restores the other groups at once too', Array.from(byId('ep').children).every((t) => !/scale/.test((t as HTMLElement).style.transform)), Array.from(byId('ep').children).map((t) => (t as HTMLElement).style.transform).join(' | '));
        // The launch's shrink (0.9) is gone; the entrance starts again from its own scale.
        check('tilelaunchend restores the others at once, and plays the entrance', ['en2', 'en3', 'en4'].every((id) => !/scale\(0\.9\)/.test(byId(id).style.transform)) && opacityOf(byId('en2')) === (reduced ? 1 : 0), ['en2', 'en3', 'en4'].map((id) => byId(id).style.transform + ' ' + opacityOf(byId(id))).join(' | '));
        await wait(1500);
        check('and the entrance ends at rest', rest(en), '');

        const veto = (e: Event) => e.preventDefault();
        en.addEventListener('tilelaunchstart', veto);
        launch(byId('en1'));
        await wait(300);
        en.removeEventListener('tilelaunchstart', veto);
        check('a canceled launch changes nothing', rest(en), enTiles.map((id) => byId(id).style.transform).join(' | '));

        // 13g. A drag during the entrance first jumps the entrance to its end, then drags as before.
        await en.exit({ variant: 'desktop' });
        events.length = 0;
        let arrivedAtDrag = false;
        en.enter({ variant: 'desktop' }).then(() => (arrivedAtDrag = true));
        await wait(300);
        const c2 = center(byId('en2'));
        pointer('pointerdown', c2.x, c2.y, 'mouse', byId('en2'));
        pointer('pointermove', c2.x + 2 * STEP, c2.y);
        await frames(2);
        check('a drag jumps the entrance to its end first', arrivedAtDrag && opacityOf(byId('en1')) === 1 && motionOf(byId('en1')) === null, `${arrivedAtDrag} ${JSON.stringify(motionOf(byId('en1')))}`);
        check('and the drag then works', events[0] === 'tiledragstart:en2:null', events.join(' '));
        pointer('pointerup', c2.x + 2 * STEP, c2.y);
        await frames(2);
        await wait(700);
        check('the drop after it lands the tiles', rest(en) && JSON.stringify(cellsOf(en)) === JSON.stringify(expectedCells(en)), JSON.stringify(cellsOf(en)));

        // 13h. Reduced motion: the end state on the next frame. Without it, the time is taken.
        await en.exit({ variant: 'desktop' });
        const t1 = performance.now();
        await en.exit({ variant: 'mobile' });
        const exitTook = performance.now() - t1;
        const t2 = performance.now();
        await en.enter({ variant: 'desktop' });
        const enterTook = performance.now() - t2;
        if (reduced) check('reduced motion: exit() and enter() reach their end state on the next frame', exitTook < 100 && enterTook < 100 && rest(en), `${Math.round(exitTook)} ${Math.round(enterTook)}`);
        else check('motion: exit() and enter() take their time', exitTook >= 500 && enterTook >= 1000, `${Math.round(exitTook)} ${Math.round(enterTook)}`);
    }

    // 13i. The variant is the one the page sets when it is used: a class changes it, and the next
    // entrance (explicit, or the one after a launch) plays that one.
    {
        const ev = byId('ev') as AxTileGroup;
        const evTiles = ['ev1', 'ev2'];
        await ev.enter();
        check('--tile-entrance desktop: the explicit default is desktop', evTiles.every((id) => !motionOf(byId(id))?.rotateY), evTiles.map((id) => JSON.stringify(motionOf(byId(id)))).join(' '));
        ev.classList.add('mobile-in');
        await frames(3);
        await ev.exit();
        check('a class sets --tile-entrance mobile: the explicit default exit is mobile', evTiles.every((id) => { const m = motionOf(byId(id)); return !!m && m.rotateY === 90 && m.opacity === 0; }), evTiles.map((id) => JSON.stringify(motionOf(byId(id)))).join(' '));
        const turningIn = ev.enter();
        if (!reduced) {
            await wait(300);
            const m = motionOf(byId('ev1'));
            check('a class sets --tile-entrance mobile: the explicit default enter turns', !!m && m.rotateY! > 0 && m.rotateY! < 90, JSON.stringify(m));
        }
        await turningIn;
        check('the mobile enter ends at rest', rest(ev), '');
        // The launch restores the tiles and plays the entrance of the variant at that moment.
        ev.dispatchEvent(new CustomEvent('tilelaunchend', { bubbles: true, composed: true, detail: {} }));
        if (!reduced) check('tilelaunchend plays the mobile variant the page sets then', evTiles.every((id) => { const m = motionOf(byId(id)); return !!m && m.rotateY === 90 && m.opacity === 0; }), evTiles.map((id) => JSON.stringify(motionOf(byId(id)))).join(' '));
        await wait(800);
        check('and it ends at rest', rest(ev), '');
        ev.classList.remove('mobile-in');
        await frames(3);
    }

    // 13j. A change of the layout during an entrance ends it where it is at once, resolves it, and
    // the new layout is then applied.
    {
        const en = byId('en') as AxTileGroup;
        const enTiles = ['en1', 'en2', 'en3', 'en4'];
        await en.exit({ variant: 'desktop' });
        let ended = false;
        const running = en.enter({ variant: 'desktop' }).then(() => (ended = true));
        await wait(200);
        en.style.setProperty('--tile-cell-width', '60px');
        await wait(150);
        check('a layout change ends a running entrance at once, and resolves it', ended && rest(en), `${ended} ${enTiles.map((id) => opacityOf(byId(id))).join(' ')}`);
        await running;
        await wait(700);
        // With 60 px cells the columns are 64 px apart: en2 is in the third column, at 128 px.
        const x = /translate\((-?[\d.]+)px/.exec(byId('en2').style.transform);
        check('after the change the tiles are laid out for the new sizes', !!x && Math.abs(+x[1] - 128) < 0.5 && rest(en), byId('en2').style.transform);
        en.style.removeProperty('--tile-cell-width');
        await wait(700);
        check('and back to the layout of the page', rest(en) && JSON.stringify(cellsOf(en)) === JSON.stringify(expectedCells(en)), JSON.stringify(cellsOf(en)));

        // A change of --tile-entrance ends a running entrance at once, too.
        let ended2 = false;
        const running2 = en.enter({ variant: 'desktop' }).then(() => (ended2 = true));
        await wait(200);
        en.classList.add('to-mobile');
        await frames(3);
        check('a change of --tile-entrance ends a running entrance at once', ended2 && rest(en), `${ended2} ${enTiles.map((id) => opacityOf(byId(id))).join(' ')}`);
        await running2;
        en.classList.remove('to-mobile');
        await frames(3);
        // A class that leaves the variant alone leaves a running entrance alone: the variant here is
        // mobile, so a re-read that wrongly took the old variant would end the run.
        en.classList.add('to-mobile');
        await frames(3);
        if (!reduced) {
            let ended3 = false;
            const running3 = en.enter({ variant: 'mobile' }).then(() => (ended3 = true));
            await wait(200);
            en.classList.add('unrelated');
            await frames(3);
            check('a class that leaves the variant alone does not end a running entrance', !ended3 && !rest(en), `${ended3} ${enTiles.map((id) => opacityOf(byId(id))).join(' ')}`);
            await running3;
            en.classList.remove('unrelated');
        }
        en.classList.remove('to-mobile');
        await frames(3);
        await wait(300);
        check('and the group is at rest after both', rest(en), '');
    }

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
