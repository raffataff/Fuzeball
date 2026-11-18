'use strict';
// Run from the project root before exporting the Helios rods in Blender.
const path = require('node:path');
const sharp = require('sharp');

const dir = 'assets/rods/helios_runners/textures';
const brushedMetal = 'assets/tables/arena/helios_runners/source_art/goal_brushed_metal.png';
const mix = (a, b, t) => a + (b - a) * t;
const clamp = x => Math.max(0, Math.min(1, x));
const byte = x => Math.round(255 * clamp(x));

function smooth(a, b, x) {
 const t = clamp((x - a) / (b - a));
 return t * t * (3 - 2 * t);
}

function band(x, a, b, edge) {
 return smooth(a, a + edge, x) * (1 - smooth(b - edge, b, x));
}

function png(name, data, width, height, channels = 3) {
 return sharp(data, {raw: {width, height, channels}}).png().toFile(path.join(dir, name + '.png'));
}

// U follows the rod. V wraps around it and uses the glTF +Y-up tangent convention.
function normalMap(surface, w, h, length, circumference) {
 const normal = Buffer.alloc(w * h * 3);
 for (let y = 0; y < h; y++) {
  const row = y * w, up = (y + h - 1) % h * w, down = (y + 1) % h * w;
  for (let x = 0; x < w; x++) {
   const nx = (surface[row + Math.max(0, x - 1)] - surface[row + Math.min(w - 1, x + 1)]) * w / (2 * length);
   const ny = (surface[down + x] - surface[up + x]) * h / (2 * circumference);
   const inv = 1 / Math.hypot(nx, ny, 1), i = (row + x) * 3;
   normal[i] = byte(.5 + .5 * nx * inv);
   normal[i + 1] = byte(.5 + .5 * ny * inv);
   normal[i + 2] = byte(.5 + .5 * inv);
  }
 }
 return normal;
}

async function bakeGrip() {
 const w = 512, h = 256;
 const grain = await sharp(path.join(dir, 'grip_rubber_source.png'))
  .resize(w, h, {fit: 'fill'}).greyscale().raw().toBuffer();
 const color = Buffer.alloc(w * h * 3), orm = Buffer.alloc(color.length), surface = new Float32Array(w * h);
 const graphite = [69, 66, 63], orange = [221, 77, 25], ivory = [237, 216, 180];

 for (let y = 0; y < h; y++) {
  const v = (y + .5) / h;
  const lane = Math.abs((v * 6 + .5) % 1 - .5);
  const seam = 1 - smooth(0, .065, Math.min(v, 1 - v));
  const raised = 1 - smooth(.29, .44, lane);
  for (let x = 0; x < w; x++) {
   const u = (x + .5) / w, end = Math.min(u, 1 - u);
   const shift = u - .11 * lane;
   const speedStripe = Math.max(band(shift, .070, .123, .006), band(shift, .839, .876, .006));
   const enamel = speedStripe * raised;
   const cream = Math.max(band(shift, .132, .148, .004), band(shift, .884, .915, .006)) * raised;
   const rib = (shift * 18 + .5) % 1;
   const groove = (1 - smooth(.12, .37, Math.min(rib, 1 - rib))) * raised * band(u, .226, .81, .039);
   const channel = (1 - raised) * band(u, .05, .96, .09);
   const i = y * w + x, j = i * 3;
   const micro = mix(grain[i], (grain[i] + grain[(h - 1 - y) * w + x]) * .5, seam) - 117;
   const painted = Math.max(enamel, cream);
   for (let c = 0; c < 3; c++) {
    const pigment = mix(mix(graphite[c] + .28 * micro, orange[c], enamel), ivory[c], cream);
    color[j + c] = byte((pigment - 21 * groove - 20 * channel) / 255);
   }
   orm[j] = 255;
   orm[j + 1] = byte(mix(.71 + groove * .08 - channel * .11 + micro * .0018, .46, painted));
   orm[j + 2] = 0;
   surface[i] = -.011 * groove + .010 * cream + .012 * enamel + micro * mix(.00044, .00016, painted);
  }
 }
 await Promise.all([
  png('grip_basecolor', color, w, h),
  png('grip_orm', orm, w, h),
  png('grip_normal', normalMap(surface, w, h, 8.35, 8.4), w, h)
 ]);
}

async function bakeHardware() {
 const w = 256, h = 128;
 const grain = await sharp(brushedMetal).resize(w, h).greyscale().raw().toBuffer();
 const surface = new Float32Array(w * h), roughness = Buffer.alloc(w * h);
 for (let y = 0; y < h; y++) {
  const v = (y + .5) / h;
  const seam = 1 - smooth(0, .14, Math.min(v, 1 - v));
  for (let x = 0; x < w; x++) {
   const i = y * w + x;
   const brush = mix(grain[i], (grain[i] + grain[(h - 1 - y) * w + x]) * .5, seam) - 141;
   const tooling = Math.sin(Math.PI * 2 * x / 6);
   roughness[i] = byte(.29 + brush * .0015 + tooling * .023);
   surface[i] = brush * .00017 + tooling * .0018;
  }
 }
 await Promise.all([
  png('hardware_roughness', roughness, w, h, 1),
  png('hardware_normal', normalMap(surface, w, h, 2.4, 8), w, h)
 ]);
}

async function bakeLens() {
 const w = 96, h = 384, pixels = w * h;
 const albedo = Buffer.alloc(pixels), roughness = Buffer.alloc(pixels);
 const emissive = Buffer.alloc(pixels), surface = new Float32Array(pixels);
 for (let y = 0; y < h; y++) {
  const v = (y + .5) / h, window = Math.abs((v * 6) % 1 - .5);
  const prism = .5 - .5 * Math.cos(Math.PI * 2 * v * 96);
  for (let x = 0; x < w; x++) {
   const u = (x + .5) / w, edge = Math.min(u, 1 - u);
   const corner = Math.hypot(Math.max(.20 - edge, 0) / .20, Math.max(window - .18, 0) / .158);
   const diffuser = (1 - smooth(.63, 1.18, corner)) * band(u, .006, .994, .24);
   const spine = 1 - smooth(.038, .26, Math.abs(u - .52));
   const i = y * w + x;
   albedo[i] = byte(.23 + diffuser * (.52 + spine * .16 + prism * .08));
   roughness[i] = byte(.29 + .18 * (1 - diffuser) + .11 * prism);
   emissive[i] = byte(.09 + diffuser * (.45 + spine * .30 + prism * .16));
   surface[i] = .018 * diffuser + .0040 * diffuser * prism;
  }
 }
 await Promise.all([
  png('lens_basecolor', albedo, w, h, 1),
  png('lens_roughness', roughness, w, h, 1),
  png('lens_emissive', emissive, w, h, 1),
  png('lens_normal', normalMap(surface, w, h, .67, 7.6), w, h)
 ]);
}

Promise.all([bakeGrip(), bakeHardware(), bakeLens()]).catch(e => {
 console.error(e);
 process.exitCode = 1;
});
