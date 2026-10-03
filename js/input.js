'use strict';
/* ================= input ================= */
const keys={};
// every input resolves device > seat > rod (js/seats.js); either may be null
function devSeat(tok){return seatForDev(tok);}
// every rod action is a binding (js/binds.js): code > actions > the seat owning the code's device > its rod
// press and release live here so they can't disagree
function bindPress(code){
 const dev=bindDev(code),s=devSeat(dev),r=s?seatRod(s):null;
 for(const a of bindActs(code,'play')){
  if(a==='guide'){if(s)toggleSweetGuide(s);continue;}   // the guide follows whoever asked (controller ○ mirrors this)
  // a key's camera and retry are taken earlier; only a mouse button bound to either lands here
  if(a==='camera'){if(dev==='mouse')cycleCam(1);continue;}
  if(a==='retry'){if(dev==='mouse'&&S.trial&&typeof trialRestart==='function')trialRestart();continue;}
  if(!r)continue;
  // kick: shots.js decides plain swing, pass (finesse) or release of a wind-up (power)
  if(a==='kick'){shotKickEdge(r,shotKbmAxis(s));r.kickHold=true;}   // held = the boot stays out at full stretch (js/rods.js)
  // raise: the press is latched for shots.js (s.rzEdge) so a sub-frame tap still poses the pin
  else if(a==='raise'){r.raise=true;rodRaiseRelease(r);s.rzEdge=true;}   // your hand on it ends any inherited raise
  else if(a==='rodPrev')seatStep(s,-1);
  else if(a==='rodNext')seatStep(s,1);
  else if(/^rod[1-4]$/.test(a))setSeatCtrl(s,+a[3]-1,1);
 }
}
// a modifier can lose its keyup (both Shifts on Windows): release any modifier keys[] thinks is down while the event's flag says up
const MOD_KEYS=[['shiftKey','ShiftLeft','ShiftRight'],['ctrlKey','ControlLeft','ControlRight'],
 ['altKey','AltLeft','AltRight'],['metaKey','MetaLeft','MetaRight']];
function modSync(e){
 for(const m of MOD_KEYS){
  if(e[m[0]])continue;
  for(let i=1;i<3;i++){const c=m[i];if(keys[c]&&c!==e.code){keys[c]=false;bindRelease(c);}}
 }
}
// a hold ends only when the last input holding it comes up (Space and LMB both kick)
function bindRelease(code){
 const s=devSeat(bindDev(code)),r=s?seatRod(s):null;if(!r)return;
 if(bindIs('kick',code)&&!bindHeld('kick',s))r.kickHold=false;           // the swing resumes from its held pose and drops
 if(bindIs('raise',code)&&!bindHeld('raise',s)){r.raise=false;rodRaiseRelease(r);}
}
function inMatch(){return S.phase==='play'||S.phase==='count';}
// Alt and F10 hand focus to the browser menu, dropping the pointer lock (read as Esc), so swallow keydown and keyup
function menuKey(code){return code==='AltLeft'||code==='AltRight'||code==='F10';}
addEventListener('keydown',e=>{
 // typing in a form control must never kick, slide or preventDefault
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 // a bound key never reaches the browser in a match; Ctrl+W/T/N can't be blocked (the desktop shell must)
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)||(inMatch()&&!S.photo&&!S.freeRoam&&(bindActs(e.code,'play').length||menuKey(e.code))))e.preventDefault();
 modSync(e);
 if(e.repeat)return;keys[e.code]=true;
 // photo mode (F1) takes the keyboard, after the keys[] write since photo.js reads that map
 if(S.photo)return;
 // the save key is tested first, before every other key skips the replay
 if(S.phase==='replay'){if(bindIs('saveClip',e.code))replaySaveClip();else replaySkip();return;}
 if(e.code==='Escape'){
  // Chrome eats Esc while pointer-locked (the release is the pause, see pointerlockchange); de-dupe browsers that send both
  if(mlEsc>0&&performance.now()-mlEsc<300){mlEsc=0;return;}
  if(!$('uiConfirm').classList.contains('hidden')){uiConfirmClose();Au.ui('back');return;}   // Esc answers "no" — never the destructive side
  if(!$('options').classList.contains('hidden')){closeOptions();return;}
  if(!$('lgForfeit').classList.contains('hidden')){$('lgForfeit').classList.add('hidden');return;}
  if(!$('lgWipe').classList.contains('hidden')){$('lgWipe').classList.add('hidden');return;}   // same rule as the forfeit: Esc answers the dialog, it doesn't leave the screen behind it
  // outside a match Esc steps back up the screen tree (js/screens.js); at a top-level screen it falls through to pause
  if(S.phase==='menu'&&backScreen()){Au.ui('back');return;}
  togglePause();return;
 }
 if(bindIs('camera',e.code)&&S.phase!=='menu'){cycleCam(1);}
 if(e.code==='KeyC'&&S.phase!=='menu'){toggleDebug();return;}
 if(e.code==='KeyL'&&S.phase!=='menu'&&dbgOn){cycleKickLog();return;}
 if(e.code==='KeyF'&&S.phase!=='menu'){toggleFreeRoam();return;}
 if(e.code==='KeyM'){togglePerf();return;}   // frame profiler overlay (js/perf.js) — works on the menu too, so a menu-side sag is measurable
 if(S.freeRoam)return;
 if(S.phase!=='play'&&S.phase!=='count')return;
 if(!S.seats.length)return;                       // nobody playing (AI showdown / spectate)
 mouseLockRequest();                              // any in-match key is a gesture too — so the lock catches within a beat of play starting
 bindPress(e.code);
});
addEventListener('keyup',e=>{keys[e.code]=false;modSync(e);
 if(menuKey(e.code)&&inMatch()&&!S.photo){e.preventDefault();mlAlt=performance.now();}
 if(S.freeRoam)return;
 bindRelease(e.code);});
// focus lost with a button down: the keyup never arrives, so release every hold here; the mouse carries modifier flags too
for(const ev of ['mousedown','mouseup','mousemove'])addEventListener(ev,modSync,{capture:true,passive:true});
addEventListener('blur',()=>{
 for(const k in keys)keys[k]=false;
 if(!S.seats)return;
 S.seats.forEach(s=>{
  const r=seatRod(s);
  if(r){r.kickHold=false;r.raise=false;rodRaiseRelease(r);}
  s.padRaise=false;s.padAngleArm=false;
 });
});
const cvs=$('game');
// every mouse path is gated on S.photo (the canvas is a viewfinder)
cvs.addEventListener('mousemove',e=>{
 if(S.photo||S.freeRoam||(S.phase!=='play'&&S.phase!=='count'))return;
 const ms=devSeat('mouse'),r=ms?seatRod(ms):null;if(!r)return;
 const dy=e.movementY||0;   // relative, works locked or not
 // a fixed span per screen-height on every rod; frozen for a beat after an auto hand-over (js/seats.js)
 if(dy&&seatSlideOK(ms))r.target=clamp(r.target+(dy/innerHeight)*CTRL.mouseSpan*CTRL.mouseSens*cfg.mouseSens,-r.maxOff,r.maxOff);
});
// mouse buttons are bindings (Mouse0 left, 1 middle, 2 right, 3 back, 4 forward) held in keys['Mouse<n>'], cleared on the window mouseup
cvs.addEventListener('mousedown',e=>{
 if(S.photo)return;
 const code='Mouse'+e.button;
 keys[code]=true;
 if(e.button===1||e.button>2)e.preventDefault();   // middle = autoscroll, 3/4 = browser Back/Forward
 if(S.phase==='replay'){if(bindIs('saveClip',code))replaySaveClip();else replaySkip();return;}   // any other click skips the goal replay
 if(S.freeRoam||!inMatch())return;
 if(!devSeat('mouse'))return;
 mouseLockRequest();                            // a click is a user gesture, which is what the lock needs
 bindPress(code);
});
addEventListener('mouseup',e=>{
 const code='Mouse'+e.button;keys[code]=false;
 if(e.button>2&&inMatch())e.preventDefault();   // Chrome navigates on the back/forward button's RELEASE
 if(S.photo||S.freeRoam)return;
 bindRelease(code);
});
cvs.addEventListener('contextmenu',e=>e.preventDefault());
// The wheel is a press with no release: WheelUp / WheelDown, rod switch by default.
addEventListener('wheel',e=>{if(!S.photo&&!S.freeRoam&&S.phase==='play'&&e.deltaY&&devSeat('mouse'))bindPress(e.deltaY>0?'WheelDown':'WheelUp');});
function userControlUpdate(dt){
 if(S.photo||S.freeRoam)return;
 // slide off the bindings per seat: bindHeld only counts inputs on a device this seat owns
 for(const s of S.seats){
  const r=seatRod(s);
  if(!r||!seatSlideOK(s))continue;
  let dz=0;
  if(bindHeld('slideUp',s))dz-=1;
  if(bindHeld('slideDown',s))dz+=1;
  if(dz)r.target=clamp(r.target+dz*CTRL.slideSpeed*cfg.kbdSens*dt,-r.maxOff,r.maxOff);
 }
 // auto rod-switch runs per seat, skips rods another seat holds, and is silent; autoHoldRod (ai.js) withholds the keeper mid-save
 // chases the threat to this seat's own goal (focusBall), not S.balls[0]
  if(cfg.auto&&S.phase==='play'&&S.time-S.lastSwitch>CTRL.autoDelay&&S.balls.length){
   S.seats.forEach(s=>{
    if(s.rods.length<2)return;
    const fb=focusBall(s.team);if(!fb)return;
    const bx=fb.m.position.x;
    let bi=s.ctrl,bd=1e9;
    s.rods.forEach((rr,i)=>{
     // ask the gate first on every rod so its clock never goes stale behind a rodTaken skip
     if(autoHoldRod(s,rr,fb)||rodTaken(rr,s))return;
     const d=Math.abs(bx-rr.x);if(d<bd){bd=d;bi=i;}
    });
    if(bi!==s.ctrl){
     rodInputRelease(s.rods[s.ctrl]);clearRodAI(s.rods[bi]);s.ctrl=bi;
     s.padAngleArm=false;                          // a stick already deflected re-centres before it drives the new rod
     s.slideArm=S.time+(CTRL.handover?CTRL.handover.settle||0:0);  // …and the swipe in flight doesn't come with it
     updateChips();
    }
   });
  }
 // inherited raise: a handed-over rod keeps the AI's lift (clearRodAI) and drops it by the benched-rod rule; release only
 S.seats.forEach(s=>{const r=seatRod(s);if(r&&r.raiseKeep&&!rodHoldRaise(r))r.raiseKeep=false;});
}
// ---- gamepad (Steam controller) ----
// standard-layout pad on the same controls, polled once per frame, edge-detected via gpPrev
// left stick Y / d-pad = slide, A(0) kick, X(2) raise, LB/RB or d-pad = switch rod, B(1) sweet-spot guide, Y(3) camera, Start(9) pause
// LT(6) and RT(7) are one axis, RT - LT (js/shots.js); with CONFIG.shots.on false they're duplicate kick/raise
// Total Control (cfg.padControlMode='total'): triggers also scale the slide step; the right stick angles the rod, its other axis is the swerve line (r.tcSpin)
const gpFree={};   // button edge state for pads NO seat has claimed — they can still hit Start/skip
function gpDown(gp,i){const b=gp.buttons[i];return!!b&&(b.pressed||b.value>0.5);}
// which seat drives pad #idx: an explicit 'pad2' owns it, a solo seat's 'pad*' answers only to the first connected pad
function padSeat(idx,first){
 const s=seatForDev('pad'+idx);
 if(!s)return null;
 if(s.devs.indexOf('pad'+idx)<0&&idx!==first)return null;
 return s;
}
// shared TC swerve read (also previewed by the options tester): raw right-stick axes to a signed ±1
function tcSwerveFromAxes(gp){
 let sx=(cfg.padAngleAxis==='rx'?gp.axes[3]:gp.axes[2])||0;
 if(Math.abs(sx)>cfg.padDeadzone)sx=(Math.abs(sx)-cfg.padDeadzone)/(1-cfg.padDeadzone)*Math.sign(sx);else sx=0;
 return clamp(sx*cfg.padTCSwerve,-1,1)*(cfg.padTCSpinInvert?-1:1);
}
addEventListener('gamepadconnected',e=>{console.log('gamepad connected:',e.gamepad.id);});
function gamepadUpdate(dt){
 if(S.photo)return;                                    // photo mode: a resting stick must not creep a rod out of shot
 if(!$('options').classList.contains('hidden'))return; // options screen owns the pad (live tester)
 const pads=navigator.getGamepads?navigator.getGamepads():[];
 // reset every frame, above the no-pads bail, so an unplugged pad stops scaling the slide
 S.seats.forEach(s=>{s.tcMult=1;});
 let first=-1;for(let i=0;i<pads.length;i++)if(pads[i]){first=i;break;}
 if(first<0)return;
 // global actions (pause, replay skip) fire from any pad but once per frame
 let didPause=false,didSkip=false;
 for(let idx=0;idx<pads.length&&idx<CONFIG.seats.maxPads;idx++){
  const gp=pads[idx];if(!gp)continue;
  const seat=padSeat(idx,first);
  // edge state lives on the seat so two pads can't share one gpPrev; unclaimed pads get a scratch slot
  const prev=seat?seat.padPrev:(gpFree[idx]||(gpFree[idx]={}));
  const just={};
  for(const i of [0,1,3,4,5,7,8,9,14,15]){const d=gpDown(gp,i);just[i]=d&&!prev[i];prev[i]=d;}
  // a press a menu used is still down on the first frame of play and would arrive as a kick
  padNavFilter(idx,just);
  // Y saves the clip (must beat the skip buttons); A/B/Start still skip
  if(S.phase==='replay'){if(just[REPLAY.save.pad])replaySaveClip();
   else if(!didSkip&&(just[0]||just[1]||just[9])){didSkip=true;replaySkip();}continue;}
  if(just[9]&&!didPause&&(S.phase==='play'||S.phase==='count'||S.phase==='pause')){didPause=true;togglePause();}
  // an overlay on a live match (a finished trial's result card) has the pad: no rod input under it
  if(padNavOwns())continue;
  // VIEW retries a Skill Trial (the pad's R); trials.js owns what a retry is
  if(just[8]&&S.trial&&S.phase==='play'&&typeof trialRestart==='function'){trialRestart();continue;}
  if(just[8]&&S.tut&&S.phase==='play'&&typeof tutSkip==='function'){tutSkip();continue;}   // the tutorial's skip-a-lesson
  if(!seat)continue;
  padSeatUpdate(dt,gp,seat,just);
 }
}
// one seat's pad for one frame, off the seat so N pads drive N rods
// order: slide, angle, shots, buttons (the stick's pull-back decides whether kick is a swing or a release)
function padSeatUpdate(dt,gp,s,just){
 const r=(!S.freeRoam&&(S.phase==='play'||S.phase==='count'))?seatRod(s):null;
 // (the hand-off rule, a dropped rod keeps no wind-up, is shots.js shotSeatsUpdate's)
 if(!r){s.padRaise=false;return;}
 const DZ=cfg.padDeadzone,TC=cfg.padControlMode==='total';
 // TC speed: triggers scale the slide step size, not rod speed (tcMult floored at 1); LT wins a tie, putting the charge chord on the fine step
 let slideMult=1;
 if(TC){
  const trig=i=>{const b=gp.buttons[i];return b?(b.value||(b.pressed?1:0)):0;};
  const lt=trig(6),rt=trig(7);
  let m=cfg.padTCBase;
  if(rt>0)m=lerp(m,cfg.padTCFast,rt);
  if(lt>0)m=lerp(m,cfg.padTCFine,lt);
  const padLive=gp.buttons.some(b=>b.pressed||b.value>0.02)||gp.axes.some(a=>Math.abs(a)>DZ);
  slideMult=m;s.tcMult=padLive?Math.max(1,m):1;
 }else s.tcMult=1;
 // slide: 'ly' = left-stick up/down, 'lx' = left/right; past the deadzone rescaled to 0..1, shaped by padSlideCurve, optionally inverted, scaled by padSlideSens
 let ax=(cfg.padSlideAxis==='lx'?gp.axes[0]:gp.axes[1])||0,ay=0;
 if(Math.abs(ax)>DZ){
  const n=(Math.abs(ax)-DZ)/(1-DZ);                  // 0 at deadzone edge → 1 at full deflection
  ay=Math.pow(n,cfg.padSlideCurve)*Math.sign(ax);
  if(cfg.padSlideInvert)ay=-ay;
 }
 if(gpDown(gp,12))ay-=1;if(gpDown(gp,13))ay+=1;      // d-pad ↕ always slides (digital)
 if(ay&&seatSlideOK(s))r.target=clamp(r.target+ay*CTRL.slideSpeed*cfg.padSlideSens*slideMult*dt,-r.maxOff,r.maxOff);  // frozen for a beat after an auto hand-over (js/seats.js)
 // angle: absolute tilt, stick position = target angle ('ry' = right stick up/down, 'rx' = left/right); forward eases to strike, back to raised, centre = feet down
 // sd is the same signed value for shots.js: -1 fully back .. +1 fully forward
 let rs=(cfg.padAngleAxis==='rx'?gp.axes[2]:gp.axes[3])||0,sd=0;
 // re-centre gate: a stick already forward at a switch would snap the new rod to the strike angle in one frame (the kickA0 spike, js/rods.js)
 // so a switch disarms the stick (padAngleArm) until it passes the deadzone
 if(!s.padAngleArm&&Math.abs(rs)<=DZ)s.padAngleArm=true;
 if(s.padAngleArm&&Math.abs(rs)>DZ){
  if(cfg.padAngleInvert)rs=-rs;
  let d=(Math.abs(rs)-DZ)/(1-DZ)*Math.sign(rs);      // 0 at deadzone edge → ±1 at full deflection
  d=clamp(-d*cfg.padAngleSens,-1,1);                 // sens scales reach; sign keeps the old push direction
  sd=d;
  r.padAngleTarget=(d>=0?d*KICK.strikeA:-d*KICK.raiseA)*r.kickDir; // +push→forward, −push→raised; ×kickDir per team
  r.padAngleOn=true;
  rodRaiseRelease(r);                                // the stick is driving the angle now — inherited raise done
 }else{r.padAngleTarget=0;r.padAngleOn=false;}
 // TC swerve: the right-stick axis not bound to angle, stored on the rod and added to side-spin on contact (physics.js)
 if(TC){r.tcSpin=tcSwerveFromAxes(gp);}
 else if(r.tcSpin)r.tcSpin=0;
 // shots: read the trigger axis and charge source into this seat's pad record; the step runs once per seat after all pads
 if(shotsOn())shotPadRead(s.shotPad||(s.shotPad=shotInNew()),gp,TC,sd);
 // A: kick (RT is the alternate kick only while shots are off); with a wind-up live the kick button is a second release
 if((just[0]&&shotKickPress(TC))||(!TC&&just[7]&&!shotsOn()))shotKickEdge(r,shotPadAxis(gp));
 if(just[1])toggleSweetGuide(s);                     // ○ (B) — sweet-spot guide, on THIS seat's rod
 if(just[3])cycleCam(1);                             // Y
 if(just[4]||just[14])seatStep(s,-1);                // LB / d-pad ← (skips rods another seat holds)
 if(just[5]||just[15])seatStep(s,1);                 // RB / d-pad →
 // raise is a hold: only write r.raise while the button is down or just released, so an idle pad never clobbers keyboard raise; LT is the alternate raise only while shots are off
 const raise=gpDown(gp,2)||(!TC&&gpDown(gp,6)&&!shotsOn());
 if(!r.padAngleOn&&!r.chgSrc){if(raise){r.raise=true;s.padRaise=true;rodRaiseRelease(r);}else if(s.padRaise){r.raise=false;s.padRaise=false;rodRaiseRelease(r);}}
}
function toggleFreeRoam(){
 S.freeRoam=!S.freeRoam;
 if(S.freeRoam){
  const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  S.camYaw=e.y;S.camPitch=e.x;
  toast('FREE ROAM','WASD move · Q/E up/down · Shift sprint · Esc exit',1.8);
 }else{
  document.exitPointerLock();
  toast('FREE ROAM','off',0.9);
 }
 Au.ui();
}
cvs.addEventListener('click',()=>{if(S.freeRoam&&S.phase!=='menu')cvs.requestPointerLock();});
// ---- POINTER LOCK IN A MATCH (cfg.mouseLock) ----
// re-asserted every frame (mouseLockTick) so no exit path strands the cursor; requested from a gesture, gives up if refused
// the browser owns Esc while locked: its release is read as the pause; mlSelf marks releases we asked for
let mlSelf=false,mlEsc=0;   // mlEsc: when a lock release stood in for an Escape press (see the keydown grace above)
let mlAlt=0;                // when Alt / F10 last came up in a match (menuKey): a lock lost right after is the browser menu, not Esc
function mouseLockWant(){
 if(!cfg.mouseLock)return false;
 if(S.freeRoam||S.photo)return false;                     // both drive the cursor themselves
 if(S.phase!=='play'&&S.phase!=='count')return false;
 if(!devSeat('mouse'))return false;                       // nobody is steering with the mouse
 if(S.trial&&S.trial.done)return false;                   // the result card takes clicks (plain data — safe with no trials.js)
 if(S.tut&&S.tut.card)return false;                       // …and so does the tutorial's
 const p=$('trnPanel');
 if(p&&!p.classList.contains('hidden'))return false;      // sandbox tools are clicks
 return true;
}
function mouseLockRequest(){
 if(!mouseLockWant()||document.pointerLockElement)return;
 const p=cvs.requestPointerLock();
 if(p&&p.catch)p.catch(()=>{});   // no gesture yet, or Chrome's cooldown after an Esc release — the next input retries
}
function mouseLockTick(){
 if(document.pointerLockElement===cvs&&!mouseLockWant()){mlSelf=true;document.exitPointerLock();}
}
document.addEventListener('pointerlockchange',()=>{
 if(document.pointerLockElement)return;
 if(mlSelf){mlSelf=false;return;}                         // we let it go on purpose
 if(S.freeRoam){S.freeRoam=false;return;}
 if(mlAlt&&performance.now()-mlAlt<400)return;           // the browser menu took it off an Alt: not a pause — the next input re-locks
 if(mouseLockWant()){mlEsc=performance.now();togglePause();}   // Esc, or focus lost — read the release as the pause press
});
document.addEventListener('mousemove',e=>{
 if(!S.freeRoam||!document.pointerLockElement)return;
 S.camYaw-=e.movementX*CAM.freeRoamSens*.001;
 S.camPitch-=e.movementY*CAM.freeRoamSens*.001;
 S.camPitch=clamp(S.camPitch,-Math.PI/2+.01,Math.PI/2-.01);
});
