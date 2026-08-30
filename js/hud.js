'use strict';
/* ================= HUD ================= */
function updateScoreUI(team){
 $('sbRS').textContent=S.score[0];$('sbBS').textContent=S.score[1];
 if(team!==undefined){const el=team===0?$('sbRS'):$('sbBS');
  el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');}
}
/* Rod selector. One row per SEAT — with a single seat this is byte-identical to the old output;
   with two the rows are prefixed P1/P2 so each player can find their own. A chip for a rod
   another seat is holding is marked .taken (setSeatCtrl would skip it anyway).

   COMPACT MODE past `CHIP_FULL_MAX` seats. The full form is a label plus one chip PER ROD per
   seat, so at 4-a-side it's 40 chips — three wrapped rows eating the bottom of the play area.
   Worse, it's 40 chips of mostly dead affordance: once a side's four seats hold its four rods
   there is nowhere to switch TO, and every off-rod chip is permanently .taken. So above the
   threshold each seat collapses to a single chip showing the rod it actually holds, which is the
   thing you look down to check. Clicking still cycles (setSeatCtrl skips held rods), so nothing
   is lost. Solo and 2-player are under the threshold and render exactly as before. */
const CHIP_FULL_MAX=2;
function updateChips(){
 const c=$('chips');c.innerHTML='';
 if(!S.seats.length)return;
 const multi=S.seats.length>1,compact=S.seats.length>CHIP_FULL_MAX;
 c.classList.toggle('compact',compact);
 S.seats.forEach((s,si)=>{
  const tc=seatCol(s);   // SEAT colour, not team — P1 and P2 on one side must not read alike
  if(compact){
   const r=seatRod(s);if(!r)return;
   const d=document.createElement('div');
   d.className='chip on';d.style.setProperty('--tc',tc);
   d.textContent='P'+(si+1)+' · '+r.role;
   d.onclick=()=>seatStep(s,1);   // no per-rod chips to click, so the chip itself cycles
   c.appendChild(d);
   return;
  }
  if(multi){
   const lab=document.createElement('div');
   lab.className='chip lab';lab.style.setProperty('--tc',tc);lab.textContent='P'+(si+1);
   c.appendChild(lab);
  }
  s.rods.forEach((r,i)=>{
   const d=document.createElement('div');
   d.className='chip'+(i===s.ctrl?' on':'')+(rodTaken(r,s)?' taken':'');
   d.style.setProperty('--tc',tc);
   d.textContent=(i+1)+' · '+r.role;
   d.onclick=()=>setSeatCtrl(s,i,1);
   c.appendChild(d);
  });
 });
}
/* ===== active-effect rails =====================================================================
   A tab slides out of #sb on the side of the team it acts on — red left of the red score, blue
   right of the blue — so the effect is spatially tied to its owner instead of floating in a
   corner with no link to what it affects. That also retires the old 'ATK ▶' arrow AND the team
   name printed in the card: position and colour already say whose it is, so three channels were
   carrying one fact. Big-goal still widens the goal that team ATTACKS (see physics.js); frozen
   still shows on the team actually slowed. Each tab drains its OWN fill back toward the
   scoreboard — the tab IS the timer, so there's no separate bar and no idle bob/pulse filler.

   Icons are inline SVG on currentColor, NOT emoji: OS colour emoji render differently per
   platform, can't be tinted to the team colour, and are the loudest generated-UI tell there is. */
const FX_ICO={
 boost :'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.4 2 5 13.6h5.1L9.2 22l8.6-11.9h-5.3L13.4 2z"/></svg>',
 frozen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/></svg>',
 big   :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18v11H3z"/><path d="M3 11.7h18M3 15h18M8.2 7v11M15.8 7v11"/></svg>'
};
const FX_EFFECTS=[
 {key:'boost', label:'POWER HITS'},
 {key:'frozen',label:'FROZEN'},
 {key:'big',   label:'BIG GOAL'}
];
/* Per-tab DOM diffing, NOT the old whole-rail innerHTML rebuild. The rebuild restarted every
   card's entrance animation whenever any OTHER effect started or expired; with tabs that animate
   in and out, that flicker would be constant. Keyed by team+effect so each tab is created once,
   ticked in place, and removed with its exit animation. */
const fxTabs=new Map();
function fxRailSync(live){
 const seen=new Set();
 for(const c of live){
  const t=c[0],fe=c[1],end=c[2],k=t+fe.key;
  seen.add(k);
  let el=fxTabs.get(k);
  if(!el){
   el=document.createElement('div');
   el.className='fxTab t'+t;
   el.style.setProperty('--pc',t===0?'var(--c0)':'var(--c1)');
   el.innerHTML='<i></i><b class="fxIco">'+FX_ICO[fe.key]+'</b><b class="fxLab">'+fe.label+'</b><b class="fxSec"></b>';
   $('fxRail'+t).appendChild(el);
   fxTabs.set(k,el);
  }
  const rem=Math.max(0,end-S.time);
  // restart the drain ONLY when the expiry moves (a re-collect extending the effect) — not every
  // tick, or the fill would jump back to full ten times a second.
  if(el.dataset.end!==String(end)){
   el.dataset.end=String(end);
   const bar=el.firstChild;
   bar.style.animation='none';void bar.offsetWidth;
   bar.style.animation='fxDrain '+Math.max(.1,rem).toFixed(2)+'s linear forwards';
  }
  el.lastChild.textContent=Math.ceil(rem);
 }
 fxTabs.forEach((el,k)=>{
  if(seen.has(k))return;
  fxTabs.delete(k);
  el.classList.add('out');
  setTimeout(()=>{if(el.parentNode)el.parentNode.removeChild(el);},170); // must outlast fxOut (.15s)
 });
}
// Tear every tab down instantly (match end / menu). An exit animation on a hidden HUD would leave
// orphans in the map, and the next match would think those effects were still live.
function clearFxRail(){
 fxTabs.forEach(el=>{if(el.parentNode)el.parentNode.removeChild(el);});
 fxTabs.clear();
}
let fxHudT=0;
function hudTick(rdt){
 /* Clock: unlimited → counts up; timed → counts DOWN to the limit, pulsing red in the final
    seconds (MATCH.warnT); once level time runs out it flips to a pulsing SUDDEN DEATH badge.
    TRAINING AND TRIALS HAVE NO MATCH CLOCK, so the plate comes off screen entirely. checkMatchClock
    already refuses to act on S.trn, but S.matchTime keeps advancing regardless — so the plate sat
    there counting down from whatever Kick Off was last set to: a second clock beside the trial's
    own, deciding nothing and contradicting the one that does. Hidden rather than blanked, because
    an empty plate still reads as a clock that has broken. */
 const mt=$('matchTime');
 if(S.trn)mt.style.display='none';
 else{
  mt.style.display='';
  const lim=gameTimeLimit();
  if(S.suddenDeath){mt.textContent='SUDDEN DEATH';mt.classList.add('sd');mt.classList.remove('warn');}
  else{
   let shown;
   if(lim>0){shown=Math.max(0,Math.ceil(lim-S.matchTime));mt.classList.toggle('warn',shown<=MATCH.warnT);}
   else{shown=Math.floor(S.matchTime);mt.classList.remove('warn');}
   mt.classList.remove('sd');
   const mm=String(Math.floor(shown/60)).padStart(2,'0'),ss=String(Math.floor(shown%60)).padStart(2,'0');
   mt.textContent=mm+':'+ss;
  }
 }
 /* THE SCOREBOARD GOES WITH IT IN A TRIAL, where '0 : 1' is a second and worse copy of the
    objective line ('GOALS 1 / 3') and half of it belongs to a team that is often not even on
    the table. Driven from HERE, off live state, rather than toggled on the way in and out of
    a trial: every frame re-asserts it, so no exit path can leave a match with no scoreboard.
    S.trial is plain nullable data, so this costs nothing and is safe with no trials.js. */
 const sb=$('sb');if(sb)sb.style.display=S.trial?'none':'';
 fxHudT-=rdt;if(fxHudT>0)return;fxHudT=.1;
 const live=[];
 [0,1].forEach(t=>{const e=S.eff[t];FX_EFFECTS.forEach(fe=>{const end=e[fe.key];
  if(end>S.time)live.push([t,fe,end]);});});
 fxRailSync(live);
}
