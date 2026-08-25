/* Behavioural harness for BAKED-ENV RESIDENCY (js/world.js setRoomEnv / touchEnv / pruneEnvs,
   js/models.js disposeRoom). No three.js, no browser: the functions are string-sliced out of the
   real sources and rebuilt with new Function against counting stubs, so what is tested is the
   code that ships.

   The thing under test is a TRADE, not a feature: a room GLB is 20-45MB and its PMREM bake is
   ~6MB, and disposeRoom used to free both — so the assertions are mostly about what must NOT
   happen (a second bake, a synthetic flash on re-entry, an unbounded cache, a tex.dispose on a
   render target).

   Run: node tools/roomenv-harness.js                                                          */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
// CRLF strip at the READ — a multi-line needle written as a template literal has its terminators
// normalised to LF by the lexer and could never match these files. See CLAUDE.md 2026-08-23.
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const WORLD=rd('js/world.js'), MODELS=rd('js/models.js');

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

/* ---- a world, rebuilt from source -------------------------------------- */
function build(src,over){
 const body=[
  'let roomEnvCache={};',
  lineAt(src,'const envOrder=[];'),
  fnAt(src,'touchEnv'),
  fnAt(src,'pruneEnvs'),
  fnAt(src,'roomIblOn'),
  fnAt(src,'setRoomEnv')
 ].join('\n');
 const st={glb:0,syn:0,freedRT:[],freedTex:[]};
 // A PMREM bake as envKeep leaves it: the RENDER TARGET stashed on the texture. Freeing the
 // texture alone is the measured leak, so the stub records which door was used.
 const bake=(kind,tag)=>{st[kind]++;const t={tag:tag,userData:{}};
  t.userData.__pmremRT={dispose(){st.freedRT.push(tag);}};
  t.dispose=()=>st.freedTex.push(tag);return t;};
 const CONFIG={tableAssets:Object.assign({cacheEnvs:4},(over&&over.tableAssets)||{})};
 const cfg={reflections:(over&&over.reflections)!==undefined?over.reflections:true};
 const scene={environment:'INITIAL'};
 const roomGroups={};
 const f=new Function('CONFIG','cfg','scene','renderer','roomGroups','envDispose',
                      'bakeGlbEnv','bakeSyntheticEnv','console',
  body+'\nreturn{setRoomEnv,pruneEnvs,touchEnv,cache:()=>roomEnvCache,order:()=>envOrder};');
 const envDispose=tex=>{if(!tex)return;const rt=tex.userData&&tex.userData.__pmremRT;
  if(rt&&rt.dispose)rt.dispose();else if(tex.dispose)tex.dispose();};
 const api=f(CONFIG,cfg,scene,{},roomGroups,envDispose,
  g=>bake('glb',g.__id),e=>bake('syn',(e&&e.__id)||'?'),{log(){},warn(){}});
 return {api,st,cfg,scene,roomGroups,CONFIG,
  // a room definition + the levers a real venue change pulls
  land(id){roomGroups[id]={children:[1],__id:id};},           // its GLB arrived
  evict(id){delete roomGroups[id];},                          // disposeRoom ran
  def(id,o){return Object.assign({reflect:true,env:{__id:id}},o||{});}};
}

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

/* ========================================================================= */
/* 1. THE POINT: a revisit costs no bake and shows no synthetic flash        */
/* ========================================================================= */
{
 const w=build(WORLD);const rm=w.def('arcade');
 w.api.setRoomEnv('arcade',rm);                       // applyRoom, GLB still downloading
 ok(w.st.syn===1&&w.st.glb===0,'first visit: synthetic stand-in while the GLB downloads',
    'syn '+w.st.syn+' glb '+w.st.glb);
 w.land('arcade');w.api.setRoomEnv('arcade',rm);      // ensureRoom cb
 ok(w.st.glb===1,'first visit: the real bake happens once the GLB is resident');
 const real=w.scene.environment;
 ok(real&&real.tag==='arcade','first visit: the real bake is installed');

 w.evict('arcade');                                   // leave the room; disposeRoom frees the GLB
 w.api.setRoomEnv('arcade',rm);                       // come back
 ok(w.st.glb===1,'REVISIT: no second PMREM pass',   'glb bakes '+w.st.glb);
 ok(w.st.syn===1,'REVISIT: no synthetic flash — the real reflections go straight back on',
    'syn bakes '+w.st.syn);
 ok(w.scene.environment===real,'REVISIT: the SAME cached bake is installed');
 w.land('arcade');w.api.setRoomEnv('arcade',rm);      // and again when the GLB lands
 ok(w.st.glb===1&&w.scene.environment===real,'REVISIT: the GLB landing does not re-bake either');
}

/* ========================================================================= */
/* 2. A/B toggle — the thing anyone actually does with a room picker         */
/* ========================================================================= */
{
 const w=build(WORLD);const A=w.def('arcade'),B=w.def('pub');
 for(let i=0;i<6;i++){
  w.land('arcade');w.api.setRoomEnv('arcade',A);w.evict('arcade');
  w.land('pub');   w.api.setRoomEnv('pub',B);   w.evict('pub');
 }
 ok(w.st.glb===2,'A/B x6: two bakes total, not twelve','glb bakes '+w.st.glb);
 ok(w.st.freedRT.length===0&&w.st.freedTex.length===0,'A/B x6: nothing freed — both fit the cap');
}

/* ========================================================================= */
/* 3. THE LRU IS REAL, AND IT FREES THE RENDER TARGET, NOT THE TEXTURE       */
/* ========================================================================= */
{
 const w=build(WORLD,{tableAssets:{cacheEnvs:2}});
 ['a','b','c','d'].forEach(id=>{const rm=w.def(id);w.land(id);w.api.setRoomEnv(id,rm);w.evict(id);});
 ok(w.api.order().length<=2,'lru: the cache is bounded by cacheEnvs','held '+w.api.order().length);
 ok(w.st.freedRT.length>0,'lru: eviction actually frees');
 ok(w.st.freedTex.length===0,
    'lru: freed via envDispose (the RENDER TARGET), never tex.dispose — that was the measured leak',
    'tex.dispose calls: '+w.st.freedTex.length);
 ok(w.api.order()[w.api.order().length-1]==='glb:d','lru: the most recent entry is kept');
 ok(w.st.freedRT.indexOf('d')<0,'lru: the ACTIVE bake is never the one evicted');
}
{
 // cacheEnvs:1 must legally mean "hold nothing you are not looking at"
 const w=build(WORLD,{tableAssets:{cacheEnvs:1}});
 ['a','b','c'].forEach(id=>{const rm=w.def(id);w.land(id);w.api.setRoomEnv(id,rm);w.evict(id);});
 ok(w.api.order().length===1,'lru: cacheEnvs 1 holds only the active bake','held '+w.api.order().length);
 ok(w.scene.environment&&w.scene.environment.tag==='c','lru: …and it is still installed');
}
{
 // re-showing an older room must REFRESH its position, or the LRU is just a queue
 const w=build(WORLD,{tableAssets:{cacheEnvs:2}});
 ['a','b'].forEach(id=>{w.land(id);w.api.setRoomEnv(id,w.def(id));w.evict(id);});
 w.api.setRoomEnv('a',w.def('a'));                    // revisit the older one
 w.land('c');w.api.setRoomEnv('c',w.def('c'));        // now something new must evict
 ok(w.st.freedRT.indexOf('a')<0&&w.st.freedRT.indexOf('b')>=0,
    'lru: a revisit refreshes recency — b goes, not a',JSON.stringify(w.st.freedRT));
}

/* ========================================================================= */
/* 4. THE ROOMS THAT MUST NOT PAY FOR ANY OF THIS                           */
/* ========================================================================= */
{
 const w=build(WORLD);
 w.land('void');w.api.setRoomEnv('void',{ibl:false,reflect:true,env:{__id:'void'}});
 ok(w.scene.environment===null,'ibl:false: no image-based light at all');
 ok(w.st.glb===0&&w.st.syn===0,'ibl:false: nothing is BAKED, so nothing is held');
 ok(w.api.order().length===0,'ibl:false: and nothing enters the cache');
}
{
 const w=build(WORLD);const rm={reflect:false,env:{__id:'void'}};
 w.land('void');w.api.setRoomEnv('void',rm);w.api.setRoomEnv('void',rm);
 ok(w.st.glb===0,'reflect:false: never bakes from the GLB');
 ok(w.st.syn===1,'reflect:false: synthetic only, and cached','syn '+w.st.syn);
}
{
 // Reflections OFF then back ON must not re-bake — the switch is in Options and gets toggled.
 const w=build(WORLD);const rm=w.def('pub');
 w.land('pub');w.api.setRoomEnv('pub',rm);
 const real=w.scene.environment;
 w.cfg.reflections=false;w.api.setRoomEnv('pub',rm);
 ok(w.scene.environment!==real&&w.st.syn===1,'reflections off: falls back to the synthetic bake');
 w.cfg.reflections=true;w.api.setRoomEnv('pub',rm);
 ok(w.scene.environment===real&&w.st.glb===1,'reflections back on: the cached real bake, no re-bake');
}

/* ========================================================================= */
/* 5. disposeRoom MUST NOT TOUCH THE CACHE ANY MORE                          */
/* ========================================================================= */
{
 const dr=fnAt(MODELS,'disposeRoom');
 ok(!/roomEnvCache/.test(dr),'disposeRoom: no longer reaches into roomEnvCache');
 ok(!/envDispose/.test(dr),  'disposeRoom: no longer frees the bake');
 ok(/disposeModelTemplate\(room\)/.test(dr),'disposeRoom: still frees the GLB itself — the big half');
 ok(/pruneEnvs/.test(fnAt(WORLD,'setRoomEnv')),'setRoomEnv: the cache is bounded on every install');
 ok(/envDispose/.test(fnAt(WORLD,'pruneEnvs')),'pruneEnvs: owns the free, and uses the right door');
}

/* ========================================================================= */
/* 6. THE CAP HAS TO TRACK THE ROOM COUNT                                    */
/*    A room can occupy TWO slots (its glb bake plus the syn stand-in it      */
/*    showed while downloading), so the cap is rooms x 2. Sized per ROOM it   */
/*    thrashes, and a thrashing cache is indistinguishable from no cache —    */
/*    measured at 4, six swaps across three rooms re-baked all three. This    */
/*    assertion is what makes adding a fifth room fail loudly here rather     */
/*    than quietly undoing the feature.                                       */
/* ========================================================================= */
{
 const vm=require('vm');
 const ctx={window:{},document:{},navigator:{userAgent:''},localStorage:{getItem(){return null;},setItem(){}},
            console:{log(){},warn(){}},matchMedia:()=>({matches:false}),addEventListener(){}};
 ctx.globalThis=ctx;ctx.self=ctx;
 let CONFIG=null,cfgErr='';
 // core.js first: config.js reads its helpers (clamp) at load time. Same chain trials-harness uses.
 // `const CONFIG` is a LEXICAL binding, so it never lands on the context object — read the
 // script's completion value instead of ctx.CONFIG.
 try{vm.createContext(ctx);
     CONFIG=vm.runInContext(rd('js/core.js')+'\n'+rd('js/config.js')+'\nCONFIG;',ctx,{timeout:5000});
    }catch(e){cfgErr=e.message;}
 ok(!!(CONFIG&&CONFIG.rooms&&CONFIG.tableAssets),'config: loaded for the sizing check',
    CONFIG?'ok':('could not evaluate js/config.js — '+cfgErr));
 if(CONFIG&&CONFIG.rooms&&CONFIG.tableAssets){
  const nRooms=Object.keys(CONFIG.rooms).length, cap=CONFIG.tableAssets.cacheEnvs;
  ok(cap>=nRooms*2,'config: cacheEnvs covers every room twice (glb + syn) — RAISE IT IF THIS FAILS',
     cap+' for '+nRooms+' rooms, needs '+(nRooms*2));
  ok(CONFIG.tableAssets.cacheRooms===1,
     'config: cacheRooms stays at 1 — a second resident room is ~337MB of texture, not ~20MB',
     'cacheRooms '+CONFIG.tableAssets.cacheRooms);
  /* ONE REAL VISIT, which is where the two-entries-per-room comes from: applyRoom calls
     setRoomEnv once with the GLB still downloading (synthetic stand-in) and ensureRoom's callback
     calls it again once it lands (real bake). Then leaving the room evicts the GLB. Modelling only
     the second call is what made an undersized cap look fine in review. */
  const visit=(w,id)=>{const rm=w.def(id);
   w.api.setRoomEnv(id,rm);          // applyRoom, GLB in flight  -> syn:id
   w.land(id);w.api.setRoomEnv(id,rm);// ensureRoom cb            -> glb:id
   w.evict(id);};                     // disposeRoom
  const ROOMS3=['a','b','c'];
  const w=build(WORLD,{tableAssets:{cacheEnvs:nRooms}});   // sized per ROOM — the wrong way
  ROOMS3.forEach(id=>visit(w,id));
  const first=w.st.glb;
  ROOMS3.forEach(id=>visit(w,id));
  ok(w.st.glb>first,'config: a per-ROOM cap really does thrash — which is why it is rooms x 2',
     'glb bakes '+first+' -> '+w.st.glb);
  const good=build(WORLD,{tableAssets:{cacheEnvs:cap}});   // sized as shipped
  ROOMS3.forEach(id=>visit(good,id));
  const f2=good.st.glb, s2=good.st.syn;
  for(let i=0;i<4;i++)ROOMS3.forEach(id=>visit(good,id));
  ok(good.st.glb===f2,'config: at the shipped cap, repeated swaps re-bake nothing',
     'glb bakes '+f2+' -> '+good.st.glb);
  ok(good.st.syn===s2,'config: …and no synthetic re-bake either','syn bakes '+s2+' -> '+good.st.syn);
 }
}

/* ========================================================================= */
/* 7. STALE-ANCHOR GUARD — re-apply the old behaviour and prove it bites     */
/* ========================================================================= */
function mutate(src,needle,repl){
 if(src.indexOf(needle)<0)throw new Error('MUTATION DID NOT APPLY (anchor drifted): '+needle);
 return src.replace(needle,repl);
}
let mPass=0,mFail=0;const mFails=[];
function mut(name,fn){try{fn();mFail++;mFails.push(name);}catch(e){
 if(/MUTATION DID NOT APPLY/.test(e.message)){mFail++;mFails.push(name+' — '+e.message);}
 else mPass++;}}

// (a) gate USING a cached bake on the GLB being resident → the synthetic flash comes back
mut('the synthetic flash on re-entry',()=>{
 const bad=mutate(WORLD,' let key=(wantGlb&&(glbReady||roomEnvCache[gk]))?gk:sk;',
                        ' let key=(wantGlb&&glbReady)?gk:sk;');
 const w=build(bad);const rm=w.def('arcade');
 w.land('arcade');w.api.setRoomEnv('arcade',rm);w.evict('arcade');
 w.api.setRoomEnv('arcade',rm);
 if(w.st.syn>0)throw new Error('caught');            // the real assertion is syn===1 from visit 1
});
// (b) free the bake in disposeRoom again → every revisit re-bakes
mut('disposeRoom freeing the bake again',()=>{
 const bad=mutate(MODELS,' disposeModelTemplate(room);',
  ' disposeModelTemplate(room);\n if(typeof roomEnvCache!==\'undefined\')delete roomEnvCache[\'glb:\'+id];');
 if(/roomEnvCache/.test(fnAt(bad,'disposeRoom')))throw new Error('caught');
});
// (c) drop the prune → the cache grows without bound
mut('an unbounded env cache',()=>{
 const bad=mutate(WORLD,' pruneEnvs(key);\n}',' \n}');
 const w=build(bad,{tableAssets:{cacheEnvs:2}});
 ['a','b','c','d'].forEach(id=>{w.land(id);w.api.setRoomEnv(id,w.def(id));w.evict(id);});
 if(w.api.order().length>2)throw new Error('caught');    // real assertion is <=2 — it must fail
});
// (d) free through tex.dispose → the render-target leak is back
mut('freeing the texture instead of the render target',()=>{
 const bad=mutate(WORLD,'  if(roomEnvCache[k])envDispose(roomEnvCache[k]);',
                        '  if(roomEnvCache[k]&&roomEnvCache[k].dispose)roomEnvCache[k].dispose();');
 const w=build(bad,{tableAssets:{cacheEnvs:1}});
 ['a','b','c'].forEach(id=>{w.land(id);w.api.setRoomEnv(id,w.def(id));w.evict(id);});
 if(w.st.freedTex.length>0)throw new Error('caught');    // real assertion is ===0 — it must fail
});
// (e) stop touching on install → the LRU degrades to a plain queue and evicts the active bake
mut('an LRU that never refreshes recency',()=>{
 const bad=mutate(WORLD,'{scene.environment=roomEnvCache[key];touchEnv(key);}',
                        '{scene.environment=roomEnvCache[key];if(envOrder.indexOf(key)<0)envOrder.push(key);}');
 const w=build(bad,{tableAssets:{cacheEnvs:2}});
 ['a','b'].forEach(id=>{w.land(id);w.api.setRoomEnv(id,w.def(id));w.evict(id);});
 w.api.setRoomEnv('a',w.def('a'));
 w.land('c');w.api.setRoomEnv('c',w.def('c'));
 if(w.st.freedRT.indexOf('a')>=0)throw new Error('caught');
});
// (f) let a room with ibl:false bake anyway → it pays for a map it never uses
mut('ibl:false paying for a bake',()=>{
 const bad=mutate(WORLD,' if(!roomIblOn(rm)){scene.environment=null;return;}',
                        ' if(!roomIblOn(rm)){scene.environment=null;}');
 const w=build(bad);
 w.land('void');w.api.setRoomEnv('void',{ibl:false,reflect:true,env:{__id:'void'}});
 if(w.st.glb>0||w.st.syn>0)throw new Error('caught');    // real assertion is both 0 — it must fail
});

console.log('\nroom-env harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
console.log('mutation guard:   '+mPass+' caught, '+mFail+' MISSED');
if(mFails.length)console.log('  MISSED:\n   - '+mFails.join('\n   - '));
process.exit(fail||mFail?1:0);
