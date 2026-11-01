// Lateral attack against the AI's keeper + DEF on the real sim (CONFIG.ai.cover.track / .slide). From a terminal:
//      node tools/page-run.js tools/latdef-soak.js "ldAll()"
//      ldScene({diff,v,z0,z1,path,fire,see,wait,seed,set,trace})   // red human: the ATT's middle man back-pins a ball (finesse + raise), carries it sideways and fires the pin shot
//          fire 'open' = the first moment (after `wait` s of carry) the lane its shot would take is clear of the blue men as it saw them `see` s ago; 'rand' = at a random point of the run; anything else = at the end of it
//      ldRandom({diff,n,segs,vr,wait,keep,set})   // a carry that changes speed and direction like a person hunting a gap (segments at vr u/s, pauses, doubling back), fired when open: goals of the shots on target, who touched it, the first `keep` goals
//      ldGrid({diff,vs,n,set})                    // a steady run across the mouth at each speed
//      ldCal({vs})                                // the pin shot's heading against the slide it is fired on, nobody in the way: what the bot's lane read (KT) is built from
//      ldWith(set,'tools/kickangle-soak.js','kaSoak({seeds:96,diff:"pro",maxMs:1e9})')   // any other soak with CONFIG paths overridden for it (whole-match A/Bs from one terminal call)
// set:{'ai.cover.track.on':false,'ai.cover.slide':1} = the old defence; the blue rods are the real AI (cfg.diffBlue), every other man is off the table
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',KICK_K='Space',RZ='ShiftLeft';
 // share of the slide the pin shot keeps sideways, by slide speed, over ~110 u/s forward (ldCal: it is not monotonic)
 const KT=[[0,0],[10,0.36],[20,0.69],[30,1.0],[45,0.57],[64,0.65],[90,0.65]];
 function shotSlope(v){const a=Math.abs(v);let i=1;while(i<KT.length-1&&KT[i][0]<a)i++;const [x0,y0]=KT[i-1],[x1,y1]=KT[i],f=y0+(y1-y0)*clamp((a-x0)/(x1-x0),0,1);return Math.sign(v)*f*a/110;}
 function press(code){keys[code]=true;bindPress(code);}
 function lift(code){keys[code]=false;bindRelease(code);}
 const gkOf=t=>rods.find(q=>q.team===t&&q.role==='GK'),dfOf=t=>rods.find(q=>q.team===t&&q.role==='DEF');
 const menOf=r=>{const a=[];for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))a.push({x:r.x,z:r.baseZ[i]+r.offset});return a;};
 // open width of the mouth from the ball: straight lines to the goal line no man's reach touches (cover-soak's openW)
 function openW(men,ox,oz,gx,m,st){let w=0;for(let z=-m;z<=m;z+=st){let hit=false;for(const q of men){const t=(q.x-ox)/(gx-ox);if(t<=0)continue;if(Math.abs(oz+(z-oz)*t-q.z)<AIC.gapAim.blockR){hit=true;break;}}if(!hit)w+=st;}return w;}
 // the shot from (bx,bz) on slope s: clear of every man (reach R) and inside the mouth
 function laneOpen(men,bx,bz,s,R){
  const gz=bz+s*(F.L/2-bx);if(Math.abs(gz)>F.goalHalf-BALL_R*0.6)return false;
  for(const q of men){const z=bz+s*(q.x-bx);if(Math.abs(z-q.z)<R)return false;}
  return true;
 }
 function setup(o){
  S.seedNext=o.seed;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  for(const k of Object.keys(keys))keys[k]=false;
  cfg.diffBlue=o.diff;
  const s=S.seats[0],r=rods[5],keep=[gkOf(1),dfOf(1)];
  const si=s.rods.indexOf(r);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=r.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.exert=0;q.cvM=0;});
  for(const q of rods){const on=q===r||(o.def&&keep.indexOf(q)>=0);for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=on?0:1e9;}
  return {s,r};
 }
 function step(ai){
  if(ai)aiUpdate(FIX);
  shotSeatsUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
  for(const q of S.balls)q.cur.copy(q.m.position);
 }
 function run(o){
  o=Object.assign({diff:'pro',seed:1,v:40,z0:-8,z1:8,fire:'open',see:0.15,settle:0.6,R:3.0,wait:0,def:true,T:1.2,trace:false,path:null},o||{});
  const {r}=setup(o),dir=r.kickDir,man=1,b=makeBall('classic'),g=gkOf(1),d=dfOf(1);
  const pz=r.baseZ[man]+clamp(o.z0-r.baseZ[man],-r.maxOff,r.maxOff),off0=clamp(pz-r.baseZ[man]+(o.z1>o.z0?5:-5),-r.maxOff,r.maxOff);   // the man starts beside the ball (a ball in his lane cannot be back-pinned)
  r.offset=r.target=off0;r.prevOffset=off0;r.pivot.position.z=off0;
  b.m.position.set(r.x-3.6*dir,BALL_R,pz);b.v.set(0,0,0);syncBall(b);b.cur.copy(b.m.position);
  rods.forEach(q=>{q.aiBX=b.m.position.x;q.aiBZ=b.m.position.z;});
  keys[FIN]=true;step(true);step(true);press(RZ);
  const ring=[],nSee=Math.max(1,Math.round(o.see*SIM.hz)),L=[];
  let st='pin',tP=null,tF=null,goal=false,blk=null,ow=null,vF=null,zF=null,at=null,pi=0,pt=0,cross=null;
  let sd=(o.seed*2654435761)>>>0;const tRand=((sd=(sd*1664525+1013904223)>>>0)/4294967296);
  const nMax=Math.round((o.settle+6+o.T)*SIM.hz);
  for(let i=0;i<nMax;i++){
   const t=i/SIM.hz;
   ring.push(o.def?menOf(g).concat(menOf(d)):[]);if(ring.length>nSee+1)ring.shift();
   if(st==='pin'&&!r.pinB&&Math.abs(r.angle)>0.8){const gz=clamp(pz-r.baseZ[man],-r.maxOff,r.maxOff);r.target+=clamp(gz-r.target,-12*FIX,12*FIX);}   // onto the ball once the leg is up, at a player's ease
   if(st==='pin'&&r.pinB){if(tP==null)tP=t;if(t-tP>=o.settle)st='carry';}
   if(st==='pin'&&t>2.5)return {pinned:false};
   // the hand: the target runs at v toward the end of the run (or along the path), and keeps going through the shot as in a pull shot
   if(st==='carry'||(st==='swing'&&(b.m.position.x-r.x)*dir<6&&t-tF<0.25)){
    let zt=o.z1,v=o.v;
    if(o.path){const p=o.path[Math.min(pi,o.path.length-1)];zt=p.z;v=p.v;if(p.wait!=null){pt+=FIX;if(pt>=p.wait){pi++;pt=0;}v=0;zt=b.m.position.z;}}
    const ot=clamp(zt-r.baseZ[man],-r.maxOff,r.maxOff);
    r.target+=clamp(ot-r.target,-v*FIX,v*FIX);
    if(o.path&&Math.abs(ot-r.target)<0.05&&o.path[pi]&&o.path[pi].wait==null)pi++;
   }
   if(st==='carry'){
    const bp=b.m.position,s=shotSlope(r.vz),end=o.path?pi>=o.path.length:Math.abs(clamp(o.z1-r.baseZ[man],-r.maxOff,r.maxOff)-r.offset)<0.05;
    let go=false;
    if(o.fire==='open')go=t-tP>=o.settle+Math.max(0.05,o.wait)&&laneOpen(ring[0],bp.x,bp.z,s,o.R);
    else if(o.fire==='rand')go=Math.abs(bp.z-o.z0)/Math.max(1e-3,Math.abs(o.z1-o.z0))>=tRand;
    if(end||t-tP>o.settle+Math.max(5,o.wait+3))go=true;
    if(go){
     vF=r.vz;zF=bp.z;
     if(o.def){ow=openW(menOf(g).concat(menOf(d)),bp.x,bp.z,F.L/2,F.goalHalf*0.9,0.25);at={gk:+(g.baseZ[0]+g.offset).toFixed(1),def:menOf(d).map(q=>+q.z.toFixed(1)),sees:[+(g.aiTZ||0).toFixed(1),+(d.aiTZ||0).toFixed(1)],iq:[g.aiIQ?1:0,d.aiIQ?1:0]};}
     press(KICK_K);lift(KICK_K);tF=t;st='swing';
    }
   }
   step(true);
   if(tF!=null){
    if(!blk&&S.lastTouch===1-r.team)blk=Math.abs(b.m.position.x-g.x)<Math.abs(b.m.position.x-d.x)?'GK':'DEF';
    const p=b.m.position;
    if(cross==null&&p.x*dir>=F.L/2-BALL_R)cross=+p.z.toFixed(2);
    if(o.trace&&L.length<200)L.push(`${(t-tF).toFixed(3)} ball ${p.x.toFixed(1)},${p.z.toFixed(1)} v ${b.v.x.toFixed(0)},${b.v.z.toFixed(0)} | gk ${(g.baseZ[0]+g.offset).toFixed(1)} def ${d.offset.toFixed(1)}`);
   }else if(o.trace&&st==='carry'&&i%6===0&&L.length<200)L.push(`${t.toFixed(2)} ball z ${b.m.position.z.toFixed(1)} vz ${r.vz.toFixed(0)} | gk ${(g.baseZ[0]+g.offset).toFixed(1)} sees ${g.aiBZ.toFixed(1)}/${g.aiTZ==null?'-':g.aiTZ.toFixed(1)} tgt ${g.target.toFixed(1)} | def men ${menOf(d).map(q=>q.z.toFixed(1)).join(',')} sees ${d.aiBZ.toFixed(1)}/${d.aiTZ==null?'-':d.aiTZ.toFixed(1)} tgt ${d.target.toFixed(1)} iq${d.aiIQ?1:0}${g.aiIQ?1:0}`);
   if(b.scored){goal=true;break;}
   if(S.phase!=='play')break;
   if(tF!=null&&t-tF>o.T)break;
  }
  lift(FIN);lift(RZ);lift(KICK_K);
  return {pinned:tP!=null,fired:tF!=null,goal,blk,at,open:ow,vF:vF==null?null:+vF.toFixed(1),zF:zF==null?null:+zF.toFixed(2),fireT:tF!=null?+(tF-tP-o.settle).toFixed(2):null,cross,L};
 }
 // CONFIG paths overridden for a run, restored after
 function cfgSet(set){const old=[];for(const k in set||{}){const ks=k.split('.'),last=ks.pop();let o=CONFIG;for(const q of ks)o=o[q];old.push([o,last,o[last]]);o[last]=set[k];}return ()=>{for(let i=old.length-1;i>=0;i--){const [o,k,v]=old[i];o[k]=v;}};}
 function scene(o){const a0=cfg.auto,d0=cfg.diffBlue,un=cfgSet(o&&o.set);cfg.auto=false;try{return run(o);}finally{cfg.auto=a0;cfg.diffBlue=d0;un();}}
 // rate = goals of the shots that would have been on target (a miss of the frame is the bot's, not the defence's)
 function tally(list){
  const T={n:0,onT:0,goal:0,by:{},open:0,fireT:0};
  for(const a of list){if(!a.fired)continue;T.n++;if(a.goal)T.goal++;const k=a.goal?'goal':(a.blk||'miss');if(k!=='miss')T.onT++;T.by[k]=(T.by[k]||0)+1;T.open+=a.open||0;T.fireT+=a.fireT||0;}
  T.rate=+(T.goal/Math.max(1,T.onT)).toFixed(2);T.open=+(T.open/Math.max(1,T.n)).toFixed(1);T.fireT=+(T.fireT/Math.max(1,T.n)).toFixed(2);
  return T;
 }
 function ldGrid(o){
  o=Object.assign({diff:'pro',vs:[0,15,30,45,64],fire:'open',n:6,see:0.15,span:8},o||{});
  const out={};
  for(const v of o.vs){const L=[];
   for(let k=0;k<o.n;k++){const w=k%2?1:-1;L.push(scene({diff:o.diff,v,z0:-w*o.span,z1:w*o.span,fire:o.fire,see:o.see,seed:1+k,set:o.set}));}
   out['v '+v]=tally(L);
  }
  return out;
 }
 // a person hunting a gap: runs to random spots at random speeds, stops, doubles back; wait = [min,max] s of carry before it may fire, drawn per run
 function ldRandom(o){
  o=Object.assign({diff:'pro',n:300,seed:7,see:0.15,vr:[20,64],span:9,segs:10,pause:0.3,wait:[0.2,2],R:3.0,keep:0},o||{});
  let sd=o.seed;const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const L=[];
  for(let k=0;k<o.n;k++){
   const path=[],z0=U(-o.span,o.span);
   for(let j=0;j<o.segs;j++){if(rnd()<o.pause)path.push({wait:U(0.1,0.4)});path.push({z:U(-o.span,o.span),v:U(o.vr[0],o.vr[1])});}
   L.push(scene({diff:o.diff,z0,z1:0,path,fire:'open',see:o.see,seed:1+k,set:o.set,wait:U(o.wait[0],o.wait[1]),R:o.R}));
  }
  const T=tally(L);if(o.keep)T.goals=L.filter(a=>a.goal).slice(0,o.keep).map(a=>({blk:a.blk,zF:a.zF,vF:a.vF,cross:a.cross,fireT:a.fireT,at:a.at}));
  return T;
 }
 function ldCal(o){
  o=Object.assign({vs:[-60,-40,-20,0,20,40,60]},o||{});
  const out={};
  for(const v of o.vs){const a=scene({def:false,v:Math.abs(v),z0:v>0?-8:8,z1:v>0?8:-8,fire:'rand',seed:3});out['slide '+v]={vF:a.vF,zF:a.zF,cross:a.cross,model:a.vF!=null?+(a.zF+shotSlope(a.vF)*(F.L/2-(rods[5].x-3.6))).toFixed(2):null};}
  return out;
 }
 async function ldWith(set,file,expr){(0,eval)(await (await fetch(file)).text());const un=cfgSet(set);try{return await (0,eval)(expr);}finally{un();}}
 // every difficulty, the old defence against the shipped one, a mixed carry and a fast one
 function ldAll(o){
  o=Object.assign({n:300},o||{});const old={'ai.cover.track.on':false,'ai.cover.slide':1},out={};
  for(const diff of ['rookie','pro','legend'])out[diff]={mixed:[ldRandom({diff,n:o.n,set:old}).rate,ldRandom({diff,n:o.n}).rate],fast:[ldRandom({diff,n:o.n,vr:[45,64],pause:0.1,set:old}).rate,ldRandom({diff,n:o.n,vr:[45,64],pause:0.1}).rate]};
  return out;
 }
 window.ldScene=scene;window.ldGrid=ldGrid;window.ldRandom=ldRandom;window.ldCal=ldCal;window.ldAll=ldAll;window.ldWith=ldWith;
})();
