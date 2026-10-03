'use strict';
// ================= skill trials =================
// training mode (S.trial gate) with a rulebook; retry re-seeds from S.seed; the clock is sim time
// scored on elapsed seconds (lower wins) or, for saveRun, saves (higher wins); momOn() has an S.trial clause objectives need
const TRLC=CONFIG.trials;
const TRL={def:null,pending:null,run:false,t0:0,secs:0,done:false,ok:false,goals:0,
 roles:null,statKey:null,statN:0,medal:null,pb:false,tbl:null,hudBuilt:false,sig:'',
 // --- 'saveRun' state (the GK kind) ---
 // att/saves count attempts and saves, svSeen is the ledger delta banked, res = attempt settled
 // serving = table empty between attempts (training.js reads it), attT0 = serve time
 saveRun:null,att:0,saves:0,svSeen:0,res:false,attT0:0,serveAt:0,serving:false,spawn:null,
 // wall-clock ms when the result panel may appear (set by trialFinish, CONFIG.trials.resultDelay); 0 = now
 showAt:0,
 // the discipline tab #trials shows; kept here rather than in cfg, resolved on the first render
 cat:null};
// HUD wording for a 'stat' objective; any ledger counter works, this is only for keys that read badly
const TRL_LABEL={woodwork:'WOODWORK',passes:'PASSES',saves:'SAVES',shots:'SHOTS',onTarget:'ON TARGET',kicks:'KICKS'};

function trialOn(){return !!(TRLC&&TRLC.on!==false&&TRLC.list&&TRLC.list.length);}
function trialById(id){if(!TRLC||!TRLC.list)return null;for(const t of TRLC.list)if(t.id===id)return t;return null;}
function trialBest(id){const m=cfg.trials;return (m&&m[id])||null;}
// --- the score and its direction ---
// saveRun is saves (higher wins), everything else elapsed sim seconds (lower wins); the direction comes from the kind
function trialDir(d){return (d&&d.goal&&d.goal.kind==='saveRun')?1:-1;}
function trialMedal(d,v){
 const m=d.medals||{},up=trialDir(d)>0;
 if(m.gold!=null&&(up?v>=m.gold:v<=m.gold))return'gold';
 if(m.silver!=null&&(up?v>=m.silver:v<=m.silver))return'silver';
 if(m.bronze!=null&&(up?v>=m.bronze:v<=m.bronze))return'bronze';
 return null;
}
function trialBetter(d,v,prev){return trialDir(d)>0?v>prev:v<prev;}
// cfg.trials[id].best is seconds for a stopwatch trial and saves for a saveRun, so never rename or re-kind a trial id
function trialScoreText(d,v){
 return (trialDir(d)>0)?(v+' / '+((d.goal&&d.goal.n)||1)+' saved'):(v.toFixed(2)+'s');
}

// --- the daily challenge ---
// one setup per calendar day built from the date alone, seeded from rngHash (not the match rng)
function dailyDate(d){
 d=d?(d instanceof Date?d:new Date(d)):new Date();
 return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// midday on purpose: stepping back from midnight lands on the previous day under some DST shifts
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
 // a daily has no discipline; clear cat so playing it doesn't move the tab #trials opens on
 d.cat=null;
 d.name='DAILY · '+src.name;
 d.seed=(rngHash('dailySeed|'+date,0)>>>0)||1;
 d.ball=Object.assign({},src.ball);
 const rb=t.ball||{};
 if(rb.x)d.ball.x=+(rb.x[0]+R()*(rb.x[1]-rb.x[0])).toFixed(2);
 if(rb.z)d.ball.z=+(rb.z[0]+R()*(rb.z[1]-rb.z[0])).toFixed(2);
 return d;
}
// the streak is live only if the last completion was today or yesterday
function dailyStreak(date){
 const c=cfg.daily;
 if(!c||!c.date||!c.streak)return 0;
 date=date||dailyDate();
 return (c.date===date||c.date===dailyPrev(date))?c.streak:0;
}
function dailyDone(date){const c=cfg.daily;return !!(c&&c.date===(date||dailyDate()));}
// completion: the first finish of a day moves the streak, later attempts only improve the time
function dailyRecord(secs,med,date,up){
 const c=cfg.daily||(cfg.daily={});
 secs=+secs.toFixed(2);
 if(c.date!==date){
  c.streak=(c.date&&dailyPrev(date)===c.date)?(c.streak||0)+1:1;
  c.date=date;c.best=secs;c.medal=med;
 // `up` is the scoring direction (trialDir): a saveRun's best is a save count, higher wins
 }else if(up?secs>c.best:secs<c.best){c.best=secs;c.medal=med;}
 else return false;
 saveCfg();return true;
}

// --- the table pin ---
// the table is the only venue property that changes the sim (CONFIG.tables[].collision); stashed on entry, restored on exit (saveCfg writes the parked one)
function trialVenueHeld(){return TRL.tbl?{table:TRL.tbl,room:cfg.room,pitch:cfg.pitch,skins:cfg.skins}:null;}
function trialTableApply(id,cb){
 if(!TRLC.pinTable||!id||!CONFIG.tables[id]||cfg.table===id){if(cb)cb();return;}
 if(!TRL.tbl)TRL.tbl=cfg.table;                 // ONCE — three trials in a row still restore the original
 cfg.table=id;
 if(typeof applyTable==='function')applyTable(cb);else if(cb)cb();
}
// fires from SCREENS.trials.onHide: leaving the trials area, not start or quit-to-list, so the table stays across retries
function trialTableRestore(){
 if(!TRL.tbl)return;
 const t=TRL.tbl;TRL.tbl=null;cfg.table=t;
 if(typeof applyTable==='function')applyTable();
}

// --- lifecycle ---
function trialStart(id){
 // 'daily' is built from today's date (dailyBuild), not looked up in CONFIG.trials.list
 const d=(id==='daily')?dailyBuild():trialById(id);
 if(!d||S.trial)return;
 // quitting returns to the section the run launched from; the daily has no cat and leaves the tab alone
 if(d.cat)TRL.cat=d.cat;
 Au.init();Au.ui();
 trialTableApply(d.table,()=>{
  TRL.pending=d;
  S.seedNext=(d.seed>>>0);   // js/rng.js — consumed by startMatchNow, so it cannot leak onward
  S.teamStats=null;          // a league squad build scales the PLAYER's hit too; a trial is base stats
  startMatch('training',(d.hold||null));
 });
}
// end of trainingEnter: a queued trial takes over the sandbox; true if it did (training.js skips its toast)
function trialArm(){
 if(!TRL.pending)return false;
 const d=TRL.pending;TRL.pending=null;
 TRL.def=d;S.trial=TRL;
 // trnSetRodShown writes the sandbox's persisted hide list; stash it so trialExit can put it back
 TRL.hidWas=TRN.hidden.slice();
 buildTrialHud();
 const p=$('trnPanel');if(p)p.classList.add('hidden');   // sandbox tools are not trial tools
 const H=bindHintRods(true,true);
 hudHint([bindJoin([bindHint('retry','retry'),'[ESC] pause']),H.act,bindJoin([H.mod,H.sw])].filter(Boolean).join('\n'),
  '{VIEW} retry · {START} pause\n{A} kick · {X} raise · {LB} {RB} switch rod');
 trialReset();
 return true;
}
// apply the setup; also RETRY, so it must be byte-identical each time (re-seed from S.seed)
function trialReset(){
 const d=TRL.def;if(!d)return;
 if(typeof rngSeed==='function')rngSeed(S.seed);
 TRL.run=false;TRL.t0=0;TRL.secs=0;TRL.done=false;TRL.ok=false;TRL.goals=0;
 TRL.medal=null;TRL.pb=false;TRL.sig='';TRL.showAt=0;
 TRL.roles=(d.goal.kind==='roleGoals')?d.goal.roles.slice():null;
 // a 'stat' objective is scored off the match ledger (S.stats.<key>[0]), polled in trialTick
 TRL.statKey=(d.goal.kind==='stat')?d.goal.stat:null;
 TRL.statN=0;
 // a 'saveRun' serves its own balls, one per attempt
 TRL.saveRun=(d.goal.kind==='saveRun')?d.goal:null;
 TRL.att=0;TRL.saves=0;TRL.svSeen=0;TRL.res=false;TRL.attT0=0;TRL.serveAt=0;TRL.serving=false;TRL.spawn=null;
 // sandbox state a trial must not inherit; `ai` comes from the spec and CONFIG.trials pins the difficulty (teamDiff)
 TRN.freeze=false;TRN.stepQ=0;TRN.score=false;
 // dead-ball recovery is on in a trial (redropBall uses its spawn); a spec can opt out with deadball:false
 TRN.deadball=(d.deadball!==false);
 TRN.ai=(d.ai&&d.ai.slice())||[false,false];
 // AI-off rod men: your side lifts like a benched rod, theirs stays flat as the obstacle; a spec overrides with lift:[bool,bool]
 TRN.lift=(d.lift&&d.lift.slice())||[true,false];
 TRN.ballType=d.ball.type||'classic';
 trnSetPlacing(false);
 // rods: only what the trial declares stays on the table. Keys are '<team>|<role>'.
 const show=d.rods&&d.rods.show;
 rods.forEach((r,i)=>trnSetRodShown(i,!show||show.indexOf(r.team+'|'+r.role)>=0));
 // a hidden rod is still in the seat's switch list: filter to what's on the table, unless that would empty it
 S.seats.forEach(s=>{
  const vis=s.rods.filter(r=>!r.trnHidden);
  if(vis.length&&vis.length<s.rods.length){s.rods=vis;if(s.ctrl>=vis.length)s.ctrl=0;}
 });
 if(typeof updateChips==='function')updateChips();
 clearBalls();
 if(TRL.saveRun){
  // a saveRun puts no ball down here, it arms the first serve so every attempt opens the same way
  TRL.serving=true;TRL.serveAt=S.time+trialServeDelay();
 }else{
  const b=trnSpawnBall(TRN.ballType,d.ball.x,d.ball.z);
  b.v.set(d.ball.vx||0,d.ball.vy||0,d.ball.vz||0);
  syncBall(b);
 }
 // the ledger backs the objective, so a retry starts it clean
 S.stats=freshStats();
 S.score=[0,0];S.lastTouch=-1;S.phase='play';
 if(typeof updateScoreUI==='function')updateScoreUI();
 trialHudSync();
}
// --- 'saveRun': N attacks, one keeper ---
// an attempt is one served ball, settled by the first of a save, a goal conceded, or attemptT seconds (failsafe)
function trialServeDelay(){const g=TRL.saveRun;return (g&&g.serveDelay!=null)?g.serveDelay:1.2;}
// which spawn this attempt uses: a spec's list walked in order, wrapping
function trialSpawnFor(i){
 const sp=TRL.saveRun&&TRL.saveRun.spawns;
 return (sp&&sp.length)?sp[i%sp.length]:TRL.def.ball;
}
function trialServe(){
 const s=trialSpawnFor(TRL.att);
 clearBalls();
 // every attempt opens from rest: clears swing latches, held-forward evades and trap state
 if(typeof resetRodRotation==='function')resetRodRotation();
 const b=trnSpawnBall(TRN.ballType,s.x,s.z);
 b.v.set(s.vx||0,s.vy||0,s.vz||0);
 syncBall(b);
 TRL.spawn={x:s.x,z:s.z};   // read as DATA by redropBall (js/powerups.js) — a stall goes back HERE
 TRL.att++;TRL.res=false;TRL.serving=false;TRL.attT0=S.time;
 // the clock starts on the first serve (a keeper may never swing); it isn't what a saveRun is scored on
 if(!TRL.run){TRL.run=true;TRL.t0=S.time;}
 trialHudSync();
}
// settle the live attempt; idempotent, a save and a concede can land in one frame and only the first counts
function trialAttemptEnd(saved){
 if(!TRL.saveRun||TRL.res||TRL.done)return;
 TRL.res=true;
 if(saved)TRL.saves++;
 // the ball isn't cleared here (trainingGoal frees it); trialTick sweeps it on the frame boundary
 if(TRL.att>=(TRL.saveRun.n||1)){trialFinish(true);return;}
 TRL.serving=true;TRL.serveAt=S.time+trialServeDelay();
 trialHudSync();
}
function trialRestart(){if(TRL.def){trialReset();Au.ui();}}
// from trainingExit (gotoMenu); the table is restored by the screen, so retry and quit-to-list keep it
function trialExit(){
 S.trial=null;TRL.def=null;TRL.pending=null;
 TRL.run=false;TRL.done=false;TRL.serving=false;TRL.res=false;TRL.spawn=null;TRN.freeze=false;TRN.stepQ=0;
 if(TRL.hidWas){TRN.hidden=TRL.hidWas;TRL.hidWas=null;}   // give the sandbox its own hide list back
 const h=$('trlHud');if(h)h.classList.add('hidden');
 const c=$('trlCard');if(c)c.classList.add('hidden');     // sibling of the HUD, not a child — see buildTrialHud
}

// --- scoring ---
// called from trainingGoal before removeBall; `team` is the scoring team, the player is team 0 (the other end is conceded)
function trialGoal(team,b){
 if(!TRL.def||TRL.done)return;
 // a saveRun is scored by attempts: a goal at your end settles the attempt with nothing banked
 if(TRL.saveRun){if(team!==0)trialAttemptEnd(false);trialHudSync();return;}
 if(team!==0)return;
 const d=TRL.def;
 TRL.goals++;
 // a 'stat' trial is scored by its counter, never goals
 if(TRL.statKey){/* trialTick owns completion for this kind */}
 else if(TRL.roles){
  // b.mss is matchstats' last swing, so a goal off a post credits the boot that hit it
  const rec=b.mss,i=(rec&&rec.role)?TRL.roles.indexOf(rec.role):-1;
  if(i>=0)TRL.roles.splice(i,1);
  if(!TRL.roles.length)trialFinish(true);
 }else if(TRL.goals>=(d.goal.n||1))trialFinish(true);
 trialHudSync();
}
function trialFinish(ok){
 if(TRL.done)return;
 TRL.done=true;TRL.ok=!!ok;
 // recompute rather than trust trialTick's value (a goal resolves mid-frame); still clamped to the limit
 if(TRL.run){const lim=TRL.def.limit||0;TRL.secs=S.time-TRL.t0;if(lim>0&&TRL.secs>lim)TRL.secs=lim;}
 else TRL.secs=0;
 TRN.freeze=true;   // hold the world on the result — training's own freeze lever, reused
 if(ok){
  const d=TRL.def;
  // an untimed run sets no record (it would write an unbeatable 0.00s gold)
  // a saveRun always has a meaningful record (0 saves is an honest score); every other kind must refuse an untimed run
  const sr=!!TRL.saveRun,val=sr?TRL.saves:TRL.secs,keep=sr||TRL.run;
  TRL.medal=keep?trialMedal(d,val):null;
  if(keep){
   // a daily keeps its record in cfg.daily (its id is 'daily' every day, and the streak needs a home)
   if(d.daily)TRL.pb=dailyRecord(val,TRL.medal,d.date,trialDir(d)>0);
   else{
    const prev=trialBest(d.id);
    if(!prev||trialBetter(d,val,prev.best)){
     const m=cfg.trials||(cfg.trials={});
     m[d.id]={best:+val.toFixed(2),medal:TRL.medal};
     saveCfg();TRL.pb=true;
    }
   }
  }
  // a saveRun always completes, so celebrate only on a medal
  if(!sr||TRL.medal){Au.goal('medal');if(typeof confetti==='function')confetti();}
  else Au.whistle();
 }else{TRL.medal=null;Au.whistle();}
 // start the beat: the world is already frozen, this only delays the panel
 TRL.showAt=performance.now()+Math.max(0,(TRLC.resultDelay!=null?TRLC.resultDelay:0.8))*1000;
 TRL.sig='';   // force the card to render
 trialHudSync();
}
/* Once per FRAME, from trainingTick. */
function trialTick(){
 if(!TRL.def)return;
 if(!TRL.done){
  // the clock starts on your first swing (S.stats.kicks), not S.lastTouch; a save also starts it (a keeper blocks without swinging)
  if(!TRL.run&&S.stats&&(S.stats.kicks[0]>0||S.stats.saves[0]>0)){TRL.run=true;TRL.t0=S.time;}
  // --- 'saveRun': serve, settle, repeat; all on the frame boundary, never the sim path ---
  if(TRL.saveRun){
   const g=TRL.saveRun;
   // a save is read as a delta, at most one per attempt, so saves <= attempts
   const sv=(S.stats&&S.stats.saves[0])||0;
   if(sv>TRL.svSeen){TRL.svSeen=sv;trialAttemptEnd(true);}
   // the sweep trialAttemptEnd doesn't do; skipped once DONE so the last attempt freezes on the ball
   if(TRL.res&&!TRL.done&&S.balls.length)clearBalls();
   if(!TRL.done){
    if(TRL.serving){if(S.time>=TRL.serveAt)trialServe();}
    else if(TRL.att>0&&g.attemptT>0&&S.time-TRL.attT0>=g.attemptT)trialAttemptEnd(false);
   }
  }
  // a 'stat' objective is polled here rather than hooked at each detector
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

// --- in-match HUD (createElement, like the debug/training panels) ---
function buildTrialHud(){
 if(!TRL.hudBuilt){
  TRL.hudBuilt=true;
  const d=document.createElement('div');d.id='trlHud';
  d.innerHTML='<div class="trlName" id="trlName"></div>'
   +'<div class="trlObj" id="trlObj"></div>'
   +'<div class="trlClock" id="trlClock">0.00</div>';
  document.body.appendChild(d);
  // the result panel is a sibling of the HUD: #trlHud's transform would make fixed descendants resolve against it
  const c=document.createElement('div');c.id='trlCard';c.className='trlCard hidden';
  c.innerHTML='<div class="trlRes" id="trlRes"></div>'
   +'<div class="trlSecs" id="trlSecs"></div>'
   +'<div class="trlMed" id="trlMed"></div>'
   +'<div class="trlBtns">'
    +'<button class="btn" id="trlRetry">Retry</button>'
    +'<button class="btn ghost" id="trlQuit">Trials</button>'
   +'</div>'
   +'<div class="trlKeys">R — retry &nbsp;·&nbsp; ESC — back to trials</div>';
  document.body.appendChild(c);
  // Bound ONCE at build time, not on every result — these two nodes outlive every run.
  const rb=$('trlRetry');if(rb)rb.onclick=()=>trialRestart();   // trialRestart plays its own click
  const qb=$('trlQuit');if(qb)qb.onclick=()=>{Au.ui();trialQuit();};
 }
 const h=$('trlHud');if(h)h.classList.remove('hidden');
}
// the clock is written every frame, everything else is signature-gated to avoid DOM churn
function trialHudSync(){
 if(!TRL.hudBuilt||!TRL.def)return;
 const d=TRL.def,lim=d.limit||0,shown=lim>0?Math.max(0,lim-TRL.secs):TRL.secs;
 const cl=$('trlClock');
 // a saveRun's big number is the score, not the clock
 if(cl){
  if(TRL.saveRun){cl.textContent=String(TRL.saves);cl.classList.remove('warn');}
  else{cl.textContent=shown.toFixed(2);cl.classList.toggle('warn',lim>0&&shown<=5);}
 }
 const prog=TRL.saveRun
  ? (Math.max(1,Math.min(TRL.att,TRL.saveRun.n||1))+' / '+(TRL.saveRun.n||1))
  : TRL.roles
  ? d.goal.roles.map(r=>TRL.roles.indexOf(r)<0?'<b>'+r+'</b>':r).join(' &middot; ')
  : ((TRL.statKey?TRL.statN:TRL.goals)+' / '+(d.goal.n||1));
 // the panel appears a beat after the run ends (CONFIG.trials.resultDelay); `ready` must be in the signature
 const ready=TRL.done&&(!TRL.showAt||performance.now()>=TRL.showAt);
 const sig=prog+'|'+TRL.saves+'|'+TRL.done+'|'+ready+'|'+TRL.ok+'|'+TRL.medal+'|'+TRL.pb;
 if(sig===TRL.sig)return;
 TRL.sig=sig;
 $('trlName').textContent=d.name;
 $('trlObj').innerHTML=(TRL.saveRun?'SAVES &middot; ATTEMPT ':TRL.roles?'SCORE WITH ':TRL.statKey?(TRL_LABEL[TRL.statKey]||TRL.statKey.toUpperCase())+' ':'GOALS ')+prog;
 const card=$('trlCard');
 card.classList.toggle('hidden',!ready);
 if(!ready)return;
 const res=$('trlRes');
 res.textContent=TRL.ok?'COMPLETE':'OUT OF TIME';
 res.className='trlRes '+(TRL.ok?'ok':'no');
 $('trlSecs').textContent=TRL.ok?(trialScoreText(d,TRL.saveRun?TRL.saves:TRL.secs)+(TRL.pb?'  ·  NEW BEST':'')):'';
 const md=$('trlMed');
 md.textContent=TRL.medal?TRL.medal.toUpperCase():'';
 md.className='trlMed '+(TRL.medal||'');
}

// --- the list on #trials ---
// browsed by discipline (CONFIG.trials.cats); a section is a filter over the flat list; TRL.cat survives the run so quitting lands on the tab you came from
function trialCats(){return (TRLC&&TRLC.cats)||[];}
function trialsIn(cat){const out=[];if(TRLC&&TRLC.list)for(const d of TRLC.list)if(d.cat===cat)out.push(d);return out;}
// cleared / total plus the medal breakdown, shared by the tab counter and the section header
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
// the tab that opens with no live choice: the first section that has something in it
function trialCatDefault(){
 const cs=trialCats();
 for(const c of cs)if(trialsIn(c.id).length)return c.id;
 return cs.length?cs[0].id:null;
}
function trialCatSet(id){if(id===TRL.cat)return;TRL.cat=id;Au.ui('tab');renderTrials();}
// one row, shared by the flat fallback and the sectioned list
function trialRowHtml(d){
 const b=trialBest(d.id);
 return '<div class="trlRow'+(b?' done':'')+'" data-trial="'+d.id+'">'
  +'<div class="trlRowTop"><span class="trlRowName">'+d.name+'</span>'
  +(b&&b.medal?'<span class="trlPill '+b.medal+'">'+b.medal.toUpperCase()+'</span>'
    :b?'<span class="trlPill">DONE</span>':'')
  +'</div><div class="trlRowSub">'+d.blurb+'</div>'
  +'<div class="trlRowMeta">'+trialObjText(d)
  +'<i>'+(d.limit?d.limit+'s &middot; ':'')+(b?'best '+trialScoreText(d,b.best):'not attempted')
  +'</i></div></div>';
}
function trialBindRows(box){box.querySelectorAll('[data-trial]').forEach(el=>{el.onclick=()=>trialStart(el.dataset.trial);});}
function renderTrials(){
 const box=$('trialsPanel');
 if(!box||!trialOn())return;   // no list = leave the screen's own empty state in the markup
 const cats=trialCats();
 // no cats declared falls back to the flat list rather than a blank panel
 if(!cats.length){
  const tabs=$('trlTabs');if(tabs)tabs.innerHTML='';
  box.innerHTML='<h3>Trials</h3><div class="trlList">'+TRLC.list.map(trialRowHtml).join('')+'</div>';
  trialBindRows(box);
  return;
 }
 if(!TRL.cat||!cats.some(c=>c.id===TRL.cat))TRL.cat=trialCatDefault();
 let cat=null;for(const c of cats)if(c.id===TRL.cat)cat=c;
 if(!cat)cat=cats[0];
 // --- the tab strip ---
 // rebuilt whole on every show; the counter is cleared/total, not a medal count
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
 // --- the section ---
 const list=trialsIn(cat.id),st=trialCatStat(cat.id);
 let h='<div class="trlSecHead"><h3>'+cat.name+'</h3>'
  +'<span class="trlTally">'+(st.done?st.done+' / '+st.n+' cleared':st.n?st.n+' trial'+(st.n===1?'':'s'):'')+'</span></div>'
  +'<div class="trlSecSub">'+(cat.sub||'')+'</div>';
 if(!list.length){
  // an empty section says what is missing rather than looking broken
  h+='<div class="trnEmpty">NOTHING HERE YET<span>No '+cat.name.toLowerCase()
   +' trials have been written. Every trial runs on a fixed seed, so each attempt replays the '
   +'same ball, the same opponent and the same bounce &mdash; these are on their way.</span></div>';
 }else{
  // the medal strip only appears once there is a medal to report
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
// --- the daily's own screen ---
// one human-readable line for any objective kind, shared by the daily panel and the trials list
function trialObjText(d){
 const g=d.goal||{};
 if(g.kind==='roleGoals')return 'Score with '+(g.roles||[]).join(' &middot; ');
 if(g.kind==='stat')return (g.n||1)+' &times; '+(TRL_LABEL[g.stat]||String(g.stat).toUpperCase());
 if(g.kind==='saveRun')return 'Keep out '+(g.n||1)+' attacks';
 return 'Score '+(g.n||1);
}
// rebuilt on every show: it depends on the date and whether today is cleared
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
   // the source trial's name, off d.from
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
 // the daily can start from here too, so this screen also gives the table back (idempotent)
 SCREENS.daily.onHide=trialTableRestore;
}
// home card and back button; CONFIG.trials.daily.on hides the card, the route stays registered
(function(){
 const card=$('btnDaily');
 if(card){
  if(!dailyOn())card.classList.add('hidden');
  else card.onclick=()=>{Au.init();Au.ui();showScreen('daily');};
 }
 const back=$('dailyBack');
 if(back)back.onclick=()=>{showScreen('home');Au.ui('back');};
})();
// leave the run for the list (TRIALS button, Escape); gotoMenu returns to the tab the run came from
function trialQuit(){if(typeof gotoMenu==='function')gotoMenu();}
// Escape on a finished run goes back to the list instead of pausing a frozen world
// capture phase (input.js would open #pause first); only Escape, only while DONE, never over an overlay that owns it
addEventListener('keydown',e=>{
 if(e.code!=='Escape'||S.photo||!S.trial||!TRL.done)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 const o=$('options'),f=$('lgForfeit');
 if(o&&!o.classList.contains('hidden'))return;
 if(f&&!f.classList.contains('hidden'))return;
 e.preventDefault();e.stopPropagation();
 trialQuit();
},true);
// R retries; owned here so a missing trials.js changes no key; not while S.photo (photo mode binds R)
addEventListener('keydown',e=>{
 if(S.photo)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 // the retry key is a binding (js/binds.js), typeof-guarded so this file stands alone
 if(S.trial){if(typeof bindIs==='function'?bindIs('retry',e.code):e.code==='KeyR'){e.preventDefault();trialRestart();}return;}
 // Left/Right walk the discipline tabs, only while #trials is the live screen
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
