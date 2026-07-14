# End-of-Season Screen (League Mode)

## Context
League mode currently has **no** end-of-season screen. When the final player match
finishes, `lgRecord` (js/league.js:328-330) sets `dv.champ` for every division, the
win screen shows, and its *Continue* button routes straight to the lobby via
`lgReturn` (js/league.js:337 → `gotoMenu()` + `openLeague(true)`). Promotion/relegation
and the relegation stat penalty are computed/applied later inside `lgNewSeason(true,…)`
(js/league.js:94-135) when the user clicks *Next Season* — and the penalty is random
with **no record of which stats were removed** (js/league.js:107-117).

Goal: a full-page, arcadey, animated **End-of-Season** screen that plays **immediately
after the final match's win screen** (before the lobby), showing promotion/relegation
for all three divisions, the player's fate, rewards + history, and (if relegated) an
animated breakdown of which stats were lost.

## Confirmed decisions (from user)
1. **Apply the relegation stat penalty at season-end** (not on *Next Season*), so the
   lobby squad already reflects reduced pips and the screen can show a true before/after.
2. **Show the screen every season**, not only for notable player results.
3. **Show rewards + history**: division champions, player final position, upgrade parts
   earned this season (win/loss/clean-sheet/promotion bonuses), and a Champions Cup
   "unlocked" teaser when the Premier League is won. (No new game mode — teaser only.)

## Flow change
```
final match → win screen → [Continue] → NEW #lgSeasonEnd screen → [Continue] → league lobby
```
The season-end screen is a separate full-screen overlay inserted between the win screen
and the lobby. It must also re-appear if the user quits to menu from the win screen and
re-opens the league with a pending season end.

## Implementation

### 1. `js/league.js` — compute & persist season-end (new `lgFinalize`)
Add `lgFinalize()` and call it from the final-round branch of `lgRecord`
(js/league.js:328-330, right after the `LG.divs[t].champ=…` loop):
- Guard with `if(!LG.seasonEnd) lgFinalize();` so it runs exactly once.
- Compute final orders per division with `lgOrderDiv(t)` for t=0..2.
- Derive promoted/relegated name lists using the **same** rules as `lgNewSeason`
  (top `LGC.promoteN` of divs 0/1 promoted; bottom `LGC.relegateN` of divs 1/2 relegated).
- Determine `playerFate`: `champion` (player is div-2 champ), `promoted` (player in a
  promoted set), `relegated` (player in a relegated set), else `stayed`. Also store
  `playerPos` (1-based) and `playerDiv`.
- **Apply the player's relegation stat loss NOW** (only if `playerFate==='relegated'`):
  for each role in `LG_ROLES`, pick a random stat key (same logic as
  js/league.js:111-114), record `{role,key,from,to}` in `seasonEnd.playerLosses`, and
  mutate `LG.teams[LG.playerId].bld[role][key]` down by `LGC.relegateLose` clamped to
  `LGC.relegateFloor`. (This is the penalty that used to happen in `lgNewSeason`.)
- Store `LG.seasonEnd = {season, playerFate, playerPos, playerDiv, divs:[…per-division
  {name,tier,order,champ,promoted:[i…],relegated:[i…]}], playerLosses, shown:false}` and
  `saveLG()`.

### 2. `js/league.js` — stop double-applying the player penalty
In `lgNewSeason` step 3 (js/league.js:108-117), skip the player team so its already-
applied loss isn't randomized again: `if(e.i===LG.playerId) continue;`. At the top of
`lgNewSeason`, after success, clear `LG.seasonEnd=null; saveLG();` so it won't re-show.

### 3. `js/league.js` — render + show the screen
Add `renderLgSeasonEnd()`:
- Build `#lgSeasonEnd` inner HTML:
  - **Title**: `LG.name · SEASON LG.season COMPLETE` (drop/pop animation).
  - **Fate banner**: large colour-coded block — gold `🏆 CHAMPIONS`, green `▲ PROMOTED`,
    red `▼ RELEGATED`, neutral `STAYED IN <div>`, plus `FINISHED #pos`.
  - **Three division cards** (reuse `.lgReveal` stagger): each shows division name,
    `🏆 <champ>` , and a compact final table (pos · team dot+name · W · L · GF · GA · PTS)
    with `▲` on promoted rows (green) and `▼` on relegated rows (red); player's row
    highlighted in `LG.teams[LG.playerId].col`.
  - **Rewards panel**: season record (W–L, GF/GA) computed by scanning
    `LG.divs[playerDiv].results` for the player's fixture across all rounds; upgrade parts
    earned this season = `wins*LGC.upWin + losses*LGC.upLoss + cleanSheets*LGC.upCleanSheet
    + (promoted? LGC.upPromote1/2 : 0) + (champion? LGC.upChampTop : 0)`; current available
    `⚙` parts `LG.teams[LG.playerId].up`; titles count from `LG.hist`; and, if Premier
    won, a `🏆 CHAMPIONS CUP UNLOCKED` teaser line.
  - **Stat-loss panel** (only if `playerFate==='relegated'`): for each role, render the 7
    stats (reuse `lgBuildHTML` pip style / js/league.js:15-27) showing *before* → *after*
    with the removed pip flashing red and draining (CSS animation). Header:
    `▼ RELEGATION — STATS LOST`.
- Trigger: replace `btnWinContinue` binding (js/league.js:645) with `lgWinContinue()`:
  if `LG && LG.seasonEnd && !LG.seasonEnd.shown` → `LG.seasonEnd.shown=true; saveLG();
  showSeasonEnd();` else `lgReturn();`. `showSeasonEnd()` hides `#win`, unhides `#lgSeasonEnd`,
  calls `renderLgSeasonEnd()`, fires `confetti()` (player colour; red `#ff4d5a` if relegated),
  and sets `S.lgChampDone=true` so the lobby doesn't double-confetti (openLeague
  js/league.js:376).
- `#lgSeasonEnd` *Continue* button → `lgReturn()` (gotoMenu + openLeague).
- In `openLeague` (js/league.js:372), if `LG.seasonEnd && !LG.seasonEnd.shown`, call
  `showSeasonEnd()` instead of the normal render (covers quit-to-menu then re-open).

### 4. `index.html` — add the screen
Add after the `#win` block (index.html:294-303):
```html
<div id="lgSeasonEnd" class="screen hidden">
  <div class="lgSEWrap" id="lgSEBody"></div>
  <div class="btnRow"><button class="btn" id="lgSEContinue">Continue ▶</button></div>
</div>
```
Bind `lgSEContinue` in `bindLeague()` (js/league.js:640).

### 5. `css/styles.css` — arcadey full-page styling + animation
Add styles for `#lgSeasonEnd` / `.lgSEWrap` (full width, scrollable, three-column
division grid that stacks on narrow screens), `.lgSEFate` (big glowing banner, colour
variants), `.lgSEDiv` cards, `.lgSEChamp`, `.lgSEPro`/`lgSERel` row markers (reuse the
green/red palette already used by `.lgProZone`/`.lgRelZone` at css/styles.css:281-287),
`.lgSERewards`, and `.lgSELoss` stat rows. Animations:
- title `scorePop`-style entrance (reuse css/styles.css:47),
- division cards staggered `lgReveal` (css/styles.css:223-225) via `animation-delay`,
- `▲`/`▼` pulse keyframes,
- stat-loss pip drain (red flash + scale-to-0) keyframe,
- *Continue* button gentle pulse.
Reuse existing `.confetti` (fx.js:120) and `--gold`/`--c0`/`--c1` vars; set
`--c0`/`--c1` to player/opp colours if helpful for theming.

## Data shown — recap
- All 3 divisions: final table + ▲ promoted / ▼ relegated rows + 🏆 champion.
- Player: fate banner (champion/promoted/relegated/stayed) + final position.
- Rewards: season W–L/GF–GA, ⚙ parts earned this season, current parts, titles,
  Champions Cup teaser if Premier won.
- Relegation only: animated before/after of the stats removed.

## Validation
- Start a league, fast-path a season (sim all but play/forfeit the last match), confirm
  the screen appears after the win screen's *Continue* and shows correct promoted/
  relegated teams for all divisions.
- Force a relegation (drop player stats / low division) → confirm stat-loss panel shows
  the exact removed pips and the lobby squad (after *Continue*) reflects the reduced
  stats; confirm no double penalty on *Next Season*.
- Force a Premier win → confirm Champions Cup teaser appears and `🏆 CHAMPIONS` fate.
- Quit to menu from the win screen, re-open league → season-end screen still shows once.
- After *Next Season*, `LG.seasonEnd` cleared and the lobby pro/rel banner reflects the
  completed season (as today).
- Run lint/typecheck commands if configured for the project before considering done.

## Open / out of scope
- Champions Cup is a **teaser only**; the actual cup mode (NOTES.md) is not built here.
- No changes to match simulation, promotion/relegation *rules*, or save format beyond
  the additive `LG.seasonEnd` field (loadLG already tolerates unknown keys).
