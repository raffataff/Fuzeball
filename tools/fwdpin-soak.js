// Forward-pin scenes. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/fwdpin-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      fpScene({ri:5,man:1,s:1,mode:'tap',trace:true})   // a ball rolled into a rod posed forward (the receiving pose) and pinned; a tap forced to the next man, or the shot an open goal asks for
//      fpTapGrid()                                       // every man of the ATT / MID / DEF, both ways: how many taps end in a pin by the next man
//      fpShotGrid()                                      // every man, an open goal: when the first swing comes, and as what (pin shot / pass / plain)
//      fpTry('lift off',()=>{AIC.catch.recv.lift.on=false;},()=>fpTapGrid())   // any of the above with CONFIG overridden, restored after
//      fpWatch({seeds:12,diff:'legend'})                 // whole matches: every ball held under a forward leg, how it arrived (how), how long, how far it was carried, how often the carry turned round, how it left
// why: a ball held under a forward leg is flush against it and behind the boot; this drives the real aiUpdate / tapStart / catchStep / retrieve / physics to see how it leaves (CONFIG.ai.catch.recv.lift)
// tap out: ok (the neighbour pinned it) | back-ok (its lane shut and the man it came from pinned it again) | wrongman | through (rolled on past) | lost (never pinned) | nopin (the ball never took); shot: t = first swing, style = what it was
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function fpScene(o){
  o=Object.assign({ri:5,man:1,s:1,T:3.5,seed:1,iq:true,trace:false,every:0.1,ang:0.4,mode:'tap',block:[],vx:25,from:-6,dz:0},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;r.bkRev=false;r.rvUntil=0;r.rvReady=false;});
  const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic'),held=o.block.map(k=>rods[k.ri]);r.aiErrT=1e9;r.aiIQ=o.iq;
  for(const q of rods)if(q!==r&&held.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  o.block.forEach(k=>{const q=rods[k.ri];q.aiErrT=1e9;q.offset=k.off;q.target=k.off;q.prevOffset=k.off;q.pivot.position.z=k.off;});
  b.m.position.set(r.x+o.from*dir,BALL_R,r.baseZ[o.man]+o.dz);b.v.set(o.vx*dir,0,0);syncBall(b);
  for(let i=0;i<Math.round(2*SIM.hz)&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinA=o.ang*dir;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
  if(!r.pinB)return {out:'nopin',rel:+((b.m.position.x-r.x)*dir).toFixed(2)};
  const rel0=r.pinB.pinDx;
  r.act='catch';r.catPh='hold';r.catT=0;r.tapN=0;pinPlayStart(r);
  if(o.mode==='tap'){r.tapPk={j:o.man+o.s,s:o.s,out:9};tapStart(r);}
  const L=[];let nt=0,tPin=null,pinMan=-1,fire=null,tLift=null,tSide=null,tBack=null;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   const pk=r.kickT>=0;
   aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
   const t=i/SIM.hz,p=b.m.position,rel=(p.x-r.x)*dir;
   if(tLift==null&&r.catPh==='flift')tLift=+t.toFixed(2);
   if(tSide==null&&r.catPh==='side')tSide=+t.toFixed(2);
   if(tBack==null&&r.catPh==='back')tBack=+t.toFixed(2);
   if(tPin==null&&tSide!=null&&r.pinB&&r.catPh==='hold'){tPin=+t.toFixed(2);pinMan=r.pinB.pinMan;}
   if(!pk&&r.kickT>=0&&!fire)fire={t:+t.toFixed(2),style:r.kickStyle||'plain',rel:+rel.toFixed(2)};
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ${r.act||'-'}/${r.catPh||'-'}${r.retPh?'/'+r.retPh:''} ang=${(r.angle*dir).toFixed(2)} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} pin=${r.pinB?1:0}${r.kickT>=0?' K:'+(r.kickStyle||'plain'):''} | ball rel=${rel.toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(o.mode==='tap'&&tPin!=null&&t>tPin+0.3)break;
   if(S.phase!=='play'||b.scored)break;
  }
  const p=b.m.position,want=o.man+o.s;
  let out;
  if(o.mode==='tap')out=tPin!=null?(tBack!=null?'back-':'')+(pinMan===(tBack!=null?o.man:want)?'ok':'wrongman'):(tBack!=null?'back-lost':Math.abs(b.v.z)>2?'through':'lost');
  else out=fire?fire.style:'none';
  return {out,pinRel:+rel0.toFixed(2),tLift,tSide,tBack,tPin,pinMan,fire,end:{rel:+((p.x-r.x)*dir).toFixed(1),z:+p.z.toFixed(1),v:+b.v.length().toFixed(1),scored:!!b.scored},L};
 }
 // every man, both ways, on each rod: a tap forced from the forward pin
 function fpTapGrid(o){
  o=Object.assign({diffs:['rookie','pro','legend'],ang:0.4},o||{});
  const rows={},d0=[cfg.diffRed,cfg.diffBlue];
  try{for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;
   for(const [nm,ri] of [['ATT',5],['MID',3],['DEF',1]]){const n=rods[ri].baseZ.length,t={};
    for(let man=0;man<n;man++)for(const s of [-1,1]){const j=man+s;if(j<0||j>=n)continue;const a=fpScene({ri,man,s,ang:o.ang,mode:'tap',T:4});t[a.out]=(t[a.out]||0)+1;}
    rows[d+' '+nm]=JSON.stringify(t);}}}
  finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];}
  return rows;
 }
 // an open goal: the AI has a shot from a forward pin; when does the first swing come, and as what
 function fpShotGrid(o){
  o=Object.assign({diffs:['pro','legend'],ang:0.4,T:4},o||{});
  const rows={},d0=[cfg.diffRed,cfg.diffBlue];
  try{for(const d of o.diffs){cfg.diffRed=d;cfg.diffBlue=d;const res=[];
   for(const [nm,ri] of [['ATT',5],['MID',3],['DEF',1]])for(let man=0;man<rods[ri].baseZ.length;man++){const a=fpScene({ri,man,ang:o.ang,mode:'shot',T:o.T});res.push(nm+man+':'+(a.fire?a.fire.t+' '+a.fire.style:'none')+(a.end.scored?' G':''));}
   const st={};for(const x of res){const k=(x.split(' ')[1]||'none');st[k]=(st[k]||0)+1;}
   rows[d]={styles:JSON.stringify(st),each:res.join(' | ')};}}
  finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];}
  return rows;
 }
 // run fn with CONFIG overridden by set(), restored after
 function fpTry(name,set,fn){
  const keep=JSON.parse(JSON.stringify({recv:AIC.catch.recv,tap:AIC.catch.tap}));
  try{set();return {name,res:fn()};}
  finally{Object.assign(AIC.catch.recv,keep.recv);Object.assign(AIC.catch.tap,keep.tap);Object.assign(AIC.catch.recv.lift,keep.recv.lift);Object.assign(AIC.catch.recv.tap,keep.recv.tap);}
 }
 // whole AI-vs-AI matches: every ball held under a forward leg: how it arrived, how long it was held, how far it was carried, how often the carry turned round, how it left
 function fpWatch(o){
  o=Object.assign({seeds:12,secs:120,diff:'legend',seed0:1},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  const wh=Au.whistle;Au.whistle=function(){};
  const H=[],open=new Map();let nm=0,steps=0,pose=0;
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();open.clear();
    for(let i=0;i<o.secs*SIM.hz;i++){
     if(S.phase!=='play'){open.clear();S.phase='count';serve();}
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);steps++;
     let any=false;
     for(const r of rods){
      const fwd=r.angle*r.kickDir>AIC.catch.recv.fwdMin&&r.kickT<0,holding=!!r.pinB&&fwd;
      if(fwd&&r.act==='recv')any=true;
      let h=open.get(r);
      if(holding&&!h){const z=r.pinB.m.position.z;h={t:0,hold:0,lo:z,hi:z,role:r.role,how:r.catPh||'?',dir:0,flips:0};open.set(r,h);}
      if(h){
       if(holding){h.t+=1/SIM.hz;if(r.catPh==='hold'){h.hold+=1/SIM.hz;const z=r.pinB.m.position.z;h.lo=Math.min(h.lo,z);h.hi=Math.max(h.hi,z);const d=Math.abs(r.slideV)>5?Math.sign(r.slideV):0;if(d&&h.dir&&d!==h.dir)h.flips++;if(d)h.dir=d;}}
       else{h.exit=r.catPh==='flift'?'lift>'+r.flNext:r.catPh==='tap'?'tap':r.act==='retrieve'?'retrieve':'other';H.push(h);open.delete(r);}
      }
     }
     if(any)pose++;
    }
    nm++;
   }
  }finally{Au.whistle=wh;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];}
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return a.length?+a[a.length>>1].toFixed(2):null;},cnt=k=>H.reduce((a,h)=>(a[h[k]]=(a[h[k]]||0)+1,a),{});
  const car=H.filter(h=>h.hi-h.lo>2);
  return {diff:o.diff,matches:nm,poseShare:+(pose/steps).toFixed(3),holdsPerMatch:+(H.length/nm).toFixed(2),how:cnt('how'),exits:cnt('exit'),roles:cnt('role'),heldSecs:{median:med(H.map(h=>h.t)),max:H.length?+Math.max(...H.map(h=>h.t)).toFixed(2):0},carried:car.length,carryDist:{median:med(car.map(h=>h.hi-h.lo)),max:car.length?+Math.max(...car.map(h=>h.hi-h.lo)).toFixed(1):0},turnRoundsPerHold:+(H.reduce((a,h)=>a+h.flips,0)/Math.max(1,H.length)).toFixed(2),lanesTurned:H.filter(h=>h.flips>=2).length};
 }
 window.fpScene=fpScene;window.fpTapGrid=fpTapGrid;window.fpShotGrid=fpShotGrid;window.fpTry=fpTry;window.fpWatch=fpWatch;
})();
