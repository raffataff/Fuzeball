# fetch-vendor.ps1 — download Fuzeball's runtime dependencies into ./vendor so the game boots
# with NO network access at all (Electron / Steam wrapper, or a double-clicked file://).
#
#   powershell -ExecutionPolicy Bypass -File tools\fetch-vendor.ps1
#
# index.html no longer falls back to a CDN (see CDN_FALLBACK in its loader) and no longer links
# Google Fonts, so vendor/ is not an optimisation any more — it is REQUIRED. Run this after a
# fresh clone, and again any time css/styles.css changes which font families it asks for.
#
# Fetches, at the exact versions index.html pins:
#   three.min.js      r128
#   GLTFLoader.js     three 0.128
#   WorkerPool.js     three 0.137.5   (KTX2Loader constructs THREE.WorkerPool — must load first)
#   KTX2Loader.js     three 0.137.5   (r128 has no KTX2Loader at all — see vendor/basis/README.md)
#   basis/            three 0.137.5   ONLY IF MISSING — see the guard below, this one is pinned
#   fonts/ + fonts.css                self-hosted woff2 for the families css/styles.css uses
#
# THE FONT LIST IS NOT DECORATIVE. $FontFamilies below must match what css/styles.css actually
# asks for. It drifted once already: the game moved Orbitron -> Russo One, this script was
# updated, vendor/fonts.css was never regenerated, and every offline build quietly rendered the
# dev overlays in monospace for weeks. `node tools\offline-harness.js` now fails on that.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root   = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
$fonts  = Join-Path $vendor 'fonts'
$basis  = Join-Path $vendor 'basis'
New-Item -ItemType Directory -Force -Path $vendor, $fonts, $basis | Out-Null

# Google Fonts CSS query — the families css/styles.css names, with the weights it uses.
# Russo One ships ONE weight (400) so it takes no :wght list; Rajdhani ships 500/600/700.
$FontQuery = 'family=Russo+One&family=Rajdhani:wght@500;600;700&display=swap'
# Families the generated vendor/fonts.css MUST end up declaring. Checked at the end.
$FontFamilies = @('Russo One', 'Rajdhani')

function Get-File($url, $out) {
  Write-Host "  down  $url"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host "Fuzeball vendor fetch -> $vendor"

# --- JS libraries: the exact versions index.html pins ---------------------------------------
Get-File 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'                (Join-Path $vendor 'three.min.js')
Get-File 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js'     (Join-Path $vendor 'GLTFLoader.js')
Get-File 'https://cdn.jsdelivr.net/npm/three@0.137.5/examples/js/utils/WorkerPool.js'       (Join-Path $vendor 'WorkerPool.js')
Get-File 'https://cdn.jsdelivr.net/npm/three@0.137.5/examples/js/loaders/KTX2Loader.js'     (Join-Path $vendor 'KTX2Loader.js')

# --- Basis transcoder: FETCH ONLY IF MISSING -------------------------------------------------
# vendor/basis/ is a deliberately hand-pinned r137 copy that was verified end-to-end against the
# r128 core (see vendor/basis/README.md: "Do not 'upgrade' these to match three's r128 pin. That
# is the bug, not the inconsistency."). Re-downloading it on every run would let a jsdelivr-side
# change silently replace a verified binary, so this only fills an EMPTY folder and then checks
# the wasm is the build the README documents.
$wasmPath  = Join-Path $basis 'basis_transcoder.wasm'
$wasmBytes = 499935   # r137's build: has KTX2 container + Zstandard. r128's (440,267) does not.
if (-not (Test-Path $wasmPath)) {
  Write-Host "  basis/ is empty - fetching the r137 transcoder"
  Get-File 'https://cdn.jsdelivr.net/npm/three@0.137.5/examples/js/libs/basis/basis_transcoder.js'   (Join-Path $basis 'basis_transcoder.js')
  Get-File 'https://cdn.jsdelivr.net/npm/three@0.137.5/examples/js/libs/basis/basis_transcoder.wasm' $wasmPath
} else {
  Write-Host "  keep  vendor/basis/ (hand-pinned r137 - see its README)"
}
$actual = (Get-Item $wasmPath).Length
if ($actual -ne $wasmBytes) {
  Write-Warning "basis_transcoder.wasm is $actual bytes, expected $wasmBytes (the r137 build). If this is r128's 440,267-byte copy, KTX2 textures will not transcode. See vendor/basis/README.md."
}

# --- Fonts: ask Google for the CSS as a modern browser (so it serves woff2), download each
#     file, and rewrite the CSS to point at the local copies. The GENERATED file is what
#     index.html links; there is no remote font link left in the page. ------------------------
$cssUrl = "https://fonts.googleapis.com/css2?$FontQuery"
$ua     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
$css    = (Invoke-WebRequest -Uri $cssUrl -UseBasicParsing -Headers @{ 'User-Agent' = $ua }).Content

# Clear stale woff2 first. Without this a family REMOVED from $FontFamilies leaves its files
# behind forever, which is how vendor/fonts/ ended up carrying ~250KB of dead Orbitron.
Get-ChildItem -Path $fonts -Filter '*.woff2' -File | Remove-Item -Force

$i = 0
foreach ($m in [regex]::Matches($css, 'url\((https://[^)]+\.woff2)\)')) {
  $u    = $m.Groups[1].Value
  $name = "font_$i.woff2"; $i++
  Get-File $u (Join-Path $fonts $name)
  $css  = $css.Replace($u, "fonts/$name")
}
$header = "/* GENERATED by tools\fetch-vendor.ps1 - DO NOT HAND-EDIT. Regenerate after changing`r`n   the font families in css/styles.css. Source query: $FontQuery */`r`n"
Set-Content -Path (Join-Path $vendor 'fonts.css') -Value ($header + $css) -Encoding UTF8

# --- Verify the generated CSS declares every family we said it would ------------------------
$missing = @()
foreach ($f in $FontFamilies) { if ($css -notmatch [regex]::Escape("font-family: '$f'")) { $missing += $f } }
if ($missing.Count) {
  throw "vendor/fonts.css is missing @font-face for: $($missing -join ', '). Google's CSS did not serve them - check `$FontQuery against the families css/styles.css asks for."
}

# --- Leftovers that no longer belong ---------------------------------------------------------
if (Test-Path (Join-Path $vendor 'fonts.css.bak')) { Remove-Item (Join-Path $vendor 'fonts.css.bak') -Force }

Write-Host ""
Write-Host "done: 4 JS libs + $i font files vendored. Families: $($FontFamilies -join ', ')."
Write-Host "verify with:  node tools\offline-harness.js"
