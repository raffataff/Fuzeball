# Fuzeball — config tuning notes

Reference for `js/config.js`. The config file itself carries one short line per
parameter; this document holds the reasoning, the derivations, and the values that
constrain each other. Keyed by config path.

Coordinate system: **X** = goal to goal, **Z** = width, **Y** = up. Field surface at
y = 0, goals at x = ±60 (`table.L`/2), side walls at z = ±34 (`table.W`/2).
Rods sit at x = ±7.5 / ±22.5 / ±37.5 / ±52.5, so rows are 15 units apart.

---

## Values that constrain each other

Change one of these and check the others.

| Constraint | Why |
|---|---|
| Every action `abortT` < `deadball.stallT` (4.6) | A stuck ball must be whistled and re-dropped rather than held forever. Applies to `ai.trap.abortT`, `ai.dribble.abortT`, `ai.safeRaise.abortT`, `ai.evade.abortT`, `ai.clearLane.abortT`. |
| `ai.trap.settleT + ai.trap.holdT` < `ai.trap.abortT` and < `stallT` | Otherwise the dead-ball timer whistles a ball the AI is deliberately holding. |
| Largest `diffs.*.reactDelay` × ~1.5 < `ai.reactMax` | `reactMax` sizes the per-ball history ring (`ceil(reactMax × sim.hz)+1` steps). The ×1.5 covers the slow-reaction/fatigue floor in `stReact`. Rookie: .25 × 1.5 ≈ .375. |
| `seats.tint` length ≥ `seats.perTeam` | The last entry repeats, so a short list makes the last two players on a side render identically. |
| `league.cup.drawSize + 1` must be a power of two, and `rounds` must be log2 of it | The bracket is a real tree (`cupSeedOrder` / `cupNextRound`); a 6- or 12-team field pairs off into undefined. 7+1 = 8 with 3 rounds; the next legal size up is 15 + 4 rounds. |
| `ai.dribble.pressX` > ~12 | See *Dribble → pressX* below. Anything smaller makes the test permanently false. |
| Carry/aim leads < the boot's true z reach (≈3.25) | `footBox.z` 1.35 + `BALL_R` × `footBoxReach` 1.9. Applies to `trap.carryLead`, `trap.holdZ`, `dribble.carryLead`, `dribble.holdZ`, `dribble.alignZ`. Past it the boot isn't touching the ball. |
| `deadball.redrop.zones[].from` must tile −L/2..L/2 with no gaps | An x covered by nothing falls back to a random zone pick. The outer two run past the goal lines so a ball leaving behind a goal still resolves. |

---

## `table` / `goalNet`

**`goalNet.bevel`** rounds the two top side creases so the net's shoulders echo the
frame's rounded post/crossbar joint instead of meeting at a bare 90°.

- `r` is auto-clamped to half the mouth half-width and half the goal height, so it
  can't invert on a tight goal.
- `segs` 1 = a flat chamfer; 3–5 reads round. The net texture hides faceting long
  before more triangles are worth it.
- **Cosmetic only.** Physics keeps a flat roof plane at `goalH` (`goalFrameCollide`),
  so with a large `r` a ball resting on the roof floats just off the visual net within
  `r` of the side. Keep `r` well under `goalHalf` and it's invisible.

---

## `tables` — the table registry

Each entry is one selectable table **shape**.

**Skins** are swappable paint jobs on the *same* shape — like pitches, but for the
whole table. Each entry is a GLB of that shape textured differently, `glb` relative to
`folder`, with an optional absolute `glbFallback`. Every table needs at least one skin.
To add one: texture the shape in Blender, export a new GLB
(`tools/build_table.py` + `export_table.py`, `SKIN_ID`), add a line.

**Rods** are visual only — physics and `RODDEFS` are identical across every table; this
just swaps the rod hardware GLBs (bar + handle + collar + knob). The men are always the
customize model, never table-specific. Omit `rods` and the table uses the shared set in
`assets/rods/`. With `rods:{folder, files?}`, `folder` holds `fuzeball_rod_<n>man.glb`
for n in 1, 2, 3, 5; override individual names via `files:{2:'….glb'}`. Any size the
table set is *missing* falls back to the shared set, then to the primitive rod — so a
table can override just one size, and a not-yet-built set silently shows stock rods.
Sets are lazy-loaded on first use and reskinned in on table switch
(`models.js loadRodSet` / `world.js reskinRods`).

**To add a table:** drop skin GLB(s) honouring the mesh-name contract
(`field*` / `led*` / `goal_net*` / `goal_frame*` / `wall_end*`) under
`assets/tables/<id>/` and add an entry. The loader and dropdowns pick it up. A `flat`
table needs no physics change; a genuinely new shape adds a collision branch.

### `tables.*.deadzones`

A ball pinned in one of these regions is unreachable — no man can slide to it — so the
dead-ball timer ticks `mult`× faster there.

Each entry is a **corner**: the region where *both* |x| > `xMin` **and** |z| > `zMin`,
covering all four corners symmetrically. z ≈ 0 in front of the goal is deliberately not
a deadzone — the centred keeper reaches it. Walls sit at x = ±60, z = ±34; the 1-man GK
sits at x = ±52.5 and slides to z ≈ ±20. So `xMin` 52 / `zMin` 22 would fence off
exactly the four wall-corner pockets behind the keeper line. Omit `deadzones` entirely
for a table with no dead pockets.

### `tables.arena.bowl`

All radii in table units. `tools/build_arena_table.py` mirrors these numbers.

**`length` (120).** Each side wall is straight for x ∈ ±(`length`/2 − `cornerR`), then
the corner arc curves from there to the end wall at x = ±`length`/2. The goal mouth is
fixed at the real goal line x = ±60 — that's where scoring happens in `physics.js`, and
it does **not** move with `length`.

- The corner sticks out in front of the goal by exactly `cornerR` units (it starts
  curving `cornerR` before the end). To make the bend meet the goal instead of curving
  in front of it, shrink `cornerR`; the flat wall then reaches x = ±(60 − `cornerR`)
  and the corner tucks into the end.
- **Keep `length` ≈ 120.** Above 120 the end wall passes the goal line and *buries* the
  goal pockets — the bowl swallows them. Below 120 detaches the pockets from the wall.
  Retune the goals in `physics.js` if you really want a longer bowl.

**`width` (68).** Matches `table.W` so the arena walls line up with the classic table.
The arena *looks* slightly narrower than classic, but not because of this: the crease
fillet rises from about `creaseR` inside the wall, so the flat pitch area is ~`creaseR`
narrower per side and the outer pitch lines ride up the slope. To match classic's flat
width, either drop `creaseR` or raise `width` by ~2 × `creaseR`. The shared pitch plane
stays `table.W` wide, so widening much past it opens a gap between the painted lines
and the wall — nudge, don't crank.

**`creaseR` (4).** 0 = a sharp 90° corner: vertical walls meeting a flat floor,
classic-table style. Raise it for a rounded bowl where the ball rides up the wall, but
keep it ≤ 5.5 — above that a ball hugging the wall sits too high for the feet at max
rod slide.

### `tables.circuit.endWall.h`

The two mouth-flanking end walls are joined into one solid face the goal is inset into,
so over-the-bar shots bounce back into play instead of sailing over. Balls hitting
x = ±60 below `h` bounce back. Big Goal still widens the inset mouth — the opening
tracks `goalHalf × bigGoalMult`, the GLB's `wall_end_*` flanks slide, and
`goal_frame_header_*` stretches to match. **Mirror `tools/build_table.py`
`TABLE_DEFS.circuit.endWallH` when changing this.**

---

## `tableAssets` — memory

A table skin GLB is one of the fattest single assets in the game (shell + goals + baked
textures), and a `room` backdrop is fatter still. Loading every table's at boot pinned
all of them in RAM/VRAM to show one.

Only the active table's active skin (plus its room) is fetched at boot; the rest load on
demand when picked (`applyTable` / `selectSkin` funnel every switch), and
least-recently-used ones past the caps are disposed.

Caps count **total** resident entries *including* the active one, which is always
protected. So `cacheSkins:1` means "only ever the one you're looking at";
`cacheSkins:2` keeps the previous one warm for instant A/B in the menu.

`preloadAll:true` restores eager boot loading — handy for profiling a build with no
pop-in, or for a Steam build shipping off local disk where fetches are cheap.

---

## `physics`

### Contact audio gates

An impact is an **event**; a roll is a **state**. `wallHitSnd` / `ballHitSnd` /
`floorHitSnd` decide which one a given contact is.

The side/end wall bounce originally had no threshold, so a ball hugging a wall re-fired
the one-shot on every substep — 3–7 per rendered frame, up to ~420/s, which
comb-filtered into a buzzsaw. Raise the `*HitSnd` values for a quieter, rollier table;
drop them for a clackier, more arcade one.

`contactHold` is the debounce that FMOD and Wwise call "min time between instances": a
surface must have been clear this long before it can fire another impact
(`physics.js hitFresh`).

### `floorFric` / `airFric`

Applied per substep as `exp(-k·h)`, so keep them as coefficients rather than
per-second rates.

---

## `kick` — how hard a contact hits

`physics.js collideRod` applies, along the contact normal:

```
jm = (1 + rest) × (−vn) / ball.mass
```

`vn` is the closing speed of the ball **relative to the moving foot**, so a fast swing
produces a big `vn` even against a stationary ball — which is why `rest` reads as the
strike's *power*.

| `rest` | Behaviour |
|---|---|
| 0 | Dead foot. The ball's normal speed relative to the foot becomes 0: it stops against the boot and is only carried along by it. A trap/absorb touch. |
| 0.5 | Leaves at 50% of the relative approach speed, *on top of* inheriting the foot's motion — i.e. 1.5× the impulse of `rest` 0. |
| 1 | Perfectly elastic. The ball leaves at the same relative speed it arrived. A pinball. |

Division by `ball.mass` is why a cannonball (mass 7) barely moves on the same swing that
launches a classic (1.25). So: `rest` is the passive/absorbing touch, `restPower` is the
struck shot.

**`powFrom` / `powTo`** decide which of the two is used, by timing: power applies when
`kickT ∈ [powFrom, powTo)` at the moment of contact.

> Known quirk (kick-log evidence, 2026-07-22): contact almost always resolves on the
> *first* swing step (`kickT` ≈ 0.017 at hz 60), because the AI only kicks at balls
> already inside the foot's reach. So this window is rarely reached and `restPower` is
> mostly dead for AI swings. `sweetSpot` is the position-based version of the same idea
> and does fire. Read this before retuning either.

**`grip`** is the fraction of the foot's own velocity lerped into the ball on *any*
contact. Independent of `rest`: it acts even on a graze, which is how a `vn` ≈ 0 brush
still pushes the ball along. High = sticky and draggy; 0 = pure bounce.

**`padAngleLerp`.** 0 = direct 1:1 — stick position *is* rod angle, at full swing speed.
Keep it at 0 for a true flick-through where fast stick motion means a fast rod and a
hard kick (strike power is `angVel`-driven). Above 0 it's an exponential ease rate (1/s)
if you want softer control.

### `kick.sweetSpot`

A clean strike landing in the narrow centre of the foot (z) **and** a tight forward band
(dir-relative x, measured off the rod like the AI's `overFoot` zone) earns a power bonus
and forces aim-assist on, even outside the timed power window.

The bonus scales with the rod's `acc` stat — an accurate rod gets more out of a clean
hit — and a smart AI rod (its `iq` roll) adds a little more. It rewards good alignment
for free: a low-error rod centres the ball better, so it lands in this zone more often.
`on:false` restores the flat, position-independent kick.

---

## `ai` — actions

The AI actions are mutually exclusive states on `r.act`. Priority order when several
could fire: **`clearLane` → `trap` → `dribble` → `safeRaise` → `evade`**. Each has a
debug layer in the AI panel (press C).

### `underFootFront` / `underFootBack`

The window `rel ∈ [−underFootBack, +underFootFront]` is where a swung rod stays forward
instead of lowering. It **must** cover `rel` ≈ 0 (ball directly under the player), or
the drop sweeps backward through the ball into your own goal. Raise `underFootBack` for
more behind-coverage if feet still clip.

### `inFootRange` and `footRangeBack`

`inFootRange` is the dir-relative rectangle a foot can touch — one source of truth for
the safe-raise / safe-lower "would we clip the ball?" questions:

- forward depth = `underFootFront` (a dropping or kicking swing)
- back depth = `footRangeBack` (a raising swing sweeps behind)
- z half-width = `footBox.z` + `BALL_R` + `clearMargin`

### `heldFwd` — held-forward evade (post-kick)

After a kick, if a slow ball is still in the rod's drop-sweep zone, the rod stays held
forward (`updateRods` pins the strike angle while `r.evadeHold` is live) and slides the
men decisively away in a committed direction, suppressing re-aim and re-kick, until the
ball leaves the x-window, speeds up, or the safety timer expires.

Without the persistent latch the rod cleared z for one frame, dropped, and man-selection
dragged it straight back onto the ball to re-kick — the "rod follows the ball while
swinging" behaviour. It never lowers while the ball is in front, so the drop can't swipe
it backward.

This section **owns the drop-sweep zone**: `updateRods`' hold pin and the debug
'Drop Sweep' layer read `xFront` / `xBack` / `zMargin` from here, decoupled from the
shared `underFootFront` / `underFootBack` / `clearMargin` (which still feed
`inFootRange` and `latchStuck`).

`vz` must be > 0. At 0, a resting ball's noise-level `v.z` decides the sign every frame,
making the "committed" direction a per-frame coin flip.

### `trap`

A slow ball at or behind the men is pinned under the boot instead of swung at. The rod
eases to a shallow angle so the foot box sits at ball height, `collideRod` switches to a
dead + sticky contact (`holdRest` / `holdGrip`) so the ball stops and travels with the
foot, then the rod carries it sideways hunting an open lane (`shotEval`) before scooping
it away with the `trapShot` curve.

Three phases, all driven off `r.actT`:

| Phase | Window | Behaviour |
|---|---|---|
| CATCH | `0 .. settleT` | Kill the ball; man-selection keeps the boot on it |
| CARRY | `settleT .. +holdT` | Slide toward the z that opens a shooting lane |
| SHOOT | lane open, or `holdT` up | `kickRod(r,'trapShot')` |

Only rods whose `iq` roll passed attempt it; everyone else keeps the raise latch.

**`angle` geometry.** Rod-local (× `kickDir`), same convention as `raiseA`. It must put
the foot box at ball height or the ball rolls underneath and the trap does nothing
visible. The box centre sits at
`y ≈ ROD_H − cos(a)·ARM + sin/cos(footBoxOff)`, which is ~1.9 (ball centre) near
a ≈ −0.25 and climbs to ~3.7 by a ≈ −0.9 — a foot hovering a whole ball-diameter over
the ball. That is why −0.9 never held anything: the only contact it could make was a
downward one that shoved the ball into the floor and squirted it forward.

- Shallower (→ 0): flatter boot, bigger pin window, less able to stop a fast ball.
- Deeper (→ −0.5): more of a scoop lip behind the ball, but starts lifting off the floor.

**`back` / `front` catch window** (dir-relative x off the rod) must span from behind the
men through the feet — a trap that releases before the ball reaches the boot is a block,
not a trap. `front` deliberately overlaps `overFoot`; the kick gate is `!r.act`-gated so
the normal swing can't steal a ball we're holding.

**`holdGrip` (0.55).** The carry. At 0.55 the ball tracks the rod's slide closely enough
to be dribbled sideways. Toward 1 it's welded to the boot and reads as cheating; below
~0.25 the rod slides away and leaves the ball behind.

**`minApproach` (−2.5).** Negative on purpose: a still ball, or one drifting gently
goalward, is exactly what should be trapped. A positive value (it was 6) required a
briskly rolling ball, so the one case that actually wants a trap — a slow or dead ball
sitting in range — could never enter it, and `evade` picked it up and slid away instead.
Only a ball genuinely running away toward our own goal is refused; there's nothing to
pin it against.

**Own-goal guard (directional).** The catch tilts the foot *backward* (`angle` is
negative, so the boot ends up ~`sin(|angle|)·ARM` ≈ 3u behind the rod, on the own-goal
side) and resolves the ball along the foot→ball normal with `holdRest` 0 / `holdGrip`.

- When the ball is **behind** the feet, that normal points goalward, so the catch shoves
  the ball into our own net. This is the keeper own-goal: a ball at rel −3.5, i.e.
  between keeper and net.
- When the ball is **in front**, the catch tilts away from it and the normal points
  upfield — safe even hard by our own goal.

Hence two margins. `ownGoalBehind` 16: the GK sits ~7.5u from its line, so at 16 the
keeper never traps a ball behind it (correct — that catch can only go into the net),
while the DEF at ~22.5u out still can. Lower it toward `ownGoalGuard` to let the keeper
trap behind again, at own-goal risk.

**`gkReach`** *replaces* the `alignZ` test for the keeper, so keep it small. At 20 the
GK traps balls it isn't remotely lined up with.

**`sweep` — the knock-back guard.** Entering a trap does not freeze the rod: `rods.js`
eases `r.angle` toward `angle`, and that rotation drags an oriented box through space. A
ball standing in that arc is struck along the contact normal and, with `holdGrip` 0.55
lerping the boot's velocity into it, dragged as well — so when the normal points at our
net, the catch *is* a backward kick.

`footStuck` / `inFootRange` can't do this job: it's a static rectangle whose back depth
(`footRangeBack` 7.0) is deeper than the whole catch window (`back` −5.8), so
`!footStuck` on entry refuses 100% of traps. The sweep test walks the *actual* swept arc
instead and refuses only contacts whose impulse is goalward (`sweepClips()` in `ai.js`).

Effect on feel: the usable catch band tightens from `back` −5.8 to roughly the boot's
resting reach (rel ≈ −2.5), because a ball further back can't be reached without the
boot travelling through it first. Refused balls fall through to `evade`.

- `samples` 7: the box is ~2.9u wide in x and the arc sweeps ~5.8u, so 7 steps leave no
  gap wider than the box itself. 5 is coarse, 9 is thorough.
- `pad`: **raise this first** if a knock-back still slips through.
- `clampSteps` 10: the catch targets the *deepest* tilt on the way to `angle` whose
  sweep stays clean, rather than always committing to `angle`. 10 steps over a 0.5 rad
  arc = 0.05 rad granularity.
- `pushDot` 0 refuses any rearward component (strictest, costs the most legitimate
  traps); 0.5 refuses only near head-on shoves.

### `trapShot` and `passShot` — rate, not duration

`strike` is the **end time** of the ramp, so the forward sweep lasts
`(strike − windup)` seconds and covers `(strikeA − windupA)` radians. The number that
matters is the ratio.

| Curve | Sweep | Rate |
|---|---|---|
| Normal `kick` | — | ~21.8 rad/s |
| `trapShot` | 2.35 rad over 0.10s | ~23.5 rad/s |
| `passShot` | 1.2 rad over 0.12s | ~10 rad/s |

`trapShot` was once 0.16/0.2 with `windupA` −1.0 — 2.85 rad in 0.04s ≈ **71 rad/s**. The
foot crossed ~7u per sim step, i.e. straight through the ball (the same tunnelling the
`kickA0` fix removed), and dragged the trapped ball ~3.7u backward during the windup
before striking it. If you retune, raise `strikeA` and `strike` **together** and keep
the rate near 21.8.

`passShot` is deliberately half-rate: a pass only travels ~15 units to the next row, and
a full-power strike arrives faster than the receiving rod can react and just rebounds
off it — which is the problem passing exists to solve.

### `dribble`

A rod with the ball at its feet, men down at rest, and no way forward slides the ball to
a better line instead of hitting it into the row opposite. It addresses two things that
made play read as a pinball table:

- the ball ping-ponging between two rods, because the kick gate fires at *any* ball in
  reach (`overFoot || inFront`) whether or not there's anywhere to hit it;
- players hammering the end wall or the man in front of them, because the aim logic only
  ever chose where to aim *from where the ball already is* — nothing asked "would I have
  a better line if the ball were somewhere else?".

**This is not a trap**, and the difference is the whole design:

- **No angle.** The trap rotates the rod to a pin posture. The dribble touches nothing in
  `updateRods` — the rod stays at the ordinary rest angle, men down. A ball at a resting
  boot is also the one thing the trap could never hold (its pin angle sits the box too
  high and shoves the ball away), which is why this is its own action rather than a
  wider trap window.
- **The contact is a nudge, not a pin:** `holdGrip` 0.30 against the trap's 0.55 and the
  passive touch's ~0.08. The ball is dragged along with visible slip.
- **It ends with an ordinary kick or a pass, not a scoop.** The ball is already in the
  normal strike zone with the men down.

**Control window derivation** (at the rest angle a = 0, the posture this action uses —
contrast `trap.back`/`front`, derived at its −0.5 pin):

```
foot base    fy = ROD_H − ARM = 1.20,   fx = 0 off the rod
box centre   bcx = fx + offy·cos(a) = +0.40 (dir-relative)
             bcy = 1.20 + 0.65 = 1.85   ← level with a ball centre at BALL_R 1.9
x half-reach = |footBox.x·sin(a)| + |footBox.y·cos(a)| + BALL_R·footBoxReach = 2.90
```

So contact is possible for `rel ∈ −2.50 .. +3.30`. Stay inside it — outside, the boot
can't touch the ball at all and the rod slides about next to a ball it isn't moving
until `abortT`.

**`roles`** includes DEF deliberately: a defender's job here is to work the ball past the
opposing attack row rather than belt it into them (see `outletClr` in `ai.js` — for a
non-attacker the score *is* "can I get past the row in front"). `ownGoalGuard` keeps that
honest. Never GK.

**Target scoring** (`dribTarget` in `ai.js`):

```
score = outletClr + centrePull × (gain toward centre) − travelCost × (distance)
```

where `outletClr` is "how good is my way forward if the ball were here" — the goal-mouth
lanes for an attacker, and for everyone else the z-gap past the opposing row directly in
front. `centrePull` is the winger knob: raise it and wide players cut inside harder;
0 = pure gap-hunting, and they shuffle in place out wide.

**`pressX` (13) — mind the scale.** Rods are 15 apart and this window keeps the ball
within ~3 of our own rod, so the ball is never closer than ~12 to an opposing rod.
Anything under ~12 makes the test permanently **false** (that's what 9 did). 13 means
"the ball has been worked to the front of my window and a man over there is squared up
on it".

**`noPoke`** also suppresses the full-stretch `inFront` poke for a dribbling role with no
way forward, so the ball is allowed to arrive at the feet where this action can take it.
This is the direct fix for the back-and-forth ping-pong.

**`lineClear`** should sit above `coveredClr`, or entry and exit fight each other.

### `dribble.pass`

Instead of shooting a covered shot, give it to a teammate rod ahead who has a better one.
Scored per live man of each rod ahead: the lane from the ball *to* him (`clear` — can the
pass even get there) plus the shot he'd have on receiving it (`onward`), minus distance.
Executed as a soft `passShot` with aim-assist bent at the receiver instead of the goal
(`aimAssist` in `stats.js`).

`roles` is deliberately **wider** than the dribble roles — a defender passing forward
instead of hoofing it into the row opposite is exactly what we want; it's only *carrying*
the ball it shouldn't do.

`minAhead` 10 means the next row up, never a square ball across our own line.
`maxAhead` 34: beyond ~2 rows it's a hopeful punt, not a pass.
`every` 0.2: the pass scan is the priciest thing in the AI, so don't run it per step
(cached on `r.passEv`).
`assist` 0.16 is bigger than the shot assist (`assistMax` .10) because a pass is a
deliberate, aimed action; `assistMinVX` 5 is low because a pass is slower than a shot and
the shot gate of 20 would skip it entirely.

### `safeRaise`

Decoupled from `trap`, with its own thresholds. A slow, sideways ball loiters in the
x-band behind the rod but isn't far enough back to trip the `raiseBehind` latch, so the
rod would otherwise sit *down* behind it. If raising won't clip the ball (it's not
`inFootRange` — it sits in a z-gap between feet) the rod eases to `angle` while
man-selection slides a man in behind it. When the ball rolls forward to the rod line,
speeds up, or lifts, the action exits and the normal drop+kick clears it.

### `evade`

A slow ball is stuck directly behind a man (`inFootRange`) and we're not trapping or
lifting it. Rather than shadow it in z — walling it in place — the rod slides the men
away until the ball is no longer `inFootRange`. Only fires when the ball *isn't*
strikeable (not `overFoot` / `inFront`) and is slow.

`vz` above the threshold means real z-momentum, so step opposite it; below, the direction
is geometric — the minimum-travel escape for the foot the ball is stuck against
(`evadeDir` in `ai.js`). Raise to trust geometry more, lower to trust the ball's drift
more, **never 0** (noise-level `v.z` on a resting ball would pick the sign).

`maxApproach`: evade is for a ball *parked* against a foot. A ball rolling in from behind
is about to be strikeable, and sliding away from it both wastes the block and drags the
man off the strike line mid-swing. Mirror of `trap.minApproach` — trap wants a closing
ball, evade wants a still one.

`raiseAfter`: on a *successful* clear (not a bail), latch the raise. The lift swings the
foot behind the ball in x, so the following drop sweeps forward through it and knocks it
upfield. Without it the rod exits straight back to man-selection, which re-aims onto the
ball — the "evade one frame then chase" loop.

`behindDead` 1.6: evade only slides in z and never rotates the rod, so it cannot knock
the ball backward. What must not be stolen is a *strikeable* ball, and the
`!overFoot` / `!inFront` gates already cover that (`overFoot` starts at −0.8, leaving a
0.8u buffer). It was 3.1, which left a passive band at rel −3.1..−0.8 where a stuck ball
got no action at all and the rod just shadowed it to the redrop.

### `clearLane`

A teammate rod behind us (nearer our own goal) has the ball and is about to hit it
forward — straight through our row. Standing in that lane blocks our own clearance, and
it happens constantly between a keeper and its defence: the ball sits in the 15u gap, the
defence slides onto its z (man-selection tracks the ball wherever it is), then either
lowers into the strike or parks a half-lifted boot in the kick path via `safeRaise` —
whose band, rel −5.8..0.45, *is* that gap.

So this action runs first and outranks `safeRaise` / `trap` / `evade`; all three want to
play a ball that isn't ours to play. Two moves, in order:

1. **Slide** the men off the ball's z-lane (minimum-travel escape via `clearOffset`,
   direction committed once so a shuffling ball can't make the row dither).
2. **Lift** once nothing is in back-swing reach — the clearance then passes under the
   feet. While the ball *is* in reach a lift would sweep the foot backward through it
   into our own goal, so the slide has to clear z first; it un-gates the lift on its own.

Handover is the whole design — it never holds a ball we could be playing. Entry needs the
ball behind us past `behind`; it releases at `release`, which sits 1.5u ahead of `behind`
so entry and exit can't ping-pong, and early enough that the men are back down by the
time a ball rolling in from behind becomes ours to strike (`overFoot` starts at −0.8). A
ball already *struck* (closing faster than `throughV`) instead holds the lane open until
it is `passed` clear of us, so we can't drop onto our own pass as it arrives.

**Scope is deliberately narrow.** `roles` is DEF only: the case this exists for is the
defence smothering its own keeper; a MID or ATT stepping aside mid-pitch just opens the
field up for the opposition. `zPad` requires the ball to be inside the *handler's*
z-slide band — out near a corner or hard against a side wall the keeper can't slide onto
the ball anyway, so there is no clearance to make way for.

`nearBall` 16: rods are 15 apart, so anything above 16 would lift the whole team for a
keeper's clearance and hand the midfield away.

---

## `ai` — aiming

**`alignSlow` / `alignFast`** are kept just *inside* the foot's true z-reach
(`footBox.z` 1.35 + `BALL_R` × `footBoxReach` ≈ 1.49) so a swing only fires when a man
can actually connect. Looser values let the rod kick at a ball off to the side, whiff,
and — on a slow ball with a short cooldown — hammer it again. That's the
side-miss-repeat bug.

**`gapAim`.** Smart, accurate rods read the opposing men (keeper plus any defender
between ball and goal) and steer at the widest open lane in the mouth instead of blindly
at centre; `aimAssist` bends the strike toward that gap too. A covered shot is *held* —
possession kept — for a beat in the hope a lane opens (ATT/MID only, iq-gated).

**`defend`.** GK and DEF get on the line from the ball to their own goal centre instead
of just tracking the ball's z. Because each defensive rod sits at a different x, they
intercept that line at different depths — the DEF out near the ball, the keeper back at
centre — so the two of them funnel a straight shot as a triangle instead of stacking on
the ball and leaving the middle open (the old ball-chasing keeper). Only engages while
the ball is still out in front, a real shot threat; once it arrives in kicking range the
normal drop/clear path takes over. Smart rods commit fully to the line; low-iq rods only
lean toward it (`dumbBias`) and still leak gaps, so keeper and defence quality scales
with the intelligence stat.

### `strikeGate`

`alignSlow` / `alignFast` are a *static* snapshot read off the rod's delayed view of the
ball (`aiView` / `DIFFS.reactDelay`), and they were tuned for the normal kick — whose
boot is on the ball almost the instant it commits. An **aimed** swing is slower:
`passShot` contacts at .08–.20s. Stack the two lags (~.25s perception + ~.20s swing) and
the AI was committing passes to where the ball had been nine units earlier; by contact it
had rolled between two men. The result was a swing at nothing, or a clip off the *side*
of a foot box that still resolves as a hit in `collideRod` and then collects the pass
aim-assist — so a deflection read as a deliberate pass.

`strikeOn` (`ai.js`) replays the style's real swing curve, advances the real ball to each
sample, slides the men on too, and asks `footBoxDist` whether a boot is genuinely there.
Reach, front-face and z-centred are all three required, or the action is refused and the
rod plays an ordinary kick instead. Only the listed `styles` are gated — the plain swing
is deliberately absent, so the AI's clearing reflex is untouched.

Debug: press C then L to trace a rod; refusals log as `GATE:PASS` / `GATE:TRAPSHOT` with
the measurement that failed.

- `samples` 9 ≈ 15ms apart on a pass swing. This runs only when a pass or trap shot is
  already being considered — a handful of times a second at most — so buy the
  resolution. Coarse sampling has to be paid for with a bigger `pad`, and `pad` is what
  lets near-misses through.
- `lead` can never reach back past the windup: a backswing brush is not a pass.
- `pad` exists **only** to cover the gap between arc samples, so keep it small. At 0.55 a
  ball lofted clean over the boot, or hanging off its corner, still read as a pass.
- `faceDot` ~1 = dead in front of the boot, ~0 = a pure z-side clip, < 0 = behind it.
  This is the number that kills "it hit the side of the player and counted".
- `zFrac` 0.5 of the boot's true z half-reach (3.25 → ±1.63u). The *full* reach is a
  corner touch: physics registers it, but the ball leaves sideways off the edge of the
  boot — the phantom pass. Sits just outside `alignSlow` (1.2) on purpose so it never
  fights the kick gate; it re-tests on the *true* ball at the moment of contact.
- `useReal`: reaction lag belongs in *when* a rod decides, not in whether the decision is
  physically possible.

### `wallReach` / `wallSlack`

Wall-hug rescue. A ball jammed against a side wall sits beyond the outermost man's
centrable z-range — that man is pinned at ±`maxOff` — so `dz` can never fall under
`alignSlow` even though the leg capsule (radius `BALL_R` + `PRAD` ≈ 2.6) is still
touching it. The rod stands there beside the ball into a dead-ball.

When the nearest man is within `wallSlack` of its slide limit *toward* such a ball and
the ball is within `wallReach` in z, count it aligned so the rod swings and knocks it
loose. Guarded to genuine wall-hugs plus a maxed-out man, so normal midfield aiming is
untouched.

### `hands`

Rods per team the AI may actively move at once, like a pair of human hands. **Not** a cap
on human seats: `pickActiveRods` raises the cap to the seat count when a team has more
seats than this, so every held rod is live.

`cdSlow` is raised above `cdFast` so a missed swing at a dead ball can't re-fire twice a
second.

---

## `stats`

Six 0–10 stats per rod. Base (5) is neutral: every multiplier is exactly 1 there, so a
team with no build plays identically to the pre-stats game. Effects stack per point away
from base. Physical stats (spd/str/ctl) apply to a rod whoever holds it; rea/acc also
shape the AI brain; acc adds a kick aim-assist — human rods too — that only engages
*above* base.

**`iq`** is ×(1 ± 15%/pt) on the difficulty's base `iq` roll. Base 5 = ×1; 10 ≈ ×1.75;
0 ≈ ×0.25. In league every brain is the same difficulty (`league.baseDiff`), so this stat
*is* the team's smartness knob.

**`assistBase`** exists so shots still steer toward goal or gap with no build at all —
the AI aims in every mode. Accuracy scales up from here toward `assistMax`, and fades
toward 0 for rods below base accuracy.

### Stamina, two channels

**Channel A — the clock** (`fatStart` / `fatEnd`): a uniform ramp over the match, nothing
until `fatStart`, full by `fatEnd`. Everyone on the table tires at this rate whether
they've played the whole match or stood still.

**Channel B — exertion** (`kickFat`): every swing costs the *swinging* rod a little, and
the cost bleeds off again at `recover`/s. A rod that's been in the thick of it all match
is spent by the whistle while one that's touched the ball twice is still fresh — fatigue
stops being a flat tax on everybody.

`weight` **splits** `fatMax` between the two channels; it does not stack on top of it.
The clock owns (1 − `weight`) of the budget and exertion owns `weight`. The worst case is
therefore still `fatMax` and existing balance stays bounded — what changes is that a
quiet rod now fades less than it used to. `weight:0` (or `on:false`) restores the old
uniform drain exactly. **To widen the gap between a busy rod and an idle one, raise
`fatMax` rather than `weight`.**

Exertion is deliberately **not** scaled by the `sta` stat: `stFat`'s outer
(1 − sta/max) term is already the one stamina knob and it gates *both* channels, so a
sta-10 rod is immune to kick drain too. Scaling it here as well would double-dip and make
the numbers unreadable.

- `full` (30) is the knob to reach for first — it sets how many swings it takes to
  notice. Lower = the channel bites sooner and busy rods bunch at the ceiling; higher =
  only a rod that's had the ball all match feels it.
- `recover` .12 is net-positive above ~1 swing / 8.3s. Reaching `full` net over a 180s
  match therefore takes about `full + .12 × 180 ≈ 52` swings — genuinely heavy
  involvement, not a number an idle keeper wanders into.
- `cap` bounds a very long match and leaves a little overdraft, so a rod that's been
  hammered doesn't come back the instant it stops swinging.
- `userDrain` is off by default: a human swing isn't cooldown-gated the way an AI's is
  (only the swing length caps the rate), so a player mashing kick would out-swing every
  AI on the table several times over and nerf their own rod. Turning it on makes mashing
  self-punishing — a real balance decision, not a fix.

---

## `league`

**`baseDiff`** is the brain difficulty every league team plays at; builds are layered on
top. `rookie` keeps a fresh league gentle — sluggish slide, big reaction latency, loose
aim, rarely clever — and upgrading rea/spd/acc/iq pulls a team up from there. A
per-division `diff` field overrides it for that tier, so the ceiling can ramp up the
ladder (Sunday rookie → Premier legend) instead of sitting at a flat floor.

**Timed-league sim.** When a league is created with a game-time limit (`LG.gameTime`) the
player's live matches finish at varied, often modest scores rather than racing to 5. So a
timed league sims each AI fixture with a random total-goal count in
`[simMinGoals, simMaxGoals]`, split by strength and capped at `goals` per team — anywhere
from a tight 1–0 to an end-to-end 5–4. The total is drawn from a centre-weighted
(triangular) distribution so most games sit mid-range and lopsided clean sheets are
rarer. A level game is settled by a sudden-death golden goal, so results stay decisive —
no draws. Unlimited leagues keep race-to-`goals`.

**`tapeReadyCap`.** The pre-match tape is a "look at this" beat, so it only starts once
the two figurine PNGs have *decoded* (they're preloaded in the lobby by `primeMatchTape`,
so normally that's the same frame). This bounds the wait — a stalled or missing render
can never hold up kickoff. 0 = don't wait at all.

**`rate`.** Zone-rating weights for the statistical sim. `lgRodScore` normalizes by total
weight, so the weights are relative and adding `iq` just makes smartness part of the
OFF/DEF rating mix — light, since decisions sweeten a build rather than carrying it.
`offMix` / `defMix` are the ATT-vs-MID and GK-vs-DEF shares.

**`spend`.** AI upgrade-spend weights per role, giving AI teams position-flavoured builds.
`iq` is weighted toward playmaking rods, where trap and wait-for-sweet-spot pay off most.

### `league.cup`

> This block **must stay inside `league`** — it is read as `CONFIG.league.cup` and
> aliased to `CUP` at the bottom of `config.js`. It once sat one brace too far out, which
> made `CUP` undefined and crashed `cupMakePool` the moment a cup was created.

The cup has its own table/theme/pitch selection, independent of the Premier division's,
so it can be retuned without touching the league. `poolSize` elite "special teams" are
generated once and persisted on `LG`; each cup draws `drawSize` of them (+ the player)
into a single-leg KO. The rest are spares, giving variety between seasons and recurring
rivals.

`pitch` is only the fallback — a tie's pitch is drawn from `pitches` and then remembered
on the tie (`cupVenue`), so the bracket, the tape and the match all agree on it.

---

## `seats`

**`perTeam`.** The ceiling is the **rod count**, not `ai.hands`: a side has 4 rods, so a
5th player would be a hand with nothing to hold. `pickActiveRods` raises a team's
active-rod cap to its seat count whenever the seats outnumber `hands`, so at 4-a-side
every rod is live and the AI plays none of that side — which is why `hands` does not
bound this.

Devices bound it below the rod count in practice: there's one keyboard and one mouse, so
anything past 2 players needs a pad each.

**`maxPads`.** The Gamepad API has no small cap, but XInput on Windows tops out at
**four** pads, so 4 controllers + keyboard + mouse ≈ 6 players is the realistic ceiling
there. Raising this costs nothing — it only widens the token list and the poll loop.

**`tint`.** Two players on the same team can't be told apart by team colour, so each seat
after the first on a side gets an HSL offset from its kit colour: same family, clearly a
different person. Applied to the held-rod marker, the HUD chips and the lobby cards, so
the colour you pick a seat in is the colour that floats over your rod.

Index = the seat's position within its team, and the last entry repeats if there are more
seats than entries. Offsets go through `THREE.Color.offsetHSL`, which clamps s/l and
wraps h, so they're safe against any kit colour. Spread by **lightness** first (it reads
at a glance on a small cone) and hue second; both kit defaults sit at l ≈ .65, which is
why P3 can afford to go down.

---

## `powerups`

A type listed in `models` (and whose GLB loaded) floats as that model; anything else
falls back to the procedural `gem` octahedron, so a missing or broken file is only a
cosmetic downgrade — the pickup still spawns and still collects. GLBs are fetched once at
boot, shader-warmed off-screen, and `clone()`d per spawn: nothing is fetched, built or
compiled mid-match. Collision is unchanged either way — a sphere test against `pickR`,
not the mesh.

`fit` recentres and rescales the model so its bounding-sphere radius is that many world
units (the gem's is ~2.1), which makes the authored Blender scale irrelevant.

---

## `deadball`

"Dead" is measured by **actual travel**, not speed: a ball whose true position stays
inside a `moveEps`-wide box for the given time is dead, even while it still carries
velocity — a ball a player is holding, or spinning against a wall. Speed alone missed
those, and resting on a foot reset the old timer every frame (`collideRod`'s
`S.still = 0`), delaying the whistle.

**`roofMult`.** `physics.js` keeps a solid net roof over the goal box so a lob over the
bar can't score, which means a ball that comes to rest up there is unreachable by every
rod — the same dead air as a corner pocket, and it *looks* more stuck because it's in
plain sight. Tested against the same box physics uses (behind the goal line, within
`goalDepth`, inside the live mouth width, above `goalH`), so it tracks the big-goal widen
automatically.

**`rodGaps`.** A rod's men only strike a band of x around their bar — a good way ahead on
the swing, barely anything behind — so between two rows there's a lane of pitch neither
can play. A ball that stops in one sits there for the full `stallT` while both teams look
at it.

Nothing derives the lane ranges, so widen, narrow, shift or delete any of them freely;
the timer and the debug overlay both follow. The three widths differ for a reason worth
keeping in mind while tuning:

| Row pairing | Lane width | Why |
|---|---|---|
| Facing each other | narrowest | both swing into the gap |
| Same team | medium | one strikes forward into it, the other only back-sweeps |
| Facing away | widest | neither can swing into it at all |

`mult` is deliberately gentler than `zoneMult` — a corner pocket is hopeless, whereas a
lane ball can still be nudged by a rod's raise-and-drop.

**`redrop.sameThird`.** The re-drop lands in the zone whose `from` range contains the x
the ball *died* at, so it returns in the same third it was killed in. Without it, a
random zone was pure profit for whoever was cornered: a keeper or defender could smother
the ball against his own line, take the whistle, and get a 2-in-3 chance of the re-drop
landing further up the table than he could ever have kicked it.

The same rule applies to the restart after a ball goes **out of play**
(`js/balls.js serve`, via `S.serveAt`) — otherwise hoofing it off the table from your own
corner is the identical exploit by another route. A goal kickoff is unaffected and still
drops centre.

---

## `camera`

**`sideModes`** lists the modes whose x is anchored to one end of the table. When every
human is on the same team and that team is **blue**, these mirror (x and lookX negate) so
a blue player gets the same shots from their own end. Without it "RED MID CAM" points a
blue player up the wrong half — which was true of solo blue play long before local co-op
existed.

**`soloOnly`** is the subset with no mirror partner already in the list. 4/5 and 6/7 are
end pairs, so both ends are covered whatever happens; 1 and 8 are red-only, so they drop
out of the V cycle when no single team owns the camera (humans on both sides, or an AI
spectate). One screen with two players facing each other — a one-sided shot can't be made
fair, so it isn't offered.

---

## `audioMix`

Global mixer and voicing rules. The per-*ball* sonic character lives in each ball type's
`audio` block; this is the plumbing every one of them runs through.

- **`limiter`** is the sum-then-squeeze stage: simultaneous hits duck instead of
  clipping. Every game mix has one; without it a six-ball pile-up crunches.
- **`voices`** is a per-sound retrigger cooldown (`gap`, seconds) plus a concurrent cap
  (`max`). Wwise and FMOD ship exactly these two knobs on every event; this is the
  backstop that stops a scramble stacking twenty copies of the same 45ms burst.
- **`jitter`** is ± pitch randomisation per one-shot. Repeating an *identical* transient
  is what makes a burst of contacts read as one synthetic tone; a few percent of spread
  is what makes them read as separate events. Signature sounds — goal horn, whistle, UI,
  countdown — are exempt and should be the same every time.
- **`roll`** is the sustained-contact layer: two permanently-running looping voices
  (floor and wall) at gain 0, driven by how fast a ball travels *along* a surface it's
  touching. `speedMin` is where a roll becomes audible, `speedRef` where it maxes out,
  `curve` < 1 makes it loud early so a slow trickle is still clearly audible. Attack fast
  / release slow, so a probe miss doesn't chop the sound into a rattle. A ball type can
  override `def.*` with its own `audio.roll:{floor:{…},wall:{…}}`.

Per-ball `wall`: `noiseVol` is the level of the quietest tap that still gets through the
`PHY.wallHitSnd` gate; `noiseVolScale` is how fast it grows with impact speed. Keep the
base low and the scale meaningful — that's the difference between a graze and a slap.
`body*` adds a short low thump under hard hits so a slam reads as mass rather than as
more treble.

---

## `ballTypes`

`name` is HUD copy — **keep it emoji-free.** The ball tag colour-codes the type from
`trail` (`setBallTag` in `hud.js`); OS colour emoji can't be tinted and render
per-platform.

**Knuckleball.** Its side-spin is re-kicked to a fresh random value on a short timer
(`stepBall`) so the flight path weaves unpredictably — nasty to read, nasty to trap.
Energy-safe: spin only rotates the horizontal velocity, it never adds speed. It has no
GLB mesh slot, so it renders as its own glowing-cyan sphere (`makeBallModel` returns null
→ sphere fallback).

---

## `ballReflect`

`scene.environment` (the room bake) is a *distant* env — it can't show the table, pitch
or players the ball is actually sitting among. This adds a small cube camera that rides
the lead ball and renders the real scene around it once per throttled frame; its cube
texture is reused as `envMap` on every ball material, so a metallic ball (especially the
golden one) reflects the pitch below it, the walls beside it and the men around it,
tracking as it moves.

Cost = one extra scene pass, with shadows frozen for it. Also gated by the Options
'Reflections' toggle (`cfg.reflections`); off, balls fall back to the room env.
`res` 128 is a good ball-sized balance, 256 is sharper and costlier. `every` 2 is ~30Hz,
invisible lag on a small ball for half the cost.

---

## `rooms`

A **room** is the place you play in — the environment surrounding the table. It's
independent of the table shape and the pitch, so any table + pitch drops into any room.
Populated into the Location dropdown by `ui.js`. Adding a room is one entry here, plus a
GLB under its folder if it has a backdrop.

- **`glb`** — a path that 404s is latched (`models.js roomFailed`) and falls back **once**;
  it isn't re-fetched on every venue change.
- **`backdrop:false`** means nothing stands in when this room's GLB isn't on screen —
  just bg + fog, i.e. a true void. Every other room falls back to the shared ground plane
  + crowd while its GLB loads, or forever if it has none. This used to be accidental for
  the Void room: its GLB path doesn't resolve, and `applyRoom`'s old fallback tested
  `rm.glb` rather than "is a backdrop actually on screen", so a broken path and a
  deliberate void looked identical. Now it's stated.
- **`reflect:true`** bakes the reflection env-map from the GLB — real room reflections on
  metal and gloss. False uses the synthetic `env` panels, which keep metal from rendering
  black and give a cheap coloured ambient. Globally gated by `cfg.reflections`.
- **`lightScale`** — Blender exports watts as candela, roughly 54× the wattage, so ~4e-4
  lands about right. Absent or 0 = 1.
- **`led`** overrides `CONFIG.leds` for this room and sets the LED strip *mood*; the strip
  **mesh** stays the table's.

---

## `fx.lightPool`

How many spare `PointLight`s sit resident (visible, intensity 0) in the scene so a
transient effect glow — fireball, knuckleball, cannonball fuse, explosion, respawn swirl
— can borrow one *instead* of `scene.add`-ing a fresh light.

three.js r128 bakes the scene's light **count** into every material's shader, so
adding or removing a light forces a whole-scene recompile: the hitch you see on a new
ball type, an explosion, or a swirl. A fixed pool keeps the count constant, so that
recompile never happens. Overflow — more simultaneous effects than the pool — just drops
the extra glow, never the count.

Raise it if effects look under-lit in a busy multiball; lower it on a weak GPU, since
each resident light adds a little per-pixel cost even at intensity 0.

---

## `replay`

A flight recorder runs during play: once per fixed sim step it writes every ball's
position and every rod's slide/angle into a preallocated ring buffer — a few dozen float
writes, no allocation, nothing rendered. After the goal celebration the buffered play is
re-posed through ghost balls and the real rod pivots, and shot with a hand-held broadcast
camera easing into slow-mo for the finish. Any key, click or pad button skips. The buffer
is cut on every serve and re-drop so a replay never shows a teleport streak.

`cfg.replay` is the player's in-menu toggle; the config block is the tuning.

**`winner`.** `flow.js` parks the winner in `S.pendingWin` and `replayEnd` hands off to
`endMatch`, so the win screen waits until the replay is done. False cuts straight to the
win screen.

**`roll`.** The recorder stores *position* only, so without this a textured ball slides
through the replay without turning.

### `replay.audio`

The sim is frozen during playback, so nothing fires a sound by itself and a replay used
to run silent under the live crowd bed. The rally's impacts are logged as they happen
(`replay.js` taps `Au` directly — see the sound-recorder block there) and re-fired against
the *footage* clock, pitched down as the replay eases into slow-mo.

`pitch` 0 = normal pitch throughout, 1 = full tape slowdown (a slow-mo strike lands as a
deep thud). `pitchMin` is the floor — below it a hit stops reading as a hit and becomes a
rumble. `goalSting` re-fires the goal horn on the freeze-frame at *normal* pitch, since
that's the celebration landing, not footage. `events` 192: a 7s buffer never gets close,
and overflow just drops the oldest, same as the position ring.

### `replay.save`

The canvas recorder (`js/capture.js`) is armed at the **first frame** of every replay, so
the save key can be pressed at any point — including on the freeze-frame, which is when
you actually know the goal was worth keeping — and still write the *whole* replay out
rather than the tail from the keypress. A recording nobody promoted is discarded on stop.

**The cost:** every goal pays one encode whether or not anyone saves it. Chrome encodes
off-thread, so the main-thread share is the per-frame canvas copy, and it only runs
during the ~5s replay while the sim is frozen. But if a weak machine shows a sag on
replays, this is the first thing to turn off — and the profiler (M) will call it
GPU/BROWSER, not SIM.

Every other key still skips the replay (`input.js`); pad 3 is Y / triangle, while
A/B/Start still skip.

### `replay.shots`

World units. The table walls top out at y ≈ 10, so keep camera heights above that unless
you *want* the wall in frame. `gx` is the beaten goal's end of the table (±60), so x
values given as ×`gx` auto-mirror for whichever goal was scored in. Tweak a number,
reload, score a goal.

---

## `capture`

`MediaRecorder` over the game canvas, plus a second tap off `Au`'s master gain for the
audio track. **Only the canvas** is recorded, so a saved clip carries no letterbox bars,
no REPLAY tag and no HUD — all of that chrome is DOM. Currently driven only by the goal
replay (`replay.save`), but nothing in `capture.js` knows that.

Every step is best-effort: an unsupported browser, a missing codec or a throwing recorder
means no clip, never an exception into the game loop, and one failure disables capture
for the rest of the session.

- `fps` 0 would mean "a frame per composite" and needs manual `requestFrame()` calls to
  produce anything — leave it above zero.
- `bitrate` 12M ≈ 7MB for a 5s clip, deliberately generous: a foosball table in slow-mo
  is all hard edges and fine mesh, which a low bitrate mushes.
- `chunkMs` is the `MediaRecorder` timeslice — small enough that a replay skipped a beat
  after the save key still has data to write.

---

## `PHYS_Q` — physics quality presets

The adaptive substepper subdivides each sim step so a fast ball or foot can't tunnel:

```
sub = ceil(vmax · dt / subTravel), clamped to [subMin, subMax]
```

Fast play pins it at `subMax` and re-runs the full collision pass that many times — the
CPU cost that drops frames on weak hardware when the ball is quick. These presets raise
the target travel-per-substep and lower the ceiling to cut that work.

Even `performance` keeps travel well under `BALL_R` (1.9u), so nothing tunnels; the only
trade is slightly coarser contact resolution on the very fastest shots. `high` is the
tuned default and the shipped feel. `PHY` aliases `CONFIG.physics` (the same object), so
`physics.js` reads these live.

---

## `saveCfg`

A league or cup **venue** (table + skin + room + pitch) can be sitting on the live `cfg`
while a fixture is on screen — it belongs to the league *save*, not to the player — so
whatever `js/league.js` has parked for them (`lgVenueHeld`) is written instead.

Without this, touching any Options control from a league match's pause menu silently
makes that fixture's venue the player's permanent Kick Off choice.

---

## `playerModel`

**`mug`** is the character-select portrait (`mugImg()` in `core.js`, `.czCard` in
`customize.js`). These are predeclared for the whole roster even though only some are
rendered so far — drop the PNG at the listed path and the card picks it up on next load
with no code or config change. A missing file is not an error: the `<img>` `onerror`
leaves the neutral `ICO.figure` mark showing underneath, so an un-rendered figurine
degrades cleanly. The filename stem follows the
`assets/renders/render_<stem>_cycles.png` convention, which does **not** always match the
model id (`womanAndroid` → `jennyBot`, `manrichie` → `richie`).

**`finishes.default`** is special: `authored:true` means "use the material values
exported with the model" — `applyTeamFinish` restores the snapshot taken when the GLB
material was cloned.

**`cacheMax`** caps figurine GLB templates kept resident (LRU). Browsing or customizing
loads a template per figurine; without a cap they all stay in RAM forever. The 2 on the
table are always protected from eviction. Raise it if you see reload hitches when
re-picking.

---

## `training`

Sandbox practice mode (`js/training.js`, the TRAINING card on the main menu): free ball
placement (click the table or type XZ), a repeatable ball launcher, per-team AI on/off,
per-rod show/hide, freeze and single-step, no scoring. The cross-module gate is `S.trn`
(null = off) plus `r.trnHidden`, so the game never depends on `training.js` loading.

`launch.angle` is in degrees: 0 = toward the right goal (+x), 90 = the near side (+z).
Keep `speedMax` at or below the ball's `maxV` or the clamp eats it.

---

## `cfg` — persisted player settings

`gameTime` is the match time limit in **minutes**. 0 = off, unlimited first-to-goals.
5 or 10 = timed: at time-up the team ahead wins, and a tie triggers sudden death (next
goal wins). The `goals` cap still ends a match early if a team reaches it first. Old
saves without the key default to 0.

`diffRed` / `diffBlue` override the legacy single `diff`; both default to `pro` when
missing, so older saves and first-time players still play normally.

**Total Control pad mode** (`padControlMode: 'total'`): LT (analog) eases the slide down
toward `padTCFine` for precision steps, RT pushes it up toward `padTCFast` for fast moves,
and with neither held it sits at `padTCBase` — a middle ground slower than classic full
speed. The right stick still angles the rod on its bound axis; the *other* right axis is
the swerve line, imparting side-spin on ball contact (`padTCSwerve` scales strength,
`padTCSpinInvert` flips direction).

**Display.** `renderScale` multiplies the effective device pixel ratio (0.5 = render at
half-res, upscaled — the biggest fill-rate win on integrated GPUs). `shadows` toggles the
dir-light shadow map pass. `fpsCap` 0 = uncapped, else the target the loop throttles to.
`gfxPreset` is the last-picked preset name, where `custom` means the individual knobs were
touched. `reflections` is shared with Match Setup. Applied by `applyDisplay()` in
`world.js` plus the loop's fps cap.

`layouts` maps screen-id → `{p:{elId:{x,y,w,h}}, h}` from the Layout editor
(`js/layout.js`); missing or empty means the default CSS flow.
