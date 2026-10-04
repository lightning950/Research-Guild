# Modern Interiors (free version) by LimeZu

Source: https://limezu.itch.io/moderninteriors (free download, v2.2)

## License: NON-COMMERCIAL ONLY

See `LICENSE.txt` in this folder. In short: you may use and edit these sprites
in non-commercial projects. You may not use them commercially, and you may not
resell them. The paid version of the pack allows commercial use.

## What the app uses from here

Only 22 of the pack's files were copied in; the rest are not needed.

| File | Used for |
|---|---|
| `Room_Builder_free_16x16.png` | Wall and floor tiles |
| `Interiors_free_16x16.png` | Bookshelves, desks, blackboard, globe, map, rugs, plants, lamps |
| `characters/Bob_*` | The Planner |
| `characters/Amelia_*` | The Scribe |
| `characters/Alex_*` | The Warden |
| `characters/Adam_*` | The Scouts (shirt recoloured per scout, in code) |

Each character contributes five sheets: `_idle`, `_idle_anim`, `_phone`,
`_run` (walk cycles, six frames per direction, Phase 2) and `_sit3` (seated
poses for the off-duty routine, Phase 3).

Mind the frame size: most sheets are 16x32, but the pack's `_sit` and
`_sit2` sheets are **32x32**. Slicing those at 16 yields half a body per
frame. `_sit3` is the seated sheet that is genuinely 16x32, which is why it
is the one copied in.

The exact crop rectangles live in `static/js/interiors-art.js`; where the
furniture stands is in `static/js/world.js`.

## Removing the pack

Delete this whole folder. The app detects that the files are missing and falls
back to the procedurally generated art in `static/js/pixel-art.js`, so nothing
breaks.
