// rim harness. node tools/rim-harness.js
// slices the real wallLatch / rimSeg / rimLand / stepBall / staticClamp / goalFrameCollide (physics.js) and runs them on live CONFIG; reads the table GLBs for the drawn wall tops
// question: does the physical wall stand as tall as the drawn one, and does a ball that clears it come down on its top instead of sinking through; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const PH=rd('js/physics.js');
const parts={
 hit:slice(PH,'function hitFresh(b,k,imp,min){','// rollProbe is the state half'),
 latch:slice(PH,'function notMouth(p,gh){','function stepBall(b,h){'),
 step:slice(PH,'function stepBall(b,h){','// PER-CONTACT SPEED CEILING')
};
const stubs=[
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[]};",
"var ARENA_ON=false,ENDWALL_H=0,WALL_H=0;var rods=[];var SND={wall:0,floor:0};",
"var Au={wall:function(i,a,b,k){SND[k?'floor':'wall']++;},post:function(){}};function spawnMark(){} function momWood(){}",
"function syncBall(){} function pinRelease(){} function onGoal(){} function outOfBounds(b){b.gone=true;}",
"function collideRod(){} var RNG={nan:0};function rngR(){return 0;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.hit,g.latch,g.step,
  ';globalThis.X={CONFIG:CONFIG,F:F,BALL_R:BALL_R,PHY:PHY,BALL_TYPES:BALL_TYPES,stepBall:stepBall,SND:SND,S:S,'+
  'table:function(id){var t=CONFIG.tables[id];WALL_H=t.wallH||F.wallH;ENDWALL_H=t.endWall?t.endWall.h:0;}};'].join(NL),ctx);
 return ctx.X;
}

// ---- the drawn wall tops, from the GLBs ----
function glbJson(f){const b=fs.readFileSync(f);return JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString('utf8'));}
function mul(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function local(n){
 if(n.matrix)return n.matrix.slice();
 const t=n.translation||[0,0,0],q=n.rotation||[0,0,0,1],s=n.scale||[1,1,1],x=q[0],y=q[1],z=q[2],w=q[3];
 const m=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,0,0,0,1];
 for(let i=0;i<3;i++)m[i]*=s[0];for(let i=4;i<7;i++)m[i]*=s[1];for(let i=8;i<11;i++)m[i]*=s[2];
 m[12]=t[0];m[13]=t[1];m[14]=t[2];return m;
}
// the top of the long side wall slab (z 34..37, longer than the pitch): world max y over the primitives that are one
function sideWallTop(f){
 const j=glbJson(f);let top=null;
 const walk=(i,pm)=>{
  const n=j.nodes[i],m=mul(pm,local(n));
  if(n.mesh!==undefined)for(const p of j.meshes[n.mesh].primitives){
   const a=j.accessors[p.attributes.POSITION];if(!a.min)continue;
   let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
   for(let c=0;c<8;c++){const q=[c&1?a.max[0]:a.min[0],c&2?a.max[1]:a.min[1],c&4?a.max[2]:a.min[2]];
    for(let r=0;r<3;r++){const v=m[r]*q[0]+m[4+r]*q[1]+m[8+r]*q[2]+m[12+r];lo[r]=Math.min(lo[r],v);hi[r]=Math.max(hi[r],v);}}
   if(lo[2]>=33.9&&hi[2]<=37.1&&hi[0]-lo[0]>100&&hi[1]-lo[1]>8)top=Math.max(top===null?-1e9:top,hi[1]);
  }
  for(const c of n.children||[])walk(c,m);
 };
 for(const r of j.scenes[j.scene||0].nodes)walk(r,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 return top;
}

// ---- flights: a ball let go, the deepest it sinks into the DRAWN walls (sharp boxes: z 34..37 along the sides, x 60..63 either side of the mouth) ----
function sinks(X,p,top){
 const R=X.BALL_R,F=X.F,gh=F.goalHalf;let worst=0;
 const boxes=[[-63,63,34,37],[-63,63,-37,-34],[60,63,gh,37],[60,63,-37,-gh],[-63,-60,gh,37],[-63,-60,-37,-gh]];   // x0 x1 z0 z1
 for(const b of boxes){
  if(b[0]*b[1]>0&&Math.abs(p.z)<gh)continue;   // a ball in the mouth is in the net, not in the flank: the goal frame owns that
  const dx=Math.max(b[0]-p.x,0,p.x-b[1]),dz=Math.max(b[2]-p.z,0,p.z-b[3]),dy=Math.max(-1-p.y,0,p.y-top);
  worst=Math.max(worst,R-Math.hypot(dx,dy,dz));
 }
 return Math.max(0,worst);
}
function fly(X,o){
 const top=X.F.wallH===undefined?0:(o.top!==undefined?o.top:11);
 const b={m:{position:{x:o.x,y:o.y,z:o.z}},v:{x:o.vx||0,y:o.vy||0,z:o.vz||0},t:X.BALL_TYPES.classic,spin:0,scored:false,outWall:o.latched?1:0,cT:[-1e9,-1e9,-1e9],overBar:0,noGoal:0,over:0};
 const sub=8,h=1/120/sub,n=o.steps||Math.round((o.secs||1.2)*120*sub);let pen=0,vx1=null;
 for(let i=0;i<n;i++){
  X.stepBall(b,h);
  if(b.gone)break;
  const p=b.m.position;
  if(!isFinite(p.x+p.y+p.z))return {nan:true};
  pen=Math.max(pen,sinks(X,p,top));
  if(o.vxAt&&vx1===null&&i>=o.vxAt*120*sub)vx1=b.v.x;
 }
 return {pen,out:!!b.outWall,gone:!!b.gone,p:b.m.position,v:b.v,vx1};
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const F=X.F,BR=X.BALL_R,P=X.PHY,CORNER=P.rimW/2*(Math.SQRT2-1)+0.05;   // a round cap leaves the sharp drawn corner this far into the ball
 const WZ=F.W/2-BR,WX=F.L/2-BR,wallOf=id=>X.CONFIG.tables[id].wallH||F.wallH;

 // ---- the data: physics wall height = drawn ----
 let met=0,seen=0;
 for(const id of Object.keys(X.CONFIG.tables)){
  const t=X.CONFIG.tables[id];if(t.collision!=='flat')continue;
  for(const k of Object.keys(t.skins)){
   const f=t.folder+t.skins[k].glb;
   if(!fs.existsSync(f))continue;
   seen++;const d=sideWallTop(f),h=t.wallH||F.wallH;
   ok(id+'/'+k+': the wall stands as tall as the drawn one ('+(d===null?'no wall found':d.toFixed(2))+' drawn, '+h+' physical)',d!==null&&Math.abs(d-h)<=0.1);
   if(d!==null&&Math.abs(d-h)<=0.1)met++;
  }
 }
 ok('at least one table GLB was read',seen>0,seen+' read');

 // ---- the cutoff: a ball clears the wall above wallH + ball radius, not under it ----
 for(const id of ['classic','circuit']){
  X.table(id);
  const T=wallOf(id);
  const cross=y=>fly(X,{x:0,y:y,z:WZ-0.3,vz:30,secs:0.05,top:T});
  const lo=cross(T+BR-0.3),hi=cross(T+BR+0.3);
  ok(id+': a ball crossing 0.3 under the drawn top + radius meets the wall',!lo.out&&lo.v.z<0,'vz '+lo.v.z.toFixed(1)+' out '+lo.out);
  ok(id+': ...and 0.3 over it clears it',hi.out&&hi.v.z>0,'vz '+hi.v.z.toFixed(1)+' out '+hi.out);
 }

 // ---- over the side wall: never sunk into the drawn slab (the old behaviour sank every ball that cleared it) ----
 for(const id of ['classic','circuit']){
  X.table(id);
  const T=wallOf(id);let worst=0,n=0,where='';
  for(const dy of [0.1,0.6,1.5,3])for(const vz of [4,12,30,80,160])for(const vy of [-40,0,40])for(const s of [1,-1]){
   const o=fly(X,{x:10,y:T+BR+dy,z:s*(WZ-0.3),vz:s*vz,vy:vy,secs:1.5,top:T});n++;
   if(o.nan){ok(id+': no NaN',false);continue;}
   if(o.pen>worst){worst=o.pen;where='dy '+dy+' vz '+vz+' vy '+vy;}
  }
  ok(id+': '+n+' lobs over a side wall never sink past the rounded corner ('+CORNER.toFixed(2)+')',worst<=CORNER,'worst '+worst.toFixed(2)+' at '+where);
 }

 // ---- over an end wall, beside the mouth ----
 {X.table('classic');const T=wallOf('classic');let worst=0,n=0,where='';
  for(const z of [-30,-20,16,28])for(const dy of [0.1,1,3])for(const vx of [4,12,30,80])for(const s of [1,-1]){
   const o=fly(X,{x:s*(WX-0.3),y:T+BR+dy,z:z,vx:s*vx,secs:1.5,top:T});n++;
   if(o.pen>worst){worst=o.pen;where='z '+z+' dy '+dy+' vx '+vx;}
  }
  ok('classic: '+n+' lobs over an end wall never sink past the rounded corner',worst<=CORNER,'worst '+worst.toFixed(2)+' at '+where);}
 // ---- the mouth is not a wall ----
 {X.table('classic');const o=fly(X,{x:WX-6,y:18,z:0,vx:30,secs:0.2,vxAt:0.15});
  ok('over the goal mouth the rim is not in the way (the lob keeps its speed)',o.vx1!==null&&o.vx1>26,'vx '+(o.vx1===null?'-':o.vx1.toFixed(1)));}
 // ---- one step on a ball already cleared (latched): held off the face below the top, and the mouth is left alone ----
 {X.table('classic');
  const a=fly(X,{x:10,y:5,z:33.5,latched:true,steps:1}),m=fly(X,{x:61.5,y:12.5,z:0,latched:true,steps:1});
  ok('a cleared ball found below the top against the wall\'s face is pushed back out of it',a.p.z<=WZ+0.05,'z '+a.p.z.toFixed(2)+' (the face is at '+WZ.toFixed(2)+')');
  ok('...and one over the goal mouth is not touched by any rim',Math.abs(m.p.y-12.5)<0.05,'y '+m.p.y.toFixed(3));}

 // ---- it comes down on the top and rolls off a side ----
 {X.table('classic');const T=wallOf('classic'),zm=F.W/2+P.rimW/2;
  const inw=fly(X,{x:0,y:T+BR+14,z:zm-0.3,secs:3,top:T}),outw=fly(X,{x:0,y:T+BR+14,z:zm+0.3,secs:3,top:T});
  ok('dropped just inside the rim\'s line it rolls off into the table and is live again',!inw.out&&!inw.gone&&inw.p.y<4&&Math.abs(inw.p.z)<F.W/2-1,'z '+inw.p.z.toFixed(1)+' y '+inw.p.y.toFixed(1)+' out '+inw.out);
  ok('dropped just outside it rolls off the other way and is out of play',inw!==outw&&(outw.gone||Math.abs(outw.p.z)>F.W/2+P.rimW),'z '+outw.p.z.toFixed(1)+' y '+outw.p.y.toFixed(1)+' gone '+outw.gone);
  // landed: leaves with a small part of its speed (the floor's restitution on the top, not the wall's)
  const land=fly(X,{x:0,y:T+BR+0.2,z:zm-0.4,vy:-90,secs:0.03,top:T});
  ok('a ball dropped onto the rim keeps under a third of its speed',Math.hypot(land.v.x,land.v.y,land.v.z)<30,'left at '+Math.hypot(land.v.x,land.v.y,land.v.z).toFixed(1)+' from 90');}

 // ---- play below the cutoff is as it was ----
 {X.table('classic');const o=fly(X,{x:0,y:11.2,z:WZ-0.6,vz:40,vy:5,secs:0.1});
  ok('a ball clipping the wall under its top bounces at the wall restitution, unlatched',!o.out&&o.v.z<0&&Math.abs(o.v.z)<40*P.wallRest*1.02&&Math.abs(o.v.z)>40*P.wallRest*0.9,'vz '+o.v.z.toFixed(1));
  ok('...and the wall gives it no lift',o.v.y<5,'vy '+o.v.y.toFixed(1));}

 // ---- a fixed fuzz over the whole box: finite, and never sunk ----
 {X.table('classic');const T=wallOf('classic');let s=12345;const r=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  let worst=0,bad=0,N=240,at='';
  for(let i=0;i<N;i++){
   const q={x:(r()-0.5)*100,y:BR+r()*18,z:(r()-0.5)*60,vx:(r()-0.5)*160,vy:(r()-0.3)*120,vz:(r()-0.5)*160,secs:1.2,top:T},o=fly(X,q);
   if(o.nan||!isFinite(o.pen)){bad++;continue;}
   if(o.pen>worst){worst=o.pen;at=JSON.stringify(q,(k,v)=>typeof v==='number'?+v.toFixed(1):v);}
  }
  ok(N+' random flights: all finite and none sunk into a wall',bad===0&&worst<=CORNER,'worst '+worst.toFixed(2)+', non-finite '+bad+' '+at);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}else console.log('  ok    '+t.name+(t.info?'   ['+t.info+']':''));}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUTS=[
 {n:'a cleared ball is never landed on the rim',part:'step',from:'if(b.outWall)rimLand(b);',to:''},
 {n:'the latch reads the table-wide wall height, not the active table\'s',part:'latch',from:'if(Math.abs(p.z)>zl){if(p.y>=WALL_H+BALL_R)b.outWall=1;return;}',to:'if(Math.abs(p.z)>zl){if(p.y>=F.wallH+BALL_R)b.outWall=1;return;}'},
 {n:'the side wall plane stops at the table-wide height',part:'step',from:'if(Math.abs(p.z)>zl&&p.y<WALL_H+BALL_R&&!b.outWall){',to:'if(Math.abs(p.z)>zl&&p.y<F.wallH+BALL_R&&!b.outWall){'},
 {n:'the rim has no thickness',part:'latch',from:'const r=PHY.rimW/2,yc=WALL_H-r;',to:'const r=0,yc=WALL_H-r;'},
 {n:'the rim sits a unit low',part:'latch',from:'const r=PHY.rimW/2,yc=WALL_H-r;',to:'const r=PHY.rimW/2,yc=WALL_H-r-1;'},
 {n:'the end walls have no rim',part:'latch',from:'rimSeg(b,s*xm,gh+r,s*xm,zm,r,yc);rimSeg(b,s*xm,-zm,s*xm,-gh-r,r,yc);',to:''},
 {n:'the side walls have no rim',part:'latch',from:'rimSeg(b,-xm,s*zm,xm,s*zm,r,yc);',to:''},
 {n:'the rim runs across the goal mouth',part:'latch',from:'rimSeg(b,s*xm,gh+r,s*xm,zm,r,yc);rimSeg(b,s*xm,-zm,s*xm,-gh-r,r,yc);',to:'rimSeg(b,s*xm,0,s*xm,zm,r,yc);rimSeg(b,s*xm,-zm,s*xm,0,r,yc);'},
 {n:'the rim bounces like an elastic wall',part:'latch',from:'const e=1+PHY.wallRest+(PHY.floorRest-PHY.wallRest)*ny,',to:'const e=2,'},
 {n:'the rim pushes the ball out but leaves its velocity alone',part:'latch',from:'v.x-=e*vn*nx;v.y-=e*vn*ny;v.z-=e*vn*nz;',to:''},
 {n:'the rim only reaches balls above its shoulder',part:'latch',from:'if(b.m.position.y>=yc+BALL_R+r)return;',to:'if(b.m.position.y>=yc+BALL_R+r||b.m.position.y<yc)return;'}
];
let missed=0;
for(const m of MUTS){
 let broke;
 try{broke=suite(boot(m)).filter(t=>!t.ok).map(t=>t.name);}catch(e){console.log('  MUTATION ERROR '+m.n+': '+e.message);missed++;continue;}
 if(broke.length)console.log('  caught  '+m.n+'   ['+broke.length+' fail]');
 else{missed++;console.log('  MISSED  '+m.n);}
}
console.log('  '+(MUTS.length-missed)+' of '+MUTS.length+' mutations caught');
process.exit(bad||missed?1:0);
