// Kick-angle soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/kickangle-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      kaOffsets({ri:5})              // a ball at rest in front of one man at each z offset, a plain swing: the heading it leaves on, assist off and on, against the edge geometry
//      kaSlide({ri:5,style})          // the man sliding through the strike at each speed, fired at each offset from the ball: heading / forward speed, s = the side of the foot met it
//      kaPinSweep({ri:5})             // a pass struck from a PINNED ball, the rod sliding at each speed through the swing: heading / forward / the carry at the release
//      kaRun({ri:5,rel,R,v,w0})       // a free pass with a run-up on the real rod dynamics: the man starts R off the ball on the far side, slides at v, the swing fires w0 past the ball's z
//      kaNatural({ri:5,style})        // the heading a rod sliding at sv leaves a ball rolling at vz on: the model the AI judges lanes with
//      kaPose({ri,ang,from,v,dz})     // a rod holding a pin pose (angle ang, + forward) with a ball arriving from behind (from -1) or the front (+1): pinned? where does it end
//      kaSoak({...,rest:{back:-0.75,minRel:1.5,maxRel:60,roles}})  // experiment: idle rods hold a back-pin pose while the ball is upfield; it takes over a ball it pins (the receiver's forward pin pose is the game's own now: CONFIG.ai.catch.recv)
//      kaSoak({seeds:8,secs:120,plant:true})   // plant: a swing holds the rod's slide target from its first step (an experiment, not in the game)
//      kaSoak({seeds:8,secs:120})      // AI-vs-AI matches: every plain kick / pass / pin shot, the heading it was meant to take against the one it took
//      kaTry('tag',()=>{...},[seeds])  // kaSoak with a function run first (CONFIG overrides), restored after
// why: 'does a swing leave on the heading the AI judged the lane on' is a whole-match question; this drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups)
// heading = atan2(vz, vx*dir) in degrees, + toward +z; intended = toward the pass target, or the lane the gap-aim chose (goal centre when it chose none)
// the heading is read at the swing's last contact that sends the ball forward (> 10 u/s); blocked = the other team touches the ball within `look` s
'use strict';
(function(){
 const FIX=1/SIM.hz,DEG=180/Math.PI;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__ka_kr0)window.__ka_kr0=kickRod;
 if(!window.__ka_mc0)window.__ka_mc0=momContact;
 if(!window.__ka_aa0)window.__ka_aa0=aimAssist;
 if(!window.__ka_wa0)window.__ka_wa0=wallAssist;
 let T=null,LAST=null;
 const hd=(v,dir)=>Math.atan2(v.z,v.x*dir)*DEG;
 const nearestZ=(r,z)=>{let d=1e9;for(let i=0;i<r.baseZ.length;i++){if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;d=Math.min(d,Math.abs(z-(r.baseZ[i]+r.offset)));}return d;};
 window.momContact=function(b,r){
  const o=__ka_mc0.apply(this,arguments);
  LAST={vx:b.v.x,vz:b.v.z,y:b.v.y};
  if(T){
   for(const s of T.sw){
    if(s.rod===r&&S.time-s.t<0.6){
     const sp=Math.hypot(b.v.x,b.v.z),f=b.v.x*r.kickDir;
     if(f>10){if(s.n===0)s.h0=hd(b.v,r.kickDir);s.n++;s.h=hd(b.v,r.kickDir);s.sp=sp;s.lz=nearestZ(r,b.m.position.z);s.sv=r.slideV;s.tl=S.time-s.t;}
     else s.back++;
    }else{
     if(!s.opp&&r.team!==s.team&&S.time-s.t<T.look)s.opp=r.role;
     if(!s.ft&&s.n>0&&S.time-s.t<2.5){s.ft=r.team===s.team?'own':'opp';s.fr=r.role;s.rcv=(r===s.rx);
      s.irod=r;s.itT=S.time;s.idz=nearestZ(r,b.m.position.z);s.iy=b.m.position.y;s.ivy=b.v.y;s.irel=(b.m.position.x-r.x)*r.kickDir;s.ispd=Math.hypot(b.v.x,b.v.z);s.ivz=b.v.z;s.irsv=r.slideV;s.iact=(r.pinB?'pin':(r.act||'-'))+(r.catPh?'/'+r.catPh:'');s.iang=r.angle*r.kickDir;s.ipin=false;s.ikick=null;s.ipinT=null;T.watch.push(s);}   // the first rod to touch the ball after the swing
    }
   }
  }
  return o;
 };
 window.kickRod=function(r,style,aim,curve){
  if(T&&r.kickT<0){
   for(const w of T.watch)if(w.irod===r&&w.ikick==null&&S.time-w.itT<1.2)w.ikick=S.time-w.itT;
   const dir=r.kickDir;let b=null,bd=1e9;
   for(const q of S.balls){const d=Math.abs(q.m.position.x-r.x);if(d<bd){bd=d;b=q;}}
   if(b){
    const bx=b.m.position.x,bz=b.m.position.z,gx=dir>0?F.L/2:-F.L/2,ev=r.aimEv&&r.aimEv.best?r.aimEv:null;
    const k=style==='trapShot'?'pin':style==='pass'?'pass':'plain',RX=aim?rods.find(q=>q.team===r.team&&Math.abs(q.x-aim.x)<0.5)||null:null;
    const tx=aim?aim.x:gx,tz=aim?aim.z:(ev?ev.best.tz:0);
    T.sw.push({rod:r,t:S.time,team:r.team,role:r.role,k,bx,bz,ev:!!ev,clr:ev?ev.best.clr:null,want:Math.atan2(tz-bz,(tx-bx)*dir)*DEG,n:0,back:0,h:null,h0:null,sp:0,lz:null,opp:null,ft:null,fr:null,bvx:b.v.x*dir,bvz:b.v.z,sv:0,rsv:r.slideV,
     csv:r.catSv||0,rv:r.act==='run'?r.rnS*r.rnV:0,rth:r.act==='run'?r.rnTh:0,rx:RX,rxa:RX?RX.angle*RX.kickDir:null,rxact:RX?(RX.act||'-'):null,org:r.pinB?'pin':(r.act||'free'),rel:(bx-r.x)*dir,dz:nearestZ(r,bz),ang:r.angle*dir,pinv:r.pinB?b.v.z:null});
   }
  }
  return __ka_kr0.apply(this,arguments);
 };
 const BINS=[3,6,10,20,1e9];
 function bin(x){const a=Math.abs(x);for(let i=0;i<BINS.length;i++)if(a<BINS[i])return i;return BINS.length-1;}
 function summarise(list){
  const n=list.length,hit=list.filter(s=>s.n>0),f=(x,d)=>+(x).toFixed(d==null?2:d);
  if(!hit.length)return {swings:n,contact:0};
  const av=(a,fn)=>a.length?f(a.reduce((x,y)=>x+fn(y),0)/a.length):0;
  const hist=[0,0,0,0,0];for(const s of hit)hist[bin(s.h)]++;
  const wide=hit.filter(s=>Math.abs(s.want)>10),narrow=hit.filter(s=>Math.abs(s.want)<=10);
  const sh=(a,fn)=>a.length?f(a.filter(fn).length/a.length):0;
  return {swings:n,contact:hit.length,
   headingAbsMean:av(hit,s=>Math.abs(s.h)),headingHist:{'<3':f(hist[0]/hit.length),'3-6':f(hist[1]/hit.length),'6-10':f(hist[2]/hit.length),'10-20':f(hist[3]/hit.length),'>20':f(hist[4]/hit.length)},
   wantAbsMean:av(hit,s=>Math.abs(s.want)),wantOver10:f(wide.length/hit.length),
   gotShareOfWant:wide.length?f(wide.reduce((x,s)=>x+Math.abs(s.h)/Math.abs(s.want),0)/wide.length):0,   // 1 = it left as aimed
   slopeOnWant:f(hit.reduce((x,s)=>x+s.h*s.want,0)/Math.max(1e-9,hit.reduce((x,s)=>x+s.want*s.want,0))),   // heading per degree asked for (1 = leaves as aimed)
   missAbsMean:av(hit,s=>Math.abs(s.h-s.want)),
   firstTouch:{own:sh(hit.filter(s=>s.ft),s=>s.ft==='own'),ownWanted10:sh(wide.filter(s=>s.ft),s=>s.ft==='own'),ownWanted0:sh(narrow.filter(s=>s.ft),s=>s.ft==='own'),none:f(hit.filter(s=>!s.ft).length/hit.length)},
   lzAbsMean:av(hit.filter(s=>s.lz!=null),s=>s.lz),lzInFace:sh(hit.filter(s=>s.lz!=null),s=>s.lz<CONFIG.physics.footBox.z),
   blockedWanted10:sh(wide,s=>!!s.opp),blockedWanted0:sh(narrow,s=>!!s.opp),speedMean:av(hit,s=>s.sp)};
 }
 // experiment: a rod doing nothing holds a pin pose while the ball is upfield of it (back-tilted against the other team's ball, `o.rest.back`), and takes over a ball it ends up pinning
 function restPose(K){
  for(const r of rods){
   if(isUserRod(r)||r.role==='GK'||r.kickT>=0)continue;
   const dir=r.kickDir;let near=false;
   if(K.roles&&K.roles.indexOf(r.role)<0)continue;
   if(!r.act&&!r.pinB){
    for(const b of S.balls){if(b.scored)continue;const rel=(b.m.position.x-r.x)*dir;if(rel>K.minRel&&rel<K.maxRel&&b.m.position.y<AIC.lowY){near=true;break;}}
    if(near){r.pinOn=true;r.pinPose=true;r.pinA=K.back*dir;r.__rest=true;}
    else if(r.__rest){r.pinOn=false;r.pinPose=false;r.pinA=null;r.__rest=false;}
   }
   if(r.pinB&&!r.act){r.act='catch';r.catPh='front';r.catT=0;r.__rest=false;}
  }
 }
 function kaSoak(o){
  o=Object.assign({seeds:8,secs:120,seed0:1,diff:null,look:1.0,maxMs:38000},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  T={sw:[],all:[],look:o.look,m:0,goals:0,whistles:0,sc:0,scT:[0,0],watch:[],hold:{steps:0,mid:{fwd:0,raised:0,other:0},att:{fwd:0,raised:0,other:0}}};
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    if(performance.now()-t0>o.maxMs)break;
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.__ph=null;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];
    T.sw.length=0;T.sc=S.score[0]+S.score[1];T.scT=[S.score[0],S.score[1]];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);
     if(S.score[0]+S.score[1]!==T.sc){
      for(const tm of [0,1])if(S.score[tm]>(T.scT[tm]||0)){for(let k=T.sw.length-1;k>=0;k--){if(T.sw[k].team===tm){T.sw[k].goal=true;break;}}}
      T.sc=S.score[0]+S.score[1];T.scT=[S.score[0],S.score[1]];
     }
     if(o.rest)restPose(o.rest);
     if(o.plant)for(const r of rods)if(r.kickT>=0&&r.kickStyle!=='trapShot'&&!r.catSw&&!isUserRod(r))r.target=r.offset;   // experiment: a swing brakes the slide from its first step (no waiting)
     updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%6===0)for(const d of rods){
      if(d.role!=='DEF'||!d.pinB||isUserRod(d))continue;
      T.hold.steps++;
      for(const q of rods){
       if(q.team!==d.team||q===d||(q.role!=='MID'&&q.role!=='ATT'))continue;
       const a=q.angle*q.kickDir,k=q.role==='MID'?T.hold.mid:T.hold.att;
       if(a>0.25)k.fwd++;else if(a<-0.5)k.raised++;else k.other++;
      }
     }
     if(T.watch.length)for(let wi=T.watch.length-1;wi>=0;wi--){const w=T.watch[wi],dtw=S.time-w.itT;if(dtw>1.2){T.watch.splice(wi,1);continue;}if(!w.ipin&&dtw<0.6&&w.irod.pinB){w.ipin=true;w.ipinT=dtw;}}
    }
    T.watch.length=0;
    for(const s of T.sw)T.all.push(s);
    T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const TT=T;T=null;
  const by=(fn)=>summarise(TT.all.filter(fn)),R={diff:o.diff||cfg.diffRed,matches:TT.m,wallS:+((performance.now()-t0)/1000).toFixed(1),goalsPerMatch:+(TT.goals/Math.max(1,TT.m)).toFixed(2),deadBallPerMatch:+(TT.whistles/Math.max(1,TT.m)).toFixed(2)};
  const pm=(x)=>+(x/Math.max(1,TT.m)).toFixed(2);
  for(const k of ['plain','pass','pin']){R[k]=by(s=>s.k===k);R[k].perMatch=pm(TT.all.filter(s=>s.k===k).length);}
  R.plainByRole={};for(const ro of ['GK','DEF','MID','ATT'])R.plainByRole[ro]=by(s=>s.k==='plain'&&s.role===ro);
  R.plainGapAimed=by(s=>s.k==='plain'&&s.ev);
  window.__ka_last=TT.all;R.holdPose=TT.hold.steps?{samples:TT.hold.steps,mid:{fwd:+(TT.hold.mid.fwd/TT.hold.steps).toFixed(2),raised:+(TT.hold.mid.raised/TT.hold.steps).toFixed(2)},att:{fwd:+(TT.hold.att.fwd/TT.hold.steps).toFixed(2),raised:+(TT.hold.att.raised/TT.hold.steps).toFixed(2)}}:null;
  return R;
 }
 // one ball at rest in front of one man (rel ahead of the rod), a plain swing, nothing else on the table; the heading it leaves on at each z offset
 function kaOffsets(o){
  o=Object.assign({ri:5,man:null,rel:2.2,offs:[0,0.4,0.8,1.2,1.35,1.6,1.9,2.2,2.5,2.8,3.1],seed:1,T:0.3,side:1},o||{});
  const out=[];
  for(const assist of [false,true]){
   window.aimAssist=assist?__ka_aa0:function(){};window.wallAssist=assist?__ka_wa0:function(){};
   try{
    for(const off of o.offs){
     S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
     rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aimEv=null;});
     const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic'),mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
     for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
     b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[mi]+o.side*off);b.v.set(0,0,0);syncBall(b);
     LAST=null;__ka_kr0(r,null,null,null);
     for(let i=0;i<Math.round(o.T*SIM.hz);i++){updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
     const e=Math.max(0,off-CONFIG.physics.footBox.z)/BALL_R;
     out.push({assist,off,edgeDeg:+(off>CONFIG.physics.footBox.z?Math.asin(Math.min(1,e))*DEG:0).toFixed(1),
      heading:LAST?+(Math.atan2(LAST.vz,LAST.vx*dir)*DEG*o.side).toFixed(1):null,speed:LAST?+Math.hypot(LAST.vx,LAST.vz).toFixed(1):0});
    }
   }finally{window.aimAssist=__ka_aa0;window.wallAssist=__ka_wa0;}
  }
  const rows=[];
  for(const off of o.offs){const a=out.find(x=>x.off===off&&!x.assist),c=out.find(x=>x.off===off&&x.assist);rows.push(`off ${off.toFixed(2)}  edge ${String(a.edgeDeg).padStart(5)}  assist-off ${String(a.heading).padStart(6)} @${a.speed}  assist-on ${String(c.heading).padStart(6)} @${c.speed}`);}
  return {rows,out};
 }
 // one hand-placed strike: the man slides toward +z at `speed` u/s and the swing is fired when its offset reaches `at` (speed 0: at once, rod at rest); the ball starts at z0 off the man's centre line with lateral speed vz
 // style 'plain' or 'pass' (the soft swing); aim = {x,z} for a pass target (only the assist reads it); kind: face = the foot's front met it, side = the side of the foot did
 function kaStrike(o){
  const r=rods[o.ri],dir=r.kickDir,D=DIFFS[teamDiff(r.team)],sp0=D.speed,ac0=AIC.slideAccel;
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aimEv=null;});
  const b=makeBall('classic'),mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[mi]+o.z0);b.v.set(0,0,o.vz);syncBall(b);
  window.aimAssist=o.assist?__ka_aa0:function(){};window.wallAssist=o.assist?__ka_wa0:function(){};
  D.speed=Math.max(Math.abs(o.speed),1);AIC.slideAccel=1e6;
  const sg=Math.sign(o.speed)||1;
  r.offset=r.prevOffset=o.at-sg*Math.abs(o.speed)*0.25;r.target=sg*r.maxOff;
  LAST=null;let fired=false,vzAt=0,steps=0;
  try{
   for(let i=0;i<Math.round((o.T+0.5)*SIM.hz);i++){
    if(!fired&&(o.speed===0||(sg>0?r.offset>=o.at:r.offset<=o.at))){__ka_kr0(r,o.style==='pass'?'pass':null,o.aim||null,null);fired=true;vzAt=r.vz;if(o.speed===0)r.target=r.offset;}
    if(o.speed===0)r.target=r.offset;
    updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);steps++;
    if(fired&&r.kickT<0&&steps>5)break;
   }
  }finally{D.speed=sp0;AIC.slideAccel=ac0;window.aimAssist=__ka_aa0;window.wallAssist=__ka_wa0;}
  if(!LAST)return {slide:+vzAt.toFixed(1),heading:null,fwd:0,side:0,kind:'none'};
  const sp=Math.hypot(LAST.vx,LAST.vz),fw=LAST.vx*dir;
  return {slide:+vzAt.toFixed(1),heading:+(Math.atan2(LAST.vz,fw)*DEG).toFixed(1),fwd:+fw.toFixed(1),side:+LAST.vz.toFixed(1),ball:+sp.toFixed(1),kind:fw>0.75*sp?'face':'side'};
 }
 // the man sliding toward +z at each speed, the swing fired at each offset, the ball at rest on its centre line: heading / forward speed / which part of the foot met it
 function kaSlide(o){
  o=Object.assign({ri:5,man:null,rel:2.2,speeds:[0,20,30,43],ats:[-1.75,-1.25,-0.75,-0.25,0,0.5,1,1.5],seed:1,T:0.3,assist:false,style:'plain',vz:0,z0:0,aim:null},o||{});
  const out=[];
  for(const speed of o.speeds)for(const at of o.ats){
   const q=kaStrike(Object.assign({},o,{speed,at}));
   out.push(Object.assign({speed,at},q));
  }
  const rows=[],by={};
  for(const x of out)(by[x.speed]=by[x.speed]||[]).push(`${x.at}:${x.heading}/${x.fwd}${x.kind==='side'?'s':''}`);
  for(const k in by)rows.push(`${o.style} slide ${k}: `+by[k].join('  '));
  return {rows,out};
 }
 // the natural heading: a rod sliding at `sv` through a ball rolling at vz, ball started at a spread of z0 so some meet the foot's face; the mean heading of the face contacts and how many there were
 function kaNatural(o){
  o=Object.assign({ri:5,man:null,rel:2.2,svs:[0,15,30,43],vzs:[-20,-10,0,10,20],z0s:null,at:0,seed:1,T:0.3,assist:false,style:'plain',aim:null},o||{});
  const z0s=o.z0s||[-2,-1.5,-1,-0.5,0,0.5,1,1.5,2],out=[];
  for(const sv of o.svs)for(const vz of o.vzs){
   const hs=[],fw=[];let n=0;
   for(const z0 of z0s){
    const q=kaStrike({ri:o.ri,man:o.man,rel:o.rel,seed:o.seed,T:o.T,assist:o.assist,style:o.style,aim:o.aim,speed:sv,at:o.at,vz,z0});n++;
    if(q.kind==='face'){hs.push(q.heading);fw.push(q.fwd);}
   }
   const m=hs.length?hs.reduce((x,y)=>x+y,0)/hs.length:null,sd=hs.length?Math.sqrt(hs.reduce((x,y)=>x+(y-m)*(y-m),0)/hs.length):null;
   out.push({sv,vz,face:hs.length,of:n,heading:m==null?null:+m.toFixed(1),sd:sd==null?null:+sd.toFixed(1),fwd:fw.length?+(fw.reduce((x,y)=>x+y,0)/fw.length).toFixed(1):0});
  }
  return {rows:out.map(x=>`${o.style} slide ${String(x.sv).padStart(3)} ball vz ${String(x.vz).padStart(4)}: heading ${String(x.heading).padStart(5)} +-${x.sd}  fwd ${x.fwd}  (${x.face}/${x.of} face)`),out};
 }
 // a pass struck from a ball PINNED under a man (the pose and the catch are the player's own pin: physics.js pinUpdate), the rod sliding toward +z at `speed` u/s for `hold` s before the swing and held at that speed through it
 // speed 0: the rod stands. rel / dz place the ball under the leg; aim = {x,z} is read only by the assist
 function kaPin(o){
  o=Object.assign({ri:5,man:null,rel:-0.6,dz:0,speed:0,hold:0.12,T:0.5,seed:1,assist:false,aim:null,style:'pass',ang:-0.75,room:null,carry:null,real:false},o||{});
  const r=rods[o.ri],dir=r.kickDir,D=DIFFS[teamDiff(r.team)],sp0=D.speed,ac0=AIC.slideAccel;
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aimEv=null;});
  const b=makeBall('classic'),mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  const sg=Math.sign(o.speed)||1,sv=o.speed;
  r.offset=r.prevOffset=o.room!=null?sg*(r.maxOff-o.room)-(o.carry==null?sv:o.carry)*o.hold:clamp(-sg*Math.abs(sv)*(o.hold+0.3),-r.maxOff,r.maxOff);r.target=r.offset;r.pivot.position.z=r.offset;
  b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[mi]+r.offset+o.dz);b.v.set(0,0,0);syncBall(b);
  r.angle=o.ang*dir;r.pinOn=true;r.pinPose=true;r.pinA=r.angle;pinUpdate();
  if(!r.pinB)return {kind:'nopin'};
  window.aimAssist=o.assist?__ka_aa0:function(){};window.wallAssist=o.assist?__ka_wa0:function(){};
  if(!o.real){D.speed=200;AIC.slideAccel=1e6;}
  const cv=o.carry==null?sv:o.carry;
  LAST=null;let fired=false,tFire=0,vzRel=0;
  try{
   for(let i=0;i<Math.round((o.hold+o.T+0.3)*SIM.hz);i++){
    const t=i/SIM.hz;
    if(!fired&&t>=o.hold){vzRel=r.pinB?r.pinB.v.z:0;__ka_kr0(r,o.style==='pass'?'pass':null,o.aim||null,null);fired=true;tFire=t;}
    r.target=r.offset+(fired?sv:cv)*FIX;
    updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
    if(fired&&r.kickT<0&&t>tFire+0.1)break;
   }
  }finally{D.speed=sp0;AIC.slideAccel=ac0;window.aimAssist=__ka_aa0;window.wallAssist=__ka_wa0;}
  if(!LAST)return {kind:'none',slide:+r.slideV.toFixed(1)};
  const sp=Math.hypot(LAST.vx,LAST.vz),fw=LAST.vx*dir;
  return {kind:fw>0.5*sp?'face':'side',slide:+r.slideV.toFixed(1),heading:+(Math.atan2(LAST.vz,fw)*DEG).toFixed(1),fwd:+fw.toFixed(1),side:+LAST.vz.toFixed(1),ball:+sp.toFixed(1),carry:+vzRel.toFixed(1)};
 }
 // kaPin over the slide speeds: heading / forward speed / the ball's lateral speed at the release (carry)
 function kaPinSweep(o){
  o=Object.assign({speeds:[0,10,20,30,43],rels:[-0.6],dzs:[0]},o||{});
  const rows=[],out=[];
  for(const rel of o.rels)for(const dz of o.dzs){
   const q=[];
   for(const speed of o.speeds){const x=kaPin(Object.assign({},o,{speed,rel,dz}));out.push(Object.assign({speed,rel,dz},x));q.push(`${speed}:${x.heading}/${x.fwd}${x.kind==='side'?'s':''}(c${x.carry})`);}
   rows.push(`rel ${rel} dz ${dz}: `+q.join('  '));
  }
  return {rows,out};
 }
 // a free pass with a run-up, on the real rod dynamics (the difficulty's slide speed and acceleration): the man starts R off the ball's z on the far side, slides toward +z asking for v u/s, and the pass swing fires once it is w0 past the ball's z
 // (the ball rests rel ahead of the rod); heading / forward speed / which part of the foot met it / whether the back-off nudged the ball
 function kaRun(o){
  o=Object.assign({ri:5,man:null,rel:3.4,R:3,v:30,w0:0,T:0.6,hold:0.22,seed:1,assist:false,style:'pass',aim:null,vTol:0.9,room:null,bvz:0,Tc:null,p0:0},o||{});
  const r=rods[o.ri],dir=r.kickDir;
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aimEv=null;});
  const b=makeBall('classic'),mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  const bz=r.baseZ[mi]+(o.room!=null?r.maxOff-o.room-o.R:0);
  b.m.position.set(r.x+o.rel*dir,BALL_R,bz);b.v.set(0,0,o.bvz);syncBall(b);
  r.offset=r.prevOffset=bz-o.R-r.baseZ[mi];r.target=r.offset;r.pivot.position.z=r.offset;
  window.aimAssist=o.assist?__ka_aa0:function(){};window.wallAssist=o.assist?__ka_wa0:function(){};
  LAST=null;let fired=false,tFire=null,svFire=0,wFire=0,moved=0;const z0=bz;
  try{
   for(let i=0;i<Math.round((o.T+o.hold+0.4)*SIM.hz);i++){
    const t=i/SIM.hz,w=r.baseZ[mi]+r.offset-b.m.position.z;
    if(!fired&&(o.Tc!=null?(w+r.slideV*o.Tc>=o.p0):w>=o.w0)&&r.slideV>=o.vTol*o.v){moved=Math.abs(b.m.position.z-z0)+Math.abs(b.m.position.x-(r.x+o.rel*dir));__ka_kr0(r,o.style==='pass'?'pass':null,o.aim||null,null);fired=true;tFire=t;svFire=r.slideV;wFire=w;}
    r.target=r.offset+(fired&&t-tFire>=o.hold?0:o.v)*FIX;
    updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
    if(fired&&r.kickT<0&&t>tFire+0.1)break;
    if(!fired&&t>1.2)break;
   }
  }finally{window.aimAssist=__ka_aa0;window.wallAssist=__ka_wa0;}
  if(!fired)return {kind:'nofire',slide:+r.slideV.toFixed(1),off:+r.offset.toFixed(1)};
  if(!LAST)return {kind:'none',tFire:+tFire.toFixed(2),svFire:+svFire.toFixed(1),wFire:+wFire.toFixed(2)};
  const sp=Math.hypot(LAST.vx,LAST.vz),fw=LAST.vx*dir;
  return {kind:fw>0.5*sp?'face':'side',heading:+(Math.atan2(LAST.vz,fw)*DEG).toFixed(1),fwd:+fw.toFixed(1),ball:+sp.toFixed(1),tFire:+tFire.toFixed(2),svFire:+svFire.toFixed(1),wFire:+wFire.toFixed(2),nudged:+moved.toFixed(2)};
 }
 // a rod holding a pin pose (angle ang, rod-local, + = forward) with a ball arriving at it: from behind (dir -1) or from the front (dir +1) at v u/s, dz off the man's z; does the pin take it, and where does it end (rel = ball x ahead of the rod)
 function kaPose(o){
  o=Object.assign({ri:5,man:null,ang:0.4,from:-1,v:45,dz:0,dist:14,T:1.2,seed:1,pose:true},o||{});
  const r=rods[o.ri],dir=r.kickDir;
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aimEv=null;});
  const b=makeBall('classic'),mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  const side=o.from;   // -1 = from behind the rod, +1 = from its front (dir-relative)
  b.m.position.set(r.x+side*o.dist*dir,BALL_R,r.baseZ[mi]+o.dz);b.v.set(-side*o.v*dir,0,0);syncBall(b);
  r.angle=o.ang*dir;if(o.pose){r.pinOn=true;r.pinPose=true;r.pinA=r.angle;}
  let pinT=null,rest=null,maxRel=-1e9,hitT=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
   const rel=(b.m.position.x-r.x)*dir,t=i/SIM.hz;
   if(pinT==null&&r.pinB)pinT=+t.toFixed(2);
   if(hitT==null&&Math.abs(b.v.x*dir)<o.v*0.5)hitT=+t.toFixed(2);
   maxRel=Math.max(maxRel,rel);
  }
  const rel=(b.m.position.x-r.x)*dir;
  return {pinned:!!r.pinB,pinT,relEnd:+rel.toFixed(2),speedEnd:+b.v.length().toFixed(1),zEnd:+(b.m.position.z-(r.baseZ[mi]+r.offset)).toFixed(2),stoppedAt:hitT};
 }
 function kaTry(tag,ov,seeds){
  const keep=JSON.stringify({ai:CONFIG.ai,stats:CONFIG.stats});ov();
  const L=[];
  try{for(const s0 of seeds||[1]){L.push(kaSoak({seeds:8,secs:120,seed0:s0}));}}
  finally{const k=JSON.parse(keep);for(const x in k.ai)CONFIG.ai[x]=k.ai[x];for(const x in k.stats)CONFIG.stats[x]=k.stats[x];}
  return {tag,runs:L};
 }
 window.kaSoak=kaSoak;window.kaOffsets=kaOffsets;window.kaSlide=kaSlide;window.kaStrike=kaStrike;window.kaNatural=kaNatural;window.kaPin=kaPin;window.kaRun=kaRun;window.kaPose=kaPose;window.kaPinSweep=kaPinSweep;window.kaTry=kaTry;
})();
