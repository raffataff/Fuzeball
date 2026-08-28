# vendor/

Local copies of every runtime dependency, so Fuzeball boots with **no network access at all**
— Electron/Steam wrapper, or a double-clicked `file://`.

**This folder is not an optimisation. It is required.** As of 2026-08-26 `index.html` has no
CDN fallback (`CDN_FALLBACK=false` in its loader) and no Google Fonts `<link>`. If a file here
is missing the game does not quietly fetch it from the internet any more — it logs a load
error and carries on without it.

Populate it from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File tools\fetch-vendor.ps1
```

Then verify:

```
node tools\offline-harness.js
```

## What's here

| File | Pin | Notes |
|---|---|---|
| `three.min.js` | r128 | the version the whole codebase targets |
| `GLTFLoader.js` | three 0.128 | matches the r128 core |
| `WorkerPool.js` | three **0.137.5** | `KTX2Loader` constructs `THREE.WorkerPool` — must load first |
| `KTX2Loader.js` | three **0.137.5** | r128 has no KTX2Loader at all |
| `basis/` | three **0.137.5** | hand-pinned and verified — **see `basis/README.md` before touching** |
| `fonts.css` + `fonts/` | generated | self-hosted woff2 for the families `css/styles.css` uses |

The r137 pins are deliberate and documented in `basis/README.md`. Do not "tidy" them to match
the r128 core — that is the bug, not the inconsistency.

## `fonts.css` is GENERATED — do not hand-edit it

`tools/fetch-vendor.ps1` writes it from Google's CSS with the URLs rewritten to local copies.
Its `$FontFamilies` / `$FontQuery` must match what `css/styles.css` actually asks for.

**This has already drifted once.** The game moved from Orbitron to Russo One, the fetch script
was updated, `vendor/fonts.css` was never regenerated — and because `index.html` still carried
a Google Fonts link at the time, everything looked right online while every offline build fell
back to `monospace` on the dev overlays. Nothing reported it. Check 5 of
`tools/offline-harness.js` exists specifically to fail on that class of drift: it cross-checks
every family named in `css/styles.css` against the `@font-face` rules actually on disk.

**After changing a font in `css/styles.css`, re-run the fetch script and the harness.**
