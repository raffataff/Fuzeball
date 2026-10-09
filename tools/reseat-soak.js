// Re-seat soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/reseat-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      rsSoak({seeds:24,secs:120,diff:'legend'})   // AI-vs-AI matches: what happens after a ball pinned under a forward leg is let go to be re-pinned from behind
// why: a swing play from the receiving pose lets the ball go and retrieve pins it again (reseat, ai.js); this says how long that takes and how it ends
// per re-seat: the first of swing (the rod fired: shot / pass / plain, after t s), lost (the other team touched the ball first), timeout (6 s, nothing), gone (the whistle / a goal)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__rs_reseat)window.__rs_reseat=reseat;
 function rsSoak(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,diff:null,maxT:6},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=cfg.diffBlue=o.diff;}
  const tr=[],out=[],T={m:0,reseats:0};
  window.reseat=function(r){tr.push({r:r,t0:S.time,team:r.team,why:r.pcWhy||'?'});T.reseats++;return __rs_reseat.apply(this,arguments);};
  const wh=Au.whistle;Au.whistle=function(){};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    tr.length=0;
    const n=Math.round(o.secs*SIM.hz);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){for(const t of tr)out.push({how:'gone',t:S.time-t.t0,why:t.why});tr.length=0;S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(let k=tr.length-1;k>=0;k--){
      const t=tr[k],d=S.time-t.t0;let how=null;
      if(t.r.kickT>=0&&d>0.05)how='swing:'+(t.r.kickStyle||'plain');
      else if(S.lastTouch>=0&&S.lastTouch!==t.team)how='lost';
      else if(d>o.maxT)how='timeout';
      if(how){out.push({how,t:d,why:t.why,ph:t.r.retPh||'-'});tr.splice(k,1);}
     }
    }
    for(const t of tr)out.push({how:'gone',t:S.time-t.t0,why:t.why});
    T.m++;
   }
  }finally{window.reseat=__rs_reseat;Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const R={matches:T.m,reseatsPerMatch:+(T.reseats/Math.max(1,T.m)).toFixed(2),how:{},why:{}};
  const q=(a,p)=>{if(!a.length)return null;a.sort((x,y)=>x-y);return +a[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(2);};
  for(const x of out){const b=R.how[x.how.split(':')[0]]=R.how[x.how.split(':')[0]]||{n:0,t:[]};b.n++;b.t.push(x.t);const w=R.why[x.why]=(R.why[x.why]||0)+1;}
  for(const k in R.how){const b=R.how[k];R.how[k]={n:b.n,median:q(b.t.slice(),0.5),p90:q(b.t.slice(),0.9)};}
  R.swings=Object.fromEntries(Object.entries(out.filter(x=>x.how.startsWith('swing')).reduce((a,x)=>{a[x.how]=(a[x.how]||0)+1;return a;},{})));
  window.__rs_last=out;
  return R;
 }
 // the first `keep` re-seats that end in a swing, step by step: t, action / phase, angle, offset, target, pinned, ball rel and z gap to the nearest man, ball speed, K:<style> on the swing
 function rsTrace(o){
  o=Object.assign({seeds:24,secs:120,seed0:201,diff:'legend',keep:4,after:0.4,max:6},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],tr=[],D=[];if(o.diff){cfg.diffRed=cfg.diffBlue=o.diff;}
  window.reseat=function(r){tr.push({r:r,t0:S.time,why:r.pcWhy,log:[]});return __rs_reseat.apply(this,arguments);};
  const wh=Au.whistle;Au.whistle=function(){};
  try{
   for(let si=0;si<o.seeds&&D.length<o.keep;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});tr.length=0;
    for(let i=0;i<Math.round(o.secs*SIM.hz)&&D.length<o.keep;i++){
     if(S.phase!=='play'){tr.length=0;S.phase='count';serve();}
     const b=S.balls[0];if(!b)break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(let k=tr.length-1;k>=0;k--){
      const t=tr[k],r=t.r,d=S.time-t.t0,dir=r.kickDir;
      if(i%12===0||(r.kickT>=0&&!t.sw)){
       const nz=r.baseZ.reduce((a,z)=>Math.abs(z+r.offset-b.m.position.z)<Math.abs(a-b.m.position.z)?z+r.offset:a,1e9);
       t.log.push([+d.toFixed(2),(r.act||'-')+(r.retPh?'/'+r.retPh:'')+(r.catPh?'/'+r.catPh:''),+(r.angle*dir).toFixed(2),+r.offset.toFixed(1),+r.target.toFixed(1),r.pinB?1:0,+((b.m.position.x-r.x)*dir).toFixed(1),+(b.m.position.z-nz).toFixed(1),+b.v.length().toFixed(1),r.kickT>=0?'K:'+(r.kickStyle||'plain'):'']);
      }
      if(r.kickT>=0&&!t.sw){t.sw=true;t.end=d;}
      if((t.sw&&d>t.end+o.after)||d>o.max){if(t.sw)D.push(t);tr.splice(k,1);}
     }
    }
   }
  }finally{window.reseat=__rs_reseat;Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  return D;
 }
 window.rsSoak=rsSoak;window.rsTrace=rsTrace;
})();
