'use strict';
/* ============================================================================================
   offline-harness.js — assert Fuzeball boots with NO network access.

     node tools/offline-harness.js          (from the project root or from tools/)

   The Electron/Steam wrapper has no CDN and a double-clicked file:// has no origin, so every
   byte the page loads has to already be on disk. This harness is what stops that regressing.
   It exists because it already DID regress and nothing caught it: css/styles.css moved from
   Orbitron to Russo One, vendor/fonts.css was never regenerated, and because index.html still
   carried a Google Fonts <link> the game looked fine online while every offline build fell back
   to monospace on the dev overlays.

   Checks, in order:
     1  index.html loads nothing remote — no remote <link>, no remote <script src>, no
        <img>/preconnect/preload pointing off-machine. CDN URLs parked as the 2nd entry of a
        boot {srcs:[...]} are allowed: they document the pinned version and, with CDN_FALLBACK
        off, are never fetched.
     2  CDN_FALLBACK is false.
     3  every local path index.html references exists on disk.
     4  every @font-face url() in vendor/fonts.css + fonts/fonts.css resolves to a real file.
     5  every font family css/styles.css ASKS FOR has a local @font-face behind it.  <- the one
        that would have caught the Orbitron/Russo One drift.
     6  no remote url(), fetch() or XMLHttpRequest anywhere in css/ or js/.

   No dependencies. Exit code 0 = pass, 1 = fail.
   ========================================================================================== */
const fs=require('fs'),path=require('path');

/* Run from either the project root or tools/. */
const ROOT=fs.existsSync(path.join(process.cwd(),'index.html'))
 ?process.cwd():path.resolve(process.cwd(),'..');
const rel=p=>path.join(ROOT,p);
const read=p=>fs.readFileSync(rel(p),'utf8').replace(/^﻿/,'');   // vendor/fonts.css has a BOM

let pass=0,fails=[];
function ok(cond,msg){if(cond)pass++;else fails.push(msg);}
function section(t){console.log('\n── '+t);}

/* Strip /* *​/ and // comments so a URL mentioned in prose never fails a check. Deliberately
   crude — it does not respect strings — which is fine here: it only ever makes the scan
   quieter, and every real load path in this project is a bare literal. */
const decomment=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1')
                    .replace(/<!--[\s\S]*?-->/g,'');

const html=read('index.html');
const htmlNC=decomment(html);

/* ---- 1. index.html loads nothing remote ---------------------------------------------- */
section('1 · index.html has no remote load paths');
{
 /* The boot array's 2nd..nth srcs entries are documentation, not load paths (CDN_FALLBACK is
    asserted false in check 2). Blank them before scanning so they don't trip the sweep. */
 const scan=htmlNC.replace(/srcs:\s*\[([^\]]*)\]/g,(m,inner)=>{
  const parts=inner.split(',');
  return 'srcs:['+parts[0]+(parts.length>1?',/*pinned*/':'')+']';
 });
 const remote=[];
 const attr=/(?:href|src)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi;
 let m;while((m=attr.exec(scan)))remote.push(m[1]);
 ok(remote.length===0,'index.html still references remote URLs: '+remote.join(', '));
 console.log(remote.length?'   FAIL '+remote.join('\n        '):'   no remote href/src');
}

/* ---- 2. CDN_FALLBACK is off ----------------------------------------------------------- */
section('2 · CDN_FALLBACK is off');
{
 const m=/var\s+CDN_FALLBACK\s*=\s*(true|false)/.exec(htmlNC);
 ok(!!m,'CDN_FALLBACK is not declared in index.html');
 ok(m&&m[1]==='false','CDN_FALLBACK is '+(m&&m[1])+' — a packaged build must not reach a CDN');
 console.log('   CDN_FALLBACK = '+(m?m[1]:'MISSING'));
}

/* ---- 3. every local path index.html references exists --------------------------------- */
section('3 · local paths referenced by index.html exist');
{
 const refs=new Set();
 let m;
 const attr=/(?:href|src)\s*=\s*["']([^"']+)["']/gi;
 while((m=attr.exec(htmlNC))){const u=m[1];
  if(/^(https?:)?\/\/|^data:|^#|^mailto:/.test(u))continue;refs.add(u.replace(/^\//,''));}
 /* boot array: only the FIRST src of each entry is a load path */
 const boot=/var\s+boot\s*=\s*\[([\s\S]*?)\n\s*\];/.exec(htmlNC);
 ok(!!boot,'could not find the boot array in index.html');
 if(boot){
  const strings=boot[1].match(/'[^']+'/g)||[];
  const srcsFirst=[];
  const entries=boot[1].match(/srcs:\s*\[[^\]]*\]/g)||[];
  const pinned=new Set();
  for(const e of entries){const q=e.match(/'[^']+'/g)||[];q.slice(1).forEach(s=>pinned.add(s));}
  for(const s of strings){const v=s.slice(1,-1);
   if(pinned.has(s))continue;
   if(/^https?:/.test(v))continue;
   srcsFirst.push(v);}
  srcsFirst.forEach(v=>refs.add(v));
  console.log('   '+srcsFirst.length+' boot scripts');
 }
 const missing=[...refs].filter(r=>!fs.existsSync(rel(r)));
 ok(missing.length===0,'index.html references files that do not exist: '+missing.join(', '));
 console.log('   '+refs.size+' local refs, '+missing.length+' missing'+(missing.length?': '+missing.join(', '):''));
}

/* ---- 4. every @font-face url() resolves ----------------------------------------------- */
section('4 · @font-face files exist');
const FONT_CSS=['vendor/fonts.css','fonts/fonts.css'].filter(f=>fs.existsSync(rel(f)));
{
 ok(FONT_CSS.length>0,'no font stylesheets found (run tools/fetch-vendor.ps1)');
 let n=0,missing=[];
 for(const f of FONT_CSS){
  const dir=path.dirname(f),css=read(f);
  let m;const re=/url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  while((m=re.exec(css))){const u=m[1];
   if(/^(https?:)?\/\/|^data:/.test(u)){missing.push(f+' -> REMOTE '+u);continue;}
   n++;if(!fs.existsSync(rel(path.join(dir,u))))missing.push(f+' -> '+u);}
 }
 ok(missing.length===0,'font files missing or remote: '+missing.join(', '));
 console.log('   '+n+' font files referenced, '+missing.length+' bad'+(missing.length?':\n        '+missing.join('\n        '):''));
}

/* ---- 5. every family styles.css asks for is declared locally --------------------------- */
section('5 · every font family used has a local @font-face');
{
 const GENERIC=new Set(['sans-serif','serif','monospace','cursive','fantasy','system-ui',
  'ui-sans-serif','ui-serif','ui-monospace','ui-rounded','inherit','initial','unset','revert',
  '-apple-system','blinkmacsystemfont','arial','helvetica','segoe ui','roboto','tahoma','verdana']);
 const css=read('css/styles.css');
 /* Every declaration that can NAME a family: font-family, the font: shorthand, and the
    --font-* custom properties css/styles.css indirects through. Only QUOTED names are
    collected — an unquoted custom family would be missed, and the project has none. */
 const used=new Set();
 const decl=/(?:font-family|font|--font-[a-z-]+)\s*:\s*([^;}]+)/gi;
 let m;while((m=decl.exec(css))){
  const q=m[1].match(/'([^']+)'|"([^"]+)"/g)||[];
  for(const raw of q){const name=raw.slice(1,-1).trim();
   if(!GENERIC.has(name.toLowerCase()))used.add(name);}
 }
 const declared=new Set();
 for(const f of FONT_CSS){const c=read(f);let x;
  const re=/font-family\s*:\s*['"]([^'"]+)['"]/g;
  while((x=re.exec(c)))declared.add(x[1].trim());}
 const orphans=[...used].filter(u=>!declared.has(u));
 ok(orphans.length===0,
   'css/styles.css asks for '+orphans.map(o=>"'"+o+"'").join(', ')+
   ' but no local @font-face declares '+(orphans.length>1?'them':'it')+
   ' — offline this falls back to a system font. Fix: update $FontFamilies/$FontQuery in '+
   'tools/fetch-vendor.ps1 and re-run it.');
 const unused=[...declared].filter(d=>!used.has(d));
 console.log('   used:     '+[...used].sort().join(', '));
 console.log('   declared: '+[...declared].sort().join(', '));
 if(orphans.length)console.log('   FAIL orphaned: '+orphans.join(', '));
 if(unused.length)console.log('   note: declared but unused (dead weight in vendor/fonts/): '+unused.join(', '));
}

/* ---- 6. no remote fetches in css/ or js/ ----------------------------------------------- */
section('6 · no remote requests in css/ or js/');
{
 const files=[];
 for(const d of ['css','js']){const p=rel(d);if(!fs.existsSync(p))continue;
  for(const f of fs.readdirSync(p))if(/\.(js|css)$/.test(f))files.push(path.join(d,f));}
 const hits=[];
 for(const f of files){
  const src=decomment(read(f));
  let m;const re=/(?:url\(\s*['"]?|['"])((?:https?:)?\/\/[^'")\s]+)/g;
  while((m=re.exec(src)))hits.push(f+': '+m[1]);
  if(/\bfetch\s*\(\s*['"`]https?:/.test(src))hits.push(f+': fetch() to a remote URL');
  if(/\bXMLHttpRequest\b/.test(src)&&/https?:\/\//.test(src))hits.push(f+': XHR with a remote URL');
 }
 ok(hits.length===0,'remote requests found: '+hits.join(', '));
 console.log('   '+files.length+' files scanned, '+hits.length+' remote refs'+(hits.length?':\n        '+hits.join('\n        '):''));
}

/* ---- summary --------------------------------------------------------------------------- */
console.log('\n'+'─'.repeat(78));
if(fails.length){
 console.log('FAIL — '+pass+' assertions passed, '+fails.length+' failed:\n');
 fails.forEach((f,i)=>console.log('  '+(i+1)+'. '+f));
 console.log('');
 process.exit(1);
}
console.log('PASS — '+pass+' assertions. Fuzeball boots with no network access.\n');
