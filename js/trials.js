'use strict';
/* ================= skill trials =================
   FEATURE-IDEAS 3.2. A trial is TRAINING MODE WITH A RULEBOOK ON TOP, not a new mode — and that
   is the whole structural decision. training.js already owns everything a trial needs (rod
   show/hide, per-team AI off, ball placement, no match clock, no power-ups, goals that don't end
   anything), and five other files already gate on S.trn. So a trial runs as mode 'training' and
   adds ONE more nullable gate, S.trial, which only this file and a handful of one-line hooks in
   training.js ever test. A missing trials.js cannot break a match — same discipline as S.photo /
   S.trn / S.redit.

   WHAT MAKES A TRIAL A CHALLENGE RATHER THAN A COIN TOSS is js/rng.js, which landed first for
   exactly this reason. The seed is declared per trial, S.seedNext carries it into startMatchNow,
   and a RETRY re-seeds from S.seed — so attempt 12 replays attempt 1's ball, bounce and AI.
   Without that, medal times would be comparing different games.

   THE CLOCK IS SIM TIME (S.time), NEVER WALL CLOCK. S.time only advances inside main.js's fixed
   step, so a dropped frame — or a frame that banks fewer steps than it should — costs the player
   nothing and cannot flatter them either. It starts on the player's FIRST TOUCH rather than on a
   count-in: no extra machinery, and nobody loses a second getting their bearings.

   THE OBJECTIVE READS EVENTS THE GAME ALREADY PRODUCES. Goals arrive through trainingGoal (the
   single hook every training goal passes), and which ROD scored comes off b.mss — matchstats'
   last-SWING record, which is live in training because msOn() has no training gate. Nothing new
   is computed on the sim path; trialTick runs once per FRAME off training.js's own tick, which is
   where FEATURE-IDEAS says to keep new logic (a sim-path check costs ~7x more on a slow frame).
   Deliberately NOT read: moments.js. momOn() folds in a training gate, so woodwork/saves are dark
   in a trial — flipping that on is what a woodwork trial will need, and it is not needed yet.  */
const TRLC=CONFIG.trials;
const TRL={def:null,pending:null,run:false,t0:0,secs:0,done:false,ok:false,goals:0,
 roles:null,statKey:null,statN:0,medal:null,pb:false,tbl:null,hudBuilt:false,sig:'',
 /* the DISCIPLINE tab #trials is showing. Lives here rather than in cfg on purpose — see the
    header above renderTrials. Resolved to a real section on the first render. */
 cat:null};
/* HUD wording for a 'stat' objective. Any ledger counter works without an entry here — it falls
   back to the key uppercased — this is only where that reads badly ('onTarget' -> 'ON TARGET'). */
const TRL_LABEL={woodwork:'WOODWORK',passes:'PASSES',saves:'SAVES',shots:'SHOTS',onTarget:'ON TARGET',kicks:'KICKS'};

function trialOn(){return !!(TRLC&&TRLC.on!==false&&TRLC.list&&TRLC.list.length);}
function trialById(id){if(!TRLC||!TRLC.list)return null;for(const t of TRLC.list)if(t.id===id)return t;return null;}
function trialBest(id){const m=cfg.trials;return (m&&m[id])||null;}
/* Thresholds are ELAPSED SIM SECONDS and lower is better, so one metric serves a stopwatch trial
   and a countdown one alike — a countdown only changes what the HUD displays, not what is scored. */
function trialMedal(d,secs){
 const m=d.medals||{};
 if(m.gold!=null&&secs<=m.gold)return'gold';
 if(m.silver!=null&&secs<=m.silver)return'silver';
 if(m.bronze!=null&&secs<=m.bronze)return'bronze';
 return null;
}

/* ---- the daily challenge (FEATURE-IDEAS 3.3) --------------------------------
   One setup per calendar day, the same for everyone, built from the DATE and nothing else — so
   two players comparing notes are comparing the same problem, with no server involved. It is a
   TRIAL with different provenance, not a second mode: dailyBuild returns an ordinary spec and
   every line of the runner below is unaware it came from here.

   The date stream is seeded from rngHash directly and NOT from the match rng, because it has to
   resolve while sitting on the list screen, long before startMatchNow seeds anything — and it
   must give the same answer whatever the last match's seed happened to be. This is the consumer
   the avalanche in rngHash was kept for (js/rng.js): the input is a run of consecutive date
   strings and the template pick is a raw `hash % n`, with no PRNG in between to launder it. */
function dailyDate(d){
 d=d?(d instanceof Date?d:new Date(d)):new Date();
 return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// Midday on purpose: stepping a date back from midnight lands on the previous day under some DST
// shifts, which would silently break a streak once or twice a year.
function dailyPrev(date){const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-1);return dailyDate(d);}
function dailyOn(){const D=TRLC.daily;return !!(D&&D.on&&D.templates&&D.templates.length);}
/* Today's spec. Pure: same date in, same spec out, on any machine. */
function dailyBuild(date){
 if(!dailyOn())return null;
 date=date||dailyDate();
 const D=TRLC.daily,R=rngMake(rngHash('daily|'+date,0));
 const t=D.templates[(R()*D.templates.length)|0],src=t&&trialById(t.from);
 if(!src)return null;
 const d=Object.assign({},src);          // shallow: goal/rods/medals are read-only in the runner
 d.id='daily';d.daily=true;d.date=date;d.from=src.id;
 // A daily is NOT filed under a discipline: it has its own screen and never appears in the
 // sectioned list. Explicitly cleared because the shallow copy above inherits the source trial's
 // cat, and leaving it would make playing the daily silently move the tab #trials opens on.
 d.cat=null;
 d.name='DAILY · '+src.name;
 d.seed=(rngHash('dailySeed|'+date,0)>>>0)||1;
 d.ball=Object.assign({},src.ball);
 const rb=t.ball||{};
 if(rb.x)d.ball.x=+(rb.x[0]+R()*(rb.x[1]-rb.x[0])).toFixed(2);
 if(rb.z)d.ball.z=+(rb.z[0]+R()*(rb.z[1]-rb.z[0])).toFixed(2);
 return d;
}
/* The streak is only LIVE if the last completion was today or yesterday — otherwise it is a
   number from a run that has already ended, and showing it would be a lie. */
function dailyStreak(date){
 const c=cfg.daily;
 if(!c||!c.date||!c.streak)return 0;
 date=date||dailyDate();
 return (c.date===date||c.date===dailyPrev(date))?c.streak:0;
}
function dailyDone(date){const c=cfg.daily;return !!(c&&c.date===(date||dailyDate()));}
/* Completion. The FIRST finish of a day moves the streak; later attempts can only improve the
   time, which is why the streak is not touched in that branch. */
function dailyRecord(secs,med,date){
 const c=cfg.daily||(cfg.daily={});
 secs=+secs.toFixed(2);
 if(c.date!==date){
  c.streak=(c.date&&dailyPrev(date)===c.date)?(c.streak||0)+1:1;
  c.date=date;c.best=secs;c.medal=med;
 }else if(secs<c.best){c.best=secs;c.medal=med;}
 else return false;
 saveCfg();return true;
}

/* ---- the table pin ---------------------------------------------------------
   The ONLY venue property that changes the sim is the table, because it picks the collision model
   (CONFIG.tables[].collision — 'bowl' is a different physics path entirely, and 'circuit' adds
   solid end walls). Skin/room/pitch are cosmetic and are left as the player chose them.
   Stashed ONCE and given back on the way out of trials land, the same shape league.js uses for a
   division venue, and for the same reason: without the parking below, opening a trial silently
   becomes the player's Kick Off table the next time anything calls saveCfg. saveCfg (config.js)
   consults trialVenueHeld() and writes the PARKED table rather than the live one. */
function trialVenueHeld(){return TRL.tbl?{table:TRL.tbl,room:cfg.room,pitch:cfg.pitch,skins:cfg.skins}:null;}
function trialTableApply(id,cb){
 if(!TRLC.pinTable||!id||!CONFIG.tables[id]||cfg.table===id){if(cb)cb();return;}
 if(!TRL.tbl)TRL.tbl=cfg.table;                 // ONCE — three trials in a row still restore the original
 cfg.table=id;
 if(typeof applyTable==='function')applyTable(cb);else if(cb)cb();
}
/* Fires from SCREENS.trials.onHide, i.e. when you leave the trials AREA — not when you start a
   trial (startMatchNow uses hideScreens, which does not fire onHide) and not when you quit back
   to the list (showScreen only fires onHide when the screen actually CHANGES). So the table stays
   put across retries and only comes off when you walk away. */
function trialTableRestore(){
 if(!TRL.tbl)return;
 const t=TRL.tbl;TRL.tbl=null;cfg.table=t;
 if(typeof applyTable==='function')applyTable();
}

/* ---- lifecycle ---- */
function trialStart(id){
 // 'daily' is BUILT rather than looked up — it isn't in CONFIG.trials.list, it is derived from
 // today's date (dailyBuild). Everything downstream takes an ordinary spec and can't tell.
 const d=(id==='daily')?dailyBuild():trialById(id);
 if(!d||S.trial)return;
 // Quitting a run returns to #trials (S.fromScreen), and it should return to the SECTION the run
 // was launched from. The daily has no cat — it is not in the sectioned list at all — so it
 // leaves whatever tab was open alone.
 if(d.cat)TRL.cat=d.cat;
 Au.init();Au.ui();
 trialTableApply(d.table,()=>{
  TRL.pending=d;
  S.seedNext=(d.seed>>>0);   // js/rng.js — consumed by startMatchNow, so it cannot leak onward
  S.teamStats=null;          // a league squad build scales the PLAYER's hit too; a trial is base stats
  startMatch('training',(d.hold||null));
 });
}
/* Called at the END of trainingEnter — the sandbox has finished setting itself up (ball at the
   default spawn, panel shown, phase play) and a queued trial now takes it over. Returns true when
   it DID take over, so training.js can skip its own sandbox toast with a one-line typeof guard and
   never has to reference TRL (which would throw if this file were absent). */
function trialArm(){
 if(!TRL.pending)return false;
 const d=TRL.pending;TRL.pending=null;
 TRL.def=d;S.trial=TRL;
 // trnSetRodShown writes TRN.hidden[], which is the SANDBOX's persisted hide list and is what
 // trainingEnter re-applies next time. Without stashing it, the rods a trial hid would still be
 // missing the next time the player opened the sandbox — and nothing on that screen would explain
 // why. Put back by trialExit.
 TRL.hidWas=TRN.hidden.slice();
 buildTrialHud();
 const p=$('trnPanel');if(p)p.classList.add('hidden');   // sandbox tools are not trial tools
 $('hint').innerHTML='R — retry &nbsp;·&nbsp; ESC — pause / quit<br>'
  +'SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; Q E — switch rod';
 trialReset();
 return true;
}
/* Apply the setup. This is also RETRY, and it must be byte-identical both times or a personal
   best means nothing — hence re-seeding from S.seed (the seed this match was started on) rather
   than from anything that has moved since. */
function trialReset(){
 const d=TRL.def;if(!d)return;
 if(typeof rngSeed==='function')rngSeed(S.seed);
 TRL.run=false;TRL.t0=0;TRL.secs=0;TRL.done=false;TRL.ok=false;TRL.goals=0;
 TRL.medal=null;TRL.pb=false;TRL.sig='';
 TRL.roles=(d.goal.kind==='roleGoals')?d.goal.roles.slice():null;
 // A 'stat' objective is scored off the match ledger (S.stats.<key>[0]) rather than off goals —
 // one evaluator covering woodwork, saves, passes, shots and onTarget. Polled in trialTick.
 TRL.statKey=(d.goal.kind==='stat')?d.goal.stat:null;
 TRL.statN=0;
 // sandbox state a trial must not inherit from a previous sandbox session. `ai` comes from the
 // spec: an opponent rod with its AI OFF is a static obstacle, with it ON it is a real keeper —
 // and CONFIG.trials pins the difficulty too (teamDiff, js/league.js) so the level is the trial's,
 // never whatever the player last chose in Kick Off.
 TRN.freeze=false;TRN.stepQ=0;TRN.score=false;TRN.deadball=false;
 TRN.ai=(d.ai&&d.ai.slice())||[false,false];
 TRN.ballType=d.ball.type||'classic';
 trnSetPlacing(false);
 // rods: only what the trial declares stays on the table. Keys are '<team>|<role>'.
 const show=d.rods&&d.rods.show;
 rods.forEach((r,i)=>trnSetRodShown(i,!show||show.indexOf(r.team+'|'+r.role)>=0));
 // A hidden rod is STILL in the seat's switch list — seatBindRods builds that list by TEAM and
 // knows nothing about trnHidden — so a trial that hides some of your own rods without locking
 // you to one would let Q/E hand you an invisible handle. Filter the list to what's on the table.
 // Falls back to leaving it alone if that would empty it, so this can never strand a seat.
 S.seats.forEach(s=>{
  const vis=s.rods.filter(r=>!r.trnHidden);
  if(vis.length&&vis.length<s.rods.length){s.rods=vis;if(s.ctrl>=vis.length)s.ctrl=0;}
 });
 if(typeof updateChips==='function')updateChips();
 clearBalls();
 const b=trnSpawnBall(TRN.ballType,d.ball.x,d.ball.z);
 b.v.set(d.ball.vx||0,d.ball.vy||0,d.ball.vz||0);
 syncBall(b);
 // The ledger backs the objective, so a retry starts it clean. Safe against the per-rod stat
 // bucket cache: matchstats keys r.msB on the IDENTITY of S.stats, which is why that check exists.
 S.stats=freshStats();
 S.score=[0,0];S.lastTouch=-1;S.phase='play';
 if(typeof updateScoreUI==='function')updateScoreUI();
 trialHudSync();
}
function trialRestart(){if(TRL.def){trialReset();Au.ui();}}
/* From trainingExit (gotoMenu). The table is NOT restored here — that is the screen's job, so a
   retry and a quit-to-list both keep the trial's table on. */
function trialExit(){
 S.trial=null;TRL.def=null;TRL.pending=null;
 TRL.run=false;TRL.done=false;TRN.freeze=false;TRN.stepQ=0;
 if(TRL.hidWas){TRN.hidden=TRL.hidWas;TRL.hidWas=null;}   // give the sandbox its own hide list back
 const h=$('trlHud');if(h)h.classList.add('hidden');
}

/* ---- scoring ----
   Called from trainingGoal BEFORE removeBall, because the records hang off the ball. `team` is the
   SCORING team; the player is always team 0 in training mode, so a goal at the other end is one
   the player conceded and never counts toward an objective. */
function trialGoal(team,b){
 if(!TRL.def||TRL.done||team!==0)return;
 const d=TRL.def;
 TRL.goals++;
 // A 'stat' trial is scored by its counter, never by goals — scoring is often just how you get
 // ANOTHER attempt at the thing being counted (a woodwork trial hands the ball back after a goal).
 if(TRL.statKey){/* trialTick owns completion for this kind */}
 else if(TRL.roles){
  // b.mss is matchstats' last SWING — the rod that STRUCK it, not the last thing it touched, so a
  // goal that deflected in off a post is still credited to the boot that hit it.
  const rec=b.mss,i=(rec&&rec.role)?TRL.roles.indexOf(rec.role):-1;
  if(i>=0)TRL.roles.splice(i,1);
  if(!TRL.roles.length)trialFinish(true);
 }else if(TRL.goals>=(d.goal.n||1))trialFinish(true);
 trialHudSync();
}
function trialFinish(ok){
 if(TRL.done)return;
 TRL.done=true;TRL.ok=!!ok;
 // Recompute here rather than trusting trialTick's value: a goal resolves INSIDE the sim step,
 // and trialTick runs once per FRAME, so the banked figure is up to a frame stale — and at 7
 // banked steps that is most of a tenth of a second on the number the medal is read from.
 // Still clamped to the limit, or the timed-out path would report a hair over its own deadline.
 if(TRL.run){const lim=TRL.def.limit||0;TRL.secs=S.time-TRL.t0;if(lim>0&&TRL.secs>lim)TRL.secs=lim;}
 else TRL.secs=0;
 TRN.freeze=true;   // hold the world on the result — training's own freeze lever, reused
 if(ok){
  const d=TRL.def;
  /* AN UNTIMED RUN SETS NO RECORD. If the clock never started the player completed this without
     ever swinging — a rod raise or a slide can nudge a ball, and none of that increments kicks —
     so TRL.secs is 0 and banking it would write a 0.00s gold that nothing could ever beat.
     Unreachable in the shipped trials (you cannot walk a ball up the table without kicking it),
     but a records feature should not have a zero-time hole in it at all. */
  TRL.medal=TRL.run?trialMedal(d,TRL.secs):null;
  if(TRL.run){
   /* A DAILY KEEPS ITS RECORD IN cfg.daily, NOT in the per-trial cfg.trials map. Its id is
      'daily' every single day, so storing it there would leave one "best" being overwritten by
      whichever day happened to be easiest — and there would be nowhere to hang the streak. */
   if(d.daily)TRL.pb=dailyRecord(TRL.secs,TRL.medal,d.date);
   else{
    const prev=trialBest(d.id);
    if(!prev||TRL.secs<prev.best){
     const m=cfg.trials||(cfg.trials={});
     m[d.id]={best:+TRL.secs.toFixed(2),medal:TRL.medal};
     saveCfg();TRL.pb=true;
    }
   }
  }
  Au.goal();if(typeof confetti==='function')confetti();
 }else{TRL.medal=null;Au.whistle();}
 TRL.sig='';   // force the card to render
 trialHudSync();
}
/* Once per FRAME, from trainingTick. */
function trialTick(){
 if(!TRL.def)return;
 if(!TRL.done){
  /* THE CLOCK STARTS ON YOUR FIRST SWING, AND IT MUST NOT BE S.lastTouch.
     lastTouch is set by ANY contact, including a passive one — and a trial that spawns the ball
     at the feet spawns it INSIDE the resting foot's contact radius, so collideRod fires on sim
     step ONE and the clock started before the player had done anything. That is the bug this
     line was: SNAP SHOT's timer ran from the moment the trial loaded, so the time you were
     scored on was however long you spent getting your bearings and no medal was reachable.
     S.stats.kicks[] is incremented by msKick from kickRod, i.e. once per SWING, and is gated on
     S.stats alone rather than on msOn() — so it is live in training and cannot be tripped by the
     ball merely resting against a boot. trialReset's freshStats() zeroes it per attempt. */
  if(!TRL.run&&S.stats&&S.stats.kicks[0]>0){TRL.run=true;TRL.t0=S.time;}
  /* A 'stat' objective is POLLED here rather than hooked at each detector: the counters already
     exist in S.stats, matchstats and moments already maintain them, and polling once per frame
     costs nothing and adds no sim-path work (the FEATURE-IDEAS watch-out). freshStats() in
     trialReset is what zeroes them per attempt. */
  if(TRL.statKey&&S.stats){
   const arr=S.stats[TRL.statKey];
   TRL.statN=(arr&&arr.length)?arr[0]:0;
   if(TRL.statN>=(TRL.def.goal.n||1))trialFinish(true);
  }
  if(TRL.run&&!TRL.done){
   TRL.secs=S.time-TRL.t0;
   const lim=TRL.def.limit||0;
   if(lim>0&&TRL.secs>=lim){TRL.secs=lim;trialFinish(false);}
  }
 }
 trialHudSync();
}

/* ---- in-match HUD (built via createElement like the debug/training panels) ---- */
function buildTrialHud(){
 if(!TRL.hudBuilt){
  TRL.hudBuilt=true;
  const d=document.createElement('div');d.id='trlHud';
  d.innerHTML='<div class="trlName" id="trlName"></div>'
   +'<div class="trlObj" id="trlObj"></div>'
   +'<div class="trlClock" id="trlClock">0.00</div>'
   +'<div class="trlCard hidden" id="trlCard">'
    +'<div class="trlRes" id="trlRes"></div>'
    +'<div class="trlSecs" id="trlSecs"></div>'
    +'<div class="trlMed" id="trlMed"></div>'
    +'<div class="trlKeys">R — retry &nbsp;·&nbsp; ESC — quit</div>'
   +'</div>';
  document.body.appendChild(d);
 }
 const h=$('trlHud');if(h)h.classList.remove('hidden');
}
/* The clock moves every frame so it is written unconditionally; everything else is signature-gated,
   because rebuilding the objective line and the result card 60 times a second is the kind of DOM
   churn that turns up on the M panel as GPU/BROWSER and looks like a render problem. */
function trialHudSync(){
 if(!TRL.hudBuilt||!TRL.def)return;
 const d=TRL.def,lim=d.limit||0,shown=lim>0?Math.max(0,lim-TRL.secs):TRL.secs;
 const cl=$('trlClock');
 if(cl){cl.textContent=shown.toFixed(2);cl.classList.toggle('warn',lim>0&&shown<=5);}
 const prog=TRL.roles
  ? d.goal.roles.map(r=>TRL.roles.indexOf(r)<0?'<b>'+r+'</b>':r).join(' &middot; ')
  : ((TRL.statKey?TRL.statN:TRL.goals)+' / '+(d.goal.n||1));
 const sig=prog+'|'+TRL.done+'|'+TRL.ok+'|'+TRL.medal+'|'+TRL.pb;
 if(sig===TRL.sig)return;
 TRL.sig=sig;
 $('trlName').textContent=d.name;
 $('trlObj').innerHTML=(TRL.roles?'SCORE WITH ':TRL.statKey?(TRL_LABEL[TRL.statKey]||TRL.statKey.toUpperCase())+' ':'GOALS ')+prog;
 const card=$('trlCard');
 card.classList.toggle('hidden',!TRL.done);
 if(!TRL.done)return;
 const res=$('trlRes');
 res.textContent=TRL.ok?'COMPLETE':'OUT OF TIME';
 res.className='trlRes '+(TRL.ok?'ok':'no');
 $('trlSecs').textContent=TRL.ok?(TRL.secs.toFixed(2)+'s'+(TRL.pb?'  ·  NEW BEST':'')):'';
 const md=$('trlMed');
 md.textContent=TRL.medal?TRL.medal.toUpperCase():'';
 md.className='trlMed '+(TRL.medal||'');
}

/* ---- the list on #trials ----
   THE CATALOGUE IS BROWSED BY DISCIPLINE (CONFIG.trials.cats): a tab strip above the panel, one
   section on screen at a time. A single flat column was fine at six trials and stops being fine
   well before twenty — the question a player actually arrives with is "what can I practise with
   my keeper", and an undifferentiated list answers that by making them read all of it.

   A SECTION IS A FILTER, NOT A SECOND LIST. Nothing here owns trial data: trialsIn() walks the
   one flat CONFIG.trials.list and keeps what matches, so re-filing a trial under another tab
   changes where it is listed and nothing else — same id, same seed, same stored best, and the
   daily's templates (which name trials by id) never notice.

   TRL.cat SURVIVES THE RUN and is set by trialStart, which is what makes quitting a trial land
   you back on the tab you launched it from instead of on GK every single time. Deliberately NOT
   persisted to cfg: it is where you were a moment ago, not a preference worth a save slot. */
function trialCats(){return (TRLC&&TRLC.cats)||[];}
function trialsIn(cat){const out=[];if(TRLC&&TRLC.list)for(const d of TRLC.list)if(d.cat===cat)out.push(d);return out;}
/* Cleared / total plus the medal breakdown — the tab counter and the section header read the
   same numbers off this, so a tab can never disagree with the section it opens. */
function trialCatStat(cat){
 const st={n:0,done:0,gold:0,silver:0,bronze:0};
 for(const d of trialsIn(cat)){
  st.n++;
  const b=trialBest(d.id);
  if(!b)continue;
  st.done++;
  if(b.medal&&st[b.medal]!=null)st[b.medal]++;
 }
 return st;
}
/* The tab that opens when there is no live choice: the first section that HAS something in it,
   so a discipline nobody has written trials for yet can never be the first thing a player meets
   on the screen. */
function trialCatDefault(){
 const cs=trialCats();
 for(const c of cs)if(trialsIn(c.id).length)return c.id;
 return cs.length?cs[0].id:null;
}
function trialCatSet(id){if(id===TRL.cat)return;TRL.cat=id;Au.ui();renderTrials();}
/* One row. Pulled out of renderTrials so the flat fallback below and the sectioned list render
   byte-identical rows rather than two copies of the same markup drifting apart. */
function trialRowHtml(d){
 const b=trialBest(d.id);
 return '<div class="trlRow'+(b?' done':'')+'" data-trial="'+d.id+'">'
  +'<div class="trlRowTop"><span class="trlRowName">'+d.name+'</span>'
  +(b&&b.medal?'<span class="trlPill '+b.medal+'">'+b.medal.toUpperCase()+'</span>'
    :b?'<span class="trlPill">DONE</span>':'')
  +'</div><div class="trlRowSub">'+d.blurb+'</div>'
  +'<div class="trlRowMeta">'+trialObjText(d)
  +'<i>'+(d.limit?d.limit+'s &middot; ':'')+(b?'best '+b.best.toFixed(2)+'s':'not attempted')
  +'</i></div></div>';
}
function trialBindRows(box){box.querySelectorAll('[data-trial]').forEach(el=>{el.onclick=()=>trialStart(el.dataset.trial);});}
function renderTrials(){
 const box=$('trialsPanel');
 if(!box||!trialOn())return;   // no list = leave the screen's own empty state in the markup
 const cats=trialCats();
 /* NO cats DECLARED FALLS BACK TO THE OLD FLAT LIST rather than to a blank panel. The tab strip
    is presentation; the trials are the feature, and a CONFIG that has been stripped down or is
    mid-edit should still be playable. Same instinct as the rest of this file's typeof guards. */
 if(!cats.length){
  const tabs=$('trlTabs');if(tabs)tabs.innerHTML='';
  box.innerHTML='<h3>Trials</h3><div class="trlList">'+TRLC.list.map(trialRowHtml).join('')+'</div>';
  trialBindRows(box);
  return;
 }
 if(!TRL.cat||!cats.some(c=>c.id===TRL.cat))TRL.cat=trialCatDefault();
 let cat=null;for(const c of cats)if(c.id===TRL.cat)cat=c;
 if(!cat)cat=cats[0];
 /* ---- the tab strip ----
    Rebuilt whole on every show, because every counter on it can have moved since the last one —
    this screen is re-rendered exactly twice per visit (arriving, and returning from a run), so
    there is nothing here worth a diff. The COUNTER is cleared/total rather than a medal count:
    "2 / 4" is the number a player checks a tab for, and a gold tally that reads 0 next to it
    would be reporting a failure they have not had yet. */
 const tabs=$('trlTabs');
 if(tabs){
  let t='';
  for(const c of cats){
   const st=trialCatStat(c.id);
   t+='<div class="trlTab'+(c.id===cat.id?' on':'')+(st.n&&st.done>=st.n?' full':'')+(st.n?'':' void')
    +'" data-cat="'+c.id+'" title="'+c.name+'">'
    +'<div class="trlTabName">'+c.id+'</div>'
    +'<div class="trlTabCt">'+(st.n?st.done+' / '+st.n:'&mdash;')+'</div></div>';
  }
  tabs.innerHTML=t;
  tabs.querySelectorAll('[data-cat]').forEach(el=>{el.onclick=()=>trialCatSet(el.dataset.cat);});
 }
 /* ---- the section ---- */
 const list=trialsIn(cat.id),st=trialCatStat(cat.id);
 let h='<div class="trlSecHead"><h3>'+cat.name+'</h3>'
  +'<span class="trlTally">'+(st.done?st.done+' / '+st.n+' cleared':st.n?st.n+' trial'+(st.n===1?'':'s'):'')+'</span></div>'
  +'<div class="trlSecSub">'+(cat.sub||'')+'</div>';
 if(!list.length){
  /* An empty section says WHAT is missing rather than that something is broken — a player who
     opens GK before those trials exist should read it as "not written yet", not as a bug. */
  h+='<div class="trnEmpty">NOTHING HERE YET<span>No '+cat.name.toLowerCase()
   +' trials have been written. Every trial runs on a fixed seed, so each attempt replays the '
   +'same ball, the same opponent and the same bounce &mdash; these are on their way.</span></div>';
 }else{
  // The medal strip only appears once there IS a medal to report: three zeroes on a section you
  // have never played is a scoreboard telling you off before you have started.
  if(st.gold||st.silver||st.bronze)
   h+='<div class="trlMedRow">'
    +'<span class="trlMedCt gold">'+st.gold+'<em>gold</em></span>'
    +'<span class="trlMedCt silver">'+st.silver+'<em>silver</em></span>'
    +'<span class="trlMedCt bronze">'+st.bronze+'<em>bronze</em></span></div>';
  h+='<div class="trlList">'+list.map(trialRowHtml).join('')+'</div>';
 }
 box.innerHTML=h;
 trialBindRows(box);
}
/* ---- the daily's own screen ---- */
// One human-readable line for any objective kind. Shared by the daily panel and the trials list
// so the two can never describe the same trial differently.
function trialObjText(d){
 const g=d.goal||{};
 if(g.kind==='roleGoals')return 'Score with '+(g.roles||[]).join(' &middot; ');
 if(g.kind==='stat')return (g.n||1)+' &times; '+(TRL_LABEL[g.stat]||String(g.stat).toUpperCase());
 return 'Score '+(g.n||1);
}
/* Rebuilt on every show, because what it says depends on the date AND on whether today has been
   cleared — and quitting a run returns here (S.fromScreen), which is exactly when the tick has
   just changed. */
function renderDaily(){
 const box=$('dailyPanel');if(!box)return;
 const d=dailyBuild();
 if(!d){
  box.innerHTML='<h3>Daily</h3><div class="trnEmpty">NOT AVAILABLE'
   +'<span>The daily challenge is switched off in CONFIG.trials.daily.</span></div>';
  return;
 }
 const c=cfg.daily||{},done=dailyDone(d.date),st=dailyStreak(d.date);
 box.innerHTML=
  '<h3>'+d.date+'</h3>'
  +'<div class="dlyHead'+(done?' done':'')+'">'
   +'<div class="dlyTick">'+(done?'&#10003;':'&#9679;')+'</div>'
   // the SOURCE trial's name, off d.from — cleaner than unpicking the 'DAILY · ' prefix back off
   +'<div class="dlyHeadT"><b>'+((trialById(d.from)||d).name)+'</b>'
   +'<span>'+d.blurb+'</span></div>'
  +'</div>'
  +'<div class="dlyRow"><label>Objective</label><b>'+trialObjText(d)+'</b></div>'
  +'<div class="dlyRow"><label>Time limit</label><b>'+(d.limit?d.limit+'s':'none')+'</b></div>'
  +'<div class="dlyRow"><label>Today</label><b class="'+(done?'ok':'')+'">'
   +(done?('COMPLETE &middot; '+(c.best!=null?c.best.toFixed(2)+'s':'')
     +(c.medal?' &middot; '+c.medal.toUpperCase():'')):'not played yet')+'</b></div>'
  +'<div class="dlyRow"><label>Streak</label><b>'+(st?st+' day'+(st>1?'s':''):'&mdash;')+'</b></div>'
  +'<button class="btn dlyPlay" id="dailyPlay">'+(done?'PLAY AGAIN':'PLAY')+'</button>'
  +'<div class="dlyNote">Everyone gets the same setup today. Your best is kept on this device.</div>';
 const b=$('dailyPlay');if(b)b.onclick=()=>trialStart('daily');
}
if(typeof SCREENS!=='undefined'&&SCREENS.trials){
 SCREENS.trials.onShow=renderTrials;
 SCREENS.trials.onHide=trialTableRestore;
}
if(typeof SCREENS!=='undefined'&&SCREENS.daily){
 SCREENS.daily.onShow=renderDaily;
 // The daily can be started from HERE as well as from the list, so this screen has to give the
 // player's table back too — trialTableRestore is idempotent, so both hooks are safe.
 SCREENS.daily.onHide=trialTableRestore;
}
/* Home card + back button. The CARD is what CONFIG.trials.daily.on hides; the route stays
   registered either way (see js/screens.js). */
(function(){
 const card=$('btnDaily');
 if(card){
  if(!dailyOn())card.classList.add('hidden');
  else card.onclick=()=>{Au.init();Au.ui();showScreen('daily');};
 }
 const back=$('dailyBack');
 if(back)back.onclick=()=>{showScreen('home');Au.ui();};
})();
/* R retries. Owned here rather than in input.js so a missing trials.js cannot change what any key
   does; guarded on S.trial, and on S.photo because photo mode binds R for its own recorder. */
addEventListener('keydown',e=>{
 if(S.photo)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(S.trial){if(e.code==='KeyR'){e.preventDefault();trialRestart();}return;}
 /* Left/Right walk the discipline tabs, and ONLY while #trials is the live screen. Safe against
    input.js, which binds the same two keys to seatStep but gates them on S.phase 'play'/'count' —
    a menu screen is 'menu', so nothing else is listening for them here. */
 if(typeof screenId!=='function'||screenId()!=='trials')return;
 const dir=e.code==='ArrowLeft'?-1:e.code==='ArrowRight'?1:0;
 if(!dir)return;
 const cs=trialCats();
 if(cs.length<2)return;
 let i=-1;for(let k=0;k<cs.length;k++)if(cs[k].id===TRL.cat)i=k;
 if(i<0)i=0;
 e.preventDefault();
 trialCatSet(cs[(i+dir+cs.length)%cs.length].id);
});
