/* audio-harness.js — headless tests for js/audio.js (samples, routing, room, crowd, stand-ins).
   Run:  node tools/audio-harness.js

   Boots three.js + core.js + config.js + audio.js in one vm context against a MOCK WebAudio that
   records every node and connection, so routing is checked as a graph (does this sound reach the
   UI bus? through a panner? into the room?), not by reading the code. The pure DSP (auVox, auIR,
   auClaps) is measured on its real output.

   Every assertion is also run against MUTANTS of audio.js; each mutant must break at least one,
   and a mutant whose anchor has drifted off the source reports itself instead of passing. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..'),rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const THREESRC=rd('vendor/three.min.js'),CORE=rd('js/core.js'),CFG=rd('js/config.js'),AUDIO=rd('js/audio.js');
const MF=require('./build_audio_manifest.js');

/* ---- mock WebAudio ------------------------------------------------------------------------ */
function mockAudio(made){
 const P=v=>({value:v,setValueAtTime(x){this.value=x;},linearRampToValueAtTime(x){this.value=x;},
  exponentialRampToValueAtTime(x){this.value=x;},setTargetAtTime(x){this.value=x;this.target=x;}});
 function node(kind,o){const n=Object.assign({kind,conns:[],off:false,
  connect(t){this.conns.push(t);return t;},
  disconnect(t){if(t)this.conns=this.conns.filter(x=>x!==t);else{this.conns=[];this.off=true;}}},o);made.push(n);return n;}
 return function Ctx(){
  this.currentTime=10;this.sampleRate=48000;this.destination=node('dest');
  this.createGain=()=>node('gain',{gain:P(1)});
  this.createBiquadFilter=()=>node('biquad',{type:'lowpass',frequency:P(350),Q:P(1),gain:P(0)});
  this.createOscillator=()=>node('osc',{type:'sine',frequency:P(440),start(){},stop(){}});
  this.createBufferSource=()=>node('src',{buffer:null,loop:false,playbackRate:P(1),start(t,off){this.at=t;this.startedAt=t;},stop(){}});
  this.createStereoPanner=()=>node('pan',{pan:P(0)});
  this.createConvolver=()=>node('conv',{buffer:null,normalize:true});
  this.createDynamicsCompressor=()=>node('comp',{threshold:P(0),knee:P(0),ratio:P(1),attack:P(0),release:P(0)});
  this.createBuffer=(ch,len,sr)=>({numberOfChannels:ch,length:len,sampleRate:sr,duration:len/sr,
   _d:[...Array(ch)].map(()=>new Float32Array(len)),getChannelData(i){return this._d[i];},copyToChannel(a,i){this._d[i].set(a);}});
 };
}
const reach=(a,b,seen=new Set())=>{if(a===b)return true;if(!a||seen.has(a))return false;seen.add(a);return a.conns.some(n=>reach(n,b,seen));};
const path2=(a,b,kind,seen=new Set())=>{   // is there a path a→b that passes a node of `kind`?
 if(!a||seen.has(a))return false;seen.add(a);
 return a.conns.some(n=>(n.kind===kind&&reach(n,b))||path2(n,b,kind,seen));};

function boot(src){
 const made=[],timers=[];
 const ctx={console,Math,Object,Array,Float32Array,Float64Array,Uint16Array,Uint32Array,Int32Array,Uint8Array,Int8Array,Int16Array,
  Uint8ClampedArray,Symbol,Map,Set,WeakMap,JSON,Number,String,Boolean,Error,TypeError,Date,parseInt,parseFloat,isFinite,isNaN,Promise,
  performance:{now:()=>0},setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},
  addEventListener(){},document:{addEventListener(){},hidden:false,hasFocus:()=>true}};
 ctx.self=ctx.window=ctx.globalThis=ctx;vm.createContext(ctx);
 vm.runInContext(THREESRC,ctx);
 ctx.window.AudioContext=mockAudio(made);
 for(const [f,s] of [['js/core.js',CORE],['js/config.js',CFG],['js/audio.js',src]])new vm.Script(s,{filename:f}).runInContext(ctx);
 new vm.Script('globalThis.__a={Au,AUSND,AUC,AUMIX,AU_UI,AU_STING,AUREACT,CONFIG,cfg};').runInContext(ctx);
 // a camera behind the red goal-end, looking down the table: +x on screen is the ball moving right
 const cam=new ctx.THREE.PerspectiveCamera(55,1.6,1,700);cam.position.set(0,60,120);cam.lookAt(0,0,0);cam.updateMatrixWorld(true);
 ctx.camera=cam;
 ctx.S={phase:'play',balls:[]};
 ctx.activeRoom=ctx.__a.CONFIG.rooms.pub;
 return Object.assign(ctx.__a,{ctx,made,timers});
}
const buf=(A,secs)=>{const b=new A.ctx.window.AudioContext().createBuffer(2,Math.round(48000*(secs||.2)),48000);return b;};
const ball=(x,z,key)=>({m:{position:{x,y:2,z}},key:key||'classic'});

/* ---- DSP measures --------------------------------------------------------------------------- */
const rms=(a,i0,i1)=>{let s=0;for(let i=i0;i<i1;i++)s+=a[i]*a[i];return Math.sqrt(s/Math.max(1,i1-i0));};
const db=x=>20*Math.log10(x||1e-12);
const hfRatio=(a,i0,i1)=>{let e=0,d=0;for(let i=i0+1;i<i1;i++){e+=a[i]*a[i];const q=a[i]-a[i-1];d+=q*q;}return d/Math.max(1e-12,e);};
function envSpec(a,sr){   // amplitude envelope at 100 Hz → power in a band of modulation frequencies
 const hop=sr/100,n=Math.floor(a.length/hop),e=new Float64Array(n);
 for(let k=0;k<n;k++){let s=0;for(let i=0;i<hop;i++)s+=Math.abs(a[k*hop+i]);e[k]=s/hop;}
 const m=e.reduce((x,y)=>x+y,0)/n;for(let k=0;k<n;k++)e[k]-=m;
 return (f0,f1)=>{let p=0;for(let f=f0;f<=f1;f+=.25){let re=0,im=0;for(let k=0;k<n;k++){const w=2*Math.PI*f*k/100;re+=e[k]*Math.cos(w);im+=e[k]*Math.sin(w);}p+=re*re+im*im;}return p;};}
const drain=g=>{while(!g.step(8192));return g;};
// energy between f0 and f1 Hz (a Goertzel every 25 Hz over the whole signal)
function band(a,sr,f0,f1){let p=0;for(let f=f0;f<=f1;f+=25){const w=2*Math.PI*f/sr,c=2*Math.cos(w);let s1=0,s2=0;
 for(let i=0;i<a.length;i++){const s=a[i]+c*s1-s2;s2=s1;s1=s;}p+=s1*s1+s2*s2-c*s1*s2;}return p;}

/* ---- the suite: returns failure messages ------------------------------------------------------ */
function suite(src,verbose){
 const fails=[];let pass=0;
 const ok=(name,c,x)=>{if(c)pass++;else fails.push(name+(x!==undefined?'  ('+JSON.stringify(x)+')':''));};
 let A;try{A=boot(src);}catch(e){return{fails:['boot: '+e.message],pass};}
 const {ctx,Au,AUSND,AUC,AUMIX,AU_UI,AU_STING,AUREACT,CONFIG,cfg}=A;
 try{
 /* 1. pure helpers */
 {const r=ctx.auRng(5),s=ctx.auRng(5);let same=true,inr=true;for(let i=0;i<200;i++){const a=r(),b=s();if(a!==b)same=false;if(!(a>=0&&a<1))inr=false;}
  ok('auRng is deterministic per seed',same);ok('auRng stays in [0,1)',inr);}
 {let last=-1,rep=0;const used=new Set(),r=ctx.auRng(9);
  for(let i=0;i<3000;i++){const k=ctx.auPick(3,last,r());if(k===last)rep++;used.add(k);last=k;}
  ok('round-robin never plays the same take twice running',rep===0,rep);ok('round-robin uses every take',used.size===3,[...used]);
  const firsts=new Set();for(let i=0;i<200;i++)firsts.add(ctx.auPick(4,-1,i/200));
  ok('with no previous take every take can come first',firsts.size===4,[...firsts]);
  ok('a single take is always take 0',ctx.auPick(1,0,.7)===0);}
 ok('auLin interpolates',Math.abs(ctx.auLin([[0,0],[1,10]],.25)-2.5)<1e-9);
 ok('auLin clamps past the end',ctx.auLin([[0,0],[1,10]],3)===10);
 /* 2. pan follows the screen */
 {const r=ctx.auPanOf(ball(0,40)),l=ctx.auPanOf(ball(0,-40)),c=ctx.auPanOf(ball(0,0));
  // camera at +z looking at the origin: world +x is screen RIGHT
  const R=ctx.auPanOf(ball(40,0)),L=ctx.auPanOf(ball(-40,0));
  ok('a ball on the right of the screen pans right',R>.2,R);ok('…and on the left pans left',L<-.2,L);
  ok('a centred ball is centred',Math.abs(c)<.02,c);ok('depth alone barely pans',Math.abs(r)<.1&&Math.abs(l)<.1,[r,l]);
  ok('a position with no numbers is centred',ctx.auPanOf({x:NaN,y:0,z:0})===0);
  const far=ctx.auPanOf(ball(5000,0));ok('pan is clamped to ±1',far<=1&&far>0.9,far);}
 /* 3. the room impulse */
 {const sr=48000,Ap=Object.assign({},AUMIX.reverb.def,AUMIX.reverb.rooms.pub),ir=ctx.auIR(sr,Ap,3),L=ir[0],pre=Math.floor(sr*Ap.pre);
  ok('impulse length = pre + 1.1 × decay',L.length===pre+Math.ceil(sr*Ap.decay*1.1),L.length);
  let z=true;for(let i=0;i<pre;i++)if(L[i]!==0)z=false;ok('nothing before the pre-delay',z);
  const w=Math.floor(sr*.06),t1=pre+Math.floor(sr*.05),t2=pre+Math.floor(sr*Ap.decay*.8),
   want=-60*(.8*Ap.decay-.05)/Ap.decay,got=db(rms(L,t2,t2+w))-db(rms(L,t1,t1+w));
  ok('the tail falls at the room\'s RT60',Math.abs(got-want)<3,{got:+got.toFixed(1),want:+want.toFixed(1)});
  ok('the tail darkens as it goes',hfRatio(L,t2,t2+w)<hfRatio(L,t1,t1+w)*.5,[hfRatio(L,t1,t1+w),hfRatio(L,t2,t2+w)]);
  const again=ctx.auIR(sr,Ap,3)[0];let id=true;for(let i=0;i<L.length;i+=97)if(again[i]!==L[i])id=false;ok('impulse is deterministic',id);
  let c=0,ea=0,eb=0;const R=ir[1];for(let i=t1;i<t2;i++){c+=L[i]*R[i];ea+=L[i]*L[i];eb+=R[i]*R[i];}
  ok('the two ears are decorrelated',Math.abs(c/Math.sqrt(ea*eb))<.3,c/Math.sqrt(ea*eb));
  const sal=ctx.auIR(sr,Object.assign({},AUMIX.reverb.def,AUMIX.reverb.rooms.saucer),3)[0];
  ok('a bigger room rings longer',sal.length>L.length*1.5,[sal.length,L.length]);}
 /* 4. the synthesized crowd */
 {const sr=24000,g=drain(ctx.auVox({sr,secs:4,voices:24,seed:11,xf:.5})),L=g.L,R=g.R;
  let fin=true,pk=0;for(let i=0;i<L.length;i++){if(!isFinite(L[i])||!isFinite(R[i]))fin=false;pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));}
  ok('bed is finite',fin);ok('bed is normalised to 0.9',Math.abs(pk-.9)<1e-3,pk);ok('bed is not silent',rms(L,0,L.length)>.05,rms(L,0,L.length));
  ok('the loop is exactly its length (the overrun is folded into the start)',L.length===sr*4,L.length);
  let md=0;for(let i=1;i<L.length;i++)md+=Math.abs(L[i]-L[i-1]);md/=L.length-1;
  ok('the loop seam is as smooth as anywhere else',Math.abs(L[L.length-1]-L[0])<5*md&&Math.abs(R[R.length-1]-R[0])<5*md,{seam:Math.abs(L[L.length-1]-L[0]),md});
  let c=0,ea=0,eb=0;for(let i=0;i<L.length;i++){c+=L[i]*R[i];ea+=L[i]*L[i];eb+=R[i]*R[i];}
  ok('the room is spread across both ears',c/Math.sqrt(ea*eb)<.9,c/Math.sqrt(ea*eb));
  const one=drain(ctx.auVox({sr,secs:8,voices:1,groups:1,seed:4,xf:.2})),sp=envSpec(one.L,sr),syl=sp(3,7),fast=sp(14,30);
  ok('one voice speaks in syllables (3-7 Hz modulation)',syl>3*fast,{syl,fast});
  // inside a phrase the level keeps DIPPING between syllables (a drone only dips at phrase edges)
  const hop=240,e=[];for(let k=0;k+hop<=one.L.length;k+=hop){let t=0;for(let i=0;i<hop;i++)t+=Math.abs(one.L[k+i]);e.push(t/hop);}
  const gm=Math.max(...e);let act=0,dip=0;for(let k=15;k<e.length-15;k++){const lm=Math.max(...e.slice(k-15,k+15));if(lm<.2*gm)continue;act++;if(e[k]<.3*lm)dip++;}
  ok('…and dips between them',dip/act>.22,dip/act);}
 {const sr=24000,mk=v=>drain(ctx.auVox({sr,seed:3,voices:6,shape:{len:.8,jit:0,env:[[0,1],[.8,1]],vow:[[0,v]],pit:[[0,1]]}})).L;
  // ee has its second formant up at 2240 Hz, oo down at 900: compare the two regions in each
  const i=mk('i').slice(2000),u=mk('u').slice(2000),ri=band(i,sr,2000,2500)/band(i,sr,800,1000),ru=band(u,sr,2000,2500)/band(u,sr,800,1000);
  ok('the vowel filters shape the voices (ee has its energy high, oo low)',ri>4*ru,{ee:ri,oo:ru});}
 {const sr=24000,sh=AUREACT.ooh,g=drain(ctx.auVox({sr,seed:31,shape:sh,voices:sh.voices,lift:sh.lift})).L,n=g.length,w=Math.floor(sr*.05);
  let best=0,at=0;for(let k=0;k+w<n;k+=w){const r=rms(g,k,k+w);if(r>best){best=r;at=k/sr;}}
  ok('an ooh swells from nothing',rms(g,0,Math.floor(sr*.02))<best*.2);ok('…peaks early on',at>.15&&at<.9,at);ok('…and dies away',rms(g,n-w,n)<best*.15);
  ok('the reaction lasts its shape',n===Math.floor(sr*sh.len),n);}
 {const g=ctx.auClaps({sr:24000,seed:47,secs:3,people:30,env:[[0,1],[3,1]]}),L=g.L;
  let on=0,prev=0;const w=48;for(let k=0;k+w<L.length;k+=w){const r=rms(L,k,k+w);if(r>prev*3&&r>.05)on++;prev=r;}
  ok('applause is many separate claps',on>60,on);}
 /* 5. the graph */
 cfg.sound=true;cfg.ambience=true;Au.init();
 ok('init built the buses',!!(Au.mg&&Au.cb&&Au.ub&&Au.sum));
 ok('menus reach the output',reach(Au.ub,Au.sum));ok('the crowd reaches the output through the room band-limit',path2(Au.cb,Au.sum,'biquad'));
 ok('a room was applied at init',Au.rv&&Au.rv.id==='pub',Au.rv&&Au.rv.id);
 const osc=()=>A.made.filter(n=>n.kind==='osc').length,srcs=()=>A.made.filter(n=>n.kind==='src').length;
 {const o0=osc();Au.kick(60,{},ball(40,0));
  ok('with no recording the kick is synthesized',osc()>o0);
  const lastSrc=A.made.filter(n=>n.kind==='src').pop();
  ok('…panned by the ball',path2(lastSrc,Au.mg,'pan'));
  ok('…and sent into the room',reach(lastSrc,Au.rv.f));}
 ok('an unknown id plays nothing',Au.play('no_such_sound')===false);
 {const b1=buf(A),b2=buf(A),b3=buf(A),bh=buf(A),bf=buf(A);Au.bank.ball_kick=[b1,b2,b3];Au.bank.ball_kick_hard=[bh];Au.bank.ball_kick_fire=[bf];
  const fired=()=>A.made.filter(n=>n.kind==='src').pop().buffer;
  Au.ctx.currentTime+=1;const o0=osc();Au.kick(30,{},ball(0,0));
  ok('a recorded kick replaces the synthesized one',osc()===o0&&[b1,b2,b3].includes(fired()));
  Au.ctx.currentTime+=1;Au.kick(88,{},ball(0,0));ok('a hard hit plays the _hard take',fired()===bh);
  Au.ctx.currentTime+=1;Au.kick(30,{},ball(0,0,'fire'));ok('a fireball plays its own take',fired()===bf);
  let last=null,rep=0;for(let i=0;i<60;i++){Au.ctx.currentTime+=1;Au.kick(20,{},ball(0,0));const f=fired();if(f===last)rep++;last=f;}
  ok('recorded kicks never repeat a take back to back',rep===0,rep);
  Au.ctx.currentTime+=1;const s0=srcs();Au.kick(20,{},ball(0,0));Au.kick(20,{},ball(0,0));
  ok('the voice gate holds back a second kick in the same instant',srcs()===s0+1,srcs()-s0);
  const v0=A.made.filter(n=>n.kind==='gain').length;Au.ctx.currentTime+=1;Au.kick(5,{},ball(0,0));
  const gSoft=A.made.filter(n=>n.kind==='gain')[v0].gain.value;Au.ctx.currentTime+=1;Au.kick(60,{},ball(0,0));
  const gHard=A.made.filter(n=>n.kind==='gain')[v0+3].gain.value;
  ok('a soft touch is quieter than a firm one',gSoft<gHard*.6,[gSoft,gHard]);
  delete Au.bank.ball_kick;delete Au.bank.ball_kick_hard;delete Au.bank.ball_kick_fire;}
 {Au.ctx.currentTime+=1;const o0=osc();Au.ui('back');
  const o=A.made.filter(n=>n.kind==='osc').slice(o0);
  ok('a menu sound is synthesized with no recording',o.length>0);ok('…and lands on the menu bus',o.every(n=>reach(n,Au.ub))&&!o.some(n=>reach(n,Au.mg)));
  const o1=osc();Au.ui('click');ok('two menu sounds in the same instant: the first wins',osc()===o1);
  Au.ctx.currentTime+=1;const f0=osc();Au.ui('nonsense');ok('an unknown menu kind still clicks',osc()-f0===AU_UI.click.length*4,osc()-f0);
  Au.ctx.currentTime+=1;Au.bank.ui_move=[buf(A)];const s0=srcs();Au.ui('move');const s=A.made.filter(n=>n.kind==='src').pop();
  ok('a recorded menu sound plays on the menu bus',srcs()===s0+1&&reach(s,Au.ub)&&!reach(s,Au.mg));delete Au.bank.ui_move;}
 {Au.ctx.currentTime+=1;Au.exc=0;const s0=srcs();Au.react('roar');
  ok('no recording and no stand-in yet: a reaction is skipped, not faked',srcs()===s0&&Au.exc===0);
  Au.syn.crowd_roar=buf(A,2);Au.react('roar');const s=A.made.filter(n=>n.kind==='src').pop();
  ok('the stand-in roar plays on the crowd bus',srcs()===s0+1&&reach(s,Au.cb));ok('…and lifts the room',Au.exc>.99,Au.exc);
  ok('…and sends into the room',reach(s,Au.rv.c));
  Au.ctx.currentTime+=1;cfg.ambience=false;const s1=srcs();Au.react('roar');ok('crowd off: no reactions',srcs()===s1);cfg.ambience=true;}
 {Au.ctx.currentTime+=5;Au.exc=0;delete Au.syn.crowd_roar;const o0=osc();Au.goal('goal');   // no roar: the lift must come from the goal itself (the LEDs read it)
  ok('a goal plays the brass stinger',osc()-o0===AU_STING.goal.brass.length*2,osc()-o0);ok('…and the room goes up',Au.exc===1);
  const fr=A.made.filter(n=>n.kind==='osc').slice(o0).map(n=>n.frequency.value);
  ok('…ending higher than it starts (not a sad trombone)',Math.max(...fr.slice(-4))>fr[0],fr);
  Au.ctx.currentTime+=5;Au.exc=0;const o1=osc();Au.goal('trophy');
  ok('a trophy is the gold: bells',A.made.filter(n=>n.kind==='osc').slice(o1).some(n=>n.frequency.value>2000));ok('…with no roar',Au.exc===0,Au.exc);}
 /* 6. the room */
 {const old=Au.rv;ctx.activeRoom=CONFIG.rooms.open;Au.tick(1/60);
  ok('a room change builds a new reverb',Au.rv!==old&&Au.rv.id==='open');
  ok('Void\'s crowd is band-limited like a comms feed',Au.cLp.frequency.value===AUMIX.reverb.rooms.open.crowdLp,Au.cLp.frequency.value);
  ok('each room has its own impulse',Au.irs.open&&Au.irs.pub&&Au.irs.open!==Au.irs.pub);
  const t=A.timers.pop();t.f();ok('the old room is let go once its tail is done',old.f.off&&old.c.off);
  ok('the bed feeds the new room',reach(Au.bed.g,Au.rv.c)&&!Au.bed.g.conns.some(n=>reach(n,old.c)&&!reach(n,Au.rv.c)));
  ctx.activeRoom=CONFIG.rooms.pub;Au.tick(1/60);}
 /* 7. the bed */
 {Au.syn.crowd_bed_calm=buf(A,1);Au.syn.crowd_bed_wild=buf(A,1);Au.bedSync();const B=Au.bed,cl=B.layers.find(l=>l.t==='calm'),wl=B.layers.find(l=>l.t==='wild');
  ok('the stand-in bed has a calm and a wild layer',!!(cl&&wl)&&B.layers.length===2);
  Au.exc=0;ctx.S.balls=[];for(let i=0;i<300;i++){Au.exc=0;Au.tick(1/60);}
  ok('a quiet room is the calm layer',cl.g.gain.value>.95&&wl.g.gain.value<.25,[cl.g.gain.value,wl.g.gain.value]);
  ok('the bed is audible in a match',B.g.gain.value>AUC.volLo*.9,B.g.gain.value);
  for(let i=0;i<120;i++){Au.exc=1;Au.tick(1/60);}
  ok('a big moment is the wild layer',wl.g.gain.value>.95&&cl.g.gain.value<.05,[cl.g.gain.value,wl.g.gain.value]);
  const x=B.x;B.x=.5;Au.exc=.38;Au.bedTick(0);   // hold at the midpoint: equal power, not equal gain
  const e=cl.g.gain.value**2+wl.g.gain.value**2;ok('the crossfade is equal-power',Math.abs(e-1)<.02,e);B.x=x;
  for(let i=0;i<600;i++){Au.exc=0;Au.tick(1/60);}const quiet=B.ten;
  ctx.S.balls=[ball(CONFIG.table.L/2-4,0)];for(let i=0;i<180;i++){Au.exc=0;Au.tick(1/60);}
  ok('a ball in an attacking third builds tension',B.ten>.6&&quiet<.01,[quiet,B.ten]);
  ok('…which the crowd can be heard building on',B.x>AUC.base+.1,B.x);
  ctx.S.phase='menu';for(let i=0;i<120;i++)Au.tick(1/60);ok('no crowd in the menus',B.g.gain.value===0,B.g.gain.value);ctx.S.phase='play';ctx.S.balls=[];}
 /* 7b. the rest of the recorded ids */
 {Au.ctx.currentTime+=5;Au.bank.ball_goal=[buf(A)];const s0=srcs();Au.goalIn(ball(55,0));
  ok('the ball dropping into the goal plays its take, panned',srcs()===s0+1&&path2(A.made.filter(n=>n.kind==='src').pop(),Au.mg,'pan'));
  const s1=srcs();Au.drop(ball(0,0));ok('recorded-only sounds are silent without a file',srcs()===s1);delete Au.bank.ball_goal;}
 }catch(e){fails.push('threw: '+(e.stack||e.message).split('\n').slice(0,3).join(' | '));}
 return{fails,pass};
}

/* ---- static checks: every id the code asks for exists, every sound has a source ------------- */
function staticChecks(){
 const fails=[];let pass=0;const ok=(n,c,x)=>{if(c)pass++;else fails.push(n+(x!==undefined?'  ('+JSON.stringify(x)+')':''));};
 const A=boot(AUDIO),{AUSND,AU_UI,AU_STING,AUREACT,CONFIG}=A;
 const js=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')).map(f=>[f,rd('js/'+f)]);
 for(const [f,s] of js){
  for(const m of s.matchAll(/Au\.ui\('([a-z]+)'\)/g))ok(f+': Au.ui(\''+m[1]+'\') has a sound',!!(AU_UI[m[1]]&&AUSND['ui_'+m[1]]));
  for(const m of s.matchAll(/Au\.goal\('([a-z]+)'\)/g))ok(f+': Au.goal(\''+m[1]+'\') has a stinger',!!(AU_STING[m[1]]&&AUSND['sting_'+m[1]]));
  for(const m of s.matchAll(/Au\.react\('([a-z]+)'/g))ok(f+': Au.react(\''+m[1]+'\') has a crowd sound',!!AUSND['crowd_'+m[1]]);}
 for(const m of AUDIO.matchAll(/this\.play\('([a-z_]+)'[,)]/g))ok('audio.js plays \''+m[1]+'\', a configured sound',!!AUSND[m[1]]);
 for(const id in AUSND){const D=AUSND[id];if(D.syn===false)continue;
  const has=id.startsWith('ui_')?!!AU_UI[id.slice(3)]:id.startsWith('sting_')?!!AU_STING[id.slice(6)]:
   id.startsWith('crowd_bed_')?true:id.startsWith('crowd_')?(!!AUREACT[id.slice(6)]||id==='crowd_applause'):AUDIO.includes("'"+id+"'");
  ok(id+' has a synthesized stand-in (or is marked syn:false)',has);}
 for(const id in AUSND){const b=AUSND[id].bus;ok(id+' is on a real bus',b==='fx'||b==='crowd'||b==='ui',b);
  const g=AUSND[id].gate;if(g)ok(id+' gates on a configured voice cap',!!CONFIG.audioMix.voices[g],g);}
 // the manifest builder
 ok('manifest: take numbers are stripped',MF.idOf('assets/audio/table/ball_kick_02.ogg')==='ball_kick');
 ok('manifest: a single take has no number',MF.idOf('ui_move.wav')==='ui_move');
 ok('manifest: names are case-folded',MF.idOf('Crowd_Roar_1.OGG')==='crowd_roar');
 ok('manifest: a sound is valid',MF.validId('crowd_roar',CONFIG));
 ok('manifest: a ball-type variant is valid',MF.validId('ball_kick_fire',CONFIG));
 ok('manifest: a hard variant is valid',MF.validId('ball_kick_hard',CONFIG));
 ok('manifest: a room impulse is valid',MF.validId('ir_pub',CONFIG));
 ok('manifest: an impulse for no room is not',!MF.validId('ir_garage',CONFIG));
 ok('manifest: a typo is not',!MF.validId('ball_kik',CONFIG)&&!MF.validId('ball_kick_soft',CONFIG));
 {const r=MF.build([path.join(ROOT,'assets/audio/b/ball_kick_02.ogg'),path.join(ROOT,'assets/audio/a/ball_kick_01.ogg'),path.join(ROOT,'assets/audio/oops.ogg')],CONFIG);
  ok('manifest: takes are grouped and sorted',JSON.stringify(r.sounds)==='{"ball_kick":["a/ball_kick_01.ogg","b/ball_kick_02.ogg"]}',r.sounds);
  ok('manifest: an unknown name is reported, not shipped',r.bad.length===1&&r.bad[0]==='oops.ogg',r.bad);}
 return{fails,pass};
}

/* ---- run ------------------------------------------------------------------------------------ */
const base=suite(AUDIO),st=staticChecks();
console.log('\naudio harness');
for(const f of base.fails.concat(st.fails))console.log('  FAIL  '+f);
console.log('  '+(base.pass+st.pass)+' passed, '+(base.fails.length+st.fails.length)+' failed');

function mutate(find,repl,name){
 // line endings in js/ are mixed and git may flip them: an anchor written with \r\n matches either
 if(AUDIO.indexOf(find)<0&&find.includes('\r\n')){find=find.split('\r\n').join('\n');repl=repl.split('\r\n').join('\n');}
 if(AUDIO.indexOf(find)<0)return{name,err:'anchor not found — the mutation has drifted off the source'};
 const m=AUDIO.split(find).join(repl);if(m===AUDIO)return{name,err:'mutant is identical to the source'};
 return{name,src:m};}
const MUTS=[
 mutate('let k=Math.floor(r*(n-1));if(k>=last)k++;return k;','return Math.floor(r*n)%n;','round-robin may repeat a take'),
 mutate('return Math.max(-1,Math.min(1,_auV.x/h));}','return Math.max(-1,Math.min(1,-_auV.x/h));}','pan is mirrored'),
 mutate('k=6.9078/T,','k=3.4539/T,','the impulse decays at half the room\'s rate'),
 mutate('d[i]=lp/Math.sqrt(a/(2-a))*','d[i]=lp*','darkening the tail also shortens it'),
 mutate('if(xf>0){oL=L.slice(0,len);','if(false){oL=L.slice(0,len);','the loop seam is not crossfaded'),
 mutate('a=v.on?4*v.sy*(1-v.sy):0;','a=v.on?1:0;','voices drone instead of speaking in syllables'),
 mutate('y+=yy*FG[q];','y+=x*FG[q];','the vowel filters are bypassed'),
 mutate("this.dst=this.ub;\r\n  for(const n of P)","this.dst=this.mg;\r\n  for(const n of P)",'menu sounds land on the effects bus'),
 mutate('if(D.gate&&o.gate!==false&&!this.vgate(D.gate,buf.duration/rt))return true;','','recorded takes skip the voice gate'),
 mutate("if(key&&key!=='classic'&&this.has(id+'_'+key))use=id+'_'+key;\r\n  else if","if(false);\r\n  else if",'ball-type takes are ignored'),
 mutate('l===lo?Math.cos(u*Math.PI/2):l===hi?Math.sin(u*Math.PI/2):0','l===lo?1-u:l===hi?u:0','the bed crossfade is equal-gain'),
 mutate('clamp(C.base+this.exc+B.ten*C.tension,0,1)','clamp(C.base+this.exc,0,1)','tension never reaches the crowd'),
 mutate("react(kind,at){\r\n  if(!this.ctx||!cfg.ambience)return;","react(kind,at){\r\n  if(!this.ctx)return;",'reactions ignore the crowd switch'),
 mutate('this.cLp.frequency.setTargetAtTime(A.crowdLp||20000,t,.05);','','rooms never band-limit the crowd'),
 mutate('if(pn){n.connect(pn);pn.connect(bus);}else n.connect(bus);','n.connect(bus);','nothing is panned'),
 mutate("if(!this.play('sting_'+k))this.sting(k);","",'no stinger at all'),
 mutate("if(k==='goal'){this.exc=1;","if(k==='goal'){",'a goal does not lift the room'),
 mutate('if(ok)this.exc=Math.min(1,this.exc+(D.exc||0));','','reactions do not lift the room'),
 mutate('B.lvl+=((live?lerp(C.volLo,C.volHi,B.x):0)-B.lvl)','B.lvl+=((lerp(C.volLo,C.volHi,B.x))-B.lvl)','the crowd plays in the menus'),
];
let caught=0;console.log('\nmutations (each must fail something):');
for(const M of MUTS){
 if(M.err){console.log('  DRIFT   '+M.name+' — '+M.err);continue;}
 const r=suite(M.src);if(r.fails.length){caught++;console.log('  caught  '+M.name+'  ('+r.fails.length+' failed)');}
 else console.log('  MISSED  '+M.name);}
console.log('mutations caught: '+caught+'/'+MUTS.length);
process.exit(base.fails.length+st.fails.length===0&&caught===MUTS.length?0:1);
