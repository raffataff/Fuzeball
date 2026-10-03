'use strict';
// ================= collision & AI debug overlay (press C) =================
// collisions are analytic (physics.js), not the meshes; this draws proxies at the exact geometry
// red = wall, green = goal mouth, yellow = player capsule, cyan = ball, blue = floor; AI layers show the zones behind AI decisions
let dbgGroup=null,dbgOn=false,dbgCaps=[],dbgBalls=[],dbgFootS=[];
let dbgArenaWalls=null,dbgContourRings=[];
// shared proxy geometries (one unit cube/sphere/cylinder scaled per mesh); dbgGeo collects them for disposeDebug
// shared-geometry meshes carry size in .scale, so updateAIVis mustn't write .scale on those layers
let dbgUnitBox=null,dbgUnitSph=null,dbgUnitCyl=null,dbgGeo=[];

// ===== memory / GPU footprint dump =====
// memLog('label') from the console; GPU counts from renderer.info, JS heap from performance.memory (Chrome only)
function memFmt(b){return (b||b===0)?(b/1048576).toFixed(1)+'MB':'n/a';}
function memLog(tag){
 tag=tag||'?';
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 const pm=(typeof performance!=='undefined')&&performance.memory;
 const geos=ri?ri.memory.geometries:'?',texs=ri?ri.memory.textures:'?';
 const progs=(ri&&ri.programs)?ri.programs.length:'?';
 let nodes=0;if(typeof scene!=='undefined'&&scene)scene.traverse(()=>nodes++);
 const mc=(typeof modelCache!=='undefined'&&modelCache)?Object.keys(modelCache).length:'?';
 // resident table assets listed by name, so a regression reads as extra keys
 const sk=(typeof skinOrder!=='undefined'&&skinOrder)?(skinOrder.join(',')||'none'):'?';
 const rm=(typeof roomOrder!=='undefined'&&roomOrder)?(roomOrder.join(',')||'none'):'?';
 // baked reflection maps aren't in the scene graph (memTexBytes can't see them); listed by key
 const ev=(typeof envOrder!=='undefined'&&envOrder)?(envOrder.join(',')||'none'):'?';
 const pt=(typeof pitchOrder!=='undefined'&&pitchOrder)?(pitchOrder.join(',')||'none'):'?';
 const sy=(typeof skyOrder!=='undefined'&&skyOrder)?(skyOrder.join(',')||'none'):'?';
 // the shared offscreen renderer (PRV, world.js) holds its own uploads; reported separately
 const sub=[];
 if(typeof PRV!=='undefined'&&PRV&&PRV.r&&PRV.r.info)
  sub.push('preview '+PRV.r.info.memory.geometries+'g/'+PRV.r.info.memory.textures+'t @'+PRV.w+'x'+PRV.h);
 console.log('%c[MEM '+tag+']','color:#2af5ff;font-weight:bold',
  'JS heap '+memFmt(pm&&pm.usedJSHeapSize)+' / limit '+memFmt(pm&&pm.jsHeapSizeLimit)
  +' | GPU '+geos+' geoms, '+texs+' textures, '+progs+' shaders'
  +' | scene '+nodes+' nodes | modelCache '+mc+' templates'
  +' | skins ['+sk+'] rooms ['+rm+'] pitches ['+pt+'] envs ['+ev+'] skies ['+sy+']'
  +' | tex '+memFmt(memTexBytes())
  +(sub.length?' | extra contexts: '+sub.join(', '):''));
}

// ===== texture footprint audit =====
// memTex() lists the worst offenders, memTexBytes() is the total; walks the live scene and the caches, de-duped by uuid; an estimate
function texSize(t){
 // a compressed texture needn't be estimated: sum its mip levels, or the audit over-reports KTX2 by 4x
 if(t&&t.isCompressedTexture&&t.mipmaps&&t.mipmaps.length){
  let b=0;for(const l of t.mipmaps)b+=(l&&l.data&&l.data.byteLength)||0;
  const m0=t.mipmaps[0]||{},im0=t.image||{};
  return{w:m0.width||im0.width||0,h:m0.height||im0.height||0,b:b,gpu:1};
 }
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
 // walk every resident pitch, not just the shown one
 if(typeof pitchGroups!=='undefined')for(const k in pitchGroups)push(pitchGroups[k]);
 if(typeof roomGroups!=='undefined')for(const k in roomGroups)push(roomGroups[k]);
 const KEYS=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap','alphaMap','displacementMap','lightMap','envMap'];
 for(const r of roots)r.traverse(c=>{
  if(!c.material)return;
  for(const m of (Array.isArray(c.material)?c.material:[c.material])){
   if(!m)continue;
   for(const k of KEYS){const t=m[k];if(!t||!t.uuid||seen.has(t.uuid))continue;
    const s=texSize(t);if(s.b)seen.set(t.uuid,{name:(t.name||m.name||c.name||'?')+' ['+k+']',w:s.w,h:s.h,b:s.b,gpu:!!s.gpu});}
  }
 });
 return [...seen.values()].sort((a,b)=>b.b-a.b);
}
function memTexBytes(){let n=0;for(const t of memTexCollect())n+=t.b;return n;}
// console helper: the 15 fattest textures resident, biggest first
function memTex(n){
 const list=memTexCollect();let tot=0,ktx=0,nk=0;
 for(const t of list){tot+=t.b;if(t.gpu){ktx+=t.b;nk++;}}
 // the KTX2 count shows whether an asset was encoded or silently fell back
 console.log('%c[TEX] '+list.length+' unique, '+memFmt(tot)+' ('+nk+' KTX2 = '+memFmt(ktx)
  +' exact; the rest est. as uncompressed RGBA + mipmaps)','color:#ffcf4d;font-weight:bold');
 console.table(list.slice(0,n||15).map(t=>({texture:t.name,px:t.w+'×'+t.h,MB:+(t.b/1048576).toFixed(1),KTX2:t.gpu?'✓':''})));
 return tot;
}

// ===== light audit =====
// lightAudit() lists every light with provenance and cost (a pooled light at intensity 0 still costs; shadow casters are extra passes)
function lightProvenance(l){
 if(typeof hemiLight!=='undefined'&&l===hemiLight)return 'world.js key - hemisphere (applyRoom sets colours/int)';
 if(typeof dirLight!=='undefined'&&l===dirLight)return 'world.js key - directional SUN';
 if(typeof goalLights!=='undefined'&&goalLights.indexOf(l)>=0)return 'goal flash pool (fx.js goalFx)';
 if(typeof fxLightPool!=='undefined'&&fxLightPool.indexOf(l)>=0)return 'fx light pool'+(l._fxFree?' - FREE (dead weight)':' - borrowed');
 if(typeof roomLightPool!=='undefined')for(const t in roomLightPool)
  if(roomLightPool[t].indexOf(l)>=0)return 'room light pool ['+t+']'+(l._rlFree?' - FREE (dead weight)':' - authored rooms.<id>.lights');
 // anything left is inside a loaded model, usually a room GLB's baked lights
 if(typeof roomGroups!=='undefined')for(const id in roomGroups){
  let p=l;while(p){if(p===roomGroups[id])return 'BAKED into room GLB ('+id+') - position lives in the model';p=p.parent;}}
 return 'unknown parent: '+((l.parent&&(l.parent.name||l.parent.type))||'none');
}
// delivered intensity from one light at the point directly below it at height y
function lightDeliv(l,wp,y){
 if(l.isHemisphereLight||l.isAmbientLight)return '-';
 if(l.isDirectionalLight)return +l.intensity.toFixed(3);   // no falloff
 const d=Math.abs(wp.y-y);
 const f=(l.distance>0)?Math.pow(Math.max(0,1-d/l.distance),l.decay===undefined?2:l.decay):1;
 return +(l.intensity*f).toFixed(3);
}

function lightAudit(){
 if(typeof scene==='undefined'||!scene){console.warn('[LIGHTS] no scene yet');return 0;}
 const rows=[],wp=new THREE.Vector3();let dead=0,cast=0;
 scene.traverse(o=>{
  if(!o.isLight)return;
  o.getWorldPosition(wp);
  const lit=o.intensity>0.0001&&o.visible;
  if(!lit)dead++;
  if(o.castShadow)cast++;
  rows.push({
   type:o.type.replace('Light',''),
   from:lightProvenance(o),
   int:+o.intensity.toFixed(3),
   lit:lit?'yes':'- dead -',
   pos:o.isHemisphereLight?'-':[wp.x,wp.y,wp.z].map(v=>Math.round(v)).join(','),
   dist:o.distance===undefined?'-':Math.round(o.distance),
   decay:o.decay===undefined?'-':o.decay,
   angle:o.isSpotLight?(o.angle*180/Math.PI).toFixed(0)+'deg':'-',
   table:lightDeliv(o,wp,0),
   floor:lightDeliv(o,wp,-43),
   shadow:o.castShadow?'CASTS':'no'
  });
 });
 rows.sort((a,b)=>(a.lit===b.lit?0:a.lit==='yes'?-1:1));
 console.log('%c[LIGHTS] '+rows.length+' in scene - '+(rows.length-dead)+' lit, '+dead+' dead weight, '+cast+' casting shadows',
  'color:#ffcf4d;font-weight:bold');
 console.table(rows);
 console.log('%cAll '+rows.length+' are evaluated per-fragment by every MeshStandardMaterial, lit or not.'
  +' Each CASTS costs a full extra shadow render pass per frame.','color:#8fa');
 console.log('%ctable/floor = delivered straight down at y=0 vs the room floor y=-43. Nothing occludes'
  +' (every light here except the SUN is castShadow:false), so a big floor number IS the rug lit'
  +' through the table.','color:#8fa');
 return rows.length;
}

// AI debug state
let dbgAIGroup=null,dbgAIPanel=null;
let dbgAIOpts={gkPad:false,raiseBehind:false,overFoot:false,underFoot:false,inFront:false,lowY:false,manHyst:false,footReach:false,aligned:false,serveZone:false,redropZones:false,dropSweep:false,footRange:false,trapZone:false,safeRaise:false,evade:false,makeWay:false,dribble:false,shotLanes:false,sweetSpot:false,deadzones:false};
let dbgAIGKPad=[],dbgAIRaise=[],dbgAIOverFoot=[],dbgAIUnderFoot=[],dbgAIInFront=[],dbgDropSweep=[],dbgFootRange=[],dbgTrapZone=[],dbgSafeRaise=[],dbgEvade=[],dbgEvadeDead=[],dbgMakeWay=[],dbgDribble=[],dbgDeadzones=[];
let dbgShotLanes=[],dbgShotOpen=null,dbgShotBlock=null,dbgMarkOpen=null,dbgMarkBlock=null;
let dbgAILowY=null,dbgAIManRings=[],dbgAITargetDots=[],dbgFootReach=[],dbgAlignRings=[],dbgAIServe=[],dbgAIRedrop=[];
let dbgSweet=[],dbgSweetFlash=[],dbgSweetFlashMat=null,szCxOff=0,szW=0,szZ=0;

// ===== per-rod kick decision tracer =====
// L (debug on) cycles the traced rod; one line per state change or kick, ★KICK carries gap= (seconds since this rod's last kick)
// blocked frames log the first failing gate; free when off (call sites test dbgLogRod===r); 'Kick→Console' mirrors to the console
let dbgLogRod=null,dbgLogLines=[],dbgLogPanel=null,dbgLogBody=null,dbgLogHdr=null;
let dbgLogPrevKick=-1,dbgLogConsole=false;
// dedupe per channel (one shared slot would ping-pong between emitters); a real event clears the channels
let dbgLogLast={};
// an identical line folds into a xN counter instead of pushing copies
let dbgLogRepKey='',dbgLogRepN=1,dbgLogRepTxt='',dbgLogDirty=false;
function dbgRodName(r){return (r.team===0?'RED':'BLU')+' '+r.role+' x'+r.x;}
function dbgFmtT(t){return 't'+t.toFixed(2);}
function buildKickLogPanel(){
 if(dbgLogPanel)return;
 const p=document.createElement('div');p.id='dbgKickLog';
 p.style.cssText='position:fixed;left:10px;bottom:10px;z-index:60;width:660px;max-height:46vh;overflow:hidden;'
  +'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#ffe6a3;background:rgba(8,10,16,.82);'
  +'border:1px solid #ffcf4d;border-radius:8px;padding:8px 10px;pointer-events:none;white-space:pre;';
 const h=document.createElement('div');h.id='dbgKickLogHdr';
 h.style.cssText='color:#ffcf4d;font-weight:700;margin-bottom:4px;letter-spacing:.5px;';
 h.textContent='KICK LOG · off  (press L to pick a rod)';
 const b=document.createElement('div');b.id='dbgKickLogBody';
 p.appendChild(h);p.appendChild(b);document.body.appendChild(p);
 dbgLogPanel=p;dbgLogHdr=h;dbgLogBody=b;
}
function renderKickLog(){if(dbgLogBody)dbgLogBody.innerHTML=dbgLogLines.join('<br>');dbgLogDirty=false;}
// flushed once per frame from debugUpdate, not per sim step
function flushKickLog(){if(dbgLogDirty)renderKickLog();}
// key = identity of a line: same key collapses into a xN counter, else a new line; the console mirror only sees new lines
function dbgLogPush(s,key){
 if(key&&key===dbgLogRepKey&&dbgLogLines.length){
  dbgLogRepN++;
  dbgLogLines[dbgLogLines.length-1]=dbgLogRepTxt+'  ×'+dbgLogRepN;
  dbgLogDirty=true;return;
 }
 dbgLogRepKey=key||'';dbgLogRepN=1;dbgLogRepTxt=s;
 dbgLogLines.push(s);
 if(dbgLogLines.length>28)dbgLogLines.shift();
 if(dbgLogConsole)console.log('[kick] '+s);
 dbgLogDirty=true;
}
// true when `kind` differs from the last on this channel and the channel isn't thrashing
// a channel changing faster than DBG_LOG_GAP has lines swallowed and counted, with one '⇄ thrash' summary
const DBG_LOG_GAP=0.35;
let dbgLogT={},dbgLogSkip={};
function dbgLogNew(ch,kind){
 if(dbgLogLast[ch]===kind)return false;
 const t=S.time,last=dbgLogT[ch];
 dbgLogLast[ch]=kind;
 if(last!=null&&t-last<DBG_LOG_GAP){dbgLogSkip[ch]=(dbgLogSkip[ch]||0)+1;return false;}
 dbgLogT[ch]=t;
 const n=dbgLogSkip[ch]||0;
 if(n){dbgLogSkip[ch]=0;dbgLogPush(dbgFmtT(t)+'  '+ch+' ⇄ thrash  '+n+' changes suppressed',ch+'|thrash');}
 return true;
}
// L cycles: null → rod0 → … → rodN → null. Resets the trace state each time.
function cycleKickLog(){
 buildKickLogPanel();
 const i=dbgLogRod?rods.indexOf(dbgLogRod):-1,ni=i+1;
 dbgLogRod=ni>=rods.length?null:rods[ni];
 dbgLogLines.length=0;dbgLogPrevKick=-1;dbgLogLast={};dbgLogT={};dbgLogSkip={};dbgLogRepKey='';dbgLogRepN=1;dbgLogRepTxt='';
 dbgLogHdr.textContent=dbgLogRod?('KICK LOG · '+dbgRodName(dbgLogRod)+'   (L = next rod)'):'KICK LOG · off  (press L to pick a rod)';
 renderKickLog();
 dbgLogPanel.style.display=(dbgOn&&dbgLogRod)?'block':'none';
 toast('KICK LOG',dbgLogRod?dbgRodName(dbgLogRod):'off',1.0);Au.ui();   // tier 3: dev chatter, not a goal
}
// state-change / action trace; channel = the kind's prefix before ':' (else 'act')
function dbgRod(r,kind,detail){
 if(r!==dbgLogRod)return;
 const i=kind.indexOf(':'),ch=i>0?kind.slice(0,i):'act';
 if(!dbgLogNew(ch,kind))return;
 dbgLogPush(dbgFmtT(S.time)+'  '+kind+(detail?('  '+detail):''),ch+'|'+kind);
}
// real contact: collideRod calls this when a foot box or capsule graze first resolves in a swing; ★KICK then ✓CONTACT hit, ✗WHIFF missed
// c = the vn breakdown (vn = foot·n - ball·n); swing = |rotational contact velocity|, slide = r.vz, ω = r.angVel (a spike = the curve jumped), jm = impulse, rest = restitution
function dbgHit(r,man,foot,pow,sweet,vn,b,c){
 if(r!==dbgLogRod)return;
 dbgLogLast={};                                  // a real event: let every steady state re-announce after it
 // vn to 1dp so a graze doesn't read as 'vn=0'; the speed then comes from the grip term
 dbgLogPush(dbgFmtT(S.time)+'  ✓CONTACT '+(foot?'foot':'leg ')+' man='+man+(pow?' [POWER]':'')+(sweet?' [SWEET]':'')
  +'  vn='+vn.toFixed(1)+'  ball→'+b.v.length().toFixed(0)+'u/s');
 if(c)dbgLogPush('      vn = foot '+c.fn.toFixed(1)+' − ball '+c.bn.toFixed(1)
  +'  │ swing '+c.sw.toFixed(1)+' slide '+c.sl.toFixed(1)+' ω '+c.w.toFixed(1)
  +'  │ jm '+c.jm.toFixed(1)+' rest '+c.rest+' kickT '+c.kt.toFixed(3));
}
// the kick gate: logs every fire (with gap) and the first failing condition when blocked; g = ai.js's raw gate values; ex = exertion / kickFat.full before this swing, fat = the stFat multiplier
function dbgKickGate(r,g){
 if(r!==dbgLogRod)return;
 const now=S.time;
 if(g.fired){
  const gap=dbgLogPrevKick>=0?(now-dbgLogPrevKick):-1;dbgLogPrevKick=now;
  dbgLogLast={};                                 // a real event: let every steady state re-announce after it
  dbgLogPush(dbgFmtT(now)+'  ★KICK  gap='+(gap>=0?gap.toFixed(2)+'s':'--')
   +'  rel='+g.rel.toFixed(1)+' dz='+g.dz.toFixed(2)+' spd='+g.speed.toFixed(0)
   +'  ex='+(r.exert||0).toFixed(1)+'/'+CONFIG.stats.kickFat.full+' fat='+(stFat(r)*100).toFixed(1)+'%'
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
 const kind='BLK:'+why.split(' ')[0];             // dedupe on the REASON, not the numbers riding on it
 if(dbgLogNew('gate',kind))dbgLogPush(dbgFmtT(now)+'  ·blocked  '+why+(g.act?('  act='+g.act):''),'gate|'+kind);
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
    {key:'makeWay',label:'Make Way',col:'#ffa1f0'},
    {key:'dribble',label:'Dribble',col:'#7a5cff'},
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
 // One unit primitive per shape, scaled per mesh (see the dbgGeo note up top).
 dbgUnitBox=new THREE.BoxGeometry(1,1,1);
 dbgUnitSph=new THREE.SphereGeometry(1,10,8);
 dbgUnitCyl=new THREE.CylinderGeometry(1,1,1,16);
 dbgGeo=[dbgUnitBox,dbgUnitSph,dbgUnitCyl];
 const keep=g=>{dbgGeo.push(g);return g;};          // register a one-off geometry for disposeDebug
 const wallM=dbgMat(0xff3b3b,.30),goalM=dbgMat(0x3bff6a,.22),floorM=dbgMat(0x3b7bff,.12),
       manM=dbgMat(0xffe23b,.38),ballM=new THREE.MeshBasicMaterial({color:0x2af5ff,wireframe:true});
 // every flat plate comes through here, collapsing onto one geometry; size lives in .scale
 const box=(w,h,d,x,y,z,m,g)=>{const b=new THREE.Mesh(dbgUnitBox,m);b.scale.set(w,h,d);b.position.set(x,y,z);(g||dbgGroup).add(b);return b;};
 // Same idea for the AI layers' floor plates, which sit flat and only vary in w/d.
 const plate=(m,w,h,d,x,y,z)=>{const b=new THREE.Mesh(dbgUnitBox,m);b.scale.set(w,h,d);b.position.set(x,y,z);b.visible=false;dbgAIGroup.add(b);return b;};
 const disc=(r,h,m)=>{const c=new THREE.Mesh(dbgUnitCyl,m);c.scale.set(r,h,r);c.visible=false;dbgAIGroup.add(c);return c;};
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
 // player capsules: pivot(y=ROD_H) to foot(-ARM), radius PRAD, parented to each pivot; built once, shared by all 22
 const rch=BALL_R*FOOT_BOX_REACH;
 const footBM=new THREE.MeshBasicMaterial({color:0xff8c3a,transparent:true,opacity:.45,wireframe:true,depthWrite:false});
 const reachM=new THREE.MeshBasicMaterial({color:0xff8c3a,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false});
 for(const r of rods)for(const bz of r.baseZ){
  const cap=new THREE.Group();cap.position.set(0,0,bz);
  const cyl=new THREE.Mesh(dbgUnitCyl,manM);cyl.scale.set(PRAD,ARM,PRAD);cyl.position.y=-ARM/2;cap.add(cyl);
  const top=new THREE.Mesh(dbgUnitSph,manM);top.scale.setScalar(PRAD);cap.add(top);
  const foot=new THREE.Mesh(dbgUnitSph,manM);foot.scale.setScalar(PRAD);foot.position.y=-ARM;cap.add(foot);
  cap.visible=false;r.pivot.add(cap);dbgCaps.push(cap);
   // foot box: collision proxy (oriented box, half-extents from config)
    const footBox=new THREE.Mesh(dbgUnitBox,footBM);
    footBox.scale.set(FOOT_BOX.y*2,FOOT_BOX.x*2,FOOT_BOX.z*2);
    footBox.visible=false;dbgAIGroup.add(footBox);dbgFootS.push({mesh:footBox,rod:r,manIdx:r.baseZ.indexOf(bz)});
     // foot reach: box inflated by ball reach distance in each dimension
    const reachBox=new THREE.Mesh(dbgUnitBox,reachM);
    reachBox.scale.set((FOOT_BOX.y+rch)*2,(FOOT_BOX.x+rch)*2,(FOOT_BOX.z+rch)*2);
    reachBox.visible=false;dbgAIGroup.add(reachBox);dbgFootReach.push({mesh:reachBox,rod:r,manIdx:r.baseZ.indexOf(bz)});
 }
  // ball collision spheres (radius BALL_R), positioned each frame.
  for(let i=0;i<KICK.splitMax+2;i++){const s=new THREE.Mesh(dbgUnitSph,ballM);s.scale.setScalar(BALL_R);s.visible=false;dbgGroup.add(s);dbgBalls.push(s);}
  // arena debug: low-res wireframe of the swept bowl (when ARENA_ON)
  dbgArenaWalls=buildArenaDebugMesh();
  if(dbgArenaWalls){dbgArenaWalls.visible=false;dbgGroup.add(dbgArenaWalls);
   if(dbgArenaWalls.geometry)keep(dbgArenaWalls.geometry);}   // built in arena.js — register it so disposeDebug frees it too
  // per-ball contact contour rings
  for(let i=0;i<KICK.splitMax+2;i++){
   const crGeo=keep(new THREE.BufferGeometry());   // per-ball: holds its own contour points
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

 // per-rod x-zones: raiseBehind, overFoot, inFront (flat boxes spanning the slide range)
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

   // overFoot: forward-offset zone, dir-relative
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

 // dropSweep: per-man danger boxes (a ball inside is swiped if the rod lowers from held-forward); hot pink while r.heldFwd
 const dsW=AIC.heldFwd.xBack+AIC.heldFwd.xFront;
 const dsZ=(FOOT_BOX.z+BALL_R+AIC.heldFwd.zMargin)*2;
 const dsGeo=keep(new THREE.BoxGeometry(dsW,0.05,dsZ));
 const dsDim=dbgMat(0xff5c8a,.15),dsHot=dbgMat(0xff5c8a,.5);
 for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
  const m=new THREE.Mesh(dsGeo,dsDim);m.visible=false;dbgAIGroup.add(m);
  dbgDropSweep.push({mesh:m,rod:r,manIdx:i,matDim:dsDim,matHot:dsHot});
 }

 // footRange: the inFootRange reach rectangle per man (gates safeRaise and evade); hot white while a live ball is inside
 const frW=AIC.footRangeBack+AIC.underFootFront;
 const frZ=(FOOT_BOX.z+BALL_R+AIC.clearMargin)*2;
 const frGeo=keep(new THREE.BoxGeometry(frW,0.05,frZ));
 const frDim=dbgMat(0xeaeaea,.12),frHot=dbgMat(0xeaeaea,.45);
 for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
  const m=new THREE.Mesh(frGeo,frDim);m.visible=false;dbgAIGroup.add(m);
  dbgFootRange.push({mesh:m,rod:r,manIdx:i,matDim:frDim,matHot:frHot});
 }

 // trapZone: box behind the rod (trap.back..front); hot purple while r.act==='trap'
 const tzDim=dbgMat(0xc77dff,.15),tzHot=dbgMat(0xc77dff,.5);
 const tzW=AIC.trap.front-AIC.trap.back;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=plate(tzDim,tzW,0.05,zMax-zMin||0.1,r.x+(AIC.trap.back+AIC.trap.front)/2*dir,0.04,(zMin+zMax)/2);
  dbgTrapZone.push({mesh:m,rod:r,matDim:tzDim,matHot:tzHot});
 }

 // safeRaise: box behind the rod (safeRaise.back..front); hot lime while r.act==='safeRaise'
 const srDim=dbgMat(0xc2ff4d,.15),srHot=dbgMat(0xc2ff4d,.5);
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  // keepers get safeRaise.gkFront extra reach in front, so their box is longer
  const srF=AIC.safeRaise.front+(r.role==='GK'?(AIC.safeRaise.gkFront||0):0);
  const srW=srF-AIC.safeRaise.back;
  const m=plate(srDim,srW,0.05,zMax-zMin||0.1,r.x+(AIC.safeRaise.back+srF)/2*dir,0.045,(zMin+zMax)/2);
  dbgSafeRaise.push({mesh:m,rod:r,matDim:srDim,matHot:srHot});
 }

 // evade: box directly behind the rod (-footRangeBack..0); hot teal while r.act==='evade'
 const evDim=dbgMat(0x00d9a3,.15),evHot=dbgMat(0x00d9a3,.5);
 const evW=AIC.footRangeBack;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=plate(evDim,evW,0.05,zMax-zMin||0.1,r.x-evW/2*dir,0.05,(zMin+zMax)/2);
  dbgEvade.push({mesh:m,rod:r,matDim:evDim,matHot:evHot});
 }

 // evadeDead: box where evade is suppressed (the ball is too close); orange, tied to the evade toggle
 const edDim=dbgMat(0xff6b4a,.18),edHot=dbgMat(0xff6b4a,.55);
 const edW=AIC.evade.behindDead;
 for(const r of rods){
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=plate(edDim,edW,0.04,zMax-zMin||0.1,r.x-edW/2*dir,0.04,(zMin+zMax)/2);
  dbgEvadeDead.push({mesh:m,rod:r,matDim:edDim,matHot:edHot});
 }

 // makeWay (clearLane): the trigger region on the rods that use it; hot pink while r.act==='lane'
 const CLD=AIC.clearLane;
 const mwDim=dbgMat(0xffa1f0,.16),mwHot=dbgMat(0xffa1f0,.5);
 const mwW=Math.max(.1,CLD.nearBall+CLD.behind);   // behind is negative
 for(const r of rods){
  if(CLD.roles&&CLD.roles.indexOf(r.role)<0)continue;
  const dir=r.team===0?1:-1;
  let mate=null;                                   // nearest same-team rod behind us = the handler
  for(const o of rods){if(o===r||o.team!==r.team)continue;if((r.x-o.x)*dir<CLD.mateBack)continue;
   if(!mate||Math.abs(o.x-r.x)<Math.abs(mate.x-r.x))mate=o;}
  if(!mate)continue;
  const zMin=mate.baseZ[0]-mate.maxOff-CLD.zPad,zMax=mate.baseZ[mate.baseZ.length-1]+mate.maxOff+CLD.zPad;
  const m=plate(mwDim,mwW,0.05,zMax-zMin||0.1,r.x+(CLD.behind-mwW/2)*dir,0.06,(zMin+zMax)/2);
  dbgMakeWay.push({mesh:m,rod:r,matDim:mwDim,matHot:mwHot});
 }

 // dribble: the trigger band (the strike zone) on dribble.roles rods; hot violet while r.act==='dribble'
 // plus a carry-target disc at r.dribZ and a line to the chosen pass receiver
 const DRD=AIC.dribble;
 const drDim=dbgMat(0x7a5cff,.15),drHot=dbgMat(0x7a5cff,.5);
 const drMark=dbgMat(0x7a5cff,.95),drPass=dbgMat(0x7a5cff,.9);
 const drW=Math.max(.1,DRD.front-DRD.back);
 for(const r of rods){
  if(DRD.roles&&DRD.roles.indexOf(r.role)<0)continue;
  const dir=r.team===0?1:-1;
  const zMin=Math.min(...r.baseZ)-r.maxOff,zMax=Math.max(...r.baseZ)+r.maxOff;
  const m=plate(drDim,drW,0.05,zMax-zMin||0.1,r.x+(DRD.back+DRD.front)/2*dir,0.07,(zMin+zMax)/2);
  const mk=disc(0.5,0.08,drMark);
  // the pass line holds its own per-frame endpoints, so it genuinely needs its own buffer
  const geo=keep(new THREE.BufferGeometry());geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const ln=new THREE.Line(geo,drPass);ln.frustumCulled=false;ln.visible=false;dbgAIGroup.add(ln);
  dbgDribble.push({mesh:m,mark:mk,line:ln,rod:r,matDim:drDim,matHot:drHot});
 }

 // serveZone: kickoff spawn box — SRV.spread (x) by SRV.zSpread (z), centred at x=0,z=0
 const serveM=dbgMat(0xc299ff,.22);
 const svg=abox(SRV.spread*2,SRV.zSpread*2,0,0,serveM);
 svg.visible=false;dbgAIServe.push(svg);

 // redropZones: dead-ball face-off zones (DEAD.redrop.zones), each ±spread in x and ±DEAD.redrop.z in z
 const redropM=dbgMat(0xff5c5c,.22);
 for(const z of DEAD.redrop.zones){
  const rzg=abox(z.spread*2,DEAD.redrop.z*2,z.x,0,redropM);
  rzg.visible=false;dbgAIRedrop.push(rzg);
 }
 // ...plus each zone's catchment (z.from) as a thin bar along the near touchline
 const catchM=dbgMat(0xff5c5c,.12);
 for(const z of DEAD.redrop.zones){
  if(!z.from)continue;
  const x0=Math.max(z.from[0],-F.L/2)+0.4,x1=Math.min(z.from[1],F.L/2)-0.4;
  if(x1<=x0)continue;
  const cg=abox(x1-x0,3,(x0+x1)/2,F.W/2-2,catchM);
  cg.visible=false;dbgAIRedrop.push(cg);
 }

 // deadzones: the active table's dead-ball pockets (activeTable.deadzones, see deadzoneMult in powerups.js); hot red while a live ball is inside; hidden for other tables
 const dzDim=dbgMat(0xff4d4d,.16),dzHot=dbgMat(0xff4d4d,.55);
 // one height for every flat plate on this layer; must clear the active skin's field surface, raise if a skin hides them
 const dzY=0.35;
 const dzList=(activeTable&&activeTable.deadzones)||[];
 for(const z of dzList){
  const w=F.L/2-z.xMin,d=F.W/2-z.zMin;
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const m=plate(dzDim,w,0.05,d,sx*(z.xMin+F.L/2)/2,dzY,sz*(z.zMin+F.W/2)/2);
   dbgDeadzones.push({mesh:m,zone:z,sx,sz,matDim:dzDim,matHot:dzHot});
  }
 }
 // ...plus the goal roof (CONFIG.deadball.roofMult), drawn at the stock mouth width
 if(DEAD.roofMult>1)for(const sx of [-1,1]){
  const m=plate(dzDim,F.goalDepth,0.05,F.goalHalf*2,sx*(F.L/2+F.goalDepth/2),F.goalH,0);
  dbgDeadzones.push({mesh:m,zone:null,roof:true,sx,sz:0,matDim:dzDim,matHot:dzHot});
 }
 // ...and the between-row lanes (CONFIG.deadball.rodGaps.lanes), straight off the config
 for(const ln of rodGaps()){
  const m=plate(dzDim,ln.x1-ln.x0,0.05,F.W,(ln.x0+ln.x1)/2,dzY,0);
  dbgDeadzones.push({mesh:m,zone:null,band:ln,sx:0,sz:0,matDim:dzDim,matHot:dzHot});
 }

 // lowY: translucent horizontal plane at y = lowY (AI only kicks below this)
 const lowYM=dbgMat(0x2af5ff,.10);
 dbgAILowY=new THREE.Mesh(keep(new THREE.PlaneGeometry(F.L,F.W)),lowYM);
 dbgAILowY.rotation.x=-Math.PI/2;dbgAILowY.position.y=AIC.lowY;
 dbgAILowY.visible=false;dbgAIGroup.add(dbgAILowY);

  // manHyst: per-man highlight rings (shown on the selected man) + per-rod target dots
  const ringGeo=keep(new THREE.TorusGeometry(PRAD+0.2,0.1,8,16));   // shared across all 22 men
  const ringM=dbgMat(0xffcf4d,.85);
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const ring=new THREE.Mesh(ringGeo,ringM);
    ring.position.set(0,-ARM,r.baseZ[i]);ring.visible=false;
    r.pivot.add(ring);dbgAIManRings.push({ring,rod:r,manIdx:i});
   }
   const dot=disc(0.35,0.06,dbgMat(0xffcf4d,.9));
   dbgAITargetDots.push({dot,rod:r});
  }

  // aligned: per-man floor bars showing the ±align zone along z, green = nearest man aligned
  // keeps its own geometry since updateAIVis animates .scale.z
  const alGeo=keep(new THREE.BoxGeometry(0.15,0.06,AIC.alignSlow*2));
  const alMatGreen=dbgMat(0x7dff8a,.65);
  const alMatDim=dbgMat(0x7dff8a,.12);
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const bar=new THREE.Mesh(alGeo,alMatDim);
    bar.visible=false;dbgAIGroup.add(bar);
    dbgAlignRings.push({bar,rod:r,manIdx:i,z:r.baseZ[i],matGreen:alMatGreen,matDim:alMatDim});
   }
  }

 // shotLanes: per gap-aiming rod, a pool of gapAim.samples lines (green open / red blocked) plus a target disc (r.aimEv, from shotEval)
 dbgShotOpen=new THREE.LineBasicMaterial({color:0x2bff88,transparent:true,opacity:.9});   // line: open lane
 dbgShotBlock=new THREE.LineBasicMaterial({color:0xff3b3b,transparent:true,opacity:.75});  // line: blocked lane
 dbgMarkOpen=dbgMat(0xffe14d,.95);dbgMarkBlock=dbgMat(0xff3b3b,.9);                         // disc: chosen target good/bad
 for(const r of rods){
  const set={rod:r,lines:[],marker:null};
  for(let s=0;s<AIC.gapAim.samples;s++){
   const geo=keep(new THREE.BufferGeometry());geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
   const ln=new THREE.Line(geo,dbgShotBlock);ln.frustumCulled=false;ln.visible=false;dbgAIGroup.add(ln);set.lines.push(ln);
  }
  const mk=disc(0.55,0.09,dbgMarkOpen);set.marker=mk;
  dbgShotLanes.push(set);
 }

  dbgAIGroup.visible=false;

  // sweetSpot: per-man area in front of the foot where a clean strike earns the power bonus (matches collideRod, SW.zFrac, SW.xMin/xMax)
  const sweetM=dbgMat(0xffe14d,.20),sweetHot=dbgMat(0xffe14d,.85);
  const SW=KICK.sweetSpot;
  szW=SW.xMax-SW.xMin; szCxOff=(SW.xMin+SW.xMax)/2; szZ=FOOT_BOX.z*SW.zFrac*2;
  for(const r of rods){
   for(let i=0;i<r.baseZ.length;i++){
    const g=new THREE.Group();
    box(szW,0.04,szZ,0,0.035,0,sweetM,g);   // box at the group origin; updateAIVis moves the group to the live foot
    g.visible=false;dbgAIGroup.add(g);
    dbgSweet.push({group:g,rod:r,manIdx:i,matDim:sweetM,matHot:sweetHot});
   }
  }

  // sweetSpot flash: a fading disc at the contact point when a sweet kick lands (r.aimSweet); pooled, one per foot
  dbgSweetFlashMat=dbgMat(0xffe14d,.9);
  // own geometry: updateAIVis scales these, so they can't share dbgUnitCyl
  const sfGeo=keep(new THREE.CylinderGeometry(0.5,0.5,0.1,16));
  for(const r of rods)for(let i=0;i<r.baseZ.length;i++){
   const d=new THREE.Mesh(sfGeo,dbgSweetFlashMat);
   d.visible=false;dbgAIGroup.add(d);
   dbgSweetFlash.push({mesh:d,rod:r,manIdx:i,t:-1});
  }
}

// tear the overlay down and free its GPU buffers (console: disposeDebug()); `C` alone only hides
// capsules and manHyst rings hang off r.pivot, so anything replacing the pivots (buildRods) must call this first
function disposeDebug(){
 if(!dbgGroup)return;
 const mats=new Set();
 const strip=o=>{
  if(!o)return;
  o.traverse(c=>{if(c.material)(Array.isArray(c.material)?c.material:[c.material]).forEach(m=>m&&mats.add(m));});
  if(o.parent)o.parent.remove(o);
 };
 strip(dbgGroup);strip(dbgAIGroup);
 for(const c of dbgCaps)strip(c);                              // parented to rod pivots, not the groups
 for(const e of dbgAIManRings)strip(e.ring);                   // ditto
 for(const g of dbgGeo)if(g&&g.dispose)g.dispose();
 mats.forEach(m=>m.dispose());
 dbgGroup=dbgAIGroup=dbgArenaWalls=dbgAILowY=null;
 dbgUnitBox=dbgUnitSph=dbgUnitCyl=null;dbgGeo=[];
 dbgCaps=[];dbgBalls=[];dbgFootS=[];dbgContourRings=[];
 dbgAIGKPad=[];dbgAIRaise=[];dbgAIOverFoot=[];dbgAIUnderFoot=[];dbgAIInFront=[];
 dbgDropSweep=[];dbgFootRange=[];dbgTrapZone=[];dbgSafeRaise=[];dbgEvade=[];dbgEvadeDead=[];
 dbgMakeWay=[];dbgDribble=[];dbgDeadzones=[];dbgShotLanes=[];
 dbgAIManRings=[];dbgAITargetDots=[];dbgFootReach=[];dbgAlignRings=[];dbgAIServe=[];dbgAIRedrop=[];
 dbgSweet=[];dbgSweetFlash=[];dbgSweetFlashMat=null;
 dbgShotOpen=dbgShotBlock=dbgMarkOpen=dbgMarkBlock=null;
 if(dbgAIPanel){dbgAIPanel.style.display='none';}
 dbgOn=false;
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

   // deadzones: corner pockets for the active table, plus the goal roofs and between-row lanes; the roof test defers to deadzoneMult
   {const cur=(activeTable&&activeTable.deadzones)||[];
   for(const dz of dbgDeadzones){
    const vis=!!(on&&dbgAIOpts.deadzones&&(dz.roof||dz.band||cur.indexOf(dz.zone)>=0));  // !! — dz.band is an ARRAY
    dz.mesh.visible=vis;if(!vis)continue;
    let hot=false;
    for(const b of S.balls){const p=b.m.position;
     const hit=dz.roof?(Math.sign(p.x)===dz.sx&&p.y>F.goalH&&deadzoneMult(p)>1)
       :dz.band?(p.x>dz.band.x0&&p.x<dz.band.x1)
       :(Math.sign(p.x)===dz.sx&&Math.sign(p.z)===dz.sz&&Math.abs(p.x)>dz.zone.xMin&&Math.abs(p.z)>dz.zone.zMin);
     if(hit){hot=true;break;}}
    dz.mesh.material=hot?dz.matHot:dz.matDim;
   }}

   // sweetSpot: follows the live foot; hot yellow when that man's aimSweet fired this frame
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

  // makeWay: static boxes; hot pink while that rod is clearing a teammate's lane
  for(const mw of dbgMakeWay){
   const vis=on&&dbgAIOpts.makeWay;
   mw.mesh.visible=vis;if(!vis)continue;
   mw.mesh.material=mw.rod.act==='lane'?mw.matHot:mw.matDim;
  }

  // dribble: static trigger band (hot violet while carrying), a disc at r.dribZ, a line to the receiver the rod would pick
  for(const dr of dbgDribble){
   const vis=on&&dbgAIOpts.dribble,r=dr.rod,carrying=r.act==='dribble';
   dr.mesh.visible=vis;
   if(!vis){dr.mark.visible=false;dr.line.visible=false;continue;}
   dr.mesh.material=carrying?dr.matHot:dr.matDim;
   dr.mark.visible=carrying;
   if(carrying)dr.mark.position.set(r.x,0.09,r.dribZ);
   const pk=r.passEv;                                   // last cached pass pick (dribble.pass.every)
   const showP=carrying&&!!pk;
   dr.line.visible=showP;
   if(showP){
    const pa=dr.line.geometry.attributes.position.array,mi=r.dribMan>=0?r.dribMan:0;
    pa[0]=r.x;pa[1]=0.18;pa[2]=r.baseZ[mi]+r.offset;pa[3]=pk.x;pa[4]=0.18;pa[5]=pk.z;
    dr.line.geometry.attributes.position.needsUpdate=true;
   }
  }

  // dropSweep: follow each foot's live z (baseZ + slide); hot while rod is held forward
  for(const ds of dbgDropSweep){
   const vis=on&&dbgAIOpts.dropSweep;
   ds.mesh.visible=vis;if(!vis)continue;
   const r=ds.rod,dir=r.team===0?1:-1;
   ds.mesh.position.set(r.x+(AIC.heldFwd.xFront-AIC.heldFwd.xBack)/2*dir,0.05,r.baseZ[ds.manIdx]+r.offset);
   ds.mesh.material=r.heldFwd?ds.matHot:ds.matDim;
  }

  // footRange: follows the slide; hot white while a live ball clips this man (mirrors inFootRange in ai.js)
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

  // shotLanes: per gap-aiming rod, its sampled lanes and target disc
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

  // sweetSpot flash: a disc blooms at the foot when a sweet kick landed this frame
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

// park the overlay out of the scene graph when off (visible=false still gets walked); the parent is kept in userData.dbgHome
function dbgPark(o){if(!o||!o.parent)return;o.userData.dbgHome=o.parent;o.parent.remove(o);}
function dbgUnpark(o){const h=o&&o.userData&&o.userData.dbgHome;if(h&&!o.parent)h.add(o);}
function dbgAttach(on){
 const list=[dbgGroup,dbgAIGroup];
 for(const c of dbgCaps)list.push(c);
 for(const e of dbgAIManRings)list.push(e.ring);
 for(const o of list)on?dbgUnpark(o):dbgPark(o);
}
function toggleDebug(){
 if(!dbgGroup)buildDebug();
 dbgOn=!dbgOn;
 dbgAttach(dbgOn);
  dbgGroup.visible=dbgOn;
  for(const c of dbgCaps)c.visible=dbgOn;
  for(const c of dbgFootS)c.mesh.visible=dbgOn;
  dbgAIGroup.visible=dbgOn;
 if(dbgAIPanel)dbgAIPanel.style.display=dbgOn?'block':'none';
 if(dbgLogPanel)dbgLogPanel.style.display=(dbgOn&&dbgLogRod)?'block':'none';
 // drop the AI tracer on the way out: its call sites run per sim step and nothing drains the buffer while hidden
 if(!dbgOn){dbgLogRod=null;dbgLogLast={};dbgLogRepKey='';}
 updateAIVis();
 toast('COLLISION DEBUG',dbgOn?'red=wall · green=goal · yellow=player':'off',1.1);
 Au.ui();
}

/* Ball proxies follow live balls; capsules & static geometry need no update. */
function debugUpdate(){
 if(!dbgOn){
  const show=S.freeRoam;
  const fpsShow=show||cfg.showFps;   // player-facing FPS counter (Display tab) shows outside debug too
  if(fpsShow)updateFps(false);else{dbgFpsLast=0;hudDev('fps',null);}   // hidden: drop the clock so re-entry doesn't read one giant frame
  hudDev('dead',null);               // dead-ball clock is debug-only — it doesn't ride along into free roam
  if(!show){hudDev('cam',null);hudDev('spd',null);hudDev('vel',null);return;}
  updateCamInfo();updateBallSpeed();updateBallVel();
  return;
 }
 flushKickLog();                     // one DOM write per FRAME, not per sim step
 updateCamInfo();updateBallSpeed();updateBallVel();
 updateFps(true);                    // debug: append the once-a-second leak-watch line
 updateDeadBall();
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
// dev readouts go to the HUD canvas as keyed sections (hudDev, js/hud.js): each updater owns one block, null removes it; rows are [label, value, hot] triples
function updateCamInfo(){
 const p=camera.position;
 const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).normalize();
 const l=new THREE.Vector3().copy(p).addScaledVector(fwd,50);
 hudDev('cam',[[['POS',p.x.toFixed(1)+' '+p.y.toFixed(1)+' '+p.z.toFixed(1)],['LOOK',l.x.toFixed(1)+' '+l.y.toFixed(1)+' '+l.z.toFixed(1)]]]);
}
function updateBallSpeed(){
 hudDev('spd',[[['SPEED',S.balls.length?S.balls[0].v.length().toFixed(0)+' u/s':'no ball']]]);
}
function updateBallVel(){
 if(!S.balls.length){hudDev('vel',[[['VEL','no ball']]]);return;}
 const v=S.balls[0].v;
 hudDev('vel',[[['VEL X',v.x.toFixed(1)],['Z',v.z.toFixed(1)]]]);
}
// DEAD-BALL CLOCK (powerups.js deadBallUpdate): the stall timer, the multiplier now, and the live-zone grace spent (tune CONFIG.deadball.live); the trailing figure is a projection
function updateDeadBall(){
 if(typeof deadzoneMult!=='function'){hudDev('dead',[[['DEAD BALL','n/a']]]);return;}
 if(S.trn&&!S.trn.deadball){hudDev('dead',[[['DEAD BALL','off (sandbox)']]]);return;}
 if(!S.balls.length){hudDev('dead',[[['DEAD BALL','no ball']]]);return;}
 const L=DEAD.live,rows=[[['DEAD BALL','']]];
 for(let i=0;i<S.balls.length&&i<3;i++){
  const b=S.balls[i],p=b.cur,st=b.stuckT||0,gr=b.graceT||0;
  const zm=deadzoneMult(p);
  // mirror deadBallUpdate's gate exactly or the readout disagrees with the whistle
  const live=zm===1&&L&&L.on&&gr<L.graceMax&&typeof liveZone==='function'&&liveZone(p);
  const mult=live?L.mult:zm;
  const left=deadLeft(b);
  const row=[];
  if(S.balls.length>1)row.push(['B'+i,'']);
  row.push(['STALL',st.toFixed(2)+'/'+DEAD.stallT.toFixed(1)],['x',mult.toFixed(2)]);
  if(L)row.push(['GRACE',gr.toFixed(2)+'/'+L.graceMax.toFixed(1)]);
  row.push([live?'IN REACH':(zm>1?'DEADZONE':'PLAIN'),(left>99?'99+':left.toFixed(1))+'s',left<AIC.force.left]);   // hot = the AI push is on
  rows.push(row);
 }
 hudDev('dead',rows);
}
// FPS readout from a private performance.now() clock; dbgFpsEma = smoothed frame ms, LOW = worst frame in the last second
let dbgFpsLast=0,dbgFpsEma=0,dbgFpsWorst=0,dbgFpsMinMs=0,dbgFpsWinT=0,dbgFpsDiag=null;
function updateFps(detail){
  const now=performance.now();
  if(dbgFpsLast){
   const dt=now-dbgFpsLast;                                   // this frame, ms
   dbgFpsEma=dbgFpsEma?dbgFpsEma+(dt-dbgFpsEma)*0.1:dt;       // smoothed frame time
   if(dt>dbgFpsWorst)dbgFpsWorst=dt;                          // worst frame this window
   if(now-dbgFpsWinT>1000){
    dbgFpsMinMs=dbgFpsWorst;dbgFpsWorst=0;dbgFpsWinT=now;     // publish LOW once/sec
    dbgFpsDiag=detail?fpsDiag():null;                         // refresh the leak-watch line once/sec (dev only)
   }
  }else dbgFpsWinT=now;
  dbgFpsLast=now;
  const fps=dbgFpsEma>0?1000/dbgFpsEma:0;
  const low=dbgFpsMinMs>0?1000/dbgFpsMinMs:fps;
  const rows=[[['FPS',fps.toFixed(0)],['MS',dbgFpsEma.toFixed(1)],['LOW',low.toFixed(0),low<45]]];
  if(detail&&dbgFpsDiag)rows.push(dbgFpsDiag);
  hudDev('fps',rows);
}
// leak-watch line: NODES / GEO / TEX / DRAW should be flat in steady play (climbing = something isn't freed); recomputed once a second
function fpsDiag(){
 let nodes=0;if(typeof scene!=='undefined'&&scene)scene.traverse(()=>nodes++);
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 const geo=ri?ri.memory.geometries:'?',tex=ri?ri.memory.textures:'?',calls=ri?ri.render.calls:'?';
 const pm=(typeof performance!=='undefined')&&performance.memory;
 const heap=pm?Math.round(pm.usedJSHeapSize/1048576)+'MB':'n/a';
 return[['NODES',String(nodes)],['GEO',String(geo)],['TEX',String(tex)],['DRAW',String(calls)],['HEAP',heap]];
}
