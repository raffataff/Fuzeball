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
 $('setDiffRed').onchange=e=>{cfg.diffRed=e.target.value;cfg.diff=cfg.diffRed;saveCfg();};
 $('setDiffBlue').onchange=e=>{cfg.diffBlue=e.target.value;saveCfg();};
 $('setGoals').onchange=e=>{cfg.goals=+e.target.value;saveCfg();};
 $('setGameTime').onchange=e=>{cfg.gameTime=+e.target.value;saveCfg();};
 $('setRoom').onchange=e=>{cfg.room=e.target.value;applyRoom();saveCfg();};
  $('setReflect').onchange=e=>{cfg.reflections=e.target.checked;applyRoom();refreshBallReflect();saveCfg();};
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
 // the roster header picks the name up on its own next tick (rosSig diff) — no call needed here
 $('nameRed').oninput=e=>{cfg.redName=(e.target.value||'RED').toUpperCase();refreshKitUI();saveCfg();};
 $('nameBlue').oninput=e=>{cfg.blueName=(e.target.value||'BLUE').toUpperCase();refreshKitUI();saveCfg();};
 // landing screen (#home) → the rest of the game. LEAGUE/TRAINING bind themselves in their own
 // files; these two are the routes that have no module of their own. Au.init() rides the FIRST
 // user gesture on this screen — WebAudio needs one, and Kick Off/Options are the two cards that
 // don't already call it (league.js's btnLeague does).
 $('btnKickOff').onclick=()=>{Au.init();Au.ui();showScreen('menu');};
 $('btnHomeOptions').onclick=()=>{Au.init();openOptions('home');};
 $('menuBack').onclick=()=>{showScreen('home');Au.ui();};
 $('menuTabBtnTeam').onclick=()=>{menuSetTab('team');Au.ui();};
 $('menuTabBtnRules').onclick=()=>{menuSetTab('rules');Au.ui();};
 menuSetTab('team');
 // The three mode cards (PLAY RED / PLAY BLUE / AI SHOWDOWN) and their rod rows are gone —
 // the roster replaces all of them: side, rod and who's AI are now per-seat (js/roster.js).
 $('btnResume').onclick=()=>togglePause();
 $('btnRestart').onclick=()=>startMatch(S.mode,S.rodLockRole);
 $('btnPauseMenu').onclick=()=>{
  if(S.lg){
   if(S.lg.matchStart&&S.time-S.lg.matchStart<CONFIG.league.graceT){gotoMenu();return;}
    // goalTarget(), not a hardcoded CUP.goals/league.goals pair: the goal target belongs to the
    // league SAVE now (LG.goals) and a cup tie plays to the same one, so quoting the config
    // default would promise a scoreline the record below no longer writes.
    $('lgForfeit').classList.remove('hidden');$('lgForfeitMsg').innerHTML='Recorded as a 0–'+goalTarget()+' loss';Au.ui();
  }
  else gotoMenu();
 };
  $('btnForfeit').onclick=()=>{
    // #lgForfeit is an OVERLAY, so it isn't in the screen registry and hideScreens() won't take it
    // down — without this it stayed up over the lobby you just forfeited back to. (League too.)
    $('lgForfeit').classList.add('hidden');
    // gotoMenu is what tears the match down (balls, fractures, replay, HUD) and restores the
    // player's real kit/table from S.lg.prevKit. The cup branch used to skip it and route straight
    // to the bracket, leaving a paused match and the cup's kit still overriding the player's.
    // cupRecord/lgRecord run FIRST — both read S.lg, which gotoMenu clears (and goalTarget() reads
    // it too, so the forfeit scoreline must be built BEFORE the teardown).
    const fl=goalTarget();
    if(S.lg&&S.lg.cup){S.score=[0,fl];cupRecord(1);gotoMenu();openCup();}
    else{S.score=[0,fl];lgRecord(1);gotoMenu();openLeague();}
  };
 $('btnForfeitCancel').onclick=()=>{$('lgForfeit').classList.add('hidden');togglePause();};
 $('btnRematch').onclick=()=>startMatch(S.mode,S.rodLockRole);
 $('btnWinMenu').onclick=()=>gotoMenu();
 refreshKitUI();
 bindOptions();
}
/* Kick Off tabs. Each tab owns its own .panelWrap and its own ⊞ button, so the ⊞ for the tab
   you're NOT looking at is hidden — two edit buttons stacked in the same corner would be a
   coin toss as to which region you were about to rearrange. layApply is re-run on reveal
   because a wrap inside a display:none tab measures 0 wide and can't be laid out. */
function menuSetTab(t){
 const team=t!=='rules';
 $('menuTab_team').classList.toggle('hidden',!team);
 $('menuTab_rules').classList.toggle('hidden',team);
 $('menuTabBtnTeam').classList.toggle('on',team);
 $('menuTabBtnRules').classList.toggle('on',!team);
 $('menuEditLayout').classList.toggle('hidden',!team);
 $('menuRulesEditLayout').classList.toggle('hidden',team);
 if(typeof layApply==='function')layApply(team?'menu':'menuRules');
}