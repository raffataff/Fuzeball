# three.js upgrade: r128 → current

Goal: physical lights, a correct colour pipeline, better tone mapping and one loader set from one release. Each step ends playable; stop after any of them.

## Why not r155
- `three.min.js` was deprecated in r150 and is gone in r160. `useLegacyLights` is gone in r165. `texture.encoding` / `outputEncoding` are gone in r162.
- Things the game wants that came after r155: `renderer.compileAsync` (r158, for the boot warm queue), AgX (r160) and Neutral (r162) tone mapping, background / environment rotation (r162; CLAUDE.md lists "r128 can't rotate or dim a background" as a limit).
- r164 is the last release with both `useLegacyLights` and `ColorManagement.enabled=false`, and it already has everything above. It is the parity stop. Latest comes after the lighting work, as a small hop.

## How three gets in (no game build step)
One vendor script built once, the way `ktx2-encode.mjs` already uses npm in `tools/`:
- `tools/package.json`: `three` pinned exactly + `esbuild` (dev).
- `tools/build-three.mjs`: entry imports `three`, `GLTFLoader`, `KTX2Loader` (pulls its own `WorkerPool`) and anything else used later; bundles to an IIFE `vendor/three.bundle.js` that sets `window.THREE = Object.assign({}, THREE, {GLTFLoader, KTX2Loader})` (a module namespace is frozen; the copy keeps `THREE.ShaderChunk` the same mutable object, which `haze.js` writes into). Copies `examples/jsm/libs/basis/` from the same version into `vendor/basis/`.
- `index.html`: one script tag replaces `three.min.js`, `GLTFLoader.js`, `WorkerPool.js`, `KTX2Loader.js`. **Delete the CDN URLs at lines 713-718** (CLAUDE.md: no CDN fallback). Update `vendor/README.md`, `tools/fetch-vendor.ps1`.
- Still plain scripts, still `file://`.

## What the upgrade breaks (found in the code)
| Where | r128 thing | Now |
|---|---|---|
| `world.js:55,116` | `outputEncoding = sRGBEncoding` | `outputColorSpace = SRGBColorSpace` |
| `models.js` (17), `world.js` (2), `debug.js` (1) | `.encoding =`, `sRGBEncoding` / `LinearEncoding` | `.colorSpace =`, `SRGBColorSpace` / `LinearSRGBColorSpace` (or `NoColorSpace` for data maps) |
| `vfx.js`, `fire.js`, `models.js` | `#include <encodings_fragment>` | `colorspace_fragment` (r154) |
| `ice.js:180` | replaces the literal `gl_FragColor = vec4( outgoingLight, diffuseColor.a );` | lives in `opaque_fragment` now: patch that chunk |
| `vfx.js` (5), `grass.js`, `models.js` (rod grain) | `vUv` in patched map chunks | per-map varyings (`vMapUv`, `vEmissiveMapUv`…, r151); `uv_vertex` changed too (grass.js patches it) |
| `haze.js` | replaces all four fog chunks | keeps working if it owns all four; recheck against the new chunk order (fog still runs after tone mapping) |
| `world.js:1006` `kitLin` | hex → `convertSRGBToLinear()` by hand | with ColorManagement on, `new THREE.Color(hex)` already converts: kitLin would do it twice |
| every `color.set(hex)` (lights, fog, hemi, materials, CONFIG colours) | hex read as linear | hex read as sRGB → mid-tones darker / more saturated |
| `world.js` lights (point / spot / dir / hemi), `customize.js`, `league.js` | legacy units | physical: punctual × π internally gone; point/spot in candela, decay 2 |
| `world.js` KTX2Loader, PMREM, `WebGLCubeRenderTarget`, `models.js` CubeTexture skies | r128 / 0.137.5 loader | same API; set `colorSpace` on the sky faces; transcoder must be the bundle's own version |

**A `.replace()` whose anchor is gone fails silently** (the effect just loses its patch, no shader error). Before anything else, wrap every patch in a helper that asserts the anchor was found and warns by name. This protects every later upgrade too.

## Step 0: baseline on HEAD
- Branch (no stash: the tree holds uncommitted work; a fresh worktree lacks untracked assets).
- Harness counts against the red-at-baseline list.
- Frames, same machine, via `page-run.js`: `roomShots` (every room, both kits), `fxShots` (goal, cannon, pickup, finale), `fireShots`, `iceShots`, `boostShots`, `cineShots` sample, `menu-shots.js`. Save under `tools/build/three-base/`.
- AI regression set (physics doesn't use three; `ai.js` only uses `Vector3`): must match exactly later.
- F3 profile in a match per room; cold boot time to the menu (headless = cold shader cache every run).

**Done 2026-11-14 on 703fe76 (v0.1.54), branch `three-upgrade`.** Everything under `tools/build/three-base/` (gitignored). Rerun any part after a change into another dir and compare:
- `node tools/harness-all.js tools/build/<dir>/harness`: 33 of 87 red at baseline (more than CLAUDE.md's list; v0.1.54 state). `summary.json` has the exit code and fail-line count per harness.
- `sh tools/three-frames.sh <dir>`: rooms (4 rooms × home, cams 0/2/4), goal, cannon, pickup, finale, fire, ice, boost, cine. `node tools/menu-shots.js`: 5 screens already scroll at 1280×800 (options ×2, trials, lgSetup, league).
- `sh tools/three-ai.sh <dir>`: kaSoak, catchSoak, bsSoak, hsSoak, gkCheck, trSeeds, tsAll, paAll, fhAll on fixed seeds. **Reproduces byte for byte** (two runs, ignoring `wallS`): any difference after the swap is a real change.
- `node tools/page-run.js tools/boot-perf.js "bootPerf({})"` (cold cache, 3 runs within ~2%): arcade warm flush **16.3 s** for 43 programs (~380 ms each); then open 1.6 s + **3.7 s** first render, saucer 3.9 s + **5.0 s** first render, moon 0.6 s; 80 programs in all; match start then compiles nothing. The first-render cost after a flush means `warmFlush` misses programs (shadow / depth variants, or materials outside the queue): the target for `compileAsync` in step 6.
- `roomPerf` (1920×1080, RTX 5070): 1.9-2.7 ms render a frame, 154-186 draw calls, haze off ≈ high. `fxPerf` (1280×720): 1.7-2.1 ms, 187-229 calls.

## Step 1: r164 bundle, parity mode
- Build the bundle (r164). Set before any material exists: `THREE.ColorManagement.enabled = false`, `renderer.useLegacyLights = true` (both renderers, `PRV.r` too), `outputColorSpace = SRGBColorSpace`.
- Migrate the names in the table (encoding → colorSpace, chunk renames, `vUv`, `ice.js` anchor) now: r164 has no aliases for the chunks and the uv change is real.
- Add the anchor-assert helper; boot; zero warnings from it and from three.
- Checks: `node --check`, whole-chain compile, harnesses, AI set (exact), frames vs baseline. Differences should be near zero; any visible one gets explained before moving on.
- Ship-able here: same look, one loader set, the CDN gone.

**Done 2026-11-15 (three 0.164.1), uncommitted on `three-upgrade`.** Results under `tools/build/three-s1/` (`three-s1b` = a second render of the same build, the noise floor; `three-det` = rooms with hair made deterministic in both builds).
- Bundle: `tools/build-three.mjs` (esbuild IIFE from three's `src/`, so it can patch it; each patch asserts its anchor count). Two patches, both for r128 parity: `WebGLBackground` honours `background.userData.toneMapped` (r152+ never tone-maps an sRGB background, which made every bright sky brighter; `ensureSky` sets it), and `Material.forceSinglePass` defaults true (r151+ draws transparent double-sided materials twice: room glass and glow, debris, +36 draw calls in a cannon blast). Basis transcoder byte-identical to the r137 one.
- `THREE.ColorManagement.enabled=false` at the top of core.js; `useLegacyLights` on both renderers. Point lights made with no decay now pass 1 (r155 changed the default to 2): goal lights, fx pool, Customize / league rims.
- Ball reflection cube: r153+ skips tone mapping into a render target. `ballCubeRT` is HalfFloat linear with `isXRRenderTarget=true` (that flag keeps tone mapping and writes linear), the same values r128 stored as sRGB.
- KTX2 skies: a `CubeTexture` of face textures uploads black in r164 (`GL_INVALID_VALUE`, it reads width/mipmaps off each face). Now a `CompressedCubeTexture` of `{width,height,mipmaps}` records.
- Chunk names: `encodings_fragment`→`colorspace_fragment`, ice anchors `opaque_fragment`, `mapTexelToLinear` gone (hardware decode), `vUv`→`vMapUv`, grass rebuilds `uv_vertex` from three's own chunk with the root uv, grass `geometryNormal`→`nonPerturbedNormal`. Every patch goes through `shRep`.
- Harnesses: 33 of 87 red, identical counts to baseline. Updated for the bundle: the GLB harnesses load `vendor/three.bundle.js`; ktx2 checks the bundle, the transcoder match and no CDN; sky (face records, tone flag, two new mutations); fire mutation anchor; solar `vertexTangents` (gone in r151; the tangent attribute is what counts now).
- AI set: byte-identical to baseline.
- Warnings: only `useLegacyLights` deprecation (expected until step 3).
- Frames: rooms 0.82 mean (0-255) vs a 0.13 noise floor with hair fixed; no room's average is more than half a level off. The remainder sits on high-contrast texture edges (pitch lines, figure detail): r164 decodes sRGB in hardware before filtering, r128 decoded after. Arcade's ring glow differs only because r128's boot loop never compiled the rings before the shot (both builds drive them the same once updated). FX frames differ by their particles and hair (`Math.random`; three's own use of it shifts the sequence) and sit near their noise floor.
- Perf: rooms 0.3-0.5 ms faster, same draw calls. A match frame costs ~0.6 ms more for its first seconds and then settles to r128's ~2.0 ms (shaders still compiling in the background). Boot (`boot-perf`, 3 cold runs): the arcade warm flush is gone (16.3 s → 0: r164 doesn't block on compiles, so the queue never parks) and the menu is usable ~5.6 s after load instead of ~22 s; open / saucer first renders 3.0-3.3 s / 4.2-4.4 s (were 3.7 / 5.0); 102 programs (were 80). The warm queue's park logic no longer triggers: revisit in step 6.
- Menus: the same 5 screens scroll as at baseline.
- Not looked at by eye in the live game: Customize / league previews (only via menu-shots), photo mode, replays.
- Removed: `vendor/three.min.js`, `GLTFLoader.js`, `WorkerPool.js`, `KTX2Loader.js`, the CDN URLs in `index.html`; `fetch-vendor.ps1` now fetches fonts only.

## Step 2: colour management on
- `ColorManagement.enabled = true`. `kitLin` becomes `new THREE.Color(hex)` (keep the name, callers unchanged). Fog "display-hex" colours: decide per room whether to keep the look (convert the CONFIG value) or retune.
- Frames per room. Expect every room to shift; fix colours in CONFIG, not with code.

**Done 2026-11-15, uncommitted on `three-upgrade`.** Results under `tools/build/three-s2c/` (`three-s2` = colour management on before any colour was converted).
- `ColorManagement.enabled = true` (core.js). It only changes `THREE.Color` (every hex / CSS string / `setHSL` reads as sRGB, `getHex` writes sRGB); textures, the clear colour and three's own fog colour were already handled in output space.
- Flipped alone, the rooms moved 5-16 levels (mean 8.7; the arcade's red-orange `dir` went deep red). Every room kept its look: each hex that only feeds a 3D material or light was rewritten so its sRGB read gives the value r128 read raw (`linearToSRGB(old)`, 107 literals: `CONFIG.rooms` hemi / dir / env / lights / led (not `bg`: a clear colour), ball types `col` / `em` / `light`, `fx.heat.col`, rod-hole `warm` / `hot` / goal `own`, `training.ringColor`, the table / arena / Customize / league preview materials and lights in code, the fallback burst and fx light colours). Each hex now reads as the colour you see.
- Colours already converted by hand lose the explicit `convertSRGBToLinear` (same values): `kitLin` (now `new THREE.Color(hex)`), `vfxLin`, `fiLin`, the smoke colours, hair swatches.
- Haze writes colour after tone mapping, as display values: `colRaw(hex)` (core.js) reads a hex raw (`setHex(h, LinearSRGBColorSpace)`); `CONFIG.atmos` untouched.
- `seatTintHex` does its HSL offset in sRGB (`offsetHSL` would now work in linear).
- Left to shift (shared with the HUD / CSS, which must keep the hex): power-up `col` on the pickup gem, `fx.boost.col` on its light / trail / fallback burst, ball `trail` sprites, kit colours on the goal lights and the goal ring flash. Small and short-lived; none visible in the fx frames.
- Frames: rooms mean 0.24 vs a 0.14 noise floor (was 8.7); goal 2.66 / 2.22, cannon 2.22 / 2.47, pickup 0.55 / 0.44, finale 9.5 / 8.1, fire 2.17 / 1.67, ice 0.41 / 0.37, boost 1.82 / 1.44, cine 16.4 / 14.2 (s2c / noise). No new warnings.
- Harnesses: 33 of 87 red, the same set as step 1. haze loads `colRaw` and checks the haze / glow colours stay raw (+1 mutation); rodholes' stub Color reads hex as sRGB, and its "raw linear green" mutation now breaks `kitLin` instead; moon's spot-light mutation anchor takes the converted hex.
- Menus (`tools/build/three-s2c/menu` vs `three-s1/menu`): the same 5 screens scroll; Customize 0.45, league squad / club ~0. The cup screens show the Champions Purple pitch in s1 and Champions Green now (two pitch assets, not a colour shift).
- Not checked: the AI set (no colour reaches the sim); photo mode, replays and the F2 editor in the live game (F2 exports `getHex`, which is sRGB now, matching the converted CONFIG).

## Step 3: physical lights
- Remove `useLegacyLights`. First pass is mechanical: multiply hemi / directional / ambient intensities and the fx / goal light pool by π, then point/spot by the factor that matches the old falloff at the table (rooms already think in candela via `gain`/`reach`, `decay` 2). Then tune by eye per room with `roomShots`; re-export rooms from F2.
- GLB-authored lights (KHR_lights_punctual) now arrive in Blender's units: check the rooms that carry them.
- Then fx (`fxShots`, `fireShots`, `iceShots`, `boostShots`), menus, Customize, league preview lights, both kits in every room. Judge by frames only.
- The longest step.

**Done 2026-11-15, uncommitted on `three-upgrade`.** Results under `tools/build/three-s3/` (frames, harness, menu, diffs vs `three-s2c`). Converters in the session scratchpad, not kept: the numbers are in CONFIG now.
- `useLegacyLights` removed from both renderers; no deprecation warning left.
- No falloff (hemi, dir, ambient): ×π, exact. Every room's `hemi` / `dir`, Customize / league preview keys, `bakeGlbEnv`'s hemi (π), the world.js defaults, the F2 fallbacks.
- Authored room lights (`CONFIG.rooms.<id>.lights`): r128's `(1-d/dist)^decay` can't be reproduced by `d^-decay × window`, so each spot / point was fitted (intensity, decay, dist) to its old falloff over 0.5-1.5× its distance to the look point (the pub pendant: to the table). Fit error 1-3.5%. Decays land at 0.1-1.1, not 2: decay 2 matched only at one distance (25-50% off across the lit area). Moving a room to true inverse-square is a by-eye job in F2.
- GLB lights (`applyRoomLights`): `intensity = candela × gain` (the r128 `1/d0²` is three's own falloff now), `distance = d0 × reach` stays as a soft cutoff. Gains converted so the table gets the same light (`× π(1-1/reach)²/(1-reach⁻⁴)²`): default 0.8 → 1.15, pub 3.6 → 5.45. Only the pub GLB carries lights (the pub is out of the game). roomlight-harness rewritten for it (green; it was red at baseline).
- Effect glows (fx pool, goal lights, preview rims) are **decay 0**: inverse-square on a light riding the ball puts a hot spot under it. The window `(1-(d/D)⁴)²` at `fx.lightReach` 0.89 × the asked radius, intensity ×2.41 (π × 0.767), is the least-squares fit to r128's linear falloff (rms 0.10 of peak). Converted: `fx.vfx` goal / flash / cannon / finale / shells, `fx.heat.light`, `fx.fire.light.base`, `warnLightMax`, `respawnSwirlLight`, and the literals in balls.js, fracture.js (incl. its fade rate), fx.js (goal flash + fade), vfx.js (pickup). Preview rims matched exactly at the figurine (decay 0, same distance).
- F2: `int` is a log slider (0.01 to 1e5), hemi 0-6, dir 0-10; a new spot / point starts at decay 2, no cutoff, 19000. `lightAudit` uses the physical falloff.
- Frames vs `three-s2c`: rooms 0.36 (noise 0.14; worst 0.63); goal 2.60, cannon 2.61, pickup 0.72, finale 8.9, fire 2.53, ice 0.82, boost 1.9: at or a little over their particle / hair noise; by eye the same. Cine 21.8 is a different opening shot (the director's pick isn't seeded), not light. Menus: Customize 0.23 (hair colour), league / cup previews ≤1.1; the league season screen differs by its scripted season's data.
- Harnesses: 32 of 87 red (roomlight now green), the rest the same set as step 2. Menus: options ×2, trials, lgSetup scroll (league no longer does; not from this change).
- Not checked: AI set (no light reaches the sim), the live game by eye, photo mode, replays, the pub (out of the game).

## Step 4: tone mapping
- Add AgX and Neutral to `CONFIG.render.toneMapping` and the F2 picker (`roomedit.js:376`); try each room under each. Fog still mixes after tone mapping, so recheck haze.
- Optional now that it exists: `scene.backgroundIntensity` / `backgroundRotation` for skies (then the "bake rotation and dim into the faces" rule in CLAUDE.md can relax for new skies).

## Step 5: hop to latest
- Rebuild the bundle on the newest release (pin the exact version). Removed by then: `useLegacyLights`, encoding names, the r164 aliases; WebGL1 (r163, fine in Electron). Read the migration guide entries r165 → target; rerun the anchor asserts, harnesses, frames.

## Step 6: warm queue + measure
- Try `renderer.compileAsync(scene, camera)` in `warmGo` / `warmMatchPrep` against the current slice queue; keep whichever gives the smaller cold-boot stall.
- Repeat F3 and boot timing vs step 0.
- Update every "r128" note: CLAUDE.md (Project line, the light-count rule still holds, background limits, fog note), `vendor/README.md`, memory notes.

## Not changed by this
- The light-count rule (adding a light mid-match recompiles every shader) is the same in every release: keep the pools.
- Baked room lighting (vertex colours, light bakes from Blender) doesn't depend on three's lights; only how it is tone-mapped and colour-managed.
