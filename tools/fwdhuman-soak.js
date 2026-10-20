// Human forward-pin scenes. Browser side: load the game (preview 'fuzeball') or run from a terminal:
//      node tools/page-run.js tools/fwdhuman-soak.js "fhAll()"
//      fhScene({ri:5,R:3,dz:8,mode:'catch'})   // red human holds a rod, the other men are off the table; keys go through bindPress / shotSeatsUpdate like a player's
//      fhCatchGrid()                           // a ball at rest R ahead, the leg posed z-clear, then slid onto it: how many pin, where they rest
//      fhStrokeGrid()                          // the stroke: finesse + a TAP of kick with a ball in the man's lane, what leaves and how fast (and the same with kick held: the hop and the pin)
//      fhReleaseGrid()                         // a forward-pinned ball and finesse let go: the ball must not be knocked toward the rod's own goal
// why: the human's forward pin (CONFIG.shots.pin.fwd) shares physics with the AI's fetch (r.pinFwd, the reach rule) but not its choreography: the man is posed first and slid onto the ball, and the leg comes back by itself
// modes: catch = pose z-clear then slide on | stroke = pose with the ball in the lane | release = catch, then finesse up | kick = catch, then kick pressed | raise = catch posed, then raise pressed
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',KICK_K='Space',RZ='ShiftLeft';
 const DZ={5:7,3:4,1:7},MAN={5:1,3:2,1:1};   // a ball this far off the man, so the rod's travel reaches it (a MID's men are 11.9 apart)
 function setup(o){
  S.seedNext=o.seed;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  for(const k of Object.keys(keys))keys[k]=false;
  const s=S.seats[0],r=rods[o.ri];
  const si=s.rods.indexOf(r);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;});
  for(const q of rods)if(q!==r&&o.keep.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  for(const q of rods)if(o.keep.indexOf(q)>=0){for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=0;}
  r.offset=0;r.target=0;r.prevOffset=0;r.pivot.position.z=0;
  return {s,r};
 }
 function step(r,n){
  for(let i=0;i<n;i++){
   shotSeatsUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
  }
 }
 function press(code){keys[code]=true;bindPress(code);}
 function lift(code){keys[code]=false;bindRelease(code);}
 // one scene
 function fhScene(o){
  const a0=cfg.auto;cfg.auto=false;   // the auto rod-switch would walk off the rod mid-scene
  try{return scene(o);}finally{cfg.auto=a0;}
 }
 function scene(o){
  o=Object.assign({ri:5,R:3,dz:8,man:1,seed:1,mode:'catch',T:2.5,keep:[],slide:12,away:0,place:null,tap:null,trace:false,every:0.1},o||{});   // tap: kick let go this long after the press (s)
  const {s,r}=setup(o),dir=r.kickDir,b=makeBall('classic');
  const mz=r.baseZ[o.man]+r.offset;
  const parked=o.place!=null;   // place: the ball is put down this late (s), so the pose's own sweep cannot touch it; until then it waits well off the rod's lane
  b.m.position.set(parked?r.x-dir*12:r.x+o.R*dir,BALL_R,parked?mz+24:mz+o.dz);b.v.set(0,0,0);syncBall(b);
  const k0=S.stats?S.stats.kicks[0]:0,L=[];let nt=0,tPin=null,minVx=0,maxVx=0,swung=false,posed=null;
  // finesse, then kick: the chord a player makes
  keys[FIN]=true;step(r,3);
  if(o.mode==='raise'&&false)press(RZ);
  press(KICK_K);
  const t0=S.time;
  const n=Math.round(o.T*SIM.hz);
  let released=null,kickT=null,raiseT=null,away0=null,placed=false;
  for(let i=0;i<n;i++){
   const t=i/SIM.hz;
   // the player slides onto the ball once the leg is over (z-clear scenes)
   if(o.mode!=='stroke'&&o.dz!==0&&r.angle*dir>0.8&&!released){
    const goal=clamp(b.m.position.z-r.baseZ[o.man],-r.maxOff,r.maxOff),d=goal-r.target;
    r.target+=clamp(d,-o.slide*FIX,o.slide*FIX);   // a player eases onto a ball: o.slide u/s (Infinity = a full-speed slide)
   }
   if(o.mode==='release'&&!released&&r.pinB&&t>0.6){lift(FIN);released=t;}
   if(o.mode==='letgo'&&!released&&t>o.letgo){lift(FIN);released=t;}   // finesse up with nothing pinned: the pose just ends
   if(released!=null&&o.away&&t>released+0.5&&away0==null){away0=r.target;r.target=clamp(away0-o.away,-r.maxOff,r.maxOff);}   // then the player slides the man off the ball (o.away units)
   if(o.mode==='kick'&&kickT==null&&r.pinB&&t>0.5){press(KICK_K);lift(KICK_K);kickT=t;}
   if(o.mode==='raise'&&raiseT==null&&r.pinB&&t>0.5){press(RZ);raiseT=t;}
   if(o.place!=null&&t>=o.place&&!placed){placed=true;b.m.position.set(r.x+o.R*dir,BALL_R,mz+o.dz);b.v.set(0,0,0);syncBall(b);}
   if(o.tap!=null&&t>=o.tap&&keys[KICK_K])lift(KICK_K);
   step(r,1);
   const p=b.m.position,rel=(p.x-r.x)*dir;
   if(posed==null&&Math.abs(r.angle*dir-SHOT.pin.fwd.angle)<0.03)posed=+t.toFixed(2);
   if(r.kickT>=0)swung=true;
   if(tPin==null&&r.pinB)tPin=+t.toFixed(2);
   minVx=Math.min(minVx,b.v.x*dir);maxVx=Math.max(maxVx,b.v.x*dir);
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ang=${(r.angle*dir).toFixed(2)} fwd=${r.pinFwd?1:0} pose=${r.pinPose?1:0} on=${r.pinOn?1:0} pin=${r.pinB?1:0} out=${r.fwdOut?1:0} off=${r.offset.toFixed(1)} | ball rel=${rel.toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(S.phase!=='play'||b.scored)break;
  }
  lift(FIN);lift(KICK_K);lift(RZ);
  const p=b.m.position;
  return {pinned:tPin!=null,tPin,posed,swung,kicksAdded:(S.stats?S.stats.kicks[0]:0)-k0,pinFwd:r.pinFwd,pinPose:r.pinPose,holding:!!r.pinB,
   rel:+((p.x-r.x)*dir).toFixed(2),z:+(p.z-(r.baseZ[o.man]+r.offset)).toFixed(2),vx:+(b.v.x*dir).toFixed(1),vz:+b.v.z.toFixed(1),minVx:+minVx.toFixed(1),maxVx:+maxVx.toFixed(1),
   angle:+(r.angle*dir).toFixed(2),released,kickT,raiseT,L};
 }
 // a ball at rest R ahead, z-clear, the leg posed and slid on: the rod's slide is capped (finesse + the carry) so the relative speed is the pin's to judge
 function fhCatchGrid(o){
  o=Object.assign({Rs:[2.25,2.5,3,3.5,4,4.5,5,5.5],ris:[5,3,1],T:2.5},o||{});
  const rows={};
  for(const ri of o.ris){const nm={5:'ATT',3:'MID',1:'DEF'}[ri];
   for(const R of o.Rs){const a=fhScene({ri,R,dz:DZ[ri],man:MAN[ri],T:o.T,mode:'catch'});rows[nm+' R='+R]=(a.pinned?'PIN rel '+a.rel+' maxVx '+a.maxVx:'no  rel '+a.rel+' vx '+a.vx+' maxVx '+a.maxVx)+' @'+(a.tPin==null?'-':a.tPin);}}
  return rows;
 }
 // finesse + a tap of kick with the ball in the man's lane: the leg goes forward through it (the pass); kick held instead: he steps off, up, over and down onto it
 function fhStrokeGrid(o){
  o=Object.assign({Rs:[1.5,2,2.5,3,3.5,4,5],ris:[5],T:1.5,tap:0.08},o||{});
  const rows={};
  for(const ri of o.ris){const nm={5:'ATT',3:'MID',1:'DEF'}[ri];
   for(const R of o.Rs){
    const a=fhScene({ri,R,dz:0,T:o.T,mode:'stroke',tap:o.tap}),h=fhScene({ri,R,dz:0,T:o.T,mode:'stroke'});
    rows[nm+' R='+R]=`tap: pin=${a.pinned?1:0} leaves ${a.maxVx} u/s (rest ${a.vx}) swung=${a.swung} kicks+${a.kicksAdded} | held: pin=${h.pinned?1:0} @${h.tPin==null?'-':h.tPin} maxVx ${h.maxVx}`;
   }}
  return rows;
 }
 // pinned, then finesse up: nothing may go toward the rod's own goal (minVx), the leg stays up over the ball
 function fhReleaseGrid(o){
  o=Object.assign({Rs:[2.5,3,3.5,4,4.5],ris:[5,3,1],T:2.5},o||{});
  const rows={};
  for(const ri of o.ris){const nm={5:'ATT',3:'MID',1:'DEF'}[ri];
   for(const R of o.Rs){const a=fhScene({ri,R,dz:DZ[ri],man:MAN[ri],T:o.T,mode:'release',away:6});rows[nm+' R='+R]=`pin=${a.pinned?1:0} released@${a.released==null?'-':a.released.toFixed(2)} minVx=${a.minVx} (own goal is negative) ball ends rel ${a.rel} z-off-man ${a.z} leg ${a.angle}`;}}
  return rows;
 }
 function fhAll(){
  return {catch:fhCatchGrid(),stroke:fhStrokeGrid(),release:fhReleaseGrid(),
   kick:fhScene({ri:5,R:3.5,dz:7,mode:'kick'}),raise:fhScene({ri:5,R:3.5,dz:7,mode:'raise'})};
 }
 window.fhScene=fhScene;window.fhCatchGrid=fhCatchGrid;window.fhStrokeGrid=fhStrokeGrid;window.fhReleaseGrid=fhReleaseGrid;window.fhAll=fhAll;
})();
