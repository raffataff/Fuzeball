window.alienCheck=async function(){
 cfg.table='classic';cfg.skins=cfg.skins||{};cfg.skins.classic='alienTech';
 startMatchNow('ai'); await new Promise(resolve=>selectSkin('classic','alienTech',resolve)); await new Promise(resolve=>setTimeout(resolve,1000));
 let g=skinGroups.classic.alienTech, names=[];g.traverse(o=>{if(o.isMesh)names.push(o.name)});
 camera.position.set(165,115,175);camera.lookAt(0,-8,0);camera.updateProjectionMatrix(); renderer.setPixelRatio(1);renderer.setSize(1280,800,false);renderer.render(scene,camera);
 const blob=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));await fetch('/__save/alien-tech-game.png',{method:'POST',body:blob});
 return {loaded:!!g.children.length,meshes:names.length,decor:names.filter(n=>n.startsWith('alien_decor')),holes:names.filter(n=>n.startsWith('rod_hole')).length,registeredHoles:(skinRodHoles.classic.alienTech||[]).length};
};
