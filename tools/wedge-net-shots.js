'use strict';
// node tools/page-run.js --size=1440x1000 tools/wedge-net-shots.js "wedgeShots()"
window.wedgeShots=async function(){
 cfg.table='classic';cfg.skins=cfg.skins||{};cfg.skins.classic='premierLeague';
 await new Promise(resolve=>applyTable(resolve));
 const stage=new THREE.Scene();stage.background=new THREE.Color(0xe9e0d2);stage.environment=scene.environment;
 let cabinet=tableGroups.classic.clone(true);stage.add(cabinet);
 const goal=goalFrames[1].clone(true);stage.add(goal);
 stage.add(new THREE.HemisphereLight(0xfff5e5,0x786b59,2));
 const key=new THREE.DirectionalLight(0xfff2d8,3);key.position.set(35,50,30);stage.add(key);
 const fill=new THREE.DirectionalLight(0xffffff,1.8);fill.position.set(80,25,-30);stage.add(fill);
 const cam=new THREE.PerspectiveCamera(38,1440/1000,.1,500);
 renderer.setSize(1440,1000);renderer.setPixelRatio(1);
 async function shot(name,pos,target){
  cam.position.set(...pos);cam.lookAt(...target);renderer.render(stage,cam);
  const data=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));
  await fetch('/__save/wedge-net/'+name+'.png',{method:'POST',body:data});
 }
 await shot('rest',[33,26,34],[61,4,0]);
 await shot('side',[66,16,40],[64,4,0]);
 wedgeNetHit(1,new THREE.Vector3(65,3,1),85);wedgeNetUpdate(.12);
 await shot('impact',[33,26,34],[61,4,0]);
 wedgeNetUpdate(3);
 const ball=makeBall('classic');ball.m.position.set(61,2.4,1);ball.v.set(85,0,0);
 S.phase='goal';S.timeScale=1;netBallStart(1,ball);stage.add(ball.m);
 const times=[];
 for(let i=0;i<30;i++){
  const t=performance.now();netBallUpdate(1/24);wedgeNetUpdate(1/24);times.push(performance.now()-t);
  await shot('motion-'+String(i).padStart(2,'0'),[39,22,30],[64,4,0]);
 }
 wedgeNetReset();S.eff[0].big=S.time+10;bigGoalUpdate(1);wedgeNetUpdate(0);goal.scale.z=goalFrames[1].scale.z;
 stage.remove(cabinet);cabinet=tableGroups.classic.clone(true);stage.add(cabinet);
 await shot('wide',[33,26,38],[61,4,0]);
 return {vertices:goalFrames[1].userData.wedge.parts.map(p=>p.geometry.attributes.position.count),updateMeanMs:times.reduce((a,b)=>a+b,0)/times.length,files:['rest','side','impact','wide','motion-00..29']};
}
