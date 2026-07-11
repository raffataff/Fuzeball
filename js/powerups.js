'use strict';
/* ================= power-ups ================= */
function clearPU(){if(S.pu.obj){scene.remove(S.pu.obj);S.pu.obj=null;}S.pu.timer=rand(PWR.firstDelay[0],PWR.firstDelay[1]);}
function spawnPU(){
 const t=PU_TYPES[Math.floor(Math.random()*PU_TYPES.length)];
 const g=new THREE.Group();
 g.add(new THREE.Mesh(new THREE.OctahedronGeometry(2.1),
  new THREE.MeshStandardMaterial({color:t.col,emissive:t.col,emissiveIntensity:.9,roughness:.3})));
 const ring=new THREE.Mesh(new THREE.RingGeometry(2.6,3.4,24),
  new THREE.MeshBasicMaterial({color:t.col,transparent:true,opacity:.55,side:THREE.DoubleSide}));
 ring.rotation.x=-Math.PI/2;ring.position.y=-2.8;g.add(ring);
 g.position.set(rand(-PWR.area.x,PWR.area.x),PWR.floatY,rand(-PWR.area.z,PWR.area.z));
 if(ARENA_ON)arenaClampSpawn(g.position);
 S.pu.type=t;S.pu.obj=g;scene.add(g);
}
function collectPU(){
 const t=S.pu.type;
 const team=S.lastTouch>=0?S.lastTouch:(Math.random()<.5?0:1);
 const nm=team===0?cfg.redName:cfg.blueName;
 if(t.key==='boost')S.eff[team].boost=S.time+PWR.boost;
 if(t.key==='freeze')S.eff[1-team].frozen=S.time+PWR.freeze;
 if(t.key==='big')S.eff[team].big=S.time+PWR.big;
 banner(t.ico+' '+t.label,t.key==='freeze'?nm+' FROZE THE RIVALS':nm+' ACTIVATED',1.6);
 Au.power();
 burst(S.pu.obj.position,new THREE.Color(t.col),new THREE.Color(0xffffff),60,40);
 scene.remove(S.pu.obj);S.pu.obj=null;S.pu.timer=rand(PWR.respawn[0],PWR.respawn[1]);
}
function powerupUpdate(dt){
 if(!cfg.power)return;
 if(!S.pu.obj){S.pu.timer-=dt;if(S.pu.timer<=0)spawnPU();return;}
 const o=S.pu.obj;
 o.rotation.y+=dt*2.4;o.position.y=PWR.floatY+Math.sin(S.time*3)*PWR.floatAmp;
 for(const b of S.balls){
  if(b.m.position.distanceTo(o.position)<BALL_R+PWR.pickR){collectPU();break;}
 }
}
function redropBall(b){
 const zones=DEAD.redrop.zones;
 const z=zones[Math.floor(Math.random()*zones.length)];
 // target = where the ball should actually LAND, not where it's released — a falling ball
 // carries its launch vx/vz the whole way down (air friction is negligible), so releasing it
 // AT the zone lets that drift carry it well past the zone and into a rod's men. Back-solve the
 // spawn point from the fall time so the target zone is where it touches down instead.
 const tx=z.x+rand(-z.spread,z.spread),tz=rand(-DEAD.redrop.z,DEAD.redrop.z);
 const vx=rand(-DEAD.redrop.vel,DEAD.redrop.vel),vz=rand(-DEAD.redrop.vel,DEAD.redrop.vel);
 const fallT=Math.sqrt(2*Math.max(DEAD.redrop.y-BALL_R,0)/GRAV);
 b.m.position.set(tx-vx*fallT,DEAD.redrop.y,tz-vz*fallT);
 b.v.set(vx,0,vz);b.spin=0;b.stuckT=0;
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
}
function deadBallUpdate(dt){
 if(S.phase!=='play'||!S.balls.length)return;
 // global stall: every ball has gone quiet -> whistle + re-drop them all to a new spot.
 let mx=0;for(const b of S.balls)mx=Math.max(mx,b.v.length());
 if(mx<DEAD.stallVel)S.still+=dt;else S.still=0;
 if(S.still>DEAD.stallT){
  S.still=0;Au.whistle();resetRodRotation();banner('DEAD BALL','RE-DROP',1.1);
  for(const b of S.balls)redropBall(b);
  return;
 }
 // per-ball wedge: one ball pinned in a gap while others move -> re-drop just that one.
 if(S.balls.length>1){
  for(const b of S.balls){
   if(b.v.length()<DEAD.wedgeVel){b.stuckT+=dt;if(b.stuckT>DEAD.wedgeT)redropBall(b);}
   else b.stuckT=0;
  }
 }
}
