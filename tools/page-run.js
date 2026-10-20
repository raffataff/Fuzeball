// page-run.js: run a browser-side soak from a terminal.
//      node tools/page-run.js tools/gkkick-soak.js "gkKick({seeds:120,diff:'pro'})"
//      node tools/page-run.js tools/gkkick-soak.js "gkKick({seeds:120})" js/ai.js=C:/somewhere/ai.old.js     // serve one file from elsewhere (an A/B against another version of it)
// serves the repo, opens it in headless Chrome or Edge (CHROME=path to pick one), skips the intro, stops the game's own rAF loop (the soaks step the sim by hand), evals the script and then the expression, prints its JSON
// the expression may return a promise; nothing else runs in the page, so a soak is deterministic per seed
//      --size=1920x1080 sets the page's viewport (default 1280x800); the page may POST a file to /__save/<path>, written under tools/build/
//      a page console line starting [run] is echoed to stderr (progress for long renders)
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),{spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),SAVE=path.join(ROOT,'tools','build');
const argv=process.argv.slice(2),flags={};
for(const a of argv.filter(a=>a.startsWith('--'))){const i=a.indexOf('=');flags[a.slice(2,i<0?a.length:i)]=i<0?true:a.slice(i+1);}
const [script,expr,...swaps]=argv.filter(a=>!a.startsWith('--'));
if(!script||!expr){console.error('usage: node tools/page-run.js [--size=WxH] <script.js> "<expression>" [served/path=local/file ...]');process.exit(2);}
const OV={};for(const kv of swaps){const i=kv.indexOf('=');OV[kv.slice(0,i)]=kv.slice(i+1);}
const [VW,VH]=String(flags.size||'1280x800').split('x').map(Number);
const CHROMES=[process.env.CHROME,
 'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean);
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ktx2':'image/ktx2','.glb':'model/gltf-binary','.wasm':'application/wasm','.ogg':'audio/ogg','.woff2':'font/woff2','.ttf':'font/ttf'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=http.createServer((q,r)=>{
 let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
 if(q.method==='POST'&&p.startsWith('/__save/')){
  const f=path.join(SAVE,path.normalize(p.slice(8)));
  if(!f.startsWith(SAVE+path.sep)){r.writeHead(403);r.end();return;}
  fs.mkdirSync(path.dirname(f),{recursive:true});
  const w=fs.createWriteStream(f);q.pipe(w);
  w.on('finish',()=>{r.writeHead(200);r.end('ok');});w.on('error',e=>{r.writeHead(500);r.end(String(e));});
  return;
 }
 const f=OV[p.slice(1)]||path.join(ROOT,path.normalize(p));
 if((!OV[p.slice(1)]&&!f.startsWith(ROOT))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);
});
(async()=>{
 const exe=CHROMES.find(p=>fs.existsSync(p));
 if(!exe){console.error('No Chrome or Edge found. Set CHROME to its executable.');process.exit(2);}
 await new Promise(res=>srv.listen(0,'127.0.0.1',res));
 const port=srv.address().port,dbg=9300+Math.floor(Math.random()*500),prof=path.join(os.tmpdir(),'fz-page-run-'+dbg);
 const ch=spawn(exe,['--headless=new','--remote-debugging-port='+dbg,'--user-data-dir='+prof,'--window-size='+VW+','+VH,'--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio','--no-first-run','about:blank'],{stdio:'ignore'});
 const done=c=>{try{ch.kill();}catch(e){}srv.close();try{fs.rmSync(prof,{recursive:true,force:true});}catch(e){}process.exit(c);};
 let t;for(let i=0;i<80&&!t;i++){try{t=(await (await fetch('http://127.0.0.1:'+dbg+'/json/list')).json()).find(x=>x.type==='page');}catch(e){}if(!t)await sleep(250);}
 if(!t){console.error('the browser never opened a debugging port');done(1);return;}
 const ws=new WebSocket(t.webSocketDebuggerUrl),pend={};let id=0;
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){d.error?pend[d.id].rej(new Error(d.error.message)):pend[d.id].res(d.result);delete pend[d.id];}
  else if(d.method==='Runtime.consoleAPICalled'){const a=d.params.args[0];if(a&&typeof a.value==='string'&&a.value.startsWith('[run]'))console.error(a.value.slice(6));}};
 const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend[i]={res,rej};ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
 const ev=async js=>{const r=await send('Runtime.evaluate',{expression:'(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));'+js+'})()',awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text);return r.result.value;};
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:VW,height:VH,deviceScaleFactor:1,mobile:false});
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
  for(let i=0;i<120;i++){await sleep(250);try{if(await ev(`return typeof introSkipHook!=='undefined'&&typeof startMatchNow==='function'&&document.readyState==='complete'`))break;}catch(e){}}
  await ev(`await wait(2500);if(introSkipHook)introSkipHook();await wait(1500);document.querySelectorAll('[id^=intro]').forEach(e=>e.remove());cfg.tutSeen=true;window.requestAnimationFrame=()=>0;await wait(300);`);
  await ev('(0,eval)('+JSON.stringify(fs.readFileSync(script,'utf8'))+');return 1');
  console.log(await ev('const r=await ('+expr+');return JSON.stringify(r)'));
  done(0);
 }catch(e){console.error('ERR',e.message);done(1);}
})();
