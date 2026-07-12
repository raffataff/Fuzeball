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

// AI debug state
let dbgAIGroup=null,dbgAIPanel=null;
let dbgAIOpts={gkPad:false,raiseBehind:false,overFoot:false,underFoot:false,inFront:false,lowY:false,manHyst:false,footReach:false,aligned:false,serveZone:false,redropZones:false,dropSweep:false,trapZone:false,safeRaise:false,evade:false,shotLanes:false};
let dbgAIGKPad=[],dbgAIRaise=[],dbgAIOverFoot=[],dbgAIUnderFoot=[],dbgAIInFront=[],dbgDropSweep=[],dbgTrapZone=[],dbgSafeRaise=[],dbgEvade=[];
let dbgShotLanes=[],dbgShotOpen=null,dbgShotBlock=null,dbgMarkOpen=null,dbgMarkBlock=null;
let dbgAILowY=null,dbgAIManRings=[],dbgAITargetDots=[],dbgFootReach=[],dbgAlignRings=[],dbgAIServe=[],dbgAIRedrop=[];

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
   {key:'trapZone',label:'Trap Zone',col:'#c77dff'},
   {key:'safeRaise',label:'Safe Raise',col:'#c2ff4d'},
   {key:'evade',label:'Evade',col:'#00d9a3'},
   {key:'shotLanes',label:'Shot Lanes',col:'#2bff88'}
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
 // from a held-forward angle. x = sweep window (underFootBack..underFootFront, dir-
 // relative), z = ±(footBox.z + BALL_R + clearMargin) around each foot. Positioned
 // per-frame (follows slide); hot pink while the rod is actually held (r.heldFwd).
 const dsW=AIC.underFootBack+AIC.underFootFront;
 const dsZ=(FOOT_BOX.z+BALL_R+AIC.clearMargin)*2;
 const dsGeo=new THREE.BoxGeometry(dsW,0.05,dsZ);
 const dsDim=dbgMat(0xff5c8a,.15),dsHot=dbgMat(0xff5c8a,.5);
 for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
  const m=new THREE.Mesh(dsGeo,dsDim);m.visible=false;dbgAIGroup.add(m);
  dbgDropSweep.push({mesh:m,rod:r,manIdx:i,matDim:dsDim,matHot:dsHot});
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

  // dropSweep: follow each foot's live z (baseZ + slide); hot while rod is held forward
  for(const ds of dbgDropSweep){
   const vis=on&&dbgAIOpts.dropSweep;
   ds.mesh.visible=vis;if(!vis)continue;
   const r=ds.rod,dir=r.team===0?1:-1;
   ds.mesh.position.set(r.x+(AIC.underFootFront-AIC.underFootBack)/2*dir,0.05,r.baseZ[ds.manIdx]+r.offset);
   ds.mesh.material=r.heldFwd?ds.matHot:ds.matDim;
  }

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
}

function toggleDebug(){
 if(!dbgGroup)buildDebug();
 dbgOn=!dbgOn;
  dbgGroup.visible=dbgOn;
  for(const c of dbgCaps)c.visible=dbgOn;
  for(const c of dbgFootS)c.mesh.visible=dbgOn;
  dbgAIGroup.visible=dbgOn;
 if(dbgAIPanel)dbgAIPanel.style.display=dbgOn?'block':'none';
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
  if(!show)return;
  updateCamInfo();
  updateBallSpeed();
  return;
 }
 $('camInfo').style.display='block';
 $('ballSpeed').style.display='block';
 updateCamInfo();
 updateBallSpeed();
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
