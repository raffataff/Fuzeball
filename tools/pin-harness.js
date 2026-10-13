// pin harness. node tools/pin-harness.js
// the PIN (CONFIG.shots.pin): finesse + raise poses the men, a slow ball touching a tilted man is caught and carried with the slide outside the contact solver, a kick from it is the pin shot
// slices the real pinUpdate / pinBallStep / pinRelease (physics.js) and shotPinInput / shotPinFire (shots.js) and runs them on live CONFIG with plain-object rods and balls
// every release path is pinned (a ball glued to a rod it should have left is a soft-lock; one slipping out of a pin it should have kept is the bug this replaced)
// the settle: once a ball is held the leg turns onto it until the drawn shin touches (CONFIG.shots.pin.snug: pinSnug / pinSettle / swingA0), and a swing winds up from the pose it was caught in
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var S={time:0,balls:[]};var rods=[];var SHOTC=CONFIG.shots;",
"var KICKS=[];function kickRod(r,style){if(r.kickT>=0)return;if(r.pinB)pinRelease(r);r.kickT=0;r.kickStyle=style||null;KICKS.push({style:style,pow:r.shotPow,on:r.shotOn});}",
"var CAP=null;function shotPullCap(r,a0,a1){return CAP==null?a1:CAP;}",
"function V(x,y,z){return {x:x||0,y:y||0,z:z||0,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(PHYS,SHOTS){
 const real=[slice(PHYS,'function pinUpdate(){','function hitFresh('),
  slice(SHOTS,'function shotPinInput(r,I){','const SHOT_CURVE_KEYS')].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={P:CONFIG.shots.pin,H:CONFIG.shots.hold,BALL_R:BALL_R,ARM:ARM,ROD_H:ROD_H,F:F,S:S,rods:rods,KICKS:KICKS,V:V,pinSettle:pinSettle,swingA0:swingA0,'+
  'setCap:function(v){CAP=v;},pinUpdate:pinUpdate,pinBallStep:pinBallStep,pinRelease:pinRelease,'+
  'shotPinInput:shotPinInput,shotPinFire:shotPinFire};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.P)throw new Error('export line did not run');
 return ctx.X;
}

/* ---- a tiny table ---- */
// -0.6 = a ball the back pin's shin reaches at shots.pin.angle (the boot is at about -4.3, the pin holds it in front of that)
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
const IN=(lt,rz,fin)=>{const o={lt:lt,rz:!!rz};if(fin!=null)o.fin=fin;return o;};
const H=1/120;
function sub(X,b,n){for(let i=0;i<n;i++){X.pinUpdate();if(b.pinR)X.pinBallStep(b,H);}}

function suite(X,quiet){
 const P=X.P;let r,b;
 const mark=()=>pass+fail;

 /* 1. the input: finesse + raise latches the pose, finesse alone does not, letting go clears it */
 r=rod(X);X.shotPinInput(r,IN(1,false));
 ok(r.pinOn&&!r.pinPose,'finesse alone may pin but does not pose');
 X.shotPinInput(r,IN(1,true));ok(r.pinPose,'finesse + raise poses');
 ok(r.pinA===P.angle*r.kickDir,'the pose target is the pin angle (sweep guard permitting)');
 X.shotPinInput(r,IN(1,false));ok(r.pinPose,'the pose is LATCHED: raise can come up again');
 X.shotPinInput(r,IN(0,false));ok(!r.pinOn&&!r.pinPose,'letting finesse go ends the pin and the pose');
 X.shotPinInput(r,IN(X.H.from*0.5,true));ok(!r.pinOn,'finesse under the hold threshold does not count');
 r.chg=0.4;X.shotPinInput(r,IN(1,true));ok(!r.pinOn&&!r.pinPose,'a live wind-up cancels the pin');r.chg=-1;
 // The KEY being down is what counts, not its grip: finesse + raise pressed together land the raise
 // before the keyboard grip has eased past hold.from, and that chord has to pose the pin.
 r=rod(X);X.shotPinInput(r,IN(0,true,true));ok(r.pinOn&&r.pinPose,'finesse DOWN poses with raise even before its grip has eased in');
 r=rod(X);X.shotPinInput(r,IN(1,true,false));ok(!r.pinOn&&!r.pinPose,'…and a finesse that is up does not, whatever the grip reads');
 X.setCap(0);X.shotPinInput(r,IN(1,true));ok(r.pinA===0,'the pose target is the sweep-capped angle, not the raw one');X.setCap(null);

 /* 2. the catch */
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,0.3,-5,0);X.pinUpdate();
 ok(r.pinB===b&&b.pinR===r,'a slow ball touching a posed man is caught');
 ok(b.v.x===0&&b.v.z===0,'…and stops dead on the pin');
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,0.3,-(P.capV+2),0);X.pinUpdate();
 ok(!r.pinB,'a ball quicker than capV is not caught');
 r=rod(X);posed(X,r);b=ball(X,r,P.back-0.5,0,0,0);X.pinUpdate();ok(!r.pinB,'behind the catch window: not caught');
 r=rod(X);posed(X,r);b=ball(X,r,P.front+0.5,0,0,0);X.pinUpdate();ok(!r.pinB,'in front of the catch window: not caught');
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,P.zCatch+0.5,0,0);X.pinUpdate();ok(!r.pinB,'between two men: not caught');
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,0.3,0,0);b.m.position.y=X.BALL_R+P.yTol+0.5;X.pinUpdate();ok(!r.pinB,'a ball in the air is not caught');
 // At the pin angle the boot swings back over the rear of the window, so the part of the window the
 // leg does NOT reach is its front edge: 1.3 in front sits ~3.8 from the shin, clear of the 3.5 reach.
 r=rod(X);posed(X,r);b=ball(X,r,P.front-0.1,0,0,0);X.pinUpdate();ok(!r.pinB,'in the window but not touching the leg: not caught');
 // the forward pin (r.pinFwd): the window runs out to fwdFront and a ball is held only from above, touching the leg
 const fwdPosed=(rr,a)=>{rr.pinOn=true;rr.pinPose=true;rr.pinFwd=true;rr.pinA=a*rr.kickDir;rr.angle=rr.pinA;};
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,3.5,0,0,0);X.pinUpdate();ok(r.pinB===b,'a leg tilted forward holds a ball lying 3.5 ahead, from above');
 r=rod(X);fwdPosed(r,0.9);r.pinFwd=false;b=ball(X,r,3.5,0,0,0);X.pinUpdate();ok(!r.pinB,'...the same pose without the forward flag has the old window: no');
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,P.fwdFront+0.5,0,0,0);X.pinUpdate();ok(!r.pinB,'...past fwdFront is out of the window');
 r=rod(X);fwdPosed(r,0.4);b=ball(X,r,3.5,0,0,0);X.pinUpdate();ok(!r.pinB,'a leg not far enough over the ball hovers short of it: not held');
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,1.75,0,0,0);X.pinUpdate();ok(!r.pinB,'a leg hovering 3.3 off the ball (inside the back pin\'s slop, outside fwdTouch) does not hold it: it must touch');
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,3.5,0,0,0);b.m.position.y=X.BALL_R+P.yTol+0.5;X.pinUpdate();ok(!r.pinB,'...nor a ball in the air');
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,3.5,0.4,0,0);X.pinUpdate();ok(r.pinB===b,'...a ball a little off the man\'s centre is still held');
 {const fb=P.fwdBack;P.fwdBack=3;r=rod(X);fwdPosed(r,0.9);b=ball(X,r,2.5,0,0,0);X.pinUpdate();ok(!r.pinB,'...a ball nearer than fwdBack is out of the forward window');P.fwdBack=fb;}
 {const bk=P.back;P.back=3;r=rod(X);fwdPosed(r,0.9);b=ball(X,r,2.5,0,0,0);X.pinUpdate();ok(r.pinB===b,'...and the back pin\'s rear edge does not cut it: the two are separate');P.back=bk;}
 r=rod(X);fwdPosed(r,0.9);b=ball(X,r,3.5,P.zCatch-0.1,0,0);X.pinUpdate();ok(!r.pinB,'...but one near the edge of the man is touched on its side, and is not');
 r=rod(X);r.pinOn=true;r.angle=0;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(!r.pinB,'finesse with the men down (no pose, no tilt) does not pin — that is the hold');
 r=rod(X);r.pinOn=false;r.angle=P.angle;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(!r.pinB,'a tilted rod without finesse does not pin');
 r=rod(X);r.pinOn=true;r.pinPose=false;r.angle=P.angle;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(r.pinB===b,'a stick-tilted rod inside the band pins without the pose (the pad path)');
 r=rod(X);posed(X,r);r.angle=r.pinA+P.capA*2;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(!r.pinB,'still easing into the pose: not caught yet');
 r=rod(X);posed(X,r);r.removedUntil[1]=99;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();ok(!r.pinB,'a man blown off by a cannonball cannot pin');
 r=rod(X,1);posed(X,r);b=ball(X,r,-0.6,0.3,5,0);X.pinUpdate();ok(r.pinB===b,'blue (kickDir -1) catches the mirrored ball');

 /* 3. the carry */
 r=rod(X);posed(X,r);b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();
 const x0=b.m.position.x,dz=b.m.position.z-r.offset;
 r.vz=30;for(let i=0;i<24;i++){r.offset+=30*H;X.pinUpdate();X.pinBallStep(b,H);}
 ok(r.pinB===b,'a sliding rod keeps its ball');
 ok(Math.abs(b.m.position.x-x0)<1e-9,'the pinned ball holds its place along the table');
 ok(Math.abs(b.m.position.z-r.offset-dz)<1e-9,'…and moves with the man across it');
 ok(Math.abs(b.v.z-30)<1e-6,'…at the rod\'s slide speed');

 /* 4. every way it lets go */
 const pinned=()=>{r=rod(X);posed(X,r);b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();r.vz=0;return r.pinB===b;};
 pinned();r.vz=20;r.offset+=20*H;X.pinBallStep(b,H);r.pinOn=false;X.pinUpdate();
 ok(!r.pinB&&!b.pinR,'finesse let go: released');
 ok(Math.abs(b.v.z-20*P.carryOut)<1e-6,'…keeping carryOut of the slide');
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
 ok(!r.pinB&&!b.pinR,'…and the swing lets the ball go so it can strike it');
 ok(!r.pinPose,'…and the pose ends');


 /* 6. the settle: the leg turns onto the ball it caught */
 const N=P.snug,dd=(rr,bb,a)=>{const u=(bb.m.position.x-rr.x)*rr.kickDir,wy=bb.m.position.y-X.ROD_H;return u*Math.cos(a)+wy*Math.sin(a);};   // the ball's distance off the leg axis at rod-local angle a, + in front
 const was={on:N.on,front:N.front,rear:N.rear,toe:N.toe,toeFrom:N.toeFrom,toeTo:N.toeTo,max:N.max,t:N.t,hand:N.hand};
 const restore=()=>Object.assign(N,was);
 const catchFront=(tm,rel)=>{r=rod(X,tm);posed(X,r);b=ball(X,r,rel,0.3,0,0);X.pinUpdate();return r.pinB===b;};
 // in front of the back pin: the leg comes forward onto it, the ball stays where it was caught
 {const x0=ball(X,rod(X),-0.6,0.3,0,0).m.position.x;X.S.balls.length=0;
  ok(catchFront(0,-0.6)&&r.sgA!=null,'a ball caught in front of the back pin starts the settle');
  ok(Math.abs(b.m.position.x-x0)<1e-9,'...and stays exactly where it was caught: every depth read from it stands');
  ok(r.sgE>r.sgB&&r.sgB===P.angle,'...the leg turns forward, off the pose it was caught in ('+(r.sgB||0).toFixed(2)+' to '+(r.sgE||0).toFixed(2)+')');
  ok(Math.abs(dd(r,b,r.sgE)-N.front)<0.04,'...to where the drawn shin touches it ('+dd(r,b,r.sgE).toFixed(2)+' off the axis, front '+N.front+')');
  ok(r.pinAt===r.sgA,'...and the release angle is measured from the settled pose');
  ok(r.sgA===r.sgE*r.kickDir,'...the pose it is driven to is the same angle in rod terms');
  ok(Math.abs(r.sgE-r.sgB)<=N.max+1e-9,'...by no more than snug.max');
 }
 ok(catchFront(1,-0.6)&&r.sgA>0,'blue (kickDir -1) settles the mirrored way');
 {const t0=catchFront(0,-0.6)?r.sgA:null;catchFront(1,-0.6);ok(t0!=null&&Math.abs(r.sgA+t0)<1e-9,'...by exactly the mirrored angle');}
 // behind a forward leg (a receive): the leg turns back toward it
 r=rod(X);r.pinOn=true;r.pinPose=true;r.pinA=0.4;r.angle=0.4;b=ball(X,r,-0.8,0.3,0,0);X.pinUpdate();
 ok(r.pinB===b&&r.sgE<r.sgB,'a ball caught behind the leg turns it back toward the ball ('+(r.sgB||0).toFixed(2)+' to '+(r.sgE||0).toFixed(2)+')');
 ok(r.pinB===b&&Math.abs(dd(r,b,r.sgE)+N.rear)<0.04,'...to the rear distance ('+(r.pinB?dd(r,b,r.sgE):0).toFixed(2)+', rear -'+N.rear+')');
 // under a forward leg: it comes down onto the ball
 r=rod(X);fwdPosed(r,1.1);b=ball(X,r,3.4,0,0,0);X.pinUpdate();
 ok(r.pinB===b&&r.sgE<1.1&&1.1-r.sgE<=N.max+1e-9,'a ball held under the forward leg lowers it onto the ball ('+(r.sgE||0).toFixed(2)+' from 1.1)');
 ok(r.pinB===b&&Math.abs(dd(r,b,r.sgE)+N.rear)<0.04,'...to the rear distance');
 // the boot flares: a ball held far enough down the leg stays further out
 {N.toeFrom=4.0;N.toeTo=4.2;N.toe=3.1;ok(catchFront(0,-0.6)&&Math.abs(dd(r,b,r.sgE)-3.1)<0.04,'down the leg the settle stops at the toe distance, not the shin\'s ('+(r.pinB?dd(r,b,r.sgE):0).toFixed(2)+')');restore();}
 // the settle is bounded and switchable, and never pulls a ball that is already as close
 {N.max=0.04;ok(catchFront(0,-0.6)&&Math.abs(r.sgE-r.sgB)<=0.04+1e-9&&Math.abs(r.sgE-r.sgB)>0.03,'snug.max caps how far the leg turns');restore();}
 {N.front=4;ok(catchFront(0,-0.6)&&r.sgA==null&&r.pinAt===r.pinA,'a ball already inside the settled distance leaves the pose alone');restore();}
 {N.on=false;ok(catchFront(0,-0.6)&&r.sgA==null&&r.pinAt===r.pinA,'snug.on false: the leg stays where it caught');restore();}
 // a stick-driven pin (no latched pose) is the player's own angle: never settled
 r=rod(X);r.pinOn=true;r.pinPose=false;r.angle=P.angle;b=ball(X,r,-0.6,0.3,0,0);X.pinUpdate();
 ok(r.pinB===b&&r.sgA==null,'a pad stick pin keeps the stick\'s angle: nothing settles it');
 // driving it
 catchFront(0,-0.6);const sg=r.sgA;
 X.pinSettle(r);ok(r.pinA===sg&&r.sgA===sg,'the pose follows the settle while the hold is the human\'s frozen one');
 X.pinSettle(r);ok(r.pinA===sg&&r.sgA===sg&&Math.abs(r.angle-sg)>N.hand,'...and keeps following it while the leg is still more than snug.hand short of it');
 r.angle=sg;X.pinSettle(r);ok(r.sgA==null&&r.pinA===sg,'...and it ends on arrival, leaving the pose where it got to');
 catchFront(0,-0.6);r.pinA=r.angle;X.pinSettle(r);ok(r.pinA===r.sgA,'a hold that writes the angle it is at (the AI\'s) is followed too');
 catchFront(0,-0.6);r.pinA=r.angle+0.5;X.pinSettle(r);ok(r.sgA==null&&r.pinA===r.angle+0.5,'a pose asked for further off (the forward lift, a re-pose) ends the settle and is left alone');
 catchFront(0,-0.6);X.S.time=r.sgT+0.01;X.pinSettle(r);ok(r.sgA==null,'the settle gives up after snug.t');X.S.time=0;
 catchFront(0,-0.6);r.pinB=null;X.pinSettle(r);ok(r.sgA==null,'...and when the ball is gone');
 // a swing winds up from the pose the ball was caught in
 catchFront(0,-0.6);r.angle=r.sgA;
 ok(Math.abs(X.swingA0(r)-r.sgB)<1e-9,'a swing from the settled leg winds up from the pose the ball was caught in ('+X.swingA0(r).toFixed(2)+')');
 r.angle=r.sgA+0.3;ok(Math.abs(X.swingA0(r)-r.angle)<1e-9,'...but not if the leg has been moved off the settle');
 catchFront(0,-0.6);r.pinB=null;r.angle=r.sgA;ok(Math.abs(X.swingA0(r)-r.angle)<1e-9,'...nor with no ball held');
 catchFront(1,-0.6);r.angle=r.sgA;ok(Math.abs(X.swingA0(r)-r.sgB)<1e-9&&r.sgB<0,'...in rod terms, for blue too');
 // every way it lets go ends the settle
 catchFront(0,-0.6);r.pinOn=false;X.pinUpdate();ok(!r.pinB&&r.sgA==null&&r.sgB==null,'a released ball takes the settle with it');

 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const PHYS=rd('js/physics.js'),SHOTS=rd('js/shots.js');
const base=suite(boot(PHYS,SHOTS),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['physics','if(P.snug&&P.snug.on&&r.pinPose&&r.pinA!=null)pinSnug(r,b);','','a held ball is never settled onto'],
 ['physics','if(P.snug&&P.snug.on&&r.pinPose&&r.pinA!=null)pinSnug(r,b);','if(P.snug&&P.snug.on)pinSnug(r,b);','a stick-driven pin is settled too'],
 ['physics','if(P.snug&&P.snug.on&&r.pinPose&&r.pinA!=null)pinSnug(r,b);','if(r.pinPose&&r.pinA!=null)pinSnug(r,b);','snug.on is ignored'],
 ['physics','const side=f(a0)>=0?1:-1;','const side=1;','a ball behind the leg is settled as if in front'],
 ['physics','?-dA:dA;   // the way that closes on it','?dA:-dA;   // the way that closes on it','the leg turns away from the ball'],
 ['physics','lerp(N.front,N.toe,','lerp(N.front,N.front,','the boot does not flare'],
 ['physics',':N.rear;',':N.front;','the rear distance is the front one'],
 ['physics','k<N.max/dA&&','k<N.max/dA*9&&','snug.max does not cap the turn'],
 ['physics','r.sgT=S.time+N.t;r.pinAt=r.sgA;','r.sgT=S.time+N.t;','the release angle is measured from the old pose'],
 ['physics','r.sgB=a0;r.sgE=a;','r.sgB=null;r.sgE=a;','a swing winds up from where the leg is'],
 ['physics','!(Math.abs(r.pinA-r.sgA)<0.002||Math.abs(r.pinA-r.angle)<N.hand)','false','a lift asked for mid-settle is overridden'],
 ['physics','!(Math.abs(r.pinA-r.sgA)<0.002||Math.abs(r.pinA-r.angle)<N.hand)','!(Math.abs(r.pinA-r.angle)<N.hand)','the human\'s frozen pose is taken for somebody else\'s'],
 ['physics','S.time>r.sgT||','','the settle never gives up'],
 ['physics','if(!r.pinB||S.time>r.sgT','if(S.time>r.sgT','the settle outlives the ball'],
 ['physics',' r.pinA=r.sgA;\n if(Math.abs(r.angle-r.sgA)',' if(Math.abs(r.angle-r.sgA)','the pose is not driven to the settle'],
 ['physics','if(Math.abs(r.angle-r.sgA)<0.01)r.sgA=null;','','the settle never completes'],
 ['physics','const b=r.pinB;r.pinB=null;r.sgA=null;r.sgB=null;','const b=r.pinB;r.pinB=null;','a released ball leaves the settle behind'],
 ['physics','&&Math.abs(a-r.sgE)<0.06)?r.sgB:a;','&&true)?r.sgB:a;','a leg moved off the settle still winds up from the old pose'],
 ['physics','if(Math.hypot(b.v.x,b.v.z-r.vz)>P.capV)continue;','','a ball at any speed is caught'],
 ['physics','if(rel<back||rel>front||p.y>BALL_R+P.yTol)continue;','if(rel<back||rel>front)continue;','a ball in the air is caught'],
 ['physics','const back=fwd?P.fwdBack:P.back;','const back=P.back;','the forward window has the back pin\'s rear edge'],
 ['physics','const back=fwd?P.fwdBack:P.back;','const back=fwd?-99:P.back;','the forward window has no rear edge'],
 ['physics','if(d2>reach*reach||(fwd&&-ny<P.fwdDown*Math.sqrt(d2)))continue;','','a ball not touching the leg is caught'],
 ['physics','if(d2>reach*reach||(fwd&&-ny<P.fwdDown*Math.sqrt(d2)))continue;','if(d2>reach*reach)continue;','a forward leg holds a ball touched on its side'],
 ['physics','reach=BALL_R+PRAD+(fwd?P.fwdTouch:P.touch),front=fwd?P.fwdFront:P.front;','reach=BALL_R+PRAD+P.touch,front=fwd?P.fwdFront:P.front;','a forward leg hovers over a ball and still holds it'],
 ['physics','reach=BALL_R+PRAD+(fwd?P.fwdTouch:P.touch),front=fwd?P.fwdFront:P.front;','reach=BALL_R+PRAD+(fwd?P.fwdTouch:P.touch),front=P.front;','the forward window is the back pin\'s'],
 ['physics',':(la>=P.band[0]&&la<=P.band[1]);',':true;','any rod angle pins without the pose'],
 ['physics','if(!r.pinOn||r.kickT>=0||pb.scored','if(r.kickT>=0||pb.scored','letting finesse go keeps the ball'],
 ['physics','||Math.abs(r.angle-r.pinAt)>P.releaseA)','||false)','a stick flick drags the ball round with it'],
 ['physics','if(Math.abs(v.x-b.pinVx)+Math.abs(v.z-b.pinVz)+Math.abs(v.y)>P.breakV){pinRelease(r,true);return false;}','','another ball cannot knock it loose'],
 ['physics','if(Math.abs(p.x-b.pinPx)+Math.abs(p.z-b.pinPz)>1){pinRelease(r,true);return false;}','','a re-dropped ball is yanked back to the rod'],
 ['physics','if(Math.abs(cz-tz)>P.zSlip){pinRelease(r);return false;}','','a ball squeezed into the wall stays pinned'],
 ['physics','if(!ext){b.v.x=0;b.v.y=0;b.v.z*=SHOT.pin.carryOut;}','if(!ext){b.v.set(0,0,0);}','a released ball forgets the slide'],
 ['physics','v.set((tx-p.x)/h,0,(cz-p.z)/h);','v.set(0,0,0);','a carried ball reports no velocity'],
 ['shots','r.pinOn=fin&&r.chg<0&&r.kickT<0;','r.pinOn=fin&&r.kickT<0;','a wind-up and a pin at once'],
 ['shots',' const fin=(I.fin!=null)?I.fin:I.lt>SHOTC.hold.from;',' const fin=I.lt>SHOTC.hold.from;','the pin waits for the finesse grip to ease in'],
 ['shots',' if(!r.pinOn){if(r.pinPose&&r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;}',' if(!r.pinOn){r.pinFwd=false;}','the pose outlives the finesse'],
 ['shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB)r.pinFwd=false;}',' else r.pinPose=!!I.rz;','the pose drops the moment raise comes up'],
 ['shots',' kickRod(r,\'trapShot\');',' kickRod(r,null);','the pin shot is a plain kick'],
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
