'use strict';
/* ================= blade grass (pitch dressing) =================
   A grass pitch is a flat textured box, so a normal map is all it has: fine from the default
   camera, flat as paper from a low one, because a normal map can't change a silhouette. So a grass
   pitch grows real blades: one instanced draw of a small strip (two rows of quads, narrowing to a
   slanted top so one corner stands higher = the point), scattered on a jittered grid over the
   pitch's up-facing faces. ~55k blades at the default density, 4 tris each.

   WHY NOT SHELLS (stacked alpha-cut copies of the pitch, the first version): a shell can't draw a
   vertical face, so a flat blade seen side-on came apart into its layer slices, and every layer
   was a pitch-sized alpha-tested draw. Blades are opaque geometry: early-z works, MSAA smooths them.

   REUSABLE BY CONFIG ONLY: a pitch opts in with `grass:true` (CONFIG.grass.blade) or
   `grass:{...}` (overrides) on its CONFIG.pitches entry. Each blade takes the pitch's own texture
   at its root, so stripes, lines and logos grow with it and a new grass pitch needs nothing else.

   VISUAL ONLY. Physics still rolls on the flat y=0 floor. The blade mesh is a child of the pitch
   group, so it rides, hides and disposes with it (disposeModelTemplate walks children). Blade
   positions are in the pitch group's space, which sits unscaled in the table like every pitch.
   Quality is cfg.grass ('off'|'low'|'high' -> CONFIG.grass.amount); grassApply() rebuilds live. */
const grassT={value:0},grassB={value:[0,1,2,3].map(()=>new THREE.Vector4())};  // shared by every blade mesh
let grassLast=0;
function grassAmount(){const G=CONFIG.grass;return G&&G.on?+((G.amount&&G.amount[cfg.grass])||0):0;}
function grassOpts(id){const P=CONFIG.pitches[id];if(!P||!P.grass||!CONFIG.grass)return null;
 return Object.assign({},CONFIG.grass.blade,P.grass===true?{}:P.grass);}
/* Blade roots over a mesh's up-facing triangles, in its parent's space: a jittered grid at
   o.density per unit, each with the pitch uv under it. Shuffled (seeded, so a pitch always grows
   the same lawn) so any prefix is an even spread and a lower quality just draws fewer. */
function grassRoots(mesh,o){
 const src=mesh.geometry,pos=src.attributes.position,nor=src.attributes.normal,uv=src.attributes.uv,ix=src.index;
 if(!pos||!nor||!uv)return [];
 mesh.updateMatrix();
 const M=mesh.matrix,at=i=>ix?ix.getX(i):i,cnt=ix?ix.count:pos.count,out=[],st=1/o.density;
 let sd=(o.seed|0)||7;const rnd=()=>((sd=(sd*1664525+1013904223)>>>0)/4294967296);
 const V=[0,1,2].map(()=>new THREE.Vector3());
 for(let i=0;i+2<cnt;i+=3){const t=[at(i),at(i+1),at(i+2)];
  if(!(nor.getY(t[0])>.5&&nor.getY(t[1])>.5&&nor.getY(t[2])>.5))continue;
  t.forEach((v,k)=>V[k].fromBufferAttribute(pos,v).applyMatrix4(M));
  const [A,B,C]=V,x0=Math.min(A.x,B.x,C.x),x1=Math.max(A.x,B.x,C.x),z0=Math.min(A.z,B.z,C.z),z1=Math.max(A.z,B.z,C.z);
  const d=(B.z-C.z)*(A.x-C.x)+(C.x-B.x)*(A.z-C.z);if(Math.abs(d)<1e-9)continue;
  for(let z=z0+st*.5;z<z1;z+=st)for(let x=x0+st*.5;x<x1;x+=st){
   const px=x+(rnd()-.5)*st,pz=z+(rnd()-.5)*st;
   const a=((B.z-C.z)*(px-C.x)+(C.x-B.x)*(pz-C.z))/d,b=((C.z-A.z)*(px-C.x)+(A.x-C.x)*(pz-C.z))/d,c=1-a-b;
   if(a<0||b<0||c<0){rnd();rnd();continue;}
   out.push([px,pz,rnd()*Math.PI*2,o.minH+(1-o.minH)*rnd(),
    a*uv.getX(t[0])+b*uv.getX(t[1])+c*uv.getX(t[2]),a*uv.getY(t[0])+b*uv.getY(t[1])+c*uv.getY(t[2]),a*A.y+b*B.y+c*C.y]);}
 }
 for(let i=out.length-1;i>0;i--){const j=(rnd()*(i+1))|0,s=out[i];out[i]=out[j];out[j]=s;}
 return out;
}
/* One blade, unit-sized: x across (-.5..5), y up (0..1). Two rows so it can bend; the top edge
   slopes by o.slant, so the +x corner is the tip. The shader scales, turns, bends and places it. */
function grassGeo(roots,o,n){
 if(!roots.length||n<1)return null;
 const g=new THREE.InstancedBufferGeometry(),s=o.slant;
 g.setIndex([0,1,3,0,3,2,2,3,5,2,5,4]);
 g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,-.5,.5,0,.5,.5,0,-.5,1-s,0,.5,1,0],3));
 g.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0],3));
 const I=new Float32Array(roots.length*4),R=new Float32Array(roots.length*3);
 roots.forEach((r,k)=>{I.set([r[0],r[1],r[2],r[3]],k*4);R.set([r[4],r[5],r[6]],k*3);});
 g.setAttribute('aI',new THREE.InstancedBufferAttribute(I,4));   // root x, root z, turn, height scale
 g.setAttribute('aR',new THREE.InstancedBufferAttribute(R,3));   // pitch uv at the root, root y
 g.instanceCount=Math.min(roots.length,n);
 return g;
}
/* The pitch's own material, taught to build blades. Colour, roughness and emissive are sampled
   at the root's uv (the whole blade is the pitch colour under it), darkened toward the root. The
   normal is mostly UP, tilted a little toward the blade's face, so a lawn lights like the pitch it
   grows from instead of like a field of tiny mirrors; both faces use it (no back-face flip). */
function grassMat(src,o){
 const m=src.clone();m.side=THREE.DoubleSide;m.normalMap=null;m.bumpMap=null;
 const u={uT:grassT,uB:grassB,uH:{value:o.height},uW:{value:o.width},uLean:{value:o.lean},uSway:{value:o.sway},
  uPress:{value:o.press},uBR:{value:o.pressR},uAo:{value:o.ao},uTip:{value:o.tip}};
 m.userData.gu=u;
 m.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,u);
  sh.vertexShader=sh.vertexShader
   .replace('#include <common>','#include <common>\nattribute vec4 aI;\nattribute vec3 aR;\nuniform float uT,uH,uW,uLean,uSway,uPress,uBR;\nuniform vec4 uB[4];\nvarying float vL;')
   .replace('#include <uv_vertex>','vUv=(uvTransform*vec3(aR.xy,1.)).xy;')
   .replace('#include <beginnormal_vertex>',
    'vec2 gd=vec2(cos(aI.z),sin(aI.z)),gn=vec2(-gd.y,gd.x);\n'+
    'float gh=aI.w*uH;vec3 gw=(modelMatrix*vec4(aI.x,aR.z,aI.y,1.)).xyz;\n'+
    'vec2 gb=gn*uLean*(fract(aI.z*7.31)-.5)*2.+vec2(sin(uT*1.3+gw.x*.21+gw.z*.13),cos(uT*1.1+gw.z*.19-gw.x*.07))*uSway;\n'+
    'float gk=0.;\n'+
    'for(int i=0;i<4;i++){vec2 d=gw.xz-uB[i].xy;float r=length(d),k=uB[i].z*(1.-smoothstep(uBR*.4,uBR,r));gb+=d/max(r,1e-3)*k*uPress;gk=max(gk,k);}\n'+
    'vec3 objectNormal=normalize(vec3(gn.x,2.,gn.y));')
   .replace('#include <begin_vertex>',
    'float gy=position.y,gx=position.x*uW*(1.-.35*gy);\n'+
    'vec3 transformed=vec3(aI.x+gd.x*gx,aR.z+gy*gh*(1.-gk*uPress*.7),aI.y+gd.y*gx);\n'+
    'transformed.xz+=gb*gh*gy*gy;vL=gy;');
  sh.fragmentShader=sh.fragmentShader
   .replace('#include <common>','#include <common>\nuniform float uAo,uTip;\nvarying float vL;')
   .replace('#include <normal_fragment_begin>','float faceDirection=gl_FrontFacing?1.:-1.;vec3 normal=normalize(vNormal);vec3 geometryNormal=normal;')
   .replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb*=mix(uAo,uTip,vL);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=mix(uAo,uTip,vL);');
 };
 m.customProgramCacheKey=()=>'grass3';
 return m;
}
/* Per render: the clock (advanced by at most 50 ms a frame, so the 4 Hz menu throttle slows the
   sway rather than stepping it) and the balls on the floor, which press the blades flat. */
function grassPre(){
 const now=performance.now()/1000;grassT.value+=Math.min(.05,Math.max(0,now-grassLast));grassLast=now;
 const B=grassB.value,bs=(typeof S!=='undefined'&&S.balls)||[];
 for(let i=0;i<4;i++){const b=bs[i],v=B[i];
  if(!b||!b.m){v.z=0;continue;}
  const p=b.m.position;v.set(p.x,p.z,1-clamp((p.y-BALL_R)/(BALL_R*1.5),0,1),0);}
}
function grassBlades(mesh,o,frac){
 if(!mesh.material||Array.isArray(mesh.material))return null;
 const roots=grassRoots(mesh,o),g=grassGeo(roots,o,Math.round(roots.length*frac));if(!g)return null;
 const s=new THREE.Mesh(g,grassMat(mesh.material,o));
 s.name='grass';s.userData.grass=true;s.castShadow=false;s.receiveShadow=true;s.frustumCulled=false;s.onBeforeRender=grassPre;
 return s;
}
function grassDrop(g){
 const d=[];g.traverse(c=>{if(c.userData.grass)d.push(c);});
 for(const s of d){s.parent.remove(s);s.geometry.dispose();s.material.dispose();}
}
/* (Re)dress one pitch group. Called by ensurePitch on load and by grassApply on a quality change. */
function grassAttach(id,g){
 if(!g)return;grassDrop(g);
 const o=grassOpts(id),f=grassAmount();if(!o||!(f>0))return;
 const ms=[];g.traverse(c=>{if(c.isMesh&&!c.userData.grass)ms.push(c);});
 for(const m of ms){const s=grassBlades(m,o,f);if(s)(m.parent||g).add(s);}
}
function grassApply(){for(const id in pitchGroups)grassAttach(id,pitchGroups[id]);renderDirty();}
