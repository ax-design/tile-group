# Tile Group

Web components that implement the tile groups of Axiom Design System, after the Windows 8 Start screen: tiles of any size on a grid of cells, reordered by dragging while the other tiles make room.

## Installation

```bash
// with npm
npm install @ax-design/tile-group

// with yarn
yarn add @ax-design/tile-group
```

and import it:

```javascript
//CommonJS
require('@ax-design/tile-group').register();

//ESModule
import { register } from '@ax-design/tile-group';
register();
```

If you don't use a bundler, load `build/main.js` (it exposes `AxTileGroup`) or import `build/index.mjs`.

## Usage

```html
<ax-tile-group drag="press" contextmenu>
  <ax-tile columns="4" rows="2" layers="fill reveal">Mail</ax-tile>
  <ax-tile columns="2" rows="2" layers="fill reveal">Calendar</ax-tile>
  <ax-tile columns="1" rows="1" layers="fill reveal">Settings</ax-tile>
</ax-tile-group>
```

`ax-tile` is an [`ax-surface`](https://github.com/ax-design/surface), so the layers, shapes and tilt of Surface work on it. `columns` and `rows` give its size in cells; change them and the other tiles move. Any other element in the group is a tile too, two by two cells unless it has the attributes.

Tiles look and move like the tiles of Windows out of the box: they tilt when pressed (the group sets `--ax-tilt-mode: absolute`, inherited, with the tilt of the original `ax-pressure`), and `ax-tile` has a 2px border for the reveal light. Any style of yours wins over both.

The order of the children is the order of the tiles. Tiles fill the group from the top left: each one takes the first free place after the tile before it, so a tile never jumps in front of an earlier one, and the group grows to the right.

## Attributes

### drag

`press`: a tile follows the pointer as soon as it moves. `hold`: a tile lifts after a press of `hold-delay` milliseconds, then follows the pointer; a quick move scrolls the page instead. `none` (default): no dragging.

While a tile is dragged, the others make room for it at once. Escape puts everything back.

### hold-delay

Milliseconds of a press before it counts as held. Default `500`.

### contextmenu

A right click, the context menu key, and a touch or pen press held for `hold-delay` milliseconds and released without moving fire one event, `tilecontextmenu`. The group shows no menu: listen to the event and show yours.

### strip

The order in which tiles fill the group. `4` (default) fills columns four cells wide (two medium tiles) row by row, like the Start screen. `1` fills column by column, top to bottom, which is the layout of WinJS; tiles jump around much more while you drag.

### grouping

Reserved for dragging tiles onto each other to form groups. It fires no events yet.

## Events

All events are fired on the tile and bubble.

* `tiledragstart`: a drag starts. Cancel it to keep the tile in place.
* `tilereorder`: a tile was dropped at a new place, `detail` is `{ from, to }`. Cancel it to put the tile back.
* `tiledragend`: the drag is over, `detail` is `{ from, to }` (equal when nothing moved).
* `tilecontextmenu`: `detail` is `{ clientX, clientY, pointerType }`; `pointerType` is `mouse`, `touch`, `pen` or `keyboard`.

## Style Controlling

### --tile-cell-width, --tile-cell-height

**Type:** `<length>`

**Default:** `70px`

**Description:** The size of a cell, a small tile. A medium tile is two by two cells.

### --tile-gap

**Type:** `<length>`

**Default:** `10px`

**Description:** The space between cells.

### --tile-rows

**Type:** `<number> | auto`

**Default:** `6`

**Description:** The rows of cells in the group. With `auto`, the group takes as many rows as its height holds; give it a height.

The group reads these properties again when the style may have changed (classes, attributes, hover, media queries), with the same triggers as Surface. For changes nothing reports, call `refresh()`.

## Motion

The motion is the one of WinJS, Microsoft's controls for Windows 8 apps: tiles move to new places in 367 ms, one after another 33 ms apart; a dragged tile grows to 1.05 and fades to 0.65 in 240 ms while the others shrink to 0.95, and everything settles in 500 ms on drop. The layout with `strip="1"` is the cell-spanning layout of WinJS; the tests compare it with layouts recorded from WinJS.

## Known issues

* Acrylic tiles inside a `position: sticky` container can show the wrong backdrop in Firefox while tiles move: Firefox renders a `backdrop-filter` under an animated `transform` of an ancestor wrongly there, and the tiles move with transforms.
* Dragging tiles onto each other to form groups is not there yet (see `grouping`).

## Development

```bash
bun install
bun run build         # es/, build/index.mjs, build/main.js
bun run check         # type check
bun test              # layout tests
bun run test:browser  # browser tests
bun run demo          # demo page
bun run oracle        # record the WinJS layouts again (needs Chromium from Playwright)
```
