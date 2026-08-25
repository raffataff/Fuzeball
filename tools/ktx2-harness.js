/* Static harness for the KTX2 WIRING (js/world.js, js/debug.js, index.html, vendor/).

   Deliberately NOT a behavioural harness. The interesting behaviour here is a WebGL transcode into
   a GPU block format, which cannot be faked in node — that half was proved in a headless browser
   against the real room and figurine GLBs (see CLAUDE.md). What node CAN guard, and what actually
   rots, is the wiring: a new `new THREE.GLTFLoader()` slipping in without the ktx2Loader attached,
   the r137 vendor pin being "tidied up" to match r128, the transcoder path drifting from where the
   files live, and memTex() going back to reporting compressed textures as uncompressed RGBA.

   Run: node tools/ktx2-harness.js                                                              */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const ex=p=>fs.existsSync(path.join(ROOT,p));
const sz=p=>{try{return fs.statSync(path.join(ROOT,p)).size;}catch(e){return 0;}};

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

/* ---- 1. the vendored files exist and are the RIGHT ONES ------------------ */
ok(ex('vendor/KTX2Loader.js'),'vendor: KTX2Loader.js present');
ok(ex('vendor/WorkerPool.js'),'vendor: WorkerPool.js present — KTX2Loader references THREE.WorkerPool');
ok(ex('vendor/basis/basis_transcoder.js'),'vendor: basis_transcoder.js present');
ok(ex('vendor/basis/basis_transcoder.wasm'),'vendor: basis_transcoder.wasm present');
/* THE r137 PIN. r128's transcoder wasm is 440,267 bytes and predates KTX2 container + Zstandard
   support; r137's is 499,935. Someone "fixing the version inconsistency" by copying r128's files
   over these is the single most likely way this feature dies, and it would fail at runtime with an
   unhelpful transcode error rather than at load. Pin the size. */
ok(sz('vendor/basis/basis_transcoder.wasm')>480000,
   'vendor: the transcoder is the r137 build, not r128\'s pre-KTX2 one — do NOT "fix" this to match three\'s pin',
   sz('vendor/basis/basis_transcoder.wasm')+' bytes, expected ~499935');
ok(/KTX2Loader/.test(rd('vendor/KTX2Loader.js')),'vendor: KTX2Loader.js defines KTX2Loader');
ok(/WorkerPool/.test(rd('vendor/WorkerPool.js')),'vendor: WorkerPool.js defines WorkerPool');

/* ---- 2. index.html loads them, in the right order ------------------------ */
{
 const h=rd('index.html');
 const iW=h.indexOf('vendor/WorkerPool.js'), iK=h.indexOf('vendor/KTX2Loader.js'), iG=h.indexOf('vendor/GLTFLoader.js'), iT=h.indexOf('vendor/three.min.js');
 ok(iW>0,'index: WorkerPool.js is in the boot chain');
 ok(iK>0,'index: KTX2Loader.js is in the boot chain');
 ok(iT<iW&&iT<iK,'index: three.min.js loads before both');
 ok(iW<iK,'index: WorkerPool BEFORE KTX2Loader — KTX2Loader reads THREE.WorkerPool at construction');
 ok(/0\.137/.test(h.slice(Math.max(0,iW-400),iK+400)),
    'index: the CDN fallbacks point at r137, matching what vendor/ carries');
}

/* ---- 3. NO loader escapes newGLTF() ------------------------------------- */
{
 /* Comments are stripped FIRST, and line numbers are preserved by blanking rather than deleting.
    Without this the rule's own documentation — the block in world.js that says "every GLTFLoader
    must come from newGLTF()" and quotes the thing it is banning — reports itself as a breach. A
    harness that fails on its own explanation is a harness people learn to ignore. */
 const decomment=s=>s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '))
                     .replace(/(^|[^:])\/\/[^\n]*/g,(m,p)=>p+' '.repeat(m.length-p.length));
 const files=fs.readdirSync(path.join(ROOT,'js')).filter(f=>/\.js$/.test(f));
 const offenders=[];
 for(const f of files){
  decomment(rd('js/'+f)).split('\n').forEach((line,i)=>{
   if(!/new\s+THREE\.GLTFLoader\s*\(/.test(line))return;
   // the ONE legitimate site is inside newGLTF() itself
   if(f==='world.js'&&/const g=new THREE\.GLTFLoader\(\);/.test(line))return;
   offenders.push(f+':'+(i+1)+'  '+line.trim().slice(0,60));
  });
 }
 ok(offenders.length===0,
    'wiring: every GLTFLoader comes from newGLTF() — a bare one has no ktx2Loader and THROWS on a '+
    'file whose KHR_texture_basisu is required',offenders.join(' | '));
 const w=rd('js/world.js');
 ok(/function newGLTF\(\)/.test(w),'wiring: newGLTF() exists');
 ok(/setKTX2Loader\(k\)/.test(w),'wiring: newGLTF() attaches the loader');
 const body=w.slice(w.indexOf('function newGLTF()'),w.indexOf('function newGLTF()')+240);
 ok(!/const g=newGLTF\(\)/.test(body),'wiring: newGLTF() does not call ITSELF (a blanket find-and-replace does exactly this)');
 // count the call sites, so a silently-dropped one is visible
 let n=0;for(const f of fs.readdirSync(path.join(ROOT,'js'))) if(/\.js$/.test(f))
  n+=(rd('js/'+f).match(/newGLTF\(\)\.load|=\s*newGLTF\(\)|const loader\s*=\s*newGLTF\(\)/g)||[]).length;
 ok(n>=13,'wiring: all ~14 loader sites route through it',n+' call sites found');
}

/* ---- 4. the transcoder path matches where the files actually are --------- */
{
 const w=rd('js/world.js');
 const m=w.match(/setTranscoderPath\('([^']+)'\)/);
 ok(!!m,'ktx2: a transcoder path is set — KTX2Loader cannot fetch the wasm without one');
 if(m) ok(ex(m[1]+'basis_transcoder.js')&&ex(m[1]+'basis_transcoder.wasm'),
   'ktx2: setTranscoderPath points at files that exist',m[1]);
 ok(/detectSupport\(renderer\)/.test(w),
   'ktx2: detectSupport(renderer) is called — without it the loader has no target format and every load fails');
 ok(/_ktx2Tried/.test(w),'ktx2: the loader is built ONCE (it owns a worker pool)');
 ok(/console\.warn\('KTX2: this GPU exposes NO compressed/.test(w)||/NO compressed texture format/.test(w),
   'ktx2: a GPU with no compressed format at all says so, rather than rendering black models');
}

/* ---- 5. the texture audit must not lie about compressed textures --------- */
{
 const d=rd('js/debug.js');
 const t=d.slice(d.indexOf('function texSize('),d.indexOf('function memTexCollect('));
 ok(/isCompressedTexture/.test(t),
    'memTex: texSize handles compressed textures — the RGBA formula over-reports a KTX2 texture 4x, '+
    'and this is the tool you use to check whether the KTX2 pass worked');
 ok(/mipmaps/.test(t)&&/byteLength/.test(t),'memTex: it sums the real mip bytes rather than estimating');
 ok(/KTX2/.test(d.slice(d.indexOf('function memTex('),d.indexOf('function memTex(')+900)),
    'memTex: the report distinguishes encoded from fallen-back — at a glance those look identical');
}

/* ---- 6. the encoder script's invariants --------------------------------- */
{
 ok(ex('tools/ktx2-encode.mjs'),'tools: the encoder is in the tree');
 ok(ex('tools/package.json'),'tools: with a package.json, so `npm i` in tools/ is the whole setup');
 const e=rd('tools/ktx2-encode.mjs');
 ok(/align4|multiple of 4/i.test(e),
    'encoder: aligns to a multiple of 4 — BC7 and S3TC REFUSE a level that is not, and ASTC does not, '+
    'so the same file works on one GPU and fails on another');
 ok(/uastc/i.test(e)&&/ETC1S/.test(e),'encoder: both codecs');
 ok(/LINEAR_SLOTS[\s\S]{0,200}normal/.test(e),
    'encoder: normal/metalRough/occlusion are classified as LINEAR data, not colour');
 ok(/setRequired\(true\)/.test(e),
    'encoder: KHR_texture_basisu is marked required — a KTX2 asset with a silent PNG fallback is just both files shipped');
 ok(/\.bak/.test(e),'encoder: keeps a .bak of every original');
 /* NO IMAGE LIBRARY IN THE ENCODE PATH. basisu reads png/jpg itself and resizes itself
    (-resample), and ImageUtils.getSize reads dimensions off the file header — so the original
    bytes go from the GLB straight to the encoder. The first version routed everything through
    sharp and libvips refused SEVEN of this project's own room textures on Windows
    ("colourspace: parameter space not set", a VipsInterpretation of 32 that is not in the enum)
    while handling the same files fine on Linux. sharp is still present as a TRANSITIVE dep of
    @gltf-transform/functions; what must not come back is us calling it. */
 ok(!/from 'sharp'|require\('sharp'\)|import\('sharp'\)/.test(e),
    'encoder: does not use sharp — the original image bytes go straight to basisu');
 ok(/ImageUtils\.getSize/.test(e),'encoder: dimensions come off the file header, not from a decode');
 ok(/'-resample'/.test(e),'encoder: basisu does the align-to-4 resize itself');
 const pk=JSON.parse(rd('tools/package.json'));
 for(const dep of ['@gltf-transform/core','@gltf-transform/extensions','@gltf-transform/functions','@gpu-tex-enc/basis'])
  ok(!!pk.dependencies[dep],'tools: package.json declares '+dep);
 ok(!pk.dependencies.sharp,'tools: sharp is NOT a direct dependency any more');
 /* THE INVERSE OF THE OBVIOUS ASSERTION, and it cost a broken run to learn: setting
    "type":"module" here makes every .js in tools/ an ES module, and every other harness in this
    folder is CommonJS using require() — they all die on the spot. The encoder is .mjs, which is
    ESM on its own extension. */
 ok(pk.type===undefined,
    'tools: package.json does NOT set type:module — it would break every CommonJS harness in tools/',
    'type='+pk.type);
 ok(fs.existsSync(path.join(ROOT,'tools/ktx2-encode.mjs')),'tools: …and the encoder is .mjs, so it is ESM anyway');
}

console.log('\nktx2 wiring harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
process.exit(fail?1:0);
