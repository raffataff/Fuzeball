'use strict';
/* ================= balls ================= */
function makeBall(key){
 const t=BALL_TYPES[key];
 const m=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,24,16),
  new THREE.MeshStandardMaterial({color:t.col,emissive:t.em,emissiveIntensity:t.em?0.7:0,
   roughness:t.metal?.25:.4,metalness:t.metal||.05}));
 m.castShadow=true;scene.add(m);
 // prev/cur = the true sim position one fixed-step ago / now. The renderer draws
 // m.position lerped between them (see loop); physics only ever writes 'cur'.
 const b={m,v:new THREE.Vector3(),t,key,scored:false,didSplit:false,trailT:0,light:null,spin:0,stuckT:0,
  cannonTimer:key==='cannon'?CONFIG.cannonball.timer:-1,
  prev:new THREE.Vector3(),cur:new THREE.Vector3()};
 if(t.light){b.light=new THREE.PointLight(t.light,1.1,34);scene.add(b.light);}
 S.balls.push(b);return b;
}
// call after ANY hard set of m.position outside physics (serve, redrop, split, NaN redrop):
// snaps the interp buffers to the mesh so the ball appears at the new spot without streaking there.
function syncBall(b){b.cur.copy(b.m.position);b.prev.copy(b.m.position);if(b.light)b.light.position.copy(b.m.position);}
function removeBall(b){scene.remove(b.m);if(b.light)scene.remove(b.light);
 const i=S.balls.indexOf(b);if(i>=0)S.balls.splice(i,1);}
function clearBalls(){while(S.balls.length)removeBall(S.balls[0]);}
function pickType(){
 if(!cfg.special)return 'classic';
 let tot=0;for(const k in BALL_TYPES)tot+=BALL_TYPES[k].w;
 let r=Math.random()*tot;
 for(const k in BALL_TYPES){r-=BALL_TYPES[k].w;if(r<=0)return k;}
 return 'classic';
}
function serve(){
 resetRodRotation();
 const key=pickType();
 const b=makeBall(key);
 b.m.position.set(rand(-SRV.spread,SRV.spread),SRV.dropY,rand(-SRV.zSpread,SRV.zSpread));
 b.v.set(rand(-SRV.vel,SRV.vel),0,rand(-SRV.vel,SRV.vel));
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
 if(key!=='classic')banner(BALL_TYPES[key].name,'SPECIAL BALL DROPPING',1.6);
 $('ballTag').textContent=BALL_TYPES[key].name;
 S.phase='play';S.still=0;S.lastTouch=-1;
}

function cannonballUpdate(dt){
 for(const b of S.balls){
  if(b.cannonTimer<0)continue;
  b.cannonTimer-=dt;
  if(b.cannonTimer<=0){
   removeBall(b);Au.power();
   let nearestRod=-1,nearestMan=-1,nearestDist=Infinity;
   const bp=b.m.position;
   for(let ri=0;ri<rods.length;ri++){
    const r=rods[ri];
    const sa=Math.sin(r.angle),ca=Math.cos(r.angle);
    const ax=r.x,ay=ROD_H;
    const fx=ax+sa*ARM,fy=ay-ca*ARM;
    for(let mi=0;mi<r.baseZ.length;mi++){
     if(r.removedUntil[mi]&&r.removedUntil[mi]>S.time)continue;
     const fz=r.baseZ[mi]+r.offset;
     const dx=bp.x-fx,dy=bp.y-fy,dz=bp.z-fz;
     const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
     if(dist<nearestDist){nearestDist=dist;nearestRod=ri;nearestMan=mi;}
    }
   }
   if(nearestRod>=0){
    rods[nearestRod].removedUntil[nearestMan]=S.time+CONFIG.cannonball.removeDuration;
    banner('💣 REMOVED!','ONE PLAYER TAKEN OUT',1.5);
   }
   if(!S.balls.length&&S.phase==='play'){resetRodRotation();banner('💣 EXPLOSION!','BALL RETURNS',1.2);S.phase='goal';S.goalT=MATCH.outHold;}
   break;
  }
 }
}
