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
`flow.js` (match flow) · `fx.js` (FX + camera) · `hud.js` · `ui.js` · `main.js` (loop + init).

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
