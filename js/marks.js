'use strict';
// ================= WALL MARKS =================
// the scuff a hard hit leaves on a wall; decoration only (physics.js and arena.js hand over the contact point, surface and impact speed)
// one mesh, not one per mark: each mark is a quad in a single geometry and material (one draw call); an 'off' mark has its four corners parked on one spot
// fading is in the colour attribute (four floats per vertex, r128 reads the fourth as alpha), since material.opacity would fade every mark together
// a mark darkens the wall, it never paints on it (blend multiplies the wall by 1 - strength; painting dark would lighten any wall darker than the paint); so it has no colour of its own, a fireball burns harder (ballTypes.markMul)
// tuning in CONFIG.fx.marks; toggle in Options > Display > Effects > Wall marks

let markMesh=null,markGeo=null,markLife=[],markPeak=[],markMax=0;
const _mkA=new THREE.Vector3(),_mkB=new THREE.Vector3(),_mkN=new THREE.Vector3();
// corner offsets for one quad in mark-local axes, plus the matching UV corner inside an atlas cell
const MK_X=[-1,1,1,-1],MK_Y=[-1,-1,1,1],MK_U=[0,.5,.5,0],MK_V=[0,0,.5,.5];

// four smudges baked into a 2x2 image, one picked per mark; drawn white with only alpha varying (the ball sets the colour at spawn); off-centre lobes and grit along one axis keep it reading as dirt, not a graphic
function buildMarkTex(){
 const S=128,cv=document.createElement('canvas');cv.width=cv.height=S*2;
 const c=cv.getContext('2d');
 const lobe=(x,y,rx,ry,rot,a)=>{
  c.save();c.translate(x,y);c.rotate(rot);c.scale(rx,ry);
  const g=c.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,'rgba(255,255,255,'+a+')');
  g.addColorStop(.5,'rgba(255,255,255,'+(a*.5)+')');
  g.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=g;c.beginPath();c.arc(0,0,1,0,Math.PI*2);c.fill();c.restore();
 };
 for(let k=0;k<4;k++){
  const ox=(k%2)*S,oy=((k/2)|0)*S,cx=ox+S/2,cy=oy+S/2;
  c.save();c.beginPath();c.rect(ox,oy,S,S);c.clip();          // keep each cell out of its neighbours
  const lean=rand(-.45,.45),cl=Math.cos(lean),sl=Math.sin(lean);   // this cell's long axis
  lobe(cx,cy,S*.38,S*.27,lean,.8);                                 // body
  for(let i=0;i<7;i++)                                             // knocked out of round
   lobe(cx+rand(-S*.17,S*.17),cy+rand(-S*.12,S*.12),
        rand(S*.09,S*.23),rand(S*.06,S*.15),rand(0,Math.PI),rand(.16,.38));
  c.strokeStyle='rgba(255,255,255,.28)';c.lineCap='round';
  for(let i=0;i<8;i++){                                            // drag streaks along that axis
   const off=rand(-S*.17,S*.17),len=rand(S*.18,S*.46),
         sx=cx-cl*len/2-sl*off,sy=cy-sl*len/2+cl*off;
   c.lineWidth=rand(1,3.5);
   c.beginPath();c.moveTo(sx,sy);c.lineTo(sx+cl*len,sy+sl*len);c.stroke();
  }
  c.restore();
 }
 const t=new THREE.CanvasTexture(cv);
 // no mipmaps: a shrunk mipmap blends the four cells into each other
 t.generateMipmaps=false;t.minFilter=t.magFilter=THREE.LinearFilter;
 return t;
}

// called once from buildFxPools (world.js); the mesh stays in the scene, only filled and emptied, so its shader compiles at boot
function buildMarkPool(){
 const M=CONFIG.fx.marks;
 markMax=M.count;markLife=[];markPeak=[];
 const pos=new Float32Array(markMax*4*3),uv=new Float32Array(markMax*4*2),
       col=new Float32Array(markMax*4*4),idx=[];
 for(let i=0;i<markMax;i++){
  markLife.push(0);markPeak.push(0);
  const v=i*4;
  idx.push(v,v+1,v+2, v,v+2,v+3);
  for(let j=0;j<4;j++)pos[(v+j)*3+1]=-9999;                   // parked off-world until used
 }
 markGeo=new THREE.BufferGeometry();
 markGeo.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
 markGeo.setAttribute('uv',new THREE.BufferAttribute(uv,2).setUsage(THREE.DynamicDrawUsage));
 markGeo.setAttribute('color',new THREE.BufferAttribute(col,4).setUsage(THREE.DynamicDrawUsage));
 markGeo.setIndex(idx);
 markMesh=new THREE.Mesh(markGeo,new THREE.MeshBasicMaterial({
  map:buildMarkTex(),transparent:true,vertexColors:true,depthWrite:false,side:THREE.DoubleSide,
  // darken-only blend: wall = wall * (1 - strength); the source colour is multiplied by zero, so it can never lighten and overlapping marks never saturate
  blending:THREE.CustomBlending,
  blendEquation:THREE.AddEquation,
  blendSrc:THREE.ZeroFactor,
  blendDst:THREE.OneMinusSrcAlphaFactor,
  // belt and braces over the lift below: a skin whose wall sits a hair proud would flicker against the mark
  polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
 markMesh.frustumCulled=false;      // the quads jump around, so the geometry's bounds are always stale
 markMesh.castShadow=markMesh.receiveShadow=false;
 scene.add(markMesh);
}

// Park one slot's quad on a single point — zero area, so it never reaches a pixel.
function markHide(i){
 const pos=markGeo.attributes.position.array,col=markGeo.attributes.color.array,q=i*4;
 for(let j=0;j<4;j++){
  const o=(q+j)*3;pos[o]=0;pos[o+1]=-9999;pos[o+2]=0;
  col[(q+j)*4+3]=0;
 }
}

// leave a mark where the ball just hit a wall; n is the wall's inward normal, imp the speed straight into the wall (a rail clip smears, a hit craters); PHY.wallHitSnd (16) is where a hit becomes audible
function spawnMark(b,nx,ny,nz,imp){
 if(!markMesh||!cfg.marks||b.scored)return;
 const M=CONFIG.fx.marks;
 if(!M.on||imp<M.minImp)return;
 // how hard, 0..1: this alone drives size and darkness; a ball type leans on it through markMul
 const t=clamp((imp-M.minImp)/Math.max(.001,M.fullImp-M.minImp)*((b.t&&b.t.markMul)||1),0,1);

 // free slot, or the one closest to gone: recycling the oldest is deliberate
 let s=-1,worst=1e9;
 for(let i=0;i<markMax;i++){const l=markLife[i];if(l<=0){s=i;break;}if(l<worst){worst=l;s=i;}}
 if(s<0)return;

 // sit the mark on the wall plane, don't measure back from the ball (it's clamped onto the plane after this call, and can be ten units past the table end)
 // flat tables' wall faces are constants (|x| = L/2, |z| = W/2); the bowl has none, but arenaContact pushes the ball onto the surface first
 const p=b.m.position,py0=p.y;
 let px,pz;
 if(ARENA_ON){const d=BALL_R-M.lift;px=p.x-nx*d;pz=p.z-nz*d;}
 else if(Math.abs(nx)>.5){px=-nx*(F.L/2-M.lift);pz=p.z;}      // an end wall
 else{px=p.x;pz=-nz*(F.W/2-M.lift);}                          // a side wall

 // sideways travel smears the mark along the path (a clipped shot streaks, a square hit splats); the sideways part is what's left once the into-wall part is removed
 _mkN.set(nx,ny,nz);
 const v=b.v,vn=v.x*nx+v.y*ny+v.z*nz;
 _mkA.set(v.x-nx*vn,v.y-ny*vn,v.z-nz*vn);
 const ts=_mkA.length();
 if(ts>1)_mkA.divideScalar(ts);
 else{
  // barely moving sideways: sit the mark level along the wall with a small random lean
  if(Math.abs(ny)>.9)_mkA.set(1,0,0);else _mkA.set(0,1,0);
  _mkA.cross(_mkN).normalize();                          // level, running along the wall
  const a=rand(-M.tilt,M.tilt)*Math.PI/180;
  _mkB.copy(_mkN).cross(_mkA);
  _mkA.multiplyScalar(Math.cos(a)).addScaledVector(_mkB,Math.sin(a)).normalize();
 }
 _mkB.copy(_mkN).cross(_mkA).normalize();
 let hh=lerp(M.sizeMin,M.sizeMax,t)*.5,
     hw=hh*clamp(1+ts*M.streak,1,M.streakMax);

 // keep the mark on the wall, whole: the bowl's wall starts above its curved skirting and walls have a top rail; if the band is too short the mark shrinks (vh = the quad's half-height once tilted)
 const bot=ARENA_ON?ARENA.creaseR:0,
       top=ARENA_ON?F.wallH:(Math.abs(nx)>.5?(ENDWALL_H||F.wallH):F.wallH),
       band=Math.max(.1,top-bot);
 let vh=Math.abs(_mkA.y)*hw+Math.abs(_mkB.y)*hh;
 if(vh*2>band*.9){const k=band*.9/(vh*2);hw*=k;hh*=k;vh*=k;}
 const py=clamp(py0,bot+vh,top-vh);

 // RGB is multiplied out by the blend, so only this alpha decides how dark the mark goes
 const alpha=lerp(M.alphaMin,M.alphaMax,t),
       cell=(Math.random()*4)|0,u0=(cell&1)*.5,v0=(cell>>1)*.5;
 const pos=markGeo.attributes.position.array,uv=markGeo.attributes.uv.array,
       col=markGeo.attributes.color.array,q=s*4;
 for(let j=0;j<4;j++){
  const ax=MK_X[j]*hw,by=MK_Y[j]*hh,o=(q+j)*3;
  pos[o]  =px+_mkA.x*ax+_mkB.x*by;
  pos[o+1]=py+_mkA.y*ax+_mkB.y*by;
  pos[o+2]=pz+_mkA.z*ax+_mkB.z*by;
  const ou=(q+j)*2;uv[ou]=u0+MK_U[j];uv[ou+1]=v0+MK_V[j];
  const oc=(q+j)*4;col[oc]=col[oc+1]=col[oc+2]=1;col[oc+3]=alpha;
 }
 markLife[s]=M.hold+M.fade;markPeak[s]=alpha;
 markGeo.attributes.position.needsUpdate=true;
 markGeo.attributes.uv.needsUpdate=true;
 markGeo.attributes.color.needsUpdate=true;
 renderDirty();
}

// age every live mark; driven from fxUpdate (rdt is zero in a photo freeze, so marks hold their darkness)
function marksUpdate(rdt){
 if(!markMesh)return;
 const M=CONFIG.fx.marks,col=markGeo.attributes.color.array;
 let any=false,moved=false;
 for(let i=0;i<markMax;i++){
  let l=markLife[i];if(l<=0)continue;
  any=true;l-=rdt;
  if(l<=0){markLife[i]=0;markHide(i);moved=true;continue;}
  markLife[i]=l;
  const a=markPeak[i]*(l<M.fade?l/M.fade:1),q=i*16;
  col[q+3]=a;col[q+7]=a;col[q+11]=a;col[q+15]=a;
 }
 if(any)markGeo.attributes.color.needsUpdate=true;
 if(moved)markGeo.attributes.position.needsUpdate=true;
}

// Wipe the lot — a new match, a table change, or the player switching the effect off.
function clearMarks(){
 if(!markMesh)return;
 for(let i=0;i<markMax;i++){markLife[i]=0;markPeak[i]=0;markHide(i);}
 markGeo.attributes.position.needsUpdate=true;
 markGeo.attributes.color.needsUpdate=true;
 renderDirty();
}
