# CLAUDE.md — Fuzeball

Working reference for a fresh session. The full dated history of every change (with the measurements
and the bugs behind each decision) lives in `docs/CLAUDE-history.md`. Search it when you need the
*why* behind something; you should not need to read it front to back.

## What it is

A 3D foosball game, heading for **Steam Early Access**. Plain HTML/JS on three.js **r128**: no build
step, no package manager, no ES modules. `index.html` loads `css/styles.css` and the `js/` modules in
order. It must feel hand-made — **do not let it look AI-generated**.

- `DIRECTION.md` — Early Access scope, the theme (an intergalactic table-football Federation) and the
  palette (blue + Federation gold `#F0B24A`). **Read it before any UI, room or naming work.**
- **Launch checklist:** https://claude.ai/artifact/De8K1742Yr3c1acQ5oy19p (tick items as they land).
- `fuzeball.html` is the original monolith, kept as a reference only.
- Fully offline: three.js, loaders, fonts and the Basis transcoder are vendored in `vendor/`. There is
  deliberately no CDN fallback (it would be remote code execution in the Electron wrapper).

## Conventions

- **Plain (non-module) scripts sharing one global scope.** A top-level `const` in one file is visible
  in later files, and **a duplicate top-level name anywhere throws**. Do NOT convert to `import`/`export`
  (that breaks `file://`).
- **Element ids share that namespace too**: `#lgGoals` is `window.lgGoals`, so don't name a function
  after an element id.
- Dense, terse style, `'use strict'` per file, short names, packed statements. New code should look
  like the code around it. `config.js` is the exception: human-tuned, commented, spaced.
- Global helpers: `$` = getElementById, `clamp`, `lerp`, `rand` (core.js). **`rand()` is NOT seeded.**
- **When updating a function, rewrite the WHOLE function** (owner preference), then re-read it in context.
- **New tunable numbers go in CONFIG** (`js/config.js`), never inline. The short aliases at the bottom of
  config.js (`F`, `BALL_R`, `KICK`, `AIC`, `SHOT`, `DIFFS`…) are derived; edit CONFIG, not the aliases.
- **Every optional module hangs off one nullable gate on `S`**, tested by that module plus one-line
  hooks and nothing else: `S.trn` (training), `S.trial`, `S.tut` (tutorial), `S.photo`, `S.redit`, `S.lg`. A missing optional
  file must never break a match. Core files (`rng.js`, `shots.js`, `binds.js`, `padnav.js`) are NOT
  guarded.
- Keep replies concise and direct (owner preference).
- **Line endings are mixed** (some `js/` files are CRLF). A multi-line find/replace written with `\n`
  silently matches nothing in a CRLF file. Prefer the Edit tool, or splice by line index.

## Verifying changes

Node (v24) is available locally. The browser is only needed for WebGL, rAF or the live game.
1. `node --check <file>` per edited file.
2. **Whole-chain compile** — catches parse errors and duplicate top-level names across files:
   ```
   node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const u=[...new Set([...h.matchAll(/'(js\/[a-z0-9_]+\.js)'/gi)].map(m=>m[1]))];let s='';for(const f of u)s+=fs.readFileSync(f,'utf8')+'\n;\n';new vm.Script(s);console.log(u.length,'ok')"
   ```
3. **Harnesses** — `node tools/<name>-harness.js`. Each asserts behaviour AND carries mutations that
   must each break it. `mutate()` refuses a no-op, so a drifted anchor reports itself. **Update a
   mutation's anchor when you change the line it targets.** When harnesses boot files in a `vm`,
   top-level `const`s are lexical, so export them via an explicit `globalThis.__x={…}` line.
   - `shots` (charge machine), `pin` (catch / carry / every release / the pin shot), `binds` (keyboard/mouse verbs + rebinding + the pad/keyboard merge),
     `padnav` (menu navigation), `trials`, `rng`, `matchstats`, `moments`, `wallplay`, `slidepush`,
     `chargeverdict`, `savesplit`, `venueload`, `roomenv`, `sky`, `roomlights`, `props`, `pitch`, `ktx2`, `offline`…
   - **Failing before 2026-09-24 and still failing (not regressions):** photo-record, rodholes,
     roomlight, roomlights, slidepush; shots has 3 failing assertions (the working tree's soft-curve
     retune, plus `kick.strike` 0.055 → 0.025, which makes "hard anchor is FASTER" fail).
4. **Live**: `.claude/launch.json` serves the repo on `http://localhost:8123` (preview name `fuzeball`).
   In the browser pane **rAF often doesn't run**, so step `loop(t)` / `navTick(t)` by hand with rising
   timestamps. Replace `navigator.getGamepads` with a synthetic pad to test controller paths. **Set a
   viewport first** — the pane can report `innerWidth` 0, which stacks every panel in one column.
   Synthetic key events should target `document.body`, not `window`: on `window`, listeners run in
   registration order, not capture-first.

## File map (boot order)

`core` · `config` (all tuning) · `rng` (seeded per-consumer streams) · `screens` (screen router) ·
`intro` · `arena` (bowl-table SDF physics) · `audio` (`Au`, all synthesized) · `state` (`S`) · `stats`
(rod stats) · `moments` (saves / woodwork / goal classification) · `matchstats` (the match ledger +
post-match sheet) · `seats` (every human at the table) · `world` (three.js scene, lights, `PRV` shared
preview renderer) · `balls` · `rods` · `physics` · `ai` · **`shots`** (player kick verbs) · **`binds`**
(rebindable keys) · `input` · `powerups` (+ dead-ball) · `flow` (match flow) · `fx` (FX + camera) ·
`marks` · `capture` (clip recorder, zip writer) · `replay` · **`hud`** (the whole in-match chrome, one
canvas) · `ui` · `roster` (Kick Off lobby) · `options` · `league` (league + Champions Cup) · `layout`
(panel layout editor) · `customize` · `props` (instanced prop library) · `models` (GLB loading) ·
`fracture` · `debug` (`C` overlay) · `perf` (`M` profiler) · `sweetspot` · `training` · `trials` · `tutorial` · `photo`
(F1) · `roomedit` (F2) · **`vsel`** (◀ value ▶ selectors) · **`padnav`** (controller menus) · `main` (loop).

Tools: `tools/*-harness.js`, `tools/build_props_manifest.js`, `tools/ktx2-encode.mjs` (run from
`tools/` after `npm i`; `--dry` first), `tools/sky-encode.mjs`, Blender scripts `tools/build_nebula_sky.py`, `build_void_asteroid.py`, `tools/build_table.py` / `export_table.py` /
`build_pub_room.py`.

## Coordinates, table, rods

- **X** = long axis (goal to goal), **Z** = width, **Y** = up, pitch at `y=0`. Table dimensions live in
  `CONFIG.table` and physics constants in `CONFIG.physics` — **read them there**; values quoted in docs
  have drifted more than once.
- Goals at `x=±L/2`. Ball into the **right** goal → **team 0 (red) scores**; left → team 1 (blue).
  Easy to get backwards.
- Team 0 = red attacks +x; team 1 = blue attacks −x. 8 rods, 1-2-5-3 per side (GK, DEF, MID, ATT),
  15 apart, interleaved: red GK −52.5, red DEF −37.5, blue ATT −22.5, red MID −7.5, blue MID +7.5,
  red ATT +22.5, blue DEF +37.5, blue GK +52.5.
- Rod object: `pivot` (`position.z` = slide, `rotation.z` = angle), `men[]`, `baseZ[]`, `maxOff`,
  `offset`/`target`, `angle`/`angVel`, `kickT` (−1 idle), `kickA0` (angle the swing starts from),
  `raise`, `act` (AI action), `hold` (the rod's own grip block), charge fields `chg`/`chgSrc`/`chgA`/
  `shotOn`/`shotPow`/`shotCtl`.
- Foot collision: an **oriented box** per man (`footBox`, `footBoxOff`) with priority over the rod
  **capsule** (the leg). Guards that only test the foot box miss the leg — see `shotLegClips`.

## Core systems (what matters when changing them)

**Sim.** Fixed timestep `1/CONFIG.sim.hz` (120) with render interpolation (`b.prev`/`b.cur`, rod
`iPrev`). Substeps adapt to travel (`subTravel`) up to `subMax` (16 on High, `PHYS_Q`); measured at
~0.5 µs per substep per ball (2026-09-25), so physics is not the frame cost. Keep 120 Hz. **Any hard set of a ball's position outside physics must call `syncBall(b)`.** Physics
substeps adaptively; friction is `exp(k·h)` per substep so the total is substep-invariant. Rods are
posed per substep too. Spin/Magnus is a pure horizontal rotation (no energy); keep it that way. A slow
frame runs up to `sim.maxSteps` sim steps, so per-step costs multiply exactly when frames are slow.

**Seeded randomness (`rng.js`).** Everything that changes an outcome draws from a named per-consumer
stream (`RNG.<tag>`, per-rod AI streams). Cosmetic randomness stays on `Math.random`. `S.seed` is the
live match seed; `S.seedNext` is consumed once by `startMatchNow`. `rngSeed` clears cached streams (a
retry must replay).

**Contact (`collideRod`).** The contact point's velocity splits into rotation (the swing, transferred in
full) and slide (`cvz`, scaled by `CONFIG.kick.slidePush`). `holdCfg(r)` swaps in a sticky contact for
the AI's trap/dribble and the player's hold. `aimAssist` / `wallAssist` bend strikes (pure rotations).

**AI (`ai.js`).** Per active rod: pick the ball (seen through a reaction-delay ring buffer, `aiView`),
align a man (with hysteresis, deadzone, drifting error), then choose an action: `lane` (make way for the
keeper), `safeRaise`, `trap`, `dribble` (+ passing), `evade`, or a kick. **Two hands per team**
(`CONFIG.ai.hands`): only that many rods move; the rest hold. Every human-held rod is forced into its
team's active set. Two lessons that keep coming back:
- **Static vs swept reach.** `inFootRange` is a static rectangle. Any action that ROTATES the rod needs
  the swept test (`sweepClips` for the foot, plus the leg), or the rotating boot drags the ball goalward.
- **The kick gate is a snapshot**, so aimed/slow swings are re-checked by `strikeOn` (predicted
  contact) before committing.

**Difficulty & stats.** `DIFFS` (rookie/pro/legend) per team (`cfg.diffRed`/`diffBlue`; `teamDiff` reads
a trial's or league's pin first). Seven rod stats (`CONFIG.stats`, base 5 = neutral) scale speed, hit,
aim, grip, reaction, stamina and iq. Stamina is the match clock plus each rod's own exertion.

**Dead ball.** Displacement-based (a ball boxed into a small area for `stallT`), with faster timers in
dead zones (corner pockets, goal roofs, between-row lanes). Re-drops land in the third the ball died in
(`redropZone`, `S.serveAt`), so holding the ball gains no territory. A goal kickoff is always centre.

**Moments & match stats.** `moments.js` detects saves (GK only), woodwork and goal types (curler,
screamer…) and drives notices, time-pinch and crowd reactions. **Never add a "lands short" rejection
to `momOnTarget`** — it kills every save. `matchstats.js` keeps its own ledger, independent of the
moments toggle.

**Venue.** A table is a shape with swappable skins (`CONFIG.tables[id].skins`); rooms and pitches are
separate. All are lazy-loaded and LRU-evicted (`CONFIG.tableAssets`). Venue swaps are staged behind a
veil with a `renderer.compile` warm (`venueLoad`). Room lights are baked candela transferred per room
(`gain`/`reach`), plus authored lights drawn from a resident pool. **Never add or remove a scene light
mid-match** — r128 bakes the light count into every shader, and changing it recompiles the whole scene
(hence `fxLightPool` / `roomLightPool`). Menus render at a throttled rate (`CONFIG.render.idle`).
Textures are the real cost: KTX2 is used for rooms, figurines, explosions and tables (not the pitch).
**Skies** (`rooms.<id>.sky`, models.js `ensureSky`): six UASTC KTX2 cube faces on `scene.background` (one draw
call, ~8 MB at 1024²), LRU'd by `cacheSkies`; `applyRoom`'s onReady waits for sky AND backdrop, and ignores
either if it lands after you left (`live()`). r128 can't rotate or dim a background, and Reinhard tone mapping runs
on it, so both are baked into the faces. Void's nebula: `tools/build_nebula_sky.py` (Blender, `--verify` checks the
cube convention) → `tools/sky-encode.mjs`. Masters go to `tools/build/` (gitignored, never shipped).
**Void** is the table bolted to a deck on an asteroid: `tools/build_void_asteroid.py` (Blender, GPU bakes) →
`tools/ktx2-encode.mjs`. 8 meshes, ~9.5k tris, ~23 MB VRAM, no lights in the GLB; the deck texture carries a
baked contact shadow because nothing in Void casts one. Room notes live in the comment ABOVE `CONFIG.rooms`:
a comment inside a room entry is lost when the room editor's export is pasted over it.

**Persistence.** `cfg` is one live object saved as two blobs: `fuzeball_player` (syncs via Steam Cloud)
and `fuzeball_machine` (display/perf/calibration, never syncs). **A new cfg key must be added to
`CFG_PLAYER` or `CFG_MACHINE`.** League saves: `fuzeball_league_*`. A league/trial venue is PARKED
(`lgVenueHeld`/`trialVenueHeld`) so it never becomes the player's Kick Off setting.

## Controls

**Seats (`seats.js`).** `S.seats[]` = every human: team, claimed devices (`kbd`, `mouse`, `padN`, or
`pad*` = first pad), held rod. A solo seat holds keyboard + mouse + pad at once. Resolve
**device → seat → rod**: `seatForDev`, `seatRod`, `seatOf(r)`, `isUserRod(r)`. `userRod()`/`S.userTeam`
mean the PRIMARY seat only. Up to 4 per side.

**Keyboard/mouse bindings (`binds.js`, `CONFIG.binds`, `cfg.keyBinds`).** Every rod action is a binding
(key code, `Mouse0..4`, `WheelUp/Down`), rebindable in Options → Keyboard & Mouse → Key Bindings. A binding's
device decides which seat it drives. Defaults: arrows/W-S or mouse slide; ←/→, A/D, Q/E or wheel switch
rod; Space/LMB kick; L-Shift/RMB raise; **R-Shift power**; **R-Ctrl finesse**; 1–4, B guide, V camera,
R retry trial, S save replay clip. Reserved (not bindable): Esc, F1, F2, and the dev keys C/L/F/M.
In a match every bound key is `preventDefault`ed. **Modifiers are reconciled** (`modSync`, input.js): every key
and mouse event carries the real Shift/Ctrl/Alt state, and a modifier `keys[]` thinks is down while its flag
is up is released. Windows can drop one Shift's keyup while the other is held, and power (R-Shift) + raise
(L-Shift) made that a stuck wind-up. A raise PRESS is also latched (`s.rzEdge`) so a sub-frame tap still poses the pin. Alt and F10 are also swallowed on keydown AND keyup,
because they hand focus to the browser menu, which drops the pointer lock and used to read as a pause.
Ctrl+W/T/N can't be blocked in a browser (the Electron shell must block them).

**Shot verbs (`shots.js`, `CONFIG.shots`).**
- **Axis** = power − finesse (RT − LT, or R-Shift − R-Ctrl), from −1 to +1. It blends the swing curve.
  Holding both cancels. Finesse + kick = a **pass** (`shotPassPick`, only to a receiver the assist can
  actually bend to — never the AI's `passEval`). Finesse held alone = a sticky **hold** (the grip is
  eased in over `kbm.holdRamp` on a key).
- **Charge** (`charge.needRaise`, on): **power + a pull-back** winds up; **only a kick fires it**.
  - Keyboard/mouse: power + raise (R-Shift + L-Shift / RMB).
  - Pad: RT + X, or RT + right stick pulled back (the stick is the wind-up).
  - Total Control keeps its both-triggers chord.
  - Letting go without a kick cancels AND disarms, with a `charge.grace` window for a late kick.
  - Power is the ARC (`kickA0` → strikeA over a fixed window). Don't stack restitution multipliers on
    top. The sweet band is a flat maximum and overcooking falls off.
- **The pin** (`CONFIG.shots.pin`): finesse + raise (R-Ctrl + L-Shift, LT + X) poses the men at the AI
  trap angle (sweep-capped). A slow ball touching a tilted man is CAUGHT and carried with the slide by
  `pinUpdate` / `pinBallStep` (physics.js), outside the contact solver. That is deliberate: a boot pressed on a ball
  squirts it out sideways however many substeps you give it. A kick from the pin is the pin shot
  (`shotPinFire`: AI `trapShot` curve, `pin.pow`), and it ignores the finesse axis, which is held to keep
  the pin. Slide then kick = push/pull. A pad also pins off the right stick (finesse + rod inside
  `pin.band`). The pin gates on finesse being DOWN (`I.fin`), not on its eased grip. Released by letting finesse go, any swing, the rod turning off the pin, a knock from
  another ball, a hard set, or a side wall. One ball per rod: `r.pinB` <-> `b.pinR`.
- **One step per seat per frame** (`shotSeatsUpdate`, after `gamepadUpdate`): each device READS into a
  record and the step runs on the merge. A second state machine per device would release the other
  device's charge.
- Physics reads only `r.shotOn`/`shotPow`/`shotCtl`, spent by the first contact.
- Tremble is display-only.
- `shots.on:false` restores the pre-shots controls exactly.

**Pad in a match (`input.js` `gamepadUpdate`).** Left stick / D-pad slide, right stick = absolute rod
angle, A kick, X raise, LB/RB switch, B sweet-spot guide, Y camera, Start pause, View retries a trial.
'Total Control' mode (`cfg.padControlMode`) makes the triggers slide-speed modifiers and puts a swerve
line on the free right-stick axis.

**Menus on a pad (`padnav.js`).** Spatial navigation read off the live DOM (nothing registered per screen
beyond a default focus in `NAV_SCREENS`; screens can add `onPad`/`onPadStick` hooks).
- The cursor is a `.navFocus` class, never DOM focus.
- B presses the screen's own `.backBtn`, LB/RB switch tabs, and Start is the screen's primary action.
- **◀▶ move to the next PANEL and never change a value**; they stop at the edge.
- **Every `<select>` on a `.screen` is a ◀ VALUE ▶ selector** (`vsel.js` wraps it in `.vsel`; the select stays
  the source of truth, steps wrap and skip disabled options). A opens it, ◀▶ cycle, A keeps, B restores.
  A bare select (dev panels) still opens padnav's own list (`#navDrop`: ▲▼, A picks, B closes unchanged).
- **An open value owns A/B**: the Kick Off lobby's join/leave hook (`onPad`) only sees them when nothing is open.
- **A on a slider opens it** (◀▶ adjust, A keeps, B restores).
- A press the menu used is eaten so it can't reach a rod.
- All button prompts come from `PAD_GLYPH` (Xbox/PS/Switch, keyed by Xbox slot name) and follow the
  last-used device (`inputKind()`).
- The layout editor works on a pad (grab/move/resize panels).

## UI

- **Screens (`screens.js`).** Every navigable screen is one `SCREENS` entry, driven by `showScreen` /
  `backScreen` / `hideScreens`. Overlays (pause, win, dialogs) are NOT registered. A screen with live
  state tears it down in its own `onHide`. `#menu` IS the Kick Off screen; `#home` is the landing page.
  A match returns to the screen it was launched from (`S.fromScreen`).
- **Layout editor (`layout.js`).** A screen gets draggable panels by adding a `lay` block (or an array
  of blocks) to its `SCREENS` entry. Saved in `cfg.layouts` as pixels (checklist: move to anchors).
- **HUD (`hud.js`).** One canvas with `pointer-events:none`. It polls `S`; callers push only events:
  `banner` (tier 1), `notice` (tier 2), `toast` (tier 3), `hudHint(kbm,pad)`, `hudCount`, replay state.
  Hint markup: `[KEY]` keycap, `[LMB]`/`[MOUSE]`, `{A}` pad button, `·` separator, `\n` line break.
  **Keyboard hints are built from the bindings** (`bindHintRods`, `bindCap`).
- **Plates (css/styles.css, FEDERATION PLATES).** Buttons, tabs, menu items and small chips are one shape: two
  clipped pseudo-layers behind the element, cut at the HUD board's 20°. Style a plate ONLY through
  `--pl` (fill), `--pr` (rim), `--pc` (cut) and `--pk` (text); a new plate-shaped control joins the `:is()`
  lists there. Never put `background`/`border`/`clip-path` on the element itself (clip-path would clip the
  pad focus). `.btn` is the gold primary, `.btn.ghost` the blue secondary.
- **Type.** `--font-display` (Soccer League College italic) for titles and the home menu, `--font-ui`
  (Soccer League) for labels, `--font-body` (Rajdhani 600) for anything read as a sentence.
  Sized for 1280×800 (Steam Deck) and a sofa: nothing in a menu under 11px, the `--fs-*` tokens start at
  11.5px. Check a screen at 1280×800 after adding to it; only Options → Keyboard & Mouse scrolls there.
- **Style rules.** No emoji in UI copy. SoccerLeague/Russo One ship ONE weight: never ask for bold.
  Gold marks focus, selection and trophies only. A CSS class that isn't in the markup fails silently, so
  check new selectors against what the code emits. A flex/grid parent changes its children's margin
  behaviour (margins stop collapsing).
- **Motion.** A screen change arrives behind one 20° wipe (`.scrIn`, added by `showScreen`). In the menus
  the camera eases to a per-screen shot (`CONFIG.camera.menuShots`, keyed by screen id, `menuLerp`); no idle
  drift, so the render throttle still settles. The HUD (`hud.js`) writes the same palette as literals.
- **League lobby** is three tabs (Season / Squad / Club, `lgSetTab`); layout keys `league` (Season) and
  `leagueClub`. The win screen is a full-time board (`#winBoard`, filled in `endMatch`).
- **A kit colour on a MATERIAL goes through `kitLin(hex)`** (world.js): the renderers output sRGB and r128
  reads a hex as linear, so a raw `color.set(hex)` renders lighter and greyer (crimson came out rose pink).
  The HUD and CSS take the hex as-is.
- Kit swatches and a new save's kits come from `CONFIG.playerModel.swatches` / `kitDefault` (club colours).
- **Options** is built like every other menu (centred boxed panels, standard backdrop), with four tabs: Display, Audio, Controller, Keyboard & Mouse. **No Advanced tab** (owner,
  2026-09-25): a setting lives with its device's other settings. Every control is found by id, so groups can move freely.
- **Audio buses** (`audio.js`): effects (`Au.mg`), crowd (`Au.cb`) and menus (`Au.ub`) sum into `Au.sum` (the clip
  recorder's tap), then `Au.out` (master + Sound switch + mute-in-background). `Au.mix()` pushes cfg onto them.
- Still web-shaped: the Kick Off header bar.

## Modes

- **Kick Off** (`roster.js`): per-player seat cards, press-to-join, 4-a-side local co-op.
- **League + Champions Cup** (`league.js`): the player is team 0. Builds and upgrade parts. Rules
  (`lgGoalCap`/`lgMins`) belong to the save and the cup uses the league's rules. The venue belongs to
  the session (`lgVenueEnter`/`Exit`). The cup is a seeded tree.
- **Training** (`training.js`, `S.trn`): the sandbox.
- **Skill Trials + daily** (`trials.js`, `S.trial`): training with a rulebook.
  - The clock is sim time and starts on the first SWING.
  - Retry re-seeds from `S.seed`.
  - Scoring runs in two directions: elapsed time (lower is better), and `saveRun` saves (higher).
  - Spawns must clear the resting foot box and stay in reach; the harness checks this from live CONFIG.
  - The daily is a pure function of the date.
  - **All medal thresholds are unplayed guesses.**
- **Tutorial** (`tutorial.js`, `S.tut`): training with a lesson plan (`CONFIG.tutorial.lessons`), armed from
  `trainingEnter` like a trial. `#tutorial` picks Keyboard & Mouse or Controller (prompts only; every device
  works). Offered once before the first Kick Off / League start (`tutOffer`, `cfg.tutSeen`); always in
  Training. Finish card: Continue/Done + Redo (back to the picker). `cfg.tutDone` backs the achievement.
  Keyboard prompts show the first key AND the first mouse input of each action (`tutKey`).
- **Replays** (`replay.js`): a ring buffer re-posed from footage, with sound and saveable clips.
  The match winner gets one.
- **Photo mode** (F1, `photo.js`): stills, clips and offline turntable renders.
- **Room editor** (F2, `roomedit.js`, `CONFIG.debug.roomEditor`): authoring tool; it exports paste-ready
  `CONFIG.rooms` blocks.

## Dev tools

`C` collision/AI overlay (`L` kick log for a traced rod) · `F` free roam · `M` frame profiler
(`gap = ms − js` says whether a slow frame was our code or the browser/GPU) · console: `memLog()`,
`memTex()`, `lightAudit()`, `perfDump()`, `disposeDebug()`. `DIRECTION.md` plans to cut these from the
player build.

## Open threads (as of 2026-09-24)

- **Controls:** the pin + pin shot landed 2026-09-25 (push/pull fall out of it; snake cut for EA).
  Unplayed: `pin.capV`, `pin.carry`, `pin.pow`. Tutorial built 2026-09-25 (lesson ball speeds unplayed).
  A charged shot in the sweet band now beats maxV for its whole swing (`cap.charge`/`chargeTop`, `r.swOver`). Nothing has been tested on a real controller or for keyboard feel
  (R-Shift/R-Ctrl comfort). Team-name typing on a pad needs Steamworks. The pad is not rebindable
  (Steam Input).
- **UI rebuild** per `DIRECTION.md`: first pass done (palette, plates, home menu, value selectors).
  Done since: League tabs, HUD palette, club-colour kits, full-time board, screen wipe, menu camera shots.
  Then: Options over the scene, and the kit colour fix (kitLin). Next: tune the menu
  shots by eye; check both kits under every room (cast-kits).
- **Balance/feel still unplayed:** trial medal thresholds; `slidePush`; how far past maxV a charge should go.
- **Perf:** the texture budget (figurines at 2K, pitch uncompressed) and the boot freeze.
- `CONFIG.debug` gates to remove for the player build; Electron wrapper, Steam Cloud, achievements
  (`ACHIEVEMENTS.md`).
