// Pass-lane soak: why AI passes get cut out. Every AI pass (and the dribble release): exit speed and heading against the aim; the first opposing touch: was the lane shut when the ball left, or did the man slide into it, how far, in how long.
//      node tools/page-run.js tools/passlane-soak.js "plSoak({seeds:24,secs:120,diff:'pro'})"
//      plSoak({seeds,secs,seed0,diff,set:{'swings.pass.strike':0.06}})   // set: CONFIG paths overridden for the run, restored after
//      plReach({v})   // the run-up's reach by ball mass (CONFIG.ai.catch.steer.free.reach): the steepest launch off the front of the boot kickLaunch predicts at the slowest run, the least over relMin..relMax
// gap = how far the cutting man's foot was off the ball's line when it left (foot half-width + ball radius taken off): <= 0 = he was already in the lane; byTh = exit heading (rad) -> passes, share the own team took next
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__pl_kr0)window.__pl_kr0=kickRod;
 if(!window.__pl_mc0)window.__pl_mc0=momContact;
 let T=null;
 const kindOf=(r,style)=>style==='pass'?(r.pinB?'pinPass':r.act==='run'?'runPass':r.act==='dribble'?'dribPass':'kickPass'):(style==='shoot'&&r.act==='dribble')?'dribble':null;
 const lineZ=(e,x)=>e.z0+e.vz/e.vx*(x-e.x0);
 const reach=()=>FOOT_BOX.z+BALL_R;
 function rowGap(o,e,offs){let g=1e9,gi=-1;const z=lineZ(e,o.x),off=offs.get(o);for(let i=0;i<o.baseZ.length;i++){if(!manLive(o,i))continue;const d=Math.abs(z-(o.baseZ[i]+off))-reach();if(d<g){g=d;gi=i;}}return {g,i:gi};}
 window.momContact=function(b,r){
  const o=__pl_mc0.apply(this,arguments);
  if(T)for(let i=T.open.length-1;i>=0;i--){const k=T.open[i];
   if(r===k.rod)continue;
   k.next=r.team===k.team?'own':'opp';k.nextRole=r.role;k.nextT=S.time-k.t;T.open.splice(i,1);
   if(k.next==='opp'&&k.ex){
    const e=k.ex,G=rowGap(r,e,k.offs);
    k.cut={role:r.role,between:(r.x-e.x0)*e.dir>0&&(k.aim?(r.x-k.aim.x)*e.dir<0:true),gap:G.g,moved:Math.abs(r.offset-k.offs.get(r)),t:S.time-e.t,need:G.g>0?G.g/Math.max(1e-3,S.time-e.t):0};
   }
  }
  return o;
 };
 window.kickRod=function(r,style,aim,curve){
  const kind=T&&r.kickT<0&&!isUserRod(r)?kindOf(r,style):null;
  if(kind){
   let b=null,bd=1e9;for(const q of S.balls){if(q.scored)continue;const d=Math.abs(q.m.position.x-r.x);if(d<bd){bd=d;b=q;}}
   if(b){const offs=new Map();for(const o of rods)offs.set(o,o.offset);const k={rod:r,b,t:S.time,team:r.team,role:r.role,kind,aim:aim?{x:aim.x,z:aim.z}:null,offs,ex:null,next:null,cut:null};T.all.push(k);T.open.push(k);}
  }
  return __pl_kr0.apply(this,arguments);
 };
 function exits(){
  for(const k of T.open){
   if(k.ex||k.miss)continue;
   const p=k.b.m.position,v=k.b.v,dir=k.rod.kickDir,rel=(p.x-k.rod.x)*dir;
   if(S.time-k.t>0.6){k.miss=true;continue;}
   if(rel>FOOT_BOX.x+BALL_R+1&&v.x*dir>3){
    const offs=new Map();for(const o of rods)offs.set(o,o.offset);k.offs=offs;   // where every man stood as it left
    k.ex={x0:p.x,z0:p.z,vx:v.x,vz:v.z,dir,spd:Math.hypot(v.x,v.z),t:S.time};
    if(k.aim)k.err=lineZ(k.ex,k.aim.x)-k.aim.z;
    let gm=1e9,o1=null;for(const o of rods){if(o.team===k.team)continue;const a=(o.x-p.x)*dir;if(a<=0.5||(k.aim&&(o.x-k.aim.x)*dir>=0))continue;const G=rowGap(o,k.ex,offs);if(G.g<gm){gm=G.g;o1=o;}}
    k.shutAt=o1?gm:null;   // the most covered opposing row between it and the aim, at exit
   }
  }
 }
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return +s[s.length>>1].toFixed(2);};
 const sh=(L,f)=>L.length?+(L.filter(f).length/L.length).toFixed(2):null;
 const k0=o=>{for(const q in o)o[q].own=+(o[q].own/o[q].n).toFixed(2);return o;};
 function plSoak(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,diff:null,set:null},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],olds=[];
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  T={all:[],open:[],m:0};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);
     updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     exits();
     for(let j=T.open.length-1;j>=0;j--)if(S.time-T.open[j].t>2.5){T.open[j].next='none';T.open.splice(j,1);}
    }
    for(const k of T.open)k.next='none';T.open.length=0;T.m++;
   }
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];for(const [k,v] of olds.reverse())setPath(k,v);}
  const m=Math.max(1,T.m),D=DIFFS[o.diff||cfg.diffRed];
  const R={diff:o.diff||cfg.diffRed,matches:T.m,wallS:+((performance.now()-t0)/1000).toFixed(1),aiSlide:D.speed,react:D.react,reactDelay:D.reactDelay,reach:+reach().toFixed(2),kinds:{}};
  for(const kd of [...new Set(T.all.map(k=>k.kind))]){
   const L=T.all.filter(k=>k.kind===kd),X=L.filter(k=>k.ex),C=L.filter(k=>k.cut),Co=C.filter(k=>k.cut.gap>0);
   R.kinds[kd]={perMatch:+(L.length/m).toFixed(2),own:sh(L,k=>k.next==='own'),opp:sh(L,k=>k.next==='opp'),none:sh(L,k=>k.next==='none'),noExit:sh(L,k=>!k.ex),
    exitSpd:med(X.map(k=>k.ex.spd)),exitSpd25:(()=>{const s=X.map(k=>k.ex.spd).sort((a,b)=>a-b);return s.length?+s[s.length>>2].toFixed(1):null;})(),
    absErr:med(X.filter(k=>k.aim).map(k=>Math.abs(k.err))),errOver3:sh(X.filter(k=>k.aim),k=>Math.abs(k.err)>3),
    shutAtExit:sh(X.filter(k=>k.shutAt!=null),k=>k.shutAt<=0),
    cut:{n:C.length,between:sh(C,k=>k.cut.between),inLaneAlready:sh(C,k=>k.cut.gap<=0),gapMed:med(Co.map(k=>k.cut.gap)),moved:med(C.map(k=>k.cut.moved)),tMed:med(C.map(k=>k.cut.t)),needSpd:med(Co.map(k=>k.cut.need)),byRole:C.reduce((a,k)=>(a[k.cut.role]=(a[k.cut.role]||0)+1,a),{})},
    byRole:L.reduce((a,k)=>{const g=a[k.role]||(a[k.role]={n:0,opp:0});g.n++;if(k.next==='opp')g.opp++;return a;},{}),
    byTh:k0(X.reduce((a,k)=>{const h=Math.abs(Math.atan2(k.ex.vz,k.ex.vx*k.ex.dir)),q=h<0.3?'<0.3':h<0.45?'0.3-0.45':h<0.6?'0.45-0.6':'0.6+',g=a[q]||(a[q]={n:0,own:0});g.n++;if(k.next==='own')g.own++;return a;},{}))};
  }
  window.__pl_last=T.all;
  return R;
 }
 function plReach(o){
  o=Object.assign({diff:'pro',rels:5,dz:0.05,v:null},o||{});
  const FR=AIC.catch.steer.free,P=AIC.dribble.pass,keep=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=o.diff;cfg.diffBlue=o.diff;
  try{
   S.seedNext=1;startMatchNow('ai');S.phase='count';S.countT=0;serve();S.phase='play';
   const r=rods.find(q=>q.team===0&&q.role==='DEF'),b=S.balls[0],dir=r.kickDir,t0=b.t,v=o.v||FR.vMin,out={};
   for(const id in BALL_TYPES){const m=BALL_TYPES[id].mass;if(out[m]!=null)continue;b.t=BALL_TYPES[id];let lo=1e9;
    for(let k=0;k<o.rels;k++){const rel=FR.relMin+(FR.relMax-FR.relMin)*k/(o.rels-1);let hm=0;
     for(let dz=0;dz<=r.maxOff;dz+=o.dz){const V=Object.create(r);V.angle=0;V.slideV=v;V.offset=-dz;   // man 0 dz short of the ball, at the run's speed
      b.m.position.set(r.x+rel*dir,BALL_R,r.baseZ[0]);b.v.set(0,0,0);b.pinR=null;
      const L=kickLaunch(V,b,'pass',v);if(L&&passFaceOK(r,L.face*dir)&&L.forward>=P.assistMinVX)hm=Math.max(hm,L.heading);}
     lo=Math.min(lo,hm);}
    out[m]=+lo.toFixed(3);}
   b.t=t0;
   return {v,reach:Object.keys(out).map(Number).sort((a,c)=>a-c).map(m=>[m,out[m]]),now:FR.reach};
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
 }
 window.plSoak=plSoak;window.plReach=plReach;
})();
