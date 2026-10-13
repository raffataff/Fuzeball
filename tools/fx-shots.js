'use strict';
// fx-shots: renders an effect frame by frame in the real scene and returns PNG data URLs.
//   node tools/page-run.js tools/fx-shots.js "fxShots({what:'goal',at:[0.05,0.2,0.5,1.2]})" > out.json   then node tools/fx-shots-save.js out.json <dir>
// what: 'goal' | 'cannon' | 'pickup' | 'finale'; cam: a CONFIG.camera.modes index; team 0 | 1; w x h = the shot size; slow: run the goal's slow-mo clock
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }
 function fire(o){
  const sg=o.team===0?1:-1,gx=sg*(CONFIG.table.L/2+1.5);
  if(o.what==='goal'){
   const b=makeBall('classic');b.m.position.set(gx,2,o.z||0);b.v.set(sg*60,0,0);syncBall(b);b.cur.copy(b.m.position);
   goalFx(o.team,b,null);removeBall(b);
   if(o.slow){S.phase='goal';S.timeScale=MATCH.goalSlowmo;}
  }else if(o.what==='cannon'){cannonExplodeFx(new THREE.Vector3(o.x||0,BALL_R,o.z||0));}
  else if(o.what==='pickup'){vfxPickup(new THREE.Vector3(o.x||0,2,o.z||0),o.hex||0x44ffaa);}
  else if(o.what==='finale'){if(typeof vfxFinale==='function')vfxFinale(o.team);}
 }
 window.fxShots=async function(o){
  o=Object.assign({what:'goal',at:[0.1,0.3,0.7],cam:0,team:0,w:1280,h:720,dt:1/60,z:0,seed:7,slow:true,particles:true},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;
  cfg.particles=o.particles;
  for(const r of rods)r.aiIQ=false;
  await new Promise(r=>setTimeout(r,2500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
  const out=[],info=[];let t=0;
  fire(o);
  if(o.only){   // isolate one pool: the others are marked spent
   const m={sparks:VFX.sp,confetti:VFX.cf,blasts:VFX.bl};
   for(const k in m)if(k!==o.only)m[k].live=-1;
   if(o.only!=='lights'){for(const e of VFX.lights)if(e.l)e.l.intensity=0;VFX.lights.length=0;}
  }
  let nSteps=0;const tAll=performance.now();let fxMs=0;
  for(const at of o.at){
   while(t<at-1e-6){
    const d=Math.min(o.dt,at-t);
    if(S.timeScale<1)S.timeScale=Math.min(1,S.timeScale+d*.9);
    const f0=performance.now();fxUpdate(d);fxMs+=performance.now()-f0;
    cameraUpdate(d);t+=d;nSteps++;
   }
   const r0=performance.now();
   out.push(frame(o.w,o.h));
   info.push({t:at,calls:renderer.info.render.calls,tris:renderer.info.render.triangles,ms:+(performance.now()-r0).toFixed(1),fov:+camera.fov.toFixed(2)});
  }
  return {shots:out,info,errs,fxMsPerStep:+(fxMs/Math.max(1,nSteps)).toFixed(3)};
 };
})();

// fxPerf: what an effect costs. JS per frame (idle fxUpdate, the spawn) and the render with it on screen against the same frame without, a 1px readPixels after each draw forces the GPU to finish
//   node tools/page-run.js tools/fx-shots.js "fxPerf({w:1280,h:720})"
(function(){
 window.fxPerf=async function(o){
  o=Object.assign({w:1280,h:720,n:8,cam:2,team:0},o||{});
  if(typeof Au!=='undefined'){Au.init=function(){};}
  S.seedNext=3;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;cfg.particles=true;
  await new Promise(r=>setTimeout(r,2500));
  S.camMode=o.cam;for(let i=0;i<10;i++)cameraUpdate(10);
  renderer.setPixelRatio(1);renderer.setSize(o.w,o.h,false);camera.aspect=o.w/o.h;camera.updateProjectionMatrix();
  const gl=renderer.getContext(),out={},px=new Uint8Array(4);
  const tm=(label,fn,n)=>{const t=performance.now();for(let i=0;i<n;i++)fn();out[label]=+((performance.now()-t)/n).toFixed(4);};
  renderer.render(scene,camera);renderer.render(scene,camera);
  vfxClear();
  tm('fxUpdate idle ms',()=>fxUpdate(1/60),600);
  const b=makeBall('classic');b.m.position.set(61,2,0);syncBall(b);
  const t0=performance.now();for(let i=0;i<20;i++){goalFx(0,b,null);vfxClear();}out['goalFx spawn ms']=+((performance.now()-t0)/20).toFixed(3);removeBall(b);
  function gpu(label,setup,adv){
   vfxClear();setup();
   let t=0;while(t<adv-1e-6){fxUpdate(1/60);cameraUpdate(1/60);t+=1/60;}
   const ts=[];
   for(let i=0;i<o.n;i++){const a=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);ts.push(performance.now()-a);}
   ts.sort((x,y)=>x-y);out[label]={ms:+ts[ts.length>>1].toFixed(1),calls:renderer.info.render.calls,tris:renderer.info.render.triangles};
  }
  const goal=()=>{const bb=makeBall('classic');bb.m.position.set(61,2,0);syncBall(bb);goalFx(o.team,bb,null);removeBall(bb);};
  {const e=gl.getExtension('WEBGL_debug_renderer_info');out.gpu=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'?';}
  gpu('none',()=>{},0);
  gpu('goal 0.08s',goal,0.08);gpu('goal 0.15s',goal,0.15);gpu('goal 0.4s',goal,0.4);gpu('none 2',()=>{},0);gpu('goal 0.8s',goal,0.8);gpu('goal 1.5s',goal,1.5);
  gpu('finale 1.0s',()=>vfxFinale(0),1.0);gpu('finale 2.2s',()=>vfxFinale(0),2.2);
  gpu('cannon 0.4s',()=>cannonExplodeFx(new THREE.Vector3(0,2,0)),0.4);
  VF.on=false;
  gpu('legacy goal 0.3s',goal,0.3);
  VF.on=true;vfxClear();
  gpu('none (again)',()=>{},0);
  return out;
 };
})();
