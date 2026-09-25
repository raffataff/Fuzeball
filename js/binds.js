'use strict';
/* ================= key & mouse bindings =================
   Every rebindable keyboard / mouse ACTION goes through here, so a rebind in Options reaches the
   match, the hints and the reference card at once and there is no second list to drift.
   Defaults: CONFIG.binds.def. The player's changes: cfg.keyBinds — the WHOLE list for an action,
   and only for actions they touched, so retuning a default still reaches everyone else.

   A binding is a CODE: KeyboardEvent.code for keys (so a binding is a physical key, and survives a
   layout switch), Mouse0..Mouse4 for the buttons, WheelUp / WheelDown for the wheel. The device a
   code belongs to decides WHICH SEAT it drives (bindDev → seatForDev): in co-op the keyboard and
   the mouse can be two different players, and a mouse button bound to kick must kick for whoever
   holds the mouse, not whoever holds the keyboard.

   input.js keeps keys[] for the keyboard and writes keys['Mouse<n>'] for the buttons, so a held
   binding is one lookup whichever device it is on. The wheel has no held state — it is a press.

   Loaded after shots.js (bindHeld feeds the keyboard half of the shot axis) and before input.js. */

const BINDC=CONFIG.binds;
function bindList(act){const o=cfg.keyBinds&&cfg.keyBinds[act];return Array.isArray(o)?o:(BINDC.def[act]||[]);}
function bindDev(code){return /^(Mouse|Wheel)/.test(code)?'mouse':'kbd';}
function bindIs(act,code){return bindList(act).indexOf(code)>=0;}
function bindGrp(act){for(const b of BINDC.list)if(b.act===act)return b.grp;return null;}
// Every action a code fires within one group. Per EVENT, never per frame, so the array is fine.
function bindActs(code,grp){const out=[];for(const b of BINDC.list)if(b.grp===grp&&bindIs(b.act,code))out.push(b.act);return out;}
/* Is `act` held on a device seat `s` owns? Per frame per seat (the shot axis), so no allocation:
   bindList hands back the stored array, and keys[] is a plain map. */
function bindHeld(act,s){
 if(!s)return false;
 const l=bindList(act);
 for(let i=0;i<l.length;i++)if(keys[l[i]]&&seatForDev(bindDev(l[i]))===s)return true;
 return false;
}
function bindReserved(code){return BINDC.reserved.indexOf(code)>=0;}

/* ---- labels -------------------------------------------------------------------------------- */
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
/* HUD hint markup for an action: [KEY] keycaps (hud.js hudTok), the mouse drawn as a mouse. `n` is how
   many of its inputs to show — the FIRST ones, which is why CONFIG.binds.def order matters. An
   unbound action gives '' so a caller can drop the clause rather than print a caption with no key. */
function bindCap(act,n){
 const l=bindList(act),out=[];
 for(let i=0;i<l.length&&out.length<(n||1);i++)out.push('['+bindLabel(l[i])+']');
 return out.join(' ');
}
// "<caps> <words>" or nothing at all when the action has no input.
function bindHint(act,words,n){const c=bindCap(act,n);return c?c+' '+words:'';}
function bindJoin(parts){return parts.filter(Boolean).join(' · ');}
/* The rod-control clauses every keyboard hint shares (flow.js, trials.js, training.js), so a rebind
   reaches all three and no screen can describe the controls differently. `sw`: offer switching (only
   if a seat actually has more than one rod). `mouse`: a seat holds the mouse, so it slides too.
   POWER/FINESSE are their own clause and their own LINE — with kick and raise each showing a key and
   a mouse button, one line of all four ran into the rod chips on a narrow window. */
function bindHintRods(sw,mouse){
 const pair=(a,b)=>[bindCap(a),bindCap(b)].filter(Boolean).join(' ');
 const sh=typeof shotsOn==='function'&&shotsOn()&&CONFIG.shots.kbm&&CONFIG.shots.kbm.on;
 const pin=sh&&CONFIG.shots.pin&&CONFIG.shots.pin.on&&bindCap('finesse')&&bindCap('raise');
 const sw2=sw?pair('rodPrev','rodNext'):'',sl=(pair('slideUp','slideDown')+(mouse?' [MOUSE]':'')).trim();
 return {sw:sw2?sw2+' switch rod':'',slide:sl?sl+' slide':'',
  act:bindJoin([bindHint('kick','kick',2),bindHint('raise','raise',2)]),
  // needRaise: power is only half the wind-up, so the hint names both keys it takes. The pin is the
  // finesse + raise chord (shots.js shotPinInput), named the same way.
  mod:sh?bindJoin([CONFIG.shots.charge.needRaise
    ?(bindCap('power')&&bindCap('raise')?bindCap('power')+' + '+bindCap('raise')+' wind up':'')
    :bindHint('power','power'),bindHint('finesse','touch'),pin?bindCap('finesse')+' + '+bindCap('raise')+' pin':'']):''};
}

/* ---- editing (Options → Controls) -----------------------------------------------------------
   All writes go through bindSet, which stores the list only when it differs from the default, so
   an action edited back to its default starts following CONFIG.binds again. */
function bindSame(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function bindSet(act,list){
 if(!cfg.keyBinds||typeof cfg.keyBinds!=='object')cfg.keyBinds={};
 if(bindSame(list,BINDC.def[act]||[]))delete cfg.keyBinds[act];else cfg.keyBinds[act]=list.slice();
}
/* Add `code` to `act`. One input may not do two things in the same group, so it is TAKEN from
   whichever action had it — that is what the player means by pressing it — and the caller is told
   which, so it can say so. Returns {ok,why,moved:[acts]}. Past `max` the newest replaces the last. */
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
