// boot-perf: shader warm cost on a cold GPU cache (page-run's fresh profile), per room and for the match start
//   node tools/page-run.js tools/boot-perf.js "bootPerf({})"
// per room: load (applyRoom until ready), flush (warmFlush + compile(scene): submits), link (warmWhen: the programs linking, main thread free; block = its longest stall),
// first (the first full render after it), programs = three's program count after; {link:false} skips the wait (the first render then pays the link)
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),r1=v=>Math.round(v);
 const gl=()=>renderer.getContext(),px=new Uint8Array(4);
 const draw=()=>{const t=now();renderer.render(scene,camera);gl().readPixels(0,0,1,1,gl().RGBA,gl().UNSIGNED_BYTE,px);return now()-t;};
 // the longest main-thread stall while waiting: a 4 ms timer that should fire on time
 async function linkWait(on){
  if(!on||typeof warmWhen!=='function')return {link:0,block:0};
  const t0=now();let last=t0,block=0,done=false,tm=0;
  const beat=()=>{const t=now();block=Math.max(block,t-last);last=t;if(!done)tm=setTimeout(beat,4);};beat();
  await new Promise(r=>warmWhen(r,30));done=true;clearTimeout(tm);
  return {link:r1(now()-t0),block:r1(Math.max(block,now()-last))};
 }
 window.bootPerf=async function(o){
  o=Object.assign({rooms:['arcade','open','saucer','moon'],link:true},o||{});
  const progs=()=>(renderer.info.programs||[]).length,out={atEval:r1(now()),programsAtEval:progs(),rooms:[]};
  const warm=()=>{if(typeof warmTemplates==='function')warmTemplates();warmFlush();const m=typeof warmCompile==='function'?warmCompile(scene):renderer.compile(scene,camera);if(typeof warmTrack==='function')warmTrack(m);};
  for(const id of o.rooms){
   cfg.room=id;let ok=false;const t0=now();applyRoom(()=>{ok=true;});
   for(let i=0;i<400&&!ok;i++)await wait(25);
   const load=now()-t0,t1=now();warm();const flush=now()-t1,L=await linkWait(o.link),first=draw(),second=draw();
   out.rooms.push({id,ok,load:r1(load),flush:r1(flush),link:L.link,block:L.block,first:r1(first),second:+second.toFixed(1),programs:progs()});
  }
  let ok=false;const t0=now();startMatchNow('ai');
  if(typeof ensureMatchAssets==='function')ensureMatchAssets(()=>{ok=true;});else ok=true;
  for(let i=0;i<400&&!ok;i++)await wait(25);
  const ready=now()-t0,t1=now();warm();const flush=now()-t1,L=await linkWait(o.link);
  out.match={ok,ready:r1(ready),flush:r1(flush),link:L.link,block:L.block,first:r1(draw()),second:+draw().toFixed(1),programs:progs()};
  return out;
 };
})();
