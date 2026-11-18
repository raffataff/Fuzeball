// node tools/build_stamina_arc.mjs <stock-table.glb> <output.glb>
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const sides = 32;
const step = 2 * Math.PI / sides;
const boreRadius = .456;
const halfWindow = .205;
const rim = .047;
const depth = .105;
const windows = [ .73, .37, 0, .37, .73 ].map((fill, i) => {
 const center = (i - 2) * .50;
 return {start:center - halfWindow, end:center + halfWindow, fill};
});

function polygonRadius(radius, angle) {
 const midpoint = (Math.floor(angle / step) + .5) * step;
 return radius * Math.cos(step / 2) / Math.cos(angle - midpoint);
}

function makeBearing(node, doc, lensMaterial) {
 const mesh = node.getMesh();
 const primitive = mesh.listPrimitives()[0];
 const finish = primitive.getMaterial();
 // Keep Alien Tech's painted patina visible at a lower brightness than the lenses.
 if(finish.getName()==='slide_holes'){
  const name='Alien Tech | darkened bearing patina';
  const patina=doc.getRoot().listMaterials().find(m=>m.getName()===name)
   || finish.clone().setName(name).setBaseColorFactor([.24,.24,.24,1]);
  primitive.setMaterial(patina);
 }
 const position = primitive.getAttribute('POSITION');
 const original = position.getArray();
 const min = position.getMin([]), max = position.getMax([]);
 const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
 const circuit = max[0]-cx > 1.9;
 const radiusAt = i => Math.hypot(original[i*3]-cx,original[i*3+1]-cy);
 const faceDepths = [-1,1].flatMap(side => {
  const depths = [];
  for(let i=2;i<original.length;i+=3)if(original[i]*side>0)depths.push(original[i]*side);
  return [
   {z:side*Math.min(...depths),facing:-side},
   {z:side*Math.max(...depths),facing:side},
  ];
 });
 const faces = new Map(), metalIndices = [];
 const indices = primitive.getIndices().getArray();
 for(let i = 0; i < indices.length; i += 3) {
  const a = indices[i], b = indices[i+1], c = indices[i+2];
  const face = faceDepths.find(({z})=>[a,b,c].every(j=>Math.abs(original[j*3+2]-z)<1e-5));
  if(face&&(!circuit||[a,b,c].some(j=>radiusAt(j)>1.8))){
   if(!faces.has(face))faces.set(face,[]);
   faces.get(face).push([a,b,c]);
  }else metalIndices.push(a,b,c);
 }
 if(faces.size !== 4 || [...faces.values()].some(tris => tris.length !== 2*sides)) {
  throw Error('Unexpected annular face topology on ' + node.getName());
 }

 const attributes = primitive.listSemantics().filter(key=>key!=='TANGENT');
 const metal = Object.fromEntries(attributes.map(key => [key, Array.from(primitive.getAttribute(key).getArray())]));
 const channels = attributes.filter(key=>key!=='POSITION'&&key!=='NORMAL')
  .map(key=>[key,primitive.getAttribute(key).getElementSize()]);
 const boreRim = circuit ? .74 : .66;
 const boreInset = Math.min(...Array.from({length:position.getCount()},(_,i)=>radiusAt(i)))-boreRadius;
 // Shift the bore profile inward without changing the chamfer.
 for(let i = 0; i < original.length; i += 3) {
  const x = original[i] - cx, y = original[i+1] - cy;
  const radius = Math.hypot(x,y);
  if(radius > boreRim) continue;
  const scale = (radius - boreInset) / radius;
  metal.POSITION[i] = cx + x * scale;
  metal.POSITION[i+1] = cy + y * scale;
 }
 const lens = {POSITION:[], NORMAL:[], _STAMINA:[]};
 const lensIndices = [];
 for(const [{z,facing},triangles] of faces) {
  const radii = triangles.flat().map(i=>Math.hypot(metal.POSITION[i*3]-cx,metal.POSITION[i*3+1]-cy));
  const innerEdge = Math.min(...radii), outerEdge = Math.max(...radii);
  const openingInner = circuit ? 1.055 : .94;
  const openingOuter = circuit ? 1.68 : Math.min(1.65,outerEdge-.16);
  const sample = faceSampler(metal,channels,triangles);
  const point = (r, angle, inset = 0) => [cx + r * Math.sin(angle), cy + r * Math.cos(angle), z - facing * inset];
  const metalQuad = (a,b,c,d) => quad(metal, metalIndices, facing, a,b,c,d,undefined,sample);
  const lensQuad = (a,b,c,d,fill) => quad(lens,lensIndices,facing,a,b,c,d,fill);
  addArcFace(point,metalQuad,lensQuad,{innerEdge,outerEdge,openingInner,openingOuter});
 }

 const buffer = position.getBuffer();
 const oldTangent = primitive.getAttribute('TANGENT');
 if(oldTangent){
  primitive.setAttribute('TANGENT',null);
  if(!oldTangent.listParents().some(parent => parent.propertyType === 'Primitive')) oldTangent.dispose();
 }
 for(const [key,data] of Object.entries(metal)) {
  const accessor = primitive.getAttribute(key);
  primitive.setAttribute(key, doc.createAccessor().setType(accessor.getType()).setBuffer(buffer).setArray(new Float32Array(data)));
  if(!accessor.listParents().some(parent => parent.propertyType === 'Primitive')) accessor.dispose();
 }
 const oldIndices = primitive.getIndices();
 primitive.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(metalIndices)));
 if(!oldIndices.listParents().some(parent => parent.propertyType === 'Primitive')) oldIndices.dispose();

 const name = node.getName();
 node.setName(name.replace('rod_hole_', 'rod_bearing_'));
 const lensNode = addMesh(doc,buffer,name.replace('rod_hole_', 'rod_hole_arc_'),lens,lensIndices,lensMaterial)
  .setMatrix(node.getMatrix());
 const parent = node.getParentNode() || node.listParents().find(p => p.propertyType === 'Scene');
 parent.addChild(lensNode);
}

function addMesh(doc,buffer,name,attributes,indices,material) {
 const primitive = doc.createPrimitive().setMaterial(material)
  .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(indices)));
 for(const [key,data] of Object.entries(attributes)) {
  const type = key === '_STAMINA' ? 'SCALAR' : key.startsWith('TEXCOORD_') ? 'VEC2' : 'VEC3';
  primitive.setAttribute(key,doc.createAccessor().setType(type).setBuffer(buffer).setArray(new Float32Array(data)));
 }
 return doc.createNode(name).setMesh(doc.createMesh().addPrimitive(primitive));
}

function addArcFace(point,metalQuad,lensQuad,profile) {
 const {innerEdge,outerEdge,openingInner,openingOuter,first=-Math.PI,last=Math.PI,inset=depth,bevel=rim,mount=0}=profile;
 const angles = [first,last];
 for(let i=-sides/2;i<=sides/2;i++){
  const angle=i*step;
  if(angle>first&&angle<last)angles.push(angle);
 }
 for(const {start,end} of windows)angles.push(start,end);
 angles.sort((a,b)=>a-b);

 const strip = (a,b,r1,r2,r3,r4) => metalQuad(point(r2,a),point(r1,a),point(r3,b),point(r4,b));
 for(let i=0;i<angles.length-1;i++){
  const a=angles[i],b=angles[i+1],mid=(a+b)/2;
  const innerA=polygonRadius(innerEdge,a),innerB=polygonRadius(innerEdge,b);
  const outerA=polygonRadius(outerEdge,a),outerB=polygonRadius(outerEdge,b);
  if(windows.some(w=>mid>w.start&&mid<w.end)){
   strip(a,b,innerA,openingInner,innerB,openingInner);
   strip(a,b,openingOuter,outerA,openingOuter,outerB);
  }else strip(a,b,innerA,outerA,innerB,outerB);
  if(mount){
   metalQuad(point(innerB,b),point(innerA,a),point(innerA,a,mount),point(innerB,b,mount));
   metalQuad(point(outerA,a),point(outerB,b),point(outerB,b,mount),point(outerA,a,mount));
  }
 }
 if(mount){
  const end = (angle,reverse)=>{
   const a=polygonRadius(innerEdge,angle),b=polygonRadius(outerEdge,angle);
   const corners=[point(b,angle),point(a,angle),point(a,angle,mount),point(b,angle,mount)];
   metalQuad(...(reverse?corners.reverse():corners));
  };
  end(first,true);end(last,false);
 }
 for(const {start,end,fill} of windows){
  const opening=angles.filter(angle=>angle>=start&&angle<=end);
  const mouthInner=opening.map(angle=>point(openingInner,angle));
  const mouthOuter=opening.map(angle=>point(openingOuter,angle));
  const insetAngles=opening.map(angle=>start+bevel+(angle-start)*(1-bevel/halfWindow));
  const floorInner=insetAngles.map(angle=>point(openingInner+bevel,angle,inset));
  const floorOuter=insetAngles.map(angle=>point(openingOuter-bevel,angle,inset));
  const endIndex=opening.length-1;
  metalQuad(mouthOuter[0],mouthInner[0],floorInner[0],floorOuter[0]);
  metalQuad(mouthInner[endIndex],mouthOuter[endIndex],floorOuter[endIndex],floorInner[endIndex]);
  for(let i=0;i<endIndex;i++){
   metalQuad(mouthInner[i],mouthInner[i+1],floorInner[i+1],floorInner[i]);
   metalQuad(mouthOuter[i+1],mouthOuter[i],floorOuter[i],floorOuter[i+1]);
   lensQuad(floorOuter[i],floorInner[i],floorInner[i+1],floorOuter[i+1],fill);
  }
 }
}

// Follow the original bowl hardware on each side. The metal lip seats into the bearing.
function addArenaArcs(bowl,doc,lensMaterial){
 const source=bowl.getMesh().listPrimitives().find(p=>/^(Gold|Federation \| Aged hardware|Helios \| anodized gold)$/.test(p.getMaterial()?.getName()));
 if(!source)throw Error('No Arena bearing material');
 const position=source.getAttribute('POSITION');
 const xyz=position.getArray(), uv=source.getAttribute('TEXCOORD_0').getArray(),indices=source.getIndices().getArray();
 const fit={innerEdge:.72,outerEdge:1.21,openingInner:.79,openingOuter:1.145,
  first:-1.26,last:1.26,inset:.082,bevel:.036,mount:.177};
 const rodCenters=[-52.5,-37.5,-22.5,-7.5,7.5,22.5,37.5,52.5];
 for(const [i,cx] of rodCenters.entries()){
  const metal={POSITION:[],NORMAL:[],TEXCOORD_0:[]}, metalIndices=[];
  const lens={POSITION:[],NORMAL:[],_STAMINA:[]}, lensIndices=[];
  for(const side of [-1,1]){
   const triangles=[];
   for(let j=0;j<indices.length;j+=3){
    const ids=[indices[j],indices[j+1],indices[j+2]];
    if(ids.every(k=>xyz[k*3+2]*side>24&&Math.hypot(xyz[k*3]-cx,xyz[k*3+1]-7.5)<2.3))triangles.push(ids);
   }
   const samples=projectTriangles(xyz,triangles);
   for(const facing of [-side,side]){
    const hits=new Map();
    const surface=(x,y)=>{
     const key=x+','+y;
     if(hits.has(key))return hits.get(key);
     let result;
     for(const triangle of samples){
      const weights=projectWeights(triangle,x,y);
      if(Math.min(...weights)<-1e-6)continue;
      const z=triangle.ids.reduce((sum,j,k)=>sum+xyz[j*3+2]*weights[k],0);
      if(!result||z*facing>result.z*facing)result={z,ids:triangle.ids,weights};
     }
     if(!result)throw Error('No projected bearing surface on Arena rod '+(i+1));
     hits.set(key,result);
     return result;
    };
    const point=(r,angle,inset=0)=>{
     const x=cx+r*Math.sin(angle),y=7.5+r*Math.cos(angle);
     return [x,y,surface(x,y).z+facing*(.142-inset)];
    };
    const sample=([x,y])=>sampleChannel(metal.TEXCOORD_0,uv,2,surface(x,y));
    const metalQuad=(a,b,c,d)=>quad(metal,metalIndices,facing,a,b,c,d,undefined,sample);
    const lensQuad=(a,b,c,d,fill)=>quad(lens,lensIndices,facing,a,b,c,d,fill);
    addArcFace(point,metalQuad,lensQuad,fit);
   }
  }
  const buffer=position.getBuffer();
  bowl.addChild(addMesh(doc,buffer,'rod_bearing_arc_'+(i+1),metal,metalIndices,source.getMaterial()));
  bowl.addChild(addMesh(doc,buffer,'rod_hole_arc_'+(i+1),lens,lensIndices,lensMaterial));
 }
}

function projectTriangles(pos,triangles){
 return triangles.map(ids=>{
  const [a,b,c]=ids.map(i=>pos.slice(i*3,i*3+2));
  const ab=[b[0]-a[0],b[1]-a[1]],ac=[c[0]-a[0],c[1]-a[1]];
  return {ids,a,ab,ac,inv:1/(ab[0]*ac[1]-ab[1]*ac[0])};
 }).filter(triangle=>Number.isFinite(triangle.inv));
}

function projectWeights({a,ab,ac,inv},x,y){
 const dx=x-a[0],dy=y-a[1];
 const u=(dx*ac[1]-dy*ac[0])*inv,v=(ab[0]*dy-ab[1]*dx)*inv;
 return [1-u-v,u,v];
}

function sampleChannel(target,source,size,{ids,weights}){
 for(let i=0;i<size;i++)target.push(ids.reduce((sum,j,k)=>sum+source[j*size+i]*weights[k],0));
}

function faceSampler(attributes,channels,triangles) {
 const samples=projectTriangles(attributes.POSITION,triangles);
 return ([x,y])=>{
  let best,bestWeight=-Infinity;
  for(const triangle of samples){
   const weights=projectWeights(triangle,x,y), min=Math.min(...weights);
   if(min>bestWeight){best={ids:triangle.ids,weights};bestWeight=min;}
   if(min>=-1e-6)break;
  }
  for(const [key,size] of channels)sampleChannel(attributes[key],attributes[key],size,best);
 };
}

function quad(attributes, indices, facing, a,b,c,d, fill, sample) {
 const first = attributes.POSITION.length / 3;
 const u = b.map((v,i) => v-a[i]), v = c.map((v,i) => v-a[i]);
 const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
 const inv = facing / Math.hypot(...n);
 for(const p of [a,b,c,d]) {
  attributes.POSITION.push(...p);
  attributes.NORMAL.push(...n.map(x => x*inv));
  if(sample)sample(p);
  if(attributes._STAMINA) attributes._STAMINA.push(fill);
 }
 const order = facing > 0 ? [0,1,2,0,2,3] : [0,2,1,0,3,2];
 indices.push(...order.map(i => i+first));
}

const [input, output] = process.argv.slice(2);
if(!input || !output) throw Error('Supply the stock table GLB and the output path');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const bearings = doc.getRoot().listNodes().filter(n => /^rod_hole_\d+\./.test(n.getName()));
const bowl = doc.getRoot().listNodes().find(n=>n.getName().startsWith('arena_bowl'));
if(bearings.length!==8&&!bowl)throw Error('Expected eight stock bearing meshes or an Arena bowl');
const material = doc.createMaterial('Smoked stamina lens').setBaseColorFactor([.017,.019,.020,1])
 .setRoughnessFactor(.37).setMetallicFactor(.1);
if(bowl){
 if(doc.getRoot().listNodes().some(n=>n.getName().startsWith('rod_hole_arc_')))throw Error('The bowl already has stamina arcs');
 addArenaArcs(bowl,doc,material);
}else for(const bearing of bearings)makeBearing(bearing,doc,material);
await io.write(output,doc);
