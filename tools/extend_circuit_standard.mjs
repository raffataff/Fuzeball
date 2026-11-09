// Add the two goal floors to the original Circuit GLB without re-exporting its artwork.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const file = 'assets/tables/circuit/fuzeball_table_circuit.glb';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot(), buffer = root.listBuffers()[0];
for (const node of root.listNodes()) if (node.getName().startsWith('standard_goal_floor_')) node.dispose();

// The standard model is a skin template. Its untextured walls originally had
// collapsed UV faces, which become visible as streaks when a skin adds artwork.
// Split triangle corners so each face can use the appropriate planar projection.
for (const node of root.listNodes()) {
  const name=node.getName(), mesh=node.getMesh();
  if (!mesh || !/^(table_base|wall_|goal_frame_header)/.test(name)) continue;
  const m=node.getWorldMatrix();
  const world=(v)=>{
    const x=m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12];
    const y=m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13];
    const z=m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14];
    return [x,-z,y]; // Blender coordinates used by the Circuit skin builders.
  };
  for (const prim of mesh.listPrimitives()) {
    const position=prim.getAttribute('POSITION'), index=prim.getIndices();
    if (!position) continue;
    const count=index ? index.getCount() : position.getCount();
    if (count%3) throw new Error('Expected triangles: '+name);
    const sourceIds=Array.from({length:count},(_,i)=>index?index.getScalar(i):i);
    const attributes=prim.listSemantics().filter(s=>s!=='TEXCOORD_0');
    for (const semantic of attributes) {
      const old=prim.getAttribute(semantic), size=old.getElementSize(), ArrayType=old.getArray().constructor;
      const values=new ArrayType(count*size), tmp=[];
      sourceIds.forEach((id,i)=>{ old.getElement(id,tmp); values.set(tmp.slice(0,size),i*size); });
      prim.setAttribute(semantic,doc.createAccessor().setType(old.getType()).setArray(values).setNormalized(old.getNormalized()).setBuffer(buffer));
    }
    const uv=new Float32Array(count*2);
    for (let i=0;i<count;i+=3) {
      const p=sourceIds.slice(i,i+3).map(id=>world(position.getElement(id,[])));
      const a=p[1].map((v,k)=>v-p[0][k]), b=p[2].map((v,k)=>v-p[0][k]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
      const top=axis===2 && n[2]>0 && p.every(v=>v[2]>15.45);
      for (let k=0;k<3;k++) {
        const [x,y,z]=p[k]; let u,v;
        if(name.startsWith('table_base')) {
          if(axis===0) [u,v]=[(y+28)/56,.5+(z+26)/56];
          else if(axis===1) [u,v]=[(x+68.5)/137,(z+43)/34.25];
          else [u,v]=[(x+68.5)/137,(y+35.6)/34.25];
        } else if(top && name.startsWith('wall_side')) [u,v]=[(x+68.5)/137,(Math.abs(y)-34)/3];
        else if(top) [u,v]=[(y+34)/68,(Math.abs(x)-60)/8.5];
        else if(axis===2) [u,v]=[(x+68.5)/137,(y+34)/34.25];
        else if(axis===1) [u,v]=[(x+68.5)/137,(z+.6)/16.2];
        else [u,v]=[(y+34)/68,(z+.6)/16.2];
        uv[(i+k)*2]=u; uv[(i+k)*2+1]=v;
      }
    }
    prim.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
    prim.setIndices(null);
  }
}
const material = doc.createMaterial('Circuit | goal floor').setBaseColorFactor([.012,.016,.022,1]).setMetallicFactor(.12).setRoughnessFactor(.66);
// Coordinates are glTF Y-up. The top is at -0.005, matching Synaptic Relic.
const p = [], n = [], indices = [];
for (const [normal, corners] of [
  [[0,1,0],[[-4.25,.05,-11],[4.25,.05,-11],[4.25,.05,11],[-4.25,.05,11]]],
  [[0,-1,0],[[-4.25,-.05,11],[4.25,-.05,11],[4.25,-.05,-11],[-4.25,-.05,-11]]],
  [[1,0,0],[[4.25,-.05,-11],[4.25,-.05,11],[4.25,.05,11],[4.25,.05,-11]]],
  [[-1,0,0],[[-4.25,-.05,11],[-4.25,-.05,-11],[-4.25,.05,-11],[-4.25,.05,11]]],
  [[0,0,1],[[4.25,-.05,11],[-4.25,-.05,11],[-4.25,.05,11],[4.25,.05,11]]],
  [[0,0,-1],[[-4.25,-.05,-11],[4.25,-.05,-11],[4.25,.05,-11],[-4.25,.05,-11]]],
]) {
  const start=p.length/3;
  for (const c of corners) { p.push(...c); n.push(...normal); }
  indices.push(start,start+2,start+1,start,start+3,start+2);
}
const pos=doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer);
const norm=doc.createAccessor().setType('VEC3').setArray(new Float32Array(n)).setBuffer(buffer);
const idx=doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer);
const mesh=doc.createMesh('standard_goal_floor').addPrimitive(doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('NORMAL',norm).setIndices(idx).setMaterial(material));
for (const end of [-1,1]) root.getDefaultScene().addChild(doc.createNode('standard_goal_floor_'+(end<0?'left':'right')).setMesh(mesh).setTranslation([end*64.23,-.055,0]));
await io.write(file,doc);
