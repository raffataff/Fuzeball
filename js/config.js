'use strict';
// FUZEBALL: GLOBAL CONFIG
// Axes: X = goal to goal, Z = width, Y = up. Field at y = 0, goals at x = ±L/2. Left net red, right net blue.
const CONFIG = {

  /* ---- logo ----------------------------------------------------------- */
  logo:{
   src:'assets/fuzeball_render_tc_cycles_2K.png',  // path to the logo image
   width:460,                       // max width in px
   glow:'#5090ff',                  // glow colour for the drop-shadow + pulse
   glowSize:28,                     // base glow spread (px)
   pulseSize:44,                    // glow spread at pulse peak (px)
   pulseSpeed:3                     // pulse cycle duration (s)
  },

  /* ---- intro cinematic (boot splash → main menu) ----------------------- */
  intro:{
   on:true,          // master switch
   skip:false,        // allow key/click to skip
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
  warnT:5          // clock turns red and each second lands as a tick in the last N seconds
 },

  // ---- HUD (js/hud.js) ----
  // layout lives in hud.js; these are the calls that are taste rather than geometry
  hud:{
  scale:1,          // multiplies the automatic UI scale (which follows window height: 900px = 1)
  hintHold:9,       // the controls hint stays at full strength this long after kickoff (s)...
  hintDim:.38,      // ...then settles to this opacity. 1 = never dims
  beads:true,       // scoring beads under the team names — the wire a real table keeps score on
  beadMax:12,       // a goal target above this skips the beads (they stop fitting under a name)
  glint:true        // one light sweep across a banner headline as it lands (off under Reduced effects)
 },

// ---- moments (js/moments.js) ----
// saves, woodwork and the goal banner copy; on:false restores the flat HYPE copy
 moments:{
on:true,
   inTraining:false,   // false = a pinch would fight freeze/step in the training sandbox

  // on-target projection: straight-line ballistic to the goal plane, spin not modelled
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

  // keeper saves: GK only, a DEF block fires nothing
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
 on:true,          // false: sheet falls back to the old three-number panel

 // SHOT = a swing contact that sends the ball goalward; one per swing (the swing latch)
 shotVX:26,        // goalward speed off the boot to count as an attempt (u/s)
 shotWide:3.0,     // max miss of a shot's projection, in goal half-widths from centre (wider is a clearance)
 // ON TARGET reuses the keeper-save projection; a shot too slow to project (MOM.target.maxT) isn't on target

 passT:2.5,        // a teammate rod receiving the ball within this long of another of its rods' swing = one completed pass

 thirds:3,         // territory buckets across the long axis; the bar's key labels two ends and a middle, so keep it 3

 /* Units. m = kmh/3.6 (derived — retune this if the pace conversion is ever retuned). */
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

// ---- seeded sim rng (js/rng.js) ----
// reproducible runs; cosmetic draws stay on Math.random; read at kickoff
 rng:{
  on:true,     // false = every seeded site falls back to Math.random() — the old behaviour exactly
  log:false    // console the seed at kickoff - the number you quote to reproduce a run
 },

 /* ---- table geometry ------------------------------------------------- */
 table:{ L:120, W:68, wallH:10, goalHalf:11, goalH:10.2, goalDepth:9 },

/* ---- procedural goal net shape (cosmetic only) ----------------------- */
 goalNet:{ bevel:{ r:1.8, segs:4 }, cell:1.6, backInset:0.98 },

/* ---- table registry --------------------------------------------------- */
 tables:{
  classic:{
   name:'Classic',
   folder:'assets/tables/classic/',
   collision:'flat',                        // flat box walls
   room:null,                               // no backdrop; uses the shared ground plane
   defTheme:'classic',
   defSkin:'wood', // must match a skins entry
   rods:{folder:'assets/tables/classic/rods/'},
   skins:{
      wood:{name:'Wood', glb:'fuzeball_table_classic_wood.glb'},
      sundayLeague:{name:'Sunday League', glb:'fuzeball_table_classic_sundayLeague.glb'},
      proLeague:{name:'Pro League', glb:'fuzeball_table_classic_proLeague.glb'},
      premierLeague:{name:'Premier League', glb:'fuzeball_table_classic_premierLeague.glb'},
      strike:{name:'Strike', glb:'fuzeball_table_classic_strike.glb'},
      alienTech:{name:'Alien Tech', glb:'fuzeball_table_classic_alienTech.glb'},                            
      //alienShip: {name:'Alien Ship',  glb:'fuzeball_table_classic.glb', glbFallback:'assets/fuzeball_table.glb'}, 
   },
   // corner pockets where the dead-ball timer runs faster (|x|>xMin and |z|>zMin, all four corners); `mult` overrides zoneMult
   deadzones:[
    {xMin:46, zMin:13.3}   // corner pockets
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
   rods:{folder:'assets/tables/classic/rods/'}, 
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
    {xMin:46, zMin:14.}   // corner pockets
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
   rods:{folder:'assets/tables/classic/rods/'},   // circuit rods (not built yet -> shared set)
   deadzones:[
    {xMin:46, zMin:14.}   // corner pockets
   ]
  }
 },


 tableAssets:{
  preloadAll:false,   // true = fetch every table skin + every room at boot
  cacheSkins:2,       // max skin GLBs resident, LRU (active always protected)
  cacheRooms:1,       // max room GLBs resident, LRU (active always protected)
  cacheEnvs:10,       // max baked reflection maps held, LRU; rooms x 2 (glb + synthetic), see roomenv-harness
  cacheSkies:2,       // max room skies (6 KTX2 cube faces, ~8MB at 1024²) resident, LRU
  cachePitches:2      // max pitch GLBs resident, LRU. 2 keeps an A/B warm
 },

 /* ---- staged venue swap ------------------ */
 venue:{ on:true, fadeT:0.24, minT:0.45, maxT:9 },

 /* ---- core physics --------------------------------------------------- */
physics:{
   ballR:1.9, rodH:7.50, playerH:-6.90, arm:6.30, prad:1.0, grav:200,
   footT:1.0,                      // arm-fraction from pivot to foot centre (1 = at the foot)
   footBox:{x:1.3,y:1.0,z:1.35},     // foot box half-extents: x along leg, y perpendicular, z along rod
   footBoxOff:{x:-0.65,y:0.4},        // foot box centre offset from foot-base, rod-local
   footBoxReach:1.0,                // multiplier on BALL_R for foot contact distance (lower = tighter)
   footJitter:0.15,                // random velocity nudge after a foot hit (stops perfect oscillations)
   subMin:3, subMax:16, subTravel:0.2,  // adaptive substep bounds and target travel per step (PHYS_Q overrides by cfg.physQuality)
   floorRest:0.42,                        // vertical restitution off the floor
   floorRestCut:6,                        // below this upward speed the bounce dies to 0
   floorHitSnd:25,                        // |v.y| above this plays a floor tap

   wallHitSnd:16,                         // |v| into a side/end wall above this plays a tap
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
   spinTurn:0.34, spinMax:0.3, spinDecay:.74, spinCut:0.02, // Magnus curve: turn rate, clamp, decay, cutoff
},

   /* ---- rod kick + motion ---------------------------------------------- */
kick:{
   // swing-angle curve keyframes: time windows and peak angles
   windup:0,  windupA:0,   // pull-back window / angle
   strike:0.025,  strikeA:0.95,     // strike ramp end / peak forward angle
   hold:0.15,                     // hold peak until this time
   drop:0.22,                     // fully returned by this time
   raiseA:-1.3, raiseLerp:18, dropLerp:15, // lift-men angle + settle rates
   padAngleLerp:40,                // right-stick angle smoothing (0 = direct 1:1, no easing)
   userSpeed:80,                  // slide speed of the player-driven rod (u/s)
   aiOwnMult:1.,                // slide-speed multiplier for AI rods on the user's team
   boostHitMult:2.50, freezeMult:0.1, // power-up multipliers: boost (hit impulse), freeze (speed)
   // Contact restitution. 0 = dead trap touch, 1 = fully elastic. See TUNING.md.
   rest:0.01, restPower:0.8,      // passive touch / struck shot
   powFrom:0.008, powTo:0.14,       // swing-time window in which restPower is used instead of rest
   grip:0.1,                     // fraction of the foot's velocity lerped into the ball on contact
   slidePush:0.8,
// SPEED CEILING: what a contact may leave the ball at, as a fraction of its type's maxV (see capSpeed)
// base + strength + what the strike earned; raise `base` if play feels slow; on:false restores the hard clip
  cap:{
      on:true,
      knee:0.62,     // speed under this fraction of the ceiling is passed through UNCHANGED
      base:0.52,     // ceiling at base str
      str:0.16,      // ...moved this far either way at str 0 / str 10
      sweet:0.10,    // a clean centre strike earns this much more ceiling
      shot:0.75,     // a player shot adds this x its power trim (r.shotPow-1): finesse lowers the ceiling, a timed charge raises it
      boost:0.18,    // POWER HITS. Without this its 2.5x impulse is invisible again
      pin:0.30,      // ceiling added to EVERY contact of a pin / trap-shot swing (the boot keeps meeting the ball after the first touch); higher = faster but the ball starts to hop; 0 = off
      min:0.2,      // a contact can never be capped below this...
      max:1.1,      // ...nor above it. OVER 1 ON PURPOSE
      // a charge beats the cap, scaled by its worth (r.shotOver); the ball's overspeed only ratchets down (stepBall)
      charge:0.30,   // ceiling added by a full-worth charge
      chargeTop:0.30 // ...and how far past `max` that charge may take it
   },
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
   spinGain:0.01, spinClamp:1,    // side-spin from sliding into the ball
   tcSpinGain:0.35,                // Total Control pad: side-spin per unit of right-stick swerve
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
// Total Control: the axis scales how fast the rod tracks the right stick; LT heavy, RT snappy
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
   grip:0.55,        // how far the ball is lerped toward the boot's velocity, which carries it
   carry:0.45        // slide-speed multiplier while carrying: a dribble is a shuffle, not a swipe (the over-run knob)
   },

  // THE PIN (shots.js shotPinInput, physics.js pinUpdate): finesse + raise tilts the men; a slow ball touching a tilted man is caught and carried
  // a kick from the pin is the pin shot (AI trapShot curve); a pad can also pin off the right stick inside `band`
  pin:{
   on:true,
   angle:-0.5,       // rod-local pin tilt, same as the AI trap (CONFIG.ai.trap.angle); capped per frame by the sweep guard
   lerp:14,          // ease rate into the pose
   capA:0.12,        // rod within this of the pose's target (rad) = posed, so a ball can be caught
   band:[-0.95,-0.2],// rod-local angles a right stick can pin from without the pose
   back:-5.8,        // catch window behind the rod (dir-relative x) — the AI trap's own window
   front:1.4,        // …and in front of it
   zCatch:2.2,       // ball within this of a man's z
   yTol:0.6,         // …on the floor (centre no higher than BALL_R + this)
   touch:0.6,        // …and touching the leg: within BALL_R + PRAD + this of the leg capsule
   capV:14,          // relative speed under which a touching ball is caught (the finesse grip slows it first)
   zHold:1.2,        // pinned ball's z offset from its man is clamped to this
   carry:0.7,        // rod slide-speed multiplier while pinned (the hold's 0.45 is for a loose dribble)
   zSlip:0.6,        // pinned ball pressed this far into a side wall slips out
   breakV:20,        // velocity change from outside (another ball) that knocks a pinned ball loose
   releaseA:0.35,    // rod turned this far off the pin angle (a stick flick) lets the ball go
   carryOut:0.8,     // fraction of the carried slide velocity the ball keeps when let go
   pow:1.15,         // pin shot power trim (r.shotPow): a still, set ball is struck clean
   ctl:0.6,            // pin shot control (r.shotCtl): no spray
   // the ring on the pitch under a pinned ball, in the holding seat's colour (fx.js pinMarkUpdate)
   mark:{
    on:true,
    r:2.9,          // outer radius; the ball is 1.9
    inner:0.72,     // inner edge as a fraction of the outer
    y:0.6,          // height above the pitch, clear of the grass blades
    alpha:0.9,
    from:0.6,       // arrives this much bigger and settles in
    inT:0.14, outT:0.22,   // seconds to ease in on the catch and to fade once let go
    hz:1.6, pulse:0.06     // slow breathing: rate and size
    },
   // the "kick = pin shot" plate while a ball is pinned (hud.js hudPinHint); the player's own switch is Options > Display (cfg.pinHint)
   hint:{
    on:true,
    hold:3,         // full strength this long after the catch (s)...
    dim:0.45,       // ...then settles to this opacity. 1 = never dims
    inT:0.12, outT:0.2,
    gap:8           // clear space between the plate and the rod chips under it (px at 1440x900, scales with the HUD)
    }
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
   stickBack:0.18,                 // right-stick pull-back depth that counts as a wind-up
   // power + pull-back, fired by kick: power alone winds up nothing, the rod must go back (raise or stick) and only a kick fires it
   // false = the old rule: power alone winds up, letting go fires
   needRaise:true,
   grace:0.09,                     // s after letting the wind-up go that a kick still fires it (keys lift a frame apart)
   pullA:-1.15,                    // rod-local wind-up angle at full charge (classic; capped by sweepClips)

   pullLerp:24,                    // ease rate toward it
   blockAt:0.30,                   // wind-up shortfall (asked minus got) that reads as "no room to swing"
   blockLerp:9,                    // how fast that reading eases in and out — a rolling ball must not strobe it
   tapMax:0.11,                    // 'kick'/'both': a press shorter than this is a plain tap
   trem:{amp:0.055, hz:34},        // overcharge tremble — DISPLAY ONLY (see the banner in shots.js)
   holdT:0.42,                     // how long the marker holds its verdict after the wind-up ends
   holdRise:5.5,                   // …and how far it lifts away from the rod while that settles
   
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
  },

  // keyboard & mouse: the modifiers are buttons, so each is a full-depth axis (POWER = RT, FINESSE = LT); keys in CONFIG.binds
  kbm:{
   on:true,
   holdRamp:0.12     // seconds for FINESSE's grip to ease in (a button has no squeeze to ease it for you)
  }
 },

 // ---- key & mouse bindings (js/binds.js) ----
 // the player's changes go in cfg.keyBinds (only actions they touched); codes are KeyboardEvent.code, Mouse0..Mouse4, WheelUp / WheelDown
 // the first input of an action is the one the in-match hints show
 binds:{
  def:{
   slideUp:  ['ArrowUp','KeyW'],
   slideDown:['ArrowDown','KeyS'],
   rodPrev:  ['ArrowLeft','KeyA', 'WheelUp'],
   rodNext:  ['ArrowRight','KeyD','WheelDown'],
   kick:     ['Space','Mouse0'],
   raise:    ['ShiftLeft','Mouse2'],
   power:    ['ShiftRight', 'KeyE'],     // hold WITH raise: wind up · kick fires (CONFIG.shots.charge.needRaise)
   finesse:  ['ControlRight', 'KeyQ'],   // hold: sticky boot, with kick: a pass; not Right Alt (Alt+Space is the Windows menu, AltGr reads as Ctrl+Alt)
   rod1:['Digit1'], rod2:['Digit2'], rod3:['Digit3'], rod4:['Digit4'],
   guide:    ['KeyB'],
   camera:   ['KeyV'],
   retry:    ['KeyR'],           // Skill Trials only
   saveClip: ['KeyS']            // goal replay only — every other input skips it
  },
  // Options list order and wording; `grp` is where a clash counts (one input can't do two things in a group)
  list:[
   {act:'slideUp',  lab:'Slide up',          grp:'play'},
   {act:'slideDown',lab:'Slide down',        grp:'play'},
   {act:'rodPrev',  lab:'Previous rod',      grp:'play'},
   {act:'rodNext',  lab:'Next rod',          grp:'play'},
   {act:'kick',     lab:'Kick',              grp:'play'},
   {act:'raise',    lab:'Raise players',     grp:'play'},
   {act:'power',    lab:'Power (+ raise)',   grp:'play', shots:1},
   {act:'finesse',  lab:'Finesse (hold)',    grp:'play', shots:1},
   {act:'rod1',     lab:'Goalkeeper',        grp:'play'},
   {act:'rod2',     lab:'Defence',           grp:'play'},
   {act:'rod3',     lab:'Midfield',          grp:'play'},
   {act:'rod4',     lab:'Attack',            grp:'play'},
   {act:'guide',    lab:'Sweet-spot guide',  grp:'play'},
   {act:'camera',   lab:'Camera view',       grp:'play'},
   {act:'retry',    lab:'Retry trial',       grp:'play'},
   {act:'saveClip', lab:'Save replay clip',  grp:'replay'}
  ],
  max:4,              // inputs per action
  // never bindable: Esc (pause), F1/F2 (photo mode, room editor), and the dev keys C L F M
  reserved:['Escape','F1','F2','KeyC','KeyL','KeyF','KeyM','MetaLeft','MetaRight','ContextMenu','Tab']
 },

 /* ---- AI behaviour --------------------------------------------------- */
ai:{
    gkPad:1,                                   // keeper stays within goalHalf + this
    reactMax:.25,                              // longest reaction latency the ball-history ring covers (s)
    ttaMax:0.8,                                // only lead the ball's z if it arrives within this (s)
    inFrontMin:2, inFrontMax:6.3,              // ahead-window a forward swing can reach
    underFootFront:6.5, underFootBack:2.9,     // ahead/behind window where a swung rod stays forward
    lowY:2.05,                                 // only swing when the ball is below this height
    raiseBehind:-7.8,                          // ball must be this far behind before the rod will raise
    overFoot:2.2,                              // |Δx| under which the ball is at the feet and strikeable
    overFootOffset:1.4,                        // shift the overFoot zone this far forward of the rod

   // Side-step after a kick: slide clear in z, then lower.
   repositionSpeed:60,                        // max ball speed that triggers the side-step
   clearMargin:0.1,                           // extra z-clearance beyond footBox.z + BALL_R before lowering

   // held-forward evade: stay forward and slide away from a slow ball in the drop-sweep zone
   heldFwd:{
      on:true,          // false = hold forward during the swing only, no persistent evade
      xFront:5.2,       // drop-sweep x-window ahead of the rod
      xBack:2.9,        // drop-sweep x-window behind the rod
      zMargin:0.01,      // extra z-depth of the zone beyond footBox.z + BALL_R
      maxSpeed:50,      // only evade balls slower than this
      vz:1,            // ball z-speed above this decides the escape direction (never 0)
      abortT:.25        // release the evade after this long (s)
   },
   footRangeBack:7.0,                         // backward x depth of a foot's reach rectangle

   // Foot-trap break: drop a raised rod when a slow ball is pinned at a foot.
   footTrapSlow:38.0,                         // ball speed under this counts as pinned
   footTrapZ:1.2,                            // ball within this z of a foot counts as at the foot

// trap: pin a slow ball under the boot, carry it sideways, then scoop it away (iq-gated)
    trap:{
      on:true,
      angle:-0.5,          // rod-local tilt that puts the foot box at ball height
      lerp:14,             // ease rate toward the trap angle
      back:-5.8,           // catch window behind the rod (dir-relative x)
      front:1.4,           // …and in front of it
      maxVX:75,           // ball |v.x| must be under this to attempt a trap
      maxSpeed:75,        // total ball speed cap for attempting/keeping a trap
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
// dribble: ball at the feet, men down, no way forward: slide it instead of hitting it into the row opposite
   dribble:{
      on:true,
      roles:['ATT','MID','DEF'],  // roles allowed to dribble (never GK)
      iqGate:true,        // only rods whose iq roll passed try it
      back:-2.2,          // control window behind the rod (dir-relative x)
      front:3.5,          // …and in front of it
      alignZ:2.2,        // z-distance of the nearest man within which the ball is controllable
      maxSpeed:65,        // ball must be slower than this to be brought under control
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
   // Safe raise: lift over a slow ball loitering behind the rod.
   safeRaise:{
      on:true,
      angle:-0.8,        // lift angle the rod eases to (rod-local; full raiseA is -1.6)
      angleBehind:-1.3,  // boot must be above a ball behind the rod, not parked in it (clears a ball down to the back wall, ~-1.22)
      behindRel:0,       // "behind" = ball centre further back than this (dir-relative x)
      lerp:4,             // ease rate toward the angle
      gkLerp:30,          // keeper only: a rolling ball is on the boot in ~0.2 s, so it lifts faster than the plain raise (KICK.raiseLerp 18)
      gkAlways:true,      // keeper only: lifts whatever its iq roll said (the roll gates the outfield rods)
      back:-5.8,          // x band behind the rod where a loitering ball triggers it…
      front:1.1,        // …up to this line
      gkFront:5.3,         // GK only: push that front line this much further in front of the keeper
      maxVX:105,            // ball |v.x| must be under this
      maxSpeed:105,        // total ball speed cap
      abortT:6.5          // give up after this long (s, keep under deadball.stallT)
   },
   // back guard: an AI rod never pushes a ball behind its boot toward its own goal
   // last word on the angle and slide (rods.js updateRods); kicks, trap, dribble, the pin and human rods are exempt; tools/backswing-soak.js measures it
   backGuard:{
      on:true,
      lift:true,          // hold a back-swing short of a ball it would hit on the way
      slide:true,         // never slide a man further INTO a ball that is behind his boot
      lane:true,          // …nor into the z lane of a ball a half-lifted boot still has to swing back through
      arcStep:0.03,       // rad between samples on the lift arc; keep under the width of the band a far ball is reached over
      maxSamples:64,      // cap on the above (a full lift from rest is ~55)
      easeTo:0.97,        // the lift is an exponential ease that never arrives: walk this fraction of the arc
      sweepT:0.15,        // s of the ball's z travel added to the cheap "is any man near its lane" reject
      holdT:0.12,         // s a held lift keeps r.lhT up, so ai.js drops the raise latch and evade can clear the lane
      maxY:5.0,           // a ball with its centre higher than this is out of any boot's reach
      maxSpeed:80,        // a faster ball is not loitering; the swept prediction is speculative there
      pad:0.05,           // slack on the contact distance. Keep under clearMargin (0.1): evade clears by that
      backDot:0.3,        // contact normal's forward component below this = the ball is behind/beside the boot
      deepD:0.3,          // a ball this close is inside the box, where the normal is undefined, so it counts regardless
      behindRel:-0.6      // slide guard: ball centre this far behind the rod, i.e. behind the box's rear face
   },
   // retrieve: a slow ball behind a man's heel or under the row: side (slide clear), lift, over (onto its z), pin (or drop through it)
   // every step is forward of the ball, so nothing knocks it toward the rod's own goal
   retrieve:{
      on:true,
      maxSpeed:18,        // enter only for a ball slower than this (u/s)
      bailSpeed:26,       // a live action lets go once the ball is quicker than this
      maxApproach:4,      // ...and not closing on the rod faster than this (a rolling ball arrives by itself)
      bailApproach:9,     // a live action lets go once the ball rolls at the rod this fast
      enterRel:-0.8,      // ball at least this far behind the rod (dir-relative x); the kick zone takes over from here
      exitRel:-0.3,       // a live action hands back once the ball has rolled this far forward
      backMax:6.0,        // not deeper than this: past it the boot can't get over the ball
      crossRel:-2.8,      // a ball this far behind or more is out of reach of a boot sliding past, so `side` may cross its lane
      reach:1.0,          // some man must be able to slide within this of the ball's z
      alignZ:0.7,         // z-alignment of the man over the ball that ends the slide-in
      sideMargin:0.25,    // extra z clearance on top of footBox.z + BALL_R + clearMargin when stepping aside
      liftT:1.0, overT:1.2, pinT:1.4,   // phase timeouts (s); pinT covers the descent
      pinLead:0.10,       // rad the pin pose leads the boot on the way down; keep under shots.pin.capA (0.12) or the catch never arms
      abortT:4.0,         // whole action, keep under deadball.stallT
      pin:true,           // try to pin the ball under the leg, then play the pin shot; false = always drop through it
      pinIQ:true,         // …only the keeper and smart rods (iq roll) pin; the rest drop
      settleT:0.30,       // a pinned ball is held this long before it is played (s)
      dropT:0.6,          // the drop is given this long to swing through (s)
      cd:0.6              // re-entry lockout after an action ends (s)
   },
   // Evade: slide the men away from a slow ball stuck behind them so play can restart.
   evade:{
      on:true,
      vz:1,             // ball z-speed above this decides the escape direction (never 0)
      maxSpeed:35,        // only evade balls slower than this
      maxApproach:4,      // ball must not be closing on the rod faster than this
      abortT:3.0,         // give up after this long (s, keep under deadball.stallT)
      raiseAfter:true,    // latch the raise on a successful clear so the drop knocks the ball upfield
      cd:0.8,             // re-entry lockout after an evade ends (s)
      behindDead:1.6      // ball must be at least this far behind the rod for evade to fire
   },
// clear lane: step out of the way for a teammate rod behind us about to clear the ball forward
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
   // smart rods wait for the ball to reach the sweet spot instead of poking at full stretch
   waitTta:2.,        // only wait if the ball reaches the rod within this (s)
   waitMinVX:3,         // …and is approaching at least this fast in x

   // dead-ball push: with the whistle this close a rod with the ball at its feet stops deliberating and plays it
   force:{
      on:true,
      left:1.6,           // real seconds left on the dead-ball clock when it kicks in
      align:3.5           // a forced swing counts as lined up within this z gap (u); a ball resting on the boot sits just past footBox.z + ballR (3.25)
   },

   // --- goal targeting (accuracy = DIFFS.aim) ---
   aimGain:20,                                // converts desired lateral into a z aim-offset
   aimMax:1.2,                                // clamp on that offset (u)
   aimGoalZ:0.85,                              // aim within ±this fraction of goalHalf
   aimSpread:1.3,                             // low-accuracy spray width across the mouth
   // gap aiming: accurate rods steer at the widest open lane and hold a covered shot briefly
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
   // Defensive positioning: GK and DEF sit on the ball→own-goal line.
   defend:{
      on:true,
      engage:5.5,         // only line-block while the ball is at least this far in front
      lineBias:1,       // 1 = sit exactly on the line; 0 = track ball z
      dumbBias:0.45       // fraction of that a low-iq rod commits
   },
   alignSlow:1.2, alignFast:1.25,             // z-alignment tolerance for a swing (slow / fast ball)

   // Strike gate: replay the swing curve and refuse an aimed shot the boot can't reach.
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
// wall play: an end man can't reach a wall ball, so a forward strike off one bends into the rod's aim
   wallPlay:{
      on:true,
      gap:2.5,            // ball-to-wall gap under which a strike counts (pinned = 0; an end man's reach leaves 2.1)
      minAng:0.28,        // infield heading floor off the wall (rad, ~16°)
      maxAng:0.52,        // …and ceiling when aiming at the rod's target (rad, ~30°)
      minW:4,             // the boot must be swinging forward at least this fast (rad/s)
      minVX:10,           // …and the ball leaving forward at least this fast (u/s)
      human:false         // also apply to player-held rods
   },
   slowSpeed:35,                              // ball speed under this counts as a dead ball
   cdSlow:[1,2.5], cdFast:[0.5,1.5],       // kick cooldown random range, slow / fast ball (× DIFFS.cd)
   errEvery:[1.7,6.],                        // how often a fresh wandering aim-error target is rolled (s)

   // --- active rods + anti-jitter ---------------------------------------
   hands:4,                                   // rods per team the AI moves at once (not a cap on human seats)
   pairCommit:0.3,                            // min seconds a rod stays active before it can be swapped
   manHyst:2.1,                               // z-units a different man must beat the current one by to steal aim
   retargetDead:0.1,                          // z the desired slide must differ by before re-aiming
   errLerp:7.0,                               // rate the wandering aim error drifts to its new target (per s)
   slideAccel:600                             // AI rod slide acceleration cap (u/s²)
 },

  /* ---- 3D player models ----------------------------------------------- */
 playerModel:{
  default:'cyborg',
  // a figurine GLB is one sub-mesh per material (5), each its own shadow draw; `casterFrac` (CONFIG.render.shadow.quality) decides how many cast
  // figurine registry: add an entry and a .glb and it shows in Customize; teamParts = team-coloured materials, hairParts = hair swatch, mug = portrait
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
   /*{id:'stormer',name:'Stormer',blurb:'Cold and endless',
      src:'assets/fuzeball_stormer.glb',scale:0.8,
      mug:'assets/renders/render_stormer_mugshot.png',   
      teamParts:['kit_stormer'],hairParts:[],
      explosionSrc:'assets/animations/stormer_explosion.glb'
   },
*/
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
   {id:'manDeano',name:'Deano',blurb:'Calm and clinical',
      src:'assets/fuzeball_manDeano.glb',scale:0.8,
      mug:'assets/renders/render_deano_mugshot.png',
      teamParts:['kit_deano'],hairParts:[],
      explosionSrc:'assets/animations/deano_explosion.glb'
   },

   // WOMEN
   {id:'womanMaria',name:'Maria',blurb:'Determined and strong',
      src:'assets/fuzeball_womanMaria.glb',scale:0.8,
      mug:'assets/renders/render_maria_mugshot.png',   
      teamParts:['kit_maria'],hairParts:['kit_maria_hair'],
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
   {id:'womanSasha',name:'Sasha',blurb:'Cunning and quick',
      src:'assets/fuzeball_womanSasha.glb',scale:0.8,
      mug:'assets/renders/render_sasha_mugshot.png',
      teamParts:['kit_sasha'],hairParts:[],
      explosionSrc:'assets/animations/sasha_explosion.glb'
   },
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
  // quick-pick kit swatches (Kick Off, Customize, New League): club-kit colours, not screen primaries
  // a new save's kits (and Customize reset all): crimson v royal
  kitDefault:['#d0142c','#1e5bd8'],
  swatches:['#d0142c','#f0661a','#f2c200','#138a3e','#00a19a','#1e5bd8','#17264f','#6a2c91','#ece6d6','#3a3d44'],
  // Customize's figurine strip: square cards between min and max px, minRows..maxRows rows, then it scrolls sideways
  strip:{ min:72, max:104, minRows:2, maxRows:3 },
  // Natural hair colours for random tinting.
  hairSwatches:[  '#1a1a1a','#2d1b0e','#3d2b1f','#5c4033','#8b6b47','#583b00','#985d29',
                  '#242222','#1b0f06','#271d15','#382922','#634d32','#242320','#8b5526', 
                  '#f6f1ba','#c49a6c','#aa7d53','#6b3f1a','#4a2c1a','#b8860b','#daa520','#cd853f'],
  kitYaw:0.55,   // Kick Off figurines face each other, turned this far toward the camera
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
   // rod layout, 1-2-5-3 per side; x along the long axis, team 0 = red (attacks +x); slideCap overrides the max slide
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
  //   speed = slide speed (u/s), react = perceived-position smoothing, reactDelay = reaction latency (s, under CONFIG.ai.reactMax)
  //   err = aim wander, range = reach, pred = lead on the ball, cd = kick cooldown x, aim = accuracy 0..1, iq = smart-choice chance 0..1
  rookie:{speed:30,react:.3,err:0.9,range:5.0,pred:.45,cd:0.9,aim:.5,iq:.40,reactDelay:.1},
  pro:   {speed:39,react:.25,err:0.75,range:5.8,pred:.7,cd:.75,aim:.65,iq:.55,reactDelay:.07},
  legend:{speed:43,react:.2,err:.55, range:6.6,pred:0.9,cd:.50,aim:.9,iq:.8,reactDelay:.04}
 },

 // ---- rod stats (league builds) ----
 // six 0-10 stats per rod; base (5) is neutral, every multiplier is 1 there
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
   fatStart:30, fatEnd:180,   // seconds where fatigue starts / reaches full
   fatMax:.25,        // slow-down at a fully tired rod; sta scales the rate of tiring (stTire), not this depth
   tireFloor:0.75,    // slowest a rod may tire, as a fraction of a sta-0 rod's rate (0 = max stamina never tires)
                      // stamina channel B: each swing costs exertion, which bleeds off again
  kickFat:{
   on:true,
   weight:.55,      // share of the ramp driven by swinging (the clock keeps the rest)
   per:1,           // exertion banked per swing
   full:30,         // swings at which this channel is fully spent
   recover:.12,     // exertion bled off per second
   cap:1.25,        // ceiling as a multiple of `full`
   userDrain:true  // whether human-held rods accrue it too
  }
 },

/* ---- league mode ------------------------------------------------------ */
  league:{
    divSize:10,           // teams per division (even; 10 → 9 rounds)
    goals:5,              // goals to win (live and simulated), and the per-team cap when timed
    // timed leagues sim each fixture with a random total goal count in this range, split by strength and capped at `goals` per team
    simMinGoals:1,        // fewest total goals a simmed timed match can produce
    simMaxGoals:9,        // …and the most
    baseDiff:'rookie',    // brain difficulty for league teams; a division's `diff` overrides it
    upWin:3, upLoss:1, upCleanSheet:1, // upgrade parts awarded per result
    playerStart:10,       // parts the player starts a fresh league with
    cost:[1,2,2,3,5],    // cost of raising a stat from level 5+i
    tape:true, tapeT:3,   // pre-match splash on/off + duration (s); click to skip
    tapeReadyCap:2.5,     // max wait for the figurine portraits to decode first (0 = don't wait)
    graceT:10,             // seconds after match start where quitting does not forfeit
    simK:.5,              // how steeply a stat edge shifts per-goal probability (logistic)
    // silverware, one per tier; `trophy.id` is the art key (assets/renders/render_trophy_<id>_cycles.webp, _thumb.webp, tools/trophy-alpha.mjs)
    divisions:[            // tier order: 0 bottom .. 2 top
      {name:'Sunday League', base:2, diff:'pro',   aiBudget:[5,10], room:'open',  skin:'sundayLeague',  table:'classic',  pitch:'pub_classic', trophy:{id:'sunday',  name:'Sunday League Trophy',   col:'#b9c6da'}},
      {name:'Pro League',    base:4, diff:'pro',      aiBudget:[5,10], room:'pub',   skin:'proLeague',  table:'classic',  pitch:'cork', trophy:{id:'pro',     name:'Pro League Cup',        col:'#d9a55e'}},
      {name:'Premier League',base:5, diff:'legend',   aiBudget:[5,10], room:'arcade',  skin:'premierLeague',  table:'classic',  pitch:'royal', trophy:{id:'premier', name:'Premier League Trophy', col:'#ffcf4d'}}
    ],
    promoteN:2, relegateN:2,  // top/bottom N swap between divisions each season
    upPromote1:5, upPromote2:3, // upgrade parts for a 1st / 2nd place promotion
    upChampTop:5,             // parts for winning the top division
    promoteBoost1:2, promoteBoost2:1, // stat-floor boost per still-at-base stat, 1st / 2nd place
    relegateLose:1,           // stat points removed from every stat per role block on relegation
    relegateFloor:1,          // a stat can't drop below this via relegation
    slots:6,                  // number of save slots
    // zone-rating weights for the statistical sim; offMix/defMix = ATT-vs-MID and GK-vs-DEF shares
    rate:{
       offMix:.6, defMix:.55,
       att:{str:.3,acc:.3,ctl:.2,spd:.1,rea:.05,sta:.05,iq:.12},
       mid:{spd:.25,ctl:.25,str:.15,acc:.15,rea:.1,sta:.1,iq:.12},
       gk: {rea:.35,spd:.25,ctl:.15,sta:.1,acc:.1,str:.05,iq:.06},
       def:{rea:.25,str:.25,spd:.2,ctl:.15,sta:.15,iq:.1}
    },
    // AI upgrade-spend weights per role — gives AI teams position-flavoured builds.
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
/* ---- champions cup (post-season KO for the top-division champion) ----- */
   cup:{
      name:'Champions Cup',
      trophy:{id:'champions', name:'The Champions Cup', col:'#ffd98a'},
      diff:'legend',
      seeded:true,     // false = random draw
      table:'arena', skin:'standard', room:'arcade', pitch:'champions_green', // venue; pitch is the fallback
      pitches:['champions_green','champions_purple'], // drawn per tie
      goals:5, special:true, power:true,
      poolSize:12, drawSize:7,                      // elite teams generated / drawn per cup (+ player)
      base:8, budget:[3,5],                       // elite build base + weighted spend
      enterParts:3, tieParts:4, winParts:6,         // parts for entering / winning a tie / lifting it
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
 control:{ slideSpeed:95, mouseSens:1.35, autoDelay:1.2, nameMaxLength:20,
  mouseSpan:23,   // mouse slide: table units per screen-height of movement, the same on every rod (before the sens multipliers)
  // auto-switch hand-over (ai.js autoHoldRod): a rod in `roles` is withheld while the AI deals with the shot
  handover:{
   on:true,
   roles:['GK'],   // rods held back mid-save. ['GK','DEF'] gives the defence the same courtesy
   closing:25,     // ball must run at our own goal faster than this (u/s) to be worth withholding for
   reach:6,        // z distance beyond the keeper's slide range at which it can't get there (out wide is yours at once)
   behind:2.5,     // how far behind the keeper the ball still counts as at its boot (a frame at 140 u/s is 2.3 units)
   maxHold:1.4,    // hard cap: however the save goes, the rod is yours after this (s)
   settle:0.09     // slide input ignored for this long after a hand-over, so an in-flight swipe can't fling the new rod (s)
  }},

 /* ---- seats (local co-op roster, js/seats.js + js/roster.js) ---------- */
 seats:{
  max:8,          // humans who can join one match, total
  perTeam:4,      // …and on one side (capped by the rod count, not CONFIG.ai.hands)
  maxPads:8,      // gamepad indices the lobby hands out ('pad0'…'pad{maxPads-1}')
  // HSL offset per seat on a side, so two players on one team are told apart.
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

  // pickup look: a type in `models` floats as that GLB, anything else uses the gem
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
    // dead = position stays inside a moveEps box for the given time (travel, not speed)
    moveEps:2,          // horizontal box the ball must roam wider than to count as in play
    stallT:4.6,         // every ball boxed in this long → whistle + re-drop them all (s)
    wedgeT:2.2,         // multi-ball: one ball boxed in this long → re-drop just it (s)
    zoneMult:3,         // timer speed-up inside a table deadzone (1 = none)
    roofMult:3,         // …and for a ball settled on top of the goal (1 = none)
    // while a man can still swing at the ball the dead-ball clock runs slower, up to a `graceMax` budget per stall
    live:{
     on:true,
     mult:0.4,        // clock speed while the ball is strikeable (1 = no discount, 0 = frozen)
     graceMax:2.5,    // most extra REAL seconds one stall can earn
     // strikeable window around each man; mirrors CONFIG.ai.inFrontMax and the back edge of the overFoot zone
     ahead:6.3,       // units IN FRONT of the rod the ball still counts as strikeable
     back:1.5,        // …and behind it
     zPad:0.6         // slack on the z line-up, beyond footBox.z + BALL_R
    },
    // Dead lanes between the rows. Per-lane `mult` overrides the shared one.
    rodGaps:{
     on:true,
     mult:2,          // timer speed-up inside a lane
     lanes:[
      {x0:-46, x1:-44},   // red GK -52.5 ↔ red DEF -37.5 · same team
      {x0:-31, x1:-29},   // red DEF -37.5 ↔ blue ATT -22.5 · facing each other
      {x0:-17, x1:-13},   // blue ATT -22.5 ↔ red MID -7.5 · facing away
      {x0:-1,  x1:1},     // red MID -7.5 ↔ blue MID 7.5 · facing each other
      {x0:13,  x1:17},    // blue MID 7.5 ↔ red ATT 22.5 · facing away
      {x0:29,  x1:31},    // red ATT 22.5 ↔ blue DEF 37.5 · facing each other
      {x0:44,  x1:46}     // blue DEF 37.5 ↔ blue GK 52.5 · same team
     ]
    },
    // where a dead or out-of-play ball comes back in: face-off zones whose `from` ranges must tile the table
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
  // ...of those, the ones with no mirror partner, dropped from the cycle when no single team owns the camera
  soloOnly:[1,8],
  // MENU SHOTS: the camera eases to the current screen's shot (keyed by screen id, js/screens.js); unlisted = home
  // same [x,y,z, lookX,lookY,lookZ] as the modes; home looks left of centre so the table clears the menu
  menuShots:{
   home:   [-12,58,80, -30,4,6],    // three-quarter from the near side, table to the right
   menu:   [0,70,62, 0,10,4],       // Kick Off: square on, both ends in frame
   options:[0,54,74, 0,2,8],        // square on and low: the table centred behind the centred settings
   training:[30,92,34, 8,0,0],      // high over the attacking third
   tutorial:[0,70,62, 0,10,4],      // square on like Kick Off: the whole table, before you learn it
   trials: [30,92,34, 8,0,0],
   daily:  [30,92,34, 8,0,0],
   lgSlots:[62,70,64, 6,4,0],       // the league: high broadcast angle from the blue corner
   lgSetup:[62,70,64, 6,4,0],
   league: [62,70,64, 6,4,0],
   championsCup:[62,70,64, 6,4,0]
  },
  menuLerp:1.4,   // ease rate toward a menu shot (a move, not a cut; a match uses lerp)
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

/* ---- audio mix (js/audio.js) ----------------------------------------- */
  audioMix:{
   master:0.55,
   limiter:{on:true,threshold:-7,knee:8,ratio:10,attack:0.004,release:0.15},
   voices:{wall:{gap:0.055,max:4},kick:{gap:0.02,max:6},post:{gap:0.05,max:3},react:{gap:0.25,max:2},
           ui:{gap:0.045,max:3},sting:{gap:0.3,max:2}},
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
   },

   // ---- recorded sounds ----
   // files under assets/audio/ named <id>_01.ogg, <id>_02.ogg...; run node tools/build_audio_manifest.js; an id with no files plays its synthesized version
   // variants: <id>_<ballType>, <id>_hard (above hardFrom); a recorded ir_<roomId>.wav replaces a room's reverb
   samples:{on:true, folder:'assets/audio/', manifest:'manifest.json'},

   // stereo placement from the ball's on-screen position; width 1 = hard left/right, keep it well under 1
   pan:{on:true, width:0.5},

   // ---- room reverb ----
   // sends into the room (the crowd more), scaled by each room's fx/crowd; the impulse is generated from the room's numbers unless ir_<roomId> exists
   //   decay = RT60 (s), damp = starting brightness (Hz), darken = how fast it loses top end, early = first reflections, pre = gap before the tail, crowdHp/Lp = crowd band-limit
   // kept here, not in CONFIG.rooms: the room editor's export drops unknown keys
   reverb:{on:true, fx:0.14, crowd:0.28,
    def:{decay:0.8, damp:5000, darken:2.0, early:0.5, pre:0.008, fx:1, crowd:1, crowdHp:60, crowdLp:16000},
    rooms:{
     open:  {decay:0.28, damp:2600, darken:4.0, early:0.15, pre:0.004, fx:0.6, crowdHp:380, crowdLp:3200},  // a deck in vacuum
     saucer:{decay:1.35, damp:7500, darken:1.4, early:0.5,  pre:0.010},   // metal hull: bright, ringing
     pub:   {decay:0.65, damp:3800, darken:3.0, early:0.7,  pre:0.006},   // small, soft furnishings, warm
     arcade:{decay:0.9,  damp:5500, darken:2.0, early:0.55, pre:0.008},
     moon:  {decay:1.5,  damp:6000, darken:1.2, early:0.8,  pre:0.012}    // a hard dome
    }},

   // ---- the crowd ----
   // three looping layers (crowd_bed_calm / _busy / _wild) crossfaded by excitement = base + last big moment (Au.exc, decays at excDecay/s) + tension (ball in an attacking third)
   // with no recorded beds, a synthesized crowd of `voices` people, a `secs` loop at `sr`, opening from synthLp[0] to [1] Hz as it gets louder
   crowd:{
    base:0.12, tension:0.25, tensionFrom:0.55, excDecay:0.3,
    volLo:0.10, volHi:0.32,        // bed level at excitement 0 and 1 (about -35 and -26 dB RMS with the stand-in)
    voices:36, secs:8, sr:24000, synthLp:[2200,6000]
   },

   // ---- per-sound playback ----
   //   bus = fx|crowd|ui, vol = level, pitch/volJ = random spread per play, send = reverb send (x the room's), gate = shared voice cap with its synth
   //   pRef = impact speed at full level (falls toward pFloor on a pCurve), pPitch = pitch rise soft to hard, exc = crowd lift, syn:false = recorded only
   // what each sound is lives in the Fuzeball Sound List artifact
   sounds:{
    // the table
    ball_kick:   {bus:'fx', vol:0.9, pitch:0.05, volJ:0.1, send:1,   gate:'kick', pRef:90, pFloor:0.15, pCurve:0.8, pPitch:0.08, hardFrom:0.7},
    ball_wall:   {bus:'fx', vol:0.8, pitch:0.06, volJ:0.1, send:1,   gate:'wall', pRef:80, pFloor:0.08, pCurve:1},
    ball_floor:  {bus:'fx', vol:0.7, pitch:0.06, volJ:0.1, send:1,   gate:'wall', pRef:60, pFloor:0.08, pCurve:1},
    ball_hit:    {bus:'fx', vol:0.8, pitch:0.06, volJ:0.1, send:1,   gate:'wall', pRef:80, pFloor:0.1,  pCurve:1},    // ball on ball
    ball_post:   {bus:'fx', vol:0.9, pitch:0.02, volJ:0.1, send:1.4, gate:'post', pRef:90, pFloor:0.25, pCurve:0.8},
    ball_goal:   {bus:'fx', vol:0.9, pitch:0.04, volJ:0.08, send:1, syn:false},   // into the goal and down the return
    ball_drop:   {bus:'fx', vol:0.8, pitch:0.04, volJ:0.08, send:1, syn:false},   // the serve: fed in, rattling onto the pitch
    // match
    whistle:     {bus:'fx', vol:0.8, pitch:0.02, send:0.8},
    whistle_end: {bus:'fx', vol:0.8, send:0.8, syn:false},   // full time as one take; without it, three singles
    count_tick:  {bus:'fx', vol:0.7},
    count_go:    {bus:'fx', vol:0.8},
    clock_tick:  {bus:'fx', vol:0.6},
    power_pickup:{bus:'fx', vol:0.8, pitch:0.03, send:0.5},
    cannon_warn: {bus:'fx', vol:0.7, send:0.5},
    cannon_boom: {bus:'fx', vol:1.0, pitch:0.04, send:1.2},
    // stingers: the Federation's brass and gold
    sting_goal:  {bus:'fx', vol:0.8, gate:'sting'},
    sting_win:   {bus:'fx', vol:0.8, gate:'sting'},
    sting_trophy:{bus:'fx', vol:0.8, gate:'sting'},
    sting_medal: {bus:'fx', vol:0.8, gate:'sting'},
    // the crowd
    crowd_bed_calm:{bus:'crowd'},
    crowd_bed_busy:{bus:'crowd'},   // no stand-in of its own: the synthesized bed crossfades calm into wild
    crowd_bed_wild:{bus:'crowd'},
    crowd_ooh:     {bus:'crowd', vol:0.55, pitch:0.04, volJ:0.1,  send:1,   gate:'react', exc:0.30},
    crowd_gasp:    {bus:'crowd', vol:0.45, pitch:0.04, volJ:0.1,  send:1,   gate:'react', exc:0.20},
    crowd_groan:   {bus:'crowd', vol:0.55, pitch:0.04, volJ:0.1,  send:1,   gate:'react', exc:0.12},
    crowd_cheer:   {bus:'crowd', vol:0.6,  pitch:0.03, volJ:0.1,  send:1,   gate:'react', exc:0.6},
    crowd_roar:    {bus:'crowd', vol:0.65, pitch:0.03, volJ:0.08, send:1,   gate:'react', exc:1},
    crowd_applause:{bus:'crowd', vol:0.8,  pitch:0.03, volJ:0.1,  send:1.2},   // claps are spiky: a low RMS for their peak
    crowd_jeer:    {bus:'crowd', vol:0.5,  pitch:0.04, volJ:0.1,  send:1,   gate:'react', exc:0.1, syn:false},
    // menus
    ui_move:  {bus:'ui', vol:0.7, pitch:0.02},
    ui_value: {bus:'ui', vol:0.7, pitch:0.02},
    ui_tab:   {bus:'ui', vol:0.8},
    ui_click: {bus:'ui', vol:0.8},
    ui_back:  {bus:'ui', vol:0.8},
    ui_open:  {bus:'ui', vol:0.8},
    ui_error: {bus:'ui', vol:0.8},
    ui_start: {bus:'ui', vol:0.9},
    ui_rod:   {bus:'ui', vol:0.6, pitch:0.03},
    ui_wipe:  {bus:'ui', vol:0.6, syn:false}
   }
  },

/* ---- ball types ----------------------------------------------------- */
  // per ball: name (HUD copy), colour, mass, max speed, trail; an `audio` block overrides the synthesised contact sounds
  ballTypes:{
   classic:{
      name:'CLASSIC',col:0xf2ede2,em:0x000000,
      mass:2.5,maxV:130,w:50,trail:'#ffffff',
      audio:{
         kick:{noiseDur:.06,noiseFreq:380,noiseFreqScale:12,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
               beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.25,beepSlide:-45},
         // wall/floor tap: noiseVol = quietest tap, noiseVolScale = growth with impact speed, body* = low thump under hard hits
         wall:{noiseDur:.045,noiseFreq:2200,noiseFreqScale:4,noiseVol:.012,noiseVolScale:.0035,noiseVolMax:.30,q:.9,
               bodyFrom:55,bodyFreq:150,bodyDur:.055,bodyVolScale:.0016,bodyVolMax:.16,bodySlide:-55},
         // Sustained-contact roll: warm floor, thin bright scrape.
         roll:{floor:{vol:.26,freq:250,freqScale:5.0,q:.7},
               wall: {vol:.20,freq:620,freqScale:11,q:1.5}},
         post:{noiseDur:.03,noiseFreq:3200,noiseVolScale:.5,freqs:[523,832,1290,1900],droop:.94,
               attack:.003,decay:.28,vol:.14,volScale:.004,volMax:.5}
      }
   },
   fire:   
      {name:'FIREBALL',col:0xff6a1f,em:0xff2200,
      mass:1.5,maxV:150,w:14,trail:'#ff8c3a',light:0xff5500,markMul:1.5,   // scorches harder than a rubber scuff
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
      mass:10,maxV:100,w:120,trail:'#000000',
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
      mass:1.75,maxV:110,w:10,splits:true,trail:'#c39bff',
      audio:{
         kick:{noiseDur:.06,noiseFreq:380,noiseFreqScale:12,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
            beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.25,beepSlide:-15},
         // wall/floor tap: noiseVol = quietest tap, noiseVolScale = growth with impact speed, body* = low thump under hard hits
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
      // Flutter ball: side-spin re-rolled on a short timer so the flight weaves.
      name:'KNUCKLEBALL',col:0x5be0ff,em:0x0a3a66,
      mass:1.75,maxV:110,w:12,trail:'#8fffda',light:0x33cfff,
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
      mass:9,maxV:120,w:5,value:2,trail:'#ffd75e',metal:.85,
      audio:{
         kick:{noiseDur:.055,noiseFreq:1500,noiseFreqScale:3,noiseVol:.04,noiseVolScale:.0025,noiseVolMax:.38,
               beepFreq:500,beepDur:.85,beepType:'triangle',beepVol:.009,beepVolScale:.0035,beepVolMax:.028,beepSlide:-2},
         wall:{noiseDur:.05,noiseFreq:2000,noiseFreqScale:3.5,noiseVol:.013,noiseVolScale:.0034,noiseVolMax:.28,q:2.2,
               bodyFrom:45,bodyFreq:190,bodyDur:.09,bodyVolScale:.0020,bodyVolMax:.20,bodySlide:-25},
         roll:{floor:{vol:.30,freq:200,freqScale:4,q:1.4},         // dense and ringy
               wall: {vol:.25,freq:900,freqScale:9,q:3.0}},
         post:{noiseDur:.028,noiseFreq:3000,noiseVolScale:.48,freqs:[587,880,1319,1760],droop:.93,
               attack:.003,decay:.26,vol:.15,volScale:.0045,volMax:.52}
      }
   },
  },

  ballReflect:{on:true,res:32,every:2,near:1,far:300,intensity:1},

  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:true,  // true = use the ball GLB, false = a generated sphere
   fractureFx:true,     // false = skip the explosion GLBs and vanish instantly
   roomEditor:false,
        // true = F2 opens the room editor (js/roomedit.js)
  },

 /* ---- power-up types ------------------------------------------------- */
 // `col` is the pickup mesh/particle colour and the tint of its HUD tab mark (HUD_FX in hud.js)
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

 /* ---- layout editor presets (js/layout.js) -------- */
 // the layout editor's preset picker: Default (the screen's CSS), these built-ins, then the player's own (cfg.layoutPresets)
 // author one: arrange a screen, run layExport('<key>') in the console, paste the line into that key's list (keys: menu, menuRules, league, leagueClub, championsCup)
 layoutEditor:{
   presetsMax:8,             // own presets kept per screen
   presets:{}
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
 // No comments INSIDE a room entry: the room editor's export (F2) replaces the whole block, and tools/roomlights-harness.js checks for it. Notes on a room go here.
 //   sky: six cube faces <src>_px ... _nz (models.js ensureSky); r128 can't rotate or dim a background, so both are baked in
 //   open (Void): tools/build_void_asteroid.py then ktx2-encode.mjs, nebula tools/build_nebula_sky.py then sky-encode.mjs; no GLB lights, warm shadowless dir key
 //   moon: tools/build_moon_base.py + ktx2-encode, sky tools/build_moon_sky.py; dir.pos must point along the sky's SUN_DIR (sky-harness); `shots.home` sits low so Earth clears the rim
 //   saucer: tools/build_saucer_room.py then ktx2-encode (raw GLB in tools/build/saucer/), sky tools/build_saucer_sky.py then sky-encode; the giant sits at azimuth -73 just under the horizon and shows through the low-sill bay panes (-90..-30), saucer-harness checks they agree; props are baked in the GLB (not props.js), glows and floor paint are the two blended decal sheets
  rooms:{
   open:{
      name:'Void', folder:'assets/rooms/void/', glb:'fuzeball_room_void.glb', backdrop:false, reflect:false,
      bg:0x05060f, fog:[210,440],
      sky:{src:'assets/rooms/void/sky/nebula'},
      hemi:{sky:0xcdd9ff,ground:0x1c1610,int:0.6,on:true},
      dir:{color:0xffd2a0,int:1.1,pos:[-140,70,-90],on:true,shadow:false},
      env:{shell:0x07111c,panels:[[0x3f8fa8,-250,30,-110,260,120],[0xb8621f,250,30,110,260,120],[0x123f5e,0,150,-250,340,90],[0xdcecff,0,155,0,150,150]]},
      lights:[
        {type:'spot', pos:[-55,26,31], look:[-40,0,0], color:0xffffff, int:2.65, dist:150, decay:2, angle:0.6, penumbra:0.32},
        {type:'spot', pos:[0,36,0], look:[0,0,0], color:0xffffff, int:2.95, dist:65, decay:1, angle:0.68, penumbra:0.24},
        {type:'spot', pos:[55,26,31], look:[40,0,0], color:0xffffff, int:2.6, dist:150, decay:2, angle:0.6, penumbra:0.32}
      ],
      props:[],
      led:{idle:'rainbow'}
   },
   saucer:{
      name:'Flying Saucer', folder:'assets/rooms/saucer/', glb:'fuzeball_room_saucer.glb', reflect:true,
      light:{gain:0,reach:0},
      bg:0x04070b, fog:[800,1600],
      sky:{src:'assets/rooms/saucer/sky/saucer'},
      hemi:{sky:0x8fc9d6,ground:0x2a1c10,int:0.34,on:true},
      dir:{color:0xffffff,int:1.27,pos:[45,100,35],on:false},
      env:{shell:0x0a1a20,panels:[[0xffd9a0,0,150,0,150,150],[0x7fd0d8,-250,40,-100,260,120],[0xffa24a,250,40,100,260,120]]},
      lights:[
        {type:'spot', pos:[-55,26,0], look:[-40,0,0], color:0xffd9a8, int:2.1, dist:140, decay:2, angle:0.97, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xeaf6ff, int:2.1, dist:90, decay:0.6, angle:0.68, penumbra:0.12, shadow:true},
        {type:'spot', pos:[55,26,0], look:[40,0,0], color:0xffd9a8, int:2.1, dist:140, decay:2, angle:0.97, penumbra:0.32, shadow:true}
      ],
      props:[],
      led:{idle:'rainbow'}
   },
      pub:{
      name:'British Pub', folder:'assets/rooms/pub/', glb:'fuzeball_room_pub.glb', reflect:true,
      light:{gain:3.6,reach:3.2},
      lightsOff:['room_light_fire'],
      bg:0x120c07, fog:[190,410],
      hemi:{sky:0xffd9a3,ground:0x140a04,int:0,on:true},
      dir:{color:0xffcf95,int:1.31,pos:[40,90,30],on:false,shadow:false},
      env:{shell:0x1a1108,panels:[[0xffa94d,-240,40,-100,260,140],[0xff7b2e,240,40,100,260,140],[0xffe6c0,0,150,0,160,160]]},
      lights:[
        {type:'spot', pos:[-55,26,0], look:[-40,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xffffff, int:2.2, dist:70, decay:0.6, angle:0.68, penumbra:0.12, shadow:true},
        {type:'spot', pos:[56,26,0], look:[40,0,0], color:0xffffff, int:2.35, dist:290, decay:2, angle:0.6, penumbra:0.32, shadow:true},
        {type:'spot', pos:[-0.26,97.08,1.86], look:[-0.26,95.61,1.86], color:0xffd899, int:0.415, dist:310.7, decay:2, angle:0.698, penumbra:0.35}
      ],
      props:[],
      led:{idle:'rainbow',color:0xffb454}
   },
   arcade:{
      name:'Neon Arcade', folder:'assets/rooms/arcade/', glb:'fuzeball_room_arcade.glb', reflect:false,
      light:{gain:0,reach:0.2},
      bg:0x5c5d60, fog:[170,465],
      hemi:{sky:0x8ea0ff,ground:0x180a24,int:0.52,on:false},
      dir:{color:0xd6b8ff,int:1.07,pos:[45,100,35],on:true,shadow:false},
      env:{shell:0x0b1022,panels:[[0x18e0ff,-250,30,-110,260,120],[0xff2bd6,250,30,110,260,120],[0x9b6bff,0,150,-250,340,90],[0xffffff,0,155,0,150,150]]},
      lights:[
        {type:'spot', pos:[-57.14,26,0], look:[-40,0,0], color:0x28aeca, int:2.6, dist:55, decay:2, angle:0.76, penumbra:0.32, shadow:true},
        {type:'point', pos:[0,36,0], look:[0,0,0], color:0xf2e9ba, int:3, dist:70, decay:1, angle:0.74, penumbra:0.24, shadow:true},
        {type:'spot', pos:[55.1,26,0], look:[40,0,0], color:0xaf71ba, int:2.6, dist:55, decay:2, angle:0.76, penumbra:0.32, shadow:true}
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
   moon:{
      name:'Moon Base', folder:'assets/rooms/moon/', glb:'fuzeball_room_moon.glb', reflect:true,
      bg:0x000000, fog:[900,1000],
      sky:{src:'assets/rooms/moon/sky/moon'},
      shots:{home:[-12,32,116,-24,20,-30]},
      hemi:{sky:0x1c2533,ground:0x4d4a45,int:0.45,on:true},
      dir:{color:0xfff3e2,int:2.3,pos:[-91.9,82.7,40.2],on:true,shadow:true},
      env:{shell:0x030304,panels:[[0xfff3e2,-250,140,110,120,120],[0x5a5752,0,-200,0,500,500],[0x6fa8ff,60,60,-250,60,60]]},
      lights:[
        {type:'spot', pos:[-55,26,31], look:[-40,0,0], color:0xeef3ff, int:1.9, dist:150, decay:2, angle:0.6, penumbra:0.32},
        {type:'spot', pos:[0,36,0], look:[0,0,0], color:0xeef3ff, int:2.1, dist:65, decay:1, angle:0.68, penumbra:0.24},
        {type:'spot', pos:[55,26,31], look:[40,0,0], color:0xeef3ff, int:1.9, dist:150, decay:2, angle:0.6, penumbra:0.32}
      ],
      props:[],
      led:{idle:'rainbow'}
   },
  },
  // Legacy theme-key → room-id map, for old saves.
  themeToRoom:{classic:'open',royal:'pub',verdant:'open',neon:'arcade',cyatron:'arcade'},

  /* ---- pitches ------- */
  pitches:{
   pub_classic:      {folder:'assets/pitches/', glb:'pitch_pub_classic.glb',      tex:'pitches/pubClassic.jpeg',      name:'Pub Classic'},
   cork:             {folder:'assets/pitches/', glb:'pitch_cork.glb',             tex:'pitches/cork.jpeg',            name:'Cork'},
   royal:            {folder:'assets/pitches/', glb:'pitch_royal.glb',            tex:'pitches/royal.jpeg',           name:'Royal Grass', grass:true},
   cyatron:          {folder:'assets/pitches/', glb:'pitch_cyatron.glb',          tex:'pitches/cyatron.jpeg',         name:'Cyatron Grid'},
   neon:             {folder:'assets/pitches/', glb:'pitch_neon.glb',             tex:'pitches/neon_nights.jpg',      name:'Neon Nights'},
   verdantia:        {folder:'assets/pitches/', glb:'pitch_verdant.glb',          tex:'pitches/verdantia.jpeg',       name:'Verdantia'},
   champions_green:  {folder:'assets/pitches/', glb:'pitch_champions_green.glb',  tex:'pitches/champions_green.png',  name:'Champions Green', grass:true},
   champions_purple: {folder:'assets/pitches/', glb:'pitch_champions_purple.glb', tex:'pitches/champions_purple.png', name:'Champions Purple', grass:true},
   moon:             {folder:'assets/pitches/', glb:'pitch_moon.glb',             tex:'pitches/moon.jpeg',            name:'Moon Dust'},   // tools/build_moon_pitch.mjs
   deck:             {folder:'assets/pitches/', glb:'pitch_deck.glb',             tex:'pitches/deck.jpeg',            name:'Deck Plate'},  // tools/build_deck_pitch.mjs
   },

  // ---- blade grass (js/grass.js) ----
  // a pitch opts in with `grass:true` or `grass:{...}` (blade overrides); visual only; units are game units (1 = 1 cm)
  grass:{
   on:true,
   amount:{ low:0.3, high:1 },  // share of the blades drawn per cfg.grass quality ('off' = none)
   blade:{
    height:0.45,    // tallest blade tip above the pitch
    density:4.0,    // blades per unit along each axis (~106k over a 120x68 pitch)
    width:0.1,      // blade breadth at the root (it narrows by a third to the tip)
    slant:0.4,      // the tip: the low top corner stands this fraction of the height below the high one
    lean:0.25,      // random curl across the blade's face at the tip, fraction of its height
    minH:0.45,      // shortest blade, as a fraction of height
    ao:0.55,        // colour at the root (dark) ...
    tip:1.12,       // ... to the tip (a touch brighter)
    sway:0.09,      // idle sway at the tip, fraction of its height
    press:0.85,     // how flat a ball on the floor presses the grass (0..1)
    pressR:2.6,     // radius of that press, units
    seed:7          // lawn layout; the same seed always grows the same lawn
   }
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
   // resident PointLights effects borrow from, keeping the light count constant (changing it recompiles); overflow drops the glow
   lightPool:3,
   warmMatch:true, // true = compile every fx a match can fire before kickoff

   heat:{
    on:true,
    from:0.94, full:1.0,
    col:0xff2a10,
    glow:1.5,
    tint:0.3,
    pulse:7, pulseAmt:0.22,
    trail:0.8
   },

   /* ---- explosion smoke (js/fx.js smokeBurst / smokeUpdate) ----*/
   smoke:{
    on:true,
    count:16,           // pool size — the most puffs that can be alive at once
    burst:10,           // puffs one cannonball throws
    stagger:0.04,       // seconds between them, so the cloud blooms instead of popping
    lifeMin:1.6, lifeMax:2.6,
    sizeMin:7.0, sizeMax:16.0, // width at birth, in table units (the table is 68 across)
    offset:8,           // how far off the blast a puff may start (stops the cloud being one blob)
    grow:4.2,           // how many times wider it ends up
    rise:9,             // upward drift, units/sec
    spread:12,          // sideways speed off the blast
    drag:1.0,           // how fast that sideways push dies away
    spin:1.4,           // turn rate, rad/sec, random direction per puff
    alpha:0.4,          // peak opacity of one puff — the first knob to turn down if the cloud hides too much
    fadeIn:0.1,         // fraction of life spent fading up
    fadeOut:0.45,       // ...and fading out; it holds full in between so the cloud is solid while it opens
    hot:0xff8a3c,       // colour at birth — still lit by the fireball
    cool:0x6a6e78,      // colour it settles to
    coolBy:0.3,         // fraction of life it takes to get there

    /* The dust wave rolling off the floor*/
    ring:{ on:true, life:0.8, from:3, to:26, alpha:0.32, col:0x6b6259, y:0.25, fadeHi:14 }
   },

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
   },

   /* ---- rod holes as a STAMINA gauge (js/fx.js rodHolesUpdate) ----------*/
   rodHoles:{
    on:true,
    
    fillMin:0.06, fillSoft:0.07,
    /* the COLOUR of the lit part. idle = costing nothing, hot = fully slowed. */
    idle:0x3CB82A, warm:0xffb648, hot:0xff3b3b,
    mid:0.55,              // where `warm` sits on the 0..1 cost axis
    gamma:0.75,            // <1 opens up the shallow end, where a default-stamina rod lives
    glow:1.6,              // emissive ADDED to the lit part (the authored material is left alone)
    lerp:6,                // smoothing per second — stops a ring flickering on a noisy value
    pulseFrom:0.70, pulseHz:2.2, pulseDepth:0.45,  // a badly-slowed ring breathes rather than sitting flat

    // the wind-up, in the seat marker's four colours (CONFIG.shots.charge.bandCol); duplicate of the marker, so switch off if the rings feel busy
    charge:{ on:true, glow:3.2, min:0.35 },       // min = how lit a charge is the instant it arms

    // a goal flashes the scorer's own ring on the LED strips' clock (fx.js ledUpdate); an own goal flashes the offending rod in `own`
    goal:{ on:true, glow:4.5, dim:0.12, hz:0, hold:0, own:0x7d8796 }
    //         hz 0 = follow the LED strobe rate · hold 0 = follow MATCH.goalHold
   } },

 /* ---- training mode (js/training.js) ---------------------------------- */
 training:{
  spawn:{x:0,z:0},                   // where the first ball drops on entering training
  launch:{speed:60,angle:0,loft:10},  // launcher defaults: speed u/s · angle° (0 = toward +x) · loft u/s
  speedMax:200,                      // launcher speed/loft clamp (keep ≤ ball maxV)
  clampMargin:2,                     // placed balls are clamped this far inside the walls
  ringColor:0x2bff88                 // click-place ghost ring + panel accent
 },

 // ---- the tutorial (js/tutorial.js) ----
 // training with a lesson plan; offered once before the first Kick Off or League match (cfg.tutSeen), finishing sets cfg.tutDone
 // lesson text: [act] = first binding as a keycap, [mouse] = the mouse, {A} {LT+X} {LB/RB} = pad glyphs
 // `rods` = your rods shown, `start` = the one you hold, `ball` = placement (vx = rolled at you, re-served when it dies), `check` = the tutCheck test
 tutorial:{
  on:true,
  firstMatch:true,   // offer it before the first Kick Off / League match
  nextDelay:1.1,     // beat between a lesson done and the next one set up (s)
  stuckT:25,         // after this long on one lesson the skip is offered (s)
  serveEvery:3.0,    // a rolled ball is re-served once it has been dead this long (s)
  slideDist:36,      // SLIDE: table units of rod travel to pass
  lessons:[
   {id:'slide',name:'SLIDE',rods:['ATT'],ball:null,check:'slide',
    kbm:'Move the [mouse], or hold [slideUp] and [slideDown], to slide your players across the table.',
    pad:'Push {LS} up and down to slide your players across the table.'},
   {id:'kick',name:'KICK',rods:['ATT'],ball:{x:25.4,z:0},check:'goal',
    kbm:'Press [kick] to kick. Put it in the net.',
    pad:'Press {A} to kick. Put it in the net.'},
   {id:'raise',name:'RAISE',rods:['ATT'],ball:{x:6,z:0,vx:34},check:'raise',
    kbm:'A ball is coming from behind. Hold [raise] to lift your players and let it through.',
    pad:'A ball is coming from behind. Hold {X} to lift your players and let it through.'},
   {id:'switch',name:'SWITCH RODS',rods:['DEF','MID','ATT'],start:'ATT',ball:null,check:'switch',
    kbm:'Press [rodPrev] and [rodNext] to change rods. Take hold of all three.',
    pad:'Press {LB} and {RB} to change rods. Take hold of all three.'},
   {id:'pass',name:'PASS',rods:['MID','ATT'],start:'MID',ball:{x:-4.9,z:0},lift:false,check:'pass',
    kbm:'Hold [finesse] and press [kick] to pass up to your attack.',
    pad:'Hold {LT} and press {A} to pass up to your attack.'},
   {id:'power',name:'POWER SHOT',rods:['ATT'],ball:{x:25.4,z:0},check:'charge',
    kbm:'Hold [power] and [raise] to wind up, then kick with [kick] while the marker glows gold.',
    pad:'Hold {RT} and {X} to wind up, then kick with {A} while the marker glows gold.'},
   {id:'pin',name:'PIN',rods:['ATT'],ball:{x:36,z:0,vx:-17},check:'pin',
    kbm:'A ball is coming. Hold [finesse] and tap [raise] to tilt your players and pin it.',
    pad:'A ball is coming. Hold {LT} and tap {X} to tilt your players and pin it.'},
   {id:'pinShot',name:'PIN SHOT',rods:['ATT'],ball:{x:36,z:0,vx:-17},keep:true,check:'pinShot',
    kbm:'Keep [finesse] held and kick with [kick]. Slide first and it goes in at an angle.',
    pad:'Keep {LT} held and kick with {A}. Slide first and it goes in at an angle.'}
  ]
 },

 /* ---- skill trials (js/trials.js) --------- */
 trials:{
  on:true,
  pinTable:true,    
  resultDelay:0.8,

/* ---- the five disciplines  */
   cats:[
   {id:'GK',  name:'GOALKEEPER',sub:'Handle it, then start the move'},
   {id:'DEF', name:'DEFENCE',   sub:'Win it back, then play it long'},
   {id:'MID', name:'MIDFIELD',  sub:'Keep the ball moving'},
   {id:'ATT', name:'ATTACK',    sub:'Finish, and finish fast'},
   {id:'TEAM',name:'TEAM',      sub:'The whole rack, working as one'}
  ],

  list:[
// GK 
   {id:'distro',name:'DISTRIBUTION',cat:'GK',blurb:'Play it out from the back. Six clean balls between your keeper and your defence.',
    seed:70669,table:'classic',
    ball:{type:'classic',x:-48,z:0},
    hold:null,rods:{show:['0|GK','0|DEF']},
    goal:{kind:'stat',stat:'passes',n:6},limit:45,
    medals:{gold:15,silver:25,bronze:40}},

// THE SHOT-STOPPING TRIAL
   {id:'lastline',name:'THE LAST LINE',cat:'GK',blurb:'Ten attacks, one keeper, no defenders. Keep out as many as you can.',
    seed:96331,table:'classic',
    ball:{type:'classic',x:-27.2,z:0},
    hold:'GK',rods:{show:['0|GK','1|GK','1|DEF','1|MID','1|ATT']},
    ai:[false,true],diff:'pro',
    goal:{kind:'saveRun',n:10,attemptT:14,serveDelay:1.2,
     spawns:[
      {x:-27.2,z:  0},{x:-26.6,z: -4},{x:-27.6,z:  5},{x:-26.8,z: -8},{x:-28.0,z:  9},
      {x:-26.4,z: -2},{x:-27.4,z: 10},{x:-26.9,z:-10},{x:-28.2,z:  6},{x:-27.0,z: -7}
     ]},
    limit:0,
    medals:{gold:9,silver:7,bronze:5}},

// DEF
   {id:'longball',name:'THE LONG BALL',cat:'DEF',blurb:'Twice from your own defence, past a keeper who never moves.',
    seed:83117,table:'classic',
    ball:{type:'classic',x:-34,z:0},
    hold:'DEF',rods:{show:['0|DEF','1|GK']},
    goal:{kind:'goals',n:2},limit:60,
    medals:{gold:18,silver:30,bronze:48}},

//  MID
   {id:'onetwo',name:'ONE-TWO',cat:'MID',blurb:'Five completed passes between your midfield and your attack.',
    seed:52733,table:'classic',
    ball:{type:'classic',x:-3,z:0},
    hold:null,rods:{show:['0|MID','0|ATT']},
    goal:{kind:'stat',stat:'passes',n:5},limit:45,
    medals:{gold:18,silver:28,bronze:40}},

// ATT
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

   {id:'frame',name:'RATTLE THE FRAME',cat:'ATT',blurb:'Ring the woodwork three times. Posts and bar both count.',
    seed:44021,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT']},
    goal:{kind:'stat',stat:'woodwork',n:3},limit:75,
    medals:{gold:25,silver:40,bronze:65}},

   {id:'wall',name:'THE WALL',cat:'ATT',blurb:'Three past a keeper that actually moves.',
    seed:61457,table:'classic',
    ball:{type:'classic',x:26.5,z:0},
    hold:'ATT',rods:{show:['0|ATT','1|GK']},
    ai:[false,true],diff:'pro',
    goal:{kind:'goals',n:3},limit:45,
    medals:{gold:15,silver:25,bronze:40}},

// TEAM 
   {id:'fullset',name:'THE FULL SET',cat:'TEAM',blurb:'Score once with your defence, once with your midfield, once up front.',
    seed:31889,table:'classic',
    ball:{type:'classic',x:-34,z:0},
    hold:null,rods:{show:['0|GK','0|DEF','0|MID','0|ATT']},
    goal:{kind:'roleGoals',roles:['DEF','MID','ATT']},limit:90,
    medals:{gold:40,silver:60,bronze:85}}
  ],

/* ---- the daily challenge (FEATURE-IDEAS 3.3) --- */
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

/* ---- goal instant replay (js/replay.js) ------------------------------ */
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
  audio:{
   on:true,        // re-fire the rally's sounds during playback
   gain:0.9,       // level of a replayed sound vs the same sound live
   pitch:0.85,     // how far pitch follows the playback rate (0 = normal pitch throughout)
   pitchMin:0.3,   // pitch floor
   goalSting:true, // re-fire the goal horn on the freeze-frame, at normal pitch
   events:192      // ring capacity for logged sounds (overflow drops the oldest)
  },
  // armed at the first frame of every replay so the key writes the whole replay; costs one encode per goal
  save:{
   on:true,
   // the key is a binding (CONFIG.binds.def.saveClip, rebindable); every other key still skips
   pad:3,          // gamepad button (A/B/Start still skip)
   hint:'[S] save clip',   // fallback only; the live hint is built from the saveClip binding
   hintPad:'{Y} save clip',// ...and {BTN} a pad button, by its Xbox slot. Keep in step with `pad` (3 = Y)
   saving:'SAVING CLIP'
  },
  // camera shot placement in world units; `gx` is the beaten goal's end (±60), so values marked ×gx mirror
  shots:{
   rail: {y:26, z:52, followX:.8, bob:2.5},       // sideline dolly: height, distance out, ball chase, bob
   net:  {xMult:1.35, y:22, rise:6, sway:7},      // behind the goal: x past the line (×gx), height, climb, drift
   crane:{xFrom:.62, xTo:1.02, yFrom:42, yTo:20, zFrom:46, zTo:30}, // corner crane: start→end (x ×gx)
   drone:{y:62, dip:8, z:26, sway:8},             // sky drone: height, descent, base z, drift
   ball: {back:6, up:2, minY:1.5, lookAhead:34, lookY:4} // ball cam: trail distance, height, floor, gaze x/y
  }
 },

/* ---- clip capture (js/capture.js) ------------------------------------ */
 capture:{
  on:true,             // master switch for the recorder
  fps:60,              // canvas capture rate (keep above 0)
  bitrate:12000000,    // video bits/s
  audio:true,          // mux the game audio into the clip
  audioBitrate:128000, // audio bits/s
  chunkMs:250,         // MediaRecorder timeslice
  revokeMs:20000,      // how long the blob URL is held alive after the download fires
  prefix:'fuzeball_goal',  // download filename prefix
  // first supported wins (js/capture.js clipMime); MP4/H.264 leads (every editor takes it), WebM is the Firefox path
  // avc1 levels: 640033 = High L5.1, 64002A = High L4.2, 42E01E = Baseline L3.0
  mime:['video/mp4;codecs=avc1.640033,mp4a.40.2','video/mp4;codecs=avc1.64002A,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4',
        'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
 },

// ---- photo mode (js/photo.js, F1) ----
// everything here is a limit or a default; `on:false` removes the mode
 photo:{
  on:true,
  key:'F1',            // toggle. preventDefault'd, or the browser opens its own help
  freezeOnEnter:true,  // halt the sim the instant the mode opens — the whole point of a still
  freezeFx:true,       // ...and particles / trails / the LED pulse with it (fxUpdate runs at rdt 0)
  hideDebug:true,      // the C overlay's proxies would land in the shot; restored on exit
  hideMarks:true,      // opening state of the markers toggle (held-rod cones, drop ring, sweet-spot guide)

  // --- panel groups ---
  // sections collapse and cfg.photoGroups remembers them; this is the first-run state (ids: shot cam look frame scene shots path cap seq keys)
  defOpen:['shot','cam','cap'],

  // --- rig ---
  // always an orbit; 'Free look' pins the camera and moves the target instead, one set of limits
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
// --- movement rates ---
// key* per second, drag* per pixel, wheel per notch; Shift = fast, Ctrl or Alt = fine
  speed:{keyPan:70, keyRise:45, keyOrbit:70, keyDolly:90,
   fast:3.4, fine:0.15,
   dragOrbit:0.30,   // degrees per pixel
   dragPan:0.14,     // world units per pixel, x(dist/100); a fixed gain is glued at 300u and violent at 10
   dragDolly:0.006,  // middle-drag: FRACTION of the current distance per pixel
   wheel:0.09},      // ...and per wheel notch, same reason

  // --- framing ---
  // a crop is a letterbox mask; photoCropFov() narrows the vertical fov by the crop's height fraction
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

  // --- capture ---
  // output px = crop CSS px x scale, rendered at pixelRatio 1 (cfg.renderScale can't cap a still); maxPx clamps to the GL limit
  scales:[1,2,3,4],
  defScale:2,
  maxPx:8192,           // hard ceiling; clamped again against the GL context's own limits
  prefix:'fuzeball_shot',
  flash:0.16,           // seconds the white shutter flash holds
  shutter:true,         // two-tone shutter click on capture
  // reallocate the shadow map at the still's scale for the one frame; false = the live map size
  shadowBoost:true,
  shadowMax:4096,

  // --- turntable ---
  // for orbiting video grabs, not stills; fights the freeze by design
  spin:{speed:9, min:1, max:60},   // deg/s

  // --- clip recorder (R) ---
  // records the crop via an off-screen canvas for js/capture.js; bounded by the live backing store
  record:{
   on:true,
   audio:false,        // a camera move has no soundtrack; true muxes the game audio like a goal clip
   fps:60,
   bitrate:24000000,   // video bits/s. A turntable is slow, smooth, high-detail — deliberately generous
   mime:['video/mp4;codecs=avc1.640033','video/mp4;codecs=avc1.64002A','video/mp4;codecs=avc1.42E01E',
         'video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'],
   maxPx:2560,         // long-edge ceiling; the blit downscales past it (even dimensions)
   autoStop:true,      // a recording STARTED with the turntable on stops itself after one 360°
   maxSec:120,         // hard backstop for a free (non-turntable) take
   prefix:'fuzeball_turntable'
  },

  // --- offline turntable render (SHIFT+R) ---
  // frame by frame: exact CFR, full resolution, no codec; one STORE zip
  seq:{
   on:true,
   heights:[720,1080,1440,2160],  // width comes from the CROP's aspect
   defHeight:1080,
   fps:[24,30,60], defFps:30,
   secs:10, secsMin:2, secsMax:40,   // one full revolution over this long
   // jpeg at .92 is ~8x smaller than png and indistinguishable once graded as h.264; png survives compositing
   fmt:'jpeg', quality:0.92,
   /* Rough bytes-per-pixel for the size ESTIMATE on the panel. Deliberately generous. */
   bpp:{jpeg:0.22, png:1.6},
   maxFrames:1800,          // 60s at 30fps
   maxBytes:1200000000,     // ~1.2GB. Frames are held in memory until the zip is written.
   maxPx:4096,              // per-axis ceiling, clamped against the GL context's own limit
   shadowBoost:true,        // as for a still: a 2048 map stretched over a 2160p frame reads as a render
   readme:true,             // drop the ffmpeg line + import fps into the zip
   prefix:'fuzeball_turntable'
  },

  // --- camera path (V) ---
  // an order of saved slots plus a duration (slots are referenced, not copied); R rolls a real-time take, SHIFT+R renders it offline
  path:{
   on:true,
   secs:8, secsMin:1, secsMax:60,   // how long the whole move takes, end to end
   maxPts:12,        // waypoints per path. A slot may repeat - 1 - 3 - 1 is a there-and-back
   // Catmull-Rom through the waypoints instead of straight legs (off = dolly-and-cut)
   smooth:true,
   // ease in and out over the whole move rather than per leg; ignored on a loop
   ease:true,
   loop:false,
   live:false,       // sweep with the sim RUNNING. Real-time recorder only - see phSeqStart
   recAutoPlay:true, // R restarts the move from the top and rolls
   recAutoStop:true, // ...and writes the take out when it lands
   recTail:0.4,      // seconds held on the end pose before the take closes, so there is a cut point
   prefix:'fuzeball_path'
  },

  slots:6               // saved-shot slots (persisted in cfg.photoShots)
 },

};

// =========== Derived aliases ===========
const F=CONFIG.table;
const BALL_R=CONFIG.physics.ballR, ROD_H=CONFIG.physics.rodH, PLAYER_H=CONFIG.physics.playerH, ARM=CONFIG.physics.arm,
       PRAD=CONFIG.physics.prad, GRAV=CONFIG.physics.grav,
       FOOT_T=CONFIG.physics.footT, FOOT_BOX=CONFIG.physics.footBox, FOOT_BOX_OFF=CONFIG.physics.footBoxOff,
       FOOT_BOX_REACH=CONFIG.physics.footBoxReach, FOOT_JITTER=CONFIG.physics.footJitter;
const AUMIX=CONFIG.audioMix, AUSND=CONFIG.audioMix.sounds, AUC=CONFIG.audioMix.crowd;
const PHY=CONFIG.physics, KICK=CONFIG.kick, AIC=CONFIG.ai, CTRL=CONFIG.control,
      PWR=CONFIG.powerups, DEAD=CONFIG.deadball, CAM=CONFIG.camera, MATCH=CONFIG.match, SRV=CONFIG.serve, SIM=CONFIG.sim, REPLAY=CONFIG.replay,
      CAPTURE=CONFIG.capture, PHOTO=CONFIG.photo, MOM=CONFIG.moments, MSTAT=CONFIG.matchStats, SHOT=CONFIG.shots;
const RODDEFS=CONFIG.rods.defs, DIFFS=CONFIG.diffs, BALL_TYPES=CONFIG.ballTypes,
       PU_TYPES=CONFIG.puTypes, ROOMS=CONFIG.rooms, CUP=CONFIG.league.cup;
const pCount=CONFIG.fx.particleCount;
const ARENA=CONFIG.tables.arena.bowl;   // bowl shape params, read by arena.js

// =========== Persisted player settings (localStorage) ===========
// the in-menu options, distinct from the CONFIG tuning knobs above
let cfg={diff:'pro',goals:5,gameTime:0,room:'arcade',reflections:true,fog:true,table:'classic',pitch:'pub_classic',skins:{},special:true,power:true,auto:true,sound:true,ambience:true,replay:true,
 // Options > Audio: bus volumes 0..1 (square curve in Au.mix); muteBg silences an unfocused window
 volMaster:1,volFx:1,volCrowd:1,volUi:1,muteBg:false,
 // the tutorial (js/tutorial.js): offered once before the first match, and finished at least once
 tutSeen:false,tutDone:false,
 // the "kick = pin shot" plate while a ball is pinned (js/hud.js); Options > Display
 pinHint:true,
 // gameTime: match limit in minutes (0 = unlimited, first to `goals`).
 redName:'Team 1',blueName:'Team 2',redColor:CONFIG.playerModel.kitDefault[0],blueColor:CONFIG.playerModel.kitDefault[1],
 // Per-team AI difficulty (overrides legacy single `diff`).
 diffRed:null,diffBlue:null,
 // Customize panel: figurine, material finish and size per team.
  modelRed:'cyborg',modelBlue:'cyborg',redYaw:-0.55,blueYaw:0.55,
  redMetalness:.15,redRoughness:.45,redGlow:0,redScale:1,
  blueMetalness:.15,blueRoughness:.45,blueGlow:0,blueScale:1,
  // true = keep the material values exported with the model.
  redFinishDefault:false,blueFinishDefault:false,
 // controls: sensitivities multiply CTRL.slideSpeed / CTRL.mouseSens; padSlideCurve 1 = linear, >1 = finer near centre
padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,
// Total Control pad: LT eases slide toward padTCFine, RT toward padTCFast, neither = padTCBase
padControlMode:'classic',padTCBase:0.75,padTCFine:0.35,padTCFast:1.6,padTCSwerve:1,padTCSpinInvert:false,
// classic charge input: 'rt' (RT holds the wind-up), 'kick' (the kick button holds it, a tap fires on release) or 'both'
padChargeBtn:'rt',
mouseSens:1,kbdSens:1,
// rebound keyboard/mouse actions: action -> [codes], only for actions the player changed (js/binds.js)
keyBinds:{},
// cursor lock: hides the pointer and lets the mouse run past the screen edge; ESC releases it and pauses
mouseLock:true,
// per-screen panel arrangements from the Layout editor: screen-id -> {v:2,p:{elId:{x,y,w,h}},h}
layouts:{},
// the player's own layout presets: screen-id -> [{n:name, L:<a layouts entry>}]; synced
layoutPresets:{},
// display: renderScale scales the device pixel ratio, fpsCap 0 = uncapped, gfxPreset = last-picked preset
// shadowQuality picks a tier from CONFIG.render.shadow.quality (only while `shadows` is on); grass = 'off'|'low'|'high'
renderScale:1,shadows:true,shadowQuality:'low',grass:'high',fpsCap:0,showFps:false,gfxPreset:'high'};
// =========== WHERE A SETTING LIVES: PLAYER vs MACHINE ===========
// cfg persists as two localStorage keys: PLAYER (Cloud-synced) and MACHINE (this computer only, e.g. renderScale)
// adding a setting: put its key in exactly one set (an unlisted key defaults to PLAYER and is reported once)
const CFG_KEY={player:'fuzeball_player',machine:'fuzeball_machine',legacy:'fuzeball'};

// never leaves this computer: display, performance, hardware calibration, window geometry
const CFG_MACHINE=new Set([
 'renderScale','shadows','shadowQuality','grass','fpsCap','showFps','gfxPreset','physQuality','reducedFx','trails',
 'particles','marks','rodHoles','reflections','fog','profiler',
 'layouts',        // per-screen panel arrangements (width-relative since v:2 so they'd survive syncing; kept local for now)
 'padDeadzone',    // stick calibration: a drifty pad on ONE machine, not a preference
 'volMaster','volFx','volCrowd','volUi','muteBg'   // volume is set to THIS machine's speakers, not carried to a Deck
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
// control preferences sync (inversion, sensitivity, TC curve, charge button); padDeadzone doesn't (calibrated to a stick)
 'padSlideAxis','padAngleAxis','padSlideSens','padAngleSens','padSlideCurve',
 'padSlideInvert','padAngleInvert','padControlMode','padTCBase','padTCFine','padTCFast',
 'padTCSwerve','padTCSpinInvert','padChargeBtn','mouseSens','kbdSens','mouseLock','keyBinds',
'trials','daily','trnSpots','photoShots','photoPath','photoGroups','layoutPresets',  // progress + authored content
 'tutSeen','tutDone',                                            // the tutorial: offered once, and finished (an achievement reads tutDone)
 'pinHint',                                                      // an on-screen help preference, follows the person
 'theme','model','metalness','roughness','glow','modelScale'     // legacy, migrated just below
]);
/* Bucket a key. Unlisted -> PLAYER, reported ONCE per key per session. */
const cfgWarned=new Set();let cfgOrphans=null;
function cfgBucket(k){
 if(CFG_MACHINE.has(k))return 'machine';
 if(!CFG_PLAYER.has(k)&&!cfgWarned.has(k)){cfgWarned.add(k);(cfgOrphans||(cfgOrphans=[])).push(k);}
 return 'player';
}
function cfgSplit(src){const o={player:{},machine:{}};for(const k in src)o[cfgBucket(k)][k]=src[k];return o;}
// the Steam Cloud manifest: the Electron wrapper mirrors these localStorage keys to JSON files for Auto-Cloud; excludes machine and legacy
function cfgSyncKeys(){
 const out=[CFG_KEY.player,'fuzeball_league_slot','fuzeball_career'];
 try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
  if(k&&k.indexOf('fuzeball_league_')===0&&k!=='fuzeball_league_slot')out.push(k);}}catch(e){}
 return out;
}
// load: player first, then machine on top, so a stale player value loses to this computer's
(function cfgLoad(){
 let p=null,m=null;
 try{p=JSON.parse(localStorage.getItem(CFG_KEY.player)||'null');}catch(e){}
 try{m=JSON.parse(localStorage.getItem(CFG_KEY.machine)||'null');}catch(e){}
 if(p||m){if(p)Object.assign(cfg,p);if(m)Object.assign(cfg,m);return;}
 // first boot after the split: fold the legacy blob in and let the first saveCfg() write the two new keys
 // the legacy 'fuzeball' key is kept as a one-time backup
 let l=null;try{l=JSON.parse(localStorage.getItem(CFG_KEY.legacy)||'null');}catch(e){}
 if(l)Object.assign(cfg,l);
})();
if(cfg.model&&!cfg.modelRed){cfg.modelRed=cfg.model;cfg.modelBlue=cfg.model;delete cfg.model;saveCfg();}
// Migrate the legacy single `diff` into per-team fields when those are missing.
if(!cfg.diffRed)cfg.diffRed=cfg.diff||'pro';
if(!cfg.diffBlue)cfg.diffBlue=cfg.diff||'pro';
cfg.diff=cfg.diffRed;
// migrate the legacy global finish into per-team fields; old saves keep identical Red+Blue
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
// anything that isn't a known tier reads as Low, so an old save keeps the tuning it was running
if(cfg.shadowQuality!=='high')cfg.shadowQuality='low';
if(!['off','low','high'].includes(cfg.grass))cfg.grass='high';
if(cfg.fpsCap!=='match'&&typeof cfg.fpsCap!=='number')cfg.fpsCap=0;   // number, or 'match' (track detected refresh)
if(typeof cfg.showFps!=='boolean')cfg.showFps=false;
if(typeof cfg.profiler!=='boolean')cfg.profiler=false;   // frame profiler overlay (M)
if(typeof cfg.gfxPreset!=='string')cfg.gfxPreset='high';
if(typeof cfg.physQuality!=='string')cfg.physQuality='high';
if(typeof cfg.reducedFx!=='boolean')cfg.reducedFx=false;
if(typeof cfg.trails!=='boolean')cfg.trails=true;
if(typeof cfg.particles!=='boolean')cfg.particles=true;
if(typeof cfg.marks!=='boolean')cfg.marks=true;
if(typeof cfg.rodHoles!=='boolean')cfg.rodHoles=true;   // rod-hole stamina rings
// (legacy cfg.theme is left as-is, only the pitch migration below reads it)
// per-table chosen skin: table-id -> skin-id; missing = the table's defSkin
if(!cfg.skins||typeof cfg.skins!=='object')cfg.skins={};
if(!cfg.layouts||typeof cfg.layouts!=='object')cfg.layouts={};
if(!cfg.layoutPresets||typeof cfg.layoutPresets!=='object')cfg.layoutPresets={};
// Migrate old saves: derive pitch from theme if missing (theme→pitch map).
if(!cfg.pitch){
  const tm={pub_classic:'pub_classic',classic:'classic',neon:'cyatron',royal:'royal',verdant:'verdantia'};
  cfg.pitch=tm[cfg.theme]||'pub_classic';
  saveCfg();
}
// Clamp figurine yaws into the slider range (fixes an old saved blueYaw:10.0 default).
cfg.redYaw=clamp(cfg.redYaw||0,-Math.PI,Math.PI);cfg.blueYaw=clamp(cfg.blueYaw||0,-Math.PI,Math.PI);
// persist the player's settings; during a league/cup fixture its venue belongs to the league save, so lgVenueHeld's values are written
function saveCfg(){try{
 // a league venue and a skill trial's table are parked, not live, so Options can't make them the Kick Off setting
 const v=((typeof lgVenueHeld==='function')&&lgVenueHeld())||((typeof trialVenueHeld==='function')&&trialVenueHeld());
 // the venue substitution happens before the split: table/room/pitch/skins are PLAYER keys
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
 high:{subTravel:0.20,subMax:16},   // 16: ~0.5us per substep per ball measured live (2026-09-25), so a fast rally costs microseconds
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
// snapshot a material's authored finish once so Default can restore it (applyTeamFinish calls it first)
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
