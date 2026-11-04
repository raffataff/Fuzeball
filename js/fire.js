'use strict';
// ================= FIRE: the fireball =================
// the ball is molten (fireCoreMat: a dark crust with glowing seams in the ball's own space, so it rolls) inside a flame raymarched through a teardrop that trails it and rises when it is still: one instanced draw for every burning ball
// embers shed as it runs, a flare and sparks on a hard hit or bounce, its pooled light flickers; the sprite trail is off for it (fireOwns, fx.js spawnTrail)
// fireFeed rides heatFeed (main.js live balls, replay.js ghosts), fireSkin rides loadBallModel (models.js), fireBuild rides the warm pass (fracture.js), fireUpdate rides fxUpdate; tuning in CONFIG.fx.fire

const FIC=CONFIG.fx.fire;
const FIRE={u:null,cu:null,fu:null,core:null,mesh:null,A:null,n:0,dt:0,heat:0,tick:0,ek:null,steps:0};
const _fiV=new THREE.Vector3(),_fiW=new THREE.Vector3(),_fiC=new THREE.Color();

// --- shaders ---
// value noise off one 256² texture (G is R shifted by (37,17), one z slice up): one tap a sample, periodic every 256 on all three axes, so the flow offset wraps
const FIRE_GLSL=`
uniform sampler2D uNz;uniform vec3 uK0;uniform vec3 uK1;uniform vec3 uK2;uniform vec3 uK3;
float fiN(vec3 x){
 vec3 p=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 vec2 uv=p.xy+vec2(37.0,17.0)*p.z+f.xy;
 vec2 rg=texture2D(uNz,(uv+0.5)/256.0).rg;
 return mix(rg.x,rg.y,f.z);
}
float fiF(vec3 p){
 float s=fiN(p)*0.5;p=p*2.0+vec3(17.0,59.0,11.0);
 s+=fiN(p)*0.25;p=p*2.0+vec3(31.0,7.0,73.0);
 return (s+fiN(p)*0.125)/0.875;
}
vec3 fiRamp(float t){
 vec3 c=mix(uK0,uK1,smoothstep(0.0,0.4,t));
 c=mix(c,uK2,smoothstep(0.35,0.72,t));
 return mix(c,uK3,smoothstep(0.7,1.0,t));
}
`;
// the core, spliced into MeshStandardMaterial: crust plates split by cracks (distance to the nearest Voronoi border, warped), hairline cracks across the plates, a heat halo round them, hot zones drifting under the crust
const FIRE_CORE_PARS=`
vec3 fiH3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453);}
float fiVor(vec3 x){
 vec3 p=floor(x),f=fract(x),mb=vec3(0.0),mr=vec3(0.0);float md=8.0;
 for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 b=vec3(float(i),float(j),float(k)),r=b+fiH3(p+b)-f;float d=dot(r,r);if(d<md){md=d;mr=r;mb=b;}}
 md=8.0;
 for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 b=mb+vec3(float(i),float(j),float(k)),r=b+fiH3(p+b)-f;vec3 e=r-mr;if(dot(e,e)>1e-5)md=min(md,dot(0.5*(mr+r),normalize(e)));}
 return md;
}
`;
const FIRE_CORE_MAP=`#include <map_fragment>
vec3 fiU=normalize(vFiP);
vec3 fiQ=fiU*uCo.x+vec3(0.0,uT*uCo.w,0.0);
float fiW=fiN(fiQ*0.8+vec3(3.0,11.0,5.0));
float fiE=fiVor(fiQ+(fiW-0.5)*0.7);
float fiB=fiN(fiQ*3.0+vec3(7.0,1.0,13.0));
float fiRb=1.0-abs(fiN(fiQ*2.2+vec3(41.0,5.0,19.0)+fiW)*2.0-1.0);
#if __VERSION__>=300
vec2 fiFw=vec2(fwidth(fiE),fwidth(fiRb))+0.003;
#else
vec2 fiFw=vec2(0.03);
#endif
float fiS=max(1.0-smoothstep(uCo.y-fiFw.x,uCo.y+fiFw.x,fiE),0.45*smoothstep(0.965-fiFw.y,0.965+fiFw.y,fiRb));
float fiG=exp(-fiE*9.0);
float fiH=smoothstep(0.25,0.8,fiN(fiU*1.1+vec3(uT*0.23,-uT*0.19,uT*0.15)));
float fiA=fiW;
diffuseColor.rgb=uCrust*(0.5+0.9*fiB)*(1.0-0.7*fiG);
`;
const FIRE_CORE_BUMP=`
#if __VERSION__>=300
{vec3 fsp=-vViewPosition,fdx=dFdx(fsp),fdy=dFdy(fsp);float fh=-fiS*uCb;
 vec3 r1=cross(fdy,normal),r2=cross(normal,fdx);float det=dot(fdx,r1);
 normal=normalize(abs(det)*normal-sign(det)*(dFdx(fh)*r1+dFdy(fh)*r2));}
#endif
`;
const FIRE_CORE_EM=`
float fiR=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),uCr.w);
float fiTp=clamp((0.55+0.45*fiH)*(0.85+0.15*sin(uT*uCr.x+fiA*9.0))+uHeat*0.25,0.0,1.0);
totalEmissiveRadiance+=fiRamp(fiTp)*fiS*uCo.z*(0.4+fiTp)+fiRamp(0.25+0.2*fiH)*fiG*(1.0-fiS)*uCo.z*0.35+fiRamp(0.2)*uCr.y*(0.3+fiH)+fiRamp(0.5)*fiR*uCr.z;
`;
// the flame: a camera-facing quad over the capsule round the trail axis, sized to its silhouette
const FIRE_VS=`
uniform vec4 uFl;
attribute vec4 aA;attribute vec4 aB;attribute vec4 aC;attribute vec4 aD;
varying vec3 vW;varying vec4 vA;varying vec4 vB;varying vec4 vC;varying vec4 vD;varying vec2 vPz;
void main(){
 float L=aB.w,br=L*0.5+aA.w*uFl.x*1.25;
 vec3 tc=aA.xyz+aB.xyz*(L*0.5)-cameraPosition;float d=max(length(tc),1e-3),pd=max(d-br,2.0);
 float h=d>br*1.02?br*pd/sqrt(d*d-br*br)*1.5:pd*4.0;
 vec3 r=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),u=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
 vW=cameraPosition+tc/d*pd+(r*position.x+u*position.y)*h;
 gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.0);
 vA=aA;vB=aB;vC=aC;vD=aD;vPz=vec2(projectionMatrix[2][2],projectionMatrix[3][2]);
}`;
// march the ray's span through the capsule, stopping at the ball and the pitch; emission with a little absorption (smoke toward the tip), depth written at the first real flame
const FIRE_FS=`
uniform float uT;uniform vec4 uFl;uniform vec4 uFm;
varying vec3 vW;varying vec4 vA;varying vec4 vB;varying vec4 vC;varying vec4 vD;varying vec2 vPz;
vec2 fiSph(vec3 ro,vec3 rd,vec3 c,float r){vec3 o=ro-c;float b=dot(o,rd),h=b*b-dot(o,o)+r*r;if(h<=0.0)return vec2(1e9,-1e9);h=sqrt(h);return vec2(-b-h,-b+h);}
vec2 fiCap(vec3 ro,vec3 rd,vec3 c,vec3 T,float L,float rc){
 vec2 a=fiSph(ro,rd,c,rc),b=fiSph(ro,rd,c+T*L,rc),s=vec2(min(a.x,b.x),max(a.y,b.y));
 vec3 oc=ro-c;float cr=dot(rd,T),co=dot(oc,T),A=1.0-cr*cr,B=dot(oc,rd)-co*cr,h=B*B-A*(dot(oc,oc)-co*co-rc*rc);
 if(A>1e-6&&h>0.0){
  h=sqrt(h);vec2 cy=vec2(-B-h,-B+h)/A;
  if(abs(cr)>1e-6){float ta=-co/cr,tb=(L-co)/cr;cy=vec2(max(cy.x,min(ta,tb)),min(cy.y,max(ta,tb)));}
  else if(co<0.0||co>L)cy=vec2(1e9,-1e9);
  if(cy.x<cy.y)s=vec2(min(s.x,cy.x),max(s.y,cy.y));
 }
 return s;
}
void main(){
 vec3 ro=cameraPosition,rd=normalize(vW-ro);
 vec3 c=vA.xyz,T=vB.xyz;float R=vA.w,Rs=R*uFl.x,L=max(vB.w,0.05);
 vec2 sp=fiCap(ro,rd,c,T,L,Rs*1.25);
 float t0=max(sp.x,0.0),t1=sp.y;
 vec3 ob=ro-c;float bb=dot(ob,rd),hb=bb*bb-dot(ob,ob)+R*R*0.94;
 if(hb>0.0){float tb=-bb-sqrt(hb);if(tb>t0)t1=min(t1,tb);}
 if(rd.y<-1e-4)t1=min(t1,(uFm.z-ro.y)/rd.y);
 if(t1<=t0)discard;
 float dt=(t1-t0)/float(FI_STEPS);
 float t=t0+dt*fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
 float pw=vC.x,st=vD.w;
 vec3 acc=vec3(0.0);float tr=1.0,th=-1.0;
 for(int i=0;i<FI_STEPS;i++){
  vec3 q=ro+rd*t-c;
  float s=dot(q,T),sc=clamp(s,0.0,L),u=sc/L;
  float rr=Rs*sqrt(max(1.0-u,0.0))+0.05;
  vec3 qs=(q-T*(s*(1.0-1.0/st)))*uFl.y;
  float n=fiF(qs-vD.xyz);
  float f=1.0-length(q-T*sc)/rr+(n-0.5)*uFl.z*(0.5+1.2*u);
  float dens=smoothstep(0.08,0.26,f)*smoothstep(0.0,uFm.w,ro.y+rd.y*t);
  if(dens>0.003){
   float n2=fiN(qs*3.0-vD.xyz*3.0+vec3(91.0,23.0,47.0));
   float w=clamp((length(q)-R)/(L+Rs-R),0.0,1.0);   // 0 at the ball's surface, 1 at the tip: it cools as it leaves the ball
   float tp=clamp(f*(1.0-0.85*w)*1.2+(n-0.5)*0.6+(n2-0.5)*0.35+vC.y*0.2+vC.w*0.15+vC.z*0.08,0.0,1.0);
   acc+=tr*fiRamp(tp)*(0.05+1.1*tp*tp)*(0.45+1.1*n2)*dens*pw*dt;
   tr*=exp(-dens*uFm.x*(1.0+uFm.y*u*u)*min(pw,1.0)*dt);   // no smoke before it has caught
   if(th<0.0&&acc.r>0.03)th=t;
  }
  t+=dt;
 }
 if(th<0.0)discard;
 float zv=(viewMatrix*vec4(ro+rd*th,1.0)).z;
 gl_FragDepthEXT=((vPz.x*zv+vPz.y)/(-zv))*0.5+0.5;
 gl_FragColor=vec4(acc,1.0-tr);
 #include <tonemapping_fragment>
 #include <encodings_fragment>
}`;

// --- build ---
function fiLin(h){_fiC.set(h).convertSRGBToLinear();return new THREE.Vector3(_fiC.r,_fiC.g,_fiC.b);}
function fireNoiseTex(){
 const N=256,R=new Uint8Array(N*N),d=new Uint8Array(N*N*4);
 let s=0x2f6b1d;for(let i=0;i<R.length;i++){s=(Math.imul(s,1103515245)+12345)>>>0;R[i]=s>>>24;}
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const o=(y*N+x)*4;d[o]=R[y*N+x];d[o+1]=R[((y+17)&255)*N+((x+37)&255)];d[o+2]=d[o+3]=255;}
 const t=new THREE.DataTexture(d,N,N,THREE.RGBAFormat);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=t.minFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;
 return t;
}
function fireSetup(){
 if(FIRE.u)return;
 FIRE.u={uT:{value:0},uNz:{value:fireNoiseTex()},uK0:{value:new THREE.Vector3()},uK1:{value:new THREE.Vector3()},uK2:{value:new THREE.Vector3()},uK3:{value:new THREE.Vector3()}};
 FIRE.cu=Object.assign({uHeat:{value:0},uCrust:{value:new THREE.Vector3()},uCo:{value:new THREE.Vector4()},uCr:{value:new THREE.Vector4()},uCb:{value:0}},FIRE.u);
 FIRE.fu=Object.assign({uFl:{value:new THREE.Vector4()},uFm:{value:new THREE.Vector4()}},FIRE.u);
 fireTune();
}
// CONFIG.fx.fire into the uniforms (the tools call it after an override; `steps` rebuilds the flame's program)
function fireTune(){
 if(!FIRE.u)return;
 const U=FIRE.u,K=FIC.ramp,C=FIC.core,L=FIC.flame,cu=FIRE.cu;
 U.uK0.value.copy(fiLin(K[0]));U.uK1.value.copy(fiLin(K[1]));U.uK2.value.copy(fiLin(K[2]));U.uK3.value.copy(fiLin(K[3]));
 cu.uCrust.value.copy(fiLin(C.crust));cu.uCo.value.set(C.scale,C.seam,C.seamK,C.crawl);cu.uCr.value.set(C.pulse,C.glow,C.rim,C.rimP);cu.uCb.value=C.bump;
 FIRE.fu.uFl.value.set(L.shell,L.scale,L.erode,L.power);FIRE.fu.uFm.value.set(L.absorb,L.smoke,L.floor,L.fade);
 FIRE.ek=[fiLin(K[2]).toArray(),fiLin(K[1]).toArray(),fiLin(K[3]).toArray()];
 if(FIRE.core)FIRE.core.roughness=C.rough;
 const M=FIRE.mesh&&FIRE.mesh.material;
 if(M&&FIRE.steps!==(FIC.steps|0)){FIRE.steps=FIC.steps|0;M.fragmentShader='#define FI_STEPS '+FIRE.steps+'\n'+FIRE_GLSL+FIRE_FS;M.needsUpdate=true;}
}
// the molten core: a standard material (the crust takes the room's light and reflections) with the seams spliced in as emission
function fireCoreMat(){
 if(FIRE.core)return FIRE.core;
 fireSetup();
 const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:FIC.core.rough,metalness:0});
 m.userData.fireCore=true;   // ballHeatSet leaves it alone: the heat reaches it as uHeat
 m.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,FIRE.cu);
  sh.vertexShader='varying vec3 vFiP;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vFiP=position;');
  sh.fragmentShader='varying vec3 vFiP;\nuniform float uT;uniform float uHeat;uniform vec3 uCrust;uniform vec4 uCo;uniform vec4 uCr;uniform float uCb;\n'+FIRE_GLSL+FIRE_CORE_PARS+sh.fragmentShader
   .replace('#include <map_fragment>',FIRE_CORE_MAP)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=mix(roughnessFactor,0.3,fiS);')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+FIRE_CORE_BUMP)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+FIRE_CORE_EM);
 };
 m.customProgramCacheKey=()=>'fireCore';
 FIRE.core=m;return m;
}
// the ball GLB's burning slots take the molten core: every clone shares it (live balls, replay ghosts, the parked warm copy)
function fireSkin(root){
 if(!FIC.on||!root)return;
 const m=fireCoreMat();
 root.traverse(o=>{const k=o.isMesh?ballKey(o):'';if(FIC.types.indexOf(k)<0)return;o.material=m;ballMatMap[k]=m;});
}
// one resident instanced quad, hidden until a ball burns, so its shader compiles with the scene
function fireBuild(){
 if(FIRE.mesh||!FIC.on||typeof scene==='undefined'||!scene)return;
 fireSetup();
 const n=FIC.max,g=new THREE.InstancedBufferGeometry(),A={};
 g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
 g.setIndex([0,1,2,0,2,3]);
 for(const k of ['aA','aB','aC','aD']){const a=new THREE.InstancedBufferAttribute(new Float32Array(n*4),4);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute(k,a);A[k]=a;}
 g.instanceCount=0;
 FIRE.steps=FIC.steps|0;
 const m=new THREE.ShaderMaterial({uniforms:FIRE.fu,vertexShader:FIRE_VS,fragmentShader:'#define FI_STEPS '+FIRE.steps+'\n'+FIRE_GLSL+FIRE_FS,
  transparent:true,depthWrite:false,depthTest:true,blending:THREE.CustomBlending,extensions:{fragDepth:true}});
 m.blendEquation=THREE.AddEquation;m.blendSrc=THREE.OneFactor;m.blendDst=THREE.OneMinusSrcAlphaFactor;
 const mesh=new THREE.Mesh(g,m);
 mesh.frustumCulled=false;mesh.visible=false;mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=3;
 scene.add(mesh);FIRE.mesh=mesh;FIRE.A=A;
}

// --- per ball ---
function fireOwns(b){return !!(b&&b.fs&&b.fs.on&&FIRE.mesh);}
// one burning ball on screen this frame: p its position, v its velocity (null = keep the last), dt sim seconds since the last feed, o what carries its state (the ball, a replay ghost's shim), l its pooled light or null
function fireFeed(key,p,v,dt,o,l){
 if(!o)return;
 if(FIC.on&&!FIRE.mesh)fireBuild();
 if(!FIC.on||!FIRE.mesh||FIC.types.indexOf(key)<0){if(o.fs)o.fs.on=false;return;}
 let s=o.fs;
 if(!s)s=o.fs={on:false,tk:0,nf:0,T:new THREE.Vector3(0,1,0),L:0,v:new THREE.Vector3(),off:new THREE.Vector3(),fl:0,ign:0,em:0};
 const fresh=!s.on||FIRE.tick-s.tk>2;   // a new ball, or one not seen for a while (the next replay): no swing, no flare off a stale speed
 if(fresh){
  if(!s.on){s.ign=S.phase==='replay'?1:0;s.fl=0;s.off.set(rand(0,256),rand(0,256),rand(0,256));}
  s.on=true;s.nf=0;s.em=0;
  if(v)s.v.copy(v);
 }
 s.tk=FIRE.tick;
 const F=FIC.flame,d=(S.photo&&S.photo.freeze&&S.photo.freezeFx)?0:Math.max(0,dt||0);
 if(v){
  const dv=_fiW.subVectors(v,s.v).length();
  s.v.copy(v);
  if(d>0&&s.nf>2&&dv>FIC.flare.dv)fireFlare(s,p,dv);
 }
 if(d>0)s.nf++;
 const vx=s.v.x,vy=s.v.y,vz=s.v.z,sp=Math.hypot(vx,vy,vz);
 // the flame trails the ball and rises when it is still
 _fiV.set(-vx*F.drag,-vy*F.drag+F.rise,-vz*F.drag).normalize();
 if(_fiV.y<F.lift){const h=Math.hypot(_fiV.x,_fiV.z)||1,k=Math.sqrt(1-F.lift*F.lift)/h;_fiV.set(_fiV.x*k,F.lift,_fiV.z*k);}   // never down into the pitch
 const k=fresh?1:1-Math.exp(-d*F.turn);
 s.T.lerp(_fiV,k).normalize();
 s.L+=(Math.min(BALL_R*(F.rest+sp*F.len),F.maxLen)-s.L)*k;
 s.off.addScaledVector(s.T,Math.min(F.flow[0]+sp*F.flow[1],F.flowMax)*F.scale*d);
 s.off.set(s.off.x%256,s.off.y%256,s.off.z%256);
 s.ign=Math.min(1,s.ign+d/Math.max(0.01,F.ign));
 s.fl=Math.max(0,s.fl-d*FIC.flare.decay);
 if(FIRE.n<FIC.max){
  const i4=FIRE.n*4,A=FIRE.A,a=A.aA.array,b=A.aB.array,c=A.aC.array,e=A.aD.array,G=FIC.flare,sw=1+G.grow*s.fl;
  a[i4]=p.x;a[i4+1]=p.y;a[i4+2]=p.z;a[i4+3]=BALL_R*sw;
  b[i4]=s.T.x;b[i4+1]=s.T.y;b[i4+2]=s.T.z;b[i4+3]=s.L*sw;
  c[i4]=F.power*s.ign*(1+G.pow*s.fl);c[i4+1]=o.hot||0;c[i4+2]=clamp(sp/FIC.embers.ref,0,1);c[i4+3]=s.fl;
  e[i4]=s.off.x;e[i4+1]=s.off.y;e[i4+2]=s.off.z;e[i4+3]=1+F.stretch+Math.min(sp*F.streak,F.streakMax);
  FIRE.n++;
 }
 if(d>FIRE.dt)FIRE.dt=d;
 if((o.hot||0)>FIRE.heat)FIRE.heat=o.hot;
 if(d>0)fireShed(s,p,sp,d);
 if(l)fireLight(s,p,l);
}
// embers off the flame
function fireShed(s,p,sp,d){
 if(!cfg.particles||typeof vfxLive!=='function'||!vfxLive())return;
 const E=FIC.embers,R=BALL_R,T=s.T,v=s.v,ek=FIRE.ek;
 s.em+=lerp(E.rate[0],E.rate[1],clamp(sp/E.ref,0,1))*d*s.ign;
 for(let n=0;s.em>=1&&n<12;n++){
  s.em-=1;
  const q=vfxSphere(),r=R*rand(0.9,1.25),a=rand(0,0.5)*s.L,w=vfxRg(E.speed),qx=q[0],qy=q[1],qz=q[2],soft=Math.random()<0.35;
  vfxSpk(p.x+qx*r+T.x*a,p.y+qy*r+T.y*a,p.z+qz*r+T.z*a,
   v.x*E.carry+(T.x+qx*0.5)*w,v.y*E.carry+(T.y+qy*0.5)*w+rand(1,4),v.z*E.carry+(T.z+qz*0.5)*w,
   vfxRg(E.life),Math.random()<0.45?ek[0]:ek[1],E.power*rand(0.7,1.1),vfxRg(E.size)*(soft?2:1),E.drag,E.rise,soft?0:0.03,soft?4:2,0);
 }
 if(s.em>=1)s.em=0;
}
// a hit or a bounce: the flame swells and brightens, a flash and a fan of sparks along the new heading
function fireFlare(s,p,dv){
 const G=FIC.flare,k=clamp((dv-G.dv)/(G.dv*3),0,1);
 s.fl=Math.max(s.fl,0.5+0.5*k);
 if(!cfg.particles||typeof vfxLive!=='function'||!vfxLive())return;
 const v=s.v,sp=v.length()||1,hx=v.x/sp,hy=v.y/sp,hz=v.z/sp,ek=FIRE.ek;
 vfxBlast(2,p.x,p.y,p.z,0,0,0,0.16,G.flash[0],lerp(G.flash[0],G.flash[1],k),ek[2],1.6,ek[1]);
 const n=Math.round(lerp(G.sparks[0],G.sparks[1],k));
 for(let i=0;i<n;i++){
  const q=vfxDir(hx,hy+0.2,hz,0.9),w=vfxRg(G.speed)*(0.6+0.6*k);
  vfxSpk(p.x,p.y,p.z,q[0]*w,q[1]*w,q[2]*w,rand(0.25,0.6),Math.random()<0.6?ek[0]:ek[1],G.power*rand(0.7,1.1),rand(0.1,0.22),2.0,1,0.04,1,0);
 }
}
function fireLight(s,p,l){
 const L=FIC.light,t=FIRE.u.uT.value,f=0.55*Math.sin(t*17.3)+0.3*Math.sin(t*29.1+1.7)+0.15*Math.sin(t*51.7+0.4);
 l.position.set(p.x,p.y+L.up,p.z);
 l.intensity=L.base*s.ign*(1+L.flicker*f)*(1+L.flare*s.fl);
}

// --- per frame ---
// after every feed (fxUpdate): upload what was fed, run the clock on the sim seconds the balls moved; a pause feeds nothing and the last frame holds
function fireUpdate(rdt){
 if(!FIRE.mesh){if(FIC.on)fireBuild();if(!FIRE.mesh)return;}
 const M=FIRE.mesh,n=FIC.on?FIRE.n:0;
 if(S.phase==='pause'&&!n){FIRE.dt=0;return;}
 FIRE.tick++;
 FIRE.u.uT.value=(FIRE.u.uT.value+FIRE.dt)%1000;
 FIRE.cu.uHeat.value=FIRE.heat;
 M.geometry.instanceCount=n;
 M.visible=n>0;
 if(n)for(const k in FIRE.A)FIRE.A[k].needsUpdate=true;
 FIRE.n=0;FIRE.dt=0;FIRE.heat=0;
}
