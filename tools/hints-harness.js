// hints harness. node tools/hints-harness.js
// the bottom hint of a match, the Training sandbox and a Skill Trial follows a rebind (or a pad mode change) made from the pause menu
// slices matchHint / hintRefresh (flow.js), trainingHint (training.js), trialHint (trials.js), closeOptions (options.js) and hudHint (hud.js); runs binds.js whole on live CONFIG
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var keys={};function seatForDev(){return null;}function shotsOn(){return true;}",
"var S={seats:[],trn:null,trial:null,tut:null};",
"var HUD={t:0,hint:null,hintP:null,hintUse:null,hintT:0};var HANDED=0;function hudTok(s){HANDED++;return [s];}",
"var EL={};var document={getElementById:id=>EL[id]||(EL[id]={classList:{add(){},remove(){}}})};",
"var optFrom='pause',optRAF=0;function kbCapEnd(){}function cancelAnimationFrame(){}var SCREENS={options:{back:'menu'}};function showScreen(){}var Au={ui(){}};"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(F){
 const real=[rd('js/binds.js'),
  slice(F.hud,'function hudHint(src,pad){','\n'),
  slice(F.flow,'function matchHint(){','function startMatchNow('),
  slice(F.trn,'function trainingHint(){','function trainingEnter('),
  slice(F.trl,'function trialHint(){','function trialArm('),
  slice(F.opt,'function closeOptions(){','function bindOptions(){')].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Number,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={S:S,cfg:cfg,HUD:HUD,C:CONFIG,matchHint:matchHint,hintRefresh:hintRefresh,trainingHint:trainingHint,trialHint:trialHint,closeOptions:closeOptions,hudHint:hudHint,'+
  'bindSet:bindSet,bindReset:bindReset,handed:function(){return HANDED;},from:function(v){optFrom=v;}};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.S)throw new Error('export line did not run');
 return ctx.X;
}
const seat=(devs,n)=>({devs:devs,rods:new Array(n||1).fill(0).map((_,i)=>({i}))});
function fresh(X,seats){
 X.S.seats=seats||[seat(['kbd','mouse','pad*'],4)];X.S.trn=null;X.S.trial=null;X.S.tut=null;
 X.cfg.keyBinds={};X.cfg.padControlMode='classic';X.from('pause');
 X.hudHint(...X.matchHint());X.HUD.t=5;
}
const kb=X=>X.HUD.hintSrc||'',pd=X=>X.HUD.hintSrcP||'';

function suite(X,quiet){
 let n;
 /* 1. what each mode's hint says */
 fresh(X);
 ok(/\[SPACE\] \[LMB\] kick/.test(kb(X))&&/\{A\} kick/.test(pd(X)),'a match: kick on both devices, off the bindings');
 ok(/switch rod/.test(kb(X))&&/\{LB\} \{RB\} switch rod/.test(pd(X)),'a seat holding more than one rod is offered switching');
 fresh(X,[seat(['kbd','mouse'],1)]);ok(!/switch rod/.test(kb(X))&&X.HUD.hintSrcP===null,'one rod, no pad: no switching, no pad lines');
 fresh(X,[seat(['pad*'],2)]);ok(X.HUD.hintSrc===null&&/\{LS\} slide/.test(pd(X)),'a pad-only seat: pad lines only');
 fresh(X,[]);ok(/camera/.test(kb(X))&&pd(X)==='{Y} camera','spectating: the camera alone');
 fresh(X);X.cfg.padControlMode='total';ok(/\{LT\} fine/.test(X.matchHint()[1])&&!/\{LT\} fine/.test(pd(X)),'Total Control changes the pad line it would give');
 fresh(X);ok(/\[T\] panel/.test(X.trainingHint()[0])&&/\[SPACE\] \[LMB\] kick/.test(X.trainingHint()[0]),'the sandbox: its own keys and the rod clauses');
 ok(/\[R\] retry/.test(X.trialHint()[0])&&/\{VIEW\} retry/.test(X.trialHint()[1]),'a trial: retry first');

 /* 2. a rebind reaches every mode's hint once Options closes over the pause menu */
 fresh(X);X.bindSet('kick',['KeyX','Mouse1']);X.closeOptions();
 ok(/\[X\] \[MMB\] kick/.test(kb(X))&&!/SPACE/.test(kb(X)),'Kick Off: the new kick keys after Options closes');
 ok(X.HUD.hintT===5,'...handed over afresh (the hint comes back at full strength)');
 fresh(X);X.cfg.padControlMode='total';X.closeOptions();ok(/\{LT\} fine/.test(pd(X)),'Kick Off: a pad mode change reaches the pad line');
 fresh(X);X.S.trn={};X.hudHint(...X.trainingHint());X.bindSet('raise',['KeyJ']);X.bindSet('finesse',['KeyZ']);X.bindSet('camera',['KeyN']);X.closeOptions();
 ok(/\[T\] panel/.test(kb(X))&&/\[J\] raise/.test(kb(X)),'the sandbox: its own hint, with the new raise key');
 ok(/\[Z\] \+ \[J\] pin/.test(kb(X))&&/\[N\] camera/.test(kb(X)),'...and the new pin and camera keys');
 fresh(X);X.S.trn={};X.S.trial={};X.hudHint(...X.trialHint());X.bindSet('retry',['KeyY']);X.closeOptions();
 ok(/\[Y\] retry/.test(kb(X))&&!/\[T\] panel/.test(kb(X)),'a trial (in the sandbox): the trial\'s hint, with the new retry key');
 fresh(X);X.S.tut={};X.HUD.hintSrc='tutorial line';X.bindSet('kick',['KeyX']);X.closeOptions();
 ok(X.HUD.hintSrc==='tutorial line','the tutorial keeps its own hint (it rebuilds it every frame)');

 /* 3. nothing changed: nothing handed over */
 fresh(X);n=X.handed();X.HUD.t=9;X.closeOptions();
 ok(X.handed()===n&&X.HUD.hintT===5,'closing Options with nothing changed leaves the hint (and its fade) alone');
 fresh(X);X.S.trn={};X.hudHint(...X.trainingHint());n=X.handed();X.hintRefresh();ok(X.handed()===n,'...in the sandbox too');
 /* 4. only from the pause menu */
 fresh(X);X.from('menu');X.bindSet('kick',['KeyX']);X.closeOptions();
 ok(/\[SPACE\]/.test(kb(X)),'Options from the main menu writes no match hint (the next match builds its own)');

 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const F={flow:rd('js/flow.js'),trn:rd('js/training.js'),trl:rd('js/trials.js'),opt:rd('js/options.js'),hud:rd('js/hud.js')};
const base=suite(boot(F),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['opt'," if(optFrom==='pause')hintRefresh();",' ','closing Options never refreshes the hint'],
 ['opt'," if(optFrom==='pause')hintRefresh();",' hintRefresh();','closing Options from the main menu writes a match hint'],
 ['flow',' if(S.tut)return;',' ','the tutorial\'s hint is overwritten'],
 ['flow',"(S.trial&&typeof trialHint==='function')?trialHint():(S.trn&&typeof trainingHint==='function')?trainingHint():matchHint()","(S.trn&&typeof trainingHint==='function')?trainingHint():matchHint()",'a trial gets the sandbox hint'],
 ['flow',"(S.trial&&typeof trialHint==='function')?trialHint():(S.trn&&typeof trainingHint==='function')?trainingHint():matchHint()","matchHint()",'the sandbox gets the match hint'],
 ['flow',' if(h[0]!==HUD.hintSrc||h[1]!==HUD.hintSrcP)hudHint(h[0],h[1]);',' hudHint(h[0],h[1]);','an unchanged hint restarts its fade'],
 ['flow',' if(h[0]!==HUD.hintSrc||h[1]!==HUD.hintSrcP)hudHint(h[0],h[1]);',' if(h[0]!==HUD.hintSrc)hudHint(h[0],h[1]);','a pad mode change never reaches the pad line'],
 ['flow',"cfg.padControlMode==='total'?","false?",'Total Control is not in the pad line'],
 ['flow','const H=bindHintRods(sw,','const H=bindHintRods(false,','switching is never offered'],
 ['hud','HUD.hintSrc=src||null;HUD.hintSrcP=pad||null;','','the hint keeps no source to compare'],
 ['trn',"bindJoin([H.mod,bindHint('camera','camera'),'[C] debug'])","bindJoin(['[C] debug'])",'the sandbox hint drops the bindings'],
 ['trl',"bindJoin([bindHint('retry','retry'),'[ESC] pause'])","'[R] retry · [ESC] pause'",'the trial hint has the retry key written in']
];
let caught=0;
for(const [file,find,repl,name] of muts){
 const src=F[file];
 if(src.indexOf(find)<0){console.log('  BROKEN  '+name+' — anchor not found');continue;}
 const m=src.replace(find,repl);
 if(m===src){console.log('  BROKEN  '+name+' — no-op');continue;}
 pass=0;fail=0;fails.length=0;
 let f;try{f=suite(boot(Object.assign({},F,{[file]:m})),true);}catch(e){f=1;}
 if(f>0){caught++;console.log('  caught  ('+f+' assertions)  '+name);}
 else console.log('  SURVIVED  '+name);
}
console.log('mutations caught: '+caught+'/'+muts.length);
process.exitCode=(base>0||caught<muts.length)?1:0;
