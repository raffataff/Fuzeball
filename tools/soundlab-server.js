// Sound Lab bridge: serves the Foosball Sound Lab with its Fuzeball panel switched on, and writes what it exports into the game. node tools/soundlab-server.js [--port=8125] [--lab=<path>] [--no-build]
// then open http://localhost:8125 ; local only (127.0.0.1). The lab lives outside the repo (Documents/Fuzeball files/foosball-sound-lab); its build is refreshed on start when src/ is newer
// the panel reads /__fz/catalog (what to render, from CONFIG and tools/soundlab/spec.js), saves the venue map to tools/soundlab/map.json and posts takes to /__fz/export (tools/soundlab/io.js)
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),{execFileSync}=require('child_process'),{pathToFileURL}=require('url');
const AM=require('./build_audio_manifest.js'),SP=require('./soundlab/spec.js'),IO=require('./soundlab/io.js');
const arg=k=>{const a=process.argv.find(s=>s.startsWith('--'+k));return a?(a.includes('=')?a.slice(a.indexOf('=')+1):true):null;};
const PORT=+arg('port')||8125,LAB=path.resolve(arg('lab')||path.join(IO.ROOT,'..','..','Fuzeball files','foosball-sound-lab')),HTML=path.join(LAB,'dist','foosball-sound-lab.html');
const MIME={'.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg','.json':'application/json'};

// rebuild the lab when any of its sources is newer than the built page
function newest(d){let t=0;if(!fs.existsSync(d))return t;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);t=Math.max(t,e.isDirectory()?newest(p):fs.statSync(p).mtimeMs);}return t;}
function build(){if(arg('no-build'))return;
 if(!fs.existsSync(path.join(LAB,'tools','build.mjs'))){console.error('no Sound Lab at '+LAB+' (pass --lab=<path>)');process.exit(1);}
 if(fs.existsSync(HTML)&&fs.statSync(HTML).mtimeMs>=newest(path.join(LAB,'src')))return;
 console.log('building the Sound Lab…');execFileSync(process.execPath,[path.join(LAB,'tools','build.mjs')],{cwd:LAB,stdio:'inherit'});}

const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const body=req=>new Promise((ok,no)=>{const b=[];let n=0;req.on('data',c=>{n+=c.length;if(n>256e6){no(new Error('too big'));req.destroy();}else b.push(c);});req.on('end',()=>ok(Buffer.concat(b)));req.on('error',no);});
const f32=b64=>{const b=Buffer.from(b64,'base64');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));};
// the lab's takes.js, for room impulses: the panel's come at the ceiling, the game wants them at the lab's level (spec.js irTake)
let TK=null;const takesMod=()=>TK||(TK=import(pathToFileURL(path.join(LAB,'src','audio','takes.js')).href));

async function api(req,res,p){
 if(p==='/__fz/catalog'){const C=AM.loadConfig();
  return send(res,200,{ok:true,game:'Fuzeball',root:IO.ROOT,specs:SP.specs(C),mix:{gain:SP.MIX_GAIN},base:SP.BASE,venues:SP.venues(C),map:IO.loadMap(),files:IO.files()});}
 if(req.method==='POST'&&p==='/__fz/map'){const j=JSON.parse((await body(req)).toString('utf8')),m=IO.loadMap();
  for(const k of IO.KINDS)if(j.venues&&j.venues[k]&&typeof j.venues[k]==='object')m.venues[k]=j.venues[k];
  if(j.actions&&typeof j.actions==='object')m.actions=j.actions;
  IO.saveMap(m);return send(res,200,{ok:true});}
 // {sets:[{file, sr, seed, speed, from, takes:[[base64 Float32 per channel]...]}]}: written, then recorded in the map so a re-render repeats them
 if(req.method==='POST'&&p==='/__fz/export'){const j=JSON.parse((await body(req)).toString('utf8'));
  const sets=(j.sets||[]).map(s=>({file:s.file,sr:s.sr,seed:s.seed,takes:(s.takes||[]).map(t=>t.map(f32))})),m=IO.loadMap(),at=new Date().toISOString();
  for(const s of sets){const id=String(s.file||'').toLowerCase();
   if(id.startsWith('ir_')){const T=await takesMod();s.takes=[SP.irTake(T,{base:SP.BASE,venues:m.venues},id.slice(3),s.seed).channels];s.sr=T.TAKE_SR;}}
  let r;try{r=IO.writeSets(sets);}catch(e){return send(res,400,{err:e.message});}
  for(const s of j.sets)m.exported[s.file.toLowerCase()]={seed:s.seed|0,speed:+s.speed||1,takes:s.takes.length,from:s.from||null,at};
  IO.saveMap(m);return send(res,200,{ok:true,...r,files:IO.files()});}
 // {files:[ids]}: taken out of the game and the map
 if(req.method==='POST'&&p==='/__fz/remove'){const j=JSON.parse((await body(req)).toString('utf8')),ids=(j.files||[]).map(s=>String(s).toLowerCase());
  let r;try{r=IO.removeSets(ids);}catch(e){return send(res,400,{err:e.message});}
  const m=IO.loadMap();for(const id of ids)delete m.exported[id];IO.saveMap(m);return send(res,200,{ok:true,...r,files:IO.files()});}
 return send(res,404,{err:'no such call'});}

build();
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://x'),p=decodeURIComponent(u.pathname);
 if(p.startsWith('/__fz/'))return await api(req,res,p);
 if(p==='/'||p==='/index.html'){if(!fs.existsSync(HTML))return send(res,503,{err:'the Sound Lab is not built: run npm run build in '+LAB});
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return fs.createReadStream(HTML).pipe(res);}
 // the game's own takes, so the panel can play what is in the game now
 if(p.startsWith('/assets/audio/')){const f=path.join(IO.AUD,p.slice('/assets/audio/'.length));
  if(!f.startsWith(IO.AUD)||!fs.existsSync(f)||!fs.statSync(f).isFile())return send(res,404,{err:'not found'});
  res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});return fs.createReadStream(f).pipe(res);}
 return send(res,404,{err:'not found'});
}catch(e){send(res,500,{err:String(e&&e.message||e)});}}).listen(PORT,'127.0.0.1',()=>console.log('Sound Lab for Fuzeball: http://localhost:'+PORT+'  (lab: '+LAB+')'));
