'use strict';
// node tools/fx-shots-save.js out.json <dir> [prefix]: writes the PNGs fx-shots.js returned, one per shot
const fs=require('fs'),path=require('path');
const [,,src,dir,prefix='fx']=process.argv;
const txt=fs.readFileSync(src,'utf8').trim().split('\n').pop();
const j=JSON.parse(txt);
fs.mkdirSync(dir,{recursive:true});
j.shots.forEach((u,i)=>{const f=path.join(dir,prefix+'_'+String(i).padStart(2,'0')+'.png');fs.writeFileSync(f,Buffer.from(u.split(',')[1],'base64'));console.log(f);});
console.log(JSON.stringify(j.info));
