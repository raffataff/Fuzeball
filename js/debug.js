'use strict';
/* ================= collision & AI debug overlay (press C) =================
   IMPORTANT: the game's collisions are ANALYTIC — hard-coded in physics.js —
   NOT the meshes. The visual models are pure decoration; nothing about them is
   read by the sim. This overlay draws translucent proxies at the EXACT collision
   geometry (walls, goal mouth, per-man capsules, ball spheres) so you can spot
   where a Blender model drifts from what the game actually collides against.
   Toggle with C. Colours: red = solid wall, green = open goal mouth,
   yellow = player capsule, cyan = ball, blue = floor.

   AI visuals (toggled in the debug panel) show the zones and thresholds that
   drive AI decisions: keeper clamp (gkPad), raise-behind threshold, over-foot
   reach, in-front swing range, low-height kick limit, and man hysteresis. */
let dbgGroup=null,dbgOn=false,dbgCaps=[],dbgBalls=[],dbgFootS=[];
let dbgArenaWalls=null,dbgContourRings=[];

/* ===== memory / GPU footprint dump ======================================
   Boot logs (see main.js) fire this at boot and again once assets have
   uploaded, so you can see what the menu-idle scene actually costs. Call
   memLog('label') from the console any time for a fresh snapshot. GPU counts
   come from renderer.info (geometries/textures/shader programs), JS heap from
   performance.memory (Chrome only). scene-node count is a rough object tally. */
function memFmt(b){return (b||b===0)?(b/1048576).toFixed(1)+'MB':'n/a';}
function memLog(tag){
 tag=tag||'?';
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 const pm=(typeof performance!=='undefined')&&performance.memory;
 const geos=ri?ri.memory.geometries:'?',texs=ri?ri.memory.textures:'?';
 const progs=(ri&&ri.programs)?ri.programs.length:'?';
 let nodes=0;if(typeof scene!=='undefined'&&scene)scene.traverse(()=>nodes++);
 const mc=(typeof modelCache!=='undefined'&&modelCache)?Object.keys(modelCache).length:'?';
 // Resident TABLE assets, by name — the whole point of the lazy loader (CONFIG.tableAssets), so
 // list them rather than count them: a regression here reads as extra keys, not a bigger number.
 const sk=(typeof skinOrder!=='undefined'&&skinOrder)?(skinOrder.join(',')||'none'):'?';
 const rm=(typeof roomOrder!=='undefined'&&roomOrder)?(roomOrder.join(',')||'none'):'?';
 // The main canvas isn't the only GL context: the studio, the menu thumbnails and the league setup
 // preview all draw through ONE shared offscreen renderer (PRV, world.js), which holds its own
 // upload of whatever figurines they've shown. Reported separately because main-renderer counts
 // alone look innocent while the second context grows. It only exists once something used it.
 const sub=[];
 if(typeof PRV!=='undefined'&&PRV&&PRV.r&&PRV.r.info)
  sub.push('preview '+PRV.r.info.memory.geometries+'g/'+PRV.r.info.memory.textures+'t @'+PRV.w+'x'+PRV.h);
 console.log('%c[MEM '+tag+']','color:#2af5ff;font-weight:bold',
  'JS heap '+memFmt(pm&&pm.usedJSHeapSize)+' / limit '+memFmt(pm&&pm.jsHeapSizeLimit)
  +' | GPU '+geos+' geoms, '+texs+' textures, '+progs+' shaders'
  +' | scene '+nodes+' nodes | modelCache '+mc+' templates'
  +' | skins ['+sk+'] rooms ['+rm+']'
  +' | tex '+memFmt(memTexBytes())
  +(sub.length?' | extra contexts: '+sub.join(', '):''));
}

/* ===== texture footprint audit =========================================
   renderer.info counts textures but says nothing about their SIZE, and size is what actually
   costs: ONE 4096² RGBA texture is 64MB uploaded (86MB with mipmaps) and roughly that again for
   the decoded CPU-side image the loader keeps alive. Eighteen of those is 1.5GB from a scene that
   reads as trivially small in every other metric. memTex() lists the worst offenders so an
   oversized bake is obvious; memTexBytes() is the one-line total memLog prints.

   Walks the live scene AND the off-scene template caches (figurines, explosions, evicted-but-
   referenced skins, the ball/pitch GLBs), de-duped by texture uuid, so a texture shared between
   ten meshes is counted once. Estimate, not truth: it assumes 8-bit RGBA and mipmaps, which is
   what an uncompressed glTF PNG/JPG becomes once uploaded. */
function texSize(t){
 const im=t&&t.image;if(!im)return{w:0,h:0,b:0};
 const w=im.width||im.naturalWidth||im.videoWidth||0,h=im.height||im.naturalHeight||im.videoHeight||0;
 return{w,h,b:w*h*4*(t.generateMipmaps===false?1:4/3)};
}
function memTexCollect(){
 const seen=new Map(),roots=[];
 const push=o=>{if(o&&o.traverse)roots.push(o);};
 if(typeof scene!=='undefined')push(scene);
 if(typeof modelCache!=='undefined')for(const k in modelCache)push(modelCache[k]);
 if(typeof PV!=='undefined'&&PV&&PV.cache)for(const k in PV.cache)push(PV.cache[k]);
 if(typeof explosionTemplates!=='undefined')for(const k in explosionTemplates)push(explosionTemplates[k].scene);
 if(typeof ballExplosionTemplate!=='undefined'&&ballExplosionTemplate)push(ballExplosionTemplate.scene);
 if(typeof respawnSwirlTemplate!=='undefined'&&respawnSwirlTemplate)push(respawnSwirlTemplate.scene);
 if(typeof ballModel!=='undefined')push(ballModel);
 if(typeof pitchModel!=='undefined')push(pitchModel);
 if(typeof roomGroups!=='undefined')for(const k in roomGroups)push(roomGroups[k]);
 const KEYS=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap','displacementMap','lightMap','envMap'];
 for(const r of roots)r.traverse(c=>{
  if(!c.material)return;
  for(const m of (Array.isArray(c.material)?c.material:[c.material])){
   if(!m)continue;
   for(const k of KEYS){const t=m[k];if(!t||!t.uuid||seen.has(t.uuid))continue;
    const s=texSize(t);if(s.b)seen.set(t.uuid,{name:(t.name||m.name||c.name||'?')+' ['+k+']',w:s.w,h:s.h,b:s.b});}
  }
 });
 return [...seen.values()].sort((a,b)=>b.b-a.b);
}
function memTexBytes(){let n=0;for(const t of memTexCollect())n+=t.b;return n;}
/* Console helper: memTex() → the 15 fattest textures resident, biggest first. Anything at
   2048² or above on a prop the player never sees up close is a candidate for a downsize. */
function memTex(n){
 const list=memTexCollect();let tot=0;for(const t of list)tot+=t.b;
 console.log('%c[TEX] '+list.length+' unique, '+memFmt(tot)+' est. (uncompressed RGBA + mipmaps)','color:#ffcf4d;font-weight:bold');
 console.table(list.slice(0,n||15).map(t=>({texture:t.name,px:t.w+'×'+t.h,MB:+(t.b/1048576).toFixed(1)})));
 return tot;
}

// AI debug state
let dbgAIGroup=null,dbgAIPanel=null;
let dbgAIOpts={gkPad:false,raiseBehind:false,overFoot:false,underFoot:false,inFront:false,lowY:false,manHyst:false,footReach:false,aligned:false,serveZone:false,redropZones:false,dropSweep:false,footRange:false,trapZone:false,safeRaise:false,evade:false,shotLanes:false,sweetSpot:false,deadzones:false};
let dbgAIGKPad=[],dbgAIRaise=[],dbgAIOverFoot=[],dbgAIUnderFoot=[],dbgAIInFront=[],dbgDropSweep=[],dbgFootRange=[],dbgTrapZone=[],dbgSafeRaise=[],dbgEvade=[],dbgEvadeDead=[],dbgDeadzones=[];
let dbgShotLanes=[],dbgShotOpen=null,dbgShotBlock=null,dbgMarkOpen=null,dbgMarkBlock=null;
let dbgAILowY=null,dbgAIManRings=[],dbgAITargetDots=[],dbgFootReach=[],dbgAlignRings=[],dbgAIServe=[],dbgAIRedrop=[];
let dbgSweet=[],dbgSweetFlash=[],dbgSweetFlashMat=null,szCxOff=0,szW=0,szZ=0;

/* ===== per-rod kick decision tracer ======================================
   Press L (while debug is on) to cycle which rod is traced (RED/BLU · role · x).
   The tracer emits a compact line ONLY on a state change or an actual kick —
   NOT every frame — so it can run live without flooding the console or tanking
   perf. Each ★KICK line carries gap= (seconds since THIS rod's previous kick):
   a shrinking gap is the "vibrating re-kick" made visible. Blocked frames log
   the FIRST failing gate (deduped, so a steady block prints once). Zero cost
   when off: every call site in ai.js is guarded by `dbgLogRod===r`, and
   dbgLogRod stays null until you press L. Toggle the console mirror with the
   'Kick→Console' checkbox in the AI panel. */
let dbgLogRod=null,dbgLogLines=[],dbgLogPanel=null,dbgLogBody=null,dbgLogHdr=null;
let dbgLogPrevKick=-1,dbgLogLastKind='',dbgLogConsole=false;
function dbgRodName(r){return (r.team===0?'RED':'BLU')+' '+r.role+' x'+r.x;}
function dbgFmtT(t){return 't'+t.toFixed(2);}
function buildKickLogPanel(){
 if(dbgLogPanel)return;
 const p=document.createElement('div');p.id='dbgKickLog';
 p.style.cssText='position:fixed;left:10px;bottom:10px;z-index:60;width:440px;max-height:46vh;overflow:hidden;'
  +'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#ffe6a3;background:rgba(8,10,16,.82);'
  +'border:1px solid #ffcf4d;border-radius:8px;padding:8px 10px;pointer-events:none;white-space:pre;';
 const h=document.createElement('div');h.id='dbgKickLogHdr';
 h.style.cssText='color:#ffcf4d;font-weight:700;margin-bottom:4px;letter-spacing:.5px;';
 h.textContent='KICK LOG · off  (press L to pick a rod)';
 const b=document.createElement('div');b.id='dbgKickLogBody';
 p.appendChild(h);p.appendChild(b);document.body.appendChild(p);
 dbgLogPanel=p;dbgLogHdr=h;dbgLogBody=b;
}
function renderKickLog(){if(dbgLogBody)dbgLogBody.innerHTML=dbgLogLines.join('<br>');}
function dbgLogPush(s){
 dbgLogLines.push(s);
 if(dbgLogLines.length>28)dbgLogLines.shift();
 if(dbgLogConsole)console.log('[kick] '+s);
 renderKickLog();
}
// L cycles: null → rod0 → … → rodN → null. Resets the trace state each time.
function cycleKickLog(){
 buildKickLogPanel();
 const i=dbgLogRod?rods.indexOf(dbgLogRod):-1,ni=i+1;
 dbgLogRod=ni>=rods.length?null:rods[ni];
 dbgLogLines.length=0;dbgLogPrevKick=-1;dbgLogLastKind='';
 dbgLogHdr.textContent=dbgLogRod?('KICK LOG · '+dbgRodName(dbgLogRod)+'   (L = next rod)'):'KICK LOG · off  (press L to pick a rod)';
 renderKickLog();
 dbgLogPanel.style.display=(dbgOn&&dbgLogRod)?'block':'none';
 banner('KICK LOG',dbgLogRod?dbgRodName(dbgLogRod):'OFF',1.0);Au.ui();
}
// state-change / action trace (benched, held-forward escape, trap-shot). Deduped
// on `kind` so a steady state prints once; alternating states each print with a
// timestamp — which is exactly what exposes an oscillation.
function dbgRod(r,kind,detail){
 if(r!==dbgLogRod)return;
 if(kind===dbgLogLastKind)return;
 dbgLogLastKind=kind;
 dbgLogPush(dbgFmtT(S.time)+'  '+kind+(detail?('  '+detail):''));
}
// real contact: collideRod calls this the first time a foot box (or capsule graze) actually
// resolves against the ball during a swing — so a ★KICK followed by ✓CONTACT connected, and a
// ★KICK that ends in a ✗WHIFF (logged by updateRods when the swing completes untouched) missed.
function dbgHit(r,man,foot,pow,sweet,vn,b){
 if(r!==dbgLogRod)return;
 dbgLogLastKind='HIT';
 dbgLogPush(dbgFmtT(S.time)+'  ✓CONTACT '+(foot?'foot':'leg ')+' man='+man+(pow?' [POWER]':'')+(sweet?' [SWEET]':'')
  +'  vn='+vn.toFixed(0)+'  ball→'+b.v.length().toFixed(0)+'u/s');
}
// the kick GATE: logs every fire (with gap since the last), and the first failing
// condition when blocked (deduped). g = the gate's raw booleans/values from ai.js.
function dbgKickGate(r,g){
 if(r!==dbgLogRod)return;
 const now=S.time;
 if(g.fired){
  const gap=dbgLogPrevKick>=0?(now-dbgLogPrevKick):-1;dbgLogPrevKick=now;dbgLogLastKind='KICK';
  dbgLogPush(dbgFmtT(now)+'  ★KICK  gap='+(gap>=0?gap.toFixed(2)+'s':'--')
   +'  rel='+g.rel.toFixed(1)+' dz='+g.dz.toFixed(2)+' spd='+g.speed.toFixed(0)
   +(g.overFoot?' [over]':' [inFront]')+(g.act?(' act='+g.act):''));
  return;
 }
 let why;
 if(r.kickT>=0)why='swinging kickT='+r.kickT.toFixed(2);
 else if(r.cd>0)why='cooldown '+r.cd.toFixed(2)+'s';
 else if(!(g.overFoot||g.inFront))why='out-of-reach rel='+g.rel.toFixed(1);
 else if(!g.aligned)why='not-aligned dz='+g.dz.toFixed(2);
 else if(!g.low)why='ball-high';
 else if(g.wait)why='wait-sweetspot';
 else if(g.holdShot)why='hold-for-lane';
 else why='?';
 const kind='BLK:'+why.split(' ')[0];
 if(kind!==dbgLogLastKind){dbgLogLastKind=kind;dbgLogPush(dbgFmtT(now)+'  ·blocked  '+why+(g.act?('  act='+g.act):''));}
}

function dbgMat(col,op){return new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op,side:THREE.DoubleSide,depthWrite:false});}

function buildAIPanel(){
 if(dbgAIPanel)return;
 dbgAIPanel=document.createElement('div');
 dbgAIPanel.id='dbgPanel';
 dbgAIPanel.innerHTML='<h4>AI DEBUG</h4>';
 const items=[
  {key:'gkPad',label:'GK Pad',col:'#ff8c3a'},
  {key:'raiseBehind',label:'Raise Behind',col:'#ff2bd6'},
   {key:'overFoot',label:'Over Foot',col:'#7dff8a'},
   {key:'underFoot',label:'Under Foot',col:'#ff8c3a'},
   {key:'inFront',label:'In Front',col:'#3d8bff'},
   {key:'lowY',label:'Low Y',col:'#2af5ff'},
   {key:'manHyst',label:'Man Hyst',col:'#ffcf4d'},
   {key:'footReach',label:'Foot Reach',col:'#ff8c3a'},
   {key:'aligned',label:'Aligned',col:'#7dff8a'},
   {key:'serveZone',label:'Serve Zone',col:'#c299ff'},
   {key:'redropZones',label:'Redrop Zones',col:'#ff5c5c'},
   {key:'dropSweep',label:'Drop Sweep',col:'#ff5c8a'},
   {key:'footRange',label:'Foot Range',col:'#eaeaea'},
   {key:'trapZone',label:'Trap Zone',col:'#c77dff'},
   {key:'safeRaise',label:'Safe Raise',col:'#c2ff4d'},
   {key:'evade',label:'Evade',col:'#00d9a3'},
    {key:'shotLanes',label:'Shot Lanes',col:'#2bff88'},
    {key:'sweetSpot',label:'Sweet Spot',col:'#ffe14d'},
    {key:'deadzones',label:'Dead Zones',col:'#ff4d4d'}
  ];
 for(const it of items){
  const lbl=document.createElement('label');
  const cb=document.createElement('input');
  cb.type='checkbox';cb.checked=dbgAIOpts[it.key];
  cb.addEventListener('change',()=>{dbgAIOpts[it.key]=cb.checked;updateAIVis();});
  lbl.appendChild(cb);
  const dot=document.createElement('span');dot.className='dot';
  dot.style.backgroundColor=it.col;lbl.appendChild(dot);
  lbl.appendChild(document.createTextNode(it.label));
  dbgAIPanel.appendChild(lbl);
 }
 // kick-log console mirror: echo the traced rod's lines to devtools too (off by default)
 {const lbl=document.createElement('label');
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=dbgLogConsole;
  cb.addEventListener('change',()=>{dbgLogConsole=cb.checked;});
  lbl.appendChild(cb);
  const dot=document.createElement('span');dot.className='dot';dot.style.backgroundColor='#ffcf4d';lbl.appendChild(dot);
  lbl.appendChild(document.createTextNode('Kick→Console (L=pick rod)'));
  dbgAIPanel.appendChild(lbl);
 }
 document.body.appendChild(dbgAIPanel);
}

function buildDebug(){
 dbgGroup=new THREE.Group();scene.add(dbgGroup);
 dbgAIGroup=new THREE.Group();scene.add(dbgAIGroup);
 const wallM=dbgMat(0xff3b3b,.30),goalM=dbgMat(0x3bff6a,.22),floorM=dbgMat(0x3b7bff,.12),
       manM=dbgMat(0xffe23b,.38),ballM=new THREE.MeshBasicMaterial({color:0x2af5ff,wireframe:true});
 const box=(w,h,d,x,y,z,m,g)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);b.position.set(x,y,z);(g||dbgGroup).add(b);return b;};
 // floor: ball centre clamps to y=BALL_R, i.e. the collision surface is y=0.
 box(F.L,0.04,F.W,0,0,0,floorM);
 // side walls: bounce face at |z| = W/2, active up to y = wallH.
 [-1,1].forEach(s=>box(F.L,F.wallH,0.08,0,F.wallH/2,s*F.W/2,wallM));
 // end walls: solid either side of the goal mouth, plus the lintel above it.
 const seg=F.W/2-F.goalHalf, cz=F.goalHalf+seg/2;   // solid from goalHalf out to the side wall
 [-1,1].forEach(s=>{
  [-1,1].forEach(sz=>box(0.08,F.wallH,seg,s*F.L/2,F.wallH/2,sz*cz,wallM));      // side solids
  box(0.08,F.wallH-F.goalH,F.goalHalf*2,s*F.L/2,(F.goalH+F.wallH)/2,0,wallM);   // lintel above mouth
  box(0.08,F.goalH,F.goalHalf*2,s*F.L/2,F.goalH/2,0,goalM);                     // open goal mouth
 });
 // player capsules: pivot(y=ROD_H) -> foot(-ARM), radius PRAD. Parented to each
 // pivot so they inherit rotation.z (swing) and position.z (slide) for free —
 // exactly how collideRod builds the segment.
 for(const r of rods)for(const bz of r.baseZ){
  const cap=new THREE.Group();cap.position.set(0,0,bz);
  const cyl=new THREE.Mesh(new THREE.CylinderGeometry(PRAD,PRAD,ARM,10),manM);cyl.position.y=-ARM/2;cap.add(cyl);
  const top=new THREE.Mesh(new THREE.SphereGeometry(PRAD,10,8),manM);cap.add(top);
  const foot=new THREE.Mesh(new THREE.SphereGeometry(PRAD,10,8),manM);foot.position.y=-ARM;cap.add(foot);
  cap.visible=false;r.pivot.add(cap);dbgCaps.push(cap);
   // foot box: collision proxy (oriented box, half-extents from config)
    const fbGeo=new THREE.BoxGeometry(FOOT_BOX.y*2,FOOT_BOX.x*2,FOOT_BOX.z*2);
    const footBM=new THREE.MeshBasicMaterial({color:0xff8c3a,transparent:true,opacity:.45,wireframe:true,depthWrite:false});
    const footBox=new THREE.Mesh(fbGeo,footBM);
    footBox.visible=false;dbgAIGroup.add(footBox);dbgFootS.push({mesh:footBox,rod:r,manIdx:r.baseZ.indexOf(bz)});
     // foot reach: box inflated by ball reach distance in each dimension
     const rch=BALL_R*FOOT_BOX_REACH;
     const rbGeo=new THREE.BoxGeometry((FOOT_BOX.y+rch)*2,(FOOT_BOX.x+rch)*2,(FOOT_BOX.z+rch)*2);
    const reachM=new THREE.MeshBasicMaterial({color:0xff8c3a,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false});
    const reachBox=new THREE.Mesh(rbGeo,reachM);
    reachBox.visible=false;dbgAIGroup.add(reachBox);dbgFootReach.push({mesh:reachBox,rod:r,manIdx:r.baseZ.indexOf(bz)});
 }
  // ball collision spheres (radius BALL_R), positioned each frame.
  for(let i=0;i<KICK.splitMax+2;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,14,12),ballM);s.visible=false;dbgGroup.add(s);dbgBalls.push(s);}
  // arena debug: low-res wireframe of the swept bowl (shown when ARENA_ON instead of flat wall proxies)
  dbgArenaWalls=buildArenaDebugMesh();
  if(dbgArenaWalls){dbgArenaWalls.visible=false;dbgGroup.add(dbgArenaWalls);}
  // per-ball contact contour rings
  for(let i=0;i<KICK.splitMax+2;i++){
   const crGeo=new THREE.BufferGeometry();
   const crPts=[];for(let j=0;j<=48;j++){const a=j/48*Math.PI*2;crPts.push(0,0,0);}
   crGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(crPts),3));
   const cr=new THREE.LineLoop(crGeo,dbgMat(0xff3b3b,.55));
   cr.visible=false;dbgGroup.add(cr);dbgContourRings.push(cr);
  }
 dbgGroup.visible=false;

  // --- AI debug visuals ---
  buildAIPanel();

 // gkPad: keeper clamp zone shown as a thin box on the floor at the GK's x-position
 const gkM=dbgMat(0xff8c3a,.22);
 for(const r of rods){
  if(r.role!=='GK')continue;
  const gkPadZ=F.goalHalf+AIC.gkPad;
  const g=new THREE.Group();
  box(0.08,0.04,gkPadZ*2,r.x,0.02,0,gkM,g);
  g.visible=false;dbgAIGroup.add(g);dbgAIGKPad.push(g);
 }

 // Per-rod x-zones: raiseBehind, overFoot, inFront.
 // These are boxes lying flat on the floor spanning the rod's full slide range in z.
  const raiseM=dbgMat(0xff2bd6,.18),footM=dbgMat(0x7dff8a,.18),ufootM=dbgMat(0xff8c3a,.18),frontM=dbgMat(0x3d8bff,.18);
 const abox=(w,d,x,z,m)=>{const g=new THREE.Group();box(w,0.04,d,x,0.03,z,m,g);dbgAIGroup.add(g);return g;};
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff;
  const zMax=Math.max(...r.baseZ)+r.maxOff;
  const zC=(zMin+zMax)/2,zS=zMax-zMin||0.1;

  // raiseBehind: zone behind the rod where the AI would raise men
  const rbSize=Math.abs(AIC.raiseBehind);
  const rbCx=r.x+AIC.raiseBehind*dir/2;
  const rg=abox(rbSize,zS,rbCx,zC,raiseM);
  rg.visible=false;dbgAIRaise.push(rg);

   // overFoot: forward-offset zone — [overFootOffset-overFoot, overFootOffset+overFoot] dir-relative
   // (shifted forward of the rod so the latch releases when the ball is clearly at the men, not behind)
   const ofCx=r.x+AIC.overFootOffset*dir;
   const og=abox(AIC.overFoot*2,zS,ofCx,zC,footM);
   og.visible=false;dbgAIOverFoot.push(og);

   // underFoot: asymmetric box — more behind than in front of rod
   const ufW=AIC.underFootBack+AIC.underFootFront,ufCx=r.x+(AIC.underFootFront-AIC.underFootBack)/2*dir;
   const ug=abox(ufW,zS,ufCx,zC,ufootM);
   ug.visible=false;dbgAIUnderFoot.push(ug);

  // inFront: ball is ahead of the rod within the forward-swing window
  const ifMin=AIC.inFrontMin,ifMax=AIC.inFrontMax,ifSize=ifMax-ifMin;
  const ifCx=r.x+(ifMin+ifMax)/2*dir;
  const ig=abox(ifSize,zS,ifCx,zC,frontM);
  ig.visible=false;dbgAIInFront.push(ig);
 }

 // dropSweep: per-man danger boxes — a ball inside one gets swiped if the rod lowers
 // from a held-forward angle. x = sweep window (heldFwd.xBack..heldFwd.xFront, dir-
 // relative), z = ±(footBox.z + BALL_R + heldFwd.zMargin) around each foot. Positioned
 // per-frame (follows slide); hot pink while the rod is actually held (r.heldFwd).
 const dsW=AIC.heldFwd.xBack+AIC.heldFwd.xFront;
 const dsZ=(FOOT_BOX.z+BALL_R+AIC.heldFwd.zMargin)*2;
 const dsGeo=new THREE.BoxGeometry(dsW,0.05,dsZ);
 const dsDim=dbgMat(0xff5c8a,.15),dsHot=dbgMat(0xff5c8a,.5);
 for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
  const m=new THREE.Mesh(dsGeo,dsDim);m.visible=false;dbgAIGroup.add(m);
  dbgDropSweep.push({mesh:m,rod:r,manIdx:i,matDim:dsDim,matHot:dsHot});
 }

 // footRange: the inFootRange(r,b) reach rectangle per man — the "would lowering OR raising
 // clip this ball" test that gates safeRaise + evade. x = -footRangeBack..underFootFront
 // (dir-relative, reaches deep behind for a raising swing), z = ±(footBox.z + BALL_R +
 // clearMargin) around each foot. Follows the slide; hot white while any live ball is inside.
 const frW=AIC.footRangeBack+AIC.underFootFront;
 const frZ=(FOOT_BOX.z+BALL_R+AIC.clearMargin)*2;
 const frGeo=new THREE.BoxGeometry(frW,0.05,frZ);
 const frDim=dbgMat(0xeaeaea,.12),frHot=dbgMat(0xeaeaea,.45);
 for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
  const m=new THREE.Mesh(frGeo,frDim);m.visible=false;dbgAIGroup.add(m);
  dbgFootRange.push({mesh:m,rod:r,manIdx:i,matDim:frDim,matHot:frHot});
 }

 // trapZone: per-rod box behind the rod (x = trap.back..trap.front dir-relative, z = full
 // slide range) where a slow-in-x ball can be trapped instead of raised over. Static
 // position; material goes hot purple while that rod's r.act==='trap'.
 const tzDim=dbgMat(0xc77dff,.15),tzHot=dbgMat(0xc77dff,.5);
 const tzW=AIC.trap.front-AIC.trap.back;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=new THREE.Mesh(new THREE.BoxGeometry(tzW,0.05,zMax-zMin||0.1),tzDim);
  m.position.set(r.x+(AIC.trap.back+AIC.trap.front)/2*dir,0.04,(zMin+zMax)/2);
  m.visible=false;dbgAIGroup.add(m);
  dbgTrapZone.push({mesh:m,rod:r,matDim:tzDim,matHot:tzHot});
 }

 // safeRaise: per-rod box behind the rod (x = safeRaise.back..front dir-relative, z = full
 // slide range) where a slow, sideways ball is lifted to SR.angle instead of left on the floor.
 // Static position; material goes hot lime while that rod's r.act==='safeRaise'.
 const srDim=dbgMat(0xc2ff4d,.15),srHot=dbgMat(0xc2ff4d,.5);
 const srW=AIC.safeRaise.front-AIC.safeRaise.back;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=new THREE.Mesh(new THREE.BoxGeometry(srW,0.05,zMax-zMin||0.1),srDim);
  m.position.set(r.x+(AIC.safeRaise.back+AIC.safeRaise.front)/2*dir,0.045,(zMin+zMax)/2);
  m.visible=false;dbgAIGroup.add(m);
  dbgSafeRaise.push({mesh:m,rod:r,matDim:srDim,matHot:srHot});
 }

 // evade: per-rod box directly behind the rod (x = -footRangeBack..0 dir-relative, z = full
 // slide range) — where a slow ball stuck against the men gets side-stepped instead of walled.
 // Static position; material goes hot teal while that rod's r.act==='evade'.
 const evDim=dbgMat(0x00d9a3,.15),evHot=dbgMat(0x00d9a3,.5);
 const evW=AIC.footRangeBack;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=new THREE.Mesh(new THREE.BoxGeometry(evW,0.05,zMax-zMin||0.1),evDim);
  m.position.set(r.x-evW/2*dir,0.05,(zMin+zMax)/2);
  m.visible=false;dbgAIGroup.add(m);
  dbgEvade.push({mesh:m,rod:r,matDim:evDim,matHot:evHot});
 }

 // evadeDead: per-rod box behind the rod (x = -behindDead..0 dir-relative, z = full slide range)
 // — where evade is suppressed because the ball is too close and would get hit backwards.
 // Tied to the evade toggle; drawn in orange to distinguish from the teal evade zone.
 const edDim=dbgMat(0xff6b4a,.18),edHot=dbgMat(0xff6b4a,.55);
 const edW=AIC.evade.behindDead;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=new THREE.Mesh(new THREE.BoxGeometry(edW,0.04,zMax-zMin||0.1),edDim);
  m.position.set(r.x-edW/2*dir,0.04,(zMin+zMax)/2);
  m.visible=false;dbgAIGroup.add(m);
  dbgEvadeDead.push({mesh:m,rod:r,matDim:edDim,matHot:edHot});
 }

 // serveZone: kickoff spawn box — SRV.spread (x) by SRV.zSpread (z), centred at x=0,z=0
 const serveM=dbgMat(0xc299ff,.22);
 const svg=abox(SRV.spread*2,SRV.zSpread*2,0,0,serveM);
 svg.visible=false;dbgAIServe.push(svg);

 // redropZones: dead-ball face-off zones (DEAD.redrop.zones) — each ±spread wide in x,
 // full ±DEAD.redrop.z deep in z (same z range for every zone).
 const redropM=dbgMat(0xff5c5c,.22);
 for(const z of DEAD.redrop.zones){
  const rzg=abox(z.spread*2,DEAD.redrop.z*2,z.x,0,redropM);
  rzg.visible=false;dbgAIRedrop.push(rzg);
 }

 // deadzones: the active table's dead-ball pockets (activeTable.deadzones — corners where a
 // pinned ball can't be reached, so the stuck-timer ticks CONFIG.deadball.zoneMult× faster;
 // see deadzoneMult in powerups.js). Each corner zone {xMin,zMin} → one flat box per corner,
 // spanning xMin..F.L/2 by zMin..F.W/2. Static; goes hot red while a live ball sits inside a
 // pocket. updateAIVis hides boxes whose zone isn't in the CURRENT table (handles table swaps).
 const dzDim=dbgMat(0xff4d4d,.16),dzHot=dbgMat(0xff4d4d,.55);
 const dzList=(activeTable&&activeTable.deadzones)||[];
 for(const z of dzList){
  const w=F.L/2-z.xMin,d=F.W/2-z.zMin;
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const m=new THREE.Mesh(new THREE.BoxGeometry(w,0.05,d),dzDim);
   m.position.set(sx*(z.xMin+F.L/2)/2,0.05,sz*(z.zMin+F.W/2)/2);
   m.visible=false;dbgAIGroup.add(m);
   dbgDeadzones.push({mesh:m,zone:z,sx,sz,matDim:dzDim,matHot:dzHot});
  }
 }

 // lowY: translucent horizontal plane at y = lowY (AI only kicks below this)
 const lowYM=dbgMat(0x2af5ff,.10);
 dbgAILowY=new THREE.Mesh(new THREE.PlaneGeometry(F.L,F.W),lowYM);
 dbgAILowY.rotation.x=-Math.PI/2;dbgAILowY.position.y=AIC.lowY;
 dbgAILowY.visible=false;dbgAIGroup.add(dbgAILowY);

  // manHyst: per-man highlight rings (shown on the selected man) + per-rod target dots
  const ringGeo=new THREE.TorusGeometry(PRAD+0.2,0.1,8,16);
  const ringM=dbgMat(0xffcf4d,.85);
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const ring=new THREE.Mesh(ringGeo,ringM);
    ring.position.set(0,-ARM,r.baseZ[i]);ring.visible=false;
    r.pivot.add(ring);dbgAIManRings.push({ring,rod:r,manIdx:i});
   }
   const dot=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,0.06,12),dbgMat(0xffcf4d,.9));
   dot.visible=false;dbgAIGroup.add(dot);
   dbgAITargetDots.push({dot,rod:r});
  }

  // aligned: per-man floor bars showing ±align zone along z. Green = nearest man is aligned.
  const alGeo=new THREE.BoxGeometry(0.15,0.06,AIC.alignSlow*2);
  const alMatGreen=dbgMat(0x7dff8a,.65);
  const alMatDim=dbgMat(0x7dff8a,.12);
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const bar=new THREE.Mesh(alGeo,alMatDim);
    bar.visible=false;dbgAIGroup.add(bar);
    dbgAlignRings.push({bar,rod:r,manIdx:i,z:r.baseZ[i],matGreen:alMatGreen,matDim:alMatDim});
   }
  }

 // shotLanes: gap-aim visualisation. Per rod, a pool of gapAim.samples floor lines
 // (ball → goal-mouth target) recoloured green(open)/red(blocked) each frame, plus a disc
 // at the chosen target. Only drawn for rods actually gap-aiming this frame (r.aimEv set).
 // Shares the analytic lanes from ai.js shotEval (stashed on r.aimEv) — no recompute here.
 dbgShotOpen=new THREE.LineBasicMaterial({color:0x2bff88,transparent:true,opacity:.9});   // line: open lane
 dbgShotBlock=new THREE.LineBasicMaterial({color:0xff3b3b,transparent:true,opacity:.75});  // line: blocked lane
 dbgMarkOpen=dbgMat(0xffe14d,.95);dbgMarkBlock=dbgMat(0xff3b3b,.9);                         // disc: chosen target good/bad
 for(const r of rods){
  const set={rod:r,lines:[],marker:null};
  for(let s=0;s<AIC.gapAim.samples;s++){
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
   const ln=new THREE.Line(geo,dbgShotBlock);ln.frustumCulled=false;ln.visible=false;dbgAIGroup.add(ln);set.lines.push(ln);
  }
  const mk=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.09,16),dbgMarkOpen);mk.visible=false;dbgAIGroup.add(mk);set.marker=mk;
  dbgShotLanes.push(set);
 }

  dbgAIGroup.visible=false;

  // sweetSpot: per-man area in front of the foot (dir-relative x band off the rod × narrow
  // z-centre of the foot) where a clean strike earns the power/juice bonus. Static floor box
  // matching the analytic test in physics.js collideRod (SW.zFrac, SW.xMin/xMax).
  const sweetM=dbgMat(0xffe14d,.20),sweetHot=dbgMat(0xffe14d,.85);
  const SW=KICK.sweetSpot;
  szW=SW.xMax-SW.xMin; szCxOff=(SW.xMin+SW.xMax)/2; szZ=FOOT_BOX.z*SW.zFrac*2;
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const g=new THREE.Group();
    box(szW,0.04,szZ,0,0.035,0,sweetM,g);   // box at group origin; updateAIVis moves the GROUP to the live foot (no double-offset)
    g.visible=false;dbgAIGroup.add(g);
    dbgSweet.push({group:g,rod:r,manIdx:i,matDim:sweetM,matHot:sweetHot});
   }
  }

  // sweetSpot flash: a rising, fading disc placed at the contact point whenever a sweet kick
  // lands (r.aimSweet set by physics each frame). Pooled, one per foot.
  dbgSweetFlashMat=dbgMat(0xffe14d,.9);
  for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
   const d=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.1,16),dbgSweetFlashMat);
   d.visible=false;dbgAIGroup.add(d);
   dbgSweetFlash.push({mesh:d,rod:r,manIdx:i,t:-1});
  }
}

function updateAIVis(){
  if(!dbgAIGroup)return;
  const on=dbgOn;
  for(const g of dbgAIGKPad)g.visible=on&&dbgAIOpts.gkPad;
  for(const g of dbgAIRaise)g.visible=on&&dbgAIOpts.raiseBehind;
  for(const g of dbgAIOverFoot)g.visible=on&&dbgAIOpts.overFoot;
  for(const g of dbgAIUnderFoot)g.visible=on&&dbgAIOpts.underFoot;
  for(const g of dbgAIInFront)g.visible=on&&dbgAIOpts.inFront;
  if(dbgAILowY)dbgAILowY.visible=on&&dbgAIOpts.lowY;
  for(const s of dbgFootReach)s.mesh.visible=on&&dbgAIOpts.footReach;
   for(const g of dbgAIServe)g.visible=on&&dbgAIOpts.serveZone;
   for(const g of dbgAIRedrop)g.visible=on&&dbgAIOpts.redropZones;

   // deadzones: static corner pockets; only for the active table (hide any built for another
   // table); hot red while a live ball actually sits inside that corner (matches deadzoneMult).
   {const cur=(activeTable&&activeTable.deadzones)||[];
   for(const dz of dbgDeadzones){
    const vis=on&&dbgAIOpts.deadzones&&cur.indexOf(dz.zone)>=0;
    dz.mesh.visible=vis;if(!vis)continue;
    let hot=false;
    for(const b of S.balls){const p=b.m.position;
     if(Math.sign(p.x)===dz.sx&&Math.sign(p.z)===dz.sz&&Math.abs(p.x)>dz.zone.xMin&&Math.abs(p.z)>dz.zone.zMin){hot=true;break;}}
    dz.mesh.material=hot?dz.matHot:dz.matDim;
   }}

   // sweetSpot: per-man area follows the live foot (slide offset + dir); hot yellow while
   // that man's aimSweet fired this frame. Matches physics.js collideRod's fz / relR test.
   for(const s of dbgSweet){
    const vis=on&&dbgAIOpts.sweetSpot;
    s.group.visible=vis;if(!vis)continue;
    const r=s.rod,dir=r.kickDir,fz=r.baseZ[s.manIdx]+r.offset;
    s.group.position.set(r.x+szCxOff*dir,0,fz);
    s.group.children[0].material=r.aimSweet===s.manIdx?s.matHot:s.matDim;
   }

  // trapZone: static boxes; hot purple while that rod is actively trapping
  for(const tz of dbgTrapZone){
   const vis=on&&dbgAIOpts.trapZone;
   tz.mesh.visible=vis;if(!vis)continue;
   tz.mesh.material=tz.rod.act==='trap'?tz.matHot:tz.matDim;
  }

  // safeRaise: static boxes; hot lime while that rod is actively safe-raising
  for(const sr of dbgSafeRaise){
   const vis=on&&dbgAIOpts.safeRaise;
   sr.mesh.visible=vis;if(!vis)continue;
   sr.mesh.material=sr.rod.act==='safeRaise'?sr.matHot:sr.matDim;
  }

  // evade: static boxes; hot teal while that rod is actively evading
  for(const ev of dbgEvade){
   const vis=on&&dbgAIOpts.evade;
   ev.mesh.visible=vis;if(!vis)continue;
   ev.mesh.material=ev.rod.act==='evade'?ev.matHot:ev.matDim;
  }

  // evadeDead: behind-the-rod dead zone where evade is suppressed (tied to evade toggle)
  for(const ed of dbgEvadeDead){
   const vis=on&&dbgAIOpts.evade;
   ed.mesh.visible=vis;if(!vis)continue;
   ed.mesh.material=ed.matDim;
  }

  // dropSweep: follow each foot's live z (baseZ + slide); hot while rod is held forward
  for(const ds of dbgDropSweep){
   const vis=on&&dbgAIOpts.dropSweep;
   ds.mesh.visible=vis;if(!vis)continue;
   const r=ds.rod,dir=r.team===0?1:-1;
   ds.mesh.position.set(r.x+(AIC.heldFwd.xFront-AIC.heldFwd.xBack)/2*dir,0.05,r.baseZ[ds.manIdx]+r.offset);
   ds.mesh.material=r.heldFwd?ds.matHot:ds.matDim;
  }

  // footRange: inFootRange reach box per man, follows the slide; hot white while any live ball
  // clips THIS man (mirrors inFootRange's per-man x-band + z-footprint test in ai.js).
  {const hz=FOOT_BOX.z+BALL_R+AIC.clearMargin;
  for(const fr of dbgFootRange){
   const vis=on&&dbgAIOpts.footRange;
   fr.mesh.visible=vis;if(!vis)continue;
   const r=fr.rod,dir=r.team===0?1:-1,fz=r.baseZ[fr.manIdx]+r.offset;
   fr.mesh.position.set(r.x+(AIC.underFootFront-AIC.footRangeBack)/2*dir,0.045,fz);
   let hot=false;
   if(manLive(r,fr.manIdx))for(const b of S.balls){
    const rel=(b.m.position.x-r.x)*dir;
    if(rel<=AIC.underFootFront&&rel>=-AIC.footRangeBack&&Math.abs(b.m.position.z-fz)<hz){hot=true;break;}
   }
   fr.mesh.material=hot?fr.matHot:fr.matDim;
  }}

  // aligned: per-man floor bars showing ±align zone along z
  if(on&&dbgAIOpts.aligned&&S.balls.length){
   const bp=S.balls[0].m.position;
   const speed=S.balls[0].v.length();
   const slow=speed<AIC.slowSpeed;
   const alThresh=slow?AIC.alignSlow:AIC.alignFast;
   // find nearest man + dz per rod
   const rodNearest=new Map();
   for(const r of rods){
    let bestZ=r.baseZ[0]+r.offset,bestDz=Math.abs(bp.z-bestZ),bestIdx=0;
    for(let i=1;i<r.baseZ.length;i++){
     const z=r.baseZ[i]+r.offset,dz=Math.abs(bp.z-z);
     if(dz<bestDz){bestDz=dz;bestZ=z;bestIdx=i;}
    }
    rodNearest.set(r,{idx:bestIdx,z:bestZ,dz:bestDz});
   }
   for(const ar of dbgAlignRings){
    const r=ar.rod;
    const rz=r.baseZ[ar.manIdx]+r.offset;
    ar.bar.position.set(r.x,0.04,rz);
    const near=rodNearest.get(r);
    const isNearest=near&&near.idx===ar.manIdx;
    const al=isNearest&&near.dz<alThresh;
    ar.bar.material=al?ar.matGreen:ar.matDim;
    ar.bar.visible=true;
    ar.bar.scale.z=alThresh/AIC.alignSlow;
   }
  }else{
   for(const ar of dbgAlignRings)ar.bar.visible=false;
  }

  for(const mr of dbgAIManRings){
   const r=mr.rod;
   mr.ring.visible=on&&dbgAIOpts.manHyst&&r.aiMan===mr.manIdx;
  }
  for(const td of dbgAITargetDots){
   const r=td.rod;
   if(!on||!dbgAIOpts.manHyst||r.aiMan<0||r.target===undefined){
    td.dot.visible=false;continue;
   }
   td.dot.position.set(r.x,0.06,r.target+r.baseZ[r.aiMan]);
   td.dot.visible=true;
  }

  // shotLanes: per gap-aiming rod, draw its sampled lanes (green open / red blocked) + target disc
  for(const sl of dbgShotLanes){
   const ev=sl.rod.aimEv,vis=on&&dbgAIOpts.shotLanes&&!!ev;
   if(!vis){for(const ln of sl.lines)ln.visible=false;sl.marker.visible=false;continue;}
   const y=0.16;
   for(let s=0;s<sl.lines.length;s++){
    const ln=sl.lines[s],lane=ev.lanes[s];
    if(!lane){ln.visible=false;continue;}
    const pa=ln.geometry.attributes.position.array;
    pa[0]=ev.ox;pa[1]=y;pa[2]=ev.oz;pa[3]=ev.goalX;pa[4]=y;pa[5]=lane.tz;
    ln.geometry.attributes.position.needsUpdate=true;
    ln.material=lane.clr>=AIC.gapAim.openMargin?dbgShotOpen:dbgShotBlock;
    ln.visible=true;
   }
    sl.marker.position.set(ev.goalX,y,ev.best.tz);
    sl.marker.material=ev.best.clr>=AIC.gapAim.openMargin?dbgMarkOpen:dbgMarkBlock;
    sl.marker.visible=true;
  }

  // sweetSpot flash: a disc blooms at the foot whenever a sweet kick landed there this frame
  for(const f of dbgSweetFlash){
   const r=f.rod;
   const fired=r.aimSweet===f.manIdx;
   if(fired)f.t=S.time;
   const age=S.time-f.t;
   const vis=on&&dbgAIOpts.sweetSpot&&age>=0&&age<0.4;
   f.mesh.visible=vis;if(!vis)continue;
   const k=1-age/0.4;                 // 1→0 over the flash lifetime
   const fz=r.baseZ[f.manIdx]+r.offset;
   f.mesh.position.set(r.x+szCxOff*r.kickDir,0.12,fz);   // sweet-band centre, small height above the floor
   f.mesh.scale.setScalar(0.6+k*1.4);
   f.mesh.material.opacity=0.9*k;
  }
}

function toggleDebug(){
 if(!dbgGroup)buildDebug();
 dbgOn=!dbgOn;
  dbgGroup.visible=dbgOn;
  for(const c of dbgCaps)c.visible=dbgOn;
  for(const c of dbgFootS)c.mesh.visible=dbgOn;
  dbgAIGroup.visible=dbgOn;
 if(dbgAIPanel)dbgAIPanel.style.display=dbgOn?'block':'none';
 if(dbgLogPanel)dbgLogPanel.style.display=(dbgOn&&dbgLogRod)?'block':'none';
 updateAIVis();
 banner('COLLISION DEBUG',dbgOn?'ON · red=wall green=goal yellow=player':'OFF',1.1);
 Au.ui();
}

/* Ball proxies follow live balls; capsules & static geometry need no update. */
function debugUpdate(){
 if(!dbgOn){
  const show=S.freeRoam;
   $('camInfo').style.display=show?'block':'none';
   $('ballSpeed').style.display=show?'block':'none';
   $('ballVel').style.display=show?'block':'none';
   if(!show)return;
   updateCamInfo();
   updateBallSpeed();
   updateBallVel();
   return;
  }
  $('camInfo').style.display='block';
  $('ballSpeed').style.display='block';
  $('ballVel').style.display='block';
  updateCamInfo();
  updateBallSpeed();
  updateBallVel();
 updateFootBoxes();
 for(let i=0;i<dbgBalls.length;i++){
  const b=S.balls[i];
  if(b){dbgBalls[i].visible=true;dbgBalls[i].position.copy(b.m.position);}
  else dbgBalls[i].visible=false;
 }
 // arena contour rings: iso-contour sd=-BALL_R at ball's height
 if(ARENA_ON&&dbgArenaWalls){
  const gh0=ARENA_ON?F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1):F.goalHalf;
  const gh1=ARENA_ON?F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1):F.goalHalf;
  for(let i=0;i<dbgContourRings.length;i++){
   const b=S.balls[i],cr=dbgContourRings[i];
   if(!b||!cr){cr.visible=false;continue;}
   const bp=b.m.position;
   const npts=49;
   for(let j=0;j<npts;j++){
    const a=j/npts*Math.PI*2;
    const rx=Math.cos(a)*BALL_R*1.2,rz=Math.sin(a)*BALL_R*1.2;
    let sx=bp.x+rx,sz=bp.z+rz;
    for(let k=0;k<2;k++){const g=arenaGrad(sx,sz,gh0,gh1);const e=arenaSD(sx,sz,gh0,gh1)+BALL_R;sx-=g.x*e;sz-=g.z*e;}
    cr.geometry.attributes.position.setXYZ(j,sx,bp.y,sz);
   }
   cr.geometry.attributes.position.needsUpdate=true;
   cr.visible=true;
  }
 }else{
  for(const cr of dbgContourRings)cr.visible=false;
 }
 // toggle arena vs classic wall debug
 if(dbgArenaWalls)dbgArenaWalls.visible=dbgOn&&ARENA_ON;
 updateAIVis();
}
function updateFootBoxes(){
 for(const fb of dbgFootS){
  const r=fb.rod;
  const sa=Math.sin(r.angle),ca=Math.cos(r.angle),offy=FOOT_BOX_OFF.y*r.kickDir;
  const fx=r.x+sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T;
   const fz=r.baseZ[fb.manIdx]+r.offset;
   fb.mesh.position.set(fx+FOOT_BOX_OFF.x*sa+offy*ca,fy-FOOT_BOX_OFF.x*ca+offy*sa,fz);
   fb.mesh.rotation.set(0,0,r.angle);
  }
  for(const fr of dbgFootReach){
   const r=fr.rod;
   const sa=Math.sin(r.angle),ca=Math.cos(r.angle),offy=FOOT_BOX_OFF.y*r.kickDir;
   const fx=r.x+sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T;
   const fz=r.baseZ[fr.manIdx]+r.offset;
   fr.mesh.position.set(fx+FOOT_BOX_OFF.x*sa+offy*ca,fy-FOOT_BOX_OFF.x*ca+offy*sa,fz);
   fr.mesh.rotation.set(0,0,r.angle);
 }
}
function updateCamInfo(){
 const p=camera.position;
 const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
 const l=new THREE.Vector3().copy(p).addScaledVector(fwd,50);
 $('camInfo').innerHTML='<span>POS</span>'+p.x.toFixed(1)+'&nbsp;'+p.y.toFixed(1)+'&nbsp;'+p.z.toFixed(1)+'<span>LOOK</span>'+l.x.toFixed(1)+'&nbsp;'+l.y.toFixed(1)+'&nbsp;'+l.z.toFixed(1);
}
function updateBallSpeed(){
  if(!S.balls.length){$('ballSpeed').innerHTML='<span>SPEED</span>no ball';return;}
  const speed=S.balls[0].v.length();
  $('ballSpeed').innerHTML='<span>SPEED</span><b class="val">'+speed.toFixed(0)+'</b> u/s';
}
function updateBallVel(){
  if(!S.balls.length){$('ballVel').innerHTML='<span>VEL</span>no ball';return;}
  const v=S.balls[0].v;
  $('ballVel').innerHTML='<span>VEL X</span><b class="val">'+v.x.toFixed(1)+'</b><span>Z</span><b class="val">'+v.z.toFixed(1)+'</b>';
}
