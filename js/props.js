'use strict';
/* ===== prop library + instancing =========================================
   A ROOM is a shell; the things that fill it are PROPS, and a prop is one small
   GLB in assets/props/ that any room may use.

   WHAT THIS IS AND IS NOT FOR. It is NOT a draw-call fix — that was measured before
   it was built and the numbers say the opposite. The pub backdrop is 47 meshes, 69
   draw calls and 5,472 triangles; its five beams and three stools cost 4 draw calls
   out of 69. Instancing them saves nothing you could detect. What that GLB actually
   costs is 16 textures: 44.7 MB in the file and ~167 MB uploaded to the GPU (the
   arcade is ~216 MB). A 2048-square texture is 21 MB of VRAM however small its jpg is.
   So the wins here are the two that scale:
     * SHARED ASSETS. A prop is loaded, decoded and uploaded ONCE and every room that
       places it reuses that upload. Today each room glb re-ships its own copy of
       everything it contains, which is exactly why they are 45 MB each.
     * COUNT. Hundreds or thousands of copies — a crowd — is where instancing is the
       only option. That is FEATURE-IDEAS 4.1 and it is what this is really for.
   If a room feels heavy, the profiler (M) will say GPU/BROWSER and the fix is texture
   size, not this file.

   HOW IT WORKS. A prop template is flattened ONCE into parts: one entry per
   (geometry, material) pair, each carrying its own transform inside the prop. Placing
   the prop N times builds one THREE.InstancedMesh per PART with N instances, so a
   3-mesh chair placed 200 times is 3 draw calls, not 600. Instance matrix is
   place x partLocal, so a prop's internal structure survives instancing.

   THE DISPOSAL TRAP, and it is the same one the power-up pickups have: an
   InstancedMesh SHARES its geometry and material with the resident template. Freeing a
   room's props must remove the instanced meshes and NOTHING else — dispose the shared
   geometry and every future room that places that prop renders nothing. Only
   disposeProp() (evicting the template itself) may free those.

   LIGHTS ARE STRIPPED FROM PROPS ON PURPOSE. r128 bakes the scene's light COUNT into
   every material's program, so a prop arriving with a lamp in it would force a
   whole-scene shader recompile the moment a room is shown. Same rule as the fx light
   pool — see the 2026-07-24 entry. Use an emissive material, or borrow from fxLightGet.
   ========================================================================= */

const propTemplates={};   // id -> {parts:[{geo,mat,m}], box} — flattened, resident, shared
const propLoading={};     // id -> [cbs] while its glb is in flight
const propFailed={};      // ids whose glb 404'd (latched, session-scoped, like roomFailed)
const propGroups={};      // roomId -> THREE.Group of InstancedMeshes (parallel to roomGroups)
let propManifest=null;    // assets/props/manifest.json, if present

/* The web cannot list a directory over file://, so "any glb in a folder" needs a
   manifest. tools/build_props_manifest.js writes one; CONFIG.props.lib overrides or
   adds to it, so a prop can also be declared by hand with no build step. */
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

/* --- template load + flatten --------------------------------------------- */
/* Flatten a loaded prop into (geometry, material) PARTS, each with its transform
   relative to the prop root. Done once, at load: instancing a prop later is then a
   pure matrix job with no scene-graph walk. `fit`/`ground` normalise the authored
   scale so a prop dropped in from Blender arrives usable without hand-tuning —
   `fit` is a target HEIGHT (what you actually know about a chair), not a bounding
   radius, and `ground` sits its base on y=0 so placements are floor coordinates. */
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
 new THREE.GLTFLoader().load(url,gltf=>{
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

/* --- deterministic scatter ------------------------------------------------
   Every scatter is driven by a SEEDED rng (mulberry32), so a layout is identical on
   every load and on every machine. That is not a nicety: a crowd that re-rolls each
   time cannot be art-directed, cannot be screenshotted twice the same way, and turns
   any "does this look right" judgement into guesswork. Change `seed` to reroll. */
function propRng(seed){let a=(seed|0)||1;return function(){
 a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
 return((t^t>>>14)>>>0)/4294967296;};}

/* Turn one placement spec into a flat list of {p,ry,s,tint}. `at` is explicit
   placement; `scatter` generates. Both may appear — explicit entries come first. */
function propPlacements(spec,rngSeed){
 const out=[],R=propRng(spec.seed===undefined?rngSeed:spec.seed);
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

/* --- build / free --------------------------------------------------------- */
/* One InstancedMesh per PART per spec. Instance matrix = place x partLocal, so a
   multi-mesh prop keeps its internal structure. Counts are capped: a typo in `n`
   should cost a console line, not a gigabyte of instance matrices. */
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
/* Build (or rebuild) every prop a room declares. Async only where a template still
   has to download; the common case — templates already resident — completes on the
   spot, so switching rooms does not pop props in a frame late. */
function buildRoomProps(id,rm,cb){
 const P=(typeof CONFIG!=='undefined'&&CONFIG.props)||{};
 const specs=(rm&&rm.props)||[];
 disposeRoomProps(id);
 if(P.on===false||!specs.length){if(cb)cb();return;}
 let left=specs.length;
 const done=()=>{
  if(--left>0)return;
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
/* Remove a room's instanced meshes. Deliberately does NOT dispose geometry or
   materials — those belong to the resident template and are shared by every other
   room placing the same prop. See the trap note at the top of this file. */
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
/* Compile a room's prop materials off-screen, so the first frame a room is shown is
   not a shader stall. Same discipline as warmPowerupShaders / warmFractureTemplate. */
function warmPropShaders(g){
 if(!renderer||!scene||!camera||!g)return;
 const vis=g.visible;g.visible=true;
 renderer.compile(scene,camera);
 g.visible=vis;
}
