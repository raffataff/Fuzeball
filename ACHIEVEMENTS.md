# ACHIEVEMENTS — design spec

*Status: SPEC ONLY. Nothing in this document is built. No game code has been changed.*
*Written 2026-08-26. Supersedes FEATURE-IDEAS.md §3.1, which sketched this in six lines.*

---

## 0. The one thing to understand first

A Steam achievement is **two separate things that share a name**, and they are built at
different times by different means:

1. **A row in the Steamworks backend.** An API name, a display name, a description, two
   icons. It lives on Valve's servers. It is not code, you cannot write it from the game,
   and it does not exist until you have paid for an App ID and typed it into a web form.
2. **One line in the game.** `SetAchievement("ACH_SCREAMER")`. That's it. The game does
   not know what the achievement is called, what it looks like, or what it says — it only
   knows the string. Steam's overlay draws the popup, Steam stores the unlock, Steam shows
   it on the profile.

The consequence, and it is the whole reason this doc is structured the way it is: **the
hard part is not the Steam integration.** The Steam integration is ~20 lines and an hour.
The hard part is the game knowing *"the player just scored from inside their own half,
having not conceded, in a league fixture, on Pro difficulty, and not in the sandbox"* —
and that is 100% ordinary Fuzeball code that runs today, in the browser, with no App ID,
no Electron and no Steam.

**So we build the achievement engine as a first-class game feature that happens to be
platform-agnostic, and bolt Steam on at the very end.** Every achievement is earned,
stored, displayed and tested locally. The Steam adapter is a ~20-line file that mirrors
local unlocks up to Valve and is absent from the browser build entirely.

That also means: **nothing in this plan is wasted if Fuzeball never ships on Steam.** An
achievement system is a retention feature in its own right, and the itch.io / web build
gets the whole thing minus the profile page.

---

## 1. What Steam actually requires (the backend half)

Verified against Steamworks documentation, 2026-08-26.

### 1.1 Prerequisites

- **A Steamworks account and an App ID.** Steam Direct, $100 USD per title, recoupable
  against the first $1,000 of adjusted gross revenue. There is no free tier and no way to
  configure achievements without it. This is the only hard money gate in this document.
- The app does **not** need to be released. Achievements can be configured, published and
  tested against an unreleased app.

### 1.2 Per-achievement fields

Configured at **App Admin → Stats & Achievements → Achievement Configuration**.

| Field | Notes |
|---|---|
| **API Name** | e.g. `ACH_SCREAMER`. The primary key, forever. See the warning below. |
| **Display Name** | Localisable. What the popup and profile show. |
| **Description** | Up to 256 characters. Localisable. |
| **Hidden** | Boolean. Hidden achievements show as `???` on profiles until unlocked. |
| **Achieved icon** | Valve recommends **256×256**. |
| **Unachieved icon** | Second image, conventionally the same art desaturated/darkened. |

> **THE API NAME IS PERMANENT.** Rename it after publishing and every existing unlock is
> orphaned — Steam treats it as a brand-new achievement that nobody has, and the old one
> vanishes from profiles. Display names and descriptions can be edited freely and forever;
> API names cannot. Pick them once, pick them boringly, never touch them again. Corollary:
> the API name should describe the *condition*, not the *joke name* — `ACH_WIN_FROM_3_DOWN`
> survives a rewrite of the display name "Houdini", and `ACH_HOUDINI` does not.

### 1.3 Limits and publishing

- **100 achievements by default.** More is unlocked once the app crosses the threshold for
  Profile Features (i.e. after a certain amount of revenue/ownership). Target ~35–45 at
  launch: comfortably under the cap, room to add a tranche per content update.
- Changes are applied through the **Publish** step on the app's admin page, exactly like
  store assets. They are not live until published.
- **Progress bars** are a separate mechanism: define an integer **Stat** in the same admin
  section, associate it with the achievement, and call `IndicateAchievementProgress` at
  milestones (25/50/75%). Optional, and worth doing only for the long-tail counters
  (`ACH_100_GOALS` and friends) where a silent grind feels like nothing is happening.

### 1.4 Testing

Steam client console (`steam.exe -console`), while the game is installed under your App ID:

```
achievement_clear <appid> <ACH_NAME>
reset_all_stats <appid>
```

There is no way to test achievements without a Steam client and the App ID. Which is the
final argument for the local-first engine: **the in-game achievement list is the test
harness**, and it works today.

---

## 2. The wrapper problem (the code half)

Fuzeball is HTML/JS/three.js. Steam ships `.exe`s. Something has to bridge that.

### 2.1 The choice

| Option | Verdict |
|---|---|
| **Electron + [`steamworks.js`](https://github.com/ceifa/steamworks.js)** | **Recommended.** Prebuilt native binaries, `npm i steamworks.js`, no compiling the Steamworks SDK by hand. Actively maintained. The overlay works. Biggest install size (~150–200MB) — irrelevant next to Fuzeball's own GLB/KTX2 assets. |
| NW.js + `greenworks` | The old answer. Greenworks is effectively unmaintained. Don't. |
| Tauri + `steamworks-rs` | Much smaller binary, uses the OS webview — which means **the player's system WebView2/WebKit version renders your game**. For a three.js title that is a compatibility surface you do not want to own. Reconsider only if install size becomes a real complaint. |

### 2.2 Why the current loader is already Steam-ready — and the one thing that isn't

`CLAUDE.md` already commits to plain non-module scripts sharing one global scope
specifically so the game runs from `file://`, http(s) **and an Electron wrapper alike**.
That call was correct and it is why this is cheap. The boot array in `index.html` needs one
extra line and nothing else.

**But there is a live security problem waiting in the wrapper build.** `index.html`'s boot
list falls back to remote CDNs when a local vendor file is missing:

```js
{srcs:['vendor/three.min.js','https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js']},
{srcs:['vendor/GLTFLoader.js','https://cdn.jsdelivr.net/npm/three@0.128.0/...']},
```

In a browser that is a sensible resilience fallback. In an Electron build with
`nodeIntegration:true` (which is what `steamworks.js`'s simplest setup asks for) it is
remote-code-execution on the player's machine if either CDN is ever compromised or
DNS-hijacked. Two mitigations:

1. **~~The Steam build must vendor every dependency locally and strip the CDN
   fallbacks.~~ — DONE 2026-08-26, ahead of the rest of this plan.** `CDN_FALLBACK` in
   `index.html`'s loader is now `false` for every build: the second entry of each
   `{srcs:[...]}` is documentation of the pinned version and is never a load path. The
   Google Fonts `<link>` is gone — fonts are self-hosted from `vendor/fonts.css`.
   `tools/fetch-vendor.ps1` now fetches all four JS libs (it was missing `WorkerPool.js`
   and `KTX2Loader.js`) and guards the hand-pinned Basis transcoder. `node
   tools/offline-harness.js` asserts the whole property, including that every font family
   `css/styles.css` asks for has a local `@font-face` behind it — the check that caught
   `vendor/fonts.css` still shipping Orbitron months after the game moved to Russo One.
2. **Use `contextIsolation:true` + a `preload.js` + `contextBridge`**, exposing exactly
   `{unlock(id), isUnlocked(id), ready}` on `window.steamAch`. Never expose `require`.
   This costs about fifteen extra lines over the `nodeIntegration:true` route and closes
   the hole permanently. **Still to do — it lands with the wrapper in phase 7.**

### 2.3 Other wrapper-time considerations, noted now so they aren't surprises

- **`localStorage` persists in Electron** under the app's userData dir, so the career store
  (§4) survives without change. But it is *per-install*, so a player moving machines loses
  everything unless Steam Cloud is configured — and Steam Cloud wants real files, not
  localStorage. Fix at wrapper time by having the adapter mirror the career blob to a JSON
  file in `app.getPath('userData')` and registering that path for Auto-Cloud.
- **Steam Deck / Proton.** Electron under Proton is a well-trodden path but not free. Budget
  a controller-mapping pass — Fuzeball's pad handling is already deep (`cfg.padControlMode`,
  Total Control, per-axis sens) which puts it ahead of most, but Deck defaults still need
  authoring.
- **`steam_appid.txt`** next to the executable during development lets you init without a
  full Steam install path. Never ship it.

---

## 3. Architecture

```
                     ┌──────────────────────────────────────┐
   game events ─────►│  js/ach.js        THE ENGINE         │
   (goal, save,      │  · achEvent(kind, ev)                │
   match end,        │  · career counters                   │
   trial end,        │  · rule evaluation                   │
   season end)       │  · achFire(id) → queue → popup       │
                     └───────┬───────────────────┬──────────┘
                             │                   │
                 ┌───────────▼──────┐   ┌────────▼───────────────┐
                 │ localStorage     │   │ js/ach_steam.js        │
                 │ 'fuzeball_career'│   │ ADAPTER — Steam build  │
                 │ counters+unlocks │   │ only. Absent on web.   │
                 └──────────────────┘   └────────┬───────────────┘
                                                 │
                                        window.steamAch.unlock()
                                                 │
                                          Steamworks / Valve
```

**One rule, and it is the load-bearing one: nothing outside `js/ach.js` and
`js/ach_steam.js` may know that Steam exists.** `flow.js` calls
`achEvent('goal', {...})`. It does not know whether that ends up in a profile page. If the
adapter is missing — which it is, in every browser build — `achFire` simply stops after the
local store and the popup, and the whole feature still works.

### 3.1 New files

| File | Size est. | Purpose |
|---|---|---|
| `js/ach.js` | ~250 lines | Engine: career store, event intake, rule evaluation, unlock queue, the popup. |
| `js/achui.js` | ~150 lines | The `#achievements` screen — grid, progress bars, completion %. Split from the engine so the engine has no DOM dependency beyond the popup. |
| `js/ach_steam.js` | ~40 lines | Adapter. **Not in the web boot list.** Appended by the Electron build only. |
| `CONFIG.ach` in `config.js` | ~200 lines | The table. Human-editable, one row per achievement. |
| `assets/ach/*.png` | 2 × N | Icons, 256×256, achieved + locked. |

### 3.2 Boot order

Insert into the `boot` array in `index.html` **immediately after `js/matchstats.js`**:

```js
'js/core.js','js/config.js','js/rng.js','js/screens.js','js/intro.js','js/arena.js','js/audio.js',
'js/state.js','js/stats.js','js/moments.js','js/matchstats.js','js/ach.js',
'js/seats.js','js/world.js', ... ,'js/hud.js','js/ui.js','js/achui.js','js/roster.js', ...
```

`ach.js` needs `CONFIG` and `cfg` (config.js) and `S` (state.js) resolved at top level, and
must be defined before `flow.js` calls into it. `achui.js` goes beside `ui.js` because it
is DOM wiring. Registering `#achievements` in `SCREENS` costs one line in `screens.js`.

---

## 4. The career store — and why it does NOT live in `cfg`

FEATURE-IDEAS §3.1 said "persist in `cfg`". **That is the wrong call and this spec
overrides it.** Three reasons, in ascending order of how much they'd hurt:

1. `cfg` is rewritten by `saveCfg()` on every slider drag in Options. Threading a growing
   career ledger through that makes every UI interaction serialise a blob that has nothing
   to do with it.
2. A "reset settings" path — which this game will eventually want — would silently delete
   the player's entire achievement history.
3. **The one that actually matters at Steam time:** `cfg` contains
   `renderScale`, `fpsCap`, `shadows`, `gfxPreset`, `physQuality` — *per-machine* settings.
   The career is *per-player*. Steam Cloud syncing them as one blob would push a gaming
   rig's `renderScale:1 / shadows:true` onto the player's Steam Deck. They must be separable
   at the file level before Cloud is ever switched on.

So: its own key, mirroring the pattern `league.js` already uses for `fuzeball_league_<slot>`.

> **This is now done — the split landed 2026-08-26, ahead of the rest of this plan.** `cfg`
> persists as `fuzeball_player` + `fuzeball_machine` (see the PLAYER/MACHINE block in
> `config.js`), and `cfgSyncKeys()` there is the Steam Cloud manifest. **`fuzeball_career` is
> already listed in it**, so when phase 1 creates the store it is synced from the first line of
> code rather than needing an amendment nobody remembers to make. `tools/savesplit-harness.js`
> asserts no machine key can reach the synced blob.

```js
/* ---- career store (js/ach.js) --------------------------------------------------------
   Its own localStorage key, NOT cfg — see ACHIEVEMENTS.md §4. cfg holds per-MACHINE
   display settings; this holds per-PLAYER history, and Steam Cloud has to be able to sync
   one without the other. */
const ACH_KEY='fuzeball_career';
let CAR={v:1,ach:{},c:{}};   // ach: id -> unlock timestamp (ms) · c: counter name -> number
try{Object.assign(CAR,JSON.parse(localStorage.getItem(ACH_KEY)||'{}'));}catch(e){}
if(!CAR.ach||typeof CAR.ach!=='object')CAR.ach={};
if(!CAR.c  ||typeof CAR.c  !=='object')CAR.c  ={};
function saveCareer(){try{localStorage.setItem(ACH_KEY,JSON.stringify(CAR));}catch(e){}}
```

**`ach` maps id → unlock timestamp rather than id → true.** Costs nothing, and buys a
"recently unlocked" sort in the UI, a "you've unlocked 4 this session" line, and the ability
to answer "when did I get this" — all of which are free now and expensive to retrofit.

### 4.1 Counters

`CAR.c` is a flat `name → number` map, deliberately schemaless so adding a counter is one
line in `ach.js` and never a migration. Proposed starting set:

```
matches  wins  losses  goals  conceded  cleanSheets  ogs
saves  woodwork  shots  onTarget  passes  kicks  dist
sdWins        · sudden-death wins
comebacks     · won after trailing by 2+
lgSeasons  lgTitles  lgPromotions  cupWins
trialGolds  dailyStreakBest
tables{}  rooms{}  balls{}   · sets-as-maps, for the "played every X" family
```

Everything above `sdWins` is already computed per match by `matchstats.js` — the career
store just adds them up once at `endMatch`. **No new bookkeeping in the sim.**

### 4.2 Save cadence

`saveCareer()` fires at **match end, trial end, season end and on unlock** — never per goal
and never per frame. A tab closed mid-match loses that match's counters, which is correct:
an abandoned match shouldn't have counted anyway (§7.3).

---

## 5. The achievement table

`config.js` is the human-tuned file, so the table lives there — same reasoning that put
`CONFIG.trials.list` there. But trials use a small **declarative** objective vocabulary
(`{kind:'goals',n:3}`), and achievements are too varied for that to stretch. So: **hybrid**.

```js
/* =========================================================================
   ACHIEVEMENTS. One row per achievement. See ACHIEVEMENTS.md.

   id     PERMANENT. This string becomes the Steam API name verbatim and can
          NEVER be changed after the app is published. Describe the CONDITION,
          not the joke name.
   name   display name · desc  description (≤256 chars, Steam's limit)
   icon   basename in assets/ach/ — `<icon>.png` + `<icon>_off.png`
   cat    UI grouping only: 'start'|'craft'|'keeper'|'league'|'trials'|'long'|'fun'
   hidden true = ??? on the profile until earned. Spoilers and jokes only.

   Then EXACTLY ONE of:
   stat + n   counter threshold. Fires when CAR.c[stat] >= n. Re-checked at
              boot (achAudit), so adding one of these retroactively grants it
              to players who already passed the bar. THE DEFAULT — reach for
              this first, it needs no code.
   code       key into ACH_CODE in js/ach.js. Bespoke. Use only when a counter
              genuinely cannot express it.

   Optional gates, ANDed:
   mode   'match'|'league'|'cup'|'trial'|'daily'  · minDiff  'am'|'pro'|'legend'
   ========================================================================= */
ach:{
 on:true,
 popup:{dur:3.6,gap:0.9,queueMax:8},   // see §8.1 — there is no 'show it anyway on Steam' flag
 list:[
  {id:'ACH_FIRST_GOAL', name:'OFF THE MARK', desc:'Score your first goal.',
   icon:'first_goal', cat:'start', stat:'goals', n:1},
  {id:'ACH_100_GOALS', name:'CENTURION', desc:'Score 100 goals.',
   icon:'goals100', cat:'long', stat:'goals', n:100},
  {id:'ACH_OWN_HALF', name:'FROM DOWNTOWN', desc:'Score from inside your own half.',
   icon:'own_half', cat:'craft', code:'ownHalf'},
  {id:'ACH_ALL_FOUR', name:'FULL TEAM EFFORT', desc:'Score with all four rods in one match.',
   icon:'all_four', cat:'craft', code:'allFour', mode:'match'},
  // ...
 ]
}
```

**There is deliberately no `onSteam` toggle in that block.** Under Steam the overlay draws
its own achievement popup, and Fuzeball must not draw a second one — see §8.1. That is a
hard branch in `achPop`, not a default a build can get wrong.

---

## 6. Hook points — every one of these already exists

This is the part that makes the whole feature cheap. Fuzeball already funnels every
interesting event through a small number of named functions. The engine needs **six call
sites**, all one-liners.

| # | Site | File | Fires |
|---|---|---|---|
| 1 | `onGoal(team,b)` | `flow.js:212` | `achEvent('goal',{team,b,kind,own,speed,from})` |
| 2 | `endMatch(w)` | `flow.js:282` | `achEvent('match',{w,score:S.score,st:S.stats,lg:!!S.lg})` |
| 3 | `momSave(sp)` | `moments.js` | `achEvent('save',{team:sp.team})` |
| 4 | `trialFinish(ok)` | `trials.js:239` | `achEvent('trial',{id,ok,secs,medal,daily})` |
| 5 | `lgFinalize()` | `league.js` | `achEvent('season',{fate,pos,div,titles})` |
| 6 | `cupRecord(w)` | `league.js` | `achEvent('cup',{champ,round})` |

Detail that matters for each:

**1 — `onGoal`.** Already computes everything a "craft" achievement wants, for free.
`momGoal()` returns `{sub,col,kind}` where `kind` is one of
`ownGoal · woodwork · curler · screamer · topBins · longRange · deflected · scrappy ·
default` — that is nine achievements' worth of classification already written, tested and
tuned. `b.shot` carries the striking contact's position, so "from your own half" is
`Math.sign(b.shot.x) !== dir`. `b.v.length()` at the line is the shot speed. **Place the
`achEvent` call after `momGoal`/`msGoal` and before `removeBall(b)`** — the same constraint
those two already document, because `removeBall` frees the mesh and the per-ball records.

**2 — `endMatch`.** The single most valuable hook. `S.stats` at this instant is the complete
match ledger (`kicks poss topSpeed saves woodwork shots onTarget passes hardest dist terr
rally longRally scorers rods{}`), and `st.rods['0|ATT']` etc. give per-rod goals. Almost
every "in one match" achievement is a read of this object and nothing else — no new
tracking anywhere. **This is also where career counters are accumulated and
`saveCareer()` is called.**

**3 — `momSave`.** `moments.js` already detects keeper saves and increments
`S.stats.saves[team]`; the achEvent is just for the "spectacular save" family that needs the
*moment* rather than the count.

**4 — `trialFinish`.** Gives id, medal, seconds and whether it was the daily. Both
`cfg.trials[id]` and `cfg.daily` are already there for "gold on everything" and streak
achievements. This closes the "feeding achievements — not wired" item left open in
FEATURE-IDEAS §3.2.

**5/6 — league/cup.** `lgFinalize` already computes `fate` as
`champion|promoted|relegated|stayed`, plus position, division and `LG.hist` for
back-to-back titles. `lgSeasonEarn()` computes season W/L/GF/GA/clean sheets. Every league
achievement is a read of `LG.seasonEnd`.

### 6.1 Performance — the non-negotiable

The project is aggressive about the hot path and this feature must not touch it.

- **No achievement code in `stepBall`, `updateRods`, `collideRod`, or anything called per
  substep, per sim step or per frame.** Not one line.
- All six hooks are on events that happen at most a handful of times a match.
- "But I want an achievement for a 30-second rally" — `S.stats.longRally` is *already*
  maintained by `matchstats.js`. Read it at `endMatch`. Same for `topSpeed`, `dist`,
  `terr`. **If a condition needs per-frame data, the answer is always "the ledger already
  has it", never "add a counter to the loop".** If the ledger genuinely doesn't have it,
  that is a `matchstats.js` change with its own justification — not an achievements change.

---

## 7. The traps — Fuzeball-specific

These are the things that will otherwise ship broken. Every one of them is a real path
through the existing code.

### 7.1 Training and the dev tools must not count

`onGoal` already early-returns into `trainingGoal` when `S.trn` is set, so the sandbox is
mostly safe by accident — but `momOn()` deliberately treats **a trial as a live match**, and
training mode lets the player place the ball anywhere and freeze/step the world. A single
gate at the top of the engine:

```js
/* THE VOID GATE. One place, checked by achEvent before anything else. A session that has
   touched a dev tool or the sandbox cannot bank a match achievement — placing a ball two
   units off the line and freezing time is not 'scoring from your own half'. Trials are
   the deliberate exception: they are a pinned, seeded, reproducible run and they have
   their OWN achievements (mode:'trial'), so they pass with the trial gate rather than the
   match one. */
function achVoid(){
 return !!(S.photo||S.redit)            // F1 promo studio · F2 room editor
     || (S.trn&&!S.trial)               // free-play sandbox, but a trial is fine
     || S.userTeam<0                    // AI showdown — nobody is playing
     || !S.seats.length                 // ditto, no human at the table
     || ACH.sessionVoid;                // set by any cheat/debug path that alters the sim
}
```

`ACH.sessionVoid` is latched, never cleared until the next `startMatchNow`. Any future
debug lever that changes the sim (force-goal, teleport ball, god-mode rods) sets it in one
line and is then permanently accounted for.

### 7.2 The league simulates the divisions you are not in

`lgRecord(w)` runs `lgSim()` over **every fixture in every division** including the two the
player is not in, then `lgApply`s all of them. Any achievement that reads league results
must filter on `LG.playerId` / `playerDiv()`. Credit a simulated 7-0 in the third division
to the player and the bug will look like the achievement is simply broken at random.

Similarly `lgFinalize()` computes `champ` for all three divisions — `divs[t].champId` is
only the player when `t === playerDiv()` and `champId === LG.playerId`.

### 7.3 The win screen is not the end of the match

`endMatch` can be reached three ways: goal target hit, clock expiry, and `finishPendingWin`
after the winner's replay. It is also **not** reached when the player quits to menu
mid-match (`gotoMenu`). That is correct — an abandoned match should count for nothing — but
it means counters must be accumulated *at* `endMatch` and not incrementally during play, or
a player could farm `goals` by scoring once and quitting, forever.

`S.lg.rec` already guards `lgRecord` against double-recording. The engine needs the same
shape: a `S.achRec` flag set in `endMatch`, because a forfeit path could plausibly reach it
twice.

### 7.4 Own goals

`momKind` returns `'ownGoal'` when the last contact was a swing by the conceding side, and
`onGoal` still credits the *scoring* team. So `goals` must be incremented from
`S.stats.rods[...]` (which separates `goals` from `og`) and not from `S.score`, or the
player banks a Centurion out of their own net. There should absolutely also be an
`ACH_OWN_GOAL` — self-deprecating achievements are free goodwill — but it must be a
different counter.

### 7.5 Difficulty

`cfg.diffRed`/`cfg.diffBlue` are per-team and independently settable, which means a player
can set their *own* team to Legend and the opponent to Amateur. Any `minDiff` gate must read
the **opponent's** difficulty (`S.userTeam===0 ? cfg.diffBlue : cfg.diffRed`), not `cfg.diff`
(which is a legacy alias for `diffRed`). Getting this backwards makes the hardest
achievements the easiest ones.

### 7.6 Seeded runs

`js/rng.js` gives per-consumer seeded streams and `S.seed` records the seed a match ran on.
That is a gift: **an achievement can name the run that earned it** ("earned on seed
4417739"), and a trial achievement is genuinely reproducible. It is also a hazard — if the
daily's seed is derived from the date, an achievement for "gold on the daily" is a different
difficulty every day. Prefer streak/count achievements for the daily over medal ones.

### 7.7 Tamper

The career store is a JSON blob in localStorage. It can be edited in ten seconds with
devtools. **Do not build anti-tamper.** FEATURE-IDEAS already made this call for the daily
("no tamper-proofing — it is a number in localStorage and pretending otherwise would be
theatre") and it applies here identically. On Steam, the authority is Steam's copy anyway.

### 7.8 The reconcile problem, at Steam time

Once the adapter exists there are two stores that can disagree — local and Valve's — because
the player may have played the browser build, or played offline, or the write to Steam
failed. At init, the adapter reconciles **both directions**:

- local-unlocked but Steam-locked → push it up (`SetAchievement` is idempotent)
- Steam-unlocked but local-locked → mark it locally, silently, no popup

Never resolve by clobbering. Never popup on reconcile — a player launching the Steam build
for the first time after a browser save should not be hit with thirty popups.

### 7.9 Retroactive grants

`achAudit()` runs every counter-threshold rule against `CAR.c` at boot. Two jobs: it grants
achievements added in a later patch to players who already passed the bar (the alternative
is a player with 400 goals never getting Centurion because it shipped after they earned it),
and it self-heals a missed unlock. It must run **silently** on the first boot after an
update — batching thirty popups is worse than none — but a single summary toast
("3 achievements unlocked — see ACHIEVEMENTS") is right.

---

## 8. Presentation

### 8.1 The popup is a fourth notification tier

`fx.js` documents three deliberately non-interchangeable channels:

- `banner(main,sub,dur,col)` — tier 1, stop-the-world: kickoff, goal, sudden death, full time
- `notice(main,dur,col)` — tier 2, a live event the player already saw
- `toast(main,sub,dur)` — tier 3, system/dev chatter, small, bottom-left

An achievement fits none of them. `banner` is wrong — it would collide with the goal banner
that fired the achievement in the first place, at the exact same moment. `toast` is wrong —
this is the Steam-facing moment, it deserves art and weight. So: **`achPop(a)`, a fourth
channel**, right-hand side, with the icon, mirroring where Steam's own overlay draws so the
two read as the same object.

Four requirements, and the first one outranks the rest:

0. **ON STEAM THE IN-GAME POPUP DOES NOT EXIST.** Not hidden, not transparent, not drawn
   underneath the overlay — **not built, not queued, not ticked**. Steam's overlay is the
   popup on that platform, full stop. Two popups for one unlock reads as a bug even when
   one of them is occluded, and a hidden-but-live popup is worse than a visible one: it
   still holds the queue, still swallows the gap timer, still fights the goal banner for
   the tier-1 yield, and none of that is visible to whoever is debugging it later.

   So the gate is at the top of `achPop`, and it is the *adapter's presence* that decides —
   not a config flag a build could ship wrong:

   ```js
   /* THE IN-GAME POPUP IS THE FALLBACK, NOT THE DEFAULT. If js/ach_steam.js is loaded, Steam's
      overlay owns this moment and we draw nothing at all — no element, no queue entry, no
      timer. A popup rendered behind the overlay is not "harmless": it still consumes the
      queue and still contends for the banner yield, and it is invisible to anyone trying to
      work out why the pacing is wrong. There is deliberately no CONFIG flag to override
      this; the adapter's presence IS the switch. */
   function achPopOn(){return !(typeof steamAchReady==='function'&&steamAchReady());}
   ```

   Everything else in this section describes the **non-Steam** popup: the web/itch build, and
   development and testing of the Steam build before the adapter is wired. Those still need
   it, which is exactly why it stays a full feature rather than a debug `console.log`.

1. **Queued, not stomped.** Scoring the winner from your own half in a sudden-death
   comeback could unlock four at once. `CONFIG.ach.popup.gap` spaces them; `queueMax`
   caps the backlog and a `+3 more` line absorbs the rest.
2. **Yields to tier 1.** If a banner is showing, the queue waits. The goal is the event;
   the achievement is the footnote.
3. **Never during a replay.** `replayStart`/`replayEnd` bracket the instant replay — hold
   the queue across it. A popup over the replay of the goal that earned it looks like a
   mistake even though it's technically correct.

**The `#achievements` screen (§8.2) is NOT covered by rule 0 and must never be.** It is the
game's own list, it shows progress bars Steam has no concept of, and it is the only way a
player on the web build ever sees any of this. Steam replaces the *notification*, not the
*feature*.

### 8.2 The `#achievements` screen

Register in `SCREENS` (`screens.js`) — one line, `{back:'home'}` — and add a `#home` card.
Because the router is already generic, this is genuinely all the navigation work there is.

Contents: a completion header (`14 / 38 · 37%`), category tabs matching `cat`, and a grid of
cards. Locked cards show the icon desaturated; `hidden:true` locked cards show `???` and no
description. Counter-based rules get a progress bar straight from `CAR.c[stat] / n` — which
is the single highest-value thing on the screen, because it converts "a list of things I
haven't done" into "a list of things I'm 60% through".

Add a `lay` block so the panels are drag/resizable like every other screen — it is free
(`layApplyScreen` runs on every show) and consistent.

### 8.3 What this unlocks next

FEATURE-IDEAS §3.5 wants unlockable content (7 table skins, 3 rooms, pitches, figurine
finishes are all just *available* today). Once `CAR.ach` exists, gating is a `locked` flag
in the `CONFIG.tables`/`CONFIG.rooms` registries plus one predicate. Worth designing the
achievement list *knowing* that — a handful of them should be the natural gates for the
best-looking content, so `customize.js` becomes a reward screen. **But do not build the
gating in the same pass**; ship achievements standalone first, or a bug in one hides content
in the other.

---

## 9. The list — a starting frame

Not final. This is a skeleton to slot your ideas into, with each row marked by what it
would actually cost. **Bring your list and we'll triage it into these three columns.**

- **FREE** — the data is already in `S.stats` / `momKind` / `LG`. Pure config row.
- **COUNTER** — needs one new line in `CAR.c`, accumulated at `endMatch`.
- **CODE** — needs a bespoke `ACH_CODE` function.

| Category | Example | Cost |
|---|---|---|
| **Start** (5) | first goal · first win · first clean sheet · first league match · first trial | COUNTER |
| **Craft** (10) | from your own half · screamer over X km/h · top bins · a curler · off both posts in one rally · all four rods score · a hat-trick from one rod · win without conceding · score in the last 5 seconds · win in sudden death | FREE (`momKind` + ledger) |
| **Keeper** (4) | 10 / 100 / 500 saves · a save with the score level in the final ten seconds | COUNTER + CODE |
| **Comeback** (3) | win from 2 down · from 3 down · from 3 down in the final minute | CODE |
| **League** (8) | promote · win a division · win the Champions Cup · back-to-back titles · an unbeaten season · reach the Premier · beat the champions · a full season without conceding more than X | FREE (`LG.seasonEnd` + `LG.hist`) |
| **Trials** (5) | first gold · gold on every trial · a 7-day daily streak · 30-day streak · beat a gold by 50% | FREE (`cfg.trials`/`cfg.daily`) |
| **Long tail** (6) | 100 goals · 1,000 kicks · 100 matches · 10km of rod travel (`st.dist`!) · 50 clean sheets · 24h played | COUNTER |
| **Discovery** (4) | play on every table · every room · every pitch · use every ball type | COUNTER (map) |
| **Fun / hidden** (4) | score an own goal · lose 10-0 · hit the woodwork five times in one match · take a photo in photo mode | FREE, `hidden:true` |

≈ **49 candidates → cut to 38.** Design rules worth holding to:

- **No achievement that requires another human.** Fuzeball is local-multiplayer; anything
  needing a second player is unearnable for most owners and drags the global completion
  rate down, which is visible on the store page.
- **Nothing that can be lost.** Achievements are monotonic. Ever.
- **No pure-RNG achievement.** "The ball hits both posts and the bar" is skill-adjacent and
  fine; "the power-up spawns three times in a row" is a slot machine.
- **No grind wall.** One or two 20-hour achievements is dedication; six is a chore, and the
  0.2% global rate tells every prospective buyer the game is a job.
- **Hidden is for spoilers and jokes only.** A hidden achievement the player cannot even
  aim at is a worse feature than no achievement.
- **Ship nothing you have not personally earned in a real session.** The 337-assertion
  harness cannot tell you whether "score from your own half" is *possible* with the current
  kick power. FEATURE-IDEAS already learned this the hard way with trial medal thresholds:
  *"every medal threshold is an unplayed first-cut guess"*. Do not repeat it here.

---

## 10. Build order

Each phase is independently shippable and independently valuable.

| Phase | Work | Gate |
|---|---|---|
| **0** | This document. | ✅ done |
| **1** | `js/ach.js` — career store, `achEvent`, the void gate, `achFire`, `saveCareer`. Six hook call-sites. **10 achievements**, no icons, `toast()` as the placeholder popup. | Play a match, see a toast, reload, still unlocked. |
| **2** | `achPop()` — the fourth notification tier, queued, yielding to banners and replays. | Score four things at once, watch them queue politely. |
| **3** | `js/achui.js` + `#achievements` screen + `#home` card + progress bars. | The list is legible with zero unlocks and with all of them. |
| **4** | Full table (~38) + icons (2 × 38 @ 256×256). **Play-test every single one.** | Every achievement earned once by hand. |
| **5** | `achAudit()` retroactive pass + the "recently unlocked" sort. | Add a new achievement to the table, reload, it grants correctly. |
| **6** | *Optional, separate:* unlock gating for tables/rooms/finishes (FEATURE-IDEAS §3.5). | — |
| **7** | Electron wrapper: ~~local vendoring, CDN fallbacks stripped~~ (**done 2026-08-26**), `contextIsolation` + preload, `steamworks.js`. | The game runs as an `.exe`. |
| **8** | App ID, Steamworks rows, icons uploaded, publish. `js/ach_steam.js` + reconcile. | `achievement_clear` round-trips. |

**Phases 1–5 need no money, no App ID, no Electron and no Steam.** They are worth doing on
their own merits even if Steam never happens. Phases 7–8 are a weekend once 1–5 are solid.

---

## 11. Open questions

1. **Icon art.** 76 images at 256×256 is the single biggest non-code cost in this plan.
   Fuzeball's look is strong and hand-authoring 38 pieces of art is real work. Options: a
   templated system (one frame + a silhouette per achievement, generated), or renders from
   the game itself using the existing F1 photo-mode rig — which would look better than
   anything drawn and is a genuinely novel use of a tool that already exists.
2. **How much should be hidden?** My default is 4 of 38.
3. **Difficulty gating.** Should the craft achievements require Pro+? It stops Amateur
   farming, but it also means a casual player sees a permanently locked third of the list.
   My lean: gate two or three marquee ones, leave the rest open.
4. **Does the browser/itch build show achievements?** My lean: yes, identical, minus the
   profile page. It costs nothing and it is a retention feature there too.
5. **Your list.** The frame in §9 is a skeleton — bring your ideas and we'll triage each into
   FREE / COUNTER / CODE. My guess is 70% land in FREE, because `momKind` and the match
   ledger are already doing far more work than a game without achievements needs.

---

*Nothing here is built. Next step is Phase 1, which is roughly a session's work and touches
six existing lines.*
