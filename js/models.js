'use strict';
/* ================= GLB table + rod + ball loaders =================
   Optional. If the .glb files are present under assets/ they replace the
   primitive table/rods/ball built in world.js/balls.js; if a file is missing
   or fails, the primitive stays as a fallback. The game's theming/colour/fx
   code keeps working because we repoint fieldMesh / ledMat / netMats at the
   loaded materials, and tint the rod 'team' / 'team_glow' materials per side.
   For balls, we load a single GLB with material slots (classic, fireball,
   cannonball, golden, split) and map them to ball types. */
const rodTemplates={};   // men-count -> loaded rod scene (bar+handle+collar+knob)
let ballModel=null;      // loaded ball GLB scene (with material slots)
const ballMatMap={};     // ballType -> material name in GLB

/* --- static table --------------------------------------------------------- */
function loadTableModel(){
 const load=(url,group,onDone)=>{
  const loader=new THREE.GLTFLoader();
  loader.load(url,gltf=>{
   try{
    const nets=[];
    gltf.scene.traverse(c=>{
     if(!c.isMesh)return;
     c.castShadow=true;c.receiveShadow=true;
     const n=onm(c);
     if(n.startsWith('field'))c.visible=false;
     else if(n.startsWith('led'))ledMat=c.material;
     else if(n.startsWith('goal_net'))nets.push(c);
    });
    scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    if(nets.length>=2){
     nets.sort((a,b)=>wx(a)-wx(b));
     const ln=nets[0],rn=nets[nets.length-1];
     ln.material=ln.material.clone();rn.material=rn.material.clone();
     netMats=[ln.material,rn.material];
    }
    if(group===primTable){
     hideMeshes(primTable);
     if(fieldMesh)fieldMesh.visible=true;
     goalFrames.forEach(g=>g.traverse(c=>{if(c.isMesh)c.visible=false;}));
    }else if(group===arenaTable){
     hideMeshes(arenaTable);
     if(fieldMesh)fieldMesh.visible=true;
    }
    applyTheme();applyColors();drawField();
    console.log(url.split('/').pop()+' loaded');
   }catch(e){console.warn('table GLB hookup failed, keeping primitives',e);}
   if(onDone)onDone();
  },undefined,()=>{if(onDone)onDone();});
 };
 let pending=2;
 const done=()=>{if(--pending===0){/* both attempted */}};
 load('assets/fuzeball_table.glb',primTable,done);
 if(arenaTable)load('assets/fuzeball_table_arena.glb',arenaTable,done);
 else done();
}

/* --- rods ----------------------------------------------------------------- */
function loadRodModels(onReady){
 const loader=new THREE.GLTFLoader();
 const sizes=[1,2,3,5];let left=sizes.length;
 const done=()=>{if(--left===0)onReady();};
 sizes.forEach(n=>loader.load('assets/fuzeball_rod_'+n+'man.glb',
  gltf=>{rodTemplates[n]=gltf.scene;done();},
  undefined,
  ()=>{console.warn('rod_'+n+'man.glb missing, using primitive');done();}));
}

/* Clone the loaded rod for one rod, tinting the team-coloured parts. Returns
   null when that size has no GLB (buildRods then draws the primitive). */
function makeRodModel(men,team){
 const tpl=rodTemplates[men];if(!tpl)return null;
 const g=tpl.clone(true);
 g.traverse(c=>{
  if(!c.isMesh)return;c.castShadow=true;
  const n=onm(c);                              // handle -> team colour; collar/knob -> team glow
  if(n.includes('handle'))c.material=teamMat[team];
  else if(n.includes('collar')||n.includes('knob'))c.material=teamGlow[team];
 });
 return g;
}

/* helpers */
function onm(o){return(o.name||'').toLowerCase();}
function wx(obj){return obj.getWorldPosition(new THREE.Vector3()).x;}
function hideMeshes(obj){if(obj)obj.traverse(c=>{if(c.isMesh)c.visible=false;});}

/* --- ball model ------------------------------------------------------------ */

function loadBallModel(onReady){
  if(!CONFIG.debug?.useBallModel){
    console.log('Ball model disabled via CONFIG.debug.useBallModel');
    if(onReady)onReady();
    return;
  }
  const loader=new THREE.GLTFLoader();
  loader.load('assets/ball_.glb',
    gltf=>{
      ballModel=gltf.scene;
      ballModel.traverse(c=>{
        if(c.isMesh){
          c.castShadow=true;c.receiveShadow=true;
          const name=onm(c);
          if(name){
            ballMatMap[name]=c.material;
            console.log('Ball material slot:',name);
          }
        }
      });
      console.log('ball_.glb loaded with materials:',Object.keys(ballMatMap));
      if(onReady)onReady();
    },
    undefined,
    ()=>{console.warn('ball_.glb missing, using primitive balls');if(onReady)onReady();}
  );
}

function makeBallModel(key){
  if(!ballModel)return null;
  const g=ballModel.clone(true);
  const t=BALL_TYPES[key];
  const matName=key.toLowerCase();
  let mat=ballMatMap[matName];
  if(!mat && ballMatMap['classic'])mat=ballMatMap['classic'];
  g.traverse(c=>{
    if(c.isMesh){
      if(mat)c.material=mat;
      c.castShadow=true;c.receiveShadow=true;
    }
  });
  return g;
}
