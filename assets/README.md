# assets

Sprites for the display. **Everything here is optional** — each one has a
procedural fallback, so the game runs with this folder empty and you can add
files one at a time and watch each appear.

Dimensions, palette and generation prompts: [`docs/ART-SPEC.md`](../docs/ART-SPEC.md).

| file | needed | drawn instead if missing |
|---|---|---|
| `bg.png` | 3840×2160 | gradient sky with flat hills |
| `platform.png` | 512×152, alpha | rounded slab in the stage palette |
| `floor.png` | 512×240, tileable | flat band with a lighter top edge |
| `fonts/display.woff2` | any variable/bold face | system rounded, then system sans |

These load over loopback, so file size is irrelevant here. Do **not** add art to
the phone page — thirty handsets fetching assets over contended WiFi at join
time is the worst moment of the night.
