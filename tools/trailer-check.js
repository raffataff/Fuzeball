// trailer-check: finds failed renders in the edit's strips (a JPEG far smaller than its neighbours is a black or blank frame)
//   node tools/trailer-check.js            lists the strips with suspicious frames; exit 1 if any
'use strict';
const fs=require('fs'),path=require('path');
const R=path.resolve(__dirname,'..'),E=JSON.parse(fs.readFileSync(path.join(R,'tools','build','trailer','edl.json'),'utf8'));
const bad=new Set();
for(const s of E.strips){
 const sz=[];for(let i=0;i<s.len;i++){const f=path.join(R,s.dir,'frame_'+String(s.first+i).padStart(5,'0')+'.jpg');sz.push(fs.existsSync(f)?fs.statSync(f).size:0);}
 const med=sz.slice().sort((a,b)=>a-b)[sz.length>>1];
 const low=sz.map((v,i)=>[v,i]).filter(([v])=>v<Math.max(60000,med*0.25));
 if(low.length){bad.add(s.id.replace(/_\d\d$/,''));console.log(s.id,'suspicious frames',low.length,'of',s.len,'(median',med,'bytes; e.g. frame',s.first+low[0][1],low[0][0],'bytes)');}
}
console.log(bad.size?'re-render: '+[...bad].join(' '):'all strips look rendered');
process.exit(bad.size?1:0);
