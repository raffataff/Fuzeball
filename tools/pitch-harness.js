/* Behavioural harness for PITCH RESIDENCY (js/models.js ensurePitch/disposePitch/prunePitches,
   js/world.js drawField) plus a static check that CONFIG.pitches actually points at files.

   The interesting failure here is not a crash — it is a pitch that quietly falls back to its JPEG
   and looks nearly right, which is exactly what `champions_purple` and `pub_classic` did for
   months. So most of these assertions are about the FALLBACK not being taken.

   Run: node tools/pitch-harness.js                                                             */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const MODELS=rd('js/models.js'), WORLD=rd('js/world.js');

function fnAt(src,name){
 const s=src.indexOf('function '+name+'(');
 if(s<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;for(let j=src.indexOf('{',s);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(s,j+1);}}
 throw new Error('unbalanced: '+name);
}
const lineAt=(src,n)=>{const i=src.indexOf(n);if(i<0)throw new Error('ANCHOR LOST: '+n);
 const a=src.lastIndexOf('\n',i)+1,b=src.indexOf('\n',i);return src.slice(a,b<0?src.length:b);};

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

/* ---- a pitch world, rebuilt from source --------------------------------- */
function build(over){
 const body=[
  lineAt(MODELS,'const pitchGroups={};'),lineAt(MODELS,'const pitchLoading={};'),
  lineAt(MODELS,'const pitchFailed={};'),lineAt(MODELS,'const pitchOrder=[];'),
  fnAt(MODELS,'pitchHasGlb'),fnAt(MODELS,'touchPitch'),fnAt(MODELS,'ensurePitch'),
  fnAt(MODELS,'disposePitch'),fnAt(MODELS,'prunePitches')
 ].join('\n');
 const st={loads:[],disposed:[],fail:new Set((over&&over.fail)||[])};
 const pending=[];
 // a GLTFLoader that never resolves until the test says so — residency is all about WHEN
 // The stub scene needs traverse() and visible: ensurePitch walks it to fix texture ENCODINGS
 // (sRGB for colour, linear for data) and that walk is inside a try/catch — a scene without
 // traverse throws, the catch swallows it, and the pitch is silently never registered. Which is
 // exactly the shape of bug this harness exists to catch, so the stub has to be honest.
 const mkScene=url=>{const s={children:[1],name:url,__id:url,visible:true,parent:null,
   traverse(f){f(s);}, isMesh:false};return s;};
 const newGLTF=()=>({load(url,onLoad,_p,onErr){st.loads.push(url.split('/').pop());
   pending.push(()=>{ if(st.fail.has(url.split('/').pop())) onErr(new Error('404'));
                      else onLoad({scene:mkScene(url)}); });}});
 const CONFIG={pitches:(over&&over.pitches)||{
   a:{folder:'p/',glb:'pitch_a.glb',tex:'a.jpg'}, b:{folder:'p/',glb:'pitch_b.glb',tex:'b.jpg'},
   c:{folder:'p/',glb:'pitch_c.glb',tex:'c.jpg'}, d:{folder:'p/',glb:'pitch_d.glb',tex:'d.jpg'},
   nog:{tex:'nog.jpg'}},
  tableAssets:{cachePitches:(over&&over.cachePitches)||2}};
 const f=new Function('CONFIG','THREE','newGLTF','console','disposeModelTemplate',
  body+'\nreturn{ensurePitch,disposePitch,prunePitches,pitchHasGlb,groups:()=>pitchGroups,order:()=>pitchOrder,failed:()=>pitchFailed};');
 const api=f(CONFIG,{},newGLTF,{log(){},warn(){}},g=>st.disposed.push(g.__id));
 return{api,st,CONFIG,settle(){const q=pending.splice(0);q.forEach(fn=>fn());}};
}

/* ---- 1. lazy: only what you asked for -------------------------------- */
{
 const w=build();let done=0;
 w.api.ensurePitch('a',()=>done++);
 ok(w.st.loads.length===1&&w.st.loads[0]==='pitch_a.glb','lazy: one fetch, for the one asked for',JSON.stringify(w.st.loads));
 ok(done===0,'lazy: the callback waits for the file, it does not fire on request');
 w.settle();
 ok(done===1,'lazy: …and fires once it lands');
 ok(Object.keys(w.api.groups()).length===1,'lazy: exactly one pitch resident');
 w.api.ensurePitch('a',()=>done++);
 ok(w.st.loads.length===1&&done===2,'lazy: a second ask for a resident pitch is synchronous and re-fetches nothing');
}
/* ---- 2. concurrent asks QUEUE rather than double-fetch --------------- */
{
 const w=build();let n=0;
 w.api.ensurePitch('a',()=>n++);w.api.ensurePitch('a',()=>n++);w.api.ensurePitch('a',()=>n++);
 ok(w.st.loads.length===1,'in-flight: three asks, one fetch',w.st.loads.length+' fetches');
 ok(n===0,'in-flight: nobody is released early — a kickoff gating on this must not start on a half-loaded pitch');
 w.settle();
 ok(n===3,'in-flight: all three released together',n);
}
/* ---- 3. a 404 latches, and does NOT re-fetch on every venue change ---- */
{
 const w=build({fail:['pitch_b.glb']});
 let done=0;w.api.ensurePitch('b',()=>done++);w.settle();
 ok(done===1,'404: the callback still fires — a gate must never hang on a missing file');
 ok(!!w.api.failed().b,'404: latched');
 ok(w.api.pitchHasGlb('b')===false,'404: pitchHasGlb goes false, so drawField uses the JPEG for real');
 w.api.ensurePitch('b',()=>done++);
 ok(w.st.loads.length===1,'404: never re-fetched — drawField runs on every venue change',w.st.loads.length);
 ok(w.api.order().indexOf('b')<0,'404: and it does not squat an LRU slot');
}
/* ---- 4. the LRU, and the active pitch is untouchable ------------------ */
{
 const w=build({cachePitches:2});
 for(const id of ['a','b','c']){w.api.ensurePitch(id,()=>{});w.settle();w.api.prunePitches(id);}
 ok(Object.keys(w.api.groups()).length<=2,'lru: bounded by cachePitches',Object.keys(w.api.groups()).join(','));
 ok(!!w.api.groups().c,'lru: the ACTIVE pitch is never the one evicted');
 ok(w.st.disposed.length>0,'lru: eviction actually frees');
 // revisiting must refresh recency, or the LRU is a queue
 const v=build({cachePitches:2});
 for(const id of ['a','b']){v.api.ensurePitch(id,()=>{});v.settle();v.api.prunePitches(id);}
 v.api.ensurePitch('a',()=>{});v.api.prunePitches('a');
 v.api.ensurePitch('c',()=>{});v.settle();v.api.prunePitches('c');
 ok(!!v.api.groups().a===false||!!v.api.groups().c,'lru: a revisit refreshes recency',JSON.stringify(Object.keys(v.api.groups())));
 ok(!v.api.groups().b,'lru: b — the genuinely least-recent — is the one that went');
 const one=build({cachePitches:1});
 for(const id of ['a','b','c']){one.api.ensurePitch(id,()=>{});one.settle();one.api.prunePitches(id);}
 ok(Object.keys(one.api.groups()).length===1,'lru: cachePitches 1 holds only the active pitch');
}
/* ---- 5. a pitch with no glb never pretends to have one ---------------- */
{
 const w=build();let done=0;
 w.api.ensurePitch('nog',()=>done++);
 ok(done===1&&w.st.loads.length===0,'no-glb: resolves synchronously and fetches nothing');
 ok(w.api.pitchHasGlb('nog')===false,'no-glb: reported honestly, so drawField takes the JPEG path');
}
/* ---- 6. drawField's contract (read from source) ----------------------- */
{
 const df=fnAt(WORLD,'drawField');
 ok(/gg\.parent\.remove\(gg\)/.test(df),
    'drawField: inactive pitches are DETACHED, not hidden — three walks invisible objects in '+
    'updateMatrixWorld and renderer.compile() uploads anything it can reach regardless of .visible');
 ok(/if\(!show\(\)\)fallbackTex\(id\)/.test(df),
    'drawField: the JPEG is fetched ONLY when the GLB did not land — dressing the stand-in "while we '+
    'wait" downloads the same pitch twice');
 ok(/onReady/.test(df),'drawField: takes an onReady, so venueLoad can hold the veil until the pitch is resident');
 ok(/prunePitches/.test(df),'drawField: bounds residency on every switch');
 ok(/shadowDirty\(\)/.test(df),'drawField: marks the shadow map — the pitch is a shadow RECEIVER and the map is frozen');
 const bt=fnAt(WORLD,'buildTable');
 ok(/CONFIG\.pitches\[cfg\.pitch\]&&CONFIG\.pitches\[cfg\.pitch\]\.glb/.test(bt),
    'buildTable: the boot-time JPEG preload is skipped when the pitch has a GLB');
 ok(!/pitchVariants|freePitchMeshGPU|applyPitchModel/.test(WORLD),
    'world.js: the atlas-era detach/reattach machinery is gone, not merely unused');
 ok(!/loadPitchModel/.test(rd('js/main.js').replace(/\/\/[^\n]*/g,'')),
    'main.js: boot no longer pulls the whole atlas');
}
/* ---- 7. CONFIG points at files that EXIST, and no two share one ------- */
{
 const ctx={window:{},document:{},navigator:{userAgent:''},localStorage:{getItem(){return null;},setItem(){}},
            console:{log(){},warn(){}},matchMedia:()=>({matches:false}),addEventListener(){}};
 ctx.globalThis=ctx;ctx.self=ctx;vm.createContext(ctx);
 let CONFIG=null,err='';
 try{CONFIG=vm.runInContext(rd('js/core.js')+'\n'+rd('js/config.js')+'\nCONFIG;',ctx,{timeout:5000});}catch(e){err=e.message;}
 ok(!!(CONFIG&&CONFIG.pitches),'config: loaded',err);
 if(CONFIG&&CONFIG.pitches){
  const ids=Object.keys(CONFIG.pitches);
  const files=ids.map(id=>CONFIG.pitches[id].glb).filter(Boolean);
  /* THE REGRESSION THAT STARTED THIS. `glb` used to be a MESH NAME in a shared atlas, and
     ballKey() collapsed `x.001` onto `x` — so champions_purple and pub_classic pointed at meshes
     that no longer had a distinct key and fell through to their JPEGs, silently, for months. One
     file each makes that impossible; this assertion is what keeps it impossible. */
  ok(new Set(files).size===files.length,
     'config: every pitch has its OWN glb — two sharing one is how champions_purple and pub_classic '+
     'silently fell back to JPEGs',JSON.stringify(files.filter((f,i)=>files.indexOf(f)!==i)));
  ok(files.length===ids.length,'config: every pitch HAS a glb',ids.filter(id=>!CONFIG.pitches[id].glb).join(','));
  const missing=ids.filter(id=>{const P=CONFIG.pitches[id];
    return P.glb&&!fs.existsSync(path.join(ROOT,(P.folder||'assets/pitches/')+P.glb));});
  ok(missing.length===0,
     'config: every pitch glb is actually on disk — a typo here is invisible at runtime, it just '+
     'quietly serves the JPEG',missing.join(', '));
  ok(!fs.existsSync(path.join(ROOT,'assets/pitches/fuzeball_pitch.glb')),
     'assets: the old 32MB atlas is gone — leaving it means shipping it');
  const stale=fs.existsSync(path.join(ROOT,'assets/pitches'))
    ? fs.readdirSync(path.join(ROOT,'assets/pitches')).filter(f=>/\.glb$/.test(f)&&!files.includes(f)) : [];
  ok(stale.length===0,'assets: no orphan pitch GLBs nothing references',stale.join(', '));
 }
}

console.log('\npitch harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
process.exit(fail?1:0);
