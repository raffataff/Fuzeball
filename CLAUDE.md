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

`core.js` (helpers `$`,`clamp`,`lerp`,`rand`) · **`config.js`** (see below) · `screens.js`
(`SCREENS` registry + `showScreen`/`backScreen`/`hideScreens` — every screen you navigate to,
and the layout editor's source of truth) · `audio.js`
(`Au`) · `state.js` (`S`,`freshStats`,`HYPE`) · **`seats.js`** (`S.seats` — every human at the
table: team + claimed devices + held rod; `seatOf`/`seatRod`/`isUserRod`/`setSeatCtrl`) ·
`world.js` (three.js init/build/theme) ·
`balls.js` · `rods.js` · `physics.js` · `ai.js` · `input.js` · `powerups.js` (+ dead-ball) ·
`flow.js` (match flow) · `fx.js` (FX + camera) · `hud.js` · `ui.js` · **`roster.js`** (the Kick
Off lobby — builds `S.roster`, the seat specs a match is started from) · `league.js` · `customize.js` · `models.js` · `fracture.js` · `debug.js` · `training.js` · **`photo.js`** (F1 promo-still studio — camera rig, framing mask, supersampled PNG capture) · `main.js`.

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
- A live browser session may not be available (the Linux sandbox sometimes fails to boot). That
  costs you the **browser**, not **Node** — a remote session has its own container that runs `node`
  either way, and the repo can be staged into it. So "verify by careful re-reading" is the LAST
  resort, not the fallback: the checks below need no browser and catch most of what re-reading misses.
- `node --check <file>` per edited file catches syntax errors. For parse errors and for duplicate
  top-level `const`s across the shared global scope, concatenate `js/*.js` in `index.html` order and
  run it through `vm.runInNewContext` with browser globals stubbed (`document`, `localStorage`,
  `THREE`, `navigator`).
  - **Top-level `const`/`let` are lexical, NOT properties of the context** — `ctx.CONFIG` reads back
    `undefined` and looks like a failure when the script ran fine. Append an explicit
    `;globalThis.__out={…}` line to the source to get values out.
  - `config.js` needs `core.js` prepended (it calls `clamp`).
- A self-contained function can be string-sliced out of its file and rebuilt with `new Function` to
  unit-test its BEHAVIOUR without booting three.js — cheap, and it catches logic that parses fine.
  Pick inputs that would expose the bug: a knob sitting at its default of 1 hides every bug that is
  a stray multiply or a misplaced assignment.

## Coordinate system & table geometry

- **X** = long axis (goal to goal). **Z** = width. **Y** = up. Field surface at `y=0`.
- `F = {L:120, W:68, wallH:8, goalHalf:11, goalH:8.5, goalDepth:9}`.
- Goals sit at `x = ±60` (±L/2). **Left goal net is red, right goal net is blue.**
- Ball into the **right** goal → **team 0 (red) scores**; into the **left** goal →
  **team 1 (blue) scores**. (Easy to get backwards — double-check when touching scoring.)
- Key constants (all live in `CONFIG.physics` — check there, this list has drifted before):
  `BALL_R=1.9`, `ROD_H=7.50` (rod pivot height), `ARM=6.30` (collision arm
  length, pivot→foot), `PRAD=1.0` (player collision radius), `GRAV=250`.
  `FOOT_T=1.0` (foot position along arm, 1=foot). Foot collision is an **oriented box**
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
- **Each SEAT (human) controls one rod at a time** — `seatRod(s)`, see `js/seats.js`. Their team's
  *other* rods are AI-controlled; that's intended (they auto-defend while you focus one rod).
  `isUserRod(r)` = "any seat is holding r". `userRod()` is the PRIMARY seat only and is not a
  substitute for `seatOf(r)` — see the seats entry in the changelog.

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

### Reach zones — which action tests what (`inFootRange` and friends)

Several actions need to answer *"would moving the rod right now hit the ball?"*, and they do **not**
all use the same test. Mixing them up is how own-goals get written. All tuned in `CONFIG.ai`:

| Zone | Extent (dir-relative x, z half-width) | Used by |
|------|----------------------------------------|---------|
| `inFootRange(r,b)` — "footStuck" | `underFootFront` 6.5 ahead, `footRangeBack` 7.0 behind, `footBox.z + BALL_R + clearMargin` ≈ 3.28 in z | vetoes `safeRaise` entry; gates the `clearLane` lift |
| `inFootRange(r,b,underFootBack)` — "latchStuck" | same box, only **2.9** behind | drops the raise latch (`r.behindFlag`) once the ball is genuinely at the feet |
| `heldFwd.xFront/xBack/zMargin` — drop-sweep zone | 5.2 ahead / 2.9 behind, own z margin | post-kick held-forward evade + the 'Drop Sweep' debug layer. **Deliberately decoupled** from the shared values above so it can be tuned alone |
| `overFoot` + `overFootOffset` | 2.2 half-width, shifted 1.4 forward | "at the feet, strikeable" |
| `inFrontMin` / `inFrontMax` | 2 … 6.3 ahead | a forward swing can reach it |
| `sweepClips()` — **swept arc** | the actual rotating foot box, sampled along the rotation | vetoes trap entry |

**The distinction that matters: static vs swept.** `inFootRange` is a *static* rectangle — "could a
foot touch the ball from where everything sits right now". It cannot answer *"does the rotation I am
about to start drag a boot through the ball"*, because a rotating box sweeps a region far larger than
its own footprint. **Any action that turns the rod needs the swept test, not the rectangle.**

**Why the trap can't just use `footStuck`.** `footRangeBack` (7.0) is deeper than the entire trap
catch window (`trap.back` −5.8), so `!footStuck` on trap entry refuses **100%** of traps. That is why
the trap block has no footStuck guard, and why a knock-back was possible until `sweepClips` was added
(see 2026-08-15). The same trap applies to any future action with a window inside that rectangle.

### Two hands per team (`pickActiveRods`) — CONFIG.ai.hands (=3)

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
anti-jitter win. **`hands` bounds the AI ONLY — it is NOT a cap on human players.** Every seat-held
rod is forced into the set and `n` is raised to the seat count whenever a team has more seats than
`hands`, so at 4-a-side all four rods are live and the AI plays none of that side. Local co-op is
capped by the ROD COUNT (`CONFIG.seats.perTeam` = 4), not by this.

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

- `redropBall(b,atX)` relocates the ball to a fresh spot in the face-off zone that SERVES the x it
  died at (`redropZone` / `CONFIG.deadball.redrop.zones[].from`) — same third, jittered inside it.
  It never clamps to the stuck x itself (that just re-lands it in the same dead zone).
- `S.serveAt` carries the same rule to an out-of-play / cannonball restart; a goal kickoff is centre.
- `deadBallUpdate`: global stall (all balls quiet) re-drops after **2.6s**; a single wedged
  ball (multi-ball play) re-drops after **2.2s**.

## Other systems

- **Input:** ←/→ or Q/E switch rod; ↑/↓ or mouse slide; Space/click kick; Shift/right-click
  raise; 1–4 select rod; V cycle camera; M frame profiler; **F1 photo mode**; Esc pause; mouse wheel switch rod;
  **S (during a goal replay only) saves that replay as a .webm** — every OTHER key skips. Wired in the
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
- **Photo mode (`F1`, `photo.js`, `CONFIG.photo`):** promo-still studio. In-match only. Freezes the
  sim AND the wall-clock timers, drops the HUD + every dev panel, and hands the camera to an orbit
  rig (target + dist + yaw/pitch/roll/fov, all on sliders with number boxes). `F` swaps orbit for
  free-look — same rig, camera pinned, target moved. Aspect crop is a letterbox MASK over the live
  view and the capture reproduces exactly what it frames (`phCropFov`). Capture is canvas-only at
  pixel ratio 1 and up to 4× supersample, so the panel is never in the shot and `cfg.renderScale`
  can't cap a still. 6 saved shots persist in `cfg.photoShots`. **`C`** is clean view — panel, crop
  line, mask and guides all down, the state a screen recording needs; **`R`** records the CROP to a
  webm through `js/capture.js` (`CONFIG.photo.record`), auto-stopping after one turntable revolution.
  **`SHIFT+R`** renders the turntable OFFLINE, frame by frame, to a zipped image sequence
  (`CONFIG.photo.seq`) — exact CFR, full resolution, no codec, and it loops seamlessly; that is the
  one to use for footage going into an editor. A CLIP is bounded by `cfg.renderScale`; a STILL and a
  SEQUENCE are not — see the 2026-08-19 entry.
  Cross-module gate is **`S.photo`** (null when off) — `main.js`, `fx.js`, `input.js` and `training.js` test that and nothing else, so
  a missing `photo.js` can't break the game. Same discipline as `S.trn`.

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
men down to block; `redropBall` relocates; shorter dead-ball timers; **two-hands rule** (`pickActiveRods` — only 2 rods/team move at once, the
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

All proxies are scaled instances of three shared unit primitives (`dbgUnitBox`/`dbgUnitSph`/
`dbgUnitCyl`) — so **a debug mesh's size lives in `.scale`**; a layer that animates `.scale` needs
its own geometry (aligned bars, sweet-flash discs). `disposeDebug()` frees the whole overlay.

`toggleDebug()` builds everything once (`buildDebug` → `buildAIPanel` + AI geometries),
then toggles `dbgGroup`/`dbgAIGroup`/panel visibility. `debugUpdate()` runs per-frame:
positions ball + foot-box proxies, calls `updateAIVis()` which updates all toggles
(manHyst rings, target dots, aligned bars, foot-reach boxes) and applies checkbox
visibility toggles. Also shows ball speed (`updateBallSpeed()`) in a cyan readout
below the camera info, and the held rod's angle + dial (`updateRodAngle()`, `#rodAngle`). The panel is built via `document.createElement` in
`buildAIPanel()` — no HTML template changes needed.

## Frame profiler (`M` key, `perf.js`)

Press `M` (anywhere, menu included) for a bottom-right overlay that attributes a SLOW FRAME to a
cause. `cfg.profiler` persists the toggle; tuning is `CONFIG.perf`; `perfDump()` / `perfClear()`
are console-callable. Built for the intermittent sags an average hides.

**Two clocks per frame, and the difference is the point.** `ms` = rAF-to-rAF (the true interval:
our work PLUS compositing, GPU wait, texture upload and any GC between frames). `js` = time inside
`loop()`, split into `sim` / `fx` / `refl` / `rend` by paired `perfMark`/`perfAdd` hooks. **`gap =
ms − js`**: under vsync a healthy gap is idle, but a gap that spikes while `js` stays flat means
the stall is NOT in our code and no amount of optimising the sim will touch it.

Every frame over `spikeMs` (45) or `spikeMult`×the running-typical frame writes ONE line to a ring
of `spikeMax` (14), newest first, each with a heuristic verdict in priority order — **SHADER**
(`renderer.info.programs` grew: a material compiled mid-play), **GC** (heap FELL by `gcDrop` MB;
Chrome-only, `performance.memory`), **GPU/BROWSER** (gap dominated), **SIM** (fixed-step loop
dominated), **RENDER**. Shader/GC are tested first because both ALSO present as a big gap.

- **`renderer.info.autoReset` is turned OFF while profiling** so `draw`/`tri` accumulate across the
  ball-reflection cube pass AND the main pass — a true per-frame total, not just the last
  `render()` call. Restored on toggle-off; `perfFrame` re-clears it each frame so enabling from a
  saved cfg before `initThree` has built the renderer still self-heals. `fpsDiag`'s DRAW line reads
  the same counter and is correct either way.
- **`steps` (`perfSteps`) is the cost-latch signature.** `main.js` banks up to `SIM.maxSteps` (7)
  fixed steps per frame at `sim.hz` 120, so a SLOW frame runs MORE sim than a fast one — `aiUpdate`
  and `physics` both ×7 — and with `physics` substepping to `subMax` (7, logged as `sub` via
  `perfSub`) that's up to 49 collision passes in one frame. **The per-frame sim cost more than
  triples once the frame rate falls**, so a brief trigger can hold the frame rate down long after
  it's gone. `steps` pinned at max while `sim` dominates = that feedback loop, and the real trigger
  may be several seconds in the past.
- **`draw` is where object count is multiplied**: `updateBallReflect` renders the whole scene 6
  more times every `CONFIG.ballReflect.every` (2) frames, and `refl` is bucketed separately so that
  cost is visible on its own.
- Cost when off is one boolean read per hook. Hooks live in `main.js` `loop()` (frame open/close +
  the four buckets) and `physics.js` (`perfSub`) — keep the mark/add pairs sequential and
  non-overlapping if the loop is ever restructured. Panel is built via `document.createElement`
  like `buildAIPanel`, and deliberately carries NO `backdrop-filter` (a blurred layer over the
  canvas would cost frames while we're measuring frames).

### 2026-08-19
- **PHOTO MODE COULD NOT SHOW YOU THE SHOT — the crop border had no off switch, and a screen
  recording was the wrong tool anyway** (`js/photo.js`, `css/styles.css`, `js/capture.js`,
  `js/config.js` new `photo.record`, `js/main.js`, new `tools/photo-record-harness.js`). Reported
  while trying to screen-record the turntable: "even when I hide the grid and the UI, it still
  shows the aspect border."
  - **`.bare` was unreachable.** `#phCrop` carried `border:1px solid rgba(159,210,255,.42)`
    unconditionally, escapable only through a `.bare` class set as
    `!PH.aspect && !PH.thirds && !PH.cross` — and that first term means **the one state with no
    crop to outline**. Pick 16:9 and the line is welded on. Mask, thirds and cross each had a
    checkbox; the border never did, so this reads as a missing control rather than a bug. The
    border is now transparent by default and painted by **`.line`**, a guide with its own checkbox.
    The 1px transparent border stays so toggling the colour can never move the rect.
  - **`C` = clean view**, and it had to be a THIRD state rather than a wider `H`. `H` hides the
    PANEL — you are composing against the thirds and want the controls gone, which is a different
    request from "put nothing on this screen". `PH.clean`/`PH.panelHid` both feed `phChromeSync`;
    `H` no longer pokes `classList` directly, or the two would disagree. The crop LINE is
    deliberately NOT in `G`'s cycle: it marks where the frame is, so it wants to stay up while you
    work; `C` is what takes everything down at once.
  - **THE REAL ANSWER IS THAT A SCREEN RECORDER IS THE WRONG TOOL — the crop is a MASK, not a
    viewport.** Even with perfect chrome you would still be recording the letterboxed desktop at
    window resolution and cropping it by hand. So photo mode records its own: **`R`** arms
    `js/capture.js`'s MediaRecorder over an **off-screen canvas that the framed region of the game
    canvas is blitted into each frame**. One `drawImage` per frame, the encode is off-thread, and
    the webm IS the composition — panel, mask and guides are DOM and cannot land in it, the same
    property that already makes goal clips clean footage.
  - **The blit MUST run in the same task as `renderer.render`** — hence a second hook,
    `phPostRender()`, immediately after it in `main.js`'s loop. The renderer has no
    `preserveDrawingBuffer`, so the drawing buffer is only guaranteed intact until that task ends.
    Exactly the constraint `phSnap`'s `toDataURL` works under, and the reason neither can be
    deferred to a callback. Get this ordering wrong and you record black frames, intermittently.
  - **A clip CANNOT beat `cfg.renderScale`, and the panel says so in pixels.** A still escapes the
    render scale by re-rendering at pixel ratio 1 (that is why stills go through `phSnap` at all);
    a video can't, without re-rendering every frame at a size the compositor then has to swallow.
    So `phRecRect` reports the TRUE output — a nominal '1080p' over a 0.6 render scale is a lie the
    file tells later. **For a stills-grade turntable, set render scale to 1 first.**
  - **A take started with the turntable running stops itself after exactly one revolution** — that
    IS the shot, and 360° at the default 9°/s is a 40s clip. The sweep accumulates from the same
    term `phOrbit` was handed, so changing spin speed mid-take still lands on 360°. A free take
    (spin off) runs until `R` again or `maxSec`. Unlike a goal clip — recorded speculatively on
    every goal and binned unless promoted — this one is always written out: it only exists because
    someone started it, so an exit or a fault saves what it got.
  - **Framing is LOCKED while rolling.** The destination canvas is sized once and cannot be
    re-shaped mid-stream, so the aspect select refuses and says why rather than silently squashing
    the clip.
  - **`clipStart` gained `(cv,opt)` and that second caller exposed a latent race.**
    `MediaRecorder.stop()` is ASYNC: `clipStop` clears `CLIP.live` synchronously but `onstop`
    (`clipFlush`) lands a beat later. With one caller that window was unreachable. With two, a
    `clipStart` inside it would reassign `CLIP.chunks`/`rec` out from under the recorder still
    flushing — and then the OLD recorder's `clipFlush` would read the NEW recording's state,
    binning one clip and breaking the other. New **`CLIP.stopping`** refuses a start until the
    flush lands. Losing one speculative goal-clip arming is nothing; corrupting both is not.
    `audio:false` is the other new option — a camera move has no soundtrack, and the `Au.ui()`
    click fires BEFORE the recorder attaches so it can't be the first thing on it.
  - The **REC dot is the one piece of photo chrome that outlives clean view** — DOM, so never in
    the clip, and with the panel down nothing else could tell you a take is running.
  - **MP4 IS THE DELIVERABLE; WEBM WAS NEVER THE RIGHT DEFAULT** (`CONFIG.capture.mime` and new
    `CONFIG.photo.record.mime`, `js/capture.js` `clipMime(list)`/`clipExt`/`clipContainer`). Asked
    whether mp4 is possible and whether the codec is good enough for promo material and NLEs.
    - **The codec was never the problem — the CONTAINER was.** VP9 at 16–24Mbps over a slow orbit
      is visually fine. But **Premiere, Final Cut and After Effects do not import WebM at all**, and
      Resolve only sometimes, so every clip meant an ffmpeg round trip before it could be cut. The
      recorders write H.264/MP4 just as happily (Chrome 130+, Safari), so webm-first only ever
      served Firefox — which still gets it from the fallback, without taxing everyone else.
    - **`clipMime()` is per-LIST and cached per list.** It was one session-wide cached answer, which
      cannot serve two callers wanting different containers. `clipStart` takes `opt.mime`.
    - **`clipFlush` hardcoded `name+'.webm'` — a latent bug that MP4 detonates.** An MP4 payload
      named `.webm` is precisely the file an NLE refuses and a player half-plays. The extension now
      comes from **the CHUNK's own type** (`ch[0].type`), not from the mimeType we requested: a
      browser may quietly ignore the request, and naming the file off the ASK would mislabel it.
      `CLIP.mimeUsed` carries the fallback, since `clipFlush` runs long after `opt` is gone.
    - **avc1 levels descend through the list** (`640033` High L5.1 → `64002A` High L4.2 → `42E01E`
      Baseline L3.0 → bare `video/mp4`), so a 4K-capable encoder is asked first and an old one still
      lands somewhere. The photo list omits the audio codec — `record.audio` is false, and naming
      one can only narrow what `isTypeSupported` will admit.
    - Photo `bitrate` 16→**24Mbps**: a turntable is slow, high-detail motion that gets SCALED and
      GRADED later, the encode is off-thread, and the file is seconds long. Real-time encoders treat
      it as a target, not a promise.
    - The panel prints the container it will actually use **before** you record 40s of it.
    - **KNOWN, and it is the real quality ceiling — a MediaRecorder capture is VFR.**
      `captureStream(fps)` samples whenever the canvas changes, so a frame the game was late for is
      held or dropped, and the clip carries variable frame timing that Premiere and Resolve both
      handle badly. `renderScale` caps resolution on top. **Neither is fixable in a real-time
      capture**; the fix is to render the turntable OFFLINE, frame by frame, since it is a frozen
      sim plus a deterministic camera orbit and nothing about it needs to happen at wall-clock
      speed. Not built — see the note at the end of this entry.
  - **Not exercised live** (no browser), but `tools/photo-record-harness.js` runs **149
    assertions** with no three.js: `phRecRect` across nine window/dpr/renderScale/aspect
    combinations (centring, overhang clamping, even dimensions, the maxPx downscale, browser zoom,
    a degenerate 40×30 window) asserting every time that the clip's aspect is the aspect that was
    FRAMED; `phFrameSync`/`phChromeSync` class decisions including the exact state that was
    previously unreachable; and `js/capture.js` end-to-end against a stubbed `MediaRecorder` for
    `clipStart()` back-compat, the foreign-canvas path, and the flush-window refusal. Whole chain
    also re-compiled as one script (no duplicate top-level names) and every `$('ph*')` lookup
    audited against the ids the panel creates, and the container suite covers MP4 selection,
    the Firefox fallback, a browser admitting nothing, a browser returning a container it was not
    asked for, and per-list cache isolation; `phSeqSize`/`phSeqPlan` cover the frame budget, the
    maxPx and GL-limit clamps, and that `n × step` is EXACTLY 360 so the loop closes; and the
    zipStore suite walks the central directory back out, following every local-header offset and
    re-checking every CRC against the stored bytes.
    **Still unrun on metal for the sequence renderer specifically**: how long 300 frames at 1440p
    actually takes, and whether a 2160p PNG job trips the heap before `maxBytes` does.
    Still wants a real look at: whether 60fps blitting of a 2560-wide rect costs frames on a weak
    GPU (`record.fps`/`maxPx` are the knobs), and whether Chrome's **fragmented** MP4 output imports
    cleanly into the target NLE — if it ever balks, `ffmpeg -i in.mp4 -c copy out.mp4` remuxes it
    losslessly, and flipping `record.mime` to the webm entries is the other escape hatch. The
    offline renderer below sidesteps all of it and is the one to reach for when the clip is going
    into a timeline; `R` stays the quick grab.
  - **`zipStore` was validated against two INDEPENDENT implementations**, not just re-read: a
    six-entry archive (empty entry, all 256 byte values, nested path, 400KB binary) written by the
    real function and then opened by **python's `zipfile`** (`testzip()` verifies every CRC — all
    bytes identical, method STORE, order preserved) and by **Windows' `Expand-Archive`**. The
    harness keeps a parser of its own for regression, and it has teeth: dropping the name length
    from the offset accumulator (`off+=30+nm.length+n`, the classic silent zip bug) fails 4 of its
    assertions rather than producing a file that merely *looks* fine.
  - **OFFLINE TURNTABLE RENDER — `SHIFT+R`** (`CONFIG.photo.seq`, `js/photo.js` `phSeqStart` and
    friends, `js/capture.js` new `zipStore`). Built after the above: real-time capture is the wrong
    tool for footage that is going into a timeline, and the reason is structural rather than
    tunable. **A turntable is a FROZEN sim plus a deterministic camera orbit, so nothing about it
    needs to happen at wall-clock speed.** Rendering frame by frame fixes all three ceilings at
    once — **exact CFR** (frame i IS yaw i, whatever the machine was doing, against a MediaRecorder
    clip whose held/dropped frames Premiere and Resolve both stumble on), **full resolution**
    (each frame re-renders at pixel ratio 1 like a still, so `cfg.renderScale` stops mattering),
    and **no codec at all** (an image sequence imports natively into every NLE).
    - **The sweep is `360/n` per frame over `n` frames, so the last frame stops one step SHORT of
      the first and the sequence LOOPS seamlessly** — no duplicate frame to trim. Worth knowing
      because it is the one property a turntable is actually for, and rendering `n+1` frames to
      "close the loop" is the obvious wrong move.
    - **Two constraints shape the loop, and they're the same two as everywhere else in this file.**
      The `drawImage` into the output canvas must be in the SAME TASK as `renderer.render` (no
      `preserveDrawingBuffer`); the ENCODE is the slow part and happens after, off that task, via
      `toBlob` on the 2D canvas. And the live renderer size is restored **before each `await`**, so
      the rAF frame that lands in the gap draws the window normally — which is why the turntable
      visibly previews while it renders, for free.
    - **`phTick` returns early on `PH.seq`** and the keyboard/pointer handlers go inert, because the
      render drives the rig itself; a spin or a key nudge landing between frames would corrupt the
      sweep. `phSceneApply()` is re-called INSIDE each frame instead — `fxUpdate` re-shows the
      markers in those same gaps, so without it the hidden cones come back in the output.
      `photoGuard` is deferred too: exiting mid-loop would strand the renderer at the output size.
    - **HEIGHT is the control, not a supersample multiplier** (720/1080/1440/2160) — that is how a
      delivery spec is written — with the width following the CROP's aspect so the sequence is the
      shot that was framed.
    - **JPEG q0.92 is the default and PNG is the option**, which is the whole answer to "I don't
      want a 10GB file": ~8× smaller and visually indistinguishable once the footage has been graded
      and delivered as H.264. The panel prints **frames × resolution × estimated size BEFORE you
      commit**, turns amber past a cap, and disables the button — `maxFrames` 1800 and `maxBytes`
      ~1.2GB are REFUSALS, not clamps, since silently rendering something other than what the panel
      promised is worse than not starting. Default job (1080p JPEG, 10s at 30fps) lands near 130MB.
    - **A CANCEL discards; a cap or a fault keeps what it got.** Deliberately the opposite split
      from the clip recorder: a cancel means "stop, I don't want this", and handing over a 700MB zip
      nobody asked for misreads it — whereas a partial render that hit a limit is salvageable.
    - **`zipStore` (capture.js) is STORE-only and that is not laziness** — the entries are already
      compressed images, so DEFLATE would cost seconds of main thread for a percent. It assembles an
      ARRAY of chunks for `Blob()` rather than one concatenated buffer: a half-gigabyte contiguous
      `ArrayBuffer` is the allocation most likely to fail, and a Blob can be backed by disk. ZIP32
      caps (4GB / 65535 entries) sit far above `seq`'s own.
    - The zip carries a **README** with the frame rate, the loop property and the exact ffmpeg line,
      because a folder of PNGs three months from now does not remember what fps it was meant to be.
    - Progress is its own bottom-centre pill rather than a panel row — a render is usually started
      from clean view, where the panel is down and nothing else could report it. `ESC` cancels.

### 2026-08-17
- **PHOTO MODE (F1) — a promo-still studio, not a debug view** (new `js/photo.js` + `css/styles.css`
  photo block, new `CONFIG.photo`, new `S.photo` gate in `js/state.js`, hooks in `main.js` `loop()`,
  `fx.js` `cameraUpdate`/`fxUpdate`, `input.js`, `training.js`, new `tools/photo-harness.js`).
  Asked for: HUD hidden, rotation + position UI precise enough to hit an exact shot, and a way to
  stop the match **without the pause screen** so stills aren't caught mid-motion.
  - **The freeze had to be a third thing, not a reuse of either existing one.** `#pause` stops the
    world but puts a menu over the shot; training's freeze is the right lever but only holds the
    SIM. A still needs three clocks held: `physAcc` (same lever training pulls, applied after it so
    photo wins), the **wall-clock block** in `loop()` — leave it running and the goal hold expires
    while you compose, a replay opens under the panel, and the countdown serves a ball you didn't
    ask for — and `fxUpdate`'s `rdt`, or a "frozen" goal explosion still drifts apart under the
    shutter. Entering *from* `#pause` is handled: overlay down, phase restored to what it
    interrupted, `togglePause()` again on the way out.
  - **One rig, two modes.** Position is always derived from target + dist + yaw/pitch, so every
    number on the panel means the same thing in both. Free-look is the same rig with the camera
    pinned and the TARGET recomputed (`phLook`) — that invariant (rotating must not translate the
    camera) is the one the harness leans on hardest, because a drift there turns composing into a
    fight. `phAim` re-derives angles + distance the same way, so a Focus button in free-look aims
    without shifting the shot.
  - **The crop preview and the capture agree because of one line, and it isn't obvious.** A three.js
    `fov` is VERTICAL, so rendering the crop's aspect at the same fov keeps the vertical extent and
    *widens* the horizontal — you'd get back scenery the letterbox was hiding. What the mask
    actually does is scale both extents by `(w/W, h/H)`, so the capture needs
    `tan(f'/2) = tan(f/2)·h/H` at aspect `w/h`. Letterbox and pillarbox both fall out of that;
    harness checks it against the mask's own extents at five window/aspect/lens combinations.
  - **Capture is canvas-only at pixel ratio 1** — same reasoning as the clip recorder, and it's what
    lets the panel, mask and guides live on top of the shot while you frame it. Pixel ratio 1 is
    deliberate: a player on `renderScale` 0.6 still gets a full-res still, which the webm recorder
    can't do because it reads the live backing store. `toDataURL` not `toBlob` (no
    `preserveDrawingBuffer`, so the buffer is only guaranteed inside this task); base64 → Blob before
    the download so a multi-MB `data:` URL never goes through an `<a href>`. Everything restores in a
    `finally` and re-renders before the compositor sees the oversized frame, so a refused buffer
    size leaves the live view untouched. `shadowBoost` re-allocates the directional shadow map at
    the still's scale for the one frame — a 2048 map stretched over an 8K still is the single thing
    that reads as *game screenshot* rather than *render*.
  - **Scene hides are written per frame, from LAST in the loop.** `fxUpdate`/`sweetGuideUpdate` own
    the markers and would put them straight back, so `phTick` runs after both. That ordering is also
    what makes the restore free — stop writing and the owners re-show them next frame. Only ball
    meshes and rod pivots (which nothing else writes per frame) are restored by hand, and rods go
    back to `!r.trnHidden` so photo mode can't clobber a rod TRAINING hid.
  - **`S.photo` is the whole cross-module contract** — null or `PH`, tested by four other files and
    nothing else, exactly like `S.trn`. Guards are placed with care: `input.js`'s bails *after* the
    `keys[]` write, because `photo.js` reads that same map for held WASD/arrow moves; only the rod
    ACTIONS must not fire. `gamepadUpdate` bails at the top so a resting stick can't creep a rod out
    of shot. `phTick` self-heals — a match that ends or is quit under the panel drops the mode and
    hands the camera back rather than stranding it on the rig.
  - **Not exercised live** (no browser), but `tools/photo-harness.js` boots `core`+`config`+`state`+
    `photo` in `vm.runInContext` against a stubbed DOM and a minimal `THREE.Vector3` and runs **92
    assertions**: `phWrap`, the offset→angle round-trip, the free-look and orbit invariants, `phAim`,
    the crop rect, `phCropFov` vs the mask's extents, `phOutSize` clamping to the GL ceiling with the
    aspect intact, `phMove`, every panel clamp, the full enter/exit/pause/self-heal lifecycle, scene
    hide+restore, and the saved-shot round-trip through `cfg`. Also scanned for duplicate top-level
    names across the loader chain (none) and audited every `$('ph*')` lookup against the ids the
    panel actually creates. Still wants a real look: the panel's fit on a short window, and whether
    4× is survivable on the weakest target GPU (it clamps, but the clamp is untested on metal).
- **THE REFLECTIONS TOGGLE GATED THE BALL CUBE-MAP CORRECTLY AND IT WAS STILL DEAD — the master
  switch was off and `res` had been left at 8** (`js/config.js` `ballReflect`, `js/world.js`
  `setBallEnv`, `js/ui.js` `setReflect`). Asked whether the Options **Reflections** checkbox also
  turns the *ball* reflections off. It does, at every site that matters — but the answer didn't
  matter, because the feature hadn't been running at all.
  - **The gate is sound, and it's three sites rather than one.** `ballReflectOn()` ANDs
    `cfg.reflections`, and every path respects it: `applyBallEnv` at ball birth (`balls.js`) hands
    the material `null` instead of the cube texture; `refreshBallReflect` walks `S.balls` and strips
    the `envMap` off balls that already exist — so a mid-match toggle lands immediately, not on the
    next serve; `updateBallReflect` early-returns so the 6-face pass stops burning GPU. No change
    needed here.
  - **`on:false, res:8` was an un-reverted experiment.** Neither TUNING.md nor the 2026-07-24 entry
    that introduced the feature records it being switched off, and both still document `res:128` as
    the ball-sized balance. Restored to `on:true, res:128`. **Dropping `res` is the wrong economy**:
    the cost of the pass is the scene WALK (6 faces × object count, plus the shadow pass) and the
    face size is nearly free next to it — 8 bought almost nothing and made the reflection a grey
    mush. If `refl` bites on the `M` panel, `every:3` is the knob to reach for, not `res`.
  - **`setBallEnv` wrote `envMapIntensity` on the CLEARING path too.** With `envMap` null a
    `MeshStandardMaterial` falls back to `scene.environment` — and the same `envMapIntensity` scalar
    still weights that fallback. So switching Reflections *off* stamped the cube map's intensity
    onto the ball's room-bake lighting. Silent while `intensity` is 1; a brightness jump the moment
    that knob moves. The authored value is now stashed in `m.userData.baseEnvI` on first touch and
    put back when the cube map is unbound. Worth more than it looks: **the GLB clone's base material
    is SHARED across ball instances** (unlike the cannonball warn shell, which owns its own), so one
    stale write followed every ball of that type.
  - **The Match Setup mirror skipped the preset bookkeeping.** `ui.js` `setReflect` set
    `cfg.reflections`, `applyRoom()` and `refreshBallReflect()` but never `cfg.gfxPreset='custom'`,
    which its Options twin (`optReflect2`) does. A preset is a BUNDLE of the four heavy knobs, so
    moving one out from under it leaves the dropdown reading **HIGH** over a config that isn't.
    The checkbox itself was never wrong — `syncDisplayUI()` repaints the Display tab from `cfg` on
    every `openOptions` — only the label lied. Now flips the preset to custom and mirrors both
    Options controls, for the case where both panels are already on screen.
  - **Not exercised live** (no browser), but not merely re-read either — see *Verifying changes*,
    which this prompted a rewrite of. `node --check` on all three files; `core.js`+`config.js`
    through `vm.runInNewContext` with `CONFIG.ballReflect` read back as `{on:true,res:128,…}`; and
    `setBallEnv` string-sliced out of the source and cycled on→off→off→on against a material with an
    authored intensity of `0.35` and a cube intensity of `1.4` (deliberately NOT 1, which is what
    hid the bug) — `0.35` restored on the way out, and the redundant second off fired no
    `needsUpdate`, so no spurious recompile. Still wants a real look at a golden ball, and at the
    `refl` bucket now that the pass is live again.

### 2026-08-15
- **PASSES FIRED AT A BALL THAT WASN'T THERE — the kick gate is a snapshot, and a pass lands a fifth
  of a second later** (`js/ai.js` new `swingAngleAt`/`strikeProbe`/`strikeOn` + `footBoxDist` gained an
  optional `foff`, `js/rods.js` new `styleCfg`/`passFaceOK`, `js/physics.js` both `aimAssist` calls,
  `js/stats.js` `aimAssist(b,r,noPass)`, `js/config.js` new `ai.strikeGate`). Reported from play: rods
  triggering a pass with the ball sitting *between* two men and out of contact range, and sometimes
  "registering as a hit" because it caught the side of a player. Normal kicks were fine — which is the
  clue to the whole thing.
  - **The two lags compound, and only the AIMED swing feels them.** `canKick` is
    `(overFoot||inFront) && aligned` — a STATIC snapshot, read off the rod's DELAYED view of the ball
    (`aiView` / `DIFFS.reactDelay`, up to ~0.25s with a poor `rea` and fatigue). That is fine for the
    normal curve, whose boot is on the ball almost the instant it commits. `passShot` contacts at
    `powFrom..powTo` = **0.08–0.20s AFTER** the commit, because a pass is deliberately soft and slow.
    ~0.45s of combined error is ~9 units of ball travel at midfield pace — more than the whole gap
    between two men. The rod was passing to where the ball had been.
  - **`aligned` (`alignSlow` 1.2) is not "in contact range", it is "was in the z-lane a moment ago".**
    `inFront` is a 4.3u-wide x band (2..6.3), and nothing re-checked either at the moment of contact.
  - **`strikeOn(r,ball,style)` predicts instead of snapshotting.** It replays the EXACT swing curve
    `updateRods` will run — `swingAngleAt` is that chain lifted verbatim, so prediction and playback
    cannot drift — advances the REAL ball to each sample (exponential friction integrated as
    `∫e^(−k·s)ds`, ballistic in y, floored at `BALL_R`), advances the men's slide by `r.slideV` clamped
    to the room left to `r.target`, and asks `footBoxDist` whether a live boot is genuinely there.
    Three conditions, **all** required: **reach** (inside `footBoxReach` + `pad`), **face** (the contact
    normal points FORWARD, dir-relative — a z-side clip reads ~0, one from behind reads negative), and
    **centre** (within `zFrac` of the boot's true z half-reach, so no corner touches).
  - **Sampling never starts before `KS.windup`.** During the pull-back the boot travels AWAY from the
    ball; a "contact" there is the backswing brushing it, the opposite of a pass. `lead` can only widen
    the window into the forward sweep.
  - **`pad` is the dangerous knob, not `samples`.** Coarse sampling has to be paid for with a bigger
    `pad`, and `pad` is exactly what lets near-misses through: at 0.55 a ball lofted clean over the
    boot (`d` 2.17 against a true reach of 1.9) still read as a pass. Buy resolution instead —
    `samples:9`, `pad:0.2`. The probe runs only when a pass/trap shot is already being considered, a
    handful of times a second at most, so the resolution is free.
  - **`zFrac:0.5` (±1.63u), not the full 3.25 z-reach.** The full reach IS a real contact — physics
    registers it — but it is a corner touch and the ball leaves sideways off the edge of the boot. That
    is the phantom pass. Sitting just outside `alignSlow` (1.2) means it never fights the kick gate; it
    re-tests the same question on the TRUE ball at the moment of contact.
  - **The second half of the fix is at CONTACT time** (`passFaceOK`, rods.js). A pass swing that clips
    the side or back of a boot still resolves as a hit in `collideRod` — and then collected the pass
    aim-assist, bending a stray deflection at the intended receiver, which is what made it *look*
    deliberate. `aimAssist` gained `noPass`, which suppresses the pass TARGET only (the goal-ward assist
    still runs, and `r.passTo` is left alone so a later clean contact in the same swing still passes).
    **The rod-capsule fallback ALWAYS passes `noPass:true`** — reaching the capsule means the ball
    slipped past the foot box entirely, so it is a graze off the leg by definition.
  - **The normal kick is deliberately NOT gated.** Only styles in `strikeGate.styles`
    (`['pass','trapShot']`) are tested; everything else returns `true` immediately. Clearing a loose
    ball is the AI's most important reflex and it was never the complaint. A refused pass does not
    cancel the swing — it just plays the ORDINARY kick, i.e. the behaviour that was already correct.
  - **Measured, not eyeballed** (headless harness over the states where `canKick` is already true):
    a settled ball (|v.z| ≤ 3) still passes **74–84%** of the time; one drifting at 25 u/s drops to
    **15%** and at 40 u/s to **0%** — which is precisely the whiff case. Coverage is flat across the
    whole `rel` window, so it isn't quietly killing the far end. Every legitimate trapped-ball position
    (`rel` −3..+1, `dz` ≤ 1.6, at any trap angle) is allowed, so the trapShot gate is a pure safety net
    — its call site already demands `tdz < alignZ` 1.1.
  - Debug: press `C` then `L` to trace a rod; refusals log as `GATE:PASS` / `GATE:TRAPSHOT` carrying
    the measurement that failed (`d`, `face`, `dz`, each against its limit, plus `t` and `man`).
  - `strikeGate.on:false` restores pre-gate behaviour exactly.
- **THE TRAP SWUNG ITS OWN BOOT THROUGH THE BALL — the catch had no guard on the rotation that
  STARTS it** (`js/ai.js` new `footBoxDist`/`sweepClips`/`footHolds`/`trapAngle`, `js/rods.js` trap
  angle branch, `js/world.js` rod init, `js/config.js` `ai.trap.sweep`). Reported from play: a rod
  trapping a ball sitting behind a man sometimes knocked it backward instead of pinning it.
  - **Entering a trap does not freeze the rod.** `updateRods` eases `r.angle` to `AIC.trap.angle`
    (−0.5) the moment `r.act==='trap'`, and that rotation is a MOVING box: the foot box sits at rel
    **+0.40** at rest and rel **−2.36** at −0.5, so every catch dragged a boot ~2.8u backward through
    whatever stood in the path. The ball took the impulse along a goal-ward contact normal AND
    `trap.holdGrip` 0.55 lerped the boot's own backward velocity into it — ~24 u/s at the start of
    the ease. Not a bounce restitution could absorb; the grip actively pulled it back.
  - **`inFootRange`/`footStuck` cannot express this, which is why the block was never gated on it.**
    It is a STATIC rectangle whose back depth (`footRangeBack` 7.0) is DEEPER than the whole catch
    window (`trap.back` −5.8), so `!footStuck` on entry refuses 100% of traps. The comment in the
    trap exit branch already said as much ("a footStuck abort killed the trap one frame after it
    began") — the missing piece was a test of the ARC, not of the footprint.
  - **`sweepClips()` samples the swept arc**, rebuilding the real oriented foot box at each sample
    via the new shared `footBoxDist()` — lifted verbatim out of `collideRod`'s foot-box pass so the
    AI's prediction of a contact and the physics that resolves it cannot drift apart. It vetoes only
    when a sample is in contact AND the boot drives INTO the ball along the normal AND that normal
    points goal-ward. Two contact classes stay legal, and they are the traps worth keeping: the boot
    RETREATING along the normal (no shove at all), and an impulse pointing upfield (the ball is ahead
    of the boot, so the tilt closes a lip BEHIND it). The ball is advanced along the arc too
    (`sweepT`), so one rolling into the swing is judged where it will be, not where it is now.
  - **The guard alone would have killed the feature — the fixed target is the other half of the
    bug.** With `trap.angle` pinned at −0.5 the boot ALWAYS has that 2.8u of travel to make, so a
    strict veto left a usable band of rel −0.5…+0.9 — ~1.4u wide, most of it already owned by the
    dribble's first refusal. `trapAngle()` therefore walks outward and picks the DEEPEST angle on the
    way to `trap.angle` whose sweep stays clean, stores it on `r.trapA`, and `rods.js` eases to that
    instead of the config value. Bands now: **rel −2.5…−1.0 → hold at 0** (flat boot — the ball is
    already inside the resting box, so the men pin it and the rod never rotates at all);
    **rel −0.5…+0.5 → the full −0.5 tilt** (boot already behind it, so the tilt closes a lip);
    **deeper than ≈−3 → refused** as genuinely unreachable and dropped to the evade action, which
    slides the rod off it exactly as before.
  - **A flat boot pins fine — the hold was never the angle.** It is `holdRest` 0 / `holdGrip` 0.55 in
    `collideRod`, driven by `holdCfg(r)`, which keys off `r.act` and not off the rotation. The
    dribble has always worked this way (see the note on the deliberately-absent `r.act==='dribble'`
    branch in `updateRods`); the tilt only ever existed to REACH further back.
  - **`footHolds()` killed a phantom trap on the way past.** A ball ahead of the boot (rel ≈ +1) used
    to pass entry, and then the tilt moved the boot AWAY from it — the action held nothing and timed
    out into a `trapShot` at air. The `tdz>holdZ` contact test only checks z, so it never caught
    this. Entry now requires the chosen angle to actually reach the ball.
  - `r.trapA` is declared in `world.js` and cleared at all six exits (four in `ai.js`, plus `kickRod`
    and the full rod reset in `rods.js`) — a stale target would aim the next trap at the last one's
    ball. Refusals log `TRAP-VETO` on the rod tracer.
  - Tunables in `CONFIG.ai.trap.sweep`. **`pad`** (0.15) is the first lever if a knock-back still
    slips through — it widens the near-miss margin; `pushDot` (0.2) sets how head-on a shove must be
    to count; `clampSteps`/`floor` control the angle walk; `on:false` restores the old fixed-target
    behaviour exactly. Measured cost 6.1µs worst case = **0.29% of one core** at 8 rods × 5 men ×
    60fps, and that path only runs on frames where a trap is actually considered.
  - Expect the trap to fire **noticeably less often**, and to keep the boot flat when it does take a
    deep ball. That is correct. If it reads as the rod doing nothing, the lever is `trap.angle`
    itself — shallower (≈−0.35) moves the resting box less and widens the band that gets a visible
    tilt.

### 2026-08-07
- **THE LEAGUE SESSION OWNS THE VENUE NOW, NOT THE MATCH — and the division `skin` was wired to
  nothing** (`js/league.js` new venue block, `js/flow.js`, `js/world.js`, `js/models.js`,
  `js/config.js`). Reported from play: the Sunday League LOBBY loaded and displayed the arcade room,
  then the match cut to the void room the division actually specifies — `room "arcade" loaded` /
  `room freed: arcade` twice in one round of console.
  - **The venue was swapped by the MATCH, so the lobby was always the wrong one.** `lgPlayMatch` set
    `cfg.table/room/pitch` from the division and stashed the player's in `S.lg.prevKit`; `gotoMenu`
    put them back. But the return path is `gotoMenu(); openLeague()` — so coming out of a fixture
    RESTORED the player's Kick Off room (a GLB fetch), the lobby rendered in it, and the next Play
    FREED it again for the division's. **One load + one free per round, forever**, and the lobby you
    spend a whole season on advertised a venue you never play in.
  - Now `lgVenueEnter` / `lgVenueExit` (top of league.js): the venue goes on when you walk into the
    lobby or the bracket, and comes off when you leave league land. A season is ONE swap in and ONE
    swap out. `LGV` parks the player's own meanwhile.
  - **The restore is DEFERRED one tick and that is load-bearing.** Every return-to-lobby path
    (`lgReturn`, `cupReturn`, both forfeit branches) is `gotoMenu(); openLeague()` in one synchronous
    run, and gotoMenu's screen change fires the exit through `SCREENS.league.onHide`. An immediate
    restore would tear the division's room down and re-fetch the player's, only for the lobby to swap
    straight back — i.e. exactly the churn, just moved. `lgVenueEnter` cancels the pending timer, so
    a quit-to-home restores and a return-to-lobby doesn't.
  - **`lgVenueEnter` must sit ABOVE `openLeague`'s season-end early-return** for the same reason —
    that's the cancel, and skipping it would let the restore land behind the summary overlay.
  - **`CONFIG.league.divisions[].skin` had NO READER.** `curSkin(id)` resolves `cfg.skins[id]` →
    `defSkin`, and nothing ever wrote the division's choice in, so a league match wore whatever
    livery was last picked in Kick Off. `lgDivVenue` reads it; `LG.divs[]` freezes it at season
    creation (like table/room/pitch already were) and `loadLG` backfills it for existing saves.
  - **A venue SPEC and a venue SNAPSHOT are different shapes on purpose.** A spec carries one `skin`
    id and touches only ITS table's livery; the snapshot carries the whole `skins` map. A spec that
    wrote the map would wipe the player's choice for every other table.
  - **`saveCfg` now writes the PARKED venue, not the live cfg** (`lgVenueHeld`). The 2026-07-16 entry
    flagged this as a known gap when the window was one match; it's now the whole lobby, and without
    it touching any Options control from a league pause menu makes that fixture's table/room/pitch/
    skin the player's permanent Kick Off setting. `typeof`-guarded because config.js parses first.
  - **`prevKit` is KIT ONLY now** (colours, models, special, power). `gotoMenu` calls `lgVenueExit()`
    as the backstop for quit-to-home.
  - **The cup's random pitch is PINNED TO THE TIE** (`cupVenue` → `tie.pitch`, persisted). It was
    re-rolled inside `cupPlayTie`, so the bracket screen and the match it starts disagreed, and
    re-opening a bracket re-rolled it again.
  - Both kickoff gates collapse from `tableDone`+`roomDone` to one `venueDone` off
    `lgVenueEnter`'s cb. It's still a GATE (a division can force a table never opened, and Play can
    beat the lobby's fetch) but resolves synchronously in the normal case.
- **A MISSING ROOM GLB WAS RE-FETCHED ON EVERY SCREEN CHANGE, AND ITS FALLBACK NEVER RAN**
  (`js/models.js` `roomFailed`/`roomHasGlb`, `js/world.js` `applyRoom`, `CONFIG.rooms[].backdrop`).
  Found alongside the above: `nafuzeball_room_void.glb 404` once per venue change.
  - `ensureRoom` cached success but **not failure**, so a room pointing at a file that isn't there
    re-issued the request every single `applyRoom`. Latched in `roomFailed` (session-scoped — a
    reload re-tries, so dropping the file in during development still works).
  - **`applyRoom`'s "no backdrop" fallback tested `rm.glb`**, which is still set on a room whose file
    is absent — so it never engaged, and the console line saying "using shared backdrop" was a lie.
    `hasGlb` was also captured ONCE before the load, so the reveal path couldn't correct it either.
    Both are now recomputed inside `show()` off "is a backdrop actually on screen", which also means
    the shared ground+crowd stand in WHILE a room GLB downloads instead of leaving a hole.
  - **New `CONFIG.rooms[].backdrop`**: `false` = no stand-in, just bg + fog. Set on `open` (Void),
    because that room's current look — nothing — was an ACCIDENT of the broken glb path, and the
    fallback fix would otherwise have silently put a ground plane and a crowd in the void. Now it's
    stated rather than emergent. Every other room defaults to standing the backdrop in.
  Verified by re-read (sandbox wouldn't boot — session disk missing). NOT yet exercised live.
- **A RE-DROP NOW COMES BACK IN THE THIRD IT DIED IN — holding the ball was a free 60u of territory**
  (`CONFIG.deadball.redrop.sameThird` + per-zone `from`, new `redropZone` in `js/powerups.js`, new
  `S.serveAt`, `js/balls.js`, `js/flow.js`, `js/debug.js`). Reported from play: a keeper or defender
  who smothers the ball against his own line loses nothing by it. He takes the whistle and the re-drop
  picked one of the three face-off zones AT RANDOM — so **two times in three the punishment for being
  pinned in your own corner was the ball reappearing further up the table than he could have kicked
  it**, and the strongest move from a dead position was to stop playing.
  - **The zones were already the three thirds** (x −30 / 0 / +30, i.e. the centre of each); the only
    thing missing was the mapping. Each zone gained **`from:[x0,x1]`** — the stretch of pitch it
    serves — and `redropZone(x)` returns the zone containing the death x. Expressed as explicit
    ranges rather than nearest-centre because those are NOT the same partition: nearest-centre puts
    the boundaries at ±15, and the thirds of a 120-unit table are at ±20. Ranges also mean a fourth
    zone is a pure config edit.
  - **The outer ranges run to ±999 on purpose.** A ball can die behind a goal line (out of play, or
    resting on the goal roof), so the catchment has to extend past the table or the one case that most
    needs resolving falls through to the random fallback. Same reason `redropZone` falls back rather
    than throwing: it's on the code path a stuck ball depends on to become playable again.
  - **The drop is still JITTERED inside the chosen zone** (`spread`, plus the full ±`redrop.z` in z).
    This is not a restoration to where the ball was held — it's a face-off at the nearest contested
    spot, which is the point. Nothing about the drop mechanics or the fall-time back-solve changed.
  - **OUT OF PLAY IS THE SAME EXPLOIT BY ANOTHER ROUTE, and it does NOT go through `redropBall`** —
    it removes the ball and re-serves via `serve()` after the hold, which drops centre. So belting it
    off the table from your own corner was strictly BETTER than holding it: same territory, no whistle
    to sit through. `outOfBounds` now parks the exit x in **`S.serveAt`** and `serve()` consumes it
    through the same `redropZone`. Cannonball detonation (`balls.js`) does likewise — sitting on the
    fuse in your own corner is the identical trade with a timer attached.
  - **`S.serveAt` is set only by the ball that ENDS the rally** (inside the `!S.balls.length` branch).
    In multi-ball the others are still live and their exit says nothing about where play stopped.
    It's read in `outOfBounds` from **`b.cur`, before `removeBall`** — `b.m.position` carries the
    render interpolation and the mesh is freed a line later.
  - **A GOAL KICKOFF IS DELIBERATELY UNTOUCHED and must stay that way.** `serve()` is the single
    entry for every restart, so the ONLY thing separating a kickoff from a restart is `S.serveAt`
    being null — hence it's consumed in `serve()` and reset in `startMatchNow`. Leak it and conceding
    would restart play in the scorer's attacking third, which is the exploit inverted.
  - **Made visible, or the rule is unfalsifiable by eye**: the existing **Redrop Zones** debug layer
    (`C`) gained a thin bar per zone along the near touchline spanning its `from` range, so the third
    boundaries are readable. Watching a ball re-appear in the middle zone otherwise tells you nothing
    about whether it was SENT there or rolled a 1-in-3. Pushed into `dbgAIRedrop`, so the existing
    visibility line covers it.
  - `sameThird:false` restores the old random pick everywhere, including the serve path.
  Verified by re-read (sandbox wouldn't boot — session disk missing). NOT yet exercised live.
- **THE PRE-MATCH TAPE'S PORTRAITS WERE NEVER PRELOADED — they were requested at the frame the
  splash appeared** (`CONFIG.league.tapeReadyCap`, `js/league.js` new `primeMatchTape`/`tapeDwell`,
  `js/config.js`). Reported as "it always swipe loads when the screen loads", which is exactly the
  shape of a big PNG streaming top-to-bottom into a fixed box.
  - **`renderLgTape` builds the portraits as raw `<img src>` inside an `innerHTML` string**, so the
    first byte of `assets/renders/render_<x>_cycles.png` is requested at the instant `#lgTape` is
    un-hidden. `.lgFigBox` is a fixed 600×700, so there's no layout jump to disguise it — you watch
    the image arrive. The lobby primed the shatter GLBs (`primeMatchExplosions`) and the table/room,
    and nothing at all for these.
  - **The scout panel does NOT already cover this, which is the easy wrong assumption.** `renderLgScout`
    runs `mugImg` on the SAME figurine, but that loads `render_*_MUGSHOT.png` — a different file — so
    the tape's `_cycles` render stayed cold no matter how long you sat in the lobby.
  - **`primeMatchTape(idA,idB)` sits beside `primeMatchExplosions`** in `openLeague` and `renderCupFix`,
    and takes figurine model IDS for the same reason that one does (`cfg.modelRed/Blue` aren't the
    league teams until `lgPlayMatch`, so `activeModel()` reads the menu figurines in a lobby).
  - **Images are HELD in `TAPE_IMG`, not fired and forgotten** — a live reference keeps the decoded
    bitmap, so the tape's own `<img>` paints from cache with no second decode. **Bounded to the two
    figurines of the NEXT match**: each decoded portrait is several MB, and a season of past opponents
    accruing in that map is a slow leak that nothing would ever free. The map is rebuilt per call and
    anything not in the new pair is dropped; re-entering the lobby re-issues nothing.
  - **`tapeDwell(cb)` starts the `tapeT` beat once the portraits can PAINT, not when the tape is
    revealed.** Without it the 3s dwell was spent watching the PNG arrive and then cut to kickoff at
    the moment the screen finally looked right — `tapeDone` was a bare `setTimeout` with no relation
    to the images. Uses `img.decode()` (resolves when the bitmap is ready with no main-thread hitch,
    rejects on a broken image → caught, so a figurine with no render is a clean skip).
  - **`tapeReadyCap` (2.5s) is a hard ceiling and is load-bearing** — a stalled or 404 render must
    never be able to hold up a match start; past the cap the tape runs exactly as it did before.
    `tapeReadyCap:0` restores the old unconditional timer.
  - **`tapeDwell` returns a CANCEL fn and the click-to-skip path must call it.** It kills BOTH timers
    and disarms the pending decode handler — without that, a skipped tape re-fires `go()` a beat later
    against whatever screen came next.
  - Worth knowing generally: **`RENDER_MAP`/`modelRender` fall through to the raw id**, so a key with
    no branch in that chain yields `render_<id>_cycles.png` and 404s silently (`manStumpy` is such a
    key; harmless only because it isn't in the live roster). And `womanSasha`/`womanAndroid` are
    commented out in `CONFIG.playerModel.models` while their renders exist on disk.
  Verified by re-read (sandbox wouldn't boot — session disk missing). NOT yet exercised live.
- **REPLAYS HAVE SOUND NOW, AND CAN BE SAVED AS A .webm** (`CONFIG.replay.audio`,
  `CONFIG.replay.save`, new `CONFIG.capture`, new `js/capture.js`, `js/replay.js`, `js/audio.js`,
  `js/input.js`, `index.html`, `css/styles.css`). Two asks, one entry, because the save only has a
  soundtrack because of the first half.
  - **THE REPLAY WAS SILENT BECAUSE THE SIM IS FROZEN.** Playback re-poses ghosts and pivots from
    the ring buffer; nothing calls `physics`, so nothing calls `Au`. The crowd bed kept running
    (`Au.tick` gates on `phase!=='menu'`, and `'replay'` isn't) which is exactly why it read as an
    audio *dropout* rather than as a deliberately quiet moment.
  - **The rally's sounds are logged by TAPPING `Au` ITSELF**, not by instrumenting the ~10 call
    sites across physics/fx/powerups. One place to maintain, nothing added to the physics hot path
    beyond what's already inside those methods, and a sound added later is recorded for free.
    `replay.js` wraps `kick/wall/post/power/boom` at load (it parses after `audio.js`). The tap is
    gated exactly like `recordReplay` **plus `!RP.on`** — without that, the sounds playback re-fires
    would log themselves straight back into the buffer.
  - **Deliberately NOT tapped: `whistle`, `beep`, `ui`, `goal`.** Those are match chrome, not
    footage — a replayed countdown beep is nonsense. The horn is re-fired separately at the
    freeze-frame (`audio.goalSting`) and at NORMAL pitch: it isn't footage, it's the celebration
    landing, and a tape-slowed horn reads as a fault rather than as drama.
  - **Events store an ABSOLUTE step index (`RB.tot`), not a ring slot.** A slot gets overwritten as
    the ring wraps, which would silently re-point an old event at new footage. `rbAbs(j)` maps
    logical step → abs, and `replayCut` resets `RB.tot` **and** the sound log together — abs
    restarts at 0 on every serve, so a surviving event would fire against whatever footage landed
    on its old number. The entry also keeps the ball type's audio-config OBJECT by reference (a
    preallocated slot array, no growth), so a replayed fireball still sounds like a fireball.
  - **Sounds are logged with `RB.tot` BEFORE `recordReplay` increments it** — they fire inside
    `physics()`, which runs earlier in the same fixed step, so `RB.tot` is still the index of the
    step about to be written. If that ordering in `main.js`'s loop ever changes, this moves with it.
  - **Pitch: new global `Au.rate` / `Au.vol` multipliers**, applied by the two primitives (`beep`,
    `noise`) and by `post`. `rate` is a TAPE-SPEED multiplier — frequencies scale with it, every
    duration scales inversely, so `rate<1` is a slower, deeper, softer-attack version of the SAME
    hit rather than a different sound. It tracks the playback rate, so a slow-mo strike lands as a
    deep thud instead of clattering over slowed pictures. Set and reset around the fire loop in
    `replaySndUpdate`, plus a belt-and-braces reset in `replayEnd`/`replayAbort` — they're global,
    and a skip landing mid-loop must not leave the next rally detuned.
  - **Two traps in that multiplier, both handled.** `post` applies `vol` only to its own oscillator
    envelope, because the `this.noise(...)` call at the end applies `vol` itself — the obvious
    single `v*=this.vol` gives `vol²` on that one channel. And `R` is guarded `>0` in all three
    functions: every duration is DIVIDED by it, and a zero puts an Infinity into a buffer length
    and throws from deep inside WebAudio. `beep`'s `slide` scales with pitch, not with time — it's
    a frequency delta, not a duration.
  - **Tuning:** `pitch` (0.85) is the shoot-first knob — 0 = normal pitch throughout, 1 = full tape
    slowdown. Note the whole replay runs at `speed` 0.7, so even at CRUISE the pitch sits at ~0.75;
    that's correct and consistent, but it's why the replay sounds "lower" everywhere, not just at
    the end. `pitchMin` (0.3) is the floor — at 0.3 a kick's 95Hz body lands at ~28Hz, i.e. felt
    rather than heard, and the noise burst carries the hit; raise it toward 0.45 if strikes stop
    reading. `audio.on:false` restores the silent replay exactly.
  - **SAVING: `js/capture.js`** — a MediaRecorder over the game canvas plus a second tap off `Au.mg`
    into a `MediaStreamDestination` for the audio track (a tap, NOT a re-route: live audio is
    untouched). Generic; nothing in it knows what a replay is.
  - **RECORD-THEN-PROMOTE, not record-on-demand** (owner's call, and the right one). A player only
    knows the goal was worth keeping AFTER watching it, and a replay is over in ~5s — recording from
    the keypress would only ever capture the tail you already saw. So the recorder is armed on the
    replay's FIRST FRAME and `S` promotes the whole clip; an unpromoted recording is dropped on stop.
    **The cost is one encode per goal whether or not anyone saves it** — Chrome encodes off-thread so
    the main-thread share is the per-frame canvas copy, and it only runs while the sim is frozen, but
    `CONFIG.replay.save.on:false` is the first thing to try if a weak machine sags on replays. The
    profiler (M) will attribute it to **GPU/BROWSER**, not SIM.
  - **The canvas stream is created PER RECORDING and its video track STOPPED again in `clipFlush`.**
    Not tidiness: a live `CanvasCaptureMediaStreamTrack` makes the browser copy the framebuffer at
    its capture rate for as long as it exists, whether or not anything consumes it — holding one
    open for the session would tax every rally to serve the two seconds a year someone saves a clip.
    Stopping it any EARLIER than `onstop` truncates the tail of the clip. The AUDIO track is the
    opposite case (permanent destination node, free when idle) and is reused.
  - **The clip is the CANVAS ONLY.** Letterbox bars, the REPLAY tag, the save hint and the whole HUD
    are DOM, so what lands on disk is clean gameplay footage with no chrome burnt in. That's a
    feature for sharing, and it's also why the "CLIP SAVED" confirmation is a `toast()` fired in
    `replayEnd` AFTER the chrome comes down — `body.replayOn` fades `#hud` (which owns toast) to
    zero for the whole replay, so anything announced earlier is announced to nobody.
    Corollary worth knowing: capture reads the canvas BACKING STORE, so **`cfg.renderScale` is the
    clip's resolution** — a player on 0.6 render scale saves a 0.6-scale video, and no amount of
    `capture.bitrate` recovers it.
  - **`S` is tested BEFORE the skip in both input paths.** Every other key/click skips a replay, so
    without that ordering the save key would be swallowed by the skip and the clip would end at the
    moment you asked to keep it. Same on the pad: **Y** (`save.pad` 3, already in the polled button
    list) saves, A/B/Start still skip. Save is deliberately not `didSkip`-guarded — it's idempotent.
  - Everything in capture.js is best-effort and **nothing in it may throw into the game loop**: no
    MediaRecorder, no `captureStream`, no supported codec or a recorder that throws → `clipStart`
    returns false, `clipReady()` stays false, the hint never renders and the replay plays exactly as
    it did before. A hard failure latches `CLIP.fail` so the session stops retrying once per goal.
  - Files land in the browser's download folder as
    `fuzeball_goal_<team-slug>_<date>_<time>.webm` (`clipSlug` flattens a player-typed team name
    down to something a filesystem will take). Container/codec = first of `CONFIG.capture.mime` the
    browser admits, resolved once per session.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised live — in particular the pitch
  numbers are a first cut against a real rally, and clip capture has not been run in an
  Electron/Steam wrapper, only reasoned about.

### 2026-08-05
- **REPLAYED BALLS NOW ROLL — the recorder stores POSITION ONLY** (`CONFIG.replay.roll`,
  `js/replay.js`). Reported as "the texture doesn't rotate with the ball in replays, it's fine in
  play". Both halves of that are exactly right and the reason is that they're two different meshes:
  the live ball rolls in `physics.js` (`b.m.rotation.z-=v.x*dt/BALL_R`, `.x+=v.z*dt/BALL_R`, once
  per sim step), but a replay draws POOLED GHOSTS re-posed from the ring buffer, and the buffer
  holds `{x,y,z}` + a type byte per slot and nothing else. So the ghost was handed a position every
  frame and never a rotation — a ball skating down the pitch with its print frozen. Invisible on the
  procedural sphere, obvious the moment the GLB ball with a print on it is the active mesh.
  - **Orientation is RE-DERIVED from the path, not recorded.** Rolling without slipping makes
    orientation a pure function of the ground track, so the buffer doesn't need to grow (recording
    it would have been +3 floats × 4 slots × ~840 steps ≈ a second 40KB buffer for something
    reconstructable). `replayRoll(g,dx,dz)` turns the ghost about `(dz,0,-dx)` by `dist/BALL_R` —
    **the same axis convention as the live ball** (+x travel turns about −z, +z about +x; derived
    from `v = ω × R·ŷ`), and horizontal-only for the same reason, so a replay matches what was just
    watched.
  - **Driven by DISTANCE, not time** — which is what makes it free under the speed ramp: slow-mo
    shortens the per-frame step, so the spin slows with the ball without reading `RP.t` at all.
    A `hold` freeze-frame moves 0 and therefore spins 0.
  - **Accumulated as a world-axis QUATERNION, deliberately not the live Euler pair.** Live gets away
    with Euler because it's fed a fresh axis every step from a mostly-straight track; a replay
    stacks many small turns about a curving one, which is where Euler accumulation starts to
    tumble instead of roll. `Quaternion.premultiply` = the same thing `rotateOnWorldAxis` does.
  - **`rqBase` matters if you touch this**: the roll is applied ON TOP of the GLB clone's authored
    root quaternion (`replayRollSet`), never in place of it. Live play gets this for free by using
    `-=`/`+=` on the existing rotation; the replay assigns, so a baked root rotation would be
    silently discarded. The sphere fallback has no base and takes the identity path.
  - Reset lives in `replayGhostHide` (which `replayStart` runs over every ghost), and it clears the
    MESH pose as well as the accumulator — otherwise `roll:false` wouldn't be a true off-switch
    after a session with it on: a parked ghost would keep its last rolled pose and open the next
    replay crooked.
  - Applied before `g.prev` is advanced, since the trail-speed test below reads the same delta.
  Verified by re-read (sandbox wouldn't boot). `roll:false` restores the old frozen-texture
  behaviour exactly.

### 2026-08-04
- **STAMINA IS TWO CHANNELS NOW — the clock, plus what each rod has actually DONE**
  (`CONFIG.stats.kickFat`, `js/stats.js`, `js/rods.js`, `js/world.js`, `js/flow.js`, `js/training.js`,
  `js/debug.js`). Fatigue was a flat tax: `stFat` read `S.matchTime` and the `sta` stat and nothing
  else, so the keeper who touched the ball twice tired at exactly the rate of the midfield that
  played the whole match. Every rod now banks its OWN exertion per swing.
  - **`r.exert` — banked in `kickRod`, bled off in `updateRods`.** `kickRod` is the ONE place every
    swing in the game passes through (human, AI, shot, trapShot, pass), so the hook is a single line
    and nothing can swing without paying. Deliberately NOT charged per kick style: a pass is as much
    of a swing as a strike. Recovery ticks beside the rod's other cooldowns, i.e. in exactly the set
    of phases where a swing can happen, so both halves of the channel run on one clock.
  - **`weight` SPLITS `fatMax`, it does not stack on it.** Clock owns `(1-weight)` of the budget,
    exertion owns `weight`. The worst case is therefore still `fatMax` and the existing balance stays
    bounded — **what actually changed is that a QUIET rod fades LESS than it used to**, which is the
    whole point. `weight:0` / `on:false` restores the old ramp byte-for-byte. Numbers at base sta
    over a 180s match: everyone used to land on 87.5%; now an idle rod holds 94.4% and a hard-worked
    one still reaches 87.5%. At a league sta of 0 it's 88.75% vs 75%. **To widen the spread raise
    `fatMax`, not `weight`** — weight only moves where the same budget is spent.
  - **Exertion is deliberately NOT scaled by `sta` a second time.** `stFat`'s outer `(1 - sta/max)`
    already gates BOTH channels, so a sta-10 rod is immune to swing drain too and `sta` stays the
    single stamina knob. Scaling the accumulator by it as well would double-dip and make the
    tuning unreadable — worth stating because it's the obvious "improvement" to add later.
  - **`r.exert` is cleared in `startMatchNow` and NOWHERE ELSE — specifically not in
    `resetRodRotation`**, which is where a per-rod field instinctively goes. That function runs on
    every goal, dead ball and out-of-play, so putting it there would wipe the accumulation several
    times a match and pin the channel near zero — the failure mode would look like "the feature does
    nothing" rather than like a bug. There's a comment at the reset site saying so.
  - **`userDrain:false` by default — human-held rods accrue nothing.** Not squeamishness: a human
    swing isn't cooldown-gated the way an AI's is (only the swing length caps the rate, ~3–4/s), so
    a player mashing kick out-swings every AI on the table several times over and nerfs their own
    rod within seconds. Turning it on makes mashing self-punishing, which is a defensible design
    choice but a REAL balance decision, so it isn't made silently. `seatOf(r)` is the test.
  - **`cap:1.25`×`full` bounds the accumulator.** Unbounded growth would have a rod sitting maxed for
    minutes after a busy spell in a long match; a small overdraft still means a hammered rod doesn't
    come back the instant it stops swinging.
  - **Made VISIBLE, because otherwise it isn't.** This only ever shows up as a rod feeling slightly
    slower than it did twenty swings ago, which is unverifiable by eye. Training panel's rod block
    gained a `stam` (live `stFat` %) + `exert` (raw / `full`) line, and the kick log's `★KICK` line
    carries `ex=` and `fat=` — `dbgKickGate` runs BEFORE `kickRod`, so `ex` is the count going INTO
    that swing and you watch it step up one per kick and bleed down in the gaps.
  - Tuning: **`full` (30) is the knob to reach for first** — how many swings it takes to notice.
    Reaching it NET over 180s takes ≈ `full + recover×180` ≈ 52 swings, i.e. heavy involvement, not
    something an idle keeper wanders into. Lower it if the effect reads as invisible; raise it if
    busy rods all bunch at the ceiling and stop differentiating from each other.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised live — `full` is a first-cut guess
  at a real match's swing counts, so that's the first number to check against a played-out match.
- **SETTINGS-PANEL ROW SPACING WAS 30px, AND THE RULE ISN'T ON THE PANEL** (`css/styles.css`).
  Reported as "really large gaps between each row and I can't find its styling" — same shape of
  problem as the Last Round one below: nothing on `#lgSettingsPanel` sets spacing, so searching
  for the panel finds nothing. It comes from `.lgSide>.panel`, which makes every league/cup side
  panel a **flex column with `gap:14px`** — a rule that reads as sizing.
  - **Flex changes `.row{margin:8px 0}` in two ways at once**, which is why it lands so far off:
    the gap is ADDED to the margins rather than replacing them, and **adjacent margins never
    collapse inside a flex container**, so both the 8px bottom and the 8px top count.
    14 + 8 + 8 = **30px**, against **8px** for the identical markup in Kick Off's Match Setup
    (a plain block `.panel`, where those two margins collapse into one).
  - Fixed with **`#lgSettingsPanel,#cupSettingsPanel{display:block}`** — not `gap:0`, which would
    have given 16px and still been double. Nothing in those panels needed the flex column: `.row`
    is its own flex box and `.lgPlayBtn`'s `width:100%` fills a block parent the same way `stretch`
    did. **The gap stays on every other `.lgSide` panel**, where it separates genuine blocks (the
    fixture line from the round list, a heading from its table).
  - Worth knowing generally: **a flex/grid container silently changes the margin model of every
    child**, so a shared row class can't be assumed to space the same in two panels. Both bugs
    this week were "the rule governing this element isn't written on this element".
- **PANEL TYPE SCALE (`:root` tokens) + the Last Round panel had a DEAD RULE** (`css/styles.css`,
  `index.html`). Reported as "I can't find the styling for Last Round, and it looks odd next to
  Next Match". Both true, and the second followed from the first.
  - **`.lgSide>.panel.lgLast{…}` never matched anything.** `#lgLastPanel` is
    `class="panel hidden"` — there is no `lgLast` class on it, and never was. So the panel had no
    rule of its own, which is exactly why searching for one turned up nothing. Deleted rather than
    repaired: its `height:100px` would have clipped a 5-fixture round anyway. **Worth checking for
    generally — a class selector whose class isn't in the markup fails silently and looks like a
    styling gap, not a bug.**
  - **The two fixture lists render IDENTICAL `.lgFixSm` markup and looked different** because only
    `#lgRound` had a wrapper (13px, uppercase, tracked, dim) and `#lgLast` had none. Now a shared
    **`.lgFixList`** class on both; `#lgRound` keeps ONLY its top-border separator (it's a
    sub-section of the Next Match panel; `#lgLast` is a whole panel body). The readable `body`
    treatment won over the uppercase one — Last Round carries SCORES, and dim uppercase fought them.
  - **`:root` now carries a type scale and a five-step text ramp** — `--fs-micro/label/head/num/
    body/lead`, `--tr-micro/label/head`, `--tx-dim/mute/body/strong/bright`. The league block alone
    had **nine hand-tuned font sizes and eight greys**, set per element, which is what let two
    lists of the same thing diverge. Colours are picked by IMPORTANCE, not by what the thing is.
    **`--fs-head` and `--fs-num` are the same 13px on purpose**: different roles, and only one of
    them should move if the heading scale is retuned.
  - Re-expressed against the tokens: `.panel h3` / `.row` / `.row label` (identical values — pure
    tokenisation, no visual change), the whole league panel body, the cup bracket, and both history
    grids. **`#lgHist` and `#cupHist` now share every rule but their `grid-template-columns`** —
    written as separate blocks they drifted within a day.
  - Three real drifts fixed while tokenising: `#lgTable .h` was **`#ba7f7f`**, a warm grey that
    appears nowhere else and reads as a typo for a cool one; `.lgScout` and `.lgHist` each carried
    a **panel-wide `letter-spacing:.1em`** that applied on top of every child's own tracking, which
    is why those two panels read differently from the rest; and the ▼ column head had a one-off
    8px override, now `micro` like every other head.
  - **Deliberately NOT touched**: `.lgSub` / `.tagline` (screen chrome, not panel content) and the
    other menu screens. The tokens exist now, so those are a follow-up, not a rewrite.
  Verified by re-read (sandbox wouldn't boot). Sizes moved on a few elements — the standings table
  and its numbers step down 15→13.5 and 14→13 to sit on the scale, so that's the first thing to eye.
- **MATCH RULES BELONG TO THE LEAGUE SAVE, AND THE CUP READS THE SAME ONES** (`js/league.js`,
  `js/ui.js`, `js/config.js`, `index.html`, `css/styles.css`). Reported from play: a Champions Cup
  tie didn't match the league that qualified you — different special balls, power-ups and clock.
  It was three separate leaks into one symptom.
  - **The cup forced its own rules.** `cupPlayTie` did `cfg.special=CUP.special; cfg.power=CUP.power`
    while `lgPlayMatch` (correctly) used `LG.special`/`LG.power`; `goalTarget()` branched to
    `CUP.goals`; and `gameTimeLimit()` hardcoded **0 for the cup** — so a 10-minute league handed
    you an unlimited final. All four now read the LEAGUE. `CUP.goals/special/power` stay in config
    as the FALLBACK for a save written before `LG.goals` existed (commented as such — they look
    like live knobs and aren't).
  - **`LG.goals` is new; `LG.special`/`power`/`gameTime` already existed.** The gap was that only
    special/power were on the create screen, and only gameTime/control were in the lobby — no
    screen showed the whole set. Create screen now has **Goals to win + Game time** alongside the
    existing three; the lobby's Match Settings panel gains **Goals / Special balls / Power-ups**
    beside the two it had. Both seed from the quick-match `cfg` prefs and then belong to the SAVE.
  - **`lgGoalCap()` / `lgMins()` are the ONE source of truth** — `goalTarget`, `gameTimeLimit`,
    `lgSimBlds`'s per-team cap and the lobby seeding all route through them. **Deliberately NOT
    named `lgGoals`**: an element `id` becomes a window property, and `#lgGoals` is the lobby's
    select. A same-named function declaration shadows it (own property beats named access), so it
    would have worked — which is exactly what makes it a trap. Worth knowing generally in this
    codebase: **plain globals + element ids share one namespace.**
  - **The SIM was capped at `LGC.goals` too**, so a league set to 3 or 7 had the player racing to
    its target while every AI fixture raced to 5. Now `lgGoalCap()`. And **cup sims now pass
    `lgMins()`** (`cupAdvance`, `cupRecord`) — they passed nothing, so in a timed league a simmed
    semi-final still used the unlimited race-to-goals shape while the player's tie was on a clock.
  - **Both forfeit sites hardcoded the scoreline** (`js/ui.js`): the message quoted
    `CUP.goals`/`CONFIG.league.goals` and `btnForfeit` wrote `S.score=[0,<same>]`. In a to-3 or
    to-7 league that promised — and recorded — a result the mode doesn't produce. Both are
    `goalTarget()` now, captured into `fl` **before** `gotoMenu()` since that clears `S.lg`, which
    `goalTarget` reads.
  - The cup BRACKET shows the rules (`lgRulesLabel()` appended to `cupSub`, phrased like flow.js's
    kickoff banner). It's the one screen with no settings panel on it, so a tie's format was
    previously unknowable from where you start it. **Venue is untouched** — the cup keeps its own
    table/room/pitch rotation; that's showpiece dressing, not a rule.
  - Old saves: `loadLG` backfills `LG.goals` from `LGC.goals` — the number they were already
    playing to, so nothing changes for an in-progress league.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised live.
- **CUP LOBBY REBUILT AS A PANEL SCREEN — it had no squad panel, so cup parts were unspendable**
  (`index.html`, `js/league.js`, `js/screens.js`, `css/styles.css`). Reported from play. `#championsCup`
  was a bare bracket + a Control select + two buttons, so the one screen you spend a whole post-season
  on could show you neither your squad, your upgrade parts, the rules a tie would be played to, nor
  anything about the team you were about to face. **Parts were never a per-mode currency** — winning a
  tie pays `CUP.tieParts` into the same pool the league pays into — so the cup was accruing them with
  no way to spend them until you came back out.
  - **Now structurally identical to `#league`**: `.lgWrap` of `.panel`s, a ⊞ layout button, and a
    `lay` block in `SCREENS.championsCup` (that block's PRESENCE is the whole registration — layout.js
    indexes it and binds `cupEditLayout` on load, nothing else to edit). Panels: **Bracket** (takes the
    standings slot), **Next Tie**, **Match Settings**, **Cup Honours**, **Squad**, **Scout**.
  - **`renderSquadInto(squadId,upId,again)`** — `renderLgSquad` was hardcoded to `#lgSquad`/`#lgUP` and
    re-entrant by name. Both lobbies now render the SAME `LG.teams[playerId]` block through it.
    Spending mid-cup lands immediately on the table: `cupEnt('player')` reads the live `bld`.
  - **`seedRuleCtls` / `bindRuleCtls` take an ID MAP** (`LG_RULE_IDS` / `CUP_RULE_IDS`). The four rules
    are ONE value on the save with two sets of controls — element ids can't be shared because both
    panels are in the DOM at once, and that's the only reason the indirection exists. Change the clock
    in the cup and the league lobby shows it on its next render.
  - **The cup scout can't be the league scout.** Entrants aren't `LG.teams`: a KO field has no table,
    so there's no W/L, GF/GA or form. `renderCupScout` shows **seed + `cupRate`** on that line and then
    reuses the league scout's OFF/DEF bars, `lgBuildHTML` grid and `mugImg` portrait verbatim. It takes
    an ENTRANT ID (`'player'` or a pool id), not an `LG.teams` index — passing one to the other is the
    mistake to watch for. Every name in the bracket is clickable (`data-ent`), same affordance as a
    standings row, and `openCup` opens on the opponent so the panel isn't one you have to discover.
  - **Cup Honours reads TWO sources and must.** This season's trophy is NOT in `LG.hist` — a hist entry
    is only pushed at the rollover OUT of a season and the cup is played in the gap, which is the same
    asymmetry that makes `lgNewSeason` (not `cupRecord`) stamp `hist[].cup`. So it's read off `LG.cup`
    and prepended, **gated on `cupCurrent()`** — without that gate, after a rollover the finished
    bracket still sitting on `LG` would render the same trophy a second time beside its hist row.
  - `#cupBracketPanel` sizing is an **ID rule on purpose**: it has to beat `.lgWrap>.panel:nth-child(1)`
    (sized for a 10-row table, max-width 400) and needs ~3 round-columns. Which is also why it's listed
    by id in the ≤1040px media query — a class selector there would lose the specificity fight and
    leave a 560px panel in a 520px wrap. `.lgWrap .panel` is `overflow:hidden`, so it sets `auto`.
  - Gone with the old screen: `.cupControlWrap`, `.cupNext`, `#championsCup .tagline` (the subtitle is
    `.lgSub` now, matching the league). `renderCup` is an orchestrator — bracket/fix/squad/hist each
    render themselves. The rules label stays on `cupSub` as well as in the panel because a DECIDED cup
    hides the settings panel, and then the subtitle is the only record of what the ties were played to.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised live — the layout editor on this
  screen in particular is untested.

### 2026-08-03
- **BALL WEDGED HALFWAY INTO A WALL — the wall clamp was VELOCITY-GATED, and the boot resolved LAST**
  (`js/physics.js` `stepBall` side/end walls + new `staticClamp`). Two independent halves, both needed.
  - **The position correction only ran when the ball was moving OUTWARD.** `if(p.z>zl&&v.z>0){p.z=zl;…}`
    reads as one test but is two: the bounce (rightly gated on arrival) and the CLAMP (which must not
    be). A ball already past the line with inward or zero `v.z` was never pushed back — it just sat
    buried. Now the sign is taken once (`sz`), the reflection stays gated, and `p.z=sz*zl` is
    unconditional. Same split applied to both end walls (`p.x=±xl`).
  - **The other half is ORDER.** `collideRod` resolves by writing `p` DIRECTLY and runs AFTER the wall
    tests, so on a ball squeezed between a boot and a wall the foot's depenetration is the last thing
    to touch the position that substep and can shove it clean through the wall plane. Worse, the two
    halves feed each other: the grip lerp (`b.v=lerp(b.v,contactVel,g)`) drags `v.z` toward the FOOT's
    velocity, so the ball is never "arriving" at the wall again and the gated clamp above could never
    recover it. New **`staticClamp(b)`** re-asserts floor + side walls + end walls after the rod loop
    (and before the out-of-bounds test, which a boot could otherwise trip). Static geometry wins the
    squeeze, so the ball pops ALONG the wall instead of into it.
  - `staticClamp` is **position-only and kills only the INTO-surface velocity component** — the bounce
    belongs to `stepBall`'s arrival tests, which have already run this substep; re-bouncing here would
    let a held ball churn against the boot. Its goal-mouth exemption **mirrors `stepBall`'s test
    exactly** (`|p.z|<gh && (p.y<goalH||!ENDWALL_H)`) — if one is ever retuned, both must move, or a
    ball on its way in gets clamped out at the line.
  - **ARENA IS DELIBERATELY EXEMPT** (early `return`). `arenaContact` is distance-based with NO velocity
    gate, so a bowl wall already re-resolves a pushed-in ball by itself on the next substep. Worth
    knowing generally: **the SDF path never had this bug; only the flat table's gated clamps did.**
  - **NOT a substepping problem, and `subTravel` is the wrong knob for it** (recorded because it's the
    obvious first move and it costs frames for nothing). `sub=clamp(ceil(vmax·dt/subTravel),subMin,subMax)`
    with `dt` fixed at 1/120, so `subMax:7` already binds at `vmax≈168`; a strike is `(strikeA/strike)·ARM
    ≈126 u/s` and ball `maxV` is 100, i.e. hard play ALREADY runs 6–7 substeps. Dropping `subTravel` to
    0.05 moves the cap to `vmax≈42` — pinned at 7 for essentially all play, paying max cost constantly,
    to gain 6→7. Per-substep ball travel is ~0.17u against `BALL_R 1.9`: nothing is tunneling.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised live.
- **CHAMPIONS CUP OVERHAUL — the mode had never been played through, and it did not work**
  (`js/league.js`, `js/config.js`, `js/flow.js`, `js/ui.js`, `index.html`, `css/styles.css`). The
  2026-08-02 entry below flagged that everything past `cupCreate`/`openCup` was unexercised. It was.
  - **WINNING A TIE KNOCKED YOU OUT.** `cupRecord` stored `tie.res=[w,1-w]` from the winning TEAM
    INDEX, so a player win (`w=0`) recorded `[0,1]` — a 0–1 defeat — and `winners` then advanced the
    opponent. Compounding it, `res` is indexed by `tie.a`/`tie.b` while `w` describes team 0/1, and
    the draw puts the player on either side, so even the sign was only right half the time.
    Forfeiting (`cupRecord(1)`) could therefore ADVANCE you. Now `cupTieRes(tie,pGoals,oGoals)`
    orients `S.score` onto a/b and the REAL scoreline is stored, so the bracket shows a result
    instead of a 1–0 verdict. **`S.score` is authoritative; `cupRecord`'s `w` is now ignored** and
    only kept so flow.js can call it and `lgRecord` through one expression.
  - **A SECOND CUP COULD NEVER BE DRAWN.** `LG.cup` is never cleared (it carries the persisted elite
    pool), so `cupValid()` stayed true off a FINISHED bracket and the season-end button's
    `if(!cupValid())cupCreate()` never fired again — qualify a second time and ENTER CHAMPIONS CUP
    re-opened the old completed one. Split into **`cupLive()`** (drawn, undecided, `season===LG.season`)
    and **`cupCurrent()`** (this season's, decided or not). The button tests `cupLive`; the lobby
    button shows on `cupCurrent` and relabels to **Cup Result** so a just-won bracket stays
    reviewable until rollover — it used to vanish the instant the cup was decided.
  - **THE CUP RAN ON ROOKIE BRAINS.** `cupPlayTie` reads `CUP.diff||LGC.baseDiff` and **`CUP.diff`
    was never defined**, so the post-season showpiece played at `baseDiff` — 'rookie' — while the
    Premier League you beat to qualify runs 'legend'. Now `diff:'legend'`, which with the pool's
    base-8 builds on top makes it the hardest football in the game. Silent because it's a
    `||` fallback, not a missing read: **check `CUP.*` keys exist, they fail quietly.**
  - **THE BRACKET IS A REAL TREE NOW.** Winners were re-SHUFFLED every round, so the columns
    `renderCup` draws implied a tree that didn't exist — you could beat the two best teams in the
    quarters and semis and meet the third in the final by coin flip. Entrants are ranked by
    `cupRate` (off+def) and placed by **`cupSeedOrder(n)`** — the standard mirror-fold seeding order
    (`[0]`→`[0,1]`→`[0,3,1,2]`→`[0,7,3,4,1,6,2,5]`, generated so it stays right at 16) — and
    **`cupNextRound`** pairs winner of tie 2j with winner of tie 2j+1, slots preserved. That is the
    ONE definition of the pairing; live play and `cupAdvance`'s sim-ahead both go through it, so the
    bracket you walk and the one the sim finishes can't be drawn differently. `CUP.seeded:false`
    restores a random (but still tree-structured) draw. **`drawSize+1` must be a power of two and
    `rounds` must be its log2** — a 6-team field pairs off into `undefined`; noted in config.
  - `cupAdvance` takes TIES now, not winner ids, and the beaten-FINALIST case is handled separately
    (`last?cupWinnerOf(tie):cupAdvance(ties)`) — feeding a 1-tie array to the pairing would have
    produced `{a:winner,b:undefined}`.
  - **Forfeiting a cup tie left the match running.** The cup branch called `cupRecord`+`openCup`
    with no `gotoMenu`, so balls/fractures/replay state stayed live, the HUD phase stayed `pause`,
    and the cup's kit/table kept overriding the player's `prevKit` snapshot. Routed through the same
    teardown the league branch uses (record first — both readers need `S.lg`, which `gotoMenu` clears).
    **Also fixed for the LEAGUE: `#lgForfeit` is an overlay, so it isn't in the screen registry and
    `hideScreens()` never took it down** — it sat on top of the lobby you'd just forfeited back to.
  - **The trophy was logged to the wrong season.** `cupRecord` stamped `cup:` onto `LG.hist`'s newest
    entry, but a season's hist entry is only pushed at the rollover OUT of it and the cup is played
    in the gap between — so the trophy landed on the PREVIOUS season's row (or nowhere, on a first
    hist). Stamped in `lgNewSeason` from `LG.cup` instead, gated on `LG.cup.season===LG.season`.
  - **`LG.cupTitles` was incremented and read by nothing.** Now on the lobby history line beside the
    Premier count. **`cupDone` ("View Trophy") was bound to nothing** — a dead button on the one
    screen you only reach by winning the thing; it's the primary **Continue ▶** now.
  - **Winning a tie paid nothing and said nothing** until the final, so three rounds in four ended on
    a bare round name. New `CUP.tieParts` (2); `cupRecord` stashes `S.lg.parts`/`S.lg.champ` for the
    win screen (it runs before `endMatch` builds the HTML). Lifting the cup also had no moment of its
    own — `renderCup` now fires confetti + `Au.goal()` once, latched on `cup.celeb` **in the save**
    rather than on `S`, so re-opening a won bracket doesn't re-trigger it.
  - Smaller: seed numbers render beside each name and on the NEXT TIE line; `cupSub` says ELIMINATED
    rather than COMPLETE when the player went out; the Control select moved ABOVE Play Tie (it
    configures what that button starts) and persists to **`LG.cupControl`** — its own key, not
    `LG.control`, so a lock picked for a league round doesn't follow you into a final; `cupEnt` takes
    an optional pool (so `cupCreate` can seed before the assign-last) and returns a grey placeholder
    for an unknown id instead of throwing the whole bracket screen.
  Verified by re-read (sandbox wouldn't boot). Old saves: a pre-change bracket has no `seeds`/`celeb`
  (seed cells render empty, the celebration fires once) and keeps its unseeded shape — `cupNextRound`
  pairs any even-length round, so nothing throws. NOT yet exercised live.
- **THE MATCH-WINNING GOAL NOW GETS A REPLAY** (`CONFIG.replay.winner`, `S.pendingWin`, `js/flow.js`,
  `js/replay.js`, `js/main.js`, `js/state.js`). The one goal most worth watching was the only one that
  never got one: `onGoal`'s two winning-goal branches (`suddenDeath`, target reached) `return`ed into
  `endMatch` BEFORE the `replayQueue(team)` line, so the win screen replaced the celebration outright.
  - The winner now takes the **same** path as any other goal — banner, `S.phase='goal'`, `goalHold`
    slow-mo, `replayQueue` — and the win screen WAITS. `S.pendingWin` parks the winning team;
    `main.js`'s goal timer hands off to `replayStart` exactly as before; **`replayEnd` calls
    `finishPendingWin()` instead of `startCount`**. Skipping the replay (any key/click/pad) therefore
    goes to the win screen, not to a re-count — `replaySkip` routes through `replayEnd`.
  - **`replayReady()`** (new, `replay.js`) is `replayPending()` minus the `RP.queued` test: "is there
    footage worth showing right now". `onGoal` checks it **before committing anything**, so a case
    that can't produce a replay (feature off, `cfg.replay` off, rally under `minLen`, another ball
    still live) never sets a banner/phase it then has to unwind — it falls through to the immediate
    `endMatch` and is byte-identical to the old behaviour. `replayPending` is now expressed in terms
    of it, so the two can't drift.
  - **`finishPendingWin()` returns false when nothing is waiting**, which is what lets both call sites
    stay one-liners (`else if(!finishPendingWin())startCount(...)`). The `main.js` call is a
    BACKSTOP, not the normal route: it only fires if a queued win stopped being replayable during
    the hold. Cheap insurance — the failure mode it guards is a match that never reaches its win
    screen. `endMatch` also nulls `S.pendingWin` (a clock-out could land with one queued) and
    `startMatchNow` resets it with the rest of the match state.
  - Sub-chip on the banner is `GOLDEN GOAL` in sudden death, else `MATCH WINNER` — deliberately NOT
    the usual HYPE line or the `GOLDEN BALL · ×2` tag; this is the one goal where the format matters
    more than the flavour. `CONFIG.replay.winner:false` restores the old cut-to-win-screen exactly.
  - Worth knowing: league/cup recording (`lgRecord`/`cupRecord`) happens inside `endMatch`, so it is
    now deferred by the replay's length. Nothing reads the result in between — the sim is frozen in
    the `replay` phase and `checkMatchClock` only runs during `play`.
  Verified by re-read (sandbox wouldn't boot).

### 2026-08-02
- **FRAME PROFILER (`js/perf.js` new, `M`)** — see the section above. Hooks in `main.js` `loop()`
  (`perfFrame`/`perfFrameEnd` + four `perfMark`/`perfAdd` buckets) and `physics.js` (`perfSub`);
  `CONFIG.perf` tunes it, `cfg.profiler` persists the toggle. Added because the intermittent
  league-match sags couldn't be pinned by reading: the point of it is `gap = ms − js`, which
  separates "our JS was slow" from "the browser/GPU stalled and our code was idle".
- **DEBUG OVERLAY: shared proxy geometry + `disposeDebug()`** (`js/debug.js`). `buildDebug` was
  allocating a fresh `BufferGeometry` per mesh — 5 per man for the capsule/foot/reach proxies (110
  for 22 men), a fresh flat `BoxGeometry` per rod in each of six AI zone layers, a cylinder per
  target dot / dribble mark / shot marker / sweet-flash. Everything is now scaled instances of
  **`dbgUnitBox` / `dbgUnitSph` / `dbgUnitCyl`**, via the `box`/`plate`/`disc` helpers. Roughly
  450 → ~95 geometries, and the remainder is nearly all the shot-lane lines (8 rods ×
  `gapAim.samples`), which genuinely can't share — each `THREE.Line` holds its own 2-point buffer.
  - **A mesh on a shared geometry carries its SIZE in `.scale`** — so any layer whose live update
    writes `.scale` must keep its own geometry. Two do: the **aligned bars** (`updateAIVis` animates
    `.scale.z` against the align threshold) and the **sweet-spot flash** discs (`.scale.setScalar`
    for the pop). Both are hoisted to one shared geometry each instead, so they still went 22 → 1.
  - The ball collision proxies now ride `dbgUnitSph` (10×8 segments, was 14×12) — a slightly coarser
    cyan wireframe, the only visual change in the whole pass.
  - **`disposeDebug()`** (console-callable) frees the lot: every geometry is registered in `dbgGeo`
    as it's built (`keep()`), materials are collected by traversal, and the capsules + manHyst rings
    are stripped SEPARATELY because they're parented to `r.pivot`, not to the debug groups.
    `dbgAIPanel` is deliberately kept (just hidden) so a rebuild reuses it — `buildAIPanel` is
    `if(dbgAIPanel)return`-guarded and the checkbox state lives in `dbgAIOpts`.
  - **`C` off now PARKS the overlay out of the scene graph** (`dbgAttach`/`dbgPark`/`dbgUnpark`),
    it does not just hide it. **`visible=false` was not enough**: `renderer.render()` calls
    `scene.updateMatrixWorld()`, which recurses through INVISIBLE objects — only `projectObject`
    (the render-list build) skips them. So a hidden overlay was still walked every pass, and with
    `cfg.reflections` on `updateBallReflect` renders the whole scene 6 more times every
    `ballReflect.every` frames, plus the shadow pass — several walks a frame for nothing. The
    capsules + manHyst rings were the worst of it: parented to `r.pivot`, which moves every frame,
    so their matrices were genuinely RECOMPUTED, not skipped. This is what "laggy after leaving
    debug" was. Parking frees nothing on the GPU, so re-entry is still instant.
    Each object stores its own parent in `userData.dbgHome`, so the same two calls handle the
    scene-level groups and the pivot-parented proxies.
  - **`C` off also clears `dbgLogRod`.** The AI tracer is guarded by `dbgLogRod===r` at ~40 sites in
    `ai.js`/`physics.js`, but those run per SIM STEP and `flushKickLog` only runs in `debugUpdate`'s
    `dbgOn` branch — so a rod left traced kept formatting strings into a buffer nothing drained. `L`
    is `dbgOn`-gated anyway, so you just re-pick on re-entry.
  - **`C` still does NOT dispose** — parking already removes the per-frame cost, and disposing would
    make re-entry a rebuild hitch. `disposeDebug()` stays the explicit "free it" call. Note for
    future work: **anything that REPLACES the rod pivots must call `disposeDebug()` first** or the
    pivot-parented proxies strand. `rebuildRodMen` only swaps `r.men`, so it's safe; `buildRods`
    runs once at boot, before the overlay can exist.
  - Worth knowing when profiling: geometry COUNT is a VRAM/upload figure, not a frame-cost one —
    a hidden mesh isn't drawn. What costs frames is turning the layers ON, which adds hundreds of
    transparent draw calls, ×7 once `updateBallReflect`'s cube pass renders the scene 6 more times.
    **Measure with `C` off.**
- **CHAMPIONS CUP CRASHED ON ENTRY — `CONFIG.league.cup` was one brace outside `league`**
  (`js/config.js`, `js/league.js`). `Continue to Cup` on the season-end screen threw
  `Cannot read properties of undefined (reading 'names')` in `cupMakePool`. **`CUP` itself was
  undefined**, not `CUP.names`: the `league:{…}` object closed immediately after `colClash:80`,
  so the `cup:{…}` block that follows it parsed as a SIBLING key — `CONFIG.cup` — while the alias
  at the bottom of config.js reads `CUP=CONFIG.league.cup`. Valid JS, no parse error, and the
  indentation LOOKS right (config.js mixes 1/2/3-space indents at the same nesting depth, so the
  eye can't be used to check this) — it only surfaces the first time something reads CUP, which
  is the one screen you reach after winning a whole season. Fixed by moving league's closing
  brace below the cup block; a comment on the block now says it must stay inside `league`.
  - **Watch for this shape generally**: an alias in the derived-alias section resolving to
    `undefined` is silent until first use. `CUP` is the only alias that was wrong; the rest were
    checked against their CONFIG paths.
  - **The crash also left a HALF-BUILT `LG.cup` behind, which would have been permanent.**
    `cupCreate` assigned `LG.cup={…roundsTies:[]}` BEFORE calling `cupMakePool`, so the throw
    stranded a bracket-less cup, and the button's guard was `if(!LG.cup)cupCreate()` — truthy, so
    it would never rebuild. Any later `saveLG()` (spending an upgrade part is enough) would have
    persisted that to localStorage and killed the cup for that save file for good.
    `cupCreate` now builds everything into locals and **assigns `LG.cup` LAST, whole**, and the
    new **`cupValid()`** (`roundsTies` present AND non-empty) replaces the truthy test at both
    read sites — the season-end Enter Cup button and the lobby's resume-cup visibility. That
    combination also SELF-HEALS a save that already persisted the broken object.
    `cupMakePool(existing)` is a pure function returning the pool now, rather than mutating
    `LG.cup.pool` (it was the only thing forcing the early assign). Only caller is `cupCreate`.
  - The participation bonus (`CUP.enterParts`) is granted after the assign, so the recovery path
    hands it over exactly once — the failed attempt never reached that line.
  Verified by re-read (sandbox wouldn't boot — the brace move is net-zero on the file's brace
  count, and the `league`→`cup`→`control` nesting was walked by hand). NOT yet exercised live:
  the cup beyond `cupCreate`/`openCup` (tie playing, sim, bracket advance) has not been run since.

### 2026-07-30
- **LOCAL CO-OP RAISED TO 4-A-SIDE** (`CONFIG.seats.perTeam` 2→4, `max` 4→8, new `maxPads`;
  `js/seats.js`, `js/roster.js`, `js/input.js`, `js/hud.js`, `css/styles.css`). The cap was one
  config number — `rosCanJoin`/`rosSetTeam`/`rosNextTeam` were its only readers and everything
  downstream was already N-generic (`pickActiveRods` raises a team's active-rod cap to its seat
  count, `seatBindRods` push-offs in a loop, `setSeatCtrl`/`rodTaken` skip any number of held rods,
  `updateChips`/`rosRender` iterate). So the work was the FALLOUT, not the number.
  - **THE REAL CEILING IS THE ROD COUNT (4/side), NOT `CONFIG.ai.hands`.** The old comment tied
    `perTeam` to `hands` and that was never the binding constraint — `pickActiveRods` already does
    `n=min(max(hands,forced.length),tr.length)`, so 4 seats on a side make all 4 rods live and the
    AI plays none of that team, which is correct. `hands` (now 3) only ever bounded the AI. Both
    comments corrected. A 5th player a side would be a hand with nothing to hold.
  - **DEVICES bound it below the rod count in practice.** One keyboard, one mouse, so N players
    need N−2 pads. New **`CONFIG.seats.maxPads`** (8) generates the `'pad0'…'padN'` token list in
    seats.js and replaces the **three hardcoded `4`s** that capped pad polling (`rosPads`,
    `rosTick`, `rosterOpen`, `gamepadUpdate`). **XInput on Windows tops out at FOUR pads**, so
    4 pads + kbd + mouse ≈ **6 players is the realistic ceiling there** — 4v4 needs 8 devices and
    won't be reachable on a stock Windows box. `seatForDev`'s `/^pad\d$/` widened to `\d+`.
  - **`CONFIG.seats.tint` had 2 entries and `seatTintHex` repeats the last** — so P3 and P4 on a
    side would have rendered in P2's colour, defeating the one thing the tint exists for. Now 4,
    spread by LIGHTNESS first (it's a small cone read at a glance) and hue second. Both kit
    defaults sit at l≈.65, which is what lets P3 go −.22 without going black. `offsetHSL` wraps h
    and clamps s/l, so the offsets are safe against any user kit colour.
  - **DUPLICATE ROLE LOCKS are now refused.** A `lockRole` seat has a ONE-ROD list and literally
    cannot switch, so two teammates locking the same role weld themselves to one handle and both
    drive its target — unrecoverable in-match. With 4 roles and 4 seats a side that's one mis-click
    away. `rosRoleTaken` gates `rosSetRole`, the button renders `.rodOpt.taken` (dashed/dimmed,
    titled "Taken by P2" — same language as the device chips), and `rosSetTeam` drops the lock when
    swapping onto a side that already has it (the only route past the guard).
  - **`seatBindRods`' push-off had an ORDER BUG the cap was hiding.** It yielded only to EARLIER
    seats (`j<i`), so an unlocked P1 taking MID before a locked-to-MID P2 was placed left P2
    (`n<2`, early return) sitting on top of them. A single-rod seat can't be the one to give way,
    so the test is now `j<i || o.rods.length<2`. Plus a backstop in the bind itself: a lock whose
    rod an earlier locked seat already claimed is DROPPED (full rod list) rather than honoured.
    Note this also changed the unmatched-role fallback from `mine[0]` to the full list — strictly
    better, and unreachable from the two live callers.
  - **`#chips` gets a COMPACT MODE past `CHIP_FULL_MAX` (2) seats** (`hud.js`). The full form is a
    label + one chip PER ROD per seat = **40 chips at 4-a-side**, three wrapped rows over the play
    area, and mostly dead affordance: once a side's 4 seats hold its 4 rods there is nowhere to
    switch to and every off-rod chip is permanently `.taken`. Compact = one chip per player showing
    the rod they hold; click still cycles. `#chips` also gained `flex-wrap:wrap-reverse` +
    `max-width:88vw` (it was an unwrapped flex row running off both screen edges). **Solo and 2P
    are under the threshold and render exactly as before.**
  - **`#menu` scrolls now** (`overflow-y:auto; justify-content:safe center`). Four seat cards a side
    can outgrow a short viewport, and `.screen` is a centred flex column with no overflow rule —
    which clips at BOTH ends, so the title and the START bar above the wrap would be the first
    things lost. `safe center` degrades to flex-start only when it doesn't fit. (`.lyScroll` covers
    this for CUSTOM layouts only.)
  - Untouched and worth knowing: `S.userTeam` is still the PRIMARY seat's team, so the HUD tint and
    the handle-side flip follow P1 at 4v4; the sweet-spot guide is still one mesh set (`ssSeat`);
    and with all 4 rods held, Q/E laps and does nothing, which is correct.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised with live devices.
- **KICK OFF REBUILT AS TABS; layout editor now supports MULTIPLE regions per screen.**
  - **`SCREENS[id].lay` may be an ARRAY of blocks**, each with its own `key`, `wrap`, `btn` and
    `panels` (js/layout.js indexes them once into `LAY_BLOCKS`). Every layout function works on a
    **layout KEY** now, not a screen id; `layApplyScreen(id)` is the screen-level entry point and
    is what `showScreen` calls. **A block's key is what `cfg.layouts` is stored under, so renaming
    one orphans every saved arrangement** — `'menu'` stays on the Kick Off team tab for exactly
    that reason. A block with no key defaults to its screen id, so single-region screens
    (league) are unchanged.
  - **`layApply` skips a wrap inside a hidden tab** — it measures 0 wide there, which would squash
    every panel to `LAY_MINW`. `menuSetTab` re-applies on reveal. Same reason each tab has its own
    ⊞ button and only the live tab's is shown: two edit buttons in one corner would be a coin toss
    as to which region you were about to rearrange.
  - **Kick Off default layout is now Team 1 kit · Team Select · Team 2 kit.** The old combined
    "Teams & Kits" panel is split into `menuKitPanel0`/`menuKitPanel1` (all its inner ids were
    already per-team, so `refreshKitUI` needed no change), and the two roster columns are back
    inside ONE `#menuTeamPanel` as `.rosCol`s.
  - **Match Setup is its own TAB, split into three panels** (Match Rules / Table & Venue / Audio).
    A tab rather than a fourth column because it's tall: under a team panel holding four players
    it would be pushed off the bottom of the screen. Control ids are all unchanged — only the
    grouping moved — and `menuSetupPanel` keeps its id so existing saves resolve it.
  - **The Controls panel moved to Options → Controls** (`#optCtlRefPanel`) and gained the
    controller column it never had, plus a note on what Total Control remaps. It's a thing you
    look up once, not a thing you set per match.
  - `.scrTabs`/`.scrTabBtn`/`.scrTab` are the generic tab classes; `.optTabs` etc. are kept as
    aliases so the Options screen didn't have to change. Generic tabs use the steel accent, not
    the league's gold.
  - **A CUSTOM WRAP NOW HUGS ITS CONTENT ON BOTH AXES** (it only did height before, so a narrow
    arrangement sat in a slab of empty dotted box). Two things make that safe:
    · **Panels clamp against the width the wrap is ALLOWED to be, not its current width.**
      `layApply` clears the inline width, measures `clientWidth`, then shrinks. Clamping against
      the already-shrunk width would ratchet the box narrower on every call. Measuring this way
      also means each wrap honours its own CSS max-width (`.panelWrap` 1640, `.lgWrap` 1820) with
      no constant in layout.js to keep in sync.
    · **While EDITING the wrap holds the full canvas** — shrink-wrapped to its panels there'd be
      nowhere to drag one out to. `layEditEnd`'s `layApply` does the shrink.
    `.lyCustom` gained `min-width:0` (`.panelWrap`'s 1200px floor is for the FLOW layout) and
    deliberately does NOT override `max-width`, since that's what the measurement reads.
  - **`.scrTab{width:100%}` is load-bearing.** A `.screen` is a centred flex column, so a plain
    block child is shrink-to-fit — its width comes from its content, and a `.lyCustom` wrap's
    content is absolutely-positioned panels contributing nothing. Without it the wrap's own
    `width:100%` resolves against a collapsed box. Any future tab/section wrapper needs the same.
  Verified by re-read (sandbox wouldn't boot).
- **ROSTER PANELS ARE LAYOUT-EDITABLE + camera no longer favours red.** Two unrelated UX fixes.
  - **The two Kick Off team columns are `.panel`s inside `.panelWrap` now** (`#rosPanel0` /
    `#rosPanel1`, added to `SCREENS.menu.lay.panels`), so the ⊞ editor moves and resizes them like
    any other panel. `.rosWrap` and the `VS` divider are GONE — `.panel` already supplies the card
    chrome, so `.rosTeam` is down to the team accent colour. `.panelWrap` gained **`flex-wrap`**:
    five panels past the 1640px max would otherwise squeeze every one of them thin instead of
    dropping to a second row. The START bar sits ABOVE the wrap deliberately — a custom
    arrangement can be taller than the viewport (`.lyScroll`), and a bottom-anchored primary
    action would end up off-screen.
  - **`layApply`'s no-saved-spot branch used to stack new panels almost exactly on top of each
    other** (`y` offset 40px, `x` identical, height 288) — so anyone with a saved menu layout would
    have seen the two roster columns arrive as one. They're now laid out in a 3-wide grid below the
    saved arrangement. Worth knowing for any future panel added to an existing screen.
  - **Camera: `CONFIG.camera.sideModes` + `soloOnly`.** Modes 1/4/5/6/7/8 are anchored to one END
    of the table, and **two of them (1 and 8, both "RED MID CAM") had no blue counterpart at all**
    — so a blue player pressing V got shots up the wrong half. That was broken in solo blue play
    long before co-op. `camTeamSide()` returns the team holding EVERY seat, or −1 when that's
    ambiguous; end-anchored shots mirror (x and lookX negate, nothing else — height and depth are
    the same shot either way) when that team is blue. The ball-follow offset is a WORLD offset and
    is deliberately not mirrored.
  - **With humans on BOTH sides the unpaired shots drop out of the V cycle** (`soloOnly`). 4/5 and
    6/7 are end PAIRS so both ends stay represented whatever happens; 1/8 are red-only and one
    screen shared by two opposed players can't make a one-sided shot fair, so it isn't offered.
    `cycleCam(d)` skips them rather than landing on them, and `startMatchNow` steps off a mode that
    stopped being offerable since the last match (the camera persists between matches).
  Verified by re-read (sandbox wouldn't boot).
- **PER-SEAT MARKERS + SEAT COLOUR — step 5. Two players on one team can now tell their rod
  apart.** This was the gap left open by steps 3–4: the held-rod marker and the sweet-spot guide
  were single meshes tracking the primary seat, so player 2 played unmarked.
  - **`CONFIG.seats.tint` + `seatTintHex(team,i)` / `seatCol(seat)` (seats.js).** The kit colour
    identifies a TEAM and cannot identify a PLAYER — which is exactly what you need with two
    humans on one side. So each seat past the first on a team is offset in HSL from its kit
    colour (`THREE.Color.offsetHSL`, index-keyed, last entry repeats). **1v1 is unaffected**: each
    seat is index 0 within its own team, so the markers are plain red and plain blue. Only a
    SHARED side shifts. `seatTintHex` takes team+index rather than a seat so the lobby can colour
    its cards from plain specs, before any live seat exists.
  - **`indicator` (one cone) → `indicators[]`, one per `CONFIG.seats.max`,** built once in
    `initThree` and only ever shown/hidden — same discipline as the fx light pool. Geometry is
    SHARED across the four; the materials can't be, since each carries a different colour. The
    bob is phase-offset by seat index (`+i*1.7`) so two markers never rise and fall in lockstep,
    which matters more than the tint when they're both on screen. The old singular `indicator`
    global is GONE (it had no readers left) — use `indicators`.
  - Colour is cached per mesh (`m.userData.col`): `material.color.set('#rrggbb')` parses a string,
    and doing that 4× a frame for a value that changes ~never is the only real cost in the loop.
  - **The sweet-spot guide is one mesh set, so it now follows whoever pressed B** (`ssSeat`),
    not always the primary seat. A second player pressing B TAKES it rather than switching the
    first player's off — otherwise B reads as a global toggle someone else keeps flipping.
    Pressing it while you already hold it turns it off, i.e. solo behaviour is unchanged.
    `sweetGuideUpdate` self-heals `ssSeat` to null when it's no longer in `S.seats`, because
    seats are rebuilt every match and a held reference goes stale at the next kickoff.
  Verified by re-read (sandbox wouldn't boot).
- **KICK OFF ROSTER (`js/roster.js` new) — step 4. Local co-op is live.** The three mode cards
  (PLAY RED / PLAY BLUE / AI SHOWDOWN) and their rod rows are GONE; `wireRodCard` is deleted.
  Side, rod and who's-AI are per-player now: two team columns of seat cards, each card showing
  its player number, devices and a rod pick (ALL/GK/DEF/MID/ATT). A column with no seats shows
  its AI difficulty instead — read-only, because the dropdown that sets it stays in the Match
  Setup panel and two writers for one value is how they drift.
  - **The lobby edits SPECS, not seats.** `S.roster` is `[{team,devs[],lockRole}]`; `flow.js`
    maps them through `makeSeat` at kickoff (`startMatch('roster')`). `makeSeat` copies `devs`,
    so a live seat can't mutate the spec — which is what lets Rematch replay the same line-up
    with no re-derivation. An EMPTY roster is a legal state: `userTeam` falls to −1 and it's an
    AI-vs-AI spectate, so the old AI SHOWDOWN card is just "start with nobody joined" (the START
    button relabels itself to WATCH AI MATCH).
  - **DEVICE RULE — the first seat absorbs every unclaimed device; every later seat takes exactly
    the one it joined with, stripped from whoever held it.** That one sentence is `rosAbsorb()`,
    and it's what keeps solo play intact: one seat holding keyboard + mouse + pad, exactly as
    before. Drop back to one seat and it re-absorbs, so leaving restores solo controls.
  - **Press-to-join only claims UNOWNED devices; taking one off another player is a CLICK.** Not
    a style choice — Space and A are the most likely accidental presses, and a solo player
    holding all three devices would otherwise split themselves into a second seat by tapping
    either. So the chips list free devices AND takeable ones (dimmed, titled "Take from P1"),
    and `rosTakeableDevs` refuses to strip a seat below one real device so nobody can be deleted
    by someone else's click. Pad **B** mirrors the same rule: it only leaves when that pad is the
    seat's ONLY real device, i.e. the seat exists because of that pad.
  - **`'pad*'` is held by a lone seat and stripped the moment a second seat exists.** It covers a
    pad plugged in AFTER kickoff, when the lobby is gone and there's no chip to click; with two
    seats it has to go or player 2's pad would answer to player 1 as well. It's never SHOWN in a
    device label — `rosAbsorb` adds the real `padN` alongside it once one is connected, and that
    is what the player should read.
  - **The poll gates on the screen being VISIBLE, not on `screenId()`.** `startMatchNow` calls
    `hideScreens()` without navigating, so `scrCur` stays `'menu'` for the whole match — gating on
    the router alone left the lobby polling through play, where a pad's B would call `rosLeave`
    mid-rally. Edge state is primed in `rosterOpen` from what's held right now, so a button still
    down from the click that opened the screen can't insta-join.
  - Re-render is a **signature diff** (`rosSig`) on a rAF, not an event web: pad hotplug, a team
    rename in the Kits panel and an AI-difficulty change all show up without any of those places
    knowing the roster exists. `ui.js`'s name inputs no longer poke the mode cards at all.
  - `CONFIG.seats.max` (4) and `perTeam` (2). **`perTeam` matches `CONFIG.ai.hands`** — a team only
    ever has two hands, so a third player on one side would be a hand that can't exist. Raise both
    together or not at all.
  - Seeding is once per session (`ROS.seeded`): the first visit drops a red seat so a solo player
    can just hit START, but leaving every seat to set up an AI-vs-AI match isn't undone by
    stepping out to home and back.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised with two live devices.
- **SEATS (`js/seats.js` new) — step 3, the local-co-op foundation. HEADLESS: one seat, plays
  identically to before.** `S.userTeam`+`S.ctrl`+`S.ctrlRods` could only ever describe ONE person;
  `S.seats[]` describes N. A seat = `{team, devs[], lockRole, rods[], ctrl, tcMult, padRaise,
  padPrev}`. `seatOf(r)` replaces the old "is this rod index the player's" test everywhere.
  - **DEVICES ARE A SET PER SEAT (`devs[]`), NOT ONE DEVICE PER SEAT** — the single most important
    detail here. Solo play is one seat holding keyboard AND mouse AND pad simultaneously; make
    device→seat 1:1 and a solo player slides with the mouse on one rod and the arrow keys on
    another. Tokens: `'kbd'`, `'mouse'`, `'pad0'..'pad3'` (a specific pad, what the lobby hands
    out) and **`'pad*'`** = any pad, which is what `soloSeat()` uses. `seatForDev(tok)` resolves
    exact-match first, then a `'pad*'` holder.
  - **`'pad*'` only answers to the FIRST connected pad** (`padSeat(idx,first)` in input.js). The
    old code did `getGamepads()` → first non-null, so without that restriction plugging a 2nd pad
    in mid-match would silently start driving player 1's rod.
  - **Pad edge state moved onto the seat** (`padPrev`, was the module-global `gpPrev`) and so did
    the raise-hold latch (`padRaise`, was `gpRaiseHeld`) and the Total-Control multiplier
    (`tcMult`, was `S.tcMult`, read in rods.js via `seatOf(r)`). Two pads sharing one `gpPrev`
    means a held button on pad 1 swallows pad 2's press — that's why these had to move, not
    tidiness. `gamepadUpdate` now LOOPS pads and calls `padSeatUpdate` per claimed pad; pause and
    replay-skip fire from any pad but are `didPause`/`didSkip`-guarded so two players pressing
    Start in one frame don't toggle twice and land back where they started.
  - **`setSeatCtrl` SKIPS rods another seat holds** (owner's call), searching on in the direction
    of travel so Q/E lands on the next FREE rod rather than doing nothing. `rodTaken(r,except)`
    is the test. Same skip is applied in the auto-rod-switch scan, or both players on a team get
    dragged onto whichever rod is nearest the ball.
  - **`pickActiveRods` forces EVERY seat-held rod on a team into the active pair**, not one. If a
    team ever has more seats than `CONFIG.ai.hands`, the cap is raised to the seat count so nobody's
    rod goes dead. Two humans on one team therefore fill both hands and the AI plays none — correct.
  - `seatBindRods()` does the initial placement (MID by default, then push each seat off a rod an
    earlier seat took) **by hand rather than via `setSeatCtrl`** — that stamps `S.lastSwitch`,
    repaints the chips and plays a click, none of which belong in match setup.
  - Primary-seat-only at the time of this step; **resolved in step 5 above** (per-seat marker
    pool + seat colour). `updateChips` already renders one row per seat with a P1/P2 label and a
    `.taken` state; with one seat it emits exactly the old markup.
  - `S.userTeam` SURVIVES as "the primary seat's team" and still drives the camera/HUD tint and
    the handle-side flip. It is not a per-player value — don't reach for it in new code.
  Verified by re-read (sandbox wouldn't boot). NOT yet exercised with two live devices.
- **Training now quits to `#home`, not Kick Off** (`S.fromScreen`, set in `startMatchNow` from
  `screenId()`, read by `gotoMenu`). A match returns to the screen it was LAUNCHED from, so a
  quick match still lands back on Kick Off (rematch stays one click) while training — launched
  from home — goes home. League/cup are forced to `'home'` instead of their lobby: they have their
  own return paths (`lgReturn`/`cupReturn` re-render before showing), and a bare quit routed to
  `'league'` would render a stale lobby.
- **LANDING SCREEN `#home` — step 2 (v0.1.206).** The game now opens on a four-route landing page
  (KICK OFF / LEAGUE / TRAINING / OPTIONS) instead of dropping a first-time player straight into
  the full match-setup surface. Built entirely on the router below; no new navigation machinery.
  - **`#menu` KEEPS ITS ID and becomes the KICK OFF screen.** That's the whole trick — renaming it
    would have invalidated `cfg.layouts.menu` (saved panel arrangements), the `#menu .panelWrap`
    CSS, `SCREENS.menu.lay`, and the back-target of customize/options. So the landing page went in
    with **zero** changes to those. `SCREENS.menu.back` is `'home'`, `scrCur` starts at `'home'`.
    **Read "menu" as "Kick Off" everywhere in the code** — that's the one piece of naming debt this
    approach buys, and it's cheaper than the alternative.
  - **LEAGUE and TRAINING cards MOVED to `#home` keeping their button ids** (`btnLeague`,
    `btnTraining`), so league.js and training.js bind to them unchanged — moving a card between
    screens is a pure HTML edit as long as the id travels with it. Only the two routes with no
    module of their own (`btnKickOff`, `btnHomeOptions`) needed new wiring, in `bindUI`.
    `Au.init()` rides those two clicks since WebAudio needs a user gesture and they're the only
    home cards that didn't already call it.
  - **The intro reveal moved to `#home`** (`intro.js` `menu`→`home`, the `#menu.introHide` /
    `#menu.introIn` CSS block → `#home.*`, and the no-JS loader failsafe in index.html). `introHide`
    is `visibility:hidden` and NOT `display:none` ON PURPOSE: `reveal()` measures this screen's
    `.logo` to aim the intro logo's morph, and a `display:none` element has no rect. **`#home` is
    therefore the one screen that boots WITHOUT `.hidden`** — `#menu` now boots with it.
    Card stagger delays trimmed 5→4.
  - Kick Off gained a top-LEFT `◀` (`.backBtn`, `#menuBack`) opposite the gear/⊞ stack, so a
    screen's two corners read as "leave" vs "configure"; it overrides `.optGear`'s rotate-on-hover.
    Its heading uses a new **`.scrTitle`** (steel gradient) rather than `.lgTitle` — gold is the
    league's brand colour and a gold "KICK OFF" reads as league chrome. Reuse `.scrTitle` on any
    non-league screen.
  - `.homeRow` narrows `.modeCard` (280px min → 212) so four fit one row and WRAP to 2×2 below
    ~950px rather than squeezing; marks and headlines are scaled up since four cards are the
    entire screen. New accents: `.modeCard.kickoff` (team red), `.modeCard.opts` (steel).
  - League's two Back buttons + `SCREENS.lgSlots/league.back` now point at `'home'` (league is
    entered from home). `customize.back` stays `'menu'` — it's only reachable from the Kick Off
    kit panel.
  - **`gotoMenu()` still lands on Kick Off**, per the owner's call: rematch/change-rod is then one
    click. Consequence worth knowing: quitting TRAINING (launched from home) also lands on Kick
    Off. If that reads wrong, the fix is to stash `screenId()` in `startMatchNow` and return there.
  Verified by re-read (sandbox wouldn't boot).
- **Screen ROUTER (`js/screens.js` new) — step 1 of the landing-page work.** Groundwork only:
  no screen was added, no screen looks different. Every full-page screen you NAVIGATE to is now
  one entry in a `SCREENS` registry, driven by `showScreen(id)` / `backScreen()` / `hideScreens()`.
  - **Why it had to come first.** "Go back to the menu" was a raw
    `$('menu').classList.remove('hidden')` **repeated in 7 files / 14 sites** — intro, flow
    (`startMatchNow` + `gotoMenu`), customize ×2, options ×2, league ×5, the Esc handler, and
    `layout.js`'s own screen table. Adding ONE screen meant editing all of them, and the next one
    after that too. All 14 are now `showScreen`/`hideScreens` calls.
  - **OVERLAYS ARE DELIBERATELY NOT REGISTERED.** `#pause`, `#win`, `#lgForfeit`, `#lgTape`,
    `#lgSeasonEnd` all carry `class="screen"` but they stack ON TOP of the screen underneath
    rather than replacing it — `#pause` in particular sits on a live match, so routing to it would
    leave the router pointing at a menu that isn't coming back until `gotoMenu`. `hideScreens()`
    therefore leaves them alone and the two callers that want them down (`startMatchNow`,
    `openCup`) hide them by hand. Same reason `openOptions('pause')` bypasses the router entirely
    while `openOptions('menu')` goes through it.
  - **`LAY_SCREENS` IS GONE — the layout editor reads `SCREENS` now.** A screen becomes
    panel-arrangeable by gaining a `lay:{wrap,btn,panels}` block in its registry entry; `layApply`
    then runs automatically inside `showScreen` (so the two manual `layApply('menu')` /
    `layApply('league')` call sites in `gotoMenu`/`openLeague` are deleted), and the ⊞ button is
    bound by a loop over `SCREENS` at layout.js load. `layout.js` keeps NO registry of its own —
    that was two tables to keep in sync, and it's the reason adding a layout to a screen used to
    be a three-file change. `layDef(id)`/`layPanels(id)` are the accessors; every layout function
    early-outs when a screen has no `lay` block, so registering a screen WITHOUT one is fine.
    `cfg.layouts` keys are unchanged, so saved arrangements survive.
  - **Screens attach their OWN teardown** (`SCREENS.customize.onHide` in customize.js,
    `SCREENS.options.onHide` in options.js) rather than screens.js reaching into their state.
    This is load-bearing, not tidiness: **Esc now walks the tree** (`backScreen()` in the keydown
    handler, replacing the league-only special case), so leaving Customize by Esc never calls
    `closeCustomize` — without the hook the turntable would keep rendering through the shared
    preview context behind the menu. Any future screen with live state needs the same.
  - `backScreen()` returns **false** at a top-level screen (`back:null`) so Esc on the menu still
    falls through to `togglePause()` instead of being swallowed. Free wins from the generic
    handler: Esc now backs out of Customize / Slots / New-League.
  - **`championsCup` is `back:null` ON PURPOSE** and it's the one place a registry `back` would
    have been wrong: leaving the cup bracket isn't a plain screen change. Arriving there from a
    finished tie's win screen leaves `S.lg` still set, and `cupReturn()` (the Back button) clears
    it via `gotoMenu` before re-opening the lobby with fresh content — a bare
    `showScreen('league')` would strand the bridge and render a stale lobby. Worth checking for
    on any screen you give a `back`: **does its Back button do more than navigate?** If so the
    extra work belongs in an `onHide` first.
  - Load order: `screens.js` sits between `config.js` and `intro.js` in index.html's boot list.
    It resolves elements LAZILY (never caches `$(id)`) so it can load before the DOM settles and
    before any screen's own module has parsed; `layApply` is called through a `typeof` guard
    since layout.js loads much later. `scrCur` starts at `'menu'` — the screen the intro reveals.
  - **`intro.js` was NOT touched in step 1**: it toggles `introHide`/`introIn`, never `.hidden`,
    so it never interacted with the router — it was handed to step 2, which repointed it at
    `#home` along with the `#menu.introHide`/`#menu.introIn` CSS rules.
  Verified by re-read (sandbox wouldn't boot).

### 2026-07-28
- **Between-row LANES are dead zones now** (`CONFIG.deadball.rodGaps`, `js/powerups.js` `rodGaps()`
  + `deadzoneMult`, `js/debug.js`). A rod's men only strike a band of x around their bar — a good way
  ahead on the swing, barely anything behind — so between two rows there's a strip of pitch neither
  can play. A ball that stops in one sat there for the full `stallT` with both teams looking at it.
  - **`rodGaps.lanes` is a HAND-LISTED array of `{x0,x1}` x-ranges, one per gap** (optional per-lane
    `mult`), full pitch width. First cut derived them from RODDEFS × a forward/back reach pair, which
    was clever and wrong for the job: the owner wants to tune each strip by eye, and two knobs that
    move all seven lanes at once is the opposite of that. **Don't re-derive it.** Rods sit 15 apart at
    ±7.5/±22.5/±37.5/±52.5, so each lane lives inside one 15u gap; each entry carries a comment naming
    its two rows. Only x matters — rods slide the full width in z.
  - Widths differ by ROW ORIENTATION, worth knowing when retuning: two rows FACING each other both
    swing into the gap and leave ~2u; two rows of the SAME team leave ~5u (one strikes forward into
    it, the other only back-sweeps); two facing AWAY leave the most, since neither can swing in at all
    — those (`±15`) are set to 6u, deliberately tighter than the ~9u the geometry alone implies.
  - Worth recording since it drove the first attempt: the foot can physically reach ~7.6 ahead and ~7
    BEHIND at full swing (from `arm`/`footBox`/`footBoxOff` vs a ball at y=BALL_R), but nothing ever
    SWINGS at a ball outside the AI's windows (`inFrontMax` 6.3 / `underFootBack` 2.9), so the useful
    reach is the smaller pair. The lanes are set by feel between the two.
  - `mult:2`, deliberately gentler than the pocket/roof 3 — a lane ball can still be nudged by a
    raise-and-drop, a corner pocket is hopeless.
  - **Corner pockets are tested BEFORE lanes** so a table defining an overlapping pocket keeps its
    stronger mult. They don't currently overlap (outermost lane ends at 46, pockets start at 47).
  - Debug: the **Dead Zones** layer (`C`, red) draws each lane as the SAME flat plate as the corner
    pockets, straight off `rodGaps()` — the overlay is literally the list the timer reads.
    `on:false` = old behaviour.
  - **`dzY` (0.35) is now the shared plate height for the whole layer, and it is NOT cosmetic.** At
    the corner pockets' original 0.05 the lanes were INVISIBLE: a table skin's GLB field sits a hair
    above y=0 and buries a decal that thin. It only showed up on the lanes because the corner plates
    sit out past the slide range where the pitch mesh doesn't cover them. Raise `dzY` if a new skin
    hides the layer again.
    Also note `updateAIVis`'s vis test needs its `!!` — `dz.band` is an OBJECT, so without it
    `mesh.visible` gets assigned a truthy object rather than a boolean.
  Verified by re-read (sandbox wouldn't boot). NOT tuned against live play — `reachFwd`/`reachBack`
  are the dials; raise them to shrink every lane at once.
- **A ball settled ON TOP OF THE GOAL now runs the fast dead-ball timer** (`CONFIG.deadball.roofMult`,
  `js/powerups.js` `deadzoneMult`, `js/debug.js`). `goalFrameCollide` keeps a SOLID net roof over each
  goal box so an over-the-bar lob can't drop in and score — but the ball then sits somewhere no rod can
  reach, which is exactly the corner-pocket case `zoneMult` already existed for, and it reads worse
  because it's in plain sight. Full `stallT` (3.6s) of nothing; now ~1.2s at the default `roofMult:3`.
  - **It went in `deadzoneMult`, not as a new test in `deadBallUpdate`** — that function is already
    "how fast should the stuck timer tick HERE", the displacement-box machinery around it is
    position-agnostic, and a ball resting on the roof boxes in exactly like one in a pocket. So this is
    one extra clause, no new state, no second timer.
  - **The box mirrors `goalFrameCollide`'s roof test exactly**, including the per-goal big-goal widen
    (`S.eff[p.x>0?0:1].big` — `S.eff[0]` widens the RIGHT goal, same as physics). If the roof collider
    ever moves, this must move with it or a ball will rest on a roof the timer doesn't know about.
    `p.y>goalH` is the y gate: a ball resting up there sits at `goalH+BALL_R`, and anything in FLIGHT
    above the box is moving, so the displacement box resets `stuckT` regardless.
  - **`deadzoneMult` no longer early-returns on a table with no `deadzones`** — the roof is
    table-independent (the classic, arena and circuit shells all get the same analytic goal frame), so
    the `!zs` bail moved BELOW the roof clause. Worth knowing if you add another global dead region.
  - Debug: the existing **Dead Zones** layer (`C`, red) gained a plate at `y=goalH` over each goal box.
    Its hot test calls `deadzoneMult` rather than restating the box, so the overlay can't drift from the
    timer it explains. Drawn at the stock mouth width, so under 'big goal' the live zone is wider than
    the plate. Built only when `roofMult>1` (build-time read, like the rest of the layer).
  - `roofMult:1` restores the old behaviour exactly. Verified by re-read (sandbox wouldn't boot).
- **Goal net is a SWEPT CROSS-SECTION now, with rounded top side creases** (`CONFIG.goalNet`,
  `js/world.js` — `netProfile`/`netGeo`/`buildGoalNet` replace `netQuad`). The net's shoulders met the
  roof at a bare 90° while the frame beside them has a rounded post/crossbar joint; the two read as
  different objects. The net was five hard-coded quads (`FBL`/`FTR`/`BTL`… corner vectors), so there
  was nowhere to put a fillet — hence the rewrite rather than a patch.
  - **The shape is DATA now.** `netProfile(hw,gh,r,n)` returns the cage outline as `[z,y]` pairs walked
    from the floor's −z corner up, over the roof and back down to +z; the floor closes the loop. The
    two top creases are a quarter-arc of radius `r` about `(±(hw−r), gh−r)`. `buildGoalNet` calls it
    TWICE — once at the mouth (`goalHalf`, `goalH`), once at the rear plane — and sweeps quads between
    the two, pairing them **index-for-index**, which is why `r` and `segs` are resolved by the CALLER
    and passed in: computing them per-station would let the two profiles come back with different
    point counts on a clamp boundary and the sweep would shear.
  - **`r=0` reproduces the old geometry exactly** (P=4: side, roof, side, floor) — that branch exists
    so the bevel is a true off-switch, not an approximation of one.
  - **2 draw calls per goal, was 5.** All swept panels merge into one geometry, the back cap into
    another (the rear profile is convex, so a fan off point 0 triangulates it). Verts are NOT shared
    between quads — each carries its own UV origin, and that also keeps normals flat per face as
    before. `bigGoalUpdate`'s taper is untouched: it walks any `userData.base` array generically by
    local x/z, which `netGeo` still stamps.
  - **UV detail that matters if you retune:** `u` accumulates the REAL profile length (`/cell`) rather
    than resetting per panel, so the net flows continuously round the bevel with no seam AND the short
    arc facets don't get a stretched full cell each (the old `Math.max(1,round(len/cell))` would have
    given every ~0.7u facet a whole cell). `v` is a single shared sweep depth for the same reason —
    per-panel depth would let two panels disagree along the edge they share.
  - **Cosmetic only.** `goalFrameCollide` is analytic (flat roof plane at `goalH`, posts at
    `goalHalf`), so nothing about physics changes — but a ball resting on the roof within `r` of the
    side now floats slightly off the visual net. Invisible at `r:1.8` against `goalHalf:11`; it's the
    thing to watch if you push `r` hard.
  - Tuning: `CONFIG.goalNet.bevel.r` (1.8, auto-clamped to half the mouth half-width / half the goal
    height) and `.segs` (4; 1 = a flat chamfer). `cell` (1.6) and `backInset` (0.98) were hardcoded
    magic numbers inside `netQuad`/the corner vectors and are now knobs too.
  Verified by re-read (sandbox wouldn't boot).
- **Dribble action (`r.act='dribble'`) + PASSING** (`CONFIG.ai.dribble` incl. nested `pass`,
  `CONFIG.ai.passShot`, `js/ai.js`, `js/rods.js`, `js/physics.js`, `js/stats.js`, `js/world.js`,
  `js/debug.js`). Fixes two things that made attacking play read as pinball: **the ball ping-ponging
  between two rods**, and **wingers hammering the end wall instead of moving central or laying it off**.
  - **Why it happened.** `canKick` fires at ANY reachable ball (`overFoot||inFront`) whether or not a
    shot is on, so a covered rod pokes it straight back into the row opposite. And `gapAim` only picks
    WHERE IN THE MOUTH to aim **from wherever the ball already is** — nothing ever asked "would I have
    a better shot if the BALL were more central?". Out wide every lane is a narrow diagonal, so the
    widest is still bad, and `aimAssist` bends the strike into it. `holdShot` kept possession for up to
    2.5s but never MOVED, so a covered winger stood still and then fired anyway. The trap's CARRY was
    the only thing that repositioned a held ball, and its window (`back −5.8..front 1.4`) never overlaps
    `inFront` (2..6.3), so a ball arriving from the front was poked before it could ever be a candidate.
  - **IT IS EXPLICITLY NOT A TRAP** (owner call, and the mechanics follow from it). **No angle.** The
    action appears nowhere in `updateRods`' angle chain, so the rod keeps the ORDINARY REST angle and
    the men stay DOWN — which is the posture the ball is actually sitting at when this comes up ("the
    ball is at their feet when they are lowered, and good control should let them slide to a better
    line"). It is also the one case the trap could never serve: at `trap.angle −0.5` the foot box
    centre sits ~3u behind the rod and off the floor, so a ball resting at a lowered boot gets shoved
    away rather than settled. All the action overrides is the CONTACT — `holdGrip 0.30`, a nudge with
    visible slip, against the trap's 0.55 weld and a passive touch's ~0.08 — plus `r.target`/`r.aiMan`
    while it works. It ends with an **ORDINARY swing** (`kickRod(r)`), not a scoop: the ball is already
    in the normal strike zone with the men down, so the normal curve is the right one.
  - **Roles `['ATT','MID','DEF']`.** DEF is in deliberately — a defender's job here is to work the ball
    past the opposing ATTACK row instead of belting it into them. `ownGoalGuard:14` is what keeps that
    honest (the DEF row sits ~22.5 from its own line, so it can work the ball; nothing dribbles in the
    six-yard box). GK never dribbles.
  - **`outletClr` is what makes one action serve both ends of the pitch** — "how good is my way forward
    if the ball were at z". For an **ATT** that's `min(fwdClr, shotEval)`: the goal is the next thing in
    front, so the way forward IS a shooting lane. For **everyone else** it's `fwdClr` alone — the z-gap
    past the nearest opposing ROW. Using `shotEval` from deep would answer with a uniformly awful number
    for every candidate z (11 opposing men across 80 units): noise, not a gradient, so the scan would
    have been driven entirely by `centrePull` and a defender would just walk the ball to the middle.
  - **Target choice is the winger fix**: `dribTarget` scores candidate ball-z's across the dribbling
    man's own reach by `outletClr` **+ `centrePull`·(how much closer to centre) − `travelCost`·(distance)`.
    From wide, nothing scores well so the centre term decides and the winger cuts infield; from a decent
    central spot the outlet term dominates and the target lands where the ball already is — which
    `minGain` then reads as "nothing to gain", and the rod just plays it.
  - **THE WINDOW IS GEOMETRY, NOT TASTE.** Derived at the REST angle (a=0), which is this action's
    posture — contrast `trap.back/front`, derived at its −0.5 pin. At rest the box centre is `+0.40`
    dir-relative and `y=1.85`, i.e. *already dead level with a ball centre at 1.9* (that's why no pin
    angle is needed or wanted), with x half-reach 2.90 → contact possible for `rel ∈ −2.50..+3.30`,
    hence `back −2.2 / front 3.0` ≈ `overFoot`. An earlier cut used `front:4.4` and would have had the
    rod sliding about beside a ball ~4u away that it was not touching, until `abortT`.
  - **Priority: dribble BEATS trap**, even though its block sits below trap's in the file. Their windows
    overlap and for a ball already settled at the feet the dribble is better (works from the resting
    posture the ball is in, scores a POSITION not just a lane, can pass). `dribFirst` in the trap's
    entry does the deferral, and includes `(dribEvT<=0)` so it lasts exactly as long as the dribble's
    FIRST REFUSAL: scan, decline, and the next frame trap picks the ball up as it always did. **No ball
    falls between the two actions** — that gap is the thing to check if you retune either window.
  - **Release squares up.** When a release is wanted (`want`) but the ball isn't `aligned`, the carry
    lead drops to 0 and the man aims dead at the ball, so alignment converges instead of the action
    running to `abortT` mid-push. The release itself uses the NORMAL `aligned` test, not the looser
    `alignZ 2.2` the control runs on — pushing a ball sideways needs less precision than striking it.
  - **Passing.** `passEval` scores every live man of each teammate rod ahead on `clr` (can the ball even
    reach him — `lineClr` against `laneObs`) + `onward` (`shotEval` from HIS position) − distance. Fires
    from two places: the dribble's release, and — via `pass.onKick` — a NORMAL swing whose lane is
    covered, so build-up happens even when there was no time to take the ball down. Executed as
    `kickRod(r,'pass',{x,z})`; `aimAssist` bends at the RECEIVER instead of the goal with its own larger
    bend/cone and a much lower `assistMinVX` (a pass is slower than a shot, so the shot's gate of 20
    would have skipped it entirely). Note the 1-2-5-3 interleaving means **a same-team pass lane never
    contains our own men** — exactly one opposing rod sits between any two same-team rods.
  - **`noPoke`** widens `holdShot` to the `inFront` window for a dribbling role with a covered shot: the
    full-stretch poke is what fires the ball back up the table, and the ball has to be ALLOWED to reach
    the feet before the dribble can take it.
  - **`pressX` has a minimum useful value.** The release-under-pressure test was first written at 9 and
    was PERMANENTLY FALSE: rods are 15 apart and this window keeps the ball within ~3 of its own rod, so
    the ball is never closer than ~12 to an opposing rod. 13 is the smallest number that means anything.
    Worth remembering for any future "is an opponent near the ball in x" test.
  - Plumbing: `kickStyleCfg(r)` and `holdCfg(r)` (rods.js) replace the scattered
    `kickStyle==='trapShot'?…` / `act==='trap'&&kickT<0` tests — a new kick style or holding action is
    now a config block plus one line. `kickRod` gained an `aimAt` param (cleared per swing, and on swing
    completion in `updateRods`, so no stale aim target can leak into a later contact). `shotEval` gained
    an optional precomputed `obs` (identical for every sampled z), which is what makes the 9-sample
    `dribTarget` scan affordable; both it and the pass scan are cadence-gated (`reEval` / `pass.every`).
  - Debug: **Dribble** AI panel layer (violet `#7a5cff`) — trigger band per eligible rod, hot while
    dribbling, plus a live disc at the committed target z and a line to the pass receiver. Kick-log
    lines `ACT:dribble`, `DRIB-HIT`/`DRIB-PASS` (carrying which reason fired), `DRIB-END`, `PASS`.
  - `dribble.on:false` / `pass.on:false` restore the old behaviour exactly.
  - **Crash fixed during this work, worth knowing the shape of:** `goalDist`/`ownGx` were declared in
    the trap preamble and I removed them intending to hoist them above the dribble block, then took a
    different approach (`dribFirst`) and never re-added them — `ReferenceError: goalDist is not defined`
    on the first AI frame. They now live with `relReal`/`speed`/`approach`, which is where any value
    read by more than one action block belongs.
  Verified by re-read (sandbox wouldn't boot). NOT tuned against live play yet — `centrePull` (0.45) is
  strong enough that a wide man will essentially always cut in; drop it toward 0.2 if that reads as
  over-eager. `pass.bias` (0.9) is the shoot-vs-pass dial, and `holdGrip` (0.30) is how sticky the
  control feels — raise it if the ball squirts away as they slide, drop it if the ball looks glued on.

### 2026-07-27
- **Power-up pickups render from GLB models** (`CONFIG.powerups`, `js/models.js`, `js/powerups.js`,
  `js/fx.js`, `js/state.js`, `js/main.js`). The floating pickup was a procedural octahedron + halo
  ring built fresh every spawn; `boost` and `freeze` now float their own models
  (`assets/fuzeball_powerup_boost.glb` / `fuzeball_powerup_frost.glb`). `big` has no GLB yet and
  keeps the octahedron — which is the fallback for ANY type with no `models` entry or a GLB that
  404s, so a missing file is only a cosmetic downgrade (the pickup still spawns and still collects;
  collection is a sphere test against `pickR`, never the mesh).
  - **Config.** `CONFIG.powerups` gained `spin` (idle yaw, was hardcoded 2.4 in TWO places —
    `powerupUpdate` and `fxUpdate`), `gem{r,emissive,roughness}` and `ring{on,inner,outer,y,opacity}`
    (the old hardcoded fallback look), and `models{on, <key>:{src,fit,scale,yaw,tilt,y,spin,glow,
    glowCol,ring,shadow}}`. `models.on:false` restores the old look everywhere.
    **`fit` is the one to reach for first**: the model is recentred on its own bbox and rescaled so
    its bounding-sphere radius is `fit` world units (gem ≈ 2.1), so the authored Blender scale is
    irrelevant — drop a GLB in, add a line, it arrives the right size and spins about its middle
    rather than about whatever origin the artist left. `scale` is a multiplier on top; `fit:0` keeps
    the authored size.
  - **Everything that touches a MATERIAL is baked into the TEMPLATE at load** (`glow`/`glowCol`
    emissive, `shadow` flags) and the templates are shader-warmed off-screen at boot
    (`warmPowerupShaders`, idle-nudged, mirrors `warmFractureTemplate`). A per-spawn material edit
    would be a fresh material → a shader compile at the exact frame the pickup pops in.
  - **Baked KHR lights are STRIPPED from the template on load.** A pickup joins the scene mid-match,
    and r128 bakes the scene's light COUNT into every material's program — one light riding in on
    the GLB would force a whole-scene recompile on spawn AND on collection. See MEMORY / the
    2026-07-24 fx-light-pool entry; use `glow`, or borrow from `fxLightGet`.
  - **`disposePU` only frees PROCEDURAL parts now** (stamped `userData.puOwn` at build time). A GLB
    pickup is a `clone(true)` sharing geometry+materials with the resident template, so the old
    blanket traverse-and-dispose would have blanked every future pickup of that type after the first
    collection. New `makePUVisual(t)` builds the group (model or gem, + optional ring); the model
    sits one level under the spinning group so its resting `yaw`/`tilt` survive the spin.
  - Loaded via `loadPowerupModels` in `startLoading`, deliberately OFF the boot chain (nothing waits
    on it — the earliest pickup is ~10s into a match) but at boot rather than on demand, so the
    fetch+parse never lands mid-rally. `S.pu.spin` carries the active model's spin rate.
  Verified by re-read (sandbox wouldn't boot).
- **Trap own-goal fix: the CATCH shoved a ball behind the keeper into its own net** (`js/ai.js`,
  `CONFIG.ai.trap.behindSafe`/`ownGoalBehind`). Logged: `ACT:trap/catch rel=-3.5 tdz=1.37 spd=35`
  — a GK caught a ball 3.5u BEHIND it (between keeper and net) and knocked it in. Mechanism:
  `trap.angle` is a BACKWARD tilt (−0.5), so the catching foot ends up ~`sin(0.5)·ARM ≈ 3u` behind
  the rod, on the own-goal side; the trap contact resolves the ball along the foot→ball normal with
  `holdRest:0`/`holdGrip:0.55`, and for a ball behind the feet that normal points GOALWARD, so the
  catch drags the ball into the net. The old `ownGoalGuard` was DIRECTIONLESS (raw x-distance to own
  goal) and at 4 far too small to protect a keeper sitting ~7.5u from its line. The guard is now
  **directional**: `ogGuard = relReal<behindSafe ? ownGoalBehind : ownGoalGuard`. A ball BEHIND the
  feet (`relReal<behindSafe` −0.6) uses the big `ownGoalBehind` (16) — the GK never traps a ball
  behind it (a backward catch there can only go in the net), the DEF (~22.5u out) still can. A ball
  IN FRONT keeps the small `ownGoalGuard` (4): the catch tilts AWAY from it, normal points upfield,
  safe even hard by our own goal. Applied to BOTH the entry gate and the live abort, so a trap whose
  ball drifts behind the feet after being caught now releases instead of scoring on us. The keeper can
  still trap/hold a ball in front of it to start a counter. Verified by re-read (sandbox wouldn't boot).
- **NOTE — files changed by owner since the trap rewrite** (read fresh before editing): trap tuning
  is now `angle:-0.5`, `back:-5.8`, `front:1.4`, `alignZ:1.1`, `holdT:3.3`, `carryLead:1.2`,
  `abortT:3.4`, `ownGoalGuard:4`; a new **lane-clear action** (`r.act='lane'`, 2026-07-26 below) now
  runs BEFORE safeRaise/trap/evade; `footTrapZ` 1.0→0.8.

### 2026-07-26
- **Lane-clear action (`r.act='lane'`) — a rod MAKES WAY for the teammate behind it**
  (`CONFIG.ai.clearLane`, `js/ai.js`, `js/rods.js`, `js/world.js`, `js/debug.js`). Fixes "the DEF
  parks in front of the keeper and blocks its clearance". The ball sits in the 15u GK↔DEF gap and
  the defence smothers it, because **every aiming path tracks the ball's z whether it's in front of
  the rod or behind it** — man-selection slides a DEF man onto a ball it cannot legally strike, and
  then one of two things puts a boot in the kick path:
  - the men LOWER (raise is only latched by `raiseBehind` −7.5, so a ball that never went deeper
    than that — deflected in, or carried forward by the keeper — leaves the row down), or
  - **`safeRaise` fires**, and its band is `rel −5.8..0.45` — i.e. it IS the keeper↔defence gap. It
    sets `r.raise=false`/`behindFlag=false` every frame (so no latch is ever built), eases to
    `angle −0.8`, which puts the boot ~4.5u BEHIND the rod at y≈3.1 — a half-lifted foot sitting
    exactly where the keeper's ball is about to travel — and man-selection keeps running underneath
    it (safeRaise doesn't `continue`), so the row slides ONTO the ball's z while it hovers. That is
    the "raising behind as they do" in the report.
  New action runs BEFORE safeRaise/trap/evade and outranks all three, since each of them wants to
  play a ball that isn't this rod's to play. Entry: ball low, `behind`(−3.5) > rel > `−nearBall`
  (−16), and `laneMate(r,ball)` finds a teammate rod behind us with the ball on our side of it.
  While held it **slides the men out of the corridor** (`clearOffset` minimum-travel escape, width
  `footBox.z+BALL_R+laneMargin`, direction committed once in `r.laneDir` for the same anti-dither
  reason as `evadeDir`) and **lifts** (`CL.lift`, full `raiseA`) — but only when `!footStuck`, since
  a lift with the ball in back-swing reach sweeps the foot backward through it into our own goal.
  The slide clears z first, which un-gates the lift by itself. `continue`s, so no re-aim, no kick.
  - **Scope is deliberately narrow — three gates in `laneMate`, all of them load-bearing:**
    `roles:['DEF']` (a MID/ATT stepping aside mid-pitch isn't clearing a keeper's line, it's just
    opening the field for the opposition); `nearBall` 16 (rods are 15 apart, so only the row
    immediately in front of the handler makes way — without it every rod within `mateReach` lifts
    and the midfield is handed away); and a **Z-BAND test — the ball must be inside the MATE's own
    z-slide range** (`baseZ[0]−maxOff … baseZ[n−1]+maxOff`, ± `zPad`). For a DEF the mate is always
    the keeper, since the GK is the only rod behind it. Out by a corner or hard against a side wall
    the keeper cannot slide onto the ball, so there is no clearance to make way FOR and the row
    reacts exactly as it did before. Because the z test lives in `laneMate`, it gates the HOLD as
    well as entry: a ball drifting out of the keeper's band ends the action (unless it's already
    been struck, which is the `throughV` branch).
  - **Handover is the part that must not break** (the ask was "the DEF must still be able to take
    over"). It only ever holds a ball BEHIND us, and releases at `release` (−2.0 — deliberately a
    lead ahead of the overFoot zone's −0.8 so the men are DOWN again by the time a slow ball
    becomes strikeable; the 1.5u gap to `behind` is the anti-ping-pong hysteresis, backed by
    `cd` 0.35). A ball already STRUCK (`approach > throughV` 12) instead holds the lane open until
    it is `passed` (3.0) clear of us — otherwise the row exits the moment the mate lets go and
    drops straight onto the clearance it just made way for.
  - **Possession is tested GEOMETRICALLY, not via `S.lastTouch`**: `laneMate` requires that no
    OPPOSING rod is nearer the ball in x than the mate is. Only rods near the ball in x can touch it
    at all, so this is both stricter and never stale (a redrop, a deflection, or the other ball in a
    multi-ball point can all leave `lastTouch` lying). Stops a defence politely clearing a lane for
    an opponent standing in our own six-yard box.
  - **Benched rods get the LIFT only** (in the `!isActiveRod` branch): a resting hand holds its lane
    in z by design, but it must not stand in the kick path, so the clearance passes under its feet.
  - `approach` (`best.v.x*dir`) hoisted next to `relReal`/`speed`; the trap block reads the hoisted
    one. New rod fields `laneDir`/`laneCd` (declared in `buildRods`, cleared in `kickRod` +
    `resetRodRotation`, `laneCd` ticked in `updateRods` beside `evadeCd`). New helpers `inLaneZ`
    (z-slice of `inFootRange` at a caller-supplied corridor width) and `laneMate`.
  - Debug: **Make Way** AI panel layer (pink `#ffa1f0`) — floor box drawn ONLY on rods in `roles`,
    spanning the real trigger region (`−nearBall..behind` in x by the handler's slide band ± `zPad`
    in z), hot while that rod's `r.act==='lane'`; plus an `ACT:lane` kick-log line carrying
    `rel/appr/tgt/blk/lift`. `on:false` restores the old behaviour exactly.
  Verified by re-read (sandbox wouldn't boot).

### 2026-07-25
- **HUD de-genericised: notification TIERS + scoreboard-anchored effect rails + emoji purge**
  (`js/fx.js`, `js/hud.js`, `js/config.js`, `js/state.js`, `js/balls.js`, `js/physics.js`,
  `js/powerups.js`, `js/flow.js`, `js/training.js`, `js/debug.js`, `js/input.js`,
  `js/sweetspot.js`, `index.html`, `css/styles.css`). Everything below is about the HUD reading
  hand-made rather than generated — the ambition note at the top of this file.
  - **Three notification channels, was one.** `banner()` was the ONLY channel, so toggling the
    kick log got the identical 74px screen-wide treatment as scoring a goal. Now:
    **`banner(main,sub,dur,col)`** tier 1, stop-the-world (kickoff / goal / sudden death);
    **`notice(main,dur,col)`** tier 2, a live event the player already SAW — one line at
    `top:108px`, out of the play area, no subtitle narrating the visuals (special ball, split,
    dead ball, out of play, player down, power-up collected, training goal);
    **`toast(main,sub,dur)`** tier 3, system/dev chatter, small + bottom-left (kick log,
    collision debug, free roam, sweet spot, training entry). All three live in `fx.js` next to
    each other. `col` accents the rule/left-bar — pass a TEAM or BALL colour.
  - **Banner restyle.** Dropped `text-shadow:0 0 30px rgba(120,180,255,.9)` — a team-neutral blue
    glow that washed the glyph edges AND collided with `--c1` (so a red goal and a blue goal read
    the same). Replaced by a hard `0 4px 0` drop shadow plus a solid 5px rule under the headline
    in `--bc` (the scoring team's colour, `teamCol(team)`). The rule hangs off **`#bannerMain`**,
    not `#banner` — banner() wraps `main` in that span, or with a sub present the rule would land
    under the sub chip. Entrance is a left-to-right `clip-path` wipe (`bnrIn`) unskewing
    −15°→−7°, not the old symmetric `scale(.6)→scale(1)` pop (reads as a web modal). `#bannerSub`
    is a solid tag chip now instead of `.4em`-tracked caps.
  - **`font-weight:900` on Russo One was SYNTHETIC bolding** — the family ships ONE weight (400),
    so the browser was smearing the outlines; that's why the HUD looked slightly mushy. Dropped to
    400 on `#banner`, `#count`, `#sb .nm`, `#sb .sc`, `.chip`, `.fxTab`. Rajdhani ships 500/600/700
    — don't ask it for 800 either. **The menu/panel CSS still has Russo One at 800 in several
    places (`.modeCard .big`, `.panel h3`, `.ctl b`, `.rodOpt`) — same fix applies, not done yet.**
  - **Effect rails replace `#fxchips`.** The old `.pwr` cards floated top-right with no spatial
    link to what they affected. Two rails (`#fxRail0`/`#fxRail1`) are now absolutely positioned
    children **of `#sb`**, so a tab grows out of the score it belongs to — red extends left of the
    red score, blue right of the blue. Skewed hard-edged slabs (`skewX(-9deg)`, content un-skewed
    via `.fxTab>b`), deliberately NOT another 14px glass card: different silhouette = different
    class of information. **The tab IS the timer** — its own fill (`.fxTab i`) drains toward the
    inner edge via `transform-origin`, so it visibly empties back into the scoreboard, then
    retracts. That retires the separate `.pwrbar` and all three idle loops (`pwrBob`, `pwrArrow`,
    the radial sheen) — motion is spent on enter/exit/state only. Also retired: the `ATK ▶` arrow
    and the team NAME in the card (position + colour already carry that; it was three channels for
    one fact).
  - **`fxRailSync` does per-tab DOM diffing** (`fxTabs` Map keyed `team+effectKey`), replacing the
    `fxSigCache` whole-container `innerHTML` rebuild. The rebuild restarted EVERY card's entrance
    animation whenever any other effect started or expired — invisible with static cards, constant
    flicker with animated ones. The drain animation is re-armed only when `dataset.end` moves (a
    re-collect extending the effect), never on the 10Hz tick. **`clearFxRail()` must be called
    wherever the HUD is torn down** — wired into `startMatch`, `endMatch`, `gotoMenu`; without it
    a tab whose exit animation is running on a hidden HUD orphans its Map entry and the next match
    thinks that effect is still live.
  - **Emoji purged from HUD/banner/win-screen strings.** OS colour emoji render differently per
    platform, ignore the palette, can't be tinted, and are the single loudest generated-UI tell.
    Gone from `BALL_TYPES.*.name` (`'⚽ CLASSIC'`→`'CLASSIC'` etc.), `puTypes[].ico` (field
    DELETED), `FX_EFFECTS[].ico`, the `💣`/`👯` banners, the `💥` cannonball fuse, and the
    `⚔`/`⚙`/`🛡` win-screen lines. Replacements: **`FX_ICO`** (hud.js) is three inline SVGs on
    `currentColor` so the mark tints to the team colour; **`setBallTag(key,fuse)`** (hud.js) draws
    a colour swatch in the ball's own `trail` colour + the name, and is the ONLY writer of
    `#ballTag` now (it signature-gates because the cannonball fuse path calls it every frame).
    **Keep `BALL_TYPES.*.name` emoji-free — it's HUD copy.** STILL EMOJI, deliberately out of
    scope: `CONFIG.playerModel.models[].ico` (`'🤖'` on every robot, `'🏃'` fallback) as used by
    `customize.js` and `league.js` — menu screens, not the HUD.
  - Copy pass: subtitles that narrated what the player just watched are gone (`SPECIAL BALL
    DROPPING`, `TWO BALLS IN PLAY`, `ONE PLAYER TAKEN OUT`, `BALL RETURNS`, `RE-DROP`, `GOOD
    LUCK`). `HYPE` lost `'THE CROWD ERUPTS'` (described the scene, not the shot — that's the tell
    to avoid when adding lines).
  Verified by re-read (sandbox wouldn't boot). NOT yet done from the same review: the uniform
  10–14px radius + glass treatment on every HUD element (score plate, chips, ballTag, debug
  panels all share one silhouette), and swapping Russo One for a bought/condensed display face —
  Russo One is heavily used in free jam UI and is itself a recognisability problem.
- **Menu-side pass: shared SVG icon set + every remaining synthetic weight** (`js/core.js`,
  `js/config.js`, `js/customize.js`, `js/league.js`, `js/training.js`, `js/main.js`, `index.html`,
  `css/styles.css`). Same two problems as the HUD pass, applied to the screens outside the match.
  - **`ICO` + `ico(key,cls)` now live in `core.js`** (first file loaded, so everything can reach
    it): seven inline SVGs — `rod` / `duel` / `trophy` / `target` / `cog` / `figure` / `lock` —
    drawn on `currentColor` and **sized by CSS, never by a font-size on a glyph**. `ico()` emits a
    `<span class="ico …">`; `.icoInline` is the 1em run-of-text size. Static markup (mode cards,
    the options gear) inlines the same SVG directly rather than calling the helper, since it's in
    `index.html` before any script runs.
  - **Mode cards carry their accent colour AT REST now** — `.modeCard.red .ico{color:var(--c0)}`
    and friends. Previously the card was uniformly grey until you hovered it, because a 🔴/🔵/🤖/
    🏆/🎯 emoji can't be tinted. The play cards use the `rod` mark (bar + three men), which is at
    least about foosball; AI Showdown uses `duel` (a pitch with a man each side).
  - **`CONFIG.playerModel.models[].ico` is DELETED** (was `'🤖'` on five robots, `''` on the other
    eleven, with a `'🏃'` fallback at each read site — so most of the roster showed a running-man
    emoji). Readers updated: `customize.js` `initCustomize` uses one shared `ICO.figure` for every
    card (they ARE all humanoid figurines — the emoji split implied a distinction that isn't
    real), the lock card uses `ICO.lock`; `league.js` `renderLgScout` uses `ico('figure')`, and
    **both** versus-tape `fig()` helpers (league `renderLgTape` AND cup `cupRenderTape` — they're
    separate copies, easy to fix only one) dropped their `icon` parameter entirely, since the
    caption sits directly under a render of that figurine.
  - Remaining emoji swapped for `ico('trophy')` / `ico('cog')` where the mark carries meaning
    (champion lines, cup qualification, parts currency, season history) and dropped to plain text
    where it didn't (SNAPSHOT, RANDOM, Champions Cup, Controls/Display tabs, View Trophy, and the
    whole training panel). **`⏸`/`⏭`/`📍`/`🚀`/`🎯` have emoji presentation by default on
    Windows** — they were rendering full-colour inside a monochrome gold dev panel. `✕`, `↻`, `▲`,
    `▼`, `⊞`, `—` and the `★`/`✓`/`✗` kick-log markers are TEXT-presentation and render monochrome
    everywhere, so they all stay.
  - **Every remaining synthetic weight is gone.** All `'Russo One'` rules are 400 (the family's
    only weight); Rajdhani-inherited ones capped at 700 (it ships 500/600/700). The subtle one:
    **`.panel h3` and `#trnPanel h3` declared no `font-weight` at all**, so they inherited the UA's
    bold default — identical smear to an explicit 800, and invisible to a grep for `font-weight`.
    Any future Russo One heading must state its weight rather than inherit it. `.lgSEDivHead` was
    at 600, also synthetic. `.lgSEFate .lgSEPos` inherits Russo One from its parent, so it's 400
    rather than 700.
  Verified by re-read (sandbox wouldn't boot). Checked for identifier collisions on the new
  top-level `ICO`/`ico` (none — `hud.js` has `FX_ICO`, which is separate and HUD-only).
- **Figurine mugshots on the player-select card** (`js/core.js`, `js/config.js`, `js/customize.js`,
  `js/league.js`, `css/styles.css`). Replaces the shared `ICO.figure` mark on `.czCard` with the
  rendered portrait when one exists.
  - **`CONFIG.playerModel.models[].mug`** — path to the portrait. **Predeclared for the WHOLE
    roster** (only cyborg / deltaborg / irnman are rendered as of this entry): drop the PNG at the
    listed path and the card picks it up on the next load, no code or config edit. Cost of that
    choice is a 404 per un-rendered figurine the first time the Customize panel opens; it goes away
    as they land. **The filename stem follows the existing `render_<stem>_cycles.png` habit, which
    does NOT always match the model id** — `womanAndroid` → `jennyBot`, `manrichie` → `richie`,
    `manJerry` → `jerry`, `mechaMan` → `mechaman`, `womanMaria` → `maria`. Check the stem when
    adding a figurine or the portrait silently won't appear.
  - **`mugImg(model,host,cls,onCls)`** (core.js, next to `ico()`): builds the `<img>`, inserts it
    over whatever fallback mark is already in `host`, and stamps `onCls` **on load, not up front**.
    That ordering is the point — a miss (`onerror` → `im.remove()`) leaves the icon layout exactly
    as it was, so there's no broken-image frame and no layout jump. `loading='lazy'` keeps 16
    portraits off the boot path since the panel is `display:none` until opened.
  - `.czCard.hasMug` is a portrait state: image absolutely positioned over the (hidden) icon, name
    in a gradient bar along the bottom. **`object-position` is deliberately centred** — the renders
    are square, head-and-shoulders and already tightly framed, so a pull like `50% 14%` would crop
    the top of the skull off; the centred origin only matters if a future render isn't 1:1. The
    cards carry a radial backdrop because the mugshots are **transparent PNGs** and would otherwise
    float on the flat card fill.
  - Also wired into `renderLgScout` (`.figMug`, a 22px round thumbnail in place of the figure
    icon) — attached AFTER the `innerHTML` build, since that string is assembled wholesale. The
    versus-tape is deliberately NOT using it: it already shows a full `modelRender`, which is
    better than a mugshot.
- **Season-end screen review + `lgSEFate` flex-item fix** (`js/league.js`, `css/styles.css`).
  - **BUG the icon swap introduced, worth remembering as a pattern:** `.lgSEFate` is
    `display:inline-flex; flex-direction:column`, and its label was the single text node
    `'🏆 CHAMPIONS'` — ONE anonymous flex item. Replacing the emoji with `ico('trophy')` made it a
    `<span>` plus a separate text node, i.e. TWO items, which a column container stacks on
    separate rows (trophy above the word). Fixed by wrapping the label in **`.lgSEFateLab`**
    (`inline-flex`, `gap:.32em` — the gap is now the separator, so the label string has no leading
    space). **Any `ico()` inserted into a flex/grid container needs a wrapper**; swept the other
    insertion sites and the rest are block containers (`.lgSEChamp`, `.lgSECup`, `.cupResult`,
    `.figName`), a span that is itself the flex item (`.lgSERew .v`), or already gapped
    (`.lgFixture`).
  - `.lgSEStat .pips b.lost` / `b.gain` were `animation:… infinite` — a permanently throbbing pip
    inside a stat TABLE fights reading and reads as filler (same call as retiring the `.pwr` idle
    loops). Now bounded to **3 iterations**: the motion points at what changed, then settles and
    the COLOUR carries the state from there.
  - `.lgSESub` tracking .32em → .16em; the cup-qualified line lost its em-dash explanatory clause
    and exclamation mark (`'CHAMPIONS CUP QUALIFIED — you enter the post-season knockout!'` →
    `'QUALIFIED FOR THE CHAMPIONS CUP'`).
  NOT changed, flagged: `.lgSEDiv` is a fixed `height:400px` with no overflow rule — fits 10 rows
  at the current `.lgSERow` metrics with ~60px spare, so a bigger division would spill. And
  `.lgSEDiv`/`.lgSEPanel`/`.lgSERew` are all the same 12–16px-radius glass card, so the whole
  screen is one silhouette — the same uniformity noted for the HUD.

### 2026-07-24
- **Match-start now GATES on assets being resident (fixes "no textures when I skip the loading
  screen")** (`js/main.js`, `js/flow.js`, `js/intro.js`, `js/models.js`, `css/styles.css`). The intro
  is purely a splash — it loads NOTHING; `startLoading` runs on a `setTimeout(loadDelay)` sized to the
  FULL intro. Skipping the intro (`intro.js` `skip()`, any key/click) reveals the menu but leaves that
  timer pending, so an immediate Play force-booted from primitives (`startMatch`'s `!rods.length` →
  `boot()` with no GLBs) and nothing rebuilt the men when the GLBs landed later → a match stuck with
  primitive rods/players/table. Three layers:
  - **Loading starts on skip.** `startLoading` is now idempotent (`loadStarted` guard) and `skip()`
    calls it immediately — the cut-short intro no longer has a fuse animation to protect, so there's
    no reason to wait. The `loadDelay` timer stays as the un-skipped path; the 8s `boot` failsafe stays.
  - **`startMatch` is a GATE → `startMatchNow`.** `main.js` `ensureMatchAssets(cb)` runs cb only once
    the world is built (`whenBooted` — a `bootWaiters` queue flushed at the end of `boot()`) AND the
    SELECTED table skin + room backdrop + both figurines are resident (`applyTable`/`applyRoom`/
    `loadPlayerModel`, each of which fires its cb synchronously when cached). Resolves synchronously in
    the normal case (no visible wait); otherwise a gold `#matchLoad` spinner shows until ready, then
    `go()` does `rebuildRodMen()`+`applyColors()` (mirrors league `start()`) and calls `startMatchNow`.
    League/cup skip the gate (`S.lg` set — they already ran the same three ensures via their own
    `check()`), so they pass straight through. Can't hang: 8s boot failsafe + every loader falls back
    to primitives. `matchLoading` guards against double-clicks.
  - **`loadSkin`/`ensureRoom` no longer report ready EARLY** (`models.js`). `loadSkin` stamped
    `skinGroups[id][skinId]` with an EMPTY placeholder group the instant a fetch started, and its
    "already loaded" test was truthy-group — so a 2nd caller (the gate) got its cb fired with the skin
    still downloading. `ensureRoom`'s in-flight branch likewise fired the cb immediately ("applyRoom
    runs again on arrival"). Both now QUEUE cbs while a fetch is in flight (`skinLoadingCbs` /
    `roomLoading` are cb ARRAYS now, flushed on load/fail) and `loadSkin`'s resident test is
    `children.length>0` (truly has meshes). So the gate waits for the real GLB, not the placeholder.
    `applySkin`/`disposeTableSkin` already keyed off `children.length`, so no other caller changes.
  Verified by re-read (sandbox wouldn't boot).
- **FX lights no longer freeze the match — resident fx light POOL (fixes hitches on a new ball type,
  explosions, and the respawn swirl)** (`js/world.js`, `js/balls.js`, `js/fracture.js`, `js/flow.js`,
  `js/config.js`). r128 bakes the scene's light COUNT into every material's shader program, so
  `scene.add`/`remove` of a `PointLight` mid-match forced a whole-scene recompile on the next render — a
  multi-hundred-ms stall. The game created/destroyed a light at exactly the reported moments: a
  fireball/knuckle glow (`t.light`) + the cannonball fuse (`warnLight`) in `makeBall`; the ball-
  explosion light in `spawnBallFracture`; the respawn-swirl light in `spawnRespawnSwirl`. (The existing
  off-screen mesh warm couldn't help — the recompile is caused by the LIGHT, at the menu's light count.)
  - **`buildFxLightPool()`** (`world.js`, called in `initThree`) creates `CONFIG.fx.lightPool` (5)
    `PointLight`s resident in the scene forever — `visible=true` so they're COUNTED, `intensity=0` so
    they contribute nothing (the same trick the 2 `goalLights` already use). `fxLightGet(color,dist)`
    borrows one (sets colour/distance, caller drives intensity) or returns null when exhausted (effect
    just loses its glow — the count, and the no-recompile guarantee, is untouched); `fxLightPut(l)`
    releases it (intensity 0). **NEVER `scene.remove` a pooled light** — that changes the count.
  - Rewired: `balls.js` `makeBall` (`t.light`, `warnLight`) + `removeBall` (release, not remove);
    `fracture.js` `spawnBallFracture`/`disposeFracture` + `spawnRespawnSwirl`/`disposeSwirl`. All
    readers were already null-guarded, so a null borrow is safe.
  - **Pre-kickoff warm `warmMatchAssets()`** (`fracture.js`, called from `startMatch`/`startMatchNow`
    before the countdown, gated by `CONFIG.fx.warmMatch`): parks one hidden instance of every ball type
    off-screen (kept resident so its compiled program is never released) and `renderer.compile`s the
    whole scene + re-warms the shatter/swirl/figurine templates at THIS match's exact light count — so a
    league/cup ROOM swap (its backdrop brings its own lights) is covered too. The one-off compile lands
    under the intro banner. Boot-time `warmFractureShaders` still runs.
  See MEMORY: never add/remove a scene PointLight mid-match. Verified by re-read (sandbox wouldn't boot).
- **League/cup shatter GLBs now warm in the LOBBY, not at kickoff** (`js/league.js` — new
  `primeMatchExplosions(idA,idB)` helper + calls in `openLeague` and `renderCup`). Fixes the
  first-cannonball-kill stall in league games. `startMatch` already primes both teams' explosion
  GLBs (`ensureExplosionModel` → load + off-screen `warmFractureTemplate` shader compile), but for
  a LEAGUE opponent that prime only KICKS OFF at kickoff and is async, so the first kill could beat
  the load/compile. Quick/AI matches don't hit this because main.js primes the default red/blue at
  boot and they're usually the two on the table. The helper calls the SAME `ensureExplosionModel`
  earlier — from the lobby, where the next fixture is known — so by the time the player clicks Play
  the shatters are resident + warmed and the later `startMatch` prime is a no-op. **Passes figurine
  model IDS, not team indices**: `cfg.modelRed/Blue` aren't swapped to the league teams until
  `lgPlayMatch`, so `activeModel()` would read the wrong (menu) figurines in the lobby — instead it
  reads `LG.teams[playerId].model`/`LG.teams[op].model` (league) and `cupEnt('player').model`/
  `opp.model` (cup). No pruning here; `startMatch` still bounds residency to the two teams on the
  table. Guarded on `ensureExplosionModel` existing (clean skip when fracture fx is off). Verified
  by re-read (sandbox wouldn't boot).
- **Local ball reflections (cube-map that tracks the ball)** (`CONFIG.ballReflect`, `js/world.js`,
  `js/balls.js`, `js/main.js`, `js/ui.js`). `scene.environment` (the room PMREM bake) is a DISTANT
  env — it can't show the table/pitch/men the ball sits among, so a metallic ball (esp. golden,
  `metalness .85`) only ever reflected the far room. Added a single shared `THREE.CubeCamera` +
  `WebGLCubeRenderTarget` (`buildBallReflect`, called in `initThree`) that rides the **lead ball**
  (nearest the camera) and renders the real scene around it each throttled frame; its cube texture
  is reused as `.envMap` on **every** ball material (`setBallEnv`/`applyBallEnv`, set at ball birth
  in `makeBall` so the null→texture shader recompile happens then, not mid-rally). `material.envMap`
  outranks `scene.environment`, so balls get local reflections while everything else keeps the room
  bake — no double-count. `updateBallReflect()` (main loop, just before `renderer.render`) is the
  ONE extra scene pass; it self-gates (off when `!cfg.reflections`, no balls, or phase not
  play/goal/count), hides the lead ball so it can't reflect itself, and **freezes
  `renderer.shadowMap.autoUpdate`** for the 6 faces so they reuse the previous frame's shadow map
  instead of re-rendering it 6× (the real cost saver). Cube texture encoding = `sRGBEncoding` to
  match `renderer.outputEncoding`. Perf knobs in `CONFIG.ballReflect`: `res:128` (ball-sized
  balance), `every:2` (~30Hz cube update — invisible lag on a small ball, half the cost; raise if a
  weak GPU dips), `near/far`, `intensity`. Gated by the existing Options **Reflections** checkbox
  (`refreshBallReflect` on toggle) — off → balls fall back to the room env exactly as before.
  Detached cube cam is safe: r128 `CubeCamera.update` calls `updateMatrixWorld()` when `parent===null`,
  so `ballCube.position.copy(lead)` positions it correctly without adding it to the scene. Verified
  by re-read + confirmed the `(near,far,renderTarget)` ctor / `.update(renderer,scene)` signatures
  against the vendored `three.min.js` (sandbox wouldn't boot).

### 2026-07-22
- **Trap carry fix: the dribble slid the man OFF the ball, then shot at nothing** (`js/ai.js`,
  `CONFIG.ai.trap.carryLead`/`holdZ`). Regression introduced by the trap rewrite below; symptom was
  traps + trapShots firing with the ball sitting between two players, nowhere near a foot. Three causes:
  - **The carry aimed the man at `bp.z ± slideMax` (7u PAST the ball).** slideMax is a cumulative
    travel budget, not a per-frame aim point — using it as the target slid the boot 7u clear of the
    ball within ~0.2s, so the "carry" abandoned the ball immediately. New **`carryLead:0.9`** is the
    per-frame lead (must stay well under the boot's z contact reach, `footBox.z + BALL_R ≈ 3.25`, or
    the man just leaves); `slideMax` still caps cumulative travel from `r.trapZ0`.
  - **The rewrite dropped the `dz<alignZ` gate on the shot.** The original fired
    `kickRod(r,'trapShot')` only when a man was squared up; the phase rewrite gated on
    `open||timeUp` alone, so once entered a trap ALWAYS produced a shot `settleT+holdT` later
    regardless of where the ball had ended up. Re-added, and measured against the right man (below).
  - **Alignment was measured with `dz` — the nearest man of ANY.** On a 2/3/5-man rod that is
    routinely a different man from `r.trapMan`, so the rod could read as "aligned" because a
    NEIGHBOUR happened to be near the ball. All three tests now use **`tdz`** = z-distance from the
    ball to the trapping man specifically.
  New **`holdZ:2.8`** is the live contact test: past it the boot isn't touching the ball, so the carry
  releases (`TRAP-LOST` in the kick log) instead of holding a phantom. A `timeUp` that never squares up
  now also releases rather than swinging. KNOWN, unchanged: `trap.gkReach` (6) still REPLACES the
  alignZ entry test for keepers, so a GK can enter a trap posture for a ball up to ~±19 in z while its
  slide band is ±13 — `holdZ` now bounds that to a ≤`settleT` flicker instead of a shot, but the entry
  itself is still deliberately un-aligned (2026-07-11 design).
- **Trap rewritten: it never actually held a ball** (`js/config.js` `CONFIG.ai.trap` + `CONFIG.ai.trapShot`,
  `js/ai.js`, `js/physics.js` both collision passes, `js/rods.js`, `js/world.js`). Symptom: you only ever
  saw the trap SHOT, never a catch, and a slow ball sitting in range never triggered a trap at all.
  Five independent causes, all of them real:
  - **`trap.minApproach` was +6** — entry required the ball CLOSING at >6 u/s, so a slow or dead ball
    (the exact case that wants trapping) could never enter. Worse, `evade` then picked it up
    (its `maxApproach` 4 admits slow balls) and slid the rod AWAY from it. Now **−2.5** with a new
    `maxApproach:26` ceiling: a still or gently goal-ward ball is trappable, a rocket isn't. The old
    own-goal rationale applied to the −0.9 back-tilt and no longer holds (see angle, below).
  - **`trap.angle:-0.9` put the boot ABOVE the ball.** The foot box centre sits at
    `y ≈ ROD_H − cos(a)·ARM` + the `footBoxOff` rotation; at −0.9 that's **y≈3.68** against a ball centre
    at 1.9 — a full ball-diameter of daylight. The only contact it could make was a ~93%-downward normal
    that shoved the ball into the floor with a 1.7u depenetration and squirted it forward. Now **−0.25**
    (box centre y≈1.93, level with the ball) — a pin, not a hover.
  - **The window was 2u wide and entirely behind the rod** (`back −5.5 → front −3.5`) while `settleT` was
    1.05s. At the ≥6 u/s the entry demanded, the ball crossed that band in ≤0.33s, so `relReal>=front`
    aborted the trap long before the settle completed — **the hold phase was unreachable by arithmetic.**
    Now `back −6.0 → front +2.4`, i.e. from behind the men through the feet.
  - **Nothing made the contact sticky.** `collideRod` had no idea a trap was happening: it used
    `kick.rest` 0.01 / `kick.grip` 0.08 like any passive touch. Dead-ish but not adhesive, so the ball
    parked near the boot and the rod slid out from under it. Both passes now switch to
    **`trap.holdRest:0` + `trap.holdGrip:0.55`** while `r.act==='trap'` (and skip sweet-spot + aimAssist,
    which exist to improve a STRIKE and would re-launch the ball). Grip lerps `b.v` toward the contact
    point's velocity, whose z is the rod's slide — that is the carry. It self-limits: once the ball
    matches the foot, `vn≥0` and no further impulse/grip applies.
  - **The kick gate wasn't `!r.act`-gated.** Harmless while the window stopped short of the men, but
    with `front:+2.4` the normal swing would fire at a ball we were holding and `kickRod` clears `r.act`
    — killing the trap the instant the ball arrived. `canKick` now requires `!r.act` (safeRaise's
    `srKick` override still works: it nulls `r.act` in the same frame first).
  Trap is now a three-phase action driven off `r.actT`, owning `r.target`/`r.aiMan` and `continue`-ing:
  **CATCH** (`settleT` 0.35s, boot pinned dead on the ball, no aim offset) → **CARRY** (`holdT` 1.3s max:
  reads `shotEval` from the ball's live position, commits ONCE to the side whose lanes probe better at
  ±`slideMax`×0.6 — committed for the same anti-dither reason as `evadeDir` — and dribbles that way up to
  `slideMax` 7u at `carryMult` 0.5 rod speed) → **SHOOT** (`trapShot` as soon as the best lane clears by
  `lineClear` 2.0, or unconditionally when `holdT` expires). `settleT+holdT` = 1.65s, deliberately under
  `abortT` 3.0 and `deadball.stallT` 3.6 so a deliberate hold can't be whistled. Entry commits to one man
  (`r.trapMan`, nearest live man in z) so man-index hysteresis can't drag the boot off the ball mid-carry.
  New rod fields `trapMan`/`trapDir`/`trapZ0` (declared in `buildRods`, cleared in `kickRod` +
  `resetRodRotation`). Kick-log traces `ACT:trap/catch`, `ACT:trap/carry` and a `TRAPSHOT` line carrying
  lane clearance + distance carried.
- **`trapShot` curve was a 71 rad/s tunnelling swing** (`CONFIG.ai.trapShot`). `strike` is the END TIME of
  the ramp, so the forward sweep lasts `strike − windup`: 0.2 − 0.16 = **0.04s for 2.85 rad** (windupA −1.0
  → strikeA 1.85), i.e. ~3.3× the normal kick's 21.8 rad/s and ~7u of foot travel per sim step — the same
  pathology the `kickA0` fix below was written to remove, and why the one thing you did see looked wrong.
  The −1.0 windup also dragged the pinned ball ~3.7u BACKWARD before striking it. Now `windup 0.10 /
  windupA −0.5 / strike 0.20` = 2.35 rad over 0.10s ≈ **23.5 rad/s**, in line with a normal swing. Also
  moved `powFrom` 0.17 → **0.10** so the power window opens WITH the strike: a ball pinned at the boot
  contacts almost immediately, so the old window was missed every time and every scoop silently used the
  passive `rest` instead of `restPower`. **RATE is the number to preserve when retuning — raise `strikeA`
  and `strike` together.** Verified by re-read (sandbox wouldn't boot).
- **Held-rod angle block in the TRAINING panel** (`js/training.js` `trnAngTick`, CSS `.trnAng*`).
  Sits at the bottom of `#trnPanel` under the cyan ball metrics, gold to mark it as rod chrome:
  `rod <T1/T2 role> <state>` / `ang <world°>  swing <rod-local°>` / `ω <rad/s>`, next to a small
  SVG dial whose needle hangs straight down at 0 and swings toward +x (screen-right) with the
  rod, so it mirrors the table. `swing` is `angle/kickDir` — reads alike for both teams and
  lines up directly with `CONFIG.kick`'s `windupA` / `raiseA` / `trap.angle`. Both figures are
  the **sim** `r.angle`/`r.angVel`, NOT the interpolated pivot, i.e. the values the swing curve
  and contact impulse use — so an ω spike (≈80 vs a swing's 21.8) marks a step where the angle
  jumped rather than swept. State = `KICK <kickT>` / AI action name / `RAISE` / `REST`. Tracks
  `userRod()`, falling back to the kick-log traced rod (`dbgLogRod`) when nothing is held.
  Static chrome (dial, ids) ships in `buildTrnPanel`'s one-time innerHTML; the tick writes one
  small node + the needle's `rotate()`, once per FRAME (`trainingTick`), never per sim step.
- **Rodless-match crash fixed (`Cannot read properties of undefined` on every mouse move/click)**
  (`js/flow.js`, `js/input.js`, `js/training.js`). Root cause is NOT training-specific but training
  is where it surfaced: **the menu is clickable before `boot()` runs.** `buildRods()` only happens in
  `main.js` `boot()`, at the END of the GLB chain (which is itself delayed by `loadDelay` for the
  intro), while `#menu` goes live as soon as the intro reveals — the intro reveals on ANY key/click
  (`skip`), on the reduced-motion/`intro.on:false` path (`off()` at parse time), and on `holdMax`
  expiry regardless of `introReady`. Start a match in that window and `S.ctrlRods =
  rods.filter(…)` is **empty**; `boot()` then lands, builds rods and starts the loop, so the game
  LOOKS fine while `S.ctrlRods[S.ctrl]` is `undefined` forever — hence the endless
  `input.js` `maxOff` / `kickT` / `raise` throws on mousemove/click, and a training panel whose
  "Rods · show/hide" list was built empty and latched that way via `trnBuilt`.
  - `startMatch` now force-boots when `!rods.length` (`boot()` is idempotent and falls back to
    primitives — its own comment sanctions a force-start), and swallows the click if `main.js`
    hasn't parsed yet rather than starting a rodless match.
  - New **`userRod()`** in `input.js` — the single accessor for the held rod, returns `null` when
    there isn't one and self-heals a stale `S.ctrl`. Every site (keydown/keyup, canvas
    mousemove/mousedown, mouseup, `userControlUpdate`, `gamepadUpdate`) goes through it; nothing
    indexes `S.ctrlRods[S.ctrl]` raw any more.
  - `training.js`: rod checkboxes moved out of `buildTrnPanel` into **`trnRodRows()`**, rebuilt from
    `rods` on every `trainingEnter` (no-op when the count already matches), so a panel built early
    can't stay empty for the session. Verified by re-read (sandbox wouldn't boot).
- **Training mode** (`js/training.js` new + TRAINING card on the main menu, `CONFIG.training`,
  hooks in `flow.js`/`ai.js`/`physics.js`/`balls.js`/`powerups.js`/`main.js`/`input.js`,
  `S.trn` in `state.js`, CSS `/* ===== training mode ===== */`). Sandbox practice mode for
  kick/action tuning: `startMatch('training')` (user = team 0) → `trainingEnter()` skips the
  countdown, drops a ball at `CONFIG.training.spawn` and shows a left-side panel (`#trnPanel`,
  built via createElement like the debug AI panel; `T` hides it, `—` collapses it).
  - **Cross-module gate = `S.trn`** (null when off, the `TRN` state object while live) +
    per-rod `r.trnHidden` — other files never reference training.js symbols directly except
    `trainingEnter`/`trainingGoal`/`trainingBallGone` on paths only reachable in training.
  - **Ball placement**: click-place mode (`G` or panel button; window-CAPTURE mousedown/
    mousemove listeners beat input.js's kick/slide handlers, raycast onto the y=BALL_R plane,
    green ghost ring preview, R-click cancels) + XZ number inputs. `trnPlace` clamps inside
    the walls (`clampMargin`) and always `syncBall`s. `TRN.lastSpot` = last placed position.
  - **Launcher**: speed/angle°/loft fields → `trnLaunch` (0° = +x toward the RIGHT goal,
    90° = +z near side); "Reset + launch" re-places at `lastSpot` then fires — repeatable shots.
  - **Saved spots**: 4 slots storing pos + launcher settings, persisted as `cfg.trnSpots`.
  - **Freeze/step**: `P` toggles, `O`/⏭ single-steps. Implemented in the main loop: while
    frozen `physAcc` is zeroed; each queued `stepQ` releases exactly one FIXED slice (render
    keeps running so placement/camera stay live).
  - **Per-team AI toggles** (both default OFF) + **per-rod show/hide**: gated rods in
    `aiUpdate` hold dead still (`target=offset`, men down, actions cleared); hidden rods are
    `pivot.visible=false`, skipped by `collideRod` (first line), cannonball nearest-man search,
    and the AI gate.
  - **Rules**: no scoring (goals → `trainingGoal`: fx + optional score tick via the "Count
    goals" checkbox, ball resets to `lastSpot`), no match clock, no power-ups, dead-ball
    auto-redrop OFF by default (checkbox opts back in), out-of-bounds/cannonball-detonation
    re-drop/respawn instead of entering the goal-hold. `gotoMenu` → `trainingExit()` restores
    hidden rods + clears the gate. Pause→Restart re-enters keeping the panel setup.
  - **input.js keydown now ignores form controls** (`INPUT/SELECT/TEXTAREA` target returns
    early) so typing in panel fields can't kick/slide — this also un-breaks typing SPACE in
    the team-name inputs. Panel buttons blur on click so SPACE can't re-fire them; a capture
    wheel guard stops panel scrolling from switching rods.
  Verified by re-read (sandbox wouldn't boot).
- **Swing starts from the rod's CURRENT angle (`r.kickA0`)** (`js/rods.js`). THE fix for "trap shots go
  through the ball / power is inconsistent". The strike ramp began at the constant `windupA`, so a kick
  launched off a RAISED rod (`raiseA` −1.6) or a trapping rod crossed ~1.5 rad in ONE sim step. Kick-log
  proof — every kick preceded by `ACT:raise`/`ACT:trap` logged `ω 79–85` against the swing's normal
  `ω 21.8`, i.e. a **4x** spike, always at `kickT 0.017` (swing step 1): `vn 439.7 → ball 330u/s`,
  `jm 261` vs a normal `vn ~120 → ball ~75`, `jm ~70`. At ω 85 the foot travels ~9u in one step, which
  is why it passed straight through the ball. `kickRod` now captures `r.kickA0=r.angle/r.kickDir` and
  the curve ramps from there; with `windup>0` the pull-back sweeps from it too, so there is no
  discontinuity anywhere. This is also what makes `windupA:0` actually mean "no back-pull".
  Residual: a raised kick still sweeps a longer arc in the same `strike` seconds (≈32 rad/s vs 21.8) —
  normalising the RATE instead of the duration is the follow-up if power still feels uneven.
- **Rod swing is now sub-stepped with the ball** (`js/physics.js`). `physics()` substepped only the
  BALLS; `r.angle`/`r.offset` were frozen at their end-of-step value for the whole sim step. At the
  swing's 21.8 rad/s that is ~2.3u of foot travel per step — larger than `BALL_R` — so the finely
  substepped ball was passed by a teleporting foot. This is why more substeps / lower `subTravel`
  never helped. Two changes: foot speed (`|angVel|*ARM + |vz|`) now feeds `vmax` so a fast swing raises
  the substep count, and each substep poses every rod at `lerp(startAngle,endAngle,f)`. The start pose
  is reconstructed exactly as `angle - angVel*dt` (updateRods defines angVel that way), and the exact
  end pose is restored after the loop for render/AI. `angVel`/`vz` are deliberately NOT rescaled —
  they're the average rate over the step, which is what the contact impulse should use.
- **Evade follow-through + re-entry lockout** (`js/ai.js`, `js/config.js`, `js/rods.js`). Fixes "they
  evade for a frame, then chase". Exiting a successful clear dropped straight back into man-selection,
  which re-aimed onto the ball, made `inFootRange` true again and re-fired evade — the log shows ACT
  flipping evade/-/safeRaise with 5–15 changes suppressed between printed lines, for ~5s straight.
  Now the exit distinguishes a genuine clear from a bail: on a clear it **latches the raise**
  (`evade.raiseAfter`), which swings the foot BEHIND the ball in x so the following drop sweeps
  forward and knocks it upfield — the "get behind the ball and hit it forward" the owner asked for —
  and sets `r.evadeCd` (`evade.cd`, 0.8s, ticked in `updateRods`) to block re-entry while that plays
  out. The latch alone was insufficient: `latchStuck` can clear it in the narrow rel −2.9..−1.6 band.
- **`✓CONTACT` now logs the vn breakdown** (`js/physics.js` both collision passes, `js/debug.js`
  `dbgHit`). vn is exactly `(foot·n − ball·n)`, so the second line splits it: `foot` (swing driving
  into the ball) vs `ball` (the ball arriving into a stationary boot), plus `swing` (|ω × arm-to-
  contact|, the FULL rotational speed — compare to `foot` to see how much of the swing landed),
  `slide` (`r.vz`), `ω` (`r.angVel` — a one-step spike means the swing curve jumped rather than
  swept), `jm` (impulse after rest/stHit/sweet/boost) and which `rest` value was used. `bn` is
  captured before the impulse rewrites `b.v`; both captures are guarded on `dbgLogRod===r`, so the
  cost is zero with the tracer off. Kick-log panel widened 440→660px for the detail line.
- **Kick-curve findings (documented, NOT yet changed)** — `CONFIG.kick`, read off the kick log for the
  blue ATT rod. Recorded here because two of them are counter-intuitive:
  - **`windup:0` does NOT remove the back-pull.** The strike ramp's start value is `windupA`
    (−0.45) regardless of `windup`; `windup` only sets how long the rod takes to REACH it. With
    `windup:0` the first branch (`T<windup`) is dead and the ramp begins at −0.45, so at hz 60 the
    first sampled swing angle is `-0.45+18.125×0.0167 = -0.148` — the foot still travels ~0.93u
    BACKWARD on swing step 1, just instantly instead of over a window. The knob for "no back-pull"
    is **`windupA:0`** (plus `strike:0.055` to hold the 18.125 rad/s angular rate, since the arc
    shortens from 1.45 to 1.0 rad).
  - **Kicking from a RAISED rod snaps the angle** from `raiseA` (−1.6) to ≈−0.148 in ONE step —
    a 1.45 rad jump, so `angVel=(angle-prevAngle)/dt` spikes for that frame. This is the
    "problems when shooting from a raised position", and it is NOT the back-pull. Fix is to start
    the ramp from the rod's angle at kick time (capture `r.kickA0=r.angle/r.kickDir` in `kickRod`)
    rather than from `windupA` — also the right base for a separate windup action later.
  - **The timed power window is rarely reached.** `pow = kickT ∈ [powFrom,powTo)` is evaluated at
    CONTACT, and contact resolves on swing step 1 (`kickT≈0.017`) in essentially every logged kick,
    vs `powFrom:0.06` — because the AI only fires at balls ALREADY inside the foot's reach, so the
    ball is hit as the swing starts, not at its peak. Consequence: every AI strike uses `rest:0.01`
    (the absorbing touch) and `restPower:0.5` is close to dead config. `[SWEET]` (position-based,
    `CONFIG.kick.sweetSpot`) DOES fire and produced the one outlier strike in the trace
    (`vn=129.2 → 89u/s` vs a very uniform ~110 → ~44 for everything else). Strong argument for
    making power position-based rather than timed. Retuning it is a big balance swing (≈+50%
    impulse) — deliberately left for a decision.
  - `rest`/`restPower` now documented in `config.js`: `jm=(1+rest)*(-vn)/mass` along the contact
    normal, `vn` measured relative to the MOVING foot. 0 = dead/absorbing, 1 = elastic.
- **Evade no longer fires on ARRIVING balls** (`js/ai.js`, `js/config.js`). Read off the kick log:
  every evade in a 90s trace of the red DEF entered at `rel` −2.4..−2.9 with **`appr` positive**
  (ball closing at 4.6–18.8 u/s) and lasted 0.1–0.35s before a kick. Evade is for a ball PARKED
  against a foot, but its entry test was purely positional (`inFootRange` + slow), so after
  `behindDead` dropped 3.1→1.6 a ball merely rolling in from behind tripped it. Cost: the rod threw
  the block away, skipped aim + kick for a beat, and — because evade sets `r.target` to a cleared
  offset — kept sliding AWAY during the swing, which is the likely cause of the two `✗WHIFF`s in the
  same trace (both on ~9 u/s balls at `dz`<1.0, well inside the foot's 3.25u z-reach).
  New `CONFIG.ai.evade.maxApproach` (4): entry AND hold both require the ball not be closing faster
  than that. Exact mirror of `trap.minApproach` — trap wants a closing ball, evade wants a settled
  one. Large value = old behaviour.
- **`dbgHit` prints `vn` to 1dp** (`js/debug.js`). A graze rendered as a flat `vn=0` next to
  `ball→31u/s`, which reads like free energy. It isn't: the impulse (`jm ∝ vn`) really was ~0 and the
  speed came from the **grip** term — `b.v` is lerped toward the contact point's velocity (the foot's
  swing speed) on ANY contact with `vn<0`, unscaled by how solid that contact is. NOT changed, but
  worth knowing: scaling `stGrip` by contact solidity is the fix if grazes ever feel too powerful.
- **CLAUDE.md constants corrected**: `BALL_R` 1.6→**1.9**, `GRAV` 280→**250**, `FOOT_T` 0.99→**1.0**
  (all read from `CONFIG.physics`), and the stale "ARM 8.4→9.0" note dropped (`arm` is 6.30).
- **Kick-log flood fixed: per-channel dedupe + thrash collapse** (`js/debug.js`). The tracer used ONE
  shared dedupe slot (`dbgLogLastKind`) for every emitter, so any two that fire each step with
  different-but-steady kinds ping-ponged forever: `dbgRod` wrote `ACT:trap`, `dbgKickGate` overwrote
  it with `BLK:out-of-reach`, and next step both looked "changed" → 2 lines × sim hz. (Latent before
  the ACT trace; the ACT line just made it constant.) Four changes:
  - **`dbgLogLast` is now a per-CHANNEL map** + `dbgLogNew(ch,kind)`. Channel = the kind's prefix
    before `':'` (so `ACT:*` dedupes against itself, `BLK:*` against itself), else `'act'`. A steady
    state prints once regardless of what else is logging.
  - **Thrash cap**: a channel changing faster than `DBG_LOG_GAP` (0.35s) has its lines swallowed and
    counted, then emits one `⇄ thrash N changes suppressed` summary. A real A→B→A oscillation stays
    visible but is bounded to ~3 lines/s per channel. Raise `DBG_LOG_GAP` for an even quieter log.
  - **Repeat collapse**: an identical line folds into `×N` on the existing line (`dbgLogPush(s,key)`).
  - **One DOM write per FRAME**: `dbgLogPush` only marks `dbgLogDirty`; `flushKickLog()` (called at
    the top of `debugUpdate`) does the `innerHTML`. It was rewriting the panel on every SIM STEP.
  - A real event (`★KICK` / `✓CONTACT`) clears `dbgLogLast` so steady states re-announce after it.
- **Evade direction rewritten: `evadeDir()` + committed escape** (`js/ai.js`, `js/rods.js`,
  `js/config.js`). Symptom: on a slow ball the rod shadowed it, then slid *way* off to the side
  (often through the ball) before lowering. Two separate bugs in the direction pick, which both
  evade sites (`evade` action + post-kick `heldFwd`) had inline and duplicated:
  1. **The geometric branch measured against the wrong thing.** `(bz − r.offset) > 0 ? −1 : 1` is
     the ball's side of the rod's CENTRE LINE, but the ball is stuck against a FOOT at
     `baseZ[i]+offset`. Only equivalent for the 1-man GK (baseZ 0); on a 2/3/5-man rod it regularly
     returned the side that dragged the men THROUGH the ball to the far side — the "slides into it
     then way off" behaviour. Now the direction is the side of the MINIMUM-TRAVEL escape
     (`clearOffset(...,0)`), which by construction is the side the trapped foot is already closest
     to leaving, so it can never sweep across the ball.
  2. **Direction was recomputed every frame**, so the sign flipped as the ball drifted over the foot
     line (the comment claimed "commits, no dither"; it didn't). Now committed once and cached in
     **`r.evadeDir`**, cleared on action exit / latch rearm / `kickRod` / `resetRodRotation`.
  - `CONFIG.ai.heldFwd.vz` **0 → 5**. At 0 the `|v.z| > vz` test was always true, so a RESTING ball's
    noise-level `v.z` picked the sign every frame — the post-kick escape was a coin flip. The drift
    branch is meant for a ball with real z-momentum only; below the gate it's geometry's job. (The
    user's read was right that `vz` only uses the drift rule above the threshold — that split is
    correct and stays; it was the fallback that was broken.)
  - `CONFIG.ai.evade.behindDead` **3.1 → 1.6**, closing the passive band flagged yesterday
    (rel −3.1..−0.8 got no action at all). The old value's rationale ("prevents hitting the ball
    backwards") doesn't apply: evade only slides in Z, it never rotates the rod, so it cannot knock
    the ball goal-ward. What must not be stolen is a *strikeable* ball, and `!overFoot`/`!inFront`
    already guard that — 1.6 leaves a 0.8u buffer to the overFoot zone's −0.8 edge.
  - New helper `nearestFootZ(r,bz)`. Verified by re-read (sandbox wouldn't boot).
- **Keeper own-goal fix: trap own-goal guards** (`js/ai.js`, `js/config.js`). Symptom: a slow ball
  (1–2 u/s) sitting BEHIND the GK would make it lift slightly and slide onto the ball, shovelling
  it into its own net. Culprit was the **trap**, not evade/safeRaise: `trap.gkReach` was **20**, and
  for a GK that value REPLACES the `alignZ` z-test entirely (`trapZ`), so with a ±13 slide band the
  keeper's trap gate was true for essentially any z on the pitch. Entry then only needed slow +
  `relReal ∈ (−6, 0.5)`, so a dead ball goal-side of the keeper entered `r.act='trap'` →
  `updateRods` eased the angle to `trap.angle` (−0.4, a BACKWARD tilt = the "slight raise") and,
  because trap does NOT `continue`, man-selection kept slide-targeting the ball's z (the "moves
  toward the ball"). Trap also outranks **evade** (evade needs `!r.act`), so the one action designed
  to slide clear of a stuck ball never got a look in; 1.45s later `trapShot`'s −0.8 windup pulled
  back through it again.
  - `gkReach` 20 → **6** (documented default; big values make the keeper trap balls it isn't lined
    up with, since it replaces alignZ rather than adding to it).
  - New `trap.minApproach` (6): the ball must be CLOSING on the rod (`best.v.x*dir`). A trap tilts
    the foot backward, which only works on a ball rolling ONTO the foot — a stationary or goal-ward
    ball is evade's job. New `trap.ownGoalGuard` (12): no trap entered, and a live trap ABORTS, when
    the ball is within that x-distance of the rod's OWN goal line (the abort drops the rod and the
    drop sweeps the foot FORWARD, i.e. clears upfield). At 12 the GK never traps (its whole band is
    1.5–8 from the line); drop to ~5 to allow keeper traps at the band edge. Both to 0 = old behaviour.
  - Debug: `aiUpdate` now emits an **`ACT:<name>`** line to the kick log (`C` then `L`) on every
    named-action change, with `rel/dz/spd/ownGoalD/appr` — names whichever of safeRaise / trap /
    evade / raise-latch is driving a misbehaving rod. `dbgRod` dedupes, so it's one line per change.
  - KNOWN GAP left deliberately: with the GK trap off there's a passive band at
    `relReal ∈ (−evade.behindDead, overFootOffset−overFoot)` ≈ (−3.1, −0.8) where a footStuck ball
    gets no action (safeRaise needs `!footStuck`, evade needs deeper than `behindDead`) — the rod
    just blocks until the 3.6s dead-ball redrop. Lower `evade.behindDead` toward ~1.6 if that reads
    as passive; evade only slides in z so it can't knock the ball goal-ward. Verified by re-read
    (sandbox wouldn't boot).
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
  Scale is likewise computed directly from `activeModel(team).scale*tmScale(team)` instead
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
