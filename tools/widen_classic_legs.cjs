// Widen the existing Classic legs without re-exporting or changing embedded textures.
// Run once on the original assets. UV coordinates retain their painted features.
const fs = require('fs');
const path = require('path');
for (const skin of ['sundayLeague', 'proLeague', 'strike']) {
  const file = path.join('assets/tables/classic', `fuzeball_table_classic_${skin}.glb`);
  const input = fs.readFileSync(file);
  const jsonLength = input.readUInt32LE(12);
  const doc = JSON.parse(input.subarray(20, 20 + jsonLength).toString());
  const binary = Buffer.from(input.subarray(20 + jsonLength + 8));
  let count = 0;
  for (const node of doc.nodes.filter(n => n.name && n.name.startsWith('table_leg'))) {
    for (const primitive of doc.meshes[node.mesh].primitives) {
      const pos = doc.accessors[primitive.attributes.POSITION];
      const norm = doc.accessors[primitive.attributes.NORMAL];
      const view = doc.bufferViews[pos.bufferView];
      if (pos.componentType !== 5126 || norm.bufferView !== pos.bufferView || view.byteStride !== 32 || pos.min[1] > -43 || pos.max[1] < -11 || pos.min[0] < -60.1 || pos.max[0] > 60.1) throw Error(`Unexpected leg layout: ${file} ${node.name}`);
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (let i=0;i<pos.count;i++) {
        const offset = (view.byteOffset || 0) + (pos.byteOffset || 0) + i * view.byteStride;
        const x = binary.readFloatLE(offset), y = binary.readFloatLE(offset+4), z = binary.readFloatLE(offset+8);
        const cx = x < 0 ? -58 : 58, cz = z < 0 ? -32 : 32;
        const t = Math.max(0,Math.min(1,(y + 43.978157)/(43.978157-8.736856)));
        const scale = 1.8 + .4*t, ds = .4/(43.978157-8.736856);
        const dx=x-cx,dz=z-cz;
        const p=[cx+dx*scale,y,cz+dz*scale];
        for(let k=0;k<3;k++){binary.writeFloatLE(p[k],offset+4*k);min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
        const no=(view.byteOffset||0)+(norm.byteOffset||0)+i*view.byteStride;
        let nx=binary.readFloatLE(no)/scale, ny=binary.readFloatLE(no+4), nz=binary.readFloatLE(no+8)/scale;
        ny -= ds*(dx*nx+dz*nz); const length=Math.hypot(nx,ny,nz);
        if(length){binary.writeFloatLE(nx/length,no);binary.writeFloatLE(ny/length,no+4);binary.writeFloatLE(nz/length,no+8);}
      }
      pos.min=min;pos.max=max; count++;
    }
  }
  if (!count) throw Error(`No legs: ${file}`);
  let json=Buffer.from(JSON.stringify(doc)); const padding=(4-json.length%4)%4;json=Buffer.concat([json,Buffer.alloc(padding,0x20)]);
  const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  fs.writeFileSync(file,Buffer.concat([header,json,bh,binary]));console.log(file, count, 'leg primitives');
}

