'use strict';
// ================= VFX: GPU particles =================
// goal, cannonball, pickup and finale effects; a spawn writes its launch state once and the shader flies it, so a frame costs nothing per particle
// three instanced pools (sparks, confetti, blasts), one draw each, hidden when empty; tuning in CONFIG.fx.vfx

const VF=CONFIG.fx.vfx;
const VFX={t:0,u:null,sp:null,cf:null,bl:null,pools:[],si:0,ci:0,bi:0,dirty:false,fade:1,fadeD:0,lights:[],net:[],
 cam:{f:0,fv:0,x:0,xv:0,z:0,zv:0,af:0,ax:0,az:0}};
const _vfC=new THREE.Color(),_vfSz=new THREE.Vector2(),_vfD=[0,0,0],_vfP=new THREE.Vector3();
const VF_W=[1,1,1];

// linear rgb of a hex / css colour (the renderer encodes sRGB on output, so the shaders work in linear)
function vfxLin(h){_vfC.set(h);_vfC.convertSRGBToLinear();return [_vfC.r,_vfC.g,_vfC.b];}
function vfxTeam(t){return vfxLin(t===0?cfg.redColor:cfg.blueColor);}
function vfxMix(a,b,k){return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];}
function vfxRg(a){return a[0]+(a[1]-a[0])*Math.random();}
function vfxLive(){return !!(VF&&VF.on&&VFX.sp);}

// --- shaders ---
const VFX_SPARK_VS=`
uniform float uT;uniform vec2 uRes;uniform float uGrav;uniform float uFloor;uniform vec2 uTab;
attribute vec4 aP;attribute vec4 aV;attribute vec4 aC;attribute vec4 aM;
varying vec3 vCol;varying vec2 vLoc;varying float vLen;varying float vAge;varying float vTw;varying float vSd;
vec3 posAt(float t){
 float k=max(aM.x,0.02),e=exp(-k*t),q=(1.0-e)/k;
 vec3 p=aP.xyz+aV.xyz*q+vec3(0.0,-uGrav*aM.y,0.0)*((t-q)/k);
 if(fract(aM.w*0.5)>=0.5){
  float d=uFloor-p.y;
  if(d>0.0&&abs(p.x)<uTab.x&&abs(p.z)<uTab.y)p.y=uFloor+min(d,1.2)*0.35;
 }
 return p;
}
void main(){
 float age=uT-aP.w;
 vCol=vec3(0.0);vLoc=vec2(0.0);vLen=0.0;vAge=1.0;vTw=0.0;vSd=0.0;
 if(age<0.0||age>aV.w){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 vec3 p=posAt(age);
 vec3 pt=posAt(max(age-aM.z,0.0));
 vec4 c0=projectionMatrix*viewMatrix*vec4(p,1.0);
 vec4 c1=projectionMatrix*viewMatrix*vec4(pt,1.0);
 if(c0.w<0.5||c1.w<0.5){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 float asp=uRes.x/uRes.y;
 vec2 a=c0.xy/c0.w,b=c1.xy/c1.w;
 a.x*=asp;b.x*=asp;
 vec2 d=b-a;float L=length(d);
 vec2 dir=L>1e-5?d/L:vec2(1.0,0.0);
 float u=age/aV.w;
 float sz=aC.w*(1.0-0.55*u*u)*clamp(sqrt(c0.w*0.0143),0.85,1.8);
 float W=max(sz*projectionMatrix[1][1]/c0.w,1.2/uRes.y);
 float lx=mix(-W,L+W,position.x);
 float ly=position.y*W;
 vec2 o=dir*lx+vec2(-dir.y,dir.x)*ly;
 vec2 n=a+o;n.x/=asp;
 gl_Position=vec4(n*c0.w,c0.z,c0.w);
 vCol=aC.rgb;vLoc=vec2(lx,ly)/W;vLen=L/W;vAge=u;
 vTw=aM.w>3.5?5.0:step(1.5,aM.w)*2.0;
 vSd=fract(sin(dot(aP.xyz+aV.xyz,vec3(12.9898,78.233,37.719)))*43758.5453);
}`;
const VFX_SPARK_FS=`
uniform float uT;uniform float uFade;
varying vec3 vCol;varying vec2 vLoc;varying float vLen;varying float vAge;varying float vTw;varying float vSd;
void main(){
 float dx=max(max(-vLoc.x,vLoc.x-vLen),0.0);
 float d=length(vec2(dx,vLoc.y));
 if(d>=1.0)discard;
 float along=vLen>0.001?clamp(vLoc.x/vLen,0.0,1.0):0.0;
 float soft=step(3.5,vTw);
 float core=mix(pow(1.0-d,2.2),exp(-d*d*4.5)*(1.0-d*d),soft);
 float halo=mix(exp(-d*d*3.0)*0.45*(1.0-d),0.0,soft);
 float tailF=pow(1.0-along,1.4);
 float heat=exp(-vAge*7.0);
 vec3 c=mix(vCol,vec3(1.0,0.95,0.85),heat*0.75);
 float tw=1.0+step(1.5,vTw)*step(vTw,2.5)*0.55*sin(uT*(18.0+vSd*20.0)+vSd*60.0);
 float fade=1.0-smoothstep(0.5,1.0,vAge);
 vec3 rgb=c*(core*1.7+halo)*tailF*fade*tw*uFade;
 gl_FragColor=vec4(rgb,1.0);
 #include <tonemapping_fragment>
 #include <encodings_fragment>
}`;
const VFX_CONF_VS=`
uniform float uT;uniform float uConfG;uniform float uFloor;uniform vec2 uTab;uniform float uFade;
attribute vec4 aP;attribute vec4 aV;attribute vec4 aC;attribute vec4 aM;
varying vec3 vCol;varying vec3 vN;varying vec3 vW;
void main(){
 float age=uT-aP.w;
 vCol=vec3(0.0);vN=vec3(0.0,1.0,0.0);vW=vec3(0.0);
 if(age<0.0||age>aV.w){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 float k=aM.x,e=exp(-k*age),q=(1.0-e)/k,sd=aM.w;
 vec3 p=aP.xyz+aV.xyz*q+vec3(0.0,-uConfG,0.0)*((age-q)/k);
 float fl=aM.z*(1.0-e);
 p.x+=sin(age*(3.1+sd*2.3)+sd*40.0)*fl;
 p.z+=cos(age*(2.7+sd*1.9)+sd*17.0)*fl;
 float land=0.0;
 if(p.y<uFloor+0.12&&abs(p.x)<uTab.x&&abs(p.z)<uTab.y){p.y=uFloor+0.12;land=1.0;}
 vec3 ax=normalize(vec3(sin(sd*91.7)+0.1,cos(sd*53.1),sin(sd*27.3+1.0)));
 float ang=sd*6.2831+aM.y*age;
 float cd=length(p-cameraPosition);
 float dk=clamp(sqrt(cd*0.0143),0.7,1.8)*mix(0.35,1.0,smoothstep(6.0,28.0,cd));
 vec3 loc=vec3(position.x*aC.w*dk,position.y*aC.w*1.6*dk,0.0);
 float c=cos(ang),s=sin(ang);
 vec3 rot=loc*c+cross(ax,loc)*s+ax*dot(ax,loc)*(1.0-c);
 vec3 nrm=vec3(0.0,0.0,1.0)*c+cross(ax,vec3(0.0,0.0,1.0))*s+ax*ax.z*(1.0-c);
 if(land>0.5){
  float yaw=sd*37.0;float cy=cos(yaw),sy=sin(yaw);
  rot=vec3(loc.x*cy-loc.y*sy,0.0,loc.x*sy+loc.y*cy);nrm=vec3(0.0,1.0,0.0);
 }
 float sc=(1.0-smoothstep(0.88,1.0,age/aV.w))*uFade;
 vec3 w=p+rot*sc;
 gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);
 vCol=aC.rgb;vN=nrm;vW=w;
}`;
const VFX_CONF_FS=`
uniform vec3 uSun;
varying vec3 vCol;varying vec3 vN;varying vec3 vW;
void main(){
 vec3 V=normalize(cameraPosition-vW);
 vec3 n=normalize(vN);
 float facing=dot(n,V);
 vec3 nn=facing<0.0?-n:n;
 float dif=max(dot(nn,uSun),0.0);
 vec3 base=facing<0.0?mix(vCol,vec3(1.0),0.3):vCol;
 vec3 H=normalize(uSun+V);
 float spc=pow(max(dot(nn,H),0.0),36.0);
 vec3 rgb=base*(0.3+0.9*dif)+vec3(1.0,0.93,0.78)*spc*0.9;
 gl_FragColor=vec4(rgb,1.0);
 #include <tonemapping_fragment>
 #include <encodings_fragment>
}`;
const VFX_BLAST_VS=`
uniform float uT;
attribute vec4 aP;attribute vec4 aQ;attribute vec4 aN;attribute vec4 aH;attribute vec4 aB;
varying vec2 vUv;varying float vAge;varying vec4 vH;varying vec3 vB;varying float vSd;varying float vKind;
void main(){
 float age=uT-aP.w;
 vUv=position.xy;vAge=1.0;vH=vec4(0.0);vB=vec3(0.0);vSd=0.0;vKind=0.0;
 if(age<0.0||age>aQ.x){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 float a=age/aQ.x;
 float size=mix(aQ.y,aQ.z,1.0-pow(1.0-a,2.4))*clamp(sqrt(length(aP.xyz-cameraPosition)*0.0143),0.9,1.5);
 vec3 r,u;
 float kind=aN.w;
 if(kind<0.5||kind>1.5){
  r=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  u=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
 }else{
  vec3 n=normalize(aN.xyz);
  vec3 h=abs(n.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
  r=normalize(cross(h,n));u=cross(n,r);
 }
 float rot=aQ.w*6.2831;float cr=cos(rot),sr=sin(rot);
 vec2 q=vec2(position.x*cr-position.y*sr,position.x*sr+position.y*cr);
 vec3 w=aP.xyz+(r*q.x+u*q.y)*size;
 if(kind<0.5||kind>1.5)w+=normalize(cameraPosition-aP.xyz)*size*0.55;
 gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0);
 vAge=a;vH=aH;vB=aB.rgb;vSd=aQ.w;vKind=kind;
}`;
const VFX_BLAST_FS=`
uniform float uFade;uniform sampler2D uNoise;
varying vec2 vUv;varying float vAge;varying vec4 vH;varying vec3 vB;varying float vSd;varying float vKind;
void main(){
 vec2 p=vUv;float r=length(p);
 if(r>=1.0)discard;
 float a=vAge;
 vec3 col;float al;float occ=0.0;
 if(vKind<0.5){
  vec2 q=p*0.5+0.5;vec2 so=vec2(vSd*7.13,vSd*3.77);
  float n1=texture2D(uNoise,q*1.15+so+vec2(0.0,-a*0.35)).r;
  float n2=texture2D(uNoise,q*2.6-so.yx+vec2(a*0.22,0.0)).g;
  float n=n1*0.62+n2*0.38;
  float dens=(1.0-r)*1.3+(n-0.5)*1.05;
  float thr=mix(-0.05,0.8,pow(a,0.75));
  float m=smoothstep(thr,thr+0.24,dens);
  float n3=texture2D(uNoise,q*4.3+so*1.7+vec2(0.0,-a*0.5)).a;
  float temp=clamp(dens*(1.0-a*0.7),0.0,1.0);
  float rim=(1.0-smoothstep(0.0,0.16,dens-thr))*m;
  col=(vB*(0.5+0.9*temp)*(0.65+0.7*n3)+vH.rgb*(smoothstep(0.6,1.05,temp)*0.8+rim*0.9))*vH.a*(1.0-a*0.5)*mix(0.3,1.0,smoothstep(0.05,0.6,temp));
  al=m*smoothstep(0.0,0.05,a)*(1.0-smoothstep(0.7,1.0,a));
  occ=0.5;
 }else if(vKind<1.5){
  float w=mix(0.17,0.05,a);
  float rc=1.0-w*0.55;
  float d=abs(r-rc)/(w*0.55);
  float band=pow(clamp(1.0-d,0.0,1.0),1.5);
  float an=atan(p.y,p.x)*0.159155+0.5;
  float nn=texture2D(uNoise,vec2(an*3.0+vSd*5.0,a*0.25+vSd)).b;
  band*=0.45+0.95*nn;
  float lead=smoothstep(rc-w*0.55,rc+w*0.4,r);
  col=mix(vB,vH.rgb,lead*0.45)*vH.a;
  al=band*(1.0-smoothstep(0.55,1.0,a))*smoothstep(0.0,0.04,a);
 }else{
  float g=(exp(-r*r*5.0)+0.3*exp(-r*r*16.0))*smoothstep(1.0,0.55,r);
  col=mix(vB,vH.rgb,exp(-r*r*8.0))*vH.a;
  al=g*(1.0-a)*(1.0-a);
 }
 gl_FragColor=vec4(col*al*uFade,al*occ*uFade);
 #include <tonemapping_fragment>
 #include <encodings_fragment>
}`;

// --- build ---
// four tileable value-noise channels the blast shaders read; a few thousand taps, once
function vfxNoiseTex(){
 const N=64,d=new Uint8Array(N*N*4),oct=[[4,.5],[8,.28],[16,.14],[32,.08]];
 for(let ch=0;ch<4;ch++){
  const gr=oct.map(o=>{const g=new Float32Array(o[0]*o[0]);for(let i=0;i<g.length;i++)g[i]=Math.random();return g;});
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   let v=0;
   for(let o=0;o<oct.length;o++){
    const n=oct[o][0],fx=x/N*n,fy=y/N*n,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,
     sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty),g=gr[o],xa=x0%n,xb=(x0+1)%n,ya=y0%n,yb=(y0+1)%n,
     a=g[ya*n+xa],b=g[ya*n+xb],c=g[yb*n+xa],e=g[yb*n+xb];
    v+=oct[o][1]*((a+(b-a)*sx)*(1-sy)+(c+(e-c)*sx)*sy);
   }
   d[(y*N+x)*4+ch]=Math.min(255,v*255)|0;
  }
 }
 const t=new THREE.DataTexture(d,N,N,THREE.RGBAFormat);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=t.minFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;
 return t;
}
function vfxPool(corner,idx,n,names,vs,fs,blend,U){
 const g=new THREE.InstancedBufferGeometry(),A={};
 g.setAttribute('position',new THREE.Float32BufferAttribute(corner,3));
 g.setIndex(idx);
 for(const k of names){
  const arr=new Float32Array(n*4);
  if(k==='aP')for(let i=0;i<n;i++)arr[i*4+3]=-1e4;
  const a=new THREE.InstancedBufferAttribute(arr,4);a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(k,a);A[k]=a;
 }
 g.instanceCount=n;
 const m=new THREE.ShaderMaterial({uniforms:U,vertexShader:vs,fragmentShader:fs,transparent:!!blend,
  blending:blend==='premul'?THREE.CustomBlending:blend||THREE.NoBlending,depthWrite:!blend,depthTest:true});
 if(blend==='premul'){m.blendEquation=THREE.AddEquation;m.blendSrc=THREE.OneFactor;m.blendDst=THREE.OneMinusSrcAlphaFactor;}
 const mesh=new THREE.Mesh(g,m);
 mesh.frustumCulled=false;mesh.visible=false;mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=blend?4:0;
 scene.add(mesh);
 return {mesh,A,n,live:0};
}
// called once from buildFxPools (world.js); the meshes stay in the scene, hidden while empty, so their shaders compile with the rest
function vfxBuild(){
 if(!VF||!VF.on||VFX.sp)return;
 const U={uT:{value:0},uRes:{value:new THREE.Vector2(1280,720)},uGrav:{value:VF.grav},uConfG:{value:VF.confG},
  uFloor:{value:0.12},uTab:{value:new THREE.Vector2(F.L/2+F.goalDepth,F.W/2)},uFade:{value:1},
  uNoise:{value:vfxNoiseTex()},uSun:{value:new THREE.Vector3(VF.sun[0],VF.sun[1],VF.sun[2]).normalize()}};
 VFX.u=U;
 VFX.sp=vfxPool([0,-1,0,1,-1,0,1,1,0,0,1,0],[0,1,2,0,2,3],VF.sparks,['aP','aV','aC','aM'],VFX_SPARK_VS,VFX_SPARK_FS,THREE.AdditiveBlending,U);
 VFX.cf=vfxPool([-1,-1,0,1,-1,0,1,1,0,-1,1,0],[0,1,2,0,2,3],VF.confetti,['aP','aV','aC','aM'],VFX_CONF_VS,VFX_CONF_FS,null,U);
 VFX.bl=vfxPool([-1,-1,0,1,-1,0,1,1,0,-1,1,0],[0,1,2,0,2,3],VF.blasts,['aP','aQ','aN','aH','aB'],VFX_BLAST_VS,VFX_BLAST_FS,'premul',U);
 VFX.pools=[VFX.sp,VFX.cf,VFX.bl];
 for(let i=0;i<2;i++)VFX.net.push({t:99,x:0,y:0,z:0,col:new THREE.Color(),a:0});
}

// --- spawn ---
// flags: 1 skids on the pitch, 2 twinkles, 4 a soft glow (an ember); delay is seconds from now
function vfxSpk(px,py,pz,vx,vy,vz,life,c,pw,size,drag,grav,tail,flags,delay){
 const P=VFX.sp,i=VFX.si,o=i*4,b=VFX.t+(delay||0);
 VFX.si=(i+1)%P.n;
 const aP=P.A.aP.array,aV=P.A.aV.array,aC=P.A.aC.array,aM=P.A.aM.array;
 aP[o]=px;aP[o+1]=py;aP[o+2]=pz;aP[o+3]=b;
 aV[o]=vx;aV[o+1]=vy;aV[o+2]=vz;aV[o+3]=life;
 aC[o]=c[0]*pw;aC[o+1]=c[1]*pw;aC[o+2]=c[2]*pw;aC[o+3]=size;
 aM[o]=drag;aM[o+1]=grav;aM[o+2]=tail;aM[o+3]=flags||0;
 if(b+life>P.live)P.live=b+life;
 VFX.dirty=true;
}
function vfxConf(px,py,pz,vx,vy,vz,life,c,size,delay){
 const P=VFX.cf,i=VFX.ci,o=i*4,b=VFX.t+(delay||0);
 VFX.ci=(i+1)%P.n;
 const aP=P.A.aP.array,aV=P.A.aV.array,aC=P.A.aC.array,aM=P.A.aM.array;
 aP[o]=px;aP[o+1]=py;aP[o+2]=pz;aP[o+3]=b;
 aV[o]=vx;aV[o+1]=vy;aV[o+2]=vz;aV[o+3]=life;
 aC[o]=c[0];aC[o+1]=c[1];aC[o+2]=c[2];aC[o+3]=size;
 aM[o]=VF.confDrag*rand(.8,1.25);aM[o+1]=rand(6,15)*(Math.random()<.5?-1:1);aM[o+2]=rand(1.5,4.5);aM[o+3]=Math.random();
 if(b+life>P.live)P.live=b+life;
 VFX.dirty=true;
}
// kind 0 = energy billboard, 1 = ring lying in the plane of (nx,ny,nz), 2 = glow flash
function vfxBlast(kind,x,y,z,nx,ny,nz,life,s0,s1,hot,pw,body,delay){
 const P=VFX.bl,i=VFX.bi,o=i*4,b=VFX.t+(delay||0);
 VFX.bi=(i+1)%P.n;
 const aP=P.A.aP.array,aQ=P.A.aQ.array,aN=P.A.aN.array,aH=P.A.aH.array,aB=P.A.aB.array;
 aP[o]=x;aP[o+1]=y;aP[o+2]=z;aP[o+3]=b;
 aQ[o]=life;aQ[o+1]=s0;aQ[o+2]=s1;aQ[o+3]=Math.random();
 aN[o]=nx;aN[o+1]=ny;aN[o+2]=nz;aN[o+3]=kind;
 aH[o]=hot[0];aH[o+1]=hot[1];aH[o+2]=hot[2];aH[o+3]=pw;
 aB[o]=body[0];aB[o+1]=body[1];aB[o+2]=body[2];aB[o+3]=0;
 if(b+life>P.live)P.live=b+life;
 VFX.dirty=true;
}
// a unit direction within `spread` of (dx,dy,dz)
function vfxDir(dx,dy,dz,spread){
 const z=rand(-1,1),a=rand(0,6.2832),s=Math.sqrt(1-z*z);
 const x=dx+Math.cos(a)*s*spread,y=dy+z*spread,w=dz+Math.sin(a)*s*spread,l=Math.hypot(x,y,w)||1;
 _vfD[0]=x/l;_vfD[1]=y/l;_vfD[2]=w/l;return _vfD;
}
function vfxSphere(){
 const z=rand(-1,1),a=rand(0,6.2832),s=Math.sqrt(1-z*z);
 _vfD[0]=Math.cos(a)*s;_vfD[1]=z;_vfD[2]=Math.sin(a)*s;return _vfD;
}

// --- lights, net, camera ---
// an envelope on a light: holds `peak` for `hold`, then decays; a pooled light is borrowed when the pulse starts and handed back when it is spent
function vfxLight(l,pooled,x,y,z,col,dist,peak,hold,decay,delay){
 VFX.lights.push({l,pooled,x,y,z,col,dist,peak,hold,decay,t0:VFX.t+(delay||0)});
}
function vfxLightsUpdate(){
 for(let i=VFX.lights.length-1;i>=0;i--){
  const e=VFX.lights[i],age=VFX.t-e.t0;
  if(age<0)continue;
  if(e.pooled&&!e.l){
   e.l=fxLightGet(e.col,e.dist);
   if(!e.l){VFX.lights.splice(i,1);continue;}
   e.l.position.set(e.x,e.y,e.z);
  }
  const k=age<e.hold?1:Math.exp(-(age-e.hold)*e.decay);
  const fl=age<0.35?0.9+0.1*Math.sin(age*90):1;
  e.l.intensity=e.peak*k*fl;
  if(k<0.02){
   if(e.pooled)fxLightPut(e.l);else e.l.intensity=0;
   VFX.lights.splice(i,1);
  }
 }
}
function vfxNetHit(gi,x,y,z,col){
 const n=VFX.net[gi];if(!n)return;
 n.t=0;n.x=x;n.y=y;n.z=z;n.col.setRGB(col[0],col[1],col[2]);n.a=1;
}
// the ripple and glow ride the net material's own shader (a patch, applied once when the material is made)
function vfxNetPatch(m){
 const U={uRip:{value:new THREE.Vector4(0,0,0,99)},uRipA:{value:0},uRipC:{value:new THREE.Vector3()},uRipV:{value:VF.goal.net.speed}};
 m.userData.rip=U;
 m.onBeforeCompile=sh=>{
  for(const k in U)sh.uniforms[k]=U[k];
  sh.vertexShader=sh.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vRipW;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvRipW=(modelMatrix*vec4(position,1.0)).xyz;');
  sh.fragmentShader=sh.fragmentShader
   .replace('#include <common>','#include <common>\nuniform vec4 uRip;uniform float uRipA;uniform vec3 uRipC;uniform float uRipV;varying vec3 vRipW;')
   .replace('#include <map_fragment>',`
 float rpD=distance(vRipW,uRip.xyz);
 float rpF=uRip.w*uRipV;
 float rpW=sin(rpD*0.62-uRip.w*17.0)*exp(-rpD*0.07)*exp(-uRip.w*2.4)*uRipA*step(rpD,rpF+2.0);
 float rpC=smoothstep(5.0,0.0,abs(rpD-rpF))*exp(-uRip.w*3.2)*uRipA*step(0.001,uRip.w);
 vec4 texelColor=texture2D(map,vUv+vec2(rpW*0.07,rpW*0.045));
 texelColor=mapTexelToLinear(texelColor);
 diffuseColor*=texelColor;`)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=uRipC*rpC*1.6;');
 };
 m.customProgramCacheKey=()=>'vfxnet';
}
function vfxNetUpdate(rdt){
 for(let gi=0;gi<VFX.net.length;gi++){
  const n=VFX.net[gi],m=netMats[gi],U=m&&m.userData.rip;
  if(!U)continue;
  if(n.a<=0){if(U.uRipA.value!==0){U.uRipA.value=0;U.uRipC.value.set(0,0,0);if(m.emissive)m.emissive.setRGB(0,0,0);}continue;}
  n.t+=rdt;
  const G=VF.goal.net,decay=Math.exp(-n.t*2.3);
  n.a=n.t>2.2?0:1;
  U.uRip.value.set(n.x,n.y,n.z,n.t);
  U.uRipA.value=G.ripple*n.a;
  U.uRipC.value.set(n.col.r,n.col.g,n.col.b).multiplyScalar(G.pulse);
  if(m.emissive)m.emissive.copy(n.col).multiplyScalar(G.pulse*decay*0.9);
 }
}
// a hit shoves the camera along (dx,dz) and punches the zoom; both are springs, so they overshoot a touch and settle
function vfxPunch(dx,dz,k){
 const C=VF.camera;if(!C||!C.on||S.photo||S.phase==='replay')return;
 const q=VFX.cam,m=k||1;
 q.f=-C.zoom*m;q.fv=0;
 q.x=dx*C.push*m;q.xv=0;q.z=dz*C.push*m;q.zv=0;
}
// cameraUpdate takes last frame's offset back out before it eases toward its target, then puts this frame's on after lookAt
function vfxCamPre(){
 const q=VFX.cam;
 if(q.ax||q.az){camera.position.x-=q.ax;camera.position.z-=q.az;q.ax=q.az=0;}
 if(q.af){camera.fov-=q.af;q.af=0;camera.updateProjectionMatrix();}
}
function vfxCamPost(rdt){
 const C=VF.camera,q=VFX.cam;
 if(!C||!C.on)return;
 const w=C.hz*6.2832,z=C.damp,dt=Math.min(rdt,1/30);
 if(Math.abs(q.f)+Math.abs(q.x)+Math.abs(q.z)+Math.abs(q.fv)+Math.abs(q.xv)+Math.abs(q.zv)<0.002){q.f=q.fv=q.x=q.xv=q.z=q.zv=0;return;}
 q.fv+=(-w*w*q.f-2*z*w*q.fv)*dt;q.f+=q.fv*dt;
 q.xv+=(-w*w*q.x-2*z*w*q.xv)*dt;q.x+=q.xv*dt;
 q.zv+=(-w*w*q.z-2*z*w*q.zv)*dt;q.z+=q.zv*dt;
 camera.position.x+=q.x;camera.position.z+=q.z;q.ax=q.x;q.az=q.z;
 if(Math.abs(q.f)>0.002){camera.fov+=q.f;q.af=q.f;camera.updateProjectionMatrix();}
}

// --- per frame ---
function vfxUpdate(rdt){
 if(!VFX.sp)return;
 const U=VFX.u;
 let k=1;
 if(S.phase==='goal'||S.phase==='play')k=lerp(1,clamp(S.timeScale,VF.slowMin,1),VF.slow);
 VFX.t+=rdt*k;U.uT.value=VFX.t;
 if(VFX.fadeD>0){VFX.fade=Math.max(0,VFX.fade-rdt/VFX.fadeD);U.uFade.value=VFX.fade;if(VFX.fade<=0){vfxClear();return;}}
 renderer.getDrawingBufferSize(_vfSz);
 if(U.uRes.value.x!==_vfSz.x||U.uRes.value.y!==_vfSz.y)U.uRes.value.copy(_vfSz);
 let any=false;
 for(const P of VFX.pools){
  const on=VFX.t<P.live;
  if(P.mesh.visible!==on)P.mesh.visible=on;
  if(on)any=true;
  if(VFX.dirty)for(const key in P.A)P.A[key].needsUpdate=true;
 }
 VFX.dirty=false;
 vfxLightsUpdate();
 vfxNetUpdate(rdt);
 if(S.photo||S.phase==='replay'||S.freeRoam){const q=VFX.cam;q.f=q.fv=q.x=q.xv=q.z=q.zv=0;q.ax=q.az=q.af=0;}
 if(any)renderDirty();
 else if(VFX.t>900&&!VFX.lights.length)vfxRebase();
}
function vfxRebase(){
 for(const P of VFX.pools){const a=P.A.aP.array;for(let i=0;i<P.n;i++)a[i*4+3]=-1e4;P.A.aP.needsUpdate=true;P.live=0;}
 VFX.t=0;
}
function vfxClear(){
 if(!VFX.sp)return;
 for(const P of VFX.pools){const a=P.A.aP.array;for(let i=0;i<P.n;i++)a[i*4+3]=-1e4;P.A.aP.needsUpdate=true;P.live=0;P.mesh.visible=false;}
 for(const e of VFX.lights){if(e.l){if(e.pooled)fxLightPut(e.l);else e.l.intensity=0;}}
 VFX.lights.length=0;
 for(const n of VFX.net)n.a=0;
 VFX.fade=1;VFX.fadeD=0;VFX.u.uFade.value=1;VFX.dirty=false;
 const q=VFX.cam;q.f=q.fv=q.x=q.xv=q.z=q.zv=0;
}
// let what is in the air go (the replay cuts in)
function vfxFadeOut(d){if(VFX.sp&&VFX.t<Math.max(VFX.sp.live,VFX.cf.live,VFX.bl.live))VFX.fadeD=d;}

// a point in the view: nx, ny in -1..1 across the frame, d units out from the camera
const _vfF=new THREE.Vector3(),_vfR=new THREE.Vector3(),_vfU=new THREE.Vector3();
function vfxViewPt(nx,ny,d,out){
 camera.updateMatrixWorld();
 _vfF.set(0,0,-1).applyQuaternion(camera.quaternion);_vfR.set(1,0,0).applyQuaternion(camera.quaternion);_vfU.set(0,1,0).applyQuaternion(camera.quaternion);
 const h=d*Math.tan(camera.fov*Math.PI/360),w=h*camera.aspect;
 return out.copy(camera.position).addScaledVector(_vfF,d).addScaledVector(_vfR,nx*w).addScaledVector(_vfU,ny*h);
}

// --- effects ---
// the goal: a burst out of the mouth in the scorer's colour and Federation gold, the net lit and rippling, the camera punched
function vfxGoal(team,p){
 const G=VF.goal,sg=team===0?1:-1,dir=-sg,gx=sg*F.L/2,gi=team===0?1:0;
 const ox=gx+sg*1.0,oy=clamp(p.y,2,7),oz=clamp(p.z,-F.goalHalf+2,F.goalHalf-2);
 const tc=vfxTeam(team),gold=vfxLin(VF.gold),spark=vfxLin(VF.spark);
 const bright=vfxMix(tc,VF_W,0.3),warm=[1,0.78,0.42];
 const sc=clamp(Math.hypot(camera.position.x-ox,camera.position.y-oy,camera.position.z-oz)/75,0.85,1.5);   // a far camera gets a bigger burst
 if(cfg.particles){
  vfxBlast(2,ox,oy,oz,0,0,0,G.core.life,G.core.size[0]*sc,G.core.size[1]*sc,warm,G.core.power,bright);
  vfxBlast(2,ox+dir*3,5,0,0,0,0,0.55,16*sc,26*sc,bright,1.0,tc);
  for(let i=0;i<G.puffs.n;i++){
   const s=G.puffs.size;
   vfxBlast(0,ox+dir*vfxRg(G.puffs.spread),clamp(oy+rand(-2,3),1.5,9),oz+rand(-5,5),0,0,0,
    vfxRg(G.puffs.life),s[0]*sc*rand(.8,1.2),s[1]*sc*rand(.8,1.25),warm,G.puffs.power,tc,i*0.035);
  }
  vfxBlast(1,ox+dir*3,0.3,oz,0,1,0,G.ring.life,2,G.ring.size*sc,warm,G.ring.power,tc);
  vfxBlast(1,ox+dir*3,0.32,oz,0,1,0,G.ring.life*1.3,2,G.ring.size*sc*1.4,spark,G.ring.power*0.5,gold,0.1);
  const S1=G.sparks,ss=Math.sqrt(sc);
  for(let i=0;i<S1.n;i++){
   const d=vfxDir(dir,0.32,0,S1.cone),sp=vfxRg(S1.speed)*ss,r=Math.random();
   const c=r<0.38?gold:r<0.62?spark:bright;
   vfxSpk(ox,oy,oz,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(S1.life),c,S1.power*rand(.7,1.15),vfxRg(S1.size),vfxRg(S1.drag),1,S1.tail,1,
    (i<S1.n*0.62?0:0.17)+rand(0,0.06));
  }
  const S2=G.glitter;
  for(let i=0;i<S2.n;i++){
   const d=vfxSphere(),sp=vfxRg(S2.speed)*ss,c=Math.random()<0.55?gold:Math.random()<0.5?spark:bright;
   vfxSpk(ox,oy,oz,d[0]*sp+dir*10,Math.abs(d[1])*sp*0.8,d[2]*sp,vfxRg(S2.life),c,S2.power*rand(.6,1.1),vfxRg(S2.size),vfxRg(S2.drag),0.55,0,3,rand(0,0.45));
  }
  const S3=G.embers;
  for(let i=0;i<S3.n;i++){
   const d=vfxSphere(),sp=vfxRg(S3.speed);
   vfxSpk(ox+dir*rand(0,8),oy+rand(-1,2),oz+rand(-8,8),d[0]*sp+dir*6,Math.abs(d[1])*sp+rand(3,9),d[2]*sp,vfxRg(S3.life),
    Math.random()<0.5?gold:bright,S3.power*rand(.6,1.1),vfxRg(S3.size)*sc,1.1,-0.12,0,6,rand(0,0.25));
  }
  const FO=G.fountain;
  for(const sz of [-1,1]){
   for(let i=0;i<FO.n;i++){
    const d=vfxDir(dir*0.35,1,-sz*0.28,0.28),sp=vfxRg(FO.speed)*ss;
    vfxSpk(gx,F.goalH,sz*F.goalHalf,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(FO.life),Math.random()<0.7?gold:spark,FO.power*rand(.7,1.1),vfxRg(FO.size),0.7,1,FO.tail,1,
     0.12+i/FO.n*FO.over);
   }
  }
  const CF=G.confetti,cols=[bright,tc,VF_W,gold,spark,tc];
  for(let i=0;i<CF.n;i++){
   const d=vfxDir(dir,0.6,0,0.7),sp=vfxRg(CF.speed)*ss;
   vfxConf(ox,oy+rand(-1,2),oz+rand(-4,4),d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(CF.life),cols[i%cols.length],vfxRg(CF.size),
    (i<CF.n*0.6?0.06:0.3)+rand(0,0.08));
  }
 }
 const L=G.light,gl=goalLights[gi];
 if(gl){gl.color.set(team===0?cfg.redColor:cfg.blueColor);vfxLight(gl,false,0,0,0,0,0,L.goal,0.15,L.decay,0);}
 vfxLight(null,true,ox+dir*4,oy+3,oz,0xffc98a,60,L.flash,0.04,6,0);
 vfxNetHit(gi,ox+sg*1.5,oy,oz,tc);
 vfxPunch(dir,0,G.punch);
}
// the cannonball: fire, a ground shockwave and a spray of orange sparks (the smoke and the shard debris are fx.js / fracture.js)
function vfxCannon(pos){
 const C=VF.cannon,fire=[1,0.7,0.3],body=[1,0.17,0.02],ember=[1,0.4,0.06],hot=[1,0.85,0.55];
 const x=pos.x,y=Math.max(pos.y,1.5),z=pos.z;
 if(cfg.particles){
  vfxBlast(2,x,y,z,0,0,0,C.core.life,C.core.size[0],C.core.size[1],[1,0.95,0.8],C.core.power,fire);
  vfxBlast(2,x,y+2,z,0,0,0,0.55,22,36,fire,1.1,body);
  for(let i=0;i<C.puffs.n;i++){
   const s=C.puffs.size,sp=C.puffs.spread[1];
   vfxBlast(0,x+rand(-1,1)*sp,y+rand(-1,5),z+rand(-1,1)*sp,0,0,0,vfxRg(C.puffs.life),s[0]*rand(.8,1.2),s[1]*rand(.8,1.3),fire,C.puffs.power,body,i*0.03);
  }
  vfxBlast(1,x,0.3,z,0,1,0,C.ring.life,3,C.ring.size,hot,C.ring.power,ember);
  vfxBlast(1,x,0.32,z,0,1,0,C.ring.life*1.3,3,C.ring.size*1.4,fire,C.ring.power*0.5,body,0.08);
  const S1=C.sparks;
  for(let i=0;i<S1.n;i++){
   const d=vfxDir(0,0.55,0,1.0),sp=vfxRg(S1.speed),r=Math.random();
   vfxSpk(x,y,z,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(S1.life),r<0.5?fire:r<0.8?ember:hot,S1.power*rand(.7,1.15),vfxRg(S1.size),vfxRg(S1.drag),1,S1.tail,1,rand(0,0.04));
  }
  const S3=C.embers;
  for(let i=0;i<S3.n;i++){
   const d=vfxSphere(),sp=vfxRg(S3.speed);
   vfxSpk(x+rand(-5,5),y+rand(-1,3),z+rand(-5,5),d[0]*sp,Math.abs(d[1])*sp+rand(4,12),d[2]*sp,vfxRg(S3.life),Math.random()<0.5?ember:body,S3.power*rand(.6,1.1),vfxRg(S3.size),1.0,-0.14,0,6,rand(0,0.3));
  }
 }
 vfxLight(null,true,x,y+4,z,0xff8a2a,70,C.light,0.04,5,0);
 vfxPunch(Math.sign(camera.position.x-x)||1,Math.sign(camera.position.z-z)||0,C.punch);
}
// a hard hit on a wall or post throws a few sparks off the contact (n = the wall's inward normal, imp = speed into it)
function vfxImpact(b,nx,ny,nz,imp){
 const I=VF.impact;
 if(!I||!I.on||!VFX.sp||!cfg.particles||imp<I.min)return;
 const k=clamp((imp-I.min)/Math.max(1,I.full-I.min),0,1),n=Math.round(lerp(I.n[0],I.n[1],k)),p=b.m.position;
 const x=p.x-nx*BALL_R+nx*0.4,y=p.y-ny*BALL_R+ny*0.4,z=p.z-nz*BALL_R+nz*0.4,gold=vfxLin(VF.gold),spark=vfxLin(VF.spark);
 for(let i=0;i<n;i++){
  const d=vfxDir(nx,ny+0.25,nz,0.85),sp=vfxRg(I.speed)*(0.6+0.7*k);
  vfxSpk(x,y,z,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(I.life),Math.random()<0.5?spark:gold,I.power*rand(.7,1.1),vfxRg(I.size),2.2,1,0.035,1,0);
 }
}
// a power-up collected: a ring off the pitch and a sparkle of its colour
function vfxPickup(pos,hex){
 const P=VF.pickup,c=vfxLin(hex),hot=vfxMix(c,VF_W,0.35),gold=vfxLin(VF.gold);
 const x=pos.x,y=Math.max(pos.y,1.5),z=pos.z;
 if(cfg.particles){
  vfxBlast(2,x,y,z,0,0,0,0.2,6,12,[1,1,0.9],4,hot);
  vfxBlast(1,x,0.3,z,0,1,0,P.ring.life,1.5,P.ring.size,hot,P.ring.power,c);
  for(let i=0;i<P.sparks.n;i++){
   const d=vfxDir(0,0.9,0,0.9),sp=vfxRg(P.sparks.speed);
   vfxSpk(x,y,z,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(P.sparks.life),Math.random()<0.7?hot:c,P.sparks.power*rand(.7,1.1),vfxRg(P.sparks.size),1.5,1,0.04,1,0);
  }
  for(let i=0;i<P.glitter.n;i++){
   const d=vfxSphere(),sp=vfxRg(P.glitter.speed);
   vfxSpk(x,y,z,d[0]*sp,Math.abs(d[1])*sp+4,d[2]*sp,vfxRg(P.glitter.life),Math.random()<0.5?gold:hot,P.glitter.power*rand(.6,1.1),vfxRg(P.glitter.size),1.0,0.5,0,3,rand(0,0.15));
  }
 }
 vfxLight(null,true,x,y+3,z,hex,40,5,0.03,7,0);
}

// the final whistle: cannons, gold fountains along the rails, a volley of shells over the table, rings off the centre spot; returns how long the board waits
function vfxFinale(team){
 const Fi=VF.finale;
 if(!VF.on||!VFX.sp)return 0;
 const tc=vfxTeam(team),gold=vfxLin(VF.gold),spark=vfxLin(VF.spark),bright=vfxMix(tc,VF_W,0.3),warm=[1,0.78,0.42];
 const L=F.L,W=F.W,sc=clamp(Math.hypot(camera.position.x,camera.position.y,camera.position.z)/110,0.9,1.5);
 if(cfg.particles){
  for(let i=0;i<Fi.rings.n;i++)
   vfxBlast(1,0,0.3,0,0,1,0,Fi.rings.life,3,Fi.rings.size*sc,i%2?spark:warm,Fi.rings.power,i%2?gold:tc,i*Fi.rings.gap);
  // confetti cannons at the four corners, shooting over the table
  const cols=[bright,tc,VF_W,gold,spark,tc,gold],C=Fi.cannons;
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const px=sx*(L/2-6),pz=sz*(W/2+3),py=10,aim=Math.hypot(px,42,pz);
   for(let v=0;v<C.volleys;v++){
    const t0=v*C.gap+(sx*sz>0?0:0.1);
    vfxBlast(2,px,py,pz,0,0,0,0.26,5,12,[1,0.9,0.7],2.4,bright,t0);
    for(let i=0;i<C.pieces;i++){
     const d=vfxDir(-px/aim,42/aim,-pz/aim,0.34),sp=vfxRg(C.speed)*Math.sqrt(sc);
     vfxConf(px,py,pz,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(C.life),cols[i%cols.length],vfxRg(C.size),t0+rand(0,0.1));
    }
    for(let i=0;i<C.sparks;i++){
     const d=vfxDir(-px/aim,42/aim,-pz/aim,0.3),sp=vfxRg(C.speed)*1.2;
     vfxSpk(px,py,pz,d[0]*sp,d[1]*sp,d[2]*sp,rand(0.8,1.5),Math.random()<0.6?gold:spark,3.4,rand(0.14,0.26),1.2,1,0.06,1,t0+rand(0,0.08));
    }
   }
  }
  // gold fountains along the long rails
  const FO=Fi.fountains,fs=Math.sqrt(sc);
  for(const sz of [-1,1])for(let k=0;k<FO.n;k++){
   const x=(k/(FO.n-1)-0.5)*L*0.78;
   for(let i=0;i<FO.per;i++){
    const d=vfxDir(0,1,-sz*0.3,0.2),sp=vfxRg(FO.speed)*fs;
    vfxSpk(x,9,sz*(W/2+3.5),d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(FO.life),Math.random()<0.75?gold:spark,FO.power*rand(.7,1.1),rand(0.14,0.26),0.8,1,0.06,1,
     0.25+i/FO.per*FO.over+k*0.05);
   }
  }
  // shells: a bright streak climbs, then bursts
  const SH=Fi.shells,pal=[bright,gold,VF_W,spark,tc,gold];
  for(let s=0;s<SH.n;s++){
   vfxViewPt(lerp(-0.72,0.72,(s+rand(0.2,0.8))/SH.n),rand(0.2,0.62),camera.position.length()*0.85,_vfP);
   if(_vfP.y<24)_vfP.y=24+rand(0,8);
   const t0=SH.from+s*SH.gap+rand(0,0.14),side=Math.random()<0.5?-1:1,
    ax=_vfP.x,ay=_vfP.y,az=_vfP.z,x0=ax+rand(-6,6),z0=side*(W/2+8),
    c1=pal[s%pal.length],c2=pal[(s+2)%pal.length],tb=t0+SH.rise,type=s%3;
   vfxSpk(x0,6,z0,(ax-x0)/SH.rise,(ay-6)/SH.rise,(az-z0)/SH.rise,SH.rise,spark,3.2,0.24,0.02,0,0.2,0,t0);
   vfxBlast(2,ax,ay,az,0,0,0,0.3,12*sc,26*sc,[1,0.95,0.8],1.5,c1,tb);
   for(let i=0;i<SH.sparks;i++){
    let d;
    if(type===1){const a=rand(0,6.2832);d=_vfD;d[0]=Math.cos(a)*0.95;d[1]=Math.sin(a)*0.5;d[2]=Math.sin(a+1.1)*0.7;}
    else d=vfxSphere();
    const sp=vfxRg(SH.speed)*fs*(type===2&&i%2?0.55:1);
    vfxSpk(ax,ay,az,d[0]*sp,d[1]*sp,d[2]*sp,vfxRg(SH.life),i%3?c1:c2,SH.power*rand(.7,1.15),rand(0.16,0.32),vfxRg([1.1,1.7]),0.5,0.07,1,tb);
   }
   for(let i=0;i<SH.glitter;i++){
    const d=vfxSphere(),sp=rand(4,26)*fs;
    vfxSpk(ax,ay,az,d[0]*sp,d[1]*sp,d[2]*sp,rand(1.6,3.0),Math.random()<0.5?gold:c1,3.6,rand(0.14,0.24),0.9,0.6,0,3,tb+rand(0,0.3));
   }
   vfxLight(null,true,ax,ay,az,0xffd9a0,55,SH.light,0.04,7,tb);
  }
  // a light rain over the whole table
  const R=Fi.rain;
  for(let i=0;i<R.n;i++)
   vfxConf(rand(-L*0.55,L*0.55),vfxRg(R.height),rand(-W*0.6,W*0.6),rand(-4,4),rand(-14,-4),rand(-4,4),vfxRg(R.life),cols[i%cols.length],vfxRg(R.size),R.from+rand(0,R.over));
 }
 for(const gl of goalLights){gl.color.set(team===0?cfg.redColor:cfg.blueColor);vfxLight(gl,false,0,0,0,0,0,Fi.light,0.6,1.1,0);}
 vfxPunch(0,0,Fi.punch);
 return cfg.particles?Fi.board:0;
}
// the full-time board comes in once the finale has had its moment; a key or click brings it at once
let vfxSkipT=0;
function vfxWinTick(rdt){
 if(!(S.winT>0))return;
 if(S.phase!=='win'){S.winT=0;return;}
 S.winT-=rdt;vfxSkipT+=rdt;
 if(S.winT>0)return;
 S.winT=0;
 const w=$('win');w.classList.remove('hidden','winIn');void w.offsetWidth;w.classList.add('winIn');
 vfxConfetti2D(S.score[0]>S.score[1]?0:1);
}
function vfxWinSkip(){if(S.winT>0&&vfxSkipT>0.6)S.winT=0.0001;}
addEventListener('keydown',vfxWinSkip,true);
addEventListener('mousedown',vfxWinSkip,true);

// --- screen-space confetti: over the menus and the full-time board, where the 3D scene is dimmed or covered ---
let vfxCv=null,vfxCx=null,vfxPcs=[],vfxCfOn=false,vfxCfT=0,vfxCfCols=null,vfxCfLast=0;
function vfxConfetti2D(w){
 const C=VF.confetti2d;
 if(!VF.on||!C||!C.on||typeof document==='undefined')return false;
 if(!vfxCv){
  vfxCv=document.createElement('canvas');vfxCv.id='fxConf';
  vfxCv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(vfxCv);vfxCx=vfxCv.getContext('2d');
 }
 const dpr=Math.min(devicePixelRatio||1,1.5),W=innerWidth,H=innerHeight;
 if(vfxCv.width!==Math.round(W*dpr)||vfxCv.height!==Math.round(H*dpr)){vfxCv.width=Math.round(W*dpr);vfxCv.height=Math.round(H*dpr);}
 vfxCx.setTransform(dpr,0,0,dpr,0,0);
 const team=w===0?cfg.redColor:w===1?cfg.blueColor:null;
 vfxCfCols=team?[team,team,'#ffffff','#f0b24a','#f6ddb0']:['#f0b24a','#f6ddb0','#ffffff','#f0b24a','#6bacbc'];
 for(const side of [0,1])for(let i=0;i<C.cannon;i++)vfxPiece(side?W+10:-10,H+10,(side?-1:1)*rand(0.35,0.95),-rand(0.8,1.7),rand(0,0.18));
 vfxCfT=0;
 if(!vfxCfOn){vfxCfOn=true;vfxCfLast=performance.now();requestAnimationFrame(vfxConf2DStep);}
 vfxCv.style.display='block';
 return true;
}
function vfxPiece(x,y,dx,dy,delay){
 const C=VF.confetti2d,sp=rand(C.speed[0],C.speed[1]);
 vfxPcs.push({x,y,vx:dx*sp,vy:dy*sp,w:rand(6,11),h:rand(10,17),r:rand(0,6.28),vr:rand(-9,9),f:rand(0,6.28),vf:rand(5,14),
  c:vfxCfCols[(Math.random()*vfxCfCols.length)|0],life:rand(C.life[0],C.life[1]),age:-delay,sw:rand(0,6.28),sa:rand(20,70)});
}
function vfxConf2DStep(now){
 const C=VF.confetti2d,dt=Math.min(0.05,(now-vfxCfLast)/1000);vfxCfLast=now;
 const W=innerWidth,H=innerHeight;
 vfxCfT+=dt;
 if(vfxCfT<C.rainFor){
  const k=Math.round(dt*C.rain+Math.random()*0.5);   // a trickle from the top edge
  for(let i=0;i<k&&vfxPcs.length<C.max;i++)vfxPiece(rand(0,W),-14,rand(-0.1,0.1),rand(0.2,0.6),0);
 }
 vfxCx.clearRect(0,0,W,H);
 const drag=Math.exp(-C.drag*dt);
 for(let i=vfxPcs.length-1;i>=0;i--){
  const p=vfxPcs[i];
  p.age+=dt;
  if(p.age<0)continue;
  p.vx*=drag;p.vy=p.vy*drag+C.grav*dt;
  if(p.vy>C.fall)p.vy+=(C.fall-p.vy)*Math.min(1,dt*6);
  p.sw+=dt*3;p.x+=(p.vx+Math.sin(p.sw)*p.sa)*dt;p.y+=p.vy*dt;p.r+=p.vr*dt;p.f+=p.vf*dt;
  if(p.age>p.life||p.y>H+30){vfxPcs.splice(i,1);continue;}
  const fl=Math.cos(p.f);
  vfxCx.globalAlpha=Math.min(1,(p.life-p.age)/0.6);
  vfxCx.save();vfxCx.translate(p.x,p.y);vfxCx.rotate(p.r);vfxCx.scale(1,fl);
  vfxCx.fillStyle=p.c;vfxCx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
  if(fl<0){vfxCx.fillStyle='rgba(255,255,255,.28)';vfxCx.fillRect(-p.w/2,-p.h/2,p.w,p.h);}
  vfxCx.restore();
 }
 vfxCx.globalAlpha=1;
 if(vfxPcs.length||vfxCfT<C.rainFor)requestAnimationFrame(vfxConf2DStep);
 else{vfxCfOn=false;vfxCv.style.display='none';}
}
