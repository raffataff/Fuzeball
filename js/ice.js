'use strict';
// ================= ICE: a block of ice round every man of a frozen team =================
// frost itself only slows the rods (S.eff[team].frozen, rods.js); this is what the player sees: a faceted block fitted to the figurine, hung on the rod pivot so it slides and swings with the man
// one shared geometry per team (a few seeded shapes), two transparent draws a man while frozen and nothing otherwise; the break throws faceted chunks (one instanced draw, flown here) plus vfx.js's glints and mist; tuning in CONFIG.fx.ice

const IC=CONFIG.fx.ice;
// rp = the blocks follow a replay's footage, not the live match
const ICE={built:false,rp:false,tex:null,mat:[null,null],geo:[[],[]],fit:[null,null],key:['',''],pal:[],hot:null,body:null,sh:null,
 tm:[{live:false,age:0,left:0,pulse:0,glint:0},{live:false,age:0,left:0,pulse:0,glint:0}]};
const _icV=new THREE.Vector3(),_icW=new THREE.Color(0xffffff);

function iceHash(n){const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s);}
function iceSm(t){t=t<0?0:t>1?1:t;return t*t*(3-2*t);}

// --- fitting the block to the figurine ---
// the man's own frame: origin at the sole, +x the way the boot points, y up, z across the rod, in table units (the figurine's scale is folded in)
function iceScan(root,s){
 root.updateMatrixWorld(true);
 const out=[],v=new THREE.Vector3();
 root.traverse(o=>{
  const a=o.isMesh&&o.geometry&&o.geometry.attributes.position;if(!a)return;
  for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);out.push(v.x*s,v.y*s,v.z*s);}
 });
 return out;
}
// the figure's outline per height slice: {top, b:[{x0,x1,z0,z1}]}
function iceBands(pts,nb){
 let top=1;for(let i=1;i<pts.length;i+=3)if(pts[i]>top)top=pts[i];
 const b=[];for(let i=0;i<nb;i++)b.push({x0:1e9,x1:-1e9,z0:1e9,z1:-1e9});
 for(let i=0;i<pts.length;i+=3){
  const q=b[clamp(Math.floor(pts[i+1]/top*nb),0,nb-1)];
  if(pts[i]<q.x0)q.x0=pts[i];if(pts[i]>q.x1)q.x1=pts[i];
  if(pts[i+2]<q.z0)q.z0=pts[i+2];if(pts[i+2]>q.z1)q.z1=pts[i+2];
 }
 for(let i=0;i<nb;i++)if(b[i].x0>b[i].x1){const o=b[i>0?i-1:Math.min(nb-1,1)];b[i]={x0:o.x0,x1:o.x1,z0:o.z0,z1:o.z1};}
 for(let i=nb-1;i>=0;i--)if(b[i].x0>b[i].x1&&i+1<nb)b[i]={x0:b[i+1].x0,x1:b[i+1].x1,z0:b[i+1].z0,z1:b[i+1].z1};
 return {top,b};
}
function iceDefault(nb){const b=[];for(let i=0;i<nb;i++)b.push({x0:-1.4,x1:2.0,z0:-1.8,z1:1.8});return {top:10,b};}
// the physical foot box at rest, in the same frame: the block never cuts inside it
function iceFoot(){
 const cy=-ARM*FOOT_T-FOOT_BOX_OFF.x-PLAYER_H;
 return {x0:FOOT_BOX_OFF.y-FOOT_BOX.y,x1:FOOT_BOX_OFF.y+FOOT_BOX.y,z:FOOT_BOX.z,y0:cy-FOOT_BOX.x,y1:cy+FOOT_BOX.x};
}
// one outline per height: snug round the legs and feet where the ball can reach, filling out toward the widest part of the body above
function iceRings(F,P){
 const nb=F.b.length,dy=F.top/nb,fb=P.foot?iceFoot():null,e=[],gy=-(ROD_H+PLAYER_H)+P.gap;
 for(let i=0;i<nb;i++){
  const q=F.b[i],y0=i*dy,y1=y0+dy;
  let x0=q.x0,x1=q.x1,zh=Math.max(Math.abs(q.z0),Math.abs(q.z1));
  if(fb&&y1>fb.y0&&y0<fb.y1){x0=Math.min(x0,fb.x0);x1=Math.max(x1,fb.x1);zh=Math.max(zh,fb.z);}
  e.push({x0,x1,zh});
 }
 let wx0=0,wx1=0,wz=0;
 for(let i=0;i<nb;i++)if((i+0.5)*dy>=P.zone){wx0=Math.min(wx0,e[i].x0);wx1=Math.max(wx1,e[i].x1);wz=Math.max(wz,e[i].zh);}
 const rings=[];
 for(let j=0;j<=nb+1;j++){
  const a=e[clamp(j-1,0,nb-1)],b=e[clamp(j,0,nb-1)],y=j===0?gy:j>nb?F.top+P.top:j*dy;
  const u=iceSm((y-P.zone)/P.ramp),pad=lerp(P.pad[0],P.pad[1],u),k=P.block*u;
  let x0=Math.min(a.x0,b.x0),x1=Math.max(a.x1,b.x1),zh=Math.max(a.zh,b.zh);
  x0=lerp(x0,Math.min(x0,wx0),k)-pad;x1=lerp(x1,Math.max(x1,wx1),k)+pad;zh=Math.min(lerp(zh,Math.max(zh,wz),k)+pad,P.maxHalfZ);
  rings.push({y,x0,x1,z0:-zh,z1:zh,c:lerp(P.chamfer[0],P.chamfer[1],u),j:lerp(P.jitter[0],P.jitter[1],u)});
 }
 return rings;
}

// --- the mesh ---
// a chamfered rectangle, 8 points, wobbled a little by a seed so no two blocks are the same
function iceRing(R,seed){
 const x0=R.x0,x1=R.x1,z0=R.z0,z1=R.z1,c=Math.min(R.c,(x1-x0)*0.4,(z1-z0)*0.4);
 const P=[[x1,z0+c],[x1,z1-c],[x1-c,z1],[x0+c,z1],[x0,z1-c],[x0,z0+c],[x0+c,z0],[x1-c,z0]];
 return P.map((p,i)=>[p[0]+(iceHash(seed+i*1.7)-0.5)*2*R.j,R.y+(iceHash(seed*0.37+i*3.1)-0.5)*R.j*0.6,p[1]+(iceHash(seed+i*2.9+11)-0.5)*2*R.j]);
}
// the block as flat triangles (9 numbers each), wound outward: walls loft ring to ring, a roof pulls in, a few crystals stand on it
function iceTris(rings,seed,P){
 const R=rings.map((r,j)=>iceRing(r,seed+j*13.7)),n=R.length,T=[];
 const tri=(a,b,c)=>T.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
 const quad=(a,b,c,d)=>{tri(a,d,c);tri(a,c,b);};
 const mid=ring=>{let x=0,y=0,z=0;for(const p of ring){x+=p[0];y+=p[1];z+=p[2];}return [x/8,y/8,z/8];};
 for(let j=0;j+1<n;j++)for(let v=0;v<8;v++)quad(R[j][v],R[j][(v+1)%8],R[j+1][(v+1)%8],R[j+1][v]);
 const c0=mid(R[0]);
 for(let v=0;v<8;v++)tri(c0,R[0][v],R[0][(v+1)%8]);
 const top=R[n-1],ct=mid(top),roof=top.map((p,i)=>[ct[0]+(p[0]-ct[0])*P.roofIn+(iceHash(seed+i*5.3)-0.5)*0.3,
  ct[1]+P.roof+(iceHash(seed+i*8.1)-0.5)*0.35,ct[2]+(p[2]-ct[2])*P.roofIn+(iceHash(seed+i*6.7)-0.5)*0.3]);
 for(let v=0;v<8;v++)quad(top[v],top[(v+1)%8],roof[(v+1)%8],roof[v]);
 const cr=mid(roof);
 for(let v=0;v<8;v++)tri(cr,roof[(v+1)%8],roof[v]);
 for(let s=0;s<P.spikes;s++){
  const a=roof[(s*2+Math.floor(iceHash(seed+s)*3))%8],k=0.2+0.45*iceHash(seed+s*3.3);
  const ax=cr[0]+(a[0]-cr[0])*k,az=cr[2]+(a[2]-cr[2])*k,by=cr[1]-0.05,hw=0.28+0.28*iceHash(seed+s*7.7);
  const h=lerp(P.spike[0],P.spike[1],iceHash(seed+s*9.1)),ap=[ax+(iceHash(seed+s*2.2)-0.5)*0.9,by+h,az+(iceHash(seed+s*4.4)-0.5)*0.9];
  const b=[[ax-hw,by,az-hw],[ax+hw,by,az-hw],[ax+hw,by,az+hw],[ax-hw,by,az+hw]];
  tri(b[0],b[1],b[2]);tri(b[0],b[2],b[3]);
  for(let i=0;i<4;i++){
   const p=b[i],q=b[(i+1)%4],e1=[q[0]-p[0],q[1]-p[1],q[2]-p[2]],e2=[ap[0]-p[0],ap[1]-p[1],ap[2]-p[2]];
   const nx=e1[1]*e2[2]-e1[2]*e2[1],ny=e1[2]*e2[0]-e1[0]*e2[2],nz=e1[0]*e2[1]-e1[1]*e2[0];
   const fx=(p[0]+q[0]+ap[0])/3-ax,fy=(p[1]+q[1]+ap[1])/3-by,fz=(p[2]+q[2]+ap[2])/3-az;
   if(nx*fx+ny*fy+nz*fz>=0)tri(p,q,ap);else tri(q,p,ap);
  }
 }
 return T;
}
function iceMake(T){
 const n=T.length/9,pos=new Float32Array(T),nor=new Float32Array(n*9),uv=new Float32Array(n*6),sc=0.17;
 for(let i=0;i<n;i++){
  const o=i*9,ax=pos[o],ay=pos[o+1],az=pos[o+2];
  const e1x=pos[o+3]-ax,e1y=pos[o+4]-ay,e1z=pos[o+5]-az,e2x=pos[o+6]-ax,e2y=pos[o+7]-ay,e2z=pos[o+8]-az;
  let nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;
  const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  const up=Math.abs(ny)>=Math.abs(nx)&&Math.abs(ny)>=Math.abs(nz),side=Math.abs(nx)>=Math.abs(nz);
  for(let k=0;k<3;k++){
   nor[o+k*3]=nx;nor[o+k*3+1]=ny;nor[o+k*3+2]=nz;
   const px=pos[o+k*3],py=pos[o+k*3+1],pz=pos[o+k*3+2];
   uv[i*6+k*2]=(up?px:side?pz:px)*sc;uv[i*6+k*2+1]=(up?pz:py)*sc;
  }
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(pos,3));
 g.setAttribute('normal',new THREE.BufferAttribute(nor,3));
 g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 g.computeBoundingBox();g.computeBoundingSphere();
 return g;
}

// --- look ---
// one small tile: clear ice with frost bloom and a few cracks; read as an alpha map (green channel), so white is frosted and grey is clear
function iceTexture(){
 const N=128,cv=document.createElement('canvas');cv.width=cv.height=N;
 const g=cv.getContext('2d');
 g.fillStyle='#8a8a8a';g.fillRect(0,0,N,N);
 let sd=7;const rn=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
 for(let i=0;i<140;i++){
  const v=rn()<0.5?255:50;
  g.fillStyle='rgba('+v+','+v+','+v+','+(0.05+rn()*0.1)+')';
  g.beginPath();g.arc(rn()*N,rn()*N,3+rn()*13,0,6.283);g.fill();
 }
 g.lineCap='round';
 for(let i=0;i<12;i++){
  let x=rn()*N,y=rn()*N,a=rn()*6.283;
  g.strokeStyle='rgba(255,255,255,'+(0.35+rn()*0.4)+')';g.lineWidth=0.6+rn()*0.9;g.beginPath();g.moveTo(x,y);
  for(let k=0;k<6;k++){a+=(rn()-0.5)*1.1;x+=Math.cos(a)*(5+rn()*10);y+=Math.sin(a)*(5+rn()*10);g.lineTo(x,y);}
  g.stroke();
 }
 const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;
 return t;
}
// a front and a back material per team (two teams can be frozen at once and fade on their own clocks); the edge glow is a patch on the standard shader
function iceMats(){
 const U={uIceRim:{value:kitLin(IC.rim.col)},uIceK:{value:IC.rim.k}},m={u:U};
 const mk=back=>{
  const x=new THREE.MeshStandardMaterial({color:kitLin(back?IC.deep:IC.col),emissive:kitLin(IC.glow),emissiveIntensity:IC.glowK*(back?0.5:1),
   roughness:back?0.35:IC.rough,metalness:0,transparent:true,opacity:back?IC.back:IC.opacity,alphaMap:ICE.tex,flatShading:true,depthWrite:false,
   envMapIntensity:IC.env,side:back?THREE.BackSide:THREE.FrontSide});
  x.onBeforeCompile=sh=>{
   sh.uniforms.uIceRim=U.uIceRim;sh.uniforms.uIceK=U.uIceK;
   sh.fragmentShader=sh.fragmentShader
    .replace('#include <common>','#include <common>\nuniform vec3 uIceRim;uniform float uIceK;')
    .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
     'float icRim=pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),'+IC.rim.power.toFixed(2)+');\n'+
     'outgoingLight+=uIceRim*icRim*uIceK;\n'+
     'gl_FragColor=vec4(outgoingLight,clamp(diffuseColor.a+icRim*0.4*uIceK,0.0,1.0));');
  };
  x.customProgramCacheKey=()=>back?'icb':'icf';
  return x;
 };
 m.f=mk(false);m.b=mk(true);
 return m;
}

// --- chunks ---
// a squashed tetrahedron: thrown out of the block when it breaks, a few hundred at most, flown on the CPU (gravity, drag, a bounce off the pitch, a tumble) and drawn as one instanced mesh
function iceChunkGeo(){
 const p=[[-0.5,-0.3,-0.4],[0.55,-0.25,-0.2],[0.0,-0.35,0.55],[0.05,0.7,0.0]],T=[];
 for(const f of [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]){
  const a=p[f[0]],b=p[f[1]],c=p[f[2]],e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  const m=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3];
  if(n[0]*m[0]+n[1]*(m[1]-0.05)+n[2]*m[2]>=0)T.push(...a,...b,...c);else T.push(...a,...c,...b);
 }
 return iceMake(T);
}
function iceChunksBuild(){
 const C=IC.shards,mat=iceMats().f,mesh=new THREE.InstancedMesh(iceChunkGeo(),mat,C.max);
 mat.side=THREE.DoubleSide;mat.opacity=C.opacity;
 mesh.frustumCulled=false;mesh.visible=false;mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=3;
 const list=[];for(let i=0;i<C.max;i++)list.push({on:false});
 ICE.sh={mesh,list,i:0,live:0};
 scene.add(mesh);
}
function iceChunkSpawn(x,y,z,vx,vy,vz){
 const C=IC.shards,S_=IC.shatter,H=ICE.sh,s=H.list[H.i];
 H.i=(H.i+1)%C.max;
 const sz=lerp(S_.size[0],S_.size[1],Math.random());
 H.live++;H.mesh.visible=true;
 s.on=true;s.rest=false;s.t=0;s.life=lerp(C.life[0],C.life[1],Math.random());
 s.x=x;s.y=y;s.z=z;s.vx=vx;s.vy=vy;s.vz=vz;
 let qx=rand(-1,1),qy=rand(-1,1),qz=rand(-1,1),qw=rand(-1,1);const l=Math.hypot(qx,qy,qz,qw)||1;
 s.qx=qx/l;s.qy=qy/l;s.qz=qz/l;s.qw=qw/l;
 const sp=lerp(C.spin[0],C.spin[1],Math.random()),ax=rand(-1,1),ay=rand(-1,1),az=rand(-1,1),al=Math.hypot(ax,ay,az)||1;
 s.wx=ax/al*sp;s.wy=ay/al*sp;s.wz=az/al*sp;
 s.sx=sz*rand(0.7,1.3);s.sy=sz*rand(0.7,1.3);s.sz=sz*rand(0.7,1.3);
}
function iceChunksUpdate(dt){
 const H=ICE.sh;if(!H||(!H.live&&!H.mesh.visible))return;
 const C=IC.shards,A=H.mesh.instanceMatrix.array,drag=Math.exp(-C.drag*dt),xm=F.L/2-1.5,zm=F.W/2-1.5;
 let live=0;
 for(let i=0;i<C.max;i++){
  const s=H.list[i],o=i*16;
  if(!s.on){if(A[o]!==0||A[o+5]!==0||A[o+10]!==0){A[o]=A[o+5]=A[o+10]=0;}continue;}
  s.t+=dt;
  if(s.t>=s.life){s.on=false;A[o]=A[o+5]=A[o+10]=0;continue;}
  live++;
  const fl=Math.max(0.12,0.28*Math.min(s.sx,s.sy,s.sz));
  if(!s.rest){
   s.vy-=C.grav*dt;s.vx*=drag;s.vz*=drag;
   s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;
   if(s.x>xm){s.x=xm;s.vx=-Math.abs(s.vx)*0.5;}else if(s.x<-xm){s.x=-xm;s.vx=Math.abs(s.vx)*0.5;}
   if(s.z>zm){s.z=zm;s.vz=-Math.abs(s.vz)*0.5;}else if(s.z<-zm){s.z=-zm;s.vz=Math.abs(s.vz)*0.5;}
   if(s.y<fl){
    s.y=fl;
    if(s.vy<-8){s.vy=-s.vy*C.bounce;s.vx*=0.7;s.vz*=0.7;s.wx*=0.6;s.wy*=0.6;s.wz*=0.6;}
    else{s.vy=0;s.vx*=0.8;s.vz*=0.8;s.wx*=0.8;s.wy*=0.8;s.wz*=0.8;if(Math.hypot(s.vx,s.vz)<1.5)s.rest=true;}
   }
   const h=0.5*dt,qx=s.qx,qy=s.qy,qz=s.qz,qw=s.qw;
   let nx=qx+h*(s.wx*qw+s.wy*qz-s.wz*qy),ny=qy+h*(s.wy*qw+s.wz*qx-s.wx*qz),nz=qz+h*(s.wz*qw+s.wx*qy-s.wy*qx),nw=qw+h*(-s.wx*qx-s.wy*qy-s.wz*qz);
   const l=Math.hypot(nx,ny,nz,nw)||1;s.qx=nx/l;s.qy=ny/l;s.qz=nz/l;s.qw=nw/l;
  }
  const k=Math.min(1,(s.life-s.t)/C.fade),sx=s.sx*k,sy=s.sy*k,sz=s.sz*k,x=s.qx,y=s.qy,z=s.qz,w=s.qw;
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  A[o]=(1-2*(yy+zz))*sx;A[o+1]=2*(xy+wz)*sx;A[o+2]=2*(xz-wy)*sx;A[o+3]=0;
  A[o+4]=2*(xy-wz)*sy;A[o+5]=(1-2*(xx+zz))*sy;A[o+6]=2*(yz+wx)*sy;A[o+7]=0;
  A[o+8]=2*(xz+wy)*sz;A[o+9]=2*(yz-wx)*sz;A[o+10]=(1-2*(xx+yy))*sz;A[o+11]=0;
  A[o+12]=s.x;A[o+13]=s.y;A[o+14]=s.z;A[o+15]=1;
 }
 H.live=live;
 H.mesh.instanceMatrix.needsUpdate=true;
 H.mesh.visible=live>0;
}
function iceChunksClear(){
 const H=ICE.sh;if(!H)return;
 for(const s of H.list)s.on=false;
 H.mesh.instanceMatrix.array.fill(0);H.mesh.instanceMatrix.needsUpdate=true;H.mesh.visible=false;H.live=0;
}

// --- build ---
// refit a team's blocks when its figurine (or its scale, or the model arriving) changes; returns true when it did
function iceFitTeam(t){
 const am=activeModel(t),s=am.scale*tmScale(t),key=am.id+'|'+s.toFixed(3)+'|'+(playerModel[t]?1:0);
 if(ICE.key[t]===key)return false;
 ICE.key[t]=key;
 const P=IC.fit,pts=playerModel[t]?iceScan(playerModel[t],s):[],F=pts.length>=9?iceBands(pts,P.bands):iceDefault(P.bands),old=ICE.geo[t],rings=iceRings(F,P);
 ICE.fit[t]=F;ICE.geo[t]=[];
 for(let v=0;v<P.variants;v++)ICE.geo[t].push(iceMake(iceTris(rings,t*31+v*7+1,P)));
 for(const r of rods)if(r.team===t&&r.ice)for(const it of r.ice){const g=ICE.geo[t][it.v];it.front.geometry=g;it.back.geometry=g;}
 for(const g of old)g.dispose();
 return true;
}
// every man gets a hidden pair of meshes on its rod's pivot, so the first frost compiles with the rest of the scene and nothing is made mid-match
function iceBuild(){
 if(ICE.built||!IC.on||typeof rods==='undefined'||!rods.length||typeof scene==='undefined'||!scene)return;
 ICE.tex=iceTexture();
 ICE.mat=[iceMats(),iceMats()];
 if(typeof vfxLin==='function'){ICE.pal=IC.shatter.cols.map(vfxLin);ICE.hot=vfxLin(IC.hot);ICE.body=vfxLin(IC.body);}
 ICE.key=['',''];iceFitTeam(0);iceFitTeam(1);
 for(const r of rods){
  r.ice=[];
  for(let mi=0;mi<r.men.length;mi++){
   const v=Math.floor(iceHash(r.idx*13+mi*7+r.team*3+0.5)*IC.fit.variants)%IC.fit.variants,m=ICE.mat[r.team];
   const g=new THREE.Group();g.position.set(0,PLAYER_H,r.baseZ[mi]);if(r.team===1)g.rotation.y=Math.PI;g.visible=false;
   const back=new THREE.Mesh(ICE.geo[r.team][v],m.b),front=new THREE.Mesh(ICE.geo[r.team][v],m.f);
   back.renderOrder=2;front.renderOrder=3;
   back.castShadow=back.receiveShadow=front.castShadow=front.receiveShadow=false;
   g.add(back);g.add(front);r.pivot.add(g);
   r.ice.push({g,front,back,v,vis:false,born:0});
  }
 }
 iceChunksBuild();
 ICE.built=true;
}

// --- effects ---
function iceFxOn(){return typeof vfxLive==='function'&&vfxLive()&&cfg.particles;}
// a man's block centre in the world (the pivot's matrices are current: it is posed every frame)
function iceCentre(it,t){
 const bb=ICE.geo[t][it.v].boundingBox;
 it.g.updateWorldMatrix(true,false);
 return _icV.set((bb.min.x+bb.max.x)/2,(bb.min.y+bb.max.y)/2,0).applyMatrix4(it.g.matrixWorld);
}
function iceForm(r,it){
 if(!iceFxOn())return;
 const F=IC.form,c=iceCentre(it,r.team),x=c.x,y=c.y,z=c.z;
 vfxBlast(0,x,y-2,z,0,0,0,vfxRg(F.puff),F.size[0],F.size[1],ICE.hot,0.8,ICE.body);
 for(let i=0;i<F.glints;i++){
  const d=vfxDir(0,0.6,0,1),sp=rand(6,16);
  vfxSpk(x,y-2,z,d[0]*sp,d[1]*sp,d[2]*sp,rand(0.35,0.7),ICE.pal[i%ICE.pal.length],2.8,rand(0.12,0.22),1.6,1,0.03,3,rand(0,0.1));
 }
}
// the block goes: shards out of its own volume, glints, a flash and a puff of mist; `solo` = one man (a cannonball took him), not the team's frost running out
function iceShatter(r,mi,it,solo){
 it.vis=false;it.g.visible=false;
 const t=r.team,bb=ICE.geo[t][it.v].boundingBox,S_=IC.shatter,c=iceCentre(it,t),cx=c.x,cy=c.y,cz=c.z,mw=it.g.matrixWorld;
 if(!iceFxOn()){
  if(typeof burst==='function')burst(new THREE.Vector3(cx,cy,cz),kitLin(IC.col),_icW,8,32);
  return;
 }
 for(let i=0;i<S_.pieces;i++){
  _icV.set(lerp(bb.min.x,bb.max.x,Math.random()),lerp(bb.min.y+1,bb.max.y-1,Math.random()),(Math.random()-0.5)*(bb.max.z-bb.min.z)).applyMatrix4(mw);
  let dx=_icV.x-cx,dz=_icV.z-cz;const l=Math.hypot(dx,dz)||1,sp=lerp(S_.speed[0],S_.speed[1],Math.random());dx/=l;dz/=l;
  iceChunkSpawn(_icV.x,_icV.y,_icV.z,dx*sp+rand(-3,3),lerp(S_.up[0],S_.up[1],Math.random()),dz*sp+rand(-3,3));
 }
 for(let i=0;i<S_.glints;i++){
  _icV.set(lerp(bb.min.x,bb.max.x,Math.random()),lerp(bb.min.y+1,bb.max.y,Math.random()),(Math.random()-0.5)*(bb.max.z-bb.min.z)).applyMatrix4(mw);
  const d=vfxSphere(),sp=rand(8,30);
  vfxSpk(_icV.x,_icV.y,_icV.z,d[0]*sp,Math.abs(d[1])*sp*0.8+3,d[2]*sp,rand(0.5,1.1),ICE.pal[i%ICE.pal.length],3.2,rand(0.12,0.26),1.6,1,0.03,3,rand(0,0.06));
 }
 if(S_.flash)vfxBlast(2,cx,cy,cz,0,0,0,0.16,4,8,ICE.hot,1.5,ICE.body);
 if(S_.puff)vfxBlast(0,cx,cy-1,cz,0,0,0,rand(0.4,0.7),2.5,6,ICE.hot,0.8,ICE.body);
}
// a twinkle somewhere on the frozen team
function iceGlint(t){
 if(!iceFxOn())return;
 const list=[];
 for(const r of rods)if(r.team===t&&r.ice)for(const it of r.ice)if(it.vis&&it.g.visible)list.push(it);
 if(!list.length)return;
 const it=list[Math.floor(Math.random()*list.length)],bb=ICE.geo[t][it.v].boundingBox;
 it.g.updateWorldMatrix(true,false);
 _icV.set(lerp(bb.min.x,bb.max.x,Math.random()),lerp(bb.min.y+2,bb.max.y-1,Math.random()),Math.random()<0.5?bb.min.z:bb.max.z).applyMatrix4(it.g.matrixWorld);
 vfxSpk(_icV.x,_icV.y,_icV.z,0,0,0,rand(0.35,0.7),ICE.pal[0],IC.glint.power,IC.glint.size,1,0,0,2,0);
}

// --- per frame ---
function iceAlive(r,mi){const ru=r.removedUntil[mi];return (!ru||ru<=S.time)&&r.men[mi].visible;}
function iceStart(t,T,left){
 T.live=true;T.age=0;T.left=left;T.pulse=1;T.glint=0.2;
 for(const r of rods)if(r.team===t&&r.ice)for(const it of r.ice)it.vis=false;
 Au.play('ice_form');
}
// into or out of a replay: the blocks take the new clock's frost as it stands, full grown, with no form or break
function iceSnap(t,T,on,left){
 T.live=on;T.left=left;T.pulse=0;
 for(const r of rods)if(r.team===t&&r.ice)for(let mi=0;mi<r.ice.length;mi++){
  const it=r.ice[mi];
  it.vis=on&&iceAlive(r,mi);it.born=T.age-IC.grow;
  if(!it.vis)it.g.visible=false;
 }
}
// the frost ran out (shatter) or the match let go of it (just hide)
function iceStop(t,T,fx){
 T.live=false;
 for(const r of rods)if(r.team===t&&r.ice)for(let mi=0;mi<r.ice.length;mi++){
  const it=r.ice[mi];
  if(!it.vis)continue;
  if(fx)iceShatter(r,mi,it,false);else{it.vis=false;it.g.visible=false;}
 }
 if(fx)Au.play('ice_break');
}
function iceClear(){
 iceChunksClear();
 for(let t=0;t<2;t++){const T=ICE.tm[t];T.live=false;T.age=0;T.pulse=0;}
 if(typeof rods!=='undefined')for(const r of rods)if(r.ice)for(const it of r.ice){it.vis=false;it.g.visible=false;}
}
function iceUpdate(rdt){
 if(!IC.on||typeof rods==='undefined')return;
 if(!ICE.built){iceBuild();if(!ICE.built)return;}
 else if(rods.length&&rods[0].ice===undefined){ICE.built=false;return;}   // the rods were rebuilt: dress the new ones next frame
 iceFitTeam(0);iceFitTeam(1);
 iceChunksUpdate(rdt);
 // a replay runs the blocks off the footage's frost and clock (js/replay.js)
 const rp=S.phase==='replay'&&typeof replayIce==='function',cut=rp!==ICE.rp,live=S.phase!=='menu',dt=rp?RP.jDt:rdt;
 ICE.rp=rp;
 for(let t=0;t<2;t++){
  const T=ICE.tm[t],left=rp?replayIce(t):S.eff[t].frozen-S.time,on=live&&left>0;
  if(cut)iceSnap(t,T,on,left);
  else if(on&&!T.live)iceStart(t,T,left);
  else if(!on&&T.live)iceStop(t,T,live);
  if(!on)continue;
  T.age+=dt;
  if(left>T.left+0.5)T.pulse=1;   // frost picked up again while frozen
  T.left=left;
  const w=left<IC.warn?1-left/IC.warn:0,f=0.5+0.5*Math.sin(left*IC.flicker),m=ICE.mat[t];
  T.pulse=Math.max(0,T.pulse-dt*2.5);
  m.f.opacity=IC.opacity*(1-0.4*w*f);m.b.opacity=IC.back*(1-0.4*w*f);
  m.f.emissiveIntensity=IC.glowK*(1+T.pulse*1.5+w*1.2*f);m.b.emissiveIntensity=IC.glowK*0.5*(1+T.pulse*1.5+w*1.2*f);
  m.u.uIceK.value=IC.rim.k*(1+T.pulse+w*f);
  for(const r of rods){
   if(r.team!==t||!r.ice)continue;
   for(let mi=0;mi<r.ice.length;mi++){
    const it=r.ice[mi],alive=iceAlive(r,mi);
    if(alive&&!it.vis){it.vis=true;it.born=T.age;iceForm(r,it);}
    else if(!alive&&it.vis)iceShatter(r,mi,it,true);
    if(!it.vis)continue;
    const u=clamp((T.age-it.born)/IC.grow,0,1),k=1+2.70158*Math.pow(u-1,3)+1.70158*Math.pow(u-1,2);
    it.g.scale.set(lerp(0.72,1,k),lerp(0.2,1,k),lerp(0.72,1,k));
    it.g.visible=true;
   }
  }
  T.glint-=dt;
  if(T.glint<=0){T.glint=IC.glint.every*rand(0.6,1.5);iceGlint(t);}
 }
}
