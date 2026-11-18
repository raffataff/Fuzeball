'use strict';
// ================= customize panel =================
// a self-contained turntable studio (its own three.js scene) plus the controls that drive it; colour and finish edits also go onto the live game materials

// w/h/dpr = the studio viewport, fed to the shared preview renderer (PRV, world.js); there is no `renderer` here
// parts = the studio's team-lit pieces (czStudio); env = the softbox reflections; balls = the finish swatch scene; mix = the colour mixer's state (czMixBuild)
const PV={on:false,ready:false,loadedId:null,team:0,spin:false,
 yaw:0,pitch:0,zoom:1,dragging:false,px:0,py:0,t0:0,hintPad:null,
 w:0,h:0,dpr:1,scene:null,camera:null,root:null,model:null,mats:[],hairMats:[],
 parts:null,env:null,shTex:null,balls:null,ballsDue:false,mix:null,cache:{},cacheOrder:[],baseScale:1};

// record a figurine template into the shared preview cache (PV.cache) and evict LRU past CONFIG.playerModel.cacheMax; ref-drop only (a preview may hold a clone); shown ids are protected
function pvCachePut(id,scene){
 if(typeof cacheModelTemplate!=='function'){PV.cache[id]=scene;return;} // helpers live in world.js; degrade gracefully
 cacheModelTemplate(PV.cache,PV.cacheOrder,id,scene);
 const protect=new Set([PV.loadedId,THB.loadedId&&THB.loadedId[0],THB.loadedId&&THB.loadedId[1],
  (typeof LSP!=='undefined'&&LSP)?LSP.lid:null,cfg.modelRed,cfg.modelBlue].filter(Boolean));
 capModelCache(PV.cache,PV.cacheOrder,protect,false);
}

// ---- shared pickers (Customize and New League) ----
// the figure groups of CONFIG.playerModel.squads, in order, then anything unlisted
function czGroups(){
 const M=CONFIG.playerModel.models,used=new Set(),out=[];
 for(const s of CONFIG.playerModel.squads||[]){
  const ms=s.ids.map(id=>M.find(m=>m.id===id)).filter(m=>m&&!used.has(m.id));
  ms.forEach(m=>used.add(m.id));if(ms.length)out.push([s.name,ms]);
 }
 const rest=M.filter(m=>!used.has(m.id));if(rest.length)out.push(['Other',rest]);
 return out;
}
// one card per figure: the mugshot on the kit colour (--tc), the name as a tag on hover / the pad cursor; `lock` adds the "more soon" card
function czRoster(host,onPick,lock){
 host.innerHTML='';
 const gs=czGroups();
 gs.forEach(([name,ms],gi)=>{
  const grp=document.createElement('div');grp.className='czGrp';
  grp.innerHTML='<div class="czSub">'+name+'</div>';
  const grid=document.createElement('div');grid.className='czCards';grp.appendChild(grid);
  ms.forEach(m=>{
   const d=document.createElement('button');d.className='czCard';d.dataset.id=m.id;
   d.innerHTML='<span class="cIn"><span class="cIco">'+ICO.figure+'</span></span><span class="cTag">'+m.name+'</span>';
   mugImg(m,d.firstChild,'czMug','hasMug');
   d.onclick=()=>onPick(m.id);grid.appendChild(d);
  });
  if(lock&&gi===gs.length-1){const k=document.createElement('div');k.className='czCard lock';
   k.innerHTML='<span class="cIn">'+ICO.lock+'<span>Soon</span></span>';grid.appendChild(k);}
  host.appendChild(grp);
 });
}
function czRosterMark(host,id){host.querySelectorAll('.czCard').forEach(c=>{if(c.dataset.id)c.classList.toggle('on',c.dataset.id===id);});}
// the kit swatches as buttons; `lt` = a light colour, which takes a dark check mark
function czSwatches(host,onPick){
 host.innerHTML='';
 CONFIG.playerModel.swatches.forEach(hex=>{
  hex=hex.toLowerCase();
  const c=document.createElement('button');c.className='czChip';c.dataset.hex=hex;c.title=hex.toUpperCase();
  c.style.setProperty('--sw',hex);c.classList.toggle('lt',hexHsv(hex)[2]>.8&&hexHsv(hex)[1]<.3);c.innerHTML='<i></i>';
  c.onclick=()=>onPick(hex);host.appendChild(c);
 });
}
function czSwatchMark(host,hex){hex=hex.toLowerCase();host.querySelectorAll('.czChip').forEach(c=>c.classList.toggle('on',c.dataset.hex===hex));}

// ---- colour mixer: hue / saturation / brightness faders, no OS colour dialog (a pad can't reach one) ----
function hexHsv(h){const n=parseInt(h.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,mx=Math.max(r,g,b),d=mx-Math.min(r,g,b);
 let hh=0;if(d){if(mx===r)hh=((g-b)/d)%6;else if(mx===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;hh*=60;if(hh<0)hh+=360;}return [hh,mx?d/mx:0,mx];}
function hsvHex(h,s,v){const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));};
 return '#'+[f(5),f(3),f(1)].map(x=>('0'+Math.round(x*255).toString(16)).slice(-2)).join('');}
// how far apart two kits read: redmean RGB distance, 0..~765
function kitDist(a,b){const p=x=>{const n=parseInt(x.slice(1),16);return [n>>16&255,n>>8&255,n&255];};
 const A=p(a),B=p(b),rm=(A[0]+B[0])/2,dr=A[0]-B[0],dg=A[1]-B[1],db=A[2]-B[2];
 return Math.sqrt((2+rm/256)*dr*dr+4*dg*dg+(2+(255-rm)/256)*db*db);}
function czMixBuild(host,pre,onHex){
 const st={hsv:null};
 host.innerHTML=[['Hue',359],['Saturation',100],['Brightness',100]].map((r,i)=>
  '<label for="'+pre+i+'">'+r[0]+'</label><input type="range" id="'+pre+i+'" min="0" max="'+r[1]+'" step="1"><span class="czVal" id="'+pre+i+'V"></span>').join('');
 const read=()=>{st.hsv=[+$(pre+0).value,$(pre+1).value/100,$(pre+2).value/100];onHex(hsvHex(st.hsv[0],st.hsv[1],st.hsv[2]));};
 for(let i=0;i<3;i++)$(pre+i).oninput=read;
 return st;
}
// faders onto `hex`, tracks painted from it; the last mixed value is kept while it still gives `hex` (saturation 0 has no hue of its own)
function czMixSync(pre,st,hex){
 const h=st.hsv&&hsvHex(st.hsv[0],st.hsv[1],st.hsv[2])===hex?st.hsv:hexHsv(hex);st.hsv=h;
 const v=[h[0],h[1]*100,h[2]*100];
 for(let i=0;i<3;i++){$(pre+i).value=Math.round(v[i]);$(pre+i+'V').textContent=Math.round(v[i])+(i?'':'°');}
 $(pre+0).style.background='linear-gradient(90deg,'+[0,60,120,180,240,300,360].map(a=>hsvHex(a,Math.max(h[1],.65),Math.max(h[2],.7))).join(',')+')';
 $(pre+1).style.background='linear-gradient(90deg,'+hsvHex(h[0],0,h[2])+','+hsvHex(h[0],1,h[2])+')';
 $(pre+2).style.background='linear-gradient(90deg,#000,'+hsvHex(h[0],h[1],1)+')';
}

// ---- build controls + wire buttons (called once at boot) ----
function initCustomize(){
 czRoster($('czModels'),czPickModel,true);
 czSwatches($('czSwatch'),czSetCol);
 PV.mix=czMixBuild($('czMix'),'czM',czSetCol);
 const fc=$('czFinish');fc.innerHTML='';
 Object.keys(CONFIG.playerModel.finishes).forEach(k=>{
  const b=document.createElement('button');b.className='czFin';b.dataset.fin=k;b.innerHTML='<img alt=""><span>'+k+'</span>';
  b.onclick=()=>czPickFinish(k);fc.appendChild(b);
 });

 // menu kit columns: figurine opens the studio for that team; palette recolours it.
 [0,1].forEach(team=>{
  $('kitFig'+team).onclick=()=>openCustomize(team);
  czSwatches($('kitPal'+team),hex=>setKitColor(team,hex));
 });

 $('czSpin').innerHTML=ICO.spin;$('czView').innerHTML=ICO.fit;$('czSnap').innerHTML=ICO.cam;
 $('czDoneBtn').onclick=closeCustomize;
 $('czResetBtn').onclick=czResetAll;
 $('czTeamR').onclick=()=>czSetTeam(0);
 $('czTeamB').onclick=()=>czSetTeam(1);
 $('czSpin').onclick=()=>{PV.spin=!PV.spin;$('czSpin').classList.toggle('on',PV.spin);};
 $('czView').onclick=pvHome;
 $('czSnap').onclick=pvSnapshot;
 $('czRand').onclick=()=>czSetCol(hsvHex(Math.random()*360,.55+Math.random()*.45,.45+Math.random()*.5));
 const k=p=>(PV.team===0?'red':'blue')+p;
 $('czMetal').oninput=e=>{cfg[k('Metalness')]=+e.target.value;czLeaveDefault();czAfterFinish();};
 $('czRough').oninput=e=>{cfg[k('Roughness')]=+e.target.value;czLeaveDefault();czAfterFinish();};
 $('czGlow').oninput=e=>{cfg[k('Glow')]=+e.target.value;czLeaveDefault();czAfterFinish();};
 $('czScale').oninput=e=>{cfg[k('Scale')]=+e.target.value;czAfterFinish();};
 addEventListener('resize',()=>{if(PV.on)pvResize();});
}

// ---- open / close ----
// teardown hangs off the screen, not the Done button (Esc leaves without closeCustomize, and the turntable would keep rendering)
SCREENS.customize.onHide=()=>{PV.on=false;refreshKitUI();};
// right stick turns the turntable (js/padnav.js), like dragging the canvas
SCREENS.customize.onPadStick=(rx,ry,dt)=>{if(!PV.on)return false;const S=CONFIG.playerModel.studio;
 PV.yaw+=rx*2.6*dt;PV.pitch=clamp(PV.pitch+ry*.8*dt,S.pitchMin,S.pitchMax);return true;};
// a figurine's front is +x: a quarter turn faces the camera, then `turn` toward the screen's middle
function czYaw(t){return -Math.PI/2+(t===0?1:-1)*CONFIG.playerModel.studio.turn;}
function pvHome(){PV.yaw=czYaw(PV.team);PV.pitch=CONFIG.playerModel.studio.pitch;PV.zoom=1;}
function openCustomize(team){
 if(team===0||team===1)PV.team=team;
 pvHome();
 try{Au.ui();}catch(e){}
 showScreen('customize');
 czSyncUI();
 requestAnimationFrame(()=>{pvInit();pvLoadModel();pvResize();PV.on=true;PV.t0=performance.now();czBalls();pvTick();});
}
function closeCustomize(){showScreen('menu');}   // onHide above does the stop/refresh

// live kit summary in the menu's Teams & Kits panel: the tape render cut from the head down (a 3D thumbnail when a figurine has none), model caption, palette, team-tinted accents
const KP_BAD={};
function refreshKitUI(){
 let thumbs=false;
 [0,1].forEach(team=>{
  const col=(team===0?cfg.redColor:cfg.blueColor).toLowerCase(),am=activeModel(team);
  const cap=$('kitCap'+team);if(cap)cap.textContent=am.name;
  const fig=$('kitFig'+team);
  if(fig){fig.style.setProperty('--tc',col);if(!kitPortrait(team,fig,am))thumbs=true;}
  const nameEl=$(team===0?'nameRed':'nameBlue');if(nameEl)nameEl.style.setProperty('--tc',col);
  const pal=$('kitPal'+team);if(pal)czSwatchMark(pal,col);
 });
 if(!thumbs)return;
 const needReload=!THB.model[0]||THB.loadedId[0]!==activeModel(0).id||!THB.model[1]||THB.loadedId[1]!==activeModel(1).id;
 if(needReload)thumbLoad(applyKitThumbs);
 else applyKitThumbs();
}
// the pre-match tape render in a kit frame, team colour laid over its mask; false = this figurine has no render (or it would not load), so the 3D thumbnail stands in
function kitPortrait(team,fig,am){
 const src=typeof modelRender==='function'?modelRender(am.id):null;
 const img=fig.querySelector('.lgFigImg'),tint=fig.querySelector('.lgFigTint');
 if(!src||KP_BAD[src]||!img||!tint){fig.classList.remove('hasRender');fig.dataset.src='';return false;}
 const P=CONFIG.playerModel.portrait,mask=modelRenderMask(am.id);
 fig.style.setProperty('--show',P.show);fig.style.setProperty('--fit',P.fit);fig.style.setProperty('--head',P.head);
 fig.style.setProperty('--cx',team===1?1-P.cx:P.cx);
 fig.style.setProperty('--rt',(am.renderTop==null?P.top:am.renderTop)/1024);
 if(fig.dataset.src!==src){
  fig.dataset.src=src;fig.style.backgroundImage='';
  tint.style.webkitMaskImage=tint.style.maskImage=mask?'url('+mask+')':'none';
  img.onload=()=>fig.classList.add('hasRender');
  img.onerror=()=>{KP_BAD[src]=1;refreshKitUI();};
  img.src=src;
 }
 return true;
}
function applyKitThumbs(){
 [0,1].forEach(team=>{
  const fig=$('kitFig'+team);
  if(!fig||fig.dataset.src)return;
  const url=thumbRender(team);
  if(url)fig.style.backgroundImage='url('+url+')';
 });
}

// ---- control handlers ----
// single source of truth for a team's colour, used by the menu palette and the studio picker
function setKitColor(team,hex){
 hex=hex.toLowerCase();
 if(team===0)cfg.redColor=hex;else cfg.blueColor=hex;
 applyColors();saveCfg();
 if(PV.on){pvApply();czSyncColor();}
 refreshKitUI();
}
function czSetCol(hex){setKitColor(PV.team,hex);}
// the other kit: its own figure, colour and finish
function czSetTeam(t){PV.team=t;pvHome();pvLoadModel();pvApply();czSyncUI();}
function czPickModel(id){
 const key=PV.team===0?'modelRed':'modelBlue';
 if(id===cfg[key])return;
 cfg[key]=id;saveCfg();
 pvLoadModel();
 if(typeof reloadPlayerModel==='function')reloadPlayerModel();
 czSyncModels();refreshKitUI();
}
// touching a finish slider means manual values: drop the team out of 'Default' (authored-materials) mode
function czLeaveDefault(){cfg[PV.team===0?'redFinishDefault':'blueFinishDefault']=false;}
function czPickFinish(k){
 const f=CONFIG.playerModel.finishes[k];if(!f)return;
 const p=PV.team===0?'red':'blue';
 if(f.authored){cfg[p+'FinishDefault']=true;}
 else{
  cfg[p+'FinishDefault']=false;
  cfg[p+'Metalness']=f.metalness;cfg[p+'Roughness']=f.roughness;cfg[p+'Glow']=f.glow;
 }
 czAfterFinish();
}
function czAfterFinish(){applyFinish();pvApply();saveCfg();czSyncFinish();refreshKitUI();}
function czResetAll(){
 cfg.modelRed=CONFIG.playerModel.default;
 cfg.modelBlue=CONFIG.playerModel.default;
 cfg.redColor=CONFIG.playerModel.kitDefault[0];cfg.blueColor=CONFIG.playerModel.kitDefault[1];
 cfg.redMetalness=cfg.blueMetalness=.15;cfg.redRoughness=cfg.blueRoughness=.45;cfg.redGlow=cfg.blueGlow=0;cfg.redScale=cfg.blueScale=1;
 cfg.redFinishDefault=cfg.blueFinishDefault=false;
 pvHome();
 saveCfg();
 pvLoadModel();if(typeof reloadPlayerModel==='function')reloadPlayerModel();
 applyColors();pvApply();czSyncUI();refreshKitUI();
}

// ---- control <-> cfg sync ----
// selected card, nameplate
function czSyncModels(){
 const am=activeModel(PV.team);
 czRosterMark($('czModels'),am.id);
 $('czName').textContent=am.name;$('czBlurb').textContent=am.blurb||'';
}
// team tabs (names, swatches) and the screen's kit colour (--tc: cards, stage light, nameplate bar)
function czSyncTeam(){
 $('czTeamR').classList.toggle('on',PV.team===0);
 $('czTeamB').classList.toggle('on',PV.team===1);
 $('czTeamR').style.setProperty('--tc',cfg.redColor);
 $('czTeamB').style.setProperty('--tc',cfg.blueColor);
 $('czTeamRN').textContent=cfg.redName||'Team 1';
 $('czTeamBN').textContent=cfg.blueName||'Team 2';
 $('customize').style.setProperty('--tc',PV.team===0?cfg.redColor:cfg.blueColor);
}
// swatches, mixer, hex, the clash line, the finish balls (they wear the colour)
function czSyncColor(){
 const col=(PV.team===0?cfg.redColor:cfg.blueColor).toLowerCase(),oth=(PV.team===0?cfg.blueColor:cfg.redColor).toLowerCase();
 $('czHex').textContent=col;
 czSwatchMark($('czSwatch'),col);
 czMixSync('czM',PV.mix,col);
 const cl=$('czClash'),near=kitDist(col,oth)<CONFIG.playerModel.clash;
 cl.classList.toggle('on',near);
 if(near)cl.textContent='Too close to '+((PV.team===0?cfg.blueName:cfg.redName)||'the other team')+'’s kit to tell apart';
 czSyncTeam();
 czBalls();
}
function czSyncFinish(){
 const t=PV.team,mv=tmMetal(t),rv=tmRough(t),gv=tmGlow(t),sv=tmScale(t);
 $('czMetal').value=mv;$('czRough').value=rv;$('czGlow').value=gv;$('czScale').value=sv;
 $('czMetalV').textContent=Math.round(mv*100)+'%';
 $('czRoughV').textContent=Math.round(rv*100)+'%';
 $('czGlowV').textContent=(+gv).toFixed(2);
 $('czScaleV').textContent=Math.round(sv*100)+'%';
 const fins=CONFIG.playerModel.finishes,dflt=tmDefault(t);
 document.querySelectorAll('#czFinish .czFin').forEach(b=>{
  const f=fins[b.dataset.fin];
  if(f&&f.authored){b.classList.toggle('on',dflt);return;}
  b.classList.toggle('on',!dflt&&!!f&&Math.abs(f.metalness-mv)<.001&&Math.abs(f.roughness-rv)<.001&&Math.abs(f.glow-gv)<.001);
 });
 // Default keeps the model's own values: the fine-tune faders read greyed until one is touched
 document.querySelectorAll('#czFinish~.czSlide').forEach(s=>s.classList.toggle('dim',dflt));
}
function czSyncUI(){czSyncModels();czSyncColor();czSyncFinish();}

// ================= three.js turntable studio =================
// softbox reflections, baked once on the preview renderer: without an environment chrome and metal render flat
function czEnv(){
 if(PV.env)return PV.env;
 const pm=new THREE.PMREMGenerator(PRV.get()),es=new THREE.Scene();
 const sg=new THREE.SphereGeometry(40,48,24),p=sg.attributes.position,cs=[];
 for(let i=0;i<p.count;i++){const t=clamp(p.getY(i)/80+.5,0,1)**2;cs.push(.012+.05*t,.02+.07*t,.03+.1*t);}   // a dark blue dome, lighter overhead
 sg.setAttribute('color',new THREE.Float32BufferAttribute(cs,3));
 es.add(new THREE.Mesh(sg,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
 const box=(rgb,x,y,z,w,h)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
  new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(rgb[0],rgb[1],rgb[2]),side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);es.add(m);};
 box([5.2,4.9,4.6],-15,13,17,15,10);   // key, front left
 box([1.5,1.8,2.4],19,5,9,6,20);       // cool strip, right
 box([1.8,1.9,2.1],0,32,0,22,22);      // overhead
 box([2.2,2.3,2.6],-6,6,-28,4,24);     // back strips: the rim line on metal
 box([1.2,1.3,1.5],14,8,-24,4,18);
 PV.env=pm.fromScene(es,.03,.1,100).texture;
 pm.dispose();es.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
 return PV.env;
}
function czShadowTex(){
 if(PV.shTex)return PV.shTex;
 const c=document.createElement('canvas');c.width=c.height=128;
 const g=c.getContext('2d'),rg=g.createRadialGradient(64,64,0,64,64,64);
 rg.addColorStop(0,'rgba(0,0,0,1)');rg.addColorStop(.35,'rgba(0,0,0,.75)');rg.addColorStop(1,'rgba(0,0,0,0)');
 g.fillStyle=rg;g.fillRect(0,0,128,128);
 return PV.shTex=new THREE.CanvasTexture(c);
}
// lights and a turned steel plinth (top at y=0, a team-coloured band round it) into `sc`; `ps` scales its width; returns the team-lit parts for czPaint
function czStudio(sc,ps){
 sc.environment=czEnv();sc.environmentIntensity=CONFIG.playerModel.studio.env;
 sc.add(new THREE.HemisphereLight(0xdfe8ff,0x161c26,.7));
 const key=new THREE.DirectionalLight(0xfff2e6,2.4);key.position.set(-5,9,7);sc.add(key);
 const fill=new THREE.DirectionalLight(0xbcd2ff,.7);fill.position.set(7,3,5);sc.add(fill);
 const rim=new THREE.PointLight(0xffffff,3.2,40,0);rim.position.set(-3.5,4.6,-4.6);sc.add(rim);
 const rim2=new THREE.PointLight(0xcfe0ff,1.6,40,0);rim2.position.set(3.8,5,-4.2);sc.add(rim2);
 const steel=new THREE.MeshStandardMaterial({color:0x1b232d,metalness:.9,roughness:.36});
 const top=new THREE.MeshStandardMaterial({color:0x2b3542,metalness:.95,roughness:.24});
 const g=new THREE.Group(),add=(geo,mat,y)=>{const m=new THREE.Mesh(geo,mat);m.position.y=y;g.add(m);return m;};
 add(new THREE.CylinderGeometry(1.64,1.64,.38,96),steel,-.25);
 add(new THREE.CylinderGeometry(1.56,1.64,.05,96),top,-.035);            // bevelled lip
 add(new THREE.CylinderGeometry(1.7,1.74,.07,96),steel,-.47);             // foot
 const band=add(new THREE.CylinderGeometry(1.648,1.648,.04,96,1,true),new THREE.MeshBasicMaterial({color:0xffffff}),-.31);
 const ring=add(new THREE.RingGeometry(1.3,1.33,96),new THREE.MeshBasicMaterial({color:0x0a0f15,side:THREE.DoubleSide}),-.008);ring.rotation.x=-Math.PI/2;
 const shade=(w,op,y,sz)=>{const m=add(new THREE.PlaneGeometry(w,w),new THREE.MeshBasicMaterial({map:czShadowTex(),transparent:true,opacity:op,depthWrite:false,color:0x000000}),y);
  m.rotation.x=-Math.PI/2;if(sz)m.scale.set(1,sz,1);return m;};
 shade(2.6,.6,-.006);        // under the feet
 shade(8,.75,-.505,.55);     // the plinth on the floor (onto the stage behind the canvas)
 if(ps)g.scale.set(ps,1,ps);
 sc.add(g);
 return {rim,band};
}
function czPaint(parts,col){
 if(!parts)return;
 parts.rim.color.copy(col);
 parts.band.material.color.copy(col).multiplyScalar(1.4);
}
// camera distance that fits CONFIG.playerModel.studio's frame into a w x h view at `zoom`; `fw` = another frame width (a narrower plinth)
function czFrameD(cam,w,h,zoom,fw){const S=CONFIG.playerModel.studio,asp=(w/h)||1;
 return Math.max(S.frameH,(fw||S.frameW)/asp)/(2*Math.tan(cam.fov*Math.PI/360))*zoom;}

function pvInit(){
 if(PV.ready)return;
 const cv=$('pvCanvas'),S=CONFIG.playerModel.studio;
 // #pvCanvas is a plain 2D surface (pvTick blits the shared PRV render here); never attach a WebGLRenderer to it, a canvas keeps one context type
 PV.dpr=Math.min(devicePixelRatio,2);
 PV.scene=new THREE.Scene();
 PV.camera=new THREE.PerspectiveCamera(S.fov,1,.1,200);
 PV.parts=czStudio(PV.scene);
 PV.root=new THREE.Group();PV.scene.add(PV.root);
 cv.addEventListener('pointerdown',e=>{PV.dragging=true;PV.px=e.clientX;PV.py=e.clientY;try{cv.setPointerCapture(e.pointerId);}catch(x){}});
 cv.addEventListener('pointermove',e=>{if(!PV.dragging)return;
  PV.yaw+=(e.clientX-PV.px)*.01;PV.pitch=clamp(PV.pitch+(e.clientY-PV.py)*.004,S.pitchMin,S.pitchMax);
  PV.px=e.clientX;PV.py=e.clientY;});
 cv.addEventListener('pointerup',()=>{PV.dragging=false;});
 cv.addEventListener('pointercancel',()=>{PV.dragging=false;});
 cv.addEventListener('wheel',e=>{e.preventDefault();PV.zoom=clamp(PV.zoom*(e.deltaY>0?1.08:.92),S.zoomMin,S.zoomMax);},{passive:false});
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
  if(PV.model){PV.root.remove(PV.model);PV.model=null;PV.mats=[];PV.hairMats=[];}
  const g=src.clone(true);
  let box=new THREE.Box3().setFromObject(g),size=new THREE.Vector3();box.getSize(size);
  PV.baseScale=3.4/(size.y||1);
  g.scale.setScalar(PV.baseScale*tmScale(PV.team));
  box=new THREE.Box3().setFromObject(g);
  const ctr=new THREE.Vector3();box.getCenter(ctr);
  g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
  const teamParts=new Set(am.teamParts.map(s=>s.toLowerCase()));
  const hairParts=new Set((am.hairParts||[]).map(s=>s.toLowerCase()));
  const sw=CONFIG.playerModel.hairSwatches;
  g.traverse(ch=>{if(!ch.isMesh)return;const nm=ch.material.name.toLowerCase();
   const cm=ch.material.clone();ch.material=cm;if(teamParts.has(nm))PV.mats.push(cm);
   else if(hairParts.has(nm)){PV.hairMats.push(cm);cm.color.set(sw[Math.floor(Math.random()*sw.length)]);}});
  PV.model=g;PV.loadedId=am.id;PV.root.add(g);pvApply();
 };
 if(PV.cache[am.id]){touchModelCache(PV.cacheOrder,am.id);show(PV.cache[am.id]);return;}
 newGLTF().load(am.src,
  gltf=>{pvCachePut(am.id,gltf.scene);show(gltf.scene);},
  undefined,
  ()=>{console.warn('preview model load failed, using primitive');pvCachePut(am.id,pvFallback());show(PV.cache[am.id]);});
}

function pvApply(){
 if(!PV.ready)return;
 const col=kitLin(PV.team===0?cfg.redColor:cfg.blueColor);
 PV.mats.forEach(m=>{m.color.copy(col);applyTeamFinish(m,PV.team,col,false);});
 czPaint(PV.parts,col);
 if(PV.model)PV.model.scale.setScalar(PV.baseScale*tmScale(PV.team));
 czBalls();
}

// record the viewport for PRV rather than sizing a renderer; the shared context resizes at draw time, only when the numbers changed
function pvResize(){
 if(!PV.ready)return;
 const cv=$('pvCanvas'),w=cv.clientWidth||cv.parentElement.clientWidth,h=cv.clientHeight||cv.parentElement.clientHeight;
 if(!w||!h)return;
 PV.w=w;PV.h=h;PV.dpr=Math.min(devicePixelRatio,2);
 PV.camera.aspect=w/h;PV.camera.updateProjectionMatrix();
}

function pvTick(){
 if(!PV.on)return;
 requestAnimationFrame(pvTick);
 const S=CONFIG.playerModel.studio,now=performance.now(),dt=Math.min(.1,(now-PV.t0)/1000);PV.t0=now;
 if(PV.spin&&!PV.dragging)PV.yaw+=S.spin*dt;
 PV.root.rotation.y=PV.yaw;
 // zooming in rises from the body's middle to the head
 const d=czFrameD(PV.camera,PV.w,PV.h,PV.zoom),look=lerp(S.look,S.lookNear,clamp((1-PV.zoom)/(1-S.zoomMin),0,1));
 PV.camera.position.set(0,look+Math.sin(PV.pitch)*d,Math.cos(PV.pitch)*d);PV.camera.lookAt(0,look,0);
 const pad=typeof inputKind==='function'&&inputKind()==='pad';
 if(pad!==PV.hintPad){PV.hintPad=pad;const h=document.querySelector('#customize .czHint');if(h)h.textContent=pad?'Right stick to turn':'Drag to turn · wheel to zoom';}
 PRV.draw(PV.scene,PV.camera,$('pvCanvas'),PV.w,PV.h,PV.dpr);
 if(PV.ballsDue){PV.ballsDue=false;czBallsDraw();}
}

// one ball per finish preset in the kit's colour, through the same softboxes; 'Default' shows the model's own values
// drawn on the next turntable frame, so a fader dragged through many colours re-draws them once a frame
function czBalls(){PV.ballsDue=true;}
function czBallsDraw(){
 const fc=$('czFinish');if(!fc||!PV.ready||!fc.getClientRects().length)return;
 if(!PV.balls){
  const s=new THREE.Scene();s.environment=czEnv();s.environmentIntensity=CONFIG.playerModel.studio.env;
  const k=new THREE.DirectionalLight(0xfff2e6,2.2);k.position.set(-4,5,6);s.add(k);
  const r=new THREE.DirectionalLight(0xcfe0ff,1.1);r.position.set(4,2,-5);s.add(r);
  s.add(new THREE.HemisphereLight(0xdfe8ff,0x161c26,.5));
  const mat=new THREE.MeshStandardMaterial();s.add(new THREE.Mesh(new THREE.SphereGeometry(1,48,32),mat));
  const cam=new THREE.PerspectiveCamera(22,1,.1,50);cam.position.set(0,0,5.6);cam.lookAt(0,0,0);
  PV.balls={s,cam,mat};
 }
 const B=PV.balls,m=B.mat,col=kitLin(PV.team===0?cfg.redColor:cfg.blueColor),F=CONFIG.playerModel.finishes;
 const o=PV.mats[0]&&PV.mats[0].userData&&PV.mats[0].userData.fbOrig;
 fc.querySelectorAll('.czFin').forEach(b=>{
  const f=F[b.dataset.fin],img=b.querySelector('img');if(!f||!img)return;
  const px=img.clientWidth||42;
  m.color.copy(col);
  if(f.authored){m.metalness=o?o.metalness:.3;m.roughness=o?o.roughness:.5;m.emissive.setHex(0);m.emissiveIntensity=0;}
  else{m.metalness=f.metalness;m.roughness=f.roughness;m.emissive.copy(col);m.emissiveIntensity=f.glow;}
  img.src=PRV.dataURL(B.s,B.cam,px,px,2);
 });
}

function pvSnapshot(){
 if(!PV.ready||!PV.w)return;
 const a=document.createElement('a');
 a.download='fuzeball_'+cfg[PV.team===0?'modelRed':'modelBlue']+'_'+(PV.team===0?'red':'blue')+'.png';
 a.href=PRV.dataURL(PV.scene,PV.camera,PV.w,PV.h,PV.dpr);a.click();
 $('czSnap').classList.add('on');setTimeout(()=>$('czSnap').classList.remove('on'),350);
}

// ================= menu figurine thumbnails =================
// stamps a posed, team-coloured figurine into each menu column on demand through the shared preview context (PRV); shares PV.cache; THB.W/H = the size handed to PRV
const THB={ready:false,W:240,H:320,dpr:2,scene:null,cam:null,root:null,rim:null,
 model:[null,null],mats:[[],[]],loadedId:[null,null],baseScale:[1,1]};
function thumbInit(){
 if(THB.ready)return;
 THB.scene=new THREE.Scene();
 THB.cam=new THREE.PerspectiveCamera(36,THB.W/THB.H,.1,200);
 THB.scene.add(new THREE.HemisphereLight(0xe8eeff,0x4f4756,2.98));
 const k=new THREE.DirectionalLight(0xffffff,3.77);k.position.set(5,11,7);THB.scene.add(k);
 THB.rim=new THREE.PointLight(0xffffff,3.47,50,0);THB.rim.position.set(-4,4,-5);THB.scene.add(THB.rim);
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
    THB.baseScale[team]=3.4/(size.y||1);g.scale.setScalar(THB.baseScale[team]*tmScale(team));
   box=new THREE.Box3().setFromObject(g);const ctr=new THREE.Vector3();box.getCenter(ctr);
   g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
   const tp=new Set(am.teamParts.map(s=>s.toLowerCase()));
   const mats=[];
   g.traverse(ch=>{if(!ch.isMesh)return;const cm=ch.material.clone();ch.material=cm;if(tp.has(cm.name.toLowerCase()))mats.push(cm);});
   THB.model[team]=g;THB.mats[team]=mats;THB.loadedId[team]=am.id;
   done();
  };
  if(PV.cache[am.id]){touchModelCache(PV.cacheOrder,am.id);place(PV.cache[am.id]);return;}
  newGLTF().load(am.src,
   gltf=>{pvCachePut(am.id,gltf.scene);place(gltf.scene);},
   undefined,
   ()=>{pvCachePut(am.id,pvFallback());place(PV.cache[am.id]);});
 });
}
function thumbRender(team){
 if(!THB.ready||!THB.model[team])return null;
 while(THB.root.children.length)THB.root.remove(THB.root.children[0]);
 THB.root.add(THB.model[team]);
 const col=kitLin(team===0?cfg.redColor:cfg.blueColor);
  THB.mats[team].forEach(m=>{m.color.copy(col);applyTeamFinish(m,team,col,false);});
  THB.rim.color.copy(col);
  THB.model[team].scale.setScalar(THB.baseScale[team]*tmScale(team));
 THB.root.rotation.y=team===0?-CONFIG.playerModel.kitYaw:Math.PI+CONFIG.playerModel.kitYaw;   // always face each other
 THB.cam.position.set(0,2.0,7.6);THB.cam.lookAt(0,1.65,0);
 return PRV.dataURL(THB.scene,THB.cam,THB.W,THB.H,THB.dpr);
}
