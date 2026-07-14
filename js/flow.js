'use strict';
/* ================= game flow ================= */
function startMatch(mode,rodLockRole){
 Au.init();Au.ui();
 S.mode=mode;S.userTeam=mode==='red'?0:mode==='blue'?1:-1;
 S.rodLockRole=rodLockRole||null;
 S.score=[0,0];S.stats=freshStats();S.matchTime=0;S.time=0;S.timeScale=1;
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 S.lastTouch=-1;S.lastSwitch=0;S.shake=0;
  clearBalls();clearPU();clearFractures();
  S.active=[[],[]];S.pairCd=[0,0];
  rods.forEach(r=>{r.offset=0;r.target=0;r.slideV=0;r.angle=0;r.prevAngle=0;r.prevOffset=0;
   r.kickT=-1;r.raise=false;r.cd=0;r.aiMan=-1;r.aiErr=0;r.aiErrT=0;r.aiErrTarget=0;
   r.aiBX=r.x;r.aiBZ=0;r.aiBVX=0;r.aiBVZ=0;r.aiGoalZ=0;
   r.removedUntil=[];r.men.forEach(m=>{m.visible=true;});
   r.pivot.rotation.z=0;r.pivot.position.z=0;
   const mine=S.userTeam<0?r.team===0:r.team===S.userTeam;
   if(r.rodModel){r.rodModel.rotation.y=mine?0:Math.PI;}   // flip the whole GLB rod so the handle is on the near side
   else{const hs=mine?1:-1,C=rodCollar(r.maxOff);
    r.handle.position.z=hs*(C+CONFIG.rods.handleLen/2);
    r.collar.position.z=-hs*(C+CONFIG.rods.collarLen/2);}});
  S.ctrlRods=S.userTeam<0?[]:rods.filter(r=>r.team===S.userTeam).sort((a,b)=>a.x-b.x);
 if(rodLockRole&&S.ctrlRods.length>1){
  const lr=S.ctrlRods.find(r=>r.role===rodLockRole)||S.ctrlRods[0];
  S.ctrlRods=[lr];
  $('hint').innerHTML='▲ ▼ / mouse — slide<br>SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; V — camera';
 }else{
  $('hint').innerHTML='◀ ▶ / Q E — switch rod &nbsp;·&nbsp; ▲ ▼ / mouse — slide<br>SPACE / click — kick &nbsp;·&nbsp; SHIFT / R-click — raise &nbsp;·&nbsp; V — camera';
 }
 S.ctrl=0;
 if(S.ctrlRods.length){const mi=S.ctrlRods.findIndex(r=>r.role==='MID');if(mi>=0)S.ctrl=mi;}
 $('menu').classList.add('hidden');$('league').classList.add('hidden');$('pause').classList.add('hidden');$('win').classList.add('hidden');
 $('hud').classList.remove('hidden');
 $('sbRN').textContent=teamName(0);$('sbBN').textContent=teamName(1);
 $('ballTag').textContent=BALL_TYPES.classic.name;
  updateScoreUI();updateChips();
  const sub=S.lg?(S.lg.cup?S.lg.banner:'LEAGUE · ROUND '+(LG.round+1)):(S.userTeam<0?'AI SHOWDOWN':'GOOD LUCK');
  banner('FIRST TO '+goalTarget(),sub,1.7);
 startCount(MATCH.countIn);
}
function startCount(t){S.phase='count';S.countT=t;S.lastCount=-1;$('count').style.display='block';$('count').textContent='';}
function onGoal(team,b){
 if(b.scored)return;b.scored=true;
 const val=b.t.value||1;
 S.score[team]+=val;
 goalFx(team,b);
 updateScoreUI(team);
 removeBall(b);
 if(S.score[team]>=goalTarget()){endMatch(team);return;}
 banner(teamName(team)+' GOAL!',
  val>1?'GOLDEN BALL — COUNTS ×2':HYPE[Math.floor(Math.random()*HYPE.length)],1.9);
 if(!S.balls.length){resetRodRotation();S.phase='goal';S.goalT=MATCH.goalHold;S.timeScale=MATCH.goalSlowmo;}
}
function outOfBounds(b){
 removeBall(b);Au.whistle();
 if(!S.balls.length&&S.phase==='play'){resetRodRotation();banner('OUT!','BALL RETURNS',1.2);S.phase='goal';S.goalT=MATCH.outHold;}
}
function endMatch(w){
 S.phase='win';
 Au.goal();Au.whistle(3);
 flash();S.shake=1;
 clearBalls();clearPU();
  const wasLg=!!S.lg;
  if(wasLg){(S.lg.cup?cupRecord:lgRecord)(w);} // record + sim the rest while the bridge is live
 $('winTitle').textContent=teamName(w)+' WINS!';
 $('winTitle').style.color=teamCol(w);
 $('winScore').textContent=S.score[0]+' — '+S.score[1];
 const st=S.stats,tp=(st.poss[0]+st.poss[1])||1;
 $('winStats').innerHTML=
  '<span class="l">'+Math.round(st.poss[0]/tp*100)+'%</span><span class="m">Possession</span><span class="r">'+Math.round(st.poss[1]/tp*100)+'%</span>'+
  '<span class="l">'+st.kicks[0]+'</span><span class="m">Kicks</span><span class="r">'+st.kicks[1]+'</span>'+
  '<span class="m" style="grid-column:1/4;text-align:center">Top ball speed: '+Math.round(st.topSpeed*.35)+' km/h</span>'+
    (wasLg?(S.lg.cup
      ?'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">⚔ CHAMPIONS CUP · '+CUP.rounds[(LG.cup?LG.cup.round:0)]+'</span>'
      :'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">⚙ +'+(w===0?CONFIG.league.upWin:CONFIG.league.upLoss)+' upgrade parts</span>'+
       (w===0&&S.score[1]===0?'<span class="m" style="grid-column:1/4;text-align:center;color:var(--gold)">🛡 Clean sheet bonus +'+CONFIG.league.upCleanSheet+' upgrade parts</span>':'')):'');
 $('btnWinContinue').classList.toggle('hidden',!wasLg); // league: Continue → lobby
 $('btnRematch').classList.toggle('hidden',wasLg);      // league: no rematches
 $('win').classList.remove('hidden');
 confetti(w);
}
function togglePause(){
 if(S.phase==='play'||S.phase==='count'){S.prePause=S.phase;S.phase='pause';$('pause').classList.remove('hidden');Au.ui();}
 else if(S.phase==='pause'){S.phase=S.prePause;$('pause').classList.add('hidden');Au.ui();}
}
function gotoMenu(){
  if(S.lg&&S.lg.prevKit){
   cfg.redColor=S.lg.prevKit.redColor;cfg.blueColor=S.lg.prevKit.blueColor;
   cfg.modelRed=S.lg.prevKit.modelRed;cfg.modelBlue=S.lg.prevKit.modelBlue;
   cfg.special=S.lg.prevKit.special;cfg.power=S.lg.prevKit.power;
   cfg.table=S.lg.prevKit.table;cfg.theme=S.lg.prevKit.theme;cfg.pitch=S.lg.prevKit.pitch;
   applyTable();applyTheme();
   loadPlayerModel(()=>{rebuildRodMen();applyColors();});
  }
  S.phase='menu';clearBalls();clearPU();clearFractures();
 S.lg=null;S.teamStats=null; // drop any league-match bridge (abandoned matches aren't recorded)
 $('pause').classList.add('hidden');$('win').classList.add('hidden');$('hud').classList.add('hidden');$('league').classList.add('hidden');
 $('menu').classList.remove('hidden');
 indicator.visible=false;dropRing.visible=false;$('count').style.display='none';
}
