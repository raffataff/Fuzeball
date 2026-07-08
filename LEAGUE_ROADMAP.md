# LEAGUE ROADMAP — next steps for Fuzeball League mode

Handoff doc for the next working session. **Read `CLAUDE.md` first** — it explains the
codebase, conventions, and what League v1 already does. This doc assumes v1 is in place
and specifies exactly what to build next, in priority order, with the design decisions
already made. Where a decision was genuinely open, it's marked **DECIDE** with a
recommended default — pick the default unless the owner says otherwise.

## Ground rules (non-negotiable, from CLAUDE.md)

- Plain non-module scripts sharing one global scope. NO `import`/`export`. Load order
  is the `<script>` list in `index.html`. Keep top-level names unique across files.
- Dense terse style, `'use strict'` per file. New code must be indistinguishable from
  existing code. `config.js` is the exception (commented, spaced).
- Every new tunable number goes in `CONFIG` (config.js), never inline.
- When updating a function, rewrite the WHOLE function, then re-read it in context.
- Verify: concat `js/*.js` in load order through Node `vm.runInNewContext` with stubs
  if the sandbox is up; otherwise careful re-reads + ask owner to check browser console.
- League matches must stay a re-skin of the normal match flow via the `S.lg` bridge —
  do not fork `startMatch`/`onGoal`/`endMatch`.

## Current data shapes (do not re-derive, this is exact)

```js
// localStorage 'fuzeball_league'  (LG in league.js)
LG = {
 season:1,
 round:0,                      // index of the NEXT unplayed round; >= fixtures.length → season over
 teams:[ {                     // index 0 = ALWAYS the player
   name:'ROD RAGE', col:'#ff8c3a',
   bld:{ GK:{spd,str,acc,ctl,rea,sta}, DEF:{...}, MID:{...}, ATT:{...} }, // ints 0..10, base 5
   up:3,                       // unspent upgrade parts
   w:0,l:0,gf:0,ga:0,p:0       // season record (3 pts/win, no draws)
 } ×10 ],
 fixtures:[ [ [a,b] ×5 ] ×9 ], // team-index pairs, circle method
 results:[ [ [ga,gb] ×5 ] ],   // per PLAYED round, aligned with fixtures[r]
 champ:null                    // set to winner's name after the last round
}
// S.lg — live-match bridge, set only during a league match (lgPlayMatch), cleared by gotoMenu
S.lg = { op,                   // opponent team index
         names:[me,op], cols:[me,op],
         rec:false }           // lgRecord() ran (guards double-record)
```

Key invariants:
- Player is team index 0 and always plays live matches as red / team 0.
- `lgPlayerFixture()` returns an element OF `LG.fixtures[LG.round]`; `lgRecord` matches it
  by IDENTITY (`f===fx`). Never clone/map fixtures when touching that path.
- League matches are first-to-`CONFIG.league.goals` — **no draws anywhere**, live or simmed.
- `teamDiff()` forces 'pro' AI brains in league; stat builds are the difficulty.
- Neutral stat 5 = multiplier 1 everywhere (stats.js). Never break this.

---

## Phase A — Opponent scouting (build viewing) — DO FIRST

**Goal:** the player can inspect any team's build before committing upgrade parts or
starting a match. This makes upgrade choices meaningful and is pure UI.

1. **Refactor the pip renderer.** `renderLgSquad()` (league.js) currently renders the
   player build with + buttons. Extract the core into
   `lgBuildHTML(bld, plus)` → returns the 4-role grid HTML; `plus=false` omits/disables
   the `.sPlus` buttons. `renderLgSquad` calls it with `plus=true` and keeps the click
   wiring; the scout panel calls it with `plus=false`.
2. **Scout panel.** New `#lgScout` panel markup in the `#league` screen (a third column
   in `.lgWrap`, or an overlay — prefer a panel that replaces its content in place):
   - Header: team name in team colour + season record (`W-L`, `GF-GA`, pts).
   - OFF / DEF bars: `lgOff(bld)` and `lgDef(bld)` (0–10) rendered as two horizontal
     bars (reuse `.pips` or a simple div-width bar; new CSS class `.lgRate`).
   - Form: last up-to-5 results for that team, newest last, as `W`/`L` letters coloured
     green/red. Derive by walking `LG.results` × `LG.fixtures` backwards from
     `LG.round-1` finding fixtures containing the team index.
   - The read-only build grid from `lgBuildHTML`.
3. **Entry points:**
   - Clicking any row in the standings table scouts that team (`.nm` gets
     `data-i` + cursor:pointer; wire in `renderLgTable`).
   - A small `SCOUT OPPONENT` mini-button (`.miniBtn`) in the Next Match card scouts
     the upcoming opponent directly.
   - Default scout target when the lobby opens: the upcoming opponent.
4. **Tunables:** none needed. **New DOM ids:** `lgScout`, `lgScoutName`, `lgScoutBody`.
5. **Test:** open lobby fresh (no save) → scout shows opponent; click every standings
   row; play a round → form letters update; season complete → scouting still works.

## Phase B — AI team identity: kit colours + figurines on the 3D table

**Goal:** when you play TILT CITY, the opposing rods/men on the table wear TILT CITY's
colour and figurine, not the user's blue kit. Scoreboard/win screen already use league
names+colours; this closes the gap in the 3D scene.

How the kit pipeline works (verified against the code):
- `applyColors()` + `applyFinish()` (world.js) push `cfg.redColor`/`cfg.blueColor` onto
  `teamMat[t]`, `teamGlow[t]`, `playerTeamMats[t]`, `netMats`, and CSS vars `--c0/--c1`.
- `activeModel(team)` (config.js) reads `cfg.modelRed/modelBlue` →
  `loadPlayerModel(onReady)` (world.js, async, cached via `modelCache`) builds
  `playerModel[t]` + `playerTeamMats[t]` → `rebuildRodMen()` swaps men on built rods.
  The customize panel already exercises this whole path at menu time.

**Chosen mechanism — transient cfg override, restore on exit** (avoids touching the
world.js pipeline internals):

1. **Data:** each league team gains `model` (an id from `CONFIG.playerModel.models`).
   - `lgNewSeason(false)`: player team → `cfg.modelRed`; AI teams → random model id.
   - **Migration:** in `loadLG()`, after parse: for each team missing `model`, assign
     (player → `cfg.modelRed`, AI → random). Old saves must keep working.
2. **Colour clash guard:** in `lgNewSeason`, if an AI team's `col` is too close to the
   player's (compare RGB distance, threshold ~90 of 441), reassign from `LGC.cols`.
   Add tiny helper `lgColDist(a,b)` (hex → rgb). Tunable `CONFIG.league.colClash`.
3. **Apply on match start.** In `lgPlayMatch`, before `startMatch`:
   ```
   S.lg.prevKit={blueColor:cfg.blueColor,modelBlue:cfg.modelBlue};
   cfg.blueColor=T[op].col; cfg.modelBlue=T[op].model;      // opponent is always blue/team 1
   loadPlayerModel(()=>{rebuildRodMen();applyColors();startMatch(...)});
   ```
   (`loadPlayerModel` hits `modelCache` for already-seen GLBs, so this is usually
   instant; first load hides behind the count-in.) Do NOT call `saveCfg()` while
   overridden.
4. **Restore on exit.** In `gotoMenu` (flow.js — whole-function rewrite): if
   `S.lg&&S.lg.prevKit`, restore the two cfg fields, then
   `loadPlayerModel(()=>{rebuildRodMen();applyColors();})` before clearing `S.lg`.
   This covers Continue (lgReturn calls gotoMenu), Main Menu from win screen, and
   quit-from-pause, because all exits go through gotoMenu.
   **Watchpoint:** ui.js handlers call `saveCfg()` on menu interactions — restore must
   happen before any menu is visible (gotoMenu does this, keep it that way).
5. **Restart from pause** during a league match re-runs `startMatch` only — override is
   still in place, nothing to do.
6. **Scout panel / standings** (Phase A): show the team's figurine name
   (`CONFIG.playerModel.models.find(m=>m.id===t.model).name`) + ico next to the record.
7. **Test:** league match vs each of several teams → opposing men/handles/net recolour
   and reshape; back to lobby → normal blue kit restored everywhere (check the menu kit
   preview column too); quit mid-match → restored; reload page mid-league → models
   migrate; non-league quick match unaffected.

## Phase C — Forfeit rule (close the retry exploit)

Currently quitting a league match from pause records nothing, so a losing player can
retry a fixture forever. **DECIDE** (recommended: forfeit-as-loss):

- **Forfeit (recommended):** quitting a live league match records it `0–LGC.goals`
  against the player.
  1. In `togglePause`'s screen (or rather the `btnPauseMenu` handler in ui.js): if
     `S.lg`, show a styled confirm overlay `#lgForfeit` ("FORFEIT MATCH? Recorded as a
     0–5 loss") instead of quitting instantly. NO native `window.confirm` — build a tiny
     `.screen` overlay with two `.btn`s (match the pause screen style).
  2. On confirm: `S.score=[0,LGC.goals]; lgRecord(1); gotoMenu(); openLeague();`
     (`lgRecord` reads `S.score` and handles the rest, including simming the round.)
  3. `Restart` in pause stays allowed during league (same fixture, restart from 0–0 —
     that's a mulligan mid-match, acceptable; **DECIDE** if owner wants it blocked).
- Alternative (owner may prefer casual): leave as-is, but grey out nothing — document it
  as a feature ("friendly abandon").

**Test:** forfeit → lobby shows the 0–5 in Last Round, parts awarded (+1), round
advanced; ESC → Resume path unaffected; forfeiting the LAST round crowns a champion.

## Phase D — Upgrade economy depth (escalating costs)

**Goal:** make high stats expensive so builds specialize instead of maxing out.

1. `CONFIG.league.cost=[1,1,2,2,3]` — cost of raising a stat FROM level `5+i`
   (i.e. 5→6 and 6→7 cost 1, 7→8 and 8→9 cost 2, 9→10 costs 3). Below-base levels
   (possible for AI random builds? currently no — builds only go up from 5) cost 1.
   Helper `lgCost(lvl)` in league.js.
2. `renderLgSquad`: + button shows the cost (`+2`), disabled when `up < cost`. Spend
   deducts `lgCost(v)`.
3. `lgAiSpend`: weighted pick must skip stats it can't afford (`t.up>=lgCost(st[k])`),
   and deduct the same cost. Keep the guard-counter pattern.
4. Rebalance payouts to taste: `upWin:3, upLoss:1` may become 4/2 — leave for owner
   feel-testing, just note it in CONFIG comments.
5. **No respec** in v1 (owner hasn't asked; keeps save shape stable).
6. **Test:** costs render, can't overspend, AI teams still spend down to <1 remaining
   part (or all-maxed guard exits), old saves load fine (levels unchanged, only costs).

## Phase E — Lobby & round-reveal polish (game-feel, "not AI-made" pass)

1. **Standings movement arrows:** in `lgRecord`, BEFORE applying results snapshot the
   order (`lgOrder().map(e=>e.i)`), after applying compute each team's rank delta, store
   on the team (`t.rankD`, transient — exclude from meaning anything after next round).
   `renderLgTable` renders `▲ ▼ –` in a new narrow column, green/red/dim.
2. **Last-round reveal:** when the lobby is opened via `lgReturn` (i.e. right after a
   match), stagger-animate the Last Round rows (CSS `@keyframes` fade/slide, animation
   delay per row via inline `style="animation-delay:..."`), and `.pop` the player row.
   Add a `renderLgLast(reveal)` flag; plain open = no animation.
3. **Champion moment:** when `LG.champ` is set and the lobby opens, fire `confetti(0)`
   (fx.js — works outside matches? verify: it appends DOM divs, yes) and render the
   champion line in the fixture card with the trophy + team colour. If the CHAMPION is
   the player, headline `YOU ARE THE CHAMPION`; else `<name> TAKE THE TITLE`.
4. **Sound:** `Au.power()` on part spend (currently `Au.ui()`), `Au.goal()` on opening
   a champion lobby once (guard with a transient flag, not persisted).
5. **ESC handling:** input.js — ESC currently toggles pause in match phases. Add: if the
   league screen is visible and phase==='menu', ESC = back to main menu (same as
   `lgBack`). Check input.js key handling before wiring (search `Escape`).

## Phase F — Pre-match "Tale of the Tape" (flavour, optional but cheap after A)

Before the count-in of a league match, show a 2.5s splash: both team names/colours,
their OFF/DEF bars and figurine names side by side, `ROUND N` underneath. Implement as
a `#lgTape` overlay shown by `lgPlayMatch` for `CONFIG.league.tapeT` seconds before
calling `startMatch` (simple `setTimeout`; skip on click). Reuses Phase A's renderers.
Gate behind `CONFIG.league.tape:true` so it's easy to kill if it annoys.

## Phase G — Season/career depth (v2 — only if owner asks)

- `LG.hist=[{season,champ,playerPos}]` pushed by `lgRecord` when champ is set;
  show past seasons + title count in the scout panel / lobby footer.
- Shuffle fixture order per season (currently identical every season): shuffle a
  team-index permutation when generating fixtures in `lgNewSeason(true)`.
- Named divisions / promotion is OUT of scope until the owner asks.

## Known watchpoints & micro-bugs (fix opportunistically, don't refactor)

- Player team name is snapshotted at league creation; renaming in the menu later
  doesn't update `LG.teams[0].name`. Cheap fix: refresh it in `openLeague()`.
- Player name can collide with an AI team name (cosmetic).
- `rea` has no effect on the user-held rod (user kicks aren't cooldown-gated). Optional:
  gate user kicks with `r.cd=CONFIG.stats.userCd*stCd(r)` on kick — **DECIDE**, default
  skip (owner likes responsive kicking).
- The `results` array only drives the Last Round panel; Phase A's form display starts
  using it — fine, it's complete since v1.
- `#lgSquad` fixed 190px columns can wrap awkwardly at narrow widths; acceptable.

## Verification checklist for ANY league change

1. Fresh boot with `localStorage.clear()` → LEAGUE card → lobby renders, round 1/9.
2. Play a live match to the end (set `CONFIG.league.goals=1` temporarily to speed up —
   remember to revert) → win screen shows parts line + Continue → lobby advanced.
3. Spectate a match (Control: Spectate) → same flow works with `S.userTeam=-1`.
4. Lock-one-row match (Control: MID only) → no rod switching, chips show one rod.
5. Reload the page mid-season → `loadLG` restores; old-shape saves migrate.
6. Finish all 9 rounds → champion, Next Season ▶ carries builds, table resets.
7. Reset League mid-season → fresh teams, player parts = `playerStart`.
8. Quick Match (non-league) before AND after a league match → names, colours, goals
   target, and difficulty all back to `cfg` values; nothing league-ish leaks.
9. Console: zero errors on boot, league open, match start, match end, continue.
10. If you touched flow/rods/ai/physics: re-read the whole edited function; run the
    Node vm concat check if the sandbox boots.
