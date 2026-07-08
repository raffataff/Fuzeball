# Fuzeball — canonical model dimensions

All numbers are in **game units** and mirror `js/config.js`. Coordinate system:
**X** = long axis (goals at `x = ±60`), **Y** = up (field at `y = 0`), **Z** = width
(side walls at `z = ±35.5`).

`tools/build_fuzeball_models.py` builds every part below at these exact dimensions
inside Blender and exports one `.glb` per part into `assets/`.

## Run it

```
blender -b -P tools/build_fuzeball_models.py
```

(or open Blender → Scripting → open the file → Run Script). It leaves the whole
table assembled in the scene so you can eyeball proportions, and writes the GLBs.
Output goes to `../assets/` relative to the script — override `ASSETS_DIR_OVERRIDE`
at the top if you want it elsewhere.

## The rod-length fix (handle-through-wall)

The bug: the game builds **every** rod with one length (`F.W+30`) and one handle
stick-out (`handleOut = 11`), but each rod slides a different amount:

| men | spacing | maxOff (slide range) |
|-----|---------|----------------------|
| 1 (GK)  | —    | **30.5** |
| 2 (DEF) | 24.0 | 18.5 |
| 3 (ATT) | 18.5 | 12.0 |
| 5 (MID) | 11.9 | 6.7 |

`maxOff = (W − margin − (men−1)·spacing) / 2`, with `W=68`, `margin=7`.

At full inward slide the goalie handle is dragged to `z = 45 − 30.5 = 14.5` — deep
inside the near wall (outer face at `z = 37`). That is the handle punching through.

The fix sizes each rod to **its own** slide range. The handle collar sits at

```
collar = WALL_OUT + CLEAR + maxOff        (WALL_OUT = 37, CLEAR = 2.5)
```

so at full inward slide the collar is still `CLEAR` units outside the wall, and the
symmetric bar (`−collar … +collar`) keeps the far end clear of the far wall too:

`collar` here is the distance from centre to the far stopper's inner face; the
handle grip's inner shoulder mirrors it on the near side. *The goalie's slide is
capped at `gkSlide = 13` (it stays in its goal area), so its rod is much shorter
than its raw 30.5 range would give.

| rod .glb | maxOff | collar | bar length | handle grip (+z) | collar bumper (−z) |
|----------|--------|--------|-----------|------------------|--------------------|
| `fuzeball_rod_1man.glb` | 13.0* | 52.5 | 115.8 | z 52.5–60.5 | z 52.5–54.9 |
| `fuzeball_rod_2man.glb` | 18.5 | 58.0 | 126.8 | z 58–66 | z 58–60.4 |
| `fuzeball_rod_3man.glb` | 12.0 | 51.5 | 113.8 | z 51.5–59.5 | z 51.5–53.9 |
| `fuzeball_rod_5man.glb` | 6.7  | 46.2 | 103.2 | z 46.2–54.2 | z 46.2–48.6 |

Each rod has a **collar** — the stopper bumper on the end opposite the handle
(radius `1.1` × length `2.4`) — and the bar tip pokes a constant `CAP_OUT = 3`
past it. The collar has to sit `collar` units out (≈ maxOff beyond the wall)
because the rod is rigid and slides ±maxOff; if it sat near the wall, pulling the
rod would drag it inside the table. Bar radius `0.55`, handle grip radius `1.4` ×
length `8`, knob radius `1.7` × length `2.4`. Origin is the **bar centre**
(`0,0,0`), bar along Z, handle on `+Z` (near-camera side), collar on `−Z`. The men
are separate (the game clones the player model onto the rod at `y = −8`), so the
rod GLB is bar + handle + knob + collar only.

## Static parts

| part | .glb | size (x,y,z) | position (x,y,z) |
|------|------|--------------|------------------|
| side wall (×2) | `fuzeball_wall_side.glb` | 130 × 12 × 3 | (0, 5, ±35.5) |
| end wall (×4)  | `fuzeball_wall_end.glb`  | 3 × 12 × 23  | (±61.5, 5, ±22.5) |
| LED strip (×2) | `fuzeball_led_strip.glb` | 130 × 0.7 × 0.7 | (0, 11.15, ±35.5) |
| table base     | `fuzeball_table_base.glb`| 130 × 10 × 78 | (0, −5.2, 0) |
| leg (×4)       | `fuzeball_table_leg.glb` | 4 × 34 × 4 | (±58, −27, ±32) |
| field          | `fuzeball_field.glb`     | 120 × 0.2 × 68 | (0, −0.1, 0) |

## Goal (×2, one at each end)

`fuzeball_goal.glb` is a generic goal with its opening on the `x=0` plane and the
net extending `+x`. Mirror it for the other end (left goal net → `−x`).

| piece | size (x,y,z) | position relative to goal line |
|-------|--------------|-------------------------------|
| post (×2) | 1.2 × 10.5 × 1.2 | (0, 5.25, ±11) |
| crossbar  | 1.2 × 1.2 × 23.2 | (0, 10.0, 0) |
| net       | 9 × 9.5 × 22 | (±6.1 outward, 4.75, 0) |

## Materials / naming

Each part has one named material slot. `team` (handle) and `team_glow` (knob) are
the two the game tints per side — keep those names if you want the game to keep
colouring them by team. `goal_net` is authored with alpha 0.4; set its blend mode
to *Alpha Blend* in Blender if you want it see-through before re-export.

## Axis note (why it lines up in the game)

Parts are authored in Blender with a Y-up → Z-up conversion so the table sits flat
in the viewport. The glTF exporter's default **+Y up** converts back, so the GLBs
land in the game's exact coordinate frame — load them with `GLTFLoader` and add to
the rod pivot / scene with no extra rotation.
