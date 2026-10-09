// Play soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/play-soak.js').then(r=>r.text()).then(eval)
//      playSoak({seeds:24,secs:120,diff:'pro'})                       // N simulated AI-vs-AI matches: what the AI does with the ball
//      playTry('carry off',()=>{AIC.catch.carryFirst=false;},{diff:'pro'})   // the same with CONFIG overridden by the function, restored after
// why: 'does the AI keep the ball and play it, or kick it' is a whole-match question; this drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups)
// per match: swings by kind (plain kick / pass / pin shot), plain kicks by role and by why the rod had no control move (the iq roll off, a catch that ended first, the ball at rest / sideways / leaving),
//   every pin play by role and reason (open shot, open pass, push, pass, late), how long a pin is held, goals, whistles; one call of the preview JS tool is capped at 45 s, so ~60 matches per call
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__pf0)window.__pf0=pinFire;
 if(!window.__kr0)window.__kr0=kickRod;
 if(!window.__ce0)window.__ce0=catchEnd;
 let T=null;
 const inc=(o,k,n)=>{o[k]=(o[k]||0)+(n||1);};
 window.pinFire=function(r,best,D,v){const f=__pf0.apply(this,arguments);if(T&&f>0)inc(T.fire,r.role+' '+(v===2?'pass':'shot')+' '+(r.pcWhy||'?'));return f;};
 window.catchEnd=function(r,cd,why){r.__ceT=S.time;r.__ceWhy=why;return __ce0.apply(this,arguments);};
 window.kickRod=function(r,style,aim,curve){
  if(T&&r.kickT<0&&!isUserRod(r)){
   const k=style==='trapShot'?'pin':style==='pass'?'pass':'plain';
   inc(T.n,k);
   if(k==='plain'){
    inc(T.plainRole,r.role);
    const b=S.balls[0],v=b.v,vf=v.x*r.kickDir,sp=Math.hypot(v.x,v.z);
    inc(T.why,!r.aiIQ?'1 iq roll off':(r.__ceT!=null&&S.time-r.__ceT<0.6)?'2 a catch ended first':sp<5?'3 ball at rest':-vf>=2?'4 closing, no catch':Math.abs(vf)<2?'5 sideways':'6 leaving');
   }
  }
  return __kr0.apply(this,arguments);
 };
 function playSoak(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:null},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  T={n:{},fire:{},plainRole:{},why:{},m:0,goals:0,whistles:0,holds:[]};
  for(const k in CAS)CAS[k]=0;
  for(const k in CAW)delete CAW[k];
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.__ph=null;r.__pt=0;r.__ceT=null;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const b of S.balls)b.cur.copy(b.m.position);
     for(const r of rods){if(r.pinB)r.__pt=(r.__pt||0)+FIX;else if(r.__pt){T.holds.push(r.__pt);r.__pt=0;}}
    }
    T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const M=T.m,pm=(x)=>+(x/M).toFixed(1),PM=(O)=>{const r={};for(const k of Object.keys(O).sort())r[k]=pm(O[k]);return r;};
  const hs=T.holds.slice().sort((a,b)=>a-b),q=(p)=>hs.length?+hs[Math.min(hs.length-1,Math.floor(p*hs.length))].toFixed(2):null;
  const C={};for(const k in CAS)if(CAS[k])C[k]=pm(CAS[k]);
  const E={};for(const k in CAW)if(/^(fetch|knocked|lifted|stopped|away|slow|past|time)/.test(k))E[k]=pm(CAW[k]);
  return {diff:o.diff||cfg.diffRed,matches:M,wallS:+((performance.now()-t0)/1000).toFixed(1),goals:pm(T.goals),whistles:pm(T.whistles),swings:PM(T.n),plainByRole:PM(T.plainRole),plainWhy:PM(T.why),pinPlays:PM(T.fire),holdS:{n:hs.length,p50:q(.5),p90:q(.9)},cas:C,ends:E};
 }
 function restore(dst,src){for(const k in src){if(src[k]&&typeof src[k]==='object'&&dst[k]&&typeof dst[k]==='object')restore(dst[k],src[k]);else dst[k]=src[k];}for(const k in dst)if(!(k in src))delete dst[k];}
 function playTry(tag,ov,o){
  const keep=structuredClone(AIC);ov();
  try{const r=playSoak(o);r.tag=tag;return r;}
  finally{restore(AIC,keep);}
 }
 window.playSoak=playSoak;window.playTry=playTry;
})();
