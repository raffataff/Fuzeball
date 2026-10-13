'use strict';
// boost-shots: a boosted kick frame by frame in the real scene, PNG data URLs back (and what the ball did).
//   node tools/page-run.js tools/boost-shots.js "boostShots({at:[2,4,7,15,30,54]})" > out.json   then node tools/fx-shots-save.js out.json <dir> boost
// rod = a rods[] index (3 = the red MID), man = which of its men, dist = how far ahead of the rod the ball starts, at = frames (1/60 s) after the kick, boost:false = the same kick unboosted, clear = every other rod raised so the ball runs free, z = where the man stands (6 is a lane no rod has a man in)
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }
 window.boostShots=async function(o){
  o=Object.assign({rod:3,man:2,dist:2.6,at:[2,4,7,15,30,54],cam:[-24,30,22,-2,2,0],w:1280,h:720,boost:true,particles:true,seed:7,clear:true,z:6},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='count';S.countT=1e9;S.goalT=0;
  cfg.particles=o.particles;
  for(const r of rods)r.aiIQ=false;
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();
  await new Promise(r=>setTimeout(r,1500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
  const r=rods[o.rod],dir=r.kickDir;
  if(o.z!=null){r.offset=clamp(o.z-r.baseZ[o.man],-r.maxOff,r.maxOff);r.target=r.offset;}   // put the man at z, where no other rod has one
  let t=performance.now()+2000;   // one clock for every loop() call: it never runs backward
  if(o.clear){for(const q of rods)if(q!==r)q.raise=true;for(let f=0;f<40;f++){t+=1000/60;loop(t);}}   // every other rod up: nothing in the lane
  S.eff[r.team].boost=o.boost?S.time+30:0;
  const b=makeBall('classic');
  b.m.position.set(r.x+dir*o.dist,BALL_R,r.baseZ[o.man]+r.offset);b.v.set(0,0,0);syncBall(b);
  kickRod(r,null);
  const shots=[],info=[];
  const last=Math.max.apply(null,o.at);
  for(let f=1;f<=last;f++){
   t+=1000/60;loop(t);
   if(o.at.indexOf(f)>=0){
    shots.push(frame(o.w,o.h));
    const bb=S.balls[0];
    info.push({f,calls:renderer.info.render.calls,x:bb?+bb.m.position.x.toFixed(1):null,speed:bb?+bb.v.length().toFixed(1):null,pw:bb?+(bb.pw||0).toFixed(2):null,trails:cfg.trails,sprites:sprites.filter(q=>q.visible).length,gold:sprites.filter(q=>q.visible&&q.material.color.r>0.8&&q.material.color.g>0.7&&q.material.color.b<0.5).length});
   }
  }
  return {shots,info,errs,boosted:S.eff[r.team].boost>S.time,pwAt:r.pwAt};
 };
 // the state: a team boosted from the pickup to the end, frame by frame (boots, handles, the wave, the sputter, the pop)
 //   node tools/page-run.js tools/boost-shots.js "boostState({team:0,hold:6,at:[0.05,0.2,0.4,1,3,4.8,5.4,5.9,6.05,6.3]})" > out.json
 window.boostState=async function(o){
  o=Object.assign({team:0,hold:6,at:[0.05,0.2,0.4,1,3,4.8,5.4,5.9,6.05,6.3],cam:[-24,36,36,-14,2,4],w:1280,h:720,particles:true,seed:7},o||{});
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='count';S.countT=1e9;S.goalT=0;
  cfg.particles=o.particles;
  for(const r of rods)r.aiIQ=false;
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();
  await new Promise(r=>setTimeout(r,1500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
  let t=performance.now()+2000;
  for(let f=0;f<30;f++){t+=1000/60;loop(t);}
  S.eff[o.team].boost=S.time+o.hold;
  const t0=S.time,shots=[],info=[];
  for(const at of o.at){
   const target=Math.round(at*60);
   let guard=0;
   while((S.time-t0)<at-1/120&&guard++<2000){t+=1000/60;loop(t);}
   shots.push(frame(o.w,o.h));
   info.push({at,simT:+(S.time-t0).toFixed(2),calls:renderer.info.render.calls,knob:+teamGlow[o.team].emissiveIntensity.toFixed(2),pts:BOG.pts[o.team].visible,drawn:BOG.pts[o.team].geometry.drawRange?BOG.pts[o.team].geometry.drawRange.count:null});
  }
  return {shots,info,errs};
 };
 // what a power hit costs: JS per contact and the frame with its effect on screen
 window.boostCost=async function(o){
  o=Object.assign({n:2000},o||{});
  S.seedNext=3;startMatchNow('ai');clearBalls();
  await new Promise(r=>setTimeout(r,2000));
  const b={m:{position:new THREE.Vector3(0,2,0)},v:new THREE.Vector3(90,0,0),pw:0},r=rods[3];
  S.eff[r.team].boost=S.time+60;
  const t0=performance.now();
  for(let i=0;i<o.n;i++){r.pwAt=0;b.pw=0;r.kickT=0.05;boostTouch(b,r,false);vfxClear();}
  const hit=(performance.now()-t0)/o.n;
  const t1=performance.now();
  for(let i=0;i<o.n;i++){r.pwAt=0;boostTouch(b,rods[0].team===r.team?rods[1]:rods[0],false);}
  const miss=(performance.now()-t1)/o.n;
  return {hitMs:+hit.toFixed(4),otherTouchMs:+miss.toFixed(5),errs};
 };
})();
