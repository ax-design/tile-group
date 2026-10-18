// Browser checks for <ax-tile-group>. Gestures are synthetic pointer events, so every engine
// (and Safari through WebDriver) runs the same steps.
import { layoutTiles, register } from '../src/index.js';
import type { AxTileGroup } from '../src/index.js';

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
    register();
    await frames(4);
    const g = byId('g') as AxTileGroup;
    record(g);
    record(byId('h'));

    // 1. Layout: the tiles sit where layoutTiles puts them; any element child is a tile.
    check('initial layout follows layoutTiles', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)), JSON.stringify(cellsOf(g)));
    check('tile sizes follow columns and rows', byId('e').style.width === '172px' && byId('e').style.height === '84px' && byId('f').style.width === '40px', byId('e').style.width);
    check('group size fits the tiles', g.style.height === '172px' && g.style.width === `${(Math.max(...expectedCells(g).map((c, i) => c[0] + [2, 2, 2, 2, 4, 1][i]))) * STEP - 4}px`, `${g.style.width} x ${g.style.height}`);

    // 1a. Tile defaults: pressed tilt and a 2 px border, both below any author style.
    {
        const tile = byId('c') as HTMLElement & { debugState: { values: { keyword(n: string): string; length(n: string): number } } };
        const v = () => tile.debugState.values;
        check('tiles tilt and have a 2px border by default', v().keyword('--ax-tilt-mode') === 'absolute' && v().length('--ax-border-width') === 2, `${v().keyword('--ax-tilt-mode')} ${v().length('--ax-border-width')}`);
        g.style.setProperty('--ax-tilt-mode', 'off');
        tile.style.setProperty('--ax-border-width', '0px');
        await frames(4);
        check('author styles override the tile defaults', v().keyword('--ax-tilt-mode') === 'off' && v().length('--ax-border-width') === 0, `${v().keyword('--ax-tilt-mode')} ${v().length('--ax-border-width')}`);
        g.style.removeProperty('--ax-tilt-mode');
        tile.style.removeProperty('--ax-border-width');
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
    check('the dragged tile lifts', /scale\(1\.05\)/.test(a.style.transform) && a.style.opacity === '0.65', `${a.style.transform} ${a.style.opacity}`);
    // Wait for the others to arrive (the dragged tile has lifted by now).
    await wait(650);
    const preview = cellsOf(g);
    // B moves to the front, A's place.
    check('the others make room while dragging', JSON.stringify(preview[1]) === JSON.stringify([0, 0]) && /scale\(0\.95\)/.test(byId('b').style.transform), JSON.stringify(preview));
    // With reduced motion (the mode of the second run) the drop lands at once, in the same call.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pointer('pointerup', start.x + 2 * STEP, start.y);
    if (reduced)
        check('reduced motion: the drop lands the tiles at once', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)) && a.style.opacity === '' && !/scale/.test(a.style.transform), JSON.stringify(cellsOf(g)));
    let clicked = false;
    a.addEventListener('click', () => (clicked = true), { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('the click after a drop is swallowed', !clicked);
    await frames(2);
    check('the drop fires tilereorder', events.some((e) => e === 'tilereorder:a:{"from":0,"to":1,"reason":"pointer"}'), events.join(' '));
    check('the drop reorders the children', ids(g) === 'bacdef', ids(g));
    await wait(700);
    check('after the drop the tiles rest in the new layout', JSON.stringify(cellsOf(g)) === JSON.stringify(expectedCells(g)) && a.style.opacity === '' && !/scale/.test(a.style.transform), JSON.stringify(cellsOf(g)));
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
    check('--tile-drag-opacity: 1 keeps a dragged tile opaque', /scale\(1\.05\)/.test(glass.style.transform) && glass.style.opacity === '', `${glass.style.transform} ${glass.style.opacity}`);
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

        // Right-to-left: the keys swap, so ArrowRight moves the tile back.
        const r = byId('r') as AxTileGroup;
        record(r);
        focusOn('r2a');
        events.length = 0;
        await press('Alt+Shift+ArrowRight');
        await wait(700);
        check('rtl: ArrowRight moves the tile the other way', ids(r) === 'r2r1r3r4' && events.join(' ') === 'tilereorder:r2:{"from":1,"to":0,"reason":"keyboard"}', `${ids(r)} ${events.join(' ')}`);
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
        check('a drag fires tilereorder with reason pointer', events.indexOf('tilereorder:p1:{"from":0,"to":1,"reason":"pointer"}') >= 0 && ids(p) === 'p2p1p3p4', `${ids(p)} ${events.join(' ')}`);
        check('a drop keeps the focus on the link of the tile', document.activeElement === byId('p1a'), document.activeElement ? document.activeElement.id : 'none');
        await wait(700);
        const said = (p.shadowRoot!.querySelector('[role="status"]') as HTMLElement).textContent;
        check('a drag announces the new place too', said === 'P1, moved to position 2 of 4', said || '');
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

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
