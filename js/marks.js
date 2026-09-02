'use strict';
/* ================= WALL MARKS =================
   The scuff a hard hit leaves behind on a wall. Everything in here is decoration: the collision
   code already knows the exact contact point, which surface it was and how hard the ball arrived,
   and simply hands those three things over (physics.js for the flat tables' side/end walls,
   arena.js for the bowl). Nothing in this file touches the simulation.

   ONE MESH, NOT ONE PER MARK. Every mark is a quad inside a SINGLE geometry sharing a SINGLE
   material, so the whole system costs one draw call whether two marks are up or twenty-eight —
   the same batching the particles use, with quads instead of points. A mark that is "off" has its
   four corners parked on the same spot: a zero-area triangle is thrown out before it reaches a
   pixel, which is cheaper than drawing a fully transparent one.

   FADING HAPPENS IN THE COLOUR ATTRIBUTE, not in material.opacity — opacity is one number for the
   whole mesh, so twenty-eight marks would fade in lockstep. The colour attribute carries FOUR
   floats per vertex instead of the usual three, and r128 wires that fourth one up as alpha on its
   own (WebGLPrograms tests for itemSize === 4). That is the whole trick.

   A MARK DARKENS THE WALL. IT NEVER PAINTS ON IT. That distinction is the blend function below,
   and it is not a detail — the first version of this file painted a dark colour over the wall
   the ordinary way, which LIGHTENS any wall darker than the paint. It always would: the renderer
   tone-maps and sRGB-encodes before blending, so a "near-black" #140f0c leaves the shader at
   about 0.31 on screen, and the arena's walls and the darker table skins sit below that. Multiply
   the wall by (1 - strength) instead and there is no colour to be wrong — a dark wall stays dark,
   a light wall darkens, and no skin or room can ever flip it round. The cost is that a mark has
   no colour of its own, so a fireball burns HARDER (ballTypes.markMul) rather than browner.

   Tuning lives in CONFIG.fx.marks; the toggle is Options -> Display -> Effects -> Wall marks. */

let markMesh=null,markGeo=null,markLife=[],markPeak=[],markMax=0;
const _mkA=new THREE.Vector3(),_mkB=new THREE.Vector3(),_mkN=new THREE.Vector3();
// corner offsets for one quad, in mark-local axes, plus the matching UV corner inside an atlas cell
const MK_X=[-1,1,1,-1],MK_Y=[-1,-1,1,1],MK_U=[0,.5,.5,0],MK_V=[0,0,.5,.5];

/* Four different smudges baked into one image as a 2x2 grid. Each mark picks a cell at random, so
   a rally's worth of hits doesn't read as the same blob stamped over and over — the single biggest
   tell that a decal system is procedural. Drawn in WHITE with only the alpha varying, so the mark's
   colour is entirely the ball's to decide at spawn time.

   Two rules keep this reading as dirt rather than as a graphic. The body is a pile of overlapping
   OFF-CENTRE lobes, not one clean radial blob — a symmetrical smudge always looks placed. And the
   grit runs ACROSS the smudge along one axis, the way material actually transfers off something
   moving; strokes radiating out from the middle instead give you a very convincing dead spider. */
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
 // No mipmaps: a shrunk-down mipmap blends the four cells into each other and every mark starts
 // wearing a bit of its neighbours. Marks are small on screen, so nothing is lost by skipping them.
 t.generateMipmaps=false;t.minFilter=t.magFilter=THREE.LinearFilter;
 return t;
}

/* Called once, from buildFxPools (world.js). The mesh then lives in the scene for good — like the
   particle system and the fx light pool, it is only ever filled and emptied, never added or
   removed, so its shader is compiled with everything else at boot and the first mark of a match
   costs nothing. */
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
  /* DARKEN-ONLY BLEND: wall = wall * (1 - strength). Source colour is multiplied by zero, so the
     mark contributes no colour at all and only its alpha does any work — which is what makes
     "can never lighten" a property of the maths rather than a colour someone has to keep dark
     enough. Overlapping marks compound correctly and can never saturate to pure black. */
  blending:THREE.CustomBlending,
  blendEquation:THREE.AddEquation,
  blendSrc:THREE.ZeroFactor,
  blendDst:THREE.OneMinusSrcAlphaFactor,
  // belt and braces on top of the physical lift below: a table skin whose wall sits a hair proud
  // of where physics says it is would otherwise flicker against the mark
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

/* Leave a mark where the ball just hit a wall.

   n is the wall's INWARD normal — it points back into the pitch, which is the direction the
   collision code pushes the ball to get it out of the wall, so every caller already has it.
   imp is how fast the ball was travelling STRAIGHT INTO the wall, not its overall pace: a shot
   that clips a rail on the way past scores low here and smears rather than craters, which is
   exactly right. For scale, PHY.wallHitSnd (16) is where a hit becomes audible at all. */
function spawnMark(b,nx,ny,nz,imp){
 if(!markMesh||!cfg.marks||b.scored)return;
 const M=CONFIG.fx.marks;
 if(!M.on||imp<M.minImp)return;
 // How hard, 0..1 — this alone drives size and darkness. A ball type leans on it through markMul,
 // so a fireball reaches a full burn at a softer hit instead of carrying a colour of its own.
 const t=clamp((imp-M.minImp)/Math.max(.001,M.fullImp-M.minImp)*((b.t&&b.t.markMul)||1),0,1);

 // Free slot, or the one closest to gone. Recycling the OLDEST is deliberate: the hit the player
 // just watched land matters more than one from twenty seconds ago.
 let s=-1,worst=1e9;
 for(let i=0;i<markMax;i++){const l=markLife[i];if(l<=0){s=i;break;}if(l<worst){worst=l;s=i;}}
 if(s<0)return;

 /* SIT THE MARK ON THE WALL PLANE — do not measure back from the ball.
    The collision code clamps the ball onto the plane AFTER it calls this, so at this instant the
    ball is still some way through the wall. Normally that is one substep of travel and measuring
    back one ball-radius is near enough. It is NOT near enough when the ball cleared the wall in
    the air and is being caught on the way down outside it, which the flat tables currently do:
    the ball can be ten units past the end of the table, and a mark placed relative to it then
    hangs in mid-air. The flat tables' wall faces are constants (|x| = L/2, |z| = W/2), so snap to
    those. The bowl has no such constant, but arenaContact pushes the ball out onto the surface
    BEFORE calling here, so measuring back is exact in that case. */
 const p=b.m.position,py0=p.y;
 let px,pz;
 if(ARENA_ON){const d=BALL_R-M.lift;px=p.x-nx*d;pz=p.z-nz*d;}
 else if(Math.abs(nx)>.5){px=-nx*(F.L/2-M.lift);pz=p.z;}      // an end wall
 else{px=p.x;pz=-nz*(F.W/2-M.lift);}                          // a side wall

 /* Sideways travel smears the mark along the ball's path: a clipped shot leaves a streak, a square
    hit leaves a splat. The sideways part of the velocity is whatever is left once the part heading
    into the wall is removed — and since the bounce only flipped THAT part, this still reads the
    real path even though it runs after the bounce. */
 _mkN.set(nx,ny,nz);
 const v=b.v,vn=v.x*nx+v.y*ny+v.z*nz;
 _mkA.set(v.x-nx*vn,v.y-ny*vn,v.z-nz*vn);
 const ts=_mkA.length();
 if(ts>1)_mkA.divideScalar(ts);
 else{
  // Barely moving sideways. Sit the mark level along the wall with a small random lean rather
  // than spinning it anywhere: a scuff from a ball travelling flat reads wrong on its side, and a
  // free spin also makes the mark's height unpredictable, which the wall-fitting below has to pay for.
  if(Math.abs(ny)>.9)_mkA.set(1,0,0);else _mkA.set(0,1,0);
  _mkA.cross(_mkN).normalize();                          // level, running along the wall
  const a=rand(-M.tilt,M.tilt)*Math.PI/180;
  _mkB.copy(_mkN).cross(_mkA);
  _mkA.multiplyScalar(Math.cos(a)).addScaledVector(_mkB,Math.sin(a)).normalize();
 }
 _mkB.copy(_mkN).cross(_mkA).normalize();
 let hh=lerp(M.sizeMin,M.sizeMax,t)*.5,
     hw=hh*clamp(1+ts*M.streak,1,M.streakMax);

 /* Keep the mark ON the wall, whole. The bowl's wall only starts above its curved skirting — a
    flat quad laid across that fillet would sink into it — and every wall has a top rail to stay
    under. If the band is too short for the mark, the MARK shrinks: half a scuff hanging in the air
    over the rail is far more noticeable than a slightly smaller one. vh is the quad's true
    half-height once the streak has tilted it, so the fit is exact rather than a guess. */
 const bot=ARENA_ON?ARENA.creaseR:0,
       top=ARENA_ON?F.wallH:(Math.abs(nx)>.5?(ENDWALL_H||F.wallH):F.wallH),
       band=Math.max(.1,top-bot);
 let vh=Math.abs(_mkA.y)*hw+Math.abs(_mkB.y)*hh;
 if(vh*2>band*.9){const k=band*.9/(vh*2);hw*=k;hh*=k;vh*=k;}
 const py=clamp(py0,bot+vh,top-vh);

 // RGB is multiplied out by the blend, so only this alpha decides how dark the mark goes.
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

/* Age every live mark. Driven from fxUpdate, which has already zeroed rdt if photo mode is frozen —
   so a mark holds its exact darkness under the shutter instead of fading through the shot. */
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
