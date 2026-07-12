'use strict';
/* ================= HUD ================= */
function updateScoreUI(team){
 $('sbRS').textContent=S.score[0];$('sbBS').textContent=S.score[1];
 if(team!==undefined){const el=team===0?$('sbRS'):$('sbBS');
  el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');}
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
/* active-effect readout. big-goal widens the goal that team ATTACKS (see physics.js) — so the
   card is accented in the OWNER's team colour + an 'ATK →/←' tag pointing at the goal it shoots
   into, killing the old 'Red big goal but the blue-net goal grew' confusion. Frozen is shown on
   the team that's actually slowed. Each card drains a GPU-animated timer bar over its real remaining. */
const FX_EFFECTS=[
 {key:'boost', ico:'⚡', label:'POWER HITS'},
 {key:'frozen',ico:'❄️', label:'FROZEN'},
 {key:'big',   ico:'🥅', label:'BIG GOAL', tag:'ATK', arrow:true}
];
function fxChipHTML(t,fe,end){
  const nm=teamName(t),cv=t===0?'var(--c0)':'var(--c1)',rem=Math.max(.1,end-S.time);
 const arrow=fe.arrow?'<span class="pwrarrow">'+(t===0?'▶':'◀')+'</span>':'';
 const sub=nm+(fe.tag?' · '+fe.tag:'');
 return '<div class="pwr t'+t+'" style="--pc:'+cv+'"><div class="pwrico">'+fe.ico+'</div>'
  +'<div class="pwrbody"><div class="pwrlabel">'+fe.label+arrow+'</div>'
  +'<div class="pwrsub">'+sub+' · <span class="pwrsec" id="pwrsec_'+t+fe.key+'">'+Math.ceil(rem)+'</span>s</div></div>'
  +'<div class="pwrbar"><i style="animation-duration:'+rem.toFixed(2)+'s"></i></div></div>';
}
let fxHudT=0,fxSigCache='';
function hudTick(rdt){
 const mm=String(Math.floor(S.matchTime/60)).padStart(2,'0'),ss=String(Math.floor(S.matchTime%60)).padStart(2,'0');
 $('matchTime').textContent=mm+':'+ss;
 fxHudT-=rdt;if(fxHudT>0)return;fxHudT=.1;
 let sig='';const live=[];
 [0,1].forEach(t=>{const e=S.eff[t];FX_EFFECTS.forEach(fe=>{const end=e[fe.key];
  if(end>S.time){sig+=t+fe.key+Math.round(end)+'|';live.push([t,fe,end]);}});});
 if(sig!==fxSigCache){fxSigCache=sig;$('fxchips').innerHTML=live.map(c=>fxChipHTML(c[0],c[1],c[2])).join('');}
 live.forEach(c=>{const el=$('pwrsec_'+c[0]+c[1].key);if(el)el.textContent=Math.ceil(c[2]-S.time);});
}
