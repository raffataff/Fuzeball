'use strict';
// Compiles tools/fuzefont.js into fonts/fuzeClip/FuzeClip.ttf (plain TrueType, straight-line outlines, class-based GPOS kerning from the spacing pass).
// Usage: node tools/build_font.js        (from the repo root or tools/; needs `npm i` in tools/ for polygon-clipping)
const fs = require('fs'), path = require('path');
const { PARAMS: P, H, build, spacing } = require('./fuzefont');

const OUT = path.join(__dirname, '..', 'fonts', 'fuzeClip', 'FuzeClip.ttf');
const NAMES = { 0: 'Copyright (c) 2026 Fuzeball', 1: 'Fuze Clip', 2: 'Regular', 3: 'FuzeClip-1.000', 4: 'Fuze Clip', 5: 'Version 1.000', 6: 'FuzeClip-Regular' };
const ASC = 750, DESC = -250;   // same vertical metrics as Soccer League, so a swap keeps every baseline

const G = build(P), adv = spacing(G, P), chars = Object.keys(G);
const notdef = { W: 600, contours: [[[60, 0], [60, H], [540, H], [540, 0]], [[140, 80], [460, 80], [460, H - 80], [140, H - 80]]] };
const glyphs = [notdef, ...chars.map(c => G[c])];
const gid = {}; chars.forEach((c, i) => gid[c] = i + 1);
const advOf = ch => Math.round(G[ch].W + P.gap);

// --- binary helpers ---
const pad4 = b => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4)]) : b;
const sum32 = b => { let s = 0; const p = pad4(b); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };
const wr = (len, fn) => { const b = Buffer.alloc(len); fn(b); return b; };
const log2 = n => Math.floor(Math.log2(n));

// --- glyf / loca / hmtx ---
const glyf = [], loca = [], hm = [];
let off = 0, maxPts = 0, maxCont = 0, xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9, advMax = 0, lsbMin = 1e9, rsbMin = 1e9, extMax = -1e9;
glyphs.forEach((g, i) => {
  const ch = i ? chars[i - 1] : null, advance = i ? advOf(ch) : g.W;
  loca.push(off);
  const pts = g.contours.flat();
  let gx0 = 0, gx1 = advance;
  if (pts.length) {
    gx0 = Math.min(...pts.map(p => p[0])); gx1 = Math.max(...pts.map(p => p[0]));
    const gy0 = Math.min(...pts.map(p => p[1])), gy1 = Math.max(...pts.map(p => p[1]));
    xMin = Math.min(xMin, gx0); xMax = Math.max(xMax, gx1); yMin = Math.min(yMin, gy0); yMax = Math.max(yMax, gy1);
    maxPts = Math.max(maxPts, pts.length); maxCont = Math.max(maxCont, g.contours.length);
    const n = pts.length, b = Buffer.alloc(10 + g.contours.length * 2 + 2 + n + n * 4);
    let o = 0; b.writeInt16BE(g.contours.length, o); o += 2;
    b.writeInt16BE(gx0, o); b.writeInt16BE(gy0, o + 2); b.writeInt16BE(gx1, o + 4); b.writeInt16BE(gy1, o + 6); o += 8;
    let e = -1; for (const c of g.contours) { e += c.length; b.writeUInt16BE(e, o); o += 2; }
    b.writeUInt16BE(0, o); o += 2;
    for (let k = 0; k < n; k++) b[o++] = 1;
    let px = 0; for (const p of pts) { b.writeInt16BE(p[0] - px, o); px = p[0]; o += 2; }
    let py = 0; for (const p of pts) { b.writeInt16BE(p[1] - py, o); py = p[1]; o += 2; }
    const gb = pad4(b); glyf.push(gb); off += gb.length;
  }
  hm.push([advance, pts.length ? gx0 : 0]);
  advMax = Math.max(advMax, advance); lsbMin = Math.min(lsbMin, pts.length ? gx0 : 0); rsbMin = Math.min(rsbMin, advance - gx1); extMax = Math.max(extMax, pts.length ? gx1 : 0);
});
loca.push(off);
const nG = glyphs.length;
const tGlyf = Buffer.concat(glyf), tLoca = wr(loca.length * 4, b => loca.forEach((v, i) => b.writeUInt32BE(v, i * 4)));
const tHmtx = wr(nG * 4, b => hm.forEach(([a, l], i) => { b.writeUInt16BE(a, i * 4); b.writeInt16BE(l, i * 4 + 2); }));

// --- cmap: capitals and digits as drawn, lowercase aliased onto the capitals ---
const codes = [];
for (const ch of chars) codes.push([ch.charCodeAt(0), gid[ch]]);
for (const ch of chars) { const lo = ch.toLowerCase(); if (lo !== ch && lo.length === 1) codes.push([lo.charCodeAt(0), gid[ch]]); }
codes.push([0x131, gid.I]);
codes.push([0xA0, gid[' ']]);
codes.sort((a, b) => a[0] - b[0]);
const segs = codes.length + 1, sr = 2 * Math.pow(2, log2(segs));
const tCmap = (() => {
  const len = 16 + segs * 8, sub = wr(len, b => {
    let o = 0; const w = v => { b.writeUInt16BE(v & 0xFFFF, o); o += 2; };
    w(4); w(len); w(0); w(segs * 2); w(sr); w(log2(segs)); w(segs * 2 - sr);
    codes.forEach(c => w(c[0])); w(0xFFFF); w(0);
    codes.forEach(c => w(c[0])); w(0xFFFF);
    codes.forEach(c => w(c[1] - c[0])); w(1);
    codes.forEach(() => w(0)); w(0);
  });
  const hd = wr(20, b => { b.writeUInt16BE(0, 0); b.writeUInt16BE(2, 2); b.writeUInt16BE(0, 4); b.writeUInt16BE(3, 6); b.writeUInt32BE(20, 8); b.writeUInt16BE(3, 12); b.writeUInt16BE(1, 14); b.writeUInt32BE(20, 16); });
  return Buffer.concat([hd, sub]);
})();

// --- GPOS kern: one class per base letter (accented letters ride on their base), the spacing pass's pair advance against the default W + gap ---
const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16BE(x & 0xFFFF, i * 2)); return b; };
const inked = chars.filter(c => G[c].contours.length), reps = [...new Set(inked.map(c => G[c].base))];
const cls = {}; reps.forEach((c, i) => cls[c] = i + 1);
const gl = inked.map(c => [gid[c], cls[G[c].base]]).sort((a, b) => a[0] - b[0]), nC = reps.length + 1;
const mat = Buffer.alloc(nC * nC * 2);
reps.forEach((a, i) => reps.forEach((b, j) => mat.writeInt16BE(Math.round(adv(a, b)) - advOf(a), ((i + 1) * nC + (j + 1)) * 2)));
const classDef = Buffer.concat([u16(2, gl.length), ...gl.map(([g, c]) => u16(g, g, c))]);
const coverage = Buffer.concat([u16(1, gl.length), ...gl.map(([g]) => u16(g))]);
const pairPos = Buffer.concat([u16(2, 16 + mat.length, 4, 0, 16 + mat.length + coverage.length, 16 + mat.length + coverage.length + classDef.length, nC, nC), mat, coverage, classDef, classDef]);
const lookupList = Buffer.concat([u16(1, 4), u16(2, 0, 1, 8), pairPos]);
const featureList = Buffer.concat([u16(1), Buffer.from('kern', 'latin1'), u16(8), u16(0, 1, 0)]);
const scriptList = Buffer.concat([u16(1), Buffer.from('DFLT', 'latin1'), u16(8), u16(4, 0), u16(0, 0xFFFF, 1, 0)]);
const tGpos = Buffer.concat([u16(1, 0, 10, 10 + scriptList.length, 10 + scriptList.length + featureList.length), scriptList, featureList, lookupList]);

// --- head / hhea / maxp / OS/2 / post / name / gasp ---
const created = BigInt(Math.round((Date.UTC(2026, 9, 3) - Date.UTC(1904, 0, 1)) / 1000));
const tHead = wr(54, b => {
  b.writeUInt32BE(0x00010000, 0); b.writeUInt32BE(0x00010000, 4); b.writeUInt32BE(0, 8); b.writeUInt32BE(0x5F0F3CF5, 12);
  b.writeUInt16BE(1, 16); b.writeUInt16BE(1000, 18); b.writeBigInt64BE(created, 20); b.writeBigInt64BE(created, 28);
  b.writeInt16BE(xMin, 36); b.writeInt16BE(yMin, 38); b.writeInt16BE(xMax, 40); b.writeInt16BE(yMax, 42);
  b.writeUInt16BE(0, 44); b.writeUInt16BE(8, 46); b.writeInt16BE(2, 48); b.writeInt16BE(1, 50); b.writeInt16BE(0, 52);
});
const tHhea = wr(36, b => {
  b.writeUInt32BE(0x00010000, 0); b.writeInt16BE(ASC, 4); b.writeInt16BE(DESC, 6); b.writeInt16BE(0, 8);
  b.writeUInt16BE(advMax, 10); b.writeInt16BE(lsbMin, 12); b.writeInt16BE(rsbMin, 14); b.writeInt16BE(extMax, 16);
  b.writeInt16BE(1000, 18); b.writeInt16BE(Math.round(1000 * Math.tan(P.slant * Math.PI / 180)), 20); b.writeInt16BE(0, 22);
  b.writeUInt16BE(nG, 34);
});
const tMaxp = wr(32, b => { b.writeUInt32BE(0x00010000, 0); b.writeUInt16BE(nG, 4); b.writeUInt16BE(maxPts, 6); b.writeUInt16BE(maxCont, 8); b.writeUInt16BE(1, 14); });
const avgW = Math.round(hm.reduce((s, h) => s + h[0], 0) / nG);
const tOs2 = wr(96, b => {
  b.writeUInt16BE(4, 0); b.writeInt16BE(avgW, 2); b.writeUInt16BE(400, 4); b.writeUInt16BE(5, 6); b.writeUInt16BE(0, 8);
  [650, 600, 0, 75, 650, 600, 0, 350, 50, 300].forEach((v, i) => b.writeInt16BE(v, 10 + i * 2));
  b.writeUInt32BE(0x80000007, 42); b.writeUInt32BE(0xA0E0, 46); b.write('FUZE', 58, 'latin1');   // Latin, Latin-1, Latin Ext-A, General Punctuation; Arrows, Math, Technical, Shapes, Dingbats
  b.writeUInt16BE(0xC0, 62); b.writeUInt16BE(codes[0][0], 64); b.writeUInt16BE(codes[codes.length - 1][0], 66);
  b.writeInt16BE(ASC, 68); b.writeInt16BE(DESC, 70); b.writeInt16BE(0, 72); b.writeUInt16BE(1000, 74); b.writeUInt16BE(300, 76);
  b.writeUInt32BE(1, 78); b.writeInt16BE(H, 86); b.writeInt16BE(H, 88); b.writeUInt16BE(0, 90); b.writeUInt16BE(0x20, 92); b.writeUInt16BE(2, 94);
});
const tPost = wr(32, b => { b.writeUInt32BE(0x00030000, 0); b.writeInt32BE(-P.slant * 65536, 4); b.writeInt16BE(-100, 8); b.writeInt16BE(50, 10); });
const tName = (() => {
  const ids = Object.keys(NAMES).map(Number), strs = ids.map(i => Buffer.from(NAMES[i], 'utf16le').swap16());
  const hdr = 6 + ids.length * 12; let o = 0;
  const recs = wr(hdr, b => { b.writeUInt16BE(0, 0); b.writeUInt16BE(ids.length, 2); b.writeUInt16BE(hdr, 4);
    ids.forEach((id, i) => { const r = 6 + i * 12; b.writeUInt16BE(3, r); b.writeUInt16BE(1, r + 2); b.writeUInt16BE(0x409, r + 4); b.writeUInt16BE(id, r + 6); b.writeUInt16BE(strs[i].length, r + 8); b.writeUInt16BE(o, r + 10); o += strs[i].length; }); });
  return Buffer.concat([recs, ...strs]);
})();
const tGasp = wr(8, b => { b.writeUInt16BE(1, 0); b.writeUInt16BE(1, 2); b.writeUInt16BE(0xFFFF, 4); b.writeUInt16BE(0x000F, 6); });

// --- assemble ---
const tables = { GPOS: tGpos, 'OS/2': tOs2, cmap: tCmap, gasp: tGasp, glyf: tGlyf, head: tHead, hhea: tHhea, hmtx: tHmtx, loca: tLoca, maxp: tMaxp, name: tName, post: tPost };
const tags = Object.keys(tables).sort(), nT = tags.length, srT = 16 * Math.pow(2, log2(nT));
let pos = 12 + nT * 16; const dir = Buffer.alloc(12 + nT * 16), offs = {};
dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(nT, 4); dir.writeUInt16BE(srT, 6); dir.writeUInt16BE(log2(nT), 8); dir.writeUInt16BE(nT * 16 - srT, 10);
tags.forEach((t, i) => { const r = 12 + i * 16; dir.write(t, r, 'latin1'); dir.writeUInt32BE(sum32(tables[t]), r + 4); dir.writeUInt32BE(pos, r + 8); dir.writeUInt32BE(tables[t].length, r + 12); offs[t] = pos; pos += pad4(tables[t]).length; });
let font = Buffer.concat([dir, ...tags.map(t => pad4(tables[t]))]);
font.writeUInt32BE((0xB1B0AFBA - sum32(font)) >>> 0, offs.head + 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, font);
console.log(`${path.relative(process.cwd(), OUT)}  ${font.length} bytes · ${nG} glyphs · ${nC - 1} kern classes · bbox ${xMin},${yMin} ${xMax},${yMax}`);
