# Fuzeball — direction for the Early Access release

*Status: DRAFT, 2026-09-23. Anything marked **proposed** is a suggestion to confirm or change.
The working checklist lives at https://claude.ai/artifact/De8K1742Yr3c1acQ5oy19p.*

---

## 1. What ships in the first release

**In**
- **Kick Off** — against the AI and local co-op, with special balls, power-ups and replays.
- **League + Champions Cup** — cut down, see below.
- **Training** — the Sandbox and Skill Trials, so new players have somewhere to practise.
- **Options, Customize (kits and figures), and the in-game layout editor.**

**Proposed: also in — the Daily.** It's already built, and it's the one reason to open the game on a
day you weren't planning to. Not mentioned in the scope discussion, so it's your call.

**Out of the player build** (stays in the code behind `CONFIG.debug`)
- Room editor (already gated), the debug overlay and kick log (`C`, `L`), free roam (`F`), the frame
  profiler (`M`). Today any player can press `C` in a match and get the collision overlay.
- Photo mode (`F1`) can stay as an unadvertised extra. It's harmless, and players who post screenshots
  will like it.

### League limits — proposed: two divisions, no season cap

The League today has three divisions (Sunday → Pro → Premier), lets you pick your starting division,
and only the **top-division champion** plays the Champions Cup.

Capping it at **two seasons** with three divisions doesn't work: starting at the bottom, you can't reach
the Premier League until season 3, so nobody would ever see the Cup.

**Proposed instead:**
- **Two divisions.** Keep the bottom one and the top one, and drop the Pro League.
- **Everyone starts in the bottom division** (the starting-division picker goes). Season 1 is about
  promotion. From season 2 you can be relegated, or win the top division and play the Cup.
- **No season cap.** Seasons carry on for anyone who wants them.
- The third division comes back in an Early Access update. More divisions read as "more to come";
  a season cap in a paid game reads as a demo wall.

**The two-season cap fits the Next Fest demo**: Kick Off plus two league seasons.

What that touches: `CONFIG.league.divisions` (2 entries), the `lgSetupDiv` select in `index.html`, the
"3 divisions" tagline on `#lgSlots`, and the Sunday League venue (it plays in Void — `room:'open'`).

---

## 2. Theme

> Table football left Earth on a battered wooden table and spread through the galaxy's arcades,
> moon bases and saucer bars. It's now run by a very grand Federation that takes it far too
> seriously: gold trophies, anthems, broadcast graphics, and a rulebook thicker than the table.
> The venues are cramped, loud and a bit grubby. The ceremony around them is enormous.

**The identity is that contrast**: small, lived-in venues, and gold-plated officialdom around them.
Check every decision against it. "Table football, taken far too seriously" still works as the tagline.

What it means in practice:
- **The figures are the Federation's registered players** from across the galaxy. The humans are the
  Earth team: the sport's inventors, now the underdogs.
- **Rooms are venues on the circuit**, places people actually play: the Neon Arcade (default), a Moon
  base, a saucer bar, a spaceport cantina (the pub, re-dressed). Not sci-fi set pieces.
- **The table stays wood, worn and chipped.** It came from Earth. It's the one constant in every room.
- **The League belongs to the Federation.** Divisions become sectors, team names come from the species.
- **The UI is the Federation's broadcast**: crests, engraved gold plates, broadcast captions. **Not** a
  spaceship HUD. This is what keeps the theme away from generic neon sci-fi.

Avoid: holographic panels, glowing hex grids, scan lines, lens flares, "cyber" everything. That's the
stock AI space look, and it's the fastest way back to "AI slop".

---

## 3. Palette and type

Taken from the logo render (`assets/fuzeball_render_tc_cycles_2K.png`): copper-gold on FUZE, a
teal-leaning steel blue on BALL. Values are nudged for contrast on screen.

| Token | Hex | From the logo | Use |
|---|---|---|---|
| Deep space | `#07111C` | darker than BALL's shadow | backgrounds |
| Federation blue | `#123F5E` | BALL shadow `#0F6781`, darkened | structure: bars, plates, panel fills |
| Steel | `#6BAABC` | BALL face | secondary text, inactive states |
| Ice | `#BCDCED` | BALL highlight | cool highlights, small |
| Copper | `#B8621F` | FUZE shadow `#99490E`, lifted | warm secondary, pressed states |
| **Federation gold** | `#F0B24A` | FUZE face and the fuse spark | **the accent**: focus, selection, primary actions, trophies |
| Spark | `#F6DDB0` | FUZE highlight `#F2DEBC` | gold highlights, never large areas |
| Text | `#EDF0F1` | "TOTAL CONTROL" silver `#BEC4C5`, lifted | body text |

Rules:
- **Gold is earned.** It marks focus, the selected option, the primary action, trophies and gold
  medals. Never a background wash.
- **Blue is structure.** Plates, bars and fills.
- **UI colours never replace team colours.** Team 2's default kit blue (`#1e5bd8`, royal; was `#3d8bff`) sits near the UI
  blues, so the kit screen should let the team colour dominate.
- **No frosted glass, no 14px rounded cards.** Shapes borrow the HUD board's angled cut ends and the
  logo's bevels.

Type:
- **Display: Soccer League College** (italic), the notched collegiate cut that matches "TOTAL CONTROL"
  in the logo. Titles and the home menu only (`--font-display`). **Licensed for commercial use**
  (2026-09-24, Vladimir Nikolic). The plain Soccer League cut (`--font-ui`) does labels, buttons and numbers.
- **Body:** Rajdhani 600 (`--font-body`). Soccer League is capitals only, so anything read as a sentence
  stays in Rajdhani.

**Applied (2026-09-24 UI pass):** the palette is the `:root` tokens in `css/styles.css`. Buttons, tabs and
menu items are plates cut at the HUD board's 20°, the pad cursor fills a plate with gold, panels are
square slabs with a caption tab, and the home screen is a menu column over the live table.

---

## 4. Defaults

- **Default location: the Neon Arcade** (`cfg.room` default `'arcade'`). Only affects new saves; a save
  that already has a room keeps it.

---

## 5. Open questions

1. The Daily: in or out? In
2. Which two divisions, and what are they called in the theme?
3. Lock the league start to the bottom division? (Proposed yes.)
4. Does the Champions Cup keep its name, or become the Federation Cup?
