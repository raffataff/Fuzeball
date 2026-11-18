'use strict';
const path = require('path');
const sharp = require('sharp');
const {band, smooth, length} = require('./helios_goal_geometry.js');

const width = 1024, height = 128;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x) => Math.max(0, Math.min(1, x));
const byte = (x) => Math.round(255 * clamp(x));

// U follows the entire arch from foot to foot. V starts at the field-facing
// lens and crosses the chamfer, outer flank, rear spine and inner flank.
async function bakeGoalMaps(dir) {
 const source = path.join(dir, 'source_art', 'goal_brushed_metal.png');
 const grain = await sharp(source).greyscale().raw().toBuffer();
 const pixels = width * height;
 if (grain.length !== pixels) throw new Error('Expected a 1024 × 128 goal metal swatch');

 const color = Buffer.alloc(pixels * 3);
 const normal = Buffer.alloc(pixels * 3);
 const orm = Buffer.alloc(pixels * 3);
 const emissive = Buffer.alloc(pixels * 3);
 const surface = new Float32Array(pixels);
 const graphite = [70, 67, 64], orange = [203, 60, 19];
 const ivory = [235, 213, 170], alloy = [191, 160, 117];
 const inset = [21, 23, 26], lamp = [255, 155, 53];

 for (let y = 0; y < height; y++) {
  const v = (y + .5) / height;
  const front = Math.min(v, 1 - v), back = Math.abs(v - .5);
  const channel = 1 - smooth(.066, .080, front);
  const rail = band(front, .079, .134, .008);
  const flank = band(front, .140, .306, .014);
  const spine = 1 - smooth(.053, .069, back);
  const seam = 1 - smooth(0, .12, front);
  for (let x = 0; x < width; x++) {
   const u = (x + .5) / width, end = Math.min(u, 1 - u);
   const foot = 1 - smooth(.043, .056, end);
   const cuff = band(end, .060, .088, .006);
   const mount = band(end, .208, .251, .009);
   const slanted = end - .062 * (front - .16);
   const cream = flank * Math.max(band(slanted, .194, .204, .002), band(slanted, .266, .282, .003));
   const orangePanel = flank * band(end, .094, .49, .012);
   const slots = Math.max(band(end, .111, .183, .008), band(end, .326, .459, .009));
   const lens = slots * (1 - smooth(.040, .064, front));
   const prism = .82 + .18 * Math.cos(2 * Math.PI * u * 183);
   const lit = lens * (.58 + .42 * (1 - smooth(.006, .048, front))) * prism;
   const trim = Math.max(band(end, .007, .014, .002), band(end, .032, .043, .003), cuff);
   const metal = Math.max(rail, spine * .70, trim, mount * .85) * (1 - cream);
   const fastener = 1 - smooth(.68, 1, Math.hypot((end - .025) / .007, (front - .175) / .051));
   const socket = fastener * (1 - smooth(.20, .36, Math.abs(front - .175) / .051));
   const dark = Math.max(channel * (1 - foot) * (1 - cuff), fastener * .60);
   const i = y * width + x, k = i * 3;
   // Blend the generated brush grain across the cylindrical seam.
   const brush = lerp(grain[i], (grain[i] + grain[(height - 1 - y) * width + x]) * .5, seam) - 141;

   for (let c = 0; c < 3; c++) {
    const paint = lerp(lerp(graphite[c], orange[c], orangePanel), ivory[c], cream);
    const machined = lerp(lerp(paint, alloy[c], metal), alloy[c] * .8, fastener * .7);
    const finish = lerp(machined, inset[c], Math.max(dark, socket));
    color[k + c] = byte((lerp(finish, lamp[c] * prism, lens) + brush * lerp(.12, .56, metal)) / 255);
    emissive[k + c] = byte(lit * lamp[c] / 255);
   }
   orm[k] = byte(1 - .34 * dark * (1 - .8 * lens));
   orm[k + 1] = byte(lerp(lerp(lerp(.56, .35, Math.max(cream, orangePanel)), .24, metal)
                  + .1 * dark, .23 + .13 * prism, lens) + brush * .0015);
   orm[k + 2] = byte(lerp(.28 * (1 - Math.max(cream, orangePanel)), .94, metal) * (1 - lens) * (1 - .74 * dark));
   surface[i] = -.045 * socket + .020 * fastener + .013 * lens * prism + .009 * cream
              + brush * lerp(.00028, .00053, metal);
  }
 }

 // Use the developed arch length and the average perimeter of the section.
 // Use those scales for the height derivatives and encode glTF's +Y-up normal.
 for (let y = 0; y < height; y++) {
  const row = y * width, up = ((y + height - 1) % height) * width, down = ((y + 1) % height) * width;
  for (let x = 0; x < width; x++) {
   const k = (row + x) * 3;
   const nx = (surface[row + Math.max(0, x - 1)] - surface[row + Math.min(width - 1, x + 1)]) * width / (2 * length);
   const ny = (surface[down + x] - surface[up + x]) * height / 7.8;
   const inv = 1 / Math.hypot(nx, ny, 1);
   normal[k] = byte(.5 + .5 * nx * inv);
   normal[k + 1] = byte(.5 + .5 * ny * inv);
   normal[k + 2] = byte(.5 + .5 * inv);
  }
 }

 return Promise.all(Object.entries({basecolor: color, normal, orm, emissive}).map(async ([kind, rgb]) => {
  const name = 'goal_frame_' + kind;
  await sharp(rgb, {raw: {width, height, channels: 3}}).png().toFile(path.join(dir, name + '.png'));
  return name;
 }));
}

module.exports = bakeGoalMaps;
