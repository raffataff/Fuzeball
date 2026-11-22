// Run from the repo root with node tools/forward-pin-harness.js.
// Drive the AI, rod motion and ball physics without rendering a table.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = vm.createContext({assert, console, localStorage: {getItem: () => null}});
ctx.window = ctx;
vm.runInContext(fs.readFileSync('vendor/three.bundle.js', 'utf8'), ctx);
for (const name of ['core', 'config', 'arena', 'rng', 'state', 'stats', 'moments',
 'matchstats', 'seats', 'balls', 'rods', 'physics', 'ai', 'shots', 'powerups']) {
 vm.runInContext(fs.readFileSync('js/' + name + '.js', 'utf8'), ctx, {filename: name + '.js'});
}

vm.runInContext(`
 const rods = [], scene = new THREE.Scene(), dbgLogRod = null;
 const Au = new Proxy({}, {get: () => () => {}});
 const dt = 1 / SIM.hz;
 let difficulty;
 function teamDiff() { return difficulty; }
 function perfSub() {}
 function spawnMark() {}
 function spawnTrail() {}
 function makeBallModel() {}
 function applyBallEnv() {}
 function notice() {}
 function onGoal() {}
 function outOfBounds() {}
 function replayCut() {}

 function makeRod(def, idx) {
  const {spacing, margin} = CONFIG.rods;
  const gap = spacing[def.men === 2 ? 'two' : def.men === 3 ? 'three' : 'other'];
  const baseZ = Array.from({length: def.men}, (_, i) => (i - (def.men - 1) / 2) * gap);
  return {...def, idx, pivot: new THREE.Group(), removedUntil: [], baseZ,
   maxOff: def.slideCap ?? (F.W - margin - (def.men - 1) * gap) / 2,
   kickDir: def.team ? -1 : 1, offset: 0, target: 0, prevOffset: 0, slideV: 0,
   angle: 0, prevAngle: 0, angVel: 0, vz: 0, cd: 0, exert: 0, aiErr: 0, aiErrT: 1e6,
   aiIQ: true, aiBX: def.x, aiBZ: 0, aiBVX: 0, aiBVZ: 0};
 }

 function play({team = 0, edge = -1, depth = 3.4, diff = 'legend', role = 'ATT',
  covered = true, alone = false, hit = false, track = false, screen = null} = {}) {
  difficulty = diff;
  AIC.catch.hit.share = hit ? 1 : 0;
  rngSeed(1);
  S.time = 0;
  S.userTeam = -1;
  S.phase = 'play';
  S.active = [[], []];
  S.lastTouch = -1;
  S.balls.length = 0;
  rods.splice(0, rods.length, ...RODDEFS.map(makeRod));
  resetRodRotation();

  const r = rods.find(q => q.team === team && q.role === role);
  const def = rods.filter(q => q.team !== team && (q.x - r.x) * r.kickDir > 0)
   .sort((a, b) => (a.x - b.x) * r.kickDir)[0];
  const keeper = rods.find(q => q.team !== team && q.role === 'GK');
  const man = edge < 0 ? 0 : edge === 0 ? 1 : r.baseZ.length - 1;
  for (const q of rods) {
   if (q === r && alone) q.removedUntil = q.baseZ.map((_, i) => i === man ? 0 : Infinity);
   if (q !== r && (!covered || (q !== def && q !== keeper))) q.removedUntil = q.baseZ.map(() => Infinity);
  }
  if (screen) {
   // The two defenders leave a narrow lane through the middle and cover both wings.
   r.maxOff = 6;
   def.offset = def.prevOffset = def.target = -3.5 - def.baseZ[0];
   keeper.offset = keeper.prevOffset = keeper.target = 3.5;
  }
  r.target = r.offset = r.prevOffset = edge * r.maxOff;
  r.angle = r.prevAngle = 1.4 * r.kickDir;
  const b = makeBall('classic');
  const start = r.baseZ[man] + r.offset;
  b.m.position.set(r.x + depth * r.kickDir, BALL_R, start);
  syncBall(b);
  function tick() {
   updateRods(dt);
   physics(dt);
   S.time += dt;
   b.cur.copy(b.m.position);
  }
  const pose = footAngle(depth, true);
  assert.ok(pose != null);
  for (let i = 0; i < SIM.hz && !r.pinB; i++) {
   r.pinOn = r.pinPose = r.pinFwd = true;
   r.pinA = r.kickDir * pose;
   tick();
  }
  assert.equal(r.pinB?.pinMan, man, 'fixture starts in a forward pin');
  r.act = 'catch';
  r.catPh = 'hold';
  r.catT = 0;
  r.tapN = 0;
  pinPlayStart(r);

  const result = {carry: 0, firstMove: null, reversals: 0, receiver: null, centreGain: 0, kick: null, kickAt: null, clearRow: false, hit: false, phases: []};
  const reasons = {...CAW};
  let lastDir = 0;
  for (let i = 0; i < 3.5 * SIM.hz; i++) {
   const phase = r.catPh === 'hit' ? r.hPh : r.catPh;
   if (phase !== result.phases.at(-1)) result.phases.push(phase);
   if (r.pinB && r.pinB.pinMan !== man) {
    result.receiver = r.pinB.pinMan;
    result.centreGain = Math.abs(start) - Math.abs(b.m.position.z);
    break;
   }
   if (r.kickT >= 0) {
    result.kick = r.kickStyle;
    result.kickAt = r.catT;
    if (screen) {
     const defTarget = def.target, keeperTarget = keeper.target;
     for (let j = 0; j < SIM.hz / 2; j++) {
      aiUpdate(dt);
      def.target = defTarget;
      keeper.target = keeperTarget;
      tick();
      if (b.tc?.team === def.team) break;
      if ((b.cur.x - def.x) * r.kickDir > BALL_R) {
       result.clearRow = true;
       break;
      }
     }
    }
    break;
   }
   if (r.catPh === 'hit') result.hit = true;
   if (r.catPh === 'hold' && r.pinB) {
    result.carry = Math.max(result.carry, Math.abs(b.m.position.z - start));
    if (result.firstMove == null && result.carry > DEAD.moveEps) result.firstMove = r.catT;
    const dir = Math.abs(r.slideV) > 5 ? Math.sign(r.slideV) : 0;
    if (dir && lastDir && dir !== lastDir) result.reversals++;
    if (dir) lastDir = dir;
   }
   if (screen) {
    if (screen === 'follow' && Math.abs(b.m.position.z) > 2 && r.pcWalkN === 1) {
     const z = Math.sign(b.m.position.z) * 5;
     def.target = clamp(z - def.baseZ[0], -def.maxOff, def.maxOff);
     keeper.target = z;
    }
    if (r.act === 'catch') catchStep(r, b, DIFFS[diff]);
   } else if (track) {
    // Keep the keeper central and let the nearer defensive man follow the carrier.
    if (r.pinB) def.target = clamp(b.m.position.z - def.baseZ[0], -def.maxOff, def.maxOff);
    if (r.act === 'catch') catchStep(r, b, DIFFS[diff]);
   } else {
    aiUpdate(dt);
   }
   tick();
  }
  result.ended = Object.keys(CAW).filter(k => CAW[k] !== reasons[k]);
  return result;
 }

 for (const team of [0, 1]) for (const edge of [-1, 1]) {
  const wide = play({team, edge});
  assert.equal(wide.receiver, 1, JSON.stringify(wide));
  assert.ok(wide.centreGain > 15, JSON.stringify(wide));
  const single = play({team, edge, alone: true});
  assert.equal(single.receiver, null);
  assert.ok(single.carry > 8, JSON.stringify(single));
  assert.equal(single.reversals, 0, JSON.stringify(single));
 }
 const sideHit = play({hit: true, track: true});
 assert.equal(sideHit.receiver, 1, JSON.stringify(sideHit));
 assert.ok(sideHit.hit && sideHit.carry > 8, JSON.stringify(sideHit));
 const deep = play({depth: 5.2});
 assert.equal(deep.receiver, 1, JSON.stringify(deep));
 const defence = play({role: 'DEF', track: true});
 assert.equal(defence.receiver, 1, JSON.stringify(defence));
 assert.ok(defence.carry > 8 && defence.reversals === 0, JSON.stringify(defence));
 const midfield = play({role: 'MID', diff: 'rookie', track: true});
 assert.ok(midfield.carry > 8 && midfield.reversals === 0, JSON.stringify(midfield));
 assert.equal(midfield.kick, 'pinShot', JSON.stringify(midfield));
 const open = play({edge: 0, covered: false});
 assert.equal(open.kick, 'snake', JSON.stringify(open));
 console.log('13 forward pin scenarios passed');
 for (const team of [0, 1]) {
  const covered = play({team, edge: 0, alone: true, screen: 'fixed'});
  assert.ok(covered.firstMove != null && covered.firstMove < 0.75, JSON.stringify(covered));
  assert.ok(covered.reversals > 0, JSON.stringify(covered));
  const opening = play({team, edge: 0, alone: true, screen: 'follow'});
  assert.ok(opening.kick === 'snake' && opening.kickAt < AIC.catch.holdT && opening.clearRow, JSON.stringify(opening));
 }
 const slideMax = AIC.catch.slideMax;
 AIC.catch.slideMax = 0;
 const narrow = play({edge: 0, alone: true, screen: 'fixed'});
 AIC.catch.slideMax = slideMax;
 assert.ok(narrow.kick === 'snake' && narrow.clearRow, JSON.stringify(narrow));
 assert.ok(narrow.kickAt >= AIC.catch.holdT && narrow.kickAt <= AIC.catch.holdT + 2 * dt, JSON.stringify(narrow));
 console.log('5 covered forward pin scenarios passed');

 function stalledPin(team, snake, wedge) {
  difficulty = 'legend';
  rngSeed(1);
  S.time = 0;
  S.phase = 'play';
  S.active = [[], []];
  S.balls.length = 0;
  rods.splice(0, rods.length, ...RODDEFS.map(makeRod));
  resetRodRotation();

  const r = rods.find(q => q.team === team && q.role === 'ATT');
  const def = rods.find(q => q.team !== team && q.role === 'DEF');
  def.offset = def.target = def.prevOffset = -def.baseZ[0];
  const x = r.x + 3.4 * r.kickDir;
  const b = makeBall('classic');
  b.m.position.set(x, BALL_R, 0);
  syncBall(b);
  r.angle = r.prevAngle = r.pinA = footAngle(3.4, true) * r.kickDir;
  r.pinOn = r.pinPose = r.pinFwd = true;
  physics(dt);
  assert.equal(r.pinB, b, 'fixture starts in a forward pin');
  r.act = 'catch';
  r.catPh = 'hold';
  r.catT = AIC.catch.holdT;
  pinPlayStart(r);
  r.pcSnD = snake;
  if (wedge) {
   const other = makeBall('classic');
   other.m.position.set(x, BALL_R, 20);
   syncBall(other);
   other.v.z = 15;
  }
  // The carry budget is spent and the current lane is covered.
  AIC.catch.slideMax = 0;
  const phases = [];
  for (let i = 0; i < 8 * SIM.hz; i++) {
   aiUpdate(dt);
   const phase = r.catPh === 'ahead' ? r.ahPh : r.catPh ?? r.kickStyle;
   if (phase !== phases.at(-1)) phases.push(phase);
   deadBallUpdate(dt);
   if (b.m.position.y >= DEAD.redrop.y) break;
   updateRods(dt);
   physics(dt);
   S.time += dt;
   for (const ball of S.balls) ball.cur.copy(ball.m.position);
   if ((b.cur.x - x) * r.kickDir > DEAD.moveEps) return;
  }
  assert.fail('forward pin failed to move the ball before redrop: ' + JSON.stringify({team, snake, wedge, phases}));
 }
 stalledPin(0, true, false);
 stalledPin(1, false, false);
 stalledPin(0, false, true);
 console.log('3 stalled forward pins played before redrop');
`, ctx, {filename: 'forward-pin-scenarios.js'});
