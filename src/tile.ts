// <ax-tile>: a surface that takes part in a tile group. `columns` and `rows` give its size in
// cells of the group; changing them makes the group lay the tiles out again.
import { AxSurface } from '@ax-design/surface';

// Tiles that are not <ax-tile> work too (any element child of the group); they are medium sized
// unless they have the attributes.
export function tileSpan(el: Element): { columns: number; rows: number } {
    const read = (name: string) => {
        const n = parseInt(el.getAttribute(name) || '', 10);
        return n > 0 ? n : 2;
    };
    return { columns: read('columns'), rows: read('rows') };
}

// Defaults of a tile that differ from a plain surface, as :host rules: every author style wins
// over them. Border width is not inherited, so it is set here rather than on the group.
const TILE_STYLE = ':host { --ax-border-width: 2px; }';

export class AxTile extends AxSurface {
    static readonly ElementName: string = 'ax-tile';

    constructor() {
        super();
        const style = document.createElement('style');
        style.textContent = TILE_STYLE;
        this.shadowRoot!.insertBefore(style, this.shadowRoot!.firstChild);
    }

    static get observedAttributes() {
        return AxSurface.observedAttributes.concat(['columns', 'rows']);
    }

    attributeChangedCallback(name: string) {
        if (name === 'columns' || name === 'rows') {
            const group = this.parentElement as (HTMLElement & { tileChanged?: () => void }) | null;
            if (group && typeof group.tileChanged === 'function') group.tileChanged();
            return;
        }
        super.attributeChangedCallback(name);
    }
}
