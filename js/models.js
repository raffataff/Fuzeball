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
let roomModel=null;      // loaded arena room/environment GLB (arcade room) — shown only with the arena table
let pitchModel=null;     // loaded pitch GLB scene (one mesh per theme variant)
const ballMatMap={};     // ballType -> material name in GLB
const pitchMatMap={};    // pitch variant -> material (unused for now; mirrors ball loader)
const explosionTemplates={}; // figurine id -> {scene, clips} — see CONFIG.playerModel.models[].explosionSrc
let ballExplosionTemplate=null; // {scene, clips} — the cannonball's own shatter GLB (CONFIG.cannonball.explosionSrc), consumed by fracture.js spawnBallFracture

/* --- static table --------------------------------------------------------- */
function loadTableModel(){
 const load=(url,group,key)=>{
  const loader=new THREE.GLTFLoader();
  loader.load(url,gltf=>{
   try{
    let hasFrame=false;
    gltf.scene.traverse(c=>{
     if(!c.isMesh)return;
     c.castShadow=true;c.receiveShadow=true;
     const n=onm(c);
     if(n.startsWith('field'))c.visible=false;      // themed pitch plane stays instead
     else if(n.startsWith('led'))ledMat=c.material;
     else if(n.startsWith('goal_net'))c.visible=false;                           // keep the built-in diamond net
     else if(n.startsWith('goal_frame')||n.startsWith('goal_post'))hasFrame=true; // custom posts: keep visible, hide the primitive front frame
    });
    tableHasFrame[key]=hasFrame;                    // applyTable hides the primitive posts+bar for this table
    hideMeshes(group);                              // primitives off BEFORE the GLB joins (goalFrames live in scene, untouched)
    group.add(gltf.scene);                          // inside the group → applyTable toggles it
    gltf.scene.updateMatrixWorld(true);
    registerBigGoalMeshes(gltf.scene);              // wire baked frame + end-walls into the big-goal widen (bigGoalUpdate)
    if(key==='arena')registerArenaMorph(gltf.scene); // curved arena shell opens via SDF re-projection instead
    applyTable();applyTheme();applyColors();drawField();
    console.log(url.split('/').pop()+' loaded');
   }catch(e){console.warn('table GLB hookup failed, keeping primitives',e);}
  });
 };
 load('assets/fuzeball_table.glb',primTable,'classic');
 if(arenaTable)load('assets/tables/arena/fuzeball_table_arena.glb',arenaTable,'arena');
 loadRoomModel();
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
 new THREE.GLTFLoader().load('assets/tables/arena/fuzeball_room_arena.glb',gltf=>{
  try{
   roomModel=gltf.scene;
   roomModel.traverse(c=>{if(c.isMesh){c.castShadow=false;c.receiveShadow=true;}}); // room is the backdrop, not a shadow caster
   scene.add(roomModel);
   applyTable();                                  // set initial visibility to match the current table
   console.log('fuzeball_room_arena.glb loaded');
  }catch(e){console.warn('room GLB hookup failed',e);}
 },undefined,()=>console.warn('room GLB missing, no environment'));
}

/* --- rods ----------------------------------------------------------------- */
function loadRodModels(onReady){
 const loader=new THREE.GLTFLoader();
 const sizes=[1,2,3,5];let left=sizes.length;
 const done=()=>{if(--left===0)onReady();};
 sizes.forEach(n=>loader.load('assets/fuzeball_rod_'+n+'man.glb',
  gltf=>{rodTemplates[n]=gltf.scene;done();},
  undefined,
  ()=>{console.warn('rod_'+n+'man.glb missing, using primitive');done();}));
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
   Optional per-figurine "explode & collapse" GLB, consumed by js/fracture.js
   on a cannonball kill. Only figurines with an explosionSrc get the effect;
   the rest keep the original instant-vanish. Loaded once here, at boot, so a
   live explosion later is just a clone() + mixer.play() — no disk/network
   hit and no fresh material during a match. */
function loadExplosionModels(onReady){
  const off=CONFIG.debug?.fractureFx===false;                       // master kill-switch: no fracture GLBs loaded at all
  const list=off?[]:CONFIG.playerModel.models.filter(m=>m.explosionSrc);
  const ballSrc=off?null:CONFIG.cannonball.explosionSrc;            // the ball's own shatter GLB rides the same boot step + warm pass
  let left=list.length+(ballSrc?1:0);
  if(!left){onReady();return;}
  const done=()=>{if(--left<=0)onReady();};
  list.forEach(m=>{
   new THREE.GLTFLoader().load(m.explosionSrc,
    gltf=>{explosionTemplates[m.id]={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('explosion GLB missing for '+m.id+' ('+m.explosionSrc+')');done();});
  });
  if(ballSrc){
   new THREE.GLTFLoader().load(ballSrc,
    gltf=>{ballExplosionTemplate={scene:gltf.scene,clips:gltf.animations};done();},
    undefined,
    ()=>{console.warn('cannonball explosion GLB missing ('+ballSrc+')');done();});
  }
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
