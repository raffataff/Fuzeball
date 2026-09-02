'use strict';
/* ================= game flow ================= */
let matchLoading=false;
/* Match-start GATE. Every quick / AI / rematch / training start funnels through here so a match can
   NEVER kick off before the assets it needs are resident — the "textures missing when I skip the
   loading screen" bug (skipping the intro reveals the menu, but the timed asset load hadn't run yet).
   ensureMatchAssets (main.js) resolves synchronously when everything's cached (the normal case → no
   visible delay); when it isn't (a skipped intro, or a table/room/figurine the player just picked),
   we show a brief LOADING overlay and start the instant it's ready. League/cup matches already gate
   their own assets (applyTable/applyRoom/loadPlayerModel) before calling in, so they pass straight
   through (S.lg set). */
function startMatch(mode,rodLockRole){
 if(S.lg||typeof ensureMatchAssets!=='function'){startMatchNow(mode,rodLockRole);return;}
 if(matchLoading)return;                     // a start is already pending — swallow repeat clicks
 // `veil` tracks whether we ACTUALLY raised the loader. It used to be enough to just call
 // showMatchLoading(false) unconditionally, because the call was a plain toggle — but the veil is
 // refcounted now (a venue swap can be holding it at the same time), so an unbalanced lower would
 // pull it off someone else's half-built room. Only lower what this path raised.
 matchLoading=true;let sync=false,veil=false;
 const go=()=>{sync=true;matchLoading=false;
  if(veil){veil=false;showMatchLoading(false);}
  if(rods.length){rebuildRodMen();applyColors();}  // refresh the men to the now-resident figurines + kit colours (mirrors league start())
  startMatchNow(mode,rodLockRole);};
 ensureMatchAssets(go);
 if(!sync){veil=true;showMatchLoading(true,'LOADING');}   // assets weren't ready synchronously → show the loader until go() fires
}
/* The loading veil. REFCOUNTED, because two things can want it at once now: the match-start gate
   above and a venue swap (venueLoad, below). Without a count, whichever finished first would pull
   the veil off the other and reveal a half-built room. `label` is only read on the way up, so the
   caller that raised it owns the wording until it comes down. */
let mlN=0;
function showMatchLoading(on,label){
 let el=$('matchLoad');
 if(!el){if(!on)return;el=document.createElement('div');el.id='matchLoad';
  el.innerHTML='<div class="mlBox"><div class="mlSpin"></div><span id="mlLabel">LOADING</span></div>';document.body.appendChild(el);}
 mlN=Math.max(0,mlN+(on?1:-1));
 if(on){const t=$('mlLabel');if(t)t.textContent=label||'LOADING';}
 el.classList.toggle('show',mlN>0);
}

/* ===== STAGED VENUE SWAP ==================================================
   Changing the room, table, skin, pitch or reflections used to happen in ONE synchronous run
   straight off a <select> change: fetch and parse the backdrop GLB (the pub's is ~45MB), bake a
   PMREM env, recompile every material in the scene if the incoming room's key-light configuration
   differs from the outgoing one, rebuild the props — and then hand the browser a first frame
   carrying the whole texture upload. Nothing yielded anywhere in that chain, so the browser never
   got a paint in between. THAT is why it reads as the tab hanging rather than as something
   loading, and why bolting a spinner onto it would have changed nothing: the spinner could not
   have been drawn either.

   THE FIX IS NOT MAKING THE WORK FASTER, IT IS GIVING IT SOMEWHERE TO HAPPEN — the same shape as
   the league's tape screen. Four steps, each on its own frame:
     1. veil up, then WAIT OUT ITS CSS FADE. Skipping this wait is the obvious optimisation and it
        is wrong: the stall lands mid-transition and the veil freezes half-drawn, which reads worse
        than no veil at all.
     2. run(done) — the caller's applyRoom / applyTable / selectSkin. Every one of those already
        takes an onReady that fires when its assets are RESIDENT, and resolves synchronously when
        they already are; that existing contract is the only reason this is cheap to add.
     3. warm: renderer.compile(scene,camera). THIS IS THE LOAD-BEARING LINE. compile() forces the
        shader link AND the texture upload that three.js otherwise defers to the first render, so
        the cost lands here, under the veil, instead of on the first frame the player sees.
        js/props.js warmPropShaders already proved the technique — it just never ran for a room
        with no props, i.e. `open`, `saucer` and `pub`, which is most of them.
     4. one clean frame, then the veil drops.

   COALESCED, NOT QUEUED. Holding the arrow keys on the room dropdown fires a change per room, and
   running those in series would load every room between where you started and where you stopped.
   A request arriving mid-swap REPLACES the pending one, so only the room you actually settled on
   is ever fetched.

   `silent` runs the identical staging with no veil — for a swap the player is not waiting on: the
   league's own tape screen is already up, or the venue is being handed back in the background. The
   staging alone is most of the win; the veil is just what makes the wait legible. */
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
 // One SETTLED frame later. The rAF pair matters: the first callback runs before the paint that
 // applies whatever we just changed, so work scheduled on it still lands in the same visual frame.
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
  // Gated on `staged` so CONFIG.venue.on:false is a TRUE off switch — the old path did no warm,
  // and an escape hatch that still changes behaviour is not an escape hatch.
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
  // Hard ceiling on the wait. Every loader in the tree falls back on a miss (a 404 room uses the
  // shared backdrop, a missing skin keeps the primitives), but a hung fetch fires neither load nor
  // error — and a veil that never lifts is a worse bug than the freeze this replaces.
  setTimeout(settle,(V.maxT===undefined?9:V.maxT)*1000);
  try{run(settle);}catch(e){console.warn('venue load threw',e);settle();}
 },veil?fade:0);
}
function startMatchNow(mode,rodLockRole){
 // The menu is clickable BEFORE main.js's boot() has run (intro skipped by a key/click, the
 // reduced-motion path, or the intro's holdMax expiring while GLBs are still loading). Starting
 // then gave a match with rods===[] → S.ctrlRods empty → every canvas move/click threw on
 // S.ctrlRods[S.ctrl]. boot() is idempotent and falls back to primitives, so just force it.
 if(!rods.length){
  if(typeof boot==='function')boot();
  if(!rods.length)return;   // main.js not parsed yet — swallow the click rather than start a rodless match
 }
 Au.init();Au.ui();
 // 'roster' = the Kick Off lobby's line-up (S.roster, js/roster.js). userTeam is the PRIMARY
 // seat's team — it drives the camera/HUD tint and the handle-side flip, not per-player state —
 // so with an empty roster it falls to -1 and the match is an AI-vs-AI spectate, same as 'ai'.
 S.mode=mode;
 S.userTeam=mode==='roster'?(S.roster.length?S.roster[0].team:-1)
  :(mode==='red'||mode==='training')?0:mode==='blue'?1:-1;
 S.rodLockRole=mode==='roster'?null:(rodLockRole||null);
 // Seed the sim's random surface (js/rng.js) BEFORE anything draws from it - clearPU below is
 // the first consumer. seedNext is consumed here, like serveAt, so a trial's seed can't leak
 // into the next match; with nothing set it's the wall clock and play is as varied as ever.
 S.seed=(S.seedNext!=null)?(S.seedNext>>>0):(Date.now()>>>0);S.seedNext=null;rngSeed(S.seed);
 S.score=[0,0];S.stats=freshStats();S.matchTime=0;S.time=0;S.timeScale=1;S.suddenDeath=false;S.clockBeep=0;S.pendingWin=null;
 S.serveAt=null;   // a restart spot left over from the last match must not aim its first kickoff
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 S.lastTouch=-1;S.lastSwitch=0;S.shake=0;
  clearBalls();clearPU();clearFractures();replayAbort();replayCut();clearMarks();
  // Prime BOTH teams' shatter GLBs here — every mode funnels through startMatch, so this covers
  // quick/AI matches AND league/cup (whose loadPlayerModel setup skips reloadPlayerModel's prime).
  // clearFractures() above means no live instance references any template, so it's safe to then
  // prune every OTHER figurine's shatter — residency stays bounded to the two teams on the table.
  // (The player's league team is always one of the two, so it's kept automatically — no special case.)
  if(typeof ensureExplosionModel==='function'){
   const ea=activeModel(0).id,eb=activeModel(1).id;
   ensureExplosionModel(ea);ensureExplosionModel(eb);
   if(typeof pruneExplosionModels==='function')pruneExplosionModels([ea,eb]);
  }
  S.active=[[],[]];S.pairCd=[0,0];
  rods.forEach(r=>{r.offset=0;r.target=0;r.slideV=0;r.angle=0;r.prevAngle=0;r.prevOffset=0;
   r.kickT=-1;r.raise=false;r.raiseKeep=false;r.padAngleOn=false;r.padAngleTarget=0;r.kickHold=false;r.cd=0;r.exert=0;r.aiMan=-1;r.aiErr=0;r.aiErrT=0;r.aiErrTarget=0;
   // NOTE: r.exert (swing fatigue) is cleared HERE and nowhere else. It must NOT go in
   // resetRodRotation — that runs on every goal / dead ball / out, which would wipe the
   // accumulation several times a match and leave the channel permanently near zero.
   r.aiBX=r.x;r.aiBZ=0;r.aiBVX=0;r.aiBVZ=0;r.aiGoalZ=0;
   r.removedUntil=[];r.men.forEach(m=>{m.visible=true;});
   r.pivot.rotation.z=0;r.pivot.position.z=0;
   const mine=S.userTeam<0?r.team===0:r.team===S.userTeam;
   if(r.rodModel){r.rodModel.rotation.y=mine?0:Math.PI;}   // flip the whole GLB rod so the handle is on the near side
   else{const hs=mine?1:-1,C=rodCollar(r.maxOff);
    r.handle.position.z=hs*(C+CONFIG.rods.handleLen/2);
    r.collar.position.z=-hs*(C+CONFIG.rods.collarLen/2);}});
  // SEATS (js/seats.js). The roster's specs become live seats here; every other entry point
  // (league, training, the AI showdown) gets the single solo seat that holds every device, which
  // is byte-identical to the old S.ctrl/S.ctrlRods singleton.
  S.seats=mode==='roster'?S.roster.map(p=>makeSeat(p.team,p.devs,p.lockRole))
   :S.userTeam<0?[]:[soloSeat(S.userTeam,rodLockRole)];
  seatBindRods();
  // The camera persists between matches, so a shot that was fine last game (a red-only end cam)
  // may not be offerable now that blue has a player too — step off it rather than start there.
  if(typeof camModeOK==='function'&&!camModeOK(S.camMode))cycleCam(1);
 // Rod-switch keys only make sense when somebody can actually switch (a locked seat has one rod).
 $('hint').innerHTML=(S.seats.some(s=>s.rods.length>1)
  ?'◀ ▶ / Q E — switch rod &nbsp;·&nbsp; ▲ ▼ / mouse — slide<br>'
  :'▲ ▼ / mouse — slide<br>')
  +'SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; V — camera';
 // Remember where this match was launched from so quitting returns THERE: a quick match started
 // on Kick Off goes back to Kick Off (rematch is one click), training started on home goes back
 // to home. League/cup have their own return paths (lgReturn/cupReturn re-open the lobby with
 // fresh content), so a bare quit out of one is sent home rather than to a stale lobby.
 S.fromScreen=S.lg?'home':screenId();
 hideScreens();                                                        // every registered screen down (js/screens.js)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');  // overlays aren't registered, so they're torn down by hand
 $('hud').classList.remove('hidden');
 $('sbRN').textContent=teamName(0);$('sbBN').textContent=teamName(1);
  clearFxRail();   // rail must not carry tabs over from the previous match
  updateScoreUI();updateChips();
  // Pre-kickoff shader warm (fracture.js): compile every fx a match can fire — each ball type's
  // material + the shatter/swirl templates — at THIS match's exact light count, before the whistle.
  // Runs here (after table/room/colours are applied, before the countdown) so the first fireball /
  // explosion / swirl never compiles mid-rally. The one-off hitch lands during the intro banner.
  if(typeof warmMatchAssets==='function')warmMatchAssets();
  if(mode==='training'){trainingEnter();return;}   // sandbox: no countdown/serve — training.js owns the phase from here
  // 'GOOD LUCK' was filler under a headline that already states the format — a normal match gets
  // no tag chip at all now; league/cup/spectate get one because it's information you can't infer.
  const sub=S.lg?(S.lg.cup?S.lg.banner:'LEAGUE · ROUND '+(LG.round+1)):(S.userTeam<0?'AI SHOWDOWN':'');
  const _lim=gameTimeLimit();
  banner(_lim>0?(_lim/60)+' MIN · TO '+goalTarget():'FIRST TO '+goalTarget(),sub,1.7,'var(--gold)');
 startCount(MATCH.countIn);
}
function startCount(t){S.phase='count';S.countT=t;S.lastCount=-1;$('count').style.display='block';$('count').textContent='';}
function onGoal(team,b){
 if(b.scored)return;
 if(S.trn){trainingGoal(team,b);return;}   // training: fx + reset to the last placed spot, never ends anything
 b.scored=true;
 const val=b.t.value||1;
 // Classify the goal BEFORE removeBall: b.v is the velocity at the LINE (onGoal is called from
 // inside stepBall, so nothing has touched the ball since it crossed) and the mesh is freed two
 // lines down. M carries the sub chip — what the shot actually was, plus its pace — and the
 // banner accent, which an own goal takes off the scoring team. See js/moments.js.
 const M=momGoal(team,b);
 msGoal(team,b);msRallyEnd();   // matchstats.js: scorer credit + the longest-rally clock. Same constraint as momGoal — both read records that hang off the ball, and removeBall frees it three lines down.
 S.score[team]+=val;
 goalFx(team,b);
 updateScoreUI(team);
 removeBall(b);
 const wins=S.suddenDeath||S.score[team]>=goalTarget();   // golden goal after a level time-up, or the target reached
 if(wins){
  // The one goal most worth watching was the only one that never got a replay — the winner used to
  // cut straight to the win screen. It now runs the SAME celebration + replay as any other goal and
  // the win screen WAITS: S.pendingWin parks the winner, main.js's goal timer hands off to
  // replayStart, and replayEnd (or a skip) routes to endMatch instead of the re-count.
  // replayReady() is checked BEFORE anything is committed, so every case that can't show footage
  // (feature/cfg off, rally too short, another ball still live) falls through to the immediate
  // endMatch below — byte-identical to the old behaviour.
  if(REPLAY.winner&&!S.balls.length&&replayReady()){
   // the winner keeps its own sub — the FORMAT outranks the flavour on this one goal — but an
   // own goal still takes the neutral accent rather than the beneficiary's colour
   banner(teamName(team)+' GOAL',S.suddenDeath?'GOLDEN GOAL':'MATCH WINNER',1.9,M.col);
   resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;
   replayQueue(team);S.pendingWin=team;return;
  }
  endMatch(team);return;
 }
 // accented in the SCORING team's colour — the old fixed blue glow made every goal look the same
 // and clashed with --c1, so a blue goal and a red goal read identically.
 banner(teamName(team)+' GOAL',M.sub,1.9,M.col);
 if(!S.balls.length){resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;
  replayQueue(team);}   // instant replay plays after the celebration (main.js goal-timer handoff; gated by cfg.replay + footage length)
}
/* Open the win screen for a goal that's been held back for its celebration/replay. Returns false
   when nothing is waiting, so callers just fall through to their normal path (main.js's goal timer
   → re-count, replayEnd → re-count). The ONLY writer of S.pendingWin is onGoal above. */
function finishPendingWin(){if(S.pendingWin==null)return false;const w=S.pendingWin;S.pendingWin=null;endMatch(w);return true;}
/* Match clock (timed modes only). Called every frame during 'play' after S.matchTime advances.
   Ticks the final-seconds warning, then at time-up either ends the match (a team ahead) or drops
   into sudden death (level) — play carries straight on, the HUD flips to SUDDEN DEATH, and the
   next goal wins via the guard in onGoal. Fires once: it either ends the match (phase → win) or
   sets S.suddenDeath (which this early-returns on thereafter). Off/unlimited → no-op. */
function checkMatchClock(){
 if(S.trn)return;                         // training: no clock, ever
 const lim=gameTimeLimit();               // seconds; 0 = unlimited
 if(lim<=0||S.suddenDeath)return;
 const rem=lim-S.matchTime;
 if(rem<=MATCH.warnT){const s=Math.ceil(rem);if(s>=1&&s!==S.clockBeep){S.clockBeep=s;Au.beep(1200,.08,'square',.16);}}
 if(rem>0)return;
 if(S.score[0]!==S.score[1]){Au.whistle(2);endMatch(S.score[0]>S.score[1]?0:1);}
 else{S.suddenDeath=true;Au.whistle();banner('SUDDEN DEATH','NEXT GOAL WINS',2.2,'var(--gold)');}
}
function outOfBounds(b){
 if(S.trn){redropBall(b);Au.whistle();return;}   // training: keep the ball live, no goal-hold
 // Grab the x BEFORE removeBall frees the mesh — the restart is keyed to the third the ball left
 // from (S.serveAt → serve()), so belting it off the table out of your own corner isn't a free 60u
 // transfer up the pitch. b.cur is the true sim position (b.m.position carries the render lerp).
 const ox=(b.cur||b.m.position).x;
 msRallyEnd();   // the ball leaving play ends the rally, same as a goal (matchstats.js)
 removeBall(b);Au.whistle();
 // Only the ball that actually ENDS the rally sets the restart spot — in multi-ball the others are
 // still live and their exit says nothing about where play stopped.
 if(!S.balls.length&&S.phase==='play'){S.serveAt=ox;resetRodRotation();notice('OUT OF PLAY',1.1);S.phase='goal';S.goalT=MATCH.outHold;}
}
function endMatch(w){
 S.phase='win';S.pendingWin=null;   // cleared here too: a clock-out/forfeit can land while a goal replay is queued
 Au.goal();Au.whistle(3);
 flash();S.shake=1;
 clearBalls();clearPU();replayAbort();clearFxRail();
  const wasLg=!!S.lg;
  if(wasLg){(S.lg.cup?cupRecord:lgRecord)(w);} // record + sim the rest while the bridge is live
 $('winTitle').textContent=teamName(w)+' WINS!';
 $('winTitle').style.color=teamCol(w);
 $('winScore').textContent=S.score[0]+' — '+S.score[1];
 msRallyEnd();      // a clock-out / forfeit ends the last rally without a goal or an out
 msWinRender();     // matchstats.js owns both stat tabs — see the sheet block at the foot of that file
 // The league/cup REWARDS strip stays here: it's the one part of the win screen that knows about
 // the league bridge, and it sits outside the tabs so it's readable whichever tab is open.
 const lgLine=t=>'<span>'+t+'</span>';
 $('winRewards').innerHTML=!wasLg?'':(S.lg.cup
   ?lgLine(S.lg.banner)+   // banner holds the round PLAYED (cupRecord already advanced LG.cup.round)
    // parts/champ are stamped by cupRecord just above. Winning a cup tie used to pay nothing and
    // SAY nothing until the final, so three rounds out of four ended on a bare round name.
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
 if(S.phase==='play'||S.phase==='count'){S.prePause=S.phase;S.phase='pause';$('pause').classList.remove('hidden');Au.ui();}
 else if(S.phase==='pause'){S.phase=S.prePause;$('pause').classList.add('hidden');mouseLockRequest();Au.ui();}   // the Resume click is the gesture the lock needs
}
function gotoMenu(){
  if(S.trn&&typeof trainingExit==='function')trainingExit();   // restore hidden rods + drop the training gate
  // KIT ONLY. The VENUE (table/skin/room/pitch) used to be restored here too, and that was the
  // load-then-free churn: a league match handed the player's room back on the way to the lobby,
  // which promptly forced the division's again. The league SESSION owns it now — see the venue
  // block at the top of js/league.js. lgVenueExit below is the backstop for the quit-to-home path;
  // it's deferred a tick, so a `gotoMenu(); openLeague()` return cancels it instead of thrashing.
  if(S.lg&&S.lg.prevKit){
   cfg.redColor=S.lg.prevKit.redColor;cfg.blueColor=S.lg.prevKit.blueColor;
   cfg.modelRed=S.lg.prevKit.modelRed;cfg.modelBlue=S.lg.prevKit.modelBlue;
   cfg.special=S.lg.prevKit.special;cfg.power=S.lg.prevKit.power;
   loadPlayerModel(()=>{rebuildRodMen();applyColors();});
  }
  if(typeof lgVenueExit==='function')lgVenueExit();
  S.phase='menu';clearBalls();clearPU();clearFractures();replayAbort();clearFxRail();clearMarks();
  // No match live — free every shatter GLB except the two figurines the menu now shows (kept warm
  // so starting the next match doesn't re-fetch them). Safe: clearFractures() just cleared all live ones.
  if(typeof pruneExplosionModels==='function')pruneExplosionModels([activeModel(0).id,activeModel(1).id]);
 S.lg=null;S.teamStats=null; // drop any league-match bridge (abandoned matches aren't recorded)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');$('hud').classList.add('hidden');  // overlays — not in the screen registry
 showScreen(S.fromScreen||'menu');   // back to the launching screen (see startMatchNow); also re-clamps a saved panel arrangement
 indicators.forEach(m=>{m.visible=false;});dropRing.visible=false;$('count').style.display='none';
}
