// static harness for the KTX2 wiring (js/world.js, js/debug.js, index.html, vendor/). Run: node tools/ktx2-harness.js
// not behavioural (the WebGL transcode can't be faked in node; it was proved in a headless browser): it guards what rots, a new `new THREE.GLTFLoader()` without the ktx2Loader, the transcoder drifting from the bundled three, the transcoder path drifting, and memTex() reporting compressed textures as RGBA
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const ex=p=>fs.existsSync(path.join(ROOT,p));
const sz=p=>{try{return fs.statSync(path.join(ROOT,p)).size;}catch(e){return 0;}};

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

/* ---- 1. the vendored files exist and are the RIGHT ONES ------------------ */
ok(ex('vendor/three.bundle.js'),'vendor: three.bundle.js present (node tools/build-three.mjs)');
ok(/KTX2Loader/.test(rd('vendor/three.bundle.js'))&&/GLTFLoader/.test(rd('vendor/three.bundle.js')),'vendor: the bundle carries GLTFLoader and KTX2Loader');
ok(ex('vendor/basis/basis_transcoder.js'),'vendor: basis_transcoder.js present');
ok(ex('vendor/basis/basis_transcoder.wasm'),'vendor: basis_transcoder.wasm present');
// the transcoder must be the one shipped with the bundled three (build-three.mjs copies it); r128's pre-KTX2 wasm was 440,267 bytes
{const w=path.join(ROOT,'tools/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm');
 ok(sz('vendor/basis/basis_transcoder.wasm')>480000,'vendor: the transcoder has KTX2 + Zstandard (not r128\'s)',sz('vendor/basis/basis_transcoder.wasm')+' bytes');
 if(fs.existsSync(w))ok(fs.readFileSync(w).equals(fs.readFileSync(path.join(ROOT,'vendor/basis/basis_transcoder.wasm'))),'vendor: basis_transcoder.wasm matches tools/node_modules/three (rerun build-three.mjs)');}

/* ---- 2. index.html loads the bundle, and nothing remote ----------------- */
{
 const h=rd('index.html');
 ok(h.indexOf('vendor/three.bundle.js')>0,'index: three.bundle.js is in the boot chain');
 ok(h.indexOf('vendor/three.bundle.js')<h.indexOf("'js/core.js'"),'index: the bundle loads before js/');
 ok(!/three\.min\.js|WorkerPool\.js|KTX2Loader\.js|GLTFLoader\.js/.test(h),'index: no separate three / loader scripts left');
 ok(!/https?:\/\/(cdn|cdnjs|unpkg)/.test(h),'index: no CDN URL (no remote code in the Electron wrapper)');
}

/* ---- 3. NO loader escapes newGLTF() ------------------------------------- */
{
 // strip comments first, preserving line numbers, or the rule's own documentation in world.js (which quotes the banned form) reports itself as a breach
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
 // no image library in the encode path: basisu reads and resizes images itself and ImageUtils.getSize reads the header; sharp/libvips refused seven room textures on Windows; sharp stays as a transitive dep, but we must not call it
 ok(!/from 'sharp'|require\('sharp'\)|import\('sharp'\)/.test(e),
    'encoder: does not use sharp — the original image bytes go straight to basisu');
 ok(/ImageUtils\.getSize/.test(e),'encoder: dimensions come off the file header, not from a decode');
 ok(/'-resample'/.test(e),'encoder: basisu does the align-to-4 resize itself');
 const pk=JSON.parse(rd('tools/package.json'));
 for(const dep of ['@gltf-transform/core','@gltf-transform/extensions','@gltf-transform/functions','@gpu-tex-enc/basis'])
  ok(!!pk.dependencies[dep],'tools: package.json declares '+dep);
 ok(!pk.dependencies.sharp,'tools: sharp is NOT a direct dependency any more');
 // the inverse of the obvious assertion: "type":"module" here would make every .js in tools/ an ES module and kill every CommonJS harness; the encoder is .mjs (ESM on its own extension)
 ok(pk.type===undefined,
    'tools: package.json does NOT set type:module — it would break every CommonJS harness in tools/',
    'type='+pk.type);
 ok(fs.existsSync(path.join(ROOT,'tools/ktx2-encode.mjs')),'tools: …and the encoder is .mjs, so it is ESM anyway');
}

console.log('\nktx2 wiring harness: '+pass+' passed, '+fail+' failed');
if(fails.length)console.log('  FAILED:\n   - '+fails.join('\n   - '));
process.exit(fail?1:0);
