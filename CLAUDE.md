# CLAUDE.md — Fuzeball

Context for working on this project in a fresh session. Read this first.

## What it is

**Fuzeball** is a 3D foosball (table football) game. No build step, no package manager,
no local dependencies. It pulls **Three.js r128** and Google Fonts from CDNs at runtime;
all game code is local.

- **Entry point:** `index.html` — markup + `<link>` to `css/styles.css` + ordered
  `<script>` tags for the `js/` modules. Open it in any modern browser (WebGL required).
- **`fuzeball.html`** is the ORIGINAL monolith, kept untouched as a backup/reference.
  It still runs on its own. Delete it once you're happy with the split.
- **Config persistence:** in-menu settings save to `localStorage` under the key `fuzeball`.
- **Ambition:** this may go to **Steam** if it's fun. It must feel performative and
  hand-crafted — *do not let it look AI-generated*. Keep the existing dense, terse code
  style; avoid generic boilerplate and over-commenting.

### File map (`js/`, loaded in this order — see the script tags in `index.html`)

`core.js` (helpers `$`,`clamp`,`lerp`,`rand`) · **`config.js`** (see below) · `audio.js`
(`Au`) · `state.js` (`S`,`freshStats`,`HYPE`) · `world.js` (three.js init/build/theme) ·
`balls.js` · `rods.js` · `physics.js` · `ai.js` · `input.js` · `powerups.js` (+ dead-ball) ·
`flow.js` (match flow) · `fx.js` (FX + camera) · `hud.js` · `ui.js` · `league.js` · `customize.js` · `models.js` · `fracture.js` · `debug.js` · `main.js`.

These are **plain (non-module) scripts** sharing one global scope on purpose — top-level
`const`/`let` in one file are visible in later files. This is what lets them work from
`file://`, http(s), and an Electron/Steam wrapper alike. Do NOT convert to ES modules
(`import`/`export`): that breaks `file://` double-click via CORS. Keep names unique across
files (a duplicate top-level `const` throws).

### `config.js` — the tuning knobs

**All impactful gameplay parameters live in the `CONFIG` object in `js/config.js`.** To
adjust the game (physics feel, difficulty, kick power, ball types, AI, timers, camera,
power-ups, themes, etc.) edit CONFIG and reload — nothing else hard-codes these numbers.
The old named constants (`F`, `BALL_R`, `DIFFS`, `BALL_TYPES`, `THEMES`, …) still exist as
thin aliases derived from CONFIG at the bottom of the file; don't edit the aliases, edit
CONFIG. `cfg`/`saveCfg` (the persisted in-menu settings) also live here.

## How to work in this project (conventions)

- Very dense style, `'use strict'` per file: short names, multiple statements per line,
  packed semicolons. **Match this style** — new code should be indistinguishable.
  (Exception: `config.js` is meant to be human-tuned, so it's commented and spaced out.)
- Global helpers: `$` = `getElementById`, plus `clamp(v,a,b)`, `lerp(a,b,t)`, `rand(a,b)`.
- Sections are marked with `/* ===== name ===== */` banners. Navigate by file + those +
  function name rather than line numbers (they drift).
- **When updating a function, rewrite the WHOLE function** (owner preference), then
  re-read it in context to confirm braces/scope.
- **New tunable numbers go in CONFIG**, not inline — that's the whole point of the split.
- Keep replies concise and direct (owner preference).

### Verifying changes
- A live browser session may not be available (the Linux sandbox sometimes fails to boot).
  When it isn't, verify by careful re-reading of each edited function.
- When the sandbox IS up, concatenate `js/*.js` in load order and run through Node's
  `vm.runInNewContext` with browser globals stubbed to catch syntax/parse errors.

## Coordinate system & table geometry

- **X** = long axis (goal to goal). **Z** = width. **Y** = up. Field surface at `y=0`.
- `F = {L:120, W:68, wallH:8, goalHalf:11, goalH:8.5, goalDepth:9}`.
- Goals sit at `x = ±60` (±L/2). **Left goal net is red, right goal net is blue.**
- Ball into the **right** goal → **team 0 (red) scores**; into the **left** goal →
  **team 1 (blue) scores**. (Easy to get backwards — double-check when touching scoring.)
- Key constants: `BALL_R=1.6`, `ROD_H=7.50` (rod pivot height), `ARM=6.30` (collision arm
  length, pivot→foot), `PRAD=1.0` (player collision radius), `GRAV=280`.
  `FOOT_T=0.99` (foot position along arm, 1=foot). Foot collision is an **oriented box**
  (`CONFIG.physics.footBox` half-extents, `footBoxOff` centre offset from foot-base in
  rod-local space); debug wireframe confirms placement.

## Teams & rods

- **Team 0 = red**, attacks toward +x (right goal). **Team 1 = blue**, attacks toward −x.
- User's handles render on the +z (near-camera) side of their team's rods.
- `RODDEFS` — 8 rods, spacing 15, realistic **1-2-5-3** per side:

  | x | team | men | role |
  |----|------|-----|------|
  | −52.5 | red | 1 | GK |
  | −37.5 | red | 2 | DEF |
  | −22.5 | blue | 3 | ATT |
  | −7.5 | red | 5 | MID |
  | +7.5 | blue | 5 | MID |
  | +22.5 | red | 3 | ATT |
  | +37.5 | blue | 2 | DEF |
  | +52.5 | blue | 1 | GK |

- Each side totals 11 men (GK1 + DEF2 + MID5 + ATT3). `buildRods` derives per-man spacing
  and `maxOff` (slide range) from `men`; the 1-man goalie is centered with full slide range.
- A **rod object** holds: `pivot` (Three.Group; `position.z`=slide offset, `rotation.z`=angle),
  `men[]`, `baseZ[]`, `maxOff`, `offset`/`target`, `angle`/`angVel`, `vz`,
  `kickT` (−1 = idle, ≥0 = mid kick-swing animation), `raise`, `cd` (kick cooldown),
  and `ai*` smoothing fields.
- **The user controls one rod at a time** (`S.ctrlRods[S.ctrl]`). The user's *other* rods
  are AI-controlled — this is intended (they auto-defend while you focus one rod).

## Ball types (`BALL_TYPES`)

`classic`, `fire` (fast, light, glows), `cannon` (heavy, mass 2.4, slow), `golden`
(`value:2` — counts double), `split` (splits into a second ball on a hard hit). Each has
`maxV`, `mass`, a spawn `w`eight, and trail color. `pickType()` does weighted-random when
`cfg.special` is on. A **ball object** = `{m, v, t, key, scored, didSplit, trailT, light,
spin, stuckT}`.

## Physics (the core — treat carefully)

- `physics(dt)` runs **adaptive substeps** (5–14, scaled by fastest ball speed) so fast/
  heavy balls can't tunnel. Floor/air friction is applied per-substep as `exp(k*h)`, so
  total `exp(k*dt)` is **invariant to substep count — preserve this** if you change stepping.
- `stepBall(b,h)`: NaN/Infinity guard (re-drops the ball if state goes non-finite),
  **spin/Magnus curve** (rotates the *horizontal* velocity by a small angle — this is a
  pure rotation, adds no energy, so it's stable; **don't** convert it to an additive force),
  gravity, floor bounce, side-wall bounce, goal/out-of-bounds detection, then per-type
  `maxV` clamp.
- `collideRod(b,r)`: two collision shapes per man, resolved in priority order:
  1. **Foot box** (priority): oriented box at `FOOT_T` along the arm, half-extents from
     `footBox`, centre offset `footBoxOff` (team-relative via `r.kickDir`). Ball < `BALL_R`
     from box surface triggers the kick response.
  2. **Rod capsule** (fallback): line segment from pivot to foot, radius `BALL_R+PRAD`.
     Only runs for men the foot box didn't already handle — avoids double-resolution.
  Both passes: restitution **0.32** normally, **0.46** during the kick power window for
  meatier strikes. Sliding into the ball imparts side-spin. Split-ball spawn lives in both.
  A tiny `footJitter` velocity perturbation (configurable) prevents pixel-perfect
  side-to-side oscillations between adjacent men on the same rod.``
- `ballBall(a,b)`: mass-weighted elastic collision, restitution 0.9.
- Big-goal power-up: `S.eff[0].big` widens the **right** goal (`goalFrames[1]`);
  `S.eff[1].big` widens the **left** (`goalFrames[0]`).

## AI (`aiUpdate`)

Runs for every rod where `isUserRod(r)` is false **and** the rod is in its team's active
pair (see "Two hands" below). Per active rod: pick nearest ball, smooth its position/velocity
(reaction lag from `DIFFS.react`), slide `target` so the closest man lines up with the ball's
Z (with prediction + a wandering error term), then decide to kick.

- **Kick when the ball is actually reachable:** directly under the men (`overFoot`, |Δx|<4)
   **or** ahead within a forward swing (`inFront`, 0.1–7.0) **and** the nearest man is aligned
   in Z **and** the ball is low. It's extra-eager (looser alignment, shorter cooldown) on
   **slow balls** so it breaks up dead balls. Uses the ball's *real* position for reach.
- **Raise (lift men):** purely distance-based — rods raise when the ball is behind them
   past `raiseBehind` (currently −4.0, direction-relative). No velocity guard. This ensures
   defenders lift for slow/stationary balls behind them (e.g. goalie collecting).
- **Swing-return guard (`underFootBack`/`underFootFront`):** during the kick animation's
   drop phase, if any ball is within this asymmetric zone (default 3.5 behind, 1.5 ahead of
   the rod), the rod stays at the strike angle instead of returning to rest — prevents the
   returning feet from swiping the ball backward and scoring own goals. `rods.js:20-21`.
- `DIFFS` = `rookie` / `pro` / `legend` tune `speed, react, err, pred, cd`. (`range` is a
  legacy field, no longer used by the kick logic.)
- **Per-team difficulty** (`cfg.diffRed`, `cfg.diffBlue`): `aiUpdate` picks `D` per rod from
  `r.team` (red uses `Dred`, blue uses `Dblue`); `rods.js` does the same for AI rod slide
  speed. The legacy single `cfg.diff` is migrated into both per-team fields on load and kept
  as a fallback / shorthand for "red's difficulty". UI lives in `index.html` as two team-
  coloured rows in the Match Setup panel (`#setDiffRed`, `#setDiffBlue`). Lets you, e.g.,
  set red=Rookie and blue=Legend to spectate a fish-vs-shark.

### Two hands per team (`pickActiveRods`) — CONFIG.ai.hands (=2)

A team may only **actively move `hands` rods at once** (2 = two human hands). `pickActiveRods`
picks that pair each frame and stores it in `S.active[team]` (array of rod objects);
`isActiveRod(r)` tests membership. The pair = the team's rods **nearest the live threat in x**,
where the threat (`focusBall`) is the ball nearest that team's **own** goal — so the pair
drifts from keeper+def when pinned back to mid+att when pushing up, i.e. it plays like a
coordinated unit for free. A **commit timer** (`S.pairCd[team]`, reset to `pairCommit`≈0.4s)
stops the pair flickering; it recomputes early only when the set goes invalid (e.g. the user
switches rod). **The user's controlled rod is always forced into their team's pair** — it's
the hand they're holding; the AI plays the other. **Rods not in the pair HOLD** their lane
(target frozen, men down) and block passively — this is both the design and a big chunk of the
anti-jitter win. For 4-player later, just raise `hands` (→4 lifts the cap so every rod is live).

### Anti-jitter (why AI movement isn't twitchy)

Three levers, all tuned in `CONFIG.ai`:
- **Man-index hysteresis** (`manHyst`): the rod keeps aiming with its current man (`r.aiMan`)
  unless another beats it by `manHyst` z-units. Stops the target snapping a man-width when the
  ball sits between two men — the old #1 twitch source.
- **Retarget deadzone** (`retargetDead`): `target` only updates when the desired slide moved
  by more than this, so it isn't re-aimed every frame.
- **Drifting wander** (`errLerp`): the aim error (`r.aiErr`) lerps toward a fresh target
  (`r.aiErrTarget`, rolled every `errEvery`) instead of stepping.
- Plus **accel-capped slide** in `updateRods` (`slideAccel`, u/s²): AI rods can't reverse
  direction instantly (`r.slideV` is acceleration-limited). The **user rod stays instant** —
  its branch keeps the old speed-capped snap so control feels responsive.

## Dead-ball handling

- `redropBall(b)` relocates the ball to a **fresh random spot** (never clamps to its stuck
  x — doing that just re-lands it in the same dead zone).
- `deadBallUpdate`: global stall (all balls quiet) re-drops after **2.6s**; a single wedged
  ball (multi-ball play) re-drops after **2.2s**.

## Other systems

- **Input:** ←/→ or Q/E switch rod; ↑/↓ or mouse slide; Space/click kick; Shift/right-click
  raise; 1–4 select rod; V cycle camera; Esc pause; mouse wheel switch rod. Wired in the
  `input` section + `userControlUpdate` (which also does auto rod-switch when `cfg.auto`).
  Gamepad (`gamepadUpdate`): left stick slide, A/RT kick, X/LT raise, right-stick absolute rod
  angle, LB/RB switch rod; the optional 'Total Control' mode (Options → Controller) remaps the
  triggers to analog slide-speed and puts a swerve line on the free right-stick axis (see
  changelog 2026-07-18).
- **Power-ups (`PU_TYPES`):** `boost` (1.5x hit impulse off the collecting team's rods),
  `freeze` (slow rival rod movement to 20%), `big` (wider goal by 1.45x).
  Applied to `S.eff[team]` as expiry timestamps vs `S.time`. `spawnPU`/`collectPU`/`powerupUpdate`.
  Boost applies in `collideRod` (`physics.js`); freeze applies in `rodSpeedMult` (`rods.js`);
  big applies in `stepBall` goal detection (`physics.js`) and goal-frame scaling (`fx.js`).
- **Camera (`cameraUpdate`):** 3 modes — broadcast, top-down, low — with ball-follow lerp
  and screen shake (`S.shake`).
- **FX:** `flash`, `banner`, trails (`spawnTrail`), particle `burst`/`hitSparks`/`goalFx`,
  `confetti`, driven by `fxUpdate`. Pools are pre-allocated in `buildFxPools`.
- **Audio (`Au`):** fully synthesized via WebAudio (crowd bed, kicks, wall taps, goal
  sting, whistle, power-up, UI). No audio files.
- **HUD:** `updateScoreUI`, `updateChips` (rod selector), `hudTick` (clock + active-effect
  chips). Menus: main menu, pause, win screen (with possession/kicks/top-speed stats).

## Game state (`S`) & flow

- `S.phase`: `'menu' | 'count' | 'play' | 'goal' | 'pause' | 'win'`.
- `S.mode`: `'red' | 'blue' | 'ai'`; `S.userTeam`: `0 | 1 | -1` (−1 = AI-vs-AI spectate).
- Also: `score[2]`, `balls[]`, `ctrl`/`ctrlRods[]`, `active[2]` (each team's live rod pair) /
  `pairCd[2]` (pair commit timers), `eff[2]{boost,frozen,big}`, `lastTouch`, `stats`, `pu`,
  `shake`, `camMode`, `timeScale` (slow-mo on goals).
- Flow: `startMatch` → `startCount` → `serve` → `play`; `onGoal`/`outOfBounds` → brief
  `goal` phase → re-count; `endMatch` on reaching `cfg.goals`. `loop(t)` caps `rdt` at .05.
- **Fixed-timestep + render interpolation** (`main.js`): the sim (input/AI/rods/physics)
  only advances in constant `1/CONFIG.sim.hz`-second slices banked in a `physAcc`
  accumulator (`S.timeScale` feeds it slower for slow-mo; `sim.maxSteps` caps a frame to
  avoid a spiral of death). The renderer draws each ball at `lerpVectors(b.prev,b.cur,alpha)`
  and each rod at `lerp(iPrev,i,alpha)` where `alpha=physAcc/FIXED` — so motion is smooth at
  any refresh and physics is frame-rate-independent. `b.cur`/`b.prev` are the true sim
  positions; `b.m.position` is overwritten with the *display* (interpolated) value each frame,
  so the loop restores it from `b.cur` before stepping. **Any hard set of `b.m.position`
  outside physics must call `syncBall(b)`** (serve, redrop, split, NaN-redrop already do) or
  the next step teleports the ball back.
- `cfg` (persisted): `diffRed, diffBlue, diff` (legacy/fallback), `goals, theme, special, power,
  auto, sound, redName, blueName, redColor, blueColor, modelRed, modelBlue, redYaw, blueYaw,
  metalness, roughness, glow, modelScale`. Themes: `classic` / `neon` / `royal`. On load,
  missing `diffRed` / `diffBlue` are filled from the legacy `diff` (default `'pro'`); `diff`
  is then reset to `diffRed` to keep it meaningful as a "red's level" shorthand.

## Current state / recent work

Recently completed: adaptive substepping + anti-tunneling; energy-conserving spin/curve;
meatier kicks (0.46 restitution in the power window); NaN guard; per-ball stuck recovery;
goalie reduced 3→1 (1-2-5-3 layout); AI rewritten to swing at any reachable ball and keep
men down to block; `redropBall` relocates; shorter dead-ball timers; `ARM` 8.4→9.0 to close
the mid-gap reach; **two-hands rule** (`pickActiveRods` — only 2 rods/team move at once, the
rest hold & block, user's rod always one of the two); **AI anti-jitter** (man-index hysteresis,
retarget deadzone, drifting wander, accel-capped slide — all in `CONFIG.ai`); **fixed-timestep
sim + render interpolation** (`CONFIG.sim`, `physAcc`, `syncBall`, per-ball `prev`/`cur`) so
ball/rod motion is smooth at any frame rate and physics no longer varies with fps.
**Foot collision box** (`CONFIG.physics.footBox` / `footBoxOff` / `footT`, aliased as
`FOOT_BOX` / `FOOT_BOX_OFF` / `FOOT_T`): an oriented box collider per man at the base
of the capsule, with the same kick response (restitution, grip, spin, power-up modifiers).
Takes priority over the rod capsule when both collide (avoids double-resolution).
Half-extents: `{x=along leg, y=perpendicular, z=along rod}`; offset is team-relative
(via `r.kickDir`) so it always shifts forward for both teams. A tiny `footJitter`
velocity perturbation (default 0.003 of impact magnitude) prevents pixel-perfect
side-to-side oscillations. Debug visual: wireframe box (45% opaque) + reach box
inflated by `BALL_R` (18% opaque), updated per-frame to match physics world positions.

## Debug overlay (`C` key, `debug.js`)

Press `C` during gameplay to toggle translucent collision proxies drawn at the exact
analytic geometry used by `physics.js`. Two groups:

**Collision group** (`dbgGroup`): blue floor at y=0, red side/end walls, green goal-mouth
opening, yellow player capsules (parented to rod pivots), cyan wireframe ball spheres.

**AI group** (`dbgAIGroup`): toggleable layers showing AI decision zones and collision
zones. A gold-themed checkbox panel appears top-right when debug is on. All per-rod
boxes lie flat on the floor spanning the rod's full slide range in z
(`[min(baseZ)−maxOff, max(baseZ)+maxOff]`):

| Visual | Color | Shows |
|--------|-------|-------|
| gkPad | orange `#ff8c3a` 22% | Floor box at each GK's x spanning `z = ±(goalHalf+gkPad)` |
| raiseBehind | magenta `#ff2bd6` 18% | Box behind each rod: `relReal < raiseBehind` (raise threshold) |
| overFoot | green `#7dff8a` 18%  | Box on each rod: forward-offset feet zone |
| underFoot | orange `#ff8c3a` 18% | Box straddling rod: asym zone that keeps men down during swing return |
| inFront | blue `#3d8bff` 18% | Box ahead of each rod: `inFrontMin < relReal < inFrontMax` (swing reach) |
| lowY | cyan `#2af5ff` 10% | Horizontal plane at `y = lowY` covering full field (max kick height) |
| manHyst | gold `#ffcf4d` 85% | Ring on selected man's foot + dot on floor at target z-slide |
| footReach | orange `#ff8c3a` 18% | Oriented box inflated by `BALL_R` around each foot — ball inside = kick collision |
| aligned | green `#7dff8a` 65%/12% | Floor bars at each man showing ±align zone along z; nearest man greened when dz < alignSlow/fast |

`toggleDebug()` builds everything once (`buildDebug` → `buildAIPanel` + AI geometries),
then toggles `dbgGroup`/`dbgAIGroup`/panel visibility. `debugUpdate()` runs per-frame:
positions ball + foot-box proxies, calls `updateAIVis()` which updates all toggles
(manHyst rings, target dots, aligned bars, foot-reach boxes) and applies checkbox
visibility toggles. Also shows ball speed (`updateBallSpeed()`) in a cyan readout
below the camera info. The panel is built via `document.createElement` in
`buildAIPanel()` — no HTML template changes needed.

### 2026-07-22
- **Goal instant replays** (`js/replay.js` new, + `CONFIG.replay`/`REPLAY` alias + `cfg.replay`
  toggle, hooks in `main.js`/`flow.js`/`balls.js`/`powerups.js`/`input.js`/`ui.js`, `#replayUI`
  DOM + CSS). A flight recorder (`recordReplay`, called in the fixed-step loop AFTER `physics` and
  only while the post-step phase is still `'play'` — so the goal step itself is never recorded and
  the buffer ends with the ball still at the line for the freeze-frame) writes every ball's pos +
  type and every rod's offset/angle into preallocated typed-array ring buffers (~7s @ sim hz,
  ~100KB, zero allocation per step). On a goal, `onGoal` queues (`replayQueue`); when the normal
  goal-celebration timer expires, `main.js` hands off to `replayStart()` instead of `startCount`
  **iff** `replayPending()` (cfg on + footage ≥ `minLen`). Playback = new `S.phase==='replay'`:
  sim frozen (not in the `active` list), `replayUpdate(rdt)` re-poses 4 pooled ghost spheres
  (re-tinted per recorded ball type, trails via a `spawnTrail` shim off the live sprite pool) and
  drives the REAL rod pivots straight from the buffer (display only — `r.offset/r.angle` untouched;
  the interp block restores them next active frame). Camera: 5 hand-placed shots (rail / net cam /
  corner crane / sky drone / ball cam — rides goal-side of the ball gazing back up the pitch at
  the scoring team via a per-shot look override `RP.lookTo`+`RP.hasLook`), random per replay,
  never repeating, hand-held chase (`camLerp`/`lookLerp`), easing into slow-mo
  (`slowLast`→`slowSpeed`) with an fov push-in (`zoom`), a freeze-frame hold (`holdT`), then
  `flash()` + `startCount(recount)`. ALL shot placement numbers live in `CONFIG.replay.shots`
  (per-shot blocks; x values near the goal are ×gx so they mirror per end). Skippable by ANY key
  (input.js keydown guard), click (canvas mousedown guard), or pad A/B/Start (gamepadUpdate guard).
  UI: letterbox bars slide in + pulsing ● REPLAY tag + skip hint; `body.replayOn` fades the HUD out.
  - **Buffer cuts** (`replayCut`): `serve`, `redropBall`, `startMatch` — a replay can never show a
    teleport streak. `replayCut` ALSO clears the queue flag (a too-short rally would otherwise leave
    a stale queue that made the next out-of-bounds hold play a bogus replay). `replayAbort` (menu
    quit / endMatch / new match) tears playback down without the re-count handoff.
  - No replay on a match-winning goal (endMatch path returns before the queue). Match Setup gained
    a "Goal replays" checkbox (`#setReplay` ↔ `cfg.replay`, old saves migrate to `true`). Tuning
    all in `CONFIG.replay`. Verified by re-read (sandbox wouldn't boot).

### 2026-07-21
- **British pub room + GLB punctual lights** (`tools/build_pub_room.py` new, `js/models.js`,
  `js/config.js`). `build_pub_room.py` (conventions of `build_arena_table.py`: game coords,
  `g2b`, bmesh, version-safe `mat`) builds a placeholder pub — shell w/ oak beams + wainscot,
  bar (counter/brass rail/pumps/backbar/mirror/bottles/sign), fireplace w/ emissive embers,
  dartboard, frosted windows, `room_picture_1..3` (one material each — cheap retexture wins),
  tables/stools/bench, and **`room_pendant`** (cable + green-enamel frustum shade + emissive
  bulb) hanging over the table centre. Saves `assets/rooms/pub/fuzeball_pub.blend` (no-clobber)
  and exports `fuzeball_room_pub.glb` itself **including lights** — `export_table.py` is
  mesh-only, so re-export this room by setting the script's `EXPORT_ONLY=True` with the
  textured .blend open. `gcyl` gained an optional `r2` (frustum).
  - **Lights ship IN the GLB** (KHR_lights_punctual: pendant SPOT pointing down at the table,
    3 sconce POINTs w/ matching fixtures, fireplace POINT). `ensureRoom` (`models.js`) now
    normalises lights in a loaded room: `castShadow=false`, intensity ×`R.lightScale` clamped
    ≤4, and a default `distance` (spot 260 / point 180, decay 2) since glTF omits range →
    three.js would never attenuate. Blender exports watts as candela (~54×W), hence
    **`CONFIG.rooms.*.lightScale`** (pub .0004; script wattages are pre-tuned to it — tune
    mood via lightScale, not the .py). Rooms without a lightScale are untouched (×1, and the
    arcade GLB has no lights anyway).
  - `CONFIG.rooms.pub`: 'Sports Bar' → 'British Pub', points at the new GLB, `reflect:true`,
    hemi/dir eased (.72→.6 / .95→.8) since the GLB lights add. Build:
    `blender -b -P tools/build_pub_room.py`. Verified by re-read (sandbox wouldn't boot).

### 2026-07-20
- **⊞ Layout editor — player-arrangeable panels (league lobby + main menu)** (`js/layout.js` new,
  plus `index.html`, `css/styles.css`, `js/config.js`, one-line hooks in `js/league.js` /
  `js/flow.js`). A square ⊞ button (`.lyGearBtn`, same chrome as the Options gear — on the menu
  it sits directly below ⚙, on the league screen it's `position:fixed` top-right so it survives
  the screen's scroll) toggles an edit mode: every registered panel becomes draggable
  (grab anywhere) and resizable (gold bottom-right corner handle) on a 16px grid matching the
  wrap's dot background; a fixed gold toolbar offers ✓ Done / Reset layout. Arrangements persist
  in `cfg.layouts[screenId] = {p:{elId:{x,y,w,h}},h}` (px within the wrap) inside the normal
  `fuzeball` localStorage; **no save = the stock CSS flow, byte-identical**.
  - Mechanism: `.lyCustom` on `.lgWrap` makes it `position:relative` with an explicit height,
    dissolves the `.lgSide` columns (`display:contents`) and switches every `.panel` to
    `position:absolute` driven by inline left/top/width/height. `layApply(id)` (called at the
    end of `openLeague`) applies a save, clamping x/width to the live wrap width; ≤1040px
    viewports keep the stacked mobile flow untouched. A debounced window-resize listener
    re-applies. Panels league.js hides at runtime (scout/history/last-round) still get coords
    while hidden, so they pop in at their saved spot; in edit mode they render as 50%-opacity
    ghosts (`.lyEditing .panel.hidden{display:block!important}`) so they can be placed.
    A custom arrangement also stamps `.lyScroll` on the screen (top-anchored + `overflow-y:auto`)
    since absolute heights can exceed the viewport — league is already like that, the menu isn't.
    Menu screen: registered as `LAY_SCREENS.menu` over `#menu .panelWrap`
    (`menuSetupPanel`/`menuKitPanel`/`menuCtlPanel`); applied at layout.js load (menu is on
    screen at boot) and re-clamped in `gotoMenu`.
  - Edit mode (`.lyEditing`): grid-line overlay, dashed gold outlines, `cursor:move`, panel
    CONTENT gets `pointer-events:none` (drags can't trip buttons/selects); drags/resizes go
    through one `pointerdown` delegate on the wrap + window move/up/cancel listeners, snap via
    `laySnap`, save on release (`laySave` also recomputes wrap height). First-ever edit seeds
    the save from `layCapture` (the panels' live flow rects). Reset deletes the save and
    returns to flow. Panels needed stable ids — added `lgStandingsPanel`/`lgFixturePanel`/
    `lgSquadPanel` in `index.html` (the rest already had them).
  - **Adding a screen** = one `LAY_SCREENS` entry (screen id, wrap selector, panel ids) + a
    `layApply(id)` call where the screen opens + a button wired to `layEditStart(id)`.
  - Verified live in the browser pane (drag, resize, persist across reload, reset, ≤1040
    skip; menu editor verified by hot-patching the live page). NOTE: the pane caches BOTH
    `styles.css` AND `js/*.js` across edits under file:// — cache-bust (or hot-patch) when
    re-testing changed files there.
- **Four WebGL contexts → two** (`js/world.js`, `js/customize.js`, `js/league.js`, `js/debug.js`).
  The customize turntable (`PV`), the menu figurine thumbnails (`THB`) and the league-setup preview
  (`LSP`) each owned a `WebGLRenderer`. Every GL context carries its own framebuffer AND its own
  upload of every texture/geometry it draws, so a figurine on the table, in the studio and in a
  thumbnail existed THREE times in VRAM. They now share one offscreen renderer, **`PRV`**
  (`world.js`): a caller renders its scene through `PRV.draw(scene,cam,targetCanvas,w,h,dpr)` and
  the pixels are blitted into its own plain 2D canvas, or `PRV.dataURL(...)` for the thumbnails.
  Only the main game canvas keeps a dedicated context.
  - **`#pvCanvas` and `#lgSetupFig` are 2d-only canvases now.** A canvas hands out exactly one
    context type for its lifetime — attach a `WebGLRenderer` to either again and `getContext('2d')`
    starts returning null and the preview silently goes blank. Both are CSS-sized, so `PRV`
    overwriting their backing store is safe.
  - `LSP` lost `preserveDrawingBuffer:true`. It needed it because it drew straight to a VISIBLE
    canvas once per interaction with no rAF loop; the pixels now come to rest in the destination 2D
    canvas, which the compositor won't clear. Same reason `dataURL` goes via a 2D scratch canvas
    instead of reading back the GL buffer.
  - **The shared buffer is GROW-ONLY, with each caller rendering into a sub-viewport** rather than
    resizing per call. The callers interleave at input rate — the finish sliders run
    `czAfterFinish` on every `input` event, repainting both 240×320 thumbnails while the
    panel-sized studio is mid-turntable — and resize-per-call would reallocate the framebuffer
    twice per slider tick. The viewport sits at the buffer's TOP-left (GL's bottom-left origin
    means `y = bh − hh`) so it maps to `drawImage`'s top-left source rect with no flip;
    `setScissorTest(true)` keeps `clear()` inside it. `PRV` pins its own `pixelRatio` to 1 and
    takes CSS px + dpr, so there's one place the conversion happens.
  - Sizes moved onto the consumers: `PV.w/h/dpr` (set in `pvResize`), `THB.W/H/dpr`, `LSP.W/H/dpr`.
    `LSP` gained a `ready` flag (its old init guard was `if(this.r)`).
- **`memLog` re-enabled + `memTex()` added** (`js/debug.js`). `memLog` was fully commented out, so
  none of the above was measurable. It now also prints resident table skins/rooms BY NAME (a lazy-
  loader regression reads as extra keys, not a bigger number), the shared preview context's
  geometry/texture counts, and an estimated texture total. **`memTex(n)`** consoles the fattest
  resident textures with pixel dimensions — `renderer.info` counts textures but says nothing about
  size, and size is what costs: one 4096² RGBA texture is 64MB uploaded (86MB with mipmaps) plus
  roughly that again for the decoded CPU-side image, so an 18-texture scene can be >1GB while every
  other metric looks trivial. Walks the live scene plus the off-scene template caches, de-duped by
  texture uuid. Estimate assumes 8-bit RGBA + mipmaps (what an uncompressed glTF PNG/JPG becomes).
- **Table + room GLBs are now LAZY and LRU-evicted** (`js/config.js`, `js/models.js`,
  `js/arena.js`, `js/world.js`, `js/league.js`). `loadTableModel` used to loop `CONFIG.tables` and
  fetch EVERY table's active skin, and `loadRoomModel` every `room` backdrop — three table shells
  and three environments resident to show one, before the player had done anything. Now boot loads
  only `cfg.table`'s active skin + its room; the rest load the moment they're picked and evicted
  once displaced. Figurines/explosions were already lazy (`modelCache`, `ensureExplosionModel`), so
  this was the last bulk-load left.
  - **`CONFIG.tableAssets`** (new): `preloadAll` (false; true = old eager boot, handy for profiling
    with zero pop-in), `cacheSkins:2`, `cacheRooms:1`. Caps count the ACTIVE entry, which is always
    protected — so `cacheSkins:2` keeps one previous skin warm for instant A/B in the menu,
    `:1` holds nothing you aren't looking at.
  - `models.js`: `skinOrder`/`roomOrder` LRU key lists (`touchSkin`/`touchRoom`),
    `disposeTableSkin(id,skinId)`, `disposeRoom(id)`, `pruneTableAssets(keepSkin,keepRoom)`;
    `loadRoomModel` split into per-table **`ensureRoom(id,cb)`** (idempotent, guards in-flight via
    `roomLoading`; the old name survives as a shim). Skin GLBs and rooms are never `clone()`d — the
    loaded scene IS the only instance — so unlike figurine templates these HARD-dispose via the
    shared `disposeModelTemplate` (world.js). Prune counts *non-kept* entries rather than raw list
    length, so a stale asset can't squat the last slot (arena→classic still frees the arena room).
  - **Registry bookkeeping is the sharp edge**: `loadSkin` stamps every mesh with
    `userData.skinKey` (`'id/skinId'`), and `disposeTableSkin` filters that key out of
    `glbGoalGrow`/`glbGoalWall`/`glbGoalSplit` (big-goal widen) and `arenaMorph` (bowl morph)
    before freeing — otherwise those arrays keep freed meshes alive and `bigGoalUpdate` drives
    corpses. Any FUTURE registry that indexes skin meshes must be swept here too.
  - `ledMat` is repointed at whichever skin is showing, so freeing one could dangle it: `world.js`
    now keeps **`primLedMat`** (the procedural LED material from `buildTable`, never disposed) and
    both `disposeTableSkin` and `applySkin` fall back to it.
  - **`applySkin` 'loaded' test changed from group-exists to group-HAS-CHILDREN.** `loadSkin`
    parents an empty sub-group the instant a fetch starts; with eager loading that was invisible,
    but lazily it meant the first switch to a table hid the primitives and rendered NOTHING until
    the GLB landed. Empty now = keep primitives up, and the `loadSkin` callback re-runs `applySkin`
    to swap them in. (Circuit has no primitives, so it's briefly bare — expected.)
  - **`applyTable(onReady)`** gained an optional callback firing once skin AND room are resident
    (synchronous when cached, i.e. the normal menu case); it kicks the fetch off and only prunes
    after both land, so nothing visible is ever freed. `lgPlayMatch`/`cupPlayTie` now gate kickoff
    on `tableDone` alongside `modelDone`/`tapeDone` — a division/cup can force a table the player
    never opened, and the versus-tape screen is the loading room. `selectSkin` prunes on the same
    settle rule.
  - Verified by re-read (sandbox wouldn't boot). Boot order confirmed safe: `initThree` runs
    `buildTable`/`buildArenaTable` (creating `tableGroups.classic`/`.arena` + their primitives)
    before `startLoading` → `loadTableModel`, which only fresh-creates groups for GLB-only tables.
- **Circuit table redesigned as a WALLED-goal flat table** (`js/config.js`, `js/arena.js`,
  `js/physics.js`, `tools/build_table.py`). Each goal end is now ONE solid wall the goal mouth is
  inset into — the two mouth-flanking end walls are joined (visually and physically) into a single
  face, so over-the-crossbar shots slap the wall and bounce back into play instead of sailing out.
  - `CONFIG.tables.circuit` UNcommented + gained `endWall:{h:26}` (solid end-wall height; also
    added classic-style `deadzones`). New global `ENDWALL_H` (`arena.js`, set in `applyTable`:
    `activeTable.endWall.h` for flat tables, else 0). `physics.js` `stepBall` flat branch: the
    mouth pass-through is gated `(p.y<goalH||!ENDWALL_H)` and the end-x bounce height is
    `ENDWALL_H||F.wallH` — so classic is byte-identical and walled tables bounce anything below
    the wall top at x=±(L/2−BALL_R), incl. above the bar within the mouth. **Big Goal works
    unchanged**: the opening still tracks `goalHalf*bigGoalMult` in the same expressions.
  - Visuals need NO new game code: the walled GLB's `wall_end_*` flanks are full-height and
    `registerBigGoalMeshes` already slides their inner edge with the widen; the new above-goal
    header panel is named `goal_frame_header_l/r` so `glbGoalGrow` z-scales it about z=0 —
    header width and flank inner edges stay flush through the widen (same `goalHalf*mult`).
  - `tools/build_table.py`: `build_flat_shell(style,end_wall_h=None)` — None = old classic output
    (unchanged); set = full-height flanks + header per end. `TABLE_DEFS.circuit.endWallH=26.0`
    (keep matched to `CONFIG.tables.circuit.endWall.h`), `main()` passes it through. Build with
    `blender -b -P tools/build_table.py -- circuit` then `-P tools/export_table.py -- circuit`.
    Until the GLB is built, Circuit physics works but the end walls are invisible (no procedural
    fallback). Verified by re-read (sandbox wouldn't boot).

### 2026-07-18
- **Back-swing own-goal guard is now purely location-based** (`js/ai.js`). A slow ball sitting
  directly behind a man could still get swung into its own goal: the `footStuck` guard was
  speed-gated (`speed<AIC.footTrapSlow && inFootRange`), so a ball creeping slower than the
  threshold but not stopped slipped through and the rod raised THROUGH it (esp. the GK). Fixed by
  making `footStuck = inFootRange(r,best)` — no speed gate, so it triggers however slowly the ball
  moves whenever the ball is in a live foot's back-swing reach. Because `safeRaise`/`trap` own the
  swing angle in `updateRods` INDEPENDENTLY of `r.raise`, suppressing the raise latch alone wasn't
  enough: added `footStuck` to both actions' held-exit conditions so an already-lifted rod bails
  and drops the men instead of sweeping back through the ball; `safeRaise`'s entry gate now reads
  `!footStuck` (same value, reusing the computed one), and `trap`'s entry is already blocked since
  it requires `r.raise` (which `footStuck` forces false). The ball then routes to men-down + the
  `evade` slide-clear. Trade-off: the veto is strictly positional, so a FAST dead-aligned ball from
  behind is no longer let through by a raise — the men hold as a wall instead; `footRangeBack` (how
  deep behind the veto reaches) is the knob if that ever feels too passive. `footTrapSlow` is now
  unused by this path (still read by the vestigial foot-trap break below it). Verified by re-read
  (sandbox wouldn't boot).
- **'Total Control' gamepad mode** (`cfg.padControlMode` `'classic'|'total'`, Options → Controller).
  The triggers stop being raise/kick and become an analog slide-speed modifier: LT eases toward
  `padTCFine` (precision steps), RT toward `padTCFast`, neither = `padTCBase` middle-ground (all
  Options sliders; the result scales both the target step in `input.js` and, via `S.tcMult`, the
  user chase cap in `rods.js`). Kick = A only, raise = X only in this mode. The right stick keeps
  rod angle on its bound axis; the OTHER right axis is the swerve line — stored per-rod as
  `r.tcSpin` and added to `b.spin` on ball contact in `collideRod` (`KICK.tcSpinGain` per contact,
  clamped by `spinClamp`; `padTCSwerve` sens slider, `padTCSpinInvert` flip). A connected-but-
  untouched pad leaves `S.tcMult` at 1 so keyboard/mouse play is never slowed. Classic mode is
  byte-for-byte the old behaviour.
- **Swerve preview in the Options live tester** (TC mode only): `tcSwerveFromAxes(gp)` in
  `input.js` is the single stick→swerve pipeline, shared by `gamepadUpdate` (stores `r.tcSpin`)
  and `optionsTick` (renders the preview). An SVG flight path bends a quadratic off the straight
  dashed 'swing line' with the live swerve value; a ball loops along it and the % label rides
  above the curve end on the bend side. `updateTCVis` shows/hides both the TC sliders and the
  preview.

### 2026-07-16
- **Release audit fixes** (full-codebase pass). (1) **Gamepad analog slide was dead**:
  `gamepadUpdate` shaped stick deflection with `Math.pow(n,cfg.padSlideCurve)` but
  `padSlideCurve` was never defined anywhere → `pow(n,undefined)`=NaN → `if(ay)` never
  fired (d-pad still worked). Added `padSlideCurve:1` to cfg defaults (`config.js`) and
  `OPT_DEFAULTS` (`options.js`); old saves keep the new default (Object.assign only
  overwrites saved keys). (2) **Pitch tex fallback paths fixed** to match the files on
  disk: neon → `pitches/neon_nights.jpg`, champions_green → `.png`, champions_purple →
  `pitches/prime_champions_purple.png` (were all wrong → fallback silently failed when
  the pitch GLB mesh is absent). (3) **Cup prevKit chain**: `cupPlayTie` re-snapshotted
  prevKit from live cfg on EVERY tie, so from tie 2 on it captured the already-swapped
  cup kit/table — finishing the cup then restored the CUP setup instead of the user's.
  Now reuses `S.lg.prevKit` when one is being carried. (4) `openCup` now hides `#win` +
  `#hud` (arriving via win-screen Continue left them stacked under the bracket).
  (5) Win-screen cup round label used `CUP.rounds[LG.cup.round]` AFTER `cupRecord`
  advanced the round (off-by-one) — now shows `S.lg.banner` (the round actually played).
  (6) Removed duplicate `base:1` key in `league.divisions[0]`. Files: `js/config.js`,
  `js/options.js`, `js/league.js`, `js/flow.js`. Verified by re-read (sandbox wouldn't
  boot). KNOWN SHIP-GAPS flagged, not changed: classic `glass` skin + `circuit` table
  GLBs don't exist yet (their dropdown entries show a bare/fallback table); explosion
  GLBs missing for stormer/manStumpy/womanKimi/womanAndroid (clean fallback to instant
  vanish + console warn); opening Options mid-league-match and touching any control
  saveCfg's the league-swapped kit/table into the player's persisted settings.
- **Table SKINS (swappable liveries per shape, pitch-style)** — a table is now a SHAPE with one
  or more `skins` (paint-job GLBs on the SAME geometry), chosen from a new **Skin** dropdown, so
  shape and look are decoupled (shape = physics-fixed, skin = cosmetic). `CONFIG.tables[*]` lost
  its top-level `glb`/`glbFallback`; each now has `skins:{id:{name,glb,glbFallback}}` + `defSkin`
  (`glb` relative to `folder`). Classic ships two skins (`wood` default + `glass`); arena/circuit
  have one. `cfg.skins` (map table-id→skin-id, per-table memory) persists the choice; old saves
  default to `defSkin`. Plumbing (all id/skin-keyed): `skinGroups[id][skinId]` (sub-group per skin
  under the table group), `skinHasFrame`, `skinLed`, `tablePrimObjs[id]` (procedural fallback
  meshes captured in `buildTable`/`buildArenaTable`). `models.js` `loadTableModel` now loads only
  each table's ACTIVE skin at boot; `loadSkin(id,skinId,cb)` lazy-loads the rest on demand, caches
  by id/skin, routes meshes by the same name contract, and on a missing GLB drops the empty group
  so `applySkin` falls back to the primitives. `applyTable` (arena.js) shows the table group then
  calls `applySkin(id)`: toggles skin sub-group visibility (a hidden group hides its subtree — cheap),
  shows primitives only when the active skin has no GLB, repoints `ledMat` at the active skin's LED
  mesh, and hides the primitive goal frame when the skin brings its own posts. `curSkin(id)` /
  `selectSkin(id,skinId)` helpers; `ui.js` `refreshSkinSelect()` fills `#setSkin` from the current
  table's skins (and hides the row when a table has only one skin). `tableHasFrame` is now vestigial
  (superseded by `skinHasFrame`). Pipeline: `build_table.py`/`export_table.py` gained `SKIN_ID`
  (+ `-- <table> <skin>` arg); `TABLE_DEFS` skins carry their own `glb`+`style`, so a layman builds a
  new skin with e.g. `-- classic glass`. **Add a skin = texture the shape in Blender, export a GLB,
  add one line to `CONFIG.tables[id].skins`.** Files: `js/config.js`, `js/arena.js`, `js/world.js`,
  `js/models.js`, `js/ui.js`, `index.html`, `tools/build_table.py`, `tools/export_table.py`.
  Verified by re-read (sandbox wouldn't boot).
- **Parametric multi-table Blender pipeline + 3rd table (`circuit`)** — added
  `tools/build_table.py` (parametric builder) and `tools/export_table.py` (parametric
  exporter); the single-table `build_arena_table.py`/`export_arena_table.py` are KEPT as
  backups. `build_table.py` holds a `TABLE_DEFS` registry (mirrors `CONFIG.tables`): each def
  picks a `shape` (`'flat'`=classic box walls via `build_flat_*`, `'bowl'`=the arena SDF via
  `build_bowl_*`, params in `P`) and a `style` (colours/emissive), and emits shell + goals +
  nets + field + led (+optional shared `room`) honouring the mesh-name contract
  (`field*`/`led*`/`goal_net*`/`goal_frame*`/`wall_end*`). Pick the table via the top-of-file
  `TABLE_ID` or a headless `-- <id>` arg; it saves `assets/tables/<folder>/fuzeball_<id>.blend`
  (never clobbers a textured one) + first-pass GLBs. `export_table.py` bakes throwaway copies
  (neg-scale/modifier-safe, same trick as the arena exporter) and defines the table GLB as
  "every mesh that isn't a ball / `room_*` / `ref_*`", so any decor the artist adds ships
  automatically; `TABLES` maps id→folder/glb/room. **`circuit`** is the worked 3rd table: a flat
  glowing-circuit reskin — `collision:'flat'` so it reuses the classic physics UNCHANGED, added
  to `CONFIG.tables` (auto-appears in the Table dropdown) + `TABLE_DEFS`/`TABLES`. To see it:
  `blender -b -P tools/build_table.py -- circuit` then `-P tools/export_table.py -- circuit`
  (until then, selecting Circuit shows the shared pitch + goals + ground but no walls, since its
  GLB doesn't exist and it has no procedural fallback). **Recipe to add table N:** `TABLE_DEFS`
  entry + `TABLES` entry + `CONFIG.tables` entry; a `'flat'` shape is drop-in, a NEW shape needs
  a `build_<shape>_*` here + a collision branch in `physics.js`. Files: `tools/build_table.py`
  (new), `tools/export_table.py` (new), `js/config.js` (circuit entry). Python verified by
  re-read (sandbox wouldn't boot).
- **Table system is now a registry (multi-table ready)** — replaced the hardcoded two-table
  (`primTable`/`arenaTable`, boolean `ARENA_ON=cfg.table==='arena'`) setup with a data-driven
  `CONFIG.tables` registry. Each entry: `name`, `folder`+`glb` (+optional `glbFallback`),
  `collision` (`'flat'`=classic box walls in `physics.js` | `'bowl'`=arena SDF in `arena.js`),
  optional `room` (environment GLB, relative to folder), `defTheme` (metadata). Arena's shape
  params moved under `arena.bowl` (alias `const ARENA=CONFIG.tables.arena.bowl` keeps every
  `ARENA.*` ref valid). New generic plumbing: `tableGroups{}` (id→THREE.Group; `buildTable` sets
  `classic`, `buildArenaTable` sets `arena`, `loadTableModel` creates fresh groups for GLB-only
  tables), `tableRooms{}` (id→env GLB), `activeTable` (current def). `applyTable()` is fully
  registry-driven: pick id from `cfg.table` (falls back to classic), show that group + its room /
  hide the rest, set `ARENA_ON=activeTable.collision==='bowl'` so physics/balls/powerups/debug are
  UNCHANGED. `loadTableModel`/`loadRoomModel` loop `CONFIG.tables`; `registerArenaMorph` now gated
  on `collision==='bowl'`; classic's GLB still loads via the `glbFallback` (`assets/fuzeball_table.glb`)
  until the file is moved to `assets/tables/classic/`. `ui.js` populates the Table + Theme dropdowns
  from the registries (like the pitch select), so adding an entry auto-adds its option — added a
  `name` field to each `CONFIG.themes` entry for the labels. `loadRodModels` now tries `assets/rods/`
  then falls back to `assets/` root (rods are shared across tables). **Adding a table = drop a GLB
  honouring the mesh-name contract (`field*`/`led*`/`goal_net*`/`goal_frame*`/`wall_end*`) under
  `assets/tables/<id>/` + one `CONFIG.tables` entry; a `'flat'` shape needs no physics change, a new
  SHAPE adds a collision branch. Livery = one `CONFIG.themes` entry; pitch = existing
  `CONFIG.pitches` registry (already GLB-slot based — left as-is).** Pitches deliberately untouched
  (already optimal: per-variant GPU free/re-attach in `drawField`). Files: `js/config.js`,
  `js/arena.js`, `js/world.js`, `js/models.js`, `js/ui.js`. Verified by re-read (sandbox wouldn't boot).
  TODO (asset moves, binary — do in a shell): `assets/fuzeball_table.glb` →
  `assets/tables/classic/fuzeball_table_classic.glb`; `assets/fuzeball_rod_{1,2,3,5}man.glb` →
  `assets/rods/`. Both are optional (fallbacks cover them) but complete the tidy structure.
- **AI reaction latency (`reactDelay`)** — the AI no longer tracks the ball frame-perfectly.
  Each sim step every live ball's `{x,y,z,vx,vy,vz}` is pushed into a per-ball ring buffer
  (`ballRecord`/`recordBalls`, called at the top of `aiUpdate`), and each rod reads the sample
  from `round(reactDelay*sim.hz)` steps back via `aiView(r,b,delay)` — a reusable **per-rod**
  proxy (`r.pv`) shaped like `{m:{position},v}` holding the DELAYED state. From the `best=aiView(…)`
  line down, all reach/aim/kick reads run off perception; nearest-ball SELECTION stays live, and
  the physical kick still resolves against the real ball in `physics.js`, so contact is honest —
  only the decision lags. This is a genuine see-then-act latency, distinct from (and on top of) the
  existing `react` low-pass smoothing (which stays as hand wobble). `DIFFS.*.reactDelay`
  (rookie .25 / pro .12 / legend .06 s) is now the dominant human-feel knob; it's scaled per rod by
  `stReact` (higher rea → shorter delay, fatigue lengthens it). Buffer length =
  `ceil(CONFIG.ai.reactMax*sim.hz)+1`; `syncBall` calls `primeBallHist(b)` on every teleport
  (serve/redrop/split/NaN) so the delayed view snaps to the new spot instead of streaking. Old
  saves w/o `reactDelay` → `0` (live passthrough); works in AI-vs-AI (no stats) too. Files:
  `js/config.js` (`DIFFS.reactDelay`, `ai.reactMax`), `js/ai.js` (buffer + `aiView`), `js/balls.js`
  (`syncBall` prime). Verified by re-read (sandbox wouldn't boot).
- **Ball-trajectory prediction is now a stat** — `stPred(r)` (`js/stats.js`) scales the AI's
  anticipation lead `D.pred` (both the z-lead and the defensive-line lead in `aiUpdate`). Homed on
  **iq** (reading the play is cognition, not execution — keeps `acc` about precision), gentle and
  FLOORED: `max(predFloor, 1+(iq−5)*predIq)`, base 5 = ×1. Uses the CONTINUOUS `stIQ`-style term,
  NOT the per-beat `r.aiIQ` boolean. Computed once/rod as `predL=D.pred*stPred(r)`. Config:
  `CONFIG.stats.predIq:.06`, `predFloor:.7`. Files: `js/stats.js`, `js/config.js`, `js/ai.js`.
- **AI slide agility is now a stat** — `stAgil(r)` (`js/stats.js`) scales the AI rod's direction-
  change accel cap in `updateRods` (`AIC.slideAccel*stAgil(r)*dt`). Keyed on **spd** (a fast rod
  both tops out higher AND reverses quicker) with its OWN coefficient `CONFIG.stats.agil:.09` so
  snappiness tunes apart from top speed; fatigue folds in. **AI-only** — the user rod keeps its
  instant/speed-capped branch. Base 5 = ×1, so unbuilt/non-league teams are unchanged. Files:
  `js/stats.js`, `js/config.js`, `js/rods.js`.
- **Stamina broadened** — `stFat` (fatigue) now feeds the AI's accuracy + decision channels too,
  not just speed/reaction. `stErr` divides by `stFat` (wander error GROWS when tired), `stAim`
  multiplies by it (goal aim fades), `stIQ` multiplies by it (fewer clever plays), `stPred`
  multiplies inside its floor (reads the play late, never below `predFloor`). Each channel capped at
  the same ≤`fatMax` (25%) fade; ramp is 0 until `fatStart` so NO early-match change, and `sta=10`
  never fades. Deliberately left OUT of shared execution (`stHit`/`stGrip`/`stAccFrac`/`aimAssist`)
  so a tired team plays sluggish + sloppy + dozy while the HUMAN's kick feel never degrades. File:
  `js/stats.js`.
- **League brains now configurable + per-division** — `teamDiff(t)` no longer hardcodes `'pro'`
  during a league match; it reads `S.lg.diff` (per-division override) falling back to
  `CONFIG.league.baseDiff` (now `'rookie'`, so a fresh league starts gentle and builds pull teams
  up from there). `lgPlayMatch` stashes `S.lg.diff` from the current division's optional `diff`
  field (`CONFIG.league.divisions[t].diff`, now set rookie→pro→legend up the ladder so the ceiling
  ramps with the tier), cup matches use `CUP.diff||baseDiff`. NOTE: flat `baseDiff` lowers the
  whole league's CEILING too (stats multiply the difficulty's base numbers), which is why the
  per-division `diff` fields exist. Files: `js/config.js` (`league.baseDiff` + `divisions[].diff`),
  `js/league.js` (`teamDiff`, `lgPlayMatch`, cup `S.lg`).

### 2026-07-12
- **Cannonball now shatters itself on detonation** (`js/config.js`, `js/models.js`,
  `js/fracture.js`, `js/fx.js`, `js/audio.js`, `js/balls.js`). Previously the ball just
  `removeBall`'d (instant vanish) while only the nearest player fractured. Reuses the entire
  player-fracture machinery (`S.frac` list + `fractureUpdate` fade/dispose), which the ball
  case is a strict subset of: no team tint, no rod-pose reconstruction, no respawn coupling.
  - `CONFIG.cannonball` gained `explosionSrc` (`assets/animations/cannonball_explosion.glb`,
    one Action/clip PER shard like the player GLBs), `fractureLife` (2.2s self-contained
    lifetime — no respawn to sync to; keep ≥ baked clip length) and `fractureScale` (1; the
    ball GLB is baked in-scene at game scale).
  - `models.js`: new `ballExplosionTemplate` global; `loadExplosionModels` loads it alongside
    the figurine explosions on the same boot step + `done` counter (still gated by the
    `CONFIG.debug.fractureFx` master switch). `warmFractureShaders` refactored to a shared
    `warm(tpl)` and now pre-compiles the ball shader too.
  - `fracture.js`: `spawnBallFracture(pos)` clones the template at the detonation pos, plays
    ALL clips, and pushes `{obj,mixer,mats,light,until:S.time+fractureLife}`. Ball entries
    carry a short orange `PointLight`; `fractureUpdate` decays its intensity and
    `disposeFracture` removes it (both `if(f.light)`-guarded, so player entries are untouched).
  - `fx.js`: `cannonExplodeFx(pos)` — layered `burst`/`burstRing`/`burstUp` (fire+spark+smoke)
    + `flash()` + `S.shake=1.9` + `Au.boom()`, then `spawnBallFracture`. Particles fire even
    if the GLB never loaded, so there's always a visible bang.
  - `audio.js`: `Au.boom()` — sub-bass sine drop (170→36Hz) + low rumble noise + high crack.
  - `balls.js`: `cannonballUpdate` captures `bp=b.m.position.clone()` BEFORE `removeBall`
    (mesh is freed after), then calls `cannonExplodeFx(bp)` in place of the old `Au.power()`.
  Verified by re-read (sandbox wouldn't boot). Tuning notes: if debris looks wrong-sized set
  `fractureScale`; if it vanishes mid-animation raise `fractureLife`.

### 2026-07-11
- **Dead-ball detection now displacement-based, not speed-based** (`js/powerups.js`,
  `js/config.js`). Two symptoms, one root cause: a ball a player is holding at its feet, or one
  wedged/spinning against a wall between two raised rods forming a platform, keeps a high
  `b.v.length()` while its true position never actually travels — so the old `stallVel`/`wedgeVel`
  speed tests never fired. It was made worse by `collideRod` setting `S.still=0` on every touch,
  which reset the global stall timer each frame a resting ball re-contacted a foot. `deadBallUpdate`
  now grows a per-ball HORIZONTAL bounding box of where `b.cur` has been; the box only resets when
  the ball roams past `CONFIG.deadball.moveEps` (4u), so a ball pinned in one spot accrues time
  regardless of its internal velocity or per-touch collisions. `allStuck` (every live ball boxed-in
  for `stallT`) → whistle + re-drop all (covers single-ball); one ball boxed-in for `wedgeT` in
  multi-ball → re-drop just it. `redropBall` clears the tracker (`b.bbMin=b.bbMax=null`). Removed
  `stallVel`/`wedgeVel`; added `moveEps`. `S.still` is now vestigial (still written, unread).
  Verified by re-read (sandbox wouldn't boot).
- **Evade action (`r.act='evade'`) + `clearOffset` helper** (`js/ai.js`, `js/config.js`,
  `js/debug.js`). Fixes the rod shadowing a ball stuck directly behind its men in z — it used to
  keep aligning a man onto the ball, walling it in place.
  - `clearOffset(r,bz,cz,prefer)` (`ai.js`): nearest slide offset where NO live foot is within
    `cz` of the ball z, optionally restricted to one side (`prefer` −1/0/+1). The post-kick
    safe-lower side-step (`heldFwd`) was refactored onto it (identical behaviour, now shared).
  - New `r.act='evade'` action + `CONFIG.ai.evade` (`on/vz/maxSpeed/abortT`): when a slow ball is
    stuck behind a man (`inFootRange`) and the rod isn't trapping/lifting it (not past the raise
    latch, no gap for safe-raise), it slides the men AWAY via `clearOffset` until the ball is no
    longer `inFootRange`. Direction = opposite the ball's z-drift when `|v.z|>vz`, else opposite
    the side the ball sits on (commits, no dither). Gated to non-strikeable balls (`!overFoot &&
    !inFront`) below `maxSpeed`; forces men down (`r.raise=false`) and skips man-selection + kick
    while active (`continue`), so the rod just slides clear. Exits the instant the ball clears /
    speeds up / comes to the front / goes deep-behind (raise latch takes over). Priority order for
    a ball behind: trap → safe-raise → evade (all `!r.act`-guarded, so higher ones win).
  - Debug: **Evade** AI panel layer (teal `#00d9a3`) — per-rod box over the behind-the-rod band,
    hot while `r.act==='evade'`. Verified by re-read (sandbox wouldn't boot).
- **`inFootRange` helper + safe-raise decoupled into its own action** (`js/ai.js`, `js/rods.js`,
  `js/config.js`, `js/debug.js`).
  - `inFootRange(r,b)` (`ai.js`): ONE reusable "would lowering/raising the rod clip this ball?"
    test — a dir-relative rectangle around each live foot: `underFootFront` forward,
    `CONFIG.ai.footRangeBack` (6.0) behind (a raising swing sweeps back), `footBox.z + BALL_R +
    clearMargin` half-width in z (a foot's z footprint, shared with the drop-sweep lowering
    check). Replaces the old inline `FOOT_BOX.z + raiseBuf` z-only clip test.
  - The pre-trap safe-raise (was nested in `CONFIG.ai.trap.safeRaise`/`raiseBuf`) is now a
    first-class action `r.act='safeRaise'` with its OWN config block `CONFIG.ai.safeRaise`
    (`on/angle/lerp/back/front/maxVX/maxSpeed/abortT`), fully decoupled from trap. It eases the
    rod to a **defined** lift `angle` (−1.35, driven in `updateRods` like the trap angle) instead
    of a full `raiseA` latch. Trigger gate = the SR x-band + `|v.x|<maxVX` + `!inFootRange`
    (raising won't clip). While held it forces `r.raise=false`/`behindFlag=false` (the action owns
    the angle); exits on band-leave / speed-up / high ball / `abortT`, then the normal drop+kick
    clears it with the man already repositioned. Trap enter is unaffected (still gated on
    `r.raise`, which safe-raise keeps false, so no clobber).
  - Debug: new **Safe Raise** AI panel layer (lime `#c2ff4d`) — per-rod box over the SR band,
    hot while `r.act==='safeRaise'`. Verified by re-read (sandbox wouldn't boot).
- **Pre-trap safe-raise** (`js/ai.js` + `CONFIG.ai.trap.safeRaise`/`raiseBuf`). Fills the gap
  where a slow, sideways ball loiters in the trap x-band (`back..front`) but isn't far enough
  back to trip the `raiseBehind` latch, so the rod sat DOWN behind it. New block (after the
  raise-latch decision, before the trap action): if the ball is in that x-band, low, slow
  (`|v.x|<maxVX`, `speed<maxSpeed`) AND sits in a z-GAP — no live man's footbox
  (`FOOT_BOX.z + raiseBuf`) lines up with it, so raising can't clip it — it forces a full raise
  + `behindFlag` latch. Man-selection then slides a man in behind the ball and the normal
  trap/kick logic decides trap-or-clear. If a foot IS aligned in z (raising would sweep into
  the ball) it's left to the normal path. Gated by `r.aiIQ` (loosen if you want every rod
  doing it). Also hoisted `const TR=AIC.trap;` above the block (was declared below → TDZ).
- **Decision intelligence is now a stat** (`iq`, 7th rod stat). `stIQ(r)` in `js/stats.js`
  (`CONFIG.stats.iq` coefficient, base-5-neutral ×multiplier like the others); `ai.js` per-rod
  roll became `r.aiIQ=Math.random()<clamp((D.iq||0)*stIQ(r),0,1)`, so the stat modulates the
  difficulty's base iq (league forces `'pro'`=.55, so `iq` IS a league team's smartness dial —
  ~.14 at 0, ~.96 at 10). Wired through the league system: `'iq'` added to `LG_KEYS` (auto-
  propagates to builds, the squad `+` UI, random/AI spend, relegation); `CONFIG.league.rate`
  gained light `iq` zone weights (feeds OFF/DEF ratings + the sim) and `CONFIG.league.spend`
  gained `iq` weights (MID/ATT-heavy). `loadLG` backfills any missing stat key (incl. `iq`) to
  base so old saves don't render empty pips / read NaN. Files: `js/stats.js`, `js/ai.js`,
  `js/config.js`, `js/league.js`.
- **GK trap z-detection extended past the slide band** (`CONFIG.ai.trap.gkReach`). The trap
  z-gate was `dz<alignZ` measured from the man's live position, so a keeper (maxOff 13, alignZ
  2.2) only detected to ±15.2 — a ball drifting back toward goal wider than that was ignored.
  New role-aware gate: `trapZ = r.role==='GK' ? |bp.z - clamp(bp.z, ±maxOff)| < gkReach :
  dz<alignZ`, i.e. the GK also commits when the ball's z overshoots its slide band by less than
  `gkReach` (default 6 → detects to ±19). Outfield rods unchanged. The scoop still gates on true
  `dz<alignZ`, so beyond-reach it just holds the trap posture (early-ready, no swing at air).
  `js/ai.js`, `js/config.js`.
- **Gap-aware aiming** (`CONFIG.ai.gapAim` + `shotEval()` in `js/ai.js`, `js/stats.js`,
  `js/debug.js`). AI aim previously targeted goal CENTRE (+ accuracy spray); it now reads the
  opposing men and steers at the widest OPEN lane.
  - `shotEval(team,bx,bz)`: samples `gapAim.samples` target z's across the mouth (off the posts
    via `aimGoalZ`); for each, clearance = z-distance from the straight ball→(goalX,tz) line to
    the nearest BLOCKING opposing man (any live man on a rod between ball and goal — keeper is
    just the last), minus `blockR`. Widest-clearance lane = `best` (ties → centre). Returns
    `{lanes,best,goalX,ox,oz}`, stashed on `r.aimEv` for the hold logic + debug.
  - Aim block: gated on `r.aiIQ && acc>=minAcc`, aims at `best.tz` with reduced spray
    (`sprayMix`) on top; everyone else keeps the old centre+spray verbatim (base behaviour
    unchanged). `r.aimEv` cleared to `null` at the top of each rod's frame.
  - `aimAssist` (stats.js) now bends the struck ball toward `r.aimEv.best.tz` when gap-aiming,
    else centre (z=0) as before — reinforces the gap instead of fighting it. User kicks unaffected.
  - **Hold for a better shot**: a smart ATT/MID with the ball slow + at its feet (`overFoot`) and
    no open lane (`best.clr<openMargin`) keeps possession up to `gapAim.holdMax` (1s), then fires
    anyway (`holdShot` ANDed into the kick gate). Defenders/keepers never hold. Resets when a lane
    opens / ball speeds up / leaves the feet; `holdMax` < dead-ball redrop so it can't deadlock.
  - Debug: **Shot Lanes** panel layer (`#2bff88`). Per gap-aiming rod, a pooled floor line per
    sampled lane (green open / red blocked, `LineBasicMaterial`, `frustumCulled=false`) + a disc
    at the chosen target (yellow good / red covered). Reuses the analytic `r.aimEv` lanes — no
    recompute. `dbgShotLanes` pool built in `buildDebug`, updated in `updateAIVis`.
  - Note: man shift is clamped to `aimMax` (1.2u) so gap-aim BIASES toward the gap; `aimAssist`
    does the finer on-contact bend. Master off-switch `gapAim.gap:false`.

### 2026-07-10
- **AI man-selection skips removed players** (`js/ai.js`). Cannonball kills already set
  `r.removedUntil[mi]` and physics/rods/balls all skip removed men, but `aiUpdate` didn't —
  it could align and swing with a destroyed player (a phantom touch that never connects).
  Added `manLive(r,i)` helper (mirrors the `removedUntil>S.time` test); man-selection loop,
  man-index hysteresis (`r.aiMan`), the `mz` alignment scan, the held-forward side-step
  candidates, and the foot-trap distance loop all skip removed men now. A per-rod `liveN`
  guard early-outs a rod whose men are ALL removed (it can't touch the ball anyway).
  Verified by re-read (sandbox down). Files: `js/ai.js`.
- **Trap action + decision IQ** (`r.act` state — the first named action; more can share it).
  - `CONFIG.diffs` gained `iq` (rookie .15 / pro .55 / legend .9): probability a rod makes
    the 'smart' choice. Rolled per rod on the existing `errEvery` cadence (`r.aiIQ`), so a
    rookie occasionally plays clever and a legend occasionally plays greedy.
  - **Trap** (`CONFIG.ai.trap`, `on:false` restores old behaviour exactly): a raised rod
    (latch engaged) with a ball behind it in `back..front` (−6.5..−0.8 dir-relative), low,
    |v.x| < `maxVX`, speed < `maxSpeed`, aligned within `alignZ`, and `r.aiIQ` set → enters
    `r.act='trap'`: `updateRods` eases the angle to `trap.angle` (−0.55, partial back-raise;
    full raiseA just pops the ball on the drop) at `trap.lerp`; man selection keeps the trap
    foot on the ball; after `settleT` with the ball past `shootFrom`, `kickRod` fires a
    scoop shot. Exits (ball left window / sped up / high / `abortT`) fall back to the raise
    latch. `kickRod` + `resetRodRotation` clear `r.act`. The existing footTrap/drop/kick
    paths are raise- or front-gated so they no-op during a trap — no other logic touched.
  - **Sweet-spot wait** (`CONFIG.ai.waitTta`/`waitMinVX`): a smart rod (same `r.aiIQ`) with
    the ball inbound through the inFront window (tta < `waitTta`, |aiBVX| > `waitMinVX`)
    skips the stretchy inFront poke and waits for the overFoot arrival.
  - `debug.js`: **Trap Zone** panel layer (`#c77dff`) — static per-rod box spanning
    `trap.back..trap.front` × the slide range, hot purple while that rod's `r.act==='trap'`.
  Verified by re-read (sandbox still down). Files: `js/config.js`, `js/rods.js`, `js/ai.js`,
  `js/debug.js`.
- **Safe-lower side-step** (fixes the kicked-and-missed hover-forever deadlock). Root cause
  was two-part: (1) `updateRods`' hold check (`uf`) kept a swung rod at strike angle for ANY
  ball in the underFoot x-window with **no z check** — a ball two men away pinned the rod;
  (2) `aiUpdate`'s man-selection kept re-aligning the raised rod ONTO the ball, so it never
  left the window. The `repositionSlide` config knob described this fix but was `0` and
  never read anywhere (dead). Changes:
  - `rods.js` `updateRods`: `uf` now also requires the ball within `clearZ` of some foot's
    z (`clearZ = footBox.z + BALL_R + AIC.clearMargin`); sets `r.heldFwd` while the hold
    clamp is engaged (cleared in the non-kick branches + `resetRodRotation`).
  - `ai.js` `aiUpdate`: new block right after the user-rod skip (deliberately BEFORE the
    active-pair check so a rod benched mid-hold still escapes): while `r.heldFwd` and the
    holding ball is slower than `repositionSpeed`, slide to the nearest offset where EVERY
    foot is ≥ `clearZ` from the ball in z (candidates = each man's ±clearZ edge + ±maxOff,
    validated against all men), then `continue` — no aiming/kicking while escaping. Once
    clear, `uf` releases and the normal drop finishes the swing.
  - `config.js`: `repositionSlide` (dead) replaced by `clearMargin:0.6`.
  - `debug.js`: new **Drop Sweep** panel layer (`#ff5c8a`) — per-man boxes,
    x = underFootBack..underFootFront (dir-relative), z = ±clearZ around each foot,
    repositioned per-frame with the slide; hot pink while that rod's `heldFwd` is set.
  Verified by re-read (sandbox wouldn't boot). Next planned: trap action (`r.act`,
  partial back-raise `trapA`, `CONFIG.ai.trap`), then decision thresholds.
- **Cannonball fracture-model swap** (`js/fracture.js` + steps in `config.js`, `state.js`,
  `models.js`, `balls.js`, `flow.js`, `main.js`, `index.html`). When a cannonball explodes
  and removes a player, figurines with an `explosionSrc` GLB (irnman, alienTamirok,
  alienGrimlot — three pre-baked "explode & collapse" models in `assets/animations/`)
  now visually fracture and fade out instead of just vanishing. Three imperative
  anti-hitch measures: (1) all three GLBs load once at boot via `loadExplosionModels()` in
  `models.js`, never at explosion time; (2) `warmFractureShaders()` in `fracture.js` clones
  each template off-screen, sets `transparent=true`, and calls `renderer.compile()` before the
  game loop starts so shaders never compile mid-match; (3) `cloneFractureInstance()` sets
  `transparent` before warm-up so the runtime opacity fade is a plain uniform update that can't
  trigger a recompile. Runtime cost per explosion: one `clone(true)`, one `AnimationMixer`,
  one `mixer.update(dt)` per frame — noise next to the existing physics substeps. Figurines
  without an `explosionSrc` keep the original instant-vanish; adding a new figurine is a
  one-line `explosionSrc` addition to its `CONFIG.playerModel.models` entry. Files:
  `js/fracture.js` (new), `js/config.js` (three `explosionSrc` lines + `fractureFadeOut` +
  `fractureFx` debug toggle), `js/state.js` (`S.frac[]`), `js/models.js` (`explosionTemplates`
  map + `loadExplosionModels()`), `js/balls.js` (`cannonballUpdate` → `spawnFracture()`),
  `js/flow.js` (add `clearFractures()` to `startMatch`/`gotoMenu`), `js/main.js` (wires
  `loadExplosionModels`/`warmFractureShaders` into boot chain + `fractureUpdate(rdt)` into
  loop), `index.html` (adds `<script src="js/fracture.js">`).
- **Fracture bugfix**: two issues after first playtest. (1) `CONFIG.debug.fractureFx` had
  been left `false`, which skips loading the explosion GLBs entirely (`loadExplosionModels`
  short-circuits to an empty list) — every kill silently fell back to instant-vanish. Fixed
  to `true`. (2) `spawnFracture()` was orienting the spawned instance with
  `manObj.getWorldQuaternion()`. `manObj`'s parent is the rod's `pivot`, and
  `pivot.rotation.z` carries the *live* kick/raise swing angle (`r.angle`) at the instant of
  impact — copying that world quaternion tilted the whole baked "fall to floor" animation by
  whatever swing angle the rod was at, so debris fell sideways relative to true gravity
  instead of straight down. Fixed to use a fixed team-facing yaw (0 or `Math.PI`, matching
  `p.rotation.y` on the intact figure) instead of the live world rotation — position is still
  taken from `getWorldPosition` (translation only), just not the rotation. `js/fracture.js`,
  `js/config.js`.
- **Fracture bugfix #2 — only one shard animated.** `spawnFracture()` only ever created a
  `mixer.clipAction()` for `tpl.clips[0]`. Baking a per-shard rigid body sim in Blender gives
  each shard object its own Action, so the glTF exporter writes one animation clip PER SHARD
  (`gltf.animations` is an array of ~dozens of clips, not one) — playing only index 0 left
  every other shard frozen in its assembled start pose, i.e. looked like the intact model
  with a single piece breaking off. Fixed to loop `tpl.clips` and `play()` every clip on the
  same mixer. `js/fracture.js`.
- **Fracture team-colour tint**: `spawnFracture()` now recolours the same kit-part meshes
  the intact figure recolours (`activeModel(team).teamParts`, matched by material name,
  `.001`-suffix stripped) to `cfg.redColor`/`cfg.blueColor` on the cloned instance, so the
  debris still reads as the right team instead of falling in its exported base colour.
  Everything outside `teamParts` (skin, visor, etc.) is left as-authored, same as the live
  model. `js/fracture.js`.
- **Fracture bugfix #3 — spawned at the resting "feet" position instead of the rod when
  raised.** `spawnFracture()` read `manObj.getWorldPosition()`, but it's called mid-fixed-step
  from `cannonballUpdate`, BEFORE that step's `updateRods()` runs — so `pivot.rotation.z`
  (and therefore `manObj`'s matrixWorld) could still reflect the previous step, most visible
  when a rod was raised (a ~90° pivot swing) rather than at rest. Replaced with an analytic
  computation straight from `r.angle`/`r.offset`/`r.baseZ[mi]`, mirroring the same
  `fx=r.x+sin(angle)*ARM, fy=ROD_H-cos(angle)*ARM` pattern `collideRod`/`cannonballUpdate`
  already use for the foot position — always exactly current, no scene-graph dependency.
  Scale is likewise computed directly from `activeModel(team).scale*cfg.modelScale` instead
  of `getWorldScale()`. `js/fracture.js`.

### 2026-07-09
- **Arena table rebuilt** (`js/arena.js` rewritten whole + new Blender pipeline). The
  first attempt shipped a broken SDF and a perimeter walker sampling the wrong outline,
  so the swept mesh self-tangled at the goals. Fixed:
  - `arenaSD`: goal-cavity boxes now span `x ∈ [±(L/2−mouthIn), ±(L/2+goalDepth)]`
    (were centred on the goal line with double depth — back wall landed at ±73).
  - Perimeter outline corrected (cavities walk OUTWARD to ±(L/2+goalDepth); the old one
    walked them inward to ±47 and closed the loop with a diagonal). Shared helpers
    `arenaOutline/arenaSamples/arenaProject/arenaProfile/arenaGridGeo` generate the
    visual bowl AND the debug wireframe, and are mirrored in the Blender script.
  - `arenaContact`: wall reflection was divided by ball mass — heavy balls never left the
    wall. Static-geometry reflection is mass-free now.
  - Grid normals were garbage (ny=−1 on the floor rows); now analytic from fillet angle.
  - `arenaClampSpawn` had its inside-test inverted; breaks when safely inside and steps
    by the actual deficit.
  - Bowl owns its materials (`arenaMats` crease/wall/body, geometry groups for the two
    slots) — no longer borrows the classic `wallMat`; themes leave it alone.
  - `applyTable` reparents the shared `fieldMesh` into the visible table group (arena
    used to lose the themed pitch entirely) and repoints `netMats` from `tableNets` per
    table so team colours land on the visible nets.
- **models.js rewired**: table GLBs now `group.add`ed into `primTable`/`arenaTable` (were
  `scene.add`ed — both tables' GLBs rendered at once, never toggled); primitives hidden
  BEFORE the GLB joins. Arena loads from `assets/tables/arena/fuzeball_table_arena.glb`.
  `loadBallModel` tries `assets/tables/arena/fuzeball_ball.glb`, falls back to
  `assets/ball_.glb`; `makeBallModel` shows ONLY the mesh matching the ball type (the
  GLB holds all five, overlapped at origin).
- **Blender pipeline** (each table owns a folder — `assets/tables/arena/`):
  - `tools/build_arena_table.py` (rebuilt from scratch, conventions of
    `build_fuzeball_models.py`: game coords + Y-up→Z-up conversion, bmesh only,
    version-safe emission sockets). Builds `arena_bowl` (swept grid vertex-identical to
    the game mesh; perimeter-U / profile-V UVs; separate `arena_crease`/`arena_wall`
    slots), `field` (fan fill of the fillet-base contour, hidden in-game), `led_ring`,
    `goal_net_left/right`, `goal_frame_l/r`, `table_base`+legs, five ball spheres named
    `classic/fire/cannon/split/golden` (ball-loader name contract), `ref_*`
    player-position markers (rod bars + peg men + translucent slide-range strips —
    never exported), and a `room_*` neon-arcade environment (walls, LED edge strips,
    posters with per-poster materials, arcade cabinets, sign, rug, stools, render
    lights). Saves `fuzeball_arena.blend` (never clobbers an existing one — falls back
    to `*_rebuilt.blend`) and exports first-pass GLBs so the game shows the arena
    immediately.
  - `tools/export_arena_table.py` — baked-copy exporter (same robustness tricks as
    `export_fuzeball_models.py`) → `fuzeball_table_arena.glb`, `fuzeball_ball.glb`
    (each ball recentred to origin), `fuzeball_room_arena.glb`. Skips `ref_*`.
  - Room GLB is NOT yet loaded by the game — wire in later if wanted.

### 2026-07-07
- **League mode v1** (`js/league.js` + `CONFIG.league` + `#league` screen in `index.html`
  + `/* ===== league ===== */` CSS block). 10-team single round robin; player is ALWAYS
  team index 0 and plays live matches as red/team 0. Persisted under localStorage
  `fuzeball_league` (separate from `fuzeball` settings).
  - **Lobby** (main-menu LEAGUE card → `openLeague()`): standings grid (`lgOrder()` sorts
    pts → GD → GF; 3 pts/win, no draws — matches are first-to-5), next-fixture card with a
    Control select (all rods / lock one row via existing `rodLockRole` / spectate), last-round
    results, and the squad upgrade panel (per-rod +buttons spend `up` parts into `bld`, capped
    at `CONFIG.stats.max`).
  - **Live-match bridge `S.lg`** (set only during a league match): flow/rods/ai read
    `teamName(t)`, `teamCol(t)`, `goalTarget()`, `teamDiff(t)` (league forces 'pro' brains —
    builds ARE the difficulty) from `league.js`. `lgPlayMatch` fills `S.teamStats` from both
    teams' builds and calls the normal `startMatch`, so league matches reuse the whole match
    flow. `gotoMenu` clears `S.lg`/`S.teamStats` (abandoning a match = unrecorded, replayable).
  - **Round resolution**: `endMatch` calls `lgRecord(w)` (guarded by `S.lg.rec`): records the
    live score into the player fixture, sims the other four via `lgSim` (zone ratings from
    `CONFIG.league.rate` weights → logistic per-goal probability `simK` → race to `goals`,
    so no draws), awards `upWin`/`upLoss` parts to every team, AI teams auto-spend theirs with
    position-weighted `CONFIG.league.spend` (`lgAiSpend`), `round++`, save. Win screen shows
    "⚙ +N upgrade parts" and swaps Rematch for a Continue button (`btnWinContinue` → back to
    lobby). After the last round `LG.champ` is set; lobby shows the champion and the Reset
    League button becomes "Next Season ▶" (`lgNewSeason(true)` keeps teams/builds/parts,
    resets the table).
  - AI teams start with random budgets (`aiBudget`) spent by the same heuristic, so the league
    has a strength spread from day one; the player starts with `playerStart` parts.
  - Not yet done: league doesn't re-skin kit colours/models in the 3D scene (scoreboard/win
    screen use league names+colours; the table itself keeps the user's kits); quitting
    mid-match lets you retry a fixture; `results` history only drives the Last Round panel.
- **Rod stats layer** (`js/stats.js` + `CONFIG.stats`) — foundation for League mode.
  Six 0-10 stats per rod: `spd` (slide speed), `str` (hit impulse), `acc` (aim),
  `ctl` (contact grip / soft touch), `rea` (AI reaction + kick recovery), `sta`
  (stamina — fatigue ramps over `matchTime`, scaling down spd and slowing rea).
  **Base 5 is neutral: every multiplier is exactly 1, so an unassigned team plays
  identically to before.** Lookup is lazy — `r.stats` → `S.teamStats[team][role|ALL]`
  → base — so league code just fills `S.teamStats` before a match, no build wiring.
  Console test: `S.teamStats=[{ALL:{spd:9,str:9,acc:9,ctl:9,rea:9,sta:9}},null]`.
  Hooks: `rodSpeedMult` (rods.js) ×`stSpeed` (applies to user rod too, stacks with
  freeze); `collideRod` (physics.js, both capsule + foot passes) `jm×stHit`, grip
  =`stGrip`, and `aimAssist` on power-window contacts — bends the outgoing shot's
  heading toward goal centre (pure horizontal rotation, energy-safe, only ABOVE
  base acc, only within `assistCone` of goal, clamped by `assistMax`; applies to
  human kicks too); `aiUpdate` (ai.js) react×`stReact`, err×`stErr`, aim=`stAim`,
  cd×`stCd`. All tuning in `CONFIG.stats`. `stats.js` loads after `state.js` in
  `index.html`. Note: `rea` currently has no effect on the user-held rod (user
  kicks aren't cooldown-gated).
  League plan agreed: 10-team single round robin, statistical sim (stats → zone
  strengths → Poisson goals) for non-player fixtures, upgrade points after each
  round, per-rod builds; AI teams auto-spend with position-weighted heuristics.
  Next: `js/league.js` (teams/schedule/standings/sim/save under `fuzeball_league`
  localStorage key), then lobby/results/upgrade UI.
- **Per-team AI difficulty**: replaced the single `Difficulty` dropdown with two team-coloured
  rows in the Match Setup panel — `#setDiffRed` and `#setDiffBlue` (CSS classes `.lblR` /
  `.lblB` style the label text with the existing `--c0` / `--c1` team colours). `cfg` gained
  `diffRed` / `diffBlue`; the legacy `cfg.diff` is migrated into both per-team fields on load
  (so old saves default both teams to the previous single difficulty) and then re-set to
  `cfg.diffRed` as a "red's level" shorthand. `ai.js:35-40` now reads `D` per rod from
  `r.team`; `rods.js:37` does the same for AI rod slide speed. Effect: set red=Rookie and
  blue=Legend to watch a rookie team play a legend team (e.g. on **AI SHOWDOWN** to
  spectate). Files touched: `index.html`, `css/styles.css`, `js/config.js`, `js/ui.js`,
  `js/ai.js`, `js/rods.js`.

### 2026-07-06
- **Boost powerup repurposed**: was rod speed multiplier (2.55x slide speed),
  now multiplies ball hit impulse by 1.5x (`KICK.boostHitMult`) in `collideRod` — balls
  fly off 50% faster off a boosted team's rods. The speed-multiplier line was removed from
  `rodSpeedMult` in `rods.js`. Label changed from `SPEED BOOST` to `POWER HITS`.
- **Raise now purely distance-based**: `raiseVel` guard removed from `ai.js:81` and
  `config.js:146`. Rods raise whenever `relReal < AIC.raiseBehind` (currently −4.0),
  regardless of ball speed or direction. Fixes defenders blocking their own team's
  clear/collect.
- **Swing-return guard**: `underFootBack` (3.5) / `underFootFront` (1.5) added to
  `CONFIG.ai`. During a kick's drop phase, if any ball is within this asymmetric zone,
  the rod holds at strike angle instead of returning — prevents own-goal swipes from
  returning feet. Implemented in `rods.js:20-21`.
- **Debug manHyst ring fix**: rings were parented to rod pivots (not `dbgAIGroup`),
  so toggling debug off left them visible. `updateAIVis()` in `debug.js` now runs
  all visibility logic with `on && ...` instead of returning early.
- **AI debug visuals panel** (`debug.js` + `css/styles.css`): six toggleable overlay
  layers showing AI decision zones, each with on/off checkboxes in a gold-themed panel
  (top-right, visible only when debug is on via `C`):
  - **gkPad** (orange): floor box at each GK's x, spanning the z-clamp range
    `[-goalHalf-gkPad, goalHalf+gkPad]` (default ±13)
  - **raiseBehind** (magenta): box behind each rod showing the zone where
    `relReal < raiseBehind` triggers the raise decision (−3.5 units deep)
  - **overFoot** (green): box centered on each rod spanning `|Δx| < overFoot` (4.0)
    — the "ball at the feet" reachable zone
  - **inFront** (blue): box ahead of each rod spanning the forward-swing window
    `[inFrontMin, inFrontMax]` (0.2–7.5), direction-relative per team
  - **lowY** (cyan): translucent horizontal plane at `y = lowY` (2) covering the
    field — AI only kicks when the ball is below this height
  - **manHyst** (gold): gold torus rings around the currently selected man's foot
    per active rod, plus a gold dot on the floor at the target slide z-position
  - All per-rod zone boxes span the rod's full slide range in z and are created at
    build time in `buildDebug()`; manHyst rings/dots update per-frame in
    `updateAIVis()` called from `debugUpdate()`. Panel DOM built in `buildAIPanel()`.
  - Colors: gkPad `#ff8c3a`, raiseBehind `#ff2bd6`, overFoot `#7dff8a`,
    inFront `#3d8bff`, lowY `#2af5ff`, manHyst `#ffcf4d`.
- **Foot collision: sphere → oriented box** (`physics.js` + `config.js` + `debug.js`).
  Replaced `footR` sphere with configurable OBB collision (`footBox` half-extents,
  `footBoxOff` centre offset). Foot box now takes priority over rod capsule; men hit by
  the foot box skip the capsule pass — prevents double-resolution at the foot. Box
  centre offset uses `r.kickDir` (team-relative forward direction) instead of `sin(angle)`
  so both teams' boxes shift correctly forward. Debug wireframe updated per-frame via
  `updateFootBoxes()` to match physics world positions exactly. Added `footJitter` config
  (default `0.003` of impact magnitude) to add random velocity perturbation after foot
  collisions — breaks pixel-perfect side-to-side oscillations between adjacent men.
- **Debug overlay additions** (`debug.js` + `index.html` + `css/styles.css`):
  - **Ball speed readout** (`#ballSpeed`): cyan text below camera info, shows
    `S.balls[0].v.length()` in u/s, visible in debug/free-roam modes.
  - **Foot Reach** checkbox: translucent orange box inflated by `BALL_R` around each foot
    — ball centre inside this box = kick collision triggers.
  - **Aligned** checkbox: green floor bars at each man showing ±z alignment threshold;
    nearest man's bar brightens green when `dz < alignSlow`/`alignFast` (ball-speed
    dependent). Uses same logic as the AI's `aligned` check.
  - **Under Foot** checkbox: added to toggle the existing `underFoot` zone boxes.
