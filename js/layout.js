'use strict';
/* ===== layout — player-arrangeable panel grid ===== */
/* A registered screen's panels can be dragged/resized on a 16px grid via its ⊞ Layout
   button. Positions persist per screen in cfg.layouts[id] as {p:{elId:{x,y,w,h}},h}
   (px within the wrap). No save = the normal CSS flow, untouched. Panels hidden at
   runtime (scout/history/last-round) still get their coords applied, so they appear
   in-place the moment league.js un-hides them; in edit mode they show as ghosts so
   they can be placed.

   MAKING A REGION ARRANGEABLE IS A ONE-LINE CHANGE AND IT ISN'T IN THIS FILE: add a `lay`
   block to that screen's entry in SCREENS (js/screens.js) — {wrap, btn, panels} — give its
   panels stable ids in index.html, and drop a ⊞ button with the id you named. showScreen()
   applies every block on the screen, and the wiring loop at the bottom picks the buttons up at
   load. There is deliberately no second registry here to keep in sync.

   A SCREEN WITH TABS DECLARES AN ARRAY of blocks, each with its own `key` and `btn` — Kick Off
   has one for the team tab and one for the Match Setup tab, so each tab is arranged (and saved)
   independently. **The key is what cfg.layouts is stored under, so it must never change** or
   every saved arrangement under the old name is orphaned: 'menu' stays the Kick Off team tab,
   'league' the league lobby. A block with no key defaults to its screen id, which is what keeps
   single-region screens working unchanged. Everything below operates on a KEY, not a screen id;
   `layApplyScreen(id)` is the screen-level entry point. */
const LAY_G=16, LAY_MINW=224, LAY_MINH=128, LAY_PAD=18;
const LAY_BLOCKS={};
(function(){                       // index every block once — SCREENS is the only source of truth
 if(typeof SCREENS==='undefined')return;
 for(const id in SCREENS){
  const L=SCREENS[id].lay;if(!L)continue;
  (Array.isArray(L)?L:[L]).forEach(b=>{LAY_BLOCKS[b.key||id]={wrap:b.wrap,btn:b.btn,panels:b.panels,screen:id};});
 }
})();
function layDef(k){return LAY_BLOCKS[k]||null;}
function layPanels(k){const b=layDef(k);return b?b.panels:[];}
let layEditing=null, layBar=null, layRszT=0;
function laySnap(v){return Math.round(v/LAY_G)*LAY_G;}
function layWrap(k){const b=layDef(k);return b?document.querySelector(b.wrap):null;}
function layScreen(k){const b=layDef(k);return b?$(b.screen):null;}
/* Apply every arrangeable region on a screen. Called by showScreen; a tab that's currently
   hidden is skipped by layApply and re-applied when its tab button reveals it. */
function layApplyScreen(id){for(const k in LAY_BLOCKS)if(LAY_BLOCKS[k].screen===id)layApply(k);}
function layFlow(k){const w=layWrap(k);if(!w)return;w.classList.remove('lyCustom');w.style.height='';w.style.width='';
 const sc=layScreen(k);if(sc)sc.classList.remove('lyScroll');
 layPanels(k).forEach(p=>{const el=$(p);if(el){el.style.left=el.style.top=el.style.width=el.style.height='';}});}
/* flow rects → grid coords; panels hidden in flow get slotted in a row underneath */
function layCapture(k){
 const w=layWrap(k),wr=w.getBoundingClientRect(),o={},hid=[];let mb=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  if(el.classList.contains('hidden')||!el.offsetParent){hid.push(p);return;}
  const r=el.getBoundingClientRect();
  o[p]={x:laySnap(r.left-wr.left),y:laySnap(r.top-wr.top),w:Math.max(LAY_MINW,laySnap(r.width)),h:Math.max(LAY_MINH,laySnap(r.height))};
  mb=Math.max(mb,o[p].y+o[p].h);});
 hid.forEach((p,i)=>{o[p]={x:laySnap(LAY_PAD+i*400),y:laySnap(mb+LAY_PAD),w:384,h:288};});
 return o;
}
function layApply(k){
 const w=layWrap(k);if(!w)return;
 // A wrap inside a hidden TAB measures 0 wide, which would squash every panel to the minimum.
 // Skip it; the tab button re-applies on reveal.
 if(!w.offsetParent&&!w.clientWidth)return;
 const L=cfg.layouts&&cfg.layouts[k];
 if(!L||!L.p||innerWidth<=1040){layFlow(k);return;}  // ≤1040px = the stacked mobile flow, leave it alone
 w.classList.add('lyCustom');layScreen(k).classList.add('lyScroll'); // custom heights need a top-anchored scrollable screen
 // The wrap hugs its content on BOTH axes, so arranging panels into a narrow cluster doesn't
 // leave a slab of empty dotted box either side of them.
 // Panels are clamped against the width the wrap is ALLOWED to be, measured with the inline
 // width cleared — clamping against its CURRENT (already shrunk) width would ratchet the box
 // narrower on every call. Clearing first also means each wrap honours its own CSS max-width
 // (.panelWrap 1640, .lgWrap 1820) with no constant here to keep in sync.
 w.style.width='';
 // box-sizing:border-box means the wrap's width includes padding+border, but clientWidth is
 // content+padding only. Measure the content area explicitly so panel positions (which are
 // relative to the content area) stay consistent.
 const cs=getComputedStyle(w);
 const padX=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
 const padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
 const bordX=parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
 const bordY=parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);
 const avail=Math.max(LAY_MINW+LAY_PAD*2,w.clientWidth-padX);   // content area width; floor guards against a collapsed measurement
 let mb=0,mr=0,nu=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  // No saved spot = a panel added to the screen SINCE the player last arranged it. Park those in
  // a fresh grid below the saved arrangement — the old version offset each by 40px in y alone,
  // so two new panels landed almost exactly on top of each other and read as one.
  let st=L.p[p];
  if(!st){const c=nu++;st={x:LAY_PAD+(c%3)*(384+LAY_PAD),y:(L.h||400)+LAY_PAD+Math.floor(c/3)*(288+LAY_PAD),w:384,h:288};}
  const pw=Math.min(st.w,Math.max(LAY_MINW,avail-LAY_PAD*2)),px=clamp(st.x,0,Math.max(0,avail-pw));
  el.style.left=px+'px';el.style.top=st.y+'px';el.style.width=pw+'px';el.style.height=st.h+'px';
  // hidden panels count toward both extents — the wrap stays big enough when they pop in later
  mb=Math.max(mb,st.y+st.h);mr=Math.max(mr,px+pw);});
 // While EDITING, hold the full canvas so there's empty space to drag a panel out into; a wrap
 // shrink-wrapped to its panels would have nowhere to drop one.
 // The wrap's width property is border-box, so add back padding+border to get the correct size.
 w.style.width=(layEditing===k?avail+padX+bordX:clamp(mr+LAY_PAD,LAY_MINW+LAY_PAD*2,avail)+padX+bordX)+'px';
 w.style.height=(mb+LAY_PAD+padY+bordY)+'px';
}
/* ---- edit mode ---- */
function layEditStart(k){
 if(layEditing)return;
 const w=layWrap(k);if(!w||innerWidth<=1040)return;
 if(!(cfg.layouts&&cfg.layouts[k]&&cfg.layouts[k].p)){if(!cfg.layouts)cfg.layouts={};cfg.layouts[k]={p:layCapture(k),h:0};}
 layEditing=k;layApply(k);
 w.classList.add('lyEditing');
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;const h=document.createElement('span');h.className='lyRz';el.appendChild(h);});
 w.addEventListener('pointerdown',layDown);
 layBar=document.createElement('div');layBar.id='lyBar';
 layBar.innerHTML='<span class="lyBarTxt">⊞ EDIT LAYOUT — drag a panel to move · drag its corner to resize</span>';
 const bd=document.createElement('button');bd.className='btn';bd.textContent='✓ Done';bd.onclick=layEditEnd;
 const br=document.createElement('button');br.className='btn ghost';br.textContent='Reset layout';br.onclick=layReset;
 layBar.append(bd,br);layScreen(k).appendChild(layBar);
}
function layEditEnd(){
 const k=layEditing;if(!k)return;
 const w=layWrap(k);
 w.classList.remove('lyEditing');w.removeEventListener('pointerdown',layDown);
 w.querySelectorAll('.lyRz').forEach(h=>h.remove());
 layEditing=null;if(layBar){layBar.remove();layBar=null;}
 layApply(k);Au.ui();
}
function layReset(){
 const k=layEditing;if(!k)return;
 delete cfg.layouts[k];saveCfg();layEditEnd(); // layApply inside sees no save → back to CSS flow
}
function layDown(e){
 const k=layEditing;if(!k)return;
 const el=e.target.closest('.panel');if(!el)return;
 e.preventDefault();e.stopPropagation();
 const w=layWrap(k),rz=e.target.classList.contains('lyRz'),ww=w.clientWidth;
 const sx=e.clientX,sy=e.clientY,ox=parseFloat(el.style.left)||0,oy=parseFloat(el.style.top)||0,
       ow=parseFloat(el.style.width)||el.offsetWidth,oh=parseFloat(el.style.height)||el.offsetHeight;
 el.classList.add('lyDrag');
 const mv=ev=>{const dx=ev.clientX-sx,dy=ev.clientY-sy;
  if(rz){el.style.width=clamp(laySnap(ow+dx),LAY_MINW,Math.max(LAY_MINW,ww-ox))+'px';el.style.height=Math.max(LAY_MINH,laySnap(oh+dy))+'px';}
  else{const nw=parseFloat(el.style.width)||ow;el.style.left=clamp(laySnap(ox+dx),0,Math.max(0,ww-nw))+'px';el.style.top=Math.max(0,laySnap(oy+dy))+'px';}};
 const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);el.classList.remove('lyDrag');laySave(k);};
 addEventListener('pointermove',mv);addEventListener('pointerup',up);addEventListener('pointercancel',up);
}
function laySave(k){
 const w=layWrap(k),o={};let mb=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  o[p]={x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0,w:parseFloat(el.style.width),h:parseFloat(el.style.height)};
  mb=Math.max(mb,o[p].y+o[p].h);});
 cfg.layouts[k]={p:o,h:mb};
 // Account for padding+border since the wrap's height is border-box
 const cs=getComputedStyle(w);
 const padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
 const bordY=parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);
 w.style.height=(mb+LAY_PAD+padY+bordY)+'px';saveCfg();
}
/* ---- wiring ---- */
/* Every `lay` block gets its ⊞ button bound here — declare one in SCREENS and it's picked up on
   the next load with no edit to this file. */
for(const k in LAY_BLOCKS){const b=$(LAY_BLOCKS[k].btn);
 if(b)b.onclick=()=>{layEditing===k?layEditEnd():(Au.ui(),layEditStart(k));};}
addEventListener('resize',()=>{clearTimeout(layRszT);layRszT=setTimeout(()=>{
 if(layEditing)return;
 const id=screenId();                                  // only the LIVE screen is worth re-clamping…
 if(!$(id).classList.contains('hidden'))layApplyScreen(id);   // …and not while a match has it hidden (clientWidth would read 0)
 },150);});
layApplyScreen(screenId()); // whichever screen is live at boot (showScreen handles every later arrival)
