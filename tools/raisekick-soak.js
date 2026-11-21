// Raised-leg kick soak: how often an AI swing starts from a raised leg (r.raise on, or the leg back past rest) and what kinds of kick they are, with ai.raiseBack on vs off.
//      node tools/page-run.js tools/raisekick-soak.js "raiseKickSoak({seeds:24,secs:120,diff:'pro'})"
// both arms run on the same seeds. raised = the leg's rod-local angle at the swing's start is past half of KICK.raiseA (lifted -1.3, rest 0); flag = r.raise at that moment
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__rk_kr0)window.__rk_kr0=kickRod;
 let T=null;
 window.kickRod=function(r,style,aim,curve){
  if(T&&r.kickT<0&&!isUserRod(r)){
   const kind=!style?(r.act==='dribble'?'dribble':'plain'):style==='pass'?(r.pinB?'pinPass':'kickPass'):style==='trapShot'?(r.pinB?'pinShot':'trapShot'):style;
   const a0=r.angle/(r.kickDir||1);
   T.all.push({kind,flag:!!r.raise,raised:a0<KICK.raiseA*0.5,a0,role:r.role});
  }
  return __rk_kr0.apply(this,arguments);
 };
 function run(o){
  T={all:[],m:0,goals:0};
  const keep=[cfg.diffRed,cfg.diffBlue];
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  const rb0=CONFIG.ai.raiseBack;CONFIG.ai.raiseBack=o.raiseBack;
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);
     updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
    }
    T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{CONFIG.ai.raiseBack=rb0;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const A=T.all,m=Math.max(1,T.m),pm=x=>+(x/m).toFixed(2),R={raiseBack:o.raiseBack,matches:T.m,goals:pm(T.goals),wallS:+((performance.now()-t0)/1000).toFixed(1),kicks:pm(A.length),raised:pm(A.filter(k=>k.raised).length),flag:pm(A.filter(k=>k.flag).length),byKind:{}};
  for(const kd of [...new Set(A.map(k=>k.kind))]){const L=A.filter(k=>k.kind===kd);R.byKind[kd]={perMatch:pm(L.length),raised:pm(L.filter(k=>k.raised).length),raisedShare:+(L.filter(k=>k.raised).length/L.length).toFixed(2)};}
  return R;
 }
 window.raiseKickSoak=function(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,diff:null},o||{});
  return {on:run(Object.assign({},o,{raiseBack:true})),off:run(Object.assign({},o,{raiseBack:false}))};
 };
})();
