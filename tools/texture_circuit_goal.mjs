// The stock Circuit frame has U along both posts and the crossbar, with V around the tube.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a + (b - a) * t;
const byte = (x) => Math.round(clamp(x / 255) * 255);
const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const strip = (x, a, b, feather) => smooth(a, a + feather, x) * (1 - smooth(b - feather, b, x));
const wrapDist = (v, center) => Math.min(Math.abs(v - center), 1 - Math.abs(v - center));

export async function bakeCircuitGoal(doc, folder, steelSwatch) {
    const width = 1024;
    const height = 128;
    const source = await sharp(steelSwatch).extract({ left: 580, top: 255, width, height })
        .greyscale().raw().toBuffer();
    const base = Buffer.alloc(width * height * 3);
    const normal = Buffer.alloc(base.length);
    const orm = Buffer.alloc(base.length);
    const emissive = Buffer.alloc(base.length);
    const heightMap = new Float32Array(width * height);
    const graphite = [66, 79, 89];
    const red = [126, 36, 45];
    const steel = [164, 170, 174];
    const cyan = [62, 161, 174];

    for (let y = 0; y < height; y++) {
        const v = (y + .5) / height;
        const fromFace = Math.min(wrapDist(v, 0), wrapDist(v, .5));
        const shoulder = 1 - smooth(.029, .105, Math.abs(fromFace - .105));
        const seamWeight = 1 - smooth(0, .13, wrapDist(v, 0));
        for (let x = 0; x < width; x++) {
            const u = (x + .5) / width;
            const distanceFromFoot = Math.min(u, 1 - u);
            const collar = strip(distanceFromFoot, .025, .077, .005);
            const collarShoulder = strip(distanceFromFoot, .019, .025, .002)
                + strip(distanceFromFoot, .077, .083, .002);
            const ledLength = Math.max(strip(distanceFromFoot, .101, .173, .004),
                strip(distanceFromFoot, .417, .485, .004));
            const slot = (1 - smooth(.028, .048, fromFace)) * ledLength;
            const light = (1 - smooth(.016, .026, fromFace)) * ledLength;
            const i = y * width + x;
            const k = i * 3;
            const tone = mix(source[i], .5 * (source[i] + source[(height - 1 - y) * width + x]), seamWeight);
            const wear = smooth(64, 106, tone + 11 * shoulder);
            const bare = Math.max(wear * .9, shoulder * (.17 + wear * .68), collarShoulder * .76);
            const shade = (tone - 56) * .54;
            for (let c = 0; c < 3; c++) {
                const coat = mix(graphite[c], red[c], collar) + shade;
                const finish = mix(mix(coat, steel[c], bare), 14 + c * 4, slot);
                base[k + c] = byte(mix(finish, cyan[c], light));
                emissive[k + c] = byte(light * cyan[c]);
            }
            orm[k] = 255;
            orm[k + 1] = byte(mix(mix(.64, .32, bare), .35, light) * 255);
            orm[k + 2] = byte(mix(mix(.16, .92, bare), .06, slot) * 255);
            heightMap[i] = .003 * (tone - 56) - .14 * wear + .11 * collar + .08 * collarShoulder - .14 * slot;
        }
    }
    for (let y = 0; y < height; y++) {
        const above = ((y + height - 1) % height) * width;
        const below = ((y + 1) % height) * width;
        for (let x = 0; x < width; x++) {
            const row = y * width;
            const dx = 2 * (heightMap[row + Math.max(0, x - 1)] - heightMap[row + Math.min(width - 1, x + 1)]);
            const dy = 2 * (heightMap[below + x] - heightMap[above + x]);
            const length = Math.hypot(dx, dy, 1);
            const k = (row + x) * 3;
            normal[k] = byte(127.5 * (1 + dx / length));
            normal[k + 1] = byte(127.5 * (1 + dy / length));
            normal[k + 2] = byte(127.5 * (1 + 1 / length));
        }
    }
    const maps = [
        ['color', 'basecolor', base],
        ['normalMap', 'normal', normal],
        ['roughMetal', 'roughness_metallic', orm],
        ['emissive', 'emissive', emissive],
    ];
    const textures = await Promise.all(maps.map(async ([slot, label, rgb]) => {
        const name = `goal_frame_${label}.png`;
        const data = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
        await writeFile(new URL(`standard/${name}`, folder), data);
        return [slot, doc.createTexture(name).setMimeType('image/png').setImage(data)];
    }));
    return { ...Object.fromEntries(textures), wrapT: 10497 };
}
