# Fuzeball

A 3D foosball (table football) game in the browser. Three.js + plain JS, no build step.

## Run it

Open `index.html` in any modern browser (WebGL required). The page pulls
**Three.js r128** and Google Fonts from CDNs; everything else is local.

- Double-click `index.html` (works on `file://`)
- Or serve the folder with any static server (`python -m http.server`)

That's it. No `npm install`, no bundler.

## Play

Three mode cards on the main menu:

- **PLAY RED** / **PLAY BLUE** — take over one team (or lock yourself to a
  specific rod: GK / DEF / MID / ATT). The rest of your team's rods are still
  AI-controlled.
- **AI SHOWDOWN** — sit back and spectate AI vs AI.

### Match Setup panel (main menu)

- **RED AI / BLUE AI** — separate difficulty for each team's AI. Set red to
  *Rookie* and blue to *Legend* to watch a fish fight a shark.
  (Legacy: the old single "Difficulty" dropdown migrated to both per-team
  fields on first load.)
- **Goals to win** — 3 / 5 / 7 / 10
- **Table theme** — Classic Club / Neon Nights / Royal Arena / Verdant Field
- **Special balls** — fireball, cannonball, golden, split
- **Power-ups** — boost (power hits), freeze, big goal
- **Auto rod switch** — when on, the game nudges you to the right rod for the
  live threat
- **Sound** — crowd bed, kicks, goal sting, whistle (synthesized via WebAudio,
  no audio files)

### Controls

| Key | Action |
|---|---|
| ← → / Q E | switch rod |
| ↑ ↓ / mouse | slide players |
| Space / click | kick |
| Shift / right-click | raise players |
| 1 – 4 | select rod |
| V | cycle camera |
| Esc | pause |
| C | toggle debug overlay |

### Teams & Kits panel

Set a team name (max 10 chars) and click the figurine thumbnail to open the
**Customize** studio: pick a figurine, swatch or custom color, and a finish
preset (matte / satin / plastic / metallic / chrome / neon) plus metallic /
roughness / glow / size / rotation sliders. The two teams are tuned
independently.

## Debug overlay (`C`)

Translucent collision proxies + toggleable AI decision-zone layers (goalie clamp,
raise-behind, over-feet reach, under-foot zone, in-front reach, low-y kick plane,
man-hysteresis ring, foot collision reach boxes, per-man z-alignment bars, and a
ball-speed readout). Use it to understand what the AI is "seeing" and verify
collision geometry.

## File map

```
index.html            — markup + ordered <script> tags
css/styles.css        — all styles
js/                   — game modules (plain scripts, shared global scope)
  core.js             — $ , clamp, lerp, rand
  config.js           — CONFIG (tuning) + cfg (persisted player settings)
  audio.js            — Au (synthesized SFX)
  state.js            — S, freshStats, HYPE
  world.js            — three.js init, table, lighting, theme
  balls.js            — ball pool + types
  rods.js             — rod build / slide / kick
  physics.js          — fixed-step ball physics
  ai.js               — AI per-rod behaviour (per-team difficulty)
  input.js            — keyboard / mouse
  powerups.js         — power-ups + dead-ball recovery
  flow.js             — startMatch, onGoal, endMatch, pause, gotoMenu
  fx.js               — FX + camera lerp
  hud.js              — scoreboard, banner, clock
  ui.js               — wires menu HTML → cfg + startMatch
  customize.js        — figurine / colour studio
  models.js           — GLB loaders
  debug.js            — debug overlay
  main.js             — boot + main loop
assets/               — GLB models + pitch textures
tools/                — Python model-build scripts
```

The modules are loaded in dependency order (see `<script>` tags in
`index.html`). They share one global scope on purpose — this is what lets
them work from `file://`, http(s), and an Electron/Steam wrapper alike. Do
**not** convert to ES modules (`import`/`export`): that breaks `file://` via
CORS.

## Tuning

All gameplay numbers live in the `CONFIG` object in `js/config.js`. To change
physics feel, AI behaviour, kick power, ball types, power-up durations, camera,
themes, etc. — edit CONFIG and reload. Nothing else hard-codes these values.

The persisted in-menu settings live next to it: `cfg` (loaded from
`localStorage` key `fuzeball` via `saveCfg()`). `cfg.diffRed` and
`cfg.diffBlue` are the per-team AI difficulties.

## Status

In active development. See `CLAUDE.md` for the full design notes, recent
changes, and AI behaviour deep-dive.
