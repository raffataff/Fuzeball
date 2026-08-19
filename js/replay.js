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
/* tot = total steps recorded since the last cut, i.e. a monotonic ABSOLUTE step index. The
   ring's logical step j maps to abs = tot - n + j. The sound log below stores abs rather than
   a ring slot, so an event can't be silently re-pointed at different footage when the ring
   wraps underneath it. */
const RB={cap:0,n:0,head:0,tot:0,pos:null,typ:null,rod:null,slots:4,keys:Object.keys(CONFIG.ballTypes)};
function replayAlloc(){
 RB.cap=Math.ceil(REPLAY.buffer*SIM.hz);
 RB.pos=new Float32Array(RB.cap*RB.slots*3);
 RB.typ=new Int8Array(RB.cap*RB.slots);
 RB.rod=new Float32Array(RB.cap*rods.length*2);
}
function replayCut(){RB.n=0;RB.head=0;RB.tot=0;RS.n=0;RS.head=0;RP.queued=false;}
                                                          // serve / redrop / new match — stale footage AND any stale queue die together
                                                          // (a too-short rally leaves its queue set; without this, the next out-of-bounds
                                                          // goal-phase would replay the wrong moment). The SOUND log is cut with the
                                                          // positions, and must be: abs indices restart at 0, so a surviving event would
                                                          // fire against whatever footage happened to land on its old step number.
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
 RB.head=(RB.head+1)%RB.cap;RB.tot++;if(RB.n<RB.cap)RB.n++;
}
// logical step j (0 = oldest recorded) → physical ring index
function rbIdx(j){return(RB.head-RB.n+j+RB.cap)%RB.cap;}
// logical step j → absolute step index (what the sound log stores)
function rbAbs(j){return RB.tot-RB.n+j;}

/* ===== sound recorder =====
   The sim is FROZEN during playback, so a replay generates no sound of its own — it used to
   run silent under the live crowd bed. The rally's impacts are logged as they happen and
   re-fired against the footage clock.

   Logged by TAPPING Au ITSELF rather than by instrumenting the ~10 call sites across
   physics/fx/powerups: one place to maintain, no per-call cost added to the physics hot path
   beyond what's already inside those methods, and a sound added later is recorded for free.
   Only the in-rally IMPACT channels are tapped — whistles, countdown beeps, the goal horn and
   UI clicks are match chrome, not footage, and the horn is re-fired deliberately at the
   freeze-frame instead (REPLAY.audio.goalSting).

   Each entry stores the ABS step it fired on plus the two arguments those methods take: a
   magnitude, and the ball type's audio config OBJECT. The object is stored by reference in a
   preallocated slot array — a few live references, never a growing allocation, and it keeps a
   replayed fireball sounding like a fireball rather than like a generic hit. */
const RS={cap:CONFIG.replay.audio.events,n:0,head:0,step:null,kind:null,p:null,arg:null,
 keys:['kick','wall','post','power','boom']};
function replaySndAlloc(){
 RS.step=new Int32Array(RS.cap);RS.kind=new Int8Array(RS.cap);
 RS.p=new Float32Array(RS.cap);RS.arg=new Array(RS.cap);
}
function rsIdx(j){return(RS.head-RS.n+j+RS.cap)%RS.cap;}
// The tap. Gated exactly like recordReplay, plus a !RP.on guard so the sounds playback
// re-fires can't log themselves back into the buffer.
function replaySndLog(k,p,a){
 if(!REPLAY.on||!REPLAY.audio.on||!cfg.replay||RP.on||S.phase!=='play')return;
 if(!RS.step)replaySndAlloc();
 const i=RS.head;
 RS.step[i]=RB.tot;   // sounds fire inside physics(), which runs BEFORE recordReplay in the same
                      // step — so RB.tot is still the index of the step about to be written
 RS.kind[i]=k;RS.p[i]=p||0;RS.arg[i]=a||null;
 RS.head=(RS.head+1)%RS.cap;if(RS.n<RS.cap)RS.n++;
}
(function tapAu(){   // replay.js loads after audio.js, so Au exists and nothing has called it yet
 for(let k=0;k<RS.keys.length;k++){
  const nm=RS.keys[k],fn=Au[nm];
  if(typeof fn!=='function')continue;
  Au[nm]=function(p,a){replaySndLog(k,p,a);return fn.call(this,p,a);};
 }
})();
/* Fire everything the footage has passed since the last frame. Playback is strictly forward,
   so this is a cursor walk, not a search. Pitch/level are set around the loop and reset in the
   same breath — Au.rate/vol are global, and a skip landing mid-loop must not leave the next
   rally detuned. */
function replaySndUpdate(absNow,zk){
 const A=REPLAY.audio;
 if(!A.on||!RS.n||RP.sndI>=RS.n)return;
 // tape slowdown: pitch tracks the PLAYBACK rate, so a slow-mo strike lands as a deep thud and
 // the sound slows with the picture instead of clattering over it
 const sp=lerp(REPLAY.speed,REPLAY.slowSpeed,zk);
 Au.rate=Math.max(A.pitchMin,lerp(1,sp,A.pitch));Au.vol=A.gain;
 while(RP.sndI<RS.n){
  const i=rsIdx(RP.sndI);
  if(RS.step[i]>absNow)break;
  RP.sndI++;
  const fn=Au[RS.keys[RS.kind[i]]];if(fn)fn.call(Au,RS.p[i],RS.arg[i]);
 }
 Au.rate=1;Au.vol=1;
}

/* ===== playback state ===== */
// sndI = cursor into the sound log (see replaySndUpdate). keep = this replay's recording has
// been promoted to a file. sting = the goal horn has already been re-fired for this replay.
// camSaved/camSave = free-roam parking spot stashed on the way in (see replayCamStash).
const RP={on:false,queued:false,team:0,gx:0,t:0,len:0,start:0,mode:'play',hold:0,
 shot:0,lastShot:-1,fov0:0,snap:false,ghosts:null,hasLook:false,sndI:0,keep:false,sting:false,
 camSaved:false,camSave:new THREE.Vector3(),
 look:new THREE.Vector3(),focus:new THREE.Vector3(),lookTo:new THREE.Vector3()};

/* ===== free-roam handoff =====
   The broadcast camera doesn't need this: cameraUpdate re-derives its placement from the shot
   table every frame, so it lerps home on its own the instant playback lets go. FREE ROAM is
   different — the camera position IS the state, and nothing regenerates it, so a replay that
   flew off to the corner crane would leave the spectator dumped there with no memory of where
   they'd parked. Stash the spot on the way in and put it back on the way out.
   Only stashed when free roam is already on: entering free roam DURING a replay is the player
   deliberately grabbing the camera where it stands, and yanking them elsewhere on the handback
   would be the same bug in reverse. Rotation isn't stashed — S.camYaw/S.camPitch survive the
   replay untouched and cameraUpdate re-applies them on the first frame back, which also means
   looking around while the replay runs still counts. */
function replayCamStash(){
 RP.camSaved=!!S.freeRoam;
 if(RP.camSaved)RP.camSave.copy(camera.position);
}
function replayCamRestore(){
 // still-in-free-roam test: exiting mid-replay (Esc, lost pointer lock) hands back to the
 // broadcast camera, which wants its own placement, not the stale roam spot
 if(RP.camSaved&&S.freeRoam)camera.position.copy(RP.camSave);
 RP.camSaved=false;
}
// replayReady = is there footage worth showing RIGHT NOW (nothing queued required). flow.js tests it
// before committing a match-winning goal to the celebration hold, so a rally too short to replay
// still cuts straight to the win screen.
function replayReady(){return REPLAY.on&&cfg.replay&&RB.n/SIM.hz>=REPLAY.minLen;}
function replayPending(){return RP.queued&&replayReady();}
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
  // models: type-index -> GLB clone (lazy, cached for the session). When a type has
  // a baked GLB slot we show that instead of the tinted sphere; null = no slot (e.g.
  // knuckleball) or ball models disabled → keep the sphere fallback. active = the
  // model currently shown for this ghost (null when the sphere is the active one).
  // rq = accumulated ROLL (see replayRoll) — the buffer holds no orientation, so it's
  // re-derived from the path and applied to whichever mesh is showing.
  RP.ghosts.push({m,typ:-1,trailT:0,prev:new THREE.Vector3(),rq:new THREE.Quaternion(),
   shim:{m:{position:m.position},t:{trail:'#ffffff'}},models:null,active:null,primed:false});
 }
}
// Lazily clone the GLB model for a recorded ball type; null if unavailable (no slot
// or CONFIG.debug.useBallModel off). Cached per ghost so each replay type is built once.
function replayGhostModel(g,ti){
 if(!g.models)g.models={};
 let model=g.models[ti];
 if(model!==undefined)return model;
 model=makeBallModel(RB.keys[ti]);
 // rqBase: the clone's AUTHORED orientation. Roll is applied on top of it (replayRollSet),
 // never in place of it — a GLB root can carry a baked rotation, and stamping the roll
 // straight onto .quaternion would silently discard it.
 if(model){model.scale.setScalar(1);model.visible=false;model.userData.rqBase=model.quaternion.clone();scene.add(model);}
 g.models[ti]=model;
 return model;
}
// Hide a ghost entirely (end of footage for this slot, replay end/abort).
function replayGhostHide(g){
 g.m.visible=false;g.m.quaternion.set(0,0,0,1);
 // rest the orientation as well as the roll accumulator, so REPLAY.roll:false is a true
 // off-switch even after a session that had it on (a parked mesh would otherwise keep its
 // last rolled pose and the next replay would open on a crooked ball).
 if(g.models)for(const k in g.models){const mm=g.models[k];if(mm){mm.visible=false;
  const b=mm.userData.rqBase;if(b)mm.quaternion.copy(b);else mm.quaternion.set(0,0,0,1);}}
 g.active=null;g.primed=false;g.rq.set(0,0,0,1);
}
/* ===== rolling =====
   The recorder stores POSITION ONLY (3 floats a slot a step), so a replayed ball has no
   recorded orientation — it used to slide down the pitch with its texture frozen, which
   reads fine on a plain sphere and badly on anything with a print on it. Orientation is
   therefore RE-DERIVED from the path: a ball rolling without slipping turns about the
   horizontal axis perpendicular to its travel by (distance travelled / radius). Same axis
   convention as the live ball (physics.js: +x travel turns about −z, +z travel about +x)
   and horizontal-only for the same reason, so a replay matches what you just watched.
   Driven by DISTANCE, not time, so slow-mo slows the spin with the ball for free.
   Accumulated as a world-axis quaternion rather than the live Euler pair — a replayed
   curve stacks many small turns about changing axes, which is exactly where Euler
   accumulation starts to tumble. */
const _rlAx=new THREE.Vector3(),_rlQ=new THREE.Quaternion();
function replayRoll(g,dx,dz){
 const d=Math.hypot(dx,dz);
 if(d<1e-5)return;
 _rlAx.set(dz,0,-dx).normalize();
 g.rq.premultiply(_rlQ.setFromAxisAngle(_rlAx,d/BALL_R));
}
function replayRollSet(o,q){o.quaternion.copy(q);const b=o.userData.rqBase;if(b)o.quaternion.multiply(b);}
function replayTint(g,ti){
 g.typ=ti;
 const t=BALL_TYPES[RB.keys[ti]];
 const model=replayGhostModel(g,ti);
 if(model){
  // GLB-cloned model is the proper material; hide the sphere + any other cached models
  g.active=model;g.m.visible=false;
  for(const k in g.models){const mm=g.models[k];if(mm)mm.visible=(+k===ti);}
 }else{
  // no baked slot (or models disabled) → tinted sphere fallback, matching live behaviour
  g.active=null;
  for(const k in (g.models||{})){const mm=g.models[k];if(mm)mm.visible=false;}
  g.m.visible=true;
  g.m.material.color.set(t.col);
  g.m.material.emissive.set(t.em||0x000000);
  g.m.material.emissiveIntensity=t.em?0.7:0;
  g.m.material.metalness=t.metal||.05;
 }
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

/* ===== saving the clip =====
   The canvas recorder (js/capture.js) is armed on the FIRST FRAME of every replay, so the save
   key can be pressed at any point — including on the freeze-frame, which is the moment you
   actually know the goal was worth keeping — and still write the WHOLE replay out rather than
   the tail from the keypress. A recording nobody presses for is dropped on stop.
   The clip is the CANVAS only: the letterbox bars, the tag and this hint are DOM, so what lands
   on disk is clean footage with no chrome burnt into it. */
function replaySaveArm(){
 RP.keep=false;
 if(!REPLAY.save.on){replaySaveUI('off');return;}
 clipStart();
 replaySaveUI(clipReady()?'':'off');   // no recorder (unsupported / disabled / failed) → no hint to offer
}
function replaySaveClip(){
 if(!RP.on)return;
 Au.ui();
 if(RP.keep||!clipReady())return;      // already promoted, or nothing running to promote
 RP.keep=clipKeep(CAPTURE.prefix+'_'+clipSlug(teamName(RP.team))+'_'+clipStamp());
 replaySaveUI(RP.keep?'saving':'off');
}
function replaySaveUI(st){
 const el=$('repSave');if(!el)return;
 el.className=st||'';
 el.textContent=st==='saving'?REPLAY.save.saving:st==='off'?'':REPLAY.save.hint;
}

function replayStart(){
 RP.queued=false;RP.on=true;S.phase='replay';
 RP.len=Math.min(RB.n/SIM.hz,REPLAY.len);
 RP.start=RB.n-RP.len*SIM.hz;
 RP.t=0;RP.hold=0;RP.mode='play';RP.snap=true;RP.sting=false;
 RP.gx=(RP.team===0?1:-1)*F.L/2;             // the goal that was scored INTO
 // sound cursor: skip past everything that fired BEFORE the stretch of footage being shown,
 // so a long rally trimmed to REPLAY.len doesn't dump its whole history in the first frame
 RP.sndI=0;
 if(RS.n){const a0=rbAbs(RP.start);while(RP.sndI<RS.n&&RS.step[rsIdx(RP.sndI)]<a0)RP.sndI++;}
 let si=Math.floor(Math.random()*REPLAY_SHOTS.length);
 if(si===RP.lastShot)si=(si+1)%REPLAY_SHOTS.length;
 RP.shot=si;RP.lastShot=si;
 RP.fov0=camera.fov;
 replayCamStash();                            // free-roam only — see replayCamStash
  replayGhosts();
  for(const g of RP.ghosts){g.typ=-1;replayGhostHide(g);g.trailT=0;}
 document.body.classList.add('replayOn');
 $('replayUI').classList.remove('hidden');
 replaySaveArm();
 flash();Au.ui();
}
function replayEnd(){
 if(!RP.on)return;RP.on=false;
 Au.rate=1;Au.vol=1;                          // belt and braces: a skip can land between the set and
                                              // the reset inside replaySndUpdate
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 replayCamRestore();                          // put a free-roam spectator back where they were parked
  for(const g of RP.ghosts)replayGhostHide(g);
  for(const r of rods){r.pivot.position.z=r.offset;r.pivot.rotation.z=r.angle;}   // hand the pivots back to the live sim pose
 clipStop();                                  // writes the file iff it was promoted; async, lands a beat later
 const saved=RP.keep;RP.keep=false;
 document.body.classList.remove('replayOn');
 $('replayUI').classList.add('hidden');
 // Confirmation goes out AFTER the chrome is down, because the HUD (which owns toast) is faded
 // to zero for the whole replay — a toast fired any earlier is a toast nobody sees.
 if(saved)toast('CLIP SAVED','goal replay → downloads');
 // A match-winning goal held its win back so this replay could play (flow.js onGoal) — go to the
 // win screen instead of a re-count. endMatch does its own flash/shake, so don't double up.
 if(finishPendingWin())return;
 flash();
 startCount(MATCH.recount);
}
function replaySkip(){if(S.phase==='replay'){Au.ui();replayEnd();}}
// hard bail (menu quit / new match) — tear playback down WITHOUT handing off to a re-count
function replayAbort(){
 RP.queued=false;
 if(!RP.on)return;
 RP.on=false;
 Au.rate=1;Au.vol=1;
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 replayCamRestore();                          // same handback on a hard bail (menu quit / new match)
  if(RP.ghosts)for(const g of RP.ghosts)replayGhostHide(g);
 clipStop();RP.keep=false;                    // a quit mid-replay still writes a clip that was asked for
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
  if(RP.t>=RP.len){RP.t=RP.len;RP.mode='hold';RP.hold=REPLAY.holdT;
   // The horn lands ON the freeze-frame, at NORMAL pitch — it isn't footage, it's the
   // celebration arriving, and a tape-slowed horn reads as a fault rather than as drama.
   if(REPLAY.audio.on&&REPLAY.audio.goalSting&&!RP.sting){RP.sting=true;Au.goal();}}
 }else{RP.hold-=rdt;if(RP.hold<=0){replayEnd();return;}}
 const j=clamp(RP.start+RP.t*SIM.hz,0,RB.n-1);
 replaySndUpdate(rbAbs(j),zk);   // re-fire everything the footage clock has just passed
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
   if(ti<0){replayGhostHide(g);continue;}
   if(ti!==g.typ)replayTint(g,ti);
   if(!g.primed){g.primed=true;g.prev.copy(g.m.position);}
   // roll off the step just travelled — BEFORE prev is advanced (the trail test below reads it too)
   if(REPLAY.roll){
    replayRoll(g,g.m.position.x-g.prev.x,g.m.position.z-g.prev.z);
    replayRollSet(g.m,g.rq);
    if(g.active)replayRollSet(g.active,g.rq);
   }
   if(g.active)g.active.position.copy(g.m.position);   // GLB model follows the recorded ball pos
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
