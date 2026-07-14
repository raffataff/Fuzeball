'use strict';
/* ================= UI wiring ================= */
function bindUI(){
 $('setDiffRed').value=cfg.diffRed;$('setDiffBlue').value=cfg.diffBlue;$('setGoals').value=cfg.goals;$('setTheme').value=cfg.theme;
 $('setTable').value=cfg.table||'classic';
 $('setSpecial').checked=cfg.special;$('setPower').checked=cfg.power;
 $('setAuto').checked=cfg.auto;$('setSound').checked=cfg.sound;
 $('nameRed').value=cfg.redName;$('nameBlue').value=cfg.blueName;
 $('nameRed').maxLength=$('nameBlue').maxLength=CONFIG.control.nameMaxLength;
 $('mcRed').textContent='PLAY '+cfg.redName;$('mcBlue').textContent='PLAY '+cfg.blueName;
 $('setDiffRed').onchange=e=>{cfg.diffRed=e.target.value;cfg.diff=cfg.diffRed;saveCfg();};
 $('setDiffBlue').onchange=e=>{cfg.diffBlue=e.target.value;saveCfg();};
 $('setGoals').onchange=e=>{cfg.goals=+e.target.value;saveCfg();};
 $('setTheme').onchange=e=>{cfg.theme=e.target.value;applyTheme();saveCfg();};
  $('setTable').onchange=e=>{cfg.table=e.target.value;applyTable();saveCfg();};
  // populate pitch select from the CONFIG.pitches registry
  const pitchSel=$('setPitch');
  pitchSel.innerHTML='';
  for(const [pid,pdef] of Object.entries(CONFIG.pitches)){
    const opt=document.createElement('option');opt.value=pid;opt.textContent=pdef.name;pitchSel.appendChild(opt);
  }
  pitchSel.value=cfg.pitch;
  pitchSel.onchange=e=>{cfg.pitch=e.target.value;if(typeof drawField==='function')drawField();saveCfg();};
 $('setSpecial').onchange=e=>{cfg.special=e.target.checked;saveCfg();};
 $('setPower').onchange=e=>{cfg.power=e.target.checked;saveCfg();};
 $('setAuto').onchange=e=>{cfg.auto=e.target.checked;saveCfg();};
 $('setSound').onchange=e=>{cfg.sound=e.target.checked;Au.setOn(cfg.sound);saveCfg();};
 $('nameRed').oninput=e=>{cfg.redName=(e.target.value||'RED').toUpperCase();$('mcRed').textContent='PLAY '+cfg.redName;refreshKitUI();saveCfg();};
 $('nameBlue').oninput=e=>{cfg.blueName=(e.target.value||'BLUE').toUpperCase();$('mcBlue').textContent='PLAY '+cfg.blueName;refreshKitUI();saveCfg();};
 wireRodCard('btnRed','redRods','red');
 wireRodCard('btnBlue','blueRods','blue');
 $('btnAI').onclick=()=>startMatch('ai');
 $('btnResume').onclick=()=>togglePause();
 $('btnRestart').onclick=()=>startMatch(S.mode,S.rodLockRole);
 $('btnPauseMenu').onclick=()=>{
  if(S.lg){
   if(S.lg.matchStart&&S.time-S.lg.matchStart<CONFIG.league.graceT){gotoMenu();return;}
    $('lgForfeit').classList.remove('hidden');$('lgForfeitMsg').innerHTML='Recorded as a 0–'+(S.lg&&S.lg.cup?CUP.goals:CONFIG.league.goals)+' loss';Au.ui();
  }
  else gotoMenu();
 };
  $('btnForfeit').onclick=()=>{
    if(S.lg&&S.lg.cup){S.score=[0,CUP.goals];cupRecord(1);openCup();}
    else{S.score=[0,CONFIG.league.goals];lgRecord(1);gotoMenu();openLeague();}
  };
 $('btnForfeitCancel').onclick=()=>{$('lgForfeit').classList.add('hidden');togglePause();};
 $('btnRematch').onclick=()=>startMatch(S.mode,S.rodLockRole);
 $('btnWinMenu').onclick=()=>gotoMenu();
 refreshKitUI();
 bindOptions();
}
function wireRodCard(cardId,rowId,mode){
 var card=$(cardId),row=$(rowId),opts=row.querySelectorAll('.rodOpt');
 opts.forEach(function(o){o.onclick=function(e){
  e.stopPropagation();
  opts.forEach(function(x){x.classList.toggle('on',x===o);});
  startMatch(mode,o.dataset.role||null);
 };});
 card.onclick=function(){
  var sel=row.querySelector('.rodOpt.on');
  startMatch(mode,sel?sel.dataset.role||null:null);
 };
}