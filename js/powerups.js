'use strict';
/* ================= power-ups ================= */
// tear a power-up out of the scene and free what spawnPU built; only the procedural parts (gem + halo ring, stamped puOwn) are freed, a GLB pickup shares geometry and materials with its template
function disposePU(){const o=S.pu.obj;if(!o)return;scene.remove(o);
 o.traverse(c=>{if(!c.isMesh||!c.userData.puOwn)return;
  c.geometry.dispose();if(c.material.map)c.material.map.dispose();c.material.dispose();});
 S.pu.obj=null;S.pu.spin=0;}
function clearPU(){disposePU();S.pu.timer=rngR(RNG.pu,PWR.firstDelay[0],PWR.firstDelay[1]);}
// the visual for one pickup: the type's GLB if loaded, else the procedural octahedron; parented to a spinning group so the model's own yaw (md.yaw) survives
function makePUVisual(t){
 const M=PWR.models,md=(M&&M.on)?M[t.key]:null;
 const g=new THREE.Group();
 const mdl=(md&&typeof makePUModel==='function')?makePUModel(t.key):null;
 if(mdl){
  mdl.rotation.set(md.tilt||0,md.yaw||0,0);
  if(md.scale&&md.scale!==1)mdl.scale.multiplyScalar(md.scale);   // fit-scale is already baked into the template
  mdl.position.y=md.y||0;
  g.add(mdl);
 }else{
  const G=PWR.gem,gem=new THREE.Mesh(new THREE.OctahedronGeometry(G.r),
   new THREE.MeshStandardMaterial({color:t.col,emissive:t.col,emissiveIntensity:G.emissive,roughness:G.roughness}));
  gem.userData.puOwn=true;g.add(gem);
 }
 const R=PWR.ring;
 if(R.on&&!(md&&md.ring===false)){
  const ring=new THREE.Mesh(new THREE.RingGeometry(R.inner,R.outer,24),
   new THREE.MeshBasicMaterial({color:t.col,transparent:true,opacity:R.opacity,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=R.y;ring.userData.puOwn=true;g.add(ring);
 }
 S.pu.spin=(md&&md.spin)||PWR.spin;
 return g;
}
function spawnPU(){
 const PR=RNG.pu;   // seeded (js/rng.js) - WHERE a pickup lands decides who reaches it first
 const t=rngPick(PR,PU_TYPES);
 const g=makePUVisual(t);
 g.position.set(rngR(PR,-PWR.area.x,PWR.area.x),PWR.floatY,rngR(PR,-PWR.area.z,PWR.area.z));
 if(ARENA_ON)arenaClampSpawn(g.position);
 S.pu.type=t;S.pu.obj=g;scene.add(g);
}
function collectPU(){
 const t=S.pu.type;
 const team=S.lastTouch>=0?S.lastTouch:(RNG.pu()<.5?0:1);
  const nm=teamName(team);
 if(t.key==='boost')S.eff[team].boost=S.time+PWR.boost;
 if(t.key==='freeze')S.eff[1-team].frozen=S.time+PWR.freeze;
 if(t.key==='big')S.eff[team].big=S.time+PWR.big;
 // no banner: the rail tab sliding out of the score is the notification (hud.js hudTabs); freeze's tab is on the rival's side, so the collector gets this notice
 notice(nm+' · '+t.label,1.2,team===0?'var(--c0)':'var(--c1)');
 Au.power();
 burst(S.pu.obj.position,new THREE.Color(t.col),new THREE.Color(0xffffff),60,40);
 disposePU();S.pu.timer=rngR(RNG.pu,PWR.respawn[0],PWR.respawn[1]);
}
function powerupUpdate(dt){
 if(S.trn)return;                        // training sandbox: no random power-ups mid-test
 if(!cfg.power)return;
 if(!S.pu.obj){S.pu.timer-=dt;if(S.pu.timer<=0)spawnPU();return;}
 const o=S.pu.obj;
 o.rotation.y+=dt*(S.pu.spin||PWR.spin);o.position.y=PWR.floatY+Math.sin(S.time*3)*PWR.floatAmp;
 for(const b of S.balls){
  if(b.m.position.distanceTo(o.position)<BALL_R+PWR.pickR){collectPU();break;}
 }
}
// which re-drop zone serves world-x `x` (CONFIG.deadball.redrop), so a re-drop lands in the third the ball died in; shared with serve(); random if the feature is off or nothing covers x
function redropZone(x){
 const R=DEAD.redrop,zs=R.zones;
 if(R.sameThird&&typeof x==='number'&&isFinite(x))for(const z of zs)if(z.from&&x>=z.from[0]&&x<=z.from[1])return z;
 return rngPick(RNG.drop,zs);
}
// atX = the x the ball died at (default its live position b.cur; pass it when already out of play); only the zone comes from it, the drop is still jittered
function redropBall(b,atX){
 // a trial puts the ball back on its own spawn, not a face-off spot; read as data off S.trial so a missing trials.js leaves this false (S.trial.spawn is the live attempt's spot in a 'saveRun')
 const TB=(S.trial&&S.trial.spawn)||(S.trial&&S.trial.def&&S.trial.def.ball);
 if(TB&&typeof TB.x==='number'&&typeof TB.z==='number'){
  b.m.position.set(TB.x,BALL_R,TB.z);
  b.v.set(0,0,0);b.spin=0;b.stuckT=0;b.graceT=0;b.bbMin=b.bbMax=null;
  if(ARENA_ON)arenaClampSpawn(b.m.position);
  syncBall(b);replayCut();
  return;
 }
 const z=redropZone(atX!==undefined?atX:(b.cur||b.m.position).x);
 // target = where the ball should land, not where it's released (a falling ball carries its launch vx/vz): back-solve the spawn from the fall time
 const DR=RNG.drop;   // seeded (js/rng.js) on its own stream: a re-drop is a restart a trial must reproduce
 const tx=z.x+rngR(DR,-z.spread,z.spread),tz=rngR(DR,-DEAD.redrop.z,DEAD.redrop.z);
 const vx=rngR(DR,-DEAD.redrop.vel,DEAD.redrop.vel),vz=rngR(DR,-DEAD.redrop.vel,DEAD.redrop.vel);
 const fallT=Math.sqrt(2*Math.max(DEAD.redrop.y-BALL_R,0)/GRAV);
 b.m.position.set(tx-vx*fallT,DEAD.redrop.y,tz-vz*fallT);
 b.v.set(vx,0,vz);b.spin=0;b.stuckT=0;b.graceT=0;b.bbMin=b.bbMax=null; // clear the stall tracker + its grace budget
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
 replayCut();   // the teleport would streak across a replay — drop the stale footage
}
// the pitch lanes between the rows that no rod can swing at (CONFIG.deadball.rodGaps.lanes); table-independent
function rodGaps(){const G=DEAD.rodGaps;return G&&G.on?G.lanes:[];}
// how fast the dead-ball stuck-timer ticks at position p: >1 where no rod can reach a pinned ball, 1 elsewhere
// cases: the goal roof, the table's deadzones (|x|>xMin and |z|>zMin covers all four corners; per-zone `mult` overrides DEAD.zoneMult), the between-row lanes
function deadzoneMult(p){
 const ax=Math.abs(p.x),az=Math.abs(p.z);
 // goal roof: goalFrameCollide keeps a solid top over the goal box, so nothing can reach a ball on it; mirrors that collider (incl. the big-goal widen)
 if(DEAD.roofMult>1&&p.y>F.goalH&&ax>F.L/2&&ax<F.L/2+F.goalDepth&&
    az<F.goalHalf*(S.eff[p.x>0?0:1].big>S.time?PHY.bigGoalMult:1))return DEAD.roofMult;
 const zs=activeTable&&activeTable.deadzones;
 if(zs)for(const z of zs)if(ax>z.xMin&&az>z.zMin)return z.mult||DEAD.zoneMult;  // pockets outrank lanes
 const gp=rodGaps();
 for(let i=0;i<gp.length;i++)if(p.x>gp[i].x0&&p.x<gp[i].x1)return gp[i].mult||DEAD.rodGaps.mult;
 return 1;
}
// the reverse of deadzoneMult: is the ball somewhere a man could swing at it? inside a live foot's strike window (live.ahead / live.back) and lined up in z; hidden rods and knocked-out men are skipped
function liveZone(p){
 const L=DEAD.live;
 if(p.y>ROD_H)return false;                 // above the rod axis — nobody is swinging at that
 const zR=FOOT_BOX.z+BALL_R+L.zPad;
 for(const r of rods){
  if(r.trnHidden)continue;                  // training/trial: a hidden rod is a ghost, it reaches nothing
  const rel=(p.x-r.x)*r.kickDir;            // + = in front of this rod, - = behind it
  if(rel>L.ahead||rel<-L.back)continue;
  for(let i=0;i<r.baseZ.length;i++){
   if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;   // man blown off by a cannonball
   if(Math.abs(p.z-(r.baseZ[i]+r.offset))<=zR)return true;
  }
 }
 return false;
}
// real seconds until this ball's whistle if it stays put: the deadzone speed-up, or the live-zone discount until graceMax is spent (mirrors deadBallUpdate); Infinity when the clock is off
function deadLeft(b){
 if(S.trn&&!S.trn.deadball)return Infinity;
 const L=DEAD.live,p=b.cur,need=(S.balls.length>1?DEAD.wedgeT:DEAD.stallT)-(b.stuckT||0);
 if(need<=0)return 0;
 const zm=deadzoneMult(p);
 if(zm===1&&L&&L.on&&L.mult<1&&(b.graceT||0)<L.graceMax&&liveZone(p)){
  const slowT=(L.graceMax-(b.graceT||0))/(1-L.mult),gain=slowT*L.mult;   // real seconds the grace budget still buys, and the clock it adds meanwhile
  return need<=gain?need/L.mult:slowT+need-gain;
 }
 return need/Math.max(zm,1e-6);
}
function deadBallUpdate(dt){
 if(S.trn&&!S.trn.deadball)return;       // training sandbox: a placed ball must sit still forever unless opted in
 if(S.phase!=='play'||!S.balls.length)return;
 // dead = true position (b.cur) stays inside a small box long enough, not low speed (a held or spun ball keeps its speed); the box only resets when the ball roams past moveEps
 const eps=DEAD.moveEps,L=DEAD.live;
 let allStuck=true;
 for(const b of S.balls){
  const p=b.cur;
  if(!b.bbMin){b.bbMin=p.clone();b.bbMax=p.clone();b.stuckT=0;b.graceT=0;}
  else{
   b.bbMin.min(p);b.bbMax.max(p);
   if(Math.max(b.bbMax.x-b.bbMin.x,b.bbMax.z-b.bbMin.z)>eps){b.bbMin.copy(p);b.bbMax.copy(p);b.stuckT=0;b.graceT=0;}
   else{
    let mult=deadzoneMult(p);   // faster in an unreachable deadzone: shorter re-drop wait
    // ...and slower the other way while a man can still reach it; only where deadzoneMult said 1, and only until the ball has spent its graceMax budget
    if(mult===1&&L&&L.on&&b.graceT<L.graceMax&&liveZone(p)){
     b.graceT+=dt*(1-L.mult);   // bank the REAL seconds being gifted, not the ticked ones
     mult=L.mult;
    }
    b.stuckT+=dt*mult;
   }
  }
  if(b.stuckT<=DEAD.stallT)allStuck=false;
 }
 if(allStuck){ // every live ball wedged (also the single-ball case) -> whistle + re-drop all
  Au.whistle();resetRodRotation();notice('DEAD BALL',1.1);
  for(const b of S.balls)redropBall(b);
  return;
 }
 // multi-ball: one ball pinned while others play -> re-drop just that one.
 if(S.balls.length>1)for(const b of S.balls)if(b.stuckT>DEAD.wedgeT)redropBall(b);
}
