# STEAM — store and platform notes

*Written 2026-09-26. Drafts to paste into Steamworks, plus the records behind them.*

---

## 1. AI content disclosure

Steam's Content Survey asks two separate questions. Answer both. The answer to the first one
is shown on the store page.

### 1.1 Pre-generated content (shown on the store page)

Draft. Edit it to match what was actually done before submitting:

> The base 3D models for the player figures and some props were generated with Tripo AI and then
> reworked by hand: geometry fixes, retopology, new and repainted textures, and materials made for
> the game's lighting. All game design, code, rooms, pitches, UI, lore and audio were made by the
> developer.

Being specific helps here: a vague "AI was used" reads worse than a precise answer that shows
how much of the work was hand-made.

### 1.2 Live-generated content

> No AI is used to generate content while the game is running.

(Steam asks this separately because live generation needs extra guardrails. Fuzeball has none,
so the answer is simply no.)

### 1.3 Keep this true

- If a new AI-generated asset ships (a prop, a figure, a texture), add it to 1.1 and to the
  record in §2.
- Everything procedural in `tools/` (rooms, skies, pitches, textures) is hand-written code, not
  AI generation, and doesn't need disclosing.

---

## 2. Tripo licence record

Account: **Pro** (paid, which includes commercial use). Commercial rights depend on the plan a
model was generated under, so keep:

- [ ] A saved copy (PDF or screenshot) of Tripo's terms of service as of going Pro
- [ ] The date the account went Pro: ____________
- [ ] Any models generated before that date (regenerate or re-check them)

Tripo-generated assets in the game (known so far):

| Asset | Where | Notes |
|---|---|---|
| Player figures | `assets/` figure GLBs | reworked by hand |
| Void generator prop | `assets/rooms/void/fuzeball_room_void.glb` (`void_generator` material, `tripo_image_*` textures) | added 2026-09-26 |
| Void boxes (cardboard) | `assets/rooms/void/fuzeball_room_void.glb` (`void_crate_open` material, `tripo_image_05dbbd72*` textures) | replaced the procedural crates, 2026-09-26 |
