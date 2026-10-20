// SFX Lab server: serves the repo and lets tools/sfx/ save kits and export takes into assets/audio. node tools/sfx-server.js [port]
// then open http://localhost:8124/tools/sfx/ ; local only (127.0.0.1). An export moves the id's old takes to tools/build/sfx-backup/<stamp>/ first, then rebuilds the manifest
'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const AM=require('./build_audio_manifest.js');
const ROOT=path.resolve(__dirname,'..'),AUD=path.join(ROOT,'assets','audio'),KITS=path.join(__dirname,'sfx','kits'),BAK=path.join(__dirname,'build','sfx-backup');
const PORT=+process.argv[2]||8124;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg',
 '.ttf':'font/ttf','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
const EXT=/\.(ogg|opus|wav|mp3|m4a|flac|webm)$/i;

function walk(d,out){if(!fs.existsSync(d))return out;
 for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else if(EXT.test(e.name))out.push(p);}return out;}
function manifest(){const C=AM.loadConfig(),{sounds,bad}=AM.build(walk(AUD,[]),C);
 fs.writeFileSync(path.join(AUD,'manifest.json'),JSON.stringify({v:1,note:'written by tools/build_audio_manifest.js, do not edit',sounds},null,1)+'\n');return {sounds,bad};}
const safe=s=>String(s||'').replace(/[^a-z0-9_\- ]/gi,'').trim().slice(0,60);
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const body=req=>new Promise((ok,no)=>{const b=[];let n=0;req.on('data',c=>{n+=c.length;if(n>64e6){no(new Error('too big'));req.destroy();}else b.push(c);});req.on('end',()=>ok(Buffer.concat(b)));req.on('error',no);});

async function api(req,res,p){
 if(p==='/__sfx/ping')return send(res,200,{ok:true});
 if(p==='/__sfx/ids'){const C=AM.loadConfig(),S=C.audioMix.sounds,{sounds}=AM.build(walk(AUD,[]),C);
  return send(res,200,{ids:Object.keys(S).map(id=>({id,bus:S[id].bus||'fx',syn:S[id].syn!==false,files:sounds[id]||[]}))});}
 if(p==='/__sfx/kits'){fs.mkdirSync(KITS,{recursive:true});return send(res,200,{kits:fs.readdirSync(KITS).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5))});}
 if(req.method==='POST'&&p.startsWith('/__sfx/kit/')){const n=safe(decodeURIComponent(p.slice(11)));if(!n)return send(res,400,{err:'bad name'});
  const j=JSON.parse((await body(req)).toString('utf8'));fs.mkdirSync(KITS,{recursive:true});
  fs.writeFileSync(path.join(KITS,n+'.json'),JSON.stringify(j,null,1)+'\n');return send(res,200,{ok:true,name:n});}
 if(req.method==='POST'&&p==='/__sfx/export'){const j=JSON.parse((await body(req)).toString('utf8')),id=String(j.id||'').toLowerCase(),C=AM.loadConfig();
  if(!/^[a-z0-9_]+$/.test(id)||!AM.validId(id,C))return send(res,400,{err:'"'+id+'" is not a sound id in CONFIG.audioMix.sounds (download the WAV instead)'});
  if(!Array.isArray(j.files)||!j.files.length||j.files.length>12)return send(res,400,{err:'no takes'});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),moved=[];
  for(const f of walk(AUD,[]))if(AM.idOf(f)===id){const rel=path.relative(AUD,f),dst=path.join(BAK,stamp,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.renameSync(f,dst);moved.push(rel.split(path.sep).join('/'));}
  const sub=path.join(AUD,id.startsWith('ui_')?'ui':'sfx');fs.mkdirSync(sub,{recursive:true});const wrote=[];
  j.files.forEach((b64,i)=>{const fn=id+'_'+String(i+1).padStart(2,'0')+'.wav';fs.writeFileSync(path.join(sub,fn),Buffer.from(b64,'base64'));wrote.push(path.relative(AUD,path.join(sub,fn)).split(path.sep).join('/'));});
  const m=manifest();return send(res,200,{ok:true,wrote,moved,backup:moved.length?path.relative(ROOT,path.join(BAK,stamp)).split(path.sep).join('/'):null,takes:(m.sounds[id]||[]).length});}
 return send(res,404,{err:'no such call'});}

http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://x'),p=decodeURIComponent(u.pathname);
 if(p.startsWith('/__sfx/'))return await api(req,res,p);
 if(p==='/'){res.writeHead(302,{Location:'/tools/sfx/'});return res.end();}
 let f=path.join(ROOT,p);if(!f.startsWith(ROOT))return send(res,403,{err:'no'});
 if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');
 if(!fs.existsSync(f))return send(res,404,{err:'not found'});
 res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);
}catch(e){send(res,500,{err:String(e&&e.message||e)});}}).listen(PORT,'127.0.0.1',()=>console.log('SFX Lab: http://localhost:'+PORT+'/tools/sfx/'));
