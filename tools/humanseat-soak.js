// Human-seat soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/humanseat-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      hsSoak({seeds:12,secs:120})     // matches with one human seat on red: a plain player that tracks the ball with the held rod, passes and kicks, auto-switch on
// why: the AI's receiving / standing posture (CONFIG.ai.catch.recv) was only ever measured AI vs AI; a human seat changes who is armed, who is ready and who owns a rod
// invariants (any count above 0 is a bug): userAct = a held rod with an AI action set, userRecv = a held rod standing ready, userRdy = a held rod flagged ready by the posture,
//   userPose = a held rod posed by the AI (pinPose with no pin and no finesse)
// tallies: humanPass = passes the human made, armed = the mate's rod was armed for it, recv = that mate stood in the receiving action, pinned = it pinned the ball
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function hsSoak(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:'legend',every:1.2},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue,cfg.auto];cfg.diffRed=cfg.diffBlue=o.diff;cfg.auto=true;
  const T={m:0,goals:0,swaps:0,viol:{userAct:0,userRecv:0,userRdy:0,userPose:0},humanPass:0,humanKick:0,armed:0,recv:0,pinned:0,sample:null};
  const wh=Au.whistle;Au.whistle=function(){};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('red');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.rvUntil=0;r.rvReady=false;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1];let last=-9,prev=null,watch=[];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     const b=S.balls[0];if(!b)break;
     const s=S.seats[0],u=s&&seatRod(s);
     if(u!==prev){if(prev)T.swaps++;prev=u;}
     if(u&&u.kickT<0&&!u.pinB){   // the held rod follows the ball's z, and plays it when it is at the foot
      let mi=0,md=1e9;for(let k=0;k<u.baseZ.length;k++){const d=Math.abs(b.m.position.z-u.baseZ[k]-u.offset);if(d<md){md=d;mi=k;}}
      u.target=clamp(b.m.position.z-u.baseZ[mi],-u.maxOff,u.maxOff);
      const rel=(b.m.position.x-u.x)*u.kickDir;
      if(S.time-last>o.every&&rel>0.3&&rel<4&&md<1.2&&b.m.position.y<AIC.lowY&&u.role!=='GK'){
       const pk=shotPassPick(u,b.m.position.x,b.m.position.z);last=S.time;
       if(pk){kickRod(u,'pass',{x:pk.x,z:pk.z});T.humanPass++;const mate=pk.rod;watch.push({mate,t:S.time,armed:(mate.rvUntil||0)>S.time,recv:false,pinned:false});if((mate.rvUntil||0)>S.time)T.armed++;}
       else{kickRod(u,null);T.humanKick++;}
      }
     }
     if(i%2===0)shotSeatsUpdate(2*FIX);   // main.js runs the shot step once a frame, before the fixed steps: it is what drops a pose the AI left on a rod the seat took
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(const r of rods){
      if(!isUserRod(r))continue;
      if(r.act){T.viol.userAct++;if(!T.sample)T.sample={act:r.act,role:r.role,t:+S.time.toFixed(2)};}
      if(r.act==='recv')T.viol.userRecv++;
      if(r.rvReady)T.viol.userRdy++;
      if(r.pinPose&&!r.pinB&&!(r.pinOn))T.viol.userPose++;
     }
     for(let k=watch.length-1;k>=0;k--){
      const w=watch[k],d=S.time-w.t;
      if(w.mate.act==='recv'&&!w.recv){w.recv=true;T.recv++;}
      if(w.mate.pinB&&!w.pinned){w.pinned=true;T.pinned++;}
      if(d>2.5)watch.splice(k,1);
     }
    }
    T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];cfg.auto=keep[2];}
  return T;
 }
 window.hsSoak=hsSoak;
})();
