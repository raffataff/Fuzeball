'use strict';
/* BALL SHADOW FLICKER — tools/ballshadow-harness.js
   The ball's shadow strobed on/off every other frame. Cause: updateBallReflect suppressed the
   shadow pass for its 6 cube faces with `shadowMap.autoUpdate=false` ALONE, but this project runs
   CONFIG.render.shadow.autoUpdate:false already — so needsUpdate is the ONLY gate, and r128's
   shadow pass CLEARS it whenever it runs. Cube face 1 therefore consumed the frame's pending
   shadow update while the lead ball was hidden, and the main pass then skipped.

   This slices the REAL updateBallReflect out of js/world.js and drives it against a renderer stub
   that reproduces r128's gating VERBATIM (read out of vendor/three.min.js):
       if(!1===y.enabled)return; if(!1===y.autoUpdate&&!1===y.needsUpdate)return; ... y.needsUpdate=!1
   and a CubeCamera stub that calls renderer.render 6 times — which is what r128's CubeCamera does,
   and note it does NOT touch shadowMap.autoUpdate itself (checked: no such reference in the file).   */
const fs=require('fs');
const rd=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');   // CRLF-strip at the READ (2026-08-23)

let P=0,F=0;const fail=[];
const ok=(c,m)=>{if(c)P++;else{F++;fail.push(m);}};

/* ---- slice the real function ------------------------------------------------ */
const SRC=rd('js/world.js');
function slice(name){
 const a=SRC.indexOf('function '+name+'(');if(a<0)throw new Error('no '+name);
 const b=SRC.indexOf('\n}',a);if(b<0)throw new Error('unterminated '+name);
 return SRC.slice(a,b+2);
}
const FN=slice('updateBallReflect');
ok(/needsUpdate/.test(FN),'sliced updateBallReflect mentions needsUpdate (the fix is present)');

/* ---- the world the function runs in ----------------------------------------- */
function mkWorld(opt){
 opt=opt||{};
 const W={shadowRenders:0,mainDraws:0,cubeFaces:0,mapHasBall:false,frames:[]};
 const ball={visible:true,position:{x:0,y:2,z:0,distanceToSquared:()=>1}};
 W.ball=ball;
 const sm={enabled:true,autoUpdate:opt.autoUpdate===true,needsUpdate:false};
 // r128 WebGLShadowMap.render, verbatim gating
 const shadowRender=()=>{
  if(sm.enabled===false)return;
  if(sm.autoUpdate===false&&sm.needsUpdate===false)return;
  W.shadowRenders++;W.mapHasBall=ball.visible;   // the map is drawn from whatever is VISIBLE now
  sm.needsUpdate=false;
 };
 const renderer={shadowMap:sm,render(){shadowRender();}};
 W.renderer=renderer;W.sm=sm;
 W.env={
  CONFIG:{ballReflect:{on:true,res:32,every:opt.every||2,near:1,far:300,intensity:1}},
  S:{balls:[{m:ball}],phase:'play'},
  camera:{position:{x:0,y:50,z:80}},
  renderer,
  ballReflectOn:()=>true,
  ballCube:{position:{copy(){}},update(r,s){for(let i=0;i<6;i++){W.cubeFaces++;r.render(s,null);}}},
  scene:{}
 };
 // shadowDirty() as world.js defines it, for the autoUpdate:false path
 W.shadowDirty=()=>{if(!sm.autoUpdate)sm.needsUpdate=true;};
 W.mainRender=()=>{shadowRender();W.mainDraws++;};
 return W;
}

/* build a callable from the sliced source; ballReflN is a module-level counter in world.js, so it
   is threaded through a closure variable here exactly as the throttle needs. */
function build(W,fnSrc){
 const keys=Object.keys(W.env);
 const body='let ballReflN=0;'+fnSrc+';return updateBallReflect;';
 return new Function(...keys,body)(...keys.map(k=>W.env[k]));
}

/* ---- run N frames of the real main.js ordering ------------------------------- */
// main.js: shadowDirty() [casters moved] -> updateBallReflect() -> renderer.render(scene,camera)
function run(fnSrc,frames,opt){
 const W=mkWorld(opt);const f=build(W,fnSrc);
 for(let i=0;i<frames;i++){W.shadowDirty();f();W.mainRender();W.frames.push(W.mapHasBall);}
 return W;
}

/* ================= 1. THE FIX ================= */
{
 const W=run(FN,12);
 const missing=W.frames.filter(v=>!v).length;
 ok(missing===0,'FIXED: every displayed frame has the ball in the shadow map (missing='+missing+'/12)');
 ok(W.shadowRenders===12,'exactly one shadow render per frame — no added cost (got '+W.shadowRenders+')');
 ok(W.cubeFaces===6*6,'cube pass still ran on every 2nd frame (faces='+W.cubeFaces+')');
 ok(W.mainDraws===12,'main pass drew every frame');
}

/* ================= 2. THE BUG, RE-APPLIED ================= */
// the exact pre-fix line: autoUpdate alone, needsUpdate untouched.
{
 const MUT=FN
   .replace('const sa=renderer.shadowMap.autoUpdate,sn=renderer.shadowMap.needsUpdate;','const sa=renderer.shadowMap.autoUpdate;')
   .replace('renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;','renderer.shadowMap.autoUpdate=false;')
   .replace('renderer.shadowMap.autoUpdate=sa;renderer.shadowMap.needsUpdate=sn;','renderer.shadowMap.autoUpdate=sa;');
 ok(MUT!==FN,'mutation applied (guards a drifted anchor)');
 const W=run(MUT,12);
 const missing=W.frames.filter(v=>!v).length;
 ok(missing===6,'BUG REPRODUCED: the ball is missing from the shadow map on exactly the 6 cube frames (got '+missing+')');
 const alt=W.frames.every((v,i)=>v===(i%2===0));
 ok(alt,'and it alternates frame by frame — the reported strobe: '+W.frames.map(v=>v?'1':'0').join(''));
}

/* ================= 3. NO REGRESSION WHEN autoUpdate IS TRUE ================= */
{
 const W=run(FN,10,{autoUpdate:true});
 ok(W.frames.every(v=>v),'autoUpdate:true — ball present in every frame');
 ok(W.shadowRenders===10,'autoUpdate:true — still one shadow render per frame, the 6 faces suppressed (got '+W.shadowRenders+')');
}

/* ================= 4. THE 6 FACES NEVER DRAW A SHADOW MAP ================= */
{
 const W=mkWorld({every:1});const f=build(W,FN);   // every:1 — a single call must do the cube pass
 W.shadowDirty();
 const before=W.shadowRenders;f();
 ok(W.shadowRenders===before,'the cube pass itself renders no shadow map (it reuses the one on the card)');
 ok(W.sm.needsUpdate===true,'the pending update survives the cube pass and is handed to the main render');
 ok(W.cubeFaces===6,'all 6 faces ran');
}

/* ================= 5. FLAGS RESTORED EXACTLY ================= */
{
 for(const au of [true,false]){
  const W=mkWorld({autoUpdate:au,every:1});const f=build(W,FN);
  W.sm.needsUpdate=false;f();
  ok(W.sm.autoUpdate===au,'autoUpdate restored ('+au+')');
  ok(W.sm.needsUpdate===false,'needsUpdate restored when nothing was pending (autoUpdate='+au+')');
 }
 const W=mkWorld({every:1});const f=build(W,FN);
 W.sm.needsUpdate=true;f();
 ok(W.sm.needsUpdate===true,'needsUpdate restored when one WAS pending');
}

/* ================= 6. THE BALL IS STILL HIDDEN FROM ITS OWN REFLECTION ======== */
{
 const W=mkWorld({every:1});
 let seen=null;
 W.env.ballCube.update=(r,s)=>{seen=W.ball.visible;for(let i=0;i<6;i++)r.render(s,null);};
 const f=build(W,FN);f();
 ok(seen===false,'lead ball is hidden during the cube pass (unchanged)');
 ok(W.ball.visible===true,'and its visibility is restored after');
}

/* --pattern: print the strobe itself, which is the thing that was reported. */
if(process.argv.includes('--pattern')){
 const MUT=FN.replace('const sa=renderer.shadowMap.autoUpdate,sn=renderer.shadowMap.needsUpdate;','const sa=renderer.shadowMap.autoUpdate;')
             .replace('renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;','renderer.shadowMap.autoUpdate=false;')
             .replace('renderer.shadowMap.autoUpdate=sa;renderer.shadowMap.needsUpdate=sn;','renderer.shadowMap.autoUpdate=sa;');
 const fmt=w=>w.frames.map(v=>v?'#':'.').join(' ');
 const a=run(MUT,16),b=run(FN,16);
 console.log('ball shadow drawn, per frame  (# present, . missing)');
 console.log('  BEFORE: '+fmt(a)+'   shadow renders='+a.shadowRenders);
 console.log('  AFTER : '+fmt(b)+'   shadow renders='+b.shadowRenders);
}
console.log((F?'FAIL':'PASS')+' — '+P+' passed, '+F+' failed');
for(const m of fail)console.log('  x '+m);
process.exit(F?1:0);
