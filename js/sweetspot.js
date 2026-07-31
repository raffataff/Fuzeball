'use strict';
/* ================= sweet-spot guide (player aid) =================
   A player-facing overlay of the KICK sweet-spot zone — the tight forward
   band (dir-relative x, KICK.sweetSpot.xMin..xMax off the rod) × narrow
   z-centre of each foot (FOOT_BOX.z × zFrac) where a clean strike earns the
   power/aim bonus in collideRod (physics.js). Toggled with B / controller ○.
   Drawn for the rod held by the seat that TOGGLED it (js/seats.js) — one mesh set, so it
   follows one player rather than always the primary seat; whoever presses B takes it. It
   shows exactly where to bring the ball to thump it. Distinct from the
   C-key debug layer (which draws every rod and is a dev tool). Geometry mirrors
   the analytic test in physics.js: a flat zone per live man, following the slide
   offset + team kick direction, hidden for removed men. Cheap pool (max men),
   not tied to specific rod objects, so a buildRods rebuild can't leave it stale. */
let ssOn=false,ssGroup=null,ssBoxes=[],ssW=0,ssCxOff=0,ssZ=0,ssMat=null,ssSeat=null;
function buildSweetGuide(){
 if(ssGroup)return;
 const SW=KICK.sweetSpot;
 ssW=SW.xMax-SW.xMin; ssCxOff=(SW.xMin+SW.xMax)/2; ssZ=FOOT_BOX.z*SW.zFrac*2;
 ssGroup=new THREE.Group();ssGroup.visible=false;scene.add(ssGroup);
 let maxMen=1;for(const r of rods)if(r.baseZ.length>maxMen)maxMen=r.baseZ.length;
 const geo=new THREE.BoxGeometry(ssW,0.06,ssZ),eg=new THREE.EdgesGeometry(geo);
 ssMat=new THREE.MeshBasicMaterial({color:0xffe14d,transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
 const em=new THREE.LineBasicMaterial({color:0xfff29a,transparent:true,opacity:.8});
 for(let i=0;i<maxMen;i++){
  const g=new THREE.Group();
  g.add(new THREE.Mesh(geo,ssMat));
  g.add(new THREE.LineSegments(eg,em));
  g.visible=false;ssGroup.add(g);ssBoxes.push(g);
 }
}
/* `seat` = who asked for it. With two players and one mesh set, a second player pressing B
   TAKES the guide rather than turning the first player's off — otherwise B would read as a
   global switch that someone else keeps flipping. Pressing it again while you hold it turns
   it off, which is the behaviour a solo player has always had. */
function toggleSweetGuide(seat){
 buildSweetGuide();
 const s=seat||S.seats[0]||null;
 if(ssOn&&ssSeat&&s&&ssSeat!==s){ssSeat=s;if(typeof toast==='function')toast('SWEET SPOT','P'+(S.seats.indexOf(s)+1),0.8);}
 else{ssOn=!ssOn;ssSeat=ssOn?s:null;if(typeof toast==='function')toast('SWEET SPOT',ssOn?'on':'off',0.8);}
 ssGroup.visible=ssOn;
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function sweetGuideUpdate(){
 if(!ssGroup)return;
 // Seats are rebuilt every match, so a held reference goes stale the moment one starts —
 // self-heal to the primary seat rather than tracking a rod list that no longer belongs to anyone.
 if(ssSeat&&S.seats.indexOf(ssSeat)<0)ssSeat=null;
 const ar=(ssOn&&(S.phase==='play'||S.phase==='count'||S.phase==='goal'))?seatRod(ssSeat||S.seats[0]):null;
 if(!ar){for(const g of ssBoxes)g.visible=false;return;}
 ssMat.opacity=.20+.10*(0.5+0.5*Math.sin(S.time*4)); // gentle pulse so it reads as a live target
 const dir=ar.kickDir,cx=ar.x+ssCxOff*dir;
 for(let i=0;i<ssBoxes.length;i++){
  const live=i<ar.baseZ.length&&!(ar.removedUntil[i]&&ar.removedUntil[i]>S.time);
  ssBoxes[i].visible=live;
  if(live)ssBoxes[i].position.set(cx,0.05,ar.baseZ[i]+ar.offset);
 }
}
