# vendor/

Local copies of every runtime dependency, so Fuzeball boots with **no network access at all**
(Electron/Steam wrapper, or a double-clicked `file://`). `index.html` has no CDN fallback and no
Google Fonts `<link>`: a missing file here logs a load error, nothing is fetched from the internet.

## What's here

| File | Made by | Notes |
|---|---|---|
| `three.bundle.js` | `node tools/build-three.mjs` | three.js (version pinned exactly in `tools/package.json`) + `GLTFLoader` + `KTX2Loader`, one IIFE that sets `window.THREE` |
| `basis/` | `node tools/build-three.mjs` | the Basis transcoder copied from the same three release (`examples/jsm/libs/basis/`) |
| `fonts.css` + `fonts/` | `tools/fetch-vendor.ps1` | self-hosted woff2 for the families `css/styles.css` uses |

## three.js

Rebuild after changing the pin:

```
cd tools && npm i
node tools/build-three.mjs
node tools/ktx2-harness.js
```

The bundle copies the module namespace into a plain object, so `THREE.ShaderChunk` stays the
same mutable object three compiles from (`js/haze.js` writes into it). Add any other example
module the game needs to the entry in `build-three.mjs` and expose it on `THREE` there.
The transcoder must come from the same release as `KTX2Loader` (the ktx2 harness compares the
wasm with `tools/node_modules/three`).

## `fonts.css` is GENERATED: do not hand-edit it

`tools/fetch-vendor.ps1` writes it from Google's CSS with the URLs rewritten to local copies.
Its `$FontFamilies` / `$FontQuery` must match what `css/styles.css` actually asks for (it drifted
once: Orbitron to Russo One, and offline builds fell back to `monospace` unnoticed). Check 5 of
`tools/offline-harness.js` cross-checks every family in `css/styles.css` against the `@font-face`
rules on disk. **After changing a font in `css/styles.css`, re-run the fetch script and the harness.**

```powershell
powershell -ExecutionPolicy Bypass -File tools\fetch-vendor.ps1
node tools\offline-harness.js
```
