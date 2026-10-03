'use strict';
/* ================= game flow ================= */
let matchLoading=false;
// match-start gate: every quick/AI/rematch/training start goes through here so a match can't kick off before its assets are resident
// ensureMatchAssets (main.js) resolves synchronously when cached, else a LOADING overlay shows; league/cup gate their own assets (S.lg set)
function startMatch(mode,rodLockRole){
 if(S.lg||typeof ensureMatchAssets!=='function'){startMatchNow(mode,rodLockRole);return;}
 if(matchLoading)return;                     // a start is already pending — swallow repeat clicks
 // `veil` = whether this path actually raised the loader (it's refcounted, only lower what you raised)
 matchLoading=true;let sync=false,veil=false;
 const go=()=>{sync=true;matchLoading=false;
  if(veil){veil=false;showMatchLoading(false);}
  if(rods.length){rebuildRodMen();applyColors();}  // refresh the men to the now-resident figurines + kit colours (mirrors league start())
  startMatchNow(mode,rodLockRole);};
 ensureMatchAssets(go);
 if(!sync){veil=true;showMatchLoading(true,'LOADING');}   // assets weren't ready synchronously → show the loader until go() fires
}
// the loading veil is refcounted: the match-start gate and a venue swap (venueLoad) can both want it
let mlN=0;
function showMatchLoading(on,label){
 let el=$('matchLoad');
 if(!el){if(!on)return;el=document.createElement('div');el.id='matchLoad';
  el.innerHTML='<div class="mlBox"><div class="mlSpin"></div><span id="mlLabel">LOADING</span></div>';document.body.appendChild(el);}
 mlN=Math.max(0,mlN+(on?1:-1));
 if(on){const t=$('mlLabel');if(t)t.textContent=label||'LOADING';}
 el.classList.toggle('show',mlN>0);
}

// ===== STAGED VENUE SWAP =====
// room, table, skin, pitch or reflection changes used to run as one synchronous chain with no paint between, so the tab seemed to hang; now four steps, one frame each:
//   1. veil up, wait out its CSS fade   2. run(done): the caller's applyRoom / applyTable / selectSkin (onReady fires when assets are resident)
//   3. warm: renderer.compile(scene,camera) forces shader link and texture upload under the veil   4. one clean frame, veil drops
// coalesced, not queued: a request mid-swap replaces the pending one; `silent` runs the staging with no veil
let venueBusy=false,venuePend=null;
function venueLoad(run,opts){
 opts=opts||{};
 if(typeof run!=='function'){if(opts.onDone)opts.onDone();return;}
 if(venueBusy){venuePend={run:run,opts:opts};return;}          // coalesce: only the latest survives
 venueBusy=true;
 const V=(typeof CONFIG!=='undefined'&&CONFIG.venue)||{};
 const staged=V.on!==false, veil=staged&&!opts.silent;
 const fade=(V.fadeT===undefined?0.24:V.fadeT)*1000;
 const minT=(V.minT===undefined?0.45:V.minT)*1000;
 const t0=Date.now();
 if(veil)showMatchLoading(true,opts.label||'LOADING');
 // one settled frame later: the first rAF callback runs before the paint that applies the change
 const next=(fn,ms)=>{
  if(!staged){fn();return;}
  const go=()=>requestAnimationFrame(()=>requestAnimationFrame(fn));
  if(ms)setTimeout(go,ms);else go();
 };
 const finish=()=>{
  if(typeof renderDirty==='function')renderDirty();
  setTimeout(()=>{
   if(veil)showMatchLoading(false);
   venueBusy=false;
   if(opts.onDone)opts.onDone();
   const p=venuePend;venuePend=null;
   if(p)venueLoad(p.run,p.opts);
  },veil?Math.max(0,minT-(Date.now()-t0)):0);
 };
 const warm=()=>{
  // gated on `staged` so CONFIG.venue.on:false is a true off switch (the old path did no warm)
  if(staged){
   try{if(typeof renderer!=='undefined'&&renderer&&scene&&camera)renderer.compile(scene,camera);}
   catch(e){console.warn('venue warm failed',e);}            // a warm that throws must not strand the veil
   if(typeof shadowDirty==='function')shadowDirty();
  }
  next(finish);
 };
 next(()=>{
  let done=false;
  const settle=()=>{if(done)return;done=true;next(warm);};
  // hard ceiling on the wait: a hung fetch fires neither load nor error, and a veil that never lifts is worse than the freeze
  setTimeout(settle,(V.maxT===undefined?9:V.maxT)*1000);
  try{run(settle);}catch(e){console.warn('venue load threw',e);settle();}
 },veil?fade:0);
}
function startMatchNow(mode,rodLockRole){
 // the menu is clickable before boot() has run (skipped intro, reduced motion); starting then threw on S.ctrlRods[S.ctrl]; boot() is idempotent, so force it
 if(!rods.length){
  if(typeof boot==='function')boot();
  if(!rods.length)return;   // main.js not parsed yet — swallow the click rather than start a rodless match
 }
 Au.init();Au.ui('start');
 // 'roster' = the Kick Off line-up (S.roster, js/roster.js); userTeam is the primary seat's team, -1 with an empty roster = an AI-vs-AI spectate like 'ai'
 S.mode=mode;
 S.userTeam=mode==='roster'?(S.roster.length?S.roster[0].team:-1)
  :(mode==='red'||mode==='training')?0:mode==='blue'?1:-1;
 S.rodLockRole=mode==='roster'?null:(rodLockRole||null);
 // seed the sim's random surface (js/rng.js) before anything draws; seedNext is consumed here so a trial's seed can't leak into the next match
 S.seed=(S.seedNext!=null)?(S.seedNext>>>0):(Date.now()>>>0);S.seedNext=null;rngSeed(S.seed);
 S.score=[0,0];S.stats=freshStats();S.matchTime=0;S.time=0;S.timeScale=1;S.suddenDeath=false;S.clockBeep=0;S.pendingWin=null;
 S.serveAt=null;   // a restart spot left over from the last match must not aim its first kickoff
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 S.lastTouch=-1;S.lastSwitch=0;S.shake=0;
  clearBalls();clearPU();clearFractures();replayAbort();replayCut();clearMarks();
  // prime both teams' shatter GLBs (every mode funnels through startMatch, incl. league/cup); no live instance uses a template now, so prune every other figurine's
  if(typeof ensureExplosionModel==='function'){
   const ea=activeModel(0).id,eb=activeModel(1).id;
   ensureExplosionModel(ea);ensureExplosionModel(eb);
   if(typeof pruneExplosionModels==='function')pruneExplosionModels([ea,eb]);
  }
  S.active=[[],[]];S.pairCd=[0,0];
  rods.forEach(r=>{r.offset=0;r.target=0;r.slideV=0;r.angle=0;r.prevAngle=0;r.prevOffset=0;
   r.kickT=-1;r.raise=false;r.raiseKeep=false;r.padAngleOn=false;r.padAngleTarget=0;r.kickHold=false;r.cd=0;r.exert=0;r.aiMan=-1;r.aiErr=0;r.aiErrT=0;r.aiErrTarget=0;
   // r.exert (swing fatigue) is cleared here only, not in resetRodRotation (that runs on every goal/dead ball/out)
   r.aiBX=r.x;r.aiBZ=0;r.aiBVX=0;r.aiBVZ=0;r.aiGoalZ=0;
   r.removedUntil=[];r.men.forEach(m=>{m.visible=true;});
   r.pivot.rotation.z=0;r.pivot.position.z=0;
   const mine=S.userTeam<0?r.team===0:r.team===S.userTeam;
   if(r.rodModel){r.rodModel.rotation.y=mine?0:Math.PI;}   // flip the whole GLB rod so the handle is on the near side
   else{const hs=mine?1:-1,C=rodCollar(r.maxOff);
    r.handle.position.z=hs*(C+CONFIG.rods.handleLen/2);
    r.collar.position.z=-hs*(C+CONFIG.rods.collarLen/2);}});
  // SEATS (js/seats.js): the roster's specs become live seats; every other entry point gets one solo seat holding every device
  S.seats=mode==='roster'?S.roster.map(p=>makeSeat(p.team,p.devs,p.lockRole))
   :S.userTeam<0?[]:[soloSeat(S.userTeam,rodLockRole)];
  seatBindRods();
  // the camera persists between matches: step off a shot that's no longer offerable
  if(typeof camModeOK==='function'&&!camModeOK(S.camMode))cycleCam(1);
  // the hint speaks to the devices actually seated and offers switching only if someone can; the pad line says what the triggers do in this mode
  {const kb=S.seats.some(s=>s.devs.some(d=>d==='kbd'||d==='mouse')),pd=S.seats.some(s=>s.devs.some(d=>/^pad/.test(d)));
   const sw=S.seats.some(s=>s.rods.length>1);
   const trg=cfg.padControlMode==='total'?' · {LT} fine · {RT} fast':shotsOn()?(SHOT.charge.needRaise?' · {RT}+{X} wind up':' · {RT} power')+' · {LT} touch'+(SHOT.pin&&SHOT.pin.on?' · {LT}+{X} pin':''):'';
   // the keyboard line comes off the bindings (js/binds.js), so a rebind shows
   const H=bindHintRods(sw,S.seats.some(s=>s.devs.indexOf('mouse')>=0));
   hudHint(!S.seats.length?bindHint('camera','camera'):kb?[bindJoin([H.sw,H.slide,bindHint('camera','camera')]),H.act,H.mod].filter(Boolean).join('\n'):null,
    !S.seats.length?'{Y} camera':pd?(sw?'{LB} {RB} switch rod · ':'')+'{LS} slide · {RS} tilt\n{A} kick · {X} raise'+trg:null);}
 // remember where this match launched from so quitting returns there (league/cup have their own return paths, a bare quit goes home)
 S.fromScreen=S.lg?'home':screenId();
 hideScreens();                                                        // every registered screen down (js/screens.js)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');  // overlays aren't registered, so they're torn down by hand
 hudShow(true);   // canvas HUD up: this match's names, colours and score, no tabs carried over (js/hud.js)
  // pre-kickoff shader warm (fracture.js): compile every fx a match can fire at this light count, before the whistle
  if(typeof warmMatchAssets==='function')warmMatchAssets();
  if(mode==='training'){trainingEnter();return;}   // sandbox: no countdown/serve — training.js owns the phase from here
  // a normal match gets no tag chip; league/cup/spectate get one (information you can't infer)
  const sub=S.lg?(S.lg.cup?S.lg.banner:'LEAGUE · ROUND '+(LG.round+1)):(S.userTeam<0?'AI SHOWDOWN':'');
  const _lim=gameTimeLimit();
  banner(_lim>0?(_lim/60)+' MIN · TO '+goalTarget():'FIRST TO '+goalTarget(),sub,1.7,'var(--gold)');
 startCount(MATCH.countIn);
}
function startCount(t){S.phase='count';S.countT=t;S.lastCount=-1;}   // the loop is the count's only writer (main.js → hudCount)
function onGoal(team,b){
 if(b.scored)return;
 Au.goalIn(b);   // the ball dropping into the goal (recorded only)
 if(S.trn){trainingGoal(team,b);return;}   // training: fx + reset to the last placed spot, never ends anything
 b.scored=true;
 const val=b.t.value||1;
 // classify the goal before removeBall (b.v is the velocity at the line); M carries the sub chip and banner accent (js/moments.js)
 const M=momGoal(team,b);
 msGoal(team,b);msRallyEnd();   // matchstats.js: scorer credit and rally clock; both read records hanging off the ball, which removeBall frees
 S.score[team]+=val;
 goalFx(team,b,msScorer(b,team));   // the ring flash wants the scoring rod; msScorer decides (matchstats.js)
 updateScoreUI(team);
 removeBall(b);
 const wins=S.suddenDeath||S.score[team]>=goalTarget();   // golden goal after a level time-up, or the target reached
 if(wins){
  // the winning goal gets the same celebration and replay: S.pendingWin parks the winner, main.js's goal timer hands off to replayStart, replayEnd routes to endMatch
  // replayReady() is checked first, so anything that can't show footage goes straight to endMatch
  if(REPLAY.winner&&!S.balls.length&&replayReady()){
   // the winner keeps its own sub (the format outranks the flavour); an own goal still takes the neutral accent
   banner(teamName(team)+' GOAL',S.suddenDeath?'GOLDEN GOAL':'MATCH WINNER',1.9,M.col);
   resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;
   replayQueue(team);S.pendingWin=team;return;
  }
  endMatch(team);return;
 }
 // accented in the scoring team's colour
 banner(teamName(team)+' GOAL',M.sub,1.9,M.col);
 if(!S.balls.length){resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;
  replayQueue(team);}   // instant replay plays after the celebration (main.js goal-timer handoff; gated by cfg.replay and footage length)
}
// open the win screen for a goal held back for its replay; false when nothing is waiting; onGoal is the only writer of S.pendingWin
function finishPendingWin(){if(S.pendingWin==null)return false;const w=S.pendingWin;S.pendingWin=null;endMatch(w);return true;}
// match clock (timed modes), every 'play' frame after S.matchTime advances: final-seconds warning, then at time-up end the match or go to sudden death (level); fires once
function checkMatchClock(){
 if(S.trn)return;                         // training: no clock, ever
 const lim=gameTimeLimit();               // seconds; 0 = unlimited
 if(lim<=0||S.suddenDeath)return;
 const rem=lim-S.matchTime;
 if(rem<=MATCH.warnT){const s=Math.ceil(rem);if(s>=1&&s!==S.clockBeep){S.clockBeep=s;Au.count(-1);}}
 if(rem>0)return;
 if(S.score[0]!==S.score[1]){Au.whistle(2);endMatch(S.score[0]>S.score[1]?0:1);}
 else{S.suddenDeath=true;Au.whistle();banner('SUDDEN DEATH','NEXT GOAL WINS',2.2,'var(--gold)');}
}
function outOfBounds(b){
 if(S.trn){redropBall(b);Au.whistle();return;}   // training: keep the ball live, no goal-hold
 // grab x before removeBall frees the mesh: the restart is keyed to the third the ball left from (S.serveAt > serve())
 const ox=(b.cur||b.m.position).x;
 msRallyEnd();   // the ball leaving play ends the rally, same as a goal (matchstats.js)
 removeBall(b);Au.whistle();
 // only the ball that ends the rally sets the restart spot (in multi-ball the others are still live)
 if(!S.balls.length&&S.phase==='play'){S.serveAt=ox;resetRodRotation();notice('OUT OF PLAY',1.1);S.phase='goal';S.goalT=MATCH.outHold;}
}
function endMatch(w){
 S.phase='win';S.pendingWin=null;   // cleared here too: a clock-out/forfeit can land while a goal replay is queued
 Au.goal('win');Au.whistle(3);
 flash();S.shake=1;
 clearBalls();clearPU();replayAbort();clearFxRail();
  const wasLg=!!S.lg;
  if(wasLg){(S.lg.cup?cupRecord:lgRecord)(w);} // record + sim the rest while the bridge is live
 $('winTitle').textContent=teamName(w)+' WINS';
 $('winTitle').style.color=teamCol(w);
 // the full-time board: each plate in its team's colour, ink picked for contrast, the winner's lit
 for(const t of [0,1]){const n=$('winName'+t);n.textContent=teamName(t);n.style.setProperty('--tc',teamCol(t));n.style.color=typeof hudInk==='function'?hudInk(teamCol(t),.62):'#fff';
  n.classList.toggle('lost',t!==w);$('winS'+t).textContent=S.score[t];}
 msRallyEnd();      // a clock-out / forfeit ends the last rally without a goal or an out
 msWinRender();     // matchstats.js owns both stat tabs (see the sheet block at the foot of that file)
 // the league/cup REWARDS strip stays here: it knows about the league bridge and sits outside the tabs
 const lgLine=t=>'<span>'+t+'</span>';
 $('winRewards').innerHTML=!wasLg?'':(S.lg.cup
   ?lgLine(S.lg.banner)+   // banner holds the round played (cupRecord already advanced LG.cup.round)
    // parts/champ are stamped by cupRecord just above
    (S.lg.champ?lgLine(CUP.name.toUpperCase()+' WINNERS · +'+S.lg.parts+' upgrade parts')
     :S.lg.parts?lgLine('Through to the next round · +'+S.lg.parts+' upgrade parts'):'')
   :lgLine('+'+(w===0?CONFIG.league.upWin:CONFIG.league.upLoss)+' upgrade parts')+
    (w===0&&S.score[1]===0?lgLine('Clean sheet · +'+CONFIG.league.upCleanSheet+' upgrade parts'):''));
 $('winRewards').classList.toggle('hidden',!wasLg);
 $('btnWinContinue').classList.toggle('hidden',!wasLg); // league: Continue → lobby
 $('btnRematch').classList.toggle('hidden',wasLg);      // league: no rematches
 $('win').classList.remove('hidden');
 confetti(w);
}
function togglePause(){
 if(S.phase==='play'||S.phase==='count'){S.prePause=S.phase;S.phase='pause';$('pause').classList.remove('hidden');Au.ui('open');}
 else if(S.phase==='pause'){S.phase=S.prePause;$('pause').classList.add('hidden');mouseLockRequest();Au.ui('back');}   // the Resume click is the gesture the lock needs
}
function gotoMenu(){
  if(S.trn&&typeof trainingExit==='function')trainingExit();   // restore hidden rods and drop the training gate
  // kit only: the venue belongs to the league session (top of js/league.js); lgVenueExit is the quit-to-home backstop, deferred a tick so `gotoMenu(); openLeague()` cancels it
  if(S.lg&&S.lg.prevKit){
   cfg.redColor=S.lg.prevKit.redColor;cfg.blueColor=S.lg.prevKit.blueColor;
   cfg.modelRed=S.lg.prevKit.modelRed;cfg.modelBlue=S.lg.prevKit.modelBlue;
   cfg.special=S.lg.prevKit.special;cfg.power=S.lg.prevKit.power;
   loadPlayerModel(()=>{rebuildRodMen();applyColors();});
  }
  if(typeof lgVenueExit==='function')lgVenueExit();
  S.phase='menu';clearBalls();clearPU();clearFractures();replayAbort();clearFxRail();clearMarks();
  // no match live: free every shatter GLB except the two figurines the menu shows
  if(typeof pruneExplosionModels==='function')pruneExplosionModels([activeModel(0).id,activeModel(1).id]);
 S.lg=null;S.teamStats=null; // drop any league-match bridge (abandoned matches aren't recorded)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');hudShow(false);  // overlays — not in the screen registry
 showScreen(S.fromScreen||'menu');   // back to the launching screen (see startMatchNow); also re-clamps a saved panel arrangement
 indicators.forEach(m=>{m.visible=false;});dropRing.visible=false;
}
