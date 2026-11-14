// Build the standard Circuit rod set from the in-game Comet shafts and bumpers.
// Run with: node tools/build_circuit_rods.mjs
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const root = new URL('../assets/', import.meta.url);
const out = new URL('rods/circuit_standard/', root);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(out, { recursive: true });

const width = 512;
const height = 256;
const pixelCount = width * height;
const source = await sharp(fileURLToPath(new URL('tables/circuit/standard/wall-wear-source-2.jpg', root)))
    .extract({ left: 452, top: 169, width, height }).greyscale().raw().toBuffer();
const clamp = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

async function finish(rubber) {
    const relief = new Float32Array(pixelCount);
    const color = Buffer.alloc(pixelCount * 3);
    const normal = Buffer.alloc(color.length);
    const packed = Buffer.alloc(color.length);
    const coat = rubber ? [40, 45, 51] : [55, 68, 78];
    const bare = [170, 180, 184];
    for (let y = 0; y < height; y++) {
        const v = (y + .5) / height;
        // Blend the scan at the angular seam. The grip tread wraps exactly.
        const seam = 1 - smooth(0, .095, Math.min(v, 1 - v));
        for (let x = 0; x < width; x++) {
            const u = (x + .5) / width;
            const i = y * width + x;
            const grain = mix(source[i], (source[i] + source[(height - 1 - y) * width + x]) / 2, seam) - 56;
            let recess = 0;
            let wear = 0;
            let roughness;
            let metalness;
            let shade;
            if (rubber) {
                // Six finger panels. Crossed grooves give each panel a molded diamond tread.
                const panel = 1 - smooth(.35, .47, Math.abs((v * 6) % 1 - .5));
                const end = smooth(.035, .16, u) * (1 - smooth(.84, .965, u));
                const groove = Math.max(Math.cos(2 * Math.PI * (u * 25 + v * 24)),
                    Math.cos(2 * Math.PI * (u * 25 - v * 24)));
                recess = smooth(.62, .97, groove) * panel * end;
                const polish = smooth(0, 19, grain) * end * (1 - recess);
                shade = grain * .16 + 7 * panel * end + 7 * polish - 10 * recess;
                relief[i] = -.23 * recess + .055 * panel * end + grain * .0026;
                roughness = .77 - .26 * polish + .08 * recess;
                metalness = 0;
            } else {
                const lip = Math.exp(-((Math.min(u, 1 - u) / .11) ** 2));
                wear = Math.max(smooth(12, 48, grain + 25 * lip), lip * (.30 + .29 * smooth(-6, 15, grain)));
                shade = grain * .47;
                relief[i] = grain * .005 - .23 * wear;
                roughness = mix(.59, .30, wear);
                metalness = mix(.18, .95, wear);
            }
            const k = i * 3;
            for (let c = 0; c < 3; c++) color[k + c] = Math.round(mix(coat[c] + shade, bare[c], wear));
            packed[k] = 255;
            packed[k + 1] = Math.round(roughness * 255);
            packed[k + 2] = Math.round(metalness * 255);
        }
    }
    for (let y = 0; y < height; y++) {
        const row = y * width;
        const above = ((y + height - 1) % height) * width;
        const below = ((y + 1) % height) * width;
        for (let x = 0; x < width; x++) {
            const dx = 2 * (relief[row + Math.max(0, x - 1)] - relief[row + Math.min(width - 1, x + 1)]);
            const dy = 2 * (relief[below + x] - relief[above + x]);
            const length = Math.hypot(dx, dy, 1);
            const k = (row + x) * 3;
            normal[k] = Math.round(127.5 * (1 + dx / length));
            normal[k + 1] = Math.round(127.5 * (1 + dy / length));
            normal[k + 2] = Math.round(127.5 * (1 + 1 / length));
        }
    }
    const raw = { width, height, channels: 3 };
    return Promise.all([sharp(color, { raw }).jpeg({ quality: 91, chromaSubsampling: '4:4:4' }).toBuffer(),
        sharp(normal, { raw }).png().toBuffer(), sharp(packed, { raw }).png().toBuffer()]);
}

const [rubberMaps, metalMaps] = await Promise.all([finish(true), finish(false)]);

function material(doc, name, color, metalness, roughness) {
    return doc.createMaterial(name).setBaseColorFactor([...color, 1])
        .setMetallicFactor(metalness).setRoughnessFactor(roughness);
}

function applyMaps(doc, target, maps, strength) {
    const labels = ['basecolor', 'normal', 'roughness_metallic'];
    const tex = maps.map((bytes, i) => doc.createTexture(target.getName() + ' ' + labels[i])
        .setImage(bytes).setMimeType(i === 0 ? 'image/jpeg' : 'image/png'));
    target.setBaseColorTexture(tex[0]).setNormalTexture(tex[1]).setNormalScale(strength)
        .setMetallicRoughnessTexture(tex[2]);
    for (const info of [target.getBaseColorTextureInfo(), target.getNormalTextureInfo(),
        target.getMetallicRoughnessTextureInfo()]) {
        info.setWrapS(33071).setMinFilter(9987);
    }
}

// A profile runs in axial Z order, with U along the profile and V wrapped around it.
// Use small bevels in the profile itself so the metal catches real highlights.
function lathe(doc, name, profile, start, end, mat, flutes = 0) {
    const scene = doc.getRoot().getDefaultScene();
    const buffer = doc.getRoot().listBuffers()[0];
    const count = 60;
    const stride = count + 1;
    const positions = [];
    const normals = [];
    const uv = [];
    const indices = [];
    const radiusAt = (t, r, angle) => r - flutes * (.5 + .5 * Math.cos(6 * angle)) * Math.sin(Math.PI * t) ** 2;
    const point = ([t, r], angle) => {
        const radius = radiusAt(t, r, angle);
        return [radius * Math.cos(angle), radius * Math.sin(angle), mix(start, end, t)];
    };
    const steps = [0];
    for (let i = 1; i < profile.length; i++) {
        const [t0, r0] = profile[i - 1];
        const [t1, r1] = profile[i];
        steps.push(steps[i - 1] + Math.hypot((t1 - t0) * (end - start), r1 - r0));
    }
    for (const [k, section] of profile.entries()) {
        for (let j = 0; j <= count; j++) {
            const angle = 2 * Math.PI * j / count;
            const p = point(section, angle);
            const left = point(section, angle - .001);
            const right = point(section, angle + .001);
            const prev = point(profile[Math.max(0, k - 1)], angle);
            const next = point(profile[Math.min(profile.length - 1, k + 1)], angle);
            const a = right.map((v, i) => v - left[i]);
            const b = next.map((v, i) => v - prev[i]);
            const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            const length = Math.hypot(...n);
            positions.push(...p);
            normals.push(...n.map((v) => v / length));
            uv.push(steps[k] / steps.at(-1), j / count);
            if (j < count && k < profile.length - 1) {
                const vertex = k * stride + j;
                indices.push(vertex, vertex + 1, vertex + stride, vertex + 1, vertex + stride + 1, vertex + stride);
            }
        }
    }
    const attr = (type, values, ArrayType = Float32Array) => doc.createAccessor().setType(type)
        .setArray(new ArrayType(values)).setBuffer(buffer);
    const p = doc.createPrimitive().setAttribute('POSITION', attr('VEC3', positions))
        .setAttribute('NORMAL', attr('VEC3', normals)).setAttribute('TEXCOORD_0', attr('VEC2', uv))
        .setIndices(attr('SCALAR', indices, Uint16Array)).setMaterial(mat);
    const mesh = doc.createMesh(name).addPrimitive(p);
    scene.addChild(doc.createNode(name).setMesh(mesh));
}

const band = (doc, name, start, end, radius, mat) => lathe(doc, name,
    [[0, radius - .038], [.15, radius - .008], [.32, radius], [.68, radius],
        [.85, radius - .008], [1, radius - .038]], start, end, mat);
const zBounds = (node) => {
    const p = node.getMesh().listPrimitives()[0].getAttribute('POSITION');
    return [p.getMin([])[2], p.getMax([])[2]];
};

for (const size of [1, 2, 3, 5]) {
    const file = `fuzeball_rod_${size}man.glb`;
    const doc = await io.read(fileURLToPath(new URL(`rods/arena_comet/${file}`, root)));
    const scene = doc.getRoot();
    const nodes = scene.listNodes();
    const grip = nodes.find((n) => n.getName().includes('comet_grip'));
    const collar = nodes.find((n) => n.getName().includes('_collar.'));
    const shaft = nodes.find((n) => n.getName().includes('_bar.'));
    const [a, b] = zBounds(grip);
    const [shaftStart] = zBounds(shaft);
    const [oldCollar] = zBounds(collar);
    // The inherited 3-man collar floats beyond the shaft. Seat every stop around its shaft.
    const stop = Math.max(oldCollar, shaftStart + .20);
    const oldMaterials = scene.listMaterials();
    for (const node of nodes) {
        if (/_handle_|_collar\.|_knob\./.test(node.getName())) {
            const mesh = node.getMesh();
            node.dispose();
            mesh.dispose();
        }
    }
    for (const mat of oldMaterials) {
        if (mat.listParents().every((parent) => parent === scene)) mat.dispose();
    }

    const dark = material(doc, 'Circuit | molded graphite rubber', [1, 1, 1], 0, 1);
    applyMaps(doc, dark, rubberMaps, 1.18);
    const steel = material(doc, 'Circuit | chipped gunmetal', [1, 1, 1], 1, 1);
    applyMaps(doc, steel, metalMaps, 1.12);
    const red = material(doc, 'Circuit | oxide-red enamel', [.34, .020, .028], .21, .42);
    const cyan = material(doc, 'Circuit | cyan inlay', [.055, .29, .33], .25, .36)
        .setEmissiveFactor([.035, .18, .21]);
    const team = material(doc, 'team_circuit_index', [.68, .04, .06], .15, .46);
    const prefix = `rod${size}`;

    const profile = [[0, 1.18], [.025, 1.235], [.09, 1.30], [.20, 1.38],
        [.36, 1.43], [.5, 1.44], [.64, 1.43], [.8, 1.38], [.91, 1.30], [.975, 1.235], [1, 1.18]];
    lathe(doc, prefix + '_handle_grip', profile, a + .58, b - .50, dark, .095);
    band(doc, prefix + '_handle_heel', a, a + .64, 1.28, steel);
    band(doc, prefix + '_handle_index', a + .16, a + .44, 1.305, team);
    band(doc, prefix + '_handle_heel_inlay', a + .49, a + .55, 1.31, cyan);
    lathe(doc, prefix + '_handle_endcap',
        [[0, 1.19], [.13, 1.30], [.27, 1.42], [.43, 1.46], [.79, 1.46],
            [.88, 1.42], [.96, 1.34], [.96, 1.29], [1, 1.23], [1, .72], [.96, .66], [.96, .001]],
        b - .55, b + .57, steel);
    band(doc, prefix + '_handle_cap_enamel', b - .045, b + .25, 1.480, red);
    band(doc, prefix + '_handle_cap_inlay', b + .345, b + .411, 1.458, cyan);

    lathe(doc, prefix + '_collar_stop',
        [[0, .43], [0, .94], [.06, 1.07], [.16, 1.17], [.28, 1.17],
            [.32, 1.10], [.68, 1.10], [.72, 1.16], [.90, 1.16], [1, 1.04],
            [1, .43], [.98, .40], [.02, .40], [0, .43]],
        stop, stop + 1.90, steel);
    band(doc, prefix + '_collar_enamel', stop + .55, stop + 1.33, 1.135, red);
    band(doc, prefix + '_collar_inlay', stop + .84, stop + 1.015, 1.142, cyan);
    await io.write(fileURLToPath(new URL(file, out)), doc);
    console.log('Built Circuit rod', size);
}
