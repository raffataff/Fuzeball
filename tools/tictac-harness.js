// tic-tac harness. node tools/tictac-harness.js
// slices the real collideRod + sideBounce (physics.js), pinUpdate / pinBallStep, holdCfg and shotHoldUpdate and runs them on live CONFIG
// question: does a ball tapped along a rod behave like a ball (a down man bounces it back, a raised man lets it through, a raised-back man lets it roll under and pin it) while the front touch, the tap's strength, a swing and the player's hold stay as they were; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const PH=rd('js/physics.js'),RO=rd('js/rods.js'),SH=rd('js/shots.js'),ST=rd('js/stats.js');
const parts={
 phys:slice(PH,'function collideRod(b,r){','function ballBall('),
 cap:slice(PH,'function capSpeed(b,r,sweet,in2){',NL+'function collideRod('),
 pin:slice(PH,'function pinUpdate(){','function hitFresh('),
 rods:[slice(RO,'function styleCfg(',NL+'function kickStyleCfg'),slice(RO,'function kickStyleCfg(r){',NL+'function passFaceOK('),slice(RO,'function holdCfg(r){',NL+'function kickRod(')].join(NL),
 shots:[slice(SH,'function shotsOn(){',NL+'function shotTrigD('),slice(SH,'function shotHoldUpdate(r,lt){',NL+'const SHOT_CURVE_KEYS')].join(NL),
 stats:[slice(ST,'function stHit(r){',NL),slice(ST,'function stGrip(r){',NL),slice(ST,'function stCapFrac(r){',NL)].join(NL)
};
const stubs=[
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[],lastTouch:-1,teamStats:null,shake:0};var rods=[];",
"var dbgLogRod=null;","var RNG={jit:function(){return 0.5;}};","var Au={kick:function(){}};",
"function aimAssist(){} function wallAssist(){} function passFaceOK(){return true;} function shotSpray(){}",
"function shotConsume(r){if(r.shotOn){r.shotOn=false;r.shotPow=1;r.shotCtl=1;}}",
"function momContact(){} function msContact(){} function dbgHit(){} function isUserRod(){return true;}",
"function makeBall(){return null;} function syncBall(){} function notice(){}",
"function V(x,y,z){return {x:x||0,y:y||0,z:z||0,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}",
"var SHOTC=CONFIG.shots;","var STC=CONFIG.stats;","function ST(r,k){return STC.base;}",
"function stFat(){return 1;} function stAccFrac(){return 0;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 // values leave through an explicit export: config.js's aliases are lexical consts
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.stats,g.cap,g.rods,g.shots,g.phys,g.pin,
  ';globalThis.X={CONFIG:CONFIG,KICK:KICK,SHOT:SHOT,BALL_TYPES:BALL_TYPES,S:S,rods:rods,V:V,pinUpdate:pinUpdate,pinBallStep:pinBallStep,collideRod:collideRod,shotHoldUpdate:shotHoldUpdate};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.CONFIG)throw new Error('export line did not run');
 return ctx.X;
}

const HZ=120,SUB=8,H=1/(HZ*SUB);
function mkRod(X,baseZ,over){
 const K=X.KICK;
 return Object.assign({idx:0,x:0,team:0,role:'ATT',baseZ:baseZ,removedUntil:baseZ.map(()=>0),offset:0,maxOff:20,trnHidden:false,
  angle:0,angVel:0,vz:0,kickT:-1,kickStyle:null,kickCurve:null,kickDir:1,cd:0,aiIQ:false,aimSweet:-1,
  kickHit:false,msSw:false,tcSpin:0,chg:-1,shotOn:false,shotPow:1,shotCtl:1,passTo:null,act:null,
  pinOn:false,pinPose:false,pinA:null,pinB:null,
  hold:{on:false,holdRest:K.rest,holdGrip:K.grip,carryMult:1,sideRest:K.sideRest},stats:null},over||{});
}
function mkBall(X,x,z,vx,vz,type){return {m:{position:X.V(x,X.CONFIG.physics.ballR,z)},v:X.V(vx||0,0,vz||0),t:X.BALL_TYPES[type||'classic'],spin:0,didSplit:false,scored:false};}
// one sim frame: the rod's pose walks to (off, ang) across the substeps, the ball rolls with floor friction and meets the rod every substep (what physics.js does)
function frame(X,rod,ball,off,ang,st){
 const P=X.CONFIG.physics;
 rod.vz=(off-st.o)*HZ;rod.angVel=(ang-st.a)*HZ;st.o=off;st.a=ang;
 for(let s=0;s<SUB;s++){
  const f=(s+1)/SUB;rod.offset=off-rod.vz/HZ*(1-f);rod.angle=ang-rod.angVel/HZ*(1-f);
  const p=ball.m.position,fr=st.nofr?1:Math.exp(-P.floorFric*H);
  p.x+=ball.v.x*H;p.z+=ball.v.z*H;ball.v.x*=fr;ball.v.z*=fr;
  X.collideRod(ball,rod);
 }
 rod.offset=off;rod.angle=ang;
}
const smooth=(t,t0,t1,a,b)=>t<=t0?a:t>=t1?b:a+(b-a)*(t-t0)/(t1-t0);

/* ---- the scenes ---- */
// a ball rolling along the rod into the side of a stationary man; speed it comes back out with (negative = still pushing in)
function sideHit(X,v,o){
 o=o||{};const P=X.CONFIG.physics,sg=o.sign||1,r=mkRod(X,[0],o.rod);
 const b=mkBall(X,0,-sg*(P.footBox.z+P.ballR+6),0,sg*v,o.type);
 if(o.hold!=null)X.shotHoldUpdate(r,o.hold);
 const st={o:0,a:r.angle,nofr:true};let hit=-1;
 for(let i=0;i<2*HZ;i++){frame(X,r,b,0,r.angle,st);if(hit<0&&Math.abs(b.v.z-sg*v)>1e-6)hit=i;if(hit>=0&&i>hit+Math.round(0.3*HZ))break;}
 return -sg*b.v.z;
}
// a ball rolling toward the FRONT face of a stationary down man
function frontHit(X,v){
 const r=mkRod(X,[0]),b=mkBall(X,6,0,-v,0);const st={o:0,a:0,nofr:true};let hit=-1;
 for(let i=0;i<2*HZ;i++){frame(X,r,b,0,0,st);if(hit<0&&Math.abs(b.v.x+v)>1e-6)hit=i;if(hit>=0&&i>hit+Math.round(0.3*HZ))break;}
 return b.v.x;
}
// a man sliding toward a ball: the peak speed it leaves with
function slideAt(X,boot,ballV,o){
 o=o||{};const P=X.CONFIG.physics,r=mkRod(X,[0]);
 const gap=P.footBox.z+P.ballR+0.3,b=mkBall(X,0,gap+(o.chase?3:0),0,o.chase?ballV:-ballV);
 const st={o:0,a:0,nofr:true};let pk=-1e9;
 for(let i=0;i<Math.round(0.5*HZ);i++){frame(X,r,b,Math.min(14,boot*i/HZ),0,st);pk=Math.max(pk,b.v.z);}
 return pk;
}
// the same ball crossing a man held at a fixed rod angle: where it ends up
function cross(X,angle,v){
 const r=mkRod(X,[0],{angle:angle}),b=mkBall(X,0,-9,0,v),st={o:0,a:angle};
 for(let i=0;i<Math.round(1.5*HZ);i++)frame(X,r,b,0,angle,st);
 return b.m.position.z;
}
// a rod raised back, a ball rolling along it at rel; the pin pose goes on when the ball is dzOn before the man
function raisedPin(X,v,dzOn,rel){
 const PIN=X.SHOT.pin,r=mkRod(X,[0],{angle:-1.3});X.rods.length=0;X.rods.push(r);
 const b=mkBall(X,rel,-14,0,v);X.S.balls.length=0;X.S.balls.push(b);
 let on=false,ang=r.angle,st={o:0,a:ang};
 for(let i=0;i<Math.round(6*HZ);i++){
  if(!on&&b.m.position.z>=-dzOn){on=true;r.pinOn=true;r.pinPose=true;r.pinA=PIN.angle;}
  if(on&&!r.pinB)ang=ang+(r.pinA-ang)*Math.min(1,PIN.lerp/HZ);
  r.vz=0;r.angVel=(ang-st.a)*HZ;st.a=ang;r.angle=ang;
  X.pinUpdate();
  if(b.pinR)return 'pinned';
  for(let s=0;s<SUB;s++){
   if(b.pinR)break;
   const p=b.m.position,fr=Math.exp(-X.CONFIG.physics.floorFric*H);p.x+=b.v.x*H;p.z+=b.v.z*H;b.v.x*=fr;b.v.z*=fr;
   X.collideRod(b,r);
  }
 }
 return b.m.position.z>4?'through':'held up';
}
// the rel (ahead of the rod) where a stationary ball is still caught at the pin pose, found from live CONFIG so a retune of the pin angle cannot strand the test
function pinFront(X){
 const PIN=X.SHOT.pin;let best=null;
 for(let rel=-6;rel<=2;rel+=0.05){
  const r=mkRod(X,[0],{pinOn:true,pinPose:true,pinA:PIN.angle,angle:PIN.angle});X.rods.length=0;X.rods.push(r);
  const b=mkBall(X,rel,0.3,0,0);X.S.balls.length=0;X.S.balls.push(b);X.pinUpdate();if(r.pinB)best=rel;
 }
 return best;
}
// two men of one rod, a tap from the first, the rod then still: where does the ball go
function pingPong(X){
 const sp=X.CONFIG.rods.spacing.other,P=X.CONFIG.physics,r=mkRod(X,[-sp/2,sp/2]);
 const b=mkBall(X,0,-sp/2+P.footBox.z+P.ballR+0.3,0,0),st={o:0,a:0};
 let mx=-1e9,back=0,zmin=1e9,zmax=-1e9;
 for(let i=0;i<Math.round(3*HZ);i++){
  const t=i/HZ;frame(X,r,b,smooth(t,0.02,0.08,0,5),0,st);
  const z=b.m.position.z;if(t>0.1){zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);}
  mx=Math.max(mx,z);back=Math.max(back,mx-z);
 }
 return {back:back,vz:b.v.z,zA:-sp/2+5,zB:sp/2+5,zmin:zmin,zmax:zmax};
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const K=X.KICK,KS=K.sideRest,KRest=K.rest,HC=X.CONFIG.shots.hold,PIN=X.SHOT.pin;
 const at=(sr,f)=>{K.sideRest=sr;try{return f();}finally{K.sideRest=KS;}};
 const near=(a,b,t)=>Math.abs(a-b)<=t;

 // ---- the bounce ----
 const o10=sideHit(X,10),o25=sideHit(X,25),o45=sideHit(X,45);
 ok('a ball hitting a down man\'s side comes BACK (about sideRest of its speed, less the grip)',[o10,o25,o45].every((o,i)=>{const v=[10,25,45][i];return o>0.3*v*KS&&o<=KS*v;}),o10.toFixed(1)+' / '+o25.toFixed(1)+' / '+o45.toFixed(1));
 ok('...harder in, harder out',o10<o25&&o25<o45);
 const dead=at(KRest,()=>sideHit(X,45));
 ok('sideRest = rest is the old dead stop (the knob goes all the way back)',dead<0.05*45,dead.toFixed(2));
 ok('the other side of the man bounces the same (-z and +z)',near(sideHit(X,25,{sign:-1}),o25,1e-6));
 ok('a heavy ball (fire, 1.5) still plows into the side as before: mass scales this like every contact',sideHit(X,25,{type:'fire'})<0.2*o25,'fire '+sideHit(X,25,{type:'fire'}).toFixed(1)+' vs '+o25.toFixed(1));

 // ---- everything that must not move ----
 const f0=at(0,()=>frontHit(X,30)),f1=frontHit(X,30);
 ok('the FRONT touch is untouched (a pass into a down man still dies)',f1===f0&&Math.abs(f1)<3,'vx '+f1.toFixed(2)+' vs '+f0.toFixed(2));
 ok('a tap is no stronger: a man sliding into a loose ball hands it the same speed',near(at(0,()=>slideAt(X,80,0)),slideAt(X,80,0),1e-9),slideAt(X,80,0).toFixed(1)+' u/s');
 ok('a man chasing a ball that is already leaving pushes it as before',near(at(0,()=>slideAt(X,80,10,{chase:true})),slideAt(X,80,10,{chase:true}),1e-9));
 ok('a swing is exempt (its own restitution is already higher)',near(at(0,()=>sideHit(X,25,{rod:{kickT:0.03}})),sideHit(X,25,{rod:{kickT:0.03}}),1e-9));

 // ---- the player's hold cushions ----
 ok('finesse held full cushions a side hit dead',sideHit(X,45,{hold:1})<0.05*45,sideHit(X,45,{hold:1}).toFixed(2));
 ok('at the very start of the squeeze it is exactly the free bounce (no step)',near(sideHit(X,45,{hold:HC.from+1e-9}),o45,1e-6),sideHit(X,45,{hold:HC.from+1e-9}).toFixed(2)+' vs '+o45.toFixed(2));
 const half=sideHit(X,45,{hold:(HC.from+1)/2});
 ok('half a squeeze is in between',half>sideHit(X,45,{hold:1})&&half<o45,half.toFixed(1));
 ok('the AI\'s dribble and trap holds stay dead',sideHit(X,45,{rod:{act:'dribble'}})<0.05*45&&sideHit(X,45,{rod:{act:'trap'}})<0.05*45);

 // ---- the moves ----
 const tapAlone=slideAt(X,80,0);
 const tb=slideAt(X,80,25);
 ok('a tap BACK is the rebound plus the slide: harder than either alone',tb>tapAlone&&tb>o25,tb.toFixed(1)+' vs tap '+tapAlone.toFixed(1)+', bounce '+o25.toFixed(1));
 const pp=pingPong(X);
 ok('tapped toward the next man along the rod, the ball bounces back off it (the gap closes to ~5 after the tap)',pp.back>3,'came back '+pp.back.toFixed(1)+'u');
 ok('...and stays between the two men',pp.zmin>pp.zA-1&&pp.zmax<pp.zB+1,'z '+pp.zmin.toFixed(1)+'..'+pp.zmax.toFixed(1)+' in '+pp.zA.toFixed(1)+'..'+pp.zB.toFixed(1));
 const dn=cross(X,0,30),up=cross(X,-1.3,30);
 ok('a DOWN man bounces a ball that rolls into him',dn<-2,'z '+dn.toFixed(1));
 ok('a RAISED man lets it roll through',up>4,'z '+up.toFixed(1));
 const rel=pinFront(X);
 ok('there is a pin window to test in',rel!=null,'rel '+(rel==null?rel:rel.toFixed(2)));
 const t=rel!=null?rel-0.1:-0.6;
 ok('raised back, the ball rolls under and the pin pose drops onto it',raisedPin(X,PIN.capV*0.55,5,t)==='pinned');
 ok('...up to the pin\'s own speed limit',raisedPin(X,PIN.capV*0.9,5,t)==='pinned');
 ok('...a faster ball rolls on through',raisedPin(X,PIN.capV*1.6,5,t)==='through');
 ok('...and a pose that comes down too late is no catch',raisedPin(X,PIN.capV*0.9,0.3,t)!=='pinned');
 return R;
}

let bad=0;
const X0=boot(null),res=suite(X0);
console.log(NL+'=== tic-tac: a ball along the rod ===');
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info?'   ['+t.info+']':''));}
console.log(NL+'  '+(res.length-bad)+' passed, '+bad+' failed'+NL);

console.log('=== mutations: each must break an assertion ===');
const MUT=[
 {n:'the side bounce is gone',part:'phys',from:'if(Math.abs(nz)<KICK.sideDot)return 0;',to:'return 0;'},
 {n:'every face bounces (the gate is open)',part:'phys',from:'if(Math.abs(nz)<KICK.sideDot)return 0;',to:'if(false)return 0;'},
 {n:'only the +z face bounces',part:'phys',from:'Math.abs(nz)<KICK.sideDot',to:'nz<KICK.sideDot'},
 {n:'the player\'s hold ignores the side bounce',part:'phys',from:'(HLD?(HLD.sideRest||0):KICK.sideRest)',to:'KICK.sideRest'},
 {n:'the AI\'s holds bounce too',part:'phys',from:'(HLD.sideRest||0)',to:'KICK.sideRest'},
 {n:'the bounce stacks on a swing\'s own restitution',part:'phys',from:':KICK.sideRest)-rest,bn=',to:':KICK.sideRest),bn='},
 {n:'the bounce ignores the ball\'s mass',part:'phys',from:'-e*bn/b.t.mass:0',to:'-e*bn:0'},
 {n:'a ball leaving the face is slowed by it',part:'phys',from:'(e>0&&bn<0)',to:'(e>0)'},
 {n:'the squeeze never cushions a side hit',part:'shots',from:'h.sideRest=lerp(KICK.sideRest,0,t);',to:'h.sideRest=KICK.sideRest;'},
 {n:'the squeeze cushions it all at once',part:'shots',from:'h.sideRest=lerp(KICK.sideRest,0,t);',to:'h.sideRest=0;'}
];
let missed=0;
for(const m of MUT){
 let caught=false,detail='';
 try{const r=suite(boot(m));caught=r.some(t=>!t.ok);if(caught)detail=r.filter(t=>!t.ok).length+' assertions';}
 catch(e){detail='THREW '+e.message;missed++;}
 if(!caught&&!detail.startsWith('THREW')){missed++;detail='NOT CAUGHT';}
 console.log('  '+(caught?'caught ':'MISSED ')+' ('+(detail||'-')+')  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length+NL);
process.exit(bad||missed?1:0);
