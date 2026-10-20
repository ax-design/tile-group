<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ax-design/tile-group/master/docs/logo-r.png">
    <img src="https://raw.githubusercontent.com/ax-design/tile-group/master/docs/logo.png" alt="Ax Tile Group">
  </picture>
</h1>

<p align="center">
  Web component that implements The Tile Group of Axiom Design System.
</p>

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

`<ax-tile>` is not in this package. It comes from `@ax-design/tile`, which defines it: register that package as well.

## Usage

```html
<ax-tile-group drag="press" contextmenu>
  <ax-tile columns="4" rows="2" layers="fill reveal">Mail</ax-tile>
  <ax-tile columns="2" rows="2" layers="fill reveal">Calendar</ax-tile>
  <ax-tile columns="1" rows="1" layers="fill reveal">Settings</ax-tile>
</ax-tile-group>
```

A child of the group can be any element, and each one is a tile. The recommended child is `<ax-tile>` from `@ax-design/tile`, an [`ax-surface`](https://github.com/ax-design/surface) with the layers, shapes and tilt of Surface. Its `columns` and `rows` give its size in cells. A child without the attributes is two by two cells. Change the `columns` or `rows` of any child and the group lays the tiles out again.

Tiles look and move like the tiles of Windows out of the box: the group sets `--ax-tilt-mode: absolute`, inherited, so tiles tilt when pressed with the tilt of the original `ax-pressure`. The other defaults of a tile, such as the 2px border for the reveal light of `<ax-tile>`, come from `@ax-design/tile`. Any style of yours wins over both.

The order of the children is the order of the tiles. Tiles fill the group from the top left: each one takes the first free place after the tile before it, so a tile never jumps in front of an earlier one, and the group grows to the right.

## Attributes

### drag

`press`: a tile follows the pointer as soon as it moves. `hold`: a tile lifts after a press of `hold-delay` milliseconds, then follows the pointer; a quick move scrolls the page instead. `cross-slide`: the touch gesture of Windows 8, for a group in a horizontal scroller such as [`ax-scroll`](https://github.com/ax-design/scroll): a finger that starts moving up or down drags the tile, one that starts sideways scrolls; a finger or pen held still lifts the tile, which then drags in any direction; a mouse drags as with `press`, once it moves, and holding it still does nothing. `none` (default): no dragging.

While a tile is dragged, the others make room for it at once. Escape puts everything back.

### hold-delay

Milliseconds of a press before it counts as held. Default `500`.

### contextmenu

A right click, the context menu key, and a touch or pen press held for `hold-delay` milliseconds and released without moving fire one event, `tilecontextmenu`. The group shows no menu: listen to the event and show yours.

### orientation

`horizontal` (default): a fixed number of rows, the group grows to the right, like the Windows 8 Start screen. `vertical`: a fixed number of columns, the group grows downward, like the groups of the Windows 10 Start menu; use `--tile-columns` instead of `--tile-rows`. A vertical group is the horizontal layout turned by a quarter, so everything else, dragging included, works the same.

### strip

The order in which tiles fill the group. `4` (default) fills columns four cells wide (two medium tiles) row by row, like the Start screen. `1` fills column by column, top to bottom, which is the layout of WinJS; tiles jump around much more while you drag.

In a vertical group, strips are rows: `2` (the default there) fills rows one medium tile tall, left to right, like the Start menu. Four small tiles make up one medium place, column by column.

### grouping

Reserved for dragging tiles onto each other to form groups. It fires no events yet.

### announce

`off` turns off the announcements of moves (see [Announcements](#announcements)). Any other value, or none, keeps them on.

## Events

All events are fired on the tile and bubble.

* `tiledragstart`: a drag starts. Cancel it to keep the tile in place.
* `tilereorder`: a tile moved to a new place, `detail` is `{ from, to, reason }`. Cancel it to keep the tile in place. `reason` is `pointer` (a drop), `keyboard` (Alt+Shift+Arrow) or `api` (`moveTile()`).
* `tiledragend`: the drag is over, `detail` is `{ from, to }` (equal when nothing moved).
* `tilecontextmenu`: `detail` is `{ clientX, clientY, pointerType }`; `pointerType` is `mouse`, `touch`, `pen` or `keyboard`.

## Keyboard

With `drag` set (`press`, `hold` or `cross-slide`), Alt+Shift+Arrow moves the focused tile, as the Start menu of Windows does: each press moves it to the next place in that direction, and holding the keys keeps it moving. The focus stays on the tile's content. Arrow keys in a field inside a tile are left to the field. The keys follow the screen: the layout is not mirrored with `direction: rtl`, so ArrowRight moves a tile to the right there too. The keys move tiles only; they do not move the focus from tile to tile.

## Moving tiles from the page

`moveTile(tile, to)` moves a tile to the index `to` (the `to` of `tilereorder`), animated, and returns `true`. It works with any `drag` setting. It returns `false`, and fires nothing, when `tile` is not a tile of the group, `to` is out of range or the tile would stay where it is; it also returns `false` when a listener cancels the `tilereorder` it fires (with `reason` `api`).

A single-pointer "Move" command can be offered this way: listen to `tilecontextmenu`, show a menu with a Move item, and call `moveTile()` with the place the user picks.

## Announcements

After every move, by the keyboard, by a drop or by `moveTile()`, the group writes where the tile is into a visually hidden live region (`role="status"`), such as "Mail, moved to position 2 of 6". The label is the tile's `aria-label`, else the `aria-label` of an element inside it, else its text. Moves in a run are announced once, the last place. `announce="off"` turns this off.

To word it in another language, assign `describeMove`. It is called with the tile, the 1-based position and the number of tiles:

```javascript
group.describeMove = (tile, position, count) => `${tile.dataset.name}, Position ${position} von ${count}`;
```

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

**Description:** The rows of cells in a horizontal group. With `auto`, the group takes as many rows as its height holds; give it a height.

### --tile-columns

**Type:** `<number> | auto`

**Default:** `6`

**Description:** The columns of cells in a vertical group (three medium tiles, as in the Windows 10 Start menu). With `auto`, the group takes as many columns as its width holds.

### --tile-drag-opacity

**Type:** `<number>`

**Default:** `0.65`

**Description:** The opacity of a dragged tile, inherited, so you can set it on the group or on one tile. Set `1` for tiles with acrylic, or anything else with a `backdrop-filter`: an element with an opacity below 1 is a backdrop root, so the filter inside it sees nothing behind the tile, and the glass turns clear while the tile is dragged.

The group reads these properties again when the style may have changed (classes, attributes, hover, media queries), with the same triggers as Surface. For changes nothing reports, call `refresh()`.

## Motion

Tiles move and fade by script, frame by frame, in every engine, not with the Web Animations API: animations of the browser turn acrylic in a tile clear (Firefox while they run, Chromium for a moment after a drop). The motion is the one of WinJS, Microsoft's controls for Windows 8 apps: tiles move to new places in 367 ms, one after another 33 ms apart; a dragged tile grows to 1.05 and fades to 0.65 in 240 ms while the others shrink to 0.95, and everything settles in 500 ms on drop. With `prefers-reduced-motion: reduce` the same end states are set at once, with no motion. The layout with `strip="1"` is the cell-spanning layout of WinJS; the tests compare it with layouts recorded from WinJS.

## Entrance and exit

The entrance is chosen with the `--tile-entrance` custom property: `desktop`, `mobile`, or `none` (the default, which plays nothing by itself). It is inherited and read from the group's style, so a media query can switch it:

```css
ax-tile-group { --tile-entrance: desktop; }
@media (max-width: 600px) { ax-tile-group { --tile-entrance: mobile; } }
```

With a variant set, the group plays it once, the first time it is visible (with an IntersectionObserver), and again after a launch is restored (see [Launch](#launch)). Each automatic play uses the variant the property says at that moment.

`enter({ variant })` plays the entrance by hand and resolves when the last tile has arrived; `exit({ variant })` plays the matching exit and resolves when the last tile has gone. `variant` overrides the property; without it they use the property, and `desktop` when it is `none`. The tiles stay invisible after an exit until the next `enter()` or a re-layout. A drag or a keyboard move during an entrance or an exit first jumps it to its end state.

A change in the middle of an entrance or an exit ends it at once, at its end state, and resolves its promise: a change of the places, the sizes or the children of the group (a resize that moves tiles included), or a change of the variant the property gives. The new layout or variant then applies as usual; a running animation is never switched from one variant to the other.

**Desktop** is the entrance of the Windows 8 Start screen. The tiles enter in bands, a few columns wide, one band after another. A band is one picture: it starts smaller and transparent, and grows to its full size as it fades in, about the middle of the band along the group and the middle of the group across it, so its tiles keep together. The bands start drawn toward the middle of the viewport and a little to the right, and open out to their places: a band far to the left travels further than one near the middle. The fade is the fastest, the move the slowest. The defaults are fitted, tile by tile, to a 60 fps recording of Windows 8.1 (within 2 px of every tile in every frame), with curves of the Windows animation theme (`windowsEasing(id)` of `@ax-design/surface`).

* `--tile-enter-band`: the columns in a band; by default those of a strip (see `strip`), four, which is the width of a wide tile and a column of the Start screen. With `orientation="vertical"` it counts rows.
* `--tile-enter-spread`: where the bands start, as a share of their distance from the middle of the viewport, `0.93`.
* `--tile-enter-offset`: how much further to the right the bands start, a length; by default 1% of the width of the viewport.
* `--tile-enter-duration`: the move, `530ms`.
* `--tile-enter-easing`: the curve of the move, `cubic-bezier(0.17, 0.55, 0.3, 0.95)` (curve 61).
* `--tile-enter-scale`: the scale a band starts at, `0.8`.
* `--tile-enter-scale-duration`: the growth to full size, `450ms`.
* `--tile-enter-scale-easing`: the curve of the growth, `cubic-bezier(0.1, 0.9, 0.2, 1)` (curve 4).
* `--tile-enter-fade`: the fade in, linear, `133ms`.
* `--tile-enter-stagger`: the delay between two bands, `35ms`.
* `--tile-enter-delay`: the delay before the first band, `0ms`. In an `<ax-tile-bound>` (see [Start screen](#start-screen)), set it once on the boundary: it is inherited, and each group reads it as its own.
* `--tile-exit-duration`: the fade of the exit, which does not move, `200ms`.

**Mobile** is the turnstile of Windows Phone, after the Flutter implementation of the team: each tile turns 90 degrees, to face the viewer, while it fades in; the exit turns it away again. Every tile of every group turns about the same vertical axis, at the left edge of the viewport, and they share one vanishing point, at the middle of the viewport's height, as in WinJS (`collectTurnstileTransformOrigins`): the turn of a tile is about that axis from its resting place, whatever group it is in and wherever the group sits. A tile starts at `tileY * 0.001714 + tileX * 0.00047 + random * 0.1` of the duration (a fraction, clamped to 0 to 0.9), so the tiles lower in the group come later, and those to the right come later when entering and earlier when exiting; `-0.00047` for the exit.

* `--tile-turnstile-perspective`: `1000px`.
* `--tile-turnstile-origin`: how far to the left of the viewport's left edge the axis of the turn is, a length, `0px`. WinJS uses `40px`.
* `--tile-turnstile-duration`: `600ms`.
* `--tile-turnstile-easing`: `cubic-bezier(0.22, 1, 0.36, 1)`, easeOutQuint.

Times are `ms` or `s`, lengths are `px`, and invalid values fall back to the defaults. The parameters are read when an animation starts.

**Reduced motion**: with `prefers-reduced-motion: reduce`, `enter()` and `exit()` jump to their end state at once, and their promises resolve on the next frame.

**Focus**: focus inside a group during its entrance, or before it has played, ends the entrance at once, so a keyboard user sees the tile that has the focus. An exit runs on.

**For authors of children**: the group moves each child's transform, and sets its `z-index`. A child that is a surface (it has a `motion()` method, like `<ax-surface>`) gets its 3D turn and its opacity through `motion()`, never through a CSS 3D transform or `opacity` on its host: in Firefox no 3D transform may sit above acrylic, and an opacity on an ancestor makes it the backdrop root in every engine. Any other element gets them on its host, the turn in 3D with its `transform-origin` on the axis of the turnstile. Set your own 3D or opacity on a surface's `motion()` only when the group does not run an entrance or a launch at that moment.

## Launch

When a tile is launched anywhere on the page, the other tiles of every group shrink toward the middle of the screen and fade, as the whole Start screen of Windows does, and the launched tile is left as it is. Each group listens on the document to the bubbling `tilelaunchstart` event of the tile, and to `tilelaunchend`, which restores the tiles at once and plays the entrance again when `--tile-entrance` sets a variant. A listener that cancels `tilelaunchstart` stops the launch. The group does not import `@ax-design/tile`: the events are fired by the launching tile, which is up to you (`@ax-design/tile` fires them).

* `--tile-launch-exit-scale`: the scale of the others, `0.9`.
* `--tile-launch-exit-duration`: `100ms`, as measured on a recording of Windows 8.1.

The launched tile is raised above the others (`z-index`) until `tilelaunchend`, as `@ax-design/tile` grows it toward the middle of the screen.

## Start screen

The background of the Start screen is the page's own, behind the groups. As in Windows 8.1, it comes in first (about 120 ms), then the bands of all the groups, 35 ms apart, as if they were one: a group adds no pause of its own, so the second group starts one stagger after the last band of the first, and every band grows about the middle of all the groups across them (the vertical middle of the tile area), not of its own group.

`<ax-tile-bound>` couples the groups that way. It is a boundary, like `<ax-reveal-bound>` of reveal-highlight: it draws nothing and has no styles of its own, and the groups inside it, at any depth and through shadow roots, find it when they connect. The groups whose desktop entrance starts within 50 ms of each other form a wave, as those started by the same scroll into view or the restore after a launch do. Within a wave, the groups are taken in order along their axis (by their left edge, or their top when vertical; document order for equal edges), and the bands of a group go on from those of the groups before it: a group has as many bands as its columns (rows, vertical) need, in bands of its own `--tile-enter-band`. A group that enters later, scrolled into view or added, starts its own wave at the first band. The boundary measures the groups of a wave once, and again when the wave, the window size or the layout of one of them changes, not at every frame. The turnstile does not use the boundary. Without a boundary, each group counts its bands from the first and grows about its own middle.

```html
<style>
  body { background: url(start-background.jpg) center / cover; }
  ax-tile-bound { display: flex; --tile-entrance: desktop; --tile-enter-delay: 120ms; }
</style>
<ax-tile-bound>
  <ax-tile-group> ... </ax-tile-group>
  <ax-tile-group> ... </ax-tile-group>
</ax-tile-bound>
```

`register()` defines `<ax-tile-bound>` with `<ax-tile-group>`.

## Known issues

* Dragging tiles onto each other to form groups is not there yet (see `grouping`).

## Changes

* 0.1.1: Built on Surface 0.2.1, which ends the press of a tile at once when a drag starts.
* 0.1.2: `drag="cross-slide"`, the touch gesture of Windows 8 for groups in a horizontal scroller.
* 0.1.3: `orientation="vertical"` and `--tile-columns`, for groups like the ones of the Windows 10 Start menu.
* 0.1.4: `--tile-drag-opacity`, the opacity of a dragged tile; set it to 1 for tiles with acrylic. A tile whose opacity stays the same runs no opacity animation: one from 1 to 1 turned the acrylic in it clear while it was lifted and dropped. In cross-slide, a held mouse no longer lifts the tile: it drags only once it moves. A dropped tile stays above the others until it has landed, also when its opacity does not change. Tiles move and fade by script in every engine, so acrylic in them stays drawn.
* 0.2.0: `--tile-entrance` (desktop, mobile or none), `enter()`, `exit()`, and the launch of a tile (`tilelaunchstart` and `tilelaunchend`), see [Entrance and exit](#entrance-and-exit) and [Launch](#launch). A surface child now gets its drag opacity through `motion()`, not on its host.
* 0.2.0: `<ax-tile-bound>` (`AxTileBoundary`), which runs the desktop entrances of the groups in it as one, see [Start screen](#start-screen); `register()` defines it too. The turnstile now turns every tile about one vertical axis at the left edge of the viewport, with one vanishing point at the middle of its height, and `--tile-turnstile-origin` moves that axis; it turned about the left edge of each group before, with a vanishing point per tile.
* 0.2.0: `<ax-tile>` moved to `@ax-design/tile`. tile-group no longer defines `<ax-tile>` and exports no `AxTile`: register `@ax-design/tile` for it. `register()` now defines only `<ax-tile-group>`, not `<ax-surface>`; register `@ax-design/surface` yourself if your page needs it. The group observes the `columns` and `rows` of its children itself, so any child can change its size. `tileChanged()` is deprecated; it still lays the group out.
* 0.2.1: An entrance that `enter()` starts right after the page sets `--tile-entrance` keeps running. The group used to take the new value for a switch of the variant and end the entrance on the next frame, so the tiles appeared at once.

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
