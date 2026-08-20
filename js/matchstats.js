'use strict';
/* ================= match stats ==============================================
   THE LEDGER. moments.js answers "was that dramatic"; this answers "what actually
   happened over the match". Every counter is banked off a hook that ALREADY fires
   — the two contact sites in collideRod, kickRod, the rod slide, the goal test —
   so the only new work in the hot path is one small per-ball record per contact
   and one identity check per rod per sim step.

   INDEPENDENT OF CONFIG.moments.on, ON PURPOSE. Saves and woodwork are written by
   the moment detectors because they ARE that event and detecting them twice would
   be silly; everything else is counted here whether or not the drama tier is on,
   and off its OWN per-ball contact record rather than moments' b.tc. The cost is
   one extra small object write per contact — a handful a second — and the payoff
   is that the stat sheet can never quietly empty itself because a cosmetic toggle
   was flipped, which is the worst class of bug to go looking for.

   Everything lands in S.stats (allocated by freshStats, js/state.js) and is read
   once, by msWinRender, when the match ends.
   ========================================================================== */
function msOn(){return MSTAT.on&&!!S.stats;}

/* Per-ball record clear. Called from syncBall — i.e. after ANY hard set of the
   position (serve, re-drop, split, NaN recovery) — for the same reason momReset
   is: a record that survived a teleport would credit the next rally's goal to the
   last one's boot. msc = last contact, mss = last SWING (the striker). */
function msReset(b){b.msc=null;b.mss=null;}

/* Per-rod bucket, keyed team|role. Cached ON the rod against the IDENTITY of the
   stats object it belongs to: this is called once per rod per sim step from the
   slide accumulator, and a string concat plus a map lookup ~960 times a second to
   fetch a reference that changes once a match is exactly the sort of thing that
   turns up on the M panel. The identity test is what makes the cache safe —
   freshStats hands out a NEW object every match, so last match's bucket can never
   be written into. */
function msRod(r){
 const st=S.stats;if(!st)return null;
 if(r.msBFor===st)return r.msB;
 const k=r.team+'|'+r.role;
 const b=st.rods[k]||(st.rods[k]={team:r.team,role:r.role,goals:0,og:0,shots:0,onTarget:0,kicks:0,passes:0,dist:0});
 r.msBFor=st;r.msB=b;return b;
}
/* Read-only lookup for the renderer — never creates, so a rod that did nothing all
   match renders as zeroes instead of adding a bucket at read time. */
const MS_ZERO=Object.freeze({goals:0,og:0,shots:0,onTarget:0,kicks:0,passes:0,dist:0});   // frozen: it is HANDED OUT, so a stray += would poison every empty rod at once
function msRodOf(team,role){return (S.stats&&S.stats.rods[team+'|'+role])||MS_ZERO;}

/* ---- swings (js/rods.js kickRod) ----------------------------------------
   The TEAM total is gated on S.stats alone, not on msOn(): it predates this file
   and the legacy off-switch panel still prints it, so MSTAT.on:false must not
   silently zero a column it goes on to display. Only the per-rod bucket is new. */
function msKick(r){
 if(!S.stats)return;
 S.stats.kicks[r.team]++;
 if(!msOn())return;
 const b=msRod(r);if(b)b.kicks++;
}

/* ---- contact (js/physics.js collideRod, both passes) ---------------------
   Runs at the two S.lastTouch sites. Order against momContact does NOT matter —
   this keeps its own record, deliberately (see the header). */
function msContact(b,r){
 if(!msOn()||S.phase!=='play')return;
 const st=S.stats,p=b.m.position,sw=r.kickT>=0,prev=b.msc;
 /* PASS COMPLETED — a teammate ROD receiving a ball another of its rods struck.
    Deliberately NOT keyed to the AI's 'pass' kick style: a human has no pass verb
    yet (FEATURE-IDEAS 2.2), and a clearance that finds a teammate is a completed
    pass in every stat sheet ever printed. The receiving touch needn't be a swing —
    trapping it is receiving it. An opponent touch in between overwrites b.msc, so
    the chain breaks by itself with no extra bookkeeping. */
 if(prev&&prev.sw&&prev.team===r.team&&prev.rod!==r&&S.time-prev.t<MSTAT.passT){
  st.passes[r.team]++;const pb=msRod(prev.rod);if(pb)pb.passes++;
 }
 if(sw){
  const sp=b.v.length();
  if(sp>st.hardest[r.team])st.hardest[r.team]=sp;
  /* SHOT — one per SWING, not one per contact: a ball rattling along a boot across
     four substeps is one attempt. r.msSw is the latch, cleared in kickRod. */
  if(!r.msSw){r.msSw=true;msShot(b,r,p);}
 }
 const rec={team:r.team,role:r.role,rod:r,sw:sw,t:S.time};
 b.msc=rec;if(sw)b.mss=rec;
}
/* Was that swing an attempt at goal, and was it on target? Two separate tests, and
   they are not the same projection by accident:
   · ATTEMPT is measured here — goalward off the boot at shotVX, with the straight
     line landing within shotWide goal-widths of centre. Wider or slower than that
     is a clearance or a switch of play, and counting those makes the column
     meaningless.
   · ON TARGET is momOnTarget(), the SAME projection the keeper-save detector uses.
     That reuse is the point: the SAVE notice and the on-target column must never
     be able to disagree about whether a given shot was going in. */
function msShot(b,r,p){
 const st=S.stats,dir=r.team===0?1:-1;
 if(b.v.x*dir<MSTAT.shotVX)return;
 const t=(dir*F.L/2-p.x)/b.v.x;
 if(t<=0)return;                                            // already past the line (in the goal)
 if(Math.abs(p.z+b.v.z*t)>F.goalHalf*MSTAT.shotWide)return;
 st.shots[r.team]++;const rb=msRod(r);if(rb)rb.shots++;
 const ot=(typeof momOnTarget==='function')&&momOnTarget(b);
 if(ot&&ot.sx===dir){st.onTarget[r.team]++;if(rb)rb.onTarget++;}
}

/* ---- rod work (js/rods.js updateRods) ------------------------------------
   Slide distance, in table units. Play-phase only, so the AI shuffling back into
   shape during a goal celebration isn't billed to anyone. */
function msSlide(r,d){
 if(!msOn()||S.phase!=='play'||!(d>0))return;
 S.stats.dist[r.team]+=d;const b=msRod(r);if(b)b.dist+=d;
}

/* ---- per-step (js/physics.js, beside the possession line) ----------------
   Territory (where the ball actually IS, split across the pitch thirds) and the
   rally clock. Territory is shared out between LIVE balls rather than read off
   S.balls[0] — in multi-ball the first ball is an arbitrary pick, and splitting dt
   between them is the honest answer. b.cur is the true sim position; b.m.position
   carries the render interpolation. */
function msTick(dt){
 if(!msOn()||S.phase!=='play')return;
 const st=S.stats,n=S.balls.length;if(!n)return;
 st.rally+=dt;
 const nb=st.terr.length,w=F.L/nb,sh=dt/n;
 for(const b of S.balls)st.terr[clamp(Math.floor((b.cur.x+F.L/2)/w),0,nb-1)]+=sh;
}
/* A rally is one uninterrupted period of play: serve to goal / out. A dead-ball
   re-drop deliberately does NOT end it — play never actually stopped, the ball was
   just moved somewhere it could be played from. */
function msRallyReset(){if(msOn())S.stats.rally=0;}
function msRallyEnd(){
 if(!msOn())return;const st=S.stats;
 if(st.rally>st.longRally)st.longRally=st.rally;
 st.rally=0;
}

/* ---- goals (js/flow.js onGoal) -------------------------------------------
   MUST be called before removeBall — the records hang off the ball.
   OWN GOAL is derived here rather than taken from momGoal's verdict, by the SAME
   rule momKind uses (last CONTACT was a swing by the conceding side), so the two
   agree by construction and the ledger still works with CONFIG.moments.on false.
   A passive deflection off a defender is NOT an own goal — it stays the striker's,
   which is why the credit reads b.mss (last SWING) and not b.msc. */
function msGoal(team,b){
 if(!msOn())return;
 const st=S.stats,last=b.msc,own=!!(last&&last.sw&&last.team===1-team),src=own?last:(b.mss||last);
 st.scorers.push({team:team,role:src?src.role:'',own:own,t:S.matchTime});
 if(!src||!src.rod)return;
 const rb=msRod(src.rod);if(!rb)return;
 if(own)rb.og++;else if(src.rod.team===team)rb.goals++;
}

/* =========================================================================
   POST-MATCH SHEET
   Two tabs. MATCH is the sheet you actually read — a mirrored comparison bar per
   stat, the classic broadcast layout, because a column of paired numbers with
   nothing between them is the thing nobody reads. RODS is the deep dive, and it's
   a tab rather than a fourth block because it exists to make upgrade spending feel
   earned, not to be the first thing you see.
   ========================================================================= */
function msNum(v){return String(Math.round(v));}
function msClock(s){const m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x;}
/* One comparison row. a/b drive the split; disp formats the printed value. When
   both sides are zero the track stays EMPTY rather than splitting 50/50 — a flat
   half-and-half bar reads as "even", which 0 v 0 is not. */
function msRow(lab,a,b,disp,i){
 const t=a+b,pa=t?a/t*100:0,pb=t?b/t*100:0,d=(i*MSTAT.barStagger).toFixed(3);
 return '<div class="msRow"><b class="l">'+disp(a)+'</b><div class="msMid"><span class="msLab">'+lab+'</span>'+
  '<div class="msBar"><i class="l" style="width:'+pa.toFixed(2)+'%;--d:'+d+'s"></i>'+
  '<i class="r" style="width:'+pb.toFixed(2)+'%;--d:'+d+'s"></i></div></div>'+
  '<b class="r">'+disp(b)+'</b></div>';
}
/* Territory. The one figure that isn't a two-way split, so it gets its own bar:
   where the ball spent the match, left to right in WORLD-X order. terr[0] is the
   third team 0 DEFENDS (team 0 attacks toward +x), which is why the key names the
   TEAMS rather than saying attacking/defensive — those words only mean anything
   once you already know which way each side is kicking. */
function msTerrHTML(){
 const st=S.stats,tot=st.terr.reduce((a,b)=>a+b,0)||1,n=st.terr.length;
 let bar='';
 for(let i=0;i<n;i++){
  const p=st.terr[i]/tot*100,cls=i===0?'a':i===n-1?'b':'m';
  bar+='<i class="'+cls+'" style="width:'+p.toFixed(2)+'%">'+(p>=9?Math.round(p)+'%':'')+'</i>';
 }
 // The key names the two ENDS and, when there is exactly one segment between them, the middle.
 // At any other bucket count the interior is left unlabelled rather than invented — 'midfield'
 // means nothing about the second fifth of a pitch.
 let key='';
 for(let i=0;i<n;i++)key+='<span>'+(i===0?teamName(0)+' third':i===n-1?teamName(1)+' third':(n===3?'Midfield':''))+'</span>';
 return '<div class="msTerrWrap"><span class="msLab">Territory</span>'+
  '<div class="msTerrBar">'+bar+'</div><div class="msTerrKey">'+key+'</div></div>';
}
/* Scorers, in the order they went in. An own goal is listed under the team that
   BENEFITED, with the conceding rod's role and an (OG) mark — the way every score
   line in football prints it. */
function msScorersHTML(){
 const st=S.stats;if(!st.scorers.length)return'';
 const col=t=>st.scorers.filter(g=>g.team===t)
  .map(g=>'<span class="msG'+(g.own?' og':'')+'">'+(g.role||'—')+(g.own?' (OG)':'')+'<em>'+msClock(g.t)+'</em></span>').join('');
 return '<div class="msScorers"><div class="msScCol l">'+col(0)+'</div>'+
  '<span class="msLab">Scorers</span><div class="msScCol r">'+col(1)+'</div></div>';
}
/* The two facts that belong to the MATCH rather than to either team. */
function msFootHTML(){
 const st=S.stats;
 return '<div class="msFoot"><span><em>'+Math.round(st.topSpeed*MSTAT.kmh)+'</em> km/h top ball speed</span>'+
  '<span><em>'+st.longRally.toFixed(1)+'</em> s longest rally</span></div>';
}
const MS_ROLES=['GK','DEF','MID','ATT'];
/* RODS tab. Saves are read off the TEAM total rather than a per-rod counter,
   because the save detector is GK-ONLY by design (js/moments.js) — every save a
   team made was made by that one rod, so a second counter could only ever end up
   disagreeing with the first. */
function msRodsHTML(){
 const st=S.stats,
  head='<div class="msRodHead"><span class="rl">Rod</span><span>Goals</span><span>Shots</span><span>On tgt</span><span>Saves</span><span>Kicks</span><span>Dist</span></div>',
  team=t=>{
   let rows='';
   for(const role of MS_ROLES){
    const b=msRodOf(t,role);
    rows+='<div class="msRodRow"><span class="rl">'+role+'</span>'+
     '<span'+(b.goals?' class="hi"':'')+'>'+b.goals+(b.og?'<em class="og">'+b.og+' og</em>':'')+'</span>'+
     '<span>'+b.shots+'</span><span>'+b.onTarget+'</span>'+
     '<span>'+(role==='GK'?st.saves[t]:'—')+'</span>'+
     '<span>'+b.kicks+'</span><span>'+Math.round(b.dist*MSTAT.m)+'<em>m</em></span></div>';
   }
   return '<div class="msRodTeam '+(t?'r':'l')+'"><div class="msRodName">'+teamName(t)+'</div>'+head+rows+'</div>';
  };
 return '<div class="msRods">'+team(0)+team(1)+'</div>';
}
/* Fill both tabs. Called once, from endMatch. MSTAT.on:false renders the ORIGINAL
   three-number panel and drops the tab bar entirely — a true off switch, not a
   version of the sheet with empty columns in it. */
function msWinRender(){
 const st=S.stats,sheet=$('winStats'),rodsEl=$('winRods'),tabs=$('winTabs');
 if(!st||!sheet)return;
 // Team colours come from teamCol(), NOT from --c0/--c1: those are only repainted
 // for a LEAGUE match, so a quick match on a custom kit would draw the wrong bars.
 const c0=teamCol(0),c1=teamCol(1);
 sheet.style.setProperty('--t0',c0);sheet.style.setProperty('--t1',c1);
 sheet.style.setProperty('--msGrow',MSTAT.barGrow+'s');
 if(rodsEl){rodsEl.style.setProperty('--t0',c0);rodsEl.style.setProperty('--t1',c1);}
 if(!MSTAT.on){
  if(tabs)tabs.classList.add('hidden');
  if(rodsEl)rodsEl.classList.add('hidden');
  const tp=(st.poss[0]+st.poss[1])||1;
  sheet.className='msLegacy';
  sheet.innerHTML='<span class="l">'+Math.round(st.poss[0]/tp*100)+'%</span><span class="m">Possession</span><span class="r">'+Math.round(st.poss[1]/tp*100)+'%</span>'+
   '<span class="l">'+st.kicks[0]+'</span><span class="m">Kicks</span><span class="r">'+st.kicks[1]+'</span>'+
   '<span class="m" style="grid-column:1/4;text-align:center">Top ball speed: '+Math.round(st.topSpeed*MSTAT.kmh)+' km/h</span>';
  return;
 }
 if(tabs)tabs.classList.remove('hidden');
 sheet.className='msSheet';
 const tp=(st.poss[0]+st.poss[1])||1,pc=v=>Math.round(v/tp*100)+'%';
 let i=0;const row=(lab,a,b,disp)=>msRow(lab,a,b,disp||msNum,i++);
 sheet.innerHTML=
  '<div class="msHead"><b class="l">'+teamName(0)+'</b><span class="msLab">Match stats</span><b class="r">'+teamName(1)+'</b></div>'+
  row('Possession',st.poss[0],st.poss[1],pc)+
  row('Shots',st.shots[0],st.shots[1])+
  row('On target',st.onTarget[0],st.onTarget[1])+
  row('Passes',st.passes[0],st.passes[1])+
  row('Saves',st.saves[0],st.saves[1])+
  row('Woodwork',st.woodwork[0],st.woodwork[1])+
  row('Kicks',st.kicks[0],st.kicks[1])+
  row('Hardest hit',st.hardest[0],st.hardest[1],v=>Math.round(v*MSTAT.kmh)+' km/h')+
  row('Rod distance',st.dist[0],st.dist[1],v=>Math.round(v*MSTAT.m)+' m')+
  msTerrHTML()+msScorersHTML()+msFootHTML();
 if(rodsEl)rodsEl.innerHTML=msRodsHTML();
 msWinTab('match');
}
/* The win screen is an OVERLAY, not a registered screen (js/screens.js), so it
   carries its own two-line tab toggle rather than going through the router. */
function msWinTab(t){
 const m=t!=='rods',a=$('winStats'),b=$('winRods'),ba=$('winTabMatch'),bb=$('winTabRods');
 if(a)a.classList.toggle('hidden',!m);
 if(b)b.classList.toggle('hidden',m);
 if(ba)ba.classList.toggle('on',m);
 if(bb)bb.classList.toggle('on',!m);
}
