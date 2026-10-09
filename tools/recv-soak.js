// Receiving-a-pass scene. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/recv-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      rvScene({n:200,seed:11})                       // a red DEF passes to the red MID with nothing in the way: how many end pinned, by the heading the pass was asked for
//      rvScene({n:200,ready:false})                   // the mate not made ready before the pass (CONFIG.ai.catch.recv.ready)
//      rvScene({n:300,maxTh:10,keep:5,trace:true})    // only passes asked within maxTh deg of straight, the first `keep` failures with the steps around the contact
// why: 'does the rod a pass is aimed at pin it' is a controlled question; in matches the other team intercepts, the lane shuts and the swing misses, which hides the receiving mechanics
// the DEF is driven by hand (isUserRod stub), the other team's men are removed, the mate starts anywhere on its slide; a row is {pin, z0, tz, mo, th}
// trace columns: t, ball rel to the rod, ball z, ball vx (toward the rod's goal), vz, y, the rod's action, angle, offset, slide, pinOn, pinPose, pinB, z gap to the nearest man
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function rvScene(o){
  o=Object.assign({n:120,ready:true,seed:5,ri:1,mi:3,wait:0.6,T:1.6,diff:'pro',hide:true,maxTh:90,trace:false,keep:5},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue,window.isUserRod];cfg.diffRed=cfg.diffBlue=o.diff;
  let s=o.seed>>>0;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const R={n:0,pin:0,rows:[],fails:[]};
  try{
   for(let k=0;k<o.n;k++){
    S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
    const def=rods[o.ri],mid=rods[o.mi],dir=def.kickDir;
    rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.rvUntil=0;r.rvReady=false;r.rvCd=0;r.offset=0;r.target=0;r.prevOffset=0;r.iPrevOff=0;r.slideV=0;r.vz=0;});
    if(o.hide)for(const q of rods)if(q.team!==def.team)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
    window.isUserRod=r=>r===def;
    const mi=Math.floor(rnd()*def.baseZ.length),bz=def.baseZ[mi]+(rnd()*2-1)*2;
    const mj=Math.floor(rnd()*mid.baseZ.length),mo=(rnd()*2-1)*mid.maxOff;mid.offset=mo;mid.target=mo;mid.prevOffset=mo;mid.iPrevOff=mo;
    const b=makeBall('classic');b.m.position.set(def.x+dir*2.2,BALL_R,bz);b.v.set(0,0,0);syncBall(b);
    if(o.ready){
     const wn=Math.round(o.wait*SIM.hz);
     for(let i=0;i<wn;i++){recvReady(def,[{rod:mid,man:mj,z:mid.baseZ[mj]+mid.offset,score:5}]);aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
    }
    const tz=mid.baseZ[mj]+mid.offset,th=Math.atan2(tz-bz,Math.abs(mid.x-def.x))*57.3;
    if(Math.abs(th)>=o.maxTh)continue;
    kickRod(def,'pass',{x:mid.x,z:tz});
    let pin=false;const tr=[];
    for(let i=0;i<Math.round(o.T*SIM.hz);i++){
     aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
     const rel=(b.m.position.x-mid.x)*dir;
     if(o.trace&&rel>-8&&rel<3&&tr.length<200)tr.push([+(i/SIM.hz).toFixed(2),+rel.toFixed(2),+b.m.position.z.toFixed(1),+(b.v.x*dir).toFixed(1),+b.v.z.toFixed(1),+b.m.position.y.toFixed(2),mid.act||'-',+(mid.angle*dir).toFixed(2),+mid.offset.toFixed(1),+mid.slideV.toFixed(1),mid.pinOn?1:0,mid.pinPose?1:0,mid.pinB?1:0,+(mid.baseZ.map(z=>Math.abs(z+mid.offset-b.m.position.z)).reduce((a,c)=>Math.min(a,c),99)).toFixed(1)]);
     if(mid.pinB){pin=true;break;}
     if(S.phase!=='play')break;
    }
    R.n++;if(pin)R.pin++;
    R.rows.push({pin,z0:+bz.toFixed(1),tz:+tz.toFixed(1),mo:+mo.toFixed(1),th:+th.toFixed(0)});
    if(o.trace&&!pin&&R.fails.length<o.keep)R.fails.push({th:+th.toFixed(0),tz:+tz.toFixed(1),bz:+bz.toFixed(1),tr});
   }
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];window.isUserRod=keep[2];}
  R.rate=+(R.pin/Math.max(1,R.n)).toFixed(2);
  const bins=[10,20,30,45,90],by={};
  for(const r of R.rows){const a=Math.abs(r.th),k=bins.findIndex(e=>a<e),key=(k?bins[k-1]:0)+'-'+bins[k],q=by[key]||(by[key]={n:0,pin:0});q.n++;if(r.pin)q.pin++;}
  R.byHeading=Object.fromEntries(Object.entries(by).map(([k,q])=>[k,q.pin+'/'+q.n]));
  return R;
 }
 // a ball let go at speed v toward a ready rod from behind, nothing else on the table: pinned within T s?  rvFast({v:80,n:60,ri:3})
 // lat = the ball's sideways speed (u/s, either way), dz = how far off the nearest man's centre line it is aimed (+-)
 function rvFast(o){
  o=Object.assign({n:60,v:60,ri:3,seed:5,lat:6,dz:2.5,T:1.5,diff:'pro',from:1,dist:18},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue,window.isUserRod];cfg.diffRed=cfg.diffBlue=o.diff;
  let s=o.seed>>>0;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const R={n:o.n,v:o.v,pin:0,thru:0,back:0};
  try{
   for(let k=0;k<o.n;k++){
    S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
    const mid=rods[o.ri],src=rods[o.from],dir=mid.kickDir;
    rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.rvUntil=0;r.rvReady=false;r.rvCd=0;r.offset=0;r.target=0;r.prevOffset=0;r.iPrevOff=0;r.slideV=0;r.vz=0;});
    for(const q of rods)if(q.team!==mid.team)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
    window.isUserRod=r=>r===src;
    const mj=Math.floor(rnd()*mid.baseZ.length),mo=(rnd()*2-1)*mid.maxOff;mid.offset=mo;mid.target=mo;mid.prevOffset=mo;mid.iPrevOff=mo;
    const lane=mid.baseZ[mj]+mid.offset;
    S.lastTouch=mid.team;
    const wn=Math.round(0.6*SIM.hz);
    for(let i=0;i<wn;i++){recvReady(src,[{rod:mid,man:mj,z:lane,score:5}]);aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
    const bz=clamp(lane+(rnd()*2-1)*o.dz,-F.W/2+4,F.W/2-4);
    const b=makeBall('classic');b.m.position.set(mid.x-dir*o.dist,BALL_R,bz);b.v.set(dir*o.v,0,(rnd()*2-1)*o.lat);syncBall(b);S.lastTouch=mid.team;
    let pin=false,thru=false;
    for(let i=0;i<Math.round(o.T*SIM.hz);i++){
     recvReady(src,[{rod:mid,man:mj,z:lane,score:5}]);
     aiUpdate(FIX);userControlUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
     if(mid.pinB){pin=true;break;}
     if((b.m.position.x-mid.x)*dir>4&&b.v.x*dir>5){thru=true;break;}
     if(S.phase!=='play')break;
    }
    if(pin)R.pin++;else if(thru)R.thru++;else R.back++;
   }
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];window.isUserRod=keep[2];}
  R.rate=+(R.pin/Math.max(1,R.n)).toFixed(2);
  return R;
 }
 window.rvScene=rvScene;window.rvFast=rvFast;
})();
