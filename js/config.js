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

  /* ---- match / rules -------------------------------------------------- */
  match:{
  countIn:3.6,      // opening countdown length (s)
  recount:1.5,      // countdown length after a goal/out
  goalHold:2.0,     // 'goal' celebration phase before re-count (s)
  goalSlowmo:0.25,  // time-scale during that phase (slow-mo)
  outHold:1.0       // pause after a ball goes out (s)
 },

 /* ---- simulation timing ---------------------------------------------- */
 sim:{
  hz:120,        // fixed physics rate (steps/sec). The sim always advances in
                 // constant 1/hz slices; the renderer interpolates between slices,
                 // so motion is smooth at any display refresh. Higher = crisper
                 // collisions at more CPU. 120 is a good balance.
  maxSteps:8     // max fixed steps run in a single frame (spiral-of-death guard:
                 // after a long stall we drop the backlog instead of freezing)
 },

 /* ---- table geometry ------------------------------------------------- */
 table:{ L:120, W:68, wallH:10, goalHalf:11, goalH:9.5, goalDepth:9 },

 /* ---- table types ------------------------------------------------------ */
 // Classic uses CONFIG.table (flat walls, 90° creases) untouched. Arena is the
 // curved Rocket-League-style bowl: rounded-rect walls + floor fillet. All
 // radii are in table units; tweak and reload. The Blender pipeline mirrors
 // these numbers — keep the constants block in tools/build_arena_table.py in
 // sync if you retune here (GLBs live in assets/tables/arena/).
 tables:{
  arena:{
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
   postR:8,           // smooth-union radius where the crease/walls blend into the goal mouth
   mouthIn:8,         // how far the goal cavity punches inward past the goal line (opens the mouth)
   bigGoalReach:20,   // big-goal widen: x-distance IN FRONT of the goal line over which the mouth
                      //   widen fades to 0 (behind the line it's full). ~cornerR+mouthIn covers the
                      //   whole mouth flare; raise it to pull more of the front end-wall out with the mouth.
   bounceCut:6,       // normal-speed below which crease/wall contact rolls instead of bouncing
   fricNy:0.3,        // contact normal.y above this counts as 'grounded' → floor friction applies
   gradEps:0.02,      // central-difference step for the SDF gradient
   seg:{loop:200,profile:10} // visual mesh resolution: samples around the perimeter / up the profile
  }
 },

 /* ---- core physics --------------------------------------------------- */
physics:{
   ballR:1.8, rodH:7.50, playerH:-6.90, arm:6.30, prad:1.0, grav:250,
   footT:0.99,                      // arm-fraction from pivot to foot centre (1=foot, 0.85 = 15% above foot)
   footBox:{x:0.9,y:1.3,z:1.35},     // foot box half-extents: {x=along leg, y=perpendicular, z=along rod}
   footBoxOff:{x:0.35,y:0.5},        // centre offset from foot-base in rod-local: {x=along leg, y=perpendicular}
   footBoxReach:0.5,                // multiplier on BALL_R for foot-box collision distance (lower = tighter)
   footJitter:0.1,                // random velocity perturbation fraction after foot collision (prevents perfect oscillations)
  subMin:3, subMax:6, subTravel:1.65,   // adaptive substep bounds + target travel per step
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
  windup:0.0,  windupA:-0.45,   // pull-back window / angle
  strike:0.08,  strikeA:1.,     // strike ramp end / peak forward angle
  hold:0.20,                     // hold peak until this time
  drop:0.3,                     // fully returned by this time
  raiseA:-1.6, raiseLerp:14, dropLerp:12, // lift-men angle + settle rates
  padAngleLerp:40,                // right-stick angle smoothing: 0 = DIRECT 1:1 (stick position = rod angle, full swing speed);
                                 //   >0 = optional exponential ease rate (1/s) if you want softer control. Keep 0 for a true
                                 //   flick-through where fast stick motion = fast rod = hard kick (angVel-driven strike power).
  userSpeed:80,                  // slide speed of the player-driven rod (u/s)
  aiOwnMult:0.85,                // AI rods on the user's team slide a bit slower
   boostHitMult:2.50, freezeMult:0.1, // power-up multipliers: boost (hit impulse), freeze (speed)
  rest:0.01, restPower:0.4,     // ball restitution: passive touch vs kick power window
  powFrom:0.05, powTo:0.08,      // kickT window that counts as the power strike
  grip:0.15,                     // how much the foot's velocity is imparted to the ball
  // --- sweet spot: a clean strike landing in the narrow CENTRE of the foot (z) AND a tight
  //     forward band (dir-relative x, measured off the rod like the AI's overFoot zone) earns
  //     a POWER bonus and forces the aim-assist on — even outside the timed power window. The
  //     bonus scales with the rod's acc stat (an accurate rod gets more out of a clean hit) and
  //     a smart AI rod (its iq roll) adds a little more. It rewards good alignment for free: a
  //     low-err (accurate) rod centres the ball better, so it lands in this zone more often.
  //     on:false restores the flat, position-independent kick. ---
  sweetSpot:{
   on:true,
   zFrac:0.3,          // sweet z half-width = footBox.z × this, centred on the foot (0.3 → ±0.405u)
   xMin:0.8, xMax:1.8, // dir-relative x band ahead of the ROD the ball must strike within (a tight ~2u
                       //   sweet zone sitting where a clean forward drive contacts — cf. overFootOffset 2.59)
   strBase:0.12,       // hit-impulse bonus at neutral acc (stat base 5): +12%
   strAcc:0.40,        // extra hit-impulse bonus scaling to +40% at max acc (linear from base)
   iqBonus:0.15,       // extra bonus fraction when the rod's iq roll is set this frame (smart AI only)
   forceAssist:true,   // apply aimAssist on a sweet hit even when NOT in the timed power window
   shake:0.32          // small screen-shake kick so a sweet strike feels punchy (juice)
  },
  spinGain:0.02, spinClamp:2,    // side-spin from sliding into the ball
  sndFrom:18, hardHit:70, shakeDiv:400, // kick sound threshold / hard-hit sparks / shake scale
  splitVel:62, splitMax:3, splitAng:0.45, splitSep:3.2 // split-ball: trigger speed, max balls, spread angle, z sep
 },

 /* ---- AI behaviour --------------------------------------------------- */
 ai:{
  gkPad:2,                                   // keeper stays within goalHalf + this
  ttaMax:1.9,                                // only lead the ball's z if it arrives within this (s)
  inFrontMin:-0.45, inFrontMax:6.9,            // ahead-window that a forward swing can reach (connects to overFoot, no dead band)
  underFootFront:3.0, underFootBack:-1.5,    // behind/ahead of rod where swung rod stays forward (prevents own-goal swipe on return)
  lowY:2,                                    // only swing when the ball is below this height
  raiseBehind:-7.2,                          // ball must be at least this far behind (real, dir-relative) to consider raising
   overFoot:2.9,                              // |Δx| under which the ball is 'at the feet' and strikeable (≈footR+ballR sweet spot)
   overFootOffset:2.59,                        // shift the overFoot zone this far forward (dir-relative) so it sits in front of the men, not straddling the rod — prevents latch releasing too early as the ball 
   
   // --- safe-lower side-step: a rod held forward after a kick (ball still in the
   //     drop-sweep zone, so updateRods pins it at strike angle) slides sideways until
   //     every foot is at least clearZ from the ball in z, then lowers on its own.
   //     clearZ per foot = footBox.z + BALL_R + clearMargin. Stops the hover-forever
   //     deadlock where the AI kept re-aligning ONTO the ball it was hovering over.
   //     Debug: 'Drop Sweep' layer in the AI panel shows the per-man danger boxes. ---
   repositionSpeed:45,                        // max ball speed that triggers the side-step (above this, shots pass through raised men)
   clearMargin:1.8,                           // extra z-clearance beyond footBox.z + BALL_R before lowering is safe
   // --- inFootRange helper: the dir-relative rectangle a foot can touch, ONE source of truth
   //     for the safe-raise / safe-lower "would we clip the ball?" questions. Forward depth =
   //     underFootFront (a dropping/kicking swing); back depth = footRangeBack (a raising swing
   //     sweeps behind); z half-width = footBox.z + BALL_R + clearMargin (a foot's z footprint,
   //     shared with the drop-sweep lowering check). ---
   footRangeBack:7.2,                         // backward x depth of a foot's reach rectangle (mirrors the trap-zone depth)

    // --- foot-trap break: drop a raised rod when a slow ball is pinned right at a foot.
   //     (NOTE: previously referenced but never defined — made the check dead code.) ---
   footTrapSlow:14.0,                         // ball speed under this is "pinned"
   footTrapZ:0.1,                            // ball within this z of any foot counts as "at the foot"

   // --- trap action (r.act='trap'): a slow ball arriving from behind is CAUGHT instead
   //     of full-raised over — the rod eases to a partial back angle (full raiseA just
   //     pops the ball away on the drop), holds it a beat, then scoops a shot forward.
   //     Only rods whose iq roll passed (DIFFS.iq) attempt it; everyone else keeps the
   //     old raise latch. on:false restores pre-trap behaviour exactly.
   //     Debug: 'Trap Zone' layer in the AI panel (purple; hot while a rod is trapping). ---
    trap:{
     on:true,
     angle:-0.5,        // partial back-raise trap angle (rod-local, ×kickDir like raiseA)
     lerp:8,             // ease rate toward the trap angle (slower than raiseLerp — a soft catch)
     back:-5.9,          // dir-relative x window behind the rod where a trap makes sense…
     front:-.05,         // …ends just behind the rod line (past this the normal kick path owns it)
     maxVX:35,           // ball |v.x| must be under this — enough x-speed will reach the feet on its own
     maxSpeed:25,        // total ball speed cap for attempting/keeping a trap
     alignZ:1.5,         // z-alignment (nearest man) needed to commit to the trap
     gkReach:15,          // GK-only: also enter the trap when the ball is within this far BEYOND
                        //   the keeper's z-slide band (early-detect a ball drifting back toward a
                        //   goal it can't yet slide onto). Outfield rods ignore this, use alignZ.
     settleT:0.5,       // min seconds in the trap before the scoop shot may fire
     shootFrom:-1.6,     // scoop fires once the ball is past this (near the trap foot's reach)
     abortT:4.5          // give up after this long and fall back to the raise latch
    },
    // --- trap-shot kick: a dedicated kick curve fired from the trap action. Shorter windup
    //     (ball is already near the foot), longer forward sweep with a higher peak angle, and
    //     a later/wider power window with extra restitution — scooping a controlled ball hard.
    trapShot:{
     on:true,
     windup:0.15,  windupA:-0.85,   // short shallow pull-back (ball already at the foot)
     strike:0.2,   strikeA:1.15,   // long forward sweep, high peak for power
     hold:0.35,                     // hold peak
     drop:0.5,                     // return to neutral
     powFrom:0.18, powTo:0.2,     // late wide power window
     restPower:0.19,                // big pop in the power window
     rest:0.01                      // heftier passive touch outside the window
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
    angle:-0.9,        // defined lift angle the rod eases to (rod-local, ×kickDir; full raiseA is -1.6)
    lerp:18,             // ease rate toward the angle (a brisk, clean lift)
    back:-6.50,          // dir-relative x band behind the rod where a loitering ball triggers a safe-raise…
    front:0.05,        // …up to just behind the rod line (past this the normal kick path owns it)
    maxVX:15,            // ball |v.x| must be under this (sideways/loitering — enough x-speed reaches the feet on its own)
    maxSpeed:100,        // total ball speed cap for entering/holding a safe-raise
    abortT:3.5          // give up after this long and fall back to the normal path
   },
   // --- evade action (r.act='evade'): a slow ball is stuck directly BEHIND a man (inFootRange)
   //     and we're not trapping or lifting it — rather than shadow it in z (walling it in place)
   //     the rod slides the men AWAY (opposite the ball's z-drift, or opposite the side it sits
   //     on when still) until the ball is no longer inFootRange, un-sticking it so play can
   //     progress. Only fires when the ball ISN'T strikeable (not overFoot/inFront) and is slow.
   //     Debug: 'Evade' layer in the AI panel (teal; hot while a rod is evading). ---
   evade:{
    on:true,
    vz:14.0,             // |ball v.z| above this = "has z-momentum" → step opposite it; below → step by side
    maxSpeed:40,        // only evade balls slower than this (faster balls clear the men on their own)
    abortT:3.5,         // give up after this long (a truly boxed dead ball gets redropped anyway)
    behindDead:3.      // min dir-relative x distance the ball must be BEHIND the rod for evade to fire
                        // (ballR + footBox.x + buffer) — prevents the player hitting the ball backwards
   },
   // --- decision thresholds: a smart rod (iq roll) with the ball approaching in the
   //     inFront window WAITS for it to reach the overFoot sweet spot instead of
   //     poking at full stretch — meatier, better-aimed strike. ---
   waitTta:.75,        // waiting is only allowed if the ball reaches the rod within this (s)
   waitMinVX:10,         // …and is approaching at least this fast in x (else kick now)
  
  // --- goal targeting: aim strikes at the opponent goal mouth (accuracy = DIFFS.aim) -------
  aimGain:10,                                // converts desired lateral (vz/vx) into a z aim-offset — bigger = stronger steering toward goal
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
   samples:15,         // lanes sampled across the mouth to find the widest gap
   blockR:2.6,         // z half-width an opposing man blocks a lane (≈ prad + ballR)
   minAhead:2,         // an opposing rod must be at least this far (x) ahead of the ball to block
   minAcc:0.45,        // only rods with at least this aim accuracy bother gap-aiming
   sprayMix:0.5,       // fraction of the normal inaccuracy spray still added onto the gap target
   openMargin:0.8,     // lane clearance ≥ this = a 'good' (open) shot; below = covered
   holdMax:1.0         // a smart ATT/MID holds a covered shot at most this long, then fires anyway
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
   lineBias:1.0,       // 1 = sit exactly on the ball→own-goal-centre line; 0 = track ball z (old behaviour)
   dumbBias:0.45       // a low-iq rod commits only this fraction toward the line (leaves gaps → skill spread)
  },
  alignSlow:.6, alignFast:.75,             // z-alignment tolerance — kept just INSIDE the foot's true z-reach
                                             //   (footBox.z 1.35 + BALL_R×footBoxReach ≈ 1.49) so a swing only
                                             //   fires when a man can actually connect. Looser values let the rod
                                             //   kick at a ball off to the side, whiff, and (on a slow ball with a
                                             //   short cd) hammer it again — the side-miss-repeat bug.
  wallReach:2.6, wallSlack:0.6,              // wall-hug rescue. A ball jammed against a side wall sits BEYOND the
                                             //   outermost man's centrable z-range (that man is pinned at ±maxOff),
                                             //   so dz can never fall under alignSlow even though the leg/capsule
                                             //   (radius BALL_R+PRAD≈2.6) is still touching it — the rod stands there
                                             //   beside the ball into a dead-ball. When the nearest man is within
                                             //   wallSlack of its slide limit TOWARD such a ball and the ball is
                                             //   within wallReach in z (capsule reach), count it aligned so the rod
                                             //   swings and knocks it loose. Guarded to genuine wall-hugs + a maxed
                                             //   man, so normal mid-field aiming is untouched.
  slowSpeed:10,                              // ball speed under this counts as a dead-ball (be eager)
  cdSlow:[0.7,1.1], cdFast:[0.75,1.3],       // cooldown random range (× DIFFS.cd). Slow-ball cd raised so a missed
                                             //   swing at a dead ball can't re-fire twice a second.
  errEvery:[0.4,0.8],                        // how often a fresh wandering aim-error target is rolled (s)
  
  // --- two-hands + anti-jitter -----------------------------------------
  hands:3,                                   // rods per team that may actively move at once (like 2 human hands)
  pairCommit:0.3,                            // min seconds a rod stays in the active pair before it can be swapped
  manHyst:2.,                               // a different man must beat the current one by this many z-units to steal aim
  retargetDead:0.2,                          // desired slide must differ from current target by this (z) before we re-aim
  errLerp:3.5,                               // rate the wandering aim error drifts toward its new target (per s)
  slideAccel:850                             // AI rod slide acceleration cap (u/s²) — kills instant direction flips
 },

  /* ---- 3D player models ----------------------------------------------- */
 playerModel:{
  default:'cyborg',
  // Figurine registry. Add an entry + drop its .glb in assets/ and it shows
  // up in the Customize panel automatically. `teamParts` = material names that
  // get team-coloured; `scale` = uniform scale in table units.
  models:[
   // ROBOTS
   {id:'cyborg',name:'Cyborg',ico:'🤖',blurb:'Chrome-plated all-rounder',
   src:'assets/fuzeball_cyborg.glb',scale:0.8,
   teamParts:['kit_cyborg'],
   hairParts:['kit_cyborg_hair'],
   explosionSrc:'assets/animations/cyborg_explosion.glb'
   },
   {id:'deltaborg',name:'Deltaborg',ico:'🤖',blurb:'Ruthless and fast',
   src:'assets/fuzeball_deltaborg.glb',scale:0.8,
   teamParts:['kit_deltaborg'],hairParts:[],
   explosionSrc:'assets/animations/deltaborg_explosion.glb'
   },
   {id:'mechaMan',name:'Mecha Man',ico:'🤖',blurb:'Logical and methodical',
      src:'assets/fuzeball_mechaman.glb',scale:0.8,
      teamParts:['kit_mechaman'],hairParts:[],
      explosionSrc:'assets/animations/mechaman_explosion.glb'
   },
    {id:'irnman',name:'Irnman',ico:'🤖',blurb:'Strong and relentless',
       src:'assets/fuzeball_irnman.glb',scale:0.8,
       teamParts:['kit_irnman'],hairParts:[],
       explosionSrc:'assets/animations/irnman_explosion.glb'
   },
   {id:'stormer',name:'Stormer',ico:'🤖',blurb:'Cold and endless',
      src:'assets/fuzeball_stormer.glb',scale:0.8,
      teamParts:['kit_stormer'],hairParts:[],
      explosionSrc:'assets/animations/stormer_explosion.glb'
   },
   // MEN
   /*{id:'manFlash',name:'Zack',ico:'',blurb:'Cocky but skilled',
    src:'assets/fuzeball_manFlash.glb',scale:0.8,
    teamParts:['kit_flash']
   },*/
   {id:'manJerry',name:'Jerry',ico:'',blurb:'Ambitios and skilled',
      src:'assets/fuzeball_ManJerry.glb',scale:0.8,
      teamParts:['kit_jerry'],hairParts:['kit_jerry_hair'],
      explosionSrc:'assets/animations/jerry_explosion.glb'
   },
   {id:'manrichie',name:'Richie',ico:'',blurb:'Ambitious and skilled',
      src:'assets/fuzeball_richie.glb',scale:0.8,
      teamParts:['kit_richie'],hairParts:['kit_richie_hair'],
      explosionSrc:'assets/animations/richie_explosion.glb'
   },
   {id:'manStumpy',name:'Stumpy',ico:'',blurb:'Compact and aggressive',
     src:'assets/fuzeball_manStumpy.glb',scale:0.8,
     teamParts:['stumpy_body'],hairParts:['stumpy_hair'],
       explosionSrc:'assets/animations/stumpy_explosion.glb'
    },
   // WOMEN
    {id:'womanMaria',name:'Maria',ico:'',blurb:'Determined and strong',
     src:'assets/fuzeball_womanMaria.glb',scale:0.8,
     teamParts:['kit_maria'],hairParts:['kit_maria_hair'],
       explosionSrc:'assets/animations/maria_explosion.glb'
    },
    {id:'womanKimi',name:'Kimi',ico:'',blurb:'Determined and strong',
     src:'assets/fuzeball_womanKimi.glb',scale:0.8,
     teamParts:['kit_Kimi'],hairParts:[ 'kit_kimi_hair' ],
     explosionSrc:'assets/animations/kimi_explosion.glb'   
    },
    {id:'womanAndroid',name:'JennyBot',ico:'',blurb:'Quick and calculating',
     src:'assets/fuzeball_womanAndroid.glb',scale:0.8,
     teamParts:['woman_android'],hairParts:['woman_android_hair'],
     explosionSrc:'assets/animations/jennybot_explosion.glb'
    },
   // ALIENS
    {id:'alienTamirok',name:'Tamirok',ico:'',blurb:'Intense and thoughtful',
      src:'assets/fuzeball_alienTamirok.glb',scale:0.8,
      teamParts:['kit_tamirok'],hairParts:[],
      explosionSrc:'assets/animations/tamirok_explosion.glb'
    },
    {id:'alienGrimlot',name:'Grimlot',ico:'',blurb:'Wild and unpredictable',
      src:'assets/fuzeball_alienGrimlot.glb',scale:0.8,
      teamParts:['kit_Grimlot'],hairParts:[],
      explosionSrc:'assets/animations/grimlot_explosion.glb'
    },

  ],
  // Surface finishes offered as one-tap presets (metalness / roughness / glow).
  finishes:{
   matte:   {metalness:.05,roughness:.90,glow:0},
   satin:   {metalness:.15,roughness:.45,glow:0},
   plastic: {metalness:.0,roughness:.18,glow:0},
   metallic:{metalness:.75,roughness:.28,glow:.25},
   chrome:  {metalness:1.0,roughness:.06,glow:.15},
   neon:    {metalness:.25,roughness:.35,glow:0.40}
  },
  // Quick-pick kit colour swatches for the panel.
  swatches:['#ff0011','#ff8c3a','#ffcf4d','#7dff8a','#2af5ff','#3d8bff','#a06bff','#ff2bd6','#f2ede2','#545d71'],
  // Natural hair colours for random tinting.
  hairSwatches:['#1a1a1a','#2d1b0e','#3d2b1f','#5c4033','#8b6b47','#c9b896','#e8d4b9','#f5e6c8','#c49a6c','#8b5a2b','#6b3f1a','#4a2c1a','#b8860b','#daa520','#cd853f']
 },

 /* ---- rod layout ----------------------------------------------------- */
 rods:{
  spacing:{ two:24, three:18.5, other:11.9 }, // per-man spacing by man-count
  margin:7,       // total z margin subtracted when deriving slide range
  gkSlide:13,     // goalie slide cap — keeper stays in its goal area (real tables restrict this), keeps its rod short
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
  rookie:{speed:30,react:.30,err:4.0,range:5.0,pred:.35,cd:1.05,aim:.25,iq:.15},
  pro:   {speed:48,react:.15,err:1.8,range:5.8,pred:.75,cd:.55,aim:.6,iq:.55},
  legend:{speed:72,react:.02,err:.6, range:6.6,pred:1.0,cd:.20,aim:.9,iq:.9}
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
  str:.08,            // ball hit impulse ±8%/pt (stacks with boost power-up)
  ctl:.12,            // contact grip ±12%/pt — high = sticky soft touch, low = ball pings off
  accErr:.14,         // AI wandering aim error −14%/pt above base
  accAim:.08,         // added to DIFFS.aim per pt above base (goal targeting)
  assistMax:.10,      // aim-assist: max heading bend (rad) at acc=max; 0 at/below base
  assistCone:.6,      // only bend shots already within this angle of goal centre (rad)
  assistMinVX:20,     // only bend shots moving goalward faster than this (u/s)
  rea:.10,            // AI reaction lag −10%/pt above base
  cd:.08,             // kick cooldown −8%/pt above base
  iq:.15,             // decision intelligence: ×(1±15%/pt) on the difficulty's base iq roll
                      // (DIFFS.iq). base 5 = ×1 (unchanged); 10 ≈ ×1.75, 0 ≈ ×0.25. In league
                      // every brain is 'pro' (iq .55), so this stat IS the team's smartness knob.
  fatStart:60, fatEnd:180, fatMax:.25 // stamina: fatigue ramps over matchTime window; max slow-down at sta=0
 },

  /* ---- league mode ------------------------------------------------------ */
  league:{
    divSize:10,           // teams per division (even; 10 → 9 rounds)
    goals:5,              // goals to win a league match (live AND simulated)
    upWin:3, upLoss:1, upCleanSheet:1, // upgrade parts awarded (tune: 4/2 feels better with escalating costs)
    playerStart:10,       // parts the player has to spend when a fresh league starts
    cost:[1,1,2,2,3],    // cost of raising a stat from level 5+i (5→6=1, 9→10=3)
    tape:true, tapeT:3,   // pre-match splash: OFF/DEF bars + figurines; click to skip
    graceT:10,             // seconds after match-start where quitting does NOT forfeit
    aiBudget:[8,15],     // random starting stat points each AI team gets (league strength spread)
    simK:.5,              // sim: stat edge → per-goal probability steepness (logistic)
    divisions:[            // tier order: 0 bottom .. 2 top
      {name:'Sunday League', base:3, aiBudget:[4,9], theme:'classic', table:'classic', pitch:'grass1'},
      {name:'Pro League',    base:4, aiBudget:[9,15],  theme:'royal', table:'classic', pitch:'grass2'},
      {name:'Premier League',base:5, aiBudget:[15,22], theme:'neon',  table:'arena',   pitch:'neon'}
    ],
    promoteN:2, relegateN:2,  // top/bottom N swap between divisions each season
    upPromote1:5, upPromote2:3, // upgrade parts: 1st-place promotion / 2nd-place promotion
    upChampTop:4,             // parts for winning the Premier (top) division
    relegateLose:1,           // stat points removed per role block on relegation
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
       'SCREWBALL CITY','THE HANDLERS','BENCHWARMERS FC','WRATH OF ROD','TACTICAL FOULS'
    ],
    cols:[
       '#ff8c3a','#ffcf4d','#7dff8a','#2af5ff','#3d8bff','#74abff',
       '#a06bff','#ff2bd6','#c45ba9','#f2ede2','#9dff2b','#ff5c2b',
       '#504240','#888888','#250d06','#00bfa5','#ff6e40','#8d6e63',
       '#d500f9','#76ff03','#1de9b6','#ff1744','#448aff','#ffab00',
       '#e040fb','#00e5ff','#b2ff59','#ff3d00','#40c4ff','#eeff41'
    ],
    colClash:80      // RGB distance threshold: if AI colour is too close to player's, reassign
   },
   /* ---- champions cup (post-season KO for the Premier League champion) ---- */
   // The cup has its OWN table/theme/pitch selection (answer to NOTES.md
   // "define which tables/pitches are used for which division/cup") — independent of
   // the Premier division's, so it can be retuned without touching the league.
   // `poolSize` elite "special teams" are generated ONCE and persisted on LG; each cup
   // draws `drawSize` of them (+ the player = 8) into an 8-team single-leg KO. The rest
   // are spares (variety between seasons, recurring rivals).
   cup:{
     name:'Champions Cup',
     table:'arena', theme:'neon', pitch:'champions_green',   // its own selection (retune here)
     // the cup rotates between these two bespoke pitch meshes (see cupPlayTie); the
     // `pitch` above is the fallback default used before a tie picks one
     pitches:['champions_green','champions_purple'],
    goals:5, special:true, power:true,            // spectacle on; goals default to league
    poolSize:12, drawSize:7,                      // 12 elite teams, draw 7 + player = 8
    base:8, budget:[3,5],                       // elite build base + weighted spend
    enterParts:2, winParts:8,                     // participation / victory rewards (upgrade parts)
    rounds:['QUARTER-FINAL','SEMI-FINAL','FINAL'],
    names:[
      'NIGHTWATCH','GALACTICOS','VOID RAIDERS','IRON LEGION','CYBER WOLVES','NOVA KINGS',
      'APEX PREDATORS','PHANTOM XI','TITAN FORGE','SOLAR FURY','EMBERLORDS','CRIMSON COBALT'
    ],
    cols:[
      '#9b5cff','#ff3df0','#3dffd5','#ffd23d','#ff6a3d','#5dff7a',
      '#3d8bff','#ff4d8c','#c0ff3d','#ff8c3d','#7a5cff','#3dfff0'
    ]
   },

 /* ---- player control ------------------------------------------------- */
 control:{ slideSpeed:95, mouseSens:1.35, autoDelay:1.2, nameMaxLength:20 }, // keyboard slide, mouse range, auto rod-switch delay

 /* ---- power-ups ------------------------------------------------------ */
 powerups:{
  firstDelay:[9,14], respawn:[11,17], // seconds until first spawn / after a pickup
  boost:10, freeze:8, big:10,          // effect durations (s)
  floatY:4, floatAmp:0.8, pickR:6,    // hover height, bob amplitude, pickup radius pad
  area:{x:32,z:22}                    // spawn box (± these)
 },

 /* ---- dead-ball recovery -------------------------------------------- */
  deadball:{
   // "Dead" is measured by ACTUAL travel, not speed: a ball whose true position stays inside a
   // moveEps-wide box for the given time is dead — even while it still carries velocity (a ball a
   // player is holding / spinning against a wall). Speed alone missed those, and resting on a foot
   // reset the old timer every frame (collideRod's S.still=0), delaying the whistle.
   moveEps:4,          // ball must roam a horizontal box wider than this (units) to count as "in play"
   stallT:2.6,         // every ball boxed-in this long → whistle + re-drop them all
   wedgeT:2.2,         // multi-ball: one ball boxed-in this long → re-drop just it
   redrop:{y:44,z:16,vel:20,  // fresh drop box + launch speed (x removed — now uses zones)
    zones:[                   // 3 face-off zones where both teams contest
     {x:-30,spread:5},       // def vs att  (between DEF -37.5 & ATT -22.5)
     {x:0,  spread:5},       // mid vs mid  (between MID -7.5  & MID  7.5)
     {x:30, spread:5}        // att vs def  (between ATT  22.5 & DEF  37.5)
    ]}
  },

 /* ---- camera --------------------------------------------------------- */
 camera:{
  // each mode: [x,y,z, lookX,lookY,lookZ]
  modes:[
   [0,68,47,0,25,21],   // Close Side
   [0,92,86,0,0,2],     // Cam 1
   [0,100,2,0,0,0],     // Top-down
   [-85,38,0,0,-4,0],   // Behind Goal 1
   [85,38,0,0,-4,0],    // Behind Goal 2
   [66,44,41,31,17,14],  // Goal 2 Corner
   [-66,44,41,31,-17,-14],  // Goal 1 Corner
   ],   
   
  follow:0.0014, lookFollow:0.01, lerp:3,   // ball-follow weights + position lerp
   shakeDecay:0.6, shakeX:0.004, shakeY:0.002, // screen-shake decay + amplitudes
   freeRoamSpeed:80, freeRoamSprint:2.0, freeRoamSens:0.22 // free-roam: base speed, sprint mult, mouse sens
  },

 /* ---- serve ---------------------------------------------------------- */
  serve:{ dropY:70, spread:6, zSpread:15, vel:5, spin:5.5 }, // ball drop height, x spread, z spread, nudge speed, random spin

 /* ---- cannonball ------------------------------------------------------ */
  cannonball:{
   timer:10,           // seconds before the cannonball explodes
   removeDuration:20,  // seconds the nearest player is removed after explosion
   fractureFadeOut:.5,// seconds the fracture debris fades out just before it's disposed (players AND ball)
   // --- ball self-fracture (the cannonball itself shattering on detonation) ---
   explosionSrc:'assets/animations/cannonball_explosion.glb', // baked ball fracture GLB (one Action/clip PER shard, like the player explosions)
   fractureLife:2.9,   // seconds the ball debris lives before disposal; the ball has no respawn so this is self-contained (keep >= the baked clip length)
   fractureScale:1     // scale for the ball-fracture instance (baked in-scene at game scale, so 1; bump if the export came out small/large)
  },

/* ---- ball types ----------------------------------------------------- */
  // Each ball type may define an optional `audio` block that overrides the
  // synthesised contact sounds for that ball. Every field is optional — any
  // missing field falls back to the hard-coded defaults in audio.js, preserving
  // the current sound exactly. Tune these per-ball to give each type a distinct
  // sonic character (crackling fire, heavy cannon thud, glassy split, etc.).
  ballTypes:{
   classic:{
      name:'⚽ CLASSIC',col:0xf2ede2,em:0x000000,
      mass:4,maxV:120,w:70,trail:'#ffffff',
      audio:{
       kick:{noiseDur:.06,noiseFreq:400,noiseFreqScale:8,noiseVol:.1,noiseVolScale:.003,noiseVolMax:.4,
             beepFreq:95,beepDur:.09,beepType:'sine',beepVol:.08,beepVolScale:.003,beepVolMax:.45,beepSlide:-45},
       wall:{noiseDur:.045,noiseFreq:2300,noiseVol:.04,noiseVolScale:.002,noiseVolMax:.28},
       post:{noiseDur:.03,noiseFreq:3200,noiseVolScale:.5,freqs:[523,832,1290,1900],droop:.94,
             attack:.003,decay:.28,vol:.14,volScale:.004,volMax:.5}
      }
   },
   fire:   {name:'🔥 FIREBALL',col:0xff6a1f,em:0xff2200,
      mass:1,maxV:120,w:14,trail:'#ff8c3a',light:0xff5500,
      audio:{
       kick:{noiseDur:.08,noiseFreq:1400,noiseFreqScale:14,noiseVol:.14,noiseVolScale:.005,noiseVolMax:.5,
             beepFreq:70,beepDur:.1,beepType:'triangle',beepVol:.06,beepVolScale:.002,beepVolMax:.35,beepSlide:-50},
       wall:{noiseDur:.05,noiseFreq:2800,noiseVol:.06,noiseVolScale:.003,noiseVolMax:.32},
       post:{noiseDur:.04,noiseFreq:4000,noiseVolScale:.6,freqs:[587,932,1397,2100],droop:.93,
             attack:.002,decay:.25,vol:.16,volScale:.005,volMax:.55}
      }
   },
   cannon: {
      name:'💣 CANNONBALL',col:0x000000,em:0x000000,
      mass:10,maxV:80,w:30,trail:'#000000',
      audio:{
       kick:{noiseDur:.1,noiseFreq:400,noiseFreqScale:4,noiseVol:.18,noiseVolScale:.004,noiseVolMax:.6,
             beepFreq:50,beepDur:.12,beepType:'sine',beepVol:.12,beepVolScale:.005,beepVolMax:.55,beepSlide:-30},
       wall:{noiseDur:.06,noiseFreq:1200,noiseVol:.08,noiseVolScale:.003,noiseVolMax:.35},
       post:{noiseDur:.04,noiseFreq:2200,noiseVolScale:.4,freqs:[328,523,784,1100],droop:.95,
             attack:.004,decay:.32,vol:.2,volScale:.006,volMax:.6}
      }
   },
   split:  {
      name:'👯 SPLIT BALL',col:0xa46bff,em:0x4a18b8,
      mass:4,maxV:95,w:3,splits:true,trail:'#c39bff',
      audio:{
       kick:{noiseDur:.05,noiseFreq:1100,noiseFreqScale:10,noiseVol:.08,noiseVolScale:.002,noiseVolMax:.32,
             beepFreq:120,beepDur:.07,beepType:'sine',beepVol:.1,beepVolScale:.004,beepVolMax:.5,beepSlide:-55},
       wall:{noiseDur:.04,noiseFreq:3200,noiseVol:.03,noiseVolScale:.0015,noiseVolMax:.22},
       post:{noiseDur:.025,noiseFreq:3600,noiseVolScale:.55,freqs:[659,988,1480,2200],droop:.92,
             attack:.002,decay:.22,vol:.12,volScale:.003,volMax:.4}
      }
   },
   golden: {
      name:'⭐ GOLDEN BALL · COUNTS ×2',col:0xffc933,em:0x7a5200,
      mass:4,maxV:80,w:3,value:2,trail:'#ffd75e',metal:.85,
      audio:{
       kick:{noiseDur:.055,noiseFreq:800,noiseFreqScale:7,noiseVol:.09,noiseVolScale:.0025,noiseVolMax:.38,
             beepFreq:110,beepDur:.085,beepType:'triangle',beepVol:.09,beepVolScale:.0035,beepVolMax:.48,beepSlide:-40},
       wall:{noiseDur:.04,noiseFreq:2100,noiseVol:.035,noiseVolScale:.0018,noiseVolMax:.26},
       post:{noiseDur:.028,noiseFreq:3000,noiseVolScale:.48,freqs:[587,880,1319,1760],droop:.93,
             attack:.003,decay:.26,vol:.15,volScale:.0045,volMax:.52}
      }
   },
  },

  /* ---- debug / toggles -------------------------------------------------- */
  debug:{
   useBallModel:true,  // false = use generated sphere, true = use assets/balls/fuzeball_ball.glb (per-type material slots)
   fractureFx:true      // false = skip loading/using explosion GLBs, always use the old instant-vanish
  },

 /* ---- power-up types ------------------------------------------------- */
 puTypes:[
   {key:'boost',ico:'⚡',label:'POWER HITS',col:0xfff04d},
  {key:'freeze',ico:'❄️',label:'RIVALS FROZEN',col:0x7ae4ff},
  {key:'big',ico:'🥅',label:'BIG GOAL',col:0x7dff8a}
 ],

 /* ---- table themes --------------------------------------------------- */
  themes:{
   classic:{pitch:'pitches/pitch_grass_1.jpg',field:'#1f7c3e',field2:'#1b7038',line:'#eef3ee',wall:0x7a4b22,bg:0x0c0f16,led:0x38e0ff},
   neon:   {pitch:'pitches/pitch_cyatron.jpg',field:'#151137',field2:'#110d2d',line:'#2af5ff',wall:0x232a4d,bg:0x05060f,led:0xff2bd6},
   royal:  {pitch:'pitches/pitch_grass_2.jpg',field:'#14407a',field2:'#113a6f',line:'#ffd75e',wall:0x2b3852,bg:0x0a0d15,led:0xffc933},
   verdant:{pitch:'pitches/pitch_verdantia.jpg',field:'#2d5a27',field2:'#264d21',line:'#c8e6c9',wall:0x4a6741,bg:0x0a0f08,led:0x7dff8a}
  },

  /* ---- pitches ------------------------------------------------------- */
  // One entry per pitch variant. `glb` = mesh name inside fuzeball_pitch.glb
  // (same as the theme keys the Blender artist uses). `tex` = jpg path on disk
  // (used as the automatic fallback when a GLB mesh is missing).
  // `name` = display label in the pitch selector dropdown.
  pitches:{
    grass1:   {glb:'classic',  tex:'pitches/pitch_grass_1.jpg',    name:'Grass Field'},
    grass2:   {glb:'royal',    tex:'pitches/pitch_grass_2.jpg',    name:'Royal Grass'},
    cyatron:  {glb:'cyatron',  tex:'pitches/pitch_cyatron.jpg',    name:'Cyatron Grid'},
    neon:     {glb:'neon',     tex:'pitches/pitch_neon_nights.jpg',name:'Neon Nights'},
    verdantia:{glb:'verdant',  tex:'pitches/pitch_verdantia.jpg',  name:'Verdantia'},
    champions_green: {glb:'champions_green', tex:'pitches/pitch_champions_green.jpg',  name:'Champions Green'},
    champions_purple:{glb:'champions_purple',tex:'pitches/pitch_champions_purple.jpg', name:'Champions Purple'},
   },

  /* ---- LED strip fx --------------------------------------------------- */
 leds:{
  idle:'rainbow',   // 'rainbow' = cycle through hues · 'theme' = hold the theme colour
  hueSpeed:0.06,    // rainbow cycle speed (full loops per second)
  baseBright:1.1,   // idle emissive intensity
  pulse:0.4,        // idle brightness wobble amount
  pulseSpeed:4,     // idle brightness wobble speed
  excite:1.4,       // extra brightness driven by crowd noise (Au.exc)
  goalStrobe:6,    // strobe frequency on a goal (Hz)
  goalBright:3.8    // peak emissive during the goal strobe
 },

 /* ---- fx pools ------------------------------------------------------- */
 fx:{ trailSpeed:26, spriteCount:70, particleCount:500 }, // min speed to trail, sprite pool, particle pool


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
      PWR=CONFIG.powerups, DEAD=CONFIG.deadball, CAM=CONFIG.camera, MATCH=CONFIG.match, SRV=CONFIG.serve, SIM=CONFIG.sim;
const RODDEFS=CONFIG.rods.defs, DIFFS=CONFIG.diffs, BALL_TYPES=CONFIG.ballTypes,
       PU_TYPES=CONFIG.puTypes, THEMES=CONFIG.themes, CUP=CONFIG.league.cup;
const pCount=CONFIG.fx.particleCount;
const ARENA=CONFIG.tables.arena;

/* =========================================================================
   Persisted player settings (localStorage). These are the in-menu options,
   distinct from the CONFIG tuning knobs above.
   ========================================================================= */
let cfg={diff:'pro',goals:5,theme:'classic',table:'classic',pitch:'grass1',special:true,power:true,auto:true,sound:true,
 redName:'Team 1',blueName:'Team 2',redColor:'#ff4d5a',blueColor:'#3d8bff',
 // Per-team AI difficulty (overrides legacy single `diff`). Both default to
 // 'pro' when missing so older saves (or first-time players) still play normally.
 diffRed:null,diffBlue:null,
 // Customize-panel settings: selected figurine + material finish + size.
 modelRed:'cyborg',modelBlue:'cyborg',redYaw:-0.55,blueYaw:0.55,metalness:.15,roughness:.45,glow:0,modelScale:1,
 // Controls / options screen. Sensitivities are MULTIPLIERS on the CONFIG bases
 // (CTRL.slideSpeed, CTRL.mouseSens); padAngleSens scales how far a given stick push tilts (reach).
 // padSlideAxis 'ly'=left-stick up/down · 'lx'=left/right. padAngleAxis 'ry'/'rx' likewise.
 padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,
 mouseSens:1,kbdSens:1};
try{Object.assign(cfg,JSON.parse(localStorage.getItem('fuzeball')||'{}'));}catch(e){}
if(cfg.model&&!cfg.modelRed){cfg.modelRed=cfg.model;cfg.modelBlue=cfg.model;delete cfg.model;saveCfg();}
// Migrate legacy single `diff` into per-team fields when those are missing.
if(!cfg.diffRed)cfg.diffRed=cfg.diff||'pro';
if(!cfg.diffBlue)cfg.diffBlue=cfg.diff||'pro';
cfg.diff=cfg.diffRed;
// Migrate old saves: derive pitch from theme if missing (theme→pitch map).
if(!cfg.pitch){
  const tm={classic:'grass1',neon:'cyatron',royal:'grass2',verdant:'verdantia'};
  cfg.pitch=tm[cfg.theme]||'grass1';
  saveCfg();
}
// Clamp figurine yaws into the slider range (fixes an old saved blueYaw:10.0 default).
cfg.redYaw=clamp(cfg.redYaw||0,-Math.PI,Math.PI);cfg.blueYaw=clamp(cfg.blueYaw||0,-Math.PI,Math.PI);
function saveCfg(){try{localStorage.setItem('fuzeball',JSON.stringify(cfg));}catch(e){}}
// Per-team figurine def (falls back to the first if the id is stale).
function activeModel(team){const M=CONFIG.playerModel;return M.models.find(m=>m.id===cfg[team===0?'modelRed':'modelBlue'])||M.models[0];}
