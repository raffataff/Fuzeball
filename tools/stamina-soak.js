// Stamina soak: how much swinging tires the AI rods over whole AI-vs-AI matches.
//      node tools/page-run.js tools/stamina-soak.js "stSoak({seeds:12,secs:240,diff:'pro'})"
//      stSoak({...,set:{'stats.kickFat.full':12}})     // any CONFIG key overridden for the run (dotted path), restored after
// per role: swings a minute (kickRod calls, by style), the exertion channel (stExert 0..1: mean, p90, peak) and the slow-down (1-stFat) by minute, with the share the swinging carries
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setKeys(set){
  const old=[];
  for(const k in set||{}){const p=k.split('.');let o=CONFIG;for(let i=0;i<p.length-1;i++)o=o[p[i]];old.push([o,p[p.length-1],o[p[p.length-1]]]);o[p[p.length-1]]=set[k];}
  return ()=>{for(const [o,k,v] of old.reverse())o[k]=v;};
 }
 const pct=(a,q)=>{if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
 function stSoak(o){
  o=Object.assign({seeds:12,secs:240,seed0:1,diff:'pro',set:null},o||{});
  const undo=setKeys(o.set),kd=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  const kr=kickRod,R={},G={matches:0,goals:0};
  const cell=role=>R[role]||(R[role]={rods:0,secs:0,sw:0,style:{},ex:[],exPk:0,fat:[],fatEx:[]});
  let cur=null;
  window.kickRod=function(r,style){if(cur&&r.kickT<0){const c=cell(r.role);c.sw++;const k=style||'kick';c.style[k]=(c.style[k]||0)+1;}return kr.apply(this,arguments);};
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;
    S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.exert=0;cell(r.role).rods++;});cur=1;
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1],mins=Math.ceil(o.secs/60);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     for(const q of S.balls)q.prev.copy(q.m.position);
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(S.phase!=='play')continue;
     S.matchTime+=FIX;
     const m=Math.min(mins-1,Math.floor(S.matchTime/60)),sample=i%SIM.hz===0;
     rods.forEach(r=>{const c=cell(r.role);c.secs+=FIX;
      if(!sample)return;
      const e=stExert(r),w=STC.kickFat.on?clamp(STC.kickFat.weight,0,1):0;
      c.ex.push(e);if(e>c.exPk)c.exPk=e;
      (c.fat[m]||(c.fat[m]=[])).push(1-stFat(r));(c.fatEx[m]||(c.fatEx[m]=[])).push(STC.fatMax*e*w);
     });
    }
    cur=null;G.goals+=S.score[0]+S.score[1]-sc0;G.matches++;
   }
  }finally{window.kickRod=kr;undo();cfg.diffRed=kd[0];cfg.diffBlue=kd[1];}
  const f3=x=>+x.toFixed(3),avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
  const out={diff:o.diff,matches:G.matches,goalsPerMatch:+(G.goals/G.matches).toFixed(2),kickFat:Object.assign({},STC.kickFat),roles:{}};
  for(const k of ['GK','DEF','MID','ATT']){const c=R[k];if(!c)continue;
   out.roles[k]={swingsPerRodMin:+(c.sw/(c.secs/60)).toFixed(2),style:c.style,exert:{mean:f3(avg(c.ex)),p90:f3(pct(c.ex,.9)),peak:f3(c.exPk)},
    slowByMin:c.fat.map(a=>f3(avg(a))),fromSwingsByMin:c.fatEx.map(a=>f3(avg(a)))};}
  return out;
 }
 window.stSoak=stSoak;
})();
