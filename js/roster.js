'use strict';
/* ===== roster — the Kick Off lobby =====
   Two team columns, each holding seat cards. A device JOINS a side (press-to-join on keyboard
   Space / pad A, or click the device chip under a column), picks a rod, and that's a player.
   The lobby only ever edits SPECS — `S.roster` is an array of `{team, devs[], lockRole}` — and
   flow.js turns those into live seats (js/seats.js) at kickoff. Keeping the lobby out of the
   live seat objects is what lets a rematch replay the same line-up without re-deriving anything.

   DEVICE RULE, and it's the whole reason this reads simply: **the FIRST seat absorbs every
   unclaimed device; every later seat takes exactly the one device it joined with, removed from
   whoever held it.** So a solo player is one seat holding keyboard + mouse + pad and plays
   exactly as before; the moment a brother presses A on pad 1 he gets `['pad1']` and nothing is
   taken from player 1; when a friend then claims the keyboard, it is stripped from player 1,
   who is left with mouse + pad 0. Dropping back to one seat re-absorbs, so leaving restores
   solo controls. `rosAbsorb()` is those two sentences.

   The whole panel re-renders from a SIGNATURE diff (`rosSig`) on a rAF while the screen is
   open, so plugging a pad in, renaming a team in the Kits panel or changing an AI difficulty
   all show up without any of those places knowing the roster exists. */
const ROS={raf:0,pad:{},kbdHeld:false,lastSig:'',seeded:false};

/* ---- devices ---------------------------------------------------------------------------- */
function rosPads(){const p=(navigator.getGamepads?navigator.getGamepads():[])||[],o=[];
 for(let i=0;i<p.length&&i<CONFIG.seats.maxPads;i++)if(p[i])o.push('pad'+i);return o;}
function rosDevList(){return['kbd','mouse'].concat(rosPads());}
function rosDevOwner(tok){for(let i=0;i<S.roster.length;i++)if(S.roster[i].devs.indexOf(tok)>=0)return S.roster[i];return null;}
function rosFreeDevs(){return rosDevList().filter(t=>!rosDevOwner(t));}
/* Devices a NEW player can take off an existing one — only from a seat that would still have a
   device left afterwards, so nobody can be stripped to nothing by someone else's click. This is
   what makes "player 1 keeps the pad, friend takes the keyboard" reachable: press-to-join
   deliberately only claims UNOWNED devices (Space/A must never split a solo player in two by
   accident), so taking one is an explicit click. 'pad*' doesn't count toward the tally — it's a
   catch-all, not a device. */
function rosTakeableDevs(){
 return rosDevList().filter(t=>{const o=rosDevOwner(t);
  return!!o&&o.devs.filter(x=>x!=='pad*').length>1;});
}
/* 'pad*' is never shown — it means "any pad you plug in later", and rosAbsorb adds the real
   padN alongside it the moment one is connected, which is what the player should read. */
function rosDevLabel(s){return s.devs.filter(t=>t!=='pad*').map(t=>SEAT_DEV_NAME[t]||t).join(' + ')||'—';}
/* A lone seat holds everything — that IS solo play. Runs after every join/leave and each tick,
   so a pad plugged in mid-lobby is picked up by a solo player without them doing anything.
   It also gets the catch-all 'pad*' (see seats.js), which covers a pad plugged in AFTER kickoff,
   when this lobby is long gone and there's no chip to click. The catch-all is stripped the
   moment a second seat exists — from then on pads are claimed explicitly, or player 2's pad
   would answer to player 1 as well. */
function rosAbsorb(){
 if(S.roster.length!==1){S.roster.forEach(s=>{const i=s.devs.indexOf('pad*');if(i>=0)s.devs.splice(i,1);});return;}
 const s=S.roster[0];
 rosFreeDevs().forEach(t=>{if(s.devs.indexOf(t)<0)s.devs.push(t);});
 if(s.devs.indexOf('pad*')<0)s.devs.push('pad*');
}
function rosTeamCount(t){let n=0;for(let i=0;i<S.roster.length;i++)if(S.roster[i].team===t)n++;return n;}
function rosNextTeam(){return rosTeamCount(0)<=rosTeamCount(1)&&rosTeamCount(0)<CONFIG.seats.perTeam?0:1;}
function rosCanJoin(t){return S.roster.length<CONFIG.seats.max&&rosTeamCount(t)<CONFIG.seats.perTeam;}

/* ---- join / leave ----------------------------------------------------------------------- */
function rosJoin(team,dev){
 if(!rosCanJoin(team)||!dev)return null;
 S.roster.forEach(s=>{const i=s.devs.indexOf(dev);if(i>=0)s.devs.splice(i,1);});  // one device, one seat
 const s={team:team,devs:[dev],lockRole:null};
 S.roster.push(s);
 // A seat stripped of its last REAL device is gone ('pad*' alone is a catch-all, not a player).
 // rosTakeableDevs already refuses to strip anyone that far, so this is a backstop.
 S.roster=S.roster.filter(x=>x.devs.filter(d=>d!=='pad*').length);
 rosAbsorb();rosRender();Au.init();Au.ui();
 return s;
}
function rosLeave(s){
 const i=S.roster.indexOf(s);if(i<0)return;
 S.roster.splice(i,1);
 rosAbsorb();rosRender();Au.ui();             // 2→1 hands every device back to the survivor
}
// swapping sides isn't joining — only the per-team cap applies, or a full roster couldn't reshuffle.
// The lock is dropped if the new side already has that role spoken for: carrying it across is the
// one way a duplicate lock could still get through rosSetRole's guard.
function rosSetTeam(s,t){
 if(s.team===t||rosTeamCount(t)>=CONFIG.seats.perTeam)return;
 s.team=t;
 if(rosRoleTaken(s,s.lockRole))s.lockRole=null;
 rosRender();Au.ui();
}
/* A locked role is a ONE-ROD seat — it can't switch away — so two players on a side locking the
   same role would be welded to one handle and both would drive its target. Refused here (and the
   button renders disabled) rather than silently reassigned, so the player sees why it didn't take.
   `rosRoleTaken` is what the render greys out. ALL ('' role) is never taken: any number of seats
   can share the full rod list, since setSeatCtrl skips rods someone else is holding. */
function rosRoleTaken(s,role){
 if(!role)return false;
 return S.roster.some(o=>o!==s&&o.team===s.team&&o.lockRole===role);
}
function rosSetRole(s,role){
 if(rosRoleTaken(s,role))return;
 s.lockRole=role||null;rosRender();Au.ui();
}

/* ---- render ----------------------------------------------------------------------------- */
const ROS_ROLES=[['','ALL'],['GK','GK'],['DEF','DEF'],['MID','MID'],['ATT','ATT']];
function rosSig(){
 return S.roster.map(s=>s.team+'/'+s.devs.join('+')+'/'+(s.lockRole||'*')).join('|')
  +'#'+rosFreeDevs().join(',')+'#'+rosTakeableDevs().join(',')
  +'#'+cfg.redName+'#'+cfg.blueName+'#'+cfg.diffRed+'#'+cfg.diffBlue
  +'#'+cfg.redColor+'#'+cfg.blueColor;
}
function rosRender(){
 if(!$('rosSeats0'))return;
 for(let t=0;t<2;t++){
  const host=$('rosSeats'+t),col=t===0?cfg.redColor:cfg.blueColor;
  host.innerHTML='';
  // Cards carry the SEAT colour (seats.js), not the flat kit colour, so the colour you join in
  // is the colour of the marker that will float over your rod. `k` is the seat's index within
  // this team, which is what the tint is keyed on.
  let k=0;
  S.roster.forEach(s=>{
   if(s.team!==t)return;
   const sc=seatTintHex(t,k++);
   const d=document.createElement('div');
   d.className='rosSeat';d.style.setProperty('--tc',sc);
   const top=document.createElement('div');top.className='rosSeatTop';
   const p=document.createElement('span');p.className='rosP';p.textContent='P'+(S.roster.indexOf(s)+1);
   const dv=document.createElement('span');dv.className='rosDevs';
   dv.textContent=rosDevLabel(s);
   const sw=document.createElement('button');sw.className='rosMini';sw.textContent='⇄';sw.title='Switch side';
   sw.onclick=()=>rosSetTeam(s,1-s.team);
   const x=document.createElement('button');x.className='rosMini';x.textContent='✕';x.title='Leave';
   x.onclick=()=>rosLeave(s);
   top.append(p,dv,sw,x);
   const rr=document.createElement('div');rr.className='rodRow';
   ROS_ROLES.forEach(([role,lab])=>{
    const b=document.createElement('button');
    // A role a teammate has already locked is dead here — a locked seat can't switch off it, so
    // two of them on one rod is unrecoverable in-match. Titled with whose it is, same as the
    // device chips, so a full row never reads as a bug.
    const taken=rosRoleTaken(s,role);
    b.className='rodOpt'+((s.lockRole||'')===role?' on':'')+(taken?' taken':'');
    b.style.setProperty('--tc',sc);b.textContent=lab;
    if(taken){const o=S.roster.find(q=>q!==s&&q.team===s.team&&q.lockRole===role);  // q, not x — `x` is the leave button above
     b.title='Taken by P'+(S.roster.indexOf(o)+1);}
    b.onclick=()=>rosSetRole(s,role);
    rr.appendChild(b);
   });
   d.append(top,rr);host.appendChild(d);
  });
  // Join chips — every device you could join with, so it's never a guess. Free devices first,
  // then ones you'd be TAKING off another player (dimmed, and named so it's obvious whose).
  const free=rosFreeDevs(),take=rosTakeableDevs();
  if(rosCanJoin(t)&&(free.length||take.length)){
   const j=document.createElement('div');j.className='rosAdd';
   const lab=document.createElement('span');lab.className='rosAddLab';lab.textContent='JOIN WITH';
   j.appendChild(lab);
   const chip=(tok,steal)=>{
    const b=document.createElement('button');
    b.className='rosDevBtn'+(steal?' take':'');
    b.style.setProperty('--tc',col);b.textContent=SEAT_DEV_NAME[tok]||tok;
    if(steal){const o=rosDevOwner(tok);b.title='Take from P'+(S.roster.indexOf(o)+1);}
    b.onclick=()=>rosJoin(t,tok);
    j.appendChild(b);
   };
   free.forEach(tok=>chip(tok,false));
   take.forEach(tok=>chip(tok,true));
   host.appendChild(j);
  }
  const n=rosTeamCount(t);
  $('rosTag'+t).textContent=n?(n+(n>1?' PLAYERS':' PLAYER')):('AI · '+String(t===0?cfg.diffRed:cfg.diffBlue).toUpperCase());
  $('rosTag'+t).classList.toggle('ai',!n);
  const nm=$('rosName'+t);nm.textContent=t===0?cfg.redName:cfg.blueName;nm.style.color=col;
 }
 $('btnStart').textContent=S.roster.length?'START MATCH':'WATCH AI MATCH';
 ROS.lastSig=rosSig();
}

/* ---- live polling (only while the Kick Off screen is up) --------------------------------- */
/* Press-to-join needs raw device state, not DOM events: a pad has no click, and the keyboard's
   keydown handler is busy being the in-match input. `keys` (input.js) is filled before that
   handler's phase guards, so reading it here is safe. */
function rosTick(){
 // The screen being VISIBLE is the condition, not the router's current screen: startMatchNow
 // calls hideScreens() without navigating, so scrCur stays 'menu' for the whole match. Polling
 // on through that would let a pad's B button call rosLeave mid-rally.
 if(screenId()!=='menu'||$('menu').classList.contains('hidden')){ROS.raf=0;return;}
 const kb=!!(keys.Space||keys.Enter);
 if(kb&&!ROS.kbdHeld&&!rosDevOwner('kbd'))rosJoin(rosNextTeam(),'kbd');
 ROS.kbdHeld=kb;
 const pads=(navigator.getGamepads?navigator.getGamepads():[])||[];
 for(let i=0;i<pads.length&&i<CONFIG.seats.maxPads;i++){
  const gp=pads[i];if(!gp)continue;
  const pv=ROS.pad[i]||(ROS.pad[i]={});
  const a=gpDown(gp,0),b=gpDown(gp,1),ja=a&&!pv[0],jb=b&&!pv[1];
  pv[0]=a;pv[1]=b;
  const own=rosDevOwner('pad'+i);
  if(ja&&!own)rosJoin(rosNextTeam(),'pad'+i);      // A joins the emptier side
  // B leaves — but ONLY if this pad is that seat's only real device, i.e. the seat exists
  // BECAUSE of this pad. A solo player holding keyboard+mouse+pad must not wipe their own seat
  // by tapping B; theirs is the seat you leave with the ✕ button. Mirror of the join rule.
  else if(jb&&own&&own.devs.filter(d=>d!=='pad*').length===1)rosLeave(own);
 }
 rosAbsorb();
 const sg=rosSig();if(sg!==ROS.lastSig)rosRender(); // picks up pad hotplug, renames, difficulty changes
 ROS.raf=requestAnimationFrame(rosTick);
}
function rosterOpen(){
 // First visit THIS SESSION: seed a red seat so a solo player can just hit START. rosAbsorb
 // hands it every device, which is exactly the old "PLAY RED / all rods" default. Seeding is
 // once-only (ROS.seeded) — otherwise leaving every seat to set up an AI-vs-AI match would be
 // undone the moment you stepped out to home and came back.
 if(!ROS.seeded){ROS.seeded=true;if(!S.roster.length)S.roster.push({team:0,devs:['kbd'],lockRole:null});}
 rosAbsorb();
 // Prime the edge state from what's held RIGHT NOW so a key/button still down from the click
 // that opened this screen can't insta-join.
 ROS.kbdHeld=!!(keys.Space||keys.Enter);
 const pads=(navigator.getGamepads?navigator.getGamepads():[])||[];
 for(let i=0;i<pads.length&&i<CONFIG.seats.maxPads;i++){const gp=pads[i];if(!gp)continue;
  ROS.pad[i]={0:gpDown(gp,0),1:gpDown(gp,1)};}
 rosRender();
 if(!ROS.raf)ROS.raf=requestAnimationFrame(rosTick);
}
function rosterClose(){if(ROS.raf){cancelAnimationFrame(ROS.raf);ROS.raf=0;}}
SCREENS.menu.onShow=rosterOpen;
SCREENS.menu.onHide=rosterClose;
(function(){const b=$('btnStart');if(b)b.onclick=()=>startMatch('roster');})();
