'use strict';
// ================= match stats =================
// the ledger: every counter is banked off a hook that already fires (collideRod's contact sites, kickRod, the slide, the goal test) plus one small per-ball record per contact
// independent of CONFIG.moments.on (saves and woodwork are the moment detectors'), so a cosmetic toggle can't empty the sheet; lands in S.stats (freshStats, js/state.js), read once by msWinRender
function msOn(){return MSTAT.on&&!!S.stats;}

// per-ball record clear, from syncBall (any hard set of position), or a record survives a teleport; msc = last contact, mss = last swing (the striker)
function msReset(b){b.msc=null;b.mss=null;}

// per-rod bucket keyed team|role, cached on the rod against the identity of its stats object (freshStats is a new object per match, so a stale bucket is never written)
function msRod(r){
 const st=S.stats;if(!st)return null;
 if(r.msBFor===st)return r.msB;
 const k=r.team+'|'+r.role;
 const b=st.rods[k]||(st.rods[k]={team:r.team,role:r.role,goals:0,og:0,shots:0,onTarget:0,kicks:0,passes:0,dist:0});
 r.msBFor=st;r.msB=b;return b;
}
// read-only lookup for the renderer: never creates, so an idle rod renders as zeroes
const MS_ZERO=Object.freeze({goals:0,og:0,shots:0,onTarget:0,kicks:0,passes:0,dist:0});   // frozen: it is HANDED OUT, so a stray += would poison every empty rod at once
function msRodOf(team,role){return (S.stats&&S.stats.rods[team+'|'+role])||MS_ZERO;}

// ---- swings (js/rods.js kickRod) ----
// the team total is gated on S.stats alone, not msOn(): the legacy panel prints it too
function msKick(r){
 if(!S.stats)return;
 S.stats.kicks[r.team]++;
 if(!msOn())return;
 const b=msRod(r);if(b)b.kicks++;
}

// ---- contact (js/physics.js collideRod, both passes) ----
// runs at the two S.lastTouch sites; order against momContact doesn't matter (own record)
function msContact(b,r){
 if(!msOn()||S.phase!=='play')return;
 const st=S.stats,p=b.m.position,sw=r.kickT>=0,prev=b.msc;
 // pass completed: a teammate rod receiving a ball another of its rods struck (not tied to the AI's 'pass' style; trapping is receiving); an opponent touch overwrites b.msc and breaks the chain
 if(prev&&prev.sw&&prev.team===r.team&&prev.rod!==r&&S.time-prev.t<MSTAT.passT){
  st.passes[r.team]++;const pb=msRod(prev.rod);if(pb)pb.passes++;
 }
 if(sw){
  const sp=b.v.length();
  if(sp>st.hardest[r.team])st.hardest[r.team]=sp;
  // shot: one per swing, not per contact (r.msSw is the latch, cleared in kickRod)
  if(!r.msSw){r.msSw=true;msShot(b,r,p);}
 }
 const rec={team:r.team,role:r.role,rod:r,sw:sw,t:S.time};
 b.msc=rec;if(sw)b.mss=rec;
}
// was that swing an attempt at goal, and on target?
//   ATTEMPT: goalward off the boot at shotVX, landing within shotWide goal-widths of centre (wider or slower is a clearance)
//   ON TARGET: momOnTarget(), the same projection as the keeper-save detector
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

// ---- rod work (js/rods.js updateRods) ----
// slide distance in table units, play phase only
function msSlide(r,d){
 if(!msOn()||S.phase!=='play'||!(d>0))return;
 S.stats.dist[r.team]+=d;const b=msRod(r);if(b)b.dist+=d;
}

// ---- per-step (js/physics.js, beside the possession line) ----
// territory (the ball across the pitch thirds, shared between live balls) and the rally clock; b.cur is the true sim position
function msTick(dt){
 if(!msOn()||S.phase!=='play')return;
 const st=S.stats,n=S.balls.length;if(!n)return;
 st.rally+=dt;
 const nb=st.terr.length,w=F.L/nb,sh=dt/n;
 for(const b of S.balls)st.terr[clamp(Math.floor((b.cur.x+F.L/2)/w),0,nb-1)]+=sh;
}
// a rally is one uninterrupted period of play, serve to goal/out; a dead-ball re-drop doesn't end it
function msRallyReset(){if(msOn())S.stats.rally=0;}
function msRallyEnd(){
 if(!msOn())return;const st=S.stats;
 if(st.rally>st.longRally)st.longRally=st.rally;
 st.rally=0;
}

// ---- goals (js/flow.js onGoal) ----
// call before removeBall (the records hang off the ball)
// own goal uses momKind's rule (last contact a swing by the conceding side); a passive deflection stays the striker's, so credit reads b.mss not b.msc
function msGoal(team,b){
 if(!msOn())return;
 const st=S.stats,g=msScorer(b,team);
 st.scorers.push({team:team,role:g.role,own:g.own,t:S.matchTime});
 if(!g.rod)return;
 const rb=msRod(g.rod);if(!rb)return;
 if(g.own)rb.og++;else if(g.rod.team===team)rb.goals++;
}
// who scored, as a rod: the only derivation, split out so the goal FX flashes the scorer's ring (fx.js rodHoleGoal) off the same answer
// b.msc decides an own goal, b.mss takes the credit; not gated on msOn() (stats off = null records = no flash); call before removeBall
function msScorer(b,team){
 const last=b&&b.msc,own=!!(last&&last.sw&&last.team===1-team),src=own?last:((b&&b.mss)||last);
 return {src:src||null,rod:(src&&src.rod)||null,role:src?src.role:'',own:own};
}

// =========== POST-MATCH SHEET ===========
// two tabs: MATCH (a mirrored comparison bar per stat) and RODS (the deep dive)
function msNum(v){return String(Math.round(v));}
function msClock(s){const m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x;}
// one comparison row: a/b drive the split, disp formats the value; 0 v 0 leaves the track empty rather than 50/50
function msRow(lab,a,b,disp,i){
 const t=a+b,pa=t?a/t*100:0,pb=t?b/t*100:0,d=(i*MSTAT.barStagger).toFixed(3);
 return '<div class="msRow"><b class="l">'+disp(a)+'</b><div class="msMid"><span class="msLab">'+lab+'</span>'+
  '<div class="msBar"><i class="l" style="width:'+pa.toFixed(2)+'%;--d:'+d+'s"></i>'+
  '<i class="r" style="width:'+pb.toFixed(2)+'%;--d:'+d+'s"></i></div></div>'+
  '<b class="r">'+disp(b)+'</b></div>';
}
// territory: where the ball spent the match in world-x order; terr[0] is the third team 0 defends, so the key names teams
function msTerrHTML(){
 const st=S.stats,tot=st.terr.reduce((a,b)=>a+b,0)||1,n=st.terr.length;
 let bar='';
 for(let i=0;i<n;i++){
  const p=st.terr[i]/tot*100,cls=i===0?'a':i===n-1?'b':'m';
  bar+='<i class="'+cls+'" style="width:'+p.toFixed(2)+'%">'+(p>=9?Math.round(p)+'%':'')+'</i>';
 }
 // the key names the two ends and, with exactly one segment between, the middle; other counts leave the interior unlabelled
 let key='';
 for(let i=0;i<n;i++)key+='<span>'+(i===0?teamName(0)+' third':i===n-1?teamName(1)+' third':(n===3?'Midfield':''))+'</span>';
 return '<div class="msTerrWrap"><span class="msLab">Territory</span>'+
  '<div class="msTerrBar">'+bar+'</div><div class="msTerrKey">'+key+'</div></div>';
}
// scorers in order; an own goal is listed under the team that benefited, with the conceding rod's role and (OG)
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
// RODS tab: saves are read off the team total, since the save detector is GK-only (js/moments.js)
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
// fill both tabs, once, from endMatch; MSTAT.on:false renders the original three-number panel with no tab bar
function msWinRender(){
 const st=S.stats,sheet=$('winStats'),rodsEl=$('winRods'),tabs=$('winTabs');
 if(!st||!sheet)return;
 // team colours come from teamCol(), not --c0/--c1 (only repainted for a league match)
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
// the win screen is an overlay, not a registered screen (js/screens.js), so it has its own tab toggle
function msWinTab(t){
 const m=t!=='rods',a=$('winStats'),b=$('winRods'),ba=$('winTabMatch'),bb=$('winTabRods');
 if(a)a.classList.toggle('hidden',!m);
 if(b)b.classList.toggle('hidden',m);
 if(ba)ba.classList.toggle('on',m);
 if(bb)bb.classList.toggle('on',!m);
}
