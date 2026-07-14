# Champions Cup — Implementation Plan

## Goal
Add a post-season **Champions Cup** knockout for the reigning **Premier League champion** (the player). It is an 8-team single-leg KO (Quarter-final → Semi-final → Final) played on its **own** table (Arena) + pitch (Neon Nights), against a **persisted pool of ~12 elite "special teams"** (stats ~8–10), of which 7 are drawn per cup (+ the player = 8), leaving 5 spares. Winning grants upgrade parts + a Champions Cup trophy recorded in season history; merely entering grants a smaller participation bonus.

Decisions confirmed with user: 8-team KO · persisted top-tier pool · champ-only / launched post-season · parts + trophy in history.

---

## 1. Config — `js/config.js`
Add `CONFIG.league.cup` (decouples cup table/pitch from the Premier division, answering NOTES.md "which tables/pitches for which division/cup"):
```js
cup:{
  name:'Champions Cup',
  table:'arena', theme:'neon', pitch:'neon',   // its own selection (change here later)
  goals:5, special:true, power:true,            // spectacle on; goals default to league
  poolSize:12, drawSize:7,                      // 12 elite teams, draw 7 + player = 8
  base:8, budget:[20,30],                       // elite build base + weighted spend
  enterParts:2, winParts:8,                     // participation / victory rewards
  rounds:['QUARTER-FINAL','SEMI-FINAL','FINAL'],
  names:[ /* 12 distinct, e.g. NIGHTWATCH, GALACTICOS, VOID RAIDERS, … */ ],
  cols:[ /* 12 distinct hex, clash-checked vs player at draw time */ ]
}
```
Also extend `LGC.upWin`-style reward constants as above.

## 2. Data model — `LG.cup` (persisted via `saveLG`)
```js
LG.cup = {
  season,                 // season it belongs to
  pool:[ {id:'cup0', name, col, model, bld:{GK,DEF,MID,ATT}} ×12 ],  // created once, persists
  round:0,               // 0=QF,1=SF,2=Final
  ties:[ {a,b,res:null,played:false} ×4 → ×2 → ×1 ],  // rebuilt each round
  playerOut:false, done:false, champion:null
}
```
Entrant ids: `'player'` (resolved live from `LG.teams[LG.playerId]` so squad upgrades apply) and `'cupN'` (fixed pool snapshot). Helper `cupEnt(id)` returns `{name,col,model,bld}`.

## 3. League.js changes
- **Migration** (`loadLG`): guard all cup access with `LG.cup &&`; old saves just have no cup. (No schema break.)
- **`lgSim` refactor**: extract `lgSimBlds(A,B)` (body already only uses `.bld` via `lgOff/lgDef`); have `lgSim` call it. Cup reuses `lgSimBlds` with entrant builds.
- **`cupMakePool()`**: if `!LG.cup.pool`, generate 12 elite teams — `lgBld(CUP.base)` then `lgAiSpend` with `up=rand(budget)`, distinct names/cols/figurines, clash-checked vs player colour. Stored once; reused every season.
- **`cupCreate()`**: called when the player wins the Premier. If `LG.cup` already exists & done → start a fresh one (new `season`, redraw). Draw 7 of 12 pool ids + `'player'` = 8, shuffle, pair into 4 QF ties. Award `enterParts` to player's `up`. Set `LG.seasonEnd.shown=true` (so lobby doesn't re-pop the season summary). `saveLG()`.
- **`cupPlayTie()`** (mirrors `lgPlayMatch`): find the current-round tie containing `'player'` & not played; resolve opponent via `cupEnt`. Set `S.lg={cup:true, res:tie, names, cols, prevKit:{…}, banner:'CHAMPIONS CUP · '+CUP.rounds[round]}`; `S.teamStats=[playerBld, oppBld]`; `cfg.special/power` from CUP; `cfg.table/theme/pitch` from CUP → `applyTable/applyTheme/applyColors`; load both figurines; run tape (new `renderCupTape()` mirroring `renderLgTape` on entrant objects) then `startMatch('red', sel)`.
- **`cupRecord(w)`** (called from `endMatch` when `S.lg.cup`): record player's tie result; sim the other ties of the current round via `lgSimBlds`; compute round winners. If player not among winners → `cupAdvance(winners)` to sim the rest to a single champion; `done=true`. Else if `round===2` (Final) → `champion='player'`, `done=true`, award `winParts` + trophy. Else build next round's ties from winners, `round++`. `saveLG()`.
- **`cupAdvance(winners)`**: repeatedly pair→`lgSimBlds`→winners until 1 remains; return champion.
- **`renderCup()` / `openCup()`**: new screen showing 3 bracket columns (QF/SF/Final) with team names/cols/scores, winners highlighted, player's path emphasised; a **PLAY TIE** button when player still in & tie unplayed; result + trophy when `done`; **Back to League** button.
- **`lgSERewards()`**: when `se.playerFate==='champion'`, add an **🏆 ENTER CHAMPIONS CUP** button → `cupCreate()` + `openCup()`. When `LG.cup?.done`, show the cup result/trophy line.
- **`lgWinContinue()`**: if `S.lg&&S.lg.cup` → `openCup()` (instead of league lobby). `cupReturn()` = `gotoMenu();openLeague(true);`.
- **Lobby (`renderLeague`/`openLeague`)**: if `LG.cup && !LG.cup.done`, show a small **🏆 CHAMPIONS CUP** resume button (crash-safety / quit-to-menu mid-cup).
- **History/trophy**: on cup completion add `cup: championName` to the latest `LG.hist` entry; increment `LG.cupTitles` when player wins. (Lobby "titles" count currently tracks Premier wins — leave as-is or add a separate Cup tally; note as optional.)

## 4. flow.js changes
- `endMatch()` (`js/flow.js:63`): branch `if(wasLg){ S.lg.cup?cupRecord(w):lgRecord(w); }`.
- HUD banner: `startMatch` already special-cases `S.lg`; use `S.lg.banner` when present (cup round label) instead of the league round text.
- Win-stats block: detect `S.lg.cup` to show cup-appropriate text (e.g. "CHAMPIONS CUP — ROUND X") instead of league parts line.

## 5. UI — `index.html` + `css/styles.css`
- Add `#championsCup` screen: title, `#cupBracket` container, `#cupPlay` / `#cupBack` buttons (reuse league screen styling).
- Season-end "Enter Cup" button is injected via `lgSERewards` innerHTML (no HTML change needed there), but add its CSS.
- Style bracket (3 columns, score chips, winner glow, player-path highlight).

## 6. Things you may not have considered (surfaced)
1. **Forfeit path** — a cup tie forfeit = 0–5 loss, player eliminated, rest auto-sims (`cupAdvance`). Wire the forfeit screen to `cupRecord` when `S.lg.cup`.
2. **Quit-to-menu mid-cup** — `gotoMenu` already drops `S.lg`; `LG.cup` state persists, so the lobby resume button restores the bracket at the correct round.
3. **Pre-match tape for cup** — `LGC.tape` would call `renderLgTape(op)` reading `LG.teams[op]` and crash for a pool opponent; hence `renderCupTape()`.
4. **Win-screen routing & copy** — Continue must return to the cup, not the league lobby; stats text must not claim league parts.
5. **Re-championship** — winning the Premier again next season must create a *new* cup (fresh draw from the same persistent pool), not reuse a finished one.
6. **Pool variety vs familiarity** — pool of 12 persists; each cup redraws 7, giving both variety and recurring rivals.
7. **Player build is live**, not snapshotted, so squad upgrades bought between ties count in later rounds.
8. **Seeding** — keep it simple: fully random draw; player gets a random QF slot (no special seeding).
9. **AI-only champion** — if the player is *not* the Premier champ, no cup is created/entered (out of scope to run it as a pure spectacle).
10. **Goal count / specials / power-ups** — all configurable in `CONFIG.league.cup` (defaults: 5 goals, specials + power-ups on).

## 7. Validation
- Win the Premier as the player → season-end shows **Enter Champions Cup** → cup screen shows 8 (player + 7 elite, 5 spares unused) in a QF bracket.
- Play QF live on **Arena + Neon Nights**; the other 3 ties sim and the bracket advances.
- Win through to the Final → champion → `winParts` added, trophy written to `LG.hist`, `cupTitles` increments.
- Lose any tie → eliminated → remaining rounds auto-sim to an AI champion; participation bonus retained, no win bonus.
- Forfeit a tie → 0–5, eliminated, rest sims.
- Quit to menu mid-cup → lobby resume button → bracket/round intact.
- Win Premier again next season → brand-new cup from the same pool (fresh draw), old cup marked done.
- Load a pre-cup save (no `LG.cup`) → no errors; cup only appears after a championship.
