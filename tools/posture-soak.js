// Standing-posture coverage. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/posture-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      rdCover({seeds:12,secs:120,diff:'legend'})   // AI-vs-AI matches: how often the rods ahead of the ball stand in the receiving pose, by who has the ball
// why: the pose is meant for any time the team has the ball under control (not only a pinned one); this counts it
// control: pinned = one of the team's rods holds the ball; slow = the team touched it last and it is under 25 u/s; fast = touched last, quicker (a shot / clearance in flight);
//   feet = the other team touched it last but it lies slow in reach of one of the team's rods; loose = anything else
// pose of a rod ahead of the ball (at least minAhead, at most reach): fwd = tilted forward over 0.25 rad, up = raised or tilted back, other = in between; act = what a rod not standing forward was doing
'use strict';
(function(){
 const FIX=1/SIM.hz,FASTV=25;   // the old ready limit: a ball over this speed is 'fast'
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function rdCover(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:null,every:6},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=cfg.diffBlue=o.diff;}
  const RV=AIC.catch.recv,RD=RV.ready,PS=AIC.dribble.pass,T={m:0,samples:0,by:{},acts:{},hold:{}};
  const wh=Au.whistle;Au.whistle=function(){};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     const b=S.balls[0];if(!b)break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%o.every)continue;
     const p=b.m.position,sp=b.v.length();
     for(let t=0;t<2;t++){
      const dir=t===0?1:-1,own=rods.filter(r=>r.team===t);
      let c='loose';
      if(b.pinR&&b.pinR.team===t)c='pinned';
      else if(S.lastTouch===t&&p.y<=AIC.lowY)c=sp<=FASTV?'slow':'fast';
      else if(sp<=FASTV&&p.y<=AIC.lowY&&own.some(r=>{const rel=(p.x-r.x)*dir;return rel>-5&&rel<7;}))c='feet';
      let hr=null;for(const r of own){const rel=(p.x-r.x)*dir;if(rel>=-5&&rel<=6.3&&(!hr||Math.abs(rel)<Math.abs((p.x-hr.x)*dir)))hr=r;}   // the rod the ball is in reach of
      for(const r of own){
       if(RV.roles.indexOf(r.role)<0||isUserRod(r))continue;
       const ahead=(r.x-p.x)*dir;if(ahead<PS.minAhead||ahead>RD.reach)continue;
       const a=r.angle*dir,pose=(a>0.25||r.act==='recv'&&r.pinPose)?'fwd':(r.raise||a<-0.5)?'up':'other';
       const k=c+'|'+pose;T.by[k]=(T.by[k]||0)+1;T.samples++;
       if(hr&&c!=='loose'){const hk=hr.role+'>'+r.role+'|'+pose;T.hold[hk]=(T.hold[hk]||0)+1;}
       if(pose!=='fwd'){
        let why=r.act||(r.raise?'raised':'-');
        if(!r.act&&c==='slow')why+=(r.rvCd||0)>S.time?'+cd':(r.rvUntil||0)>S.time&&!r.rvReady?'+pass':r.kickT>=0?'+swing':r.force?'+force':ahead<PS.minAhead+3?'+near':'+?';
        const ak=c+'|'+why;T.acts[ak]=(T.acts[ak]||0)+1;
       }
       if(c==='fast'){const sk='fast'+(sp<40?'25-40':sp<60?'40-60':'60+')+'|'+pose;T.acts[sk]=(T.acts[sk]||0)+1;}
      }
     }
    }
    T.m++;
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const R={matches:T.m,samples:T.samples,cover:{}};
  for(const c of ['pinned','slow','fast','feet','loose']){
   const f=T.by[c+'|fwd']||0,u=T.by[c+'|up']||0,x=T.by[c+'|other']||0,s=f+u+x;
   R.cover[c]={samples:s,fwd:s?+(f/s).toFixed(2):null,up:s?+(u/s).toFixed(2):null,other:s?+(x/s).toFixed(2):null};
  }
  R.byHolder={};for(const k of Object.keys(T.hold)){const [pair,pose]=k.split('|');const q=R.byHolder[pair]||(R.byHolder[pair]={n:0,fwd:0});q.n+=T.hold[k];if(pose==='fwd')q.fwd+=T.hold[k];}for(const k in R.byHolder)R.byHolder[k]={samples:R.byHolder[k].n,fwd:+(R.byHolder[k].fwd/R.byHolder[k].n).toFixed(2)};   // the ball is in reach of the first role, the rod of the second is ahead: how often it stands forward
  R.notFwd=Object.fromEntries(Object.entries(T.acts).sort((a,b)=>b[1]-a[1]).slice(0,30));
  return R;
 }
 window.rdCover=rdCover;
})();
