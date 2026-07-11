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
  maxSteps:6     // max fixed steps run in a single frame (spiral-of-death guard:
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
   postR:2,           // smooth-union radius where the crease/walls blend into the goal mouth
   mouthIn:8,         // how far the goal cavity punches inward past the goal line (opens the mouth)
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
   footBoxReach:0.08,                // multiplier on BALL_R for foot-box collision distance (lower = tighter)
   footJitter:0.003,                // random velocity perturbation fraction after foot collision (prevents perfect oscillations)
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
  bigGoalBack:0.5,                      // net BACK edge widens only this fraction as much as the mouth — keeps it inside the narrowing wall gap behind the goal
  redropY:32,                            // y a ball is re-dropped to if physics goes non-finite
   spinTurn:0.4, spinMax:0.3, spinDecay:.74, spinCut:0.02, // Magnus curve: turn rate, per-step clamp, decay, cutoff
  },

 /* ---- rod kick + motion ---------------------------------------------- */
 kick:{
  // swing-angle curve keyframes (see updateRods): time windows and peak angles
  windup:0.0,  windupA:-0.3,   // pull-back window / angle
  strike:0.1,  strikeA:1.3,     // strike ramp end / peak forward angle
  hold:0.20,                     // hold peak until this time
  drop:0.40,                     // fully returned by this time
  raiseA:-1.6, raiseLerp:14, dropLerp:12, // lift-men angle + settle rates
  userSpeed:80,                  // slide speed of the player-driven rod (u/s)
  aiOwnMult:0.85,                // AI rods on the user's team slide a bit slower
   boostHitMult:1.50, freezeMult:0.1, // power-up multipliers: boost (hit impulse), freeze (speed)
  rest:0.05, restPower:0.5,     // ball restitution: passive touch vs kick power window
  powFrom:0.05, powTo:0.1,      // kickT window that counts as the power strike
  grip:0.03,                     // how much the foot's velocity is imparted to the ball
  spinGain:0.05, spinClamp:2,    // side-spin from sliding into the ball
  sndFrom:18, hardHit:70, shakeDiv:400, // kick sound threshold / hard-hit sparks / shake scale
  splitVel:62, splitMax:3, splitAng:0.45, splitSep:3.2 // split-ball: trigger speed, max balls, spread angle, z sep
 },

 /* ---- AI behaviour --------------------------------------------------- */
 ai:{
  gkPad:2,                                   // keeper stays within goalHalf + this
  ttaMax:0.9,                                // only lead the ball's z if it arrives within this (s)
  inFrontMin:0.18, inFrontMax:6.2,            // ahead-window that a forward swing can reach (connects to overFoot, no dead band)
  underFootFront:4.7, underFootBack:2.5,    // behind/ahead of rod where swung rod stays forward (prevents own-goal swipe on return)
  lowY:2,                                    // only swing when the ball is below this height
  raiseBehind:-7.2,                          // ball must be at least this far behind (real, dir-relative) to consider raising
   overFoot:2.9,                              // |Δx| under which the ball is 'at the feet' and strikeable (≈footR+ballR sweet spot)
   overFootOffset:2.59,                        // shift the overFoot zone this far forward (dir-relative) so it sits in front of the men, not straddling the rod — prevents latch releasing too early as the ball approaches
   
   // --- safe-lower side-step: a rod held forward after a kick (ball still in the
   //     drop-sweep zone, so updateRods pins it at strike angle) slides sideways until
   //     every foot is at least clearZ from the ball in z, then lowers on its own.
   //     clearZ per foot = footBox.z + BALL_R + clearMargin. Stops the hover-forever
   //     deadlock where the AI kept re-aligning ONTO the ball it was hovering over.
   //     Debug: 'Drop Sweep' layer in the AI panel shows the per-man danger boxes. ---
   repositionSpeed:20,                        // max ball speed that triggers the side-step (above this, shots pass through raised men)
   clearMargin:0.6,                           // extra z-clearance beyond footBox.z + BALL_R before lowering is safe
   
    // --- foot-trap break: drop a raised rod when a slow ball is pinned right at a foot.
   //     (NOTE: previously referenced but never defined — made the check dead code.) ---
   footTrapSlow:10.0,                         // ball speed under this is "pinned"
   footTrapZ:0.01,                            // ball within this z of any foot counts as "at the foot"

   // --- trap action (r.act='trap'): a slow ball arriving from behind is CAUGHT instead
   //     of full-raised over — the rod eases to a partial back angle (full raiseA just
   //     pops the ball away on the drop), holds it a beat, then scoops a shot forward.
   //     Only rods whose iq roll passed (DIFFS.iq) attempt it; everyone else keeps the
   //     old raise latch. on:false restores pre-trap behaviour exactly.
   //     Debug: 'Trap Zone' layer in the AI panel (purple; hot while a rod is trapping). ---
   trap:{
    on:true,
    angle:-0.65,        // partial back-raise trap angle (rod-local, ×kickDir like raiseA)
    lerp:6,             // ease rate toward the trap angle (slower than raiseLerp — a soft catch)
    back:-6.4,          // dir-relative x window behind the rod where a trap makes sense…
    front:-0.8,         // …ends just behind the rod line (past this the normal kick path owns it)
    maxVX:6,           // ball |v.x| must be under this — enough x-speed will reach the feet on its own
    maxSpeed:10,        // total ball speed cap for attempting/keeping a trap
    alignZ:1.2,         // z-alignment (nearest man) needed to commit to the trap
    gkReach:6,          // GK-only: also enter the trap when the ball is within this far BEYOND
                        //   the keeper's z-slide band (early-detect a ball drifting back toward a
                        //   goal it can't yet slide onto). Outfield rods ignore this, use alignZ.
    settleT:1.75,       // min seconds in the trap before the scoop shot may fire
    shootFrom:-3.8,     // scoop fires once the ball is past this (near the trap foot's reach)
    abortT:5.5,         // give up after this long and fall back to the raise latch
    // --- pre-trap safe-raise: a slow/sideways ball sitting in the trap x-band but not far
    //     enough back to trip the raiseBehind latch. If it sits in a z-GAP — i.e. no live
    //     man's footbox would clip it if the rod raised right now — the rod raises FULLY
    //     (behindFlag latch) and slides to get a man behind the ball, then the trap/kick
    //     logic below decides to trap or clear. If a foot IS lined up with the ball in z,
    //     raising would sweep into it, so we leave it to the normal path. ---
    safeRaise:true,     // enable the pre-trap safe-raise + reposition
    raiseBuf:1.6        // z buffer added to FOOT_BOX.z for the "would raising clip the ball?" per-man test
   },
   // --- decision thresholds: a smart rod (iq roll) with the ball approaching in the
   //     inFront window WAITS for it to reach the overFoot sweet spot instead of
   //     poking at full stretch — meatier, better-aimed strike. ---
   waitTta:3.55,        // waiting is only allowed if the ball reaches the rod within this (s)
   waitMinVX:7,         // …and is approaching at least this fast in x (else kick now)
  
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
  alignSlow:2.0, alignFast:1.8,              // z-alignment tolerance (looser on slow balls)
  slowSpeed:5,                              // ball speed under this counts as a dead-ball (be eager)
  cdSlow:[0.45,0.85], cdFast:[0.75,1.3],     // cooldown random range (× DIFFS.cd)
  errEvery:[0.4,0.8],                        // how often a fresh wandering aim-error target is rolled (s)
  
  // --- two-hands + anti-jitter -----------------------------------------
  hands:3,                                   // rods per team that may actively move at once (like 2 human hands)
  pairCommit:0.3,                            // min seconds a rod stays in the active pair before it can be swapped
  manHyst:3,                               // a different man must beat the current one by this many z-units to steal aim
  retargetDead:0.3,                          // desired slide must differ from current target by this (z) before we re-aim
  errLerp:2.5,                               // rate the wandering aim error drifts toward its new target (per s)
  slideAccel:780                             // AI rod slide acceleration cap (u/s²) — kills instant direction flips
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
   teamParts:['body','arm_upper_right','arm_upper_left','arm_right','arm_left','legs','headgear'],
   hairParts:['cyborg_hair']
   },
   {id:'deltaborg',name:'Deltaborg',ico:'🤖',blurb:'Ruthless and fast',
   src:'assets/fuzeball_deltaborg.glb',scale:0.8,
   teamParts:['kit_deltaborg'],hairParts:[]
   },
   {id:'mechaMan',name:'Mecha Man',ico:'🤖',blurb:'Logical and methodical',
      src:'assets/fuzeball_mechaman.glb',scale:0.8,
      teamParts:['kit_mechaman'],hairParts:[]
   },
    {id:'irnman',name:'Irnman',ico:'🤖',blurb:'Strong and relentless',
       src:'assets/fuzeball_irnman.glb',scale:0.8,
       teamParts:['kit_irnman'],hairParts:[],
       explosionSrc:'assets/animations/irnman_explosion.glb'
   },
   {id:'stormer',name:'Stormer',ico:'🤖',blurb:'Cold and endless',
      src:'assets/fuzeball_stormer.glb',scale:0.8,
      teamParts:['kit_stormer'],hairParts:[]
   },
   // MEN
   /*{id:'manFlash',name:'Zack',ico:'',blurb:'Cocky but skilled',
    src:'assets/fuzeball_manFlash.glb',scale:0.8,
    teamParts:['kit_flash']
   },*/
   {id:'manStumpy',name:'Stumpy',ico:'�',blurb:'Compact and aggressive',
     src:'assets/fuzeball_manStumpy.glb',scale:0.8,
     teamParts:['body.001'],hairParts:[]
    },
    {id:'manJerry',name:'Jerry',ico:'',blurb:'Ambitios and skilled',
     src:'assets/fuzeball_ManJerry.glb',scale:0.8,
     teamParts:['kit_jerry'],hairParts:['kit_jerry_hair']
    },
   // WOMEN
    {id:'womanMaria',name:'Maria',ico:'',blurb:'Determined and strong',
     src:'assets/fuzeball_womanMaria.glb',scale:0.8,
     teamParts:['kit_maria'],hairParts:[]
    },
    {id:'womanKimi',name:'Kimi',ico:'',blurb:'Determined and strong',
     src:'assets/fuzeball_womanKimi.glb',scale:0.8,
     teamParts:['kit_Kimi'],hairParts:[ 'kit_kimi_hair' ]
    },
    {id:'womanAndroid',name:'JennyBot',ico:'',blurb:'Quick and calculating',
     src:'assets/fuzeball_womanAndroid.glb',scale:0.8,
     teamParts:['woman_android'],hairParts:['woman_android_hair']
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
  swatches:['#ff0011','#ff8c3a','#ffcf4d','#7dff8a','#2af5ff','#3d8bff','#a06bff','#ff2bd6','#f2ede2','#28324a'],
  // Natural hair colours for random tinting.
  hairSwatches:['#1a1a1a','#2d1b0e','#3d2b1f','#5c4033','#8b6b47','#c9b896','#e8d4b9','#f5e6c8','#c49a6c','#8b5a2b','#6b3f1a','#4a2c1a','#b8860b','#daa520','#cd853f']
 },

 /* ---- rod layout ----------------------------------------------------- */
 rods:{
  spacing:{ two:24, three:18.5, other:11.9 }, // per-man spacing by man-count
  margin:7.5,       // total z margin subtracted when deriving slide range
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
    graceT:5,             // seconds after match-start where quitting does NOT forfeit
    aiBudget:[10,16],     // random starting stat points each AI team gets (league strength spread)
    simK:.5,              // sim: stat edge → per-goal probability steepness (logistic)
    divisions:[            // tier order: 0 bottom .. 2 top
      {name:'Sunday League', base:3, aiBudget:[4,9]},
      {name:'Pro League',    base:4, aiBudget:[9,15]},
      {name:'Premier League',base:5, aiBudget:[15,22]}
    ],
    promoteN:2, relegateN:2,  // top/bottom N swap between divisions each season
    upPromote1:3, upPromote2:2, // upgrade parts: 1st-place promotion / 2nd-place promotion
    upChampTop:3,             // parts for winning the Premier (top) division
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

 /* ---- player control ------------------------------------------------- */
 control:{ slideSpeed:95, mouseSens:1.35, autoDelay:1.2 }, // keyboard slide, mouse range, auto rod-switch delay

 /* ---- power-ups ------------------------------------------------------ */
 powerups:{
  firstDelay:[9,14], respawn:[11,17], // seconds until first spawn / after a pickup
  boost:10, freeze:10, big:10,          // effect durations (s)
  floatY:3, floatAmp:0.8, pickR:6,    // hover height, bob amplitude, pickup radius pad
  area:{x:32,z:22}                    // spawn box (± these)
 },

 /* ---- dead-ball recovery -------------------------------------------- */
  deadball:{
   stallVel:1.5, stallT:2.6, // all balls under stallVel for stallT → whistle + re-drop all
   wedgeVel:3,   wedgeT:2.2, // in multi-ball, one ball under wedgeVel for wedgeT → re-drop it
   redrop:{y:44,z:16,vel:20,  // fresh drop box + launch speed (x removed — now uses zones)
    zones:[                   // 3 face-off zones where both teams contest
     {x:-30,spread:3},       // def vs att  (between DEF -37.5 & ATT -22.5)
     {x:0,  spread:3},       // mid vs mid  (between MID -7.5  & MID  7.5)
     {x:30, spread:3}        // att vs def  (between ATT  22.5 & DEF  37.5)
    ]}
  },

 /* ---- camera --------------------------------------------------------- */
 camera:{
  // each mode: [x,y,z, lookX,lookY,lookZ]
  modes:[
   [0,68,47,0,25,21],   // Close Side
   [0,92,86,0,0,2],     // Cam 1
   [0,140,2,0,0,0],     // Top-down
   [-85,38,0,0,-4,0],   // Behind Goal 1
   [85,38,0,0,-4,0],    // Behind Goal 2
   [66,56,41,38,23,17]
   ],   
   
  follow:0.0014, lookFollow:0.01, lerp:3,   // ball-follow weights + position lerp
   shakeDecay:0.6, shakeX:0.006, shakeY:0.002, // screen-shake decay + amplitudes
   freeRoamSpeed:80, freeRoamSprint:2.0, freeRoamSens:0.22 // free-roam: base speed, sprint mult, mouse sens
  },

 /* ---- serve ---------------------------------------------------------- */
 serve:{ dropY:42, spread:7, zSpread:10, vel:5 }, // ball drop height, x spread, z spread, nudge speed

 /* ---- cannonball ------------------------------------------------------ */
  cannonball:{
   timer:10,           // seconds before the cannonball explodes
   removeDuration:10,  // seconds the nearest player is removed after explosion
   fractureFadeOut:1.0 // seconds the fracture debris fades out just before the player respawns
  },

/* ---- ball types ----------------------------------------------------- */
  ballTypes:{
   classic:{
      name:'⚽ CLASSIC',col:0xf2ede2,em:0x000000,
      mass:4,maxV:80,w:70,trail:'#ffffff'},
   fire:   {name:'🔥 FIREBALL',col:0xff6a1f,em:0xff2200,
      mass:.9,maxV:100,w:14,trail:'#ff8c3a',light:0xff5500},
   cannon: {
      name:'💣 CANNONBALL',col:0x000000,em:0x000000,
      mass:8,maxV:40,w:8,trail:'#000000'},
   split:  {
      name:'👯 SPLIT BALL',col:0xa46bff,em:0x4a18b8,
      mass:4,maxV:65,w:3,splits:true,trail:'#c39bff'},
   golden: {
      name:'⭐ GOLDEN BALL · COUNTS ×2',col:0xffc933,em:0x7a5200,
      mass:5,maxV:50,w:1,value:2,trail:'#ffd75e',metal:.85},
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
       PU_TYPES=CONFIG.puTypes, THEMES=CONFIG.themes;
const pCount=CONFIG.fx.particleCount;
const ARENA=CONFIG.tables.arena;

/* =========================================================================
   Persisted player settings (localStorage). These are the in-menu options,
   distinct from the CONFIG tuning knobs above.
   ========================================================================= */
let cfg={diff:'pro',goals:5,theme:'classic',table:'classic',special:true,power:true,auto:true,sound:true,
 redName:'RED',blueName:'BLUE',redColor:'#ff4d5a',blueColor:'#3d8bff',
 // Per-team AI difficulty (overrides legacy single `diff`). Both default to
 // 'pro' when missing so older saves (or first-time players) still play normally.
 diffRed:null,diffBlue:null,
 // Customize-panel settings: selected figurine + material finish + size.
 modelRed:'cyborg',modelBlue:'cyborg',redYaw:-0.55,blueYaw:10.0,metalness:.15,roughness:.45,glow:0,modelScale:1};
try{Object.assign(cfg,JSON.parse(localStorage.getItem('fuzeball')||'{}'));}catch(e){}
if(cfg.model&&!cfg.modelRed){cfg.modelRed=cfg.model;cfg.modelBlue=cfg.model;delete cfg.model;saveCfg();}
// Migrate legacy single `diff` into per-team fields when those are missing.
if(!cfg.diffRed)cfg.diffRed=cfg.diff||'pro';
if(!cfg.diffBlue)cfg.diffBlue=cfg.diff||'pro';
cfg.diff=cfg.diffRed;
function saveCfg(){try{localStorage.setItem('fuzeball',JSON.stringify(cfg));}catch(e){}}
// Per-team figurine def (falls back to the first if the id is stale).
function activeModel(team){const M=CONFIG.playerModel;return M.models.find(m=>m.id===cfg[team===0?'modelRed':'modelBlue'])||M.models[0];}
