'use strict';
/* ===== layout — player-arrangeable panel grid ===== */
/* A registered screen's panels can be dragged/resized on a 16px grid via its ⊞ Layout
   button. Positions persist per screen in cfg.layouts[id] as {p:{elId:{x,y,w,h}},h}
   (px within the wrap). No save = the normal CSS flow, untouched. Panels hidden at
   runtime (scout/history/last-round) still get their coords applied, so they appear
   in-place the moment league.js un-hides them; in edit mode they show as ghosts so
   they can be placed. Add a screen = one LAY_SCREENS entry + a layApply(id) call
   where it opens + a button wired to layEditStart(id). */
const LAY_G=16, LAY_MINW=224, LAY_MINH=128, LAY_PAD=18;
const LAY_SCREENS={
 league:{screen:'league',wrapSel:'#league .lgWrap',btn:'lgEditLayout',
  panels:['lgStandingsPanel','lgHistPanel','lgFixturePanel','lgLastPanel','lgSettingsPanel','lgSquadPanel','lgScout']},
 menu:{screen:'menu',wrapSel:'#menu .panelWrap',btn:'menuEditLayout',
  panels:['menuSetupPanel','menuKitPanel','menuCtlPanel']}};
let layEditing=null, layBar=null, layRszT=0;
function laySnap(v){return Math.round(v/LAY_G)*LAY_G;}
function layWrap(id){return document.querySelector(LAY_SCREENS[id].wrapSel);}
function layFlow(id){const w=layWrap(id);if(!w)return;w.classList.remove('lyCustom');w.style.height='';
 $(LAY_SCREENS[id].screen).classList.remove('lyScroll');
 LAY_SCREENS[id].panels.forEach(p=>{const el=$(p);if(el){el.style.left=el.style.top=el.style.width=el.style.height='';}});}
/* flow rects → grid coords; panels hidden in flow get slotted in a row underneath */
function layCapture(id){
 const w=layWrap(id),wr=w.getBoundingClientRect(),o={},hid=[];let mb=0;
 LAY_SCREENS[id].panels.forEach(p=>{const el=$(p);if(!el)return;
  if(el.classList.contains('hidden')||!el.offsetParent){hid.push(p);return;}
  const r=el.getBoundingClientRect();
  o[p]={x:laySnap(r.left-wr.left),y:laySnap(r.top-wr.top),w:Math.max(LAY_MINW,laySnap(r.width)),h:Math.max(LAY_MINH,laySnap(r.height))};
  mb=Math.max(mb,o[p].y+o[p].h);});
 hid.forEach((p,i)=>{o[p]={x:laySnap(LAY_PAD+i*400),y:laySnap(mb+LAY_PAD),w:384,h:288};});
 return o;
}
function layApply(id){
 const w=layWrap(id);if(!w)return;
 const L=cfg.layouts&&cfg.layouts[id];
 if(!L||!L.p||innerWidth<=1040){layFlow(id);return;}  // ≤1040px = the stacked mobile flow, leave it alone
 w.classList.add('lyCustom');$(LAY_SCREENS[id].screen).classList.add('lyScroll'); // custom heights need a top-anchored scrollable screen
 const ww=w.clientWidth;let mb=0;
 LAY_SCREENS[id].panels.forEach((p,i)=>{const el=$(p);if(!el)return;
  const st=L.p[p]||{x:LAY_PAD,y:(L.h||400)+LAY_PAD+i*40,w:384,h:288}; // no saved spot (new panel since save) → park below
  const pw=Math.min(st.w,Math.max(LAY_MINW,ww-LAY_PAD*2)),px=clamp(st.x,0,Math.max(0,ww-pw));
  el.style.left=px+'px';el.style.top=st.y+'px';el.style.width=pw+'px';el.style.height=st.h+'px';
  mb=Math.max(mb,st.y+st.h);}); // hidden panels count too — wrap stays tall enough when they pop in later
 w.style.height=(mb+LAY_PAD)+'px';
}
/* ---- edit mode ---- */
function layEditStart(id){
 if(layEditing)return;
 const w=layWrap(id);if(!w||innerWidth<=1040)return;
 if(!(cfg.layouts&&cfg.layouts[id]&&cfg.layouts[id].p)){if(!cfg.layouts)cfg.layouts={};cfg.layouts[id]={p:layCapture(id),h:0};}
 layEditing=id;layApply(id);
 w.classList.add('lyEditing');
 LAY_SCREENS[id].panels.forEach(p=>{const el=$(p);if(!el)return;const h=document.createElement('span');h.className='lyRz';el.appendChild(h);});
 w.addEventListener('pointerdown',layDown);
 layBar=document.createElement('div');layBar.id='lyBar';
 layBar.innerHTML='<span class="lyBarTxt">⊞ EDIT LAYOUT — drag a panel to move · drag its corner to resize</span>';
 const bd=document.createElement('button');bd.className='btn';bd.textContent='✓ Done';bd.onclick=layEditEnd;
 const br=document.createElement('button');br.className='btn ghost';br.textContent='Reset layout';br.onclick=layReset;
 layBar.append(bd,br);$(LAY_SCREENS[id].screen).appendChild(layBar);
}
function layEditEnd(){
 const id=layEditing;if(!id)return;
 const w=layWrap(id);
 w.classList.remove('lyEditing');w.removeEventListener('pointerdown',layDown);
 w.querySelectorAll('.lyRz').forEach(h=>h.remove());
 layEditing=null;if(layBar){layBar.remove();layBar=null;}
 layApply(id);Au.ui();
}
function layReset(){
 const id=layEditing;if(!id)return;
 delete cfg.layouts[id];saveCfg();layEditEnd(); // layApply inside sees no save → back to CSS flow
}
function layDown(e){
 const id=layEditing;if(!id)return;
 const el=e.target.closest('.panel');if(!el)return;
 e.preventDefault();e.stopPropagation();
 const w=layWrap(id),rz=e.target.classList.contains('lyRz'),ww=w.clientWidth;
 const sx=e.clientX,sy=e.clientY,ox=parseFloat(el.style.left)||0,oy=parseFloat(el.style.top)||0,
       ow=parseFloat(el.style.width)||el.offsetWidth,oh=parseFloat(el.style.height)||el.offsetHeight;
 el.classList.add('lyDrag');
 const mv=ev=>{const dx=ev.clientX-sx,dy=ev.clientY-sy;
  if(rz){el.style.width=clamp(laySnap(ow+dx),LAY_MINW,Math.max(LAY_MINW,ww-ox))+'px';el.style.height=Math.max(LAY_MINH,laySnap(oh+dy))+'px';}
  else{const nw=parseFloat(el.style.width)||ow;el.style.left=clamp(laySnap(ox+dx),0,Math.max(0,ww-nw))+'px';el.style.top=Math.max(0,laySnap(oy+dy))+'px';}};
 const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);el.classList.remove('lyDrag');laySave(id);};
 addEventListener('pointermove',mv);addEventListener('pointerup',up);addEventListener('pointercancel',up);
}
function laySave(id){
 const w=layWrap(id),o={};let mb=0;
 LAY_SCREENS[id].panels.forEach(p=>{const el=$(p);if(!el||!el.style.width)return;
  o[p]={x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0,w:parseFloat(el.style.width),h:parseFloat(el.style.height)};
  mb=Math.max(mb,o[p].y+o[p].h);});
 cfg.layouts[id]={p:o,h:mb};w.style.height=(mb+LAY_PAD)+'px';saveCfg();
}
/* ---- wiring ---- */
for(const id in LAY_SCREENS){const b=$(LAY_SCREENS[id].btn);
 if(b)b.onclick=()=>{layEditing===id?layEditEnd():(Au.ui(),layEditStart(id));};}
addEventListener('resize',()=>{clearTimeout(layRszT);layRszT=setTimeout(()=>{
 if(layEditing)return;
 for(const id in LAY_SCREENS)if(!$(LAY_SCREENS[id].screen).classList.contains('hidden'))layApply(id);},150);});
layApply('menu'); // the menu is already on screen at boot; league applies in openLeague
