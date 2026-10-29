// The human's receive: a ball passed up the table into a forward pin (finesse + kick held). Run from a terminal:
//      node tools/page-run.js tools/fwdrecv-soak.js "frAll()"
//      frLined({ri:3,vs:[25,45,80],dzs:[0,3,6]})   // the seat holds the receiving rod posed, a ball from behind on lane + dz (the man starts on the lane): pinned / through / loose
//      frPass({fin:0.1,man:0,mo:3})                // the seat holds the red DEF: a plain kick up the table, kick held, finesse pressed `fin` s later (null = never), auto-switch on; who pins it
//      frPass({mode:'stroke',fin:0.15})            // finesse + a tapped kick (the stroke), kick pressed again and held `fin` s later (fin null: finesse simply kept held)
//      frPass({mode:'pinshot'|'pintap'})           // finesse + raise pins a ball behind the DEF, then the pin shot with kick held after it (a pass) or tapped (a shot); 'held' = finesse, then kick held on a loose ball
//      frGrid({mode:'kick'})                       // frPass over DEF man x MID start offset x finesse delay, tallied
// why: lined up, the forward pose pins a ball from behind at 25-120 u/s; in play it was the pose and the man that were missing on the rod the ball goes to
// the other team's men are off the table; the shot step runs every 2 sim steps (a 60 fps frame) like main.js
'use strict';
(function(){
 const FIX=1/SIM.hz,FIN='ControlRight',KICK_K='Space';
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 let st=0;
 function step(n,ai){for(let i=0;i<n;i++){if((st++)%2===0)shotSeatsUpdate(2*FIX);if(ai)aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}}
 function press(c){keys[c]=true;bindPress(c);}
 function lift(c){keys[c]=false;bindRelease(c);}
 function setup(seed,ri,keep){
  S.seedNext=seed;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  if(typeof NAV!=='undefined')NAV.root=null;
  for(const k of Object.keys(keys))keys[k]=false;
  const s=S.seats[0],si=s.rods.indexOf(rods[ri]);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.iPrevOff=0;q.pivot.position.z=0;q.aiErrT=1e9;q.rvUntil=0;q.rvReady=false;q.rvCd=0;});
  for(const q of rods)if(keep.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  S.lastSwitch=-9;st=0;
  return s;
 }
 // the seat holds rod ri posed forward; a ball from `dist` behind at v on its man's lane + dz
 function frLined(o){
  o=Object.assign({ri:3,man:2,vs:[15,25,45,80,110],dzs:[0,1.5,3,4.5,6,-3,-6],dist:24,T:1.6,seed:1,align:true},o||{});
  const R=SHOT.pin.assist.recv||{},keep=R.on,out={},tot={};
  const a0=cfg.auto;cfg.auto=false;R.on=o.align;
  try{
   for(const v of o.vs){const row=[];
    for(const dz of o.dzs){
     setup(o.seed,o.ri,[rods[o.ri]]);
     const r=rods[o.ri],dir=r.kickDir,lane=r.baseZ[o.man];
     keys[FIN]=true;step(3);press(KICK_K);step(Math.round(0.4*SIM.hz));
     const b=makeBall('classic');b.m.position.set(r.x-dir*o.dist,BALL_R,clamp(lane+dz,-F.W/2+BALL_R,F.W/2-BALL_R));b.v.set(dir*v,0,0);syncBall(b);
     let res='loose';
     for(let i=0;i<Math.round(o.T*SIM.hz);i++){
      step(1);
      const rel=(b.m.position.x-r.x)*dir;
      if(r.pinB){res='pin';break;}
      if(rel>8&&b.v.x*dir>2){res='thru';break;}
      if(rel<-8&&b.v.x*dir<-2){res='back';break;}
     }
     lift(FIN);lift(KICK_K);
     tot[res]=(tot[res]||0)+1;row.push(res[0]+(res==='pin'?'':((b.m.position.x-r.x)*dir).toFixed(1)));
    }
    out['v'+v]=row.join(' ');
   }
  }finally{cfg.auto=a0;R.on=keep;}
  out.tot=tot;return out;
 }
 // the seat holds `from`: a plain kick (or the stroke) up the table, finesse + kick then held; auto-switch on, the team's other rods are the AI's
 function frPass(o){
  o=Object.assign({from:1,to:3,man:0,dz:0,mo:0,fin:0.1,mode:'kick',R:null,T:2.0,seed:1,auto:true,trace:false},o||{});   // mode held: finesse first, then kick pressed and held, neither let go; pinshot: finesse + raise pins a ball behind, then kick (the pin shot) held
  const a0=cfg.auto;cfg.auto=o.auto;
  try{
   const s=setup(o.seed,o.from,rods.filter(q=>q.team===0));
   const fr=rods[o.from],to=rods[o.to],dir=fr.kickDir;
   to.offset=to.target=to.prevOffset=to.iPrevOff=clamp(o.mo,-to.maxOff,to.maxOff);to.pivot.position.z=to.offset;
   step(30,true);
   const pin=o.mode==='pinshot'||o.mode==='pintap',b=makeBall('classic'),bz=fr.baseZ[o.man]+fr.offset+(pin?Math.sign(o.dz||1)*3.5:o.dz);   // the back pin: the ball beside the man (clear of the foot, inside the assist's reach), so the leg goes up and the settle brings him over it
   b.m.position.set(fr.x+dir*(o.R!=null?o.R:o.mode==='stroke'?3:pin?-3.6:1.6),BALL_R,bz);b.v.set(0,0,0);syncBall(b);S.lastTouch=0;
   step(6,true);
   const t0=S.time,L=[];let finT=null,khT=null,res=null,who=null,held=null,tPin=null,vMax=0;
   if(o.mode==='stroke'){keys[FIN]=true;step(4,true);press(KICK_K);step(Math.round(0.08*SIM.hz),true);lift(KICK_K);}
   else if(o.mode==='held'){keys[FIN]=true;step(4,true);press(KICK_K);}
   else if(pin){keys[FIN]=true;step(4,true);press('ShiftLeft');for(let k=0;k<240&&!fr.pinB;k++)step(1,true);lift('ShiftLeft');step(4,true);if(!fr.pinB)return {res:'nopin'};
    press(KICK_K);if(o.mode==='pintap'){step(Math.round(0.08*SIM.hz),true);lift(KICK_K);}}   // the pin shot: kick held after it (pinshot) or tapped (pintap), finesse held throughout
   else press(KICK_K);
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    const t=S.time-t0;
    if(o.fin!=null&&finT==null&&t>=o.fin){finT=t;if(o.mode==='stroke'){press(KICK_K);khT=t;}else keys[FIN]=true;}
    step(1,true);
    const p=b.m.position;vMax=Math.max(vMax,b.v.x*dir);
    if(o.trace&&(i%3===0)&&L.length<120)L.push(`${t.toFixed(3)} x=${p.x.toFixed(1)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)} | ${rods.filter(q=>q.team===0).map(q=>(q===seatRod(s)?'*':'')+q.role+':'+(q.act||'-')+' a'+(q.angle*dir).toFixed(2)+' o'+q.offset.toFixed(1)+(q.pinPose?' P':'')+(q.pinB?' PIN':'')).join(' ')}`);
    for(const q of rods)if(q.pinB===b&&q!==fr){res='pin';who=q.role;held=seatRod(s)===q?'human':'ai';tPin=+t.toFixed(2);break;}
    if(res)break;
    const rel=(p.x-to.x)*dir;
    if(rel>8&&b.v.x*dir>2&&!res){res='thru';}
    if(res||S.phase!=='play'||b.scored){res=res||(b.scored?'goal':'phase');break;}
   }
   if(!res)res=(b.v.length()<2?'loose':'moving');
   return {res,who,held,tPin,finT,vMax:+vMax.toFixed(0),rod:seatRod(s).role,rel:+((b.m.position.x-to.x)*dir).toFixed(1),L};
  }finally{cfg.auto=a0;lift(FIN);lift(KICK_K);}
 }
 function frGrid(o){
  o=Object.assign({mode:'kick',mans:[0,1],dzs:[-0.8,0.8],mos:[-6,-2,2,6],fins:[null,0.05,0.15,0.25],R:null,seed:1},o||{});
  const out={};
  for(const fin of o.fins){const t={};
   for(const man of o.mans)for(const dz of o.dzs)for(const mo of o.mos){
    const a=frPass({mode:o.mode,man,dz,mo,fin,R:o.R,seed:o.seed});
    const k=a.res==='pin'?'pin:'+a.who+':'+a.held:a.res;t[k]=(t[k]||0)+1;
   }
   out['fin '+fin]=t;
  }
  return out;
 }
 function frAll(){return {lined:frLined(),kick:frGrid({mode:'kick'}),stroke:frGrid({mode:'stroke',fins:[null,0.15,0.3]})};}
 window.frLined=frLined;window.frPass=frPass;window.frGrid=frGrid;window.frAll=frAll;
})();
