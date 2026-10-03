// Pin-shot soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/pinshot-soak.js').then(r=>r.text()).then(eval)
//      psSweep({})                                  // catch a ball at a spread of spots, fire the pin shot, tally the exit speed
//      psScene({rel:0.9,dz:0.3,trace:1})            // one hand-placed shot with a line per sim step
//      psTry({'ai.trapShot.windupA':-1.0},{})       // run a sweep with CONFIG values overridden, restored after
// why: the pin shot's weight is a product of the swing curve (CONFIG.ai.trapShot), the pin trim (CONFIG.shots.pin.pow) and the speed ceiling (CONFIG.kick.cap); this fires the REAL pin on the real sim and reports what the ball leaves at
// modes: 'human' fires shotPinFire (armed, aim-assisted); 'ai' fires the bare trapShot swing; 'kick' a plain tap kick, 'hard' a full-power-trigger kick and 'charge' a sweet-band charged kick, all through shotFire off a resting ball in the sweet strip (the yardsticks)
// exit = horizontal speed 0.12 s after first contact (before a wall or the second boot touch muddies it); lift = highest the ball rose; numbers are u/s, a classic ball's ceiling is its maxV (130)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const P=()=>CONFIG.shots.pin;
 function psScene(o){
  o=Object.assign({ri:5,rel:0.9,dz:0.3,vx:0,mode:'human',T:0.5,settle:0.3,seed:1,trace:0,catchT:1.5,man:null,exitAt:0.12,charge:0.6},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  const r=rods[o.ri],dir=r.team===0?1:-1,pinned=o.mode==='human'||o.mode==='ai';
  r.offset=0;r.target=0;r.prevOffset=0;r.iPrevOff=0;r.slideV=0;r.vz=0;r.act=null;
  const mi=o.man!=null?Math.min(o.man,r.baseZ.length-1):r.baseZ.length>>1,mz=r.baseZ[mi];   // man: an index, default the centre man of the rod
  const b=makeBall('classic');b.m.position.set(r.x+o.rel*dir,BALL_R,mz+o.dz);b.v.set(pinned?o.vx*dir:0,0,0);syncBall(b);
  const step=()=>{updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);};
  const R={caught:true,rel:o.rel,dz:o.dz};
  if(pinned){
   r.pinOn=true;r.pinPose=true;r.pinA=P().angle*dir;r.angle=r.pinA;r.prevAngle=r.angle;
   let n=0;const nc=Math.round(o.catchT*SIM.hz);
   while(!r.pinB&&n<nc){step();n++;}
   R.caught=!!r.pinB;if(!r.pinB)return R;
   R.rel=+((b.m.position.x-r.x)*dir).toFixed(2);R.dz=+(b.m.position.z-(mz+r.offset)).toFixed(2);
   for(let i=0;i<Math.round(o.settle*SIM.hz);i++)step();
   if(o.mode==='human')shotPinFire(r);
   else{r.shotOn=false;r.shotPow=1;r.shotCtl=1;r.pinPose=false;kickRod(r,'trapShot');}
  }else{
   for(let i=0;i<Math.round(0.1*SIM.hz);i++)step();
   shotFire(r,o.mode==='hard'?1:0,o.mode==='charge'?o.charge:-1);
  }
  const N=Math.round(o.T*SIM.hz);let peak=0,tp=0,hit=-1,exit=null,lift=0,hd=null,L=[];
  for(let i=0;i<N;i++){
   const t=i/SIM.hz;step();
   if(r.kickHit&&hit<0)hit=t;
   if(hit>=0&&exit==null&&t>=hit+o.exitAt){
    const p=b.m.position;exit=Math.hypot(b.v.x,b.v.z);
    hd=(Math.atan2(b.v.z,b.v.x*dir)-Math.atan2(0-p.z,(dir*F.L/2-p.x)*dir))*180/Math.PI;
   }
   const sp=b.v.length();if(sp>peak){peak=sp;tp=t;}
   if(exit==null||t<=hit+o.exitAt+1e-9)lift=Math.max(lift,b.m.position.y-BALL_R);   // only up to the exit sample: after that the ball meets the next rod's men
   if(o.trace)L.push(`${t.toFixed(3)} ang=${(r.angle*dir).toFixed(2)} | ball rel=${((b.m.position.x-r.x)*dir).toFixed(2)} y=${b.m.position.y.toFixed(1)} z=${b.m.position.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.y.toFixed(1)},${b.v.z.toFixed(1)} |v|=${sp.toFixed(1)}`);
   if(S.phase!=='play')break;
  }
  if(exit==null)exit=Math.hypot(b.v.x,b.v.z);
  Object.assign(R,{hit:hit<0?null:+hit.toFixed(3),exit:+exit.toFixed(1),peak:+peak.toFixed(1),lift:+lift.toFixed(1),fwd:+(b.v.x*dir).toFixed(1),vz:+b.v.z.toFixed(1)});
  R.err=hd==null?null:+hd.toFixed(2);   // exit heading minus the straight line to the goal centre, degrees
  if(o.trace)R.log=L;
  return R;
 }
 // a spread of catch spots (rolled onto the rod from the front at a few speeds, a few z offsets, plus balls set down at fixed spots); a mean and a worst case per mode
 function psSweep(o){
  o=Object.assign({ri:5,modes:['human','ai'],speeds:[0,6,12],dzs:[-1.2,0,1.2],rels:[-2.5,-1,0.9],T:0.5,settle:0.3,rows:0,man:null,seeds:4,exitAt:0.12},o||{});
  const out={};
  // the swing meets the ball ~40 times and every touch jitters it (RNG.jit), so one seed is not a measurement: each spot runs over `seeds` seeds
  for(const mode of o.modes){
   const rows=[],pinned=mode==='human'||mode==='ai';
   for(let sd=1;sd<=o.seeds;sd++){
    const base={ri:o.ri,mode,T:o.T,settle:o.settle,man:o.man,seed:sd,exitAt:o.exitAt};
    if(pinned){
     for(const sp of o.speeds)for(const dz of o.dzs){const R=psScene(Object.assign({rel:0.9,dz,vx:-sp},base));R.sp=sp;rows.push(R);}
     for(const rel of o.rels)for(const dz of o.dzs){const R=psScene(Object.assign({rel,dz,vx:0},base));R.sp='set';rows.push(R);}
    }else for(const dz of o.dzs)rows.push(psScene(Object.assign({rel:2.2,dz},base)));
   }
   const ok=rows.filter(x=>x.caught),ex=ok.map(x=>x.exit),mean=ex.length?ex.reduce((a,c)=>a+c,0)/ex.length:0;
   const sdv=ex.length?Math.sqrt(ex.reduce((a,c)=>a+(c-mean)*(c-mean),0)/ex.length):0;
   out[mode]={n:rows.length,caught:ok.length,exit:+mean.toFixed(1),sd:+sdv.toFixed(1),min:ex.length?Math.min(...ex):0,max:ex.length?Math.max(...ex):0,
    lift:+Math.max(0,...ok.map(x=>x.lift)).toFixed(1),noHit:ok.filter(x=>x.hit==null).length,back:ok.filter(x=>x.fwd<x.exit*0.5).length};
   if(o.rows)out[mode].rows=rows;
  }
  return out;
 }
 // aim: the heading error of a human pin shot over `seeds` seeded shots from each man (the spray draws from the seed); degrees off the straight line to the goal centre
 function psAim(o){
  o=Object.assign({ri:5,men:[1,0,2],seeds:20,mode:'human'},o||{});   // men: indices into the rod's men (ATT has 3)
  const out={};
  for(const man of o.men){
   const e=[];for(let s=1;s<=o.seeds;s++){const R=psScene({ri:o.ri,rel:0.9,dz:0,mode:o.mode,man,seed:s,T:0.3});if(R.caught&&R.err!=null)e.push(R.err);}
   const n=e.length||1,mean=e.reduce((a,c)=>a+c,0)/n,sd=Math.sqrt(e.reduce((a,c)=>a+(c-mean)*(c-mean),0)/n);
   out['man'+man]={n:e.length,mean:+mean.toFixed(2),sd:+sd.toFixed(2),absMax:+Math.max(0,...e.map(Math.abs)).toFixed(2)};
  }
  return out;
 }
 // run fn with CONFIG paths overridden ('ai.trapShot.windupA':-1) and put them back
 function psWith(over,fn){
  const prev=[];
  for(const k of Object.keys(over)){
   const parts=k.split('.');let o=CONFIG;for(let i=0;i<parts.length-1;i++)o=o[parts[i]];
   const key=parts[parts.length-1];prev.push([o,key,o[key]]);o[key]=over[k];
  }
  try{return fn();}finally{for(const [o,key,v] of prev)o[key]=v;}
 }
 function psTry(over,o){return psWith(over||{},()=>psSweep(o));}
 window.psScene=psScene;window.psSweep=psSweep;window.psAim=psAim;window.psWith=psWith;window.psTry=psTry;
})();
