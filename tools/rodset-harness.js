// rod-set harness. node tools/rodset-harness.js
// slices rodSetKey / loadRodSet / ensureTableRods (models.js), applyTable / curSkin / applySkin / selectSkin (arena.js) and reskinRods (world.js) and runs them on live CONFIG
// question: does a skin's rods:'<id>' pick the set the rods wear (else the table's, else the stock one), load from CONFIG.rodSets, and does a skin or table change hold its onReady until that set is resident; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;if(to&&b<0)throw new Error('slice miss: '+to);return src.slice(a,b<0?src.length:b);};
const MOD=slice(rd('js/models.js'),'function rodSetKey(','// clone the rod set');
const ARE=slice(rd('js/arena.js'),'function applyTable(','// ===== arena debug wireframe');
const WLD=slice(rd('js/world.js'),'function reskinRods(','// one lumpy smoke puff');
// a deferred GLTF loader: every load waits in Q until the test serves it (a url in HAVE loads, any other 404s)
const stubs=[
 "var Q=[],LOG=[],HAVE=new Set(),DRESS=[],SKINQ=[],SKINSYNC=true;",
 "function newGLTF(){return{load:function(u,ok,p,err){LOG.push(u);Q.push({u:u,ok:ok,err:err});}};}",
 "function serve(){while(Q.length){const j=Q.shift();if(HAVE.has(j.u))j.ok({scene:{url:j.u}});else j.err(new Error('404'));}}",
 "const rodSets={},rodSetLoading={},ROD_SIZES=[1,2,3,5];",
 "var activeTable=null,ARENA_ON=false,ENDWALL_H=0,WALL_H=10,tableGroups={},primTable=null,fieldMesh=null,tableNets={},netMats=null;",
 "var skinGroups={},tablePrimObjs={},skinLed={},ledMat=null,primLedMat=null,skinRodHoles={},rodHoleMeshes=[],skinHasFrame={},goalFrames=[];",
 "function loadSkin(id,sk,cb){if(SKINSYNC)cb();else SKINQ.push(cb);}",
 "var rods=[{idx:0}],rodsDressedFor=null;",
 "function dressRod(r,tid){DRESS.push(rodSetKey(tid));}",
 "function refreshRodCustomMats(){}"
].join(NL);

function boot(mut){
 let src=[MOD,ARE,WLD].join(NL);
 if(mut){const before=src;src=src.split(mut.from).join(mut.to);
  if(src===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console:{log:console.log,warn:()=>{}},Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{},length:0,key:()=>null}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,src,
  ';globalThis.X={CONFIG:CONFIG,cfg:cfg,Q:Q,LOG:LOG,HAVE:HAVE,DRESS:DRESS,SKINQ:SKINQ,serve:serve,rodSets:rodSets,'+
  'skinSync:function(v){SKINSYNC=v;},act:function(){return activeTable;},dressed:function(){return rodsDressedFor;},'+
  'rodSetKey:rodSetKey,loadRodSet:loadRodSet,ensureTableRods:ensureTableRods,applyTable:applyTable,selectSkin:selectSkin,reskinRods:reskinRods};'].join(NL),ctx);
 return ctx.X;
}

const ROD=n=>'fuzeball_rod_'+n+'man.glb';
function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const C=X.CONFIG,T=C.tables.classic;
 // a test set: own folder, the 1-man file renamed, the 3-man missing
 C.rodSets.alt={folder:'alt/',files:{1:'one.glb'}};
 ['alt/one.glb','alt/'+ROD(2),'alt/'+ROD(5)].forEach(u=>X.HAVE.add(u));
 [1,2,3,5].forEach(n=>{X.HAVE.add(C.rodSets.classic.folder+ROD(n));X.HAVE.add('assets/rods/'+ROD(n));});
 T.skins.alienTech.rods='alt';T.skins.strike.rods='nope';
 const urls=()=>X.Q.map(j=>j.u);
 X.cfg.table='classic';X.cfg.skins={};
 ok('a skin with no rods of its own wears its table\'s set',X.rodSetKey('classic')==='classic','got '+X.rodSetKey('classic'));
 X.cfg.skins.classic='alienTech';
 ok('the selected skin\'s rods pick the set',X.rodSetKey('classic')==='alt','got '+X.rodSetKey('classic'));
 ok('an explicit skin id beats the selected one',X.rodSetKey('classic','wood')==='classic','got '+X.rodSetKey('classic','wood'));
 ok('an id missing from CONFIG.rodSets falls back to the stock set',X.rodSetKey('classic','strike')==='_shared','got '+X.rodSetKey('classic','strike'));
 ok('an unknown table wears the stock set',X.rodSetKey('nosuch')==='_shared');
 {const keep=C.tables.arena.rods;delete C.tables.arena.rods;
  ok('a table with no rods and a skin with none: the stock set',X.rodSetKey('arena')==='_shared','got '+X.rodSetKey('arena'));C.tables.arena.rods=keep;}
 // loading
 {let n=0;X.loadRodSet('alt',()=>n++);X.loadRodSet('alt',()=>n++);
  const u=urls().slice().sort();
  ok('a set loads from its own folder, with a per-size file override',u.join()===['alt/'+ROD(2),'alt/'+ROD(3),'alt/'+ROD(5),'alt/one.glb'].join(),u.join());
  X.LOG.length=0;X.serve();
  ok('a size missing from a set does not go looking in the legacy root',X.LOG.length===0&&X.Q.length===0,X.LOG.join());
  ok('two asks while in flight share one batch and both callbacks run once',n===2,'cbs '+n);
  ok('the loaded sizes are kept, the missing one left for the stock fallback',X.rodSets.alt[1]&&X.rodSets.alt[5]&&!X.rodSets.alt[3]);}
 {X.loadRodSet('_shared');const u=urls().slice().sort();X.serve();
  ok('the stock set loads from assets/rods/',u.join()===[1,2,3,5].map(n=>'assets/rods/'+ROD(n)).join(),u.join());}
 // a skin change stages the rods
 X.cfg.skins={};X.applyTable();X.serve();X.DRESS.length=0;
 ok('applyTable leaves the rods on the table\'s set',X.dressed()==='classic','got '+X.dressed());
 {delete X.rodSets.alt;let n=0;X.selectSkin('classic','alienTech',()=>n++);
  ok('selectSkin holds onReady while the skin\'s rod set loads',n===0&&X.Q.length>0,'ready '+n+', loads '+X.Q.length);
  X.serve();
  ok('...and fires it once the set lands',n===1,'ready '+n);
  ok('...with the rods re-dressed in the skin\'s set',X.dressed()==='alt'&&X.DRESS.length===1&&X.DRESS[0]==='alt',X.dressed()+' '+X.DRESS.join());}
 {X.DRESS.length=0;let n=0;X.selectSkin('classic','wood',()=>n++);X.serve();
  ok('back to a skin on the table\'s set re-dresses again',n===1&&X.dressed()==='classic'&&X.DRESS.length===1,X.dressed()+' '+X.DRESS.join());}
 {X.DRESS.length=0;let n=0;X.selectSkin('classic','proLeague',()=>n++);
  ok('two skins sharing a set: no re-dress, onReady at once',n===1&&X.DRESS.length===0&&X.Q.length===0,'ready '+n+', dress '+X.DRESS.length);}
 {X.skinSync(false);X.DRESS.length=0;let n=0;X.selectSkin('classic','alienTech',()=>n++);
  const early=n;X.SKINQ.shift()();
  ok('a cached rod set still waits for the skin GLB',early===0&&n===1,'early '+early+', after '+n);X.skinSync(true);}
 {X.DRESS.length=0;X.Q.length=0;let n=0;X.selectSkin('arena','standard',()=>n++);
  ok('a skin picked for a table not in play leaves the rods alone',n===1&&X.DRESS.length===0&&X.Q.length===0,'ready '+n+', dress '+X.DRESS.length+', loads '+X.Q.length);}
 // a table change stages the rods
 {X.cfg.skins.classic='wood';X.applyTable();X.serve();delete X.rodSets.alt;X.cfg.skins.classic='alienTech';
  let n=0;X.applyTable(()=>n++);
  ok('applyTable holds onReady while the rod set loads',n===0&&X.Q.length>0,'ready '+n);
  X.serve();
  ok('...then fires once, the rods on the new set',n===1&&X.dressed()==='alt','ready '+n+', '+X.dressed());}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {n:'the skin\'s rods are ignored',from:'id=(sd&&sd.rods)||T.rods',to:'id=T.rods'},
 {n:'an unknown set id is not checked',from:"return (typeof id==='string'&&CONFIG.rodSets&&CONFIG.rodSets[id])?id:'_shared';",to:"return id||'_shared';"},
 {n:'an explicit skin id is ignored',from:'const sk=skinId!==undefined?skinId:',to:'const sk='},
 {n:'loadRodSet reads the table registry',from:'CONFIG.rodSets[key]:null',to:'CONFIG.tables[key]:null'},
 {n:'the per-size file override is ignored',from:"const file=files[n]||(",to:"const file=("},
 {n:'a set\'s missing size falls into the legacy root',from:"if(key!=='_shared'){console.warn(",to:"if(false){console.warn("},
 {n:'an in-flight set starts a second batch',from:'if(rodSetLoading[key]){if(cb)rodSetLoading[key].push(cb);return;}',to:''},
 {n:'selectSkin fires onReady with the skin alone',from:'const settled=()=>{if(--left===0&&onReady)onReady();};',to:'const settled=()=>{if(--left<=1&&onReady)onReady();};'},
 {n:'selectSkin never touches the rods',from:'ensureTableRods(id,()=>{if(typeof reskinRods===\'function\')reskinRods(id);settled();});'+NL+' else settled();'+NL+' if(typeof saveCfg',to:'settled();settled();'+NL+' if(typeof saveCfg'},
 {n:'a skin for another table re-dresses the live rods',from:'activeTable===CONFIG.tables[id]&&typeof ensureTableRods',to:'typeof ensureTableRods'},
 {n:'applyTable fires onReady with the skin alone',from:'  if(--left>0)return;'+NL+'  if(typeof pruneSkins',to:'  if(typeof pruneSkins'},
 {n:'reskinRods re-dresses a set the rods already wear',from:'if(rodsDressedFor===key)return;',to:''}
];
let missed=0;
for(const m of MUT){
 let caught=false,detail='';
 try{const res=suite(boot(m));caught=res.some(t=>!t.ok);if(caught)detail=res.filter(t=>!t.ok).length+' assertions';}
 catch(e){detail='THREW '+e.message;caught=!/no-op|slice miss/.test(e.message);if(!caught)missed++;}
 if(!caught&&!detail.startsWith('THREW')){missed++;detail='NOT CAUGHT';}
 console.log('  '+(caught?'caught ':'MISSED ')+' ('+(detail||'-')+')  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
