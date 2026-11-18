// Run from the repo root with node tools/ai-kick-harness.js.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = vm.createContext({assert, console, localStorage: {getItem: () => null}});
ctx.window = ctx;
vm.runInContext(fs.readFileSync('vendor/three.bundle.js', 'utf8'), ctx);
for (const name of ['core', 'config', 'arena', 'rng', 'state', 'stats', 'moments',
 'matchstats', 'seats', 'balls', 'rods', 'physics', 'ai', 'shots']) {
 vm.runInContext(fs.readFileSync('js/' + name + '.js', 'utf8'), ctx, {filename: name + '.js'});
}

vm.runInContext(`
 const rods = [], scene = new THREE.Scene(), dbgLogRod = null;
 const Au = new Proxy({}, {get: () => () => {}});
 const dt = 1 / SIM.hz;
 let difficulty, whistle;
 function teamDiff() { return difficulty; }
 function deadzoneMult() { return 1; }
 function deadLeft() { return whistle; }
 function perfSub() {}
 function spawnMark() {}
 function spawnTrail() {}
 function makeBallModel() {}
 function applyBallEnv() {}
 function notice() {}
 function onGoal() {}
 function outOfBounds() {}

 function test(diff, team, role, label, opt) {
  difficulty = diff;
  whistle = opt.force ? 0.25 : Infinity;
  rngSeed(1);
  S.time = 0;
  S.userTeam = -1;
  S.phase = 'play';
  S.active = [[], []];
  S.lastTouch = -1;
  S.balls.length = 0;
  const def = RODDEFS.find(d => d.role === role && d.team === team);
  const dir = team ? -1 : 1;
  const seenDepth = 3.4;
  const seenX = def.x + dir * seenDepth;
  const spacing = CONFIG.rods.spacing.three;
  const r = {
   ...def, idx: RODDEFS.indexOf(def), pivot: new THREE.Group(), men: [], removedUntil: [],
   baseZ: Array.from({length: def.men}, (_, i) => (i - (def.men - 1) / 2) * spacing),
   maxOff: role === 'GK' ? CONFIG.rods.gkSlide : (F.W - CONFIG.rods.margin - 2 * spacing) / 2,
   kickDir: dir, offset: 0, target: 0, prevOffset: 0, slideV: 0, angle: 0,
   prevAngle: 0, angVel: 0, vz: 0, cd: 0, exert: 0,
   aiErr: 0, aiErrT: 1, aiIQ: false, aiBX: seenX, aiBZ: 0, aiBVX: 0, aiBVZ: 0
  };
  rods.length = 0;
  rods.push(r);
  resetRodRotation();
  if (opt.dribble) {
   r.act = 'dribble';
   r.dribMan = 1;
   r.dribEvT = 1;
  }
  const ball = makeBall('classic');
  ball.m.position.set(seenX, BALL_R, 0);
  syncBall(ball); // the delayed view sees a low, aligned ball in reach
  ball.m.position.set(r.x + dir * (opt.depth ?? seenDepth), BALL_R, opt.z ?? 0);
  ball.cur.copy(ball.m.position);
  ball.v.x = dir * (opt.vx ?? 0);
  const message = [diff, team, role, label].join(' ');
  aiUpdate(dt);
  if (!opt.hit) {
   assert.equal(r.kickT, -1, message);
   assert.equal(r.cd, 0, message + ' cooldown');
   assert.equal(r.exert, 0, message + ' exertion');
   return;
  }
  assert.equal(r.kickT, 0, message);
  for (let i = 0; i < 3 && !r.kickHit; i++) {
   updateRods(dt);
   physics(dt);
  }
  assert.ok(r.kickHit, message + ' made contact');
  assert.ok(ball.v.x * dir > 0, message + ' sent the ball forward');
 }

 for (const diff of ['pro', 'legend']) {
  for (const team of [0, 1]) {
   for (const role of ['ATT', 'GK']) {
    test(diff, team, role, 'ball already behind', {depth: -4, vx: -85});
    test(diff, team, role, 'ball beyond the kick window', {depth: 9, vx: 50});
    test(diff, team, role, 'ball clear of boot sideways', {z: 4});
    test(diff, team, role, 'ball in contact range', {hit: true});
   }
   test(diff, team, 'ATT', 'dribble release out of reach', {dribble: true, z: 4});
   test(diff, team, 'ATT', 'dribble release in reach', {dribble: true, hit: true});
   test(diff, team, 'GK', 'fast goalbound ball in reach', {depth: 4.4, vx: -95, hit: true});
   test(diff, team, 'GK', 'dead-ball force still needs live contact', {force: true, z: 4});
   test(diff, team, 'GK', 'dead-ball clearance in reach', {force: true, hit: true});
  }
 }
 console.log('52 AI kick scenarios passed');
`, ctx, {filename: 'ai-kick-scenarios.js'});
