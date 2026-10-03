'use strict';
// ===== prop library + instancing =====
// a room is a shell filled with props; a prop is one small GLB in assets/props/ that any room may use
// not a draw-call fix (a room's cost is its textures, ~167 MB uploaded for the pub): the wins are shared assets (a prop is loaded and uploaded once for every room) and count (crowds, FEATURE-IDEAS 4.1)
// a template is flattened into parts (one per geometry+material pair); N placements build one InstancedMesh per part, matrix = place x partLocal
// disposal trap: instanced meshes share geometry and material with the resident template, so freeing a room's props removes the meshes only (disposeProp() may free the template)
// lights are stripped from props (r128 bakes the light count into every program): use an emissive material or fxLightGet

const propTemplates={};   // id -> {parts:[{geo,mat,m}], box} — flattened, resident, shared
const propLoading={};     // id -> [cbs] while its glb is in flight
const propFailed={};      // ids whose glb 404'd (latched, session-scoped, like roomFailed)
const propGroups={};      // roomId -> THREE.Group of InstancedMeshes (parallel to roomGroups)
let propManifest=null;    // assets/props/manifest.json, if present

// the web can't list a directory over file://, so tools/build_props_manifest.js writes a manifest; CONFIG.props.lib overrides or adds to it
function propLib(){
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 return Object.assign({},(propManifest&&propManifest.props)||{},P.lib||{});
}
function propDef(id){const d=propLib()[id];return d?Object.assign({},(CONFIG.props&&CONFIG.props.defaults)||{},d):null;}
function propIds(){return Object.keys(propLib());}
function loadPropManifest(cb){
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 if(P.on===false||!P.manifest){if(cb)cb();return;}
 fetch((P.folder||'')+P.manifest).then(r=>r.ok?r.json():null).then(j=>{
  if(j)propManifest=j;
  console.log('prop manifest: '+(j?Object.keys(j.props||{}).length+' props':'none'));
  if(cb)cb();
 }).catch(()=>{if(cb)cb();});   // no manifest is a legal state — CONFIG.props.lib still works
}

// --- template load + flatten ---
// flatten a loaded prop into (geometry, material) parts relative to the root, once at load; `fit` is a target height, `ground` sits the base on y=0
function propFlatten(root,d){
 root.updateMatrixWorld(true);
 const strip=[];
 root.traverse(c=>{if(c.isLight)strip.push(c);});
 strip.forEach(l=>{if(l.parent)l.parent.remove(l);});   // never change the scene light count
 if(strip.length)console.warn('prop "'+d.id+'": '+strip.length+' baked light(s) stripped — use emissive or fxLightGet');
 const box=new THREE.Box3().setFromObject(root);
 const size=new THREE.Vector3();box.getSize(size);
 let s=(d.scale===undefined?1:d.scale);
 if(d.fit>0&&size.y>1e-6)s*=d.fit/size.y;              // fit = target height in world units
 const dy=(d.ground===false)?0:-box.min.y*s;           // sit the base on the floor
 const norm=new THREE.Matrix4().makeScale(s,s,s);
 norm.premultiply(new THREE.Matrix4().makeTranslation(0,dy,0));
 if(d.yaw)norm.premultiply(new THREE.Matrix4().makeRotationY(d.yaw));
 const parts=[];
 root.traverse(c=>{
  if(!c.isMesh||!c.geometry)return;
  const mats=Array.isArray(c.material)?c.material:[c.material];
  const groups=(c.geometry.groups&&c.geometry.groups.length&&mats.length>1)?c.geometry.groups:null;
  const m=new THREE.Matrix4().multiplyMatrices(norm,c.matrixWorld);
  if(groups)groups.forEach(g=>{const mm=mats[g.materialIndex];if(mm)parts.push({geo:c.geometry,mat:mm,m,group:g});});
  else parts.push({geo:c.geometry,mat:mats[0],m});
 });
 return {parts,box,scale:s};
}
function ensureProp(id,cb){
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 const d=propDef(id);
 if(P.on===false||!d||propFailed[id]){if(cb)cb();return;}
 if(propTemplates[id]){if(cb)cb();return;}
 if(propLoading[id]){if(cb)propLoading[id].push(cb);return;}
 const cbs=propLoading[id]=cb?[cb]:[];
 const flush=()=>{delete propLoading[id];cbs.forEach(f=>f&&f());};
 const url=(d.folder!==undefined?d.folder:(P.folder||''))+d.src;
 newGLTF().load(url,gltf=>{
  try{
   if(typeof applyEmissiveStrength==='function')applyEmissiveStrength(gltf.scene);
   propTemplates[id]=propFlatten(gltf.scene,Object.assign({id},d));
   console.log('prop "'+id+'" loaded ('+d.src+', '+propTemplates[id].parts.length+' part(s))');
  }catch(e){console.warn('prop flatten failed for '+id,e);propFailed[id]=true;}
  flush();
 },undefined,()=>{
  propFailed[id]=true;console.warn('prop glb missing: '+url);flush();
 });
}

// --- deterministic scatter ---
// every scatter uses a seeded rng (mulberry32), so a layout is identical on every load and machine (change `seed` to reroll)
function propRng(seed){let a=(seed|0)||1;return function(){
 a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
 return((t^t>>>14)>>>0)/4294967296;};}

// one placement spec to a flat list of {p,ry,s,tint}: `at` is explicit, `scatter` generates, explicit entries first
// baseSeed, not rngSeed: that's a global function (js/rng.js) and the parameter would shadow it
function propPlacements(spec,baseSeed){
 const out=[],R=propRng(spec.seed===undefined?baseSeed:spec.seed);
 const num=(v,d)=>(typeof v==='number'?v:d);
 const jit=(j,k)=>j&&j[k]?(R()*2-1)*j[k]:0;
 const pick=t=>(t&&t.length)?t[(R()*t.length)|0]:null;
 const push=(x,y,z,ry,s)=>{
  const j=spec.jitter;
  out.push({p:[x+jit(j,'x'),y+jit(j,'y'),z+jit(j,'z')],
   ry:ry+jit(j,'ry'),
   s:s*(1+(spec.scaleVar?(R()*2-1)*spec.scaleVar:0)),
   tint:pick(spec.tint)});
 };
 (spec.at||[]).forEach(a=>push(num(a[0],0),num(a[1],0),num(a[2],0),num(a[3],0),num(a[4],1)));
 const sc=spec.scatter;
 if(sc){
  const c=sc.at||[0,0,0],base=num(sc.scale,1),n=Math.max(0,sc.n|0);
  // facing: 'in' looks at the centre, 'out' away, a number is a fixed yaw, else random
  const face=(x,z)=>{
   if(sc.face==='in')return Math.atan2(c[0]-x,c[2]-z);
   if(sc.face==='out')return Math.atan2(x-c[0],z-c[2]);
   if(typeof sc.face==='number')return sc.face;
   return R()*Math.PI*2;
  };
  if(sc.kind==='ring'){
   const rO=num(sc.r,100),rI=num(sc.rInner,rO),rows=Math.max(1,sc.rows|0||1);
   const a0=num(sc.from,0),a1=num(sc.to,Math.PI*2),per=Math.ceil(n/rows);
   for(let k=0,i=0;k<rows&&i<n;k++){
    const rr=rows===1?rO:rI+(rO-rI)*(k/(rows-1));
    const yy=num(c[1],0)+k*num(sc.rowRise,0);
    for(let q=0;q<per&&i<n;q++,i++){
     const t=(a1-a0)*((q+(sc.stagger&&k%2?0.5:0))/per)+a0;
     const x=c[0]+Math.sin(t)*rr,z=c[2]+Math.cos(t)*rr;
     push(x,yy,z,face(x,z),base);
    }
   }
  }else if(sc.kind==='grid'){
   const nx=Math.max(1,sc.nx|0||1),nz=Math.max(1,sc.nz|0||1);
   const w=num(sc.w,100),d=num(sc.d,100);
   for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
    const x=c[0]+(nx===1?0:(ix/(nx-1)-0.5)*w),z=c[2]+(nz===1?0:(iz/(nz-1)-0.5)*d);
    push(x,num(c[1],0),z,face(x,z),base);
   }
  }else if(sc.kind==='box'){
   const w=num(sc.w,100),d=num(sc.d,100);
   for(let i=0;i<n;i++){const x=c[0]+(R()-0.5)*w,z=c[2]+(R()-0.5)*d;push(x,num(c[1],0),z,face(x,z),base);}
  }else if(sc.kind==='line'){
   const a=sc.a||[0,0,0],b=sc.b||[0,0,0];
   for(let i=0;i<n;i++){const t=n===1?0:i/(n-1);
    const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,z=a[2]+(b[2]-a[2])*t;push(x,y,z,face(x,z),base);}
  }
 }
 return out;
}

// --- build / free ---
// one InstancedMesh per part per spec; counts are capped (a typo in `n` should cost a console line, not a gigabyte)
function propBuildSpec(group,spec,seed,specIndex){
 const t=propTemplates[spec.prop];if(!t)return 0;
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 let places=propPlacements(spec,seed);
 const cap=P.maxInstances||2048;
 if(places.length>cap){console.warn('prop "'+spec.prop+'": '+places.length+' instances capped to '+cap);places=places.slice(0,cap);}
 if(!places.length)return 0;
 const mP=new THREE.Matrix4(),mI=new THREE.Matrix4(),q=new THREE.Quaternion(),
       pos=new THREE.Vector3(),scl=new THREE.Vector3(),e=new THREE.Euler(),col=new THREE.Color();
 let made=0;
 t.parts.forEach(part=>{
  const im=new THREE.InstancedMesh(part.geo,part.mat,places.length);
  im.castShadow=spec.castShadow!==false;im.receiveShadow=spec.receiveShadow!==false;
  im.frustumCulled=false;                 // one bounds for the whole scatter would cull the lot at the edges
  if(part.group){im.geometry=part.geo;}   // multi-material geometry: three draws the whole buffer per material
  places.forEach((pl,i)=>{
   e.set(pl.rx||0,pl.ry||0,pl.rz||0);q.setFromEuler(e);
   pos.set(pl.p[0],pl.p[1],pl.p[2]);scl.set(pl.s,pl.s,pl.s);
   mP.compose(pos,q,scl);
   mI.multiplyMatrices(mP,part.m);
   im.setMatrixAt(i,mI);
   if(pl.tint!==null&&pl.tint!==undefined&&im.setColorAt){col.set(pl.tint);im.setColorAt(i,col);}
  });
  im.instanceMatrix.needsUpdate=true;
  if(im.instanceColor)im.instanceColor.needsUpdate=true;
  im.userData.propId=spec.prop;
  im.userData.specIndex=specIndex;   // js/roomedit.js maps a picked instance back to its spec
  group.add(im);made++;
 });
 return made;
}
// build (or rebuild) every prop a room declares; async only where a template still downloads, so room switches don't pop props in late
function buildRoomProps(id,rm,cb){
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 const specs=(rm&&rm.props)||[];
 disposeRoomProps(id);
 if(typeof shadowDirty==='function')shadowDirty();   // props are casters; the editor rebuilds on every edit
 if(P.on===false||!specs.length){if(cb)cb();return;}
 let left=specs.length;
 const done=()=>{
  if(--left>0)return;
  // boot applies the room more than once, so two builds can be in flight; the second would orphan the first (props drawn twice)
  disposeRoomProps(id);
  const g=propGroups[id]=new THREE.Group();g.name='props:'+id;
  g.visible=false;scene.add(g);
  let n=0,inst=0;
  specs.forEach((s,i)=>{const k=propBuildSpec(g,s,(P.seed||1)+i*7919,i);n+=k;
   inst+=(propTemplates[s.prop]?1:0);});
  console.log('room "'+id+'" props: '+inst+'/'+specs.length+' spec(s), '+n+' instanced draw(s)');
  if(typeof warmPropShaders==='function')warmPropShaders(g);
  if(cb)cb();
 };
 specs.forEach(s=>ensureProp(s.prop,done));
}
// remove a room's instanced meshes; geometry and materials belong to the resident template
function disposeRoomProps(id){
 const g=propGroups[id];if(!g)return;
 scene.remove(g);
 g.children.forEach(im=>{if(im.dispose)im.dispose();});   // frees the instance buffers only
 g.clear?g.clear():(g.children.length=0);
 delete propGroups[id];
}
/* Free a TEMPLATE (its geometry/materials/textures). Only safe once no room places it. */
function disposeProp(id){
 const t=propTemplates[id];if(!t)return;
 for(const pid in propGroups)if((propGroups[pid].children||[]).some(c=>c.userData.propId===id))return;
 const seen=new Set();
 t.parts.forEach(p=>{
  if(p.geo&&!seen.has(p.geo)){seen.add(p.geo);p.geo.dispose&&p.geo.dispose();}
  if(p.mat&&!seen.has(p.mat)){seen.add(p.mat);
   for(const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap'])
    {const x=p.mat[k];if(x&&x.dispose)x.dispose();}
   p.mat.dispose&&p.mat.dispose();}
 });
 delete propTemplates[id];console.log('prop freed: '+id);
}
// compile a room's prop materials off-screen so the first frame isn't a shader stall
function warmPropShaders(g){
 if(!renderer||!scene||!camera||!g)return;
 const vis=g.visible;g.visible=true;
 renderer.compile(scene,camera);
 g.visible=vis;
}
