// Held-ball soak: where an AI rod's pinned-ball time goes (what pinPlay waited on) and what each play off a pin does.
//      node tools/page-run.js tools/hold-soak.js "hdSoak({seeds:48,secs:120,diff:'pro'})"
//      hdSoak({seeds,secs,seed0,diff,set:{'ai.catch.late.shot':true}})   // set: CONFIG paths overridden for the run, restored after
// secs: s a match per role:wait (settle, mull = a forward pin's look, pull, ready = a pass waiting on its receiver, carry, wait / fwdWait = nothing to do yet, lateStuck = past holdT with nothing to do, play)
// plays: role:style:pcWhy -> pm a match, ct catch time at the swing, poss s since the rod first pinned it, cov share fired covered straight on, field / blk / opp share touched first by a field man / anyone within 0.6 s / anyone, goal share that were the team's last kick before a goal
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 window.hdSoak=function(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,set:null,diff:'pro'},o||{});
  const olds=[];if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  cfg.diffRed=o.diff;cfg.diffBlue=o.diff;
  const W={},K=[],open=[],last=[null,null],m={n:0,goals:0,gt:[0,0]};
  const pp=window.pinPlay;
  window.pinPlay=function(r,best,t,dt,tap){
   const v=pp.apply(this,arguments);
   let w='play';
   if(!v){
    const CA=AIC.catch,RV=CA.recv,fwd=r.angle*r.kickDir>RV.fwdMin;
    w=t<catchT(r,'settleT')?'settle':(fwd&&t<RV.settleT)?'mull':r.puPh?'pull':(r.pcRdy>0&&r.pcRdy<CA.recv.ready.wait)?'ready':r.pcTz!=null?'carry':t>=catchT(r,'holdT')?'lateStuck':'wait';
    if(fwd&&w==='wait')w='fwdWait';
   }
   const k=r.role+':'+w;W[k]=(W[k]||0)+dt;
   return v;
  };
  const kr=window.kickRod;
  window.kickRod=function(r,style){
   if(r.kickT<0&&!isUserRod(r)&&r.pinB){
    const b=r.pinB,p=b.m.position,gx=r.kickDir>0?F.L/2:-F.L/2,CA=AIC.catch;
    const out=pinOutlet(r,p.x,p.z,laneObs(r.team,p.x,gx,CA.shotV),gx,0);
    const k={rod:r,team:r.team,role:r.role,style,why:r.pcWhy,ct:+(r.catT||0).toFixed(2),poss:+(S.time-(r.__a0??S.time)).toFixed(2),out:+out.toFixed(2),sv:+(r.slideV||0).toFixed(1),t:S.time,next:null};
    K.push(k);open.push(k);last[r.team]=k;
   }
   return kr.apply(this,arguments);
  };
  const og=window.onGoal;window.onGoal=function(team){if(last[team]){last[team].goal=1;last[team]=null;}return og.apply(this,arguments);};
  const mc=window.momContact;
  window.momContact=function(b,r){
   for(let i=open.length-1;i>=0;i--){const k=open[i];if(S.time-k.t>2.5){k.next='none';open.splice(i,1);continue;}if(r===k.rod)continue;k.next=r.team===k.team?'own':'opp';k.nr=r.role;k.nt=S.time-k.t;open.splice(i,1);}
   return mc.apply(this,arguments);
  };
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();const sc0=[S.score[0],S.score[1]];
    for(let i=0;i<Math.round(o.secs*SIM.hz);i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     const s0=[S.score[0],S.score[1]];aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(const r of rods){if(r.act==='catch'&&r.pinB&&r.__a0==null)r.__a0=S.time;if(r.act!=='catch')r.__a0=null;}
    }
    for(const k of open)k.next='none';open.length=0;
    m.n++;m.gt[0]+=S.score[0]-sc0[0];m.gt[1]+=S.score[1]-sc0[1];
   }
  }finally{window.pinPlay=pp;window.kickRod=kr;window.momContact=mc;window.onGoal=og;for(const [k,v] of olds.reverse())setPath(k,v);}
  const n=m.n,W2={};for(const k of Object.keys(W).sort())W2[k]=+(W[k]/n).toFixed(1);
  const grp={};
  for(const k of K){const g=k.role+':'+k.style+':'+k.why;const G=grp[g]=grp[g]||{n:0,ct:0,poss:0,blk:0,cov:0,opp:0,fb:0,goal:0};G.n++;if(k.goal)G.goal++;if(k.next==='opp'&&k.nt<0.6&&k.nr!=='GK')G.fb++;G.ct+=k.ct;G.poss+=k.poss;if(k.next==='opp'&&k.nt<0.6)G.blk++;if(k.next==='opp')G.opp++;if(k.out<AIC.catch.lineClear)G.cov++;}
  for(const g in grp){const G=grp[g];grp[g]={pm:+(G.n/n).toFixed(2),ct:+(G.ct/G.n).toFixed(2),poss:+(G.poss/G.n).toFixed(2),cov:+(G.cov/G.n).toFixed(2),field:+(G.fb/G.n).toFixed(2),goal:+(G.goal/G.n).toFixed(2),blk:+(G.blk/G.n).toFixed(2),opp:+(G.opp/G.n).toFixed(2)};}
  window.__hd=K;
  return JSON.stringify({goals:[+(m.gt[0]/n).toFixed(2),+(m.gt[1]/n).toFixed(2)],secs:W2,plays:grp});
 };
})();
