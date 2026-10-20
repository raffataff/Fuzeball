// Human forward pin in whole matches. Terminal: node tools/page-run.js tools/fwdhuman-match-soak.js "fhMatch({seeds:12,secs:120})"
// a red human seat that follows the ball with the held rod and, when a slow ball lies 2.5 to 4.5 ahead of it, makes the chord: finesse, then kick (the forward pin), slides over the ball, holds it a moment and lets finesse go
// all of it through the real input path (keys, bindPress, shotSeatsUpdate) with the AI playing the rest; tools/fwdhuman-soak.js has the single-ball scenes
// tallies: pins (a ball held under the forward leg), held (s), carried (z travelled), releases and what the ball did in the 0.8 s after (knocks = toward the player's own goal faster than knockV by anyone, ownKnocks = the last touch the player's own rod), goals for / against, whistles
'use strict';
(function(){
 const FIX=1/SIM.hz,FIN='ControlRight',KK='Space';
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const press=c=>{keys[c]=true;bindPress(c);},lift=c=>{keys[c]=false;bindRelease(c);};
 function fhMatch(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:'pro',knockV:8,chord:true,evT:3,logN:14,ring:0},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue,cfg.auto];cfg.diffRed=cfg.diffBlue=o.diff;cfg.auto=true;
  const T={matches:0,goalsFor:0,goalsAgainst:0,log:[],events:0,evOwn:0,evWorst:0,chords:0,pins:0,held:0,carried:0,releases:0,knocks:0,ownKnocks:0,worstOwn:0,strokes:0,passesCredited:0,whistles:0,swingsByHuman:0,viol:{userAct:0,pinnedNoFinesse:0}};
  const ring=[];
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('red');S.phase='count';S.countT=0;serve();
    for(const k of Object.keys(keys))keys[k]=false;
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.rvUntil=0;r.rvReady=false;});
    const n=Math.round(o.secs*SIM.hz);let st={ph:'idle',t:0,z0:0},ev=null,watch=null,s0=S.score[0],s1=S.score[1],ps0=0;
    S.stats&&(ps0=S.stats.passes[0]);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();for(const k of Object.keys(keys))keys[k]=false;st={ph:'idle',t:0,z0:0};}
     const b=S.balls[0];if(!b)break;
     const s=S.seats[0],u=s&&seatRod(s);
     if(u&&u.role!=='GK'&&b){
      const dir=u.kickDir,p=b.m.position,r0=(p.x-u.x)*dir;
      let mi=0,md=1e9;for(let k=0;k<u.baseZ.length;k++){const d=Math.abs(p.z-u.baseZ[k]-u.offset);if(d<md){md=d;mi=k;}}
      const goal=clamp(p.z-u.baseZ[mi],-u.maxOff,u.maxOff);
      if(st.ph==='idle'){
       u.target=goal;                                               // follows the ball
       if(u.kickT<0&&!u.pinB&&r0>2.5&&r0<4.5&&b.v.length()<4&&p.y<BALL_R+0.5&&md<5&&!ev){
        ev={r:u,t:0,own:0,dir:dir};T.events++;
        if(o.chord){press(FIN);press(KK);st={ph:'pose',t:0,z0:u.offset};T.chords++;}   // kick held: the pose lasts while it is
       }
      }else{
       st.t+=FIX;
       if(st.ph==='pose'){
        if(st.t<0.15){}else{const d=goal-u.target;u.target+=clamp(d,-12*FIX,12*FIX);}        // eases onto it
        if(u.pinB&&u.pinFwd){st.ph='hold';st.t=0;T.pins++;}
        else if(st.t>2.0||!u.pinPose){st.ph='drop';st.t=0;}
       }else if(st.ph==='hold'){
        T.held+=FIX;
        if(u.pinB)u.target=clamp(u.target+Math.sign(Math.sin(st.t*3))*20*FIX,-u.maxOff,u.maxOff);   // carries it a little
        if(st.t>0.7||!u.pinB){T.carried+=Math.abs(u.offset-st.z0);st.ph='drop';st.t=0;}
       }
       if(st.ph==='drop'){lift(FIN);lift(KK);T.releases++;watch={r:u,t:0,v:0,own:0,dir:u.kickDir};st={ph:'idle',t:0,z0:0};}
      }
     }else if(st.ph!=='idle'){lift(FIN);lift(KK);st={ph:'idle',t:0,z0:0};}
     const b0=S.balls[0],u0=S.seats[0]&&seatRod(S.seats[0]),pv=(b0&&u0)?-b0.v.x*u0.kickDir:0;
     if(o.ring&&b0&&u0){ring.push(`${S.time.toFixed(2)} ${u0.role} ang=${(u0.angle*u0.kickDir).toFixed(2)} off=${u0.offset.toFixed(1)} vz=${u0.vz.toFixed(0)} fwd=${u0.pinFwd?1:0} pose=${u0.pinPose?1:0} on=${u0.pinOn?1:0} pin=${u0.pinB?1:0} out=${u0.fwdOut?1:0} act=${u0.act||'-'} | ball x=${b0.m.position.x.toFixed(1)} rel=${((b0.m.position.x-u0.x)*u0.kickDir).toFixed(2)} z=${b0.m.position.z.toFixed(1)} y=${b0.m.position.y.toFixed(1)} v=${(b0.v.x*u0.kickDir).toFixed(1)},${b0.v.z.toFixed(1)} | man z ${u0.baseZ.map(z=>(z+u0.offset).toFixed(1)).join(',')}`);if(ring.length>o.ring)ring.shift();}
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);shotSeatsUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(ev){
      ev.t+=FIX;const bb=S.balls[0],c=bb&&bb.msc;
      if(bb){const v0=-bb.v.x*ev.dir,v=(c&&c.rod===ev.r&&S.time-c.t<=FIX*1.5&&bb===b0)?v0-pv:0;   // what this step's contact by the player's rod added toward its own goal
       if(v>o.knockV&&!ev.logged){
        ev.logged=true;const ur=ev.r,pp=bb.m.position,mz=ur.baseZ.reduce((a,z)=>Math.abs(pp.z-(z+ur.offset))<Math.abs(pp.z-a)?(z+ur.offset):a,1e9);
        if(o.ring&&!T.ringDump&&ur.fwdOut){T.ringDump=ring.slice();}
        if(T.log.length<o.logN)T.log.push({t:+ev.t.toFixed(2),ph:st.ph,angle:+(ur.angle*ur.kickDir).toFixed(2),fwd:ur.pinFwd?1:0,pose:ur.pinPose?1:0,out:ur.fwdOut?1:0,vzRod:+ur.vz.toFixed(0),rel:+((pp.x-ur.x)*ur.kickDir).toFixed(2),dz:+(pp.z-mz).toFixed(2),v:+v.toFixed(0),fin:keys[FIN]?1:0,role:ur.role,x:+pp.x.toFixed(1),bz:+pp.z.toFixed(1),bvx:+(bb.v.x*ur.kickDir).toFixed(0),bvz:+bb.v.z.toFixed(0),pv:+pv.toFixed(0),ct:c.team,csw:c.sw?1:0,gt:+(S.time).toFixed(1),score:S.score.join('-'),hold:S.balls.length});
       }
       if(v>ev.own)ev.own=v;}
      if(ev.t>=o.evT){if(ev.own>o.knockV){T.evOwn++;if(ev.own>T.evWorst)T.evWorst=+ev.own.toFixed(1);}ev=null;}
     }
     if(watch){
      watch.t+=FIX;const bb=S.balls[0];
      if(bb){
       const v=-bb.v.x*watch.dir,c=bb.msc;
       if(v>watch.v)watch.v=v;
       if(v>watch.own&&c&&c.rod===watch.r&&S.time-c.t<=FIX*3)watch.own=v;       // the ball is going toward the player's own goal and the last thing to touch it was the player's rod, a step ago
      }
      if(watch.t>=0.8){
       if(watch.v>o.knockV)T.knocks++;
       if(watch.own>o.knockV){T.ownKnocks++;if(watch.own>T.worstOwn)T.worstOwn=+watch.own.toFixed(1);}
       watch=null;
      }
     }
     for(const r of rods){
      if(!isUserRod(r))continue;
      if(r.act)T.viol.userAct++;
      if(r.pinB&&r.pinFwd&&!r.pinOn)T.viol.pinnedNoFinesse++;
     }
    }
    T.goalsFor+=S.score[0]-s0;T.goalsAgainst+=S.score[1]-s1;T.matches++;
    if(S.stats)T.passesCredited+=S.stats.passes[0]-ps0;
    lift(FIN);lift(KK);
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];cfg.auto=keep[2];for(const k of Object.keys(keys))keys[k]=false;}
  const m=Math.max(1,T.matches);
  return Object.assign(T,{chordsPerMatch:+(T.chords/m).toFixed(1),pinsPerMatch:+(T.pins/m).toFixed(1),meanHold:+(T.held/Math.max(1,T.pins)).toFixed(2),meanCarry:+(T.carried/Math.max(1,T.pins)).toFixed(1),
   ownKnockRate:+(T.ownKnocks/Math.max(1,T.releases)).toFixed(3),evOwnRate:+(T.evOwn/Math.max(1,T.events)).toFixed(3),goalsPerMatch:+((T.goalsFor+T.goalsAgainst)/m).toFixed(2)});
 }
 window.fhMatch=fhMatch;
})();
