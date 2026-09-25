/* Behavioural harness for controller menu navigation (js/padnav.js).
   Boots core.js + the REAL padnav.js in a vm against a fake DOM whose elements carry fixed
   rectangles, then drives it the way a pad does: edges through navTick, directions through
   navDir. What it pins down is the part a re-read can't see:
     · the spatial choice — including the Kick Off geometry, measured in the live game, where a
       3x sideways penalty sent "down" from the tab bar to Game time, skipping three rows;
     · pad family — "Xbox Wireless Controller" contains "wireless controller", which is how a
       DualShock names itself; testing PlayStation first labelled an Xbox A as ✕;
     · the container rule, the capture region, clamp-vs-wrap on a <select>, slider snapping;
     · the first press only revealing the cursor, the lobby's onPad hook winning over the cursor,
       Start as the screen's primary action, and B pressing the screen's own Back button;
     · cursor memory used on the way BACK to a screen, never on a fresh entry;
     · padNavFilter keeping a press the menu used away from the rod;
     · button glyphs by family (a Switch pad's A SLOT is printed B), the last-device switch, the
       data-pad relabel, and the in-match hint picking the pad lines only when a pad was last used;
     · the layout editor on a pad (the REAL js/layout.js pad functions): whole panels as the stops,
       A grabs, the D-pad moves a grid square, Y resizes, B puts it back, A saves.
   Every mutation below must break at least one assertion.
   Run: node tools/padnav-harness.js                                                        */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');
const CORE=rd('js/core.js'),NAVSRC=rd('js/padnav.js'),HUDSRC=rd('js/hud.js'),LAYSRC=rd('js/layout.js');
const EXPORT=';globalThis.__nav={NAV,NAV_SCREENS,navFamily,navMove,navDir,navSet,navCands,navNudge,navActivate,navAdjEnd,navDropEnd,padNavFilter,navTick,'
 +'padGlyph,padKeyHTML,padLabels,inputKind};';

/* ---- a fake DOM: just enough surface for padnav, with FIXED rectangles ---- */
function mkDom(){
 const byId={};
 function match(n,sel){return sel.split(',').some(s=>{s=s.trim();
  if(s[0]==='#')return n.id===s.slice(1);
  if(s[0]==='[')return n.dataset[s.slice(1,-1).replace(/^data-/,'')]!==undefined;
  return s.split('.').filter(Boolean).every(c=>n._cls.has(c));});}
 const doc={activeElement:null,getElementById:i=>byId[i]||null};
 function E(tag,o={}){
  const el={tagName:tag.toUpperCase(),id:o.id||'',dataset:o.dataset||{},type:o.type||'',disabled:false,
   onclick:o.onclick||null,children:[],parentElement:null,isConnected:true,_r:o.r||[0,0,0,0],
   _cls:new Set(o.cls||[]),clicks:0,events:[],options:o.options||null,selectedIndex:o.sel||0,
   value:o.value!==undefined?String(o.value):'',min:o.min!==undefined?String(o.min):'',
   max:o.max!==undefined?String(o.max):'',step:o.step!==undefined?String(o.step):'',innerHTML:'',
   style:Object.assign({},o.style||{}),clientWidth:o.cw||0,offsetWidth:0,offsetHeight:0};
  el.classList={add:(...cs)=>cs.forEach(c=>el._cls.add(c)),remove:(...cs)=>cs.forEach(c=>el._cls.delete(c)),contains:c=>el._cls.has(c),
   toggle:(c,f)=>{if(f===undefined)f=!el._cls.has(c);if(f)el._cls.add(c);else el._cls.delete(c);return f;}};
  el.getBoundingClientRect=()=>{const[x,y,w,h]=el._r;return{left:x,top:y,right:x+w,bottom:y+h,width:w,height:h};};
  el.getClientRects=()=>el._r[2]>0?[1]:[];
  el.contains=n=>{for(let p=n;p;p=p.parentElement)if(p===el)return true;return false;};
  el.closest=sel=>{for(let p=el;p;p=p.parentElement)if(match(p,sel))return p;return null;};
  el.add=(...cs)=>{for(const c of cs){c.parentElement=el;el.children.push(c);}return el;};
  el.appendChild=c=>{el.add(c);return c;};
  el.all=()=>{const out=[];(function w(n){for(const c of n.children){out.push(c);w(c);}})(el);return out;};
  el.querySelectorAll=s=>s==='*'?el.all():el.all().filter(n=>match(n,s));
  el.querySelector=s=>el.querySelectorAll(s)[0]||null;
  el.click=()=>{el.clicks++;if(el.onclick)el.onclick({target:el});};
  el.addEventListener=el.removeEventListener=el.setAttribute=()=>{};
  el.remove=()=>{const q=el.parentElement;if(q){q.children.splice(q.children.indexOf(el),1);el.parentElement=null;}};
  el.dispatchEvent=ev=>{el.events.push(ev.type);};
  el.focus=()=>{doc.activeElement=el;};el.blur=()=>{if(doc.activeElement===el)doc.activeElement=null;};
  if(o.id)byId[o.id]=el;
  return el;
 }
 doc.body=E('body',{r:[0,0,1280,720]});doc.createElement=t=>E(t);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);
 return{E,doc};
}
function boot(src){
 const D=mkDom();
 const ctx={document:D.doc,console,Math,JSON,Object,Array,String,Number,Set,
  navigator:{getGamepads:()=>ctx.__pads},__pads:[],__scr:'home',
  getComputedStyle:el=>({visibility:el._vis||'visible',overflowY:el._oy||'visible',
   borderLeftWidth:'0px',borderRightWidth:'0px',borderTopWidth:'0px',borderBottomWidth:'0px'}),
  innerWidth:1600,innerHeight:900,setTimeout:()=>0,clearTimeout:()=>{},cfg:{layouts:{}},saveCfg:()=>{},
  requestAnimationFrame:()=>0,addEventListener:()=>{},
  Event:function(t){this.type=t;},MouseEvent:function(t){this.type=t;},
  S:{phase:'menu',seats:[]},SCREENS:{},CONFIG:{hud:{hintHold:9,hintDim:.4}},
  gpDown:(gp,i)=>{const b=gp.buttons[i];return!!b&&(b.pressed||b.value>.5);}};
 ctx.screenId=()=>ctx.__scr;
 vm.createContext(ctx);
 vm.runInContext(CORE,ctx);
 vm.runInContext(src+EXPORT,ctx);
 ctx.E=D.E;ctx.doc=D.doc;ctx.N=ctx.__nav;
 return ctx;
}
function pad(id){return{id,buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};}

let pass=0,fail=0;const fails=[];
function ok(c,m,x){if(c)pass++;else{fail++;fails.push(m+(x!==undefined?'  ['+x+']':''));}}
const nm=el=>el?(el.id||[...el._cls].join('.')||el.tagName):'null';

function suite(src,lsrc){
 lsrc=lsrc||LAYSRC;
 pass=0;fail=0;fails.length=0;

 /* 1 · pad family */
 {const c=boot(src),f=id=>c.N.navFamily({id});
  ok(f('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')==='xbox','Xbox Wireless Controller reads as xbox');
  ok(f('Xbox 360 Controller (XInput STANDARD GAMEPAD)')==='xbox','XInput reads as xbox');
  ok(f('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')==='ps','DualShock 4 reads as ps');
  ok(f('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')==='ps','DualSense reads as ps');
  ok(f('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')==='nin','Switch Pro reads as nin');
  ok(f('Steam Virtual Gamepad')==='xbox','unknown pad falls back to xbox glyphs');}

 /* 2 · spatial: the Kick Off Match Setup geometry, as measured in the running game */
 {const c=boot(src),E=c.E,root=E('div',{id:'menu',r:[0,-700,1280,1400]});
  const R=(id,tag,r,type)=>E(tag,{id,r,type});
  const els={
   tabTeam:R('menuTabBtnTeam','button',[16,-261,88,48]),tabRules:R('menuTabBtnRules','button',[16,-203,88,48]),
   dRed:R('setDiffRed','select',[334,-97,85,33]),dBlue:R('setDiffBlue','select',[334,-56,85,33]),
   goals:R('setGoals','select',[366,-15,53,33]),time:R('setGameTime','select',[269,26,150,33]),
   spec:R('setSpecial','input',[401,69,18,18],'checkbox'),pow:R('setPower','input',[401,98,18,18],'checkbox'),
   rep:R('setReplay','input',[401,127,18,18],'checkbox'),auto:R('setAuto','input',[401,156,18,18],'checkbox'),
   table:R('setTable','select',[663,-95,92,33]),skin:R('setSkin','select',[618,-54,137,33]),
   pitch:R('setPitch','select',[603,-13,152,33]),room:R('setRoom','select',[633,28,122,33]),
   refl:R('setReflect','input',[737,71,18,18],'checkbox'),snd:R('setSound','input',[1073,-95,18,18],'checkbox'),
   amb:R('setAmbience','input',[1073,-66,18,18],'checkbox')};
  root.add(...Object.values(els));
  c.N.NAV.root={key:'menu',el:root};
  const walk=(from,dx,dy,n)=>{c.N.navSet(from);const o=[];for(let i=0;i<n;i++){c.N.navMove(dx,dy);o.push(nm(c.N.NAV.el));}return o;};
  const down=walk(els.tabRules,0,1,8);
  ok(down[0]==='setDiffRed','down from the Match Setup tab lands on the FIRST row, not Game time',down[0]);
  ok(down.join()==='setDiffRed,setDiffBlue,setGoals,setGameTime,setSpecial,setPower,setReplay,setAuto','down walks the rules column in order',down.join());
  const up=walk(els.auto,0,-1,8);
  ok(up.slice(0,7).join()==='setReplay,setPower,setSpecial,setGameTime,setGoals,setDiffBlue,setDiffRed','up walks it back',up.join());
  c.N.navSet(els.auto);c.N.navMove(1,0);const rx=c.N.NAV.el.getBoundingClientRect().left;
  ok(rx>590&&rx<800,'right from the last rules checkbox reaches the Table & Venue panel',nm(c.N.NAV.el));
  c.N.navSet(els.refl);c.N.navMove(1,0);
  ok(c.N.NAV.el===els.snd||c.N.NAV.el===els.amb,'right from Reflections reaches the Audio panel',nm(c.N.NAV.el));
  c.N.navSet(els.dRed);c.N.navMove(-1,0);
  ok(c.N.NAV.el===els.dRed||c.N.NAV.el.getBoundingClientRect().left<334,'left never jumps rightwards',nm(c.N.NAV.el));}

 /* 2b · the home row: five cards left to right */
 {const c=boot(src),E=c.E,root=E('div',{id:'home',r:[0,0,1280,720]});
  const cards=['a','b','d','e','f'].map((k,i)=>E('div',{id:'card'+k,r:[82+i*226,283,212,155],onclick:()=>{}}));
  root.add(...cards);c.N.NAV.root={key:'home',el:root};c.N.navSet(cards[0]);
  const o=[];for(let i=0;i<5;i++){c.N.navMove(1,0);o.push(nm(c.N.NAV.el));}
  ok(o.join()==='cardb,cardd,carde,cardf,cardf','right walks the home row and stops at the end',o.join());
  c.N.navMove(0,1);ok(c.N.NAV.el===cards[4],'down with nothing below stays put');}

 /* 3 · same row is never "down". The neighbour is TALLER and 4px lower, so its centre is below
    ours — only the half-height guard keeps it out, and it sits close enough to win on score. */
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,800,600]});
  const a=E('select',{id:'a',r:[300,100,85,33]}),nb=E('button',{id:'nb',r:[390,104,60,40]}),b=E('select',{id:'b',r:[300,180,85,33]});
  root.add(a,nb,b);c.N.NAV.root={key:'x',el:root};c.N.navSet(a);c.N.navMove(0,1);
  ok(c.N.NAV.el===b,'a taller neighbour 4px lower in the same row is not "down"',nm(c.N.NAV.el));}

 /* 4 · <select>: ◀▶ MOVE past a closed one; A opens it; open, ◀▶ clamp and skip disabled; A keeps,
      B puts back, ▲▼ or the cursor leaving closes it. ◀▶ used to change any select the cursor
      rested on, so there was no way sideways OUT of a column of them — the owner's report. */
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,800,600]});
  const sel=E('select',{id:'s',r:[10,10,80,30],sel:0,options:[{},{disabled:true},{}]}),nx=E('button',{id:'nx',r:[200,10,80,30]});
  root.add(sel,nx);
  c.N.NAV.root={key:'x',el:root};c.N.NAV.show=true;c.N.navSet(sel);
  c.N.navDir(1,0);
  ok(c.N.NAV.el===nx&&sel.selectedIndex===0&&!sel.events.length,'right on a CLOSED select moves to the next control and leaves its value alone',nm(c.N.NAV.el));
  // A OPENS IT AS A LIST (like the mouse does): ▲▼ walk it, A picks, B closes it untouched.
  c.N.navSet(sel);c.N.navActivate(sel);
  const D=c.N.NAV.drop;
  ok(!!D&&D.el===sel&&sel.classList.contains('navAdj'),'A opens the dropdown as a list, and the select looks open');
  ok(!!D&&D.items.length===3&&D.items[1].classList.contains('off'),'the list carries every option, the disabled one greyed');
  ok(!!D&&D.i===0&&D.items[0].classList.contains('on')&&D.items[0].classList.contains('cur'),'it opens on the current value');
  c.N.navDir(0,1);ok(c.N.NAV.drop&&c.N.NAV.drop.i===2,'down skips the disabled option',c.N.NAV.drop&&c.N.NAV.drop.i);
  ok(sel.selectedIndex===0&&!sel.events.length,'walking the list changes nothing yet');
  c.N.navDir(0,1);ok(!!c.N.NAV.drop&&c.N.NAV.drop.i===2,'down at the bottom clamps');
  c.N.navDir(1,0);ok(c.N.NAV.drop&&c.N.NAV.el===sel,'left/right do nothing while the list is open');
  c.N.navDropEnd(true);
  ok(sel.selectedIndex===2&&c.N.NAV.drop===null&&!sel.classList.contains('navAdj'),'A picks the highlighted option and closes',sel.selectedIndex);
  ok(sel.events.join()==='input,change','…firing input then change',sel.events.join());
  ok(!c.doc.body.querySelector('.navDrop'),'…and the list is gone from the page');
  sel.events.length=0;c.N.navActivate(sel);c.N.navDir(0,-1);c.N.navDropEnd(false);
  ok(sel.selectedIndex===2&&!sel.events.length&&c.N.NAV.drop===null,'B closes it and keeps the value it had',sel.selectedIndex);
  c.N.navActivate(sel);c.N.navSet(nx);
  ok(c.N.NAV.drop===null||c.N.NAV.el===nx,'(moving the cursor off it)');
  }
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,800,600]});
  const rg=E('input',{id:'rg',type:'range',min:0,max:1,step:.01,value:.5,r:[10,10,120,20]}),nx=E('button',{id:'nx2',r:[200,10,80,30]});
  root.add(rg,nx);c.N.NAV.root={key:'x',el:root};c.N.NAV.show=true;c.N.navSet(rg);
  c.N.navDir(1,0);ok(c.N.NAV.el===nx&&String(rg.value)==='0.5','right on a closed slider moves on',nm(c.N.NAV.el));
  c.N.navSet(rg);c.N.navActivate(rg);c.N.navDir(1,0);
  ok(String(rg.value)==='0.55'&&c.N.NAV.el===rg,'open: right nudges it',rg.value);
  c.N.navAdjEnd(false);ok(String(rg.value)==='0.5','B puts the slider back',rg.value);}

 /* 4c · a VALUE SELECTOR (js/vsel.js wraps the select in .vsel): A opens it IN PLACE, not as a list;
       ◀▶ step it, wrapping and skipping disabled options, firing input+change each step; B puts it
       back, A keeps it. Closed, ◀▶ still move on to the next control. */
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,800,600]});
  const w=E('span',{cls:['vsel'],r:[10,10,200,34]}),sel=E('select',{id:'vs',r:[40,10,140,34],sel:0,options:[{},{disabled:true},{},{}]}),nx=E('button',{id:'nx3',r:[300,10,80,30]});
  w.add(sel);root.add(w,nx);c.N.NAV.root={key:'x',el:root};c.N.NAV.show=true;c.N.navSet(sel);
  c.N.navDir(1,0);ok(c.N.NAV.el===nx&&sel.selectedIndex===0&&!sel.events.length,'right on a CLOSED selector moves on',nm(c.N.NAV.el));
  c.N.navSet(sel);c.N.navActivate(sel);
  ok(c.N.NAV.adj===sel&&c.N.NAV.drop===null,'A opens a selector in place, not as a list');
  c.N.navDir(1,0);ok(sel.selectedIndex===2&&sel.events.join()==='input,change','right steps past the disabled option, firing input+change',sel.selectedIndex);
  c.N.navDir(1,0);c.N.navDir(1,0);ok(sel.selectedIndex===0,'right off the last option wraps to the first',sel.selectedIndex);
  c.N.navDir(-1,0);ok(sel.selectedIndex===3,'left off the first wraps to the last',sel.selectedIndex);
  c.N.navAdjEnd(false);ok(sel.selectedIndex===0,'B puts the selector back',sel.selectedIndex);
  c.N.navActivate(sel);c.N.navDir(-1,0);c.N.navAdjEnd(true);ok(sel.selectedIndex===3&&c.N.NAV.adj===null,'A keeps it',sel.selectedIndex);}

 /* 4b · ◀▶ go to the NEXT PANEL or nowhere. The owner's report: right from a dropdown wandered down
       its own panel (a nearer control two rows lower) instead of crossing to the next one, and at the
       edge the first fix fell back to a corner gear — Reset Controls, one A from wiping settings. */
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,1400,800]});
  const pA=E('div',{cls:['panel'],r:[0,0,300,400]}),pB=E('div',{cls:['panel'],r:[500,0,300,400]});
  const sa=E('select',{id:'sa',r:[20,20,100,30],options:[{},{}]}),low=E('input',{id:'low',type:'checkbox',r:[200,150,20,20]});
  const sl=E('input',{id:'sl',type:'range',r:[520,40,150,20]});
  const gear=E('button',{id:'gear',r:[-80,-60,40,40]});
  pA.add(sa,low);pB.add(sl);root.add(gear,pA,pB);
  c.N.NAV.root={key:'x',el:root};c.N.NAV.show=true;
  c.N.navSet(sa);c.N.navDir(1,0);ok(c.N.NAV.el===sl,'right crosses to the next PANEL, not down its own',nm(c.N.NAV.el));
  c.N.navSet(sa);c.N.navDir(-1,0);ok(c.N.NAV.el===sa,'left at the first panel stays put — never onto a corner gear',nm(c.N.NAV.el));
  c.N.navSet(low);c.N.navDir(1,0);ok(c.N.NAV.el===sl,'a lower row still crosses to the neighbouring panel',nm(c.N.NAV.el));}

 /* 5 · sliders: a twentieth of the range, snapped, no float junk */
 {const c=boot(src),E=c.E;
  const r1=E('input',{type:'range',min:.5,max:1,step:.05,value:1});c.N.navNudge(r1,-1);
  ok(String(r1.value)==='0.95','0.5..1 step .05: left from 1 is 0.95',r1.value);
  const r2=E('input',{type:'range',min:0,max:1,step:.01,value:.5});c.N.navNudge(r2,1);
  ok(String(r2.value)==='0.55','0..1 step .01 moves a twentieth (0.55), exactly',r2.value);
  const r3=E('input',{type:'range',min:0,max:1,step:.01,value:1});c.N.navNudge(r3,1);
  ok(String(r3.value)==='1'&&!r3.events.length,'at max it stays and fires nothing',r3.value);
  const r4=E('input',{type:'range',min:0,max:3,step:.05,value:.1});c.N.navNudge(r4,1);
  ok(String(r4.value)==='0.25','step .05 over 0..3: +0.15 snapped',r4.value);}

 /* 6 · candidates: container rule + capture region */
 {const c=boot(src),E=c.E,root=E('div',{r:[0,0,800,600]});
  const card=E('div',{id:'card',r:[10,10,200,120],onclick:()=>{}}),b1=E('button',{id:'ctn',r:[20,90,80,24]}),b2=E('button',{id:'del',r:[110,90,80,24]});
  card.add(b1,b2);
  const empty=E('div',{id:'empty',r:[220,10,200,120],onclick:()=>{}});
  const cap=E('div',{id:'tester',r:[10,200,300,200],dataset:{nav:'capture'}}),inner=E('button',{id:'inner',r:[20,220,60,24]});cap.add(inner);
  const col=E('input',{id:'col',type:'color',r:[500,10,40,24]}),off=E('button',{id:'off',r:[560,10,40,24],dataset:{nav:'off'}});
  const hid=E('button',{id:'hid',r:[620,10,0,0]});
  root.add(card,empty,cap,col,off,hid);
  const ids=c.N.navCands(root).map(nm).sort().join();
  ok(ids==='ctn,del,empty,tester','a card with buttons yields its buttons; capture is one stop; color/off/hidden excluded',ids);}

 /* 7 · padNavFilter */
 {const c=boot(src);c.N.NAV.eat[0]={0:true};const just={0:true,1:true,9:false};c.N.padNavFilter(0,just);
  ok(just[0]===false&&just[1]===true,'an eaten A never reaches gameplay; B is untouched',JSON.stringify(just));
  const j2={0:true};c.N.padNavFilter(3,j2);ok(j2[0]===true,'a pad with nothing eaten passes through');}

 /* 8 · the whole loop: reveal, memory, onPad, Start, Back */
 {const c=boot(src),E=c.E,N=c.N,gp=pad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)');c.__pads=[gp];
  let T=1000;const step=n=>{for(let i=0;i<(n||1);i++){T+=16.7;N.navTick(T);}};
  const press=b=>{gp.buttons[b].pressed=true;step(3);gp.buttons[b].pressed=false;step(3);};
  const home=E('div',{id:'home',r:[0,0,1280,720]}),menu=E('div',{id:'menu',r:[0,0,1280,720],cls:['hidden']});
  const show=id=>{home._cls[id==='home'?'delete':'add']('hidden');menu._cls[id==='menu'?'delete':'add']('hidden');c.__scr=id;};
  const ko=E('div',{id:'btnKickOff',r:[82,283,212,155],onclick:()=>show('menu')});
  const lg=E('div',{id:'btnLeague',r:[308,283,212,155],onclick:()=>show('menu')});
  home.add(ko,lg);
  const back=E('button',{id:'menuBack',cls:['backBtn'],r:[20,20,46,46],onclick:()=>show('home')});
  const start=E('button',{id:'btnStart',r:[600,90,112,54]}),tab=E('button',{id:'tabA',r:[560,160,90,40]});
  menu.add(back,start,tab);
  c.SCREENS.home={back:null};c.SCREENS.menu={back:'home'};
  step(2);
  ok(N.NAV.root&&N.NAV.root.key==='home','the router screen is the root');
  press(0);ok(ko.clicks===0&&N.NAV.show,'the first A only reveals the cursor',ko.clicks);
  ok(N.NAV.el===ko,'revealed on the screen default',nm(N.NAV.el));
  press(15);ok(N.NAV.el===lg,'D-pad right moves',nm(N.NAV.el));
  ok(/A\|Select/.test(N.NAV.hintSig),'an Xbox pad is prompted with A',N.NAV.hintSig);
  N.NAV.mem.menu=tab;                         // left over from some earlier visit
  press(0);ok(lg.clicks===1&&c.__scr==='menu','A presses the focused card',lg.clicks);
  step(1);ok(N.NAV.el===start,'a FRESH entry lands on the default, not an old memory',nm(N.NAV.el));
  ok(N.NAV.eat[0][0]===false,'the eaten A is released once the button comes up');
  press(9);ok(start.clicks===1,'Start presses the screen\'s primary action',start.clicks);
  let hooked=0;c.SCREENS.menu.onPad=(i,b)=>{if(b===0){hooked++;return true;}return false;};
  gp.buttons[0].pressed=true;step(2);
  ok(hooked===1&&start.clicks===1,'the lobby\'s onPad hook wins over the cursor',start.clicks);
  ok(N.NAV.eat[0][0]===true,'a press the hook used is eaten too');
  gp.buttons[0].pressed=false;step(2);
  // An OPEN value owns its A/B: the lobby's leave hook must not take B out from under a selector.
  const vw=E('span',{cls:['vsel'],r:[600,300,200,34]}),vs=E('select',{id:'vs8',r:[630,300,140,34],sel:0,options:[{},{},{}]});vw.add(vs);menu.add(vw);
  let left=0;c.SCREENS.menu.onPad=(i,b)=>{if(b===1){left++;return true;}return false;};
  N.navSet(vs);press(0);press(15);press(1);
  ok(left===0&&vs.selectedIndex===0&&N.NAV.adj===null,'B cancels an open selector before the lobby hook sees it',left+'/'+vs.selectedIndex);
  c.SCREENS.menu.onPad=null;
  press(1);ok(back.clicks===1&&c.__scr==='home','B presses the screen\'s own Back button',back.clicks);
  step(1);ok(N.NAV.el===lg,'coming BACK restores where the cursor was',nm(N.NAV.el));
  ok(N.inputKind()==='pad','a pad press makes the pad the last-used device');
  // a dropdown driven by the real buttons: A opens the list, down walks it, B closes it UNCHANGED
  // (and backs out of nothing), A on the list picks.
  const hs=E('select',{id:'hs',r:[600,500,100,30],sel:0,options:[{},{},{}]});home.add(hs);N.navSet(hs);
  press(0);ok(!!N.NAV.drop&&N.NAV.drop.el===hs,'A on a dropdown opens its list');
  press(13);press(1);
  ok(hs.selectedIndex===0&&!N.NAV.drop&&c.__scr==='home','B closes the list without changing it',hs.selectedIndex);
  press(0);press(13);press(13);press(0);
  ok(hs.selectedIndex===2&&!N.NAV.drop,'A on the list picks the highlighted option',hs.selectedIndex);
  const rg=E('input',{id:'hr',type:'range',min:0,max:1,step:.01,value:.5,r:[600,560,100,20]});home.add(rg);N.navSet(rg);
  press(0);ok(N.NAV.adj===rg,'A on a slider opens it for adjusting');
  N.navSet(hs);ok(N.NAV.adj===null&&!rg.classList.contains('navAdj'),'the cursor leaving an open slider closes it');
  c.S.phase='play';show('none');step(2);
  ok(!N.NAV.root,'a live match with no overlay: the pad is gameplay\'s');}

 /* 9 · glyphs: one slot, three families */
 {const c=boot(src),N=c.N,g=k=>N.padGlyph(k);
  ok(g('A').t==='A'&&g('A').round&&g('A').c,'xbox A: a coloured disc labelled A');
  ok(!g('LB').round&&g('LB').t==='LB','a shoulder is a pill, not a disc');
  ok(g('RS').stick&&g('RS').round,'a stick is a ringed disc');
  N.NAV.fam='ps';
  ok(g('A').s==='cross'&&!g('A').t,'PlayStation A is DRAWN as a cross, never typed',JSON.stringify(g('A')));
  ok(g('Y').s==='tri'&&g('LT').t==='L2','△ on the Y slot, L2 on LT');
  ok(/<svg[^>]*><path d="M4\.6/.test(N.padKeyHTML('A')),'a PlayStation face button is inline SVG in the menu',N.padKeyHTML('A'));
  N.NAV.fam='nin';
  ok(g('A').t==='B'&&g('B').t==='A'&&g('X').t==='Y'&&g('Y').t==='X','Switch: slots are by POSITION, so A reads B',[g('A').t,g('B').t,g('X').t,g('Y').t].join());
  ok(g('START').s==='plus'&&g('LT').t==='ZL','Switch START is +, LT is ZL');
  N.NAV.fam='xbox';
  ok(g('NOPE').t==='NOPE','an unknown slot shows its own name rather than nothing');}

 /* 10 · data-pad re-labels on a family change; chords and alternatives keep their separators */
 {const c=boot(src),E=c.E,N=c.N;
  const a=E('div',{dataset:{pad:'LT+A'}}),b=E('div',{dataset:{pad:'LB/RB'}});c.doc.body.add(a,b);
  N.padLabels();
  ok(/>LT<.*nhSep">\+<.*>A</.test(a.innerHTML),'"LT+A" is LT, a plus, then A',a.innerHTML);
  ok(/nhSep">\/</.test(b.innerHTML),'"LB/RB" keeps its slash',b.innerHTML);
  const gp=pad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)');c.__pads=[gp];
  gp.buttons[0].pressed=true;N.navTick(1000);N.navTick(1017);
  ok(N.NAV.fam==='ps'&&/>L2</.test(a.innerHTML)&&/<svg/.test(a.innerHTML),'picking up a DualSense re-labels the card to L2 + ✕',a.innerHTML);}

 /* 11 · the in-match hint follows the last device */
 {const c=boot(src);vm.runInContext(HUDSRC+';globalThis.__hud={HUD,hudHint,hudHintPick,hudTok};',c);
  const H=c.__hud,N=c.N;
  const t=H.hudTok('{A} kick · [SPACE] kick');
  ok(t[0][0].pad==='A'&&t[0][3].cap==='SPACE','{A} tokenises as a pad button, [SPACE] as a keycap',JSON.stringify(t[0]));
  H.hudHint('[SPACE] kick','{A} kick');
  N.NAV.kind='kbm';ok(H.hudHintPick()===H.HUD.hint,'keyboard last: the keyboard lines');
  N.NAV.kind='pad';ok(H.hudHintPick()===H.HUD.hintP,'pad last: the pad lines');
  H.hudHint('[SPACE] kick',null);ok(H.hudHintPick()===H.HUD.hint,'no pad lines given: the keyboard lines even from a pad');
  H.hudHint(null,'{A} kick');N.NAV.kind='kbm';ok(H.hudHintPick()===H.HUD.hintP,'no keyboard lines given: the pad lines even from a keyboard');
  H.hudHint(null,null);ok(!H.hudHintPick(),'no hint at all is no hint');}

 /* 12 · the layout editor on a pad — padnav driving the REAL layout.js pad functions */
 {const c=boot(src),E=c.E,N=c.N,gp=pad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)');c.__pads=[gp];
  const scr=E('div',{id:'menu',r:[0,0,1600,900]}),wrap=E('div',{id:'wrapM',cls:['lyEditing'],r:[100,100,1200,700],cw:1200});
  const pA=E('div',{id:'pA',cls:['panel'],r:[116,116,384,288],style:{left:'16px',top:'16px',width:'384px',height:'288px'}});
  const pB=E('div',{id:'pB',cls:['panel'],r:[516,116,384,288],style:{left:'416px',top:'16px',width:'384px',height:'288px'}});
  const inner=E('button',{id:'innerBtn',r:[130,300,80,30]});pA.add(inner);
  const bar=E('div',{id:'lyBar',r:[600,10,300,40]}),done=E('button',{id:'lyDone',r:[700,16,80,28]});bar.add(done);
  wrap.add(pA,pB);scr.add(wrap,bar);c.doc.body.add(scr);
  c.SCREENS.menu={back:'home',lay:{wrap:'#wrapM',btn:'btnLay',panels:['pA','pB']}};c.__scr='menu';
  c.doc.querySelector=sel=>c.doc.body.querySelector(sel);
  vm.runInContext(lsrc+';globalThis.__lay={set:(k,b)=>{layEditing=k;layBar=b;},LAY_PAD};',c);
  const L=c.__lay;L.set('menu',bar);
  // layout.js applies the live screen when it loads, which hands a wrap with no save back to the CSS flow (inline
  // styles cleared) — so the arrangement being edited is laid down after it.
  Object.assign(pA.style,{left:'16px',top:'16px',width:'384px',height:'288px'});Object.assign(pB.style,{left:'416px',top:'16px',width:'384px',height:'288px'});
  let T=1000;const step=n=>{for(let i=0;i<(n||1);i++){T+=16.7;N.navTick(T);}};
  const press=b=>{gp.buttons[b].pressed=true;step(3);gp.buttons[b].pressed=false;step(3);};
  step(2);
  ok(N.NAV.root&&N.NAV.root.key==='lay','while editing, the layout editor is the root',N.NAV.root&&N.NAV.root.key);
  press(0);ok(N.NAV.el===pA,'revealed on the first PANEL, not a button inside it',nm(N.NAV.el));
  press(15);ok(N.NAV.el===pB,'D-pad right walks panel to panel',nm(N.NAV.el));
  press(14);press(12);ok(N.NAV.el!==inner,'a button inside a panel is never a stop in edit mode',nm(N.NAV.el));
  N.navSet(pB);
  ok(/A\|Grab/.test(N.NAV.hintSig),'a panel under the cursor offers Grab',N.NAV.hintSig);
  press(0);ok(L.LAY_PAD.el===pB&&pB._cls.has('lyDrag'),'A grabs the panel');
  ok(/Move/.test(N.NAV.hintSig)&&/Drop/.test(N.NAV.hintSig)&&/Cancel/.test(N.NAV.hintSig),'held: Move / Resize / Drop / Cancel',N.NAV.hintSig);
  press(15);press(13);
  ok(pB.style.left==='432px'&&pB.style.top==='32px','D-pad moves it one grid square a press',pB.style.left+' '+pB.style.top);
  ok(N.NAV.el===pB,'the cursor stays on the panel it is carrying',nm(N.NAV.el));
  press(3);press(15);
  ok(pB.style.width==='400px'&&pB.style.left==='432px','Y swaps to resize: right widens instead of moving',pB.style.width+' @'+pB.style.left);
  press(1);
  ok(!L.LAY_PAD.el&&pB.style.left==='416px'&&pB.style.top==='16px'&&pB.style.width==='384px','B puts it back exactly where it was grabbed',pB.style.left+' '+pB.style.top+' '+pB.style.width);
  ok(!c.cfg.layouts.menu,'a cancelled move saves nothing');
  press(0);press(15);press(15);press(0);
  ok(!L.LAY_PAD.el&&pB.style.left==='448px','A drops it where it now is',pB.style.left);
  const sv=c.cfg.layouts.menu;
  ok(!!(sv&&sv.p.pB&&sv.p.pA)&&sv.p.pB.x-sv.p.pA.x===432,'the drop is SAVED, normalised like a mouse release',sv&&JSON.stringify(sv.p));
  for(let i=0;i<200;i++)press(15);
  ok(parseFloat(pB.style.left)<=1200-384,'a pad cannot push a panel off the wrap either',pB.style.left);
  L.set(null,null);step(2);
  ok(N.NAV.root&&N.NAV.root.key==='menu','editor closed: the screen has the pad again',N.NAV.root&&N.NAV.root.key);}

 return{pass,fail,fails:fails.slice()};
}

const base=suite(NAVSRC,LAYSRC);
console.log('padnav harness: '+base.pass+' passed, '+base.fail+' failed');
base.fails.forEach(f=>console.log('  FAIL '+f));

/* Mutations: each must break something. mutate() refuses a no-op so a drifted anchor reports
   itself instead of scoring a point. */
function mutate(a,b){const m=NAVSRC.replace(a,b);if(m===NAVSRC)throw new Error('MUTATION DID NOT APPLY: '+String(a).slice(0,60));return m;}
function mutL(a,b){const m=LAYSRC.replace(a,b);if(m===LAYSRC)throw new Error('MUTATION DID NOT APPLY: '+String(a).slice(0,60));return m;}
const MUT=[
 ['sideways penalty back at 3x',()=>mutate('gap*1.2','gap*3')],
 ['PlayStation tested before Xbox',()=>mutate("if(/xbox|045e|xinput/.test(id))return'xbox';",'')],
 ['no container rule',()=>mutate("return c1.filter(a=>a.dataset.nav==='capture'||!c1.some(b=>b!==a&&a.contains(b)));",'return c1;')],
 ['memory used on a fresh entry',()=>mutate('if(!back)delete NAV.mem[R.key];','')],
 ['filter lets eaten presses through',()=>mutate('for(const k in just)if(just[k]&&e[k])just[k]=false;','')],
 ['first press acts instead of revealing',()=>mutate('else navDefault();\n return false;','else navDefault();\n return true;')],
 ['◀▶ change a closed select again',()=>mutate('if(el&&NAV.adj===el){',"if(el&&(NAV.adj===el||el.tagName==='SELECT')){")],
 ['A on a select changes it instead of opening a list',()=>mutate("if(t==='SELECT'){if(navVsel(el))navAdjStart(el);else navDropOpen(el);return;}","if(t==='SELECT'){navAdjStart(el);return;}")],
 ['a value selector opens as a list again',()=>mutate("function navVsel(el){return!!(el.parentElement&&el.parentElement.classList.contains('vsel'));}",'function navVsel(el){return false;}')],
 ['a selector clamps instead of wrapping',()=>mutate('i=(i+d+n)%n;if(!o[i].disabled','i=Math.max(0,Math.min(n-1,i+d));if(!o[i].disabled')],
 ['a selector stops at a disabled option instead of skipping it',()=>mutate('for(let k=0;k<n;k++){i=(i+d+n)%n;if(!o[i].disabled&&!o[i].hidden)break;}','i=(i+d+n)%n;')],
 ['◀▶ wander down their own panel again',()=>mutate('if(dx&&gap>0&&cc){const ec=navCol(el);if(!ec||ec===cc)continue;}','')],
 ['B picks from an open list',()=>mutate('navDropEnd(false)||navAdjEnd(false)','navDropEnd(true)||navAdjEnd(false)')],
 ['the list walks onto disabled options',()=>mutate("if(!D.items[i].classList.contains('off'))break;",'break;')],
 ['B keeps the edited value',()=>mutate('if(!keep&&el.isConnected){','if(false){')],
 ['the cursor leaving leaves the edit open',()=>mutate(' if(NAV.adj&&NAV.adj!==el)navAdjEnd(true);','')],
 ['same-row guard dropped',()=>mutate('q.top<a.top+m','q.top<a.top')],
 ['an open value hands B to the lobby hook',()=>mutate('&&!NAV.adj&&!NAV.drop&&R.scr&&','&&R.scr&&')],
 ['onPad hook ignored',()=>mutate('&&R.scr.onPad(i,b)','&&false')],
 ['pad presses never mark the pad as in use',()=>mutate("padLabels();}NAV.kind='pad';}","padLabels();}}")],
 ['Switch labelled by print, not position',()=>mutate("nin:{A:{t:'B'},B:{t:'A'},","nin:{A:{t:'A'},B:{t:'B'},")],
 ['PlayStation face buttons typed as letters',()=>mutate("ps:{A:{s:'cross',","ps:{A:{t:'X',")],
 ['family change never re-labels the page',()=>mutate('if(f!==NAV.fam){NAV.fam=f;padLabels();}','if(f!==NAV.fam){NAV.fam=f;}')],
 ['editor offers the DOM, not whole panels',()=>mutate('function navList(R){return R.cands?R.cands():navCands(R.el);}','function navList(R){return navCands(R.el);}')],
 ['a held panel lets the cursor move instead',()=>mutate('if(navGrab()){layPadNudge(dx,dy);','if(false){layPadNudge(dx,dy);')],
 ['B keeps the move',()=>[NAVSRC,mutL('if(!keep&&LAY_PAD.was)','if(false&&LAY_PAD.was)')]],
 ['nudge ignores the grid',()=>[NAVSRC,mutL('laySnap(x+dx*LAY_G)','x+dx*LAY_G/2')]]
];
let caught=0;
for(const[name,mk]of MUT){let r;try{const m=mk();r=Array.isArray(m)?suite(m[0],m[1]):suite(m);}catch(e){console.log('  MUTATION ERROR  '+name+': '+e.message);continue;}
 if(r.fail>0){caught++;console.log('  caught  '+name+'  ('+r.fail+' failed)');}else console.log('  MISSED  '+name);}
console.log('mutation checks (each must FAIL something): '+caught+'/'+MUT.length+' mutations caught');
process.exit(base.fail||caught<MUT.length?1:0);
