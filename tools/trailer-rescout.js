// trailer-rescout: scout takes again with the current director (rod tracks etc.), checking the sim did not change
//   node tools/trailer-rescout.js L101 R201 ...
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const D=path.join(__dirname,'build','director');
for(const tk of process.argv.slice(2)){
 const f=path.join(D,tk,'scout.json'),old=JSON.parse(fs.readFileSync(f,'utf8'));
 const expr='dirScout('+JSON.stringify({take:tk,seed:old.seed,secs:old.secs,set:old.set,cfg:old.cfg||{}})+')';
 const r=spawnSync(process.execPath,[path.join(__dirname,'page-run.js'),'--size=960x540',path.join(__dirname,'director.js'),expr],{encoding:'utf8',maxBuffer:64<<20});
 const nu=JSON.parse(fs.readFileSync(f,'utf8'));
 let bad=0;for(let i=0;i<Math.min(old.chk.length,nu.chk.length);i++)if(old.chk[i][1]!==nu.chk[i][1]){bad=old.chk[i][0];break;}
 console.log(tk,r.status===0?'ok':'FAILED',nu.rods?'rods':'no rods','diverge',bad?(bad/960).toFixed(2)+'s':'none');
}
