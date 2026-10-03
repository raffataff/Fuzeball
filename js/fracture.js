'use strict';
// ================= fracture fx (cannonball kill) =================
// swaps a destroyed figurine for a pre-baked explode GLB (models.js explosionTemplates, warmed ahead): a clone() + mixer.play(); no explosionSrc = it just vanishes
// rods.js owns r.men[mi].visible; this file only manages the fracture meshes on top

// deep-clone a template: shares geometry and textures, clones materials so this instance fades independently
function cloneFractureInstance(tpl){
  const g=tpl.scene.clone(true);
  g.traverse(c=>{
   if(!c.isMesh)return;
   c.castShadow=true;
   c.material=Array.isArray(c.material)?c.material.map(m=>m.clone()):c.material.clone();
  });
  return g;
}

// warm one template off-screen in its transparent fade state (used by warmFractureShaders and ensureExplosionModel); no-op until the renderer exists
function warmFractureTemplate(tpl){
  if(!tpl||!renderer||!scene||!camera)return;
  const inst=cloneFractureInstance(tpl);
  inst.traverse(c=>{
   if(!c.isMesh)return;
   const mats=Array.isArray(c.material)?c.material:[c.material];
   mats.forEach(m=>{m.transparent=true;m.opacity=1;});
  });
  inst.position.set(0,-500,0);
  scene.add(inst);
  renderer.compile(scene,camera);
  scene.remove(inst);
}
// boot: warm every shatter template already resident (ball + swirl + any figurine explosions primed so far)
function warmFractureShaders(){
  for(const id in explosionTemplates)warmFractureTemplate(explosionTemplates[id]);
  warmFractureTemplate(ballExplosionTemplate); // the cannonball's own shatter shares the pre-warm
  warmFractureTemplate(respawnSwirlTemplate);  // the respawn swirl shares the pre-warm so its first play never stalls
}

// trigger the effect for rod r's man mi; call from balls.js cannonballUpdate right after r.removedUntil[mi] is set
function spawnFracture(r,mi){
  const tpl=explosionTemplates[activeModel(r.team).id];
  const manObj=r.men[mi];
  if(!tpl){manObj.visible=false;return;}      // no explosion GLB for this figurine yet: vanish
  // position is the man's neutral (unswung) world pose: the GLB is baked from it and falls straight down; no sin/cos(r.angle) term or a raised rod threw debris up and back
  const wp=new THREE.Vector3(r.x,ROD_H+PLAYER_H,r.offset+r.baseZ[mi]);
  const s=activeModel(r.team).scale*tmScale(r.team);
  const ws=new THREE.Vector3(s,s,s);
  // rotation is only the static team-facing yaw (buildRods/rebuildRodMen), not the swing, or the debris falls sideways
  const wq=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),r.team===1?Math.PI:0);
  manObj.visible=false;
  const inst=cloneFractureInstance(tpl);
  inst.position.copy(wp);inst.quaternion.copy(wq);inst.scale.copy(ws);
  scene.add(inst);
  // tint the kit parts the intact figure tints (teamParts); only Blender's numeric re-import suffix (.001) is stripped (kit_grimlot.skin is a different material)
  const teamParts=new Set((activeModel(r.team).teamParts||[]).map(s=>s.toLowerCase()));
  const col=kitLin(r.team===0?cfg.redColor:cfg.blueColor);
  const mats=[];
  inst.traverse(c=>{
   if(!c.isMesh)return;
   c.material.transparent=true;c.material.opacity=1;
   const name=(c.material.name||'').toLowerCase().replace(/\.\d+$/,'');
   if(teamParts.has(name))c.material.color.set(col);
   mats.push(c.material);
  });
  const mixer=new THREE.AnimationMixer(inst);
  // a per-shard rigid-body bake writes one clip per shard: play all of them
  for(const clip of tpl.clips){
   const action=mixer.clipAction(clip);
   action.setLoop(THREE.LoopOnce);action.clampWhenFinished=true;action.play();
  }
  S.frac.push({obj:inst,mixer,mats,until:r.removedUntil[mi]});
}

// the cannonball's own shatter at `pos`: not team-tinted, self-contained lifetime (until = now + fractureLife), same S.frac list and fade as player debris, plus a short orange point light
// call from balls.js cannonballUpdate (via cannonExplodeFx) before removeBall; no-op if the GLB never loaded
function spawnBallFracture(pos){
  const tpl=ballExplosionTemplate;
  if(!tpl)return;
  const inst=cloneFractureInstance(tpl);
  const s=CONFIG.cannonball.fractureScale||1;
  inst.position.copy(pos);inst.scale.set(s,s,s);
  scene.add(inst);
  const mats=[];
  inst.traverse(c=>{if(!c.isMesh)return;c.material.transparent=true;c.material.opacity=1;mats.push(c.material);});
  const mixer=new THREE.AnimationMixer(inst);
  // one clip PER shard (see spawnFracture) — play them all or only shard 0 moves.
  for(const clip of tpl.clips){const a=mixer.clipAction(clip);a.setLoop(THREE.LoopOnce);a.clampWhenFinished=true;a.play();}
  const light=fxLightGet(0xff7a1a,64);if(light){light.intensity=4;light.position.copy(pos);light.position.y+=2;} // pooled — no light added, so no whole-scene recompile at the bang
  S.frac.push({obj:inst,mixer,mats,light,until:S.time+CONFIG.cannonball.fractureLife});
}

// per-frame, real dt: advance mixers, fade debris over the last CONFIG.cannonball.fractureFadeOut seconds, dispose
// player debris `until` = the respawn time (rods.js re-shows the figurine itself); ball debris = now + fractureLife, with a decaying light
function fractureUpdate(dt){
  for(let i=S.frac.length-1;i>=0;i--){
   const f=S.frac[i];
   f.mixer.update(dt);
   const left=f.until-S.time;
   if(f.light)f.light.intensity=Math.max(0,f.light.intensity-dt*6); // punchy flash that dies fast
   if(left<=CONFIG.cannonball.fractureFadeOut){
    const k=clamp(left/CONFIG.cannonball.fractureFadeOut,0,1);
    for(const m of f.mats)m.opacity=k;
   }
   if(left<=0)disposeFracture(i);
  }
}

function disposeFracture(i){
  const f=S.frac[i];
  scene.remove(f.obj);
  if(f.light)fxLightPut(f.light);    // ball debris only; return the pooled light (never scene.remove, that changes the count)
  for(const m of f.mats)m.dispose(); // geometry/textures are shared with the template — never dispose those
  S.frac.splice(i,1);
}

// ================= respawn swirl (cannonball-kill recovery) =================
// particles rise to the rod in the last CONFIG.cannonball.respawnLead seconds before a removed player reforms, telegraphing the comeback
// one shared GLB (CONFIG.cannonball.respawnSwirlSrc); like the fracture path but driven off r.removedUntil[mi]: respawnSwirlUpdate spawns it within respawnLead; clips loop; it tracks the rod's z-slide
// it outlives reform by `tail` (swirlTail()) and its opacity ramp is anchored to the tail's end, so it cross-dissolves with the figurine's fade-in

// spawn the swirl for rod r's man mi; `reform` = r.removedUntil[mi]; lives until reform+swirlTail(); no-op if the GLB never loaded
function spawnRespawnSwirl(r,mi,reform){
  const tpl=respawnSwirlTemplate;if(!tpl)return;
  const C=CONFIG.cannonball;
  const inst=cloneFractureInstance(tpl);
  const s=C.respawnSwirlScale||1, z=r.offset+r.baseZ[mi];
  // seated on the floor (respawnSwirlY) under the man's current slide position, upright; z is re-tracked per frame
  inst.position.set(r.x,C.respawnSwirlY||0,z);inst.scale.set(s,s,s);
  scene.add(inst);
  // team tint: materials are cloned per instance; every mesh takes the kit colour unless respawnSwirlTintParts narrows it
  const col=kitLin(r.team===0?cfg.redColor:cfg.blueColor);
  const tint=C.respawnSwirlTint!==false, em=C.respawnSwirlEmissive!=null?C.respawnSwirlEmissive:1;
  const only=C.respawnSwirlTintParts&&C.respawnSwirlTintParts.length?
   new Set(C.respawnSwirlTintParts.map(s=>s.toLowerCase())):null;
  const mats=[];
  inst.traverse(c=>{if(!c.isMesh)return;
   const ms=Array.isArray(c.material)?c.material:[c.material];
   for(const m of ms){
    m.transparent=true;m.opacity=1;
    // '.001' suffixes come from glTF de-duping a material across shards: strip them so a name list matches
    if(tint&&(!only||only.has(String(m.name||'').toLowerCase().replace(/\.\d+$/,'')))){
     if(m.color)m.color.copy(col);
     if(m.emissive)m.emissive.copy(col).multiplyScalar(em);
    }
    mats.push(m);
   }});
  const mixer=new THREE.AnimationMixer(inst);
  // loop every clip so a short bake fills the window; with respawnSwirlFit one timeScale off the longest clip matches the window to the bake
  const win=swirlLead()+swirlTail();
  let dur=0;for(const c of tpl.clips)if(c.duration>dur)dur=c.duration;
  const ts=(C.respawnSwirlFit&&dur>0&&win>0)?dur/win:1;
  mixer.timeScale=ts;
  for(const clip of tpl.clips){const a=mixer.clipAction(clip);a.setLoop(THREE.LoopRepeat);a.play();}
  let light=null;
  if((C.respawnSwirlLight||0)>0){                       // optional soft team-tinted glow riding the column (pooled, intensity driven per frame below)
   light=fxLightGet(col.getHex(),48);if(light)light.position.set(r.x,(C.respawnSwirlY||0)+5,z);
  }
  // `until` = when the swirl dies (tail past reform)
  S.swirl.push({obj:inst,mixer,mats,light,rod:r,mi,until:reform+swirlTail()});
}

// seconds the swirl outlives the reform (defaults to the figurine fade-in length)
function swirlTail(){
  const C=CONFIG.cannonball;
  return C.respawnSwirlTail!=null?C.respawnSwirlTail:(C.respawnFade||0);
}

// how early the swirl starts: respawnLead>0 forces a window, 0/absent = auto, the longest baked clip
function swirlLead(){
  const C=CONFIG.cannonball;
  if(C.respawnLead>0)return C.respawnLead;
  const cl=respawnSwirlTemplate&&respawnSwirlTemplate.clips;
  let d=0;if(cl)for(const c of cl)if(c.duration>d)d=c.duration;
  return Math.max(0,d-swirlTail())||d||3;   // clip length spans lead+tail; fall back to 3s if the GLB has no clips
}

// per-frame, real dt: (1) spawn for any removed man within swirlLead() that has none, (2) advance, track and fade the live ones, dispose swirlTail() after reform
function respawnSwirlUpdate(dt){
  const C=CONFIG.cannonball;
  if(respawnSwirlTemplate){
   const lead=swirlLead();
   for(const r of rods){
    if(!r.removedUntil)continue;
    for(let mi=0;mi<r.baseZ.length;mi++){
     const ru=r.removedUntil[mi];
     // no `ru<=S.time` skip: the swirl outlives the reform; the tail check retires it
     if(!ru||ru-S.time>lead||S.time-ru>=swirlTail())continue; // not removed / too early / tail already over
     if(S.swirl.some(f=>f.rod===r&&f.mi===mi))continue;       // one per man per removal window
     spawnRespawnSwirl(r,mi,ru);
    }
   }
  }
    const fade=C.respawnSwirlFadeOut||.001, lit=C.respawnSwirlLight||0;
    for(let i=S.swirl.length-1;i>=0;i--){
     const f=S.swirl[i];
     f.mixer.update(dt);
     const z=f.rod.offset+f.rod.baseZ[f.mi];                 // follow the slide so the swirl lands where the man reforms
     f.obj.position.z=z;
     const left=f.until-S.time;                              // f.until = reform + tail
     // full opacity until `fade` seconds before the swirl's end, so the dim starts as the figurine fades in
     const k=left>=fade?1:clamp(left/fade,0,1);
     for(const m of f.mats)m.opacity=k;
     if(f.light){f.light.position.z=z;f.light.intensity=lit*k;}
     if(left<=0)disposeSwirl(i);
   }
}

function disposeSwirl(i){
  const f=S.swirl[i];
  scene.remove(f.obj);
  if(f.light)fxLightPut(f.light);   // return the pooled glow (never scene.remove — that changes the light count)
  for(const m of f.mats)m.dispose();  // geometry/textures shared with the template — never dispose those
  S.swirl.splice(i,1);
}

// instantly clear every live fracture instance and respawn swirl (match restart, return to the menu)
function clearFractures(){
  while(S.frac.length)disposeFracture(S.frac.length-1);
  while(S.swirl.length)disposeSwirl(S.swirl.length-1);
}

// ================= pre-kickoff warm =================
// compile every shader a match can fire before the whistle, at the light count play runs at (flow.js startMatch calls it once table, room, teams and the fx light pool are assembled)
// the fx light pool keeps the count constant so it stays valid; gated by CONFIG.fx.warmMatch; idempotent
let warmMeshHolder=null;const warmedBallTypes={};
function warmBallMaterials(){
  if(!renderer||!scene)return;
  // park one hidden instance of each ball type off-screen once (frustum-culled at y=-800) so its compiled program is never released
  if(!warmMeshHolder){warmMeshHolder=new THREE.Group();warmMeshHolder.position.set(0,-800,0);scene.add(warmMeshHolder);}
  for(const key in BALL_TYPES){
   if(warmedBallTypes[key])continue;
   let mesh=(CONFIG.debug&&CONFIG.debug.useBallModel)?makeBallModel(key):null;
   if(!mesh){const t=BALL_TYPES[key];
    mesh=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,24,16),
     new THREE.MeshStandardMaterial({color:t.col,emissive:t.em,emissiveIntensity:t.em?0.7:0,
      roughness:t.metal?.25:.4,metalness:t.metal||.05}));}
   // match the real ball's envMap state (applyBallEnv): null/texture is itself a recompile
   if(typeof ballReflectOn==='function'&&ballReflectOn()&&typeof ballCubeRT!=='undefined'&&ballCubeRT)
    mesh.traverse(o=>{if(o.isMesh){o.material.envMap=ballCubeRT.texture;o.material.envMapIntensity=CONFIG.ballReflect.intensity;o.material.needsUpdate=true;}});
   warmMeshHolder.add(mesh);warmedBallTypes[key]=1;
  }
}
function warmMatchAssets(){
  if(CONFIG.fx&&CONFIG.fx.warmMatch===false)return;
  if(!renderer||!scene||!camera)return;
  warmBallMaterials();
  renderer.compile(scene,camera);            // one pass compiles every scene material (incl. the parked ball types) at the live light count
  for(const id in explosionTemplates)warmFractureTemplate(explosionTemplates[id]); // re-warm the shatters/swirl for THIS room's exact light set
  warmFractureTemplate(ballExplosionTemplate);
  warmFractureTemplate(respawnSwirlTemplate);
}
