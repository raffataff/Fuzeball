// Goal-cover soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/cover-soak.js').then(r=>r.text()).then(eval)
//      cvSoak({seeds:24,secs:120,on:true})     // N simulated AI-vs-AI matches with CONFIG.ai.cover on
//      cvSoak({seeds:24,secs:120,on:false})    // the same seeds with the old shared ball-to-goal line
// why: 'do the keeper and the defender split the goal between them' is a whole-match question; it drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups and cannonballs), deterministic per seed
// tallies, per defending team, on every `every`th step while the ball is on the floor in open play:
//   front: ball well ahead of the DEF (a real shot): mean open width of the mouth in u (of 2*goalHalf*0.9), measured by testing real lines from the ball against the keeper and DEF men where they actually stand
//   back:  ball behind the DEF (the keeper or DEF has it): the same width for a turnover shot from `nom` ahead of the DEF at 0.8 of the ball's z, and `stack`, the share of those steps with the keeper and a DEF man closer in z than their feet are wide
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 // open width: lines from (ox,oz) to the goal line gx that no man touches
 function openW(men,ox,oz,gx,m,st){
  const hw=AIC.gapAim.blockR;let w=0;
  for(let z=-m;z<=m;z+=st){let hit=false;
   for(const q of men){const t=(q.x-ox)/(gx-ox);if(t<=0)continue;if(Math.abs(oz+(z-oz)*t-q.z)<hw){hit=true;break;}}
   if(!hit)w+=st;}
  return w;
 }
 const menOf=(r)=>{const a=[];for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))a.push({x:r.x,z:r.baseZ[i]+r.offset});return a;};
 function cvSoak(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,every:6,step:0.25,on:true,nom:25},o||{});
  const keep=AIC.cover.on;AIC.cover.on=!!o.on;
  const m=F.goalHalf*0.9,E=AIC.defend.engage+4;
  const T={on:o.on,matches:0,goals:0,frontN:0,frontSum:0,backN:0,backSum:0,stackN:0,steps:0,aiMs:0};
  const gk=[0,1].map(t=>rods.find(r=>r.team===t&&r.role==='GK')),df=[0,1].map(t=>rods.find(r=>r.team===t&&r.role==='DEF'));
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;
    S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.cvM=0;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     const b=S.balls[0];if(!b)break;
     const t0=performance.now();aiUpdate(FIX);T.aiMs+=performance.now()-t0;
     userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);
     physics(FIX);S.time+=FIX;T.steps++;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%o.every||S.phase!=='play'||b.m.position.y>=AIC.lowY)continue;
     const bp=b.m.position;
     for(let t=0;t<2;t++){
      const dir=t===0?1:-1,g=gk[t],d=df[t],gx=dir>0?-F.L/2:F.L/2,relD=(bp.x-d.x)*dir;
      const men=menOf(g).concat(menOf(d));
      if(relD>E){T.frontN++;T.frontSum+=openW(men,bp.x,bp.z,gx,m,o.step);}
      else if(relD<-AIC.defend.engage&&(bp.x-g.x)*dir<AIC.defend.engage+8){   // the keeper has it or it is loose between the two rods
       T.backN++;T.backSum+=openW(men,d.x+dir*o.nom,bp.z*AIC.cover.nomZ,gx,m,o.step);
       const gz=g.baseZ[0]+g.offset;let dz=1e9;for(const q of menOf(d))dz=Math.min(dz,Math.abs(q.z-gz));
       if(dz<2*FOOT_BOX.z+0.2)T.stackN++;
      }
     }
    }
    T.goals+=S.score[0]+S.score[1]-sc0;T.matches++;
   }
  }finally{AIC.cover.on=keep;}
  return {on:T.on,matches:T.matches,goalsPerMatch:+(T.goals/T.matches).toFixed(2),
   frontOpen:+(T.frontSum/Math.max(1,T.frontN)).toFixed(2),frontSamples:T.frontN,
   backOpen:+(T.backSum/Math.max(1,T.backN)).toFixed(2),backSamples:T.backN,stackShare:+(T.stackN/Math.max(1,T.backN)).toFixed(3),
   aiUsPerStep:+(T.aiMs*1000/Math.max(1,T.steps)).toFixed(1),mouth:+(2*m).toFixed(1)};
 }
 // the shooting gallery: the red keeper and DEF alone (every other man removed) face aimed shots from in front of the DEF; settle = seconds the ball rests first so the pair takes its slots
 //   cvGallery({n:150,on:true,vr:[95,140],xr:[-30,-18]})    // fast shots at the widest open lane (shotEval), the way a human would pick it: goals / n is what the old shared line concedes
 //   cvGallery({n:150,on:true,smart:false})                  // the same shots at random points across the mouth
 function cvGallery(o){
  o=Object.assign({n:150,on:true,smart:true,seed:99,xr:[-26,-12],zr:[-22,22],vr:[45,85],gzr:[-9,9],settle:0.9,T:2.2,jit:0.5},o||{});
  const keep=AIC.cover.on;AIC.cover.on=!!o.on;
  let s=o.seed;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const R={on:o.on,n:0,goal:0,blocked:0,other:0};
  try{
   for(let k=0;k<o.n;k++){
    const x0=U(o.xr[0],o.xr[1]),z0=U(o.zr[0],o.zr[1]),sp=U(o.vr[0],o.vr[1]),jit=U(-o.jit,o.jit),gz0=U(o.gzr[0],o.gzr[1]);
    S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
    for(const r of rods)if(!(r.team===0&&(r.role==='GK'||r.role==='DEF')))for(let i=0;i<r.baseZ.length;i++)r.removedUntil[i]=1e9;
    rods.forEach(r=>{r.aiBX=x0;r.aiBZ=z0;r.cvM=0;});
    const b=makeBall('classic');b.m.position.set(x0,BALL_R,z0);b.v.set(0,0,0);syncBall(b);b.cur.copy(b.m.position);
    const sc1=S.score[1],nS=Math.round(o.settle*SIM.hz),nT=Math.round(o.T*SIM.hz);let out=null;
    for(let i=0;i<nS+nT;i++){
     if(i===nS){const gz=(o.smart?shotEval(1,x0,z0).best.tz+jit:gz0),dx=-F.L/2-x0,dz=gz-z0,L=Math.hypot(dx,dz);b.v.set(sp*dx/L,0,sp*dz/L);}
     if(i<nS){b.v.set(0,0,0);b.m.position.set(x0,BALL_R,z0);syncBall(b);b.cur.copy(b.m.position);}
     for(const bb of S.balls)bb.prev.copy(bb.m.position);
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(S.score[1]>sc1){out='goal';break;}
     if(S.balls[0]!==b)break;
     if(i>nS+20&&b.v.x>2){out='blocked';break;}   // sent back up the pitch
    }
    R.n++;R[out||'other']++;
   }
  }finally{AIC.cover.on=keep;}
  return R;
 }
 // a ball off the end wall, wide of the mouth, rolling back out past the keeper to the DEF (the red keeper and DEF alone play it)
 //   cvRebound({n:60})     // dz = how far the DEF's nearest man stands from the ball's z when the ball gets to the DEF's line; kz = the keeper's z then
 function cvRebound(o){
  o=Object.assign({n:60,zr:[15,30],vr:[15,45],seed:5,T:3.5},o||{});
  let s=o.seed;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const g=rods.find(r=>r.team===0&&r.role==='GK'),d=rods.find(r=>r.team===0&&r.role==='DEF');
  const R={n:0,met:0,miss:0,dzSum:0,kzSum:0,kAbs:0,reached:0,goal:0};
  for(let k=0;k<o.n;k++){
   const z0=(k%2?1:-1)*U(o.zr[0],o.zr[1]),sp=U(o.vr[0],o.vr[1]);
   S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   for(const r of rods)if(!(r.team===0&&(r.role==='GK'||r.role==='DEF')))for(let i=0;i<r.baseZ.length;i++)r.removedUntil[i]=1e9;
   rods.forEach(r=>{r.aiBX=-F.L/2+2;r.aiBZ=z0;r.cvM=0;});
   const b=makeBall('classic');b.m.position.set(-F.L/2+BALL_R+0.5,BALL_R,z0);b.v.set(sp,0,0);syncBall(b);b.cur.copy(b.m.position);
   const sc1=S.score[1],n=Math.round(o.T*SIM.hz);let done=false;
   for(let i=0;i<n&&!done;i++){
    for(const bb of S.balls)bb.prev.copy(bb.m.position);
    aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
    for(const q of S.balls)q.cur.copy(q.m.position);
    if(S.score[1]>sc1){R.goal++;break;}
    if(S.balls[0]!==b)break;
    const bp=b.m.position;
    if(bp.x>d.x-3){
     let dz=1e9;for(let j=0;j<d.baseZ.length;j++)if(manLive(d,j))dz=Math.min(dz,Math.abs(d.baseZ[j]+d.offset-bp.z));
     R.reached++;R.dzSum+=dz;R.kzSum+=Math.abs(g.baseZ[0]+g.offset);if(dz<FOOT_BOX.z+BALL_R+1)R.met++;else R.miss++;done=true;
    }
   }
   R.n++;
  }
  return {n:R.n,reached:R.reached,metShare:+(R.met/Math.max(1,R.reached)).toFixed(2),meanDZ:+(R.dzSum/Math.max(1,R.reached)).toFixed(1),meanKeeperZ:+(R.kzSum/Math.max(1,R.reached)).toFixed(1),goals:R.goal};
 }
 window.cvSoak=cvSoak;window.cvGallery=cvGallery;window.cvRebound=cvRebound;
})();
