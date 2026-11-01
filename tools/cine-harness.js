// cinematic camera harness. node tools/cine-harness.js
// runs the real js/cine.js and the camera cycle from js/fx.js (camTeamSide .. camMatchStart) on live CONFIG with a stub camera and scripted balls
// question: is the directed camera smooth (bounded pan speed and pan acceleration between cuts), paced (no cut before minT/2, none while a ball is due at a goal, shots held seconds),
// does it follow the beat (celebration after a goal, a fresh shot at a count, end shots cut once the play leaves their end), keep a tic-tac from rocking the frame, stay in a safe envelope,
// give the fov back, and is it offered only while nobody plays (an AI showdown opening on it, each kind of match keeping its own camera); each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;if(to&&b<0)throw new Error('slice miss: '+to);return src.slice(a,b);};
const FX=rd('js/fx.js');
const parts={cine:rd('js/cine.js'),cam:slice(FX,'function camTeamSide(){','let camMenuLook=null')};
const stubs="var S={seats:[],balls:[],phase:'play',camMode:0,camLookX:0,serveAt:null,kickTeam:-1};var RP={queued:false,team:0};"+
 "var Au={ui:function(){}};var TO=[];function toast(a,b){TO.push(a+' '+b);}function userRod(){return null;}function kickoffSpot(){return S.kickTeam<0?null:{x:S.kickTeam===0?-4:4,z:0};}"+
 "var camera={fov:55,aspect:16/9,position:{x:0,y:0,z:0,set:function(x,y,z){this.x=x;this.y=y;this.z=z;}},look:{x:0,y:0,z:0},"+
 "lookAt:function(x,y,z){this.look.x=x;this.look.y=y;this.look.z=z;},updateProjectionMatrix:function(){}};";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 // a seeded Math.random: the director's draws repeat run to run
 let sd=12345;const M=Object.create(Math);M.random=()=>{sd=(sd*1103515245+12345)>>>0;return sd/4294967296;};
 const ctx={console,Math:M,JSON,Date,Object,Array,Set,Map,Number,String,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.cine,g.cam,
  ';globalThis.X={S:S,RP:RP,TO:TO,CAM:CAM,F:F,camera:camera,CINE:CINE,CINE_SHOTS:CINE_SHOTS,cineSpr:cineSpr,cineUpdate:cineUpdate,cineOff:cineOff,cineGo:cineGo,cineRig:cineRig,'+
  'cineFovBase:cineFovBase,cineFovT:cineFovT,camModeOK:camModeOK,cycleCam:cycleCam,camMatchStart:camMatchStart};'].join(NL),ctx);
 return ctx.X;
}
const DT=1/60,deg=180/Math.PI;
function ball(x,z,vx,vz,pinR){return{m:{position:{x,y:1.9,z}},v:{x:vx||0,y:0,z:vz||0},pinR:pinR||null};}
function watch(X){X.S.seats=[];X.S.camMode=X.CAM.cine.mode;X.camera.fov=55;}
// a scripted AI match: rolls, pins, tic-tacs, shots into goals (goal hold, replay, count, serve) and outs; calls cineUpdate as main.js would (not during a replay)
// returns per-frame records {t,id,st,glide,hot,ph,p,l}
function match(X,secs){
 const S=X.S,C=X.CINE,hl=X.F.L/2,hw=X.F.W/2,out=[];
 let r=777;const R=()=>{r=(r*1664525+1013904223)>>>0;return r/4294967296;};
 let b=ball(0,0,30,10),mode='roll',mt=2,ph='count',pt=3.6,tt=0;S.balls=[];S.phase='count';S.kickTeam=-1;
 const rodOf=t=>({team:t,role:'ATT'});
 for(let f=0;f<secs*60;f++){
  tt+=DT;
  if(ph==='count'){pt-=DT;if(pt<=0){ph='play';S.phase='play';b=ball(S.kickTeam<0?0:(S.kickTeam===0?-4:4),0,0,0);S.balls=[b];mode='roll';mt=.5;}}
  else if(ph==='goal'){pt-=DT;if(pt<=0){if(X.RP.queued){ph='replay';S.phase='replay';pt=6;X.RP.queued=false;}else{ph='count';S.phase='count';pt=1.5;}}}
  else if(ph==='replay'){pt-=DT;if(pt<=0){ph='count';S.phase='count';pt=1.5;}}
  else{
   const p=b.m.position,v=b.v;mt-=DT;
   if(mode==='tictac'){p.z=b.tz+6*Math.sin(tt*12.6);v.z=75.6*Math.cos(tt*12.6);v.x=0;}
   else{p.x+=v.x*DT;p.z+=v.z*DT;if(Math.abs(p.z)>hw-2){v.z=-v.z;p.z=Math.sign(p.z)*(hw-2);}}
   if(Math.abs(p.x)>hl){
    if(Math.abs(p.z)<X.F.goalHalf){const tm=p.x>0?0:1;S.balls=[];X.RP.queued=true;X.RP.team=tm;S.kickTeam=1-tm;ph='goal';S.phase='goal';pt=2;S.serveAt=null;}
    else{S.balls=[];S.serveAt=p.x;ph='goal';S.phase='goal';pt=1.5;}
   }else if(mt<=0){
    b.pinR=null;const u=R();
    if(u<.3){mode='pin';mt=.8+R()*1.7;v.x=v.z=0;b.pinR=rodOf(R()<.5?0:1);}
    else if(u<.42){mode='tictac';mt=1+R()*2;b.tz=p.z;}
    else if(u<.62){mode='shot';mt=3;const g=R()<.5?1:-1,sp=80+R()*50,dx=g*hl-p.x,dz=(R()-.5)*(R()<.6?14:60)-p.z,h=Math.hypot(dx,dz);v.x=dx/h*sp;v.z=dz/h*sp;}
    else{mode='roll';mt=.6+R()*1.5;const a=R()*6.283,sp=15+R()*60;v.x=Math.cos(a)*sp;v.z=Math.sin(a)*sp;}
   }
  }
  const st=C.t;
  if(ph!=='replay')X.cineUpdate(DT);
  let vis=null;if(S.phase==='play'&&S.balls[0]){const P=S.balls[0].m.position,cp=X.camera.position,L=X.camera.look,f=[L.x-cp.x,L.y-cp.y,L.z-cp.z],fn=Math.hypot(...f);
   const F3=f.map(v=>v/fn),rn=Math.hypot(F3[0],F3[2]),R=[-F3[2]/rn,0,F3[0]/rn],U=[R[1]*F3[2]-R[2]*F3[1],R[2]*F3[0]-R[0]*F3[2],R[0]*F3[1]-R[1]*F3[0]],d=[P.x-cp.x,P.y-cp.y,P.z-cp.z];
   const cf=d[0]*F3[0]+d[1]*F3[1]+d[2]*F3[2],tn=Math.tan(X.camera.fov*Math.PI/360);
   vis=cf>0&&Math.abs(d[0]*U[0]+d[1]*U[1]+d[2]*U[2])<=tn*cf&&Math.abs(d[0]*R[0]+d[2]*R[2])<=tn*X.camera.aspect*cf;}
  out.push({vis,t:tt,id:C.id,st:C.t,prevT:st,glide:C.glide,hot:C.hot,ph:S.phase,p:[X.camera.position.x,X.camera.position.y,X.camera.position.z],l:[X.camera.look.x,X.camera.look.y,X.camera.look.z],bad:C.bad,d:C.d,sd:C.sd,calm:C.calm,hold:C.hold});
 }
 return out;
}
// pan speed / pan acceleration (deg/s, deg/s^2) and linear speed between cuts; cut = the shot clock reset with no glide
function smooth(rec){
 let w=0,a=0,v=0,acc=0,cuts=[],prevW=null,prevV=null,pv=null;
 for(let i=1;i<rec.length;i++){
  const A=rec[i-1],B=rec[i];if(B.ph==='replay'||A.ph==='replay'){prevW=prevV=null;continue;}
  const cut=B.st<A.st+1e-9&&!B.glide||B.id!==A.id&&!B.glide;
  if(cut){cuts.push(i);prevW=prevV=null;continue;}
  const da=[A.l[0]-A.p[0],A.l[1]-A.p[1],A.l[2]-A.p[2]],db=[B.l[0]-B.p[0],B.l[1]-B.p[1],B.l[2]-B.p[2]];
  const c=(da[0]*db[0]+da[1]*db[1]+da[2]*db[2])/(Math.hypot(...da)*Math.hypot(...db));
  const ww=Math.acos(Math.min(1,c))*deg/DT,vv=[(B.p[0]-A.p[0])/DT,(B.p[1]-A.p[1])/DT,(B.p[2]-A.p[2])/DT];
  w=Math.max(w,ww);v=Math.max(v,Math.hypot(...vv));
  if(prevW!=null){a=Math.max(a,Math.abs(ww-prevW)/DT);acc=Math.max(acc,Math.hypot(vv[0]-prevV[0],vv[1]-prevV[1],vv[2]-prevV[2])/DT);}
  prevW=ww;prevV=vv;
 }
 return{w,a,v,acc,cuts};
}

function suite(X){
 const T=[],ok=(name,cond,info)=>T.push({name,ok:!!cond,info}),C=X.CAM.cine,o=X.CINE,S=X.S;
 // --- the spring ---
 {const a=[0,0],b=[0,0];X.cineSpr(a,0,10,2,.1);X.cineSpr(b,0,10,2,.05);X.cineSpr(b,0,10,2,.05);
  ok('the spring is exact for any frame length (two half steps = one step)',Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9,a+' vs '+b);
  const s=[0,0];let mono=true,last=0;for(let i=0;i<600;i++){X.cineSpr(s,0,10,1.8,DT);if(s[0]<last-1e-12||s[0]>10+1e-9)mono=false;last=s[0];}
  ok('…critically damped: it never overshoots or turns back',mono&&Math.abs(s[0]-10)<1e-3,s[0]);
  const q=[0,0];X.cineSpr(q,0,10,1.8,DT);ok('…and starts from rest (no snap in speed)',q[1]<10*1.8*1.8*DT*1.01&&q[0]<.02,q);}
 // --- every shot in a safe envelope, aimed at the pitch ---
 {let bad='';const ids=Object.keys(X.CINE_SHOTS);
  for(const id of ids){if(!C.shots[id]){bad+=id+' has no CONFIG ';continue;}
   for(const sx of [-60,-30,0,30,60])for(const sz of [-30,0,30])for(const d of [-1,1])for(let t=0;t<=20;t+=.5){
    o.id=id;o.t=t;o.sd=d;o.f[0]=sx;o.f[2]=sz;o.th=d*C.shots.drift.a;o.s=-d;o.lr[0]=6;X.cineRig();const P=o.rp,L=o.rl;
    if(!(P[1]>=20&&P[1]<=85&&Math.abs(P[0])<=96&&Math.abs(P[2])<=95&&L[1]>=-1&&L[1]<=5))bad=id+' at '+[sx,sz,d,t]+' -> '+P.map(v=>v.toFixed(1))+' / '+L.map(v=>v.toFixed(1));}}
  for(const k in C.pick)for(const id in C.pick[k])if(!X.CINE_SHOTS[id])bad+=k+'.'+id+' is not a shot ';
  ok('every shot stays 20..85 high (ceilings start at ~94), inside |x| 96 and |z| 95, aimed at the pitch; every picked id is a shot',!bad,bad);}
 // --- a whole scripted match ---
 watch(X);const rec=match(X,360),M=smooth(rec);
 ok('pans stay gentle between cuts (under 75 deg/s)',M.w<75,M.w.toFixed(1));
 ok('…and ease in and out (pan acceleration under 400 deg/s^2)',M.a<400,M.a.toFixed(0));
 ok('the camera never accelerates harder than 150 u/s^2 between cuts',M.acc<150,M.acc.toFixed(0));
 {let early=0,hot=0,lens=[],last=-1,info='';
  for(const i of M.cuts){const A=rec[i-1],B=rec[i];
   if(B.ph===A.ph&&B.ph==='play'){if(A.st<C.minT*.5){early++;info=A.id+' cut at '+A.st.toFixed(2);}if(A.hot)hot++;}
   if(last>=0)lens.push(rec[i].t-rec[last].t);last=i;}
  let rush=0;for(const i of M.cuts){const A=rec[i-1],B=rec[i];if(A.ph!=='play'||B.ph!=='play')continue;
   const forced=A.bad+DT>C.badT||!(C.pick[B.d?'attack':'mid'][A.id]>0);if(!forced&&!B.calm&&A.st+DT<=A.hold+C.lateT)rush++;}
  ok('a shot past its hold is cut on a calm beat (or lateT later)',rush===0,rush);
  const mean=lens.reduce((s,v)=>s+v,0)/Math.max(1,lens.length);
  ok('no cut in play before minT/2',early===0,info);
  ok('no cut while a ball is due at a goal',hot===0,hot);
  ok('shots are held seconds, not moments (mean '+mean.toFixed(1)+' s)',mean>4&&mean<C.maxT+C.lateT+2,lens.length+' cuts');
  const ids=new Set(rec.filter(r=>r.ph==='play').map(r=>r.id));
  ok('the match uses most of the library',ids.size>=6,[...ids].join(','));
  ok('a goal is followed by the celebration',rec.some(r=>r.id==='cele'&&r.ph==='goal'));
  let run=0,worst=0,lostAll=0;for(const r of rec){if(r.vis===false){run+=DT;lostAll+=DT;worst=Math.max(worst,run);}else run=0;}
  ok('the ball is never out of frame long: a lost ball is found with a cut (worst '+worst.toFixed(2)+' s)',worst<C.lostMin+C.lostT+.1,(100*lostAll/rec.filter(r=>r.vis!=null).length/DT).toFixed(1)+'% of play');}
 // --- tic-tac doesn't rock the frame ---
 {watch(X);o.on=false;const b=ball(30,0,0,0);S.balls=[b];S.phase='play';X.cineUpdate(DT);o.id='rail';o.t=0;o.hold=99;
  const sway=(A,w)=>{let lo=1e9,hi=-1e9;for(let f=0;f<600;f++){b.m.position.z=A*Math.sin(f*DT*w);b.v.z=A*w*Math.cos(f*DT*w);X.cineUpdate(DT);if(f>120){lo=Math.min(lo,o.f[2]);hi=Math.max(hi,o.f[2]);}}return hi-lo;};
  const tt=sway(6,12.6),sl=sway(7,3.14);
  ok('a tic-tac (ball z +-6 at 2 Hz) leaves the frame still',tt<.05,tt.toFixed(3));
  ok('…and so does a slow sell along the rod (z +-7 at 0.5 Hz)',sl<.05,sl.toFixed(3));
  b.m.position.z=0;b.v.z=0;for(let f=0;f<300;f++)X.cineUpdate(DT);const x0=o.f[0];b.m.position.x=-30;X.cineUpdate(DT);const x1=o.f[0];X.cineUpdate(DT);
  ok('a ball that jumps across the table is followed from rest (the subject eases off)',Math.abs(x1-x0)<.5&&Math.abs(o.f[0]-x1)>Math.abs(x1-x0),(x1-x0).toFixed(3)+' then '+(o.f[0]-x1).toFixed(3));}
 // --- a long steady roll: the catch-up keeps the frame on it ---
 {watch(X);o.on=false;const b=ball(-50,0,50,0);S.balls=[b];S.phase='play';X.cineUpdate(DT);X.cineGo('rail',true);o.hold=99;let lag=0;
  for(let f=0;f<120;f++){b.m.position.x+=b.v.x*DT;X.cineUpdate(DT);lag=Math.max(lag,b.m.position.x-o.f[0]);}
  ok('a ball rolling the table at 50 u/s stays within 30 of the subject (a plain spring trails it by ~40)',lag<30,lag.toFixed(1));}
 // --- a ball due at a goal blocks the cut ---
 {watch(X);o.on=false;const b=ball(20,0,110,0);S.balls=[b];S.phase='play';X.cineUpdate(DT);o.id='wide';o.t=60;o.hold=1;const id=o.id;let kept=true,ax=null,bx=0;
  for(let f=0;f<20;f++){b.m.position.x+=b.v.x*DT;X.cineUpdate(DT);if(o.id!==id)kept=false;if(ax==null){ax=o.ax;bx=b.m.position.x;}}
  ok('a shot running at the goal mouth is never cut away from',kept);
  ok('…and the frame pans for the goal it is going to from its first frame',ax>=X.F.L/2*C.hotLead-C.dz[0]-1e-9,ax.toFixed(1)+' with the ball at '+bx.toFixed(1));
  b.v.x=0;b.pinR={team:0,role:'ATT'};X.cineUpdate(DT);ok('…and is cut on the next calm beat past its hold',o.id!==id);}
 // --- a hold waits for a calm beat ---
 {watch(X);o.on=false;const b=ball(0,0,0,60);S.balls=[b];S.phase='play';X.cineUpdate(DT);X.cineGo('wide',true);o.hold=C.minT;o.t=C.minT+.5;let kept=true;
  for(let f=0;f<60;f++){b.m.position.z+=b.v.z*DT;if(Math.abs(b.m.position.z)>20)b.v.z=-b.v.z;X.cineUpdate(DT);if(o.id!=='wide')kept=false;}
  ok('a shot past its hold keeps running while the ball is moving fast',kept);
  b.v.z=0;b.pinR={team:0,role:'MID'};X.cineUpdate(DT);ok('…and cuts on the calm beat (a held ball)',o.id!=='wide');}
 // --- an end shot loses its end ---
 {watch(X);o.on=false;const b=ball(40,0,0,0);S.balls=[b];S.phase='play';X.cineUpdate(DT);for(let f=0;f<120;f++)X.cineUpdate(DT);
  X.cineGo('goal',true);o.hold=99;const sd=o.sd;b.m.position.x=-40;let at=-1;
  for(let f=0;f<600&&at<0;f++){X.cineUpdate(DT);if(o.id!=='goal')at=f*DT;}
  ok('an end shot is cut once the play leaves its end (after minT/2 + badT)',sd===1&&at>0&&at<C.minT*.5+C.badT+2.5,at);}
 // --- a clearance behind the camera is found with a cut, before the end shot's own rules would ---
 {watch(X);o.on=false;const b=ball(30,0,0,0);S.balls=[b];S.phase='play';for(let f=0;f<240;f++)X.cineUpdate(DT);
  X.cineGo('shoulder',true);o.hold=99;for(let f=0;f<72;f++)X.cineUpdate(DT);b.m.position.x=-40;b.v.x=-20;const t0=o.t;let at=-1;
  for(let f=0;f<120&&at<0;f++){b.m.position.x+=b.v.x*DT;X.cineUpdate(DT);if(o.id!=='shoulder')at=f*DT;}
  ok('a ball cleared back behind the camera is found with a cut in about lostT',at>=C.lostT-2*DT&&at<C.lostT+.15&&t0+at<C.minT*.5,at+' at shot time '+(t0+at).toFixed(2));}
 // --- goal, out, count, pause, win ---
 {watch(X);o.on=false;const b=ball(50,0,0,0);S.balls=[b];S.phase='play';X.cineUpdate(DT);X.cineGo('wide',true);
  S.balls=[];S.phase='goal';X.RP.queued=true;X.RP.team=0;let t0=-1;
  for(let f=0;f<60;f++){X.cineUpdate(DT);if(o.id==='cele'&&t0<0)t0=f*DT;}
  ok('a goal holds the shot celeDelay, then cuts to the celebration on the beaten goal',t0>=C.celeDelay-DT&&t0<C.celeDelay+3*DT&&o.sd===1,t0+' sd '+o.sd);
  S.phase='count';X.RP.queued=false;X.cineUpdate(DT);
  ok('the count after it opens a fresh count shot',C.pick.count[o.id]>0&&o.t<2*DT,o.id);
  const pos=[X.camera.position.x,X.camera.position.y,X.camera.position.z];
  ok('…cut, not swept there (the camera sits on the new rig)',Math.hypot(pos[0]-o.rp[0],pos[1]-o.rp[1],pos[2]-o.rp[2])<2.5,pos.map(v=>v.toFixed(1))+' vs '+o.rp.map(v=>v.toFixed(1)));
  S.phase='play';S.balls=[ball(0,0,0,0)];X.cineGo('wide',true);S.phase='goal';X.RP.queued=false;for(let f=0;f<60;f++)X.cineUpdate(DT);
  ok('an out keeps the shot',o.id==='wide');
  S.phase='pause';const pp=JSON.stringify(X.camera.position),pt=o.t;for(let f=0;f<30;f++)X.cineUpdate(DT);
  ok('pause holds the camera and the shot clock',JSON.stringify(X.camera.position)===pp&&o.t===pt);
  S.phase='win';X.cineUpdate(DT);ok('full time cuts to the win shot',o.id==='win');}
 // --- drift arcs toward square-on ---
 {watch(X);o.on=false;S.balls=[ball(0,0,0,0)];S.phase='play';X.cineUpdate(DT);let worse=0;
  for(let k=0;k<12;k++){X.cineGo('drift',true);o.hold=99;const a0=Math.abs(o.th);for(let f=0;f<300;f++)X.cineUpdate(DT);if(Math.abs(o.th+o.s*C.shots.drift.w*o.t)>=a0)worse++;}
  ok('the drift arc always swings back toward square-on',worse===0,worse);}
 // --- glide or cut ---
 {watch(X);o.on=false;S.balls=[ball(10,0,0,0)];S.phase='play';X.cineUpdate(DT);X.cineGo('rail',true);for(let f=0;f<30;f++)X.cineUpdate(DT);
  o.id='rail';X.cineRig();for(let k=0;k<3;k++){o.p[k*2]=o.rp[k]+5;o.l[k*2]=o.rl[k];}const p0=o.p[0];X.cineGo('rail',false);
  ok('a next shot framed near the camera glides there (no snap)',o.glide===1&&o.p[0]===p0);
  for(let k=0;k<3;k++){o.p[k*2]=o.rp[k]+200;}X.cineGo('wide',false);
  ok('a far one cuts',o.glide===0&&Math.abs(o.p[0]-o.rp[0])<1e-9);}
 // --- tension, lead room ---
 {watch(X);o.on=false;const b=ball(40,0,0,0,{team:0,role:'ATT'});S.balls=[b];S.phase='play';for(let f=0;f<240;f++)X.cineUpdate(DT);X.cineGo('wide',true);
  ok('the attack holding the ball near the goal it attacks pushes the zoom in',Math.abs(X.cineFovT()-C.shots.wide.fov*C.tension)<1e-9&&o.d===1);
  b.pinR={team:1,role:'GK'};X.cineUpdate(DT);ok('…the defence holding it does not',Math.abs(X.cineFovT()-C.shots.wide.fov)<1e-9);
  for(let f=0;f<600;f++)X.cineUpdate(DT);ok('lead room sits ahead of the side that last held the ball',Math.abs(o.lr[0]+C.room)<.2,o.lr[0]);}
 // --- the fov handback ---
 {watch(X);o.on=false;S.balls=[ball(0,0,0,0)];S.phase='play';for(let f=0;f<120;f++)X.cineUpdate(DT);const f0=o.fov0;
  ok('the cinematic zoom is live',Math.abs(X.camera.fov-55)>.5&&X.cineFovBase()===55,X.camera.fov);
  S.camMode=0;const r=X.cineUpdate(DT);ok('leaving it hands back the base fov',r===false&&X.camera.fov===f0&&!o.on);
  S.camMode=C.mode;X.cineUpdate(DT);const l=X.cineOff();ok('cineOff returns the last aim for the menu ease',l&&l.length===3&&X.camera.fov===55);}
 // --- offered only while watching; each kind of match keeps its own camera ---
 {X.TO.length=0;S.seats=[{team:0}];S.camMode=0;
  ok('not offered while anyone plays',!X.camModeOK(C.mode));
  let saw=false;for(let k=0;k<X.CAM.modes.length;k++){X.cycleCam(1);if(S.camMode===C.mode)saw=true;}ok('…and the cycle skips it',!saw);
  S.camMode=0;S.seats=[];ok('offered in an AI showdown',X.camModeOK(C.mode));
  X.camMatchStart();ok('an AI showdown opens on it',S.camMode===C.mode);
  ok('…with a CINEMATIC toast when picked by hand',(X.cycleCam(1),S.camMode!==C.mode)&&(S.camMode=C.mode-1,X.cycleCam(1),X.TO.some(t=>/CINEMATIC/.test(t))));
  S.camMode=3;S.seats=[{team:0}];X.camMatchStart();ok('a played match gets its own camera back',S.camMode===0,S.camMode);
  S.seats=[];X.camMatchStart();ok('the next showdown keeps the camera picked while watching',S.camMode===3,S.camMode);}
 return T;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info!=null?'   ['+t.info+']':''));}else if(process.argv.includes('-v'))console.log('  ok    '+t.name+(t.info!=null?'   ['+t.info+']':''));}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {name:'a lost ball is never searched for',part:'cine',from:'if(o.lost>C.lostT&&o.t>C.lostMin)',to:'if(false)'},
 {name:'no catch-up on a long roll',part:'cine',from:'const K=C.catchUp,ku=a=>1+K.k*',to:'const K=C.catchUp,ku=a=>1+0*'},
 {name:'a shot does not pull the frame toward its goal',part:'cine',from:'if(hot)tx=hot>0?',to:'if(false)tx=hot>0?'},
 {name:'the spring is a plain lerp (speed snaps)',part:'cine',from:'const x=a[i]-t,e=Math.exp(-w*dt),j=(a[i+1]+w*x)*dt;a[i]=t+(x+j)*e;a[i+1]=(a[i+1]-w*j)*e;',to:'a[i]=lerp(a[i],t,Math.min(1,w*2*dt));'},
 {name:'the subject is the raw ball (no spring)',part:'cine',from:'cineSpr(o.f,0,o.ax,C.subW[0]*ku(Math.abs(o.ax-o.f[0])),rdt);cineSpr(o.f,2,o.az,C.subW[1]*ku(Math.abs(o.az-o.f[2])),rdt);',to:'o.f[0]=o.ax;o.f[2]=o.az;'},
 {name:'no dead zone across the table',part:'cine',from:'C.dz[1]',to:'0'},
 {name:'a ball due at a goal does not block the cut',part:'cine',from:' if(o.hot)return;',to:''},
 {name:'cuts ignore minT',part:'cine',from:'&&o.t>C.minT*.5)||(!(C.pick[beat][o.id]>0)&&o.t>C.minT)',to:')||(!(C.pick[beat][o.id]>0))'},
 {name:'a hold cuts without waiting for a calm beat',part:'cine',from:'(o.calm||o.t>o.hold+C.lateT)',to:'true'},
 {name:'end shots never lose their end',part:'cine',from:'o.bad=sh.end&&o.d!==o.sd?o.bad+rdt:0;',to:'o.bad=0;'},
 {name:'no celebration after a goal',part:'cine',from:"cineGo('cele',true,d);",to:'0;'},
 {name:'the celebration frames the wrong goal',part:'cine',from:'const d=RP.team===0?1:-1;',to:'const d=RP.team===0?-1:1;'},
 {name:'a count keeps the old shot',part:'cine',from:"cinePick('count',true);}",to:'}'},
 {name:'an out cuts to the celebration',part:'cine',from:'RP.queued?C.celeDelay:-1',to:'C.celeDelay'},
 {name:'pause runs the camera on',part:'cine',from:"if(S.phase==='pause')return true;",to:''},
 {name:'the drift arc swings away from square-on',part:'cine',from:"if(id==='drift')o.s=-o.s;",to:''},
 {name:'every next shot cuts',part:'cine',from:'{o.glide=1;return;}',to:'{}'},
 {name:'every next shot glides',part:'cine',from:'if(Math.hypot(P[0]-p[0],P[1]-p[2],P[2]-p[4])<C.blendD&&c>Math.cos(C.blendA*Math.PI/180))',to:'if(true)'},
 {name:'the defence holding the ball pushes in too',part:'cine',from:'h&&o.d&&h.team===(o.d>0?0:1)',to:'h&&o.d'},
 {name:'lead room points at the wrong end',part:'cine',from:'(o.own===0?1:-1)*C.room',to:'(o.own===0?-1:1)*C.room'},
 {name:'leaving it keeps the zoomed fov',part:'cine',from:'camera.fov=o.fov0;camera.updateProjectionMatrix();',to:''},
 {name:'the replay base is the zoomed fov',part:'cine',from:'return CINE.on?CINE.fov0:camera.fov;',to:'return camera.fov;'},
 {name:'the crane shot sinks under the safe height',part:'cine',from:'lerp(H.y0,H.y1,e),lerp(H.z0,H.z1,e),sx*H.lx+d*H.lead',to:'lerp(H.y0,H.y1-30,e),lerp(H.z0,H.z1,e),sx*H.lx+d*H.lead'},
 {name:'the cinematic camera is offered to players',part:'cam',from:"return!S.seats.length&&typeof cineUpdate==='function';",to:"return typeof cineUpdate==='function';"},
 {name:'a showdown does not open on it',part:'cam',from:'else if(CAM.cine&&CAM.cine.spectate)S.camMode=CAM.cine.mode;',to:''},
 {name:'one camera for both kinds of match',part:'cam',from:'if(k!==camKind){',to:'if(false){'},
 {name:'no toast when it is picked',part:'cam',from:"toast('CAMERA','CINEMATIC',1.2);",to:'0;'}
];
let missed=0;
for(const m of MUT){
 const res=suite(boot(m)),failed=res.filter(t=>!t.ok);
 if(failed.length){console.log('  caught  ('+failed.length+' assertions)  '+m.name);}
 else{missed++;console.log('  MISSED  '+m.name);}
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
