// Run the match physics, rods and AI without the renderer.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scripts = ['core', 'config', 'arena', 'rng', 'state', 'stats', 'moments', 'matchstats',
 'seats', 'balls', 'rods', 'physics', 'ai', 'shots'];
const sources = Object.fromEntries(scripts.map(name => [name, fs.readFileSync('js/' + name + '.js', 'utf8')]));
const three = new vm.Script(fs.readFileSync('vendor/three.bundle.js', 'utf8'));

function boot(mutation) {
 const context = vm.createContext({assert, console, localStorage: {getItem: () => null}});
 context.window = context;
 three.runInContext(context);
 for (const [name, source] of Object.entries(sources)) {
  const code = mutation?.file === name ? source.replace(mutation.from, mutation.to) : source;
  if (mutation?.file === name) assert.notEqual(code, source, 'mutation anchor missing');
  vm.runInContext(code, context, {filename: name + '.js'});
 }
 return vm.runInContext(`
  const rods = [], scene = new THREE.Scene(), dbgLogRod = null;
  const Au = new Proxy({}, {get: () => () => {}});
  const dt = 1 / SIM.hz;
  function teamDiff() { return 'legend'; }
  function deadzoneMult() { return 1; }
  function deadLeft() { return Infinity; }
  function perfSub() {}
  function spawnMark() {}
  function spawnTrail() {}
  function makeBallModel() {}
  function applyBallEnv() {}
  function notice() {}
  function onGoal() {}
  function outOfBounds() {}

  function setup(table, team, onlyRod = true) {
   ARENA_ON = table === 'arena';
   WALL_H = CONFIG.tables[table].wallH || F.wallH;
   ENDWALL_H = CONFIG.tables[table].endWall?.h || 0;
   S.time = 0;
   S.balls.length = rods.length = S.seats.length = 0;
   S.phase = 'play';
   S.lastTouch = -1;
   S.active = [[], []];
   rngSeed(1);
   const def = RODDEFS.find(d => d.team === team && d.role === 'MID');
   const spacing = CONFIG.rods.spacing.other;
   const r = {
    ...def, idx: RODDEFS.indexOf(def), men: [], pivot: new THREE.Group(), removedUntil: [],
    baseZ: Array.from({length: def.men}, (_, i) => (i - (def.men - 1) / 2) * spacing),
    maxOff: (F.W - CONFIG.rods.margin - (def.men - 1) * spacing) / 2,
    kickDir: team ? -1 : 1, offset: 0, target: 0, prevOffset: 0, slideV: 0,
    angle: 0, prevAngle: 0, angVel: 0, vz: 0, cd: 0, exert: 0,
    aiErr: 0, aiErrT: Infinity, aiIQ: true, aiBX: 0, aiBZ: 0, aiBVX: 0, aiBVZ: 0
   };
   if (onlyRod) rods.push(r);
   resetRodRotation();
   return r;
  }
  function ballAt(r, rel, z, y = BALL_R) {
   const ball = makeBall('classic');
   ball.m.position.set(r.x + r.kickDir * rel, y, z);
   syncBall(ball);
   return ball;
  }
  function step(useAI = false) {
   if (useAI) aiUpdate(dt);
   updateRods(dt);
   physics(dt);
   for (const ball of S.balls) ball.cur.copy(ball.m.position);
   S.time += dt;
  }
  function wallZ(side) { return side * (F.W / 2 - BALL_R); }

  function stop() {
   const r = setup('classic', 0);
   r.offset = r.prevOffset = r.maxOff - 0.05;
   r.target = r.maxOff;
   r.slideV = 40;
   updateRods(dt);
   assert.equal(r.offset, r.maxOff);
  }
  function strike(table, team, side) {
   const r = setup(table, team);
   r.offset = r.prevOffset = r.target = side * r.maxOff;
   const z = table === 'arena' ? side * 30.2 : wallZ(side);
   const y = table === 'arena' ? pinSurfaceY(r.x, z) : BALL_R;
   const b = ballAt(r, 3.5, z, y);
   const from = b.cur.clone();
   kickRod(r, 'shoot');
   step();
   assert.ok(b.cur.distanceTo(from) < 1.6, 'a swing visibly shoved the ball in one tick');
   assert.ok(b.v.length() > 15, 'a reachable strike failed to move the ball');
  }
  function carry(team, side, rel) {
   const r = setup('classic', team);
   const z = wallZ(side);
   const b = ballAt(r, rel, z);
   let pulled = 0;
   for (let i = 0; i < 2 * SIM.hz; i++) {
    step(true);
    if (b.pinR === r) pulled = Math.max(pulled, (z - b.cur.z) * side);
   }
   assert.ok(pulled >= 3, 'AI did not pin and carry the ball away from the rail');
  }
  function finesse(fwd = false) {
   const r = setup('classic', 0);
   r.offset = r.prevOffset = r.target = r.maxOff;
   r.angle = r.prevAngle = fwd ? AIC.catch.recv.lift.angle : SHOT.pin.assist.up;
   S.seats.push({rods: [r], ctrl: 0, tcMult: 1});
   const b = ballAt(r, fwd ? 5 : -4, wallZ(1));
   const input = {fin: true, rz: !fwd, kh: fwd, m: SHOT.pass.modAt};
   if (fwd) shotKickEdge(r, input.m);
   for (let i = 0; i < SIM.hz && !r.pinB; i++) {
    shotPinInput(r, input, dt);
    step();
   }
   assert.ok(r.pinB === b, 'finesse did not take the rail-side ball');
   assert.equal(b.cur.z, wallZ(1));
   r.vzH = [40, 40, 40, 40];
   pinRelease(r);
   assert.equal(b.v.z, 0, 'release added slide into the wall');
   shotPinInput(r, input, dt);
   step();
   assert.ok(r.pinB === b, 'finesse did not retake the released ball');
   r.target = r.maxOff - 4;
   step();
   assert.ok(b.cur.z < wallZ(1) && r.pinB === b, 'player could not pull the pin infield');
  }
  function bowl() {
   const r = setup('arena', 0, false);
   const side = 1, z = side * 30.4, y = pinSurfaceY(r.x, z);
   const b = ballAt(r, 0, z, y);
   const other = ballAt(r, 0, z - 2, BALL_R);
   other.v.z = 12;
   step();
   const p = b.cur, depth = -arenaSD(p.x, p.z, F.goalHalf, F.goalHalf), cr = ARENA.creaseR;
   assert.ok(Math.hypot(cr - depth, cr - p.y) <= cr - BALL_R + 1e-6,
    'ball separation left a ball inside the curved rail');
  }
  ({stop, strike, carry, finesse, bowl});
 `, context);
}

const tests = boot();
tests.stop();
for (const table of ['classic', 'circuit', 'arena']) {
 for (const team of [0, 1]) {
  for (const side of [-1, 1]) tests.strike(table, team, side);
 }
}
for (const team of [0, 1]) {
 for (const side of [-1, 1]) {
  for (const rel of [-4, 5]) tests.carry(team, side, rel);
 }
}
tests.finesse();
tests.finesse(true);
tests.bowl();

const mutations = [
 {file: 'rods', from: 'r.offset=clamp(r.offset+r.slideV*dt,-r.maxOff,r.maxOff);',
  to: 'r.offset+=r.slideV*dt;', test: t => t.stop()},
 {file: 'physics', from: 'PHY.railPush*h:Infinity', to: 'Infinity:Infinity',
  test: t => t.strike('classic', 0, 1)},
 {file: 'ai', from: "if(rail){r.ftPh=null;ph='rail';}", to: "if(false){r.ftPh=null;ph='rail';}",
  test: t => t.carry(0, 1, -4)},
 {file: 'physics', from: 'b.v.set(0,0,intoRail?0:vz);', to: 'b.v.set(0,0,vz);',
  test: t => t.finesse()},
 {file: 'physics', from: 'if(!a.scored)staticClamp(a);', to: '',
  test: t => t.bowl()}
];
for (const mutation of mutations) {
 const mutant = boot(mutation);
 assert.throws(() => mutation.test(mutant), {code: 'ERR_ASSERTION'}, mutation.from);
}
console.log('24 rail scenarios passed, 5/5 mutations caught');
