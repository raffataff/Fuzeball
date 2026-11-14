// Build the standard Circuit pitch from the laminate scan and the shared field markings.
// Run with: node tools/build_circuit_pitch.mjs
import { execFileSync } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsIOR } from '@gltf-transform/extensions';
import { W, H, L, WD, PPU, P, clamp, sstep, lineDist, spot, sharp, writePitch } from './pitchlib.mjs';

const id = 'circuit_standard';
const source = await sharp(P('assets/pitches/source/circuit_standard.jpg'))
    .resize(W, H, { fit: 'cover' }).greyscale().raw().toBuffer();
const swatch = () => sharp(source, { raw: { width: W, height: H, channels: 1 } });
const [soft, broad] = await Promise.all([2, 20].map((radius) =>
    swatch().blur(radius).greyscale().raw().toBuffer()));
const base = Buffer.alloc(W * H * 3);
const normal = Buffer.alloc(base.length);
const orm = Buffer.alloc(base.length);
const height = new Float32Array(W * H);
const surface = [39, 51, 62];
const lineColor = [166, 179, 180];
const teal = [80, 158, 167];
const mix = (a, b, t) => a + (b - a) * t;
const byte = (value) => Math.round(clamp(value, 0, 255));
const stroke = (distance, halfWidth) => 1 - sstep(halfWidth - .04, halfWidth + .06, distance);
const trace = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
};

for (let j = 0; j < H; j++) {
    const z = -WD / 2 + (j + .5) / PPU;
    const az = Math.abs(z);
    for (let i = 0; i < W; i++) {
        const x = -L / 2 + (i + .5) / PPU;
        const ax = Math.abs(x);
        const q = j * W + i;
        const k = q * 3;
        const grain = source[q] - soft[q];
        const scratch = source[q] - broad[q];
        const wear = sstep(4, 30, scratch);
        const lane = Math.exp(-((z / 14) ** 2)) * Math.exp(-((x / 53) ** 2));
        const goalWear = sstep(43, 60, ax) * Math.exp(-((z / 8.5) ** 2));
        const use = Math.min(1, lane * .45 + goalWear * .65);
        const fade = .12 * sstep(12, 31, scratch);
        const line = Math.max(stroke(lineDist(x, z), .142), 1 - sstep(-.025, .09, spot(x, z))) * (1 - fade);
        let corner = 0;
        if (ax > 49 && az > 26) {
            const path = Math.min(trace(ax, az, 50, 30.95, 54.5, 30.95),
                trace(ax, az, 54.5, 30.95, 57, 28.45),
                trace(ax, az, 57, 28.45, 57, 26.35));
            const tick = trace(ax, az, 50, 29.9, 53.1, 29.9);
            corner = Math.max(stroke(path, .115), stroke(tick, .072) * .62) * (1 - fade);
        }
        const shade = (broad[q] - 80) * .64 + grain * .38 + scratch * .38 + use * (3 + 6 * wear);
        for (let c = 0; c < 3; c++) {
            const laminate = mix(surface[c] + shade, teal[c] + shade * .2, corner);
            base[k + c] = byte(mix(laminate, lineColor[c] + shade * .21, line));
        }
        height[q] = grain * .007 + (soft[q] - broad[q]) * .0035 - .063 * wear
            + .037 * line - .05 * corner;
        orm[k] = 255;
        orm[k + 1] = byte(mix(190 - use * 30 - wear * 19, 155, Math.max(line, corner)));
        orm[k + 2] = byte(mix(5, 29, corner));
    }
}
for (let y = 0; y < H; y++) {
    const above = Math.max(0, y - 1) * W;
    const below = Math.min(H - 1, y + 1) * W;
    const row = y * W;
    for (let x = 0; x < W; x++) {
        const dx = 2 * (height[row + Math.max(0, x - 1)] - height[row + Math.min(W - 1, x + 1)]);
        const dy = 2 * (height[below + x] - height[above + x]);
        const length = Math.hypot(dx, dy, 1);
        const k = (row + x) * 3;
        normal[k] = byte(127.5 * (1 + dx / length));
        normal[k + 1] = byte(127.5 * (1 + dy / length));
        normal[k + 2] = byte(127.5 * (1 + 1 / length));
    }
}

await writePitch(id, base, normal, orm, 0);
const gameGlb = P('assets/pitches/pitch_circuit_standard.glb');
const rawGlb = join(tmpdir(), `fuzeball-circuit-pitch-${randomUUID()}.glb`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(gameGlb);
const material = doc.getRoot().listMaterials()[0];
material.setBaseColorFactor([1, 1, 1, 1]).setEmissiveTexture(null).setNormalScale(1.16);
const ior = doc.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.33);
material.setExtension('KHR_materials_ior', ior);
const slab = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const normals = slab.getAttribute('NORMAL');
const tangents = new Float32Array(normals.getCount() * 4);
const direction = [];
for (let i = 0; i < normals.getCount(); i++) {
    normals.getElement(i, direction);
    // U runs towards +X on the slab and vertically on the two goal ends.
    const tangent = Math.abs(direction[0]) > .5 ? [0, 1, 0, direction[0]]
        : [1, 0, 0, direction[1] > .5 ? -1 : 1];
    tangents.set(tangent, i * 4);
}
slab.setAttribute('TANGENT', doc.createAccessor().setType('VEC4').setArray(tangents).setBuffer(normals.getBuffer()));
await io.write(rawGlb, doc);
try {
    execFileSync(process.execPath, [P('tools/ktx2-encode.mjs'), rawGlb, gameGlb, '--quality', '235', '--uastc-level', '3'],
        { stdio: 'inherit' });
} finally {
    await rm(rawGlb, { force: true });
}
