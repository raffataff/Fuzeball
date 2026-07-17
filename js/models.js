'use strict';
/* ================= GLB table + rod + ball loaders =================
   Optional. If the .glb files are present under assets/ they replace the
   primitive table/rods/ball built in world.js/balls.js; if a file is missing
   or fails, the primitive stays as a fallback. The game's theming/colour/fx
   code keeps working because we repoint fieldMesh / ledMat / netMats at the
   loaded materials, and tint the rod 'team' / 'team_glow' materials per side.
   For balls, we load a single GLB with material slots (classic, fireball,
   cannonball, golden, split) and map them to ball types. */
const rodTemplates={};   // men-count -> loaded rod scene (bar+handle+collar+knob)
let ballModel=null;      // loaded ball GLB scene (with material slots)
let roomModel=null;      // deprecated — per-table environment GLBs now live in tableRooms[id] (arena.js); kept to avoid a dangling ref
let pitchModel=null;     // loaded pitch GLB scene (one mesh per theme variant)
const ballMatMap={};     // ballType -> material name in GLB
const pitchMatMap={};    // pitch variant -> material (unused for now; mirrors ball loader)
const explosionTemplates={}; // figurine id -> {scene, clips} — see CONFIG.playerModel.models[].explosionSrc. Lazy: only the figurines actually on the table are loaded (ensureExplosionModel), not all ~17.
const explosionLoading={};    // figurine id -> true while its GLB fetch is in flight (guards double-loads / avoids a bad partial entry in explosionTemplates)
let ballExplosionTemplate=null; // {scene, clips} — the cannonball's own shatter GLB (CONFIG.cannonball.explosionSrc), consumed by fracture.js spawnBallFracture
let respawnSwirlTemplate=null;  // {scene, clips} — the shared swirly respawn-particle GLB (CONFIG.cannonball.respawnSwirlSrc), consumed by fracture.js spawnRespawnSwirl

/* --- static table --------------------------------------------------------- */
/* Load the ACTIVE skin of every table at boot (a table = a shape; skins are its swappable
   paint jobs). Non-active skins lazy-load when first picked in the Skin dropdown.
   buildTable/buildArenaTable pre-create each table's group (procedural fallback inside);
   a GLB-only table gets a fresh empty group here. */
function loadTableModel(){
 for(const id in CONFIG.tables){
  if(!tableGroups[id]){tableGroups[id]=new THREE.Group();scene.add(tableGroups[id]);}
  const sk=(typeof curSkin==='function')?curSkin(id):null;
  if(sk)loadSkin(id,sk,()=>{applyTable();applyTheme();applyColors();drawField();});
 }
 loadRoomModel();
}

/* Load one skin (a textured GLB of a table's shape) into its own sub-group under the table
   group, cached by id/skin. Missing GLB -> drop the empty group so applySkin falls back to the
   procedural primitives. cb runs on success OR failure. */
function loadSkin(id,skinId,cb){
 skinGroups[id]=skinGroups[id]||{};
 if(skinGroups[id][skinId]){if(cb)cb();return;}     // already loaded (cache)
 const T=CONFIG.tables[id],S=T&&T.skins&&T.skins[skinId];
 if(!S){if(cb)cb();return;}
 if(!tableGroups[id]){tableGroups[id]=new THREE.Group();scene.add(tableGroups[id]);}
 const grp=new THREE.Group();grp.visible=false;
 tableGroups[id].add(grp);skinGroups[id][skinId]=grp;
 const loader=new THREE.GLTFLoader();
 const hook=gltf=>{
  try{
   let hasFrame=false;
   gltf.scene.traverse(c=>{
    if(!c.isMesh)return;
    c.castShadow=true;c.receiveShadow=true;
    const n=onm(c);
    if(n.startsWith('field'))c.visible=false;       // themed pitch plane stays instead
    else if(n.startsWith('led')){ledMat=c.material;(skinLed[id]=skinLed[id]||{})[skinId]=c.material;} // applySkin repoints LED fx per active skin
    else if(n.startsWith('goal_net'))c.visible=false;                            // keep the built-in diamond net
    else if(n.startsWith('goal_frame')||n.startsWith('goal_post'))hasFrame=true; // custom posts: hide the primitive front frame
   });
   (skinHasFrame[id]=skinHasFrame[id]||{})[skinId]=hasFrame;
   grp.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
   registerBigGoalMeshes(gltf.scene);               // wire baked frame + end-walls into the big-goal widen
   if(T.collision==='bowl')registerArenaMorph(gltf.scene); // bowl shells open via SDF re-projection
   console.log(S.glb+' loaded ('+id+'/'+skinId+')');
  }catch(e){console.warn('skin GLB hookup failed',e);}
  if(cb)cb();
 };
 const fail=()=>{
  tableGroups[id].remove(grp);delete skinGroups[id][skinId];    // no GLB -> fall back to primitives
  console.warn('skin GLB missing for '+id+'/'+skinId+' ('+(T.folder||'')+S.glb+')');
  if(cb)cb();
 };
 const primary=(T.folder||'')+S.glb;
 loader.load(primary,hook,undefined,()=>{S.glbFallback?loader.load(S.glbFallback,hook,undefined,fail):fail();});
}

/* Register a loaded table GLB's goal parts for the big-goal widen. The diamond net already
   grows (it's a goalFrames sub-group fx.js scales on z), but the GLB frame posts and the little
   end-walls flanking each mouth are baked at identity with world-space verts, so nothing moved
   them. Classify each by world-x (which goal) and hand them to bigGoalUpdate: frame meshes are
   symmetric about z=0 so they just scale; end-walls keep their outer edge pinned to the table
   side and only their inner edge tracks the mouth, so they open rather than stretch. Meshes are
   measured AFTER updateMatrixWorld so the world AABB is current. */
function registerBigGoalMeshes(root){
 const bb=new THREE.Box3();let nGrow=0,nWall=0;
 root.traverse(c=>{
  if(!c.isMesh)return;
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

/* --- arena room / environment ---------------------------------------------
   Authored in game/world coords (floor ~y=-44, walls ±190, centred on origin),
   so it drops straight into the scene with no transform. Tied to the arena
   table: applyTable toggles its visibility with ARENA_ON. */
function loadRoomModel(){
 // Load each table's optional environment GLB into tableRooms[id]; applyTable toggles which is shown.
 for(const id in CONFIG.tables){
  const T=CONFIG.tables[id];if(!T.room)continue;
  const url=(T.folder||'')+T.room;
  new THREE.GLTFLoader().load(url,gltf=>{
   try{
    const room=gltf.scene;
    room.traverse(c=>{if(c.isMesh){c.castShadow=false;c.receiveShadow=true;}}); // backdrop, not a shadow caster
    room.visible=false;scene.add(room);
    tableRooms[id]=room;
    applyTable();                                 // set initial visibility to match the current table
    console.log(T.room+' loaded');
   }catch(e){console.warn('room GLB hookup failed for '+id,e);}
  },undefined,()=>console.warn('room GLB missing for '+id+' ('+url+'), no environment'));
 }
}

/* --- rods ----------------------------------------------------------------- */
function loadRodModels(onReady){
 const loader=new THREE.GLTFLoader();
 const sizes=[1,2,3,5];let left=sizes.length;
 const done=()=>{if(--left===0)onReady();};
 // Rods are a shared asset (used by every table). Prefer the tidy assets/rods/ folder,
 // fall back to the old assets/ root location, then to the primitive rod.
 sizes.forEach(n=>{
  const file='fuzeball_rod_'+n+'man.glb';
  loader.load('assets/rods/'+file,
   gltf=>{rodTemplates[n]=gltf.scene;done();},
   undefined,
   ()=>loader.load('assets/'+file,
    gltf=>{rodTemplates[n]=gltf.scene;done();},
    undefined,
    ()=>{console.warn('rod_'+n+'man.glb missing, using primitive');done();}));
 });
}

/* Clone the loaded rod for one rod, tinting the team-coloured parts. Returns
   null when that size has no GLB (buildRods then draws the primitive). */
function makeRodModel(men,team){
  const tpl=rodTemplates[men];if(!tpl)return null;
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

/* Clone dest material and carry over any PBR texture maps (normal, roughness, metalness,
   ao, bump) from src so that GLB-baked detail survives team-colour swaps in rods/players. */
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

/* --- fracture / explosion models -------------------------------------------
   Optional per-figurine "explode & collapse" GLB, consumed by js/fracture.js on a
   cannonball kill. Only figurines with an explosionSrc get the effect; the rest keep the
   original instant-vanish. A live explosion is just a clone() + mixer.play() — no disk hit
   and no fresh material mid-match, because the two on-table figurines' shatters are primed
   and shader-warmed ahead of time (ensureExplosionModel). */
/* Boot: load ONLY the two shared, always-needed shatter GLBs — the cannonball's own
   explosion and the respawn swirl. The per-figurine player-explosion GLBs are NO LONGER
   bulk-loaded here (that was ~17 heavy fractured meshes resident for the 2 ever on the
   table); ensureExplosionModel pulls each figurine's shatter in on demand — main.js primes
   the active red/blue at boot, reloadPlayerModel primes a freshly-picked one. */
function loadExplosionModels(onReady){
  const off=CONFIG.debug?.fractureFx===false;                       // master kill-switch: no fracture GLBs loaded at all
  const ballSrc=off?null:CONFIG.cannonball.explosionSrc;            // the ball's own shatter GLB (shared, always needed)
  const swirlSrc=off?null:CONFIG.cannonball.respawnSwirlSrc;        // the respawn swirl GLB (one shared asset for every figurine)
  let left=(ballSrc?1:0)+(swirlSrc?1:0);
  if(!left){onReady();return;}
  const done=()=>{if(--left<=0)onReady();};
  if(ballSrc){
   new THREE.GLTFLoader().load(ballSrc,
    gltf=>{ballExplosionTemplate={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('cannonball explosion GLB missing ('+ballSrc+')');done();});
  }
  if(swirlSrc){
   new THREE.GLTFLoader().load(swirlSrc,
    gltf=>{respawnSwirlTemplate={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('respawn swirl GLB missing ('+swirlSrc+')');done();});
  }
}

/* Lazy-load ONE figurine's explosion GLB (by model id) and shader-warm it off-screen so a
   later cannonball kill is still just clone()+play() — no mid-match disk read or compile
   stall. No-op if fracture fx is off, the id has no explosionSrc, it's already loaded, or a
   load is already in flight. Safe to call on every model change; cb (optional) runs on
   success OR skip. spawnFracture falls back to instant-vanish while a template isn't ready. */
function ensureExplosionModel(id,cb){
  if(CONFIG.debug?.fractureFx===false||!id||explosionTemplates[id]||explosionLoading[id]){if(cb)cb();return;}
  const m=CONFIG.playerModel.models.find(x=>x.id===id);
  if(!m||!m.explosionSrc){if(cb)cb();return;}                       // figurine has no shatter GLB — keeps original instant-vanish
  explosionLoading[id]=true;
  new THREE.GLTFLoader().load(m.explosionSrc,
   gltf=>{delete explosionLoading[id];
    explosionTemplates[id]={scene:gltf.scene,clips:gltf.animations};
    if(typeof warmFractureTemplate==='function')warmFractureTemplate(explosionTemplates[id]); // precompile now, off the game loop
    if(cb)cb();},
   undefined,
   ()=>{delete explosionLoading[id];console.warn('explosion GLB missing for '+id+' ('+m.explosionSrc+')');if(cb)cb();});
}

/* Free a per-figurine explosion template's GPU buffers/textures and drop it from the cache.
   Live fracture instances clone-share this template's geometry+textures, so the caller MUST
   have cleared them first (clearFractures) — startMatch/gotoMenu both do before pruning. The
   template re-loads on demand via ensureExplosionModel. */
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
/* Dispose every per-figurine explosion template EXCEPT the ids in keep[] — bounds resident
   shatter GLBs to the (usually two) figurines actually about to play. The shared cannonball +
   respawn-swirl templates live in their own vars, so they're never touched here. */
function pruneExplosionModels(keep){
  const k=new Set(keep||[]);
  for(const id in explosionTemplates)if(!k.has(id))disposeExplosionModel(id);
}

/* --- ball model ------------------------------------------------------------ */

function loadBallModel(onReady){
  if(!CONFIG.debug?.useBallModel){
    console.log('Ball model disabled via CONFIG.debug.useBallModel');
    if(onReady)onReady();
    return;
  }
  const loader=new THREE.GLTFLoader();
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

/* the GLB holds one mesh per ball type (classic/fire/cannon/split/golden), all at
   the origin — show ONLY the matching one; missing types fall back to classic. */
function makeBallModel(key){
  if(!ballModel)return null;
  const want=ballMatMap[key.toLowerCase()]?key.toLowerCase():'classic';
  if(!ballMatMap[want])return null;
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

/* --- pitch model ------------------------------------------------------------ */
function loadPitchModel(onReady){
  const loader=new THREE.GLTFLoader();
  let fired=false;
  const done=()=>{if(!fired){fired=true;if(onReady)onReady();}};
  loader.load('assets/pitches/fuzeball_pitch.glb',gltf=>{
    pitchModel=gltf.scene;
    pitchModel.traverse(c=>{
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
      const n=ballKey(c);
      if(n)pitchMatMap[n]=m;
    });
    console.log('pitch GLB loaded — variants:',Object.keys(pitchMatMap));
    done();
  },undefined,()=>{
    console.warn('no pitch GLB, using image pitches');
    done();
  });
}
