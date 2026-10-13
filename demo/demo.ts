import { registerRevealLayer } from '@ax-design/reveal-highlight';
import { register } from '@ax-design/tile-group';
import type { AxTileGroup } from '@ax-design/tile-group';

registerRevealLayer();
register();

const group = document.getElementById('group') as AxTileGroup;
const log = document.getElementById('log') as HTMLElement;
const menu = document.getElementById('sizeMenu') as HTMLElement;

const name = (tile: Element) => (tile.querySelector('.label') || tile.querySelector('.glyph'))!.textContent;
const write = (line: string) => {
    log.textContent = `${line}\n${log.textContent}`.slice(0, 4000);
};

for (const type of ['tiledragstart', 'tiledragend', 'tilereorder', 'tilecontextmenu']) {
    group.addEventListener(type, (event) => {
        const detail = (event as CustomEvent).detail;
        write(`${type.padEnd(16)} ${name(event.target as Element)}${detail ? ' ' + JSON.stringify(detail) : ''}`);
    });
}

// The context menu is the page's business: the group only says where and for which tile.
let menuTile: HTMLElement | null = null;
group.addEventListener('tilecontextmenu', (event) => {
    const { clientX, clientY } = (event as CustomEvent).detail;
    menuTile = event.target as HTMLElement;
    menu.hidden = false;
    menu.style.left = `${Math.min(clientX, innerWidth - 160)}px`;
    menu.style.top = `${Math.min(clientY, innerHeight - 150)}px`;
    (menu.querySelector('button') as HTMLElement).focus();
});
menu.addEventListener('click', (event) => {
    const size = (event.target as HTMLElement).getAttribute('data-size');
    if (size && menuTile) {
        const [columns, rows] = size.split(' ');
        menuTile.setAttribute('columns', columns);
        menuTile.setAttribute('rows', rows);
    }
    menu.hidden = true;
});
document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node)) menu.hidden = true;
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.hidden = true;
});

const drag = document.getElementById('drag') as HTMLSelectElement;
drag.addEventListener('change', () => group.setAttribute('drag', drag.value));
const menuToggle = document.getElementById('menu') as HTMLInputElement;
menuToggle.addEventListener('change', () => group.toggleAttribute('contextmenu', menuToggle.checked));
const rows = document.getElementById('rows') as HTMLInputElement;
// The group picks up style changes by itself.
rows.addEventListener('input', () => group.style.setProperty('--tile-rows', rows.value));
const strip = document.getElementById('strip') as HTMLSelectElement;
strip.addEventListener('change', () => group.setAttribute('strip', strip.value));
