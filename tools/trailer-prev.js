// trailer-prev: contact sheets of candidate moments, one fresh page per job
//   node tools/trailer-prev.js tools/build/trailer/prev_jobs.json [name ...]
// a job: {name, take, at:[D...] | from,to,n, cams:[shot...], set:{...}, post:{...}, size:'1280x720', cols, ss}
// sets merge over tools/build/trailer/hq.json; sheets land in tools/build/trailer/prev/<name>.jpg
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const R=path.resolve(__dirname,'..'),B=path.join(R,'tools','build');
const [file,...only]=process.argv.slice(2);
const jobs=JSON.parse(fs.readFileSync(file,'utf8')).jobs,hq=JSON.parse(fs.readFileSync(path.join(B,'trailer','hq.json'),'utf8'));
fs.mkdirSync(path.join(B,'trailer','prev'),{recursive:true});
for(const j of jobs){
 if(only.length&&!only.includes(j.name))continue;
 const at=j.at||Array.from({length:j.n||8},(_,i)=>+(j.from+(j.to-j.from)*i/Math.max(1,(j.n||8)-1)).toFixed(4));
 const o={take:j.take,at,cams:j.cams,cols:j.cols||Math.min(4,at.length*j.cams.length),tw:j.tw||480,set:Object.assign({},hq,j.set||{}),ss:j.ss||1,post:j.post,cfg:j.cfg,fx:j.fx};
 const t0=Date.now();
 const r=spawnSync(process.execPath,[path.join(__dirname,'page-run.js'),'--size='+(j.size||'1280x720'),path.join(__dirname,'director.js'),'dirStills('+JSON.stringify(o)+')'],{encoding:'utf8',maxBuffer:64<<20});
 const out=(r.stdout||'').trim().split('\n').pop();
 if(r.status!==0||!out.startsWith('{')){console.log(j.name,'FAILED',(r.stderr||'').split('\n').filter(l=>/ERR/.test(l)).join(' '));continue;}
 const res=JSON.parse(out);
 fs.copyFileSync(path.join(R,res.sheet),path.join(B,'trailer','prev',j.name+'.jpg'));
 console.log(j.name,'ok',((Date.now()-t0)/1000).toFixed(0)+'s','desync',res.desync);
}
