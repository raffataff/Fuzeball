'use strict';
/* ===== arena table (curved walls) ===== */
function sdRRect(x,z,hx,hz,r){const qx=Math.abs(x)-hx+r,qz=Math.abs(z)-hz+r;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;}
function sdBox2(x,z,cx,cz,hx,hz){const qx=Math.abs(x-cx)-hx,qz=Math.abs(z-cz)-hz;
 return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0);}
function smin(a,b,k){const h=clamp(.5+.5*(b-a)/k,0,1);return lerp(b,a,h)-k*h*(1-h);}

// ---- combined arena SDF (plan view) ----
// cavity boxes span x ∈ [±(L/2−mouthIn), ±(L/2+goalDepth)] — mouthIn reaches
// INTO the field (opens the mouth blend), goalDepth reaches out behind the line.
function arenaSD(x,z,gh0,gh1){
 const r=sdRRect(x,z,ARENA.length/2,ARENA.width/2,ARENA.cornerR);  // outer bowl length (side walls) × width (end walls)
 const cx=F.L/2+(F.goalDepth-ARENA.mouthIn)/2,hx=(ARENA.mouthIn+F.goalDepth)/2;
 const s0=sdBox2(x,z, cx,0,hx,gh0);
 const s1=sdBox2(x,z,-cx,0,hx,gh1);
 return smin(smin(r,s0,ARENA.postR),s1,ARENA.postR);
}

// ---- gradient (outward, toward wall) by central differences ----
function arenaGrad(x,z,gh0,gh1){
 const e=ARENA.gradEps;
 const dx=arenaSD(x+e,z,gh0,gh1)-arenaSD(x-e,z,gh0,gh1);
 const dz=arenaSD(x,z+e,gh0,gh1)-arenaSD(x,z-e,gh0,gh1);
 const l=Math.hypot(dx,dz)||1e-9;
 return {x:dx/l,z:dz/l};
}

// ---- contact response: roll vs bounce ----
function arenaContact(b,pen,nx,ny,nz){
 const p=b.m.position,v=b.v;
 p.x+=nx*pen;p.y+=ny*pen;p.z+=nz*pen;
 const vn=v.x*nx+v.y*ny+v.z*nz;
 if(vn<0){
  // static geometry: mass-free reflection. Slow contact goes inelastic → ball ROLLS up/down
  if(-vn>ARENA.bounceCut){const j=-(1+PHY.wallRest)*vn;v.x+=nx*j;v.y+=ny*j;v.z+=nz*j;Au.wall(-vn);}
  else{v.x-=vn*nx;v.y-=vn*ny;v.z-=vn*nz;}
  if(ny>ARENA.fricNy){const f=Math.exp(-PHY.floorFric*hStep);v.x*=f;v.z*=f;}
 }
}

// ---- spawn clamp: Newton-project p inward until safely inside ----
function arenaClampSpawn(pp){
 for(let i=0;i<3;i++){
  const gh=F.goalHalf,g=arenaGrad(pp.x,pp.z,gh,gh);
  const d=-arenaSD(pp.x,pp.z,gh,gh);
  if(d>BALL_R+2)break;
  pp.x-=g.x*(BALL_R+2-d);pp.z-=g.z*(BALL_R+2-d);
 }
}

/* ===== arena mesh generator (shared: visuals, debug, mirrored in tools/build_arena_table.py) ===== */
let arenaTable=null,arenaLedLine=null,hStep=0,arenaMats=null,tableNets={classic:null,arena:null};
// big-goal morph of the baked arena shell (arena_bowl + led ring). Registered from the arena GLB
// load; driven by arenaMorphUpdate. Each entry precomputes per-vertex deltas to the widened mouth.
let arenaMorph=[],arenaMorphDirty=false;
let tableHasFrame={classic:false,arena:false};   // set by models.js when a table GLB supplies its own 'goal_frame' posts

// outline polyline matching arenaSD: rounded rect + OUTWARD goal cavities (back walls
// at ±(L/2+goalDepth)). Rough corners are fine — every sample gets Newton-projected.
function arenaOutline(){
 const hl=ARENA.length/2,gl=F.L/2,hw=ARENA.width/2,gh=F.goalHalf,gd=F.goalDepth; // hl=outer corner, gl=goal line
 return [[-gl,-gh],[-gl-gd,-gh],[-gl-gd,gh],[-gl,gh],[-hl,hw],[hl,hw],
         [gl,gh],[gl+gd,gh],[gl+gd,-gh],[gl,-gh],[hl,-hw],[-hl,-hw]];
}
function arenaSamples(perim){
 const pts=arenaOutline(),n=pts.length,dist=[0];
 for(let i=1;i<=n;i++){const a=pts[i-1],b=pts[i%n];dist.push(dist[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
 const total=dist[n],out=[];let ci=0;
 for(let i=0;i<perim;i++){
  const want=i/perim*total;
  while(dist[ci+1]<want)ci++;
  const t=(want-dist[ci])/(dist[ci+1]-dist[ci]||1),a=pts[ci],b=pts[(ci+1)%n];
  out.push({x:lerp(a[0],b[0],t),z:lerp(a[1],b[1],t)});
 }
 return out;
}
function arenaProject(x,z,targetSD,iters){
 const gh=F.goalHalf;
 for(let i=0;i<iters;i++){
  const sd=arenaSD(x,z,gh,gh),g=arenaGrad(x,z,gh,gh);
  const e=sd-targetSD;x-=g.x*e;z-=g.z*e;
 }
 return {x,z};
}
// profile rows: quarter-circle fillet (0..fp) then vertical wall (fp..profile).
// th = fillet angle: 0 at floor, π/2 at wall base (wall rows keep π/2).
function arenaProfile(profile){
 const CR=ARENA.creaseR,WH=F.wallH,rows=[];
 const fp=CR>0.01?Math.max(1,Math.floor(profile*.55)):0; // CR≈0 → no fillet rows, sharp 90° wall
 for(let j=0;j<=profile;j++){
  if(fp&&j<=fp){const th=(j/fp)*Math.PI/2;rows.push({inset:CR-CR*Math.sin(th),y:CR-CR*Math.cos(th),th});}
  else rows.push({inset:0,y:CR+(WH-CR)*(j-fp)/(profile-fp||1),th:Math.PI/2});
 }
 rows.fp=fp;return rows;
}
// swept quad grid on the SDF contours. Groups: 0 = crease (fillet), 1 = wall.
function arenaGridGeo(perim,profile){
 const rows=arenaProfile(profile),samples=arenaSamples(perim);
 const verts=[],uvs=[],norms=[],idx=[];
 for(let j=0;j<=profile;j++){
  const r=rows[j],sn=Math.sin(r.th),cs=Math.cos(r.th);
  for(let i=0;i<=perim;i++){                       // i=perim duplicates i=0 (UV seam)
   const sp=samples[i%perim],pr=arenaProject(sp.x,sp.z,-r.inset,3);
   verts.push(pr.x,r.y,pr.z);uvs.push(i/perim,j/profile);
   const g=arenaGrad(pr.x,pr.z,F.goalHalf,F.goalHalf);
   norms.push(-g.x*sn,cs,-g.z*sn);                 // (0,1,0) on floor → (−grad,0) on wall
  }
 }
 for(let j=0;j<profile;j++)for(let i=0;i<perim;i++){
  const a=j*(perim+1)+i,b=a+1,c=a+(perim+1),d=c+1;
  idx.push(a,b,d,a,d,c);
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(verts),3));
 geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uvs),2));
 geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(norms),3));
 geo.setIndex(idx);
 geo.addGroup(0,rows.fp*perim*6,0);
 geo.addGroup(rows.fp*perim*6,(profile-rows.fp)*perim*6,1);
 return geo;
}

/* ===== arena table build ===== */
function buildArenaTable(){
 arenaTable=new THREE.Group();scene.add(arenaTable);
 // the arena owns its materials — deliberately NOT the classic wallMat, so themes
 // leave it alone and the GLB from tools/build_arena_table.py can replace the look
 arenaMats={
  crease:new THREE.MeshStandardMaterial({color:0x1c2236,roughness:.55,metalness:.35,side:THREE.DoubleSide}),
  wall:new THREE.MeshStandardMaterial({color:0x2b3350,roughness:.4,metalness:.5,side:THREE.DoubleSide}),
  body:new THREE.MeshStandardMaterial({color:0x141a2c,roughness:.5,metalness:.4})
 };
 const bowl=new THREE.Mesh(arenaGridGeo(ARENA.seg.loop,ARENA.seg.profile),[arenaMats.crease,arenaMats.wall]);
 bowl.receiveShadow=true;bowl.castShadow=true;arenaTable.add(bowl);
 // LED lip ring on the sd=0 contour (shares ledMat so the LED fx drive it)
 const lip=arenaSamples(ARENA.seg.loop).map(sp=>{const pr=arenaProject(sp.x,sp.z,0,3);return new THREE.Vector3(pr.x,F.wallH+.15,pr.z);});
 arenaLedLine=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip,true),ARENA.seg.loop,.35,6,true),ledMat);
 arenaTable.add(arenaLedLine);
 // body + legs — classic dimensions, arena material
 const body=new THREE.Mesh(new THREE.BoxGeometry(F.L+10,10,F.W+10),arenaMats.body);
 body.position.y=-5.2;body.receiveShadow=true;arenaTable.add(body);
 const legGeo=new THREE.BoxGeometry(4,34,4);
 [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(s=>{const l=new THREE.Mesh(legGeo,arenaMats.body);
  l.position.set(s[0]*(F.L/2-2),-27,s[1]*(F.W/2-2));arenaTable.add(l);});
 arenaTable.visible=false;
 return arenaTable;
}

/* ===== active flag ===== */
let ARENA_ON=false;
function applyTable(){
 ARENA_ON=cfg.table==='arena';
 if(primTable)primTable.visible=!ARENA_ON;
 if(arenaTable)arenaTable.visible=ARENA_ON;
 // arena ships its own arcade-room backdrop (floor/walls/crowd) — show it with the
 // arena table and hide the classic ground plane + crowd cylinder so they don't z-fight
 if(typeof roomModel!=='undefined'&&roomModel)roomModel.visible=ARENA_ON;
 if(typeof groundMesh!=='undefined'&&groundMesh)groundMesh.visible=!ARENA_ON;
 if(typeof crowdMesh!=='undefined'&&crowdMesh)crowdMesh.visible=!ARENA_ON;
 // the themed pitch plane is shared — carry it into the visible group
 if(fieldMesh&&primTable&&arenaTable){(ARENA_ON?arenaTable:primTable).add(fieldMesh);fieldMesh.visible=true;}
 // each table GLB brings its own nets; repoint netMats so team colours land on the visible pair
 const nets=tableNets[ARENA_ON?'arena':'classic'];
 if(nets){netMats=nets;if(typeof applyColors==='function')applyColors();}
 // if the active table supplies its own goal-frame posts, hide the primitive front frame (keep the net)
 const custom=tableHasFrame[ARENA_ON?'arena':'classic'];
 goalFrames.forEach(g=>{if(g.userData&&g.userData.front)g.userData.front.visible=!custom;});
}

/* ===== arena debug wireframe ===== */
function buildArenaDebugMesh(){
 return new THREE.Mesh(arenaGridGeo(80,6),
  new THREE.MeshBasicMaterial({color:0xff3b3b,transparent:true,opacity:.25,wireframe:true,depthWrite:false}));
}

/* ===== big-goal morph of the baked (GLB) arena shell =====
   The curved bowl can't just scale like the flat table's end-walls — its mouth width is baked
   into a swept curve. Instead we re-project each shell vertex onto the SDF at the *widened* mouth,
   holding its rest signed-distance (its depth into the wall) and its height Y fixed. arenaSD is
   already parameterised per-goal (gh0=right/+x, gh1=left/−x), so this is the same math the physics
   and mesh generator use. Only vertices near a widened mouth actually move (the SDF gradient is ~0
   elsewhere), so it's local, order-independent (survives glTF splitting the mesh by material) and
   leaves UVs — hence textures — untouched. */
function arenaProjectG(x,z,target,gh0,gh1,iters){
 for(let i=0;i<iters;i++){const sd=arenaSD(x,z,gh0,gh1),g=arenaGrad(x,z,gh0,gh1),e=sd-target;x-=g.x*e;z-=g.z*e;}
 return {x,z};
}
// Called once per arena GLB mesh (arena_bowl / led ring). Precomputes, per vertex, the horizontal
// delta to a fully-open RIGHT mouth (dR) and LEFT mouth (dL) so the per-frame path is a cheap blend.
function registerArenaMorph(root){
 root.traverse(c=>{
  if(!c.isMesh||!c.geometry||!c.geometry.attributes.position)return;
  const n=onm(c),pn=c.parent?onm(c.parent):'';
  if(!(n.startsWith('arena_bowl')||pn.startsWith('arena_bowl')||n.startsWith('led')))return;
  const pos=c.geometry.attributes.position,N=pos.count,gh=F.goalHalf,M=PHY.bigGoalMult;
  const base=new Float32Array(N*3),dR=new Float32Array(N*3),dL=new Float32Array(N*3);
  for(let i=0;i<N;i++){const j=i*3,x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
   base[j]=x;base[j+1]=y;base[j+2]=z;
   const d0=arenaSD(x,z,gh,gh);                                  // rest signed distance = this vertex's wall depth
   const wr=arenaProjectG(x,z,d0,gh*M,gh,5);dR[j]=wr.x-x;dR[j+2]=wr.z-z;   // widen right mouth only
   const wl=arenaProjectG(x,z,d0,gh,gh*M,5);dL[j]=wl.x-x;dL[j+2]=wl.z-z;}  // widen left mouth only
  arenaMorph.push({o:c,pos,base,dR,dL,N});
 });
 console.log('arena shell morph: '+arenaMorph.length+' mesh(es)');
}
// Per-frame blend. tR/tL are the eased 0..1 open amounts, read off the same lerped multipliers the
// frame/net ride (goalFrames[1]=right, [0]=left). Runs only while opening/closing; one restore frame
// on settle back to rest, then idle. Deltas for the two mouths don't overlap, so summing is safe.
function arenaMorphUpdate(){
 if(!ARENA_ON||!arenaMorph.length)return;
 const M=PHY.bigGoalMult,den=(M-1)||1;
 const tR=clamp((goalFrames[1].scale.z-1)/den,0,1),tL=clamp((goalFrames[0].scale.z-1)/den,0,1);
 const active=tR>1e-4||tL>1e-4;
 if(!active&&!arenaMorphDirty)return;
 for(let m=0;m<arenaMorph.length;m++){const w=arenaMorph[m],p=w.pos,b=w.base,dR=w.dR,dL=w.dL;
  for(let i=0;i<w.N;i++){const j=i*3;
   p.setXYZ(i,b[j]+dR[j]*tR+dL[j]*tL,b[j+1],b[j+2]+dR[j+2]*tR+dL[j+2]*tL);}
  p.needsUpdate=true;w.o.geometry.computeVertexNormals();
 }
 arenaMorphDirty=active;
}
