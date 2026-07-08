'use strict';
/* ================= league ================= */
// Season state LG persists under localStorage 'fuzeball_league'. Player is
// ALWAYS team index 0 and always plays as red (team 0) in live matches.
// The live-match bridge is S.lg (set only while a league match runs): flow.js,
// rods.js and ai.js pull names/colours/goal target/difficulty through the
// team* helpers below, so a league match re-skins the normal match flow
// without forking it.
const LGC=CONFIG.league,LG_ROLES=['GK','DEF','MID','ATT'],LG_KEYS=['spd','str','acc','ctl','rea','sta'];
let LG=null;
function lgBlk(){return{spd:5,str:5,acc:5,ctl:5,rea:5,sta:5};}
function lgBld(){return{GK:lgBlk(),DEF:lgBlk(),MID:lgBlk(),ATT:lgBlk()};}
function lgBuildHTML(bld,plus){
 let h='';
 for(const role of LG_ROLES){
  h+='<div class="lgRole"><div class="lgRoleHead">'+role+'</div>';
  for(const k of LG_KEYS){
   const v=bld[role][k];
   h+='<div class="lgStat"><span class="sN">'+k.toUpperCase()+'</span><span class="pips"><b>'+'▮'.repeat(v)+'</b>'+'▯'.repeat(STC.max-v)+'</span>'+
    (plus?'<button class="sPlus" data-r="'+role+'" data-k="'+k+'">+</button>':'')+'</div>';
  }
  h+='</div>';
 }
 return h;
}
function saveLG(){try{localStorage.setItem('fuzeball_league',JSON.stringify(LG));}catch(e){}}
function loadLG(){try{LG=JSON.parse(localStorage.getItem('fuzeball_league')||'null');}catch(e){LG=null;}
 if(LG){
  const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
  let migrated=false;
  LG.teams.forEach((t,i)=>{if(!t.model){t.model=i===0?cfg.modelRed:mids[Math.floor(Math.random()*mids.length)];migrated=true;}});
  if(!LG.hist)LG.hist=[];
  if(migrated)saveLG();
 }}
/* ---- season setup ---- */
function lgColDist(a,b){const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16),dr=(pa>>16)-(pb>>16),dg=((pa>>8)&255)-((pb>>8)&255),db=(pa&255)-(pb&255);return Math.sqrt(dr*dr+dg*dg+db*db);}
function lgFixtures(n){ // circle method, single round robin: n-1 rounds of n/2 pairs
 const ids=[];for(let i=0;i<n;i++)ids.push(i);
 const rounds=[];
 for(let r=0;r<n-1;r++){
  const f=[];
  for(let i=0;i<n/2;i++){const a=ids[i],b=ids[n-1-i];f.push(r%2?[b,a]:[a,b]);}
  rounds.push(f);
  ids.splice(1,0,ids.pop());
 }
 return rounds;
}
function lgNewSeason(keep){ // keep=true → same teams carry builds+parts into season+1
 let teams,season=1;
 if(keep&&LG){teams=LG.teams;season=LG.season+1;
  for(let i=teams.length-1;i>1;i--){const j=1+Math.floor(Math.random()*(i)),t=teams[i];teams[i]=teams[j];teams[j]=t;}}
 else{
  const names=LGC.names.slice();
  for(let i=names.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=names[i];names[i]=names[j];names[j]=t;}
  const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
  teams=[{name:(cfg.redName||'YOU').toUpperCase(),col:cfg.redColor,bld:lgBld(),up:LGC.playerStart,model:cfg.modelRed}];
  for(let i=1;i<LGC.teams;i++){
   let col=LGC.cols[i%LGC.cols.length];
   if(lgColDist(col,cfg.redColor)<LGC.colClash){
    const safe=LGC.cols.filter(c=>lgColDist(c,cfg.redColor)>=LGC.colClash);
    col=safe.length?safe[Math.floor(Math.random()*safe.length)]:col;
   }
   const t={name:names.pop(),col,bld:lgBld(),up:Math.round(rand(LGC.aiBudget[0],LGC.aiBudget[1])),model:mids[Math.floor(Math.random()*mids.length)]};
   lgAiSpend(t);teams.push(t);
  }
 }
 for(const t of teams){t.w=0;t.l=0;t.gf=0;t.ga=0;t.p=0;}
 LG={season,round:0,teams,fixtures:lgFixtures(teams.length),results:[],champ:null};S.lgChampDone=false;
 saveLG();
}
/* ---- ratings + statistical sim (same stat weights spirit as live play) ---- */
function lgRodScore(st,w){let s=0,tw=0;for(const k in w){s+=(st[k]==null?STC.base:st[k])*w[k];tw+=w[k];}return s/tw;}
function lgOff(b){const R=LGC.rate;return R.offMix*lgRodScore(b.ATT,R.att)+(1-R.offMix)*lgRodScore(b.MID,R.mid);}
function lgDef(b){const R=LGC.rate;return R.defMix*lgRodScore(b.GK,R.gk)+(1-R.defMix)*lgRodScore(b.DEF,R.def);}
function lgTeamForm(ti){
 const out=[];
 for(let r=LG.round-1;r>=0&&out.length<5;r--){
  const fix=LG.fixtures[r],res=LG.results[r];
  for(let i=0;i<fix.length;i++){
   if(fix[i][0]===ti||fix[i][1]===ti){
    const home=fix[i][0]===ti,sc=res[i];
    out.unshift(home?sc[0]>sc[1]?'W':'L':sc[1]>sc[0]?'W':'L');
    break;
   }
  }
 }
 return out;
}
function lgSim(a,b){ // race to LGC.goals — like the live rules, so no draws
 const A=LG.teams[a].bld,B=LG.teams[b].bld;
 const p=1/(1+Math.exp(-((lgOff(A)-lgDef(B))-(lgOff(B)-lgDef(A)))*LGC.simK));
 let ga=0,gb=0;
 while(ga<LGC.goals&&gb<LGC.goals){if(Math.random()<p)ga++;else gb++;}
 return[ga,gb];
}
/* ---- upgrade economy ---- */
function lgCost(lvl){if(lvl>=STC.max)return Infinity;const i=lvl-STC.base;return i<0?1:LGC.cost[i]||1;}
function lgAiSpend(t){ // weighted-random spend, position-flavoured (CONFIG.league.spend)
 let guard=300;
 while(t.up>0&&guard-->0){
  const role=LG_ROLES[Math.floor(Math.random()*4)],w=LGC.spend[role],st=t.bld[role];
  let tot=0;for(const k in w){const c=lgCost(st[k]);if(st[k]<STC.max&&t.up>=c)tot+=w[k];}
  if(!tot)continue;
  let x=Math.random()*tot;
  for(const k in w){
   const c=lgCost(st[k]);if(st[k]>=STC.max||t.up<c)continue;
   x-=w[k];if(x<=0){st[k]++;t.up-=c;break;}
  }
 }
}
function lgApply(a,b,ga,gb){
 const A=LG.teams[a],B=LG.teams[b];
 A.gf+=ga;A.ga+=gb;B.gf+=gb;B.ga+=ga;
 if(ga>gb){A.w++;A.p+=3;A.up+=LGC.upWin;B.l++;B.up+=LGC.upLoss;
  if(a===0&&gb===0)A.up+=LGC.upCleanSheet;}
 else{B.w++;B.p+=3;B.up+=LGC.upWin;A.l++;A.up+=LGC.upLoss;
  if(b===0&&ga===0)B.up+=LGC.upCleanSheet;}
}
function lgOrder(){const a=LG.teams.map((t,i)=>({i,t}));a.sort((x,y)=>y.t.p-x.t.p||(y.t.gf-y.t.ga)-(x.t.gf-x.t.ga)||y.t.gf-x.t.gf);return a;}
function lgPlayerFixture(){const R=LG.fixtures[LG.round];return R?R.find(f=>f[0]===0||f[1]===0):null;}
/* ---- live-match bridge (flow.js/rods.js/ai.js read these) ---- */
function teamName(t){return S.lg?S.lg.names[t]:(t===0?cfg.redName:cfg.blueName);}
function teamCol(t){return S.lg?S.lg.cols[t]:(t===0?cfg.redColor:cfg.blueColor);}
function goalTarget(){return S.lg?LGC.goals:cfg.goals;}
function teamDiff(t){return S.lg?'pro':(t===0?(cfg.diffRed||cfg.diff):(cfg.diffBlue||cfg.diff));} // league: builds ARE the difficulty
function renderLgTape(op){
 const T=LG.teams,me=T[0],them=T[op];
 const mo=CONFIG.playerModel.models.find(x=>x.id===me.model);
 const to=CONFIG.playerModel.models.find(x=>x.id===them.model);
 const offA=lgOff(me.bld),defA=lgDef(me.bld),offB=lgOff(them.bld),defB=lgDef(them.bld);
 const bar=(label,val,cls)=>'<div class="lgRateBar"><span class="'+cls+'">'+label+'</span><div class="lgRate"><div class="'+cls+'" style="width:'+(val/10*100|0)+'%"></div></div><span class="num">'+(val*10|0)/10+'</span></div>';
 $('lgTapeBody').innerHTML=
  '<div class="lgTapeTeam"><h3 style="color:'+me.col+'">'+me.name+'</h3>'+bar('OFF',offA,'off')+bar('DEF',defA,'def')+(mo?'<div class="figName">'+mo.ico+' '+mo.name+'</div>':'')+'</div>'+
  '<span class="lgVs" style="font-size:26px">VS</span>'+
  '<div class="lgTapeTeam"><h3 style="color:'+them.col+'">'+them.name+'</h3>'+bar('OFF',offB,'off')+bar('DEF',defB,'def')+(to?'<div class="figName">'+to.ico+' '+to.name+'</div>':'')+'</div>';
 $('lgTapeRound').textContent='ROUND '+(LG.round+1)+' / '+LG.fixtures.length;
}
function lgPlayMatch(){
 const fx=lgPlayerFixture();if(!fx)return;
 const op=fx[0]===0?fx[1]:fx[0],T=LG.teams;
 S.teamStats=[T[0].bld,T[op].bld];
 S.lg={op,names:[T[0].name,T[op].name],cols:[T[0].col,T[op].col],rec:false,
       prevKit:{blueColor:cfg.blueColor,modelBlue:cfg.modelBlue}};
 const sel=$('lgControl').value;
 $('league').classList.add('hidden');
 cfg.blueColor=T[op].col;cfg.modelBlue=T[op].model;
 const start=()=>{S.lg.matchStart=S.time;rebuildRodMen();applyColors();startMatch(sel==='watch'?'ai':'red',sel&&sel!=='watch'?sel:null);};
 if(LGC.tape){
  renderLgTape(op);
  $('lgTape').classList.remove('hidden');
  let tapeDone=false,modelDone=false;
  const check=()=>{if(tapeDone&&modelDone){$('lgTape').classList.add('hidden');start();}};
  loadPlayerModel(()=>{modelDone=true;check();});
  const go=()=>{tapeDone=true;check();};
  $('lgTape').onclick=()=>{clearTimeout(tid);go();};
  const tid=setTimeout(go,LGC.tapeT*1000);
 }else{
  loadPlayerModel(start);
 }
}
function lgRecord(w){ // called by endMatch while S.lg is live; sims the rest of the round
 if(!LG||!S.lg||S.lg.rec)return;S.lg.rec=true;
 const prevRank=lgOrder().map(e=>e.i);
 const fx=lgPlayerFixture(),round=LG.fixtures[LG.round],res=[];
 for(const f of round){
  if(f===fx)res.push(f[0]===0?[S.score[0],S.score[1]]:[S.score[1],S.score[0]]);
  else res.push(lgSim(f[0],f[1]));
 }
 round.forEach((f,i)=>lgApply(f[0],f[1],res[i][0],res[i][1]));
 LG.results[LG.round]=res;
 for(let i=1;i<LG.teams.length;i++)lgAiSpend(LG.teams[i]); // rivals grow between rounds
 LG.round++;
 if(LG.round>=LG.fixtures.length){
  const order=lgOrder();LG.champ=order[0].t.name;
  if(!LG.hist)LG.hist=[];
  LG.hist.push({season:LG.season,champ:LG.champ,playerPos:order.findIndex(e=>e.i===0)+1});
 }
 const newRank=lgOrder().map(e=>e.i);
 for(let i=0;i<newRank.length;i++){const ti=newRank[i];LG.teams[ti].rankD=prevRank.indexOf(ti)-i;}
 saveLG();
}
function lgReturn(){gotoMenu();openLeague(true);} // win screen → lobby (gotoMenu clears S.lg/S.teamStats)
/* ---- scout panel ---- */
function renderLgScout(ti){
 const t=LG.teams[ti];
 $('lgScoutName').textContent=t.name;
 $('lgScoutName').style.color=t.col;
 const form=lgTeamForm(ti);
 let fh='';for(const c of form)fh+='<span class="'+(c==='W'?'lgW':'lgL')+'">'+c+'</span>';
 const off=lgOff(t.bld),def=lgDef(t.bld);
 $('lgScoutRec').innerHTML='<span style="color:'+t.col+';font-weight:800">'+t.w+'-'+t.l+'</span>'+
  ' · GF '+t.gf+' · GA '+t.ga+' · <span style="color:var(--gold);font-weight:800">'+t.p+'pts</span>'+
  '<span style="margin-left:12px">'+fh+'</span>';
 const m=CONFIG.playerModel.models.find(x=>x.id===t.model);
 $('lgScoutBody').innerHTML=
  (m?'<div class="figName">'+m.ico+' '+m.name+'</div><div style="height:4px"></div>':'')+
  '<div class="lgRateBar"><span class="off">OFF</span><div class="lgRate"><div class="off" style="width:'+(off/10*100|0)+'%"></div></div><span class="num">'+(off*10|0)/10+'</span></div>'+
  '<div class="lgRateBar"><span class="def">DEF</span><div class="lgRate"><div class="def" style="width:'+(def/10*100|0)+'%"></div></div><span class="num">'+(def*10|0)/10+'</span></div>'+
  lgBuildHTML(t.bld,false);
 $('lgScout').classList.remove('hidden');
}
function renderLgHist(){
 if(!LG.hist||!LG.hist.length){$('lgHistPanel').classList.add('hidden');return;}
 $('lgHistPanel').classList.remove('hidden');
 const titles=LG.hist.filter(e=>e.champ===LG.teams[0].name).length;
 $('lgTitles').textContent=titles?'· '+titles+'x Champion':'';
 let h='';
 for(let i=LG.hist.length-1;i>=0;i--){
  const e=LG.hist[i],isPlayer=e.champ===LG.teams[0].name;
  h+='<div class="row"><span>S'+e.season+'</span><span style="color:'+(isPlayer?LG.teams[0].col:'#93a5c6')+'">'+e.champ+'</span><span>'+(e.playerPos?e.playerPos+({1:'st',2:'nd',3:'rd'}[e.playerPos]||'th'):'')+'</span></div>';
 }
 $('lgHist').innerHTML=h;
}
/* ---- lobby UI ---- */
function openLeague(reveal){
 if(!LG)loadLG();
 if(!LG)lgNewSeason(false);
 $('menu').classList.add('hidden');$('league').classList.remove('hidden');
 if(LG.champ&&!S.lgChampDone){confetti(0);Au.goal();S.lgChampDone=true;}
 renderLeague(reveal);
 const fx=lgPlayerFixture();
 if(fx){renderLgScout(fx[0]===0?fx[1]:fx[0]);}
}
function renderLeague(reveal){
 $('lgSeasonTag').textContent='SEASON '+LG.season+(LG.champ?' · COMPLETE':' · ROUND '+(LG.round+1)+' / '+LG.fixtures.length);
 $('lgNew').textContent=LG.champ?'Next Season ▶':'Reset League';
 renderLgTable();renderLgFix();renderLgLast(reveal);renderLgSquad();renderLgHist();
}
function renderLgTable(){
 let h='<span class="h">#</span><span class="h">TEAM</span><span class="h">▼</span><span class="h">W</span><span class="h">L</span><span class="h">GF</span><span class="h">GA</span><span class="h">PTS</span>';
 lgOrder().forEach((e,pi)=>{
  const rd=e.t.rankD;
  let arrow=rd?'<span class="'+(rd>0?'lgUp':'lgDn')+'">'+(rd>0?'▲':'▼')+'</span>':'<span class="lgSt">–</span>';
  h+='<span class="num">'+(pi+1)+'</span><span class="nm'+(e.i===0?' me':'')+'" data-i="'+e.i+'"><i class="dot" style="background:'+e.t.col+'"></i>'+e.t.name+'</span>'+arrow+
   '<span class="num">'+e.t.w+'</span><span class="num">'+e.t.l+'</span><span class="num">'+e.t.gf+'</span><span class="num">'+e.t.ga+'</span><span class="num">'+e.t.p+'</span>';
 });
 $('lgTable').innerHTML=h;
 $('lgTable').querySelectorAll('.nm').forEach(n=>{n.onclick=()=>{renderLgScout(+n.dataset.i);};});
}
function renderLgFix(){
 const done=!!LG.champ,T=LG.teams;
 $('lgPlay').classList.toggle('hidden',done);
 $('lgControlRow').classList.toggle('hidden',done);
 if(done){
  const isPlayer=LG.champ===LG.teams[0].name;
  $('lgFixture').innerHTML='🏆 <span style="color:'+(isPlayer?LG.teams[0].col:'var(--gold)')+';font-size:18px;font-weight:900">'+(isPlayer?'YOU ARE THE CHAMPION':LG.champ+' TAKE THE TITLE')+'</span>';
  $('lgRound').innerHTML='<div class="lgFixSm"><span></span><span class="lgVs">CHAMPIONS</span><span></span></div>';
  return;
 }
 const fx=lgPlayerFixture(),op=fx[0]===0?fx[1]:fx[0];
 $('lgFixture').innerHTML='<span style="color:'+T[0].col+'">'+T[0].name+'</span><span class="lgVs">VS</span><span style="color:'+T[op].col+'">'+T[op].name+'</span>'+
  '<div style="width:100%"><button class="miniBtn scoutMini">SCOUT OPPONENT</button></div>';
 $('lgFixture').querySelector('.scoutMini').onclick=()=>renderLgScout(op);
 let h='';
 for(const f of LG.fixtures[LG.round]){
  if(f===fx)continue;
  h+='<div class="lgFixSm"><span>'+T[f[0]].name+'</span><span class="lgVs">v</span><span>'+T[f[1]].name+'</span></div>';
 }
 $('lgRound').innerHTML=h;
}
function renderLgLast(reveal){
 const r=LG.round-1,res=r>=0?LG.results[r]:null;
 $('lgLastPanel').classList.toggle('hidden',!res);
 if(!res)return;
 const T=LG.teams;let h='';
 LG.fixtures[r].forEach((f,i)=>{
  const isPlayer=f[0]===0||f[1]===0;
  const cls='lgFixSm'+(isPlayer?' me':'')+(reveal?' lgRev'+(isPlayer?' pop':'')+'':'');
  const sty=reveal?' style="animation-delay:'+(i*.08)+'s"':'';
  h+='<div class="'+cls+'"'+sty+'><span>'+T[f[0]].name+'</span><b>'+res[i][0]+' – '+res[i][1]+'</b><span>'+T[f[1]].name+'</span></div>';
 });
 $('lgLast').innerHTML=h;
}
function renderLgSquad(){
 const t=LG.teams[0];
 $('lgUP').textContent=t.up;
 $('lgSquad').innerHTML=lgBuildHTML(t.bld,true);
 $('lgSquad').querySelectorAll('.sPlus').forEach(b=>{
  const k=b.dataset.k,r=b.dataset.r,st=t.bld[r],v=st[k],cost=lgCost(v);
  b.textContent=v>=STC.max?'':'+'+cost;
  b.disabled=t.up<cost||v>=STC.max;
  b.onclick=()=>{
   if(t.up<cost||v>=STC.max)return;
    st[k]++;t.up-=cost;saveLG();Au.power();renderLgSquad();
  };
 });
}
function bindLeague(){
 $('btnLeague').onclick=()=>{Au.init();Au.ui();openLeague();};
 $('lgBack').onclick=()=>{$('league').classList.add('hidden');$('menu').classList.remove('hidden');Au.ui();};
 $('lgNew').onclick=()=>{lgNewSeason(!!LG&&!!LG.champ);renderLeague();const fx=lgPlayerFixture();if(fx){renderLgScout(fx[0]===0?fx[1]:fx[0]);}Au.ui();};
 $('lgPlay').onclick=lgPlayMatch;
 $('btnWinContinue').onclick=lgReturn;
}
bindLeague();
