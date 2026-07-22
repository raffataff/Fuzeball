'use strict';
/* ================= goal instant replay ================= */
/* Flight recorder + broadcast playback. recordReplay() runs once per fixed sim
   step during 'play': ~40 float writes into preallocated typed arrays, zero
   allocation, zero render cost. On a goal (after the live slow-mo celebration)
   replayStart() freezes the sim in a dedicated 'replay' phase, re-poses pooled
   ghost balls + the REAL rod pivots straight from the buffer, and shoots it with
   one of several hand-held camera moves — easing into slow-mo + a gentle fov
   push for the finish, freeze-framing the strike, then handing back to the
   normal re-count. The buffer is CUT on serve/redrop so a replay can never show
   a teleport streak. Any key / click / pad button skips instantly. */

/* ===== recorder (ring buffer) ===== */
const RB={cap:0,n:0,head:0,pos:null,typ:null,rod:null,slots:4,keys:Object.keys(CONFIG.ballTypes)};
function replayAlloc(){
 RB.cap=Math.ceil(REPLAY.buffer*SIM.hz);
 RB.pos=new Float32Array(RB.cap*RB.slots*3);
 RB.typ=new Int8Array(RB.cap*RB.slots);
 RB.rod=new Float32Array(RB.cap*rods.length*2);
}
function replayCut(){RB.n=0;RB.head=0;RP.queued=false;}   // serve / redrop / new match — stale footage AND any stale queue die together
                                                          // (a too-short rally leaves its queue set; without this, the next out-of-bounds
                                                          // goal-phase would replay the wrong moment)
function recordReplay(){
 if(!REPLAY.on||!cfg.replay)return;
 if(!RB.pos)replayAlloc();
 const i=RB.head,pb=i*RB.slots*3,tb=i*RB.slots,rb=i*rods.length*2;
 for(let s=0;s<RB.slots;s++){
  const b=S.balls[s];
  if(b){RB.typ[tb+s]=RB.keys.indexOf(b.key);const p=b.m.position,o=pb+s*3;RB.pos[o]=p.x;RB.pos[o+1]=p.y;RB.pos[o+2]=p.z;}
  else RB.typ[tb+s]=-1;
 }
 for(let ri=0;ri<rods.length;ri++){const r=rods[ri],o=rb+ri*2;RB.rod[o]=r.offset;RB.rod[o+1]=r.angle;}
 RB.head=(RB.head+1)%RB.cap;if(RB.n<RB.cap)RB.n++;
}
// logical step j (0 = oldest recorded) → physical ring index
function rbIdx(j){return(RB.head-RB.n+j+RB.cap)%RB.cap;}

/* ===== playback state ===== */
const RP={on:false,queued:false,team:0,gx:0,t:0,len:0,start:0,mode:'play',hold:0,
 shot:0,lastShot:-1,fov0:0,snap:false,ghosts:null,hasLook:false,
 look:new THREE.Vector3(),focus:new THREE.Vector3(),lookTo:new THREE.Vector3()};
function replayPending(){return RP.queued&&REPLAY.on&&cfg.replay&&RB.n/SIM.hz>=REPLAY.minLen;}
function replayQueue(team){RP.queued=true;RP.team=team;}

/* Ghost balls: 4 pooled spheres re-tinted per recorded type — no GLB cloning,
   no allocation after first build. Each carries a spawnTrail shim so the replay
   reuses the live trail-sprite pool for free. */
function replayGhosts(){
 if(RP.ghosts)return;
 RP.ghosts=[];
 for(let s=0;s<RB.slots;s++){
  const m=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,20,14),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:.4,metalness:.05}));
  m.visible=false;scene.add(m);
  RP.ghosts.push({m,typ:-1,trailT:0,prev:new THREE.Vector3(),shim:{m:{position:m.position},t:{trail:'#ffffff'}}});
 }
}
function replayTint(g,ti){
 g.typ=ti;
 const t=BALL_TYPES[RB.keys[ti]];
 g.m.material.color.set(t.col);
 g.m.material.emissive.set(t.em||0x000000);
 g.m.material.emissiveIntensity=t.em?0.7:0;
 g.m.material.metalness=t.metal||.05;
 g.shim.t.trail=t.trail||'#ffffff';
}
// interpolated pose of slot s at logical float step j → out vector; false when the slot is empty
function rbBall(s,j,out){
 const j0=Math.floor(j),j1=Math.min(j0+1,RB.n-1),a=j-j0;
 const t0=RB.typ[rbIdx(j0)*RB.slots+s];if(t0<0)return-1;
 const t1=RB.typ[rbIdx(j1)*RB.slots+s];
 const p0=rbIdx(j0)*RB.slots*3+s*3,p1=rbIdx(j1)*RB.slots*3+s*3,P=RB.pos;
 if(t1<0){out.set(P[p0],P[p0+1],P[p0+2]);return t0;}   // slot dies next step — hold the last real pos
 out.set(lerp(P[p0],P[p1],a),lerp(P[p0+1],P[p1+1],a),lerp(P[p0+2],P[p1+2],a));
 return t0;
}

/* ===== camera shots ===== */
/* Each shot is a hand-placed move, picked at random per replay (never the same
   twice running). bp = the followed ball, t01 = 0..1 through the footage.
   All placement numbers live in CONFIG.replay.shots — tweak there, reload, score.
   A shot sets RP.cx/cy/cz (camera placement, chased at camLerp for the hand-held
   feel); by default the camera looks at the ball, but a shot may instead set
   RP.lookTo + RP.hasLook=true to aim the gaze itself (the ball cam does).
   All of them end near the beaten goal (RP.gx = ±L/2) so the slow-mo finish reads. */
const REPLAY_SHOTS=[
 // RAIL CAM — elevated sideline dolly chasing the ball down the pitch
 function(bp,t01){const H=REPLAY.shots.rail;
  RP.cx=bp.x*H.followX;RP.cy=H.y+H.bob*Math.sin(t01*Math.PI);RP.cz=H.z;},
 // NET CAM — behind the beaten goal, drifting like a cameraman leaning for the angle
 function(bp,t01){const H=REPLAY.shots.net;
  RP.cx=RP.gx*H.xMult;RP.cy=H.y+H.rise*t01;RP.cz=Math.sin(t01*4.2)*H.sway;},
 // CORNER CRANE — starts high over the scoring corner, pushes down + in as the shot builds
 function(bp,t01){const H=REPLAY.shots.crane,e=t01*t01*(3-2*t01);
  RP.cx=RP.gx*lerp(H.xFrom,H.xTo,e);RP.cy=lerp(H.yFrom,H.yTo,e);RP.cz=lerp(H.zFrom,H.zTo,e);},
 // SKY DRONE — slow high float that leans toward the goal end
 function(bp,t01){const H=REPLAY.shots.drone;
  RP.cx=bp.x*.5+RP.gx*.25*t01;RP.cy=H.y-H.dip*t01;RP.cz=H.z+H.sway*Math.sin(t01*2.1);},
 // BALL CAM — rides just goal-side of the ball, gazing back UP the pitch so the
 // scoring team is in frame driving the ball at you; ends inside the goal mouth
 function(bp,t01){const H=REPLAY.shots.ball,d=RP.gx>0?1:-1;
  RP.cx=bp.x+d*H.back;RP.cy=Math.max(bp.y+H.up,H.minY);RP.cz=bp.z;
  RP.lookTo.set(bp.x-d*H.lookAhead,H.lookY,bp.z*.6);RP.hasLook=true;}
];

function replayStart(){
 RP.queued=false;RP.on=true;S.phase='replay';
 RP.len=Math.min(RB.n/SIM.hz,REPLAY.len);
 RP.start=RB.n-RP.len*SIM.hz;
 RP.t=0;RP.hold=0;RP.mode='play';RP.snap=true;
 RP.gx=(RP.team===0?1:-1)*F.L/2;             // the goal that was scored INTO
 let si=Math.floor(Math.random()*REPLAY_SHOTS.length);
 if(si===RP.lastShot)si=(si+1)%REPLAY_SHOTS.length;
 RP.shot=si;RP.lastShot=si;
 RP.fov0=camera.fov;
 replayGhosts();
 for(const g of RP.ghosts){g.typ=-1;g.m.visible=false;g.trailT=0;}
 document.body.classList.add('replayOn');
 $('replayUI').classList.remove('hidden');
 flash();Au.ui();
}
function replayEnd(){
 if(!RP.on)return;RP.on=false;
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 for(const g of RP.ghosts)g.m.visible=false;
 for(const r of rods){r.pivot.position.z=r.offset;r.pivot.rotation.z=r.angle;}   // hand the pivots back to the live sim pose
 document.body.classList.remove('replayOn');
 $('replayUI').classList.add('hidden');
 flash();
 startCount(MATCH.recount);
}
function replaySkip(){if(S.phase==='replay'){Au.ui();replayEnd();}}
// hard bail (menu quit / new match) — tear playback down WITHOUT handing off to a re-count
function replayAbort(){
 RP.queued=false;
 if(!RP.on)return;
 RP.on=false;
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 if(RP.ghosts)for(const g of RP.ghosts)g.m.visible=false;
 document.body.classList.remove('replayOn');
 $('replayUI').classList.add('hidden');
}

function replayUpdate(rdt){
 if(S.phase!=='replay')return;
 /* speed profile: cruise, then smoothstep down into slow-mo over the last stretch */
 const rem=RP.len-RP.t;
 let zk=0;
 if(rem<REPLAY.slowLast){const u=1-rem/REPLAY.slowLast;zk=u*u*(3-2*u);}
 if(RP.mode==='play'){
  RP.t+=rdt*lerp(REPLAY.speed,REPLAY.slowSpeed,zk);
  if(RP.t>=RP.len){RP.t=RP.len;RP.mode='hold';RP.hold=REPLAY.holdT;}
 }else{RP.hold-=rdt;if(RP.hold<=0){replayEnd();return;}}
 const j=clamp(RP.start+RP.t*SIM.hz,0,RB.n-1);
 /* rods straight from the buffer (display only — r.offset/r.angle untouched) */
 const j0=Math.floor(j),j1=Math.min(j0+1,RB.n-1),a=j-j0,r0=rbIdx(j0)*rods.length*2,r1=rbIdx(j1)*rods.length*2;
 for(let ri=0;ri<rods.length;ri++){const r=rods[ri];
  r.pivot.position.z=lerp(RB.rod[r0+ri*2],RB.rod[r1+ri*2],a);
  r.pivot.rotation.z=lerp(RB.rod[r0+ri*2+1],RB.rod[r1+ri*2+1],a);
 }
 /* ghost balls + trails off the live sprite pool */
 let focusSet=false;
 for(let s=0;s<RB.slots;s++){
  const g=RP.ghosts[s],ti=rbBall(s,j,g.m.position);
  if(ti<0){g.m.visible=false;continue;}
  if(ti!==g.typ)replayTint(g,ti);
  if(!g.m.visible){g.m.visible=true;g.prev.copy(g.m.position);}
  if(!focusSet){RP.focus.copy(g.m.position);focusSet=true;}   // slot 0 (the rally ball) leads the shot
  g.trailT-=rdt;
  if(g.trailT<=0&&g.prev.distanceTo(g.m.position)/Math.max(rdt,1e-4)>CONFIG.fx.trailSpeed){
   spawnTrail(g.shim);g.trailT=REPLAY.trailEvery;
  }
  g.prev.copy(g.m.position);
 }
 /* camera: hand-held chase toward the shot's placement + broadcast push-in on the slow-mo.
    Default gaze = the ball; a shot that set RP.hasLook aims the gaze itself (ball cam). */
 RP.hasLook=false;
 REPLAY_SHOTS[RP.shot](RP.focus,RP.len>0?RP.t/RP.len:1);
 const tgt=RP.hasLook?RP.lookTo:RP.focus;
 const k=RP.snap?1:Math.min(1,rdt*REPLAY.camLerp);
 camera.position.x=lerp(camera.position.x,RP.cx,k);
 camera.position.y=lerp(camera.position.y,RP.cy,k);
 camera.position.z=lerp(camera.position.z,RP.cz,k);
 if(RP.snap)RP.look.copy(tgt);
 else RP.look.lerp(tgt,Math.min(1,rdt*REPLAY.lookLerp));
 camera.lookAt(RP.look);
 camera.fov=RP.fov0*(1-(1-REPLAY.zoom)*zk);
 camera.updateProjectionMatrix();
 RP.snap=false;
}
