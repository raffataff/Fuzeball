'use strict';
// Real geometry, deformation, the scored ball in the net and table switching.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
global.self=global.window=global;require('../vendor/three.bundle.js');
const cfgSrc=fs.readFileSync('js/config.js','utf8');
function block(key){const start=cfgSrc.indexOf(key)+key.length-1;let end=start,depth=0;
 for(;end<cfgSrc.length;end++){if(cfgSrc[end]==='{')depth++;if(cfgSrc[end]==='}'&&--depth===0){end++;break;}}
 return vm.runInNewContext('('+cfgSrc.slice(start,end)+')');}
const goalNet=block('goalNet:{'),goalFx=block('goalFx:{');
const SRC=fs.readFileSync('js/goalnet.js','utf8');

function run(src){
 const c={THREE,CONFIG:{goalNet,fx:{goalFx}},F:{goalH:10.2,goalHalf:11,goalDepth:9,L:120},BALL_R:1.35,
  PHY:{bigGoalBack:.5},clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),lerp:(a,b,t)=>a+(b-a)*t,
  scene:new THREE.Scene(),goalFrames:[new THREE.Group(),new THREE.Group()],
  S:{balls:[],phase:'goal',timeScale:1},removed:[],heatFeed(){},
  removeBall(b){b.m.removeFromParent();c.removed.push(b);const i=c.S.balls.indexOf(b);if(i>=0)c.S.balls.splice(i,1);}};
 vm.createContext(c);vm.runInContext(src+'\n;globalThis.__nb=NB;',c);
 for(let i=0;i<2;i++){const g=c.goalFrames[i];g.position.x=(i?1:-1)*60;g.userData.legacyNet=[new THREE.Mesh()];c.buildWedgeNet(g,i?1:-1,11,10.2,9);c.selectGoalNet(g,true);}
 const right=c.goalFrames[1],w=right.userData.wedge,cord=w.parts[0],base=cord.userData.base,ar=cord.geometry.attributes.position.array;
 assert(w.parts.every(p=>p.visible));assert(!right.userData.legacyNet[0].visible);
 const left=c.goalFrames[0].userData.wedge.parts[0];
 cord.geometry.computeBoundingBox();left.geometry.computeBoundingBox();
 const rb=cord.geometry.boundingBox,lb=left.geometry.boundingBox;
 assert(Math.abs(rb.max.x+lb.min.x)<1e-5);assert(Math.abs(rb.min.x+lb.max.x)<1e-5);
 assert(Math.abs(rb.max.y-lb.max.y)<1e-5&&Math.abs(rb.min.z-lb.min.z)<1e-5,'mirrored envelope');
 c.wedgeNetHit(1,new THREE.Vector3(65,4,3),90);c.wedgeNetUpdate(.12);
 let peak=0,near=0,far=0;
 for(let j=0;j<base.length;j+=3){const d=ar[j]-base[j];peak=Math.max(peak,d);assert(Number.isFinite(d));if(cord.userData.pin[j/3]===0)assert.equal(d,0,'anchored edge');if(Math.abs(base[j+2]-3)<2)near=Math.max(near,d);if(base[j+2]<-7)far=Math.max(far,d);}
 assert(peak>.8&&peak<3.3,'visible bounded bulge');assert(near>far*3,'impact stays local');
 assert(w.parts[1].geometry.attributes.position.array.every((x,i)=>x===w.parts[1].userData.base[i]),'hem fixed');
 c.wedgeNetUpdate(3);assert(ar.every((x,i)=>x===base[i]),'exact return to rest');
 right.scale.z=1.5;c.wedgeNetUpdate(0);
 for(const part of w.parts){const p=part.geometry.attributes.position.array,b=part.userData.base;
  for(let j=0;j<b.length;j+=3){const expected=b[j+2]*(1.5-.25*Math.min(1,Math.abs(b[j])/9));assert(Math.abs(p[j+2]*1.5-expected)<2e-6,'cord, hem, hardware and tray widen together');}}
 right.scale.z=1;c.wedgeNetUpdate(0);assert(ar.every((x,i)=>x===base[i]));
 // --- the scored ball itself goes into the net ---
 const mat=new THREE.MeshStandardMaterial(),ball={m:new THREE.Mesh(new THREE.SphereGeometry(1.35),mat),v:new THREE.Vector3(80,0,0),key:'classic'};
 c.scene.add(ball.m);c.S.balls.push(ball);ball.m.position.set(61.5,2,0);
 assert(c.netBallStart(1,ball),'taken');assert.equal(c.S.balls.length,0,'out of play');
 assert(ball.m.parent===c.scene&&ball.m.material===mat,'the same mesh and material, no copy');
 const N=goalFx.net;let deep=0,pressed=0,dent=0,t=0;
 for(;t<1.2;t+=1/60){c.netBallUpdate(1/60);c.wedgeNetUpdate(1/60);
  const lv=w.hits.find(h=>h.live&&h.a>0);if(lv){pressed++;deep=Math.max(deep,lv.a);let pk=0;for(let j=0;j<base.length;j+=3)pk=Math.max(pk,ar[j]-base[j]);dent=Math.max(dent,pk);}}
 const nb=c.__nb[1];
 assert(nb&&nb.b===ball,'still in the net');
 assert(pressed>=2,'the ball presses the cloth over several frames ('+pressed+')');
 assert(deep>.3,'the ball sinks into the back of the net ('+deep.toFixed(2)+')');
 assert(dent>.8,'the cloth dents with it ('+dent.toFixed(2)+')');
 assert(!w.hits.some(h=>h.live),'it lets go of the cloth');
 assert(Math.abs(nb.v.x)<30,'the net soaks up the shot ('+nb.v.x.toFixed(1)+')');
 for(;t<N.life+1;t+=1/60)c.netBallUpdate(1/60);
 assert(c.removed.includes(ball)&&!ball.m.parent&&!c.__nb[1],'drops out and is released');
 // a cut (kickoff, replay) takes it at once
 const b2={m:new THREE.Mesh(),v:new THREE.Vector3(40,0,0),key:'classic'};c.scene.add(b2.m);b2.m.position.set(61.5,2,0);
 c.netBallStart(1,b2);c.netBallUpdate(1/60);c.S.phase='count';c.netBallUpdate(1/60);
 assert(c.removed.includes(b2)&&!c.__nb[1],'a cut clears it');c.S.phase='goal';
 // wide goal: a corner shot stays inside the tapered pocket
 right.scale.z=1.5;const b3={m:new THREE.Mesh(),v:new THREE.Vector3(80,0,20),key:'classic'};c.scene.add(b3.m);b3.m.position.set(61.5,2,16);
 c.netBallStart(1,b3);let zmax=0;for(let i=0;i<60;i++){c.netBallUpdate(1/60);zmax=Math.max(zmax,b3.m.position.z);}
 assert(zmax<w.hw*1.5,'wide corner shot stays inside the pocket');
 c.wedgeNetReset();right.scale.z=1;c.wedgeNetUpdate(0);assert(!c.__nb[1]&&ar.every((x,i)=>x===base[i]),'reset clears ball and cloth');
 for(let i=0;i<5;i++)c.wedgeNetHit(1,new THREE.Vector3(66,4,i-2),80);
 assert.equal(w.hits.length,3,'overlapping impacts have a bounded budget');c.wedgeNetReset();
 assert(c.wedgeRoofHeight(1,68)<3,'lob roof follows the slope');
 c.selectGoalNet(right,false);assert(w.parts.every(p=>!p.visible));assert(right.userData.legacyNet[0].visible);
 return peak;
}
const peak=run(SRC);
const MUT=[
 ['const a=Math.max(0,Q.k*pen-Q.c*vn)*h;','const a=0;','the cloth has no spring'],
 ['const i=S.balls.indexOf(b);if(i>=0)S.balls.splice(i,1);\n if(b.warnShell)','if(b.warnShell)','the ball stays in play'],
 ['if(n.hit)n.hit.a=pen;','','the dent ignores the ball'],
 ["if(S.phase!=='play'&&S.phase!=='goal'&&S.phase!=='win'){netBallClear(gi);continue;}",'','a cut leaves it in the net'],
 ['n.mesh.position.y-=N.sink*rdt;','','it never drops out'],
];
let caught=0;
for(const [a,b,name] of MUT){
 if(!SRC.includes(a)){console.log('  DRIFTED: '+name);continue;}
 let broke=false;try{run(SRC.replace(a,b));}catch(e){broke=true;}
 if(broke)caught++;else console.log('  SURVIVED: '+name);
}
console.log('Wedge net: geometry, bulge, settling, widening, the ball in the net and skin switching passed. Peak displacement '+peak.toFixed(2));
console.log('mutations: '+caught+'/'+MUT.length+' caught');
if(caught<MUT.length)process.exitCode=1;
