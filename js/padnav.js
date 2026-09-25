'use strict';
/* ===== padnav — controller navigation for every menu ===== */
/* The pad used to exist only inside a match (input.js gamepadUpdate). Every screen outside one was
   mouse-only, which is the whole Steam Deck / couch problem. This file drives ALL of them, and it
   does it without a per-screen focus order:

   SPATIAL, NOT DECLARED. The candidates are read off the live DOM each time the cursor moves —
   buttons, selects, inputs, and anything carrying an `onclick` PROPERTY (which is how nearly every
   card, swatch and row in this codebase is wired) — and the D-pad picks the nearest one in that
   direction. So a screen added later, a panel the layout editor has moved, a roster that just
   re-rendered: all navigable with nothing registered. A screen only ever DECLARES its default
   focus and, optionally, a Start-button action (NAV_SCREENS) and pad hooks on its SCREENS entry:
     onPad(padIdx,btn) → true   — the screen consumed an A/B press (the Kick Off lobby's join/leave)
     onPadStick(rx,ry,dt) → true — the screen used the right stick (the customize turntable)

   THE FOCUS IS VIRTUAL. `.navFocus` is a class, never DOM focus — a focused <button> would also take
   Space/Enter, and the roster reads Space as "keyboard joins a side". Text inputs are the exception:
   A focuses one for real so it can be typed into, and B/A/any direction blurs it again.

   ONE POLLER IN MENUS. js/roster.js used to read the pads itself for press-to-join, and two pollers
   on one A press means it both joins a side AND presses whatever the cursor is on. The lobby's rule
   now runs as its onPad hook, first, and only a press it declines reaches the cursor.

   A PRESS THE MENU USED IS EATEN until the button comes back up (padNavFilter, called from
   gamepadUpdate). Resuming from pause with A, or starting a match with it, would otherwise hand the
   same press to the rod as a kick — a fresh match seat has no edge history to tell it the button was
   already down.

   Layers are checked top-down (NAV_LAYERS): a confirm dialog beats Options, Options beats the pause
   menu it was opened over, and only with no overlay up does the router's current screen get the pad.
   In a live match with nothing on top, this file does nothing at all — the pad is gameplay's. */
const NAV={t:0,root:null,el:null,rect:null,show:false,mem:{},prev:{},eat:{},dir:'',rep:0,miss:0,
 fam:'xbox',kind:'kbm',edit:null,adj:null,adjWas:null,drop:null,hint:null,hintSig:'',hintT:0};
// Overlays, top-most first. def = default focus, back = what B presses, backLbl = its hint label.
const NAV_LAYERS=[
 {id:'uiConfirm',def:['uiConfirmCancel'],back:'uiConfirmCancel'},
 {id:'lgWipe',def:['btnWipeCancel'],back:'btnWipeCancel'},
 {id:'lgForfeit',def:['btnForfeitCancel'],back:'btnForfeitCancel'},
 {id:'options',def:['optTabBtnDisplay'],back:'optDone'},
 {id:'pause',def:['btnResume'],back:'btnResume',backLbl:'Resume'},
 {id:'lgSeasonEnd',def:['lgSEContinue']},
 {id:'lgTape',def:['lgTape'],back:'lgTape',backLbl:'Skip'},
 {id:'win',def:['btnWinContinue','btnRematch']},
 {id:'trlCard',def:['trlRetry'],back:'trlQuit',backLbl:'Trials'}
];
// Router screens. B always presses the screen's own visible `.backBtn`, so it runs exactly the
// teardown the mouse would (cupReturn, closeCustomize…) rather than a bare backScreen().
const NAV_SCREENS={
 home:{def:['btnKickOff']},
 menu:{def:['btnStart'],start:'btnStart'},
 training:{def:['btnTrnSandbox']},
 trials:{def:['[data-trial]']},
 daily:{def:['dailyPlay'],start:'dailyPlay'},
 customize:{def:['.czCard.on','.czCard']},
 lgSlots:{def:['.lgSlotCard']},
 lgSetup:{def:['lgSetupCreate'],start:'lgSetupCreate'},
 league:{def:['lgPlay','lgNext','lgCup'],start:'lgPlay'},
 championsCup:{def:['cupPlay','cupDone'],start:'cupPlay'}
};
/* ===== button glyphs =====
   One table for every prompt in the game — this strip, the in-match hint (js/hud.js `{A}` markup)
   and the Options reference card (`data-pad`). Keyed by the XBOX name of the standard-mapping SLOT:
   'A' is always button 0, the bottom face button, whatever the pad prints on it — so a Switch pad's
   'A' slot reads B. `c` is the hardware's own colour for a face button, which is what a player
   recognises before they have read anything.
   Shapes (`s`) are SVG path data in a 16-unit box, STROKED: the menu draws them as inline SVG and
   the HUD as Path2D off the same string. PlayStation's face buttons are shapes, not letters — no face
   this game ships carries ✕ ○ □ △, and a fallback font drew them in whatever it happened to have. */
const PAD_PATH={
 cross:'M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4',circle:'M3.9 8a4.1 4.1 0 1 0 8.2 0a4.1 4.1 0 1 0 -8.2 0',
 square:'M4.5 4.5H11.5V11.5H4.5Z',tri:'M8 3.7L12.5 11.4H3.5Z',
 menu:'M4.2 5.2H11.8M4.2 8H11.8M4.2 10.8H11.8',view:'M3.6 6.6H9.4V12.4H3.6ZM6.6 6.6V3.6H12.4V9.4H9.4',
 plus:'M8 4.2V11.8M4.2 8H11.8',minus:'M4.2 8H11.8',
 dpad:'M6.2 2.6H9.8V6.2H13.4V9.8H9.8V13.4H6.2V9.8H2.6V6.2H6.2Z',dlr:'M2.6 8L6 5.2V10.8ZM13.4 8L10 5.2V10.8Z',dud:'M8 2.6L5.2 6H10.8ZM8 13.4L5.2 10H10.8Z'
};
const PAD_GLYPH={
 xbox:{A:{t:'A',c:'#6cc644'},B:{t:'B',c:'#e8544a'},X:{t:'X',c:'#4d9be6'},Y:{t:'Y',c:'#f2c53d'},
  LB:{t:'LB'},RB:{t:'RB'},LT:{t:'LT'},RT:{t:'RT'},START:{s:'menu'},VIEW:{s:'view'}},
 ps:{A:{s:'cross',c:'#8fb2ee'},B:{s:'circle',c:'#ee6f78'},X:{s:'square',c:'#e295cf'},Y:{s:'tri',c:'#4fd0ab'},
  LB:{t:'L1'},RB:{t:'R1'},LT:{t:'L2'},RT:{t:'R2'},START:{t:'OPTIONS'},VIEW:{t:'CREATE'}},
 nin:{A:{t:'B'},B:{t:'A'},X:{t:'Y'},Y:{t:'X'},LB:{t:'L'},RB:{t:'R'},LT:{t:'ZL'},RT:{t:'ZR'},START:{s:'plus'},VIEW:{s:'minus'}}
};
const PAD_ANY={LS:{t:'L',stick:1},RS:{t:'R',stick:1},DPAD:{s:'dpad'},DLR:{s:'dlr'},DUD:{s:'dud'}};
/* {t,s,c,round} for a slot in the family of the pad that last did something. `round` = a face
   button, a stick or a one-symbol button: drawn as a disc. Everything else (shoulders, triggers,
   a worded OPTIONS) is a pill — both deliberately NOT the square keycap a keyboard key is. */
function padGlyph(k){
 const g=(PAD_GLYPH[NAV.fam]||PAD_GLYPH.xbox)[k]||PAD_ANY[k]||{t:k};
 return{t:g.t||'',s:g.s||'',c:g.c||'',stick:!!g.stick,round:!!(g.s||g.stick||/^[ABXY]$/.test(k))};
}
// The same glyph as markup. <kbd>, not <b>: the Options reference card styles every `.ctl b` as a
// keyboard keycap, and a pad button nested in one would have come out as a keycap inside a keycap.
function padSvg(s){return'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="'+PAD_PATH[s]+'"/></svg>';}
function padKeyHTML(k){const g=padGlyph(k);
 return'<kbd class="nhK'+(g.round?' f':'')+(g.stick?' st':'')+'"'+(g.c?' style="color:'+g.c+'"':'')+'>'+(g.s?padSvg(g.s):g.t)+'</kbd>';}
// Anything in the page marked data-pad re-labels itself when the family changes: "LT+A" is a chord,
// "LS/DPAD" is either one.
function padLabels(){for(const el of document.querySelectorAll('[data-pad]'))
 el.innerHTML=el.dataset.pad.split(/([+\/])/).map(s=>s==='+'||s==='/'?'<i class="nhSep">'+s+'</i>':s?padKeyHTML(s):'').join('');}
// The last device anything came from — 'pad' or 'kbm'. A solo seat holds keyboard, mouse AND pad,
// so the in-match hint asks this rather than the seat which prompts to draw (js/hud.js).
function inputKind(){return NAV.kind;}
const NAV_TABS='.scrTabs,.optTabs,.trlTabs,.czTeamTgl';

// Xbox is tested FIRST: its pads report "Xbox Wireless Controller", and a bare "wireless controller"
// is how a DualShock 4 names itself — the other order labels an Xbox pad's A as ✕.
function navFamily(gp){const id=(gp.id||'').toLowerCase();
 if(/xbox|045e|xinput/.test(id))return'xbox';
 if(/054c|playstation|dualshock|dualsense|wireless controller/.test(id))return'ps';
 if(/057e|nintendo|switch|pro controller/.test(id))return'nin';
 return'xbox';}
function navShown(el){return!!el&&!el.classList.contains('hidden')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';}
function navVis(el){if(!el||!el.isConnected)return false;const r=el.getBoundingClientRect();
 return r.width>=2&&r.height>=2&&getComputedStyle(el).visibility!=='hidden';}
function navable(el){
 const d=el.dataset&&el.dataset.nav;if(d==='off')return false;if(d)return true;
 const t=el.tagName;
 if(t==='BUTTON'||t==='SELECT'||t==='TEXTAREA')return!el.disabled;
 if(t==='INPUT')return!el.disabled&&!/^(hidden|color|file)$/.test(el.type);
 return typeof el.onclick==='function';
}
/* Everything the cursor can land on inside `root`. A clickable CONTAINER that holds clickable
   children loses to them (a league slot card with Continue/Delete in it), and nothing inside a
   `data-nav="capture"` region is a candidate — that region is one stop, and the pad is its own
   while it's focused (the Options live tester reads A and the sticks). */
function navCands(root){
 const c=[];if(navable(root)&&navVis(root))c.push(root);
 const all=root.querySelectorAll('*');
 for(let i=0;i<all.length;i++){const el=all[i];if(navable(el)&&navVis(el))c.push(el);}
 const caps=c.filter(el=>el.dataset.nav==='capture');
 const c1=caps.length?c.filter(a=>!caps.some(b=>b!==a&&b.contains(a))):c;
 return c1.filter(a=>a.dataset.nav==='capture'||!c1.some(b=>b!==a&&a.contains(b)));
}
// What the cursor can land on under a root: its own list if it declares one (the layout editor
// offers whole panels), else whatever the DOM says is clickable.
function navList(R){return R.cands?R.cands():navCands(R.el);}
// The layout editor's held panel (js/layout.js LAY_PAD), or null.
function navGrab(){return typeof LAY_PAD!=='undefined'&&LAY_PAD.el?LAY_PAD:null;}
// First visible match for a list of ids / selectors, inside root (root itself counts).
function navFind(root,list){
 for(const s of list||[]){const el=/^[.#\[]/.test(s)?root.querySelector(s):$(s);
  if(el&&(el===root||root.contains(el))&&navVis(el))return el;}
 return null;
}
function navScrollTo(el){
 for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
  if(p.scrollHeight<=p.clientHeight+1)continue;
  const oy=getComputedStyle(p).overflowY;if(oy!=='auto'&&oy!=='scroll')continue;
  const r=el.getBoundingClientRect(),q=p.getBoundingClientRect(),m=28;
  if(r.top<q.top+m)p.scrollTop-=q.top+m-r.top;else if(r.bottom>q.bottom-m)p.scrollTop+=r.bottom-q.bottom+m;
 }
}
function navSet(el){
 if(NAV.adj&&NAV.adj!==el)navAdjEnd(true);          // the cursor leaving a value it was editing keeps it
 if(NAV.el&&NAV.el!==el)NAV.el.classList.remove('navFocus');
 NAV.el=el;NAV.hintT=0;if(!el)return;
 el.classList.add('navFocus');
 if(NAV.root)NAV.mem[NAV.root.key]=el;
 navScrollTo(el);NAV.rect=el.getBoundingClientRect();
}
function navClear(){navAdjEnd(true);navDropEnd(false);if(NAV.el)NAV.el.classList.remove('navFocus');NAV.el=null;NAV.hintT=0;}
function navFirst(c){let b=null,bs=1e18;for(const el of c){const r=el.getBoundingClientRect(),s=r.top*4+r.left;if(s<bs){bs=s;b=el;}}return b;}
function navDefault(){
 const R=NAV.root;if(!R)return;const c=navList(R);if(!c.length){navSet(null);return;}
 const m=NAV.mem[R.key];if(m&&c.indexOf(m)>=0){navSet(m);return;}
 const d=navFind(R.el,R.def);
 if(d){if(c.indexOf(d)>=0){navSet(d);return;}const inn=c.filter(x=>d.contains(x));if(inn.length){navSet(navFirst(inn));return;}}
 navSet(navFirst(c));
}
// The focused element went away (re-render, tab switch): land on whatever sits nearest where it was.
function navRefocus(){
 const R=NAV.root;if(!R)return;const c=navList(R);if(!c.length){navSet(null);return;}
 if(!NAV.rect){navDefault();return;}
 const ax=(NAV.rect.left+NAV.rect.right)/2,ay=(NAV.rect.top+NAV.rect.bottom)/2;let b=null,bs=1e18;
 for(const el of c){const r=el.getBoundingClientRect(),x=(r.left+r.right)/2-ax,y=(r.top+r.bottom)/2-ay,s=x*x+y*y;if(s<bs){bs=s;b=el;}}
 navSet(b);
}
/* Nearest candidate in a direction. A candidate must sit at least half the smaller element's size
   further along than the current one, so a checkbox a few pixels lower in the SAME row never reads
   as "down". Among those: edge distance, plus the sideways gap at 1.2x. Measured, not picked: at 3x a
   WIDE element two rows down beat the narrow one directly next (Kick Off's tab bar → "Game time",
   skipping both AI rows and Goals); much under 1x and down drifts into the neighbouring panel. */
// The column a control belongs to for ◀▶: its panel, or a roster column inside one (Kick Off holds
// two teams' columns in a single panel, and ◀▶ between them is a move across, not along).
function navCol(el){return el.closest?(el.closest('.rosCol')||el.closest('.panel')):null;}
function navMove(dx,dy){
 const R=NAV.root;if(!R)return;const c=navList(R);if(!c.length)return;
 const cur=NAV.el&&c.indexOf(NAV.el)>=0?NAV.el:null;if(!cur){navRefocus();return;}
 const a=cur.getBoundingClientRect(),ax=(a.left+a.right)/2,ay=(a.top+a.bottom)/2,cc=navCol(cur);let b=null,bs=1e18;
 for(const el of c){if(el===cur)continue;
  const q=el.getBoundingClientRect(),bx=(q.left+q.right)/2,by=(q.top+q.bottom)/2;let edge,gap,off;
  if(dy){const m=Math.min(a.height,q.height)*.5;
   if(dy>0?(q.top<a.top+m||by<=ay):(q.bottom>a.bottom-m||by>=ay))continue;
   edge=dy>0?q.top-a.bottom:a.top-q.bottom;gap=Math.max(0,q.left-a.right,a.left-q.right);off=Math.abs(bx-ax);}
  else{const m=Math.min(a.width,q.width)*.5;
   if(dx>0?(q.left<a.left+m||bx<=ax):(q.right>a.right-m||bx>=ax))continue;
   edge=dx>0?q.left-a.right:a.left-q.right;gap=Math.max(0,q.top-a.bottom,a.top-q.bottom);off=Math.abs(by-ay);
   /* SIDEWAYS MEANS ANOTHER COLUMN unless it is the same row. A right-aligned checkbox three rows
      under a right-aligned dropdown has its centre further right and overlaps it in x, and it used to
      win "right" over the next panel entirely — so ◀▶ wandered down a column instead of across. */
   if(edge<-2&&gap>0)continue;}
  let s=Math.max(0,edge)+gap*1.2+off*.1;
  /* …AND ◀▶ GO TO THE NEXT PANEL, or nowhere. Inside a panel the controls are rows, so a sideways
     press that only finds another row of the SAME panel — or a control in no panel at all, like the
     tab strip or the corner gears — is really a diagonal, and is not a candidate. At the last panel
     ◀▶ simply stop; the first version fell back to them, and ◀ off the leftmost Options panel landed
     on Reset Controls, one A away from wiping every setting. */
  if(dx&&gap>0&&cc){const ec=navCol(el);if(!ec||ec===cc)continue;}
  if(s<bs){bs=s;b=el;}
 }
 if(b)navSet(b);
}
// A select wrapped as a ◀ VALUE ▶ selector (js/vsel.js). It adjusts in place like a slider; a bare
// dropdown (dev panels) still opens as a list.
function navVsel(el){return!!(el.parentElement&&el.parentElement.classList.contains('vsel'));}
function navFire(el){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
// ◀▶ on a value being EDITED. A slider moves a twentieth of its range, snapped to its own step. A
// selector steps one option, WRAPPING and skipping disabled/hidden ones (the same step as vselStep).
function navNudge(el,d){
 if(el.tagName==='SELECT'){const o=el.options||[],n=o.length;if(!n)return;let i=el.selectedIndex;
  for(let k=0;k<n;k++){i=(i+d+n)%n;if(!o[i].disabled&&!o[i].hidden)break;}
  if(i!==el.selectedIndex&&!o[i].disabled&&!o[i].hidden){el.selectedIndex=i;navFire(el);}return;}
 const mn=el.min===''?0:+el.min,mx=el.max===''?100:+el.max,st=+el.step||1,
  k=Math.max(st,Math.round((mx-mn)/20/st)*st),dp=(String(el.step).split('.')[1]||'').length;
 let v=clamp(+el.value+d*k,mn,mx);v=+clamp(mn+Math.round((v-mn)/st)*st,mn,mx).toFixed(dp);
 if(v===+el.value)return;el.value=v;navFire(el);
}
/* EDITING A VALUE. ◀▶ used to change a dropdown or slider the moment the cursor was on it, so the
   only way sideways out of a column of them was round them — ◀▶ could never mean "the next panel".
   Now ◀▶ always MOVES, and A opens the value: ◀▶ change it, A keeps it, B puts back what it was when A
   was pressed, and ▲▼ keep it and move on. The same rule as a text field, which A also has to open. */
function navAdjStart(el){
 NAV.adj=el;NAV.adjWas=el.tagName==='SELECT'?el.selectedIndex:el.value;
 el.classList.add('navAdj');NAV.hintT=0;
}
function navAdjEnd(keep){
 const el=NAV.adj;if(!el)return false;
 NAV.adj=null;el.classList.remove('navAdj');NAV.hintT=0;
 if(!keep&&el.isConnected){
  const was=NAV.adjWas;
  if(el.tagName==='SELECT'){if(el.selectedIndex!==was){el.selectedIndex=was;navFire(el);}}
  else if(String(el.value)!==String(was)){el.value=was;navFire(el);}
 }
 NAV.adjWas=null;return true;
}
/* A DROPDOWN OPENS AS A LIST, the way it does under the mouse — ▲▼ walk it, A picks, B closes it
   untouched. It has to be our own list: the browser's native picker (showPicker) takes only the real
   keyboard, so a pad could open it and then not move in it. Built fresh per open, positioned over the
   select (flipped above it when there is no room below), and the mouse can click it too. */
function navDropOpen(el){
 navDropEnd(false);
 const L=document.createElement('div');L.id='navDrop';L.classList.add('navDrop');L.setAttribute('role','listbox');
 const items=[];
 for(let i=0;i<el.options.length;i++){const o=el.options[i];if(o.hidden)continue;
  const d=document.createElement('div');d.classList.add('navDropI');if(o.disabled)d.classList.add('off');if(i===el.selectedIndex)d.classList.add('cur');
  d.textContent=o.textContent;d.dataset.i=i;
  if(!o.disabled)d.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();NAV.drop.i=items.indexOf(d);navDropEnd(true);});
  L.appendChild(d);items.push(d);}
 if(!items.length)return;
 document.body.appendChild(L);
 const r=el.getBoundingClientRect(),vh=innerHeight||document.documentElement.clientHeight;
 L.style.minWidth=Math.round(r.width)+'px';L.style.left=Math.round(r.left)+'px';
 const h=Math.min(L.scrollHeight,Math.max(120,vh*.6));L.style.maxHeight=h+'px';
 L.style.top=Math.round(r.bottom+h+8<=vh?r.bottom+2:Math.max(8,r.top-h-2))+'px';
 let i=items.findIndex(d=>+d.dataset.i===el.selectedIndex);if(i<0)i=0;
 NAV.drop={el,L,items,i};el.classList.add('navAdj');navDropMark();NAV.hintT=0;
}
function navDropMark(){const D=NAV.drop;if(!D)return;
 D.items.forEach((d,k)=>d.classList.toggle('on',k===D.i));
 const d=D.items[D.i];if(d){const t=d.offsetTop,b=t+d.offsetHeight;if(t<D.L.scrollTop)D.L.scrollTop=t;else if(b>D.L.scrollTop+D.L.clientHeight)D.L.scrollTop=b-D.L.clientHeight;}}
function navDropStep(d){const D=NAV.drop;if(!D)return;
 let i=D.i;for(let k=0;k<D.items.length;k++){i+=d;if(i<0||i>=D.items.length)return;if(!D.items[i].classList.contains('off'))break;}
 D.i=i;navDropMark();}
// pick=true takes the highlighted option (firing input/change only if it moved); false leaves it.
function navDropEnd(pick){
 const D=NAV.drop;if(!D)return false;NAV.drop=null;NAV.hintT=0;
 D.L.remove();
 D.el.classList.remove('navAdj');
 if(pick&&D.el.isConnected){const it=D.items[D.i];if(it){const n=+it.dataset.i;if(n!==D.el.selectedIndex){D.el.selectedIndex=n;navFire(D.el);}}}
 return true;
}
function navActivate(el){
 const t=el.tagName,ty=el.type;
 if(t==='SELECT'){if(navVsel(el))navAdjStart(el);else navDropOpen(el);return;}
 if(t==='INPUT'&&ty==='range'){navAdjStart(el);return;}
 if(t==='TEXTAREA'||(t==='INPUT'&&/^(text|number|search|email)$/.test(ty))){NAV.edit=el;el.focus();return;}
 if(typeof el.click==='function')el.click();else el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
}
function navBlur(){if(NAV.edit){NAV.edit.blur();NAV.edit=null;return true;}return false;}
function navBack(){
 const R=NAV.root;if(!R||!R.back)return;
 if(typeof R.back==='function'){R.back();return;}
 const b=navFind(R.el,[R.back]);if(b)b.click();
}
function navStrip(root){if(NAV.root&&NAV.root.lay)return null;for(const s of root.querySelectorAll(NAV_TABS))if(navVis(s))return s;return null;}
// LB/RB: the first visible tab strip on the layer, wrapping. The cursor follows onto the new tab.
function navTab(d){
 const R=NAV.root;if(!R)return;const s=navStrip(R.el);if(!s)return;
 const bs=[...s.children].filter(x=>navable(x)&&navVis(x));if(bs.length<2)return;
 let i=bs.findIndex(x=>x.classList.contains('on'));if(i<0)i=0;
 bs[(i+d+bs.length)%bs.length].click();
 if(NAV.show){const on=s.querySelector('.on');navSet(on&&navVis(on)?on:null);if(!NAV.el)navRefocus();}
}
function navScrollBy(v){
 const R=NAV.root;if(!R)return;
 for(let p=NAV.el||R.el;p&&p!==document.body;p=p.parentElement){
  if(p.scrollHeight>p.clientHeight+1){const oy=getComputedStyle(p).overflowY;if(oy==='auto'||oy==='scroll'){p.scrollTop+=v;return;}}
  if(p===R.el)break;
 }
}
function navRoot(){
 if(typeof layEditing!=='undefined'&&layEditing&&typeof layBar!=='undefined'&&navShown(layBar))
  return{key:'lay',el:layScreen(layEditing),lay:true,cands:layPadCands,def:layPanels(layEditing),back:()=>layEditEnd(),backLbl:'Done'};
 for(const L of NAV_LAYERS){const el=$(L.id);if(el&&navShown(el))return{key:L.id,el:el,def:L.def,back:L.back,backLbl:L.backLbl};}
 if(S.phase!=='menu')return null;             // a live match with nothing over it: the pad is gameplay's
 const id=screenId(),el=$(id);if(!el||!navShown(el))return null;
 const d=NAV_SCREENS[id]||{};
 return{key:id,el:el,def:d.def,start:d.start,back:'.backBtn',scr:SCREENS[id]};
}
// Show the cursor. Returns false when it was hidden, so a first press only REVEALS it —
// a stray A from the sofa never presses a button nobody could see was selected.
function navReveal(){
 if(NAV.show)return true;
 NAV.show=true;document.body.classList.add('padNav');
 if(NAV.el&&navVis(NAV.el)&&NAV.root&&NAV.root.el.contains(NAV.el))navSet(NAV.el);else navDefault();
 return false;
}
function navHide(){if(navGrab())layPadDrop(true);navAdjEnd(true);navDropEnd(false);if(!NAV.show)return;NAV.show=false;document.body.classList.remove('padNav');navHints(null);}
function navDir(dx,dy){
 if(!navReveal())return;
 if(navGrab()){layPadNudge(dx,dy);if(NAV.el)navScrollTo(NAV.el);return;}
 const el=NAV.el;
 if(NAV.drop){if(dy)navDropStep(dy);return;}        // an open list owns the D-pad: ▲▼ walk it, ◀▶ do nothing
 if(navBlur()){navMove(dx,dy);return;}
 if(el&&NAV.adj===el){
  if(dx){navNudge(el,dx);NAV.hintT=0;return;}      // a slider or a value selector; a bare select opens a list instead
  navAdjEnd(true);                                  // ▲▼ out of an edit keeps the value and moves on
 }
 navMove(dx,dy);
}
/* The prompt strip, bottom-right. Speaks to what's under the cursor (a select says Change, a
   checkbox Toggle) and to the family of the pad that last pressed something. Rebuilt only when its
   signature changes. */
function navHints(R){
 let h=NAV.hint;
 if(!R||!NAV.show){if(h)h.classList.add('hidden');NAV.hintSig='';return;}
 if(!h){h=NAV.hint=document.createElement('div');h.id='navHints';h.className='hidden';document.body.appendChild(h);}
 const el=NAV.el,p=[],G=navGrab();
 const t=el&&el.tagName,ty=el&&el.type;
 if(G)p.push(['DPAD',G.rz?'Resize':'Move'],['Y',G.rz?'Move':'Resize'],['A','Drop'],['B','Cancel']);
 else{
  if(NAV.drop)p.push(['DUD','Choose'],['A','Select'],['B','Close']);
  else if(el&&el.dataset.nav==='capture')p.push(['DPAD','Leave tester']);
  else if(el&&NAV.adj===el)p.push(['DLR','Adjust'],['A','Done'],['B','Cancel']);
  else if(t==='SELECT')p.push(['A',navVsel(el)?'Change':'Open']);
  else if(t==='INPUT'&&ty==='range')p.push(['A','Adjust']);
  else if(NAV.edit)p.push(['A','Done']);
  else if(t==='TEXTAREA'||(t==='INPUT'&&/^(text|number|search|email)$/.test(ty)))p.push(['A','Type']);
  else if(t==='INPUT'&&ty==='checkbox')p.push(['A','Toggle']);
  else if(el)p.push(['A',R.lay&&layPadIs(el)?'Grab':'Select']);
  if(!NAV.drop&&!(el&&NAV.adj===el)&&R.back&&(typeof R.back==='function'||navFind(R.el,[R.back])))p.push(['B',R.backLbl||'Back']);
  if(navStrip(R.el))p.push(['LB RB','Tabs']);
  const st=R.start&&navFind(R.el,[R.start]);
  if(st)p.push(['START',(st.textContent||'').replace(/[▶◀]/g,'').trim()]);
  if(R.scr&&R.scr.onPadStick)p.push(['RS','Rotate']);
 }
 const sig=NAV.fam+':'+p.map(x=>x.join('|')).join('/');
 if(sig!==NAV.hintSig){NAV.hintSig=sig;
  h.innerHTML=p.map(x=>'<span class="nhI">'+x[0].split(' ').map(padKeyHTML).join('')+x[1]+'</span>').join('');}
 h.classList.remove('hidden');
}
function padNavOwns(){return!!NAV.root;}
// gamepadUpdate calls this on its fresh edges: a press the menu used never reaches a rod.
function padNavFilter(idx,just){const e=NAV.eat[idx];if(!e)return;for(const k in just)if(just[k]&&e[k])just[k]=false;}

function navTick(t){
 requestAnimationFrame(navTick);
 const dt=NAV.t?Math.min(.05,(t-NAV.t)/1000):0;NAV.t=t;
 const pads=navigator.getGamepads?navigator.getGamepads():[];
 const ev=[];let dx=0,dy=0,lx=0,ly=0,rx=0,ry=0;
 for(let i=0;i<pads.length;i++){const gp=pads[i];if(!gp)continue;
  const pv=NAV.prev[i]||(NAV.prev[i]={}),ea=NAV.eat[i]||(NAV.eat[i]={});let hit=false;
  for(let b=0;b<gp.buttons.length&&b<17;b++){const d=gpDown(gp,b);if(d&&!pv[b]){ev.push([i,b]);hit=true;}if(!d)ea[b]=false;pv[b]=d;}
  if(gpDown(gp,12))dy=-1;else if(gpDown(gp,13))dy=1;
  if(gpDown(gp,14))dx=-1;else if(gpDown(gp,15))dx=1;
  const a=gp.axes;
  if(Math.abs(a[0]||0)>Math.abs(lx))lx=a[0];if(Math.abs(a[1]||0)>Math.abs(ly))ly=a[1];
  if(Math.abs(a[2]||0)>Math.abs(rx))rx=a[2];if(Math.abs(a[3]||0)>Math.abs(ry))ry=a[3];
  if(hit||Math.abs(a[0]||0)>.55||Math.abs(a[1]||0)>.55||Math.abs(a[2]||0)>.55||Math.abs(a[3]||0)>.55){
   const f=navFamily(gp);if(f!==NAV.fam){NAV.fam=f;padLabels();}NAV.kind='pad';}
 }
 // The intro takes any button as a skip, exactly like a key or a click (js/intro.js).
 if($('intro')){if(ev.length&&typeof introSkipHook==='function')introSkipHook();return;}
 if(NAV.edit&&document.activeElement!==NAV.edit)NAV.edit=null;
 const R=navRoot();
 if(navGrab()&&(!R||!R.lay))layPadDrop(true);
 if(NAV.adj&&(!NAV.adj.isConnected||!navVis(NAV.adj)))navAdjEnd(true);
 if(NAV.drop&&(!NAV.drop.el.isConnected||!navVis(NAV.drop.el)))navDropEnd(false);   // re-rendered or hidden under it
 if(!R){if(NAV.root){navClear();NAV.root=null;}navHints(null);return;}
 if(!NAV.root||NAV.root.key!==R.key||NAV.root.el!==R.el){
  // The remembered cursor is for coming BACK (out of a sub-screen, or an overlay closing on top);
  // entering a screen fresh starts on its default — Kick Off opens on START MATCH, not on whatever
  // was touched there last time.
  const P=NAV.root,back=!!P&&(P.key==='lay'||NAV_LAYERS.some(L=>L.id===P.key)||(SCREENS[P.key]||{}).back===R.key);
  if(!back)delete NAV.mem[R.key];
  NAV.root=R;navClear();NAV.dir='';if(NAV.show)navDefault();
 }
 else NAV.root=R;
 if(NAV.show){
  if(!NAV.el||!navVis(NAV.el)||!R.el.contains(NAV.el)){if((NAV.miss-=dt)<=0){NAV.miss=.25;navRefocus();}}
  else if(!NAV.el.classList.contains('navFocus'))NAV.el.classList.add('navFocus');   // a className rewrite dropped it
 }
 const cap=!!(NAV.el&&NAV.el.dataset.nav==='capture');
 // D-pad, else the left stick (not while the cursor is on a capture region — the tester owns it).
 if(!dx&&!dy&&!cap&&(Math.abs(lx)>.55||Math.abs(ly)>.55)){if(Math.abs(lx)>Math.abs(ly))dx=Math.sign(lx);else dy=Math.sign(ly);}
 if(dx&&dy)dx=0;
 const dk=dx||dy?dx+','+dy:'';
 if(dk){if(dk!==NAV.dir){NAV.dir=dk;NAV.rep=.38;navDir(dx,dy);}else if((NAV.rep-=dt)<=0){NAV.rep=.085;navDir(dx,dy);}}
 else NAV.dir='';
 for(const[i,b]of ev){
  const ea=NAV.eat[i];
  // A/B on an OPEN value (list, slider, selector) are that value's; the lobby's join/leave waits.
  if((b===0||b===1)&&!NAV.adj&&!NAV.drop&&R.scr&&R.scr.onPad&&R.scr.onPad(i,b)){ea[b]=true;continue;}
  // a held panel owns A (drop), B (put it back) and Y (move ⇄ resize); nothing else fires under it
  if(navGrab()){ea[b]=true;if(b===0)layPadDrop(true);else if(b===1)layPadDrop(false);else if(b===3)layPadMode();NAV.hintT=0;continue;}
  if(b===0){if(cap)continue;ea[0]=true;if(!navReveal())continue;if(navBlur()||navDropEnd(true)||navAdjEnd(true))continue;
   if(NAV.el){if(!(R.lay&&layPadGrab(NAV.el)))navActivate(NAV.el);NAV.hintT=0;}}
  else if(b===1){ea[1]=true;navReveal();if(navBlur()||navDropEnd(false)||navAdjEnd(false))continue;navBack();}
  else if(b===4||b===5){ea[b]=true;navReveal();navAdjEnd(true);navDropEnd(false);navTab(b===4?-1:1);}
  else if(b===9&&R.start){const s=navFind(R.el,[R.start]);if(s){ea[9]=true;navReveal();s.click();}}
 }
 if(!cap&&(Math.abs(rx)>.25||Math.abs(ry)>.25)){
  const h=R.scr&&R.scr.onPadStick;
  if(!(h&&h(Math.abs(rx)>.25?rx:0,Math.abs(ry)>.25?ry:0,dt))&&Math.abs(ry)>.25)navScrollBy(ry*900*dt);
 }
 if(NAV.show&&(NAV.hintT-=dt)<=0){NAV.hintT=.4;navHints(NAV.root);}
}
requestAnimationFrame(navTick);
padLabels();
// The mouse takes over again the moment it moves: the cursor ring goes, the pointer comes back.
addEventListener('mousemove',e=>{if(Math.abs(e.movementX)+Math.abs(e.movementY)>3){NAV.kind='kbm';navHide();}},{passive:true});
addEventListener('mousedown',()=>{NAV.kind='kbm';navHide();},{passive:true});
addEventListener('keydown',()=>{NAV.kind='kbm';},{passive:true});
