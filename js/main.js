'use strict';
/* ================= main loop ================= */
/* Fixed-timestep sim + render interpolation. The simulation (input/AI/rods/
   physics) only ever advances in constant FIXED-second slices, so it's stable
   and deterministic regardless of frame rate. The renderer then draws each ball
   and rod lerped between its previous and current sim slice by 'alpha' (the
   leftover sub-slice time), so on-screen motion is buttery-smooth at any refresh.
   Wall-clock stuff (countdown, match clock, fx, camera, hud) stays per-frame. */
let lastT=performance.now(), physAcc=0;
function loop(t){
 requestAnimationFrame(loop);
 const rdt=Math.min(.05,(t-lastT)/1000);lastT=t;
 Au.tick(rdt);
 gamepadUpdate(rdt);   // poll controller once per rendered frame (in-match play + pause)
 const active=S.phase==='play'||S.phase==='goal'||S.phase==='count';
 if(active){
  const FIXED=1/SIM.hz;
  /* --- wall-clock timers (real time, once per frame) --- */
  if(S.phase==='play'){S.matchTime+=rdt;checkMatchClock();}
  if(S.phase==='goal'){S.goalT-=rdt;if(S.goalT<=0)startCount(MATCH.recount);}
  else if(S.phase==='count'){
   S.countT-=rdt;
   const v=Math.ceil(S.countT);
   if(v!==S.lastCount&&v>=1&&v<=3){S.lastCount=v;Au.beep(880,.09,'square',.14);}
   $('count').textContent=S.countT>3?'READY':(v>=1?String(v):'');
   if(S.countT<=0){$('count').style.display='none';Au.beep(1400,.2,'square',.18);serve();}
  }
  if(S.timeScale<1)S.timeScale=Math.min(1,S.timeScale+rdt*.9);
  /* --- fixed-rate simulation (slow-mo just consumes sim-time slower) --- */
  physAcc+=rdt*S.timeScale;
  for(const r of rods)r.aimSweet=-1;   // clear BEFORE the sim so physics can set it and debug reads it this frame
  let stepped=false,steps=0;
  while(physAcc>=FIXED&&steps<SIM.maxSteps){
   if(!stepped)for(const b of S.balls)b.m.position.copy(b.cur); // undo last frame's interp → true sim state
   for(const b of S.balls)b.prev.copy(b.m.position);
   for(const r of rods){r.iPrevOff=r.offset;r.iPrevAng=r.angle;}
   if(S.phase==='play'){aiUpdate(FIXED);userControlUpdate(FIXED);powerupUpdate(FIXED);deadBallUpdate(FIXED);cannonballUpdate(FIXED);}
   else if(S.phase==='count')userControlUpdate(FIXED);
   updateRods(FIXED);
   physics(FIXED);
   S.time+=FIXED;physAcc-=FIXED;steps++;stepped=true;
  }
  if(steps>=SIM.maxSteps)physAcc=0;                    // spiral-of-death guard: drop the backlog
  if(stepped){
   for(const b of S.balls)b.cur.copy(b.m.position);    // capture true current sim state
   for(const r of rods){r.iOff=r.offset;r.iAng=r.angle;}
  }
  /* --- render interpolation --- */
  const alpha=clamp(physAcc/FIXED,0,1);
   for(const b of S.balls){
    b.m.position.lerpVectors(b.prev,b.cur,alpha);
    if(b.light)b.light.position.copy(b.m.position);
    cannonballWarn(b);
   }
    for(const r of rods){
     if(r.iOff===undefined){r.iOff=r.iPrevOff=r.offset;r.iAng=r.iPrevAng=r.angle;}
    r.pivot.position.z=lerp(r.iPrevOff,r.iOff,alpha);
    r.pivot.rotation.z=lerp(r.iPrevAng,r.iAng,alpha);
   }
   fractureUpdate(rdt);   // advance/fade any live cannonball-fracture instances
   respawnSwirlUpdate(rdt); // spawn/advance/fade the pre-respawn swirl for removed players
  }
 fxUpdate(rdt);
 cameraUpdate(rdt);
 debugUpdate();
 if(S.phase!=='menu')hudTick(rdt);
 renderer.render(scene,camera);
}
initThree();
initCustomize();
bindUI();
// boot() is idempotent: whichever fires first — the asset chain below or the failsafe
// timeout — builds the world and starts the loop; the other becomes a no-op. Every
// build step falls back to primitives when its GLB is absent, so a force-start can't
// leave a broken scene (worst case: primitive rods/players until a late GLB is picked up).
let booted=false;
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
 buildRods();applyTable();applyTheme();applyColors();
 if(typeof introGameReady==='function')introGameReady();  // release the intro's loading hold
 requestAnimationFrame(loop);
 // Footprint dump: boot() is pre-first-frame (GPU uploads lazily on render, so
 // texture/shader counts read low here); the delayed snapshot is the real
 // menu-idle cost. Call memLog('x') from the console any time for a fresh read.
 if(typeof memLog==='function'){memLog('boot');setTimeout(()=>memLog('boot+3s'),3000);}
}
// requestIdleCallback w/ a setTimeout fallback (Safari has no native rIC) — used to nudge
// remaining heavy one-off work (shader precompile) off the browser's busiest ticks.
const ric=window.requestIdleCallback||function(fn,o){return setTimeout(fn,(o&&o.timeout)||50);};
function startLoading(){
 loadTableModel();                       // swaps in the GLB table when ready (falls back to primitives)
 loadPitchModel(()=>{applyPitchModel();}); // pitch GLB (one mesh per theme variant); falls back to jpg
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
