// behavioural harness for the SHADER WARM QUEUE (js/models.js warmPush / warmGo / warmWhen / warmFlush) and its callers (props, powerups, fracture, boot). Run: node tools/warm-harness.js
// no three.js, browser or GPU: the real sources are string-sliced and rebuilt with new Function against stubs; time is a virtual clock where a compile costs what the material says
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const MODELS=rd('js/models.js'),FRAC=rd('js/fracture.js'),PROPS=rd('js/props.js'),MAIN=rd('js/main.js'),CONFIG_SRC=rd('js/config.js'),INTRO=rd('js/intro.js'),FLOW=rd('js/flow.js');

/* ---- source slicing ----------------------------------------------------- */
function fnAt(src,name){
 const start=src.indexOf('function '+name+'(');
 if(start<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
function between(src,a,b){
 const i=src.indexOf(a),j=src.indexOf(b,i+1);
 if(i<0||j<0)throw new Error('ANCHOR LOST: '+a+' .. '+b);
 return src.slice(i,j);
}

/* ---- virtual clock + scene graph stubs ---------------------------------- */
function world(over){
 const T={now:0,timers:[],seq:0,warns:[],sets:0};
 const setT=(fn,ms)=>{const t={at:T.now+(ms||0),fn,id:++T.seq};T.sets++;T.timers.push(t);return t.id;};
 const clrT=id=>{T.timers=T.timers.filter(t=>t.id!==id);};
 function advance(ms){
  const end=T.now+ms;
  for(;;){
   const due=T.timers.filter(t=>t.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
   if(!due)break;
   T.timers=T.timers.filter(t=>t!==due);T.now=Math.max(T.now,due.at);due.fn();
  }
  T.now=Math.max(T.now,end);
 }
 const node=o=>{o.children=o.children||[];if(o.visible===undefined)o.visible=true;
  o.traverse=function(cb){cb(this);this.children.forEach(c=>c.traverse(cb));};
  o.traverseVisible=function(cb){if(!this.visible)return;cb(this);this.children.forEach(c=>c.traverseVisible(cb));};return o;};
 function Scene(){node(this);this.isScene=true;this.fog=null;this.environment=null;}
 const mat=(name,cost,x)=>Object.assign({name,cost:cost===undefined?100:cost,transparent:false,opacity:0.5,clone(){return mat(name,this.cost);}},x||{});
 const mesh=(name,m,x)=>node(Object.assign({isMesh:true,name,material:m||mat(name)},x||{}));
 const light=(name,x)=>node(Object.assign({isLight:true,name},x||{}));
 const group=(kids,x)=>node(Object.assign({children:kids},x||{}));
 const scene=new Scene();scene.fog={f:1};scene.environment={e:1};
 const trav0=scene.traverse;T.trav=0;
 scene.traverse=function(cb){if(++T.trav>3000)throw new Error('runaway: the queue never converges');trav0.call(this,cb);};   // a mutant that re-adds forever ends here
 const log={compiled:[],calls:[]};
 let stand=null;const stands=new Set(),made=new Set();
 const renderer={compile(s,cam){
  stands.add(s);stand=s;
  const job=s.children.filter(c=>!c.isLight);
  log.calls.push({t:T.now,kids:s.children.slice(),fog:s.fog,env:s.environment,isScene:s.isScene,cam});
  let cost=0;
  job.forEach(o=>o.traverse(c=>{if(c.material){const ms=Array.isArray(c.material)?c.material:[c.material];
   ms.forEach(m=>{if(m.boom)throw new Error('link failed');if(made.has(m))return;made.add(m);cost+=m.cost;log.compiled.push(m.name);});}}));
  T.now+=cost;
 }};
 const CONFIG={warm:Object.assign({on:true,slice:6,gap:8,slow:40,holdMax:30},over||{}),fx:{}};
 const console_={warn:(...a)=>T.warns.push(a.join(' ')),log(){}};
 return{T,advance,Scene,mat,mesh,light,group,scene,renderer,CONFIG,log,camera:{cam:1},console:console_,setT,clrT,
  get stand(){return stand;},get stands(){return stands;},node};
}

/* ---- the queue, rebuilt from source ------------------------------------- */
function build(src,over){
 const w=world(over);
 const body=between(src,'// --- shader warm queue ---','// --- power-up pickup models ---')+'\n'+fnAt(src,'warmPowerupShaders')+'\n';
 const puTemplates={};
 const f=new Function('CONFIG','renderer','scene','camera','THREE','performance','setTimeout','clearTimeout','console','puTemplates',
  body+'\nreturn{warmPush,warmAdd,warmGo,warmWhen,warmFlush,warmRun,warmTick,warmPowerupShaders,warmQ,warmWait};');
 const api=f(w.CONFIG,w.renderer,w.scene,w.camera,{Scene:w.Scene},{now:()=>w.T.now},w.setT,w.clrT,w.console,puTemplates);
 return Object.assign(w,{api,puTemplates});
}

/* ---- harness plumbing --------------------------------------------------- */
let pass=0,fail=0;const fails=[];
function ok(c,msg,extra){if(c)pass++;else{fail++;fails.push(msg+(extra===undefined?'':'  ['+extra+']'));}}
function mutate(src,needle,repl){
 if(src.indexOf(needle)<0)throw new Error('MUTATION DID NOT APPLY (anchor drifted): '+needle);
 return src.replace(needle,repl);
}
let mPass=0,mFail=0;const mFails=[];
function mut(name,fn){try{fn();mFail++;mFails.push(name);}catch(e){
 if(/MUTATION DID NOT APPLY/.test(e.message)){mFail++;mFails.push(name+' — '+e.message);}
 else mPass++;}}
const caught=(c)=>{if(!c)throw new Error('caught');};

/* ---- scenarios (shared by the assertions and the mutations) -------------- */
// a lit scene with three costly meshes; the lights include one switched off and one under a hidden group
function lit(x,over){
 const w=build(x,over);
 const L=w.light('key'),Loff=w.light('off',{visible:false}),Lh=w.light('underHidden'),H=w.group([Lh],{visible:false});
 const a=w.mesh('a'),b=w.mesh('b'),c=w.mesh('c');
 w.scene.children.push(L,Loff,H,a,b,c);w.L=L;w.Loff=Loff;w.Lh=Lh;w.meshes=[a,b,c];
 return w;
}
const scenHeld=src=>{const w=lit(src);w.api.warmPush(w.scene);w.advance(5000);const first=w.log.compiled.length;
 w.api.warmPush(w.mesh('d'));w.advance(5000);          // a push after the park must not wake it
 return{first,compiled:w.log.compiled.length,timers:w.T.timers.length,left:w.api.warmQ.length,w};};
const scenProbe=src=>{const w=build(src);for(let i=0;i<6;i++)w.scene.children.push(w.mesh('p'+i,w.mat('p'+i,2)));   // 2 ms a program: a cached link
 let n=0;w.api.warmPush(w.scene);w.api.warmWhen(()=>n++,30);w.advance(5000);                                        // never released
 return{compiled:w.log.compiled.length,waiter:n,left:w.api.warmQ.length,timers:w.T.timers.filter(t=>t.at-w.T.now<1000).length};};   // the waiter's own cap is a timer too
const scenResume=src=>{const w=lit(src);w.api.warmPush(w.scene);w.advance(5000);const parked=w.log.compiled.length;
 let n=0;w.api.warmWhen(()=>n++,30);w.api.warmGo();w.advance(5000);
 return{parked,total:w.log.compiled.length,waiter:n};};
const scenFlushParked=src=>{const w=lit(src);w.api.warmPush(w.scene);w.advance(100);const parked=w.log.compiled.length;
 w.api.warmFlush();return{parked,compiled:w.log.compiled.length,left:w.api.warmQ.length};};
const scenSlice=src=>{const w=lit(src);w.api.warmPush(w.scene);w.api.warmGo();w.advance(0);
 const first=w.log.compiled.length;w.advance(5000);return{first,total:w.log.compiled.length,calls:w.log.calls.map(c=>c.t),w};};
const scenCheap=src=>{const w=build(src);
 for(let i=0;i<20;i++)w.scene.children.push(w.mesh('m'+i,w.mat('m'+i,0.5)));
 w.api.warmPush(w.scene);w.api.warmGo();w.advance(0);const first=w.log.compiled.length;w.advance(2000);
 return{first,total:w.log.compiled.length,w};};
const scenStand=src=>{const w=lit(src);w.api.warmPush(w.scene);w.api.warmGo();w.advance(5000);return w;};
const scenDedupe=src=>{const w=build(src);const m=w.mat('shared'),k=w.mat('k1'),k2=w.mat('k2');
 w.scene.children.push(w.mesh('p',m),w.mesh('q',m),w.mesh('arr',[k,k2]));
 w.api.warmPush(w.scene);w.api.warmPush(w.scene);w.api.warmGo();w.advance(5000);return w;};
const scenWaiter=src=>{const w=build(src);const a=w.mesh('n1'),b=w.mesh('n2');
 w.api.warmPush(a);w.api.warmPush(b);
 let fired=0,left=-1;
 w.api.warmWhen(()=>{fired++;left=w.api.warmQ.length;},30);
 const before=fired;w.api.warmGo();w.advance(5000);return{before,fired,left,w};};
const scenCap=src=>{const w=build(src,{holdMax:30});w.api.warmPush(w.mesh('a'));w.api.warmPush(w.mesh('b'));    // never released: the first is the probe, the second is parked behind it
 let n=0;w.api.warmWhen(()=>n++,3);w.advance(2900);const early=n;w.advance(200);const at3=n;
 w.api.warmGo();w.advance(5000);return{early,at3,final:n,w};};
const scenEmpty=src=>{const w=build(src);let n=0;w.api.warmWhen(()=>n++,3);return n;};
const scenRescan=src=>{const w=build(src);w.scene.children.push(w.mesh('a'));
 w.api.warmPush(w.scene);                                      // the world, as it is now
 const ice=w.mesh('ice');w.scene.children.push(ice);           // joins after the push (built on the first frames), pushed by no one
 let sawIce=null;w.api.warmWhen(()=>{sawIce=w.log.compiled.includes('ice');},30);
 w.api.warmGo();w.advance(8000);
 return{sawIce,n:w.log.compiled.filter(x=>x==='ice').length,left:w.api.warmQ.length,timers:w.T.timers.filter(t=>t.at-w.T.now<1000).length};};
const scenFlush=src=>{const w=lit(src);w.api.warmPush(w.scene);w.api.warmPush(w.mesh('l1'));w.api.warmPush(w.mesh('l2'));
 w.scene.children.push(w.mesh('lazy'));                  // built after the push, as the frost blocks are
 let fired=0;w.api.warmWhen(()=>fired++,30);
 w.api.warmFlush();return{compiled:w.log.compiled.length,fired,left:w.api.warmQ.length,w};};
const scenOff=src=>{const w=lit(src,{on:false});w.api.warmPush(w.scene);
 let n=0;w.api.warmWhen(()=>n++,3);
 return{compiled:w.log.compiled.length,timers:w.T.timers.length,n,w};};
const scenBoom=src=>{const w=build(src);const bad=w.mesh('bad',w.mat('bad',100,{boom:true})),good=w.mesh('good');
 w.scene.children.push(bad,good);w.api.warmPush(w.scene);w.api.warmGo();w.advance(5000);
 return{good:w.log.compiled.includes('good'),warned:w.T.warns.length,timers:w.T.timers.length};};
const scenPower=src=>{const w=build(src);
 w.puTemplates.boost=w.group([w.mesh('pb')]);w.puTemplates.frost=w.group([w.mesh('pf')]);
 w.api.warmPowerupShaders();return{queued:w.api.warmQ.length};};

/* ---- fracture's template warm, rebuilt from source ------------------------ */
function buildFrac(src){
 const pushed=[];
 const mk=(n,m)=>({isMesh:true,name:n,material:m,children:[],castShadow:false,
  traverse(cb){cb(this);this.children.forEach(c=>c.traverse(cb));},
  clone(){return mk(this.name,this.material);}});
 const root=(kids)=>{const r={isGroup:true,children:kids,traverse(cb){cb(this);this.children.forEach(c=>c.traverse(cb));},
  clone(){return root(this.children.map(k=>k.clone()));}};return r;};
 const mat=n=>({name:n,transparent:false,opacity:0.5,clone(){return mat(n);}});
 const body=fnAt(src,'cloneFractureInstance')+'\n'+fnAt(src,'warmFractureTemplate')+'\nreturn warmFractureTemplate;';
 const f=new Function('renderer','scene','camera','warmPush',body);
 const warm=f({r:1},{s:1},{c:1},(r)=>pushed.push(r));
 return{warm,pushed,mk,root,mat};
}
function scenFrac(src){
 const F=buildFrac(src),a=F.mat('a'),b=F.mat('b'),c=F.mat('c');
 const tpl={scene:F.root([F.mk('m0',a),F.mk('m1',a),F.mk('m2',b),F.mk('m3',a),F.mk('m4',b),F.mk('m5',c)])};
 F.warm(tpl);
 return{F,tpl,a,b,c};
}

/* ---- the ball types and the match prep, rebuilt from source ---------------- */
function buildBalls(src,o){
 o=o||{};
 const ctx={CONFIG:{debug:{useBallModel:o.useModel!==false},fx:{warmMatch:o.warmMatch},ballReflect:{intensity:0.5}},renderer:{},scene:{added:[],add(x){this.added.push(x);}},camera:{},
  BALL_TYPES:{classic:{col:1,em:0},fire:{col:2,em:1},gold:{col:3,em:0,metal:1}},BALL_R:1.9,
  ballModel:o.model===false?null:{},ballCubeRT:{texture:'CUBE'},reflectOn:true,
  envLog:[],calls:[],made:0,
  THREE:{Group:function(){this.children=[];this.position={set(){}};this.add=function(x){this.children.push(x);};},
         Mesh:function(g,m){this.isMesh=true;this.geometry=g;this.material=m;},
         SphereGeometry:function(){},MeshStandardMaterial:function(){}},
  makeBallModel(key){this.made++;return{isModel:true,key};},
  ballReflectOn(){return this.reflectOn;},
  setBallEnv(b,env){this.envLog.push([b.m,env]);},
  iceBuild(){this.calls.push('ice');},boostBuild(){this.calls.push('boost');}};
 if(o.noRenderer)ctx.renderer=null;
 const body=between(src,'let warmMeshHolder=null;','function warmMatchAssets(')+'\nreturn{warmBallMaterials,warmMatchPrep,holder:()=>warmMeshHolder,warmed:()=>warmedBallTypes};';
 const f=new Function('ctx','with(ctx){'+body.replace(/\bmakeBallModel\(/g,'ctx.makeBallModel(').replace(/\bballReflectOn\(/g,'ctx.ballReflectOn(')
   .replace(/\bsetBallEnv\(/g,'ctx.setBallEnv(').replace(/\biceBuild\(/g,'ctx.iceBuild(').replace(/\bboostBuild\(/g,'ctx.boostBuild(')+'}');
 return Object.assign(ctx,{api:f(ctx)});
}
function scenBalls(src){
 const w=buildBalls(src);
 w.api.warmBallMaterials();const n1=w.api.holder().children.length,made1=w.made;
 const env1=w.envLog.slice(w.envLog.length-n1).map(e=>e[1]);
 w.api.warmBallMaterials();const n2=w.api.holder().children.length,made2=w.made;
 w.reflectOn=false;w.envLog.length=0;w.api.warmBallMaterials();
 const env2=w.envLog.map(e=>e[1]);
 return{n1,made1,env1,n2,made2,env2,nTypes:3};
}
function scenBallLate(src){
 const w=buildBalls(src,{model:false});
 w.api.warmBallMaterials();const early=w.api.holder().children.length,madeEarly=w.made;
 w.ballModel={};w.api.warmBallMaterials();
 return{early,made:madeEarly,late:w.api.holder().children.length};
}
function scenPrep(src,o){
 const w=buildBalls(src,o);w.api.warmMatchPrep();
 return{calls:w.calls.join(),parked:w.api.holder()?w.api.holder().children.length:0};
}

/* ========================================================================= */
/* 1. PROBE, PARK, RELEASE, THEN SLICED                                       */
/* ========================================================================= */
{
 const h=scenHeld(MODELS);
 ok(h.first===1,'probe: before the release one job runs, and it is a cold one',h.first);
 ok(h.compiled===1&&h.timers===0&&h.left===3,'park: a cold job parks the queue, nothing else compiles and no timer runs; a later push does not wake it',h.compiled+' compiled, '+h.timers+' timers, '+h.left+' left');
 const pr=scenProbe(MODELS);
 ok(pr.compiled===6&&pr.left===0&&pr.timers===0,'probe: a cached (fast) queue finishes before any release, with no timer left',pr.compiled+' '+pr.left+' '+pr.timers);
 ok(pr.waiter===1,'probe: and lets the reveal go, with nothing waited for');
 const rs=scenResume(MODELS);
 ok(rs.parked===1&&rs.total===3&&rs.waiter===1,'resume: the release continues a parked queue to the end and calls the waiter',rs.parked+' '+rs.total+' '+rs.waiter);
 const fp=scenFlushParked(MODELS);
 ok(fp.parked===1&&fp.compiled===3&&fp.left===0,'flush: runs a parked queue to the end (the match start does not wait for the cinematic)',fp.parked+' '+fp.compiled);

 const s=scenSlice(MODELS);
 ok(s.first===1,'slice: a cold program fills a slice, the next waits its turn',s.first);
 ok(s.total===3,'slice: they all get compiled',s.total);
 const gaps=s.calls.slice(1).map((t,i)=>t-s.calls[i]);
 ok(gaps.every(g=>g>=100+8-0.001),'slice: a gap is left between slices so a frame can land',gaps.join());
 const c=scenCheap(MODELS);
 ok(c.first===12&&c.total===20,'slice: cheap jobs share a slice up to the budget (12 of 20 at 0.5 ms in 6 ms)',c.first+'/'+c.total);
 const cc=build(MODELS,{slice:1000});
 for(let i=0;i<20;i++)cc.scene.children.push(cc.mesh('m'+i,cc.mat('m'+i,0.5)));
 cc.api.warmPush(cc.scene);cc.api.warmGo();cc.advance(0);
 ok(cc.log.compiled.length===20,'slice: the budget is CONFIG.warm.slice, not a constant',cc.log.compiled.length);
}

/* ========================================================================= */
/* 2. WHAT A JOB COMPILES ON                                                  */
/* ========================================================================= */
{
 const w=scenStand(MODELS),k=w.log.calls[0];
 ok(k.isScene===true,'stand-in: it is a Scene (three swaps anything else for an empty default, losing fog and env)');
 ok(k.kids.includes(w.L),'stand-in: carries the live visible light');
 ok(!k.kids.includes(w.Loff)&&!k.kids.includes(w.Lh),'stand-in: a light that is off, or under a hidden group, is not counted (render would not count it either, and the count is in the program key)');
 ok(k.kids.filter(c=>!c.isLight).length===1,'stand-in: one object a job',k.kids.filter(c=>!c.isLight).length);
 ok(k.fog===w.scene.fog&&k.env===w.scene.environment,'stand-in: fog and environment are the live scene\'s (they are part of the program key)');
 ok(w.stands.size===1,'stand-in: one scene is reused, not one allocated a job',w.stands.size);
 ok(w.stand.children.length===0,'stand-in: nothing is left on it after the run (no leak of the live objects)',w.stand.children.length);
 ok(w.L.parent===undefined,'stand-in: the live lights are never reparented');
 ok(k.cam===w.camera,'stand-in: compiled against the live camera');
}

/* ========================================================================= */
/* 3. NO MATERIAL TWICE                                                       */
/* ========================================================================= */
{
 const w=scenDedupe(MODELS);
 ok(w.log.calls.length===3,'dedupe: a material shared by two meshes is one job, an array material one job a material, and pushing the scene again adds none',w.log.calls.length);
 ok(w.log.compiled.includes('shared')&&w.log.compiled.includes('k1')&&w.log.compiled.includes('k2'),'dedupe: every distinct material is compiled');
}

/* ========================================================================= */
/* 4. WHEN THE REVEAL IS RELEASED                                             */
/* ========================================================================= */
{
 const a=scenWaiter(MODELS);
 ok(a.before===0,'waiter: not called while jobs remain');
 ok(a.fired===1&&a.left===0,'waiter: called once, when the last job is done',a.fired+' fired, '+a.left+' left');
 ok(scenEmpty(MODELS)===1,'waiter: with nothing queued it is called at once');
 const c=scenCap(MODELS);
 ok(c.early===0&&c.at3===1,'cap: a queue that is never released lets go at holdMax',c.early+' '+c.at3);
 ok(c.final===1,'cap: the cap and the drain do not both call it',c.final);
 const r=scenRescan(MODELS);
 ok(r.n===1&&r.sawIce===true,'rescan: what joined the scene after the push (the frost blocks, the boost glow) is compiled before the waiters are called',r.n+' '+r.sawIce);
 ok(r.left===0&&r.timers===0,'rescan: and it ends, with nothing left running',r.left+' left, '+r.timers+' timers');
}

/* ========================================================================= */
/* 5. FLUSH, SWITCH, FAILURES                                                 */
/* ========================================================================= */
{
 const f=scenFlush(MODELS);
 ok(f.compiled===6&&f.left===0,'flush: everything queued, and what joined the scene since, is compiled now, held or not',f.compiled);
 ok(f.fired===1,'flush: the waiters are released',f.fired);
 ok(f.w.T.timers.length===1&&f.w.T.timers[0].at-f.w.T.now>1000,'flush: no slice timer survives it (only the waiter\'s cap)');
 const o=scenOff(MODELS);
 ok(o.compiled===3&&o.timers===0,'switch: on:false compiles where asked, at once, with no timers',o.compiled+' '+o.timers);
 ok(o.n===1,'switch: on:false does not hold the reveal');
 const b=scenBoom(MODELS);
 ok(b.good&&b.warned===1,'failure: a compile that throws is reported and the rest carry on',b.good+' '+b.warned);
 const p=scenPower(MODELS);
 ok(p.queued===2,'powerups: each template is queued',p.queued);
}

/* ========================================================================= */
/* 6. FRACTURE TEMPLATES: ONE MESH A SOURCE MATERIAL                           */
/* ========================================================================= */
{
 const r=scenFrac(FRAC);
 ok(r.F.pushed.length===3,'fracture: a mesh per distinct source material, not one per piece',r.F.pushed.length);
 ok(r.F.pushed.every(m=>m.material.transparent===true&&m.material.opacity===1),'fracture: warmed in the transparent fade state (the fade is a different program)');
 ok(!r.a.transparent&&!r.b.transparent,'fracture: the template\'s own materials are untouched');
 const names=r.F.pushed.map(m=>m.name).join();
 ok(names==='m0,m2,m5','fracture: the first mesh of each material stands for it',names);
}

/* ========================================================================= */
/* 7. THE BALL TYPES AND THE MATCH PREP                                       */
/* ========================================================================= */
{
 const b=scenBalls(FRAC);
 ok(b.n1===b.nTypes&&b.made1===b.nTypes,'balls: one parked instance of each type',b.n1+' '+b.made1);
 ok(b.n2===b.nTypes&&b.made2===b.made1,'balls: parked once, a second call makes none',b.n2+' '+b.made2);
 ok(b.env1.length===b.nTypes&&b.env1.every(e=>e==='CUBE'),'balls: parked with the reflection map the real balls get at birth',b.env1.join());
 ok(b.env2.length===b.nTypes&&b.env2.every(e=>e===null),'balls: and they follow the option when it is switched off, so a match start compiles what will be used',b.env2.join());
 const l=scenBallLate(FRAC);
 ok(l.early===0&&l.made===0,'balls: nothing is parked while the ball GLB is still loading (a sphere would stand in for the real one for good)',l.early+' '+l.made);
 ok(l.late===3,'balls: and they are parked on the next call',l.late);
 const p=scenPrep(FRAC);
 ok(p.calls==='ice,boost'&&p.parked===3,'prep: the ball types, the frost blocks and the boost glow are built',p.calls+' / '+p.parked);
 const off=scenPrep(FRAC,{warmMatch:false});
 ok(off.calls===''&&off.parked===0,'prep: CONFIG.fx.warmMatch:false builds nothing',off.calls+' / '+off.parked);
 const nr=scenPrep(FRAC,{noRenderer:true});
 ok(nr.calls===''&&nr.parked===0,'prep: nothing without a renderer');
}

/* ========================================================================= */
/* 8. WIRING                                                                  */
/* ========================================================================= */
{
 const bootFn=fnAt(MAIN,'boot');
 ok(/warmMatchPrep\(\);[^\n]*\n\s*warmPush\(scene\);warmWhen\(up,CONFIG\.warm\.holdMax\)/.test(bootFn),'wiring: boot builds what a match needs, queues the world, and waits on it before the first render and the reveal');
 ok(/function boot\(now\)/.test(bootFn)&&/else up\(\)/.test(bootFn),'wiring: a forced boot (a match start) goes straight up');
 ok(/requestAnimationFrame\(loop\)/.test(bootFn.slice(bootFn.indexOf('const up='),bootFn.indexOf('if(!now'))),'wiring: the render loop and the intro release are inside the gated step');
 const wm=fnAt(FRAC,'warmMatchAssets');
 ok(wm.indexOf('warmMatchPrep()')>0&&wm.indexOf('warmMatchPrep()')<wm.indexOf('warmFlush()'),'wiring: the match start builds what boot would have, then flushes, before its own compile');
 ok((wm.match(/warmFlush\(\)/g)||[]).length>=2,'wiring: and flushes again for the shatters it just queued');
 ok(/typeof warmPush==='function'\)warmPush\(scene\)/.test(fnAt(PROPS,'warmPropShaders')),'wiring: the prop warm queues instead of compiling');
 ok(/warmGo\(\)/.test(fnAt(MAIN,'ensureMatchAssets')),'wiring: a match request releases the queue');
 ok(/warmGo\(\)/.test(INTRO),'wiring: skipping the intro releases the queue');
 ok(FLOW.indexOf('boot(true)')>0,'wiring: startMatchNow forces the boot without the hold');
 ok(/holdMax:\s*30/.test(CONFIG_SRC.slice(CONFIG_SRC.indexOf('warm:{'))),'wiring: the config block exists');
 ok(!/lateAfter/.test(CONFIG_SRC),'wiring: no late phase left in the config');
 const hm=+(/holdMax:\s*(\d+)/.exec(CONFIG_SRC.slice(CONFIG_SRC.indexOf('intro:{'),CONFIG_SRC.indexOf('match:{')))||[0,0])[1];
 ok(hm>=30,'wiring: the intro waits at least as long as the queue is allowed to hold it',hm);
}

/* ========================================================================= */
/* 9. MUTATIONS — re-apply the bugs and prove the suite bites                 */
/* ========================================================================= */
mut('a cold job not parking the queue',()=>{
 const bad=mutate(MODELS,'  if(ms&&warmGate&&now-tj>=CONFIG.warm.slow){warmHeld=true;break;}\n','');
 const r=scenHeld(bad);caught(r.first===1);
});
mut('cheap jobs parking the queue',()=>{
 const bad=mutate(MODELS,'now-tj>=CONFIG.warm.slow','now-tj>=0');
 const r=scenProbe(bad);caught(r.compiled===6);
});
mut('parking after the release',()=>{
 const bad=mutate(MODELS,'if(ms&&warmGate&&now-tj>=CONFIG.warm.slow)','if(ms&&now-tj>=CONFIG.warm.slow)');
 const r=scenSlice(bad);caught(r.total===3);
});
mut('the release not resuming a parked queue',()=>{
 const bad=mutate(MODELS,' if(!warmGate)return;warmGate=false;warmHeld=false;',' if(!warmGate)return;warmGate=false;');
 const r=scenResume(bad);caught(r.total===3);
});
mut('a flush stopping at a cold job',()=>{
 const bad=mutate(MODELS,'if(ms&&warmGate&&now-tj>=CONFIG.warm.slow)','if(warmGate&&now-tj>=CONFIG.warm.slow)');
 const r=scenFlushParked(bad);caught(r.compiled===3);
});
mut('a parked queue woken by a push and a tick',()=>{
 let bad=mutate(MODELS,' warmTm=0;\n if(warmHeld)return;\n',' warmTm=0;\n');
 bad=mutate(bad,'else if(!warmHeld)warmKick(CONFIG.warm.gap);','else warmKick(CONFIG.warm.gap);');   // both guards gone: a push after the park runs a job
 const r=scenHeld(bad);caught(r.compiled===1&&r.timers===0);
});
mut('no time budget (one block again)',()=>{
 const bad=mutate(MODELS,'  if(ms&&now-t0>=ms)break;\n','');
 const r=scenSlice(bad);caught(r.first===1);
});
mut('no gap between slices',()=>{
 const bad=mutate(MODELS,'&&!warmTm&&!warmHeld)warmKick(CONFIG.warm.gap);\n}','&&!warmTm&&!warmHeld)warmKick(0);\n}');
 const r=scenSlice(bad);caught(r.calls.slice(1).every((t,i)=>t-r.calls[i]>=108-0.001));
});
mut('the stand-in carries no lights',()=>{
 const bad=mutate(MODELS,'s.children=L.concat(warmQ.shift()[1]);','s.children=[warmQ.shift()[1]];');
 const w=scenStand(bad);caught(w.log.calls[0].kids.includes(w.L));
});
mut('lights taken whether visible or not',()=>{
 const bad=mutate(MODELS,'scene.traverseVisible(c=>{if(c.isLight)L.push(c);});','scene.traverse(c=>{if(c.isLight)L.push(c);});');
 const w=scenStand(bad);caught(!w.log.calls[0].kids.includes(w.Loff)&&!w.log.calls[0].kids.includes(w.Lh));
});
mut('fog left off the stand-in',()=>{
 const bad=mutate(MODELS,'s.fog=scene.fog;s.environment=scene.environment;','s.environment=scene.environment;');
 const w=scenStand(bad);caught(w.log.calls[0].fog===w.scene.fog);
});
mut('environment left off the stand-in',()=>{
 const bad=mutate(MODELS,'s.fog=scene.fog;s.environment=scene.environment;','s.fog=scene.fog;');
 const w=scenStand(bad);caught(w.log.calls[0].env===w.scene.environment);
});
mut('the stand-in keeping the live objects',()=>{
 const bad=mutate(MODELS,' if(s)s.children=[];\n','\n');
 const w=scenStand(bad);caught(w.stand.children.length===0);
});
mut('a new stand-in scene every run',()=>{
 const bad=mutate(MODELS,'s=warmScn||(warmScn=new THREE.Scene());','s=new THREE.Scene();');
 const w=scenStand(bad);caught(w.stands.size===1);
});
mut('a material compiled every time it is met',()=>{
 const bad=mutate(MODELS,'if(m&&!warmSeen.has(m)){warmSeen.add(m);warmQ.push([m,o]);}','if(m){warmQ.push([m,o]);}');
 const w=scenDedupe(bad);caught(w.log.calls.length===3);
});
mut('the waiter called with jobs still queued',()=>{
 const bad=mutate(MODELS,' if(!warmQ.length)warmWait.splice(0).forEach(f=>f());',' warmWait.splice(0).forEach(f=>f());');
 const r=scenWaiter(bad);caught(r.before===0&&r.left===0);
});
mut('no cap on the hold',()=>{
 const bad=mutate(MODELS,'warmWait.push(go);setTimeout(go,cap*1000);','warmWait.push(go);');
 const r=scenCap(bad);caught(r.at3===1);
});
mut('the cap and the drain both calling back',()=>{
 const bad=mutate(MODELS,'let on=true;const go=()=>{if(on){on=false;cb();}};','const go=()=>{cb();};');
 const r=scenCap(bad);caught(r.final===1);
});
mut('a flush that does not look at the scene again',()=>{
 const bad=mutate(MODELS,'  if(!warmQ.length)warmAdd(scene);   // whatever joined the scene while the queue ran (the frost blocks, the boost glow)\n','');
 const r=scenFlush(bad);caught(r.compiled===6&&r.left===0);
});
mut('the waiters let go without a last look',()=>{
 const bad=mutate(MODELS,' if(!warmQ.length)warmAdd(scene);   // one more look before anyone is let go: a slice can end on the last job\n','');
 const r=scenRescan(bad);caught(r.n===1&&r.sawIce===true);
});
mut('flush leaving jobs',()=>{
 const bad=mutate(MODELS,'function warmFlush(){\n if(warmTm){clearTimeout(warmTm);warmTm=0;}\n warmRun(0);','function warmFlush(){\n if(warmTm){clearTimeout(warmTm);warmTm=0;}\n warmRun(1);');
 const r=scenFlush(bad);caught(r.compiled===6);
});
mut('on:false still slicing',()=>{
 const bad=mutate(MODELS,' if(CONFIG.warm.on===false)warmRun(0);\n else if',' if(false)warmRun(0);\n else if');
 const r=scenOff(bad);caught(r.compiled===3&&r.timers===0);
});
mut('a failed compile ending the queue',()=>{
 const bad=mutate(MODELS,"  try{renderer.compile(s,camera);}catch(e){console.warn('shader warm failed',e);}","  renderer.compile(s,camera);");
 let r;try{r=scenBoom(bad);}catch(e){throw new Error('caught');}
 caught(r.good&&r.warned===1);
});
mut('powerups not queued',()=>{
 const bad=mutate(MODELS,'for(const k in puTemplates)warmPush(puTemplates[k]);','void 0;');
 const r=scenPower(bad);caught(r.queued===2);
});
mut('a fracture template pushed whole',()=>{
 const bad=mutate(FRAC,'   if(seen.has(k))return;seen.add(k);\n','');
 const r=scenFrac(bad);caught(r.F.pushed.length===3);
});
mut('a fracture template warmed opaque',()=>{
 const bad=mutate(FRAC,'mats.forEach(m=>{m.transparent=true;m.opacity=1;});\n   rep.push(c);','rep.push(c);');
 const r=scenFrac(bad);caught(r.F.pushed.every(m=>m.material.transparent===true));
});
mut('the parked balls not following the option',()=>{
 const bad=mutate(FRAC,'  warmMeshHolder.children.forEach(c=>setBallEnv({m:c},env));\n','');
 const b=scenBalls(bad);caught(b.env2.length===b.nTypes&&b.env2.every(e=>e===null));
});
mut('the parked balls with no reflection map',()=>{
 const bad=mutate(FRAC,'?ballCubeRT.texture:null;','?null:null;');
 const b=scenBalls(bad);caught(b.env1.every(e=>e==='CUBE'));
});
mut('balls parked before the GLB is there',()=>{
 const bad=mutate(FRAC,'   if(useModel&&!ballModel)break;   // the ball GLB is still on its way: they are parked on the next call\n','');
 const l=scenBallLate(bad);caught(l.early===0);
});
mut('balls parked every call',()=>{
 const bad=mutate(FRAC,'   if(warmedBallTypes[key])continue;\n','');
 const b=scenBalls(bad);caught(b.n2===b.nTypes);
});
mut('the prep leaving out the frost blocks',()=>{
 const bad=mutate(FRAC,"  if(typeof iceBuild==='function')iceBuild();   // the ice blocks sit hidden in the scene, so the queue finds their shader\n",'');
 const p=scenPrep(bad);caught(p.calls==='ice,boost');
});
mut('the prep leaving out the boost glow',()=>{
 const bad=mutate(FRAC,"  if(typeof boostBuild==='function')boostBuild();   // ...and so does the boost glow\n",'');
 const p=scenPrep(bad);caught(p.calls==='ice,boost');
});
mut('the prep ignoring warmMatch:false',()=>{
 const bad=mutate(FRAC,"function warmMatchPrep(){\n  if(CONFIG.fx&&CONFIG.fx.warmMatch===false)return;\n","function warmMatchPrep(){\n");
 const p=scenPrep(bad,{warmMatch:false});caught(p.calls===''&&p.parked===0);
});
mut('boot not building what a match needs',()=>{
 const bad=mutate(MAIN,"  if(typeof warmMatchPrep==='function')warmMatchPrep();   // the ball types, the frost blocks and the boost glow, so the queue sees them\n",'');
 caught(/warmMatchPrep\(\);[^\n]*\n\s*warmPush\(scene\);warmWhen\(up,CONFIG\.warm\.holdMax\)/.test(fnAt(bad,'boot')));
});
mut('boot rendering before the shaders are ready',()=>{
 const bad=mutate(MAIN,"warmPush(scene);warmWhen(up,CONFIG.warm.holdMax);\n }\n else up();","up();\n }\n else up();");
 caught(/warmPush\(scene\);warmWhen\(up,CONFIG\.warm\.holdMax\)/.test(fnAt(bad,'boot')));
});
mut('the match start not flushing',()=>{
 const bad=mutate(FRAC,"  if(typeof warmFlush==='function')warmFlush();   // whatever the boot queue still holds is compiled before the whistle\n",'');
 caught(((fnAt(bad,'warmMatchAssets').match(/warmFlush\(\)/g)||[]).length)>=2);
});
mut('the intro cap shorter than the hold',()=>{
 const bad=mutate(CONFIG_SRC,'holdMax:40,','holdMax:6,');
 const hm=+(/holdMax:\s*(\d+)/.exec(bad.slice(bad.indexOf('intro:{'),bad.indexOf('match:{')))||[0,0])[1];
 caught(hm>=30);
});

/* ---- report ------------------------------------------------------------- */
console.log('\nwarm harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
console.log('mutations: '+mPass+' caught, '+mFail+' survived');
if(mFails.length)console.log('  SURVIVED:\n   - '+mFails.join('\n   - '));
process.exit(fail||mFail?1:0);
