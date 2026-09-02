'use strict';
/* ===== charge-verdict harness — node tools/chargeverdict-harness.js =====
   The DISPLAY half of the charged shot. js/shots.js decides which band a wind-up ended in and
   stamps it on the rod (tools/shots-harness.js covers that); this covers what the player actually
   sees — the marker's verdict words, their colour, and the gate that keeps them out of a match.

   IT DRIVES THE REAL fxUpdate() and the real notice(), not a copy of their logic. The recorder is
   a fake #notice element: notice() writes textContent and a --nc colour and then adds .show, so
   the classList shim treats that .show as the event. Testing the reimplementation instead would
   have proved nothing about the file that ships.

   WHY THE ONCE-PER-STAMP TEST EARNS ITS PLACE: the words are fired from the MARKER's own edge
   (r.chgEndT changing) inside a loop that runs every frame for the whole hold. An edge test that
   drifts to a level test turns one line into sixty, which reads as a stuck HUD rather than as a
   bug in the shot code. Mutations at the bottom must each break the suite. */

const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

let pass=0,fail=0;const fails=[];
const ok=(c,m)=>{if(c)pass++;else{fail++;fails.push(m);}};
const eq=(a,b,m)=>ok(a===b,m+' (got '+JSON.stringify(a)+', want '+JSON.stringify(b)+')');

/* ---- the sandbox ---------------------------------------------------------------------------
   Only what fx.js's indicator path reaches for. Anything core.js or config.js already declares
   ($, cfg, ROD_H, F, PHY, pCount…) is ASSIGNED here, never re-declared, or the context throws
   "already declared" and every later assertion silently becomes a pass. */
function build(srcFx){
 const els={},said=[];
 const el=id=>els[id]||(els[id]={id,textContent:'',innerHTML:'',offsetWidth:1,
  style:{setProperty(k,v){this[k]=v;}},
  classList:{add(c){if(c==='show')said.push({text:els[id].textContent,col:els[id].style['--nc']});},
             remove(){},toggle(){}}});
 const ctx={console,Math,Object,Array,String,Number,JSON,setTimeout:()=>0,clearTimeout(){},
  document:{getElementById:el},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  __said:said};
 ctx.globalThis=ctx;ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(read('js/core.js'),ctx,{filename:'core.js'});
 vm.runInContext(read('js/config.js'),ctx,{filename:'config.js'});
 vm.runInContext(`
  var THREE={Color:function(){this.set=function(){return this;};this.lerp=function(){return this;};}};
  var S={time:0,phase:'play',seats:[{}],trn:null,trial:null,eff:[{big:0},{big:0}],
         balls:[],shake:0,pu:{obj:null,spin:1},fb:null};
  var theRod=null;
  function seatRod(){return theRod;}
  function seatCol(){return '#22aaff';}
  var indicators=[{visible:false,userData:{},material:{color:{set(){},copy(){}}},
    position:{set(){}},scale:{setScalar(){}},rotation:{y:0}}];
  var sprites=[],pData=[];for(var i=0;i<pCount;i++)pData.push({life:0,vx:0,vy:0,vz:0});
  var pGeo={attributes:{position:{array:new Array(pCount*3).fill(0),needsUpdate:false},
                        color:{array:new Array(pCount*3).fill(0),needsUpdate:false}}};
  var particles={visible:false},camera={quaternion:{}};
  var dropRing={visible:false,position:{},material:{},scale:{set(){}}};
  var goalFrames=[{scale:{z:1},userData:{}},{scale:{z:1},userData:{}}];
  var glbGoalGrow=[[],[]],glbGoalWall=[[],[]],glbGoalSplit=[];
  var goalLights=[],ledMat=null;
  cfg.trails=false;cfg.particles=false;
  // shots.js is not loaded here — the readers fxUpdate asks it for, stubbed flat.
  function shotCharge(r){return r.chg;}
  function shotChargeBlock(r){return r.chgBlock||0;}
  function shotChargeBand(r){return -1;}
 `,ctx);
 vm.runInContext(srcFx,ctx,{filename:'fx.js'});
 vm.runInContext('globalThis.__c={CHG_COL,fxUpdate};',ctx);
 return ctx;
}

/* ---- the suite ---------------------------------------------------------------------------- */
function run(srcFx){
 pass=0;fail=0;fails.length=0;
 const ctx=build(srcFx),CH=vm.runInContext('CONFIG.shots.charge',ctx),T=CH.text;

 // One stamped verdict, N frames of rendering. Returns every line that reached the screen.
 const show=(band,trn,frames)=>{
  ctx.__said.length=0;
  ctx.S.trn=trn?{}:null;ctx.S.time=100;
  ctx.indicators[0].userData={};
  ctx.theRod={x:0,offset:0,chg:-1,chgBlock:0,chgEndT:100,chgEndBand:band,chgEndK:0.6};
  for(let f=0;f<frames;f++){ctx.S.time+=1/60;ctx.__c.fxUpdate(1/60);}
  return ctx.__said.slice();
 };

 /* ===== 1. THE DATA — a label set that cannot name a band fails HERE, not in play ===== */
 ok(Array.isArray(T.labels)&&T.labels.length===4,'text.labels names all four bands');
 ok(Array.isArray(CH.bandCol)&&CH.bandCol.length===4,'bandCol carries all four bands');
 for(let b=0;b<4;b++){
  ok(typeof T.labels[b]==='string'&&T.labels[b].length>0,'band '+b+' has a label');
  ok(/^#[0-9a-f]{6}$/i.test(CH.bandCol[b]),'band '+b+' has a hex colour');
 }
 ok(new Set(T.labels).size===4,'no two bands say the same thing');
 ok(new Set(CH.bandCol).size===4,'…and no two look the same either');
 ok(T.dur>0,'the words stay up for a positive time');
 ok(T.dur>=CH.holdT,'the words outlast the marker stamp — reading takes longer than seeing');
 // fx.js aliases the config array rather than keeping its own copy, or the marker and the
 // words drift apart the first time one of them is retuned.
 ok(ctx.__c.CHG_COL===CH.bandCol,'fx.js reads the ONE colour list, it does not copy it');

 /* ===== 2. ONE STAMP, ONE LINE ===== */
 eq(show(1,true,8).length,1,'a verdict is spoken ONCE, not once per rendered frame');
 eq(show(1,true,200).length,1,'…still once after the hold has long expired');
 eq(show(1,true,1).length,1,'…and it lands on the very first frame after the stamp');

 /* ===== 3. IT SAYS THE RIGHT THING, IN THE RIGHT COLOUR ===== */
 for(let b=0;b<4;b++){
  const s=show(b,true,8);
  eq(s.length,1,'band '+b+' speaks');
  if(s[0]){
   eq(s[0].text,T.labels[b],'band '+b+' says its own label');
   eq(s[0].col,CH.bandCol[b],'band '+b+' is tinted to match its marker');
  }
 }

 /* ===== 4. THE GATE — a coaching tool, not match furniture ===== */
 eq(show(1,false,8).length,0,'SILENT in a match');
 eq(show(1,true,8).length,1,'…and speaking in training');
 {const w=T.inMatch;T.inMatch=true;
  eq(show(1,false,8).length,1,'text.inMatch turns it on everywhere');T.inMatch=w;}
 {const w=T.on;T.on=false;
  eq(show(1,true,8).length,0,'text.on:false is silent even in training');T.on=w;}
 // A trial runs as mode training (js/trials.js sets S.trn), so one test covers both.
 {ctx.S.trial={};eq(show(1,true,8).length,1,'a trial speaks — it runs as training');ctx.S.trial=null;}

 /* ===== 5. NOTHING TO SAY ===== */
 {ctx.__said.length=0;ctx.S.trn={};ctx.S.time=100;ctx.indicators[0].userData={};
  ctx.theRod={x:0,offset:0,chg:-1,chgBlock:0,chgEndT:null,chgEndBand:-1,chgEndK:0};
  for(let f=0;f<8;f++){ctx.S.time+=1/60;ctx.__c.fxUpdate(1/60);}
  eq(ctx.__said.length,0,'a rod with no stamp says nothing at all');}
 {ctx.__said.length=0;ctx.S.trn={};ctx.theRod=null;
  for(let f=0;f<8;f++){ctx.S.time+=1/60;ctx.__c.fxUpdate(1/60);}
  eq(ctx.__said.length,0,'an unheld rod says nothing and does not throw');}

 return {pass,fail,fails:fails.slice()};
}

/* ---- mutations: one decision each, and the suite must NOTICE ---- */
const SRC=read('js/fx.js');
function mutate(find,repl,name){
 if(SRC.indexOf(find)<0)return{name,err:'anchor not found — the mutation has drifted off the source'};
 const m=SRC.split(find).join(repl);
 if(m===SRC)return{name,err:'mutant is identical to the source'};
 return{name,src:m};
}
const MUTS=[
 mutate(' if(!T.on||(!S.trn&&!T.inMatch))return;',' if(!T.on)return;',
        'the verdict words follow the player into a real match'),
 mutate(' if(!T.on||(!S.trn&&!T.inMatch))return;','',
        'the words cannot be turned off at all'),
 mutate('   if(m.userData.vT!==r.chgEndT){m.userData.vT=r.chgEndT;chgSay(r);}',
        '   chgSay(r);','the words re-fire every frame of the hold instead of once'),
 mutate(' if(lab)notice(lab,T.dur,CHG_COL[r.chgEndBand]);',
        ' if(lab)notice(lab,T.dur,CHG_COL[1]);',
        'every verdict is tinted as a clean strike'),
 mutate(' const lab=T.labels[r.chgEndBand];',' const lab=T.labels[1];',
        'every verdict SAYS clean strike'),
 mutate('const CHG_COL=CONFIG.shots.charge.bandCol;',
        "const CHG_COL=['#8fa6c8','#ffd24d','#ff3b3b','#7d8796'];",
        'fx.js keeps its own copy of the colours, free to drift from config')
];

/* ---- go ---- */
const base=run(SRC);
console.log('\n=== charge-verdict harness ===');
console.log('assertions: '+base.pass+' passed, '+base.fail+' failed');
if(base.fail)for(const f of base.fails)console.log('  FAIL  '+f);
console.log('\n--- mutations (each must BREAK the suite) ---');
let mOK=0;
for(const m of MUTS){
 if(m.err){console.log('  BROKEN  '+m.name+' — '+m.err);continue;}
 let r;try{r=run(m.src);}catch(e){r={fail:99,pass:0};}
 if(r.fail>0){mOK++;console.log('  caught  ('+r.fail+' assertions)  '+m.name);}
 else console.log('  MISSED  '+m.name+' — the suite cannot tell');
}
console.log('\nmutations caught: '+mOK+'/'+MUTS.length);
process.exit(base.fail===0&&mOK===MUTS.length?0:1);
