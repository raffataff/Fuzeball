// Dead-ball soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/deadforce-soak.js').then(r=>r.text()).then(eval)
//      dfSoak({seeds:20,secs:180})      // N simulated AI-vs-AI matches; returns the tally
// why: 'does an AI rod let a ball it could play go dead' is a whole-match question; it drives the real aiUpdate / updateRods / physics / deadBallUpdate, deterministic per seed
// tallies:
//   redrops: whistles, split by where the ball died: 'live' (a man could swing at it), 'deadzone' (pocket / lane / roof), 'plain'
//   live[...]: for a 'live' whistle, what the nearest rod was doing: its action, whether its kick cooldown / shot hold / sweet-spot wait was up, whether a man was lined up
//   idleSecs: seconds a ball sat in a live zone with the dead-ball clock past `from` s (how long the AI sat on it)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function dfWhy(b){
  let r=null;for(const q of rods)if(!r||Math.abs(b.cur.x-q.x)<Math.abs(b.cur.x-r.x))r=q;
  const dir=r.team===0?1:-1,rel=(b.cur.x-r.x)*dir,z=b.cur.z;let dz=1e9,ri=1e9,mi=-1;
  for(let i=0;i<r.baseZ.length;i++){
   const d=Math.abs(z-(r.baseZ[i]+r.offset));if(d<dz){dz=d;mi=i;}
   ri=Math.min(ri,Math.max(0,Math.abs(z-r.baseZ[i])-r.maxOff));   // how far the ball is outside this man's whole slide range
  }
  if(ri>=FOOT_BOX.z+BALL_R-0.2)return 'unreachable';   // beside the slide range: no boot can touch it, the whistle is right
  const why=[r.act||'-'];
  if(r.heldFwd)why.push('held');
  if(r.cd>0)why.push('cd');
  if(r.shotHoldT>0)why.push('hold');
  if(dz>=1.25)why.push(r.aiMan!==mi?'wrongMan':'aimOff');
  why.push(rel<-0.6?'heel':(rel<6.3?'reach':'far'));
  return r.role+' '+why.join('+');
 }
 function dfSoak(o){
  o=Object.assign({seeds:20,secs:180,seed0:1,from:2,after:5},o||{});
  const T={steps:0,matchSecs:0,goals:0,redrops:0,where:{live:0,unreach:0,idle:0,deadzone:0,plain:0},live:{},idleSecs:0,idleRuns:0,afterRedrop:0};   // afterRedrop: goals scored within `after` s of a whistle
  const rb=window.redropBall;let snap=null,lastR=-99;
  window.redropBall=function(b){
   T.redrops++;lastR=S.time;
   const p=b.cur,zm=deadzoneMult(p),k=zm>1?'deadzone':(liveZone(p)?'live':'plain');
   T.where[k]++;
   if(k==='live'){const w=snap||'?';if(w==='unreachable')T.where.unreach++;else{T.where.idle++;T.live[w]=(T.live[w]||0)+1;}}   // the whistle resets every rod first, so classify the step before
   return rb.apply(this,arguments);
  };
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;
    S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.cd=0;r.retCd=0;r.laneCd=0;r.evadeCd=0;r.dribCd=0;r.shotHoldT=0;});
    const n=Math.round(o.secs*SIM.hz);let run=0;
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     const sc0=S.score[0]+S.score[1];
     if(S.balls[0]&&S.balls[0].stuckT>DEAD.stallT-0.1)snap=dfWhy(S.balls[0]);
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;T.steps++;
     for(const q of S.balls)q.cur.copy(q.m.position);   // main.js does this after every sim step; the dead-ball clock reads cur
     const b=S.balls[0];
     if(b&&b.stuckT>o.from&&liveZone(b.cur)&&deadzoneMult(b.cur)===1){T.idleSecs+=FIX;run++;}
     else if(run){T.idleRuns++;run=0;}
     if(S.score[0]+S.score[1]>sc0){T.goals++;if(S.time-lastR<o.after)T.afterRedrop++;}
    }
    T.matchSecs+=o.secs;
   }
  }finally{window.redropBall=rb;}
  T.idleSecs=+T.idleSecs.toFixed(1);
  T.live=Object.fromEntries(Object.entries(T.live).sort((a,b)=>b[1]-a[1]));
  return T;
 }
 window.dfSoak=dfSoak;
})();
