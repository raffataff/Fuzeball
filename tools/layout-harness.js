'use strict';
// layout-harness.js: the layout editor's stored form (js/layout.js, v:2). node tools/layout-harness.js (from the project root or tools/)
// a saved layout is fractions across (x, w) and px down (y, h); must hold:
//   1. save then apply at the same canvas width is exact, at every width
//   2. a gutter between two panels survives any rescale at one grid square, and nothing that didn't overlap starts to
//   3. an arrangement scales with the canvas (three columns stay three on the Deck)
//   4. a v1 (px) save converts once, looks identical where converted, and a too-wide one fills the canvas
// boots js/layout.js in a vm with no screens registered (no DOM needed); exit 0 = pass, 1 = fail
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=fs.existsSync(path.join(process.cwd(),'index.html'))?process.cwd():path.resolve(process.cwd(),'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/layout.js'),'utf8');
const EXPORT='\n;globalThis.__L={layStore,layPx,layMigrate,layNormalise,LAY_G,LAY_MINW,LAY_V,'
 +'layCur,layPresetList,laySavePreset,layDelPreset,layRenamePreset,layPxSame,edit:k=>{layEditing=k;}};';

function boot(src){
 const ctx={Math,JSON,Object,Array,String,Number,console,saves:0,
  $:()=>null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),innerWidth:1920,
  addEventListener(){},screenId:()=>'home',cfg:{layouts:{},layoutPresets:{}},
  CONFIG:{layoutEditor:{presetsMax:3,presets:{menu:[{n:'Wide',L:{v:2,p:{a:{x:0,w:.6,y:0,h:300}},h:300}}]}}}};
 ctx.saveCfg=()=>{ctx.saves++;};
 vm.createContext(ctx);vm.runInContext(src+EXPORT,ctx);
 return ctx;
}
let pass=0,fail=0;const fails=[];
function ok(c,m){if(c)pass++;else{fail++;fails.push(m);}}

function suite(src){
 pass=0;fail=0;fails.length=0;
 const c=boot(src),L=c.__L,G=L.LAY_G;
 // A three-column arrangement one gutter apart, the shape Kick Off's team tab is captured as.
 const three=()=>L.layNormalise({a:{x:0,y:0,w:384,h:288},b:{x:400,y:0,w:512,h:448},c:{x:928,y:0,w:384,h:288}});
 const place=(s,A)=>{const o={};for(const p in s.p)o[p]=L.layPx(s.p[p],A);return o;};

 /* 1 · exact round trip */
 {let bad=null;
  for(let A=1060;A<=2600&&!bad;A+=7){
   const cx=Math.floor((A-2*G-240)/G)*G;   // saved boxes are always on the grid
   const n=L.layNormalise({a:{x:0,y:0,w:256,h:200},b:{x:272,y:0,w:cx-G-272,h:200},c:{x:cx,y:48,w:240,h:128}});
   const r=place(L.layStore(n,A),A);
   for(const p in n.p)if(r[p].x!==n.p[p].x||r[p].w!==n.p[p].w){bad=A+' '+p+' '+JSON.stringify(r[p])+' vs '+JSON.stringify(n.p[p]);break;}}
  ok(!bad,'save then apply at the same width is exact at every width'+(bad?'  ['+bad+']':''));
  const s=L.layStore(three(),1640);
  ok(s.v===L.LAY_V&&s.p.b.y===0&&s.p.b.h===448,'y and h stay px, and the save is stamped v:2');
  ok(Object.values(s.p).every(b=>b.x>=0&&b.x+b.w<=1.0001),'every cell lies inside the canvas (0..1)');}

 /* 2 · gutters and overlaps under rescale */
 {const s=L.layStore(three(),1640);let gut=null,ovl=null,ord=null;
  for(let A=1060;A<=2600;A+=5){const r=place(s,A);
   const g1=r.b.x-(r.a.x+r.a.w),g2=r.c.x-(r.b.x+r.b.w);
   if(gut===null&&(g1!==G||g2!==G))gut=A+': '+g1+','+g2;
   if(ovl===null&&(g1<0||g2<0))ovl=A;
   if(ord===null&&!(r.a.x<r.b.x&&r.b.x<r.c.x))ord=A;}
  ok(gut===null,'a one-square gutter stays exactly one square at every width'+(gut?'  ['+gut+']':''));
  ok(ovl===null,'panels that sat apart never overlap after a rescale'+(ovl?'  [A='+ovl+']':''));
  ok(ord===null,'columns keep their order');}

 /* 3 · it scales */
 {const s=L.layStore(three(),1640),d=place(s,1264),w=place(s,2560);
  const span=r=>r.c.x+r.c.w-r.a.x,made=1312;
  ok(Math.abs(span(d)-made*(1264-G)/(1640-G))<=G,'on a Deck-width canvas the arrangement shrinks in proportion  ['+span(d)+']');
  ok(span(w)>made+G*20,'on a wider canvas it grows instead of sitting narrow in the middle  ['+span(w)+']');
  ok(d.b.w>d.a.w&&w.b.w>w.a.w,'the wide middle column stays the widest');
  ok(Object.values(place(L.layStore(L.layNormalise({t:{x:0,y:0,w:224,h:128}}),1640),1060)).every(b=>b.w>=L.LAY_MINW),'no panel is scaled below LAY_MINW');}

 /* 4 · v1 migration */
 {c.cfg.layouts={menu:{p:{a:{x:32,y:16,w:384,h:288},b:{x:432,y:16,w:384,h:288}},w:816,h:304}};c.saves=0;
  const m=L.layMigrate('menu',1600),r=place(m,1600);
  ok(m.v===L.LAY_V&&c.cfg.layouts.menu===m,'a v1 save is rewritten as v:2 in place');
  ok(c.saves===1,'…and saved once');
  ok(r.a.x===0&&r.a.w===384&&r.b.x===400&&r.b.w===384&&m.p.a.y===0&&m.p.b.h===288,'…and looks identical (normalised) in the window it was converted in  ['+JSON.stringify(r)+']');
  c.saves=0;L.layMigrate('menu',900);
  ok(c.saves===0&&c.cfg.layouts.menu===m,'a v:2 save is left alone');
  c.cfg.layouts={big:{p:{a:{x:0,y:0,w:1024,h:300},b:{x:1040,y:0,w:960,h:300}},w:2000,h:300}};
  const b=place(L.layMigrate('big',1200),1200);
  ok(b.b.x+b.b.w<=1200-2*G&&b.b.x-(b.a.x+b.a.w)===G,'a v1 save wider than the canvas fills it, gutter intact  ['+JSON.stringify(b)+']');}

 /* 5 · presets: the picker shows what the live layout IS, and own presets save / cap / rename / delete */
 {const stock=L.layStore(three(),1640);stock.d=1;
  c.cfg.layouts={menu:stock};c.cfg.layoutPresets={};L.edit('menu');
  ok(L.layPresetList('menu').map(p=>p.v).join()==='def,b0','the list is Default, then the built-ins');
  ok(L.layCur('menu')==='def','a stock (d:1) layout reads as Default');
  c.cfg.layouts.menu=JSON.parse(JSON.stringify(c.CONFIG.layoutEditor.presets.menu[0].L));
  ok(L.layCur('menu')==='b0','a layout equal to a built-in reads as that preset');
  c.cfg.layouts.menu.p.a.y=16;ok(L.layCur('menu')==='','moved off it: Unsaved');
  L.laySavePreset();const own=c.cfg.layoutPresets.menu;
  ok(own&&own.length===1&&own[0].n==='Custom 1'&&!('d' in own[0].L),'Save as preset keeps it as Custom 1, without the stock flag');
  ok(L.layCur('menu')==='c0','…and the picker now shows it');
  c.cfg.layouts.menu=stock;L.laySavePreset();
  ok(!c.cfg.layouts.menu.d,'saving the stock layout as a preset clears its flag, so closing keeps it');
  ok(own[1]&&!('d' in own[1].L),'…and the preset itself is stored without it');
  L.laySavePreset();ok(own.length===2,'a layout that already is a preset is not saved twice  [had '+own.length+']');
  const mv=d=>{const x=JSON.parse(JSON.stringify(c.cfg.layouts.menu));x.p.b.y+=d;c.cfg.layouts.menu=x;};
  mv(16);L.laySavePreset();mv(16);L.laySavePreset();
  ok(own.length===3,'own presets stop at presetsMax  [had '+own.length+']');
  c.cfg.layouts.menu=JSON.parse(JSON.stringify(own[2].L));ok(L.layCur('menu')==='c2','back on the third preset');
  L.layRenamePreset('   Streamer   ');ok(own[2].n==='Streamer','rename trims  ['+own[2].n+']');
  L.layRenamePreset('   ');ok(own[2].n==='Streamer','a blank name keeps the old one');
  L.layRenamePreset('x'.repeat(40));ok(own[2].n.length===20,'names stop at 20 characters');
  L.layDelPreset();ok(own.length===2&&!own.some(p=>p.n==='x'.repeat(20)),'Delete removes the one showing');
  L.edit(null);}

 /* 6 · a click that moved nothing is not a change, even for a preset made at another width */
 {const P=L.layStore(three(),1640);let bad=null;
  for(let A=1060;A<=2560&&!bad;A+=37){const o={};for(const p in P.p){const q=L.layPx(P.p[p],A);o[p]={x:q.x,y:P.p[p].y,w:q.w,h:P.p[p].h};}
   if(!L.layPxSame(P,L.layNormalise(o),A))bad=A;}
  ok(!bad,'a preset applied at any width compares equal to itself in px'+(bad?'  [A='+bad+']':''));
  const o={};for(const p in P.p){const q=L.layPx(P.p[p],1264);o[p]={x:q.x,y:P.p[p].y,w:q.w,h:P.p[p].h};}
  o.b.y+=16;ok(!L.layPxSame(P,L.layNormalise(o),1264),'…and a panel moved one square is a change');}

 return{pass,fail,fails:fails.slice()};
}

const base=suite(SRC);
console.log('layout harness: '+base.pass+' passed, '+base.fail+' failed');
base.fails.forEach(f=>console.log('  FAIL '+f));

function mutate(a,b){const m=SRC.replace(a,b);if(m===SRC)throw new Error('MUTATION DID NOT APPLY: '+String(a).slice(0,60));return m;}
const MUT=[
 ['the cell drops its gutter',()=>mutate('w:layR4((b.w+LAY_G)/S)','w:layR4(b.w/S)')],
 ['store and apply disagree on the unit',()=>mutate('const S=Math.max(LAY_G,A-LAY_G),o={};','const S=Math.max(LAY_G,A),o={};')],
 ['two decimals',()=>mutate('function layR4(v){return Math.round(v*1e4)/1e4;}','function layR4(v){return Math.round(v*1e2)/1e2;}')],
 ['right edge floored, left rounded',()=>mutate('laySnap((b.x+b.w)*S)','Math.floor((b.x+b.w)*S/LAY_G)*LAY_G')],
 ['width scaled on its own',()=>mutate('laySnap((b.x+b.w)*S)-LAY_G-l','laySnap(b.w*S)-LAY_G')],
 ['no LAY_MINW floor',()=>mutate('return {x:l,w:Math.max(LAY_MINW,laySnap((b.x+b.w)*S)-LAY_G-l)};','return {x:l,w:laySnap((b.x+b.w)*S)-LAY_G-l};')],
 ['migration forgets to save',()=>mutate('cfg.layouts[k]=layStore(n,Math.max(A,n.w+LAY_G*2));saveCfg();','cfg.layouts[k]=layStore(n,Math.max(A,n.w+LAY_G*2));')],
 ['a too-wide v1 overflows',()=>mutate('layStore(n,Math.max(A,n.w+LAY_G*2))','layStore(n,A)')],
 ['migration re-runs on v:2',()=>mutate('if(!L||L.v===LAY_V)return L;','if(!L)return L;')],
 ['stock flag ignored by the picker',()=>mutate("const L=cfg.layouts[k];if(!L||L.d)return 'def';","const L=cfg.layouts[k];if(!L)return 'def';")],
 ['no preset cap',()=>mutate("if(own.length>=CONFIG.layoutEditor.presetsMax||(cur&&cur!=='def')){","if(cur&&cur!=='def'){")],
 ['a preset saved twice',()=>mutate("if(own.length>=CONFIG.layoutEditor.presetsMax||(cur&&cur!=='def')){","if(own.length>=CONFIG.layoutEditor.presetsMax){")],
 ['a saved preset keeps the stock flag',()=>mutate('const L=layClone(cfg.layouts[k]);delete L.d;','const L=layClone(cfg.layouts[k]);')],
 ['px compare ignores what apply draws',()=>mutate('o[p]={x:q.x,y:s.y,w:q.w,h:Math.max(LAY_MINH,s.h)};','o[p]={x:q.x,y:s.y,w:q.w+LAY_G,h:s.h};')],
];
let caught=0;
MUT.forEach(([n,f])=>{const r=suite(f());if(r.fail){caught++;console.log('  caught  '+n+'  ('+r.fail+' failed)');}else console.log('  MISSED  '+n);});
console.log('mutation checks (each must FAIL something): '+caught+'/'+MUT.length+' mutations caught');
process.exit(base.fail||caught<MUT.length?1:0);
