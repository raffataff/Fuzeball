// The tap proper: a man's side hits a ball. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/hit-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      hitProbe({ri:5,man:1,s:1,d:-0.7,a:-0.1,gap:4,V:30})   // a ball at rest d ahead of the rod, the man gap off in z, the leg posed at a, slides at it at V: what the ball does
//      hitGrid({ri:5,man:1})                                 // every depth x the angle that squares the foot onto it: exit speed / heading / hop
// why: a side hit works only when the foot box's face is on the ball's depth, so the angle is chosen per ball (CONFIG.ai.catch.hit)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function hitScene(o){
  o=Object.assign({ri:5,man:1,s:1,d:-0.7,a:0,gap:4,V:30,T:1.2,zb:0,seed:1,diff:'pro',settle:0.5,trace:false},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  try{
   S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;});
   const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic');r.aiErrT=1e9;
   for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
   const zb=o.zb,off=clamp(zb-o.s*o.gap-r.baseZ[o.man],-r.maxOff,r.maxOff);
   r.offset=off;r.target=off;r.prevOffset=off;r.pivot.position.z=off;
   b.m.position.set(r.x+o.d*dir,BALL_R,zb);b.v.set(0,0,0);syncBall(b);
   r.act='catch';r.catPh='hit';r.pinOn=false;r.pinPose=true;r.pinA=o.a*dir;
   const L=[];let hit=null,maxY=0,vmax=0,snap=null;
   for(let i=0;i<Math.round((o.settle+o.T)*SIM.hz);i++){
    const t=i/SIM.hz;
    if(t>=o.settle)r.target=clamp(r.offset+o.s*o.V*FIX*4,-r.maxOff,r.maxOff);
    updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(b.m.position);
    const p=b.m.position,sp=Math.hypot(b.v.x,b.v.z);
    if(!hit&&sp>1&&t>=o.settle)hit={t:+(t-o.settle).toFixed(3),zGap:+((p.z-(r.baseZ[o.man]+r.offset))*o.s).toFixed(2),sv:+(r.slideV*o.s).toFixed(1)};
    maxY=Math.max(maxY,p.y);vmax=Math.max(vmax,sp);
    if(hit&&!snap&&t>=o.settle+hit.t+0.3)snap={along:+(b.v.z*o.s).toFixed(1),fwd:+(b.v.x*dir).toFixed(1),up:+b.v.y.toFixed(1),rel:+((p.x-r.x)*dir).toFixed(2),z:+p.z.toFixed(1)};
    if(o.trace&&i%12===0)L.push(`${t.toFixed(2)} off=${r.offset.toFixed(1)} sv=${r.slideV.toFixed(0)} ang=${(r.angle*dir).toFixed(2)} | ball rel=${((p.x-r.x)*dir).toFixed(2)} z=${p.z.toFixed(1)} v=${(b.v.x*dir).toFixed(1)},${b.v.y.toFixed(1)},${(b.v.z*o.s).toFixed(1)}`);
    if(b.scored||S.phase!=='play')break;
   }
   const p=b.m.position,e=snap||{along:+(b.v.z*o.s).toFixed(1),fwd:+(b.v.x*dir).toFixed(1),up:+b.v.y.toFixed(1),rel:+((p.x-r.x)*dir).toFixed(2),z:+p.z.toFixed(1)};
   return {hit,exit:e,heading:+(Math.atan2(e.fwd,e.along)*57.3).toFixed(0),rel:e.rel,maxY:+maxY.toFixed(2),L};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];}
 }
 // the angle that puts the foot box's face on a ball d ahead of the rod (the ball centre inside the box's x-y rectangle, nearest its middle)
 function hitAngleFor(d){
  let best=null,bs=1e9;
  for(let a=-1.3;a<=1.3;a+=0.01){
   const sa=Math.sin(a),ca=Math.cos(a),fx=sa*ARM,fy=ROD_H-ca*ARM,bcx=fx+FOOT_BOX_OFF.x*sa+FOOT_BOX_OFF.y*ca,bcy=fy-FOOT_BOX_OFF.x*ca+FOOT_BOX_OFF.y*sa;
   const dx=d-bcx,dy=BALL_R-bcy,lx=dx*sa-dy*ca,ly=dx*ca+dy*sa,sc=Math.max(Math.abs(lx)/FOOT_BOX.x,Math.abs(ly)/FOOT_BOX.y);
   if(sc<bs){bs=sc;best={a:+a.toFixed(2),lx:+lx.toFixed(2),ly:+ly.toFixed(2),sc:+sc.toFixed(2)};}
  }
  return best;
 }
 function hitGrid(o){
  o=Object.assign({ri:5,man:1,s:1,V:30,diff:'pro'},o||{});
  const rows=[];
  for(let d=-4;d<=5;d+=0.5){
   const ha=hitAngleFor(d),res=hitScene({ri:o.ri,man:o.man,s:o.s,d,a:ha.a,V:o.V,diff:o.diff});
   rows.push(`d=${d.toFixed(1)} a=${ha.a} (in box ${ha.sc}) -> ${res.hit?'hit at '+res.hit.t+'s':'no hit'} exit along=${res.exit.along} fwd=${res.exit.fwd} up=${res.exit.up} heading=${res.heading} maxY=${res.maxY} end rel=${res.rel}`);
  }
  return rows;
 }
 // the real AI: a ball pinned by a rod posed at ang, then a tap forced to the next man: how the ball gets there and whether the neighbour pins it
 function hitTap(o){
  o=Object.assign({ri:5,man:1,s:1,T:4,seed:1,ang:-0.75,dz:0,trace:false,every:0.1,diff:'pro',hit:true,block:[]},o||{});if(o.from==null)o.from=o.ang<0?8:-6;if(o.vx==null)o.vx=o.ang<0?-25:25;
  const d0=[cfg.diffRed,cfg.diffBlue],h0=AIC.catch.hit.share,lc0=AIC.catch.lineClear;cfg.diffRed=cfg.diffBlue=o.diff;AIC.catch.hit.share=o.hit?1:0;
  try{
   S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;r.bkRev=false;r.rvUntil=0;r.rvReady=false;});
   const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic'),held=o.block.map(k=>rods[k.ri]);r.aiErrT=1e9;r.aiIQ=true;
   for(const q of rods)if(q!==r&&held.indexOf(q)<0)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
   o.block.forEach(k=>{const q=rods[k.ri];q.aiErrT=1e9;q.offset=k.off;q.target=k.off;q.prevOffset=k.off;q.pivot.position.z=k.off;});
   if(o.lie!=null){                                                  // a ball at rest o.lie ahead: the AI's own fetch / retrieve pins it first
    AIC.catch.lineClear=1e6;
    b.m.position.set(r.x+o.lie*dir,BALL_R,r.baseZ[o.man]+o.dz);b.v.set(0,0,0);syncBall(b);
    for(let i=0;i<Math.round(6*SIM.hz)&&!(r.pinB&&(r.catPh==='hold'||r.retPh==='pin'));i++){aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
    if(!r.pinB){AIC.catch.lineClear=lc0;return {out:'nopin',lie:o.lie};}
    const rel0=r.pinB.pinDx;r.tapN=0;
    if(r.act==='retrieve'){r.tapPk={j:o.man+o.s,s:o.s,out:9};retrieveTap(r);}
    else{r.catT=0;pinPlayStart(r);r.tapPk={j:o.man+o.s,s:o.s,out:9};tapStart(r);}
    o.rel0=rel0;
   }else{
   b.m.position.set(r.x+o.from*dir,BALL_R,r.baseZ[o.man]+o.dz);b.v.set(o.vx*dir,0,0);syncBall(b);
   for(let i=0;i<Math.round(2*SIM.hz)&&!r.pinB;i++){r.pinOn=true;r.pinPose=true;r.pinA=o.ang*dir;updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
   if(!r.pinB)return {out:'nopin'};
   o.rel0=r.pinB.pinDx;
   r.act='catch';r.catPh='hold';r.catT=0;r.tapN=0;pinPlayStart(r);
   r.tapPk={j:o.man+o.s,s:o.s,out:9};tapStart(r);
   }
   const L=[],ph=[];let nt=0,tPin=null,pinMan=-1,tHit=null,tSide=null,tBack=null;const mode=r.catPh;
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
    const t=i/SIM.hz,p=b.m.position,rel=(p.x-r.x)*dir,k=(r.act||'-')+'/'+(r.catPh||'-')+(r.hPh?'/'+r.hPh:'');
    if(ph.lk!==k){ph.push(k+'@'+t.toFixed(2));ph.lk=k;}
    if(tHit==null&&r.hPh==='out')tHit=+t.toFixed(2);
    if(tSide==null&&r.catPh==='side')tSide=+t.toFixed(2);
    if(tBack==null&&r.catPh==='back')tBack=+t.toFixed(2);
    if(tPin==null&&tSide!=null&&r.pinB&&r.catPh==='hold'){tPin=+t.toFixed(2);pinMan=r.pinB.pinMan;}
    if(o.trace&&t>=nt){nt+=o.every;L.push(t.toFixed(2)+' '+k+' ang='+(r.angle*dir).toFixed(2)+' off='+r.offset.toFixed(1)+' sv='+r.slideV.toFixed(0)+' pin='+(r.pinB?1:0)+' | ball rel='+rel.toFixed(2)+' z='+p.z.toFixed(1)+' v='+(b.v.x*dir).toFixed(1)+','+b.v.z.toFixed(1));}
    if(tPin!=null&&t>tPin+0.3)break;
    if(S.phase!=='play'||b.scored)break;
   }
   AIC.catch.lineClear=lc0;
   const p=b.m.position,want=o.man+o.s;
   const out=tPin!=null?(tBack!=null?'back-':'')+(pinMan===(tBack!=null?o.man:want)?'ok':'wrongman'):(tBack!=null?'back-lost':Math.abs(b.v.z)>2?'through':'lost');
   return {out,mode,pinRel:+o.rel0.toFixed(2),tHit,tSide,tPin,pinMan,ph:ph.join(' '),end:{rel:+((p.x-r.x)*dir).toFixed(1),z:+p.z.toFixed(1),v:+b.v.length().toFixed(1)},L};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];AIC.catch.hit.share=h0;AIC.catch.lineClear=lc0;}
 }
 // every man of every outfield rod, both ways, forced hit taps from a back pin: how many end in a pin by the neighbour
 function hitTapGrid(o){
  o=Object.assign({diffs:['rookie','pro','legend'],rods:[5,3,1,2,4,6],ang:-0.75,hit:true},o||{});
  const rows={};
  for(const d of o.diffs){const t={},bad=[];
   for(const ri of o.rods){const n=rods[ri].baseZ.length;
    for(let man=0;man<n;man++)for(const s of [-1,1]){const j=man+s;if(j<0||j>=n)continue;
     const a=hitTap({ri,man,s,ang:o.ang,hit:o.hit,diff:d,T:5});const k=a.out+(a.mode==='hit'?'/hit':'/'+a.mode);t[k]=(t[k]||0)+1;if(a.out!=='ok'&&a.out!=='back-ok')bad.push(ri+'.'+man+(s>0?'+':'-')+':'+a.out+'/'+a.mode);}}
   rows[d]={t:JSON.stringify(t),bad:bad.join(' ')};}
  return rows;
 }
 // a ball placed d ahead of a rod (moving at vx / vz) and the real AI left to play it, with the shot gate shut (lineClear 1e6) so it plays the ball and does not kick: phases, when it pins and where
 function ballTry(o){
  o=Object.assign({ri:5,d:4,z:0.5,T:5,trace:false,diff:'pro',vx:0,vz:0,seed:1,every:0.2},o||{});
  const d0=[cfg.diffRed,cfg.diffBlue],lc0=AIC.catch.lineClear;cfg.diffRed=cfg.diffBlue=o.diff;AIC.catch.lineClear=1e6;
  try{
   S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=0;r.bgT=-9;r.lhT=0;r.retCd=0;r.catCd=0;r.cd=0;r.offset=0;r.target=0;r.vz=0;r.slideV=0;r.prevOffset=0;r.pivot.position.z=0;r.tapPend=false;r.tapN=0;r.tapPk=null;});
   const r=rods[o.ri],dir=r.kickDir,b=makeBall('classic');r.aiErrT=1e9;r.aiIQ=true;
   for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
   b.m.position.set(r.x+o.d*dir,BALL_R,o.z);b.v.set(o.vx*dir,0,o.vz);syncBall(b);
   const L=[],phs=[];let nt=0,pinT=null,pinRel=null;
   for(let i=0;i<Math.round(o.T*SIM.hz);i++){
    aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
    const t=i/SIM.hz,p=b.m.position,ph=(r.act||'-')+'/'+(r.catPh||'-')+(r.ftPh?'/'+r.ftPh:'')+(r.ahPh?'/'+r.ahPh:'')+(r.hPh?'/'+r.hPh:'');
    if(phs.lk!==ph){phs.push(ph+'@'+t.toFixed(2));phs.lk=ph;}
    if(pinT==null&&r.pinB){pinT=+t.toFixed(2);pinRel=+r.pinB.pinDx.toFixed(2);}
    if(o.trace&&t>=nt){nt+=o.every;L.push(t.toFixed(2)+' '+ph+' ang='+(r.angle*dir).toFixed(2)+' off='+r.offset.toFixed(1)+' sv='+r.slideV.toFixed(0)+' pin='+(r.pinB?1:0)+' | ball rel='+((p.x-r.x)*dir).toFixed(2)+' z='+p.z.toFixed(1)+' v='+(b.v.x*dir).toFixed(1)+','+b.v.z.toFixed(1));}
   }
   const p=b.m.position;
   return {pinT,pinRel,phs:phs.join(' > '),end:{rel:+((p.x-r.x)*dir).toFixed(2),z:+p.z.toFixed(1),v:+b.v.length().toFixed(1),pinned:!!r.pinB},L};
  }finally{cfg.diffRed=d0[0];cfg.diffBlue=d0[1];AIC.catch.lineClear=lc0;}
 }
 window.ballTry=ballTry;window.hitTapGrid=hitTapGrid;window.hitTap=hitTap;window.hitScene=hitScene;window.hitProbe=hitScene;window.hitGrid=hitGrid;window.hitAngleFor=hitAngleFor;
})();
