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
 const active=S.phase==='play'||S.phase==='goal'||S.phase==='count';
 if(active){
  const FIXED=1/SIM.hz;
  /* --- wall-clock timers (real time, once per frame) --- */
  if(S.phase==='play')S.matchTime+=rdt;
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
  }
   for(const r of rods){
    if(r.iOff===undefined){r.iOff=r.iPrevOff=r.offset;r.iAng=r.iPrevAng=r.angle;}
    r.pivot.position.z=lerp(r.iPrevOff,r.iOff,alpha);
    r.pivot.rotation.z=lerp(r.iPrevAng,r.iAng,alpha);
   }
   fractureUpdate(rdt);   // advance/fade any live cannonball-fracture instances
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
loadTableModel();                       // swaps in the GLB table when ready (falls back to primitives)
loadBallModel(()=>{                     // ball GLB with material slots
  loadPlayerModel(()=>{
   loadExplosionModels(()=>{             // cannonball-kill fracture GLBs (if any figurine has one)
    warmFractureShaders();               // precompile their shaders now, off-screen — never during a match
    loadRodModels(()=>{                  // rod GLBs must be ready before buildRods clones them
     buildRods();applyTable();applyTheme();applyColors();
     requestAnimationFrame(loop);
    });
   });
  });
});
