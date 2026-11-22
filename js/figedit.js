'use strict';
// ===== Figurine Sizer + Pose Lab (dev tool, F4 in the menus) =====
// gated on CONFIG.debug.figEditor; S.figEd (null when off) is tested by fx.js cameraUpdate, world.js renderIdleSkip and main.js only
// every edit writes CONFIG live (lost on reload): COPY hands it over for config.js

const FE={on:false,panel:null,lab:null,css:false,sel:new Set(),cur:null,tpl:{},kit:{},slots:[],balls:[],lines:[],geo:null,
 refY:null,more:0,ang:0,gap:7,box:true,leg:true,ball:true,names:true,others:false,cut:true,solo:false,bulk:false,R:30,org:{},stash:null,
 cam:{tx:0,ty:5,tz:0,yaw:0,pitch:.03,dist:200,fov:10},drag:null,vw:0,vh:0,tab:'size',stage:null,pOrg:{},src:null,
 L:{role:'MID',man:2,base:0,ang:0,rel:3,dz:0,y:BALL_R,view:'side',mv:null,A:null,T:0,t:0,play:false,spd:.25,loop:false,hit:null,
  ghost:true,trail:true,figs:true,allMen:false,r:null,ball:null,ov:[],gh:[],tr:null,win:[],tags:[]}};
const FE_ROLES=['MID','ATT','DEF','GK'],FE_PANEL=400;

function feOn(){return !!(typeof CONFIG!=='undefined'&&CONFIG.debug&&CONFIG.debug.figEditor);}
function feModels(){return CONFIG.playerModel.models;}
function feModel(id){return feModels().find(m=>m.id===id);}
// the rodY in force: an entry with none sits its base at playerH, i.e. the rod -playerH/scale up the model
function feRodY(am){return am.rodY!=null?am.rodY:-PLAYER_H/am.scale;}
function feChanged(id){const am=feModel(id),o=FE.org[id];return !!(am&&o&&(am.scale!==o.scale||am.rodY!==o.rodY));}
// the physics foot box's sole at rest: where every figurine's feet belong
function feFeetY(){return ROD_H-ARM*FOOT_T-FOOT_BOX_OFF.x-FOOT_BOX.x;}

// --- open / close ---
function figEd(){
 if(!feOn()){if(typeof toast==='function')toast('FIGURINE SIZER','set CONFIG.debug.figEditor = true',2.2);return;}
 if(FE.on){feExit();return;}
 if(S.phase!=='menu'||S.redit||S.photo||!rods.length){if(typeof toast==='function')toast('FIGURINE SIZER','open it from the menus',2.2);return;}
 feEnter();
}
function feEnter(){
 FE.on=true;S.figEd=FE;FE.stage=null;
 for(const m of feModels())if(!FE.org[m.id])FE.org[m.id]={scale:m.scale,rodY:m.rodY};
 if(!FE.sel.size){FE.sel.add(activeModel(0).id);FE.sel.add(activeModel(1).id);}
 if(!FE.cur||!feModel(FE.cur))FE.cur=[...FE.sel][0];
 FE.stash={fov:camera.fov,near:camera.near,pos:camera.position.clone(),quat:camera.quaternion.clone(),
  rods:rods.map(r=>({vis:r.pivot.visible,a:r.pivot.rotation.z,z:r.pivot.position.z,men:r.men.map(m=>({v:m.visible,y:m.position.y,s:m.scale.x}))})),
  balls:(S.balls||[]).map(b=>b.m.visible)};
 for(const b of S.balls||[])b.m.visible=false;
 hideScreens();
 feCSS();feBuild();FE.panel.style.display='flex';FE.lab.style.display=FE.names?'block':'none';
 feTab(FE.tab);
 if(typeof toast==='function')toast('FIGURINE SIZER','LMB orbit · RMB pan · wheel zoom · F4 exits',2.4);
}
function feExit(){
 if(!FE.on)return;
 FE.on=false;S.figEd=null;FE.drag=null;
 feClear();plClear();FE.stage=null;
 const st=FE.stash;
 rods.forEach((r,i)=>{const s=st.rods[i];if(!s)return;r.pivot.visible=s.vis;r.pivot.rotation.z=s.a;r.pivot.position.z=s.z;r.men.forEach((m,j)=>{const o=s.men[j];if(!o)return;m.visible=o.v;m.position.y=o.y;m.scale.setScalar(o.s);});});
 (S.balls||[]).forEach((b,i)=>{b.m.visible=st.balls[i]!==false;});
 camera.clearViewOffset();camera.fov=st.fov;camera.near=st.near;camera.position.copy(st.pos);camera.quaternion.copy(st.quat);camera.updateProjectionMatrix();
 FE.panel.style.display='none';FE.lab.style.display='none';
 feDispose();
 const ch=[0,1].filter(t=>feChanged(activeModel(t).id));
 if(ch.length){rebuildRodMen();if(typeof iceFitTeam==='function'&&typeof ICE!=='undefined'&&ICE.built)ch.forEach(t=>iceFitTeam(t));}
 const el=$(scrCur);if(el)el.classList.remove('hidden');
 shadowDirty();
}
// SIZER and POSE LAB each own the stage; PARAMS leaves the last one up
function feTab(k){
 FE.tab=k;
 FE.panel.querySelectorAll('[data-tabb]').forEach(b=>b.classList.toggle('on',b.dataset.tabb===k));
 FE.panel.querySelectorAll('.fTab').forEach(el=>{el.style.display=el.dataset.tab===k?'block':'none';});
 if(k==='size'&&FE.stage!=='size'){plClear();feStage();feView('side');feEdit();}
 else if(k==='lab'&&FE.stage!=='lab'){feClear();plStage();plView(FE.L.view);}
 else if(k==='par'){if(!FE.stage){plStage();plView(FE.L.view);}plParBuild();}
}

// --- figurine templates (own loads are freed on exit; the game's cached ones are only borrowed) ---
function feTpl(id){
 const T=FE.tpl[id];if(T)return T.scene;
 if(typeof modelCache!=='undefined'&&modelCache[id]){FE.tpl[id]={scene:modelCache[id],own:false};feMeasure(id);return modelCache[id];}
 FE.tpl[id]={scene:null,own:true};
 newGLTF().load(feModel(id).src,gl=>{const T2=FE.tpl[id];if(!T2||!FE.on||T2.scene)return;T2.scene=gl.scene;feMeasure(id);if(FE.stage==='size'){feStage();feEdit();}},
  undefined,()=>{const T2=FE.tpl[id];if(T2)T2.bad=true;console.warn('figurine sizer: '+id+' failed to load');feEdit();});
 return null;
}
function feMeasure(id){
 const T=FE.tpl[id];T.scene.updateMatrixWorld(true);
 const b=new THREE.Box3().setFromObject(T.scene);T.lo=b.min.y;T.hi=b.max.y;
}
// the team-0 kit on a clone (shared materials per figurine)
function feDress(id,g){
 const am=feModel(id),tp=new Set((am.teamParts||[]).map(s=>s.toLowerCase())),K=FE.kit[id]||(FE.kit[id]={});
 g.traverse(o=>{
  if(!o.isMesh)return;o.castShadow=true;
  const n=(o.material.name||'').toLowerCase();if(!tp.has(n))return;
  if(!K[n]){K[n]=o.material.clone();K[n].color.copy(kitLin(cfg.redColor));}
  o.material=K[n];
 });
 return g;
}
function feFree(root){
 const tx=['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap'];
 root.traverse(o=>{
  if(!o.isMesh)return;if(o.geometry)o.geometry.dispose();
  (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(!m)return;tx.forEach(k=>{if(m[k])m[k].dispose();});m.dispose();});
 });
}
function feDispose(){
 for(const id in FE.tpl){const T=FE.tpl[id];if(T.own&&T.scene)feFree(T.scene);}
 for(const id in FE.kit)for(const n in FE.kit[id])FE.kit[id][n].dispose();
 feGeoDrop();
 FE.tpl={};FE.kit={};
}
function feGeoDrop(){if(FE.geo){for(const k in FE.geo)if(FE.geo[k])FE.geo[k].dispose();FE.geo=null;}}

// --- stage: the shown figurines on team 0's rods (MID first), the rest of the table bare ---
function feGeo(){
 if(FE.geo)return FE.geo;
 const lm=c=>new THREE.LineBasicMaterial({color:c,transparent:true,opacity:.9,depthTest:false});
 FE.geo={box:new THREE.EdgesGeometry(footGeo(1,0)),boxB:new THREE.EdgesGeometry(footGeo(-1,0)),
  leg:feCapsule(PRAD,ARM*footLegT()),head:PHY.head?feCapsule(PHY.head.r,PHY.head.len):null,
  ball:new THREE.SphereGeometry(BALL_R,24,16),
  mBox:lm(0x3ec6ff),mLeg:lm(0xff8c3a),mRef:lm(0xF0B24A),mFeet:lm(0x7dff8a),
  mBall:new THREE.MeshStandardMaterial({color:0xe8e4da,roughness:.5})};
 return FE.geo;
}
// a wire capsule along y, centred on 0
function feCapsule(r,len){
 const p=[],n=6;
 for(let i=0;i<=n;i++){const a=-Math.PI/2+i/n*Math.PI/2;p.push(new THREE.Vector2(Math.cos(a)*r+1e-3,Math.sin(a)*r-len/2));}
 for(let i=0;i<=n;i++){const a=i/n*Math.PI/2;p.push(new THREE.Vector2(Math.cos(a)*r+1e-3,Math.sin(a)*r+len/2));}
 return new THREE.WireframeGeometry(new THREE.LatheGeometry(p,10));
}
function feRods(){return FE_ROLES.map(k=>rods.find(r=>r.team===0&&r.role===k)).filter(Boolean);}
function feClear(){
 for(const s of FE.slots){s.r.pivot.remove(s.w);for(const o of s.ov)s.r.pivot.remove(o);if(s.lab)s.lab.remove();}
 for(const o of FE.balls.concat(FE.lines))scene.remove(o);
 FE.slots=[];FE.balls=[];FE.lines=[];
}
function feStage(){
 if(!FE.on)return;
 feClear();FE.stage='size';
 const G=feGeo(),ids=feModels().filter(m=>FE.sel.has(m.id)).map(m=>m.id),rs=feRods(),per=Math.max(1,Math.floor((F.W-8)/FE.gap)+1);
 rods.forEach(r=>{r.pivot.rotation.z=0;r.pivot.position.z=0;r.men.forEach(m=>{m.visible=false;});r.pivot.visible=FE.others;});
 let k=0;
 for(const r of rs){
  const n=Math.min(per,ids.length-k);if(n<=0)break;
  r.pivot.visible=true;r.pivot.rotation.z=FE.ang;
  for(let i=0;i<n;i++,k++){
   const id=ids[k],z=(i-(n-1)/2)*FE.gap,w=new THREE.Group(),sc=feTpl(id);
   w.position.z=z;if(sc)w.add(feDress(id,sc.clone(true)));r.pivot.add(w);
   const fb=new THREE.LineSegments(r.kickDir<0?G.boxB:G.box,G.mBox),lg=new THREE.LineSegments(G.leg,G.mLeg),hd=new THREE.LineSegments(G.head||G.leg,G.mLeg);
   fb.position.set(FOOT_BOX_OFF.y*r.kickDir,-ARM*FOOT_T-FOOT_BOX_OFF.x,z);lg.position.set(0,-ARM*footLegT()/2,z);hd.position.set(0,PHY.head?PHY.head.len/2:0,z);
   fb.renderOrder=lg.renderOrder=hd.renderOrder=9;r.pivot.add(fb);r.pivot.add(lg);if(G.head)r.pivot.add(hd);
   const lab=document.createElement('div');lab.className='feLab';FE.lab.appendChild(lab);
   FE.slots.push({id,r,z,w,ov:[fb,lg,hd],lab});
   if(i===0){const b=new THREE.Mesh(G.ball,G.mBall);b.position.set(r.x+(FOOT_BOX_OFF.y+FOOT_BOX.y+BALL_R+.3)*r.kickDir,BALL_R,z);b.visible=FE.ball;b.castShadow=true;scene.add(b);FE.balls.push(b);}
  }
 }
 FE.more=ids.length-k;
 let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const s of FE.slots){x0=Math.min(x0,s.r.x);x1=Math.max(x1,s.r.x);z0=Math.min(z0,s.z);z1=Math.max(z1,s.z);}
 FE.R=FE.slots.length?Math.hypot((x1-x0)/2+7,(z1-z0)/2+5,10):30;
 feLines();feSync();
}
// the foot box sole (green) and the reference head line (gold) across the stage
function feLines(){
 for(const o of FE.lines)scene.remove(o);FE.lines=[];
 if(!FE.slots.length)return;
 const G=feGeo();let x0=1e9,x1=-1e9;for(const s of FE.slots){x0=Math.min(x0,s.r.x);x1=Math.max(x1,s.r.x);}
 const ln=(y,m)=>{const g=new THREE.BufferGeometry().setFromPoints([[x0-7,-F.W/2],[x1+7,-F.W/2],[x1+7,F.W/2],[x0-7,F.W/2]].map(p=>new THREE.Vector3(p[0],y,p[1])));
  const o=new THREE.LineLoop(g,m);o.renderOrder=9;scene.add(o);FE.lines.push(o);};
 ln(feFeetY(),G.mFeet);if(FE.refY!=null)ln(FE.refY,G.mRef);
}

// --- edits ---
function feSet(id,k,v){
 const am=feModel(id);if(!am||!isFinite(v))return;
 if(am.rodY==null)am.rodY=+feRodY(am).toFixed(3);   // freeze the rod point first, so a scale grows about it
 am[k]=k==='scale'?Math.max(.05,+v.toFixed(4)):+v.toFixed(3);
}
function feTargets(){return FE.bulk?FE.slots.map(s=>s.id):[FE.cur];}
function feAct(a){
 const ids=feTargets();
 for(const id of ids){
  const am=feModel(id),T=FE.tpl[id];if(!am)continue;
  if(a==='reset'){const o=FE.org[id];am.scale=o.scale;if(o.rodY==null)delete am.rodY;else am.rodY=o.rodY;continue;}
  if(!T||T.lo==null)continue;
  const ry=feRodY(am),ft=feFeetY();
  if(a==='fit'&&ry>T.lo){feSet(id,'rodY',ry);feSet(id,'scale',(ROD_H-ft)/(ry-T.lo));}
  if(a==='head'&&FE.refY!=null&&T.hi>ry){feSet(id,'rodY',ry);feSet(id,'scale',(FE.refY-ROD_H)/(T.hi-ry));}
  if(a==='both'&&FE.refY!=null&&FE.refY>ft){const s=(FE.refY-ft)/(T.hi-T.lo);feSet(id,'scale',s);feSet(id,'rodY',T.lo+(ROD_H-ft)/s);}
 }
 if(a==='ref'){const am=feModel(FE.cur),T=FE.tpl[FE.cur];if(am&&T&&T.hi!=null){FE.refY=ROD_H+figY(am)+am.scale*T.hi;feLines();}}
 feSync();feEdit();
}
function feSync(){
 for(const s of FE.slots){
  const am=feModel(s.id),T=FE.tpl[s.id];
  const vis=!FE.solo||s.id===FE.cur;
  s.w.position.y=figY(am);s.w.scale.setScalar(am.scale);s.w.visible=vis;s.ov[0].visible=FE.box&&vis;s.ov[1].visible=s.ov[2].visible=FE.leg&&vis;
  s.lab.textContent=am.name+(feChanged(s.id)?' *':'')+(T&&T.hi!=null?'  '+(am.scale*(T.hi-T.lo)).toFixed(1):T&&T.bad?'  failed':'  loading');
  s.lab.classList.toggle('cur',s.id===FE.cur);
 }
 feList();feRead();shadowDirty();
}

// ===== POSE LAB: one team-0 rod, its real figurines, a ball placed exactly, every pose and swing the game plays =====
// angles are rod-local (team 0: + = leg forward toward the goal it attacks); the ball never moves: red marks where the foot meets it
const PL_POSES=[
 {l:'REST',g:()=>0,c:0x9aa6bb},
 {l:'RAISE',g:()=>KICK.raiseA,c:0xff8c3a},
 {l:'BACK PIN',g:()=>SHOT.pin.angle,c:0x3ec6ff},
 {l:'STICK BAND lo',g:()=>SHOT.pin.band[0],c:0x2a7fb0},
 {l:'STICK BAND hi',g:()=>SHOT.pin.band[1],c:0x2a7fb0},
 {l:'FWD PIN',g:()=>SHOT.pin.fwd.angle,c:0xff7ad1},
 {l:'RECEIVE',g:()=>AIC.catch.recv.angle,c:0xc58bff},
 {l:'LIFT OFF',g:()=>AIC.catch.recv.lift.angle,c:0xb0ff6a},
 {l:'SAFE RAISE',g:()=>AIC.safeRaise.angle,c:0xffd75a},
 {l:'SAFE BEHIND',g:()=>AIC.safeRaise.angleBehind,c:0xe0a030},
 {l:'STICK FULL',g:()=>KICK.stickA,c:0xff9a5c},
 {l:'SHOOT END',g:()=>SWINGS.shoot.strikeA,c:0xff5c5c}
];
// worked out by ai.js for the ball where it lies; null = no pose does it
const PL_BALLP=[
 {l:'ON TOP back',g:L=>footAngle(L.rel,false,L.dz,L.y)},
 {l:'ON TOP fwd',g:L=>footAngle(L.rel,true,L.dz,L.y)},
 {l:'SIDE back',g:L=>sideAngle(L.rel,false)},
 {l:'SIDE fwd',g:L=>sideAngle(L.rel,true)},
 {l:'HIT (side face)',g:L=>hitAngle(L.rel)}
];
// swings play the game's own curves (rods.js swingA / snakeA); poses ease like updateRods (lerp a step at a time); no backLimit here
const PL_MOVES=[
 {l:'PASS',c:()=>SWINGS.pass},
 {l:'SHOOT',c:()=>SWINGS.shoot},
 {l:'PIN SHOT',c:()=>SWINGS.pinShot},
 {l:'PIN PASS',c:()=>SWINGS.pinPass},
 {l:'SNAKE',snake:true,c:()=>SWINGS.snake},
 {l:'RAISE',to:()=>KICK.raiseA,k:()=>KICK.raiseLerp},
 {l:'DROP',to:()=>0,k:()=>KICK.dropLerp},
 {l:'BACK PIN',to:()=>SHOT.pin.angle,k:()=>SHOT.pin.lerp},
 {l:'FWD PIN',to:()=>SHOT.pin.fwd.angle,k:()=>SHOT.pin.fwd.lerp},
 {l:'RECEIVE (player)',to:()=>AIC.catch.recv.angle,k:()=>SHOT.pin.assist.recv.lerp},
 {l:'LIFT OFF',to:()=>AIC.catch.recv.lift.angle,k:()=>SHOT.pin.fwd.lerp},
 {l:'SAFE RAISE',to:()=>AIC.safeRaise.angle,k:()=>srLerp(FE.L.r)},
 {l:'SAFE BEHIND',to:()=>AIC.safeRaise.angleBehind,k:()=>srLerp(FE.L.r)}
];
const PL_R={x:0,kickDir:1,angle:0},PL_P={x:0,y:0,z:0},PL_DN=[0,0],PL_Q=new Float64Array(8),PL_WHO={box:'foot box',leg:'leg',head:'head'};
function plNum(f){try{const v=f(FE.L);return typeof v==='number'&&isFinite(v)?v:null;}catch(e){return null;}}
function plMz(){return FE.L.r.baseZ[FE.L.man];}
function plP(){const L=FE.L;PL_P.x=L.r.x+L.rel;PL_P.y=L.y;PL_P.z=plMz()+L.dz;return PL_P;}
function plFake(a){PL_R.x=FE.L.r.x;PL_R.angle=a;return PL_R;}
// the foot's section at angle a in the rod's plane (x along the table from the pivot, y up from it): top heel, top toe, sole toe, sole heel
function plSec(a,o){
 const q=footQuad(),cx=FOOT_BOX_OFF.y,cy=-ARM*FOOT_T-FOOT_BOX_OFF.x,s=Math.sin(a),c=Math.cos(a);
 for(let i=0;i<4;i++){const x=cx+q[i*2+1],y=cy-q[i*2];o[i*2]=x*c-y*s;o[i*2+1]=x*s+y*c;}
 return o;
}
// leg and head capsule gaps (collideRod's own segments); < 0 = touching
function plGaps(a,p,mz){
 const sa=Math.sin(a),ca=Math.cos(a),dx=sa*ARM,dy=-ca*ARM,wx=p.x-FE.L.r.x,wy=p.y-ROD_H,wz=p.z-mz,t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,footLegT());
 const leg=Math.hypot(wx-dx*t,wy-dy*t,wz)-BALL_R-PRAD,HD=PHY.head;
 if(!HD)return {leg,head:1e9};
 const hx=-dx*HD.len/ARM,hy=-dy*HD.len/ARM,th=clamp((wx*hx+wy*hy)/(HD.len*HD.len),0,1);
 return {leg,head:Math.hypot(wx-hx*th,wy-hy*th,wz)-BALL_R-HD.r};
}
function plTouch(a){
 const p=plP(),mz=plMz();
 if(footBoxD(plFake(a),p,mz,PL_DN)<=BALL_R*FOOT_BOX_REACH)return 'box';
 const g=plGaps(a,p,mz);return g.leg<=0?'leg':g.head<=0?'head':null;
}
// the loaded move at sim steps from the start angle, and its first touch (8 poses a step: physics poses the rod per substep)
function plBake(){
 const L=FE.L,M=L.mv;L.A=null;L.hit=null;L.T=0;if(!M)return;
 const dt=1/SIM.hz,A=[L.base];
 if(M.to){const to=M.to(),k=M.k();let a=L.base;for(let i=0;i<SIM.hz*1.5&&Math.abs(a-to)>1e-4;i++){a=lerp(a,to,Math.min(1,k*dt));A.push(a);}}
 else{const KS=M.c(),f=M.snake?snakeA:swingA;for(let i=1;i<SIM.hz*2;i++){const a=f(KS,i*dt,L.base);if(a==null)break;A.push(a);}A.push(M.snake?2*Math.PI:0);}
 L.A=A;L.T=(A.length-1)*dt;L.t=clamp(L.t,0,L.T);
 for(let i=0;i<A.length-1&&!L.hit;i++)for(let j=0;j<8;j++){const a=lerp(A[i],A[i+1],j/8),w=plTouch(a);if(w){L.hit={t:(i+j/8)*dt,a,w,av:(A[i+1]-A[i])/dt};break;}}
}
function plAt(t){
 const L=FE.L,A=L.A;if(!A||A.length<2)return L.base;
 const k=clamp(t*SIM.hz,0,A.length-1),i=Math.min(A.length-2,Math.floor(k));return lerp(A[i],A[i+1],k-i);
}
function plClear(){
 const L=FE.L;
 for(const o of L.ov)if(o.parent)o.parent.remove(o);
 for(const o of L.gh.concat(L.win)){if(o.parent)o.parent.remove(o);o.geometry.dispose();o.material.dispose();}
 if(L.tr){scene.remove(L.tr);L.tr.geometry.dispose();L.tr.material.dispose();}
 if(L.ball){scene.remove(L.ball);L.ball.geometry.dispose();L.ball.material.dispose();}
 for(const t of L.tags)t.el.remove();
 L.ov=[];L.gh=[];L.win=[];L.tags=[];L.tr=null;L.ball=null;
}
function plStage(){
 if(!FE.on)return;
 plClear();FE.stage='lab';FE.R=9;
 const L=FE.L,r=rods.find(q=>q.team===0&&q.role===L.role)||rods.find(q=>q.team===0);L.r=r;
 L.man=clamp(L.man|0,0,r.men.length-1);
 rods.forEach(q=>{q.pivot.rotation.z=0;q.pivot.position.z=0;q.men.forEach(m=>{m.visible=false;});q.pivot.visible=q===r||FE.others;});
 L.ball=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,32,20),new THREE.MeshStandardMaterial({color:0xe8e4da,roughness:.5}));L.ball.castShadow=true;scene.add(L.ball);
 plRefresh();
 FE.panel.querySelectorAll('[data-role]').forEach(b=>b.classList.toggle('on',b.dataset.role===r.role));
}
function plLineMat(c,o){return new THREE.LineBasicMaterial({color:c,transparent:true,opacity:o,depthTest:false,vertexColors:c==null});}
// everything a number can move: the wire shapes, the ghost poses, the pin windows, the move and its trail
function plRefresh(){
 const L=FE.L,r=L.r;if(FE.stage!=='lab'||!r)return;
 for(const o of L.ov)r.pivot.remove(o);
 for(const o of L.gh.concat(L.win)){if(o.parent)o.parent.remove(o);o.geometry.dispose();o.material.dispose();}
 for(const t of L.tags)t.el.remove();
 L.ov=[];L.gh=[];L.win=[];L.tags=[];
 const G=feGeo(),mz=plMz(),pv=r.pivot.position;
 const fb=new THREE.LineSegments(G.box,G.mBox),lg=new THREE.LineSegments(G.leg,G.mLeg),hd=G.head?new THREE.LineSegments(G.head,G.mLeg):null;
 fb.position.set(FOOT_BOX_OFF.y,-ARM*FOOT_T-FOOT_BOX_OFF.x,mz);lg.position.set(0,-ARM*footLegT()/2,mz);
 L.ov.push(fb,lg);if(hd){hd.position.set(0,PHY.head.len/2,mz);L.ov.push(hd);}
 for(const o of L.ov){o.renderOrder=9;r.pivot.add(o);}
 if(L.ghost){
  const q=plSec(0,PL_Q),pt=[];
  for(let i=0;i<4;i++){const j=(i+1)&3;pt.push(q[i*2],q[i*2+1],mz,q[j*2],q[j*2+1],mz);}
  pt.push(0,0,mz,0,-ARM*footLegT(),mz);
  for(const P of PL_POSES){
   const a=plNum(P.g);if(a==null)continue;
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pt,3));
   const o=new THREE.LineSegments(g,plLineMat(P.c,.6));o.position.set(pv.x,pv.y,0);o.rotation.z=a;o.renderOrder=8;scene.add(o);L.gh.push(o);
   const s=plSec(a,PL_Q),el=document.createElement('div');el.className='feLab plTag';el.textContent=P.l;el.style.color='#'+('00000'+P.c.toString(16)).slice(-6);FE.lab.appendChild(el);
   L.tags.push({el,v:new THREE.Vector3(pv.x+s[4],pv.y+s[5],mz)});
  }
 }
 const P=SHOT.pin,wl=(lo,hi,c)=>{const g=new THREE.BufferGeometry(),y=.06,x0=r.x+lo,x1=r.x+hi;
  g.setAttribute('position',new THREE.Float32BufferAttribute([x0,y,mz,x1,y,mz,x0,y,mz-1.2,x0,y,mz+1.2,x1,y,mz-1.2,x1,y,mz+1.2],3));
  const o=new THREE.LineSegments(g,plLineMat(c,.95));o.renderOrder=9;scene.add(o);L.win.push(o);};
 wl(P.back,P.front,0x3ec6ff);wl(P.fwdBack,P.fwdFront,0xff7ad1);
 plBake();plTrail();plPoseGrid();plPose();
}
// a foot outline every sim step of the move; red where it meets the ball
function plTrail(){
 const L=FE.L;
 if(L.tr){scene.remove(L.tr);L.tr.geometry.dispose();L.tr.material.dispose();L.tr=null;}
 if(!L.trail||!L.A||FE.stage!=='lab')return;
 const pv=L.r.pivot.position,mz=plMz(),ps=[],cs=[];
 for(const a of L.A){
  const q=plSec(a,PL_Q),hit=!!plTouch(a),c=hit?[1,.25,.2]:[.25,.6,.9];
  for(let i=0;i<4;i++){const j=(i+1)&3;ps.push(pv.x+q[i*2],pv.y+q[i*2+1],mz,pv.x+q[j*2],pv.y+q[j*2+1],mz);cs.push(...c,...c);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cs,3));
 L.tr=new THREE.LineSegments(g,plLineMat(null,.55));L.tr.renderOrder=8;scene.add(L.tr);
}
// the per-frame half: rod angle, men, ball, readout
function plPose(){
 const L=FE.L,r=L.r;if(FE.stage!=='lab'||!r)return;
 if(!L.mv)L.ang=L.base;
 r.pivot.rotation.z=L.ang;
 const am=activeModel(r.team);   // the sizer's numbers, live (a sizer edit reaches the match men on exit)
 r.men.forEach((m,i)=>{m.visible=L.figs&&(L.allMen||i===L.man);if(playerModel[r.team]){m.position.y=figY(am);m.scale.setScalar(am.scale);}});
 for(const o of L.ov)o.visible=o.material===feGeo().mBox?FE.box:FE.leg;
 for(const o of L.gh)o.visible=L.ghost;
 for(const t of L.tags)t.on=L.ghost&&FE.names;
 const p=plP(),w=plTouch(L.ang);
 L.ball.position.set(p.x,p.y,p.z);
 const holds=plPinWhy(L.ang).length===0;
 L.ball.material.color.setHex(holds?0x6aff8a:w?0xff6a5a:0xe8e4da);
 L.win[0].visible=L.ang<=0;L.win[1].visible=L.ang>0;
 plRead();plInputs();shadowDirty();
}
// why pinUpdate would not hold the ball at angle a (empty = it holds, once posed and slow)
function plPinWhy(a){
 const L=FE.L,P=SHOT.pin,p=plP(),mz=plMz(),fwd=a>0,lo=fwd?P.fwdBack:P.back,hi=fwd?P.fwdFront:P.front,w=[];
 const d=footBoxD(plFake(a),p,mz,PL_DN),need=PL_DN[1]>0?P.wallDown:P.down;
 if(L.rel<lo||L.rel>hi)w.push('outside the '+(fwd?'forward':'back')+' window '+lo+'..'+hi);
 if(L.y>BALL_R+P.yTol)w.push('off the floor');
 if(Math.abs(p.z-mz)>pinSideReach(p))w.push('off the man');
 else if(d<=1e-4)w.push('centre inside the box');
 else if(d>BALL_R*FOOT_BOX_REACH+P.touch)w.push('foot not touching');
 else if(PL_DN[0]<need)w.push('not from above ('+PL_DN[0].toFixed(2)+' < '+need+')');
 return w;
}
function plRead(){
 const el=FE.panel&&FE.panel.querySelector('.plRead');if(!el)return;
 const L=FE.L,r=L.r,a=L.ang,p=plP(),mz=plMz(),P=SHOT.pin,f2=x=>(x>=0?' ':'')+x.toFixed(2);
 const why=plPinWhy(a),d=footBoxD(plFake(a),p,mz,PL_DN),gap=d-BALL_R*FOOT_BOX_REACH,g=plGaps(a,p,mz),q=plSec(a,PL_Q);
 let x0=1e9,x1=-1e9,y0=1e9;for(let i=0;i<4;i++){x0=Math.min(x0,q[i*2]);x1=Math.max(x1,q[i*2]);y0=Math.min(y0,q[i*2+1]);}
 const t=['angle  '+f2(a)+' rad  '+f2(a*180/Math.PI)+' deg'+(L.mv?'   start '+f2(L.base):''),
  'ball   ahead '+f2(L.rel)+'  across '+f2(L.dz)+'  up '+f2(L.y),
  'foot   gap '+f2(gap)+'   from above '+f2(PL_DN[0])+'   past side '+PL_DN[1].toFixed(2),
  'leg    gap '+f2(g.leg)+(PHY.head?'   head gap '+f2(g.head):''),
  'box    ahead '+f2(x0)+' .. '+f2(x1)+'   lowest '+f2(ROD_H+y0)+' over pitch',
  'pin    '+(why.length?'no: '+why.join(', '):'HOLDS ('+(a>0?'forward':'back')+')')+'   stick band '+(a>=P.band[0]&&a<=P.band[1]?'yes':'no')];
 if(L.mv&&L.A){
  const dt=1/SIM.hz,i=Math.min(L.A.length-2,Math.floor(L.t*SIM.hz)),w=L.A.length>1?(L.A[i+1]-L.A[i])/dt:0,H=L.hit;
  t.push('move   '+L.mv.l+'   t '+L.t.toFixed(3)+' / '+L.T.toFixed(3)+' s   step '+Math.round(L.t*SIM.hz)+'/'+(L.A.length-1)+'   '+f2(w)+' rad/s');
  t.push(H?'touch  '+(H.t===0?'at the start':'t '+H.t.toFixed(4)+' s')+' by the '+PL_WHO[H.w]+' at '+f2(H.a)+'  '+f2(H.av)+' rad/s ~'+Math.abs(H.av*Math.hypot(p.x-r.x,p.y-ROD_H)).toFixed(0)+' u/s at the ball':'touch  none: the move misses the ball');
 }
 el.textContent=t.join('\n');
}
function plPoseGrid(){
 const el=FE.panel&&FE.panel.querySelector('.plPoses');if(!el)return;
 const hx=c=>'#'+('00000'+c.toString(16)).slice(-6),b=(l,v,c)=>'<button'+(v==null?' disabled':' data-pose="'+v+'"')+' title="'+l+(v==null?': no pose does it':' = '+v.toFixed(4))+'"><i style="background:'+c+'"></i>'+l+'<b>'+(v==null?'-':v.toFixed(3))+'</b></button>';
 el.innerHTML=PL_POSES.map(P=>b(P.l,plNum(P.g),hx(P.c))).join('')+PL_BALLP.map(P=>b(P.l,plNum(P.g),'transparent')).join('');
}
function plInputs(skip){
 const L=FE.L,p=FE.panel;if(!p)return;
 p.querySelectorAll('[data-l]').forEach(el=>{if(el!==skip&&document.activeElement!==el)el.value=(+L[el.dataset.l]).toFixed(el.type==='range'?3:el.dataset.l==='base'?3:2);});
 const sc=p.querySelector('[data-tp=scrub]');if(sc)sc.value=L.T>0?L.t/L.T:0;
 const pb=p.querySelector('[data-tp=p]');if(pb)pb.textContent=L.play?'PAUSE':'PLAY';
 const mv=p.querySelector('[data-manv]');if(mv&&L.r)mv.textContent=(L.man+1)+' / '+L.r.men.length;
 p.querySelectorAll('[data-mv]').forEach(b=>b.classList.toggle('on',L.mv===PL_MOVES[+b.dataset.mv]));
}
function plSetBase(v){const L=FE.L;L.base=clamp(+(+v).toFixed(4),-3.2,3.2);L.t=0;L.play=false;plBake();plTrail();plPose();}
function plBallSet(k,v){const L=FE.L;v=+(+v).toFixed(4);if(!isFinite(v))return;L[k]=k==='y'?Math.max(0,v):k==='dz'?clamp(v,-F.W,F.W):clamp(v,-40,40);plBake();plTrail();plPoseGrid();plPose();}
function plMove(i){const L=FE.L;L.mv=PL_MOVES[i]||null;L.t=0;plBake();L.play=!!L.mv;plTrail();plPose();}
function plStep(n){const L=FE.L;if(!L.A)return;L.play=false;L.t=clamp((Math.round(L.t*SIM.hz)+n)/SIM.hz,0,L.T);L.ang=plAt(L.t);plPose();}
// slide the ball along the table from far ahead (s 1) or behind (-1) until the foot, leg or head meets it at the angle shown
function plTouchFrom(s){
 const L=FE.L,a=L.ang;let v=s*14;L.rel=v;
 if(plTouch(a)){toast('POSE LAB','already touching out there',1.4);return;}
 while(s*v>-14){v-=s*.005;L.rel=v;if(plTouch(a))break;}
 if(s*v<=-14){L.rel=s*3;toast('POSE LAB','nothing meets the ball along this line',1.4);}
 else L.rel=+(v+s*.005).toFixed(3);
 plBallSet('rel',L.rel);
}
function plView(k){
 const C=FE.cam,L=FE.L,r=L.r;if(!r)return;L.view=k;
 C.tx=r.x+1.5;C.tz=plMz();C.ty=ROD_H*.6;
 const asp=Math.max(.5,((FE.vw||innerWidth)-FE_PANEL)/(FE.vh||innerHeight)),fit=(hw,hh,fov)=>{C.fov=fov;C.dist=Math.max(hw/asp,hh)/Math.tan(fov*Math.PI/360)*1.1;};
 if(k==='side'){C.yaw=0;C.pitch=0;fit(11,7,8);}
 else if(k==='front'){C.yaw=Math.PI/2;C.pitch=.04;fit(7,7,10);}
 else if(k==='top'){C.yaw=0;C.pitch=1.5;C.ty=0;fit(11,8,10);}
 else{C.yaw=.7;C.pitch=.32;fit(9,7,22);}
}
// a click on the stage puts the ball there: along the table (and up, with Shift) looking from the side, across the table from above
function plClick(cx,cy,sh){
 const L=FE.L,r=L.r;if(!r)return;
 const rc=new THREE.Raycaster();rc.setFromCamera({x:cx/innerWidth*2-1,y:-(cy/innerHeight*2-1)},camera);
 const C=FE.cam,side=Math.abs(Math.cos(C.yaw)*Math.cos(C.pitch))>.6,mz=plMz(),h=new THREE.Vector3(),sn=v=>Math.round(v*20)/20;
 const pl=side?new THREE.Plane(new THREE.Vector3(0,0,1),-(mz+L.dz)):new THREE.Plane(new THREE.Vector3(0,1,0),-L.y);
 if(!rc.ray.intersectPlane(pl,h))return;
 L.rel=sn(h.x-r.x);if(side){if(sh)L.y=Math.max(BALL_R,sn(h.y));}else L.dz=sn(h.z-mz);
 plBallSet('rel',L.rel);
}
function plTick(dt){
 const L=FE.L;
 if(L.play&&L.A){L.t+=dt*L.spd;if(L.t>=L.T){if(L.loop)L.t=0;else{L.t=L.T;L.play=false;}}L.ang=plAt(L.t);plPose();}
}
// lab keys (not while typing in a field): Shift x10, Alt / Ctrl x0.1
function plKey(e){
 const t=e.target,L=FE.L;if(t&&/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)&&t.type!=='checkbox'&&t.type!=='range')return false;
 const m=e.shiftKey?10:(e.altKey||e.ctrlKey)?.1:1;
 switch(e.code){
  case 'ArrowLeft':plSetBase(L.base-.01*m);return true;
  case 'ArrowRight':plSetBase(L.base+.01*m);return true;
  case 'ArrowUp':plBallSet('rel',L.rel+.1*m);return true;
  case 'ArrowDown':plBallSet('rel',L.rel-.1*m);return true;
  case 'PageUp':plBallSet('dz',L.dz+.1*m);return true;
  case 'PageDown':plBallSet('dz',L.dz-.1*m);return true;
  case 'Space':if(L.A){if(!L.play&&L.t>=L.T)L.t=0;L.play=!L.play;plPose();}return true;
  case 'Comma':plStep(-1);return true;
  case 'Period':plStep(1);return true;
  case 'Home':plStep(-1e6);return true;
 }
 return false;
}

// ===== PARAMS: every number behind the poses, live; COPY gives config.js lines =====
// a path ending '!' shows only its own numbers, not the blocks inside it
const PL_GROUPS=[
 ['FOOT BOX + LEG',['physics.footBox','physics.footBoxOff','physics.footTaper','physics.head','physics.footBoxReach','physics.footT','physics.arm','physics.prad']],
 ['SWINGS',['swings']],
 ['BACK PIN',['shots.pin!','shots.pin.press']],
 ['FORWARD PIN + ASSIST',['shots.pin.fwd','shots.pin.assist']],
 ['SNAKE',['shots.snake']],
 ['SQUARE',['shots.square']],
 ['KICK CONTACT + TRIMS',['kick!','shots.mod']],
 ['RECEIVE + LIFT',['ai.catch.recv']],
 ['SAFE RAISE',['ai.safeRaise']],
 ['FETCH / UNDER',['ai.catch.fetch','ai.catch.under']],
 ['SIDE / HIT / TIC-TAC',['ai.catch.side','ai.catch.hit','ai.catch.tictac']],
 ['RETRIEVE + SWEEP',['ai.retrieve','ai.sweep']],
 ['BACK GUARD + HELD',['ai.backGuard','ai.heldFwd']]
];
// copied into consts at load (config.js aliases): the game never sees a live edit
const PL_BOOT=new Set(['physics.ballR','physics.rodH','physics.playerH','physics.arm','physics.prad','physics.grav','physics.footT','physics.footBoxReach','physics.footJitter']);
function plGet(path){let o=CONFIG;for(const k of path.split('.')){if(o==null)return undefined;o=o[k];}return o;}
function plLeaf(v){return typeof v==='number'||typeof v==='boolean'||(Array.isArray(v)&&v.length>0&&v.length<=6&&v.every(x=>typeof x==='number'));}
function plFmt(x){return String(+(+x).toFixed(4));}
function plTxt(v){return Array.isArray(v)?'['+v.map(plFmt).join(',')+']':typeof v==='number'?plFmt(v):String(v);}
function plEq(a,b){return Array.isArray(a)?Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]):a===b;}
function plChg(path){return path in FE.pOrg&&!plEq(plGet(path),FE.pOrg[path]);}
function plPRow(path,full){
 const v=plGet(path),k=full?path:path.slice(path.lastIndexOf('.')+1),boot=PL_BOOT.has(path);
 let h='<div class="pRow'+(plChg(path)?' chg':'')+(boot?' boot':'')+'" data-p="'+path+'"><span class="pK">'+k+'</span>';
 if(typeof v==='boolean')h+='<input type="checkbox" data-pv'+(v?' checked':'')+'>';
 else (Array.isArray(v)?v:[v]).forEach((x,i)=>{h+='<button data-pd="-1" data-i="'+i+'"'+(boot?' disabled':'')+'>-</button><input type="number" step="any" data-pv data-i="'+i+'" value="'+plFmt(x)+'"'+(boot?' disabled':'')+'><button data-pd="1" data-i="'+i+'"'+(boot?' disabled':'')+'>+</button>';});
 return h+'<button data-pr title="back to config.js">R</button></div>';
}
function plTree(path,shallow,depth){
 const o=plGet(path);if(o==null)return '';
 if(plLeaf(o))return plPRow(path);
 if(typeof o!=='object')return '';
 let h='';const subs=[];
 for(const k in o){const v=o[k],p=path+'.'+k;if(plLeaf(v))h+=plPRow(p);else if(!shallow&&v&&typeof v==='object'&&!Array.isArray(v)&&depth<5)subs.push(p);}
 for(const p of subs){const s=plTree(p,false,depth+1);if(s)h+='<div class="pSub"><div class="pSubH">'+p.slice(p.lastIndexOf('.')+1)+'</div>'+s+'</div>';}
 return h;
}
function plGroup(paths){return paths.map(p=>{const sh=p.endsWith('!'),q=sh?p.slice(0,-1):p,v=plGet(q);return v==null?'':plLeaf(v)?plPRow(q):'<div class="pSubH">CONFIG.'+q+'</div>'+plTree(q,sh,0);}).join('');}
function plParBuild(){
 const g=FE.panel.querySelector('.pGroups');if(!g||g.dataset.built)return;
 g.dataset.built='1';
 g.innerHTML=PL_GROUPS.map(G=>'<details><summary>'+G[0]+'</summary>'+plGroup(G[1])+'</details>').join('');
 if(!FE.src&&typeof fetch==='function')fetch('js/config.js').then(r=>r.ok?r.text():null).then(t=>{FE.src=t;}).catch(()=>{});
}
function plSearch(q){
 const t=q.toLowerCase().split(/\s+/).filter(Boolean),out=[];if(!t.length)return out;
 const walk=(o,p,d)=>{if(out.length>=150||d>8)return;for(const k in o){const v=o[k],pp=p?p+'.'+k:k;if(plLeaf(v)){const s=pp.toLowerCase();if(t.every(x=>s.indexOf(x)>=0))out.push(pp);}else if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,pp,d+1);}};
 walk(CONFIG,'',0);return out;
}
// the comment on a key's line in config.js (each path segment searched for after the last)
function plSrcTip(path){
 const s=FE.src;if(!s)return '';
 let pos=Math.max(0,s.indexOf('const CONFIG'));
 for(const k of path.split('.')){const re=new RegExp('(^|[\\s{,])'+k+'\\s*:','g');re.lastIndex=pos;const m=re.exec(s);if(!m)return '';pos=m.index+m[0].length;}
 const e=s.indexOf('\n',pos),ln=s.slice(pos,e<0?undefined:e),c=ln.indexOf('//');
 return c>=0?ln.slice(c+2).trim():'';
}
function plSetPath(path,i,val){
 const j=path.lastIndexOf('.'),o=plGet(path.slice(0,j)),k=path.slice(j+1);if(!o)return;
 if(!(path in FE.pOrg)){const v=o[k];FE.pOrg[path]=Array.isArray(v)?v.slice():v;}
 if(Array.isArray(o[k])){if(Array.isArray(val))o[k].splice(0,o[k].length,...val);else o[k][i]=val;}else o[k]=val;
}
function plStepOf(path,i){
 const o=path in FE.pOrg?FE.pOrg[path]:plGet(path),x=Array.isArray(o)?o[i]:o;
 if(Number.isInteger(x)&&Math.abs(x)>=2)return 1;
 const dec=(String(x).split('.')[1]||'').length;return Math.pow(10,-clamp(dec,2,3));
}
function plSyncRows(path){
 const v=plGet(path),c=plChg(path);
 FE.panel.querySelectorAll('.pRow').forEach(row=>{
  if(row.dataset.p!==path)return;
  row.classList.toggle('chg',c);
  row.querySelectorAll('[data-pv]').forEach(el=>{if(el.type==='checkbox')el.checked=!!v;else if(document.activeElement!==el)el.value=plFmt(Array.isArray(v)?v[+el.dataset.i]:v);});
 });
}
function plParamChanged(path){
 plSyncRows(path);
 if(path.startsWith('physics.'))feGeoDrop();
 if(FE.stage==='size'){if(path.startsWith('physics.')){feStage();}}
 else plRefresh();
}
function plCopy(){
 const g={};
 for(const p in FE.pOrg){if(!plChg(p))continue;const i=p.lastIndexOf('.');(g[p.slice(0,i)]=g[p.slice(0,i)]||[]).push(p.slice(i+1)+':'+plTxt(plGet(p)));}
 const ks=Object.keys(g),txt=ks.length?ks.map(k=>'// CONFIG.'+k+'\n'+g[k].join(', ')).join('\n'):'// nothing changed';
 console.log('%c[POSE LAB]','color:#F0B24A;font-weight:bold','\n'+txt);
 const c=navigator.clipboard;if(c&&c.writeText)c.writeText(txt).catch(()=>{});
 toast('POSE LAB',ks.length?'changes copied to the clipboard and the console':'nothing changed',1.6);
}
function plResetAll(){
 const ps=Object.keys(FE.pOrg);
 for(const p of ps){const o=FE.pOrg[p];plSetPath(p,0,Array.isArray(o)?o.slice():o);plSyncRows(p);}
 feGeoDrop();if(FE.stage==='size')feStage();else plRefresh();
}

// --- panel ---
function feCSS(){
 if(FE.css)return;FE.css=true;
 const s=document.createElement('style');
 s.textContent=[
 '.fePanel{position:fixed;top:12px;left:12px;width:'+(FE_PANEL-24)+'px;max-height:calc(100vh - 24px);overflow-y:auto;display:none;flex-direction:column;',
 ' background:rgba(10,12,18,.94);border:1px solid rgba(240,178,74,.3);border-radius:4px;padding:9px 11px;z-index:60;font:11.5px/1.45 "Exo 2",system-ui,sans-serif;color:#cfe0ff}',
 '.fePanel h4{margin:9px 0 5px;font:12px/1 var(--font-ui),sans-serif;color:#F0B24A;letter-spacing:.14em;border-top:1px solid rgba(240,178,74,.2);padding-top:8px}',
 '.fePanel h4:first-child{border-top:0;margin-top:0;padding-top:0}',
 '.fePanel .fHelp,.fePanel .fNote{color:#8fa4c8;font-size:11.5px}',
 '.fePanel .fRow{display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap}',
 '.fePanel .fRow>span:first-child{flex:0 0 74px;color:#8fa4c8}',
 '.fePanel input[type=range]{flex:1;min-width:60px;accent-color:#F0B24A}',
 '.fePanel input[type=number]{width:62px;background:#141a26;color:#e8f0ff;border:1px solid #33405a;border-radius:3px;padding:1px 4px;font:inherit}',
 '.fePanel input[type=text]{width:100%;box-sizing:border-box;background:#141a26;color:#e8f0ff;border:1px solid #33405a;border-radius:3px;padding:3px 6px;font:inherit}',
 '.fePanel select{background:#141a26;color:#e8f0ff;border:1px solid #33405a;border-radius:3px;font:inherit}',
 '.fePanel .v{width:36px;text-align:right;color:#cfe0ff}',
 '.fePanel button{background:#1a2234;color:#cfe0ff;border:1px solid #3a4a6a;border-radius:3px;padding:3px 8px;font:11px/1.2 var(--font-ui),sans-serif;letter-spacing:.1em;cursor:pointer}',
 '.fePanel button:hover{border-color:#F0B24A;color:#fff}',
 '.fePanel button.on{border-color:#F0B24A;color:#fff;background:#2c2818}',
 '.fePanel button:disabled{opacity:.35;cursor:default;border-color:#3a4a6a}',
 '.fePanel label{display:inline-flex;align-items:center;gap:3px;cursor:pointer}',
 '.fePanel .fTabs{display:flex;gap:4px;margin:0 0 8px}',
 '.fePanel .fTabs button{flex:1;padding:5px 4px}',
 '.fePanel .fName{font:13px/1.2 var(--font-ui),sans-serif;color:#fff;letter-spacing:.1em;margin:2px 0 4px}',
 '.fePanel .fRead{color:#aab8d4;margin:4px 0;white-space:pre;font-variant-numeric:tabular-nums}',
 '.fePanel .plRead{font:11px/1.5 Consolas,"Cascadia Mono",monospace;color:#d6e2fa;white-space:pre-wrap;background:#0d1220;border:1px solid #232d44;border-radius:3px;padding:5px 6px}',
 '.fePanel .fList{display:grid;grid-template-columns:auto 1fr auto;gap:1px 6px;align-items:center}',
 '.fePanel .fItem{cursor:pointer;padding:1px 3px;border-radius:2px}',
 '.fePanel .fItem.cur{background:rgba(240,178,74,.18);color:#fff}',
 '.fePanel .fVal{color:#8fa4c8;font-variant-numeric:tabular-nums}',
 '.fePanel .fVal.chg{color:#F0B24A}',
 '.fePanel .plPoses{display:grid;grid-template-columns:1fr 1fr;gap:3px}',
 '.fePanel .plPoses button{display:flex;align-items:center;gap:5px;text-align:left;font:10.5px/1.25 "Exo 2",sans-serif;letter-spacing:0;padding:2px 5px}',
 '.fePanel .plPoses i{flex:0 0 8px;height:8px;border:1px solid #556}',
 '.fePanel .plPoses b{margin-left:auto;font-weight:600;color:#F0B24A;font-variant-numeric:tabular-nums}',
 '.fePanel .plMoves{display:flex;flex-wrap:wrap;gap:3px}',
 '.fePanel .plMoves button{font-size:10.5px;padding:3px 6px}',
 '.fePanel .pRow{display:flex;align-items:center;gap:3px;margin:1px 0}',
 '.fePanel .pRow .pK{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aab8d4}',
 '.fePanel .pRow.chg .pK{color:#F0B24A}',
 '.fePanel .pRow.boot .pK{color:#5f6f8e}',
 '.fePanel .pRow button{padding:1px 6px;font-size:10.5px;letter-spacing:0}',
 '.fePanel .pRow input[type=number]{width:60px}',
 '.fePanel .pSub{margin:2px 0 2px 6px;border-left:1px solid #2a3550;padding-left:6px}',
 '.fePanel .pSubH{color:#7f95bd;font-size:10.5px;letter-spacing:.06em;margin-top:4px}',
 '.fePanel details{margin:4px 0}',
 '.fePanel summary{cursor:pointer;color:#F0B24A;font:11.5px var(--font-ui),sans-serif;letter-spacing:.1em}',
 '.fePanel .pTip{position:sticky;bottom:-9px;background:#0a0c12;border-top:1px solid #2a3550;padding:5px 0 6px;margin-top:6px;min-height:30px;font-size:11px;color:#cfe0ff;white-space:pre-wrap}',
 '.feLabs{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:59;display:none}',
 '.feLab{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font:11.5px/1 "Exo 2",sans-serif;color:#dfe8ff;background:rgba(0,0,0,.55);padding:2px 5px;border-radius:2px}',
 '.feLab.plTag{transform:translate(4px,-50%);font-size:10.5px;background:rgba(0,0,0,.4)}',
 '.feLab.cur{color:#F0B24A;outline:1px solid rgba(240,178,74,.6)}'
 ].join('\n');
 document.head.appendChild(s);
}
function feBuild(){
 if(FE.panel)return;
 const p=document.createElement('div');p.className='fePanel';
 const tg=(k,l)=>'<label><input type="checkbox" data-t="'+k+'"'+(FE[k]?' checked':'')+'>'+l+'</label>';
 const lt=(k,l)=>'<label><input type="checkbox" data-lt="'+k+'"'+(FE.L[k]?' checked':'')+'>'+l+'</label>';
 const nb=(k,d,l)=>'<button data-nl="'+k+'" data-d="'+d+'">'+l+'</button>';
 const fld=(k,l,st,lo,hi)=>'<div class="fRow"><span>'+l+'</span>'+nb(k,-1,'-')+'<input type="number" data-l="'+k+'" step="'+st+'">'+nb(k,1,'+')+(lo!=null?'<input type="range" data-l="'+k+'" min="'+lo+'" max="'+hi+'" step="'+st+'">':'')+'</div>';
 p.innerHTML='<div class="fTabs"><button data-tabb="size">SIZER</button><button data-tabb="lab">POSE LAB</button><button data-tabb="par">PARAMS</button></div>'+
 '<div class="fTab" data-tab="size">'+
  '<h4>FIGURINE SIZER</h4>'+
  '<div class="fHelp">LMB orbit · RMB pan · wheel zoom · click a figurine to edit it · F4 / Esc exits. Edits are live until a reload: COPY and hand them over.</div>'+
  '<div class="fRow"><span>View</span><button data-v="side">SIDE</button><button data-v="front">FRONT</button><button data-v="q">3/4</button></div>'+
  '<div class="fRow">'+tg('box','Foot box')+tg('leg','Leg + head')+tg('ball','Ball')+tg('names','Names')+tg('others','Other rods')+tg('cut','Cut away walls')+tg('solo','Solo')+'</div>'+
  '<div class="fRow"><span>Rod angle</span><input type="range" data-g="ang" min="-1.6" max="1.6" step="0.01" value="'+FE.ang+'"><span class="v" data-gv="ang"></span><button data-a="ang0">0</button></div>'+
  '<div class="fRow"><span>Spacing</span><input type="range" data-g="gap" min="3" max="14" step="0.5" value="'+FE.gap+'"><span class="v" data-gv="gap"></span></div>'+
  '<h4>EDIT</h4><div class="fEdit"></div>'+
  '<h4>FIGURINES</h4>'+
  '<div class="fRow"><button data-a="all">ALL</button><button data-a="none">NONE</button><button data-a="act">IN USE</button></div>'+
  '<div class="fList"></div><div class="fNote"></div>'+
  '<div class="fRow" style="margin-top:8px"><button data-a="copy">COPY CHANGED</button><button data-a="copyAll">COPY ALL</button><button data-a="exit">EXIT</button></div>'+
 '</div>'+
 '<div class="fTab" data-tab="lab">'+
  '<div class="fHelp">Left / Right: start angle 0.01 · Up / Down: ball ahead 0.1 · PgUp / PgDn: across · Shift x10, Alt x0.1 · Space plays the move · comma / period step it · click the stage to place the ball (side view: Shift sets its height too). Wheel over a number steps it.</div>'+
  '<div class="fRow"><span>View</span><button data-pv2="side">SIDE</button><button data-pv2="front">FRONT</button><button data-pv2="top">TOP</button><button data-pv2="q">3/4</button></div>'+
  '<div class="fRow"><span>Rod</span><button data-role="GK">GK</button><button data-role="DEF">DEF</button><button data-role="MID">MID</button><button data-role="ATT">ATT</button></div>'+
  '<div class="fRow"><span>Man</span><button data-man="-1">&lt;</button><span class="v" data-manv></span><button data-man="1">&gt;</button>'+lt('allMen','All men')+lt('figs','Figurines')+'</div>'+
  '<div class="fRow">'+tg('box','Foot box')+tg('leg','Leg + head')+lt('ghost','Ghost poses')+lt('trail','Trail')+tg('names','Labels')+tg('others','Other rods')+tg('cut','Cut away')+'</div>'+
  '<h4>ROD ANGLE (start)</h4>'+
  '<div class="fRow"><span>Angle</span>'+nb('base',-1,'-')+'<input type="number" data-l="base" step="0.001">'+nb('base',1,'+')+'<input type="range" data-l="base" min="-3.1416" max="3.1416" step="0.001"></div>'+
  '<div class="fRow"><span>Nudge</span><button data-nbv="-0.1">-.1</button><button data-nbv="-0.01">-.01</button><button data-nbv="-0.001">-.001</button><button data-nbv="0.001">+.001</button><button data-nbv="0.01">+.01</button><button data-nbv="0.1">+.1</button><button data-nbv="0">0</button></div>'+
  '<div class="plPoses"></div>'+
  '<h4>BALL</h4>'+
  fld('rel','Ahead',0.01,-14,14)+fld('dz','Across',0.01,-6,6)+fld('y','Up',0.01,0,12)+
  '<div class="fRow"><button data-bt="ahead" title="slide it in from far ahead until it meets the foot, leg or head">TOUCH FROM AHEAD</button><button data-bt="behind">TOUCH FROM BEHIND</button><button data-bt="floor">ON FLOOR</button><button data-bt="man">ON THE MAN</button></div>'+
  '<h4>MOVE</h4>'+
  '<div class="plMoves">'+PL_MOVES.map((M,i)=>'<button data-mv="'+i+'">'+M.l+'</button>').join('')+'</div>'+
  '<div class="fRow" style="margin-top:5px"><button data-tp="0">|&lt;</button><button data-tp="-1">&lt;</button><button data-tp="p">PLAY</button><button data-tp="1">&gt;</button>'+
   '<select data-tp="spd"><option value="1">1x</option><option value="0.5">0.5x</option><option value="0.25" selected>0.25x</option><option value="0.1">0.1x</option><option value="0.05">0.05x</option></select>'+lt('loop','Loop')+'</div>'+
  '<div class="fRow"><input type="range" data-tp="scrub" min="0" max="1" step="0.0005" value="0"></div>'+
  '<div class="fRow"><button data-tp="set" title="make the angle shown the start of the next move">START HERE</button><button data-tp="x">CLEAR MOVE</button></div>'+
  '<div class="plRead"></div>'+
  '<h4>FOOT BOX</h4><div class="plFoot">'+plGroup(['physics.footBox','physics.footBoxOff','physics.footTaper'])+'</div>'+
  '<div class="fNote">Every number behind the poses is on PARAMS. Ghosts and windows follow live edits; the ball turns green where the pin would hold it, red where the foot or leg meets it.</div>'+
  '<div class="fRow" style="margin-top:6px"><button data-pa="copy">COPY CHANGED</button><button data-pa="reset">RESET ALL</button><button data-a="exit">EXIT</button></div>'+
 '</div>'+
 '<div class="fTab" data-tab="par">'+
  '<input type="text" class="pSearch" placeholder="search every CONFIG number: pin fwd angle, safeRaise, lerp...">'+
  '<div class="pRes"></div><div class="pGroups"></div>'+
  '<div class="fNote">Gold = changed from config.js. R puts one back. Grey rows are read once at load (config.js aliases): change them in config.js. Some other numbers are cached at load too: if an edit does nothing, that is why.</div>'+
  '<div class="fRow" style="margin-top:6px"><button data-pa="copy">COPY CHANGED</button><button data-pa="reset">RESET ALL</button><button data-a="exit">EXIT</button></div>'+
 '</div>'+
 '<div class="pTip">Hover a number to see where it lives and what it does.</div>';
 document.body.appendChild(p);FE.panel=p;
 const lab=document.createElement('div');lab.className='feLabs';document.body.appendChild(lab);FE.lab=lab;
 const tip=p.querySelector('.pTip');
 const mods=e=>e.shiftKey?10:(e.altKey||e.ctrlKey)?.1:1;
 const lStep=k=>k==='base'?.01:.1;
 const lSet=(k,v)=>{if(k==='base')plSetBase(v);else plBallSet(k,v);};
 const pNudge=(row,i,d,e)=>{const path=row.dataset.p,v=plGet(path),x=Array.isArray(v)?v[i]:v,st=plStepOf(path,i)*mods(e);plSetPath(path,i,+(x+d*st).toFixed(6));plParamChanged(path);};
 p.addEventListener('input',e=>{
  const t=e.target,d=t.dataset;
  if(d.k||d.n){feSet(FE.cur,d.k||d.n,+t.value);feSync();feEditVals(t);return;}
  if(d.g){FE[d.g]=+t.value;feGVals();if(d.g==='ang'){for(const s of FE.slots)s.r.pivot.rotation.z=FE.ang;shadowDirty();}else feStage();return;}
  if(d.l!=null&&t.value!==''&&isFinite(+t.value)){lSet(d.l,+t.value);return;}
  if(d.tp==='scrub'){const L=FE.L;if(L.A){L.play=false;L.t=+t.value*L.T;L.ang=plAt(L.t);plPose();}return;}
  if(d.pv!=null&&t.type==='number'&&t.value!==''&&isFinite(+t.value)){const row=t.closest('[data-p]');plSetPath(row.dataset.p,+d.i,+t.value);plParamChanged(row.dataset.p);return;}
  if(t.classList.contains('pSearch')){const r=p.querySelector('.pRes'),L=plSearch(t.value);r.innerHTML=t.value.trim()?(L.length?L.map(q=>plPRow(q,true)).join(''):'<div class="fNote">nothing matches</div>'):'';}
 });
 p.addEventListener('change',e=>{
  const t=e.target,d=t.dataset;
  if(d.t){FE[d.t]=t.checked;
   p.querySelectorAll('[data-t="'+d.t+'"]').forEach(c=>{c.checked=t.checked;});
   if(d.t==='names')FE.lab.style.display=t.checked?'block':'none';
   if(FE.stage==='lab'){if(d.t==='others')plStage();else plPose();return;}
   if(d.t==='others')feStage();
   else if(d.t!=='bulk'&&d.t!=='names'){for(const b of FE.balls)b.visible=FE.ball;feSync();}
   return;}
  if(d.lt){FE.L[d.lt]=t.checked;if(d.lt==='ghost')plRefresh();else if(d.lt==='trail')plTrail();else plPose();return;}
  if(d.tp==='spd'){FE.L.spd=+t.value;return;}
  if(d.pv!=null&&t.type==='checkbox'){const row=t.closest('[data-p]');plSetPath(row.dataset.p,0,t.checked);plParamChanged(row.dataset.p);return;}
  if(d.s){if(t.checked)FE.sel.add(d.s);else FE.sel.delete(d.s);feStage();}
 });
 p.addEventListener('click',e=>{
  const b=e.target.closest('button,.fItem');if(!b)return;const d=b.dataset;if(b.tagName==='BUTTON')b.blur();
  const L=FE.L;
  if(d.tabb){feTab(d.tabb);return;}
  if(d.v){feView(d.v);return;}
  if(d.pv2){plView(d.pv2);return;}
  if(d.role){L.role=d.role;const r=rods.find(q=>q.team===0&&q.role===d.role);L.man=r?r.men.length>>1:0;plStage();plView(L.view);return;}
  if(d.man){const n=L.r?L.r.men.length:1;L.man=(L.man+(+d.man)+n)%n;plRefresh();plView(L.view);return;}
  if(d.nl){lSet(d.nl,L[d.nl]+(+d.d)*lStep(d.nl)*mods(e));return;}
  if(d.nbv!=null){const v=+d.nbv;plSetBase(v===0?0:L.base+v);return;}
  if(d.pose!=null){plSetBase(+d.pose);return;}
  if(d.bt){if(d.bt==='ahead')plTouchFrom(1);else if(d.bt==='behind')plTouchFrom(-1);else if(d.bt==='floor')plBallSet('y',BALL_R);else plBallSet('dz',0);return;}
  if(d.mv!=null){plMove(+d.mv);return;}
  if(d.tp){
   if(d.tp==='0')plStep(-1e6);else if(d.tp==='-1')plStep(-1);else if(d.tp==='1')plStep(1);
   else if(d.tp==='p'){if(L.A){if(!L.play&&L.t>=L.T)L.t=0;L.play=!L.play;plPose();}}
   else if(d.tp==='set'){const a=L.ang;L.mv=null;plSetBase(a);}
   else if(d.tp==='x'){L.mv=null;plSetBase(L.base);}
   return;}
  if(d.pd){pNudge(b.closest('[data-p]'),+d.i,+d.pd,e);return;}
  if(d.pr!=null){const path=b.closest('[data-p]').dataset.p;if(path in FE.pOrg){const o=FE.pOrg[path];plSetPath(path,0,Array.isArray(o)?o.slice():o);plParamChanged(path);}return;}
  if(d.pa){if(d.pa==='copy')plCopy();else plResetAll();return;}
  if(d.pick){FE.cur=d.pick;if(!FE.sel.has(d.pick)){FE.sel.add(d.pick);feStage();}else feSync();feEdit();return;}
  const a=d.a;if(!a)return;
  if(a==='ang0'){FE.ang=0;p.querySelector('[data-g=ang]').value=0;feGVals();for(const s of FE.slots)s.r.pivot.rotation.z=0;shadowDirty();}
  else if(a==='all'||a==='none'||a==='act'){FE.sel=new Set(a==='all'?feModels().map(m=>m.id):a==='act'?[activeModel(0).id,activeModel(1).id]:[]);feStage();}
  else if(a==='copy'||a==='copyAll')feCopy(a==='copyAll');
  else if(a==='exit')feExit();
  else feAct(a);
 });
 // the wheel over a number steps it (Shift x10, Alt x0.1)
 p.addEventListener('wheel',e=>{
  const t=e.target;if(t.tagName!=='INPUT'||t.type!=='number'||t.disabled)return;
  const d=t.dataset,s=e.deltaY<0?1:-1;
  if(d.l!=null){e.preventDefault();lSet(d.l,FE.L[d.l]+s*lStep(d.l)*mods(e));}
  else if(d.pv!=null){e.preventDefault();pNudge(t.closest('[data-p]'),+d.i,s,e);}
 },{passive:false});
 p.addEventListener('mouseover',e=>{
  const row=e.target.closest('[data-p]');if(!row)return;
  const path=row.dataset.p,tx=plSrcTip(path),o=FE.pOrg[path];
  tip.textContent='CONFIG.'+path+(PL_BOOT.has(path)?'  (read at load)':'')+(plChg(path)?'  was '+plTxt(o):'')+(tx?'\n'+tx:'');
 });
 feGVals();
}
function feGVals(){for(const k of ['ang','gap']){const v=FE.panel.querySelector('[data-gv='+k+']');if(v)v.textContent=(+FE[k]).toFixed(k==='ang'?2:1);}}
// the edit block, rebuilt when the edited figurine or its load state changes
function feEdit(){
 if(!FE.panel)return;
 const box=FE.panel.querySelector('.fEdit'),am=feModel(FE.cur),T=FE.tpl[FE.cur];
 if(!am){box.innerHTML='<div class="fNote">Click a figurine.</div>';return;}
 const lo=T&&T.lo!=null?T.lo:0,hi=T&&T.hi!=null?T.hi:16;
 box.innerHTML='<div class="fName">'+am.name.toUpperCase()+'<span class="fNote"> '+am.id+(T&&T.bad?' (failed to load)':T&&T.lo==null?' (loading)':'')+'</span></div>'+
  '<div class="fRow"><span>Scale</span><input type="range" data-k="scale" min="0.4" max="1.4" step="0.005"><input type="number" data-n="scale" step="0.005"></div>'+
  '<div class="fRow"><span>Rod height</span><input type="range" data-k="rodY" min="'+lo.toFixed(2)+'" max="'+hi.toFixed(2)+'" step="0.01"><input type="number" data-n="rodY" step="0.01"></div>'+
  '<div class="fRead"></div>'+
  '<div class="fRow"><button data-a="fit" title="scale so the feet stand on the foot box sole (green), rod kept">FIT FEET</button><button data-a="head" title="scale so the head reaches the reference line (gold), rod kept">MATCH HEAD</button><button data-a="both" title="feet on the green line AND head on the gold one: sets scale and rod height">FEET + HEAD</button></div>'+
  '<div class="fRow"><button data-a="ref" title="put the gold reference line at this figurine\'s head">SET REF</button><button data-a="reset">RESET</button><label title="the buttons above act on every figurine on the stage"><input type="checkbox" data-t="bulk"'+(FE.bulk?' checked':'')+'>all shown</label></div>';
 feEditVals(null);feRead();
}
function feEditVals(skip){
 const am=feModel(FE.cur);if(!am||!FE.panel)return;
 const v={scale:am.scale,rodY:feRodY(am)};
 FE.panel.querySelectorAll('.fEdit [data-k],.fEdit [data-n]').forEach(el=>{if(el===skip)return;const k=el.dataset.k||el.dataset.n;el.value=(+v[k]).toFixed(k==='scale'?3:2);});
}
function feRead(){
 const el=FE.panel&&FE.panel.querySelector('.fRead');if(!el)return;
 const am=feModel(FE.cur),T=FE.tpl[FE.cur];
 if(!am||!T||T.lo==null){el.textContent='';return;}
 const s=am.scale,ry=feRodY(am),base=ROD_H+figY(am),feet=base+s*T.lo,head=base+s*T.hi,h=s*(T.hi-T.lo),sg=x=>(x>=0?'+':'')+x.toFixed(2);
 el.textContent='Height      '+h.toFixed(2)+'  (model '+(T.hi-T.lo).toFixed(2)+')\n'+
  'Rod at      '+((ry-T.lo)/(T.hi-T.lo)*100).toFixed(0)+'% up the figure\n'+
  'Feet        '+sg(feet-feFeetY())+' vs the foot box sole\n'+
  'Head        '+head.toFixed(2)+(FE.refY!=null?'  ('+sg(head-FE.refY)+' vs ref)':'');
}
function feList(){
 if(!FE.panel)return;
 const L=FE.panel.querySelector('.fList');
 L.innerHTML=feModels().map(m=>'<input type="checkbox" data-s="'+m.id+'"'+(FE.sel.has(m.id)?' checked':'')+'>'+
  '<div class="fItem'+(m.id===FE.cur?' cur':'')+'" data-pick="'+m.id+'">'+m.name+'</div>'+
  '<div class="fVal'+(feChanged(m.id)?' chg':'')+'">'+m.scale.toFixed(3)+' · '+feRodY(m).toFixed(2)+'</div>').join('');
 const n=[];
 if(FE.more>0)n.push(FE.more+' more selected than the stage holds: lower Spacing.');
 FE.panel.querySelector('.fNote').textContent=n.join(' ');
}
function feCopy(all){
 const L=feModels().filter(m=>all||feChanged(m.id)).map(m=>"{id:'"+m.id+"', scale:"+(+m.scale.toFixed(3))+", rodY:"+(+feRodY(m).toFixed(2))+"},");
 const txt='// Figurine Sizer: CONFIG.playerModel.models scale + rodY\n'+(L.length?L.join('\n'):'// nothing changed');
 console.log(txt);
 const c=navigator.clipboard;if(c&&c.writeText)c.writeText(txt).catch(()=>{});
 if(typeof toast==='function')toast('FIGURINE SIZER',L.length+' copied to the clipboard and the console',1.6);
}

// --- camera ---
function feView(k){
 const C=FE.cam;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
 for(const s of FE.slots){x0=Math.min(x0,s.r.x);x1=Math.max(x1,s.r.x);z0=Math.min(z0,s.z);z1=Math.max(z1,s.z);}
 if(!FE.slots.length){x0=x1=-7.5;z0=z1=0;}
 const asp=Math.max(.5,((FE.vw||innerWidth)-FE_PANEL)/(FE.vh||innerHeight)),hh=9;
 C.tx=(x0+x1)/2;C.tz=(z0+z1)/2;C.ty=ROD_H*.8;
 const fit=(hw,fov)=>{C.fov=fov;C.dist=Math.max(hw/asp,hh)/Math.tan(fov*Math.PI/360)*1.15;};
 if(k==='side'){C.yaw=0;C.pitch=.03;fit((x1-x0)/2+8,10);}
 else if(k==='front'){C.yaw=Math.PI/2;C.pitch=.06;fit((z1-z0)/2+5,14);}
 else{C.yaw=.75;C.pitch=.3;fit(Math.max((z1-z0)/2,(x1-x0)/2)+6,30);}
}
function figTick(dt){
 if(!FE.on)return;
 if(FE.stage==='lab')plTick(dt||0);
 const C=FE.cam,cp=Math.cos(C.pitch),w=innerWidth,h=innerHeight;
 camera.position.set(C.tx+C.dist*Math.sin(C.yaw)*cp,C.ty+C.dist*Math.sin(C.pitch),C.tz+C.dist*Math.cos(C.yaw)*cp);
 camera.up.set(0,1,0);camera.lookAt(C.tx,C.ty,C.tz);
 camera.near=FE.cut?Math.max(FE.stash.near,C.dist-FE.R):FE.stash.near;
 camera.fov=C.fov;camera.setViewOffset(w,h,-FE_PANEL/2,0,w,h);camera.updateProjectionMatrix();FE.vw=w;FE.vh=h;
 if(!FE.names)return;
 const v=new THREE.Vector3(),put=(el,on)=>{el.style.display=on?'block':'none';if(on){el.style.left=((v.x+1)/2*w).toFixed(1)+'px';el.style.top=((1-v.y)/2*h).toFixed(1)+'px';}};
 if(FE.stage==='lab'){for(const t of FE.L.tags){v.copy(t.v).project(camera);put(t.el,t.on&&v.z<1&&Math.abs(v.x)<1.2&&Math.abs(v.y)<1.2);}return;}
 for(const s of FE.slots){
  const T=FE.tpl[s.id];s.w.updateMatrixWorld(true);
  v.set(0,T&&T.hi!=null?T.hi:12,0);s.w.localToWorld(v);v.y+=.8;v.project(camera);
  put(s.lab,s.w.visible&&v.z<1&&Math.abs(v.x)<1.2&&Math.abs(v.y)<1.2);
 }
}
function fePick(cx,cy){
 const rc=new THREE.Raycaster(),ws=FE.slots.filter(s=>s.w.visible).map(s=>s.w);
 rc.setFromCamera({x:cx/innerWidth*2-1,y:-(cy/innerHeight*2-1)},camera);
 const hit=rc.intersectObjects(ws,true)[0];if(!hit)return;
 let o=hit.object;while(o&&ws.indexOf(o)<0)o=o.parent;
 const s=FE.slots.find(q=>q.w===o);if(!s)return;
 FE.cur=s.id;feSync();feEdit();
}

// --- input ---
addEventListener('keydown',e=>{
 if(e.code==='F4'){e.preventDefault();e.stopPropagation();if(!e.repeat)figEd();return;}
 if(!FE.on)return;
 if(e.code==='Escape'){e.preventDefault();e.stopPropagation();feExit();return;}
 if(FE.panel&&FE.panel.contains(e.target)&&/^(INPUT|SELECT)$/.test(e.target.tagName)&&e.target.type!=='checkbox'&&e.target.type!=='range'){e.stopPropagation();return;}   // typing in a field: the game's keys stay out of it
 if(FE.stage==='lab'&&plKey(e)){e.preventDefault();e.stopPropagation();}
},true);
addEventListener('mousedown',e=>{
 if(!FE.on||typeof cvs==='undefined'||e.target!==cvs)return;
 FE.drag={b:e.button,x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY};e.preventDefault();
});
addEventListener('mousemove',e=>{
 const D=FE.drag;if(!FE.on||!D)return;
 const C=FE.cam,dx=e.clientX-D.x,dy=e.clientY-D.y;D.x=e.clientX;D.y=e.clientY;
 if(D.b===0){C.yaw-=dx*.006;C.pitch=clamp(C.pitch+dy*.006,-1.45,1.55);return;}
 const k=C.dist*Math.tan(C.fov*Math.PI/360)*2/innerHeight,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
 C.tx-=dx*k*cy;C.tz+=dx*k*sy;C.ty+=dy*k;
});
addEventListener('mouseup',e=>{
 const D=FE.drag;FE.drag=null;
 if(!FE.on||!D||D.b!==0||Math.abs(e.clientX-D.x0)+Math.abs(e.clientY-D.y0)>=5)return;
 if(FE.stage==='lab')plClick(e.clientX,e.clientY,e.shiftKey);else fePick(e.clientX,e.clientY);
});
addEventListener('wheel',e=>{if(FE.on&&typeof cvs!=='undefined'&&e.target===cvs)FE.cam.dist=clamp(FE.cam.dist*Math.exp(e.deltaY*.001),5,2000);},{passive:true});
addEventListener('contextmenu',e=>{if(FE.on&&typeof cvs!=='undefined'&&e.target===cvs)e.preventDefault();});
