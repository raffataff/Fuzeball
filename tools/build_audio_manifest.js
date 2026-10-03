// Writes assets/audio/manifest.json, the index js/audio.js reads to find recorded takes (a browser can't list a folder).
// Run after adding, renaming or removing a sound:  node tools/build_audio_manifest.js
// naming: <id>_01.ogg, <id>_02.ogg ... or <id>.ogg, anywhere under assets/audio/ (subfolders are only for you); the id is the file name minus its take number and must be:
//   - a sound in CONFIG.audioMix.sounds                          ball_kick_03.ogg
//   - a variant: <id>_hard, or <id>_<ballType>                   ball_kick_hard_01.ogg, ball_wall_fire.ogg
//   - a room impulse: ir_<roomId>                                ir_pub.wav
// anything else is reported and left out (a typo can't ship a sound nobody hears); ship .ogg (Vorbis), .wav/.flac/.mp3/.m4a/.opus/.webm decode too
// then prints every sound's state: recorded (n takes), synthesized (a stand-in plays) or SILENT (recorded-only, no file yet), the to-do list for a session
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const DIR=path.join(ROOT,'assets','audio');
const OUT=path.join(DIR,'manifest.json');
const EXT=/\.(ogg|opus|wav|mp3|m4a|flac|webm)$/i;

/* The real CONFIG, not a copy: sound ids, ball types and rooms come from the game itself. */
function loadConfig(){
 const ctx={console,Math,Date,JSON,Object,Array,isFinite,isNaN};ctx.globalThis=ctx;vm.createContext(ctx);
 for(const f of ['js/core.js','js/config.js'])
  new vm.Script(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}).runInContext(ctx);
 return vm.runInContext('CONFIG',ctx);
}
// ball_kick_02.ogg → ball_kick ; ui_move.wav → ui_move ; Crowd_Roar_1.OGG → crowd_roar
function idOf(file){return path.basename(file).replace(EXT,'').toLowerCase().replace(/_\d+$/,'');}
function validId(id,C){
 const S=C.audioMix.sounds;if(S[id])return true;
 const m=/^ir_(.+)$/.exec(id);if(m)return!!C.rooms[m[1]];
 for(const base in S)if(id.startsWith(base+'_')){const v=id.slice(base.length+1);if(v==='hard'||C.ballTypes[v])return true;}
 return false;
}
function walk(d,out){
 if(!fs.existsSync(d))return out;
 for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,out);else if(EXT.test(e.name))out.push(p);}
 return out;
}
/* files: absolute paths. Returns {sounds:{id:[relative paths, sorted]}, bad:[relative paths]}. */
function build(files,C){
 const sounds={},bad=[];
 for(const f of files){const rel=path.relative(DIR,f).split(path.sep).join('/'),id=idOf(f);
  if(!validId(id,C)){bad.push(rel);continue;}
  (sounds[id]=sounds[id]||[]).push(rel);}
 const sorted={};for(const id of Object.keys(sounds).sort())sorted[id]=sounds[id].sort();
 return {sounds:sorted,bad};
}

if(require.main===module){
 const C=loadConfig();
 fs.mkdirSync(DIR,{recursive:true});
 const {sounds,bad}=build(walk(DIR,[]),C);
 fs.writeFileSync(OUT,JSON.stringify({v:1,note:'written by tools/build_audio_manifest.js, do not edit',sounds},null,1)+'\n');
 const S=C.audioMix.sounds,pad=(s,n)=>(s+' '.repeat(n)).slice(0,n);
 console.log('\nassets/audio/manifest.json  ('+Object.keys(sounds).length+' ids, '+Object.values(sounds).reduce((a,b)=>a+b.length,0)+' files)\n');
 let rec=0,syn=0,sil=0;
 for(const id in S){const n=(sounds[id]||[]).length,
   extra=Object.keys(sounds).filter(k=>k!==id&&k.startsWith(id+'_')).map(k=>k.slice(id.length+1)+'×'+sounds[k].length);
  const st=n?'recorded   '+n+' take'+(n>1?'s':''):S[id].syn===false?'SILENT     no file yet':'synthesized';
  if(n)rec++;else if(S[id].syn===false)sil++;else syn++;
  console.log('  '+pad(id,18)+st+(extra.length?'   + '+extra.join(', '):''));}
 const irs=Object.keys(sounds).filter(k=>k.startsWith('ir_'));
 if(irs.length)console.log('\n  room impulses: '+irs.join(', '));
 console.log('\n  '+rec+' recorded · '+syn+' synthesized · '+sil+' silent');
 if(bad.length){console.log('\n  NOT a sound id, left out (check the name against CONFIG.audioMix.sounds):');for(const b of bad)console.log('    '+b);}
 console.log('');
}
module.exports={idOf,validId,build,loadConfig};
