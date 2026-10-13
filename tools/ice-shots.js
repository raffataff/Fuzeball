'use strict';
// ice-shots: renders the frost block frame by frame in the real scene and returns PNG data URLs, plus what it costs.
//   node tools/page-run.js tools/ice-shots.js "iceShots({team:1,at:[0.05,0.15,0.3,1,2.6,4.05,4.25,4.6,5.4],hold:4})" > out.json   then node tools/fx-shots-save.js out.json <dir> ice
//   node tools/page-run.js tools/ice-shots.js "iceCost({w:1280,h:720})"
// team = the team slowed (0 red, 1 blue); cam = a CONFIG.camera.modes index or a [px,py,pz,lx,ly,lz] array; hold = seconds the frost lasts; at = seconds after the pickup
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }
 async function setup(o){
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;
  cfg.particles=o.particles;
  for(const r of rods)r.aiIQ=false;
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await new Promise(r=>setTimeout(r,250));   // the figurine GLBs
  rebuildRodMen();applyColors();   // what the match-start gate does once the figurines are resident (startMatchNow skips it)
  await new Promise(r=>setTimeout(r,1500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
 }
 window.iceShots=async function(o){
  o=Object.assign({team:1,at:[0.05,0.15,0.3,1,2.6,4.05,4.25,4.6,5.4],cam:0,w:1280,h:720,dt:1/60,hold:4,seed:7,particles:true},o||{});
  await setup(o);
  const out=[],info=[];let t=0;
  S.eff[o.team].frozen=S.time+o.hold;
  for(const at of o.at){
   while(t<at-1e-6){
    const d=Math.min(o.dt,at-t);
    S.time+=d;fxUpdate(d);cameraUpdate(d);t+=d;
   }
   out.push(frame(o.w,o.h));
   let vis=0;for(const r of rods)if(r.ice)for(const it of r.ice)if(it.g.visible)vis++;
   info.push({t:at,calls:renderer.info.render.calls,tris:renderer.info.render.triangles,blocks:vis,opacity:+ICE.mat[o.team].f.opacity.toFixed(3)});
  }
  return {shots:out,info,errs,models:[!!playerModel[0],!!playerModel[1]],ids:[activeModel(0).id,activeModel(1).id],fit:ICE.fit.map(f=>f&&{top:+f.top.toFixed(2)}),geoTris:ICE.geo[o.team].map(g=>g.attributes.position.count/3)};
 };
 // draws and GPU time of a frame with the blocks on screen against the same frame without
 window.iceCost=async function(o){
  o=Object.assign({w:1280,h:720,n:8,cam:0,team:1,seed:3,particles:true},o||{});
  await setup(o);
  renderer.setPixelRatio(1);renderer.setSize(o.w,o.h,false);camera.aspect=o.w/o.h;camera.updateProjectionMatrix();
  const gl=renderer.getContext(),px=new Uint8Array(4),res={};
  {const e=gl.getExtension('WEBGL_debug_renderer_info');res.gpu=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'?';}
  const gpu=(label)=>{
   renderer.render(scene,camera);renderer.render(scene,camera);
   const ts=[];
   for(let i=0;i<o.n;i++){const a=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);ts.push(performance.now()-a);}
   ts.sort((x,y)=>x-y);res[label]={ms:+ts[ts.length>>1].toFixed(2),calls:renderer.info.render.calls,tris:renderer.info.render.triangles};
  };
  gpu('none');
  S.eff[o.team].frozen=S.time+30;
  for(let i=0;i<40;i++){S.time+=1/60;fxUpdate(1/60);cameraUpdate(1/60);}
  gpu('one team frozen');
  S.eff[1-o.team].frozen=S.time+30;
  for(let i=0;i<40;i++){S.time+=1/60;fxUpdate(1/60);cameraUpdate(1/60);}
  gpu('both frozen');
  S.eff[0].frozen=0;S.eff[1].frozen=0;
  for(let i=0;i<5;i++){S.time+=1/60;fxUpdate(1/60);}
  const t0=performance.now();for(let i=0;i<600;i++)fxUpdate(1/60);
  res['fxUpdate idle ms']=+((performance.now()-t0)/600).toFixed(4);
  S.eff[o.team].frozen=S.time+30;for(let i=0;i<5;i++){S.time+=1/60;fxUpdate(1/60);}
  const t1=performance.now();for(let i=0;i<600;i++){S.time+=1/60;fxUpdate(1/60);}
  res['fxUpdate frozen ms']=+((performance.now()-t1)/600).toFixed(4);
  res.errs=errs;
  return res;
 };
})();
