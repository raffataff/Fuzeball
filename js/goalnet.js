'use strict';
// Classic textile goal. Real open cord geometry, shared seams and fixed hems.
// All coordinates are local to the goal; the opposite end is mirrored in x.
function buildWedgeNet(g,sx,hw,h,depth){
 const C=CONFIG.goalNet.wedge,D=depth-.25,R=C.roof,H=C.hem;
 const rope=new THREE.MeshStandardMaterial({color:C.cord,roughness:.94});
 const hem=new THREE.MeshStandardMaterial({color:C.binding,roughness:.86});
 const brass=new THREE.MeshStandardMaterial({color:0xa77a40,metalness:.78,roughness:.32});
 const bins=[[],[],[]],pins=[[],[],[]];
 const V=(x,y,z)=>new THREE.Vector3(sx*x,y,z);
 const top=x=>x<=R?h-.12*x/R:h-.12-(h-.12-H)*(x-R)/(D-R);
 const L=Math.hypot(D-R,h-.12-H),length=R+L;
 const surface=(z,t)=>{
  const x=t<=R?t:R+(t-R)/L*(D-R),y=top(x);
  const belly=Math.sin(Math.PI*Math.max(0,(t-R)/L))*Math.max(0,1-(z/hw)**2);
  return V(x+.28*belly,y-.17*Math.sin(Math.PI*Math.min(t/R,1))*(1-(z/hw)**2),z);
 };
 // Merge tubes at build time: one draw each for cord, perimeter and fittings.
 function tube(points,r,bin=0,pin=()=>1){
  const verts=bins[bin],weights=pins[bin],radial=bin===1?9:6,axis=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3();
  const rings=[];
  for(let j=0;j<points.length;j++){
   axis.subVectors(points[Math.min(j+1,points.length-1)],points[Math.max(0,j-1)]).normalize();
   a.set(0,0,1);if(Math.abs(axis.z)>.9)a.set(0,1,0);
   a.cross(axis).normalize();b.crossVectors(axis,a);
   const ring=[];
   for(let k=0;k<radial;k++){const th=k/radial*Math.PI*2,rr=r*(bin===1?1+.12*Math.cos(th*3-j*1.7):1);ring.push(points[j].clone().addScaledVector(a,rr*Math.cos(th)).addScaledVector(b,rr*Math.sin(th)));}
   rings.push(ring);
  }
  for(let j=0;j<rings.length-1;j++)for(let k=0;k<radial;k++){
   const q=(k+1)%radial;
   for(const [row,col] of [[j,k],[j,q],[j+1,k],[j,q],[j+1,q],[j+1,k]]){
    const p=rings[row][col];verts.push(p.x,p.y,p.z);weights.push(pin(points[row]));
   }
  }
 }
 function strand(fn,a,b,bin=0,r=C.radius,pin=()=>1){
  const n=Math.max(2,Math.ceil((b-a)/.4)),ps=[];
  for(let j=0;j<=n;j++)ps.push(fn(a+(b-a)*j/n));tube(ps,r,bin,pin);
 }
 const free=p=>Math.min(1,Math.max(0,Math.abs(p.x)/1.5))*Math.min(1,Math.max(0,(hw-Math.abs(p.z))/1.4))*Math.min(1,Math.max(0,(p.y-H)/1.4))*Math.min(1,Math.hypot(Math.abs(p.x)-R,p.y-(h-.12))/1.2);
 const step=C.cell;
 // Diagonal lines in unrolled cloth coordinates produce equal diamond cells.
 for(const dir of [-1,1])for(let c=-hw-length;c<=hw+length;c+=step){
  const a=Math.max(0,dir===1?-hw-c:c-hw),b=Math.min(length,dir===1?hw-c:c+hw);
  if(b>a)strand(t=>surface(c+dir*t,t),a,b,0,C.radius,free);
 }
 // Small tied crossings; same deformation weights as their parent strands.
 for(let t=step/2;t<length;t+=step/2)for(let z=-hw;z<hw;z+=step){
  const zz=z+(Math.round(t/(step/2))%2)*step/2;
  if(Math.abs(zz)>hw-.12)continue;
  // Lines start at -hw-length; derive the shared lattice phase.
  const k=Math.round((zz-t+hw+length)/step),q=-hw-length+k*step+t;
  if(Math.abs(q)>hw-.12)continue;
  const p=surface(q,t);tube([p.clone().add(new THREE.Vector3(0,-.085,-.05)),p.clone().add(new THREE.Vector3(0,.085,.05))],C.radius*1.6,0,free);
 }
 // Side cloth is clipped against the SAME roof profile, with no fabric across the mouth.
 for(const z of [-hw,hw]){
  const sidePin=p=>Math.min(1,Math.abs(p.x)/1.3,(D-Math.abs(p.x))/1.3,Math.max(0,(p.y-H)/1.2),Math.max(0,(top(Math.abs(p.x))-p.y)/1.2));
  for(const dir of [-1,1])for(let c=-D;c<h+D;c+=step){
   // Exact line/polygon clipping keeps every cut end attached to its hem.
   const poly=[[0,H],[D,H],[R,h-.12],[0,h]],cross=[];
   for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=a[1]-dir*a[0]-c,db=b[1]-dir*b[0]-c;
    if(da*db<=0&&Math.abs(da-db)>1e-8){const t=da/(da-db);cross.push(a[0]+t*(b[0]-a[0]));}
   }
   if(cross.length>=2){const a=Math.min(...cross),b=Math.max(...cross);if(b-a>.01)strand(x=>V(x,c+dir*x,z),a,b,0,C.radius,sidePin);}
  }
  strand(t=>surface(z,t),0,length,1,.135);
  strand(x=>V(x,H,z),0,D,1,.135);
  strand(y=>V(0,y,z),H,h,1,.135);
  // Exterior elbow brace stays outside the cloth and clear of the goal opening.
  tube([V(.25,h-.3,z+Math.sign(z)*.27),V(2.6,h-.3,z+Math.sign(z)*.27),V(5.9,.32,z+Math.sign(z)*.27)],.19,2);
  tube([V(5.9,.02,z+Math.sign(z)*.27),V(5.9,.18,z+Math.sign(z)*.27)],.44,2);
  for(const x of [1,3.3,5.8,8.4]){
   const p=surface(z,x<=R?x:R+(x-R)/(D-R)*L);
   tube([p.clone().add(new THREE.Vector3(0,0,-.24)),p.clone().add(new THREE.Vector3(0,0,.24))],.19,2);
  }
 }
 for(const t of [0,R,length])strand(z=>surface(z,t),-hw,hw,1,.135);
 for(const z of [-hw,-hw/2,0,hw/2,hw]){
  const p=surface(z,length);tube([p.clone().add(new THREE.Vector3(0,0,-.19)),p.clone().add(new THREE.Vector3(0,0,.19))],.19,2);
 }
 const parts=bins.map((pos,i)=>{
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,[rope,hem,brass][i]);m.name=['wedge_diamond_cord','wedge_burgundy_hem','wedge_bronze_fittings'][i];
  m.userData.base=Float32Array.from(pos);m.userData.pin=Float32Array.from(pins[i]);m.frustumCulled=false;m.visible=false;g.add(m);return m;
 });
 const deckGeo=new THREE.BoxGeometry(D+.65,.7,hw*2+1.2);deckGeo.translate(sx*(D/2),-.48,0);
 const deck=new THREE.Mesh(deckGeo,new THREE.MeshStandardMaterial({color:0x51301d,roughness:.52}));
 deck.name='wedge_goal_tray';deck.userData.base=Float32Array.from(deckGeo.attributes.position.array);deck.visible=false;deck.receiveShadow=true;g.add(deck);parts.push(deck);
 g.userData.wedge={parts,sx,hw,h,D,R,H,deckMaterial:deck.material,hits:[],active:false,dirty:false};
 return parts;
}

function selectGoalNet(g,classic,skin){
 const w=g.userData.wedge;if(!w)return;
 g.userData.legacyNet.forEach(p=>p.visible=!classic);
 w.parts.forEach(p=>p.visible=classic);w.active=classic;
 if(!classic){w.hits.length=0;w.dirty=true;}
 g.userData.net=classic?w.parts:g.userData.legacyNet;
 if(classic){let wood=null;if(skin)skin.traverse(o=>{if(o.isMesh&&o.material&&!Array.isArray(o.material)&&/walnut|wood/i.test(o.material.name))wood=o.material;});
  w.parts[3].material=wood||w.deckMaterial;
 }
}

function wedgeNetReset(){
 for(const g of goalFrames){const w=g.userData.wedge;if(w){w.hits.length=0;w.dirty=true;}}
 netBallReset();
 wedgeNetUpdate(0);
}

function wedgeRoofHeight(sx,x){
 const w=goalFrames[sx>0?1:0]?.userData.wedge;if(!w||!w.active)return F.goalH;
 const d=Math.abs(x)-F.L/2;
 return d<=w.R?w.h-.12*d/w.R:w.h-.12-(w.h-.12-w.H)*(d-w.R)/(w.D-w.R);
}

// --- cloth hits: a poke rings out; a live hit (a ball pressing in) follows hit.a until wedgeNetRelease ---
function wedgeNetHit(gi,p,speed=60,live=false){
 const g=goalFrames[gi],w=g&&g.userData.wedge;if(!w||!w.active)return null;
 const G=CONFIG.goalNet.wedge.give,y=clamp(p.y,w.H+.3,w.h-.4);
 const x=w.R+(w.h-.12-y)/(w.h-.12-w.H)*(w.D-w.R);
 const scale=lerp(g.scale.z,1+(g.scale.z-1)*PHY.bigGoalBack,Math.min(1,x/F.goalDepth));
 const z=clamp(p.z/scale,-w.hw+.3,w.hw-.3);
 const base=w.parts[0].userData.base,pin=w.parts[0].userData.pin,weights=new Float32Array(pin.length);
 for(let i=0;i<weights.length;i++){
  const j=i*3,dx=Math.abs(base[j])-x,dy=base[j+1]-y,dz=base[j+2]-z;
  weights[i]=pin[i]*Math.exp(-(dx*dx+dy*dy+dz*dz)/G.spread);
 }
 const hit={t:0,a:live?0:clamp(speed/G.poke,.35,G.max),s:1,live,weights};
 w.hits.push(hit);
 if(w.hits.length>3){const i=w.hits.findIndex(h=>!h.live);w.hits.splice(i<0?0:i,1);}
 w.dirty=true;return hit;
}
// the ball left the cloth at speed v: it springs back past rest and rings out
function wedgeNetRelease(hit,v){
 const G=CONFIG.goalNet.wedge.give;
 hit.live=false;hit.t=0;hit.s=-1;hit.a=Math.min(G.max,G.back*v/G.hz);
}

function wedgeNetUpdate(dt){
 const G=CONFIG.goalNet.wedge.give;
 for(const g of goalFrames){const w=g.userData.wedge;if(!w)continue;
  for(const hit of w.hits)if(!hit.live)hit.t+=dt;
  w.hits=w.hits.filter(hit=>hit.live||hit.t<2.4);
  const m=g.scale.z,changing=Math.abs(m-(w.lastScale||1))>1e-6;
  if(!w.dirty&&!w.hits.length&&!changing)continue;
  const backM=1+(m-1)*PHY.bigGoalBack;
  const amps=w.hits.map(hit=>hit.live?hit.a:hit.s*hit.a*Math.sin(hit.t*G.hz)*Math.exp(-hit.t*G.damp));
  for(let k=0;k<w.parts.length;k++){
   const part=w.parts[k],base=part.userData.base,ar=part.geometry.attributes.position.array;
   for(let j=0;j<base.length;j+=3){
    let push=0;if(k===0)for(let n=0;n<w.hits.length;n++)push+=amps[n]*w.hits[n].weights[j/3];
    ar[j]=base[j]+w.sx*push;ar[j+1]=base[j+1]+push*.23;
    ar[j+2]=base[j+2]*lerp(m,backM,Math.min(1,Math.abs(base[j])/F.goalDepth))/m;
   }
   part.geometry.attributes.position.needsUpdate=true;
   if(k===0)part.geometry.computeVertexNormals();
  }
  w.dirty=w.hits.length>0;w.lastScale=m;
 }
}

// --- the ball in the net: the scored ball itself leaves play (S.balls) and plays on into the goal, then drops out through the tray ---
const NB=[null,null];
function netBallStart(gi,b){
 if(!goalFrames[gi])return false;
 netBallClear(gi);
 const i=S.balls.indexOf(b);if(i>=0)S.balls.splice(i,1);
 if(b.warnShell)b.warnShell.visible=false;
 NB[gi]={b,mesh:b.m,v:b.v.clone(),t:0,sx:gi?1:-1,poke:0,hit:null,on:false,sink:false};
 return true;
}
function netBallClear(gi){
 const n=NB[gi];if(!n)return;NB[gi]=null;
 if(n.hit)wedgeNetRelease(n.hit,0);
 removeBall(n.b);
}
function netBallReset(){netBallClear(0);netBallClear(1);}
// v off a surface with inward normal n; returns the impact speed
function nbBounce(v,nx,ny,nz,e){const vn=v.x*nx+v.y*ny+v.z*nz;if(vn>=0)return 0;v.x-=(1+e)*vn*nx;v.y-=(1+e)*vn*ny;v.z-=(1+e)*vn*nz;return -vn;}
// the cloth: a damped spring along inward normal n for a ball pen deep; returns the depth it is held at
function nbSoft(p,v,nx,ny,nz,pen,h,Q){
 let vn=v.x*nx+v.y*ny+v.z*nz;
 if(pen>Q.max){const o=pen-Q.max;p.x+=nx*o;p.y+=ny*o;p.z+=nz*o;pen=Q.max;if(vn<0){v.x-=vn*nx;v.y-=vn*ny;v.z-=vn*nz;vn=0;}}
 const a=Math.max(0,Q.k*pen-Q.c*vn)*h;v.x+=nx*a;v.y+=ny*a;v.z+=nz*a;vn+=a;
 const f=1-Math.exp(-Q.fric*h);v.x-=(v.x-vn*nx)*f;v.y-=(v.y-vn*ny)*f;v.z-=(v.z-vn*nz)*f;   // the cord drags the ball's slide across it
 return pen;
}
function netBallStep(gi,n,h){
 const N=CONFIG.fx.goalFx.net,Q=N.soft,g=goalFrames[gi],w=g.userData.wedge,wd=w&&w.active,p=n.mesh.position,v=n.v,sx=n.sx;
 v.y-=N.grav*h;p.addScaledVector(v,h);
 const d=sx*p.x-F.L/2,back=wd?w.D:F.goalDepth*CONFIG.goalNet.backInset;
 const hw=(wd?w.hw:F.goalHalf)*lerp(g.scale.z,1+(g.scale.z-1)*PHY.bigGoalBack,clamp(d/F.goalDepth,0,1))-BALL_R;
 let hit=0,pen=0;const vIn=v.length();
 if(p.y<BALL_R){p.y=BALL_R;nbBounce(v,0,1,0,N.floorRest);const f=Math.exp(-N.fric*h);v.x*=f;v.z*=f;}
 if(d>back-BALL_R)pen=Math.max(pen,nbSoft(p,v,-sx,0,0,d-back+BALL_R,h,Q));
 if(d<BALL_R){p.x=sx*(F.L/2+BALL_R);nbBounce(v,sx,0,0,N.floorRest);}   // the mouth: it went in, it stays in
 if(Math.abs(p.z)>hw){const sz=Math.sign(p.z);p.z=sz*hw;hit=Math.max(hit,nbBounce(v,0,0,-sz,N.rest));}
 if(wd&&d>w.R){
  // sloped roof from (R, h-.12) down to (D, H): the back of the net, soft
  const a=w.h-.12-w.H,c=w.D-w.R,L=Math.hypot(a,c);
  const sp=((d-w.R)*a+(p.y-(w.h-.12))*c)/L+BALL_R;
  if(sp>0)pen=Math.max(pen,nbSoft(p,v,sx*-a/L,-c/L,0,sp,h,Q));
 }else{
  const top=wd?wedgeRoofHeight(sx,p.x):F.goalH;
  if(p.y>top-BALL_R){p.y=top-BALL_R;hit=Math.max(hit,nbBounce(v,0,-1,0,N.rest));}
 }
 if(pen>0){
  if(!n.on){n.on=true;
   if(wd)n.hit=wedgeNetHit(gi,p,0,true);
   else if(vIn>N.poke&&typeof vfxNetHit==='function')vfxNetHit(gi,p.x,p.y,p.z,[0,0,0]);
  }
  if(n.hit)n.hit.a=pen;
 }else if(n.on){n.on=false;if(n.hit){wedgeNetRelease(n.hit,v.length());n.hit=null;}}
 if(hit>N.poke&&n.poke<=0){n.poke=0.12;
  if(wd)wedgeNetHit(gi,p,hit);else if(typeof vfxNetHit==='function')vfxNetHit(gi,p.x,p.y,p.z,[0,0,0]);
 }
 n.mesh.rotation.z-=v.x*h/BALL_R;n.mesh.rotation.x+=v.z*h/BALL_R;
}
function netBallUpdate(rdt){
 if(S.phase==='pause'||S.photo&&S.photo.freeze)return;
 const N=CONFIG.fx.goalFx.net;
 for(let gi=0;gi<2;gi++){const n=NB[gi];if(!n)continue;
  if(S.phase!=='play'&&S.phase!=='goal'&&S.phase!=='win'){netBallClear(gi);continue;}   // a kickoff or replay cuts away: it goes
  n.t+=rdt;
  if(n.t>N.life){   // drops out through the tray, like a table's ball return
   if(!n.sink){n.sink=true;n.on=false;if(n.hit){wedgeNetRelease(n.hit,0);n.hit=null;}}
   n.mesh.position.y-=N.sink*rdt;if(n.mesh.position.y<-BALL_R*1.2)netBallClear(gi);
   continue;
  }
  const dt=rdt*(S.timeScale||1),k=Math.max(1,Math.min(24,Math.ceil(n.v.length()*dt/0.4),Math.ceil(dt/0.004)));
  n.poke-=dt;
  for(let i=0;i<k;i++)netBallStep(gi,n,dt/k);
 }
}
// main.js render loop: the net ball keeps its glow light, heat and flame
function netBallFeed(rdt){
 for(const n of NB){if(!n)continue;const b=n.b;
  if(b.light)b.light.position.copy(b.m.position);
  heatFeed(b.m,b.key,n.sink?0:n.v.length(),b);
  if(typeof fireFeed==='function')fireFeed(b.key,b.m.position,n.v,rdt*(S.timeScale||1),b,b.light);
 }
}
