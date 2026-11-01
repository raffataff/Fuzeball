'use strict';
// ================= BOOST: a power hit you can see, and a team you can see is boosted =================
// boost (S.eff[team].boost) multiplies a rod's strike impulse and lifts the ball's speed ceiling (physics.js collideRod) and showed nothing on the table; this shows it in two layers
// THE HIT: a boosted strike that leaves the boot fast gets a flash, a ring and a fan of sparks off the ball and a small camera punch, and the ball keeps a gold comet behind it
//   boostTouch is the one hook (collideRod, both contact passes), boostTrail rides spawnTrail (fx.js)
// THE STATE: every boot of a boosted team glows (one Points draw a team), the handle knobs go gold, a wave runs the rods at pickup, the glow stutters out in the last seconds and ends in a pop,
//   and the rod-hole stamina rings flash gold with it (boostRing rides rodHolesUpdate, fx.js)
//   boostUpdate rides fxUpdate, boostBuild rides the warm pass (fracture.js), boostClear rides the match start (flow.js); tuning in CONFIG.fx.boost

const BO=CONFIG.fx.boost;
const BOS={pn:[-9,-9],col:null,hot:null,rgb:null,gold:null};
const BOG={built:false,pts:[null,null],tm:[{live:false,age:0,until:0,men:[],kn:[]},{live:false,age:0,until:0,men:[],kn:[]}]};
const _boC=new THREE.Color(),_boW=new THREE.Color(0xffffff),_boG=new THREE.Color(),_boP=[0,0,0];

function boostSetup(){
 if(BOS.col)return;
 BOS.col=vfxLin(BO.col);BOS.hot=vfxLin(BO.hot);
 BOS.rgb=[BOS.col[0]*0.7+BOS.hot[0]*0.3,BOS.col[1]*0.7+BOS.hot[1]*0.3,BOS.col[2]*0.7+BOS.hot[2]*0.3];
}
function boostFxOn(){return typeof vfxLive==='function'&&vfxLive()&&cfg.particles;}
function boSm(t){t=t<0?0:t>1?1:t;return t*t*(3-2*t);}
function boHash(n){const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s);}

// --- the hit ---
// every contact of a rod and a ball, after the impulse: a power hit when a boosted rod's swing has just sent it away fast
function boostTouch(b,r,hold){
 if(b.pw>0&&(b.pwRod!==r||(r.pwAt||0)<=S.time))b.pw=0;   // a touch by anyone but the swing that threw it ends the comet
 if(!BO.on||hold||!(S.eff[r.team].boost>S.time))return;
 if(!boostSwing(r))return;   // only a contact the boost powered (physics.js): a strike, not a trap, pin, tap, slide or bounce
 const w=(r.pwAt||0)-S.time;
 if(w>0&&w<=BO.gap)return;                                // one a swing (a stamp left from the last match is further out than the gap)
 const v=b.v,sp=Math.hypot(v.x,v.y,v.z);
 if(sp<BO.min)return;
 r.pwAt=S.time+BO.gap;
 boostHit(b,r,sp);
}
function boostHit(b,r,sp){
 const k=clamp((sp-BO.min)/Math.max(1,BO.full-BO.min),0,1),p=b.m.position,x=p.x,y=p.y,z=p.z;
 let hx=b.v.x,hz=b.v.z;const hl=Math.hypot(hx,hz)||1;hx/=hl;hz/=hl;
 b.pw=BO.trail.life*lerp(0.7,1.2,k);b.pwRod=r;
 Au.play('power_hit',{p:sp});
 const fx=typeof vfxLive==='function'&&vfxLive();
 if(fx&&cfg.particles){
  boostSetup();
  const FL=BO.flash,RG=BO.ring,SK=BO.sparks,c=BOS.col,hot=BOS.hot,fs=lerp(FL.size[0],FL.size[1],k);
  vfxBlast(2,x,y,z,0,0,0,FL.life,fs*0.6,fs,hot,FL.power,c);
  vfxBlast(1,x,0.3,z,0,1,0,RG.life,1.5,lerp(RG.size[0],RG.size[1],k),hot,RG.power,c);
  const n=Math.round(lerp(SK.n[0],SK.n[1],k));
  for(let i=0;i<n;i++){
   const d=vfxDir(hx,0.15,hz,SK.cone),s=vfxRg(SK.speed)*(0.6+0.6*k);
   vfxSpk(x,y,z,d[0]*s,d[1]*s,d[2]*s,vfxRg(SK.life),Math.random()<0.45?hot:c,SK.power*rand(0.7,1.1),vfxRg(SK.size),vfxRg([1.6,2.4]),1,SK.tail,1,0);
  }
 }else if(cfg.particles&&typeof burst==='function')burst(p,_boC.set(BO.col),_boW,10,38);
 if(fx){
  const w=BOS.pn[r.team]-S.time;
  if(!(w>0&&w<=BO.punch.gap)){BOS.pn[r.team]=S.time+BO.punch.gap;vfxPunch(hx,hz,BO.punch.k*k);}
  if(BO.light>0)vfxLight(null,true,x,y+3,z,BO.col,48,BO.light*(0.4+0.6*k),0.03,9,0);
 }
}
// the comet: streaks and glints shed behind a ball a power hit threw while it is still quick; the sprite trail's own colour is boostTrail
function boostComet(rdt){
 if(!S.balls)return;
 const live=boostFxOn(),T=BO.trail;
 if(live)boostSetup();
 for(const b of S.balls){
  if(!(b.pw>0))continue;
  b.pw=Math.max(0,b.pw-rdt);
  if(!live||b.pw<=0)continue;
  const v=b.v,sp=Math.hypot(v.x,v.y,v.z);
  if(sp<T.min)continue;
  const f=Math.min(1,b.pw/T.fade),p=b.m.position;
  for(let i=0;i<T.streaks;i++)   // short bright dashes along the flight that slow behind the ball: the tail
   vfxSpk(p.x,p.y,p.z,v.x*0.45+rand(-3,3),v.y*0.45+rand(0,3),v.z*0.45+rand(-3,3),rand(0.28,0.45),
    Math.random()<0.4?BOS.hot:BOS.col,T.power*f,vfxRg(T.streakSize),2.4,0.2,T.tail,0,0);
  for(let i=0;i<T.glints;i++)     // and a twinkle or two round it
   vfxSpk(p.x+rand(-0.6,0.6),p.y+rand(-0.5,0.5),p.z+rand(-0.6,0.6),-v.x*0.06+rand(-4,4),rand(0,5),-v.z*0.06+rand(-4,4),rand(0.2,0.42),
    Math.random()<0.5?BOS.hot:BOS.col,T.power*f,vfxRg(T.size),2.0,0.4,0,2,0);
 }
}
// spawnTrail (fx.js) for a ball with a comet: the sprite goes gold and a little bigger, fading back as the comet ends
function boostTrail(s,b){
 const T=BO.trail,f=Math.min(1,b.pw/T.fade),sc=lerp(1,T.scale,f);
 s.material.color.lerp(_boC.set(BO.col),0.9*f);
 s.scale.set(3.2*sc,3.2*sc,1);
}

// --- the state ---
// a boot's centre in the world, off the displayed pose of its rod (pivot.rotation.z is the interpolated angle)
function boostBoot(r,mi,o){
 const a=r.pivot.rotation.z,ca=Math.cos(a),sa=Math.sin(a),G=BO.glow,lx=G.fwd*r.kickDir,ly=PLAYER_H+G.up;
 o[0]=r.x+lx*ca-ly*sa;o[1]=ROD_H+lx*sa+ly*ca;o[2]=r.pivot.position.z+r.baseZ[mi];
 return o;
}
function boostManAlive(r,mi){const ru=r.removedUntil[mi];return (!ru||ru<=S.time)&&r.men[mi].visible!==false;}
// one resident Points a team (up to a team's 11 boots), hidden until a boost lands, so its shader compiles with the scene
function boostBuild(){
 if(BOG.built||!BO.on||typeof scene==='undefined'||!scene||typeof spriteTex==='undefined'||!spriteTex)return;
 for(let t=0;t<2;t++){
  const g=new THREE.BufferGeometry(),n=BO.glow.max;
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3),3));
  const m=new THREE.PointsMaterial({map:spriteTex,size:BO.glow.size,sizeAttenuation:true,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const p=new THREE.Points(g,m);
  p.frustumCulled=false;p.visible=false;p.renderOrder=5;
  scene.add(p);BOG.pts[t]=p;
 }
 BOG.built=true;
}
// the handles: the shared team glow material and every rod GLB's own clone of it
function boostKnobs(t){
 const out=[],seen=new Set(),add=m=>{if(!m||seen.has(m)||!m.emissive)return;seen.add(m);out.push({m:m,c:m.color.clone(),e:m.emissive.clone(),i:m.emissiveIntensity});};
 if(typeof teamGlow!=='undefined')add(teamGlow[t]);
 if(typeof rodCustomMats!=='undefined')for(const c of rodCustomMats)if(c.isGlow&&c.team===t)add(c.mat);
 return out;
}
function boostKnobsRestore(T){
 for(const k of T.kn){k.m.color.copy(k.c);k.m.emissive.copy(k.e);k.m.emissiveIntensity=k.i;}
 T.kn=[];
}
// the pickup: a pulse runs every rod from its handle end over its men, rod by rod from the keeper out (all spawned at once with delays); each boot lights as it passes
function boostOnset(t,T,until,first){
 boostSetup();
 const W=BO.wave,dir=t===0?1:-1,zs=F.W/2+6,ze=-F.W/2-1,fx=boostFxOn();
 const order=rods.filter(r=>r.team===t).sort((a,b)=>a.x*dir-b.x*dir);
 if(first){
  T.live=true;T.age=0;T.men=[];
  T.kn=boostKnobs(t);
 }
 T.until=until;
 Au.play('boost_on');
 let ri=0;
 for(const r of order){
  const d0=ri*W.stagger;ri++;
  r.boAt=T.age+d0+BO.gauge.delay;   // its stamina ring flashes as the wave enters the rod
  if(fx){
   vfxBlast(2,r.x,ROD_H,zs,0,0,0,0.2,2,4.5,BOS.hot,W.power*0.6,BOS.col,d0);   // the handle end takes it
   for(let j=0;j<W.steps;j++){
    const u=j/(W.steps-1),z=lerp(zs,ze,u);
    vfxSpk(r.x,ROD_H+rand(-0.4,0.4),z,rand(-3,3),rand(2,7),rand(-3,3),rand(0.2,0.34),Math.random()<0.5?BOS.hot:BOS.col,W.power,rand(0.14,0.26),2.0,0.8,0,2,d0+u*W.travel);
   }
  }
  for(let mi=0;mi<r.baseZ.length;mi++){
   const bz=r.baseZ[mi]+r.pivot.position.z,u=clamp((zs-bz)/(zs-ze),0,1),dl=d0+u*W.travel;
   let m=first?null:T.men.find(q=>q.r===r&&q.mi===mi);
   if(!m){m={r:r,mi:mi,ph:boHash(r.idx*12.9+mi*78.2)*6.2832,t0:dl,px:NaN,py:0,pz:0,on:true};T.men.push(m);}
   if(fx){
    boostBoot(r,mi,_boP);
    vfxBlast(2,_boP[0],_boP[1],_boP[2],0,0,0,0.18,W.pop[0],W.pop[1],BOS.hot,W.power*0.55,BOS.col,dl);
    for(let i=0;i<4;i++)vfxSpk(_boP[0],_boP[1],_boP[2],rand(-8,8),rand(6,16),rand(-8,8),rand(0.25,0.45),Math.random()<0.5?BOS.hot:BOS.col,W.power,rand(0.14,0.26),1.8,1,0.03,1,dl);
   }
  }
 }
}
// the end: a pop at every boot that is still there (a match start or the menu just lets go)
function boostEnd(t,T,fx){
 T.live=false;
 boostKnobsRestore(T);
 const P=BOG.pts[t];if(P)P.visible=false;
 for(const m of T.men){m.r.boHold=0;m.r.boAt=null;m.r.boFl=fx?1:0;}   // the pop reaches the rings too
 if(!fx)return;
 const E=BO.end;
 for(const m of T.men){
  if(!boostManAlive(m.r,m.mi))continue;
  boostBoot(m.r,m.mi,_boP);
  if(boostFxOn()){
   boostSetup();
   vfxBlast(2,_boP[0],_boP[1],_boP[2],0,0,0,0.16,E.pop[0],E.pop[1],BOS.hot,E.power,BOS.col,0);
   for(let i=0;i<E.sparks;i++)vfxSpk(_boP[0],_boP[1],_boP[2],rand(-14,14),rand(4,18),rand(-14,14),rand(0.25,0.5),Math.random()<0.5?BOS.hot:BOS.col,E.power,rand(0.14,0.26),1.8,1,0.04,1,0);
  }
 }
 T.men=[];
 Au.play('boost_off');
}
// the stamina rings (fx.js rodHolesUpdate calls boostRing after it has written the ring's glow): a gold flash that decays, and a faint tint while the team holds a boost; the fill is left alone, so the reading stays
function boostRings(rdt){
 if(typeof rods==='undefined')return;
 const d=rdt/Math.max(0.01,BO.gauge.decay);
 for(const r of rods)if(r.boFl>0)r.boFl=Math.max(0,r.boFl-d);
}
function boostRing(r,g){
 const f=Math.max(r.boFl||0,r.boHold||0);
 if(!(f>0.001)||!BOS.gold)return;
 g.lerp(_boG.copy(BOS.gold).multiplyScalar(BO.gauge.glow),Math.min(1,f));
}
function boostGlow(rdt){
 if(!BOG.built){boostBuild();if(!BOG.built)return;}
 if(!BOS.col&&typeof vfxLin==='function')boostSetup();
 const live=S.phase!=='menu',hide=S.phase==='replay',fxp=boostFxOn(),G=BO.glow,E=BO.end,SM=BO.smear;
 for(let t=0;t<2;t++){
  const T=BOG.tm[t],until=S.eff[t].boost,on=live&&until>S.time;
  if(on&&(!T.live||until>T.until+0.5))boostOnset(t,T,until,!T.live);
  else if(!on&&T.live)boostEnd(t,T,live);
  const P=BOG.pts[t];
  if(!on){if(P&&P.visible)P.visible=false;continue;}
  T.until=until;T.age+=rdt;
  const left=until-S.time,w=left<E.warn?1-left/E.warn:0,pos=P.geometry.attributes.position.array,col=P.geometry.attributes.color.array;
  let n=0,teamK=0;
  for(const m of T.men)m.r.boK=0;
  for(const m of T.men){
   const r=m.r,mi=m.mi;
   if(r.boAt!=null&&T.age>=r.boAt){r.boFl=1;r.boAt=null;}
   boostBoot(r,mi,_boP);
   const alive=boostManAlive(r,mi);
   let k=alive?boSm((T.age-m.t0)/G.rise):0;
   k*=1+G.breath*Math.sin(T.age*G.hz*6.2832+m.ph);
   if(w>0&&k>0){
    const f1=Math.sin(left*41+m.ph*5)*0.5+0.5,f2=Math.sin(left*17+m.ph*3+1.3)*0.5+0.5,up=f1*0.6+f2*0.4>w*E.cut;
    if(up&&!m.on)r.boFl=1;   // every time the glow catches, the ring flashes
    if(up&&!m.on&&fxp&&E.spit)for(let i=0;i<3;i++)vfxSpk(_boP[0],_boP[1],_boP[2],rand(-6,6),rand(4,12),rand(-6,6),0.25,BOS.hot,E.power,0.2,2.5,1,0.04,1,0);
    m.on=up;
    if(!up)k*=E.floor;
   }else m.on=true;
   // a boot that is moving leaves a soft glow behind it
   if(fxp&&alive&&k>0.3&&m.px===m.px&&rdt>0){
    const sp=Math.hypot(_boP[0]-m.px,_boP[1]-m.py,_boP[2]-m.pz)/rdt;
    if(sp>SM.v)vfxSpk(_boP[0],_boP[1],_boP[2],0,0,0,SM.life,BOS.rgb,SM.power*k,SM.size,0,0,0,4,0);
   }
   m.px=_boP[0];m.py=_boP[1];m.pz=_boP[2];
   // the point sits `lift` toward the camera, in front of the boot, so the glow washes it instead of hiding behind it
   const cx=camera.position.x-_boP[0],cy=camera.position.y-_boP[1],cz=camera.position.z-_boP[2],cl=G.lift/(Math.hypot(cx,cy,cz)||1);
   pos[n*3]=_boP[0]+cx*cl;pos[n*3+1]=_boP[1]+cy*cl;pos[n*3+2]=_boP[2]+cz*cl;
   const c=G.power*k;
   col[n*3]=BOS.rgb[0]*c;col[n*3+1]=BOS.rgb[1]*c;col[n*3+2]=BOS.rgb[2]*c;
   if(k>teamK)teamK=k;
   if(k>r.boK)r.boK=k;
   n++;
  }
  for(const m of T.men)m.r.boHold=BO.gauge.hold*clamp(m.r.boK,0,1);
  P.geometry.setDrawRange(0,n);
  P.geometry.attributes.position.needsUpdate=true;P.geometry.attributes.color.needsUpdate=true;
  P.visible=n>0&&!hide;
  // the handles follow the brightest boot of the team
  const kh=clamp(teamK,0,1.2);
  for(const q of T.kn){
   q.m.color.copy(q.c).lerp(BOS.gold,BO.knob.k*Math.min(1,kh));
   q.m.emissive.copy(q.e).lerp(BOS.gold,BO.knob.k*Math.min(1,kh));
   q.m.emissiveIntensity=q.i*(1+BO.knob.glow*kh);
  }
 }
}

function boostUpdate(rdt){
 if(!BO.on||!(rdt>0)||typeof S==='undefined'||typeof rods==='undefined')return;
 if(!BOS.gold&&typeof kitLin==='function')BOS.gold=kitLin(BO.col);
 boostRings(rdt);
 boostGlow(rdt);
 boostComet(rdt);
}
// a match start / the menu: no stamp, comet or glow left from the last one, the handles as they were
function boostClear(){
 BOS.pn[0]=BOS.pn[1]=-9;
 if(typeof rods!=='undefined')for(const r of rods){r.pwAt=0;r.boFl=0;r.boHold=0;r.boAt=null;}
 if(typeof S!=='undefined'&&S.balls)for(const b of S.balls){b.pw=0;b.pwRod=null;}
 for(let t=0;t<2;t++){
  const T=BOG.tm[t];
  boostKnobsRestore(T);
  T.live=false;T.age=0;T.men=[];
  if(BOG.pts[t])BOG.pts[t].visible=false;
 }
}
