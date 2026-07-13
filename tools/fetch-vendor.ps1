# fetch-vendor.ps1 — download Fuzeball's runtime dependencies into ./vendor so the
# game boots fully OFFLINE (Electron / Steam wrapper, or a double-clicked file://).
#
# index.html already prefers vendor/ and falls back to the CDN, so the game runs online
# without this; run it once before packaging an offline build.
#
#   powershell -ExecutionPolicy Bypass -File tools\fetch-vendor.ps1
#
# Fetches: three.min.js (r128), GLTFLoader.js (0.128), and self-hosted Orbitron/Rajdhani
# woff2 + a generated vendor/fonts.css pointing at the local copies.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root   = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
$fonts  = Join-Path $vendor 'fonts'
New-Item -ItemType Directory -Force -Path $vendor, $fonts | Out-Null

function Get-File($url, $out) {
  Write-Host "  down  $url"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host "Fuzeball vendor fetch -> $vendor"

# --- JS libraries: the exact versions the game targets (see index.html / CLAUDE.md) ---
Get-File 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'                 (Join-Path $vendor 'three.min.js')
Get-File 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js'      (Join-Path $vendor 'GLTFLoader.js')

# --- fonts: request the Google CSS as a modern browser (so it serves woff2), download each
#     font file, and rewrite the CSS to reference the local copies. ---
$cssUrl = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Rajdhani:wght@500;600;700&display=swap'
$ua     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
$css    = (Invoke-WebRequest -Uri $cssUrl -UseBasicParsing -Headers @{ 'User-Agent' = $ua }).Content

$i = 0
foreach ($m in [regex]::Matches($css, 'url\((https://[^)]+\.woff2)\)')) {
  $u    = $m.Groups[1].Value
  $name = "font_$i.woff2"; $i++
  Get-File $u (Join-Path $fonts $name)
  $css  = $css.Replace($u, "fonts/$name")
}
Set-Content -Path (Join-Path $vendor 'fonts.css') -Value $css -Encoding UTF8

Write-Host "done: 2 JS libs + $i font files vendored. Offline build is ready."
