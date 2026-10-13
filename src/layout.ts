// Tile placement: the cell-spanning layout of the Windows 8 tile groups, after the
// CellSpanningGroup of WinJS (Microsoft's ListView for Windows 8 apps). No DOM.
//
// A group has a fixed number of rows of cells and grows to the right. Tiles keep their order:
// each one goes to the first free place, in scan order, that comes after the place of the tile
// before it. Places before it are not filled again, so a tile never moves in front of an
// earlier one.
//
// Scan order: the group is cut into strips of `strip` columns. Strips go left to right, inside
// a strip rows go top to bottom, inside a row columns go left to right. With strip 1 this is
// the column-major order of WinJS (top to bottom, then the next column). With strip 4 (two
// medium tiles of 2 x 2 cells) medium tiles fill a two-tile-wide column row by row.

export interface TileSpan {
    // Size in cells.
    columns: number;
    rows: number;
    // Start a new strip (column with strip 1) before this tile.
    newColumn?: boolean;
}

export interface Placement {
    column: number;
    row: number;
}

export interface LayoutResult {
    placements: Placement[];
    // Columns in use, the width of the group in cells.
    columns: number;
}

export interface LayoutOptions {
    // Rows of cells in the group.
    rows: number;
    // Width of a strip in columns, see above. Default 1.
    strip?: number;
}

export function layoutTiles(spans: TileSpan[], options: LayoutOptions): LayoutResult {
    const rows = Math.max(1, Math.floor(options.rows));
    const strip = Math.max(1, Math.floor(options.strip || 1));
    // occupied[column][row]
    const occupied: boolean[][] = [];
    let width = 0;
    const free = (column: number, row: number, span: TileSpan) => {
        if (row + span.rows > rows) return false;
        for (let c = column; c < column + span.columns; c++) {
            const col = occupied[c];
            if (!col) continue;
            for (let r = row; r < row + span.rows; r++) if (col[r]) return false;
        }
        return true;
    };
    const mark = (column: number, row: number, span: TileSpan) => {
        // A tile taller than the group sticks out below; only its cells inside count.
        for (let c = column; c < column + span.columns; c++) {
            const col = occupied[c] || (occupied[c] = []);
            for (let r = row; r < Math.min(rows, row + span.rows); r++) col[r] = true;
        }
        width = Math.max(width, column + span.columns);
    };

    const placements: Placement[] = [];
    // Scan position of the previous tile: strip, row, column inside the strip.
    let cursor = { strip: 0, row: 0, column: 0 };
    for (const raw of spans) {
        const span = { columns: Math.max(1, Math.floor(raw.columns)), rows: Math.max(1, Math.floor(raw.rows)), newColumn: raw.newColumn };
        // Strips that hold a cell, plus one past them: the scan never needs to go further.
        const lastStrip = Math.ceil(width / strip);
        let found: Placement | null = null;
        let s = cursor.strip;
        let row = cursor.row;
        let column = cursor.column;
        if (span.newColumn && width > 0) {
            // The next strip that is empty at the top, as WinJS does for newColumn.
            for (s = cursor.strip + 1; s <= lastStrip && !found; s++) if (free(s * strip, 0, span)) found = { column: s * strip, row: 0 };
        } else {
            for (; s <= lastStrip && !found; s++) {
                for (; row < rows && !found; row++) {
                    for (; column < strip && !found; column++) if (free(s * strip + column, row, span)) found = { column: s * strip + column, row };
                    column = 0;
                }
                row = 0;
            }
        }
        // Nothing fits (taller than the group, or every place taken): a new strip, at the top.
        if (!found) found = { column: Math.max(lastStrip, cursor.strip + (width > 0 ? 1 : 0)) * strip, row: 0 };
        mark(found.column, found.row, span);
        placements.push(found);
        cursor = { strip: Math.floor(found.column / strip), row: found.row, column: found.column % strip };
    }
    return { placements, columns: width };
}
