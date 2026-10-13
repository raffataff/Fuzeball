// Pin gap soak. Browser side, from a terminal:
//      node tools/page-run.js tools/pingap-soak.js "gapSoak({seeds:12,secs:120,diff:'pro'})"
//      node tools/page-run.js tools/pingap-soak.js "gapScene({ang:-0.75,rel:-0.7,vx:-8})"
// gapSoak: whole AI-vs-AI matches; for every ball a rod pins, where it is held in the leg's own frame (dp = distance off the leg axis in the swing plane, + the
//   front of the leg, - the back; s = how far down the leg), against where the drawn figurine's surface is (`drawn`, the median of the 21 shipped figurines read off
//   their vertices: legtouch scratch, 2026-10-13), as the catch lands and 0.4 s later. gap = |dp| - drawn: what the player sees between the ball and the leg.
// gapScene: one ball rolled at a posed rod, the same numbers plus the exit speed of the pin shot fired 0.5 s after.
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 // ball centre to the leg axis (swing plane) where a ball just touches the drawn figure: front by s down the leg, rear flat (median of 21 figurines)
 const FR=[[3.5,2.75],[4.1,2.67],[4.6,2.67],[5.1,2.8],[5.6,3.1],[6.1,3.23],[6.5,3.3]];
 function drawnFront(s){
  if(s<=FR[0][0])return FR[0][1];
  for(let i=1;i<FR.length;i++)if(s<=FR[i][0]){const a=FR[i-1],b=FR[i],k=(s-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*k;}
  return FR[FR.length-1][1];
 }
 const drawn=(dp,s)=>dp>=0?drawnFront(s):2.3;
 function geo(r,b){
  const p=b.m.position,dir=r.kickDir,sa=Math.sin(r.angle),ca=Math.cos(r.angle),wx=p.x-r.x,wy=p.y-ROD_H;
  const dp=(wx*ca+wy*sa)*dir,s=wx*sa-wy*ca;
  return {dp,s,rel:wx*dir,ang:r.angle*dir,gap:Math.abs(dp)-drawn(dp,s),nz:p.z-(r.baseZ[b.pinMan]+r.offset)};
 }
 const q=(a,k)=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.floor(s.length*k))].toFixed(2);};
 const sum=(a)=>({n:a.length,p10:q(a,0.1),med:q(a,0.5),p90:q(a,0.9),mean:a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):null});
 function gapSoak(o){
  o=Object.assign({seeds:8,secs:120,seed0:1,diff:null,late:0.4},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  const out={},put=(k,f)=>{const c=out[k]||(out[k]={gap:[],gapLate:[],dp:[],dpLate:[],rel:[],relLate:[],s:[],v:[]});c.gap.push(f.gap);c.dp.push(f.dp);c.rel.push(f.rel);c.s.push(f.s);return c;};
  const held=new Map();let catches=0,shots=0;
  const wh=Au.whistle;Au.whistle=function(){};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    held.clear();
    const n=Math.round(o.secs*SIM.hz);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const b of S.balls)b.cur.copy(b.m.position);
     for(const r of rods){
      const b=r.pinB,h=held.get(r);
      if(b&&(!h||h.b!==b)){
       const f=geo(r,b),k=(r.pinFwd?'fwd':(f.dp>=0?'backFront':'backRear'))+' '+r.role;
       held.set(r,{b,t:S.time,k,f});catches++;
       const c=put(k,f);c.v.push(Math.hypot(b.v.x,b.v.z));
       put('ALL '+(r.pinFwd?'fwd':(f.dp>=0?'front':'rear')),f);
      }else if(b&&h&&!h.late&&S.time-h.t>=o.late){
       h.late=true;const f=geo(r,b);
       const c=out[h.k];if(c){c.gapLate.push(f.gap);c.dpLate.push(f.dp);c.relLate.push(f.rel);}
       const c2=out['ALL '+h.k.split(' ')[0].replace('backFront','front').replace('backRear','rear')];if(c2){c2.gapLate.push(f.gap);c2.dpLate.push(f.dp);c2.relLate.push(f.rel);}
      }else if(!b&&h)held.delete(r);
     }
    }
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const res={};
  for(const k of Object.keys(out).sort()){const c=out[k];res[k]={catches:c.gap.length,gap:sum(c.gap),gapLate:sum(c.gapLate),dp:sum(c.dp),dpLate:sum(c.dpLate),rel:sum(c.rel),relLate:sum(c.relLate),s:sum(c.s)};}
  return {matches:o.seeds,secs:o.secs,diff:o.diff||cfg.diffRed,wallS:+((performance.now()-t0)/1000).toFixed(1),catches,res};
 }
 window.gapSoak=gapSoak;
})();
