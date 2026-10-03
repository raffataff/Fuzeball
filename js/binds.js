'use strict';
// ================= key & mouse bindings =================
// every rebindable action goes through here so a rebind reaches the match, the hints and the reference card; defaults CONFIG.binds.def, the player's changes cfg.keyBinds (whole list per action, only for touched actions)
// a binding is a code: KeyboardEvent.code (a physical key), Mouse0..Mouse4, WheelUp / WheelDown; the code's device decides which seat it drives (bindDev > seatForDev)
// input.js keeps keys[] (and keys['Mouse<n>']), so a held binding is one lookup; the wheel is a press
// loaded after shots.js (bindHeld feeds the shot axis) and before input.js

const BINDC=CONFIG.binds;
function bindList(act){const o=cfg.keyBinds&&cfg.keyBinds[act];return Array.isArray(o)?o:(BINDC.def[act]||[]);}
function bindDev(code){return /^(Mouse|Wheel)/.test(code)?'mouse':'kbd';}
function bindIs(act,code){return bindList(act).indexOf(code)>=0;}
function bindGrp(act){for(const b of BINDC.list)if(b.act===act)return b.grp;return null;}
// every action a code fires within one group; per event, never per frame
function bindActs(code,grp){const out=[];for(const b of BINDC.list)if(b.grp===grp&&bindIs(b.act,code))out.push(b.act);return out;}
// is `act` held on a device seat `s` owns? per frame per seat, so no allocation
function bindHeld(act,s){
 if(!s)return false;
 const l=bindList(act);
 for(let i=0;i<l.length;i++)if(keys[l[i]]&&seatForDev(bindDev(l[i]))===s)return true;
 return false;
}
function bindReserved(code){return BINDC.reserved.indexOf(code)>=0;}

// ---- labels ----
const BIND_LAB={Space:'SPACE',Mouse0:'LMB',Mouse1:'MMB',Mouse2:'RMB',Mouse3:'MOUSE 4',Mouse4:'MOUSE 5',
 WheelUp:'WHEEL UP',WheelDown:'WHEEL DOWN',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',
 ShiftLeft:'L-SHIFT',ShiftRight:'R-SHIFT',ControlLeft:'L-CTRL',ControlRight:'R-CTRL',AltLeft:'L-ALT',AltRight:'R-ALT',
 Enter:'ENTER',Backspace:'BKSP',Delete:'DEL',Insert:'INS',Home:'HOME',End:'END',PageUp:'PG UP',PageDown:'PG DN',
 CapsLock:'CAPS',Backquote:'`',Minus:'-',Equal:'=',BracketLeft:'L-BRKT',BracketRight:'R-BRKT',Backslash:'\\',
 Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',IntlBackslash:'\\',NumpadEnter:'NUM ENTER',
 NumpadAdd:'NUM +',NumpadSubtract:'NUM -',NumpadMultiply:'NUM *',NumpadDivide:'NUM /',NumpadDecimal:'NUM .'};
function bindLabel(code){
 if(BIND_LAB[code])return BIND_LAB[code];
 let m=/^Key([A-Z])$/.exec(code);if(m)return m[1];
 m=/^Digit(\d)$/.exec(code);if(m)return m[1];
 m=/^Numpad(\d)$/.exec(code);if(m)return 'NUM '+m[1];
 return String(code).toUpperCase();
}
// HUD hint markup for an action: [KEY] keycaps, the mouse drawn as a mouse; `n` = how many inputs to show (the first, so CONFIG.binds.def order matters); an unbound action gives ''
function bindCap(act,n){
 const l=bindList(act),out=[];
 for(let i=0;i<l.length&&out.length<(n||1);i++)out.push('['+bindLabel(l[i])+']');
 return out.join(' ');
}
// "<caps> <words>" or nothing at all when the action has no input.
function bindHint(act,words,n){const c=bindCap(act,n);return c?c+' '+words:'';}
function bindJoin(parts){return parts.filter(Boolean).join(' · ');}
// the rod-control clauses every keyboard hint shares (flow.js, trials.js, training.js); `sw`: offer switching if a seat has more than one rod; `mouse`: a seat holds the mouse
// POWER/FINESSE get their own line (four inputs on one ran into the rod chips)
function bindHintRods(sw,mouse){
 const pair=(a,b)=>[bindCap(a),bindCap(b)].filter(Boolean).join(' ');
 const sh=typeof shotsOn==='function'&&shotsOn()&&CONFIG.shots.kbm&&CONFIG.shots.kbm.on;
 const pin=sh&&CONFIG.shots.pin&&CONFIG.shots.pin.on&&bindCap('finesse')&&bindCap('raise');
 const sw2=sw?pair('rodPrev','rodNext'):'',sl=(pair('slideUp','slideDown')+(mouse?' [MOUSE]':'')).trim();
 return {sw:sw2?sw2+' switch rod':'',slide:sl?sl+' slide':'',
  act:bindJoin([bindHint('kick','kick',2),bindHint('raise','raise',2)]),
  // needRaise: power is half the wind-up, so the hint names both keys; the pin is finesse + raise (shots.js shotPinInput)
  mod:sh?bindJoin([CONFIG.shots.charge.needRaise
    ?(bindCap('power')&&bindCap('raise')?bindCap('power')+' + '+bindCap('raise')+' wind up':'')
    :bindHint('power','power'),bindHint('finesse','touch'),pin?bindCap('finesse')+' + '+bindCap('raise')+' pin':'']):''};
}

// ---- editing (Options > Controls) ----
// all writes go through bindSet, which stores a list only when it differs from the default
function bindSame(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function bindSet(act,list){
 if(!cfg.keyBinds||typeof cfg.keyBinds!=='object')cfg.keyBinds={};
 if(bindSame(list,BINDC.def[act]||[]))delete cfg.keyBinds[act];else cfg.keyBinds[act]=list.slice();
}
// add `code` to `act`: one input can't do two things in a group, so it's taken from whichever action had it (the caller is told which); returns {ok,why,moved:[acts]}; past `max` the newest replaces the last
function bindAdd(act,code){
 if(bindReserved(code))return {ok:false,why:'reserved',moved:[]};
 const g=bindGrp(act),moved=[];
 for(const b of BINDC.list){
  if(b.act===act||b.grp!==g)continue;
  const l=bindList(b.act);
  if(l.indexOf(code)>=0){bindSet(b.act,l.filter(c=>c!==code));moved.push(b.act);}
 }
 const cur=bindList(act).filter(c=>c!==code);
 if(cur.length>=BINDC.max)cur.length=BINDC.max-1;
 cur.push(code);
 bindSet(act,cur);
 return {ok:true,why:'',moved};
}
function bindRemove(act,code){bindSet(act,bindList(act).filter(c=>c!==code));}
function bindReset(act){if(act){if(cfg.keyBinds)delete cfg.keyBinds[act];}else cfg.keyBinds={};}
function bindActLabel(act){for(const b of BINDC.list)if(b.act===act)return b.lab;return act;}
