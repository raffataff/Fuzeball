'use strict';
// director: a seeded AI match rendered offline, frame by frame, with scripted cameras, speed ramps, holds and motion blur
//   node tools/page-run.js --size=1920x1080 tools/director.js "dirScout({take:'s11',seed:11,secs:240,set:{room:'arcade'}})"
//   node tools/page-run.js --size=1920x1080 tools/director.js "dirShoot('tools/build/director/plan_a.json')"
// a take is one fresh page: the first match after a load replays exactly (two pages agree), a second match in the same page does not
// so scout (sim only: events + the ball track) and shoot (sim again, frames drawn) are separate runs on the same seed and set
// every pass drives main.js loop() with the same fixed clock (DIR.tick), so the sim, slow-mo and timers integrate identically
// output goes to tools/build/director/<take>/ via page-run's /__save; frames are frame_00001.jpg..., encode with tools/seq-encode.py
(function(){
 const DIR={tick:1/960,t0:1e6,i:0,set:false,ev:[],cas:null,shot:null,u:0,j:0,fps:60,trk:null};
 window.DIR=DIR;
 const log=s=>console.log('[run] '+s);
 const V3=(x,y,z)=>[x,y,z];

 // --- clock ---
 function dirT(i){return DIR.t0+i*(DIR.tick*1000);}
 function step(){DIR.i++;loop(dirT(DIR.i));}
 function clockStart(){cfg.fpsCap=0;lastT=DIR.t0;lastFrameT=0;physAcc=0;lastAlpha=-1;DIR.i=0;loop(dirT(0));}

 // --- one-time page hooks ---
 const rr=renderer.render.bind(renderer);
 function hooks(){
  if(DIR.set)return;DIR.set=true;
  if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
  renderer.render=function(s,c){if(DIR.draw)rr(s,c);};   // the loop never draws: drawNow does, with the director's camera
  // the reflection cube and the HUD are per drawn frame, not per tick (the HUD gets the time it missed)
  const ubr=window.updateBallReflect,hr=window.hudRender;let hAcc=0;
  window.updateBallReflect=function(){if(DIR.draw){ballReflN=CONFIG.ballReflect.every-1;ubr();}};
  window.hudRender=function(rdt){hAcc+=rdt;if(DIR.draw){hr(hAcc);hAcc=0;}};
  const at=()=>+(DIR.i*DIR.tick).toFixed(4),push=e=>{e.t=at();e.st=+S.time.toFixed(3);DIR.ev.push(e);};
  const wrap=(name,fn)=>{const o=window[name];if(typeof o!=='function')return;window[name]=function(){fn.apply(null,arguments);return o.apply(this,arguments);};};
  const wrapR=(name,fn)=>{const o=window[name];if(typeof o!=='function')return;window[name]=function(){const r=o.apply(this,arguments);fn(r,arguments);return r;};};
  wrap('onGoal',(team,b)=>{if(b.scored)return;const p=b.m.position;push({type:'goal',team,v:+b.v.length().toFixed(1),x:+p.x.toFixed(1),z:+p.z.toFixed(1)});});
  wrapR('momGoal',r=>{for(let i=DIR.ev.length-1;i>=0;i--)if(DIR.ev[i].type==='goal'){if(!DIR.ev[i].kind)DIR.ev[i].kind=r&&r.kind;break;}});
  wrap('banner',(m,s)=>push({type:'banner',text:m+(s?' / '+s:'')}));
  wrap('notice',m=>push({type:'notice',text:m}));
  wrap('boostHit',(b,r,sp)=>push({type:'powerHit',team:r.team,role:r.role,v:+(+sp).toFixed(1)}));
  wrap('vfxPickup',p=>push({type:'pickup',x:+p.x.toFixed(1),z:+p.z.toFixed(1)}));
  wrap('vfxCannon',p=>push({type:'cannon',x:+p.x.toFixed(1),z:+p.z.toFixed(1)}));
  wrap('iceForm',r=>push({type:'frost',team:r.team}));
  wrap('endMatch',w=>push({type:'end',team:w,score:S.score.slice()}));
  // every sound the game asks for, so the trailer's sound design can sit on the real contacts
  if(typeof Au!=='undefined')for(const fn of ['kick','wall','post','goal','boom','power','play','warnBeep','whistle','react','drop','goalIn','chargeFire']){
   const o=Au[fn];if(typeof o!=='function')continue;
   Au[fn]=function(){const a=arguments,e={type:'snd',fn};
    if(typeof a[0]==='number')e.v=+a[0].toFixed(1);else if(typeof a[0]==='string')e.id=a[0];
    for(const x of a)if(x&&x.cur){e.x=+x.cur.x.toFixed(1);e.y=+x.cur.y.toFixed(1);e.z=+x.cur.z.toFixed(1);if(x.t&&x.t.name)e.bt=x.t.name;break;}
    if(fn==='wall')e.k=a[3];push(e);return o.apply(this,a);};
  }
  // plan.fx scales the effect blasts and light pulses for a close camera (visual only): {blast:{size,pow,k:{0|1|2:{size,pow}}}, light}
  const vb=window.vfxBlast,vl=window.vfxLight;
  if(typeof vb==='function')window.vfxBlast=function(kind,x,y,z,nx,ny,nz,life,s0,s1,hot,pw,body,delay){
   const f=DIR.fx&&DIR.fx.blast;
   if(f){const k=(f.k&&f.k[kind])||{},sz=k.size!=null?k.size:f.size!=null?f.size:1,p=k.pow!=null?k.pow:f.pow!=null?f.pow:1;s0*=sz;s1*=sz;pw*=p;}
   return vb.call(this,kind,x,y,z,nx,ny,nz,life,s0,s1,hot,pw,body,delay);};
  if(typeof vl==='function')window.vfxLight=function(l,pooled,x,y,z,col,dist,peak,hold,decay,delay){
   return vl.call(this,l,pooled,x,y,z,col,dist,peak*(DIR.fx&&DIR.fx.light!=null?DIR.fx.light:1),hold,decay,delay);};
  // plan.fx.ballGlow scales the glow of the cannonball shards' hot inner faces (close up, full glow reads as flat pale card)
  const sbf=window.spawnBallFracture;
  if(typeof sbf==='function')window.spawnBallFracture=function(pos){
   const n=S.frac.length,r=sbf.apply(this,arguments),g=DIR.fx&&DIR.fx.ballGlow;
   if(g!=null&&S.frac.length>n)for(const m of S.frac[S.frac.length-1].mats)if(m.emissive&&m.emissive.r>0.5){m.emissiveIntensity*=g;m.color.multiplyScalar(g);}
   return r;};
  // the game's camera runs every tick (its eases need it); a director shot keeps only the punch spring ticking
  const cu=window.cameraUpdate;
  window.cameraUpdate=function(rdt){
   if(!DIR.shot||DIR.shot.type==='game'){if(DIR.shot)S.camMode=DIR.shot.mode|0;return cu(rdt);}
   if(typeof vfxCamPre==='function'){vfxCamPre();vfxCamPost(rdt);}
  };
 }
 // AI tallies worth a highlight: rally starts, tic-tac strikes, pin shots, taps, receives
 const CASK=['tt','ttShot','ttThru','shot','pass','hit','tap','recvPin','fetchOk','side'];
 function casTick(){
  if(typeof CAS==='undefined')return;
  if(!DIR.cas){DIR.cas={};for(const k of CASK)DIR.cas[k]=CAS[k]|0;return;}
  for(const k of CASK){const n=CAS[k]|0;if(n>DIR.cas[k]){DIR.ev.push({type:'ai',what:k,n:n-DIR.cas[k],t:+(DIR.i*DIR.tick).toFixed(4),st:+S.time.toFixed(3)});DIR.cas[k]=n;}}
 }

 // --- venue, teams, match ---
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const cbWait=(fn,ms)=>new Promise(r=>{let d=false;const go=()=>{if(!d){d=true;r();}};try{fn(go);}catch(e){go();}setTimeout(go,ms||15000);});
 // CONFIG overrides by dotted path, e.g. {'fx.vfx.goal.core.power':3}; only visual keys, or the take stops matching its scout
 function cfgSet(c){for(const k in c||{}){const p=k.split('.');let o=CONFIG;for(let i=0;i<p.length-1;i++)o=o[p[i]];o[p[p.length-1]]=c[k];}}
 async function setup(o){
  hooks();
  cfg.replay=false;cfg.tutSeen=true;cfg.fpsCap=0;
  cfgSet(o.cfg);
  const st=Object.assign({},o.set||{});
  if(st.skin){cfg.skins=cfg.skins||{};cfg.skins[st.table||cfg.table]=st.skin;delete st.skin;}
  Object.assign(cfg,st);
  if(typeof applyDisplay==='function')applyDisplay();
  // applyDisplay rebuilds only the key light's map; a spot map made under PCF has no VSM blur target and crashes the VSM pass
  if(typeof shadowMapDrop==='function')scene.traverse(o=>{if(o.isLight&&o.shadow)shadowMapDrop(o.shadow);});
  if(typeof grassApply==='function')grassApply();
  if(typeof applyFog==='function')applyFog();
  await cbWait(ensureMatchAssets);
  if(typeof refreshBallReflect==='function')refreshBallReflect();
  rebuildRodMen();applyColors();
  if(typeof drawField==='function')await cbWait(drawField);
  if(typeof ballModel!=='undefined'&&!ballModel)await wait(1500);
  S.seedNext=o.seed>>>0;startMatchNow('ai');
  if(typeof ensureExplosionModel==='function')await Promise.all([0,1].map(t=>cbWait(d=>ensureExplosionModel(activeModel(t).id,d))));
  if(typeof warmFlush==='function')warmFlush();
  await wait(400);
  if(typeof warmFlush==='function')warmFlush();
  DIR.ev=[];DIR.cas=null;
  clockStart();casTick();
 }
 function hash(){
  let h=2166136261;const mix=v=>{h=Math.imul(h^Math.round(v*1e4),16777619);};
  for(const b of S.balls){mix(b.cur.x);mix(b.cur.y);mix(b.cur.z);}
  for(const r of rods){mix(r.offset);mix(r.angle);}
  mix(S.score[0]);mix(S.score[1]);return h>>>0;
 }
 async function save(rel,data,type){
  const r=await fetch('/__save/'+rel,{method:'POST',body:data,headers:{'Content-Type':type||'application/octet-stream'}});
  if(!r.ok)throw new Error('save failed '+rel);
 }

 // --- scout: sim only; events, the ball track at 60 Hz, a determinism hash every half second ---
 window.dirScout=async function(o){
  o=Object.assign({take:'take',seed:1,secs:240,set:{},after:6},o||{});
  await setup(o);
  const per=Math.round(1/(60*DIR.tick)),chkN=Math.round(0.5/DIR.tick),n=Math.round(o.secs/DIR.tick),p=[],chk=[],rp=[];
  let endAt=-1;const w0=performance.now();
  for(let i=1;i<=n;i++){
   step();
   if(i%per===0){const b=S.balls[0];if(b)p.push(+b.cur.x.toFixed(3),+b.cur.y.toFixed(3),+b.cur.z.toFixed(3));else p.push(null,null,null);
    for(const r of rods)rp.push(+r.offset.toFixed(3),+r.angle.toFixed(3));}
   if(i%chkN===0)chk.push([i,hash()]);
   casTick();
   if(S.phase==='win'&&endAt<0)endAt=i;
   if(endAt>=0&&i-endAt>o.after/DIR.tick)break;
   if(i%(per*600)===0)log('scout '+(i*DIR.tick).toFixed(0)+'s  score '+S.score.join('-')+'  '+((performance.now()-w0)/1000).toFixed(0)+'s wall');
  }
  const out={take:o.take,seed:o.seed>>>0,set:o.set,cfg:o.cfg||{},tick:DIR.tick,secs:+(DIR.i*DIR.tick).toFixed(3),score:S.score.slice(),
   trk:{dt:per*DIR.tick,p},rods:{meta:rods.map(r=>({x:r.x,team:r.team,role:r.role,z:r.baseZ.slice()})),p:rp},chk,ev:DIR.ev};
  await save('director/'+o.take+'/scout.json',JSON.stringify(out),'application/json');
  const goals=DIR.ev.filter(e=>e.type==='goal'),ai={};for(const e of DIR.ev)if(e.type==='ai')ai[e.what]=(ai[e.what]||0)+e.n;
  return {take:o.take,secs:out.secs,score:out.score,goals:goals.map(g=>({t:g.t,team:g.team,kind:g.kind,v:g.v})),
   ev:DIR.ev.filter(e=>e.type!=='ai'&&e.type!=='banner'&&e.type!=='snd').length,ai,wall:+((performance.now()-w0)/1000).toFixed(1)};
 };

 // --- the ball track: raw, gaussian-smoothed (sg seconds; 0 = linear), velocity ---
 function trkV(k){const a=DIR.trk.p,i=k*3;return a[i]==null?null:[a[i],a[i+1],a[i+2]];}
 function trkSm(D,sg){
  const T=DIR.trk,n=T.p.length/3,f=D/T.dt;
  if(!(sg>0)){const k=clamp(Math.floor(f),0,n-1),a=trkV(k),b=trkV(Math.min(n-1,k+1)),u=f-k;
   if(a&&b)return [lerp(a[0],b[0],u),lerp(a[1],b[1],u),lerp(a[2],b[2],u)];return a||b||trkNear(k);}
  const r=Math.ceil(3*sg/T.dt),k0=Math.max(0,Math.floor(f)-r),k1=Math.min(n-1,Math.ceil(f)+r);
  let w=0,x=0,y=0,z=0;
  for(let k=k0;k<=k1;k++){const v=trkV(k);if(!v)continue;const d=(k-f)*T.dt,g=Math.exp(-d*d/(2*sg*sg));w+=g;x+=v[0]*g;y+=v[1]*g;z+=v[2]*g;}
  return w>1e-9?[x/w,y/w,z/w]:trkNear(clamp(Math.round(f),0,n-1));
 }
 function trkNear(k){const n=DIR.trk.p.length/3;for(let d=0;d<n;d++){const a=trkV(k-d>=0?k-d:0);if(a&&k-d>=0)return a;const b=k+d<n?trkV(k+d):null;if(b)return b;}return [0,2,0];}
 // a rod's slide at D, smoothed like the ball (needs a scout with rod tracks)
 function rodSm(ri,D,sg){
  const R=DIR.rods,n8=R.meta.length,n=R.p.length/(2*n8),f=D/DIR.trk.dt,g=k=>R.p[(clamp(k,0,n-1)*n8+ri)*2];
  if(!(sg>0)){const k=Math.floor(f);return lerp(g(k),g(k+1),f-k);}
  const r=Math.ceil(3*sg/DIR.trk.dt);let w=0,z=0;
  for(let k=Math.floor(f)-r;k<=Math.ceil(f)+r;k++){const d=(k-f)*DIR.trk.dt,q=Math.exp(-d*d/(2*sg*sg));w+=q;z+=g(k)*q;}
  return z/w;
 }
 // a camera target: 'ball', [x,y,z], {rod,man,y,dx,dz,sm} (a man), {ball:1,dx,dy,dz,fix:{x,y,z},sm}, {mix:[a,b],w}
 function tgt(t,D,sm,cl){
  if(t==null||t==='ball')return lim(trkSm(D,sm),cl);
  if(Array.isArray(t))return t;
  if(t.mix){const a=tgt(t.mix[0],D,sm,cl),b=tgt(t.mix[1],D,sm,cl),w=t.w!=null?t.w:0.5;return [lerp(a[0],b[0],w),lerp(a[1],b[1],w),lerp(a[2],b[2],w)];}
  if(t.rod!=null){const m=DIR.rods.meta[t.rod];return [m.x+(t.dx||0),t.y!=null?t.y:4,m.z[t.man|0]+rodSm(t.rod,D,t.sm!=null?t.sm:sm)+(t.dz||0)];}
  const b=fix(lim(trkSm(D+(t.lead||0),t.sm!=null?t.sm:sm),cl),t.fix);return [b[0]+(t.dx||0),b[1]+(t.dy||0),b[2]+(t.dz||0)];
 }
 function trkVel(D,sg){const h=0.05,a=trkSm(D-h,sg),b=trkSm(D+h,sg);return [(b[0]-a[0])/(2*h),(b[1]-a[1])/(2*h),(b[2]-a[2])/(2*h)];}

 // --- cameras ---
 const ease=u=>u*u*(3-2*u);
 function iv(v,u,def){if(v==null)return def;if(Array.isArray(v)&&v.length===2&&typeof v[0]==='number')return lerp(v[0],v[1],u);return v;}
 function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
 function fix(p,f){if(!f)return p;return [f.x!=null?f.x:p[0],f.y!=null?f.y:p[1],f.z!=null?f.z:p[2]];}
 function lim(p,c){if(!c)return p;return [clamp(p[0],c[0],c[1]),p[1],clamp(p[2],c[2],c[3])];}
 // Catmull-Rom through keys [{u,p}] (u 0..1, spread evenly when missing)
 function crv(keys,u,f){
  const n=keys.length;if(n===1)return keys[0][f];
  const us=keys.map((k,i)=>k.u!=null?k.u:i/(n-1));
  let s=0;while(s<n-2&&u>us[s+1])s++;
  const t=clamp((u-us[s])/Math.max(1e-6,us[s+1]-us[s]),0,1),P=i=>keys[clamp(i,0,n-1)][f];
  const p0=P(s-1),p1=P(s),p2=P(s+1),p3=P(s+2),o=[];
  for(let a=0;a<3;a++)o.push(0.5*((2*p1[a])+(-p0[a]+p2[a])*t+(2*p0[a]-5*p1[a]+4*p2[a]-p3[a])*t*t+(-p0[a]+3*p1[a]-3*p2[a]+p3[a])*t*t*t));
  return o;
 }
 function shake(c,j){
  if(!c.shake)return [0,0,0];
  const a=c.shake,t=j/DIR.fps,q=k=>Math.sin(t*(1.3+k*0.71))*0.6+Math.sin(t*(2.9+k*1.37)+k)*0.3+Math.sin(t*(6.1+k*2.1)+2*k)*0.1;
  return [q(1)*a,q(2)*a*0.6,q(3)*a];
 }
 // a shot at director time D, u = 0..1 through the shot in OUTPUT frames (so a camera keeps moving through a hold)
 function camEval(c,D,u){
  const e=c.ease===false?u:ease(u),sm=c.sm!=null?c.sm:0.35;
  let p,l,fov=iv(c.fov,e,40);
  if(c.type==='orbit'){
   const ce=add(tgt(c.at,D,sm,c.clamp),[0,iv(c.lift,e,0),0]);
   const yw=iv(c.yaw,e,0)*Math.PI/180,pt=iv(c.pitch,e,25)*Math.PI/180,d=iv(c.dist,e,80);
   p=[ce[0]+d*Math.cos(pt)*Math.sin(yw),ce[1]+d*Math.sin(pt),ce[2]+d*Math.cos(pt)*Math.cos(yw)];l=ce;
  }else if(c.type==='follow'){
   const off=c.off||[0,30,60],lo=c.look||[0,0,0];
   const at=c.at!=null&&c.at!=='ball'?tgt(c.at,D+(c.lead||0),sm,c.clamp):lim(trkSm(D+(c.lead||0),sm),c.clamp);
   p=fix(add(at,off.map((v,i)=>Array.isArray(v)?lerp(v[0],v[1],e):v)),c.fixP);
   const la=c.lookAt!=null?tgt(c.lookAt,D+(c.lookLead||0),c.smL!=null?c.smL:sm,c.clamp):lim(trkSm(D+(c.lookLead||0),c.smL!=null?c.smL:sm),c.clamp);
   l=fix(add(la,lo),c.fixL);
  }else if(c.type==='path'){
   const b=tgt(c.at,D,sm,c.clamp);
   p=crv(c.keys,e,'p');if(c.rel)p=add(p,b);
   const ks=c.keys[0].l==null||c.keys[0].l==='ball'?null:c.keys.map(k=>({u:k.u,l:Array.isArray(k.l)?k.l:tgt(k.l,D,sm,c.clamp)}));
   l=ks?add(crv(ks,e,'l'),c.lookOff||[0,0,0]):add(c.lookAt!=null?tgt(c.lookAt,D,sm,c.clamp):b,c.lookOff||[0,0,0]);
   if(c.keys[0].fov!=null)fov=crv(c.keys.map(k=>({u:k.u,f:[k.fov,0,0]})),e,'f')[0];
  }else if(c.type==='ball'){
   const b=trkSm(D,sm),v=trkVel(D,c.smV||0.6),h=Math.hypot(v[0],v[2]),dx=h>3?v[0]/h:(c.dir||1),dz=h>3?v[2]/h:0;
   const back=iv(c.back,e,14),up=iv(c.up,e,5),ah=iv(c.ahead,e,20);
   p=[b[0]-dx*back,b[1]+up,b[2]-dz*back];l=[b[0]+dx*ah,(c.lookY!=null?c.lookY:2),b[2]+dz*ah];
  }else{p=c.p||[0,90,90];l=c.l||[0,0,0];}
  return {p,l,fov,roll:iv(c.roll,e,0)};
 }
 function camApply(c,D,u,j){
  const v=camEval(c,D,u),s=shake(c,j);
  camera.near=c.near||0.4;camera.far=c.far||1600;
  camera.position.set(v.p[0]+s[0],v.p[1]+s[1],v.p[2]+s[2]);camera.up.set(0,1,0);
  camera.lookAt(v.l[0]+s[0]*0.5,v.l[1]+s[1]*0.5,v.l[2]+s[2]*0.5);
  if(v.roll)camera.rotateZ(v.roll*Math.PI/180);
  let f=v.fov;
  const q=typeof VFX!=='undefined'&&VFX.cam;
  if(q&&c.punch!==false){camera.position.x+=q.ax||0;camera.position.z+=q.az||0;f+=q.af||0;}
  camera.fov=f;camera.updateProjectionMatrix();
 }

 // --- a plan's frames: speed keys [[D,s]...], holds [{at,secs}], shots by D range ---
 function spd(c,D){const k=c.speed;if(!k||!k.length)return 1;if(D<=k[0][0])return k[0][1];
  for(let i=1;i<k.length;i++)if(D<=k[i][0]){const a=k[i-1],b=k[i];return lerp(a[1],b[1],(D-a[0])/(b[0]-a[0]));}return k[k.length-1][1];}
 // c.frames renders exactly that many output frames (else until c.to); a hold is {at, secs|frames}; a shot starts at D (from) or at an output frame (fromF)
 function frameList(c,fps){
  const out=[],holds=(c.hold||[]).slice().sort((a,b)=>a.at-b.at),N=c.frames||0;let D=c.from;
  while(N?out.length<N:D<c.to-1e-9){
   const s=Math.max(0.01,spd(c,D));out.push({D,s});
   const nD=D+s/fps;
   for(const h of holds)if(h.at>D&&h.at<=nD)for(let k=0;k<(h.frames!=null?h.frames:Math.round(h.secs*fps));k++)out.push({D:h.at,s:0,hold:true});
   D=nD;
  }
  if(N)out.length=N;
  const shots=(c.shots||[{type:'game',mode:0}]).map(s=>Object.assign({from:c.from},s));
  out.forEach((f,j)=>{let k=0;for(let i=0;i<shots.length;i++){const sh=shots[i];if(sh.fromF!=null?j>=sh.fromF:f.D>=sh.from-1e-9)k=i;}f.k=k;});
  for(let i=0;i<shots.length;i++){const idx=out.map((f,j)=>f.k===i?j:-1).filter(j=>j>=0);
   idx.forEach((j,n)=>{out[j].u=idx.length>1?n/(idx.length-1):0;});}
  return {fr:out,shots};
 }
 function sampleTicks(f,c,fps){
  const B=c.blur===false?{n:1}:Object.assign({n:5,shutter:0.5},c.blur||{});
  const end=Math.round(f.D/DIR.tick);
  if(f.hold||B.n<=1||f.s<=0)return [end];
  const w=B.shutter*f.s/fps,t=[];
  for(let k=0;k<B.n;k++)t.push(Math.round((f.D-w*(1-k/(B.n-1)))/DIR.tick));
  return [...new Set(t)].sort((a,b)=>a-b);
 }

 // --- post: bloom, depth of field, grade, aberration, vignette, grain on the finished (motion-blurred) frame ---
 //   plan.post <- clip.post <- shot.post, merged: {exp, temp, con, sat, lift:[r,g,b], gamma:[r,g,b], gain:[r,g,b], vig, grain, ca,
 //    bloom:{thr,knee,str}, dof:{at:'ball'|[x,y,z]|dist, off, s (blur px where depth doubles), max (px behind), near (px in front)}}
 // depth of field blurs an opaque-only pass and adds just the blur's difference to the frame, so glows and particles stay sharp
 const PP={};
 const PPV='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
 function ppMat(fs,u){return new THREE.ShaderMaterial({vertexShader:PPV,fragmentShader:fs,uniforms:u,depthTest:false,depthWrite:false});}
 function ppInit(w,h){
  if(PP.w===w&&PP.h===h)return;
  PP.w=w;PP.h=h;
  const rt=(a,b,f)=>new THREE.WebGLRenderTarget(a,b,{type:f?THREE.HalfFloatType:THREE.UnsignedByteType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});
  PP.cvIn=document.createElement('canvas');PP.cvIn.width=w;PP.cvIn.height=h;
  PP.src=new THREE.CanvasTexture(PP.cvIn);PP.src.minFilter=PP.src.magFilter=THREE.LinearFilter;PP.src.generateMipmaps=false;
  PP.opq=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  PP.opq.texture.encoding=THREE.sRGBEncoding;   // the screen's encoding, so the opaque pass compiles nothing new and matches the frame
  PP.opq.depthTexture=new THREE.DepthTexture(w,h);PP.opq.depthTexture.type=THREE.UnsignedIntType;
  PP.lin=rt(w,h,1);PP.linA=rt(w,h,1);PP.half=rt(w>>1,h>>1,1);PP.dof=rt(w>>1,h>>1,1);
  PP.bl=[];for(let k=1;k<=6;k++)PP.bl.push(rt(Math.max(2,w>>k),Math.max(2,h>>k),1));
  PP.blu=PP.bl.map(r=>rt(r.width,r.height,1));
  PP.cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);PP.scene=new THREE.Scene();
  PP.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));PP.quad.frustumCulled=false;PP.scene.add(PP.quad);
  PP.mLin=ppMat('uniform sampler2D t;varying vec2 vUv;void main(){gl_FragColor=vec4(pow(texture2D(t,vUv).rgb,vec3(2.2)),1.);}',{t:{value:null}});
  // the opaque pass: linear colour, signed blur radius (px) in alpha
  PP.mCoc=ppMat(`#include <packing>
   uniform sampler2D t,tDep;uniform float near,far,zf,s,mx,mn;varying vec2 vUv;
   void main(){vec3 c=pow(texture2D(t,vUv).rgb,vec3(2.2));float d=texture2D(tDep,vUv).x;
    float z=d>=0.99999?1e5:-perspectiveDepthToViewZ(d,near,far);float coc=clamp(s*(z-zf)/max(z,1e-3),-mn,mx);
    gl_FragColor=vec4(c,coc);}`,{t:{value:null},tDep:{value:null},near:{value:0.4},far:{value:1600},zf:{value:50},s:{value:20},mx:{value:20},mn:{value:20}});
  PP.mCopy=ppMat('uniform sampler2D t;varying vec2 vUv;void main(){gl_FragColor=texture2D(t,vUv);}',{t:{value:null}});
  // gather bokeh at half res: a farther sample may not spill over a sharper nearer pixel
  PP.mDof=ppMat(`uniform sampler2D t;uniform vec2 px;varying vec2 vUv;
   void main(){vec4 c0=texture2D(t,vUv);float r0=abs(c0.a)*0.5;vec3 acc=c0.rgb;float ws=1.;
    for(int i=0;i<72;i++){float r=sqrt((float(i)+0.5)/72.)*12.;float a=float(i)*2.39996;vec2 o=vec2(cos(a),sin(a))*r;
     vec4 sm=texture2D(t,vUv+o*px);float rs=abs(sm.a)*0.5;float lim=sm.a>c0.a?min(rs,r0):rs;
     float w=smoothstep(r-1.,r+0.5,lim);acc+=sm.rgb*w;ws+=w;}
    gl_FragColor=vec4(acc/ws,c0.a);}`,{t:{value:null},px:{value:new THREE.Vector2()}});
  PP.mBright=ppMat(`uniform sampler2D t;uniform float thr,knee;uniform vec2 px;varying vec2 vUv;
   void main(){vec3 c=vec3(0.);for(int i=0;i<4;i++){vec2 o=vec2(i==1||i==3?1.:-1.,i>1?1.:-1.)*px*0.5;c+=texture2D(t,vUv+o).rgb;}c*=0.25;
    float l=max(c.r,max(c.g,c.b));float sk=clamp(l-thr+knee,0.,2.*knee);sk=sk*sk/(4.*knee+1e-4);float w=max(sk,l-thr)/max(l,1e-4);
    gl_FragColor=vec4(c*w,1.);}`,{t:{value:null},thr:{value:0.8},knee:{value:0.3},px:{value:new THREE.Vector2()}});
  PP.mDown=ppMat(`uniform sampler2D t;uniform vec2 px;varying vec2 vUv;
   void main(){vec3 c=texture2D(t,vUv).rgb*0.125;
    c+=(texture2D(t,vUv+px*vec2(-1,-1)).rgb+texture2D(t,vUv+px*vec2(1,-1)).rgb+texture2D(t,vUv+px*vec2(-1,1)).rgb+texture2D(t,vUv+px*vec2(1,1)).rgb)*0.125;
    c+=(texture2D(t,vUv+px*vec2(-2,0)).rgb+texture2D(t,vUv+px*vec2(2,0)).rgb+texture2D(t,vUv+px*vec2(0,-2)).rgb+texture2D(t,vUv+px*vec2(0,2)).rgb)*0.0625;
    c+=(texture2D(t,vUv+px*vec2(-2,-2)).rgb+texture2D(t,vUv+px*vec2(2,-2)).rgb+texture2D(t,vUv+px*vec2(-2,2)).rgb+texture2D(t,vUv+px*vec2(2,2)).rgb)*0.03125;
    gl_FragColor=vec4(c,1.);}`,{t:{value:null},px:{value:new THREE.Vector2()}});
  PP.mUp=ppMat(`uniform sampler2D t,tLo;uniform vec2 px;varying vec2 vUv;
   void main(){vec3 u=vec3(0.);
    u+=texture2D(tLo,vUv+px*vec2(-1,-1)).rgb+texture2D(tLo,vUv+px*vec2(1,-1)).rgb+texture2D(tLo,vUv+px*vec2(-1,1)).rgb+texture2D(tLo,vUv+px*vec2(1,1)).rgb;
    u+=2.*(texture2D(tLo,vUv+px*vec2(-1,0)).rgb+texture2D(tLo,vUv+px*vec2(1,0)).rgb+texture2D(tLo,vUv+px*vec2(0,-1)).rgb+texture2D(tLo,vUv+px*vec2(0,1)).rgb);
    u+=4.*texture2D(tLo,vUv).rgb;gl_FragColor=vec4(texture2D(t,vUv).rgb+u/16.,1.);}`,{t:{value:null},tLo:{value:null},px:{value:new THREE.Vector2()}});
  PP.mFin=ppMat(`uniform sampler2D tLin,tA,tDof,tBl;uniform float useD,bstr,expo,con,sat,vig,grain,ca,fr,asp,temp;uniform vec3 lift,gam,gain;varying vec2 vUv;
   float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
   void main(){vec2 d=vUv-0.5;
    vec3 c=vec3(texture2D(tLin,vUv+d*ca).r,texture2D(tLin,vUv).g,texture2D(tLin,vUv-d*ca).b);
    if(useD>0.5){vec4 a=texture2D(tA,vUv);vec3 dd=abs(c-a.rgb);float cov=smoothstep(0.03,0.2,max(dd.r,max(dd.g,dd.b)));   // where glows and particles cover the opaque scene, its blur is not applied
     c=max(c+(texture2D(tDof,vUv).rgb-a.rgb)*smoothstep(0.6,2.5,abs(a.a))*(1.-cov),0.);}
    c+=texture2D(tBl,vUv).rgb*bstr;c*=expo;c*=vec3(1.+temp*0.06,1.,1.-temp*0.08);
    c=mix(c,vec3(0.8)+0.2*(1.-exp(-(c-0.8)/0.2)),step(0.8,c));
    c=pow(clamp(c,0.,1.),vec3(1./2.2));
    c=gain*(c+lift*(1.-c));c=pow(max(c,0.),1./gam);
    c=mix(c,c*c*(3.-2.*c),con);float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(l),c,sat);
    float r=length(d*vec2(asp,1.));c*=1.-vig*smoothstep(0.32,1.05,r);
    c+=(h(vUv*vec2(1931.,1097.)+fr)-0.5)*grain*(0.35+0.65*(1.-abs(l*2.-1.)));
    c+=(h(vUv*vec2(733.,1201.)-fr)-0.5)/255.;
    gl_FragColor=vec4(clamp(c,0.,1.),1.);}`,{tLin:{value:null},tA:{value:null},tDof:{value:null},tBl:{value:null},useD:{value:0},bstr:{value:0.2},expo:{value:1},con:{value:0},sat:{value:1},
    vig:{value:0.3},grain:{value:0.03},ca:{value:0.002},fr:{value:0},asp:{value:w/h},temp:{value:0},lift:{value:new THREE.Vector3()},gam:{value:new THREE.Vector3(1,1,1)},gain:{value:new THREE.Vector3(1,1,1)}});
 }
 function ppPass(m,target){PP.quad.material=m;renderer.setRenderTarget(target);rr(PP.scene,PP.cam);}
 // rows a low camera sits among (shot.cull): hidden for the draw, their shadows kept
 function cullRods(shot){
  const hid=[];if(!shot||!shot.cull)return hid;
  for(const r of rods)if(r.pivot.visible&&Math.abs(camera.position.x-r.x)<shot.cull&&camera.position.y<(shot.cullY||16))hid.push(r);
  return hid;
 }
 // the opaque scene again into PP.opq with its depth: transparent things, points, sprites and lines left out
 function ppOpaque(shot){
  const hid=cullRods(shot).map(r=>r.pivot),SM=renderer.shadowMap,au=SM.autoUpdate,nu=SM.needsUpdate;
  scene.traverseVisible(o=>{
   if(o.isPoints||o.isLine||o.isSprite){hid.push(o);return;}
   if(!o.isMesh)return;const m=o.material,ms=Array.isArray(m)?m:[m];
   if(ms.some(x=>!x||x.transparent||x.depthWrite===false||x.blending===THREE.AdditiveBlending))hid.push(o);
  });
  for(const o of hid)o.visible=false;
  SM.autoUpdate=false;SM.needsUpdate=false;
  try{renderer.setRenderTarget(PP.opq);renderer.clear();rr(scene,camera);}
  finally{renderer.setRenderTarget(null);for(const o of hid)o.visible=true;SM.autoUpdate=au;SM.needsUpdate=nu;}
 }
 function ppMerge(...a){const o={};for(const p of a)if(p)for(const k in p){if(p[k]&&typeof p[k]==='object'&&!Array.isArray(p[k]))o[k]=Object.assign({},o[k]||{},p[k]);else o[k]=p[k];}return o;}
 function ppRun(cx,cv,p,D,j,shot){
  const w=cv.width,h=cv.height;ppInit(w,h);
  const ix=PP.cvIn.getContext('2d');ix.globalCompositeOperation='copy';ix.drawImage(cv,0,0);PP.src.needsUpdate=true;
  const dof=p.dof&&p.dof.s>0;
  if(dof)ppOpaque(shot);
  const ac=renderer.autoClear;renderer.autoClear=true;
  try{
   PP.mLin.uniforms.t.value=PP.src;ppPass(PP.mLin,PP.lin);
   if(dof){
    const u=PP.mCoc.uniforms,a=p.dof.at;let zf=50;
    if(typeof a==='number')zf=a;else{const q=a==null||a==='ball'?trkSm(D,0.15):a;zf=camera.position.distanceTo(new THREE.Vector3(q[0],q[1],q[2]));}
    u.t.value=PP.opq.texture;u.tDep.value=PP.opq.depthTexture;u.near.value=camera.near;u.far.value=camera.far;
    u.zf.value=zf+(p.dof.off||0);u.s.value=p.dof.s;u.mx.value=p.dof.max||24;u.mn.value=p.dof.near!=null?p.dof.near:(p.dof.max||24);
    ppPass(PP.mCoc,PP.linA);
    PP.mCopy.uniforms.t.value=PP.linA.texture;ppPass(PP.mCopy,PP.half);
    PP.mDof.uniforms.t.value=PP.half.texture;PP.mDof.uniforms.px.value.set(1/(w>>1),1/(h>>1));ppPass(PP.mDof,PP.dof);
   }
   const B=Object.assign({thr:0.75,knee:0.3,str:0.25},p.bloom||{});
   PP.mBright.uniforms.t.value=PP.lin.texture;PP.mBright.uniforms.thr.value=B.thr;PP.mBright.uniforms.knee.value=B.knee;PP.mBright.uniforms.px.value.set(1/w,1/h);
   ppPass(PP.mBright,PP.bl[0]);
   for(let k=1;k<PP.bl.length;k++){PP.mDown.uniforms.t.value=PP.bl[k-1].texture;PP.mDown.uniforms.px.value.set(1/PP.bl[k-1].width,1/PP.bl[k-1].height);ppPass(PP.mDown,PP.bl[k]);}
   let lo=PP.bl[PP.bl.length-1];
   for(let k=PP.bl.length-2;k>=0;k--){const m=PP.mUp.uniforms;m.t.value=PP.bl[k].texture;m.tLo.value=lo.texture;m.px.value.set(1/lo.width,1/lo.height);ppPass(PP.mUp,PP.blu[k]);lo=PP.blu[k];}
   const f=PP.mFin.uniforms;f.tLin.value=PP.lin.texture;f.tA.value=PP.linA.texture;f.tDof.value=PP.dof.texture;f.tBl.value=lo.texture;f.useD.value=dof?1:0;
   f.bstr.value=B.str;f.expo.value=p.exp!=null?p.exp:1;f.con.value=p.con||0;f.sat.value=p.sat!=null?p.sat:1;f.vig.value=p.vig!=null?p.vig:0.3;
   f.grain.value=p.grain!=null?p.grain:0.03;f.ca.value=p.ca!=null?p.ca:0.002;f.fr.value=(j%997)*0.123;f.temp.value=p.temp||0;
   f.lift.value.fromArray(p.lift||[0,0,0]);f.gam.value.fromArray(p.gamma||[1,1,1]);f.gain.value.fromArray(p.gain||[1,1,1]);f.asp.value=w/h;
   ppPass(PP.mFin,null);
  }finally{renderer.setRenderTarget(null);renderer.autoClear=ac;}
  cx.globalCompositeOperation='copy';cx.drawImage(renderer.domElement,0,0,w,h);cx.globalCompositeOperation='source-over';
 }

 // --- shoot: the same take again, frames drawn for every clip of the plan ---
 window.dirShoot=async function(plan){
  if(typeof plan==='string')plan=await (await fetch('/'+plan,{cache:'no-store'})).json();
  const take=plan.take,sc=await (await fetch('/tools/build/director/'+take+'/scout.json',{cache:'no-store'})).json();
  if(sc.tick!==DIR.tick)throw new Error('scout tick '+sc.tick+' != '+DIR.tick);
  DIR.trk=sc.trk;DIR.rods=sc.rods||null;DIR.fx=plan.fx||null;const fps=DIR.fps=plan.fps||60;
  // plan.set / plan.cfg restyle the take (room, skin, pitch, figurines, kits); the desync report says if one touched the sim
  await setup({seed:sc.seed,set:Object.assign({},sc.set,plan.set||{}),cfg:Object.assign({},sc.cfg||{},plan.cfg||{})});
  const W=innerWidth,H=innerHeight,ss=plan.ss||1;
  renderer.setPixelRatio(ss);renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix();
  if(typeof shadowDirty==='function')shadowDirty();
  const cv=document.createElement('canvas');cv.width=plan.w||W;cv.height=plan.h||H;
  const cx=cv.getContext('2d');cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality='high';
  const chk=new Map(sc.chk),bad=[];let flight=[],nOut=0;const w0=performance.now();
  const clips=plan.clips.slice().sort((a,b)=>a.from-b.from);
  const fmt=plan.fmt||'jpeg',mime=fmt==='png'?'image/png':'image/jpeg',ext=fmt==='png'?'.png':'.jpg';
  const adv=to=>{while(DIR.i<to){step();casTick();const h=chk.get(DIR.i);if(h!=null&&h!==hash()&&bad.length<20)bad.push(DIR.i);}};
  // cull: a low camera hides the rows within that many units of it in x, so it can sit among the rods; their shadows stay (the map is drawn first, with them)
  const drawNow=(last,shot)=>{
   const hid=[],SM=renderer.shadowMap,au=SM.autoUpdate;
   DIR.draw=true;
   try{
    updateBallReflect();
    hid.push(...cullRods(shot));
    if(hid.length){if(SM.enabled&&(au||SM.needsUpdate))rr(scene,camera);SM.autoUpdate=false;SM.needsUpdate=false;}
    for(const r of hid)r.pivot.visible=false;
    rr(scene,camera);if(last)hudRender(0);
   }finally{DIR.draw=false;SM.autoUpdate=au;for(const r of hid)r.pivot.visible=true;}
  };
  const report=[];
  for(const c of clips){
   const L=frameList(c,fps),dir='director/'+take+'/'+(c.name||('clip_'+c.from));
   const hud=!!c.hud;let j=0;
   if(!hud&&typeof hudHint==='function')hudHint(null,null);
   for(const f of L.fr){
    if(c.only&&(j<c.only[0]||j>=c.only[1])){adv(Math.round(f.D/DIR.tick));j++;continue;}   // outside the saved range: the sim runs, nothing is drawn
    const shot=L.shots[f.k],ticks=sampleTicks(f,c,fps);
    DIR.shot=shot;
    cx.globalAlpha=1;
    for(let k=0;k<ticks.length;k++){
     adv(ticks[k]);
     if(shot.type!=='game')camApply(shot,DIR.i*DIR.tick,f.u,j);
     drawNow(k===ticks.length-1,shot);
     cx.globalAlpha=1/(k+1);cx.drawImage(renderer.domElement,0,0,cv.width,cv.height);
    }
    cx.globalAlpha=1;
    const pp=ppMerge(plan.post,c.post,shot.post);
    if(plan.post||c.post||shot.post)ppRun(cx,cv,pp,DIR.i*DIR.tick,j,shot);
    if(hud&&typeof HUD!=='undefined'&&HUD.c)cx.drawImage(HUD.c,0,0,cv.width,cv.height);
    if(c.grade)grade(cx,cv,c.grade);
    j++;nOut++;
    const name=dir+'/frame_'+String(j).padStart(5,'0')+ext;
    flight.push(new Promise(res=>cv.toBlob(b=>res(save(name,b,mime)),mime,plan.q||0.95)));
    if(flight.length>=8){await Promise.all(flight);flight=[];}
    if(nOut%120===0)log('shoot '+nOut+' frames  D '+f.D.toFixed(2)+'  '+((performance.now()-w0)/1000).toFixed(0)+'s wall');
   }
   await Promise.all(flight);flight=[];
   await save(dir+'/frames.json',JSON.stringify(L.fr.map(f=>+f.D.toFixed(5))),'application/json');   // output frame -> director time, for the sound cues
   report.push({name:c.name||('clip_'+c.from),frames:j,secs:+(j/fps).toFixed(2),dir:'tools/build/'+dir});
   DIR.shot=null;
  }
  await save('director/'+take+'/'+(plan.name||'shoot')+'.txt',
   'take '+take+'  seed '+sc.seed+'  fps '+fps+'  '+cv.width+'x'+cv.height+'  ss '+ss+'\r\n'+report.map(r=>r.name+'  '+r.frames+' frames  '+r.secs+'s').join('\r\n')+'\r\n','text/plain');
  return {clips:report,desync:bad.length?bad.map(i=>+(i*DIR.tick).toFixed(2)):0,wall:+((performance.now()-w0)/1000).toFixed(1)};
 };
 // a light vignette and lift; the real grade is the editor's
 function grade(cx,cv,g){
  if(g.vignette){const r=Math.hypot(cv.width,cv.height)/2,gr=cx.createRadialGradient(cv.width/2,cv.height/2,r*0.45,cv.width/2,cv.height/2,r);
   gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,'+g.vignette+')');cx.fillStyle=gr;cx.fillRect(0,0,cv.width,cv.height);}
 }

 // --- stills: one frame per moment for picking shots, plus a contact sheet ---
 //   dirStills({take,at:[D...],cams:[shot...],cols:4,tw:480})  -> director/<take>/stills/
 window.dirStills=async function(o){
  const clips=[];
  o.at.forEach((D,i)=>(o.cams||[{type:'game',mode:0}]).forEach((cam,k)=>clips.push({name:'stills/s'+String(i).padStart(2,'0')+'_c'+k,from:D,to:D+0.5/60,blur:false,hud:!!o.hud,shots:[cam]})));
  const r=await window.dirShoot({take:o.take,fps:60,fmt:'jpeg',q:0.9,name:'stills',set:o.set,cfg:o.cfg,ss:o.ss,post:o.post,fx:o.fx,clips});
  const cols=o.cols||4,tw=o.tw||480,th=Math.round(tw*innerHeight/innerWidth),n=clips.length;
  const sh=document.createElement('canvas');sh.width=cols*tw;sh.height=Math.ceil(n/cols)*th;
  const sx=sh.getContext('2d');sx.fillStyle='#000';sx.fillRect(0,0,sh.width,sh.height);sx.font='bold 16px sans-serif';
  for(let i=0;i<n;i++){
   const img=new Image();img.src='/tools/build/director/'+o.take+'/'+clips[i].name+'/frame_00001.jpg?'+Date.now();
   await new Promise(res=>{img.onload=res;img.onerror=res;});
   const x=(i%cols)*tw,y=Math.floor(i/cols)*th;sx.drawImage(img,x,y,tw,th);
   sx.fillStyle='#000a';sx.fillRect(x,y,150,22);sx.fillStyle='#fff';sx.fillText(clips[i].name.slice(7)+'  '+clips[i].from.toFixed(2),x+4,y+16);
  }
  await new Promise(res=>sh.toBlob(b=>res(save('director/'+o.take+'/stills/sheet.jpg',b,'image/jpeg')),'image/jpeg',0.9));
  return Object.assign(r,{sheet:'tools/build/director/'+o.take+'/stills/sheet.jpg'});
 };

 // a contact sheet of a rendered clip: every `every`-th frame, labelled with its number
 //   dirSheet({dir:'t1/goal1',every:24,cols:5,tw:384,n:532})  -> director/<dir>_sheet.jpg
 window.dirSheet=async function(o){
  o=Object.assign({every:24,cols:5,tw:384},o||{});
  const ids=[];for(let i=1;i<=o.n;i+=o.every)ids.push(i);
  const th=Math.round(o.tw*9/16),sh=document.createElement('canvas');sh.width=o.cols*o.tw;sh.height=Math.ceil(ids.length/o.cols)*th;
  const sx=sh.getContext('2d');sx.font='bold 14px sans-serif';
  for(let k=0;k<ids.length;k++){
   const img=new Image();img.src='/tools/build/director/'+o.dir+'/frame_'+String(ids[k]).padStart(5,'0')+(o.ext||'.jpg');
   await new Promise(res=>{img.onload=res;img.onerror=res;});
   if(!img.naturalWidth)continue;
   const x=(k%o.cols)*o.tw,y=Math.floor(k/o.cols)*th;sx.drawImage(img,x,y,o.tw,th);
   sx.fillStyle='#000a';sx.fillRect(x,y,52,18);sx.fillStyle='#fff';sx.fillText(String(ids[k]),x+4,y+14);
  }
  await new Promise(res=>sh.toBlob(b=>res(save('director/'+o.dir+'_sheet.jpg',b,'image/jpeg')),'image/jpeg',0.88));
  return 'tools/build/director/'+o.dir+'_sheet.jpg';
 };

 // what a set can name
 window.dirList=function(){
  return {rooms:Object.keys(CONFIG.rooms),tables:Object.keys(CONFIG.tables).map(t=>t+':'+Object.keys(CONFIG.tables[t].skins||{}).join('|')),
   pitches:Object.keys(CONFIG.pitches),models:CONFIG.playerModel.models.map(m=>m.id),balls:Object.keys(CONFIG.ballTypes),
   camModes:CONFIG.camera.modes.length,diffs:Object.keys(CONFIG.diffs)};
 };
})();
