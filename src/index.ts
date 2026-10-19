// @ax-design/tile-group: tile groups of Axiom Design System, after the Windows 8 Start screen.
// The tiles are any elements; <ax-tile> is in @ax-design/tile, which this package does not define.
import { registerProperties } from '@ax-design/typed-om';
import type { PropertySpec } from '@ax-design/typed-om';
import { AxTileGroup } from './group.js';

export { AxTileGroup } from './group.js';
export { tileSpan } from './tile.js';
export { layoutTiles } from './layout.js';
export type { LayoutOptions, LayoutResult, Placement, TileSpan } from './layout.js';
export { dropTarget, keyboardTarget, moveIndex } from './reorder.js';
export type { Direction, DropOptions, DropTarget } from './reorder.js';
export type { DescribeMove } from './group.js';

const length = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'length' }, initial, inherits: true, register: true });

// Registered so that they compute to px. --tile-rows also takes auto, which registerProperty
// cannot express with the syntaxes of typed-om; it stays unregistered.
export const TILE_GROUP_PROPERTIES: PropertySpec[] = [length('--tile-cell-width', '70px'), length('--tile-cell-height', '70px'), length('--tile-gap', '10px')];

let registered = false;

// Defines <ax-tile-group>. Safe to call more than once. The group uses the services of
// @ax-design/surface but defines none of its elements.
export function register(): void {
    if (registered) return;
    registered = true;
    registerProperties(TILE_GROUP_PROPERTIES);
    if (!customElements.get(AxTileGroup.ElementName)) customElements.define(AxTileGroup.ElementName, AxTileGroup);
}
