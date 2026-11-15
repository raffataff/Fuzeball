// boot-perf: shader warm cost on a cold GPU cache (page-run's fresh profile), per room and for the match start
//   node tools/page-run.js tools/boot-perf.js "bootPerf({})"
// per room: load (applyRoom until ready), flush (warmFlush: compile everything queued), first (the first full render after it), programs = three's program count after
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),r1=v=>Math.round(v);
 const gl=()=>renderer.getContext(),px=new Uint8Array(4);
 const draw=()=>{const t=now();renderer.render(scene,camera);gl().readPixels(0,0,1,1,gl().RGBA,gl().UNSIGNED_BYTE,px);return now()-t;};
 window.bootPerf=async function(o){
  o=Object.assign({rooms:['arcade','open','saucer','moon']},o||{});
  const progs=()=>(renderer.info.programs||[]).length,out={atEval:r1(now()),programsAtEval:progs(),rooms:[]};
  for(const id of o.rooms){
   cfg.room=id;let ok=false;const t0=now();applyRoom(()=>{ok=true;});
   for(let i=0;i<400&&!ok;i++)await wait(25);
   const load=now()-t0,t1=now();warmFlush();const flush=now()-t1,first=draw(),second=draw();
   out.rooms.push({id,ok,load:r1(load),flush:r1(flush),first:r1(first),second:+second.toFixed(1),programs:progs()});
  }
  let ok=false;const t0=now();startMatchNow('ai');
  if(typeof ensureMatchAssets==='function')ensureMatchAssets(()=>{ok=true;});else ok=true;
  for(let i=0;i<400&&!ok;i++)await wait(25);
  const ready=now()-t0,t1=now();warmFlush();const flush=now()-t1;
  out.match={ok,ready:r1(ready),flush:r1(flush),first:r1(draw()),second:+draw().toFixed(1),programs:progs()};
  return out;
 };
})();
