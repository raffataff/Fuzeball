'use strict';
/* ================= fracture fx (cannonball kill) =================
   Swaps a destroyed player's figurine for a pre-baked "explode & collapse"
   GLB instead of just hiding it. Templates come from models.js
   (explosionTemplates, filled by loadExplosionModels) and are loaded and
   shader-warmed once at boot — see main.js's load chain — so triggering one
   mid-match is just a clone() + mixer.play(), never a disk read or a shader
   compile. Figurines without an explosionSrc in CONFIG.playerModel.models
   fall back to the original instant-vanish (see spawnFracture).

   Ownership split: js/rods.js still owns r.men[mi].visible purely off
   r.removedUntil[mi] vs S.time, every frame, regardless of what's happening
   here. This file never touches that flag — it only manages the separate
   fracture-instance meshes layered on top. */

/* Deep-clone a template: shares geometry/textures with the template (cheap,
   no GPU re-upload) but clones materials so this instance's opacity can fade
   independently of the shared template and any other live instance. */
function cloneFractureInstance(tpl){
  const g=tpl.scene.clone(true);
  g.traverse(c=>{
   if(!c.isMesh)return;
   c.castShadow=true;
   c.material=Array.isArray(c.material)?c.material.map(m=>m.clone()):c.material.clone();
  });
  return g;
}

/* Warm ONE template: instantiate it off-screen in its transparent fade state and compile
   that shader now. Reused by warmFractureShaders (boot) AND models.js ensureExplosionModel
   (each figurine shatter warms itself the moment it lazy-loads). No-op until the renderer
   exists (guards a warm that races ahead of initThree). */
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
/* Boot: warm every shatter template already resident — that's the two shared ones
   (ball + swirl) plus any figurine explosions primed so far. Per-figurine templates that
   lazy-load later warm themselves via ensureExplosionModel. */
function warmFractureShaders(){
  for(const id in explosionTemplates)warmFractureTemplate(explosionTemplates[id]);
  warmFractureTemplate(ballExplosionTemplate); // the cannonball's own shatter shares the pre-warm
  warmFractureTemplate(respawnSwirlTemplate);  // the respawn swirl shares the pre-warm so its first play never stalls
}

/* Trigger the effect for rod r's man mi. Call from balls.js cannonballUpdate
   right after r.removedUntil[mi] is set (needs that timestamp to know when
   to fade the debris out). */
function spawnFracture(r,mi){
  const tpl=explosionTemplates[activeModel(r.team).id];
  const manObj=r.men[mi];
  if(!tpl){manObj.visible=false;return;}      // no explosion GLB for this figurine yet — old behavior
  // Position is the man's RESTING (neutral, unswung) world pose — right on top of
  // the standing figure — NOT its live swing/raise position. The intact man is a
  // child of the pivot at local (0, PLAYER_H, baseZ) (world.js buildRods), so at
  // angle 0 its world transform is exactly (r.x, ROD_H+PLAYER_H, r.offset+baseZ).
  // Deliberately NO sin/cos(r.angle) term: the previous version placed the debris
  // at the man's *rotated* position, which threw it up and BACK in x whenever the
  // rod was raised/kicking at the instant of the kill — the "falls behind, as if
  // the feet were where they are when raised" bug. The explosion GLB is baked from
  // the neutral standing pose and its animation only falls straight down in world
  // space, so it must be seated at the neutral pose. Rotation about the rod's
  // z-axis never moves z, so r.offset+r.baseZ[mi] is the man's true current z
  // regardless of swing — that stays exactly where the man was slid to at the kill.
  const wp=new THREE.Vector3(r.x,ROD_H+PLAYER_H,r.offset+r.baseZ[mi]);
  const s=activeModel(r.team).scale*(cfg.modelScale||1);
  const ws=new THREE.Vector3(s,s,s);
  // Rotation is deliberately NOT taken from the rod's swing/raise angle at all —
  // only the static team-facing yaw the intact model uses (buildRods/
  // rebuildRodMen: p.rotation.y=Math.PI for team 1). The explosion GLB was baked
  // from the figurine in its neutral standing pose, so its "fall to floor"
  // animation's gravity direction only points straight down in world space if
  // the instance stays upright — copying the rod's current tilt here would
  // reintroduce the "falls sideways relative to the rod's angle" bug.
  const wq=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),r.team===1?Math.PI:0);
  manObj.visible=false;
  const inst=cloneFractureInstance(tpl);
  inst.position.copy(wp);inst.quaternion.copy(wq);inst.scale.copy(ws);
  scene.add(inst);
  // Tint the same kit parts the intact figure tints (CONFIG.playerModel.models[].
  // teamParts) so the debris still reads as red/blue instead of reverting to
  // whatever base colour the shard was authored/exported with. Cell Fracture keeps
  // each shard's original material slot on its exterior faces, so the material
  // names should already match teamParts the same way they do on the live model.
  const teamParts=new Set((activeModel(r.team).teamParts||[]).map(s=>s.toLowerCase()));
  const col=r.team===0?cfg.redColor:cfg.blueColor;
  const mats=[];
  inst.traverse(c=>{
   if(!c.isMesh)return;
   c.material.transparent=true;c.material.opacity=1;
   const name=(c.material.name||'').toLowerCase().split('.')[0]; // strip Blender's .001 re-import suffix
   if(teamParts.has(name))c.material.color.set(col);
   mats.push(c.material);
  });
  const mixer=new THREE.AnimationMixer(inst);
  // Baking a rigid-body sim per-shard in Blender gives EACH shard its own Action,
  // so the glTF exporter writes one animation clip PER SHARD, not one clip that
  // covers the whole explosion. Playing only clips[0] leaves every other shard
  // frozen in its assembled start pose — looks like "the intact model" with a
  // single piece breaking off, which is exactly the bug this was. Play all of them.
  for(const clip of tpl.clips){
   const action=mixer.clipAction(clip);
   action.setLoop(THREE.LoopOnce);action.clampWhenFinished=true;action.play();
  }
  S.frac.push({obj:inst,mixer,mats,until:r.removedUntil[mi]});
}

/* Trigger the cannonball's OWN shatter at world position `pos` (its location at
   the instant of detonation). Simpler than the player version: the ball isn't
   team-tinted, has no rod pose to reconstruct, and no respawn to sync against —
   so its lifetime is self-contained (`until = now + fractureLife`) and it shares
   the exact same S.frac list + fractureUpdate fade/dispose path as the player
   debris. A short-lived orange point light rides along for a real explosion
   pop; fractureUpdate fades it and disposeFracture removes it. Call from
   balls.js cannonballUpdate (via cannonExplodeFx) BEFORE removeBall frees the
   ball mesh. No-op if the GLB never loaded (missing file / fractureFx off) —
   the 2D particles in cannonExplodeFx still play. */
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
  const light=new THREE.PointLight(0xff7a1a,4,64);light.position.copy(pos);light.position.y+=2;scene.add(light);
  S.frac.push({obj:inst,mixer,mats,light,until:S.time+CONFIG.cannonball.fractureLife});
}

/* Per-frame, real dt (like fxUpdate — call from main.js's loop). Advances
   playing mixers, fades debris out over the last
   CONFIG.cannonball.fractureFadeOut seconds before disposal, then disposes the
   instance. For PLAYER debris `until` is the respawn timestamp (rods.js flips
   the real figurine back to visible on its own the instant S.time passes
   r.removedUntil — this just clears the debris around the same moment); for
   BALL debris `until` is a self-contained now+fractureLife. Ball entries also
   carry a point light that decays over the fade. */
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
  if(f.light)scene.remove(f.light);  // ball debris only; player entries have no light
  for(const m of f.mats)m.dispose(); // geometry/textures are shared with the template — never dispose those
  S.frac.splice(i,1);
}

/* ================= respawn swirl (cannonball-kill recovery) =================
   Swirly particles that rise from the floor up to the rod in the last
   CONFIG.cannonball.respawnLead seconds before a removed player reforms, so the
   comeback is telegraphed instead of the figure just popping back in. ONE shared
   GLB (respawnSwirlTemplate, CONFIG.cannonball.respawnSwirlSrc) for every
   figurine — unlike the per-figurine explosion templates — since it's a generic
   particle column, not a tinted shatter of a specific model.

   Lifecycle mirrors the fracture path (clone + mixer + fade + dispose, on the
   separate S.swirl list) but is DRIVEN OFF r.removedUntil[mi] rather than spawned
   at the kill: respawnSwirlUpdate scans the removed men each frame and lazily
   spawns a swirl once its respawn is within respawnLead. Clips LOOP (the effect
   is a continuous rising column), so a short bake just repeats. The instance
   tracks the rod's z-slide every frame so the particles land exactly where the
   man reappears.

   TIMING (the whole point of the effect):
     reform-lead ............ swirl spawns, full opacity          (lead = swirlLead())
     reform ................. rods.js flips the figure visible and starts its
                              respawnFade fade-in — the swirl is STILL PLAYING
     reform+tail ............ swirl disposed                      (tail = swirlTail())
   The swirl deliberately OUTLIVES r.removedUntil by `tail`; it used to die exactly
   at reform, which read as the player's arrival killing the particles. Its opacity
   ramp is anchored to the END of the tail, not to reform, so the two cross-dissolve. */

/* Spawn the swirl for rod r's man mi, where `reform` is the moment the figurine comes
   back (=r.removedUntil[mi]). The instance lives until reform+swirlTail(), NOT until
   reform. No-op if the GLB never loaded (missing file / fractureFx off) — the man
   still respawns on schedule, just without the flourish. */
function spawnRespawnSwirl(r,mi,reform){
  const tpl=respawnSwirlTemplate;if(!tpl)return;
  const C=CONFIG.cannonball;
  const inst=cloneFractureInstance(tpl);
  const s=C.respawnSwirlScale||1, z=r.offset+r.baseZ[mi];
  // Seated on the floor (respawnSwirlY) under the man's CURRENT slide position; z
  // is re-tracked per-frame in respawnSwirlUpdate. Upright — deliberately no rod
  // swing/raise tilt, so the column always rises straight up in world space.
  inst.position.set(r.x,C.respawnSwirlY||0,z);inst.scale.set(s,s,s);
  scene.add(inst);
  // Team tint. cloneFractureInstance already clones every material per-instance, so
  // writing colour here can't leak back into the shared template. Unlike a figurine
  // (where only teamParts recolour and skin/visor stay as authored) the swirl GLB is
  // ALL effect, so by default every mesh takes the kit colour; respawnSwirlTintParts
  // narrows it to a name list if the bake has something that must stay neutral.
  const col=new THREE.Color(r.team===0?cfg.redColor:cfg.blueColor);
  const tint=C.respawnSwirlTint!==false, em=C.respawnSwirlEmissive!=null?C.respawnSwirlEmissive:1;
  const only=C.respawnSwirlTintParts&&C.respawnSwirlTintParts.length?
   new Set(C.respawnSwirlTintParts.map(s=>s.toLowerCase())):null;
  const mats=[];
  inst.traverse(c=>{if(!c.isMesh)return;
   const ms=Array.isArray(c.material)?c.material:[c.material];
   for(const m of ms){
    m.transparent=true;m.opacity=1;
    // '.001' suffixes come from glTF de-duping the same material across shards — strip
    // them so a name list matches the way it does on the live figurine.
    if(tint&&(!only||only.has(String(m.name||'').toLowerCase().replace(/\.\d+$/,'')))){
     if(m.color)m.color.copy(col);
     if(m.emissive)m.emissive.copy(col).multiplyScalar(em);
    }
    mats.push(m);
   }});
  const mixer=new THREE.AnimationMixer(inst);
  // LOOP every clip (contrast spawnFracture's one-shot LoopOnce) so a short bake
  // repeats to fill the lead+tail window. With respawnSwirlFit the window is instead
  // matched to the bake: ONE timeScale off the LONGEST clip (not per-clip) so every
  // shard keeps its authored relative timing, just slower/faster overall.
  const win=swirlLead()+swirlTail();
  let dur=0;for(const c of tpl.clips)if(c.duration>dur)dur=c.duration;
  const ts=(C.respawnSwirlFit&&dur>0&&win>0)?dur/win:1;
  mixer.timeScale=ts;
  for(const clip of tpl.clips){const a=mixer.clipAction(clip);a.setLoop(THREE.LoopRepeat);a.play();}
  let light=null;
  if((C.respawnSwirlLight||0)>0){                       // optional soft team-tinted glow riding the column
   light=new THREE.PointLight(col.getHex(),0,48);light.position.set(r.x,(C.respawnSwirlY||0)+5,z);scene.add(light);
  }
  // `until` = when the swirl DIES, which is respawnSwirlTail seconds PAST the reform
  // moment — that overlap is what keeps the particles going while the figurine fades in.
  S.swirl.push({obj:inst,mixer,mats,light,rod:r,mi,until:reform+swirlTail()});
}

/* Seconds the swirl outlives the reform (defaults to the figurine fade-in length so
   the whole materialise happens inside the particles). */
function swirlTail(){
  const C=CONFIG.cannonball;
  return C.respawnSwirlTail!=null?C.respawnSwirlTail:(C.respawnFade||0);
}

/* How early (before reform) the swirl starts. respawnLead>0 forces a window; 0/absent
   = AUTO, meaning the LONGEST baked clip in the GLB, so the exported animation plays
   through in full instead of being cut off by an arbitrary lead. */
function swirlLead(){
  const C=CONFIG.cannonball;
  if(C.respawnLead>0)return C.respawnLead;
  const cl=respawnSwirlTemplate&&respawnSwirlTemplate.clips;
  let d=0;if(cl)for(const c of cl)if(c.duration>d)d=c.duration;
  return Math.max(0,d-swirlTail())||d||3;   // clip length spans lead+tail; fall back to 3s if the GLB has no clips
}

/* Per-frame, real dt (call from main.js's loop alongside fractureUpdate). Two
   passes: (1) spawn a swirl for any removed man whose respawn is now within
   swirlLead() and doesn't already have one; (2) advance/track/fade the live ones,
   disposing swirlTail() seconds AFTER reform (so the particles keep swirling
   through the figurine's fade-in). */
function respawnSwirlUpdate(dt){
  const C=CONFIG.cannonball;
  if(respawnSwirlTemplate){
   const lead=swirlLead();
   for(const r of rods){
    if(!r.removedUntil)continue;
    for(let mi=0;mi<r.baseZ.length;mi++){
     const ru=r.removedUntil[mi];
     // NOTE: no `ru<=S.time` skip — the swirl deliberately outlives the reform by
     // swirlTail(), and the man is already back (removedUntil in the past) for that
     // whole stretch. The tail check below retires it instead.
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
     // Full opacity until `fade` seconds before the swirl's END (not before reform):
     // with fade = respawnSwirlTail the dim begins exactly as the figurine starts
     // fading IN, so particles and player cross-dissolve instead of hand-off.
     const k=left>=fade?1:clamp(left/fade,0,1);
     for(const m of f.mats)m.opacity=k;
     if(f.light){f.light.position.z=z;f.light.intensity=lit*k;}
     if(left<=0)disposeSwirl(i);
   }
}

function disposeSwirl(i){
  const f=S.swirl[i];
  scene.remove(f.obj);
  if(f.light)scene.remove(f.light);
  for(const m of f.mats)m.dispose();  // geometry/textures shared with the template — never dispose those
  S.swirl.splice(i,1);
}

/* Instantly clears every live fracture instance AND respawn swirl — call on match
   (re)start and when returning to the menu so nothing lingers into the next match. */
function clearFractures(){
  while(S.frac.length)disposeFracture(S.frac.length-1);
  while(S.swirl.length)disposeSwirl(S.swirl.length-1);
}
