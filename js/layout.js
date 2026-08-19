'use strict';
/* ===== layout — player-arrangeable panel grid ===== */
/* A registered screen's panels can be dragged/resized on a 16px grid via its ⊞ Layout
   button. Positions persist per screen in cfg.layouts[id] as {p:{elId:{x,y,w,h}},h,w}
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
   `layApplyScreen(id)` is the screen-level entry point.

   ---- THE COORDINATE MODEL (read this before touching the maths) ----
   Saved coords are RELATIVE TO THE ARRANGEMENT, not to the wrap: laySave subtracts the
   arrangement's own top-left so a saved box always starts at 0,0. The absolute offset a panel
   happened to sit at is a property of the WINDOW IT WAS EDITED IN, not of the arrangement, and
   baking it in is what used to leave a slab of empty dotted box down one side.

   layApply re-origins on every apply, and it does so around the arrangement's CENTRE:

     display mode   the wrap is exactly bbox + LAY_G on all four sides. `margin:0 auto`
                    centres it, so the panels land centred on the parent.
     edit mode      the wrap opens out to the full width it's allowed (so there's empty canvas
                    to drag a panel into) and the panels are offset by HALF that extra width.

   Both modes therefore put the arrangement on the same screen pixel: opening and closing the
   editor grows and shrinks the canvas AROUND the panels instead of dragging them sideways with
   it. That symmetry is the whole trick — if you change one of the two offsets, change the other.

   Absolutely-positioned children resolve `left`/`top` against the wrap's PADDING BOX, so every
   measurement below is padding-box (`clientWidth`), and only the border is added back when the
   result is written to `style.width` (box-sizing is border-box globally). Don't mix in
   `getComputedStyle` padding here; padding does not move an absolute child. */
const LAY_G=16;                    // the grid — and the margin the wrap keeps around its panels
const LAY_MINW=224, LAY_MINH=128;  // smallest a panel may be resized to
const LAY_BP=1040;                 // ≤ this is the stacked mobile flow (keep in sync with the @media in styles.css)
const LAY_DROP=192;                // spare canvas kept below the arrangement in edit mode, to drag panels out into
const LAY_NEWW=384, LAY_NEWH=288;  // default box for a panel with no saved spot
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
let layEditing=null, layBar=null, layRszT=0, layTxT=0;
const LAY_OBS={};                  // key → {o:MutationObserver, t:timer} (see layWatch)
function laySnap(v){return Math.round(v/LAY_G)*LAY_G;}
function layWrap(k){const b=layDef(k);return b?document.querySelector(b.wrap):null;}
function layScreen(k){const b=layDef(k);return b?$(b.screen):null;}
/* Border only — see the coordinate note in the header. */
function layBord(w){const cs=getComputedStyle(w);
 return {x:parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth),
         y:parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth)};}
function layLive(w){return !!w&&!!(w.offsetParent||w.clientWidth);}

/* Apply every arrangeable region on a screen. Called by showScreen; a tab that's currently
   hidden is skipped by layApply and re-applied when its tab button reveals it. */
function layApplyScreen(id){
 layEditGuard();
 for(const k in LAY_BLOCKS)if(LAY_BLOCKS[k].screen===id)layApply(k);
}
/* An editor left open by a screen change or a tab flip is torn down HERE rather than by a hook in
   every navigation path: if the wrap being edited is no longer on screen, the session is over.
   Before this, Esc-ing out of the league mid-edit left layEditing set, the panels dashed and
   draggable, and #lyBar orphaned inside a display:none screen. */
function layEditGuard(){
 if(layEditing&&!layLive(layWrap(layEditing)))layEditEnd();
}
/* Animate the next size/position change (the editor opening or closing, or a panel appearing).
   Panels and the wrap share one easing on purpose: the wrap re-centres as it resizes, so if only
   one side animated the arrangement would slide out and settle back instead of sitting still. */
function layAnim(k){
 const w=layWrap(k);if(!w)return;
 w.classList.add('lyTx');clearTimeout(layTxT);
 layTxT=setTimeout(()=>{const el=layWrap(k);if(el)el.classList.remove('lyTx');},340);
}
function layFlow(k){
 const w=layWrap(k);if(!w)return;
 w.classList.remove('lyCustom','lyTx');w.style.height='';w.style.width='';
 layPanels(k).forEach(p=>{const el=$(p);if(el){el.style.left=el.style.top=el.style.width=el.style.height='';}});
 layUnwatch(k);
 // The screen's scroll mode belongs to the SCREEN, not to one block: Kick Off has two arrangeable
 // tabs sharing #menu, so this only comes off once NO block on the screen is custom — otherwise
 // flipping to an un-arranged tab stripped the scroll mode off an arranged one.
 const sc=layScreen(k);if(sc&&!sc.querySelector('.lyCustom'))sc.classList.remove('lyScroll');
}
/* flow rects → grid coords, normalised so the arrangement's own top-left is 0,0. Panels hidden in
   flow are slotted into a row underneath, within the arrangement's own left and right edges — the
   old version stepped them 400px apart from x=18 regardless of where the panels actually were, so
   they hung off both sides of the arrangement they were supposed to be parked under. */
function layCapture(k){
 const w=layWrap(k),wr=w.getBoundingClientRect(),cs=getComputedStyle(w),o={},hid=[];
 const bl=wr.left+parseFloat(cs.borderLeftWidth),bt=wr.top+parseFloat(cs.borderTopWidth);
 let mnx=Infinity,mxr=0,mb=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  if(el.classList.contains('hidden')||!el.offsetParent){hid.push(p);return;}
  const r=el.getBoundingClientRect();
  o[p]={x:laySnap(r.left-bl),y:laySnap(r.top-bt),w:Math.max(LAY_MINW,laySnap(r.width)),h:Math.max(LAY_MINH,laySnap(r.height))};
  mnx=Math.min(mnx,o[p].x);mxr=Math.max(mxr,o[p].x+o[p].w);mb=Math.max(mb,o[p].y+o[p].h);});
 if(mnx===Infinity){mnx=0;mxr=LAY_NEWW;}
 // Park the ghosts in a row UNDER the visible arrangement and inside its own left/right edges.
 // Anywhere wider and the day one of them un-hides the wrap has to grow sideways as well as
 // down, which reads as the whole lobby lurching across; kept within the span it only grows down.
 const span=Math.max(LAY_MINW,mxr-mnx),cols=Math.max(1,Math.floor((span+LAY_G)/(LAY_NEWW+LAY_G)));
 const gw=Math.max(LAY_MINW,Math.min(LAY_NEWW,laySnap((span-(cols-1)*LAY_G)/cols)));
 hid.forEach((p,i)=>{o[p]={x:mnx+(i%cols)*(gw+LAY_G),y:mb+LAY_G+Math.floor(i/cols)*(LAY_NEWH+LAY_G),w:gw,h:LAY_NEWH};});
 return layNormalise(o);
}
/* Slide an arrangement so its own top-left is 0,0 and report its size. Everything that writes
   cfg.layouts goes through here, so a saved layout never carries the window it was made in. */
function layNormalise(o){
 let mnx=Infinity,mny=Infinity,mxr=0,mxb=0;
 for(const p in o){mnx=Math.min(mnx,o[p].x);mny=Math.min(mny,o[p].y);}
 if(mnx===Infinity)return {p:o,w:0,h:0};
 for(const p in o){o[p].x-=mnx;o[p].y-=mny;mxr=Math.max(mxr,o[p].x+o[p].w);mxb=Math.max(mxb,o[p].y+o[p].h);}
 return {p:o,w:mxr,h:mxb};
}
/* Resolve every panel in a block to a live box, clamped to what the wrap can hold.
   `ghost` = hidden at runtime (scout / history / last round). A ghost still gets its coords
   applied so it lands in place the instant league.js un-hides it, but OUTSIDE edit mode it is NOT
   part of the box the wrap shrink-wraps to — reserving room for panels that aren't on screen is
   what left the lobby floating at the top of 450px of empty dotted box. */
function layBoxes(k,L,availPad){
 // grid-aligned so a panel clamped to the full width still lands on the dots
 const out=[],maxW=Math.max(LAY_MINW,Math.floor((availPad-LAY_G*2)/LAY_G)*LAY_G);let nu=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  // No saved spot = a panel added to the screen SINCE the player last arranged it. Park those in
  // a fresh grid below the saved arrangement — the old version offset each by 40px in y alone,
  // so two new panels landed almost exactly on top of each other and read as one.
  let st=L.p[p];
  if(!st){const c=nu++;st={x:LAY_G+(c%3)*(LAY_NEWW+LAY_G),y:(L.h||400)+LAY_G+Math.floor(c/3)*(LAY_NEWH+LAY_G),w:LAY_NEWW,h:LAY_NEWH};}
  out.push({el,x:st.x,y:st.y,w:clamp(st.w,LAY_MINW,maxW),h:Math.max(LAY_MINH,st.h),
            ghost:el.classList.contains('hidden')});});
 return out;
}
/* Bounding box over the resolved boxes. `all` includes ghosts (edit mode shows them). */
function layBBox(bx,all){
 let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
 bx.forEach(o=>{if(!all&&o.ghost)return;
  l=Math.min(l,o.x);t=Math.min(t,o.y);r=Math.max(r,o.x+o.w);b=Math.max(b,o.y+o.h);});
 return l===Infinity?null:{l,t,r,b,w:r-l,h:b-t};
}
/* The width the wrap is ALLOWED to be, in padding-box px. Measured with the inline width cleared:
   reading its CURRENT (already shrunk) width would ratchet the box narrower on every call, and
   clearing first is also what lets each wrap honour its own CSS max-width (.panelWrap 1640,
   .lgWrap 1820) without a duplicate constant in here.
   .lyMeasure suppresses the transition for the round trip, then the forced reflow commits the
   restored width as the animation's starting point. Without that the read lands mid-tween and
   comes back as whatever the box was on its way from — which read as the edit canvas silently
   refusing to open out on every toggle after the first. */
function layAvail(w){
 w.classList.add('lyMeasure');
 const prev=w.style.width;
 w.style.width='';
 const a=w.clientWidth;
 w.style.width=prev;
 void w.offsetWidth;                       // flush with transitions still off
 w.classList.remove('lyMeasure');
 return a;
}
function layApply(k){
 layEditGuard();
 const w=layWrap(k);if(!w)return;
 // A wrap inside a hidden TAB measures 0 wide, which would squash every panel to the minimum.
 // Skip it; the tab button re-applies on reveal.
 if(!layLive(w))return;
 const L=cfg.layouts&&cfg.layouts[k];
 if(!L||!L.p||innerWidth<=LAY_BP){layFlow(k);return;}  // ≤LAY_BP = the stacked mobile flow, leave it alone
 const ed=(layEditing===k);
 w.classList.add('lyCustom');layScreen(k).classList.add('lyScroll'); // custom heights need a top-anchored scrollable screen
 layWatch(k);
 const bd=layBord(w);
 const availPad=Math.max(LAY_MINW+LAY_G*2,layAvail(w));     // padding box — the box absolute panels position against
 const bx=layBoxes(k,L,availPad);
 const vb=layBBox(bx,false)||layBBox(bx,true);              // what shrink-wrapping hugs: ghosts are out of it unless we're editing
 if(!vb){w.style.width=w.style.height='';return;}
 // An arrangement built on a 1920 monitor can be wider than the window it's next opened in. Squeeze
 // it HORIZONTALLY as one piece rather than clamping each panel against the right edge on its own,
 // which is what used to slide them into a heap in the corner with the arrangement destroyed.
 const fit=Math.min(1,(availPad-LAY_G*2)/Math.max(1,vb.w));
 // Both EDGES are squeezed and floored to the grid, and the width is then the distance between
 // them — squeezing the width separately would let a panel's right edge cross its neighbour's
 // left edge by up to a grid square, i.e. the squeeze would introduce the overlaps it exists to
 // prevent. Flooring (not rounding) is also what keeps the far right edge inside the box, so the
 // margin stays exactly LAY_G instead of eating into it.
 const sq=v=>Math.floor(v*fit/LAY_G)*LAY_G;
 // PASS 1 — place relative to the arrangement's own top-left, then measure what that came to.
 let bw=0,bh=0,eh=0;
 bx.forEach(o=>{const l=o.x-vb.l;o.px=sq(l);o.pw=Math.max(LAY_MINW,sq(l+o.w)-o.px);o.py=o.y-vb.t;
  eh=Math.max(eh,o.py+o.h);if(o.ghost&&!ed)return;bw=Math.max(bw,o.px+o.pw);bh=Math.max(bh,o.py+o.h);});
 // PASS 2 — offX is snapped to the grid so panels keep landing on the dots the editor draws, and
 // the edit canvas is sized to bbox + 2·offX so it stays SYMMETRIC about the arrangement. Symmetry
 // is what makes the two modes agree: wrap centred in the parent + arrangement centred in the wrap
 // = arrangement centred in the parent, at any canvas width.
 const offX=ed?Math.max(LAY_G,Math.floor((availPad-bw)/2/LAY_G)*LAY_G):LAY_G;
 const padW=Math.min(availPad,bw+offX*2);
 bx.forEach(o=>{const el=o.el;
  el.style.left=clamp(o.px+offX,0,Math.max(0,padW-o.pw))+'px';
  el.style.top=(o.py+LAY_G)+'px';   // the vertical offset matches in both modes: the wrap is top-anchored, so its height never moves a panel
  el.style.width=o.pw+'px';el.style.height=o.h+'px';});
 const padH=(ed?eh:bh)+LAY_G*2+(ed?LAY_DROP:0);
 w.style.width=(padW+bd.x)+'px';
 w.style.height=(padH+bd.y)+'px';
 // Every left/top written above is a multiple of LAY_G measured from the wrap's padding-box
 // origin (offX is snapped, saved coords are snapped, the squeeze re-snaps), which is the same
 // origin the dotted texture and the editor's grid overlay are painted from — so the panels sit
 // on the dots at any canvas width, with no background-position correction to keep in step.
}
/* A panel that league.js shows or hides at runtime changes what the wrap has to hug. Watching the
   class attribute keeps that self-contained: league.js goes on calling
   classList.toggle('hidden', …) in a dozen places and the box follows, with no layRefresh() calls
   to remember and no second registry of "panels that come and go". */
function layWatch(k){
 if(LAY_OBS[k]||typeof MutationObserver!=='function')return;
 const rec={t:0};
 rec.o=new MutationObserver(()=>{
  if(layEditing)return;                                     // ghosts are already on show in edit mode
  clearTimeout(rec.t);
  rec.t=setTimeout(()=>{layAnim(k);layApply(k);},0);        // one re-apply for a burst of toggles
 });
 layPanels(k).forEach(p=>{const el=$(p);if(el)rec.o.observe(el,{attributes:true,attributeFilter:['class']});});
 LAY_OBS[k]=rec;
}
function layUnwatch(k){const r=LAY_OBS[k];if(!r)return;clearTimeout(r.t);r.o.disconnect();delete LAY_OBS[k];}
/* ---- edit mode ---- */
function layEditStart(k){
 if(layEditing)return;
 const w=layWrap(k);if(!w||!layLive(w)||innerWidth<=LAY_BP)return;
 if(!(cfg.layouts&&cfg.layouts[k]&&cfg.layouts[k].p)){
  if(!cfg.layouts)cfg.layouts={};
  const c=layCapture(k);cfg.layouts[k]={p:c.p,h:c.h,w:c.w};
 }
 layEditing=k;layAnim(k);layApply(k);
 w.classList.add('lyEditing');
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;const h=document.createElement('span');h.className='lyRz';el.appendChild(h);});
 w.addEventListener('pointerdown',layDown);
 layBar=document.createElement('div');layBar.id='lyBar';
 layBar.innerHTML='<span class="lyBarTxt">⊞ EDIT LAYOUT — drag a panel to move · drag its corner to resize</span>';
 const bd=document.createElement('button');bd.className='btn';bd.textContent='✓ Done';bd.onclick=layEditEnd;
 const br=document.createElement('button');br.className='btn ghost';br.textContent='Reset layout';br.onclick=layReset;
 layBar.append(bd,br);layScreen(k).appendChild(layBar);
}
/* layEditing is cleared FIRST so the layApply below runs as a display-mode apply — and so the
   layEditGuard at the top of layApply can't re-enter this. */
function layEditEnd(){
 const k=layEditing;if(!k)return;
 layEditing=null;
 const w=layWrap(k);
 if(w){w.classList.remove('lyEditing');w.removeEventListener('pointerdown',layDown);
  w.querySelectorAll('.lyRz').forEach(h=>h.remove());}
 if(layBar){layBar.remove();layBar=null;}
 layAnim(k);layApply(k);                                    // the canvas collapses back around the panels
 if(typeof Au!=='undefined')Au.ui();
}
function layReset(){
 const k=layEditing;if(!k)return;
 delete cfg.layouts[k];saveCfg();layEditEnd(); // layApply inside sees no save → back to CSS flow
}
function layDown(e){
 const k=layEditing;if(!k)return;
 const el=e.target.closest('.panel');if(!el)return;
 e.preventDefault();e.stopPropagation();
 const w=layWrap(k),rz=e.target.classList.contains('lyRz'),ww=w.clientWidth;  // padding box — the same space panel coords live in
 const sx=e.clientX,sy=e.clientY,ox=parseFloat(el.style.left)||0,oy=parseFloat(el.style.top)||0,
       ow=parseFloat(el.style.width)||el.offsetWidth,oh=parseFloat(el.style.height)||el.offsetHeight;
 el.classList.add('lyDrag');w.classList.remove('lyTx');     // never animate under the cursor
 const mv=ev=>{const dx=ev.clientX-sx,dy=ev.clientY-sy;
  if(rz){el.style.width=clamp(laySnap(ow+dx),LAY_MINW,Math.max(LAY_MINW,ww-ox))+'px';el.style.height=Math.max(LAY_MINH,laySnap(oh+dy))+'px';}
  else{const nw=parseFloat(el.style.width)||ow;el.style.left=clamp(laySnap(ox+dx),0,Math.max(0,ww-nw))+'px';el.style.top=Math.max(0,laySnap(oy+dy))+'px';}};
 const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);
  el.classList.remove('lyDrag');laySave(k);layGrow(k);};
 addEventListener('pointermove',mv);addEventListener('pointerup',up);addEventListener('pointercancel',up);
}
function laySave(k){
 const o={};
 layPanels(k).forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  o[p]={x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0,w:parseFloat(el.style.width),h:parseFloat(el.style.height)};});
 const n=layNormalise(o);
 cfg.layouts[k]={p:n.p,h:n.h,w:n.w};
 saveCfg();
}
/* Re-size the EDIT canvas after a drag — a panel dragged past the bottom needs the box to follow,
   and the drop zone underneath has to be re-established. Deliberately reads the live DOM instead
   of calling layApply: re-applying would re-centre the arrangement mid-session and yank the panel
   out from under the cursor the moment it was released. */
function layGrow(k){
 const w=layWrap(k);if(!w||layEditing!==k)return;
 let b=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  b=Math.max(b,(parseFloat(el.style.top)||0)+parseFloat(el.style.height));});
 w.style.height=(b+LAY_G+LAY_DROP+layBord(w).y)+'px';
}
/* ---- wiring ---- */
/* Every `lay` block gets its ⊞ button bound here — declare one in SCREENS and it's picked up on
   the next load with no edit to this file. */
for(const k in LAY_BLOCKS){const b=$(LAY_BLOCKS[k].btn);
 if(b)b.onclick=()=>{layEditing===k?layEditEnd():(typeof Au!=='undefined'&&Au.ui(),layEditStart(k));};}
/* Below LAY_BP the arranger is inert (layApply hands the screen back to the CSS flow), so the ⊞
   would be a button that visibly does nothing. Its own screen code owns .hidden — hence a
   separate class rather than two bits of code fighting over one. */
function layBtnVis(){
 const off=innerWidth<=LAY_BP;
 for(const k in LAY_BLOCKS){const b=$(LAY_BLOCKS[k].btn);if(b)b.classList.toggle('lyOff',off);}
}
addEventListener('resize',()=>{clearTimeout(layRszT);layRszT=setTimeout(()=>{
 layBtnVis();
 if(layEditing)return;                                 // re-centring mid-session would move the panels out from under the player
 const id=screenId();                                  // only the LIVE screen is worth re-clamping…
 if(!$(id).classList.contains('hidden'))layApplyScreen(id);   // …and not while a match has it hidden (clientWidth would read 0)
 },150);});
layBtnVis();
layApplyScreen(screenId()); // whichever screen is live at boot (showScreen handles every later arrival)
