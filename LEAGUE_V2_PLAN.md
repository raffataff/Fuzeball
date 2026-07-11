# League Mode v2 — Implementation Plan

Hand this to the implementing agent. Read `CLAUDE.md` and the current `js/league.js`
first. **Keep the existing dense code style. These are non-module scripts sharing one
global scope — never add `import`/`export`. Put every new tunable number in `CONFIG`,
not inline. When you change a function, rewrite the WHOLE function, then re-read it in
context to check braces.**

This is a big change. Do it in the **8 phases below, in order**. After each phase, the
game must still load and run (open `index.html`, check the browser console for errors).
Do not start a later phase until the earlier one runs clean.

---

## 0. What we're building (goals)

1. **A league start screen** with **save slots** (multiple independent leagues) and a
   **new-league creation form**: league name, your team name, kit colour, figurine model,
   special-balls toggle, power-ups toggle, and **which division you start in**.
2. **Three divisions** stacked by strength — **Sunday League** (bottom), **Pro League**
   (middle), **Premier League** (top) — with **promotion & relegation** of the **top 2 /
   bottom 2** each season.
3. **Enough teams** to fill all three divisions.
4. **Upgrade-point rewards**: promoted 1st place → **+3 parts**, promoted 2nd place →
   **+2 parts**. **Premier League champion → +3 parts** (they can't promote, so this is
   their reward).
5. **Relegation penalty**: both relegated teams **lose 1 random stat point from each role
   block** (see §5 for the exact rule).
6. **Lower divisions start from a lower stat base** (weaker teams lower down the pyramid).

The current league is a **single flat 12-team round robin** with the player hard-coded at
team index 0. We are turning it into a **3-division pyramid** and adding a front-end.

---

## 1. Key design decisions (already made — do NOT re-litigate, just implement)

- **Division size:** 10 teams each × 3 divisions = **30 teams total** (1 player + 29 AI).
  10 teams → 9 rounds single round robin. Keep divisions **equal and even** so every division
  plays the same number of rounds and season rounds stay aligned.
- **The player is one specific team** identified by a stable **`id`** (`LG.playerId`), NOT
  by array position. Promotion/relegation moves the player between divisions, so index-0
  assumptions must go (see §4 migration list).
- **Rounds are shared across divisions:** on round R, ALL three divisions play their round-R
  fixtures. The player plays ONE live match (in their division); every other fixture in every
  division is simulated by `lgSim`.
- **Promotion/relegation happens only between seasons**, in `lgNewSeason(keep=true)`.
- **"Lose 1 random stat from each category" = each of the 4 role blocks (GK/DEF/MID/ATT):
  pick 1 random stat of the 6 and subtract 1**, floored at a configurable minimum
  (`CONFIG.league.relegateFloor`, default 1). So a relegated team loses 4 stat points total,
  spread one-per-position. (If you'd rather read "category" as the 6 stat types, that's a
  one-line change — but implement the 4-role version; it's the intended reading.)
- **Division stat base:** Sunday = 3, Pro = 4, Premier = 5. This is only the *starting fill*
  value for a newly created build. **`STC.base` stays 5** — it is the neutral pivot the stat
  multipliers are measured against (`stats.js`), so do NOT change it. A Sunday team filled at
  3 simply plays below neutral (slower/weaker); that's the desired effect. The player uses
  their chosen starting division's base too.
- **Save slots:** **3 slots**. Storage keys `fuzeball_league_0/1/2`. A separate small key
  `fuzeball_league_slot` remembers the last-opened slot. The OLD single key
  `fuzeball_league` is migrated into slot 0 on first load (see §4).

---

## 2. New data model

Replace the flat `LG` shape with this. **Write it exactly.**

```
LG = {
  slot: 0,                 // which save slot this is (0..2)
  name: 'MY LEAGUE',       // league name from the creation form
  season: 1,
  round: 0,                // current round index, shared by all divisions
  playerId: 0,             // stable id of the player's team (see teams[].id)
  special: true,           // special-balls toggle chosen at creation
  power: true,             // power-ups toggle chosen at creation
  teams: [                 // GLOBAL pool of all 24 teams, index === id
    { id, name, col, model, bld,      // bld = lgBld() build object (unchanged shape)
      up,                             // unspent upgrade parts
      div,                            // 0=Sunday 1=Pro 2=Premier (current division)
      w, l, gf, ga, p, rankD }        // per-season standings (reset each season)
  ],
  divs: [                  // 3 divisions, index === tier (0 Sunday .. 2 Premier)
    { name:'Sunday League', tier:0,
      teamIds:[...8 ids...],          // who is in this division THIS season
      fixtures:[[ [a,b],... ], ...],  // round-robin over teamIds (see lgFixtures note)
      results:[],                     // results[round] = array parallel to fixtures[round]
      champ:null },
    { name:'Pro League', tier:1, ... },
    { name:'Premier League', tier:2, ... }
  ],
  hist: []                 // [{season, divChamps:[s,p,pr], playerDiv, playerPos, promoted:bool}]
}
```

**Important:** `teams` is the stable global pool; `id === index into LG.teams`. `divs[t].teamIds`
lists which teams are in division `t` this season. `divs[t].fixtures` are pairs of **global team
ids**. This keeps ids stable while teams move between divisions across seasons.

---

## 3. CONFIG additions (`js/config.js`, inside the `league:{}` block)

Add these keys. Keep the existing ones (`goals`, `upWin`, `cost`, `tape`, `simK`, `rate`,
`spend`, `colClash`, etc.) — they still apply. **Remove** the old flat `teams:12` and replace
its role with `divSize`.

```
divSize:10,                // teams per division (even; 10 → 9 rounds)
divisions:[                // tier order: 0 bottom .. 2 top
  {name:'Sunday League', base:3, aiBudget:[4,9]},
  {name:'Pro League',    base:4, aiBudget:[9,15]},
  {name:'Premier League',base:5, aiBudget:[15,22]}
],
promoteN:2, relegateN:2,   // top/bottom N swap between divisions each season
upPromote1:3, upPromote2:2, // upgrade parts: 1st-place promotion / 2nd-place promotion
upChampTop:3,              // parts for winning the Premier (top) division
relegateLose:1,            // stat points removed per role block on relegation
relegateFloor:1,          // a stat can't drop below this via relegation
slots:3,                  // number of save slots
playerStart:10            // (already exists) parts player gets when a NEW league is created
```

Also **delete `LGC.teams`** references — search the codebase; the only user is
`lgNewSeason`/`lgFixtures`. `LGC.names` and `LGC.cols` must now hold **at least 29 AI
entries** (30 teams − player). Expand both lists (§6).

---

## 4. Migration & the "player is index 0" cleanup (do this FIRST, Phase 1)

The old code assumes the player is `LG.teams[0]`. Search `js/league.js`, `js/flow.js`,
`js/ui.js` for **literal `0`** used as "the player" and replace with **`LG.playerId`**.
Known spots to fix:

- `lgApply(a,b,...)` clean-sheet check: `if(a===0&&gb===0)` / `if(b===0&&ga===0)` →
  compare against `LG.playerId`.
- `lgPlayerFixture()` `f[0]===0||f[1]===0` → `===LG.playerId`; and it must search the
  **player's division's** fixtures: `LG.divs[playerDiv()].fixtures[LG.round]`.
- `lgRecord`: `res.push(f[0]===0?...)` and the `order.findIndex(e=>e.i===0)` → `playerId`.
- `renderLgSquad`, `renderLgHist`, `renderLgTable` (`e.i===0` "me" highlight), `renderLgFix`,
  `renderLgLast` (`f[0]===0||f[1]===0`) → all use `LG.playerId`.
- `teamName/teamCol` fallback for non-league is unchanged (they read `S.lg`).

Add a helper: `function playerDiv(){return LG.teams[LG.playerId].div;}`

**Migration on load** (`loadLG`, now `loadLG(slot)`): if the new per-slot key is empty but the
OLD `fuzeball_league` key exists, read it, wrap its flat `teams` into `divs[1]` (Pro), set
`playerId=0`, `div=1` on every team, give it `slot=0`, `name='LEAGUE 1'`, then save under the
new key and delete the old key. If neither exists, leave `LG=null` (caller shows the setup
form). Keep the existing model-migration loop.

---

## 5. Promotion / relegation (Phase 5) — the core new algorithm

This runs at **season end**, inside `lgNewSeason(true)` (the "Next Season" path), BEFORE
reshuffling fixtures. Steps, in order:

1. **Finalise standings per division.** For each division `t`, compute `lgOrderDiv(t)`
   (like `lgOrder` but filtered to `divs[t].teamIds`, same sort: pts → GD → GF).
2. **Record champions** into `LG.hist` (one entry: season, the three division champ names,
   player's division & final position, whether the player was promoted).
3. **Award upgrade parts:**
   - In each division **below the top** (tiers 0 and 1): 1st place → `up += upPromote1`,
     2nd place → `up += upPromote2`.
   - In the **top division** (Premier): champion → `up += upChampTop`.
4. **Relegation penalty:** for each division **above the bottom** (tiers 1 and 2), take the
   **bottom `relegateN` (=2)** teams. For **each** of those teams, for **each** role block in
   `['GK','DEF','MID','ATT']`: pick 1 random stat key of the 6, do
   `st[k]=Math.max(LGC.relegateFloor, st[k]-LGC.relegateLose)`. (4 stat points lost per
   relegated team.)
5. **Swap divisions:** for `t` from 0..1 (bottom-up): move the **top `promoteN`** teams of
   division `t` **up** to `t+1` (set their `.div=t+1`), and the **bottom `relegateN`** of
   `t+1` **down** to `t` (`.div=t`). Do the swaps so counts stay at `divSize`. Simplest safe
   order: compute all promoted/relegated ids first from the finalised standings, then reassign
   every team's `.div`, then rebuild each `divs[t].teamIds` by filtering `LG.teams` on `.div`.
6. **AI teams spend their new parts:** loop AI teams, `lgAiSpend(t)`.
7. **Reset season standings** (`w=l=gf=ga=p=rankD=0` on every team), `season++`, `round=0`,
   rebuild `divs[t].fixtures = lgFixtures(divs[t].teamIds)` for each division, clear each
   `champ`, `saveLG()`.

**`lgFixtures` change:** it currently takes a count `n` and returns index pairs `0..n-1`.
Change it to **take an array of ids** and return pairs of those ids:
`lgFixtures(ids)` → circle method over `ids.slice()`. Update the one call site.

**Player promotion feel:** after step 5, `playerDiv()` may have changed — the lobby will just
render the new division. Show a banner/line on the lobby: "PROMOTED TO PRO LEAGUE ▲" /
"RELEGATED TO SUNDAY LEAGUE ▼" / "STAYED UP" using `LG.hist` (compare last two entries'
playerDiv, or store a `promoted`/`relegated` flag).

---

## 6. Content: names & colours (Phase 1, quick)

`CONFIG.league.names` needs **≥29** distinct AI names. Keep the existing 12, add ~17 more in
the same cheeky style, e.g.: `'BACKSPIN BOYS','THE TABLERS','NUTMEG NOMADS','CHOP SHOP',
'RIMSHOT ROVERS','PIVOT PIRATES','THE SWERVE','CLEAN SHEETS FC','TOE-POKE TOWN','LOB CITY',
'WALL PASS WANDERERS','SPINNERS UTD','THE DEADLOCKS','CROSSBAR CREW','SCREWBALL CITY',
'THE HANDLERS','BENCHWARMERS FC'`. `CONFIG.league.cols` already has 15; add more distinct hues so
30 teams can all differ. Names get shuffled and dealt out in `lgNewSeason`.

---

## 7. Front-end: three new/updated screens

Reuse existing CSS classes (`.screen`, `.panel`, `.btn`, `.miniBtn`, `.row`, `.lgWrap`,
`.kitPal`, `.kitFig`) so it matches. Add a `/* ===== league setup ===== */` CSS block only for
genuinely new elements. All new DOM built in `index.html` where possible; dynamic bits
(`document.createElement`) go in `js/league.js` like the existing panels.

### 7a. Slots screen `#lgSlots` (new)
- Replaces the current instant `openLeague()` on the LEAGUE card. `btnLeague.onclick` now
  opens `#lgSlots`.
- Renders `LGC.slots` slot cards. For each slot read its key: **empty** → card shows
  "＋ New League" → opens the setup form (§7b) for that slot. **Filled** → card shows league
  name, "Season N · <player's division name>", player's current position, and two buttons:
  **Continue** (loads that slot into `LG`, remembers the slot, calls `openLeague()`) and
  **Delete** (confirm, then `localStorage.removeItem(key)` and re-render).
- Back button → main menu.

### 7b. New-league setup `#lgSetup` (new)
Form fields (persist choices into the new `LG` on Create):
- **League name** — text input, maxlength ~14, default `LEAGUE <slot+1>`.
- **Your team name** — text input, maxlength 10, default from `cfg.redName`.
- **Kit colour** — a `<input type="color">` + a small swatch palette (reuse `.kitPal`
  pattern). Default `cfg.redColor`.
- **Figurine model** — a model picker. Reuse the model list from `CONFIG.playerModel.models`
  (only entries with `.src`). Simplest: a scrolling row of buttons showing `ico + name`, one
  selected (like the customize panel's `#czModels`). Default `cfg.modelRed`. Store the chosen
  model id.
- **Starting division** — a `<select>` with the 3 division names (value = tier 0/1/2), default
  Sunday (tier 0). "Which division you start in."
- **Special balls** — checkbox, default from `cfg.special`.
- **Power-ups** — checkbox, default from `cfg.power`.
- **Create League** button → calls `lgNewSeason(false, opts)` with an `opts` object carrying
  all the above → `openLeague()`. **Cancel** → back to `#lgSlots`.

`lgNewSeason(keep,opts)` **fresh-league path** changes:
- Build 30 teams. Deal shuffled `names`/`cols`/random models to the 29 AI teams.
- **Assign divisions:** put the player in `opts.startDiv`. Fill the rest so each division has
  exactly `divSize`. AI teams get `bld` filled at **their division's `base`** (`lgBlk(base)`),
  and a random starting budget from that division's `aiBudget`, then `lgAiSpend`.
- The **player's** `bld` is filled at the **starting division's base**, `up=LGC.playerStart`,
  name/col/model from `opts`.
- Set `LG.special/power/name/slot/playerId=0`.
- Build each `divs[t].fixtures = lgFixtures(divs[t].teamIds)`.
- `saveLG()` (writes to that slot's key).

**Parameterise the build fillers:** `lgBlk(base)` and `lgBld(base)` take a base value
(default 5 for back-compat). Everywhere a build is created, pass the right division base.

### 7c. Lobby `#league` (update the existing screen)
- **Standings** must now show the **player's current division only**, titled with the division
  name (`LG.divs[playerDiv()].name`). Use `lgOrderDiv(playerDiv())`. Highlight promotion zone
  (top `promoteN` rows) and relegation zone (bottom `relegateN` rows) with a subtle
  green/red tint — this teaches the player the stakes. (Bottom division: no relegation zone;
  top division: no promotion zone, but mark the title row.)
- Add a small **division switcher / pyramid view** (optional but recommended): tabs or a
  dropdown to peek at the other divisions' standings read-only. If time-boxed, skip and just
  show the player's division.
- Everything else (Next Match, Squad, Scout, Last Round, History) stays, but every internal
  `index 0`/`fixtures[LG.round]` reference must go through `LG.playerId` / player's division
  (see §4).
- On season complete, the `lgNew` button already flips to "Next Season ▶". Keep that; it now
  runs the promotion/relegation `lgNewSeason(true)`. Show the promotion/relegation banner
  described in §5.

---

## 8. Hook the creation toggles into matches

The creation form captures **special balls** and **power-ups** per league. Currently live
matches read the global `cfg.special` / `cfg.power`. For a league match, override them from
`LG` while `S.lg` is live:

- In `lgPlayMatch`, before `startMatch`, save the old values into `S.lg.prevKit` (extend it)
  and set `cfg.special=LG.special; cfg.power=LG.power;`.
- In `gotoMenu` / `endMatch` cleanup where `S.lg.prevKit` is restored, also restore
  `cfg.special`/`cfg.power`. (Follow the existing `prevKit` restore pattern exactly.)

Check `flow.js`/`powerups.js`/`balls.js` for where `cfg.special`/`cfg.power` are read to
confirm this override reaches them; if any read a cached copy at match start, set it there
instead.

---

## 9. Things you didn't ask about but MUST handle (edge cases)

1. **Fixtures reference stable ids, standings filter by division.** Do not renumber teams.
2. **Round alignment:** all divisions have `divSize` teams → same round count. If you ever make
   divisions unequal, this breaks — keep them equal.
3. **`rankD` (up/down arrows):** currently computed globally in `lgRecord`. Recompute it
   **per division** now (compare each team's position within its own division before/after the
   round).
4. **Simulating other divisions each round:** `lgRecord` must, after the player's live result,
   sim every remaining fixture in the **player's** division AND **all** fixtures in the **other
   two** divisions, apply them, and advance the shared `round`. Otherwise other divisions never
   progress and promotion/relegation is meaningless.
5. **Scout panel & tape** already take an opponent id — fine, but make sure the opponent lookup
   uses the player's division fixture.
6. **Deleting a slot mid-season** is fine (just remove the key). **Abandoning a live match**
   still must not record (existing `gotoMenu` clears `S.lg`) — keep that.
7. **Save-slot isolation:** `saveLG()` must write to `fuzeball_league_<LG.slot>`; `loadLG(slot)`
   reads that key. Never write to the old global key again (except the one-time migration).
8. **Champion of Premier across seasons:** `LG.hist` should still track titles; the "Nx
   Champion" line should count Premier titles specifically (or league wins — pick Premier and
   note it).
9. **Player relegated from the bottom / promoted from the top:** guard the array math so tier 0
   never relegates and tier 2 never promotes (loops in §5 already skip these — double check).
10. **Colour clash:** keep `colClash` check against the player's chosen colour when dealing AI
    colours.
11. **Stat multipliers below base:** confirm `stats.js` handles build values < 5 (base-3
    Sunday teams). It should (multiplier is symmetric around `STC.base`), but verify the
    stamina/`sta` and `acc` paths don't clamp weirdly at low values.

---

## 10. Phase order (ship in these increments; game runs after each)

1. **Phase 1 — plumbing:** CONFIG additions (§3), expand names/cols (§6), parameterise
   `lgBlk(base)`/`lgBld(base)`, add `playerDiv()`/`lgOrderDiv()`, replace all "index 0 = player"
   with `LG.playerId` (§4). Migrate old save into new slot-0 shape. Game still plays the (now
   single-division, slot-based) league.
2. **Phase 2 — data model:** introduce `LG.divs`, move `teams`/`fixtures`/`results` under
   divisions, update `lgFixtures(ids)`, `lgRecord` (sim all divisions), `renderLgTable` (player
   division), standings filtering. Still one season, no pro/rel yet.
3. **Phase 3 — slots screen `#lgSlots`** (§7a) + per-slot save/load. LEAGUE card opens slots.
4. **Phase 4 — setup form `#lgSetup`** (§7b) + fresh `lgNewSeason(false,opts)` builds 3 full
   divisions with per-division bases/budgets and the chosen starting division.
5. **Phase 5 — promotion/relegation** in `lgNewSeason(true)` (§5): swaps, upgrade rewards,
   relegation penalty, promotion banner, per-division `rankD`.
6. **Phase 6 — lobby polish:** promotion/relegation zone tints, division name in title,
   optional division peek (§7c).
7. **Phase 7 — creation toggles** wired into matches (§8).
8. **Phase 8 — full playtest:** create a league in each division, play a full season, force a
   promotion and a relegation, verify parts awarded, stats dropped, teams swapped, save/reload
   persists, all three slots independent.

---

## 11. Verification checklist (do every item before calling it done)

- [ ] Fresh league in **each** starting division creates 30 teams, 10 per division, player in
      the chosen one.
- [ ] Play a full season: player's division standings update after each round; other two
      divisions also progress (check via the peek view or by logging).
- [ ] Finish a season 1st in a lower division → promoted, **+3 parts**, division changes next
      season. Finish 2nd → **+2 parts**, promoted.
- [ ] Win the Premier → **+3 parts**, stay in Premier.
- [ ] Bottom-2 of Pro/Premier get relegated; each relegated team's build shows **4 stat points
      gone** (1 per role), none below `relegateFloor`.
- [ ] Sunday-base-3 teams visibly play weaker than Premier-base-5 teams in live matches.
- [ ] Three save slots are fully independent; delete works; continue resumes mid-season.
- [ ] Old `fuzeball_league` save (if present) migrates into slot 0 without data loss.
- [ ] Special-balls / power-ups toggles from creation actually take effect in the live match.
- [ ] No console errors; `file://` double-click still works (no ES module syntax).
- [ ] **Verification method:** the Linux sandbox is often down. When it is, verify by careful
      re-reading of each rewritten function (braces/scope). When it IS up, concatenate
      `js/*.js` in load order and run through Node `vm.runInNewContext` with browser globals
      stubbed to catch parse errors (per `CLAUDE.md`).

---

## 12. Files you will touch

- `js/config.js` — `league` block (§3), names/cols (§6).
- `js/league.js` — the bulk: data model, divisions, pro/rel, slots, setup, all render fns.
- `index.html` — new `#lgSlots` and `#lgSetup` screens; tweak `#league` lobby; the LEAGUE
  card's binding.
- `css/styles.css` — a `/* ===== league setup ===== */` block for new elements + promotion/
  relegation zone tints.
- `js/flow.js` / `js/ui.js` — `LG.playerId` cleanups; creation-toggle restore in `gotoMenu`/
  `endMatch` (§8).
- Possibly `js/customize.js` — if you reuse its model-picker rendering for the setup form,
  factor the shared bit out rather than duplicating (keep names unique across files).

Keep replies/commits concise. Update the "Current state / recent work" section of `CLAUDE.md`
when done, in the same terse style as the existing entries.
