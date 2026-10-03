'use strict';
/* ================= three.js world ================= */
let renderer,scene,camera,dirLight,hemiLight;
// room state: activeRoom, baked env cache ('syn:id' / 'glb:id'), curLeds (CONFIG.leds + room override), shared PMREM baker
let activeRoom=null,roomEnvCache={},pmremGen=null,curLeds=CONFIG.leds;
const teamMat=[null,null],teamGlow=[null,null];
let fieldMesh,fieldTexCache={},wallMat,ledMat,goalFrames=[],goalLights=[],netMats=[],groundMesh,primTable=null;
const fxLightPool=[];   // resident spare PointLights; effect glows borrow from here so the scene's light count never changes
// the procedural led material from buildTable; disposeTableSkin falls back to it. Never disposed
let primLedMat=null;
// big-goal GLB hookup per goal [left, right]: frame meshes scaled about z=0, end-wall meshes slid open
let glbGoalGrow=[[],[]],glbGoalWall=[[],[]],glbGoalSplit=[];
// glbGoalSplit: one frame mesh spanning both goals, morphed per vertex
let rods=[],indicators=[],dropRing,pinRings=[];   // indicators: one held-rod marker per seat, pinRings one pinned-ball ring per seat (fx.js drives them)
let rodCustomMats=[]; // {mat, team, isGlow} — rod GLB materials detached from teamMat/teamGlow via cloneWithMaps
let rodsDressedFor=null; // rod-set key the rods currently wear (reskinRods skips a no-op switch)
let sprites=[],spriteTex,particles,pGeo,pData=[];
let smokePuffs=[],dustRing;   // explosion smoke pool + its ground dust ring — spawned and driven by js/fx.js
let playerModel=[null,null]; const playerTeamMats=[{},{}]; const playerHairParts=[new Set(),new Set()]; const modelCache={}; const modelCacheOrder=[]; // LRU key order, most-recent at end

// --- figurine template cache (LRU) ---
// caps a cache to CONFIG.playerModel.cacheMax, evicting entries not in `protect`
function touchModelCache(order,id){const k=order.indexOf(id);if(k>=0)order.splice(k,1);order.push(id);}
function cacheModelTemplate(cache,order,id,scene){cache[id]=scene;touchModelCache(order,id);}
// free a template's GPU buffers and textures; only when no clone shares them
function disposeModelTemplate(root){
 if(!root||!root.traverse)return;
 root.traverse(c=>{if(!c.isMesh)return;
  if(c.geometry&&c.geometry.dispose)c.geometry.dispose();
  const mats=Array.isArray(c.material)?c.material:[c.material];
  for(const m of mats){if(!m)continue;
   for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap','displacementMap','lightMap']){const t=m[k];if(t&&t.dispose)t.dispose();}
   if(m.dispose)m.dispose();}});
}
// evict LRU entries past the cap; dispose:true frees the GPU too (unsafe while clones share the template)
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

// --- shared offscreen preview renderer (PRV) ---
// one WebGL context for the turntable, thumbnails and league preview; callers blit into their own 2D canvas (never give those a webgl context)
// the buffer only grows and callers render into a sub-viewport (top-left, y = bh - height) so nothing reallocates or flips
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
 // render scene into the top-left ww x hh of the shared buffer; returns [ww,hh] in device px, or null
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
 // blit into a 2D target at its backing-store size, 1:1
 draw(scene,cam,target,w,h,dpr){
  if(!target)return;
  const d=PRV.frame(scene,cam,w,h,dpr);if(!d)return;
  const ww=d[0],hh=d[1];
  if(target.width!==ww||target.height!==hh){target.width=ww;target.height=hh;}
  const ctx=target.getContext('2d');if(!ctx)return;
  ctx.clearRect(0,0,ww,hh);
  ctx.drawImage(PRV.r.domElement,0,0,ww,hh,0,0,ww,hh);   // source rect = our sub-viewport
 },
 // same, into a scratch canvas as a PNG data URL (thumbnails, studio snapshot)
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

// tone mapping rolls off light above 1.0 (needed for emissive strength); changing it recompiles; CONFIG.render.toneMapping:'none' restores the old look
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
 // bias/normalBias fight shadow acne; the box is rotated to the table, see the extents comment in config.js before tightening it
 // map size, filter and bias come from the active quality tier
 const SH=shadowQ();
 dirLight.shadow.mapSize.setScalar(SH.mapSize||2048);
 dirLight.shadow.bias=SH.bias;dirLight.shadow.normalBias=SH.normalBias;dirLight.shadow.radius=SH.radius;
 const sc=dirLight.shadow.camera;sc.left=SH.left;sc.right=SH.right;sc.top=SH.top;sc.bottom=SH.bottom;sc.far=SH.far;
 _dispShadowQ=shadowQLevel();   // the light now matches this tier — applyDisplay's first run has nothing to do
 scene.add(dirLight);
 // shadow-map freeze: autoUpdate off, shadowDirty() marks it stale when casters move
 renderer.shadowMap.autoUpdate=(SH.autoUpdate===true);
 if(!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;
 teamMat[0]=new THREE.MeshStandardMaterial({color:kitLin(cfg.redColor),roughness:.45,metalness:.15});
 teamMat[1]=new THREE.MeshStandardMaterial({color:kitLin(cfg.blueColor),roughness:.45,metalness:.15});
 teamGlow[0]=new THREE.MeshStandardMaterial({color:kitLin(cfg.redColor),emissive:kitLin(cfg.redColor),emissiveIntensity:.55,roughness:.4});
  teamGlow[1]=new THREE.MeshStandardMaterial({color:kitLin(cfg.blueColor),emissive:kitLin(cfg.blueColor),emissiveIntensity:.55,roughness:.4});
  buildTable();buildArenaTable();buildGround();buildFxPools();buildFxLightPool();buildRoomLightPool();buildBallReflect();
  scene.environment=bakeSyntheticEnv(CONFIG.rooms.open.env);   // seed a neutral reflection env so metals aren't black before applyRoom runs
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderDirty();});
  applyDisplay();   // apply saved Display settings (render scale / shadows) at boot
}

// shadow-map filter: PCFSoft is a 9-tap filter per receiver, so its cost scales with screen coverage
const SHADOW_TYPES={pcfsoft:THREE.PCFSoftShadowMap,pcf:THREE.PCFShadowMap,basic:THREE.BasicShadowMap,
 vsm:THREE.VSMShadowMap};
// active shadow tuning: CONFIG.render.shadow plus .quality.<low|high> overrides, resolved once for initThree and applyDisplay
const SHADOW_BASE={bias:-0.0002,normalBias:0.35,radius:1,left:-76,right:76,top:46,bottom:-46,far:260,
 type:'pcfsoft',mapSize:2048,autoUpdate:false};
function shadowQLevel(){return (typeof cfg!=='undefined'&&cfg.shadowQuality==='high')?'high':'low';}
function shadowQ(){
 const S=(typeof CONFIG!=='undefined'&&CONFIG.render&&CONFIG.render.shadow)||{};
 return Object.assign({},SHADOW_BASE,S,(S.quality&&S.quality[shadowQLevel()])||{});
}
function shadowMapType(){const k=String(shadowQ().type||'pcfsoft').toLowerCase();
 const t=SHADOW_TYPES[k];return t===undefined?THREE.PCFSoftShadowMap:t;}
// ===== KTX2 / BASIS TEXTURES =====
// stays compressed in VRAM (~4x smaller) and transcodes in a worker; r128 has no KTX2Loader, so vendor/ carries r137's (vendor/basis/README.md)
// every GLTFLoader must come from newGLTF() or a required KHR_texture_basisu file throws; encode with tools/ktx2-encode.mjs
let _ktx2=null,_ktx2Tried=false;
function ktx2Support(){
 if(!renderer||!renderer.extensions)return null;
 const e=renderer.extensions;
 return{astc:!!e.has('WEBGL_compressed_texture_astc'),bptc:!!e.has('EXT_texture_compression_bptc'),
        s3tc:!!e.has('WEBGL_compressed_texture_s3tc'),etc2:!!e.has('WEBGL_compressed_texture_etc'),
        etc1:!!e.has('WEBGL_compressed_texture_etc1'),pvrtc:!!e.has('WEBGL_compressed_texture_pvrtc')};
}
// the one shared KTX2Loader; lazy because detectSupport() needs the renderer
function ktx2Loader(){
 if(_ktx2Tried)return _ktx2;
 _ktx2Tried=true;
 if(typeof THREE.KTX2Loader!=='function'||!renderer){
  console.warn('KTX2Loader unavailable — KTX2 textures will not load. Check vendor/KTX2Loader.js and vendor/WorkerPool.js.');
  return _ktx2=null;
 }
 const s=ktx2Support();
 // no supported compressed format means every KTX2 texture will fail (black models)
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

// mark the shadow map stale when a caster moves or is rebuilt; also marks the frame dirty for the idle gate
function shadowMapDrop(sh){
 if(!sh)return;
 if(sh.map){sh.map.dispose();sh.map=null;}
 if(sh.mapPass){sh.mapPass.dispose();sh.mapPass=null;}
}
function shadowDirty(){if(renderer&&!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;renderDirty();}

// ===== IDLE-RENDER GATE (the menus) =====
// throttles menu rendering: a change buys `settle` seconds at full rate, the floor is `hz` so a missed hook self-heals
// renderDirty() (via shadowDirty) marks a change; never skips live phases, the room editor, photo mode, free roam or the debug overlay
let _idleT=1e9,_idleAcc=0;
const _idleCam=new THREE.Vector3(),_idleQuat=new THREE.Quaternion();
function renderDirty(){_idleT=0;}
function renderIdleSkip(rdt){
 const I=(CONFIG.render&&CONFIG.render.idle)||{};
 if(I.on===false||!renderer||!camera)return false;
 if((I.phases||['menu']).indexOf(S.phase)<0)return false;
 if(S.redit||S.photo||S.freeRoam)return false;
 if(typeof dbgOn!=='undefined'&&dbgOn)return false;
 // the frame profiler (M) needs real frames, so don't skip while it's on
 if(typeof PERF!=='undefined'&&PERF&&PERF.on)return false;
 // epsilon compare, not equality: the camera lerp asymptotes and an exact compare never settles
 // camEps is in world units, camRotEps in quaternion components, both a fraction of a pixel of motion
 const P=camera.position,Q=camera.quaternion,
       E=I.camEps===undefined?0.01:I.camEps, R=I.camRotEps===undefined?1e-4:I.camRotEps;
 if(Math.abs(P.x-_idleCam.x)>E||Math.abs(P.y-_idleCam.y)>E||Math.abs(P.z-_idleCam.z)>E||
    Math.abs(Q.x-_idleQuat.x)>R||Math.abs(Q.y-_idleQuat.y)>R||
    Math.abs(Q.z-_idleQuat.z)>R||Math.abs(Q.w-_idleQuat.w)>R){
  _idleCam.copy(P);_idleQuat.copy(Q);renderDirty();
 }
 // not testing shadowMap.needsUpdate: with shadows off r128 never clears it, so every frame would read dirty
 _idleT+=rdt;
 if(_idleT<(I.settle===undefined?0.4:I.settle)){_idleAcc=0;return false;}
 const hz=I.hz===undefined?4:I.hz;
 if(hz<=0)return true;                        // 0 = hold the last frame indefinitely
 _idleAcc+=rdt;
 if(_idleAcc>=1/hz){_idleAcc=0;return false;}
 return true;
}

// display settings (Options > Display), applied live: renderScale scales dpr, shadows toggles the pass (recompiles once, only on change), shadowQuality swaps map size, filter, bias and casters
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
   // throw the map away when size or type changes (three only allocates it, and VSM's mapPass, when null)
   if(d.mapSize.x!==S.mapSize||renderer.shadowMap.type!==t){
    d.mapSize.setScalar(S.mapSize);
    shadowMapDrop(d);
   }
   // plain uniforms, no redraw or recompile; radius is the blur half-width in texels for both PCF and VSM
   d.bias=S.bias;d.normalBias=S.normalBias;d.radius=S.radius;
  }
  if(renderer.shadowMap.type!==t){renderer.shadowMap.type=t;recompile=true;}
  // Low casts the silhouette mesh only, High every part
  refreshShadowCasters();
  _dispShadowQ=q;redraw=true;
 }
 // the map is frozen, so a discarded or newly enabled one needs this to redraw
 if(redraw)renderer.shadowMap.needsUpdate=true;
 if(recompile&&scene)scene.traverse(o=>{const m=o.material;if(!m)return;
  (Array.isArray(m)?m:[m]).forEach(mm=>{if(mm)mm.needsUpdate=true;});});
}

// scene fog (Options > Display), applied live; fog is a shader define, so it recompiles only when the state changes
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

// reflection env-maps (PMREM): scene.environment feeds every MeshStandardMaterial
// bakeSyntheticEnv: the room's `env` spec; bakeGlbEnv: baked from the room's backdrop GLB
function pmrem(){return pmremGen||(pmremGen=new THREE.PMREMGenerator(renderer));}
// fromScene returns a render target, which leaks if only its texture is freed
// the target is stashed on the texture and envDispose() is the only way to free a cached env
function envKeep(rt){const t=rt&&rt.texture;if(t){if(!t.userData)t.userData={};t.userData.__pmremRT=rt;}return t||null;}   // PMREM's internal target texture can arrive without userData
function envDispose(tex){
 if(!tex)return;
 const rt=tex.userData&&tex.userData.__pmremRT;
 if(rt&&rt.dispose)rt.dispose();   // frees the framebuffer AND its texture
 else if(tex.dispose)tex.dispose();
}
// --- baked-env residency (LRU) ---
// the bake (~6MB) outlives its room GLB so room toggles don't re-bake; cap is rooms x 2 (glb: and syn: slots), see roomenv-harness
// free through envDispose(), never tex.dispose(); memLog lists cached bakes
const envOrder=[];   // roomEnvCache keys, least-recently-used first
function touchEnv(k){const i=envOrder.indexOf(k);if(i>=0)envOrder.splice(i,1);envOrder.push(k);}
// evict bakes past the cap, LRU first; counts non-kept entries like pruneSkins/pruneRooms
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
// bake from the room model: reparent the backdrop into an isolated scene, bake, move it back (synchronous)
function bakeGlbEnv(group){
 if(!renderer||!group)return null;
 const parent=group.parent,vis=group.visible;
 const es=new THREE.Scene();
 es.add(new THREE.HemisphereLight(0xffffff,0x404040,1.0));
 group.visible=true;es.add(group);                                              // move out of the main scene (Object3D has one parent)
 // hide transparent meshes for the bake, they bake as white blobs
 const hidden=[];
 group.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
  if(o.visible&&ms.some(m=>m&&(m.transmission>0||m.transparent))){hidden.push(o);o.visible=false;}});
 const tex=envKeep(pmrem().fromScene(es,0.04,1,1200));
 for(const o of hidden)o.visible=true;                                          // restore
 if(parent)parent.add(group);else scene.add(group);                             // move it back
 group.visible=vis;
 return tex;
}

// per-room switches for the two key lights and the image-based light; off means visible=false (a zero-intensity light still costs); latched so re-applying a room is free
let _keyHemi=null,_keyDir=null,_keyDirSh=null,_keyIbl=null;
function applyRoomKeyLights(rm){
 const hOn=!(rm&&rm.hemi&&rm.hemi.on===false);
 const dOn=!(rm&&rm.dir&&rm.dir.on===false);
 // the sun casts unless the room says otherwise, and never while the Display shadow toggle is off
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
// does this room allow an image-based light?
function roomIblOn(rm){return !(rm&&rm.ibl===false);}
// local ball reflections: a shared cube camera rides the lead ball into a low-res cube used as envMap on every ball; knobs in CONFIG.ballReflect
let ballCubeRT=null,ballCube=null,ballReflN=0;
function buildBallReflect(){
 if(!renderer||ballCubeRT)return;
 const R=CONFIG.ballReflect;
 ballCubeRT=new THREE.WebGLCubeRenderTarget(R.res,{format:THREE.RGBAFormat,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
 ballCubeRT.texture.encoding=THREE.sRGBEncoding;                                // renderer outputs sRGB → decode env the same way (matches PMREM path)
 ballCube=new THREE.CubeCamera(R.near,R.far,ballCubeRT);
}
function ballReflectOn(){return !!(renderer&&ballCubeRT&&cfg.reflections&&CONFIG.ballReflect.on);}
// set or clear the cube envMap under a ball (needsUpdate only on a real change); authored envMapIntensity is stashed and restored when clearing
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
 // suppress the shadow pass while the cube renders (autoUpdate alone isn't enough); both flags go down for the 6 faces and needsUpdate goes back to the main render
 const sa=renderer.shadowMap.autoUpdate,sn=renderer.shadowMap.needsUpdate;
 renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;      // 6 faces reuse the map already on the card
 const vis=lead.m.visible;lead.m.visible=false;                                 // don't let the ball reflect itself
 ballCube.position.copy(lead.m.position);ballCube.update(renderer,scene);
 lead.m.visible=vis;renderer.shadowMap.autoUpdate=sa;renderer.shadowMap.needsUpdate=sn;
}

function buildTable(){
 // primitive table lives in primTable so a loaded GLB table can hide it wholesale (see models.js)
 primTable=new THREE.Group();scene.add(primTable);tableGroups.classic=primTable;
 const fieldMat=new THREE.MeshStandardMaterial({roughness:.85});
 fieldMesh=new THREE.Mesh(new THREE.PlaneGeometry(F.L,F.W),fieldMat);
 fieldMesh.rotation.x=-Math.PI/2;fieldMesh.receiveShadow=true;primTable.add(fieldMesh);
  // load only the active pitch's texture, the rest on demand via drawField > loadPitchTex
  // skipped when the pitch has a GLB (the JPEG would be a wasted download)
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
 // --- goal cages: round posts, crossbar, back frame, diamond-mesh net, on the goal line x=±L/2 ---
 const netTex=makeNetTex();
 [-1,1].forEach((sx,i)=>{
  const g=new THREE.Group();g.position.set(sx*(F.L/2),0,0);   // group sits ON the goal line; net extends outward
  const GH=F.goalH,GHW=F.goalHalf,GD=F.goalDepth,PR=.6;
  const frameM=new THREE.MeshStandardMaterial({color:0xf2f5ff,emissive:0xcdd8ff,emissiveIntensity:.25,roughness:.35,metalness:.65});
  // front posts and crossbar get their own sub-group so a table GLB's 'goal_frame' can replace them (applyTable hides g.userData.front)
  const gf=new THREE.Group();g.add(gf);g.userData.front=gf;
  const postG=new THREE.CylinderGeometry(PR,PR,GH,16);         // front uprights, on the goal line
  [-1,1].forEach(sz=>{const p=new THREE.Mesh(postG,frameM);p.position.set(0,GH/2,sz*GHW);p.castShadow=true;gf.add(p);});
  const bar=new THREE.Mesh(new THREE.CylinderGeometry(PR,PR,GHW*2,16),frameM);   // crossbar (along z)
  bar.rotation.x=Math.PI/2;bar.position.set(0,GH,0);bar.castShadow=true;gf.add(bar);
  // net: one team-tinted material per goal (applyColors); the roof is a solid collider (goalFrameCollide)
  const netM=new THREE.MeshStandardMaterial({color:kitLin(i?cfg.blueColor:cfg.redColor),map:netTex,transparent:true,opacity:.85,roughness:.9,side:THREE.DoubleSide,depthWrite:false});
  netMats.push(netM);
  g.userData.net=buildGoalNet(g,sx*GD,GHW,GH,netM);   // swept cage; panels collected so bigGoalUpdate can taper the back
  const gl=new THREE.PointLight(0xffffff,0,70);gl.position.set(sx*5,GH+7,0);g.add(gl);goalLights.push(gl);
  goalFrames.push(g);scene.add(g);});
 tablePrimObjs.classic=primTable.children.filter(c=>c.isMesh&&c!==fieldMesh);  // procedural fallback (hidden when a skin GLB is shown)
}

// --- procedural goal net ---
// one cross-section (netProfile) swept to the rear plane plus a back cap, so top creases can be rounded (CONFIG.goalNet.bevel); one geometry, 2 draws per goal
function makeNetTex(){
 const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
 x.clearRect(0,0,64,64);x.strokeStyle='rgba(255,255,255,.85)';x.lineWidth=1.5;
 for(let k=-64;k<=64;k+=10){x.beginPath();x.moveTo(k,0);x.lineTo(k+64,64);x.stroke();
  x.beginPath();x.moveTo(k,64);x.lineTo(k+64,0);x.stroke();}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
// cage outline as [z,y] pairs; hw/gh = half-width/height here; r and n come from the caller so both profiles have matching point counts
function netProfile(hw,gh,r,n){
 const p=[[-hw,0]];
 if(r<=1e-4)p.push([-hw,gh],[hw,gh]);                          // r=0 → the original hard corner
 else{p.push([-hw,gh-r]);                                      // up the −z wall to where the round starts
  for(let k=1;k<=n;k++){const t=k/n*Math.PI/2;p.push([-(hw-r)-r*Math.cos(t),gh-r+r*Math.sin(t)]);}
  for(let k=n;k>=1;k--){const t=k/n*Math.PI/2;p.push([(hw-r)+r*Math.cos(t),gh-r+r*Math.sin(t)]);}
  p.push([hw,gh-r]);}                                          // …and back down the +z wall
 p.push([hw,0]);return p;
}
// one merged net panel; `base` is the vertex array bigGoalUpdate tapers against
function netGeo(pos,uv,idx,mat){
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geo.setIndex(idx);geo.computeVertexNormals();
 const m=new THREE.Mesh(geo,mat);m.userData.base=Float32Array.from(pos);return m;
}
// sweep the profile from the goal line to the rear plane at bx*backInset; adds both meshes to g
function buildGoalNet(g,bx,ghw,gh,mat){
 const GN=CONFIG.goalNet,cell=GN.cell,r=clamp(GN.bevel.r,0,Math.min(ghw,gh)*.5),n=Math.max(1,GN.bevel.segs|0),
       BX=bx*GN.backInset,bw=ghw*GN.backInset,                 // rear plane: same inset on depth and width
       fp=netProfile(ghw,gh,r,n),bp=netProfile(bw,gh,r,n),P=fp.length;
 // shell: one quad per profile segment; u follows real profile length, v is a shared sweep depth
 const pos=[],uv=[],idx=[],rv=Math.abs(BX)/cell;let u=0,o=0;
 for(let k=0;k<P;k++){const j=(k+1)%P,a=fp[k],b=fp[j],c=bp[j],d=bp[k],
   u2=u+Math.hypot(b[0]-a[0],b[1]-a[1])/cell;
  pos.push(0,a[1],a[0], 0,b[1],b[0], BX,c[1],c[0], BX,d[1],d[0]);
  uv.push(u,0, u2,0, u2,rv, u,rv);idx.push(o,o+1,o+2,o,o+2,o+3);o+=4;u=u2;}
 const shell=netGeo(pos,uv,idx,mat);g.add(shell);
 // back cap: the rear profile is convex, so fan it off the first point; planar UVs keep the cell size
 const cp=[],cu=[],ci=[];
 for(let k=0;k<P;k++){cp.push(BX,bp[k][1],bp[k][0]);cu.push(bp[k][0]/cell,bp[k][1]/cell);}
 for(let k=1;k<P-1;k++)ci.push(0,k,k+1);
 const cap=netGeo(cp,cu,ci,mat);g.add(cap);
 return [shell,cap];
}

// stand-in backdrop for a room with no GLB (missing, or still downloading): a ground plane only
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
     mat.color.copy(kitLin(team===0?cfg.redColor:cfg.blueColor));
     playerTeamMats[team][name]=mat;
    });
    done();
   };
  if(modelCache[am.id]){touchModelCache(modelCacheOrder,am.id);useCache(modelCache[am.id]);return;}
  newGLTF().load(am.src,
   gltf=>{cacheModelTemplate(modelCache,modelCacheOrder,am.id,gltf.scene);useCache(gltf.scene);
    // evict old templates (ref-drop only, live clones may share them); the two active figurines are protected
    capModelCache(modelCache,modelCacheOrder,new Set([activeModel(0).id,activeModel(1).id]),false);},
   undefined,
   ()=>{console.warn('player model load failed for team '+team);done();}
  );
 });
}

// measure a template's sub-meshes and stamp each one's size as a fraction of the whole (casterFrac, CONFIG.render.shadow.quality); non-casters are still drawn
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

// does this sub-mesh go into the shadow pass? follows the active shadow quality; 0 = every part
function partCasts(o){
 const frac=shadowQ().casterFrac;
 if(!(frac>0)||o.userData._shBig)return true;
 return (o.userData._shFrac||1)>=frac;
}

// re-decide casters on every man on the table after a Shadow quality change (draw list only, no recompile)
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

// handle-collar z: wallClear past the outer wall face even at full slide
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
     // player shot verbs (js/shots.js): chg = charge 0..1 (-1 = idle), chgA = wind-up angle, shotOn/Pow/Ctl = what the next contact is worth (all physics reads), trem is display-only
     chg:-1,chgRel:0,chgMod:null,chgA:null,chgSrc:null,chgHeld:0,chgSweet:false,trem:0,
     shotOn:false,shotPow:1,shotCtl:1,shotTrack:1,shotExert:1,
     // the player's hold, in the shape holdCfg's consumers read (CONFIG.ai.trap/.dribble); mutated in place
     hold:{on:false,holdRest:KICK.rest,holdGrip:KICK.grip,carryMult:1},
    behindFlag:false,act:null,actT:0,trapMan:-1,trapDir:0,trapZ0:0,trapA:null,laneDir:0,laneCd:0,
     dribMan:-1,dribZ:0,dribZ0:0,dribCd:0,dribEvT:0,passTo:null,passEv:null,passEvT:0,
     aiErr:0,aiErrT:0,aiErrTarget:0,aiBX:0,aiBZ:0,aiBVX:0,aiBVZ:0,aiGoalZ:0,
     // match stats (js/matchstats.js): msSw = one-attempt-per-swing latch, msB/msBFor = stat bucket cached against its S.stats
     msSw:false,msB:null,msBFor:null,
     removedUntil:[]};
    rods.push(r);
    dressRod(r,tid);                                  // hang the rod's hardware visual (GLB set or primitive)
  });
  rodsDressedFor=(typeof rodSetKey==='function')?rodSetKey(tid):'_shared';
  refreshRodCustomMats();
 }

// (re)build one rod's hardware on its pivot: the table's GLB rod if it has this size, else the primitive; also the table-switch reskin
function dressRod(r,tid){
 // detach, don't dispose: GLB clones and the primitives share geometry and materials
 if(r.rodModel){r.pivot.remove(r.rodModel);r.rodModel=null;}
 if(r.rodBar){r.pivot.remove(r.rodBar);r.rodBar=null;}
 if(r.handle){r.pivot.remove(r.handle);r.handle=null;}
 if(r.collar){r.pivot.remove(r.collar);r.collar=null;}
 const rodModel=makeRodModel(r.men.length,r.team,tid);   // GLB rod if the set has this size, else null
 if(rodModel){r.pivot.add(rodModel);r.rodModel=rodModel;return;}
 // primitive fallback; bar reaches collar+cap each end, handle hides the near tip
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

// rebuild rodCustomMats (rod GLB team-colour materials); run after any dressRod pass
function refreshRodCustomMats(){
 rodCustomMats=[];
 rods.forEach(r=>{if(r.rodModel&&r.rodModel.userData.teamClones)
  r.rodModel.userData.teamClones.forEach(c=>rodCustomMats.push({mat:c.mat,team:r.rodModel.userData.team,isGlow:c.isGlow}));});
}

// swap every rod's hardware to tableId's rod set (from applyTable); visual only
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

// one lumpy smoke puff drawn on a canvas at boot; three handed out round-robin, border feathered
function makeSmokeTex(){
 const N=128,cv=document.createElement('canvas');cv.width=cv.height=N;
 const c=cv.getContext('2d');
 // five fat blobs, dense in the middle and off-centre; more would average back into a plain disc
 for(let i=0;i<5;i++){
  const a=rand(0,Math.PI*2),d=rand(N*.05,N*.16),x=N/2+Math.cos(a)*d,y=N/2+Math.sin(a)*d,r=rand(N*.2,N*.28);
  const g=c.createRadialGradient(x,y,r*.15,x,y,r);
  g.addColorStop(0,'rgba(255,255,255,.85)');
  g.addColorStop(.45,'rgba(255,255,255,.42)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=g;c.fillRect(0,0,N,N);
 }
 // feather ONLY the last few pixels, or the mask sands the ragged edge straight back off
 const m=c.createRadialGradient(N/2,N/2,N*.4,N/2,N/2,N*.5);
 m.addColorStop(0,'rgba(0,0,0,1)');m.addColorStop(1,'rgba(0,0,0,0)');
 c.globalCompositeOperation='destination-in';c.fillStyle=m;c.fillRect(0,0,N,N);
 return new THREE.CanvasTexture(cv);
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
 // held-rod markers, one per seat (CONFIG.seats.max); resident, shared geometry, one material each for the seat colour
 const indGeo=new THREE.ConeGeometry(1.7,3.4,4);
 indicators=[];
 for(let i=0;i<CONFIG.seats.max;i++){
  const m=new THREE.Mesh(indGeo,new THREE.MeshBasicMaterial({color:0xffffff}));
  m.rotation.x=Math.PI;m.visible=false;scene.add(m);indicators.push(m);
 }
 // pinned-ball rings, one per seat: a unit ring (outer radius 1) that fx.js only scales and moves
 const pinGeo=new THREE.RingGeometry(SHOT.pin.mark.inner,1,40);
 pinRings=[];
 for(let i=0;i<CONFIG.seats.max;i++){
  const m=new THREE.Mesh(pinGeo,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  m.rotation.x=-Math.PI/2;m.visible=false;m.userData={a:0,x:0,z:0,col:null};scene.add(m);pinRings.push(m);
 }
 // --- explosion smoke (CONFIG.fx.smoke; fx.js smokeBurst / smokeUpdate) ---
 // normal blending (additive can only brighten), toneMapped:false; resident like the other pools
 const SM=CONFIG.fx.smoke;
 if(SM&&SM.on){
  const stex=[makeSmokeTex(),makeSmokeTex(),makeSmokeTex()];
  for(let i=0;i<SM.count;i++){
   const m=new THREE.SpriteMaterial({map:stex[i%stex.length],transparent:true,opacity:0,
     blending:THREE.NormalBlending,depthWrite:false,toneMapped:false});
   const s=new THREE.Sprite(m);
   s.visible=false;
   s.renderOrder=-1;      // drawn under the additive fire, so the flames read THROUGH the cloud
   s.userData={life:0,max:0,wait:0,vx:0,vz:0,size:1,alpha:0,spin:0};
   scene.add(s);smokePuffs.push(s);
  }
  if(SM.ring&&SM.ring.on){
   // a unit ring (outer radius 1); smokeBurst only scales it
   dustRing=new THREE.Mesh(new THREE.RingGeometry(.58,1,48),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,
      side:THREE.DoubleSide,toneMapped:false}));
   dustRing.rotation.x=-Math.PI/2;dustRing.position.y=SM.ring.y;
   dustRing.visible=false;dustRing.renderOrder=-1;scene.add(dustRing);
  }
 }
 buildMarkPool();   // wall scuffs — one batched mesh of its own (js/marks.js)
}

// ===== fx light pool =====
// r128 bakes the light count into every shader, so effects borrow from a fixed set of PointLights (intensity 0) instead of adding one; sized by CONFIG.fx.lightPool
function buildFxLightPool(){
 const n=(CONFIG.fx&&CONFIG.fx.lightPool)||0;
 for(let i=0;i<n;i++){const l=new THREE.PointLight(0xffffff,0,40);l.visible=true;l._fxFree=true;scene.add(l);fxLightPool.push(l);}
}
// borrow a resident fx light (colour and falloff set, intensity 0 for the caller); null when exhausted
function fxLightGet(color,dist){
 for(const l of fxLightPool){if(!l._fxFree)continue;
  l._fxFree=false;l.color.set(color);l.distance=dist||40;l.intensity=0;return l;}
 return null;
}
// return a borrowed light (intensity 0, marked free); never scene.remove it, that changes the light count
function fxLightPut(l){if(!l)return;l.intensity=0;l._fxFree=true;}

// --- authored room lights (rooms.<id>.lights) ---
// the second pool, for the same reason; sized per type from every room's lights plus roomLightPool.pad spares only when the room editor is on
// authored lights are plain three.js units, unlike a GLB's baked KHR_lights_punctual (candela transfer in models.js)
const roomLightPool={point:[],spot:[],dir:[]};
function rlpNeed(){
 const P=(CONFIG.render&&CONFIG.render.roomLightPool)||{};
 const cap=P.max===undefined?12:P.max;
 const n={point:0,spot:0,dir:0};
 for(const id in CONFIG.rooms){
  const c={point:0,spot:0,dir:0};
  // count a room's lights per type and how many want to cast; the plain pool needs whatever the shadow budget can't absorb
  const w={point:0,spot:0,dir:0};
  ((CONFIG.rooms[id]||{}).lights||[]).forEach(L=>{const t=rlpType(L);if(c[t]===undefined)return;
   c[t]++;if(rlpWantsShadow(L))w[t]++;});
  const shN=rlpShadowNeed();
  for(const t in c)c[t]=Math.max(0,c[t]-Math.min(w[t],shN[t]||0));
  for(const t in n)if(c[t]>n[t])n[t]=c[t];
 }
 // editor headroom, only for a build with the room editor on
 const on=!!(CONFIG.debug&&CONFIG.debug.roomEditor);
 const P2=(P.pad&&typeof P.pad==='object')?P.pad:{point:P.pad,spot:P.pad,dir:P.pad};
 for(const t in n){const pad=on?(P2[t]===undefined?4:P2[t]):0;n[t]=Math.min(n[t]+pad,cap);}
 return n;
}
function rlpType(L){const t=(L&&L.type)||'point';return t==='spot'?'spot':(t==='dir'||t==='directional')?'dir':'point';}
function rlpWantsShadow(L){return !!(L&&L.shadow);}
// the shadow sub-pool: castShadow is a shader parameter so these are created casting and stay that way
// sized from CONFIG.render.roomLightPool.shadow, a deliberate budget (a point light is six passes)
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
// every pooled light keeps its own target in the scene or its matrix never updates
function rlpAdd(t,l,cast,mapSize){
 l.visible=true;l.intensity=0;l.castShadow=!!cast;l._rlFree=true;
 if(cast&&l.shadow){l.shadow.mapSize.setScalar(mapSize||1024);l.shadow.bias=-0.0015;l.shadow.normalBias=0.6;
  // a free shadow slot must not cost a pass: castShadow stays true, per-light autoUpdate/needsUpdate skips it
  l.shadow.autoUpdate=false;l.shadow.needsUpdate=false;
  if(l.shadow.camera&&l.shadow.camera.isPerspectiveCamera){l.shadow.camera.near=1;l.shadow.camera.far=600;}}
 scene.add(l);
 if(l.target){l.target.position.set(0,0,0);scene.add(l.target);}
 (cast?roomShadowPool:roomLightPool)[t].push(l);
}
// borrow a slot; falls back to a plain slot when the shadow budget is spent
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
// drive the pool from one room's lights: a full re-drive, so it never disagrees with the spec list
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

// the pitch group currently parented into the table, so applyTable can re-parent it when the table changes
let pitchShown=null;
// lazy pitch-texture loader/cache (only the JPG fallback path uses it)
function loadPitchTex(pid,cb){
  if(fieldTexCache[pid]){if(cb)cb(fieldTexCache[pid]);return;}
  const pdef=CONFIG.pitches[pid];
  if(!pdef){if(cb)cb(null);return;}
  new THREE.TextureLoader().load('assets/'+pdef.tex,tex=>{
   tex.encoding=THREE.sRGBEncoding;tex.anisotropy=4;fieldTexCache[pid]=tex;if(cb)cb(tex);
  },undefined,()=>{console.warn('pitch texture missing (assets/'+pdef.tex+')');if(cb)cb(null);});
}
// show the selected pitch (fetch its GLB if needed, evict the rest); same shape as applyRoom: show, load, show again
// inactive pitches are detached, not hidden (renderer.compile uploads every reachable material); onReady fires once resident
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
    // fallbackTex only if the GLB didn't land (dressing the plane meanwhile is a second download)
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

// pick the room's reflection env (synthetic or baked from the GLB), cache and install it; re-run when the room, its loaded state or cfg.reflections changes
function setRoomEnv(id,rm){
 if(!renderer||!scene)return;
 // rooms.<id>.ibl:false = no image-based light and no bake
 if(!roomIblOn(rm)){scene.environment=null;return;}
 const glbReady=!!(roomGroups[id]&&roomGroups[id].children.length);
 const wantGlb=!!(cfg.reflections&&rm.reflect);
 const gk='glb:'+id, sk='syn:'+id;
 // a cached GLB bake is usable before the GLB is back; glbReady only decides whether we can bake
 let key=(wantGlb&&(glbReady||roomEnvCache[gk]))?gk:sk;
 if(!roomEnvCache[key]&&key===gk){
  if(glbReady)roomEnvCache[gk]=bakeGlbEnv(roomGroups[id]);
  if(!roomEnvCache[gk])key=sk;                            // never baked, or the bake failed
 }
 if(!roomEnvCache[key])roomEnvCache[key]=bakeSyntheticEnv(rm.env);
 if(roomEnvCache[key]){scene.environment=roomEnvCache[key];touchEnv(key);}
 pruneEnvs(key);
}
// apply the selected room: backdrop colour, fog, lighting, LED mood, reflection env, backdrop geometry; onReady fires once its GLB is resident (sync if cached)
function applyRoom(onReady){
 const id=CONFIG.rooms[cfg.room]?cfg.room:'open';
 const rm=CONFIG.rooms[id];activeRoom=rm;
 // sky (rooms.<id>.sky, models.js ensureSky): a resident one goes on at once, else the flat bg holds; set before pruneSkies
 const wantSky=(typeof roomHasSky==='function')&&roomHasSky(id);
 scene.background=(wantSky&&skyCache[id])||new THREE.Color(rm.bg);
 applyFog();                                             // honours cfg.fog; reads THIS room's near/far
 if(hemiLight&&rm.hemi){hemiLight.color.set(rm.hemi.sky);hemiLight.groundColor.set(rm.hemi.ground);hemiLight.intensity=rm.hemi.int;}
 if(dirLight&&rm.dir){dirLight.color.set(rm.dir.color);dirLight.intensity=rm.dir.int;if(rm.dir.pos)dirLight.position.set(rm.dir.pos[0],rm.dir.pos[1],rm.dir.pos[2]);}
 applyRoomKeyLights(rm);
 // LED mood: room override over CONFIG.leds; a 'hold' idle seeds the strip colour, 'rainbow' is per-frame
 curLeds=Object.assign({},CONFIG.leds,rm.led||{});
 if(curLeds.idle!=='rainbow'&&ledMat){const c=(rm.led&&rm.led.color)||0x38e0ff;ledMat.color.set(c);if(ledMat.emissive)ledMat.emissive.set(c);}
 // is a backdrop GLB worth waiting for? roomHasGlb is false for no glb and for a 404'd file
 const wantGlb=(typeof roomHasGlb==='function')?roomHasGlb(id):!!rm.glb;
 // show the active backdrop, hide the rest; the shared ground stands in when it isn't on screen; async paths check live() so a stale room can't re-show props
 const live=()=>activeRoom===rm;
 const show=()=>{
  if(!live())return;
  shadowDirty();   // room/backdrop/props swapped, and the glb + props both land async
  const on=!!(roomGroups[id]&&roomGroups[id].children.length);
  for(const rid in roomGroups){if(roomGroups[rid])roomGroups[rid].visible=(rid===id&&on);}
  const fill=!on&&rm.backdrop!==false;   // backdrop:false = a TRUE void (bg + fog only), no stand-in
  // props are a separate group per room (js/props.js), not parented to the backdrop (its children.length decides the ground fallback)
  if(typeof propGroups!=='undefined')for(const pid in propGroups)propGroups[pid].visible=(pid===id);
  if(groundMesh)groundMesh.visible=fill;
 };
 show();setRoomEnv(id,rm);
 applyAuthoredLights(rm);                                // rooms.<id>.lights — pooled, so no recompile
 if(typeof buildRoomProps==='function')buildRoomProps(id,rm,show);
 // onReady fires once, when both the backdrop and the sky are resident
 let wait=2;const ready=()=>{if(--wait===0&&onReady)onReady();};
 if(wantSky&&typeof ensureSky==='function'){
  ensureSky(id,t=>{
   if(t&&live()){scene.background=t;renderDirty();}          // switched away meanwhile → leave it cached
   if(typeof pruneSkies==='function')pruneSkies(live()?id:null);
   ready();
  });
 }else{
  if(typeof pruneSkies==='function')pruneSkies(null);
  ready();
 }
 if(wantGlb&&typeof ensureRoom==='function'){
  ensureRoom(id,()=>{                                    // GLB resident: reveal it + upgrade env to the real reflection bake
   if(live()){show();setRoomEnv(id,rm);if(typeof pruneRooms==='function')pruneRooms(id);}
   else if(typeof pruneRooms==='function')pruneRooms(CONFIG.rooms[cfg.room]?cfg.room:'open');   // landed after we left: free it
   ready();
  });
 }else{
  if(typeof pruneRooms==='function')pruneRooms(null);
  ready();
 }
}
// kit colour for a material: r128 reads a hex as linear but the renderer outputs sRGB, so a raw swatch looks lighter and greyer; HUD and CSS take the hex as-is
function kitLin(hex){return new THREE.Color(hex).convertSRGBToLinear();}
function applyColors(){
 const K=[kitLin(cfg.redColor),kitLin(cfg.blueColor)];
 for(let t=0;t<2;t++){
  teamMat[t].color.copy(K[t]);
  for(const mat of Object.values(playerTeamMats[t]))mat.color.copy(K[t]);
  teamGlow[t].color.copy(K[t]);teamGlow[t].emissive.copy(K[t]);
  netMats[t].color.copy(K[t]);
 }
 for(const c of rodCustomMats){c.mat.color.copy(K[c.team]);if(c.isGlow)c.mat.emissive.copy(K[c.team]);c.mat.needsUpdate=true;}
 document.documentElement.style.setProperty('--c0',cfg.redColor);
 document.documentElement.style.setProperty('--c1',cfg.blueColor);
 applyFinish();drawField();
 renderDirty();   // kit/finish change: nothing MOVED, so shadowDirty never fires for it
}

// surface finish (metalness, roughness, emissive) from Customize, pushed onto every live team material
function applyFinish(){
  const K=[kitLin(cfg.redColor),kitLin(cfg.blueColor)];   // linear, like the colour itself (see kitLin)
  for(let t=0;t<2;t++){
    applyTeamFinish(teamMat[t],t,K[t],false);
    applyTeamFinish(teamGlow[t],t,null,true);
    for(const mat of Object.values(playerTeamMats[t]))applyTeamFinish(mat,t,K[t],false);
  }
  for(const c of rodCustomMats)applyTeamFinish(c.mat,c.team,c.isGlow?null:K[c.team],c.isGlow);
}

// swap the men meshes on built rods for the current figurine
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
