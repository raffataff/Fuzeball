'use strict';
/* ================= main loop ================= */
/* Fixed-timestep sim + render interpolation. The simulation (input/AI/rods/
   physics) only ever advances in constant FIXED-second slices, so it's stable
   and deterministic regardless of frame rate. The renderer then draws each ball
   and rod lerped between its previous and current sim slice by 'alpha' (the
   leftover sub-slice time), so on-screen motion is buttery-smooth at any refresh.
   Wall-clock stuff (countdown, match clock, fx, camera, hud) stays per-frame. */
let lastT=performance.now(), physAcc=0, lastFrameT=0; let lastAlpha=-1;   // last render-interp alpha, for the shadow-map freeze below
/* Detected display refresh (Hz), for the 'Match display' frame-rate limit. Probed once at startup on
   its OWN rAF chain — separate from loop(), so the game's own frame cap can't throttle the measurement.
   rAF fires at the display's refresh regardless, so ~80 samples at menu-idle give a clean median. The
   Options screen refines it live (optionsTick) in case the window moves to another monitor. */
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
/* The perf* calls are the frame profiler's hooks (js/perf.js, M key). They cost one boolean
   read each when it's off. The buckets they carve the frame into — sim / fx / refl / rend —
   are what the overlay attributes a slow frame to, so keep them paired and non-overlapping
   if this loop is ever restructured. */
/* PHOTO MODE (F1, js/photo.js) holds BOTH clocks. The sim freeze is the same physAcc lever
   training pulls, but a still also needs the wall-clock block held: leave it running and the goal
   hold expires while you're composing, a replay opens under the panel, and the countdown ticks
   down to a serve nobody asked for. Held here rather than inside each timer so there is one place
   that says "the match does not advance while a photo is being taken". */
function loop(t){
 requestAnimationFrame(loop);
 // Frame-rate limit (Options → Display · cfg.fpsCap): skip rAF ticks that arrive sooner than the target
 // interval. cfg.fpsCap is a number, or 'match' to track the detected refresh. The return is BEFORE
 // lastT is touched, so rdt still spans the real gap and the fixed-step sim stays correct — the cap only
 // renders less often (less GPU work → cooler and steadier on weak hardware). Browser rAF is vsync-locked,
 // so the effective cap quantises to refresh divisors (e.g. a 30 cap on a 60Hz panel renders every other frame).
 const cap=cfg.fpsCap==='match'?detectedHz:cfg.fpsCap;
 if(cap>0&&t-lastFrameT<1000/cap-0.5)return;
 lastFrameT=t;
 perfFrame();           // open the profiler's frame AFTER the cap return, so a capped-away tick isn't counted
 const rdt=Math.min(.05,(t-lastT)/1000);lastT=t;
 Au.tick(rdt);
 gamepadUpdate(rdt);   // poll controller once per rendered frame (in-match play + pause)
 const active=S.phase==='play'||S.phase==='goal'||S.phase==='count';
 if(active){
  const FIXED=1/SIM.hz;
  /* --- wall-clock timers (real time, once per frame) --- */
  // …all of them held while photo mode is up. See the note above loop().
  if(!S.photo){
   if(S.phase==='play'){S.matchTime+=rdt;checkMatchClock();}
   // goal hold → instant replay if there's footage, else straight on. finishPendingWin() is the
   // match-winning-goal path (flow.js): normally the replay's end routes there, this is the backstop
   // for a win whose replay stopped being playable during the hold — the win screen can't be lost.
   if(S.phase==='goal'){S.goalT-=rdt;if(S.goalT<=0){if(replayPending())replayStart();else if(!finishPendingWin())startCount(MATCH.recount);}}
   else if(S.phase==='count'){
    S.countT-=rdt;
    const v=Math.ceil(S.countT);
    if(v!==S.lastCount&&v>=1&&v<=3){S.lastCount=v;Au.beep(880,.09,'square',.14);}
    $('count').textContent=S.countT>3?'READY':(v>=1?String(v):'');
    if(S.countT<=0){$('count').style.display='none';Au.beep(1400,.2,'square',.18);serve();}
   }
  }
  if(S.timeScale<1)S.timeScale=Math.min(1,S.timeScale+rdt*.9);
  /* --- fixed-rate simulation (slow-mo just consumes sim-time slower) --- */
  physAcc+=rdt*S.timeScale;
  // training freeze: hold the sim (render keeps running so placement/camera stay live);
  // each queued step (Step button / O) releases exactly ONE fixed slice.
  if(S.trn&&S.trn.freeze){if(S.trn.stepQ>0){S.trn.stepQ--;physAcc=FIXED;}else physAcc=0;}
  // photo freeze — same lever, applied LAST so it wins over training's. Unfreezing inside photo
  // mode is deliberate (let a rally run to the pose you want, then re-freeze on it).
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
   if(S.phase==='play')recordReplay(); // flight recorder (replay.js): a few float writes into a ring buffer.
                                       // Post-physics gate on purpose: the goal step itself isn't recorded,
                                       // so the buffer ends with the ball still at the line (freeze-frame keeps it).
   S.time+=FIXED;physAcc-=FIXED;steps++;stepped=true;
  }
  perfAdd('p','sim');perfSteps(steps);   // steps pinned at SIM.maxSteps is the cost-latch signature
  if(steps>=SIM.maxSteps)physAcc=0;                    // spiral-of-death guard: drop the backlog
  if(stepped){
   for(const b of S.balls)b.cur.copy(b.m.position);    // capture true current sim state
   for(const r of rods){r.iOff=r.offset;r.iAng=r.angle;}
  }
  /* --- render interpolation --- */
  perfMark('p');
  const alpha=clamp(physAcc/FIXED,0,1);
   for(const b of S.balls){
    b.m.position.lerpVectors(b.prev,b.cur,alpha);
    if(b.light)b.light.position.copy(b.m.position);
    cannonballWarn(b);
   }
    for(const r of rods){
     if(r.iOff===undefined){r.iOff=r.iPrevOff=r.offset;r.iAng=r.iPrevAng=r.angle;}
    r.pivot.position.z=lerp(r.iPrevOff,r.iOff,alpha);
    // r.trem is the overcharge tremble (js/shots.js) and it is added HERE, on the DISPLAY pose, not
    // in r.angle. angVel is differenced from r.angle, so a shaking boot in the sim would kick the
    // ball it is resting against — an own-goal generator dressed as a readout. The control the
    // player is losing is already modelled, as shotCtl.
    r.pivot.rotation.z=lerp(r.iPrevAng,r.iAng,alpha)+(r.trem||0);
   }
   // Casters moved this frame, so the frozen shadow map (CONFIG.render.shadow.autoUpdate:false)
   // needs re-rendering. Gated on the sim having stepped OR the interpolation alpha having moved,
   // which is what makes a photo/training FREEZE hold the map too: alpha pins at 0 and no step
   // runs, so the pass stops. In ordinary play alpha moves every frame, so nothing is lost.
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
 if(S.phase!=='menu')hudTick(rdt);
 if(S.trn)trainingTick();               // training panel readout (ball pos/speed)
 // photo mode (F1) — camera rig, key/turntable motion and the scene hides. LAST on purpose: it has
 // to write AFTER fxUpdate and sweetGuideUpdate, which own the markers it hides and would put them
 // straight back. That ordering is also what makes the restore free (see phSceneApply).
 if(S.photo)phTick(rdt);
 if(S.redit)reditTick();                 // room editor self-heal (venue changed under the panel)
 perfAdd('p','fx');
 perfMark('p');
 updateBallReflect();                   // local cube-map pass for ball reflections (world.js; throttled, self-gating, no-op off)
 perfAdd('p','refl');
 perfMark('p');
 // IDLE-RENDER GATE (js/world.js renderIdleSkip). In the menus nothing on the table moves and
 // `.screen` covers it at 94% opacity behind a 6px blur, so the backdrop is redrawn at a trickle
 // instead of at 60Hz — which is also what frees the frame budget a venue swap needs. It never
 // skips a live phase, the room editor, photo mode, free roam or the debug overlay, and it falls
 // back to always-render if world.js somehow hasn't parsed. See the block above renderIdleSkip.
 if(!(typeof renderIdleSkip==='function'&&renderIdleSkip(rdt))){
  renderer.render(scene,camera);
  // photo mode's clip recorder grabs its frame HERE and nowhere else: the renderer has no
  // preserveDrawingBuffer, so the drawing buffer is only guaranteed intact for the rest of THIS
  // task. Same constraint the still capture works under. No-op unless a take is rolling.
  // Safe under the gate: photo mode is one of the states it never skips.
  if(S.photo)phPostRender();
 }
 perfAdd('p','rend');
 perfFrameEnd();
}
initThree();
initCustomize();
bindUI();
// boot() is idempotent: whichever fires first — the asset chain below or the failsafe
// timeout — builds the world and starts the loop; the other becomes a no-op. Every
// build step falls back to primitives when its GLB is absent, so a force-start can't
// leave a broken scene (worst case: primitive rods/players until a late GLB is picked up).
let booted=false;const bootWaiters=[];
// Run cb once the world exists (boot() has run: rods built, table/room/colours applied); fires
// immediately if that already happened. The match-start gate uses this to wait for core assets.
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
 // Footprint dump: boot() is pre-first-frame (GPU uploads lazily on render, so
 // texture/shader counts read low here); the delayed snapshot is the real
 // menu-idle cost. Call memLog('x') from the console any time for a fresh read.
 if(typeof memLog==='function'){memLog('boot');setTimeout(()=>memLog('boot+3s'),3000);}
 while(bootWaiters.length)bootWaiters.shift()();   // release anyone waiting on the world (match-start gate)
}
// requestIdleCallback w/ a setTimeout fallback (Safari has no native rIC) — used to nudge
// remaining heavy one-off work (shader precompile) off the browser's busiest ticks.
const ric=window.requestIdleCallback||function(fn,o){return setTimeout(fn,(o&&o.timeout)||50);};
let loadStarted=false;
function startLoading(){
 if(loadStarted)return;loadStarted=true;  // idempotent: fired by the intro-skip, the timer below, OR the match-start gate — whichever comes first
 loadTableModel();                       // swaps in the GLB table when ready (falls back to primitives)
 // The ACTIVE pitch only. This used to be loadPitchModel(), which fetched one 32MB atlas holding
 // all eight and decoded all 22 of its images to show three of them — the largest single item in
 // the boot budget, and seven-eighths of it discarded. drawField owns the fetch now (ensurePitch,
 // models.js), so this is just "start it early" rather than a different code path.
 if(typeof drawField==='function')drawField();
 // Floating power-up pickups. Off the boot chain on purpose (nothing waits on them — a pickup is
 // ~10s into a match at the earliest, and a missing GLB just falls back to the procedural gem),
 // but loaded NOW rather than on demand so the fetch+parse never lands mid-rally. The warm is
 // idle-nudged for the same reason the fracture one is.
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
// Guarantee every asset a fully-textured match needs is resident, THEN run cb. Resolves
// SYNCHRONOUSLY when everything's already cached (the usual case → no visible wait); otherwise it
// kicks the load chain off now — this is what rescues a SKIPPED intro, where the timed startLoading
// hasn't fired yet — and waits for the world to build + the selected table skin, room backdrop and
// both figurines to land. Can't hang: the 8s boot failsafe caps the wait and every loader falls
// back to primitives on a missing/slow GLB. applyTable/applyRoom/loadPlayerModel each call their cb
// synchronously when their asset is cached (loadSkin / ensureRoom / modelCache short-circuits).
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
// The fuse-flight (bezier bend + trail + sparks every frame) is the intro's busiest visual
// stretch — GLTF parse callbacks landing mid-flight is what causes the stutter on the bend.
// Nothing needs these assets before boot() fires anyway, so just hold the whole chain off
// until detonation + the logo slam have settled. Skipped entirely if the intro itself is
// skipped (reduced-motion or CONFIG.intro.on=false), so nothing is delayed needlessly.
const introPlaying=CONFIG.intro.on&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
const loadDelay=introPlaying?(CONFIG.intro.igniteT+CONFIG.intro.fuseT+CONFIG.intro.slamDelay+0.35)*1000:0;
setTimeout(startLoading,loadDelay);
// Failsafe: if any loader stalls with no load/error event (e.g. an offline CDN or a hung
// network fetch), start anyway after 8s so the game never hangs on a black screen.
setTimeout(boot,8000);
