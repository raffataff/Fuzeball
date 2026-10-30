// The player's roll on the real sim: a ball back-pinned by one man, carried, let go (finesse up, raise held) and pinned again by the next man (finesse pressed again). Run from a terminal:
//      node tools/page-run.js tools/rollpin-soak.js "rpAll()"
//      rpScene({ri:3,man:2,R:-2.8,V:30,fin:0.1,trace:true})   // one roll: R = depth it is held at, V = the mouse's slide (u/s), fin = s after the let-go that finesse is pressed again
//      rpScene({at:1})                                         // ...or pressed once the ball is `at` from the next man's centre (0 = as it crosses it)
//      rpScene({kbd:true,run:0.2})                             // ...the slide on its key for `run` s instead (a pinned key slide is 64 u/s: the ball leaves at ~51)
//      rpGrid({R:-2.8,fins:[0.1,0.25]})                        // every rod x speed: P pinned by the next man, back by the one that let go, other by a man further on, through / short of him
//      rpAB({kbd:true})                                        // each depth, shots.pin.assist.roll off against on
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',RZ='ShiftLeft';
 const MAN={5:1,3:2,1:0},NAME={5:'ATT',3:'MID',1:'DEF'};
 function setup(o){
  S.seedNext=o.seed||1;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  if(typeof NAV!=='undefined')NAV.root=null;   // a match started straight from the home screen leaves the menu owning the pad
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
 function rpScene(o){
  const W=SHOT.pin.assist.roll,w0=W.on,a0=cfg.auto;
  if(o&&o.old)W.on=false;cfg.auto=false;
  try{return scene(o);}finally{W.on=w0;cfg.auto=a0;for(const k of Object.keys(keys))keys[k]=false;}
 }
 function scene(o){
  o=Object.assign({ri:3,man:null,s:1,R:-3.6,V:30,run:0.35,fin:0.1,at:null,follow:0,kbd:false,T:2.5,seed:1,trace:false,every:0.02},o||{});
  const man=o.man!=null?o.man:MAN[o.ri],r=setup(o),dir=r.kickDir,n=man+o.s,KEY=o.s>0?'KeyS':'KeyW';
  // raise held, a ball under the man, finesse: the assist brings the leg down onto it
  press(RZ);for(let i=0;i<30;i++)step();
  const b=makeBall('classic');
  b.m.position.set(r.x+o.R*dir,BALL_R,r.baseZ[man]+r.offset);b.v.set(0,0,0);syncBall(b);
  keys[FIN]=true;
  for(let i=0;i<90&&r.pinB!==b;i++)step();
  if(r.pinB!==b)return {err:'no first pin'};
  for(let i=0;i<24;i++)step();
  // back away from the next man for room to run
  const back=clamp(-o.s*r.maxOff*0.8,-r.maxOff,r.maxOff);
  for(let i=0;i<240&&Math.abs(r.offset-back)>0.2;i++){r.target+=clamp(back-r.target,-40*FIX,40*FIX);step();}
  for(let i=0;i<12;i++)step();
  const L=[],held=+((b.m.position.x-r.x)*dir).toFixed(2);
  let t=0,nt=0,tRel=null,vRel=null,tFin=null,res=null;
  for(let i=0,N=Math.round((o.run+o.T)*SIM.hz);i<N;i++){
   t=i/SIM.hz;
   const p=b.m.position;
   if(tRel==null){
    if(t>=o.run||Math.abs(r.offset)>=r.maxOff-0.1){lift(FIN);if(o.kbd)lift(KEY);tRel=t;}
    else if(o.kbd){if(!keys[KEY])press(KEY);}
    else r.target=clamp(r.target+o.s*o.V*FIX,-r.maxOff,r.maxOff);
   }else{
    if(o.follow)r.target=clamp(r.target+o.s*o.V*o.follow*FIX,-r.maxOff,r.maxOff);
    if(tFin==null&&(o.at!=null?(r.baseZ[n]+r.offset-p.z)*o.s<=o.at:t-tRel>=o.fin)){keys[FIN]=true;tFin=t;}
   }
   step();
   if(tRel!=null&&vRel==null&&!b.pinR)vRel=+b.v.z.toFixed(1);
   if(o.trace&&tRel!=null&&t>=nt){nt=t+o.every;const q=b.m.position;L.push(`${(t-tRel).toFixed(3)} ang=${(r.angle*dir).toFixed(2)} pinA=${r.pinA==null?'-':(r.pinA*dir).toFixed(2)} on=${r.pinOn?1:0} off=${r.offset.toFixed(2)} pin=${r.pinB?b.pinMan:'-'} | rel=${((q.x-r.x)*dir).toFixed(2)} toNext=${((r.baseZ[n]+r.offset-q.z)*o.s).toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(tRel!=null&&b.pinR===r&&(b.pinMan!==man||t-tRel>0.05)){res=b.pinMan===n?'P':b.pinMan===man?'back':'other';break;}
  }
  if(!res)res=(b.m.position.z-(r.baseZ[n]+r.offset))*o.s>0?'through':'short';
  const out={res,held,vRel,fin:tFin==null?null:+(tFin-tRel).toFixed(3)};
  if(o.trace)out.L=L;
  return out;
 }
 function rpGrid(o){
  o=Object.assign({ris:[5,3,1],Vs:[15,25,35,45,60,80],runs:[0.12,0.2,0.3],fins:[0.1,0.25],at:null,kbd:false},o||{});
  const rows={},cnt={};
  for(const ri of o.ris)for(const f of (o.at||o.fins)){
   const line=[];
   for(const v of (o.kbd?o.runs:o.Vs)){
    const a=rpScene(Object.assign({},o,o.kbd?{run:v}:{V:v},{ri,fin:o.at?null:f,at:o.at?f:null}));
    line.push(a.res+'@'+a.vRel);cnt[a.res]=(cnt[a.res]||0)+1;
   }
   rows[NAME[ri]+(o.at?' at=':' fin=')+f]=line.join(' ');
  }
  return {rows,cnt};
 }
 function rpAB(o){
  o=o||{};const out={};
  for(const R of o.Rs||[-2.2,-2.8,-3.6,-4.4,-5]){
   const a=rpGrid(Object.assign({},o,{R,old:true})),b=rpGrid(Object.assign({},o,{R,old:false}));
   out['R='+R]={off:a.cnt,on:b.cnt,rows:b.rows};
  }
  return out;
 }
 function rpAll(){return {mouse:rpAB({}),keys:rpAB({kbd:true}),late:rpAB({Rs:[-2.6,-3.6],at:[3,2,1,0.5,0]})};}
 window.rpScene=rpScene;window.rpGrid=rpGrid;window.rpAB=rpAB;window.rpAll=rpAll;
})();
