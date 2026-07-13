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

/* Boot-time only (called once from main.js, right after loadExplosionModels
   resolves, before the game loop starts): instantiate each explosion
   template off-screen, force it into the transparent material state it'll
   actually use during the fade-out, and ask the renderer to compile that
   shader program now. Removes the first-explosion compile stall entirely. */
function warmFractureShaders(){
  const warm=tpl=>{
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
  };
  for(const id in explosionTemplates)warm(explosionTemplates[id]);
  if(ballExplosionTemplate)warm(ballExplosionTemplate); // the cannonball's own shatter shares the pre-warm
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

/* Instantly clears every live fracture instance — call on match (re)start
   and when returning to the menu so nothing lingers into the next match. */
function clearFractures(){
  while(S.frac.length)disposeFracture(S.frac.length-1);
}
