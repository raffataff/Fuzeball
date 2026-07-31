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
 matchLoading=true;let sync=false;
 const go=()=>{sync=true;matchLoading=false;showMatchLoading(false);
  if(rods.length){rebuildRodMen();applyColors();}  // refresh the men to the now-resident figurines + kit colours (mirrors league start())
  startMatchNow(mode,rodLockRole);};
 ensureMatchAssets(go);
 if(!sync)showMatchLoading(true);            // assets weren't ready synchronously → show the loader until go() fires
}
function showMatchLoading(on){
 let el=$('matchLoad');
 if(!el){if(!on)return;el=document.createElement('div');el.id='matchLoad';
  el.innerHTML='<div class="mlBox"><div class="mlSpin"></div><span>LOADING</span></div>';document.body.appendChild(el);}
 el.classList.toggle('show',!!on);
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
 S.score=[0,0];S.stats=freshStats();S.matchTime=0;S.time=0;S.timeScale=1;S.suddenDeath=false;S.clockBeep=0;
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 S.lastTouch=-1;S.lastSwitch=0;S.shake=0;
  clearBalls();clearPU();clearFractures();replayAbort();replayCut();
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
   r.kickT=-1;r.raise=false;r.cd=0;r.aiMan=-1;r.aiErr=0;r.aiErrT=0;r.aiErrTarget=0;
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
 setBallTag('classic');clearFxRail();   // rail must not carry tabs over from the previous match
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
 S.score[team]+=val;
 goalFx(team,b);
 updateScoreUI(team);
 removeBall(b);
 if(S.suddenDeath){endMatch(team);return;}          // golden goal: first strike after a level time-up wins
 if(S.score[team]>=goalTarget()){endMatch(team);return;}
 // accented in the SCORING team's colour — the old fixed blue glow made every goal look the same
 // and clashed with --c1, so a blue goal and a red goal read identically.
 banner(teamName(team)+' GOAL',
  val>1?'GOLDEN BALL · ×2':HYPE[Math.floor(Math.random()*HYPE.length)],1.9,teamCol(team));
 if(!S.balls.length){resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;
  replayQueue(team);}   // instant replay plays after the celebration (main.js goal-timer handoff; gated by cfg.replay + footage length)
}
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
 removeBall(b);Au.whistle();
 if(!S.balls.length&&S.phase==='play'){resetRodRotation();notice('OUT OF PLAY',1.1);S.phase='goal';S.goalT=MATCH.outHold;}
}
function endMatch(w){
 S.phase='win';
 Au.goal();Au.whistle(3);
 flash();S.shake=1;
 clearBalls();clearPU();replayAbort();clearFxRail();
  const wasLg=!!S.lg;
  if(wasLg){(S.lg.cup?cupRecord:lgRecord)(w);} // record + sim the rest while the bridge is live
 $('winTitle').textContent=teamName(w)+' WINS!';
 $('winTitle').style.color=teamCol(w);
 $('winScore').textContent=S.score[0]+' — '+S.score[1];
 const st=S.stats,tp=(st.poss[0]+st.poss[1])||1;
 $('winStats').innerHTML=
  '<span class="l">'+Math.round(st.poss[0]/tp*100)+'%</span><span class="m">Possession</span><span class="r">'+Math.round(st.poss[1]/tp*100)+'%</span>'+
  '<span class="l">'+st.kicks[0]+'</span><span class="m">Kicks</span><span class="r">'+st.kicks[1]+'</span>'+
  '<span class="m" style="grid-column:1/4;text-align:center">Top ball speed: '+Math.round(st.topSpeed*.35)+' km/h</span>'+
    (wasLg?(S.lg.cup
      ?'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">'+S.lg.banner+'</span>' // banner holds the round PLAYED (cupRecord already advanced LG.cup.round)
      :'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">+'+(w===0?CONFIG.league.upWin:CONFIG.league.upLoss)+' upgrade parts</span>'+
       (w===0&&S.score[1]===0?'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">Clean sheet · +'+CONFIG.league.upCleanSheet+' upgrade parts</span>':'')):'');
 $('btnWinContinue').classList.toggle('hidden',!wasLg); // league: Continue → lobby
 $('btnRematch').classList.toggle('hidden',wasLg);      // league: no rematches
 $('win').classList.remove('hidden');
 confetti(w);
}
function togglePause(){
 if(S.phase==='play'||S.phase==='count'){S.prePause=S.phase;S.phase='pause';$('pause').classList.remove('hidden');Au.ui();}
 else if(S.phase==='pause'){S.phase=S.prePause;$('pause').classList.add('hidden');Au.ui();}
}
function gotoMenu(){
  if(S.trn&&typeof trainingExit==='function')trainingExit();   // restore hidden rods + drop the training gate
  if(S.lg&&S.lg.prevKit){
   cfg.redColor=S.lg.prevKit.redColor;cfg.blueColor=S.lg.prevKit.blueColor;
   cfg.modelRed=S.lg.prevKit.modelRed;cfg.modelBlue=S.lg.prevKit.modelBlue;
   cfg.special=S.lg.prevKit.special;cfg.power=S.lg.prevKit.power;
   cfg.table=S.lg.prevKit.table;cfg.room=S.lg.prevKit.room;cfg.pitch=S.lg.prevKit.pitch;
   applyTable();applyRoom();
   loadPlayerModel(()=>{rebuildRodMen();applyColors();});
  }
  S.phase='menu';clearBalls();clearPU();clearFractures();replayAbort();clearFxRail();
  // No match live — free every shatter GLB except the two figurines the menu now shows (kept warm
  // so starting the next match doesn't re-fetch them). Safe: clearFractures() just cleared all live ones.
  if(typeof pruneExplosionModels==='function')pruneExplosionModels([activeModel(0).id,activeModel(1).id]);
 S.lg=null;S.teamStats=null; // drop any league-match bridge (abandoned matches aren't recorded)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');$('hud').classList.add('hidden');  // overlays — not in the screen registry
 showScreen(S.fromScreen||'menu');   // back to the launching screen (see startMatchNow); also re-clamps a saved panel arrangement
 indicators.forEach(m=>{m.visible=false;});dropRing.visible=false;$('count').style.display='none';
}
