'use strict';
/* ================= balls ================= */
function makeBall(key){
  const t=BALL_TYPES[key];
  let m,owned=false;
  const useModel=CONFIG.debug?.useBallModel;
  if(useModel){
    const glb=makeBallModel(key);
    if(glb){
      m=glb;
      m.scale.setScalar(1);
      scene.add(m);
    }
  }
  if(!m){
    m=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,24,16),
     new THREE.MeshStandardMaterial({color:t.col,emissive:t.em,emissiveIntensity:t.em?0.7:0,
      roughness:t.metal?.25:.4,metalness:t.metal||.05}));
    m.castShadow=true;scene.add(m);owned=true; // fallback sphere owns its geo/mat (GLB clones share the cache — never dispose those)
  }
  // prev/cur = the true sim position one fixed-step ago / now. The renderer draws
  // m.position lerped between them (see loop); physics only ever writes 'cur'.
  // cT = last-contact sim time per surface [floor/roof, wall, ball] for the audio impact gate
  // (physics.js hitFresh). A one-shot only fires on a surface that was clear for PHY.contactHold;
  // sustained contact becomes a roll instead. -1e9 = "never touched" — NOT 0, which would read as
  // "touched at kick-off" and swallow the first contact of the session (S.time also starts at 0).
  const b={m,owned,v:new THREE.Vector3(),t,key,scored:false,didSplit:false,trailT:0,light:null,spin:0,stuckT:0,graceT:0,knuckT:0,overBar:0,outWall:0,cT:[-1e9,-1e9,-1e9],
   cannonTimer:key==='cannon'?CONFIG.cannonball.timer:-1,
   warnShell:null,warnLight:null,
   prev:new THREE.Vector3(),cur:new THREE.Vector3(),
   // moments (js/moments.js): live on-target projection, a pending save verdict, the last
   // contact + last SWING records, and the woodwork/save latches. momReset clears the lot.
   onT:null,savePend:null,tc:null,shot:null,wood:0,woodCd:0,saveCd:0,curl:0,
   // match stats (js/matchstats.js): its OWN last-contact / last-SWING records, kept separate from
   // tc/shot above so the ledger doesn't inherit moments' momOn() gate. msReset clears them.
   msc:null,mss:null};
  // Glow lights (fire/knuckle) BORROW from the resident fx light pool (world.js) rather than
  // scene.add-ing a fresh light — a new light would change the scene's light count and force a
  // whole-scene shader recompile (the hitch on "a different ball type is served"). b.light may be
  // null if the pool is exhausted; every reader is already null-guarded. Constant 1.1 intensity.
  if(t.light){b.light=fxLightGet(t.light,34);if(b.light)b.light.intensity=1.1;}
  applyBallEnv(b);   // local cube-map reflection envMap (no-op when cfg.reflections off) — set at birth so the null→tex shader recompile is here, not mid-rally
  if(key==='cannon'){
   // per-instance outline shell (own geo/mat — never shared with other ball
   // instances, unlike the GLB clone's base material) that pulses red as the
   // fuse burns down, plus a matching point light for a bit of scene bleed.
   const shellGeo=new THREE.SphereGeometry(BALL_R*CONFIG.cannonball.warnShellScale,20,14);
   const shellMat=new THREE.MeshBasicMaterial({color:CONFIG.cannonball.warnColor,transparent:true,
    opacity:0,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
   b.warnShell=new THREE.Mesh(shellGeo,shellMat);
   m.add(b.warnShell);
   b.warnLight=fxLightGet(CONFIG.cannonball.warnColor,22);   // pooled (see above); intensity driven by cannonballWarn, null-guarded there
  }
  S.balls.push(b);return b;
}
// call after ANY hard set of m.position outside physics (serve, redrop, split, NaN redrop):
// snaps the interp buffers to the mesh so the ball appears at the new spot without streaking there.
function syncBall(b){b.overBar=0;b.cur.copy(b.m.position);b.prev.copy(b.m.position);if(b.light)b.light.position.copy(b.m.position);primeBallHist(b);momReset(b);msReset(b);}
// Per-frame visual warning for a live cannonball: while the detonation timer is
// inside the warn window, pulse the ball's outline shell + a bleed light red,
// snapping to a sharp flash right on each countdown beep and decaying until the
// next one. Driven from the render loop (uses wall-clock S.time, not the fixed
// sim step, so the pulse is smooth regardless of frame rate). Only touches the
// ball's own per-instance shell/light — never the shared base ball material —
// so nothing lingers once the ball is gone.
function cannonballWarn(b){
  if(!b.warnShell)return;                      // non-cannon balls carry no shell at all
  if(b.cannonTimer<0||b.cannonTimer>CONFIG.cannonball.warn){
    b.warnShell.material.opacity=0;
    if(b.warnLight)b.warnLight.intensity=0;
    return;
  }
  const CB=CONFIG.cannonball;
  const k=clamp(1-b.cannonTimer/CB.warn,0,1);              // 0 at warn start → 1 at detonation
  const since=S.time-(b._warnBeepAt??S.time);              // seconds since the last countdown beep
  const flash=Math.exp(-since*(CB.warnFlashDecay+3*k));    // sharp pulse on the beep, decaying till the next
  const ambient=0.1+0.15*k;                                // faint base glow that ramps as detonation nears
  b.warnShell.material.opacity=clamp(ambient+flash*(0.6+0.4*k),0,1);
  b.warnShell.scale.setScalar(1+0.06*flash);               // subtle swell timed to each beep
   if(b.warnLight){
    b.warnLight.position.copy(b.m.position);
    b.warnLight.intensity=(0.3+CB.warnLightMax*k)*flash+0.2*k;
   }
}
function removeBall(b){scene.remove(b.m);if(b.light)fxLightPut(b.light);   // release the pooled glow (NOT scene.remove — that would change the light count)
 if(b.warnLight)fxLightPut(b.warnLight);
 if(b.warnShell){b.warnShell.geometry.dispose();b.warnShell.material.dispose();}
 // only the generated-sphere fallback owns its geo/mat; GLB-clone balls share the cached
 // template resources, so disposing them would break every future ball of that type.
 if(b.owned)b.m.traverse(c=>{if(c.isMesh){c.geometry.dispose();if(c.material.map)c.material.map.dispose();c.material.dispose();}});
 const i=S.balls.indexOf(b);if(i>=0)S.balls.splice(i,1);}
function clearBalls(){while(S.balls.length)removeBall(S.balls[0]);}
function pickType(){
 if(!cfg.special)return 'classic';
 let tot=0;for(const k in BALL_TYPES)tot+=BALL_TYPES[k].w;
 let r=RNG.type()*tot;
 for(const k in BALL_TYPES){r-=BALL_TYPES[k].w;if(r<=0)return k;}
 return 'classic';
}
function serve(){
 resetRodRotation();
 replayCut();   // fresh rally = fresh footage (a replay must never show the drop-in teleport)
 const key=pickType();
 const b=makeBall(key);
 // A KICKOFF (match start, after a goal) drops centre, as it always has. A RESTART after the ball
 // left play — out of bounds, or a cannonball detonating — instead comes back in the third it ended
 // in, via the same zone table the dead-ball re-drop uses. Without it, clearing the ball off the
 // table from your own corner is the dead-ball exploit by another route, and the better one: no
 // whistle to wait out. S.serveAt is set by outOfBounds/cannonballUpdate and CONSUMED here, so a
 // restart can't leak into the next kickoff.
 const sz=(typeof S.serveAt==='number')?redropZone(S.serveAt):null;S.serveAt=null;
 const SR=RNG.serve;   // seeded (js/rng.js): the drop is the FIRST thing a trial has to reproduce
 b.m.position.set(sz?sz.x+rngR(SR,-sz.spread,sz.spread):rngR(SR,-SRV.spread,SRV.spread),SRV.dropY,rngR(SR,-SRV.zSpread,SRV.zSpread));
  b.v.set(rngR(SR,-SRV.vel,SRV.vel),0,rngR(SR,-SRV.vel,SRV.vel));
  b.spin=rngR(SR,-SRV.spin,SRV.spin);
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
 // tier 2: the ball drops in front of you — the old 'SPECIAL BALL DROPPING' subtitle under a
 // 66px centre banner narrated something already on screen, and blocked the table while doing it.
  if(key!=='classic')notice(BALL_TYPES[key].name,1.5,BALL_TYPES[key].trail);
  S.phase='play';S.lastTouch=-1;
 msRallyReset();   // matchstats.js: a serve starts a new rally (the longest-rally clock)
}

function cannonballUpdate(dt){
  for(const b of S.balls){
   if(b.cannonTimer<0)continue;
   b.cannonTimer-=dt;
   if(b.cannonTimer<=CONFIG.cannonball.warn&&b.cannonTimer>0){
    const sec=Math.ceil(b.cannonTimer);          // 3, then 2, then 1
    if(b._warnSec!==sec){b._warnSec=sec;b._warnBeepAt=S.time;Au.warnBeep(1-sec/CONFIG.cannonball.warn);}
   }
   if(b.cannonTimer<=0){
      const bp=b.m.position.clone();   // capture the detonation spot BEFORE removeBall frees the mesh
      removeBall(b);
    cannonExplodeFx(bp);             // 3D shard debris + particle blast + light + boom (replaces the old Au.power beep)
    let nearestRod=-1,nearestMan=-1,nearestDist=Infinity;
    for(let ri=0;ri<rods.length;ri++){
     const r=rods[ri];
     if(r.trnHidden)continue;             // training sandbox: don't blast a man off a hidden rod
     const sa=Math.sin(r.angle),ca=Math.cos(r.angle);
     const ax=r.x,ay=ROD_H;
     const fx=ax+sa*ARM,fy=ay-ca*ARM;
     for(let mi=0;mi<r.baseZ.length;mi++){
      if(r.removedUntil[mi]&&r.removedUntil[mi]>S.time)continue;
      const fz=r.baseZ[mi]+r.offset;
      const dx=bp.x-fx,dy=bp.y-fy,dz=bp.z-fz;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(dist<nearestDist){nearestDist=dist;nearestRod=ri;nearestMan=mi;}
     }
    }
    if(nearestRod>=0){
     const r=rods[nearestRod];
     r.removedUntil[nearestMan]=S.time+CONFIG.cannonball.removeDuration;
     spawnFracture(r,nearestMan);
     notice('PLAYER DOWN',1.4,'#ff8c3a');
    }
    if(!S.balls.length&&S.phase==='play'){
     if(S.trn){trainingBallGone();}      // training sandbox: respawn at the last spot, never enter the goal-hold
     // Restart in the third it blew up in, same rule as an out-of-play (S.serveAt → serve()). Sitting
     // on a cannonball in your own corner until the fuse runs out would otherwise be the dead-ball
     // exploit with a timer attached: hold it, lose nothing, get a centre drop.
     else{S.serveAt=bp.x;resetRodRotation();notice('BALL DESTROYED',1.2,'#ff8c3a');S.phase='goal';S.goalT=MATCH.outHold;}
    }
    break;
   }
  }
 }
