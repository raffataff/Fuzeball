# Shardsmith

A Blender add-on that fractures any mesh into pieces and blows them apart with rigid-body physics. It replaces
Blender's Cell Fracture add-on and the old `tools/fracture_script.py` (which drove Cell Fracture and also
depended on `Action.fcurves`, removed in Blender 5.0).

Tested on Blender 5.2 LTS. Needs 4.2 or newer.

## Install

`tools/blender/dist/shardsmith-1.1.0.zip` is a Blender extension. In Blender: **Edit > Preferences > Get Extensions >
(v menu, top right) > Install from Disk**, pick the zip, then make sure it is enabled. The panel appears in the 3D
viewport sidebar (**N**) under the **Shardsmith** tab. Upgrading from an older zip: install the new one over it and
restart Blender (or disable and enable the add-on). A scene that already has an explosion keyed by an older version
keeps that physics, so press **Set Up Explosion** again to use the new one.

Rebuild the zip after editing the source (validates the manifest too):

```
blender --command extension build --source-dir tools/blender/shardsmith --output-dir tools/blender/dist
```

## Opening the game's GLBs (KTX2 textures)

The shipped GLBs keep their textures as KTX2/Basis (`KHR_texture_basisu`), and Blender's own importer refuses them
("Extension KHR_texture_basisu is not available"). Use **File > Import > Game GLB (Shardsmith)** or the **Import Game
GLB** button in the sidebar instead. It runs `tools/ktx2-decode.mjs`, the inverse of `ktx2-encode.mjs`, which
transcodes every KTX2 image with the same Basis transcoder the game ships (`vendor/basis`) and writes PNGs. Meshes
are joined into one object so it can be shattered directly, and the images are packed into the .blend.

- It needs Node and `tools/node_modules` (`npm i` in `tools/`), and finds the tool by looking up from the GLB's
  own folder, so files inside the project just work. For files elsewhere, set **Game project folder** in the add-on
  preferences (and **Node.js** if it is not on the PATH).
- **Textures** picks the decode size: a 4096² albedo is 64 MB of RAM once decoded, and 1024 is plenty to fracture.
  The exported explosion GLB carries whatever size you imported at, so use Full for anything you will ship.
- If the decoder or Node cannot be found the file is still imported, with its geometry and materials but no
  textures, and a warning says why.
- Standalone: `node tools/ktx2-decode.mjs in.glb out.glb [--max-size 2048]`.

## The Innerds material

**Fracture Pattern > Inside Faces > Innerds (gore) by species** builds a wet, slightly gory `Innerds` material in the
file you have open and sets it as the interior material. Pick a species for the starting colour (Human, Animal, Alien
green/purple/blue, Cyborg, Robot); after that the panel shows **Species Colour**, **Wetness** and **Bumpiness** for
that material, or edit them on the material itself (the `Species Colour` node's second colour, the clearcoat, the
`Bumpiness` normal-map strength). Run the button again with another species to recolour the same material.

- Nothing external is needed: the maps (mottled flesh, dark clots, a warped vein network, pale fibres, and a matching
  normal map) are generated, tile seamlessly and are packed into the .blend. 512² by default; 256/1024 in the
  operator options.
- The albedo is a grey value map multiplied by the species colour, so one pattern serves every species.
- It exports as a normal glTF material: albedo texture, `baseColorFactor` = species colour, normal map and
  `KHR_materials_clearcoat` for the wet look. Subsurface is for Blender renders only (glTF has no equivalent).
- It is called `Innerds`, like the material in your existing explosion GLBs. If the file already has a hand-made
  `Innerds` it is never touched: the new one is called `Innerds Gore` instead.
- **UV Scale** on the inside faces is now in average piece widths (one repeat per piece at 1.0), so a tiling texture
  looks the same on a small prop and a large figurine.

## Use it for a game explosion

1. Select the figurine (one mesh object; join the parts first if it is several, or import it as above).
2. **Fracture Pattern > Preset > Figurine Collapse.** It reproduces the feel of the game's existing explosion clips
   (measured on them: gravity in scene units, peak speed ~17 units/s, pieces landing a median 3, at most ~7 units from
   where they started, on a table 68 wide), so the debris stays on the table and looks like the rest of the roster.
   **Figurine Burst** is the same shards thrown apart like a real explosion (a 1 m statue: 4x faster, 3x wider, it
   leaves the table); its **Real Height** is in metres and rescales gravity and mass, Collapse leaves it at 0, which
   means scene units.
3. **Shatter + Explode**. Scrub or play the timeline to see the blast. Change any setting and press
   **Set Up Explosion** to re-key the physics without re-fracturing, or **Shatter** again to re-fracture (it replaces
   the previous result).
4. **Bake & Export > Export GLB.** That is the only button you need: it bakes the simulation first if that has not
   been done (and sets up an explosion with the current settings if there is none), writes the GLB, checks what it
   wrote and reports the length ("38 pieces, 3.3 s of animation"), then compresses the textures to KTX2.

The GLB is one clip with a translation + rotation channel per shard, which `js/fracture.js` plays as it is
(`for (const clip of tpl.clips)`, LoopOnce, clamped at the last frame). The source object's material slots are kept
in the same order, so the `teamParts` material names (`kit_*`) still match; the inside faces use an extra material
called `Shardsmith Interior`.

**Why the export bakes for you.** An unbaked scene is a live simulation: the pieces have only the handful of keys of
their launch, so a GLB written from it is a third of a second long and the pieces stop dead in mid-air when the clip
ends (the game clamps on the last frame). A scene that was only shattered has no animation at all. Both used to
export without complaint.

**Run Until Settled** (Bake & Export, on by default): if pieces are still moving when the Duration ends, the bake
keeps simulating (up to twice the Duration more) until everything is at rest, for the same reason. If something still
moves at the end it says so.

**Compress Textures (KTX2)** runs the project's `tools/ktx2-encode.mjs` over the GLB after it is written (about
three seconds; 24 MB of video memory becomes 6 MB for a figurine). It needs Node.js and is found the same way as the
importer's decoder, from the export folder or the **Game project folder** preference. If it cannot run, the GLB keeps
its PNG textures and the message says why. Switch it off to keep PNGs.

## Why it does not artifact

Cell Fracture cuts with boolean operations, which only mean something for a watertight, manifold,
non-self-intersecting mesh. Shardsmith never asks the mesh to be any of those.

| Stage | Method |
|---|---|
| Inside/outside | **Generalized winding number**: 1 inside a closed shell, 0 outside, and it degrades smoothly across holes, gaps, flipped faces, duplicate faces and overlapping shells. Accelerated with a k-d cluster tree and dipole far-field. |
| Repair | Duplicate faces net out, opposite-facing coincident pairs vanish, every shell is wound consistently and outward, nested inward shells stay hollow, faces with solid on both sides (overlapping parts) are dropped. |
| Cells | Exact 3D Voronoi polyhedra (bounding box clipped by bisector planes, nearest neighbour first, on-plane tolerant). |
| Outer surface | The original triangles are clipped to each cell in barycentric space, so UVs, colour attributes and custom normals are interpolated from the source and seams survive. Nothing is remeshed. |
| Inside faces | Each cell wall is triangulated by a constrained Delaunay triangulation with the surface's cut segments as constraints; each triangle is kept or dropped by the winding number. A gap in the mesh leaves a gap in the cap, nothing else. Slivers next to the rim inherit their class from their region. |
| Roughness | Optional noise displacement of the inside faces, faded to zero at the rim and applied in one canonical direction per cell pair, so two pieces sharing a wall move it identically. |
| Physics | Rigid bodies with mass from the piece's real volume. Blender has no impulse API, so each piece is thrown as a kinematic body (moved by v*dt on the frame before release); Bullet keeps that velocity exactly. |

Things worth knowing:

- **Hollow shells:** a single-sided sheet (no volume) is detected and fractured as a surface with no inside faces.
- **Pieces inherit the source's holes.** If the source has an open border, pieces that touch it are open there too.
  The status bar says how many.
- **Real Height** scales gravity and mass: without it a 12-unit-tall model falls in slow motion.

### Why pieces do not repel each other

Bullet resolves overlap between rigid bodies by pushing them apart, and any overlap it inherits becomes energy, which
reads as a repulsive force. Every source of overlap is removed at its cause:

- **Collision hulls follow the flat piece, not the roughness.** Roughness lives on a shape key (`Rough`) and the rigid
  body collides as the base mesh, so bumpy fracture faces can never make neighbouring hulls overlap. The GLB export
  bakes the key into the mesh temporarily, then restores it.
- **The launch is solved, not just picked.** Each piece's launch velocity, including its spin, is adjusted so that no
  two touching or nearly touching pieces (or a piece and the floor) move toward each other; touching ones separate at
  least at **Clearance** (relative to the blast speed). Kinematic bodies do not collide, so without this a piece
  launched toward a still-sitting neighbour passes into it.
- **Blockers release first.** A piece inside the object cannot leave through neighbours that have not been released
  yet, so a piece moving toward a neighbour forces that neighbour to release no later than itself.
- **Steps are sized to the fastest piece, but only up to a point.** **Substeps = 0** picks enough that no piece can
  travel more than an eighth of its thickness in one physics step, counting both its launch speed and the speed it
  reaches falling the height of the model, between 3 and 40. More steps are not safer:
  Bullet pushes two overlapping bodies apart at (overlap / step length), and pieces that passed through each other
  during the break-up delay can still overlap when it ends. At 112 substeps that threw a piece out at four times the
  launch speed, at 400 at nine times, at 25 not at all.
- **Split impulse is on.** Without it Bullet turns the correction of an overlap into real velocity, at (overlap / step
  length): a shard squeezed between the floor and a heavy piece is ejected. Measured on the Collapse preset, Rocko's
  tiny shards went from a 124-unit throw to 9. The cost is that a pile can rest with a shard sunk a few percent of the
  model's height into a neighbour, in about one run in ten.
- **Piece weights are kept within 16:1** (`MASS_SPREAD`). Rocko's smallest shard was 1/700 of its biggest; the
  rigid bodies weigh in between (the launch speeds still follow the real mass).
- **The launch step is checked against the floor exactly.** The launch is a finite move (v*dt and a rotation of w*dt),
  not an instant, so a piece lying on the floor that is launched spinning sweeps its corners through the floor even
  when every contact point is moving up; Bullet then ejects it at hundreds of times the blast speed. After the
  contact solve the final pose of every piece is tested and it is lifted just clear of the floor.
- **Break-up delay.** Touching pieces sit on different collision layers for a few frames after release. The bake
  then checks, for every piece, whether its convex hull still overlaps a neighbour at the frame it joins the shared
  layer, because that pair would be pushed apart hard (`find_pops`). This is what throws small shards sitting in the
  hull of a heavier neighbour (a hand in a sleeve) across the table, and waiting longer makes it worse: they stay
  inside. Such a piece is kept off the shared layer (it still lands on the floor, it just passes through that
  neighbour) and the timeline is stepped again; the count is reported by the bake. On the Collapse preset this cut the
  runs with a piece more than 1.2 model heights away from 11 of 36 to 1 of 36.

`t_physics_quality` and `t_physics_figurines` measure this on hull penetration depth and on total energy after
release (contacts must never add energy): on the game's figurines the energy gained is 0.00%. The hull overlap is
0.02% for a scattered blast and 3-4% of the model's height for a collapse, where concave shards land in a heap and
nest into each other (it is the same with split impulse off). `t_no_flung_pieces` blasts six of
the figurines and fails if any piece's fastest frame is more than 1.6x what its launch and a fall from the top of the
model can explain (before the two fixes above, 6 of 18 figurines had a piece leaving at 2 to 11 times that; across
18 figurines and 4 seeds after them, none, and the worst frame is 0.84 of the limit). One cost: with fewer substeps a
piece can dip up to about 2% of the model's height into the floor for a frame at impact; at rest it is 0.02%.
The remaining limit is the convex hull itself: a strongly concave piece (an arm, a strand of hair) collides as its
hull, so it can touch a neighbour a little early.

## Tests

```
blender -b --factory-startup --python tools/blender/shardsmith_test.py [-- name ...]
```

Covers closed manifolds and volume conservation on primitives and every pattern; broken inputs (holes, flipped and
inside-out faces, duplicates, non-manifold fins, loose geometry, overlapping shells, cavities, a real hairline crack,
open sheets); the game's own figurines in `assets/`; and the add-on end to end (register, fracture, explode, run the
simulation, launch-velocity accuracy, floor contact, bake, GLB export, reset). The export tests cover every state the
scene can be in when Export is pressed (only shattered, set up but not baked, baked), a stepped bake, Run Until
Settled, KTX2 compression, and Set Up Explosion after a bake. The physics tests blast the figurines and check for
flung pieces (both presets), that the Collapse preset stays inside the game's existing clips, and the pop detector.
Renders of the results are useful when changing the engine: see `tools/build/shardsmith/` after a run of
`shardsmith_test.py`. When changing the physics, measure across every `assets/fuzeball_*.glb` and several seeds, not
one or two: a problem that hit 6 of 18 figurines never showed on the two that were being looked at.
