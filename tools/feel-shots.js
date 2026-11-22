'use strict';
// feel-shots: js/feel.js in the real scene, frame by frame, PNG data URLs back with a per-frame trace (hitstop, trauma, the drawn leg past the real one, time-scale, ball).
//   node tools/page-run.js --size=1280x720 tools/feel-shots.js "fsKick({at:[0,1,2,3,4,6,8,12]})" > out.json   then node tools/fx-shots-save.js out.json tools/build/feel kick
//   fsKick: a kick from a standing man (rod = a rods[] index, man, dist ahead, human = counted as the player's); every other rod raised, the AI held still
//   fsGoal: a ball past the keeper into the goal (z, v) through the approach, the freeze, the blast and the spin (at = seconds after the start)
//   fsSoak: whole AI matches (no seats), what feel did a minute (hits, freezes and their ms, by strength), goals and phases, errors; set = CONFIG.feel overrides
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const errs=[],ce=console.error;
 console.error=function(){errs.push([].slice.call(arguments).join(' ').slice(0,700));ce.apply(console,arguments);};
 window.addEventListener('error',e=>errs.push(String(e.message).slice(0,700)));
 function frame(w,h){
  renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  try{renderer.render(scene,camera);}catch(e){
   const bad=[];(function walk(o,p){for(const c of o.children||[]){if(!c||!c.layers)bad.push(p+'/'+(c?(c.type||c.constructor.name)+':'+Object.keys(c).slice(0,6).join(','):String(c)));else walk(c,p+'/'+(c.name||c.type));}})(scene,'scene');
   throw new Error(e.message+' | '+bad.slice(0,6).join(' ; '));}
  return renderer.domElement.toDataURL('image/png');
 }
 function put(dst,src){for(const k in src){const v=src[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&dst[k]&&typeof dst[k]==='object')put(dst[k],v);else dst[k]=v;}}
 async function setup(o){
  S.seedNext=o.seed;startMatchNow('ai');clearBalls();S.phase='play';S.countT=0;S.goalT=0;
  cfg.particles=o.particles;
  for(const r of rods){r.aiIQ=false;r.aiErrT=1e9;}
  for(let i=0;i<60&&!(playerModel[0]&&playerModel[1]);i++)await new Promise(r=>setTimeout(r,250));
  rebuildRodMen();applyColors();
  await new Promise(r=>setTimeout(r,1500));
  if(Array.isArray(o.cam)){CONFIG.camera.modes.push(o.cam);o.cam=CONFIG.camera.modes.length-1;}
  S.camMode=o.cam;for(let i=0;i<10;i++)cameraUpdate(10);
 }
 const hold={};
 function still(on){   // the AI and the clock-driven systems held, so the scene is only what it sets up
  for(const k of ['aiUpdate','deadBallUpdate','powerupUpdate','cannonballUpdate']){if(on){hold[k]=window[k];window[k]=function(){};}else if(hold[k])window[k]=hold[k];}
 }
 const tr=(r)=>{const b=S.balls[0];return {held:feelHeld(),hs:+(FLS.hs*1000).toFixed(1),tr:+FLS.tr.toFixed(3),ts:+S.timeScale.toFixed(2),over:r?+((r.pivot.rotation.z-r.angle)*r.kickDir).toFixed(3):null,
  ang:r?+r.angle.toFixed(3):null,x:b?+b.m.position.x.toFixed(2):null,v:b?+b.v.length().toFixed(1):null,phase:S.phase,score:S.score.join(':')};};

 window.fsKick=async function(o){
  o=Object.assign({rod:5,man:1,dist:2.6,at:[0,1,2,3,4,5,6,8,10,14],cam:0,w:1280,h:720,particles:true,seed:7,human:true,frames:40,set:null,fps:60},o||{});
  if(o.set)put(CONFIG.feel,o.set);
  await setup(o);still(true);
  const r=rods[o.rod],dir=r.kickDir,uo=isUserRod;
  if(o.human)window.isUserRod=q=>q===r||uo(q);
  let t=performance.now()+2000;
  for(const q of rods)if(q!==r)q.raise=true;
  for(let f=0;f<40;f++){t+=1000/o.fps;loop(t);}
  const b=makeBall('classic');
  b.m.position.set(r.x+dir*o.dist,BALL_R,r.baseZ[o.man]+r.offset);b.v.set(0,0,0);syncBall(b);b.cur.copy(b.m.position);b.prev.copy(b.m.position);
  for(let f=0;f<4;f++){t+=1000/o.fps;loop(t);}
  kickRod(r,'shoot');
  const shots=[],info=[],trace=[];
  for(let f=0;f<=o.frames;f++){
   t+=1000/o.fps;loop(t);
   const q=tr(r);trace.push(q);
   if(o.at.indexOf(f)>=0){shots.push(frame(o.w,o.h));info.push(Object.assign({f},q));}
  }
  still(false);window.isUserRod=uo;
  return {shots,info,trace,errs};
 };

 window.fsGoal=async function(o){
  o=Object.assign({at:[0.02,0.08,0.14,0.2,0.3,0.45,0.7,1.0,1.4,1.9],cam:0,w:1280,h:720,particles:true,seed:7,z:3,v:[115,0,-6],x:57,set:null,fps:60},o||{});
  if(o.set)put(CONFIG.feel,o.set);
  await setup(o);still(true);
  let t=performance.now()+2000;
  for(const q of rods)q.raise=true;
  for(let f=0;f<40;f++){t+=1000/o.fps;loop(t);}
  const b=makeBall('classic');
  b.m.position.set(o.x,BALL_R,o.z);b.v.set(o.v[0],o.v[1],o.v[2]);syncBall(b);b.cur.copy(b.m.position);b.prev.copy(b.m.position);
  const shots=[],info=[],trace=[],gk=rods.find(q=>q.role==='GK'&&q.x>0);
  let el=0,k=0;
  while(k<o.at.length&&el<5){
   t+=1000/o.fps;loop(t);el+=1/o.fps;
   trace.push(Object.assign({t:+el.toFixed(3)},tr(gk)));
   if(el>=o.at[k]-1e-6){shots.push(frame(o.w,o.h));info.push(Object.assign({t:+el.toFixed(3)},tr(gk)));k++;}
  }
  still(false);
  return {shots,info,trace,errs};
 };

 window.fsSoak=async function(o){
  o=Object.assign({seeds:[1,2,3],secs:120,diff:'pro',set:null,fps:60},o||{});
  if(o.set)put(CONFIG.feel,o.set);
  cfg.diffRed=cfg.diffBlue=o.diff;
  const hits=[],fh=feelHit;let hsN=0,hsMs=0,goals=0,frames=0,slow=0,ms=0;
  window.feelHit=function(b,r,dv,sweet,nx,ny,nz){const h0=FLS.hs,c0=FLS.rodT.get(r);fh(b,r,dv,sweet,nx,ny,nz);if(FLS.rodT.get(r)!==c0)hits.push({dv:+dv.toFixed(1),role:r.role});if(FLS.hs>0&&!(h0>0)){hsN++;hsMs+=FLS.hs*1000;}};
  const phases={};
  for(const seed of o.seeds){
   S.seedNext=seed;startMatchNow('ai');S.camMode=0;
   let t=performance.now()+2000,el=0,lp=S.phase,lg=0;
   while(el<o.secs&&S.phase!=='win'){
    const a=performance.now();t+=1000/o.fps;loop(t);ms+=performance.now()-a;frames++;el+=1/o.fps;
    if(S.timeScale<0.99&&S.phase==='play')slow++;
    if(S.phase!==lp){phases[lp+'>'+S.phase]=(phases[lp+'>'+S.phase]||0)+1;lp=S.phase;}
    if(S.phase==='replay'&&typeof replayEnd==='function')replayEnd();
    if(frames%600===0)await new Promise(r=>setTimeout(r,0));
   }
   goals+=S.score[0]+S.score[1];
  }
  window.feelHit=fh;
  const mins=frames/o.fps/60,bands=[0,55,80,110,140,170,250],hist={};
  for(let i=0;i<bands.length-1;i++)hist[bands[i]+'-'+bands[i+1]]=hits.filter(h=>h.dv>=bands[i]&&h.dv<bands[i+1]).length;
  return {mins:+mins.toFixed(1),hitsPerMin:+(hits.length/mins).toFixed(1),freezesPerMin:+(hsN/mins).toFixed(1),freezeMs:+(hsMs/Math.max(1,hsN)).toFixed(1),
   frozenShare:+(hsMs/1000/(mins*60)).toFixed(4),slowMoFrames:slow,goals,phases,hist,frameMs:+(ms/frames).toFixed(2),errs};
 };
})();
