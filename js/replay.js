'use strict';
/* ================= goal instant replay ================= */
// flight recorder + broadcast playback
// recordReplay() runs once per fixed sim step in 'play' into preallocated typed arrays; on a goal, replayStart() freezes the sim in a 'replay' phase, re-poses pooled ghost balls and the real rod pivots from the buffer under a hand-held camera, eases into slow-mo, freeze-frames the strike, then hands back to the re-count
// the buffer is cut on serve/redrop (no teleport streaks); any key, click or pad button skips

// ===== recorder (ring buffer) =====
// tot = steps recorded since the last cut (a monotonic absolute index, ring step j = abs tot - n + j); the sound log stores abs so a wrapping ring can't re-point an event
const RB={cap:0,n:0,head:0,tot:0,pos:null,typ:null,rod:null,slots:4,keys:Object.keys(CONFIG.ballTypes)};
function replayAlloc(){
 RB.cap=Math.ceil(REPLAY.buffer*SIM.hz);
 RB.pos=new Float32Array(RB.cap*RB.slots*3);
 RB.typ=new Int8Array(RB.cap*RB.slots);
 RB.rod=new Float32Array(RB.cap*rods.length*2);
}
function replayCut(){RB.n=0;RB.head=0;RB.tot=0;RS.n=0;RS.head=0;RP.queued=false;}
                                                          // serve / redrop / new match: stale footage and queue die together; the sound log is cut with the positions
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

// ===== sound recorder =====
// the sim is frozen in playback, so the rally's impacts are logged by tapping Au itself and re-fired against the footage clock; only in-rally impacts (not whistles, countdown, the goal horn or UI clicks)
// an entry = abs step, magnitude, the ball type's audio config (by reference), the ball's position and type (copied, for panning) and the surface kind
const RS={cap:CONFIG.replay.audio.events,n:0,head:0,step:null,kind:null,p:null,arg:null,pos:null,key:null,e:null,
 src:{x:0,y:0,z:0,key:null},keys:['kick','wall','post','power','boom']};
function replaySndAlloc(){
 RS.step=new Int32Array(RS.cap);RS.kind=new Int8Array(RS.cap);
 RS.p=new Float32Array(RS.cap);RS.arg=new Array(RS.cap);
 RS.pos=new Float32Array(RS.cap*3);RS.key=new Array(RS.cap);RS.e=new Int8Array(RS.cap);
}
function rsIdx(j){return(RS.head-RS.n+j+RS.cap)%RS.cap;}
// the tap: gated like recordReplay plus !RP.on so replayed sounds can't log themselves
function replaySndLog(k,p,a,s,e){
 if(!REPLAY.on||!REPLAY.audio.on||!cfg.replay||RP.on||S.phase!=='play')return;
 if(!RS.step)replaySndAlloc();
 const i=RS.head,q=s&&(s.m?s.m.position:s);
 RS.step[i]=RB.tot;   // sounds fire inside physics(), before recordReplay in the same step, so RB.tot is the index of the step about to be written
 RS.kind[i]=k;RS.p[i]=p||0;RS.arg[i]=a||null;
 RS.pos[i*3]=q?q.x:NaN;RS.pos[i*3+1]=q?q.y:NaN;RS.pos[i*3+2]=q?q.z:NaN;RS.key[i]=(s&&s.key)||null;RS.e[i]=e|0;
 RS.head=(RS.head+1)%RS.cap;if(RS.n<RS.cap)RS.n++;
}
(function tapAu(){   // replay.js loads after audio.js, so Au exists and nothing has called it yet
 for(let k=0;k<RS.keys.length;k++){
  const nm=RS.keys[k],fn=Au[nm];
  if(typeof fn!=='function')continue;
  Au[nm]=function(p,a,s,e){replaySndLog(k,p,a,s,e);return fn.call(this,p,a,s,e);};
 }
})();
// fire everything the footage has passed since the last frame (a cursor walk); pitch and level are set around the loop and reset right after (Au.rate/vol are global)
function replaySndUpdate(absNow,zk){
 const A=REPLAY.audio;
 if(!A.on||!RS.n||RP.sndI>=RS.n)return;
 // tape slowdown: pitch tracks the playback rate, so slow-mo lands as a deep thud
 const sp=lerp(REPLAY.speed,REPLAY.slowSpeed,zk);
 Au.rate=Math.max(A.pitchMin,lerp(1,sp,A.pitch));Au.vol=A.gain;
 while(RP.sndI<RS.n){
  const i=rsIdx(RP.sndI);
  if(RS.step[i]>absNow)break;
  RP.sndI++;
  const fn=Au[RS.keys[RS.kind[i]]],o=RS.src;
  o.x=RS.pos[i*3];o.y=RS.pos[i*3+1];o.z=RS.pos[i*3+2];o.key=RS.key[i];   // one reused object: Au reads it synchronously
  if(fn)fn.call(Au,RS.p[i],RS.arg[i],o,RS.e[i]);
 }
 Au.rate=1;Au.vol=1;
}

// ===== playback state =====
// sndI = cursor into the sound log; keep = promoted to a file; sting = goal horn already re-fired; camSaved/camSave = free-roam parking spot
const RP={on:false,queued:false,team:0,gx:0,t:0,len:0,start:0,mode:'play',hold:0,
 shot:0,lastShot:-1,fov0:0,snap:false,ghosts:null,hasLook:false,sndI:0,keep:false,sting:false,
 camSaved:false,camSave:new THREE.Vector3(),
 look:new THREE.Vector3(),focus:new THREE.Vector3(),lookTo:new THREE.Vector3()};

// ===== free-roam handoff =====
// free roam's camera position is the state (the broadcast camera re-derives its own), so stash it on the way in and restore it on the way out; rotation survives untouched
function replayCamStash(){
 RP.camSaved=!!S.freeRoam;
 if(RP.camSaved)RP.camSave.copy(camera.position);
}
function replayCamRestore(){
 // still in free roam: exiting mid-replay (Esc, lost pointer lock) hands back to the broadcast camera, which wants its own placement
 if(RP.camSaved&&S.freeRoam)camera.position.copy(RP.camSave);
 RP.camSaved=false;
}
// is there footage worth showing now; flow.js tests it before holding a match-winning goal for the celebration
function replayReady(){return REPLAY.on&&cfg.replay&&RB.n/SIM.hz>=REPLAY.minLen;}
function replayPending(){return RP.queued&&replayReady();}
function replayQueue(team){RP.queued=true;RP.team=team;}

// ghost balls: 4 pooled spheres re-tinted per recorded type, no allocation after first build; each carries a spawnTrail shim for the live trail pool
function replayGhosts(){
 if(RP.ghosts)return;
 RP.ghosts=[];
 for(let s=0;s<RB.slots;s++){
  const m=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,20,14),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:.4,metalness:.05}));
  m.visible=false;scene.add(m);
  // models: type-index to GLB clone (lazy, cached); null = no slot or ball models off (keep the sphere); active = the model shown; rq = accumulated roll (replayRoll), re-derived since the buffer holds no orientation
  RP.ghosts.push({m,typ:-1,trailT:0,prev:new THREE.Vector3(),rq:new THREE.Quaternion(),
   shim:{m:{position:m.position},t:{trail:'#ffffff'}},models:null,active:null,primed:false});
 }
}
// lazily clone the GLB model for a recorded ball type, null if unavailable; cached per ghost
function replayGhostModel(g,ti){
 if(!g.models)g.models={};
 let model=g.models[ti];
 if(model!==undefined)return model;
 model=makeBallModel(RB.keys[ti]);
 // rqBase: the clone's authored orientation; the roll is applied on top of it, never in place of it
 if(model){model.scale.setScalar(1);model.visible=false;model.userData.rqBase=model.quaternion.clone();scene.add(model);}
 g.models[ti]=model;
 return model;
}
// Hide a ghost entirely (end of footage for this slot, replay end/abort).
function replayGhostHide(g){
 g.m.visible=false;g.m.quaternion.set(0,0,0,1);
 ballHeatSet(g.m,0);          // park it cold; a still-live ghost of the same type re-heats the shared material at heatClose
 // reset the orientation as well as the roll accumulator, so REPLAY.roll:false is a true off-switch
 if(g.models)for(const k in g.models){const mm=g.models[k];if(mm){mm.visible=false;ballHeatSet(mm,0);
  const b=mm.userData.rqBase;if(b)mm.quaternion.copy(b);else mm.quaternion.set(0,0,0,1);}}
 g.active=null;g.primed=false;g.rq.set(0,0,0,1);
}
// ===== rolling =====
// the recorder stores position only, so orientation is re-derived: a rolling ball turns about the horizontal axis perpendicular to travel by distance/radius (same convention as physics.js)
// driven by distance (slow-mo slows the spin) and accumulated as a world-axis quaternion (Euler tumbles on curves)
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
  ballHeatForget(g.m);        // re-authored just now — the heat system must re-read its base colours (js/balls.js)
 }
 g.shim.t.trail=t.trail||'#ffffff';
}
// interpolated pose of slot s at logical float step j into out; false when the slot is empty
function rbBall(s,j,out){
 const j0=Math.floor(j),j1=Math.min(j0+1,RB.n-1),a=j-j0;
 const t0=RB.typ[rbIdx(j0)*RB.slots+s];if(t0<0)return-1;
 const t1=RB.typ[rbIdx(j1)*RB.slots+s];
 const p0=rbIdx(j0)*RB.slots*3+s*3,p1=rbIdx(j1)*RB.slots*3+s*3,P=RB.pos;
 if(t1<0){out.set(P[p0],P[p0+1],P[p0+2]);return t0;}   // slot dies next step — hold the last real pos
 out.set(lerp(P[p0],P[p1],a),lerp(P[p0+1],P[p1+1],a),lerp(P[p0+2],P[p1+2],a));
 return t0;
}

// ===== camera shots =====
// hand-placed moves picked at random per replay; bp = the followed ball, t01 = 0..1 through the footage; numbers in CONFIG.replay.shots
// a shot sets RP.cx/cy/cz (chased at camLerp) and looks at the ball unless it sets RP.lookTo + RP.hasLook (the ball cam); all end near the beaten goal (RP.gx = ±L/2)
const REPLAY_SHOTS=[
 // RAIL CAM — elevated sideline dolly chasing the ball down the pitch
 function(bp,t01){const H=REPLAY.shots.rail;
  RP.cx=bp.x*H.followX;RP.cy=H.y+H.bob*Math.sin(t01*Math.PI);RP.cz=H.z;},
 // NET CAM — behind the beaten goal, drifting like a cameraman leaning for the angle
 function(bp,t01){const H=REPLAY.shots.net;
  RP.cx=RP.gx*H.xMult;RP.cy=H.y+H.rise*t01;RP.cz=Math.sin(t01*4.2)*H.sway;},
 // CORNER CRANE: starts high over the scoring corner, pushes down and in as the shot builds
 function(bp,t01){const H=REPLAY.shots.crane,e=t01*t01*(3-2*t01);
  RP.cx=RP.gx*lerp(H.xFrom,H.xTo,e);RP.cy=lerp(H.yFrom,H.yTo,e);RP.cz=lerp(H.zFrom,H.zTo,e);},
 // SKY DRONE — slow high float that leans toward the goal end
 function(bp,t01){const H=REPLAY.shots.drone;
  RP.cx=bp.x*.5+RP.gx*.25*t01;RP.cy=H.y-H.dip*t01;RP.cz=H.z+H.sway*Math.sin(t01*2.1);},
 // BALL CAM: rides just goal-side of the ball, gazing back up the pitch; ends inside the goal mouth
 function(bp,t01){const H=REPLAY.shots.ball,d=RP.gx>0?1:-1;
  RP.cx=bp.x+d*H.back;RP.cy=Math.max(bp.y+H.up,H.minY);RP.cz=bp.z;
  RP.lookTo.set(bp.x-d*H.lookAhead,H.lookY,bp.z*.6);RP.hasLook=true;}
];

// ===== saving the clip =====
// the canvas recorder (js/capture.js) is armed on the replay's first frame, so the save key writes the whole replay whenever pressed; unsaved recordings are dropped; the clip is canvas only (bars, tag and hint are DOM)
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
function replaySaveUI(st){hudReplaySave(st||'armed');}   // '' = armed (the offer), 'saving', 'off'

function replayStart(){
 RP.queued=false;RP.on=true;S.phase='replay';
 RP.len=Math.min(RB.n/SIM.hz,REPLAY.len);
 RP.start=RB.n-RP.len*SIM.hz;
 RP.t=0;RP.hold=0;RP.mode='play';RP.snap=true;RP.sting=false;RP.prevJ=-1;
 RP.gx=(RP.team===0?1:-1)*F.L/2;             // the goal that was scored into
 // sound cursor: skip everything fired before the stretch shown, so a trimmed rally doesn't dump its history in frame one
 RP.sndI=0;
 if(RS.n){const a0=rbAbs(RP.start);while(RP.sndI<RS.n&&RS.step[rsIdx(RP.sndI)]<a0)RP.sndI++;}
 let si=Math.floor(Math.random()*REPLAY_SHOTS.length);
 if(si===RP.lastShot)si=(si+1)%REPLAY_SHOTS.length;
 RP.shot=si;RP.lastShot=si;
 RP.fov0=camera.fov;
 replayCamStash();                            // free-roam only — see replayCamStash
  replayGhosts();
  for(const g of RP.ghosts){g.typ=-1;replayGhostHide(g);g.trailT=0;}
  hudReplay(true,RP.team);                    // letterbox in, match chrome out (js/hud.js)
  replaySaveArm();
 flash();Au.ui();
}
function replayEnd(){
 if(!RP.on)return;RP.on=false;
 Au.rate=1;Au.vol=1;                          // belt and braces: a skip can land between the set and the reset inside replaySndUpdate
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 replayCamRestore();                          // put a free-roam spectator back where they were parked
  for(const g of RP.ghosts)replayGhostHide(g);
  for(const r of rods){r.pivot.position.z=r.offset;r.pivot.rotation.z=r.angle;}   // hand the pivots back to the live sim pose
 clipStop();                                  // writes the file iff it was promoted; async, lands a beat later
 const saved=RP.keep;RP.keep=false;
  hudReplay(false);
 // confirm after the letterbox is down (the bottom bar showed the save state)
 if(saved)toast('CLIP SAVED','goal replay → downloads');
 // a match-winning goal held its win back for this replay (flow.js onGoal): go to the win screen
 if(finishPendingWin())return;
 flash();
 startCount(MATCH.recount);
}
function replaySkip(){if(S.phase==='replay'){Au.ui();replayEnd();}}
// hard bail (menu quit / new match): tear playback down without handing off to a re-count
function replayAbort(){
 RP.queued=false;
 if(!RP.on)return;
 RP.on=false;
 Au.rate=1;Au.vol=1;
 camera.fov=RP.fov0;camera.updateProjectionMatrix();
 replayCamRestore();                          // same handback on a hard bail (menu quit / new match)
  if(RP.ghosts)for(const g of RP.ghosts)replayGhostHide(g);
clipStop();RP.keep=false;                    // a quit mid-replay still writes a clip that was asked for
  hudReplay(false);
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
   // the horn lands on the freeze-frame at normal pitch (it's the celebration, not footage)
   if(REPLAY.audio.on&&REPLAY.audio.goalSting&&!RP.sting){RP.sting=true;Au.goal();}}
 }else{RP.hold-=rdt;if(RP.hold<=0){replayEnd();return;}}
 const j=clamp(RP.start+RP.t*SIM.hz,0,RB.n-1);
 // SIM steps since the last frame as sim time; ghost speed is measured against that, not rdt, so slow-mo doesn't cool a flying ball (js/balls.js)
 const jDt=(RP.prevJ>=0?Math.max(0,j-RP.prevJ):0)/SIM.hz;RP.prevJ=j;
 replaySndUpdate(rbAbs(j),zk);   // re-fire everything the footage clock has just passed
 /* rods straight from the buffer (display only — r.offset/r.angle untouched) */
 const j0=Math.floor(j),j1=Math.min(j0+1,RB.n-1),a=j-j0,r0=rbIdx(j0)*rods.length*2,r1=rbIdx(j1)*rods.length*2;
 for(let ri=0;ri<rods.length;ri++){const r=rods[ri];
  r.pivot.position.z=lerp(RB.rod[r0+ri*2],RB.rod[r1+ri*2],a);
  r.pivot.rotation.z=lerp(RB.rod[r0+ri*2+1],RB.rod[r1+ri*2+1],a);
 }
 /* ghost balls + trails off the live sprite pool */
 let focusSet=false;
 heatOpen();                                   // the ghosts clone the LIVE ball materials, so they heat the same way (js/balls.js)
  for(let s=0;s<RB.slots;s++){
   const g=RP.ghosts[s],ti=rbBall(s,j,g.m.position);
   if(ti<0){replayGhostHide(g);continue;}
   if(ti!==g.typ)replayTint(g,ti);
   if(!g.primed){g.primed=true;g.prev.copy(g.m.position);}
   heatFeed(g.active||g.m,RB.keys[ti],jDt>0?g.prev.distanceTo(g.m.position)/jDt:0,g.shim);
   // roll off the step just travelled, before prev is advanced (the trail test below reads it)
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
 heatClose();
 // camera: hand-held chase toward the shot's placement plus a push-in on the slow-mo; the gaze is the ball unless the shot set RP.hasLook
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
