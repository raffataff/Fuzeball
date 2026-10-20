'use strict';
// haze: the rooms' air (CONFIG.atmos). Height haze, a glow toward the light and lamps hanging in the air live in three's fog chunk (no draw);
// light shafts are one draw of camera-facing cards; dust motes one Points (High). cfg.atmos: 'off' = no fog at all (the old Fog tick), 'low' = haze + shafts, 'high' = everything

// --- shared uniforms: three clones a material's uniforms but passes a typed array by reference, so every program reads these ---
const HZ={A:new Float32Array(4),B:new Float32Array(4),C:new Float32Array(3),D:new Float32Array(4),E:new Float32Array(3),
 P:new Float32Array(12),Q:new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]),S:new Float32Array(64),
 pts:null,mat:null,sh:null,t:0,id:null};
const HZ_SN=4;   // shafts the motes are lit by

(function(){
 const U={hzA:HZ.A,hzB:HZ.B,hzC:HZ.C,hzD:HZ.D,hzE:HZ.E,hzP:HZ.P,hzQ:HZ.Q},L=THREE.ShaderLib,C=THREE.ShaderChunk;
 for(const k in L){const u=L[k].uniforms;if(u&&u.fogColor)for(const n in U)u[n]={value:U[n]};}
 C.fog_pars_vertex='#ifdef USE_FOG\n varying float fogDepth;\n varying vec3 vHzW;\n#endif\n';
 C.fog_vertex='#ifdef USE_FOG\n fogDepth=-mvPosition.z;\n vHzW=(vec4(mvPosition.xyz-viewMatrix[3].xyz,0.0)*viewMatrix).xyz;\n#endif\n';
 C.fog_pars_fragment=[
  '#ifdef USE_FOG',
  ' uniform vec3 fogColor;',
  ' varying float fogDepth;',
  ' varying vec3 vHzW;',
  ' #ifdef FOG_EXP2',
  '  uniform float fogDensity;',
  ' #else',
  '  uniform float fogNear;',
  '  uniform float fogFar;',
  ' #endif',
  ' uniform vec4 hzA;',      // density at base y, height falloff, base y, cap
  ' uniform vec4 hzB;',      // range, glow power, -, start distance
  ' uniform vec3 hzC;',      // haze colour
  ' uniform vec4 hzD;',      // glow dir, strength
  ' uniform vec3 hzE;',      // glow colour
  ' uniform vec4 hzP[3];',   // lamp position, strength
  ' uniform vec4 hzQ[3];',   // lamp colour, soft radius
  ' vec3 hzMix(vec3 col){',
  '  vec3 rd=vHzW-cameraPosition;float d=length(rd);rd/=max(d,1e-3);',
  '  float e=min(d,hzB.x),s=max(e-hzB.w,0.0),ky=hzA.y*rd.y*s;',
  '  float od=hzA.x*exp(-hzA.y*(cameraPosition.y+rd.y*hzB.w-hzA.z))*s*(abs(ky)>1e-3?(1.0-exp(-ky))/ky:1.0-0.5*ky);',
  '  vec3 hc=hzC+hzE*(hzD.w*pow(max(dot(rd,hzD.xyz),0.0),hzB.y));',
  '  col=mix(col,hc,min(1.0-exp(-od),hzA.w));',
  '  for(int i=0;i<3;i++){',
  '   if(hzP[i].w<=0.0)break;',
  '   vec3 q=hzP[i].xyz-cameraPosition;float tc=dot(q,rd),r=hzQ[i].w,h=sqrt(max(dot(q,q)-tc*tc,0.0)+r*r);',
  '   col+=hzQ[i].rgb*(hzP[i].w*r*0.3183*(atan((e-tc)/h)+atan(tc/h))/h);',
  '  }',
  '  return col;',
  ' }',
  '#endif',''].join('\n');
 C.fog_fragment=[
  '#ifdef USE_FOG',
  ' #ifdef FOG_EXP2',
  '  float fogFactor=1.0-exp(-fogDensity*fogDensity*fogDepth*fogDepth);',
  ' #else',
  '  float fogFactor=smoothstep(fogNear,fogFar,fogDepth);',
  ' #endif',
  ' gl_FragColor.rgb=mix(hzMix(gl_FragColor.rgb),fogColor,fogFactor);',
  '#endif',''].join('\n');
})();

// --- level and room ---
function hazeLevel(){const a=cfg.atmos;return a==='off'||a==='low'?a:'high';}
function hazeRoomId(){
 const rm=typeof activeRoom!=='undefined'&&activeRoom;
 if(rm)for(const k in CONFIG.rooms)if(CONFIG.rooms[k]===rm)return k;
 return CONFIG.rooms[cfg.room]?cfg.room:'open';
}
// writes this room's air into the shared uniforms, the shafts and the motes; called by applyFog (world.js) on a room or Options change
function hazeApply(){
 const A=CONFIG.atmos||{},lvl=hazeLevel(),id=hazeRoomId(),R=(A.rooms&&A.rooms[id])||{};
 const on=A.on!==false&&lvl!=='off',hi=on&&lvl==='high',c=new THREE.Color();
 HZ.A.set(on&&R.haze?R.haze:[0,0.02,0,0]);
 HZ.B[0]=R.range||1e5;HZ.B[3]=R.start||0;
 HZ.C.set(c.setHex(R.color||0).toArray());
 const g=R.glow||{},dv=new THREE.Vector3().fromArray(g.dir||[0,0,-1]).normalize();
 HZ.B[1]=g.pow||4;HZ.D.set([dv.x,dv.y,dv.z,on?g.str||0:0]);
 HZ.E.set(c.setHex(g.color||0).toArray());
 const lamps=(on&&(hi||A.lampsLow)&&R.lamps)||[];
 for(let i=0;i<3;i++){
  const l=lamps[i];
  HZ.P.set(l?[l[0],l[1],l[2],l[3]]:[0,0,0,0],i*4);
  HZ.Q.set(l?c.setHex(l[4]).toArray().concat([l[5]||40]):[0,0,0,1],i*4);
 }
 const sh=on&&R.shafts||[];
 HZ.id=id;hazeShafts(sh);
 HZ.S.fill(0);
 for(let i=0;i<Math.min(sh.length,HZ_SN);i++){
  const s=sh[i];   // the motes see a window whole: centre + str, u + spread, v + fade, travel + round
  HZ.S.set([s.c[0],s.c[1],s.c[2],s.str||0, s.u[0],s.u[1],s.u[2],s.spread||1, s.v[0],s.v[1],s.v[2],s.pow||1.5, s.d[0],s.d[1],s.d[2],s.round?1:0],i*16);
 }
 hazeMotes(hi?R.motes:null);
 if(typeof renderDirty==='function')renderDirty();
}

// --- light shafts: a card per beam, turned about the beam's axis to face the camera, as wide as the source seen from there; soft edges, drifting dust ---
const HZ_SH_VS=[
 'attribute vec4 aA;attribute vec4 aB;attribute vec3 aU;attribute vec3 aV;attribute vec4 aR;attribute vec3 aC;',
 'varying vec3 vC,vW;varying float vS,vT,vP,vK;',
 'void main(){',
 ' vec3 ax=normalize(aB.xyz),p0=aA.xyz+aB.xyz*aR.w,toC=normalize(cameraPosition-p0);',
 ' vec3 sd=cross(ax,toC);float sl=length(sd);sd=sl>1e-4?sd/sl:normalize(aU+vec3(1e-4));',
 ' float hu=dot(sd,aU),hv=dot(sd,aV),hw=(aR.y>0.5?sqrt(hu*hu+hv*hv):abs(hu)+abs(hv))*mix(1.0,aR.x,aR.w);',
 ' vec3 wp=p0+sd*hw*aR.z;',
 ' vW=wp;vS=aR.z;vT=aR.w;vC=aC*aA.w;vP=aB.w;vK=1.0-pow(abs(dot(ax,toC)),4.0);',
 ' gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);',
 '}'].join('\n');
const HZ_SH_FS=[
 'uniform float uT,uNear;varying vec3 vC,vW;varying float vS,vT,vP,vK;',
 'float hzN(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float n=dot(i,vec3(1.0,57.0,113.0));',
 ' vec4 a=fract(sin(vec4(n,n+1.0,n+57.0,n+58.0))*43758.5453),b=fract(sin(vec4(n+113.0,n+114.0,n+170.0,n+171.0))*43758.5453);',
 ' vec4 m=mix(a,b,f.z);vec2 m2=mix(m.xz,m.yw,f.x);return mix(m2.x,m2.y,f.y);}',
 'void main(){',
 ' float s=1.0-vS*vS,a=smoothstep(0.0,0.3,vT)*pow(max(1.0-vT,0.0),vP)*s*s;',
 ' float n=hzN(vW*0.04+vec3(0.0,-uT*0.05,uT*0.03))*0.6+hzN(vW*0.12+vec3(uT*0.06,0.0,0.0))*0.4;',
 ' a*=(0.4+0.9*n)*vK*smoothstep(uNear*0.4,uNear,distance(vW,cameraPosition));',
 ' gl_FragColor=vec4(vC,a);',
 '}'].join('\n');
function hazeShaftMat(){
 return new THREE.ShaderMaterial({vertexShader:HZ_SH_VS,fragmentShader:HZ_SH_FS,transparent:true,depthWrite:false,side:THREE.DoubleSide,
  blending:THREE.AdditiveBlending,uniforms:{uT:{value:0},uNear:{value:CONFIG.atmos.shaftNear||40}}});
}
// one quad per pane: a window's u is split into n panes, each fill of its slot wide
function hazeShafts(list){
 if(!HZ.sh)return;
 HZ.sh.visible=!!list.length;
 const q=[];
 for(const s of list){
  const n=s.n||1,f=s.fill||1,col=new THREE.Color(s.color||0xffffff);
  for(let k=0;k<n;k++){
   const o=(2*k+1)/n-1,cc=[0,1,2].map(j=>s.c[j]+s.u[j]*o),uu=s.u.map(x=>x*f/n);
   q.push({c:cc,u:uu,s:s,col:col});
  }
 }
 const N=q.length*4,at={aA:new Float32Array(N*4),aB:new Float32Array(N*4),aU:new Float32Array(N*3),aV:new Float32Array(N*3),aR:new Float32Array(N*4),aC:new Float32Array(N*3)},idx=[];
 q.forEach((p,i)=>{
  const s=p.s,corner=[[-1,0],[1,0],[1,1],[-1,1]];
  corner.forEach(([sg,t],j)=>{
   const v=i*4+j;
   at.aA.set([p.c[0],p.c[1],p.c[2],s.str||0],v*4);at.aB.set([s.d[0],s.d[1],s.d[2],s.pow||1.5],v*4);
   at.aU.set(p.u,v*3);at.aV.set(s.v,v*3);at.aR.set([s.spread||1,s.round?1:0,sg,t],v*4);at.aC.set([p.col.r,p.col.g,p.col.b],v*3);
  });
  idx.push(i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3);
 });
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(N*3),3));
 for(const k in at)g.setAttribute(k,new THREE.BufferAttribute(at[k],k==='aU'||k==='aV'||k==='aC'?3:4));
 g.setIndex(idx);
 const old=HZ.sh.geometry;HZ.sh.geometry=g;if(old)old.dispose();
}

// --- dust motes: drifting points lit by the shafts, the lamps and the table light, wrapped in the room's box (motion is all in the shader) ---
const HZ_VS=[
 'uniform float uT,uPx,uSize,uMin,uMax,uAmb,uTab,uShaft,uFar,uWob;uniform vec3 uLo,uHi,uCol,uTabC;uniform vec2 uTabS;',
 'uniform vec4 hzP[3];uniform vec4 hzQ[3];uniform vec4 hzS['+HZ_SN*4+'];',
 'attribute vec4 vel;varying vec3 vC;varying float vA;',
 'void main(){',
 ' vec3 span=uHi-uLo,ph=position*6.2832;',
 ' vec3 w=vec3(sin(uT*vel.w+ph.x),sin(uT*vel.w*0.8+ph.y),cos(uT*vel.w*0.9+ph.z))*uWob;',
 ' vec3 p=fract(position+(vel.xyz*uT+w)/span);',
 ' vec3 eg=smoothstep(0.0,0.04,p)*smoothstep(1.0,0.96,p);',
 ' vec3 wp=uLo+p*span,dt=wp-uTabC;',
 ' vec3 L=uCol*(uAmb+uTab*exp(-dt.x*dt.x/(uTabS.x*uTabS.x)-dt.z*dt.z/(uTabS.y*uTabS.y))*smoothstep(uTabC.y+30.0,uTabC.y-10.0,wp.y));',
 ' for(int i=0;i<3;i++){vec3 q=wp-hzP[i].xyz;float r=hzQ[i].w*1.6;L+=hzQ[i].rgb*(hzP[i].w*r*r/(dot(q,q)+r*r));}',
 ' for(int i=0;i<'+HZ_SN+';i++){',
 '  vec4 c=hzS[i*4],u=hzS[i*4+1],v=hzS[i*4+2],d=hzS[i*4+3];',
 '  vec3 o=wp-c.xyz;float t=dot(o,d.xyz)/max(dot(d.xyz,d.xyz),1e-3),sc=mix(1.0,u.w,clamp(t,0.0,1.0));',
 '  vec3 q=o-d.xyz*t;float x=dot(q,u.xyz)/(max(dot(u.xyz,u.xyz),1e-3)*sc),y=dot(q,v.xyz)/(max(dot(v.xyz,v.xyz),1e-3)*sc);',
 '  float r=d.w>0.5?sqrt(x*x+y*y):max(abs(x),abs(y));',
 '  L+=uCol*(uShaft*c.w*step(0.0,t)*pow(max(1.0-t,0.0),v.w)*(1.0-smoothstep(0.7,1.0,r)));',
 ' }',
 ' vec4 mv=modelViewMatrix*vec4(wp,1.0);float dist=-mv.z;',
 ' float px=uSize*uPx/max(dist,1.0),a=eg.x*eg.y*eg.z*(1.0-smoothstep(uFar*0.6,uFar,dist));',
 ' if(px<uMin){a*=px*px/(uMin*uMin);px=uMin;}',
 ' gl_PointSize=min(px,uMax);gl_Position=projectionMatrix*mv;',
 ' vC=L;vA=a;',
 '}'].join('\n');
const HZ_FS=[
 'varying vec3 vC;varying float vA;',
 'void main(){vec2 c=gl_PointCoord-0.5;float r=dot(c,c)*4.0;if(r>1.0)discard;r=1.0-r;gl_FragColor=vec4(vC,vA*r*r);}'].join('\n');
function hazeBuild(){
 if(HZ.pts||typeof scene==='undefined'||!scene||!CONFIG.atmos)return;
 const M=CONFIG.atmos.motes,n=M.n,g=new THREE.BufferGeometry(),p=new Float32Array(n*3),v=new Float32Array(n*4);
 for(let i=0;i<n;i++){
  p[i*3]=Math.random();p[i*3+1]=Math.random();p[i*3+2]=Math.random();
  const s=M.speed*(0.4+Math.random()*0.8),a=Math.random()*6.2832;
  v[i*4]=Math.cos(a)*s;v[i*4+1]=(Math.random()-0.35)*s*0.6;v[i*4+2]=Math.sin(a)*s;v[i*4+3]=0.15+Math.random()*0.35;
 }
 g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('vel',new THREE.BufferAttribute(v,4));
 const T=CONFIG.atmos.table;
 HZ.mat=new THREE.ShaderMaterial({vertexShader:HZ_VS,fragmentShader:HZ_FS,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{uT:{value:0},uPx:{value:500},uSize:{value:M.size},uMin:{value:M.minPx},uMax:{value:M.maxPx},uAmb:{value:M.amb},uTab:{value:M.table},
   uShaft:{value:M.shaft},uFar:{value:M.far},uWob:{value:M.wobble},uLo:{value:new THREE.Vector3()},uHi:{value:new THREE.Vector3(1,1,1)},uCol:{value:new THREE.Color()},
   uTabC:{value:new THREE.Vector3(T[0],T[1],T[2])},uTabS:{value:new THREE.Vector2(T[3],T[4])},hzP:{value:HZ.P},hzQ:{value:HZ.Q},hzS:{value:HZ.S}}});
 HZ.pts=new THREE.Points(g,HZ.mat);
 HZ.pts.frustumCulled=false;HZ.pts.visible=false;HZ.pts.renderOrder=4;
 HZ.sh=new THREE.Mesh(new THREE.BufferGeometry(),hazeShaftMat());
 HZ.sh.frustumCulled=false;HZ.sh.visible=false;HZ.sh.renderOrder=3;
 scene.add(HZ.pts);scene.add(HZ.sh);
 hazeApply();
}
function hazeMotes(m){
 if(!HZ.pts)return;
 HZ.pts.visible=!!m;if(!m)return;
 const u=HZ.mat.uniforms,b=m.box,N=CONFIG.atmos.motes.n;
 u.uLo.value.set(b[0],b[1],b[2]);u.uHi.value.set(b[3],b[4],b[5]);u.uCol.value.setHex(m.color||0xffffff);
 HZ.pts.geometry.setDrawRange(0,Math.round(N*clamp(m.n===undefined?1:m.n,0,1)));
}
function hazeUpdate(rdt){
 if(!HZ.sh)return;
 HZ.t+=rdt;
 if(HZ.sh.visible)HZ.sh.material.uniforms.uT.value=HZ.t;
 if(!HZ.pts.visible)return;
 const u=HZ.mat.uniforms;u.uT.value=HZ.t;
 u.uPx.value=renderer.getContext().drawingBufferHeight/(2*Math.tan(camera.fov*Math.PI/360));
}
