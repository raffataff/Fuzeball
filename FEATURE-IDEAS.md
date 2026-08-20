# Fuzeball — feature & gameplay recommendations

Written after a pass over `js/*` (all 36 modules), `CLAUDE.md`, `TUNING.md` and `index.html`.
Ordered by **impact per unit of risk**, not by size. Every item names the hook it plugs into
so nothing here is a rewrite.

---

## 0. Read on the current build

The **systems** are in far better shape than most hobby games ever get: fixed-timestep sim with
render interpolation, adaptive substepping, an AI with trap / dribble / pass / evade / clear-lane
behaviours and a two-hands rule that makes it play like a coordinated unit, a three-division league
with promotion, relegation, a cup, stat builds and an upgrade economy, a flight-recorder replay with
audio re-fire and webm export, photo mode, layout editor, 4-a-side local co-op, a frame profiler.

The **gap is not systems — it's the loop the player lives in.** Right now a match is:
serve → rally → goal → banner → replay → repeat. Between goals the player has nothing to build,
nothing to aim for beyond the next goal, and no mechanical skill ceiling past *slide, kick, raise*.
And a goal is celebrated with the same four particle bursts and one of **six** hype strings
(`state.js` `HYPE`) whether it was a tap-in or a 40-unit screamer off the post.

So the recommendations cluster into three things:

1. **Make the game react to what just happened** (audio, commentary, near-misses, saves, stats).
2. **Give the player a skill ceiling** (signature shots, passing, keeper play).
3. **Give them a reason to come back** (achievements, trials, career texture).

Plus a visual tier, because two of the biggest "is this hand-made?" tells are sitting right there.

---

## Tier 1 — Reaction & feedback. Cheapest wins, biggest perceived jump.

### 1.1 The game doesn't know when something exciting happened  — **DONE 2026-08-19**

> Built as `js/moments.js` + `CONFIG.moments`. Saves are **GK-only** by decision (a DEF block
> fires nothing — crediting the defence makes the notice constant), and goal-line clearance is
> a **modifier on the save** rather than its own detector: the keeper's foot reaches x≈58.8
> against a line at ±60 and no other rod gets within 15u, so a standalone detector could never
> fire without double-banner-ing the save it already is. SCREAMER became a full classifier
> keyed to the measured speed **at the line** plus spin, strike distance, placement and
> woodwork recall, with the pace on the chip in km/h — i.e. it also delivers the shot-keyed
> slice of 1.3. Crowd audio is a minimal `Au.react` (`ooh`/`groan`) only; **1.2 is still open**.
> Saves/woodwork are banked into `freshStats()` but the win screen is untouched — that's 1.4.


Nothing in the codebase detects a **save**, a **near miss**, or **woodwork**. `hitPost` in
`physics.js` already computes the exact post/crossbar contact and calls `Au.post()` — that is a
free, already-instrumented "the crowd should gasp" event that currently produces a tick sound
and nothing else.

Add a small `moment(kind, ctx)` dispatcher (own file, ~80 lines, `CONFIG.moments`) fed by:

| Moment | Detection | Payoff |
|---|---|---|
| **WOODWORK** | already in `hitPost` | "OFF THE POST!", crowd *ooh*, 0.25s time-pinch (`S.timeScale`) |
| **SAVE** | ball on-target (project `b.v` to the goal plane, `\|z\|<goalHalf`, `y<goalH`) and last contact was the defending GK/DEF rod | "SAVE!" banner in the saving team's colour, GK stat credit |
| **GOAL-LINE CLEARANCE** | on-target ball whose x crosses within ~3u of the goal line then reverses | rarest and loudest |
| **SCREAMER** | goal where impact speed at last touch > threshold | picks from the high-end commentary pool, longer replay |
| **OWN GOAL** | `S.lastTouch === team` on concede | crowd groan, different banner colour |

The time-pinch is the important one: **a 0.2–0.3s `S.timeScale` dip on a near-miss is the single
strongest "this game was made by a person" signal you can add.** You already have the lever
(`MATCH.goalSlowmo` proves it works).

### 1.2 The crowd is one scalar

`Au.exc` decays at a flat `dt*.3` and drives one bandpassed noise gain (`audio.js:98-100`). It never
*reacts* — it only swells after loud contacts.

- **`Au.react(kind)`** — short shaped bursts over the bed: `ooh` (near miss), `groan` (own goal /
  conceded), `roar` (goal, scaled by how close the game is), `hush` (sudden death, final 10s: duck
  the bed to near-silence, then blow it open on the next goal).
- **Tension ramp:** feed `Au.exc` a slow term from *ball proximity to a goal* + rally length, not
  just impacts. A 15-second scramble on the goal line should get louder on its own.
- **Home crowd bias:** in league, weight the roar toward the player's team. One line, big effect.

### 1.3 Commentary vocabulary

Six strings will visibly repeat in a first-to-10. Replace the flat `HYPE` array with **pools keyed
to the moment**: long-range, deflection, rebound, golden ball (×2), equaliser, comeback, hat-trick,
last-second, sudden death, first goal, thrashing. Same one-line call site in `flow.js onGoal`, but it
picks the pool from context you already track (`S.score`, `S.suddenDeath`, `b.t.value`,
`S.stats.topSpeed`, last-touch chain). Target ~60 lines total. The `state.js` comment already sets
the right bar — *"Commentary, not narration"* — keep it.

### 1.4 Match stats are three numbers  — **DONE 2026-08-19**

> Built as `js/matchstats.js` + `CONFIG.matchStats` + a two-tab win screen. Tracked: shots, shots
> on target, passes completed, saves, woodwork, hardest hit, rod distance, territory by third,
> longest rally, and per-rod goals / shots / on-target / kicks / distance. **MATCH** is a mirrored
> comparison bar per stat plus a territory bar, a scorers strip and the two match-level facts;
> **RODS** is the per-rod table. Deliberately INDEPENDENT of `CONFIG.moments.on` (it keeps its own
> per-ball contact record) so the sheet can't quietly empty itself when the drama tier is off;
> saves and woodwork are still detected once, by 1.1, because they ARE that event.
> **Possession by third became TERRITORY** — six numbers split by team AND third is unreadable, and
> where the ball actually spent the match is the figure people look at.
> **Still open from this item: the league top-scorer table and per-rod SEASON stats.**
> `S.stats.scorers` and `S.stats.rods` are the shape those want, but they die with the match —
> persisting them needs a `LG` save-format change in `lgRecord`, which is its own job.

Track: **shots, shots on target, saves, woodwork, passes completed, longest rally (s), possession by
third, hardest hit (km/h), distance travelled per rod, per-rod goals.** All of it falls out of hooks
that already fire (`collideRod`, `hitPost`, the moment dispatcher above).

Then it feeds three places for free: a real post-match screen, a **league top-scorer table**, and
per-rod season stats that make upgrade spending feel earned.

---

## Tier 2 — Skill ceiling. This is where the game becomes *a game you get good at*.

### 2.1 Signature shots — the biggest single gameplay win available

A keyboard player's entire move set today is *slide, kick, raise*. Real foosball's identity is its
shots — the **pull shot**, **push shot**, **snake/rollover**, **tic-tac**. You've already built
everything needed:

- `kickStyleCfg` / `styleCfg` in `rods.js` — the comment literally says *"a new style is a config
  block plus a line here, not a hunt through three files."*
- `CONFIG.kick.sweetSpot` + the B-key guide (`sweetspot.js`) — a precision reward with nothing that
  demands precision yet.
- Spin (`b.spin`), the swerve axis (`r.tcSpin`), and energy-conserving curve in physics.

Proposal — **charge & release**:

- **Tap kick** = the current swing. Unchanged, so nothing regresses.
- **Hold kick** = wind up (visible: men rock back, a charge ring on the held rod). Release fires with
  power scaled by charge, but the **lateral rod velocity at the moment of release sets the shot
  angle** — slide left while releasing and you pull it left. That *is* the pull shot, and it's the
  same input a real player makes.
- **Raise + kick within a short window** = **rollover/snake**: men come over the top, heavy topspin,
  fast and low but with a much tighter sweet spot. Highest risk/reward shot in the game.
- **Sweet spot pays out properly**: a clean strike gets a visible shockwave ring, a distinct audio
  layer, and a real power bonus. Right now landing it is invisible.

This gives the AI's existing `trapShot`/`passShot` styles human counterparts, and turns the
already-built trap behaviour into something a player can *counter* rather than just watch.

### 2.2 Give the player passing

`ai.js` has `passEval`, `passPick`, `passShot`, `dribble.pass`. Players have none of it. Add a pass
input (a second button, or tap-vs-hold if buttons are tight) that plays a controlled ball to your own
next rod, plus a **one-two bonus**: receive cleanly on the next rod within a window and the follow-up
shot gets a power/aim boost.

This is the fix for the two-hands rule reading as a *limitation*. Right now the other rods holding
their lane is a constraint imposed on you. With passing, it becomes the thing you play *through* —
you set up your own attack across rods. Same code, completely different feeling.

### 2.3 Keeper play

The GK is one man with full slide range and no distinct verb. Add a **dive/scramble**: a short burst
of extra slide speed + a lunge on the raise input, on a cooldown, effective only against fast
on-target shots. Pairs directly with the SAVE moment in 1.1 — suddenly the most passive rod on the
table has the most dramatic moment in the game.

### 2.4 Let the player *earn* special balls

`pickType()` rolls ball types at random when `cfg.special` is on. Random specials feel like weather.
Instead: sustained pressure, a long rally, or a filled momentum meter (below) triggers the drop, with
a short telegraph. Same ball types, but now they're a reward.

### 2.5 A visible momentum meter

`ai.js` has internal momentum; the player sees none. Put a bar on the HUD per team that fills with
possession, shots and saves, and drains on concede. At full: a one-shot **SURGE** — a few seconds of
raised kick power and slide speed, announced loudly, spent by using it.

That's the missing between-goals objective. Right now the only thing to play toward is the next goal;
this gives you something to build for 30 seconds at a time, and it makes being 3-0 down interesting
instead of over.

### 2.6 Named rods with traits

Your league already computes per-role stat blocks (`bld.GK/DEF/MID/ATT` × 7 stats). The men are
anonymous. Give each rod a **named player with a trait** — *Cannon* (+str −acc), *The Wall*
(+rea −spd), *Playmaker* (+iq +ctl), *Livewire* (+spd −sta). Pure flavour over numbers you already
compute, and it converts the upgrade screen from a slider panel into a squad. Then the top-scorer
table from 1.4 has *names* in it, and the season has characters.

---

## Tier 3 — Progression & retention (the Steam-facing tier)

### 3.1 Achievements — there are currently zero

Steam players expect them and they're one of the cheapest retention systems that exists. A flat
`ACH` table + a check hook in `onGoal` / `endMatch` / `lgRecord` + a toast (you already have `toast`).
Target ~30–40: *score from your own half · win without conceding · win from 3 down · hit both posts in
one rally · score with all four rods in one match · win a cup · promote twice · 100 saves*. Persist in
`cfg`. Wire to Steam achievements later in the Electron wrapper — the table is the same.

### 3.2 Skill Trials (challenge mode)

`training.js` is a full sandbox — free ball placement, launcher, per-rod hide, freeze, single-step —
with **no scoring on top of it**. That's a mode sitting 90% finished.

Add a trial list with a timer and a local best: *score from your own half · 5 goals in 60s · beat the
keeper 3 times running · survive 90s a rod down · 10 consecutive passes · hit the crossbar 3 times*.
Bronze/silver/gold thresholds, feeds achievements, teaches the signature shots from 2.1 as a side
effect. This is your tutorial without ever writing a tutorial.

### 3.3 A fixed-seed daily challenge

One shared setup per day (same seed, same table, same opponent build), score it, keep a local best
and a 7-day streak. No server needed. Trivial to build on top of 3.2, and it's the single best
cheap reason to open the game tomorrow.

### 3.4 Career texture in League

The league is structurally strong; it just needs stakes between fixtures.

- **Season objectives from a "sponsor"** — *finish top 3*, *keep 4 clean sheets*, *beat the champions* —
  paying upgrade parts. Gives a mid-table season a point.
- **A rival** that tracks you across seasons: promotes/relegates near you, gets a highlighted fixture,
  a distinct kit, and a grudge line on the tape screen. You already have `primeMatchTape` and
  `renderLgTape` — the presentation layer is built.
- **A top-scorer race** in the division (needs 1.4 + 2.6). Cheap drama.
- **AI teams poaching each other's star rods between seasons**, so the ladder isn't a fixed
  hierarchy re-skinned each year. `lgAiSpend` is already the right place.
- **Form/confidence** as a small multiplier on the sim and on live `baseDiff` — a team on a five-game
  run should actually be harder.

### 3.5 Turn unlocks into a spine

You already have the content: 7 classic table skins, 3 rooms, multiple pitches, a figurine roster
with finishes. It's all just *available*. Gate a chunk of it behind achievements and season progress
so `customize.js` becomes a reward screen rather than a settings page. Nothing new to author — just
a `locked` flag and an unlock toast.

---

## Tier 4 — Visual engagement

### 4.1 The crowd is a 512×128 canvas of coloured dots on a cylinder

`world.js buildCrowd()` — `CylinderGeometry(210,210,90,48)` with a `MeshBasicMaterial`. It's static,
unlit, and it never moves. In a game this polished it's the most obvious remaining tell.

Replace with **one `InstancedMesh` of billboard figures** (a few thousand instances, one draw call):
per-instance colour, a slow idle sway on a per-instance phase offset, and a **stand-up-and-roar on
goals** driven by `Au.exc` — the same scalar the audio already uses, so it's automatically in sync
with the sound. In dark rooms (Void, Arcade), scatter a few hundred flickering phone-light points.
Cost is one instanced draw; the payoff is the whole scene coming alive.

### 4.2 A diegetic scoreboard / jumbotron

Rooms exist (Pub, Neon Arcade, Void) but carry no match information. Hang a scoreboard in each room —
score, clock, team names — rendered to a canvas texture and updated on change (not per frame). Then
**replay the goal on it** during the celebration: you already have the replay ghosts and the camera
rig; render one extra pass to a small `WebGLRenderTarget`. That single feature reads as a
professional sports game more than any particle effect will.

### 4.3 The goal celebration is one beat long

Currently: 4 particle bursts + flash + shake + LED strobe + DOM confetti. Add a **scripted beat**:

- camera push-in on the scoring rod (you have `cameraUpdate` lerping and `REPLAY_SHOTS` proving
  scripted camera works),
- the scoring rod's men **spin/celebrate** — a 720° rod spin with an ease-out is ~10 lines and reads
  instantly as a celebration,
- **net ripple** — `netMats` and the net geometry are already there; a decaying sine displacement
  along the impact normal for ~0.6s is the classic and it's cheap,
- goal-light bloom pulse (`goalLights` already exists and is set to intensity 4 flat).

### 4.4 Impact language

- **Sweet-spot strike** → expanding shockwave ring + a distinct audio layer. Perfect contact should
  be unmistakable.
- **Speed-scaled trail**: the fastest shots should read as a streak, not the same trail as a roll.
- **Scorch/scuff decals** on hard wall hits, fading over ~10s. A table that accumulates evidence of a
  violent match is very cheap storytelling.
- **Ball roll audio** already exists (`Au.rollTick`) — make it surface-aware (pitch vs wood vs net).

### 4.5 Lighting as drama

`CONFIG.fx.lightPool` already solves three.js r128's light-count recompile problem — you have spare
lights sitting resident and mostly unused. Spend them:

- **Sudden death**: dim the room, push a spotlight cone onto the table, desaturate the bed.
- **Match point**: a slow pulse on the LED strips in the leading team's colour.
- **Kickoff**: a short light-show sweep before the countdown.

### 4.6 There is no music

Not one note, anywhere — menus included. This is the largest single gap in first-impression terms; a
silent main menu reads as unfinished no matter how good the table looks. Two options:

- **Ship audio files** for menu/league/match-tension loops (breaks the no-files discipline, but the
  discipline was about *SFX*, and 3 loops is a few MB).
- **Or stay synthesized**: a small WebAudio sequencer over the existing `Au` graph — a pattern bank
  with a tension parameter driven by `Au.exc` and the score margin, so the music tightens as the game
  does. More work, but it's *dynamic* music, which files can't do, and it fits the build's character.

---

## Tier 5 — Modes worth considering

- **Quick Tournament** — the cup exists but only inside a league save. An 8/16-team standalone KO
  bracket is mostly `cupMakePool` + the bracket UI you already render.
- **Gauntlet / survival** — beat successive teams with no reset between them; fatigue and stat
  damage carry over. Directly reuses the stamina system (`kickFat`, two-channel) that currently only
  matters inside one match.
- **Party mode** — 4-a-side local co-op is a genuine selling point and it's already built. Give it a
  front door: rotating teams, first-to-X ladder, per-player seat stats at the end, winner stays on.
  This is your couch/Steam Deck pitch and it costs almost nothing.
- **Trick-shot mode** — target boards on the walls, ricochet objectives. Training's placement system
  does the heavy lifting.
- **Online** is the obvious big one and it's also the one that will eat a quarter of the project.
  I'd bank the local-multiplayer story first.

---

## What I'd actually do first

If you want the biggest change in how the game *feels* for the least structural risk, in order:

1. **Moment detection + reactive crowd + expanded commentary** (1.1–1.3). Touches almost nothing,
   changes every rally.
2. **Signature shots** (2.1). The skill ceiling. Everything downstream — trials, achievements,
   momentum — gets more interesting once the player has shots to master.
3. **Instanced reactive crowd** (4.1) + **goal celebration beat** (4.3). The two clearest
   "hand-crafted" signals still missing from the visuals.
4. **Real match stats + a proper post-match screen** (1.4). Unlocks the league top-scorer race and
   makes the stat builds legible.
5. **Achievements + Skill Trials** (3.1–3.2). Retention, and the tutorial you never have to write.

Music (4.6) sits outside that order because it's a decision, not a task — worth settling early since
a synthesized approach shapes how `audio.js` grows.

---

## Watch-outs

- **Light count is load-bearing.** Anything that adds or removes a `PointLight` mid-match forces a
  whole-scene shader recompile in r128. New glow effects borrow from `fx.lightPool`; they don't
  `scene.add` a light.
- **Sim cost triples on a slow frame.** `main.js` banks up to `sim.maxSteps` (7) at `sim.hz` 120 with
  physics substepping to 7 — a dropped frame runs up to 49 collision passes. Per-frame work added to
  the sim path costs ~7× more than it looks during exactly the frames you can least afford. Keep new
  logic (moments, stats, momentum) on the render/event path where it doesn't multiply, and check the
  `M` profiler after each addition.
- **Every new number goes in `CONFIG`.** That discipline is why this codebase is still tunable at
  this size — new systems should each get their own block (`CONFIG.moments`, `CONFIG.momentum`,
  `CONFIG.trials`, `CONFIG.crowd`).
- **Guard new systems the way `S.trn` and `S.photo` are guarded.** One nullable gate on `S`, tested
  by other files and nothing else, so a missing module can never break a match.
