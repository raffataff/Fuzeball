// Catch soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/catch-soak.js').then(r=>r.text()).then(eval)
//      catchSoak({seeds:12,secs:120,on:true})     // N simulated AI-vs-AI matches with CONFIG.ai.catch on
//      catchSoak({seeds:12,secs:120,on:false})    // the same seeds without it (the old scoop / kick-straight-on play)
//      catchScene({rel:9,vx:-20,alone:true})      // one hand-placed ball at the red ATT with a line per 0.1 s; vx<0 runs at the rod from upfield, rel<0 starts behind it; alone removes every other man (the blue DEF 15 ahead and the blue MID 15 behind hit a ball placed past rel 12)
//      catchTry('push off',()=>{AIC.catch.push.on=false;},[9001,9201,9401])   // 36 matches with CONFIG.ai.catch overridden by the function, restored after; goals, pin shots, how each was fired, row / keeper touches
// why: 'does the AI pin a ball from in front and from behind, carry it and play it' is a whole-match question; this drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups)
// per match: CAS tallies (enter / front / behind / pinned / handed to retrieve / shots / passes / refused), how long a pin was held, and for every swing the AI makes
//   the share the other team touched within `look` s (blocked) and the goals, split into pin shots / passes / plain kicks; one call of the preview JS tool is capped at 45 s, so ~12 matches per call
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__kr0)window.__kr0=kickRod;
 let T=null;
 if(!window.__mc0)window.__mc0=momContact;
 window.momContact=function(b,r){   // the first touch the other team gets on a swing, by rod
  if(T)for(const s of T.sw)if(!s.opp&&r.team!==s.team&&S.time-s.t<T.look)s.opp=r.role;
  return __mc0.apply(this,arguments);
 };
 const avg=(a)=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):0;
 window.kickRod=function(r,style,aim,curve){
  if(T&&r.kickT<0){
   const k=style==='trapShot'?'pin':style==='pass'?'pass':'plain';
   T.sw.push({t:S.time,team:r.team,k,sc:S.score[r.team]});
   T.n[k]=(T.n[k]||0)+1;
  }
  return __kr0.apply(this,arguments);
 };
 function resolve(final){
  for(let i=T.sw.length-1;i>=0;i--){
   const s=T.sw[i];
   if(!final&&S.time-s.t<T.look)continue;
   const q=T.out[s.k]||(T.out[s.k]={n:0,blocked:0,saved:0,stopped:0,goal:0});
   q.n++;if(S.lastTouch>=0&&S.lastTouch!==s.team)q.blocked++;
   if(s.opp==='GK')q.saved++;else if(s.opp)q.stopped++;
   if(S.score[s.team]>s.sc)q.goal++;
   T.sw.splice(i,1);
  }
 }
 function catchSoak(o){
  o=Object.assign({seeds:8,secs:120,seed0:1,on:true,diff:null,look:1.0},o||{});
  const keep=[AIC.catch.on,cfg.diffRed,cfg.diffBlue];AIC.catch.on=!!o.on;
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  for(const k in CAS)CAS[k]=0;
  for(const k in CAW)delete CAW[k];
  const R0={enter:BGS.retEnter,pin:BGS.retPin,shot:BGS.retShot,drop:BGS.retDrop};
  T={sw:[],n:{},out:{},look:o.look,goals:0,m:0,holds:[],pinSteps:0,steps:0,whistles:0};
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.__ph=null;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];
    T.sw.length=0;
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%12===0)resolve(false);
     for(const r of rods){
      if(r.pinB){r.__pt=(r.__pt||0)+FIX;T.pinSteps++;}else if(r.__pt){T.holds.push(r.__pt);r.__pt=0;}
     }
     T.steps++;
    }
    resolve(true);T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{Au.whistle=wh;AIC.catch.on=keep[0];cfg.diffRed=keep[1];cfg.diffBlue=keep[2];}
  const pm=(x)=>+(x/Math.max(1,T.m)).toFixed(2);
  const sh=(k)=>{const q=T.out[k]||{n:0,blocked:0,saved:0,stopped:0,goal:0};return {perMatch:pm(q.n),blocked:q.n?+(q.blocked/q.n).toFixed(2):0,keeperTouch:q.n?+(q.saved/q.n).toFixed(2):0,rowTouch:q.n?+(q.stopped/q.n).toFixed(2):0,goalPerMatch:pm(q.goal)};};
  const C={},W={};for(const k in CAS)C[k]=pm(CAS[k]);for(const k in CAW)W[k]=pm(CAW[k]);
  return {on:o.on,diff:o.diff||cfg.diffRed,matches:T.m,wallS:+((performance.now()-t0)/1000).toFixed(1),goalsPerMatch:pm(T.goals),deadBallPerMatch:pm(T.whistles),
   catchPerMatch:C,endedBy:W,retrievePerMatch:{enter:pm(BGS.retEnter-R0.enter),pin:pm(BGS.retPin-R0.pin),shot:pm(BGS.retShot-R0.shot),drop:pm(BGS.retDrop-R0.drop)},pinHoldS:avg(T.holds),pinnedShare:+(T.pinSteps/Math.max(1,T.steps*rods.length)).toFixed(4),
   pinShots:sh('pin'),passes:sh('pass'),plainKicks:sh('plain')};
 }
 // one hand-placed ball at the red ATT: vx is dir-relative (negative = toward the rod from upfield), rel the start (negative = behind the rod); iq forces the roll
 function catchScene(o){
  o=Object.assign({ri:5,rel:9,vx:-20,vz:0,T:2.6,seed:1,every:0.1,dz:0,iq:true,from:0,alone:false},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;});
  const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic');
  if(o.alone)for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;   // no other man to hit the ball or block a lane
  b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[Math.min(1,r.baseZ.length-1)]+o.dz);b.v.set(o.vx*dir,0,o.vz);syncBall(b);
  const L=[];let nt=o.from,fire=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   r.aiIQ=o.iq;const pk=r.kickT>=0;
   aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
   const t=i/SIM.hz;
   if(!pk&&r.kickT>=0&&!fire)fire={t:+t.toFixed(2),style:r.kickStyle,z:+b.m.position.z.toFixed(2),slideV:+r.slideV.toFixed(1)};
   if(t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ang=${(r.angle*dir).toFixed(2)} act=${r.act||'-'}${r.catPh?'/'+r.catPh:''}${r.retPh?'/'+r.retPh:''} pin=${r.pinB?1:0} off=${r.offset.toFixed(1)} tgt=${r.target.toFixed(1)} | ball rel=${((b.m.position.x-r.x)*dir).toFixed(2)} z=${b.m.position.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(S.phase!=='play')break;
  }
  return {fire,L};
 }
 // catchTry('push off',()=>{AIC.catch.push.on=false;},[3001,3201]) = catchSoak (12 matches a seed) with CONFIG.ai.catch overridden by the function, restored after; the pin-shot figures that matter
 function catchTry(tag,ov,seeds){
  const CA=AIC.catch,keep=JSON.stringify(CA);ov();
  const A={n:0,pin:0,bl:0,row:0,gk:0,goals:0,flip:0,pass:0,ends:{}};
  try{for(const s0 of seeds||[3001]){const r=catchSoak({seeds:12,secs:120,on:true,seed0:s0});A.n++;A.pin+=r.pinShots.perMatch;A.bl+=r.pinShots.blocked*r.pinShots.perMatch;A.row+=r.pinShots.rowTouch*r.pinShots.perMatch;A.gk+=r.pinShots.keeperTouch*r.pinShots.perMatch;A.goals+=r.goalsPerMatch;A.flip+=r.catchPerMatch.flip;A.pass+=r.passes.perMatch;for(const k in r.endedBy)if(k.indexOf('fire:')===0)A.ends[k]=(A.ends[k]||0)+r.endedBy[k];}}
  finally{const k=JSON.parse(keep);for(const x in k)CA[x]=k[x];}
  const f=(x)=>+(x/A.n).toFixed(2),E={};for(const k in A.ends)E[k.slice(5)]=f(A.ends[k]);
  return {tag,matches:A.n*12,goals:f(A.goals),pinShots:f(A.pin),blocked:A.pin?+(A.bl/A.pin).toFixed(2):0,rowStopped:A.pin?+(A.row/A.pin).toFixed(2):0,keeperTouch:A.pin?+(A.gk/A.pin).toFixed(2):0,flips:f(A.flip),passes:f(A.pass),firedBy:E};
 }
 window.catchSoak=catchSoak;window.catchScene=catchScene;window.catchTry=catchTry;
})();
