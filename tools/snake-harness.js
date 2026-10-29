// snake harness. node tools/snake-harness.js
// the SNAKE (CONFIG.shots.snake): the man rolls over the top of the rod from the forward pin and strikes the ball from behind
// slices the real snakeStep / kickStyleCfg (rods.js), snakeLoft / capSpeed (physics.js) and lerpAng (core.js) and runs them on live CONFIG with plain-object rods and balls
// pins the turn (one wrap, continuous for angVel and the substeps, a full turn plus the follow-through, back at rest), the low launch and the speed ceiling; the trigger is binds-harness's (section 8b)
// every mutation at the bottom must break an assertion; a drifted anchor throws
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};
const RODS=rd('js/rods.js'),PHYS=rd('js/physics.js');
const parts={
 core:rd('js/core.js'),
 style:slice(RODS,'function styleCfg(style){','// was a contact a real front-face strike'),
 step:slice(RODS,'function snakeStep(r,dt){',NL+'function updateRods('),
 cap:slice(PHYS,'function capSpeed(b,r,sweet,in2){',NL+'// a snake leaves low'),
 loft:slice(PHYS,'function snakeLoft(b){',NL+'function collideRod(')
};
const stubs=[
 "var S={time:0,eff:[{boost:-1},{boost:-1}]};var DISARMED=0;function shotDisarm(r){DISARMED++;r.shotOn=false;}",
 "function stCapFrac(r){return 0;}"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:()=>null}};
 ctx.globalThis=ctx;
 vm.runInNewContext([g.core,rd('js/config.js'),stubs,g.style,g.step,g.cap,g.loft,
  ';globalThis.X={K:CONFIG.shots.snake,P:CONFIG.shots.pin,KICK:KICK,BT:BALL_TYPES,S:S,snakeStep:snakeStep,snakeLoft:snakeLoft,capSpeed:capSpeed,lerpAng:lerpAng,disarmed:function(){return DISARMED;}};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.K)throw new Error('export line did not run');
 return ctx.X;
}

const H=1/120,PI2=2*Math.PI;
// a rod posed forward at a0 and the snake fired: steps snakeStep the way updateRods does (angVel from prevAngle, then prevAngle = angle) and returns the trace
function spin(X,a0,dir){
 const r={kickDir:dir,angle:a0*dir,prevAngle:a0*dir,kickT:0,kickStyle:'snake',kickCurve:X.K,kickA0:a0,shotOn:true,heldFwd:true};
 const T=[];let u=a0,n=0;
 while(r.kickT>=0&&n<1000){
  X.snakeStep(r,H);
  const w=(r.angle-r.prevAngle)/H;   // updateRods: r.angVel
  u+=w*H*dir;
  T.push({t:n*H+H,ang:r.angle,w,u,kT:r.kickT,hf:r.heldFwd});
  r.prevAngle=r.angle;n++;
 }
 return {r,T};
}

function suite(X){
 const K=X.K;
 /* 1. the turn */
 for(const dir of [1,-1])for(const a0 of [X.P.fwd.angle,1.1]){
  const tag=' (dir '+dir+', from '+a0+')',{r,T}=spin(X,a0,dir);
  const inRange=T.every(s=>Math.abs(s.ang)<=Math.PI+1e-9);
  ok(inRange,'the angle stays within ±π through the whole turn'+tag);
  const wraps=T.filter((s,i)=>i>0&&Math.abs(s.ang-T[i-1].ang)>Math.PI).length;
  ok(wraps===1,'the turn shows as exactly one wrap'+tag+' ('+wraps+')');
  const maxDu=Math.max(...T.map((s,i)=>Math.abs(s.u-(i?T[i-1].u:a0))));
  ok(maxDu<0.5,'angVel reads the wrap as continuous: no step turns more than 0.5 rad'+tag+' ('+maxDu.toFixed(3)+')');
  const sp=T.filter(s=>s.t<=K.spin+1e-9);
  ok(sp.every(s=>s.w*dir>0),'the spin only turns forward'+tag);
  const top=Math.max(...T.map(s=>s.u));
  ok(Math.abs(top-(PI2+K.strikeA))<1e-6,'a full turn and the follow-through: the leg turns '+(PI2+K.strikeA-a0).toFixed(3)+' rad from the pose'+tag+' (top '+top.toFixed(4)+')');
  const atBottom=T.find(s=>s.u>=PI2);
  ok(atBottom&&atBottom.t<=K.spin+1e-9,'the foot is through the bottom, where it meets the ball, inside the spin'+tag);
  const wB=atBottom?atBottom.w*dir:0;
  ok(wB>10&&wB<40,'...turning at a striking speed there, not a scoop ('+wB.toFixed(1)+' rad/s)'+tag);
  const end=T[T.length-1];
  ok(r.kickT===-1&&r.kickStyle===null&&r.kickCurve===null&&r.angle===0,'the swing ends at rest, the style cleared'+tag);
  ok(Math.abs(end.t-(K.spin+K.follow+K.back))<2*H,'...after spin + follow + back ('+end.t.toFixed(3)+' s)'+tag);
  ok(Math.abs(end.u-PI2)<1e-6,'...one whole turn on from where it started counting, i.e. upright'+tag);
  ok(T.every(s=>!s.hf),'the snake never freezes the swing forward'+tag);
 }
 {const A=spin(X,0.95,1).T,B=spin(X,0.95,-1).T;
  ok(A.length===B.length&&A.every((s,i)=>Math.abs(s.ang+B[i].ang)<1e-12),'blue\'s snake is red\'s mirrored');}
 {const d0=X.disarmed();spin(X,1,1);ok(X.disarmed()===d0+1,'an uncontacted snake spends its arming when it ends');}

 /* 2. drawing across the wrap */
 ok(Math.abs(Math.abs(X.lerpAng(3.0,-3.0,0.5))-Math.PI)<1e-9,'lerpAng goes the short way across the top (3.0 to -3.0 passes π)');
 ok(Math.abs(X.lerpAng(0.2,0.6,0.5)-0.4)<1e-12&&Math.abs(X.lerpAng(-1.1,1.1,0.25)+0.55)<1e-12,'...and is a plain lerp for any turn under π');

 /* 3. the launch */
 {const b={v:{x:100,y:60,z:12}},sp0=Math.hypot(100,60,12);X.snakeLoft(b);
  const h=Math.hypot(b.v.x,b.v.z),a=Math.atan2(b.v.y,h);
  ok(Math.abs(a-K.loft)<1e-9,'a climb over snake.loft is turned down to it ('+(a*57.3).toFixed(2)+' deg)');
  ok(Math.abs(Math.hypot(b.v.x,b.v.y,b.v.z)-sp0)<1e-9,'...without losing speed');
  ok(Math.abs(b.v.z/b.v.x-0.12)<1e-12,'...or changing its heading');}
 {const b={v:{x:100,y:5,z:3}};X.snakeLoft(b);ok(b.v.x===100&&b.v.y===5&&b.v.z===3,'a ball under the loft is left alone');}
 {const b={v:{x:100,y:-30,z:0}};X.snakeLoft(b);ok(b.v.y===-30&&b.v.x===100,'...and one going down');}
 {const L=K.loft;K.loft=null;const b={v:{x:100,y:60,z:0}};X.snakeLoft(b);K.loft=L;ok(b.v.y===60,'loft null: the raw contact');}

 /* 4. the speed ceiling */
 {const MV=X.BT.classic.maxV,C=X.KICK.cap,t={maxV:MV};
  const run=(style)=>{const b={v:{x:600,y:0,z:0},t};X.capSpeed(b,{team:0,kickStyle:style,shotOn:false,shotPow:1,kickT:0.2,swOver:0},false,0);return b.v.x;};
  const pl=run(null),sn=run('snake');
  ok(C.snake>0&&sn>pl+MV*C.snake*0.5,'every contact of a snake has the higher ceiling ('+pl.toFixed(1)+' -> '+sn.toFixed(1)+')');
  ok(sn<MV*C.max+1e-9,'...and never past cap.max');
  const c0=C.snake;C.snake=0;const z=run('snake');C.snake=c0;ok(Math.abs(z-pl)<1e-9,'cap.snake 0: the plain ceiling');}
}

suite(boot());
const base={pass,fail,fails:fails.slice()};
console.log('snake: '+base.pass+' passed, '+base.fail+' failed');
for(const f of base.fails)console.log('  FAIL '+f);

const MUTS=[
 {part:'step',from:'if((r.angle-r.prevAngle)*r.kickDir<-Math.PI)r.prevAngle-=2*Math.PI*r.kickDir;',to:'',name:'the wrap is not carried into prevAngle (angVel spikes)'},
 {part:'step',from:' if(a>Math.PI)a-=2*Math.PI;',to:'',name:'the angle runs past π'},
 {part:'step',from:'a1=2*Math.PI+KS.strikeA',to:'a1=Math.PI+KS.strikeA',name:'half a turn'},
 {part:'step',from:' else if(T<t2)a=a1+(2*Math.PI-a1)*((T-t1)/KS.back);',to:' else if(T<t2)a=a1;',name:'the leg never eases back'},
 {part:'step',from:'else{a=0;r.kickT=-1;r.kickStyle=null;r.kickCurve=null;shotDisarm(r);}',to:'else{a=0;r.kickT=-1;r.kickCurve=null;shotDisarm(r);}',name:'the style outlives the swing'},
 {part:'step',from:' r.heldFwd=false;',to:'',name:'a held kick can freeze the snake'},
 {part:'step',from:'Math.pow(T/KS.spin,KS.ease)',to:'Math.pow(T/KS.spin,KS.ease*3)',name:'the spin arrives at a scoop'},
 {part:'loft',from:'v.y=sp*Math.sin(L);',to:'v.y=0;',name:'the loft flattens the ball and loses speed'},
 {part:'loft',from:'if(L==null||h<1e-6||v.y<=h*Math.tan(L))return;',to:'if(L==null||h<1e-6)return;',name:'a low ball is raised to the loft'},
 {part:'loft',from:'const sp=Math.hypot(h,v.y),k=sp*Math.cos(L)/h;',to:'const sp=Math.hypot(h,v.y),k=1;',name:'the climb is cut, not turned'},
 {part:'cap',from:' if(r.kickStyle===\'snake\')f+=C.snake||0;',to:'',name:'no ceiling for the snake'},
 {part:'core',from:'if(d>Math.PI)d-=2*Math.PI;else if(d<-Math.PI)d+=2*Math.PI;',to:'',name:'lerpAng goes the long way round'}
];
let caught=0;const missed=[];
for(const m of MUTS){
 pass=0;fail=0;fails.length=0;
 try{suite(boot(m));}catch(e){if(/no-op/.test(e.message))throw e;fail++;}
 if(fail>base.fail)caught++;else missed.push(m.name);
}
console.log('mutations: '+caught+' of '+MUTS.length+' caught');
for(const n of missed)console.log('  MISSED '+n);
process.exit(base.fail||missed.length?1:0);
