# vendor/

Local copies of the runtime dependencies so Fuzeball boots **offline** (Electron / Steam
wrapper, or a double-clicked `file://`).

This folder is populated by the fetch script — run it once from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File tools\fetch-vendor.ps1
```

That downloads:

- `three.min.js` — Three.js r128
- `GLTFLoader.js` — loader for the r128 build (three 0.128)
- `fonts/` + `fonts.css` — self-hosted Orbitron / Rajdhani (woff2)

`index.html` prefers these files and falls back to the CDN when they're absent, so the game
still runs online before this folder is filled. Fill it before packaging an offline build.
