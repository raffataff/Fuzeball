// trailer-build: renders the shots of tools/trailer-spec.js and writes the edit list for tools/trailer-edit.py
//   node tools/trailer-build.js render [id ...] [--draft] [--par=2]   frames into tools/build/director/<take>/<id>/ (draft: <id>_d, 960x540, a contact sheet)
//   node tools/trailer-build.js edl                                   tools/build/trailer/edl.json (strips, cards, sound cues)
//   node tools/trailer-build.js list                                  the timeline, shot by shot
// a page renders one take with one look; a shot with variants is one page per variant, each saving only its own beats
'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const R=path.resolve(__dirname,'..'),B=path.join(R,'tools','build'),DD=path.join(B,'director');
const SP=require('./trailer-spec.js');
const args=process.argv.slice(2),mode=args[0],flags={},ids=[];
for(const a of args.slice(1)){const m=a.match(/^--([^=]+)=?(.*)$/);if(m)flags[m[1]]=m[2]===''?true:m[2];else ids.push(a);}
const draft=!!flags.draft,par=+(flags.par||2);
const F=k=>k<=0?0:Math.round((SP.music.first+k*60/SP.music.bpm)*SP.fps);   // timeline frame of beat k
const merge=(...a)=>{const o={};for(const p of a)if(p)for(const k in p){if(p[k]&&typeof p[k]==='object'&&!Array.isArray(p[k]))o[k]=merge(o[k],p[k]);else o[k]=p[k];}return o;};
const look=s=>merge(SP.hq,typeof s.look==='string'?SP.looks[s.look]:s.look,s.set);
const fxOf=v=>typeof v==='string'?SP.fx[v]:v||null;
const postOf=s=>merge(SP.post.base,typeof s.post==='string'?SP.post[s.post]:s.post);

// every shot, with its frame window and its pages (one per look)
function expand(){
 const out=[];
 for(const s of SP.shots){
  const f0=s.f0!=null?s.f0:F(s.k[0]),f1=s.f1!=null?s.f1:F(s.k[1]),n=f1-f0;
  const base={id:s.id,take:s.take,f0,n,clip:{from:s.from,frames:n,speed:s.speed,hold:s.hold,blur:s.blur!=null?s.blur:SP.blur,post:postOf(s),shots:s.shots}};
  if(!s.variants){out.push(Object.assign({},base,{pages:[{name:s.id,set:look(s),fx:fxOf(s.fx),cfg:s.cfg,only:null}]}));continue;}
  // variants split the window into equal steps (the last takes the remainder)
  const m=s.variants.length,step=s.step||Math.floor(n/m),pages=[];
  s.variants.forEach((v,i)=>{const a=s.splits?s.splits[i]:i*step,b=s.splits?(s.splits[i+1]!=null?s.splits[i+1]:n):(i===m-1?n:(i+1)*step);
   pages.push({name:s.id+'_'+String(i).padStart(2,'0'),set:merge(look(s),typeof v.look==='string'?SP.looks[v.look]:v.look,v.set),fx:fxOf(v.fx||s.fx),cfg:v.cfg||s.cfg,only:[a,b],caption:v.caption});});
  out.push(Object.assign({},base,{pages}));
 }
 return out;
}

function runPage(take,set,fx,cfg,clips,tag){
 return new Promise(res=>{
  const plan={take,fps:SP.fps,ss:draft?1:SP.ss,name:'plan_'+tag,set,fx,cfg,q:0.95,clips};
  if(draft){for(const c of clips){c.blur=false;}}
  const pf=path.join(B,'trailer','plans',tag+'.json');fs.mkdirSync(path.dirname(pf),{recursive:true});fs.writeFileSync(pf,JSON.stringify(plan,null,1));
  let expr="dirShoot('tools/build/trailer/plans/"+tag+".json')";
  if(draft)expr+='.then(async r=>{for(const c of r.clips)c.sheet=await dirSheet({dir:'+JSON.stringify(take)+"+'/'+c.name,every:6,cols:6,tw:320,n:c.frames});return r;})";
  const t0=Date.now(),p=spawn(process.execPath,[path.join(__dirname,'page-run.js'),'--size='+(draft?'960x540':'1920x1080'),path.join(__dirname,'director.js'),expr],{cwd:R});
  let so='',se='';p.stdout.on('data',d=>so+=d);p.stderr.on('data',d=>se+=d);
  p.on('close',code=>{
   const last=so.trim().split('\n').pop();let r=null;try{r=JSON.parse(last);}catch(e){}
   console.log(tag,code===0&&r?'ok':'FAILED',((Date.now()-t0)/1000).toFixed(0)+'s',r?'desync '+JSON.stringify(r.desync):se.split('\n').filter(l=>/ERR/.test(l)).join(' '));
   res(r);
  });
 });
}

async function render(){
 const jobs=[];
 for(const s of expand()){
  if(ids.length&&!ids.includes(s.id)&&!s.pages.some(p=>ids.includes(p.name)))continue;
  for(const pg of s.pages){
   if(ids.length&&!ids.includes(s.id)&&!ids.includes(pg.name))continue;
   const clip=Object.assign({},s.clip,{name:pg.name+(draft?'_d':'')});
   if(pg.only)clip.only=pg.only;
   jobs.push(()=>runPage(s.take,pg.set,pg.fx,pg.cfg,[clip],pg.name+(draft?'_d':'')));
  }
 }
 let i=0;const go=async()=>{while(i<jobs.length){const j=jobs[i++];await j();}};
 await Promise.all(Array.from({length:Math.min(par,jobs.length)},go));
}

// the cards: the spec's list plus a lower third for every captioned variant
function cardList(){
 const out=(SP.cards||[]).map(c=>Object.assign({},c,{frames:c.len}));
 const cp=SP.captions;if(cp){const s=expand().find(x=>x.id===cp.shot);
  s.pages.forEach((pg,i)=>{if(!pg.caption)return;const n=pg.only[1]-pg.only[0];
   out.push({name:'cap_'+i,kind:'lower',label:cp.label,text:pg.caption,start:s.f0+pg.only[0],len:n,frames:n,inN:i===0?cp.inN:0});});}
 return out;
}
function cards(){
 const L=cardList().filter(c=>!ids.length||ids.includes(c.name));
 fs.writeFileSync(path.join(B,'trailer','cards.json'),JSON.stringify({cards:L},null,1));
 const p=spawn(process.execPath,[path.join(__dirname,'page-run.js'),'--size=1920x1080',path.join(__dirname,'trailer-cards.js'),"cardAll('tools/build/trailer/cards.json')"],{cwd:R,stdio:'inherit'});
 p.on('close',c=>console.log('cards',c===0?'ok':'FAILED',L.map(c=>c.name).join(' ')));
}

// --- the edit list: strips on the timeline, cards over them, the sound cues on the real contacts ---
// the timeline second at which director time D shows in a shot
function shotTime(id,D){
 const s=expand().find(x=>x.id===id),fr=JSON.parse(fs.readFileSync(path.join(DD,s.take,s.pages[0].name+(draft?'_d':''),'frames.json'),'utf8'));
 for(let j=1;j<fr.length;j++)if(fr[j]>=D)return (s.f0+j-1+(D-fr[j-1])/Math.max(1e-6,fr[j]-fr[j-1]))/SP.fps;
 return (s.f0+fr.length)/SP.fps;
}
function edl(){
 const strips=[],cues=[];
 for(const s of expand()){
  for(const pg of s.pages){
   const a=pg.only?pg.only[0]:0,b=pg.only?pg.only[1]:s.n;
   strips.push({id:pg.name,dir:path.join('tools','build','director',s.take,pg.name).replace(/\\/g,'/'),start:s.f0+a,first:a+1,len:b-a,caption:pg.caption||null});
  }
  // sound cues from the scout's events, placed where the shot shows them
  const sp=SP.shots.find(x=>x.id===s.id);if(sp.sfx===false)continue;
  const fj=path.join(DD,s.take,s.pages[0].name+(draft?'_d':''),'frames.json');if(!fs.existsSync(fj))continue;
  const fr=JSON.parse(fs.readFileSync(fj,'utf8')),sc=JSON.parse(fs.readFileSync(path.join(DD,s.take,'scout.json'),'utf8'));
  const D0=fr[0],D1=fr[fr.length-1];
  const at=D=>{for(let j=1;j<fr.length;j++)if(fr[j]>=D&&fr[j-1]<D)return (s.f0+j-1+(D-fr[j-1])/Math.max(1e-6,fr[j]-fr[j-1]))/SP.fps;return null;};
  const rate=D=>{for(let j=1;j<fr.length;j++)if(fr[j]>=D)return (fr[j]-fr[j-1])*SP.fps;return 1;};
  const P=sc.trk.p,dt=sc.trk.dt,pos=t=>{const k=Math.round(t/dt)*3;return P[k]==null?null:[P[k],P[k+1],P[k+2]];};
  const spd=t=>{const p=pos(t-0.02),q=pos(t+0.03);return p&&q?Math.hypot(q[0]-p[0],q[2]-p[2])/0.05:0;};
  let last=-1;
  for(const e of sc.ev){
   if(e.t<=D0||e.t>=D1)continue;const t=at(e.t);if(t==null)continue;
   const slow=rate(e.t);   // <1 in slow motion: deeper, longer sounds
   if(e.type==='snd'&&e.fn==='kick'){if(e.t-last<0.04)continue;last=e.t;const v=spd(e.t+0.03);if(v<25)continue;cues.push({t:+t.toFixed(4),k:'ball',v:Math.round(v),g:Math.min(0.55,0.12+v/400),slow:+slow.toFixed(2),src:s.id});}
   else if(e.type==='snd'&&e.fn==='post')cues.push({t:+t.toFixed(4),k:'post',v:e.v,g:0.4,src:s.id});
   else if(e.type==='snd'&&e.fn==='wall'&&e.v>45&&e.k!==1)cues.push({t:+t.toFixed(4),k:'wall',v:e.v,g:Math.min(0.3,e.v/300),src:s.id});
   else if(e.type==='goal'||e.type==='cannon'){
    // a blast that goes into slow motion is heard at the speed it plays at a moment later
    let sl=1;for(let j=1;j<fr.length;j++)if(fr[j]>e.t&&fr[j]<e.t+0.25)sl=Math.min(sl,(fr[j]-fr[j-1])*SP.fps);
    const c=e.type==='goal'?{k:'goal',g:0.7,duck:0.35}:{k:'explosion',g:0.8,duck:0.4};
    if(sl<0.9)Object.assign(c,{slow:+Math.max(0.35,sl).toFixed(2),cut:2.6,duckT:1.4});
    cues.push(Object.assign({t:+t.toFixed(4),src:s.id},c));
   }
   else if(e.type==='snd'&&e.fn==='warnBeep')cues.push({t:+t.toFixed(4),k:'beep',g:0.18,src:s.id});
   else if(e.type==='powerHit')cues.push({t:+t.toFixed(4),k:'hit',g:0.45,src:s.id});
  }
 }
 const cards=cardList().map(c=>Object.assign({},c,{start:c.start!=null?c.start:c.f!=null?c.f:F(c.k)}));
 const manual=(SP.cues||[]).map(c=>{const o=Object.assign({},c,{k:c.kk||c.k_||c.k,t:+((c.at?shotTime(c.at.shot,c.at.D):c.t!=null?c.t:F(c.k)/SP.fps)+(c.dt||0)).toFixed(4)});delete o.kk;delete o.k_;delete o.dt;delete o.at;return o;});
 const out={fps:SP.fps,w:1920,h:1080,len:SP.len,music:SP.music,strips,cards,flashes:(SP.flashes||[]).map(f=>Object.assign({},f,{start:f.f!=null?f.f:F(f.k)})),
  cues:cues.concat(manual).sort((a,b)=>a.t-b.t),grade:SP.grade||null,fades:(SP.fades||[]).map(f=>Object.assign({},f,{start:f.f!=null?f.f:F(f.k)}))};
 fs.writeFileSync(path.join(B,'trailer','edl.json'),JSON.stringify(out,null,1));
 fs.writeFileSync(path.join(B,'trailer','audio.json'),JSON.stringify(Object.assign({music:SP.music.src,len:SP.len/SP.fps},SP.audio,{cues:out.cues}),null,1));
 console.log('edl: strips',strips.length,'cards',cards.length,'cues',out.cues.length,'missing frames',strips.filter(s=>!fs.existsSync(path.join(R,s.dir,'frame_'+String(s.first).padStart(5,'0')+'.jpg'))).map(s=>s.id).join(' ')||'none');
}

// the output frames' director times, as tools/director.js frameList makes them
function frames(c){
 const fps=SP.fps,spd=D=>{const k=c.speed;if(!k||!k.length)return 1;if(D<=k[0][0])return k[0][1];for(let i=1;i<k.length;i++)if(D<=k[i][0]){const a=k[i-1],b=k[i];return a[1]+(b[1]-a[1])*(D-a[0])/(b[0]-a[0]);}return k[k.length-1][1];};
 const out=[],holds=(c.hold||[]).slice().sort((a,b)=>a.at-b.at);let D=c.from;
 while(out.length<c.frames){const s=Math.max(0.01,spd(D));out.push(D);const nD=D+s/fps;
  for(const h of holds)if(h.at>D&&h.at<=nD)for(let k=0;k<(h.frames!=null?h.frames:Math.round(h.secs*fps));k++)out.push(h.at);D=nD;}
 out.length=c.frames;return out;
}
function list(){
 for(const s of expand()){
  const fr=frames(s.clip);
  console.log(s.id.padEnd(14),'frames',String(s.f0).padStart(5),'..',String(s.f0+s.n).padStart(5),(s.f0/SP.fps).toFixed(2).padStart(6)+'s',(s.n/SP.fps).toFixed(2)+'s',s.take,'D',fr[0].toFixed(2),'..',fr[fr.length-1].toFixed(2),s.pages.length>1?s.pages.length+' variants':'');
  if(!flags.ev)continue;
  const sc=JSON.parse(fs.readFileSync(path.join(DD,s.take,'scout.json'),'utf8'));let last=-1;
  for(const e of sc.ev){if(e.t<fr[0]||e.t>fr[fr.length-1])continue;
   const j=fr.findIndex(D=>D>=e.t);
   if(e.type==='snd'&&e.fn==='kick'){if(e.t-last<0.05)continue;last=e.t;}
   else if(e.type==='snd'&&e.fn!=='post'&&e.fn!=='warnBeep')continue;
   if(e.type==='banner'||e.type==='react')continue;
   console.log('    f'+String(j).padStart(4),'t'+((s.f0+j)/SP.fps).toFixed(3),'D'+e.t.toFixed(3),e.type==='snd'?e.fn:e.type,e.what||e.text||'');}
 }
}

if(mode==='render')render();else if(mode==='edl')edl();else if(mode==='cards')cards();else list();
