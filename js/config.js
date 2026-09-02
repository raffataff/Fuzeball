'use strict';
/* =========================================================================
   FUZEBALL — GLOBAL CONFIG
   All tuning values. Modules read them off CONFIG or the aliases at the end.

   Axes: X = goal to goal, Z = width, Y = up. Field at y = 0, goals at x = ±L/2.
   Left net red, right net blue. See TUNING.md for the trickier values.
   ========================================================================= */
const CONFIG = {

  /* ---- logo ----------------------------------------------------------- */
  logo:{
   src:'assets/fuzeball_logo_TC.png',  // path to the logo image
   width:460,                       // max width in px
   glow:'#5090ff',                  // glow colour for the drop-shadow + pulse
   glowSize:28,                     // base glow spread (px)
   pulseSize:44,                    // glow spread at pulse peak (px)
   pulseSpeed:3                     // pulse cycle duration (s)
  },

  /* ---- intro cinematic (boot splash → main menu) ----------------------- */
  intro:{
   on:true,          // master switch
   skip:true,        // allow key/click to skip
   fuseT:2.05,       // spark travel time before detonation (s)
   igniteT:0.35,     // darkness before the spark lights (s)
   slamDelay:0.10,   // detonation → logo slam start (s)
   shineDelay:0.85,  // slam start → specular sweep (s)
   tagDelay:0.55,    // slam start → tagline letters begin (s)
   revealT:4.35,     // total time before the menu-reveal morph begins (s)
   holdMax:6,        // extra wait for slow asset loads (s)
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
  warnT:5          // clock pulses red + ticks in the last N seconds
 },

 /* ---- moments (js/moments.js) ----------------------------------------
    The game reacting to what just happened: woodwork, keeper saves, and a goal
    banner whose copy is picked from what the shot ACTUALLY was rather than at
    random. Everything here is measured from state physics already computes —
    the speed is b.v at the instant the goal test passes, i.e. the true speed at
    the line. on:false restores the old flat-HYPE behaviour exactly.
    ---------------------------------------------------------------------- */
 moments:{
  on:true,
  inTraining:false,   // fire in the training sandbox too (off: a pinch would fight freeze/step)

  /* On-target projection. Straight-line ballistic to the goal plane — this is a
     "was that a shot at goal" test, not a physics oracle, so the spin curve is
     deliberately not modelled. Recomputed once per SIM STEP (not per substep). */
  target:{
   maxT:1.6,        // ignore a projection further ahead than this (s) — a slow roller isn't a shot
   minVX:12         // ball must be closing on the goal faster than this in x (u/s)
  },

  /* Woodwork. Fires off the EXISTING post/crossbar contacts in goalFrameCollide. */
  wood:{
   minImp:26,       // contact normal speed to count as a ring rather than a nudge (u/s)
   cd:0.6,          // per-ball lockout — a ball rattling post-to-bar is ONE moment, not four (s)
   recall:2.5,      // a goal within this long of the ring reads as "off the post and in" (s)
   pinch:0.45,      // S.timeScale dip (main.js ramps it back at .9/s — no new machinery)
   dur:1.2          // notice dwell (s)
  },

  /* Keeper saves. GK ONLY — a DEF block fires nothing, by design: the keeper is
     the one rod whose whole job this is, and crediting the defence too makes the
     notice constant instead of an event. */
  save:{
   minSpeed:24,     // incoming |v.x| to count as a shot worth saving (u/s)
   lineDist:6.0,    // contact within this of the goal line reads as OFF THE LINE
   pinch:0.5,
   linePinch:0.35,  // deeper dip — the rarest and loudest of the two
   dur:1.2,
   cd:1.0           // per-ball lockout: one save per shot, not one per substep contact
  },

  /* Goal classification */
  goal:{
   spFast:90,       // at the line: screamer (u/s)
   spSlow:10,       // at the line: scrappy / trickles in (u/s)
   curlDeg:30,      // spin curl: at least this many degrees of side-spin on the ball (deg)
   longDist:45,     // struck this far from the goal line = from distance (u)
   topY:0.62,       // top-bins: y above this fraction of goalH...
   topZ:0.55,       // ...and |z| beyond this fraction of the goal half-width
   showSpeed:true,  // append the measured pace to the sub chip
   kmh:0.35         // u/s -> km/h, same conversion the win screen already uses
  },

  /* Tuning aid */
  debug:false,


  lines:{
   ownGoal:['INTO HIS OWN NET','OH NO','DISASTER','WHAT HAS HE DONE'],
   woodwork:['OFF THE POST AND IN','IN OFF THE UPRIGHT','VIA THE WOODWORK','THE POST COULD NOT SAVE HIM'],
   curler:['CURLER','BENT IT ROUND','SWERVED IN','WHIPPED IT'],
   screamer:['SCREAMER','UNSTOPPABLE','RIPPED IT','ABSOLUTE ROCKET'],
   topBins:['TOP BINS','UPPER 90','ROOF OF THE NET','POSTAGE STAMP'],
   longRange:['FROM DISTANCE','ALL THE WAY','FROM DOWNTOWN','HE SAW HIM OFF HIS LINE'],
   deflected:['DEFLECTED IN','TOOK A TOUCH','WICKED DEFLECTION','OFF THE DEFENDER'],
   scrappy:['SCRAPPY','TRICKLES IN','SCRUFFY BUT IT COUNTS','THEY ALL COUNT']
  },
  ogCol:'var(--gold)'   // own-goal banner accent — neither team's colour claims it
 },

 /* ---- match stats */
 matchStats:{
  on:true,          // false: freshStats still allocates, the sheet falls back to the old three-number panel

  /* SHOT = a SWING contact that sends the ball goalward and roughly at the goal.
     One per swing (the swing latch, not per contact), so a ball rattling along a
     boot across four substeps is one attempt. */
  shotVX:26,        // goalward speed off the boot to count as an attempt at all (u/s)
  shotWide:3.0,     // ...and the straight-line projection must land within this many goal
                    // half-widths of centre (3.0 x 11 = +/-33 of a 68-wide table). Wider than
                    // that is a clearance or a switch of play, not a shot.
  /* ON TARGET is momOnTarget() — the SAME projection the keeper-save detector uses,
     on purpose: the save notice and the on-target column must never disagree about
     whether a given shot was going in. A shot too slow for that test to project
     (MOM.target.maxT) simply isn't on target, which is the fair call. */

  passT:2.5,        // a teammate rod receiving the ball within this long of a SWING by another
                    // of its own rods = one completed pass (s). Longer than this and the ball
                    // wandered there; it wasn't played there.

  thirds:3,         // territory buckets across the long axis. The BAR is generated from this, so
                    // another count works; the key only names the two ends plus a single middle,
                    // so anything other than 3 leaves the interior segments unlabelled.

  /* Units. The game's own scale: MOM.goal.kmh (0.35) converts u/s -> km/h, and
     km/h = m/s x 3.6, so one unit is 0.35/3.6 = 0.0972 metres. Derived rather
     than guessed — if the pace conversion is ever retuned, retune this with it. */
  m:0.097222,   // = kmh/3.6
  kmh:0.35,

  barGrow:0.55,     // comparison-bar grow animation (s). 0 = bars appear at full width.
  barStagger:0.045  // ...per row, so the sheet fills top-down instead of all at once (s)
 },

 /* ---- frame profiler (js/perf.js · M key) ----------------------------- */
 perf:{
  pub:500,        // ms between panel repaints (shows the worst frame since the last)
  spikeMs:45,     // frames longer than this are always logged (ms)
  spikeMult:2.6,  // ...or this many times the running-typical frame
  spikeMax:14,    // spike lines kept in the ring
  gcDrop:6        // heap drop in one frame counted as a GC (MB, Chrome only)
 },

 /* ---- simulation timing ---------------------------------------------- */
 sim:{
  hz:120,        // fixed physics rate (steps/sec)
  maxSteps:7     // max fixed steps per frame (drops the backlog after a stall)
 },

 /* ---- seeded sim rng (js/rng.js) --------------------------------------
    Pins the sim's random surface so a run can be REPRODUCED: a Skill Trial and the
    fixed-seed daily (FEATURE-IDEAS 3.2/3.3) both need the same setup AND the same AI
    on every attempt, and the fixed timestep had already done the other half of that.
    Only sim-AFFECTING draws are routed - particles, audio detune and the replay camera
    pick stay on Math.random, deliberately (see the banner in
    rng.js: seeding them buys nothing and makes the streams shiftable by a cosmetic
    edit). Read when a match SEEDS, so a change here takes effect at the next kickoff.
    ---------------------------------------------------------------------- */
 rng:{
  on:true,     // false = every seeded site falls back to Math.random(), i.e. the old behaviour exactly
  log:false    // console the seed at kickoff - the number you quote to reproduce a run
 },

 /* ---- table geometry ------------------------------------------------- */
 table:{ L:120, W:68, wallH:10, goalHalf:11, goalH:10.2, goalDepth:9 },

 /* ---- procedural goal net shape (cosmetic only) -----------------------
      bevel.r     rounding on the two top side creases, world units (0 = hard corner)
      bevel.segs  arc segments per crease
      cell        net square size in world units (smaller = finer mesh)
      backInset   rear plane width/depth as a fraction of the mouth
    ---------------------------------------------------------------------- */
 goalNet:{ bevel:{ r:1.8, segs:4 }, cell:1.6, backInset:0.98 },

 /* ---- table registry ---------------------------------------------------
    One entry per selectable table shape. See TUNING.md to add a new one.
      folder     asset folder
      collision  physics shell: 'flat' (physics.js) or 'bowl' (arena.js SDF)
      room       optional environment GLB, relative to folder
      defTheme   lighting livery that suits it (metadata only)
      skins      paint jobs on this shape; defSkin is shown first
      rods       optional per-table rod livery (visual only; falls back to shared)
      bowl       shape params, read only when collision:'bowl'
    ---------------------------------------------------------------------- */
 tables:{
  classic:{
   name:'Classic',
   folder:'assets/tables/classic/',
   collision:'flat',                        // flat box walls
   room:null,                               // no backdrop; uses the shared ground plane
   defTheme:'classic',
   defSkin:'wood', // must match a skins entry
   skins:{
      wood:{name:'Wood', glb:'fuzeball_table_classic_wood.glb'},
      sundayLeague:{name:'Sunday League', glb:'fuzeball_table_classic_sundayLeague.glb'},
      proLeague:{name:'Pro League', glb:'fuzeball_table_classic_proLeague.glb'},
      premierLeague:{name:'Premier League', glb:'fuzeball_table_classic_premierLeague.glb'},
      strike:{name:'Strike', glb:'fuzeball_table_classic_strike.glb'},
      alienTech:{name:'Alien Tech', glb:'fuzeball_table_classic_alienTech.glb'},                            
      alienShip: {name:'Alien Ship',  glb:'fuzeball_table_classic.glb', glbFallback:'assets/fuzeball_table.glb'}, 
   },
   // Unreachable pockets where the dead-ball timer runs faster. Each entry covers
   // all four corners: |x|>xMin AND |z|>zMin. Optional `mult` overrides zoneMult.
   deadzones:[
    {xMin:46, zMin:15.7}   // corner pockets
   ]
  },
  arena:{
   name:'Arena',
   folder:'assets/tables/arena/',
   collision:'bowl',                        // curved bowl (arena.js SDF)
   room:'fuzeball_room_arena.glb',          // arcade-room backdrop (relative to folder)
   defTheme:'neon',
   defSkin:'standard',
   skins:{ standard:{name:'Standard', glb:'fuzeball_table_arena_standard.glb'} },
   rods:{folder:'assets/tables/arena/rods/'},   // sci-fi rods (not built yet -> shared set)
   // Bowl shape, table units. Mirrored by tools/build_arena_table.py.
   bowl:{
   length:120,        // bowl length along x — keep at the table length (see TUNING.md)
   width:68,          // bowl width along z
   cornerR:12,        // plan-view corner radius
   creaseR:4,         // floor↔wall fillet radius (0 = sharp corner, keep ≤5.5)
   postR:4,           // blend radius where the crease/walls meet the goal mouth
   mouthIn:8,         // how far the goal cavity punches in past the goal line
   bigGoalReach:20,   // x-distance in front of the line the big-goal widen fades over
   bounceCut:6,       // normal speed below which wall contact rolls instead of bouncing
   fricNy:0.3,        // contact normal.y above this counts as grounded
   gradEps:0.02,      // central-difference step for the SDF gradient
   seg:{loop:200,profile:10} // mesh resolution: samples around the perimeter / up the profile
   },
   deadzones:[
    {xMin:46, zMin:15.7}   // corner pockets
   ]
  },
  circuit:{                                  // flat shape with a solid walled goal end
   name:'Circuit',
   folder:'assets/tables/circuit/',
   collision:'flat',                         // flat-box collision + the endWall bounce
   endWall:{
    h:16.2                                   // end-wall height; balls below this bounce back (see TUNING.md)
   },
   room:null,                                // no backdrop; uses the shared ground plane
   defTheme:'neon',                          // metadata only
   defSkin:'standard',
   skins:{ standard:{name:'Circuit', glb:'fuzeball_table_circuit.glb'} },
   rods:{folder:'assets/tables/circuit/rods/'},   // circuit rods (not built yet -> shared set)
   deadzones:[
    {xMin:46, zMin:15.7}   // corner pockets
   ]
  }
 },

 /* ---- table asset residency (memory) ------------------------------------
    Three separate budgets, because the three things cost wildly different amounts and the obvious
    "just cache more" is only right for one of them.

    cacheRooms IS THE EXPENSIVE ONE, and the number is not the GLB's file size. Measured with
    memTex(): leaving the arcade drops the scene's texture walk 1158MB -> 821MB, so a second
    RESIDENT room is up to ~337MB of texture, not ~20MB of download. On a machine already carrying
    a gigabyte of figurine and pitch maps that is enough to push the renderer process into the
    pagefile, which is exactly the "disk space dropping while switching rooms" symptom. Raise it to
    2 only with memTex() open. Re-parsing a room is the cheap half of a switch anyway — the browser
    HTTP cache usually serves the file, and the bake, which was the expensive half, is now kept
    separately (cacheEnvs below).

    cacheEnvs IS THE CHEAP ONE and is where the A/B-toggle win actually lives. A bake survives its
    room being evicted, so a revisit installs the real reflections instantly instead of paying
    another PMREM pass (six scene renders plus the blur convolution chain) and flashing the
    synthetic stand-in on the way there. MEASURED, r128, this renderer: a bake is a 768x768
    UnsignedByte render target = 2.25MB. Put that beside cacheRooms' ~337MB and the asymmetry is
    the whole point of splitting them.

    COUNT IT AS TWO PER ROOM, NOT ONE. A room that reflects can hold BOTH a `glb:` bake and the
    `syn:` stand-in it showed while the GLB was downloading, and the synthetic one has to stay
    because turning Reflections off in Options falls back to it. So the cap is rooms x 2 — 8 for
    the four rooms in the game, about 18MB to hold every reflection map that exists. A cap sized
    per-ROOM instead thrashes: measured at 4, six swaps across three rooms re-baked all three,
    which is the behaviour this whole change exists to remove. ADD A ROOM AND RAISE THIS — the
    roomenv harness asserts the relationship and will tell you.
 ----------------------------------------------------------------------- */
 tableAssets:{
  preloadAll:false,   // true = fetch every table skin + every room at boot
  cacheSkins:2,       // max skin GLBs resident, LRU (active always protected)
  cacheRooms:1,       // max room GLBs resident, LRU (active always protected) — see the note above
  cacheEnvs:8,        // max baked reflection maps held, LRU. rooms x 2 (glb + syn) — see above
  cachePitches:2      // max pitch GLBs resident, LRU (active always protected). 2 keeps an A/B warm
 },

 /* ---- staged venue swap (js/flow.js venueLoad) --------------------------
    Changing the room, table, skin, pitch or reflections used to run in ONE synchronous burst
    straight off a <select> change — GLB fetch + parse, PMREM bake, whole-scene recompile, prop
    rebuild, then a first frame carrying the texture upload. Nothing yielded, so the browser
    never got a paint in between: that is why it read as the tab hanging rather than as
    something loading, and why simply adding a spinner did nothing (the spinner could not be
    drawn either). venueLoad puts a veil up, WAITS FOR IT TO PAINT, does the work, warms it with
    renderer.compile(), and only then reveals. The stall does not go away — it moves somewhere
    it is allowed to happen.
      on     false = call straight through, synchronously (the old behaviour).
      fadeT  seconds to wait for the veil's CSS fade before starting work. Must be >= the
             #matchLoad opacity transition in styles.css, or the stall lands mid-fade and the
             veil freezes half-drawn, which looks worse than no veil at all.
      minT   minimum total time the veil stays up, so a cached swap doesn't strobe.
      maxT   hard ceiling on the wait. Every loader in the tree falls back on a miss, but a
             hung fetch fires neither load nor error — and a veil that never lifts is a worse
             bug than the freeze this replaces.
 ----------------------------------------------------------------------- */
 venue:{ on:true, fadeT:0.24, minT:0.45, maxT:9 },

 /* ---- core physics --------------------------------------------------- */
physics:{
   ballR:1.9, rodH:7.50, playerH:-6.90, arm:6.30, prad:1.0, grav:200,
   footT:1.0,                      // arm-fraction from pivot to foot centre (1 = at the foot)
   footBox:{x:1.3,y:1.0,z:1.35},     // foot box half-extents: x along leg, y perpendicular, z along rod
   footBoxOff:{x:-0.65,y:0.4},        // foot box centre offset from foot-base, rod-local
   footBoxReach:1.0,                // multiplier on BALL_R for foot contact distance (lower = tighter)
   footJitter:0.15,                // random velocity nudge after a foot hit (stops perfect oscillations)
   subMin:3, subMax:7, subTravel:0.2,   // adaptive substep bounds + target travel per step
   floorRest:0.42,                        // vertical restitution off the floor
   floorRestCut:6,                        // below this upward speed the bounce dies to 0
   floorHitSnd:25,                        // |v.y| above this plays a floor tap
   /* ---- contact audio gates: is this contact an impact or a roll? ---- */
   wallHitSnd:16,                         // |v| into a side/end wall above this plays a tap
   /* true = a ball that clears a wall in the air is really OUT: it falls away and gets the
      out-of-play whistle, instead of being caught on the way down OUTSIDE the table and clamped
      back onto the pitch. false restores the old behaviour. See wallLatch in js/physics.js. */
   wallEscape:true,
   ballHitSnd:12,                         // ball-vs-ball closing speed above this plays a knock
   contactHold:0.05,                      // s a surface must be clear before it can fire another impact
   contactEps:0.35,                       // gap below which the roll probe counts a ball as touching
   floorFric:0.35, airFric:0.06,           // per-substep friction coefficients, applied as exp(-k*h)
   wallRest:0.52,                         // side + end wall restitution
   postRad:0.6, postRest:0.62,            // goal post/crossbar collision radius + restitution
   ballRest:0.9,                          // ball-vs-ball restitution
   behindDamp:0.3, behindZ:1.5,           // in-net damping and z-clamp (× goalHalf)
   bigGoalMult:1.4,                      // goal-mouth widen factor while big goal is active
   bigGoalBack:1,                      // fraction of that widen applied to the net's back edge
   redropY:32,                            // y a ball is re-dropped to if physics goes non-finite
   spinTurn:0.4, spinMax:0.3, spinDecay:.74, spinCut:0.02, // Magnus curve: turn rate, clamp, decay, cutoff
},

   /* ---- rod kick + motion ---------------------------------------------- */
kick:{
   // swing-angle curve keyframes: time windows and peak angles
   windup:0,  windupA:0,   // pull-back window / angle
   strike:0.055,  strikeA:0.95,     // strike ramp end / peak forward angle
   hold:0.25,                     // hold peak until this time
   drop:0.32,                     // fully returned by this time
   raiseA:-1.6, raiseLerp:18, dropLerp:6, // lift-men angle + settle rates
   padAngleLerp:40,                // right-stick angle smoothing (0 = direct 1:1, no easing)
   userSpeed:80,                  // slide speed of the player-driven rod (u/s)
   aiOwnMult:1.,                // slide-speed multiplier for AI rods on the user's team
   boostHitMult:2.50, freezeMult:0.1, // power-up multipliers: boost (hit impulse), freeze (speed)
   // Contact restitution. 0 = dead trap touch, 1 = fully elastic. See TUNING.md.
   rest:0.01, restPower:0.8,      // passive touch / struck shot
   powFrom:0.03, powTo:0.2,       // swing-time window in which restPower is used instead of rest
   grip:0.15,                     // fraction of the foot's velocity lerped into the ball on contact
   slidePush:0.85,
   // Bonus power for a clean strike in the centre of the foot, scaled by the acc stat.
   sweetSpot:{
      on:true,
      zFrac:0.65,          // sweet z half-width as a fraction of footBox.z
      xMin:1.8, xMax:3., // dir-relative x band ahead of the rod the ball must strike within
      strBase:0.3,       // hit-impulse bonus at base acc
      strAcc:0.40,        // extra hit-impulse bonus at max acc
      iqBonus:0.15,       // extra bonus when the rod's iq roll is set (AI only)
      forceAssist:true,   // apply aim-assist on a sweet hit even outside the power window
      shake:0.9           // screen-shake kick on a sweet strike
   },
   spinGain:0.01, spinClamp:2,    // side-spin from sliding into the ball
   tcSpinGain:0.5,                // Total Control pad: side-spin per unit of right-stick swerve
   sndFrom:18, hardHit:80, shakeDiv:400, // kick sound threshold / hard-hit sparks / shake scale
   splitVel:82, splitMax:3, splitAng:0.45, splitSep:3.2 // split-ball: speed, max balls, spread, z sep
 },

 /* ---- player shot VERBS (js/shots.js) ------ */
 shots:{
  on:true,

  mod:{
   dead:0.08,        // trigger travel under this reads as untouched (analog triggers rest noisy)

   soft:{strike:0.115,strikeA:0.95, hold:0.26, drop:0.40},   //  8.3 rad/s — a controlled push
   hard:{strike:0.045,strikeA:1.30, hold:0.24, drop:0.31},   // 28.9 rad/s — a snapped strike
   softPow:0.80, hardPow:1.06,     // impulse TRIM at each end of the axis (the arc does the work)
   softCtl:1.00, hardCtl:0.55,     // control at each end: scales aim-assist, and 1-ctl is the spray
   hardExert:2.2,                  // stamina (stats.js kickFat) charged for a full-power swing
   /* TOTAL CONTROL: the axis scales how fast the rod TRACKS the right stick instead of blending a
      curve — there IS no curve, the stick is the swing. LT makes the rod heavy so a flick can't
      produce a hard hit; RT makes it snap to the stick, so your flick speed arrives intact. */
   softTrack:0.28, hardTrack:2.6,
   directLerp:120                  // stand-in tracking rate when KICK.padAngleLerp is 0 (fully direct)
  },

  pass:{
   on:true,
   modAt:-0.55,      // axis at or below this turns the kick into an aimed pass

   bendMult:1.4,
   bendCost:4        // how hard a straighter lane is preferred over a clearer one
  },

  hold:{
   on:true,
   from:0.15,        // trigger depth (past mod.dead, rescaled 0..1) at which the grip starts
   rest:0,           // restitution at full squeeze (0 = the boot kills the ball's relative speed)
   grip:0.55,        // …and grip: the ball is lerped 55% toward the boot's own velocity, which is
                     //   what CARRIES it. Kills a 60 u/s ball to ~5 against a still boot.
   carry:0.45        // …and rod slide-speed multiplier: a dribble is a shuffle, not a swipe. This
                     //   is the real over-run knob — the ball leaves at roughly grip x boot speed,
                     //   so a slower carry is what stops it running away when you stop the rod.
  },

  charge:{
   on:true,
 
   rate:1.6,          // charge gained per second at a full pull-back / a full hold
   decay:2.2,         // charge bled per second once the wind-up is abandoned
   sweetFrom:0.45, sweetTo:0.78,   // the band that pays full power AND full control
   
   powMin:1.00, powMax:1.10,       // impulse trim from 0 charge to the sweet band
   overPow:0.80,                   // …and back down to this by full charge, held too long
   ctlMin:0.55,                    // control at 0 charge (a snatched shot)
   overCtl:0.35,                   // …and at full overcharge
   spray:0.16,                     // rad of random heading error at zero control
   minFire:0.10,                   // release under this charge fires the ORDINARY swing
   stickBack:0.18,                 // Total Control: right-stick pull-back depth that counts as a wind-up
   pullA:-1.15,                    // rod-local wind-up angle at full charge (classic; capped by sweepClips)

   pullLerp:24,                    // ease rate toward it
   blockAt:0.30,                   // wind-up shortfall (asked minus got) that reads as "no room to swing"
   blockLerp:9,                    // how fast that reading eases in and out — a rolling ball must not strobe it
   tapMax:0.11,                    // 'kick'/'both': a press shorter than this is a plain tap
   trem:{amp:0.055, hz:34},        // overcharge tremble — DISPLAY ONLY (see the banner in shots.js)
   holdT:0.42,                     // how long the marker holds its verdict after the wind-up ends
   holdRise:5.5,                   // …and how far it lifts away from the rod while that settles
   /* THE VERDICT. Indexed by the band js/shots.js stamps on the rod when a wind-up ends:
      0 too early · 1 clean · 2 overcooked · 3 no room to swing. Lives here and not in fx.js so the
      marker colour and the words can never drift apart — they are one verdict shown two ways. */
   bandCol:['#8fa6c8','#ffd24d','#ff3b3b','#7d8796'],
   text:{
    on:true,                       // the words. Colour alone teaches the band once you know it;
    inMatch:false,                 //   the words are for LEARNING it, so Training and Trials only
    dur:0.85,
    labels:['TOO EARLY','CLEAN STRIKE','OVERCOOKED','NO ROOM']
   },
   
   tone:{
    on:true,
    vol:0.10, curve:0.75, attack:0.020, release:0.090,   // voice level, its shaping and its smoothing
    f0:110, f1:300,                    // tension sine, glides up with the charge
    fifthVol:0.055,                    // the fifth above it, faded in across the sweet band
    noiseVol:0.045, nf0:200, nf1:1500, // air bed + the lowpass sweep that opens it
    overDetune:0.055, wobHz:6.5, wobDepth:0.30,  // overcooked: a flat fifth and an audible unsteadiness
    markVol:0.055, markA:0.030, markD:0.22, markFHi:880, markFLo:330,  // band edges — a soft bloom, never a blip
    fireMin:0.08,                      // release quieter than this makes no discharge sound at all
    
    bodyVol:0.17, bodyF0:150, bodyF1:52, bodyD:0.26,     // the weight
    airVol:0.13,  airF0:2100, airF1:420, airD:0.34, airA:0.014,   // the discharge
    snapVol:0.13, snapF:3400, snapD:0.045, snapQ:3.0     // the clean-strike reward, sweet band only
   }
  }
 },

 /* ---- AI behaviour --------------------------------------------------- */
ai:{
   gkPad:1,                                   // keeper stays within goalHalf + this
   reactMax:.25,                              // longest reaction latency the ball-history ring covers (s)
   ttaMax:0.8,                                // only lead the ball's z if it arrives within this (s)
   inFrontMin:2, inFrontMax:6.3,            // ahead-window a forward swing can reach
   underFootFront:6.5, underFootBack:2.9,     // ahead/behind window where a swung rod stays forward
   lowY:2.05,                                    // only swing when the ball is below this height
   raiseBehind:-7.8,                          // ball must be this far behind before the rod will raise
   overFoot:2.2,                              // |Δx| under which the ball is at the feet and strikeable
   overFootOffset:1.4,                        // shift the overFoot zone this far forward of the rod

   // Side-step after a kick: slide clear in z, then lower.
   repositionSpeed:20,                        // max ball speed that triggers the side-step
   clearMargin:0.03,                           // extra z-clearance beyond footBox.z + BALL_R before lowering

   // Held-forward evade: stay forward and slide away from a slow ball still in the drop-sweep zone.
   heldFwd:{
      on:true,          // false = hold forward during the swing only, no persistent evade
      xFront:5.2,       // drop-sweep x-window ahead of the rod
      xBack:2.9,        // drop-sweep x-window behind the rod
      zMargin:0.01,      // extra z-depth of the zone beyond footBox.z + BALL_R
      maxSpeed:50,      // only evade balls slower than this
      vz:5,            // ball z-speed above this decides the escape direction (never 0)
      abortT:.25        // release the evade after this long (s)
   },
   footRangeBack:7.0,                         // backward x depth of a foot's reach rectangle

   // Foot-trap break: drop a raised rod when a slow ball is pinned at a foot.
   footTrapSlow:38.0,                         // ball speed under this counts as pinned
   footTrapZ:1.2,                            // ball within this z of a foot counts as at the foot

   // Trap: pin a slow ball under the boot, carry it sideways to an open lane, then scoop it away.
   // Phases off r.actT — catch (settleT), carry (holdT), shoot. iq-gated. See TUNING.md.
   trap:{
      on:true,
      angle:-0.5,          // rod-local tilt that puts the foot box at ball height
      lerp:14,             // ease rate toward the trap angle
      back:-5.8,           // catch window behind the rod (dir-relative x)
      front:1.4,           // …and in front of it
      maxVX:55,           // ball |v.x| must be under this to attempt a trap
      maxSpeed:55,        // total ball speed cap for attempting/keeping a trap
      alignZ:1.1,         // z-alignment of the nearest man needed to commit
      gkReach:10,          // GK only: also trap this far beyond the keeper's z-slide band
      holdRest:0,         // restitution while trapping (0 = fully absorbing)
      holdGrip:0.55,      // fraction of the foot's velocity lerped into the ball (the carry)
      minApproach:-2.5,   // closing-speed window: below this the ball is running away
      maxApproach:26,     // …above this it arrives too fast to pin
      behindSafe:-0.6,    // ball below this dir-relative x counts as behind the feet
      ownGoalGuard:4,    // no trap this close to our own goal when the ball is in front
      ownGoalBehind:16,  // …or this close when the ball is behind the feet
      // Sweep guard: refuse a catch whose swept arc would knock the ball goalward.
      sweep:{
         on:true,          // false = tilt into the ball regardless
         samples:7,        // arc samples between the current angle and `angle`
         sweepT:0.12,      // seconds the ease takes, used to advance the ball along the arc
         pad:0.15,         // extra contact slop beyond BALL_R×footBoxReach
         clampSteps:10,    // resolution of the per-ball angle walk
         floor:0.08,       // snap-to-rest deadband (rad); 0 = no snapping
         pushDot:0.2       // how goalward the impulse must be to count as a knock-back
      },
      settleT:0.35,       // catch length: hold still this long to kill the ball (s)
      holdT:3.3,          // max carry after settleT, then shoot regardless (s)
      lineClear:2.0,     // shoot once the best lane clears the blockers by this much (z units)
      slideMax:7.0,      // cumulative z travel cap for the carry
      carryLead:1.2,     // how far past the ball in z the trapping man aims while carrying
      holdZ:2.8,         // z-distance from the man above which the trap is lost
      carryMult:0.5,     // rod slide-speed multiplier while carrying
      abortT:5.0          // give up after this long (s, keep under deadball.stallT)
   },
   // Trap-shot kick curve: the scoop released from a trapped ball.
   trapShot:{
      on:true,
      windup:0.10,  windupA:-0.65,   // shallow pull-back to get the boot behind the ball
      strike:0.20,  strikeA:1.85,   // forward sweep end time / peak angle (≈23.5 rad/s)
      hold:0.3,                     // hold peak
      drop:0.4,                     // return to neutral
      powFrom:0.10, powTo:0.22,     // power window (opens with the strike so it covers the contact)
      restPower:0.8,                // restitution inside the power window
      rest:0                      // passive touch outside it
   },
   // Dribble: with the ball at the feet, men down, and no way forward, slide the ball to a
   // better line instead of hitting it into the row opposite. Ends in a normal kick or a pass.
   dribble:{
      on:true,
      roles:['ATT','MID','DEF'],  // roles allowed to dribble (never GK)
      iqGate:true,        // only rods whose iq roll passed try it
      back:-2.2,          // control window behind the rod (dir-relative x)
      front:3.5,          // …and in front of it
      alignZ:2.2,        // z-distance of the nearest man within which the ball is controllable
      maxSpeed:48,        // ball must be slower than this to be brought under control
      minApproach:-8,     // closing-speed window: below this the ball is running away
      maxApproach:22,     // …above this it won't settle
      ownGoalGuard:14,    // never dribble within this x-distance of our own goal line
      holdRest:0,         // restitution while dribbling (0 = absorbing)
      holdGrip:0.30,      // fraction of the foot's velocity lerped into the ball (lighter than a trap)
      holdZ:2.9,          // z-distance from the man above which contact is lost
      carryLead:1.5,      // how far past the ball in z the man aims while pushing it
      carryMult:0.8,      // rod slide-speed multiplier while dribbling
      slideMax:16,        // cumulative z travel cap from where control was taken
      // Target scoring: outletClr + centrePull×(gain toward centre) − travelCost×(distance).
      samples:5,          // candidate ball-z positions scanned
      range:16,           // …spanning at most this far either side of the ball
      centrePull:0.65,    // weight on getting central (raise to make wide players cut inside)
      travelCost:0.10,    // penalty per unit travelled
      minGain:1.5,        // don't enter unless the best target is this far from the ball
      retargetDead:1.5,   // a new target must move more than this to be adopted
      reEval:0.25,        // seconds between target re-evaluations
      // Release conditions, whichever fires first.
      coveredClr:1.6,     // entry gate: only dribble when the current outletClr is below this
      wideZ:14,           // …or when the ball is at least this far off centre in z
      lineClear:2.4,      // release and play it once outletClr clears by this much
      arrive:1.2,         // …or once the ball is within this of the target z
      holdT:2.2,          // …or after this long dribbling (s, keep under deadball.stallT)
      pressX:13,          // closed down: an opposing man within this x…
      pressZ:3.2,         //   …and this z of the ball forces an immediate release
      abortT:6.8,         // hard safety valve on the whole action (s)
      cd:1.2,             // re-entry lockout after a dribble ends (s)
      noPoke:true,        // also suppress the full-stretch poke so the ball can reach the feet
      // Pass: give a covered ball to a teammate rod ahead with a better shot.
      pass:{
         on:true,
         roles:['DEF','MID','ATT'],  // roles allowed to pass
         minAhead:10,         // receiver must be at least this far ahead in x
         maxAhead:34,         // …and at most this far
         minClear:1.8,        // the lane to him must clear the opposing men by this much
         wClear:1.0,          // scoring weight: can the pass get there
         wOnward:0.9,         // scoring weight: how good his shot would be
         wDist:0.05,          // scoring weight: preference for the nearer option
         bias:0.9,            // margin a pass must beat the current shot by (raise = shoot-first)
         shotBias:1.0,        // multiplier on the shot's clearance in that comparison
         onKick:true,         // also redirect a normal kick into a pass when the shot is covered
         onKickClr:1.8,       // …only when the best lane clears by less than this
         every:0.2,           // seconds between pass evaluations per rod
         assist:0.16,         // aim-assist bend toward the receiver (rad)
         assistCone:1.1,      // …only if the ball is leaving within this angle of him
         assistMinVX:5        // …and moving forward at least this fast
      }
   },
   // Pass kick curve: a soft release, roughly half the angular rate of a normal swing.
   passShot:{
      on:true,
      windup:0.08,  windupA:-0.35,  // token pull-back
      strike:0.20,  strikeA:0.85,   // forward sweep end time / peak angle (≈10 rad/s)
      hold:0.28,                    // hold peak
      drop:0.35,                    // return to neutral
      powFrom:0.08, powTo:0.20,     // power window (covers the contact)
      restPower:0.35,               // restitution inside the power window
      rest:0                        // passive touch outside it
   },
   // Safe raise: lift over a slow ball loitering behind the rod, when the lift won't clip it.
   safeRaise:{
      on:true,
      angle:-0.8,        // lift angle the rod eases to (rod-local; full raiseA is -1.6)
      lerp:4,             // ease rate toward the angle
      back:-5.8,          // x band behind the rod where a loitering ball triggers it…
      front:0.85,        // …up to this line
      maxVX:85,            // ball |v.x| must be under this
      maxSpeed:85,        // total ball speed cap
      abortT:6.5          // give up after this long (s, keep under deadball.stallT)
   },
   // Evade: slide the men away from a slow ball stuck behind them so play can restart.
   evade:{
      on:true,
      vz:5,             // ball z-speed above this decides the escape direction (never 0)
      maxSpeed:35,        // only evade balls slower than this
      maxApproach:4,      // ball must not be closing on the rod faster than this
      abortT:3.0,         // give up after this long (s, keep under deadball.stallT)
      raiseAfter:true,    // latch the raise on a successful clear so the drop knocks the ball upfield
      cd:0.8,             // re-entry lockout after an evade ends (s)
      behindDead:1.6      // ball must be at least this far behind the rod for evade to fire
   },
   // Clear lane: step out of the way when a teammate rod behind us is about to clear the ball
   // forward through our row. Outranks safeRaise / trap / evade. Slide clear in z, then lift.
   clearLane:{
      on:true,
      roles:['DEF'],      // rows that make way (add 'MID' to extend it up the pitch)
      zPad:0,             // widen the handler's z-slide band the ball must be inside
      behind:-6.0,        // ball must be at least this far behind us to enter (dir-rel x)
      nearBall:16,        // …and no further behind than this
      mateBack:6.0,       // the handling mate must be at least this far behind us in x
      mateReach:14.0,     // …and within this x-distance of the ball
      laneMargin:1.0,     // extra z clearance beyond footBox.z + BALL_R when stepping aside
      lift:true,          // also lift the men once nothing is in back-swing reach
      throughV:12,        // ball closing faster than this counts as struck
      release:-5.8,       // hand back to the normal path once the ball reaches this (dir-rel x)
      passed:1.0,         // …but a struck ball holds the lane open until it is this far past us
      abortT:3.4,         // never sit out of the lane longer than this (s)
      cd:0.35             // re-entry lockout after the action ends (s)
   },
   // Smart rods wait for the ball to reach the sweet spot instead of poking at full stretch.
   waitTta:2.,        // only wait if the ball reaches the rod within this (s)
   waitMinVX:3,         // …and is approaching at least this fast in x

   // --- goal targeting (accuracy = DIFFS.aim) --------------------------------------------
   aimGain:20,                                // converts desired lateral into a z aim-offset
   aimMax:1.2,                                // clamp on that offset (u)
   aimGoalZ:0.85,                              // aim within ±this fraction of goalHalf
   aimSpread:1.3,                             // low-accuracy spray width across the mouth
   // Gap aiming: accurate rods steer at the widest open lane and hold a covered shot briefly.
   gapAim:{
      gap:true,           // master toggle
      samples:5,         // lanes sampled across the mouth
      blockR:2.6,         // z half-width an opposing man blocks
      minAhead:2,         // an opposing rod must be this far ahead of the ball to block
      minAcc:0.25,        // minimum aim accuracy to bother gap-aiming
      sprayMix:0.2,       // fraction of the normal spray still added onto the gap target
      openMargin:0.8,     // lane clearance at or above this counts as an open shot
      holdMax:3.5         // how long a smart ATT/MID holds a covered shot (s)
   },
   // Defensive positioning: GK and DEF sit on the ball→own-goal line instead of tracking ball z.
   defend:{
      on:true,
      engage:5.5,         // only line-block while the ball is at least this far in front
      lineBias:1,       // 1 = sit exactly on the line; 0 = track ball z
      dumbBias:0.45       // fraction of that a low-iq rod commits
   },
   alignSlow:1.2, alignFast:1.25,             // z-alignment tolerance for a swing (slow / fast ball)

   // Strike gate: replay the real swing curve and refuse an aimed shot the boot can't reach.
   strikeGate:{
      on:true,
      styles:['pass','trapShot'], // kick styles that must clear the gate (the plain kick never is)
      samples:9,                // arc samples across the contact window
      lead:0.02, lag:0.02,      // widen the sampled window this far either side of the power window (s)
      pad:0.2,                  // slack on footBoxReach, to cover the gap between arc samples
      faceDot:0.25,             // how forward the contact normal must be (kills side-of-boot clips)
      zFrac:0.5,                // ball must be within this fraction of the boot's z half-reach
      maxBallSpeed:70,          // above this the ball is too fast to place with a soft aimed swing
      slideLead:true,           // predict the men's continuing slide across the swing
      groundY:0.05,             // ball counts as rolling within this of the floor
      useReal:true,             // run the geometry on the true ball, not the rod's delayed view
      faceOnContact:true        // re-test at contact; refuse pass aim-assist on a graze or leg hit
   },

   wallReach:2.6, wallSlack:0.7,              // wall-hug rescue: capsule z-reach / slack at the slide limit
   slowSpeed:35,                              // ball speed under this counts as a dead ball
   cdSlow:[1,2.5], cdFast:[0.5,1.5],       // kick cooldown random range, slow / fast ball (× DIFFS.cd)
   errEvery:[1.7,6.],                        // how often a fresh wandering aim-error target is rolled (s)

   // --- active rods + anti-jitter ---------------------------------------
   hands:3,                                   // rods per team the AI moves at once (not a cap on human seats)
   pairCommit:0.3,                            // min seconds a rod stays active before it can be swapped
   manHyst:2.1,                               // z-units a different man must beat the current one by to steal aim
   retargetDead:0.1,                          // z the desired slide must differ by before re-aiming
   errLerp:7.0,                               // rate the wandering aim error drifts to its new target (per s)
   slideAccel:600                             // AI rod slide acceleration cap (u/s²)
 },

  /* ---- 3D player models ----------------------------------------------- */
 playerModel:{
  default:'cyborg',
  /* SHADOW CASTERS PER FIGURINE. A figurine GLB arrives as one sub-mesh PER MATERIAL — the
     shipped ones are 5 (kit / visor / skin / hair / trim) — and each one is its own draw in
     the shadow pass, so 22 men can cost 110 of them instead of 22. HOW MANY PARTS ACTUALLY
     CAST is a shadow-quality decision, not a model one: it lives in `casterFrac` on the tiers
     in CONFIG.render.shadow.quality. */
  // Figurine registry — add an entry + its .glb and it appears in the Customize panel.
  //   teamParts  material names that get team-coloured
  //   hairParts  material names tinted by the hair swatch
  //   scale      uniform scale in table units
  //   mug        character-select portrait (a missing file falls back to a neutral mark)
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
      teamParts:['kit_rocko' ],hairParts:['kit_rocko_hair'],
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
      teamParts:['kit_talia', 'kit_talia_centre'],hairParts:[ 'kit_talia_hair' ],
      explosionSrc:'assets/animations/talia_explosion.glb'   
      },
   {id:'womanTanya',name:'Tanya',blurb:'Strong and fast',
      src:'assets/fuzeball_womanTanya.glb',scale:0.8,
      mug:'assets/renders/render_tanya_mugshot.png',   
      teamParts:['kit_tanya', 'kit_tanya_centre'],hairParts:[ 'kit_tanya_hair' ],
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
      teamParts:['kit_tamirok', 'kit_tamirok_centre'],hairParts:[],
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
   {id: 'animalAzlar', name: 'Azlar', blurb: 'Fierce and loyal',
      src: 'assets/fuzeball_animalAzlar.glb', scale: 0.8,
      mug: 'assets/renders/render_azlar_mugshot.png',
      teamParts: ['kit_Azlar', 'kit_azlar_claws'], hairParts: ['kit_azlar_hair'],
      explosionSrc: 'assets/animations/azlar_explosion.glb'
   }
  ],
  // One-tap surface presets. authored:true = keep the values exported with the model.
  finishes:{
   default: {authored:true},
   matte:   {metalness:.05,roughness:.90,glow:0},
   satin:   {metalness:.15,roughness:.45,glow:0},
   plastic: {metalness:.0,roughness:.18,glow:0},
   metallic:{metalness:.75,roughness:.28,glow:.0},
   chrome:  {metalness:1.0,roughness:.06,glow:.0},
   neon:    {metalness:.25,roughness:.35,glow:0.10}
  },
  // Quick-pick kit colour swatches for the panel.
  swatches:['#ff0011','#ff8c3a','#fff94d','#00fa19','#2af5ff','#3d8bff','#5900ff','#ff2bd6','#f2ede2','#757983'],
  // Natural hair colours for random tinting.
  hairSwatches:[  '#1a1a1a','#2d1b0e','#3d2b1f','#5c4033','#8b6b47','#583b00','#985d29',
                  '#f6f1ba','#c49a6c','#aa7d53','#6b3f1a','#4a2c1a','#b8860b','#daa520','#cd853f'],
  cacheMax:6
 },

 /* ---- rod layout ----------------------------------------------------- */
 rods:{
  spacing:{ two:24, three:18.5, other:11.9 }, // per-man spacing by man-count
  margin:8.0,       // total z margin subtracted when deriving slide range
  gkSlide:11,     // keeper slide cap, keeping it inside its goal area
  wallClear:2.5,  // stick-out kept past the outer side wall at full inward slide
  handleLen:5,    // handle grip length (sits just outside the wall)
  collarLen:2.4,  // far-end collar/stopper width
  capOut:3,       // how far the bar tip pokes past the collar
   // Rod layout, 1-2-5-3 per side. x = position along the long axis; team 0 = red (attacks +x).
   // Optional slideCap overrides the computed max slide range for that row.
   defs:[
    {x:-52.5,team:0,men:1,role:'GK',slideCap:10},
    {x:-37.5,team:0,men:2,role:'DEF'},
    {x:-22.5,team:1,men:3,role:'ATT'},
    {x:-7.5, team:0,men:5,role:'MID'},
    {x: 7.5, team:1,men:5,role:'MID'},
    {x: 22.5,team:0,men:3,role:'ATT'},
    {x: 37.5,team:1,men:2,role:'DEF'},
    {x: 52.5,team:1,men:1,role:'GK',slideCap:10}]
 },

 /* ---- difficulty ----------------------------------------------------- */
 diffs:{
  //   speed       rod slide speed (u/s)
  //   react       smoothing on the ball's perceived position (hand wobble)
  //   reactDelay  reaction latency (s) — must stay under CONFIG.ai.reactMax
  //   err         wandering aim error · range  reach · pred  lead on the ball
  //   cd          kick cooldown multiplier · aim  goal accuracy 0..1
  //   iq          chance of making the smart choice 0..1
  rookie:{speed:30,react:.23,err:0.9,range:5.0,pred:.45,cd:0.9,aim:.5,iq:.40,reactDelay:.1},
  pro:   {speed:39,react:.18,err:0.75,range:5.8,pred:.7,cd:.75,aim:.65,iq:.55,reactDelay:.07},
  legend:{speed:43,react:.13,err:.55, range:6.6,pred:0.9,cd:.50,aim:.9,iq:.8,reactDelay:.04}
 },

 /* ---- rod stats (league builds) ---------------------------------------
    Six 0-10 stats per rod. base (5) is neutral — every multiplier is 1 there.
    Effects stack per point away from base. ---------------------------------- */
 stats:{
  base:5, max:10,
  spd:.07,            // rod slide speed ±7%/pt
  agil:.09,           // AI slide acceleration ±9%/pt of spd
  str:.08,            // ball hit impulse ±8%/pt
  ctl:.12,            // contact grip ±12%/pt (high = sticky touch, low = ball pings off)
  accErr:.14,         // AI wandering aim error −14%/pt above base
  accAim:.08,         // added to DIFFS.aim per pt above base
  assistBase:.045,    // aim-assist heading bend at base accuracy (rad)
  assistMax:.10,      // …and at max accuracy (rad)
  assistCone:.6,      // only bend shots already within this angle of goal centre (rad)
  assistMinVX:20,     // only bend shots moving goalward faster than this (u/s)
  rea:.10,            // AI reaction lag −10%/pt above base
  cd:.08,             // kick cooldown −8%/pt above base
  iq:.15,             // multiplier on the difficulty's iq roll, ±15%/pt
  predIq:.06,         // ball anticipation: scales the pred lead ±6%/pt of iq
  predFloor:.7,       // …floor on that scale, so low-iq rods still lead the ball
  // Stamina channel A — the clock: a uniform ramp over the match.
  fatStart:60, fatEnd:180,   // seconds where fatigue starts / reaches full
  fatMax:.25,        // total fatigue budget (max slow-down at sta=0); both channels share it
  // Stamina channel B — exertion: each swing costs the swinging rod, and bleeds off again.
  kickFat:{
   on:true,
   weight:.55,      // share of fatMax driven by swinging (the clock keeps the rest)
   per:1,           // exertion banked per swing
   full:30,         // swings at which this channel is fully spent
   recover:.12,     // exertion bled off per second
   cap:1.25,        // ceiling as a multiple of `full`
   userDrain:false  // whether human-held rods accrue it too
  }
 },

  /* ---- league mode ------------------------------------------------------ */
  league:{
    divSize:10,           // teams per division (even; 10 → 9 rounds)
    goals:5,              // goals to win a match (live and simulated), and the per-team cap when timed
    // Timed leagues sim each AI fixture with a random total-goal count in this range,
    // split by team strength and capped at `goals` per team. Level games go to a golden goal.
    simMinGoals:1,        // fewest total goals a simmed timed match can produce
    simMaxGoals:9,        // …and the most
    baseDiff:'rookie',    // brain difficulty for league teams; a division's `diff` overrides it
    upWin:3, upLoss:1, upCleanSheet:1, // upgrade parts awarded per result
    playerStart:10,       // parts the player starts a fresh league with
    cost:[1,2,3,5,8],    // cost of raising a stat from level 5+i
    tape:true, tapeT:3,   // pre-match splash on/off + duration (s); click to skip
    tapeReadyCap:2.5,     // max wait for the figurine portraits to decode first (0 = don't wait)
    graceT:10,             // seconds after match start where quitting does not forfeit
    simK:.5,              // sim: how steeply a stat edge shifts per-goal probability (logistic)
    divisions:[            // tier order: 0 bottom .. 2 top
      {name:'Sunday League', base:2, diff:'pro',   aiBudget:[5,10], room:'open',  skin:'sundayLeague',  table:'classic',  pitch:'pub_classic'},
      {name:'Pro League',    base:4, diff:'pro',      aiBudget:[5,10], room:'pub',   skin:'proLeague',  table:'classic',  pitch:'cork'},
      {name:'Premier League',base:5, diff:'legend',   aiBudget:[5,10], room:'arcade',  skin:'premierLeague',  table:'classic',  pitch:'royal'}
    ],
    promoteN:2, relegateN:2,  // top/bottom N swap between divisions each season
    upPromote1:5, upPromote2:3, // upgrade parts for a 1st / 2nd place promotion
    upChampTop:4,             // parts for winning the top division
    promoteBoost1:2, promoteBoost2:1, // stat-floor boost per still-at-base stat, 1st / 2nd place
    relegateLose:1,           // stat points removed from every stat per role block on relegation
    relegateFloor:1,          // a stat can't drop below this via relegation
    slots:6,                  // number of save slots
    // Zone-rating weights for the statistical sim (relative — lgRodScore normalizes).
    // offMix/defMix are the ATT-vs-MID and GK-vs-DEF shares.
    rate:{
       offMix:.6, defMix:.55,
       att:{str:.3,acc:.3,ctl:.2,spd:.1,rea:.05,sta:.05,iq:.12},
       mid:{spd:.25,ctl:.25,str:.15,acc:.15,rea:.1,sta:.1,iq:.12},
       gk: {rea:.35,spd:.25,ctl:.15,sta:.1,acc:.1,str:.05,iq:.06},
       def:{rea:.25,str:.25,spd:.2,ctl:.15,sta:.15,iq:.1}
    },
    // AI upgrade-spend weights per role, giving AI teams position-flavoured builds.
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
       'NET BUSTERS', 'LAST MINUTE FC', 'THE NUTMEGERS', 'HANDLEBAR HEROES', 'THE ROD SQUAD', 
       'SPIN MASTERSS', 'THE MISFITS', 'RELEGATION ROVERS', 'SLIDE TACKLERS', 'THE FOOSBAWLERS', 'TABLETOP TROOPERS'
    ],
    cols:[
       '#ff8c3a','#ffcf4d','#7dff8a','#2af5ff','#3d8bff','#74abff',
       '#a06bff','#ff2bd6','#c45ba9','#f2ede2','#cfa241','#ff5c2b',
       '#6d5551','#888888','#250d06','#00bfa5','#ff6e40','#8d6e63',
       '#d500f9','#76ff03','#1de9b6','#ff1744','#448aff','#ffab00',
       '#e040fb','#00e5ff','#b2ff59','#ff3d00','#40c4ff','#eeff41'
    ],
    colClash:80,     // RGB distance below which an AI colour is reassigned off the player's
   /* ---- champions cup (post-season KO for the top-division champion) -----
      Must stay inside `league` — it is read as CONFIG.league.cup. Has its own
      venue, independent of the Premier division's. ------------------------- */
   cup:{
      name:'Champions Cup',
      diff:'legend',
      seeded:true,     // false = random draw
      table:'arena', skin:'standard', room:'arcade', pitch:'champions_green', // venue; pitch is the fallback
      pitches:['champions_green','champions_purple'], // drawn per tie
      goals:5, special:true, power:true,
      poolSize:12, drawSize:7,                      // elite teams generated / drawn per cup (+ player)
      base:8, budget:[3,5],                       // elite build base + weighted spend
      enterParts:2, tieParts:2, winParts:8,         // parts for entering / winning a tie / lifting it
      rounds:['QUARTER-FINAL','SEMI-FINAL','FINAL'],   // must be log2(drawSize+1) long
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
  max:8,          // humans who can join one match, total
  perTeam:4,      // …and on one side (capped by the rod count, not CONFIG.ai.hands)
  maxPads:8,      // gamepad indices the lobby hands out ('pad0'…'pad{maxPads-1}')
  // HSL offset per seat on a side, so two players on one team are told apart.
  // Must be at least `perTeam` long — the last entry repeats.
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

  // Pickup look. A type listed in `models` floats as that GLB; anything else uses the gem.
  gem:{r:2.1, emissive:0.9, roughness:0.3},                    // fallback octahedron: radius, glow, roughness
  ring:{on:true, inner:2.6, outer:3.4, y:-2.8, opacity:0.55},  // ground halo (a model may opt out with ring:false)
  models:{
   on:true,                           // false = every pickup uses the procedural gem

   boost :{src:'assets/fuzeball_powerup_boost.glb', fit:2.4, scale:1, yaw:0, tilt:0, y:0, glow:0.5, shadow:true},
   freeze:{src:'assets/fuzeball_powerup_frost.glb', fit:2.4, scale:1, yaw:0, tilt:0, y:0, glow:0.5, shadow:true}
   // `big` has no entry yet, so it keeps the gem.
  }
 },

 /* ---- dead-ball recovery -------------------------------------------- */
  deadball:{
   // A ball is dead when its position stays inside a moveEps box for the given time —
   // measured by travel, not speed, so a ball held or spun against a wall still counts.
   moveEps:2,          // horizontal box the ball must roam wider than to count as in play (units)
   stallT:4.6,         // every ball boxed in this long → whistle + re-drop them all (s)
   wedgeT:2.2,         // multi-ball: one ball boxed in this long → re-drop just it (s)
   zoneMult:3,       // timer speed-up inside a table deadzone (1 = none)
   roofMult:3,       // …and for a ball settled on top of the goal (1 = none)
   // The OPPOSITE of a deadzone. While the ball sits somewhere a man could actually swing at
   // it, the dead-ball clock runs SLOWER — so you get room to trap it, pick the shot and go,
   // instead of being whistled for taking your time. Two rules keep it honest: it is a
   // discount and never a pause, and every ball has a budget (graceMax) that one stall can
   // spend. Without that ceiling this hands the smother exploit straight back, because a
   // keeper sat on the ball on his own line is inside his own hit range by definition.
   // A ball in a pocket, in a rod gap, or on the goal roof never earns it — those checks win.
   live:{
    on:true,
    mult:0.4,        // clock speed while the ball is strikeable (1 = no discount, 0 = frozen)
    graceMax:2.5,    // most extra REAL seconds one stall can earn (4.6s stall -> 7.1s at most)
    // The strikeable window around each man, measured from the rod and facing the way it kicks.
    // Mirrors CONFIG.ai.inFrontMax (6.3) and the back edge of the overFoot zone — the same
    // window the AI calls "at the feet or in front" — so what buys you time is what you can hit.
    ahead:6.3,       // units IN FRONT of the rod the ball still counts as strikeable
    back:1.5,        // …and behind it (a ball trapped tight against the boot)
    zPad:0.6         // slack on the z line-up, beyond footBox.z + BALL_R
   },
   // Dead lanes between the rows, where neither row's men can reach the ball.
   // One entry per gap as a plain x range; rods sit at ±7.5 / ±22.5 / ±37.5 / ±52.5.
   // Lanes run the full pitch width. Per-lane `mult` overrides the shared one.
   rodGaps:{
    on:true,
    mult:2,   // timer speed-up inside a lane (gentler than zoneMult — a rod can still nudge it)
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
   // Where a dead or out-of-play ball comes back in. Each zone is a face-off spot between
   // two opposing rows: `x` is the spot, `spread` the random jitter, `from` the stretch of
   // pitch it serves. The `from` ranges must tile the table with no gaps.
   redrop:{y:30,z:16,vel:30,  // drop height, z spread, launch speed
    sameThird:true,           // re-drop in the third the ball died in (false = random zone)
    zones:[
     {x:-30,spread:5,from:[-999,-20]},  // def vs att · red's own third
     {x:0,  spread:5,from:[-20,20]},    // mid vs mid · middle third
     {x:30, spread:5,from:[20,999]}     // att vs def · blue's own third
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
  // Modes anchored to one end: these mirror when every human is on the blue team.
  sideModes:[1,4,5,6,7,8],
  // …of those, the ones with no mirror partner, so they drop out of the cycle
  // when no single team owns the camera (humans on both sides, or spectating).
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
    removeDuration:20,  // seconds the nearest player is removed after the explosion
   fractureFadeOut:.5,// seconds fracture debris fades out before disposal (players and ball)
   // --- ball self-fracture ---
   explosionSrc:'assets/animations/cannonball_explosion.glb', // baked ball fracture GLB, one clip per shard
   fractureLife:1.9,   // seconds the ball debris lives (keep ≥ the baked clip length)
   fractureScale:1,    // scale for the ball-fracture instance
   // --- respawn swirl: particles rising to the rod before a removed player reforms ---
   respawnSwirlSrc:'assets/animations/swirl_particles.glb', // baked particle GLB, shared by every figurine
    respawnLead:5,          // seconds before the player reforms that the swirl starts (0 = use the clip length)
    respawnSwirlTail:2.6,   // seconds the swirl keeps playing after the player reforms
    respawnSwirlFit:true,   // true = stretch the clip to play once across the whole window; false = loop
   respawnSwirlScale:1,    // scale for the swirl instance
   respawnSwirlY:0,        // world-Y the swirl is seated at (0 = floor)
     respawnSwirlFadeOut:1.6, // seconds the swirl spends dimming at the end of its life
     respawnSwirlLight:3.6,  // peak intensity of the team-tinted light riding the swirl (0 = none)
     respawnSwirlTint:true,   // recolour the swirl meshes to the team kit colour
     respawnSwirlEmissive:1,  // team-colour multiplier written into emissive when tinting
     respawnSwirlTintParts:null, // null = tint everything, or an array of material names to limit it
     respawnFade:2.6          // seconds the returning figurine fades in from transparent
  },

  /* ---- audio mix (js/audio.js) -----------------------------------------
       master   final gain into the limiter
       limiter  sum-then-squeeze stage so simultaneous hits duck instead of clipping
       voices   per-sound retrigger cooldown (gap, s) + concurrent cap (max)
       jitter   ± pitch randomisation per one-shot (signature sounds are exempt)
       roll     the sustained-contact layer; def.* is the per-ball fallback character
     ---------------------------------------------------------------------- */
  audioMix:{
   master:0.55,
   limiter:{on:true,threshold:-7,knee:8,ratio:10,attack:0.004,release:0.15},
   voices:{wall:{gap:0.055,max:4},kick:{gap:0.02,max:6},post:{gap:0.05,max:3},react:{gap:0.25,max:2}},
   jitter:{pitch:0.16},
   roll:{
    on:false,
    speedMin:4,        // tangential speed where the roll fades in
    speedRef:80,       // …and where it hits full level
    curve:0.6,         // gain = norm^curve (<1 = loud early)
    attack:0.030, release:0.16,   // gain smoothing time constants (s)
    rateBase:0.55, rateScale:0.85, // noise grain playback rate: base + norm×scale
    def:{floor:{vol:0.0,freq:450,freqScale:2.0,q:0.7},
         wall: {vol:0.12,freq:620,freqScale:11.0,q:1.5}}
   }
  },

/* ---- ball types ----------------------------------------------------- */
  // Per ball: name (HUD copy, keep it emoji-free), colour, mass, max speed, trail.
  // The optional `audio` block overrides the synthesised contact sounds for that ball;
  // every field is optional and falls back to the defaults in audio.js.
  ballTypes:{
   classic:{
      name:'CLASSIC',col:0xf2ede2,em:0x000000,
      mass:1.25,maxV:135,w:70,trail:'#ffffff',
      audio:{
         kick:{noiseDur:.06,noiseFreq:380,noiseFreqScale:12,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
               beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.25,beepSlide:-45},
         // Wall/floor tap. noiseVol is the quietest audible tap, noiseVolScale how fast it
         // grows with impact speed; body* adds a low thump under hard hits.
         wall:{noiseDur:.045,noiseFreq:2200,noiseFreqScale:4,noiseVol:.012,noiseVolScale:.0035,noiseVolMax:.30,q:.9,
               bodyFrom:55,bodyFreq:150,bodyDur:.055,bodyVolScale:.0016,bodyVolMax:.16,bodySlide:-55},
         // Sustained-contact roll: warm floor, thin bright scrape.
         roll:{floor:{vol:.26,freq:250,freqScale:5.0,q:.7},
               wall: {vol:.20,freq:620,freqScale:11,q:1.5}},
         post:{noiseDur:.03,noiseFreq:3200,noiseVolScale:.5,freqs:[523,832,1290,1900],droop:.94,
               attack:.003,decay:.28,vol:.14,volScale:.004,volMax:.5}
      }
   },
   fire:   {name:'FIREBALL',col:0xff6a1f,em:0xff2200,
      mass:1,maxV:100,w:14,trail:'#ff8c3a',light:0xff5500,markMul:1.5,   // scorches harder than a rubber scuff
      audio:{
         kick:{noiseDur:1.2,noiseFreq:8000,noiseFreqScale:14,noiseVol:.07,noiseVolScale:.05,noiseVolMax:.22,
               beepFreq:1500,beepDur:.6,beepType:'sine',beepVol:.0,beepVolScale:.002,beepVolMax:.0,beepSlide:-80,attack:.08,decay:1.1,},
         wall:{noiseDur:.05,noiseFreq:2800,noiseFreqScale:6,noiseVol:.014,noiseVolScale:.0025,noiseVolMax:.16,q:.7,
               bodyFrom:70,bodyFreq:120,bodyDur:.07,bodyVolScale:.0012,bodyVolMax:.10,bodySlide:-40},
         roll:{floor:{vol:.30,freq:420,freqScale:7,q:.5},          // airy hiss
               wall: {vol:.24,freq:1100,freqScale:16,q:.9}},
         post:{noiseDur:.04,noiseFreq:4000,noiseVolScale:.6,freqs:[587,932,1397,2100],droop:.93,
               attack:.003,decay:.8,vol:.15,volScale:.005,volMax:.35}
      }
   },
   cannon: {
      name:'CANNONBALL',col:0x000000,em:0x000000,
      mass:7,maxV:60,w:30,trail:'#000000',
      audio:{
         kick:{noiseDur:.15,noiseFreq:640,noiseFreqScale:4,noiseVol:.003,noiseVolScale:.004,noiseVolMax:.2,
               beepFreq:70,beepDur:.2,beepType:'sine',beepVol:.08,beepVolScale:.005,beepVolMax:.25,beepSlide:-30},
         wall:{noiseDur:.075,noiseFreq:900,noiseFreqScale:2.5,noiseVol:.02,noiseVolScale:.004,noiseVolMax:.38,q:1.1,
               bodyFrom:30,bodyFreq:85,bodyDur:.12,bodyVolScale:.0028,bodyVolMax:.30,bodySlide:-30},
         roll:{floor:{vol:.42,freq:130,freqScale:2.2,q:1.0},       // low grinding rumble
               wall: {vol:.34,freq:300,freqScale:5,q:1.8}},
         post:{noiseDur:.04,noiseFreq:2200,noiseVolScale:.4,freqs:[328,523,784,1100],droop:.95,
               attack:.004,decay:.32,vol:.2,volScale:.006,volMax:.6}
      }
   },
   split:  {
      name:'SPLIT BALL',col:0xa46bff,em:0x4a18b8,
      mass:1.5,maxV:140,w:6,splits:true,trail:'#c39bff',
      audio:{
         kick:{noiseDur:.06,noiseFreq:380,noiseFreqScale:12,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
            beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.25,beepSlide:-45},
         // Wall/floor tap. noiseVol is the quietest audible tap, noiseVolScale how fast it
         // grows with impact speed; body* adds a low thump under hard hits.
         wall:{noiseDur:.045,noiseFreq:2200,noiseFreqScale:4,noiseVol:.012,noiseVolScale:.0035,noiseVolMax:.30,q:.9,
               bodyFrom:55,bodyFreq:150,bodyDur:.055,bodyVolScale:.0016,bodyVolMax:.16,bodySlide:-55},
         // Sustained-contact roll: warm floor, thin bright scrape.
         roll:{floor:{vol:.26,freq:250,freqScale:5.0,q:.7},
               wall: {vol:.20,freq:620,freqScale:11,q:1.5}},
         post:{noiseDur:.03,noiseFreq:3200,noiseVolScale:.5,freqs:[523,832,1290,1900],droop:.94,
               attack:.003,decay:.28,vol:.14,volScale:.004,volMax:.5}
      }
   },
   knuckle: {
      // Flutter ball: its side-spin is re-rolled on a short timer so the flight weaves.
      // No GLB mesh slot, so it renders as a glowing-cyan sphere.
      name:'KNUCKLEBALL',col:0x5be0ff,em:0x0a3a66,
      mass:1.0,maxV:100,w:12,trail:'#8fe8ff',light:0x33cfff,
      knuckle:{every:[0.11,0.26], kick:1.5, max:2.2}, // re-roll spin every [lo,hi]s by ±kick, clamped to ±max
      audio:{
       kick:{noiseDur:.05,noiseFreq:1200,noiseFreqScale:6,noiseVol:.05,noiseVolScale:.0025,noiseVolMax:.3,
             beepFreq:100,beepDur:.1,beepType:'sine',beepVol:.07,beepVolScale:.03,beepVolMax:.24,beepSlide:60},
       wall:{noiseDur:.045,noiseFreq:2600,noiseFreqScale:5,noiseVol:.011,noiseVolScale:.0032,noiseVolMax:.26,q:1.0,
             bodyFrom:58,bodyFreq:165,bodyDur:.05,bodyVolScale:.0014,bodyVolMax:.14,bodySlide:-60},
       roll:{floor:{vol:.24,freq:290,freqScale:6,q:.8},
             wall: {vol:.19,freq:780,freqScale:13,q:1.7}},
       post:{noiseDur:.03,noiseFreq:3400,noiseVolScale:.5,freqs:[622,988,1480,2200],droop:.93,
             attack:.003,decay:.26,vol:.13,volScale:.004,volMax:.48}
      }
   },
   golden: {
      name:'GOLDEN BALL · ×2',col:0xffc933,em:0x7a5200,
      mass:3,maxV:140,w:3,value:2,trail:'#ffd75e',metal:.85,
      audio:{
         kick:{noiseDur:.055,noiseFreq:1500,noiseFreqScale:3,noiseVol:.04,noiseVolScale:.0025,noiseVolMax:.38,
               beepFreq:500,beepDur:.085,beepType:'triangle',beepVol:.09,beepVolScale:.0035,beepVolMax:.28,beepSlide:-40},
         wall:{noiseDur:.05,noiseFreq:2000,noiseFreqScale:3.5,noiseVol:.013,noiseVolScale:.0034,noiseVolMax:.28,q:2.2,
               bodyFrom:45,bodyFreq:190,bodyDur:.09,bodyVolScale:.0020,bodyVolMax:.20,bodySlide:-25},
         roll:{floor:{vol:.30,freq:200,freqScale:4,q:1.4},         // dense and ringy
               wall: {vol:.25,freq:900,freqScale:9,q:3.0}},
         post:{noiseDur:.028,noiseFreq:3000,noiseVolScale:.48,freqs:[587,880,1319,1760],droop:.93,
               attack:.003,decay:.26,vol:.15,volScale:.0045,volMax:.52}
      }
   },
  },

  /* ---- ball reflections (local cube-map) -------------------------------
     A cube camera rides the lead ball so metallic balls reflect the real scene.
     Costs one extra scene pass; also gated by the Options 'Reflections' toggle.
        on         master switch. Off = balls keep the distant room bake (scene.environment)
                   and the extra pass never runs, i.e. exactly the Reflections-off look.
        res        cube face resolution. 32 is the ball-sized balance, 256 sharper + costlier;
                   anything tiny (this sat at 8 for a while) is a mush, not a saving worth having
                   — the pass costs what it costs, the face size is nearly free by comparison.
        every      update the cube every Nth frame
        near/far   cube camera clip range (must span the table + room)
        intensity  reflection strength on the ball. Applied ONLY while the cube map is bound —
                   see setBallEnv, which restores each material's authored value on the way out. */
  ballReflect:{on:true,res:32,every:2,near:1,far:300,intensity:1},

  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:true,  // true = use the ball GLB, false = a generated sphere
   fractureFx:true,     // false = skip the explosion GLBs and vanish instantly
   roomEditor:false,
        // true = F2 opens the room editor (js/roomedit.js)
  },

 /* ---- power-up types ------------------------------------------------- */
 // `col` is the pickup mesh/particle colour; the HUD mark comes from FX_ICO in hud.js.
 puTypes:[
   {key:'boost',label:'POWER HITS',col:0xfff04d},
   {key:'freeze',label:'RIVALS FROZEN',col:0x7ae4ff},
   {key:'big',label:'BIG GOAL',col:0x7dff8a}
 ],

 /* ---- renderer / light transfer -------------- */
 render:{
   toneMapping:'reinhard',        // 'none' | 'aces' | 'reinhard' | 'cineon' | 'linear'
   exposure:1.08,
   roomLight:{ gain:0.8, reach:3, decay:2, minDist:20, max:0 },
   roomLightPool:{ pad:{point:1,spot:1,dir:0}, max:12, shadow:{point:1,spot:2,dir:0} },
   
   shadow:{ bias:-0.0002, normalBias:0.35, left:-76, right:76, top:80, bottom:-80, far:260,
            type:'pcf', mapSize:2048, autoUpdate:false, roomMapSize:1024, casterFrac:0.5,
   
            quality:{
              low :{ mapSize:2048, type:'pcf', radius:1, bias:-0.0002, normalBias:0.35, casterFrac:0.5 },
              high:{ mapSize:1024, type:'vsm', radius:6, bias:0,       normalBias:0.15, casterFrac:0   }
            } },
   idle:{ on:true, hz:4, settle:0.4, phases:['menu'], camEps:0.01, camRotEps:1e-4 }
 },


 /* ---- props (assets/props/) -------- */
 props:{
   on:true,
   folder:'assets/props/',
   manifest:'manifest.json',
   seed:1,
   maxInstances:2048,
   defaults:{ fit:0, scale:1, yaw:0, ground:true },
   lib:{}     // e.g. stool:{src:'pub_stool.glb', fit:11}
 },
 /* ---- rooms / locations ---------- */
  rooms:{
   open:{
      name:'Void', folder:'na', glb:'fuzeball_room_void.glb', backdrop:false, reflect:false,
      bg:0x05060f, fog:[210,440],
      hemi:{sky:0xcdd9ff,ground:0x1c1610,int:0.9},
      dir:{color:0xffffff,int:0.7,pos:[45,100,35]},
      env:{shell:0x0b1022,panels:[[0x18e0ff,-250,30,-110,260,120],[0xff2bd6,250,30,110,260,120],[0x9b6bff,0,150,-250,340,90],[0xffffff,0,155,0,150,150]]},
      lights:[
         {type:'spot', pos:[-55,26,31], look:[-40.0,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32},
         {type:'spot', pos:[0,36,0], look:[0,0,0], color:0xffffff, int:1.35, dist:210, decay:1.1, angle:0.68, penumbra:0.12},
         {type:'spot', pos:[55,26,31], look:[40.0,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32}],
      props:[],
      led:{idle:'rainbow'}
   },
   saucer:{
      name:'Flying Saucer', folder:'assets/rooms/saucer/', glb:'fuzeball_room_saucer.glb', reflect:true,
      light:{gain:0,reach:0},
      bg:0x05060f, fog:[210,540],
      hemi:{sky:0xcdd9ff,ground:0x1c1610,int:0,on:false},
      dir:{color:0xffffff,int:1.27,pos:[45,100,35],on:true},
      lights:[
        {type:'spot', pos:[-55,26,31], look:[-40,0,0], color:0xc7e4ff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xffffff, int:2.2, dist:70, decay:0.6, angle:0.68, penumbra:0.12, shadow:true},
        {type:'spot', pos:[55,26,31], look:[40,0,0], color:0xb3daff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true}
      ],
      props:[],
      led:{idle:'rainbow'}
   },
   pub:{
      name:'British Pub', folder:'assets/rooms/pub/', glb:'fuzeball_room_pub.glb', reflect:true,
      light:{gain:3.6,reach:3.2},
      bg:0x120c07, fog:[190,410],
      hemi:{sky:0xffd9a3,ground:0x140a04,int:0,on:false},
      dir:{color:0xffcf95,int:1.31,pos:[40,90,30]},
      env:{shell:0x1a1108,panels:[[0xffa94d,-240,40,-100,260,140],[0xff7b2e,240,40,100,260,140],[0xffe6c0,0,150,0,160,160]]},
      lights:[
        {type:'spot', pos:[-55,26,31], look:[-40,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xffffff, int:2.2, dist:70, decay:0.6, angle:0.68, penumbra:0.12, shadow:true},
        {type:'spot', pos:[55,26,31], look:[40,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true}
      ],
      props:[],
      led:{idle:'rainbow',color:0xffb454}
   },
   arcade:{
      name:'Neon Arcade', folder:'assets/rooms/arcade/', glb:'fuzeball_room_arcade.glb', reflect:false,
      light:{gain:0,reach:0.2},
      bg:0x5c5d60, fog:[170,465],
      hemi:{sky:0x8ea0ff,ground:0x180a24,int:0.52,on:false},
      dir:{color:0xd6b8ff,int:1.07,pos:[45,100,35],on:true,shadow:true},
      env:{shell:0x0b1022,panels:[[0x18e0ff,-250,30,-110,260,120],[0xff2bd6,250,30,110,260,120],[0x9b6bff,0,150,-250,340,90],[0xffffff,0,155,0,150,150]]},
      lights:[
        {type:'spot', pos:[-57.14,26,0], look:[-40,0,0], color:0x28aeca, int:2.35, dist:55, decay:2, angle:0.76, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xf2e9ba, int:2.65, dist:70, decay:1, angle:0.74, penumbra:0.24, shadow:true},
        {type:'spot', pos:[55.1,26,0], look:[40,0,0], color:0xaf71ba, int:2.35, dist:55, decay:2, angle:0.76, penumbra:0.32, shadow:true}
      ],
      props:[
        {prop:'fuzeballArcadeStool', at:[
          [-14.96,-44,-127,0,1],
          [-127.08,-44,-128.44,0,1],
          [135.61,-44,-132.4,0,1]], jitter:{x:5,z:8.5}, seed:6},
        {prop:'fuzeballArcadeTable', at:[
          [301.67,-44,-134.09,-0.0016,0.93],
          [92.31,-44,-180.03,1.608,0.93],
          [300.91,-44,-147.26,-0.0016,0.93]], jitter:{x:122.5,z:4}},
        {prop:'fuzeballPlayerGrimlotLowPoly', at:[[37.28,14,-187.84,0.528,1]]}
      ],
      led:{idle:'rainbow'}
   },
  },
  // Legacy theme-key → room-id map, for old saves.
  themeToRoom:{classic:'open',royal:'pub',verdant:'open',neon:'arcade',cyatron:'arcade'},

  /* ---- pitches ------- */
  pitches:{
   pub_classic:      {folder:'assets/pitches/', glb:'pitch_pub_classic.glb',      tex:'pitches/pubClassic.jpeg',      name:'Pub Classic'},
   cork:             {folder:'assets/pitches/', glb:'pitch_cork.glb',             tex:'pitches/cork.jpeg',            name:'Cork'},
   royal:            {folder:'assets/pitches/', glb:'pitch_royal.glb',            tex:'pitches/royal.jpeg',           name:'Royal Grass'},
   cyatron:          {folder:'assets/pitches/', glb:'pitch_cyatron.glb',          tex:'pitches/cyatron.jpeg',         name:'Cyatron Grid'},
   neon:             {folder:'assets/pitches/', glb:'pitch_neon.glb',             tex:'pitches/neon_nights.jpg',      name:'Neon Nights'},
   verdantia:        {folder:'assets/pitches/', glb:'pitch_verdant.glb',          tex:'pitches/verdantia.jpeg',       name:'Verdantia'},
   champions_green:  {folder:'assets/pitches/', glb:'pitch_champions_green.glb',  tex:'pitches/champions_green.png',  name:'Champions Green'},
   champions_purple: {folder:'assets/pitches/', glb:'pitch_champions_purple.glb', tex:'pitches/champions_purple.png', name:'Champions Purple'},
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
   // Resident PointLights effects borrow from, keeping the scene's light count constant
   // (changing it forces a shader recompile). Overflow just drops the extra glow.
   lightPool:3,
   warmMatch:true, // true = compile every fx a match can fire before kickoff
  
   marks:{
    on:true,
    count:28,                      // marks on screen at once
    minImp:34, fullImp:80,         // softest hit that leaves anything / hit that leaves the most
    sizeMin:1.3, sizeMax:4.0,      // mark width in table units (the ball is 3.8 across)
    alphaMin:0.22, alphaMax:0.52,  // how dark: softest hit -> hardest
    streak:0.02, streakMax:2.4,    // how much sideways travel smears it / longest smear, x its width
    tilt:22,                       // degrees a square-on hit may lean, so no two look stamped
    hold:36, fade:5,                // seconds at full strength, then seconds fading away
    lift:0.25                      // how far it floats off the wall (stops the two z-fighting)
    // NO COLOUR HERE ON PURPOSE. A mark multiplies the wall down rather than painting on it,
    // so it has no colour to get wrong and can never lighten a dark wall or a dark skin.
    // A ball type that should burn harder sets `markMul` on itself instead (see fire).
   } },

 /* ---- training mode (js/training.js) ---------------------------------- */
 training:{
  spawn:{x:0,z:0},                   // where the first ball drops on entering training
  launch:{speed:60,angle:0,loft:10},  // launcher defaults: speed u/s · angle° (0 = toward +x) · loft u/s
  speedMax:200,                      // launcher speed/loft clamp (keep ≤ ball maxV)
  clampMargin:2,                     // placed balls are clamped this far inside the walls
  ringColor:0x2bff88                 // click-place ghost ring + panel accent
 },

 /* ---- skill trials (js/trials.js) -------------------------------------
    FEATURE-IDEAS 3.2. A trial is training mode with a rulebook on top: a pinned setup, a
    sim-time clock and one objective. What makes it a CHALLENGE rather than a coin toss is
    'seed' (js/rng.js) — every attempt replays the same ball, the same bounce, the same AI.

    A TRIAL SPEC:
      id      unique key. cfg.trials[id] stores the personal best, so DON'T rename one.
      cat     which DISCIPLINE section the trial is filed under on #trials — one of the ids in
              `cats` below. A pure grouping key: nothing in the runner reads it, so re-filing a
              trial changes only where it is listed and never what it scores or what it stored.
              A trial with a missing or unknown cat would simply never appear in the list — a
              silent disappearance, which is exactly why the harness asserts coverage both ways.
      seed    the sim seed every attempt runs on. Change it and you have a different trial
              wearing the same name — and every stored best silently becomes a lie.
      table   pinned for the run, because the table picks the COLLISION MODEL ('bowl' is a
              wholly different physics path; 'circuit' adds solid end walls). The player's
              table is parked and handed back on the way out of trials land; skin/room/pitch
              change no physics, so theirs are left alone.
      ball    {type,x,z,vx,vy,vz} spawn — clamped inside the walls by training.js.
      hold    role the player is locked to ('ATT'), or null to let them switch freely.
      rods    {show:['<team>|<role>', …]}. Anything not listed is hidden and cannot be hit.
              The player is ALWAYS team 0 in training mode, so 0|* is yours and 1|* is theirs.
              A shown OPPONENT rod with the AI off is a static obstacle — that is the point.
      ai      [team0,team1] AI on/off. Default [false,false]. An opponent rod with its AI OFF is
              a STATIC obstacle; with it ON it is a real opponent — and then 'diff' matters.
      diff    'rookie'|'pro'|'legend', pinned for the run (teamDiff, js/league.js reads it FIRST).
              A trial whose opponent plays at whatever the player last picked in Kick Off is not
              a trial: two players' times would not be comparable. Nothing persists it.
      goal    one of:
                {kind:'goals',n}            n goals at the far end
                {kind:'roleGoals',roles:[…]} one goal struck by each named rod of yours
                {kind:'stat',stat,n}        n of any MATCH LEDGER counter (S.stats[stat][0]) —
                                            'woodwork','saves','passes','shots','onTarget','kicks'.
                                            Scoring does NOT complete a stat trial; the counter does.
                {kind:'saveRun',n,          THE GK KIND. n ATTACKS on your goal, served one at a
                  attemptT,serveDelay,      time; the score is how many you KEEP OUT. Read the
                  spawns:[{x,z},…]}         'ON A saveRun' block below before touching a number.
      limit   seconds; 0 = stopwatch, no failure state. A saveRun wants 0 — it ends when its
              attempts run out, not on a clock.
      medals  ELAPSED SIM SECONDS, LOWER is better… EXCEPT for a 'saveRun', where they are SAVES
              and HIGHER is better, so gold is the BIGGEST number and the block reads downward.
              trialDir (js/trials.js) derives the direction from the objective KIND rather than
              taking it as a field, so a spec cannot ship a metric and a direction that disagree.

    ON THE DISTANCES, because the obvious worry about them is wrong: floor friction is
    exp(-0.35t), so a strike's MAXIMUM roll is v0/floorFric — about 125 units off an ordinary
    ~44 u/s contact, against a table only 120 long. A shot from your own DEF rod therefore does
    reach the far goal; it just arrives slowly. That is what makes the deep-rod objective in
    'fullset' possible at all, and it is the number to redo if floorFric ever moves.

    ON A 'saveRun', because every number in one is derived rather than chosen:

    · AN ATTEMPT IS ONE SERVED BALL, settling on the FIRST of a SAVE, a GOAL CONCEDED, or
      `attemptT` sim seconds. Settling on the FIRST outcome is what makes "7 / 10" mean anything:
      the ball is taken away the instant the attempt is decided, so a rebound cannot bank a second
      save off one attempt and the score can never outrun the attempts. `attemptT` is a FAILSAFE
      and not the normal exit — it covers a shot that misses and rattles about off the end wall, a
      ball the dead-ball timer re-drops, and an attacker that dawdles. `serveDelay` is the beat
      between one attempt settling and the next ball going down, and it runs before the FIRST one
      too, so every attempt in the run opens identically.

    · THE BALL IS SERVED ON THE OPPONENT'S ATTACK LINE, AND THAT IS FORCED BY THE SAVE DETECTOR
      rather than chosen for feel. momSaveTest (js/moments.js) only credits a save when the ball
      reaches the keeper closing at CONFIG.moments.save.minSpeed (24 u/s) in x, and momOnTarget
      refuses a projection needing longer than moments.target.maxT (1.6s) to reach the goal plane.
      Floor friction is exp(-0.35t), so measured against an ordinary ~44 u/s strike:
          their ATT (-22.5) -> reaches the keeper at 33.5 u/s after 0.78s   COUNTS
          their MID  (+7.5) -> reaches it at         23.0 u/s after 1.85s   under minSpeed
          their DEF (+37.5) -> projection is 2.22s                          over maxT
      A shot from the midfield line is therefore BLOCKED BUT NEVER CREDITED, which reads as the
      trial being broken rather than as it being hard. The attack line is the only one that works
      at ordinary pace, and that is why there is no 'shoot from deep' variant.

    · `spawns` VARIES THE ANGLE, NOT THE RANGE, for the same reason: x stays inside the attacking
      rod's own strike band and z is the thing that moves. It is AUTHORED rather than rolled so
      the harness can sample every entry against the live geometry, and so two players face the
      same balls in the same order. Kept inside +/-10 in z: from the corner of that band a shot
      across the face still reaches the keeper at ~29 u/s, and wider than that the x-component
      starts dipping under the 24 the detector needs.
    ---------------------------------------------------------------------- */
 trials:{
  on:true,
  pinTable:true,     // apply the trial's table for the run, give the player's back on the way out
  // Beat between the world freezing on the result and the result panel appearing (s). The freeze
  // is instant — a 'stat' trial must not bank another woodwork after it is won — so this delays
  // only the UI, which lets the goal sound and the confetti land before a panel covers them.
  resultDelay:0.8,

  /* ---- the five disciplines (#trials tab strip, renderTrials in js/trials.js) ----
     A SECTION IS A FILTER OVER `list`, NOT A SECOND LIST. Every trial still lives in the one
     flat array below, so trialById, the daily templates, the personal-best map and the harness
     all keep working untouched, and re-filing a trial under a different tab cannot orphan its
     stored best. The alternative — a list per section — would have made `from:'snap'` in the
     daily templates ambiguous and given cfg.trials two places for one id to hide in.

     GK / DEF / MID / ATT ARE THE ROD ROLES, deliberately: the tab tells you which handle the
     trial is about before you have read a word of the blurb, and `rods.show` in each spec below
     uses the very same strings. TEAM is the one that isn't a rod — it is the section for trials
     that need more than one of yours on the table at once.
       id    the value a trial's `cat` names, and the tab's label
       name  the section headline, shown above the list
       sub   one line under it — what this discipline is FOR, not what the trials are  */
  cats:[
   {id:'GK',  name:'GOALKEEPER',sub:'Handle it, then start the move'},
   {id:'DEF', name:'DEFENCE',   sub:'Win it back, then play it long'},
   {id:'MID', name:'MIDFIELD',  sub:'Keep the ball moving'},
   {id:'ATT', name:'ATTACK',    sub:'Finish, and finish fast'},
   {id:'TEAM',name:'TEAM',      sub:'The whole rack, working as one'}
  ],

  list:[
   /* ---- GK ---------------------------------------------------------------
      DISTRIBUTION IS THE PASSING HALF OF THE KEEPER'S JOB. GK sits at -52.5 and DEF at -37.5 —
      15 units, which an ordinary ~44 u/s strike covers in about a third of a second, comfortably
      inside MSTAT.passT (2.5s). Same geometry ONE-TWO already proves out, at half the distance. */
   {id:'distro',name:'DISTRIBUTION',cat:'GK',blurb:'Play it out from the back. Six clean balls between your keeper and your defence.',
    seed:70669,table:'classic',
    ball:{type:'classic',x:-48,z:0},
    hold:null,rods:{show:['0|GK','0|DEF']},
    goal:{kind:'stat',stat:'passes',n:6},limit:45,
    medals:{gold:15,silver:25,bronze:40}},

   /* THE SHOT-STOPPING TRIAL THIS SECTION WAS WAITING FOR. The note that used to sit above
      DISTRIBUTION said a save trial needed two mechanics rules before it could exist — a clock
      that does not depend on the player swinging, and something to stop "make 3 saves" being
      passed by standing still. The 'saveRun' kind answers both with ONE rule rather than two: the
      run is N SERVED ATTACKS and the score is how many you kept out, so the clock stops being the
      metric and a keeper who does nothing simply finishes on 0.
      THE WHOLE OF THEIR TEAM IS ON THE TABLE and yours is one rod. Their keeper and defence never
      see the ball at this range; what they are there for is that a save is not a free clearance —
      the rebound has somewhere to go and someone to go to, which is the difference between this
      and a shooting-machine drill. Ten attempts at ~0.8s of flight each, so a run is short enough
      to go again immediately, which is the whole appeal of a score-out-of-n. */
   {id:'lastline',name:'THE LAST LINE',cat:'GK',blurb:'Ten attacks, one keeper, no defenders. Keep out as many as you can.',
    seed:96331,table:'classic',
    ball:{type:'classic',x:-27.2,z:0},
    hold:'GK',rods:{show:['0|GK','1|GK','1|DEF','1|MID','1|ATT']},
    ai:[false,true],diff:'pro',
    goal:{kind:'saveRun',n:10,attemptT:14,serveDelay:1.2,
     /* x stays inside their ATT rod's own strike band (-28.8 .. -25.8: clear of its resting foot
        box at the near end, inside CONFIG.ai.inFrontMax at the far one); z is the variable, and
        it walks out from the middle so the run RAMPS. See the 'ON A saveRun' note above for why
        the band is this narrow and why it is the attack line rather than the midfield one. */
     spawns:[
      {x:-27.2,z:  0},{x:-26.6,z: -4},{x:-27.6,z:  5},{x:-26.8,z: -8},{x:-28.0,z:  9},
      {x:-26.4,z: -2},{x:-27.4,z: 10},{x:-26.9,z:-10},{x:-28.2,z:  6},{x:-27.0,z: -7}
     ]},
    limit:0,
    /* SAVES, and HIGHER is better — gold is the biggest number here, unlike every other trial in
       this file. MEASURED FLOOR: a keeper nobody is driving, parked on its line, still finishes on
       2-3 of 10, because the men block whatever is aimed near them. Bronze has to clear that or it
       is handed out for doing nothing, which is the same hole "make 3 saves" had. Everything above
       bronze is still an unplayed first cut. */
    medals:{gold:9,silver:7,bronze:5}},

   /* ---- DEF --------------------------------------------------------------
      The long strike, and the trial the friction note above exists for: -37.5 to the far line at
      +60 is 94 units against a maximum roll of ~125, so the ball DOES arrive — at about 11 u/s,
      after roughly four seconds in transit. That travel time is most of the medal spread, which
      is why the thresholds here are so much softer than SNAP SHOT's for what looks like the same
      objective. The opponent keeper is shown with its AI OFF: a static obstacle sitting central,
      so a ball rolled straight down the middle is stopped and the trial is about placement rather
      than about power. Two goals rather than one on purpose — a single long ball that happens to
      miss the keeper is luck, twice is aim. */
   {id:'longball',name:'THE LONG BALL',cat:'DEF',blurb:'Twice from your own defence, past a keeper who never moves.',
    seed:83117,table:'classic',
    ball:{type:'classic',x:-34,z:0},
    hold:'DEF',rods:{show:['0|DEF','1|GK']},
    goal:{kind:'goals',n:2},limit:60,
    medals:{gold:18,silver:30,bronze:48}},

   /* ---- MID --------------------------------------------------------------
      A pass is a teammate ROD receiving what another of yours STRUCK, within MSTAT.passT (2.5s).
      MID and ATT sit 30 units apart, which an ordinary strike covers in ~0.8s — comfortably
      inside that window, and the reason those two are the pair. */
   {id:'onetwo',name:'ONE-TWO',cat:'MID',blurb:'Five completed passes between your midfield and your attack.',
    seed:52733,table:'classic',
    ball:{type:'classic',x:-3,z:0},
    hold:null,rods:{show:['0|MID','0|ATT']},
    goal:{kind:'stat',stat:'passes',n:5},limit:45,
    medals:{gold:18,silver:28,bronze:40}},

   /* ---- ATT --------------------------------------------------------------
      The section that ramps: an empty net, then a static keeper, then the frame, then a keeper
      that actually plays. List order IS the order the tab shows them in, so keep it a curve. */
   {id:'snap',name:'SNAP SHOT',cat:'ATT',blurb:'One ball, one empty net. How fast can you put it away?',
    seed:10231,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT']},
    goal:{kind:'goals',n:1},limit:0,
    medals:{gold:2,silver:3.5,bronze:6}},

   {id:'keeper',name:"KEEPER'S NIGHTMARE",cat:'ATT',blurb:'Three past a keeper who never moves. Find the corners.',
    seed:20477,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT','1|GK']},
    goal:{kind:'goals',n:3},limit:40,
    medals:{gold:12,silver:20,bronze:32}},

   // Woodwork is detected in js/moments.js and NOWHERE else, and momOn() gates on the training
   // mode — which is why it carries an explicit S.trial clause. Without that this trial counts
   // nothing and is silently unwinnable, so don't "tidy" that clause away.
   {id:'frame',name:'RATTLE THE FRAME',cat:'ATT',blurb:'Ring the woodwork three times. Posts and bar both count.',
    seed:44021,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT']},
    goal:{kind:'stat',stat:'woodwork',n:3},limit:75,
    medals:{gold:25,silver:40,bronze:65}},

   // The first trial with a LIVE opponent. diff is pinned so the keeper plays the same for
   // everyone; the seed makes its wander/aim rolls identical on every attempt (js/rng.js).
   {id:'wall',name:'THE WALL',cat:'ATT',blurb:'Three past a keeper that actually moves.',
    seed:61457,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT','1|GK']},
    ai:[false,true],diff:'pro',
    goal:{kind:'goals',n:3},limit:45,
    medals:{gold:15,silver:25,bronze:40}},

   /* ---- TEAM -------------------------------------------------------------
      The section for objectives that need more than one of your rods on the table at once — the
      only place a trial hands you the whole rack and asks you to switch between handles. */
   {id:'fullset',name:'THE FULL SET',cat:'TEAM',blurb:'Score once with your defence, once with your midfield, once up front.',
    seed:31889,table:'classic',
    ball:{type:'classic',x:-34,z:0},
    hold:null,rods:{show:['0|GK','0|DEF','0|MID','0|ATT']},
    goal:{kind:'roleGoals',roles:['DEF','MID','ATT']},limit:90,
    medals:{gold:40,silver:60,bronze:85}}
  ],

  /* ---- the daily challenge (FEATURE-IDEAS 3.3) ------------------------
     ONE setup per calendar day, identical for every player, with a local best and a streak.
     Built on trials rather than beside them: dailyBuild() picks a template by a hash of the
     DATE, copies the trial it names, rolls the ball spawn inside the template's band and stamps
     a date-derived seed. Same runner, same HUD, different provenance. No server.

     WHAT IS ROLLED, AND WHAT DELIBERATELY IS NOT. The spawn and the seed vary; `n`, `limit` and
     `medals` come from the named trial UNCHANGED. Rolling difficulty is the obvious next idea and
     it is the one that breaks the feature: thresholds authored for "3 goals in 45s" mean nothing
     against a rolled 6, and nothing in the game would tell you today's was the unfair one.
     Variety comes from ADDING templates, not from widening bands.

     THE BANDS ARE DERIVED, NOT PICKED BY EYE, and they are narrow for a reason — a spawn has to
     clear the resting foot box AND stay inside the rod's strike reach:
       lower bound = foot box far face + BALL_R   (inside it, collideRod fires on sim step one —
                     the 2026-08-20 clock bug, and the ball visibly jumps as the trial loads)
       upper bound = rod x + CONFIG.ai.inFrontMax (past it the player cannot reach the ball at all)
     For the ATT rod that is [25.80, 28.80]; for DEF [-34.20, -31.20]; for MID [-4.20, -1.20];
     for GK [-49.20, -46.20]. The GK band's z is the tighter one because the keeper's slide is
     capped at CONFIG.rods.gkSlide (11) to keep it inside its own area — a spawn the ATT rod
     would stroll onto can sit outside what a keeper can reach at all.
     tools/trials-harness.js SAMPLES every band against the live geometry, so widening one past
     what the rods can reach fails there rather than handing somebody an impossible day.
     ---------------------------------------------------------------------- */
  daily:{
   on:true,
   templates:[
    {from:'snap',    ball:{x:[26.2,28.4], z:[-8,8]}},
    {from:'keeper',  ball:{x:[26.2,28.4], z:[-8,8]}},
    {from:'frame',   ball:{x:[26.2,28.4], z:[-6,6]}},
    {from:'wall',    ball:{x:[26.2,28.4], z:[-8,8]}},
    {from:'fullset', ball:{x:[-33.8,-31.6], z:[-6,6]}},
    {from:'onetwo',  ball:{x:[-3.8,-1.6], z:[-6,6]}},
    {from:'distro',  ball:{x:[-49.0,-46.4], z:[-5,5]}},
    {from:'longball',ball:{x:[-33.8,-31.6], z:[-6,6]}}
   ]
  }
 },

 /* ---- goal instant replay (js/replay.js) ------------------------------
    A ring buffer records ball positions and rod poses each sim step, then plays
    them back with a broadcast camera after the goal. cfg.replay is the player's
    in-menu toggle; this block is the tuning. ---------------------------- */
 replay:{
  on:true,          // master switch (false = the recorder never runs)
  winner:true,      // also replay the match-winning goal, delaying the win screen
  buffer:7,         // seconds of play the ring buffer holds
  len:4.4,          // longest stretch of footage a replay shows (s)
  minLen:1.4,       // rallies shorter than this skip the replay (s)
  speed:0.7,        // playback rate through the approach
  slowLast:1.3,     // the final N seconds of footage ease into slow-mo…
  slowSpeed:0.22,   // …down to this rate right at the goal
  holdT:0.55,       // freeze-frame on the ball crossing the line (s)
  zoom:0.8,         // fov multiplier at max slow-mo (1 = no push-in)
  camLerp:5.5,      // camera position chase rate (lower = floatier)
  lookLerp:8,       // look-target chase rate
  trailEvery:0.045, // seconds between trail sprites on a fast replayed ball
  roll:true,        // spin the replayed ball along its path (the recorder stores position only)
  // Replay audio: the rally's impacts are logged live and re-fired against the footage clock.
  audio:{
   on:true,        // re-fire the rally's sounds during playback
   gain:0.9,       // level of a replayed sound vs the same sound live
   pitch:0.85,     // how far pitch follows the playback rate (0 = normal pitch throughout)
   pitchMin:0.3,   // pitch floor
   goalSting:true, // re-fire the goal horn on the freeze-frame, at normal pitch
   events:192      // ring capacity for logged sounds (overflow drops the oldest)
  },
  // Clip saving. The recorder is armed at the first frame of every replay, so the key
  // can be pressed any time and still write the whole replay out. Costs one encode per goal.
  save:{
   on:true,
   key:'KeyS',     // keyboard code (every other key still skips the replay)
   pad:3,          // gamepad button (A/B/Start still skip)
   hint:'S — save clip',
   saving:'SAVING CLIP'
  },
  // Camera shot placement, world units. `gx` is the beaten goal's end (±60), so
  // x values marked ×gx mirror for whichever goal was scored in.
  shots:{
   rail: {y:26, z:52, followX:.8, bob:2.5},       // sideline dolly: height, distance out, ball chase, bob
   net:  {xMult:1.35, y:22, rise:6, sway:7},      // behind the goal: x past the line (×gx), height, climb, drift
   crane:{xFrom:.62, xTo:1.02, yFrom:42, yTo:20, zFrom:46, zTo:30}, // corner crane: start→end (x ×gx)
   drone:{y:62, dip:8, z:26, sway:8},             // sky drone: height, descent, base z, drift
   ball: {back:6, up:2, minY:1.5, lookAhead:34, lookY:4} // ball cam: trail distance, height, floor, gaze x/y
  }
 },

 /* ---- clip capture (js/capture.js) ------------------------------------
    MediaRecorder over the game canvas only, so a clip carries no HUD or DOM
    chrome. Every step is best-effort; a failure disables capture for the session. */
 capture:{
  on:true,             // master switch for the recorder
  fps:60,              // canvas capture rate (keep above 0)
  bitrate:12000000,    // video bits/s
  audio:true,          // mux the game audio into the clip
  audioBitrate:128000, // audio bits/s
  chunkMs:250,         // MediaRecorder timeslice
  revokeMs:20000,      // how long the blob URL is held alive after the download fires
  prefix:'fuzeball_goal',  // download filename prefix
  /* First supported wins (js/capture.js clipMime), and the file is named after whatever the
     recorder actually produced. MP4/H.264 leads because it is the only one every editor, phone and
     social platform takes; the WebM entries are the Firefox path and a last resort.
     avc1 levels descend so a 4K-capable encoder is asked first: 640033 = High L5.1, 64002A =
     High L4.2, 42E01E = Baseline L3.0 (universally accepted, lower quality). */
  mime:['video/mp4;codecs=avc1.640033,mp4a.40.2','video/mp4;codecs=avc1.64002A,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4',
        'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
 },

 /* ---- photo mode (js/photo.js · F1) ------------------------------------
    A promotional-still studio, not a debug view. The sim freezes, the HUD and
    every dev panel come down, and the camera is driven by an explicit rig
    instead of the match shots.

    THE CAPTURE READS THE CANVAS ONLY (same as the clip recorder), so the panel,
    the framing mask and the guides are never in the picture — they can stay on
    screen while you shoot. That is what makes a live crop preview possible at
    all: what you frame is what lands on disk.

    Everything here is a LIMIT or a DEFAULT — the live rig is session state on
    PH. on:false removes the mode entirely and F1 does nothing. */
 photo:{
  on:true,
  key:'F1',            // toggle. preventDefault'd, or the browser opens its own help
  freezeOnEnter:true,  // halt the sim the instant the mode opens — the whole point of a still
  freezeFx:true,       // ...and particles / trails / the LED pulse with it (fxUpdate runs at rdt 0)
  hideDebug:true,      // the C-overlay's proxies are SCENE meshes and would land in the shot; restored on exit
  hideMarks:true,      // opening state of the markers toggle (held-rod cones, drop ring, sweet-spot guide)

  /* --- rig ---------------------------------------------------------------
     ALWAYS an orbit: camera position is derived from target + dist + yaw/pitch,
     so every number on the panel means the same thing in both modes. 'Free look'
     is the same rig with the camera pinned and the TARGET moved instead, which
     is why there is only one set of limits here. */
  rig:{
   yaw:0, pitch:26, roll:0, dist:120, fov:42,   // opening composition (degrees / world units)
   target:{x:0,y:7,z:0},
   pitchMax:89,          // ±. lookAt goes degenerate at exactly 90 against a world up vector
   rollMax:60,           // ± dutch tilt
   distMin:5,  distMax:400,
   fovMin:8,   fovMax:110,
   tXMax:200, tYMin:-30, tYMax:160, tZMax:200,  // target slider ranges
   near:0.4,  far:1600   // wider than the match camera's 1..700 so a long lens still clears the room
  },
  /* --- movement rates ----------------------------------------------------
     key* are per second, drag* per pixel, wheel per notch.
     Shift = fast, Ctrl or Alt = fine. */
  speed:{keyPan:70, keyRise:45, keyOrbit:70, keyDolly:90,
   fast:3.4, fine:0.15,
   dragOrbit:0.30,   // degrees per pixel
   dragPan:0.14,     // world units per pixel, ×(dist/100) — a fixed gain is glued at 300u and violent at 10
   dragDolly:0.006,  // middle-drag: FRACTION of the current distance per pixel
   wheel:0.09},      // ...and per wheel notch, same reason

  /* --- framing -----------------------------------------------------------
     A crop is a letterbox MASK over the live view; the capture then reproduces
     exactly what that mask frames. The two only agree because photoCropFov()
     narrows the vertical fov by the crop's HEIGHT fraction — see the note there,
     it is the one piece of maths in this file that isn't a taste call. */
  aspects:[
   {lab:'WINDOW', a:0},
   {lab:'16:9',   a:16/9},
   {lab:'21:9',   a:21/9},
   {lab:'3:2',    a:3/2},
   {lab:'4:3',    a:4/3},
   {lab:'1:1',    a:1},
   {lab:'4:5',    a:4/5},
   {lab:'9:16',   a:9/16}
  ],
  defAspect:1,          // index into aspects — 16:9

  /* --- capture -----------------------------------------------------------
     Output pixels = crop CSS px × scale, rendered into the real framebuffer at
     pixelRatio 1, so a low cfg.renderScale can never cap a still. maxPx is
     clamped again at run time against the GL implementation's own limit. */
  scales:[1,2,3,4],
  defScale:2,
  maxPx:8192,           // hard ceiling; clamped again against the GL context's own limits
  prefix:'fuzeball_shot',
  flash:0.16,           // seconds the white shutter flash holds
  shutter:true,         // two-tone shutter click on capture
  // Re-allocate the directional shadow map at the still's scale for the one frame. A 2048 map
  // stretched over an 8K frame is the single thing that reads as 'game screenshot' rather than
  // 'render'. Two allocations per shot, nothing per frame. false = shoot at the live map size.
  shadowBoost:true,
  shadowMax:4096,

  /* --- turntable ---------------------------------------------------------
     For orbiting VIDEO grabs, not stills — it fights the freeze by design. */
  spin:{speed:9, min:1, max:60},   // deg/s

  /* --- clip recorder (R) -------------------------------------------------
     Records the CROP, not the window: photo.js blits the framed region of the
     game canvas into an off-screen canvas and hands THAT to js/capture.js. So
     the webm is the shot you composed, with no panel/mask/guides in it and no
     cropping afterwards — the same canvas-only property that makes the still
     clean, one step further on.
     Resolution is bounded by the LIVE backing store (cfg.renderScale × dpr), so
     unlike a still this cannot beat the render scale — a stills-grade turntable
     wants renderScale 1. The panel prints the real output size for that reason. */
  record:{
   on:true,
   audio:false,        // a camera move has no soundtrack; true muxes the game audio like a goal clip
   fps:60,
   /* Video bits/s. A turntable is slow, smooth, high-detail motion that will be SCALED and GRADED
      later, so this is deliberately generous — the encode is off-thread and the file is seconds
      long. Real-time encoders treat it as a target, not a promise. */
   bitrate:24000000,
   /* Container preference for a PROMO clip specifically. Same reasoning as CONFIG.capture.mime,
      minus the audio codec (record.audio is false, so asking for one can only narrow support). */
   mime:['video/mp4;codecs=avc1.640033','video/mp4;codecs=avc1.64002A','video/mp4;codecs=avc1.42E01E',
         'video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'],
   maxPx:2560,         // long-edge ceiling; the blit downscales past it (even dimensions, encoders want them)
   autoStop:true,      // a recording STARTED with the turntable on stops itself after one 360°
   maxSec:120,         // hard backstop for a free (non-turntable) take
   prefix:'fuzeball_turntable'
  },

  /* --- offline turntable render (SHIFT+R) --------------------------------
     The turntable is a FROZEN sim plus a deterministic camera orbit, so nothing about it needs to
     happen at wall-clock speed. Rendering it frame by frame instead of capturing it in real time
     is strictly better on the three things a real-time capture cannot fix:
       · EXACT CFR. A MediaRecorder clip is VFR — any frame the game was late for is held or
         dropped — and Premiere/Resolve both handle variable frame timing badly.
       · FULL RESOLUTION. Each frame re-renders at pixel ratio 1 like a still, so cfg.renderScale
         is irrelevant. A clip can never beat the live backing store.
       · NO CODEC AT ALL. An image sequence imports natively into every NLE, so there is nothing
         to transcode, remux or argue with.
     Output is ONE zip (STORE, no compression — the frames are already compressed), because 300
     separate downloads is not a workflow. */
  seq:{
   on:true,
   heights:[720,1080,1440,2160],  // width comes from the CROP's aspect, so the shot is what you framed
   defHeight:1080,
   fps:[24,30,60], defFps:30,
   secs:10, secsMin:2, secsMax:40,   // one full revolution over this long
   /* jpeg at .92 is ~8x smaller than png and visually indistinguishable once the footage has been
      graded and delivered as h.264 — which is why it's the default. png is there for a frame that
      has to survive compositing. */
   fmt:'jpeg', quality:0.92,
   /* Rough bytes-per-pixel for the size ESTIMATE on the panel. Deliberately generous: the number
      exists so nobody starts a render that fills their disk, and under-promising is the failure
      that matters. */
   bpp:{jpeg:0.22, png:1.6},
   maxFrames:1800,          // 60s at 30fps
   maxBytes:1200000000,     // ~1.2GB. Frames are held in memory until the zip is written.
   maxPx:4096,              // per-axis ceiling, clamped again against the GL context's own limit
   shadowBoost:true,        // as for a still: a 2048 map stretched over a 2160p frame reads as a render
   readme:true,             // drop the ffmpeg line + import fps into the zip
   prefix:'fuzeball_turntable'
  },

  slots:6               // saved-shot slots (persisted in cfg.photoShots)
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
const AUMIX=CONFIG.audioMix;
const PHY=CONFIG.physics, KICK=CONFIG.kick, AIC=CONFIG.ai, CTRL=CONFIG.control,
      PWR=CONFIG.powerups, DEAD=CONFIG.deadball, CAM=CONFIG.camera, MATCH=CONFIG.match, SRV=CONFIG.serve, SIM=CONFIG.sim, REPLAY=CONFIG.replay,
      CAPTURE=CONFIG.capture, PHOTO=CONFIG.photo, MOM=CONFIG.moments, MSTAT=CONFIG.matchStats, SHOT=CONFIG.shots;
const RODDEFS=CONFIG.rods.defs, DIFFS=CONFIG.diffs, BALL_TYPES=CONFIG.ballTypes,
       PU_TYPES=CONFIG.puTypes, ROOMS=CONFIG.rooms, CUP=CONFIG.league.cup;
const pCount=CONFIG.fx.particleCount;
const ARENA=CONFIG.tables.arena.bowl;   // bowl shape params, read by arena.js

/* =========================================================================
   Persisted player settings (localStorage). These are the in-menu options,
   distinct from the CONFIG tuning knobs above.
   ========================================================================= */
let cfg={diff:'pro',goals:5,gameTime:0,room:'open',reflections:true,fog:true,table:'classic',pitch:'pub_classic',skins:{},special:true,power:true,auto:true,sound:true,ambience:true,replay:true,
 // gameTime: match limit in minutes (0 = unlimited, first to `goals`). Timed matches
 // go to the team ahead at time-up, or sudden death on a tie.
 redName:'Team 1',blueName:'Team 2',redColor:'#ff4d5a',blueColor:'#3d8bff',
 // Per-team AI difficulty, overriding the legacy single `diff`.
 diffRed:null,diffBlue:null,
 // Customize panel: figurine, material finish and size per team.
  modelRed:'cyborg',modelBlue:'cyborg',redYaw:-0.55,blueYaw:0.55,
  redMetalness:.15,redRoughness:.45,redGlow:0,redScale:1,
  blueMetalness:.15,blueRoughness:.45,blueGlow:0,blueScale:1,
  // true = keep the material values exported with the model.
  redFinishDefault:false,blueFinishDefault:false,
 // Controls. Sensitivities are multipliers on CTRL.slideSpeed / CTRL.mouseSens.
 // padSlideAxis 'ly'|'lx', padAngleAxis 'ry'|'rx'.
 // padSlideCurve shapes stick deflection → slide speed (1 = linear, >1 = finer near centre).
 padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,
 // Total Control pad mode: LT eases the slide toward padTCFine, RT toward padTCFast,
 // neither held sits at padTCBase. The free right-stick axis adds side-spin on contact.
 padControlMode:'classic',padTCBase:0.75,padTCFine:0.35,padTCFast:1.6,padTCSwerve:1,padTCSpinInvert:false,
 // Classic-mode charge input: 'rt' (RT holds the wind-up, the kick button stays instant),
 // 'kick' (the kick button holds it, and a tap then fires on release) or 'both'.
 padChargeBtn:'rt',
 mouseSens:1,kbdSens:1,
 // Cursor lock during a match: hides the pointer and lets the mouse keep going past the edge of
 // the screen (no taskbar, no lost travel). ESC releases it AND pauses — see the pointer-lock
 // block in js/input.js. Off = the cursor stays visible and stops at the screen edge.
 mouseLock:true,
 // Per-screen panel arrangements from the Layout editor: screen-id -> {p:{elId:{x,y,w,h}},h}.
 layouts:{},
 // Display settings. renderScale multiplies the device pixel ratio; fpsCap 0 = uncapped;
 // gfxPreset is the last-picked preset ('low'|'medium'|'high'|'custom').
 // shadowQuality picks a tier from CONFIG.render.shadow.quality ('low'|'high') and only
 // matters while `shadows` is on. Defaults to 'low' — the tuning every build shipped with.
 renderScale:1,shadows:true,shadowQuality:'low',fpsCap:0,showFps:false,gfxPreset:'high'};
/* =========================================================================
   WHERE A SETTING LIVES — PLAYER vs MACHINE.

   `cfg` used to be ONE localStorage blob under 'fuzeball'. It is still one live
   object — nothing that reads cfg.x or calls saveCfg() changes — but it now
   PERSISTS as two, because the settings in it answer two different questions:

     PLAYER   who this person is and what they have done. Their team names and
              kit, their difficulty, their match rules, their trial records,
              their saved training spots. This follows the person.
     MACHINE  what THIS computer can do. renderScale, shadows, fpsCap, the gfx
              preset, physQuality, and the panel `layouts` (which are clamped to
              a live window, so an ultrawide arrangement is wrong on a handheld).
              This must never leave the machine it was set on.

   The split exists for Steam Cloud. Cloud syncs a folder of files, and the
   moment the wrapper mirrors saves into one, a single blended blob would push a
   desktop's renderScale:1 / shadows:true onto the same player's Steam Deck and
   tank it — a "my settings reset themselves and now it runs at 20fps" bug that
   is near-impossible to diagnose from a support thread. Splitting it now, while
   there are no shipped saves to migrate, costs one boot; splitting it later
   costs a migration path per player. cfgSyncKeys() below is the manifest the
   wrapper reads, kept here so it cannot drift from these two sets.

   ADDING A SETTING: put its key in exactly one of the two sets. A key in
   neither still WORKS — it defaults to PLAYER, because failing to sync progress
   is worse than syncing a stray toggle — but it is reported once to the console
   so the drift is caught in the session it appears.
   ========================================================================= */
const CFG_KEY={player:'fuzeball_player',machine:'fuzeball_machine',legacy:'fuzeball'};

// Never leaves this computer. Display, performance, hardware calibration, window geometry.
const CFG_MACHINE=new Set([
 'renderScale','shadows','shadowQuality','fpsCap','showFps','gfxPreset','physQuality','reducedFx','trails',
 'particles','marks','reflections','fog','profiler',
 'layouts',        // per-screen panel arrangements — clamped to the live window, so per-display
 'padDeadzone'     // stick calibration: a drifty pad on ONE machine, not a preference
]);
// Follows the person. Identity, choices, progress.
const CFG_PLAYER=new Set([
 'diff','diffRed','diffBlue','goals','gameTime','special','power','auto','replay',
 'sound','ambience',
 'table','room','pitch','skins',
 'redName','blueName','redColor','blueColor',
 'modelRed','modelBlue','redYaw','blueYaw',
 'redMetalness','redRoughness','redGlow','redScale','redFinishDefault',
 'blueMetalness','blueRoughness','blueGlow','blueScale','blueFinishDefault',
 // Control PREFERENCES sync (inversion, sensitivity, the Total Control curve, charge button);
 // only padDeadzone above does not, because that one is calibrated to a physical stick.
 'padSlideAxis','padAngleAxis','padSlideSens','padAngleSens','padSlideCurve',
 'padSlideInvert','padAngleInvert','padControlMode','padTCBase','padTCFine','padTCFast',
 'padTCSwerve','padTCSpinInvert','padChargeBtn','mouseSens','kbdSens','mouseLock',
 'trials','daily','trnSpots','photoShots',                       // progress + authored content
 'theme','model','metalness','roughness','glow','modelScale'     // legacy, migrated just below
]);
/* Bucket a key. Unlisted -> PLAYER, reported ONCE per key per session (not per save, or every
   slider drag would spam the console). */
const cfgWarned=new Set();let cfgOrphans=null;
function cfgBucket(k){
 if(CFG_MACHINE.has(k))return 'machine';
 if(!CFG_PLAYER.has(k)&&!cfgWarned.has(k)){cfgWarned.add(k);(cfgOrphans||(cfgOrphans=[])).push(k);}
 return 'player';
}
function cfgSplit(src){const o={player:{},machine:{}};for(const k in src)o[cfgBucket(k)][k]=src[k];return o;}
/* THE STEAM CLOUD MANIFEST. The Electron wrapper mirrors exactly these localStorage keys out to
   JSON files under app.getPath('userData') and registers that folder for Auto-Cloud; anything
   not listed stays on this computer. Deliberately excludes CFG_KEY.machine and CFG_KEY.legacy.
   'fuzeball_career' is listed ahead of existing — it is the achievements store (ACHIEVEMENTS.md
   §4) and belongs in the manifest the day it appears, not as a later amendment. */
function cfgSyncKeys(){
 const out=[CFG_KEY.player,'fuzeball_league_slot','fuzeball_career'];
 try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
  if(k&&k.indexOf('fuzeball_league_')===0&&k!=='fuzeball_league_slot')out.push(k);}}catch(e){}
 return out;
}
/* Load. Player first, then machine ON TOP: if a key ever moves between the two sets, or a stale
   copy survives in the player blob from before the move, THIS computer's value still wins. */
(function cfgLoad(){
 let p=null,m=null;
 try{p=JSON.parse(localStorage.getItem(CFG_KEY.player)||'null');}catch(e){}
 try{m=JSON.parse(localStorage.getItem(CFG_KEY.machine)||'null');}catch(e){}
 if(p||m){if(p)Object.assign(cfg,p);if(m)Object.assign(cfg,m);return;}
 /* FIRST BOOT AFTER THE SPLIT: fold the single legacy blob in and let the first saveCfg() write
    the two new keys. The legacy 'fuzeball' key is deliberately NOT deleted — it is a free
    one-time backup of the pre-split state and costs a few KB. Nothing reads it again once
    either new key exists, so a later save can never resurrect a stale value from it. */
 let l=null;try{l=JSON.parse(localStorage.getItem(CFG_KEY.legacy)||'null');}catch(e){}
 if(l)Object.assign(cfg,l);
})();
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
// Migrate the old `theme` into a `room`; unknown values fall back to 'open'.
if(!cfg.room||!CONFIG.rooms[cfg.room]){cfg.room=(cfg.theme&&CONFIG.themeToRoom[cfg.theme])||'open';}
if(typeof cfg.reflections!=='boolean')cfg.reflections=true;
if(typeof cfg.replay!=='boolean')cfg.replay=true;
// Display settings: backfill for old saves so the Display tab reads sane values.
if(typeof cfg.renderScale!=='number'||!(cfg.renderScale>0))cfg.renderScale=1;
cfg.renderScale=clamp(cfg.renderScale,0.4,1);
if(typeof cfg.shadows!=='boolean')cfg.shadows=true;
// Anything that isn't a known tier reads as Low, so an old save (or a hand-edited one) lands on
// the tuning it was already running rather than on a setting its machine may not want.
if(cfg.shadowQuality!=='high')cfg.shadowQuality='low';
if(cfg.fpsCap!=='match'&&typeof cfg.fpsCap!=='number')cfg.fpsCap=0;   // number, or 'match' (track detected refresh)
if(typeof cfg.showFps!=='boolean')cfg.showFps=false;
if(typeof cfg.profiler!=='boolean')cfg.profiler=false;   // frame profiler overlay (M)
if(typeof cfg.gfxPreset!=='string')cfg.gfxPreset='high';
if(typeof cfg.physQuality!=='string')cfg.physQuality='high';
if(typeof cfg.reducedFx!=='boolean')cfg.reducedFx=false;
if(typeof cfg.trails!=='boolean')cfg.trails=true;
if(typeof cfg.particles!=='boolean')cfg.particles=true;
if(typeof cfg.marks!=='boolean')cfg.marks=true;
// (legacy cfg.theme is left as-is — only the pitch migration below reads it)
// Per-table chosen skin: table-id -> skin-id; missing = the table's defSkin.
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
/* Persist the player's settings. While a league/cup fixture is on screen its venue sits on
   the live cfg but belongs to the league save, so lgVenueHeld's values are written instead. */
function saveCfg(){try{
 // A league fixture's venue AND a skill trial's table are both PARKED rather than live: without
 // this, touching any Options control during either would make its table the player's permanent
 // Kick Off setting. Whichever is holding wins — they can't both be, since a trial can't start
 // from inside a league match.
 const v=((typeof lgVenueHeld==='function')&&lgVenueHeld())||((typeof trialVenueHeld==='function')&&trialVenueHeld());
 // The venue substitution happens BEFORE the split, not after: table/room/pitch/skins are PLAYER
 // keys, so parking them has to be settled while it is still one object or the parked values
 // would be written straight through into the synced blob.
 const src=v?Object.assign({},cfg,{table:v.table,room:v.room,pitch:v.pitch,skins:v.skins}):cfg;
 const b=cfgSplit(src);
 localStorage.setItem(CFG_KEY.player,JSON.stringify(b.player));
 localStorage.setItem(CFG_KEY.machine,JSON.stringify(b.machine));
 if(cfgOrphans){
  console.warn('Fuzeball: cfg key(s) in neither CFG_PLAYER nor CFG_MACHINE, defaulted to PLAYER '+
   '(they WILL sync between machines) — add them to one of the two sets in js/config.js: '+cfgOrphans.join(', '));
  cfgOrphans=null;   // cfgWarned keeps them from being re-collected, so this fires once per key
 }
}catch(e){}}

/* Physics quality presets */
const PHYS_Q={
 high:{subTravel:0.20,subMax:7},
 balanced:{subTravel:0.28,subMax:6},
 performance:{subTravel:0.38,subMax:5}
};
function applyPhysQuality(){const q=PHYS_Q[cfg.physQuality]||PHYS_Q.high;CONFIG.physics.subTravel=q.subTravel;CONFIG.physics.subMax=q.subMax;}
applyPhysQuality();   // apply the saved quality at boot, before any physics runs
// Per-team figurine def (falls back to the first if the id is stale).
function activeModel(team){const M=CONFIG.playerModel;return M.models.find(m=>m.id===cfg[team===0?'modelRed':'modelBlue'])||M.models[0];}
// Per-team material finish, so Red and Blue can be sculpted independently.
function tmMetal(t){return clamp(cfg[t===0?'redMetalness':'blueMetalness'],0,1);}
function tmRough(t){return clamp(cfg[t===0?'redRoughness':'blueRoughness'],0,1);}
function tmGlow(t){return Math.max(0,cfg[t===0?'redGlow':'blueGlow']);}
function tmScale(t){return cfg[t===0?'redScale':'blueScale']||1;}
// 'Default' finish flag: the team keeps the material values exported with the model.
function tmDefault(t){return !!cfg[t===0?'redFinishDefault':'blueFinishDefault'];}
/* Snapshot a material's authored finish once, so Default can restore it later.
   Must run before the first mutation; applyTeamFinish calls it at the top. */
function matSaveOrig(m){
 if(!m.userData)m.userData={};
 if(!m.userData.fbOrig)m.userData.fbOrig={metalness:m.metalness,roughness:m.roughness,
  emissive:m.emissive?m.emissive.getHex():null,emissiveIntensity:m.emissiveIntensity};
 return m;}

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
