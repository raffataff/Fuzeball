'use strict';
/* ================= feel: hitstop, camera shake, follow-through, the kick's weight, the goal (CONFIG.feel) ================= */
// hooks: physics.js contacts (feelHit, feelShakeOn), main.js (feelFrame, feelHeld, feelPose), fx.js cameraUpdate (feelCamPre, feelCamPost), flow.js (feelReset, feelGoal, feelGoalFx, feelGoalScale)
const FEEL=CONFIG.feel||{on:false};
const FLS={hs:0,hsCd:0,tr:0,t:0,goal:null,spin:null,rodT:new Map(),sw:new Map(),px:0,pz:0,pvx:0,pvz:0,
 cam:{on:false,x:0,y:0,z:0,dx:0,dy:0,dz:0,qi:null}};
const FLN=[[1,0.3,1.73,2.1],[1.21,1.7,2.13,0.4],[0.83,2.9,1.57,4.2],[1.37,0.9,2.41,3.3],[0.97,5.1,1.89,1.2]];   // shake noise: two sines an axis
let _flQ=null,_flE=null;
function feelPart(k){const P=FEEL.on&&FEEL[k];return P&&P.on?P:null;}
function feelShakeOn(){return!!feelPart('shake');}
function feelHeld(){return FLS.hs>0;}
function feelTrauma(a){if(a>0)FLS.tr=Math.min(1,FLS.tr+a);}
function feelReset(){FLS.hs=FLS.hsCd=FLS.tr=0;FLS.goal=FLS.spin=null;FLS.rodT.clear();FLS.sw.clear();FLS.px=FLS.pz=FLS.pvx=FLS.pvz=0;}

// --- a hit (physics.js, both contact passes): first touches only, never a held ball; dv = the ball's change of speed, n = the contact normal into the ball ---
function feelHit(b,r,dv,sweet,nx,ny,nz){
 if(!FEEL.on||S.phase!=='play'||!(dv>=FEEL.from))return;
 const t0=FLS.rodT.get(r);
 if(t0!=null&&S.time>=t0&&S.time-t0<FEEL.gap)return;   // S.time below the stamp = a new match
 FLS.rodT.set(r,S.time);
 const hu=isUserRod(r);
 let k=clamp((dv-FEEL.from)/Math.max(1,FEEL.full-FEEL.from),0,1);
 if(sweet)k=Math.min(1,k+FEEL.sweet);
 if(!hu)k*=FEEL.ai;
 const H=feelPart('hitstop');
 if(H&&k>=H.min&&FLS.hsCd<=0&&!(FLS.hs>0))FLS.hs=lerp(H.ms[0],H.ms[1],(k-H.min)/Math.max(1e-6,1-H.min))/1000;
 const K=feelPart('shake');
 if(K){feelTrauma(K.hit*k);
  const h=Math.hypot(b.v.x,b.v.z);
  if(h>1e-6){const i=K.push*k*K.pushHz*6.2832*Math.E/h;FLS.pvx+=b.v.x*i;FLS.pvz+=b.v.z*i;}}   // a critically damped spring kicked at w·e·d peaks at d
 const P=feelPart('spark');
 if(P&&k>=P.min&&cfg.particles&&typeof vfxLive==='function'&&vfxLive())feelSparks(b,nx,ny,nz,(k-P.min)/Math.max(1e-6,1-P.min),P);
 if(feelPart('sound'))Au.kickBody(k,b,hu);
}
function feelSparks(b,nx,ny,nz,u,P){
 const p=b.m.position,x=p.x-nx*BALL_R,y=Math.max(0.3,p.y-ny*BALL_R),z=p.z-nz*BALL_R,
  gold=vfxLin(VF.gold),spark=vfxLin(VF.spark),FL=P.flash,fs=lerp(FL.size[0],FL.size[1],u),n=Math.round(lerp(P.n[0],P.n[1],u));
 vfxBlast(2,x,y,z,0,0,0,FL.life,fs*0.5,fs,[1,0.96,0.86],FL.power,spark);
 for(let i=0;i<n;i++){const d=vfxDir(nx,ny+0.3,nz,0.9),sp=vfxRg(P.speed)*(0.6+0.6*u);
  vfxSpk(x,y,z,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(P.life),Math.random()<0.6?spark:gold,P.power*rand(.7,1.1),vfxRg(P.size),2.2,1,0.035,1,0);}
}

// --- the frame (main.js, every live frame before the sim): returns the real seconds the sim may use; a freeze ending lets a held goal land ---
function feelFrame(rdt){
 if(FLS.spin)FLS.spin.t+=rdt;
 if(FLS.hsCd>0)FLS.hsCd-=rdt;
 feelApproach();
 if(!(FLS.hs>0))return rdt;
 const u=Math.min(FLS.hs,rdt);FLS.hs-=u;
 if(FLS.hs<=1e-9){FLS.hs=0;FLS.hsCd=FEEL.hitstop?FEEL.hitstop.gap:0;if(FLS.goal)feelGoalGo();}
 return rdt-u;
}
// a ball clear of the keeper rod and going in: slow-mo for its last stretch (main.js eases S.timeScale back)
function feelApproach(){
 const G=feelPart('goal'),A=G&&G.approach;
 if(!A||!A.on||S.phase!=='play'||S.trn||FLS.hs>0)return;
 for(const b of S.balls){if(b.scored)continue;
  const p=b.cur||b.m.position,v=b.v,sg=v.x>0?1:-1,vx=v.x*sg;
  if(vx<A.minV||b.overBar===sg||b.noGoal===sg)continue;
  const gk=feelKeeper(sg);if(!gk||p.x*sg<Math.abs(gk.x)+A.past)continue;
  const t=(F.L/2+BALL_R-p.x*sg)/vx;
  if(t<0||t>A.lead||p.y+Math.max(0,v.y)*t>F.goalH-BALL_R||Math.abs(p.z+v.z*t)>F.goalHalf-BALL_R)continue;
  S.timeScale=Math.min(S.timeScale,A.scale);
 }
}
function feelKeeper(sg){for(const r of rods)if(r.role==='GK'&&r.x*sg>0)return r;return null;}

// --- the goal (flow.js onGoal): the frame holds with the ball over the line, then go() lands it; false = land it now ---
function feelGoal(team,b,go){
 const G=feelPart('goal');
 if(!G||!(G.freeze>0)||FLS.goal)return false;
 FLS.goal={b,go,v:{x:b.v.x,y:b.v.y,z:b.v.z}};FLS.hs=Math.max(FLS.hs,G.freeze);feelTrauma(G.shake*0.25);
 return true;
}
// the rest of the goal's step ran the ball on into the net: momGoal reads the speed it crossed the line at
function feelGoalGo(){const g=FLS.goal;FLS.goal=null;if(!g||S.phase!=='play'||S.balls.indexOf(g.b)<0)return;g.b.v.x=g.v.x;g.b.v.y=g.v.y;g.b.v.z=g.v.z;g.go();}
// the blast (flow.js, after goalFx): trauma, the sub drop, and the wave turning the men (drawn only, while the goal phase runs)
function feelGoalFx(team,b){
 const G=feelPart('goal');if(!G)return;
 feelTrauma(G.shake);
 if(G.boom&&G.boom.on)Au.goalBoom(b);
 const W=G.spin;if(!W||!W.on)return;
 const gx=(team===0?1:-1)*F.L/2,sg=-Math.sign(gx),m=new Map();   // feet swing away from the blast
 for(const r of rods){const d=Math.abs(r.x-gx),n=Math.round(W.turns*Math.exp(-d/W.fall));if(n>=1)m.set(r,{n:n*sg,dl:d/W.speed});}
 feelSpin(m,W.T,'goal');
}
// the men turned over on the drawn rod only: m = rod -> {n: whole turns (signed), dl: start delay s}, each turn T s; it lasts while S.phase is ph; null stops it
function feelSpin(m,T,ph){FLS.spin=m?{t:0,T,m,ph}:null;}
function feelGoalScale(){const G=feelPart('goal');return G&&G.after!=null?G.after:MATCH.goalSlowmo;}

// --- the drawn rod (main.js render pose): the strike's follow-through and a spin (the blast's, the walkout's) on top of the sim angle a; r.angle never moves ---
function feelPose(r,a,rdt){
 if(!FEEL.on)return 0;
 let o=0;
 const P=FLS.spin;
 if(P&&S.phase!==P.ph)FLS.spin=null;
 else if(P){const e=P.m.get(r);if(e){const u=clamp((P.t-e.dl)/P.T,0,1);o=e.n*6.2832*(1-Math.pow(1-u,3));}}
 const W=feelPart('swing');if(!W)return o;
 let s=FLS.sw.get(r);if(!s){s={a,w:0,o:0,v:0};FLS.sw.set(r,s);}
 if(FLS.hs>0||!(rdt>0))return o+s.o*r.kickDir;   // a freeze holds the drawn leg too
 let d=a-s.a;d-=6.2832*Math.round(d/6.2832);
 const w=d/rdt*r.kickDir,lost=s.w-Math.max(w,0),wn=W.hz*6.2832;
 if(lost>W.decel)s.v+=W.over*Math.min(1,lost/W.full)*wn/feelPk(W.damp);
 s.a=a;s.w=w;
 if(s.v||s.o){const n=Math.ceil(rdt*240),h=rdt/n;
  for(let i=0;i<n;i++){s.v+=(-wn*wn*s.o-2*W.damp*wn*s.v)*h;s.o+=s.v*h;}
  if(s.o<0){s.o=0;s.v=0;}else if(s.o>W.max){s.o=W.max;s.v=0;}   // one hump forward, never behind the real leg
  if(s.o<1e-4&&Math.abs(s.v)<1e-3)s.o=s.v=0;}
 return o+s.o*r.kickDir;
}
function feelPk(z){const q=Math.sqrt(Math.max(1e-6,1-z*z));return Math.exp(-z/q*Math.atan2(q,z));}   // a damped spring's first peak per unit v0/wn

// --- the camera (fx.js cameraUpdate): last frame's shake comes out first (only if nobody moved the camera since), this frame's goes on after lookAt ---
function feelCamPre(){
 const C=FLS.cam;if(!C.on)return;C.on=false;
 const p=camera.position;if(Math.abs(p.x-C.x)+Math.abs(p.y-C.y)+Math.abs(p.z-C.z)>1e-6)return;   // the punch's undo (vfxCamPre) can leave an ulp
 p.x-=C.dx;p.y-=C.dy;p.z-=C.dz;camera.quaternion.multiply(C.qi);
}
function feelCamPost(rdt,cine){
 const K=feelPart('shake');
 if(!K){FLS.tr=0;return;}
 if(S.shake>0){feelTrauma(S.shake*K.legacy);S.shake=0;}   // the old writers (cannon blast, old goal / win paths)
 FLS.tr=Math.max(0,FLS.tr-rdt*K.decay);FLS.t+=rdt;
 const w=K.pushHz*6.2832,dt=Math.min(rdt,1/30),e=Math.exp(-w*dt);   // the shove: a critically damped spring, stepped exactly
 let c=FLS.pvx+w*FLS.px;FLS.px=(FLS.px+c*dt)*e;FLS.pvx=(FLS.pvx-w*c*dt)*e;
 c=FLS.pvz+w*FLS.pz;FLS.pz=(FLS.pz+c*dt)*e;FLS.pvz=(FLS.pvz-w*c*dt)*e;
 const s=Math.pow(FLS.tr,K.pow)*(cine?K.cine:1),sh=cine?K.cine:1;
 if(s<1e-5&&Math.abs(FLS.px)+Math.abs(FLS.pz)<1e-5)return;
 if(!_flQ){_flQ=new THREE.Quaternion();_flE=new THREE.Euler();FLS.cam.qi=new THREE.Quaternion();}
 const t=FLS.t*K.hz*6.2832,R=Math.PI/180,n=i=>0.6*Math.sin(t*FLN[i][0]+FLN[i][1])+0.4*Math.sin(t*FLN[i][2]+FLN[i][3]);
 _flE.set(s*K.rot[1]*R*n(1),s*K.rot[0]*R*n(0),s*K.rot[2]*R*n(2),'YXZ');_flQ.setFromEuler(_flE);
 const C=FLS.cam,p=camera.position;
 C.dx=s*K.move*n(3)+FLS.px*sh;C.dy=s*K.move*n(4);C.dz=FLS.pz*sh;
 p.x+=C.dx;p.y+=C.dy;p.z+=C.dz;camera.quaternion.multiply(_flQ);
 C.qi.copy(_flQ).invert();C.x=p.x;C.y=p.y;C.z=p.z;C.on=true;
}
