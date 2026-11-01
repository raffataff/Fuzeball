// Push / pull soak: the AI's shot from a back pin with the slide (CONFIG.ai.catch.push), on the real sim. From a terminal:
//      node tools/page-run.js tools/pushpull-soak.js "ppAll()"
//      ppScene({ri:5,man:1,dz:0,off:0,diff:'pro',seed:1,keep:[7,6],tt:false,trace:false})   // a ball back-pinned under a red AI rod, the blue keeper + DEF (keep) covering; the rod plays it after `settle` s
//      ppSlide({vs,assist})    // the push forced at each slide speed, no defence: the heading it leaves on against the one the AI judged (push.k / drift)
//      ppVsAI({diff,set,tt})   // every man x start offset x dz x seed against the AI keeper + DEF: shots, how each was fired, goals, keeper / DEF touches; set = CONFIG.ai.catch overrides for the run
//                              // a scene plays the same whatever the seed (the first draw decides push.play.use for all of them): force use to 1 to judge the pull itself
//      ppForce({s,v,d,fake})   // one committed play scripted on the rod (sell, burst at v, fire d past the turn, no lane check); ppGrid / ppRows run a grid of them (ppRows: one csv row a play, for what predicts a goal)
// every rod's aiErrT is pinned (else aiUpdate re-rolls its iq); men not on the shooting rod or in `keep` are removed; tt:false switches the tic-tac off so the hold is a shot
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const step=()=>{aiUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);};
 const bare=()=>{updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);};
 // a.b.c paths under CONFIG.ai.catch set for the run, put back after
 function withSet(set,fn){
  const prev=[];
  for(const k of Object.keys(set||{})){const p=k.split('.');let o=AIC.catch;for(let i=0;i<p.length-1;i++)o=o[p[i]];prev.push([o,p[p.length-1],o[p[p.length-1]]]);o[p[p.length-1]]=set[k];}
  try{return fn();}finally{for(let i=prev.length-1;i>=0;i--)prev[i][0][prev[i][1]]=prev[i][2];}
 }
 function ppScene(o){
  o=Object.assign({ri:5,man:1,dz:0,off:0,rel:-3.6,diff:'pro',seed:1,keep:[7,6],tt:false,settle:0.8,T:3.6,mode:'ai',slide:0,assist:true,trace:false,every:0.02},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue],aa=window.aimAssist,TT=AIC.catch.tictac,tt0=TT.on,W0=Object.assign({},CAW);
  cfg.diffRed=cfg.diffBlue=o.diff;TT.on=o.tt;
  if(!o.assist)window.aimAssist=function(){};
  try{return run(o);}finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];window.aimAssist=aa;TT.on=tt0;for(const k in CAW)if(!(k in W0))delete CAW[k];else CAW[k]=W0[k];}
 }
 function run(o){
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  const r=rods[o.ri],dir=r.kickDir,keep=o.keep.map(i=>rods[i]);
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;q.aiIQ=true;q.exert=0;q.rvUntil=0;q.rvReady=false;q.aiTZ=null;});
  for(const q of rods){const on=q===r||keep.indexOf(q)>=0;for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=on?0:1e9;}
  const off0=clamp(o.off,-r.maxOff,r.maxOff);
  r.offset=r.target=r.prevOffset=r.pivot.position.z=off0;
  const fa=footAngle(o.rel,false),pa=(fa==null?SHOT.pin.angle:fa)*dir;
  r.angle=r.prevAngle=pa;r.pivot.rotation.z=r.angle;
  const b=makeBall('classic');
  b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[o.man]+off0+o.dz);b.v.set(0,0,0);syncBall(b);
  for(let i=0;i<SIM.hz&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinA=pa;r.aiMan=o.man;bare();}
  if(!r.pinB)return {out:'nopin',fa};
  r.act='catch';r.catPh='hold';r.tapN=0;r.catCd=0;pinPlayStart(r);
  // the cover settles on the held ball before the rod may play it
  for(let i=0;i<Math.round(o.settle*SIM.hz);i++){r.catT=-9;step();if(!r.pinB||r.act!=='catch')return {out:'lost in settle'};}
  r.catT=0;pinPlayStart(r);
  const z0=b.m.position.z,W0=Object.assign({},CAW);
  if(o.mode==='fire'){   // the push forced: the rod slides at `slide` for 0.3 s, then fires
   const ns=Math.round(0.3*SIM.hz);for(let i=0;i<ns;i++){r.catT=-9;r.target=clamp(r.offset+o.slide*FIX,-r.maxOff,r.maxOff);aiStepHold(r);}
   const sv=r.slideV,sl=pushSlope(r,sv);r.catSv=sv;r.catSl=sl;r.pcWhy='scene';
   pinFire(r,b,DIFFS[teamDiff(r.team)],1);catchEnd(r,AIC.catch.cd,'scene');
  }
  const L=[],gx=dir*F.L/2;let nt=0,fire=null,tHit=null,hd=null,cross=null,crossD=null,blk=null,gkT=false,dfT=false,tz=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   const t=i/SIM.hz,pk=r.kickT>=0;
   if(o.mode==='fire'&&!fire){fire={t:0,style:r.kickStyle,sv:+r.slideV.toFixed(1),z:+b.m.position.z.toFixed(2),why:'scene'};tz=r.catAim&&r.catAim.best?+r.catAim.best.tz.toFixed(2):null;}
   step();
   const p=b.m.position;
   if(!fire&&!pk&&r.kickT>=0){fire={t:+t.toFixed(2),style:r.kickStyle||'plain',sv:+r.slideV.toFixed(1),z:+p.z.toFixed(2),dz:+(p.z-z0).toFixed(2),why:r.pcWhy||null};tz=r.catAim&&r.catAim.best?+r.catAim.best.tz.toFixed(2):null;}
   if(fire&&tHit==null&&r.kickHit)tHit=t;
   if(tHit!=null&&hd==null&&t-tHit>=0.04)hd=+(Math.atan2(b.v.z,b.v.x*dir)*57.3).toFixed(1);
   if(fire&&!blk&&b.msc&&b.msc.team!==r.team){blk=b.msc.role;if(blk==='GK')gkT=true;else dfT=true;}
   if(cross==null&&tHit!=null&&p.x*dir>=Math.abs(rods[7].x))cross=+p.z.toFixed(2);   // where it passes the keeper's rod
   if(crossD==null&&tHit!=null&&p.x*dir>=Math.abs(rods[6].x))crossD=+p.z.toFixed(2);   // ...and the DEF's
   if(o.trace&&t>=nt){nt+=o.every;const g=rods[7],d=rods[6];L.push(`${t.toFixed(2)} ${r.act||'-'}/${r.catPh||'-'}${r.puPh?'/'+r.puPh:''} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} pin=${r.pinB?1:0}${r.kickT>=0?' K':''} | z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(0)},${b.v.z.toFixed(0)} | GK ${(g.baseZ[0]+g.offset).toFixed(1)} v${g.slideV.toFixed(0)} DEF ${(d.baseZ[0]+d.offset).toFixed(1)},${(d.baseZ[1]+d.offset).toFixed(1)} v${d.slideV.toFixed(0)}`);}
   if(b.scored||S.phase!=='play')break;
   if(fire&&t-fire.t>1.5)break;
  }
  const W={};for(const k in CAW)if((CAW[k]||0)>(W0[k]||0))W[k]=CAW[k]-(W0[k]||0);
  return {fire,hit:tHit!=null,hd,tz,cross,crossD,goal:!!b.scored,blk,gk:gkT,def:dfT,ends:W,L};
 }
 // one held step with no decision from the rod (ppScene's forced slide): aiUpdate with the rod's clock held back
 function aiStepHold(r){const t=r.target;r.catT=-9;aiUpdate(FIX);r.target=t;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
 // the heading a forced push leaves on at each slide, no defence, aim assist off by default
 function ppSlide(o){
  o=Object.assign({ri:5,man:1,vs:[-48,-39,-30,-20,-12,0,12,20,30,39,48],assist:false,diff:'legend',seeds:[1,2,3],carry:1},o||{});   // carry: shots.pin.carry for the run (a pinned rod slides at most this x its top speed)
  const rows={},P=AIC.catch.push,c0=SHOT.pin.carry;SHOT.pin.carry=o.carry;
  try{for(const v of o.vs){
   const h=[],c=[],cd=[],s=[],r=rods[o.ri],bx=r.x-3.6*r.kickDir,xD=Math.abs(rods[6].x-bx),xK=Math.abs(rods[7].x-bx);
   for(const seed of o.seeds){const a=ppScene({ri:o.ri,man:o.man,off:v?-Math.sign(v)*Math.min(7,Math.abs(v)*0.2):0,keep:[],mode:'fire',slide:v,assist:o.assist,diff:o.diff,seed,settle:0.1,T:1.2});if(a.out||!a.fire)continue;if(a.hd!=null)h.push(a.hd);if(a.cross!=null)c.push(a.cross-a.fire.z);if(a.crossD!=null)cd.push(a.crossD-a.fire.z);s.push(a.fire.sv);}
   const m=a=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):null,sv=m(s),zK=m(c),zD=m(cd);
   const sl=zK!=null&&zD!=null?(zK-zD)/(xK-xD):null,dr=sl!=null&&sv?(zD-sl*xD)/sv:null;   // the line through both crossings: its slope, and how far it starts off the ball (s of slide)
   rows['slide '+v]=`sv ${sv} leaves ${m(h)} deg | DEF line ${zD} keeper line ${zK} | slope/sv ${sl!=null&&sv?(sl/sv).toFixed(5):'-'} drift ${dr!=null?dr.toFixed(3):'-'} (config k ${P.k} drift ${P.drift}) n ${h.length}`;
  }}finally{SHOT.pin.carry=c0;}
  return rows;
 }
 // the ATT holding a back-pinned ball with the blue keeper and DEF covering: every man x start offset x dz x seed
 function ppVsAI(o){
  o=Object.assign({ri:5,diff:'pro',set:{},tt:false,men:[0,1,2],offs:[-6,-2,2,6],dzs:[-0.4,0.4],seeds:[1,2,3],T:3.6},o||{});
  return withSet(o.set,()=>{
   const t={n:0,fired:0,goal:0,gk:0,def:0,none:0,tFire:0,svAbs:0,why:{},ends:{},lost:0};
   for(const man of o.men)for(const off of o.offs)for(const dz of o.dzs)for(const seed of o.seeds){
    const a=ppScene({ri:o.ri,man,off,dz,seed,diff:o.diff,tt:o.tt,T:o.T});
    if(a.out){t.lost++;continue;}
    t.n++;
    if(a.fire){t.fired++;t.tFire+=a.fire.t;t.svAbs+=Math.abs(a.fire.sv);const w=a.fire.why||a.fire.style;t.why[w]=(t.why[w]||0)+1;}else t.none++;
    if(a.goal)t.goal++;if(a.gk)t.gk++;if(a.def)t.def++;
    for(const k in a.ends)t.ends[k]=(t.ends[k]||0)+a.ends[k];
   }
   t.tFire=+(t.tFire/Math.max(1,t.fired)).toFixed(2);t.svAbs=+(t.svAbs/Math.max(1,t.fired)).toFixed(1);t.rate=+(t.goal/Math.max(1,t.n)).toFixed(3);
   return t;
  });
 }
 // a committed play scripted on the rod after the settle: sell `fake` u away from side s at the carry, burst toward s at v, fire once it has gone d past the turn (no lane check); the keeper and DEF play it with their AI
 function ppForce(o){
  o=Object.assign({ri:5,man:1,dz:0,off:0,rel:-3.6,diff:'pro',seed:1,keep:[7,6],s:1,v:25,d:4,fake:0,T:2},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  try{
   S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   const r=rods[o.ri],dir=r.kickDir,keep=o.keep.map(i=>rods[i]);
   rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;q.aiIQ=true;q.exert=0;q.rvUntil=0;q.rvReady=false;q.aiTZ=null;});
   for(const q of rods){const on=q===r||keep.indexOf(q)>=0;for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=on?0:1e9;}
   const off0=clamp(o.off,-r.maxOff,r.maxOff);r.offset=r.target=r.prevOffset=r.pivot.position.z=off0;
   const fa=footAngle(o.rel,false),pa=(fa==null?SHOT.pin.angle:fa)*dir;r.angle=r.prevAngle=pa;r.pivot.rotation.z=r.angle;
   const b=makeBall('classic');b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[o.man]+off0+o.dz);b.v.set(0,0,0);syncBall(b);
   for(let i=0;i<SIM.hz&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinA=pa;r.aiMan=o.man;bare();}
   if(!r.pinB)return {out:'nopin'};
   r.act='catch';r.catPh='hold';r.tapN=0;r.catCd=0;pinPlayStart(r);
   for(let i=0;i<Math.round(0.8*SIM.hz);i++){r.catT=-9;step();}
   const room=s=>s>0?r.maxOff-r.offset:r.offset+r.maxOff,s=o.s;
   if(o.fake&&room(-s)<o.fake)return {out:'noroom'};
   let ph=o.fake?'sell':'burst',o1=r.offset,tgt=r.offset-s*o.fake,n=0,fired=false,z0=b.m.position.z,fz=null,fv=null;
   while(!fired&&n++<SIM.hz*1.5){
    r.puPh=ph;r.puB=false;
    if(ph==='sell'){if(Math.abs(r.offset-tgt)<0.3){ph='burst';o1=r.offset;continue;}}
    else if(s*(r.offset-o1)>=o.d){
     if(room(s)<AIC.catch.push.room)return {out:'noroom'};
     const sv=r.slideV,gx=dir*F.L/2,P=AIC.catch.push,bp=b.m.position;r.catSv=sv;r.catSl=pushSlope(r,sv);r.pcWhy='force';r.puPh='burst';fz=bp.z;fv=sv;
     var judge=pushOutlet(r,bp.x,bp.z,sv,laneObs(r.team,bp.x,gx,AIC.catch.shotV),gx),zg=bp.z+sv*(P.drift+P.k*Math.abs(gx-bp.x)),gkz=rods[7].baseZ[0]+rods[7].offset;
     if(pinFire(r,b,DIFFS[teamDiff(r.team)],1)<1)return {out:'gate'};catchEnd(r,AIC.catch.cd,'force');fired=true;break;
    }
    const want=ph==='sell'?tgt:r.offset+s*o.v/SIM.hz;
    r.catT=-9;aiUpdate(FIX);r.puPh=ph;r.target=want;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
    if(!r.pinB)return {out:'dropped'};
   }
   if(!fired)return {out:'nofire'};
   let blk=null;
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){step();if(!blk&&b.msc&&b.msc.team!==r.team)blk=b.msc.role;if(b.scored||S.phase!=='play')break;}
   return {goal:!!b.scored,blk,fz:+fz.toFixed(1),fv:+fv.toFixed(1),z0:+z0.toFixed(1),judge:+judge.toFixed(2),zg:+zg.toFixed(1),gkz:+gkz.toFixed(1)};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];}
 }
 // every start x a grid of committed plays: goals per (fake, v, d), toward the middle (both ways from near it)
 function ppGrid(o){
  o=Object.assign({diff:'pro',men:[0,1,2],offs:[-8,-5,-2,1,4,7],dzs:[-0.6,0,0.6],seeds:[1],vs:[18,24,30,36],ds:[1,3,6],fakes:[0,3,6]},o||{});   // a scene is the same whatever the seed: dz and the start make the spread
  const out={},TT=AIC.catch.tictac,tt0=TT.on;TT.on=false;
  try{for(const fk of o.fakes)for(const v of o.vs)for(const d of o.ds){
   const k=`fake${fk} v${v} d${d}`,t={n:0,goal:0,gk:0,def:0,out:0};
   for(const man of o.men)for(const off of o.offs)for(const dz of o.dzs)for(const seed of o.seeds){
    const r=rods[5],z=r.baseZ[man]+off,ss=Math.abs(z)<3?[-1,1]:[z>0?-1:1];
    for(const s of ss){const a=ppForce({man,off,dz,seed,diff:o.diff,s,v,d,fake:fk});if(a.out){t.out++;continue;}t.n++;if(a.goal)t.goal++;if(a.blk==='GK')t.gk++;else if(a.blk)t.def++;}
   }
   t.rate=+(t.goal/Math.max(1,t.n)).toFixed(2);out[k]=`goal ${t.goal}/${t.n} (${t.rate}) gk ${t.gk} def ${t.def} skipped ${t.out}`;
  }}finally{TT.on=tt0;}
  return out;
 }
 // every committed play of a grid as one row (for a look at what predicts a goal)
 function ppRows(o){
  o=Object.assign({diff:'pro',men:[0,1,2],offs:[-8,-5,-2,1,4,7],dzs:[-0.6,0,0.6],vs:[18,24,30,36],ds:[1,3,6],fakes:[0,3,6]},o||{});
  const rows=[],TT=AIC.catch.tictac,tt0=TT.on;TT.on=false;
  try{for(const fk of o.fakes)for(const v of o.vs)for(const d of o.ds)for(const man of o.men)for(const off of o.offs)for(const dz of o.dzs){
   const z=rods[5].baseZ[man]+off,ss=Math.abs(z)<3?[-1,1]:[z>0?-1:1];
   for(const s of ss){const a=ppForce({man,off,dz,diff:o.diff,s,v,d,fake:fk});if(a.out)continue;rows.push([fk,v,d,s,a.z0,a.fz,a.fv,a.judge,a.zg,a.gkz,a.goal?1:0,a.blk||'-'].join(','));}
  }}finally{TT.on=tt0;}
  return rows.join('\n');
 }
 function ppAll(o){o=o||{};return {slide:ppSlide(),pro:ppVsAI(Object.assign({diff:'pro'},o)),legend:ppVsAI(Object.assign({diff:'legend'},o))};}
 window.ppScene=ppScene;window.ppSlide=ppSlide;window.ppVsAI=ppVsAI;window.ppAll=ppAll;window.ppWith=withSet;window.ppForce=ppForce;window.ppGrid=ppGrid;window.ppRows=ppRows;
})();
