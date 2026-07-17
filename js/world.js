'use strict';
/* ================= three.js world ================= */
let renderer,scene,camera,dirLight;
const teamMat=[null,null],teamGlow=[null,null];
let fieldMesh,fieldTexCache={},wallMat,ledMat,goalFrames=[],goalLights=[],netMats=[],crowdMesh,groundMesh,primTable=null,pitchGroup=null,pitchVariants=null;
// big-goal GLB hookup, per goal index [0=left/-x, 1=right/+x] (matches goalFrames order):
// glbGoalGrow = baked frame meshes uniform-scaled about z=0; glbGoalWall = end-wall meshes {o,inner,outer,sgn} slid open. Filled by registerBigGoalMeshes, driven in bigGoalUpdate.
let glbGoalGrow=[[],[]],glbGoalWall=[[],[]],glbGoalSplit=[];
// glbGoalSplit: a single baked frame mesh that spans BOTH goals (e.g. an arena frame exported as one
// object) can't scale per-side, so it's morphed vertex-wise — each vert widens by its own goal's mult.
let rods=[],indicator,dropRing;
let rodCustomMats=[]; // {mat, team, isGlow} — rod GLB materials detached from teamMat/teamGlow via cloneWithMaps
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

function initThree(){
 renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.setSize(innerWidth,innerHeight);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.outputEncoding=THREE.sRGBEncoding;
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,1,700);
 camera.position.set(0,92,86);camera.lookAt(0,0,2);
 scene.add(new THREE.HemisphereLight(0xcdd9ff,0x1c1610,.85));
 dirLight=new THREE.DirectionalLight(0xffffff,1.05);
 dirLight.position.set(45,100,35);dirLight.castShadow=true;
 dirLight.shadow.mapSize.set(2048,2048);
 const sc=dirLight.shadow.camera;sc.left=-80;sc.right=80;sc.top=70;sc.bottom=-70;sc.far=260;
 scene.add(dirLight);
 teamMat[0]=new THREE.MeshStandardMaterial({color:cfg.redColor,roughness:.45,metalness:.15});
 teamMat[1]=new THREE.MeshStandardMaterial({color:cfg.blueColor,roughness:.45,metalness:.15});
 teamGlow[0]=new THREE.MeshStandardMaterial({color:cfg.redColor,emissive:cfg.redColor,emissiveIntensity:.55,roughness:.4});
  teamGlow[1]=new THREE.MeshStandardMaterial({color:cfg.blueColor,emissive:cfg.blueColor,emissiveIntensity:.55,roughness:.4});
  buildTable();buildArenaTable();buildCrowd();buildFxPools();buildEnvironment();
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
}

/* Bake a neon-arcade environment map (PMREM) and set it as scene.environment so
   EVERY MeshStandardMaterial — balls (esp. the metallic golden), the table, and
   the players — picks up reflections/soft image-based lighting. Without this,
   fully-metallic materials render black (nothing to reflect). Baked once, static.
   Colours echo the arena room so reflections read as "the room" on any table. */
function buildEnvironment(){
 if(!renderer||!scene)return;
 const pmrem=new THREE.PMREMGenerator(renderer);
 pmrem.compileEquirectangularShader();
 const es=new THREE.Scene();
 es.add(new THREE.Mesh(new THREE.BoxGeometry(560,320,560),                       // dark room shell
  new THREE.MeshBasicMaterial({color:0x0b1022,side:THREE.BackSide})));
 const panel=(col,x,y,z,w,h)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
  new THREE.MeshBasicMaterial({color:col,side:THREE.DoubleSide}));
  m.position.set(x,y,z);m.lookAt(0,0,0);es.add(m);};                             // neon strips → coloured reflections
 panel(0x18e0ff,-250, 30,-110,260,120);   // cyan wall glow
 panel(0xff2bd6, 250, 30, 110,260,120);   // magenta wall glow
 panel(0x9b6bff,   0,150,-250,340,90);    // purple back strip
 panel(0xffffff,   0,155,   0,150,150);   // soft white key from above
 scene.environment=pmrem.fromScene(es,0.02,1,1200).texture;                      // sigma small (≤20 blur samples); near/far cover the 560-unit shell
 if(!scene.background)scene.background=new THREE.Color(0x070910);                 // subtle backdrop where nothing else draws
 pmrem.dispose();
}

function buildTable(){
 // primitive table lives in primTable so a loaded GLB table can hide it wholesale (see models.js).
 primTable=new THREE.Group();scene.add(primTable);tableGroups.classic=primTable;
 const fieldMat=new THREE.MeshStandardMaterial({roughness:.85});
 fieldMesh=new THREE.Mesh(new THREE.PlaneGeometry(F.L,F.W),fieldMat);
 fieldMesh.rotation.x=-Math.PI/2;fieldMesh.receiveShadow=true;primTable.add(fieldMesh);
  // Load ONLY the active pitch's texture (was: all ~7 up front, decoding every image into
  // RAM for the one shown). The rest come in on demand via drawField→loadPitchTex.
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
 ledMat=new THREE.MeshStandardMaterial({color:0x38e0ff,emissive:0x38e0ff,emissiveIntensity:1.1,roughness:.4});
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
  const bx=sx*GD,GT=GH;                                        // net back-plane depth/height (no back posts — the net hangs free inside the wall gap)
  // net: team-tinted white diamond mesh; ONE material per goal (recoloured in applyColors). The roof is a
  // SOLID collider in physics (goalFrameCollide) so a shot over the bar lands on top instead of scoring.
  const netM=new THREE.MeshStandardMaterial({color:i?cfg.blueColor:cfg.redColor,map:netTex,transparent:true,opacity:.85,roughness:.9,side:THREE.DoubleSide,depthWrite:false});
  netMats.push(netM);
   const V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const backW=GHW*.98,BX=bx*.98,FBL=V(0,0,-GHW),FBR=V(0,0,GHW),FTL=V(0,GH,-GHW),FTR=V(0,GH,GHW),
        BBL=V(BX,0,-backW),BBR=V(BX,0,backW),BTL=V(BX,GT,-backW),BTR=V(BX,GT,backW);
  const nets=[];   // collect panels so bigGoalUpdate can taper the net BACK narrower than its mouth
  [[BBL,BBR,BTR,BTL],[FTL,FTR,BTR,BTL],[FBL,BBL,BTL,FTL],[FBR,FTR,BTR,BBR],[FBL,FBR,BBR,BBL]] // back, roof, sides, floor
   .forEach(q=>{const nm=netQuad(q[0],q[1],q[2],q[3],netM);nm.userData.base=Float32Array.from(nm.geometry.attributes.position.array);g.add(nm);nets.push(nm);});
  g.userData.net=nets;
  const gl=new THREE.PointLight(0xffffff,0,70);gl.position.set(sx*5,GH+7,0);g.add(gl);goalLights.push(gl);
  goalFrames.push(g);scene.add(g);});
 tablePrimObjs.classic=primTable.children.filter(c=>c.isMesh&&c!==fieldMesh);  // procedural fallback (hidden when a skin GLB is shown)
}

/* procedural goal net: white diamond mesh on a transparent canvas so the net reads from any camera
   without an image asset. netQuad builds an arbitrary 4-corner panel (so the roof can slope) and
   tiles the net into square cells via UVs scaled by edge length; the shared CanvasTexture wraps. */
function makeNetTex(){
 const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
 x.clearRect(0,0,64,64);x.strokeStyle='rgba(255,255,255,.85)';x.lineWidth=1.5;
 for(let k=-64;k<=64;k+=10){x.beginPath();x.moveTo(k,0);x.lineTo(k+64,64);x.stroke();
  x.beginPath();x.moveTo(k,64);x.lineTo(k+64,0);x.stroke();}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function netQuad(a,b,c,d,mat){
 const cell=1.6,ru=Math.max(1,Math.round(a.distanceTo(b)/cell)),rv=Math.max(1,Math.round(a.distanceTo(d)/cell));
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z],3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,ru,0,ru,rv,0,rv],2));
 geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();
 return new THREE.Mesh(geo,mat);
}

function buildCrowd(){
 groundMesh=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshStandardMaterial({color:0x0b0e16,roughness:1}));
 groundMesh.rotation.x=-Math.PI/2;groundMesh.position.y=-44;scene.add(groundMesh); // hidden when the arena room backdrop is shown (applyTable)
 const cv=document.createElement('canvas');cv.width=512;cv.height=128;
 const c=cv.getContext('2d');c.fillStyle='#0a0c14';c.fillRect(0,0,512,128);
 for(let i=0;i<1400;i++){c.fillStyle='hsl('+Math.floor(Math.random()*360)+','+(40+Math.random()*40)+'%,'+(25+Math.random()*45)+'%)';
  c.beginPath();c.arc(Math.random()*512,18+Math.random()*104,1.1+Math.random()*1.4,0,7);c.fill();}
 const ct=new THREE.CanvasTexture(cv);ct.wrapS=THREE.RepeatWrapping;ct.repeat.x=4;
 crowdMesh=new THREE.Mesh(new THREE.CylinderGeometry(210,210,90,48,1,true),new THREE.MeshBasicMaterial({map:ct,side:THREE.BackSide}));
 crowdMesh.position.y=10;scene.add(crowdMesh);
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
  new THREE.GLTFLoader().load(am.src,
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
  g.scale.setScalar(activeModel(team).scale*(cfg.modelScale||1));
  g.traverse(child=>{
   if(!child.isMesh)return;
   const name=child.material.name.toLowerCase();
   if(playerTeamMats[team][name])child.material=playerTeamMats[team][name];
   else if(playerHairParts[team].has(name)){
    child.material=child.material.clone();
    const sw=CONFIG.playerModel.hairSwatches;
    child.material.color.set(sw[Math.floor(Math.random()*sw.length)]);
   }
   child.castShadow=true;
  });
  return g;
}

/* Handle-collar z for a rod. Sits `wallClear` past the outer side wall face
   (F.W/2 + 3) even at full inward slide, so the handle never pulls through the
   wall; the symmetric bar (±collar) keeps the far end clear across slide too. */
function rodCollar(maxOff){return F.W/2+3+CONFIG.rods.wallClear+maxOff;}

function buildRods(){
 const rodM=new THREE.MeshStandardMaterial({color:0xc8cfdb,roughness:.25,metalness:.9});
 const bumpMat=new THREE.MeshStandardMaterial({color:0x14181f,roughness:.7,metalness:.2});
 const hl=CONFIG.rods.handleLen,cl=CONFIG.rods.collarLen,cap=CONFIG.rods.capOut;
 RODDEFS.forEach((d,idx)=>{
  const sp=d.men===2?CONFIG.rods.spacing.two:d.men===3?CONFIG.rods.spacing.three:CONFIG.rods.spacing.other;
   let maxOff=(F.W-CONFIG.rods.margin-(d.men-1)*sp)/2;
   if(d.slideCap!=null)maxOff=Math.min(maxOff,d.slideCap);
   else if(d.role==='GK')maxOff=Math.min(maxOff,CONFIG.rods.gkSlide); // keeper stays in its area → shorter rod
  const collar=rodCollar(maxOff);
  const pivot=new THREE.Group();pivot.position.set(d.x,ROD_H,0);scene.add(pivot);
  let hg=null,cm=null;
  const rodModel=makeRodModel(d.men,d.team);         // GLB rod if loaded, else null → primitives below
  if(rodModel){pivot.add(rodModel);}
  else{
   // bar reaches the collar + cap on each end; the handle grip hides the near tip.
   const rodMesh=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,2*(collar+cl+cap),10),rodM);
   rodMesh.rotation.x=Math.PI/2;rodMesh.castShadow=true;pivot.add(rodMesh);
   hg=new THREE.Group();
   const hb=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,hl,12),teamMat[d.team]);hb.rotation.x=Math.PI/2;hg.add(hb);
   const knob=new THREE.Mesh(new THREE.BoxGeometry(.9,.9,2.6),teamGlow[d.team]);knob.position.x=1.6;hg.add(knob);
   hg.position.z=collar+hl/2;pivot.add(hg);
   // collar: the stopper opposite the handle; the bar tip pokes `cap` past it.
   cm=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,cl,12),bumpMat);
   cm.rotation.x=Math.PI/2;cm.position.z=-(collar+cl/2);cm.castShadow=true;pivot.add(cm);
  }
  const baseZ=[],men=[];
  for(let i=0;i<d.men;i++){const bz=(i-(d.men-1)/2)*sp;baseZ.push(bz);
    const p=makePlayer(d.team);p.position.z=bz;p.position.y=PLAYER_H;if(d.team===1)p.rotation.y=Math.PI;pivot.add(p);men.push(p);}
    rods.push({idx,x:d.x,team:d.team,role:d.role,men,baseZ,maxOff,pivot,handle:hg,collar:cm,rodModel,
     offset:0,target:0,slideV:0,angle:0,prevAngle:0,prevOffset:0,angVel:0,vz:0,
     kickT:-1,kickStyle:null,kickDir:d.team===0?1:-1,raise:false,padAngleTarget:0,padAngleOn:false,cd:0,aiMan:-1,
    behindFlag:false,
     aiErr:0,aiErrT:0,aiErrTarget:0,aiBX:0,aiBZ:0,aiBVX:0,aiBVZ:0,aiGoalZ:0,
     removedUntil:[]});
  });
  rodCustomMats=[];
  rods.forEach(r=>{if(r.rodModel&&r.rodModel.userData.teamClones)
   r.rodModel.userData.teamClones.forEach(c=>rodCustomMats.push({mat:c.mat,team:r.rodModel.userData.team,isGlow:c.isGlow}));});
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
 indicator=new THREE.Mesh(new THREE.ConeGeometry(1.7,3.4,4),new THREE.MeshBasicMaterial({color:0xffffff}));
 indicator.rotation.x=Math.PI;indicator.visible=false;scene.add(indicator);
}

function applyPitchModel(){
  if(!pitchModel)return;
  if(pitchGroup)return;  // idempotent — already built
  pitchGroup=pitchModel;
  pitchModel=null;       // ownership transferred; the model is now in the scene
  (fieldMesh?fieldMesh.parent:primTable).add(pitchGroup);
  drawField();
}

// One-time map of the loaded pitch GLB's meshes → variant key, remembering each mesh's
// parent so it can be detached/re-attached. Built from the GLB as loaded (before any
// removal), so every variant's parent link is captured intact.
function indexPitchVariants(){
  pitchVariants={};
  if(!pitchGroup)return;
  pitchGroup.traverse(c=>{if(!c.isMesh)return;const k=ballKey(c);if(!k)return;
   (pitchVariants[k]||(pitchVariants[k]=[])).push({mesh:c,parent:c.parent});});
}
// Release a detached variant's GPU buffers + textures. CPU-side geometry attributes and
// texture.image survive, so three.js re-uploads automatically if the pitch is re-selected.
function freePitchMeshGPU(c){
  if(c.geometry&&c.geometry.dispose)c.geometry.dispose();
  const mats=Array.isArray(c.material)?c.material:[c.material];
  for(const m of mats){if(!m)continue;
   for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap','displacementMap','lightMap']){
    const t=m[k];if(t&&t.dispose)t.dispose();}}
}
/* Lazy pitch-texture loader/cache. Loads assets/<pitch.tex> once, caches it in
   fieldTexCache, and hands it back (or null on failure) via cb. Only the JPG-fallback path
   uses this — when a pitch GLB is present drawField never touches fieldTexCache. */
function loadPitchTex(pid,cb){
  if(fieldTexCache[pid]){if(cb)cb(fieldTexCache[pid]);return;}
  const pdef=CONFIG.pitches[pid];
  if(!pdef){if(cb)cb(null);return;}
  new THREE.TextureLoader().load('assets/'+pdef.tex,tex=>{
   tex.encoding=THREE.sRGBEncoding;tex.anisotropy=4;fieldTexCache[pid]=tex;if(cb)cb(tex);
  },undefined,()=>{console.warn('pitch texture missing (assets/'+pdef.tex+')');if(cb)cb(null);});
}
function drawField(){
  const pdef=CONFIG.pitches[cfg.pitch];
  if(!pdef)return;
  const glbKey=pdef.glb;
  if(pitchGroup){
    if(!pitchVariants)indexPitchVariants();
    // Only the selected variant stays in the scene graph. The rest are DETACHED (not merely
    // hidden) so renderer.compile()/the render loop never touch them — otherwise compile
    // uploads every variant's textures to VRAM regardless of .visible. Re-attaching on switch
    // re-uploads from the retained CPU data (a one-frame cost, only when changing pitch).
    let shown=false;
    for(const key in pitchVariants){
      const active=key===glbKey;
      for(const v of pitchVariants[key]){
        if(active){if(!v.mesh.parent)v.parent.add(v.mesh);v.mesh.visible=true;shown=true;}
        else if(v.mesh.parent){freePitchMeshGPU(v.mesh);v.parent.remove(v.mesh);}
      }
    }
    if(shown){if(fieldMesh)fieldMesh.visible=false;return;}
  }
  if(fieldMesh){fieldMesh.visible=true;
   const cur=cfg.pitch;
   loadPitchTex(cur,tex=>{
    if(cfg.pitch!==cur)return;                     // user switched again while this loaded — let the newer call win
    if(tex){fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;
     for(const k in fieldTexCache){if(k!==cur&&fieldTexCache[k]){ // keep only the active pitch resident
      if(fieldTexCache[k].dispose)fieldTexCache[k].dispose();delete fieldTexCache[k];}}
    }
   });
  }
}

function applyTheme(){
 const th=THEMES[cfg.theme];
 scene.background=new THREE.Color(th.bg);
 scene.fog=new THREE.Fog(th.bg,200,430);
 wallMat.color.set(th.wall);
 ledMat.color.set(th.led);ledMat.emissive.set(th.led);
 drawField();
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
}

/* Surface finish (metalness / roughness / emissive glow) from the Customize
   panel, pushed onto every live team material so the game mirrors the preview. */
function applyFinish(){
 const mv=clamp(cfg.metalness,0,1),rv=clamp(cfg.roughness,0,1),gv=Math.max(0,cfg.glow);
 for(let t=0;t<2;t++){
  const col=t===0?cfg.redColor:cfg.blueColor;
  teamMat[t].metalness=mv;teamMat[t].roughness=rv;teamMat[t].emissive.set(col);teamMat[t].emissiveIntensity=gv;teamMat[t].needsUpdate=true;
  teamGlow[t].metalness=mv;teamGlow[t].roughness=Math.max(.12,rv);teamGlow[t].emissiveIntensity=Math.max(.55,gv);teamGlow[t].needsUpdate=true;
  for(const mat of Object.values(playerTeamMats[t])){
   mat.metalness=mv;mat.roughness=rv;
   if(mat.emissive){mat.emissive.set(col);mat.emissiveIntensity=gv;}
   mat.needsUpdate=true;
  }
 }
 for(const c of rodCustomMats){const col=c.team===0?cfg.redColor:cfg.blueColor;
  c.mat.metalness=mv;c.mat.roughness=c.isGlow?Math.max(.12,rv):rv;
  if(c.mat.emissive){c.mat.emissive.set(col);c.mat.emissiveIntensity=c.isGlow?Math.max(.55,gv):gv;}
  c.mat.needsUpdate=true;}
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
}

/* Load a freshly-selected figurine and refresh everything already on the table. */
function reloadPlayerModel(onReady){
  playerModel=[null,null];playerTeamMats[0]={};playerTeamMats[1]={};playerHairParts[0]=new Set();playerHairParts[1]=new Set();
  loadPlayerModel(()=>{applyColors();if(rods.length)rebuildRodMen();
   if(typeof ensureExplosionModel==='function'){ensureExplosionModel(activeModel(0).id);ensureExplosionModel(activeModel(1).id);} // pull in the newly-picked figurine's shatter GLB
   if(onReady)onReady();});
}
