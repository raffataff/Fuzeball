// Keeper soak. Browser side: load the game (preview 'fuzeball'), then in the console or via
//      fetch('tools/keeper-soak.js').then(r=>r.text()).then(eval)
//      gkSoak({fam:'lat',n:300})     // balls rolling ACROSS the front/back of the keeper (not on target)
//      gkSoak({fam:'pocket',n:600}) // a slow ball dropped anywhere in the pocket behind the keeper (bsKeeper's distribution)
//      gkSoak({fam:'lg',n:300})      // the sideways roll BEHIND the heel with a goalward drift (it rolls past the man into the mouth)
//      gkSoak({fam:'ang',n:300,sp:[8,30]})   // balls angled INTO the goal from the pocket behind the rod; sp = the speed range (u/s)
// why: 'does the keeper lift out of the way (or block) a ball rolling at it from the side' is a trial question; it drives the real aiUpdate / updateRods / physics / deadBallUpdate, deterministic per `param`
// outcome per trial: goal (conceded) | whistle (dead ball redrop) | dead (still slow in the keeper's zone at T, nobody played it) | played (left the keeper's zone) | zone (still moving in it)
// iq forces the keeper's smart/dumb roll every step (null = the AI's own); every family draws from one seeded stream (`param`), so a change is compared on the same trials
// hold = a rod-local angle (or fn(t,ball,rod,dir) -> angle|null) forced on the keeper: a what-if for 'which lift depth blocks it'; `rows:true` returns one row per trial, `only:k` replays trial k with `trace`
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function gkSoak(o){
  o=Object.assign({fam:'lat',n:300,T:4,param:777,ri:0,iq:null,only:null,trace:null,diff:null,rows:false,hold:null,leave:14,sp:null,rel:null,kn:3.5},o||{});   // hold: a rod-local angle forced on the keeper every step (what-if: which lift blocks it)
  if(!rods[o.ri])throw new Error('gkSoak: the game is still booting (no rods yet), wait a few seconds after loading');
  let s=o.param;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;},U=(a,b)=>a+(b-a)*rnd();
  const R={fam:o.fam,n:0,goal:0,whistle:0,dead:0,played:0,zone:0,srTrials:0,byAct:{},byOut:{},rows:[]};
  const rb=window.redropBall;let whistled=false;window.redropBall=function(){whistled=true;return rb.apply(this,arguments);};
  const d0=[cfg.diffRed,cfg.diffBlue];if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  try{
  for(let k=0;k<o.n;k++){
   // draw the whole trial first so `only` replays trial k exactly
   const g0=rods[o.ri],dir0=g0.team===0?1:-1;
   let koff=U(-g0.maxOff,g0.maxOff);const relB=o.rel?U(o.rel[0],o.rel[1]):(o.fam==='lat'?U(-5.6,3):o.fam==='lg'?U(-5.4,-1.5):o.fam==='pocket'?U(-5.6,-0.9):U(-5,-1.2)),side=rnd()<.5?-1:1;
   let z0,vx,vz;
   if(o.fam==='lat'||o.fam==='lg'){z0=clamp(koff+side*U(6,22),-31,31);const sp=o.sp?U(o.sp[0],o.sp[1]):U(15,60);vz=-Math.sign(z0-koff||1)*sp;vx=o.fam==='lg'?-U(3,14):U(-4,4);}   // lg: the same roll with a goalward drift
   else if(o.fam==='pocket'){z0=U(-14,14);const sp=U(0,12),an=U(0,6.283);vx=Math.cos(an)*sp;vz=Math.sin(an)*sp;}   // bsKeeper's own distribution: a slow ball dropped behind the heel
   else{z0=U(-12,12);const gz=U(-9,9),sp=o.sp?U(o.sp[0],o.sp[1]):U(15,50),gx=-60,dx=Math.abs(gx-(g0.x+relB)),dz=gz-z0,L=Math.hypot(dx,dz);vx=-sp*dx/L;vz=sp*dz/L;koff=clamp(z0+U(-o.kn,o.kn),-g0.maxOff,g0.maxOff);}   // a ball in the pocket heading for the mouth, the man roughly on its z   // vx dir-relative: negative = toward the keeper's own goal
   if(o.only!=null&&k!==o.only)continue;
   S.seedNext=1+k;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
   rods.forEach(r=>{r.aiBX=r.x;r.aiBZ=z0;r.bgT=-9;r.lhT=0;r.retCd=0;r.retPh=null;r.laneCd=0;r.evadeCd=0;r.dribCd=0;});
   const g=rods[o.ri],dir=g.team===0?1:-1,own=g.team===0?1:0;
   g.offset=koff;g.target=koff;g.prevOffset=koff;g.iPrevOff=koff;g.slideV=0;g.vz=0;
   const b=makeBall('classic');b.m.position.set(g.x+dir*relB,BALL_R,z0);b.v.set(vx*dir,0,vz);syncBall(b);b.cur.copy(b.m.position);
   whistled=false;let out=null,sr=false,firstAct=null,touch=null,steps=Math.round(o.T*SIM.hz);
   for(let i=0;i<steps;i++){
    if(o.iq!==null)for(const r of rods)if(r.role==='GK'||o.iq===true)r.aiIQ=o.iq;
    const pv=b.v.clone(),pp=b.m.position.clone(),pact=g.act,praise=g.raise,pa=g.angle,sc1=S.score[own];
    for(const bb of S.balls)bb.prev.copy(bb.m.position);
    aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);
    if(o.hold!==null){const h=typeof o.hold==='function'?o.hold(i/SIM.hz,b,g,dir):o.hold;if(h!==null){g.angle=h*dir;g.prevAngle=g.angle;g.angVel=0;g.pivot.rotation.z=g.angle;}}
    physics(FIX);S.time+=FIX;
    for(const q of S.balls)q.cur.copy(q.m.position);
    if(g.act==='safeRaise')sr=true;
    if(o.trace)o.trace((i/SIM.hz),pp,pv,pa,g,b,k);
    if(S.score[own]>sc1){out='goal';break;}
    if(whistled||S.phase!=='play'){out='whistle';break;}
    const bb=S.balls[0];if(bb!==b)break;
    if((b.m.position.x-g.x)*dir>o.leave){out='played';break;}   // out of the keeper's zone: what the other team does with it is not this soak's question
    if(!touch&&S.lastTouch===g.team){const dv=b.v.clone().sub(pv);if(dv.length()>2.5&&Math.abs(pp.x-g.x)<9&&Math.abs(pp.z-(g.baseZ[0]+g.offset))<6){touch={t:i/SIM.hz,act:pact||(praise?'raise':'-'),ang:+(pa*dir).toFixed(2),dvx:+(dv.x*dir).toFixed(1),vx:+(b.v.x*dir).toFixed(1)};}}
   }
   const rel=(b.m.position.x-g.x)*dir,sp=b.v.length();
   if(!out)out=rel>14?'played':(sp<5?'dead':(rel>9?'played':'zone'));
   R.n++;R[out]++;if(sr)R.srTrials++;
   const key=(sr?'SR':'--')+'>'+out;R.byOut[key]=(R.byOut[key]||0)+1;
   if(touch){const k2=touch.act+'>'+out;R.byAct[k2]=(R.byAct[k2]||0)+1;}
   if(o.rows)R.rows.push({k,out,sr,rel:+relB.toFixed(1),z0:+z0.toFixed(1),koff:+koff.toFixed(1),vx:+vx.toFixed(0),vz:+vz.toFixed(0),touch});
  }
  }finally{window.redropBall=rb;cfg.diffRed=d0[0];cfg.diffBlue=d0[1];}
  return R;
 }
 // the shipped keeper settings against the old behaviour (iq-gated, slow lift) on the same trials; ok = no more goals and fewer balls left dead
 //   gkCheck()   // ~15 s
 function gkCheck(n){
  n=n||300;const SR=CONFIG.ai.safeRaise,keep=[SR.gkAlways,SR.gkLerp],R={ok:true};
  try{for(const fam of ['lat','lg','pocket']){
   SR.gkAlways=false;SR.gkLerp=0;const off=gkSoak({fam,n});
   SR.gkAlways=keep[0];SR.gkLerp=keep[1];const on=gkSoak({fam,n});
   const ok=on.goal<=off.goal&&on.dead+on.zone<off.dead+off.zone;if(!ok)R.ok=false;
   R[fam]={ok,off:`goal ${off.goal} dead ${off.dead} zone ${off.zone}`,on:`goal ${on.goal} dead ${on.dead} zone ${on.zone}`};
  }}finally{SR.gkAlways=keep[0];SR.gkLerp=keep[1];}
  return R;
 }
 window.gkSoak=gkSoak;window.gkCheck=gkCheck;
})();
