'use strict';
/* ===== layout — player-arrangeable panel grid ===== */
// panels of a registered screen are draggable and resizable on a 16px grid (the ⊞ Layout button)
// saved in cfg.layouts[key] as {v:2,p:{elId:{x,y,w,h}},h}: x and w are fractions of the canvas width, y and h px; no save = the CSS flow
// to make a region arrangeable add a `lay` block {wrap, btn, panels} to its SCREENS entry (js/screens.js) with stable panel ids and a ⊞ button; a tabbed screen declares an array of blocks
// the key is what cfg.layouts is stored under: never change one
// ---- COORDINATE MODEL (read before touching the maths) ----
// saved coords are relative to the arrangement (laySave subtracts its top-left), not the wrap
// layApply re-origins around the arrangement's centre: display mode wraps bbox + LAY_G (margin:0 auto), edit mode opens the wrap to full width and offsets panels by half the extra; change one offset and you change the other
// absolute children resolve against the padding box, so measure with clientWidth and add the border back only for style.width
// ---- THE STORED FORM (v:2) ----
// across the width a layout is fractions of the canvas (cell = box + the gutter after it), so it scales between monitors; down the page it stays px; a v1 (px) save converts on first apply
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

// apply every arrangeable region on a screen (from showScreen); a hidden tab is skipped and applied when revealed
function layApplyScreen(id){
 layEditGuard();
 for(const k in LAY_BLOCKS)if(LAY_BLOCKS[k].screen===id)layApply(k);
}
// an editor left open by a screen change or tab flip is torn down here, not by a hook in every navigation path
function layEditGuard(){
 if(layEditing&&!layLive(layWrap(layEditing)))layEditEnd();
}
// animate the next size/position change; panels and wrap share one easing so the arrangement doesn't slide and settle
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
 // the scroll mode belongs to the screen, not a block, so it comes off only once no block is custom
 const sc=layScreen(k);if(sc&&!sc.querySelector('.lyCustom'))sc.classList.remove('lyScroll');
}
// flow rects to grid coords, normalised to the arrangement's top-left; hidden panels go in a row underneath
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
 // park ghosts in a row under the visible arrangement and inside its edges, so un-hiding one only grows the wrap down
 const span=Math.max(LAY_MINW,mxr-mnx),cols=Math.max(1,Math.floor((span+LAY_G)/(LAY_NEWW+LAY_G)));
 const gw=Math.max(LAY_MINW,Math.min(LAY_NEWW,laySnap((span-(cols-1)*LAY_G)/cols)));
 hid.forEach((p,i)=>{o[p]={x:mnx+(i%cols)*(gw+LAY_G),y:mb+LAY_G+Math.floor(i/cols)*(LAY_NEWH+LAY_G),w:gw,h:LAY_NEWH};});
 return layNormalise(o);
}
// slide an arrangement to 0,0 and report its size; everything that writes cfg.layouts goes through here
function layNormalise(o){
 let mnx=Infinity,mny=Infinity,mxr=0,mxb=0;
 for(const p in o){mnx=Math.min(mnx,o[p].x);mny=Math.min(mny,o[p].y);}
 if(mnx===Infinity)return {p:o,w:0,h:0};
 for(const p in o){o[p].x-=mnx;o[p].y-=mny;mxr=Math.max(mxr,o[p].x+o[p].w);mxb=Math.max(mxb,o[p].y+o[p].h);}
 return {p:o,w:mxr,h:mxb};
}
// ---- the stored form (see THE STORED FORM above) ----
// layStore: normalised px arrangement + the canvas padding width > the v:2 save; layPx: one saved box > px left and width on a canvas of width A
const LAY_V=2;
function layR4(v){return Math.round(v*1e4)/1e4;}
function layStore(n,A){
 const S=Math.max(LAY_G,A-LAY_G),o={};
 for(const p in n.p){const b=n.p[p];o[p]={x:layR4(b.x/S),w:layR4((b.w+LAY_G)/S),y:b.y,h:b.h};}
 return {v:LAY_V,p:o,h:n.h};
}
function layPx(b,A){
 const S=Math.max(LAY_G,A-LAY_G),l=laySnap(b.x*S);
 return {x:l,w:Math.max(LAY_MINW,laySnap((b.x+b.w)*S)-LAY_G-l)};
}
// a v1 save (px) to v:2, against the canvas it's first opened on
function layMigrate(k,A){
 const L=cfg.layouts[k];if(!L||L.v===LAY_V)return L;
 const o={};for(const p in L.p){const b=L.p[p];if(b)o[p]={x:+b.x||0,y:+b.y||0,w:+b.w||LAY_NEWW,h:+b.h||LAY_NEWH};}
 const n=layNormalise(o);
 cfg.layouts[k]=layStore(n,Math.max(A,n.w+LAY_G*2));saveCfg();
 return cfg.layouts[k];
}
// resolve every panel in a block to a live box, clamped to what the wrap can hold; a ghost gets coords but outside edit mode isn't part of the shrink-wrapped box
function layBoxes(k,L,availPad){
 // grid-aligned so a panel clamped to the full width still lands on the dots
 const out=[],maxW=Math.max(LAY_MINW,Math.floor((availPad-LAY_G*2)/LAY_G)*LAY_G);let nu=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  // no saved spot = a panel added since the player last arranged: park those in a fresh grid below the arrangement
  const s=L.p[p];let st;
  if(s){const q=layPx(s,availPad);st={x:q.x,y:s.y,w:q.w,h:s.h};}
  else{const c=nu++;st={x:LAY_G+(c%3)*(LAY_NEWW+LAY_G),y:(L.h||400)+LAY_G+Math.floor(c/3)*(LAY_NEWH+LAY_G),w:LAY_NEWW,h:LAY_NEWH};}
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
// the width the wrap is allowed, in padding-box px, measured with the inline width cleared (else it ratchets narrower); .lyMeasure suppresses the transition for the round trip
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
 // a wrap inside a hidden tab measures 0 wide; skip it, the tab button re-applies on reveal
 if(!layLive(w))return;
 let L=cfg.layouts&&cfg.layouts[k];
 if(!L||!L.p||innerWidth<=LAY_BP){layFlow(k);return;}  // ≤LAY_BP = the stacked mobile flow, leave it alone
 const ed=(layEditing===k);
 w.classList.add('lyCustom');layScreen(k).classList.add('lyScroll'); // custom heights need a top-anchored scrollable screen
 layWatch(k);
 const bd=layBord(w);
 const availPad=Math.max(LAY_MINW+LAY_G*2,layAvail(w));     // padding box — the box absolute panels position against
 L=layMigrate(k,availPad);
 const bx=layBoxes(k,L,availPad);
 const vb=layBBox(bx,false)||layBBox(bx,true);              // what shrink-wrapping hugs: ghosts are out of it unless we're editing
 if(!vb){w.style.width=w.style.height='';return;}
 // saved widths are fractions so an arrangement already fits; this only catches what LAY_MINW inflated, narrowing it as one piece
 const fit=Math.min(1,(availPad-LAY_G*2)/Math.max(1,vb.w));
 // squeeze both edges and floor to the grid; the width is the distance between them (the margin stays LAY_G)
 const sq=v=>Math.floor(v*fit/LAY_G)*LAY_G;
 // PASS 1: place relative to the arrangement's own top-left, then measure
 let bw=0,bh=0,eh=0;
 bx.forEach(o=>{const l=o.x-vb.l;o.px=sq(l);o.pw=Math.max(LAY_MINW,sq(l+o.w)-o.px);o.py=o.y-vb.t;
  eh=Math.max(eh,o.py+o.h);if(o.ghost&&!ed)return;bw=Math.max(bw,o.px+o.pw);bh=Math.max(bh,o.py+o.h);});
 // PASS 2: offX snaps to the grid and the edit canvas is bbox + 2*offX, symmetric about the arrangement, so both modes agree at any width
 const offX=ed?Math.max(LAY_G,Math.floor((availPad-bw)/2/LAY_G)*LAY_G):LAY_G;
 const padW=Math.min(availPad,bw+offX*2);
 bx.forEach(o=>{const el=o.el;
  el.style.left=clamp(o.px+offX,0,Math.max(0,padW-o.pw))+'px';
  el.style.top=(o.py+LAY_G)+'px';   // the vertical offset matches in both modes (the wrap is top-anchored)
  el.style.width=o.pw+'px';el.style.height=o.h+'px';});
 const padH=(ed?eh:bh)+LAY_G*2+(ed?LAY_DROP:0);
 w.style.width=(padW+bd.x)+'px';
 w.style.height=(padH+bd.y)+'px';
 // every left/top is a multiple of LAY_G from the padding-box origin (the dotted texture's origin), so panels sit on the dots
}
// watch the class attribute so league.js's show/hide toggles resize the wrap with no layRefresh() calls
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
// ---- edit mode ----
// every change goes through layPut, which keeps the replaced one on LAY_UNDO.stack (Undo: bar, Ctrl+Z, pad Y)
// changes are written to cfg as they happen; Save closes, Cancel restores what was saved at open (LAY_UNDO.start)
// a layout flagged d:1 is the stock flow, captured: closing on one deletes the save so the screen stays responsive
const LAY_UNDOS=60;                // most changes one session remembers
const LAY_UNDO={start:null,stack:[]};
function layClone(L){return L?JSON.parse(JSON.stringify(L)):null;}
// same numbers = no step; the stock flag doesn't count as a difference
function layNums(L){return JSON.stringify(L?Object.assign({},L,{d:undefined}):null);}
function layPut(k,L){
 const o=cfg.layouts[k];
 if(layNums(o)===layNums(L)){if(o&&L.d&&!o.d){o.d=1;saveCfg();laySelSync();}return false;}
 LAY_UNDO.stack.push(layClone(o));if(LAY_UNDO.stack.length>LAY_UNDOS)LAY_UNDO.stack.shift();
 cfg.layouts[k]=L;saveCfg();laySelSync();return true;
}
// re-apply mid-session without the screen jumping (layFlow resets scrollTop)
function layRe(k){const sc=layScreen(k),y=sc?sc.scrollTop:0;layAnim(k);layApply(k);if(sc)sc.scrollTop=y;}
function layHandles(k,on){
 const w=layWrap(k);if(!w)return;
 w.querySelectorAll('.lyRz,.lyRs').forEach(h=>h.remove());
 if(on)layPanels(k).forEach(p=>{const el=$(p);if(!el)return;
  const z=document.createElement('span');z.className='lyRz';
  const r=document.createElement('span');r.className='lyRs';r.title='Put this panel back';r.textContent='↺';
  el.append(z,r);});
}
// the stock arrangement at this width: the CSS flow measured with the edit styling off; the caller re-applies (layRe)
function layDefaults(k){
 const w=layWrap(k),ed=w.classList.contains('lyEditing');
 if(ed){w.classList.remove('lyEditing');layHandles(k,false);}
 layFlow(k);
 const d=layStore(layCapture(k),layAvail(w));d.d=1;
 if(ed){w.classList.add('lyEditing');layHandles(k,true);}
 return d;
}
// the bar: EDIT LAYOUT, ◀ preset ▶, [name], Save as preset, Delete | Undo, Cancel, Save, plus a how-to line (a plain <select>, so vsel.js styles it)
function layEditStart(k){
 if(layEditing)return;
 const w=layWrap(k);if(!w||!layLive(w)||innerWidth<=LAY_BP)return;
 if(!cfg.layouts)cfg.layouts={};
 LAY_UNDO.start=layClone(cfg.layouts[k]&&cfg.layouts[k].p?cfg.layouts[k]:null);LAY_UNDO.stack=[];
 if(!LAY_UNDO.start){cfg.layouts[k]=layStore(layCapture(k),layAvail(w));cfg.layouts[k].d=1;}
 layEditing=k;layAnim(k);layApply(k);
 w.classList.add('lyEditing');layHandles(k,true);
 w.addEventListener('pointerdown',layDown);
 layBar=document.createElement('div');layBar.id='lyBar';
 layBar.innerHTML='<span class="lyBarTxt">⊞ EDIT LAYOUT</span><span class="lyPre"><select id="lySel" title="Layout preset"></select></span>'
  +'<input type="text" id="lyName" class="hidden" maxlength="20" spellcheck="false" title="Rename this preset">';
 const mk=(t,c,f,id)=>{const b=document.createElement('button');b.className=c;b.textContent=t;b.onclick=()=>f();if(id)b.id=id;return b;};
 const sep=document.createElement('i');sep.className='lySep';
 const hint=document.createElement('span');hint.className='lyHint';hint.textContent='drag a panel to move it · its corner to resize · ↺ puts it back';
 layBar.append(mk('Save as preset','btn ghost',laySavePreset,'lyAdd'),mk('Delete','btn ghost hidden',layDelPreset,'lyDel'),sep,
  mk('Undo','btn ghost',layUndo),mk('Cancel','btn ghost',layCancel),mk('Save','btn',layEditEnd),hint);
 layScreen(k).appendChild(layBar);
 const sel=$('lySel'),nm=$('lyName');
 if(typeof vselWrap==='function'){vselWrap(sel);sel.parentElement.classList.remove('wide');}
 sel.onchange=()=>layLoadPreset(sel.value);
 nm.oninput=()=>layRenamePreset(nm.value);
 laySelSync();
}
// save: layEditing is cleared first so layApply runs in display mode and layEditGuard can't re-enter
function layEditEnd(){
 const k=layEditing;if(!k)return;
 if(LAY_PAD.el)layPadDrop(true);                            // a panel still held on the pad lands where it is
 layEditing=null;LAY_UNDO.start=null;LAY_UNDO.stack=[];
 if(cfg.layouts[k]&&cfg.layouts[k].d){delete cfg.layouts[k];saveCfg();}   // still the stock layout: hand the screen back to its CSS
 const w=layWrap(k);
 if(w){w.classList.remove('lyEditing');w.removeEventListener('pointerdown',layDown);layHandles(k,false);}
 if(layBar){layBar.remove();layBar=null;}
 layAnim(k);layApply(k);                                    // the canvas collapses back around the panels
 if(typeof Au!=='undefined')Au.ui();
}
function layCancel(){
 const k=layEditing;if(!k)return;
 if(LAY_PAD.el)layPadDrop(false);
 const s=LAY_UNDO.start;if(s)cfg.layouts[k]=s;else delete cfg.layouts[k];saveCfg();
 layEditEnd();
}
function layUndo(){
 const k=layEditing;if(!k)return false;
 if(LAY_PAD.el)layPadDrop(false);
 if(!LAY_UNDO.stack.length){if(typeof Au!=='undefined')Au.ui('error');return false;}
 cfg.layouts[k]=LAY_UNDO.stack.pop();saveCfg();layRe(k);laySelSync();
 if(typeof Au!=='undefined')Au.ui('back');
 return true;
}
// ---- presets ----
// the picker lists Default (the screen's CSS), the built-ins (CONFIG.layoutEditor.presets), then the player's own (cfg.layoutPresets); picking one is one undoable step
// it shows what the live layout is (a preset's name, or Unsaved once a panel moves); Save as preset keeps it as 'Custom N'
function layOwn(k){
 if(!cfg.layoutPresets||typeof cfg.layoutPresets!=='object')cfg.layoutPresets={};
 const a=cfg.layoutPresets[k];return Array.isArray(a)?a:(cfg.layoutPresets[k]=[]);
}
function layBuiltins(k){const P=CONFIG.layoutEditor&&CONFIG.layoutEditor.presets;return(P&&P[k])||[];}
function layPresetList(k){
 return [{v:'def',n:'Default'}]
  .concat(layBuiltins(k).map((p,i)=>({v:'b'+i,n:p.n,L:p.L})))
  .concat(layOwn(k).map((p,i)=>({v:'c'+i,n:p.n,L:p.L})));
}
function layCur(k){
 const L=cfg.layouts[k];if(!L||L.d)return 'def';
 const s=layNums(L),p=layPresetList(k).find(q=>q.L&&layNums(q.L)===s);
 return p?p.v:'';
}
function laySelSync(){
 const k=layEditing,sel=layBar&&$('lySel');if(!k||!sel)return;
 const cur=layCur(k),own=cur[0]==='c',nm=$('lyName');
 sel.innerHTML='';
 layPresetList(k).forEach(p=>{const o=document.createElement('option');o.value=p.v;o.textContent=p.n;sel.appendChild(o);});
 if(!cur){const o=document.createElement('option');o.value='';o.textContent='Unsaved';o.disabled=true;sel.appendChild(o);}
 sel.value=cur;
 nm.classList.toggle('hidden',!own);$('lyDel').classList.toggle('hidden',!own);
 if(own&&document.activeElement!==nm)nm.value=layOwn(k)[+cur.slice(1)].n;
 $('lyAdd').disabled=layOwn(k).length>=CONFIG.layoutEditor.presetsMax;
}
function layLoadPreset(v){
 const k=layEditing;if(!k)return;
 if(LAY_PAD.el)layPadDrop(false);
 if(v==='def')layPut(k,layDefaults(k));        // layDefaults flows the screen to measure it, so always re-apply
 else{const p=layPresetList(k).find(q=>q.v===v);if(p&&p.L)layPut(k,layClone(p.L));}
 layRe(k);laySelSync();
}
// refused when the layout already is a preset, or the screen has presetsMax of the player's own
function laySavePreset(){
 const k=layEditing;if(!k)return;
 const own=layOwn(k),cur=layCur(k);
 if(own.length>=CONFIG.layoutEditor.presetsMax||(cur&&cur!=='def')){if(typeof Au!=='undefined')Au.ui('error');return;}
 let i=own.length+1;while(own.some(p=>p.n==='Custom '+i))i++;
 const L=layClone(cfg.layouts[k]);delete L.d;
 own.push({n:'Custom '+i,L});
 delete cfg.layouts[k].d;saveCfg();   // it's a preset now: closing keeps it rather than handing the screen back to its CSS
 laySelSync();if(typeof Au!=='undefined')Au.ui('value');
}
function layDelPreset(){
 const k=layEditing,cur=k&&layCur(k);if(!cur||cur[0]!=='c')return;
 layOwn(k).splice(+cur.slice(1),1);saveCfg();laySelSync();
 if(typeof Au!=='undefined')Au.ui('back');
}
function layRenamePreset(t){
 const k=layEditing,cur=k&&layCur(k);if(!cur||cur[0]!=='c')return;
 const p=layOwn(k)[+cur.slice(1)];p.n=String(t).trim().slice(0,20)||p.n;saveCfg();
 const sel=$('lySel'),o=sel&&sel.selectedOptions[0];if(o)o.textContent=p.n;
}
// dev: a screen's live layout as a paste-ready line for CONFIG.layoutEditor.presets[key]
function layExport(k){
 const L=cfg.layouts&&cfg.layouts[k];if(!L||!L.p){console.log('No layout saved for '+k);return null;}
 const s=JSON.stringify({n:'Name me',L:Object.assign({},L,{d:undefined})})+',';console.log(s);return s;
}
// one panel back to the stock position; Undo takes it back
function layResetPanel(el){
 const k=layEditing;if(!k||!layPadIs(el))return false;
 if(LAY_PAD.el)layPadDrop(false);
 const d=layDefaults(k),L=layClone(cfg.layouts[k]);
 if(d.p[el.id]){L.p[el.id]=d.p[el.id];delete L.d;
  L.h=0;for(const p in L.p)L.h=Math.max(L.h,L.p[p].y+L.p[p].h);
  layPut(k,L);}
 layRe(k);
 if(typeof Au!=='undefined')Au.ui('value');
 return true;
}
function layDown(e){
 const k=layEditing;if(!k)return;
 const el=e.target.closest('.panel');if(!el)return;
 e.preventDefault();e.stopPropagation();
 if(e.target.classList.contains('lyRs')){layResetPanel(el);return;}
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
// stored against the canvas width the edit session opened to (layAvail); a no-move release is compared in px so a click doesn't flip a preset to Unsaved
function laySave(k){
 const o={},w=layWrap(k);if(!w)return;
 layPanels(k).forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  o[p]={x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0,w:parseFloat(el.style.width),h:parseFloat(el.style.height)};});
 const n=layNormalise(o),A=layAvail(w);
 if(layPxSame(cfg.layouts[k],n,A))return;
 layPut(k,layStore(n,A));
}
function layPxSame(L,n,A){
 if(!L||!L.p)return false;const o={};
 for(const p in n.p){const s=L.p[p];if(!s)return false;const q=layPx(s,A);o[p]={x:q.x,y:s.y,w:q.w,h:Math.max(LAY_MINH,s.h)};}
 return JSON.stringify(layNormalise(o).p)===JSON.stringify(n.p);
}
// re-size the edit canvas after a drag from the live DOM (layApply would re-centre and yank the panel)
function layGrow(k){
 const w=layWrap(k);if(!w||layEditing!==k)return;
 let b=0;
 layPanels(k).forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  b=Math.max(b,(parseFloat(el.style.top)||0)+parseFloat(el.style.height));});
 w.style.height=(b+LAY_G+LAY_DROP+layBord(w).y)+'px';
}
// ---- the pad (js/padnav.js drives this) ----
// the cursor lands on whole panels plus the toolbar; A grabs, the D-pad moves a grid square, Y swaps move/resize, A drops, B puts it back; same clamps as layDown
const LAY_PAD={el:null,rz:false,was:null};
function layPadCands(){
 const k=layEditing;if(!k)return[];
 const c=layPanels(k).map(p=>$(p)).filter(el=>el&&el.getClientRects().length);
 if(layBar)c.push(...layBar.querySelectorAll('button,select,input'));
 return c;
}
function layPadIs(el){return!!layEditing&&!!el&&layPanels(layEditing).indexOf(el.id)>=0;}
function layPadGrab(el){
 if(!layPadIs(el))return false;
 LAY_PAD.el=el;LAY_PAD.rz=false;
 LAY_PAD.was={l:el.style.left,t:el.style.top,w:el.style.width,h:el.style.height};
 el.classList.add('lyDrag');const w=layWrap(layEditing);if(w)w.classList.remove('lyTx');
 if(typeof Au!=='undefined')Au.ui();
 return true;
}
function layPadNudge(dx,dy){
 const el=LAY_PAD.el,k=layEditing;if(!el||!k)return;
 const ww=layWrap(k).clientWidth,x=parseFloat(el.style.left)||0,y=parseFloat(el.style.top)||0,
       w=parseFloat(el.style.width)||el.offsetWidth,h=parseFloat(el.style.height)||el.offsetHeight;
 if(LAY_PAD.rz){el.style.width=clamp(laySnap(w+dx*LAY_G),LAY_MINW,Math.max(LAY_MINW,ww-x))+'px';el.style.height=Math.max(LAY_MINH,laySnap(h+dy*LAY_G))+'px';}
 else{el.style.left=clamp(laySnap(x+dx*LAY_G),0,Math.max(0,ww-w))+'px';el.style.top=Math.max(0,laySnap(y+dy*LAY_G))+'px';}
 layGrow(k);
}
function layPadMode(){const el=LAY_PAD.el;if(!el)return;LAY_PAD.rz=!LAY_PAD.rz;el.classList.toggle('lyRzOn',LAY_PAD.rz);if(typeof Au!=='undefined')Au.ui();}
// keep = save where it is now (A, or the mouse taking over); otherwise put it back (B).
function layPadDrop(keep){
 const el=LAY_PAD.el;if(!el)return;
 if(!keep&&LAY_PAD.was){const o=LAY_PAD.was;el.style.left=o.l;el.style.top=o.t;el.style.width=o.w;el.style.height=o.h;}
 el.classList.remove('lyDrag','lyRzOn');LAY_PAD.el=LAY_PAD.was=null;LAY_PAD.rz=false;
 if(layEditing){if(keep)laySave(layEditing);layGrow(layEditing);}
 if(typeof Au!=='undefined')Au.ui();
}
// ---- wiring ----
// every `lay` block gets its ⊞ button bound here, no edit to this file needed
for(const k in LAY_BLOCKS){const b=$(LAY_BLOCKS[k].btn);
 if(b)b.onclick=()=>{layEditing===k?layEditEnd():(typeof Au!=='undefined'&&Au.ui(),layEditStart(k));};}
// Ctrl+Z steps back while the editor is open (capture phase on window); not while typing a preset's name
addEventListener('keydown',e=>{
 if(layEditing&&(e.ctrlKey||e.metaKey)&&!e.altKey&&e.code==='KeyZ'&&!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){e.preventDefault();e.stopPropagation();layUndo();}},true);
// below LAY_BP the arranger is inert, so hide the ⊞; a separate class since the screen's own code owns .hidden
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
