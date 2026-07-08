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
let fxHudT=0;
function hudTick(rdt){
 const mm=String(Math.floor(S.matchTime/60)).padStart(2,'0'),ss=String(Math.floor(S.matchTime%60)).padStart(2,'0');
 $('matchTime').textContent=mm+':'+ss;
 fxHudT-=rdt;if(fxHudT>0)return;fxHudT=.25;
 let h='';
 [0,1].forEach(t=>{
  const nm=t===0?cfg.redName:cfg.blueName,cl=t===0?'var(--c0)':'var(--c1)',e=S.eff[t];
  if(e.boost>S.time)h+='<div class="fxchip" style="color:'+cl+'">⚡ '+nm+' boost '+Math.ceil(e.boost-S.time)+'s</div>';
  if(e.frozen>S.time)h+='<div class="fxchip" style="color:'+cl+'">❄️ '+nm+' frozen '+Math.ceil(e.frozen-S.time)+'s</div>';
  if(e.big>S.time)h+='<div class="fxchip" style="color:'+cl+'">🥅 '+nm+' big goal '+Math.ceil(e.big-S.time)+'s</div>';
 });
 $('fxchips').innerHTML=h;
}
