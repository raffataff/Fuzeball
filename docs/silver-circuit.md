# Silver Circuit

In **Table & Venue**, select **Circuit** for Table, **Silver Circuit** for
Skin, and **Silver Circuit** for Pitch. Skin and pitch are separate choices,
so either can be combined with other venue options. Reflections can be enabled
for the brushed-metal frame.

The skin uses the stock Circuit collision and rod set. Its dark goal cavities
hide the cosmetic net at rest; the net briefly appears for the goal ripple.
Goal collision and gameplay are unchanged.
The pitch has football markings, corner traces, and a separate emissive map.

## Rebuild and check

From the project root, with Blender and the dependencies in `tools/package.json`:

```text
blender -b --factory-startup -P tools/build_circuit_silver.py
node tools/build_silver_pitch.mjs
node tools/silver-circuit-harness.js
node tools/skin-net-harness.js
node tools/biggoal-harness.js
node tools/pitch-harness.js
```

`tools/render_circuit_silver.py` and `tools/render_circuit_silver_game_angle.py`
render the table and pitch for visual review. These are Blender previews rather
than screenshots of a running match.
