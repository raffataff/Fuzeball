'use strict';
/* ===== arena table (curved walls) ===== */
function sdRRect(x,z,hx,hz,r){const qx=Math.abs(x)-hx+r,qz=Math.abs(z)-hz+r;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;}
function sdBox2(x,z,cx,cz,hx,hz){const qx=Math.abs(x-cx)-hx,qz=Math.abs(z-cz)-hz;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0);}
function smin(a,b,k){const h=clamp(.5+.5*(b-a)/k,0,1);return lerp(b,a,h)-k*h*(1-h);}

// ---- combined arena SDF (plan view) ----
function arenaSD(x,z,gh0,gh1){
 const r=sdRRect(x,z,F.L/2,F.W/2,ARENA.cornerR);
 // goal cavities: axis-aligned boxes at ±x
 const ghL=F.L/2-ARENA.mouthIn;
 const s0=sdBox2(x,z, ghL+ARENA.mouthIn,0,ARENA.mouthIn+F.goalDepth,gh0);
 const s1=sdBox2(x,z,-ghL-ARENA.mouthIn,0,ARENA.mouthIn+F.goalDepth,gh1);
 return smin(smin(r,s0,ARENA.postR),s1,ARENA.postR);
}

// ---- gradient (outward, toward wall) by central differences ----
let _gCache={x:0,z:0,sd:0};
function arenaGrad(x,z,gh0,gh1){
 const e=ARENA.gradEps,sd=arenaSD(x,z,gh0,gh1);
 _gCache.sd=sd;
 const dx=arenaSD(x+e,z,gh0,gh1)-arenaSD(x-e,z,gh0,gh1);
 const dz=arenaSD(x,z+e,gh0,gh1)-arenaSD(x,z-e,gh0,gh1);
 const l=Math.hypot(dx,dz)/(2*e);
 return {x:dx/(2*e*l),z:dz/(2*e*l)};
}

// ---- contact response: roll vs bounce ----
function arenaContact(b,pen,nx,ny,nz){
 const p=b.m.position,v=b.v;
 p.x+=nx*pen;p.y+=ny*pen;p.z+=nz*pen;
 const vn=v.x*nx+v.y*ny+v.z*nz;
 if(vn<0){
  if(-vn>ARENA.bounceCut){const jm=-(1+PHY.wallRest)*vn/b.t.mass;v.x+=nx*jm;v.y+=ny*jm;v.z+=nz*jm;Au.wall(-vn);}
  else{v.x-=vn*nx;v.y-=vn*ny;v.z-=vn*nz;}
  if(ny>ARENA.fricNy){const f=Math.exp(-PHY.floorFric*hStep);v.x*=f;v.z*=f;}
 }
}

// ---- spawn clamp: Newton-project p inward until safely inside ----
function arenaClampSpawn(pp){
 for(let i=0;i<3;i++){
  const gh=F.goalHalf,g=arenaGrad(pp.x,pp.z,gh,gh);
  const d=-arenaSD(pp.x,pp.z,gh,gh);
  if(d<-BALL_R-2)break;
  pp.x-=g.x*(d+BALL_R+2);pp.z-=g.z*(d+BALL_R+2);
 }
}

/* ===== arena table mesh ===== */
let arenaTable=null,arenaLedLine=null,hStep=0;

function buildArenaTable(){
 arenaTable=new THREE.Group();scene.add(arenaTable);
 const CR=ARENA.creaseR,profile=ARENA.seg.profile,perim=ARENA.seg.loop;
 const WH=F.wallH;
 // ---- profile rows: fillet (0..filletP) + wall (filletP..profile) ----
 const filletP=Math.floor(profile*.55);
 const prof=[];
 for(let j=0;j<=profile;j++){
  if(j<=filletP){const th=(j/filletP)*Math.PI/2;prof.push({inset:CR-CR*Math.sin(th),y:CR-CR*Math.cos(th)});}
  else{const t=(j-filletP)/(profile-filletP);prof.push({inset:0,y:CR+(WH-CR)*t});}
 }
 // ---- perimeter samples ----
 // walk the classic outline as a closed polyline
 const halfL=F.L/2,halfW=F.W/2,mi=ARENA.mouthIn;
 const ploop=[];
 const emit=(x,z)=>{ploop.push({x,z,dist:ploop.length?ploop[ploop.length-1].dist+Math.hypot(x-ploop[ploop.length-1].x,z-ploop[ploop.length-1].z):0});};
 // start at left goal, top post, then walk counter-clockwise
 emit(-halfL,-F.goalHalf);            // left top post
 emit(-halfL+mi,-F.goalHalf);        // goal top lip start
 emit(-halfL+mi+F.goalDepth,-F.goalHalf); // back of goal top
 emit(-halfL+mi+F.goalDepth, F.goalHalf); // back of goal bottom
 emit(-halfL+mi, F.goalHalf);        // goal bottom lip end
 emit(-halfL, F.goalHalf);           // left bottom post
 emit(-halfL, halfW);                // bottom-left straight
 emit( halfL, halfW);                // bottom straight
 emit( halfL, F.goalHalf);           // right bottom post
 emit( halfL-mi, F.goalHalf);        // right goal bottom lip
 emit( halfL-mi-F.goalDepth, F.goalHalf); // back of right goal bottom
 emit( halfL-mi-F.goalDepth,-F.goalHalf); // back of right goal top
 emit( halfL-mi,-F.goalHalf);        // right goal top lip
 emit( halfL,-F.goalHalf);           // right top post
 emit( halfL,-halfW);                // top straight
 const last=ploop[ploop.length-1],first=ploop[0];
 const ld=Math.hypot(last.x-first.x,last.z-first.z);
 // ---- projectile onto SDF contour ----
 const gh0=F.goalHalf,gh1=F.goalHalf; // default goal halves for mesh
 function project(x,z,targetSD,iters){
  for(let i=0;i<iters;i++){
   const sd=arenaSD(x,z,gh0,gh1),g=arenaGrad(x,z,gh0,gh1);
   const err=sd-targetSD;x-=g.x*err;z-=g.z*err;
  }
  return {x,z};
 }
 // ---- sample perimeter evenly ----
 const totalLen=ploop[ploop.length-1].dist+ld;
 const samples=[];
 let ci=0;
 for(let i=0;i<perim;i++){
  const want=i/perim*totalLen;
  while(ci+1<ploop.length&&ploop[ci+1].dist<want){ci++;}
  let t=0;if(ci+1<ploop.length){
   const d0=ploop[ci].dist,d1=ploop[ci+1].dist;
   t=clamp((want-d0)/(d1-d0||1),0,1);
  }
  const px=lerp(ploop[ci].x,ploop[Math.min(ci+1,ploop.length-1)].x,t);
  const pz=lerp(ploop[ci].z,ploop[Math.min(ci+1,ploop.length-1)].z,t);
  samples.push({x:px,z:pz});
 }
 // ---- build quad grid ----
 const verts=[],uvs=[],norms=[];
 for(let j=0;j<=profile;j++){
  const r=prof[j];
  for(let i=0;i<=perim;i++){
   const si=i%perim;
   const sp=samples[si];
   const pr=project(sp.x,sp.z,-r.inset,3);
   verts.push(pr.x,r.y,pr.z);
   uvs.push(i/perim,j/profile);
   // normal approximation
   const ga=arenaGrad(pr.x,pr.z,gh0,gh1);
   const nx=ga.x,ny=(r.y-CR)/CR,nz=ga.z;
   const nl=Math.hypot(nx,ny,nz);
   norms.push(nx/nl,ny/nl,nz/nl);
  }
 }
 // build indices for (profile) rows × (perim) quads
 const idx=[];
 for(let j=0;j<profile;j++){
  for(let i=0;i<perim;i++){
   const a=j*(perim+1)+i,b=a+1,c=a+(perim+1),d=c+1;
   idx.push(a,b,d,a,d,c);
  }
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(verts),3));
 geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uvs),2));
 geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(norms),3));
 geo.setIndex(idx);
 const mesh=new THREE.Mesh(geo,wallMat);
 mesh.receiveShadow=true;mesh.castShadow=true;
 arenaTable.add(mesh);

 // ---- LED top-lip ring ----
 const lipVerts=[];
 for(let i=0;i<=perim;i++){
  const si=i%perim,sp=samples[si];
  const pr=project(sp.x,sp.z,0,3);
  lipVerts.push(new THREE.Vector3(pr.x,WH+.15,pr.z));
 }
 if(lipVerts.length>=2){
  const pathCurve=new THREE.CatmullRomCurve3(lipVerts,true);
  const lipGeo=new THREE.TubeGeometry(pathCurve,perim,.35,6,true);
  arenaLedLine=new THREE.Mesh(lipGeo,ledMat);
  arenaTable.add(arenaLedLine);
 }

  // ---- table body + legs (same geometry as classic, but owned by arenaTable) ----
  const bodyGeo=new THREE.BoxGeometry(F.L+10,10,F.W+10);
  const body=new THREE.Mesh(bodyGeo,wallMat);
  body.position.y=-5.2;body.receiveShadow=true;arenaTable.add(body);
  const legGeo=new THREE.BoxGeometry(4,34,4);
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(s=>{
   const l=new THREE.Mesh(legGeo,wallMat);
   l.position.set(s[0]*(F.L/2-2),-27,s[1]*(F.W/2-2));arenaTable.add(l);
  });

  arenaTable.visible=false;
  return arenaTable;
}

/* ===== active flag ===== */
let ARENA_ON=false;
function applyTable(){
 ARENA_ON=cfg.table==='arena';
 if(primTable)primTable.visible=!ARENA_ON;
 if(arenaTable)arenaTable.visible=ARENA_ON;
}

/* ===== arena debug wireframe ===== */
function buildArenaDebugMesh(){
 const CR=ARENA.creaseR,profile=6,perim=80,WH=F.wallH;
 const pfl=[];
 const fp=Math.floor(profile*.55);
 for(let j=0;j<=profile;j++){
  if(j<=fp){const th=(j/fp)*Math.PI/2;pfl.push({inset:CR-CR*Math.sin(th),y:CR-CR*Math.cos(th)});}
  else{const t=(j-fp)/(profile-fp);pfl.push({inset:0,y:CR+(WH-CR)*t});}
 }
 const halfL=F.L/2,halfW=F.W/2,mi=ARENA.mouthIn;
 const ploop=[],emit=(x,z)=>{ploop.push({x,z});};
 emit(-halfL,-F.goalHalf);emit(-halfL+mi,-F.goalHalf);emit(-halfL+mi+F.goalDepth,-F.goalHalf);
 emit(-halfL+mi+F.goalDepth,F.goalHalf);emit(-halfL+mi,F.goalHalf);emit(-halfL,F.goalHalf);
 emit(-halfL,halfW);emit(halfL,halfW);emit(halfL,F.goalHalf);emit(halfL-mi,F.goalHalf);
 emit(halfL-mi-F.goalDepth,F.goalHalf);emit(halfL-mi-F.goalDepth,-F.goalHalf);emit(halfL-mi,-F.goalHalf);
 emit(halfL,-F.goalHalf);emit(halfL,-halfW);
 const tl=ploop.reduce((s,p,i)=>{if(i===0)return 0;const pp=ploop[i-1];return s+Math.hypot(p.x-pp.x,p.z-pp.z);},0);
 const gh0=F.goalHalf,gh1=F.goalHalf;
 function proj(x,z,tSD){for(let i=0;i<3;i++){const sd=arenaSD(x,z,gh0,gh1),g=arenaGrad(x,z,gh0,gh1);const e=sd-tSD;x-=g.x*e;z-=g.z*e;}return{x,z};}
 const samples=[],sp=ploop;
 let ci=0;
 for(let i=0;i<perim;i++){
  const want=i/perim*tl;
  while(ci+1<sp.length&&ploop[ci]&&ci+1<sp.length){
   let cd=0;for(let k=1;k<=ci;k++)cd+=Math.hypot(sp[k].x-sp[k-1].x,sp[k].z-sp[k-1].z);
   if(cd>=want)break;ci++;
  }
  let t=0;
  if(ci+1<sp.length){
   let cd0=0;for(let k=1;k<=ci;k++)cd0+=Math.hypot(sp[k].x-sp[k-1].x,sp[k].z-sp[k-1].z);
   const cd1=cd0+Math.hypot(sp[ci+1].x-sp[ci].x,sp[ci+1].z-sp[ci].z);
   t=clamp((want-cd0)/(cd1-cd0||1),0,1);
  }
  const px=lerp(sp[Math.min(ci,sp.length-1)].x,sp[Math.min(ci+1,sp.length-1)].x,t);
  const pz=lerp(sp[Math.min(ci,sp.length-1)].z,sp[Math.min(ci+1,sp.length-1)].z,t);
  samples.push({x:px,z:pz});
 }
 const verts=[],idx=[];
 for(let j=0;j<=profile;j++){
  const r=pfl[j];
  for(let i=0;i<=perim;i++){
   const si=i%perim,spv=samples[si],pr=proj(spv.x,spv.z,-r.inset);
   verts.push(pr.x,r.y,pr.z);
  }
 }
 for(let j=0;j<profile;j++){
  for(let i=0;i<perim;i++){
   const a=j*(perim+1)+i,b=a+1,c=a+(perim+1),d=c+1;
   idx.push(a,b,b,d,a,d,a,c,b,c,b,d);
  }
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(verts),3));
 geo.setIndex(idx);
 const mat=new THREE.MeshBasicMaterial({color:0xff3b3b,transparent:true,opacity:.25,wireframe:true,depthWrite:false});
 return new THREE.Mesh(geo,mat);
}
