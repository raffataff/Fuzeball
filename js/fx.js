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
/* Cannonball detonation FX at world `pos` (the ball's spot at the instant it
   blows). Layered particle blast + white flash + screen shake + boom, then the
   3D shard debris (spawnBallFracture, fracture.js). The particles fire even if
   the fracture GLB never loaded, so there's always a visible bang. Call from
   balls.js cannonballUpdate BEFORE removeBall clears the ball mesh. */
function cannonExplodeFx(pos){
 const p=pos.clone();p.y=Math.max(p.y,1.5);                 // keep the puff off the floor for the ground-level rings
 const fire=new THREE.Color(0xff6a1a),spark=new THREE.Color(0xffd24d),
       white=new THREE.Color(0xffffff),smoke=new THREE.Color(0x4a4a4a);
 burst(p,fire,spark,240,92);      // fireball core
 burstRing(p,fire,smoke,150,72);   // ground shockwave + smoke ring
 burstUp(p,spark,white,100,84);    // spark fountain
 burst(p,smoke,smoke,70,40);       // lingering smoke puff
 flash();S.shake=1.9;Au.boom();
 spawnBallFracture(pos);           // 3D debris at the TRUE pos (keeps its real height)
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
 bigGoalUpdate(rdt);
}
/* Big-goal widen. goalFrames[i].scale.z is the already-lerped mouth multiplier (1..bigGoalMult)
   per goal: index 1 = right (+x, S.eff[0]), 0 = left (-x, S.eff[1]); the procedural diamond net
   rides it for free (it lives in the goalFrames group). A table GLB's baked frame + end-walls are
   separate identity meshes with world-space verts, so we drive them off the same multiplier:
   frame parts scale about the goal line (z=0); end-walls keep their outer edge pinned and slide the
   inner edge to goalHalf*mult so they open in step with the mouth. Arrays are empty when a table
   ships no such meshes (e.g. the arena's one-piece bowl) — then only the net widens, as before. */
function bigGoalUpdate(rdt){
 goalFrames[1].scale.z=lerp(goalFrames[1].scale.z,S.eff[0].big>S.time?PHY.bigGoalMult:1,Math.min(1,rdt*6));
 goalFrames[0].scale.z=lerp(goalFrames[0].scale.z,S.eff[1].big>S.time?PHY.bigGoalMult:1,Math.min(1,rdt*6));
 for(let gi=0;gi<2;gi++){
  const g=goalFrames[gi],m=g.scale.z;                          // shared lerped multiplier for this goal
  const grow=glbGoalGrow[gi];for(let k=0;k<grow.length;k++)grow[k].scale.z=m;
  const wall=glbGoalWall[gi];
  for(let k=0;k<wall.length;k++){const w=wall[k],ni=w.sgn*F.goalHalf*m,a=(w.outer-ni)/(w.outer-w.inner);
   w.o.scale.z=a;w.o.position.z=w.outer-a*w.outer;}                 // inner edge -> goalHalf*mult, outer edge pinned
  // net taper: the group scales z uniformly by m, so counter-scale each panel's LOCAL z toward the
  // back (local x → goalDepth) so its WORLD width eases from m at the mouth to backM at the rear —
  // keeps the net inside the wall gap behind the goal. Runs only while open, +1 restore frame on settle.
  const nets=g.userData.net;if(nets){
   const active=Math.abs(m-1)>1e-4;
   if(active||g.userData.netDirty){const backM=1+(m-1)*PHY.bigGoalBack,GD=F.goalDepth;
    for(let n=0;n<nets.length;n++){const nm=nets[n],b=nm.userData.base,ar=nm.geometry.attributes.position.array;
     for(let v=0;v<b.length;v+=3){const fr=Math.min(1,Math.abs(b[v])/GD);ar[v+2]=b[v+2]*(lerp(m,backM,fr)/m);}
     nm.geometry.attributes.position.needsUpdate=true;}
    g.userData.netDirty=active;}
  }
 }
 if(glbGoalSplit.length){const mR=goalFrames[1].scale.z,mL=goalFrames[0].scale.z,active=Math.abs(mR-1)>1e-4||Math.abs(mL-1)>1e-4;
  for(let s=0;s<glbGoalSplit.length;s++){const q=glbGoalSplit[s];
   if(!active&&!q.dirty)continue;                                   // a both-goals frame mesh: each half widens by its own goal's mult
   const b=q.base,ar=q.o.geometry.attributes.position.array;
   for(let v=0;v<b.length;v+=3)ar[v+2]=b[v+2]*(b[v]>0?mR:mL);       // baked at identity → local z == world z
   q.o.geometry.attributes.position.needsUpdate=true;q.dirty=active;}
 }
 if(typeof arenaMorphUpdate==='function')arenaMorphUpdate();        // curved arena shell (baked GLB) opens via SDF re-projection
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
