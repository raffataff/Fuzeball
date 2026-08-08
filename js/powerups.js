'use strict';
/* ================= power-ups ================= */
// Tear a power-up out of the scene AND free the GPU resources spawnPU built for it. Only the
// PROCEDURAL parts (gem + halo ring) are freed — they're fresh geometry/materials every spawn and
// would otherwise leak for the session. A GLB pickup is a clone() sharing its geometry and
// materials with the resident template (models.js puTemplates), so disposing those would blank
// every future pickup of that type; own parts are stamped puOwn at build time to tell them apart.
function disposePU(){const o=S.pu.obj;if(!o)return;scene.remove(o);
 o.traverse(c=>{if(!c.isMesh||!c.userData.puOwn)return;
  c.geometry.dispose();if(c.material.map)c.material.map.dispose();c.material.dispose();});
 S.pu.obj=null;S.pu.spin=0;}
function clearPU(){disposePU();S.pu.timer=rand(PWR.firstDelay[0],PWR.firstDelay[1]);}
// The visual for one pickup: the type's GLB when it has one and it loaded, else the procedural
// octahedron. Either way it's parented to a group whose y-rotation is the idle spin, so the model's
// own resting yaw (md.yaw) lives one level down and survives it.
function makePUVisual(t){
 const M=PWR.models,md=(M&&M.on)?M[t.key]:null;
 const g=new THREE.Group();
 const mdl=(md&&typeof makePUModel==='function')?makePUModel(t.key):null;
 if(mdl){
  mdl.rotation.set(md.tilt||0,md.yaw||0,0);
  if(md.scale&&md.scale!==1)mdl.scale.multiplyScalar(md.scale);   // fit-scale is already baked into the template
  mdl.position.y=md.y||0;
  g.add(mdl);
 }else{
  const G=PWR.gem,gem=new THREE.Mesh(new THREE.OctahedronGeometry(G.r),
   new THREE.MeshStandardMaterial({color:t.col,emissive:t.col,emissiveIntensity:G.emissive,roughness:G.roughness}));
  gem.userData.puOwn=true;g.add(gem);
 }
 const R=PWR.ring;
 if(R.on&&!(md&&md.ring===false)){
  const ring=new THREE.Mesh(new THREE.RingGeometry(R.inner,R.outer,24),
   new THREE.MeshBasicMaterial({color:t.col,transparent:true,opacity:R.opacity,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=R.y;ring.userData.puOwn=true;g.add(ring);
 }
 S.pu.spin=(md&&md.spin)||PWR.spin;
 return g;
}
function spawnPU(){
 const t=PU_TYPES[Math.floor(Math.random()*PU_TYPES.length)];
 const g=makePUVisual(t);
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
 // No banner: the rail tab sliding out of this team's score IS the notification (hud.js
 // fxRailSync). Freeze is the exception — its tab appears on the RIVAL's side, so the team that
 // actually collected it would otherwise get no feedback at all.
 notice(nm+' · '+t.label,1.2,team===0?'var(--c0)':'var(--c1)');
 Au.power();
 burst(S.pu.obj.position,new THREE.Color(t.col),new THREE.Color(0xffffff),60,40);
 disposePU();S.pu.timer=rand(PWR.respawn[0],PWR.respawn[1]);
}
function powerupUpdate(dt){
 if(S.trn)return;                        // training sandbox: no random power-ups mid-test
 if(!cfg.power)return;
 if(!S.pu.obj){S.pu.timer-=dt;if(S.pu.timer<=0)spawnPU();return;}
 const o=S.pu.obj;
 o.rotation.y+=dt*(S.pu.spin||PWR.spin);o.position.y=PWR.floatY+Math.sin(S.time*3)*PWR.floatAmp;
 for(const b of S.balls){
  if(b.m.position.distanceTo(o.position)<BALL_R+PWR.pickR){collectPU();break;}
 }
}
// Which re-drop zone serves world-x `x` — the one whose `from` range contains it (see
// CONFIG.deadball.redrop). This is what keeps a re-drop in the third the ball died in: a random pick
// rewarded whoever was cornered, since a keeper smothering the ball on his own line got a 2-in-3
// shot at the whistle putting it further up the table than he could have kicked it. Shared with
// serve() so an out-of-play restart follows the same rule. Falls back to random when the feature is
// off or nothing covers x, so a mis-edited zone list degrades to the old behaviour rather than
// throwing on the one code path a stuck ball depends on.
function redropZone(x){
 const R=DEAD.redrop,zs=R.zones;
 if(R.sameThird&&typeof x==='number'&&isFinite(x))for(const z of zs)if(z.from&&x>=z.from[0]&&x<=z.from[1])return z;
 return zs[Math.floor(Math.random()*zs.length)];
}
// atX = the x the ball DIED at; defaults to its own live sim position (b.cur — the dead-ball case,
// where the ball is still on the table). Pass it explicitly when the ball has already been taken out
// of play and its position is gone. Only the ZONE is chosen from it; the drop is still jittered
// inside that zone, so a re-drop is never a free return to the exact spot it was held.
function redropBall(b,atX){
 const z=redropZone(atX!==undefined?atX:(b.cur||b.m.position).x);
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
 replayCut();   // the teleport would streak across a replay — drop the stale footage
}
// The lanes of pitch BETWEEN the rows that no rod can swing at — a hand-listed set of x ranges in
// CONFIG.deadball.rodGaps.lanes. Table-independent (RODDEFS is shared across every table), so unlike
// the corner pockets these don't hang off activeTable.
function rodGaps(){const G=DEAD.rodGaps;return G&&G.on?G.lanes:[];}
// How fast the dead-ball stuck-timer should tick at world position p. Returns >1 where a pinned ball
// can't be reached by any rod (so waiting the full stallT is pure dead air), 1 everywhere else. Three
// cases, in descending hopelessness: the GOAL ROOF, the active table's deadzones (corner pockets,
// tested as BOTH |x|>xMin AND |z|>zMin so one entry covers all four corners; per-zone `mult` overrides
// DEAD.zoneMult), and the between-row lanes above.
function deadzoneMult(p){
 const ax=Math.abs(p.x),az=Math.abs(p.z);
 // Goal roof: goalFrameCollide keeps a SOLID top over the goal box so an over-the-bar lob lands on it
 // instead of scoring — but nothing can then reach the ball. Box mirrors that collider exactly (incl.
 // the per-goal big-goal widen, hence the S.eff read) so the two can't drift apart. p.y is b.cur's,
 // and a ball resting there sits at goalH+BALL_R, comfortably above the goalH floor of the test.
 if(DEAD.roofMult>1&&p.y>F.goalH&&ax>F.L/2&&ax<F.L/2+F.goalDepth&&
    az<F.goalHalf*(S.eff[p.x>0?0:1].big>S.time?PHY.bigGoalMult:1))return DEAD.roofMult;
 const zs=activeTable&&activeTable.deadzones;
 if(zs)for(const z of zs)if(ax>z.xMin&&az>z.zMin)return z.mult||DEAD.zoneMult;  // pockets outrank lanes
 const gp=rodGaps();
 for(let i=0;i<gp.length;i++)if(p.x>gp[i].x0&&p.x<gp[i].x1)return gp[i].mult||DEAD.rodGaps.mult;
 return 1;
}
function deadBallUpdate(dt){
 if(S.trn&&!S.trn.deadball)return;       // training sandbox: a placed ball must sit still forever unless opted in
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
   else b.stuckT+=dt*deadzoneMult(p); // faster in an unreachable deadzone → shorter re-drop wait
  }
  if(b.stuckT<=DEAD.stallT)allStuck=false;
 }
 if(allStuck){ // every live ball wedged (also the single-ball case) -> whistle + re-drop all
  Au.whistle();resetRodRotation();notice('DEAD BALL',1.1);
  for(const b of S.balls)redropBall(b);
  return;
 }
 // multi-ball: one ball pinned while others play -> re-drop just that one.
 if(S.balls.length>1)for(const b of S.balls)if(b.stuckT>DEAD.wedgeT)redropBall(b);
}
