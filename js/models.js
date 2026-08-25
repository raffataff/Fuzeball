'use strict';
/* ================= GLB table + rod + ball loaders =================
   Optional. If the .glb files are present under assets/ they replace the
   primitive table/rods/ball built in world.js/balls.js; if a file is missing
   or fails, the primitive stays as a fallback. The game's theming/colour/fx
   code keeps working because we repoint fieldMesh / ledMat / netMats at the
   loaded materials, and tint the rod 'team' / 'team_glow' materials per side.
   For balls, we load a single GLB with material slots (classic, fireball,
   cannonball, golden, split) and map them to ball types. */
const rodSets={};        // rod-set key -> {men:scene, _done:true}. key '_shared' = stock assets/rods/; a table id = that table's own livery (CONFIG.tables[id].rods)
const rodSetLoading={};   // rod-set key -> [pending cbs] while its load batch is in flight
const ROD_SIZES=[1,2,3,5];
let ballModel=null;      // loaded ball GLB scene (with material slots)
let roomModel=null;      // deprecated — room/location GLBs now live in roomGroups[id] (arena.js), keyed by CONFIG.rooms id; kept to avoid a dangling ref
// (pitchModel is gone — pitches are per-id groups in pitchGroups now; see the pitch block below)
const ballMatMap={};     // ballType -> material name in GLB
const pitchMatMap={};    // pitch variant -> material (unused for now; mirrors ball loader)
const explosionTemplates={}; // figurine id -> {scene, clips} — see CONFIG.playerModel.models[].explosionSrc. Lazy: only the figurines actually on the table are loaded (ensureExplosionModel), not all ~17.
const explosionLoading={};    // figurine id -> true while its GLB fetch is in flight (guards double-loads / avoids a bad partial entry in explosionTemplates)
let ballExplosionTemplate=null; // {scene, clips} — the cannonball's own shatter GLB (CONFIG.cannonball.explosionSrc), consumed by fracture.js spawnBallFracture
let respawnSwirlTemplate=null;  // {scene, clips} — the shared swirly respawn-particle GLB (CONFIG.cannonball.respawnSwirlSrc), consumed by fracture.js spawnRespawnSwirl

/* --- static table --------------------------------------------------------- */
/* LAZY BY DEFAULT (CONFIG.tableAssets). A table skin GLB + its room backdrop are the fattest
   single assets in the game, and only ONE table is ever visible — so boot fetches only the
   ACTIVE table's active skin and room. Every other skin/room loads on demand the moment it's
   picked (applyTable / selectSkin are the only switch paths and both call through here), and
   LRU-evicted past the caps. Set CONFIG.tableAssets.preloadAll to restore the old eager boot.
   Groups for EVERY table are still created here: applyTable's visibility loop walks tableGroups,
   and buildTable/buildArenaTable put each table's procedural fallback inside its own group. */
function loadTableModel(){
 // Prop index first: applyRoom below may place props, and propLib() needs the manifest to
 // resolve an id. A missing manifest is legal (CONFIG.props.lib still works), so this never gates.
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
 // Rooms (locations) are their own axis now: boot fetches only the active room's backdrop; the
 // rest load when picked. preloadAll fetches every room's backdrop up front (old eager boot).
 if(eager){for(const id in CONFIG.rooms)ensureRoom(id);}
 else{const rm=(typeof cfg!=='undefined'&&CONFIG.rooms[cfg.room])?cfg.room:'open';ensureRoom(rm,()=>{if(typeof applyRoom==='function')applyRoom();});}
}

/* --- skin residency (LRU) --------------------------------------------------
   skinOrder holds 'id/skinId' keys, least-recently-used first. Loading or showing a skin
   touches it; pruneTableAssets disposes the tail past CONFIG.tableAssets.cacheSkins. Rooms
   get the same treatment via roomOrder. The ACTIVE table's skin/room are always protected,
   so a cap of 1 is legal (and means "never hold anything you aren't looking at"). */
const skinOrder=[],roomOrder=[];
const skinLoadingCbs={};   // 'id/skinId' -> [pending cbs] while that skin's GLB fetch is in flight (so a 2nd caller queues instead of firing early)
function skinKey(id,skinId){return id+'/'+skinId;}
function touchSkin(id,skinId){const k=skinKey(id,skinId),i=skinOrder.indexOf(k);if(i>=0)skinOrder.splice(i,1);skinOrder.push(k);}
function touchRoom(id){const i=roomOrder.indexOf(id);if(i>=0)roomOrder.splice(i,1);roomOrder.push(id);}

/* Load one skin (a textured GLB of a table's shape) into its own sub-group under the table
   group, cached by id/skin. Missing GLB -> drop the empty group so applySkin falls back to the
   procedural primitives. cb runs on success OR failure. Every mesh is stamped with its owning
   skin key so disposeTableSkin can unpick this skin's entries from the shared big-goal /
   arena-morph registries without disturbing the skin that's still on screen. */
function loadSkin(id,skinId,cb){
 skinGroups[id]=skinGroups[id]||{};
 const key=skinKey(id,skinId);
 const existing=skinGroups[id][skinId];
 // 'loaded' now means the sub-group actually HAS meshes — not merely that the placeholder group
 // exists. loadSkin parents an empty group the instant a fetch starts (so applySkin keeps the
 // primitives up meanwhile), and the old truthy-group check treated that empty placeholder as
 // "done" and fired cb early — a caller gating kickoff on it would start a match with the skin
 // still downloading (untextured table on a skipped intro). Truly-resident short-circuits here;
 // an in-flight fetch QUEUES the cb so it fires when the GLB actually lands.
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
   // Pre-scan: does this skin ship the new single-mesh-per-side goal_frame_l/goal_frame_r (the
   // arena-table convention — see build_arena_table.py build_goal_frames)? Some GLBs (e.g. the
   // classic alien-ship table) still carry the OLDER goal_post/goal_crossbar meshes too, added
   // before the goal_frame_l/r convention existed — if both are present in the same skin the new
   // goal_frame_* wins and the legacy posts/crossbar are hidden below so they don't double up.
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
    else if(/^(goal_post|goal_crossbar)/.test(n)){hasFrame=true;if(hasNewFrame)c.visible=false;} // legacy posts/crossbar: still count as a custom frame, but superseded (hidden) if goal_frame_l/r is also present
    else if(n.startsWith('goal_frame'))hasFrame=true;                            // custom posts: hide the primitive front frame
   });
   (skinHasFrame[id]=skinHasFrame[id]||{})[skinId]=hasFrame;
   applyEmissiveStrength(gltf.scene);               // r128 ignores KHR_materials_emissive_strength
   grp.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
   registerBigGoalMeshes(gltf.scene);               // wire baked frame + end-walls into the big-goal widen
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

/* Free one loaded skin: strip its meshes out of the shared big-goal + arena-morph registries
   (they're stamped with skinKey), detach the sub-group, then dispose its geometry/textures.
   Safe to hard-dispose (unlike figurine templates) because a skin GLB is never clone()d — the
   loaded scene IS the only instance. NEVER call on the skin currently being shown. */
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
 if(tableGroups[id])tableGroups[id].remove(grp);
 delete skinGroups[id][skinId];
 const oi=skinOrder.indexOf(key);if(oi>=0)skinOrder.splice(oi,1);
 disposeModelTemplate(grp);                            // shared GPU-free helper (world.js)
 console.log('table skin freed: '+key);
}

/* Evict skins/rooms past their caps, least-recently-used first. `keep*` are the assets currently
   ON SCREEN and are never freed; the caps count them, so cacheSkins:1 leaves room for nothing
   else and cacheSkins:2 keeps one previous skin warm. Deliberately measured as "how many NON-kept
   entries may stay" rather than a raw list length, so a stale asset can't squat the last slot
   when the active table brings none of its own. Called only after a switch has SETTLED — the
   incoming asset is already resident, so nothing visible is ever freed.
   Skins (table paint jobs) and rooms (locations) are pruned by SEPARATE functions now that they're
   independent axes: applyTable prunes skins, applyRoom prunes rooms. */
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
  if(!c.isMesh||c.visible===false)return;  // skip legacy goal_post/goal_crossbar meshes hidden above (superseded by goal_frame_l/r) — no point growing invisible geometry
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

/* --- rooms / locations (environment backdrops) ------------------------------
   A room GLB is authored in game/world coords (floor ~y=-44, walls ±190, centred on origin),
   so it drops straight into the scene with no transform. Rooms are keyed by ROOM id (CONFIG.rooms)
   and are independent of tables — applyRoom (world.js) toggles which one is shown and bakes its
   reflection env. */
/* Load ONE room's backdrop GLB into roomGroups[id]. Lazy + idempotent: a no-op if the room has no
   glb, it's already resident, or a fetch is in flight. cb runs on success, failure, and every
   no-op, so applyRoom can gate on it. */
/* ===== GLB light + emissive transfer =====================================
   Everything an artist authors in Blender has to survive the trip to the screen.
   Two things did not, and both were silent.

   --- 1. EMISSIVE STRENGTH ---
   KHR_materials_emissive_strength is NOT in r128's GLTFLoader extension table, so
   a material authored at strength 4 arrived at strength 1 and the loader said
   nothing. The value is not lost though: addUnknownExtensionsToUserData parks every
   extension the loader does not handle on material.userData.gltfExtensions, so the
   number is sitting right there and only needs applying. emissiveIntensity is the
   correct target — it multiplies `emissive` in the shader, so the authored COLOUR
   stays intact and only its strength scales. Nine GLBs in this project author it
   (both rooms, three tables, the explosion + swirl FX).

   Note this only READS as intended with tone mapping on: strength 4 pushes the
   emissive well past 1.0, which without a tone curve clips to flat white — i.e.
   supporting the extension and CONFIG.render.toneMapping are the same fix.

   --- 2. PUNCTUAL LIGHT INTENSITY ---
   glTF carries candela. Blender authors under inverse-square. three.js r128 with
   physicallyCorrectLights=false does NOT use inverse-square — it uses
       pow( saturate( 1 - d/distance ), decay )
   which is a LINEAR reach that hits exactly zero at d=distance. Two consequences
   the old code walked straight into:

     * A per-light `Math.min(intensity*scale, 4)` clamp. The saucer authors a 46199cd
       key and an 8153cd fill — a deliberate 5.7:1 ratio. Both landed on 4. Any two
       lights over the ceiling become EQUAL, so the clamp does not dim a room, it
       deletes its lighting design. Fixed by normalising the room as a GROUP: if the
       brightest light exceeds `max`, every light scales by the same factor and the
       relationships survive. (max:0 = off, which is now the default — with `gain`
       doing the work there is nothing for a ceiling to protect against.)

     * A forced distance of 260 (spot) / 180 (point). Those are constants, and rooms
       are not the same size. The saucer's key hangs 209 units from the table, so
       (1 - 209/260)^2 = 0.038: it delivered under 4% and read as unlit. The pub's
       fireplace and all three sconces sit BEYOND 180 and delivered exactly zero.
       Tuning lightScale could not fix either, because above ~8000cd the clamp ate
       the change first — which is precisely why the knob felt dead.

   What replaces it. Two derivations, in this order:

     base = candela / d0^2      (d0 = the light's own distance to the table)
       This is the one line that makes the transfer faithful. It reproduces the
       inverse-square RELATIONSHIP Blender rendered under, so a near fill and a
       distant key keep their true relative contribution at the table instead of
       being flattened onto one falloff curve. It also drags the number into a
       human range: `gain` reads ~3 rather than ~0.0005.
       NB the honest ratio at the table is therefore the IRRADIANCE ratio (saucer
       1.78:1), not the raw wattage ratio (5.7:1) — the fill is closer, so it earns
       back some of the difference. That is what Blender showed.

     distance = d0 * reach      (falloff at the table = (1-1/reach)^decay, a CONSTANT)
       Scale-invariant on purpose: a pendant 97 units up and a spot 209 units up now
       land on the same falloff at the table, so a room's brightness stops depending
       on how high its fixtures happen to hang. Because that factor is constant and
       known, `gain` finally means something you can predict. The room itself still
       gets falloff shaping — near walls brighter than far ones — which is why this
       keeps a cutoff at all rather than setting distance=0.

   Why not just flip physicallyCorrectLights and get true inverse-square everywhere:
   it is a RENDERER flag, so it would also rewrite the 2 goalLights and the 5-strong
   fxLightPool, whose intensities are hand-tuned at ~5 call sites against the legacy
   curve. Converting those needs a reference distance per site and each one is a
   visible effect (goal flash, ball glow, explosion, respawn swirl) — the conversion
   factors work out between ~37x and ~204x depending on the distance guessed, so
   there is no single constant and every site would be an unverified guess. The room
   lights are the only lights in the game whose values come from an external tool, so
   the transfer is fixed where the transfer actually happens. */
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
/* Transfer a room GLB's baked punctual lights. Called with the room still detached,
   so world matrices are forced up to date first — d0 is a WORLD distance and the
   whole derivation above hangs off it. */
function applyRoomLights(room,R){
 const D=(CONFIG.render&&CONFIG.render.roomLight)||{};
 const C=Object.assign({gain:1,reach:3,decay:2,minDist:20,max:0},D,(R&&R.light)||{});
 room.updateMatrixWorld(true);
 const lights=[];const p=new THREE.Vector3();
 room.traverse(c=>{if(c.isLight)lights.push(c);});
 if(!lights.length)return lights;
 // Fixtures the room switches off by name — usually because the editor DETACHED one into an
 // authored rooms.<id>.lights entry that can be moved, and two copies of one lamp is one too
 // many. intensity 0 rather than visible=false on purpose: hiding a light changes the scene's
 // light count and recompiles every material, and a dev toggling a lamp should not pay that.
 const off=new Set(((R&&R.lightsOff)||[]).map(s=>String(s).toLowerCase()));
 lights.forEach(l=>{
  /* AUTHORED CANDELA, stashed on the FIRST pass only. The transfer below OVERWRITES intensity,
     so without this stash the function is not idempotent — and it is called twice in real use:
     once at GLB load, then again on every drag of the room editor's gain/reach sliders. A second
     pass would divide the already-transferred value by d0^2 a second time and collapse the room
     to black; worse, a room authored at gain:0 lands every fixture on 0 and could NEVER come
     back, because 0*gain is 0 for every gain. That is exactly what made those sliders read dead. */
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
 // Ratio-preserving ceiling. Scales the WHOLE room by one factor so the authored
 // key:fill relationship cannot be flattened the way a per-light clamp flattens it.
 if(C.max>0){
  let mx=0;lights.forEach(l=>{if(l.intensity>mx)mx=l.intensity;});
  if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity*=k);
   console.log('room lights normalised x'+k.toFixed(3)+' (peak '+mx.toFixed(2)+' > max '+C.max+')');}
 }
 // Applied LAST so a silenced fixture cannot drag the ceiling above down onto the ones
 // that are still lit — the peak must be measured over the lights that actually contribute.
 lights.forEach(l=>{if(l.userData.roomOff){l.userData.roomOffInt=l.intensity;l.intensity=0;}});
 return lights;
}

const roomLoading={};   // room id -> [pending cbs] while its backdrop GLB is in flight
/* Rooms whose GLB came back 404. WITHOUT this a room pointing at a file that isn't there is
   re-fetched on EVERY applyRoom — and applyRoom runs on every venue change, so a missing backdrop
   cost a network round-trip per screen transition. Worse, applyRoom's "this room has no backdrop"
   fallback (the shared ground plane) tests rm.glb, which is still set on a room whose file
   is absent — so it never engaged and the room rendered as an empty void that CLAIMED, in the
   console, to be using the shared backdrop. roomHasGlb() is the honest test both paths read.
   Session-scoped: a reload re-tries, so dropping the file in during development still works. */
const roomFailed={};
function roomHasGlb(id){const R=CONFIG.rooms&&CONFIG.rooms[id];return !!(R&&R.glb&&!roomFailed[id]);}
function ensureRoom(id,cb){
 const R=CONFIG.rooms&&CONFIG.rooms[id];
 if(!roomHasGlb(id)){if(cb)cb();return;}
 if(roomGroups[id]){touchRoom(id);if(cb)cb();return;}
 // In flight: QUEUE the cb so it fires when the backdrop is truly resident, not immediately —
 // a kickoff gate reading this must not proceed with the room still downloading (skipped intro).
 if(roomLoading[id]){if(cb)roomLoading[id].push(cb);touchRoom(id);return;}
 const cbs=roomLoading[id]=cb?[cb]:[];touchRoom(id);
 const flush=()=>{delete roomLoading[id];cbs.forEach(f=>f&&f());};
 const url=(R.folder||'')+R.glb;
 newGLTF().load(url,gltf=>{
  try{
   const room=gltf.scene;
   room.traverse(c=>{if(c.isMesh){c.castShadow=false;c.receiveShadow=true;}});   // backdrop, not a shadow caster
   applyEmissiveStrength(room);                    // r128 does not support KHR_materials_emissive_strength
   const rl=applyRoomLights(room,R);               // candela -> screen; see the block above
   if(rl.length)console.log('room "'+id+'" lights: '+rl.map(l=>(l.name||l.type)+' '+l.intensity.toFixed(3)+(l.distance?'@'+l.distance.toFixed(0):'')).join(', '));
   room.visible=false;scene.add(room);
   roomGroups[id]=room;
   console.log('room "'+id+'" loaded ('+R.glb+')');
  }catch(e){console.warn('room GLB hookup failed for '+id,e);}
  flush();                                          // resident now → release every queued cb
 },undefined,()=>{
  roomFailed[id]=true;                              // latch: never re-fetch this file, and let applyRoom fall back to the shared backdrop for real
  const oi=roomOrder.indexOf(id);if(oi>=0)roomOrder.splice(oi,1);
  console.warn('room GLB missing for '+id+' ('+url+'), using shared backdrop');
  flush();                                          // GLB missing → shared backdrop; release queued cbs so a gate doesn't wait forever
 });
}
/* Free an evicted room backdrop. Rooms are never cloned, so a hard dispose is safe. NEVER call on
   the room currently visible.
   THE REFLECTION BAKE IS DELIBERATELY LEFT BEHIND. It used to be freed right here, one line below
   the group it came from, which looked like tidy bookkeeping and was the expensive half of a room
   switch. The bake is an independent ~6MB cubemap that holds no reference back to the group; the
   group is 20-45MB of geometry and texture. Freeing the small thing — the one that costs a full
   PMREM pass to recreate — in order to free the large thing alongside it is the trade backwards,
   and it meant an A/B room toggle re-baked BOTH rooms every single time. roomEnvCache has its own
   LRU now (CONFIG.tableAssets.cacheEnvs, world.js pruneEnvs) and that is what bounds it.
   The leak the old code guarded against is still guarded, just from there: pruneEnvs frees through
   envDispose(), never tex.dispose() — a PMREM bake is a RENDER TARGET and freeing its texture
   alone leaves the framebuffer allocated (see world.js envKeep). */
function disposeRoom(id){
 const room=roomGroups[id];if(!room)return;
 if(typeof disposeRoomProps==='function')disposeRoomProps(id);   // instanced props go with the room
 scene.remove(room);delete roomGroups[id];
 const oi=roomOrder.indexOf(id);if(oi>=0)roomOrder.splice(oi,1);
 disposeModelTemplate(room);
 console.log('room freed: '+id+' (reflection bake kept — see the note above)');
}
// Back-compat shim: the old eager all-rooms loader. Nothing calls it now — kept so an
// external/console caller doesn't hit a missing function.
function loadRoomModel(){for(const id in CONFIG.rooms)ensureRoom(id);}

/* --- rods (per-table livery, lazy) ----------------------------------------
   Rods used to be one global asset loaded once. Now each TABLE may bring its own rod set
   (CONFIG.tables[id].rods); tables without one share the stock assets/rods/ set. Sets are keyed
   by rodSetKey (a table id, or '_shared'), lazy-loaded the first time a table needs them, cloned
   per rod by makeRodModel, and kept resident (rod GLBs are tiny hardware meshes — no LRU needed,
   and they're clone SOURCES so hard-disposing them while clones live would be unsafe anyway).
   Per size, a table set that lacks a GLB falls back to the shared set, then to the primitive rod
   in world.js buildRods. VISUAL ONLY — physics/RODDEFS are identical across tables. */
function rodSetKey(tableId){const T=CONFIG.tables[tableId];return (T&&T.rods)?tableId:'_shared';}

/* Load one rod set by KEY. '_shared' loads assets/rods/fuzeball_rod_<n>man.glb (old assets/ root
   as a fallback). A table key loads from CONFIG.tables[key].rods.folder (per-size 404 -> leave the
   size unset so makeRodModel falls back to the shared template). cb runs once the whole batch
   settles; concurrent callers for the same set are queued. Idempotent once loaded. */
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
// Boot: prime the SHARED set + the active table's set (may BE the shared set), then onReady so
// buildRods can clone them.
function loadRodModels(onReady){
 const tid=(typeof cfg!=='undefined'&&CONFIG.tables[cfg.table])?cfg.table:'classic';
 const keys=['_shared'];const tk=rodSetKey(tid);if(tk!=='_shared')keys.push(tk);
 let left=keys.length;const done=()=>{if(--left===0)onReady();};
 keys.forEach(k=>loadRodSet(k,done));
}
// Ensure a table's rod set is resident (used by applyTable on a table switch); cb on settle.
function ensureTableRods(tableId,cb){
 if(typeof loadRodSet!=='function'){if(cb)cb();return;}
 loadRodSet(rodSetKey(tableId),cb);
}

/* Clone the right rod set's model for one rod, tinting the team-coloured parts. `tableId` picks
   the set; a size the set lacks falls back to the shared set, else null (buildRods draws the
   primitive). */
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
  newGLTF().load(m.explosionSrc,
   gltf=>{delete explosionLoading[id];applyEmissiveStrength(gltf.scene);
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

/* the GLB holds one mesh per ball type (classic/fire/cannon/split/golden), all at
   the origin — show ONLY the matching one; missing types fall back to classic. */
function makeBallModel(key){
  if(!ballModel)return null;
  const want=key.toLowerCase();
  if(!ballMatMap[want])return null;   // no baked mesh slot for this type (e.g. knuckleball) → caller uses the generated colour sphere
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

/* --- power-up pickup models -------------------------------------------------
   The floating pickup for a power-up type (CONFIG.powerups.models). Optional per type:
   a type with no entry, or whose GLB is missing, falls back to the procedural octahedron
   in powerups.js — the pickup still spawns and still collects, it just looks plainer.
   Templates are loaded once at boot and clone()d per spawn, so a pickup popping in
   mid-match costs one clone and nothing else. Everything that would otherwise touch a
   MATERIAL at spawn time (glow, shadow flags) is baked into the template here instead:
   a fresh material mid-match means a shader compile, i.e. a hitch at the exact moment
   the pickup appears. */
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
    // Recentre on the model's own middle (so the idle spin turns about it, not about whatever
    // origin the artist happened to leave) and normalise the size: `fit` is the bounding-sphere
    // radius we want in world units, which makes the authored Blender scale irrelevant.
    const bb=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.sub(bb.getCenter(new THREE.Vector3()));
    const rad=bb.getSize(new THREE.Vector3()).length()/2;
    if(d.fit&&rad>1e-4)wrap.scale.setScalar(d.fit/rad);
    // Strip any KHR punctual light the artist baked in. A pickup is added to the scene MID-MATCH,
    // and r128 bakes the scene's light COUNT into every material's shader program — so one light
    // riding in on the pickup would force a whole-scene recompile (a multi-hundred-ms freeze) the
    // instant it pops in, and again when it's collected. Use `glow` for brightness instead; if a
    // pickup ever genuinely needs to cast light, borrow one from the resident fx light pool
    // (world.js fxLightGet) rather than adding one here.
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
      // Keep an authored emissive colour; only fall back to the type's HUD colour when the
      // material has none, so a hand-painted glow isn't overwritten by the swatch.
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
// One pickup instance, or null when that type has no loaded model (caller draws the gem).
function makePUModel(key){const t=puTemplates[key];return t?t.clone(true):null;}
/* Off-screen shader precompile. A pickup joins the scene mid-match, so without this its first
   frame compiles there — same reasoning (and same shape) as warmFractureTemplate. */
function warmPowerupShaders(){
 if(!renderer||!scene||!camera)return;
 for(const k in puTemplates){
  const o=puTemplates[k].clone(true);o.position.set(0,-500,0);
  scene.add(o);renderer.compile(scene,camera);scene.remove(o);
 }
}

/* --- pitches (one GLB each, lazy + LRU) --------------------------------------
   Was ONE 32MB atlas holding all eight, so booting into any pitch downloaded it and GLTFLoader
   decoded all 22 of its images — to show three. drawField then detached the seven meshes you were
   not using, which correctly kept VRAM down and did nothing at all about the fetch or the decode
   that had already happened. Now it is the same shape rooms and skins already use: one file per
   id, fetched when picked, evicted past CONFIG.tableAssets.cachePitches, LRU, active protected.
   Split with tools/pitch-split.mjs — see the note above CONFIG.pitches for why the variant key is
   the MATERIAL name and not the mesh name. */
const pitchGroups={};    // pitch id -> its loaded GLB group (parented into the table group when shown)
const pitchLoading={};   // pitch id -> [pending cbs] while its GLB fetch is in flight
const pitchFailed={};    // 404 latch — same reason roomFailed exists: without it a missing file is
                         // re-fetched on every drawField, and drawField runs on every venue change
const pitchOrder=[];     // LRU, least-recent first
function pitchHasGlb(id){const P=CONFIG.pitches&&CONFIG.pitches[id];return !!(P&&P.glb&&!pitchFailed[id]);}
function touchPitch(id){const i=pitchOrder.indexOf(id);if(i>=0)pitchOrder.splice(i,1);pitchOrder.push(id);}
/* Ensure one pitch's GLB is resident. Idempotent; cb fires on success, on failure, and on every
   no-op, so drawField can gate on it the way applyRoom gates on ensureRoom. */
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
/* Free an evicted pitch. Never call on the one currently shown — prunePitches protects it. */
function disposePitch(id){
  const g=pitchGroups[id];if(!g)return;
  if(g.parent)g.parent.remove(g);
  delete pitchGroups[id];
  const oi=pitchOrder.indexOf(id);if(oi>=0)pitchOrder.splice(oi,1);
  disposeModelTemplate(g);                  // shared GPU-free helper (world.js)
  console.log('pitch freed: '+id);
}
/* Evict past CONFIG.tableAssets.cachePitches, LRU first. Measured as "how many NON-kept entries
   may stay", the same way pruneSkins/pruneRooms/pruneEnvs are, so cachePitches:1 legally means
   "hold nothing you are not standing on". */
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
