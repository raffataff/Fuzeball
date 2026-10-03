'use strict';
/* ================= main loop ================= */
// fixed-timestep sim + render interpolation: input/AI/rods/physics advance in constant slices (deterministic at any frame rate), the renderer lerps between slices by 'alpha'
// wall-clock things (countdown, match clock, fx, camera, hud) stay per-frame
let lastT=performance.now(), physAcc=0, lastFrameT=0; let lastAlpha=-1;   // last render-interp alpha, for the shadow-map freeze below
// detected display refresh (Hz) for the 'Match display' frame limit, probed once on its own rAF chain; Options refines it live (optionsTick)
let detectedHz=0;
(function probeRefresh(){
 let last=0,acc=[],n=0;
 function step(t){
  if(last){const d=t-last;if(d>1&&d<100)acc.push(d);}
  last=t;
  if(++n<80){requestAnimationFrame(step);return;}
  acc.sort((a,b)=>a-b);detectedHz=Math.round(1000/(acc[acc.length>>1]||16.7));
 }
 requestAnimationFrame(step);
})();
// perf* calls are the frame profiler's hooks (js/perf.js, M key); keep the buckets (sim / fx / refl / rend) paired and non-overlapping
// PHOTO MODE (F1) holds both clocks: the sim freeze is training's physAcc lever, plus the wall-clock timers (goal hold, replay, countdown), in one place
function loop(t){
 requestAnimationFrame(loop);
 // frame-rate limit (Options > Display, cfg.fpsCap: a number or 'match'): skip rAF ticks that arrive too soon; returns before lastT is touched so rdt spans the real gap and the sim stays correct
 const cap=cfg.fpsCap==='match'?detectedHz:cfg.fpsCap;
 if(cap>0&&t-lastFrameT<1000/cap-0.5)return;
 lastFrameT=t;
 perfFrame();           // open the profiler's frame after the cap return, so a capped-away tick isn't counted
 const rdt=Math.min(.05,(t-lastT)/1000);lastT=t;
 Au.tick(rdt);
 gamepadUpdate(rdt);   // poll controller once per rendered frame (in-match play + pause)
 shotSeatsUpdate(rdt); // …then ONE shot step per seat, pad + keyboard/mouse merged (js/shots.js)
 mouseLockTick();      // cursor lock re-asserted off live state, so no exit path can strand it (js/input.js)
 const active=S.phase==='play'||S.phase==='goal'||S.phase==='count';
 if(active){
  const FIXED=1/SIM.hz;
  // --- wall-clock timers (real time, once per frame) ---
  // …all of them held while photo mode is up. See the note above loop().
  if(!S.photo){
   if(S.phase==='play'){S.matchTime+=rdt;checkMatchClock();}
   // goal hold: instant replay if there's footage, else straight on; finishPendingWin() (flow.js) is the backstop for a win whose replay stopped being playable
   if(S.phase==='goal'){S.goalT-=rdt;if(S.goalT<=0){if(replayPending())replayStart();else if(!finishPendingWin())startCount(MATCH.recount);}}
   else if(S.phase==='count'){
    S.countT-=rdt;
    const v=Math.ceil(S.countT);
    if(v!==S.lastCount&&v>=1&&v<=3){S.lastCount=v;Au.count(v);}
    hudCount(S.countT>3?'READY':v>=1?v:'');
    if(S.countT<=0){hudCount('');Au.count(0);serve();}
   }
  }
  if(S.timeScale<1)S.timeScale=Math.min(1,S.timeScale+rdt*.9);
  // --- fixed-rate simulation (slow-mo just consumes sim-time slower) ---
  physAcc+=rdt*S.timeScale;
  // training freeze: hold the sim; each queued step (Step button / O) releases one fixed slice
  if(S.trn&&S.trn.freeze){if(S.trn.stepQ>0){S.trn.stepQ--;physAcc=FIXED;}else physAcc=0;}
  // photo freeze: same lever, applied last so it wins over training's
  if(S.photo&&S.photo.freeze){if(S.photo.stepQ>0){S.photo.stepQ--;physAcc=FIXED;}else physAcc=0;}
  for(const r of rods)r.aimSweet=-1;   // clear BEFORE the sim so physics can set it and debug reads it this frame
  let stepped=false,steps=0;
  perfMark('p');
  while(physAcc>=FIXED&&steps<SIM.maxSteps){
   if(!stepped)for(const b of S.balls)b.m.position.copy(b.cur); // undo last frame's interp → true sim state
   for(const b of S.balls)b.prev.copy(b.m.position);
   for(const r of rods){r.iPrevOff=r.offset;r.iPrevAng=r.angle;}
   if(S.phase==='play'){aiUpdate(FIXED);userControlUpdate(FIXED);powerupUpdate(FIXED);deadBallUpdate(FIXED);cannonballUpdate(FIXED);}
   else if(S.phase==='count')userControlUpdate(FIXED);
   updateRods(FIXED);
   physics(FIXED);
   if(S.phase==='play')recordReplay(); // flight recorder (replay.js): a few float writes into a ring buffer
                                       // post-physics gate on purpose: the goal step isn't recorded, so the buffer ends with the ball at the line
   S.time+=FIXED;physAcc-=FIXED;steps++;stepped=true;
  }
  perfAdd('p','sim');perfSteps(steps);   // steps pinned at SIM.maxSteps is the cost-latch signature
  if(steps>=SIM.maxSteps)physAcc=0;                    // spiral-of-death guard: drop the backlog
  if(stepped){
   for(const b of S.balls)b.cur.copy(b.m.position);    // capture true current sim state
   for(const r of rods){r.iOff=r.offset;r.iAng=r.angle;}
  }
  // --- render interpolation ---
  perfMark('p');
  const alpha=clamp(physAcc/FIXED,0,1);
   heatOpen();                        // balls.js: one red-hot readout per ball type, so same-type balls can't fight over their shared material
   for(const b of S.balls){
    b.m.position.lerpVectors(b.prev,b.cur,alpha);
    if(b.light)b.light.position.copy(b.m.position);
    cannonballWarn(b);
    heatFeed(b.m,b.key,b.v.length(),b);
   }
   heatClose();
    for(const r of rods){
     if(r.iOff===undefined){r.iOff=r.iPrevOff=r.offset;r.iAng=r.iPrevAng=r.angle;}
    r.pivot.position.z=lerp(r.iPrevOff,r.iOff,alpha);
    // r.trem (the overcharge tremble, js/shots.js) goes on the display pose, not r.angle: angVel is differenced from r.angle, so a shaking sim boot would kick the ball
    r.pivot.rotation.z=lerp(r.iPrevAng,r.iAng,alpha)+(r.trem||0);
   }
   // casters moved: the frozen shadow map (CONFIG.render.shadow.autoUpdate:false) needs a redraw; gated on a sim step or alpha moving, so a photo/training freeze holds the map
   if(stepped||alpha!==lastAlpha){shadowDirty();lastAlpha=alpha;}
   fractureUpdate(rdt);   // advance/fade any live cannonball-fracture instances
   respawnSwirlUpdate(rdt); // spawn/advance/fade the pre-respawn swirl for removed players
   perfAdd('p','fx');
  }
 perfMark('p');
 replayUpdate(rdt);      // playback owns balls/rods/camera while phase==='replay' (no-op otherwise)
 if(S.phase==='replay')shadowDirty();   // playback re-poses the rods from the ring buffer — casters move
 fxUpdate(rdt);
 if(S.phase!=='replay')cameraUpdate(rdt);   // the replay's shot camera has the conn during playback
 debugUpdate();
 sweetGuideUpdate();
 if(S.trn)trainingTick();               // training panel readout (ball pos/speed)
 // photo mode (F1): camera rig, key/turntable motion and scene hides; last on purpose, it writes after fxUpdate and sweetGuideUpdate (see phSceneApply)
 if(S.photo)phTick(rdt);
 if(S.redit)reditTick();                 // room editor self-heal (venue changed under the panel)
 perfAdd('p','fx');
 perfMark('p');
 updateBallReflect();                   // local cube-map pass for ball reflections (world.js; throttled, self-gating)
 perfAdd('p','refl');
 perfMark('p');
 // IDLE-RENDER GATE (world.js renderIdleSkip): in the menus the backdrop redraws at a trickle; never skips a live phase, the room editor, photo mode, free roam or the debug overlay
 if(!(typeof renderIdleSkip==='function'&&renderIdleSkip(rdt))){
  renderer.render(scene,camera);
  // photo mode's clip recorder grabs its frame here only (no preserveDrawingBuffer); no-op unless a take is rolling
  if(S.photo)phPostRender();
 }
 // the canvas HUD is outside the idle-skip gate (a toast or fade must land on a frame the table skipped)
 hudRender(rdt);
 perfAdd('p','rend');
 perfFrameEnd();
}
initThree();
initCustomize();
bindUI();
// boot() is idempotent: whichever fires first (the asset chain or the failsafe) builds the world and starts the loop; every build step falls back to primitives
let booted=false;const bootWaiters=[];
// run cb once the world exists (boot() has run), immediately if it already did; the match-start gate waits on this
function whenBooted(cb){if(booted){cb();return;}bootWaiters.push(cb);}
function applyLogo(){
 var el=document.querySelector('.logo');if(!el)return;
 var L=CONFIG.logo;
 if(L.src)el.src=L.src;
 el.style.setProperty('max-width',L.width+'px');
 el.style.setProperty('--logo-glow',L.glow);
 el.style.setProperty('--logo-glow-size',L.glowSize+'px');
 el.style.setProperty('--logo-pulse-size',L.pulseSize+'px');
 el.style.setProperty('--logo-pulse-speed',L.pulseSpeed+'s');
}
function boot(){
 if(booted)return;booted=true;
 applyLogo();
 buildRods();applyTable();applyRoom();applyColors();
 if(typeof renderDirty==='function')renderDirty();        // first frame of the world: draw it at full rate
 if(typeof introGameReady==='function')introGameReady();  // release the intro's loading hold
 requestAnimationFrame(loop);
 // footprint dump: boot() is pre-first-frame (GPU uploads lazily), so the delayed snapshot is the real menu-idle cost
 if(typeof memLog==='function'){memLog('boot');setTimeout(()=>memLog('boot+3s'),3000);}
 while(bootWaiters.length)bootWaiters.shift()();   // release anyone waiting on the world (match-start gate)
}
// requestIdleCallback with a setTimeout fallback (Safari has none)
const ric=window.requestIdleCallback||function(fn,o){return setTimeout(fn,(o&&o.timeout)||50);};
let loadStarted=false;
function startLoading(){
 if(loadStarted)return;loadStarted=true;  // idempotent: fired by the intro-skip, the timer below, or the match-start gate, whichever comes first
 loadTableModel();                       // swaps in the GLB table when ready (falls back to primitives)
 // the active pitch only; drawField owns the fetch (ensurePitch, models.js), this just starts it early
 if(typeof drawField==='function')drawField();
 // floating power-up pickups: off the boot chain on purpose but loaded now so the parse never lands mid-rally; the warm is idle-nudged
 loadPowerupModels(()=>{ric(warmPowerupShaders,{timeout:1200});});
 loadBallModel(()=>{                     // ball GLB with material slots
  loadPlayerModel(()=>{
   loadExplosionModels(()=>{             // shared cannonball + swirl GLBs only (per-figurine shatters lazy-load)
    ric(warmFractureShaders,{timeout:1000}); // precompile shaders off-screen, still nudged off the main tick
    ensureExplosionModel(activeModel(0).id); // prime the two figurines actually on the table (each warms itself on load)
    ensureExplosionModel(activeModel(1).id);
    loadRodModels(()=>{                  // rod GLBs must be ready before buildRods clones them
     boot();
    });
   });
  });
 });
}
// guarantee every asset a fully-textured match needs is resident, then run cb: synchronous when cached, else kick the load chain off now (rescues a skipped intro) and wait
// can't hang: the 8s boot failsafe caps the wait and every loader falls back to primitives
function ensureMatchAssets(cb){
 startLoading();
 whenBooted(()=>{
  let a=false,b=false,c=false;
  const done=()=>{if(a&&b&&c&&cb){const f=cb;cb=null;f();}};
  applyTable(()=>{a=true;done();});      // active table skin resident
  applyRoom(()=>{b=true;done();});       // active room backdrop resident
  loadPlayerModel(()=>{c=true;done();}); // both team figurines resident
 });
}
// hold the asset chain off until the intro's fuse flight settles (parse callbacks mid-flight stutter it); skipped if the intro is (reduced-motion or CONFIG.intro.on=false)
const introPlaying=CONFIG.intro.on&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const loadDelay=introPlaying?(CONFIG.intro.igniteT+CONFIG.intro.fuseT+CONFIG.intro.slamDelay+0.35)*1000:0;
setTimeout(startLoading,loadDelay);
// failsafe: if a loader stalls with no load/error event, start anyway after 8s
setTimeout(boot,8000);
