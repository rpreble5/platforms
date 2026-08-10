# assets

Sprites for the display. **Everything here is optional** — each one has a
procedural fallback, so the game runs with this folder empty and you can add
files one at a time and watch each appear.

Dimensions, slicing and tiling constraints: [`docs/ART-SPEC.md`](../docs/ART-SPEC.md).

| file | needed | drawn instead if missing |
|---|---|---|
| `bg.png` | one 16:9 image, any size | gradient sky with flat hills |
| `platform.png` | 3×3 tilesheet, square, transparent | rounded slab in the stage palette |
| `floor.png` | one square tile, tiles left-to-right | flat band with a lighter top edge |
| `fonts/display.woff2` | any variable/bold face | system rounded, then system sans |

`npm run testsheet` drops a known-good test pattern at `platform.png` for
checking the tiling. Delete it to go back to the placeholder.

These load over loopback, so file size is irrelevant here. Do **not** add art to
the phone page — thirty handsets fetching assets over contended WiFi at join
time is the worst moment of the night.
