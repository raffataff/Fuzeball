'use strict';
/* ================= FX ================= */
function flash(){const f=$('flash');f.style.transition='none';f.style.opacity=.85;
 requestAnimationFrame(()=>{f.style.transition='opacity .5s';f.style.opacity=0;});}
let bannerTO=null;
function banner(main,sub,dur){
 const b=$('banner');
 b.innerHTML=main+(sub?'<span id="bannerSub">'+sub+'</span>':'');
 b.classList.remove('show');void b.offsetWidth;b.classList.add('show');
 clearTimeout(bannerTO);bannerTO=setTimeout(()=>b.classList.remove('show'),(dur||1.6)*1000);
}
function spawnTrail(b){
 for(const s of sprites){if(s.visible)continue;
  s.visible=true;s.position.copy(b.m.position);
  s.userData.life=.38;
  s.material.color.set(b.t.trail);
  s.scale.set(3.2,3.2,1);s.material.opacity=.75;
  return;}
}
function burst(pos,c1,c2,n,speed){
 let placed=0;
 const arr=pGeo.attributes.position.array,col=pGeo.attributes.color.array;
 for(let i=0;i<pCount&&placed<n;i++){
  if(pData[i].life>0)continue;
  pData[i].life=rand(.5,1.1);
  const th=rand(0,Math.PI*2),ph=rand(-.3,1.2),sp=rand(.3,1)*speed;
  pData[i].vx=Math.cos(th)*Math.cos(ph)*sp;
  pData[i].vy=Math.sin(ph)*sp+14;
  pData[i].vz=Math.sin(th)*Math.cos(ph)*sp;
  arr[i*3]=pos.x;arr[i*3+1]=pos.y;arr[i*3+2]=pos.z;
  const c=Math.random()<.5?c1:c2;
  col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  placed++;
 }
 pGeo.attributes.position.needsUpdate=true;pGeo.attributes.color.needsUpdate=true;
}
function burstRing(pos,c1,c2,n,speed){
 let placed=0;
 const arr=pGeo.attributes.position.array,col=pGeo.attributes.color.array;
 for(let i=0;i<pCount&&placed<n;i++){
  if(pData[i].life>0)continue;
  pData[i].life=rand(.4,1.0);
  const angle=rand(0,Math.PI*2),sp=rand(.4,1)*speed;
  pData[i].vx=Math.cos(angle)*sp;
  pData[i].vy=rand(-.1,.15)*sp;
  pData[i].vz=Math.sin(angle)*sp;
  arr[i*3]=pos.x;arr[i*3+1]=pos.y;arr[i*3+2]=pos.z;
  const c=Math.random()<.5?c1:c2;
  col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  placed++;
 }
 pGeo.attributes.position.needsUpdate=true;pGeo.attributes.color.needsUpdate=true;
}
function burstUp(pos,c1,c2,n,speed){
 let placed=0;
 const arr=pGeo.attributes.position.array,col=pGeo.attributes.color.array;
 for(let i=0;i<pCount&&placed<n;i++){
  if(pData[i].life>0)continue;
  pData[i].life=rand(.5,1.2);
  const th=rand(0,Math.PI*2),ph=rand(.15,1.3),sp=rand(.3,1)*speed;
  pData[i].vx=Math.cos(th)*Math.cos(ph)*sp*.4;
  pData[i].vy=Math.sin(ph)*sp+8;
  pData[i].vz=Math.sin(th)*Math.cos(ph)*sp*.4;
  arr[i*3]=pos.x;arr[i*3+1]=pos.y;arr[i*3+2]=pos.z;
  const c=Math.random()<.5?c1:c2;
  col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  placed++;
 }
 pGeo.attributes.position.needsUpdate=true;pGeo.attributes.color.needsUpdate=true;
}
let ledGoalTeam=-1,ledGoalT=0;
function goalFx(team,b){
 const col=new THREE.Color(team===0?cfg.redColor:cfg.blueColor);
 const gold=new THREE.Color(0xffcf4d);
 const white=new THREE.Color(0xffffff);
 const pos=b.m.position.clone();pos.y+=1.5;
 burst(pos,col,white,220,78);      // main explosion
 burstRing(pos,col,white,120,60);   // horizontal ring blast
 burstUp(pos,col,gold,90,70);       // upward fountain with gold
 burst(pos,gold,white,60,50);       // gold sparkle
 flash();S.shake=1.5;Au.goal();
 const gi=team===0?1:0;
 goalLights[gi].color.copy(col);goalLights[gi].intensity=4;
 ledGoalTeam=team;ledGoalT=MATCH.goalHold;
}
/* LED strips: strobe the scorer's colour on a goal, else the configured idle
   look (rainbow hue-cycle or theme colour) with a brightness pulse. */
function ledUpdate(rdt){
 if(!ledMat)return;
 const L=CONFIG.leds;
 if(ledGoalT>0){
  ledGoalT-=rdt;
  const c=ledGoalTeam===0?cfg.redColor:cfg.blueColor,ph=MATCH.goalHold-ledGoalT;
  ledMat.color.set(c);if(ledMat.emissive)ledMat.emissive.set(c);
  ledMat.emissiveIntensity=L.goalBright*(Math.sin(ph*L.goalStrobe*Math.PI*2)>0?1:.12);
  return;
 }
 if(L.idle==='rainbow'){
  const h=(S.time*L.hueSpeed)%1;
  ledMat.color.setHSL(h,1,.55);if(ledMat.emissive)ledMat.emissive.setHSL(h,1,.5);
 }
 ledMat.emissiveIntensity=L.baseBright+Math.sin(S.time*L.pulseSpeed)*L.pulse+Au.exc*L.excite;
}
function confetti(w){
 const cols=[w===0?cfg.redColor:cfg.blueColor,'#ffffff','#ffcf4d'];
 for(let i=0;i<90;i++){
  const d=document.createElement('div');d.className='confetti';
  d.style.left=(Math.random()*100)+'vw';
  d.style.background=cols[i%cols.length];
  d.style.animationDuration=(2.2+Math.random()*2)+'s';
  d.style.animationDelay=(Math.random()*.8)+'s';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),5500);
 }
}
function fxUpdate(rdt){
 for(const s of sprites){if(!s.visible)continue;
  s.userData.life-=rdt;
  if(s.userData.life<=0){s.visible=false;continue;}
  const k=s.userData.life/.38;
  s.material.opacity=.75*k;const sc=3.2*k+.4;s.scale.set(sc,sc,1);}
 const arr=pGeo.attributes.position.array;let any=false;
 for(let i=0;i<pCount;i++){const pd=pData[i];if(pd.life<=0)continue;any=true;
  pd.life-=rdt;pd.vy-=80*rdt;
  arr[i*3]+=pd.vx*rdt;arr[i*3+1]+=pd.vy*rdt;arr[i*3+2]+=pd.vz*rdt;
  if(pd.life<=0||arr[i*3+1]<-2){pd.life=0;arr[i*3+1]=-999;}}
 if(any)pGeo.attributes.position.needsUpdate=true;
 goalLights.forEach(g=>g.intensity=Math.max(0,g.intensity-rdt*3));
 ledUpdate(rdt);
 if(crowdMesh)crowdMesh.rotation.y+=rdt*.01;
 if(S.pu.obj&&S.phase!=='play')S.pu.obj.rotation.y+=rdt*2.4;
 let fb=null;
 for(const b of S.balls)if(b.m.position.y>7&&b.v.y<0&&!b.scored){fb=b;break;}
 if(fb){dropRing.visible=true;
  dropRing.position.x=fb.m.position.x;dropRing.position.z=fb.m.position.z;
  dropRing.material.opacity=.35+Math.sin(S.time*12)*.25;
  const sc=1+fb.m.position.y*.05;dropRing.scale.set(sc,sc,1);}
 else dropRing.visible=false;
 if(S.userTeam>=0&&S.ctrlRods.length&&(S.phase==='play'||S.phase==='count'||S.phase==='pause')){
  const r=S.ctrlRods[S.ctrl];
  indicator.visible=true;
  indicator.position.set(r.x,ROD_H+9+Math.sin(S.time*5)*.8,r.offset);
  indicator.material.color.set(S.userTeam===0?cfg.redColor:cfg.blueColor);
  indicator.rotation.y+=rdt*2;
 }else indicator.visible=false;
 goalFrames[1].scale.z=lerp(goalFrames[1].scale.z,S.eff[0].big>S.time?PHY.bigGoalMult:1,Math.min(1,rdt*6));
 goalFrames[0].scale.z=lerp(goalFrames[0].scale.z,S.eff[1].big>S.time?PHY.bigGoalMult:1,Math.min(1,rdt*6));
}
function cameraUpdate(rdt){
 if(S.freeRoam){
  camera.rotation.order='YXZ';
  camera.rotation.set(S.camPitch,S.camYaw,0);
  let spd=CAM.freeRoamSpeed*rdt;
  if(keys.ShiftLeft||keys.ShiftRight)spd*=CAM.freeRoamSprint;
  const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  fwd.y=0;fwd.normalize();
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  right.y=0;right.normalize();
  if(keys.KeyW||keys.ArrowUp)camera.position.addScaledVector(fwd,spd);
  if(keys.KeyS||keys.ArrowDown)camera.position.addScaledVector(fwd,-spd);
  if(keys.KeyA||keys.ArrowLeft)camera.position.addScaledVector(right,-spd);
  if(keys.KeyD||keys.ArrowRight)camera.position.addScaledVector(right,spd);
  if(keys.KeyQ)camera.position.y+=spd;
  if(keys.KeyE)camera.position.y-=spd;
  return;
 }
 let bx=0;
 if(S.balls.length){for(const b of S.balls)bx+=b.m.position.x;bx/=S.balls.length;}
 const m=CAM.modes[S.camMode];
 const fx=(S.camMode===1||S.camMode===3||S.camMode===4)?0:bx*CAM.follow;
 const k=Math.min(1,rdt*CAM.lerp);
 camera.position.x=lerp(camera.position.x,m[0]+fx,k);
 camera.position.y=lerp(camera.position.y,m[1],k);
 camera.position.z=lerp(camera.position.z,m[2],k);
 if(S.shake>0){S.shake=Math.max(0,S.shake-rdt*CAM.shakeDecay);
  camera.position.x+=rand(-1,1)*S.shake*CAM.shakeX;
  camera.position.y+=rand(-1,1)*S.shake*CAM.shakeY;}
 S.camLookX=lerp(S.camLookX,m[3]+bx*CAM.lookFollow,k);
 camera.lookAt(S.camLookX,m[4],m[5]);
}
