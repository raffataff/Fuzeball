'use strict';
// ===== roster: the Kick Off lobby =====
// two team columns of seat cards; a device joins a side (keyboard Space / pad A, or the chip under a column), picks a rod, and that's a player
// it only edits specs (S.roster = [{team, devs[], lockRole}]); flow.js turns them into live seats (js/seats.js) at kickoff, so a rematch keeps the line-up
// device rule: the first seat absorbs every unclaimed device, each later seat takes only the one it joined with, removed from whoever held it (rosAbsorb); back to one seat re-absorbs
// the panel re-renders from a signature diff (rosSig) on a rAF while open
const ROS={raf:0,kbdHeld:false,lastSig:'',seeded:false};

// ---- devices ----
function rosPads(){const p=(navigator.getGamepads?navigator.getGamepads():[])||[],o=[];
 for(let i=0;i<p.length&&i<CONFIG.seats.maxPads;i++)if(p[i])o.push('pad'+i);return o;}
function rosDevList(){return['kbd','mouse'].concat(rosPads());}
function rosDevOwner(tok){for(let i=0;i<S.roster.length;i++)if(S.roster[i].devs.indexOf(tok)>=0)return S.roster[i];return null;}
function rosFreeDevs(){return rosDevList().filter(t=>!rosDevOwner(t));}
// devices a new player can take off an existing one, only from a seat that still has one left (press-to-join claims unowned devices only); 'pad*' doesn't count
function rosTakeableDevs(){
 return rosDevList().filter(t=>{const o=rosDevOwner(t);
  return!!o&&o.devs.filter(x=>x!=='pad*').length>1;});
}
// 'pad*' is never shown (it means 'any pad plugged in later'); rosAbsorb adds the real padN alongside it
function rosDevLabel(s){return s.devs.filter(t=>t!=='pad*').map(t=>SEAT_DEV_NAME[t]||t).join(' + ')||'—';}
// a lone seat holds everything (solo play); runs after every join/leave and tick, so a pad plugged in mid-lobby is picked up
// it also gets the catch-all 'pad*' (seats.js) for pads plugged in after kickoff; stripped once a second seat exists
function rosAbsorb(){
 if(S.roster.length!==1){S.roster.forEach(s=>{const i=s.devs.indexOf('pad*');if(i>=0)s.devs.splice(i,1);});return;}
 const s=S.roster[0];
 rosFreeDevs().forEach(t=>{if(s.devs.indexOf(t)<0)s.devs.push(t);});
 if(s.devs.indexOf('pad*')<0)s.devs.push('pad*');
}
function rosTeamCount(t){let n=0;for(let i=0;i<S.roster.length;i++)if(S.roster[i].team===t)n++;return n;}
function rosNextTeam(){return rosTeamCount(0)<=rosTeamCount(1)&&rosTeamCount(0)<CONFIG.seats.perTeam?0:1;}
function rosCanJoin(t){return S.roster.length<CONFIG.seats.max&&rosTeamCount(t)<CONFIG.seats.perTeam;}

// ---- join / leave ----
function rosJoin(team,dev){
 if(!rosCanJoin(team)||!dev)return null;
 S.roster.forEach(s=>{const i=s.devs.indexOf(dev);if(i>=0)s.devs.splice(i,1);});  // one device, one seat
 const s={team:team,devs:[dev],lockRole:null};
 S.roster.push(s);
 // a seat stripped of its last real device is gone; rosTakeableDevs already refuses that, so this is a backstop
 S.roster=S.roster.filter(x=>x.devs.filter(d=>d!=='pad*').length);
 rosAbsorb();rosRender();Au.init();Au.ui();
 return s;
}
function rosLeave(s){
 const i=S.roster.indexOf(s);if(i<0)return;
 S.roster.splice(i,1);
 rosAbsorb();rosRender();Au.ui();             // 2→1 hands every device back to the survivor
}
// swapping sides isn't joining (only the per-team cap applies); the lock is dropped if the new side already has that role
function rosSetTeam(s,t){
 if(s.team===t||rosTeamCount(t)>=CONFIG.seats.perTeam)return;
 s.team=t;
 if(rosRoleTaken(s,s.lockRole))s.lockRole=null;
 rosRender();Au.ui();
}
// a locked role is a one-rod seat, so two players locking the same role would share a handle: refused (button disabled); ALL ('' role) is never taken
function rosRoleTaken(s,role){
 if(!role)return false;
 return S.roster.some(o=>o!==s&&o.team===s.team&&o.lockRole===role);
}
function rosSetRole(s,role){
 if(rosRoleTaken(s,role))return;
 s.lockRole=role||null;rosRender();Au.ui();
}

// ---- render ----
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
  // cards carry the seat colour (seats.js), not the kit colour; `k` is the seat's index within the team
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
    // a role a teammate has locked is dead here; titled with whose it is, like the device chips
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
  // join chips: every device you could join with; free ones first, then ones you'd take off another player (dimmed, named)
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

// ---- live polling (only while the Kick Off screen is up) ----
// press-to-join needs raw device state (`keys`, input.js, is filled before its phase guards); pads are polled in rosPad
function rosTick(){
 // the screen being visible is the condition, not the router's current screen (startMatchNow calls hideScreens() without navigating)
 if(screenId()!=='menu'||$('menu').classList.contains('hidden')){ROS.raf=0;return;}
 const kb=!!(keys.Space||keys.Enter);
 if(kb&&!ROS.kbdHeld&&!rosDevOwner('kbd'))rosJoin(rosNextTeam(),'kbd');
 ROS.kbdHeld=kb;
 rosAbsorb();
 const sg=rosSig();if(sg!==ROS.lastSig)rosRender(); // picks up pad hotplug, renames, difficulty changes
 ROS.raf=requestAnimationFrame(rosTick);
}
// pad join/leave: js/padnav.js owns menu pad polling and offers each A/B press here first (true = used); a button still down from the opening press isn't new
function rosPad(i,b){
 const own=rosDevOwner('pad'+i);
 if(b===0)return!own&&!!rosJoin(rosNextTeam(),'pad'+i);   // A joins the emptier side
 // B leaves only if this pad is the seat's only real device; a solo player's B is Back (they leave with the ✕ button)
 if(b===1&&own&&own.devs.filter(d=>d!=='pad*').length===1){rosLeave(own);return true;}
 return false;
}
function rosterOpen(){
 // first visit this session: seed a red seat so a solo player can just hit START; once only (ROS.seeded), or leaving every seat for an AI-vs-AI match would be undone
 if(!ROS.seeded){ROS.seeded=true;if(!S.roster.length)S.roster.push({team:0,devs:['kbd'],lockRole:null});}
 rosAbsorb();
 // prime the key edge from what's held now so a key still down from the opening press can't insta-join
 ROS.kbdHeld=!!(keys.Space||keys.Enter);
 rosRender();
 if(!ROS.raf)ROS.raf=requestAnimationFrame(rosTick);
}
function rosterClose(){if(ROS.raf){cancelAnimationFrame(ROS.raf);ROS.raf=0;}}
SCREENS.menu.onShow=rosterOpen;
SCREENS.menu.onHide=rosterClose;
SCREENS.menu.onPad=rosPad;
// the first match with a human at the table is offered the tutorial first (js/tutorial.js, once ever)
(function(){const b=$('btnStart');if(b)b.onclick=()=>{
 if(S.roster.length&&typeof tutOffer==='function'&&tutOffer(()=>startMatch('roster'),'Play match'))return;
 startMatch('roster');};})();
