# PLAN — Arena Table (curved, Rocket-League-style)

Implementation plan for a **second table type** selectable in Match Setup: rounded-rectangle
walls in plan view, a curved crease (fillet) where wall meets floor so the ball rolls up and
down instead of banging off 90° corners, and smooth blends where the crease meets the goal
posts. Rod/player positions are unchanged. Deliverables: the in-game table (physics + visuals
+ UI) and a Blender script that generates the same model for texturing.

Read `CLAUDE.md` first. All conventions there apply — dense terse style, plain non-module
scripts, whole-function rewrites, every tunable in CONFIG, nothing that looks AI-generated.

---

## 0. Design summary (agreed with owner)

- **Selection:** new "Table" select in Match Setup (`Classic` / `Arena`), persisted as
  `cfg.table` in the `fuzeball` localStorage blob. Classic remains the default and its
  physics path must stay **byte-identical** (zero regression risk).
- **Curve intensity:** medium defaults (crease fillet ≈ 5u, plan-view corner radius ≈ 12u)
  but **fully parametric** — every radius/threshold in `CONFIG.tables.arena` so the owner
  can tweak-and-reload. This is a hard requirement.
- **Crease extent:** full perimeter — the fillet runs along side walls, end walls, corners,
  and sweeps around into the goal cavities. One continuous math model.
- **Physics answer:** yes, curved ramps are very tractable here. The approach below is a
  2D signed-distance field (SDF) for the boundary + an analytic fillet cross-section. It is
  cheap (a handful of flops per ball per substep), exact (no mesh collision), and slots into
  the existing adaptive-substep loop without touching its friction/energy invariants.

---

## 1. Single source of truth — `CONFIG.tables.arena`

Add to `js/config.js` (commented/spaced style — config.js is the one human-tuned file):

```js
/* ---- table types ------------------------------------------------------ */
// Classic uses CONFIG.table (flat walls, 90° creases) untouched. Arena is the
// curved Rocket-League-style bowl: rounded-rect walls + floor fillet. All
// radii are in table units; tweak and reload. Blender script mirrors these —
// keep tools/build_arena_table.py in sync (or run it with --from-config).
tables:{
 arena:{
  cornerR:12,        // plan-view corner radius of the rounded rectangle
  creaseR:5,         // floor↔wall fillet radius (how far the ball rides up). Keep ≤5.5:
                     // above that a ball hugging the wall sits too high for feet at max rod slide
  postR:3,           // smooth-union radius where the crease/walls blend into the goal mouth
  mouthIn:4,         // how far the goal cavity punches inward past the goal line (opens the mouth)
  bounceCut:6,       // normal-speed below which crease/wall contact rolls instead of bouncing
  fricNy:0.3,        // contact normal.y above this counts as 'grounded' → floor friction applies
  gradEps:0.02,      // central-difference step for the SDF gradient
  seg:{loop:200,profile:10} // visual mesh resolution: samples around the perimeter / up the profile
 }
},
```

`cfg` gains `table:'classic'` in the defaults literal (old saves auto-default via
`Object.assign`). Add alias at the bottom of config.js with the others:
`const ARENA=CONFIG.tables.arena;`.

Geometry reuse: `L, W, wallH, goalHalf, goalH, goalDepth` all come from the existing
`F=CONFIG.table` — the arena is the same table size, so rods, camera, serve, power-ups and
goal detection keep working untouched.

---

## 2. The math core — new file `js/arena.js`

New plain script, `'use strict'`, loaded **after `config.js`, before `world.js`** in
`index.html` (it defines globals used by world/physics/debug; it may reference `S`/`F`
inside function bodies — resolved at call time, so load order past config doesn't matter).

### 2.1 2D boundary SDF (plan view)

Interior = rounded rectangle ∪ two goal cavities, blended with a smooth union so the walls
meet the goal mouth with radius `postR` — this *is* the "meets the posts smoothly"
requirement, it falls out of the math for free.

```js
/* ===== arena table (curved walls) ===== */
function sdRRect(x,z,hx,hz,r){const qx=Math.abs(x)-hx+r,qz=Math.abs(z)-hz+r;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;}
function sdBox2(x,z,cx,cz,hx,hz){const qx=Math.abs(x-cx)-hx,qz=Math.abs(z-cz)-hz;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0);}
function smin(a,b,k){const h=clamp(.5+.5*(b-a)/k,0,1);return lerp(b,a,h)-k*h*(1-h);}
```

- `sdRRect(x,z,F.L/2,F.W/2,ARENA.cornerR)` — the field bowl. Negative inside.
- Goal cavities (one per end, `s=±1`): axis-aligned box spanning
  `x ∈ [s*(F.L/2 - mouthIn), s*(F.L/2 + F.goalDepth)]`, `z ∈ [-gh, gh]` where `gh` is that
  end's **effective** goal half-width (big-goal power-up aware, see §3.4).
- Combined: `arenaSD(x,z,gh0,gh1) = smin(smin(rect, goalR, postR), goalL, postR)`.
  (gh index convention: cavity at **+x** widens for `S.eff[0].big`, **−x** for `S.eff[1].big`
  — same mapping as the existing code in `stepBall`, don't get this backwards.)
- **Height gate:** the cavities only exist below the crossbar. The full SDF is
  `sd = (y < F.goalH) ? arenaSD(...) : sdRRect(...)`. Above `goalH` the mouth is a solid
  wall, mirroring classic's behaviour (ball off the invisible wall above the mouth).

Gradient `arenaGrad(x,z,...)` by central differences with `ARENA.gradEps` (4 extra SDF
evals). Normalize; it points **outward** (toward/into the wall).

Note: `smin` is an underestimating distance near blends. That's fine for collision (games do
this everywhere) — resolution converges because we re-evaluate every substep; if visible
sinking ever shows at the posts, resolve twice per contact (loop the push+re-eval once).

### 2.2 The fillet cross-section (this is the whole trick)

Because the horizontal direction to the nearest wall is just the SDF gradient, the wall +
crease is the **same 2D cross-section problem everywhere on the perimeter** — straights,
corners, and goal blends all share it:

Let `d = -sd` (horizontal distance from ball centre to the wall surface, positive inside)
and `CR = ARENA.creaseR`. In the cross-section plane (axis `s` = horizontal distance from
wall, axis `y` = up), the crease surface is a quarter circle of radius `CR` centred at
`A = (s=CR, y=CR)`. Three regimes for a ball at `(s=d, y=p.y)`:

1. **Flat floor** — `d ≥ CR`: floor is flat at y=0. Existing floor bounce applies, unchanged.
2. **Fillet** — `d < CR` and `p.y < CR`: let `u = CR−d`, `w = CR−p.y`, `r = hypot(u,w)`.
   Contact when `r > CR − BALL_R`. Unit contact normal (pointing back into the air, i.e.
   toward `A`): horizontal part `−g·(u/r)` (where `g` = outward SDF gradient), vertical part
   `+w/r`. Penetration `pen = r − (CR − BALL_R)`; push the ball `pen` along the normal.
3. **Vertical wall** — `p.y ≥ CR` and `p.y < F.wallH + BALL_R`: contact when `d < BALL_R`;
   normal = `−g`, penetration `BALL_R − d`. (Above the wall: nothing — ball can still fly
   out; existing `outOfBounds` catches it.)

These three regimes are **C¹-continuous by construction**: a ball resting on the flat floor
(`y=BALL_R`) at `d=CR` sits exactly on the fillet contact circle (`r = CR−BALL_R`), and the
fillet at `w=0` degenerates exactly to the wall case. No seams, no jitter at handoffs.

### 2.3 Contact response — roll vs bounce

Shared response for fillet + wall contacts, given unit inward normal `n` and `pen`:

```js
p += n*pen;
const vn=v.x*n.x+v.y*n.y+v.z*n.z;
if(vn<0){
 if(-vn>ARENA.bounceCut){v-= (1+PHY.wallRest)*vn*n; Au.wall(-vn);} // real bounce
 else v-=vn*n;                                                    // slow contact: kill normal vel → ball ROLLS
 if(n.y>ARENA.fricNy){const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;} // grounded on the ramp → floor friction
}
```

The `bounceCut` branch is what makes "rolls up and down" work: without it, a ball easing
onto the ramp micro-bounces forever (same reason `floorRestCut` exists). With it, slow
contact is inelastic and gravity does the rest — the ball climbs, stalls, and rolls back
down naturally. Fast shots still bang off with `wallRest` like a wall should.

Energy note: the reflection only ever *removes* normal velocity (restitution < 1) and the
push-out is positional — nothing here can add energy, so it's as stable as the existing
wall code. Don't be tempted to add spring forces.

### 2.4 Spawn clamp helper

```js
function arenaClampSpawn(p){ /* if arena active: Newton-project p inward until sd < -(BALL_R+2); 3 iters of p -= g*(sd+BALL_R+2) */ }
```

Used by `redropBall`, `serve`, and `spawnPU` (§3.5) so nothing ever spawns inside a curve.
With current spawn boxes (`|z|≤22`, zones at x=±30) this never triggers at medium radii —
it's insurance for when the owner cranks `cornerR`/`creaseR` up.

### 2.5 Active flag

```js
let ARENA_ON=false;
function applyTable(){ARENA_ON=cfg.table==='arena'; /* + toggle visual groups, §5.4 */}
```

Physics/debug/world read the boolean, not the string. Call `applyTable()` once at init and
whenever the Match Setup select changes.

---

## 3. Physics integration — `js/physics.js`

Rewrite `stepBall` **whole** (owner rule) with an arena branch. The classic path must come
out character-for-character identical in behaviour. Structure of the new middle section
(floor / walls / goals), replacing lines between the spin block and the rod loop:

```
if(!ARENA_ON){ ...existing floor + side-wall + end-wall/goal blocks verbatim... }
else {
  // effective goal halves (same power-up mapping as classic):
  gh0 = F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1)   // +x cavity
  gh1 = F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1)   // −x cavity
  if(b.scored){ ...existing in-net clamps verbatim (behindDamp/behindZ)... }
  else {
    sd = (p.y<F.goalH) ? arenaSD(p.x,p.z,gh0,gh1) : sdRRect(...)
    d  = -sd
    if(d>=ARENA.creaseR){ if(p.y<BALL_R){ ...existing flat-floor bounce+friction... } else airFric }
    else if(p.y<ARENA.creaseR){ fillet test (§2.2 case 2) → response (§2.3); else airFric }
    else if(p.y<F.wallH+BALL_R && d<BALL_R){ wall resolve (§2.2 case 3) → response }
    else airFric
    // goal detection: keep classic's checks UNCHANGED —
    // p.x>F.L/2+1.2 && |p.z|<gh0 && p.y<F.goalH → onGoal(0,b); mirrored for −x.
    // The SDF never blocks the mouth, so the ball reaches the goal line exactly as before.
  }
}
```

Details that matter:

1. **Friction invariant.** Exactly one of {floor friction, air friction} must apply per
   substep, as `exp(-k*h)`, same as classic — the substep-count invariance rule in CLAUDE.md
   depends on it. The fillet-contact friction in §2.3 *replaces* (not stacks with) that
   substep's air friction. Audit the branch structure for double application.
2. **Scored balls** skip all arena boundary resolution — the existing net clamps own them
   (avoids double-handling inside the cavity).
3. **Tunneling:** no new risk. Adaptive substepping already caps travel at `subTravel=1.1u`
   per substep; the thinnest feature (fillet, radius 5) is far thicker than that. Nothing
   to change in `physics()`.
4. **Big-goal power-up** is physically correct for free: the cavity boxes take `gh0/gh1`, so
   the mouth *and its smooth post blends* widen while active. Verify the sign mapping
   against classic (right/+x goal widens for `S.eff[0]` — team 0 scores there).
5. **NaN guard, spin/Magnus, maxV clamp, rod loop, out-of-bounds** — untouched.
6. **AI note (accepted for v1):** a ball riding the fillet above `CONFIG.ai.lowY` (2) won't
   be swung at; it rolls back down within reach. If play-testing shows AI passivity against
   wall-riders, bump `lowY` for arena matches later — do NOT change AI in this task.

`syncBall` rule from CLAUDE.md still applies to anything new that hard-sets positions
(the spawn clamp in `redropBall`/`serve` runs before their existing `syncBall` calls — keep
that ordering).

---

## 4. World visuals — `js/world.js`

### 4.1 Procedural arena mesh (default, always works)

Build the visible bowl **from the same SDF** so visuals and physics can never disagree.
New `buildArenaTable()` → group `arenaTable` (module-level, next to `primTable`):

Swept-grid algorithm:

1. **Profile** (cross-section, `seg.profile`+1 rows): row j maps to an inset/height pair —
   fillet rows `θ = j/n·π/2` → `inset = CR−CR·sin θ`, `y = CR−CR·cos θ`; then wall rows at
   `inset 0`, `y` from `CR` to `F.wallH`; finish with a small outward top lip (purely
   cosmetic).
2. **Perimeter loop** (`seg.loop` samples): parameterize the *classic* outline (rectangle +
   two goal boxes as a closed polyline — trivial to walk with even arc length), then for
   each sample and each profile row, Newton-project onto the iso-contour `sd = −inset_j`:
   `p -= ĝ·(sd(p)+inset_j)`, 3 iterations. `postR>0` keeps the contour smooth, so ordered
   samples stay ordered — no self-intersection.
3. Emit a `THREE.BufferGeometry` quad grid (loop × profile), computed normals, UVs
   `u = perimeter fraction, v = profile fraction`. Material: the existing `wallMat` (themes
   keep working — `applyTheme` already recolours it).
4. Keep the flat `fieldMesh` pitch plane exactly as is (carries the theme texture); the
   fillet base lands on y=0 at inset `creaseR` and reads as the pitch curling up. Keep the
   existing table body/legs (reuse the classic ones inside `arenaTable` or share them).
5. **LED strip:** optional polish — a thin emissive tube (`ledMat`) following the top-lip
   contour ring instead of the two straight strips. Nice hand-crafted touch for cheap since
   the contour points already exist. If skipped, reuse the straight strips.
6. **Goal frames:** keep the existing `goalFrames` groups (posts/bar/net/lights) — they sit
   inside the cavity mouth and the smooth wall blend runs behind them. Optional polish:
   cylinder posts instead of boxes on the arena so the blend reads "smooth into the posts".
   `fx.js` big-goal frame scaling keeps working untouched.

### 4.2 Table switching

`buildTable()` (classic) unchanged. `initThree` builds both groups once;
`applyTable()` toggles `primTable.visible` / `arenaTable.visible` (and their GLB
replacements, §6). Cheap, instant, no rebuild needed when the player flips the select in
the menu.

---

## 5. UI — Match Setup select

- `index.html`: a "TABLE" row in the Match Setup panel next to Theme:
  `#setTable` with options `classic` → "CLASSIC", `arena` → "ARENA". Copy the exact markup
  pattern of the theme select (label styling, classes) so it looks native.
- `js/ui.js`: wire like the theme select — read/write `cfg.table`, `saveCfg()`, call
  `applyTable()` on change. Initialize the select from `cfg.table` on menu open.
- No CSS beyond reusing existing classes unless the row needs the standard label treatment.

---

## 6. GLB pipeline — `js/models.js`

Mirror the existing table pattern: rewrite `loadTableModel()` (whole function) to load
**per table type** — classic keeps `assets/fuzeball_table.glb`; arena tries
`assets/fuzeball_table_arena.glb`. Same hookup contract (object-name matching via `onm`):
`field*` hidden (primitive pitch keeps the theme texture), `led*` → repoint `ledMat`,
`goal_net*` → sorted by world-x into `netMats` (left=red, right=blue). On success hide that
type's procedural group only; on failure the procedural bowl stays — identical fallback
philosophy to today. Loaded GLBs respect `applyTable()` visibility toggling (keep a
reference per type).

---

## 7. Blender script — `tools/build_arena_table.py`

Purpose: generate the **same** arena table as a `.blend` + exported
`assets/fuzeball_table_arena.glb` so the owner can texture it. Blender 4.x `bpy`, runnable
headless: `blender -b -P tools/build_arena_table.py`.

1. **Parameters block at top of file** mirroring `CONFIG.table` + `CONFIG.tables.arena`
   (L, W, wallH, goalHalf, goalH, goalDepth, cornerR, creaseR, postR, mouthIn, seg counts,
   plus body/leg dimensions from `buildTable`: body box `L+10 × 10 × W+10` at y −5.2, legs
   4×34×4 at `(±(L/2−2), −27, ±(W/2−2))`). Add an optional `--from-config path/to/config.js`
   mode that regex-extracts the numbers so the script can't drift from the game.
2. **Port the exact math**: `sdRRect`, `sdBox2`, `smin`, the union, the profile table, and
   the Newton contour projection from §2/§4.1 in pure Python (no numpy needed). Build the
   swept grid with `bmesh` — vertex-identical to the in-game mesh, guaranteeing
   physics/visual/texture parity.
3. **Objects & names** (must satisfy the `models.js` name contract, lowercase-startswith):
   `arena_wall` (the swept bowl), `field` (flat floor plane with the two mouth notches —
   hidden in game but needed for Blender texturing/renders), `led` (top-lip contour tube),
   `goal_net_left` / `goal_net_right` (thin boxes in the cavities), `goal_frame_l/r`
   (cylinder posts + crossbar), `body`, `leg_1..4`.
4. **UVs**: set programmatically on the bowl — `u` = perimeter arc-length fraction
   (report total perimeter in the console so texel density can be computed), `v` = profile
   arc-length fraction. Mark one vertical seam. Everything else: cube-project or smart-UV.
5. **Materials**: slots `wall`, `crease` (separate slot on the fillet rows so the owner can
   texture the ramp differently), `led` (emissive), `goal_net` (per side), `field`, `frame`,
   `wood` (body/legs). Placeholder principled materials; the owner textures them.
6. **Export**: apply all transforms, `+Y up` glTF export (Blender's exporter default —
   verify orientation by loading in-game next to the procedural mesh and comparing; the
   existing `fuzeball_table.glb` proves the pipeline). Save `fuzeball_table_arena.blend`
   beside it. 1 Blender unit = 1 table unit.

---

## 8. Debug overlay — `js/debug.js`

When `ARENA_ON`, the classic red wall boxes lie about the geometry. Add to `buildDebug`:

- **Arena walls layer**: a wireframe copy of the swept-grid mesh (reuse the §4.1 generator
  at low res) in the standard debug red, 25% opacity, in `dbgGroup`, shown instead of the
  flat wall proxies when arena is active.
- **Contour ring**: per ball, a line loop at the iso-contour `sd = −BALL_R` at the ball's
  current height regime — shows exactly where contact will trigger. Update in
  `debugUpdate()` alongside the ball spheres.
- Ball speed readout etc. untouched.

---

## 9. Testing & verification checklist

Syntax first (CLAUDE.md): concatenate `js/*.js` in `index.html` load order and run through
Node `vm.runInNewContext` with browser globals stubbed. Then in-browser (or by careful
re-reads if no browser available):

1. **Classic regression**: with `cfg.table='classic'`, play a match — behaviour identical
   (the classic physics path is verbatim; verify by diff-reading `stepBall`).
2. **Roll, don't bounce**: nudge a slow ball into a side wall → it rides up the crease and
   rolls back with no micro-bounce chatter (bounceCut path). Same in a corner.
3. **Corner sweep**: hard shot into a corner curves around it smoothly; fire the fastest
   ball (fire, maxV 240) repeatedly — no tunneling, no NaN redrops.
4. **Goal funnel**: shots along the end wall funnel around the post blend into the mouth;
   goals register on BOTH ends with correct team credit (red scores in the +x/right goal —
   check the mapping, CLAUDE.md flags it as easy to flip).
5. **Above the mouth**: ball at y>goalH against the mouth bounces back (height gate).
6. **Big-goal power-up**: mouth visibly and physically wider on the correct end; post
   blends move with it.
7. **Rest state**: leave a ball on the fillet mid-ramp → settles and rolls down; at the
   fillet/floor seam → no vibration (C¹ handoff).
8. **Dead-ball & spawns**: redrops/serves/power-ups always land inside the boundary
   (crank `cornerR` to 20 temporarily to prove the clamp).
9. **Multi-ball**: split ball near a curved wall behaves; ball-ball collisions on the ramp
   don't push a ball through the wall (push-out re-resolves next substep).
10. **Switching**: flip Classic↔Arena in the menu repeatedly — visuals toggle cleanly, no
    orphaned meshes, cfg persists across reload.
11. **Tweakability**: change `creaseR` to 3 and 8, reload — both play sanely (8 will feel
    dramatic; that's expected and fine).
12. **Perf**: fps unchanged (SDF cost is ~30 flops × ≤14 substeps × ≤3 balls at 120 Hz —
    noise). Check the debug overlay off *and* on.
13. **Blender**: run the script headless, load the GLB in-game over the procedural mesh —
    silhouettes must match; name contract picks up led/nets.

---

## 10. File-by-file change list

| File | Change |
|---|---|
| `js/config.js` | `CONFIG.tables.arena` block; `cfg.table:'classic'` default; `ARENA` alias |
| `js/arena.js` | **NEW** — SDF + gradient, fillet math, contact response, `arenaClampSpawn`, `ARENA_ON`/`applyTable`, contour-mesh generator (shared with world+debug) |
| `index.html` | `<script src="js/arena.js">` after config.js; Table select row in Match Setup |
| `js/physics.js` | `stepBall` rewritten whole: `ARENA_ON` branch per §3, classic path verbatim |
| `js/world.js` | `buildArenaTable()`; both groups built in `initThree`; visibility via `applyTable` |
| `js/models.js` | `loadTableModel()` rewritten whole: per-type GLB (`fuzeball_table_arena.glb`) |
| `js/ui.js` | wire `#setTable` ↔ `cfg.table`, `saveCfg`, `applyTable` |
| `js/powerups.js` | `redropBall` + `spawnPU`: `arenaClampSpawn` before `syncBall` |
| `js/flow.js` | `serve`: `arenaClampSpawn` before `syncBall` |
| `js/debug.js` | arena wireframe layer + contact contour ring |
| `css/styles.css` | only if the new select row needs the standard label class |
| `tools/build_arena_table.py` | **NEW** — Blender generator + GLB export per §7 |

## 11. Non-goals (v1)

- No AI changes (lowY / wall-rider tuning deferred; noted in §3.6).
- No ceiling / enclosed arena (serve + redrop fall from above; out-of-bounds stays).
- No crossbar-lip rounding above the mouth (hard height gate matches classic semantics).
- No league integration work needed — the table type is orthogonal to teams/stats.

## 12. Style guard (Steam ambition)

Match the house style exactly: short names, packed statements, `/* ===== arena ===== */`
banners, comments only where the *why* isn't obvious (the fillet handoff and the friction
invariant deserve one line each; nothing else does). config.js entries get the spaced,
commented treatment. If a diff would look like generated boilerplate, rewrite it tighter.
