'use strict';
/* ================= league ================= */
// League state LG persists under per-slot localStorage keys
// (fuzeball_league_0/1/2). The player is identified by LG.playerId (a stable
// id into LG.teams), NOT by array position. Promotion/relegation moves the
// player between divisions, so index-0 assumptions are dead.
// The live-match bridge is S.lg (set only while a league match runs): flow.js,
// rods.js and ai.js pull names/colours/goal target/difficulty through the
// team* helpers below, so a league match re-skins the normal match flow
// without forking it.
const LGC=CONFIG.league,LG_ROLES=['GK','DEF','MID','ATT'],LG_KEYS=['spd','str','acc','ctl','rea','sta','iq'];
let LG=null;
function lgBlk(base){const b=base!=null?base:STC.base;const blk={};for(const k of LG_KEYS)blk[k]=b;return blk;}
function lgBld(base){return{GK:lgBlk(base),DEF:lgBlk(base),MID:lgBlk(base),ATT:lgBlk(base)};}
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
function playerDiv(){return LG.teams[LG.playerId].div;}
function saveLG(){
 try{localStorage.setItem('fuzeball_league_'+LG.slot,JSON.stringify(LG));localStorage.setItem('fuzeball_league_slot',LG.slot);}catch(e){}
}
function loadLastSlot(){try{return parseInt(localStorage.getItem('fuzeball_league_slot'))||0;}catch(e){return 0;}}
function loadLG(slot){
 if(slot==null)slot=loadLastSlot();
 try{LG=JSON.parse(localStorage.getItem('fuzeball_league_'+slot)||'null');}catch(e){LG=null;}
 if(!LG){ // migration from old single key
  try{
   const old=JSON.parse(localStorage.getItem('fuzeball_league')||'null');
   if(old){
    LG=old;LG.slot=0;LG.playerId=0;LG.name='LEAGUE 1';LG.special=cfg.special;LG.power=cfg.power;
    LG.teams.forEach((t,i)=>{t.div=1;if(t.id==null)t.id=i;});
    saveLG();localStorage.removeItem('fuzeball_league');
    try{LG=JSON.parse(localStorage.getItem('fuzeball_league_0')||'null');}catch(e){LG=null;}
   }
  }catch(e){LG=null;}
 }
 if(LG){
  if(LG.slot==null)LG.slot=Math.max(0,slot||0);
  if(LG.playerId==null)LG.playerId=0;
  if(LG.name==null)LG.name='LEAGUE '+(LG.slot+1);
  if(LG.special==null)LG.special=cfg.special;
  if(LG.power==null)LG.power=cfg.power;
  const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
  let migrated=false;
  LG.teams.forEach((t,i)=>{
   if(!t.model){t.model=i===LG.playerId?cfg.modelRed:mids[Math.floor(Math.random()*mids.length)];migrated=true;}
   if(t.id==null)t.id=i;
   if(t.div==null)t.div=1;
   if(t.up==null)t.up=0;
   if(t.w==null)t.w=0;if(t.l==null)t.l=0;if(t.gf==null)t.gf=0;if(t.ga==null)t.ga=0;if(t.p==null)t.p=0;
   // backfill stat keys added after this save was written (e.g. 'iq') → base, so old
   // builds don't render empty pips or read NaN through the UI/sim/spend.
   if(t.bld)for(const role of LG_ROLES){const blk=t.bld[role];if(blk)for(const k of LG_KEYS)if(blk[k]==null){blk[k]=STC.base;migrated=true;}}
  });
  if(!LG.hist)LG.hist=[];
  if(!LG.divs){
   const allIds=LG.teams.map(t=>t.id);
   LG.divs=[{name:LGC.divisions[1].name,tier:1,teamIds:allIds,fixtures:LG.fixtures||[],results:LG.results||[],champ:LG.champ||null}];
  }
  if(migrated)saveLG();
 }
}
/* ---- season setup ---- */
function lgColDist(a,b){const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16),dr=(pa>>16)-(pb>>16),dg=((pa>>8)&255)-((pb>>8)&255),db=(pa&255)-(pb&255);return Math.sqrt(dr*dr+dg*dg+db*db);}
function lgFixtures(ids){ // circle method over stable ids, single round robin
 const arr=ids.slice(),n=arr.length,rounds=[];
 for(let r=0;r<n-1;r++){
  const f=[];
  for(let i=0;i<n/2;i++){const a=arr[i],b=arr[n-1-i];f.push(r%2?[b,a]:[a,b]);}
  rounds.push(f);
  arr.splice(1,0,arr.pop());
 }
 return rounds;
}
function lgNewSeason(keep,opts,forceSlot){
 let teams,season=1;
 if(keep&&LG){
  season=LG.season+1;
  const oldPd=playerDiv();
  // 1. Finalise standings per division
  const orders=[];for(let t=0;t<3;t++)orders[t]=lgOrderDiv(t);
  // 2. Award upgrade parts
  for(let t=0;t<2;t++){
   if(orders[t][0])orders[t][0].t.up+=LGC.upPromote1;
   if(orders[t][1])orders[t][1].t.up+=LGC.upPromote2;
  }
  if(orders[2][0])orders[2][0].t.up+=LGC.upChampTop;
  // 3. Relegation penalty: each relegated team loses 1 random stat per role block
  for(let t=1;t<3;t++){
   const relegated=orders[t].slice(-LGC.relegateN);
   for(const e of relegated){
    for(const role of LG_ROLES){
     const st=e.t.bld[role];
     const k=LG_KEYS[Math.floor(Math.random()*LG_KEYS.length)];
     st[k]=Math.max(LGC.relegateFloor,st[k]-LGC.relegateLose);
    }
   }
  }
  // 4. Swap divisions
  const promotedIds=[[],[]];for(let t=0;t<2;t++)promotedIds[t]=orders[t].slice(0,LGC.promoteN).map(e=>e.i);
  const relegatedIds=[[],[]];for(let t=0;t<2;t++)relegatedIds[t]=orders[t+1].slice(-LGC.relegateN).map(e=>e.i);
  for(let t=0;t<2;t++){
   promotedIds[t].forEach(id=>{LG.teams[id].div=t+1;});
   relegatedIds[t].forEach(id=>{LG.teams[id].div=t;});
  }
  const pPromoted=oldPd<2&&promotedIds[oldPd].includes(LG.playerId);
  const pRelegated=oldPd>0&&relegatedIds[oldPd-1].includes(LG.playerId);
  // 5. Record history (OLD division in the history entry)
  const porder=orders[oldPd];
  LG.hist.push({season,
   divChamps:[orders[0][0]?orders[0][0].t.name:'',orders[1][0]?orders[1][0].t.name:'',orders[2][0]?orders[2][0].t.name:''],
   playerDiv:LGC.divisions[oldPd].name,
   playerPos:porder?porder.findIndex(e=>e.i===LG.playerId)+1:0,
   promoted:pPromoted,relegated:pRelegated});
  // 6. AI spend
  for(let i=0;i<LG.teams.length;i++){if(i!==LG.playerId)lgAiSpend(LG.teams[i]);}
  teams=LG.teams;
  }else{
   const names=LGC.names.slice();
   for(let i=names.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=names[i];names[i]=names[j];names[j]=t;}
   const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
   const startDiv=opts&&opts.startDiv!=null?opts.startDiv:1;
   const slot=forceSlot!=null?forceSlot:(LG?LG.slot:0);
   teams=[{id:0,name:(opts&&opts.teamName?opts.teamName:(cfg.redName||'YOU')).toUpperCase(),
    col:opts&&opts.teamCol?opts.teamCol:cfg.redColor,
    bld:lgBld(LGC.divisions[startDiv].base),up:LGC.playerStart,
    model:opts&&opts.model?opts.model:cfg.modelRed,div:startDiv}];
   const pcol=teams[0].col;
   const need=[LGC.divSize,LGC.divSize,LGC.divSize];need[startDiv]--; // player occupies one slot
   let nextId=1;for(let t=0;t<3;t++){
    for(let j=0;j<need[t];j++){
     let col=LGC.cols[nextId%LGC.cols.length];
     if(lgColDist(col,pcol)<LGC.colClash){
      const safe=LGC.cols.filter(c=>lgColDist(c,pcol)>=LGC.colClash);
      col=safe.length?safe[Math.floor(Math.random()*safe.length)]:col;
     }
     const dconf=LGC.divisions[t];
     const team={id:nextId,name:names.pop(),col,bld:lgBld(dconf.base),
      up:Math.round(rand(dconf.aiBudget[0],dconf.aiBudget[1])),
      model:mids[Math.floor(Math.random()*mids.length)],div:t};
     lgAiSpend(team);teams.push(team);nextId++;
    }
   }
  LG={slot,name:opts&&opts.name?opts.name:('LEAGUE '+(slot+1)),
   season:1,round:0,playerId:0,
   special:opts&&opts.special!=null?opts.special:cfg.special,
   power:opts&&opts.power!=null?opts.power:cfg.power,
   teams:[],divs:[],hist:[]};
 }
 for(const t of teams){t.w=0;t.l=0;t.gf=0;t.ga=0;t.p=0;}
 LG.teams=teams;LG.season=season;LG.round=0;
 const divs=[];for(let t=0;t<3;t++){
  const tids=teams.filter(te=>te.div===t).map(te=>te.id);
  divs.push({name:LGC.divisions[t].name,tier:t,teamIds:tids,fixtures:lgFixtures(tids),results:[],champ:null});
 }
 LG.divs=divs;
 S.lgChampDone=false;saveLG();
}
/* ---- ratings + statistical sim (same stat weights spirit as live play) ---- */
function lgRodScore(st,w){let s=0,tw=0;for(const k in w){s+=(st[k]==null?STC.base:st[k])*w[k];tw+=w[k];}return s/tw;}
function lgOff(b){const R=LGC.rate;return R.offMix*lgRodScore(b.ATT,R.att)+(1-R.offMix)*lgRodScore(b.MID,R.mid);}
function lgDef(b){const R=LGC.rate;return R.defMix*lgRodScore(b.GK,R.gk)+(1-R.defMix)*lgRodScore(b.DEF,R.def);}
function lgTeamForm(ti){
 const pd=playerDiv(),d=LG.divs[pd];
 const out=[];
 for(let r=LG.round-1;r>=0&&out.length<5;r--){
  const fix=d.fixtures[r],res=d.results[r];
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
  if(a===LG.playerId&&gb===0)A.up+=LGC.upCleanSheet;}
 else{B.w++;B.p+=3;B.up+=LGC.upWin;A.l++;A.up+=LGC.upLoss;
  if(b===LG.playerId&&ga===0)B.up+=LGC.upCleanSheet;}
}
function lgOrder(){const a=LG.teams.map((t,i)=>({i,t}));a.sort((x,y)=>y.t.p-x.t.p||(y.t.gf-y.t.ga)-(x.t.gf-x.t.ga)||y.t.gf-x.t.gf);return a;}
function lgOrderDiv(tier){const a=LG.teams.map((t,i)=>({i,t})).filter(e=>e.t.div===tier);a.sort((x,y)=>y.t.p-x.t.p||(y.t.gf-y.t.ga)-(x.t.gf-x.t.ga)||y.t.gf-x.t.gf);return a;}
function lgPlayerFixture(){const pd=playerDiv(),R=LG.divs[pd].fixtures[LG.round];return R?R.find(f=>f[0]===LG.playerId||f[1]===LG.playerId):null;}
/* ---- figurine render image map ---- */
const RENDER_MAP={cyborg:1,deltaborg:1,mechaMan:1,irnman:1,stormer:1,manJerry:1,womanAndroid:1,alienTamirok:1,alienGrimlot:1};
function modelRender(id){
 if(!RENDER_MAP[id])return null;
  const base=id==='mechaMan'?'mechaman':id==='irnman'?'irnman':id==='manJerry'?'jerry':id==='womanAndroid'?'jennyBot':id==='alienTamirok'?'tamirok':id==='alienGrimlot'?'grimlot':id;
 return 'assets/renders/render_'+base+'_cycles.png';
}
/* ---- live-match bridge (flow.js/rods.js/ai.js read these) ---- */
function teamName(t){return S.lg?S.lg.names[t]:(t===0?cfg.redName:cfg.blueName);}
function teamCol(t){return S.lg?S.lg.cols[t]:(t===0?cfg.redColor:cfg.blueColor);}
function goalTarget(){return S.lg?LGC.goals:cfg.goals;}
function teamDiff(t){return S.lg?'pro':(t===0?(cfg.diffRed||cfg.diff):(cfg.diffBlue||cfg.diff));} // league: builds ARE the difficulty
function renderLgTape(op){
 const T=LG.teams,me=T[LG.playerId],them=T[op];
 const mo=CONFIG.playerModel.models.find(x=>x.id===me.model);
 const to=CONFIG.playerModel.models.find(x=>x.id===them.model);
 const offA=lgOff(me.bld),defA=lgDef(me.bld),offB=lgOff(them.bld),defB=lgDef(them.bld);
 const bar=(label,val,cls)=>'<div class="lgRateBar"><span class="'+cls+'">'+label+'</span><div class="lgRate"><div class="'+cls+'" style="width:'+(val/10*100|0)+'%"></div></div><span class="num">'+(val*10|0)/10+'</span></div>';
 const rA=modelRender(me.model),rB=modelRender(them.model);
 const fig=(col,src,flip,name,icon)=>
  '<div class="lgTapeFig" style="--tc:'+col+'">'+
   (src?'<div class="lgFigBox"><img src="'+src+'" class="lgFigImg'+(flip?' flip':'')+'" alt="'+name+'"></div>':'<div class="lgFigBox lgFigEmpty">?</div>')+
   '<div class="lgFigCap">'+(icon||'')+' '+name+'</div>'+
  '</div>';
 const teamCard=(col,name,off,def,figHtml)=>
  '<div class="lgTapeTeam"><h2 style="color:'+col+'">'+name+'</h2>'+figHtml+bar('OFF',off,'off')+bar('DEF',def,'def')+'</div>';
 $('lgTapeBody').innerHTML=
  teamCard(me.col,me.name,offA,defA,fig(me.col,rA,false,mo?mo.name:'?',mo?mo.ico:''))+
  '<div class="lgTapeVs"><span>VS</span></div>'+
  teamCard(them.col,them.name,offB,defB,fig(them.col,rB,true,to?to.name:'?',to?to.ico:''));
 $('lgTapeRound').textContent='ROUND '+(LG.round+1)+' / '+LG.divs[playerDiv()].fixtures.length;
}
function lgPlayMatch(){
 const fx=lgPlayerFixture();if(!fx)return;
 const pid=LG.playerId,op=fx[0]===pid?fx[1]:fx[0],T=LG.teams;
 S.teamStats=[T[pid].bld,T[op].bld];
 S.lg={op,names:[T[pid].name,T[op].name],cols:[T[pid].col,T[op].col],rec:false,
        prevKit:{redColor:cfg.redColor,blueColor:cfg.blueColor,modelRed:cfg.modelRed,modelBlue:cfg.modelBlue,special:cfg.special,power:cfg.power}};
 const sel=$('lgControl').value;
 $('league').classList.add('hidden');
 cfg.redColor=T[pid].col;cfg.modelRed=T[pid].model;cfg.blueColor=T[op].col;cfg.modelBlue=T[op].model;cfg.special=LG.special;cfg.power=LG.power;
  document.documentElement.style.setProperty('--c0',cfg.redColor);
  document.documentElement.style.setProperty('--c1',cfg.blueColor);
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
function lgRecord(w){ // called by endMatch while S.lg is live; sims ALL divisions
 if(!LG||!S.lg||S.lg.rec)return;S.lg.rec=true;
 const prevRanks=[];for(let t=0;t<3;t++)prevRanks[t]=lgOrderDiv(t).map(e=>e.i);
 const pd=playerDiv(),pdiv=LG.divs[pd];
 const fx=lgPlayerFixture(),round=pdiv.fixtures[LG.round],res=[];
 for(const f of round){
  if(f===fx)res.push(f[0]===LG.playerId?[S.score[0],S.score[1]]:[S.score[1],S.score[0]]);
  else res.push(lgSim(f[0],f[1]));
 }
 round.forEach((f,i)=>lgApply(f[0],f[1],res[i][0],res[i][1]));
 pdiv.results[LG.round]=res;
 for(let t=0;t<3;t++){
  if(t===pd)continue;
  const d=LG.divs[t],fround=d.fixtures[LG.round],dres=[];
  for(const f of fround)dres.push(lgSim(f[0],f[1]));
  fround.forEach((f,i)=>lgApply(f[0],f[1],dres[i][0],dres[i][1]));
  d.results[LG.round]=dres;
 }
 for(let i=0;i<LG.teams.length;i++){if(i!==LG.playerId)lgAiSpend(LG.teams[i]);}
 LG.round++;
 if(LG.round>=pdiv.fixtures.length){
  for(let t=0;t<3;t++){const order=lgOrderDiv(t);LG.divs[t].champ=order[0].t.name;}
 }
 for(let t=0;t<3;t++){
  const newRank=lgOrderDiv(t).map(e=>e.i);
  for(let i=0;i<newRank.length;i++){const ti=newRank[i];LG.teams[ti].rankD=prevRanks[t].indexOf(ti)-i;}
 }
 saveLG();
}
function lgReturn(){gotoMenu();openLeague(true);} // win screen → lobby (gotoMenu clears S.lg/S.teamStats)
/* ---- scout panel ---- */
function renderLgScout(ti){
 const t=LG.teams[ti];
 $('lgScoutName').textContent=t.name;$('lgScoutName').style.color=t.col;
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
 const playerName=LG.teams[LG.playerId].name;
 const titles=LG.hist.filter(e=>((e.divChamps?e.divChamps[2]:null)||e.champ)===playerName).length;
 $('lgTitles').textContent=titles?'· '+titles+'x Premier Champion':'';
 let h='';
 for(let i=LG.hist.length-1;i>=0;i--){
  const e=LG.hist[i],isPlayer=e.champ===playerName||(e.divChamps&&e.divChamps[2]===playerName);
  const divName=e.playerDiv||'';
  const status=e.promoted?' ▲ '+divName:e.relegated?' ▼ '+divName:' · '+divName;
  h+='<div class="row"><span>S'+e.season+'</span><span style="color:'+(isPlayer?LG.teams[LG.playerId].col:'#93a5c6')+'">'+(e.divChamps?e.divChamps[2]:e.champ||'')+'</span><span>'+(e.playerPos?e.playerPos+({1:'st',2:'nd',3:'rd'}[e.playerPos]||'th')+status:'')+'</span></div>';
 }
 $('lgHist').innerHTML=h;
}
/* ---- lobby UI ---- */
function openLeague(reveal){
 const slot=loadLastSlot();loadLG(slot);
 if(!LG){LG={slot,name:'LEAGUE '+(slot+1)};lgNewSeason(false,null,slot);}
 $('menu').classList.add('hidden');$('lgSlots').classList.add('hidden');$('league').classList.remove('hidden');
 const pd=playerDiv(),dv=LG.divs[pd];
 if(dv.champ&&!S.lgChampDone){confetti(0);Au.goal();S.lgChampDone=true;}
 renderLeague(reveal);
 const fx=lgPlayerFixture();
 if(fx){renderLgScout(fx[0]===LG.playerId?fx[1]:fx[0]);}
}
function renderLeague(reveal){
 const pd=playerDiv(),dv=LG.divs[pd];
 // Promotion/relegation banner from last hist entry
 let ban='';
 if(LG.hist.length){
  const last=LG.hist[LG.hist.length-1];
  if(last.promoted)ban='<div class="lgProRelBanner pro">▲ PROMOTED TO '+LGC.divisions[pd].name.toUpperCase()+' ▲</div>';
  else if(last.relegated)ban='<div class="lgProRelBanner rel">▼ RELEGATED TO '+LGC.divisions[pd].name.toUpperCase()+' ▼</div>';
  else if(LG.season>1)ban='<div class="lgProRelBanner stay">STAYED IN '+LGC.divisions[pd].name.toUpperCase()+'</div>';
 }
 $('lgSeasonTag').innerHTML=(ban||'')+'<span>'+dv.name+' · SEASON '+LG.season+(dv.champ?' · COMPLETE':' · ROUND '+(LG.round+1)+' / '+dv.fixtures.length)+'</span>';
 $('lgNew').textContent=dv.champ?'Next Season ▶':'Reset League';
 renderLgTable();renderLgFix();renderLgLast(reveal);renderLgSquad();renderLgHist();
}
function renderLgTable(){
 const pd=playerDiv(),dv=LG.divs[pd];
 const hasPro=pd<2,hasRel=pd>0;
 let h='<span class="h">#</span><span class="h">TEAM</span><span class="h">▼</span><span class="h">W</span><span class="h">L</span><span class="h">GF</span><span class="h">GA</span><span class="h">PTS</span>';
 lgOrderDiv(pd).forEach((e,pi)=>{
  let rowCls='';
  if(hasPro&&pi<LGC.promoteN)rowCls=' class="lgProZone"';
  if(hasRel&&pi>=LGC.divSize-LGC.relegateN)rowCls=' class="lgRelZone"';
  const rd=e.t.rankD;
  let arrow=rd?'<span class="'+(rd>0?'lgUp':'lgDn')+'">'+(rd>0?'▲':'▼')+'</span>':'<span class="lgSt">–</span>';
  h+='<span class="num"'+(rowCls||'')+'>'+(pi+1)+'</span><span class="nm'+(e.i===LG.playerId?' me':'')+'" data-i="'+e.i+'"'+(rowCls||'')+'><i class="dot" style="background:'+e.t.col+'"></i>'+e.t.name+'</span>'+arrow+
   '<span class="num"'+(rowCls||'')+'>'+e.t.w+'</span><span class="num"'+(rowCls||'')+'>'+e.t.l+'</span><span class="num"'+(rowCls||'')+'>'+e.t.gf+'</span><span class="num"'+(rowCls||'')+'>'+e.t.ga+'</span><span class="num"'+(rowCls||'')+'>'+e.t.p+'</span>';
 });
 $('lgTable').innerHTML=h;
 $('lgTable').querySelectorAll('.nm').forEach(n=>{n.onclick=()=>{renderLgScout(+n.dataset.i);};});
}
function renderLgFix(){
 const pd=playerDiv(),dv=LG.divs[pd],done=!!dv.champ,T=LG.teams,pid=LG.playerId;
 $('lgPlay').classList.toggle('hidden',done);
 $('lgControlRow').classList.toggle('hidden',done);
 if(done){
  const isPlayer=dv.champ===T[pid].name;
  $('lgFixture').innerHTML='🏆 <span style="color:'+(isPlayer?T[pid].col:'var(--gold)')+';font-size:18px;font-weight:900">'+(isPlayer?'YOU ARE THE CHAMPION':dv.champ+' TAKE THE TITLE')+'</span>';
  $('lgRound').innerHTML='<div class="lgFixSm"><span></span><span class="lgVs">CHAMPIONS</span><span></span></div>';
  return;
 }
 const fx=lgPlayerFixture(),op=fx[0]===pid?fx[1]:fx[0];
 $('lgFixture').innerHTML='<span style="color:'+T[pid].col+'">'+T[pid].name+'</span><span class="lgVs">VS</span><span style="color:'+T[op].col+'">'+T[op].name+'</span>'+
  '<div style="width:100%"><button class="miniBtn scoutMini">SCOUT OPPONENT</button></div>';
 $('lgFixture').querySelector('.scoutMini').onclick=()=>renderLgScout(op);
 let h='';
 for(const f of dv.fixtures[LG.round]){
  if(f===fx)continue;
  h+='<div class="lgFixSm"><span>'+T[f[0]].name+'</span><span class="lgVs">v</span><span>'+T[f[1]].name+'</span></div>';
 }
 $('lgRound').innerHTML=h;
}
function renderLgLast(reveal){
 const pd=playerDiv(),dv=LG.divs[pd],r=LG.round-1,res=r>=0?dv.results[r]:null;
 $('lgLastPanel').classList.toggle('hidden',!res);
 if(!res)return;
 const T=LG.teams,pid=LG.playerId;let h='';
 dv.fixtures[r].forEach((f,i)=>{
  const isPlayer=f[0]===pid||f[1]===pid;
  const cls='lgFixSm'+(isPlayer?' me':'')+(reveal?' lgRev'+(isPlayer?' pop':'')+'':'');
  const sty=reveal?' style="animation-delay:'+(i*.08)+'s"':'';
  h+='<div class="'+cls+'"'+sty+'><span>'+T[f[0]].name+'</span><b>'+res[i][0]+' – '+res[i][1]+'</b><span>'+T[f[1]].name+'</span></div>';
 });
 $('lgLast').innerHTML=h;
}
function renderLgSquad(){
 const t=LG.teams[LG.playerId];
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
/* ---- slots screen ---- */
function lgOrderFrom(data,tier){
 if(data.divs){
  const a=data.teams.map((t,i)=>({i,t})).filter(e=>e.t.div===tier);
  a.sort((x,y)=>y.t.p-x.t.p||(y.t.gf-y.t.ga)-(x.t.gf-x.t.ga)||y.t.gf-x.t.gf);
  return a;
 }
 const a=data.teams.map((t,i)=>({i,t}));
 a.sort((x,y)=>y.t.p-x.t.p||(y.t.gf-y.t.ga)-(x.t.gf-x.t.ga)||y.t.gf-x.t.gf);
 return a;
}
function renderSlots(){
 let h='';
 for(let s=0;s<LGC.slots;s++){
  let data=null;
  try{data=JSON.parse(localStorage.getItem('fuzeball_league_'+s)||'null');}catch(e){}
  if(data){
   const pd=(data.teams[data.playerId||0]||{}).div;
   if(pd==null)continue;
   const pdv=data.divs?data.divs[pd]:null;
   const porder=pdv?lgOrderFrom(data,pd).findIndex(e=>e.i===data.playerId):-1;
   h+='<div class="lgSlotCard" data-slot="'+s+'">'+
    '<div class="slotName">'+data.name+'</div>'+
    '<div class="slotDiv">'+(LGC.divisions[pd]?LGC.divisions[pd].name:'Pro League')+' · Season '+data.season+'</div>'+
    '<div class="slotInfo">'+((data.teams[data.playerId||0]||{}).name||'?')+'</div>'+
    '<div class="slotPos">'+(porder>=0?'#'+(porder+1):'')+'</div>'+
    '<div class="lgSlotBtnRow">'+
    '<button class="miniBtn ctn">Continue</button>'+
    '<button class="miniBtn del">Delete</button>'+
    '</div></div>';
  }else{
   h+='<div class="lgSlotCard" data-slot="'+s+'">'+
    '<div class="slotEmpty">＋</div>'+
    '<div class="slotEmptyLab">New League</div>'+
    '</div>';
  }
 }
 const cards=$('lgSlotCards');cards.innerHTML=h;
 cards.querySelectorAll('.lgSlotCard').forEach(card=>{
  const slot=+card.dataset.slot;
  card.onclick=e=>{
   const btn=e.target.closest('.miniBtn');
   if(btn&&btn.classList.contains('del')){
    e.stopPropagation();e.preventDefault();
    if(confirm('Delete this league?')){
     localStorage.removeItem('fuzeball_league_'+slot);
     renderSlots();
    }
    return;
   }
   if(btn&&btn.classList.contains('ctn')){
    e.stopPropagation();e.preventDefault();
    loadLG(slot);openLeague();
    return;
   }
   let data=null;
   try{data=JSON.parse(localStorage.getItem('fuzeball_league_'+slot)||'null');}catch(e){}
   if(data){loadLG(slot);openLeague();}
   else openSetup(slot);
  };
 });
}
function openSlots(){
 $('menu').classList.add('hidden');
 $('lgSlots').classList.remove('hidden');
 renderSlots();
}
/* ---- setup form ---- */
/* ---- 3D figurine preview for setup form ---- */
let LSP={r:null,scene:null,cam:null,root:null,m:null,mats:[],rim:null,ringM:null,plat:null,lid:null,bs:1,
 init(){
  if(this.r)return;const cv=$('lgSetupFig');
  this.r=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,preserveDrawingBuffer:true});
  this.r.setPixelRatio(Math.min(devicePixelRatio,2));
  this.r.setSize(200,260,false);this.r.outputEncoding=THREE.sRGBEncoding;
  this.scene=new THREE.Scene();
  this.scene.add(new THREE.HemisphereLight(0xcdd9ff,0x141018,.95));
  const k=new THREE.DirectionalLight(0xffffff,1.2);k.position.set(5,11,7);this.scene.add(k);
  this.rim=new THREE.PointLight(0xffffff,1.3,50);this.rim.position.set(-4,4,-5);this.scene.add(this.rim);
  this.cam=new THREE.PerspectiveCamera(36,200/260,.1,200);
  this.cam.position.set(0,2.0,8.5);this.cam.lookAt(0,1.65,0);
  this.root=new THREE.Group();this.scene.add(this.root);
  const ring=new THREE.Mesh(new THREE.RingGeometry(3.1,3.45,64),
   new THREE.MeshBasicMaterial({color:0x5a8cff,transparent:true,opacity:.45,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.05;this.scene.add(ring);this.ringM=ring;
  const plat=new THREE.Mesh(new THREE.CylinderGeometry(2.8,3.1,.3,48),
   new THREE.MeshStandardMaterial({color:0x0c1020,emissive:0x1a2540,emissiveIntensity:.5,roughness:.35,metalness:.7}));
  plat.position.y=-.2;this.scene.add(plat);this.plat=plat;
 },
 load(modelId,col){
  this.init();
  const am=CONFIG.playerModel.models.find(m=>m.id===modelId)||CONFIG.playerModel.models[0];
  if(this.lid!==am.id){
   if(this.m){this.root.remove(this.m);this.m=null;this.mats=[];}
   const place=src=>{
    const g=src.clone(true);
    let box=new THREE.Box3().setFromObject(g),size=new THREE.Vector3();box.getSize(size);
    this.bs=3.4/(size.y||1);g.scale.setScalar(this.bs*(cfg.modelScale||1));
    box=new THREE.Box3().setFromObject(g);const ctr=new THREE.Vector3();box.getCenter(ctr);
    g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
    const tp=new Set(am.teamParts.map(s=>s.toLowerCase()));
    this.mats=[];g.traverse(ch=>{if(!ch.isMesh)return;const cm=ch.material.clone();ch.material=cm;if(tp.has(cm.name.toLowerCase()))this.mats.push(cm);});
    this.m=g;this.lid=am.id;this.root.add(g);this.root.rotation.y=cfg.redYaw||0;
    this.paint(col);
   };
   const cached=typeof PV!=='undefined'&&PV.cache&&PV.cache[am.id];
   if(cached){place(cached);return;}
   new THREE.GLTFLoader().load(am.src,gltf=>{
    if(typeof PV!=='undefined'&&PV.cache)PV.cache[am.id]=gltf.scene;
    place(gltf.scene);
   },undefined,()=>{
    const fb=typeof pvFallback==='function'?pvFallback():new THREE.Group();
    if(typeof PV!=='undefined'&&PV.cache)PV.cache[am.id]=fb;
    place(fb);
   });
  }else{this.paint(col);}
 },
 paint(col){
  const c=new THREE.Color(col);
  const mv=clamp(cfg.metalness,0,1),rv=clamp(cfg.roughness,0,1),gv=Math.max(0,cfg.glow);
  this.mats.forEach(m=>{m.color.copy(c);m.metalness=mv;m.roughness=rv;
   if(m.emissive){m.emissive.copy(c);m.emissiveIntensity=gv;}m.needsUpdate=true;});
  if(this.rim)this.rim.color.copy(c);
  if(this.ringM)this.ringM.material.color.copy(c);
  if(this.plat)this.plat.material.emissive.copy(c).multiplyScalar(.28);
  this.r.render(this.scene,this.cam);
 }
};
function openSetup(slot){
 $('lgSlots').classList.add('hidden');
 $('lgSetup').classList.remove('hidden');
 $('lgSetupLgName').value='LEAGUE '+(slot+1);
 $('lgSetupName').value=cfg.redName||'RED';
 $('lgSetupColor').value=cfg.redColor;
 $('lgSetupHex').textContent=cfg.redColor;
 $('lgSetupSpecial').checked=cfg.special;
 $('lgSetupPower').checked=cfg.power;
 $('lgSetupDiv').value='1';
 LSP.load(cfg.modelRed,cfg.redColor); // initial 3D preview
 const pal=$('lgSetupPal');pal.innerHTML='';
 CONFIG.playerModel.swatches.forEach(hex=>{
  const c=document.createElement('div');c.className='czChip';c.style.background=hex;c.dataset.hex=hex.toLowerCase();
  c.onclick=()=>{
   $('lgSetupColor').value=hex.toLowerCase();
   $('lgSetupHex').textContent=hex.toLowerCase();
   pal.querySelectorAll('.czChip').forEach(x=>x.classList.toggle('on',x===c));
   LSP.paint(hex.toLowerCase());
  };
  pal.appendChild(c);
 });
 const models=$('lgSetupModels');models.innerHTML='';
 const mids=CONFIG.playerModel.models.filter(m=>m.src);
 mids.forEach(m=>{
  const b=document.createElement('button');b.className='miniBtn';b.dataset.id=m.id;b.textContent=(m.ico||'🏃')+' '+m.name;
  b.onclick=()=>{
   models.querySelectorAll('.miniBtn').forEach(x=>x.classList.remove('on'));b.classList.add('on');
   LSP.load(m.id,$('lgSetupColor').value);
  };
  models.appendChild(b);
 });
 const cur=cfg.modelRed;models.querySelectorAll('.miniBtn').forEach(b=>{if(b.dataset.id===cur)b.classList.add('on');});
 $('lgSetupColor').oninput=e=>{$('lgSetupHex').textContent=e.target.value;LSP.paint(e.target.value);};
 $('lgSetupCancel').onclick=()=>{$('lgSetup').classList.add('hidden');$('lgSlots').classList.remove('hidden');};
 $('lgSetupCreate').onclick=()=>{
  const selModel=models.querySelector('.miniBtn.on');
  const opts={
   name:$('lgSetupLgName').value.trim().toUpperCase()||'LEAGUE '+(slot+1),
   teamName:($('lgSetupName').value||'YOU').toUpperCase(),
   teamCol:$('lgSetupColor').value,
   model:selModel?selModel.dataset.id:cfg.modelRed,
   startDiv:+$('lgSetupDiv').value,
   special:$('lgSetupSpecial').checked,
   power:$('lgSetupPower').checked
  };
  lgNewSeason(false,opts,slot);
  $('lgSetup').classList.add('hidden');
  openLeague();
 };
}
/* ---- bind ---- */
function bindLeague(){
 $('btnLeague').onclick=()=>{Au.init();Au.ui();openSlots();};
 $('lgBack').onclick=()=>{$('league').classList.add('hidden');$('menu').classList.remove('hidden');Au.ui();};
 $('lgNew').onclick=()=>{lgNewSeason(!!LG&&!!LG.divs[playerDiv()].champ);renderLeague();const fx=lgPlayerFixture();if(fx){renderLgScout(fx[0]===LG.playerId?fx[1]:fx[0]);}Au.ui();};
 $('lgPlay').onclick=lgPlayMatch;
 $('btnWinContinue').onclick=lgReturn;
 $('lgSlotsBack').onclick=()=>{$('lgSlots').classList.add('hidden');$('menu').classList.remove('hidden');Au.ui();};
}
bindLeague();
