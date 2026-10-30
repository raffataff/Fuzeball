// The AI's snake (CONFIG.ai.catch.snake) on the real sim. From a terminal:
//      node tools/page-run.js tools/aisnake-soak.js "asAll()"
//      asScene({ri:5,man:1,R:3.5,dz:0,slide:0,mode:'ai',keep:[],diff:'pro',assist:true,trace:false})   // a ball pinned under a red AI rod's forward leg R ahead, the rod sliding at `slide`; mode 'ai' lets the AI play it, 'fire' forces the snake at once
//      asGrid()             // every depth x ATT / MID / DEF, open goal, the AI deciding: what it fires, how fast, how high, goal
//      asSlide({assist})    // the snake forced with the rod sliding at each speed: the heading it leaves on against the one the AI judged (catch.snake.k / drift)
//      asVsAI({diff,on})    // a ball held forward at the red ATT, the blue keeper + DEF played by the AI: what comes of it with the snake on, and off (re-seat, pin shot)
//      asWatch({seeds,secs,diff})   // whole AI-vs-AI matches: every snake by role, its slide, depth and lane margin, and what came of it (goal / first touched by)
// a scene removes every man but the shooting rod's and `keep` (rod indices); every rod's aiErrT is pinned, or aiUpdate re-rolls its iq
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const NM={5:'ATT',3:'MID',1:'DEF'},MAN={5:1,3:2,1:1};
 function step(n){
  for(let i=0;i<n;i++){aiUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
 }
 function asScene(o){
  o=Object.assign({ri:5,man:null,R:3.5,dz:0,slide:0,mode:'ai',keep:[],diff:'pro',seed:1,T:2.5,assist:true,trace:false,every:0.02},o||{});
  if(o.man==null)o.man=MAN[o.ri];
  const d0=[cfg.diffRed,cfg.diffBlue],aa=window.aimAssist,CA0=Object.assign({},CAW);
  cfg.diffRed=cfg.diffBlue=o.diff;
  if(!o.assist)window.aimAssist=function(){};
  try{return run(o);}finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];window.aimAssist=aa;for(const k in CAW)if(!(k in CA0))delete CAW[k];else CAW[k]=CA0[k];}
 }
 function run(o){
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  const r=rods[o.ri],dir=r.kickDir,keep=o.keep.map(i=>rods[i]);
  rods.forEach(q=>{q.aiBX=q.x;q.aiBZ=0;q.bgT=-9;q.lhT=0;q.retCd=0;q.catCd=0;q.cd=0;q.offset=0;q.target=0;q.vz=0;q.slideV=0;q.prevOffset=0;q.pivot.position.z=0;q.aiErrT=1e9;q.exert=0;q.rvUntil=0;q.rvReady=false;});
  for(const q of rods){const on=q===r||keep.indexOf(q)>=0;for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=on?0:1e9;}
  const room=Math.min(r.maxOff,Math.abs(o.slide)*0.5),off0=o.slide?-Math.sign(o.slide)*room:0;   // a sliding rod starts on the side away from the slide
  r.offset=r.target=r.prevOffset=r.pivot.position.z=off0;
  r.angle=r.prevAngle=1.4*dir;r.pivot.rotation.z=r.angle;   // the leg up and forward first: lowered from rest it would sweep through the ball
  const b=makeBall('classic');
  b.m.position.set(r.x+o.R*dir,BALL_R,r.baseZ[o.man]+off0+o.dz);b.v.set(0,0,0);syncBall(b);
  const fa=footAngle(o.R,true);
  for(let i=0;i<Math.round(SIM.hz)&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=(fa==null?0.9:fa)*dir;r.aiMan=o.man;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
  if(!r.pinB)return {out:'nopin',fa};
  const rel0=+r.pinB.pinDx.toFixed(2);
  if(o.slide){for(let i=0;i<Math.round(0.3*SIM.hz);i++){r.target=clamp(r.target+o.slide*FIX,-r.maxOff,r.maxOff);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}}
  if(!r.pinB)return {out:'dropped',rel0};
  r.act='catch';r.catPh='hold';r.catT=1;r.tapN=0;pinPlayStart(r);r.catCd=0;
  let fire=null,tz=null;
  if(o.mode==='fire'){
   const SN=AIC.catch.snake,sv=r.slideV;
   r.pcSn=true;r.catSv=sv;r.catSl=SN.k*sv;r.catHold=SHOT.snake.spin+SHOT.snake.follow;r.pcWhy='scene';
   pinFire(r,b,DIFFS[teamDiff(r.team)],1);catchEnd(r,AIC.catch.cd,'snake');
   fire={t:0,style:r.kickStyle,sv:+sv.toFixed(1)};tz=r.catAim&&r.catAim.best?+r.catAim.best.tz.toFixed(2):null;
  }
  const L=[],x0=(r.team===0?1:-1)*F.L/2;let nt=0,tHit=null,vMax=0,yMax=0,hd=null,cross=null,why=null,blk=null,sn0=CAS.snake,rs0=CAS.reseat;
  for(let i=0;i<Math.round(o.T*SIM.hz);i++){
   const t=i/SIM.hz,pk=r.kickT>=0;
   step(1);
   const p=b.m.position;
   if(!fire&&!pk&&r.kickT>=0){fire={t:+t.toFixed(2),style:r.kickStyle||'plain',sv:+r.slideV.toFixed(1)};if(r.kickStyle==='snake'&&r.catAim&&r.catAim.best)tz=+r.catAim.best.tz.toFixed(2);}
   if(fire&&tHit==null&&r.kickHit)tHit=t;
   if(tHit!=null){vMax=Math.max(vMax,b.v.length());yMax=Math.max(yMax,p.y);if(hd==null&&t-tHit>=0.04)hd=+(Math.atan2(b.v.z,b.v.x*dir)*57.3).toFixed(1);}
   if(tHit!=null&&!blk&&b.msc&&b.msc.team!==r.team)blk=b.msc.role;
   if(cross==null&&p.x*dir>=F.L/2-BALL_R)cross={z:+p.z.toFixed(2),y:+p.y.toFixed(2)};
   if(o.trace&&t>=nt){nt+=o.every;L.push(`${t.toFixed(2)} ${r.act||'-'}/${r.catPh||'-'}${r.retPh?'/'+r.retPh:''} ang=${(r.angle*dir).toFixed(2)} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} pin=${r.pinB?1:0}${r.kickT>=0?' K:'+(r.kickStyle||'plain'):''} | ball rel=${((p.x-r.x)*dir).toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.z.toFixed(1)}`);}
   if(b.scored||S.phase!=='play')break;
  }
  return {rel0,fire,snakes:CAS.snake-sn0,reseats:CAS.reseat-rs0,hit:tHit!=null,vMax:+vMax.toFixed(1),yMax:+yMax.toFixed(2),hd,tz,cross,goal:!!b.scored,blk,end:{x:+b.m.position.x.toFixed(1),z:+b.m.position.z.toFixed(1),v:+b.v.length().toFixed(1)},L};
 }
 function row(a){return a.fire?`${a.fire.style}@${a.fire.t} v ${a.vMax} y ${a.yMax} cross ${a.cross?a.cross.z+','+a.cross.y:'-'} goal ${a.goal?1:0}`:(a.out||'no fire, reseats '+a.reseats);}
 function asGrid(o){
  o=Object.assign({Rs:[2.4,2.6,3,3.5,4,4.5,5,5.5],ris:[5,3,1],diff:'pro'},o||{});
  const rows={},n={fired:0,snake:0,goal:0,all:0};
  for(const ri of o.ris)for(const R of o.Rs){const a=asScene({ri,R,diff:o.diff});rows[NM[ri]+' R='+R]=row(a)+' (held at '+a.rel0+')';n.all++;if(a.fire)n.fired++;if(a.fire&&a.fire.style==='snake')n.snake++;if(a.goal)n.goal++;}
  rows.sum=n;return rows;
 }
 // the heading the slide gives: forced snake from a sliding rod, against the slope the AI judged it at (atan of catch.snake.k x slide) and where it was told to aim (tz)
 function asSlide(o){
  o=Object.assign({ri:5,R:3.5,vs:[-40,-30,-20,-10,0,10,20,30,40],assist:false,diff:'pro'},o||{});
  const rows={},SN=AIC.catch.snake;
  for(const v of o.vs){const a=asScene({ri:o.ri,R:o.R,slide:v,mode:'fire',assist:o.assist,diff:o.diff});
   const sv=a.fire?a.fire.sv:0;rows['slide '+v]=`sv ${sv} leaves ${a.hd} deg (judged ${(Math.atan(SN.k*sv)*57.3).toFixed(1)}) cross ${a.cross?a.cross.z:'-'} aimed ${a.tz} v ${a.vMax} y ${a.yMax}`;}
  return rows;
 }
 // the ATT holding a ball forward with the blue keeper and DEF in front, every man x dz x seed; on:false = the old play (re-seat, retrieve's pin shot)
 function asVsAI(o){
  o=Object.assign({diff:'pro',on:true,dzs:[-1,0,1],men:[0,1,2],seeds:[1,2,3,4],Rs:[3,4],T:4},o||{});
  const SN=AIC.catch.snake,on0=SN.on,t={n:0,goal:0,snake:0,pin:0,pass:0,plain:0,none:0,blk:{},v:0};
  SN.on=o.on;
  try{
   for(const man of o.men)for(const dz of o.dzs)for(const R of o.Rs)for(const seed of o.seeds){
    const a=asScene({ri:5,man,R,dz,seed,keep:[7,6],diff:o.diff,T:o.T});
    if(a.out)continue;
    t.n++;if(a.goal)t.goal++;const st=a.fire?(a.fire.style==='trapShot'?'pin':a.fire.style||'plain'):'none';t[st]=(t[st]||0)+1;if(a.fire&&a.vMax)t.v+=a.vMax;
    const k=a.blk||(a.goal?'goal':'none');t.blk[k]=(t.blk[k]||0)+1;
   }
  }finally{SN.on=on0;}
  t.v=+(t.v/Math.max(1,t.n-t.none)).toFixed(1);t.rate=+(t.goal/Math.max(1,t.n)).toFixed(2);
  return t;
 }
 // whole AI-vs-AI matches: every snake the AI fires, by role: the slide, the depth, the lane margin it was judged at, and what came of it within `look` s (goal / first touched by / nothing)
 function asWatch(o){
  o=Object.assign({seeds:24,secs:120,diff:'pro',seed0:1,look:1.5},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue],wh=Au.whistle,sf=window.snakeFire,mc=window.momContact,live=[],T={m:0,goals:0,by:{}};
  cfg.diffRed=cfg.diffBlue=o.diff;Au.whistle=function(){};
  const tally=k=>T.by[k]||(T.by[k]={n:0,goal:0,first:{},clr:[],sv:[],rel:[]});
  window.snakeFire=function(r){
   const b=r.pinB,SN=AIC.catch.snake,gx=r.kickDir>0?F.L/2:-F.L/2,p=b.m.position;
   const clr=pushOutlet(r,p.x,p.z,r.slideV,laneObs(r.team,p.x,gx,SN.shotV),gx);
   const q=tally(r.role);q.n++;q.clr.push(clr);q.sv.push(Math.abs(r.slideV));q.rel.push(b.pinDx);
   live.push({q,team:r.team,t:S.time,sc:S.score[r.team],first:null});
   return sf.apply(this,arguments);
  };
  window.momContact=function(b,r){for(const s of live)if(!s.first&&r.team!==s.team&&S.time-s.t>0.05)s.first=r.role;return mc.apply(this,arguments);};
  const settle=all=>{for(let i=live.length-1;i>=0;i--){const s=live[i];if(!all&&S.time-s.t<o.look)continue;if(S.score[s.team]>s.sc)s.q.goal++;const k=s.first||(S.score[s.team]>s.sc?'-':'none');s.q.first[k]=(s.q.first[k]||0)+1;live.splice(i,1);}};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const sc0=S.score[0]+S.score[1];
    for(let i=0;i<Math.round(o.secs*SIM.hz);i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(i%12===0)settle(false);
    }
    settle(true);T.goals+=S.score[0]+S.score[1]-sc0;T.m++;
   }
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];Au.whistle=wh;window.snakeFire=sf;window.momContact=mc;}
  const med=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return +s[s.length>>1].toFixed(2);};
  const out={diff:o.diff,matches:T.m,goalsPerMatch:+(T.goals/Math.max(1,T.m)).toFixed(2)};
  for(const k in T.by){const q=T.by[k];out[k]={perMatch:+(q.n/T.m).toFixed(2),goals:q.goal,rate:+(q.goal/Math.max(1,q.n)).toFixed(3),first:q.first,clrMed:med(q.clr),clrUnder3:+(q.clr.filter(x=>x<3).length/Math.max(1,q.n)).toFixed(2),svMed:med(q.sv),relMed:med(q.rel)};}
  return out;
 }
 function asAll(){return {grid:asGrid(),slide:asSlide(),vsOn:asVsAI(),vsOff:asVsAI({on:false})};}
 window.asScene=asScene;window.asGrid=asGrid;window.asSlide=asSlide;window.asVsAI=asVsAI;window.asWatch=asWatch;window.asAll=asAll;
})();
