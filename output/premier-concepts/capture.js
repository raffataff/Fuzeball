window.capturePremier = async function(){
 if(typeof Au!=='undefined') Au.init=function(){};
 cfg.table='classic'; cfg.skins.classic='premierLeague'; cfg.pitch='royal'; cfg.room='arcade'; await Promise.all([new Promise(r=>applyTable(r)),new Promise(r=>applyRoom(r))]);
 startMatchNow('ai'); await new Promise(r=>setTimeout(r,6500));
 renderer.setPixelRatio(1); renderer.setSize(1600,1000,false); camera.aspect=1.6; camera.updateProjectionMatrix();
 const views=[[85,85,105,0,8,0],[0,30,115,0,-4,0],[0,145,25,0,0,0]]; const shots=[];
 for(const c of views){camera.position.set(...c.slice(0,3));camera.lookAt(...c.slice(3));camera.updateMatrixWorld();renderer.render(scene,camera);shots.push(renderer.domElement.toDataURL('image/png'));}
 return {shots,info:{table:cfg.table,skin:cfg.skins.classic,pitch:cfg.pitch,room:cfg.room}};
};



