// Slide probe: how an AI rod moves onto its target (CONFIG.ai.slide): arrival, overshoot, settle, reversals, and the lag on a moving target.
//      node tools/page-run.js tools/slide-probe.js "slProbe()"
//      slProbe({set:{'ai.slide.brake':false}})   // set: CONFIG paths overridden for the run, restored after
// settle = last step the man is off by more than tol or sliding faster than settleV; arrive = first step within tol
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 function prep(r){r.offset=0;r.prevOffset=0;r.iPrevOff=0;r.slideV=0;r.target=0;r.tgP=0;r.tgF=0;r.tgV=0;r.act=null;r.catSw=false;r.kickT=-1;r.pinB=null;r.clOn=false;r.angle=0;r.prevAngle=0;}
 function step(r,t){r.target=t;updateRods(FIX);S.time+=FIX;}
 function jump(r,T,o){
  prep(r);let arr=null,settle=0,over=0,rev=0,ls=0;
  for(let i=0;i<Math.round(1.5*SIM.hz);i++){
   step(r,T);const d=T-r.offset,t=(i+1)*FIX,v=r.slideV;
   if(arr==null&&Math.abs(d)<o.tol)arr=t;
   if(Math.abs(d)>o.tol||Math.abs(v)>o.settleV)settle=t;
   over=Math.max(over,-d*Math.sign(T));
   const s=Math.abs(v)>1?Math.sign(v):0;if(s&&ls&&s!==ls)rev++;if(s)ls=s;
  }
  return {arrive:arr==null?null:+arr.toFixed(3),settle:+settle.toFixed(3),over:+over.toFixed(2),rev};
 }
 function track(r,A,f){
  prep(r);let e2=0,n=0,mx=0;
  for(let i=0;i<Math.round(3*SIM.hz);i++){
   const t=i*FIX,T=A*Math.sin(2*Math.PI*f*t);step(r,T);
   if(t>1){const e=Math.abs(T-r.offset);e2+=e*e;n++;mx=Math.max(mx,e);}
  }
  return {rms:+Math.sqrt(e2/n).toFixed(2),max:+mx.toFixed(2)};
 }
 function slProbe(o){
  o=Object.assign({set:null,tol:0.25,settleV:3,role:'MID',team:0,steps:[0.5,1,3,6]},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],olds=[],R={};
  if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  try{
   for(const diff of ['rookie','pro','legend']){
    cfg.diffRed=diff;cfg.diffBlue=diff;startMatchNow('ai');S.phase='play';
    for(const b of S.balls){b.m.position.set(0,BALL_R,F.W/2-BALL_R);b.v.set(0,0,0);}
    const r=rods.find(q=>q.team===o.team&&q.role===o.role);
    for(const b of S.balls){b.m.position.x=r.x-r.kickDir*30;if(typeof syncBall==='function')syncBall(b);}
    const J={};for(const T of o.steps)J[T]=jump(r,T,o);
    R[diff]={jump:J,track:{slow:track(r,6,0.4),fast:track(r,6,1.2)}};
   }
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];for(const [k,v] of olds.reverse())setPath(k,v);}
  return R;
 }
 window.slProbe=slProbe;
})();
