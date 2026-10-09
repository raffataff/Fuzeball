// Tic-tac soak. Browser side: load the game (preview 'fuzeball', 1280 x 800 first), then
//      fetch('tools/tt-soak.js',{cache:'no-store'}).then(r=>r.text()).then(t=>(0,eval)(t))
//      ttScene({ri:5,s:1,diff:'pro',block:[{ri:6,off:6},{ri:7,off:-3}]})   // a ball pinned by the red ATT, a tic-tac forced toward man 1+s, the blue DEF / GK held where block says (benched, so the AI leaves them alone): phases, tallies, where the shot crosses the goal line against the lane it was judged on
//      ttStrikeScene({u:25,sg:1,w:20,lead:0.5,assist:false})              // one man posed back, a ball rolling across his z at u u/s, the swing fired as it crosses, the rod sliding at w: exit speed and the line it takes (the table CONFIG.ai.catch.tictac.strike.k comes from)
//      ttSoak({seeds:30,secs:120,diff:'legend',on:true,prep,go,drop})        // AI-vs-AI matches: how many start, how they end, what the strikes do (blocked / keeper / row / goal), whistles that follow
//      ttRun(o)  ttAB({diff,seeds})                                          // ttSoak boiled down to the figures that decide / the same matches with the tic-tac on and off
//      ttCal({seeds:40,diff:'legend'})                                       // the lane prediction against what the lane is when the ball is struck: abs error and bias for how far the rows' target is carried on
// why: 'does the AI work a ball between two men, read the rows each way and strike when a lane is open' is a whole-match question; this drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups)
// one call of the preview JS tool is capped at 45 s: ~30 matches a soak, one soak (two for ttAB at 24) a call
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function boot(o){
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;r.rvUntil=0;r.rvReady=false;});
  const r=rods[o.ri];r.aiErrT=1e9;r.aiIQ=true;
  return r;
 }
 // --- one man, one ball: the strike on its own ---
 window.ttStrikeScene=function(o){
  o=Object.assign({ri:5,man:1,d:-0.72,u:25,sg:1,w:0,lead:0.5,tf:0.32,T:1.8,seed:1,diff:'pro',a:null,style:'trapShot',curve:null,trace:false,assist:true,tz:null},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue],as0=[CONFIG.stats.assistBase,CONFIG.stats.assistMax];cfg.diffRed=cfg.diffBlue=o.diff;if(!o.assist){CONFIG.stats.assistBase=0;CONFIG.stats.assistMax=0;}
  const alone=r=>{for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;};
  try{
   const sgn=Math.sign(o.w)||1,aw=Math.abs(o.w);
   // pass 1: the rod alone, to learn where the man is at tf when it starts at oc and runs at w
   const run=oc=>{const r=boot(o);alone(r);r.offset=oc;r.target=oc;r.prevOffset=oc;r.pivot.position.z=oc;
    for(let i=0;i<Math.round(o.tf*SIM.hz);i++){if(aw)r.target=clamp(r.offset+sgn*aw*FIX,-r.maxOff,r.maxOff);updateRods(FIX);S.time+=FIX;}
    return r.baseZ[o.man]+r.offset;};
   const oc=clamp(-sgn*aw*(o.tf-0.04),-11.5,11.5),zf=run(oc);
   const r=boot(o),dir=r.kickDir,b=makeBall('classic'),sg=o.sg,a=(o.a==null?sideAngle(o.d,false):o.a);alone(r);
   r.offset=oc;r.target=oc;r.prevOffset=oc;r.pivot.position.z=oc;
   b.m.position.set(r.x+o.d*dir,BALL_R,zf-sg*o.lead-sg*o.u*o.tf);b.v.set(0,0,sg*o.u);syncBall(b);
   r.act='catch';r.catPh='hit';r.pinOn=false;r.pinPose=true;r.pinA=a*dir;
   const zman=()=>r.baseZ[o.man]+r.offset;
   let fired=-1,hit=null,gap0=null,pz=null,pzx=0,z375=null,z525=null,z60=null;const L=[];
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    const t=i/SIM.hz,p=b.m.position,gap=(zman()-p.z)*sg;
    if(aw&&(fired<0||r.kickT>=0))r.target=clamp(r.offset+sgn*aw*FIX,-r.maxOff,r.maxOff);else if(!aw)r.target=r.offset;
    if(fired<0&&t>=o.tf){r.pinOn=false;if(o.tz!=null)r.aimEv={best:{tz:o.tz,clr:5},goalX:60};kickRod(r,o.style,null,o.curve?Object.assign({},AIC.trapShot,o.curve):undefined);fired=t;r.catSw=true;gap0=gap;}
    updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(b.m.position);
    if(fired>=0&&!hit&&r.kickHit)hit={t:+(t-fired).toFixed(3),gap:+((zman()-p.z)*sg).toFixed(2),sv:+r.slideV.toFixed(1),cz:+p.z.toFixed(2)};
    if(o.trace&&i%6===0)L.push(`${t.toFixed(2)} kt=${r.kickT.toFixed(2)} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} ang=${(r.angle*dir).toFixed(2)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.y.toFixed(1)},${b.v.z.toFixed(1)}`);
    if(b.scored||S.phase!=='play')break;
    if(fired>=0){const px=p.x*dir,at=X=>+(pz+(p.z-pz)*((X-pzx)/(px-pzx))).toFixed(1);if(pz!=null&&z375==null&&px>=37.5)z375=at(37.5);if(pz!=null&&z525==null&&px>=52.5)z525=at(52.5);if(pz!=null&&z60==null&&px>=57.9){z60=at(57.9);break;}pz=p.z;pzx=px;}
    if(fired>=0&&t>fired+1.2)break;
   }
   const v=b.v;
   return {fired:fired<0?null:+fired.toFixed(2),gap0:gap0==null?null:+gap0.toFixed(2),hit,fwd:+(v.x*dir).toFixed(1),lat:+(v.z*sg).toFixed(1),up:+v.y.toFixed(1),head:+(Math.atan2(v.z*sg,v.x*dir)*57.3).toFixed(0),z375,z525,z60,cz:hit?hit.cz:null,L};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];CONFIG.stats.assistBase=as0[0];CONFIG.stats.assistMax=as0[1];}
 };
 // --- the real AI: a ball pinned by an ATT, a tic-tac forced, the opposing DEF / GK held where block says ---
 window.ttScene=function(o){
  o=Object.assign({ri:5,man:1,s:1,dz:0,T:6,seed:1,diff:'pro',block:[],trace:false,every:6,force:true,from:8,vx:-25,pa:-0.75},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  let ls=null;
  try{
   const r=boot(o),dir=r.kickDir,b=makeBall('classic'),held=o.block.map(k=>rods[k.ri]);
   for(const q of rods)if(q!==r&&held.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
   const hold=()=>o.block.forEach(k=>{const q=rods[k.ri];q.aiErrT=1e9;q.offset=k.off;q.target=k.off;q.prevOffset=k.off;q.slideV=0;q.vz=0;q.tgV=0;q.tgP=k.off;q.pivot.position.z=k.off;});
   hold();
   if(!window.__ia0)window.__ia0=isActiveRod;const ia0=window.__ia0;window.isActiveRod=function(q){return held.indexOf(q)<0&&ia0(q);};   // a held rod is benched: the AI leaves its target alone, whichever rod is looked at first in the frame
   const step=()=>{hold();aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);hold();updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);};
   if(o.loose){ls=[AIC.catch.hit.loose.share,AIC.catch.tictac.share];AIC.catch.hit.loose.share=1;AIC.catch.tictac.share=o.share==null?1:o.share;}
   const cas0=Object.assign({},CAS),caw0=Object.assign({},CAW);
   if(o.loose){b.m.position.set(r.x+o.loose.rel*dir,BALL_R,o.loose.z);b.v.set(0,0,0);syncBall(b);}   // lying between two men: the real catchPick decides
   else{
    b.m.position.set(r.x+o.from*dir,BALL_R,r.baseZ[o.man]+o.dz);b.v.set(o.vx*dir,0,0);syncBall(b);
    for(let i=0;i<Math.round(2*SIM.hz)&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinA=o.pa*dir;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
    if(!r.pinB)return {out:'nopin'};
    r.pinOn=true;r.act='catch';r.catPh='hold';r.catT=1;r.actT=0;pinPlayStart(r);r.catUntil=S.time+99;
    if(o.force){r.ttPk={s:o.s,j:o.man+o.s,mi:o.man,v:0};ttStart(r);}
   }
   const L=[],ph=[],x0=r.x;let lastPh='',t57=null,z57=null,zfire=null,fireT=null;
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    const t=i/SIM.hz,p=b.m.position;
    step();
    const tag=(r.act||'-')+'/'+(r.catPh||'-')+'/'+(r.hPh||r.ttPh||'');
    if(tag!==lastPh){ph.push(t.toFixed(2)+' '+tag+(r.ttN!=null?' n='+r.ttN:''));lastPh=tag;}
    if(o.trace&&i%o.every===0)L.push(`${t.toFixed(2)} ${tag} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} ang=${(r.angle*dir).toFixed(2)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);
    if(r.kickT>=0&&fireT==null){fireT=t;zfire=p.z;}
    if(t57==null&&p.x*dir>=57.9){t57=t;z57=p.z;}
    if(b.scored||S.phase!=='play'||S.balls.length===0)break;
    if(fireT!=null&&t>fireT+1.2)break;
   }
   const dc={},dw={};for(const k in CAS)if(CAS[k]!==cas0[k])dc[k]=CAS[k]-cas0[k];for(const k in CAW)if(CAW[k]!==caw0[k])dw[k]=CAW[k]-(caw0[k]||0);
   return {ph,dc,dw,w:r.ttW,tz:r.ttTz==null?null:+r.ttTz.toFixed(1),fireT:fireT==null?null:+fireT.toFixed(2),zfire:zfire==null?null:+zfire.toFixed(1),z57:z57==null?null:+z57.toFixed(1),t57,scored:!!b.scored,L,end:{x:+((b.m.position.x-x0)*dir).toFixed(1),z:+b.m.position.z.toFixed(1)}};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];if(window.__ia0)window.isActiveRod=window.__ia0;if(ls){AIC.catch.hit.loose.share=ls[0];AIC.catch.tictac.share=ls[1];}}
 };
 // --- whole matches ---
 if(!window.__kr0)window.__kr0=kickRod;
 if(!window.__mc0)window.__mc0=momContact;
 if(!window.__ce0)window.__ce0=catchEnd;
 if(!window.__tc0)window.__tc0=ttCatch;
 let T=null;
 const avg=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
 window.momContact=function(b,r){   // the first touch the other team gets on a swing, by rod
  if(T)for(const s of T.sw)if(!s.opp&&r.team!==s.team&&S.time-s.t<T.look)s.opp=r.role;
  return __mc0.apply(this,arguments);
 };
 const DINK={strike:0.16,powFrom:0.05,powTo:0.16,hold:0.31,drop:0.36},DINKV=87;   // the slow swing that still steers cleanly (ttStrikeScene: slides to 20 give 0.011 per u/s at 87 u/s forward)
 if(!window.__to0)window.__to0=ttObs;
 window.ttObs=function(team,bx,tx,t){
  if(!T||!T.dink)return __to0.apply(this,arguments);
  const v=AIC.catch.shotV;AIC.catch.shotV=DINKV;try{return __to0.apply(this,arguments);}finally{AIC.catch.shotV=v;}
 };
 window.kickRod=function(r,style,aim,curve){
  if(T&&T.dink&&r.ttOn&&r.ttPh==='strike'&&r.kickT<0)curve=Object.assign({},AIC.trapShot,DINK);
  if(T&&r.kickT<0){
   const tt=r.ttOn&&r.ttPh==='strike',k=tt?(r.ttW?'cut':'straight'):style==='trapShot'?'pin':style==='pass'?'pass':'plain';
   T.sw.push({t:S.time,team:r.team,k,sc:S.score[r.team],clr:tt?r.ttClr:null,role:tt?r.role:null});
   T.n[k]=(T.n[k]||0)+1;
  }
  return __kr0.call(this,r,style,aim,curve);
 };
 window.catchEnd=function(r,cd,why){if(T&&r.ttOn&&r.catPh==='tictac')T.len.push({n:r.ttN,t:r.ttT,why:why,at:S.time,m:T.m,role:r.role});return __ce0.apply(this,arguments);};
 window.ttCatch=function(r,f,sg,why){if(T&&r.ttOn)T.len.push({n:r.ttN,t:r.ttT,why:'catch:'+why,at:S.time,m:T.m,role:r.role});return __tc0.apply(this,arguments);};
 function resolve(final){
  for(let i=T.sw.length-1;i>=0;i--){
   const s=T.sw[i];
   if(!final&&S.time-s.t<T.look)continue;
   const q=T.out[s.k]||(T.out[s.k]={n:0,blocked:0,gk:0,row:0,goal:0}),goal=S.score[s.team]>s.sc,blk=S.lastTouch>=0&&S.lastTouch!==s.team;
   q.n++;if(blk)q.blocked++;
   if(s.opp==='GK')q.gk++;else if(s.opp)q.row++;
   if(goal)q.goal++;
   if(s.role){const R=T.rl[s.role]||(T.rl[s.role]={strikes:0,blocked:0,goal:0});R.strikes++;if(blk)R.blocked++;if(goal)R.goal++;}
   if(s.clr!=null){const bk=Math.max(0,Math.min(5,Math.floor(s.clr)+1)),B=T.clr[bk]||(T.clr[bk]={n:0,goal:0,blocked:0});B.n++;if(goal)B.goal++;if(blk)B.blocked++;}
   T.sw.splice(i,1);
  }
 }
 window.ttSoak=function(o){
  o=Object.assign({seeds:12,secs:120,seed0:3001,on:true,diff:null,look:1.0},o||{});
  const keep=[AIC.catch.tictac.on,cfg.diffRed,cfg.diffBlue],ST0=AIC.catch.tictac.strike,sk=[ST0.prep,ST0.go,ST0.drop];AIC.catch.tictac.on=!!o.on;
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  if(o.prep!=null)ST0.prep=o.prep;if(o.go!=null)ST0.go=o.go;if(o.drop!=null)ST0.drop=o.drop;
  for(const k in CAS)CAS[k]=0;for(const k in CAW)delete CAW[k];
  T={sw:[],n:{},out:{},look:o.look,goals:0,m:0,whistles:0,len:[],clr:{},wst:[],rl:{}};
  const roles0=AIC.catch.tictac.roles,kw0=[ST0.k,ST0.w],ov={};if(o.roles)AIC.catch.tictac.roles=o.roles;
  if(o.tt)for(const k in o.tt){ov[k]=AIC.catch.tictac[k];AIC.catch.tictac[k]=o.tt[k];}   // CONFIG.ai.catch.tictac keys for this run, put back after
  if(o.dink){T.dink=true;ST0.k=0.011;ST0.w=[0,8,14,20];}
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;const b=S.balls[0],e=T.len.length?T.len[T.len.length-1]:null;if(b&&e&&e.m===T.m&&S.time-e.at<10)T.wst.push({after:+(S.time-e.at).toFixed(1),why:e.why,x:+b.m.position.x.toFixed(0),z:+b.m.position.z.toFixed(0)});};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];T.sw.length=0;
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%12===0)resolve(false);
    }
    resolve(true);T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{Au.whistle=wh;AIC.catch.tictac.on=keep[0];cfg.diffRed=keep[1];cfg.diffBlue=keep[2];ST0.prep=sk[0];ST0.go=sk[1];ST0.drop=sk[2];AIC.catch.tictac.roles=roles0;ST0.k=kw0[0];ST0.w=kw0[1];T.dink=false;for(const k in ov)AIC.catch.tictac[k]=ov[k];}
  const pm=x=>+(x/Math.max(1,T.m)).toFixed(2),C={},W={},E={};
  for(const k in CAS)if(/^tt|^tap$|^hit$|^pin$|^shot$/.test(k))C[k]=pm(CAS[k]);
  for(const k in CAW)if(k.indexOf('tt:')===0||k.indexOf('fire:')===0)W[k]=pm(CAW[k]);
  for(const e of T.len)E[e.why]=(E[e.why]||0)+1;
  const RL={};for(const k of ['ATT','MID','DEF']){const L=T.len.filter(e=>e.role===k),q=T.rl[k]||{strikes:0,blocked:0,goal:0};if(L.length||q.strikes){const by={};for(const e of L)by[e.why]=(by[e.why]||0)+1;RL[k]={rallies:pm(L.length),touches:avg(L.map(e=>e.n)),secs:avg(L.map(e=>e.t)),strikes:pm(q.strikes),blocked:q.strikes?+(q.blocked/q.strikes).toFixed(2):0,goals:pm(q.goal),by};}}
  const sh=k=>{const q=T.out[k]||{n:0,blocked:0,gk:0,row:0,goal:0};return {perMatch:pm(q.n),blocked:q.n?+(q.blocked/q.n).toFixed(2):0,gk:q.n?+(q.gk/q.n).toFixed(2):0,row:q.n?+(q.row/q.n).toFixed(2):0,goalPerMatch:pm(q.goal)};};
  return {on:o.on,diff:o.diff||cfg.diffRed,matches:T.m,wallS:+((performance.now()-t0)/1000).toFixed(1),goals:pm(T.goals),dead:pm(T.whistles),counts:C,ended:W,
   rallies:{n:T.len.length,touches:avg(T.len.map(e=>e.n)),secs:avg(T.len.map(e=>e.t)),by:E},byRole:RL,straight:sh('straight'),cut:sh('cut'),pin:sh('pin'),plain:sh('plain'),pass:sh('pass'),byClr:T.clr,whistlesAfterTT:T.wst};
 };
 window.ttRun=function(o){
  const r=ttSoak(Object.assign({seeds:30,secs:120,diff:'legend'},o)),sc=r.straight,cu=r.cut,n=sc.perMatch+cu.perMatch;
  return {o:JSON.stringify(o),tt:r.counts.tt,commit:r.counts.ttCommit,shots:r.counts.ttShot,goalsFromTT:+(sc.goalPerMatch+cu.goalPerMatch).toFixed(2),blocked:n?+((sc.perMatch*sc.blocked+cu.perMatch*cu.blocked)/n).toFixed(2):0,
   rallyN:r.rallies.n,touches:r.rallies.touches,secs:r.rallies.secs,by:JSON.stringify(r.rallies.by),goals:r.goals,dead:r.dead};
 };
 window.ttAB=function(o){
  o=Object.assign({diff:'legend',seeds:30,seed0:3001},o||{});
  const f=r=>({goals:r.goals,dead:r.dead,tt:r.counts.tt,shots:r.counts.ttShot,ttGoals:+(r.straight.goalPerMatch+r.cut.goalPerMatch).toFixed(2),rallyS:r.rallies.secs,pinShots:r.pin.perMatch,pinGoals:r.pin.goalPerMatch,plain:r.plain.perMatch,plainGoals:r.plain.goalPerMatch,pass:r.pass.perMatch,tap:r.counts.tap,hit:r.counts.hit});
  return {on:f(ttSoak(Object.assign({on:true},o))),off:f(ttSoak(Object.assign({on:false},o)))};
 };
 // --- jobs run in the page between calls (one call of the preview tool is capped at 45 s): ttQ([{name,o}]) queues ttSoak(o) runs, ttQDone() polls (return at once: a call that waits on a timer starves the queue), ttQSum(name) totals the runs of a name ---
 window.ttQ=function(jobs){
  const q=window.__ttq={left:jobs.slice(),done:{},run:false};
  const next=()=>{if(!q.left.length){q.run=false;return;}q.run=true;const j=q.left.shift();setTimeout(()=>{try{(q.done[j.name]=q.done[j.name]||[]).push(ttSoak(j.o));}catch(e){q.err=String(e);}next();},30);};
  next();
 };
 window.ttQDone=function(){const q=window.__ttq;return q?{left:q.left.length,run:q.run,err:q.err||null,done:Object.keys(q.done).map(k=>k+':'+q.done[k].length)}:null;};
 window.ttQSum=function(name){
  const L=window.__ttq.done[name]||[],m=L.reduce((a,r)=>a+r.matches,0),t={m,strikes:0,blocked:0,goals:0,pinShots:0,pinGoals:0,dead:0,matchGoals:0,tt:0,commit:0,plain:0,pass:0,tap:0,hit:0};
  for(const r of L){const k=r.matches;t.strikes+=(r.straight.perMatch+r.cut.perMatch)*k;t.blocked+=(r.straight.perMatch*r.straight.blocked+r.cut.perMatch*r.cut.blocked)*k;t.goals+=(r.straight.goalPerMatch+r.cut.goalPerMatch)*k;t.pinShots+=r.pin.perMatch*k;t.pinGoals+=r.pin.goalPerMatch*k;t.dead+=r.dead*k;t.matchGoals+=r.goals*k;t.tt+=r.counts.tt*k;t.commit+=r.counts.ttCommit*k;t.plain+=r.plain.perMatch*k;t.pass+=r.pass.perMatch*k;t.tap+=r.counts.tap*k;t.hit+=r.counts.hit*k;}
  const f=x=>+x.toFixed(2);
  return {matches:m,strikes:Math.round(t.strikes),blockedShare:t.strikes?f(t.blocked/t.strikes):0,goals:Math.round(t.goals),goalShare:t.strikes?f(t.goals/t.strikes):0,perMatch:{strikes:f(t.strikes/m),tt:f(t.tt/m),pinShots:f(t.pinShots/m),pinGoals:f(t.pinGoals/m),dead:f(t.dead/m),goals:f(t.matchGoals/m),plain:f(t.plain/m),pass:f(t.pass/m),tap:f(t.tap/m),hit:f(t.hit/m)}};
 };
 // --- lane prediction: at each commit, the clearance predicted (the rows' target carried on f[1] of the way over f[0] of the time) against what the same line clears at the planned contact time ---
 if(!window.__ts0)window.__ts0=ttStep;
 let P=null;
 window.ttStep=function(r,best,D){
  const ph0=r.ttPh;
  __ts0.apply(this,arguments);
  if(P&&ph0==='bounce'&&r.ttPh==='strike'){
   const rb=best.real||best,p=rb.m.position,v=rb.v,gx=r.kickDir>0?F.L/2:-F.L/2,ST=AIC.catch.tictac.strike,q=ttPlan(r,r.ttMan,p,v,r.ttW),tq=q.t,cz=q.cz;
   const pred=P.fs.map(f=>{const l0=ST.tgtLead;ST.tgtLead=f[1];try{return pinOutlet(r,p.x,cz,ttObs(r.team,p.x,gx,tq*f[0]),gx,ST.k*r.ttW);}finally{ST.tgtLead=l0;}});
   P.pend.push({due:S.time+tq,r,px:p.x,cz,w:r.ttW,pred,gx,tq});
   if(P.keep){r.ttPh='bounce';r.ttGo=false;}   // take the sample and carry on bouncing: the rally goes on to the next traverse
  }
 };
 window.ttCal=function(o){
  o=Object.assign({seeds:12,secs:120,seed0:3001,diff:'legend',fs:[[0,0],[1,0],[1,0.5],[1,1],[1,1.5],[1,2]]},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],STc=AIC.catch.tictac.strike,st0=[STc.prep,STc.go,STc.drop],w0=STc.w;cfg.diffRed=cfg.diffBlue=o.diff;STc.prep=-1e3;STc.go=-1e3;STc.drop=-1e9;STc.w=o.w||[0];   // commit on every look and give none up, the straight strike alone: the sample does not depend on the prediction
  P={fs:o.fs,pend:[],done:[],keep:o.keep!==false};
  const wh=Au.whistle;Au.whistle=function(){};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz);P.pend.length=0;
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(let k=P.pend.length-1;k>=0;k--){const e=P.pend[k];if(S.time>=e.due){
      const act=pinOutlet(e.r,e.px,e.cz,ttObs(e.r.team,e.px,e.gx,0),e.gx,AIC.catch.tictac.strike.k*e.w);
      P.done.push({pred:e.pred,act,tq:e.tq});P.pend.splice(k,1);}}
    }
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];STc.prep=st0[0];STc.go=st0[1];STc.drop=st0[2];STc.w=w0;}
  const out={n:P.done.length,tq:+(P.done.reduce((a,e)=>a+e.tq,0)/Math.max(1,P.done.length)).toFixed(2),by:{}};
  o.fs.forEach((f,i)=>{let ae=0,tp=0,fp=0,fn=0,tn=0,bias=0;for(const e of P.done){const pr=e.pred[i]>=2,ac=e.act>=1;ae+=Math.abs(e.pred[i]-e.act);bias+=e.pred[i]-e.act;if(pr&&ac)tp++;else if(pr)fp++;else if(ac)fn++;else tn++;}
   out.by['t'+f[0]+' lead'+f[1]]={absErr:+(ae/Math.max(1,P.done.length)).toFixed(2),bias:+(bias/Math.max(1,P.done.length)).toFixed(2),openKept:tp,openLost:fp,missed:fn,shut:tn};});
  P=null;return out;
 };
})();
