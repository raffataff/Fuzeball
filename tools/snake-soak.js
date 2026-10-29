// The snake shot on the real sim. Browser side (preview 'fuzeball') or from a terminal:
//      node tools/page-run.js tools/snake-soak.js "snAll()"
//      snScene({ri:5,R:3.5,dz:0,slide:0,gap:0.1,keep:[]})   // red human: finesse + kick poses the forward pin, the man slides onto a ball lying R ahead, kick let go, then kick pressed twice `gap` apart; keys go through bindPress / shotSeatsUpdate like a player's
//      snGrid()        // every depth of the forward pin x ATT / MID / DEF, the rod still: what leaves, how high, where it crosses the goal line
//      snSlide()       // the same with the rod sliding through the shot at each speed: the heading the slide gives
//      snKeeper()      // the ATT's snake against the blue keeper standing still at each z
//      snVsAI({diff})  // snake against pin shot from the ATT, the blue keeper and defender played by the AI: goals of shots fired
//      snShots({...})  // frames of the spin from the side: node tools/page-run.js tools/snake-soak.js "snShots()" > out.json, then node tools/fx-shots-save.js out.json <dir> snake
//      snCost()        // stamina: what one snake, one plain kick and one pin shot each bank on the rod
//      snTune({sets:[{spin:0.3,ease:1}],cap:0.3})   // snGrid's rows for each set of CONFIG.shots.snake overrides (restored after)
// a scene removes every other man from the table (keep = rods left on); set:{...} overrides CONFIG.shots.snake, cap overrides kick.cap.snake, for that scene only
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const FIN='ControlRight',KICK_K='Space',RZ='ShiftLeft';
 const NM={5:'ATT',3:'MID',1:'DEF'},DZ={5:7,3:4,1:7},MAN={5:1,3:2,1:1};
 function setup(o){
  S.seedNext=o.seed;startMatchNow('red');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  for(const k of Object.keys(keys))keys[k]=false;
  const s=S.seats[0],r=rods[o.ri];
  const si=s.rods.indexOf(r);if(si>=0)s.ctrl=si;
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;q.exert=0;});
  for(const q of rods){const on=q===r||o.keep.indexOf(q)>=0;for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=on?0:1e9;}
  return {s,r};
 }
 function step(n,ai){
  for(let i=0;i<n;i++){
   if(ai)aiUpdate(FIX);
   shotSeatsUpdate(FIX);userControlUpdate(FIX);
   for(const q of rods)if(q.hold0!=null){q.target=q.hold0;q.offset=q.hold0;q.angle=0;q.kickT=-1;q.act=null;}   // a kept rod stands still where it was put
   updateRods(FIX);physics(FIX);S.time+=FIX;
   for(const q of S.balls)q.cur.copy(q.m.position);
  }
 }
 function press(code){keys[code]=true;bindPress(code);}
 function lift(code){keys[code]=false;bindRelease(code);}
 // one frame from the side of the shooting man, a little in front of the rod (shots:{at:[s after the second press],w,h,side,up,back})
 function snFrame(o,r,b){
  const w=o.w||640,h=o.h||400,z=b.m.position.z,c=camera;
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);c.aspect=w/h;c.fov=o.fov||40;c.updateProjectionMatrix();
  c.position.set(r.x+(o.back||4)*r.kickDir,o.up||9,z+(o.side||30));c.lookAt(r.x+3*r.kickDir,4,z);
  renderer.render(scene,c);
  return renderer.domElement.toDataURL('image/png');
 }
 async function snShots(o){S.seedNext=1;startMatchNow('red');await new Promise(q=>setTimeout(q,3000));return snScene(Object.assign({ri:5,R:3.5,dz:0.01,man:1,shots:{at:[0,0.04,0.08,0.12,0.16,0.2,0.24,0.27,0.32,0.4]}},o||{}));}
 function snScene(o){
  const a0=cfg.auto,set=(o&&o.set)||{},cap=(o&&o.cap!=null)?o.cap:null,old={},cap0=KICK.cap.snake;cfg.auto=false;
  for(const k in set){old[k]=SHOT.snake[k];SHOT.snake[k]=set[k];}
  if(cap!=null)KICK.cap.snake=cap;
  try{return run(o);}finally{cfg.auto=a0;for(const q of rods)q.hold0=null;for(const k in old)SHOT.snake[k]=old[k];KICK.cap.snake=cap0;}
 }
 // pin the ball forward the way a player does (fwdhuman-soak's catch), then the snake (mode 'snake'), the pin shot from the back pin ('pinshot', for the yardstick), or a plain kick at a ball at the feet ('plain')
 function run(o){
  o=Object.assign({ri:5,R:3.5,dz:null,man:null,seed:1,mode:'snake',slide:0,gap:0.1,keep:[],kz:0,ai:false,diff:'pro',T:5,trace:false,every:0.02},o||{});
  if(o.dz==null)o.dz=DZ[o.ri];if(o.man==null)o.man=MAN[o.ri];
  const {s,r}=setup(o),dir=r.kickDir,b=makeBall('classic');
  if(!o.ai)for(const q of o.keep){q.hold0=clamp(o.kz,-q.maxOff,q.maxOff);}
  else{cfg.diffBlue=o.diff;}
  const mz=r.baseZ[o.man];
  const L=[],x0=dir*F.L/2;let nt=0,tPin=null,tFire=null,tHit=null,vMax=0,yMax=0,cross=null,preV=0,goal=false,wrapSeen=false,angMin=9,ex0=0,exAfter=null;
  let pressed=0,state='pin',angPrev=0,wMax=0,snk=false,hd0=null,blk=null,shi=0;const SH=[];
  if(o.mode==='plain'){b.m.position.set(r.x+2.4*dir,BALL_R,mz);b.v.set(0,0,0);syncBall(b);state='fire';}
  else if(o.mode==='pinshot'){b.m.position.set(r.x-3.6*dir,BALL_R,mz+o.dz);b.v.set(0,0,0);syncBall(b);keys[FIN]=true;step(3);press(RZ);}
  else{b.m.position.set(r.x+o.R*dir,BALL_R,mz+o.dz);b.v.set(0,0,0);syncBall(b);keys[FIN]=true;step(3);press(KICK_K);}
  const n=Math.round(o.T*SIM.hz);
  for(let i=0;i<n;i++){
   const t=i/SIM.hz;
   // onto the ball once the leg is up (forward) or back (pin shot), at a player's ease
   if(state==='pin'&&!r.pinB&&o.dz!==0&&Math.abs(r.angle)>0.8){const g=clamp(b.m.position.z-r.baseZ[o.man],-r.maxOff,r.maxOff);r.target+=clamp(g-r.target,-12*FIX,12*FIX);}
   if(state==='pin'&&r.pinB){if(tPin==null)tPin=t;if(t-tPin>0.25){if(o.mode==='snake')lift(KICK_K);state='wait';}}
   if(o.stop==='pin'&&state==='wait')return {pinned:true,r,b};   // held under the forward leg, finesse still down: for a look at the HUD
   if(state==='wait'&&t-tPin>0.35){state='fire';}
   if(state==='fire'&&tFire==null){
    ex0=r.exert||0;
    if(o.mode==='snake'){
     if(pressed===0){press(KICK_K);lift(KICK_K);pressed=1;state='gap';o._g=t;}
    }else{press(KICK_K);lift(KICK_K);tFire=t;}
   }
   if(state==='gap'&&t-o._g>=o.gap-1e-9){press(KICK_K);lift(KICK_K);pressed=2;state='snk';tFire=t;}
   const sliding=o.slide&&(state==='gap'||state==='wait'&&t-tPin>0.25||tFire!=null&&!r.kickHit&&t-tFire<0.4);   // the slide starts 0.1 s before the first press (the ball is carried) and runs to the strike
   if(sliding)r.target=clamp(r.target+o.slide*FIX,-r.maxOff,r.maxOff);
   step(1,o.ai);
   const p=b.m.position,sp=b.v.length(),ang=r.angle*dir;
   if(r.kickStyle==='snake')snk=true;
   if(tFire!=null){
    if(exAfter==null)exAfter=(r.exert||0)-ex0;
    if(tHit==null&&r.kickHit)tHit=t;
    if(tHit==null)preV=Math.max(preV,Math.hypot(b.v.x,b.v.z-r.vz));
    if(ang-angPrev<-Math.PI)wrapSeen=true;
    wMax=Math.max(wMax,r.angVel*dir);
    vMax=Math.max(vMax,sp);if(tHit!=null)yMax=Math.max(yMax,p.y);
    if(tHit!=null&&hd0==null&&t-tHit>=0.04)hd0=+(Math.atan2(b.v.z,b.v.x*dir)*57.3).toFixed(1);
    if(tHit!=null&&!blk&&b.msc&&b.msc.team!==r.team)blk=b.msc.role+'@'+(t-tFire).toFixed(2);
    if(cross==null&&p.x*dir>=F.L/2-BALL_R)cross={z:+p.z.toFixed(2),y:+p.y.toFixed(2),t:+(t-tFire).toFixed(3)};
   }
   angPrev=ang;
   if(o.trace&&tFire!=null&&t>=nt&&t-tFire<0.6){nt=t+o.every;L.push(`${(t-tFire).toFixed(3)} ang=${ang.toFixed(2)} w=${(r.angVel*dir).toFixed(1)} kT=${r.kickT.toFixed(3)} hit=${r.kickHit?1:0} off=${r.offset.toFixed(2)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} v=${(b.v.x*dir).toFixed(1)},${b.v.y.toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(o.shots&&tFire!=null&&shi<o.shots.at.length&&t-tFire>=o.shots.at[shi]-1e-9){SH.push(snFrame(o.shots,r,b));shi++;}
   if(b.scored){goal=true;break;}
   if(S.phase!=='play')break;
   if(tFire!=null&&t-tFire>1.2)break;
  }
  lift(FIN);lift(KICK_K);lift(RZ);
  const hd=b.v.x*dir>1?+(Math.atan2(b.v.z,b.v.x*dir)*57.3).toFixed(1):null;
  if(o.shots)return {shots:SH,info:{hit:tHit!=null?+(tHit-tFire).toFixed(3):null,v:+vMax.toFixed(1)}};
  return {pinned:tPin!=null,fired:tFire!=null,snake:snk,style:o.mode,hit:tHit!=null?+(tHit-tFire).toFixed(3):null,vMax:+vMax.toFixed(1),yMax:+yMax.toFixed(2),preV:+preV.toFixed(1),wMax:+wMax.toFixed(1),
   cross,goal,wrap:wrapSeen,hd0,blk,end:{ph:S.phase,x:+b.m.position.x.toFixed(1),y:+b.m.position.y.toFixed(1),z:+b.m.position.z.toFixed(1),t:+(S.time).toFixed(2)},exert:exAfter==null?null:+exAfter.toFixed(2),heading:hd,L};
 }
 function row(a){return a.fired?`hit@${a.hit} v ${a.vMax} y ${a.yMax} pre ${a.preV} w ${a.wMax} cross ${a.cross?a.cross.z+','+a.cross.y+' @'+a.cross.t:'-'} goal ${a.goal?1:0} wrap ${a.wrap?1:0}`:(a.pinned?'pinned, not fired':'no pin');}
 function snGrid(o){
  o=Object.assign({Rs:[2.5,3,3.5,4,4.5],ris:[5,3,1],set:{},cap:null},o||{});
  const rows={};
  for(const ri of o.ris)for(const R of o.Rs)rows[NM[ri]+' R='+R]=row(snScene({ri,R,set:o.set,cap:o.cap}));
  return rows;
 }
 function snTune(o){
  o=Object.assign({sets:[{}],cap:null,Rs:[2.5,3.5,4.5],ris:[5]},o||{});
  const out={};
  for(const st of o.sets)out[JSON.stringify(st)+(o.cap!=null?' cap '+o.cap:'')]=snGrid({Rs:o.Rs,ris:o.ris,set:st,cap:o.cap});
  return out;
 }
 // the man starts 6 off the centre man's z on the side away from the slide, so the rod has room to run
 function snSlide(o){
  o=Object.assign({ri:5,R:3.5,vs:[-40,-30,-20,-10,0,10,20,30,40],gap:0.06},o||{});
  const rows={};
  for(const v of o.vs){const a=snScene({ri:o.ri,R:o.R,slide:v,dz:v>0?-6:6,man:1,gap:o.gap});rows['slide '+v]=row(a)+' leaves at '+a.hd0+' deg';}
  return rows;
 }
 // the shot against the blue keeper and defender played by the AI (pro): snake, pin shot from the back pin, from the ATT's three men at a few z offsets
 function snVsAI(o){
  o=Object.assign({diff:'pro',dzs:[-6,-3,0,3,6],men:[0,1,2],seeds:[1,2,3],slides:[0],modes:['snake','pinshot']},o||{});   // slides: the rod slides at each speed into the shot, away from the side the man starts on
  const gk=rods.find(q=>q.team===1&&q.role==='GK'),df=rods.find(q=>q.team===1&&q.role==='DEF'),d0=cfg.diffBlue;
  const tally={};for(const m of o.modes)tally[m]={n:0,goal:0,v:0};
  try{
   for(const mode of o.modes)for(const man of o.men)for(const dz of o.dzs)for(const seed of o.seeds)for(const v of o.slides){
    const a=snScene({ri:5,R:3.5,man,dz:dz===0?0.01:dz,mode,keep:[gk,df],ai:true,diff:o.diff,seed,slide:dz>0?-Math.abs(v):Math.abs(v)});
    if(!a.fired)continue;const T=tally[mode];T.n++;if(a.goal)T.goal++;T.v+=a.vMax;T.by=T.by||{};const k=a.blk?a.blk.split('@')[0]:(a.goal?'goal':'none');T.by[k]=(T.by[k]||0)+1;
   }
  }finally{cfg.diffBlue=d0;}
  for(const k in tally){const T=tally[k];T.v=+(T.v/Math.max(1,T.n)).toFixed(1);T.rate=+(T.goal/Math.max(1,T.n)).toFixed(2);}
  return tally;
 }
 function snKeeper(o){
  o=Object.assign({zs:[-8,-5,-2,0,2,5,8],R:3.5},o||{});
  const gk=rods.find(q=>q.team===1&&q.role==='GK'),rows={};let g=0;
  for(const z of o.zs){const a=snScene({ri:5,R:o.R,keep:[gk],kz:z});if(a.goal)g++;rows['gk z '+z]=row(a);}
  rows.goals=g+' of '+o.zs.length;
  return rows;
 }
 function snCost(){
  const sn=snScene({ri:5,R:3.5}),pl=snScene({ri:5,mode:'plain'}),ps=snScene({ri:5,mode:'pinshot'});
  return {snake:sn.exert,plain:pl.exert,pinShot:ps.exert,snakeV:sn.vMax,plainV:pl.vMax,pinShotV:ps.vMax,pinShotY:ps.yMax};
 }
 function snGap(o){
  o=Object.assign({gaps:[0.02,0.1,0.2,0.3,0.34,0.4,0.6]},o||{});
  const rows={};
  for(const gap of o.gaps){const a=snScene({ri:5,R:3.5,gap});rows['gap '+gap]=a.snake?'snake':'no snake';}
  return rows;
 }
 // the HUD with a ball held under the forward leg: the snake's plate (hud.js hudPinHint)
 async function snPlate(){S.seedNext=1;startMatchNow('red');await new Promise(q=>setTimeout(q,3000));const a=snScene({ri:5,R:3.5,stop:'pin'});const t0=HUD.t;for(let i=0;i<20;i++){HUD.t+=1/60;hudRender(1/60);}return {held:!!(a.r&&a.r.pinB),fwd:!!(a.r&&a.r.pinFwd),plate:HUD.pin.on,snk:HUD.pin.snk,shots:[HUD.c.toDataURL('image/png')],info:{}};}
 function snAll(){return {grid:snGrid(),slide:snSlide(),keeper:snKeeper(),cost:snCost(),gap:snGap()};}
 window.snScene=snScene;window.snGrid=snGrid;window.snSlide=snSlide;window.snKeeper=snKeeper;window.snCost=snCost;window.snGap=snGap;window.snTune=snTune;window.snPlate=snPlate;window.snShots=snShots;window.snVsAI=snVsAI;window.snAll=snAll;
})();
