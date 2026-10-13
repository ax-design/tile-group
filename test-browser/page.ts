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
    check('strip 1 is the WinJS order', JSON.stringify(cellsOf(g).slice(0, 4)) === JSON.stringify([[0, 0], [0, 2], [2, 0], [2, 2]]), JSON.stringify(cellsOf(g)));
    g.removeAttribute('strip');
    await frames(3);
    check('strip 4 (default) fills two medium tiles wide, row by row', JSON.stringify(cellsOf(g).slice(0, 4)) === JSON.stringify([[0, 0], [2, 0], [0, 2], [2, 2]]), JSON.stringify(cellsOf(g)));
    await wait(600);

    // 2. Resizing a tile lays the group out again.
    byId('b').setAttribute('columns', '4');
    await frames(3);
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
    check('the dragged tile lifts', /scale\(1\.05\)/.test(a.style.transform) && a.style.opacity === '0.65', `${a.style.transform} ${a.style.opacity}`);
    const preview = cellsOf(g);
    // B moves to the front, A's place.
    check('the others make room while dragging', JSON.stringify(preview[1]) === JSON.stringify([0, 0]) && /scale\(0\.95\)/.test(byId('b').style.transform), JSON.stringify(preview));
    pointer('pointerup', start.x + 2 * STEP, start.y);
    let clicked = false;
    a.addEventListener('click', () => (clicked = true), { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('the click after a drop is swallowed', !clicked);
    await frames(2);
    check('the drop fires tilereorder', events.some((e) => e === 'tilereorder:a:{"from":0,"to":1}'), events.join(' '));
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
    check('hold mode: the held tile lifts', /scale\(1\.05\)/.test(byId('h1').style.transform), byId('h1').style.transform);
    pointer('pointermove', p.x + 2 * STEP, p.y, 'touch');
    await frames(3);
    pointer('pointerup', p.x + 2 * STEP, p.y, 'touch');
    await frames(2);
    // Two cells right is the place of h2, to the right in the first row.
    check('hold mode: a move after the hold drags', ids(h) === 'h2h1h3', ids(h) + ' ' + events.join(' '));
    await wait(700);

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

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
