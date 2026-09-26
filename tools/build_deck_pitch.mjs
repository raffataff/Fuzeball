/* build_deck_pitch.mjs  --  the DECK PLATE pitch: Void's steel tread plate, painted -> GLB

     node tools/build_deck_pitch.mjs            (from the repo root or tools/; after `npm i` in tools/)
     node tools/ktx2-encode.mjs assets/pitches/pitch_deck.glb

   The same steel as the deck the Void table is bolted to (build_void_asteroid.py deck_textures),
   ported rather than reused: that texture is baked for the deck (the table's contact shadow, the
   legs, its own seams), so a pitch gets the RECIPE at the same world scale instead. Diamond tread on
   a 2.8-unit lattice, 12 bolted plates, a rolled rim, rust bleeding out of the seams, tread tops
   polished where the ball runs. Then somebody painted a pitch on it: worn white markings, and the
   goal boxes in Federation blue (the deck's own border paint).

   Layout, markings and the GLB writer are shared with the other generated pitches (pitchlib.mjs).
   Masters are not kept: this script IS the master, it is deterministic. */
import { L, WD, W, H, PPU, clamp, sstep, hash, fbm, lineDist, spot, writePitch } from './pitchlib.mjs';

// ---- the numbers that matter (game units, 1 = 1 cm) --------------------------------------------
const TREAD = 2.8;                     // tread lattice, = the Void deck
const SEAMS_X = [-30, 0, 30], SEAMS_Z = [-17, 17];   // plate seams: 12 plates, none through the spots
const BOLT_STEP = 5, BOLT_OFF = 1.6, BOLT_R = 0.55;
const LINE_HW = 0.3;                   // painted line half-width
const STEEL = 0x44484c, SCUFF = 0x7c8084, RUST = 0x5e3419, WHITE = 0xc8cbc4, BLUE = 0x1b4a6b;
const EMISSIVE = 0.05;

const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const cS = rgb(STEEL), cSc = rgb(SCUFF), cR = rgb(RUST), cW = rgb(WHITE), cB = rgb(BLUE);
const X0 = -L / 2, Z0 = -WD / 2, aa = 1 / PPU;
const px = (i) => X0 + (i + 0.5) / PPU, pz = (j) => Z0 + (j + 0.5) / PPU;

// ---- pass 1: the height field (tread, seams, bolts, rim) ----------------------------------------
const Hh = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);
const boltsLine = (dl, along, off) => { const a = along - Math.round(along / BOLT_STEP) * BOLT_STEP;
  const rr = Math.hypot(dl - off, a); return Math.sqrt(clamp(1 - (rr / BOLT_R) ** 2, 0, 1)); };
const c45 = Math.SQRT1_2;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = px(i), z = pz(j), k = j * W + i;
  // tread: lozenges, alternating +-45 degrees per cell
  const ci = Math.floor(x / TREAD), cj = Math.floor(z / TREAD);
  const lx = (x / TREAD - ci - 0.5) * TREAD, ly = (z / TREAD - cj - 0.5) * TREAD, sg = ((ci + cj) & 1) ? -1 : 1;
  const ru = c45 * (lx + sg * ly), rv = c45 * (-sg * lx + ly), e = (ru / 1.05) ** 2 + (rv / 0.3) ** 2;
  let h = 0.35 * sstep(0, 1, 1 - e);
  // seams, and the smooth rolled rim
  let ds = 99; for (const s of SEAMS_X) ds = Math.min(ds, Math.abs(x - s)); for (const s of SEAMS_Z) ds = Math.min(ds, Math.abs(z - s));
  const groove = 1 - sstep(0.15, 0.4, ds);
  h = h * sstep(0.4, 1.2, ds) - 0.5 * groove;
  const edge = Math.min(L / 2 - Math.abs(x), WD / 2 - Math.abs(z));
  h *= sstep(1.2, 2.2, edge);
  // bolts either side of every seam, and round the rim
  let bolt = 0;
  for (const s of SEAMS_X) for (const o of [-BOLT_OFF, BOLT_OFF]) bolt = Math.max(bolt, boltsLine(x - s, z, o));
  for (const s of SEAMS_Z) for (const o of [-BOLT_OFF, BOLT_OFF]) bolt = Math.max(bolt, boltsLine(z - s, x, o));
  bolt = Math.max(bolt, boltsLine(edge, Math.abs(x) / (L / 2) > Math.abs(z) / (WD / 2) ? z : x, 1.7));
  Hh[k] = Math.max(h, 0.6 * bolt); G[k] = groove; B[k] = bolt;
}

// ---- pass 2: colour, normal, roughness/metal ----------------------------------------------------
const A = Buffer.alloc(W * H * 3), N = Buffer.alloc(W * H * 3), M = Buffer.alloc(W * H * 3);
const col = [0, 0, 0];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = px(i), z = pz(j), k = j * W + i, k3 = k * 3, h = Hh[k], groove = G[k], bolt = B[k];
  const n1 = fbm(x * 0.05 + 3, z * 0.05 + 1, 4), n2 = fbm(x * 0.4 + 9, z * 0.4 + 2, 4), n3 = fbm(x * 1.5 + 5, z * 1.5 + 8, 3);
  let rough = 0.5 + 0.15 * n2, metal = 0.85;
  const sh = (0.8 + 0.4 * n1) * (0.92 + 0.16 * n3);
  for (let c = 0; c < 3; c++) col[c] = cS[c] * sh;
  // tread tops polished where the ball runs: most down the middle, less by the walls
  const run = 1 - 0.6 * sstep(14, 30, Math.abs(z));
  const scuff = clamp((h > 0.2 ? 0.6 : 0) * sstep(0.45, 0.8, n3) * run + 0.25 * sstep(0.6, 0.85, n2) * run, 0, 1);
  for (let c = 0; c < 3; c++) col[c] = col[c] * (1 - scuff * 0.45) + cSc[c] * scuff * 0.45;
  rough -= 0.12 * scuff;
  // paint: worn white markings, the goal boxes in Federation blue
  const wear = sstep(0.3, 0.55, fbm(x * 0.25 + 7, z * 0.25 + 3, 4) * 0.6 + n3 * 0.4);
  const X = L / 2 - 0.8, gb = Math.abs(x) > X - 8 && Math.abs(x) < X && Math.abs(z) < 11;
  const pb = gb ? 0.85 * wear : 0;
  const pw = sstep(aa, -aa, Math.min(lineDist(x, z) - LINE_HW, spot(x, z))) * sstep(0.25, 0.5, fbm(x * 0.3 + 1, z * 0.3 + 4, 4) * 0.5 + n3 * 0.5)
    * (hash(i * 0.73, j * 1.31) < 0.1 ? 0.4 : 1);
  for (const [m, cc] of [[pb, cB], [pw, cW]]) {
    if (m <= 0) continue;
    for (let c = 0; c < 3; c++) col[c] = col[c] * (1 - m) + cc[c] * (0.85 + 0.15 * n2) * m;
    rough = rough * (1 - m) + 0.68 * m; metal *= 1 - m;
  }
  // rust and grime bleeding out of the seams and bolts
  const rust = clamp((groove * 0.8 + bolt * 0.9) * sstep(0.4, 0.75, fbm(x * 0.6 + 2, z * 0.6 + 6, 4)) + 0.25 * sstep(0.62, 0.8, n1), 0, 1);
  for (let c = 0; c < 3; c++) col[c] = col[c] * (1 - 0.7 * rust) + cR[c] * 0.7 * rust;
  rough = rough * (1 - rust) + 0.85 * rust; metal *= 1 - 0.8 * rust;
  for (let c = 0; c < 3; c++) A[k3 + c] = clamp(Math.round(col[c] * (1 - 0.35 * groove) * 255), 0, 255);
  // normal from the height field: +x = +u; +y = up the image (glTF/OpenGL), i.e. toward -z, so n.y = +dh/dz
  const hx = (Hh[j * W + Math.min(W - 1, i + 1)] - Hh[j * W + Math.max(0, i - 1)]) * PPU / 2;
  const hz = (Hh[Math.min(H - 1, j + 1) * W + i] - Hh[Math.max(0, j - 1) * W + i]) * PPU / 2;
  const nl = Math.hypot(hx, hz, 1);
  N[k3] = Math.round((-hx / nl * 0.5 + 0.5) * 255); N[k3 + 1] = Math.round((hz / nl * 0.5 + 0.5) * 255); N[k3 + 2] = Math.round((1 / nl * 0.5 + 0.5) * 255);
  M[k3] = 255; M[k3 + 1] = Math.round(clamp(rough, 0.05, 1) * 255); M[k3 + 2] = Math.round(clamp(metal, 0, 1) * 255);
}
await writePitch('deck', A, N, M, EMISSIVE);
