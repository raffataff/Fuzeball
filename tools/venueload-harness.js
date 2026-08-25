/* Behavioural harness for the IDLE-RENDER GATE (js/world.js) and the STAGED VENUE SWAP
   (js/flow.js). No three.js, no browser, no DOM: the pieces are string-sliced out of the
   real sources and rebuilt with new Function against stubs, so the harness tests the code
   that ships rather than a copy of it.

   Both features are ASYNC and ORDER-SENSITIVE — the whole point of venueLoad is WHEN each
   step runs relative to a paint — so time here is a virtual clock (`tick`) driving both
   setTimeout and requestAnimationFrame. A rAF callback that queues another rAF lands on the
   NEXT tick, exactly as a browser would, which is what makes the "veil has painted before
   the stall" claim actually testable.

   Run: node tools/venueload-harness.js                                                    */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
// Read through a CRLF strip. js/*.js is CRLF and a multi-line needle written as a template
// literal has its terminators normalised to LF by the ECMAScript lexer itself, so it could
// never match the raw bytes. Same fix rng-harness.js carries; see CLAUDE.md 2026-08-23.
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const WORLD=rd('js/world.js'), FLOW=rd('js/flow.js');

/* ---- source slicing ----------------------------------------------------- */
function fnAt(src,name){
 const start=src.indexOf('function '+name+'(');
 if(start<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
function lineAt(src,needle){
 const i=src.indexOf(needle);
 if(i<0)throw new Error('ANCHOR LOST: '+needle);
 const a=src.lastIndexOf('\n',i)+1,b=src.indexOf('\n',i);
 return src.slice(a,b<0?src.length:b);
}

/* ---- virtual clock ------------------------------------------------------ */
const CLK={t:0,timers:[],rafs:[],seq:0};
function clkReset(){CLK.t=0;CLK.timers=[];CLK.rafs=[];CLK.seq=0;}
const setTimeoutS=(fn,ms)=>{CLK.timers.push({at:CLK.t+(ms||0),fn,i:CLK.seq++});return CLK.seq;};
const rafS=fn=>{CLK.rafs.push(fn);return CLK.seq++;};
function tick(ms){
 CLK.t+=(ms===undefined?16:ms);
 const due=CLK.timers.filter(x=>x.at<=CLK.t).sort((a,b)=>a.at-b.at||a.i-b.i);
 CLK.timers=CLK.timers.filter(x=>x.at>CLK.t);
 due.forEach(x=>x.fn());
 const r=CLK.rafs;CLK.rafs=[];        // snapshot: a rAF queued from a rAF waits for the next tick
 r.forEach(f=>f(CLK.t));
}
const run=(n,ms)=>{for(let i=0;i<n;i++)tick(ms);};

/* ---- three.js stubs (only what the gate touches) ------------------------ */
function V3(){this.x=0;this.y=0;this.z=0;}
V3.prototype.copy=function(o){this.x=o.x;this.y=o.y;this.z=o.z;return this;};
V3.prototype.equals=function(o){return this.x===o.x&&this.y===o.y&&this.z===o.z;};
function Q(){this.x=0;this.y=0;this.z=0;this.w=1;}
Q.prototype.copy=V3.prototype.copy&&function(o){this.x=o.x;this.y=o.y;this.z=o.z;this.w=o.w;return this;};
Q.prototype.equals=function(o){return this.x===o.x&&this.y===o.y&&this.z===o.z&&this.w===o.w;};
const THREE={Vector3:V3,Quaternion:Q};

/* ---- the idle gate, rebuilt from source --------------------------------- */
function buildGate(src,over){
 const body=[
  lineAt(src,'let _idleT=1e9'),
  lineAt(src,'const _idleCam=new THREE.Vector3()'),
  fnAt(src,'renderDirty'),
  fnAt(src,'renderIdleSkip')
 ].join('\n');
 const CONFIG={render:{idle:Object.assign({on:true,hz:4,settle:0.4,phases:['menu'],camEps:0.01,camRotEps:1e-4},over||{})}};
 const S={phase:'menu',redit:null,photo:null,freeRoam:false};
 const renderer={shadowMap:{needsUpdate:false,autoUpdate:false}};
 const camera={position:new V3(),quaternion:new Q()};
 const PERF={on:false};
 const f=new Function('CONFIG','S','renderer','camera','THREE','PERF','dbgOn',
  body+'\nreturn{renderDirty:renderDirty,renderIdleSkip:renderIdleSkip};');
 const api=f(CONFIG,S,renderer,camera,THREE,PERF,false);
 return{api,CONFIG,S,renderer,camera,PERF};
}
// How many of the next `n` frames actually RENDER (skip===false).
function drawn(g,n,dt){let k=0;for(let i=0;i<n;i++)if(!g.api.renderIdleSkip(dt===undefined?1/60:dt))k++;return k;}

/* ---- the staged swap, rebuilt from source ------------------------------- */
function buildVenue(src,cfgOver){
 const body=[
  lineAt(src,'let mlN=0;'),
  fnAt(src,'showMatchLoading'),
  lineAt(src,'let venueBusy=false,venuePend=null;'),
  fnAt(src,'venueLoad')
 ].join('\n');
 const log=[];
 const el={id:'matchLoad',innerHTML:'',classList:{on:false,toggle(c,v){this.on=!!v;log.push(v?'veil:up':'veil:down');}}};
 const label={textContent:''};
 const $=i=>i==='matchLoad'?el:(i==='mlLabel'?label:null);
 const CONFIG={venue:Object.assign({on:true,fadeT:0.24,minT:0.45,maxT:9},cfgOver||{})};
 const renderer={compiled:0,compile(){renderer.compiled++;log.push('compile');}};
 const doc={createElement(){return el;},body:{appendChild(){}}};
 const f=new Function('$','CONFIG','renderer','scene','camera','document','setTimeout',
                      'requestAnimationFrame','Date','console','shadowDirty','renderDirty',
  body+'\nreturn{venueLoad:venueLoad,showMatchLoading:showMatchLoading,mlN:()=>mlN,busy:()=>venueBusy};');
 const api=f($,CONFIG,renderer,{},{},doc,setTimeoutS,rafS,{now:()=>CLK.t},
  {warn(){},log(){}},()=>log.push('shadowDirty'),()=>log.push('renderDirty'));
 return{api,log,el,label,renderer,CONFIG};
}

/* ---- scoring ------------------------------------------------------------ */
let pass=0,fail=0;const fails=[];
function ok(c,msg,extra){if(c)pass++;else{fail++;fails.push(msg+(extra===undefined?'':'  ['+extra+']'));}}

/* ========================================================================= */
/* 1. THE GATE NEVER SKIPS SOMETHING SOMEONE IS WATCHING                     */
/* ========================================================================= */
{
 const g=buildGate(WORLD);
 g.api.renderDirty();run(0);
 // burn the settle window off first, so every case below is testing the STEADY state
 drawn(g,40);
 ok(drawn(g,60)<60,'idle: a settled menu skips frames',drawn(g,60)+'/60');

 const live=['play','count','goal','replay','win','pause'];
 live.forEach(ph=>{
  const h=buildGate(WORLD);h.S.phase=ph;drawn(h,40);
  ok(drawn(h,60)===60,'idle: phase "'+ph+'" is NEVER throttled',ph);
 });

 const cases=[['room editor',h=>{h.S.redit={};}],
              ['photo mode',  h=>{h.S.photo={};}],
              ['free roam',   h=>{h.S.freeRoam=true;}],
              ['profiler on', h=>{h.PERF.on=true;}]];
 cases.forEach(([name,set])=>{
  const h=buildGate(WORLD);set(h);drawn(h,40);
  ok(drawn(h,60)===60,'idle: '+name+' is NEVER throttled');
 });
 // the debug overlay is passed in as a binding, so it needs its own build
 {
  const body=[lineAt(WORLD,'let _idleT=1e9'),lineAt(WORLD,'const _idleCam=new THREE.Vector3()'),
              fnAt(WORLD,'renderDirty'),fnAt(WORLD,'renderIdleSkip')].join('\n');
  const f=new Function('CONFIG','S','renderer','camera','THREE','PERF','dbgOn',
   body+'\nreturn{renderIdleSkip:renderIdleSkip,renderDirty:renderDirty};');
  const api=f({render:{idle:{on:true,hz:4,settle:0.4,phases:['menu']}}},
              {phase:'menu',redit:null,photo:null,freeRoam:false},
              {shadowMap:{needsUpdate:false,autoUpdate:false}},
              {position:new V3(),quaternion:new Q()},THREE,{on:false},true);
  let k=0;for(let i=0;i<100;i++)if(!api.renderIdleSkip(1/60))k++;
  ok(k===100,'idle: the debug overlay (C) is NEVER throttled',k+'/100');
 }
}

/* ========================================================================= */
/* 2. THROTTLE SHAPE: full rate while settling, a FLOOR after — never zero   */
/* ========================================================================= */
{
 const g=buildGate(WORLD,{settle:0.4,hz:4});
 g.api.renderDirty();
 // 0.4s of settle at 60fps = 24 frames, every one of them drawn
 ok(drawn(g,24)===24,'idle: `settle` gives FULL frame rate after a change');
 const n=drawn(g,60);   // the next second, steady state
 ok(n>=3&&n<=5,'idle: steady state lands on ~hz frames per second, not zero',n+' (hz 4)');
 ok(n>0,'idle: the floor is a THROTTLE, not an off switch — a missed hook self-heals');

 const fast=buildGate(WORLD,{settle:0,hz:30});
 ok(Math.abs(drawn(fast,60)-30)<=2,'idle: hz is honoured, not hardcoded',drawn(fast,60));

 const held=buildGate(WORLD,{settle:0,hz:0});
 ok(drawn(held,60)===0,'idle: hz 0 holds the last frame indefinitely');

 const off=buildGate(WORLD,{on:false});
 ok(drawn(off,60)===60,'idle: on:false restores the old always-render behaviour exactly');

 const other=buildGate(WORLD,{phases:['win']});
 other.S.phase='menu';drawn(other,40);
 ok(drawn(other,60)===60,'idle: `phases` is honoured — a phase not listed is never throttled');
}

/* ========================================================================= */
/* 3. WHAT COUNTS AS A CHANGE                                                */
/* ========================================================================= */
{
 const g=buildGate(WORLD,{settle:0.2,hz:1});
 drawn(g,60);                                   // settle into the throttle
 ok(drawn(g,6)===0,'change: idle really is idle before the change');
 g.api.renderDirty();
 ok(drawn(g,6)===6,'change: renderDirty() buys full frame rate immediately');

 const c=buildGate(WORLD,{settle:0.2,hz:1});
 drawn(c,60);
 c.camera.position.x=5;                         // cameraUpdate lerped
 ok(drawn(c,6)===6,'change: a MOVING CAMERA is detected, not hooked');
 drawn(c,60);
 c.camera.quaternion.y=0.3;                     // camera.lookAt
 ok(drawn(c,6)===6,'change: a camera ROTATION counts too (lookAt writes the quaternion)');

 /* THE SHADOW-FLAG TRAP. `renderer.shadowMap.needsUpdate` looks like the obvious extra dirty
    signal. It is poison: r128's WebGLShadowMap.render() returns on `enabled === false` BEFORE it
    clears the flag, so with shadows switched off in Options the flag latches true forever the
    first time anything calls shadowDirty(). A gate that reads it then marks EVERY frame dirty and
    does nothing at all — for exactly the players who most need it. Caught in a headless run
    reporting 100% of menu frames still rendering with shadows off. */
 const s=buildGate(WORLD,{settle:0.05,hz:1});
 s.renderer.shadowMap.needsUpdate=true;              // latched, as it is whenever shadows are off
 drawn(s,40);
 ok(drawn(s,60)<60,'shadow flag: a LATCHED shadowMap.needsUpdate does not defeat the throttle',
    drawn(s,60)+'/60');
 ok(!/renderer\.shadowMap\.needsUpdate\)renderDirty/.test(fnAt(WORLD,'renderIdleSkip')),
    'shadow flag: renderIdleSkip does not read it at all');
 // …and the case it was supposed to cover is covered anyway, by shadowDirty itself
 ok(/renderDirty\(\)\;\}$/.test(fnAt(WORLD,'shadowDirty').replace(/\s+/g,'')),
    'shadow flag: shadowDirty calls renderDirty UNCONDITIONALLY, outside its autoUpdate guard');
}

/* ========================================================================= */
/* 3b. THE ASYMPTOTE. cameraUpdate lerps toward a FIXED target in the menus,  */
/*     and a lerp never quite arrives — so an exact float compare reads "the  */
/*     camera is still moving" essentially forever and the throttle never     */
/*     engages at all. Found by a headless run reporting 100% of menu frames  */
/*     rendered with the gate nominally on; this is that bug, pinned.         */
/* ========================================================================= */
{
 const g=buildGate(WORLD,{settle:0.05,hz:1});
 // exactly what fx.js cameraUpdate does: position.x = lerp(position.x, target, k)
 const TARGET=42, K=0.12;
 let drew=0;
 for(let i=0;i<600;i++){
  g.camera.position.x+= (TARGET-g.camera.position.x)*K;   // asymptotes, never lands
  if(!g.api.renderIdleSkip(1/60))drew++;
 }
 ok(drew<120,'asymptote: a settling lerp does NOT defeat the throttle',drew+'/600 drawn');
 ok(drew>0,'asymptote: and the settle itself IS drawn — no hitch while it moves');

 // a real camera move is still caught. settle 0.1s at 1/60 = 6 frames of full rate.
 const h=buildGate(WORLD,{settle:0.1,hz:1});
 drawn(h,600);
 h.camera.position.x+=0.5;                         // a few pixels of screen motion
 ok(drawn(h,6)===6,'asymptote: a real camera move is still detected');

 const q=buildGate(WORLD,{settle:0.1,hz:1});
 drawn(q,600);
 q.camera.quaternion.y+=0.01;                      // camera.lookAt writes the quaternion
 ok(drawn(q,6)===6,'asymptote: a rotation is detected on its own threshold');

 // zero thresholds = the original bug. It DOES terminate eventually (float64 lerp lands exactly
 // after a few hundred iterations) — that is precisely why it was invisible in review and only
 // showed up as "every menu frame rendered" in a headless run.
 const tight=buildGate(WORLD,{settle:0.05,hz:1,camEps:0,camRotEps:0});
 let t=0;
 for(let i=0;i<600;i++){tight.camera.position.x+=(TARGET-tight.camera.position.x)*K;
  if(!tight.api.renderIdleSkip(1/60))t++;}
 ok(t>drew*2,'asymptote: zero thresholds reproduce the bug — many times more frames drawn',
    t+'/600 vs '+drew+'/600');
}

/* ========================================================================= */
/* 4. shadowDirty() FEEDS THE GATE — that is what inherits every old hook    */
/* ========================================================================= */
{
 const sd=fnAt(WORLD,'shadowDirty');
 ok(/renderDirty\(\)/.test(sd),
    'wiring: shadowDirty() calls renderDirty(), so applyRoom/applySkin/rebuildRodMen/'+
    'buildRoomProps/the sim step all mark the frame without being touched');
 // the appearance-only changes, which move no casters and so never reach shadowDirty
 /* shadowDirty() counts, because it CALLS renderDirty() unconditionally (see the note on it in
    world.js). drawField reaches it that way: the pitch is a shadow RECEIVER and swapping it is a
    structural change to the table, so shadowDirty is the more correct call of the two. Accepting
    only renderDirty here would have failed a correct implementation, which is how an assertion
    teaches people to route around it. */
 [['applyColors','kit colour'],['applyFog','fog'],['applyDisplay','render scale'],['drawField','pitch swap']]
  .forEach(([fn,what])=>ok(/(render|shadow)Dirty\(\)/.test(fnAt(WORLD,fn)),
    'wiring: '+fn+' marks the frame ('+what+' moves no casters)'));
 ok(/renderDirty\(\)\;?\}\)\;/.test(lineAt(WORLD,"addEventListener('resize'")),
    'wiring: a window resize marks the frame — a held idle frame is the wrong SIZE');
}

/* ========================================================================= */
/* 5. THE STAGED SWAP: order, and the paint that makes the veil worth having */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW);
 let ranAt=-1;
 v.api.venueLoad(done=>{ranAt=CLK.t;done();},{label:'LOADING ROOM'});
 ok(v.log[0]==='veil:up','swap: the veil goes up FIRST',v.log[0]);
 ok(v.label.textContent==='LOADING ROOM','swap: the caller owns the wording',v.label.textContent);
 ok(ranAt<0,'swap: the work does NOT start in the same task — that is the whole fix');

 tick(16);tick(16);
 ok(ranAt<0,'swap: the work waits out the veil’s CSS fade (else it freezes half-drawn)');

 run(30,16);                                     // past fadeT (240ms) and the rAF pair
 ok(ranAt>=240,'swap: work starts only after the fade has completed',ranAt);
 const i=v.log.indexOf('compile');
 ok(i>0,'swap: renderer.compile() runs — the shader link + texture upload happen under the veil');
 ok(v.renderer.compiled===1,'swap: warmed exactly once',v.renderer.compiled);
 ok(v.log.indexOf('veil:down')>i,'swap: the veil comes down AFTER the warm, never before');
 ok(v.log.indexOf('shadowDirty')>0&&v.log.indexOf('renderDirty')>0,'swap: the frame + shadow map are marked');
 ok(v.api.mlN()===0,'swap: the veil refcount returns to zero');
 ok(!v.api.busy(),'swap: the gate releases');
}

/* ========================================================================= */
/* 6. minT, so a cached swap does not strobe                                 */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW,{fadeT:0.1,minT:0.6});
 v.api.venueLoad(done=>done(),{});               // resolves instantly, as a cached room does
 let downAt=-1;
 for(let i=0;i<80&&downAt<0;i++){tick(16);if(v.log.indexOf('veil:down')>=0)downAt=CLK.t;}
 ok(downAt>=600,'swap: minT holds the veil so an instant swap cannot strobe',downAt+'ms');
}

/* ========================================================================= */
/* 7. COALESCING: only the room you stopped on gets loaded                   */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW,{fadeT:0.05,minT:0.05});
 const ran=[];
 v.api.venueLoad(d=>{ran.push('void');d();},{});
 v.api.venueLoad(d=>{ran.push('pub');d();},{});      // arrived mid-swap
 v.api.venueLoad(d=>{ran.push('saucer');d();},{});   // and again
 v.api.venueLoad(d=>{ran.push('arcade');d();},{});   // where the player actually stopped
 run(120,16);
 ok(ran.indexOf('pub')<0&&ran.indexOf('saucer')<0,
    'coalesce: the rooms scrolled PAST are never loaded',JSON.stringify(ran));
 ok(ran.length===2&&ran[0]==='void'&&ran[1]==='arcade',
    'coalesce: the in-flight one finishes, then the LAST request runs',JSON.stringify(ran));
}

/* ========================================================================= */
/* 8. FAILURE MODES — a veil that never lifts is worse than the freeze       */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW,{fadeT:0.05,minT:0.05,maxT:1});
 v.api.venueLoad(()=>{/* a hung fetch: fires neither load nor error */},{});
 run(20,16);
 ok(v.log.indexOf('veil:down')<0,'hang: the veil is still up while the load is genuinely pending');
 run(120,16);
 ok(v.log.indexOf('veil:down')>0,'hang: maxT lifts the veil rather than stranding the player');
 ok(!v.api.busy(),'hang: the gate releases after the timeout, so the next swap still works');
}
{
 clkReset();
 const v=buildVenue(FLOW,{fadeT:0.05,minT:0.05});
 v.api.venueLoad(()=>{throw new Error('loader blew up');},{});
 run(60,16);
 ok(v.log.indexOf('veil:down')>0,'throw: a loader that throws still lifts the veil');
 ok(v.api.mlN()===0,'throw: and still balances the refcount');
}
{
 clkReset();
 const v=buildVenue(FLOW,{on:false});
 let ranAt=-1;
 v.api.venueLoad(d=>{ranAt=CLK.t;d();},{});
 ok(ranAt===0,'config: venue.on:false calls straight through, synchronously (old behaviour)');
 ok(v.log.indexOf('compile')<0,'config: and skips the warm, since there is no veil to warm under');
}

/* ========================================================================= */
/* 9. SILENT: same staging, no veil (the league tape is already the loader)  */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW,{fadeT:0.24,minT:0.45});
 let ranAt=-1;
 v.api.venueLoad(d=>{ranAt=CLK.t;d();},{silent:true});
 run(60,16);
 ok(v.log.indexOf('veil:up')<0,'silent: no veil — #lgTape is already on screen there');
 ok(v.log.indexOf('compile')>=0,'silent: but STILL warmed, which is most of the win');
 ok(ranAt>=0&&ranAt<240,'silent: and not delayed by a fade it never waits for',ranAt);
}

/* ========================================================================= */
/* 10. THE VEIL IS REFCOUNTED — two owners, no early reveal                  */
/* ========================================================================= */
{
 clkReset();
 const v=buildVenue(FLOW);
 v.api.showMatchLoading(true,'LOADING');          // the match-start gate
 v.api.showMatchLoading(true,'LOADING ROOM');     // a venue swap, at the same time
 ok(v.el.classList.on,'refcount: two owners, veil up');
 v.api.showMatchLoading(false);
 ok(v.el.classList.on,'refcount: one owner leaving does NOT reveal the other’s half-built room');
 v.api.showMatchLoading(false);
 ok(!v.el.classList.on,'refcount: the last owner takes it down');
 v.api.showMatchLoading(false);                   // unbalanced, as a sync match start used to be
 ok(v.api.mlN()===0,'refcount: an unbalanced lower clamps at zero rather than going negative');
 // …and startMatch must not BE that unbalanced caller any more
 const sm=fnAt(FLOW,'startMatch');
 ok(/veil=false;showMatchLoading\(false\)/.test(sm.replace(/\s+/g,'')) ||
    /if\(veil\)\{veil=false;showMatchLoading\(false\);\}/.test(sm),
    'refcount: startMatch only lowers a veil it actually raised');
}

/* ========================================================================= */
/* 11. STALE-ANCHOR GUARD — re-apply the bugs and prove the suite bites      */
/* ========================================================================= */
function mutate(src,needle,repl){
 if(src.indexOf(needle)<0)throw new Error('MUTATION DID NOT APPLY (anchor drifted): '+needle);
 return src.replace(needle,repl);
}
let mPass=0,mFail=0;const mFails=[];
function mut(name,fn){try{fn();mFail++;mFails.push(name);}catch(e){
 if(/MUTATION DID NOT APPLY/.test(e.message)){mFail++;mFails.push(name+' — '+e.message);}
 else mPass++;}}

// (a) drop the live-phase guard → a match would render at 4Hz
mut('a live phase escaping the throttle',()=>{
 const bad=mutate(WORLD,"if((I.phases||['menu']).indexOf(S.phase)<0)return false;","");
 const g=buildGate(bad);g.S.phase='play';drawn(g,40);
 if(drawn(g,60)!==60)throw new Error('caught');
});
// (b) make the floor zero → a missed hook becomes a permanently stale frame
mut('the throttle becoming an off switch',()=>{
 const g=buildGate(WORLD,{hz:0,settle:0});
 if(drawn(g,600)===0)throw new Error('caught');
});
// (c) unhook shadowDirty → every structural rebuild stops marking the frame
mut('shadowDirty no longer feeding the gate',()=>{
 const bad=mutate(WORLD,
  'function shadowDirty(){if(renderer&&!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;renderDirty();}',
  'function shadowDirty(){if(renderer&&!renderer.shadowMap.autoUpdate)renderer.shadowMap.needsUpdate=true;}');
 if(!/renderDirty\(\)/.test(fnAt(bad,'shadowDirty')))throw new Error('caught');
});
// (d) start the work in the same task → the veil can never paint, which was the whole bug
mut('the work running before the veil paints',()=>{
 clkReset();
 const bad=mutate(FLOW,'  if(!staged){fn();return;}','  fn();return;');
 const v=buildVenue(bad);
 let ranAt=-1;v.api.venueLoad(d=>{ranAt=CLK.t;d();},{});
 if(ranAt===0)throw new Error('caught');
});
// (e) drop the compile → the upload lands on the first VISIBLE frame again
mut('losing the renderer.compile() warm',()=>{
 clkReset();
 const bad=mutate(FLOW,'renderer.compile(scene,camera);','void 0;');
 const v=buildVenue(bad);
 v.api.venueLoad(d=>d(),{});run(80,16);
 if(v.renderer.compiled===0)throw new Error('caught');
});
// (f) queue instead of coalescing → scrolling the dropdown loads every room on the way
mut('queueing every room instead of coalescing',()=>{
 clkReset();
 const bad=mutate(FLOW,'if(venueBusy){venuePend={run:run,opts:opts};return;}',
                       'if(venueBusy){setTimeout(()=>venueLoad(run,opts),50);return;}');
 const v=buildVenue(bad,{fadeT:0.05,minT:0.05});
 const ran=[];
 ['void','pub','saucer','arcade'].forEach(r=>v.api.venueLoad(d=>{ran.push(r);d();},{}));
 run(300,16);
 if(ran.length>2)throw new Error('caught');
});
// (g1) read the shadow flag again → shadows-off players get no throttle at all
mut('reading the latched shadowMap.needsUpdate',()=>{
 const bad=mutate(WORLD,' _idleT+=rdt;',' if(renderer.shadowMap.needsUpdate)renderDirty();\n _idleT+=rdt;');
 const g=buildGate(bad,{settle:0.05,hz:1});
 g.renderer.shadowMap.needsUpdate=true;
 drawn(g,40);
 if(drawn(g,60)>=60)throw new Error('caught');       // the real assertion is <60 — it must fail
});
// (g2) put the exact float compare back → the throttle silently never engages
mut('an exact camera compare defeating the throttle',()=>{
 const bad=mutate(WORLD,
  ' if(Math.abs(P.x-_idleCam.x)>E||Math.abs(P.y-_idleCam.y)>E||Math.abs(P.z-_idleCam.z)>E||',
  ' if(!camera.position.equals(_idleCam)||!camera.quaternion.equals(_idleQuat)||false||');
 const g=buildGate(bad,{settle:0.05,hz:1});
 let drew=0;
 for(let i=0;i<600;i++){g.camera.position.x+=(42-g.camera.position.x)*0.12;
  if(!g.api.renderIdleSkip(1/60))drew++;}
 if(drew>=120)throw new Error('caught');   // the real assertion is drew<120 — it must now fail
});
// (g) drop the hang ceiling → a stalled fetch strands the veil forever
mut('a hung load stranding the veil',()=>{
 clkReset();
 const bad=mutate(FLOW,"  setTimeout(settle,(V.maxT===undefined?9:V.maxT)*1000);","");
 const v=buildVenue(bad,{fadeT:0.05,minT:0.05,maxT:1});
 v.api.venueLoad(()=>{},{});run(400,16);
 if(v.log.indexOf('veil:down')<0)throw new Error('caught');
});

/* ---- report ------------------------------------------------------------- */
console.log('\nvenue/idle harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
console.log('mutation guard:     '+mPass+' caught, '+mFail+' MISSED');
if(mFails.length)console.log('  MISSED:\n   - '+mFails.join('\n   - '));
process.exit(fail||mFail?1:0);
