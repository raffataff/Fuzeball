/* menu-shots.js — screenshot every menu screen at a fixed size and report anything that scrolls.
     node tools/menu-shots.js                    every screen at 1280x800 (the Steam Deck)
     node tools/menu-shots.js league options     only steps whose name contains one of the words
     node tools/menu-shots.js --size=1920x1080   another window size

   Writes to tools/build/menu-shots/ (gitignored): one PNG per screen, contact-sheet.jpg (all of them on
   one page) and notes.txt. Exit 1 if any screen, or any box on it, overflows at that size: since
   2026-09-28 no menu screen scrolls at 1280x800, and this is how that stays true.

   Needs Chrome or Edge installed (set CHROME=path to pick one); nothing to npm install. It serves the
   repo itself on a free port, runs the browser headless at device scale 1 with a FRESH profile each
   run (so a first-run save, with no layouts), drives the screens through their own functions, and
   builds a league with three rounds played so the Season tab has standings and a last round.
   The cup is drawn straight away (cupCreate) rather than after a played season.
   Not covered: pause / win overlays, the match HUD. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process'),{pathToFileURL}=require('url');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'tools','build','menu-shots');
const args=process.argv.slice(2),sz=(args.find(a=>a.startsWith('--size='))||'--size=1280x800').slice(7).split('x').map(Number);
const W=sz[0],H=sz[1],only=args.filter(a=>!a.startsWith('--'));
const CHROMES=[process.env.CHROME,
 'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean);
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ktx2':'image/ktx2',
 '.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.wasm':'application/wasm',
 '.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.hdr':'application/octet-stream'};

/* Each step runs in the page and must stand on its own (a filtered run skips the ones before it). */
const LEAGUE=`if(typeof LG==='undefined'||!LG||!LG.teams){openSetup(0);$('lgSetupCreate').click();await wait(500);
 for(let i=0;i<3;i++){S.lg={};S.score=[i+2,1];lgRecord();}S.lg=null;}
 openLeague();await wait(8000);`;                       // the lobby stages its venue behind a veil
/* A fresh league in slot 5 starting in division `div`, every round played with `win(round)` deciding the
   player's result (the rest of the table is simulated as normal). `second` hands the best other club
   100 points before the last round, so a perfect season finishes 2nd. Ends on the season-end screen. */
const seasonEnd=(div,win,second)=>`hideScreens();
 lgNewSeason(false,{name:'SEASON TEST',teamName:'TEAM 1',teamCol:'#d0142c',model:CONFIG.playerModel.models[0].id,
  startDiv:${div},goals:5,gameTime:0,special:true,power:true,control:''},5);
 const n=LG.divs[playerDiv()].fixtures.length,w=${win};
 for(let r=0;r<n;r++){
  if(${second}&&r===n-1)lgOrderDiv(playerDiv()).find(e=>e.i!==LG.playerId).t.p+=100;
  S.lg={};S.score=w(r)?[5,1]:[1,5];lgRecord();}
 S.lg=null;showSeasonEnd();await wait(2500);`;
const STEPS=[
 ['01-home',`showScreen('home')`],
 ['02-kickoff-team',`showScreen('menu');menuSetTab('team')`],
 ['03-kickoff-rules',`showScreen('menu');menuSetTab('rules')`],
 ['04-customize',`openCustomize(0)`],
 ['05-options-display',`openOptions('home');optSetTab('display')`],
 ['06-options-audio',`openOptions('home');optSetTab('audio')`],
 ['07-options-controller',`openOptions('home');optSetTab('controls')`],
 ['08-options-kbm',`openOptions('home');optSetTab('kbm')`],
 ['09-training',`showScreen('training')`],
 ['10-trials',`showScreen('trials')`],
 ['11-daily',`showScreen('daily')`],
 ['12-tutorial',`tutOpen('training')`],
 ['13-league-slots',`openSlots()`],
 ['14-league-setup',`openSetup(0)`],
 ['15-league-season',LEAGUE+`lgSetTab('season')`],
 ['16-league-squad',LEAGUE+`lgSetTab('squad')`],
 ['17-league-club',LEAGUE+`lgSetTab('club')`],
 // a cup drawn straight away (cupCreate) rather than after a played season
 ['18-cup',LEAGUE+`if(!LG.cup||LG.cup.season!==LG.season)cupCreate();openCup();await wait(6000);cupSetTab('cup')`],
 ['19-cup-squad',LEAGUE+`if(!LG.cup||LG.cup.season!==LG.season)cupCreate();openCup();await wait(6000);cupSetTab('squad')`],
 ['20-cup-club',LEAGUE+`if(!LG.cup||LG.cup.season!==LG.season)cupCreate();openCup();await wait(6000);cupSetTab('club')`],
 // End of season, one per fate: a whole season played from a division with scripted results.
 ['21-season-premier-champion',seasonEnd(2,'r=>true',false)],
 ['22-season-premier-second',seasonEnd(2,'r=>true',true)],      // runner-up: a cup place, no title
 ['23-season-premier-relegated',seasonEnd(2,'r=>false',false)],
 ['24-season-pro-champion',seasonEnd(1,'r=>true',false)],        // champions AND promoted, with the stat gains
 ['25-season-pro-relegated',seasonEnd(1,'r=>false',false)],      // relegated, with the stat losses
 ['26-season-sunday-stayed',seasonEnd(0,'r=>r%2===0',false)],
 // the layout editor open on Kick Off, with one own preset saved: the bar has to fit at this width
 ['27-layout-editor',`showScreen('menu');menuSetTab('team');await wait(300);layEditStart('menu');await wait(400);
  const t=$('menuTeamPanel');t.style.top=(parseFloat(t.style.top)+32)+'px';laySave('menu');laySavePreset()`],
];
/* Every scrollable box on the live screen whose content is bigger than it, and the screen itself; with
   the layout editor open, only that its bar fits the window. */
const AUDIT=`const o=[],on=e=>e.getClientRects().length,sc=v=>v==='auto'||v==='scroll';
 const bar=document.getElementById('lyBar');if(bar){const r=bar.getBoundingClientRect();if(r.left<0||r.right>innerWidth)o.push('#lyBar is wider than the window: '+Math.round(r.width));}
 for(const s of document.querySelectorAll('.screen')){if(s.classList.contains('hidden')||!on(s))continue;
  if(s.querySelector('.lyEditing'))continue;   // the edit canvas grows a drop zone under the panels on purpose
  for(const e of [s,...s.querySelectorAll('*')]){if(!on(e))continue;const cs=getComputedStyle(e),n=(e.id?'#'+e.id:'.'+String(e.className).split(' ')[0]);
   if(sc(cs.overflowY)&&e.scrollHeight>e.clientHeight+1)o.push(n+' scrolls down: '+e.clientHeight+' / '+e.scrollHeight);
   if(sc(cs.overflowX)&&e.scrollWidth>e.clientWidth+1&&e.id!=='czStrip')o.push(n+' scrolls sideways: '+e.clientWidth+' / '+e.scrollWidth);}}
 return o;`;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){
 const srv=http.createServer((q,r)=>{
  let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  const f=path.join(ROOT,path.normalize(p));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(f).pipe(r);
 });
 return new Promise(res=>srv.listen(0,'127.0.0.1',()=>res(srv)));
}
/* The smallest CDP client that works: one page target, request/response by id. */
async function cdp(port){
 let t;for(let i=0;i<80&&!t;i++){try{t=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page');}catch(e){}if(!t)await sleep(250);}
 if(!t)throw new Error('the browser never opened a debugging port');
 const ws=new WebSocket(t.webSocketDebuggerUrl),pend={};let id=0;
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){d.error?pend[d.id].rej(new Error(d.error.message)):pend[d.id].res(d.result);delete pend[d.id];}};
 const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend[i]={res,rej};ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
 const ev=async js=>{const r=await send('Runtime.evaluate',{expression:'(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));'+js+'})()',awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text);return r.result.value;};
 const shot=async(file,fmt)=>{const r=await send('Page.captureScreenshot',fmt==='jpeg'?{format:'jpeg',quality:82}:{format:'png'});fs.writeFileSync(file,Buffer.from(r.data,'base64'));};
 return {send,ev,shot,close:()=>ws.close()};
}

(async()=>{
 const exe=CHROMES.find(p=>fs.existsSync(p));
 if(!exe){console.error('No Chrome or Edge found. Set CHROME to its executable.');process.exit(2);}
 fs.mkdirSync(OUT,{recursive:true});
 for(const f of fs.readdirSync(OUT))if(/\.(png|jpg|txt|html)$/.test(f))fs.unlinkSync(path.join(OUT,f));
 const prof=path.join(OUT,'profile');fs.rmSync(prof,{recursive:true,force:true});
 const srv=await serve(),port=srv.address().port,dbg=9300+Math.floor(Math.random()*500);
 const ch=spawn(exe,['--headless=new','--remote-debugging-port='+dbg,'--user-data-dir='+prof,'--window-size='+W+','+H,
  '--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--mute-audio','--no-first-run','about:blank'],{stdio:'ignore'});
 let c;const done=code=>{try{c&&c.close();}catch(e){}ch.kill();srv.close();process.exit(code);};
 try{
  c=await cdp(dbg);
  await c.send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
  await c.send('Page.enable');await c.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'});
  for(let i=0;i<120;i++){await sleep(250);try{if(await c.ev(`return typeof introSkipHook!=='undefined'&&typeof showScreen==='function'&&document.readyState==='complete'`))break;}catch(e){}}
  // skip the intro, and don't let the one-time tutorial offer stand in front of Kick Off / League
  await c.ev(`await wait(3000);if(introSkipHook)introSkipHook();await wait(2500);
   document.querySelectorAll('[id^=intro]').forEach(e=>e.remove());cfg.tutSeen=true;`);
  const notes=[],shots=[];let bad=0;
  for(const [name,js] of STEPS){
   if(only.length&&!only.some(o=>name.includes(o)))continue;
   let err='';try{await c.ev(js);}catch(e){err=e.message.split('\n')[0];}
   await sleep(2000);
   const file=path.join(OUT,name+'.png');await c.shot(file);shots.push(name);
   const a=err?[]:await c.ev(AUDIT);if(a.length||err)bad++;
   notes.push(name+(err?'  ERROR '+err:'')+(a.length?'\n  '+a.join('\n  '):'')+(a.length||err?'':'  ok'));
   console.log(notes[notes.length-1]);
  }
  fs.writeFileSync(path.join(OUT,'notes.txt'),notes.join('\n')+'\n');
  // one page with every shot on it, three across
  const cols=3,cw=800,ch2=Math.round(cw*H/W);
  fs.writeFileSync(path.join(OUT,'sheet.html'),'<!doctype html><body style="margin:0;background:#0b111a;font:600 20px sans-serif;color:#cfe0f5"><div style="display:grid;grid-template-columns:repeat('+cols+','+cw+'px);gap:18px;padding:18px">'
   +shots.map(n=>'<div><div style="padding:0 0 6px">'+n+'</div><img src="'+n+'.png" width="'+cw+'" height="'+ch2+'" style="display:block;border:1px solid #2a3a50"></div>').join('')+'</div></body>');
  const sw=cols*cw+(cols+1)*18,sh=Math.ceil(shots.length/cols)*(ch2+44)+18;
  await c.send('Emulation.setDeviceMetricsOverride',{width:sw,height:sh,deviceScaleFactor:1,mobile:false});
  await c.send('Page.navigate',{url:pathToFileURL(path.join(OUT,'sheet.html')).href});await sleep(2500);
  await c.shot(path.join(OUT,'contact-sheet.jpg'),'jpeg');
  console.log('\n'+shots.length+' screens at '+W+'x'+H+' → '+path.relative(ROOT,OUT)+(bad?'   '+bad+' with overflow or errors':'   nothing scrolls'));
  done(bad?1:0);
 }catch(e){console.error(e);done(2);}
})();
