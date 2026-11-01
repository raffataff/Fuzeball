// The player's roll from the FORWARD pin on the real sim: a ball held under one man's forward leg, carried, let go (finesse up, kick held) to roll along the row under the raised men, then pinned again by the next man (finesse pressed again). Run from a terminal:
//      node tools/page-run.js tools/fwdroll-soak.js "frlAll()"
//      frlScene({ri:3,V:30,fin:0.25,trace:true})   // one roll: V = the mouse's slide (u/s), fin = s after the let-go that finesse is pressed again (null = never)
//      frlScene({kick:false})                       // ...kick let go with finesse: the old let-go (the leg comes back to rest once the ball is clear)
//      frlGrid({fins:[0.15,0.3,null]})              // every rod x speed: P pinned by the next man, back by the one that let go, other, through / short; lo = the lowest the leg got before the re-press
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',KICK_K='Space';
 const MAN={5:1,3:2,1:0},NAME={5:'ATT',3:'MID',1:'DEF'};
 function setup(o){
  S.seedNext=o.seed||1;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  if(typeof NAV!=='undefined')NAV.root=null;
  for(const k of Object.keys(keys))keys[k]=false;
  const s=S.seats[0],r=rods[o.ri];
  const si=s.rods.indexOf(r);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;});
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  return r;
 }
 function step(){shotSeatsUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
 function press(code){keys[code]=true;bindPress(code);}
 function lift(code){keys[code]=false;bindRelease(code);}
 function frlScene(o){
  const a0=cfg.auto;cfg.auto=false;
  try{return scene(o);}finally{cfg.auto=a0;for(const k of Object.keys(keys))keys[k]=false;}
 }
 function scene(o){
  o=Object.assign({ri:3,man:null,s:1,R:3,dz:6,V:30,run:0.35,fin:0.25,kick:true,follow:0,T:2.5,seed:1,trace:false,every:0.02},o||{});
  const man=o.man!=null?o.man:MAN[o.ri],r=setup(o),dir=r.kickDir,n=man+o.s;
  // finesse + kick held, a ball lying ahead off the man's line: the leg goes up beside it, the man slides over and the leg comes down onto it
  const b=makeBall('classic');
  b.m.position.set(r.x+o.R*dir,BALL_R,r.baseZ[man]+r.offset-o.s*o.dz);b.v.set(0,0,0);syncBall(b);
  keys[FIN]=true;for(let i=0;i<3;i++)step();
  press(KICK_K);
  for(let i=0;i<240&&r.pinB!==b;i++){
   if(r.angle*dir>0.8){const g=clamp(b.m.position.z-r.baseZ[man],-r.maxOff,r.maxOff);r.target+=clamp(g-r.target,-12*FIX,12*FIX);}
   step();
  }
  if(r.pinB!==b)return {err:'no first pin'};
  for(let i=0;i<24;i++)step();
  // back away from the next man for room to run
  const back=clamp(-o.s*r.maxOff*0.8,-r.maxOff,r.maxOff);
  for(let i=0;i<240&&Math.abs(r.offset-back)>0.2;i++){r.target+=clamp(back-r.target,-40*FIX,40*FIX);step();}
  for(let i=0;i<12;i++)step();
  if(r.pinB!==b)return {err:'lost on the carry'};
  const L=[],held=+((b.m.position.x-r.x)*dir).toFixed(2);
  let t=0,nt=0,tRel=null,vRel=null,tFin=null,res=null,lo=9,knock=0;
  for(let i=0,N=Math.round((o.run+o.T)*SIM.hz);i<N;i++){
   t=i/SIM.hz;
   if(tRel==null){
    if(t>=o.run||Math.abs(r.offset)>=r.maxOff-0.1){lift(FIN);if(!o.kick)lift(KICK_K);tRel=t;}
    else r.target=clamp(r.target+o.s*o.V*FIX,-r.maxOff,r.maxOff);
   }else{
    if(o.follow)r.target=clamp(r.target+o.s*o.V*o.follow*FIX,-r.maxOff,r.maxOff);
    if(tFin==null&&o.fin!=null&&t-tRel>=o.fin){keys[FIN]=true;tFin=t;}
   }
   step();
   if(tRel!=null){
    if(vRel==null&&!b.pinR)vRel=+b.v.z.toFixed(1);
    if(tFin==null)lo=Math.min(lo,r.angle*dir);
    knock=Math.max(knock,Math.abs(b.v.x));
   }
   if(o.trace&&tRel!=null&&t>=nt){nt=t+o.every;const q=b.m.position;L.push(`${(t-tRel).toFixed(3)} ang=${(r.angle*dir).toFixed(2)} pinA=${r.pinA==null?'-':(r.pinA*dir).toFixed(2)} on=${r.pinOn?1:0} pose=${r.pinPose?1:0} fwd=${r.pinFwd?1:0} out=${r.fwdOut?1:0} off=${r.offset.toFixed(2)} pin=${r.pinB?b.pinMan:'-'} | rel=${((q.x-r.x)*dir).toFixed(2)} toNext=${((r.baseZ[n]+r.offset-q.z)*o.s).toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(tRel!=null&&b.pinR===r&&(b.pinMan!==man||t-tRel>0.05)){res=b.pinMan===n?'P':b.pinMan===man?'back':'other';break;}
  }
  if(!res)res=(b.m.position.z-(r.baseZ[n]+r.offset))*o.s>0?'through':'short';
  const out={res,held,vRel,lo:+lo.toFixed(2),knock:+knock.toFixed(1),fin:tFin==null?null:+(tFin-tRel).toFixed(3)};
  if(o.trace)out.L=L;
  return out;
 }
 function frlGrid(o){
  o=Object.assign({ris:[5,3,1],Vs:[15,25,35,45,60],fins:[0.15,0.3,null]},o||{});
  const rows={},cnt={};
  for(const ri of o.ris)for(const f of o.fins){
   const line=[];
   for(const v of o.Vs){
    const a=frlScene(Object.assign({},o,{ri,V:v,fin:f}));
    line.push(a.err||(a.res+'@'+a.vRel+' lo'+a.lo+' k'+a.knock));cnt[a.err||a.res]=(cnt[a.err||a.res]||0)+1;
   }
   rows[NAME[ri]+' fin='+f]=line.join(' | ');
  }
  return {rows,cnt};
 }
 function frlAll(){return {kick:frlGrid({}),letgo:frlGrid({kick:false,fins:[null]})};}
 window.frlScene=frlScene;window.frlGrid=frlGrid;window.frlAll=frlAll;
})();
