'use strict';
/* ================= UI wiring ================= */
// Fill the Skin dropdown from the current table's skins (CONFIG.tables[cfg.table].skins).
// The row hides itself when a table has only one skin (nothing to choose).
function refreshSkinSelect(){
 const sel=$('setSkin');if(!sel)return;
 const T=CONFIG.tables[cfg.table]||CONFIG.tables.classic;
 const skins=T.skins||{};
 sel.innerHTML='';
 for(const [sid,sdef] of Object.entries(skins)){
  const o=document.createElement('option');o.value=sid;o.textContent=(sdef.name||sid);sel.appendChild(o);
 }
 sel.value=(typeof curSkin==='function')?curSkin(cfg.table):(T.defSkin||Object.keys(skins)[0]||'');
 if(sel.parentElement)sel.parentElement.style.display=Object.keys(skins).length>1?'':'none';
}
function bindUI(){
 // populate the table + location dropdowns from the CONFIG registries (like the pitch select below),
 // so adding an entry to CONFIG.tables / CONFIG.rooms auto-adds its option — no HTML edit needed.
 const tableSel=$('setTable');tableSel.innerHTML='';
 for(const [tid,tdef] of Object.entries(CONFIG.tables)){const o=document.createElement('option');o.value=tid;o.textContent=(tdef.name||tid).toUpperCase();tableSel.appendChild(o);}
 const roomSel=$('setRoom');roomSel.innerHTML='';
 for(const [rid,rdef] of Object.entries(CONFIG.rooms)){const o=document.createElement('option');o.value=rid;o.textContent=rdef.name||rid;roomSel.appendChild(o);}
 $('setDiffRed').value=cfg.diffRed;$('setDiffBlue').value=cfg.diffBlue;$('setGoals').value=cfg.goals;$('setGameTime').value=String(cfg.gameTime||0);$('setRoom').value=cfg.room;$('setReflect').checked=cfg.reflections;
 $('setTable').value=cfg.table||'classic';
 refreshSkinSelect();
 $('setSpecial').checked=cfg.special;$('setPower').checked=cfg.power;$('setReplay').checked=cfg.replay;
 $('setAuto').checked=cfg.auto;$('setSound').checked=cfg.sound;$('setAmbience').checked=cfg.ambience;
 $('nameRed').value=cfg.redName;$('nameBlue').value=cfg.blueName;
 $('nameRed').maxLength=$('nameBlue').maxLength=CONFIG.control.nameMaxLength;
 $('mcRed').textContent='PLAY '+cfg.redName;$('mcBlue').textContent='PLAY '+cfg.blueName;
 $('setDiffRed').onchange=e=>{cfg.diffRed=e.target.value;cfg.diff=cfg.diffRed;saveCfg();};
 $('setDiffBlue').onchange=e=>{cfg.diffBlue=e.target.value;saveCfg();};
 $('setGoals').onchange=e=>{cfg.goals=+e.target.value;saveCfg();};
 $('setGameTime').onchange=e=>{cfg.gameTime=+e.target.value;saveCfg();};
 $('setRoom').onchange=e=>{cfg.room=e.target.value;applyRoom();saveCfg();};
  $('setReflect').onchange=e=>{cfg.reflections=e.target.checked;applyRoom();saveCfg();};
  $('setTable').onchange=e=>{cfg.table=e.target.value;applyTable();refreshSkinSelect();saveCfg();};
  $('setSkin').onchange=e=>{if(typeof selectSkin==='function')selectSkin(cfg.table,e.target.value);};
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
 $('setReplay').onchange=e=>{cfg.replay=e.target.checked;saveCfg();};
 $('setAuto').onchange=e=>{cfg.auto=e.target.checked;saveCfg();};
 $('setSound').onchange=e=>{cfg.sound=e.target.checked;Au.setOn(cfg.sound);saveCfg();};
 $('setAmbience').onchange=e=>{cfg.ambience=e.target.checked;saveCfg();};
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