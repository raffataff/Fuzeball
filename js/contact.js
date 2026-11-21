'use strict';
// --- contact shadows ---
// a soft dark blob on the pitch under every boot and ball (CONFIG.fx.contact): the ambient fill that shadow maps never darken; one instanced draw, posed from the displayed rods and balls in scene.onBeforeRender
let ctMesh=null,ctS=null;
const CT_MAX=96;
function contactBuild(){
 if(ctMesh||!scene)return;
 const g=new THREE.PlaneGeometry(2,2);g.rotateX(-Math.PI/2);
 ctS=new THREE.InstancedBufferAttribute(new Float32Array(CT_MAX),1).setUsage(THREE.DynamicDrawUsage);
 g.setAttribute('aS',ctS);
 const m=new THREE.ShaderMaterial({
  vertexShader:'attribute float aS;varying float vS;varying vec2 vUv;\n'+
   'void main(){vUv=uv*2.-1.;vS=aS;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
  fragmentShader:'varying float vS;varying vec2 vUv;\n'+
   'void main(){float k=clamp(1.-dot(vUv,vUv),0.,1.);float a=vS*smoothstep(0.,1.,k);if(a<.002)discard;gl_FragColor=vec4(0.,0.,0.,a);}',
  transparent:true,depthWrite:false,   // black under normal blending = dst x (1 - a), darken only
  polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 ctMesh=new THREE.InstancedMesh(g,m,CT_MAX);
 ctMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 ctMesh.frustumCulled=false;ctMesh.castShadow=ctMesh.receiveShadow=false;ctMesh.count=0;ctMesh.name='contactShadows';
 scene.add(ctMesh);
 const prev=scene.onBeforeRender;
 scene.onBeforeRender=function(){contactUpdate();if(prev)prev.apply(this,arguments);};
}
function ctPut(n,x,y,z,sx,sz,s){
 const e=ctMesh.instanceMatrix.array,o=n*16;
 e[o]=sx;e[o+1]=0;e[o+2]=0;e[o+3]=0;e[o+4]=0;e[o+5]=1;e[o+6]=0;e[o+7]=0;
 e[o+8]=0;e[o+9]=0;e[o+10]=sz;e[o+11]=0;e[o+12]=x;e[o+13]=y;e[o+14]=z;e[o+15]=1;
 ctS.array[n]=s;
}
// 1 at the pitch, 0 at `fade` up, eased
function ctFade(h,fade){const k=clamp(1-h/fade,0,1);return k*k;}
function contactUpdate(){
 if(!ctMesh)return;
 const C=CONFIG.fx.contact;
 if(!C||!C.on){ctMesh.visible=false;return;}
 const Fo=C.foot,Bo=C.ball,y=C.y||0.03;
 let n=0;
 for(const r of rods){
  if(!r.pivot||!r.pivot.visible||!r.men)continue;
  const a=r.pivot.rotation.z,sa=Math.sin(a),ca=Math.cos(a),offy=FOOT_BOX_OFF.y*(r.kickDir||1);
  const fx=r.pivot.position.x+sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T;
  const bcx=fx+FOOT_BOX_OFF.x*sa+offy*ca,bcy=fy-FOOT_BOX_OFF.x*ca+offy*sa;
  const h=Math.max(0,bcy-FOOT_BOX.x*Math.abs(ca)-FOOT_BOX.y*Math.abs(sa)),k=ctFade(h,Fo.fade);
  if(k<=0)continue;
  const gr=1+h*Fo.grow;
  for(const m of r.men){
   if(!m.visible||n>=CT_MAX)continue;
   ctPut(n++,bcx,y,m.position.z+r.pivot.position.z,Fo.x*gr,Fo.z*gr,Fo.str*k);
  }
 }
 const nb=typeof NB!=='undefined'?NB:null;   // a scored ball in the net keeps its shadow until it drops out (js/goalnet.js)
 for(let i=0,nb0=S.balls.length;i<nb0+2;i++){
  const b=i<nb0?S.balls[i]:nb&&nb[i-nb0]&&!nb[i-nb0].sink?nb[i-nb0].b:null;
  if(!b||!b.m||!b.m.visible||n>=CT_MAX)continue;
  const p=b.m.position,h=Math.max(0,p.y-BALL_R),k=ctFade(h,Bo.fade);
  if(k<=0)continue;
  const gr=Bo.r*(1+h*Bo.grow);
  ctPut(n++,p.x,y,p.z,gr,gr,Bo.str*k);
 }
 ctMesh.count=n;ctMesh.visible=n>0;
 ctMesh.instanceMatrix.needsUpdate=true;ctS.needsUpdate=true;
}
