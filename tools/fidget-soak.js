// Off-ball fidget soak: how much the AI rods slide while the ball is away from them.
//      node tools/page-run.js tools/fidget-soak.js "fgSoak({seeds:12,secs:120,diff:'pro'})"
//      fgSoak({...,set:{'ai.far.on':false}})     // any CONFIG key overridden for the run (dotted path), restored after
// per role and band (ball x from the rod, dir-relative: play |rel|<12, near 12..30, far >30 ahead / behind): mean slide speed (u/s), share of time moving (>3 u/s), direction reversals a second, travel a minute
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const band=rel=>Math.abs(rel)<12?'play':Math.abs(rel)<30?'near':rel>0?'farAhead':'farBehind';
 function setKeys(set){
  const old=[];
  for(const k in set||{}){const p=k.split('.');let o=CONFIG;for(let i=0;i<p.length-1;i++)o=o[p[i]];old.push([o,p[p.length-1],o[p[p.length-1]]]);o[p[p.length-1]]=set[k];}
  return ()=>{for(const [o,k,v] of old.reverse())o[k]=v;};
 }
 function fgSoak(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:'pro',set:null},o||{});
  const undo=setKeys(o.set),kd=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  const T={},G={matches:0,goals:0,whistles:0,shots:0};
  const cell=(role,b)=>{const k=role+':'+b;return T[k]||(T[k]={n:0,v:0,mv:0,rev:0,trav:0,act:{}});};
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;
    S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.cvM=0;r.fgV=0;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1],rd0=S.stats&&S.stats.redrops||0;
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     const b=S.balls[0];if(!b)break;
     for(const q of S.balls)q.prev.copy(q.m.position);
     const off=rods.map(r=>r.offset);
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(S.phase!=='play')continue;
     const bx=b.m.position.x;
     rods.forEach((r,j)=>{
      const v=(r.offset-off[j])/FIX,dir=r.team===0?1:-1,c=cell(r.role,band((bx-r.x)*dir));
      c.n++;c.v+=Math.abs(v);c.trav+=Math.abs(v)*FIX;
      if(Math.abs(v)>3){const a=(r.act||(r.cvOn?'cover':'-'))+(r.kickT>=0?'+kick':'');c.act[a]=(c.act[a]||0)+1;}
      if(Math.abs(v)>3){c.mv++;if(r.fgV&&Math.sign(v)!==r.fgV)c.rev++;r.fgV=Math.sign(v);}
     });
    }
    G.goals+=S.score[0]+S.score[1]-sc0;G.matches++;
   }
  }finally{undo();cfg.diffRed=kd[0];cfg.diffBlue=kd[1];}
  const out={diff:o.diff,matches:G.matches,goalsPerMatch:+(G.goals/G.matches).toFixed(2),cells:{}};
  for(const k of Object.keys(T).sort()){const c=T[k],s=c.n*FIX;
   const act={};for(const a in c.act)act[a]=+(c.act[a]/Math.max(1,c.mv)).toFixed(2);   // share of the moving steps by AI action (- = plain alignment)
   out.cells[k]={secs:+s.toFixed(0),v:+(c.v/c.n).toFixed(1),moving:+(c.mv/c.n).toFixed(2),revPerS:+(c.rev/s).toFixed(2),travPerMin:+(c.trav/s*60).toFixed(0),act};}
  return out;
 }
 window.fgSoak=fgSoak;
})();
