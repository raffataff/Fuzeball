/* build_moon_pitch.mjs  --  the MOON pitch: regolith, raked bands, worn paint -> GLB

     node tools/build_moon_pitch.mjs            (from the repo root or tools/; after `npm i` in tools/)
     node tools/ktx2-encode.mjs assets/pitches/pitch_moon.glb

   The dust is the Moon room's own regolith (tools/build/moon/, from build_moon_base.py), tiled at
   the room's 40-unit repeat so the pitch and the crater floor outside the dome are one material.
   What a groundskeeper would do to it: rake it in bands across the table (the Moon's mowing
   stripes: a slightly lighter/darker band, streaked along the pull), then paint the
   markings with a roller that didn't quite cover (the dust shows through, worn where the ball runs).

   Layout, markings and the GLB writer are shared with the other generated pitches (pitchlib.mjs).
   Masters are not kept: this script IS the master, it is deterministic. */
import { P, L, WD, W, H, PPU, clamp, sstep, hash, fbm, raw, samp, lineDist, spot, writePitch } from './pitchlib.mjs';

// ---- the numbers that matter (game units, 1 = 1 cm) --------------------------------------------
const TILE = 40;                       // regolith repeat, = build_moon_base.py TILE
const BANDS = 12;                      // rake bands along the table (10 units each)
const STREAK = [1.4, 0.07];            // rake streak noise frequency across / along the pull (per unit)
                                       // IRREGULAR on purpose: evenly spaced grooves read as CRT scanlines
                                       // from the overhead camera (a ~5 px period on screen)
const LINE_HW = 0.3;                   // painted line half-width, units
const PAINT = [0.80, 0.78, 0.74];      // paint albedo (linear-ish 0..1 in sRGB space), a dusty off-white
const ROUGH = 0.95, ROUGH_PAINT = 0.8;
const EMISSIVE = 0.06;                 // albedo-as-emissive, like the other pitches, so it never goes black

// ---- build the three images ---------------------------------------------------------------------
const alb = await raw(P('tools/build/moon/moon_regolith_albedo.png'));
const nrm = await raw(P('tools/build/moon/moon_regolith_normal.png'));
const A = Buffer.alloc(W * H * 3), N = Buffer.alloc(W * H * 3), M = Buffer.alloc(W * H * 3);
const ca = [0, 0, 0], cn = [0, 0, 0], cb = [0, 0, 0], cm = [0, 0, 0], aa = 1 / PPU;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = -L / 2 + (i + 0.5) / PPU, z = -WD / 2 + (j + 0.5) / PPU, k = (j * W + i) * 3;
  // two samples of the tile, the second turned 90 degrees and rescaled, blended by a slow noise,
  // so the 40-unit repeat never lines up into a visible grid (the normal is turned with it)
  samp(alb, x / TILE, z / TILE, ca); samp(nrm, x / TILE, z / TILE, cn);
  const bw = sstep(0.38, 0.62, fbm(x * 0.045 + 5, z * 0.045 + 9, 3));
  if (bw > 0) {
    const u2 = z / (TILE * 0.83) + 0.37, v2 = -x / (TILE * 0.83) + 0.61;
    samp(alb, u2, v2, cb); samp(nrm, u2, v2, cm);
    const rx = cm[1], ry = 255 - cm[0];               // rotate the tangent-space xy with the sample
    for (let c = 0; c < 3; c++) ca[c] += (cb[c] - ca[c]) * bw;
    cn[0] += (rx - cn[0]) * bw; cn[1] += (ry - cn[1]) * bw; cn[2] += (cm[2] - cn[2]) * bw;
  }
  // large scale: fresher/older dust, and the raked bands
  const big = 0.9 + 0.2 * fbm(x * 0.035 + 11, z * 0.035 - 4, 4);
  const band = Math.floor((x + L / 2) / (L / BANDS)) & 1;
  const bandShade = band ? 1.06 : 0.94;
  // rake streaks: noise stretched along the pull (z), so the dust looks combed without any regular
  // spacing; the slope is its x-derivative for the normal map. Fainter near the band edges
  const bx = ((x + L / 2) % (L / BANDS)) / (L / BANDS), edge = sstep(0, 0.06, bx) * sstep(1, 0.94, bx);
  const sk = (xx) => fbm(xx * STREAK[0] + band * 17.3, z * STREAK[1], 3), e = 0.08, s0 = sk(x);
  const gSlope = (sk(x + e) - sk(x - e)) / (2 * e) * 0.18 * edge, gShade = 1 + 0.07 * (s0 - 0.5) * edge;
  // paint: a line or a spot, anti-aliased, then worn through to the dust
  const ld = Math.min(lineDist(x, z) - LINE_HW, spot(x, z));
  let cov = sstep(aa, -aa, ld);
  if (cov > 0) {
    const wear = fbm(x * 0.45 + 3, z * 0.45 + 7, 4), speck = hash(i * 0.73, j * 1.31);
    cov *= sstep(0.2, 0.4, wear) * (speck < 0.12 ? 0.35 : 1) * 0.88;
  }
  // albedo: dust x variation, then paint over it (the paint keeps a little of the dust's texture)
  const lum = (ca[0] + ca[1] + ca[2]) / 765;
  for (let c = 0; c < 3; c++) {
    const dust = ca[c] / 255 * big * bandShade * gShade;
    const paint = PAINT[c] * (0.82 + 0.3 * lum);
    A[k + c] = clamp(Math.round((dust * (1 - cov) + paint * cov) * 255), 0, 255);
  }
  // normal: regolith + groove slope along x (tangent = +u = +x), flattened under paint
  let nx = (cn[0] / 127.5 - 1), ny = (cn[1] / 127.5 - 1), nz = (cn[2] / 127.5 - 1);
  nx = nx * 0.9 - gSlope; ny *= 0.9;
  const fl = 1 - 0.6 * cov; nx *= fl; ny *= fl;
  const nl = Math.hypot(nx, ny, nz) || 1;
  N[k] = Math.round((nx / nl * 0.5 + 0.5) * 255); N[k + 1] = Math.round((ny / nl * 0.5 + 0.5) * 255); N[k + 2] = Math.round((nz / nl * 0.5 + 0.5) * 255);
  // metallicRoughness: R unused (occlusion slot), G roughness, B metal
  M[k] = 255; M[k + 1] = Math.round((ROUGH + (ROUGH_PAINT - ROUGH) * cov) * 255); M[k + 2] = 0;
}
await writePitch('moon', A, N, M, EMISSIVE);
