'use strict';
// Fuze Clip: the Federation display face. Glyphs are centreline strokes built upright, unioned, clipped to the
// cap band and sheared by P.slant (20°, so every horizontal end is cut at that angle).
const pc = require('polygon-clipping');

const H = 700;   // cap height, 1000 upm

// shipped parameters (Clip). w/wh = vertical/horizontal stroke, c = corner clip, dc = D/U/B-waist clip, gap = pair spacing
const PARAMS = { slant: 20, miter: 5, cap: 150, deep: 90, minGap: 52, dc: 150, uc: 60, zc: 150, w: 160, wh: 136, pol: 'diag', c: 200, gap: 64, hook: 0, wn: 600, wA: 690, wm: 800, ww: 880, wd: 580, w1: 400 };

// glyphs that run past the cap band: [yMin, yMax]
const BAND = { Q: [-90, H], ',': [-150, H], ';': [-150, H], '(': [-110, H + 70], ')': [-110, H + 70], '_': [-140, H] };

// --- stroke geometry ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = a => Math.hypot(a[0], a[1]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

// chamfer flag: 1 follows the policy (none / all / diag = top-left and bottom-right only), 2 / 3 always cut (size dc / uc)
function chamfer(pts, closed, P) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const v = pts[i], flag = v[2];
    if (!flag || (!closed && (i === 0 || i === n - 1)) || (flag < 2 && P.pol === 'none')) { out.push([v[0], v[1]]); continue; }
    const p = pts[(i + n - 1) % n], q = pts[(i + 1) % n];
    const a = nrm(sub(p, v)), b = nrm(sub(q, v));
    const bis = nrm([a[0] + b[0], a[1] + b[1]]), ox = -bis[0], oy = -bis[1];
    if (flag === 1 && P.pol === 'diag' && !((ox < -0.1 && oy > 0.1) || (ox > 0.1 && oy < -0.1))) { out.push([v[0], v[1]]); continue; }
    const c = Math.min(flag === 2 ? P.dc : flag === 3 ? P.uc : P.c, len(sub(p, v)) * 0.4, len(sub(q, v)) * 0.4);
    out.push([v[0] + a[0] * c, v[1] + a[1] * c], [v[0] + b[0] * c, v[1] + b[1] * c]);
  }
  return out;
}

// the nib is wide across verticals (w) and thin across horizontals (wh)
const thick = (d, P) => Math.hypot(P.wh * d[0], P.w * d[1]);

function isect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

function strokePoly(pts, closed, P, ext) {
  pts = pts.map(p => [p[0], p[1]]);
  if (!closed && ext) {
    const e = P.w * 2.5;
    if (ext[0]) { const d = nrm(sub(pts[0], pts[1])); pts[0] = [pts[0][0] + d[0] * e, pts[0][1] + d[1] * e]; }
    if (ext[1]) { const k = pts.length - 1, d = nrm(sub(pts[k], pts[k - 1])); pts[k] = [pts[k][0] + d[0] * e, pts[k][1] + d[1] * e]; }
  }
  const n = pts.length, segs = closed ? n : n - 1, D = [], T = [], N = [];
  for (let i = 0; i < segs; i++) { const d = nrm(sub(pts[(i + 1) % n], pts[i])); D.push(d); T.push(thick(d, P) / 2); N.push([-d[1], d[0]]); }
  const side = s => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = closed ? (k + segs - 1) % segs : k - 1, b = closed ? k % segs : k;
      if (!closed && k === 0) { out.push([pts[0][0] + s * N[0][0] * T[0], pts[0][1] + s * N[0][1] * T[0]]); continue; }
      if (!closed && k === n - 1) { const j = segs - 1; out.push([pts[k][0] + s * N[j][0] * T[j], pts[k][1] + s * N[j][1] * T[j]]); continue; }
      const pa = [pts[k][0] + s * N[a][0] * T[a], pts[k][1] + s * N[a][1] * T[a]], pb = [pts[k][0] + s * N[b][0] * T[b], pts[k][1] + s * N[b][1] * T[b]];
      const x = isect(pa, D[a], pb, D[b]);
      if (!x || len(sub(x, pts[k])) > P.miter * Math.max(T[a], T[b])) out.push(pa, pb); else out.push(x);
    }
    return out;
  };
  const L = side(1), R = side(-1);
  if (closed) {
    const ar = r => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s); };
    return [ar(L) > ar(R) ? [L, R] : [R, L]];
  }
  return [[L.concat(R.reverse())]];
}

// --- glyph table: [width, strokes]. A stroke is {p:[[x,y,chamferFlag?]...], c:closed, e:[extendStart,extendEnd], k:weight scale} ---
const S = (p, e) => ({ p, c: false, e }), Lp = p => ({ p, c: true });

function table(P) {
  const w = P.w, wh = P.wh, h = w / 2, v = wh / 2, T = H - v, B = v, M = H * 0.5;
  const G = {}, def = (ch, W, fn, band, base) => { G[ch] = { W, fn, band, base }; };
  const box = W => ({ L: h, R: W - h });
  const stem = x => S([[x, 0], [x, H]]), bar = (x0, x1, y) => S([[x0, y], [x1, y]]);
  const dot = x => S([[x, 0], [x, w * 0.95]]);
  const thin = (s, k) => ({ ...s, k });

  def('A', P.wA, W => { const x0 = w * 0.55, x1 = W - w * 0.55, xm = W / 2, yb = H * 0.3, xl = y => x0 + (xm - x0) * y / H, xr = y => x1 - (x1 - xm) * y / H;
    return [S([[x0, 0], [xm, H]], [1, 1]), S([[xm, H], [x1, 0]], [1, 1]), bar(xl(yb) + 10, xr(yb) - 10, yb)]; });
  def('B', P.wn, W => { const { L, R } = box(W); return [stem(L), S([[L, T], [R, T, 1], [R, M, 2], [L, M]]), S([[L, M], [R, M, 2], [R, B, 1], [L, B]])]; });
  def('C', P.wn, W => { const { L, R } = box(W), k = P.hook; return [S(k ? [[R, T - k], [R, T], [L, T, 1], [L, B, 1], [R, B], [R, B + k]] : [[R, T], [L, T, 1], [L, B, 1], [R, B]])]; });
  def('D', P.wn, W => { const { L, R } = box(W); return [Lp([[L, T], [R, T, 2], [R, B, 2], [L, B]])]; });
  def('E', P.wn, W => { const { L, R } = box(W); return [stem(L), bar(L, R, T), bar(L, R - w * 0.4, M), bar(L, R, B)]; });
  def('F', P.wn, W => { const { L, R } = box(W); return [stem(L), bar(L, R, T), bar(L, R - w * 0.4, M)]; });
  def('G', P.wn, W => { const { L, R } = box(W), k = P.hook; return [S([[R, k ? T - k : T], [R, T], [L, T, 1], [L, B, 1], [R, B, 1], [R, H * 0.46], [W * 0.5, H * 0.46]])]; });
  def('H', P.wn, W => { const { L, R } = box(W); return [stem(L), stem(R), bar(L, R, M)]; });
  def('I', P.w, W => [stem(W / 2)]);
  def('J', P.wn, W => { const { L, R } = box(W); return [S([[R, H], [R, B, 1], [L, B, 1], [L, B + H * 0.3]])]; });
  def('K', P.wn, W => { const { L, R } = box(W), y0 = H * 0.38, t = 0.45, jx = L + t * (R - L), jy = y0 + t * (H - y0);
    return [stem(L), S([[L, y0], [R, H]], [0, 1]), S([[jx, jy], [R, 0]], [0, 1])]; });
  def('L', P.wn, W => { const { L, R } = box(W); return [S([[L, H], [L, B, 1], [R, B]])]; });
  def('M', P.wm, W => { const { L, R } = box(W); return [stem(L), stem(R), S([[L, H], [W / 2, H * 0.3], [R, H]], [1, 1])]; });
  def('N', P.wn, W => { const { L, R } = box(W); return [stem(L), stem(R), S([[L, H], [R, 0]], [1, 1])]; });
  def('O', P.wn, W => { const { L, R } = box(W); return [Lp([[L, T, 1], [R, T, 1], [R, B, 1], [L, B, 1]])]; });
  def('P', P.wn, W => { const { L, R } = box(W); return [stem(L), S([[L, T], [R, T, 1], [R, H * 0.4, 1], [L, H * 0.4]])]; });
  def('Q', P.wn, W => { const { L, R } = box(W); return [Lp([[L, T, 1], [R, T, 1], [R, B, 1], [L, B, 1]]), S([[W * 0.56, H * 0.32], [W - h * 0.2, -40]], [0, 1])]; });
  def('R', P.wn, W => { const { L, R } = box(W); return [stem(L), S([[L, T], [R, T, 1], [R, H * 0.42, 1], [L, H * 0.42]]), S([[W * 0.42, H * 0.42], [R, 0]], [0, 1])]; });
  def('S', P.wn, W => { const { L, R } = box(W), k = P.hook; return [S((k ? [[R, T - k]] : []).concat([[R, T], [L, T, 1], [L, M, 1], [R, M, 1], [R, B, 1], [L, B]], k ? [[L, B + k]] : []))]; });
  def('T', P.wn, W => [bar(0, W, T), stem(W / 2)]);
  def('U', P.wn, W => { const { L, R } = box(W), f = P.pol === 'diag' ? 3 : 1; return [S([[L, H], [L, B, f], [R, B, f], [R, H]])]; });
  def('V', P.wn, W => { const x0 = w * 0.55, x1 = W - w * 0.55; return [S([[x0, H], [W / 2, 0]], [1, 1]), S([[W / 2, 0], [x1, H]], [1, 1])]; });
  def('W', P.ww, W => { const x0 = w * 0.55, x1 = W - w * 0.55; return [S([[x0, H], [W * 0.27, 0], [W * 0.5, H * 0.74], [W * 0.73, 0], [x1, H]], [1, 1])]; });
  def('X', P.wn, W => { const x0 = w * 0.5, x1 = W - w * 0.5; return [S([[x0, H], [x1, 0]], [1, 1]), S([[x0, 0], [x1, H]], [1, 1])]; });
  def('Y', P.wn, W => { const x0 = w * 0.55, x1 = W - w * 0.55, yj = H * 0.45; return [S([[x0, H], [W / 2, yj]], [1, 0]), S([[x1, H], [W / 2, yj]], [1, 0]), S([[W / 2, yj + 20], [W / 2, 0]])]; });
  def('Z', P.wn, W => {
    const { L, R } = box(W), cc = P.zc, out = [bar(0, W, T), bar(0, W, B), { ...S([[R - w * 0.1, H], [L + w * 0.1, 0]], [1, 1]), k: 1.12 }];
    out.cuts = [[[-1, H + 1], [cc, H + 1], [-1, H - cc]], [[W + 1, -1], [W - cc, -1], [W + 1, cc]]];
    return out; });

  def('0', P.wd, W => { const { L, R } = box(W); return [Lp([[L, T, 1], [R, T, 1], [R, B, 1], [L, B, 1]])]; });
  def('1', P.w1, W => { const x = W - h; return [stem(x), S([[x, H], [0, H * 0.7]], [1, 0])]; });
  def('2', P.wd, W => { const { L, R } = box(W); return [S([[L, T - H * 0.2], [L, T], [R, T, 1], [R, M, 1], [L, M, 1], [L, B], [R, B]])]; });
  def('3', P.wd, W => { const { L, R } = box(W); return [S([[L, T], [R, T, 1], [R, B, 1], [L, B]]), bar(W * 0.34, R, M)]; });
  def('4', P.wd, W => { const { L } = box(W), xs = W * 0.68, yb = H * 0.32; return [stem(xs), S([[xs, H], [L, yb]], [1, 0]), bar(0, W, yb)]; });
  def('5', P.wd, W => { const { L, R } = box(W); return [S([[R, T], [L, T, 1], [L, H * 0.52, 1], [R, H * 0.52, 1], [R, B, 1], [L, B]])]; });
  def('6', P.wd, W => { const { L, R } = box(W); return [S([[R, T], [L, T, 1], [L, B, 1], [R, B, 1], [R, H * 0.5, 1], [L, H * 0.5]])]; });
  def('7', P.wd, W => { const { R } = box(W); return [bar(0, W, T), S([[R, T], [W * 0.3, 0]], [0, 1])]; });
  def('8', P.wd, W => { const { L, R } = box(W); return [Lp([[L, T, 1], [R, T, 1], [R, B, 1], [L, B, 1]]), bar(L, R, M)]; });
  def('9', P.wd, W => { const { L, R } = box(W); return [S([[L, B], [R, B, 1], [R, T, 1], [L, T, 1], [L, H * 0.5, 1], [R, H * 0.5]])]; });

  def('.', P.w, W => [dot(W / 2)]);
  def(',', P.w, W => [dot(W / 2), S([[W / 2, w * 0.5], [W / 2 - 120, -150]], [0, 1])]);
  def(':', P.w, W => [dot(W / 2), S([[W / 2, H * 0.52 - w * 0.5], [W / 2, H * 0.52 + w * 0.5]])]);
  def(';', P.w, W => [S([[W / 2, w * 0.5], [W / 2 - 120, -150]], [0, 1]), S([[W / 2, H * 0.52 - w * 0.5], [W / 2, H * 0.52 + w * 0.5]])]);
  def('-', P.wn * 0.7, W => [bar(0, W, H * 0.45)]);
  def('_', P.wn * 0.8, W => [bar(0, W, -60)]);
  def('=', P.wn * 0.8, W => [bar(0, W, H * 0.33), bar(0, W, H * 0.67)]);
  def('!', P.w, W => [dot(W / 2), S([[W / 2, H * 0.3], [W / 2, H]])]);
  def('?', P.wn, W => { const { L, R } = box(W); return [S([[L, T - H * 0.14], [L, T], [R, T, 1], [R, H * 0.5, 1], [W / 2, H * 0.5], [W / 2, H * 0.34]]), dot(W / 2)]; });
  def('/', P.wn * 0.8, W => [S([[W * 0.1, 0], [W * 0.9, H]], [1, 1])]);
  def("'", P.w, W => [S([[W / 2, H * 0.62], [W / 2, H]])]);
  def('"', P.w * 2.1, W => [thin(S([[W * 0.22, H * 0.62], [W * 0.22, H]]), 0.55), thin(S([[W * 0.78, H * 0.62], [W * 0.78, H]]), 0.55)]);
  def('+', P.wn * 0.8, W => [bar(0, W, H * 0.47), S([[W / 2, H * 0.47 - W / 2 + h], [W / 2, H * 0.47 + W / 2 - h]])]);
  def('·', P.w, W => [S([[W / 2, H * 0.5 - w * 0.5], [W / 2, H * 0.5 + w * 0.5]])]);
  def('–', P.wn * 0.95, W => [bar(0, W, H * 0.45)]);
  def('—', P.wn * 1.4, W => [bar(0, W, H * 0.45)]);
  def('×', P.wn * 0.8, W => { const r = W / 2 - h * 0.8, y = H * 0.47; return [thin(S([[W / 2 - r, y - r], [W / 2 + r, y + r]]), 0.75), thin(S([[W / 2 - r, y + r], [W / 2 + r, y - r]]), 0.75)]; });
  def('°', P.w * 1.5, W => { const a = w * 0.55 / 2, b = wh * 0.55 / 2; return [{ ...Lp([[a, H - b], [W - a, H - b], [W - a, H * 0.58 + b], [a, H * 0.58 + b]]), k: 0.55 }]; });
  def('%', P.wn * 1.15, W => { const k = 0.6, a = w * k / 2, b = wh * k / 2, ring = (x0, x1, y0, y1) => ({ ...Lp([[x0 + a, y1 - b], [x1 - a, y1 - b], [x1 - a, y0 + b], [x0 + a, y0 + b]]), k });
    return [thin(S([[W * 0.14, 0], [W * 0.86, H]], [1, 1]), 0.8), ring(0, W * 0.34, H * 0.52, H), ring(W * 0.62, W, 0, H * 0.48)]; });
  def('#', P.wn * 0.95, W => [thin(stem(W * 0.3), 0.7), thin(stem(W * 0.7), 0.7), thin(bar(0, W, H * 0.33), 0.7), thin(bar(0, W, H * 0.67), 0.7)]);
  def('&', P.wA, W => { const k = 0.85, a = w * k / 2, b = wh * k / 2, y0 = H * 0.48, x1 = W * 0.2, x2 = W * 0.66, L = a, B = b, T = H * 0.5 - b, dx = W * 0.3, dy = H * 0.62, xAt = y => dx + (dy - y) / dy * (W - dx);
    return [{ ...Lp([[x1 + a, H - b, 1], [x2 - a, H - b, 1], [x2 - a, y0 + b, 1], [x1 + a, y0 + b, 1]]), k },
      { ...S([[xAt(T) + 15, T], [L, T, 1], [L, B, 1], [xAt(B) - 30, B]]), k },
      { ...S([[dx, dy], [W, -20]], [0, 1]), k }]; });
  // triangles and arrows: solid heads (a filled polygon, no stroke), centred on the cap middle
  const fill = poly => ({ poly }), yc = H * 0.47, hh = H * 0.41;
  const head = (x, y, dx, dy, half) => fill(dx ? [[x, y], [x - dx, y + half], [x - dx, y - half]] : [[x, y], [x - half, y - dy], [x + half, y - dy]]);
  def('▲', P.wn * 1.05, W => [fill([[W / 2, yc + hh], [W, yc - hh], [0, yc - hh]])]);
  def('▼', P.wn * 1.05, W => [fill([[W / 2, yc - hh], [W, yc + hh], [0, yc + hh]])]);
  def('◀', P.wn * 0.82, W => [fill([[0, yc], [W, yc + hh], [W, yc - hh]])]);
  def('▶', P.wn * 0.82, W => [fill([[W, yc], [0, yc + hh], [0, yc - hh]])]);
  def('→', P.wn * 1.15, W => [thin(S([[0, yc], [W - 150, yc]]), 0.8), head(W, yc, 270, 0, H * 0.28)]);
  def('←', P.wn * 1.15, W => [thin(S([[150, yc], [W, yc]]), 0.8), head(0, yc, -270, 0, H * 0.28)]);
  def('↑', P.wn * 0.7, W => [thin(S([[W / 2, 0], [W / 2, H - 150]]), 0.8), head(W / 2, H, 0, 270, H * 0.28)]);
  def('↓', P.wn * 0.7, W => [thin(S([[W / 2, 150], [W / 2, H]]), 0.8), head(W / 2, 0, 0, -270, H * 0.28)]);
  def('↕', P.wn * 0.7, W => [thin(S([[W / 2, 150], [W / 2, H - 150]]), 0.8), head(W / 2, H, 0, 270, H * 0.28), head(W / 2, 0, 0, -270, H * 0.28)]);
  def('(', P.wn * 0.6, W => [S([[W - h, H + 60], [h, H * 0.5], [W - h, -60]])]);
  def(')', P.wn * 0.6, W => [S([[h, H + 60], [W - h, H * 0.5], [h, -60]])]);
  // symbols
  const box2 = (W, k) => ({ a: w * k / 2, b: wh * k / 2 });
  def('✓', P.wn * 0.85, W => [thin(S([[W * 0.06, H * 0.4], [W * 0.36, H * 0.1], [W, H * 0.82]]), 0.9)]);
  def('⊞', P.wn * 0.8, W => { const k = 0.7, { a, b } = box2(W, k), y0 = H * 0.04, y1 = H * 0.86, ym = (y0 + y1) / 2;
    return [{ ...Lp([[a, y1 - b], [W - a, y1 - b], [W - a, y0 + b], [a, y0 + b]]), k }, thin(bar(a, W - a, ym), k), thin(S([[W / 2, y0], [W / 2, y1]]), k)]; });
  def('⌖', P.wn * 0.85, W => { const k = 0.5, cx = W / 2, cy = H * 0.46, r = H * 0.2, e = H * 0.44;
    return [{ ...Lp([[cx - r, cy + r], [cx + r, cy + r], [cx + r, cy - r], [cx - r, cy - r]]), k }, thin(S([[cx, cy + r], [cx, cy + e]]), k), thin(S([[cx, cy - r], [cx, cy - e]]), k), thin(S([[0, cy], [cx - r, cy]]), k), thin(S([[cx + r, cy], [W, cy]]), k)]; });
  def('⟳', P.wn * 0.85, W => { const k = 0.6, a = w * k / 2, yt = H * 0.82, yb = H * 0.18;
    return [thin(S([[a, H * 0.55], [a, yt, 1], [W - a, yt, 1], [W - a, yb, 1], [W * 0.5, yb]]), k), head(W * 0.24, yb, -230, 0, H * 0.16)]; });

  // accents: marks over the capitals (from y 780) and below the baseline; a composite is the base letter plus its marks, spaced like the base
  const mt = s => thin(s, 0.55), md = x => thin(S([[x, 800], [x, 890]]), 0.6);
  const MARKS = {
    acute: W => [mt(S([[W / 2 - 70, 790], [W / 2 + 70, 930]]))], grave: W => [mt(S([[W / 2 - 70, 930], [W / 2 + 70, 790]]))],
    circ: W => [mt(S([[W / 2 - 120, 790], [W / 2, 915], [W / 2 + 120, 790]]))], caron: W => [mt(S([[W / 2 - 120, 915], [W / 2, 790], [W / 2 + 120, 915]]))],
    diaer: W => [md(W / 2 - 90), md(W / 2 + 90)], tilde: W => [mt(S([[W / 2 - 125, 805], [W / 2 - 45, 885], [W / 2 + 45, 805], [W / 2 + 125, 885]]))],
    ring: W => [{ ...Lp([[W / 2 - 55, 805], [W / 2 + 55, 805], [W / 2 + 55, 915], [W / 2 - 55, 915]]), k: 0.45 }],
    macron: W => [mt(S([[W / 2 - 105, 860], [W / 2 + 105, 860]]))], dot: W => [md(W / 2)],
    breve: W => [mt(S([[W / 2 - 115, 915], [W / 2 - 60, 800], [W / 2 + 60, 800], [W / 2 + 115, 915]]))],
    dacute: W => [mt(S([[W / 2 - 130, 790], [W / 2 - 10, 925]])), mt(S([[W / 2 + 10, 790], [W / 2 + 130, 925]]))],
    cedilla: W => [mt(S([[W / 2, 50], [W / 2, -100], [W / 2 - 70, -100]]))], ogonek: W => [mt(S([[W * 0.78, 50], [W * 0.78, -90], [W * 0.78 + 70, -150]]))],
    slash: W => [thin(S([[W * 0.08, H * 0.05], [W * 0.92, H * 0.95]]), 0.7)],
    dstroke: () => [thin(S([[-90, H * 0.5], [h + 60, H * 0.5]]), 0.6)], lstroke: () => [thin(S([[-40, H * 0.35], [h + 140, H * 0.63]]), 0.6)]
  };
  const OWN = { dstroke: 1, lstroke: 1 };   // these change the letter's outline, so they space on their own
  const comp = (code, base, mark) => { const s0 = G[base]; def(String.fromCodePoint(code), s0.W, W => { const s = s0.fn(W), out = s.concat(MARKS[mark](W).map(m => ({ ...m, mk: 1 }))); out.cuts = s.cuts; return out; }, undefined, OWN[mark] ? undefined : base); };
  [[0xC0, 'A', 'grave'], [0xC1, 'A', 'acute'], [0xC2, 'A', 'circ'], [0xC3, 'A', 'tilde'], [0xC4, 'A', 'diaer'], [0xC5, 'A', 'ring'], [0xC7, 'C', 'cedilla'],
   [0xC8, 'E', 'grave'], [0xC9, 'E', 'acute'], [0xCA, 'E', 'circ'], [0xCB, 'E', 'diaer'], [0xCC, 'I', 'grave'], [0xCD, 'I', 'acute'], [0xCE, 'I', 'circ'], [0xCF, 'I', 'diaer'],
   [0xD0, 'D', 'dstroke'], [0xD1, 'N', 'tilde'], [0xD2, 'O', 'grave'], [0xD3, 'O', 'acute'], [0xD4, 'O', 'circ'], [0xD5, 'O', 'tilde'], [0xD6, 'O', 'diaer'], [0xD8, 'O', 'slash'],
   [0xD9, 'U', 'grave'], [0xDA, 'U', 'acute'], [0xDB, 'U', 'circ'], [0xDC, 'U', 'diaer'], [0xDD, 'Y', 'acute'], [0x178, 'Y', 'diaer'],
   [0x100, 'A', 'macron'], [0x102, 'A', 'breve'], [0x104, 'A', 'ogonek'], [0x106, 'C', 'acute'], [0x10C, 'C', 'caron'], [0x10E, 'D', 'caron'], [0x110, 'D', 'dstroke'],
   [0x112, 'E', 'macron'], [0x116, 'E', 'dot'], [0x118, 'E', 'ogonek'], [0x11A, 'E', 'caron'], [0x11E, 'G', 'breve'], [0x12A, 'I', 'macron'], [0x130, 'I', 'dot'], [0x141, 'L', 'lstroke'],
   [0x143, 'N', 'acute'], [0x147, 'N', 'caron'], [0x14C, 'O', 'macron'], [0x150, 'O', 'dacute'], [0x158, 'R', 'caron'], [0x15A, 'S', 'acute'], [0x15E, 'S', 'cedilla'], [0x160, 'S', 'caron'],
   [0x162, 'T', 'cedilla'], [0x164, 'T', 'caron'], [0x16A, 'U', 'macron'], [0x16E, 'U', 'ring'], [0x170, 'U', 'dacute'], [0x179, 'Z', 'acute'], [0x17B, 'Z', 'dot'], [0x17D, 'Z', 'caron']
  ].forEach(c => comp(c[0], c[1], c[2]));
  def('Þ', P.wn, W => { const { L, R } = box(W); return [stem(L), S([[L, H * 0.78], [R, H * 0.78, 1], [R, H * 0.28, 1], [L, H * 0.28]])]; }, [0, H]);

  def(' ', P.wn * 0.55, () => []);
  return G;
}

// --- build: contours per glyph, outer rings clockwise and holes counter-clockwise (TrueType winding), already sheared ---
function build(P = PARAMS) {
  const G = table(P), out = {}, shear = Math.tan(P.slant * Math.PI / 180);
  for (const ch of Object.keys(G)) {
    const { W, fn, band, base } = G[ch], strokes = fn(W), pieces = [], marks = [];
    for (const s of strokes) {
      if (s.poly) { pieces.push([s.poly]); continue; }
      const Ps = s.k ? { ...P, w: P.w * s.k, wh: P.wh * s.k } : P;
      for (const poly of strokePoly(chamfer(s.p, s.c, P), s.c, Ps, s.e)) (s.mk ? marks : pieces).push(poly);
    }
    if (!pieces.length && !marks.length) { out[ch] = { W, contours: [], base: ch }; continue; }
    const rect = (y0, y1) => [[[-2000, y0], [4000, y0], [4000, y1], [-2000, y1]]], [y0, y1] = band || BAND[base || ch] || [0, H];
    let mp = pieces.length ? pc.intersection(pc.union(pieces[0], ...pieces.slice(1)), rect(y0, y1)) : [];
    if (strokes.cuts) mp = pc.difference(mp, ...strokes.cuts.map(c => [c]));
    if (marks.length) { const m = pc.intersection(pc.union(marks[0], ...marks.slice(1)), rect(-200, 1000)); mp = mp.length ? pc.union(mp, m) : m; }
    const contours = [];
    for (const poly of mp) poly.forEach((r, i) => {
      let pts = r.slice(0, -1).map(p => [Math.round(p[0] + (p[1] - H / 2) * shear), Math.round(p[1])]);
      pts = pts.filter((p, j) => { const q = pts[(j + 1) % pts.length]; return p[0] !== q[0] || p[1] !== q[1]; });
      let a = 0; for (let j = 0; j < pts.length; j++) { const p = pts[j], q = pts[(j + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
      if ((i === 0) === (a > 0)) pts.reverse();
      if (pts.length > 2) contours.push(pts);
    });
    out[ch] = { W, contours, base: base || ch };
  }
  return out;
}

// --- spacing: per pair, the clearance averaged over the height (deep pockets capped) equals P.gap, and never closer than P.minGap ---
function profiles(g) {
  const L = [], R = [];
  for (let y = 5; y < H; y += 10) {
    let lo = Infinity, hi = -Infinity;
    for (const r of g.contours) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) { const x = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    L.push(lo); R.push(hi);
  }
  return { L, R };
}

function spacing(G, P = PARAMS) {
  const pr = {}; for (const ch in G) if (G[ch].contours.length) pr[ch] = profiles(G[ch]);
  return (a, b) => {
    const A = pr[a], Bp = pr[b];
    if (!A || !Bp) return G[a].W + P.gap;
    const hiA = Math.max(...A.R.filter(isFinite)), loB = Math.min(...Bp.L.filter(isFinite));
    const f = x => {
      let s = 0;
      for (let i = 0; i < A.R.length; i++) {
        const ra = isFinite(A.R[i]) ? A.R[i] : hiA - P.deep, lb = isFinite(Bp.L[i]) ? Bp.L[i] : loB + P.deep;
        s += Math.min((lb + x) - ra, P.cap);
      }
      return s / A.R.length;
    };
    let lo = 0, hi = 2000; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) < P.gap) lo = m; else hi = m; }
    let tight = -Infinity;
    for (let i = 0; i < A.R.length; i++) if (isFinite(A.R[i]) && isFinite(Bp.L[i])) tight = Math.max(tight, A.R[i] - Bp.L[i] + P.minGap);
    return Math.max((lo + hi) / 2, tight);
  };
}

module.exports = { PARAMS, H, build, spacing };
