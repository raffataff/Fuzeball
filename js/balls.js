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
    m.castShadow=true;scene.add(m);owned=true; // fallback sphere owns its geo/mat (GLB clones share the cache, never dispose those)
  }
  // prev/cur = the true sim position one fixed step ago / now (the renderer lerps m.position between them, physics writes 'cur')
  // cT = last-contact sim time per surface [floor/roof, wall, ball] for the audio gate (physics.js hitFresh); -1e9 = never touched (0 would swallow the first contact)
  const b={m,owned,v:new THREE.Vector3(),t,key,scored:false,didSplit:false,trailT:0,light:null,spin:0,stuckT:0,graceT:0,knuckT:0,overBar:0,noGoal:0,outWall:0,cT:[-1e9,-1e9,-1e9],
   cannonTimer:key==='cannon'?CONFIG.cannonball.timer:-1,
   warnShell:null,warnLight:null,
   prev:new THREE.Vector3(),cur:new THREE.Vector3(),
   // moments (js/moments.js): on-target projection, pending save verdict, last contact and last swing, woodwork/save latches; momReset clears them
   onT:null,savePend:null,tc:null,shot:null,wood:0,woodCd:0,saveCd:0,curl:0,
   // match stats (js/matchstats.js): its own last-contact / last-swing records, separate from tc/shot; msReset clears them
   msc:null,mss:null};
  // glow lights (fire/knuckle) borrow from the resident fx light pool (world.js): a new light would change the count and recompile; b.light is null if the pool is exhausted
  if(t.light){b.light=fxLightGet(t.light,34);if(b.light)b.light.intensity=1.1;}
  applyBallEnv(b);   // local cube-map reflection envMap (no-op when cfg.reflections is off), set at birth so the shader recompile isn't mid-rally
  if(key==='cannon'){
   // per-instance outline shell (own geo/mat) that pulses red as the fuse burns down, plus a point light
   const shellGeo=new THREE.SphereGeometry(BALL_R*CONFIG.cannonball.warnShellScale,20,14);
   const shellMat=new THREE.MeshBasicMaterial({color:CONFIG.cannonball.warnColor,transparent:true,
    opacity:0,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
   b.warnShell=new THREE.Mesh(shellGeo,shellMat);
   m.add(b.warnShell);
   b.warnLight=fxLightGet(CONFIG.cannonball.warnColor,22);   // pooled (see above); intensity driven by cannonballWarn, null-guarded there
  }
  S.balls.push(b);return b;
}
// call after any hard set of m.position outside physics (serve, redrop, split, NaN redrop): snaps the interp buffers so it doesn't streak
function syncBall(b){b.overBar=0;b.noGoal=0;b.over=0;b.cur.copy(b.m.position);b.prev.copy(b.m.position);if(b.light)b.light.position.copy(b.m.position);primeBallHist(b);momReset(b);msReset(b);}
// per-frame cannonball warning: inside the warn window the outline shell and a bleed light pulse red, snapping on each countdown beep; wall-clock S.time, own shell/light only
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
// ================= ball heat =================
// a ball glows red as it nears its type's maxV (knobs in CONFIG.fx.heat); render-side only, from main.js's interpolation pass
// balls of one GLB type share a material, so a type is written once a frame at its hottest ball; trails are per-sprite (b.hot, fx.js spawnTrail)
// feed every ball on screen between heatOpen() and heatClose() (live balls and replay ghosts)
const _heatCol=new THREE.Color();          // scratch, reused; never held between calls
const _heatFeed=[];let _heatN=0;const _heatPeak={};
function ballHeatColor(){return _heatCol.setHex(CONFIG.fx.heat.col);}
function heatOpen(){_heatN=0;for(const k in _heatPeak)_heatPeak[k]=0;}
// obj = the mesh on screen, key = ball type, sp = speed, owner = whatever carries .hot for the trail (the ball, or a replay ghost's shim); pooled, no alloc
function heatFeed(obj,key,sp,owner){
 const H=CONFIG.fx.heat,mv=BALL_TYPES[key]?BALL_TYPES[key].maxV:0;
 const k=(H&&H.on&&mv>0)?clamp((sp/mv-H.from)/Math.max(1e-4,H.full-H.from),0,1):0;
 if(owner)owner.hot=k;
 const s=_heatFeed[_heatN]||(_heatFeed[_heatN]={});
 s.obj=obj;s.key=key;_heatN++;
 _heatPeak[key]=Math.max(k,_heatPeak[key]||0);   // Math.max, not a >, so the key always exists (heatClose would hand ballHeatSet an undefined)
}
function heatClose(){for(let i=0;i<_heatN;i++)ballHeatSet(_heatFeed[i].obj,_heatPeak[_heatFeed[i].key]);}
// drop the stash when a material is re-authored under the heat system (replay's fallback spheres are recoloured per type)
function ballHeatForget(obj){
 obj.traverse(o=>{if(!o.isMesh)return;
  const ms=Array.isArray(o.material)?o.material:[o.material];
  for(const m of ms){if(!m)continue;delete m.userData.heatEm;m.userData.heatOn=false;}});
}
// write heat k (0..1) onto every lit material under obj; the authored emissive/colour are stashed on first heat and restored at k=0; uniforms only, no recompile
function ballHeatSet(obj,k){
 const H=CONFIG.fx.heat;
 const hot=ballHeatColor();
 const pulse=1+H.pulseAmt*k*Math.sin(S.time*H.pulse*6.2832);
 obj.traverse(o=>{
  if(!o.isMesh)return;
  const ms=Array.isArray(o.material)?o.material:[o.material];
  for(const m of ms){
   if(!m||!m.emissive)continue;   // no emissive = not a lit material: skips the cannonball's additive warn shell
   const u=m.userData;
   if(u.heatEm===undefined){u.heatEm=m.emissive.getHex();u.heatEmI=m.emissiveIntensity;u.heatCol=m.color.getHex();}
   if(k<=0){
    if(!u.heatOn)continue;        // already cold — don't rewrite a settled material every frame
    m.emissive.setHex(u.heatEm);m.emissiveIntensity=u.heatEmI;m.color.setHex(u.heatCol);u.heatOn=false;
    continue;
   }
   m.emissive.setHex(u.heatEm).lerp(hot,k);
   m.emissiveIntensity=u.heatEmI+H.glow*k*pulse;
   m.color.setHex(u.heatCol).lerp(hot,H.tint*k);
   u.heatOn=true;
  }
 });
}
function removeBall(b){ballHeatSet(b.m,0);   // hand the shared material back cold, or the next ball of this type (and the goal replay) opens red
 scene.remove(b.m);if(b.light)fxLightPut(b.light);   // release the pooled glow (NOT scene.remove — that would change the light count)
 if(b.warnLight)fxLightPut(b.warnLight);
 if(b.warnShell){b.warnShell.geometry.dispose();b.warnShell.material.dispose();}
 // only the generated-sphere fallback owns its geo/mat; GLB-clone balls share the cached template
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
 // a kickoff drops centre; a restart after the ball left play (out of bounds, a cannonball) comes back in the third it ended in via the dead-ball zone table, or clearing from your corner would be the dead-ball exploit
 // S.serveAt is set by outOfBounds/cannonballUpdate and consumed here
 const sz=(typeof S.serveAt==='number')?redropZone(S.serveAt):null;S.serveAt=null;
 const SR=RNG.serve;   // seeded (js/rng.js): the drop is the FIRST thing a trial has to reproduce
 b.m.position.set(sz?sz.x+rngR(SR,-sz.spread,sz.spread):rngR(SR,-SRV.spread,SRV.spread),SRV.dropY,rngR(SR,-SRV.zSpread,SRV.zSpread));
  b.v.set(rngR(SR,-SRV.vel,SRV.vel),0,rngR(SR,-SRV.vel,SRV.vel));
  b.spin=rngR(SR,-SRV.spin,SRV.spin);
  Au.drop(b);   // the ball fed in and rattling onto the pitch (recorded only)
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
 // tier 2: the ball drops in front of you (the old subtitle under a centre banner blocked the table)
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
     // restart in the third it blew up in, like an out-of-play (S.serveAt > serve()); else sitting on a cannonball is the dead-ball exploit with a timer
     else{S.serveAt=bp.x;resetRodRotation();notice('BALL DESTROYED',1.2,'#ff8c3a');S.phase='goal';S.goalT=MATCH.outHold;}
    }
    break;
   }
  }
 }
