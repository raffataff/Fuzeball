// Re-renders the Foosball Sound Lab takes the game has, headless, from tools/soundlab/map.json: what the lab's Fuzeball panel exported (venue profiles, seeds, speeds).
// The lab lives outside the repo (Documents/Fuzeball files/foosball-sound-lab); this runs its src/audio/takes.js in Node. Pick and export sounds in the lab: node tools/soundlab-server.js
//
// USAGE
//   node tools/soundlab-render.mjs                       re-render every exported take set, old takes to tools/build/sfx-backup/<stamp>-soundlab/, manifest rebuilt
//   ... --dry                                            render and report only, takes go to tools/build/soundlab/
//   ... --only=ball_roll_slow,rod_bump_arena             some file ids
//   ... --lab=<path>                                     another copy of the lab
//
// use it after changing a loop part's speed line or a hit's pRef in CONFIG, or after a change to the lab's synth: the takes come out as the panel would make them
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AM = require('./build_audio_manifest.js'), SP = require('./soundlab/spec.js'), IO = require('./soundlab/io.js');
const arg = k => { const a = process.argv.find(s => s.startsWith('--' + k)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : null; };
const LAB = path.resolve(arg('lab') || path.join(ROOT, '..', '..', 'Fuzeball files', 'foosball-sound-lab'));
const DRY = !!arg('dry'), ONLY = arg('only') ? String(arg('only')).split(',') : null;
if (!fs.existsSync(path.join(LAB, 'src', 'audio', 'takes.js'))) { console.error('no Sound Lab with takes.js at ' + LAB + ' (pass --lab=<path>)'); process.exit(1); }
const T = await import(pathToFileURL(path.join(LAB, 'src', 'audio', 'takes.js')).href);

const C = AM.loadConfig(), specs = SP.specs(C), map = IO.loadMap(), lab = { base: SP.BASE, venues: map.venues };
const KIND_OF = { tables: C.tables, pitches: C.pitches, rooms: C.rooms, balls: C.ballTypes };

// a file id back to its sound and venue: <id> = the base venue, <id>_<venueId>, ir_<roomId>
function parse(file) {
 if (file.startsWith('ir_')) return { sp: specs.find(s => s.kind === 'ir'), venue: file.slice(3) };
 const sp = specs.find(s => s.id === file);
 if (sp) return { sp, venue: null };
 for (const s of specs) if (s.by && file.startsWith(s.id + '_') && KIND_OF[s.by][file.slice(s.id.length + 1)]) return { sp: s, venue: file.slice(s.id.length + 1) };
 return null;
}

const todo = Object.entries(map.exported).filter(([f]) => !ONLY || ONLY.includes(f));
if (!todo.length) { console.log(ONLY ? 'none of ' + ONLY.join(', ') + ' was exported from the lab' : 'nothing exported from the lab yet: pick and export sounds in node tools/soundlab-server.js'); process.exit(0); }
console.log('Sound Lab: ' + LAB + (DRY ? '   (dry: tools/build/soundlab)' : '') + '\n');
const gains = new Map(), sets = [];
for (const [file, e] of todo) {
 const q = parse(file);
 if (!q) { console.log('  ' + file.padEnd(32) + 'skipped: no sound or venue by that name now'); continue; }
 const spec = { ...q.sp, v: q.sp.v != null ? q.sp.v * (e.speed || 1) : undefined, takes: e.takes || q.sp.takes };
 const key = spec.id + '|' + (e.speed || 1);
 if (!gains.has(key) && spec.kind !== 'ir') gains.set(key, T.calibrate(spec, T.venueParams(lab)));
 const takes = spec.kind === 'ir' ? [SP.irTake(T, lab, q.venue, e.seed)] : T.renderTakes(spec, T.venueParams(lab, q.venue ? q.sp.by : null, q.venue), e.seed || 1, gains.get(key));
 sets.push({ file, sr: T.TAKE_SR, seed: e.seed || 1, takes: takes.map(t => t.channels) });
 console.log('  ' + file.padEnd(32) + takes.map(t => t.seconds.toFixed(2) + 's ' + t.peakDb.toFixed(1) + (t.lkfs != null ? '/' + t.lkfs.toFixed(1) : '') + (t.limited ? ' limited' : '')).join('  '));
}
if (DRY) {
 const out = path.join(ROOT, 'tools', 'build', 'soundlab');
 fs.mkdirSync(out, { recursive: true });
 for (const s of sets) s.takes.forEach((ch, i) => fs.writeFileSync(path.join(out, s.file + '_' + String(i + 1).padStart(2, '0') + '.wav'), IO.wav16(ch, s.sr, s.seed * 31 + i)));
 console.log('\n' + sets.length + ' sets written to tools/build/soundlab');
} else {
 const r = IO.writeSets(sets);
 console.log('\n' + sets.length + ' sets written' + (r.backup ? ', old takes in ' + r.backup : '') + (r.bad.length ? '\nnot sound ids, left out: ' + r.bad.join(', ') : ''));
}
