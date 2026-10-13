'use strict';
// pin-shots: a ball caught by a posed leg, frame by frame in the real scene (what the player sees between the ball and the leg), as PNG data URLs.
//   node tools/page-run.js tools/pin-shots.js "pinShots({kind:'front',at:[0,0.1,0.4]})" > out.json      then node tools/fx-shots-save.js out.json <dir> pin
//   kind: 'front' = a ball held in front of the back pin, 'rear' = behind a leg tilted forward (a receive), 'fwd' = under the forward pin
//   rel / dz / ang override where the ball lies and the pose; at = seconds after the catch; cam = a CONFIG.camera.modes index or a [px,py,pz,lx,ly,lz] array
//   the sim is stepped by hand (updateRods + physics, no AI): the leg and ball are the real ones, the other rods' men are taken away so nothing stands in the shot
(function(){
 const FIX=1/SIM.hz,sleep=ms=>new Promise(r=>setTimeout(r,ms));
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
 }
 window.pinShots=async function(o){
  o=Object.assign({ri:5,kind:'front',rel:null,ang:null,dz:0,man:1,at:[0,0.1,0.4],cam:null,w:960,h:540,seed:3,pitch:6,dist:20,side:1,id:null},o||{});
  const P=CONFIG.shots.pin,K={front:{rel:-0.6,ang:P.angle,fwd:false},rear:{rel:-0.8,ang:0.4,fwd:false},fwd:{rel:3.4,ang:1.1,fwd:true}}[o.kind];
  if(o.id)cfg.modelRed=o.id;   // the red figurine (the front / rear / forward legs are the red rod's)
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.goalT=0;S.countT=0;resetRodRotation();
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await sleep(250);
  if(o.id)await new Promise(res=>loadPlayerModel(res));   // startMatchNow loaded the saved figurines: swap to the asked one
  rebuildRodMen();applyColors();await sleep(1500);
  const r=rods[o.ri],dir=r.kickDir,mi=Math.min(o.man,r.baseZ.length-1),mz=r.baseZ[mi];
  for(const q of rods)if(q!==r)for(let i=0;i<q.baseZ.length;i++)q.removedUntil[i]=1e9;
  for(let i=0;i<r.baseZ.length;i++)if(i!==mi)r.removedUntil[i]=1e9;
  r.offset=0;r.target=0;r.prevOffset=0;r.iPrevOff=0;r.slideV=0;r.vz=0;r.act=null;
  const rel=o.rel!=null?o.rel:K.rel,ang=o.ang!=null?o.ang:K.ang;
  const b=makeBall('classic');b.m.position.set(r.x+rel*dir,BALL_R,mz+o.dz);b.v.set(0,0,0);syncBall(b);
  r.pinOn=true;r.pinPose=true;r.pinFwd=K.fwd;r.pinA=ang*dir;r.angle=r.pinA;r.prevAngle=r.angle;
  const cx=r.x+dir*(rel>0?rel*0.5:0.5),cam=o.cam||[cx,o.pitch,mz+o.side*o.dist,cx,3.2,mz];
  if(Array.isArray(cam)){CONFIG.camera.modes.push(cam);S.camMode=CONFIG.camera.modes.length-1;}else S.camMode=cam;
  for(let i=0;i<10;i++)cameraUpdate(10);
  const step=()=>{updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);};
  let n=0;while(!r.pinB&&n<240){step();n++;}
  const shots=[],info=[];let t=0;
  const read=()=>{
   const p=b.m.position,sa=Math.sin(r.angle),ca=Math.cos(r.angle),wx=p.x-r.x,wy=p.y-ROD_H;
   return {t:+t.toFixed(3),pinned:!!r.pinB,angle:+(r.angle*dir).toFixed(3),rel:+((p.x-r.x)*dir).toFixed(2),dp:+((wx*ca+wy*sa)*dir).toFixed(2),sgA:r.sgA==null?null:+(r.sgA*dir).toFixed(3)};
  };
  for(const at of o.at){
   while(t<at-1e-6){step();t+=FIX;}
   shots.push(frame(o.w,o.h));info.push(read());
  }
  return {shots,info,model:activeModel(r.team).id};
 };
})();
