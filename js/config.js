'use strict';
/* =========================================================================
   FUZEBALL — GLOBAL CONFIG
   Every impactful, tweakable number lives here. Change a value, reload the
   page, and the game reflects it. Nothing else in the codebase hard-codes
   these — the game modules read them straight off CONFIG (and the short
   aliases derived at the bottom of this file).

   Coordinate system: X = long axis (goal to goal), Z = width, Y = up.
   Field surface sits at y = 0. Goals at x = ±L/2. Left net red, right net blue.
   ========================================================================= */
const CONFIG = {

  /* ---- logo ----------------------------------------------------------- */
  logo:{
   src:'assets/fuzeball_logo.png',  // path to the logo image
   width:460,                       // max width in px
   glow:'#5090ff',                  // glow colour for the drop-shadow + pulse
   glowSize:28,                     // base glow spread (px)
   pulseSize:44,                    // glow spread at pulse peak (px)
   pulseSpeed:3                     // pulse cycle duration (s)
  },

  /* ---- intro cinematic (boot splash → main menu) ----------------------- */
  // The lit-fuse opening: a spark snakes across the dark screen, detonates in
  // a shockwave, the logo slams in with chromatic aberration, a shine sweeps
  // it, then the logo morphs up into its menu spot while the menu staggers in.
  // Pure canvas/CSS — no video, no libs. Any key/click skips it.
  intro:{
   on:true,          // master switch — false boots straight to the menu
   skip:true,        // allow key/click to skip
   fuseT:2.05,       // seconds the spark spends travelling before detonation
   igniteT:0.35,     // darkness before the spark lights
   slamDelay:0.10,   // detonation → logo slam start (s)
   shineDelay:0.85,  // slam start → specular sweep (s)
   tagDelay:0.55,    // slam start → tagline letters begin (s)
   revealT:4.35,     // total time before the menu-reveal morph begins (s)
   holdMax:6,        // extra seconds to wait for slow asset loads before revealing anyway
   burstN:240,       // detonation ember count
   shake:24,         // detonation screen-shake amplitude (px)
   sparkRate:9,      // sparks sprayed from the fuse head per frame
   emberGrav:520,    // gravity on detonation embers (px/s²)
   fuseGlow:'#ffb347',// fuse trail / spark tint
   ringCol:'255,178,80' // shockwave ring rgb
  },

  /* ---- match / rules -------------------------------------------------- */
  match:{
  countIn:3.6,      // opening countdown length (s)
  recount:1.5,      // countdown length after a goal/out
  goalHold:2.0,     // 'goal' celebration phase before re-count (s)
  goalSlowmo:0.15,  // time-scale during that phase (slow-mo)
  outHold:1.5,      // pause after a ball goes out (s)
  warnT:5          // final-seconds warning: clock pulses red + ticks in the last N seconds
 },

 /* ---- frame profiler (js/perf.js · M key) -----------------------------
    Dev instrument for the intermittent frame-rate sags: every frame slower than
    `spikeMs` (or spikeMult x the running-typical frame, whichever is larger) writes
    one line with its full cost breakdown. See the header of js/perf.js for what the
    verdicts mean. Nothing here affects gameplay; the whole file is inert when off. */
 perf:{
  pub:500,        // ms between panel repaints (the panel shows the WORST frame since the last one)
  spikeMs:45,     // absolute floor: a frame longer than this is always logged
  spikeMult:2.6,  // relative: ...or this many times the running-typical frame
  spikeMax:14,    // spike lines kept in the ring
  gcDrop:6        // JS heap must FALL this many MB in one frame to be called a GC (Chrome only)
 },

 /* ---- simulation timing ---------------------------------------------- */
 sim:{
  hz:120,        // fixed physics rate (steps/sec). The sim always advances in
                 // constant 1/hz slices; the renderer interpolates between slices,
                 // so motion is smooth at any display refresh. Higher = crisper
                 // collisions at more CPU. 120 is a good balance.
  maxSteps:7     // max fixed steps run in a single frame (spiral-of-death guard:
                 // after a long stall we drop the backlog instead of freezing)
 },

 /* ---- table geometry ------------------------------------------------- */
 table:{ L:120, W:68, wallH:10, goalHalf:11, goalH:10.2, goalDepth:9 },

 /* ---- procedural goal net shape ---------------------------------------
    The net (world.js buildGoalNet) is ONE cross-section swept from the goal line
    back to the rear plane, so its silhouette is data rather than five hard-coded
    quads. `bevel` rounds the two TOP SIDE CREASES — where the roof meets each side
    panel — so the net's shoulders echo the frame's rounded post/crossbar joint
    instead of meeting at a bare 90°.
      r     how far the round bites into the roof (in z) and down the side (in y),
            in world units. 0 = the old hard corner. Auto-clamped to half the mouth
            half-width and half the goal height, so it can't invert on a tight goal.
      segs  arc segments per crease. 1 = a flat chamfer, 3-5 reads round; the net
            texture hides faceting long before more triangles are worth it.
    COSMETIC ONLY — physics keeps its flat roof plane at goalH (goalFrameCollide),
    so with a large r a ball resting on the roof floats just off the visual net
    within r of the side. Keep r well under goalHalf and it's invisible.
      cell        net square size in world units (UV tiling; smaller = finer mesh).
      backInset   rear plane width AND depth as a fraction of the mouth — keeps the
                  net inside the wall gap behind the goal.
    ---------------------------------------------------------------------- */
 goalNet:{ bevel:{ r:1.8, segs:4 }, cell:1.6, backInset:0.98 },

 /* ---- table registry ---------------------------------------------------- */
 // Each entry is ONE selectable table SHAPE. `folder` is its asset folder;
 // `collision` picks the physics shell — 'flat' = the classic box walls in
 // physics.js, 'bowl' = the curved SDF in arena.js; `room` is an optional
 // environment GLB (path relative to folder); `defTheme` is the lighting livery
 // that suits it (metadata only — themes/pitches stay independently selectable).
 //
 // SKINS = swappable paint jobs on the SAME shape (like pitches, but for the whole
 // table). Each `skins` entry is a GLB of this shape textured differently; `glb` is
 // relative to `folder` (+ optional absolute `glbFallback`). The Skin dropdown lists
 // them; `defSkin` is the one shown first. Adding a skin = texture the shape in
 // Blender, export a new GLB (tools/build_table.py + export_table.py, SKIN_ID), add
 // a line here. Every table needs at least one skin.
 //
 // RODS (optional) = a per-table rod livery. VISUAL ONLY — physics/RODDEFS are identical
 // across every table; this just swaps the rod hardware GLBs (bar+handle+collar+knob; the
 // MEN/figurines are the customize model, never table-specific). Omit `rods` and the table
 // uses the stock shared set in assets/rods/. Provide `rods:{folder, files?}` to give a table
 // its own set: `folder` holds fuzeball_rod_<n>man.glb for n in 1,2,3,5 (override individual
 // names via `files:{2:'...glb'}`). Any size the table set is MISSING falls back to the shared
 // set, then to the primitive rod — so a table can override just one size, and a not-yet-built
 // set silently shows stock rods. Sets are lazy-loaded on first use and reskinned in on table
 // switch (models.js loadRodSet / world.js reskinRods).
 //
 // To ADD a table: drop skin GLB(s) honouring the mesh-name contract
 // (field*/led*/goal_net*/goal_frame*/wall_end*) under assets/tables/<id>/ and add
 // an entry here — the loader + dropdowns pick it up. A 'flat' table needs no physics
 // change; a genuinely new SHAPE adds a collision branch. Shape params for a 'bowl'
 // table live under `bowl` (mirrored by tools/build_arena_table.py).
 tables:{
  classic:{
   name:'Classic',
   folder:'assets/tables/classic/',
   collision:'flat',                        // flat box walls (physics.js default branch)
   room:null,                               // no bespoke backdrop; uses the shared ground plane + crowd
   defTheme:'classic',
   defSkin:'wood', // default skin name (must match a skins entry)
   skins:{
      wood:{name:'Wood', glb:'fuzeball_table_classic_wood.glb'},
      sundayLeague:{name:'Sunday League', glb:'fuzeball_table_classic_sundayLeague.glb'},
      proLeague:{name:'Pro League', glb:'fuzeball_table_classic_proLeague.glb'},
      strike:{name:'Strike', glb:'fuzeball_table_classic_strike.glb'},
      alienTech:{name:'Alien Tech', glb:'fuzeball_table_classic_alienTech.glb'},                            
      alienShip: {name:'Alien Ship',  glb:'fuzeball_table_classic.glb', glbFallback:'assets/fuzeball_table.glb'}, 
   },
   // Dead-ball pockets (see CONFIG.deadball.zoneMult + deadzoneMult() in powerups.js). A ball
   // pinned in one of these regions is unreachable — no man can slide to it — so the dead-ball
   // timer ticks `mult`× faster there, cutting the wait. Each entry is a CORNER: the region where
   // BOTH |x|>xMin AND |z|>zMin, so it covers all four corners symmetrically (z≈0 in front of the
   // goal is NOT a deadzone — the centred GK reaches it). Walls: x=±60 (F.L/2), z=±34 (F.W/2); the
   // 1-man GK sits at x=±52.5 and slides to z≈±20. So xMin 52 / zMin 22 fences off the four
   // wall-corner pockets behind the keeper line. Tune per table; `mult` optional (defaults to
   // CONFIG.deadball.zoneMult). Omit `deadzones` entirely for a table with no dead pockets.
   deadzones:[
    {xMin:46, zMin:16.3}   // corner pocket (all 4 corners); uses CONFIG.deadball.zoneMult
   ]
  },
  arena:{
   name:'Arena',
   folder:'assets/tables/arena/',
   collision:'bowl',                        // curved Rocket-League-style bowl (arena.js SDF)
   room:'fuzeball_room_arena.glb',          // arcade-room backdrop (relative to folder)
   defTheme:'neon',
   defSkin:'standard',
   skins:{ standard:{name:'Standard', glb:'fuzeball_table_arena.glb'} },
   rods:{folder:'assets/tables/arena/rods/'},   // sci-fi rods (GLBs not built yet -> per-size fallback to shared set)
   // ---- bowl shape (only read when collision:'bowl'). All radii in table units;
   //      tweak and reload. tools/build_arena_table.py mirrors these numbers. ----
   bowl:{
   length:120,        // outer bowl length along x (the side-wall span). Default 120 = F.L,
                      // which puts the end wall exactly on the goal line (x=±60) so the goal
                      // pockets stay open — see the geometry note below before changing it.
                      //
                      // GEOMETRY: each side wall is straight for x ∈ ±(length/2 − cornerR),
                      // then the corner arc curves from there to the end wall at x = ±length/2.
                      // The goal mouth is fixed at the real goal line x = ±F.L/2 = ±60 (that's
                      // where scoring happens in physics.js — it does NOT move with length).
                      //   • The corner "sticks out in front of the goal" by exactly cornerR
                      //     units (it starts curving cornerR before the end). To make the bend
                      //     meet the goal instead of curving in front, shrink cornerR — the flat
                      //     wall then reaches x=±(60−cornerR) and the corner tucks into the end.
                      //   • Keep length ≈ F.L (120). length>120 pushes the end wall past the
                      //     goal line and BURIES the goal pockets (the bowl swallows them);
                      //     length<120 detaches the pockets from the wall. Retune goals in
                      //     physics.js if you really want a longer bowl.
   width:68,          // outer bowl width along z (the end-wall span). Default 68 = F.W, so the
                      // arena walls line up with the classic table. NOTE: the arena LOOKS a touch
                      // narrower than classic not because of this, but because the crease fillet
                      // rises from ~creaseR inside the wall — so the FLAT pitch area is ~creaseR
                      // narrower per side and the outer pitch lines ride up the slope. To match
                      // classic's flat width either drop creaseR or bump width by ~2·creaseR.
                      // (The shared pitch plane stays F.W wide, so widening much past F.W opens a
                      // gap between the painted lines and the wall — nudge, don't crank.)
   cornerR:12,        // plan-view corner radius of the rounded rectangle
   creaseR:4,         // floor↔wall fillet radius. 0 = a SHARP 90° corner (no fillet, no blend) —
                      // vertical walls meeting the flat floor, classic-table style. Raise it (keep
                      // ≤5.5) for a rounded Rocket-League bowl where the ball rides up the wall;
                      // above ~5.5 the ball hugging the wall sits too high for feet at max rod slide.
   postR:4,           // smooth-union radius where the crease/walls blend into the goal mouth
   mouthIn:8,         // how far the goal cavity punches inward past the goal line (opens the mouth)
   bigGoalReach:20,   // big-goal widen: x-distance IN FRONT of the goal line over which the mouth
                      //   widen fades to 0 (behind the line it's full). ~cornerR+mouthIn covers the
                      //   whole mouth flare; raise it to pull more of the front end-wall out with the mouth.
   bounceCut:6,       // normal-speed below which crease/wall contact rolls instead of bouncing
   fricNy:0.3,        // contact normal.y above this counts as 'grounded' → floor friction applies
   gradEps:0.02,      // central-difference step for the SDF gradient
   seg:{loop:200,profile:10} // visual mesh resolution: samples around the perimeter / up the profile
   },
   deadzones:[
    {xMin:46, zMin:16.30}   // corner pocket (all 4 corners); uses CONFIG.deadball.zoneMult
   ]
  },
  circuit:{                                  // flat shape with a WALLED goal end: the two mouth-flanking
   name:'Circuit',                           //   end walls are joined into ONE solid face the goal is
   folder:'assets/tables/circuit/',          //   inset into — over-the-bar shots bounce back into play
   collision:'flat',                         // classic flat-box collision + the endWall bounce (physics.js)
   endWall:{
    h:16.2                                     // solid end-wall height: balls hitting x=±60 below this bounce
                                             //   back instead of sailing over. Big Goal still widens the
                                             //   inset mouth (opening tracks goalHalf*bigGoalMult; the GLB's
                                             //   wall_end_* flanks slide + goal_frame_header_* stretches to
                                             //   match). Mirror tools/build_table.py TABLE_DEFS circuit
                                             //   endWallH when changing.
   },
   room:null,                                // no bespoke backdrop; uses the shared ground plane + crowd
   defTheme:'neon',                          // glowing-circuit look pairs with the neon livery (metadata only)
   defSkin:'standard',
   skins:{ standard:{name:'Circuit', glb:'fuzeball_table_circuit.glb'} },
   rods:{folder:'assets/tables/circuit/rods/'},   // glowing-circuit rods (GLBs not built yet -> per-size fallback to shared set)
   deadzones:[
    {xMin:46, zMin:16.30}   // same wall-corner pockets as classic (walls sit at the same x/z)
   ]
  }
 },

 /* ---- table asset residency (memory) ------------------------------------
    A table skin GLB is one of the fattest single assets in the game (shell +
    goals + baked textures), and a `room` backdrop is fatter still. Loading every
    table's at boot pinned all of them in RAM/VRAM to show ONE — this bounds it.
    Only the ACTIVE table's active skin (+ its room) is fetched at boot; the rest
    load on demand when picked (applyTable / selectSkin already funnel every
    switch), and least-recently-used ones past the caps are disposed.
    Caps count TOTAL resident entries INCLUDING the active one, which is always
    protected — so cacheSkins:1 means "only ever the one you're looking at",
    cacheSkins:2 keeps the previous one warm for instant A/B in the menu.
    preloadAll:true restores the old eager boot (handy for profiling a build with
    no pop-in, or for a Steam build shipping off local disk where fetches are cheap). */
 tableAssets:{
  preloadAll:false,   // true = fetch every table's active skin + every room at boot (old behaviour)
  cacheSkins:2,       // max skin GLBs resident (active always protected); <1 clamps to 1
  cacheRooms:1        // max room/environment GLBs resident (active always protected); <1 clamps to 1
 },

 /* ---- core physics --------------------------------------------------- */
physics:{
   ballR:1.9, rodH:7.50, playerH:-6.90, arm:6.30, prad:1.0, grav:250,
   footT:1.0,                      // arm-fraction from pivot to foot centre (1=foot, 0.85 = 15% above foot)
   footBox:{x:1.3,y:1.0,z:1.35},     // foot box half-extents: {x=along leg, y=perpendicular, z=along rod}
   footBoxOff:{x:-0.65,y:0.4},        // centre offset from foot-base in rod-local: {x=along leg, y=perpendicular}
   footBoxReach:1.0,                // multiplier on BALL_R for foot-box collision distance (lower = tighter)
   footJitter:0.15,                // random velocity perturbation fraction after foot collision (prevents perfect oscillations)
   subMin:3, subMax:7, subTravel:0.2,   // adaptive substep bounds + target travel per step
   floorRest:0.42,                        // vertical restitution off the floor
   floorRestCut:6,                        // below this upward speed the bounce dies to 0
   floorHitSnd:25,                        // |v.y| above this plays a floor tap
   floorFric:0.35, airFric:0.06,           // per-substep friction, applied as exp(-k*h) — keep as coefficients
   wallRest:0.52,                         // side + end wall restitution
   postRad:0.6, postRest:0.62,            // goal post/crossbar collision radius + restitution (metal = bouncy)
   ballRest:0.9,                          // ball-vs-ball restitution (elastic collision)
   behindDamp:0.3, behindZ:1.5,           // in-net damping and z-clamp (× goalHalf)
   bigGoalMult:1.4,                      // goal-mouth widen factor while 'big goal' is active
   bigGoalBack:1,                      // net BACK edge widens only this fraction as much as the mouth — keeps it inside the narrowing wall gap behind the goal
   redropY:32,                            // y a ball is re-dropped to if physics goes non-finite
   spinTurn:0.4, spinMax:0.3, spinDecay:.74, spinCut:0.02, // Magnus curve: turn rate, per-step clamp, decay, cutoff
},

   /* ---- rod kick + motion ---------------------------------------------- */
kick:{
   // swing-angle curve keyframes (see updateRods): time windows and peak angles
   windup:0,  windupA:0,   // pull-back window / angle
   strike:0.055,  strikeA:1.1,     // strike ramp end / peak forward angle
   hold:0.25,                     // hold peak until this time
   drop:0.32,                     // fully returned by this time
   raiseA:-1.6, raiseLerp:18, dropLerp:6, // lift-men angle + settle rates
   padAngleLerp:40,                // right-stick angle smoothing: 0 = DIRECT 1:1 (stick position = rod angle, full swing speed);
                                    //   >0 = optional exponential ease rate (1/s) if you want softer control. Keep 0 for a true
                                    //   flick-through where fast stick motion = fast rod = hard kick (angVel-driven strike power).
   userSpeed:80,                  // slide speed of the player-driven rod (u/s)
   aiOwnMult:1.,                // AI rods on the user's team slide a bit slower
   boostHitMult:2.50, freezeMult:0.1, // power-up multipliers: boost (hit impulse), freeze (speed)
   // --- how hard a contact hits (physics.js collideRod) -------------------------------------
   //   The impulse is  jm = (1 + rest) * (-vn) / ball.mass  , applied along the contact normal.
   //   vn = the closing speed of the ball RELATIVE TO THE MOVING FOOT, so a fast swing produces a
   //   big vn even against a stationary ball — which is why `rest` reads as the strike's POWER.
   //     rest 0    = dead foot. Ball's normal speed relative to the foot becomes 0: it stops against
   //                 the boot and is only carried along by it. A trap/absorb touch.
   //     rest 1    = perfectly elastic. Ball leaves at the same relative speed it arrived. A pinball.
   //     rest 0.5  = leaves at 50% of the relative approach speed, ON TOP of inheriting the foot's
   //                 motion — i.e. 1.5× the impulse of rest 0.
   //   Division by ball.mass is why a cannonball (mass 7) barely moves on the same swing as a
   //   classic (1.7). So: `rest` = the passive/absorbing touch, `restPower` = the struck shot.
   rest:0.01, restPower:0.8,
   // Which of the two is used is decided by TIMING: pow = kickT ∈ [powFrom, powTo) at the moment of
   // CONTACT. NOTE (kick-log evidence, 2026-07-22): contact almost always resolves on the FIRST swing
   // step (kickT≈0.017 at hz 60) because the AI only kicks at balls already inside the foot's reach,
   // so this window is rarely reached and `restPower` is mostly dead — see the changelog before
   // retuning. `sweetSpot` below is the POSITION-based version of the same idea and does fire.
   powFrom:0.03, powTo:0.2,
   grip:0.08,                     // fraction of the foot's own velocity lerped into the ball on any
                                    //   contact (b.v → contact-point velocity). Independent of `rest`:
                                    //   it acts even on a graze, which is how a vn≈0 brush can still
                                    //   push the ball along. High = sticky/draggy, 0 = pure bounce.
   // --- sweet spot: a clean strike landing in the narrow CENTRE of the foot (z) AND a tight
   //     forward band (dir-relative x, measured off the rod like the AI's overFoot zone) earns
   //     a POWER bonus and forces the aim-assist on — even outside the timed power window. The
   //     bonus scales with the rod's acc stat (an accurate rod gets more out of a clean hit) and
   //     a smart AI rod (its iq roll) adds a little more. It rewards good alignment for free: a
   //     low-err (accurate) rod centres the ball better, so it lands in this zone more often.
   //     on:false restores the flat, position-independent kick. ---
   sweetSpot:{
      on:true,
      zFrac:0.65,          // sweet z half-width = footBox.z × this, centred on the foot (0.3 → ±0.405u)
      xMin:1.8, xMax:3., // dir-relative x band ahead of the ROD the ball must strike within (a tight ~2u
                        //   sweet zone sitting where a clean forward drive contacts — cf. overFootOffset 2.59)
      strBase:0.3,       // hit-impulse bonus at neutral acc (stat base 5): +20%
      strAcc:0.40,        // extra hit-impulse bonus scaling to +40% at max acc (linear from base)
      iqBonus:0.15,       // extra bonus fraction when the rod's iq roll is set this frame (smart AI only)
      forceAssist:true,   // apply aimAssist on a sweet hit even when NOT in the timed power window
      shake:0.9           // screen-shake kick so a sweet strike feels punchy (juice); 0.32 was sub-pixel — bump/lower to taste
   },
   spinGain:0.01, spinClamp:2,    // side-spin from sliding into the ball
   tcSpinGain:0.5,                // 'Total Control' pad mode: side-spin added per unit of right-stick swerve
                                   //   on each ball contact (accumulates over a held contact up to spinClamp)
   sndFrom:18, hardHit:80, shakeDiv:400, // kick sound threshold / hard-hit sparks / shake scale
   splitVel:82, splitMax:3, splitAng:0.45, splitSep:3.2 // split-ball: trigger speed, max balls, spread angle, z sep
 },

 /* ---- AI behaviour --------------------------------------------------- */
ai:{
   gkPad:2,                                   // keeper stays within goalHalf + this
   reactMax:.25,                              // longest reaction latency the per-ball history ring must cover (s).
                                                // Buffer length = ceil(reactMax*sim.hz)+1 steps. Must exceed the biggest
                                                // DIFFS.reactDelay × stReact's ~1.5 slow-rea/fatigue floor (rookie .25×1.5≈.375).
   ttaMax:0.8,                                // only lead the ball's z if it arrives within this (s)
   inFrontMin:2, inFrontMax:6.3,            // ahead-window that a forward swing can reach (connects to overFoot, no dead band)
   underFootFront:6.5, underFootBack:2.9,     // ahead/BEHIND (positive magnitude) of rod where a swung rod stays forward instead of lowering — window is rel∈[-underFootBack, underFootFront], so it MUST cover rel≈0 (ball under the player). Raise underFootBack for more behind-coverage if feet still clip. (prevents own-goal swipe + lowering onto a ball at the feet)
   lowY:2,                                    // only swing when the ball is below this height
   raiseBehind:-7.8,                          // ball must be at least this far behind (real, dir-relative) to consider raising
   overFoot:2.2,                              // |Δx| under which the ball is 'at the feet' and strikeable (≈footR+ballR sweet spot)
   overFootOffset:1.4,                        // shift the overFoot zone this far forward (dir-relative) so it sits in front of the men, not straddling the rod — prevents latch releasing too early as the ball 

   // --- safe-lower side-step: a rod held forward after a kick (ball still in the
   //     drop-sweep zone, so updateRods pins it at strike angle) slides sideways until
   //     every foot is at least clearZ from the ball in z, then lowers on its own.
   //     clearZ per foot = footBox.z + BALL_R + clearMargin. Stops the hover-forever
   //     deadlock where the AI kept re-aligning ONTO the ball it was hovering over.
   //     Debug: 'Drop Sweep' layer in the AI panel shows the per-man danger boxes. ---
   repositionSpeed:20,                        // max ball speed that triggers the side-step (above this, shots pass through raised men)
   clearMargin:0.03,                           // extra z-clearance beyond footBox.z + BALL_R before lowering is safe (inFootRange / latchStuck / evade)

   // --- held-forward evade (post-kick) — its own tunable section -----------------------------------
   //     After a kick, if a SLOW ball is still in this rod's DROP-SWEEP zone, the rod stays HELD
   //     FORWARD (updateRods pins the strike angle while r.evadeHold is live) and slides the men
   //     decisively AWAY (committed direction), SUPPRESSING re-aim/re-kick, until the ball leaves the
   //     x-window / speeds up / the safety timer expires. This is the fix for the rod "following the
   //     ball while swinging": without the persistent latch it cleared z for ONE frame, dropped, and
   //     man-selection dragged it straight back onto the ball to re-kick. It never lowers while the
   //     ball is in front, so the drop can't swipe it backward (no own goal on the return).
   //     THIS SECTION OWNS THE DROP-SWEEP ZONE: updateRods' hold pin + the debug 'Drop Sweep' layer
   //     read xFront/xBack/zMargin from here, so the zone is now tuned in ONE place, decoupled from
   //     the shared underFootFront/underFootBack/clearMargin (which still feed inFootRange/latchStuck).
   //     Defaults below == the current shared values, so nothing changes until you tweak them.
   heldFwd:{
      on:true,          // false = old transient behaviour (hold forward only during the swing, no persistent evade)
      xFront:5.2,       // drop-sweep x-window AHEAD of the rod (dir-relative) — a ball within this counts as "in the zone"
      xBack:2.9,        // drop-sweep x-window BEHIND the rod (dir-relative magnitude)
      zMargin:0.01,      // z-DEPTH of the zone: footBox.z + BALL_R + this (used for BOTH detection and the escape's clear target)
      maxSpeed:50,      // only evade/slide-away for balls slower than this (faster balls just pass the men)
      vz:5,            // ball |v.z| ABOVE this → the escape commits opposite the ball's z-drift; below it,
                     //   direction comes from geometry (minimum-travel escape past the trapped foot).
                     //   MUST be > 0: at 0 (the old value) a resting ball's noise-level v.z decided the
                     //   sign every frame, so the "committed" direction was a per-frame coin flip.
      abortT:.35        // release the evade after this long (safety valve; a genuinely stuck ball then trips the dead-ball redrop)
   },
   // --- inFootRange helper: the dir-relative rectangle a foot can touch, ONE source of truth
   //     for the safe-raise / safe-lower "would we clip the ball?" questions. Forward depth =
   //     underFootFront (a dropping/kicking swing); back depth = footRangeBack (a raising swing
   //     sweeps behind); z half-width = footBox.z + BALL_R + clearMargin (a foot's z footprint,
   //     shared with the drop-sweep lowering check). ---
   footRangeBack:7.0,                         // backward x depth of a foot's reach rectangle (mirrors the trap-zone depth)

      // --- foot-trap break: drop a raised rod when a slow ball is pinned right at a foot.
   //     (NOTE: previously referenced but never defined — made the check dead code.) ---
   footTrapSlow:38.0,                         // ball speed under this is "pinned"
   footTrapZ:0.8,                            // ball within this z of any foot counts as "at the foot"

   // --- trap action (r.act='trap'): a slow ball at/behind the men is PINNED under the boot
   //     instead of being swung at — the rod eases to a shallow angle so the foot box sits at
   //     ball height, collideRod switches to a dead+sticky contact (holdRest/holdGrip) so the
   //     ball STOPS and travels with the foot, then the rod CARRIES it sideways hunting an open
   //     lane (shotEval) before scooping it away with the trapShot curve.
   //     Three phases, all driven off r.actT:
   //       0..settleT          CATCH  — kill the ball, man-selection keeps the boot on it
   //       settleT..+holdT     CARRY  — slide toward the z that opens a shooting lane
   //       lane open | holdT up  SHOOT  — kickRod(r,'trapShot')
   //     Only rods whose iq roll passed (DIFFS.iq) attempt it; everyone else keeps the raise
   //     latch. on:false restores pre-trap behaviour exactly.
   //     Debug: 'Trap Zone' layer in the AI panel (purple; hot while a rod is trapping). ---
   trap:{
      on:true,
      // GEOMETRY. angle is rod-local (×kickDir), same convention as raiseA. It must put the FOOT
      // BOX at ball height or the ball simply rolls underneath and the trap does nothing visible:
      // the box centre sits at y ≈ ROD_H − cos(a)·ARM + sin/cos(footBoxOff), which is ~1.9 (ball
      // centre) near a≈−0.25 and climbs to ~3.7 by a≈−0.9 — a foot hovering a whole ball-diameter
      // over the ball. That is why the old −0.9 never held anything: the only contact it could make
      // was a downward one that shoved the ball into the floor and squirted it forward.
      // Shallower (→0) = flatter boot, bigger pin window, less able to stop a fast ball.
      // Deeper (→−0.5) = more of a scoop lip behind the ball, but starts lifting off the floor.
      angle:-0.5,
      lerp:14,             // ease rate toward the trap angle (slower than raiseLerp — a soft catch, not a stab)
      // CATCH WINDOW (dir-relative x off the rod). Must span from behind the men through the feet:
      // a trap that releases before the ball reaches the boot is not a trap, it is a block. front
      // deliberately overlaps overFoot — the kick gate is !r.act-gated so the normal swing cannot
      // steal a ball we are holding.
      back:-5.8,
      front:1.4,
      maxVX:55,           // ball |v.x| must be under this — enough x-speed will reach the feet on its own
      maxSpeed:55,        // total ball speed cap for attempting/keeping a trap
      alignZ:1.1,         // z-alignment (nearest man) needed to commit to the trap (matches the general align tolerances)
      gkReach:10,          // GK-only: also enter the trap when the ball is within this far BEYOND
                        //   the keeper's z-slide band (early-detect a ball drifting back toward a
                        //   goal it can't yet slide onto). Outfield rods ignore this, use alignZ.
                        //   KEEP SMALL: this REPLACES the alignZ test for the keeper, so a big value
                        //   (it was 20) means the GK traps balls it isn't remotely lined up with.
      // --- CONTACT OVERRIDE while r.act==='trap' (read by collideRod, both passes). This is what
      //     makes a trap a trap rather than a soft bounce: the passive contact is normally
      //     kick.rest 0.01 / kick.grip 0.08, i.e. dead-ish but NOT sticky, so the ball parks near
      //     the boot and stays there while the rod slides out from under it. ---
      holdRest:0,         // restitution during a trap. 0 = fully absorbing, the ball's speed relative to the boot goes to zero.
      holdGrip:0.55,      // fraction of the FOOT's own velocity lerped into the ball per contact (vs kick.grip 0.08).
                        //   This is the carry: at 0.55 the ball tracks the rod's slide (r.vz) closely enough to be
                        //   dribbled sideways. →1 = welded to the boot (reads as cheating); <0.25 = the rod slides
                        //   away and leaves the ball behind, which is the old behaviour.
      // --- APPROACH WINDOW. The ball's dir-relative closing speed on the rod's front face.
      //     minApproach was 6, which required a briskly ROLLING ball — so the one case the owner
      //     actually wants (a slow/dead ball sitting in range) could never enter, and evade picked
      //     it up and slid away from it instead. Negative now: a still ball, or one drifting gently
      //     goal-ward, is exactly what should be trapped. Only a ball genuinely running away toward
      //     our own goal is refused (there is nothing to pin it against). ---
      minApproach:-2.5,
      maxApproach:26,     // …and a ball arriving faster than this cannot be pinned — block/clear it instead.
      // --- OWN-GOAL GUARD (directional). The catch tilts the foot BACKWARD (trap.angle is negative,
      //     so the boot ends up ~sin(|angle|)·ARM ≈ 3u behind the rod, on the own-goal side) and the
      //     trap contact resolves the ball along the foot→ball normal with holdRest 0 / holdGrip. When
      //     the ball is BEHIND the feet that normal points GOALWARD, so the catch shoves the ball into
      //     our own net — this is the keeper own-goal (a ball at rel −3.5, 3.5u behind the GK, i.e.
      //     between keeper and net). When the ball is IN FRONT the catch tilts AWAY from it and the
      //     normal points upfield, so it's safe even hard by our own goal. Hence two margins:
      behindSafe:-0.6,    //   a ball with relReal below this is "behind the feet" → use the big margin below.
                        //     Keep it near 0 (just inside the feet): a ball at/ahead of the boot is safe to trap.
      ownGoalGuard:4,    //   FRONT margin: block a trap only when the ball is this close to our own goal line
                        //     AND in front of the feet. Small — a ball ahead of the keeper is a fine catch.
      ownGoalBehind:16,  //   BEHIND margin: block a trap when the ball is behind the feet and within this of our
                        //     own goal. GK sits ~7.5u from its line, so at 16 the keeper NEVER traps a ball behind
                        //     it (correct — that catch can only go into the net); the DEF (~22.5u out) still can.
                        //     Lower toward the FRONT value to let the keeper trap behind again (at own-goal risk).
      settleT:0.35,       // CATCH length: hold still this long to kill the ball before starting to carry it.
      // --- CARRY phase: dribble the pinned ball sideways looking for a shooting lane. ---
      holdT:3.3,          // max carry AFTER settleT. Ball is shot when this expires whatever the lane looks like.
                        //   settleT+holdT MUST stay under abortT and under deadball.stallT (3.6) or the
                        //   dead-ball redrop whistles a ball we are deliberately holding.
      lineClear:2.0,     // shoot as soon as shotEval's best lane clears the blockers by this much (units of z).
                        //   Big = fussy, carries for the full holdT most times. 0 = shoot the instant the carry starts.
      slideMax:7.0,      // CUMULATIVE cap: furthest (z) the carry may travel from where the ball was caught —
                        //   a shuffle, not a lap of the table. NOT the per-frame aim target (see carryLead).
      carryLead:1.2,     // how far past the ball (z) the trapping man aims while dribbling. MUST stay well under
                        //   the boot's z contact reach (footBox.z + BALL_R ≈ 3.25) or the man slides off the ball
                        //   and the "carry" just abandons it between two players. Bigger = firmer push, more
                        //   chance of shedding it; ~0 = shepherd it without pushing.
      holdZ:2.8,         // CONTACT test during the carry: z-distance from the TRAPPING man to the ball above which
                        //   the trap is declared lost and released (no trapShot fired). Keep under the 3.25 reach —
                        //   past that the boot isn't touching the ball, so there is nothing being held. This is
                        //   what stops a trapShot being swung at a ball sitting between two players.
      carryMult:0.5,     // rod slide-speed multiplier while carrying. Slow enough that holdGrip can keep up
                        //   (slide faster than the boot can drag the ball and the trap just sheds it).
      abortT:3.4          // give up after this long and fall back to the raise latch (kept under deadball.stallT 3.6)
   },
   // --- trap-shot kick: a dedicated kick curve fired from the trap action, released from a
   //     ball already pinned under the boot. Gentle pull-back to get behind the ball, then a
   //     forward sweep at roughly the normal swing's ANGULAR RATE (see below) with a high peak
   //     and a power window that actually covers the contact.
   //     RATE, not duration, is the number that matters: `strike` is the END TIME of the ramp, so
   //     the forward sweep lasts (strike − windup) seconds and covers (strikeA − windupA) radians.
   //     The old 0.16/0.2 with windupA −1.0 was 2.85 rad in 0.04s = ~71 rad/s against a normal
   //     kick's ~21.8 — the foot crossed ~7u per sim step, i.e. straight through the ball, which is
   //     the same tunnelling pathology the kickA0 fix (2026-07-22) was written to remove. It also
   //     dragged the trapped ball ~3.7u BACKWARD during the windup before striking it.
   //     Now: pull back 0.25 rad over 0.10s, then 2.35 rad over 0.10s = ~23.5 rad/s. Keep that
   //     figure near the kick block's 21.8 if you retune — raise strikeA and `strike` together. ---
   trapShot:{
      on:true,
      windup:0.10,  windupA:-0.65,   // shallow pull-back — just enough to get the boot behind a ball that's already at the foot
      strike:0.20,  strikeA:1.85,   // forward sweep, high peak (2.35 rad over 0.10s ≈ 23.5 rad/s)
      hold:0.3,                     // hold peak
      drop:0.4,                     // return to neutral
      powFrom:0.10, powTo:0.22,     // power window opens WITH the strike: a pinned ball contacts almost
                                    //   immediately, so the old 0.17 start missed it and every scoop
                                    //   used the passive `rest` instead of restPower.
      restPower:0.8,                // big pop in the power window — the reward for controlling the ball
      rest:0                      // heftier passive touch outside the window
   },
   // --- dribble action (r.act='dribble') — a rod with the ball AT ITS FEET, MEN DOWN AT REST, and
   //     no way forward SLIDES the ball to a better line instead of hitting it into the row opposite.
   //     This is the fix for the two things that made play read as a pinball table:
   //       • the ball ping-ponging between two rods, because the kick gate fires at ANY ball in
   //         reach (overFoot||inFront) whether or not there is anywhere to hit it;
   //       • players hammering the end wall / the man in front of them, because the aim logic only
   //         ever chose WHERE TO AIM FROM WHERE THE BALL ALREADY IS — nothing asked "would I have a
   //         better line if the BALL were somewhere else?".
   //
   //     THIS IS NOT A TRAP, and the difference is the whole design:
   //       • NO ANGLE. The trap rotates the rod to a pin posture and holds the ball under a tilted
   //         boot. The dribble touches NOTHING in updateRods — the rod stays at the ordinary REST
   //         angle, men down. That is precisely the situation the owner described: the ball is at
   //         the feet of a lowered row, and good CONTROL should let the row slide it to a better
   //         line. A ball at a resting boot is also the one thing the trap could never hold (its
   //         pin angle sits the box too high and shoves the ball away), which is why this needed to
   //         be its own action rather than a wider trap window.
   //       • The contact is a NUDGE, not a pin: holdGrip 0.30 against the trap's 0.55 (and the
   //         passive touch's ~0.08). The ball is dragged along by the boot with visible slip — it
   //         is being dribbled, not carried welded to the foot.
   //       • It ends with an ORDINARY kick or a pass, not a scoop. The ball is already sitting in
   //         the normal strike zone with the men down, so the normal swing is exactly right.
   //     Debug: 'Dribble' layer in the AI panel (violet) — trigger band, carry target, pass line.
   //     on:false restores the old behaviour exactly. ---
   dribble:{
      on:true,
      roles:['ATT','MID','DEF'],  // DEF included deliberately: a defender's job here is to work the
                        //   ball past the opposing ATTACK row rather than belt it into them (see
                        //   outletClr in ai.js — for a non-attacker the score IS "can I get past the
                        //   row in front"). ownGoalGuard below is what keeps that honest. NOT 'GK'.
      iqGate:true,        // only rods whose iq roll passed this beat try it (DIFFS.iq × the iq stat).
                        //   false = every eligible rod dribbles, which reads as uniformly clever.
      // CONTROL WINDOW (dir-relative x off the rod). These are NOT free numbers — outside them the
      // boot cannot touch the ball at all, and the rod would slide about next to a ball it isn't
      // moving until abortT. Derivation AT THE REST ANGLE (a=0), which is the posture this action
      // uses — contrast trap.back/front, which are derived at its −0.5 pin:
      //   foot base   fy = ROD_H − ARM = 1.20,  fx = 0 off the rod
      //   box centre  bcx = fx + offy·cos(a) = +0.40 (dir-relative),  bcy = 1.20 + 0.65 = 1.85
      //               …i.e. dead level with a ball centre at BALL_R 1.9. A resting boot is already
      //               at ball height; that is why no pin angle is needed or wanted.
      //   world x half-reach = |footBox.x·sin(a)| + |footBox.y·cos(a)| + BALL_R·footBoxReach = 2.90
      // …so contact is possible for rel ∈ −2.50 .. +3.30. Stay inside it.
      back:-2.2,
      front:3.5,          // this window is very nearly overFoot (−0.8..3.6) on purpose: these are
                        //   exactly the balls the rod would otherwise have hit straight forward.
      alignZ:2.2,        // z-distance (nearest man) within which the ball counts as CONTROLLABLE.
                        //   Looser than the strike tolerances (alignSlow 1.2) because pushing a ball
                        //   sideways needs less precision than striking it — but keep it under the
                        //   boot's z reach (footBox.z + BALL_R ≈ 3.25). The RELEASE still waits for
                        //   the normal `aligned` test, so a sloppy contact can't produce a shot.
      maxSpeed:48,        // ball must be slower than this to be brought under control at all
      minApproach:-8,     // dir-relative closing-speed window. A ball running AWAY faster than
      maxApproach:22,     //   |minApproach| is gone; one arriving faster than maxApproach won't settle.
      ownGoalGuard:14,    // never start (or keep) a dribble within this x-distance of our OWN goal line.
                        //   Sized so the DEF row (~22.5 out) CAN work the ball, but nothing dribbles
                        //   in the six-yard box. Raise it if defenders lose the ball somewhere fatal.
      // CONTACT OVERRIDE while r.act==='dribble' (read by collideRod, both passes, via holdCfg).
      // Same mechanism as trap.holdRest/holdGrip, deliberately much lighter — see the note above.
      holdRest:0,         // absorbing, so the ball doesn't rebound off the boot as we work it
      holdGrip:0.50,      // fraction of the FOOT's velocity lerped into the ball per contact. 0.55 (the
                        //   trap) reads as welded; ~0.08 (a passive touch) means the rod slides out
                        //   from under it. 0.30 drags it along with visible slip = a dribble.
      holdZ:2.9,          // z-distance from the dribbling man above which contact is LOST and the action
                        //   released (just under the boot's real z reach, ≈3.25)
      carryLead:1.2,      // how far past the ball (z) the man aims each frame while pushing it. Must stay
                        //   well under that z reach or the man simply walks off the ball.
      carryMult:0.8,      // rod slide-speed multiplier while dribbling. Higher than the trap's 0.5 — this
                        //   is a player moving the ball to a better line, not shepherding it.
      slideMax:16,        // CUMULATIVE z travel cap from where control was taken. The man's own maxOff
                        //   caps it harder on a 5-man rod (±6.2) than on a 3-man ATT (±11.5).
      // TARGET SCORING (see dribTarget in ai.js). score = outletClr + centrePull·(how much closer to
      // centre) − travelCost·(distance to get there), where outletClr is "how good is my way forward
      // if the ball were here" — the goal-mouth lanes for an ATT, and for everyone else the z-gap past
      // the opposing row directly in front.
      samples:5,          // candidate ball-z positions scanned across the man's reachable range
      range:16,           // …spanning at most this far either side of the ball
      centrePull:0.65,    // weight on getting central. THIS is the winger fix — raise it and wide players
                        //   cut inside harder; 0 = pure gap-hunting (they'll shuffle in place out wide).
      travelCost:0.10,    // penalty per unit travelled — stops a marginal gain triggering a long walk
      minGain:1.5,        // don't enter at all unless the best target is at least this far from the ball.
                        //   Below it there's nothing to gain and the rod should just play it.
      retargetDead:1.5,   // re-evaluated target must move more than this to be adopted (anti-dither)
      reEval:0.25,        // seconds between target re-evaluations (also gates the entry scan — the cost
                        //   control on the sampled scan, which is the expensive part)
      // RELEASE. Whichever fires first: the way forward opens, we arrive, we're closed down, time's up.
      coveredClr:1.6,     // entry gate: only dribble when the CURRENT outletClr is below this, i.e. there
                        //   genuinely isn't a way forward. Bigger = dribbles even from decent positions.
      wideZ:14,           // …or when the ball is at least this far off centre in z, whatever the gaps say.
                        //   The wall-blasting winger: the lane can read 'open' and still be a bad angle.
      lineClear:2.4,      // release and PLAY IT as soon as outletClr from the ball's live position clears
                        //   by this much. Should sit above coveredClr or entry and exit fight.
      arrive:1.2,         // …or once the ball is within this of the committed target z
      holdT:2.2,          // …or after this long dribbling (must stay under deadball.stallT 3.6)
      pressX:13,          // CLOSED DOWN: an opposing man within this x AND pressZ z of the ball forces an
      pressZ:3.2,         //   immediate release — don't keep working it while the row in front lines up
                        //   on us. MIND THE SCALE: rods are 15 apart and this window keeps the ball
                        //   within ~3 of our OWN rod, so the ball is never closer than ~12 to an
                        //   opposing rod. Anything under ~12 here makes the test permanently FALSE
                        //   (that's what 9 did); 13 means "the ball has been worked to the front of
                        //   my window and a man over there is squared up on it".
      abortT:2.8,         // hard safety valve on the whole action (also under stallT)
      cd:1.2,             // re-entry lockout after any dribble ends — stops dribble/kick trading the rod
      noPoke:true,        // ALSO suppress the full-stretch inFront poke for a dribbling role with no way
                        //   forward, so the ball is allowed to arrive at the feet where this action can
                        //   take it. This is the direct fix for the back-and-forth ping-pong; false =
                        //   old behaviour (hit anything in reach, dribble only what survives that).
      // --- PASS. Instead of shooting a covered shot, give it to a teammate rod ahead who has a
      //     better one. Scored per live man of each rod ahead: the lane from the ball TO him
      //     (clear — can the pass even get there) plus the shot he'd have on receiving it
      //     (onward), minus distance. Executed as a soft `passShot` kick with aim-assist bent at
      //     the receiver instead of the goal (see aimAssist in stats.js). ---
      pass:{
         on:true,
         roles:['DEF','MID','ATT'],  // who may pass. WIDER than the dribble roles on purpose — a defender
                              //   passing forward instead of hoofing it into the row opposite is
                              //   exactly what we want; it's only CARRYING the ball it shouldn't do.
         minAhead:10,         // receiver must be at least this far ahead in x (rods are 15 apart, so this
                              //   means the next row up, never a square ball across our own line)
         maxAhead:34,         // …and at most this far (beyond ~2 rows it's a hopeful punt, not a pass)
         minClear:1.8,        // the lane to him must clear the opposing men by this much or it's not on
         wClear:1.0,          // scoring weights: can the pass GET there…
         wOnward:0.9,         //   …vs how good HIS shot would be once it arrives
         wDist:0.05,          //   …minus a mild preference for the nearer option
         bias:0.9,            // a pass must beat the current shot's clearance by this margin to be chosen.
                              //   Raise it to make the AI shoot-first, drop toward 0 for a passing side.
         shotBias:1.0,        // multiplier on the shot's clearance in that comparison (>1 = shoot-happy)
         onKick:true,         // ALSO redirect a NORMAL kick into a pass when the shot is covered — so
                              //   build-up play happens even when no dribble was needed/possible.
         onKickClr:1.2,       // …only when the best lane clears by less than this (a covered shot)
         every:0.2,           // seconds between pass evaluations per rod (cached on r.passEv; the scan is
                              //   the priciest thing in the AI, so don't run it per step)
         assist:0.16,         // aim-assist bend (rad) toward the receiver. Bigger than the shot assist
                              //   (assistMax .10): a pass is a deliberate, aimed action.
         assistCone:1.1,      // …applied only if the ball is already leaving within this angle of him
         assistMinVX:5        // …and moving forward at least this fast (a pass is slower than a shot, so
                              //   the shot gate of 20 would skip it entirely)
      }
   },
   // --- pass kick: a deliberately SOFT release used by the dribble/pass decision. Same curve shape
   //     as trapShot but roughly half the angular rate, because a pass only has to travel ~15 units
   //     to the next row — a full-power strike arrives faster than the receiving rod can react and
   //     just rebounds off it, which is the problem passing exists to solve. RATE is again the number
   //     that matters: 1.2 rad over 0.12s ≈ 10 rad/s against a normal swing's ~21.8. ---
   passShot:{
      on:true,
      windup:0.08,  windupA:-0.35,  // token pull-back — the ball is already at the boot
      strike:0.20,  strikeA:0.85,   // gentle forward sweep (1.2 rad over 0.12s ≈ 10 rad/s)
      hold:0.28,                    // hold peak
      drop:0.42,                    // return to neutral
      powFrom:0.08, powTo:0.20,     // window covers the contact (a pinned ball contacts immediately)
      restPower:0.35,               // modest pop — weight of pass, not a shot
      rest:0
   },
   // --- safe-raise action (r.act='safeRaise') — DECOUPLED from the trap action, its OWN
   //     thresholds. A slow, sideways ball loiters in this x-band behind the rod but isn't far
   //     enough back to trip the raiseBehind latch, so the rod would otherwise sit DOWN behind
   //     it. If raising won't clip the ball (it's NOT inFootRange — sits in a z-gap between feet)
   //     the rod eases to `angle` (a defined lift) while man-selection slides a man in behind it;
   //     when the ball rolls forward to the rod line, speeds up, or lifts, the action exits and
   //     the normal drop+kick clears it. Safety gate = inFootRange + this band + |v.x|.
   //     Debug: 'Safe Raise' layer in the AI panel (lime; hot while a rod is safe-raising). ---
   safeRaise:{
      on:true,
      angle:-0.8,        // defined lift angle the rod eases to (rod-local, ×kickDir; full raiseA is -1.6)
      lerp:4,             // ease rate toward the angle (a brisk, clean lift)
      back:-5.8,          // dir-relative x band behind the rod where a loitering ball triggers a safe-raise…
      front:0.45,        // …up to just behind the rod line (past this the normal kick path owns it)
      maxVX:10,            // ball |v.x| must be under this (sideways/loitering — enough x-speed reaches the feet on its own)
      maxSpeed:65,        // total ball speed cap for entering/holding a safe-raise
      abortT:3.0          // give up after this long and fall back to the normal path (kept under deadball.stallT 3.6)
   },
   // --- evade action (r.act='evade'): a slow ball is stuck directly BEHIND a man (inFootRange)
   //     and we're not trapping or lifting it — rather than shadow it in z (walling it in place)
   //     the rod slides the men AWAY (opposite the ball's z-drift, or opposite the side it sits
   //     on when still) until the ball is no longer inFootRange, un-sticking it so play can
   //     progress. Only fires when the ball ISN'T strikeable (not overFoot/inFront) and is slow.
   //     Debug: 'Evade' layer in the AI panel (teal; hot while a rod is evading). ---
   evade:{
      on:true,
      vz:5,             // |ball v.z| ABOVE this = "has real z-momentum" → step opposite it (don't slide into
                      //   where it's going). BELOW it the direction is geometric: the minimum-travel escape
                      //   for the foot the ball is actually stuck against (see evadeDir in ai.js). Raise this
                      //   to trust geometry more, lower it to trust the ball's drift more; never set it to 0
                      //   (noise-level v.z on a resting ball would pick the sign).
      maxSpeed:35,        // only evade balls slower than this (faster balls clear the men on their own)
      maxApproach:4,      // ball must NOT be closing on the rod faster than this (dir-relative v.x) to evade.
                        //   Evade is for a ball PARKED against a foot; a ball rolling in from behind is
                        //   about to be strikeable, and sliding away from it both wastes the block and
                        //   drags the man off the strike line mid-swing (the whiffs in the kick log).
                        //   Mirror of trap.minApproach: trap wants a closing ball, evade wants a still one.
                        //   0 = never evade a ball with any forward drift; big = old (ignore approach).
      abortT:3.0,         // give up after this long (kept under deadball.stallT 3.6; a truly boxed dead ball gets redropped anyway)
      raiseAfter:true,    // on a SUCCESSFUL clear (not a bail), latch the raise: the lift swings the foot
                        //   BEHIND the ball in x, so the following drop sweeps FORWARD through it and
                        //   knocks it upfield. false = old behaviour (exit straight back to man-selection,
                        //   which just re-aims onto the ball — the "evade one frame then chase" loop).
      cd:0.8,             // after ANY evade ends, block re-entry for this long. Stops evade and
                        //   man-selection/safeRaise fighting each other every 1-3 sim steps.
      behindDead:1.6      // min dir-relative x distance the ball must be BEHIND the rod for evade to fire.
                        //   Evade only slides in Z — it never rotates the rod — so it CANNOT knock the ball
                        //   backward; the thing that must not be stolen is a strikeable ball, and the
                        //   !overFoot/!inFront gates already cover that (overFoot starts at −0.8, so this
                        //   leaves a 0.8u buffer). Was 3.1, which left a passive band at rel −3.1..−0.8
                        //   where a stuck ball got NO action and the rod just shadowed it to the redrop.
   },
   // --- lane-clear action (r.act='lane'): a TEAMMATE rod BEHIND us (nearer our own goal) has the
   //     ball and is about to hit it forward — straight through our row. Standing in that lane is
   //     a block on our OWN clearance, and it happens constantly between a keeper and its defence:
   //     the ball sits in the 15u gap, the defence slides onto its z (man-selection tracks the ball
   //     wherever it is) and then either lowers into the strike, or parks a half-lifted boot in the
   //     kick path via safeRaise — whose band, rel −5.8..0.45, IS that gap. So this action runs
   //     first and outranks safeRaise / trap / evade: all three want to play a ball that isn't ours
   //     to play. Two moves, in order:
   //       • SLIDE the men off the ball's z-lane (minimum-travel escape via clearOffset, direction
   //         committed once so a shuffling ball can't make the row dither).
   //       • LIFT once nothing is in back-swing reach — the clearance then passes UNDER the feet.
   //         While the ball IS in reach a lift would sweep the foot backward through it into our
   //         own goal, so the slide has to clear z first; it un-gates the lift on its own.
   //     Handover is the whole design — it never holds a ball we could be playing: entry needs the
   //     ball BEHIND us past `behind`, and it releases at `release`, which sits a lead ahead of the
   //     overFoot zone (−0.8) so the men are back DOWN by the time a ball rolling in from behind
   //     becomes ours to strike. A ball already STRUCK (closing faster than throughV)
   //     instead holds the lane open until it is `passed` clear of us, so we can't drop onto our
   //     own pass as it arrives.
   //     SCOPE — deliberately narrow (see `roles` and `zPad`): only a DEFENCE makes way, and only
   //     for a ball inside the keeper's own z-slide band. A ball out by a corner or pinned against
   //     a side wall isn't a clearance the keeper can make, so the row plays it as normal.
   //     on:false = old behaviour exactly. ---
   clearLane:{
      on:true,
      roles:['DEF'],      // ONLY these rows ever make way. The case this exists for is the defence smothering
                        //   its own keeper; a MID/ATT stepping aside mid-pitch just opens the field up for
                        //   the opposition. Add 'MID' to extend it up the pitch.
      zPad:0,             // the ball must also be inside the HANDLER's z-slide band (for a DEF that handler is
                        //   always the keeper, since the GK is the only rod behind it), widened by this. Out
                        //   near a corner or hard against a side wall the keeper can't slide onto the ball
                        //   anyway, so there is no clearance to make way for — the row plays it as normal.
                        //   Raise to make way for balls just outside the keeper's reach; 0 = exactly its band.
      behind:-6.0,        // ball must be at least this far BEHIND us (dir-rel x) to enter. Inside this it is
                        //   near enough to our own feet to be ours — never clear the lane for it.
      nearBall:16,        // …and no further behind than this: only the row IMMEDIATELY in front of the
                        //   handler makes way. Rods are 15 apart, so >16 would lift the whole team for a
                        //   keeper's clearance and hand the midfield away.
      mateBack:6.0,       // the handling mate must sit at least this far behind us in x (just excludes a
                        //   rod level with us; real spacing is 15).
      mateReach:14.0,     // …and within this x-distance of the ball, i.e. it can actually get to it.
      laneMargin:1.0,     // extra z clearance beyond footBox.z + BALL_R when stepping out of the lane.
                        //   Bigger = a wider corridor left open (and a bigger slide off our own spot).
      lift:true,          // also LIFT the men (full raiseA) once nothing is in back-swing reach. false =
                        //   slide out of the z-lane only, men stay down.
      throughV:12,        // ball closing on us from behind faster than this = it has been struck; hold the
                        //   lane open until it has PASSED rather than releasing when the mate lets go.
      release:-5.8,       // hand back to the normal path once the ball reaches this (dir-rel x). Sits 1.5u
                        //   ahead of `behind` so entry/exit can't ping-pong, and early enough that the men
                        //   are down again by the time a slow ball rolls into the overFoot zone (−0.8).
      passed:1.0,         // …but a struck ball (see throughV) holds the lane open until it is this far past
                        //   us — dropping in front of our own clearance is the bug this action exists for.
      abortT:3.4,         // safety valve: never sit out of the lane longer than this (kept under the
                        //   dead-ball stallT 3.6 so a genuinely stuck ball gets whistled instead).
      cd:0.35             // re-entry lockout after the action ends — stops lane and man-selection trading
                        //   the rod back and forth every few sim steps (cf. evade.cd).
   },
   // --- decision thresholds: a smart rod (iq roll) with the ball approaching in the
   //     inFront window WAITS for it to reach the overFoot sweet spot instead of
   //     poking at full stretch — meatier, better-aimed strike. ---
   waitTta:2.,        // waiting is only allowed if the ball reaches the rod within this (s)
   waitMinVX:3,         // …and is approaching at least this fast in x (else kick now)
  
   // --- goal targeting: aim strikes at the opponent goal mouth (accuracy = DIFFS.aim) -------
   aimGain:20,                                // converts desired lateral (vz/vx) into a z aim-offset — bigger = stronger steering toward goal
   aimMax:1.2,                                // clamp on that offset (u): the man must still contact the ball or the shot whiffs in z
   aimGoalZ:0.85,                              // aim within ±this fraction of goalHalf (stay off the posts)
   aimSpread:1.3,                             // low-accuracy spray: aimed spot wanders ±(1-aim)*goalHalf*this across the mouth
   // --- gap-aware aiming: smart, accurate rods read the opposing men (keeper + any defender
   //     between ball and goal) and steer at the WIDEST OPEN lane in the mouth instead of
   //     blindly at centre; aimAssist bends the strike toward that gap too. A covered shot is
   //     HELD (possession kept) for a beat in the hope a lane opens (ATT/MID only, iq-gated).
   //     Debug: 'Shot Lanes' layer draws every sampled lane green(open)/red(blocked) + target. ---
   gapAim:{
      gap:true,           // master toggle (false = old centre + accuracy-spray only)
      samples:5,         // lanes sampled across the mouth to find the widest gap
      blockR:2.6,         // z half-width an opposing man blocks a lane (≈ prad + ballR)
      minAhead:2,         // an opposing rod must be at least this far (x) ahead of the ball to block
      minAcc:0.25,        // only rods with at least this aim accuracy bother gap-aiming
      sprayMix:0.2,       // fraction of the normal inaccuracy spray still added onto the gap target
      openMargin:0.8,     // lane clearance ≥ this = a 'good' (open) shot; below = covered
      holdMax:2.5         // a smart ATT/MID holds a covered shot at most this long, then fires anyway
   },
   // --- defensive positioning: GK + DEF get on the LINE from the ball to their OWN goal centre
   //     instead of just tracking the ball's z. Because each defensive rod sits at a different x,
   //     they intercept that line at different depths — the DEF out near the ball, the keeper back
   //     at centre — so the two of them funnel the straight shot as a triangle instead of stacking
   //     on the ball and leaving the middle open (the old ball-chasing keeper). Only engages while
   //     the ball is still OUT in front (a real shot threat); once it arrives in kicking range the
   //     normal drop/clear path takes over. Smart rods (iq roll) commit fully to the line; low-iq
   //     rods only lean toward it (dumbBias) and still leak gaps — so keeper/defence quality scales
   //     with the intelligence stat. on:false restores the old ball-tracking exactly. ---
   defend:{
      on:true,
      engage:5.5,         // line-block only while the ball is at least this far in FRONT (dir-rel x); inside
                        //   this the ball is in kicking range and the drop/clear path owns it
      lineBias:1,       // 1 = sit exactly on the ball→own-goal-centre line; 0 = track ball z (old behaviour)
      dumbBias:0.45       // a low-iq rod commits only this fraction toward the line (leaves gaps → skill spread)
   },
   alignSlow:1.2, alignFast:1.25,             // z-alignment tolerance — kept just INSIDE the foot's true z-reach
                                                //   (footBox.z 1.35 + BALL_R×footBoxReach ≈ 1.49) so a swing only
                                                //   fires when a man can actually connect. Looser values let the rod
                                                //   kick at a ball off to the side, whiff, and (on a slow ball with a
                                                //   short cd) hammer it again — the side-miss-repeat bug.
   wallReach:2.6, wallSlack:0.7,              // wall-hug rescue. A ball jammed against a side wall sits BEYOND the
                                                //   outermost man's centrable z-range (that man is pinned at ±maxOff),
                                                //   so dz can never fall under alignSlow even though the leg/capsule
                                                //   (radius BALL_R+PRAD≈2.6) is still touching it — the rod stands there
                                                //   beside the ball into a dead-ball. When the nearest man is within
                                                //   wallSlack of its slide limit TOWARD such a ball and the ball is
                                                //   within wallReach in z (capsule reach), count it aligned so the rod
                                                //   swings and knocks it loose. Guarded to genuine wall-hugs + a maxed
                                                //   man, so normal mid-field aiming is untouched.
   slowSpeed:35,                              // ball speed under this counts as a dead-ball (be eager)
   cdSlow:[1,2.5], cdFast:[0.5,1.5],       // cooldown random range (× DIFFS.cd). Slow-ball cd raised so a missed
                                                //   swing at a dead ball can't re-fire twice a second.
   errEvery:[1.7,4.],                        // how often a fresh wandering aim-error target is rolled (s)
   
   // --- two-hands + anti-jitter -----------------------------------------
   hands:3,                                   // rods per team the AI may actively move at once (like a pair of human hands).
                                              //   NOT a cap on human seats — pickActiveRods raises the cap to the seat
                                              //   count when a team has more seats than this, so every held rod is live.
   pairCommit:0.3,                            // min seconds a rod stays in the active pair before it can be swapped
   manHyst:2,                               // a different man must beat the current one by this many z-units to steal aim
   retargetDead:0.1,                          // desired slide must differ from current target by this (z) before we re-aim
   errLerp:7.0,                               // rate the wandering aim error drifts toward its new target (per s)
   slideAccel:600                             // AI rod slide acceleration cap (u/s²) — kills instant direction flips
 },

  /* ---- 3D player models ----------------------------------------------- */
 playerModel:{
  default:'cyborg',
  // Figurine registry. Add an entry + drop its .glb in assets/ and it shows
  // up in the Customize panel automatically. `teamParts` = material names that
  // get team-coloured; `scale` = uniform scale in table units.
  //
  // `mug` = the character-select portrait (see mugImg() in core.js + .czCard in customize.js).
  // These are PREDECLARED for the whole roster even though only some are rendered so far —
  // drop the PNG at the listed path and the card picks it up on next load with no code or
  // config change. A missing file is not an error: the <img> onerror leaves the neutral
  // ICO.figure mark showing underneath, so an un-rendered figurine degrades cleanly. The
  // filename stem follows the existing assets/renders/render_<stem>_cycles.png convention,
  // which does NOT always match the model id (womanAndroid → jennyBot, manrichie → richie).
  models:[
   // ROBOTS
   {id:'cyborg',name:'Cyborg',blurb:'Chrome-plated all-rounder',
      src:'assets/fuzeball_cyborg.glb',scale:0.8,
      mug:'assets/renders/render_cyborg_mugshot.png',
      teamParts:['kit_cyborg', 'kit_cyborg_visor'],
      hairParts:['kit_cyborg_hair'],
      explosionSrc:'assets/animations/cyborg_explosion.glb'
   },
   {id:'deltaborg',name:'Deltaborg',blurb:'Ruthless and fast',
      src:'assets/fuzeball_deltaborg.glb',scale:0.8,
      mug:'assets/renders/render_deltaborg_mugshot.png',
      teamParts:['kit_deltaborg'],hairParts:[],
      explosionSrc:'assets/animations/deltaborg_explosion.glb'
   },
   {id:'irnman',name:'Irnman',blurb:'Strong and relentless',
      src:'assets/fuzeball_irnman.glb',scale:0.8,
      mug:'assets/renders/render_irnman_mugshot.png',
      teamParts:['kit_irnman','kit_irnman_centre'],hairParts:[],
      explosionSrc:'assets/animations/irnman_explosion.glb'
   },
   {id:'mechaMan',name:'Mecha Man',blurb:'Logical and methodical',
      src:'assets/fuzeball_mechaman.glb',scale:0.8,
      mug:'assets/renders/render_mechaman_mugshot.png',   
      teamParts:['kit_mechaman_new'],hairParts:[],
      explosionSrc:'assets/animations/mechaman_explosion.glb'
   },
   {id:'stormer',name:'Stormer',blurb:'Cold and endless',
      src:'assets/fuzeball_stormer.glb',scale:0.8,
      mug:'assets/renders/render_stormer_mugshot.png',   
      teamParts:['kit_stormer'],hairParts:[],
      explosionSrc:'assets/animations/stormer_explosion.glb'
   },

   // THINGS
   {id:'rocko',name:'Rocko',blurb:'Solid and unpredictable',
      src:'assets/fuzeball_rocko.glb',scale:0.8,
      mug:'assets/renders/render_rocko_mugshot.png',   
      teamParts:['kit_rocko', 'kit_rocko_badge' ],hairParts:[],
      explosionSrc:'assets/animations/rocko_explosion.glb'
   },

   // MEN
   {id:'manJerry',name:'Jerry',blurb:'Confident and cocky',
      src:'assets/fuzeball_manJerry.glb',scale:0.8,
      mug:'assets/renders/render_jerry_mugshot.png',   
      teamParts:['kit_manJerry'],hairParts:['kit_manJerry_hair'],
      explosionSrc:'assets/animations/jerry_explosion.glb'
   },
   {id:'manrichie',name:'Richie',blurb:'Ambitious and skilled',
      src:'assets/fuzeball_manRichie.glb',scale:0.8,
      mug:'assets/renders/render_richie_mugshot.png',   
      teamParts:['kit_richie'],hairParts:['kit_richie_hair'],
      explosionSrc:'assets/animations/richie_explosion.glb'
   },
  
   // WOMEN
   {id:'womanMaria',name:'Maria',blurb:'Determined and strong',
      src:'assets/fuzeball_womanMaria.glb',scale:0.8,
      mug:'assets/renders/render_maria_mugshot.png',   
      teamParts:['kit_maria2'],hairParts:['kit_maria2_hair'],
      explosionSrc:'assets/animations/maria_explosion.glb'
   },
   {id:'womanKimi',name:'Kimi',blurb:'Fierce and funny',
      src:'assets/fuzeball_womanKimi.glb',scale:0.8,
      mug:'assets/renders/render_kimi_mugshot.png',   
      teamParts:['kit_kimi'],hairParts:[ 'kit_kimi_hair' ],
      explosionSrc:'assets/animations/kimi_explosion.glb'   
      },
   {id:'womanTalia',name:'Talia',blurb:'Witty and wise',
      src:'assets/fuzeball_womanTalia.glb',scale:0.8,
      mug:'assets/renders/render_talia_mugshot.png',   
      teamParts:['kit_talia'],hairParts:[ 'kit_talia_hair' ],
      explosionSrc:'assets/animations/talia_explosion.glb'   
      },
   {id:'womanTanya',name:'Tanya',blurb:'Strong and fast',
      src:'assets/fuzeball_womanTanya.glb',scale:0.8,
      mug:'assets/renders/render_tanya_mugshot.png',   
      teamParts:['kit_tanya'],hairParts:[ 'kit_tanya_hair' ],
      explosionSrc:'assets/animations/tanya_explosion.glb'   
      },      
   /*{id:'womanSasha',name:'Sasha',blurb:'Cunning and quick',
      src:'assets/fuzeball_womanSasha.glb',scale:0.8,
      mug:'assets/renders/render_sasha_mugshot.png',   
      teamParts:['kit_sasha'],hairParts:['kit_sasha_hair'],
      explosionSrc:'assets/animations/sasha_explosion.glb'
    },*/
    /*{id:'womanAndroid',name:'JennyBot',blurb:'Quick and calculating',
    src:'assets/fuzeball_womanAndroid.glb',scale:0.8,
    mug:'assets/renders/render_jennyBot_mugshot.png',
    teamParts:['woman_android'],hairParts:['woman_android_hair'],
    explosionSrc:'assets/animations/jennybot_explosion.glb'
    },*/
    // ALIENS
    {id:'womanZaneesh',name:'Zaneesh',blurb:'Logical and brilliant',
       src:'assets/fuzeball_womanZaneesh.glb',scale:0.8,
       mug:'assets/renders/render_zaneesh_mugshot.png',   
       teamParts:['kit_zaneesh'],hairParts:[],
       explosionSrc:'assets/animations/zaneesh_explosion.glb'
     }, 
   {id:'alienTamirok',name:'Tamirok',blurb:'Intense and thoughtful',
      src:'assets/fuzeball_alienTamirok.glb',scale:0.8,
      mug:'assets/renders/render_tamirok_mugshot.png',   
      teamParts:['kit_tamirok'],hairParts:[],
      explosionSrc:'assets/animations/tamirok_explosion.glb'
      },
   {id:'alienGrimlot',name:'Grimlot',blurb:'Wild and unpredictable',
      src:'assets/fuzeball_alienGrimlot.glb',scale:0.8,
      mug:'assets/renders/render_grimlot_mugshot.png',   
      teamParts:['kit_Grimlot'],hairParts:[],
      explosionSrc:'assets/animations/grimlot_explosion.glb'
      },
   {id:'alienKatum',name:'Katum',blurb:'Fierce and aggressive',
      src:'assets/fuzeball_alienKatum.glb',scale:0.8,
      mug:'assets/renders/render_katum_mugshot.png',   
      teamParts:['kit_Katum'],hairParts:[],
      explosionSrc:'assets/animations/katum_explosion.glb'
      },
   {id:'alienKodus',name:'Kodus',blurb:'Cunning and clever',
      src:'assets/fuzeball_alienKodus.glb',scale:0.8,
      mug:'assets/renders/render_kodus_mugshot.png',   
      teamParts:['kit_Kodus', 'kit_kodus_centre'],hairParts:[],
      explosionSrc:'assets/animations/kodus_explosion.glb'
      },
   {id:'alienZargon',name:'Zargon',blurb:'Mysterious and powerful',
      src:'assets/fuzeball_alienZargon.glb',scale:0.8,
      mug:'assets/renders/render_zargon_mugshot.png',   
      teamParts:['kit_Zargon', 'kit_zargon_centre'],hairParts:[],
      explosionSrc:'assets/animations/zargon_explosion.glb'
      },
  ],
  // Surface finishes offered as one-tap presets (metalness / roughness / glow).
  // `default` is special: authored=true means "use the material values exported with the
  // model" — applyTeamFinish restores the snapshot taken when the GLB material was cloned.
  finishes:{
   default: {authored:true},
   matte:   {metalness:.05,roughness:.90,glow:0},
   satin:   {metalness:.15,roughness:.45,glow:0},
   plastic: {metalness:.0,roughness:.18,glow:0},
   metallic:{metalness:.75,roughness:.28,glow:.0},
   chrome:  {metalness:1.0,roughness:.06,glow:.05},
   neon:    {metalness:.25,roughness:.35,glow:0.10}
  },
  // Quick-pick kit colour swatches for the panel.
  swatches:['#ff0011','#ff8c3a','#fff94d','#00fa19','#2af5ff','#3d8bff','#5900ff','#ff2bd6','#f2ede2','#757983'],
  // Natural hair colours for random tinting.
  hairSwatches:['#1a1a1a','#2d1b0e','#3d2b1f','#5c4033','#8b6b47','#c9b896','#e8d4b9','#f5f1c8','#c49a6c','#8b5a2b','#6b3f1a','#4a2c1a','#b8860b','#daa520','#cd853f'],
  // Max figurine GLB templates kept resident per cache (LRU). Browsing/customizing loads a
  // template per figurine; without a cap they all stay in RAM forever. The 2 on the table
  // are always protected from eviction. Raise if you see reload hitches when re-picking.
  cacheMax:6
 },

 /* ---- rod layout ----------------------------------------------------- */
 rods:{
  spacing:{ two:24, three:18.5, other:11.9 }, // per-man spacing by man-count
  margin:8.0,       // total z margin subtracted when deriving slide range
  gkSlide:6,     // goalie slide cap — keeper stays in its goal area (real tables restrict this), keeps its rod short
  wallClear:2.5,  // stick-out kept past the outer side wall at full inward slide (fixes handle-through-wall)
  handleLen:5,    // handle grip length (sits just outside the wall)
  collarLen:2.4,  // far-end collar/stopper width (the bumper opposite the handle)
  capOut:3,       // constant amount the bar tip pokes past the collar
   // 1-2-5-3 per side. x = position along long axis; team 0 = red (attacks +x).
   // Optional `slideCap` overrides the computed max slide range for this row.
   defs:[
    {x:-52.5,team:0,men:1,role:'GK',slideCap:15},
    {x:-37.5,team:0,men:2,role:'DEF'},
    {x:-22.5,team:1,men:3,role:'ATT'},
    {x:-7.5, team:0,men:5,role:'MID'},
    {x: 7.5, team:1,men:5,role:'MID'},
    {x: 22.5,team:0,men:3,role:'ATT'},
    {x: 37.5,team:1,men:2,role:'DEF'},
    {x: 52.5,team:1,men:1,role:'GK',slideCap:13}]
 },

 /* ---- difficulty ----------------------------------------------------- */
 diffs:{
  // iq = decision intelligence 0..1: probability a rod makes the 'smart' choice when one
  // exists (trap a slow ball instead of full-raising over it; wait for the overFoot sweet
  // spot instead of a stretchy inFront poke). Rolled per rod on the errEvery cadence, so a
  // rookie occasionally plays clever and a legend occasionally plays greedy.
  // react     = time-constant of the low-pass filter on the ball's PERCEIVED position (hand wobble).
  // reactDelay = genuine reaction LATENCY (s): the rod acts on the ball's state as it was this
  //   long ago, not live (see ai.js ballRecord/aiView). This is the dominant human-reaction term —
  //   fast balls can now beat the AI to the punch instead of it responding frame-perfectly. Scaled
  //   per rod by the rea stat via stReact (higher rea → shorter delay; fatigue lengthens it). Keep
  //   the largest possible value (rookie × stReact's ~1.5 floor) under CONFIG.ai.reactMax.
  rookie:{speed:30,react:.23,err:0.95,range:5.0,pred:.35,cd:1.05,aim:.5,iq:.35,reactDelay:.1},
  pro:   {speed:35,react:.18,err:0.8,range:5.8,pred:.75,cd:.75,aim:.65,iq:.55,reactDelay:.07},
  legend:{speed:40,react:.13,err:.6, range:6.6,pred:0.95,cd:.50,aim:.9,iq:.9,reactDelay:.04}
 },

 /* ---- rod stats (league builds) --------------------------------------- */
 // Six 0-10 stats per rod. base (5) is neutral: every multiplier is exactly 1
 // there, so a team with no build plays identically to the pre-stats game.
 // Effects stack per point away from base. Physical stats (spd/str/ctl) apply
 // to a rod whoever holds it; rea/acc also shape the AI brain; acc adds a
 // kick aim-assist (human rods too) that only kicks in ABOVE base.
 stats:{
  base:5, max:10,
  spd:.07,            // rod slide speed ±7%/pt (stacks with freeze power-up)
  agil:.09,           // AI slide-accel (direction-change) ±9%/pt of spd — a touch snappier than top speed (AI rods only)
  str:.08,            // ball hit impulse ±8%/pt (stacks with boost power-up)
  ctl:.12,            // contact grip ±12%/pt — high = sticky soft touch, low = ball pings off
  accErr:.14,         // AI wandering aim error −14%/pt above base
  accAim:.08,         // added to DIFFS.aim per pt above base (goal targeting)
  assistBase:.045,    // aim-assist: BASELINE heading bend (rad) at base accuracy — so shots still steer
                      //   toward goal/gap even with no build (AI aims in every mode). Accuracy scales up
                      //   from here toward assistMax, and fades toward 0 for rods below base accuracy.
  assistMax:.10,      // aim-assist: max heading bend (rad) at acc=max (scales up from assistBase)
  assistCone:.6,      // only bend shots already within this angle of goal centre (rad)
  assistMinVX:20,     // only bend shots moving goalward faster than this (u/s)
  rea:.10,            // AI reaction lag −10%/pt above base
  cd:.08,             // kick cooldown −8%/pt above base
  iq:.15,             // decision intelligence: ×(1±15%/pt) on the difficulty's base iq roll
                      // (DIFFS.iq). base 5 = ×1 (unchanged); 10 ≈ ×1.75, 0 ≈ ×0.25. In league
                      // every brain is the same difficulty (CONFIG.league.baseDiff), so this stat
                      // IS the team's smartness knob.
  predIq:.06,         // ball-trajectory anticipation (stPred): scales D.pred lead ±6%/pt of iq
  predFloor:.7,       // …floored here so low-iq rods still lead the ball a bit (never below ×.7)
  /* ---- stamina, channel A: the CLOCK ----------------------------------
     A uniform ramp over the match — nothing until fatStart, full by fatEnd. Everyone on the
     table tires at this rate whether they've played the whole match or stood still. */
  fatStart:60, fatEnd:180,
  fatMax:.25,        // the TOTAL fatigue budget (max slow-down at sta=0). BOTH channels share it.
  /* ---- stamina, channel B: EXERTION ------------------------------------
     Every swing costs the SWINGING rod a little, and the cost bleeds off again at `recover`/s.
     So a rod that's been in the thick of it all match is spent by the whistle while one that's
     touched the ball twice is still fresh — fatigue stops being a flat tax on everybody.
     `weight` SPLITS fatMax between the two channels, it does NOT stack on top of it: the clock
     owns (1-weight) of the budget and exertion owns `weight`. The worst case is therefore still
     fatMax and existing balance stays bounded — what changes is that a QUIET rod now fades less
     than it used to. `weight:0` (or `on:false`) restores the old uniform drain EXACTLY. To widen
     the gap between a busy rod and an idle one, raise fatMax rather than weight.
     Exertion is deliberately NOT scaled by the sta stat: stFat's outer (1 - sta/max) term is
     already the one stamina knob and it gates BOTH channels, so a sta-10 rod is immune to kick
     drain too. Scaling it here as well would double-dip and make the numbers unreadable. */
  kickFat:{
   on:true,
   weight:.55,      // share of fatMax driven by swinging (the clock keeps the other .45)
   per:1,           // exertion banked per swing — the unit IS a swing, so `full` reads as a count
   full:30,         // swings-worth of exertion at which this channel is fully spent (ramp = 1).
                    //   THE knob to reach for first: it sets how many swings it takes to notice.
                    //   Lower = the channel bites sooner (and busy rods bunch up at the ceiling),
                    //   higher = only a rod that's had the ball all match ever feels it.
   recover:.12,     // …bled off per second of sim time. Net-positive above ~1 swing / 8.3s, so a
                    //   rod under sustained pressure banks fatigue while a quiet one drifts back
                    //   fresh. Reaching `full` NET over a 180s match therefore takes about
                    //   full + .12×180 ≈ 52 swings — i.e. genuinely heavy involvement, not a
                    //   number an idle keeper wanders into.
   cap:1.25,        // hard ceiling, as a multiple of `full`. Bounds a very long match AND leaves a
                    //   little overdraft, so a rod that's been hammered doesn't come back the
                    //   instant it stops swinging.
   userDrain:false  // do HUMAN-held rods accrue it? OFF by default: a human swing isn't cooldown-
                    //   gated the way an AI's is (only the swing length caps the rate), so a player
                    //   mashing kick would out-swing every AI on the table several times over and
                    //   nerf their own rod. Turning it on makes mashing self-punishing — that's a
                    //   real balance decision, not a fix.
  }
 },

  /* ---- league mode ------------------------------------------------------ */
  league:{
    divSize:10,           // teams per division (even; 10 → 9 rounds)
    goals:5,              // goals to win a league match (live AND simulated), and the per-team cap when timed
    // Timed-league sim: when a league is created with a game-time limit (LG.gameTime), the player's
    // live matches finish at varied, often modest scores rather than racing to 5. So a timed league
    // sims each AI fixture with a RANDOM total-goal count in [simMinGoals, simMaxGoals], split by
    // strength `p` and capped at `goals` per team — a match can land anywhere from a tight 1–0 up to
    // an end-to-end 5–4. The total is drawn from a centre-weighted (triangular) distribution so most
    // games sit mid-range and lopsided clean sheets are rarer; a level game is settled by a
    // sudden-death golden goal, so results stay decisive (no draws). Unlimited leagues keep race-to-5.
    simMinGoals:1,        // fewest total goals a simmed timed match can produce (1 → a tight 1–0)
    simMaxGoals:9,        // most (9 → a 5–4; the per-team `goals` cap keeps it realistic)
    // Brain difficulty every league team plays at — builds (stats) are layered ON TOP of this.
    // 'rookie' keeps a fresh league gentle: sluggish slide, big reaction latency, loose aim, rarely
    // clever; upgrading rea/spd/acc/iq pulls a team up from there. A per-division 'diff' field
    // (see divisions[] below) overrides this for that tier, so you can ramp the ceiling up the
    // ladder (e.g. Sunday rookie → Premier legend) instead of a flat floor.
    baseDiff:'rookie',
    upWin:3, upLoss:1, upCleanSheet:1, // upgrade parts awarded (tune: 4/2 feels better with escalating costs)
    playerStart:10,       // parts the player has to spend when a fresh league starts
    cost:[1,2,3,5,8],    // cost of raising a stat from level 5+i (5→6=1, 9→10=3)
    tape:true, tapeT:3,   // pre-match splash: OFF/DEF bars + figurines; click to skip
    // tapeT is a "look at this" beat, so it only starts once the two figurine PNGs have DECODED
    // (they're preloaded in the lobby by primeMatchTape, so normally that's the same frame).
    // tapeReadyCap bounds that wait — a stalled or missing render can never hold up kickoff; past
    // it the tape runs exactly as it did before. 0 = don't wait at all (old behaviour).
    tapeReadyCap:2.5,
    graceT:10,             // seconds after match-start where quitting does NOT forfeit
    simK:.5,              // sim: stat edge → per-goal probability steepness (logistic)
    divisions:[            // tier order: 0 bottom .. 2 top
      {name:'Sunday League', base:1, diff:'pro',   aiBudget:[5,10], room:'open',  skin:'sundayLeague',  table:'classic',  pitch:'pub_classic'},
      {name:'Pro League',    base:3, diff:'pro',      aiBudget:[5,10], room:'pub',   skin:'proLeague',  table:'classic',  pitch:'classic'},
      {name:'Premier League',base:5, diff:'legend',   aiBudget:[5,10], room:'arcade',  skin:'strike',  table:'classic',  pitch:'royal'}
    ],
    promoteN:2, relegateN:2,  // top/bottom N swap between divisions each season
    upPromote1:5, upPromote2:3, // upgrade parts: 1st-place promotion / 2nd-place promotion
    upChampTop:4,             // parts for winning the Premier (top) division
    promoteBoost1:2, promoteBoost2:1, // stat-floor boost per still-at-base stat: 1st-place / 2nd-place promotion
    relegateLose:1,           // stat points removed from EVERY stat per role block on relegation
    relegateFloor:1,          // a stat can't drop below this via relegation
    slots:3,                  // number of save slots
    // zone-rating weights for the statistical sim (lgRodScore normalizes, so
    // weights are relative). offMix/defMix = ATT-vs-MID and GK-vs-DEF shares.
    // lgRodScore normalizes by total weight, so adding iq just makes smartness part of
    // the OFF/DEF rating mix (light — decisions sweeten a build, they don't carry it).
    rate:{
       offMix:.6, defMix:.55,
       att:{str:.3,acc:.3,ctl:.2,spd:.1,rea:.05,sta:.05,iq:.12},
       mid:{spd:.25,ctl:.25,str:.15,acc:.15,rea:.1,sta:.1,iq:.12},
       gk: {rea:.35,spd:.25,ctl:.15,sta:.1,acc:.1,str:.05,iq:.06},
       def:{rea:.25,str:.25,spd:.2,ctl:.15,sta:.15,iq:.1}
    },
    // AI upgrade-spend weights per role — gives AI teams position-flavoured builds.
    // iq weighted toward playmaking rods (MID/ATT trap + wait-for-sweet-spot pays off most).
    spend:{
       GK: {rea:3,spd:2,ctl:1.2,sta:1,str:.4,acc:.3,iq:.8},
       DEF:{rea:2,spd:2,str:1.5,sta:1.2,ctl:1,acc:.5,iq:1},
       MID:{sta:2,spd:2,ctl:2,rea:1.5,str:1,acc:1,iq:1.5},
       ATT:{acc:3,str:2.5,ctl:1.5,spd:1,rea:1,sta:.5,iq:1.5}
    },
    names:[
       'ROD RAGE','TABLE TITANS','SPIN DOKTORS','GOAL DIGGERZ','BAR DOWN FC','DEAD BALL SC',
       'THE CRANKS','TILT CITY','KICKBACK UTD','FOOS FIGHTERS','HANDLE HOUSE','GRIP & RIP',
       'BACKSPIN BOYS','THE TABLERS','NUTMEG NOMADS','CHOP SHOP','RIMSHOT ROVERS',
       'PIVOT PIRATES','THE SWERVE','CLEAN SHEETS FC','TOE-POKE TOWN','LOB CITY',
       'WALL PASS WANDERERS','SPINNERS UTD','THE DEADLOCKS','CROSSBAR CREW',
       'SCREWBALL CITY','THE HANDLERS','BENCHWARMERS FC','WRATH OF ROD','TACTICAL FOULS', 
       'Net Busters', 'Last Minute FC', 'The Nutmeggers', 'Handlebar Heroes', 'The Rod Squad', 
       'Spin Masters', 'The Misfits', 'Relegation Rovers', 'The Slide Tackleers', 'The Foosballers', 'The Table Titans'
    ],
    cols:[
       '#ff8c3a','#ffcf4d','#7dff8a','#2af5ff','#3d8bff','#74abff',
       '#a06bff','#ff2bd6','#c45ba9','#f2ede2','#cfa241','#ff5c2b',
       '#6d5551','#888888','#250d06','#00bfa5','#ff6e40','#8d6e63',
       '#d500f9','#76ff03','#1de9b6','#ff1744','#448aff','#ffab00',
       '#e040fb','#00e5ff','#b2ff59','#ff3d00','#40c4ff','#eeff41'
    ],
    colClash:80,     // RGB distance threshold: if AI colour is too close to player's, reassign
   /* ---- champions cup (post-season KO for the Premier League champion) ---- */
   // NOTE: this block MUST stay INSIDE `league` — it is read as CONFIG.league.cup
   // (aliased to CUP at the bottom of this file). It sat one brace too far out once,
   // which made CUP undefined and crashed cupMakePool the moment a cup was created.
   // The cup has its OWN table/theme/pitch selection (answer to NOTES.md
   // "define which tables/pitches are used for which division/cup") — independent of
   // the Premier division's, so it can be retuned without touching the league.
   // `poolSize` elite "special teams" are generated ONCE and persisted on LG; each cup
   // draws `drawSize` of them (+ the player = 8) into an 8-team single-leg KO. The rest
   // are spares (variety between seasons, recurring rivals).
   cup:{
      name:'Champions Cup',
      diff:'legend',
      seeded:true,     // false = random draw (still a proper tree, just unseeded). See cupCreate.
      table:'arena', skin:'standard', room:'arcade', pitch:'champions_green', // its own venue (retune here); skin must name a CONFIG.tables[table].skins entry
      // `pitch` above is only the fallback — a tie's pitch is DRAWN from `pitches` below and then
      // remembered on the tie (cupVenue), so the bracket, the tape and the match all agree on it.
      pitches:['champions_green','champions_purple', 'neon', 'verdantia', 'cyatron'],
      goals:5, special:true, power:true,
      poolSize:12, drawSize:7,                      // 12 elite teams, draw 7 + player = 8
    // drawSize+1 MUST be a power of two and `rounds` MUST be log2 of it — the bracket is a real
    // tree now (cupSeedOrder / cupNextRound), so a 6- or 12-team field would pair off into
    // undefined. 15 + 4 rounds is the next legal size up.
      base:8, budget:[3,5],                       // elite build base + weighted spend
      enterParts:2, tieParts:2, winParts:8,         // entering / winning a tie / lifting it (upgrade parts)
      rounds:['QUARTER-FINAL','SEMI-FINAL','FINAL'],
      names:[
         'NIGHTWATCH','GALACTICOS','VOID RAIDERS','IRON LEGION','CYBER WOLVES','NOVA KINGS',
         'APEX PREDATORS','PHANTOM XI','TITAN FORGE','SOLAR FURY','EMBERLORDS','CRIMSON COBALT'
    ],
      cols:[
         '#9b5cff','#ff3df0','#3dffd5','#ffd23d','#ff6a3d','#5dff7a',
         '#3d8bff','#ff4d8c','#c0ff3d','#ff8c3d','#7a5cff','#3dfff0'
    ]
   }
  },

 /* ---- player control ------------------------------------------------- */
 control:{ slideSpeed:95, mouseSens:1.35, autoDelay:1.2, nameMaxLength:20 }, // keyboard slide, mouse range, auto rod-switch delay

 /* ---- seats (local co-op roster, js/seats.js + js/roster.js) ---------- */
 seats:{
  max:8,          // how many humans can join one match, total.
  perTeam:4,      // …and how many on ONE side. THE CEILING IS THE ROD COUNT, not CONFIG.ai.hands:
                  // a side has 4 rods, so a 5th player would be a hand with nothing to hold.
                  // `pickActiveRods` raises a team's active-rod cap to its seat count whenever the
                  // seats outnumber `hands`, so at 4-a-side every rod is live and the AI plays none
                  // of that side — correct, and the reason `hands` does NOT bound this.
                  // DEVICES bound it below the rod count in practice: there is one keyboard and one
                  // mouse, so anything past 2 players needs a pad each (see `maxPads`).
  maxPads:8,      // gamepad indices the lobby will hand out ('pad0'…'pad{maxPads-1}'). The Gamepad
                  // API itself has no small cap, but XInput on Windows tops out at FOUR pads, so 4
                  // controllers + keyboard + mouse ≈ 6 players is the realistic ceiling there.
                  // Raising this costs nothing (it only widens the token list + the poll loop).
  // SEAT COLOUR. Two players on the SAME team can't be told apart by team colour, so each seat
  // after the first on a side gets an HSL offset from its kit colour — same family, clearly a
  // different person. Applied to the held-rod marker, the HUD chips and the lobby cards, so the
  // colour you pick a seat in is the colour that floats over your rod. Index = seat's position
  // within its team; the last entry repeats if there are ever more seats than entries — so this
  // list MUST be at least `perTeam` long or the last two players on a side render identically.
  // Offsets are applied by THREE.Color.offsetHSL, which clamps s/l and wraps h, so they're safe
  // against any kit colour. Spread by LIGHTNESS first (reads at a glance on a small cone) and hue
  // second; both kit defaults sit at l≈.65, which is why P3 can afford to go down.
  tint:[
   {h: 0,     s: 0,    l: 0    },  // P1 — the plain kit colour
   {h: 0.055, s:-0.10, l: 0.20 },  // P2 — lighter, hue nudged
   {h:-0.050, s:-0.05, l:-0.22 },  // P3 — deeper
   {h: 0.115, s:-0.30, l: 0.06 },  // P4 — hue shifted furthest, desaturated
  ],
 },

 /* ---- power-ups ------------------------------------------------------ */
 powerups:{
  firstDelay:[9,14], respawn:[11,17], // seconds until first spawn / after a pickup
  boost:10, freeze:8, big:10,          // effect durations (s)
  floatY:4, floatAmp:0.8, pickR:6,    // hover height, bob amplitude, pickup radius pad
  spin:2.4,                           // idle yaw spin (rad/s); a model's own `spin` overrides it
  area:{x:32,z:22},                   // spawn box (± these)

  /* ---- pickup LOOK ----------------------------------------------------
     A type listed in `models` (and whose GLB loaded) floats as that model; anything else
     falls back to the procedural `gem` octahedron, so a missing or broken file is only a
     cosmetic downgrade — the pickup still spawns and still collects. GLBs are fetched ONCE
     at boot, shader-warmed off-screen, and clone()d per spawn: nothing is fetched, built or
     compiled mid-match. Collision is unchanged either way — it's a sphere test against
     `pickR`, not the mesh. */
  gem:{r:2.1, emissive:0.9, roughness:0.3},                    // fallback octahedron: radius, glow, roughness
  ring:{on:true, inner:2.6, outer:3.4, y:-2.8, opacity:0.55},  // ground halo under the pickup (a model may opt out with ring:false)
  models:{
   on:true,                           // false = every pickup uses the procedural gem (the old look)
   /* Per model:
        src     — GLB path.
        fit     — target size: the model is recentred and rescaled so its bounding-sphere radius
                  is this many world units (the gem's is ~2.1). Makes the authored Blender scale
                  irrelevant — drop a model in and it arrives the right size. 0 = keep as authored.
        scale   — extra multiplier on top of `fit` (fine-tuning; 1 = none).
        yaw/tilt— resting orientation, radians (yaw is added under the spin, so it survives it).
        y       — vertical nudge inside the pickup, units (the hover height itself is floatY).
        spin    — per-model idle spin (rad/s); omitted = the shared `spin` above.
        glow    — emissive intensity baked into the template's materials at load. 0 = leave the
                  GLB's own emissive alone. glowCol (hex) overrides the colour, else the model's
                  authored emissive is kept, or the type's `col` is used if it has none.
        ring    — false to drop the ground halo for this model.
        shadow  — false to stop it casting a shadow. */
   boost :{src:'assets/fuzeball_powerup_boost.glb', fit:2.4, scale:1, yaw:0, tilt:0, y:0, glow:0.5, shadow:true},
   freeze:{src:'assets/fuzeball_powerup_frost.glb', fit:2.4, scale:1, yaw:0, tilt:0, y:0, glow:0.5, shadow:true}
   // `big` has no entry yet -> keeps the gem. Add a GLB + one line here and it's wired.
  }
 },

 /* ---- dead-ball recovery -------------------------------------------- */
  deadball:{
   // "Dead" is measured by ACTUAL travel, not speed: a ball whose true position stays inside a
   // moveEps-wide box for the given time is dead — even while it still carries velocity (a ball a
   // player is holding / spinning against a wall). Speed alone missed those, and resting on a foot
   // reset the old timer every frame (collideRod's S.still=0), delaying the whistle.
   moveEps:2,          // ball must roam a horizontal box wider than this (units) to count as "in play"
   stallT:4.6,         // every ball boxed-in this long → whistle + re-drop them all
   wedgeT:2.2,         // multi-ball: one ball boxed-in this long → re-drop just it
   zoneMult:3,       // inside a table deadzone (CONFIG.tables[*].deadzones) the stuck-timer ticks
                       // this ×faster → the wait drops from stallT/wedgeT to ~stallT/zoneMult
                       // (2.6/2.4≈1.1s). 1 = no speed-up; higher = quicker re-drop in the pockets.
   roofMult:3,       // same speed-up for a ball settled ON TOP OF THE GOAL. physics.js keeps a SOLID
                       // net roof over the goal box (so a lob over the bar can't score), which means a
                       // ball that comes to rest up there is unreachable by every rod — the same pure
                       // dead air as a corner pocket, and it LOOKS more stuck because it's in plain
                       // sight. Tested against the same box physics uses (behind the goal line, within
                       // goalDepth, inside the live mouth width, above goalH), so it tracks the big-goal
                       // widen automatically. 1 = no speed-up (wait the full stallT as before).
   // Dead STRIPS between the rows. A rod's men only strike a band of x around their bar — a good way
   // AHEAD on the swing, barely anything behind — so between two rows there's a lane of pitch neither
   // can play, and a ball that stops in one sits there for the full stallT while both teams look at
   // it. Same "unreachable, so stop waiting" case as a corner pocket, just in open play.
   //   ONE ENTRY PER GAP, as a plain x range in world units — nothing derives these, so widen, narrow,
   //   shift or delete any of them freely and the timer + the debug overlay both follow. Rods sit at
   //   ±7.5 / ±22.5 / ±37.5 / ±52.5, so each lane lives inside a 15u gap; the comment on each says
   //   which two rows it falls between. Lanes run the FULL pitch width (rods slide the whole way in z,
   //   so the dead part is purely about x). Per-lane `mult` overrides the shared one below.
   //   The three widths differ for a reason worth keeping in mind while tuning: two rows FACING each
   //   other both swing into the gap and leave almost nothing; two rows of the SAME team leave a
   //   medium lane (one strikes forward into it, the other only back-sweeps); two rows facing AWAY
   //   leave the widest, since neither can swing into it at all.
   rodGaps:{
    on:true,
    mult:2,   // timer speed-up inside a lane. Deliberately gentler than zoneMult — a corner pocket is
                // hopeless, whereas a lane ball can still be nudged by a rod's raise-and-drop.
    lanes:[
     {x0:-46, x1:-44},   // red GK −52.5  ↔ red DEF −37.5   · same team
     {x0:-31, x1:-29},   // red DEF −37.5 ↔ blue ATT −22.5  · facing each other
     {x0:-17, x1:-13},   // blue ATT −22.5 ↔ red MID −7.5   · facing away
     {x0:-1,  x1:1},     // red MID −7.5  ↔ blue MID 7.5    · facing each other
     {x0:13,  x1:17},    // blue MID 7.5  ↔ red ATT 22.5    · facing away
     {x0:29,  x1:31},    // red ATT 22.5  ↔ blue DEF 37.5   · facing each other
     {x0:44,  x1:46}     // blue DEF 37.5 ↔ blue GK 52.5    · same team
    ]
   },
   // Where a dead / out-of-play ball comes back in. Each zone is a face-off spot BETWEEN two opposing
   // rows: `x` is the spot, `spread` the random x jitter around it.
   //   `from` is the stretch of pitch that zone SERVES. With sameThird on, the re-drop lands in the
   // zone whose `from` contains the x the ball DIED at, so it returns in the same third it was killed
   // in. Without that a random zone was pure profit for whoever was cornered: a keeper or defender
   // could smother the ball against his own line, take the whistle, and get a 2-in-3 chance of the
   // re-drop landing further up the table than he could ever have kicked it. Same rule is applied to
   // the restart after a ball goes OUT OF PLAY (js/balls.js serve, via S.serveAt) — otherwise hoofing
   // it off the table from your own corner is the identical exploit by another route. A goal kickoff
   // is unaffected and still drops centre.
   //   The three ranges must tile -L/2..L/2 with no gaps; the outer two run past the goal lines so a
   // ball that leaves behind a goal still resolves. An x covered by nothing (or sameThird:false)
   // falls back to the old random pick.
   redrop:{y:30,z:16,vel:30,  // fresh drop box + launch speed (x removed — now uses zones)
    sameThird:true,
    zones:[                   // 3 face-off zones where both teams contest
     {x:-30,spread:5,from:[-999,-20]},  // def vs att  (between DEF -37.5 & ATT -22.5) · red's own third
     {x:0,  spread:5,from:[-20,20]},    // mid vs mid  (between MID -7.5  & MID  7.5)  · middle third
     {x:30, spread:5,from:[20,999]}     // att vs def  (between ATT  22.5 & DEF  37.5) · blue's own third
    ]}
  },

 /* ---- camera --------------------------------------------------------- */
 camera:{
  // each mode: [x,y,z, lookX,lookY,lookZ]
  modes:[
   [0,68,47,0,25,21],   // Close Side
   [-70,75,0,-37,36,0], // RED MID CAM
   [0,92,86,0,0,2],     // Cam 1
   [0,100,2,0,0,0],     // Top-down
   [-85,38,0,0,-4,0],   // Behind Goal 1
   [85,38,0,0,-4,0],    // Behind Goal 2
   [66,44,41,31,17,14],  // Goal 2 Corner
   [-66,44,41,31,-17,-14],  // Goal 1 Corner
   [-50,52,0,0,16,0], // RED MID CAM
   ],
  // Indices above whose x is anchored to ONE END of the table. When every human is on the SAME
  // team and that team is BLUE, these mirror (x and lookX negate) so a blue player gets the same
  // shots from their own end. Without it "RED MID CAM" points a blue player up the wrong half —
  // which was true of solo blue play long before local co-op existed.
  sideModes:[1,4,5,6,7,8],
  // …of those, the ones with no mirror partner already in the list. 4/5 and 6/7 are end pairs, so
  // both ends are covered whatever happens; 1 and 8 are red-only, so they drop out of the V cycle
  // when no single team owns the camera (humans on both sides, or an AI spectate). One screen,
  // two players facing each other — a one-sided shot can't be made fair, so it isn't offered.
  soloOnly:[1,8],
  follow:0.0014, lookFollow:0.01, lerp:3,   // ball-follow weights + position lerp
   shakeDecay:0.6, shakeX:0.004, shakeY:0.002, // screen-shake decay + amplitudes
   freeRoamSpeed:80, freeRoamSprint:2.0, freeRoamSens:0.22 // free-roam: base speed, sprint mult, mouse sens
  },

 /* ---- serve ---------------------------------------------------------- */
  serve:{ dropY:30, spread:5, zSpread:15, vel:8, spin:10.5 }, // ball drop height, x spread, z spread, nudge speed, random spin

 /* ---- cannonball ------------------------------------------------------ */
   cannonball:{
    timer:10,           // seconds before the cannonball explodes
    warn:3,             // seconds before detonation that the red pulsing warning starts
    warnColor:0xff0000, // outline/glow color used during the warning pulse
    warnShellScale:1.22,// outline shell radius, as a multiple of BALL_R
    warnFlashDecay:4,   // base decay rate of the beep-synced flash (higher = snappier, shorter flash)
    warnLightMax:2.4,   // peak point-light intensity reached right at detonation
    removeDuration:20,  // seconds the nearest player is removed after explosion
   fractureFadeOut:.5,// seconds the fracture debris fades out just before it's disposed (players AND ball)
   // --- ball self-fracture (the cannonball itself shattering on detonation) ---
   explosionSrc:'assets/animations/cannonball_explosion.glb', // baked ball fracture GLB (one Action/clip PER shard, like the player explosions)
   fractureLife:2.9,   // seconds the ball debris lives before disposal; the ball has no respawn so this is self-contained (keep >= the baked clip length)
   fractureScale:1,    // scale for the ball-fracture instance (baked in-scene at game scale, so 1; bump if the export came out small/large)
   // --- respawn swirl (swirly particles that rise from the floor to the rod in the last seconds before a removed player reforms) ---
   respawnSwirlSrc:'assets/animations/swirl_particles.glb', // baked swirly-particle GLB — one shared asset for every figurine. ⚠ SET this to the actual filename you added to assets/animations. Clips are LOOPED, so a short bake just repeats to fill the window.
    respawnLead:5,          // seconds BEFORE the player reforms that the swirl starts. With removeDuration:20 → 5 means the swirl kicks in 15s after the explosion. 0 = AUTO (use the baked clip's own length, which starts it as early as the bake is long)
    respawnSwirlTail:2.6,   // seconds the swirl KEEPS PLAYING AFTER the player reforms. The figurine's fade-in (respawnFade) happens inside this window, so the particles are still swirling while it materialises. Set = respawnFade to cover the whole fade-in
    respawnSwirlFit:true,   // true = time-stretch the baked clip so the WHOLE exported animation plays exactly once across the (respawnLead + respawnSwirlTail) window — use when the bake is longer than the window and you don't want it cut off mid-swirl. false = play at authored speed and LOOP to fill (a long bake then gets truncated at the reform)
   respawnSwirlScale:1,    // scale for the swirl instance (bump if the export came out small/large)
   respawnSwirlY:0,        // world-Y the swirl is seated at; 0 = floor. The baked animation is expected to rise from here up toward the rod
     respawnSwirlFadeOut:1.6, // seconds the swirl spends dimming 1→0 at the very END of its life (i.e. the last N seconds of the tail). = respawnSwirlTail means it starts dimming the instant the player begins fading in, so the two cross-dissolve
     respawnSwirlLight:3.6,  // peak intensity of a soft team-tinted point light riding the swirl (0 = no light)
     respawnSwirlTint:true,   // true = recolour EVERY mesh in the swirl to the team kit colour (the GLB is all-effect, so there's nothing to preserve). false = keep the bake's authored colours
     respawnSwirlEmissive:1,  // team-colour multiplier written into each material's emissive when tinting. This is the knob that makes the tint actually READ on a glowy/additive particle bake — raise toward 2-3 if the swirl looks washed out, drop to 0 to tint the base colour only
     respawnSwirlTintParts:null, // null/absent = tint everything. Set to an ARRAY of material names (like a figurine's teamParts) to tint ONLY those — use if the bake has a deliberately neutral element (white core, ground decal) that shouldn't go team-coloured
     respawnFade:2.6          // seconds the returning figurine eases in from transparent → opaque on respawn (gentle fade-in instead of a hard pop). Starts AT reform, i.e. at the start of respawnSwirlTail
  },

/* ---- ball types ----------------------------------------------------- */
  // Each ball type may define an optional `audio` block that overrides the
  // synthesised contact sounds for that ball. Every field is optional — any
  // missing field falls back to the hard-coded defaults in audio.js, preserving
  // the current sound exactly. Tune these per-ball to give each type a distinct
  // sonic character (crackling fire, heavy cannon thud, glassy split, etc.).
  ballTypes:{
   classic:{
      // NOTE: `name` is HUD copy — keep it emoji-free. The ball tag colour-codes the type from
      // `trail` (see setBallTag in hud.js); OS colour emoji can't be tinted and render per-platform.
      name:'CLASSIC',col:0xf2ede2,em:0x000000,
      mass:1.25,maxV:125,w:70,trail:'#ffffff',
      audio:{
       kick:{noiseDur:.06,noiseFreq:500,noiseFreqScale:8,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
             beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.25,beepSlide:-45},
       wall:{noiseDur:.045,noiseFreq:2300,noiseVol:.04,noiseVolScale:.002,noiseVolMax:.28},
       post:{noiseDur:.03,noiseFreq:3200,noiseVolScale:.5,freqs:[523,832,1290,1900],droop:.94,
             attack:.003,decay:.28,vol:.14,volScale:.004,volMax:.5}
      }
   },
   fire:   {name:'FIREBALL',col:0xff6a1f,em:0xff2200,
      mass:1,maxV:100,w:14,trail:'#ff8c3a',light:0xff5500,
      audio:{
       kick:{noiseDur:1.2,noiseFreq:8000,noiseFreqScale:14,noiseVol:.07,noiseVolScale:.05,noiseVolMax:.22,
             beepFreq:1500,beepDur:.6,beepType:'sine',beepVol:.001,beepVolScale:.002,beepVolMax:.015,beepSlide:-80,attack:.08,decay:1.1,},
       wall:{noiseDur:.05,noiseFreq:2800,noiseVol:.06,noiseVolScale:.003,noiseVolMax:.12},
       post:{noiseDur:.04,noiseFreq:4000,noiseVolScale:.6,freqs:[587,932,1397,2100],droop:.93,
             attack:.003,decay:.8,vol:.15,volScale:.005,volMax:.35}
      }
   },
   cannon: {
      name:'CANNONBALL',col:0x000000,em:0x000000,
      mass:7,maxV:100,w:30,trail:'#000000',
      audio:{
       kick:{noiseDur:.15,noiseFreq:640,noiseFreqScale:4,noiseVol:.003,noiseVolScale:.004,noiseVolMax:.2,
             beepFreq:70,beepDur:.2,beepType:'sine',beepVol:.08,beepVolScale:.005,beepVolMax:.25,beepSlide:-30},
       wall:{noiseDur:.06,noiseFreq:1200,noiseVol:.08,noiseVolScale:.003,noiseVolMax:.35},
       post:{noiseDur:.04,noiseFreq:2200,noiseVolScale:.4,freqs:[328,523,784,1100],droop:.95,
             attack:.004,decay:.32,vol:.2,volScale:.006,volMax:.6}
      }
   },
   split:  {
      name:'SPLIT BALL',col:0xa46bff,em:0x4a18b8,
      mass:1.5,maxV:140,w:3,splits:true,trail:'#c39bff',
      audio:{
       kick:{noiseDur:.05,noiseFreq:6000,noiseFreqScale:10,noiseVol:.05,noiseVolScale:.002,noiseVolMax:.02,
             beepFreq:80,beepDur:.17,beepType:'sine',beepVol:.01,beepVolScale:.04,beepVolMax:.25,beepSlide:-55},
       wall:{noiseDur:.04,noiseFreq:3200,noiseVol:.03,noiseVolScale:.0015,noiseVolMax:.22},
       post:{noiseDur:.025,noiseFreq:3600,noiseVolScale:.55,freqs:[659,988,1480,2200],droop:.92,
             attack:.002,decay:.22,vol:.12,volScale:.003,volMax:.4}
      }
   },
   knuckle: {
      // Erratic flutter ball: light, and its side-spin gets re-kicked to a fresh random value on a
      // short timer (see stepBall) so the flight path weaves unpredictably — nasty to read, nasty to
      // trap. Energy-safe: spin only rotates the horizontal velocity, it never adds speed. No GLB mesh
      // slot, so it renders as its own glowing-cyan sphere (makeBallModel returns null → sphere fallback).
      name:'KNUCKLEBALL',col:0x5be0ff,em:0x0a3a66,
      mass:1.0,maxV:100,w:12,trail:'#8fe8ff',light:0x33cfff,
      knuckle:{every:[0.11,0.26], kick:1.5, max:2.2}, // re-kick spin every [lo,hi]s by ±kick, clamped to ±max
      audio:{
       kick:{noiseDur:.05,noiseFreq:1200,noiseFreqScale:9,noiseVol:.05,noiseVolScale:.0025,noiseVolMax:.3,
             beepFreq:100,beepDur:.1,beepType:'sine',beepVol:.07,beepVolScale:.03,beepVolMax:.24,beepSlide:60},
       wall:{noiseDur:.045,noiseFreq:2600,noiseVol:.04,noiseVolScale:.002,noiseVolMax:.24},
       post:{noiseDur:.03,noiseFreq:3400,noiseVolScale:.5,freqs:[622,988,1480,2200],droop:.93,
             attack:.003,decay:.26,vol:.13,volScale:.004,volMax:.48}
      }
   },
   golden: {
      name:'GOLDEN BALL · ×2',col:0xffc933,em:0x7a5200,
      mass:3,maxV:140,w:3,value:2,trail:'#ffd75e',metal:.85,
      audio:{
       kick:{noiseDur:.055,noiseFreq:800,noiseFreqScale:7,noiseVol:.04,noiseVolScale:.0025,noiseVolMax:.38,
             beepFreq:110,beepDur:.085,beepType:'triangle',beepVol:.09,beepVolScale:.0035,beepVolMax:.28,beepSlide:-40},
       wall:{noiseDur:.04,noiseFreq:2100,noiseVol:.035,noiseVolScale:.0018,noiseVolMax:.26},
       post:{noiseDur:.028,noiseFreq:3000,noiseVolScale:.48,freqs:[587,880,1319,1760],droop:.93,
             attack:.003,decay:.26,vol:.15,volScale:.0045,volMax:.52}
      }
   },
  },

  /* ---- ball reflections (local cube-map) -------------------------------
     scene.environment (the room bake) is a DISTANT env — it can't show the table/pitch/
     players the ball is actually sitting among. This adds a small cube camera that rides
     the lead ball and renders the real scene around it once per (throttled) frame; its
     cube texture is reused as `envMap` on every ball material, so a metallic ball (esp.
     the golden one) reflects the pitch below it, the walls beside it and the men around it,
     tracking as it moves. Cost = ONE extra scene pass (shadows frozen for it), gated by the
     Options 'Reflections' toggle (cfg.reflections) — off → balls fall back to the room env.
        on        — master switch for the feature (independent of the room-env fallback).
        res       — cube face resolution. 128 is a good ball-sized balance; 256 = sharper/costlier.
        every     — update the cube every Nth frame (1 = every frame, 2 = ~30Hz — invisible lag
                    on a small ball, half the cost). Raise if a weak GPU ever dips.
        near/far  — cube camera clip range; must span the table + room.
        intensity — envMapIntensity on the ball (reflection strength). */
  ballReflect:{on:false,res:32,every:2,near:1,far:700,intensity:1},

  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:true,  // false = use generated sphere, true = use assets/balls/fuzeball_ball.glb (per-type material slots)
   fractureFx:true      // false = skip loading/using explosion GLBs, always use the old instant-vanish
  },

 /* ---- power-up types ------------------------------------------------- */
 // `ico` is gone — the HUD draws inline SVG from FX_ICO (hud.js) so the mark tints to the team
 // colour and renders identically on every platform. `col` is the pickup mesh/particle colour.
 puTypes:[
   {key:'boost',label:'POWER HITS',col:0xfff04d},
   {key:'freeze',label:'RIVALS FROZEN',col:0x7ae4ff},
   {key:'big',label:'BIG GOAL',col:0x7dff8a}
 ],

 /* ---- rooms / locations --------------------------------------------------
    A ROOM is the place you play in — the environment surrounding the table. It's
    independent of the table SHAPE and the PITCH, so any table + pitch drops into
    any room. A room owns:
      • bg / fog     — the backdrop colour + fog depth [near,far] (fog2 optional 2nd colour)
      • hemi / dir   — the scene lighting (ambient sky/ground + the key "sun"); this is what
                       makes a pub feel warm and an arcade feel neon, and it reflects off the
                       table/pitch/ball PBR materials.
      • glb          — an optional environment backdrop model (path relative to folder). null =
                       use the shared ground plane + rotating crowd cylinder instead. A path that
                       404s is latched (models.js roomFailed) and falls back the same way, ONCE —
                       it isn't re-fetched on every venue change.
      • backdrop     — false: don't stand the shared ground+crowd in when this room's glb isn't on
                       screen. Just bg + fog, i.e. a true void. Default (absent) = do stand it in.
      • reflect      — true: bake the reflection env-map FROM the glb (real room reflections on
                       metal/gloss). false: use the synthetic `env` panels below. Globally gated
                       by cfg.reflections (off → always synthetic, cheap).
      • env          — synthetic reflection cube: {shell, panels:[[hexColor,x,y,z,w,h],…]}. Used
                       when reflect is off / there's no glb / cfg.reflections is off. Keeps metal
                       from rendering black and gives a cheap coloured ambient.
      • lightScale   — multiplier for KHR punctual lights baked into the glb (Blender exports
                       watts as candela, ~54x the wattage — ~4e-4 lands right; 0/absent = 1).
      • led          — optional override of CONFIG.leds for this room (idle:'rainbow'|'hold',
                       color for 'hold'). Sets the LED strip mood; the strip MESH stays the table's.
    Populated into the Location dropdown by ui.js. Add a room = one entry here (+ a glb under its
    folder if it has a backdrop). */
  rooms:{
   open:{
    // backdrop:false = nothing stands in when there's no room GLB on screen — just bg + fog, which
    // is what 'Void' means. Every OTHER room falls back to the shared ground plane + crowd while
    // its glb loads (or forever, if it has none). This USED to be an accident: the glb path below
    // doesn't resolve, and applyRoom's old fallback tested rm.glb rather than "is a backdrop
    // actually on screen", so a broken path and a deliberate void looked identical. Now it's stated.
    name:'Void', folder:'na', glb:'fuzeball_room_void.glb', backdrop:false, reflect:false,
    bg:0x05060f, fog:[210,440],
    hemi:{sky:0xcdd9ff,ground:0x1c1610,int:0.9},
    dir:{color:0xffffff,int:0.7,pos:[45,100,35]},
    env:{shell:0x0b1022,panels:[[0x18e0ff,-250,30,-110,260,120],[0xff2bd6,250,30,110,260,120],[0x9b6bff,0,150,-250,340,90],[0xffffff,0,155,0,150,150]]},
    led:{idle:'rainbow'}
   },
   pub:{
    name:'British Pub', folder:'assets/rooms/pub/', glb:'fuzeball_room_pub.glb', reflect:true,
    lightScale:0.0003,          // GLB punctual lights: Blender-watts→three intensity multiplier (see ensureRoom)
    bg:0x120c07, fog:[190,410],
    hemi:{sky:0xffd9a3,ground:0x140a04,int:0.6},
    dir:{color:0xffcf95,int:0.8,pos:[40,90,30]},   // eased down — the glb's pendant/sconces add light
    env:{shell:0x1a1108,panels:[[0xffa94d,-240,40,-100,260,140],[0xff7b2e,240,40,100,260,140],[0xffe6c0,0,150,0,160,160]]},
    led:{idle:'rainbow',color:0xffb454}
   },
   arcade:{
    name:'Neon Arcade', folder:'assets/rooms/arcade/', glb:'fuzeball_room_arcade.glb', reflect:true,
    lightScale:0.0003,
    bg:0x05060f, fog:[200,430],
    hemi:{sky:0x8ea0ff,ground:0x180a24,int:0.66},
    dir:{color:0xd6b8ff,int:0.9,pos:[45,100,35]},
    env:{shell:0x0b1022,panels:[[0x18e0ff,-250,30,-110,260,120],[0xff2bd6,250,30,110,260,120],[0x9b6bff,0,150,-250,340,90],[0xffffff,0,155,0,150,150]]},
    led:{idle:'rainbow'}
   }
  },
  // Legacy theme-key → room-id map (old saves + old league-division `theme` fields).
  themeToRoom:{classic:'open',royal:'pub',verdant:'open',neon:'arcade',cyatron:'arcade'},

  /* ---- pitches ------------------------------------------------------- */
  // One entry per pitch variant. `glb` = mesh name inside fuzeball_pitch.glb
  // (same as the theme keys the Blender artist uses). `tex` = jpg path on disk
  // (used as the automatic fallback when a GLB mesh is missing).
  // `name` = display label in the pitch selector dropdown.
  pitches:{
   pub_classic:      {glb:'pub_classic',     tex:'pitches/pitch_pub_classic.jpg',      name:'Pub Classic'},
   classic:          {glb:'classic',         tex:'pitches/pitch_grass_1.jpg',          name:'Cork'},
   royal:            {glb:'royal',           tex:'pitches/pitch_grass_2.jpg',          name:'Royal Grass'},
   cyatron:          {glb:'cyatron',         tex:'pitches/pitch_cyatron.jpg',          name:'Cyatron Grid'},
   neon:             {glb:'neon',            tex:'pitches/neon_nights.jpg',            name:'Neon Nights'},
   verdantia:        {glb:'verdant',         tex:'pitches/pitch_verdantia.jpg',        name:'Verdantia'},
   champions_green:  {glb:'champions_green', tex:'pitches/pitch_champions_green.png',  name:'Champions Green'},
   champions_purple: {glb:'champions_purple',tex:'pitches/prime_champions_purple.png', name:'Champions Purple'},
   },

  /* ---- LED strip fx --------------------------------------------------- */
 leds:{
  idle:'rainbow',   // 'rainbow' = cycle through hues · 'theme' = hold the theme colour
  hueSpeed:0.06,    // rainbow cycle speed (full loops per second)
  baseBright:1.5,   // idle emissive intensity
  pulse:0.4,        // idle brightness wobble amount
  pulseSpeed:4,     // idle brightness wobble speed
  excite:1.8,       // extra brightness driven by crowd noise (Au.exc)
  goalStrobe:5,    // strobe frequency on a goal (Hz)
  goalBright:4.8    // peak emissive during the goal strobe
 },

 /* ---- fx pools ------------------------------------------------------- */
 fx:{ trailSpeed:26, spriteCount:70, particleCount:300, // min speed to trail, sprite pool, particle pool
   // lightPool: how many spare PointLights sit resident (visible, intensity 0) in the scene so a
   // transient effect glow (fireball/knuckle ball, cannonball fuse, explosion, respawn swirl) can
   // borrow one INSTEAD of scene.add-ing a fresh light. r128 bakes the scene's light COUNT into
   // every material's shader, so adding/removing a light forces a whole-scene recompile — the
   // hitch you see on a new ball type / explosion / swirl. A fixed pool keeps the count constant,
   // so that recompile never happens. Overflow (more simultaneous effects than the pool) just
   // drops the extra glow, never the count. Raise if effects look under-lit in a busy multiball;
   // lower on a weak GPU (each resident light adds a little per-pixel cost even at intensity 0).
   lightPool:6,
   warmMatch:true }, // true = compile every fx a match can fire before kickoff (warmMatchAssets, fracture.js)

 /* ---- training mode --------------------------------------------------- */
 // Sandbox practice mode (js/training.js, TRAINING card on the main menu): free ball
 // placement (click the table or type XZ), a repeatable ball launcher, per-team AI
 // on/off, per-rod show/hide, freeze + single-step, no scoring. Cross-module gate is
 // S.trn (null = off) + r.trnHidden, so the game never depends on training.js loading.
 training:{
  spawn:{x:0,z:0},                   // where the first ball drops on entering training
  launch:{speed:60,angle:0,loft:10},  // launcher defaults: speed u/s · angle° (0 = toward the RIGHT goal +x, 90 = near side +z) · upward u/s
  speedMax:200,                      // launcher speed/loft clamp (keep ≤ ball maxV or the clamp eats it)
  clampMargin:2,                     // placed balls are clamped this far inside the walls/goal lines
  ringColor:0x2bff88                 // click-place ghost ring + panel accent
 },

 /* ---- goal instant replay -------------------------------------------- */
 // A flight recorder runs during play (replay.js): once per fixed sim step it writes
 // every ball's position + every rod's slide/angle into a preallocated ring buffer —
 // a few dozen float writes, no allocation, nothing rendered. After the goal
 // celebration the buffered play is re-posed through ghost balls + the real rod
 // pivots and shot with a hand-held broadcast camera, easing into slow-mo for the
 // finish. Any key / click / pad button skips. The buffer is cut on every serve and
 // re-drop so a replay never shows a teleport streak. cfg.replay is the player's
 // in-menu toggle; this block is the tuning.
 replay:{
  on:true,          // master switch (false = feature compiled out, recorder never runs)
  winner:true,      // ALSO replay the match-winning goal — the win screen waits until it's done
                    // (flow.js parks the winner in S.pendingWin; replayEnd hands off to endMatch).
                    // false = the winning goal cuts straight to the win screen, as it used to.
  buffer:7,         // seconds of play the ring buffer holds
  len:4.4,          // longest stretch of footage a replay shows (rally-capped)
  minLen:1.4,       // rallies shorter than this skip the replay (nothing worth showing)
  speed:0.7,        // playback rate through the approach
  slowLast:1.3,     // the final N seconds of footage ease into slow-mo…
  slowSpeed:0.22,   // …down to this rate right at the goal
  holdT:0.55,       // freeze-frame on the ball crossing the line (s)
  zoom:0.8,         // fov multiplier reached at max slow-mo (broadcast push-in); 1 = none
  camLerp:5.5,      // camera position chase rate (hand-held feel — lower = floatier)
  lookLerp:8,       // look-target chase rate (slightly ahead of the body, like a real operator)
  trailEvery:0.045, // seconds between trail sprites on a fast-moving replayed ball
  roll:true,        // spin the replayed ball along its path (the recorder stores POSITION only, so
                    // without this a textured ball slides through the replay without turning).
                    // false = the old frozen-texture behaviour.
  // --- replay AUDIO ------------------------------------------------------
  // The sim is FROZEN during playback, so nothing fires a sound by itself and a replay used to
  // run silent under the live crowd bed. The rally's impacts are logged as they happen (replay.js
  // taps Au directly — see the sound-recorder block there) and re-fired against the FOOTAGE clock,
  // pitched down as the replay eases into slow-mo. `on:false` restores the silent replay exactly.
  audio:{
   on:true,        // ← master boolean: re-fire the rally's sounds during playback
   gain:0.9,       // level of a replayed sound vs the same sound live (feeds Au.vol)
   pitch:0.85,     // how far pitch follows the playback rate. 0 = normal pitch throughout,
                   // 1 = full tape slowdown (a slow-mo strike lands as a deep thud)
   pitchMin:0.3,   // pitch floor — below this a hit stops reading as a hit and becomes a rumble
   goalSting:true, // re-fire the goal horn on the freeze-frame, at NORMAL pitch (it's the
                   // celebration landing, not footage)
   events:192      // ring capacity for logged sounds. A 7s buffer never gets close; overflow
                   // just drops the oldest, same as the position ring
  },
  // --- clip SAVING -------------------------------------------------------
  // The canvas recorder (js/capture.js) is armed at the FIRST FRAME of every replay, so the save
  // key can be pressed at any point — including on the freeze-frame, which is when you actually
  // know the goal was worth keeping — and still write the WHOLE replay out rather than the tail
  // from the keypress. A recording nobody promoted is discarded on stop.
  // THE COST OF THAT: every goal pays one encode whether or not anyone saves it. Chrome encodes
  // off-thread, so the main-thread share is the per-frame canvas copy, and it only runs during
  // the ~5s replay while the sim is frozen — but if a weak machine shows a sag on replays, this
  // is the first thing to turn off, and the profiler (M) will call it GPU/BROWSER, not SIM.
  // `on:false` = never record; the save hint then never appears and every key skips as before.
  save:{
   on:true,
   key:'KeyS',     // keyboard code. EVERY other key still skips the replay (input.js)
   pad:3,          // gamepad button (3 = Y / triangle); A/B/Start still skip
   hint:'S — save clip',
   saving:'SAVING CLIP'
  },
  // --- shot placement (world units: X = goal-to-goal, Z = width, Y = up; the table
  //     walls top out at y≈10, so keep camera heights above that unless you WANT the
  //     wall in frame). `gx` below = the beaten goal's end of the table (±60), so
  //     x values given as ×gx auto-mirror for whichever goal was scored in. Tweak a
  //     number, reload, score a goal. ---
  shots:{
   rail: {y:26, z:52, followX:.8, bob:2.5},       // sideline dolly: height, distance out past the sideline, ball-x chase factor, vertical bob amount
   net:  {xMult:1.35, y:22, rise:6, sway:7},      // behind the beaten goal: x past the line (×gx), base height, climb over the shot, side-to-side drift
   crane:{xFrom:.62, xTo:1.02, yFrom:42, yTo:20, zFrom:46, zTo:30}, // corner crane: eased start→end placement (x values ×gx)
   drone:{y:62, dip:8, z:26, sway:8},             // sky drone: height, descent over the shot, base z, drift
   ball: {back:6, up:2, minY:1.5, lookAhead:34, lookY:4} // ball cam: distance goal-side of the ball, height above it, height floor, how far up-pitch it gazes, gaze height
  }
 },

 /* ---- clip capture (js/capture.js) ------------------------------------ */
 // MediaRecorder over the game canvas, plus a second tap off Au's master gain for the audio
 // track. ONLY THE CANVAS is recorded, so a saved clip carries no letterbox bars, no REPLAY
 // tag and no HUD — all of that chrome is DOM. Currently driven only by the goal replay
 // (CONFIG.replay.save) but nothing in capture.js knows that. Every step is best-effort: an
 // unsupported browser, a missing codec or a throwing recorder means no clip, never an
 // exception into the game loop, and one failure disables capture for the rest of the session.
 capture:{
  on:true,             // master switch for the recorder
  fps:60,              // canvas capture rate. 0 means "a frame per composite" and needs manual
                       // requestFrame() calls to produce anything — leave it above zero
  bitrate:12000000,    // video bits/s. 12M ≈ 7MB for a 5s clip — deliberately generous: a foosball
                       // table in slow-mo is all hard edges and fine mesh, which a low bitrate mushes
  audio:true,          // mux the game audio into the clip (silent if cfg.sound is off)
  audioBitrate:128000,
  chunkMs:250,         // MediaRecorder timeslice — small enough that a replay skipped a beat after
                       // the save key still has data to write
  revokeMs:20000,      // how long the blob URL is held alive after the download fires
  prefix:'fuzeball_goal',
  mime:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']   // first supported wins
 },

};

/* =========================================================================
   Derived aliases — so game modules stay terse and unchanged. Do NOT edit
   these; edit the CONFIG groups above.
   ========================================================================= */
const F=CONFIG.table;
const BALL_R=CONFIG.physics.ballR, ROD_H=CONFIG.physics.rodH, PLAYER_H=CONFIG.physics.playerH, ARM=CONFIG.physics.arm,
       PRAD=CONFIG.physics.prad, GRAV=CONFIG.physics.grav,
       FOOT_T=CONFIG.physics.footT, FOOT_BOX=CONFIG.physics.footBox, FOOT_BOX_OFF=CONFIG.physics.footBoxOff,
       FOOT_BOX_REACH=CONFIG.physics.footBoxReach, FOOT_JITTER=CONFIG.physics.footJitter;
const PHY=CONFIG.physics, KICK=CONFIG.kick, AIC=CONFIG.ai, CTRL=CONFIG.control,
      PWR=CONFIG.powerups, DEAD=CONFIG.deadball, CAM=CONFIG.camera, MATCH=CONFIG.match, SRV=CONFIG.serve, SIM=CONFIG.sim, REPLAY=CONFIG.replay,
      CAPTURE=CONFIG.capture;
const RODDEFS=CONFIG.rods.defs, DIFFS=CONFIG.diffs, BALL_TYPES=CONFIG.ballTypes,
       PU_TYPES=CONFIG.puTypes, ROOMS=CONFIG.rooms, CUP=CONFIG.league.cup;
const pCount=CONFIG.fx.particleCount;
const ARENA=CONFIG.tables.arena.bowl;   // bowl shape params (arena.js reads ARENA.length/width/cornerR/…)

/* =========================================================================
   Persisted player settings (localStorage). These are the in-menu options,
   distinct from the CONFIG tuning knobs above.
   ========================================================================= */
let cfg={diff:'pro',goals:5,gameTime:0,room:'open',reflections:true,table:'classic',pitch:'pub_classic',skins:{},special:true,power:true,auto:true,sound:true,ambience:true,replay:true,
 // gameTime: match time limit in MINUTES (0 = Off / unlimited first-to-goals). 5 or 10 = timed: at
 // time-up the team ahead wins; a tie triggers sudden death (next goal wins). The goals cap still
 // ends a match early if a team reaches it first. Old saves w/o the key default to 0 (unchanged).
 redName:'Team 1',blueName:'Team 2',redColor:'#ff4d5a',blueColor:'#3d8bff',
 // Per-team AI difficulty (overrides legacy single `diff`). Both default to
 // 'pro' when missing so older saves (or first-time players) still play normally.
 diffRed:null,diffBlue:null,
 // Customize-panel settings: selected figurine + material finish + size.
  modelRed:'cyborg',modelBlue:'cyborg',redYaw:-0.55,blueYaw:0.55,
  redMetalness:.15,redRoughness:.45,redGlow:0,redScale:1,
  blueMetalness:.15,blueRoughness:.45,blueGlow:0,blueScale:1,
  // true = 'Default' finish: keep the material values exported with the model (per team).
  redFinishDefault:false,blueFinishDefault:false,
 // Controls / options screen. Sensitivities are MULTIPLIERS on the CONFIG bases
 // (CTRL.slideSpeed, CTRL.mouseSens); padAngleSens scales how far a given stick push tilts (reach).
 // padSlideAxis 'ly'=left-stick up/down · 'lx'=left/right. padAngleAxis 'ry'/'rx' likewise.
 // padSlideCurve: exponent shaping stick deflection → slide speed (1 = linear; >1 = finer near centre).
 padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,
 // 'Total Control' pad mode (padControlMode 'classic'|'total'): LT (analog) eases the slide down
 // toward padTCFine for precision steps, RT pushes it up toward padTCFast for fast moves, and with
 // neither held it sits at padTCBase — a middle-ground slower than classic full speed. The right
 // stick still angles the rod on its bound axis; the OTHER right axis is the swerve line, imparting
 // side-spin on ball contact (padTCSwerve scales strength, padTCSpinInvert flips direction).
 padControlMode:'classic',padTCBase:0.75,padTCFine:0.35,padTCFast:1.6,padTCSwerve:1,padTCSpinInvert:false,
 mouseSens:1,kbdSens:1,
 // Per-screen panel arrangements from the ⊞ Layout editor (js/layout.js).
 // Map screen-id -> {p:{elId:{x,y,w,h}},h}; missing/empty = the default CSS flow.
 layouts:{},
 // Display / graphics settings (Options → Display). renderScale multiplies the effective device
 // pixel ratio (0.5 = render at half-res, upscaled — biggest fill-rate win on integrated GPUs);
 // shadows toggles the dir-light shadow map pass; fpsCap 0=uncapped else the target the loop throttles
 // to; showFps shows the on-screen FPS counter outside debug; gfxPreset is the last-picked preset name
 // ('low'|'medium'|'high'|'custom' — 'custom' = the individual knobs were touched). reflections lives
 // above (shared with Match Setup). Applied by applyDisplay() (world.js) + the loop's fps cap.
 renderScale:1,shadows:true,fpsCap:0,showFps:false,gfxPreset:'high'};
try{Object.assign(cfg,JSON.parse(localStorage.getItem('fuzeball')||'{}'));}catch(e){}
if(cfg.model&&!cfg.modelRed){cfg.modelRed=cfg.model;cfg.modelBlue=cfg.model;delete cfg.model;saveCfg();}
// Migrate legacy single `diff` into per-team fields when those are missing.
if(!cfg.diffRed)cfg.diffRed=cfg.diff||'pro';
if(!cfg.diffBlue)cfg.diffBlue=cfg.diff||'pro';
cfg.diff=cfg.diffRed;
// Migrate the legacy global material finish (metalness/roughness/glow/modelScale) into per-team
// fields so each team can be finished independently. Old saves keep identical Red+Blue.
if(typeof cfg.metalness==='number'){cfg.redMetalness=cfg.blueMetalness=cfg.metalness;delete cfg.metalness;}
if(typeof cfg.roughness==='number'){cfg.redRoughness=cfg.blueRoughness=cfg.roughness;delete cfg.roughness;}
if(typeof cfg.glow==='number'){cfg.redGlow=cfg.blueGlow=cfg.glow;delete cfg.glow;}
if(typeof cfg.modelScale==='number'){cfg.redScale=cfg.blueScale=cfg.modelScale;delete cfg.modelScale;}
if(typeof cfg.redMetalness!=='number')cfg.redMetalness=.15;
if(typeof cfg.redRoughness!=='number')cfg.redRoughness=.45;
if(typeof cfg.redGlow!=='number')cfg.redGlow=0;
if(typeof cfg.redScale!=='number')cfg.redScale=1;
if(typeof cfg.blueMetalness!=='number')cfg.blueMetalness=.15;
if(typeof cfg.blueRoughness!=='number')cfg.blueRoughness=.45;
if(typeof cfg.blueGlow!=='number')cfg.blueGlow=0;
if(typeof cfg.blueScale!=='number')cfg.blueScale=1;
if(typeof cfg.redFinishDefault!=='boolean')cfg.redFinishDefault=false;
if(typeof cfg.blueFinishDefault!=='boolean')cfg.blueFinishDefault=false;
// Migrate the old `theme` (a colour livery) into a `room` (a location). Themes were really just
// a palette; rooms are the real axis. Unknown/old values fall back to 'open'.
if(!cfg.room||!CONFIG.rooms[cfg.room]){cfg.room=(cfg.theme&&CONFIG.themeToRoom[cfg.theme])||'open';}
if(typeof cfg.reflections!=='boolean')cfg.reflections=true;
if(typeof cfg.replay!=='boolean')cfg.replay=true;   // old saves w/o the key keep replays on
// Display settings: backfill for old saves so the Display tab reads sane values.
if(typeof cfg.renderScale!=='number'||!(cfg.renderScale>0))cfg.renderScale=1;
cfg.renderScale=clamp(cfg.renderScale,0.4,1);
if(typeof cfg.shadows!=='boolean')cfg.shadows=true;
if(cfg.fpsCap!=='match'&&typeof cfg.fpsCap!=='number')cfg.fpsCap=0;   // number, or 'match' (track detected refresh)
if(typeof cfg.showFps!=='boolean')cfg.showFps=false;
if(typeof cfg.profiler!=='boolean')cfg.profiler=false;   // frame profiler overlay (M) — persists so a session picks up where it left off
if(typeof cfg.gfxPreset!=='string')cfg.gfxPreset='high';
if(typeof cfg.physQuality!=='string')cfg.physQuality='high';
if(typeof cfg.reducedFx!=='boolean')cfg.reducedFx=false;
if(typeof cfg.trails!=='boolean')cfg.trails=true;
if(typeof cfg.particles!=='boolean')cfg.particles=true;
// (legacy cfg.theme is left as-is — the pitch migration below still reads it; nothing else does)
// Per-table chosen skin (livery). Map table-id -> skin-id; missing = the table's defSkin.
if(!cfg.skins||typeof cfg.skins!=='object')cfg.skins={};
if(!cfg.layouts||typeof cfg.layouts!=='object')cfg.layouts={};
// Migrate old saves: derive pitch from theme if missing (theme→pitch map).
if(!cfg.pitch){
  const tm={pub_classic:'pub_classic',classic:'classic',neon:'cyatron',royal:'royal',verdant:'verdantia'};
  cfg.pitch=tm[cfg.theme]||'pub_classic';
  saveCfg();
}
// Clamp figurine yaws into the slider range (fixes an old saved blueYaw:10.0 default).
cfg.redYaw=clamp(cfg.redYaw||0,-Math.PI,Math.PI);cfg.blueYaw=clamp(cfg.blueYaw||0,-Math.PI,Math.PI);
/* Persist the player's own settings. A league/cup VENUE (table + skin + room + pitch) can be sitting
   on the live cfg while a fixture is on screen — it belongs to the league SAVE, not to the player —
   so whatever js/league.js has parked for them (lgVenueHeld) is written instead. Without this,
   touching any Options control from a league match's pause menu silently makes that fixture's venue
   the player's permanent Kick Off choice. */
function saveCfg(){try{
 const v=(typeof lgVenueHeld==='function')&&lgVenueHeld();
 localStorage.setItem('fuzeball',JSON.stringify(v?Object.assign({},cfg,{table:v.table,room:v.room,pitch:v.pitch,skins:v.skins}):cfg));
}catch(e){}}

/* Physics quality (Options → Display · Performance). The adaptive substepper subdivides each sim step
   so a fast ball/foot can't tunnel: sub = ceil(vmax·dt / subTravel), clamped [subMin, subMax]. Fast
   play pins it at subMax and re-runs the full collision pass that many times — the CPU cost that drops
   frames on weak hardware when the ball is quick. These presets raise the target travel-per-substep and
   lower the ceiling to cut that work; even 'performance' keeps travel ≪ BALL_R (1.9u) so nothing tunnels
   — the only trade is slightly coarser contact resolution on the very fastest shots. 'high' = the tuned
   default (shipped feel). PHY aliases CONFIG.physics (same object), so physics.js reads these live. */
const PHYS_Q={
 high:{subTravel:0.20,subMax:7},
 balanced:{subTravel:0.28,subMax:6},
 performance:{subTravel:0.38,subMax:5}
};
function applyPhysQuality(){const q=PHYS_Q[cfg.physQuality]||PHYS_Q.high;CONFIG.physics.subTravel=q.subTravel;CONFIG.physics.subMax=q.subMax;}
applyPhysQuality();   // apply saved quality at boot (before any physics runs)
// Per-team figurine def (falls back to the first if the id is stale).
function activeModel(team){const M=CONFIG.playerModel;return M.models.find(m=>m.id===cfg[team===0?'modelRed':'modelBlue'])||M.models[0];}
// Per-team material finish: each team carries its OWN metalness / roughness / glow / scale so the
// Customize panel can sculpt Red and Blue independently. Kept as tiny globals so world/league/
// fracture/customize all read the same per-team values.
function tmMetal(t){return clamp(cfg[t===0?'redMetalness':'blueMetalness'],0,1);}
function tmRough(t){return clamp(cfg[t===0?'redRoughness':'blueRoughness'],0,1);}
function tmGlow(t){return Math.max(0,cfg[t===0?'redGlow':'blueGlow']);}
function tmScale(t){return cfg[t===0?'redScale':'blueScale']||1;}
// 'Default' finish flag: the team keeps the material values exported with the model.
function tmDefault(t){return !!cfg[t===0?'redFinishDefault':'blueFinishDefault'];}
/* Snapshot a material's authored (as-loaded/as-created) finish ONCE, so the Default option can
   restore it later no matter how many slider passes have overwritten it since. Must run before
   the first mutation — applyTeamFinish calls it at the top, and every clone site goes through
   applyTeamFinish before writing, so the first application is also the snapshot. */
function matSaveOrig(m){
 if(!m.userData)m.userData={};
 if(!m.userData.fbOrig)m.userData.fbOrig={metalness:m.metalness,roughness:m.roughness,
  emissive:m.emissive?m.emissive.getHex():null,emissiveIntensity:m.emissiveIntensity};
 return m;}
/* Apply one team's finish to one material. Default mode restores the authored snapshot;
   slider mode writes the per-team metalness/roughness/glow. `col` (optional) is the team
   colour written into emissive in slider mode; it also marks the emissive as managed HERE,
   so Default mode restores the authored emissive colour too. Pass col=null for materials
   whose emissive colour belongs to applyColors (the teamGlow tint) — those keep their team
   tint in every mode. `isGlow` keeps the glow floors (roughness ≥.12, emissiveIntensity ≥.55). */
function applyTeamFinish(m,t,col,isGlow){
 matSaveOrig(m);
 if(tmDefault(t)){const o=m.userData.fbOrig;
  m.metalness=o.metalness;m.roughness=o.roughness;
  if(m.emissive){if(col&&o.emissive!=null)m.emissive.setHex(o.emissive);m.emissiveIntensity=o.emissiveIntensity;}
 }else{
  const rv=tmRough(t),gv=tmGlow(t);
  m.metalness=tmMetal(t);m.roughness=isGlow?Math.max(.12,rv):rv;
  if(m.emissive){if(col)m.emissive.set(col);m.emissiveIntensity=isGlow?Math.max(.55,gv):gv;}
 }
 m.needsUpdate=true;}
