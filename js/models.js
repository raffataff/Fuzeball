'use strict';
// ================= GLB table + rod + ball loaders =================
// optional: the primitives from world.js/balls.js stay as the fallback when a file is missing
const rodSets={};        // rod-set key -> {men:scene, _done:true}; '_shared' = stock assets/rods/, a table id = its own livery
const rodSetLoading={};   // rod-set key -> [pending cbs] while its load batch is in flight
const ROD_SIZES=[1,2,3,5];
let ballModel=null;      // loaded ball GLB scene (with material slots)
let roomModel=null;      // deprecated: room GLBs live in roomGroups[id] (arena.js); kept to avoid a dangling ref
// pitches are per-id groups in pitchGroups, see the pitch block below
const ballMatMap={};     // ballType -> material name in GLB
const pitchMatMap={};    // pitch variant -> material (unused for now; mirrors ball loader)
const explosionTemplates={}; // figurine id -> {scene, clips} (explosionSrc); lazy, only figurines on the table
const explosionLoading={};    // figurine id -> true while its GLB fetch is in flight
let ballExplosionTemplate=null; // {scene, clips}: the cannonball's shatter GLB, used by fracture.js spawnBallFracture
let respawnSwirlTemplate=null;  // {scene, clips}: the shared respawn-swirl GLB, used by fracture.js spawnRespawnSwirl

// --- static table ---
// lazy by default (CONFIG.tableAssets): boot fetches only the active table's skin and room, LRU-evicted; preloadAll restores the eager boot
// groups for every table are still created here (applyTable walks tableGroups)
function loadTableModel(){
 // prop index first: applyRoom may place props; a missing manifest never gates
 if(typeof loadPropManifest==='function'&&!loadTableModel._props){loadTableModel._props=1;
  loadPropManifest(()=>{if(typeof applyRoom==='function')applyRoom();});}
 const eager=!!(CONFIG.tableAssets&&CONFIG.tableAssets.preloadAll);
 const cur=(typeof cfg!=='undefined'&&CONFIG.tables[cfg.table])?cfg.table:'classic';
 for(const id in CONFIG.tables){
  if(!tableGroups[id]){tableGroups[id]=new THREE.Group();scene.add(tableGroups[id]);}
  if(!eager&&id!==cur)continue;                    // lazy: everything but the active table waits for a pick
  const sk=(typeof curSkin==='function')?curSkin(id):null;
  if(sk)loadSkin(id,sk,()=>{applyTable();applyRoom();applyColors();drawField();});
 }
 // rooms are their own axis: boot fetches only the active backdrop; preloadAll fetches all
 if(eager){for(const id in CONFIG.rooms)ensureRoom(id);}
 else{const rm=(typeof cfg!=='undefined'&&CONFIG.rooms[cfg.room])?cfg.room:'open';ensureRoom(rm,()=>{if(typeof applyRoom==='function')applyRoom();});}
}

// --- skin residency (LRU) ---
// skinOrder holds 'id/skinId' keys, least-recently-used first (rooms use roomOrder); the active skin and room are protected
const skinOrder=[],roomOrder=[];
const skinLoadingCbs={};   // 'id/skinId' -> pending cbs while that skin's fetch is in flight
function skinKey(id,skinId){return id+'/'+skinId;}
function touchSkin(id,skinId){const k=skinKey(id,skinId),i=skinOrder.indexOf(k);if(i>=0)skinOrder.splice(i,1);skinOrder.push(k);}
function touchRoom(id){const i=roomOrder.indexOf(id);if(i>=0)roomOrder.splice(i,1);roomOrder.push(id);}

// load one skin into its own sub-group, cached by id/skin; a missing GLB drops the empty group so applySkin falls back to primitives; cb runs on success or failure
function loadSkin(id,skinId,cb){
 skinGroups[id]=skinGroups[id]||{};
 const key=skinKey(id,skinId);
 const existing=skinGroups[id][skinId];
 // 'loaded' means the sub-group has meshes, not just the placeholder; an in-flight fetch queues the cb
 if(existing&&existing.children.length){touchSkin(id,skinId);if(cb)cb();return;}
 if(skinLoadingCbs[key]){if(cb)skinLoadingCbs[key].push(cb);touchSkin(id,skinId);return;}
 const T=CONFIG.tables[id],S=T&&T.skins&&T.skins[skinId];
 if(!S){if(cb)cb();return;}
 if(!tableGroups[id]){tableGroups[id]=new THREE.Group();scene.add(tableGroups[id]);}
 const grp=existing||new THREE.Group();grp.visible=false;
 if(!existing){tableGroups[id].add(grp);skinGroups[id][skinId]=grp;}
 touchSkin(id,skinId);
 const cbs=skinLoadingCbs[key]=cb?[cb]:[];
 const flush=()=>{delete skinLoadingCbs[key];cbs.forEach(f=>f&&f());};
 const loader=newGLTF();
 const hook=gltf=>{
  try{
   let hasFrame=false;
   // pre-scan: a skin with goal_frame_l/r wins over the legacy goal_post/goal_crossbar, which are hidden below
   let hasNewFrame=false;
   gltf.scene.traverse(c=>{if(c.isMesh&&onm(c).startsWith('goal_frame'))hasNewFrame=true;});
   gltf.scene.traverse(c=>{
    if(!c.isMesh)return;
    c.castShadow=true;c.receiveShadow=true;
    c.userData.skinKey=key;                        // ownership stamp — read by disposeTableSkin's registry sweep
    const n=onm(c);
    if(n.startsWith('field'))c.visible=false;       // themed pitch plane stays instead
    else if(n.startsWith('led')){ledMat=c.material;(skinLed[id]=skinLed[id]||{})[skinId]=c.material;} // applySkin repoints LED fx per active skin
    else if(n.startsWith('goal_net'))c.visible=false;                            // keep the built-in diamond net
    else if(/^(goal_post|goal_crossbar)/.test(n)){hasFrame=true;if(hasNewFrame)c.visible=false;} // legacy posts/crossbar: count as a custom frame but are hidden if goal_frame_l/r is present
    else if(n.startsWith('goal_frame'))hasFrame=true;                            // custom posts: hide the primitive front frame
   });
   (skinHasFrame[id]=skinHasFrame[id]||{})[skinId]=hasFrame;
   applyEmissiveStrength(gltf.scene);               // r128 ignores KHR_materials_emissive_strength
   grp.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
   registerBigGoalMeshes(gltf.scene);               // wire baked frame + end-walls into the big-goal widen
   registerRodHoles(gltf.scene,id,skinId);          // wire the rod-hole rings into the stamina readout
   if(T.collision==='bowl')registerArenaMorph(gltf.scene); // bowl shells open via SDF re-projection
   console.log(S.glb+' loaded ('+id+'/'+skinId+')');
  }catch(e){console.warn('skin GLB hookup failed',e);}
  flush();
 };
 const fail=()=>{
  tableGroups[id].remove(grp);delete skinGroups[id][skinId];    // no GLB -> fall back to primitives
  const oi=skinOrder.indexOf(key);if(oi>=0)skinOrder.splice(oi,1);
  console.warn('skin GLB missing for '+id+'/'+skinId+' ('+(T.folder||'')+S.glb+')');
  flush();
 };
 const primary=(T.folder||'')+S.glb;
 loader.load(primary,hook,undefined,()=>{S.glbFallback?loader.load(S.glbFallback,hook,undefined,fail):fail();});
}

// free one loaded skin: unregister its meshes from the big-goal and arena-morph registries, detach, dispose
// safe to hard-dispose (a skin GLB is never cloned); never on the skin on screen
function disposeTableSkin(id,skinId){
 const grp=skinGroups[id]&&skinGroups[id][skinId];if(!grp)return;
 if(!grp.children.length)return;   // sub-group exists but the GLB hasn't landed — leave the in-flight load alone
 const key=skinKey(id,skinId),mine=o=>o&&o.userData&&o.userData.skinKey===key;
 for(let gi=0;gi<2;gi++){
  glbGoalGrow[gi]=glbGoalGrow[gi].filter(o=>!mine(o));
  glbGoalWall[gi]=glbGoalWall[gi].filter(e=>!mine(e.o));
 }
 glbGoalSplit=glbGoalSplit.filter(e=>!mine(e.o));
 if(typeof arenaMorph!=='undefined'){arenaMorph=arenaMorph.filter(e=>!mine(e.o));arenaMorphDirty=true;} // force one restore pass over what's left
 if(skinLed[id]&&skinLed[id][skinId]){
  if(ledMat===skinLed[id][skinId])ledMat=primLedMat;   // don't leave the LED fx driving a freed material
  delete skinLed[id][skinId];
 }
 if(skinHasFrame[id])delete skinHasFrame[id][skinId];
 if(skinRodHoles[id]&&skinRodHoles[id][skinId]){
  if(rodHoleMeshes===skinRodHoles[id][skinId])rodHoleMeshes=[];   // don't leave fx.js driving freed materials
  delete skinRodHoles[id][skinId];
 }
 if(tableGroups[id])tableGroups[id].remove(grp);
 delete skinGroups[id][skinId];
 const oi=skinOrder.indexOf(key);if(oi>=0)skinOrder.splice(oi,1);
 disposeModelTemplate(grp);                            // shared GPU-free helper (world.js)
 console.log('table skin freed: '+key);
}

// evict skins past their caps, LRU first; keep* are on screen and never freed
// counts non-kept entries, so cacheSkins:1 holds nothing extra; called once a switch has settled
function pruneSkins(keepSkin){
 const extraS=Math.max(0,((CONFIG.tableAssets||{}).cacheSkins||1)-1);
 let nS=0;for(const k of skinOrder)if(k!==keepSkin)nS++;
 for(let i=0;i<skinOrder.length&&nS>extraS;){
  const k=skinOrder[i];
  if(k===keepSkin){i++;continue;}
  const s=k.indexOf('/');disposeTableSkin(k.slice(0,s),k.slice(s+1));   // splices k out of skinOrder itself
  if(skinOrder[i]===k)i++;else nS--;                                    // guard: only count down on a real removal
 }
}
function pruneRooms(keepRoom){
 const extraR=Math.max(0,((CONFIG.tableAssets||{}).cacheRooms||1)-1);
 let nR=0;for(const id of roomOrder)if(id!==keepRoom)nR++;
 for(let i=0;i<roomOrder.length&&nR>extraR;){
  const id=roomOrder[i];
  if(id===keepRoom){i++;continue;}
  disposeRoom(id);
  if(roomOrder[i]===id)i++;else nR--;
 }
}
// Back-compat shim (no in-tree caller): prune both axes at once.
function pruneTableAssets(keepSkin,keepRoom){pruneSkins(keepSkin);pruneRooms(keepRoom);}

// register a table GLB's goal parts for the big-goal widen: classify by world x, frames scale about z=0, end-walls pin the outer edge
function registerBigGoalMeshes(root){
 const bb=new THREE.Box3();let nGrow=0,nWall=0;
 root.traverse(c=>{
  if(!c.isMesh||c.visible===false)return;  // skip the hidden legacy goal_post/goal_crossbar meshes
  const n=onm(c),pn=c.parent?onm(c.parent):'';
  const grow=/^(goal_post|goal_crossbar|goal_frame)/.test(n)||/^(goal_post|goal_crossbar|goal_frame)/.test(pn),
        wall=n.startsWith('wall_end')||pn.startsWith('wall_end');
  if(!grow&&!wall)return;
  bb.setFromObject(c);
  if(grow){
   if(bb.min.x<0&&bb.max.x>0){                      // one mesh spanning BOTH goals → split per-vertex by x-sign
    glbGoalSplit.push({o:c,base:Float32Array.from(c.geometry.attributes.position.array)});nGrow++;return;}
   const gi=bb.min.x+bb.max.x>0?1:0;glbGoalGrow[gi].push(c);nGrow++;return;   // single-goal frame: plain z-scale
  }
  const gi=(bb.min.x+bb.max.x)/2>0?1:0;             // 0 = left goal (-x), 1 = right (+x) — matches goalFrames order
  const near=Math.abs(bb.min.z)<Math.abs(bb.max.z);
  glbGoalWall[gi].push({o:c,inner:near?bb.min.z:bb.max.z,outer:near?bb.max.z:bb.min.z,sgn:Math.sign(bb.min.z+bb.max.z)});nWall++;
 });
 console.log('registerBigGoalMeshes: '+nGrow+' frame + '+nWall+' wall mesh(es) ('+glbGoalSplit.length+' split)');
}

// turn one ring's material into a level gauge by world height in the shader (added to gl_FragColor before tonemapping); a missing shader chunk anchor logs and keeps the authored look
function rodHoleShader(m,y0,y1){
 m.userData.rhU=null;                      // filled in when the program compiles (first render)
 m.onBeforeCompile=sh=>{
  m.userData.rhU=null;                     // a RE-compile that fails an anchor must not leave a handle on the dead program
  sh.uniforms.rhFill={value:1};            // 0..1 waterline, as a fraction of the ring's height
  sh.uniforms.rhY0={value:y0};
  sh.uniforms.rhY1={value:y1};
  sh.uniforms.rhSoft={value:CONFIG.fx.rodHoles.fillSoft};
  sh.uniforms.rhGlow={value:new THREE.Color(0,0,0)};
  const v=sh.vertexShader.replace('#include <begin_vertex>',
   '#include <begin_vertex>\n\tvRhY=(modelMatrix*vec4(transformed,1.0)).y;');
  if(v===sh.vertexShader){console.warn('rod hole shader: begin_vertex anchor missing - ring left plain');return;}
  sh.vertexShader='varying float vRhY;\n'+v;
  let anchor=null;
  for(const a of ['#include <tonemapping_fragment>','#include <encodings_fragment>','#include <dithering_fragment>'])
   if(sh.fragmentShader.indexOf(a)>=0){anchor=a;break;}
  if(!anchor){console.warn('rod hole shader: no fragment anchor - ring left plain');return;}
  sh.fragmentShader='varying float vRhY;\nuniform float rhFill,rhY0,rhY1,rhSoft;\nuniform vec3 rhGlow;\n'+
   sh.fragmentShader.replace(anchor,
    '\tfloat rhT=(vRhY-rhY0)/max(1e-4,rhY1-rhY0);\n'+
    '\tgl_FragColor.rgb+=rhGlow*smoothstep(rhFill+rhSoft,rhFill-rhSoft,rhT);\n'+anchor);
  m.userData.rhU=sh.uniforms;
 };
}

// register a skin's rod-hole rings for the stamina readout (fx.js rodHolesUpdate)
// the contract is the object name `rod_hole*` (not prefixed led, field, goal_ or wall_end); the rod comes from world x against CONFIG.rods.defs
// each ring gets its own material clone (one compiled program, different uniforms); casting is off
function registerRodHoles(root,id,skinId){
 const defs=CONFIG.rods.defs;
 let gap=Infinity;for(let i=1;i<defs.length;i++)gap=Math.min(gap,Math.abs(defs[i].x-defs[i-1].x));
 const tol=gap*.5,bb=new THREE.Box3(),list=[];
 let bad=0;
 root.traverse(c=>{
  if(!c.isMesh||!onm(c).startsWith('rod_hole'))return;
  bb.setFromObject(c);const cx=(bb.min.x+bb.max.x)/2;
  let ri=-1,best=tol;
  for(let i=0;i<defs.length;i++){const d=Math.abs(defs[i].x-cx);if(d<best){best=d;ri=i;}}
  if(ri<0){bad++;console.warn('rod hole '+onm(c)+' at x='+cx.toFixed(1)+' matches no rod - skipped ('+id+'/'+skinId+')');return;}
  c.castShadow=false;
  const m=c.material.clone();
  rodHoleShader(m,bb.min.y,bb.max.y);      // this ring's OWN height — it differs per skin
  c.material=m;
  list.push({o:c,mat:m,rod:ri,fill:1,v:0,col:kitLin(CONFIG.fx.rodHoles.idle),off:false});
 });
 if(list.length||bad){
  (skinRodHoles[id]=skinRodHoles[id]||{})[skinId]=list;
  console.log('registerRodHoles: '+list.length+' ring(s) on '+new Set(list.map(e=>e.rod)).size+' rod(s) ('+id+'/'+skinId+')'+(bad?' - '+bad+' refused':''));
 }
}

// --- rooms / locations (environment backdrops) ---
// a room GLB is authored in game coords (floor ~y=-44, walls ±190), keyed by CONFIG.rooms id; applyRoom (world.js) toggles which is shown
// load one room's backdrop GLB into roomGroups[id]; lazy and idempotent, cb runs on success, failure and no-ops
// ===== GLB light + emissive transfer =====
// emissive: r128 ignores KHR_materials_emissive_strength, so read it from userData.gltfExtensions into emissiveIntensity (needs tone mapping)
// punctual lights: glTF carries candela under inverse-square, r128 falls off linearly to `distance`
//    base = candela / d0^2 keeps near and far fixtures' relative contribution; distance = d0 * reach makes the falloff at the table constant, so `gain` is predictable
//    the ceiling (max) scales the whole room, not each light; max:0 = off
// physicallyCorrectLights stays off (it would rewrite the hand-tuned goal and fx lights)
function applyEmissiveStrength(root){
 if(!root||CONFIG.render&&CONFIG.render.emissiveStrength===false)return;
 const seen=new Set();
 root.traverse(o=>{
  const ms=o.material;if(!ms)return;
  (Array.isArray(ms)?ms:[ms]).forEach(m=>{
   if(!m||seen.has(m))return;seen.add(m);
   const ex=m.userData&&m.userData.gltfExtensions&&m.userData.gltfExtensions.KHR_materials_emissive_strength;
   if(!ex)return;
   const s=ex.emissiveStrength;
   if(typeof s!=='number'||!isFinite(s)||s<0||s===1)return;
   if(!m.emissive)return;                       // only lit materials carry emissive
   m.emissiveIntensity=(m.emissiveIntensity===undefined?1:m.emissiveIntensity)*s;
   m.needsUpdate=true;
  });
 });
}
// transfer a room GLB's baked lights; world matrices are forced up to date first (d0 is a world distance)
function applyRoomLights(room,R){
 const D=(CONFIG.render&&CONFIG.render.roomLight)||{};
 const C=Object.assign({gain:1,reach:3,decay:2,minDist:20,max:0},D,(R&&R.light)||{});
 room.updateMatrixWorld(true);
 const lights=[];const p=new THREE.Vector3();
 room.traverse(c=>{if(c.isLight)lights.push(c);});
 if(!lights.length)return lights;
 // fixtures the room switches off by name (e.g. detached into an authored light); intensity 0 rather than visible=false, which would change the light count
 const off=new Set(((R&&R.lightsOff)||[]).map(s=>String(s).toLowerCase()));
 lights.forEach(l=>{
  // authored candela is stashed on the first pass only, so the transfer is idempotent (the editor's sliders call it repeatedly)
  if(l.userData.rlCandela===undefined){
   l.userData.rlCandela=l.intensity;
   l.userData.rlDist=l.distance;
  }
  const cd=l.userData.rlCandela;
  l.castShadow=false;                                  // no room light casts shadows yet — see CLAUDE.md
  l.userData.roomOff=off.has(String(l.name||'').toLowerCase());
  l.getWorldPosition(p);
  // d0: how far this fixture is from the play area. The table sits at the origin.
  const d0=Math.max(p.length(),C.minDist);
  if(l.isPointLight||l.isSpotLight){
   l.intensity=cd/(d0*d0)*C.gain;                      // inverse-square relationship, then the room's knob
   l.decay=C.decay;
   l.distance=C.reach>0?d0*C.reach:0;                  // 0 = no cutoff (flat)
  }else{
   l.intensity=cd*C.gain;                              // directional/ambient inside a room glb: no falloff to derive
  }
 });
 // ratio-preserving ceiling: scales the whole room by one factor so the key:fill ratio survives
 if(C.max>0){
  let mx=0;lights.forEach(l=>{if(l.intensity>mx)mx=l.intensity;});
  if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity*=k);
   console.log('room lights normalised x'+k.toFixed(3)+' (peak '+mx.toFixed(2)+' > max '+C.max+')');}
 }
 // applied last so a silenced fixture can't drag the ceiling down onto the lit ones
 lights.forEach(l=>{if(l.userData.roomOff){l.userData.roomOffInt=l.intensity;l.intensity=0;}});
 return lights;
}

const roomLoading={};   // room id -> [pending cbs] while its backdrop GLB is in flight
// rooms whose GLB 404'd: not re-fetched per applyRoom; roomHasGlb() is the test for the ground-plane fallback; a reload retries
const roomFailed={};
function roomHasGlb(id){const R=CONFIG.rooms&&CONFIG.rooms[id];return !!(R&&R.glb&&!roomFailed[id]);}
function ensureRoom(id,cb){
 const R=CONFIG.rooms&&CONFIG.rooms[id];
 if(!roomHasGlb(id)){if(cb)cb();return;}
 if(roomGroups[id]){touchRoom(id);if(cb)cb();return;}
 // in flight: queue the cb so it fires when the backdrop is truly resident
 if(roomLoading[id]){if(cb)roomLoading[id].push(cb);touchRoom(id);return;}
 const cbs=roomLoading[id]=cb?[cb]:[];touchRoom(id);
 const flush=()=>{delete roomLoading[id];cbs.forEach(f=>f&&f());};
 const url=(R.folder||'')+R.glb;
 newGLTF().load(url,gltf=>{
  try{
   const room=gltf.scene;
   // backdrop, not a shadow caster; room glass draws first among transparent things (renderOrder -1) and never receives shadows
   room.traverse(c=>{if(!c.isMesh)return;c.castShadow=false;
    const ms=Array.isArray(c.material)?c.material:[c.material];
    const glass=ms.some(m=>m&&m.transparent);c.receiveShadow=!glass;if(glass)c.renderOrder=-1;});
   applyEmissiveStrength(room);                    // r128 does not support KHR_materials_emissive_strength
   const rl=applyRoomLights(room,R);               // candela -> screen; see the block above
   if(rl.length)console.log('room "'+id+'" lights: '+rl.map(l=>(l.name||l.type)+' '+l.intensity.toFixed(3)+(l.distance?'@'+l.distance.toFixed(0):'')).join(', '));
   room.visible=false;scene.add(room);
   roomGroups[id]=room;
   console.log('room "'+id+'" loaded ('+R.glb+')');
  }catch(e){console.warn('room GLB hookup failed for '+id,e);}
  flush();                                          // resident now → release every queued cb
 },undefined,()=>{
  roomFailed[id]=true;                              // latch: never re-fetch this file; applyRoom falls back to the shared backdrop
  const oi=roomOrder.indexOf(id);if(oi>=0)roomOrder.splice(oi,1);
  console.warn('room GLB missing for '+id+' ('+url+'), using shared backdrop');
  flush();                                          // GLB missing → shared backdrop; release queued cbs so a gate doesn't wait forever
 });
}
// free an evicted room backdrop (a hard dispose is safe, never cloned); never the visible one; its reflection bake stays (own LRU, world.js pruneEnvs)
function disposeRoom(id){
 const room=roomGroups[id];if(!room)return;
 if(typeof disposeRoomProps==='function')disposeRoomProps(id);   // instanced props go with the room
 scene.remove(room);delete roomGroups[id];
 const oi=roomOrder.indexOf(id);if(oi>=0)roomOrder.splice(oi,1);
 disposeModelTemplate(room);
 console.log('room freed: '+id+' (reflection bake kept — see the note above)');
}
// back-compat shim: the old eager all-rooms loader, nothing calls it now
function loadRoomModel(){for(const id in CONFIG.rooms)ensureRoom(id);}

// --- room skies (CONFIG.rooms.<id>.sky) ---
// six KTX2 cube faces (<src>_px.ktx2 ... _nz) in one CubeTexture on scene.background: one draw call, never fogged; ext:'jpg'/'png' works for authoring
// r128's background can't rotate or dim, so both are baked into the faces; LRU by room id (cacheSkies), active kept
const skyCache={},skyOrder=[],skyLoading={},skyFailed={};
const SKY_FACES=['px','nx','py','ny','pz','nz'];
function roomHasSky(id){const R=CONFIG.rooms&&CONFIG.rooms[id];return !!(R&&R.sky&&R.sky.src&&!skyFailed[id]);}
function touchSky(id){const i=skyOrder.indexOf(id);if(i>=0)skyOrder.splice(i,1);skyOrder.push(id);}
function ensureSky(id,cb){
 if(!roomHasSky(id)){if(cb)cb(null);return;}
 if(skyCache[id]){touchSky(id);if(cb)cb(skyCache[id]);return;}
 if(skyLoading[id]){if(cb)skyLoading[id].push(cb);touchSky(id);return;}
 const cbs=skyLoading[id]=cb?[cb]:[];touchSky(id);
 const S=CONFIG.rooms[id].sky,ext=S.ext||'ktx2',urls=SKY_FACES.map(f=>S.src+'_'+f+'.'+ext);
 const flush=t=>{delete skyLoading[id];cbs.forEach(f=>f&&f(t));};
 const fail=e=>{
  if(skyFailed[id])return;skyFailed[id]=true;                     // latch, same reason as roomFailed
  const oi=skyOrder.indexOf(id);if(oi>=0)skyOrder.splice(oi,1);
  console.warn('sky missing for '+id+' ('+S.src+'_*.'+ext+'), using the flat bg colour',e||'');
  flush(null);
 };
 const done=t=>{if(skyFailed[id]){if(t)t.dispose();return;}skyCache[id]=t;console.log('sky "'+id+'" loaded');flush(t);};
 if(ext!=='ktx2'){
  new THREE.CubeTextureLoader().load(urls,t=>{t.encoding=THREE.sRGBEncoding;done(t);},undefined,fail);
  return;
 }
 const k=(typeof ktx2Loader==='function')?ktx2Loader():null;
 if(!k){fail('no KTX2 loader');return;}
 const faces=[];let n=0;
 urls.forEach((u,i)=>k.load(u,f=>{
  faces[i]=f;if(++n<6||skyFailed[id])return;
  const t=new THREE.CubeTexture(faces);
  t.format=faces[0].format;t.type=faces[0].type;t.encoding=faces[0].encoding;
  t.generateMipmaps=false;t.minFilter=faces[0].minFilter;t.magFilter=THREE.LinearFilter;
  t.needsUpdate=true;done(t);
 },undefined,fail));
}
function disposeSky(id){
 const t=skyCache[id];if(!t)return;
 if(typeof scene!=='undefined'&&scene&&scene.background===t)return;   // never free the sky on screen
 t.dispose();delete skyCache[id];
 const oi=skyOrder.indexOf(id);if(oi>=0)skyOrder.splice(oi,1);
 console.log('sky freed: '+id);
}
function pruneSkies(keep){
 const extra=Math.max(0,((CONFIG.tableAssets||{}).cacheSkies||1)-1);
 let n=0;for(const id of skyOrder)if(id!==keep&&skyCache[id])n++;
 for(let i=0;i<skyOrder.length&&n>extra;){
  const id=skyOrder[i];
  if(id===keep||!skyCache[id]){i++;continue;}
  disposeSky(id);
  if(skyOrder[i]===id)i++;else n--;
 }
}

// --- rods (per-table livery, lazy) ---
// each table may bring its own rod set (CONFIG.tables[id].rods), else assets/rods/; keyed by rodSetKey, cloned per rod by makeRodModel, kept resident
// a missing size falls back to the shared set, then the primitive rod in world.js buildRods; visual only
function rodSetKey(tableId){const T=CONFIG.tables[tableId];return (T&&T.rods)?tableId:'_shared';}

// load one rod set by key: '_shared' = assets/rods/fuzeball_rod_<n>man.glb, a table key = CONFIG.tables[key].rods.folder; a per-size 404 leaves it unset; cb runs once the batch settles
function loadRodSet(key,cb){
 const set=rodSets[key]||(rodSets[key]={});
 if(set._done){if(cb)cb();return;}
 if(rodSetLoading[key]){if(cb)rodSetLoading[key].push(cb);return;}
 const cbs=rodSetLoading[key]=[];if(cb)cbs.push(cb);
 const loader=newGLTF();
 const rd=(key!=='_shared'&&CONFIG.tables[key])?CONFIG.tables[key].rods:null;
 const folder=(rd&&rd.folder)||'assets/rods/';
 const files=(rd&&rd.files)||{};
 let left=ROD_SIZES.length;
 const settle=()=>{if(--left>0)return;set._done=true;delete rodSetLoading[key];cbs.forEach(f=>f&&f());};
 ROD_SIZES.forEach(n=>{
  const file=files[n]||('fuzeball_rod_'+n+'man.glb');
  loader.load(folder+file,g=>{set[n]=g.scene;settle();},undefined,()=>{
   if(key!=='_shared'){settle();return;}                              // table override absent -> shared fallback in makeRodModel
   loader.load('assets/'+file,g=>{set[n]=g.scene;settle();},undefined, // legacy assets/ root
    ()=>{console.warn('rod_'+n+'man.glb missing, using primitive');settle();});
  });
 });
}
// boot: prime the shared set and the active table's set, then onReady so buildRods can clone them
function loadRodModels(onReady){
 const tid=(typeof cfg!=='undefined'&&CONFIG.tables[cfg.table])?cfg.table:'classic';
 const keys=['_shared'];const tk=rodSetKey(tid);if(tk!=='_shared')keys.push(tk);
 let left=keys.length;const done=()=>{if(--left===0)onReady();};
 keys.forEach(k=>loadRodSet(k,done));
}
// ensure a table's rod set is resident (table switch); cb on settle
function ensureTableRods(tableId,cb){
 if(typeof loadRodSet!=='function'){if(cb)cb();return;}
 loadRodSet(rodSetKey(tableId),cb);
}

// clone the rod set's model for one rod and tint the team parts; falls back to the shared set, else null (primitive)
function makeRodModel(men,team,tableId){
  const key=(typeof rodSetKey==='function')?rodSetKey(tableId):'_shared';
  const tpl=(rodSets[key]&&rodSets[key][men])||(rodSets._shared&&rodSets._shared[men]);
  if(!tpl)return null;
  const g=tpl.clone(true);
  const clones=[];                              // {mat, isHandle} for applyColors / applyFinish
  g.traverse(c=>{
   if(!c.isMesh)return;c.castShadow=true;
   const n=onm(c),src=c.material;
   if(n.includes('handle')){
    c.material=cloneWithMaps(teamMat[team],src);
    if(c.material!==teamMat[team])clones.push({mat:c.material,isGlow:false});
   }else if(n.includes('collar')||n.includes('knob')){
    c.material=cloneWithMaps(teamGlow[team],src);
    if(c.material!==teamGlow[team])clones.push({mat:c.material,isGlow:true});
   }
  });
  if(clones.length){g.userData.teamClones=clones;g.userData.team=team;}
  return g;
 }

/* helpers */
function onm(o){return(o.name||'').toLowerCase();}
function ballKey(o){return onm(o).replace(/[._]?\d+$/,'');}
function wx(obj){return obj.getWorldPosition(new THREE.Vector3()).x;}
function hideMeshes(obj){if(obj)obj.traverse(c=>{if(c.isMesh)c.visible=false;});}

// clone dest material and carry over src's PBR maps so baked detail survives team-colour swaps
function cloneWithMaps(dest,src){
 if(!src||!src.normalMap&&!src.bumpMap&&!src.roughnessMap&&!src.metalnessMap&&!src.aoMap)return dest;
 const m=dest.clone();
 if(src.normalMap){m.normalMap=src.normalMap;m.normalScale=src.normalScale;}
 if(src.bumpMap){m.bumpMap=src.bumpMap;m.bumpScale=src.bumpScale;}
 if(src.roughnessMap)m.roughnessMap=src.roughnessMap;
 if(src.metalnessMap)m.metalnessMap=src.metalnessMap;
 if(src.aoMap)m.aoMap=src.aoMap;
 m.needsUpdate=true;
 return m;
}

// --- fracture / explosion models ---
// optional per-figurine explode GLB (explosionSrc) for fracture.js; figurines without one vanish
// boot loads only the two shared GLBs (cannonball explosion, respawn swirl); per-figurine ones come from ensureExplosionModel (main.js primes red/blue, reloadPlayerModel a new pick)
function loadExplosionModels(onReady){
  const off=CONFIG.debug?.fractureFx===false;                       // master kill-switch: no fracture GLBs loaded at all
  const ballSrc=off?null:CONFIG.cannonball.explosionSrc;            // the ball's own shatter GLB (shared, always needed)
  const swirlSrc=off?null:CONFIG.cannonball.respawnSwirlSrc;        // the respawn swirl GLB (one shared asset for every figurine)
  let left=(ballSrc?1:0)+(swirlSrc?1:0);
  if(!left){onReady();return;}
  const done=()=>{if(--left<=0)onReady();};
  if(ballSrc){
   newGLTF().load(ballSrc,
    gltf=>{applyEmissiveStrength(gltf.scene);ballExplosionTemplate={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('cannonball explosion GLB missing ('+ballSrc+')');done();});
  }
  if(swirlSrc){
   newGLTF().load(swirlSrc,
    gltf=>{applyEmissiveStrength(gltf.scene);respawnSwirlTemplate={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('respawn swirl GLB missing ('+swirlSrc+')');done();});
  }
}

// lazy-load one figurine's explosion GLB and shader-warm it off-screen; no-op if fracture fx is off, no explosionSrc, loaded or in flight; spawnFracture vanishes until it's ready
function ensureExplosionModel(id,cb){
  if(CONFIG.debug?.fractureFx===false||!id||explosionTemplates[id]||explosionLoading[id]){if(cb)cb();return;}
  const m=CONFIG.playerModel.models.find(x=>x.id===id);
  if(!m||!m.explosionSrc){if(cb)cb();return;}                       // figurine has no shatter GLB — keeps original instant-vanish
  explosionLoading[id]=true;
  newGLTF().load(m.explosionSrc,
   gltf=>{delete explosionLoading[id];applyEmissiveStrength(gltf.scene);
    explosionTemplates[id]={scene:gltf.scene,clips:gltf.animations};
    if(typeof warmFractureTemplate==='function')warmFractureTemplate(explosionTemplates[id]); // precompile now, off the game loop
    if(cb)cb();},
   undefined,
   ()=>{delete explosionLoading[id];console.warn('explosion GLB missing for '+id+' ('+m.explosionSrc+')');if(cb)cb();});
}

// free a figurine explosion template (the caller must have cleared live fractures first); reloads on demand
function disposeExplosionModel(id){
  const t=explosionTemplates[id];if(!t)return;
  t.scene.traverse(c=>{if(!c.isMesh)return;
   if(c.geometry&&c.geometry.dispose)c.geometry.dispose();
   const mats=Array.isArray(c.material)?c.material:[c.material];
   for(const m of mats){if(!m)continue;
    for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap'])
     {const tx=m[k];if(tx&&tx.dispose)tx.dispose();}
    if(m.dispose)m.dispose();}});
  delete explosionTemplates[id];
}
// dispose every figurine explosion template except keep[]; the shared ball and swirl templates are untouched
function pruneExplosionModels(keep){
  const k=new Set(keep||[]);
  for(const id in explosionTemplates)if(!k.has(id))disposeExplosionModel(id);
}

// --- ball model ---

function loadBallModel(onReady){
  if(!CONFIG.debug?.useBallModel){
    console.log('Ball model disabled via CONFIG.debug.useBallModel');
    if(onReady)onReady();
    return;
  }
  const loader=newGLTF();
  const hook=(url)=>gltf=>{
    ballModel=gltf.scene;
    ballModel.traverse(c=>{
      if(!c.isMesh)return;
      c.castShadow=true;c.receiveShadow=true;
      const m=c.material;
      if(m){                                       // ensure texture encoding (GLTFLoader sets this, but be explicit)
       if(m.map){m.map.encoding=THREE.sRGBEncoding;m.map.needsUpdate=true;}
       if(m.emissiveMap)m.emissiveMap.encoding=THREE.sRGBEncoding;
       if(m.normalMap){m.normalMap.encoding=THREE.LinearEncoding;m.normalMap.needsUpdate=true;}
       if(m.roughnessMap){m.roughnessMap.encoding=THREE.LinearEncoding;m.roughnessMap.needsUpdate=true;}
       if(m.metalnessMap){m.metalnessMap.encoding=THREE.LinearEncoding;m.metalnessMap.needsUpdate=true;}
       if(m.aoMap){m.aoMap.encoding=THREE.LinearEncoding;m.aoMap.needsUpdate=true;}
       if(m.bumpMap){m.bumpMap.encoding=THREE.LinearEncoding;m.bumpMap.needsUpdate=true;}
       m.needsUpdate=true;
      }
      const n=ballKey(c);                          // 'classic.001'/'classic001' -> 'classic'
      if(n)ballMatMap[n]=m;
    });
    // diagnostic: which file actually loaded, and which slots carry an image map
    const withMap=Object.keys(ballMatMap).filter(k=>ballMatMap[k]&&ballMatMap[k].map);
    console.log('ball GLB loaded from '+url+' — slots:',Object.keys(ballMatMap),'| slots WITH a texture map:',withMap.length?withMap:'(none)');
    if(onReady)onReady();
  };
  loader.load('assets/balls/fuzeball_ball.glb',hook('assets/balls/fuzeball_ball.glb'),undefined,
    ()=>loader.load('assets/ball_.glb',hook('assets/ball_.glb'),undefined,
      ()=>{console.warn('no ball GLB, using primitive balls');if(onReady)onReady();}));
}

// the GLB holds one mesh per ball type at the origin: show only the matching one, else classic
function makeBallModel(key){
  if(!ballModel)return null;
  const want=key.toLowerCase();
  if(!ballMatMap[want])return null;   // no baked mesh slot for this type (e.g. knuckleball): the caller uses the generated sphere
  const g=ballModel.clone(true);
  let any=false;
  g.traverse(c=>{
    if(!c.isMesh)return;
    c.visible=ballKey(c)===want;
    if(c.visible)any=true;
    c.castShadow=true;c.receiveShadow=true;
  });
  return any?g:null;
}

// --- power-up pickup models ---
// CONFIG.powerups.models: optional per type, a missing GLB falls back to the octahedron in powerups.js
// templates load at boot and are cloned per spawn; anything touching a material is baked in here to avoid a mid-match compile
const puTemplates={};      // power-up key -> THREE.Group (recentred + fit-scaled). Cloned by makePUModel.
function loadPowerupModels(onReady){
 const M=CONFIG.powerups.models;
 const keys=(M&&M.on)?Object.keys(M).filter(k=>k!=='on'&&M[k]&&M[k].src):[];
 if(!keys.length){if(onReady)onReady();return;}
 let left=keys.length;const done=()=>{if(--left<=0&&onReady)onReady();};
 const loader=newGLTF();
 keys.forEach(k=>{
  const d=M[k],ty=CONFIG.puTypes.find(x=>x.key===k);
  loader.load(d.src,gltf=>{
   try{
    const wrap=new THREE.Group();wrap.add(gltf.scene);
    // recentre on the model's middle and normalise size to the bounding-sphere radius `fit`
    const bb=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.sub(bb.getCenter(new THREE.Vector3()));
    const rad=bb.getSize(new THREE.Vector3()).length()/2;
    if(d.fit&&rad>1e-4)wrap.scale.setScalar(d.fit/rad);
    // strip baked KHR lights (a light joining mid-match recompiles the scene); use `glow` or fxLightGet
    const lights=[];wrap.traverse(o=>{if(o.isLight)lights.push(o);});
    lights.forEach(l=>{if(l.parent)l.parent.remove(l);});
    if(lights.length)console.warn('power-up GLB '+k+': stripped '+lights.length+' baked light(s) — see CONFIG.powerups.models glow');
    wrap.traverse(o=>{
     if(!o.isMesh)return;
     o.castShadow=d.shadow!==false;o.receiveShadow=false;
     if(!d.glow)return;
     const ms=Array.isArray(o.material)?o.material:[o.material];
     ms.forEach(m=>{
      if(!m||!m.emissive)return;
      // keep an authored emissive colour, fall back to the type's HUD colour only when there is none
      if(d.glowCol!==undefined)m.emissive.setHex(d.glowCol);
      else if(!m.emissive.getHex())m.emissive.setHex((ty&&ty.col)||0xffffff);
      m.emissiveIntensity=d.glow;m.needsUpdate=true;
     });
    });
    puTemplates[k]=wrap;
    console.log('power-up GLB loaded ('+k+' <- '+d.src+')');
   }catch(e){console.warn('power-up GLB hookup failed for '+k,e);}
   done();
  },undefined,()=>{console.warn('power-up GLB missing for '+k+' ('+d.src+'), using the procedural gem');done();});
 });
}
// one pickup instance, null if the type has no model (caller draws the gem)
function makePUModel(key){const t=puTemplates[key];return t?t.clone(true):null;}
// off-screen shader precompile so a pickup's first frame doesn't compile mid-match
function warmPowerupShaders(){
 if(!renderer||!scene||!camera)return;
 for(const k in puTemplates){
  const o=puTemplates[k].clone(true);o.position.set(0,-500,0);
  scene.add(o);renderer.compile(scene,camera);scene.remove(o);
 }
}

// --- pitches (one GLB each, lazy + LRU) ---
// fetched when picked, evicted past CONFIG.tableAssets.cachePitches, active protected; split with tools/pitch-split.mjs (see the note above CONFIG.pitches for why the variant key is the material name)
const pitchGroups={};    // pitch id -> its loaded GLB group (parented into the table group when shown)
const pitchLoading={};   // pitch id -> [pending cbs] while its GLB fetch is in flight
const pitchFailed={};    // 404 latch: without it a missing file is re-fetched on every drawField
const pitchOrder=[];     // LRU, least-recent first
function pitchHasGlb(id){const P=CONFIG.pitches&&CONFIG.pitches[id];return !!(P&&P.glb&&!pitchFailed[id]);}
function touchPitch(id){const i=pitchOrder.indexOf(id);if(i>=0)pitchOrder.splice(i,1);pitchOrder.push(id);}
// ensure one pitch's GLB is resident; idempotent, cb fires on success, failure and no-ops
function ensurePitch(id,cb){
  const P=CONFIG.pitches&&CONFIG.pitches[id];
  if(!pitchHasGlb(id)){if(cb)cb();return;}
  if(pitchGroups[id]){touchPitch(id);if(cb)cb();return;}
  if(pitchLoading[id]){if(cb)pitchLoading[id].push(cb);touchPitch(id);return;}
  const cbs=pitchLoading[id]=cb?[cb]:[];touchPitch(id);
  const flush=()=>{delete pitchLoading[id];cbs.forEach(f=>f&&f());};
  const url=(P.folder||'assets/pitches/')+P.glb;
  newGLTF().load(url,gltf=>{
   try{
    const g=gltf.scene;
    g.traverse(c=>{
      if(!c.isMesh)return;
      c.castShadow=false;c.receiveShadow=true;
      const m=c.material;
      if(m){
        if(m.map){m.map.encoding=THREE.sRGBEncoding;m.map.needsUpdate=true;}
        if(m.emissiveMap)m.emissiveMap.encoding=THREE.sRGBEncoding;
        if(m.normalMap){m.normalMap.encoding=THREE.LinearEncoding;m.normalMap.needsUpdate=true;}
        if(m.roughnessMap){m.roughnessMap.encoding=THREE.LinearEncoding;m.roughnessMap.needsUpdate=true;}
        if(m.metalnessMap){m.metalnessMap.encoding=THREE.LinearEncoding;m.metalnessMap.needsUpdate=true;}
        if(m.aoMap){m.aoMap.encoding=THREE.LinearEncoding;m.aoMap.needsUpdate=true;}
        if(m.bumpMap){m.bumpMap.encoding=THREE.LinearEncoding;m.bumpMap.needsUpdate=true;}
        m.needsUpdate=true;
      }
    });
    g.visible=false;                        // drawField parents + reveals it
    if(typeof grassAttach==='function')grassAttach(id,g);   // shell grass (js/grass.js), grass pitches only
    pitchGroups[id]=g;
    console.log('pitch "'+id+'" loaded ('+P.glb+')');
   }catch(e){console.warn('pitch GLB hookup failed for '+id,e);}
   flush();
  },undefined,()=>{
   pitchFailed[id]=true;                    // latch: never re-fetch, and let drawField use the JPEG for real
   const oi=pitchOrder.indexOf(id);if(oi>=0)pitchOrder.splice(oi,1);
   console.warn('pitch GLB missing for '+id+' ('+url+'), using the image fallback');
   flush();
  });
}
// free an evicted pitch; never the one shown (prunePitches protects it)
function disposePitch(id){
  const g=pitchGroups[id];if(!g)return;
  if(g.parent)g.parent.remove(g);
  delete pitchGroups[id];
  const oi=pitchOrder.indexOf(id);if(oi>=0)pitchOrder.splice(oi,1);
  disposeModelTemplate(g);                  // shared GPU-free helper (world.js)
  console.log('pitch freed: '+id);
}
// evict past cachePitches, LRU first, counting non-kept entries like pruneSkins/pruneRooms/pruneEnvs
function prunePitches(keepId){
  const extra=Math.max(0,((CONFIG.tableAssets||{}).cachePitches||2)-1);
  let n=0;for(const id of pitchOrder)if(id!==keepId)n++;
  for(let i=0;i<pitchOrder.length&&n>extra;){
   const id=pitchOrder[i];
   if(id===keepId){i++;continue;}
   disposePitch(id);
   if(pitchOrder[i]===id)i++;else n--;
  }
}
