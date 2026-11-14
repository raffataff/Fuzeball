// Rebuild the standard Circuit finish from the stock table and the wear swatch.
// Run with: node tools/texture_circuit_standard.mjs
import { execFileSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { bakeCircuitGoal } from './texture_circuit_goal.mjs';

const folder = new URL('../assets/tables/circuit/', import.meta.url);
const swatch = await readFile(new URL('standard/worn-steel-source.jpg', folder));
const wallSwatches = await Promise.all([1, 2].map((index) =>
    readFile(new URL(`standard/wall-wear-source-${index}.jpg`, folder))));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(fileURLToPath(new URL('fuzeball_table_circuit.glb', folder)));
const root = doc.getRoot();
const stockTextures = root.listTextures();

const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a + (b - a) * t;
const byte = (x) => Math.round(clamp(x / 255) * 255);
const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const band = (x, center, width) => Math.exp(-((x - center) ** 2) / (width * width));

// Two wide scans cover a full rail wrap. Crop a different band for each face
// and feather the middle join. This keeps detail close to square in world space.
const railWidth = 4096;
const railHeight = 1024;
const railOuterLip = .44;
const railInnerLip = .54;

async function makeRailSource() {
    const tileWidth = 2172;
    const tileHeight = 724;
    const overlap = tileWidth * 2 - railWidth;
    const tiles = await Promise.all(wallSwatches.map((bytes) => sharp(bytes).greyscale().raw().toBuffer()));
    const source = Buffer.alloc(railWidth * railHeight);
    const transitionStart = Math.round(railOuterLip * railHeight);
    const transitionEnd = Math.round(railInnerLip * railHeight);
    for (let y = 0; y < railHeight; y++) {
        // Keep the source rows contiguous on each wall face. Blend between
        // two bands across the narrow cap, away from the large wall faces.
        const innerWeight = smooth(transitionStart, transitionEnd, y);
        const outerRow = Math.min(tileHeight - 1, y + 98);
        const innerRow = Math.max(0, y - 362);
        const leftOuter = outerRow * tileWidth;
        const leftInner = innerRow * tileWidth;
        const rightOuter = (tileHeight - 1 - outerRow) * tileWidth;
        const rightInner = (tileHeight - 1 - innerRow) * tileWidth;
        for (let x = 0; x < railWidth; x++) {
            const rightX = x - (tileWidth - overlap);
            const leftColumn = Math.min(x, tileWidth - 1);
            const rightColumn = Math.max(0, rightX);
            const a = mix(tiles[0][leftOuter + leftColumn], tiles[0][leftInner + leftColumn], innerWeight) + 14;
            const b = mix(tiles[1][rightOuter + rightColumn], tiles[1][rightInner + rightColumn], innerWeight) + 22;
            source[y * railWidth + x] = byte(mix(a, b, smooth(0, overlap - 1, rightX)));
        }
    }
    return source;
}

async function bakeFinish(name, width, height, paint, isRail, accent) {
    const source = isRail ? await makeRailSource()
        : await sharp(swatch).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();

    // Blend opposite ends of each scanline so repeating U has no hard seam.
    const seam = Math.round(width / 64);
    for (let y = 0; y < height; y++) {
        for (let d = 0; d < seam; d++) {
            const a = y * width + d;
            const b = y * width + width - 1 - d;
            const avg = (source[a] + source[b]) / 2;
            const keep = smooth(0, seam, d);
            source[a] = byte(mix(avg, source[a], keep));
            source[b] = byte(mix(avg, source[b], keep));
        }
    }
    const soft = await sharp(source, { raw: { width, height, channels: 1 } })
        .blur(3).greyscale().raw().toBuffer();
    const broad = await sharp(source, { raw: { width, height, channels: 1 } })
        .blur(24).greyscale().raw().toBuffer();
    const relief = new Float32Array(width * height);
    const base = Buffer.alloc(width * height * 3);
    const red = accent && Buffer.alloc(base.length);
    const packed = Buffer.alloc(base.length);
    const normal = Buffer.alloc(base.length);
    const steel = [146, 151, 153];
    const paintPixel = (target, index, rgb, shade, chip) => {
        for (let c = 0; c < 3; c++) target[index + c] = byte(mix(rgb[c] + shade, steel[c], chip));
    };

    for (let y = 0; y < height; y++) {
        const v = y / (height - 1);
        const lip = isRail
            ? Math.max(band(v, railOuterLip, .012), band(v, railInnerLip, .014))
            : band(v, .99, .055);
        const contact = isRail ? band(v, .86, .09) : band(v, .93, .095);
        const groove = isRail ? Math.max(band(v, .117, .003), band(v, .135, .003)) : 0;
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const k = i * 3;
            const grain = source[i] - soft[i];
            const mark = source[i] - broad[i];
            const abrasion = smooth(1, 21, soft[i] - broad[i]);
            const edge = lip * smooth(77, 112, source[i] + abrasion * 7);
            const wear = mark + 17 * lip + 8 * contact;
            const chip = Math.max(isRail ? smooth(16, 47, wear) : smooth(22, 58, wear), edge * .66);
            const pit = smooth(7, 30, -mark);
            const shade = (broad[i] - 78) * 1.05 + abrasion * 18 + clamp(mark / 23) * 9
                + contact * abrasion * 10 - 14 * pit - groove * 12 + (isRail ? .38 * grain : 0);
            paintPixel(base, k, paint, shade, chip);
            if (red) paintPixel(red, k, accent, shade, chip);
            relief[i] = grain * (isRail ? .005 : .008) + (broad[i] - 78) * .006
                - .06 * abrasion - .29 * chip - .14 * pit - .13 * groove;
            const roughness = mix(.68 + .14 * pit - .21 * abrasion - .09 * edge + .055 * groove, .29, chip);
            packed[k] = 255;
            packed[k + 1] = byte(roughness * 255);
            packed[k + 2] = byte(mix(.02, .92, chip) * 255);
        }
    }

    // glTF tangent-space normal, +Y up. U wraps while V clamps at the sheet edges.
    for (let y = 0; y < height; y++) {
        const above = Math.max(0, y - 1) * width;
        const below = Math.min(height - 1, y + 1) * width;
        for (let x = 0; x < width; x++) {
            const row = y * width;
            const nx = 2.2 * (relief[row + (x + width - 1) % width] - relief[row + (x + 1) % width]);
            const ny = 2.2 * (relief[below + x] - relief[above + x]);
            const length = Math.hypot(nx, ny, 1);
            const k = (row + x) * 3;
            normal[k] = byte(127.5 * (1 + nx / length));
            normal[k + 1] = byte(127.5 * (1 + ny / length));
            normal[k + 2] = byte(127.5 * (1 + 1 / length));
        }
    }

    const save = async (label, pixels, format) => {
        const file = `${name}_${label}.${format}`;
        const path = fileURLToPath(new URL(`standard/${file}`, folder));
        const image = sharp(pixels, { raw: { width, height, channels: 3 } });
        if (format === 'jpg') image.jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
        else image.png();
        const bytes = await image.toBuffer();
        await writeFile(path, bytes);
        return doc.createTexture(file).setMimeType(format === 'jpg' ? 'image/jpeg' : 'image/png').setImage(bytes);
    };
    const [color, accentColor, normalMap, roughMetal] = await Promise.all([
        save('basecolor', base, 'jpg'),
        red ? save('red_basecolor', red, 'jpg') : null,
        save('normal', normal, 'png'),
        save('roughness_metallic', packed, 'png'),
    ]);
    return { color, accentColor, normalMap, roughMetal };
}

function applyFinish(name, finish, { color = finish.color, normalScale, roughness = 1, tint = [1, 1, 1, 1] }) {
    const material = root.listMaterials().find((m) => m.getName() === name);
    if (!material) throw new Error(`Missing stock material: ${name}`);
    material.setBaseColorFactor(tint).setBaseColorTexture(color)
        .setNormalTexture(finish.normalMap).setNormalScale(normalScale)
        .setMetallicRoughnessTexture(finish.roughMetal).setMetallicFactor(1).setRoughnessFactor(roughness);
    for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(),
        material.getMetallicRoughnessTextureInfo()]) {
        info.setExtension('KHR_texture_transform', null);
        info.setWrapT(finish.wrapT ?? 33071); // Walls clamp vertically. The goal wraps its cross-section.
        info.setMinFilter(9987);
    }
}

function dominantAxis(a, b, c) {
    const u = b.map((v, i) => v - a[i]);
    const v = c.map((n, i) => n - a[i]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const abs = normal.map(Math.abs);
    return abs.indexOf(Math.max(...abs));
}

// Wrap the outer face, cap and inner face across the rail sheet so the
// burnished bands straddle the two rail lips. Only UVs change on the stock mesh.
for (const node of root.listNodes()) {
    const name = node.getName();
    if (!/^(table_base|wall_|goal_frame_header)/.test(name)) continue;
    const base = name.startsWith('table_base');
    const side = name.startsWith('wall_side');
    const across = side ? 2 : 0;
    const along = side ? 0 : 2;
    const inner = side ? 34 : 60;
    const outer = side ? 37 : 68.48;
    for (const prim of node.getMesh().listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        const texcoord = prim.getAttribute('TEXCOORD_0');
        const count = position.getCount();
        if (prim.getIndices() || count % 3 !== 0) throw new Error(`Expected expanded triangles: ${name}`);
        for (let i = 0; i < count; i += 3) {
            const corners = [0, 1, 2].map((k) => position.getElement(i + k, []));
            const axis = dominantAxis(...corners);
            const meanDepth = corners.reduce((sum, p) => sum + Math.abs(p[across]), 0) / 3;
            const facingOut = meanDepth > (inner + outer) / 2;
            const offset = corners[0][across] < 0 ? .32 : 0;
            corners.forEach((p, k) => {
                const [x, y, z] = p;
                if (base) {
                    const u = ((axis === 0 ? z : x) + 68.5) / 137;
                    const v = axis === 1 ? .50 + z / 90 : (-y - .55) / 42.15;
                    texcoord.setElement(i + k, [u, v]);
                    return;
                }
                const depth = (Math.abs(p[across]) - inner) / (outer - inner);
                const rise = (y + .6) / 16.2;
                const horizontal = axis === along ? p[across] : p[along];
                const u = (horizontal + 68.5) / 137 + offset;
                let v = facingOut ? mix(.014, railOuterLip, rise) : mix(.996, railInnerLip, rise);
                if (axis === 1) {
                    v = y > 13 ? mix(railInnerLip, railOuterLip, depth) : mix(.83, .72, depth);
                }
                texcoord.setElement(i + k, [u, v]);
            });
        }
    }
}

const rail = await bakeFinish('rail', railWidth, railHeight, [50, 62, 72], true, [128, 33, 43]);
const cabinet = await bakeFinish('cabinet', 1024, 512, [40, 48, 56], false);
const goal = await bakeCircuitGoal(doc, folder, wallSwatches[1]);
applyFinish('shell_wall', rail, { normalScale: 1.4 });
applyFinish('shell_wall_red', rail, { color: rail.accentColor, normalScale: 1.25 });
applyFinish('table_base', cabinet, { normalScale: 1.15 });
applyFinish('goal_frame.001', goal, { normalScale: 1.3 });
const goalMaterial = root.listMaterials().find((m) => m.getName() === 'goal_frame.001');
goalMaterial.setEmissiveTexture(goal.emissive).setEmissiveFactor([.65, .65, .65]);
goalMaterial.getEmissiveTextureInfo().setWrapS(33071).setMinFilter(9987);
for (const info of [goalMaterial.getBaseColorTextureInfo(), goalMaterial.getMetallicRoughnessTextureInfo(),
    goalMaterial.getNormalTextureInfo()]) {
    info.setWrapS(33071);
}

for (const texture of stockTextures) {
    if (texture.listParents().every((parent) => parent === root)) texture.dispose();
}
const rawGlb = join(tmpdir(), `fuzeball-circuit-${randomUUID()}.glb`);
const gameGlb = fileURLToPath(new URL('fuzeball_table_circuit_worn.glb', folder));
const encoder = fileURLToPath(new URL('ktx2-encode.mjs', import.meta.url));
await io.write(rawGlb, doc);
try {
    execFileSync(process.execPath, [encoder, rawGlb, gameGlb, '--quality', '255', '--uastc-level', '3'],
        { stdio: 'inherit' });
} finally {
    await unlink(rawGlb);
}
