'use strict';
const {ShapeUtils,Vector2,Vector3} = require('three');

const corner = 1.75, halfWidth = 11, top = 10.04, floor = -.29;
const straight = top - floor - corner;
const bend = corner * Math.PI / 2;
const crossbar = 2 * (halfWidth - corner);
const length = 2 * (straight + bend) + crossbar;
const rings = 216;

function smooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
function band(x,a,b,edge){return smooth(a,a+edge,x)*(1-smooth(b-edge,b,x));}

function arch(distance){
 const mirror = distance > length / 2;
 let d = mirror ? length - distance : distance;
 let y, z, ny, nz;
 if(d <= straight){y=floor+d;z=-halfWidth;ny=0;nz=-1;}
 else if((d-=straight) <= bend){
  const a=d/corner;
  ny=Math.sin(a);nz=-Math.cos(a);
  y=top-corner+corner*ny;z=-halfWidth+corner+corner*nz;
 }else{y=top;z=-halfWidth+corner+d-bend;ny=1;nz=0;}
 return [y,mirror?-z:z,ny,mirror?-nz:nz];
}

function sweepGoal(side,section,deform){
 const points=[], uv=[], indices=[], normals=[];
 const stride=section.length+1;
 for(let i=0;i<=rings;i++){
  const u=i/rings, end=Math.min(u,1-u);
  const [y,z,ny,nz]=arch(length*u);
  for(let j=0;j<stride;j++){
   const [v,depth,radius]=section[j%section.length];
   const [d,r]=deform(end,v,depth,radius);
   points.push(new Vector3(side*(60-d),y+ny*r,z+nz*r));
   uv.push(u,j===stride-1?1:v);
  }
 }
 for(let i=0;i<=rings;i++)for(let j=0;j<stride;j++){
  const col=j%section.length;
  const prev=(col+section.length-1)%section.length, next=(col+1)%section.length;
  const along=points[Math.min(i+1,rings)*stride+col].clone().sub(points[Math.max(i-1,0)*stride+col]);
  const across=points[i*stride+next].clone().sub(points[i*stride+prev]);
  normals.push(...along.cross(across).normalize().multiplyScalar(side).toArray());
  if(i===rings||j===stride-1)continue;
  const a=i*stride+j,b=a+stride;
  if(side>0)indices.push(a,b,b+1,a,b+1,a+1);
  else indices.push(a,b+1,b,a,a+1,b+1);
 }
 for(const row of [0,rings]){
  const base=points.length, offset=row*stride;
  const z=arch(length*row/rings)[1], contour=[];
  for(let j=0;j<section.length;j++){
   const p=points[offset+j];
   contour.push(new Vector2(p.x-side*60,p.z-z));
   points.push(p);normals.push(0,-1,0);uv.push((row===0?.018:.982)+(p.x-side*60)*.02,.5+(p.z-z)*.32);
  }
  for(const [a,b,c] of ShapeUtils.triangulateShape(contour,[])){
   const ab=contour[b].clone().sub(contour[a]), ac=contour[c].clone().sub(contour[a]);
   if(ab.cross(ac)>0)indices.push(base+a,base+b,base+c);
   else indices.push(base+a,base+c,base+b);
  }
 }
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const positions=Float32Array.from(points.flatMap(p=>p.toArray()));
 positions.forEach((value,i)=>{const k=i%3;min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);});
 return {positions,normals:Float32Array.from(normals),uv:Float32Array.from(uv),indices:Uint16Array.from(indices),min,max};
}

module.exports={sweepGoal,band,smooth,length};
