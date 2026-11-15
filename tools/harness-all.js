'use strict';
// runs every tools/*-harness.js, writes each output + a summary (exit code, fail lines) to the out dir
// node tools/harness-all.js <outDir> [filter]
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const out=process.argv[2]||'tools/build/harness-run',flt=process.argv[3]||'';
fs.mkdirSync(out,{recursive:true});
const hs=fs.readdirSync('tools').filter(f=>f.endsWith('-harness.js')&&f.includes(flt)).sort();
const sum=[];
for(const h of hs){
 const t0=Date.now(),r=spawnSync(process.execPath,['tools/'+h],{encoding:'utf8',timeout:600000,maxBuffer:64<<20});
 const txt=(r.stdout||'')+(r.stderr||'');
 fs.writeFileSync(path.join(out,h.replace('.js','.txt')),txt);
 const fails=txt.split(/\r?\n/).filter(l=>/\b(FAIL|NOT CAUGHT|not caught|Error|✗)\b/.test(l)).length;
 const tail=txt.trim().split(/\r?\n/).slice(-1)[0]||'';
 sum.push({h,code:r.status,ms:Date.now()-t0,fails,tail:tail.slice(0,160)});
 console.log((r.status===0?'ok  ':'RED ')+h.padEnd(34)+String(fails).padStart(4)+'  '+tail.slice(0,100));
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(sum,null,1));
console.log(sum.filter(s=>s.code!==0).length+' red of '+sum.length);
