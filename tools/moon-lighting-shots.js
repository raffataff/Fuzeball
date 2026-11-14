'use strict';
// node tools/page-run.js tools/moon-lighting-shots.js "moonLightingShots('after')"
// Pass 'before' and serve the previous config and GLB via page-run.js overrides to reproduce the comparison.
(function(){
 const wide=[-30,36,147,-34,10,-40];
 const airlock=[-100,1,59,-124,-18,-103];
 const waitFor=(name,load)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(name+' did not finish loading')),30000);
  load(()=>{clearTimeout(timer);resolve();});
 });
 const errs=[],error=console.error;
 console.error=function(...args){errs.push(args.join(' '));error.apply(console,args);};

 window.moonLightingShots=async function(pass){
  if(pass!=='before'&&pass!=='after')throw new Error('Use before or after');
  const info=[];
  Au.init=function(){};
  Object.assign(cfg,{room:'moon',shadows:true,atmos:'high',reflections:true,particles:false});
  applyDisplay();
  await waitFor('Moon Base',applyRoom);
  if(!roomGroups.moon?.children.length||scene.background!==skyCache.moon)
   throw new Error('Moon Base backdrop or sky is missing');
  if(!roomEnvCache['glb:moon']||scene.environment!==roomEnvCache['glb:moon'])
   throw new Error('Moon Base reflection cache is missing');
  await waitFor('Players',loadPlayerModel);
  await waitFor('Ball',loadBallModel);
  rebuildRodMen();
  applyColors();

  function putBall(ball,x,z){
   ball.m.position.set(x,BALL_R,z);
   syncBall(ball);
   shadowDirty();
  }
  const gameplayFov=camera.fov;
  async function capture(name,view,ball,fov=gameplayFov){
   const v=Array.isArray(view)?view:CONFIG.camera.modes[view];
   renderer.setPixelRatio(1);
   renderer.setSize(1440,900,false);
   camera.aspect=1440/900;
   camera.fov=fov;
   camera.updateProjectionMatrix();
   camera.position.set(...v.slice(0,3));
   camera.lookAt(...v.slice(3));
   camera.updateMatrixWorld();
   for(let i=0;i<60;i++)hazeUpdate(1/60);
   renderer.render(scene,camera);
   const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));
   const saved=await fetch('/__save/moon/lighting-renders/'+pass+'-'+name+'.png',{method:'POST',body:blob});
   if(!saved.ok)throw new Error('Could not save '+name);
   const casters=scene.children.filter(o=>o.isLight&&o.visible&&o.intensity>0&&o.castShadow);
   if(cfg.shadows&&(casters.length!==1||casters[0]!==dirLight))
    throw new Error('Expected the directional sun to be the only active shadow caster');
   info.push({name,table:cfg.table,skin:curSkin(cfg.table),pitch:cfg.pitch,camera:v,fov,
    ball:ball.m.position.toArray(),shadows:renderer.shadowMap.enabled,atmosphere:hazeLevel(),
    shadowCasters:casters.map(o=>o.type),calls:renderer.info.render.calls});
  }
  for(const table of pass==='before'?['classic']:['classic','arena','circuit']){
   cfg.table=table;
   const def=CONFIG.tables[table];
   cfg.skins={...cfg.skins,[table]:def.defSkin};
   cfg.pitch=def.skins[def.defSkin].pitch||'pub_classic';
   await waitFor(table,applyTable);
   await waitFor(cfg.pitch,drawField);
   if(!skinGroups[table]?.[def.defSkin]?.children.length)throw new Error('Missing skin for '+table);
   S.seedNext=8;
   startMatchNow('red');
   S.phase='play';
   clearBalls();
   const ball=makeBall('classic');
   putBall(ball,8,8);
   await capture(table+'-gameplay',3,ball);
   if(table==='classic'){
    await capture('wide',wide,ball,65);
    await capture('airlock',airlock,ball,60);
   }
   if(pass==='after'){
    // Raise the goal cameras enough to see over Circuit's high end wall.
    for(const [side,sign] of [['red',-1],['blue',1]]){
     putBall(ball,sign*46,6);
     await capture(table+'-'+side+'-goal',[sign*85,56,0,0,0,0],ball);
    }
   }
  }
  if(pass==='after'){
   cfg.table='classic';
   cfg.pitch='pub_classic';
   await waitFor('Classic',applyTable);
   await waitFor('Pub Classic',drawField);
   const ball=S.balls[0];
   putBall(ball,8,8);
   cfg.shadows=false;
   cfg.atmos='off';
   applyDisplay();
   applyFog();
   await capture('wide-effects-off',wide,ball,65);
   await capture('airlock-effects-off',airlock,ball,60);
  }
  if(errs.length)throw new Error(errs.join('\n'));
  return info;
 };
})();
