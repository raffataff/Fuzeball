// Back-swing soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/backswing-soak.js').then(r=>r.text()).then(eval)
//      bsSoak({seeds:40,secs:180})            // N simulated AI-vs-AI matches; returns the tally
//      bsSoak({seeds:40,secs:180,dump:'GK'})  // plus the last steps before each flagged GK knock
// why: 'do AI rods swing back or slide into a slow ball behind them and knock it toward their own goal' is a whole-match question; it drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups and cannonballs), deterministic per seed
// tallies:
//   knock: a step where a rod's boot changes a slow (<maxSpd) ball's velocity goalward by more than minDv while the ball is behind or level with the rod (rel <= 0.5), split by what the rod was doing: 'back', 'slide', 'still'
//   own: a goal whose conceding team touched the ball last, with that team's latest knock within ownWin seconds
'use strict';
(function(){
 const FIX=1/SIM.hz;
 // silent by construction: Au.init is stubbed (every Au.* caller is null-guarded on it), a running context is suspended, and cfg.sound is left alone so nothing is saved into the player's settings
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function bsSoak(o){
  o=Object.assign({seeds:40,secs:180,seed0:1,minDv:6,maxSpd:40,ownWin:2.0,dump:null,ring:40},o||{});
  const T={steps:0,matchSecs:0,goals:0,own:0,knocks:0,redrops:0,idleSecs:0,held:{n:0,over1:0,over3:0,maxS:0},byKind:{},byRole:{},byAct:{},ownBy:{},dumps:[]};
  const rb=window.redropBall;window.redropBall=function(){T.redrops++;return rb.apply(this,arguments);};   // a dead ball: the stall the AI could not clear itself
  for(let si=0;si<o.seeds;si++){
   const seed=o.seed0+si*7;
   S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
   rods.forEach(r=>{r.bgT=-9;r.lhT=0;});   // rod objects outlive the match, so a stale stamp would read as a held rod
   const n=Math.round(o.secs*SIM.hz),ring=rods.map(()=>[]),lastKnock=[null,null],streak=rods.map(()=>0);
   for(let i=0;i<n;i++){
    if(S.phase!=='play'){S.phase='count';serve();}
    const b0=S.balls[0];if(!b0)break;
    const pp=b0.m.position.clone(),pv=b0.v.clone();
    const pst=rods.map(r=>({a:r.angle,off:r.offset,raise:r.raise,act:r.act?(r.act==='retrieve'?'retrieve/'+r.retPh:r.act):r.act,bf:r.behindFlag,tgt:r.target,kT:r.kickT}));   // a retrieve is named by its phase
    const sc0=S.score.slice();
    aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);
    const post=rods.map(r=>({a:r.angle,off:r.offset,act:r.act,raise:r.raise}));
    physics(FIX);S.time+=FIX;T.steps++;if(b0.v.lengthSq()<9)T.idleSecs+=FIX;
    for(const q of S.balls)q.cur.copy(q.m.position);   // main.js does this after every sim step; the dead-ball clock and the AI's force read cur
    for(const r of rods){   // a rod the back guard keeps overruling for seconds on end is a stuck rod
     const ri=r.idx;
     if(r.bgT!==undefined&&S.time-r.bgT<2.5*FIX)streak[ri]++;
     else if(streak[ri]){const sec=streak[ri]*FIX;T.held.n++;if(sec>1)T.held.over1++;if(sec>3)T.held.over3++;if(sec>T.held.maxS)T.held.maxS=+sec.toFixed(1);streak[ri]=0;}
    }
    if(o.dump)rods.forEach((r,ri)=>{const q=ring[ri],dir=r.team===0?1:-1;q.push({t:S.time,a0:pst[ri].a,a1:post[ri].a,r0:pst[ri].raise?1:0,r1:post[ri].raise?1:0,act:pst[ri].act||'-',off:pst[ri].off,tgt:pst[ri].tgt,rel:(pp.x-r.x)*dir,bz:pp.z,vx:pv.x*dir,vz:pv.z});if(q.length>o.ring)q.shift();});
    const b=S.balls[0];
    if(b&&b===b0){
     const dv=b.v.clone().sub(pv);
     // who touched it: the team that touched last (collideRod stamps S.lastTouch), and of that team the rod nearest the ball
     let tq=null;if(S.lastTouch>=0)for(const q of rods)if(q.team===S.lastTouch&&(!tq||Math.abs(pp.x-q.x)<Math.abs(pp.x-tq.x)))tq=q;
     if(tq&&dv.length()>=3&&pv.length()<=o.maxSpd)for(const r of [tq]){
      const dir=r.team===0?1:-1,rel=(pp.x-r.x)*dir,d=dv.x*dir;
      if(rel>0.5||rel<-9||d>-o.minDv||b.v.x*dir>-2)continue;   // a goalward PUSH: it must leave heading for the rod's own goal, not just be slowed
      const aD=(post[r.idx].a-pst[r.idx].a)*dir,oD=(post[r.idx].off-pst[r.idx].off)/FIX;
      if(Math.abs(aD)>0.3)continue;                       // a serve/reset teleport, not a swing
      const kind=aD<-0.004?'back':(Math.abs(oD)>8?'slide':'still');
      const act=pst[r.idx].act||(pst[r.idx].raise?'raise':'-');
      T.knocks++;T.byKind[kind]=(T.byKind[kind]||0)+1;T.byRole[r.role]=(T.byRole[r.role]||0)+1;
      const k=kind+'|'+act+(r.force?'|F':'');T.byAct[k]=(T.byAct[k]||0)+1;   // |F: the rod was in the dead-ball push (CONFIG.ai.force)
      lastKnock[r.team]={t:S.time,kind,act,role:r.role,d};
      if(o.dump&&(o.dump===true||o.dump===r.role))T.dumps.push({seed,t:+S.time.toFixed(2),role:r.role,team:r.team,kind,act,rel:+rel.toFixed(2),dvx:+d.toFixed(1),hist:ring[r.idx].map(h=>Object.assign({},h))});
     }
    }
    if(S.score[0]>sc0[0]||S.score[1]>sc0[1]){
     const conceded=S.score[0]>sc0[0]?1:0,k=lastKnock[conceded];    // team 0 scoring means team 1 conceded
     T.goals++;
     if(k&&S.time-k.t<=o.ownWin){T.own++;const key=k.kind+'|'+k.act+'|'+k.role;T.ownBy[key]=(T.ownBy[key]||0)+1;}
    }
   }
   T.matchSecs+=o.secs;
  }
  window.redropBall=rb;
  T.idleSecs=+T.idleSecs.toFixed(1);
  return T;
 }
 // the keeper scenario: a slow ball in the pocket between the red keeper and its goal line, keeper anywhere on its slide
 //   bsKeeper({n:600,T:4})            // ri:0 = red keeper (default); ri:1 DEF, 3 MID, 5 ATT; 2/4/6/7 are blue
 //   bsKeeper({n:400,T:6,ri:3,zr:26})  // e.g. the red midfield, ball dropped across ±26 in z
 // each trial is a fresh seeded state (resetRodRotation wipes every latch); a goalward knock leaves a slow ball behind the rod heading for its own goal; an own goal is one with a goal conceded inside 3 s and no other touch; compare runs, not single trials
 function bsKeeper(o){
  o=Object.assign({n:600,T:4,param:12345,minDv:4,maxSpd:40,only:null,trace:null,ri:0,zr:14},o||{});   // ri: which rod (0 = red keeper); zr: half-width the ball is dropped across
  let s=o.param;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const R={n:o.n,trialsWithKnock:0,knocks:0,ownGoals:0,byKind:{},ownBy:{},rows:[],out:{goal:0,cleared:0,pocket:0}};   // out: where each ball ended up after T
  for(let k=0;k<o.n;k++){
   const relB=-0.9-rnd()*4.7,z=(rnd()*2-1)*o.zr,sp=rnd()*12,an=rnd()*6.283,koff=(rnd()*2-1)*10;   // relB: dir-relative x behind the rod
   if(o.only!=null&&k!==o.only)continue;
   S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=z;r.bgT=-9;r.lhT=0;r.retCd=0;r.retPh=null;r.laneCd=0;r.evadeCd=0;r.dribCd=0;});   // per-rod cooldowns outlive the match: a trial must start clean
   const g=rods[o.ri],dir=g.team===0?1:-1,x=g.x+dir*relB,own=g.team===0?1:0;   // own: the score slot that means THIS rod's team conceded
   g.offset=clamp(koff,-g.maxOff,g.maxOff);g.target=g.offset;g.prevOffset=g.offset;g.iPrevOff=g.offset;g.slideV=0;g.vz=0;   // prevOffset too, or step 0 reads a 500 u/s slide
   const b=makeBall('classic');b.m.position.set(x,BALL_R,z);b.v.set(Math.cos(an)*sp,0,Math.sin(an)*sp);syncBall(b);
   let last=null,n=0,hadKnock=false,ended=false;const steps=Math.round(o.T*SIM.hz);
   for(let i=0;i<steps;i++){
    const pv=b.v.clone(),pp=b.m.position.clone(),pa=g.angle,po=g.offset,pact=g.act,praise=g.raise,sc1=S.score[own];
    for(const bb of S.balls)bb.prev.copy(bb.m.position);
    aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
    const t=i/SIM.hz;
    if(o.trace)o.trace(t,pp,pv,pa,po,pact,praise,g,b,k);
    if(S.score[own]>sc1){R.out.goal++;ended=true;if(last&&t-last.t<=3){R.ownGoals++;R.rows.push({k,own:true,key:last.kind+'|'+last.act});const key=last.kind+'|'+last.act;R.ownBy[key]=(R.ownBy[key]||0)+1;}break;}
    if(S.phase!=='play')break;
    const dv=b.v.clone().sub(pv);
    if(dv.length()>2.5){
     if(Math.abs(pp.x-g.x)<10){
      const rel=(pp.x-g.x)*dir,aD=(g.angle-pa)*dir,oD=(g.offset-po)/FIX;
      const kind=aD<-0.004?'back':(Math.abs(oD)>8?'slide':'still');
      const gw=dv.x*dir<-o.minDv&&b.v.x*dir<-4&&rel<=0.5&&pv.length()<o.maxSpd;
      if(gw){R.knocks++;hadKnock=true;const key=kind+'|'+(pact||(praise?'raise':'-'));R.byKind[key]=(R.byKind[key]||0)+1;last={t,kind,act:pact||(praise?'raise':'-'),k};R.rows.push({k,t:+t.toFixed(3),key,rel:+rel.toFixed(2),dvx:+(dv.x*dir).toFixed(1)});}else last=null;
     }else last=null;
    }
   }
   if(hadKnock)R.trialsWithKnock++;
   if(!ended)R.out[(b.m.position.x-g.x)*dir>1?'cleared':'pocket']++;
  }
  return R;
 }
 // one hand-placed situation on the real sim, a line per `every` seconds: rel = the ball's dir-relative x from the rod (negative = behind), bz its z, koff the man's starting slide
 //   bsScene({ri:0,rel:-1.5,bz:5,T:4,iq:1})   // ri 0 = red keeper, 1 = red DEF, 3 = red MID, 5 = red ATT
 // iq forces the smart/dumb roll (null = the AI's own); `cap` adds a final-state summary line
 function bsScene(o){
  o=Object.assign({ri:0,rel:-3,bz:6,koff:0,T:6,seed:1,every:0.2,vx:0,vz:0,iq:null,from:0},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=o.bz;r.bgT=-9;r.lhT=0;r.retCd=0;});
  const r=rods[o.ri],dir=r.team===0?1:-1;
  r.offset=o.koff;r.target=o.koff;r.prevOffset=o.koff;r.iPrevOff=o.koff;r.slideV=0;r.vz=0;
  const b=makeBall('classic');b.m.position.set(r.x+o.rel*dir,BALL_R,o.bz);b.v.set(o.vx*dir,0,o.vz);syncBall(b);
  const L=[];let nt=o.from;const N=Math.round(o.T*SIM.hz);
  for(let i=0;i<N;i++){
   const t=i/SIM.hz;
   if(o.iq!==null)r.aiIQ=o.iq;
   if(t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} iq=${r.aiIQ?1:0} ang=${(r.angle*dir).toFixed(2)} act=${r.act||'-'}${r.retPh?'/'+r.retPh:''} pin=${r.pinB?1:0} man=${r.offset.toFixed(1)} tgt=${r.target.toFixed(1)} | ball rel=${((b.m.position.x-r.x)*dir).toFixed(2)} z=${b.m.position.z.toFixed(1)} y=${b.m.position.y.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);   // main.js does this after every sim step
   if(S.phase!=='play'){L.push('phase='+S.phase+' score='+S.score);break;}
  }
  return L;
 }
 window.bsSoak=bsSoak;window.bsKeeper=bsKeeper;window.bsScene=bsScene;
})();
