'use strict';
/* ================= customize panel =================
   A self-contained turntable studio (its own tiny three.js scene) plus the
   controls that drive it. Colour + finish edits are pushed onto the live game
   materials too, so what you sculpt here is exactly what walks onto the table. */

const PV={on:false,ready:false,loadedId:null,team:0,spin:true,
 yaw:.5,pitch:0,dist:8,dragging:false,px:0,py:0,
 renderer:null,scene:null,camera:null,root:null,model:null,mats:[],
 rim:null,platform:null,ringMesh:null,cache:{},cacheOrder:[],baseScale:1};

/* Record a figurine template into the shared preview cache (PV.cache — used by the studio,
   menu thumbnails and league setup) and evict LRU entries past CONFIG.playerModel.cacheMax.
   dispose=false (ref-drop only): the studio/thumb/league may still hold a clone of an evicted
   template, so we never free its GPU here — dropping the JS ref still lets V8 reclaim the bulk
   (decoded images + geometry arrays) once every clone of it is gone. Protects the ids currently
   shown so an on-screen preview is never yanked. */
function pvCachePut(id,scene){
 if(typeof cacheModelTemplate!=='function'){PV.cache[id]=scene;return;} // helpers live in world.js; degrade gracefully
 cacheModelTemplate(PV.cache,PV.cacheOrder,id,scene);
 const protect=new Set([PV.loadedId,THB.loadedId&&THB.loadedId[0],THB.loadedId&&THB.loadedId[1],
  (typeof LSP!=='undefined'&&LSP)?LSP.lid:null,cfg.modelRed,cfg.modelBlue].filter(Boolean));
 capModelCache(PV.cache,PV.cacheOrder,protect,false);
}

/* ---- build controls + wire buttons (called once at boot) ---- */
function initCustomize(){
 const mc=$('czModels');mc.innerHTML='';
 CONFIG.playerModel.models.forEach(m=>{
  const d=document.createElement('div');d.className='czCard';d.dataset.id=m.id;d.title=m.blurb||m.name;
  d.innerHTML='<div class="cIco">'+(m.ico||'🏃')+'</div><div class="cName">'+m.name+'</div>';
  d.onclick=()=>czPickModel(m.id);mc.appendChild(d);
 });
 const lock=document.createElement('div');lock.className='czCard lock';
 lock.innerHTML='<div class="cIco">🔒</div><div class="cSoon">More<br>soon</div>';mc.appendChild(lock);

 const sw=$('czSwatch');sw.innerHTML='';
 CONFIG.playerModel.swatches.forEach(hex=>{
  const c=document.createElement('div');c.className='czChip';c.style.background=hex;c.dataset.hex=hex.toLowerCase();
  c.onclick=()=>czSetCol(hex);sw.appendChild(c);
 });

 const fc=$('czFinish');fc.innerHTML='';
 Object.keys(CONFIG.playerModel.finishes).forEach(k=>{
  const b=document.createElement('button');b.className='miniBtn';b.dataset.fin=k;b.textContent=k;
  b.onclick=()=>czPickFinish(k);fc.appendChild(b);
 });

 // menu kit columns: figurine opens the studio for that team; palette recolours it.
 [0,1].forEach(team=>{
  $('kitFig'+team).onclick=()=>openCustomize(team);
  const pal=$('kitPal'+team);pal.innerHTML='';
  CONFIG.playerModel.swatches.forEach(hex=>{
   const c=document.createElement('div');c.className='czChip';c.style.background=hex;c.dataset.hex=hex.toLowerCase();
   c.onclick=()=>setKitColor(team,hex);pal.appendChild(c);
  });
 });

 $('czDoneBtn').onclick=closeCustomize;
 $('czResetBtn').onclick=czResetAll;
 $('czTeamR').onclick=()=>czSetTeam(0);
 $('czTeamB').onclick=()=>czSetTeam(1);
 $('czSpin').onclick=()=>{PV.spin=!PV.spin;$('czSpin').classList.toggle('on',PV.spin);};
 $('czView').onclick=()=>{PV.yaw=.5;PV.pitch=0;PV.dist=8;};
 $('czSnap').onclick=pvSnapshot;
 $('czColor').oninput=e=>czSetCol(e.target.value);
 $('czRand').onclick=()=>czSetCol('#'+('00000'+Math.floor(Math.random()*0xffffff).toString(16)).slice(-6));
 $('czMetal').oninput=e=>{cfg.metalness=+e.target.value;czAfterFinish();};
 $('czRough').oninput=e=>{cfg.roughness=+e.target.value;czAfterFinish();};
 $('czGlow').oninput =e=>{cfg.glow=+e.target.value;czAfterFinish();};
 $('czScale').oninput=e=>{cfg.modelScale=+e.target.value;czAfterFinish();};
 $('czYaw').oninput=e=>{const key=PV.team===0?'redYaw':'blueYaw';cfg[key]=+e.target.value;PV.yaw=cfg[key];
  PV.spin=false;$('czSpin').classList.remove('on');saveCfg();czSyncYaw();};
 addEventListener('resize',()=>{if(PV.on)pvResize();});
 $('czSpin').classList.add('on');
}

/* ---- open / close ---- */
function openCustomize(team){
 if(team===0||team===1){PV.team=team;PV.yaw=team===0?cfg.redYaw:cfg.blueYaw;}
 try{Au.ui();}catch(e){}
 $('menu').classList.add('hidden');$('customize').classList.remove('hidden');
 czSyncUI();
 requestAnimationFrame(()=>{pvInit();pvLoadModel();pvResize();PV.on=true;pvTick();});
}
function closeCustomize(){
 PV.on=false;refreshKitUI();
 $('customize').classList.add('hidden');$('menu').classList.remove('hidden');
}

/* Live kit summary in the menu's two-column Teams & Kits panel: figurine
   thumbnails, model caption, palette selection + team-tinted accents. */
function refreshKitUI(){
 [0,1].forEach(team=>{
  const col=(team===0?cfg.redColor:cfg.blueColor).toLowerCase();
  const cap=$('kitCap'+team);if(cap)cap.textContent=activeModel(team).name;
  const fig=$('kitFig'+team);if(fig)fig.style.setProperty('--tc',col);
  const nameEl=$(team===0?'nameRed':'nameBlue');if(nameEl)nameEl.style.setProperty('--tc',col);
  const pal=$('kitPal'+team);
  if(pal)pal.querySelectorAll('.czChip').forEach(c=>c.classList.toggle('on',c.dataset.hex===col));
 });
 const needReload=!THB.model[0]||THB.loadedId[0]!==activeModel(0).id||!THB.model[1]||THB.loadedId[1]!==activeModel(1).id;
 if(needReload)thumbLoad(applyKitThumbs);
 else applyKitThumbs();
}
function applyKitThumbs(){
 [0,1].forEach(team=>{
  const url=thumbRender(team),fig=$('kitFig'+team);
  if(url&&fig)fig.style.backgroundImage='url('+url+')';
 });
}

/* ---- control handlers ---- */
// Single source of truth for a team's colour — used by the menu palette AND the
// studio picker, so the two stay perfectly in sync.
function setKitColor(team,hex){
 hex=hex.toLowerCase();
 if(team===0)cfg.redColor=hex;else cfg.blueColor=hex;
 applyColors();saveCfg();
 if(PV.on){pvApply();czSyncColor();}
 refreshKitUI();
}
function czSetCol(hex){setKitColor(PV.team,hex);}
function czSetTeam(t){PV.team=t;pvApply();czSyncColor();}
function czPickModel(id){
 const key=PV.team===0?'modelRed':'modelBlue';
 if(id===cfg[key])return;
 cfg[key]=id;saveCfg();
 pvLoadModel();
 if(typeof reloadPlayerModel==='function')reloadPlayerModel();
 czSyncModels();refreshKitUI();
}
function czPickFinish(k){
 const f=CONFIG.playerModel.finishes[k];if(!f)return;
 cfg.metalness=f.metalness;cfg.roughness=f.roughness;cfg.glow=f.glow;
 czAfterFinish();
}
function czAfterFinish(){applyFinish();pvApply();saveCfg();czSyncFinish();refreshKitUI();}
function czResetAll(){
 cfg.modelRed=CONFIG.playerModel.default;
 cfg.modelBlue=CONFIG.playerModel.default;
 cfg.redColor='#ff4d5a';cfg.blueColor='#3d8bff';
 cfg.redYaw=-0.55;cfg.blueYaw=0.55;
 cfg.metalness=.15;cfg.roughness=.45;cfg.glow=0;cfg.modelScale=1;
 PV.yaw=PV.team===0?-0.55:0.55;
 saveCfg();
 pvLoadModel();if(typeof reloadPlayerModel==='function')reloadPlayerModel();
 applyColors();pvApply();czSyncUI();refreshKitUI();
}

/* ---- control <-> cfg sync ---- */
function czSyncModels(){
 const cur=cfg[PV.team===0?'modelRed':'modelBlue'];
 document.querySelectorAll('#czModels .czCard').forEach(c=>{if(c.dataset.id)c.classList.toggle('on',c.dataset.id===cur);});
}
function czSyncTeam(){
 const col=PV.team===0?cfg.redColor:cfg.blueColor;
 $('czTeamR').classList.toggle('on',PV.team===0);
 $('czTeamB').classList.toggle('on',PV.team===1);
 $('czTeamR').style.setProperty('--tc',cfg.redColor);
 $('czTeamB').style.setProperty('--tc',cfg.blueColor);
 document.querySelectorAll('#czModels .czCard').forEach(c=>{if(!c.classList.contains('lock'))c.style.setProperty('--tc',col);});
 czSyncYaw();
}
function czSyncColor(){
 const col=(PV.team===0?cfg.redColor:cfg.blueColor).toLowerCase();
 $('czColor').value=col;$('czHex').textContent=col;
 document.querySelectorAll('#czSwatch .czChip').forEach(c=>c.classList.toggle('on',c.dataset.hex===col));
 czSyncTeam();
}
function czSyncFinish(){
 $('czMetal').value=cfg.metalness;$('czRough').value=cfg.roughness;$('czGlow').value=cfg.glow;$('czScale').value=cfg.modelScale;
 $('czMetalV').textContent=Math.round(cfg.metalness*100)+'%';
 $('czRoughV').textContent=Math.round(cfg.roughness*100)+'%';
 $('czGlowV').textContent=(+cfg.glow).toFixed(2);
 $('czScaleV').textContent=Math.round(cfg.modelScale*100)+'%';
 const fins=CONFIG.playerModel.finishes;
 document.querySelectorAll('#czFinish .miniBtn').forEach(b=>{
  const f=fins[b.dataset.fin];
  b.classList.toggle('on',!!f&&Math.abs(f.metalness-cfg.metalness)<.001&&Math.abs(f.roughness-cfg.roughness)<.001&&Math.abs(f.glow-cfg.glow)<.001);
 });
}
function czSyncYaw(){
 const yaw=PV.team===0?cfg.redYaw:cfg.blueYaw;
 $('czYaw').value=yaw;$('czYawV').textContent=Math.round(yaw*180/Math.PI)+'°';
}
function czSyncUI(){czSyncModels();czSyncColor();czSyncFinish();czSyncYaw();}

/* ================= three.js turntable studio ================= */
function pvInit(){
 if(PV.ready)return;
 const cv=$('pvCanvas');
 // No preserveDrawingBuffer: pvTick renders every frame (display stays painted) and pvSnapshot
 // renders synchronously right before toDataURL — so the drawing buffer needn't be retained.
 PV.renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
 PV.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 PV.renderer.outputEncoding=THREE.sRGBEncoding;
 PV.scene=new THREE.Scene();
 PV.camera=new THREE.PerspectiveCamera(42,1,.1,200);
 PV.scene.add(new THREE.HemisphereLight(0xcdd9ff,0x141018,.9));
 const key=new THREE.DirectionalLight(0xffffff,1.15);key.position.set(6,12,8);PV.scene.add(key);
 const fill=new THREE.DirectionalLight(0x88a0ff,.4);fill.position.set(-8,4,4);PV.scene.add(fill);
 PV.rim=new THREE.PointLight(0xffffff,1.4,60);PV.rim.position.set(-5,5,-6);PV.scene.add(PV.rim);
 const plat=new THREE.Mesh(new THREE.CylinderGeometry(3.1,3.4,.35,48),
  new THREE.MeshStandardMaterial({color:0x0c1020,emissive:0x1a2540,emissiveIntensity:.5,roughness:.35,metalness:.7}));
 plat.position.y=-.18;PV.scene.add(plat);PV.platform=plat;
 const ring=new THREE.Mesh(new THREE.RingGeometry(3.15,3.55,64),
  new THREE.MeshBasicMaterial({color:0x5a8cff,transparent:true,opacity:.55,side:THREE.DoubleSide}));
 ring.rotation.x=-Math.PI/2;ring.position.y=.03;PV.scene.add(ring);PV.ringMesh=ring;
 PV.root=new THREE.Group();PV.scene.add(PV.root);
 cv.addEventListener('pointerdown',e=>{PV.dragging=true;PV.px=e.clientX;PV.py=e.clientY;try{cv.setPointerCapture(e.pointerId);}catch(x){}});
 cv.addEventListener('pointermove',e=>{if(!PV.dragging)return;
  PV.yaw+=(e.clientX-PV.px)*.01;PV.pitch=clamp(PV.pitch+(e.clientY-PV.py)*.008,-.6,.7);
  PV.px=e.clientX;PV.py=e.clientY;});
 cv.addEventListener('pointerup',()=>{PV.dragging=false;});
 cv.addEventListener('pointercancel',()=>{PV.dragging=false;});
 cv.addEventListener('wheel',e=>{e.preventDefault();PV.dist=clamp(PV.dist*(e.deltaY>0?1.09:.91),4.5,18);},{passive:false});
 PV.ready=true;
}

function pvFallback(){
 const g=new THREE.Group();
 const mk=(geo,y)=>{const me=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({name:'body',color:0xffffff,roughness:.5,metalness:.15}));me.position.y=y;g.add(me);};
 mk(new THREE.SphereGeometry(.55,16,14),3.35);
 mk(new THREE.BoxGeometry(1.4,2.4,1.0),1.85);
 mk(new THREE.BoxGeometry(.8,1.6,.7),.35);
 return g;
}

function pvLoadModel(){
 if(!PV.ready)return;
 const am=activeModel(PV.team);
 if(PV.loadedId===am.id&&PV.model)return;
 const show=src=>{
  if(PV.model){PV.root.remove(PV.model);PV.model=null;PV.mats=[];}
  const g=src.clone(true);
  let box=new THREE.Box3().setFromObject(g),size=new THREE.Vector3();box.getSize(size);
  PV.baseScale=3.4/(size.y||1);
  g.scale.setScalar(PV.baseScale*(cfg.modelScale||1));
  box=new THREE.Box3().setFromObject(g);
  const ctr=new THREE.Vector3();box.getCenter(ctr);
  g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
  const teamParts=new Set(am.teamParts.map(s=>s.toLowerCase()));
  g.traverse(ch=>{if(!ch.isMesh)return;const nm=ch.material.name.toLowerCase();
   const cm=ch.material.clone();ch.material=cm;if(teamParts.has(nm))PV.mats.push(cm);});
  PV.model=g;PV.loadedId=am.id;PV.root.add(g);pvApply();
 };
 if(PV.cache[am.id]){touchModelCache(PV.cacheOrder,am.id);show(PV.cache[am.id]);return;}
 new THREE.GLTFLoader().load(am.src,
  gltf=>{pvCachePut(am.id,gltf.scene);show(gltf.scene);},
  undefined,
  ()=>{console.warn('preview model load failed, using primitive');pvCachePut(am.id,pvFallback());show(PV.cache[am.id]);});
}

function pvApply(){
 if(!PV.ready)return;
 const col=new THREE.Color(PV.team===0?cfg.redColor:cfg.blueColor);
 const mv=clamp(cfg.metalness,0,1),rv=clamp(cfg.roughness,0,1),gv=Math.max(0,cfg.glow);
 PV.mats.forEach(m=>{m.color.copy(col);m.metalness=mv;m.roughness=rv;
  if(m.emissive){m.emissive.copy(col);m.emissiveIntensity=gv;}m.needsUpdate=true;});
 if(PV.rim)PV.rim.color.copy(col);
 if(PV.ringMesh)PV.ringMesh.material.color.copy(col);
 if(PV.platform)PV.platform.material.emissive.copy(col).multiplyScalar(.28);
 if(PV.model)PV.model.scale.setScalar(PV.baseScale*(cfg.modelScale||1));
}

function pvResize(){
 if(!PV.ready)return;
 const cv=$('pvCanvas'),w=cv.clientWidth||cv.parentElement.clientWidth,h=cv.clientHeight||cv.parentElement.clientHeight;
 if(!w||!h)return;
 PV.renderer.setSize(w,h,false);PV.camera.aspect=w/h;PV.camera.updateProjectionMatrix();
}

function pvTick(){
 if(!PV.on)return;
 requestAnimationFrame(pvTick);
 if(PV.spin&&!PV.dragging)PV.yaw+=.012;
 PV.root.rotation.y=PV.yaw;PV.root.rotation.x=PV.pitch;
 const d=PV.dist;
 PV.camera.position.set(0,1.55+d*.13,d);PV.camera.lookAt(0,1.5,0);
 PV.renderer.render(PV.scene,PV.camera);
}

function pvSnapshot(){
 if(!PV.ready)return;
 PV.renderer.render(PV.scene,PV.camera);
 const a=document.createElement('a');
 a.download='fuzeball_'+cfg[PV.team===0?'modelRed':'modelBlue']+'_'+(PV.team===0?'red':'blue')+'.png';
 a.href=PV.renderer.domElement.toDataURL('image/png');a.click();
 $('czSnap').classList.add('on');setTimeout(()=>$('czSnap').classList.remove('on'),350);
}

/* ================= menu figurine thumbnails =================
   A tiny offscreen renderer that stamps a posed, team-coloured figurine into
   each menu column on demand (never per-frame). Shares PV.cache so the .glb
   isn't fetched twice. */
const THB={ready:false,r:null,scene:null,cam:null,root:null,rim:null,
 model:[null,null],mats:[[],[]],loadedId:[null,null],baseScale:[1,1]};
function thumbInit(){
 if(THB.ready)return;
 // No preserveDrawingBuffer: thumbRender reads toDataURL synchronously right after render (same
 // tick, before the browser composites/clears), and the canvas itself is offscreen (never shown).
 THB.r=new THREE.WebGLRenderer({antialias:true,alpha:true});
 THB.r.setPixelRatio(2);THB.r.setSize(240,320,false);THB.r.outputEncoding=THREE.sRGBEncoding;
 THB.scene=new THREE.Scene();
 THB.cam=new THREE.PerspectiveCamera(36,240/320,.1,200);
 THB.scene.add(new THREE.HemisphereLight(0xcdd9ff,0x141018,.95));
 const k=new THREE.DirectionalLight(0xffffff,1.2);k.position.set(5,11,7);THB.scene.add(k);
 THB.rim=new THREE.PointLight(0xffffff,1.3,50);THB.rim.position.set(-4,4,-5);THB.scene.add(THB.rim);
 THB.root=new THREE.Group();THB.scene.add(THB.root);
 THB.ready=true;
}
function thumbLoad(cb){
 thumbInit();
 let remaining=2;
 const done=()=>{if(--remaining===0&&cb)cb();};
 [0,1].forEach(team=>{
  const am=activeModel(team);
  const place=src=>{
   const g=src.clone(true);
   let box=new THREE.Box3().setFromObject(g),size=new THREE.Vector3();box.getSize(size);
   THB.baseScale[team]=3.4/(size.y||1);g.scale.setScalar(THB.baseScale[team]*(cfg.modelScale||1));
   box=new THREE.Box3().setFromObject(g);const ctr=new THREE.Vector3();box.getCenter(ctr);
   g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
   const tp=new Set(am.teamParts.map(s=>s.toLowerCase()));
   const mats=[];
   g.traverse(ch=>{if(!ch.isMesh)return;const cm=ch.material.clone();ch.material=cm;if(tp.has(cm.name.toLowerCase()))mats.push(cm);});
   THB.model[team]=g;THB.mats[team]=mats;THB.loadedId[team]=am.id;
   done();
  };
  if(PV.cache[am.id]){touchModelCache(PV.cacheOrder,am.id);place(PV.cache[am.id]);return;}
  new THREE.GLTFLoader().load(am.src,
   gltf=>{pvCachePut(am.id,gltf.scene);place(gltf.scene);},
   undefined,
   ()=>{pvCachePut(am.id,pvFallback());place(PV.cache[am.id]);});
 });
}
function thumbRender(team){
 if(!THB.ready||!THB.model[team])return null;
 while(THB.root.children.length)THB.root.remove(THB.root.children[0]);
 THB.root.add(THB.model[team]);
 const col=new THREE.Color(team===0?cfg.redColor:cfg.blueColor);
 const mv=clamp(cfg.metalness,0,1),rv=clamp(cfg.roughness,0,1),gv=Math.max(0,cfg.glow);
 THB.mats[team].forEach(m=>{m.color.copy(col);m.metalness=mv;m.roughness=rv;
  if(m.emissive){m.emissive.copy(col);m.emissiveIntensity=gv;}m.needsUpdate=true;});
 THB.rim.color.copy(col);
 THB.model[team].scale.setScalar(THB.baseScale[team]*(cfg.modelScale||1));
 THB.root.rotation.y=team===0?cfg.redYaw:cfg.blueYaw;   // per-team configurable pose
 THB.cam.position.set(0,2.0,7.6);THB.cam.lookAt(0,1.65,0);
 THB.r.render(THB.scene,THB.cam);
 return THB.r.domElement.toDataURL('image/png');
}
