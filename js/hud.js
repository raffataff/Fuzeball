'use strict';
/* ================= HUD ================= */
function updateScoreUI(team){
 $('sbRS').textContent=S.score[0];$('sbBS').textContent=S.score[1];
 if(team!==undefined){const el=team===0?$('sbRS'):$('sbBS');
  el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');}
}
/* Ball readout. The type used to be identified by a colour emoji baked into BALL_TYPES.name
   ('⚽ CLASSIC', '👯 SPLIT BALL'); it's a colour swatch in the ball's own trail colour now, which
   ties the tag to what the player actually sees flying around and survives any platform's font
   stack. `fuse` is the cannonball countdown (was a 💥 in the same string). */
function setBallTag(key,fuse){
 const el=$('ballTag');if(!el)return;
 // the cannonball fuse path calls this EVERY frame; the text only changes once a second, so gate
 // on a signature — an unguarded innerHTML reparse per frame for 3s is pure waste.
 const sig=(key||'-')+'|'+(fuse||'');
 if(el.dataset.sig===sig)return;
 el.dataset.sig=sig;
 const t=key&&BALL_TYPES[key];
 if(!t){el.innerHTML='<i style="background:#3b4a66"></i><span>NO BALL</span>';return;}
 el.innerHTML='<i style="background:'+t.trail+'"></i><span>'+t.name+'</span>'+(fuse?'<b>'+fuse+'</b>':'');
}
function updateChips(){
 const c=$('chips');c.innerHTML='';
 if(S.userTeam<0)return;
 const tc=S.userTeam===0?cfg.redColor:cfg.blueColor;
 S.ctrlRods.forEach((r,i)=>{
  const d=document.createElement('div');
  d.className='chip'+(i===S.ctrl?' on':'');
  d.style.setProperty('--tc',tc);
  d.textContent=(i+1)+' · '+r.role;
  d.onclick=()=>setCtrl(i);
  c.appendChild(d);
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
 // Clock: unlimited → counts up; timed → counts DOWN to the limit, pulsing red in the final
 // seconds (MATCH.warnT); once level time runs out it flips to a pulsing SUDDEN DEATH badge.
 const mt=$('matchTime'),lim=gameTimeLimit();
 if(S.suddenDeath){mt.textContent='SUDDEN DEATH';mt.classList.add('sd');mt.classList.remove('warn');}
 else{
  let shown;
  if(lim>0){shown=Math.max(0,Math.ceil(lim-S.matchTime));mt.classList.toggle('warn',shown<=MATCH.warnT);}
  else{shown=Math.floor(S.matchTime);mt.classList.remove('warn');}
  mt.classList.remove('sd');
  const mm=String(Math.floor(shown/60)).padStart(2,'0'),ss=String(Math.floor(shown%60)).padStart(2,'0');
  mt.textContent=mm+':'+ss;
 }
 fxHudT-=rdt;if(fxHudT>0)return;fxHudT=.1;
 const live=[];
 [0,1].forEach(t=>{const e=S.eff[t];FX_EFFECTS.forEach(fe=>{const end=e[fe.key];
  if(end>S.time)live.push([t,fe,end]);});});
 fxRailSync(live);
}
