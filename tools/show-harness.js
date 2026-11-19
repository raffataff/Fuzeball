// show harness. node tools/show-harness.js
// js/show.js on live CONFIG with real three (cine.js and feel.js beside it): the event-to-signal mapping (a goal, a kickoff, a hard shot), what each board shows and that it
// redraws only on a change, the pitch line patch (anchors found, one program for every pitch, a pitch change never recompiles, flood / pulse / glow uniforms), the walkout (when it
// plays, frozen input via S.show.walk, any-button skip, the pause hold, the banner after it, landing exactly on the play camera with no cut, the flourish order); then the hooks in
// flow / main / input / shots / fx / hud / models / options / index.html, and mutations that must each break it
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10),CR=String.fromCharCode(13);
const rd=f=>fs.readFileSync(f,'utf8').split(CR+NL).join(NL);

const STUB=`
var S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,suddenDeath:false,seats:[],trn:null,trial:null,tut:null,photo:null,lg:null,
 countT:0,prePause:'play',camMode:0,camLookX:0,show:null,timeScale:1,shake:0};
var LG={round:2},HUD={chromeA:1,x:null},WARM=[],DIRTY=0,BANNER=0,AUL=[];
var Au={ctx:{},play:function(id){AUL.push(id);return false;},sting:function(k){AUL.push('syn:'+k);},react:function(k){AUL.push('react:'+k);}};
var rods=[-52.5,-37.5,-22.5,-7.5,7.5,22.5,37.5,52.5].map(function(x,i){var t=[0,0,1,0,1,0,1,1][i];return {x:x,team:t,kickDir:t?-1:1,idx:i};});
var TN=['Red Rovers','Blue Comets'],TC=['#c8102e','#1e5bd8'];
function teamName(t){return TN[t];}function teamCol(t){return TC[t];}function teamDiff(t){return 'pro';}
var LIM=0;function gameTimeLimit(){return LIM;}
function curSkin(id){return 'wood';}
var SIDE=-1;function camTeamSide(){return SIDE;}function camRod(i){return null;}
function kitLin(h){return new THREE.Color(h);}
function warmPush(g){WARM.push(g);}function renderDirty(){DIRTY++;}
var camera=new THREE.PerspectiveCamera(55,16/9,1,700);camera.position.set(5,5,5);
var scene=new THREE.Scene(),renderer=null;
`;
const EXPORT=`;globalThis.X={CONFIG:CONFIG,SHC:SHC,SH:SH,SHW:SHW,S:S,cfg:cfg,CAM:CAM,MATCH:MATCH,MSTAT:MSTAT,F:F,FLS:FLS,CINE:CINE,camera:camera,scene:scene,THREE:THREE,HUD:HUD,Au:Au,
 get LIM(){return LIM;},set LIM(v){LIM=v;},get SIDE(){return SIDE;},set SIDE(v){SIDE=v;},log:{warm:WARM,au:AUL},get dirty(){return DIRTY;},rods:rods,TN:TN,
 showSee:showSee,shPages:shPages,shText:shText,shTW:shTW,shClean:shClean,shBoardsTick:shBoardsTick,shLineMode:shLineMode,shLineU:shLineU,showPitchPatch:showPitchPatch,shLinesTick:shLinesTick,
 walkLen:walkLen,walkStart:walkStart,walkStop:walkStop,walkSkip:walkSkip,walkPad:walkPad,walkTick:walkTick,walkCam:walkCam,walkEndPose:walkEndPose,walkU:walkU,showTick:showTick,
 feelPose:feelPose,feelFrame:feelFrame};`;

const THREE_SRC=rd('vendor/three.bundle.js');
function boot(src){
 const DOTS=[];
 const ctx2d=()=>({fillStyle:'',clearRect(){DOTS.length=0;},fillRect(x,y){DOTS.push([x,y,this.fillStyle]);}});
 const ctx={console:{log(){},warn(m){WARN.push(String(m));},error(){}},Math,JSON,Object,Array,Set,Map,WeakMap,Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Uint8ClampedArray,
  ArrayBuffer,DataView,Symbol,Promise,Error,TypeError,RangeError,Number,String,Boolean,Date,RegExp,Proxy,Reflect,setTimeout,clearTimeout,performance,TextDecoder,isNaN,isFinite,
  localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:()=>null,createElement:t=>t==='canvas'?{width:0,height:0,style:{},getContext:ctx2d}:{style:{}},documentElement:{style:{setProperty(){}}}}};
 ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
 vm.runInNewContext(THREE_SRC,ctx);
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),STUB,rd('js/cine.js'),rd('js/feel.js'),src,EXPORT].join(NL),ctx);
 if(!ctx.X||!ctx.X.SH)throw new Error('export line did not run');
 ctx.X.DOTS=DOTS;
 // the loader never fires in node: a load hands back a texture at once, a miss is logged
 ctx.THREE.TextureLoader.prototype.load=function(url,ok){LOADS.push(url);const t=new ctx.THREE.Texture();t.userData.url=url;if(ok)ok(t);return t;};
 return ctx.X;
}
const WARN=[],LOADS=[];

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);
const ball=v=>({v:{x:v,y:0,z:0,length(){return Math.hypot(this.x,this.y,this.z);}},m:{position:{x:0,y:1.6,z:0}}});
function reset(X){
 const S=X.S;S.phase='menu';S.score=[0,0];S.balls=[];S.trn=S.trial=S.tut=S.photo=S.lg=null;S.seats=[];S.suddenDeath=false;S.matchTime=0;S.countT=0;S.camMode=0;S.userTeam=0;
 X.cfg.walkout='full';X.cfg.table='classic';X.cfg.pitch='royal';X.cfg.room='arcade';X.LIM=0;X.SIDE=-1;
 X.SH.t=0;X.SH.sc=[0,0];X.SH.ph='menu';X.SH.goal=X.SH.shot=null;X.SH.kick=-99;
 X.SHW.on=false;X.FLS.spin=null;X.HUD.chromeA=1;X.log.au.length=0;
}
const see=(X,dt)=>X.showSee(dt===undefined?1/60:dt);

function signals(X){
 const S=X.S,SH=X.SH,K=X.SHC.shot;
 /* 1. a goal is the score going up */
 reset(X);S.phase='play';see(X);
 S.score=[1,0];see(X);
 ok(SH.goal&&SH.goal.team===0&&near(SH.goal.t,SH.t),'team 0 scoring is a goal for team 0, now');
 const g0=SH.goal;see(X);ok(SH.goal===g0,'...once: a steady score posts nothing new');
 S.score=[1,1];see(X);ok(SH.goal.team===1,'then team 1');
 const g1=SH.goal;see(X,0.5);S.score=[0,0];see(X);ok(SH.goal===g1&&near(SH.sc[0],0),'a new match zeroes the score without a goal');
 /* 2. a kickoff is the count giving way to play */
 reset(X);S.phase='count';see(X);ok(SH.kick<0,'no kickoff during the count');
 S.phase='play';see(X);ok(near(SH.kick,SH.t),'count to play is a kickoff');
 const k0=SH.kick;see(X);S.phase='goal';see(X);S.phase='play';see(X);ok(SH.kick===k0,'goal straight back to play (a replay skipped) is not a kickoff');
 S.phase='menu';SH.goal={team:0,t:0};SH.shot={kmh:1,t:0};see(X);ok(!SH.goal&&!SH.shot,'the menu clears the goal and the shot');
 /* 3. a shot: a ball that just gained most of its speed, fast enough */
 reset(X);S.phase='play';const b=ball(40);S.balls=[b];see(X);
 const fast=(K.min+30)/X.MSTAT.kmh;b.v.x=fast;see(X);
 ok(SH.shot&&SH.shot.kmh===Math.round(fast*X.MSTAT.kmh),'a strike past shot.min posts its km/h ('+(SH.shot&&SH.shot.kmh)+')');
 const s0=SH.shot;b.v.x=fast*1.1;see(X);ok(SH.shot===s0&&SH.shot.kmh===Math.round(fast*1.1*X.MSTAT.kmh),'the next frame of the same swing raises it');
 see(X,0.3);b.v.x=fast*1.2;see(X);ok(SH.shot===s0&&SH.shot.kmh===Math.round(fast*1.1*X.MSTAT.kmh),'...not after the swing (a ball speeding up slowly is no shot)');
 reset(X);S.phase='play';const c=ball(10);S.balls=[c];see(X);c.v.x=(K.min-10)/X.MSTAT.kmh;see(X);ok(!SH.shot,'a strike under shot.min posts nothing');
 reset(X);S.phase='goal';const d=ball(10);S.balls=[d];see(X);d.v.x=fast;see(X);ok(!SH.shot,'nothing outside play');
}

function boards(X){
 const S=X.S,SH=X.SH,B=X.SHC.board,P=()=>X.shPages().map(p=>p[0].map(g=>g[0]).join('')+(p[1]?'~':''));
 reset(X);ok(P().join('|')==='FUZE|BALL','the menu: FUZE BALL');
 S.phase='play';S.trn={};ok(P().join('|')==='FUZE|BALL','training shows the same');S.trn=null;
 S.phase='count';S.countT=X.MATCH.countIn+1;X.SHW.on=true;ok(P().join('|')==='RED ROVERS|BLUE COMETS','the walkout names the teams, left board team 0');X.SHW.on=false;
 S.phase='play';S.score=[2,1];S.matchTime=83;X.LIM=0;ok(P().join('|')==='2-1|1:23','untimed: score and the time played');
 X.LIM=300;ok(P()[1]==='3:37','timed: the time left ('+P()[1]+')');
 S.suddenDeath=true;ok(P()[1]==='GOLDEN GOAL ~','level at time-up: GOLDEN GOAL scrolls');S.suddenDeath=false;
 const sc=X.shPages()[0][0];ok(sc[0][1]!==sc[2][1]&&sc[1][1]==='#f0b24a','the score digits are in their kits, the dash in the board colour');
 SH.shot={kmh:112,t:SH.t};ok(P().join('|')==='112|KM/H','a hard shot: its speed');
 SH.t+=B.speedT+0.01;ok(P().join('|')==='2-1|3:37','...for speedT');
 SH.goal={team:1,t:SH.t};ok(P()[0]==='GOAL! BLUE COMETS ~'&&P()[1]===P()[0],'a goal scrolls on both boards');
 ok(X.shPages()[0][0][0][1]===X.shPages()[1][0][0][1]&&X.shPages()[0][0][0][1]!==X.shPages()[0][0][0][1].toUpperCase()+'x','...in the scorer\'s colour');
 SH.t+=B.goalT+0.01;S.phase='win';ok(P().join('|')==='2-1|FT','full time: FT');
 ok(X.shClean('Señor Ölé')==='SENOR OLE'&&X.shClean('a~b')==='A?B','names lose accents; glyphs it lacks read ?');
 // the glyphs: '1' is 4 rows of one dot + base of 3 + its flag: count the dots
 X.DOTS.length=0;X.shText({fillRect(x,y){X.DOTS.push([x,y]);}},[['1','#fff']],0,0);
 ok(X.DOTS.length===10,'1 lights 10 dots ('+X.DOTS.length+')');
 X.DOTS.length=0;X.shText({fillRect(x,y){X.DOTS.push([x,y]);}},[[':','#fff']],0,0);ok(X.DOTS.length===4&&X.DOTS.every(d=>d[0]===0),'a colon is drawn from its own ink, at x');
 ok(X.shTW([['1:1','#fff']])===5+1+1+1+5,'a colon is one dot wide between digits ('+X.shTW([['1:1','#fff']])+')');
 // redraw only on a change
 reset(X);S.phase='play';S.score=[0,0];X.shBoardsTick();
 ok(X.SH.bd&&X.SH.bd.length===B.at.length,'one board per `at` ('+(X.SH.bd&&X.SH.bd.length)+')');
 ok(X.log.warm.length===1,'the boards join the warm queue');
 const v0=X.SH.bd.map(d=>d.tex.version),dr0=X.dirty;
 X.shBoardsTick();X.shBoardsTick();
 ok(X.SH.bd.every((d,i)=>d.tex.version===v0[i])&&X.dirty===dr0,'a frame with nothing new uploads nothing');
 S.score=[1,0];X.shBoardsTick();ok(X.SH.bd[0].tex.version===v0[0]+1&&X.SH.bd[1].tex.version===v0[1],'a goal redraws the score board only');
 ok(X.SH.bd.every(d=>d.me.position.z<-33.9&&Math.abs(d.me.position.x)>9),'the boards sit on the far wall, off the centre line');
 X.cfg.table='arena';X.SHC.board.tables.arena=[[1,2,3],[4,5,6]];X.shBoardsTick();ok(X.SH.bd[0].me.position.x===1&&X.SH.bd[1].me.position.z===6,'a table may place its own');
 delete X.SHC.board.tables.arena;
 // a scroll starts in view and moves a dot per 1/scroll s
 SH.t+=0.37;SH.goal={team:0,t:SH.t};X.shBoardsTick();const x0=+X.SH.bd[0].key.split('|')[0];
 SH.t+=1/B.scroll+1e-6;X.shBoardsTick();const x1=+X.SH.bd[0].key.split('|')[0];
 ok(x0===1&&x1===0,'a scroll starts a dot in and steps left ('+x0+' '+x1+')');
}

function lines(X){
 const S=X.S,SH=X.SH,L=X.SHC.lines,T3=X.THREE;
 reset(X);
 ok(X.shLineMode('pub_classic')==='off'&&X.shLineMode('cork')==='off','pub and cork stay off');
 ok(X.shLineMode('neon')==='glow'&&X.shLineMode('obsidian_volt')==='glow'&&X.shLineMode('cyatron')==='glow'&&X.shLineMode('alien_tech')==='glow','neon, obsidian, cyatron, alien tech glow');
 ok(X.shLineMode('royal')===L.mode,'a pitch with no entry takes lines.mode');
 L.on=false;ok(X.shLineMode('neon')==='off','lines.on false: all off');L.on=true;
 // the patch: anchors found, one program
 const m1=new T3.MeshStandardMaterial(),m2=new T3.MeshPhysicalMaterial();
 X.showPitchPatch(m1);X.showPitchPatch(m2);
 const sh=lib=>({vertexShader:T3.ShaderLib[lib].vertexShader,fragmentShader:T3.ShaderLib[lib].fragmentShader,uniforms:{}});
 WARN.length=0;const a=sh('standard'),p=sh('physical');m1.onBeforeCompile(a);m2.onBeforeCompile(p);
 ok(WARN.length===0,'every anchor found ('+WARN.join('; ').slice(0,200)+')');
 ok(a.fragmentShader.includes('totalEmissiveRadiance+=shL*')&&a.vertexShader.includes('shUv=uv;')&&a.uniforms.shLine===X.shLineU().shLine,'the glow is added to the emissive, the mask read by the mesh uv, uniforms shared');
 ok(m1.customProgramCacheKey()==='shLines'&&m2.customProgramCacheKey()==='shLines','one cache key for every pitch');
 const f1=m1.onBeforeCompile;X.showPitchPatch(m1);ok(m1.onBeforeCompile===f1,'patching twice is a no-op');
 // a pitch change swaps a texture, never a program
 X.cfg.pitch='royal';X.shLinesTick();const v1=m1.version,u=X.shLineU();
 ok(u.shLine.value.userData.url===L.dir+'royal.png','a react pitch loads its mask');
 X.cfg.pitch='neon';X.shLinesTick();
 ok(m1.version===v1,'switching pitch leaves the materials alone (no recompile)');
 ok(u.shLine.value.userData.url===L.dir+'neon.png'&&near(u.shIdle.value,L.glow),'a glow pitch: its mask and the idle glow');
 X.cfg.pitch='royal';X.shLinesTick();ok(near(u.shIdle.value,0),'a react pitch has no idle glow');
 LOADS.length=0;X.cfg.pitch='cork';X.shLinesTick();ok(LOADS.length===0&&!u.shLine.value.userData.url,'an off pitch loads nothing and shows black');
 // flood and pulse
 X.cfg.pitch='royal';X.shLinesTick();
 SH.goal={team:0,t:SH.t};X.shLinesTick();
 ok(near(u.shFlood.value.x,X.F.L/2)&&near(u.shFlood.value.y,0)&&u.shFloodC.value.r>1,'team 0 scores at +x: the flood starts from that end in its colour');
 SH.t+=0.5;X.shLinesTick();ok(near(u.shFlood.value.y,0.5*L.flood.speed),'...its front runs at flood.speed');
 const f0=u.shFloodC.value.r;SH.t+=0.5;X.shLinesTick();ok(u.shFloodC.value.r<f0,'...and fades');
 SH.t+=L.flood.T;X.shLinesTick();ok(u.shFloodC.value.r===0&&u.shFloodC.value.g===0,'...gone after flood.T');
 SH.goal={team:1,t:SH.t};X.shLinesTick();ok(near(u.shFlood.value.x,-X.F.L/2),'team 1 scores at -x');
 X.cfg.pitch='cork';X.shLinesTick();ok(u.shFloodC.value.r===0,'an off pitch never floods');
 X.cfg.pitch='royal';SH.goal=null;SH.kick=SH.t-0.2;X.shLinesTick();
 ok(near(u.shPulse.value.x,10+0.2*L.pulse.speed)&&u.shPulseC.value.r>0,'a kickoff: a ring out of the centre circle');
 SH.kick=SH.t-L.pulse.T-0.01;X.shLinesTick();ok(u.shPulseC.value.r===0,'...gone after pulse.T');
}

function walk(X){
 const S=X.S,W=X.SHW,C=X.SHC.walk;let kb=0;const KB=()=>kb++;
 /* when it plays */
 reset(X);ok(X.walkLen()===C.T.full,'Kick Off, full: T.full');
 X.cfg.walkout='short';ok(X.walkLen()===C.T.short,'short: T.short');
 X.cfg.walkout='off';ok(X.walkLen()===0,'off: none');X.cfg.walkout='full';
 S.trn={};ok(X.walkLen()===0,'never in training');S.trn=null;
 S.trial={};ok(X.walkLen()===0,'never in a trial');S.trial=null;
 S.tut={};ok(X.walkLen()===0,'never in the tutorial');S.tut=null;
 S.lg={cup:false};ok(X.walkLen()===C.T.full,'the league gets one');S.lg=null;
 C.on=false;ok(X.walkLen()===0,'walk.on false: none');C.on=true;
 S.trn={};ok(X.walkStart(KB)===0&&!W.on&&kb===0,'walkStart in training: 0, nothing armed');S.trn=null;
 /* armed, frozen input, the banner held */
 reset(X);S.phase='menu';const T=X.walkStart(KB);
 ok(T===C.T.full&&W.on&&kb===0,'walkStart: T, armed, banner held');
 ok(X.HUD.chromeA===0,'the HUD chrome is taken down');
 ok(X.log.au.indexOf('sting_anthem')>=0&&X.log.au.indexOf('syn:anthem')>=0,'the anthem: the recorded take, else the synth');
 ok(X.S.show.walk===null,'S.show.walk is null until the count runs');
 S.phase='count';S.countT=X.MATCH.countIn+T;ok(X.S.show.walk===W,'...and set while it plays (input frozen)');
 S.phase='play';ok(X.S.show.walk===null,'a count ended under it frees input at once');
 S.phase='count';
 /* the flourish */
 const sp=X.FLS.spin;
 ok(sp&&sp.ph==='count'&&sp.m.size===8,'every rod gets a flourish in the count');
 const red=X.rods.filter(r=>r.team===0),blue=X.rods.filter(r=>r.team===1),dl=r=>sp.m.get(r).dl;
 ok(red.every((r,i)=>i===0||dl(r)>dl(red[i-1]))&&blue.slice().reverse().every((r,i,a)=>i===0||dl(r)>dl(a[i-1])),'red turns in order down +x, blue down -x, as the camera passes');
 ok(Math.max(...red.map(dl))<=Math.min(...blue.map(dl)),'red\'s pass comes first');
 ok(X.rods.every(r=>dl(r)>=0&&dl(r)+sp.T<=T+1e-6),'every flourish ends inside the walkout');
 ok(X.rods.every(r=>sp.m.get(r).n===C.spin.turns*r.kickDir),'each turns forward, whole turns');
 /* a natural end on the play camera, no cut */
 const E=X.walkEndPose();let jump=0,prev=null,t=0,last=0;
 while(W.on&&t<T+1){const dt=1/60;X.walkTick(dt);if(W.on)X.walkCam(dt);const p=X.camera.position.clone();if(prev){last=p.distanceTo(prev);jump=Math.max(jump,last);}prev=p;t+=dt;S.countT-=dt;}
 const cp=X.camera.position;
 ok(!W.on&&kb===1,'it ends by itself and puts the banner up once');
 ok(near(cp.x,E[0],1e-9)&&near(cp.y,E[1],1e-9)&&near(cp.z,E[2],1e-9)&&near(S.camLookX,E[3],1e-9),'the camera lands exactly on the play pose ('+cp.toArray().map(v=>v.toFixed(3))+')');
 ok(jump<2.5,'no cut on the way: the biggest step in a frame is '+jump.toFixed(2)+' u');
 ok(last<0.1,'it lands with no speed left (last step '+last.toFixed(3)+' u)');
 ok(S.countT<=X.MATCH.countIn+1e-6,'the normal count follows');
 ok(E[0]===0&&E[1]===68&&E[2]===47,'Close Side pose with no ball: (0,68,47)');
 /* skip */
 reset(X);kb=0;X.walkStart(KB);S.phase='count';S.countT=X.MATCH.countIn+T;X.walkTick(1);X.walkCam(1/60);
 X.walkPad({0:false,1:false});ok(W.on,'a pad with nothing fresh does not skip');
 X.walkPad({0:false,3:true});
 ok(!W.on&&kb===1&&near(S.countT,X.MATCH.countIn),'any fresh pad press skips: banner, the normal count');
 ok(X.camera.position.x===E[0]&&X.camera.position.y===E[1]&&X.camera.position.z===E[2],'...and cuts to the play camera');
 ok(X.FLS.spin===null,'...the flourish stops');
 X.walkSkip();ok(kb===1,'a second skip does nothing');
 reset(X);kb=0;X.walkStart(KB);S.phase='play';X.walkSkip();ok(W.on&&kb===0,'a skip outside the count does nothing');
 X.walkTick(1/60);ok(!W.on&&kb===0,'a count ended under it (a soak serving straight away) drops it with no banner');
 reset(X);X.walkStart(KB);S.phase='count';S.countT=X.MATCH.recount;ok(X.S.show.walk===null,'a later count (after a goal) never freezes input, even with the walkout never stopped');
 /* pause holds it */
 reset(X);X.walkStart(KB);S.phase='count';X.walkTick(1);const t0=W.t;
 S.phase='pause';S.prePause='count';X.walkTick(1);ok(W.t===t0&&W.on,'pause holds the walkout');
 ok(X.walkCam(1/60)===true,'...and keeps the camera');
 ok(X.S.show.walk===null,'...input is the pause menu\'s');
 S.phase='count';X.walkTick(1/60);ok(W.t>t0,'resume picks it up');
 /* other cameras */
 reset(X);X.SIDE=1;S.camMode=5;const E5=X.walkEndPose();ok(E5[0]===-X.CAM.modes[5][0],'an end camera mirrors for a blue side');
 reset(X);S.camMode=X.CAM.cine.mode;const Ec=X.walkEndPose();ok(Ec.join()===X.CAM.modes[X.CAM.cine.mode].slice(0,6).join(),'the cinematic camera: its own row, then it takes over');
 kb=0;X.walkStart(KB);S.phase='count';S.countT=X.MATCH.countIn+1;X.walkSkip();ok(X.CINE.on&&X.CINE.glide===1&&near(X.CINE.p[0],Ec[0])&&near(X.CINE.l[4],Ec[5]),'...gliding to its first shot from where the walkout left it');
 /* the HUD cards' windows */
 const cards=C.cards;ok(cards.full[0][1]<=cards.full[1][0]+0.1&&cards.full[0][0]<cards.full[1][0],'team 0\'s card comes before team 1\'s');
}

function run(src){
 pass=0;fail=0;fails.length=0;
 const X=boot(src);
 signals(X);boards(X);lines(X);walk(X);
 // the hooks
 const H=rd('index.html'),FL=rd('js/flow.js'),MN=rd('js/main.js'),IN=rd('js/input.js'),SHT=rd('js/shots.js'),FX=rd('js/fx.js'),HD=rd('js/hud.js'),MD=rd('js/models.js'),OP=rd('js/options.js'),CF=rd('js/config.js'),ST=rd('js/state.js');
 ok(H.includes("'js/feel.js','js/show.js',")&&H.includes('id="optWalkout"'),'index.html loads js/show.js after feel.js and has the Walkout select');
 ok(FL.includes('const wk=S.show?walkStart(kb):0;')&&FL.includes('if(!wk)kb();')&&FL.includes('startCount(MATCH.countIn+wk);'),'flow.js lengthens the count and holds the banner');
 ok(MN.includes("hudCount(S.show&&S.show.walk?'':")&&MN.includes("else if(S.phase==='count'&&!(S.show&&S.show.walk))userControlUpdate(FIXED);"),'main.js: no READY and no rod control during the walkout');
 ok(IN.includes('if(S.show&&S.show.walk){e.preventDefault();walkSkip();return;}')&&IN.includes('if(S.show&&S.show.walk){walkSkip();return;}')&&IN.includes('if(S.show&&S.show.walk){walkPad(just);continue;}')&&IN.includes("(S.phase!=='play'&&S.phase!=='count')||(S.show&&S.show.walk))return;"),'input.js: keys, clicks and pads skip it, the mouse slide waits');
 ok(SHT.includes("(S.phase==='play'||S.phase==='count')&&!(S.show&&S.show.walk))?seatRod(s):null;"),'shots.js: no shot verbs during the walkout');
 ok(FX.includes('if(S.show&&walkCam(rdt)){')&&FX.includes('if(S.show)showTick(rdt);'),'fx.js: the walkout camera and the per-frame tick');
 ok(HD.includes("const wk=!!(S.show&&S.show.walk);")&&HD.includes('if(wk)walkHud();'),'hud.js: chrome down and the cards up');
 ok(MD.includes("if(typeof showPitchPatch==='function')showPitchPatch(m);"),'models.js patches every pitch material');
 ok(OP.includes("$('optWalkout').onchange=e=>{cfg.walkout=e.target.value;saveCfg();};"),'options.js writes cfg.walkout');
 ok(/'walkout',\s+\/\//.test(CF)&&CF.includes("walkout:'full',"),'cfg.walkout defaults to full and syncs with the player');
 ok(ST.includes('show:null,'),'S.show is declared');
 return {pass,fail,fails:fails.slice()};
}

const SRC=rd('js/show.js');
const base=run(SRC);
console.log('show harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

function mutate(from,to,label){
 if(!SRC.includes(from)){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ['for(let t=0;t<2;t++){if(S.score[t]>SH.sc[t])SH.goal={team:t,t:SH.t};SH.sc[t]=S.score[t];}','for(let t=0;t<2;t++){if(S.score[t]!==SH.sc[t])SH.goal={team:t,t:SH.t};SH.sc[t]=S.score[t];}','a reset reads as a goal'],
 ['for(let t=0;t<2;t++){if(S.score[t]>SH.sc[t])SH.goal={team:t,t:SH.t};SH.sc[t]=S.score[t];}','for(let t=0;t<2;t++){if(S.score[t]>SH.sc[t])SH.goal={team:t,t:SH.t};}','the goal never settles'],
 ["if(SH.ph==='count'&&S.phase==='play')SH.kick=SH.t;","if(S.phase==='play')SH.kick=SH.t;",'any return to play is a kickoff'],
 ["if(S.phase==='menu')SH.goal=SH.shot=null;",'','the menu keeps the last goal'],
 ["if(S.phase!=='play')return;",'','shots outside play'],
 ['if(v*km>=K.min&&v-o>v*K.jump)','if(v*km>=K.min)','a fast rolling ball is a shot'],
 ['if(v*km>=K.min&&v-o>v*K.jump)','if(v-o>v*K.jump)','any strike posts'],
 ['else if(SH.shot&&SH.t-SH.shot.t<0.15&&v*km>SH.shot.kmh)','else if(SH.shot&&v*km>SH.shot.kmh)','a ball speeding up later raises the shot'],
 ["if(S.phase==='menu'||S.trn||S.trial||S.tut)return [one('FUZE',A),one('BALL',A)];","if(S.phase==='menu')return [one('FUZE',A),one('BALL',A)];",'training shows the match boards'],
 ['if(W)return [one(teamName(0),tc(0)),one(teamName(1),tc(1))];','if(W)return [one(teamName(1),tc(1)),one(teamName(0),tc(0))];','the names on the wrong boards'],
 ["if(g&&SH.t-g.t<B.goalT){const m=one('GOAL! '+teamName(g.team)+' ',tc(g.team),true);return [m,m];}","if(g){const m=one('GOAL! '+teamName(g.team)+' ',tc(g.team),true);return [m,m];}",'the GOAL scroll never ends'],
 ['if(SH.shot&&SH.t-SH.shot.t<B.speedT)','if(SH.shot)','the speed never goes'],
 ['return [sc,one(shClock(lim>0?lim-S.matchTime:S.matchTime),A)];','return [sc,one(shClock(S.matchTime),A)];','a timed match counts up'],
 ["if(S.suddenDeath)return [sc,one('GOLDEN GOAL ',A,true)];",'','no golden goal'],
 ["const sc=[[[String(S.score[0]),tc(0)],['-',A],[String(S.score[1]),tc(1)]],false];","const sc=[[[String(S.score[0]),A],['-',A],[String(S.score[1]),A]],false];",'the score loses its kits'],
 ['if(key===d.key)continue;','','every frame uploads'],
 ['if(txt!==d.txt){d.txt=txt;d.t0=SH.t;}','','a scroll starts wherever the clock is'],
 ["if(/[0-9A-Z]/.test(c)){SHFW[c]=[0,5];continue;}",'','digits are trimmed (the clock jumps)'],
 ['for(let k=0;k<F2[1];k++)if(b&(16>>(F2[0]+k)))','for(let k=0;k<5;k++)if(b&(16>>k))','glyphs drawn untrimmed'],
 ["if(typeof warmPush==='function')warmPush(g);",'','the boards compile on their first frame'],
 ["const B=SHC.board,at=(B.tables&&B.tables[cfg.table])||B.at;","const B=SHC.board,at=B.at;",'tables never place their own'],
 ['return SHC.lines&&SHC.lines.on?((L&&L.mode)||SHC.lines.mode):\'off\';','return (L&&L.mode)||SHC.lines.mode;','lines.on false still glows'],
 ['if(!m||!S.show||!SHC.lines||!SHC.lines.on||m.userData.shLines)return;','if(!m||!S.show||!SHC.lines||!SHC.lines.on)return;','a material is patched twice'],
 ["m.customProgramCacheKey=()=>'shLines';","m.customProgramCacheKey=()=>'shLines'+Math.random();",'a program per pitch'],
 ['shUv=uv;','shUv=shWp.xz/120.+.5;','the mask is read in world space, not by the uv'],
 ['totalEmissiveRadiance+=shL*(','totalEmissiveRadiance+=(','the glow ignores the mask'],
 ["if(md!=='off')new THREE.TextureLoader()","new THREE.TextureLoader()",'an off pitch loads a mask'],
 ['U.shIdle.value=md===\'glow\'?LC.glow:0;','U.shIdle.value=LC.glow;','every pitch glows idle'],
 ['U.shFlood.value.set((g.team===0?1:-1)*F.L/2,','U.shFlood.value.set((g.team===0?-1:1)*F.L/2,','the flood from the wrong end'],
 ['U.shFloodC.value.copy(kitLin(teamCol(g.team))).multiplyScalar(FL.gain*e*e);','U.shFloodC.value.copy(kitLin(teamCol(g.team))).multiplyScalar(FL.gain);','the flood never fades'],
 ["if(md!=='off'&&ga<FL.T){","if(ga<FL.T){",'an off pitch floods'],
 ['if(md!==\'off\'&&ka<PL.T){U.shPulse.value.set(10+ka*PL.speed,','if(md!==\'off\'&&ka<PL.T){U.shPulse.value.set(10,','the pulse stands still'],
 ["if(!SHC.on||!C||!C.on||S.trn||S.trial||S.tut||S.photo)return 0;","if(!SHC.on||!C||!C.on||S.trial||S.tut||S.photo)return 0;",'a walkout in training'],
 ["if(!SHC.on||!C||!C.on||S.trn||S.trial||S.tut||S.photo)return 0;","if(!SHC.on||!C||!C.on||S.trn||S.trial||S.photo)return 0;",'a walkout in the tutorial'],
 ["return k==='off'?0:(C.T[k]||0);","return C.T[k]||C.T.full;",'off still walks out'],
 ["get walk(){return SHW.on&&S.phase==='count'&&S.countT>MATCH.countIn?SHW:null;}","get walk(){return SHW.on&&S.countT>MATCH.countIn?SHW:null;}",'input stays frozen after the count'],
 ["get walk(){return SHW.on&&S.phase==='count'&&S.countT>MATCH.countIn?SHW:null;}","get walk(){return SHW.on&&S.phase==='count'?SHW:null;}",'a walkout never stopped freezes a later count'],
 ['if(typeof HUD!==\'undefined\')HUD.chromeA=0;','','the scoreboard shows through the walkout'],
 ["if(Au.ctx){if(!Au.play('sting_anthem'))Au.sting('anthem');","if(Au.ctx){Au.sting('anthem');",'the recorded anthem is never tried'],
 ["if(typeof feelSpin==='function')feelSpin(walkSpins(),C.spin.T,'count');",'','no flourish'],
 ['if(prev!=null&&d*prev<=0){dl=x*W.T;break;}prev=d;','if(prev!=null){dl=x*W.T;break;}prev=d;','every rod turns at the start of its pass'],
 ['m.set(r,{n:C.spin.turns*r.kickDir,dl});','m.set(r,{n:C.spin.turns,dl});','blue turns backward'],
 ['if(S.phase===\'count\')S.countT=Math.min(S.countT,MATCH.countIn);','','a skip leaves the long count running'],
 ['camera.position.set(E[0],E[1],E[2]);camera.lookAt(E[3],E[4],E[5]);S.camLookX=E[3];','','a skip leaves the camera where it was'],
 ['if(W.kb)W.kb();','','no banner after the walkout'],
 ["if(!done){if(typeof feelSpin==='function')feelSpin(null);return;}",'','a count ended under it still runs the ending'],
 ['if(W.t<W.T&&typeof feelSpin===\'function\')feelSpin(null);','','a skip leaves the men mid-turn'],
 ['function walkSkip(){if(SH.walk)walkStop(true);}','function walkSkip(){walkStop(true);}','a skip outside the count'],
 ['function walkPad(just){for(const k in just)if(just[k]){walkSkip();return;}}','function walkPad(just){walkSkip();}','a held button skips'],
 ["if(S.phase==='pause'||S.photo)return;\n W.t+=rdt;","W.t+=rdt;",'pause does not hold it'],
 ["if(S.phase!=='count'&&!(S.phase==='pause'&&S.prePause==='count')){walkStop(false);return;}","if(S.phase!=='count'){walkStop(false);return;}",'a pause kills the walkout'],
 ['const b=clamp((x-.85)/.15,0,1),e=b*b*(3-2*b)','const b=0,e=0','the springs never hand over (the landing misses)'],
 ['if(x>.8){const s=(x-.8)/.2;return .8+.2*(s+s*s-s*s*s);}','','no landing ease'],
 ["const mir=(typeof camTeamSide==='function'&&camTeamSide()===1&&CAM.sideModes.indexOf(S.camMode)>=0)?-1:1;","const mir=1;",'a blue side lands on the red end'],
 ["if(CAM.cine&&S.camMode===CAM.cine.mode&&typeof cineFrom==='function')cineFrom(E);",'','the cinematic camera cuts after the walkout'],
];
let survived=0;
for(const [a,b,label] of MUT){const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}}
console.log('mutations: '+(MUT.length-survived)+'/'+MUT.length+' caught');
process.exit(base.fail||survived?1:0);
