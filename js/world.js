'use strict';
/* ================= three.js world ================= */
let renderer,scene,camera,dirLight,hemiLight;
// Room (location) runtime state. roomGroups (id->backdrop GLB group) lives in arena.js (loaded
// first). activeRoom = the current CONFIG.rooms entry; roomEnvCache caches baked reflection maps
// ('syn:id' synthetic | 'glb:id' from the room model); curLeds = CONFIG.leds merged with the
// active room's led override (fx.js ledUpdate reads it); pmremGen is the shared PMREM baker.
let activeRoom=null,roomEnvCache={},pmremGen=null,curLeds=CONFIG.leds;
const teamMat=[null,null],teamGlow=[null,null];
let fieldMesh,fieldTexCache={},wallMat,ledMat,goalFrames=[],goalLights=[],netMats=[],groundMesh,primTable=null;
const fxLightPool=[];   // resident spare PointLights (see buildFxLightPool) — effect glows borrow from here so the scene's light count never changes
// primLedMat = the PROCEDURAL led material built in buildTable. ledMat is repointed at whichever
// skin GLB is showing (applySkin), so disposing an evicted skin would leave ledMat dangling on a
// freed material — disposeTableSkin falls back to this one. Never disposed.
let primLedMat=null;
// big-goal GLB hookup, per goal index [0=left/-x, 1=right/+x] (matches goalFrames order):
// glbGoalGrow = baked frame meshes uniform-scaled about z=0; glbGoalWall = end-wall meshes {o,inner,outer,sgn} slid open. Filled by registerBigGoalMeshes, driven in bigGoalUpdate.
let glbGoalGrow=[[],[]],glbGoalWall=[[],[]],glbGoalSplit=[];
// glbGoalSplit: a single baked frame mesh that spans BOTH goals (e.g. an arena frame exported as one
// object) can't scale per-side, so it's morphed vertex-wise — each vert widens by its own goal's mult.
let rods=[],indicators=[],dropRing;   // indicators: one held-rod marker per seat (fx.js drives them)
let rodCustomMats=[]; // {mat, team, isGlow} — rod GLB materials detached from teamMat/teamGlow via cloneWithMaps
let rodsDressedFor=null; // rod-set key the rods currently wear (reskinRods skips a no-op switch)
let sprites=[],spriteTex,particles,pGeo,pData=[];
let playerModel=[null,null]; const playerTeamMats=[{},{}]; const playerHairParts=[new Set(),new Set()]; const modelCache={}; const modelCacheOrder=[]; // LRU key order, most-recent at end

/* ---- figurine template cache LRU (shared helpers; also used by PV.cache in customize.js) ----
   Loading a figurine caches its GLB template scene; browsing every figurine would otherwise pin
   all ~19 in RAM. These cap a cache to CONFIG.playerModel.cacheMax, evicting the least-recently
   used entries whose id isn't in `protect`. */
function touchModelCache(order,id){const k=order.indexOf(id);if(k>=0)order.splice(k,1);order.push(id);}
function cacheModelTemplate(cache,order,id,scene){cache[id]=scene;touchModelCache(order,id);}
/* Free a template's GPU buffers + textures. ONLY call when nothing clones it anymore (evicted +
   not an active/shown figurine) — clone(true) shares geometry/textures with the template, so
   disposing a live one would blank the meshes using it. */
function disposeModelTemplate(root){
 if(!root||!root.traverse)return;
 root.traverse(c=>{if(!c.isMesh)return;
  if(c.geometry&&c.geometry.dispose)c.geometry.dispose();
  const mats=Array.isArray(c.material)?c.material:[c.material];
  for(const m of mats){if(!m)continue;
   for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap','displacementMap','lightMap']){const t=m[k];if(t&&t.dispose)t.dispose();}
   if(m.dispose)m.dispose();}});
}
/* Evict LRU entries past cap. `protect` = Set of ids never evicted (currently on-table / shown).
   `dispose` true → also free GPU immediately (only safe when NO clone references the template);
   false → drop the JS ref only (lets V8 reclaim the big decoded-image/geometry arrays once
   unreferenced, GPU frees on the eventual context teardown). Both current callers pass false
   because a just-swapped figurine can still have live clones sharing the template's geometry. */
function capModelCache(cache,order,protect,dispose){
 const cap=(CONFIG.playerModel&&CONFIG.playerModel.cacheMax)||6;
 for(let i=0;i<order.length&&order.length>cap;){
  const id=order[i];
  if(protect&&protect.has(id)){i++;continue;}
  order.splice(i,1);
  const scene=cache[id];delete cache[id];
  if(dispose)disposeModelTemplate(scene);
 }
}

/* ---- shared offscreen preview renderer (PRV) ------------------------------
   The customize turntable, the menu figurine thumbnails and the league-setup preview each used to
   own a WebGLRenderer. Every GL context carries its own framebuffer AND its own upload of every
   texture/geometry it draws, so a figurine on the table, in the studio and in a thumbnail existed
   THREE times in VRAM. They now share ONE offscreen context: a caller sizes it, renders its scene,
   and the pixels are blitted into its own plain 2D canvas via drawImage.
   Three things this relies on, all load-bearing:
   - A target canvas must never have had a webgl context attached — a canvas hands out exactly one
     context type for its lifetime, so these targets are 2d-only now.
   - preserveDrawingBuffer is unnecessary (and gone): the pixels come to rest in the destination 2D
     canvas, which the compositor won't clear. LSP needed that flag before precisely because it
     drew straight to a visible canvas once per interaction.
   - Resizing a GL drawing buffer REALLOCATES it, so size() is a no-op when nothing changed — the
     studio's 60fps path never resizes, it just renders and blits. */
/* The drawing buffer is GROW-ONLY and consumers render into a sub-viewport of it, rather than the
   buffer being resized per call. That matters because the callers interleave at input rate: the
   finish sliders run czAfterFinish on every `input` event, which repaints the two menu thumbnails
   (240x320) while the studio (panel-sized) is mid-turntable — resize-per-call would reallocate the
   framebuffer twice per slider tick. Requested sizes are in CSS px + a dpr; PRV works in device px
   and pins its own pixelRatio to 1 so there's exactly one place the conversion happens.
   Viewport sits at the buffer's TOP-left, which in GL's bottom-left origin is y = bh − height —
   that way the region maps to drawImage's top-left source rect with no flip. */
const PRV={r:null,bw:0,bh:0,w:0,h:0,dpr:0,scratch:null,
 get(){
  if(PRV.r)return PRV.r;
  PRV.r=new THREE.WebGLRenderer({antialias:true,alpha:true});
  PRV.r.setPixelRatio(1);                    // we hand it device pixels directly
  PRV.r.outputEncoding=THREE.sRGBEncoding;
  applyToneMapping(PRV.r,false);   // same grade as the game, or previews lie about the finish
  PRV.r.setScissorTest(true);                // so clear() only touches the active sub-viewport
  return PRV.r;
 },
 /* Render `scene` into the top-left ww×hh of the shared buffer, growing it if needed.
    Returns [ww,hh] in device px, or null if the request was degenerate. */
 frame(scene,cam,w,h,dpr){
  if(!w||!h)return null;
  dpr=dpr||1;
  const r=PRV.get(),ww=Math.max(1,Math.round(w*dpr)),hh=Math.max(1,Math.round(h*dpr));
  if(ww>PRV.bw||hh>PRV.bh){                  // grow only — never shrink, so interleaved callers don't thrash
   PRV.bw=Math.max(PRV.bw,ww);PRV.bh=Math.max(PRV.bh,hh);
   r.setSize(PRV.bw,PRV.bh,false);
  }
  const y=PRV.bh-hh;                         // GL origin is bottom-left; put our region at the top
  r.setViewport(0,y,ww,hh);r.setScissor(0,y,ww,hh);
  r.render(scene,cam);
  PRV.w=w;PRV.h=h;PRV.dpr=dpr;               // last-drawn size, for memLog
  return [ww,hh];
 },
 // Blit into `target` (a 2D canvas), matching its backing store so the copy is 1:1 with no
 // resample. Same tick as the render, so no preserveDrawingBuffer is needed.
 draw(scene,cam,target,w,h,dpr){
  if(!target)return;
  const d=PRV.frame(scene,cam,w,h,dpr);if(!d)return;
  const ww=d[0],hh=d[1];
  if(target.width!==ww||target.height!==hh){target.width=ww;target.height=hh;}
  const ctx=target.getContext('2d');if(!ctx)return;
  ctx.clearRect(0,0,ww,hh);
  ctx.drawImage(PRV.r.domElement,0,0,ww,hh,0,0,ww,hh);   // source rect = our sub-viewport
 },
 // Same, but into a private scratch canvas → PNG data URL (menu thumbnails, studio snapshot).
 // Going via a 2D scratch means we never read back from the GL buffer at all.
 dataURL(scene,cam,w,h,dpr){
  const d=PRV.frame(scene,cam,w,h,dpr);if(!d)return null;
  const ww=d[0],hh=d[1];
  if(!PRV.scratch)PRV.scratch=document.createElement('canvas');
  const s=PRV.scratch;if(s.width!==ww||s.height!==hh){s.width=ww;s.height=hh;}
  const ctx=s.getContext('2d');ctx.clearRect(0,0,ww,hh);
  ctx.drawImage(PRV.r.domElement,0,0,ww,hh,0,0,ww,hh);
  return s.toDataURL('image/png');
 }
};

/* Tone mapping — what happens to light values ABOVE 1.0.
   Without it (r128 defaults to NoToneMapping) anything brighter than white clips flat: a
   spot pool, an emissive sign and a goal flash all land on the same white, so brightness
   stops carrying information and the image reads as a raw WebGL demo. It is also the other
   half of KHR_materials_emissive_strength support (models.js) — a strength of 4 has nowhere
   to go without a curve to roll it off.
   Changing toneMapping edits a shader define, so every material needs a recompile; this is
   called once from initThree, and again only if something actually changes it at runtime.
   CONFIG.render.toneMapping:'none' restores the previous look exactly. */
const TONEMAP={none:THREE.NoToneMapping,linear:THREE.LinearToneMapping,reinhard:THREE.ReinhardToneMapping,
  cineon:THREE.CineonToneMapping,aces:THREE.ACESFilmicToneMapping};
function toneMapMode(){const R=(typeof CONFIG!=='undefined'&&CONFIG.render)||{};
 const m=TONEMAP[R.toneMapping];return m===undefined?THREE.ACESFilmicToneMapping:m;}
function applyToneMapping(r,recompile){
 if(!r)return;
 const R=(typeof CONFIG!=='undefined'&&CONFIG.render)||{};
 const tm=toneMapMode(),ex=(R.exposure===undefined?1:R.exposure);
 const changed=(r.toneMapping!==tm);
 r.toneMapping=tm;r.toneMappingExposure=ex;              // exposure is a uniform — free to change any time
 if(changed&&recompile&&scene)scene.traverse(o=>{const m=o.material;if(!m)return;
  (Array.isArray(m)?m:[m]).forEach(x=>{if(x)x.needsUpdate=true;});});
}
function initThree(){
 renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.setSize(innerWidth,innerHeight);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=shadowMapType();
 renderer.outputEncoding=THREE.sRGBEncoding;
 applyToneMapping(renderer,false);   // set before any material exists, so nothing needs recompiling
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,1,700);
 camera.position.set(0,92,86);camera.lookAt(0,0,2);
 hemiLight=new THREE.HemisphereLight(0xcdd9ff,0x1c1610,.85);scene.add(hemiLight); // colours/intensity set per-room by applyRoom
 dirLight=new THREE.DirectionalLight(0xffffff,1.05);
 dirLight.position.set(45,100,35);dirLight.castShadow=true;
 /* bias/normalBias fight shadow acne — both were 0 (three.js defaults, never set). The extents
    were 160x140 for a table spanning ~138x68 incl. goal depth, so most of the shadow map was
    spent on empty space — but the box is ROTATED to the table, so the short axis cannot be
    tightened to the table's width; see the extents comment in config.js before touching it.
    Room meshes are castShadow=false, so nothing outside the table casts.
    Map size, filter and bias come from the ACTIVE quality tier (see shadowQ below), so a saved
    High is live on the very first frame rather than being switched in a moment later — which
    would recompile every material that exists by then, at boot, for nothing. */
 const SH=shadowQ();
 dirLight.shadow.mapSize.setScalar(SH.mapSize||2048);
 dirLight.shadow.bias=SH.bias;dirLight.shadow.normalBias=SH.normalBias;dirLight.shadow.radius=SH.radius;
 const sc=dirLight.shadow.camera;sc.left=SH.left;sc.right=SH.right;sc.top=SH.top;sc.bottom=SH.bottom;sc.far=SH.far;
 _dispShadowQ=shadowQLevel();   // the light now matches this tier — applyDisplay's first run has nothing to do
 scene.add(dirLight);
 // Shadow-map freeze. The pass re-draws every caster (all 22 figurines included) every frame,
 // for a map that is camera-INDEPENDENT — so in the menus, the room editor and photo mode it
 // re-renders an identical result forever. autoUpdate off + an explicit shadowDirty() from the
 // things that actually move casters. needsUpdate is armed once here so the first frame is lit.
 renderer.shadowMap.autoUpdate=(SH.autoUpdate===true);
 if(!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;
 teamMat[0]=new THREE.MeshStandardMaterial({color:cfg.redColor,roughness:.45,metalness:.15});
 teamMat[1]=new THREE.MeshStandardMaterial({color:cfg.blueColor,roughness:.45,metalness:.15});
 teamGlow[0]=new THREE.MeshStandardMaterial({color:cfg.redColor,emissive:cfg.redColor,emissiveIntensity:.55,roughness:.4});
  teamGlow[1]=new THREE.MeshStandardMaterial({color:cfg.blueColor,emissive:cfg.blueColor,emissiveIntensity:.55,roughness:.4});
  buildTable();buildArenaTable();buildGround();buildFxPools();buildFxLightPool();buildRoomLightPool();buildBallReflect();
  scene.environment=bakeSyntheticEnv(CONFIG.rooms.open.env);   // seed a neutral reflection env so metals aren't black before applyRoom runs
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderDirty();});
  applyDisplay();   // apply saved Display settings (render scale / shadows) at boot
}

/* Shadow-map filter. PCFSoft is a 9-tap per-fragment filter run by every RECEIVER, so its cost
   scales with how much screen the table fills — which is exactly the case that was slow. */
const SHADOW_TYPES={pcfsoft:THREE.PCFSoftShadowMap,pcf:THREE.PCFShadowMap,basic:THREE.BasicShadowMap,
 vsm:THREE.VSMShadowMap};
/* THE ACTIVE SHADOW TUNING. CONFIG.render.shadow holds what every tier shares (the camera
   extents, the far plane, the freeze); CONFIG.render.shadow.quality.<low|high> overrides the
   handful of values the Display setting actually moves. Resolved in ONE place so initThree and
   applyDisplay can never disagree about what High means, and so a tier that omits a key simply
   inherits the base rather than silently reading undefined. */
const SHADOW_BASE={bias:-0.0002,normalBias:0.35,radius:1,left:-76,right:76,top:46,bottom:-46,far:260,
 type:'pcfsoft',mapSize:2048,autoUpdate:false};
function shadowQLevel(){return (typeof cfg!=='undefined'&&cfg.shadowQuality==='high')?'high':'low';}
function shadowQ(){
 const S=(typeof CONFIG!=='undefined'&&CONFIG.render&&CONFIG.render.shadow)||{};
 return Object.assign({},SHADOW_BASE,S,(S.quality&&S.quality[shadowQLevel()])||{});
}
function shadowMapType(){const k=String(shadowQ().type||'pcfsoft').toLowerCase();
 const t=SHADOW_TYPES[k];return t===undefined?THREE.PCFSoftShadowMap:t;}
/* ===== KTX2 / BASIS TEXTURES ==============================================
   A PNG or a JPEG is compressed ON DISK and completely UNCOMPRESSED IN VRAM: the browser decodes
   it to raw pixels and three uploads that, so a 2048² albedo costs 21.3MB on the card whatever the
   file weighs, and the decode is main-thread work landing exactly when a room or a match is trying
   to load. A KTX2/Basis texture stays compressed the whole way — the transcoder turns it into
   whatever block format this GPU actually has (ASTC, BC7, ETC2, BC1…) and that is what gets
   uploaded. MEASURED on this project's own assets: a flat 4x VRAM cut (arcade room 157.3 -> 39.4MB,
   pub 166.5 -> 41.6MB, a figurine 21.3 -> 5.3MB) and the transcode runs in a WORKER, which is the
   half that fixes the boot freeze rather than merely the memory budget.

   THE LOADER IS NOT r128's, AND THAT IS DELIBERATE. r128 predates KTX2Loader entirely — it ships
   only BasisTextureLoader, which reads bare .basis files and cannot open a KTX2 container. So
   vendor/ carries r137's KTX2Loader + WorkerPool + basis transcoder, which reference only THREE
   symbols r128 has. r128's own GLTFLoader ALREADY implements KHR_texture_basisu and setKTX2Loader,
   so nothing in the loader chain needed patching. See vendor/basis/README.md.

   EVERY GLTFLoader IN THE GAME MUST COME FROM newGLTF(). A plain `new THREE.GLTFLoader()` has no
   ktx2Loader, and GLTFLoader THROWS on a file whose KHR_texture_basisu is required — which is what
   the encoder writes, because a KTX2 asset with a silent PNG fallback is just both files shipped.
   One helper, so a new call site cannot quietly opt out.

   Encoding is a content step, not a runtime one: tools/ktx2-encode.mjs. */
let _ktx2=null,_ktx2Tried=false;
function ktx2Support(){
 if(!renderer||!renderer.extensions)return null;
 const e=renderer.extensions;
 return{astc:!!e.has('WEBGL_compressed_texture_astc'),bptc:!!e.has('EXT_texture_compression_bptc'),
        s3tc:!!e.has('WEBGL_compressed_texture_s3tc'),etc2:!!e.has('WEBGL_compressed_texture_etc'),
        etc1:!!e.has('WEBGL_compressed_texture_etc1'),pvrtc:!!e.has('WEBGL_compressed_texture_pvrtc')};
}
/* The one shared KTX2Loader. Lazy because detectSupport() needs the renderer, and every loader in
   the game is built long after initThree — but built ONCE, because it owns a worker pool. */
function ktx2Loader(){
 if(_ktx2Tried)return _ktx2;
 _ktx2Tried=true;
 if(typeof THREE.KTX2Loader!=='function'||!renderer){
  console.warn('KTX2Loader unavailable — KTX2 textures will not load. Check vendor/KTX2Loader.js and vendor/WorkerPool.js.');
  return _ktx2=null;
 }
 const s=ktx2Support();
 // Every WebGL2 device has at least one of these; none at all means the transcoder has no target
 // and every KTX2 texture will fail. Worth saying out loud rather than debugging as "black models".
 if(s&&!(s.astc||s.bptc||s.s3tc||s.etc2||s.etc1||s.pvrtc))
  console.warn('KTX2: this GPU exposes NO compressed texture format — KTX2 assets cannot be transcoded here.');
 try{
  _ktx2=new THREE.KTX2Loader().setTranscoderPath('vendor/basis/').detectSupport(renderer);
  console.log('KTX2 ready — GPU formats: '+Object.keys(s||{}).filter(k=>s[k]).join(', '));
 }catch(e){console.warn('KTX2Loader init failed',e);_ktx2=null;}
 return _ktx2;
}
/* THE ONLY WAY TO MAKE A GLTFLoader IN THIS PROJECT. See the block above. */
function newGLTF(){
 const g=new THREE.GLTFLoader();
 const k=ktx2Loader();
 if(k)g.setKTX2Loader(k);
 return g;
}

/* Mark the shadow map stale — call whenever something that CASTS has moved or been rebuilt.
   A no-op when autoUpdate is on (three.js is already re-rendering it every frame), so it is
   always safe to call and the config switch stays a true off switch.
   It ALSO marks the frame itself dirty (see the idle gate below): every caller of this is, by
   definition, something that changed what the scene looks like, so the idle throttle inherits
   the whole existing hook set — applyRoom, applySkin, rebuildRodMen, buildRoomProps, the sim
   step, replay playback — without any of them being touched. */
/* DROP A LIGHT'S SHADOW MAP so three re-allocates it. This is the only way a new mapSize or a
   new shadowMap.type ever takes effect: three builds the map once, in a `shadow.map === null`
   branch, and reuses it forever after. `mapPass` is VSM's gaussian blur target, allocated beside
   the map in that same branch and REASSIGNED rather than disposed — so dropping the map without
   it leaks a whole render target per call. One helper because this is needed from two files
   (here for the quality tiers, js/photo.js for its capture-resolution boost) and the mapPass
   half is exactly the sort of thing the second caller forgets. */
function shadowMapDrop(sh){
 if(!sh)return;
 if(sh.map){sh.map.dispose();sh.map=null;}
 if(sh.mapPass){sh.mapPass.dispose();sh.mapPass=null;}
}
function shadowDirty(){if(renderer&&!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;renderDirty();}

/* ===== IDLE-RENDER GATE (the menus) =======================================
   THE MENUS WERE RENDERING THE ENTIRE GAME, EVERY FRAME, BEHIND AN OPAQUE PANEL. `loop()` ended
   in an unconditional renderer.render with no phase test, and boot() builds the rods, the table
   and the room BEFORE the first menu is shown — so #home, Kick Off, the league lobby, Options and
   every other screen sat on top of a live ~267-draw scene with a shadow pass and 22 figurines.
   And `.screen` in css/styles.css is `rgba(7,9,15,.94)` at its 70% stop PLUS `backdrop-filter:
   blur(6px)`: what all that work bought was a blurred smudge in the corners. Worse, the frame
   budget was already spent when a venue swap wanted it, which is most of why the swap read as a
   freeze rather than as a load.

   THIS IS A THROTTLE, NOT AN OFF SWITCH, AND THAT IS THE WHOLE DESIGN. A pure dirty-flag is one
   missed hook away from a stale frame that looks exactly like a crash, and the hooks are spread
   over six files. So: any change buys `settle` seconds at FULL frame rate (nothing hitches while
   something you can see is moving), and the floor is `hz`, not zero — whatever we forgot to mark
   self-heals within 1/hz. At the default 4Hz the menu costs about 7% of what it did, and the
   failure mode of a missing hook is a quarter-second of staleness behind a 94% veil.

   WHAT COUNTS AS A CHANGE: renderDirty(), which shadowDirty() calls for free. Camera movement is
   DETECTED here rather than hooked, because cameraUpdate lerps continuously and there is no one
   moment it "changes".

   IT NEVER SKIPS a live phase, the room editor, photo mode, free roam, or the debug overlay —
   every one of those is someone looking at the scene itself rather than at a menu over it. The
   customize turntable, the menu figurine thumbnails and the league-setup preview are safe by
   construction: they draw on the SEPARATE offscreen renderer (PRV, above), which this never
   touches. */
let _idleT=1e9,_idleAcc=0;
const _idleCam=new THREE.Vector3(),_idleQuat=new THREE.Quaternion();
function renderDirty(){_idleT=0;}
function renderIdleSkip(rdt){
 const I=(CONFIG.render&&CONFIG.render.idle)||{};
 if(I.on===false||!renderer||!camera)return false;
 if((I.phases||['menu']).indexOf(S.phase)<0)return false;
 if(S.redit||S.photo||S.freeRoam)return false;
 if(typeof dbgOn!=='undefined'&&dbgOn)return false;
 // The frame profiler (M) turns renderer.info.autoReset OFF and accumulates per frame, so a
 // skipped render would report the previous frame's draw/tri forever. You opened it to measure
 // the real cost of a frame; give it real frames.
 if(typeof PERF!=='undefined'&&PERF&&PERF.on)return false;
 // EPSILON, NOT EQUALITY, and this is the difference between the throttle working and never
 // engaging at all. cameraUpdate LERPS toward a fixed target, and `a+(b-a)*k` ASYMPTOTES: the
 // last few hundred frames differ only in the bottom bits of the mantissa, so an exact compare
 // reads "the camera is still moving" essentially forever and every frame is drawn. Measured in
 // a headless run before this: 100% of menu frames rendered with the gate nominally on.
 // TWO thresholds, because the units are not comparable: camEps is WORLD UNITS and camRotEps is
 // raw quaternion components. Both defaults are sized from screen motion at the match camera —
 // the table spans ~0.09 units per pixel at 1080p, and a quaternion component moves ~114 degrees
 // per unit against ~0.05 degrees per pixel — so each is a fraction of a pixel. Nothing anyone
 // could see is ever held on a stale frame; what they buy is the tail of the lerp, which is
 // hundreds of frames of identical-looking output.
 const P=camera.position,Q=camera.quaternion,
       E=I.camEps===undefined?0.01:I.camEps, R=I.camRotEps===undefined?1e-4:I.camRotEps;
 if(Math.abs(P.x-_idleCam.x)>E||Math.abs(P.y-_idleCam.y)>E||Math.abs(P.z-_idleCam.z)>E||
    Math.abs(Q.x-_idleQuat.x)>R||Math.abs(Q.y-_idleQuat.y)>R||
    Math.abs(Q.z-_idleQuat.z)>R||Math.abs(Q.w-_idleQuat.w)>R){
  _idleCam.copy(P);_idleQuat.copy(Q);renderDirty();
 }
 /* DELIBERATELY NOT TESTED HERE: renderer.shadowMap.needsUpdate. It reads like the obvious extra
    safety net and it is a TRAP — r128's WebGLShadowMap.render() bails on `enabled === false`
    BEFORE it clears the flag, so with Options -> Display -> Shadows OFF the flag latches true the
    first time anything calls shadowDirty() and never comes down again. Reading it there marks
    every single frame dirty, and the throttle silently does nothing for every player who turned
    shadows off — measured as 100% of menu frames still rendering. Nothing is lost by dropping it:
    shadowDirty() calls renderDirty() UNCONDITIONALLY, outside its own autoUpdate guard, so the
    CONFIG.render.shadow.autoUpdate:true path this was meant to cover is already covered. */
 _idleT+=rdt;
 if(_idleT<(I.settle===undefined?0.4:I.settle)){_idleAcc=0;return false;}
 const hz=I.hz===undefined?4:I.hz;
 if(hz<=0)return true;                        // 0 = hold the last frame indefinitely
 _idleAcc+=rdt;
 if(_idleAcc>=1/hz){_idleAcc=0;return false;}
 return true;
}

/* Display settings (Options → Display), applied live. Two levers here:
   • renderScale multiplies the effective device pixel ratio — the renderer draws fewer internal
     pixels and the canvas is upscaled to fill the screen. Integrated GPUs are fill-rate bound, so
     this is close to a linear fps gain and the single biggest knob on weak hardware.
   • shadows toggles the directional light's shadow-map PASS (the per-frame cost), not just whether
     surfaces receive it. Flipping shadowMap.enabled changes material shader defines, so every
     material needs a one-time recompile on the change — done here, and ONLY when it actually
     changes (tracked in _dispShadows), so re-applying render scale alone never triggers it.
   • shadowQuality swaps the map size, the filter, the bias and HOW MUCH OF EACH FIGURINE CASTS
     for the tier in CONFIG.render.shadow.quality. The filter is another shader define, so it
     rides the SAME one-time recompile rather than paying a second one, and the map has to be
     thrown away for a new size to take — three.js allocates it once and reuses it forever
     otherwise.
   Reflections + fps-cap live elsewhere (refreshBallReflect / the main loop). */
let _dispShadows=true;   // matches initThree's shadowMap.enabled=true starting state
let _dispShadowQ=null;   // set by initThree to the tier the light was built with
function applyDisplay(){
 if(!renderer)return;
 const rs=clamp(cfg.renderScale||1,0.4,1);
 renderer.setPixelRatio(Math.min(devicePixelRatio,2)*rs);
 renderer.setSize(innerWidth,innerHeight);
 renderDirty();   // the drawing buffer was just resized — the held idle frame is the wrong size
 let recompile=false,redraw=false;
 const sh=cfg.shadows!==false;
 if(sh!==_dispShadows){
  renderer.shadowMap.enabled=sh;
  if(dirLight)dirLight.castShadow=sh;
  _keyDirSh=null;   // Display owns castShadow now; drop the room latch so the next applyRoom re-decides
  _dispShadows=sh;recompile=true;redraw=true;
 }
 const q=shadowQLevel();
 if(q!==_dispShadowQ){
  const S=shadowQ(),t=shadowMapType();
  if(dirLight&&dirLight.shadow){
   const d=dirLight.shadow;
   /* THROW THE MAP AWAY WHEN THE SIZE **OR THE TYPE** MOVES, and the type case is the one that
      bites. three allocates the map — and, for VSM only, the `mapPass` blur target beside it —
      inside a single `shadow.map === null` branch, picking the filter from the type (Linear for
      VSM, Nearest for everything else). Switch to VSM while a PCF map is still live and that
      branch never runs: the blur then renders into an undefined target, against a map with the
      wrong filter. Dropping both here is what forces the correct pair to be rebuilt. */
   if(d.mapSize.x!==S.mapSize||renderer.shadowMap.type!==t){
    d.mapSize.setScalar(S.mapSize);
    shadowMapDrop(d);
   }
   /* Plain uniforms, read by the receiving shader — no map redraw, no recompile. `radius` means
      the same thing to both techniques (blur half-width in texels): it scales PCF's 17 tap
      offsets, and it is fed straight to VSM's gaussian blur pass. */
   d.bias=S.bias;d.normalBias=S.normalBias;d.radius=S.radius;
  }
  if(renderer.shadowMap.type!==t){renderer.shadowMap.type=t;recompile=true;}
  /* Low casts the silhouette mesh alone; High casts every part, so the hair and the head reach
     the ground shadow. A draw-list change only, so it rides along here for nothing. */
  refreshShadowCasters();
  _dispShadowQ=q;redraw=true;
 }
 // The map is frozen (autoUpdate off), so a discarded or newly-enabled map stays blank until
 // something asks for it — this is that ask.
 if(redraw)renderer.shadowMap.needsUpdate=true;
 if(recompile&&scene)scene.traverse(o=>{const m=o.material;if(!m)return;
  (Array.isArray(m)?m:[m]).forEach(mm=>{if(mm)mm.needsUpdate=true;});});
}

/* Scene fog (Options -> Display -> Fog), applied live.
   WHETHER A SCENE HAS FOG IS A SHADER DEFINE (USE_FOG), not a uniform — so turning it off is not
   a case of setting a distance to infinity, and flipping it recompiles every material in the
   scene. That is the same cost the shadows toggle above pays, so it is paid the same way: one
   function owns it, and the recompile fires ONLY when the state actually moves. applyRoom calls
   this on every venue change, where the near/far come from the room and nothing has toggled, so
   the common path never recompiles anything.

   Fog OFF is a real look, not just a perf lever: it is what lets you see a room's far wall and
   the props out at its edges, which is most of what a room is. The room editor's fog near/far
   boxes write scene.fog directly and are already null-guarded, so they simply do nothing while
   this is off. */
let _dispFog=true;   // matches the fog-on starting state (cfg.fog defaults true)
function applyFog(){
 if(!scene)return;
 const on=cfg.fog!==false, rm=activeRoom||CONFIG.rooms.open;
 if(on){
  const f=rm.fog||[200,430];
  // Rebuilt rather than mutated, because turning fog back on finds scene.fog null.
  if(scene.fog){scene.fog.color.set(rm.bg);scene.fog.near=f[0];scene.fog.far=f[1];}
  else scene.fog=new THREE.Fog(rm.bg,f[0],f[1]);
 }else scene.fog=null;
 renderDirty();
 if(on!==_dispFog){
  scene.traverse(o=>{const m=o.material;if(!m)return;
   (Array.isArray(m)?m:[m]).forEach(mm=>{if(mm)mm.needsUpdate=true;});});
  _dispFog=on;
 }
}

/* Reflection env-maps (PMREM). scene.environment feeds EVERY MeshStandardMaterial — balls
   (esp. the metallic golden), the table, the players — soft image-based lighting + reflections;
   without one, fully-metallic materials render black. Two bakers, both routed through applyRoom:
     • bakeSyntheticEnv — a room's `env` spec (coloured panels in a dark shell). Cheap, static.
       Used when a room has no glb, when reflect is off, or when cfg.reflections is off.
     • bakeGlbEnv — real reflections baked FROM a room's backdrop GLB. Used when the room
       reflects AND cfg.reflections is on. */
function pmrem(){return pmremGen||(pmremGen=new THREE.PMREMGenerator(renderer));}
/* PMREM's fromScene returns a RENDER TARGET, not a texture, and the difference is a leak.
   Both bakers below used to take `.texture` and drop the target on the floor — but a render
   target owns a framebuffer and its attachments, and freeing the texture alone does NOT free
   them: `WebGLRenderTarget.dispose()` is what runs deallocateRenderTarget. Measured, that cost
   ONE leaked target per env bake, i.e. one per visit to any room with a glb, unbounded for the
   session (renderer.info.memory.textures climbed +1 per room round trip and never came down).
   So the target is stashed on the texture and envDispose() is the only correct way to free a
   cached env map. Bakes are cached in roomEnvCache, so the stash rides along with the entry. */
function envKeep(rt){const t=rt&&rt.texture;if(t){if(!t.userData)t.userData={};t.userData.__pmremRT=rt;}return t||null;}   // PMREM's internal target texture can arrive without userData
function envDispose(tex){
 if(!tex)return;
 const rt=tex.userData&&tex.userData.__pmremRT;
 if(rt&&rt.dispose)rt.dispose();   // frees the framebuffer AND its texture
 else if(tex.dispose)tex.dispose();
}
/* ---- baked-env residency (LRU) ------------------------------------------
   THE BAKE OUTLIVES THE ROOM NOW, AND IT SHOULD. A room GLB is 20-45MB of geometry and texture;
   the PMREM bake OF it is one ~6MB render target that holds no reference back to the group it was
   baked from. disposeRoom used to free BOTH, which read as tidy bookkeeping and was the expensive
   half of a room switch: an A/B room toggle — the single most common thing anyone does with a room
   picker — re-parsed the GLB *and* re-ran a full PMREM pass (six scene renders plus the blur
   convolution chain) every single time, to reproduce a texture that had not changed. Freeing the
   45MB and keeping the 6MB is the trade; it was the wrong way round.

   BOUNDED BY ITS OWN LRU rather than left to grow, because "these are small, keep them all" is how
   a residency budget stops being one — and CONFIG.tableAssets exists to say residency is a budget.
   cacheEnvs counts ENTRIES, the active one is always protected, and both bake kinds share the list:
   a synthetic bake is much cheaper to recreate, but it is also much cheaper to hold, so there is
   nothing to gain from special-casing it.

   COUNTING ENTRIES MEANS A ROOM CAN OCCUPY TWO SLOTS — its `glb:` bake and the `syn:` stand-in it
   showed while the GLB was downloading — so the cap is sized rooms x 2 and NOT rooms. Sized per
   room it thrashes, and thrashing here is indistinguishable from not having the cache at all:
   measured at a cap of 4, six swaps across three rooms re-baked all three.

   Frees through envDispose(), never tex.dispose() — a PMREM bake is a RENDER TARGET and freeing
   its texture alone leaves the framebuffer allocated (see envKeep above). That was a measured,
   unbounded leak once; moving where the free happens must not lose the lesson.

   NOTE FOR memTex(): a cached bake is NOT in the scene graph, so the texture audit cannot see it.
   memLog prints the env list beside skins/rooms instead. */
const envOrder=[];   // roomEnvCache keys, least-recently-used first
function touchEnv(k){const i=envOrder.indexOf(k);if(i>=0)envOrder.splice(i,1);envOrder.push(k);}
/* Evict bakes past the cap, LRU first. Measured as "how many NON-kept entries may stay", the same
   way pruneSkins/pruneRooms are, so cacheEnvs:1 legally means "never hold one you aren't using". */
function pruneEnvs(keepKey){
 const cap=Math.max(1,((CONFIG.tableAssets||{}).cacheEnvs)||4);
 const extra=Math.max(0,cap-1);
 let n=0;for(const k of envOrder)if(k!==keepKey)n++;
 for(let i=0;i<envOrder.length&&n>extra;){
  const k=envOrder[i];
  if(k===keepKey){i++;continue;}
  if(roomEnvCache[k])envDispose(roomEnvCache[k]);
  delete roomEnvCache[k];envOrder.splice(i,1);n--;
  console.log('room env freed: '+k);
 }
}
function bakeSyntheticEnv(spec){
 if(!renderer)return null;
 const es=new THREE.Scene();
 es.add(new THREE.Mesh(new THREE.BoxGeometry(560,320,560),                       // dark room shell
  new THREE.MeshBasicMaterial({color:(spec&&spec.shell)||0x0b1022,side:THREE.BackSide})));
 if(spec&&spec.panels)for(const p of spec.panels){                               // [hex,x,y,z,w,h] coloured glow panels
  const m=new THREE.Mesh(new THREE.PlaneGeometry(p[4],p[5]),new THREE.MeshBasicMaterial({color:p[0],side:THREE.DoubleSide}));
  m.position.set(p[1],p[2],p[3]);m.lookAt(0,0,0);es.add(m);
 }
 const tex=envKeep(pmrem().fromScene(es,0.02,1,1200));                           // sigma small; near/far cover the 560-unit shell
 es.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
 return tex;
}
/* Bake from the actual room model: temporarily reparent the backdrop group into an isolated
   scene (with an ambient fill so non-emissive surfaces register), bake, then move it back. This
   is synchronous — no frame renders in between — so the on-screen group is undisturbed. */
function bakeGlbEnv(group){
 if(!renderer||!group)return null;
 const parent=group.parent,vis=group.visible;
 const es=new THREE.Scene();
 es.add(new THREE.HemisphereLight(0xffffff,0x404040,1.0));
 group.visible=true;es.add(group);                                              // move out of the main scene (Object3D has one parent)
 // Hide transparent/transmissive meshes (glass etc.) for the bake: three's PMREM pass has no
 // transmission render and nothing behind them, so they bake as solid WHITE blobs that flood
 // scene.environment and wash the whole scene. Glass barely reads in a reflection anyway.
 // All restored right after the bake, so the room on screen is untouched.
 const hidden=[];
 group.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
  if(o.visible&&ms.some(m=>m&&(m.transmission>0||(m.transparent&&m.opacity<1)))){hidden.push(o);o.visible=false;}});
 const tex=envKeep(pmrem().fromScene(es,0.04,1,1200));
 for(const o of hidden)o.visible=true;                                          // restore
 if(parent)parent.add(group);else scene.add(group);                             // move it back
 group.visible=vis;
 return tex;
}

/* Per-room switches for the two KEY lights and the image-based light — the three that are not
   in any pool, and the ones an indoor room most often wants rid of (there is no sun in a pub).

   THE OFF HAS TO BE `visible=false`, NOT `int:0`. Measured: a light at intensity 0 stays in the
   scene's light COUNT and runs its whole shader path per fragment before multiplying by zero —
   flipping intensity recompiled NOTHING (0 shaders) and saved nothing. Making it invisible took
   it out of the count and recompiled 22 shaders. That recompile is the price of a real off.

   AND IT IS PAID ONCE PER CONFIGURATION, NOT PER TOGGLE, which is what makes this cheap enough
   to put on a checkbox: three.js caches programs by their parameters, so switching back reused
   the cached set and recompiled 0. Latched here anyway (the applyFog/applyDisplay pattern) so
   re-applying the same room — which applyRoom does on every venue change — costs nothing. */
let _keyHemi=null,_keyDir=null,_keyDirSh=null,_keyIbl=null;
function applyRoomKeyLights(rm){
 const hOn=!(rm&&rm.hemi&&rm.hemi.on===false);
 const dOn=!(rm&&rm.dir&&rm.dir.on===false);
 // The sun casts unless the room says otherwise — but never while the Display shadow toggle is
 // off, or we would re-arm the pass that setting exists to stop.
 const dSh=dOn&&!(rm&&rm.dir&&rm.dir.shadow===false)&&cfg.shadows!==false;
 const iblOn=!(rm&&rm.ibl===false);
 let moved=false;
 if(hemiLight&&hOn!==_keyHemi){hemiLight.visible=hOn;_keyHemi=hOn;moved=true;}
 if(dirLight&&dOn!==_keyDir){dirLight.visible=dOn;_keyDir=dOn;moved=true;}
 if(dirLight&&dSh!==_keyDirSh){dirLight.castShadow=dSh;_keyDirSh=dSh;moved=true;}
 if(iblOn!==_keyIbl){_keyIbl=iblOn;moved=true;}
 if(!iblOn)scene.environment=null;   // setRoomEnv re-sets it when the room allows one
 if(moved){
  scene.traverse(o=>{const m=o.material;if(!m)return;
   (Array.isArray(m)?m:[m]).forEach(mm=>{if(mm)mm.needsUpdate=true;});});
  shadowDirty();
 }
}
/* True when this room allows an image-based light at all — setRoomEnv asks before assigning. */
function roomIblOn(rm){return !(rm&&rm.ibl===false);}
/* Local ball reflections. A single shared cube camera rides the lead ball and renders the REAL
   scene around it into a low-res cube target, reused as `envMap` on every ball material — so a
   metallic ball reflects the table/pitch/men it's actually among, not just the distant room bake
   (scene.environment). One extra scene pass per (throttled) frame; shadow auto-update is frozen
   for it so the 6 faces reuse the previous frame's shadow map instead of re-rendering it 6×.
   All knobs in CONFIG.ballReflect; the whole thing no-ops when cfg.reflections is off. */
let ballCubeRT=null,ballCube=null,ballReflN=0;
function buildBallReflect(){
 if(!renderer||ballCubeRT)return;
 const R=CONFIG.ballReflect;
 ballCubeRT=new THREE.WebGLCubeRenderTarget(R.res,{format:THREE.RGBAFormat,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
 ballCubeRT.texture.encoding=THREE.sRGBEncoding;                                // renderer outputs sRGB → decode env the same way (matches PMREM path)
 ballCube=new THREE.CubeCamera(R.near,R.far,ballCubeRT);
}
function ballReflectOn(){return !!(renderer&&ballCubeRT&&cfg.reflections&&CONFIG.ballReflect.on);}
// set (or clear, env=null) the cube envMap on every mesh material under a ball; needsUpdate only
// flips on an actual change (null↔texture recompiles the shader, so we do it once, at ball birth).
// envMapIntensity is NOT ours to keep: with envMap null the material falls back to scene.environment
// and that same scalar still weights it, so the authored value is stashed once per material and put
// back on the clearing path — else switching Reflections OFF would light the ball off the room bake
// at the CUBE map's intensity (silent while intensity is 1, a brightness jump the moment it isn't).
function setBallEnv(b,env){
 b.m.traverse(o=>{if(!o.isMesh)return;const ms=Array.isArray(o.material)?o.material:[o.material];
  for(const m of ms){if(!m||m.envMap===env)continue;
   if(m.userData.baseEnvI===undefined)m.userData.baseEnvI=m.envMapIntensity;
   m.envMap=env;m.envMapIntensity=env?CONFIG.ballReflect.intensity:m.userData.baseEnvI;m.needsUpdate=true;}});
}
function applyBallEnv(b){setBallEnv(b,ballReflectOn()?ballCubeRT.texture:null);}   // called from makeBall
function refreshBallReflect(){if(!ballCubeRT)return;const env=ballReflectOn()?ballCubeRT.texture:null;for(const b of S.balls)setBallEnv(b,env);} // Options toggle
function updateBallReflect(){
 if(!ballReflectOn()||!S.balls.length)return;
 if(S.phase!=='play'&&S.phase!=='goal'&&S.phase!=='count')return;               // only while live balls are the visible reflectors
 if(++ballReflN%CONFIG.ballReflect.every)return;                                // throttle whole-cube updates
 let lead=S.balls[0],bd=1e30;                                                   // lead = ball nearest the camera (its reflection is the one the player sees)
 for(const b of S.balls){const d=b.m.position.distanceToSquared(camera.position);if(d<bd){bd=d;lead=b;}}
 // THE SHADOW PASS MUST BE FULLY SUPPRESSED HERE, AND autoUpdate ALONE DOES NOT DO IT — that is
 // what made the ball's own shadow strobe on and off at exactly every other frame. r128's shadow
 // pass early-outs on `autoUpdate===false && needsUpdate===false` and clears needsUpdate whenever
 // it DOES run, so under the frozen-map model (CONFIG.render.shadow.autoUpdate:false) needsUpdate
 // is the only gate — and the update this frame's shadowDirty() raised was CONSUMED by cube face
 // 1, which renders with the lead ball hidden one line below. The main pass then skipped, drawing
 // a map with no ball in it; the next frame runs no cube pass and the shadow came back. Both flags
 // go down for the 6 faces, and needsUpdate is handed BACK to the main render, which draws it with
 // the ball present. Same cost as before: still exactly one shadow render per frame.
 const sa=renderer.shadowMap.autoUpdate,sn=renderer.shadowMap.needsUpdate;
 renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;      // 6 faces reuse the map already on the card
 const vis=lead.m.visible;lead.m.visible=false;                                 // don't let the ball reflect itself
 ballCube.position.copy(lead.m.position);ballCube.update(renderer,scene);
 lead.m.visible=vis;renderer.shadowMap.autoUpdate=sa;renderer.shadowMap.needsUpdate=sn;
}

function buildTable(){
 // primitive table lives in primTable so a loaded GLB table can hide it wholesale (see models.js).
 primTable=new THREE.Group();scene.add(primTable);tableGroups.classic=primTable;
 const fieldMat=new THREE.MeshStandardMaterial({roughness:.85});
 fieldMesh=new THREE.Mesh(new THREE.PlaneGeometry(F.L,F.W),fieldMat);
 fieldMesh.rotation.x=-Math.PI/2;fieldMesh.receiveShadow=true;primTable.add(fieldMesh);
  // Load ONLY the active pitch's texture (was: all ~7 up front, decoding every image into
  // RAM for the one shown). The rest come in on demand via drawField→loadPitchTex.
  // Only when this pitch has no GLB. With one, drawField shows the real thing and the JPEG would
  // be a second full-size download for a plane that is about to be hidden.
  if(!(CONFIG.pitches[cfg.pitch]&&CONFIG.pitches[cfg.pitch].glb))
   loadPitchTex(cfg.pitch,tex=>{if(tex&&fieldMesh){fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;}});
 wallMat=new THREE.MeshStandardMaterial({color:0x7a4b22,roughness:.6,metalness:.1});
 const body=new THREE.Mesh(new THREE.BoxGeometry(F.L+10,10,F.W+10),wallMat);
 body.position.y=-5.2;body.receiveShadow=true;primTable.add(body);
 const legG=new THREE.BoxGeometry(4,34,4);
 [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(s=>{const l=new THREE.Mesh(legG,wallMat);l.position.set(s[0]*(F.L/2-2),-27,s[1]*(F.W/2-2));primTable.add(l);});
 const swG=new THREE.BoxGeometry(F.L+10,F.wallH+2,3);
 [-1,1].forEach(s=>{const w=new THREE.Mesh(swG,wallMat);w.position.set(0,(F.wallH+2)/2-1,s*(F.W/2+1.5));w.castShadow=true;w.receiveShadow=true;primTable.add(w);});
 const segW=(F.W-2*F.goalHalf)/2;
 const ewG=new THREE.BoxGeometry(3,F.wallH+2,segW);
 [-1,1].forEach(sx=>{[-1,1].forEach(sz=>{const w=new THREE.Mesh(ewG,wallMat);
  w.position.set(sx*(F.L/2+1.5),(F.wallH+2)/2-1,sz*(F.goalHalf+segW/2));w.castShadow=true;primTable.add(w);});});
 ledMat=primLedMat=new THREE.MeshStandardMaterial({color:0x38e0ff,emissive:0x38e0ff,emissiveIntensity:1.1,roughness:.4});
 const stripG=new THREE.BoxGeometry(F.L+10,.7,.7);
 [-1,1].forEach(s=>{const st=new THREE.Mesh(stripG,ledMat);st.position.set(0,F.wallH+1.15,s*(F.W/2+1.5));primTable.add(st);});
 // ---- goal cages: round posts + crossbar + back frame + diamond-mesh net, on the goal line x=±L/2 ----
 const netTex=makeNetTex();
 [-1,1].forEach((sx,i)=>{
  const g=new THREE.Group();g.position.set(sx*(F.L/2),0,0);   // group sits ON the goal line; net extends outward
  const GH=F.goalH,GHW=F.goalHalf,GD=F.goalDepth,PR=.6;
  const frameM=new THREE.MeshStandardMaterial({color:0xf2f5ff,emissive:0xcdd8ff,emissiveIntensity:.25,roughness:.35,metalness:.65});
  // front posts + crossbar live in their own sub-group so a table GLB's custom 'goal_frame' can
  // replace just this (the net stays) — applyTable hides g.userData.front for tables that supply one.
  const gf=new THREE.Group();g.add(gf);g.userData.front=gf;
  const postG=new THREE.CylinderGeometry(PR,PR,GH,16);         // front uprights, on the goal line
  [-1,1].forEach(sz=>{const p=new THREE.Mesh(postG,frameM);p.position.set(0,GH/2,sz*GHW);p.castShadow=true;gf.add(p);});
  const bar=new THREE.Mesh(new THREE.CylinderGeometry(PR,PR,GHW*2,16),frameM);   // crossbar (along z)
  bar.rotation.x=Math.PI/2;bar.position.set(0,GH,0);bar.castShadow=true;gf.add(bar);
  // net: team-tinted white diamond mesh; ONE material per goal (recoloured in applyColors). The roof is a
  // SOLID collider in physics (goalFrameCollide) so a shot over the bar lands on top instead of scoring.
  const netM=new THREE.MeshStandardMaterial({color:i?cfg.blueColor:cfg.redColor,map:netTex,transparent:true,opacity:.85,roughness:.9,side:THREE.DoubleSide,depthWrite:false});
  netMats.push(netM);
  g.userData.net=buildGoalNet(g,sx*GD,GHW,GH,netM);   // swept cage; panels collected so bigGoalUpdate can taper the back
  const gl=new THREE.PointLight(0xffffff,0,70);gl.position.set(sx*5,GH+7,0);g.add(gl);goalLights.push(gl);
  goalFrames.push(g);scene.add(g);});
 tablePrimObjs.classic=primTable.children.filter(c=>c.isMesh&&c!==fieldMesh);  // procedural fallback (hidden when a skin GLB is shown)
}

/* ---- procedural goal net ---------------------------------------------------------------------
   White diamond mesh on a transparent canvas, so the net reads from any camera with no image asset.
   The cage is ONE cross-section (netProfile, in the y/z plane) swept from the goal line to the rear
   plane, plus a cap across the back — which is what lets the top side creases be ROUNDED
   (CONFIG.goalNet.bevel) to echo the frame's post/crossbar joint. Every swept panel merges into a
   single geometry with u walked along the profile, so the net tiles in square cells and flows
   continuously round the bevel with no seam, in 2 draw calls per goal instead of 5. */
function makeNetTex(){
 const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
 x.clearRect(0,0,64,64);x.strokeStyle='rgba(255,255,255,.85)';x.lineWidth=1.5;
 for(let k=-64;k<=64;k+=10){x.beginPath();x.moveTo(k,0);x.lineTo(k+64,64);x.stroke();
  x.beginPath();x.moveTo(k,64);x.lineTo(k+64,0);x.stroke();}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
/* the cage outline as [z,y] pairs, walked from the floor's −z corner up and over to the +z one; the
   floor closes the loop. hw/gh = half-width/height at this station, so the same call serves the mouth
   and the narrower rear plane. r/n (bevel radius + arc segments) are fixed by the CALLER so both
   profiles come back with matching point counts — the sweep pairs them index-for-index. */
function netProfile(hw,gh,r,n){
 const p=[[-hw,0]];
 if(r<=1e-4)p.push([-hw,gh],[hw,gh]);                          // r=0 → the original hard corner
 else{p.push([-hw,gh-r]);                                      // up the −z wall to where the round starts
  for(let k=1;k<=n;k++){const t=k/n*Math.PI/2;p.push([-(hw-r)-r*Math.cos(t),gh-r+r*Math.sin(t)]);}
  for(let k=n;k>=1;k--){const t=k/n*Math.PI/2;p.push([(hw-r)+r*Math.cos(t),gh-r+r*Math.sin(t)]);}
  p.push([hw,gh-r]);}                                          // …and back down the +z wall
 p.push([hw,0]);return p;
}
/* one merged net panel. `base` is the untouched vertex array bigGoalUpdate tapers against. */
function netGeo(pos,uv,idx,mat){
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geo.setIndex(idx);geo.computeVertexNormals();
 const m=new THREE.Mesh(geo,mat);m.userData.base=Float32Array.from(pos);return m;
}
/* sweeps the profile from the goal line (local x=0) to the rear plane at bx*backInset, adds both
   meshes to g and returns them. Local coords: the group already sits on the goal line. */
function buildGoalNet(g,bx,ghw,gh,mat){
 const GN=CONFIG.goalNet,cell=GN.cell,r=clamp(GN.bevel.r,0,Math.min(ghw,gh)*.5),n=Math.max(1,GN.bevel.segs|0),
       BX=bx*GN.backInset,bw=ghw*GN.backInset,                 // rear plane: same inset on depth and width
       fp=netProfile(ghw,gh,r,n),bp=netProfile(bw,gh,r,n),P=fp.length;
 // shell: one quad per profile segment (the last wraps round to close the floor). u accumulates the
 // real profile length so the mesh doesn't stretch on the short bevel facets; v is a SHARED constant
 // sweep depth, so adjacent panels can't disagree along the seam they share.
 const pos=[],uv=[],idx=[],rv=Math.abs(BX)/cell;let u=0,o=0;
 for(let k=0;k<P;k++){const j=(k+1)%P,a=fp[k],b=fp[j],c=bp[j],d=bp[k],
   u2=u+Math.hypot(b[0]-a[0],b[1]-a[1])/cell;
  pos.push(0,a[1],a[0], 0,b[1],b[0], BX,c[1],c[0], BX,d[1],d[0]);
  uv.push(u,0, u2,0, u2,rv, u,rv);idx.push(o,o+1,o+2,o,o+2,o+3);o+=4;u=u2;}
 const shell=netGeo(pos,uv,idx,mat);g.add(shell);
 // back cap: the rear profile is convex, so a fan off its first point triangulates it. Planar UVs
 // (straight off z/y) keep its cells the same size as the shell's.
 const cp=[],cu=[],ci=[];
 for(let k=0;k<P;k++){cp.push(BX,bp[k][1],bp[k][0]);cu.push(bp[k][0]/cell,bp[k][1]/cell);}
 for(let k=1;k<P-1;k++)ci.push(0,k,k+1);
 const cap=netGeo(cp,cu,ci,mat);g.add(cap);
 return [shell,cap];
}

/* The stand-in backdrop for a room with no GLB (or one whose file is missing, or one still
   downloading). A ground plane and nothing else: the ring of 1,400 canvas dots that used to
   stand in for a crowd is gone — a room is dressed with PROPS now (js/props.js), which is the
   thing that can actually be art-directed. */
function buildGround(){
 groundMesh=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshStandardMaterial({color:0x0b0e16,roughness:1}));
 groundMesh.rotation.x=-Math.PI/2;groundMesh.position.y=-44;scene.add(groundMesh); // hidden when a room backdrop is shown (applyRoom)
}

function loadPlayerModel(onReady){
  let remaining=2;
  const done=()=>{if(--remaining===0)onReady();};
  [0,1].forEach(team=>{
   const am=activeModel(team);
   const teamParts=new Set(am.teamParts.map(s=>s.toLowerCase()));
   const hairParts=new Set((am.hairParts||[]).map(s=>s.toLowerCase()));
   const useCache=(scene)=>{
    playerModel[team]=scene.clone(true);
    playerTeamMats[team]={};
    playerHairParts[team]=hairParts;
    markShadowCasters(playerModel[team]);   // decide silhouette casters ONCE, here — not per clone
    playerModel[team].traverse(child=>{
     if(!child.isMesh)return;
     const name=child.material.name.toLowerCase();
     if(!teamParts.has(name))return;
     const mat=child.material.clone();
     mat.color.set(team===0?cfg.redColor:cfg.blueColor);
     playerTeamMats[team][name]=mat;
    });
    done();
   };
  if(modelCache[am.id]){touchModelCache(modelCacheOrder,am.id);useCache(modelCache[am.id]);return;}
  newGLTF().load(am.src,
   gltf=>{cacheModelTemplate(modelCache,modelCacheOrder,am.id,gltf.scene);useCache(gltf.scene);
    // Evict old templates (ref-drop only, dispose=false): a just-swapped-away figurine can still
    // have live clones on the table sharing this geometry until rebuildRodMen runs, so we never
    // free GPU here — dropping the ref lets V8 reclaim the bulk once all clones are gone. The two
    // active figurines are protected regardless.
    capModelCache(modelCache,modelCacheOrder,new Set([activeModel(0).id,activeModel(1).id]),false);},
   undefined,
   ()=>{console.warn('player model load failed for team '+team);done();}
  );
 });
}

/* Measure a figurine TEMPLATE's sub-meshes and stamp each one's SIZE AS A FRACTION of the whole
   figure — see `casterFrac` in CONFIG.render.shadow.quality for the reasoning and the numbers.
   Measured on the template rather than in makePlayer because makePlayer runs 22 times per
   rebuild and Box3.setFromObject walks every vertex; clone(true) deep-copies userData, so each
   man inherits the measurement for free. The SIZE is stored rather than a yes/no so the Shadow
   quality setting can re-decide live (refreshShadowCasters) without reloading the model.
   A part that is not a caster is still DRAWN normally — this only keeps it out of the shadow
   pass. */
function markShadowCasters(root){
 if(!root)return;
 const parts=[];root.traverse(o=>{if(o.isMesh)parts.push(o);});
 if(!parts.length)return;
 const v=new THREE.Vector3(),whole=new THREE.Box3().setFromObject(root).getSize(v).length();
 let big=null,bigD=-1;
 parts.forEach(o=>{
  const d=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).length();
  o.userData._shFrac=whole>1e-6?d/whole:1;o.userData._shBig=false;
  if(d>bigD){bigD=d;big=o;}
 });
 if(big)big.userData._shBig=true;   // never leave a figurine with no shadow at all
 parts.forEach(o=>{o.castShadow=partCasts(o);});
}

/* Does this sub-mesh go into the shadow pass? Reads the ACTIVE quality tier every time it is
   asked, so the answer follows Options -> Display -> Shadow quality. 0 = every part casts. */
function partCasts(o){
 const frac=shadowQ().casterFrac;
 if(!(frac>0)||o.userData._shBig)return true;
 return (o.userData._shFrac||1)>=frac;
}

/* Re-decide the casters on every man already on the table, after a Shadow quality change.
   castShadow on a MESH only moves it in and out of the shadow pass's draw list — unlike
   castShadow on a LIGHT it is not a shader define, so this needs no recompile and no rebuild;
   the walk is 22 groups of five meshes. */
function refreshShadowCasters(){
 const redo=g=>{if(g)g.traverse(c=>{if(c.isMesh&&c.userData._shFrac!==undefined)c.castShadow=partCasts(c);});};
 playerModel.forEach(redo);            // the templates too, so the next clone starts out right
 rods.forEach(r=>r.men.forEach(redo));
 shadowDirty();
}

function makePlayer(team){
  if(!playerModel[team]){
   const g=new THREE.Group();
   const head=new THREE.Mesh(new THREE.SphereGeometry(1.25,12,10),teamMat[team]);head.position.y=2.1;
   const torso=new THREE.Mesh(new THREE.BoxGeometry(3.1,5.4,2.2),teamMat[team]);torso.position.y=-2.5;
   const foot=new THREE.Mesh(new THREE.BoxGeometry(1.8,3.6,1.5),teamMat[team]);foot.position.y=-6.9;
   [head,torso,foot].forEach(m=>{m.castShadow=true;g.add(m);});
   return g;
  }
  const g=playerModel[team].clone(true);
  g.scale.setScalar(activeModel(team).scale*tmScale(team));
  g.traverse(child=>{
   if(!child.isMesh)return;
   const name=child.material.name.toLowerCase();
   if(playerTeamMats[team][name])child.material=playerTeamMats[team][name];
   else if(playerHairParts[team].has(name)){
    child.material=child.material.clone();
    const sw=CONFIG.playerModel.hairSwatches;
    child.material.color.set(sw[Math.floor(Math.random()*sw.length)]);
   }
   child.castShadow=partCasts(child);   // sized by markShadowCasters, gated by the quality tier
  });
  return g;
}

/* Handle-collar z for a rod. Sits `wallClear` past the outer side wall face
   (F.W/2 + 3) even at full inward slide, so the handle never pulls through the
   wall; the symmetric bar (±collar) keeps the far end clear across slide too. */
function rodCollar(maxOff){return F.W/2+3+CONFIG.rods.wallClear+maxOff;}

function buildRods(){
 const tid=(CONFIG.tables[cfg.table]?cfg.table:'classic');   // active table → picks the rod set
 RODDEFS.forEach((d,idx)=>{
  const sp=d.men===2?CONFIG.rods.spacing.two:d.men===3?CONFIG.rods.spacing.three:CONFIG.rods.spacing.other;
   let maxOff=(F.W-CONFIG.rods.margin-(d.men-1)*sp)/2;
   if(d.slideCap!=null)maxOff=Math.min(maxOff,d.slideCap);
   else if(d.role==='GK')maxOff=Math.min(maxOff,CONFIG.rods.gkSlide); // keeper stays in its area → shorter rod
  const pivot=new THREE.Group();pivot.position.set(d.x,ROD_H,0);scene.add(pivot);
  const baseZ=[],men=[];
  for(let i=0;i<d.men;i++){const bz=(i-(d.men-1)/2)*sp;baseZ.push(bz);
    const p=makePlayer(d.team);p.position.z=bz;p.position.y=PLAYER_H;if(d.team===1)p.rotation.y=Math.PI;pivot.add(p);men.push(p);}
    const r={idx,x:d.x,team:d.team,role:d.role,men,baseZ,maxOff,pivot,handle:null,collar:null,rodBar:null,rodModel:null,
     offset:0,target:0,slideV:0,angle:0,prevAngle:0,prevOffset:0,angVel:0,vz:0,
     kickT:-1,kickStyle:null,kickCurve:null,kickDir:d.team===0?1:-1,raise:false,raiseKeep:false,kickHold:false,padAngleTarget:0,padAngleOn:false,tcSpin:0,cd:0,exert:0,aiMan:-1,
     // player shot verbs (js/shots.js). chg = live charge 0..1 (-1 = not winding up); chgA is the
     // WORLD wind-up angle sweepClips allowed; shotOn/Pow/Ctl is what the NEXT contact is worth and
     // is the only thing physics.js reads; trem is display-only and is added on the render pivot.
     chg:-1,chgRel:0,chgMod:null,chgA:null,chgSrc:null,chgHeld:0,chgSweet:false,trem:0,
     shotOn:false,shotPow:1,shotCtl:1,shotTrack:1,shotExert:1,
     // the player's L2 hold, in the shape holdCfg's consumers already read (CONFIG.ai.trap and
     // .dribble). Per-rod and mutated in place — collideRod reads it per man per substep.
     hold:{on:false,holdRest:KICK.rest,holdGrip:KICK.grip,carryMult:1},
    behindFlag:false,act:null,actT:0,trapMan:-1,trapDir:0,trapZ0:0,trapA:null,laneDir:0,laneCd:0,
     dribMan:-1,dribZ:0,dribZ0:0,dribCd:0,dribEvT:0,passTo:null,passEv:null,passEvT:0,
     aiErr:0,aiErrT:0,aiErrTarget:0,aiBX:0,aiBZ:0,aiBVX:0,aiBVZ:0,aiGoalZ:0,
     // match stats (js/matchstats.js): msSw = the one-attempt-per-swing latch, cleared in kickRod.
     // msB/msBFor = this rod's stat bucket, cached against the IDENTITY of the S.stats it belongs
     // to — freshStats hands out a new object per match, which is what makes the cache safe.
     msSw:false,msB:null,msBFor:null,
     removedUntil:[]};
    rods.push(r);
    dressRod(r,tid);                                  // hang the rod's hardware visual (GLB set or primitive)
  });
  rodsDressedFor=(typeof rodSetKey==='function')?rodSetKey(tid):'_shared';
  refreshRodCustomMats();
 }

/* (Re)build ONE rod's hardware visual on its pivot: the active table's GLB rod if that set has
   this size, else the primitive bar+handle+collar. Removes any previous hardware first, so this
   doubles as the table-switch reskin. The MEN (figurines) are owned by buildRods/rebuildRodMen
   and are left untouched. */
function dressRod(r,tid){
 // Just detach previous hardware — do NOT dispose. GLB rod clones share geometry + template
 // materials with the rodSets template (three.clone doesn't copy those), and the primitive
 // handle/knob use the shared teamMat/teamGlow; disposing either would corrupt globals. Mirrors
 // rebuildRodMen, which likewise removes-without-disposing. Table switches are rare (menu only).
 if(r.rodModel){r.pivot.remove(r.rodModel);r.rodModel=null;}
 if(r.rodBar){r.pivot.remove(r.rodBar);r.rodBar=null;}
 if(r.handle){r.pivot.remove(r.handle);r.handle=null;}
 if(r.collar){r.pivot.remove(r.collar);r.collar=null;}
 const rodModel=makeRodModel(r.men.length,r.team,tid);   // GLB rod if the set has this size, else null
 if(rodModel){r.pivot.add(rodModel);r.rodModel=rodModel;return;}
 // primitive fallback (unchanged geometry). bar reaches collar+cap each end; handle hides the near tip.
 const collar=rodCollar(r.maxOff);
 const hl=CONFIG.rods.handleLen,cl=CONFIG.rods.collarLen,cap=CONFIG.rods.capOut;
 const rodM=new THREE.MeshStandardMaterial({color:0xc8cfdb,roughness:.25,metalness:.9});
 const bumpMat=new THREE.MeshStandardMaterial({color:0x14181f,roughness:.7,metalness:.2});
 const rodMesh=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,2*(collar+cl+cap),10),rodM);
 rodMesh.rotation.x=Math.PI/2;rodMesh.castShadow=true;r.pivot.add(rodMesh);r.rodBar=rodMesh;
 const hg=new THREE.Group();
 const hb=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,hl,12),teamMat[r.team]);hb.rotation.x=Math.PI/2;hg.add(hb);
 const knob=new THREE.Mesh(new THREE.BoxGeometry(.9,.9,2.6),teamGlow[r.team]);knob.position.x=1.6;hg.add(knob);
 hg.position.z=collar+hl/2;r.pivot.add(hg);
 // collar: the stopper opposite the handle; the bar tip pokes `cap` past it.
 const cm=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,cl,12),bumpMat);
 cm.rotation.x=Math.PI/2;cm.position.z=-(collar+cl/2);cm.castShadow=true;r.pivot.add(cm);
 r.handle=hg;r.collar=cm;
}

/* Rebuild the rodCustomMats list (rod GLB team-colour materials) from the current rod models —
   run after any dressRod pass so applyColors/applyFinish paint the fresh visuals. */
function refreshRodCustomMats(){
 rodCustomMats=[];
 rods.forEach(r=>{if(r.rodModel&&r.rodModel.userData.teamClones)
  r.rodModel.userData.teamClones.forEach(c=>rodCustomMats.push({mat:c.mat,team:r.rodModel.userData.team,isGlow:c.isGlow}));});
}

/* Swap every rod's hardware visual to `tableId`'s rod set (called from applyTable once the set is
   resident). Physics untouched — visual only. No-op when the rods already wear this set. Handle
   near-side flip is re-applied by startMatch, so it isn't repeated here. */
function reskinRods(tableId){
 if(!rods.length)return;                                  // rods not built yet (early applyTable) — buildRods dresses them
 const tid=(CONFIG.tables[tableId]?tableId:'classic');
 const key=(typeof rodSetKey==='function')?rodSetKey(tid):'_shared';
 if(rodsDressedFor===key)return;
 rodsDressedFor=key;
 rods.forEach(r=>dressRod(r,tid));
 refreshRodCustomMats();
 if(typeof applyColors==='function')applyColors();        // paint + finish the new materials
}

function buildFxPools(){
 const cv=document.createElement('canvas');cv.width=64;cv.height=64;
 const c=cv.getContext('2d');
 const gr=c.createRadialGradient(32,32,2,32,32,30);
 gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.4,'rgba(255,255,255,.5)');gr.addColorStop(1,'rgba(255,255,255,0)');
 c.fillStyle=gr;c.fillRect(0,0,64,64);
 spriteTex=new THREE.CanvasTexture(cv);
 for(let i=0;i<CONFIG.fx.spriteCount;i++){
  const m=new THREE.SpriteMaterial({map:spriteTex,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});
  const s=new THREE.Sprite(m);s.visible=false;s.userData={life:0};scene.add(s);sprites.push(s);}
 pGeo=new THREE.BufferGeometry();
 const pos=new Float32Array(pCount*3),col=new Float32Array(pCount*3);
 for(let i=0;i<pCount;i++){pos[i*3+1]=-999;pData.push({vx:0,vy:0,vz:0,life:0});}
 pGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));
 pGeo.setAttribute('color',new THREE.BufferAttribute(col,3));
 particles=new THREE.Points(pGeo,new THREE.PointsMaterial({size:1.5,vertexColors:true,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
 particles.frustumCulled=false;scene.add(particles);
 dropRing=new THREE.Mesh(new THREE.RingGeometry(2,3.4,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,side:THREE.DoubleSide}));
 dropRing.rotation.x=-Math.PI/2;dropRing.position.y=.15;scene.add(dropRing);
 // Held-rod markers — ONE PER SEAT (CONFIG.seats.max), so every human can find their own rod.
 // Pre-allocated and resident like the fx light pool: a marker is only ever shown/hidden, never
 // added to or removed from the scene. Geometry is shared (same cone); each needs its own
 // material because each carries a different SEAT colour.
 const indGeo=new THREE.ConeGeometry(1.7,3.4,4);
 indicators=[];
 for(let i=0;i<CONFIG.seats.max;i++){
  const m=new THREE.Mesh(indGeo,new THREE.MeshBasicMaterial({color:0xffffff}));
  m.rotation.x=Math.PI;m.visible=false;scene.add(m);indicators.push(m);
 }
 buildMarkPool();   // wall scuffs — one batched mesh of its own (js/marks.js)
}

/* ===== fx light pool =====
   r128 compiles the scene's light COUNT into every material's shader program, so adding OR
   removing a light (a fireball's glow, the cannonball fuse, an explosion, a respawn swirl)
   forces a whole-scene shader recompile on the next render — a multi-hundred-ms hitch on a
   populated table. To kill it we keep a fixed set of PointLights permanently in the scene
   (visible so they're COUNTED, intensity 0 so they contribute nothing) and let effects borrow
   one instead of scene.add-ing a fresh light. The count is then constant for the whole session,
   so those recompiles never fire. Sized by CONFIG.fx.lightPool; the 2 goalLights already work
   this exact way, so this is the same trick, generalised. */
function buildFxLightPool(){
 const n=(CONFIG.fx&&CONFIG.fx.lightPool)||0;
 for(let i=0;i<n;i++){const l=new THREE.PointLight(0xffffff,0,40);l.visible=true;l._fxFree=true;scene.add(l);fxLightPool.push(l);}
}
/* Borrow a resident fx light: sets its colour + falloff distance, leaves intensity at 0 for the
   caller to drive, and returns it — or null when the pool is exhausted (the effect then plays
   without its extra glow; the light COUNT, and thus the no-recompile guarantee, is unaffected). */
function fxLightGet(color,dist){
 for(const l of fxLightPool){if(!l._fxFree)continue;
  l._fxFree=false;l.color.set(color);l.distance=dist||40;l.intensity=0;return l;}
 return null;
}
/* Return a borrowed light to the pool (intensity 0, marked free). NEVER scene.remove it —
   removing it would change the light count and reintroduce the recompile this pool prevents. */
function fxLightPut(l){if(!l)return;l.intensity=0;l._fxFree=true;}

/* --- authored room lights (rooms.<id>.lights) -----------------------------
   The SECOND pool in this file, and for the same reason as the first: r128 bakes the
   scene's light COUNT into every material's program, so creating a light when a room is
   shown recompiles everything. The fx pool solved that for effects; this solves it for a
   room's own fixtures — which is what makes the room editor's light gizmo usable, since
   adding a light there would otherwise cost a whole-scene compile per click.

   SIZED FROM THE CONFIG, so it costs exactly what the heaviest room needs and no more: the
   per-type maximum over every room's `lights`, plus CONFIG.render.roomLightPool.pad spare
   slots that are allocated ONLY when the room editor is enabled. A shipping build whose
   rooms author no lights allocates nothing at all.

   NOT to be confused with a room GLB's BAKED KHR_lights_punctual, which still arrive with
   the model and still go through the candela transfer in applyRoomLights (models.js). An
   authored light is in plain three.js units — see the note in CONFIG.rooms. */
const roomLightPool={point:[],spot:[],dir:[]};
function rlpNeed(){
 const P=(CONFIG.render&&CONFIG.render.roomLightPool)||{};
 const cap=P.max===undefined?12:P.max;
 const n={point:0,spot:0,dir:0};
 for(const id in CONFIG.rooms){
  const c={point:0,spot:0,dir:0};
  // Count ALL of this room's lights per type, and how many of them want to cast. The plain pool
  // then needs whatever the SHADOW budget cannot absorb — not simply the non-casting ones. A
  // light that asks to cast past the budget falls back to a plain slot, so sizing this to the
  // non-casting lights alone leaves the room one slot short and silently drops a lamp.
  const w={point:0,spot:0,dir:0};
  ((CONFIG.rooms[id]||{}).lights||[]).forEach(L=>{const t=rlpType(L);if(c[t]===undefined)return;
   c[t]++;if(rlpWantsShadow(L))w[t]++;});
  const shN=rlpShadowNeed();
  for(const t in c)c[t]=Math.max(0,c[t]-Math.min(w[t],shN[t]||0));
  for(const t in n)if(c[t]>n[t])n[t]=c[t];
 }
 // Editor headroom, paid for only by a build with the editor switched on. Per type: every
 // resident light is evaluated by every material, and a room wants several lamps far more
 // often than it wants several suns.
 const on=!!(CONFIG.debug&&CONFIG.debug.roomEditor);
 const P2=(P.pad&&typeof P.pad==='object')?P.pad:{point:P.pad,spot:P.pad,dir:P.pad};
 for(const t in n){const pad=on?(P2[t]===undefined?4:P2[t]):0;n[t]=Math.min(n[t]+pad,cap);}
 return n;
}
function rlpType(L){const t=(L&&L.type)||'point';return t==='spot'?'spot':(t==='dir'||t==='directional')?'dir':'point';}
function rlpWantsShadow(L){return !!(L&&L.shadow);}
/* The SHADOW sub-pool. castShadow is a shader parameter, so it cannot be flipped on a live
   light without recompiling every material — the same reason the pool exists at all. So these
   are created casting and stay that way, and a room light with `shadow:true` borrows one.
   Sized straight from CONFIG.render.roomLightPool.shadow rather than derived from the rooms:
   a caster is a whole extra render pass per frame (SIX for a point light, which is a cube map),
   so this is a deliberate budget, not something that should quietly grow with the content. */
const roomShadowPool={point:[],spot:[],dir:[]};
function rlpShadowNeed(){
 const P=(CONFIG.render&&CONFIG.render.roomLightPool)||{},S=P.shadow||{};
 const cap=P.max===undefined?12:P.max,n={point:0,spot:0,dir:0};
 for(const t in n)n[t]=Math.min(Math.max(0,S[t]||0),cap);
 return n;
}
function buildRoomLightPool(){
 const n=rlpNeed();
 for(let i=0;i<n.point;i++){const l=new THREE.PointLight(0xffffff,0,100);rlpAdd('point',l);}
 for(let i=0;i<n.spot;i++){const l=new THREE.SpotLight(0xffffff,0,100,0.6,0.4,2);rlpAdd('spot',l);}
 for(let i=0;i<n.dir;i++){const l=new THREE.DirectionalLight(0xffffff,0);rlpAdd('dir',l);}
 const sh=rlpShadowNeed(),SM=((CONFIG.render&&CONFIG.render.shadow)||{}).roomMapSize||1024;
 for(let i=0;i<sh.point;i++){const l=new THREE.PointLight(0xffffff,0,100);rlpAdd('point',l,true,SM);}
 for(let i=0;i<sh.spot;i++){const l=new THREE.SpotLight(0xffffff,0,100,0.6,0.4,2);rlpAdd('spot',l,true,SM);}
 for(let i=0;i<sh.dir;i++){const l=new THREE.DirectionalLight(0xffffff,0);rlpAdd('dir',l,true,SM);}
 const tot=n.point+n.spot+n.dir,tsh=sh.point+sh.spot+sh.dir;
 if(tot||tsh)console.log('room light pool: '+n.point+' point, '+n.spot+' spot, '+n.dir+' dir'
  +(tsh?'  |  shadow-casting: '+sh.point+' point, '+sh.spot+' spot, '+sh.dir+' dir':''));
}
/* Every pooled light keeps its own target in the scene. A three.js SpotLight/DirectionalLight
   aims at target.position and the target must be IN the scene graph or its matrix never
   updates — the classic silent failure where a spot points doggedly at the origin. */
function rlpAdd(t,l,cast,mapSize){
 l.visible=true;l.intensity=0;l.castShadow=!!cast;l._rlFree=true;
 if(cast&&l.shadow){l.shadow.mapSize.setScalar(mapSize||1024);l.shadow.bias=-0.0015;l.shadow.normalBias=0.6;
  // A FREE shadow slot must not cost a pass. castShadow has to stay true (it is a shader
  // parameter — flipping it recompiles everything), but three.js gates each light's pass on its
  // OWN shadow.autoUpdate/needsUpdate, so an unborrowed slot is skipped for free. Measured: two
  // idle slots were costing ~106 draws a frame before this.
  l.shadow.autoUpdate=false;l.shadow.needsUpdate=false;
  if(l.shadow.camera&&l.shadow.camera.isPerspectiveCamera){l.shadow.camera.near=1;l.shadow.camera.far=600;}}
 scene.add(l);
 if(l.target){l.target.position.set(0,0,0);scene.add(l.target);}
 (cast?roomShadowPool:roomLightPool)[t].push(l);
}
/* Borrow a slot. wantShadow picks the casting sub-pool and FALLS BACK to a plain slot when the
   budget is spent — the light still lights, it just does not cast. A silent downgrade is the
   right failure here: the alternative is either a stall or a room that loses a lamp entirely. */
function rlpGet(t,wantShadow){
 if(wantShadow){for(const l of roomShadowPool[t])if(l._rlFree){l._rlFree=false;
  if(l.shadow){l.shadow.autoUpdate=true;l.shadow.needsUpdate=true;}   // in use: follow the global freeze
  return l;}}
 for(const l of roomLightPool[t])if(l._rlFree){l._rlFree=false;return l;}
 return null;
}
function rlpFreeAll(){
 for(const t in roomLightPool)for(const l of roomLightPool[t]){l.intensity=0;l._rlFree=true;}
 for(const t in roomShadowPool)for(const l of roomShadowPool[t]){l.intensity=0;l._rlFree=true;
  if(l.shadow){l.shadow.autoUpdate=false;l.shadow.needsUpdate=false;}}
}
/* Drive the pool from one room's `lights`. Called by applyRoom, and again by the editor on
   every change — it is a full re-drive rather than a diff, so the pool can never disagree
   with the spec list (the same "edit the data, rebuild" rule js/roomedit.js applies to props). */
function applyAuthoredLights(rm){
 rlpFreeAll();
 const list=(rm&&rm.lights)||[];
 let over=0,short=0;
 list.forEach(L=>{
  const t=rlpType(L),want=rlpWantsShadow(L),l=rlpGet(t,want);
  if(!l){over++;return;}
  if(want&&!l.castShadow)short++;   // shadow budget spent — it still lights, it just cannot cast
  const p=L.pos||[0,60,0];
  l.position.set(p[0]||0,p[1]||0,p[2]||0);
  l.color.set(L.color===undefined?0xffffff:L.color);
  l.intensity=L.int===undefined?1:L.int;
  if(t!=='dir'){l.distance=L.dist===undefined?0:L.dist;l.decay=L.decay===undefined?2:L.decay;}
  if(t==='spot'){l.angle=L.angle===undefined?0.6:L.angle;l.penumbra=L.penumbra===undefined?0.4:L.penumbra;}
  if(l.target){const k=L.look||[0,0,0];l.target.position.set(k[0]||0,k[1]||0,k[2]||0);l.target.updateMatrixWorld();}
 });
 if(over)console.warn('room lights: '+over+' over the pool — raise CONFIG.render.roomLightPool.pad/max');
 if(short)console.warn('room lights: '+short+' asked to cast shadows past the budget — lit but not casting.'
  +' Raise CONFIG.render.roomLightPool.shadow (one extra render pass each; SIX for a point light).');
 return list.length-over;
}

/* The pitch group that is currently parented into the table. Kept so applyTable can re-parent it
   when the TABLE changes underneath it (the pitch rides inside whichever table group is active). */
let pitchShown=null;
/* Lazy pitch-texture loader/cache. Loads assets/<pitch.tex> once, caches it in
   fieldTexCache, and hands it back (or null on failure) via cb. Only the JPG-fallback path
   uses this — a pitch with a working GLB never touches fieldTexCache. */
function loadPitchTex(pid,cb){
  if(fieldTexCache[pid]){if(cb)cb(fieldTexCache[pid]);return;}
  const pdef=CONFIG.pitches[pid];
  if(!pdef){if(cb)cb(null);return;}
  new THREE.TextureLoader().load('assets/'+pdef.tex,tex=>{
   tex.encoding=THREE.sRGBEncoding;tex.anisotropy=4;fieldTexCache[pid]=tex;if(cb)cb(tex);
  },undefined,()=>{console.warn('pitch texture missing (assets/'+pdef.tex+')');if(cb)cb(null);});
}
/* Show the selected pitch, fetching its GLB if it isn't resident, and evicting the rest.
   Same shape as applyRoom, deliberately: show() first with whatever is already here, then load,
   then show() again — so a venue change never leaves a hole while a file is in flight.

   THE INACTIVE PITCHES ARE DETACHED, NOT HIDDEN, and that mattered even more than it looks: three
   walks INVISIBLE objects in updateMatrixWorld, and renderer.compile() uploads every material it
   can reach regardless of .visible — which the staged venue swap now calls on purpose. A hidden
   pitch would be silently uploaded by the very warm that exists to make the swap smooth.

   onReady (opt) fires once the pitch is resident — synchronous when it already is, or when the
   pitch has no GLB and the JPEG path is used. venueLoad gates the loading veil on it. */
function drawField(onReady){
  const id=CONFIG.pitches[cfg.pitch]?cfg.pitch:Object.keys(CONFIG.pitches)[0];
  const pdef=CONFIG.pitches[id];
  if(!pdef){if(onReady)onReady();return;}
  const host=()=>(fieldMesh&&fieldMesh.parent)||primTable;
  const show=()=>{
   const g=(typeof pitchGroups!=='undefined')?pitchGroups[id]:null;
   const on=!!(g&&g.children.length);
   if(typeof pitchGroups!=='undefined')
    for(const pid in pitchGroups){const gg=pitchGroups[pid];if(!gg)continue;
     if(pid===id&&on){if(gg.parent!==host())host().add(gg);gg.visible=true;pitchShown=gg;}
     else if(gg.parent){gg.parent.remove(gg);if(pitchShown===gg)pitchShown=null;}}
   if(fieldMesh)fieldMesh.visible=!on;             // the shared plane stands in until the GLB is here
   shadowDirty();
   return on;
  };
  const on=show();
  const wantGlb=(typeof pitchHasGlb==='function')?pitchHasGlb(id):!!pdef.glb;
  if(wantGlb&&typeof ensurePitch==='function'){
   ensurePitch(id,()=>{
    // fallbackTex ONLY if the GLB did not land. Dressing the stand-in plane "while we wait" reads
    // as a nicety and is a second full-size download of the same pitch — measured: every switch
    // fetched the JPEG AND the GLB, and boot fetched pubClassic.jpeg three times (drawField runs
    // from startLoading, twice from applyTable, and from applyColors) on top of the 11.3MB GLB.
    // The plane is only on screen for the moment before the GLB arrives, and a venue swap is
    // behind the loading veil anyway. But a 404'd GLB means the plane IS the pitch — dress it then.
    if(!show())fallbackTex(id);
    if(typeof prunePitches==='function')prunePitches(id);
    if(onReady)onReady();
   });
   return;
  }
  fallbackTex(id);
  if(typeof prunePitches==='function')prunePitches(null);
  if(onReady)onReady();
}
/* The no-GLB / 404 path: the shared plane wearing the pitch's JPEG. */
function fallbackTex(id){
  if(!fieldMesh)return;
  loadPitchTex(id,tex=>{
   if(cfg.pitch!==id)return;                       // switched again while this loaded — newer call wins
   if(!tex)return;
   fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;renderDirty();
   for(const k in fieldTexCache){if(k!==id&&fieldTexCache[k]){   // keep only the active pitch's image
    if(fieldTexCache[k].dispose)fieldTexCache[k].dispose();delete fieldTexCache[k];}}
  });
}

/* Pick the active room's reflection env (synthetic vs baked-from-GLB), cache it, and install it.
   Re-run whenever the room, its loaded state, or cfg.reflections changes. */
function setRoomEnv(id,rm){
 if(!renderer||!scene)return;
 // rooms.<id>.ibl:false = no image-based light at all. Nothing is BAKED either, so a room that
 // never wants one never pays the PMREM pass or holds its render target.
 if(!roomIblOn(rm)){scene.environment=null;return;}
 const glbReady=!!(roomGroups[id]&&roomGroups[id].children.length);
 const wantGlb=!!(cfg.reflections&&rm.reflect);
 const gk='glb:'+id, sk='syn:'+id;
 /* A CACHED GLB BAKE IS USABLE BEFORE THE GLB ITSELF IS BACK, and this is the visible half of
    keeping it. The bake is an independent cubemap, so on a revisit the REAL reflections can go on
    immediately instead of showing the synthetic stand-in and popping to the real one a second
    later when the download lands. `glbReady` therefore only decides whether we can BAKE one, not
    whether we can USE one. A room we have never baked still falls back to synthetic. */
 let key=(wantGlb&&(glbReady||roomEnvCache[gk]))?gk:sk;
 if(!roomEnvCache[key]&&key===gk){
  if(glbReady)roomEnvCache[gk]=bakeGlbEnv(roomGroups[id]);
  if(!roomEnvCache[gk])key=sk;                            // never baked, or the bake failed
 }
 if(!roomEnvCache[key])roomEnvCache[key]=bakeSyntheticEnv(rm.env);
 if(roomEnvCache[key]){scene.environment=roomEnvCache[key];touchEnv(key);}
 pruneEnvs(key);
}
/* Apply the selected room/location: backdrop colour + fog, scene lighting, LED mood, reflection
   env, and the backdrop geometry (a room GLB, or the shared ground plane when it
   has none). Rooms are independent of the table + pitch — any combination is valid. onReady (opt)
   fires once the room's GLB is resident (synchronous when cached / when the room has no GLB), so
   league/cup can gate kickoff on it like they do the table. */
function applyRoom(onReady){
 const id=CONFIG.rooms[cfg.room]?cfg.room:'open';
 const rm=CONFIG.rooms[id];activeRoom=rm;
 scene.background=new THREE.Color(rm.bg);
 applyFog();                                             // honours cfg.fog; reads THIS room's near/far
 if(hemiLight&&rm.hemi){hemiLight.color.set(rm.hemi.sky);hemiLight.groundColor.set(rm.hemi.ground);hemiLight.intensity=rm.hemi.int;}
 if(dirLight&&rm.dir){dirLight.color.set(rm.dir.color);dirLight.intensity=rm.dir.int;if(rm.dir.pos)dirLight.position.set(rm.dir.pos[0],rm.dir.pos[1],rm.dir.pos[2]);}
 applyRoomKeyLights(rm);
 // LED mood: merge the room's override over CONFIG.leds (fx.js ledUpdate reads curLeds). A 'hold'
 // idle seeds the strip colour now; 'rainbow' is driven per-frame so its seed doesn't matter.
 curLeds=Object.assign({},CONFIG.leds,rm.led||{});
 if(curLeds.idle!=='rainbow'&&ledMat){const c=(rm.led&&rm.led.color)||0x38e0ff;ledMat.color.set(c);if(ledMat.emissive)ledMat.emissive.set(c);}
 // Is a backdrop GLB worth waiting for? roomHasGlb (models.js) says no for a room with no glb AND
 // for one whose file 404'd, so a missing backdrop stops being re-fetched on every venue change.
 const wantGlb=(typeof roomHasGlb==='function')?roomHasGlb(id):!!rm.glb;
 // Show the active room's backdrop, hide the rest; the shared ground plane stands in whenever it
 // ISN'T on screen — no glb, file missing, or still downloading. Recomputed INSIDE show() rather
 // than captured once: the old code read rm.glb up front, so a room whose GLB never arrived hid the
 // shared backdrop too and rendered as an empty void.
 const show=()=>{
  shadowDirty();   // room/backdrop/props swapped, and the glb + props both land async
  const on=!!(roomGroups[id]&&roomGroups[id].children.length);
  for(const rid in roomGroups){if(roomGroups[rid])roomGroups[rid].visible=(rid===id&&on);}
  const fill=!on&&rm.backdrop!==false;   // backdrop:false = a TRUE void (bg + fog only), no stand-in
  // props are a SEPARATE group per room (see js/props.js) — deliberately not parented to
  // the backdrop, whose children.length is what decides the shared-ground fallback above
  if(typeof propGroups!=='undefined')for(const pid in propGroups)propGroups[pid].visible=(pid===id);
  if(groundMesh)groundMesh.visible=fill;
 };
 show();setRoomEnv(id,rm);
 applyAuthoredLights(rm);                                // rooms.<id>.lights — pooled, so no recompile
 if(typeof buildRoomProps==='function')buildRoomProps(id,rm,show);
 if(wantGlb&&typeof ensureRoom==='function'){
  ensureRoom(id,()=>{                                    // GLB resident: reveal it + upgrade env to the real reflection bake
   show();setRoomEnv(id,rm);
   if(typeof pruneRooms==='function')pruneRooms(id);
   if(onReady)onReady();
  });
 }else{
  if(typeof pruneRooms==='function')pruneRooms(null);
  if(onReady)onReady();
 }
}
function applyColors(){
 for(let t=0;t<2;t++){
  const col=t===0?cfg.redColor:cfg.blueColor;
  teamMat[t].color.set(col);
  for(const mat of Object.values(playerTeamMats[t]))mat.color.set(col);
 }
 teamGlow[0].color.set(cfg.redColor);teamGlow[0].emissive.set(cfg.redColor);
 teamGlow[1].color.set(cfg.blueColor);teamGlow[1].emissive.set(cfg.blueColor);
 for(const c of rodCustomMats){const col=c.team===0?cfg.redColor:cfg.blueColor;
  c.mat.color.set(col);if(c.isGlow)c.mat.emissive.set(col);c.mat.needsUpdate=true;}
 netMats[0].color.set(cfg.redColor);netMats[1].color.set(cfg.blueColor);
 document.documentElement.style.setProperty('--c0',cfg.redColor);
 document.documentElement.style.setProperty('--c1',cfg.blueColor);
 applyFinish();drawField();
 renderDirty();   // kit/finish change: nothing MOVED, so shadowDirty never fires for it
}

/* Surface finish (metalness / roughness / emissive glow) from the Customize
   panel, pushed onto every live team material so the game mirrors the preview. */
function applyFinish(){
  for(let t=0;t<2;t++){
    const col=t===0?cfg.redColor:cfg.blueColor;
    applyTeamFinish(teamMat[t],t,col,false);
    applyTeamFinish(teamGlow[t],t,null,true);
    for(const mat of Object.values(playerTeamMats[t]))applyTeamFinish(mat,t,col,false);
  }
  for(const c of rodCustomMats)applyTeamFinish(c.mat,c.team,c.isGlow?null:(c.team===0?cfg.redColor:cfg.blueColor),c.isGlow);
}

/* Swap the men meshes on already-built rods for the current model (used when
   the player picks a different figurine from the Customize panel mid-menu). */
function rebuildRodMen(){
 rods.forEach((r,ri)=>{
  const d=RODDEFS[ri];
  r.men.forEach(m=>r.pivot.remove(m));
  const men=[];
  for(let i=0;i<r.baseZ.length;i++){
   const p=makePlayer(d.team);p.position.z=r.baseZ[i];p.position.y=PLAYER_H;
   if(d.team===1)p.rotation.y=Math.PI;r.pivot.add(p);men.push(p);
  }
  r.men=men;
 });
 shadowDirty();   // every caster on the table was just replaced
}

/* Load a freshly-selected figurine and refresh everything already on the table. */
function reloadPlayerModel(onReady){
  playerModel=[null,null];playerTeamMats[0]={};playerTeamMats[1]={};playerHairParts[0]=new Set();playerHairParts[1]=new Set();
  loadPlayerModel(()=>{applyColors();if(rods.length)rebuildRodMen();
   if(typeof ensureExplosionModel==='function'){ensureExplosionModel(activeModel(0).id);ensureExplosionModel(activeModel(1).id);} // pull in the newly-picked figurine's shatter GLB
   if(onReady)onReady();});
}
