'use strict';
/* ================= cinematic camera ================= */
// a directed camera for watching the AI (CONFIG.camera.cine, one row of camera.modes): slow shots picked by the beat of play, held for seconds, cut on calm beats
// every axis rides a critically damped spring, so speed never snaps; the subject is the ball through a dead zone, so a tic-tac doesn't rock the frame
const CINE={on:false,id:null,t:0,hold:0,bad:0,lost:0,sd:1,s:1,th:0,glide:0,ph:'',ge:-1,d:0,own:-1,hot:false,calm:true,held:null,n:0,fov0:55,
 ax:0,az:0,f:[0,0,0,0],lr:[0,0],p:[0,0,0,0,0,0],l:[0,0,0,0,0,0],fv:[1,0],rp:[0,0,0],rl:[0,0,0]};
// critically damped spring, exact for any dt: a[i] eases to t at rate w, a[i+1] is its velocity
function cineSpr(a,i,t,w,dt){const x=a[i]-t,e=Math.exp(-w*dt),j=(a[i+1]+w*x)*dt;a[i]=t+(x+j)*e;a[i+1]=(a[i+1]-w*j)*e;}
function cineEase(u){u=clamp(u,0,1);return u*u*(3-2*u);}
function cineAt(px,py,pz,lx,ly,lz){const p=CINE.rp,l=CINE.rl;p[0]=px;p[1]=py;p[2]=pz;l[0]=lx;l[1]=ly;l[2]=lz;}

// --- shots ---
// f(H,sx,sz,t,d,lr): H = its CONFIG block, (sx,sz) the subject, t its own clock, d the end it frames (±1), lr the lead room; writes CINE.rp / rl
// end shots belong to one end of the table and are cut once the play leaves it
const CINE_SHOTS={
 wide:{f(H,sx,sz,t,d,lr){cineAt(sx*H.x+H.drift*Math.sin(t*.11),H.y,H.z,sx*H.lx+lr,0,sz*.15+3);}},
 rail:{f(H,sx,sz,t,d,lr){cineAt(sx*H.x,H.y+H.bob*Math.sin(t*.17),H.z+H.sway*Math.sin(t*.13),sx+lr,2,sz*H.lz);}},
 high:{f(H,sx,sz,t){cineAt(sx*H.x,lerp(H.y0,H.y1,cineEase(t/H.T)),H.z,sx*H.lx,0,0);}},
 drift:{f(H,sx,sz,t,d,lr){const a=CINE.th+CINE.s*H.w*t,c=sx*H.cx;cineAt(c+H.r*Math.sin(a),H.y,H.r*Math.cos(a),c+lr,2,sz*.3);}},
 shoulder:{end:true,f(H,sx,sz,t,d){const e=cineEase(t/H.T);
  cineAt(clamp(sx-d*(H.back-H.push*e),-H.maxX,H.maxX),H.y,sz*.35+H.side,d*Math.min(d*sx+H.ahead,F.L/2),0,sz*H.lz);}},
 goal:{end:true,f(H,sx,sz,t,d){cineAt(d*H.x,H.y+H.bob*Math.sin(t*.2),H.sway*Math.sin(t*.15),sx*H.lx,0,sz*H.lz);}},
 corner:{end:true,f(H,sx,sz,t,d){const e=cineEase(t/H.T);
  cineAt(d*lerp(H.x0,H.x1,e),lerp(H.y0,H.y1,e),lerp(H.z0,H.z1,e),sx*H.lx+d*H.lead,0,sz*.3);}},
 establish:{f(H,sx,sz,t){const e=cineEase(t/H.T),a=CINE.s*lerp(H.a0,H.a1,e);
  cineAt(H.r*Math.sin(a),lerp(H.y0,H.y1,e),H.r*Math.cos(a),sx*H.lx,0,0);}},
 cele:{f(H,sx,sz,t,d){const e=cineEase(t/H.T);
  cineAt(d*lerp(H.x0,H.x1,e),lerp(H.y0,H.y1,e),lerp(H.z0,H.z1,e),d*H.lx,H.ly,0);}},
 win:{f(H,sx,sz,t){const a=H.a*Math.sin(H.w*t+CINE.th);cineAt(H.r*Math.sin(a),H.y,H.r*Math.cos(a),0,0,0);}}
};
function cineRig(){const o=CINE;CINE_SHOTS[o.id].f(CAM.cine.shots[o.id],o.f[0],o.f[2],o.t,o.sd,o.lr[0]);}
function cineFovT(){const o=CINE,H=CAM.cine.shots[o.id],h=o.held;
 return H.fov*(h&&o.d&&h.team===(o.d>0?0:1)?CAM.cine.tension:1);}

// --- reading the play ---
// the subject (springs o.f), the attack beat o.d (the end the play is at, 0 = midfield), the last holder o.own, calm / hot
function cineSee(rdt){
 const C=CAM.cine,o=CINE,hl=F.L/2,hw=F.W/2;
 let n=0,x=0,z=0,vx=0,vz=0,sp=0,hot=0,held=null;
 for(const b of S.balls){const p=b.m.position,v=b.v;n++;x+=p.x;z+=p.z;vx+=v.x;vz+=v.z;sp=Math.max(sp,Math.hypot(v.x,v.z));
  if(b.pinR)held=b.pinR;
  if(Math.abs(v.x)>1){const g=(Math.sign(v.x)*hl-p.x)/v.x;if(g>0&&g<C.hotT&&Math.abs(p.z+v.z*g)<F.goalHalf*1.6)hot=Math.sign(v.x);}}
 if(n){x/=n;z/=n;
  let tx=clamp(x+vx/n*C.lead,-hl,hl);const tz=clamp(z,-hw,hw);   // no lead across: it would swell a tic-tac
  if(hot)tx=hot>0?Math.max(tx,hl*C.hotLead):Math.min(tx,-hl*C.hotLead);   // a shot: pan for where it is going
  if(tx>o.ax+C.dz[0])o.ax=tx-C.dz[0];else if(tx<o.ax-C.dz[0])o.ax=tx+C.dz[0];
  if(tz>o.az+C.dz[1])o.az=tz-C.dz[1];else if(tz<o.az-C.dz[1])o.az=tz+C.dz[1];
 }else if(S.phase==='count'&&typeof S.serveAt!=='number'){   // no ball yet: frame where the serve will put it (an out re-drops near where it left)
  const k=typeof kickoffSpot==='function'?kickoffSpot():null;o.ax=k?k.x:0;o.az=k?k.z:0;}
 // catch-up: the further the ball has run from the frame, the quicker the follow (a spring trails a steady roll by 2v/w)
 const K=C.catchUp,ku=a=>1+K.k*clamp((a-K.d[0])/(K.d[1]-K.d[0]),0,1);
 cineSpr(o.f,0,o.ax,C.subW[0]*ku(Math.abs(o.ax-o.f[0])),rdt);cineSpr(o.f,2,o.az,C.subW[1]*ku(Math.abs(o.az-o.f[2])),rdt);
 const ax=Math.abs(o.f[0]);
 if(ax>C.attackX)o.d=Math.sign(o.f[0]);else if(ax<C.attackX-C.attackHys)o.d=0;
 if(held)o.own=held.team;
 cineSpr(o.lr,0,o.own<0?0:(o.own===0?1:-1)*C.room,C.roomW,rdt);
 o.hot=hot;o.held=held;o.calm=!n||!!held||sp<C.calmV;
}
function cineBeat(){return S.phase==='count'?'count':CINE.d?'attack':'mid';}
// true when the first ball is outside the frame the springs hold (r = f x up, u = r x f)
function cineLost(){
 const o=CINE,b=S.balls[0];if(!b)return false;
 const P=b.m.position,p=o.p,l=o.l;
 let fx=l[0]-p[0],fy=l[2]-p[2],fz=l[4]-p[4];const fn=Math.hypot(fx,fy,fz)||1;fx/=fn;fy/=fn;fz/=fn;
 const rn=Math.hypot(fx,fz)||1,rx=-fz/rn,rz=fx/rn,ux=-rz*fy,uy=rz*fx-rx*fz,uz=rx*fy;
 const dx=P.x-p[0],dy=P.y-p[2],dz=P.z-p[4],cf=dx*fx+dy*fy+dz*fz;
 if(cf<=0)return true;
 const t=Math.tan(o.fov0*o.fv[0]*Math.PI/360);
 return Math.abs(dx*ux+dy*uy+dz*uz)>t*cf||Math.abs(dx*rx+dz*rz)>t*(camera.aspect||1.6)*cf;
}

// --- directing ---
// start shot id; d = the end it frames (default the play's); a near framing glides, anything else cuts
function cineGo(id,cut,d){
 const C=CAM.cine,o=CINE,H=C.shots[id];
 o.id=id;o.t=0;o.bad=0;o.lost=0;o.glide=0;o.hold=C.minT+Math.random()*(C.maxT-C.minT);
 o.sd=d||o.d||(o.f[0]<0?-1:1);
 o.s=Math.random()<.5?-1:1;o.th=id==='drift'?o.s*H.a*(.4+.6*Math.random()):Math.random()*6.283;
 if(id==='drift')o.s=-o.s;   // the arc drifts back toward square-on
 cineRig();
 const p=o.p,l=o.l,P=o.rp,L=o.rl;
 if(!cut){
  const ax=l[0]-p[0],ay=l[2]-p[2],az=l[4]-p[4],bx=L[0]-P[0],by=L[1]-P[1],bz=L[2]-P[2];
  const c=(ax*bx+ay*by+az*bz)/Math.max(1e-6,Math.hypot(ax,ay,az)*Math.hypot(bx,by,bz));
  if(Math.hypot(P[0]-p[0],P[1]-p[2],P[2]-p[4])<C.blendD&&c>Math.cos(C.blendA*Math.PI/180)){o.glide=1;return;}
 }
 for(let k=0;k<3;k++){p[k*2]=P[k];p[k*2+1]=0;l[k*2]=L[k];l[k*2+1]=0;}
 o.fv[0]=cineFovT();o.fv[1]=0;
}
// a weighted draw from the beat's shots, never the one running
function cinePick(beat,cut){
 const W=CAM.cine.pick[beat]||CAM.cine.pick.mid;
 let tot=0,id=null;for(const k in W)if(k!==CINE.id&&CINE_SHOTS[k])tot+=W[k];
 let r=Math.random()*tot;
 for(const k in W){if(k===CINE.id||!CINE_SHOTS[k])continue;id=k;if((r-=W[k])<=0)break;}
 cineGo(id||'wide',cut);
}
// in play / count: cut a shot that has lost the ball or its play, outstayed its beat or its hold; nothing else cuts while a ball is due at a goal
function cineDirect(rdt){
 const C=CAM.cine,o=CINE,beat=cineBeat(),sh=CINE_SHOTS[o.id];
 o.bad=sh.end&&o.d!==o.sd?o.bad+rdt:0;
 o.lost=S.phase==='play'&&cineLost()?o.lost+rdt:0;
 if(o.lost>C.lostT&&o.t>C.lostMin){cinePick(beat,true);return;}
 if(o.hot)return;
 if((o.bad>C.badT&&o.t>C.minT*.5)||(!(C.pick[beat][o.id]>0)&&o.t>C.minT)||(o.t>o.hold&&(o.calm||o.t>o.hold+C.lateT)))cinePick(beat,false);
}

// --- per frame (fx.js cameraUpdate) ---
// false = not the live camera (hands the fov back if it just stopped being)
function cineUpdate(rdt){
 const C=CAM.cine,o=CINE;
 if(!C||S.camMode!==C.mode){cineOff();return false;}
 if(S.phase==='pause')return true;   // held with the match
 if(!o.on){o.on=true;o.fov0=camera.fov;o.ph='';o.id=null;o.ge=-1;o.own=-1;o.lr[0]=o.lr[1]=0;
  const b=S.balls[0];o.ax=b?b.m.position.x:0;o.az=b?b.m.position.z:0;o.f[0]=o.ax;o.f[2]=o.az;o.f[1]=o.f[3]=0;}
 cineSee(rdt);
 const ph=S.phase;
 if(ph!==o.ph){const was=o.ph;o.ph=ph;
  if(ph==='goal')o.ge=typeof RP!=='undefined'&&RP.queued?C.celeDelay:-1;   // a goal queues its replay; an out keeps the shot
  else if(ph==='win')cineGo('win',true);
  else if(ph==='count'){o.f[0]=o.ax;o.f[2]=o.az;o.f[1]=o.f[3]=0;cinePick('count',true);}   // after a replay or an out: a fresh shot
  else if(!o.id||was==='')cinePick(cineBeat(),true);
 }
 if(!o.id)cinePick(cineBeat(),true);
 if(o.ge>=0){o.ge-=rdt;
  if(o.ge<0){const d=RP.team===0?1:-1;if(!(CINE_SHOTS[o.id].end&&o.sd===d&&o.id!=='shoulder'))cineGo('cele',true,d);}}
 if(ph==='play'||ph==='count')cineDirect(rdt);
 o.t+=rdt;o.n+=rdt;
 cineRig();
 const w=o.glide?C.blendW:C.posW,P=o.rp,L=o.rl,p=o.p,l=o.l;
 for(let k=0;k<3;k++){cineSpr(p,k*2,P[k],w,rdt);cineSpr(l,k*2,L[k],C.lookW,rdt);}
 if(o.glide&&Math.hypot(P[0]-p[0],P[1]-p[2],P[2]-p[4])<1)o.glide=0;
 cineSpr(o.fv,0,cineFovT(),C.fovW,rdt);
 const B=C.breath,n=o.n;
 camera.position.set(p[0]+B*(.5*Math.sin(n*.43)+.25*Math.sin(n*.71+1)),p[2]+B*.35*Math.sin(n*.37+2),p[4]+B*.45*Math.sin(n*.29+3));
 camera.lookAt(l[0]+B*.25*Math.sin(n*.53+4),l[2]+B*.2*Math.sin(n*.61+5),l[4]+B*.25*Math.sin(n*.47+6));
 const fov=o.fov0*o.fv[0];
 if(Math.abs(camera.fov-fov)>1e-4){camera.fov=fov;camera.updateProjectionMatrix();}
 S.camLookX=l[0];
 return true;
}
// hand the camera back with the base fov; returns the last aim (the menu ease starts from it), null if it wasn't live
function cineOff(){
 const o=CINE;if(!o.on)return null;o.on=false;o.id=null;
 camera.fov=o.fov0;camera.updateProjectionMatrix();
 return[o.l[0],o.l[2],o.l[4]];
}
// the fov with no cinematic zoom (the replay restores to it)
function cineFovBase(){return CINE.on?CINE.fov0:camera.fov;}
