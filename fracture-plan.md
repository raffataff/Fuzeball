# Cannonball fracture-model swap — implementation plan

## What this does

Right now, when a cannonball explodes, the nearest player just vanishes (`js/rods.js`
sets `r.men[mi].visible=false` for `CONFIG.cannonball.removeDuration` seconds, driven by
`r.removedUntil[mi]`). This plan swaps that instant vanish for a pre-baked "explode and
collapse" GLB animation, for figurines that have one, with **zero mid-match loading or
shader-compile hitches** — everything expensive happens once at boot, before the match
loop starts.

Three figurine models already have exploded variants sitting in
`assets/animations/`: `irnman_explosion.glb`, `tamirok_explosion.glb`,
`grimlot_explosion.glb`. Only those three figurines (`irnman`, `alienTamirok`,
`alienGrimlot` in `CONFIG.playerModel.models`) get the new effect. Every other
figurine keeps the current instant-vanish behavior until more explosion GLBs are
added — adding one later is a one-line config change, no code change (see "Adding
more figures" at the bottom).

## Why this won't cause lag (read this before implementing)

There are exactly three things that can cause a hitch when you swap in an animated
model, and each has a specific fix baked into the steps below:

1. **Loading the GLB when the cannonball explodes.** `GLTFLoader.load()` is an async
   disk/network read — never call it at explosion time. Fix: all three explosion GLBs
   are loaded once during the existing boot sequence in `main.js`, before
   `requestAnimationFrame(loop)` ever runs. By the time a match can start, they're
   already in memory (`explosionTemplates`), and an explosion just does `.clone(true)`
   on data that's already loaded — cheap, and it reuses the same `BufferGeometry`/
   texture objects, so nothing new gets uploaded to the GPU.

2. **Shader compile stall on first render of a new material.** Three.js compiles a
   material's GPU shader program lazily, the first time it's actually drawn. If that
   first draw happens mid-match, it can cost tens of milliseconds. Fix:
   `warmFractureShaders()` (new, in `js/fracture.js`) clones each template, forces its
   materials into the exact "transparent" state they'll use at runtime (see point 3),
   parks the clone off-screen, and calls `renderer.compile(scene, camera)` — this
   compiles the shader program without ever rendering a visible frame. Runs once at
   boot, right after the explosion GLBs finish loading.

3. **Material state changes forcing a shader variant recompile.** Toggling
   `material.transparent` after the fact can force Three.js to recompile. Fix: cloned
   fracture materials are set `transparent=true` **before** the warm-up compile in
   step 2, so the later opacity fade (a plain uniform update) never triggers a new
   compile.

Runtime cost per explosion: one `.clone(true)`, one `THREE.AnimationMixer`, and one
`mixer.update(dt)` call per frame for however many fracture instances are currently
live (in practice 0 or 1, since a man that's already removed can't be re-targeted by
another cannonball — see `cannonballUpdate`'s existing `removedUntil` skip check).
That's noise next to the physics substeps this game already runs every frame.

## Files touched

- `js/config.js` — add `explosionSrc` to 3 model entries, add `fractureFadeOut` to
  `CONFIG.cannonball`, add `fractureFx` debug toggle.
- `js/state.js` — add `S.frac` array.
- `js/models.js` — add `explosionTemplates` map + `loadExplosionModels()`.
- `js/fracture.js` — **new file.** All the swap/animate/cleanup logic.
- `index.html` — one new `<script>` tag.
- `js/balls.js` — `cannonballUpdate` calls `spawnFracture()` instead of just setting
  `removedUntil`.
- `js/flow.js` — `startMatch()` and `gotoMenu()` call `clearFractures()` so nothing
  lingers across matches/menu.
- `js/main.js` — boot chain loads + warms the explosion models; `loop()` ticks
  `fractureUpdate()`.
- `CLAUDE.md` — add `fracture.js` to the file map + a dated changelog entry (project
  convention — see the existing 2026-07-09/2026-07-07 entries).

`js/rods.js` needs **no changes** — it already flips `r.men[mi].visible` purely off
`r.removedUntil[mi]` vs `S.time`, every frame, regardless of what `js/fracture.js` is
doing. Keep that separation: `fracture.js` never sets `r.men[mi].visible` itself.

---

## Step 1 — `js/config.js`

### 1a. Add `explosionSrc` to the three figurines that have one

Find these three entries in `CONFIG.playerModel.models` and add the `explosionSrc`
line to each (don't touch any other model entry):

```js
   {id:'irnman',name:'Irnman',ico:'🤖',blurb:'Strong and relentless',
      src:'assets/fuzeball_irnman.glb',scale:0.8,
      teamParts:['kit_irnman'],hairParts:[],
      explosionSrc:'assets/animations/irnman_explosion.glb'
   },
```

```js
    {id:'alienTamirok',name:'Tamirok',ico:'',blurb:'Intense and thoughtful',
     src:'assets/fuzeball_alienTamirok.glb',scale:0.8,
     teamParts:['kit_tamirok'],hairParts:[],
     explosionSrc:'assets/animations/tamirok_explosion.glb'
    },
```

```js
    {id:'alienGrimlot',name:'Grimlot',ico:'',blurb:'Wild and unpredictable',
     src:'assets/fuzeball_alienGrimlot.glb',scale:0.8,
     teamParts:['kit_Grimlot'],hairParts:[],
     explosionSrc:'assets/animations/grimlot_explosion.glb'
    },
```

### 1b. Extend the cannonball config block

Current:

```js
 cannonball:{
  timer:10,         // seconds before the cannonball explodes
  removeDuration:10 // seconds the nearest player is removed after explosion
 },
```

Replace with:

```js
 cannonball:{
  timer:10,           // seconds before the cannonball explodes
  removeDuration:10,  // seconds the nearest player is removed after explosion
  fractureFadeOut:0.5 // seconds the fracture debris fades out just before the player respawns
 },
```

### 1c. Add a debug kill-switch

Current:

```js
  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:false  // false = use generated sphere, true = use ball_.glb model
  },
```

Replace with:

```js
  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:false, // false = use generated sphere, true = use ball_.glb model
   fractureFx:true     // false = skip loading/using explosion GLBs, always use the old instant-vanish
  },
```

---

## Step 2 — `js/state.js`

Add a `frac` array to hold live fracture instances. Current top line:

```js
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 ctrl:0,ctrlRods:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,still:0,prePause:'play',
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 stats:null,pu:{obj:null,timer:10,type:null},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
 rodLockRole:null,teamStats:null,lg:null}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js)
```

Change the last line to add `frac:[]`:

```js
 rodLockRole:null,teamStats:null,lg:null,frac:[]}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js) · frac: live cannonball-fracture instances (fracture.js)
```

---

## Step 3 — `js/models.js`

### 3a. Add the template cache near the top

Find:

```js
const rodTemplates={};   // men-count -> loaded rod scene (bar+handle+collar+knob)
let ballModel=null;      // loaded ball GLB scene (with material slots)
const ballMatMap={};     // ballType -> material name in GLB
```

Add a line after it:

```js
const rodTemplates={};   // men-count -> loaded rod scene (bar+handle+collar+knob)
let ballModel=null;      // loaded ball GLB scene (with material slots)
const ballMatMap={};     // ballType -> material name in GLB
const explosionTemplates={}; // figurine id -> {scene, clips} — see CONFIG.playerModel.models[].explosionSrc
```

### 3b. Add the loader

Insert this new function after `makeRodModel` (right before the `/* helpers */`
comment, so it sits alongside the other GLB loaders):

```js
/* --- fracture / explosion models -------------------------------------------
   Optional per-figurine "explode & collapse" GLB, consumed by js/fracture.js
   on a cannonball kill. Only figurines with an explosionSrc get the effect;
   the rest keep the original instant-vanish. Loaded once here, at boot, so a
   live explosion later is just a clone() + mixer.play() — no disk/network
   hit and no fresh material during a match. */
function loadExplosionModels(onReady){
 const list=CONFIG.debug?.fractureFx===false?[]:CONFIG.playerModel.models.filter(m=>m.explosionSrc);
 if(!list.length){onReady();return;}
 let left=list.length;
 const done=()=>{if(--left<=0)onReady();};
 list.forEach(m=>{
  new THREE.GLTFLoader().load(m.explosionSrc,
   gltf=>{explosionTemplates[m.id]={scene:gltf.scene,clips:gltf.animations};done();},
   undefined,
   ()=>{console.warn('explosion GLB missing for '+m.id+' ('+m.explosionSrc+')');done();});
 });
}
```

---

## Step 4 — new file `js/fracture.js`

Create this file with the following full contents:

```js
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
 for(const id in explosionTemplates){
  const inst=cloneFractureInstance(explosionTemplates[id]);
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
}

/* Trigger the effect for rod r's man mi. Call from balls.js cannonballUpdate
   right after r.removedUntil[mi] is set (needs that timestamp to know when
   to fade the debris out). */
function spawnFracture(r,mi){
 const tpl=explosionTemplates[activeModel(r.team).id];
 const manObj=r.men[mi];
 if(!tpl){manObj.visible=false;return;}      // no explosion GLB for this figurine yet — old behavior
 const wp=manObj.getWorldPosition(new THREE.Vector3());
 const wq=manObj.getWorldQuaternion(new THREE.Quaternion());
 const ws=manObj.getWorldScale(new THREE.Vector3());
 manObj.visible=false;
 const inst=cloneFractureInstance(tpl);
 inst.position.copy(wp);inst.quaternion.copy(wq);inst.scale.copy(ws);
 scene.add(inst);
 const mats=[];
 inst.traverse(c=>{if(c.isMesh){c.material.transparent=true;c.material.opacity=1;mats.push(c.material);}});
 const mixer=new THREE.AnimationMixer(inst);
 if(tpl.clips[0]){
  const action=mixer.clipAction(tpl.clips[0]);
  action.setLoop(THREE.LoopOnce);action.clampWhenFinished=true;action.play();
 }
 S.frac.push({obj:inst,mixer,mats,until:r.removedUntil[mi]});
}

/* Per-frame, real dt (like fxUpdate — call from main.js's loop). Advances
   playing mixers, fades debris out over the last
   CONFIG.cannonball.fractureFadeOut seconds before the player respawns, then
   disposes the instance. rods.js flips the real figurine back to visible on
   its own the instant S.time passes r.removedUntil — this just needs to get
   the debris out of the way around the same moment. */
function fractureUpdate(dt){
 for(let i=S.frac.length-1;i>=0;i--){
  const f=S.frac[i];
  f.mixer.update(dt);
  const left=f.until-S.time;
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
 for(const m of f.mats)m.dispose(); // geometry/textures are shared with the template — never dispose those
 S.frac.splice(i,1);
}

/* Instantly clears every live fracture instance — call on match (re)start
   and when returning to the menu so nothing lingers into the next match. */
function clearFractures(){
 while(S.frac.length)disposeFracture(S.frac.length-1);
}
```

> Note on `getWorldPosition`/`getWorldQuaternion`/`getWorldScale`: in three.js r128
> these already call `updateWorldMatrix(true,false)` internally before reading, so the
> spawned debris lines up with the man's exact transform for the current simulation
> step regardless of render timing. If you ever see the debris spawn one frame behind
> the figurine (it shouldn't), add `manObj.updateWorldMatrix(true,false);` as the first
> line of `spawnFracture` — harmless either way, just belt-and-suspenders.

---

## Step 5 — `index.html`

Find:

```html
<script src="js/models.js"></script>
<script src="js/debug.js"></script>
```

Insert the new file between them:

```html
<script src="js/models.js"></script>
<script src="js/fracture.js"></script>
<script src="js/debug.js"></script>
```

---

## Step 6 — `js/balls.js`

Replace the whole `cannonballUpdate` function with:

```js
function cannonballUpdate(dt){
 for(const b of S.balls){
  if(b.cannonTimer<0)continue;
  b.cannonTimer-=dt;
  if(b.cannonTimer<=0){
   removeBall(b);Au.power();
   let nearestRod=-1,nearestMan=-1,nearestDist=Infinity;
   const bp=b.m.position;
   for(let ri=0;ri<rods.length;ri++){
    const r=rods[ri];
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
    banner('💣 REMOVED!','ONE PLAYER TAKEN OUT',1.5);
   }
   if(!S.balls.length&&S.phase==='play'){resetRodRotation();banner('💣 EXPLOSION!','BALL RETURNS',1.2);S.phase='goal';S.goalT=MATCH.outHold;}
   break;
  }
 }
}
```

The only changes: `rods[nearestRod]` is captured into a local `r` (so it can be passed
to `spawnFracture`), and `spawnFracture(r,nearestMan);` is added right after
`removedUntil` is set. Everything else is untouched.

---

## Step 7 — `js/flow.js`

### 7a. `startMatch` — clear any leftover fracture debris from a previous match

Replace the whole function:

```js
function startMatch(mode,rodLockRole){
 Au.init();Au.ui();
 S.mode=mode;S.userTeam=mode==='red'?0:mode==='blue'?1:-1;
 S.rodLockRole=rodLockRole||null;
 S.score=[0,0];S.stats=freshStats();S.matchTime=0;S.time=0;S.timeScale=1;
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 S.lastTouch=-1;S.lastSwitch=0;S.shake=0;
 clearBalls();clearPU();clearFractures();
 S.active=[[],[]];S.pairCd=[0,0];
 rods.forEach(r=>{r.offset=0;r.target=0;r.slideV=0;r.angle=0;r.prevAngle=0;r.prevOffset=0;
  r.kickT=-1;r.raise=false;r.cd=0;r.aiMan=-1;r.aiErr=0;r.aiErrT=0;r.aiErrTarget=0;
  r.aiBX=r.x;r.aiBZ=0;r.aiBVX=0;r.aiBVZ=0;r.aiGoalZ=0;
  r.removedUntil=[];r.men.forEach(m=>{m.visible=true;});
  r.pivot.rotation.z=0;r.pivot.position.z=0;
  const mine=S.userTeam<0?r.team===0:r.team===S.userTeam;
  if(r.rodModel){r.rodModel.rotation.y=mine?0:Math.PI;}   // flip the whole GLB rod so the handle is on the near side
  else{const hs=mine?1:-1,C=rodCollar(r.maxOff);
   r.handle.position.z=hs*(C+CONFIG.rods.handleLen/2);
   r.collar.position.z=-hs*(C+CONFIG.rods.collarLen/2);}});
 S.ctrlRods=S.userTeam<0?[]:rods.filter(r=>r.team===S.userTeam).sort((a,b)=>a.x-b.x);
 if(rodLockRole&&S.ctrlRods.length>1){
  const lr=S.ctrlRods.find(r=>r.role===rodLockRole)||S.ctrlRods[0];
  S.ctrlRods=[lr];
  $('hint').innerHTML='▲ ▼ / mouse — slide<br>SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; V — camera';
 }else{
  $('hint').innerHTML='◀ ▶ / Q E — switch rod &nbsp;·&nbsp; ▲ ▼ / mouse — slide<br>SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; V — camera';
 }
 S.ctrl=0;
 if(S.ctrlRods.length){const mi=S.ctrlRods.findIndex(r=>r.role==='MID');if(mi>=0)S.ctrl=mi;}
 $('menu').classList.add('hidden');$('league').classList.add('hidden');$('pause').classList.add('hidden');$('win').classList.add('hidden');
 $('hud').classList.remove('hidden');
 $('sbRN').textContent=teamName(0);$('sbBN').textContent=teamName(1);
 $('ballTag').textContent=BALL_TYPES.classic.name;
 updateScoreUI();updateChips();
 banner('FIRST TO '+goalTarget(),S.lg?'LEAGUE · ROUND '+(LG.round+1):S.userTeam<0?'AI SHOWDOWN':'GOOD LUCK',1.7);
 startCount(MATCH.countIn);
}
```

(Only change: `clearBalls();clearPU();` → `clearBalls();clearPU();clearFractures();`)

### 7b. `gotoMenu` — same, for when a match is abandoned mid-explosion

Replace the whole function:

```js
function gotoMenu(){
  if(S.lg&&S.lg.prevKit){
   cfg.redColor=S.lg.prevKit.redColor;cfg.blueColor=S.lg.prevKit.blueColor;
   cfg.modelRed=S.lg.prevKit.modelRed;cfg.modelBlue=S.lg.prevKit.modelBlue;
   cfg.special=S.lg.prevKit.special;cfg.power=S.lg.prevKit.power;
   loadPlayerModel(()=>{rebuildRodMen();applyColors();});
  }
 S.phase='menu';clearBalls();clearPU();clearFractures();
 S.lg=null;S.teamStats=null; // drop any league-match bridge (abandoned matches aren't recorded)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');$('hud').classList.add('hidden');$('league').classList.add('hidden');
 $('menu').classList.remove('hidden');
 indicator.visible=false;dropRing.visible=false;$('count').style.display='none';
}
```

(Only change: `clearBalls();clearPU();` → `clearBalls();clearPU();clearFractures();`)

---

## Step 8 — `js/main.js`

Replace the whole file with:

```js
'use strict';
/* ================= main loop ================= */
/* Fixed-timestep sim + render interpolation. The simulation (input/AI/rods/
   physics) only ever advances in constant FIXED-second slices, so it's stable
   and deterministic regardless of frame rate. The renderer then draws each ball
   and rod lerped between its previous and current sim slice by 'alpha' (the
   leftover sub-slice time), so on-screen motion is buttery-smooth at any refresh.
   Wall-clock stuff (countdown, match clock, fx, camera, hud) stays per-frame. */
let lastT=performance.now(), physAcc=0;
function loop(t){
 requestAnimationFrame(loop);
 const rdt=Math.min(.05,(t-lastT)/1000);lastT=t;
 Au.tick(rdt);
 const active=S.phase==='play'||S.phase==='goal'||S.phase==='count';
 if(active){
  const FIXED=1/SIM.hz;
  /* --- wall-clock timers (real time, once per frame) --- */
  if(S.phase==='play')S.matchTime+=rdt;
  if(S.phase==='goal'){S.goalT-=rdt;if(S.goalT<=0)startCount(MATCH.recount);}
  else if(S.phase==='count'){
   S.countT-=rdt;
   const v=Math.ceil(S.countT);
   if(v!==S.lastCount&&v>=1&&v<=3){S.lastCount=v;Au.beep(880,.09,'square',.14);}
   $('count').textContent=S.countT>3?'READY':(v>=1?String(v):'');
   if(S.countT<=0){$('count').style.display='none';Au.beep(1400,.2,'square',.18);serve();}
  }
  if(S.timeScale<1)S.timeScale=Math.min(1,S.timeScale+rdt*.9);
  /* --- fixed-rate simulation (slow-mo just consumes sim-time slower) --- */
  physAcc+=rdt*S.timeScale;
  let stepped=false,steps=0;
  while(physAcc>=FIXED&&steps<SIM.maxSteps){
   if(!stepped)for(const b of S.balls)b.m.position.copy(b.cur); // undo last frame's interp → true sim state
   for(const b of S.balls)b.prev.copy(b.m.position);
   for(const r of rods){r.iPrevOff=r.offset;r.iPrevAng=r.angle;}
   if(S.phase==='play'){aiUpdate(FIXED);userControlUpdate(FIXED);powerupUpdate(FIXED);deadBallUpdate(FIXED);cannonballUpdate(FIXED);}
   else if(S.phase==='count')userControlUpdate(FIXED);
   updateRods(FIXED);
   physics(FIXED);
   S.time+=FIXED;physAcc-=FIXED;steps++;stepped=true;
  }
  if(steps>=SIM.maxSteps)physAcc=0;                    // spiral-of-death guard: drop the backlog
  if(stepped){
   for(const b of S.balls)b.cur.copy(b.m.position);    // capture true current sim state
   for(const r of rods){r.iOff=r.offset;r.iAng=r.angle;}
  }
  /* --- render interpolation --- */
  const alpha=clamp(physAcc/FIXED,0,1);
  for(const b of S.balls){
   b.m.position.lerpVectors(b.prev,b.cur,alpha);
   if(b.light)b.light.position.copy(b.m.position);
  }
  for(const r of rods){
   if(r.iOff===undefined){r.iOff=r.iPrevOff=r.offset;r.iAng=r.iPrevAng=r.angle;}
   r.pivot.position.z=lerp(r.iPrevOff,r.iOff,alpha);
   r.pivot.rotation.z=lerp(r.iPrevAng,r.iAng,alpha);
  }
  fractureUpdate(rdt);   // advance/fade any live cannonball-fracture instances
 }
 fxUpdate(rdt);
 cameraUpdate(rdt);
 debugUpdate();
 if(S.phase!=='menu')hudTick(rdt);
 renderer.render(scene,camera);
}
initThree();
initCustomize();
bindUI();
loadTableModel();                       // swaps in the GLB table when ready (falls back to primitives)
loadBallModel(()=>{                     // ball GLB with material slots
 loadPlayerModel(()=>{
  loadExplosionModels(()=>{             // cannonball-kill fracture GLBs (if any figurine has one)
   warmFractureShaders();               // precompile their shaders now, off-screen — never during a match
   loadRodModels(()=>{                  // rod GLBs must be ready before buildRods clones them
    buildRods();applyTable();applyTheme();applyColors();
    requestAnimationFrame(loop);
   });
  });
 });
});
```

`fractureUpdate(rdt)` is placed **inside** the `if(active){...}` block, on purpose:
`S.time` only advances there, and `f.until` (the fracture instance's expiry) is a
`S.time` value — putting the update outside `active` would either desync the fade
timing from pause, or require passing real dt for the mixer and sim dt for the fade
separately. Keeping it inside means pausing the game also freezes the exploding
player's animation, exactly like everything else in the sim.

---

## Step 9 — `CLAUDE.md`

Two small additions to keep the doc accurate (this project's own convention — see the
existing file map and the dated changelog entries at the bottom):

1. In the file map line listing `js/` load order, add `fracture.js` after `models.js`:

   > `... league.js · customize.js · models.js · fracture.js · debug.js · main.js`

2. Add a new dated entry under "Current state / recent work" describing what shipped,
   following the style of the existing `2026-07-09`/`2026-07-07` entries (what changed,
   which files, why). Use today's date.

---

## Testing checklist

1. **Boot with the sandbox/browser available**: open `index.html`, check the console
   for `explosion GLB missing for ...` warnings — should see none if the three asset
   paths are correct. Confirm no errors from `renderer.compile`.
2. **Start a match with `special` ball types on**, set a short `cannonball.timer` (e.g.
   temporarily drop it to 2 in `config.js`) to speed up testing, and make sure both
   teams are set to a figurine that HAS an explosion GLB (Irnman / Tamirok / Grimlot)
   via the Customize panel.
3. Let a cannonball explode. Verify: the targeted man visually fractures/collapses in
   place (not at the origin, not offset) instead of just vanishing; no visible
   stutter/frame drop at the moment of explosion (compare to before the change — the
   explosion banner + screen shake already happening should mask minor cost, but there
   should be none anyway); wreckage stays roughly on the floor at that position; around
   `removeDuration` seconds later the wreckage fades out over `fractureFadeOut` seconds
   as the real figurine pops back in.
4. **Regression check on the non-covered figurines**: pick a figurine without an
   `explosionSrc` (e.g. Cyborg) and confirm the cannonball still behaves exactly as
   before (instant vanish, instant return) — `spawnFracture`'s `if(!tpl)` fallback path.
5. **Match reset mid-explosion**: trigger an explosion, then immediately hit Rematch /
   go to menu / start a new match before the wreckage would have faded out on its own.
   Confirm no leftover debris mesh is visible in the new match or on the menu's 3D
   background (this is what `clearFractures()` in `startMatch`/`gotoMenu` is for).
6. **Perf sanity**: with the debug overlay's frame-time or your browser's perf panel,
   confirm frame time doesn't spike at the moment of explosion. If it does, the most
   likely cause is `renderer.compile` not actually covering the runtime material state
   — double check `warmFractureShaders` sets `transparent=true` before compiling, and
   that `spawnFracture`/`cloneFractureInstance` don't introduce a material variant that
   warm-up didn't see (e.g. don't add vertex colors, skinning, or morph targets to the
   clone path without also warming that variant).
7. **If the model doesn't visibly animate at all** (just pops in and sits static):
   the explosion GLB's animation is very likely a **skinned/bone-rigged** clip rather
   than independent per-fragment keyframed transforms. `clone(true)` does not correctly
   re-target a `SkinnedMesh`'s skeleton. Fix: add
   `<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js"></script>`
   to `index.html` (after the GLTFLoader script), and in `cloneFractureInstance` replace
   `tpl.scene.clone(true)` with `THREE.SkeletonUtils.clone(tpl.scene)`. (Typical
   Blender "cell fracture + rigid body bake" workflows produce independent per-fragment
   meshes with no armature, in which case plain `clone(true)` is correct and this step
   isn't needed — only do this if step 7's symptom actually shows up.)

## Adding more figures later

Once you're happy with how it looks on these three: drop the new
`assets/animations/<name>_explosion.glb`, add one `explosionSrc:'...'` line to that
figurine's entry in `CONFIG.playerModel.models` (`js/config.js`), reload. No other code
changes needed — `loadExplosionModels` picks up every model entry with an
`explosionSrc` automatically.

## Optional polish (not required for the core feature)

- **Pop-in on respawn**: currently the real figurine just snaps back to visible
  (unchanged from today). A quick scale-in (0 → 1 over ~0.3s) would read as more
  "arcade-y" per the project's performative-feel goal. Skipped here to keep this pass
  low-risk; if wanted, it needs a small per-rod respawn-timer akin to `r.removedUntil`,
  updated in `rods.js`'s existing `updateRods` man-visibility loop.
- **Debris settle variation**: `cloneFractureInstance` could apply a small random
  Y-axis pre-rotation before spawning so repeated explosions on the same figurine don't
  all fracture identically. Cheap, purely cosmetic.
