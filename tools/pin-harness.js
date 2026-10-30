// pin harness. node tools/pin-harness.js
// the PIN (CONFIG.shots.pin): finesse + raise poses the men, a slow ball under a man's foot (touching the foot box from above) is caught and carried with the slide outside the contact solver, a kick from it is the pin shot
// slices the real pinUpdate / pinBallStep / pinRelease (physics.js) and shotPinInput / shotPinFire (shots.js) and runs them on live CONFIG with plain-object rods and balls
// every release path is pinned (a ball glued to a rod it should have left is a soft-lock; one slipping out of a pin it should have kept is the bug this replaced)
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var S={time:0,balls:[]};var rods=[];var SHOTC=CONFIG.shots;function isUserRod(r){return !!r.user;}",
"var KICKS=[];function kickRod(r,style,aim,curve){if(r.kickT>=0)return;if(r.pinB)pinRelease(r);r.kickT=0;r.kickStyle=style||null;KICKS.push({style:style,pow:r.shotPow,on:r.shotOn,curve:curve||null});}",
"var CAP=null;function shotPullCap(r,a0,a1){return CAP==null?a1:CAP;}",
"function V(x,y,z){return {x:x||0,y:y||0,z:z||0,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(PHYS,SHOTS){
 const real=[slice(PHYS,'function pinUpdate(){','function hitFresh('),
  slice(SHOTS,'function shotPinInput(r,I,dt){','const SHOT_CURVE_KEYS')].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={AIC:AIC,P:CONFIG.shots.pin,H:CONFIG.shots.hold,BALL_R:BALL_R,ARM:ARM,ROD_H:ROD_H,F:F,S:S,rods:rods,KICKS:KICKS,V:V,footBoxD:footBoxD,footUnder:footUnder,FOOT_BOX:FOOT_BOX,'+
  'setCap:function(v){CAP=v;},pinUpdate:pinUpdate,pinBallStep:pinBallStep,pinRelease:pinRelease,'+
  'shotPinInput:shotPinInput,shotPinFire:shotPinFire};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.P)throw new Error('export line did not run');
 return ctx.X;
}

/* ---- a tiny table ---- */
function rod(X,team){
 const r={x:team?-22.5:22.5,kickDir:team?-1:1,team:team||0,angle:0,vz:0,offset:0,baseZ:[-18.5,0,18.5],
  removedUntil:[0,0,0],kickT:-1,chg:-1,pinOn:false,pinPose:false,pinA:null,pinB:null,shotOn:false,shotPow:1,shotCtl:1};
 X.rods.length=0;X.rods.push(r);return r;
}
function ball(X,r,rel,dz,vx,vz){
 const b={m:{position:X.V(r.x+rel*r.kickDir,X.BALL_R,r.baseZ[1]+r.offset+(dz||0))},v:X.V(vx||0,0,vz||0),spin:0,scored:false};
 X.S.balls.length=0;X.S.balls.push(b);return b;
}
// posed: finesse held, pose latched, rod at the pin angle
function posed(X,r){r.pinOn=true;r.pinPose=true;r.pinA=X.P.angle*r.kickDir;r.angle=r.pinA;}
// where a ball on the floor touches the foot of a leg at rod-local angle a: the rel the foot box first reaches, scanning out from the rod (a ball rolled in from that side stops there) (null = nowhere)
function footRel(X,a,fwd){
 const r={x:0,kickDir:1,angle:a},p={x:0,y:X.BALL_R,z:0},dn=[0];
 for(let i=0;i<=700;i++){p.x=(fwd?1:-1)*i*0.01;if(X.footBoxD(r,p,0,dn)<=X.BALL_R+0.01)return +p.x.toFixed(2);}
 return null;
}
const IN=(lt,rz,fin)=>{const o={lt:lt,rz:!!rz};if(fin!=null)o.fin=fin;return o;};
const H=1/120;
function sub(X,b,n){for(let i=0;i<n;i++){X.pinUpdate();if(b.pinR)X.pinBallStep(b,H);}}

function suite(X,quiet){
 const P=X.P;let r,b;
 const mark=()=>pass+fail;

 /* 1. the input: finesse + raise poses, finesse alone does not, letting go clears it */
 r=rod(X);X.shotPinInput(r,IN(1,false));
 ok(r.pinOn&&!r.pinPose,'finesse alone may pin but does not pose');
 X.shotPinInput(r,IN(1,true));ok(r.pinPose,'finesse + raise poses');
 ok(r.pinA===P.angle*r.kickDir,'the pose target is the pin angle (sweep guard permitting)');
 X.shotPinInput(r,IN(1,false));ok(r.pinOn&&!r.pinPose,'raise up, finesse held: the pose ends (pin.latch false)');
 P.latch=true;X.shotPinInput(r,IN(1,true));X.shotPinInput(r,IN(1,false));ok(r.pinPose,'latch on: raise can come up again');P.latch=false;
 X.shotPinInput(r,IN(0,false));ok(!r.pinOn&&!r.pinPose,'letting finesse go ends the pin and the pose');
 X.shotPinInput(r,IN(X.H.from*0.5,true));ok(!r.pinOn,'finesse under the hold threshold does not count');
 r.chg=0.4;X.shotPinInput(r,IN(1,true));ok(!r.pinOn&&!r.pinPose,'a live wind-up cancels the pin');r.chg=-1;
 // The KEY being down is what counts, not its grip: finesse + raise pressed together land the raise
 // before the keyboard grip has eased past hold.from, and that chord has to pose the pin.
 r=rod(X);X.shotPinInput(r,IN(0,true,true));ok(r.pinOn&&r.pinPose,'finesse DOWN poses with raise even before its grip has eased in');
 r=rod(X);X.shotPinInput(r,IN(1,true,false));ok(!r.pinOn&&!r.pinPose,'…and a finesse that is up does not, whatever the grip reads');
 X.setCap(0);X.shotPinInput(r,IN(1,true));ok(r.pinA===0,'the pose target is the sweep-capped angle, not the raw one');X.setCap(null);

 /* 2. the catch: the ball has to be under the foot */
 const U=footRel(X,P.angle,false),F9=footRel(X,0.9,true);   // where the posed back foot and a forward leg at 0.9 come down on a ball on the floor
 ok(U!=null&&U<-2&&U>P.back,'the back pin\'s foot reaches the floor behind the rod, inside the window ('+U+')');
 ok(F9!=null&&F9>P.fwdBack&&F9<P.fwdFront,'a forward leg at 0.9 reaches it ahead of the rod, inside the forward window ('+F9+')');
 r=rod(X);posed(X,r);b=ball(X,r,U,0.3,-5,0);X.pinUpdate();
 ok(r.pinB===b&&b.pinR===r,'a slow ball under the posed foot is caught');
 ok(b.v.x===0&&b.v.z===0,'…and stops dead on the pin');
 ok(Math.abs(b.pinDz-0.3)<1e-9,'…held where it lies across the foot: nothing pulls it onto the man');
 r=rod(X);posed(X,r);b=ball(X,r,U,0.3,-(P.capV+2),0);X.pinUpdate();
 ok(!r.pinB,'a ball quicker than capV is not caught');
 // a player's back foot takes a ball rolling along the row up to assist.roll.capV (a roll from the next man)
 {const W=P.assist.roll,v=P.capV+2;
  r=rod(X);r.user=true;posed(X,r);b=ball(X,r,U,0.3,0,-v);X.pinUpdate();ok(r.pinB===b,'a player\'s back foot takes a ball rolling along the row quicker than capV');
  r=rod(X);posed(X,r);b=ball(X,r,U,0.3,0,-v);X.pinUpdate();ok(!r.pinB,'...an AI rod does not (it cushions)');
  r=rod(X);r.user=true;posed(X,r);b=ball(X,r,U,0.3,0,-(W.capV+2));X.pinUpdate();ok(!r.pinB,'...nor quicker than roll.capV');
  r=rod(X);r.user=true;posed(X,r);b=ball(X,r,U,0.3,W.maxVX+1,-P.capV);X.pinUpdate();ok(!r.pinB,'...nor one crossing the row quicker than capV');
  W.on=false;r=rod(X);r.user=true;posed(X,r);b=ball(X,r,U,0.3,0,-v);X.pinUpdate();W.on=true;ok(!r.pinB,'roll.on false: capV for a player too');}
 r=rod(X);posed(X,r);b=ball(X,r,U+0.5,0,0,0);X.pinUpdate();ok(!r.pinB,'a ball just short of the foot is not caught: no reach beyond the boot');
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,0,0,0);X.pinUpdate();ok(!r.pinB,'a ball under the rod, against the shin, is not caught');
 {const a=-0.75;r=rod(X);r.pinOn=true;r.pinPose=true;r.pinA=a;r.angle=a;const u=footRel(X,a,false);b=ball(X,r,u==null?-0.7:u,0,0,0);X.pinUpdate();
  ok(u!=null&&!r.pinB,'a leg too upright meets the ball with the top of the boot box, from the side: not a pin ('+u+')');}
 r=rod(X);posed(X,r);b=ball(X,r,U,X.FOOT_BOX.z+X.BALL_R*0.7,0,0);X.pinUpdate();ok(!r.pinB,'a ball against the side of the foot is not caught');
 r=rod(X);posed(X,r);b=ball(X,r,U,X.FOOT_BOX.z+0.3,0,0);X.pinUpdate();ok(!r.pinB,'a ball under the edge of the boot, its centre past the foot, is not caught: it has to be under the sole');
 r=rod(X);posed(X,r);b=ball(X,r,U,X.FOOT_BOX.z-0.1,0,0);X.pinUpdate();ok(r.pinB===b,'...one just inside the foot\'s width is');
 r=rod(X);posed(X,r);b=ball(X,r,U,X.FOOT_BOX.z+X.BALL_R+0.5,0,0);X.pinUpdate();ok(!r.pinB,'between two men: not caught');
 r=rod(X);posed(X,r);b=ball(X,r,U,0.3,0,0);b.m.position.y=X.BALL_R+P.yTol+0.5;X.pinUpdate();ok(!r.pinB,'a ball in the air is not caught');
 {const bk=P.back;P.back=U+0.5;r=rod(X);posed(X,r);b=ball(X,r,U,0,0,0);X.pinUpdate();ok(!r.pinB,'behind the catch window: not caught');P.back=bk;}
 // the forward pin: a leg leaning forward has the forward window and holds a ball under its foot
 const fwdPosed=(rr,a)=>{rr.pinOn=true;rr.pinPose=true;rr.pinFwd=true;rr.pinA=a*rr.kickDir;rr.angle=rr.pinA;};
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(r.pinB===b,'a leg leaning forward holds a ball under its foot ahead of the rod');
 r=rod(X);fwdPosed(r,0.9);r.pinFwd=false;b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(r.pinB===b,'...the window is the lean\'s, not a flag\'s');
 r=rod(X);r.user=true;fwdPosed(r,0.9);b=ball(X,r,F9,0,0,-(P.capV+2));X.pinUpdate();ok(!r.pinB,'a player\'s forward foot keeps capV for a ball rolling along the row');
 {const ff=P.fwdFront;P.fwdFront=F9-0.5;r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(!r.pinB,'...past fwdFront is out of the window');P.fwdFront=ff;}
 {const fb=P.fwdBack;P.fwdBack=F9+0.5;r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(!r.pinB,'...nearer than fwdBack is out of it');P.fwdBack=fb;}
 {const bk=P.back;P.back=3;r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(r.pinB===b,'...and the back pin\'s rear edge does not cut it: the two are separate');P.back=bk;}
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9-0.6,0,0,0);X.pinUpdate();ok(!r.pinB,'a ball just short of the forward foot is not held: the foot must be on it');
 {const u=footRel(X,0.4,true);r=rod(X);fwdPosed(r,0.4);b=ball(X,r,u==null?1:u,0,0,0);X.pinUpdate();ok(!r.pinB,'a leg leaning forward a little meets the ball with its ankle: no');}
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);b.m.position.y=X.BALL_R+P.yTol+0.5;X.pinUpdate();ok(!r.pinB,'...nor a ball in the air');
 r=rod(X);r.pinOn=true;r.angle=0;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(!r.pinB,'finesse with the men down (no pose, no tilt) does not pin — that is the hold');
 r=rod(X);r.pinOn=false;r.angle=P.angle;b=ball(X,r,U,0.3,0,0);X.pinUpdate();ok(!r.pinB,'a tilted rod without finesse does not pin');
 r=rod(X);r.pinOn=true;r.pinPose=false;r.angle=P.angle;b=ball(X,r,U,0.3,0,0);X.pinUpdate();ok(r.pinB===b,'a stick-tilted rod inside the band pins without the pose (the pad path)');
 r=rod(X);r.pinOn=true;r.pinPose=false;r.angle=0.9;b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(!r.pinB,'...a stick leaning forward, outside the band, does not (the forward pin is the pose)');
 r=rod(X);posed(X,r);r.angle=r.pinA+P.capA*2;b=ball(X,r,U,0.3,0,0);X.pinUpdate();ok(!r.pinB,'still easing into the pose: not caught yet');
 r=rod(X);posed(X,r);r.removedUntil[1]=99;b=ball(X,r,U,0.3,0,0);X.pinUpdate();ok(!r.pinB,'a man blown off by a cannonball cannot pin');
 r=rod(X,1);posed(X,r);b=ball(X,r,U,0.3,5,0);X.pinUpdate();ok(r.pinB===b,'blue (kickDir -1) catches the mirrored ball');
 r=rod(X,1);fwdPosed(r,0.9);b=ball(X,r,F9,0,0,0);X.pinUpdate();ok(r.pinB===b,'...and holds the mirrored forward pin');

 /* 3. the carry */
 r=rod(X);posed(X,r);b=ball(X,r,U,0.3,0,0);X.pinUpdate();
 const x0=b.m.position.x,dz=b.m.position.z-r.offset;
 r.vz=30;for(let i=0;i<24;i++){r.offset+=30*H;X.pinUpdate();X.pinBallStep(b,H);}
 ok(r.pinB===b,'a sliding rod keeps its ball');
 ok(Math.abs(b.m.position.x-x0)<1e-9,'the pinned ball holds its place along the table');
 ok(Math.abs(b.m.position.z-r.offset-dz)<1e-9,'…and moves with the man across it');
 ok(Math.abs(b.v.z-30)<1e-6,'…at the rod\'s slide speed');

 /* 4. every way it lets go */
 const pinned=()=>{r=rod(X);posed(X,r);b=ball(X,r,U,0.3,0,0);X.pinUpdate();r.vz=0;return r.pinB===b;};
 pinned();r.vz=20;r.offset+=20*H;X.pinBallStep(b,H);r.pinOn=false;X.pinUpdate();
 ok(!r.pinB&&!b.pinR,'finesse let go: released');
 ok(Math.abs(b.v.z-20*P.carryOut)<1e-6,'…keeping carryOut of the slide');
 // a mouse or pad moves a player's rod once a frame, so at 60 fps it slides on one sim step of two: the ball keeps the slide of the last four steps, not of the last one
 pinned();r.user=true;r.vzH=[40,0,40,0];r.vz=0;X.pinBallStep(b,H);r.pinOn=false;X.pinUpdate();
 ok(Math.abs(b.v.z-20*P.carryOut)<1e-6,'a player\'s rod that moved on one step of two lets go at its average slide');
 pinned();r.vzH=[40,0,40,0];r.vz=20;r.offset+=20*H;X.pinBallStep(b,H);r.pinOn=false;X.pinUpdate();
 ok(Math.abs(b.v.z-20*P.carryOut)<1e-6,'…an AI rod at its last step\'s, as before');
 pinned();r.user=true;r.vz=20;r.offset+=20*H;X.pinBallStep(b,H);r.pinOn=false;X.pinUpdate();
 ok(Math.abs(b.v.z-20*P.carryOut)<1e-6,'…and a player\'s rod with no history yet at its last step\'s');
 pinned();r.kickT=0;X.pinUpdate();ok(!r.pinB,'a swing in flight releases it');
 pinned();r.angle+=P.releaseA*1.5;X.pinUpdate();ok(!r.pinB,'the rod turned off the pin (a stick flick) releases it');
 pinned();r.angle+=P.releaseA*0.5;X.pinUpdate();ok(r.pinB===b,'…but a small wobble does not');
 pinned();X.pinBallStep(b,H);b.v.x+=P.breakV+5;ok(!X.pinBallStep(b,H)&&!b.pinR,'another ball knocking it hard breaks the pin');
 ok(b.v.x>P.breakV,'…and it keeps the knock');
 pinned();X.pinBallStep(b,H);b.v.x+=P.breakV*0.3;ok(X.pinBallStep(b,H)&&b.pinR===r,'a light brush does not');
 pinned();X.pinBallStep(b,H);b.m.position.x+=6;ok(!X.pinBallStep(b,H)&&!b.pinR,'a hard set (re-drop) releases it rather than yanking it back');
 pinned();b.scored=true;X.pinUpdate();ok(!r.pinB,'a scored ball is released');
 pinned();X.S.balls.length=0;X.pinUpdate();ok(!r.pinB,'a ball gone from play is released');
 pinned();r.offset=(X.F.W/2)-X.BALL_R+P.zSlip+1;ok(!X.pinBallStep(b,H)&&!b.pinR,'pressed into a side wall it slips out');
 pinned();r.offset=(X.F.W/2)-X.BALL_R-0.1;ok(X.pinBallStep(b,H)&&b.pinR===r,'…but carried up to the wall it holds');

 /* 5. the pin shot */
 X.KICKS.length=0;pinned();X.shotPinFire(r);
 const k=X.KICKS[0];
 ok(k&&k.style==='trapShot','a kick from the pin swings the trap-shot curve');
 ok(k&&k.on&&k.pow===P.pow,'…armed with the pin shot\'s power');
 ok(r.shotCtl===P.ctl,'…and its control');
 ok(k&&k.curve&&k.curve.strike===P.swing.strike&&k.curve.powTo===P.swing.powTo&&k.curve.strikeA===X.AIC.trapShot.strikeA,'…on the pin swing: the trapShot curve with shots.pin.swing over it');
 ok(!r.pinB&&!b.pinR,'…and the swing lets the ball go so it can strike it');
 ok(!r.pinPose,'…and the pose ends');


 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const PHYS=rd('js/physics.js'),SHOTS=rd('js/shots.js');
const base=suite(boot(PHYS,SHOTS),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['physics','if(Math.hypot(b.v.x,b.v.z-r.vz)>(W&&!fwd&&Math.abs(b.v.x)<=W.maxVX&&isUserRod(r)?Math.max(P.capV,W.capV):P.capV))continue;','','a ball at any speed is caught'],
 ['physics','&&isUserRod(r)?Math.max(P.capV,W.capV)','?Math.max(P.capV,W.capV)','an AI rod takes a quick rolling ball'],
 ['physics','(W&&!fwd&&Math.abs(b.v.x)','(W&&Math.abs(b.v.x)','a forward foot takes a quick rolling ball'],
 ['physics','&&Math.abs(b.v.x)<=W.maxVX&&isUserRod','&&isUserRod','a ball crossing the row is taken quicker'],
 ['physics','?Math.max(P.capV,W.capV):P.capV','?1e9:P.capV','no ceiling on a rolling ball'],
 ['physics','&&P.assist.roll.on?P.assist.roll:null','?P.assist.roll:null','roll.on false is ignored'],
 ['physics','if(rel<back||rel>front||p.y>BALL_R+P.yTol)continue;','if(rel<back||rel>front)continue;','a ball in the air is caught'],
 ['physics','const fwd=la>0,back=fwd?P.fwdBack:P.back,front=fwd?P.fwdFront:P.front;','const fwd=la>0,back=P.back,front=fwd?P.fwdFront:P.front;','the forward window has the back pin\'s rear edge'],
 ['physics','const fwd=la>0,back=fwd?P.fwdBack:P.back,front=fwd?P.fwdFront:P.front;','const fwd=la>0,back=fwd?-99:P.back,front=fwd?P.fwdFront:P.front;','the forward window has no rear edge'],
 ['physics','const fwd=la>0,back=fwd?P.fwdBack:P.back,front=fwd?P.fwdFront:P.front;','const fwd=la>0,back=fwd?P.fwdBack:P.back,front=P.front;','the forward window is the back pin\'s'],
 ['physics','const fwd=la>0,back=fwd?P.fwdBack:P.back,front=fwd?P.fwdFront:P.front;','const fwd=!!r.pinFwd,back=fwd?P.fwdBack:P.back,front=fwd?P.fwdFront:P.front;','the window follows the flag, not the lean'],
 ['physics','    if(!footUnder(r,p,mz))continue;\n','','any ball in the window is caught'],
 ['physics','&&PIN_DN[0]>=P.down&&',' &&','a shin or the side of the foot holds a ball'],
 ['physics','&&PIN_DN[1]===0;',';','a ball under the edge of the boot, past the foot, is held'],
 ['physics','return pass?Object.assign(PIN_PS,AIC.passShot,SHOT.pin.pass):Object.assign(PIN_SW,AIC.trapShot,SHOT.pin.swing);','return pass?Object.assign(PIN_PS,AIC.passShot,SHOT.pin.pass):Object.assign(PIN_SW,AIC.trapShot);','the pin shot swings the plain trapShot curve'],
 ['physics','d<=BALL_R*FOOT_BOX_REACH+P.touch&&','d<=BALL_R*FOOT_BOX_REACH+P.touch+0.6&&','the foot holds a ball it is only near'],
 ['physics','dn[0]=d>1e-4?(cdx*ca-cdy*sa)/d:0;','dn[0]=d>1e-4?(cdx*ca+cdy*sa)/d:0;','down is measured the wrong way round'],
 ['physics','b.pinDz=p.z-mz;','b.pinDz=0;','a held ball is pulled onto the man\'s centre'],
 ['physics',':(la>=P.band[0]&&la<=P.band[1]);',':true;','any rod angle pins without the pose'],
 ['physics','if(!r.pinOn||r.kickT>=0||pb.scored','if(r.kickT>=0||pb.scored','letting finesse go keeps the ball'],
 ['physics','||Math.abs(r.angle-r.pinAt)>P.releaseA)','||false)','a stick flick drags the ball round with it'],
 ['physics','if(Math.abs(v.x-b.pinVx)+Math.abs(v.z-b.pinVz)+Math.abs(v.y)>P.breakV){pinRelease(r,true);return false;}','','another ball cannot knock it loose'],
 ['physics','if(Math.abs(p.x-b.pinPx)+Math.abs(p.z-b.pinPz)>1){pinRelease(r,true);return false;}','','a re-dropped ball is yanked back to the rod'],
 ['physics','if(Math.abs(cz-tz)>P.zSlip){pinRelease(r);return false;}','','a ball squeezed into the wall stays pinned'],
 ['physics','if(!ext){const H=r.vzH;b.v.x=0;b.v.y=0;b.v.z=(H&&isUserRod(r)?(H[0]+H[1]+H[2]+H[3])/4:b.v.z)*(k!=null?k:SHOT.pin.carryOut);}','if(!ext){b.v.set(0,0,0);}','a released ball forgets the slide'],
 ['physics','b.v.z=(H&&isUserRod(r)?','b.v.z=(false?','a player\'s release keeps only the last step\'s slide'],
 ['physics','v.set((tx-p.x)/h,0,(cz-p.z)/h);','v.set(0,0,0);','a carried ball reports no velocity'],
 ['shots','r.pinOn=fin&&r.chg<0&&r.kickT<0;','r.pinOn=fin&&r.kickT<0;','a wind-up and a pin at once'],
 ['shots',' const fin=(I.fin!=null)?I.fin:I.lt>SHOTC.hold.from;',' const fin=I.lt>SHOTC.hold.from;','the pin waits for the finesse grip to ease in'],
 ['shots',' if(!r.pinOn){if(r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.fwdStk=0;}',' if(!r.pinOn){r.pinFwd=false;}','the pose outlives the finesse'],
 ['shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB){r.pinFwd=false;r.fwdStk=0;}}',' else r.pinPose=!!I.rz;','the pose drops the moment raise comes up'],
 ['shots',' kickRod(r,\'trapShot\',null,pinSwing());',' kickRod(r,null,null,pinSwing());','the pin shot is a plain kick'],
 ['shots',' kickRod(r,\'trapShot\',null,pinSwing());',' kickRod(r,\'trapShot\');','the pin shot is not given the pin swing'],
 ['shots',' r.shotOn=true;r.shotPow=P.pow;r.shotCtl=P.ctl;r.shotExert=1;',' ','the pin shot is unarmed']
];
let caught=0;
for(const [file,find,repl,name] of muts){
 const src=file==='physics'?PHYS:SHOTS;
 if(src.indexOf(find)<0){console.log('  BROKEN  '+name+' — anchor not found');continue;}
 const m=src.replace(find,repl);
 if(m===src){console.log('  BROKEN  '+name+' — no-op');continue;}
 pass=0;fail=0;fails.length=0;
 let f;try{f=suite(boot(file==='physics'?m:PHYS,file==='shots'?m:SHOTS),true);}catch(e){f=1;}
 if(f>0){caught++;console.log('  caught  ('+f+' assertions)  '+name);}
 else console.log('  SURVIVED  '+name);
}
console.log('mutations caught: '+caught+'/'+muts.length);
process.exitCode=(base>0||caught<muts.length)?1:0;
