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
// Resolve a room id for a division/cup: pass through a valid CONFIG.rooms id, map a legacy theme
// key (old saved leagues stored `theme`) via themeToRoom, else fall back to 'open'.
function roomIdOf(v){return (v&&CONFIG.rooms[v])?v:((v&&CONFIG.themeToRoom[v])||'open');}
/* ---- venue (table + skin + room + pitch) -----------------------------------
   THE LEAGUE SESSION OWNS THE VENUE, NOT THE MATCH. It used to be swapped in by lgPlayMatch and
   swapped back out by gotoMenu, which meant the lobby you spend a whole season on sat in the
   player's own Kick Off venue — so every single round LOADED that room's GLB on the way back to the
   lobby and FREED it a click later when the fixture forced its own (and the round after loaded it
   right back). Now it goes on when you walk into the lobby and comes off when you leave league
   land, so a season is one swap in and one swap out. It also makes the lobby an honest preview of
   where the next fixture is actually played.
   LGV parks the player's own venue meanwhile; saveCfg (config.js) writes THAT rather than the live
   cfg, so a fixture's table can't become the player's permanent setting.
   The division's SKIN was never wired at all — CONFIG.league.divisions[].skin was read by nothing,
   so a league match wore whatever livery the player last picked in Kick Off. lgDivVenue reads it. */
let LGV=null;      // the player's own venue while a league/cup one is on the table (null = not held)
let lgVenueT=0;    // pending restore timer (see lgVenueExit)
function lgVenueHeld(){return LGV;}
function venueSnap(){return{table:cfg.table,room:cfg.room,pitch:cfg.pitch,skins:Object.assign({},cfg.skins)};}
/* Put a venue on the table. Two shapes come through here and the difference matters: a SPEC (one
   `skin` id — what a division or the cup declares) touches only ITS table's livery and leaves the
   player's choices for every other table alone, while a SNAPSHOT (a whole `skins` map — what LGV
   parks) restores the lot. onReady fires once the table skin AND the room backdrop are both
   resident; synchronous when they already are, which is the normal case once the lobby has run. */
function venueApply(v,onReady){
 cfg.table=CONFIG.tables[v.table]?v.table:'classic';
 cfg.room=roomIdOf(v.room);
 if(v.pitch)cfg.pitch=v.pitch;
 if(v.skins)cfg.skins=Object.assign({},v.skins);
 else if(v.skin){cfg.skins=Object.assign({},cfg.skins);cfg.skins[cfg.table]=v.skin;}
 let a=false,b=false,fired=false;
 const done=()=>{if(a&&b&&!fired){fired=true;if(onReady)onReady();}}; // latched: this gates a kickoff
 applyTable(()=>{a=true;done();});
 applyRoom(()=>{b=true;done();});
}
function lgVenueEnter(v,onReady){
 if(lgVenueT){clearTimeout(lgVenueT);lgVenueT=0;}   // a restore was pending — we're staying in league land, so it's cancelled
 if(!LGV)LGV=venueSnap();
 venueApply(v,onReady);
}
/* Hand the player their own venue back. DEFERRED one tick ON PURPOSE: every return-to-lobby path is
   `gotoMenu(); openLeague()` (or openCup) in ONE synchronous run, and gotoMenu's screen change fires
   this through SCREENS.league.onHide. Restoring immediately would tear the division's table/room
   down and re-fetch the player's, only for the lobby to swap straight back a line later — exactly
   the churn this block exists to remove. lgVenueEnter cancels the pending restore. */
function lgVenueExit(){
 if(!LGV||lgVenueT)return;
 lgVenueT=setTimeout(()=>{lgVenueT=0;const v=LGV;LGV=null;if(v)venueApply(v);},0);
}
// Leaving the lobby or the bracket for any other screen (Back, Esc, home) gives it back. Attached
// here rather than declared in screens.js — a screen owns its own teardown (see that file's header).
if(typeof SCREENS!=='undefined'){SCREENS.league.onHide=lgVenueExit;SCREENS.championsCup.onHide=lgVenueExit;}
/* The venue a division is played at. The SAVE's copy (LG.divs, frozen when the season was created)
   wins over the config default, so retuning CONFIG.league.divisions can't move a league mid-season.
   d.theme is the legacy room key on pre-rooms saves. */
function lgDivVenue(t){
 const d=(LG&&LG.divs&&LG.divs[t])||{},c=LGC.divisions[t]||{};
 return{table:d.table||c.table||'classic',
        skin:d.skin||c.skin||null,
        room:roomIdOf(d.room||d.theme||c.room||c.theme),
        pitch:d.pitch||c.pitch||'grass1'};
}
/* The cup's venue. Its PITCH is drawn at random from CUP.pitches and then REMEMBERED ON THE TIE:
   the bracket, the versus tape and the match all have to agree on it, and re-opening the bracket
   must not re-roll the pitch you were just looking at. Falls back to CUP.pitch on a decided cup
   (no tie left to hang the draw on). */
function cupVenue(){
 const tie=(typeof cupPlayerTie==='function')?cupPlayerTie():null;
 let p=tie&&tie.pitch;
 if(!p){
  p=(CUP.pitches&&CUP.pitches.length)?CUP.pitches[Math.floor(Math.random()*CUP.pitches.length)]:CUP.pitch;
  if(tie){tie.pitch=p;saveLG();}
 }
 return{table:CUP.table,skin:CUP.skin||null,room:roomIdOf(CUP.room||CUP.theme),pitch:p};
}
function lgBlk(base){const b=base!=null?base:STC.base;const blk={};for(const k of LG_KEYS)blk[k]=b;return blk;}
function lgBld(base){return{GK:lgBlk(base),DEF:lgBlk(base),MID:lgBlk(base),ATT:lgBlk(base)};}
// promotion floor-raise: bump every stat still sitting at the OLD division base up toward the
// new tier (pos 0=winner +boost1, else +boost2). Already-upgraded stats are left alone.
function lgPromoteBoost(team,pos){const amt=pos===0?LGC.promoteBoost1:LGC.promoteBoost2,oldBase=LGC.divisions[team.div].base,g=[];
 for(const role of LG_ROLES){const st=team.bld[role];for(const k of LG_KEYS){if(st[k]<=oldBase){const from=st[k],to=Math.min(STC.max,from+amt);if(to>from){st[k]=to;g.push({role,key:k,from,to});}}}}
 return g;}
// relegation penalty: knock relegateLose off EVERY stat in every role block (floored).
function lgRelegatePenalty(team){const l=[];
 for(const role of LG_ROLES){const st=team.bld[role];for(const k of LG_KEYS){const from=st[k],to=Math.max(LGC.relegateFloor,from-LGC.relegateLose);if(to<from){st[k]=to;l.push({role,key:k,from,to});}}}
 return l;}
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
  if(LG.goals==null)LG.goals=LGC.goals; // old leagues predate a per-save goal target → the config default they were already playing to
  if(LG.gameTime==null)LG.gameTime=0; // old leagues predate timed play → unlimited (unchanged)
  if(LG.control==null)LG.control='';  // old leagues predate saved rod control → all rods
  // fix invalid pitch values from old saves (e.g. 'royal' was a GLB name, not a pitch ID)
  if(LG.divs){
    const validPitches=Object.keys(CONFIG.pitches);
    for(let d of LG.divs){
      if(!d.pitch||!validPitches.includes(d.pitch)){
        d.pitch=(LGC.divisions[d.tier]&&LGC.divisions[d.tier].pitch)||'';// triggers LGC fallback in lgDivVenue
      }
      // `skin` postdates these saves. Backfilled from config rather than left null so an existing
      // league picks up its division's livery — same intent as the table/room already frozen here.
      if(d.skin==null)d.skin=(LGC.divisions[d.tier]&&LGC.divisions[d.tier].skin)||null;
    }
  }
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
  // 2. Promotion: award upgrade parts + raise the still-at-base stat floor toward the new tier.
  //    (player's boost is applied in lgFinalize so the lobby squad already reflects it → skip here)
  for(let t=0;t<2;t++){
   orders[t].slice(0,LGC.promoteN).forEach((e,pi)=>{
    e.t.up+=pi===0?LGC.upPromote1:LGC.upPromote2;
    if(e.i!==LG.playerId)lgPromoteBoost(e.t,pi);
   });
  }
  if(orders[2][0])orders[2][0].t.up+=LGC.upChampTop;
  // 3. Relegation penalty: each relegated team loses relegateLose off EVERY stat per role block
  //    (player's penalty already applied at season-end so the lobby shows it → skip here)
  for(let t=1;t<3;t++){
   for(const e of orders[t].slice(-LGC.relegateN)){
    if(e.i===LG.playerId)continue;
    lgRelegatePenalty(e.t);
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
   // `cup` is stamped HERE, not in cupRecord. A season's hist entry is only created at the rollover
   // OUT of it, and the cup is played in the gap between the two — so cupRecord writing to hist's
   // newest entry credited the trophy to the season BEFORE the one it was won in. LG.season is still
   // the closing season at this point, which is exactly what LG.cup.season holds.
   LG.hist.push({season:LG.season,
   divChamps:[orders[0][0]?orders[0][0].t.name:'',orders[1][0]?orders[1][0].t.name:'',orders[2][0]?orders[2][0].t.name:''],
   playerDiv:LGC.divisions[oldPd].name,
   playerPos:porder?porder.findIndex(e=>e.i===LG.playerId)+1:0,
   cup:(LG.cup&&LG.cup.done&&LG.cup.season===LG.season)?cupChampName():null,
   promoted:pPromoted,relegated:pRelegated});
  // 6. AI spend
  for(let i=0;i<LG.teams.length;i++){if(i!==LG.playerId)lgAiSpend(LG.teams[i]);}
  teams=LG.teams;
  }else{
   const names=LGC.names.slice();
   for(let i=names.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=names[i];names[i]=names[j];names[j]=t;}
   const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
    const startDiv=opts&&opts.startDiv!=null?opts.startDiv:(LG?LG.teams[LG.playerId].div:1);
    const slot=forceSlot!=null?forceSlot:(LG?LG.slot:0);
    teams=[{id:0,name:(opts&&opts.teamName?opts.teamName:(LG&&LG.teams[LG.playerId]?LG.teams[LG.playerId].name:cfg.redName||'YOU')).toUpperCase(),
     col:opts&&opts.teamCol?opts.teamCol:(LG&&LG.teams[LG.playerId]?LG.teams[LG.playerId].col:cfg.redColor),
     bld:lgBld(LGC.divisions[startDiv].base),up:LGC.playerStart,
     model:opts&&opts.model?opts.model:(LG&&LG.teams[LG.playerId]?LG.teams[LG.playerId].model:cfg.modelRed),div:startDiv}];
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
   LG={slot,name:opts&&opts.name?opts.name:(LG?LG.name:'LEAGUE '+(slot+1)),
    season:1,round:0,playerId:0,
    // The four MATCH RULES this save owns (see lgGoalCap/lgMins below). Chosen on the create screen,
    // editable from the lobby's Match Settings panel, and read by league AND cup ties alike.
    special:opts&&opts.special!=null?opts.special:(LG?LG.special:cfg.special),
    power:opts&&opts.power!=null?opts.power:(LG?LG.power:cfg.power),
    goals:opts&&opts.goals!=null?opts.goals:(LG?LG.goals:cfg.goals), // goals to win (live AND simmed); new leagues seed from the quick-match pref
    gameTime:opts&&opts.gameTime!=null?opts.gameTime:(LG?LG.gameTime:(cfg.gameTime||0)), // match time limit (mins; 0=unlimited) — set from the lobby Match Settings panel; new leagues seed from the quick-match pref
    control:opts&&opts.control!=null?opts.control:(LG?LG.control:''), // default rod control for this save ('' all rods · GK/DEF/MID/ATT lock · watch spectate); lobby overrides persist here too
    teams:[],divs:[],hist:[]};
 }
 for(const t of teams){t.w=0;t.l=0;t.gf=0;t.ga=0;t.p=0;}
 LG.teams=teams;LG.season=season;LG.round=0;
 const divs=[];for(let t=0;t<3;t++){
  const tids=teams.filter(te=>te.div===t).map(te=>te.id);
   // Venue frozen onto the save at creation (read back by lgDivVenue) — `skin` is the table's
   // livery and is part of it; a division that omits one gets the table's defSkin.
   divs.push({name:LGC.divisions[t].name,tier:t,teamIds:tids,fixtures:lgFixtures(tids),results:[],champ:null,
    table:LGC.divisions[t].table||'classic',skin:LGC.divisions[t].skin||null,
    room:roomIdOf(LGC.divisions[t].room),pitch:LGC.divisions[t].pitch||'grass1'});
 }
  LG.divs=divs;
  LG.seasonEnd=null; // season-end summary already shown/applied — don't re-trigger
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
function lgSim(a,b){ // league fixture: timed leagues sim low-scoring, unlimited leagues race to the goal target
  const A=LG.teams[a].bld,B=LG.teams[b].bld;
  return lgSimBlds(A,B,lgMins());
}
// Two builds directly (cup entrants aren't LG.teams). `mins` = the league's game-time limit (>0 =
// timed; 0/omitted = unlimited → the classic race-to-goals). CUP TIES PASS IT TOO: a simmed
// quarter-final in a 10-minute league must be shaped like the one the player just played. Timed:
// draw a RANDOM total-goal count in [simMinGoals, simMaxGoals] from a centre-weighted (triangular)
// distribution — so scores range from a tight 1–0 up to a 5–4, most sit mid-range, and lopsided
// clean sheets are rarer — then split those goals by strength `p`, capped at the save's goal target
// per team (a team hitting the cap ends regulation early, like the live cap). A level game is settled by
// a sudden-death golden goal, so the result is ALWAYS decisive (no draws) — the league
// table/points/promotion code is untouched. `mins` only selects timed-vs-unlimited; the score
// spread is deliberately length-agnostic so every timed league gets the same lively variety.
function lgSimBlds(A,B,mins){
  const p=1/(1+Math.exp(-((lgOff(A)-lgDef(B))-(lgOff(B)-lgDef(A)))*LGC.simK)),cap=lgGoalCap();
  let ga=0,gb=0;
  if(!mins){while(ga<cap&&gb<cap){if(Math.random()<p)ga++;else gb++;}return[ga,gb];}
  const lo=LGC.simMinGoals,hi=LGC.simMaxGoals,roll=()=>lo+Math.floor(Math.random()*(hi-lo+1));
  const total=Math.round((roll()+roll())/2);   // triangular: varied across lo..hi, clustered mid
  for(let i=0;i<total&&ga<cap&&gb<cap;i++){if(Math.random()<p)ga++;else gb++;}
  while(ga===gb){if(Math.random()<p)ga++;else gb++;}   // golden goal — keeps it decisive
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
/* ---- figurine render image map ----
   model id → the filename stem its Blender renders were exported under. The stem does NOT always
   match the id (womanAndroid → jennyBot, manrichie → richie, rocko → rocko2, mechaMan → mechaman),
   and this map is the ONE place that discrepancy is allowed to live — config.js's `mug` paths
   follow the same convention.
   This replaces a RENDER_MAP gate plus a ternary ladder whose final `:id` fallback meant an id
   listed in the gate but missing from the ladder silently resolved to a guessed filename and 404'd
   on the tape (which is what the dead `manStumpy` entry did). A plain map can't drift like that:
   no entry means no render, and the tape draws its '?' box, which is a designed state. */
const RENDER_STEM={
 cyborg:'cyborg',deltaborg:'deltaborg',irnman:'irnman',mechaMan:'mechaman',stormer:'stormer',
 rocko:'rocko2',manJerry:'jerry',manrichie:'richie',womanMaria:'maria',womanKimi:'kimi',
 womanTalia:'talia',womanTanya:'tanya',womanSasha:'sasha',womanAndroid:'jennyBot',
 womanZaneesh:'zaneesh',alienTamirok:'tamirok',alienGrimlot:'grimlot',alienKatum:'katum',
 alienKodus:'kodus',alienZargon:'zargon',animalAzlar:'azlar'};
function modelRender(id){const s=RENDER_STEM[id];return s?'assets/renders/render_'+s+'_cycles.png':null;}
/* Stems that HAVE a team-parts matte exported. tools/render_team_masks.py prints this exact line
   at the end of a run — re-paste it rather than hand-editing.
   This is a declared list rather than a runtime probe ON PURPOSE. The tape used to just request
   the mask and let a 404 tell it the file wasn't there. That worked, and it degraded correctly,
   but it meant every figurine without a matte logged a red 404 in the console on every visit to
   the lobby — and console errors in a shipping build read as a broken game even when nothing is
   wrong. So the roster's mask coverage is stated up front and a file is only requested when we
   already know it exists.
   sasha and jennyBot are deliberately absent: their mattes rendered empty and they're no longer in
   the in-game selection, so requesting them would cost a fetch to tint nothing. */
const MASK_STEMS=new Set([
 'cyborg','deltaborg','irnman','mechaman','stormer','rocko2','jerry','richie','maria','kimi',
 'talia','tanya','zaneesh','tamirok','grimlot','katum','kodus','zargon','azlar']);
/* Team-parts matte for that same render, from the same camera, with the matte baked into the ALPHA
   channel. Used as a CSS mask on the tint layer so the tape can colour the KIT and only the kit —
   skin, hair and eyes are excluded by construction, because they're separate materials in the
   blend and the matte is cut from config.js's own `teamParts` list by Blender's Cryptomatte
   Material pass.
   Alpha, not luminance, is deliberate: `mask-image` keys off alpha, so a plain black-and-white PNG
   would be fully opaque and the tint would cover the whole portrait.
   Null for a figurine with no matte — the tape then shows the untinted render it showed before, so
   the roster can gain masks one figurine at a time with no console noise in between. */
function modelRenderMask(id){
 const s=RENDER_STEM[id];
 return (s&&MASK_STEMS.has(s))?'assets/renders/render_'+s+'_teammask.png':null;
}
/* ---- live-match bridge (flow.js/rods.js/ai.js read these) ---- */
function teamName(t){return S.lg?S.lg.names[t]:(t===0?cfg.redName:cfg.blueName);}
function teamCol(t){return S.lg?S.lg.cols[t]:(t===0?cfg.redColor:cfg.blueColor);}
/* MATCH RULES — ONE source of truth for a league save, and the CUP READS THE SAME ONES.
   A league owns four rules: goals to win, game time, special balls, power-ups. They're picked on
   the create screen and stay editable from the lobby's Match Settings panel. The cup is the
   post-season of THAT league, so it inherits all four — a 10-minute no-power-ups league handing
   you an unlimited power-up final was the mode contradicting itself, and it's what the player hit.
   Only the VENUE stays the cup's own (CUP.table/room/pitches) — that's showpiece dressing, not a rule.
   CUP.goals/special/power survive in config purely as the fallback for a save written before
   LG.goals existed; lgGoalCap/lgMins are what everything should read.
   special/power aren't here because they're pushed straight onto cfg at kickoff (balls.js /
   powerups.js read cfg directly) and restored from S.lg.prevKit on the way out.
   NOT named lgGoals: an element `id` becomes a property on window, and #lgGoals is the lobby's
   goal select — a same-named global function shadows it, which works but is a trap worth dodging. */
function lgGoalCap(){return (LG&&LG.goals!=null)?LG.goals:(S.lg&&S.lg.cup?CUP.goals:LGC.goals);}
function lgMins(){return (LG&&LG.gameTime)||0;}   // match time limit in MINUTES (0 = unlimited)
// One-line readout of those rules, phrased like flow.js's kickoff banner — used on screen subtitles.
function lgRulesLabel(){const m=lgMins();return (m?m+' MIN · TO ':'FIRST TO ')+lgGoalCap()+(LG&&LG.special?' · SPECIALS':'')+(LG&&LG.power?' · POWER-UPS':'');}
/* The league lobby and the cup lobby both put the four rules on screen, so the seed/bind pair
   lives here ONCE against an id map rather than being written twice. They are ONE value on the
   save, not two screens' settings: change the clock in the cup and the league lobby shows it on
   its next render. Element ids can't be shared (both panels are in the DOM at the same time),
   which is the only reason these take a map at all. */
const LG_RULE_IDS={goals:'lgGoals',time:'lgGameTime',special:'lgSpecial',power:'lgPower'};
const CUP_RULE_IDS={goals:'cupGoals',time:'cupGameTime',special:'cupSpecial',power:'cupPower'};
function seedRuleCtls(ids){
 $(ids.goals).value=String(lgGoalCap());
 $(ids.time).value=String(lgMins());
 $(ids.special).checked=!!(LG&&LG.special);
 $(ids.power).checked=!!(LG&&LG.power);
}
// Writers go to LG, never to cfg — cfg is the quick-match preference and must survive a league
// untouched (lgPlayMatch/cupPlayTie push these onto cfg at kickoff, flow.js restores them after).
function bindRuleCtls(ids){
 $(ids.goals).onchange=e=>{if(LG){LG.goals=+e.target.value;saveLG();}Au.ui();};
 $(ids.time).onchange=e=>{if(LG){LG.gameTime=+e.target.value;saveLG();}Au.ui();};
 $(ids.special).onchange=e=>{if(LG){LG.special=e.target.checked;saveLG();}Au.ui();};
 $(ids.power).onchange=e=>{if(LG){LG.power=e.target.checked;saveLG();}Au.ui();};
}
function goalTarget(){return S.lg?lgGoalCap():cfg.goals;}
// Match time limit in SECONDS (0 = unlimited). Quick/AI matches read cfg.gameTime; league AND cup
// matches read the save's own LG.gameTime.
function gameTimeLimit(){return (S.lg?lgMins():(cfg.gameTime||0))*60;}
function teamDiff(t){return S.lg?(S.lg.diff||LGC.baseDiff):(t===0?(cfg.diffRed||cfg.diff):(cfg.diffBlue||cfg.diff));} // league: builds are layered on baseDiff (per-division override via S.lg.diff)
/* Pre-warm the shatter GLBs for the two figurines in the player's NEXT league/cup match while the
   player is still sitting in the lobby, so the first cannonball kill of the match is a clone()+play()
   with no disk-load or shader-compile stall. Quick/AI matches are covered because main.js primes the
   default red/blue at boot AND startMatch primes activeModel(0/1) — but a LEAGUE opponent's figurine
   is rarely one of those, so its shatter only started loading at startMatch (hence the first-kill lag).
   This does the same ensureExplosionModel prime earlier: it loads + shader-warms off the game loop and
   no-ops if already resident, so the later startMatch prime becomes a no-op. No pruning here — startMatch
   still bounds residency to the two teams actually on the table; this only pulls them in ahead of time.
   Guarded so a build without fracture fx / with the fn absent is a clean skip. Pass figurine model IDS
   (t.model / cupEnt().model), NOT team indices — cfg.modelRed/Blue aren't swapped to the league teams
   until lgPlayMatch, so activeModel() would read the wrong (menu) figurines here. */
function primeMatchExplosions(idA,idB){
 if(typeof ensureExplosionModel!=='function')return;
 for(const id of [idA,idB])if(id)ensureExplosionModel(id);
}
/* Same idea, for the pre-match tape's FIGURINE PORTRAITS (assets/renders/render_*_cycles.png).
   Those were only ever requested at the instant #lgTape was revealed — renderLgTape builds them as
   raw <img src> inside an innerHTML string — so on a cold cache the portrait streamed in top-to-
   bottom over the splash screen it is supposed to BE. They're big PNGs into a fixed 600x700 box,
   which is why it reads as a swipe rather than as a delay. The lobby is where the player actually
   sits, so the fetch belongs there, next to primeMatchExplosions.
   NOTE the scout panel's portrait does NOT cover this: mugImg loads render_*_MUGSHOT.png, a
   different file, so the tape's render was always cold no matter how long you sat in the lobby.
   Images are HELD in TAPE_IMG rather than fired and forgotten — a live reference keeps the decoded
   bitmap around, so the tape's own <img> paints from cache with no second decode. Kept to the two
   figurines of the NEXT match only: each decoded portrait is several MB, and a season's worth of
   past opponents accruing in a map would be a slow leak. Re-entering the lobby re-issues nothing.
   The team-part MASKS are primed on the same pass. They're tiny next to the portraits, but they
   arrive as a CSS mask-image on a layer stacked over the render, so a late mask would show as the
   portrait painting untinted and then popping to the team colour — worse than the swipe this
   function exists to kill. Priming them here means both are warm before the tape is ever revealed.
   Which masks exist is settled by MASK_STEMS before anything is requested, so this never fetches a
   file that isn't there. An earlier version probed instead — request the mask, let a 404 report
   its absence — which degraded correctly but logged a console error per un-exported figurine on
   every lobby visit, and console errors in a shipping build read as a broken game.
   Pass figurine model IDS, same as primeMatchExplosions. */
let TAPE_IMG={};
function primeMatchTape(idA,idB){
 const keep={};
 for(const id of [idA,idB]){
  // modelRenderMask returns null unless MASK_STEMS says the file is there, so nothing here can
  // request a mask that doesn't exist — no 404, no probe, no console noise.
  for(const src of [id&&modelRender(id),id&&modelRenderMask(id)]){
   if(!src||keep[src])continue;
   if(TAPE_IMG[src]){keep[src]=TAPE_IMG[src];continue;}
   const im=new Image();im.src=src;keep[src]=im;
  }
 }
 TAPE_IMG=keep;                                       // anything not in the next match is dropped
}
/* Hold the tape up for LGC.tapeT AFTER its portraits can paint, not from the moment it's revealed.
   Without this the dwell was spent watching the PNG arrive and then cut to kickoff at the exact
   moment the screen finally looked right. decode() resolves when the bitmap is ready to paint
   (and rejects on a broken image — caught, so a missing render is a clean skip); tapeReadyCap is a
   hard ceiling so nothing here can ever stall a match start.
   Returns a CANCEL fn, and the click-to-skip path must call it: it has to kill BOTH timers and
   disarm the pending decode handler, or a skipped tape re-fires go() a beat later against whatever
   screen came next. */
function tapeDwell(cb){
 let t1=0,t2=0,armed=false;
 const arm=()=>{if(armed)return;armed=true;clearTimeout(t2);t1=setTimeout(cb,LGC.tapeT*1000);};
 const cap=(LGC.tapeReadyCap||0)*1000;
 if(cap>0){
  t2=setTimeout(arm,cap);
  // The portraits are in the DOM as <img>; the masks are not (they're CSS mask-image on the tint
  // layer, which exposes no load event), so we wait on the primed Image objects standing in for
  // them. Both have to be ready or the dwell starts on a portrait that's about to change colour.
  const imgs=[].slice.call($('lgTapeBody').querySelectorAll('.lgFigImg'))
              .concat(Object.keys(TAPE_IMG).map(k=>TAPE_IMG[k]));
  Promise.all(imgs.map(im=>im&&im.decode?im.decode().catch(()=>0):0)).then(arm,arm);
 }else arm();
 return ()=>{clearTimeout(t1);clearTimeout(t2);armed=true;};
}
/* The tape's figurine card. renderLgTape and renderCupTape read different data (LG.teams vs cup
   entrants) but draw the SAME card, and it was copy-pasted between them — so the tint layer would
   have had to be added twice and kept in sync twice. One builder, two callers.
   The tint is a layer stacked OVER the portrait, masked to the team parts and composited in
   `color` blend mode: hue and saturation come from the team colour, luminance stays the render's.
   That's what keeps the Cycles lighting — the specular hits, the ambient occlusion in the folds,
   the bounce — instead of flooding the kit with flat colour the way a straight overlay would.
   `flip` has to be carried onto the tint as well as the portrait, or the mask lands on the mirrored
   figurine's other side.
   MASK-IMAGE IS SET INLINE, NOT VIA A CUSTOM PROPERTY. This looks like the uglier option and is
   the only correct one: a relative url() inside a CSS variable is resolved against the stylesheet
   that CONSUMES it, not the document. `--mask:url(assets/renders/x.png)` read by a rule in
   css/styles.css therefore requested css/assets/renders/x.png — a folder that does not exist — so
   every mask 404'd and no figurine ever tinted. An inline mask-image resolves against the document
   like the <img> beside it does. The sizing/repeat/position half of the mask stays in the
   stylesheet; only the URL has to live here. */
function tapeFig(col,src,mask,flip,name){
 const f=flip?' flip':'';
 if(!src)return '<div class="lgTapeFig" style="--tc:'+col+'"><div class="lgFigBox lgFigEmpty">?</div>'+
                '<div class="lgFigCap">'+name+'</div></div>';
 const tint=mask?'<div class="lgFigTint'+f+'" style="-webkit-mask-image:url('+mask+
                 ');mask-image:url('+mask+')"></div>':'';
 return '<div class="lgTapeFig" style="--tc:'+col+'">'+
   '<div class="lgFigBox">'+
    '<img src="'+src+'" class="lgFigImg'+f+'" alt="'+name+'">'+
    tint+
   '</div>'+
   '<div class="lgFigCap">'+name+'</div>'+
  '</div>';
}
function renderLgTape(op){
 const T=LG.teams,me=T[LG.playerId],them=T[op];
 const mo=CONFIG.playerModel.models.find(x=>x.id===me.model);
 const to=CONFIG.playerModel.models.find(x=>x.id===them.model);
 const offA=lgOff(me.bld),defA=lgDef(me.bld),offB=lgOff(them.bld),defB=lgDef(them.bld);
 const bar=(label,val,cls)=>'<div class="lgRateBar"><span class="'+cls+'">'+label+'</span><div class="lgRate"><div class="'+cls+'" style="width:'+(val/10*100|0)+'%"></div></div><span class="num">'+(val*10|0)/10+'</span></div>';
 const rA=modelRender(me.model),rB=modelRender(them.model);
 const kA=modelRenderMask(me.model),kB=modelRenderMask(them.model);
 // the caption used to be prefixed with the figurine's emoji ico — pointless beside an actual
 // render of that same figurine, and it was '🤖' on half the roster and '🏃' on the rest.
 // Card markup lives in tapeFig() so the cup tape draws an identical one from its own data.
 const teamCard=(col,name,off,def,figHtml)=>
  '<div class="lgTapeTeam"><h2 style="color:'+col+'">'+name+'</h2>'+figHtml+bar('DEF',def,'def')+bar('OFF',off,'off')+'</div>';
 $('lgTapeBody').innerHTML=
  teamCard(me.col,me.name,offA,defA,tapeFig(me.col,rA,kA,false,mo?mo.name:'?'))+
  '<div class="lgTapeVs"><span>VS</span></div>'+
  teamCard(them.col,them.name,offB,defB,tapeFig(them.col,rB,kB,true,to?to.name:'?'));
 $('lgTapeRound').textContent='ROUND '+(LG.round+1)+' / '+LG.divs[playerDiv()].fixtures.length;
}
function lgPlayMatch(){
 const fx=lgPlayerFixture();if(!fx)return;
 const pid=LG.playerId,op=fx[0]===pid?fx[1]:fx[0],T=LG.teams;
 S.teamStats=[T[pid].bld,T[op].bld];
 const pdConf=LGC.divisions[playerDiv()];              // this division's brain difficulty (falls back to baseDiff)
 // prevKit is KIT ONLY. The venue (table+skin+room+pitch) belongs to the league SESSION now — it
 // went on when the lobby opened and comes off when you leave league land (lgVenueEnter/Exit), so
 // the match neither swaps it in nor hands it back. Putting it here is what made every round load
 // the player's room on the way out and the division's room on the way back in.
 S.lg={op,diff:(pdConf&&pdConf.diff)||LGC.baseDiff,names:[T[pid].name,T[op].name],cols:[T[pid].col,T[op].col],rec:false,
        prevKit:{redColor:cfg.redColor,blueColor:cfg.blueColor,modelRed:cfg.modelRed,modelBlue:cfg.modelBlue,special:cfg.special,power:cfg.power}};
 const sel=$('lgControl').value;
 $('league').classList.add('hidden');
 cfg.redColor=T[pid].col;cfg.modelRed=T[pid].model;cfg.blueColor=T[op].col;cfg.modelBlue=T[op].model;cfg.special=LG.special;cfg.power=LG.power;
   document.documentElement.style.setProperty('--c0',cfg.redColor);
   document.documentElement.style.setProperty('--c1',cfg.blueColor);
  const start=()=>{S.lg.matchStart=S.time;rebuildRodMen();applyColors();startMatch(sel==='watch'?'ai':'red',sel&&sel!=='watch'?sel:null);};
 // The venue is normally already resident (openLeague applied it), so this resolves SYNCHRONOUSLY
 // and the tape is pure showpiece. It stays a GATE because table assets are lazy: a division can
 // force a table the player has never opened, and Play can be clicked before the lobby's fetch has
 // landed. The tape screen (or the brief hidden beat when tape is off) IS the loading room.
 let tapeDone=!LGC.tape,modelDone=false,venueDone=false;
 const check=()=>{if(!(tapeDone&&modelDone&&venueDone))return;$('lgTape').classList.add('hidden');start();};
 lgVenueEnter(lgDivVenue(playerDiv()),()=>{venueDone=true;check();});
 loadPlayerModel(()=>{modelDone=true;check();});
 if(LGC.tape){
  renderLgTape(op);
  $('lgTape').classList.remove('hidden');
  const go=()=>{tapeDone=true;check();};
  const cancel=tapeDwell(go);            // dwell starts once the portraits can paint (see tapeDwell)
  $('lgTape').onclick=()=>{cancel();go();};
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
   if(!LG.seasonEnd)lgFinalize(); // freeze promotion/relegation + apply player's relegation penalty now
  }
 for(let t=0;t<3;t++){
  const newRank=lgOrderDiv(t).map(e=>e.i);
  for(let i=0;i<newRank.length;i++){const ti=newRank[i];LG.teams[ti].rankD=prevRanks[t].indexOf(ti)-i;}
 }
 saveLG();
}
function lgReturn(){$('lgSeasonEnd').classList.add('hidden');if(LG&&LG.seasonEnd){LG.seasonEnd.shown=true;saveLG();}gotoMenu();openLeague(true);} // win screen → lobby (gotoMenu clears S.lg/S.teamStats; hide the season-end overlay + mark shown so openLeague doesn't re-pop it)
/* ---- end-of-season summary (plays after the final match, before the lobby) ---- */
function lgFinalize(){ // freeze final standings + promotion/relegation + apply player's relegation penalty
  const orders=[lgOrderDiv(0),lgOrderDiv(1),lgOrderDiv(2)];
  const promotedIds=[[],[]],relegatedIds=[[],[]];
  for(let t=0;t<2;t++)promotedIds[t]=orders[t].slice(0,LGC.promoteN).map(e=>e.i);
  for(let t=0;t<2;t++)relegatedIds[t]=orders[t+1].slice(-LGC.relegateN).map(e=>e.i);
  const divs=[];
  for(let t=0;t<3;t++){
   const promotedSet=new Set(t<2?promotedIds[t]:[]);   // top of this div → up
   const dropSet=new Set(t>0?relegatedIds[t-1]:[]);     // bottom of this div → down
   const champ=orders[t][0];
   divs.push({name:LGC.divisions[t].name,tier:t,champ:champ.t.name,champId:champ.i,
    order:orders[t].map((e,pi)=>({i:e.i,name:e.t.name,col:e.t.col,w:e.t.w,l:e.t.l,gf:e.t.gf,ga:e.t.ga,p:e.t.p,
     promoted:promotedSet.has(e.i),relegated:dropSet.has(e.i)}))});
  }
  const oldPd=playerDiv();
  const pOrder=orders[oldPd];
  const pPos=pOrder.findIndex(e=>e.i===LG.playerId)+1;
  const pPromoted=oldPd<2&&promotedIds[oldPd].includes(LG.playerId);
  const pRelegated=oldPd>0&&relegatedIds[oldPd-1].includes(LG.playerId);
   const pChamp=oldPd===2&&orders[2][0].i===LG.playerId;
   const pCup=oldPd===2&&pPos<=2; // Premier top 2 qualify for the Champions Cup
   const fate=pChamp?'champion':pPromoted?'promoted':pRelegated?'relegated':'stayed';
  // Apply the player's stat change NOW (before lgNewSeason swaps divisions) so the lobby squad
  // already reflects it; lgNewSeason skips the player for the same reason.
  let playerLosses=[],playerGains=[];
  if(pRelegated)playerLosses=lgRelegatePenalty(LG.teams[LG.playerId]);
  else if(pPromoted)playerGains=lgPromoteBoost(LG.teams[LG.playerId],pPos-1);
   LG.seasonEnd={season:LG.season,playerFate:fate,playerPos:pPos,playerDiv:oldPd,cupQualified:pCup,divs,playerLosses,playerGains,shown:false};
  saveLG();
}
function lgSeasonEarn(){
  const pd=playerDiv(),dv=LG.divs[pd],pid=LG.playerId;
  let w=0,l=0,gf=0,ga=0,cs=0;
  for(let r=0;r<dv.results.length;r++){
   const fix=dv.fixtures[r],res=dv.results[r];
   for(let i=0;i<fix.length;i++){
    if(fix[i][0]===pid||fix[i][1]===pid){
     const home=fix[i][0]===pid,sc=res[i];
     const my=home?sc[0]:sc[1],opp=home?sc[1]:sc[0];
     gf+=my;ga+=opp;
     if(my>opp){w++;if(opp===0)cs++;}else l++;
    }
   }
  }
  const se=LG.seasonEnd;
  const promoteBonus=se.playerFate==='promoted'?(se.playerPos===1?LGC.upPromote1:LGC.upPromote2):0;
  const champBonus=se.playerFate==='champion'?LGC.upChampTop:0;
  const earned=w*LGC.upWin+l*LGC.upLoss+cs*LGC.upCleanSheet+promoteBonus+champBonus;
  const pid2=LG.playerId;
  return {w,l,gf,ga,cs,earned,promoteBonus,champBonus,avail:LG.teams[pid2].up,
   titles:LG.hist.filter(e=>((e.divChamps?e.divChamps[2]:null)||e.champ)===LG.teams[pid2].name).length};
}
function lgSEDivCard(d){
  let rows='';
  d.order.forEach((e,pi)=>{
   let cls='lgSERow';
   if(e.i===LG.playerId)cls+=' me';
   if(e.promoted)cls+=' pro';
   if(e.relegated)cls+=' rel';
   const mark=e.promoted?'<span class="lgSEUp">▲</span>':e.relegated?'<span class="lgSEDn">▼</span>':'<span class="lgSEBlank"></span>';
   rows+='<div class="'+cls+'">'+mark+
    '<span class="pos">'+(pi+1)+'</span>'+
    '<span class="nm"><i class="dot" style="background:'+e.col+'"></i>'+e.name+'</span>'+
    '<span class="num">'+e.w+'</span><span class="num">'+e.l+'</span>'+
    '<span class="num">'+e.gf+'</span><span class="num">'+e.ga+'</span>'+
    '<span class="num pts">'+e.p+'</span></div>';
  });
  return '<div class="lgSEDiv">'+
   '<div class="lgSEDivHead">'+d.name+'</div>'+
   '<div class="lgSEChamp">'+ico('trophy','icoInline')+' '+d.champ+'</div>'+
   '<div class="lgSEHead"><span></span><span>#</span><span>TEAM</span><span>W</span><span>L</span><span>GF</span><span>GA</span><span>PTS</span></div>'+
   rows+'</div>';
}
function lgSEFate(se){
  const map={
   champion:['champ',ico('trophy','icoInline')+'CHAMPIONS','#ffcf4d'],   // .lgSEFateLab's gap is the separator
   promoted:['pro','▲ PROMOTED','#7dff8a'],
   relegated:['rel','▼ RELEGATED','#ff4d5a'],
   stayed:['stay','STAYED IN '+LGC.divisions[se.playerDiv].name,'#93a5c6']
  };
  const m=map[se.playerFate];
  const posTxt=se.playerFate==='champion'?'FINISHED #1':'FINISHED #'+se.playerPos;
  // the label MUST be wrapped: .lgSEFate is a COLUMN flex container, so the trophy <span> and the
  // bare ' CHAMPIONS' text node would each become their own flex item and stack on separate rows.
  // (It only worked before because the emoji made the whole label one text node.)
  return '<div class="lgSEFate '+m[0]+'" style="--fc:'+m[2]+'"><span class="lgSEFateLab">'+m[1]+'</span>'+
   '<span class="lgSEPos">'+posTxt+'</span></div>';
}
function lgSERewards(r,se){
  let h='<div class="lgSEPanelHead">SEASON REWARDS</div>'+
   '<div class="lgSERewGrid">'+
    '<div class="lgSERew"><span class="k">RECORD</span><span class="v">'+r.w+'–'+r.l+'</span><span class="sub">'+r.gf+' GF · '+r.ga+' GA</span></div>'+
    '<div class="lgSERew"><span class="k">PARTS EARNED</span><span class="v gold">+'+r.earned+' '+ico('cog','icoInline')+'</span><span class="sub">'+r.w+'W · '+r.l+'L · '+r.cs+' CS</span></div>'+
    '<div class="lgSERew"><span class="k">AVAILABLE</span><span class="v">'+r.avail+' '+ico('cog','icoInline')+'</span><span class="sub">spend in squad</span></div>'+
    '<div class="lgSERew"><span class="k">TITLES</span><span class="v">'+r.titles+'×</span><span class="sub">Premier wins</span></div>'+
   '</div>';
   if(se.cupQualified==null?se.playerFate==='champion':se.cupQualified)
    h+='<div class="lgSECup">'+ico('trophy','icoInline')+' QUALIFIED FOR THE CHAMPIONS CUP</div>'+
       '<button class="btn gold lgSEEnterCup" id="lgSEEnterCup">ENTER CHAMPIONS CUP</button>';
  return '<div class="lgSEPanel">'+h+'</div>';
}
function lgSELoss(se){
  if(se.playerFate!=='relegated'||!se.playerLosses.length)return '';
  const bld=LG.teams[LG.playerId].bld;
  let h='<div class="lgSEPanel"><div class="lgSEPanelHead rel">▼ RELEGATION — STATS LOST</div>';
  for(const role of LG_ROLES){
   h+='<div class="lgSERole"><span class="lgSERoleH">'+role+'</span>';
   for(const k of LG_KEYS){
    const v=bld[role][k];
    const lost=se.playerLosses.find(x=>x.role===role&&x.key===k);
    const before=lost?lost.from:v,after=v;
    let pips='';
    for(let i=0;i<STC.max;i++){
     if(i<after)pips+='<b class="on">▮</b>';
     else if(i<before)pips+='<b class="lost">▯</b>'; // the removed pip
     else pips+='<b>▯</b>';
    }
    h+='<div class="lgSEStat"><span class="sN">'+k.toUpperCase()+'</span><span class="pips">'+pips+'</span>'+
     (lost?'<span class="lgSEMinus">–1</span>':'')+'</div>';
   }
   h+='</div>';
  }
  h+='</div>';
  return h;
}
function lgSEGain(se){
  if(se.playerFate!=='promoted'||!se.playerGains||!se.playerGains.length)return '';
  const bld=LG.teams[LG.playerId].bld;
  let h='<div class="lgSEPanel"><div class="lgSEPanelHead pro">▲ PROMOTION — STAT FLOOR RAISED</div>';
  for(const role of LG_ROLES){
   h+='<div class="lgSERole"><span class="lgSERoleH">'+role+'</span>';
   for(const k of LG_KEYS){
    const v=bld[role][k];
    const gain=se.playerGains.find(x=>x.role===role&&x.key===k);
    const before=gain?gain.from:v,after=v;
    let pips='';
    for(let i=0;i<STC.max;i++){
     if(i<before)pips+='<b class="on">▮</b>';
     else if(i<after)pips+='<b class="gain">▮</b>'; // the added pip(s)
     else pips+='<b>▯</b>';
    }
    h+='<div class="lgSEStat"><span class="sN">'+k.toUpperCase()+'</span><span class="pips">'+pips+'</span>'+
     (gain?'<span class="lgSEPlus">+'+(gain.to-gain.from)+'</span>':'')+'</div>';
   }
   h+='</div>';
  }
  h+='</div>';
  return h;
}
function renderLgSeasonEnd(){
  const se=LG.seasonEnd;if(!se)return;
  const r=lgSeasonEarn();
  let divs='';for(const d of se.divs)divs+=lgSEDivCard(d);
  $('lgSEBody').innerHTML=
   '<div class="lgSETitle">'+LG.name+'</div>'+
   '<div class="lgSESub">SEASON '+se.season+' · COMPLETE</div>'+
   lgSEFate(se)+
   '<div class="lgSEDivs">'+divs+'</div>'+
   lgSERewards(r,se)+
   lgSELoss(se)+
   lgSEGain(se);
  if(se.cupQualified==null?se.playerFate==='champion':se.cupQualified){ // wire the Enter Cup button (created in lgSERewards)
    const b=$('lgSEEnterCup');
    // cupLive, NOT cupValid: a FINISHED bracket from an earlier championship is still "valid", so
    // the old test meant the second cup was never drawn — this button re-opened last season's.
    if(b)b.onclick=()=>{if(!cupLive())cupCreate();openCup();};
  }
}
function showSeasonEnd(){
  $('win').classList.add('hidden');
  $('league').classList.add('hidden');
  $('lgSeasonEnd').classList.remove('hidden');
  renderLgSeasonEnd();
  confetti(0);
  S.lgChampDone=true; // don't also fire lobby confetti
}
function lgWinContinue(){
  if(S.lg&&S.lg.cup){openCup();return;} // finished a cup tie → show the updated bracket
  if(LG&&LG.seasonEnd&&!LG.seasonEnd.shown){
    LG.seasonEnd.shown=true;saveLG();
    showSeasonEnd();
  }else lgReturn();
}
/* ---- scout panel ---- */
function renderLgScout(ti){
 const t=LG.teams[ti];
 $('lgScoutName').textContent=t.name;$('lgScoutName').style.color=t.col;
 const form=lgTeamForm(ti);
 let fh='';for(const c of form)fh+='<span class="'+(c==='W'?'lgW':'lgL')+'">'+c+'</span>';
 const off=lgOff(t.bld),def=lgDef(t.bld);
 $('lgScoutRec').innerHTML='<span style="color:'+t.col+';font-weight:700">'+t.w+'-'+t.l+'</span>'+
  ' · GF '+t.gf+' · GA '+t.ga+' · <span style="color:var(--gold);font-weight:700">'+t.p+'pts</span>'+
  '<span style="margin-left:12px">'+fh+'</span>';
 const m=CONFIG.playerModel.models.find(x=>x.id===t.model);
 $('lgScoutBody').innerHTML=
  (m?'<div class="figName"><span class="figMug">'+ico('figure','icoInline')+'</span>'+m.name+'</div><div style="height:4px"></div>':'')+
  '<div class="lgRateBar"><span class="def">DEF</span><div class="lgRate"><div class="def" style="width:'+(def/10*100|0)+'%"></div></div><span class="num">'+(def*10|0)/10+'</span></div>'+
   '<div class="lgRateBar"><span class="off">OFF</span><div class="lgRate"><div class="off" style="width:'+(off/10*100|0)+'%"></div></div><span class="num">'+(off*10|0)/10+'</span></div>'+
  lgBuildHTML(t.bld,false);
 // portrait goes on AFTER the innerHTML build — .figMug holds the fallback figure mark and
 // mugImg overlays the render on top of it if this figurine has one (core.js).
 if(m)mugImg(m,$('lgScoutBody').querySelector('.figMug'),'figMugImg','hasMug');
 $('lgScout').classList.remove('hidden');
}
function renderLgHist(){
 if(!LG.hist||!LG.hist.length){$('lgHistPanel').classList.add('hidden');return;}
 $('lgHistPanel').classList.remove('hidden');
  const playerName=LG.teams[LG.playerId].name;
  const titles=LG.hist.filter(e=>((e.divChamps?e.divChamps[2]:null)||e.champ)===playerName).length;
   // cupTitles was incremented on every cup win and then read by nothing at all — the only trace of
   // a Champions Cup anywhere in the lobby was a trophy glyph on one history row.
   const cups=LG.cupTitles||0;
   $('lgTitles').textContent=(titles?'· '+titles+'x Premier Champion':'')+(cups?(titles?' · ':'· ')+cups+'x Cup Winner':'');
   let h='<div class="row head"><span>Season</span><span>Division</span><span>Pos</span></div>';
   for(let i=LG.hist.length-1;i>=0;i--){
    const e=LG.hist[i];
    const pos=e.playerPos?e.playerPos+({1:'st',2:'nd',3:'rd'}[e.playerPos]||'th'):'—';
    h+='<div class="row"><span>S'+e.season+(e.cup===playerName?' '+ico('trophy','icoInline gold'):'')+'</span><span>'+(e.playerDiv||'')+'</span><span>'+pos+'</span></div>';
   }
 $('lgHist').innerHTML=h;
}
/* ---- lobby UI ---- */
function openLeague(reveal){
 if(!LG){LG={slot:0,name:'LEAGUE 1'};lgNewSeason(false,null,0);}
  showScreen('league');   // hides menu/lgSlots + applies the saved panel arrangement (js/screens.js → layApply)
  // THE LOBBY IS THE DIVISION'S VENUE. Applied on the way in, not at kickoff — so the table/room
  // behind the panels is where the next fixture is played, and a season is one asset swap instead
  // of one per round. Must sit ABOVE the season-end return: it also cancels the restore that the
  // screen change above (or gotoMenu, on the way back from a match) just scheduled.
  lgVenueEnter(lgDivVenue(playerDiv()));
  if(LG.seasonEnd&&!LG.seasonEnd.shown){showSeasonEnd();return;} // a season just finished — show the summary first
  const pd=playerDiv(),dv=LG.divs[pd];
 if(dv.champ&&!S.lgChampDone){confetti(0);Au.goal();S.lgChampDone=true;}
 renderLeague(reveal);
 const fx=lgPlayerFixture();
 if(fx){const op=fx[0]===LG.playerId?fx[1]:fx[0];
  renderLgScout(op);
  primeMatchExplosions(LG.teams[LG.playerId].model,LG.teams[op].model); // warm both shatters now, while in the lobby
  primeMatchTape(LG.teams[LG.playerId].model,LG.teams[op].model);       // and both tape portraits, so the splash paints whole
 }
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
  // Resume an in-progress cup, or review the one just decided. Both are THIS season's only — a cup
  // stops being reachable at rollover, which is also what frees the slot for the next one.
  $('lgCup').classList.toggle('hidden',!cupCurrent());
  $('lgCup').textContent=cupLive()?'Champions Cup':'Cup Result';
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
 $('lgSettingsPanel').classList.toggle('hidden',done); // no match to configure once a division is complete
 // The save's four match rules, seeded from LG so they survive a reload. Editable per round —
 // and the cup reads the SAME values, so changing one here changes the final too.
 seedRuleCtls(LG_RULE_IDS);
 $('lgControl').value=LG.control||''; // seed from the save's default so it survives reloads
 $('lgPlay').classList.toggle('hidden',done);
 $('lgControlRow').classList.toggle('hidden',done);
 if(done){
  const isPlayer=dv.champ===T[pid].name;
  $('lgFixture').innerHTML=ico('trophy','icoInline')+' <span style="color:'+(isPlayer?T[pid].col:'var(--gold)')+';font-size:18px">'+(isPlayer?'YOU ARE THE CHAMPION':dv.champ+' TAKE THE TITLE')+'</span>';
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
/* Squad + upgrade spend, hosted by BOTH lobbies now (league and cup) off the same
   LG.teams[playerId] block — hence the host ids and the `again` re-render callback. Parts were
   never a per-mode currency: winning a cup tie pays `CUP.tieParts` into the same pool the league
   pays into, and the cup screen used to show you neither the pool nor a way to spend it.
   Spending mid-cup lands IMMEDIATELY on the table — cupEnt('player') reads the live `bld`, so an
   upgrade bought here is in the tie you start next. */
function renderSquadInto(squadId,upId,again){
 const t=LG.teams[LG.playerId];
 $(upId).textContent=t.up;
 $(squadId).innerHTML=lgBuildHTML(t.bld,true);
 $(squadId).querySelectorAll('.sPlus').forEach(b=>{
  const k=b.dataset.k,r=b.dataset.r,st=t.bld[r],v=st[k],cost=lgCost(v);
  b.textContent=v>=STC.max?'':'+'+cost;
  b.disabled=t.up<cost||v>=STC.max;
  b.onclick=()=>{
   if(t.up<cost||v>=STC.max)return;
    st[k]++;t.up-=cost;saveLG();Au.power();again();
  };
 });
}
function renderLgSquad(){renderSquadInto('lgSquad','lgUP',renderLgSquad);}
function renderCupSquad(){renderSquadInto('cupSquad','cupUP',renderCupSquad);}
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
 showScreen('lgSlots');
 renderSlots();
}
/* ---- setup form ---- */
/* ---- 3D figurine preview for setup form ---- */
// Renders through the SHARED preview context (PRV, world.js) into #lgSetupFig as a plain 2D
// canvas. The old dedicated renderer needed preserveDrawingBuffer because it drew straight to a
// visible canvas once per interaction with no rAF loop; blitting to 2D removes that need — the
// destination canvas holds the pixels and the compositor won't clear them.
let LSP={ready:false,W:200,H:260,dpr:1,scene:null,cam:null,root:null,m:null,mats:[],rim:null,ringM:null,plat:null,lid:null,bs:1,
 init(){
  if(this.ready)return;
  this.dpr=Math.min(devicePixelRatio,2);
  this.scene=new THREE.Scene();
  this.scene.add(new THREE.HemisphereLight(0xcdd9ff,0x141018,.95));
  const k=new THREE.DirectionalLight(0xffffff,1.2);k.position.set(5,11,7);this.scene.add(k);
  this.rim=new THREE.PointLight(0xffffff,1.3,50);this.rim.position.set(-4,4,-5);this.scene.add(this.rim);
  this.cam=new THREE.PerspectiveCamera(36,this.W/this.H,.1,200);
  this.cam.position.set(0,2.0,8.5);this.cam.lookAt(0,1.65,0);
  this.root=new THREE.Group();this.scene.add(this.root);
  const ring=new THREE.Mesh(new THREE.RingGeometry(3.1,3.45,64),
   new THREE.MeshBasicMaterial({color:0x5a8cff,transparent:true,opacity:.45,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.05;this.scene.add(ring);this.ringM=ring;
  const plat=new THREE.Mesh(new THREE.CylinderGeometry(2.8,3.1,.3,48),
   new THREE.MeshStandardMaterial({color:0x0c1020,emissive:0x1a2540,emissiveIntensity:.5,roughness:.35,metalness:.7}));
  plat.position.y=-.2;this.scene.add(plat);this.plat=plat;
  this.ready=true;
 },
 load(modelId,col){
  this.init();
  const am=CONFIG.playerModel.models.find(m=>m.id===modelId)||CONFIG.playerModel.models[0];
  if(this.lid!==am.id){
   if(this.m){this.root.remove(this.m);this.m=null;this.mats=[];}
   const place=src=>{
    const g=src.clone(true);
    let box=new THREE.Box3().setFromObject(g),size=new THREE.Vector3();box.getSize(size);
    this.bs=3.4/(size.y||1);g.scale.setScalar(this.bs*tmScale(0));
    box=new THREE.Box3().setFromObject(g);const ctr=new THREE.Vector3();box.getCenter(ctr);
    g.position.x-=ctr.x;g.position.z-=ctr.z;g.position.y-=box.min.y;
    const tp=new Set(am.teamParts.map(s=>s.toLowerCase()));
    this.mats=[];g.traverse(ch=>{if(!ch.isMesh)return;const cm=ch.material.clone();ch.material=cm;if(tp.has(cm.name.toLowerCase()))this.mats.push(cm);});
    this.m=g;this.lid=am.id;this.root.add(g);this.root.rotation.y=cfg.redYaw||0;
    this.paint(col);
   };
   const cached=typeof PV!=='undefined'&&PV.cache&&PV.cache[am.id];
   if(cached){if(typeof touchModelCache==='function')touchModelCache(PV.cacheOrder,am.id);place(cached);return;}
   new THREE.GLTFLoader().load(am.src,gltf=>{
    if(typeof pvCachePut==='function')pvCachePut(am.id,gltf.scene);
    else if(typeof PV!=='undefined'&&PV.cache)PV.cache[am.id]=gltf.scene;
    place(gltf.scene);
   },undefined,()=>{
    const fb=typeof pvFallback==='function'?pvFallback():new THREE.Group();
    if(typeof pvCachePut==='function')pvCachePut(am.id,fb);
    else if(typeof PV!=='undefined'&&PV.cache)PV.cache[am.id]=fb;
    place(fb);
   });
  }else{this.paint(col);}
 },
 paint(col){
  const c=new THREE.Color(col);
  this.mats.forEach(m=>{m.color.copy(c);applyTeamFinish(m,0,c,false);});
  if(this.rim)this.rim.color.copy(c);
  if(this.ringM)this.ringM.material.color.copy(c);
  if(this.plat)this.plat.material.emissive.copy(c).multiplyScalar(.28);
  PRV.draw(this.scene,this.cam,$('lgSetupFig'),this.W,this.H,this.dpr);
 }
};
function openSetup(slot){
 showScreen('lgSetup');
 $('lgSetupLgName').value='LEAGUE '+(slot+1);
 $('lgSetupName').value=cfg.redName||'RED';
 $('lgSetupLgName').maxLength=$('lgSetupName').maxLength=CONFIG.control.nameMaxLength;
 $('lgSetupColor').value=cfg.redColor;
 $('lgSetupHex').textContent=cfg.redColor;
 // Match rules seed from the quick-match prefs — the numbers the player already knows they like —
 // then belong to the SAVE from here on (lgGoalCap/lgMins), cup ties included.
 $('lgSetupGoals').value=String(cfg.goals||LGC.goals);
 $('lgSetupGameTime').value=String(cfg.gameTime||0);
 $('lgSetupSpecial').checked=cfg.special;
 $('lgSetupPower').checked=cfg.power;
 $('lgSetupControl').value=(LG&&LG.control)||''; // default rod control baked into this save (still overridable in the lobby)
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
  const b=document.createElement('button');b.className='miniBtn';b.dataset.id=m.id;b.textContent=m.name;
  b.onclick=()=>{
   models.querySelectorAll('.miniBtn').forEach(x=>x.classList.remove('on'));b.classList.add('on');
   LSP.load(m.id,$('lgSetupColor').value);
  };
  models.appendChild(b);
 });
 const cur=cfg.modelRed;models.querySelectorAll('.miniBtn').forEach(b=>{if(b.dataset.id===cur)b.classList.add('on');});
 $('lgSetupColor').oninput=e=>{$('lgSetupHex').textContent=e.target.value;LSP.paint(e.target.value);};
 $('lgSetupCancel').onclick=()=>showScreen('lgSlots');
 $('lgSetupCreate').onclick=()=>{
  const selModel=models.querySelector('.miniBtn.on');
  const opts={
   name:$('lgSetupLgName').value.trim().toUpperCase()||'LEAGUE '+(slot+1),
   teamName:($('lgSetupName').value||'YOU').toUpperCase(),
   teamCol:$('lgSetupColor').value,
   model:selModel?selModel.dataset.id:cfg.modelRed,
   startDiv:+$('lgSetupDiv').value,
   goals:+$('lgSetupGoals').value,
   gameTime:+$('lgSetupGameTime').value,
   special:$('lgSetupSpecial').checked,
   power:$('lgSetupPower').checked,
   control:$('lgSetupControl').value
  };
  lgNewSeason(false,opts,slot);
  $('lgSetup').classList.add('hidden');
  openLeague();
 };
}
/* =========================================================================
   CHAMPIONS CUP — post-season KO for the top of the Premier League.
   The player is one of 8 seeds; the other 7 are drawn from a PERSISTED pool of
   ~12 elite "special teams" (top-tier builds), leaving spares for variety. All
   ties single-leg on the cup's own table/room/pitch (CONFIG.league.cup).
   The player's ties are played live; every other tie is simmed with lgSimBlds.
   State lives on LG.cup (roundsTies = full bracket history, round = current).

   THE BRACKET IS A TREE, and that is the whole shape of this file's cup half.
   Entrants are ranked by rating and dropped into the standard KO seeding order
   (1v8 · 4v5 · 2v7 · 3v6), then a round's winners KEEP THEIR SLOT: the winner of
   tie 2j meets the winner of tie 2j+1, so the top two seeds can only meet in the
   final. Nothing is reshuffled between rounds — the columns renderCup draws
   actually connect. `cupNextRound` is the ONE place that pairing lives and both
   live play and the sim-ahead go through it, so the two can't drift apart.
   ========================================================================= */
// `pool` lets cupCreate resolve entrants BEFORE LG.cup is assigned (it's assigned last and whole —
// see cupCreate). An id with no entrant resolves to a grey placeholder rather than throwing: one
// bad row in a save should cost you that row, not the entire bracket screen.
function cupEnt(id,pool){
  if(id==='player'){const t=LG.teams[LG.playerId];return{id:'player',name:t.name,col:t.col,model:t.model,bld:t.bld};}
  const p=pool||(LG.cup&&LG.cup.pool)||[];
  return p.find(e=>e.id===id)||{id,name:'—',col:'#93a5c6',model:null,bld:lgBld(CUP.base)};
}
function cupRate(e){return lgOff(e.bld)+lgDef(e.bld);}   // seeding strength — the same two numbers the tape shows
function cupChampName(){const c=LG&&LG.cup&&LG.cup.champion;return c?(c==='player'?LG.teams[LG.playerId].name:cupEnt(c).name):null;}
// A cup is only usable once it has a DRAWN BRACKET. Anything less (a save written while
// cupCreate was part-way through) must read as "no cup" so cupCreate re-runs, or the Enter
// Cup button is dead forever with no way back.
function cupValid(){return !!(LG&&LG.cup&&LG.cup.roundsTies&&LG.cup.roundsTies.length);}
// …and only THIS season's cup counts as one. LG.cup is never cleared (it carries the persisted
// elite pool between championships), so without the season test a finished bracket reads as "a cup
// exists" forever: the second time the player qualified, ENTER CHAMPIONS CUP re-opened the old
// completed bracket and a second cup could never be drawn. cupLive = playable, cupCurrent = this
// season's, decided or not (so a just-won bracket stays reviewable from the lobby until rollover).
function cupLive(){return cupValid()&&!LG.cup.done&&LG.cup.season===LG.season;}
function cupCurrent(){return cupValid()&&LG.cup.season===LG.season;}
function cupMakePool(existing){ // generate the elite pool ONCE; persists on LG across seasons
  if(existing&&existing.length)return existing;
  const mids=CONFIG.playerModel.models.filter(m=>m.src).map(m=>m.id);
  const pcol=LG.teams[LG.playerId].col;
  const names=CUP.names.slice(),cols=CUP.cols.slice();
  for(let i=names.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=names[i];names[i]=names[j];names[j]=t;}
  for(let i=cols.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=cols[i];cols[i]=cols[j];cols[j]=t;}
  const pool=[];
  for(let n=0;n<CUP.poolSize;n++){
    let col=cols[n%cols.length];
    if(lgColDist(col,pcol)<LGC.colClash){const safe=cols.filter(c=>lgColDist(c,pcol)>=LGC.colClash);col=safe.length?safe[Math.floor(Math.random()*safe.length)]:col;}
    const team={id:'cup'+n,name:names[n]||('CUP TEAM '+(n+1)),col,
      model:mids[Math.floor(Math.random()*mids.length)],
      bld:lgBld(CUP.base),up:Math.round(rand(CUP.budget[0],CUP.budget[1]))};
    lgAiSpend(team); // weighted-random spend → position-flavoured elite builds
    pool.push(team);
  }
  return pool;
}
// Standard single-elimination seeding order for a power-of-two field, built by mirror-folding:
// [0] → [0,1] → [0,3,1,2] → [0,7,3,4,1,6,2,5]. Read it as slot→seed, so consecutive PAIRS of slots
// are the first-round ties (1v8, 4v5, 2v7, 3v6) and each half of the list is a half of the draw.
// Generating it beats a hand-written table because it stays correct if the field ever grows to 16.
function cupSeedOrder(n){
  let o=[0];
  while(o.length<n){const m=o.length*2-1,x=[];for(let i=0;i<o.length;i++){x.push(o[i]);x.push(m-o[i]);}o=x;}
  return o;
}
function cupCreate(){ // draw a fresh cup for this season's qualifier
  if(!LG)return;
  const pid=LG.playerId;
  const pool=cupMakePool((LG.cup&&LG.cup.pool)||null); // pool persists across championships
  const ids=pool.map(e=>e.id);
  for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=ids[i];ids[i]=ids[j];ids[j]=t;}
  const drawn=['player'].concat(ids.slice(0,CUP.drawSize)); // player + 7 of 12 (5 spares)
  // WHO you get is random — the shuffle above. WHERE you meet them is not, and that's what gives a
  // bracket stakes: rank the field, then place it by cupSeedOrder. Come in as the top seed and the
  // draw opens up in front of you; scrape in 8th and you meet the best team in the cup first.
  if(CUP.seeded===false)for(let i=drawn.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=drawn[i];drawn[i]=drawn[j];drawn[j]=t;}
  else drawn.sort((a,b)=>cupRate(cupEnt(b,pool))-cupRate(cupEnt(a,pool)));
  const seeds={};drawn.forEach((id,i)=>{seeds[id]=i+1;});   // rendered beside each name
  const slots=cupSeedOrder(drawn.length).map(s=>drawn[s]);
  const ties=[];for(let i=0;i<slots.length;i+=2)ties.push({a:slots[i],b:slots[i+1],res:null,played:false});
  // LG.cup is assigned LAST, whole: a throw anywhere above then leaves the previous state
  // untouched instead of stranding a bracket-less cup that cupValid() would reject forever.
  LG.cup={season:LG.season,round:0,playerOut:false,done:false,champion:null,celeb:false,pool,seeds,roundsTies:[ties]};
  LG.teams[pid].up+=CUP.enterParts; // participation bonus
  if(LG.seasonEnd)LG.seasonEnd.shown=true; // don't re-pop the season summary on return
  saveLG();
}
function cupPlayerTie(){ // the player's current unplayed tie, or null
  if(!LG||!LG.cup||LG.cup.done)return null;
  const ties=LG.cup.roundsTies[LG.cup.round];
  return ties.find(t=>(t.a==='player'||t.b==='player')&&!t.played)||null;
}
function cupPlayTie(){
  const tie=cupPlayerTie();if(!tie)return;
  const oppId=tie.a==='player'?tie.b:tie.a;
  const pa=cupEnt('player'),pb=cupEnt(oppId);
  S.teamStats=[pa.bld,pb.bld];
  // prevKit is KIT ONLY (the venue is the cup SESSION's — see the venue block at the top of this
  // file). Still carried through consecutive ties: after tie 1 the live cfg already holds the cup
  // kit, so re-snapshotting it would lose the player's real one.
  const pk=(S.lg&&S.lg.prevKit)||{redColor:cfg.redColor,blueColor:cfg.blueColor,modelRed:cfg.modelRed,modelBlue:cfg.modelBlue,
            special:cfg.special,power:cfg.power};
  S.lg={cup:true,diff:CUP.diff||LGC.baseDiff,res:tie,names:[pa.name,pb.name],cols:[pa.col,pb.col],
        banner:'CHAMPIONS CUP · '+CUP.rounds[LG.cup.round],rec:false,prevKit:pk};
  const sel=$('cupControl').value;
  $('league').classList.add('hidden');$('championsCup').classList.add('hidden');
  cfg.redColor=pa.col;cfg.modelRed=pa.model;cfg.blueColor=pb.col;cfg.modelBlue=pb.model;
  // MATCH RULES come from the LEAGUE, not from CUP.* — the cup is this save's post-season, so a tie
  // plays to the same goal target/clock/special balls/power-ups as the season that qualified you.
  // (goals + game time arrive via goalTarget()/gameTimeLimit(); these two are read off cfg directly
  // by balls.js/powerups.js, and prevKit puts the player's own back afterwards.)
  cfg.special=LG.special;cfg.power=LG.power;
  document.documentElement.style.setProperty('--c0',cfg.redColor);
  document.documentElement.style.setProperty('--c1',cfg.blueColor);
  const start=()=>{S.lg.matchStart=S.time;rebuildRodMen();applyColors();startMatch(sel==='watch'?'ai':'red',sel&&sel!=='watch'?sel:null);};
  // Same gate as lgPlayMatch, and normally synchronous — openCup already put the venue on. cupVenue
  // returns the pitch PINNED TO THIS TIE, so the arena you played the bracket screen in is the one
  // you kick off in (it used to re-roll here, so the lobby and the match disagreed).
  let tapeDone=!LGC.tape,modelDone=false,venueDone=false;
  const check=()=>{if(!(tapeDone&&modelDone&&venueDone))return;$('lgTape').classList.add('hidden');start();};
  lgVenueEnter(cupVenue(),()=>{venueDone=true;check();});
  loadPlayerModel(()=>{modelDone=true;check();});
  if(LGC.tape){
    renderCupTape(oppId);
    $('lgTape').classList.remove('hidden');
    const go=()=>{tapeDone=true;check();};
    const cancel=tapeDwell(go);          // dwell starts once the portraits can paint (see tapeDwell)
    $('lgTape').onclick=()=>{cancel();go();};
  }
}
function renderCupTape(oppId){ // mirror renderLgTape but read cup entrants (not LG.teams)
  const me=cupEnt('player'),them=cupEnt(oppId);
  const mo=CONFIG.playerModel.models.find(x=>x.id===me.model);
  const to=CONFIG.playerModel.models.find(x=>x.id===them.model);
  const offA=lgOff(me.bld),defA=lgDef(me.bld),offB=lgOff(them.bld),defB=lgDef(them.bld);
  const bar=(label,val,cls)=>'<div class="lgRateBar"><span class="'+cls+'">'+label+'</span><div class="lgRate"><div class="'+cls+'" style="width:'+(val/10*100|0)+'%"></div></div><span class="num">'+(val*10|0)/10+'</span></div>';
  const rA=modelRender(me.model),rB=modelRender(them.model);
  const kA=modelRenderMask(me.model),kB=modelRenderMask(them.model);
  // Card markup is tapeFig(), shared with renderLgTape — this used to be a second copy of the same
  // string builder, which is how the two tapes were free to drift apart.
  const teamCard=(col,name,off,def,figHtml)=>
   '<div class="lgTapeTeam"><h2 style="color:'+col+'">'+name+'</h2>'+figHtml+bar('DEF',def,'def')+bar('OFF',off,'off')+'</div>';
  $('lgTapeBody').innerHTML=
   teamCard(me.col,me.name,offA,defA,tapeFig(me.col,rA,kA,false,mo?mo.name:'?'))+
   '<div class="lgTapeVs"><span>VS</span></div>'+
   teamCard(them.col,them.name,offB,defB,tapeFig(them.col,rB,kB,true,to?to.name:'?'));
  $('lgTapeRound').textContent=CUP.rounds[LG.cup.round];
}
function cupWinnerOf(t){return t.res[0]>t.res[1]?t.a:t.b;}
// A tie's res is indexed by a/b. The player is ALWAYS team 0 in the live match (cupPlayTie seats
// them red) but the draw puts them on either side of the tie, so the scoreline has to be oriented
// on the way in. Everything downstream reads res positionally — get this wrong and winning knocks
// you out, which is exactly what the old `[w,1-w]` did.
function cupTieRes(tie,pGoals,oGoals){return tie.a==='player'?[pGoals,oGoals]:[oGoals,pGoals];}
// THE tree pairing, used by both live play and the sim-ahead: winner of tie 2j meets winner of
// tie 2j+1, slots preserved. One definition so the bracket the player walks and the bracket the
// sim finishes for them can never be drawn differently.
function cupNextRound(ties){
  const w=ties.map(cupWinnerOf),nt=[];
  for(let i=0;i<w.length;i+=2)nt.push({a:w[i],b:w[i+1],res:null,played:false});
  return nt;
}
function cupAdvance(ties){ // sim the rest of the bracket from `ties`' winners down to one champion (stores ties)
  if(ties.length<2)return cupWinnerOf(ties[0]);
  let cur=cupNextRound(ties);
  for(;;){
    for(const t of cur){const ea=cupEnt(t.a),eb=cupEnt(t.b);t.res=lgSimBlds(ea.bld,eb.bld,lgMins());t.played=true;}
    LG.cup.roundsTies.push(cur);
    if(cur.length<2)return cupWinnerOf(cur[0]);
    cur=cupNextRound(cur);
  }
}
function awardCupWin(){
  const pid=LG.playerId;
  LG.teams[pid].up+=CUP.winParts;
  LG.cupTitles=(LG.cupTitles||0)+1;   // shown on the lobby history panel
}
// `w` (winning team index) is accepted so flow.js can call cupRecord and lgRecord through one
// expression, but it is deliberately IGNORED — S.score is the authoritative result and carries the
// real scoreline, which is what the bracket displays. The forfeit path sets S.score itself.
function cupRecord(w){ // called by endMatch while S.lg.cup is live (player just finished their tie)
  if(!LG||!LG.cup||!S.lg||!S.lg.cup||S.lg.rec)return;S.lg.rec=true;
  const cup=LG.cup,round=cup.round,ties=cup.roundsTies[round],tie=S.lg.res,pid=LG.playerId;
  tie.res=cupTieRes(tie,S.score[0],S.score[1]);tie.played=true;
  for(const t of ties){if(t===tie)continue;const ea=cupEnt(t.a),eb=cupEnt(t.b);t.res=lgSimBlds(ea.bld,eb.bld,lgMins());t.played=true;}
  const last=round>=CUP.rounds.length-1;
  let parts=0;
  if(cupWinnerOf(tie)!=='player'){       // eliminated → sim the remaining rounds to crown a champion
    cup.playerOut=true;
    cup.champion=last?cupWinnerOf(tie):cupAdvance(ties);   // beaten finalist: the team that beat us lifts it
    cup.round=cup.roundsTies.length-1;
    cup.done=true;
  }else if(last){                        // won the Final
    cup.champion='player';cup.done=true;parts=CUP.winParts;awardCupWin();   // awardCupWin does the actual credit
  }else{                                 // through to the next round
    cup.roundsTies.push(cupNextRound(ties));cup.round++;
    parts=CUP.tieParts||0;LG.teams[pid].up+=parts;
  }
  // Read by endMatch's win screen. Progress used to be its own reward and nothing else — a tie win
  // paid out only if it happened to be the final, so three of the four rounds ended on a blank.
  S.lg.parts=parts;S.lg.champ=cup.done&&cup.champion==='player';
  // NOTE: the trophy is stamped into LG.hist by lgNewSeason, NOT here. The hist entry for season N
  // is only pushed at the rollover INTO N+1, and the cup is played before that — so writing to
  // hist's newest entry from here credited the cup to the PREVIOUS season's row.
  saveLG();
}
/* ---- cup lobby UI (mirrors the league lobby panel-for-panel) ---- */
// Just the tree. It's one panel among several now, so it no longer carries the next-tie line or
// the shot of the trophy — those have panels of their own (renderCupFix / the cupResult below,
// which stays here because it belongs under the bracket it's the conclusion of).
function renderCupBracket(){
  const cup=LG.cup,sd=cup.seeds||{};
  let h='<div class="cupBracket">';
  for(let r=0;r<cup.roundsTies.length;r++){
    const ties=cup.roundsTies[r];
    h+='<div class="cupRound"><div class="cupRoundHead">'+CUP.rounds[r]+'</div>';
    for(const t of ties){
      const ea=cupEnt(t.a),eb=cupEnt(t.b);
      const aWon=t.res&&t.res[0]>t.res[1],bWon=t.res&&t.res[1]>t.res[0];
      const playerHere=(t.a==='player'||t.b==='player');
      // data-ent drives the scout click below — same affordance as clicking a league standings row.
      const row=(ent,goals,won,isPlayer)=>
        '<div class="cupTeam'+(won?' win':'')+(isPlayer?' me':'')+'" data-ent="'+ent.id+'">'+
        '<span class="seed">'+(sd[ent.id]||'')+'</span>'+
        '<i class="dot" style="background:'+ent.col+'"></i>'+
        '<span class="nm">'+ent.name+'</span>'+
        (t.res?'<span class="sc">'+goals+'</span>':'<span class="sc"></span>')+'</div>';
      h+='<div class="cupTie'+(playerHere?' me':'')+'">'+
        row(ea,t.res?t.res[0]:0,aWon,t.a==='player')+
        row(eb,t.res?t.res[1]:0,bWon,t.b==='player')+'</div>';
    }
    h+='</div>';
  }
  h+='</div>';
  if(cup.done){
    const won=cup.champion==='player',ch=cupEnt(cup.champion);
    h+='<div class="cupResult '+(won?'win':'')+'">'+ico('trophy','icoInline')+' '+(won?'YOU ARE CHAMPION!':ch.name+' WIN THE CUP')+'</div>';
  }
  $('cupBracket').innerHTML=h;
  $('cupBracket').querySelectorAll('.cupTeam').forEach(n=>{n.onclick=()=>renderCupScout(n.dataset.ent);});
}
/* Next Tie + Match Settings, the cup's twin of renderLgFix. Both panels drop out once there's no
   tie left to play, exactly as the league's do when a division is complete. */
function renderCupFix(){
  const sd=(LG.cup.seeds)||{},tie=cupPlayerTie(),me=cupEnt('player');
  $('cupFixturePanel').classList.toggle('hidden',!tie);
  $('cupSettingsPanel').classList.toggle('hidden',!tie);
  $('cupPlay').classList.toggle('hidden',!tie);
  seedRuleCtls(CUP_RULE_IDS);
  // Its OWN key, not LG.control: a lock picked for a league round shouldn't follow you into a final.
  $('cupControl').value=LG.cupControl!=null?LG.cupControl:(LG.control||'');
  if(!tie)return;
  const opp=cupEnt(tie.a==='player'?tie.b:tie.a);
  $('cupFixture').innerHTML='<span style="color:'+me.col+'">'+me.name+'</span><span class="lgVs">VS</span>'+
    '<span style="color:'+opp.col+'">'+opp.name+'</span>'+
    (sd[opp.id]?'<span class="cupSeedTag">SEED '+sd[opp.id]+'</span>':'')+
    '<div style="width:100%"><button class="miniBtn scoutMini">SCOUT OPPONENT</button></div>';
  $('cupFixture').querySelector('.scoutMini').onclick=()=>renderCupScout(opp.id);
  primeMatchExplosions(me.model,opp.model); // warm both shatters now, while in the lobby
  primeMatchTape(me.model,opp.model);       // and both tape portraits, so the splash paints whole
}
/* Cup scout. Entrants are NOT LG.teams — a KO field has no table, so there's no W/L, no GF/GA and
   no form to show. The record line is the seed + cup rating instead (the same `cupRate` the draw
   is ordered by); everything below it is the league scout's own markup off the same helpers. */
function renderCupScout(id){
  if(!id)return;
  const e=cupEnt(id),sd=(LG.cup&&LG.cup.seeds)||{};
  $('cupScoutName').textContent=e.name;$('cupScoutName').style.color=e.col;
  const off=lgOff(e.bld),def=lgDef(e.bld);
  $('cupScoutRec').innerHTML=(sd[e.id]?'<span style="color:var(--gold);font-weight:700">SEED '+sd[e.id]+'</span> · ':'')+
    'RATING <span style="color:'+e.col+';font-weight:700">'+((cupRate(e)*10|0)/10)+'</span>';
  const m=CONFIG.playerModel.models.find(x=>x.id===e.model);
  $('cupScoutBody').innerHTML=
    (m?'<div class="figName"><span class="figMug">'+ico('figure','icoInline')+'</span>'+m.name+'</div><div style="height:4px"></div>':'')+
    '<div class="lgRateBar"><span class="def">DEF</span><div class="lgRate"><div class="def" style="width:'+(def/10*100|0)+'%"></div></div><span class="num">'+(def*10|0)/10+'</span></div>'+
    '<div class="lgRateBar"><span class="off">OFF</span><div class="lgRate"><div class="off" style="width:'+(off/10*100|0)+'%"></div></div><span class="num">'+(off*10|0)/10+'</span></div>'+
    lgBuildHTML(e.bld,false);
  // portrait attaches AFTER the innerHTML build — same ordering rule as renderLgScout.
  if(m)mugImg(m,$('cupScoutBody').querySelector('.figMug'),'figMugImg','hasMug');
  $('cupScout').classList.remove('hidden');
}
/* Cup honours. THIS season's trophy is read off LG.cup directly and prepended, because a season's
   LG.hist entry is only pushed at the rollover OUT of it and the cup is played in the gap between
   — the same asymmetry that makes lgNewSeason (not cupRecord) stamp hist[].cup. The prepend is
   gated on cupCurrent() so that after a rollover, when the hist row finally exists, the finished
   bracket sitting on LG doesn't render the same trophy twice. */
function renderCupHist(){
  const playerName=LG.teams[LG.playerId].name,rows=[];
  if(cupCurrent()&&LG.cup.done&&LG.cup.champion)rows.push({season:LG.cup.season,champ:cupChampName()});
  for(let i=LG.hist.length-1;i>=0;i--){const e=LG.hist[i];if(e.cup)rows.push({season:e.season,champ:e.cup});}
  $('cupHistPanel').classList.toggle('hidden',!rows.length);
  if(!rows.length)return;
  const cups=LG.cupTitles||0;
  $('cupTitles').textContent=cups?'· '+cups+'x Winner':'';
  let h='<div class="row head"><span>Season</span><span>Champion</span></div>';
  for(const r of rows){
    const mine=r.champ===playerName;
    h+='<div class="row"><span>S'+r.season+'</span><span'+(mine?' class="me"':'')+'>'+(mine?ico('trophy','icoInline gold')+' ':'')+r.champ+'</span></div>';
  }
  $('cupHist').innerHTML=h;
}
function renderCup(){
  if(!LG||!LG.cup)return;
  const cup=LG.cup,out=cup.done&&cup.playerOut;
  $('cupTitle').textContent=CUP.name;
  // Rules ride the subtitle as well as the settings panel: on a DECIDED cup the panel is gone
  // (nothing left to configure) and this is then the only record of what the ties were played to.
  $('cupSub').textContent='SEASON '+cup.season+' · '+(cup.done?(out?'ELIMINATED':'COMPLETE'):CUP.rounds[cup.round])+' · '+lgRulesLabel();
  renderCupBracket();renderCupFix();renderCupSquad();renderCupHist();
  $('cupDone').classList.toggle('hidden',!cup.done);
  // Lifting the cup is the biggest thing in the mode and had no moment of its own — the win screen
  // celebrated the FINAL, then handed over to a bracket that just quietly said CHAMPION. Fires once
  // ever, latched on the save (not on S) so re-opening a won bracket doesn't re-trigger it.
  if(cup.done&&cup.champion==='player'&&!cup.celeb){cup.celeb=true;saveLG();confetti(0);Au.goal();}
}
function openCup(){
  // overlays + the HUD aren't in the screen registry — arriving from a finished tie's win screen
  // means they can all still be up, so they're taken down by hand before routing.
  $('lgSeasonEnd').classList.add('hidden');$('lgForfeit').classList.add('hidden');
  $('pause').classList.add('hidden');$('win').classList.add('hidden');$('hud').classList.add('hidden');
  showScreen('championsCup');   // …and applies this screen's saved panel arrangement (js/layout.js)
  // The bracket sits in the cup's own venue, same rule as the league lobby — and it cancels the
  // restore the screen change above just scheduled, so walking league→cup doesn't free and re-fetch
  // a room in between. Ahead of renderCup because cupVenue may stamp this tie's pitch onto the save.
  lgVenueEnter(cupVenue());
  renderCup();
  // Open on the opponent, like openLeague does — the scout panel starts hidden, and a panel you
  // have to discover by clicking is a panel most players never see. Falls back to the champion on
  // a decided cup so the slot isn't just empty.
  const tie=cupPlayerTie();
  if(tie)renderCupScout(tie.a==='player'?tie.b:tie.a);
  else if(LG.cup.champion)renderCupScout(LG.cup.champion);
}
function cupReturn(){gotoMenu();openLeague(true);} // win screen → lobby (gotoMenu clears S.lg)
/* ---- bind ---- */
function bindLeague(){
  $('btnLeague').onclick=()=>{Au.init();Au.ui();openSlots();};
  $('lgBack').onclick=()=>{showScreen('home');Au.ui();};
  $('lgNew').onclick=()=>{lgNewSeason(!!LG&&!!LG.divs[playerDiv()].champ);renderLeague();const fx=lgPlayerFixture();if(fx){renderLgScout(fx[0]===LG.playerId?fx[1]:fx[0]);}Au.ui();};
   $('lgPlay').onclick=lgPlayMatch;
   // The save's four match rules, on BOTH lobbies against the same LG fields (bindRuleCtls). One
   // value, two sets of controls — the cup panel isn't a second config, it's the same one.
   bindRuleCtls(LG_RULE_IDS);bindRuleCtls(CUP_RULE_IDS);
   $('lgControl').onchange=e=>{if(LG){LG.control=e.target.value;saveLG();}Au.ui();};       // persist the lobby rod-control choice so it survives reloads
   $('lgCup').onclick=openCup;
   $('btnWinContinue').onclick=lgWinContinue;
   $('lgSEContinue').onclick=lgReturn;
   $('cupPlay').onclick=cupPlayTie;
   $('cupDone').onclick=cupReturn;   // was bound to NOTHING — a visible dead button on the one screen you reach by winning a cup
   $('cupBack').onclick=cupReturn;
   // Persisted on its own key rather than sharing LG.control: the cup is a different table with
   // different stakes, and a lock chosen for a league round shouldn't silently follow you into a final.
   $('cupControl').onchange=e=>{if(LG){LG.cupControl=e.target.value;saveLG();}Au.ui();};
   $('lgSlotsBack').onclick=()=>{showScreen('home');Au.ui();};
}
bindLeague();
