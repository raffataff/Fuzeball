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
- **Sound list:** https://claude.ai/artifact/TMbwSC58rjuKnVveDB21NF (every sound id, its trigger and source plan; mark Draft/Final as files land).
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
  like the code around it. `config.js` is the exception: human-tuned, spaced, one-line comments per value.
- **Comments are sparse, and written like a human dev would.** Only two kinds: a short title to split a file
  into sections (`// --- reaction latency ---`), and a one-line note on a non-obvious line or on what a
  higher/lower value does (`warnT:5, // clock turns red in the last N seconds`). Never write multi-line
  paragraphs, change-log or "this used to…" diary text, bug post-mortems, or a comment that restates the code.
  The *why* behind a decision belongs in `docs/CLAUDE-history.md`, not in the source. When you touch a
  function, trim its comments to this rule rather than adding to them.
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
   mutation's anchor when you change the line it targets.** Slice anchors (`slice(src,'function x(',…)`)
   must be code, never comment text, so editing a comment can't break a harness. When harnesses boot files in a `vm`,
   top-level `const`s are lexical, so export them via an explicit `globalThis.__x={…}` line.
   - `audio` (sample player, routing, room reverb, crowd, stand-in DSP), `shots` (charge machine), `pin` (catch / carry / every release / the pin shot), `pinhint` (the pinned-ball ring and the kick plate), `binds` (keyboard/mouse verbs + rebinding + the pad/keyboard merge),
     `padnav` (menu navigation), `layout` (stored form), `trials`, `rng`, `matchstats`, `moments`, `wallplay`, `slidepush`,
     `chargeverdict`, `savesplit`, `venueload`, `roomenv`, `sky`, `saucer` (the saucer GLB/sky ship and the giant sits in its window bay), `roomlights`, `props`, `pitch`, `ktx2`, `offline`, `backguard` (AI back-lift / slide guard), `retrieve` (the retrieve action's sequence), `catch` (which balls the AI pins, the carry and the hand-off to retrieve), `deadforce` (`deadLeft`, the dead-ball projection), `cover` (keeper and DEF split the mouth), `tictac` (a ball along the rod: bounce off a down man, through a raised one, under a raised-back one into the pin), `side` (the AI's side catch: which balls, the pose angle, the cushion, the ends), `tap` (the AI starts a tic-tac: where to, when, the run, the release, the hand-off; the defence too), `back` (a tap goes back when the receiver's lane shuts: the decision, the men down, the slide-in, the hand-on), `meet` (a man slides to a slow ball: which balls, the approach law, the pose, the ends), `steer` (a pass from a pin slides through the swing, and a free pass runs at a slow ball: the slide-heading table, the room, which mates are in reach, what `pinPlay` commits, the run-up's plan and steps), `recv` (the rod a pass is aimed at holds a forward pin pose: arming, the pose and the man, every way it ends), `fetch` (the forward pin's front door: which loose balls, the clear / up / over / down sequence, every way it ends; the reach rule), `hit` (the tap proper: the angle that squares the foot onto a ball, stepping off, the run, the hand-off, the loose-ball pick), `tt` (the AI's tic-tac: the pair, when a pin is stuck, the bounce and its lunge, the rows read by their target, the strike plan checked against the rod law, the slide chosen at the last moment, the swing, every way it ends, a ball lying loose, a MID's own pace and its lane read past the row in front)…
   - **`tools/backswing-soak.js`** is the browser-side companion (load it in the `fuzeball` preview): `bsSoak` runs
     whole AI-vs-AI matches and tallies goalward knocks, `bsKeeper` drops slow balls behind the keeper. It silences
     audio itself (stubs `Au.init`, leaves `cfg.sound` alone). One call of the preview JS tool is capped at 45 s, so
     run one configuration per call (40 × 180 s of sim is ~14 s). **`tools/deadforce-soak.js`** (`dfSoak`) tallies the
     whistles by where the ball died and, for a ball a rod could play, what that rod was doing the step before. Both
     soaks must copy `b.cur` after each step like main.js does, or the dead-ball clock reads a frozen ball.
     **`tools/keeper-soak.js`** (`gkSoak({fam:'lat'|'lg'|'pocket'|'ang'})`, `gkCheck()`) throws seeded balls at the red keeper on the real sim and
     tallies goal / dead / played; `gkCheck()` is the pass/fail (shipped keeper settings against the old behaviour on the same trials, ~15 s, one call).
     **`tools/side-soak.js`** (`sideScene({ri,rel,vz,from})` = one ball rolling along a rod with a trace; `sideGrid({ri})` = every position x speed cell, what the rod did first: pin / kick / through / bounce; `tapScene({ri,man,s,off,rel,dz,trace})` = a ball pinned under a man and a tap forced, trace of release / cushion / pin; `tapGrid()`, `tapRandom({n,diff,seed,ri})` = how many taps end in a pin (ok or back-ok); `tapScene({block:[{ri,off}]})` holds those opposing rods at an offset; `backGrid()` = a tap against each offset of the row: goes back or lands, nothing lost; `meetRandom({n,seed,diff})` = random slow balls clear of every man, how many end in a pin (compare `AIC.catch.meet.on`); `fastGrid({ri,k})` = a ball let go just past man k and rolling to the next at each speed, depth and way: how many pin; `retTapScene` / `retTapGrid` = the real retrieve pinning a deep ball that is then tapped; `tapRoles()` = taps started / landed per role since the last call, for `catchSoak`). A scene must start every rod at rest, centred, and pin `r.aiErrT` or aiUpdate re-rolls `r.aiIQ`.
     **`tools/catch-soak.js`** (`catchSoak({on})` = whole AI-vs-AI matches: catches, pins, shots / passes / plain kicks and how often each is touched by the other team, goals, whistles; `catchScene({rel,vx,alone})` = one hand-placed ball at the red ATT with a trace). One call of the preview JS tool is capped at 45 s: ~24 matches per call.
     **`tools/play-soak.js`** (`playSoak({seeds,secs,diff})` / `playTry(tag,fn,opts)` = whole AI-vs-AI matches: swings by kind, plain kicks by role and by WHY the rod had no control move (iq roll off / a catch ended first / ball at rest / sideways / leaving), every pin play by role and reason (open shot, open pass, push, pass, late), pin hold times; ~60 matches per call).
     **`tools/pinshot-soak.js`** (`psSweep`, `psScene`, `psAim`, `psTry` = a sweep with CONFIG paths overridden and restored)
     catches a ball on a posed rod, fires the real pin shot and reports the exit speed against plain/hard/charged-kick yardsticks.
     **`tools/cover-soak.js`** (`cvSoak({on})` = whole AI-vs-AI matches: goals, open width of the mouth; `cvGallery({on,smart,vr,xr})` = aimed shots at the red keeper + DEF alone; `cvRebound({n,zr,vr})` = a ball off the end wall rolling back out, how far the DEF stands from its z at its line). One call of the preview JS tool is capped at 45 s: one 30-match `cvSoak` per call.
     **`tools/kickangle-soak.js`** (`kaOffsets({ri})` = a ball at rest in front of one man at each z offset, the heading the plain swing leaves it on; `kaSlide({ri})` = the same with the man sliding through the strike; `kaSoak({seeds,secs,diff})` = whole AI-vs-AI matches: for every plain kick / pass / pin shot the heading it was meant to take against the one it took, who touches the ball first, goals, whistles; `kaTry`). ~0.6 s per 120 s match, so ~70 matches per preview call. Two identical runs differ (goals 0 vs 0.17 per match over 6, plain kicks 87.8 vs 87.5): trust 24+ matches and compare on fresh seed sets.
     **`tools/recv-soak.js`** (`rvScene({n,seed,ready,maxTh,trace,keep})` = a red DEF passes to the red MID with nothing in the way: how many end pinned by the heading asked for, the steps around the contact of the failures) and **`tools/humanseat-soak.js`** (`hsSoak({seeds,secs})` = matches with a human seat on red that tracks the ball, kicks and passes: invariants on held rods, how many human passes arm / pose / pin the mate); **`tools/gkkick-soak.js`** (`gkKick({seeds,secs,diff,keep})` = whole matches: every keeper kick followed for 0.9 s, the DEF's pose at the kick and what became of the ball: pinned / through / bounced back / stalled; `keep` = the first bounced ones with why the DEF's receiving ended) and **`tools/page-run.js`** (runs any soak from a terminal in headless Chrome: `node tools/page-run.js tools/gkkick-soak.js "gkKick({seeds:120})"`, an extra `js/ai.js=path` argument serves another version of one file for an A/B); **`tools/posture-soak.js`** (`rdCover` = how often the rods ahead of the ball stand in the receiving pose, by who has the ball); **`tools/reseat-soak.js`** (`rsSoak` = what follows a re-seat: swing / lost / timeout and how long; `rsTrace` = the first few step by step); **`tools/ab-queue.js`** (`abQ(jobs)` / `abLeft()` / `abAgg()` = an A/B of CONFIG paths over `kaSoak` / `bsSoak` / `rdCover` / `rsSoak` jobs queued in the page, run between calls, restored after: the way to get past the 45 s cap); **`tools/fwdpin-soak.js`** (`fpScene({ri,man,s,mode:'tap'|'shot'})` = a ball rolled into a rod posed forward and pinned, then a forced tap or the shot an open goal asks for; `fpTapGrid()` = every man both ways, how many taps end in a pin; `fpShotGrid()` = when the first swing comes and as what; `fpTry(name,set,fn)` = CONFIG overridden, restored after; `fpWatch({seeds,diff})` = whole matches: every ball held under a forward leg, how it arrived, how long, how far it was carried, how often the carry turned round, how it left). `abQ` queued from a call that then awaits a timer starves the queue: poll with calls that return at once.
     **`tools/tt-soak.js`** (`ttScene({ri,s,diff,block,pa,loose})` = a ball pinned by a rod (`ri` 5 ATT, 3 MID, 1 DEF) and a tic-tac forced, the opposing rows benched where `block` says: phases, tallies, where the shot crosses the goal line against the lane it was judged on; `pa` = the pin angle, i.e. the depth the ball is held at; `loose:{rel,z}` = a ball lying there instead, the real `catchPick` deciding; `ttStrikeScene({u,sg,w,lead,assist,style,curve})` = one man posed back and a ball rolling across his z, the heading the slide gives (`curve` = a swing curve merged over `ai.trapShot`); `ttSoak({seeds,diff,on,roles,prep,go,drop,tt,dink})` / `ttRun` / `ttAB` = whole AI-vs-AI matches: how many start, how they end (`byRole` too), what the strikes do, whistles that follow; `tt:{key:value}` overrides `CONFIG.ai.catch.tictac` for the run, `dink:true` makes every tic-tac strike the slow swing; `ttQ(jobs)` / `ttQDone()` / `ttQSum(name)` = runs queued in the page between calls (past the 45 s cap: poll with calls that return at once); `ttCal` = the lane prediction against the lane when the ball is struck). A scene bench the held rods (`isActiveRod`), or the AI moves their targets under you.
     **`tools/hit-soak.js`** (`hitScene({ri,man,s,d,a,gap,V})` = a ball at rest d ahead of the rod, the man gap off in z with the leg at a, slides at it at V: what the ball does; `hitGrid()` = every depth at the angle `hitAngleFor` gives it; `hitTap({ri,man,s,ang|lie,diff})` = a ball pinned (a back pin, or a loose one at `lie` ahead for the AI's own fetch / retrieve to pin) and a tap forced to the next man, trace of the phases; `hitTapGrid()` = every man of every outfield rod both ways, how many end in a pin by the neighbour; `ballTry({d,vx,...})` = a ball placed ahead of a rod with the shot gate shut and the real AI left to play it).
   - **Failing at the end of 2026-10-09 in code that session did not touch:** back (7 assertions: they need `tap.maxChain` 2, the working tree has 1), catch 4, recv 2, tap 1, tictac 1 ('dribble and trap holds stay dead').
  - **Failing before 2026-09-24 and still failing (not regressions):** photo-record, rodholes,
     roomlight, roomlights, slidepush; shots has 3 failing assertions (the working tree's soft-curve
     retune, plus `kick.strike` 0.055 → 0.025, which makes "hard anchor is FASTER" fail).
     **`ai.trapShot` has no wind-up now (`windup:0.0`, `strike:0.1`; the owner removed it 2026-10-06: the rod is already back in the pin pose).** The boot is on the ball about 0.03 s into the swing, before the power window (`powFrom` 0.05) opens, so `strikeProbe` sampled only boots already past the ball and refused every AI pin shot (catchSoak: pin shots 11.5 -> 3 per match, 4 'gate' endings). `strikeGate.lead` 0.02 -> 0.05 starts the sampled window at the swing's start (only a style with no wind-up is affected): shots 16 per match, no gate endings. The pin shot itself was never weak (psSweep exit ~103 u/s against 105 with the old curve).
     Also red at baseline on 2026-10-04 (same counts with `sideRest` at 0.01): ballcap 5, binds 4, ktx2 1, shots 5, slidepush 2; **pin-harness crashes** since the
     `shots.pin.angle` -0.5 → -0.75 retune (its rel 0.9 ball is no longer in the leg's reach, so the catch test fails and the next line reads a null rod).
4. **Live**: `.claude/launch.json` serves the repo on `http://localhost:8123` (preview name `fuzeball`).
   In the browser pane **rAF often doesn't run**, so step `loop(t)` / `navTick(t)` by hand with rising
   timestamps. Replace `navigator.getGamepads` with a synthetic pad to test controller paths. **Set a
   viewport first** — the pane can report `innerWidth` 0, which stacks every panel in one column.
   Synthetic key events should target `document.body`, not `window`: on `window`, listeners run in
   registration order, not capture-first.

## File map (boot order)

`core` · `config` (all tuning) · `rng` (seeded per-consumer streams) · `screens` (screen router) ·
`intro` · `arena` (bowl-table SDF physics) · `audio` (`Au`: recorded takes, else synthesized stand-ins) · `state` (`S`) · `stats`
(rod stats) · `moments` (saves / woodwork / goal classification) · `matchstats` (the match ledger +
post-match sheet) · `seats` (every human at the table) · `world` (three.js scene, lights, `PRV` shared
preview renderer) · `balls` · `rods` · `physics` · `ai` · **`shots`** (player kick verbs) · **`binds`**
(rebindable keys) · `input` · `powerups` (+ dead-ball) · `flow` (match flow) · `fx` (FX + camera) ·
`marks` · `capture` (clip recorder, zip writer) · `replay` · **`hud`** (the whole in-match chrome, one
canvas) · `ui` · `roster` (Kick Off lobby) · `options` · `league` (league + Champions Cup) · `layout`
(panel layout editor) · `customize` · `props` (instanced prop library) · `models` (GLB loading) · `grass` (blade grass on pitches) ·
`fracture` · `debug` (`C` overlay) · `perf` (`M` profiler) · `sweetspot` · `training` · `trials` · `tutorial` · `photo`
(F1) · `roomedit` (F2) · **`vsel`** (◀ value ▶ selectors) · **`padnav`** (controller menus) · `main` (loop).

Tools: `tools/*-harness.js`, `tools/menu-shots.js` (every menu screen at 1280×800, flags overflow), `tools/build_font.js` (compiles `tools/fuzefont.js`, the **FuzeClip** display face, to `fonts/fuzeClip/FuzeClip.ttf`; pure Node, no font library; capitals, digits, punctuation, arrows / triangles, a few symbols and Latin-1 + common Latin Ext-A accents (composites spaced like their base letter, class-based GPOS kerning); lowercase aliased to capitals; no `ß Æ Œ`; registered in `fonts/fonts.css`, applied to `--font-display` / `--font-ui` / `--font-italic`; `menu-shots` lists any character it lacks), `tools/build_props_manifest.js`, `tools/build_audio_manifest.js` (index assets/audio/, prints every sound's state), `tools/audio-preview.js` (renders the synthesized crowd to WAV in tools/build/), `tools/ktx2-encode.mjs` (run from
`tools/` after `npm i`; `--dry` first), `tools/sky-encode.mjs`, `tools/trophy-alpha.mjs`, `tools/ktx2-decode.mjs` (the inverse of ktx2-encode: a KTX2 GLB to a PNG GLB that Blender can open; the Shardsmith importer runs it), Blender scripts `tools/build_nebula_sky.py`, `build_moon_sky.py`, `build_saucer_sky.py` (all on `skylib.py`), `build_saucer_room.py`, `build_void_asteroid.py`, `build_moon_base.py`, `tools/build_moon_pitch.mjs` / `build_deck_pitch.mjs` (Node, on `pitchlib.mjs`: generated pitches, then ktx2-encode), `tools/build_table.py` / `export_table.py` /
`build_pub_room.py`. **`tools/blender/shardsmith/`** is the Blender add-on that makes the player/ball explosion GLBs (robust fracture, rigid-body blast, bake, glTF export); its README covers install, the game workflow and how it works; test with `blender -b --factory-startup --python tools/blender/shardsmith_test.py`. It replaces `tools/fracture_script.py`. Its **Export GLB** bakes if needed and then runs `tools/ktx2-encode.mjs` itself, so an export is game-ready; an explosion GLB whose clip is short or missing (unbaked or never set up) freezes the debris in mid-air, because `spawnFracture` plays LoopOnce and clamps on the last frame.

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
**Side bounce** (`kick.sideRest` 0.5, `sideDot`; `sideBounce` in physics.js): a ball rolling along the rod bounces off a man's ±z faces, which is what makes
tic-tac work: a tap is a slide into the ball, a down man bounces it back, a raised man lets it through, a raised-back man lets it roll under and then pins it.
Only the ball's own approach rebounds, so a tap is no stronger (`slidePush` untouched). The front touch stays dead (`kick.rest` 0.01), a swing keeps its own
restitution, the player's hold fades the bounce to 0 with the squeeze (`h.sideRest`), the AI's trap/dribble stay dead, and heavy balls still plow in (every
contact response divides by mass). `sideRest = rest` is the old behaviour exactly. `tictac-harness` pins it. Measured 2026-10-04 (A/B on the same seeds): the four
keeper families, 36-match `bsSoak`, `cvSoak` and `catchSoak` unchanged within noise; whistles in `dfSoak` ~22 → ~12 per 20 matches (that soak varies run to run).
Bouncing the FRONT face too is the obvious next dial (a separate value, not tried).

**AI (`ai.js`).** Per active rod: pick the ball (seen through a reaction-delay ring buffer, `aiView`),
align a man (with hysteresis, deadzone, drifting error), then choose an action: `lane` (make way for the
keeper), `catch` (pin a ball running at the rod, carry it, play it), `retrieve`, `safeRaise`, `dribble` (+ passing), `evade`, or a kick (`trap` is off). **Two hands per team**
(`CONFIG.ai.hands`): only that many rods move; the rest hold. Every human-held rod is forced into its
team's active set. Three lessons that keep coming back:
- **Static vs swept reach.** `inFootRange` is a static rectangle. Any action that ROTATES the rod needs
  the swept test (`sweepClips` for the foot, plus the leg), or the rotating boot drags the ball goalward.
- **The kick gate is a snapshot**, so aimed/slow swings are re-checked by `strikeOn` (predicted
  contact) before committing.
- **The back guard** (`CONFIG.ai.backGuard`; `backLimit` / `slideBlocked` in ai.js, called from
  `updateRods`) is the last word on an AI rod's back-lift and z-slide, so it covers every path at once
  (raise latch, safeRaise, evade's follow-through, bench raise). Measured 2026-09-30: a slow ball in the
  pocket behind the keeper was being knocked goalward in ~9% of trials (57 knocks / 7 own goals per 600);
  now 3 / 0. Three things it encodes: any boot contact hands the ball the boot's velocity (a lifting tip
  is 100+ u/s); a lift is only safe when the man is z-clear AND stays so until the boot is over the ball
  (safeRaise's old -0.8 parks the boot IN the ball: a ball resting 1.5-5.6 behind is touched until ~-1.2,
  hence `safeRaise.angleBehind`); the contact band for a far ball is thin, so the lift arc is sampled by
  ANGLE (`arcStep`), not by count. A held lift stamps `r.lhT`, which drops the raise latch so `evade` can
  clear the lane. Kick swings, trap, dribble, the pin and human rods are exempt. `tools/backswing-soak.js`
  (browser) measures it; `backguard-harness` pins the rules. The lift is timed by the ease the rod really runs
  (exponential, `-ln(1-f)/rate`), not linearly, and a ball INSIDE the box reads as "ahead" (footBoxDist's
  normal is degenerate there), hence `deepD`.
- **Retrieve** (`CONFIG.ai.retrieve`; `retrieveStep` in ai.js, runs before safeRaise/evade) owns a slow ball
  (<18 u/s) BEHIND the heel, 0.8-6 back, which used to sit in a dead band (evade needs 1.6 behind, the kick zone
  starts 0.8 behind) while the rod half-lifted and gave up. Sequence: **side** (slide AWAY from the man on the
  ball until every man is z-clear; it never crosses a ball closer than `crossRel`, because the slide guard would
  stall it) -> **lift** (boot behind and over) -> **over** (slide onto the ball's z, boot up; `backHit` says when
  it is free) -> **pin** (the player's own pin, `r.pinOn/pinPose/pinA`, then the `trapShot` pin shot) or **drop**
  (boot sweeps forward through the ball). Keeper and smart rods pin; others drop. The pin pose must LEAD the boot
  by less than `shots.pin.capA` (`pinLead`) or the catch is never armed and the leg knocks the ball forward. Every
  exit goes through `retrieveEnd`. `tools/retrieve-harness.js` pins the sequence; soak tallies are `BGS.ret*`.
- **Catch** (`CONFIG.ai.catch`; `catchPick` / `catchStep` / `pinPlay` in ai.js, ahead of retrieve in `aiUpdate`; `catch-harness`,
  `tools/catch-soak.js`). The AI pins and carries with the player's own pin (`r.pinB`, physics.js `pinUpdate`); the old sticky
  trap is off (`trap.on:false`: 90% of its entries ended in ~0 s, because a ball rolling at a lowered man rests ~3.3 in front of the
  rod, outside the trap's 1.4 window). ATT/MID/DEF rods, whatever the iq roll (`catch.iqGate:false` since 2026-10-09; `true` = only rods whose `aiIQ` roll passed). **Front**: a ball running at the rod from upfield
  (2-50 u/s, arriving within 1.5 s, a man can reach its z): the leg is posed at `shots.pin.angle` once the ball is `poseT` away and
  the ball dead-stops against it at rel ~-0.5..-0.7, in FRONT of the boot, so the pin shot connects (measured: any z, 10-100 u/s).
  **Behind** (a ball coming up from the rod behind, 6-45 u/s): boot straight down (`behind.angle` 0), the ball stops at the heel
  (rel -2.9..-3.5) and the action hands it to **retrieve** (lift, over, pin), which gets `r.catUntil` so its iq gate cannot drop it
  mid-way. The stop must stay shallow: a ball deeper than ~-4.2 fails the pin shot's strike gate (`faceDot`), which is why the
  stop pose is 0 and not -0.25 (rel -4.4). **Carry** (`pinPlay`, shared with retrieve's pin phase for every rod but the keeper):
  open lane (ATT: the line to goal and the mouth; the rest: the gap past the row ahead, `fwdClr`) -> shoot, or pass (2026-10-06,
  `catch.open`: GK and DEF pass an open lane whenever a mate is on offer and never shoot on the slide (`push:false`, the soft pass
  swing cannot be placed off a sliding rod, so a DEF push went every time), MID passes only when the mate scores 4 above the lane, ATT shoots);
  else slide to a
  reachable z whose lane is open (either way: `pinTarget` scores every z standing and pushed in the direction it would be carried;
  the z it already heads for gets `flipGain`, so it turns round for something clearly better and not for a tie); else tap to a
  neighbour; else pass (`passPick`, `dribble.pass` settings: since 2026-10-06 the carry and the tap go BEFORE a pass from every pin,
  `catch.carryFirst`, false = only from a forward pin as before; pro, 24 matches: passes 5.9 -> 4.4 per match, DEF push shots 1.1 -> 0, MID passes go to shots
  off the open lane the carry finds, goals / whistles within noise, plain kicks unchanged because pins are only ~14 per match);
  else wait for the lanes to move until `holdT`, then play it. Lanes are judged with the
  opposing rows where they will have slid to by the time the shot arrives (`laneObs` / `fwdClr` take `v0 = catch.shotV`).
  **The push** (`catch.push`): a shot fired while the rod slides at `minV` or more. The ball keeps `carryOut` of the slide, the boot
  keeps its speed through the swing (`r.catSv`; aiUpdate holds the target at `offset + catSv*dt` while `r.catSw`), and the lane is
  judged from where the ball leaves (`drift` x slide ahead) on the slope `k` x slide (`pushSlope`). Measured with the aim assist off:
  a boot faster than the ball overruns it and the heading flips sign, so the swing speed is the carry speed. A rod sliding slower
  than `minV` but faster than `fireV` judges nothing and settles. **The aim point**: `aimAssist` reads `r.aimEv.best.tz`, null
  during the swing it bent every pin shot ~8° toward the middle, so `pinAim` puts it on the line the shot was judged on (dead
  ahead for a still shot, the push line for a push). `catchSoak` / `catchTry` (72 matches, 2026-10-04): pin goals per match 0.25 with
  the push vs 0.07 without it; total goals per match 0.88 against 1.33 with `catch.on:false` (the AI holds and passes more, plain
  kicks 106 -> 77; the knobs are `lineClear`, `holdT`, `front.maxClose`; none moved it clearly). Limit: the opposing men sprint onto
  a lane, so ~85% of pin shots are still touched by a row within a second (plain kicks 80%); `pinGoals` per shot is the figure that
  moved. `CAS` / `CAW` tally entries and why each ended or fired.
- **Side catch** (`CONFIG.ai.catch.side`; `sidePick` / `sideAngle` / `sideStep` in ai.js, the third phase of the catch; `side-harness`, `tools/side-soak.js`). A ball rolling ALONG the
  row (|vx| < 4, 7-45 u/s, between rel -2.0 and -0.55, a man ahead of it in its roll) is received the way a real player does: the men go up (the ball rolls under) and the pin pose drops onto it
  `dropT` (0.3 s) before it arrives, then it is an ordinary pin (carry, shoot, pass). The rod does not slide: the ball comes to the man. **The pose angle is chosen per ball** (`sideAngle(rel)`,
  bisection on the leg-to-ball distance): the leg sits `legD` 3.35 from it, clear of it (the leg hits at BALL_R + PRAD = 2.9, the BOOT BOX reaches 3.3) and inside the pin's reach (3.5). At the fixed pin angle (-0.75) the catch
  window across the man was 0.6 units wide at rel -0.5 and the leg already touched a ball at -1.3 (so an early pose blocked it, and timing was everything: shallow wanted 0.3 s, deep 0.12, ~75% on a
  rookie); with a per-ball angle the window is constant (±1.0 at 3.35) and an early pose never blocks, so timing stopped mattering (dropT 0.2-0.45 all pin). **legD was 3.2 until 2026-10-05**, and the foot box (half-width 1.0 + the 0.4 offset + the ball's reach 1.9 = 3.3 from the leg's axis, at the foot end of the leg) touches a ball 0.6 before the pin's window opens: a ball arriving at a SETTLED pose stopped dead at the box about 2 units out, and the contact grip drags a ball's z speed to the rod's. It showed as the deep-ball failures (below) and as a chasing man pushing a ball (meet). 3.35 is clear of the box, and the tap landings did not move (357/357 either way). **The pin judges the ball's speed against the ROD's**
  (`pinUpdate`: hypot(vx, vz - r.vz) <= capV 14), so a quicker ball is **cushioned**: from `cushionT` (0.2 s) before it arrives, with `cushionRoom` of slide left, the rod runs along with it at its speed
  less `cushionW` (10), closing at 10 (AI slide accel is 600 u/s², so it is there in ~0.03 s). **A ball up to `cushionV` (45) is matched, if the rod can: its own speed + the pin's reach + `cushionSlack`.** The run starts no further out than `cushionD` (3.0): at 38 u/s the old 0.2 s lead was 7.6 units, the rod closed on it at only 10 and ran out of slide (20 units wanted, 11.5 of travel) before the catch. Measured with `fastGrid` (a ball let go just past one man, rolling to the next, 3 depths x both ways x 3 difficulties): ATT and DEF **every ball from 20 to 45 u/s pins** (was 0 above 34), MID to 34 (its men are 11.9 apart: a 38 u/s ball is there in 0.19 s, and `cushionD` 2-3.5 trades 34-38). Starting the POSE early for a quick ball (so it is settled) was tried twice and made taps fail (885/885 -> 848, then ~0 with the pose latched): it must go on only once the cushion has, or the ball is slow enough. It reads the REAL ball (`best.real`): after
  a tap the delayed view still shows a held ball and read "it died" on the first frame. The band stops at -2.0 (`back`): below that, with legD 3.2, the boot box clipped the ball (a ball at -2.4 got struck forward at 15-19 u/s) and the note here blamed the descending boot. With legD 3.35 it is not the boot: every ball from -2.4 to -3.5 at 7 / 12 / 22 u/s pins 4/4 (was 0/4 at 12 u/s from -3.0), so `back` could be widened. It is not, because that takes slow lateral balls off retrieve in matches (not measured); the deep tap below has its own limit (`tap.deep.back`). The front edge is where the leg stops reaching (about -0.5). Deeper slow balls are retrieve's; balls at the feet are kicked as before. Lateral balls at rest-rod:
  70/72 over ATT/MID/DEF x 6 depths x 7-12 u/s (misses: a 7 u/s ball starting too far off), 18/18 at 16-26 u/s (the cushion). Rare on its own (~0.25 per 2-minute AI-vs-AI match: it is the tap's receive).
- **Tap, the AI starts a tic-tac: the ROLL** (the owner's name for it is a roll: the pin-posed man carries the ball and lets it go; the tap proper, the man's side knocking it along the row, is **hit** below, and `tapStart` tries that first) (`CONFIG.ai.catch.tap`; `tapEval` / `tapStart` / `tapStep` in ai.js, called from `pinPlay(r,best,t,dt,tap)` / `catchStep`; `tap-harness`, `tapScene` / `tapGrid` / `tapRandom` in
  `tools/side-soak.js`). A rod holding a pinned ball (ATT / MID / DEF, ball held between rel -0.95 and -0.55, or deep: -3.8 to -2.0, `tap.deep`) that has no shot, no pass worth making and **nothing it can carry the ball to that opens a lane**
  (`r.pcOut < lineClear`) sends it along the row to the neighbouring man whose lane is open where the ball will end up (`zB + s*drift`, judged with `pinOutlet`), at most `maxChain` (2) in a row. Only the catch
  passes `tap` to `pinPlay`: retrieve shares that carry and could not act on a 3. **The tap**: the rod runs along the row with the ball still pinned (the carry), and lets go at `releaseV` (0.92) of its carry
  speed, so the ball leaves at `pin.carryOut` (0.8) of the slide: ~22 u/s for a pro rod (a tap is as fast as a rod can slide: AI rod speeds are 30-43 u/s against the player's 80, so an AI tap is no faster than a carry;
  its worth is reaching a man the holding man could not carry to). The pose is kept (the ball rolls under the leg: no collision at these depths, 3.1-3.4 from the capsule), the rod brakes, and the neighbour takes it
  as a cushioned side catch (`r.catPh` tap -> side -> hold). `CAS.tap` / `tapOk` / `tapFail` count taps, landings (the receiver pinned it) and failures. Measured: `tapRandom` (random start offset, depth in the
  band, z under the man; 714 trials: rookie / pro / legend x 3 seeds) **714/714**; real matches (`catchSoak`, 36 x 120 s): 0.94 taps per match, all landed; 36 x 180 s: 61 taps, 61 landed, no goalward knock in a
  tap or side catch; goals / dead balls / pin shots within noise of tap off. The tuning that mattered: `cushionRoom` 3 -> 2 (the cushion needs slide left AFTER the run and the brake, 19/714 missed at 3), and the
  per-ball pose angle above (before it: 108/120 legend, 85/100 rookie, all at a ball on the edge of the leg's reach). **The defence taps too** (two men 24 apart, `maxD` 27; forced taps landed 76/76 on each difficulty, and it is in the 885/885 of the tap back below), but a DEF almost never starts one in a match (0 in 60): the pass comes before the tap in `pinPlay`
  and it nearly always has one, or a carry to a z with a gap (its slide is +-18), and most of its pins are retrieve's, which cannot tap. With the carry and the passes taken away (`slideMax` 0.5, `dribble.pass.roles` empty) it taps 105 times in 60
  matches and 94% land.
  **A ball retrieve pinned is tapped too** (`retrieveTap`; retrieve's pin phase asks `pinPlay` with `tap` and a 3 hands the rod to the catch's tap phase with the pin still on: `CAS.retTap`). Retrieve holds a ball DEEP (median -2.95, none in the shallow band, 266 pins in 40 matches, 68%
  of them the DEF's), so the tap has a deep band (`tap.deep`: -3.8 to -2.0) and a roll that started deep is judged over only past `deep.back` (-4.8; `r.catDeep`, set at the release, cleared by `catchEnd`). The receive is the ordinary one (men up, drop onto it): it works at that depth once legD is 3.35;
  the tap back is not offered for a deep ball (its lean and bounce are worked out for the shallow band). `retTapScene` / `retTapGrid` run the real retrieve (a slow ball left behind the heel, the carry and the passes taken away, the opposing row held where the lanes are wanted): every retrieve pin that was tapped
  landed, DEF 36/36 and MID 27/27 over the three difficulties (with legD 3.2 the rookie rod's slower tap, ~15 u/s, stopped dead at the boot box: 0/12). In matches (60 x 120 s): 0.35 retrieve taps per match, 1.28 of 1.32 taps landed, goals / pin shots / goalward knocks unchanged. Not built: a tap from a ball pinned by the keeper (one man).
- **Tap back** (`CONFIG.ai.catch.tap.back`; `backEval` / `backStep` in ai.js, the decision is a hook in `sideStep`; `back-harness`, `backGrid` in `tools/side-soak.js`). While a tap is rolling to its man (`r.tapPend`, chain under `maxChain`, rod not yet
  cushioning) the rod looks at the lanes every `every` s: if the receiving man's lane has shut (judged where he will have drifted to, `+s*drift`) and the man it came from has one open where it would come back to (`-s*drift`), with slide left to run
  that way and the ball `clear` (3.6) off the sender, it goes back. **The men go down once the ball is clear of the sender** (a boot swinging down onto a ball 1 unit off is a kick), **with the boot square onto the ball**
  (`asin((rel - footBoxOff.y) / (ARM + footBoxOff.x))`, about -0.2: the box centred on the ball's depth). An upright boot's box corner knocks a ball at rel -0.8 backward as it bounces (it came back 1.5 deeper, outside the leg's 3.5 reach, and died: 2 of 70
  lost); square on, it returns 84% of its approach speed and the man it came from pins it. The man slides into the ball from `runD` 4 at `runV` 22 (the slide push adds to the bounce), brakes once it has turned round, and when it is `clear` of him
  the phase is `side` again with the man it came from and the roll reversed; the chain count is up, so ping-pong stops at `maxChain`. **The decision must leave the men time to go down**: the first cut timed it to the man's middle at the closing
  speed (the rod still moving), the boot was still at -0.12 at contact and the ball left forward at 5.5 u/s (tap fails 1 in 37 -> 4 in 19); it is now `ahead - contact` (3.3: the boot box reaches 1.35 + the ball's 1.9) over the ball's OWN speed, at least `tMin` 0.2 s.
  Which rods: DEF and MID (a lane there is a gap past the row ahead). The ATT almost never (2 of 156): its lane has the goal-mouth term, so after a tap to an in-mouth receiver the sender (18.5 away) is outside it. A MID's window is narrow (11.9 apart, the ball
  needs 0.55 s): back 60 / 62 of 234 on rookie / pro, none on legend (its taps are quicker). `backGrid` (opposing row held at each offset): every trial ends in a pin by one man or the other, none lost (DEF 38-40 back of 78, MID 46-62 of 234);
  `tapRandom` 885/885 landed (113 of them back). **In AI-vs-AI matches it is 0 in 60**: it needs the opposing row to move off the lane in the second or so the ball is rolling.
- **Meet** (`CONFIG.ai.catch.meet`; `meetPick` / `meetStep` in ai.js, the fourth phase of the catch, after `sidePick`; `meet-harness`, `meetRandom` in `tools/side-soak.js`). A slow ball along the row (1.5-12 u/s) that no man will roll into (too slow, or too far for the
  side catch's window) is met: the nearest man AHEAD of it in its roll that can stand within `zTol` of its z takes it, the men up, and slides to it **fast while far and closing at `closeV` (9) from `slow` (4) off** (speed toward it = min(`use` x the rod's speed,
  sqrt(u^2 + 2 x `brake` x (dist - slow))), u = closeV + the ball's own speed toward him, never below 0, so a ball already coming at him faster than closeV is waited for); the pin pose (`sideAngle(rel)`) goes on `dropT` before he is there and it is an ordinary pin.
  No man may be within `clear` (4) of the ball's z (the lift would clip it). **Only a man ahead of the ball, never one behind it**: a man chasing a ball that rolls away pushes it. The foot box (1.4 + the ball's reach 1.9 from the leg's axis) touches a ball 0.6 before the pin's
  window opens (the leg reaches 3.5 at the old legD 3.2: +-1.4; the box is why legD is now 3.35), and the contact grip drags the ball's z speed to the rod's, so the closing speed falls to 0 and it never gets in; the chase law also fed back (u = closeV + the ball's speed, which the push raises: the rod went 11.9 -> 21.5 u/s).
  Head-on, the closing speed is what the pin needs. `meetRandom` (random rod / depth / speed / direction / start z clear of every man, three difficulties): **450/450 pins against 388/450** with the meet off (55 kicks of a slow ball, 5 bounces, and retrieve's slower route).
  **In AI-vs-AI matches the conditions hold ~0.1 times per match** (the AI keeps the ball against its men): 1 meet in 60 matches. It is for a human's slow lateral ball and for tuning. Not built: a man that chases, a ball at rest in the band (retrieve's).
- **The forward pin: its reach, fetch, ahead and the tap from a ball held ahead** (`CONFIG.shots.pin.fwd*` / `CONFIG.ai.catch.fetch` / `.side.aheadMin`; `fetchPick` / `fetchStep` / `aheadStart` / `aheadStep` / `sideAngle` in ai.js, `catchPick` falls back to them, `r.catPh 'fetch' | 'ahead'`; physics.js `pinUpdate`; `fetch-harness` (79 assertions, 55 mutations), `tools/play-soak.js`; 2026-10-06, owner: balls in front of a man that are not under control should be brought under control most of the time, a kick is for a clear shot; later: a ball pinned too far forward looks silly, if the foot cannot reach the top of the ball it pings off).
  **Physics (the reach rule):** `r.pinFwd` (set by the pose, cleared with it) swaps the pin's catch for a forward leg's: window `pin.fwdFront` 5 (not `front` 1.4), the leg capsule really touching the ball (within `fwdTouch` 0.2, not the 0.6 slop of the back pin) and from ABOVE (contact normal at least `fwdDown` 0.75 downward, within 41 degrees of the top of the ball). Before it a forward leg held a ball up to 8 ahead from 0.45 off it (the foot hovering above it: the "silly" look). Measured geometry (lowering the leg onto a ball at rest): the leg first touches the ball top at 0.87 rad for a ball 2 ahead, 0.98 at 3, 1.07 at 4, 1.13 at 5, 1.14 at 6, and not at all past ~7; the contact is on the top from 2 ahead (normal 0.75 down) out, so the man is always laid out near 55-65 degrees: that is this table's proportions (arm 6.3, ball 1.9), not a tuning choice. `fwdFront` 5 and the AI's `fetch.far` / `side.fwdFront` / `tap.fwd.max` 4.5 stop short of the 7 the geometry allows because at 5.5 the toe is on the rear of the ball and he is flat out. A leg rotating FORWARD from rest sweeps through a ball ahead and blasts it (75-80 u/s: measured), so a ball lying ahead is taken from above, the retrieve route mirrored. A pinned ball is held where it was caught: the owner removed the pull-in to the back pin (the man moved through the ball); there is no `pinPull`.
  **The toe pin is gone** (built and removed 2026-10-06): a ball RUNNING at a raised leg meets its front, not its top, so by the reach rule it cannot be held (the toe stopped balls 5-7 ahead with the contact on the equator; with the rule they rest against the foot unpinned or get kicked: tried 0.3 / 0.6 / 0.9 / 1.1 rad at 20 and 45 u/s). A ball running at the rod is the shaft's (the back pin) or the let-through's (`take.thru`, which lets it roll under and comes down on it).
  **Fetch** (a loose ball lying 2.8-4.5 ahead, under 3 u/s, no shot open where it lies): `clear` (the man slides z-clear, leg down) -> `up` (leg up and forward, `recv.lift.angle`) -> `over` (slides onto its z, slowly: the pin takes a ball only at a small speed relative to the rod) -> `down` (the leg is lowered until it touches the top of the ball: `sideAngle(rel,true)` is that first-touch angle, `side.topGap` 0.08 off it, and the pin catches it) a forward pin ahead of the rod (`catPh 'hold'`, carried and tapped as it lies). Any rod, whatever the iq roll (`catchPick` runs for every rod; a rod whose roll is off gets only the fetch). A catch that ends `stopped` hands over to a fetch with no cooldown, and `catch.liftY` 3.0 stops a hopping ball (a pass hops to ~2.2) from ending a catch at `lowY` 2.05. `sideAngle` for a ball nearer than `side.aheadMin` 2.0 (the receiving pose, under the leg behind the pivot) is still the old `legD` 3.35 pose; out of reach the leg stays up.
  **Ahead** (a swing play from a ball held more than `fetch.aheadMin` 1.4 ahead, `reseat` routes to it): the rod stops, the ball is let go at rest, the man slides off its z with the leg up, the leg lowers at rest, the man slides back onto it, and the ordinary swing takes it: the boot is behind the ball. `r.ftCd` (`fetch.cd` 2 s) keeps it from being fetched again at once; it is reset with the rod (`resetRodRotation`: a stale timestamp from the last match blocked every fetch until S.time caught up; every new timestamp field goes there).
  **Tap from a ball held ahead:** `tap.fwd.max` 4.5 lets `tapEval` look at it, `tapStep` (the roll) lets it go as it is and `tapSide` hands it to the neighbour as a forward side catch (`side.aheadMin` 2 to `side.fwdFront` 4.5: the leg comes down on a ball rolling along the row ahead of the rod, `r.pinFwd` while it does). The real tap below is the better way out of a held ball.
  **Measured, 24 x 120 s, after the reach rule and the hit:** pro plain kicks 49 per match (74 at the start of the session), pins 28.5, pin shots 10, taps 10.4 (4.8 of them hits, 90+% landed), fetches 7.6 (5.7 pin), ahead 5.7; rookie 41 / 26 / 8 / 10 / 9.1, legend 45 / 31 / 15.5 / 9.3 / 5.1. `bsSoak` 24 x 180 s pro: goals 17-27 across runs (23 at the start, 14 with the old reach), own goals 0-1, knocks 14-16, redrops 21-30 (22 at the start), idle ball seconds 1180-1300 (1000 at the start). Knobs: `fetch.on`, `fetch.far`, `fetch.cd`, `pin.fwdFront` / `fwdDown` / `fwdTouch`, `catch.holdT`.
- **The tap proper: hit** (`CONFIG.ai.catch.hit`; `hitAngle` / `hitStand` / `hitFits` / `hitOk` / `hitStart` / `hitGo` / `hitStep` / `hitLoose` in ai.js, `r.catPh 'hit'`, `r.hPh`; `tools/hit-harness.js` (86 assertions, 78 mutations), `tools/hit-soak.js`; 2026-10-06, owner: tapping is hitting the ball with the man's SIDE and knocking it to the next man, who taps it back, catches it, lets it through or kicks it; the pin-posed man rolling the ball out is not a tap; the player adjusts the rod forward or back to line the foot onto a ball that has drifted).
  **What the old tap was, and is:** `tapStep` is a ROLL: the rod carries the pinned ball along the row, lets go at `releaseV` of its carry speed and the ball rolls out from under the leg at `carryOut` of the slide, the man still in the pin pose. It stays (a share of the taps, and every one the hit cannot do). `tapStart` now asks `hitOk` first.
  **Geometry (measured, `hitGrid`):** the foot box's ±z faces hit a ball cleanly when the BOX is on its depth, so the angle is chosen per ball (`hitAngle(rel)`: the angle that puts the ball's centre nearest the middle of the box's rectangle, null past `fit` 0.9 of its edge): -0.8 rad for a ball 4 behind the pivot, -0.25 at -1, 0 at +0.5, +0.44 at +4. Every depth from -4 to +4 leaves the ball along the row at ~20 u/s (a pro man runs at 34-39), no forward drift, no hop; from 4.5 the corner of the box catches it. The slide is accel-limited (600 u/s2: about 1 unit to reach full speed), so `runUp` 1.0 gives the speed. The ball is PLOWED at the man's speed while he pushes it and leaves at its own ~0.52 x his speed once he brakes. The foot must be still when it meets the ball (`tolW` 0.4 rad/s, `tolA` 0.02): a turning foot hands the ball its x speed (0.8 u/s over a second took a shallow ball out of the next man's window and lost 4 of 28 rookie taps).
  **The sequence** (`r.hPh`): `rest` (the slide stops, restV 2.5, then the ball is let go at rest) -> `clear` (the man steps off it AWAY from the neighbour to `hitStand`: footBox.z + BALL_R + clearMargin + pad + runUp off its z; the leg holds the pose it is in, the pin is off) -> `aim` (the leg turns to `hitAngle`, the man settles) -> `run` (he slides at `runV` 34 toward the neighbour; a ball moving along the row with the box on it is the hit) -> `out` (the rod brakes; once the ball is clear `tapSide` hands it to the neighbour's side catch: a back band, the deep band for a deep ball, a forward catch for a ball lying ahead). A ball flush under a forward leg is let go by the lift first (`fliftStart(r,'hit')`, then `hitGo`). Bands (`hit.bands`): -3.8 to -0.6 (what the neighbour's back catch takes and the foot reaches) and 2.0 to 4.0 (lying ahead); the dead zone between has no taker. `hitFits`: room to stand off and to run on and brake, and the neighbour still `jGap` clear of the ball where the man stands (the rod carries him toward it: spacing less the stand-off must clear the box, so it only bites on a rod with men closer than ~9.6; MID 11.9, ATT 18.5, DEF 24 are all fine).
  **Loose balls** (`hitLoose`, `hit.loose`): a ball at rest between two men (every man at least the foot's reach off its z), no shot open where it lies, in a band, with a neighbour whose lane is open where it will end up, is hit to him instead of being fetched or kicked; any rod, whatever the iq roll, a decision once per `loose.every` 1.5 s at `loose.share` 0.5. It is rare in AI-vs-AI (0.1 per match: a ball at rest between two men with no shot is not common); it is for the human's balls and for tuning.
  **Measured:** forced hit taps from a back pin, every man of every outfield rod both ways: 28 of 28 land at rookie, pro and legend (4 by a tap back); from a forward pin (the receiving pose, via the lift) 28 of 28 each; from balls lying -3.6 to +3.9 (the AI's own fetch / retrieve pins them first, 3 difficulties): 497 of 497, none lost (the rest are the roll or no pin). In matches (24 x 120 s) hits 4.6-5.3 per match at every difficulty, 92-95% pinned by the neighbour (the roll's 85-95%); `catchSoak` tallies `CAS.hit` (started), `hitHit` (the foot met it), `hitSent` (handed over), `hitOk` (the neighbour pinned it), `hitLoose`. Switches: `hit.on`, `hit.share`, `hit.loose.on`.
  **Not built:** the human's forward-pin input (finesse + kick / right-stick forward: the owner's idea is that the forward stroke IS the pass; a stroke at `pin.lerp` 14 kicks a ball at the boot at 70+ u/s, at 3-6 it is a soft 16-33 u/s push, only a ball beyond ~7 is caught at the end of the stroke); a human's tap (the same side hit by a player: the rod angled and slid, nothing to build but the HUD cue); the meet for slow balls along the row ahead; a plain kick only when the moment is right; a tap from a ball the keeper holds (one man).
- **The tic-tac: work the ball between two men, read the rows, strike** (`CONFIG.ai.catch.tictac`; `ttVal` / `ttRoom` / `ttSlides` / `ttPick` / `ttWant` / `ttLoose` / `ttStart` / `ttGo` / `ttCatch` / `ttObs` / `ttOutlet` / `ttPlan` / `ttOpts` / `ttBest` / `ttStrike` / `ttStep` in ai.js, `hitLoose` for the loose start, `r.catPh 'tictac'`, `r.ttPh` bounce | strike; `tools/tt-harness.js` (171 assertions, 196 mutations), `tools/tt-soak.js`; 2026-10-07, owner: a coach's 3-bar tic-tac guide as the spec: lateral transfers between the centre figure and a wing figure at a steady pace, read the defenders' gaps, strike the moment one opens with a back-tilted figure and a brush across the ball, straight / cut / dink).
  **How it maps.** *Transfers:* the ATT's two neighbouring men, both down and squared onto the ball's depth (`hitAngle`, held fixed: turning the foot to chase the ball's depth pushed it forward, ~0.15 per touch), the face of the man the ball rolls to slides INTO it as it arrives (`ttStep`: waits while it is far, starts when the time to the face is within the ramp from his present slide + `lunge`; slide at `pace` 0.9 of the rod's top speed), it comes off at ~0.75 of that and the rod turns for the other man: in the 4 s it is allowed, 10 touches at pro / legend and 7 at rookie (~3 a second), the ball's depth creeping ~0.2. Ball and rod are the real sim's (a face meeting a ball: `sideRest`, the slide pushes at 0.73 of its speed). *Entry:* a pin that is STUCK (`pinPlay`: nothing to shoot, carry (`pcTz` null) or tap to, held `minHold`, `share` 0.7 per hold, `roles` ATT / MID / DEF, back pin only, never retrieve's call) returns 4; the first touch is a `hit` toward the better neighbour (`ttPick`: lanes at the middle of the gap), which hands over to `ttGo` instead of a side catch. While it waits the rod drifts to where the pair is centred on the goal (`homeV`): a strike from either man has the mouth in reach (the pair at 9 up: straight lanes reach |tz| 7, cuts toward the middle the rest). *Exit, always graceful:* any end that keeps the ball (`maxT` 4 s, `maxTouch` 14, creep past `drift`, a committed strike given up) is `ttCatch`: the man it is rolling to takes it as an ordinary side catch (the ball is cushioned up to 45 u/s) and the pin plays on; a cooldown (`cd` 2.5 s) follows every one.
  **Second pass (2026-10-07): the depth, a loose ball, MID / DEF.** *Depth.* A funnel on `ttWant` (36 matches, pro) showed why only ~0.5 tic-tacs a match started: the band was rel -2.0..-0.55 and a stuck ATT pin holds the ball at -0.55..+0.1 (frames: +0.05 18%, -0.2..-0.55 about 9% a 0.05 bin, -2.35 and -4.1 (deep, retrieve's) 9% each; 8% inside the old band), so `ttPick` said no on depth to most of the looks. The bounce, the strike and the exit all work there: forced with the strikes off, the ball bounces 12 touches and ends `tt:time`, the side catch pins it at rel -0.63 / -0.38 / -0.15 / +0.08 / +0.19; forced strikes score. `relMax` is now 0.15. Same seeds, 200 matches an arm at pro, off / old band / new band: tic-tacs per match 0 / 0.55 / 1.31, whole-match goals 0.64 / 0.65 / 0.57, dead balls 0.60 / 0.59 / 0.63, pin shots 10.4 / 10.1 / 9.9, passes 4.35 / 3.98 / 3.91; strikes 0 / 0.09 / 0.12 (24 in 200, 33% touched by the other team, 7 goals); legend (80) 1.59 tic-tacs a match, goals 0.84 off / 0.64 on, dead 0.53 / 0.64, strikes 0.15; rookie (80) 0.95, goals 0.88 / 0.78, dead 0.59 / 0.41, strikes 0.07. Opening the band more than doubled the tic-tacs and left the strikes about where they were: the AI defence is the limit, as before. `bsSoak` legend 18 x 180 s on / off: goals 17 / 23, own goals 0 / 1, goalward knocks 11 / 11, redrops 17 / 10 (the old band: 19 / 18); `hsSoak` 14 matches: no violations.
  *A ball lying loose* (`hitLoose` already finds it: at rest, no man within the foot's reach of its z, no shot open where it lies; then `ttLoose` (the switch, `tictac.loose`, the role, the cooldown) and `ttPick` over the pair it lies between, either man of it to play first): the same `tictac.share` takes the tic-tac over the plain hit when both are on offer; `ttStart(r,true)` begins with the man stepping off (no pin to let go), and the hit's hand-over is the bounce as for a pin. Forced (a ball at rest at z -9.25, +9.25, -9.25 and +4, rel -1.2, -1.2, -0.7 and -1.8, the other rows frozen): hit, bounce, strike, 4 of 4 (three scored); at rel -3 it is a plain hit, outside the band. In matches 0.07-0.1 a match (2 in 24 at pro), the same rarity as the loose hit itself (a ball at rest between two men with no shot is not common): it is for a human's balls. A tap's landing needs nothing: the receiver pins it and the pin is stuck like any other.
  *MID / DEF* (`roles`, `byRole`): both bounce, commit and strike in the forced scenes at every difficulty (`ttScene({ri:3|1})`). A MID's men are 11.9 apart, so the ball crosses its 5.4 of free run in ~0.2 s, less than the leg needs to tilt back (`strike.tilt`) and the bounce ran 14 touches in 2 s with no strike ever on offer: `byRole.MID` works it at `pace` 0.5 (a crossing of about 0.35 s) with `room` 5. The strike is the rod's own way forward (`ttOutlet`: an ATT's line to goal and the mouth, the rest the gap past the opposing row in front, as `pinOutlet` judges them, with the rows read by `ttObs`; `ttObs` marks a row of the rod's own team standing ready `own` and it is no row): a clearing shot through the gap, not a pass. In matches they are rare, 0.03-0.13 (MID) and 0.05-0.15 (DEF) a match: `ttWant` is asked by a MID ~54 frames and a DEF ~36 in 36 matches (an ATT ~8000), because those rods pass or carry before they hold a ball with nothing to do (and a DEF's pins are mostly retrieve's, deep, outside the band). Whole matches at pro (40, same seeds), tic-tac off / ATT only / all three: goals 0.53 / 0.93 / 0.72, dead balls 0.45 / 0.42 / 0.53, noise; `bsSoak` at the three difficulties with all three on: own goals 0, knocks within noise.
  *The dink, measured and not built.* The idea (a soft strike that finds a lane a fast one does not) has no home here, with a reason: the swing's clean steering window is the limit. A trapShot-style swing slowed to `strike` 0.16 (powFrom 0.05, powTo 0.16, hold 0.31, drop 0.36) leaves at 86.8 u/s with lateral 0.96 x the slide (0.011 per u/s, the same at 14 / 22 / 30 u/s of ball) for slides up to 20; from 24 up it is erratic (at 28 and 32 a 14 or 22 u/s ball left at 23-25 deg and a 30 u/s ball at 11 deg the wrong way; at 24 and 38 it went sideways or backward). Other curves are worse (0.13 s: clean in 26 of 32 trials, 0.16 s 32 of 32, 0.19 / 0.22 / 0.26 s 26 / 20 / 24; 0.34 s sent the ball backward at slides 12 and 20). The pass swing (`passShot`) from the back-tilted pose is chaotic (heading -72 deg at 20, +22 at 28). So the dink's widest clean heading is 12 deg (slide 20), the shot's 12.5 deg (slide 32): no extra reach, and the ball takes ~1.5x as long to cross the rows. Whole matches with every look committed and none given up (`prep` / `go` / `drop` open, ATT only, pro, same seeds): shot 105 strikes in 240 matches, 24 goals (23%), 59% touched by the other team; dink 89 in 210, 21 goals (23%), 42%: the same goals. A pass out of a MID / DEF tic-tac is out for the same reason (12 deg is 3 units of z over the 15 to the next rod, a mate's spacing is 6-12 and more). `ttSoak({dink:true})` and `ttStrikeScene({curve})` are the tools.
  **The strike (measured, `ttStrikeScene`, assist off):** the leg must be back at the side-catch pose (`sideAngle`) before the ball reaches the man's face or it BOUNCES (from the squared pose, at -0.19, no swing connects), ~0.22 s (`tilt`; the pose eases at 14/s). Then a `trapShot` swing fired with the ball `gap` 0.4 short of the man's centre leaves at 130-142 u/s (sweet spot) and contact is within the first step: the timing is easy. **The ball leaves with the rod's slide:** lateral = 0.9 x slide, forward ~130 (`strike.k` 0.0069 per u/s: 12 -> 2.4 over the 35 to the goal line, 20 -> 4.8, 32 -> ~8.5; the same either way, whatever the ball's own direction); the grip lerp pulls the ball's z speed to the rod's on every contact, so a still rod kills the lateral speed (straight) and a sliding rod hands it over (the owner's guide: "push or pull toward the lane"). Slides on offer: 0 / ±12 / ±22 / ±32; a slide WITH the ball is at most `pushMax` 0.8 of its speed (the ball must overtake the man; at ~its speed the man's side meets it first). With the aim assist on it bends the exit toward `aimEv.best.tz`, so the strike sets that to the lane judged. Forced strikes into a frozen defence: 72/72 goals (both teams, three difficulties, six defences), crossing z within 1.4 RMS of the aimed lane.
  **Plan (`ttPlan`, exact against the rod law: gap off <0.6 with the step, speed off <1.5):** the man brakes to rest, waits `d`, ramps to the slide, is at speed `settle` before the ball is `gap` short of him; `d` = time to the ball's arrival less (|v0|+|w|)/accel less settle. **Two stages, because the leg is slow and the direction is not:** `ttOpts(...,false)` at the last moment the leg can still get back (`late` 0.08 s window past `tilt`) commits the LEG when the best lane clears by `prep` 2; in the strike phase every frame re-reads the rows (`ttOpts(...,true)`), the slide changes only for a lane better by `stick`, and at the last moment the man can get going (`cur.d <= 1.5 steps`) the lane must clear by `go` 1 or the ball is taken as a side catch (`tt:shut`); once he is on his way only `drop` -0.5 gives it up. go -> swing is ~25-140 ms (the guide's <150 ms is the direction decision; the leg's 0.22 s is not avoidable, a gap that opens later than that waits for the next traverse). The swing is fired only with the leg back (`tolA`), the gate `strikeOn` asked with the slide shown carrying on (`push.lead`), and holds its slide `hold` s (`catSv` / `catSw`, like a pin pass).
  **Reading the rows (the finding that cost most):** `laneObs` extrapolates a rod by `vz` over the flight; an AI rod's slide speed is bang-bang (it flips ±5 u/s per step), so over the 0.3-0.7 s to a strike it said nothing: lanes judged open flipped shut within 0.04 s in 100% of commits (`tt:shut` 35 / 35), and they were read at the commit, 0.7 s ahead. Now `ttObs` reads each row where it is HEADING: its `target` plus `r.tgV` (the smoothed target velocity, new, one line in `updateRods`) carried on `tgtLead` 1.0 of the way over the time to the strike, as far as the rod can slide by then. `ttCal` (a straight strike every traverse, prediction against the lane when the ball is struck): abs error 0.93 with no carry-on, 0.69 at lead 1.0, 0.84 at 1.5, 1.0 at 2.0; reading as late as the leg allows (0.3 s ahead, not 0.7) took the error from ~3.3 to 0.7-0.9. An AI defence closes a lane at ~10 u/s of clearance once the ball is moving toward the strike point (it follows the ball's z with its own lag), so a lane that looks open at the commit has lost ~1.5 by the go. **Do not read a held rod with laneObs's slide for anything over ~0.1 s.**
  **In matches, first pass (band -2.0..-0.55, ATT only; legend / pro / rookie, 30-60 matches a cell, same seeds on and off):** 0.3-0.9 tic-tacs per match, 2.2-3.2 s, 3.3-5.6 touches each, ending mostly `time` (the ball is taken by the side catch and the pin plays on) and `shut`; strikes are RARE against an AI defence that sees the ball: legend / pro 0.03 a match (the lane shuts at the go in ~95% of commits even with the rows read as late and as well as above), rookie 0.03-0.1 a match, all four seen scored (slower rods leave the lane open: the guide's progression is the difficulty). With every commit fired (an earlier cut of the reading, 60 matches): 0.55 strikes a match, 82% touched by the other team, 6% goals, against ~2% for a pin shot. Goals, whistles (0.36-0.79 a match across sets, noise: no whistle fell within 10 s of a tic-tac in 40 matches), pins, taps and hits unchanged; `bsSoak` 20 x 180 s legend on / off: goals 12 / 11, own goals 0 / 0, goalward knocks 9 / 16, redrops 16 / 14; `hsSoak` 12 matches: no violations. Not play-tested by a human. Pair centring: lanes >= 2 clear in 9% of the looks against 6.5% without it.
  **Switches / knobs:** `tictac.on`, `.roles`, `.byRole` (a rod's own `pace` / `room`), `.loose`, `.relMin` / `.relMax` (the depth it is worked at), `.share`, `.minHold`, `.pace`, `.homeV`, `strike.on`, `.prep` / `.go` / `.drop` / `.stick`, `.tgtLead`, `.tilt` / `.late`. **Not built:** the dink and a pass out of a MID / DEF tic-tac (measured above: nothing for them to find); a rally from a deep pin (rel -2.35 and -4.1 are ~18% of the stuck frames, retrieve's: `sideAngle` and the hit would have to reach there); a faster tilt for the leg (built in the third pass: `tictac.lerp`, the player's pin stays `shots.pin.lerp`).
  **Third pass: the rally as the way a rod plays a held ball (2026-10-09, owner: only the ATT did it, about once a match; every row should tic-tac, fast, the foot angle adjusted to keep the ball in range, the ball sometimes let through to the next man, worked into a gap; pin / gentle tap / pin is boring; "tic-tac should be one of the first things it does").**
  Baseline (`ttSoak`, pro, 24 matches): 2.5 tic-tacs a match (ATT 1.9, MID 0.2, DEF 0.3), 1.8 touches and 1 s each, 44 plain kicks, 11.7 roll-taps; 54% of the rallies ended `catch:shut`. Why, in the order it was found:
  (1) **Tic-tac was the last choice** (after carry, tap, pass), only for a back pin, with a 2.5 s cooldown after every rally. `tictac.first` asks it straight after the shot (an open shot is still taken; passes, carries and taps come after), `cd` 0.3, `minHold` 0.15 (the catch's own `settleT` 0.2 is the real wait).
  (2) **Most held balls are forward pins**: 72% of the ATT's and 51% of the MID's pin frames were a forward pin held over 0.6 s (`funnel` diag: `ttWant` was refused for "depth fwd" and by `!fwd`). `ttStart` now lets a forward leg go with `fliftStart(r,'hit')` (`CAS.ttFwd`); a ball held AHEAD (the fetch's, rel over `side.aheadMin`) goes straight to the hit. Band: start `relMin..relMax` -2.0..+4.0, a rally in progress ends outside `offMin..offMax` -3.0..+4.4 (the foot squares onto a ball from -4 to +4: `hitAngle`); a rally that ends in front of the pivot is taken as a forward catch (`r.ttRelNow`).
  (3) **A strike committed too early, and its failure ended the rally.** `ttOpts` timed the leg for a slide WITH the ball as if the man were already sliding away, but he stands until his go: the leg went back ~0.45 s before the ball reached his face and the rows were read ~0.6 s ahead (clearance 3-14 at the commit, -1 at the shut, in most of the DEF's commits). Now counted to the standing face (`ttPlan` returns `z0`, `tt=ts<=q.d?ts:...`). `strike.warm` 3: the rows are not read before the ball has been touched three times, so it is a rally first. **Revert** (`strike.back` / `untilt` / `relock`, `ttRevert`): a committed strike whose lane clears by less than `back` while the ball is still `untilt` 0.1 s from his face squares the leg up again and bounces the ball; `untilt` must be the time the leg needs to come back AND settle (0.06 first: the leg met the ball still swinging forward and handed it 13 u/s, `tt:off`). Past the face it is the old 'shut' side catch. `tictac.lerp` 45 (the AI's tilt in a rally; the player's pin stays `shots.pin.lerp` 14, rods.js `r.ttOn&&r.act==='catch'`) makes the tilt ~0.09 s so `tilt` 0.2 / `late` 0.05 read the rows 0.2-0.25 s before the face. **Ease** (`strike.patient` / `ease`): a rally past 3 s settles for up to 1.5 less clearance in `prep`, `back` and `go`, so a long rally takes the narrower gap; `maxT` 10 (a timed-out rally waits `cdTime` 2.5 s so the ball is played). `maxTouch` 40.
  (4) **Squaring** (`tictac.square`): between touches, while the ball is `farT` 0.18 s from both faces, the foot is turned toward `hitAngle(rel)` by at most `step` per look; depth held within 0.05 over 8 s (the old fixed foot crept 0.2 a touch and ended the rally at 1.0 off); a depth no angle fits hands the ball over (`tt:drift`).
  (5) **Let-through** (`tictac.thru`, ATT only): with a man beyond the one the ball is rolling to, a free run to him of at least `run` 0.3 s and the decision `lead` 0.3 .. `min` 0.18 s before the face, `share` 0.35: the leg goes back as for a strike (`sideAngle`), the man stands, the ball rolls under him, and once it is `past` 3.9 beyond his centre the foot squares up and the pair is him and the next man (`CAS.ttThru`; `thruDiag`: 94 of 96 completed, 92 bounced back by the next man, median 0.39 s later). MID is off (its men are 11.9 apart: 5.3 of run, 0.2 s at rally speed).
  (6) **Lunge room** (`homeV` drift is held `lungeRoom` 2.5 off the slide limits): the pair-centring drift put an outer MID pair at the end of the rod's travel, the man the ball rolled to could not slide into it, and the ball died against a still face (rookie MID: 269 `tt:dead` in 30 matches); with under a quarter of that left the rally is handed over (`tt:room`).
  (7) `catch.iqGate:false`: stopping a ball is a basic skill (like the fetch and the loose hit, which were already ungated); plain kicks 30 -> 20 a match on its own, 24 of 41 plain kicks were "iq roll off". The difficulty is the rod speed and the lanes it can read. Not done for the trap / dribble / safe-raise gates.
  **Measured** (`ttSoak`, 36 matches a cell, fresh seeds, rookie / pro / legend): tic-tacs a match 15.7 / 18.2 / 16.4 (5-6 of them from a forward pin), ATT 4.8-6.4, MID 4.0-5.6, DEF 4.4-6.4 each, 3.5-4.1 s and 5-8 touches a rally (ATT 5.5-6.8 touches over 4.7-6.4 s; MID 10-15 touches in 1.7-2.4 s), let-throughs 6-9, reverts 2-5.6, strikes 4.6 / 7.1 / 4.9, plain kicks 16-18 (was 41-44), roll-taps 1.5-2.4 (was 11.7), passes 1.2-2.2, goals 1.44 / 1.61 / 0.75 (was 0.7-0.9; 0.6-1.3 of them from tic-tac strikes, ~25% of strikes: the rookie's slower defence leaves lanes open, as the owner's guide says), dead balls 0.2-0.4. `bsSoak` 24 x 180 s: goalward knocks 10 / 5 (pro / legend; was 14-16 / 11), own goals 0, redrops 9 / 8 (was 21-30), idle ball seconds 680 (was 1000-1300); `hsSoak` 14 matches: no violations. tt-harness 230 assertions / 255 mutations; fetch-harness sets `iqGate` itself. Not play-tested by a human, and the goal rate is up: `strike.prep` / `go` are the dials (2.0 / 1.0).
  **Pitfalls:** harness `world()` resets the rng (set it after building the rod); a ball in a scene must be placed relative to the shifted men or it is 'through'. Diagnostics used (scratch, not kept): a funnel wrapper on `ttWant` / `pinPlay`, a frame ring on `ttStep`, a wrapper on `momContact` to see what touched the ball. **Not built:** a MID let-through (needs a slower ball or a shorter squaring time), a rally from a deep retrieve pin (rel -2.35 and -4.1), the dink (still nothing to find).
- **Kick heading** (`tools/kickangle-soak.js`; `CONFIG.ai.aimCone`, shipped OFF; measured 2026-10-05, legend vs legend, 24-36 matches). **A plain kick or pass does not leave on the lane the AI judged.** The foot face is flat (`footBox.z` 1.35 each side) and the AI strikes within 1.2 of a man's
  centre, so the contact normal is dead ahead (`kaOffsets`: 0.0 deg at every offset to 1.35, assist off); the only steering is `aimAssist` (`assistAng`: 2.6-5.7 deg for a shot, 9.2 for a pass, set by the rod's acc stat, NOT the difficulty). **An edge hit is no better**:
  the grip lerp (`kick.grip` 0.5, physics.js `collideRod`) drags the ball's z speed halfway to the rod's after every contact, so a ball struck 1.9-3.1 off centre (normal 17-67 deg) leaves at 1-9 deg. What does turn it is the rod's SLIDE through the strike
  (`kaSlide`, ball on the face: 20 u/s -> ~10 deg, 40-80 u/s -> 16-18 deg; a slide that carries the man's SIDE into the ball gives 45-80 deg and no forward speed) and the ball's own lateral speed.
  In matches only 5% of plain kicks are struck with the rod planted and the ball not moving sideways (mean rod slide at contact 22 u/s, ball vz 15 u/s), and then the heading is ~3 deg for any lane up to 20 deg off. The other 95% scatter +-15 deg around no relation to the lane:
  delivered heading = 0.2 x the heading asked for (plain; passes 0.4), a plain kick meant 16 deg and left at 10; an AI pass is meant for 37 deg on average and 96% of them ask for more than 10. **The first rod to touch the ball after a kick is the other team's 90% of the time**
  (that is the interleaved rows, any kick must first cross an opposing row), after a pass 87-93%. `aimCone` (lanes and mates judged only within assist + slack of straight, `shotEval(...,cone)` / `passEval`) removes the pretend lanes: 36 fresh seeds goals 0.86 -> 0.36 per match,
  passes 11.8 -> 0.5, plain kicks 95 -> 69, own-team first touch unchanged (10%), at slack 0.12/0.30 and 0.25/0.5 it drifts back to the old play without landing more. So the cone alone is worse, because the AI has nothing to do with a covered lane except hold and fire anyway.
  **Never gate the kick on the slide or the ball's lateral speed dying** (it costs the moment, and a ball rolling past is gone). The no-wait version, `kaSoak({plant:true})` (a swing sets `r.target=r.offset` from its first step; AI slide accel 600 u/s2 sheds 20-30 u/s before the boot lands): plain kicks per match 94 -> 95.5,
  rod slide at contact 22 -> 12 u/s, struck near-planted (<3 u/s) 11% -> 41%, mean |heading| 10.1 -> 6.2 deg, miss against the lane 15.6 -> 11.7 deg; goals 0.46 -> 0.63 (noise), whistles 0.63 -> 1.0 per match (not chased). The natural heading is roughly
  atan2(0.35 x slideV + 0.05 x ball vz, speed) and then the assist (RMS error against the real heading 8.6 deg assuming straight, 6.1 with the model): usable but its 6 deg residual is the size of the assist. So the ball's own sideways speed is a thing to predict, not remove.
  **The slide-through window** (`kaSlide`, real assist, ball at rest on a man's centre line; legend rod 43 u/s, pro 39, rookie 30). The man must be AT or PAST the ball's z when the swing starts for a face strike: 43 u/s leaves at 9-11 deg at 66 u/s forward (16 deg fired 1.5 past), 30 u/s 5-7 deg,
  20 u/s 3-4 deg, so a face strike steers +6-8 deg at best. Fired 0.25 or more SHORT of the ball's z, the SIDE of the foot meets it: 42-56 deg at ~30 u/s forward at 43 u/s (32-45 deg at 30, ~18-20 at 20, with the two regimes flipping within +-0.25 at the lower speeds); the boundary is 0.25 units = ~6 ms at 43 u/s.
  So a slide gives a drive (~+8 deg, full speed) and a slap (35-55 deg, soft). In legend matches (30 x 120 s): plain kicks want <=5 deg 20%, 5-13 29%, 13-17 12%, 17-55 40%; ball speed at the swing <15 u/s 28%, 15-40 41%, 40+ 31%; passes (11.4 per match) want 17-55 deg 84% (>55 9%) and 91% are of a ball under 15 u/s.
  **The soft pass swing is the clean steer** (`kaSlide({style:'pass'})`, same setup, assist off): the heading follows the rod's slide and NOT the fire point, over the whole window (-1.75..+1.5): lateral ~0.92 x slide, forward ~55 - 0.26 x slide, so 0 -> 0 deg, 20 -> 20, 30 -> 29, 39 -> 38, 43 -> 41 deg (44 u/s forward). No side regime.
  The ball's own lateral speed adds ~0.3 x it at rest and nothing once the rod slides (`kaNatural`). **But it does not carry into matches by looking at the slide when the AI decides**: the soft swing takes 0.17 s to reach the ball (a plain swing ~0.04), the rod's slide changes by 35 u/s RMS in that time, and a free pass's heading
  correlates -0.26 with the slide at the decision and +0.66 with the slide at contact. A pass needs its slide COMMITTED through the swing (`catSw` / `catSv` hold the target ahead for the pin shot). Plain kicks on the decision-time slide: 16.8 -> 14.5 deg RMS, not worth a judge.
  **A pass from a pin (48% of AI passes) leaves at 17.3 deg toward its target, +-0.6-1.3, for any wanted angle from 10 to 90 deg** (a cap of 17 deg models it at 2.3 deg RMS; 3% want 17 or less, so nearly every one undershoots: mean wanted 36.6). Free passes (the kick's `onKick` redirect, 52%) are made sliding ~21 u/s undirected.
  `aimCone` is now shots unlimited (`shot:null`) + a pass cone of 0.30 rad (the 17.3 deg), still OFF. 72 matches (two fresh seed sets, legend vs legend): passes 11.3 -> 1.6 per match, pass miss against the lane 22 -> 4.5 deg, goals 0.53 -> 0.67 and whistles 0.63 -> 0.75 (noise), plain kicks unchanged;
  **the share of passes the AI's own team touches first stays 6-10%**: 30 of 47 surviving passes are first touched by the opposing ATT (a DEF pass crosses it), 13 by the opposing MID. It is the defence's reaction: with the cone on the same figure is 32% against rookie (n 25), 17% pro, 6-10% legend, so a pass across a row lands mostly when
  that row is slow. Ship it off: it trims pretend passes without landing more.
  **Pass steer, built (`CONFIG.ai.catch.steer`, ON; `steerHeading` / `steerSlide` / `steerV` / `steerReach` in ai.js, `pinPlay`'s pass branch, the `catHold` cutoff in the `catSw` block; `steer-harness`).** A pass from a PIN commits a slide toward its mate and holds it through the swing:
  the soft pass swing turns the slide into heading (`kaPinSweep`: 0 -> 0, 10 -> 10.2, 20 -> 20.3, 30 -> 29.4, 43 -> 39.6 deg, the same from a standing rod, a carried ball or a released one, any dz under the leg, either way), so the pass leaves on the line to him. Rules that came out of the sweeps:
  the rod needs `hold` (0.22 s) x slide of room toward him (the slide runs ~0.2 s past the release; with less the rod stops at its end and the pass goes straight: 30 u/s needs 6, 43 needs 9-12), `vMax` 43 (50-70 u/s is erratic), and the slide is held `hold` seconds from the swing, then the rod brakes.
  `passEval(...,pin)` offers only mates within `steerReach` on that side, so a rod near its end only passes the other way. A pass from a pin does NOT wait for the slide to die. Only pin passes (48%): free passes (the kick's `onKick` redirect, the dribble's) are untouched, and on a free ball the fire point matters, so they need a run-up first.
  Measured (24-36 matches a seed set, same seeds on and off): pin-pass miss against the lane 19.4 -> 1.5 deg (legend), 17.6 -> 0.8 (rookie), 18.8 -> 1.1 (pro); delivered across wanted 4 / 18 / 23 / 36 deg: 4.7 / 18.7 / 24.1 / 38.3 (+-2-3); the intended receiver touches it first 9% -> 14% (legend), 20% -> 29% (rookie), 9% -> 29% (pro);
  passes per match 11 -> 10 (the ones past ~40 deg are no longer offered); goals, whistles and `bsSoak` goalward knocks (48 matches: 32 -> 29, own goals 0) unchanged within noise. Tried and dropped: reading the opposing rows at the pass's speed (`laneObs` with v0 50) lands fewer (14% -> 8%).
  Legend still lands only 14%: the opposing row slides across the lane while the ball travels.
  **Free-pass run-up, built (`CONFIG.ai.catch.steer.free`, ON; `freeBall` / `runV` / `freeReach` / `runPlan` / `runStart` / `runMate` / `runStep` / `runEnd` in ai.js, hooked in the kick block, `r.act==='run'` dispatched beside the `catSw` hold; `steer-harness` 84 assertions, 56 mutations).**
  A free pass off a slow ball runs at it: the man backs off to the far side of the ball, slides at the speed that leaves on the line to the mate, and the pass swing fires when the man is PREDICTED to be on the ball's z by the time the boot arrives, then the slide is held like a pin pass.
  `kaRun` (real rod dynamics) is what fixed the timing: the soft swing reaches the ball ~0.14 s after it starts (`lead`), so fired with the man AT the ball it has run 3-7 units on and misses (no contact at rel 3.4-4.5), and the earlier "same heading at any fire point" sweep was the man's side dragging a ball close
  to the rod (rel 2.2). Fire when `z_man + slideV x 0.14 >= z_ball`: 26/27 runs (rel 2.2-4.5 x 20/30/43 u/s x p0 -0.5..0.5) land within 3 deg of the table, the miss being rel 2.2. Run length `R = v x lead + v^2/(2 x accel) + back`; the rod needs R before the ball and `v x (hold - lead) + v^2/(2 x accel)` after it
  (30 u/s: ~10 units end to end, 43: ~14), so only the DEF (travel +-18) runs in practice and the MID (+-6.2) cannot. Eligible: ball 3-5 ahead (95% of free passes are 3+), under 8 u/s (68% of them); a pass within `standing` 0.12 rad of straight is just kicked; with no run possible it is a plain kick, not a pass it cannot deliver.
  Measured (legend, 36 matches a set): started 1.9 per match, fired 1.1; ends: the mate slid off the heading 0.58, ball gone 0.11, no room 0.06. Re-picking at the fire cancelled half the runs (`mate` 1.14 per match): the receiving rod slides during the ~0.5 s, so it re-checks the PLANNED mate where he stands now (`thTol` 0.12 rad, lane clear), else the best pick within that.
  Run passes (41 in 36 matches, all DEF): heading median 1.8 deg from the table, 71-94% within 3; the intended receiver touches first 29% and 20% (two seed sets) against 9-14% for the old free passes; rookie 44% (n 17), pro 12% (n 26, no gain). Free passes per match 5.6 -> 3.9 (unreachable mates not offered). `bsSoak` (24 x 180 s): goals 15 -> 12, own 0, knocks 19 -> 16.
  Not done: the MID (a run needs travel it does not have: a neighbouring man cannot help, the span is per man), dribble-release passes, balls that are moving, near or far.
  **Interceptions and the resting pose** (measured 2026-10-05, legend, 30 matches, `kaSoak` + `kaPose`; experiments in the tool only, nothing shipped). After a kick or pass the first rod to touch it is the other team's 90% of the time; 86% of those touches are by a rod doing NOTHING (upright, no action): 1% of those balls end pinned and 75% are kicked straight back (median 0.13 s). When the rod is running the catch (`catch/front`, 14%) 82% are pinned.
  The ball a man stops upright rests 3.4-3.8 in front of the rod, loose. `kaPose`: a back-pin pose (-0.75 with pinOn / pinPose) pins every ball on the man's centre line from 30 to 110 u/s and leaves it at rel -0.72 (shot-ready); 1.5 or more off the centre line it is not caught (the foot box deflects it past `capV`). In matches 56% of interceptions land more than 1 off a man's centre (pinned 7% at 1-2, 3% at 2-3.25; 32% under 0.5), and 66% of intercepted balls are under 30 u/s.
  So a standing pose alone (`rest`, every non-keeper rod with no action while the ball is upfield) lifts pinned 12% -> 15% and changes the game (plain kicks 98 -> 115, passes 7 -> 10 per match, goals 0.47 -> 0.73); the man has to be ON the ball's line, which is the catch's job and it is gated (iq roll, 50 u/s `front.maxClose`, a man able to reach the z): relaxing `maxClose` to 120 lifts pinned 13% -> 20% and takes goals to 0.17 (the AI then stops shots). The RECEIVER of a pass is already on the line (the pass is aimed at his z): a forward pose of 0.4 pins the ball every time
  it reaches him (`kaPose` from behind: any tilt 0 to 0.6 pins at 30-55 u/s, the ball ending under the leg at rel -2.9 / -1.8 / -0.8 / +0.3 for 0 / 0.2 / 0.4 / 0.6, so 0.4 is the shot-ready rel -0.8 the front pin gives, where the AI's behind-catch leaves it at the heel, -2.9 to -3.5, for retrieve to lift and pin; 0.8 or more is out of the window; in matches 68% -> 100% pinned, n 21). Only 9-10% of passes reach the receiver at legend, so the effect today is small; it compounds with the run-up as landing improves.
  **Receiver pose, built (`CONFIG.ai.catch.recv`, ON; `recvArm` / `recvBall` / `recvStart` / `recvStep` / `recvEnd` and `reseat` in ai.js, armed by a one-line hook in `kickRod` for every pass, `r.act==='recv'` beside the run-up's dispatch; `recv-harness` 37 assertions / 35 mutations, 6 more in `catch-harness`).** A pass arms the rod it is aimed at (`rvUntil` = the flight at 45 u/s + `pad` + `grace`); the rod holds a forward pin pose (`angle` 0.4, the ball ends under the leg at rel -0.8) with the man on the ball's line (`catchMan`, waiting where the pass was aimed until it is struck),
  and a pinned ball goes to the catch's hold. It ends when pinned, `taken` (the last touch is the other team's, read only after `grace`: the swing meets the ball ~0.15-0.3 s after `kickRod`, and a pinned ball's last touch may still be the other team's), through (no ball coming from behind), `time`, `reach`, or a ball over `maxY` 3.5 (a pass hops off the boot to y 2.2: the AI's `lowY` 2.05 ended every run 0.15 s in, 0.03 pins per match, until it had its own limit).
  **A ball under a forward leg cannot be played with a swing**: it is behind the foot, so the pass swing's wind-up sweeps the boot back through it (the first soak: goalward knocks 15 -> 30-44 per 24 matches, 17 of them `back|catch/hold`, one own goal) and the pin shot swings away from it. Carry and tap are fine from there; a shot or pass from it is `reseat`: the pin is let go and retrieve re-pins it from behind (`fwdMin` 0.15; catch hold -> retrieve `side`, with `catUntil` so its iq gate cannot drop it). The drop from a forward pose to rest is also a back-lift now (`backLimit(r,0,dropLerp)` in the final `else` of `updateRods`; nothing else produces a forward angle outside a kick).
  Measured (24-30 matches a set): pinned when the pass reaches the receiver 52% -> 68% pooled at legend (two sets, ~30 passes each), 41% -> 65% pro, 58% -> 60% rookie; the AI kicks it straight back less (legend 71% -> 46%, rookie 48% -> 31%). Started once per pass (~7 per match), pinned 0.5-0.7 per match, re-seated 1.1-1.3 per match (every pinned ball: a carry or tap is rare). `bsSoak` 4 sets x 24 x 180 s: knocks 0.77 per match with it against 0.63 without (not significant), own goals 1 in 96 against 0 in 72 + earlier.
  **Carry and tap before a re-seat, and the rods standing ready (`CONFIG.ai.catch.recv.ready`, ON; `pinCarryEval`, `recvReady`, `recvPossess`, `recvReadyNow`, `recvRelease` in ai.js; `recv-harness` 87 assertions / 78 mutations, `catch-harness` 84 / 64, `steer-harness` 91 / 61).**
  From a forward pin (leg over `fwdMin`) a pass is not made while a carry to a better z or a tap is on offer (`pinPlay`: carry > tap > swing play, and a swing play re-seats; shot-open and `late` still go straight to it). `pinCarryEval` is the carry's look at the lanes pulled out of `pinPlay` so both ask it.
  **Readiness before the pass.** Measured baseline (legend, 30 matches): while a DEF holds a pinned ball the MID is raised 99% of the time and the ATT 100%, forward never. A rod is READY (`r.rvReady`, the same `recv` action with no ball in flight: the forward pose up, the man on the lane, held `hold` 0.5 s after it was last asked) when (a) a holder looking at passing has a lane to it (`pk.cands`: the best man of every rod,
  `passEval`; stamped `rvLaneT` so (b) does not override it) or (b) POSSESSION: the team touched the ball last, it is behind the rod by `minAhead`..`reach` 75, slower than `maxBall` 25 and low (`recvPossess`, every AI rod each frame). A holder only armed by its own pin-play missed the cases that matter: the DEF's ball is usually caught by the behind-catch and handed to retrieve, which holds it for over a second without ever running `pinPlay`.
  A pin pass WAITS for its receiver (`recvReadyNow`: the action running, the pose within `tol` of its angle, the man within `zTol` of the lane; at most `wait` 0.45 s; a rod a human holds, one busy with another action or the keeper is not waited for), HOLDING STILL: falling through to the carry started a slide that the next frame read as a push lane and the holder shot instead (passes 3.2 -> 0.1 per match).
  **Letting go.** Any kick that is not a pass releases the mates ahead (`recvRelease` from `kickRod`, `release` 0.6 s without being readied again): a clearance or a shot has to go through them, and with them lowered the first soak had goalward knocks 23 -> 40 per 24 matches (a ball at 10-20 u/s stopped by a lowered man scores as one). The dead-ball push (`r.force`) ends the action, or a posed rod sits on a ball that needs playing.
  A rod that cannot get a man onto the lane (`reach`, from a 0.45 s budget: 340 endings per match, each 8 ms, then re-armed the next frame) now gets `reachT` 1.5 s for a ready rod (it is not in a hurry) and waits `cd` 0.5 s after a failure.
  **Own rods standing ready are obstacles** (`laneObs` counts a rod of the passer's own team in the `recv` action, its men are down in the lane; the target's own rod is excluded: `(r2.x-tx)*dir>=0`, or every pass to a ready rod was blocked by its own men, passes 7.5 -> 1.3 per match). It also closes a DEF's shot through them.
  Measured (with the stopped-dead bug below; legend, 30 matches, fresh seeds, off -> on): MID / ATT forward in DEF holds 0% -> 71% / 70%; passes 7.5 -> 8.4 per match; landed on the AI's own team 9% -> 17% (19 -> 41 passes touched); pinned when received 71% (41 passes); receiver pins 0.60 -> 0.93 per match; carry from the forward pin 0.1 -> 0.33 per match, tap ~0. Goals and whistles within noise
  (goals 0.40 -> 0.50, dead balls 0.63 -> 0.77 per match here; `bsSoak` redrops 59 -> 49 over two sets, knocks 36 -> 37, own goals 0, 0). Pro (20 matches): landed 24% -> 17%, pinned 87% -> 57%, n 23 / 14: no gain there; rookie flat (0.50 -> 0.47). Switches: `ready.on`, `ready.possession`.
  Not done: the defender's side (a standing pose pins only what lands within ~1 of a man's centre line: the man has to be on the ball's line too, which is the catch's job and it is gated); a tap is rare from the forward pin (the tap needs `pcOut < lineClear`, which a closed lane with a carry on offer does not give); every pinned ball is still re-seated to be played with a swing.
  **A pass stopped dead (2026-10-05, `recv.rest`, `recvRest` in ai.js; `tools/recv-soak.js` `rvScene`; `recv-harness` 108 assertions / 99 mutations; `catch-harness` 90 / 71).** A pass at 40-65 u/s meets the posed leg and the dead front touch (`kick.rest` 0.01) stops it in ONE step, but `pinUpdate` only runs at the start of the NEXT physics step, after `aiUpdate`: `recvStep` found no ball coming from behind (`recvBall` needs vf > 1), ended `through`, dropped the pose, and the pin never took the ball (it then bounced back at 4 u/s or was lifted over / kicked).
  Every pass that arrived fast and square did it, which is why pinned-when-received read 50-78% and why the ready arm looked WORSE than the cold one in a 72-match A/B (pro 51% vs 73%, rookie 64% vs 78%): the numbers about the standing posture below were taken with this bug. `rvScene` (a red DEF passes to the red MID, nothing in the way, 250 trials): pinned 34% -> 93% (headings under 10 deg 24/41 -> 41/41, over 45 deg 10/47 -> 47/47).
  Now a slow ball lying in the pin's window (inside `shots.pin.back..front`, low, within `capV` of the rod's own slide speed) keeps the pose for `rest` 0.12 s from the first step it is seen (`r.rvRestT`, reset by `recvArm` / `recvEnd`); `rest:0` is the old ending exactly.
  Measured after (24 x 120 s per cell, 2 seed sets, ready on / off): pinned when received 85 / 77% legend, 85 / 86% pro, 96 / 94% rookie; pinned per match 0.94 / 0.69, 1.10 / 0.92, 1.63 / 1.29 (the standing posture now delivers its pins at every difficulty); landing on the AI's own team 16 / 14%, 25 / 23%, 47 / 47% (unchanged: the opposing row is the limit); goals and dead balls within noise.
  Over the earlier 72-match sets with the bug (3 sets, ready on / off): landing 12 / 11% legend, 28 / 27% pro, 41 / 45% rookie; goals 0.58 / 0.57, 0.45 / 0.40, 0.47 / 0.42 per match; dead balls 0.58 / 0.70, 0.67 / 0.67, 0.44 / 0.56. So the posture changes nothing about goals, whistles or landing at any difficulty: it is the pins that moved, and it is a look the owner asked for. `dfSoak` 84 matches a side, legend: 97 redrops on / 99 off (the +25% in the old hand-off did not reproduce).
  `bsSoak` (6 sets x 24 x 180 s, legend, `rest` 0.12 / 0): redrops 169 / 186, goals 115 / 107, goalward knocks 156 / 128, own goals 4 / 2. The extra knocks are spread over `still|-`, `safeRaise` and `catch/side` (a ball a posed leg stops and bounces back at 4 u/s, or a lowered man stopping one); not chased.
  **Standing whenever the team has the ball (`recv.ready.feet`, ON; `recvOwn` in ai.js; `tools/posture-soak.js` `rdCover`).** The pose is not tied to a pin: a rod ahead of the ball stands in it when a holder looks at passing, or when the team touched the ball last, it is slow (`maxBall` 25) and 10-75 behind the rod (`recvPossess`).
  `rdCover` (legend, 16 x 120 s, rods ahead of the ball, share standing forward): holder has it pinned 87%, team touched last and slow 81%, quicker than `maxBall` 19% (a shot, clearance or pass in flight: up by design), the ball lying in reach of one of the team's rods that the OTHER team touched last 1%. That last case (about 4% of the time) is now covered: `feet` readies the rods ahead for a ball slower than `maxBall` between `ownBack` -5 and `ownFront` 6.3 of any rod of the team whoever touched it last (1% -> 66%, pinned 87% -> 94%).
  The 19% of slow balls still up are the 0.6 s `release` after a kick and the 0.5 s `cd` after a failed reach. Cost: dead balls about +24% pooled over five A/Bs on fresh seeds (514 vs 415 whistles over 456 matches a side; the last independent batch +10%), goals, landing and pins unchanged; the extra whistles are balls at a DEF's heel out wide, nearly all touched last by the AI's own team. Not the own ready men read as lane obstacles (`laneObs` ignoring them: no change), not the keeper or the DEF as the holder (`recvOwn` skipping either: no change), not both teams standing at once (never at a whistle). Mechanism not found; `feet:false` is the old rule.
  **The keeper's kick, and a ready DEF lifted across it (2026-10-09; `dribble.pass.gk`, `recv.liftT`, `recv.ready.arrive`; `gkHold` / `recvRelease` / `recvStep` and `passEval`'s keeper branch in ai.js; `recv-harness`, `steer-harness`, `tools/gkkick-soak.js` run with `tools/page-run.js`).**
  58% of the keeper's kicks (162 of 279, pro, 120 matches) met a DEF standing ready, and about 1 in 10 of all of them bounced back or stalled at it. Three causes. (1) `kickRod` lets the ready mates go at the swing's start (`recvRelease`): the lift needs ~0.12 s, the ball is there in 0.1-0.2 s, and the back guard holds a lift short of a ball coming at the rod, so the boot parks at about -0.3 in the lane.
  (2) The keeper's own lift (`safeRaise` / `evade`) knocks a pocket ball forward at 45-77 u/s; the follow-up swing then released the DEF that was already receiving it. (3) `recvStep` ended a ready rod when its hold ran out (`idle`; only a rod with no action is renewed) or when a hopping pass went over `recv.maxY` (`through`) with the ball a few units off, and the rod dropped into the raise latch across it.
  Fixes: the keeper passes to the man nearest straight ahead whenever one is within `gk.maxTh`, with no iq roll and no covered-shot test (a ball over `gk.maxBall` is a save, kicked plain; the keeper does not run at the ball); with no pass a ready mate is given `gk.readyT` to get a man onto the lane (the pass is looked for again every step), then released, and the kick waits at most `gk.clearT` for a leg over `gk.clearA` (-1.1: a leg across the ball blocks at -1.0) or the men out of `gk.laneZ`;
  a keeper's kick does not release a mate with a ball already running at it; a ready rod with a ball running at it stays ready (`ready.arrive`); a ball nearer than a lift takes (`recv.liftT`) is never 'through'. `gk.on:false` is the keeper's old rule (the other two are not switched).
  Measured (`gkKick`, 120 pro matches, same seeds, original -> now): the DEF ends up holding the keeper's ball 46 -> 73, bounced back or stalled 17 -> 6, past the DEF to the other team 185 -> 113, passes 26 -> 43; legend (80) bad 13 -> 4, rookie (80) 8 -> 6. `bsSoak` (60 x 180 s) goals 42 -> 56 pro / 36 -> 38 legend, own goals 0 / 0, goalward knocks 38 -> 28 / 51 -> 45, redrops 51 -> 41 / 55 -> 30, ball-idle seconds +10%.
  `kaSoak` (72 x 120 s) dead balls 0.53 -> 0.39 / 0.72 -> 0.49 / 0.53 -> 0.40 per match, plain kicks 45 -> 38 / 39 -> 32 / 37 -> 31, pin shots 8.7 -> 11.7 / 11.6 -> 13.1 / 7 -> 8.9, goals 0.69 -> 0.51 pro and 0.68 -> 0.58 rookie (legend 0.49 -> 0.49): the team keeps the ball more. `hsSoak` no violations.
  **Open: pass speed.** With `passShot.strike` / `powTo` at 0.15 a keeper pass leaves at 77-97 u/s (0.20 gives about 50) and the MID pins only 17% of a DEF's passes (`rvScene`, 100 trials; 100% at 0.20, whatever `restPower` is; the keeper's passes to the DEF do better, 29 of 43 pinned): the ball is stopped dead by the leg and squirts off it sideways (of the 43 keeper passes in 120 pro matches, 29 were pinned, 8 went through, 3 bounced or slowed). That setting was the working tree's, not changed here.
  **A forward pin is not let go at speed (`recv.fwdBrake`, ON; `pinPlay`).** A swing play from under a forward leg lets the ball go and retrieve re-pins it (`reseat`, `tools/reseat-soak.js` `rsSoak`: 1.25 per match at legend, about half of them decided while the rod slid at `push` speed). A ball released at a carry's speed rolls away at `carryOut` of it and retrieve chases it, so a swing play is not made from a forward pin while it slides faster than `fireV`: the carry arrives and stops first (`CAS.fwdBrake`), then the play is judged standing. A late play (`holdT`, the whistle) is not held.
  Measured (`rsSoak` 72 x 120 s a cell, brake / no brake): re-seats per match 0.59 / 1.14 legend, 0.85 / 1.22 pro, 1.31 / 1.50 rookie; lost to the other team 1 / 7, 4 / 15, 26 / 30; the swing after a re-seat comes at a median 0.3 / 0.9 s legend, 0.27 / 0.68 pro. `bsSoak` (3 x 24 x 180 s legend): goalward knocks 64 / 84, own goals 0 / 1, redrops 114 / 112, goals 61 / 56; `kaSoak` goals, whistles and pins per match within noise at every difficulty.
  **Leaving a forward pin: the forward lift (`recv.lift`, ON; `fliftStart` / `fliftStep` / `tapSide` / `reseatGo` in ai.js; `tools/fwdpin-soak.js` `fpScene` / `fpTapGrid` / `fpShotGrid` / `fpTry`; 2026-10-06).** A ball under a forward leg is flush against it (about 2.9 from the leg) and behind the boot, so it can only leave sideways (a tap, which lands as a shot-ready back pin on the neighbour) or be let go and re-pinned from behind. Letting go in place and sliding was the bug: the dead front touch killed the ball's z speed (27 -> 3 u/s) and knocked it backward, so a forced tap landed 0 of 14, and retrieve's first move (slide away at 40 u/s, leg still flush) dragged the ball off at 14-19 u/s: 5 of 8 traced re-seats fell to a dribble or a plain swing.
  The leg now turns UP and FORWARD (`lift.angle` 1.3) and the pin lets go by itself once it has turned `releaseA`: the ball keeps rel and vx 0 and rolls at `carryOut` of the slide (tap, the rod keeps running) or stays at rest (re-seat, braked first, `restV`). `r.catPh 'flift'`, `flNext` 'tap' (`tapSide` then hands it to the receiving man's side catch) or 'retrieve' (`reseatGo`; `r.retFl` holds the leg up through retrieve's 'side' phase, so crossing a ball is free, and `retKnow` has retrieve read the real ball for `lift.know` 0.5 s: its delayed view still showed the ball carried, and 18 of 25 early endings were that speed bail).
  **Tap from a forward pin** (`recv.tap`): a neighbour with an open lane is tapped to when the carry finds nothing; with `tap.first` it goes before the carry (off: the forward pin is for carrying), and a shot only with `tap.open` (off: an open lane where the ball is stays a shot, a re-seat). A tap from a forward pin has its own depth band (`catch.tap.fwd`: the ball rests nearer the pivot).
  Measured, legend, lift on / off: forced taps from a forward pin 42/42 land (6 by a tap back) / 1/42; an open goal from a forward pin 10/10 pin shots at 1.1 s / 8/10 at 0.85 s; `rsSoak` 24 x 120 s re-seat swings 15 pin shot + 7 pass + 0 plain, 2 lost / 24 + 8 + 13 plain, 3 lost; `catchSoak` 24 x 120 s taps 2.5 / 2.2 per match, landed 2.2 / 1.5, forward taps chosen 1.0 / 0.04; `bsSoak` 3 x 24 x 180 s goalward knocks 81 / 75, own goals 0 / 0, redrops 92 / 83, goals 74 / 70; `kaSoak` 3 x 24 x 120 s goals 0.72 / 0.72, whistles 0.75 / 0.69, passes 8.7 / 8.7, pinned when received 70 / 76% (n 227 / 205), landing 0.36 / 0.33. Whole-match numbers do not move (about 2 forward pins per match); what changed is what a forward pin can do. (Those numbers had the tap first; the default is carry first now, below.)
  **Holding it, and taking balls forward (`recv.settleT` / `recv.carry` / `catch.turnT` / `recv.take`; `takeFwd` / `catchUp` / `thruStep` / `sideAngle(rel,fwd)` in ai.js; 2026-10-06, owner: the forward pin is for control, not for passing or shooting until snake shots exist).**
  **Hold:** a ball under a forward leg is carried for `recv.settleT` 0.6 s before anything is played or tapped (the carry starts at `catch.settleT` as ever), at `recv.carry` 0.6 of the pin's carry speed (`updateRods`, catPh 'hold' only: a tap's run and a re-seat keep full speed), and the carry turns round only after `catch.turnT` 0.8 s on a heading (all pins: it ran the whole width and back every 0.5 s, `CAS.flip` 26 -> 17.5 per match, turn-rounds per hold 3.5-4.5 -> 1.5-2.5). `holdT` 3 s still ends it (a lift and re-seat, or a play).
  **Entries (`takeFwd(r,bx,bz)`: not when a shot is open where the ball arrives; else `take.share` 0.6 on the rod's seeded stream; ATT / MID / DEF):** a ball rolling along the row (the side catch and the meet raise the leg forward and up, `catchUp`, and drop it at `sideAngle(rel,true)`, the angle that holds the leg `legD` from the ball on the forward side); a ball running at the rod from upfield, let through (phase 'thru': 5-16 u/s, under 8 sideways, 8-14 ahead, the leg up and forward so it rolls under the rod, `take.thru.dropT` 0.14 s before it is at -0.8 the leg comes down onto it); a ball coming up from the rod behind that is not a pass (phase 'behind' with `r.catFwd`: the receiving pose at 0.4, held, instead of the heel stop and retrieve's re-pin).
  Measured, legend, 10-12 matches a cell (`fpWatch`): balls held under a forward leg 1.9 -> 6.4 per match (pro / rookie 4.6 / 4.8, from 1.4-2.5), a third of them from behind and nearly all carried 2+ units (median 10), the rest passes; the through-catch pins every ball of 8-16 u/s in a clean scene (27/27, rest at -0.7..-0.8, and rolls through at 20: the pin holds a ball only under `capV` 14 against the rod) but only 0.1-0.2 per match in AI-vs-AI, where a slow, uncontested, mostly straight ball at 8-14 ahead is rare (the rod in front kicks or stops the rest); side and meet 0.4 per match. 72 matches a side take on / off (`bsSoak` + `kaSoak`): goals 69 / 74 and 0.63 / 0.68, own goals 0 / 0, goalward knocks 64 / 72, redrops 64 / 73, whistles 0.56 / 0.64, passes 9.3 / 7.8, plain kicks 69 / 77, pin shots 13.5 / 16.1 per match (the AI holds before it plays), human seats untouched (`hsSoak` 12 matches, 0 violations).
  Tried and not built: a TOE pin. With `shots.pin.front` widened a forward leg holds a ball AHEAD of the boot (rel 4.5-7), and a swing from it needs no re-seat (trapShot 74 u/s, pass 65), but it has no clean exit without a swing, and a swing is what the owner does not want from a forward pin yet. Pitfalls: the through-catch must pick on the REAL ball (the delayed view picked balls running away, or about to be kicked at it); `thruStep` and the side catch read the real ball for the same reason; a ball stopped dead against the leg is waited on for the pin (`recv.rest`) in the 'behind' phase too, or the catch ends 'slow' and drops the pose.
  Pitfalls: `tapSide` must not drop the pose in the release frame (the rod eases toward rest, the boot swings forward through the ball: tap failures 0.3 -> 2 per match, found only in `catchSoak`; `catch-harness` pins it). Everything else about a tap's side phase is unchanged. Not done: the other team's rods standing in a back pin to take an intercepted ball (`docs/AI-PASSING-NEXT.md` item 4); the lift has not been seen by a human, only measured (the leg flicks forward-up in ~0.1 s, then back over through vertical once the ball is clear).
  **A human on the team** (`tools/humanseat-soak.js` `hsSoak`: a red human seat that tracks the ball, kicks and passes, auto-switch on; 30 matches): a held rod never has an AI action, never stands ready, never keeps an AI pose; `clearRodAI` (seats.js) did not clear `rvUntil` / `rvReady`, so a rod the player took while it stood ready kept the flag for the rest of the match (harmless, tidied; recv-harness pins it). A human's pass arms the mate AI rod the same as an AI's (36 of 37 poses).
- **Dead-ball push** (`CONFIG.ai.force`; `deadLeft(b)` in powerups.js is the real-seconds projection to the whistle,
  the same one the `C` overlay shows). When a ball is in a rod's own strike window (`deadball.live` ahead/back), not in
  a dead zone, and `deadLeft` is under `force.left`, `r.force` is set and that rod stops deliberating: it squares up on
  the ball (no aim bend or drifting error), a swing counts as lined up out to `force.align` (a ball resting against the
  boot is just past its reach), and cooldown, shot hold and sweet-spot wait are skipped, so it kicks or passes. It also
  skips starting a retrieve, keeps the post-kick held-forward escape going until the boot is off the ball (otherwise the
  rod sits frozen forward on it), and a non-keeper may slide through a ball beside its heel (`slideBlocked`). Gated per
  rod: a ball-wide flag made every rod abandon its line whenever a ball sat in a pocket. Measured with the soaks:
  whistles on a playable ball 39 -> 12 over 40 matches, keeper stalls gone, and over 120 matches goalward knocks
  (109 -> 100) and own goals (1 -> 2) were unchanged within noise.
  What is left: outfield balls behind the heel after a kick. `deadforce-harness` pins `deadLeft`.
- **Keeper safe-raise** (`CONFIG.ai.safeRaise` `gkAlways` / `gkLerp`; `srLerp` in ai.js, read by `updateRods`). A ball rolling across the
  keeper's front or heel meets the SIDE of a lowered boot and stops flush against it (z gap ≈ 3.25), out of the kick window; to roll
  under, the boot must be over the ball's top (about −1.1) before it arrives. The entry used to need `r.aiIQ` (a re-rolled 40-80 % coin
  flip) and the lift eased at 4/s, so most of those never got a lift in time. The keeper now skips the roll and lifts at `gkLerp`; the
  other rods keep both. Measured 2026-10-03, `tools/keeper-soak.js` (300 seeded trials per family, `gkCheck()` asserts the lot): sideways
  roll goals 21 → 0, dead balls 70 → 8; the same roll drifting goalward (rolls past the man into the mouth) goals 93 → 6, dead 45 → 6;
  40 whole matches (`bsSoak`) goals 57 → 38, own goals 4 → 0, goalward knocks 35 → 17 (keeper 8 → 0). The depth that BLOCKS a ball in the
  pocket is −1.0 (the leg across it); −1.3 is over it. A ball that starts inside the pocket ~0.2 s from the line can't be saved by
  reacting (a lift that waits for the AI's view concedes more than none); that needs a lift before it slips past the man. Not built.
- **Goal cover** (`CONFIG.ai.cover`; `coverZ` / `coverFit` / `coverReach` in ai.js, ahead of `aiUpdate`; `cover-harness`). The old GK + DEF line-block put both on the
  ball-to-goal-centre line, so one body hid the other and ~11 u of the 19.8 u mouth stayed open. Now a man's SHADOW (the stretch of goal line
  his body hides from the shot point, ball radius included, `gapAim.blockR`) is fitted: both rods are placed to leave the smallest, evenest
  gaps (a grid + polish search, sum of squared gaps, `travel` cost so a pair keeps its side). Modes: **pair** (ball ahead of both: fitted
  together; a human, busy, benched, forced or hidden mate is HELD where it stands, or no mate at all); **keeper covers** while the DEF plays the ball
  (an assumed shot from `nomAhead` in front of the DEF), but only within `playReach` of the old line, unless the ball is **wide** (more than `gkWide`
  beyond the keeper's slide): then it is out of the keeper's reach, so the keeper holds the goal (full reach, no half-chase: `r.cvW` skips `dumbBias`)
  and the DEF takes the ball. **The DEF never covers once the ball is within its play zone or behind it** (2026-10-04): it used to fit itself around the
  keeper chasing a wall rebound, slid in off the ball and was never there when the ball came back out. `cvRebound` (cover-soak): wide wall rebounds, DEF
  in position 0% → 100%, keeper mean |z| 9.6 → 3.1, goals over 60 matches unchanged (81 vs 82).
  A ball flying at the goal (`shotV`) is a real shot wherever it is, and keeps the reach budget even when wide. Learned the hard way (2026-10-03, `cvSoak` / `cvGallery`):
  - **Open width does not predict goals.** The AI sees the ball ~0.3 s late, so what concedes is the rod's convergence onto the ball's z as it
    arrives (`iz → bz` as the ball nears). A rod parked in a slot cannot swing back, so `coverReach` budgets how far off the old line a rod may
    stand from the slide it can still make (ball speed with a floor, distance, the difficulty's slide speed, `slack`); a fast ball close in
    pulls it back onto the line. The first cut without it conceded 2.2-2.6 goals/match against 0.8.
  - **The AI's own strikes aim near the goal centre**, where the old stacked pair is solid; a lane-picking human aims at the gaps. So the pair is
    a trade, and `dumbBias` (how far a low-IQ rod commits, 0.7 shipped) and `mix` (0 = old line, 1 = full split) are the dials.
  - A centre-weighted cost and a narrower assumed man width were tried and did nothing; a coarse grid alone flips a pair that is already well
    placed (hence the polish from the current slots); a slot target of the DEF forces `r.aiMan` so man selection lands on the fitted offset.
  Measured (shipped): fast shots (95-140 u/s) aimed at the widest open lane, goals per 150: **46 → 9**; mid-speed 16 → 13; shots at random
  points across the mouth 5 → 8 per 200; open width in matches 11.2 → 8.8 in front, 13.5 → 11.0 with the ball behind the DEF; AI-vs-AI goals
  per 2-min match ~0.82 → ~1.05 over 90 matches (the AI's strikes get through a thinner middle). `cover.on:false` restores the old line-block.

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
**Moon Base** is a 3.5 m hab dome in a small crater (1 unit = 1 cm): `tools/build_moon_base.py` + `build_moon_sky.py`.
Its sun is the real `dir` light WITH shadows, and `dir.pos` must point along the sky script's `SUN_DIR`
(sky-harness checks). Every stock menu shot looks 35°+ down, so a sky above the horizon is never on screen; a room
can override single shots (`rooms.<id>.shots`, fx.js `menuShot`) and the Moon's home shot sits low for Earth.
**Saucer bar** is the rim deck of a saucer hanging over a ringed gas giant (1 unit = 1 cm, 4.2 m across): `tools/build_saucer_room.py` (textures, props and the
neon sign are all generated; windows and portholes are real openings cut with a boolean) → `ktx2-encode.mjs` from `tools/build/saucer/`, sky `build_saucer_sky.py` (Cycles: ring shadow on the
planet is real) → `sky-encode.mjs --size 1536`. The wall is only seen up to about y=+30 from the stock cameras, so detail lives low; the giant sits just under the horizon at azimuth −73° and
shows through the low-sill bay panes (saucer-harness keeps the two scripts agreeing). `bakeGlbEnv` hides ANY transparent mesh: glass with a textured alpha has opacity 1 and used to bake as a white blob.
Props are baked into the GLB on purpose, not placed through `props.js`: a baked room is one draw per material and `castShadow=false`, an instanced prop is a draw per part, casts by default (`shadowDirty` fires every sim step, so
2 shadow spots + the shadow point = 8 passes) and can't vary per piece (every stool is its own colour and angle). The look of a flat-colour prop comes from `flat_mat`: colour x ONE shared 512 wear map (box-projected UVs, `prop_attrs`) x baked
vertex colour (floor contact, undersides, drips). Soft glows (neon halo, sconces, lamps) and floor paint (hazard stripes, stencil, stains, polished path) are two blended decal sheets, `glow` and `paint`, built by `glow_texture` / `paint_texture`;
with the glass that makes exactly three blended materials. Every opaque material is single-sided: that is the culling saving, and it also shows a wrongly wound face (`arc_prism` was inside-out for a pass and double-sided hid it; profiles
for `p_lathe` / `arc_sweep` are travelled counter-clockwise, r right and y up). The build prints a triangle table per section (`sec()`), 70k now; the ceiling and upper wall are seen by nobody but photo mode, keep them cheap. Iterate by
loading `tools/build/saucer/fuzeball_room_saucer.raw.glb` over `CONFIG.rooms.saucer.folder/glb` (--tex 1024 builds in 6 s), then encode at full size.
**Blade grass** (`grass.js`): a pitch opts in with `grass:true`/`grass:{…}` in `CONFIG.pitches` (defaults in
`CONFIG.grass.blade`). One instanced draw of real blades (~106k) rooted on the pitch's top face, coloured from the
pitch texture at the root; visual only (physics stays flat). `cfg.grass` off/low/high is a machine setting (Options →
Display). Shells were tried first and dropped: a flat blade seen side-on splits into its layers. grass-harness.
Room glass (any transparent room material) draws first among transparent things and never receives shadows
(models.js `ensureRoom`). Shared sky machinery: `tools/skylib.py`. `cacheEnvs` must be ≥ rooms × 2 (roomenv-harness).

**Audio (`audio.js`, `CONFIG.audioMix`).** Every sound is an id in `CONFIG.audioMix.sounds`. `Au.play(id)` plays a recorded
take from `assets/audio/` (named `<id>_01.ogg`…, indexed by `tools/build_audio_manifest.js` into `manifest.json`) and
returns false when there is none, so every caller falls through to its synthesized version: an empty folder is a
complete game. Variants: `<id>_<ballType>`, `<id>_hard`; `ir_<room>` replaces a room's generated impulse. `syn:false` =
recorded-only (silent without a file). Takes round-robin with no repeats; a take and its synth share one `vgate` key.
`route()` pans every table sound by the ball's SCREEN position (`auPanOf`, so pass the ball as the 3rd arg of
`kick`/`wall`/`post`; `wall`'s 4th arg is 0 wall / 1 floor / 2 ball) and sends it into the room: one convolver per bus
(fx, crowd), impulse generated per room by `auIR` from `audioMix.reverb.rooms` (kept out of `CONFIG.rooms` because the
room editor's export drops unknown keys); room changes are polled off `activeRoom`. The crowd bed is up to three
looping tiers (calm/busy/wild) equal-power crossfaded by excitement = base + `Au.exc` + tension (a ball in either
attacking third). With no recorded beds, `auVox` renders a room of formant-synthesized voices (and the reactions,
`AUREACT`; applause is `auClaps`) in idle slices after `Au.init`. `Au.ui(kind)` (move/value/tab/click/back/open/
error/start/rod) shares one gate, so the specific sound fired first wins over a handler's generic click.
`Au.goal(kind)`: goal/win/trophy/medal, and the crowd's answer. The replay's sound log stores position + kind too.

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
**Pointer lock** (`mouseLockWant` / `mouseLockTick`, input.js): wanted through play, count, goal and replay whenever a seat holds the mouse, so a goal or
redrop never lets the cursor back. The tick re-asks every 250 ms (a browser allows it with no gesture after our own release, or while the click that started the
match is fresh); a refusal latches `mlRef` until the next key / click, and `body.mlHide` hides the cursor over the canvas regardless of the lock, so the
cursor is gone from the first frame of the count. Pause, win, menus, trial / tutorial cards, the training panel and click-place want the cursor back.

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
  **A caught ball shows itself.** Kick is the shot only while `r.pinB` is set; with nothing caught, finesse + kick is a pass,
  and the player cannot otherwise tell which they have. So: a ring on the pitch under the ball in the holding seat's colour
  (`fx.js` `pinMarkUpdate`, resident meshes `pinRings` in world.js, `shots.pin.mark`), and in live play a plate "[kick] pin shot"
  sitting on the rod chips (`hud.js` `hudPinHint`, `shots.pin.hint`; keys come from the bindings, the pad shows A; off in the
  tutorial, which says it itself). Both ask `shotPinBall(seat)`. The plate has a player switch, `cfg.pinHint` (Options → Display
  → Effects, PLAYER bucket, a missing key reads as on); the ring has none. `pinhint-harness` pins all of it.
  **Its weight is the speed ceiling, not the swing.** The boot meets the ball ~40 times in one trapShot swing (the ball starts
  3 units off the boot, so it is pushed, not struck), and `shotConsume` spends the shot's trim on the first touch, so every later
  contact fell back to the plain-kick ceiling: measured 2026-10-03, pin shot ~78 u/s vs a plain kick ~87 and a charged kick ~121,
  identical for human and AI. `cap.pin` (`kick.cap`, `capSpeed` keyed on `kickStyle==='trapShot'`) adds to EVERY contact of the swing:
  0.30 gives ~106 (human and AI share it; AI difficulty scales it through its `str` stat). Swing speed, `windupA` and `pin.pow`/`ctl`
  barely move it (`ctl` is invisible: later contacts re-impose the boot's heading, so the first-touch spray is overwritten). Hop
  height stays under ~2 even at 0.4 (~113). Measure with `tools/pinshot-soak.js` (`psSweep` / `psTry`, multi-seed: the contact
  jitter random-walks the speed, so one seed is not a measurement); `ballcap-harness` C3 pins it.
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
  of blocks) to its `SCREENS` entry. Saved in `cfg.layouts` as v:2: x/w are fractions of the canvas width, y/h px (`layStore`/`layPx`); a v1 px save converts on first apply (`layMigrate`). layout-harness. An edit session is undoable (`layPut` keeps each replaced save; Undo / Ctrl+Z / pad Y), Cancel restores the save it opened on, ↺ or pad X resets one panel to the stock flow (`layDefaults`), and a save still flagged `d:1` (stock) is deleted on Save so the screen keeps its CSS. **Presets**: the bar's ◀ preset ▶ lists Default (= reset all), built-ins (`CONFIG.layoutEditor.presets`,
  authored with `layExport(key)` in the console) and the player's own (`cfg.layoutPresets`, PLAYER, synced; Save as
  preset, rename, Delete; `presetsMax` per screen). It shows what the live layout IS (`layCur`), Unsaved once moved.
- **HUD (`hud.js`).** One canvas with `pointer-events:none`. It polls `S`; callers push only events:
  `banner` (tier 1), `notice` (tier 2), `toast` (tier 3), `hudHint(kbm,pad)`, `hudCount`, replay state.
  Hint markup: `[KEY]` keycap, `[LMB]`/`[MOUSE]`, `{A}` pad button, `·` separator, `\n` line break.
  **Keyboard hints are built from the bindings** (`bindHintRods`, `bindCap`).
- **Plates (css/styles.css, FEDERATION PLATES).** Buttons, tabs, menu items and small chips are one shape: two
  clipped pseudo-layers behind the element, in the small Back / Options buttons' shape: a rectangle with the
  top-left and bottom-right corners cut at 45° (the cut drawn is 0.66 × `--pc`, never under 5px). The panel
  caption tabs (`.panel>h3`, `.slotNo`) cut only the bottom-right (they sit flush in a panel's top-left corner, where a cut would show a gap), and the screen wipe's leading corner uses the same cut. **Nothing is slanted
  any more** (the owner finds 20° parallelogram plates generic AI design); the one exception is the HUD
  scoreboard (`hud.js`), kept as it was on purpose. Style a plate ONLY through
  `--pl` (fill), `--pr` (rim), `--pc` (cut) and `--pk` (text); a new plate-shaped control joins the `:is()`
  lists there. Never put `background`/`border`/`clip-path` on the element itself (clip-path would clip the
  pad focus). `.btn` is the gold primary, `.btn.ghost` the blue secondary.
- **Type.** `--font-display` and `--font-ui` are both **FuzeClip** (our own face, `tools/build_font.js`; Soccer League is the fallback for glyphs it lacks),
  `--font-body` (Exo 2 600) for anything read as a sentence. FuzeClip is already leaned 20° and declared normal + italic from one file, so `font-style:italic` adds no slant.
  The HUD canvas reads `--font-ui` / `--font-italic` itself (`hudInit`).
  Sized for 1280×800 (Steam Deck) and a sofa: nothing in a menu under 11px, the `--fs-*` tokens start at
  11.5px. Check a screen at 1280×800 after adding to it (`node tools/menu-shots.js [names]`: headless Chrome, a PNG per
  screen + a contact sheet in tools/build/menu-shots/, exit 1 if anything scrolls); since 2026-09-28 no menu screen
  scrolls there, so keep it that way.
  Scrollbars are styled once, globally (`scrollbar-color`, top of styles.css). A `.lgSide` column's panels need
  `flex:0 0 auto`: the generic `.lgSide>.panel` basis of 380px is a HEIGHT in a column.
- **Style rules.** No emoji in UI copy. SoccerLeague/Russo One ship ONE weight: never ask for bold.
  Gold marks focus, selection and trophies only. A CSS class that isn't in the markup fails silently, so
  check new selectors against what the code emits. A flex/grid parent changes its children's margin
  behaviour (margins stop collapsing).
- **Motion.** A screen change arrives behind one left-to-right wipe with a cut leading corner (`.scrIn`, added by `showScreen`). In the menus
  the camera eases to a per-screen shot (`CONFIG.camera.menuShots`, keyed by screen id, `menuLerp`); no idle
  drift, so the render throttle still settles. The HUD (`hud.js`) writes the same palette as literals.
- **League lobby** is three tabs (Season / Squad / Club, `lgSetTab`); layout keys `league` (Season) and
  `leagueClub`. The win screen is a full-time board (`#winBoard`, filled in `endMatch`).
  Season: Standings + Last Round on the left, Next Match (head-to-head, `lgMatchHTML`) in the middle, the
  **Opponent** panel on the right (`lgScoutFill`, shared with the cup: titled Opponent / Scout / Your club).
  There is no Scout button: clicking a club in the table scouts it, clicking the opponent's side of the
  head-to-head goes back. The **Champions Cup** is tabbed the same way (Cup / Squad / Club, `cupSetTab`; layout keys
  `championsCup` and `cupClub`). The **season-end** screen (`renderLgSeasonEnd`) is one screen: result | your
  division | rewards + per-position stat changes, then "Around the league" for the other two. menu-shots plays six
  scripted seasons (champion, runner-up, relegated, lower-division title, stayed) to check it.
- **Trophy art** loads as `.webp` with alpha (`trophyImg`), made from the black-backed `.jpg` renders by
  `tools/trophy-alpha.mjs` (run from tools/ after `npm i`). Re-run it when a trophy render changes.
- **A kit colour on a MATERIAL goes through `kitLin(hex)`** (world.js): the renderers output sRGB and r128
  reads a hex as linear, so a raw `color.set(hex)` renders lighter and greyer (crimson came out rose pink).
  The HUD and CSS take the hex as-is.
- Kit swatches and a new save's kits come from `CONFIG.playerModel.swatches` / `kitDefault` (club colours).
- **Customize**: preview top-left, the figurine strip under it (`czStripFit`: fewest rows in
  `CONFIG.playerModel.strip` that fit every face, then it scrolls sideways), kit colour + finish on the right.
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
- **AI passing, ball direction and receiving (2026-10-05):** pass steer, the free-pass run-up, the receiver pose and the standing posture are built and measured in AI-vs-AI soaks only, never play-tested by a human. The open list, in order, with how to pick each up: `docs/AI-PASSING-NEXT.md`.
- **Balance/feel still unplayed:** trial medal thresholds; `slidePush`; how far past maxV a charge should go.
- **Perf:** the texture budget (figurines at 2K, pitch uncompressed) and the boot freeze.
- `CONFIG.debug` gates to remove for the player build; Electron wrapper, Steam Cloud, achievements
  (`ACHIEVEMENTS.md`).
