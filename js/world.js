'use strict';
/* ================= three.js world ================= */
let renderer,scene,camera,dirLight;
const teamMat=[null,null],teamGlow=[null,null];
let fieldMesh,fieldTexCache={},wallMat,ledMat,goalFrames=[],goalLights=[],netMats=[],crowdMesh,primTable=null;
let rods=[],indicator,dropRing;
let sprites=[],spriteTex,particles,pGeo,pData=[];
let playerModel=[null,null]; const playerTeamMats=[{},{}]; const playerHairParts=[new Set(),new Set()]; const modelCache={};

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
  buildTable();buildArenaTable();buildCrowd();buildFxPools();
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
}

function buildTable(){
 // primitive table lives in primTable so a loaded GLB table can hide it wholesale (see models.js).
 primTable=new THREE.Group();scene.add(primTable);
 const loader=new THREE.TextureLoader();
 const fieldMat=new THREE.MeshStandardMaterial({roughness:.85});
 fieldMesh=new THREE.Mesh(new THREE.PlaneGeometry(F.L,F.W),fieldMat);
 fieldMesh.rotation.x=-Math.PI/2;fieldMesh.receiveShadow=true;primTable.add(fieldMesh);
 for(const [key,th] of Object.entries(THEMES)){
   loader.load('assets/'+th.pitch,tex=>{
    tex.encoding=THREE.sRGBEncoding;tex.anisotropy=4;fieldTexCache[key]=tex;
   if(key===cfg.theme){fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;}
  });
 }
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
 [-1,1].forEach((sx,i)=>{
  const g=new THREE.Group();g.position.set(sx*(F.L/2),0,0);
  const frameM=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.3,roughness:.3,metalness:.5});
  const postG=new THREE.BoxGeometry(1.2,F.goalH+1,1.2);
  [-1,1].forEach(sz=>{const p=new THREE.Mesh(postG,frameM);p.position.set(0,(F.goalH+1)/2,sz*F.goalHalf);g.add(p);});
  const bar=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.2,F.goalHalf*2+1.2),frameM);
  bar.position.set(0,F.goalH+.5,0);g.add(bar);
  const netM=new THREE.MeshStandardMaterial({color:i?cfg.blueColor:cfg.redColor,transparent:true,opacity:.16,roughness:.9,side:THREE.DoubleSide});
  netMats.push(netM);
  const net=new THREE.Mesh(new THREE.BoxGeometry(F.goalDepth,F.goalH,F.goalHalf*2),netM);
  net.position.set(sx*(F.goalDepth/2+1.6),F.goalH/2,0);g.add(net);
  const gl=new THREE.PointLight(0xffffff,0,70);gl.position.set(sx*5,F.goalH+7,0);g.add(gl);goalLights.push(gl);
  goalFrames.push(g);scene.add(g);});
}

function buildCrowd(){
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshStandardMaterial({color:0x0b0e16,roughness:1}));
 ground.rotation.x=-Math.PI/2;ground.position.y=-44;scene.add(ground);
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
  if(modelCache[am.id]){useCache(modelCache[am.id]);return;}
  new THREE.GLTFLoader().load(am.src,
   gltf=>{modelCache[am.id]=gltf.scene;useCache(gltf.scene);},
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
    kickT:-1,kickDir:d.team===0?1:-1,raise:false,cd:0,aiMan:-1,
    behindFlag:false,                          // sticky raise latch: set when ball crosses raiseBehind, cleared only on overFoot
     aiErr:0,aiErrT:0,aiErrTarget:0,aiBX:0,aiBZ:0,aiBVX:0,aiBVZ:0,aiGoalZ:0,
     removedUntil:[]});
 });
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

function drawField(){
 const tex=fieldTexCache[cfg.theme];
 if(tex){fieldMesh.material.map=tex;fieldMesh.material.needsUpdate=true;}
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
  loadPlayerModel(()=>{applyColors();if(rods.length)rebuildRodMen();if(onReady)onReady();});
}
