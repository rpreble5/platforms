# The level library

One designed level per file, written by the **Save** button on the `/levels`
editor. These are content, like `questions/*.json` — commit the ones worth
keeping.

Format (`[centerX, tier, width]`, tiers 1–4 above the floor):

```json
{
  "name": "Twin Spires",
  "boards": [[500, 3, 300], [1400, 3, 300]],
  "rungs": [[960, 1, 400], [960, 2, 200]]
}
```

`boards.length` is the level's answer count. During a quiz, each choice
question picks a library level with a matching count, rotating by question
index; a question can pin one by name with `"level": "Twin Spires"`. Counts
with no designed level fall back to the shipped tables in `sim/levels.js`.

Files are sanitized on load — a corrupt file is skipped, never fatal.
