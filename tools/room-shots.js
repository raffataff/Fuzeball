'use strict';
// room-shots: every room from a few cameras, PNG data URLs, in the real scene
//   node tools/page-run.js tools/room-shots.js "roomShots({rooms:['arcade','open'],cams:['home',0,4]})" > out.json   then node tools/fx-shots-save.js out.json <dir> room
// cams: a CONFIG.camera.modes index, a menuShots key, or [x,y,z,lx,ly,lz]; set: CONFIG paths overridden for the run, e.g. {'fx.haze.on':false}
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 function camOf(c){
  if(Array.isArray(c))return c;
  if(typeof c==='number')return CONFIG.camera.modes[c];
  return (typeof menuShot==='function'?menuShot(c):CONFIG.camera.menuShots[c])||CONFIG.camera.menuShots.home;
 }
 function put(c){const v=camOf(c);camera.position.set(v[0],v[1],v[2]);camera.lookAt(v[3],v[4],v[5]);camera.updateMatrixWorld();}
 function size(w,h){renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 function setPath(p,v){const k=p.split('.');let o=CONFIG;for(let i=0;i<k.length-1;i++)o=o[k[i]];const old=o[k[k.length-1]];o[k[k.length-1]]=v;return old;}
 async function room(id){
  cfg.room=id;let ok=false;applyRoom(()=>{ok=true;});
  for(let i=0;i<200&&!ok;i++)await wait(50);
  await wait(600);
  if(typeof warmFlush==='function')try{warmFlush();}catch(e){}
  return ok;
 }
 function tick(dt){if(typeof hazeUpdate==='function')hazeUpdate(dt);}
 window.roomShots=async function(o){
  o=Object.assign({rooms:['arcade','open','saucer','moon'],cams:['home',0,2,4],w:1280,h:720,set:{},t:3},o||{});
  const back={};for(const p in o.set)back[p]=setPath(p,o.set[p]);
  if(typeof hazeApply==='function')hazeApply();
  const out=[],info=[];
  size(o.w,o.h);
  for(const id of o.rooms){
   const ok=await room(id);
   for(const c of o.cams){
    put(c);for(let i=0;i<Math.round(o.t*30);i++)tick(1/30);
    renderer.render(scene,camera);
    out.push(renderer.domElement.toDataURL('image/png'));
    info.push({room:id,cam:c,ok,calls:renderer.info.render.calls,tris:renderer.info.render.triangles});
   }
  }
  for(const p in back)setPath(p,back[p]);
  return {shots:out,info,errs};
 };
 // GPU cost of a frame per room, camera and atmosphere level: median ms of n draws, each finished by a 1px readPixels
 //   node tools/page-run.js --size=1920x1080 tools/room-shots.js "roomPerf({levels:['off','low','high']})"
 window.roomPerf=async function(o){
  o=Object.assign({rooms:['arcade','open','saucer','moon'],cams:[0,'home'],w:1920,h:1080,n:40,levels:['off','low','high']},o||{});
  size(o.w,o.h);
  const gl=renderer.getContext(),px=new Uint8Array(4);
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return +a[a.length>>1].toFixed(2);};
  const run=()=>{const a=[];for(let i=0;i<o.n;i++){tick(1/60);const t0=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);a.push(performance.now()-t0);}return med(a);};
  const res=[];
  for(const id of o.rooms){
   await room(id);
   for(const c of o.cams){
    put(c);const r={room:id,cam:c};
    for(const L of o.levels){cfg.atmos=L;applyFog();run();r[L]=run();r[L+'Calls']=renderer.info.render.calls;}
    res.push(r);
   }
  }
  cfg.atmos='high';applyFog();
  return {res,errs};
 };
})();
