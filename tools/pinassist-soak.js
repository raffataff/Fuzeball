// The player's pin assist, measured on the real sim. Run from a terminal:
//      node tools/page-run.js tools/pinassist-soak.js "paAll()"
//      paKbd({ri:5,R:-3,miss:1.5,fwd:false,old:false,trace:true})   // keyboard: finesse + raise (or + kick, fwd), slide onto a ball at rest, the slide key let go `miss` past the ball's z (negative = short of it)
//      paKbdGrid({fwd:false})                                        // every depth x miss, assist on against the old controls
//      paStick({ri:5,R:-3,aim:0.1,wob:0.15,old:false})               // a pad, finesse (LT) + the right stick: back over the ball, then eased toward the catch angle off by `aim` (rad) with a wobbling hand
//      paStickGrid()                                                 // every aim x wobble, both modes
//      paSquare({ri:5,R:-2,old:false})                               // finesse alone, a ball beside the man: the foot squares onto it, then the man slides into it: what leaves
//      paSquareGrid()
// old = the controls before the assist: shots.pin.assist off, shots.hold.lead off, shots.square off
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',KICK_K='Space',RZ='ShiftLeft',DN='KeyS',UP='KeyW';
 const MAN={5:1,3:2,1:1};
 const NAME={5:'ATT',3:'MID',1:'DEF'};
 let PAD=null;
 const gp0=navigator.getGamepads?navigator.getGamepads.bind(navigator):null;
 navigator.getGamepads=function(){return PAD?[PAD]:(gp0?gp0():[]);};
 function pad(){const b=[];for(let i=0;i<17;i++)b.push({pressed:false,value:0});return {id:'synthetic',connected:true,axes:[0,0,0,0],buttons:b};}
 function old(on,fn){
  const A=SHOT.pin.assist,H=SHOT.hold,Q=SHOT.square,s=[A.on,H.lead,Q.on];
  if(on){A.on=false;H.lead=null;Q.on=false;}
  try{return fn();}finally{A.on=s[0];H.lead=s[1];Q.on=s[2];}
 }
 function setup(o){
  S.seedNext=o.seed||1;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  if(typeof NAV!=='undefined')NAV.root=null;   // a match started straight from the home screen leaves the menu owning the pad (padNavOwns); navTick is not running to clear it
  for(const k of Object.keys(keys))keys[k]=false;
  const s=S.seats[0],r=rods[o.ri];
  const si=s.rods.indexOf(r);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;});
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  r.offset=0;r.target=0;r.prevOffset=0;r.pivot.position.z=0;
  return {s,r};
 }
 function step(n){
  for(let i=0;i<n;i++){
   if(PAD)gamepadUpdate(FIX);
   shotSeatsUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
  }
 }
 function press(code){keys[code]=true;bindPress(code);}
 function lift(code){keys[code]=false;bindRelease(code);}
 function wrap(fn){const a0=cfg.auto,m0=cfg.padControlMode;cfg.auto=false;try{return fn();}finally{cfg.auto=a0;cfg.padControlMode=m0;PAD=null;for(const k of Object.keys(keys))keys[k]=false;}}
 function ballAt(r,man,R,dz){
  const b=makeBall('classic'),mz=r.baseZ[man]+r.offset;
  b.m.position.set(r.x+R*r.kickDir,BALL_R,mz+dz);b.v.set(0,0,0);syncBall(b);
  return b;
 }
 // --- keyboard: finesse + raise / kick, slide on, let the key go late or early ---
 function paKbd(o){return wrap(()=>old(o&&o.old,()=>kbd(o)));}
 function kbd(o){
  o=Object.assign({ri:5,R:-3,dz:7,miss:0,fwd:false,T:2.5,seed:1,trace:false,every:0.05},o||{});
  const man=o.man!=null?o.man:MAN[o.ri];
  const {r}=setup(o),dir=r.kickDir,b=ballAt(r,man,o.R,o.dz),bz=b.m.position.z,L=[];
  keys[FIN]=true;step(3);
  press(o.fwd?KICK_K:RZ);   // held: the pose lasts while its button is (pin.latch false)
  step(Math.round(0.25*SIM.hz));
  let held=true,tPin=null,maxV=0,nt=0,tRel=null;
  press(DN);
  const n=Math.round(o.T*SIM.hz);
  for(let i=0;i<n;i++){
   const t=i/SIM.hz,mz=r.baseZ[man]+r.offset;
   if(held&&mz>=bz+o.miss){lift(DN);held=false;tRel=+t.toFixed(2);}
   step(1);
   const p=b.m.position;
   if(tPin==null&&r.pinB===b)tPin=+t.toFixed(2);
   if(tPin==null)maxV=Math.max(maxV,Math.hypot(b.v.x,b.v.z));
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ang=${(r.angle*dir).toFixed(2)} pinA=${r.pinA==null?'-':(r.pinA*dir).toFixed(2)} off=${r.offset.toFixed(2)} tgt=${r.target.toFixed(2)} vz=${r.vz.toFixed(1)} pin=${r.pinB?1:0} | ball rel=${((p.x-r.x)*dir).toFixed(2)} dz=${(p.z-(r.baseZ[man]+r.offset)).toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
  }
  const p=b.m.position,out={pinned:r.pinB===b,tPin,tRel,maxV:+maxV.toFixed(1),rel:+((p.x-r.x)*dir).toFixed(2),dz:+(p.z-(r.baseZ[man]+r.offset)).toFixed(2),moved:+Math.hypot(p.x-(r.x+o.R*dir),p.z-bz).toFixed(2)};
  lift(FIN);lift(RZ);lift(KICK_K);lift(DN);
  if(o.trace)out.L=L;
  return out;
 }
 function paKbdGrid(o){
  o=Object.assign({fwd:false,ris:[5,3,1],Rs:null,miss:[-1.5,-0.75,0,0.75,1.5,2.5,4]},o||{});
  const Rs=o.Rs||(o.fwd?[3.25,3.5,4,4.5,5]:[-2,-2.5,-3,-3.5,-4,-4.5,-5]);
  const res={};
  for(const mode of ['old','new']){
   let ok=0,n=0;const rows={};
   for(const ri of o.ris)for(const R of Rs){
    let line='';
    for(const m of o.miss){const a=paKbd({ri,R,miss:m,fwd:o.fwd,old:mode==='old'});n++;if(a.pinned)ok++;line+=a.pinned?'P':(a.moved>1?'x':'.');}
    rows[NAME[ri]+' R='+R]=line;
   }
   res[mode]={pinned:ok+'/'+n,rows};
  }
  res.key='one cell per miss '+JSON.stringify(o.miss)+': P pinned, x the ball was pushed more than 1, . left where it lay';
  return res;
 }
 // --- a pad: finesse (LT) + the right stick ---
 function paStick(o){return wrap(()=>old(o&&o.old,()=>stick(o)));}
 function stick(o){
  o=Object.assign({ri:5,R:-3,dz:7,miss:0.5,aim:0,wob:0,hz:2.5,mode:'total',T:3,seed:1,trace:false,every:0.05},o||{});
  const man=o.man!=null?o.man:MAN[o.ri];
  cfg.padControlMode=o.mode;
  const {s,r}=setup(o),dir=r.kickDir,b=ballAt(r,man,o.R,o.dz),bz=b.m.position.z,L=[];
  PAD=pad();s.padAngleArm=true;
  const DZ=cfg.padDeadzone,sens=cfg.padAngleSens,inv=cfg.padAngleInvert?-1:1;
  // the stick value that asks for rod-local angle a (back: negative)
  const rsFor=a=>{const d=a<0?a/KICK.raiseA:-a/KICK.strikeA,u=Math.min(1,Math.abs(d)/sens);return inv*Math.sign(d)*(DZ+u*(1-DZ));};
  const fa=footAngle(o.R,o.R>0),rng=(()=>{let x=o.seed*9301+49297;return()=>{x=(x*233280+49297)%2147483647;return x/2147483647;};})();
  const up=o.R<0?KICK.raiseA:AIC.catch.recv.lift.angle;
  PAD.buttons[6]={pressed:true,value:1};
  let held=true,tPin=null,tLost=null,maxV=0,nt=0,ph=0,t0=0,pinT=0;
  const n=Math.round(o.T*SIM.hz),setStick=a=>{PAD.axes[3]=clamp(rsFor(a),-1,1);};
  setStick(up);step(Math.round(0.3*SIM.hz));
  PAD.axes[1]=1;
  for(let i=0;i<n;i++){
   const t=i/SIM.hz,mz=r.baseZ[man]+r.offset;
   if(held&&mz>=bz+o.miss){PAD.axes[1]=0;held=false;t0=t;}
   // the hand: once stopped, eases the stick from up to the catch angle off by aim, over 0.3 s, and wobbles
   if(!held){const k=clamp((t-t0-0.1)/0.3,0,1),a=lerp(up,fa+o.aim*(o.R<0?1:-1),k)+(k>0?o.wob*(Math.sin(t*o.hz*6.283)+0.6*(rng()*2-1)):0);setStick(a);}
   step(1);
   if(r.pinB===b){if(tPin==null)tPin=+t.toFixed(2);pinT+=FIX;}else if(tPin!=null&&tLost==null)tLost=+t.toFixed(2);
   if(tPin==null||tLost!=null)maxV=Math.max(maxV,Math.hypot(b.v.x,b.v.z));
   const p=b.m.position;
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} stick=${PAD.axes[3].toFixed(2)} tgt=${(r.padAngleTarget*dir).toFixed(2)} mag=${r.pinMag==null?'-':(r.pinMag*dir).toFixed(2)} ang=${(r.angle*dir).toFixed(2)} off=${r.offset.toFixed(2)} pin=${r.pinB?1:0} | ball rel=${((p.x-r.x)*dir).toFixed(2)} dz=${(p.z-(r.baseZ[man]+r.offset)).toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
  }
  const out={held:r.pinB===b,tPin,tLost,pinT:+pinT.toFixed(2),maxV:+maxV.toFixed(1),fa:+fa.toFixed(2)};
  if(o.trace)out.L=L;
  return out;
 }
 function paStickGrid(o){
  o=Object.assign({ris:[5,3,1],Rs:[-2.5,-3.5,-4.5],aims:[-0.2,-0.1,0,0.1,0.2,0.3],wobs:[0,0.1,0.2],mode:'total'},o||{});
  const res={};
  for(const mode of ['old','new']){
   let ok=0,n=0;const rows={};
   for(const ri of o.ris)for(const R of o.Rs)for(const w of o.wobs){
    let line='';
    for(const a of o.aims){const x=paStick({ri,R,aim:a,wob:w,mode:o.mode,old:mode==='old'});n++;if(x.held)ok++;line+=x.held?'P':(x.tPin!=null?'l':(x.maxV>6?'x':'.'));}
    rows[NAME[ri]+' R='+R+' wob='+w]=line;
   }
   res[mode]={held:ok+'/'+n,rows};
  }
  res.key='one cell per aim '+JSON.stringify(o.aims)+' (rad short of the catch, + = lower, toward upright): P held at the end, l caught then lost, x pushed, . untouched';
  return res;
 }
 // --- finesse alone: the square, then the man slides into the ball ---
 function paSquare(o){return wrap(()=>old(o&&o.old,()=>square(o)));}
 function square(o){
  o=Object.assign({ri:5,R:-2,dz:6,run:1.0,T:1.6,seed:1,trace:false,every:0.05},o||{});
  const man=o.man!=null?o.man:MAN[o.ri];
  const {r}=setup(o),dir=r.kickDir,b=ballAt(r,man,o.R,o.dz),L=[];
  keys[FIN]=true;step(Math.round(0.4*SIM.hz));
  const a0=r.angle*dir,ha=hitAngle(o.R);
  press(DN);
  let hit=null,nt=0,vm=0,vx=0,vz=0;const x0=b.m.position.x;
  const n=Math.round(o.T*SIM.hz);
  for(let i=0;i<n;i++){
   const t=i/SIM.hz;
   if(t>o.run)lift(DN);
   step(1);
   if(hit==null&&Math.hypot(b.v.x,b.v.z)>1)hit=+t.toFixed(2);
   if(Math.hypot(b.v.x,b.v.z)>vm){vm=Math.hypot(b.v.x,b.v.z);vx=b.v.x*dir;vz=b.v.z;}
   const p=b.m.position;
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ang=${(r.angle*dir).toFixed(2)} sq=${r.sqA==null?'-':(r.sqA*dir).toFixed(2)} off=${r.offset.toFixed(2)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)} y=${p.y.toFixed(2)}`);}
  }
  const p=b.m.position,v=b.v,out={ang:+a0.toFixed(2),hitAngle:ha==null?null:+ha.toFixed(2),hit,vx:+vx.toFixed(1),vz:+vz.toFixed(1),drift:+((p.x-x0)*dir).toFixed(2),deg:+(Math.atan2(vx,Math.abs(vz))*180/Math.PI).toFixed(1),y:+p.y.toFixed(2)};
  lift(FIN);lift(DN);
  if(o.trace)out.L=L;
  return out;
 }
 function paSquareGrid(o){
  o=Object.assign({ris:[5,3,1],Rs:[-3.5,-3,-2.5,-2,-1.5,-1,1,2,3,3.5]},o||{});
  const res={};
  for(const mode of ['old','new']){
   const rows={};
   for(const ri of o.ris){
    rows[NAME[ri]]=o.Rs.map(R=>{const a=paSquare({ri,R,old:mode==='old'});return `R${R}: ang ${a.ang} -> ${a.hit==null?'no hit':`peak ${a.vz} along ${a.vx} fwd (${a.deg} deg), drift ${a.drift}`}`;});
   }
   res[mode]=rows;
  }
  return res;
 }
 // --- a ball rolled at a rod already posed (the tutorial's PIN lesson): finesse + raise held, the ball from ahead at v, dz off the man ---
 function paRoll(o){return wrap(()=>old(o&&o.old,()=>roll(o)));}
 function roll(o){
  o=Object.assign({ri:5,from:13.5,v:17,dz:0,T:2.5,seed:1,fwd:false},o||{});
  const man=o.man!=null?o.man:MAN[o.ri];
  const {r}=setup(o),dir=r.kickDir;
  keys[FIN]=true;step(2);
  press(o.fwd?KICK_K:RZ);
  step(Math.round(0.3*SIM.hz));
  const b=ballAt(r,man,o.from,o.dz);b.v.set(-dir*o.v*Math.sign(o.from),0,0);
  let tPin=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){step(1);if(tPin==null&&r.pinB===b)tPin=+(i/SIM.hz).toFixed(2);}
  const p=b.m.position,out={pinned:r.pinB===b,tPin,rel:+((p.x-r.x)*dir).toFixed(2),dz:+(p.z-(r.baseZ[man]+r.offset)).toFixed(2),v:+Math.hypot(b.v.x,b.v.z).toFixed(1)};
  lift(FIN);lift(RZ);lift(KICK_K);
  return out;
 }
 function paRollGrid(o){
  o=Object.assign({ris:[5,3,1],vs:[6,10,17,25],dzs:[0,0.6,1.2]},o||{});
  const res={};
  for(const mode of ['old','new']){
   let ok=0,n=0;const rows={};
   for(const ri of o.ris)for(const v of o.vs){let line='';for(const dz of o.dzs){const a=paRoll({ri,v,dz,old:mode==='old'});n++;if(a.pinned)ok++;line+=a.pinned?'P':'.';}rows[NAME[ri]+' v='+v]=line;}
   res[mode]={pinned:ok+'/'+n,rows};
  }
  res.key='one cell per dz '+JSON.stringify(o.dzs);
  return res;
 }
 window.paRoll=paRoll;window.paRollGrid=paRollGrid;
 function paAll(){return {back:paKbdGrid({fwd:false}),fwd:paKbdGrid({fwd:true}),stick:paStickGrid(),square:paSquareGrid()};}
 window.paKbd=paKbd;window.paKbdGrid=paKbdGrid;window.paStick=paStick;window.paStickGrid=paStickGrid;window.paSquare=paSquare;window.paSquareGrid=paSquareGrid;window.paAll=paAll;
})();
