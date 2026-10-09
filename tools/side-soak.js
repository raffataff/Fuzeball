// Lateral-receive soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/side-soak.js').then(r=>r.text()).then(eval)
//      sideScene({ri:5,rel:-0.6,vz:10,from:12})    // one ball rolling ALONG the red ATT toward its middle man, a line per 0.1 s
//      sideGrid({ri:5})                            // every (rel, speed) cell: what the rod did, what became of the ball
//      tapScene({ri:5,man:0,s:1,trace:true})        // a tap from a ball pinned under man 0 toward man 1: release, cushion, pin at the receiver, a line per 0.05 s
//      tapGrid()                                    // every adjacent pair on the ATT, MID and DEF, both ways, on each difficulty: how many taps end in a pin
//      backGrid()                                   // a tap with the opposing row held at each offset: the receiver's lane shuts and it goes back (back-ok) or he pins it (ok)
//      meetRandom({n,seed,diff})                    // random slow balls along a rod clear of every man: how many end in a pin (compare AIC.catch.meet.on true / false)
//      tapRoles()                                   // taps started / landed per role since the last call, for the match soaks (catchSoak)
// why: 'what does an AI rod do with a ball rolling along its row' is a scene question; it drives the real aiUpdate / updateRods / physics (the loop's order, minus powerups)
// outcome per scene: pin (a pin was taken, then a shot / pass / lost) | kick (a plain swing) | through (rolled on past the rod's men) | bounce (turned round) | stop (still, nobody played it)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function sideScene(o){
  o=Object.assign({ri:5,rel:-0.6,vz:10,from:12,man:null,side:1,T:3,seed:1,every:0.1,iq:true,alone:true,trace:false},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;});   // a scene starts with every rod at rest, centred
  const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic');r.aiErrT=1e9;   // aiUpdate re-rolls aiIQ whenever this runs out, which would overwrite the forced value
  const mi=o.man==null?Math.floor((r.baseZ.length-1)/2):o.man;
  if(o.alone)for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  const gap=o.from==='half'?Math.abs(r.baseZ[1]-r.baseZ[0])/2:o.from,mz=r.baseZ[mi],z0=o.z!=null?o.z:clamp(mz-o.side*gap,-F.W/2+BALL_R+1,F.W/2-BALL_R-1);   // from 'half' = midway between two men; z = an explicit start
  b.m.position.set(r.x+o.rel*dir,BALL_R,z0);b.v.set(0,0,o.side*o.vz);syncBall(b);
  const L=[],acts={};let nt=0,fire=null,pinT=null,pinEnd=null,kicks=0,rev=false,minRel=1e9,maxRel=-1e9,tz=z0,ptouch=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   r.aiIQ=o.iq;const pk=r.kickT>=0,vz0=b.v.z;
   aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
   const t=i/SIM.hz,rel=(b.m.position.x-r.x)*dir;
   if(!pk&&r.kickT>=0){kicks++;if(!fire)fire={t:+t.toFixed(2),style:r.kickStyle};}
   if(r.pinB&&pinT==null)pinT=+t.toFixed(2);
   if(pinT!=null&&!r.pinB&&pinEnd==null)pinEnd=+t.toFixed(2);
   const a=(r.act||'-')+(r.catPh?'/'+r.catPh:'')+(r.retPh?'/'+r.retPh:'');acts[a]=(acts[a]||0)+1;
   if(Math.sign(b.v.z)===-o.side&&Math.abs(b.v.z)>2&&Math.abs(vz0)>2&&Math.sign(vz0)===o.side)rev=true;
   minRel=Math.min(minRel,rel);maxRel=Math.max(maxRel,rel);
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ang=${(r.angle*dir).toFixed(2)} ${a} pin=${r.pinB?1:0} off=${r.offset.toFixed(1)} tgt=${r.target.toFixed(1)} | ball rel=${rel.toFixed(2)} z=${b.m.position.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(S.phase!=='play')break;
  }
  const rel=(b.m.position.x-r.x)*dir,sp=b.v.length();
  // the FIRST thing that happened decides it: a later pin after a wall rebound is another story
  const kT=fire?fire.t:1e9,pT=pinT==null?1e9:pinT;let out;
  if(pT<kT)out=fire&&fire.style==='trapShot'?'pin>shot':fire&&fire.style==='pass'?'pin>pass':'pin';
  else if(kT<1e9)out='kick';
  else if(rev)out='bounce';
  else if(sp<2)out='stop';
  else out=Math.abs(b.m.position.z-mz)>Math.abs(z0-mz)?'through':'hold';
  return {out,pinT,pinEnd,fire,kicks,rev,acts,end:{rel:+rel.toFixed(1),z:+b.m.position.z.toFixed(1),v:+sp.toFixed(1)},L};
 }
 // rel along the rod, speed along z; one row per rel, one cell per speed
 function sideGrid(o){
  o=Object.assign({ri:5,rels:[-5,-3.4,-2,-0.6,1,3],vs:[5,9,14,20,30,45],iq:true,from:'half',side:1},o||{});
  const rows={};
  for(const rel of o.rels){rows[rel]=o.vs.map(v=>{const s=sideScene({ri:o.ri,rel,vz:v,from:o.from,iq:o.iq,side:o.side});return v+':'+s.out+(s.out.slice(0,3)==='pin'?'@'+s.pinT:s.out==='kick'?'@'+s.fire.t:'');}).join('  ');}
  return rows;
 }
 // a tap from a pinned ball: the red rod holds the ball under man `man` and is told to tap it toward `s` (the decision itself is tested in side/tap harness and the match soak); what comes of it
 // out: ok (the neighbour pinned it) | through (rolled on past) | lost (never pinned) | back-ok / back-lost (the lane at the neighbour shut and the man it came from took it, or did not); t* = release / cushion / back / pin times
 // block:[{ri,off}] keeps those opposing rods alive and holds them at that offset (the lanes the decision judges); every other opposing man is taken off
 function tapScene(o){
  o=Object.assign({ri:5,man:0,s:1,T:2.5,seed:1,iq:true,alone:true,trace:false,every:0.05,block:[]},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;r.bkRev=false;});   // a scene starts with every rod at rest, centred
  const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic');r.aiErrT=1e9;r.aiIQ=o.iq;
  const held=o.block.map(k=>rods[k.ri]);
  if(o.alone)for(const q of rods)if(q!==r&&held.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  o.block.forEach(k=>{const q=rods[k.ri];q.aiErrT=1e9;q.offset=k.off;q.target=k.off;q.prevOffset=k.off;q.pivot.position.z=k.off;});
  r.offset=o.off||0;r.target=r.offset;r.prevOffset=r.offset;r.pivot.position.z=r.offset;
  const mz=r.baseZ[o.man]+r.offset+(o.dz||0);
  b.m.position.set(r.x+(o.rel==null?-0.6:o.rel)*dir,BALL_R,mz);b.v.set(0,0,0);syncBall(b);
  r.angle=(o.rel!=null&&o.rel<-1.5?sideAngle(o.rel):-0.75)*dir;r.pinOn=true;r.pinPose=true;r.pinA=r.angle;pinUpdate();   // a ball held deep (what retrieve pins) is held by the leg at the angle that touches it
  if(!r.pinB)return {out:'nopin'};
  r.act='catch';r.catPh='hold';r.catT=0;r.tapN=0;pinPlayStart(r);
  r.tapPk={j:o.man+o.s,s:o.s,out:9};tapStart(r);
  const L=[];let nt=0,tRel=null,tCush=null,tPin=null,tBack=null,pinMan=-1,zMax=-1e9,zMin=1e9;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   aiUpdate(FIX);
   for(const k of o.block)rods[k.ri].target=k.off;
   userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
   const t=i/SIM.hz,z=b.m.position.z;zMax=Math.max(zMax,z);zMin=Math.min(zMin,z);
   if(tRel==null&&r.catPh==='side')tRel=+t.toFixed(2);
   if(tCush==null&&r.catCush)tCush=+t.toFixed(2);
   if(tBack==null&&r.catPh==='back')tBack=+t.toFixed(2);
   if(tPin==null&&r.pinB&&r.catPh==='hold'&&tRel!=null){tPin=+t.toFixed(2);pinMan=r.pinB.pinMan;}
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ${r.act||'-'}/${r.catPh||'-'} cush=${r.catCush?1:0} ang=${(r.angle*dir).toFixed(2)} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(1)} pin=${r.pinB?1:0} | ball z=${z.toFixed(1)} v=${b.v.z.toFixed(1)}`);}
   if(tPin!=null&&t>tPin+0.3)break;
   if(S.phase!=='play')break;
  }
  const z=b.m.position.z,mzJ=r.baseZ[o.man+o.s]+r.offset,back=tBack!=null,want=back?o.man:o.man+o.s;
  const out=tPin!=null?(back?'back-':'')+(pinMan===want?'ok':'wrongman'):back?'back-lost':((z-mzJ)*o.s>3?'through':'lost');
  return {out,tRel,tCush,tBack,tPin,pinMan,end:{z:+z.toFixed(1),off:+r.offset.toFixed(1)},L};
 }
 // the real retrieve: a slow ball left behind the heel of one man (rel, z), with the carry and the passes taken away, so a pinned ball that has nowhere to go can only be tapped. block as in tapScene
 // out: tap-ok (retrieve pinned it, handed it to the tap, a neighbour pinned it) | tap-lost | no-tap (retrieve did something else, `ph` says what)
 function retTapScene(o){
  o=Object.assign({ri:1,man:0,rel:-3.5,dz:0,off:0,T:4,seed:1,iq:true,trace:false,every:0.1,block:[{ri:2,off:0}]},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;r.bkRev=false;r.catDeep=false;});
  const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic'),held=o.block.map(k=>rods[k.ri]);r.aiErrT=1e9;r.aiIQ=o.iq;
  for(const q of rods)if(q!==r&&held.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  o.block.forEach(k=>{const q=rods[k.ri];q.aiErrT=1e9;q.offset=k.off;q.target=k.off;q.prevOffset=k.off;q.pivot.position.z=k.off;});
  r.offset=o.off;r.target=r.offset;r.prevOffset=r.offset;r.pivot.position.z=r.offset;
  b.m.position.set(r.x+o.rel*dir,BALL_R,r.baseZ[o.man]+r.offset+o.dz);b.v.set(0,0,0);syncBall(b);
  const PS=AIC.dribble.pass,CA=AIC.catch,keep=[PS.roles,CA.slideMax],c0={tap:CAS.tap,retTap:CAS.retTap,tapOk:CAS.tapOk,tapFail:CAS.tapFail};
  PS.roles=[];CA.slideMax=0.5;
  const L=[],phs=[];let nt=0,tRet=null,tTap=null,tLand=null,pinMan=-1;
  try{
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    aiUpdate(FIX);for(const k of o.block)rods[k.ri].target=k.off;userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
    for(const q of S.balls)q.cur.copy(q.m.position);
    const t=i/SIM.hz,ph=(r.act||'-')+(r.catPh?'/'+r.catPh:'')+(r.retPh?'/'+r.retPh:'');if(phs[phs.length-1]!==ph)phs.push(ph);
    if(tRet==null&&r.act==='retrieve'&&r.pinB)tRet=+t.toFixed(2);
    if(tTap==null&&r.catPh==='tap')tTap=+t.toFixed(2);
    if(tLand==null&&tTap!=null&&r.pinB&&r.catPh==='hold'){tLand=+t.toFixed(2);pinMan=r.pinB.pinMan;}
    if(o.trace&&t>=nt){nt+=o.every;const p=b.m.position;L.push(`${t.toFixed(2)} ${ph} pin=${r.pinB?1:0} ang=${(r.angle*dir).toFixed(2)} off=${r.offset.toFixed(1)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
    if(tLand!=null&&t>tLand+0.3)break;
    if(S.phase!=='play')break;
   }
  }finally{PS.roles=keep[0];CA.slideMax=keep[1];}
  const taps=CAS.retTap-c0.retTap,out=taps===0?'no-tap':tLand!=null?'tap-ok':'tap-lost';
  return {out,tRet,tTap,tLand,pinMan,ph:phs.join(' > '),L};
 }
 // every start (man, side of the opposing row) of a retrieve pin that is tapped: what comes of it
 function retTapGrid(o){
  o=Object.assign({diffs:['rookie','pro','legend'],rels:[-2.8,-3.2,-3.6],ri:1,blk:[2],bos:[-6,-3,0,3,6]},o||{});
  const rows={},d0=[cfg.diffRed,cfg.diffBlue];
  for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;const tally={},bad=[];
   for(const rel of o.rels)for(const man of [0,1])for(const bo of o.bos){const t=retTapScene({ri:o.ri,man,rel,block:o.blk.map(ri=>({ri,off:bo})),T:5});tally[t.out]=(tally[t.out]||0)+1;if(t.out==='tap-lost'&&bad.length<3)bad.push(`rel${rel} man${man} bo${bo}: ${t.ph}`);}
   rows[d]=JSON.stringify(tally)+(bad.length?'  '+bad.join(' | '):'');}
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];return rows;
 }
 function tapGrid(o){
  o=Object.assign({diffs:['rookie','pro','legend']},o||{});
  const rows={},d0=[cfg.diffRed,cfg.diffBlue];
  for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;
   for(const [nm,ri] of [['ATT',5],['MID',3],['DEF',1]]){let n=0,ok=0;const bad=[];const nMen=rods[ri].baseZ.length;
    for(let man=0;man<nMen;man++)for(const s of [-1,1]){const j=man+s;if(j<0||j>=nMen)continue;
     const t=tapScene({ri,man,s,T:3.2});n++;if(t.out==='ok'||t.out==='back-ok')ok++;else bad.push(man+(s>0?'>':'<')+j+':'+t.out);}
    rows[d+' '+nm]=ok+'/'+n+(bad.length?'  '+bad.join(' '):'');}}
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];return rows;
 }
 // random start offset (with the room the decision asks for), depth in the tap band and z under the man; seeded so a change replays the same trials
 function tapRandom(o){
  o=Object.assign({n:200,seed:7,diff:null,ri:null},o||{});
  if(!rods[0]){S.seedNext=1;startMatchNow('ai');}
  let sd=o.seed;const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const d0=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  const TP=AIC.catch.tap,R={n:0,ok:0,landed:0,through:0,lost:0,wrongman:0,nopin:0,tPin:[],bad:[]};   // landed = ok + back-ok
  for(let k=0;k<o.n;k++){
   const ri=o.ri!=null?o.ri:(rnd()<0.5?5:3),nMen=rods[ri].baseZ.length,man=Math.floor(rnd()*nMen),s=rnd()<0.5?-1:1;
   if(man+s<0||man+s>=nMen){k--;continue;}
   const mo=rods[ri].maxOff,off=s>0?U(-mo,mo-TP.room):U(-mo+TP.room,mo);
   const rel=U(TP.relMin,TP.relMax),dz=U(-1,1),t=tapScene({ri,man,s,off,rel,dz,T:2.4,seed:k+1});
   R.n++;R[t.out]=(R[t.out]||0)+1;if(t.out==='ok'||t.out==='back-ok'){R.landed++;if(t.out==='ok')R.tPin.push(t.tPin);}else R.bad.push({ri,man,s,off:+off.toFixed(2),rel:+rel.toFixed(2),dz:+dz.toFixed(2),out:t.out});
  }
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];
  R.tPin=R.tPin.length?{min:Math.min(...R.tPin),max:Math.max(...R.tPin),mean:+(R.tPin.reduce((a,b)=>a+b,0)/R.tPin.length).toFixed(2)}:null;R.bad=R.bad.filter(b=>b.out!=='nopin').slice(0,12);
  return R;
 }
 // a ball let go just past one man (z-clear of him) and rolling to the next, at each speed and depth, both ways: how many end in a pin, and what the rest did (a tap by a human rod, a rebound)
 function fastGrid(o){
  o=Object.assign({ri:5,k:0,diffs:['rookie','pro','legend'],vs:[26,30,34,38,42,45],rels:[-0.7,-1.3,-1.9],past:4.6,T:3},o||{});
  if(!rods[0]){S.seedNext=1;startMatchNow('ai');}
  const rows={},d0=[cfg.diffRed,cfg.diffBlue],r=rods[o.ri];
  for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;const row={};
   for(const v of o.vs){let pin=0,n=0;const outs={};
    for(const rel of o.rels)for(const side of [1,-1]){
     const i0=side>0?o.k:o.k+1,s=sideScene({ri:o.ri,rel,vz:v,z:r.baseZ[i0]+side*o.past,side,T:o.T,iq:true,alone:true});
     n++;const key=s.out.slice(0,3)==='pin'?'pin':s.out;outs[key]=(outs[key]||0)+1;if(key==='pin')pin++;}
    row[v]=pin+'/'+n+(pin<n?' '+JSON.stringify(outs):'');}
   rows[d]=row;}
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];return rows;
 }
 // a tap with the opposing row held at each offset in turn, every difficulty: where the lane at the receiving man shuts and the one he came from is open it goes back (out back-ok), else the receiver pins it (ok); nothing should end any other way
 function backGrid(o){
  o=Object.assign({diffs:['rookie','pro','legend']},o||{});
  const rows={},d0=[cfg.diffRed,cfg.diffBlue];
  for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;
   for(const [nm,ri,pairs,offs,blk] of [['DEF',1,[[0,1],[1,-1]],[-6,0,6],bo=>[{ri:2,off:bo}]],['MID',3,[[1,1],[2,1],[2,-1],[3,-1],[0,1],[4,-1]],[-2,0,2],bo=>[{ri:4,off:bo}]],['ATT',5,[[0,1],[1,1],[2,-1],[1,-1]],[-3,0,3],bo=>[{ri:6,off:bo*2},{ri:7,off:bo}]]]){
    const tally={},bad=[];
    for(const [man,s] of pairs)for(let bo=-6;bo<=6;bo++)for(const off of offs){const t=tapScene({ri,man,s,off,T:3.6,block:blk(bo)});tally[t.out]=(tally[t.out]||0)+1;if(!/^(ok|back-ok)$/.test(t.out)&&bad.length<4)bad.push(`${man}>${s} off${off} bo${bo}:${t.out}`);}
    rows[d+' '+nm]=JSON.stringify(tally)+(bad.length?'  '+bad.join(' '):'');}}
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];return rows;
 }
 // random slow balls rolling along a rod: depth, speed, direction and a start z clear of every man (so the meet, or the side catch, has to deal with it); seeded. Compare AIC.catch.meet.on true / false
 function meetRandom(o){
  o=Object.assign({n:150,seed:11,diff:null,ri:null,vmin:1.6,vmax:12,T:4},o||{});
  if(!rods[0]){S.seedNext=1;startMatchNow('ai');}
  let sd=o.seed;const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const d0=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  const R={n:0,pin:0,out:{},bad:[],tPin:[]},CL=AIC.catch.meet.clear+0.5;
  for(let k=0;k<o.n;k++){
   const ri=o.ri!=null?o.ri:[5,3,1][Math.floor(rnd()*3)],r=rods[ri],side=rnd()<0.5?-1:1,vz=U(o.vmin,o.vmax),rel=U(-2.0,-0.6);
   let z=null;
   for(let a=0;a<30&&z==null;a++){const c=U(-F.W/2+5,F.W/2-5);let ok=true;for(const bz of r.baseZ)if(Math.abs(bz-c)<CL)ok=false;
    if(ok){let ahead=false;for(const bz of r.baseZ)if((bz-c)*side>0)ahead=true;if(ahead)z=c;}}
   if(z==null){k--;continue;}
   const s=sideScene({ri,rel,vz,z,side,T:o.T,seed:k+1,iq:true,alone:true});
   const key=s.out.slice(0,3)==='pin'?'pin':s.out;R.n++;R.out[key]=(R.out[key]||0)+1;
   if(key==='pin'){R.pin++;R.tPin.push(s.pinT);}else R.bad.push({ri,side,rel:+rel.toFixed(2),vz:+vz.toFixed(1),z:+z.toFixed(1),out:s.out,acts:Object.keys(s.acts).join(' ')});
  }
  cfg.diffRed=d0[0];cfg.diffBlue=d0[1];
  R.tPin=R.tPin.length?{mean:+(R.tPin.reduce((a,b)=>a+b,0)/R.tPin.length).toFixed(2),max:Math.max(...R.tPin)}:null;R.bad=R.bad.slice(0,10);
  return R;
 }
 // per-role tallies of taps started and landed, for the match soaks (catchSoak); tapRoles() reads and clears them
 const TR={};
 if(!window.__ts0){window.__ts0=tapStart;window.__pps0=pinPlayStart;}
 window.tapStart=function(r){const q=TR[r.role]||(TR[r.role]={start:0,ok:0});q.start++;return __ts0.apply(this,arguments);};
 window.pinPlayStart=function(r){if(r.tapPend){const q=TR[r.role]||(TR[r.role]={start:0,ok:0});q.ok++;}return __pps0.apply(this,arguments);};
 function tapRoles(clear){const o=JSON.parse(JSON.stringify(TR));if(clear!==false)for(const k in TR)delete TR[k];return o;}
 window.tapRoles=tapRoles;window.retTapScene=retTapScene;window.retTapGrid=retTapGrid;window.fastGrid=fastGrid;window.meetRandom=meetRandom;window.backGrid=backGrid;window.tapRandom=tapRandom;window.sideScene=sideScene;window.sideGrid=sideGrid;window.tapScene=tapScene;window.tapGrid=tapGrid;
})();
