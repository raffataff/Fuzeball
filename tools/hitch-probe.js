'use strict';
// hitch-probe: a real match on a cold shader cache, every effect fired, and per frame what blocked: programs linked, link waits, texture uploads
//   node tools/page-run.js tools/hitch-probe.js "hitchProbe({})"
// boots like a player (waits for the warm queue), starts through startMatch, steps loop(t) by hand; a frame over `slow` ms is listed with what it did
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const now=()=>performance.now(),r1=v=>Math.round(v*10)/10,wait=ms=>new Promise(r=>setTimeout(r,ms));
 const F={link:0,wait:0,tex:0,texN:0,rnd:0,rn:0,slow:[]};
 function hook(){
  const gl=renderer.getContext(),LS=gl.LINK_STATUS,R=renderer.render;
  renderer.render=function(){const s=now();try{return R.apply(this,arguments);}finally{F.rnd+=now()-s;F.rn++;}};
  const wrap=(n,f)=>{const o=gl[n];if(!o)return;gl[n]=function(){return f(o,this,arguments);};};
  wrap('linkProgram',(o,t,a)=>{F.link++;return o.apply(t,a);});
  let cur=null;const nm=p=>{for(const q of renderer.info.programs||[])if(q.program===p)return (q.name||q.type)+(/(^|,)srgb-linear,/.test(q.cacheKey)?'@rt':'');return '?';};
  wrap('useProgram',(o,t,a)=>{cur=a[0];return o.apply(t,a);});
  for(const n of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])
   wrap(n,(o,t,a)=>{const s=now(),r=o.apply(t,a),d=now()-s;if(d>4)F.slow.push(nm(cur)+':'+r1(d));return r;});
  wrap('getProgramParameter',(o,t,a)=>{const s=now(),r=o.apply(t,a);if(a[1]===LS)F.wait+=now()-s;return r;});
  for(const n of ['texImage2D','texSubImage2D','compressedTexImage2D','compressedTexSubImage2D','texImage3D','texSubImage3D','compressedTexSubImage3D','texStorage2D','generateMipmap'])
   wrap(n,(o,t,a)=>{const s=now(),r=o.apply(t,a);F.tex+=now()-s;F.texN++;return r;});
 }
 let seen=null;
 function newProgs(){
  const out=[];for(const p of renderer.info.programs||[])if(!seen.has(p)){seen.add(p);out.push((p.name||p.type)+(/(^|,)srgb-linear,/.test(p.cacheKey)?'@rt':''));}
  return out;
 }
 let T=0;const rows=[];
 function step(tag,slow){
  F.link=0;F.wait=0;F.tex=0;F.texN=0;F.rnd=0;F.rn=0;F.slow=[];
  T+=1000/60;const s=now();loop(T);const ms=now()-s;
  const np=newProgs();
  const row={tag,ms:r1(ms),render:r1(F.rnd),renders:F.rn,link:F.link,wait:r1(F.wait),tex:r1(F.tex),texN:F.texN};
  if(np.length)row.progs=np;if(F.slow.length)row.slow=F.slow;
  if(ms>=slow||np.length||F.link)rows.push(row);
  return row;
 }
 async function run(tag,n,slow){let worst=0;for(let i=0;i<n;i++){worst=Math.max(worst,step(tag,slow).ms);if(i%20==19)await wait(0);}return worst;}
 window.hitchProbe=async function(o){
  o=Object.assign({slow:25,room:null,seed:5,frames:90},o||{});
  hook();
  await new Promise(r=>warmWhen(r,30));
  if(o.room){cfg.room=o.room;let ok=false;window.requestAnimationFrame=f=>f===loop?0:setTimeout(()=>f(performance.now()),16);venueLoad(d=>applyRoom(d),{onDone:()=>{ok=true;}});for(let i=0;i<600&&!ok;i++)await wait(25);}
  seen=new Set(renderer.info.programs||[]);
  const sum={programsAtBoot:seen.size};
  T=performance.now();
  sum.menu=await run('menu',30,o.slow);
  S.seedNext=o.seed;startMatch('ai');
  for(let i=0;i<400&&S.phase==='menu';i++)await wait(25);
  sum.count=await run('count',o.frames,o.slow);
  S.countT=0;sum.play=await run('play',o.frames,o.slow);
  const ev=async(tag,fn)=>{try{fn();}catch(e){rows.push({tag,err:String(e).slice(0,200)});}sum[tag]=await run(tag,o.frames,o.slow);};
  const at=new THREE.Vector3(0,2,0);
  for(const k in BALL_TYPES)await ev('ball:'+k,()=>{const b=makeBall(k);b.m.position.set(-20,BALL_R,10);syncBall(b);b.cur.copy(b.m.position);b.v.set(120,0,0);});
  await ev('pickup',()=>vfxPickup(at,0x44ffaa));
  for(const t of PU_TYPES)await ev('pu:'+t.key,()=>{disposePU&&S.pu.obj&&disposePU();const g=makePUVisual(t);g.position.set(0,PWR.floatY,0);S.pu.type=t;S.pu.obj=g;scene.add(g);});
  await ev('boost',()=>{S.eff[0].boost=S.time+PWR.boost;});
  await ev('freeze',()=>{S.eff[1].frozen=S.time+PWR.freeze;});
  await ev('big',()=>{S.eff[0].big=S.time+PWR.big;});
  await ev('cannon',()=>cannonExplodeFx(at));
  await ev('fracture',()=>{const r=rods.find(x=>x.team===1);spawnFracture(r,0);});
  await ev('goal',()=>{const b=S.balls[0]||makeBall('classic');b.m.position.set(CONFIG.table.L/2+1,2,0);syncBall(b);b.cur.copy(b.m.position);onGoal(0,b);});
  await ev('replay',()=>replayStart());
  await ev('finale',()=>vfxFinale(0));
  sum.programsEnd=(renderer.info.programs||[]).length;
  return {sum,rows};
 };
})();
