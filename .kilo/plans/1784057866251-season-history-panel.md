# Season History panel — simplification

## Problem
`renderLgHist()` in `js/league.js:509-523` currently shows columns `# | Champion | Pos`.
- The **Champion** column always displays the *Premier (top) division* champion (`e.divChamps[2]`), not the player's own division — and references a `e.champ` field that no longer exists in history entries (dead code). This is misleading for the player's team history.
- The **Pos** column appends a redundant division name plus `▲`/`▼` status, e.g. `5th · Premier League`.

The player wants the panel to show only **Season, Division, Position** for the player's own team.

## Data already available
Each `LG.hist` entry (recorded in `js/league.js:130-134`) already contains:
- `season`
- `playerDiv` — the division name the player was in that season (e.g. `'Premier League'`)
- `playerPos` — the player's finishing position (1-based; 0 if missing)

`divChamps` is still needed for the `lgTitles` "Premier Champion" count header, so **keep recording it** in `lgNewSeason` — only the table rendering changes.

## Changes

### 1. `js/league.js` — `renderLgHist()` (lines 509-523)
Replace the header and row rendering. New three columns: **Season · Division · Pos**.

- Header row: `<div class="row head"><span>Season</span><span>Division</span><span>Pos</span></div>`
- For each entry (newest first):
  ```
  S{e.season} | e.playerDiv | (e.playerPos ? e.playerPos + ordinal : '—')
  ```
  - Drop the Champion column, `isPlayer`/`e.champ` logic, and `promoted`/`relegated` status text.
  - Ordinal helper already in use: `({1:'st',2:'nd',3:'rd'}[e.playerPos]||'th')`.
- Remove the now-unused `playerName`/`isPlayer`/`status` variables. Keep `titles`/`lgTitles` logic (uses `e.divChamps[2]`).

### 2. `css/styles.css` (line 244-247)
Current grid: `grid-template-columns:42px 1fr 42px` (designed for `# | champion | pos`).
- Adjust to fit `Season | Division | Pos`: e.g. `grid-template-columns:48px 1fr 40px` so the division name (`Premier League`) gets the flexible middle column and Pos stays right-aligned.
- Header rule at line 246 uses `:first-child`/`:last-child` colors — still valid for 3 columns; verify label casing/alignment look acceptable.

### 3. `index.html` (line 219-220)
No structural change needed; the column headers are generated in JS. The `lgTitles` span (Premier Champion count) stays in the `<h3>`.

## Edge cases
- Empty history: panel already hidden (`if(!LG.hist||!LG.hist.length)`) — unchanged.
- `playerPos === 0` (not found in order): render `—` instead of empty.
- Division name length: middle column is `1fr`, so `Premier League` / `Sunday League` fit.

## Validation
- Start/continue a league, finish a season, reopen League lobby → Season History shows Season/Division/Pos per season, newest first.
- Confirm `lgTitles` still shows `· Nx Premier Champion` when the player wins the Premier.
- Check narrow/mobile CSS (`.lgHist` rule at line 244) still renders 3 columns cleanly.
