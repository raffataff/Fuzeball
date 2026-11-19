'use strict';
// show-shots: frames of js/show.js in the real scene (page-run), PNG data URLs
//   node tools/page-run.js tools/show-shots.js "walkShots({k:'full'})" > out.json            the walkout as a contact sheet (HUD on), plus how the camera moved and where it landed
//   node tools/page-run.js tools/show-shots.js "boardShots()" > out.json                     the boards from the play camera on a skin of every table, in each state
//   node tools/page-run.js tools/show-shots.js "lineShots({pitches:['neon','royal']})" > out.json   each pitch idle, mid kickoff pulse, mid goal flood
//   node tools/page-run.js tools/show-shots.js "boardCost()"                                  board texture uploads over a steady stretch of play (should be 0)
//   then node tools/fx-shots-save.js out.json <dir> <prefix>
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 let T0=performance.now();
 const step=n=>{for(let i=0;i<n;i++){T0+=1000/60;loop(T0);}};
 function size(w,h){renderer.setPixelRatio(1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 async function venue(t,sk,pitch){
  cfg.table=t;cfg.skins=cfg.skins||{};if(sk)cfg.skins[t]=sk;
  const P=pitch||(sk&&CONFIG.tables[t].skins[sk].pitch);if(P)cfg.pitch=P;
  let a=false,b=false;applyTable(()=>{a=true;});drawField(()=>{b=true;});
  for(let i=0;i<300&&!(a&&b);i++)await wait(50);
  await wait(400);
 }
 function frame(withHud){renderer.render(scene,camera);if(withHud){hudRender(0);}}
 // one PNG of the 3D frame with the HUD canvas over it
 function grab(withHud){
  const c=document.createElement('canvas');c.width=renderer.domElement.width;c.height=renderer.domElement.height;
  const g=c.getContext('2d');g.drawImage(renderer.domElement,0,0);if(withHud&&HUD.c)g.drawImage(HUD.c,0,0,c.width,c.height);return c;
 }
 window.walkShots=async function(o){
  o=Object.assign({k:'full',mode:'red',every:0.5,w:1280,h:800,tw:320,th:200,cols:4,rows:6,seed:5,cam:0},o||{});
  cfg.walkout=o.k;S.camMode=o.cam;
  await venue(o.table||'classic',o.skin||'wood');
  size(o.w,o.h);
  S.seedNext=o.seed;startMatchNow(o.mode);
  await wait(1500);window.requestAnimationFrame=()=>0;
  const W=S.show&&S.show.walk;if(!W)return{err:'no walkout',phase:S.phase,walkout:cfg.walkout};
  const sheets=[],lab=[],N=o.cols*o.rows,T=W.T;
  let sh=null,g=null,k=0,next=0,f=0,jump=0,jumpAt=0,prev=null,endPose=null;
  const flush=()=>{if(sh){sheets.push(sh.toDataURL('image/png'));sh=null;}};
  while(S.show.walk&&f<60*(T+3)){
   step(1);f++;
   const p=camera.position.clone();if(prev){const d=p.distanceTo(prev);if(d>jump){jump=d;jumpAt=f/60;}}prev=p;
   if(f/60>=next){next+=o.every;
    frame(true);
    if(!sh){sh=document.createElement('canvas');sh.width=o.cols*o.tw;sh.height=o.rows*o.th;g=sh.getContext('2d');g.font='bold 14px sans-serif';k=0;}
    const x=(k%o.cols)*o.tw,y=Math.floor(k/o.cols)*o.th;
    g.drawImage(grab(true),x,y,o.tw,o.th);
    const s=(f/60).toFixed(1)+'s';g.fillStyle='rgba(0,0,0,.6)';g.fillRect(x,y,g.measureText(s).width+8,18);g.fillStyle='#fff';g.fillText(s,x+4,y+14);
    lab.push(s+' cam '+camera.position.toArray().map(v=>v.toFixed(0)).join(','));
    if(++k>=N)flush();
   }
  }
  endPose={cam:camera.position.toArray().map(v=>+v.toFixed(3)),want:walkEndPose().map(v=>+v.toFixed(3)),camLookX:+S.camLookX.toFixed(3),countT:+S.countT.toFixed(2)};
  // the next 0.5 s on the play camera: anything it still moves is a jump at the hand-over
  let after=0;const a0=camera.position.clone();step(30);after=camera.position.distanceTo(a0);
  frame(true);
  if(!sh){sh=document.createElement('canvas');sh.width=o.cols*o.tw;sh.height=o.rows*o.th;g=sh.getContext('2d');k=0;}
  g.drawImage(grab(true),(k%o.cols)*o.tw,Math.floor(k/o.cols)*o.th,o.tw,o.th);flush();
  return{shots:sheets,info:{T,frames:f,maxStep:+jump.toFixed(2),maxStepAt:jumpAt,endPose,driftAfter:+after.toFixed(3),phase:S.phase,banner:HUD.bnr&&HUD.bnr.m,labels:lab}};
 };
 // board states set by hand on a live match
 const STATES={
  menu:()=>{S.phase='menu';},
  walk:()=>{S.phase='count';SHW.on=true;},
  score:()=>{S.phase='play';S.score=[2,1];SH.sc=[2,1];SH.goal=SH.shot=null;S.matchTime=83;},
  shot:()=>{S.phase='play';SH.shot={kmh:112,t:SH.t};},
  goal:()=>{S.phase='play';SH.goal={team:0,t:SH.t-0.6};},
  win:()=>{S.phase='win';SH.goal=SH.shot=null;}
 };
 window.boardShots=async function(o){
  o=Object.assign({v:[['classic','wood'],['arena','standard'],['circuit','silverCircuit']],states:['menu','walk','score','shot','goal','win'],cam:0,w:1280,h:800,crop:true},o||{});
  S.seedNext=3;startMatchNow('red');await wait(800);window.requestAnimationFrame=()=>0;
  const shots=[],info=[],m=CAM.modes[o.cam];
  for(const [t,sk] of o.v){
   await venue(t,sk);size(o.w,o.h);
   for(const st of o.states){
    SHW.on=false;STATES[st]();
    camera.position.set(m[0],m[1],m[2]);camera.lookAt(m[3],m[4],m[5]);camera.updateMatrixWorld();
    showTick(0.02);renderer.render(scene,camera);
    const c=grab(false);
    if(o.crop){const q=document.createElement('canvas');q.width=640;q.height=200;q.getContext('2d').drawImage(c,320,40,640,200,0,0,640,200);shots.push(c.toDataURL('image/png'));shots.push(q.toDataURL('image/png'));}
    else shots.push(c.toDataURL('image/png'));
    info.push({t,sk,st,keys:SH.bd&&SH.bd.map(d=>d.key)});
   }
  }
  SHW.on=false;S.phase='menu';
  return{shots,info};
 };
 window.lineShots=async function(o){
  o=Object.assign({pitches:Object.keys(CONFIG.pitches),cam:[0,96,40,0,0,2],w:1280,h:800,at:{pulse:0.45,flood:0.55}},o||{});
  S.seedNext=3;startMatchNow('red');await wait(800);window.requestAnimationFrame=()=>0;
  for(const r of rods)r.pivot.visible=false;   // the lines, not the men
  const shots=[],info=[],m=o.cam;
  size(o.w,o.h);
  for(const id of o.pitches){
   await venue(cfg.table,null,id);
   shLinesTick();
   for(let i=0;i<60&&SH.ln.U.shLine.value===SH.ln.black&&shLineMode(id)!=='off';i++)await wait(50);
   camera.position.set(m[0],m[1],m[2]);camera.lookAt(m[3],m[4],m[5]);camera.updateMatrixWorld();
   for(const st of ['idle','pulse','flood']){
    S.phase='play';SH.goal=null;SH.kick=-99;
    if(st==='pulse')SH.kick=SH.t-o.at.pulse;
    if(st==='flood')SH.goal={team:1,t:SH.t-o.at.flood};
    shLinesTick();renderer.render(scene,camera);
    shots.push(grab(false).toDataURL('image/png'));
    info.push({pitch:id,st,mode:shLineMode(id),mask:SH.ln.U.shLine.value!==SH.ln.black});
   }
  }
  for(const r of rods)r.pivot.visible=true;
  S.phase='menu';
  return{shots,info};
 };
 // programs linked by each pitch switch (through venueLoad, as the menus do), twice round the list; lines:false runs it with the glow off for the baseline
 //   node tools/page-run.js tools/show-shots.js "pitchProbe({lines:true})"
 window.pitchProbe=async function(o){
  o=Object.assign({pitches:['royal','neon','cork','obsidian_volt','premier_championship'],lines:true,frames:20},o||{});
  CONFIG.show.lines.on=!!o.lines;
  await new Promise(r=>warmWhen(r,30));
  window.requestAnimationFrame=f=>f===loop?0:setTimeout(()=>f(performance.now()),16);
  const progs=()=>(renderer.info.programs||[]).length,rows=[];
  const names=()=>new Set((renderer.info.programs||[]).map(p=>p.name+'#'+p.id));
  step(2);   // the boards build on the first frame
  for(let lap=0;lap<2;lap++)for(const id of o.pitches){
   const p0=progs();let ok=false;cfg.pitch=id;
   venueLoad(d=>drawField(d),{onDone:()=>{ok=true;}});
   for(let i=0;i<800&&!ok;i++)await wait(25);
   const p1=progs(),n1=names();step(2);
   for(let i=0;i<80&&shLineMode(id)!=='off'&&SH.ln.U.shLine.value===SH.ln.black;i++)await wait(25);   // the mask lands on a uniform after the veil
   step(o.frames);
   rows.push({lap,id,mode:shLineMode(id),veil:p1-p0,after:progs()-p1,made:[...names()].filter(n=>!n1.has(n)),mask:SH.ln.U?SH.ln.U.shLine.value!==SH.ln.black:false});
  }
  return{rows,total:progs()};
 };
 window.boardCost=async function(o){
  o=Object.assign({secs:6},o||{});
  cfg.walkout='off';S.seedNext=9;startMatchNow('ai');await wait(800);window.requestAnimationFrame=()=>0;
  step(60*5);   // past the count, into play
  const v0=SH.bd.map(d=>d.tex.version),k0=SH.bd.map(d=>d.key);
  S.matchTime=30.2;let n=0;const keys=new Set();
  // hold the clock on one second so nothing the boards show changes; the AI plays on
  for(let i=0;i<o.secs*60;i++){S.matchTime=30.2;SH.goal=SH.shot=null;step(1);for(const d of SH.bd)keys.add(d.key);}
  const v1=SH.bd.map(d=>d.tex.version);
  return{uploads:v1.map((v,i)=>v-v0[i]),keys:[...keys],phase:S.phase,before:k0};
 };
})();
