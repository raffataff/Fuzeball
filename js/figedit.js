'use strict';
// ===== Figurine Sizer (dev tool, F4 in the menus) =====
// gated on CONFIG.debug.figEditor; S.figEd (null when off) is tested by fx.js cameraUpdate, world.js renderIdleSkip and main.js only
// edits write CONFIG.playerModel.models[].scale / rodY live (lost on reload): COPY hands them over for config.js

const FE={on:false,panel:null,lab:null,css:false,sel:new Set(),cur:null,tpl:{},kit:{},slots:[],balls:[],lines:[],geo:null,
 refY:null,more:0,ang:0,gap:7,box:true,leg:true,ball:true,names:true,others:false,cut:true,solo:false,bulk:false,R:30,org:{},stash:null,
 cam:{tx:0,ty:5,tz:0,yaw:0,pitch:.03,dist:200,fov:10},drag:null,vw:0,vh:0};
const FE_ROLES=['MID','ATT','DEF','GK'],FE_PANEL=350;

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
 FE.on=true;S.figEd=FE;
 for(const m of feModels())if(!FE.org[m.id])FE.org[m.id]={scale:m.scale,rodY:m.rodY};
 if(!FE.sel.size){FE.sel.add(activeModel(0).id);FE.sel.add(activeModel(1).id);}
 if(!FE.cur||!feModel(FE.cur))FE.cur=[...FE.sel][0];
 FE.stash={fov:camera.fov,near:camera.near,pos:camera.position.clone(),quat:camera.quaternion.clone(),
  rods:rods.map(r=>({vis:r.pivot.visible,a:r.pivot.rotation.z,z:r.pivot.position.z,men:r.men.map(m=>m.visible)})),
  balls:(S.balls||[]).map(b=>b.m.visible)};
 for(const b of S.balls||[])b.m.visible=false;
 hideScreens();
 feCSS();feBuild();FE.panel.style.display='flex';FE.lab.style.display=FE.names?'block':'none';
 feStage();feView('side');feEdit();
 if(typeof toast==='function')toast('FIGURINE SIZER','LMB orbit · RMB pan · wheel zoom · F4 exits',2.4);
}
function feExit(){
 if(!FE.on)return;
 FE.on=false;S.figEd=null;FE.drag=null;
 feClear();
 const st=FE.stash;
 rods.forEach((r,i)=>{const s=st.rods[i];if(!s)return;r.pivot.visible=s.vis;r.pivot.rotation.z=s.a;r.pivot.position.z=s.z;r.men.forEach((m,j)=>{m.visible=s.men[j]!==false;});});
 (S.balls||[]).forEach((b,i)=>{b.m.visible=st.balls[i]!==false;});
 camera.clearViewOffset();camera.fov=st.fov;camera.near=st.near;camera.position.copy(st.pos);camera.quaternion.copy(st.quat);camera.updateProjectionMatrix();
 FE.panel.style.display='none';FE.lab.style.display='none';
 feDispose();
 const ch=[0,1].filter(t=>feChanged(activeModel(t).id));
 if(ch.length){rebuildRodMen();if(typeof iceFitTeam==='function'&&typeof ICE!=='undefined'&&ICE.built)ch.forEach(t=>iceFitTeam(t));}
 const el=$(scrCur);if(el)el.classList.remove('hidden');
 shadowDirty();
}

// --- figurine templates (own loads are freed on exit; the game's cached ones are only borrowed) ---
function feTpl(id){
 const T=FE.tpl[id];if(T)return T.scene;
 if(typeof modelCache!=='undefined'&&modelCache[id]){FE.tpl[id]={scene:modelCache[id],own:false};feMeasure(id);return modelCache[id];}
 FE.tpl[id]={scene:null,own:true};
 newGLTF().load(feModel(id).src,gl=>{const T2=FE.tpl[id];if(!T2||!FE.on||T2.scene)return;T2.scene=gl.scene;feMeasure(id);feStage();feEdit();},
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
 if(FE.geo){for(const k in FE.geo)if(FE.geo[k])FE.geo[k].dispose();FE.geo=null;}
 FE.tpl={};FE.kit={};
}

// --- stage: the shown figurines on team 0's rods (MID first), the rest of the table bare ---
function feGeo(){
 if(FE.geo)return FE.geo;
 const lm=c=>new THREE.LineBasicMaterial({color:c,transparent:true,opacity:.9,depthTest:false});
 FE.geo={box:new THREE.EdgesGeometry(new THREE.BoxGeometry(2*FOOT_BOX.y,2*FOOT_BOX.x,2*FOOT_BOX.z)),
  leg:feCapsule(PRAD,ARM*FOOT_T),head:PHY.head?feCapsule(PHY.head.r,PHY.head.len):null,
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
 feClear();
 const G=feGeo(),ids=feModels().filter(m=>FE.sel.has(m.id)).map(m=>m.id),rs=feRods(),per=Math.max(1,Math.floor((F.W-8)/FE.gap)+1);
 rods.forEach(r=>{r.pivot.rotation.z=0;r.pivot.position.z=0;r.men.forEach(m=>{m.visible=false;});r.pivot.visible=FE.others;});
 let k=0;
 for(const r of rs){
  const n=Math.min(per,ids.length-k);if(n<=0)break;
  r.pivot.visible=true;r.pivot.rotation.z=FE.ang;
  for(let i=0;i<n;i++,k++){
   const id=ids[k],z=(i-(n-1)/2)*FE.gap,w=new THREE.Group(),sc=feTpl(id);
   w.position.z=z;if(sc)w.add(feDress(id,sc.clone(true)));r.pivot.add(w);
   const fb=new THREE.LineSegments(G.box,G.mBox),lg=new THREE.LineSegments(G.leg,G.mLeg),hd=new THREE.LineSegments(G.head||G.leg,G.mLeg);
   fb.position.set(FOOT_BOX_OFF.y*r.kickDir,-ARM*FOOT_T-FOOT_BOX_OFF.x,z);lg.position.set(0,-ARM*FOOT_T/2,z);hd.position.set(0,PHY.head?PHY.head.len/2:0,z);
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
 '.fePanel .v{width:36px;text-align:right;color:#cfe0ff}',
 '.fePanel button{background:#1a2234;color:#cfe0ff;border:1px solid #3a4a6a;border-radius:3px;padding:3px 8px;font:11px/1.2 var(--font-ui),sans-serif;letter-spacing:.1em;cursor:pointer}',
 '.fePanel button:hover{border-color:#F0B24A;color:#fff}',
 '.fePanel label{display:inline-flex;align-items:center;gap:3px;cursor:pointer}',
 '.fePanel .fName{font:13px/1.2 var(--font-ui),sans-serif;color:#fff;letter-spacing:.1em;margin:2px 0 4px}',
 '.fePanel .fRead{color:#aab8d4;margin:4px 0;white-space:pre;font-variant-numeric:tabular-nums}',
 '.fePanel .fList{display:grid;grid-template-columns:auto 1fr auto;gap:1px 6px;align-items:center}',
 '.fePanel .fItem{cursor:pointer;padding:1px 3px;border-radius:2px}',
 '.fePanel .fItem.cur{background:rgba(240,178,74,.18);color:#fff}',
 '.fePanel .fVal{color:#8fa4c8;font-variant-numeric:tabular-nums}',
 '.fePanel .fVal.chg{color:#F0B24A}',
 '.feLabs{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:59;display:none}',
 '.feLab{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font:11.5px/1 "Exo 2",sans-serif;color:#dfe8ff;background:rgba(0,0,0,.55);padding:2px 5px;border-radius:2px}',
 '.feLab.cur{color:#F0B24A;outline:1px solid rgba(240,178,74,.6)}'
 ].join('\n');
 document.head.appendChild(s);
}
function feBuild(){
 if(FE.panel)return;
 const p=document.createElement('div');p.className='fePanel';
 const tg=(k,l)=>'<label><input type="checkbox" data-t="'+k+'"'+(FE[k]?' checked':'')+'>'+l+'</label>';
 p.innerHTML='<h4>FIGURINE SIZER</h4>'+
  '<div class="fHelp">LMB orbit · RMB pan · wheel zoom · click a figurine to edit it · F4 / Esc exits. Edits are live until a reload: COPY and hand them over.</div>'+
  '<div class="fRow"><span>View</span><button data-v="side">SIDE</button><button data-v="front">FRONT</button><button data-v="q">3/4</button></div>'+
  '<div class="fRow">'+tg('box','Foot box')+tg('leg','Leg + head')+tg('ball','Ball')+tg('names','Names')+tg('others','Other rods')+tg('cut','Cut away walls')+tg('solo','Solo')+'</div>'+
  '<div class="fRow"><span>Rod angle</span><input type="range" data-g="ang" min="-1.6" max="1.6" step="0.01" value="'+FE.ang+'"><span class="v" data-gv="ang"></span><button data-a="ang0">0</button></div>'+
  '<div class="fRow"><span>Spacing</span><input type="range" data-g="gap" min="3" max="14" step="0.5" value="'+FE.gap+'"><span class="v" data-gv="gap"></span></div>'+
  '<h4>EDIT</h4><div class="fEdit"></div>'+
  '<h4>FIGURINES</h4>'+
  '<div class="fRow"><button data-a="all">ALL</button><button data-a="none">NONE</button><button data-a="act">IN USE</button></div>'+
  '<div class="fList"></div><div class="fNote"></div>'+
  '<div class="fRow" style="margin-top:8px"><button data-a="copy">COPY CHANGED</button><button data-a="copyAll">COPY ALL</button><button data-a="exit">EXIT</button></div>';
 document.body.appendChild(p);FE.panel=p;
 const lab=document.createElement('div');lab.className='feLabs';document.body.appendChild(lab);FE.lab=lab;
 p.addEventListener('input',e=>{
  const t=e.target,d=t.dataset;
  if(d.k||d.n){feSet(FE.cur,d.k||d.n,+t.value);feSync();feEditVals(t);return;}
  if(d.g){FE[d.g]=+t.value;feGVals();if(d.g==='ang'){for(const s of FE.slots)s.r.pivot.rotation.z=FE.ang;shadowDirty();}else feStage();}
 });
 p.addEventListener('change',e=>{
  const t=e.target,d=t.dataset;
  if(d.t){FE[d.t]=t.checked;
   if(d.t==='others')feStage();
   else if(d.t==='names')FE.lab.style.display=t.checked?'block':'none';
   else if(d.t!=='bulk'){for(const b of FE.balls)b.visible=FE.ball;feSync();}
   return;}
  if(d.s){if(t.checked)FE.sel.add(d.s);else FE.sel.delete(d.s);feStage();}
 });
 p.addEventListener('click',e=>{
  const b=e.target.closest('button,.fItem');if(!b)return;const d=b.dataset;
  if(d.v){feView(d.v);return;}
  if(d.pick){FE.cur=d.pick;if(!FE.sel.has(d.pick)){FE.sel.add(d.pick);feStage();}else feSync();feEdit();return;}
  const a=d.a;if(!a)return;
  if(a==='ang0'){FE.ang=0;p.querySelector('[data-g=ang]').value=0;feGVals();for(const s of FE.slots)s.r.pivot.rotation.z=0;shadowDirty();}
  else if(a==='all'||a==='none'||a==='act'){FE.sel=new Set(a==='all'?feModels().map(m=>m.id):a==='act'?[activeModel(0).id,activeModel(1).id]:[]);feStage();}
  else if(a==='copy'||a==='copyAll')feCopy(a==='copyAll');
  else if(a==='exit')feExit();
  else feAct(a);
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
 if(tmScale(0)!==1||tmScale(1)!==1)n.push('Customize scale is not applied here.');
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
function figTick(){
 if(!FE.on)return;
 const C=FE.cam,cp=Math.cos(C.pitch),w=innerWidth,h=innerHeight;
 camera.position.set(C.tx+C.dist*Math.sin(C.yaw)*cp,C.ty+C.dist*Math.sin(C.pitch),C.tz+C.dist*Math.cos(C.yaw)*cp);
 camera.up.set(0,1,0);camera.lookAt(C.tx,C.ty,C.tz);
 camera.near=FE.cut?Math.max(FE.stash.near,C.dist-FE.R):FE.stash.near;
 camera.fov=C.fov;camera.setViewOffset(w,h,-FE_PANEL/2,0,w,h);camera.updateProjectionMatrix();FE.vw=w;FE.vh=h;
 if(!FE.names)return;
 const v=new THREE.Vector3();
 for(const s of FE.slots){
  const T=FE.tpl[s.id];s.w.updateMatrixWorld(true);
  v.set(0,T&&T.hi!=null?T.hi:12,0);s.w.localToWorld(v);v.y+=.8;v.project(camera);
  const on=s.w.visible&&v.z<1&&Math.abs(v.x)<1.2&&Math.abs(v.y)<1.2;s.lab.style.display=on?'block':'none';
  if(on){s.lab.style.left=((v.x+1)/2*w).toFixed(1)+'px';s.lab.style.top=((1-v.y)/2*h).toFixed(1)+'px';}
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
 if(FE.on&&e.code==='Escape'){e.preventDefault();e.stopPropagation();feExit();}
},true);
addEventListener('mousedown',e=>{
 if(!FE.on||typeof cvs==='undefined'||e.target!==cvs)return;
 FE.drag={b:e.button,x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY};e.preventDefault();
});
addEventListener('mousemove',e=>{
 const D=FE.drag;if(!FE.on||!D)return;
 const C=FE.cam,dx=e.clientX-D.x,dy=e.clientY-D.y;D.x=e.clientX;D.y=e.clientY;
 if(D.b===0){C.yaw-=dx*.006;C.pitch=clamp(C.pitch+dy*.006,-1.45,1.45);return;}
 const k=C.dist*Math.tan(C.fov*Math.PI/360)*2/innerHeight,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
 C.tx-=dx*k*cy;C.tz+=dx*k*sy;C.ty+=dy*k;
});
addEventListener('mouseup',e=>{
 const D=FE.drag;FE.drag=null;
 if(FE.on&&D&&D.b===0&&Math.abs(e.clientX-D.x0)+Math.abs(e.clientY-D.y0)<5)fePick(e.clientX,e.clientY);
});
addEventListener('wheel',e=>{if(FE.on&&typeof cvs!=='undefined'&&e.target===cvs)FE.cam.dist=clamp(FE.cam.dist*Math.exp(e.deltaY*.001),5,2000);},{passive:true});
addEventListener('contextmenu',e=>{if(FE.on&&typeof cvs!=='undefined'&&e.target===cvs)e.preventDefault();});
