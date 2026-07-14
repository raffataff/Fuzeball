# Implementation plan — GLB pitches (replace flat pitch images)

Handover spec for another agent. Read `CLAUDE.md` first for conventions (dense
non-module scripts, one global scope, rewrite whole functions, new tunables → CONFIG).

## Goal

Replace the flat per-theme pitch image (`assets/pitches/pitch_*.jpg` mapped onto a
flat plane) with exported Blender pitch **geometry + materials** from a GLB, while
keeping the existing jpg path as an automatic fallback.

## Current state (what exists today)

- `world.js:68` — `fieldMesh = Mesh(PlaneGeometry(F.L, F.W), MeshStandardMaterial)`.
  Flat, `rotation.x=-PI/2`, `receiveShadow=true`, added to `primTable`.
- `world.js:70-75` — for each theme, `TextureLoader.load('assets/'+th.pitch, …)` fills
  `fieldTexCache[key]`; on load the current theme's texture is assigned to
  `fieldMesh.material.map`.
- `world.js:274-277` — `drawField()` sets `fieldMesh.material.map = fieldTexCache[cfg.theme]`.
  Called from `applyTheme`, `applyColors`, and after a table GLB loads.
- `config.js:607-611` — `themes:{classic,neon,royal,verdant}`, each with a `pitch:'pitches/…jpg'`.
- `models.js:28` — when a **table** GLB loads, any mesh whose name starts with `field` is
  set `visible=false` ("themed pitch plane stays instead"). So the pitch is already a
  standalone, table-agnostic object.
- `arena.js:162` — `applyTable()` reparents the single shared `fieldMesh` into whichever
  table group is active (`primTable` / `arenaTable`). The flat pitch works on both tables.
- Reference pattern to copy: `models.js:174-225` — `loadBallModel` / `makeBallModel`.
  One `fuzeball_ball.glb` holds one mesh per ball type (all overlapped at origin); the
  loader maps `meshName → material` and `makeBallModel(key)` shows ONLY the matching mesh.

## Decision: single GLB, one mesh per pitch (NOT one mesh with multiple material slots)

- **Multiple material slots on one mesh** = geometry groups that ALL render at once. Good
  for authoring ONE pitch from several materials (grass base + painted lines + logo), but
  it cannot switch between pitch looks.
- **Switching between pitch variants** needs one object per variant to show/hide.
- These are orthogonal, so do both: one `fuzeball_pitch.glb` containing one **object per
  pitch variant**, each object free to use as many internal material slots as it needs.
  Show the selected variant, hide the rest. Mirrors the existing ball-GLB pattern exactly.
- One file serves every table (pitch is a shared flat surface reparented per table). No
  per-table folders needed.

## Blender export contract (hand these rules to whoever authors the GLB)

File: `assets/pitches/fuzeball_pitch.glb` (new; sits beside the existing jpgs).

1. **One object per pitch variant**, named by pitch key, lowercase. To be a drop-in for
   the current theme selector, use the theme keys: `classic`, `neon`, `royal`, `verdant`.
   (glTF may append `.001` / mesh-index suffixes — the loader strips a trailing `[._]?\d+`
   exactly like `ballKey` in `models.js:127`, so `classic.001` still resolves to `classic`.)
2. **All variants overlapped at the origin.** The loader hides all but the active one.
3. **Flat, at the field surface `y=0`.** Match the current plane: long axis = **X**
   (goal-to-goal, length `F.L=120`), width = **Z** (`F.W=68`), lying in the X–Z plane
   (top face +Y). Centre at origin. Do NOT bake in the `-PI/2` rotation the primitive plane
   uses — author it already lying flat in world/game coords (same convention as the table
   build scripts in `tools/`). Keep it within the flat pitch area (see `config.js:63-66`
   note about the crease slope on the arena — stay ≤ `F.W` wide).
4. **UVs** laid out so the material/texture reads correctly across the whole surface.
5. **Materials**: standard PBR (glTF `MeshStandardMaterial`). Base-colour/emissive maps are
   sRGB; normal/roughness/metalness/ao maps are linear — the loader sets these encodings
   (copy `models.js:187-196`).
6. A very slight thickness is fine (avoids z-fighting with anything at exactly y=0), but keep
   the top face at y≈0 so ball/rod coordinates are unchanged. `receiveShadow` is forced on
   in code.
7. Provide an optional `tools/build_pitches.py` / `tools/export_pitches.py` pair following
   the existing `build_fuzeball_models.py` / `export_*` conventions if scripted authoring is
   wanted (nice-to-have, not required for the game to consume the GLB).

## Phase 1 — drop-in GLB pitches (theme-keyed, zero UI change)

This is the core work and the biggest win at lowest risk. Pitch stays keyed by `cfg.theme`;
no new selector. If the GLB (or a given variant mesh) is missing, the jpg fallback still runs.

### 1. `models.js` — new loader (model after `loadBallModel`)

Add globals near the top (with the other `let`s): `let pitchModel=null;` and
`const pitchMatMap={};` (unused for now but mirrors ball loader; safe to keep).

Add `loadPitchModel(onReady)`:
- `new THREE.GLTFLoader().load('assets/pitches/fuzeball_pitch.glb', …)`.
- On success: `pitchModel = gltf.scene`; `traverse` meshes, force `receiveShadow=true`
  (and `castShadow=false` — a pitch shouldn't cast), apply the same texture-encoding block
  as `loadBallModel` (`models.js:187-196`) to every material. Log which variant names were
  found (copy the ball loader's diagnostic log).
- On error / missing file: `console.warn('no pitch GLB, using image pitch')` and call
  `onReady` — the existing jpg path in `buildTable`/`drawField` stays authoritative.
- Always call `onReady` exactly once (guard like `loadBallModel`).

Add `pitchKey(o)` helper or reuse `ballKey` (same regex) to map mesh name → variant key.

### 2. `world.js` — build the GLB pitch group, switch in `drawField`

Add a module global: `let pitchGroup=null;` next to `fieldMesh` (`world.js:5`).

New function `applyPitchModel()` (call it once, after `loadPitchModel`'s `onReady`, and it
must be idempotent):
- If `!pitchModel` return (jpg fallback stays).
- If `pitchGroup` not yet built: `pitchGroup = pitchModel` (or a clone), add it as a child of
  whatever group currently owns `fieldMesh` (its `.parent`), positioned/oriented per the
  export contract (should be identity). Do NOT remove `fieldMesh` — instead hide it while a
  GLB variant is active (so we can fall back per-variant).

Rewrite `drawField()` (whole function) to prefer the GLB:
```
function drawField(){
 const key=cfg.theme;
 if(pitchModel&&pitchGroup){
  let shown=false;
  pitchGroup.traverse(c=>{if(c.isMesh){const on=pitchKey(c)===key;c.visible=on;if(on)shown=true;}});
  if(shown){if(fieldMesh)fieldMesh.visible=false;return;}   // GLB has this variant → use it
 }
 // fallback: flat plane + image map for this theme
 if(fieldMesh){fieldMesh.visible=true;const tex=fieldTexCache[key];
  if(tex){fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;}}
}
```
So: if the GLB exists AND contains the current theme's variant, show that mesh and hide the
flat plane; otherwise the plane + jpg renders as before. Per-variant fallback means a
partially-authored GLB (say only `classic` and `neon` modelled) still works — the missing
themes fall through to their jpgs automatically.

`applyTable()` in `arena.js:162` reparents `fieldMesh` between tables. The `pitchGroup` must
be reparented the same way (add it right beside the `fieldMesh` reparent line, and keep
`pitchGroup.visible` in sync). Then call `drawField()` at the end of `applyTable()` so the
correct variant is re-shown after a table switch.

### 3. `models.js` boot chain — load the pitch GLB

Wire `loadPitchModel` into the same boot sequence that calls `loadTableModel` /
`loadBallModel` (see `main.js` boot chain). It can load in parallel with the ball/table
GLBs; on its `onReady`, call `applyPitchModel()` then `drawField()`. Missing file must not
block boot.

### 4. Verification (sandbox is often down — see CLAUDE.md)

- If the Linux sandbox boots: concat `js/*.js` in `index.html` script order and run through
  Node `vm.runInNewContext` with browser globals stubbed to catch parse/scope errors
  (per CLAUDE.md). Watch for duplicate top-level `const`/`let` names (`pitchModel`,
  `pitchGroup`, `pitchMatMap`, `applyPitchModel` must be unique across all files).
- Re-read each rewritten function in full to confirm braces/scope.
- Manual (browser): with NO `fuzeball_pitch.glb` present, confirm the game looks identical
  to today (jpg fallback). Then drop in a GLB with just `classic` modelled: `classic` theme
  shows GLB geometry, the other three themes still show their jpgs. Switch themes and tables
  (classic ↔ arena) and confirm the pitch follows and the correct variant shows.

## Phase 2 — optional: decouple pitch from theme + per-table allow-list

Only if you want pitch selectable independently of the colour/lighting theme, and want
tables to restrict which pitches are offered (your "set of tables that defines which pitches
can be used" idea). Skip if theme-keyed pitches (Phase 1) are enough.

1. `config.js` — add a `pitches` registry, e.g.
   `pitches:{ grass1:{glb:'classic'}, cyatron:{glb:'neon'}, … }` (the `glb` field is the
   object name inside `fuzeball_pitch.glb`). Add a `pitch` key to each table def (or a
   `tablePitches` map) listing allowed pitch ids, e.g.
   `tables:{ classic:{pitches:['grass1','grass2','cyatron','verdantia']}, arena:{…} }`.
   Add `cfg.pitch` (persisted) with a sensible default; migrate old saves (default from
   `cfg.theme`, same style as the `diffRed/diffBlue` migration in `config.js`).
2. `drawField()` — key off `cfg.pitch` (resolve → GLB object name) instead of `cfg.theme`.
3. UI — add a Pitch `<select>` in Match Setup near `#setTable` (`ui.js:5,15` show the table
   select wiring to copy). On table change, repopulate the pitch options from that table's
   allow-list and clamp `cfg.pitch` if the current one isn't allowed.
4. Keep theme responsible ONLY for colours/lighting (`bg`, `wall`, `led`, line/field CSS
   colours); pitch geometry comes from `cfg.pitch`.

## Files touched (Phase 1)

- `assets/pitches/fuzeball_pitch.glb` — NEW (authored asset).
- `js/models.js` — `loadPitchModel`, `pitchModel`/`pitchMatMap` globals, `pitchKey` (or reuse
  `ballKey`), boot wiring.
- `js/world.js` — `pitchGroup` global, `applyPitchModel`, rewritten `drawField`.
- `js/arena.js` — reparent `pitchGroup` alongside `fieldMesh` in `applyTable`; call
  `drawField()` at its end.
- `js/main.js` — add `loadPitchModel` to the boot chain.
- (Phase 2 adds `js/config.js`, `js/ui.js`, `index.html`, `css/styles.css`.)

## Notes / gotchas

- Keep the flat plane + jpgs in place as the fallback — do not delete them. Per-variant
  fallback in `drawField` lets the GLB be authored incrementally.
- Pitch top face MUST stay at y≈0; physics/rod/ball coordinates assume the field surface is
  `y=0` (`F` geometry in CLAUDE.md). Don't offset it.
- `receiveShadow` on, `castShadow` off for pitch meshes.
- Texture encodings: sRGB for colour/emissive, linear for normal/rough/metal/ao (copy the
  block in `loadBallModel`).
- Unique global names across all `js/*.js` files or the shared scope throws.
- On the arena table the outer pitch rides a crease slope (`config.js:63-66`); keep the
  authored pitch ≤ `F.W` wide so it doesn't clip into the bowl wall.
