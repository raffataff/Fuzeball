'use strict';
/* ================= FX ================= */
function flash(){const f=$('flash');f.style.transition='none';f.style.opacity=.85;
 requestAnimationFrame(()=>{f.style.transition='opacity .5s';f.style.opacity=0;});}
/* ---- notification channels -------------------------------------------------
   THREE weights, deliberately not interchangeable. Everything used to funnel through banner(),
   so toggling the kick log got the same 66px screen-wide treatment as scoring — a dev toggle and
   a match-deciding goal must not read alike.
     banner(main,sub,dur,col)  tier 1 · stop-the-world: kickoff, goal, sudden death, full time.
     notice(main,dur,col)      tier 2 · a live event the player already SAW — one line, top of
                               screen, no explanatory subtitle narrating the visuals.
     toast(main,sub,dur)       tier 3 · system/dev chatter — small, bottom-left, out of the way.
   `col` accents the underline rule / left bar; pass the team or ball colour so the message is
   colour-coded to whoever it belongs to instead of the old team-neutral blue glow. */
let bannerTO=null,noticeTO=null,toastTO=null;
function banner(main,sub,dur,col){
 const b=$('banner');
 b.style.setProperty('--bc',col||'#dbe6ff');
 // main is wrapped so the accent rule (#bannerMain::after) sits under the HEADLINE — hung off
 // #banner it would land under the sub chip instead whenever a sub is present.
 b.innerHTML='<span id="bannerMain">'+main+'</span>'+(sub?'<span id="bannerSub">'+sub+'</span>':'');
 b.classList.remove('show');void b.offsetWidth;b.classList.add('show');
 clearTimeout(bannerTO);bannerTO=setTimeout(()=>b.classList.remove('show'),(dur||1.6)*1000);
}
function notice(main,dur,col){
 const n=$('notice');if(!n)return;
 n.style.setProperty('--nc',col||'#9db2d8');
 n.textContent=main;
 n.classList.remove('show');void n.offsetWidth;n.classList.add('show');
 clearTimeout(noticeTO);noticeTO=setTimeout(()=>n.classList.remove('show'),(dur||1.3)*1000);
}
function toast(main,sub,dur){
 const t=$('toast');if(!t)return;
 t.innerHTML='<b>'+main+'</b>'+(sub?'<span>'+sub+'</span>':'');
 t.classList.remove('show');void t.offsetWidth;t.classList.add('show');
 clearTimeout(toastTO);toastTO=setTimeout(()=>t.classList.remove('show'),(dur||1.6)*1000);
}
/* Charge verdict colours, indexed by the band js/shots.js stamps on the rod when a wind-up ends:
   0 too early, 1 clean, 2 overcooked, 3 no room to swing. The two scratch Colors are what lets the
   stamp settle back to the seat tint without allocating a Color every frame it is on screen. */
const CHG_COL=CONFIG.shots.charge.bandCol;
const chgC=new THREE.Color(),chgC2=new THREE.Color();
/* …and the same verdict IN WORDS. The marker's colour is the whole readout once you know what gold
   means; the words are how you learn it, so they are a coaching tool and stay in Training and
   Trials unless CONFIG.shots.charge.text.inMatch says otherwise (a trial runs as training, so one
   S.trn test covers both). Driven off the MARKER's edge rather than called from shots.js: the shot
   code stays clear of the DOM, and one place decides that a verdict is on screen. */
function chgSay(r){
 const T=CONFIG.shots.charge.text;
 if(!T.on||(!S.trn&&!T.inMatch))return;
 const lab=T.labels[r.chgEndBand];
 if(lab)notice(lab,T.dur,CHG_COL[r.chgEndBand]);
}
function spawnTrail(b){
 if(!cfg.trails)return;                    // Options → Display · Effects
 for(const s of sprites){if(s.visible)continue;
  s.visible=true;s.position.copy(b.m.position);
  s.userData.life=.38;
  s.material.color.set(b.t.trail);
  s.scale.set(3.2,3.2,1);s.material.opacity=.75;
  return;}
}
function burst(pos,c1,c2,n,speed){
 if(!cfg.particles)return;                 // Options → Display · Effects
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
 if(!cfg.particles)return;                 // Options → Display · Effects
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
 if(!cfg.particles)return;                 // Options → Display · Effects
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
 const L=(typeof curLeds!=='undefined'&&curLeds)?curLeds:CONFIG.leds;  // per-room LED mood (applyRoom); falls back to defaults
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
 // Photo mode's freeze (F1) stops the SIM, but particles, trails, the LED pulse and the drop ring
 // all run off wall-clock rdt — leave them going and a "frozen" goal explosion still drifts apart
 // under the shutter. Zeroing rdt holds the whole fx layer on the exact frame you froze, which is
 // the difference between catching a blast and photographing its smoke.
 if(S.photo&&S.photo.freeze&&S.photo.freezeFx)rdt=0;
 marksUpdate(rdt);   // wall scuffs age and fade (js/marks.js) — after the freeze, so they hold too
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
 if(S.pu.obj&&S.phase!=='play')S.pu.obj.rotation.y+=rdt*(S.pu.spin||PWR.spin);
 let fb=null;
 for(const b of S.balls)if(b.m.position.y>7&&b.v.y<0&&!b.scored){fb=b;break;}
 if(fb){dropRing.visible=true;
  dropRing.position.x=fb.m.position.x;dropRing.position.z=fb.m.position.z;
  dropRing.material.opacity=.35+Math.sin(S.time*12)*.25;
  const sc=1+fb.m.position.y*.05;dropRing.scale.set(sc,sc,1);}
 else dropRing.visible=false;
 // Held-rod markers, one per seat, tinted by SEAT colour (seats.js) — two players on the same
 // team share a kit colour, so the tint is the only thing telling their markers apart. The bob
 // is phase-offset per seat as well, so two markers never rise and fall in lockstep.
 const showInd=(S.phase==='play'||S.phase==='count'||S.phase==='pause');
 for(let i=0;i<indicators.length;i++){
  const m=indicators[i],s=showInd?S.seats[i]:null,r=s?seatRod(s):null;
  if(!r){m.visible=false;continue;}
  m.visible=true;
  /* CHARGE READOUT (js/shots.js). The marker is the only per-seat thing already on screen above the
     held rod, already tinted per seat and already built — so the wind-up gets its meter for the cost
     of a scale and a colour, with no new geometry and nothing to dispose. It DIPS toward the rod as
     the charge builds (the marker is being drawn back with the men), swells across the sweet band,
     and goes red once the charge is overcooked. Charge -1 = every term below is the old expression.
     TWO THINGS IT NO LONGER LIES ABOUT.
     · A wind-up the sweep guard is REFUSING (a ball sat against the boot) drains it to grey and
       drops both the dip and the swell. The charge number still climbs, but the arc is where the
       power is, so gold over a swing that is not happening was the readout promising a rocket.
     · The verdict OUTLIVES the release. It used to vanish on the frame you most wanted to read it.
       Now the marker holds that colour, lifts away from the rod and settles back to the seat tint
       over CONFIG.shots.charge.holdT. */
  const CH=CONFIG.shots.charge,base=seatCol(s);
  const k=shotCharge(r),blk=shotChargeBlock(r),bad=blk>=CH.blockAt;
  // 0..1 through the post-release hold; 1 means there is no verdict on screen.
  const vt=(k<0&&r.chgEndT!=null)?clamp((S.time-r.chgEndT)/Math.max(.01,CH.holdT),0,1):1;
  let sc=1,dip=0,spin=2;
  if(k>=0){                                                       // winding up
   const band=shotChargeBand(r),c=bad?CHG_COL[3]:(band>=1?CHG_COL[band]:base);
   if(m.userData.col!==c){m.userData.col=c;m.material.color.set(c);}  // parsing a hex string per frame
   dip=bad?0:k*3.2;                              // no pull-back means no dip: the men are not moving
   sc=bad?1:1+(band===1?.34+Math.sin(S.time*22)*.08:k*.28);
   spin=bad?2:2+k*7;                                              // it spins up as it winds up
  }else if(vt<1){                                                 // the verdict, still settling
   // …and the words, ONCE, on the frame the stamp changes. This branch already guarantees there is
   // a stamp to read, so the edge test needs no null case of its own.
   if(m.userData.vT!==r.chgEndT){m.userData.vT=r.chgEndT;chgSay(r);}
   const e=1-vt;
   chgC.set(CHG_COL[r.chgEndBand]||base);chgC2.set(base);
   m.material.color.copy(chgC.lerp(chgC2,vt));
   m.userData.col=null;                        // colour is written every frame here, so drop the cache
   sc=1+e*(r.chgEndBand===1?.55:.26);          // a clean shot gets the bigger stamp
   dip=-e*CH.holdRise;
   spin=2+e*7;
  }else if(m.userData.col!==base){m.userData.col=base;m.material.color.set(base);}
  m.position.set(r.x,ROD_H+9+Math.sin(S.time*5+i*1.7)*.8-dip,r.offset);
  if(m.userData.sc!==sc){m.userData.sc=sc;m.scale.setScalar(sc);}
  m.rotation.y+=rdt*spin;
 }
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
/* Which team the camera may favour: the team holding EVERY human seat, or -1 when that's
   ambiguous — players on both sides, or nobody. Shared-screen co-op has one camera, so with
   humans at both ends the only fair answer is a neutral one. */
function camTeamSide(){
 if(!S.seats.length)return-1;
 const t=S.seats[0].team;
 for(let i=1;i<S.seats.length;i++)if(S.seats[i].team!==t)return-1;
 return t;
}
function camModeOK(i){return camTeamSide()>=0||CAM.soloOnly.indexOf(i)<0;}
/* V / pad-Y step. Skips shots that aren't offerable right now instead of landing on them and
   leaving the player to press again. */
function cycleCam(d){
 const n=CAM.modes.length;
 for(let k=1;k<=n;k++){const i=((S.camMode+d*k)%n+n)%n;if(camModeOK(i)){S.camMode=i;Au.ui();return;}}
}
function cameraUpdate(rdt){
 if(S.photo)return;   // photo mode owns the camera outright (js/photo.js phApply) — no lerp, no shake
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
 // End-anchored shots flip to the viewing team's end (see CONFIG.camera.sideModes). Only x and
 // lookX mirror — height, depth and look-height are the same shot either way. The ball-follow
 // offset is a WORLD offset and is deliberately not mirrored.
 const mir=(camTeamSide()===1&&CAM.sideModes.indexOf(S.camMode)>=0)?-1:1;
 const fx=(S.camMode===1||S.camMode===3||S.camMode===4)?0:bx*CAM.follow;
 const k=Math.min(1,rdt*CAM.lerp);
 camera.position.x=lerp(camera.position.x,m[0]*mir+fx,k);
 camera.position.y=lerp(camera.position.y,m[1],k);
 camera.position.z=lerp(camera.position.z,m[2],k);
 if(S.shake>0){S.shake=Math.max(0,S.shake-rdt*CAM.shakeDecay);
  camera.position.x+=rand(-1,1)*S.shake*CAM.shakeX;
  camera.position.y+=rand(-1,1)*S.shake*CAM.shakeY;}
 S.camLookX=lerp(S.camLookX,m[3]*mir+bx*CAM.lookFollow,k);
 camera.lookAt(S.camLookX,m[4],m[5]);
}
