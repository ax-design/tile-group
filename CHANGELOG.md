# Changelog

All notable changes to this package are documented in this file.

## 0.2.4

- Depends on @ax-design/surface 0.4 and typed-om 0.3 (no duplicate copies next to packages that use them).

## 0.2.3

- `tilelift`, fired when a tile lifts, by a drag or a hold that has not dragged yet: a surface inside the tile should release its press then. A lift of a touch or a pen no longer ends with a click on the tile.

## 0.2.2

- A change of the layout during an entrance (a new order, new sizes) no longer ends it: the tiles take their new places at once and the entrance runs on. A group moves no tile while an entrance waits or runs, or while it is hidden, so an order restored before the group shows lands without moves.

## 0.2.1

- An entrance that `enter()` starts right after the page sets `--tile-entrance` keeps running. The group used to take the new value for a switch of the variant and end the entrance on the next frame, so the tiles appeared at once.

## 0.2.0

- `--tile-entrance` (desktop, mobile or none), `enter()`, `exit()`, and the launch of a tile (`tilelaunchstart` and `tilelaunchend`), see [Entrance and exit](README.md#entrance-and-exit) and [Launch](README.md#launch). A surface child now gets its drag opacity through `motion()`, not on its host.
- `<ax-tile-bound>` (`AxTileBoundary`), which runs the desktop entrances of the groups in it as one, see [Start screen](README.md#start-screen); `register()` defines it too. The turnstile now turns every tile about one vertical axis at the left edge of the viewport, with one vanishing point at the middle of its height, and `--tile-turnstile-origin` moves that axis; it turned about the left edge of each group before, with a vanishing point per tile.
- `<ax-tile>` moved to `@ax-design/tile`. tile-group no longer defines `<ax-tile>` and exports no `AxTile`: register `@ax-design/tile` for it. `register()` now defines only `<ax-tile-group>`, not `<ax-surface>`; register `@ax-design/surface` yourself if your page needs it. The group observes the `columns` and `rows` of its children itself, so any child can change its size. `tileChanged()` is deprecated; it still lays the group out.

## 0.1.4

- `--tile-drag-opacity`, the opacity of a dragged tile; set it to 1 for tiles with acrylic. A tile whose opacity stays the same runs no opacity animation: one from 1 to 1 turned the acrylic in it clear while it was lifted and dropped. In cross-slide, a held mouse no longer lifts the tile: it drags only once it moves. A dropped tile stays above the others until it has landed, also when its opacity does not change. Tiles move and fade by script in every engine, so acrylic in them stays drawn.

## 0.1.3

- `orientation="vertical"` and `--tile-columns`, for groups like the ones of the Windows 10 Start menu.

## 0.1.2

- `drag="cross-slide"`, the touch gesture of Windows 8 for groups in a horizontal scroller.

## 0.1.1

- Built on Surface 0.2.1, which ends the press of a tile at once when a drag starts.
