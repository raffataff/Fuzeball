// Sound Lab exports on disk: the venue map (tools/soundlab/map.json), WAV takes into assets/audio/, old takes to tools/build/sfx-backup/<stamp>-soundlab/, the manifest
// shared by tools/soundlab-server.js (the lab's Fuzeball panel) and tools/soundlab-render.mjs (headless re-render)
'use strict';
const fs=require('fs'),path=require('path');
const AM=require('../build_audio_manifest.js');
const ROOT=path.resolve(__dirname,'..','..'),AUD=path.join(ROOT,'assets','audio'),MAP=path.join(__dirname,'map.json'),BAK=path.join(ROOT,'tools','build','sfx-backup');
const EXT=/\.(ogg|opus|wav|mp3|m4a|flac|webm)$/i;
const KINDS=['tables','pitches','rooms','balls'];

function walk(d,out){if(!fs.existsSync(d))return out;
 for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name!=='music')walk(p,out);}else if(EXT.test(e.name))out.push(p);}return out;}
const rel=f=>path.relative(AUD,f).split(path.sep).join('/');

// venues = profile snapshots per venue, actions = per-sound settings (speed), exported = what was written and with which seed (a re-render repeats it)
function loadMap(){let m={};try{m=JSON.parse(fs.readFileSync(MAP,'utf8'));}catch(e){}
 m.v=1;m.venues=m.venues||{};for(const k of KINDS)m.venues[k]=m.venues[k]||{};m.actions=m.actions||{};m.exported=m.exported||{};return m;}
function saveMap(m){fs.writeFileSync(MAP,JSON.stringify(m,null,1)+'\n');}

function manifest(){const C=AM.loadConfig(),{sounds,bad}=AM.build(walk(AUD,[]).concat(walk(path.join(AUD,'music'),[])),C);
 fs.writeFileSync(path.join(AUD,'manifest.json'),JSON.stringify({v:1,note:'written by tools/build_audio_manifest.js, do not edit',sounds},null,1)+'\n');return {sounds,bad};}
function files(){const C=AM.loadConfig();return AM.build(walk(AUD,[]),C).sounds;}

// 16-bit PCM (plain WAVE_FORMAT_PCM, interleaved), TPDF dither seeded so a re-render writes the same bytes
function wav16(ch,sr,seed){const n=ch[0].length,c=ch.length,buf=Buffer.alloc(44+n*c*2);
 buf.write('RIFF',0);buf.writeUInt32LE(36+n*c*2,4);buf.write('WAVE',8);buf.write('fmt ',12);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(c,22);
 buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*c*2,28);buf.writeUInt16LE(c*2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*c*2,40);
 let s=(seed|0)||1,o=44;const r=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296-.5;};
 for(let i=0;i<n;i++)for(let k=0;k<c;k++){buf.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(ch[k][i]*32767+r()+r()))),o);o+=2;}
 return buf;}

// sets = [{file, sr, takes:[[Float32Array per channel]...]}]: each file id's old takes move to one backup folder, the new ones land in sfx/ (impulses in ir/), then one manifest
function writeSets(sets){const C=AM.loadConfig(),stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)+'-soundlab',B=path.join(BAK,stamp),out=[];
 for(const s of sets){const id=String(s.file||'').toLowerCase();
  if(!/^[a-z0-9_]+$/.test(id)||!AM.validId(id,C))throw new Error('"'+id+'" is not a sound id, venue variant or room impulse the game knows');
  if(!Array.isArray(s.takes)||!s.takes.length||s.takes.length>16)throw new Error(id+': no takes');}
 const all=walk(AUD,[]);
 for(const s of sets){const id=s.file.toLowerCase(),moved=[],wrote=[],ir=id.startsWith('ir_'),dir=path.join(AUD,ir?'ir':'sfx');
  for(const f of all)if(AM.idOf(f)===id&&fs.existsSync(f)){const d=path.join(B,rel(f));fs.mkdirSync(path.dirname(d),{recursive:true});fs.renameSync(f,d);moved.push(rel(f));}
  fs.mkdirSync(dir,{recursive:true});
  s.takes.forEach((ch,i)=>{const fn=ir&&s.takes.length===1?id+'.wav':id+'_'+String(i+1).padStart(2,'0')+'.wav';
   fs.writeFileSync(path.join(dir,fn),wav16(ch,s.sr||48000,(s.seed||1)*31+i));wrote.push(rel(path.join(dir,fn)));});
  out.push({file:id,wrote,moved});}
 const m=manifest();
 return {results:out,backup:out.some(r=>r.moved.length)?path.relative(ROOT,B).split(path.sep).join('/'):null,bad:m.bad};}

// file ids taken back out of the game (a venue goes back to the base sound): their takes move to a backup, then one manifest
function removeSets(ids){const C=AM.loadConfig(),stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)+'-soundlab',B=path.join(BAK,stamp),moved=[];
 for(const id of ids)if(!/^[a-z0-9_]+$/.test(id)||!AM.validId(id,C))throw new Error('"'+id+'" is not a sound id the game knows');
 for(const f of walk(AUD,[]))if(ids.includes(AM.idOf(f))){const d=path.join(B,rel(f));fs.mkdirSync(path.dirname(d),{recursive:true});fs.renameSync(f,d);moved.push(rel(f));}
 manifest();return {moved,backup:moved.length?path.relative(ROOT,B).split(path.sep).join('/'):null};}

module.exports={ROOT,AUD,KINDS,loadMap,saveMap,manifest,files,wav16,writeSets,removeSets};
