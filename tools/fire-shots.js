'use strict';
// fire-shots: the fireball in the real scene, at rest and kicked, PNG data URLs back (and what the ball did).
//   node tools/page-run.js tools/fire-shots.js "fireShots({})" > out.json   then node tools/fx-shots-save.js out.json <dir> fire
// rest = frames (1/60 s) to hold the ball still before the kick, restAt = frames of that hold to shoot, at = frames after the kick, kick:false = no kick
// vel = [vx,vy,vz] launches the ball by hand instead of a kick
// cam = a camera mode index or [x,y,z,lookx,looky,lookz]; follow = [dx,dy,dz] puts the camera that far off the ball, looking at it (lead = how far ahead of the ball it looks)
// set = CONFIG.fx.fire keys to override, type = the ball type
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }
 function aim(o,b){
  if(!o.follow||!b)return;
  const p=b.m.position,v=b.v,l=Math.hypot(v.x,v.z)||1,ld=o.lead||0;
  camera.position.set(p.x+o.follow[0],p.y+o.follow[1],p.z+o.follow[2]);
  camera.lookAt(p.x+v.x/l*ld,p.y,p.z+v.z/l*ld);camera.updateMatrixWorld();
 }
 window.fireShots=async function(o){
  o=Object.assign({rod:3,man:2,dist:2.6,rest:40,restAt:[],at:[3,6,10,16,26],cam:[-24,30,22,-2,2,0],follow:null,lead:0,w:1280,h:720,
   particles:true,seed:7,clear:true,z:6,kick:true,type:'fire',set:null,charge:false},o||{});
  const merge=(a,b)=>{for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k])merge(a[k],b[k]);else a[k]=b[k];}};
  if(o.set&&CONFIG.fx.fire){merge(CONFIG.fx.fire,o.set);if(typeof fireTune==='function')fireTune();}
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='count';S.countT=1e9;S.goalT=0;
  cfg.particles=o.particles;
  for(const r of rods)r.aiIQ=false;
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await new Promise(r=>setTimeout(r,250));
  for(let i=0;i<60&&!ballModel;i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();
  await new Promise(r=>setTimeout(r,1500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
  const r=rods[o.rod],dir=r.kickDir;
  if(o.z!=null){r.offset=clamp(o.z-r.baseZ[o.man],-r.maxOff,r.maxOff);r.target=r.offset;}
  let t=performance.now()+2000;
  if(o.clear){for(const q of rods)if(q!==r)q.raise=true;for(let f=0;f<40;f++){t+=1000/60;loop(t);}}
  const b=makeBall(o.type);
  b.m.position.set(r.x+dir*o.dist,BALL_R,r.baseZ[o.man]+r.offset);b.v.set(0,0,0);syncBall(b);
  const shots=[],info=[];
  const snap=(f,ph)=>{const bb=S.balls[0];aim(o,bb);shots.push(frame(o.w,o.h));
   info.push({ph,f,calls:renderer.info.render.calls,tris:renderer.info.render.triangles,x:bb?+bb.m.position.x.toFixed(1):null,speed:bb?+bb.v.length().toFixed(1):null});};
  for(let f=1;f<=o.rest;f++){t+=1000/60;loop(t);if(o.restAt.indexOf(f)>=0)snap(f,'rest');}
  if(o.vel){b.v.set(o.vel[0],o.vel[1],o.vel[2]);o.kick=true;}   // launched by hand instead of the boot (a pass-speed ball)
  else if(o.kick)kickRod(r,null);
  if(o.kick){
   const last=Math.max.apply(null,o.at.concat([0]));
   for(let f=1;f<=last;f++){t+=1000/60;loop(t);if(o.at.indexOf(f)>=0)snap(f,'kick');}
  }
  return {shots,info,errs};
 };
 // an AI match where every serve is a fireball: errors, the flame drawn in play and in the replays, one replay frame
 //   node tools/page-run.js tools/fire-shots.js "fireMatch({secs:120})"
 window.fireMatch=async function(o){
  o=Object.assign({secs:120,seed:11,w:1280,h:720},o||{});
  for(const k in BALL_TYPES)BALL_TYPES[k].w=k==='fire'?1:0;cfg.special=true;cfg.replay=true;
  S.seedNext=o.seed;startMatchNow('ai');
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]&&ballModel);i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();
  let t=performance.now()+2000,shot=null;const seen={},n={play:0,replay:0,pause:0},fr={play:0,replay:0};
  for(let f=0;f<o.secs*60;f++){
   t+=1000/60;loop(t);
   const ph=S.phase;seen[ph]=(seen[ph]||0)+1;
   if(fr[ph]!==undefined){fr[ph]++;if(FIRE.mesh&&FIRE.mesh.visible)n[ph]++;}
   if(ph==='replay'&&!shot&&RP.t>RP.len*0.5){renderer.setPixelRatio(1);renderer.setSize(o.w,o.h,false);camera.aspect=o.w/o.h;camera.updateProjectionMatrix();renderer.render(scene,camera);shot=renderer.domElement.toDataURL('image/png');}
   if(f===o.secs*30&&ph==='play'){S.phase='pause';for(let i=0;i<30;i++){t+=1000/60;loop(t);if(FIRE.mesh&&FIRE.mesh.visible)n.pause++;}S.phase='play';}
  }
  return {shots:shot?[shot]:[],info:{seen,drawn:n,frames:fr,score:S.score.slice()},errs};
 };
 // a clip: the ball still, then launched at `vel` into a wall, the camera chasing at `off` (smoothed); PNG frames to tools/build/<dir>/, then blender -b --factory-startup --python tools/seq-encode.py -- tools/build/fire/reel 60 out.mp4
 //   node tools/page-run.js --size=960x540 tools/fire-shots.js "fireReel({})"
 window.fireReel=async function(o){
  o=Object.assign({rest:60,frames:200,vel:[55,0,38],off:[-2,6,-15],look:[3,0,4],w:960,h:540,dir:'fire/reel',rod:3,man:2,dist:3.4,z:0,seed:7},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='count';S.countT=1e9;S.goalT=0;cfg.particles=true;
  for(const r of rods)r.aiIQ=false;
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]&&ballModel);i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();await new Promise(r=>setTimeout(r,1500));
  const r=rods[o.rod];r.offset=clamp(o.z-r.baseZ[o.man],-r.maxOff,r.maxOff);r.target=r.offset;
  let t=performance.now()+2000;for(const q of rods)if(q!==r)q.raise=true;for(let f=0;f<40;f++){t+=1000/60;loop(t);}
  const b=makeBall('fire');b.m.position.set(r.x+r.kickDir*o.dist,BALL_R,r.baseZ[o.man]+r.offset);b.v.set(0,0,0);syncBall(b);
  renderer.setPixelRatio(1);renderer.setSize(o.w,o.h,false);camera.aspect=o.w/o.h;camera.updateProjectionMatrix();
  const cp=new THREE.Vector3().copy(b.m.position).add(new THREE.Vector3(o.off[0],o.off[1],o.off[2])),lk=new THREE.Vector3().copy(b.m.position);
  for(let f=0;f<o.frames;f++){
   if(f===o.rest)b.v.set(o.vel[0],o.vel[1],o.vel[2]);
   t+=1000/60;loop(t);
   const p=b.m.position,k=f<o.rest?1:0.08;
   cp.lerp(new THREE.Vector3(p.x+o.off[0],p.y+o.off[1],p.z+o.off[2]),k);lk.lerp(new THREE.Vector3(p.x+o.look[0]*(f<o.rest?0:1),p.y,p.z+o.look[2]*(f<o.rest?0:1)),k*1.5);
   camera.position.copy(cp);camera.lookAt(lk);camera.updateMatrixWorld();
   renderer.render(scene,camera);
   const bl=await new Promise(res=>renderer.domElement.toBlob(res,'image/png'));
   await fetch('/__save/'+o.dir+'/frame_'+String(f+1).padStart(5,'0')+'.png',{method:'POST',body:bl});
  }
  return {frames:o.frames,errs};
 };
 // frame cost of the fire against the same scene without it: ms a frame over n renders (gl.finish each)
 window.fireCost=async function(o){
  o=Object.assign({n:60,w:1280,h:800,follow:[0,9,16]},o||{});
  await fireShots({rest:20,restAt:[],kick:false,follow:o.follow,w:o.w,h:o.h});
  const gl=renderer.getContext(),b=S.balls[0];
  const run=()=>{aim(o,b);renderer.render(scene,camera);gl.finish();const t0=performance.now();for(let i=0;i<o.n;i++){renderer.render(scene,camera);}gl.finish();return (performance.now()-t0)/o.n;};
  const on=run();
  const F=CONFIG.fx.fire,was=F&&F.on;if(F)F.on=false;let t=performance.now()+9000;loop(t);t+=17;loop(t);
  const off=run();if(F)F.on=was;
  return {on:+on.toFixed(3),off:+off.toFixed(3),errs};
 };
})();
