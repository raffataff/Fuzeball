'use strict';
/* ================= power-ups ================= */
// tear a power-up mesh out of the scene AND free its GPU resources — spawnPU builds fresh
// geometry+materials every spawn, so without this they leak for the whole session.
function disposePU(){const o=S.pu.obj;if(!o)return;scene.remove(o);
 o.traverse(c=>{if(c.isMesh){c.geometry.dispose();if(c.material.map)c.material.map.dispose();c.material.dispose();}});
 S.pu.obj=null;}
function clearPU(){disposePU();S.pu.timer=rand(PWR.firstDelay[0],PWR.firstDelay[1]);}
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
  const nm=teamName(team);
 if(t.key==='boost')S.eff[team].boost=S.time+PWR.boost;
 if(t.key==='freeze')S.eff[1-team].frozen=S.time+PWR.freeze;
 if(t.key==='big')S.eff[team].big=S.time+PWR.big;
 banner(t.ico+' '+t.label,t.key==='freeze'?nm+' FROZE THE RIVALS':nm+' ACTIVATED',1.6);
 Au.power();
 burst(S.pu.obj.position,new THREE.Color(t.col),new THREE.Color(0xffffff),60,40);
 disposePU();S.pu.timer=rand(PWR.respawn[0],PWR.respawn[1]);
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
 b.v.set(vx,0,vz);b.spin=0;b.stuckT=0;b.bbMin=b.bbMax=null; // clear the stall tracker
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
}
function deadBallUpdate(dt){
 if(S.phase!=='play'||!S.balls.length)return;
 // A ball is DEAD when its true position (b.cur) stays inside a small box long enough — NOT when
 // its speed is low. A ball a player holds or spins against a wall keeps a high b.v.length() while
 // never actually travelling, so a speed test never fires; tracking real displacement catches it,
 // and (unlike the old S.still) a per-touch collision can't reset it. Per ball we grow the
 // horizontal bounding box of where it's been; the box only resets when the ball roams past
 // moveEps, so a ball pinned in one spot keeps accruing time.
 const eps=DEAD.moveEps;
 let allStuck=true;
 for(const b of S.balls){
  const p=b.cur;
  if(!b.bbMin){b.bbMin=p.clone();b.bbMax=p.clone();b.stuckT=0;}
  else{
   b.bbMin.min(p);b.bbMax.max(p);
   if(Math.max(b.bbMax.x-b.bbMin.x,b.bbMax.z-b.bbMin.z)>eps){b.bbMin.copy(p);b.bbMax.copy(p);b.stuckT=0;}
   else b.stuckT+=dt;
  }
  if(b.stuckT<=DEAD.stallT)allStuck=false;
 }
 if(allStuck){ // every live ball wedged (also the single-ball case) -> whistle + re-drop all
  Au.whistle();resetRodRotation();banner('DEAD BALL','RE-DROP',1.1);
  for(const b of S.balls)redropBall(b);
  return;
 }
 // multi-ball: one ball pinned while others play -> re-drop just that one.
 if(S.balls.length>1)for(const b of S.balls)if(b.stuckT>DEAD.wedgeT)redropBall(b);
}
