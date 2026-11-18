// Builds vendor/three.bundle.js (window.THREE + loaders) from the pinned three in tools/package.json.
// Run from the repo root or tools/:  node tools/build-three.mjs
import {build} from 'esbuild';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const tools=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(tools);
const three=path.join(tools,'node_modules','three');
const ver=JSON.parse(fs.readFileSync(path.join(three,'package.json'),'utf8')).version;
const out=path.join(root,'vendor','three.bundle.js');

// a module namespace is frozen: copy it so THREE.ShaderChunk stays the same mutable object (haze.js writes into it)
const entry=`import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/examples/jsm/loaders/KTX2Loader.js';
window.THREE=Object.assign({},T,{GLTFLoader,KTX2Loader});`;

// --- source patches: each anchor must match exactly `n` times or the build stops ---
const PATCHES={
 'src/renderers/webgl/WebGLBackground.js':[
  // r152+ never tone-maps an sRGB background; texture.userData.toneMapped (set on the room skies) overrides that
  ['.material.toneMapped = ColorManagement.getTransfer( background.colorSpace ) !== SRGBTransfer;',
   '.material.toneMapped = background.userData.toneMapped !== undefined ? background.userData.toneMapped : ColorManagement.getTransfer( background.colorSpace ) !== SRGBTransfer;',2],
 ],
 'src/materials/Material.js':[
  // r151+ draws a transparent double-sided material twice (back faces, then front); r128 drew it once, and the rooms, glass and debris were tuned on that
  ['this.forceSinglePass = false;','this.forceSinglePass = true;',1],
 ],
 'examples/jsm/loaders/KTX2Loader.js':[
  // the default transcoder URL reads import.meta.url at load, which an IIFE lacks (throws outside a page); world.js sets the path
  ["new URL( '../libs/basis/basis_transcoder.wasm', import.meta.url ).toString()","''",1],
  ["new URL( '../libs/basis/basis_transcoder.js', import.meta.url ).toString()","''",1],
 ],
};
// bare 'three' (the entry and every example) from source, not build/three.module.js, so the patches apply
const srcPlugin={name:'fz-src',setup(b){b.onResolve({filter:/^three$/},()=>({path:path.join(three,'src','Three.js')}));}};
const patchPlugin={name:'fz-patch',setup(b){
 b.onLoad({filter:/three[\\/](src|examples)[\\/].*\.js$/},async a=>{
  const rel=path.relative(three,a.path).split(path.sep).join('/');
  const P=PATCHES[rel];if(!P)return undefined;
  let s=await fs.promises.readFile(a.path,'utf8');
  for(const [from,to,n] of P){const c=s.split(from).length-1;if(c!==n)throw new Error(rel+': patch anchor found '+c+'x, want '+n+': '+from);s=s.split(from).join(to);}
  P.done=true;return {contents:s,loader:'js'};
 });
}};

await build({stdin:{contents:entry,resolveDir:tools,loader:'js'},bundle:true,format:'iife',minify:true,plugins:[srcPlugin,patchPlugin],
 target:'es2020',outfile:out,legalComments:'none',banner:{js:`/* three.js ${ver} + GLTFLoader + KTX2Loader, built by tools/build-three.mjs (patched: ${Object.keys(PATCHES).join(', ')}). MIT, three.js authors. */`}});
for(const k in PATCHES)if(!PATCHES[k].done)throw new Error('patched file never loaded: '+k);

const bs=path.join(three,'examples','jsm','libs','basis'),bd=path.join(root,'vendor','basis');
fs.mkdirSync(bd,{recursive:true});
for(const f of ['basis_transcoder.js','basis_transcoder.wasm'])fs.copyFileSync(path.join(bs,f),path.join(bd,f));
console.log('three',ver,'->',path.relative(root,out),(fs.statSync(out).size/1024|0)+' KB; basis copied');
