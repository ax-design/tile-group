// The size of a tile, read from the `columns` and `rows` attributes of a child of the group. Any
// element can be a tile; <ax-tile> comes from @ax-design/tile, which the group does not import.

// Missing or bad values make a medium tile (2 x 2 cells).
export function tileSpan(el: Element): { columns: number; rows: number } {
    const read = (name: string) => {
        const n = parseInt(el.getAttribute(name) || '', 10);
        return n > 0 ? n : 2;
    };
    return { columns: read('columns'), rows: read('rows') };
}
