// recv harness. node tools/recv-harness.js
// slices the real receiver action (recvArm / recvBall / recvStart / recvStep / recvEnd, ai.js) with catchMan and the catch block it sits in, and runs them against live CONFIG with the world stubbed
// pins: who a pass arms (the rod it is aimed at, on the passer's team, never the passer), when the action starts, the pose and the man (the forward pin angle for either team, the man on the ball's line, waiting where the pass was aimed until it is struck),
// and every way it ends (pinned: handed to the catch's hold; taken; through; the flight is over; no man can reach), and the ready state before the pass (a holder looking at passing arms the mates it could pass to: the pose up and a man on the lane,
// held while it keeps looking; what counts as ready; a real pass takes over); every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js'),SE=rd('js/seats.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 inlane:slice(AI,'function inLaneZ(r,lz,cz){',NL+'// the teammate behind us'),
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:'),
 seat:slice(SE,'function clearRodAI(r){',NL+'function setSeatCtrl')
};
const stubs=[
 "var S={balls:[],time:0,lastTouch:0}; var rods=[];",
 "function pinRelease(r){r.pinB=null;}",
 "function rodInputRelease(){} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';} function isUserRod(r){return !!r.human;}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.inlane,g.catch,g.seat,
  ';globalThis.X={S:S,AIC:AIC,F:F,BALL_R:BALL_R,rods:rods,CAS:CAS,CAW:CAW,DIFFS:DIFFS,recvReady:recvReady,recvPossess:recvPossess,recvReadyNow:recvReadyNow,recvArm:recvArm,recvBall:recvBall,recvStart:recvStart,recvStep:recvStep,recvEnd:recvEnd,recvRelease:recvRelease,gkHold:gkHold,clearRodAI:clearRodAI,SHOT_capV:SHOT.pin.capV,SHOT_back:SHOT.pin.back,SHOT_front:SHOT.pin.front,SHOT_fwdBack:SHOT.pin.fwdBack,SHOT_fwdFront:SHOT.pin.fwdFront};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D={cd:1};
// the passer (red DEF, x -37.5) and its mate rod (red MID, x -7.5, five men) 30 ahead; a blue rod at x 7.5 (looking the other way) for the other team's side of things
function world(X,opt){
 opt=opt||{};
 X.S.time=1;X.S.balls=[];X.S.lastTouch=0;
 const from={x:-37.5,team:0,kickDir:1,role:'DEF',baseZ:[-18,0,18],maxOff:18,removedUntil:[],offset:0,act:null,kickT:-1,pinB:null};
 const r={x:-7.5,team:0,kickDir:1,role:opt.role||'MID',baseZ:[-24,-12,0,12,24],maxOff:6.2,removedUntil:[],offset:opt.off||0,target:0,slideV:0,vz:0,angle:0,
  act:null,kickT:-1,pinB:null,pinOn:false,pinPose:false,pinA:null,force:false,catPh:null,catT:0,rvUntil:0,aiMan:-1,raise:true,behindFlag:true,actT:0};
 const blue={x:7.5,team:1,kickDir:-1,role:'MID',baseZ:[-24,-12,0,12,24],maxOff:6.2,removedUntil:[],offset:0,target:0,slideV:0,angle:0,act:null,kickT:-1,pinB:null,pinOn:false,pinPose:false,pinA:null,force:false,rvUntil:0,aiMan:-1,actT:0};
 X.rods.length=0;X.rods.push(from,r,blue);
 return {from,r,blue};
}
const AIC_PS=X=>X.AIC.dribble.pass;
function ball(X,x,z,vx,vz,y){return {scored:false,m:{position:{x:x,y:y==null?X.BALL_R:y,z:z}},v:{x:vx||0,y:0,z:vz||0}};}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const RV=X.AIC.catch.recv,near=(a,b,e)=>Math.abs(a-b)<=(e==null?1e-6:e);
 // ---- arming ---------------------------------------------------------------------------------------------------------
 {const {from,r,blue}=world(X);
  X.recvArm(from,{x:-7.5,z:12});
  ok('a pass arms the rod it is aimed at',r.rvUntil>X.S.time&&r.rvZ===12);
  ok('…for the flight (30 units at the assumed speed), the pad and the grace',near(r.rvUntil-X.S.time,30/RV.speed+RV.pad+RV.grace,1e-6)&&near(r.rvFl,30/RV.speed,1e-6)&&r.rvT0===X.S.time);
  ok('…and nobody else: not the passer, not the other team\'s rod',from.rvUntil===undefined&&blue.rvUntil===0);
  const w2=world(X);X.recvArm(w2.from,{x:7.5,z:0});
  ok('a rod of the other team at that x is not armed (a pass is to a mate)',w2.blue.rvUntil===0&&w2.r.rvUntil===0);
  const wp=world(X);X.recvArm(wp.from,{x:-37.5,z:0});
  ok('a pass is never armed on the rod that made it, even aimed at its own x',wp.from.rvUntil===undefined);
  const w3=world(X);X.recvArm(w3.from,{x:-20,z:0});
  ok('a pass aimed at no rod arms nothing',w3.r.rvUntil===0);
  RV.on=false;const w4=world(X);X.recvArm(w4.from,{x:-7.5,z:12});
  ok('switched off, nothing is armed',w4.r.rvUntil===0);RV.on=true;}
 // ---- starting -------------------------------------------------------------------------------------------------------
 {const {from,r}=world(X);
  ok('an unarmed rod does not start',X.recvStart(r)===false&&r.act===null);
  X.recvArm(from,{x:-7.5,z:12});const n0=X.CAS.recv;
  ok('an armed one does, and it is counted',X.recvStart(r)===true&&r.act==='recv'&&X.CAS.recv===n0+1);
  const w=world(X);X.recvArm(w.from,{x:-7.5,z:12});w.r.force=true;
  ok('not when the whistle is close (play it now)',X.recvStart(w.r)===false);
  const g=world(X,{role:'GK'});X.recvArm(g.from,{x:-7.5,z:12});
  ok('a role not in the list (the keeper) does not',X.recvStart(g.r)===false);
  const e=world(X);X.recvArm(e.from,{x:-7.5,z:12});X.S.time+=10;
  ok('an arming that has run out does not',X.recvStart(e.r)===false);}
 // ---- the pose and the man before the pass is struck -------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  X.recvStep(r,null,D,dt);
  ok('the forward pin pose is up at once: pin on, posed, at the angle',r.pinOn===true&&r.pinPose===true&&near(r.pinA,RV.angle));
  ok('…the man is the one on the aimed z, and the rod slides to put him there',r.rvMan===3&&r.aiMan===3&&near(r.target,0,1e-6)&&r.act==='recv',r.rvMan+' '+r.target);
  ok('…with nothing flying and the grace not over, it waits',r.act==='recv');
  ok('…and the raise latch does not hold the rod up',r.raise===false&&r.behindFlag===false);}
 {const {from,blue}=world(X);const q=blue;q.team=0;q.kickDir=-1;
  X.rods.length=0;X.rods.push(from,q);from.team=0;
  q.rvUntil=X.S.time+2;q.rvT0=X.S.time;q.rvFl=0.5;q.rvZ=12;q.act=null;X.recvStart(q);X.recvStep(q,null,D,dt);
  ok('a rod looking the other way is tilted the same way relative to itself (forward is its own direction)',near(q.pinA,RV.angle*-1));}
 // ---- a ball in flight -----------------------------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  const b=ball(X,-20,13.6,48,0);X.S.balls=[b];X.S.time+=RV.grace+0.05;
  X.recvStep(r,null,D,dt);
  ok('the man follows the ball\'s line (z 13.6 -> the man at 12, offset 1.6)',r.act==='recv'&&r.rvMan===3&&near(r.target,1.6,0.01),r.target);
  b.v.z=-10;X.recvStep(r,null,D,dt);
  ok('…and re-aims as the line firms up (the ball drifting to -z moves the target that way)',r.target<1.6);
  b.m.position.y=2.2;X.recvStep(r,null,D,dt);
  ok('a pass that hops off the boot (2.2) is still a pass',r.act==='recv');
  b.m.position.y=X.AIC.catch.recv.maxY+0.5;X.recvStep(r,null,D,dt);
  ok('one high enough to pass over the pin is through',r.act===null&&X.CAW['recv:through']>=1);}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  const b=ball(X,-20,12,48,0);X.S.balls=[b];X.S.lastTouch=1;
  X.recvStep(r,null,D,dt);
  ok('before the pass has been struck the last touch is not the pass\'s: no "taken"',r.act==='recv');
  const t0=X.CAW['recv:taken']||0;X.S.time+=RV.grace+0.05;X.recvStep(r,null,D,dt);
  ok('after it, a ball the other team touched last is taken: it ends',r.act===null&&X.CAW['recv:taken']===t0+1);
  ok('…and the pose comes down',r.pinOn===false&&r.pinPose===false&&r.pinA===null);}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  const b=ball(X,-7.5-0.5,12,48,0);X.S.balls=[b];X.S.time+=RV.grace+0.05;const n0=X.CAW['recv:through']||0;
  X.recvStep(r,null,D,dt);
  ok('a ball still behind the rod is waited for',r.act==='recv');
  b.m.position.x=-7.5+2;X.recvStep(r,null,D,dt);
  ok('…and one rolling on under the man to his forward foot still is',r.act==='recv');
  b.m.position.x=-7.5+X.SHOT_fwdFront+0.3;
  ok('…and one that has gone on past the foot is no longer coming at it, so it is through',(()=>{X.recvStep(r,null,D,dt);return r.act===null&&X.CAW['recv:through']===n0+1;})());}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  const n0=X.CAW['recv:through']||0;X.S.time+=RV.grace+0.05;X.recvStep(r,null,D,dt);
  ok('with the grace over and no ball coming, it is over',r.act===null&&X.CAW['recv:through']===n0+1);}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  X.S.balls=[ball(X,-20,12,48,0)];X.S.time=r.rvUntil+0.01;const n0=X.CAW['recv:time']||0;X.recvStep(r,null,D,dt);
  ok('when the flight is over it gives up, ball or not',r.act===null&&X.CAW['recv:time']===n0+1);}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  X.S.balls=[ball(X,-9,6,48,0)];X.S.time+=RV.grace+0.05;const n0=X.CAW['recv:reach']||0;X.recvStep(r,null,D,dt);
  ok('a ball about to arrive between two men, too close for either to slide to its line in time, ends it for want of reach',r.act===null&&X.CAW['recv:reach']===n0+1);}
 // ---- caught ---------------------------------------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);
  X.recvStep(r,null,D,dt);
  r.pinB={m:{position:{x:-8.3,y:X.BALL_R,z:12}},v:{x:0,y:0,z:0},pinMan:3};const n0=X.CAS.recvPin;
  X.recvStep(r,null,D,dt);
  ok('a ball the pin has taken goes to the catch\'s hold (the play of a pinned ball: carry, shoot, pass, tap)',r.act==='catch'&&r.catPh==='front'&&r.catT===0&&X.CAS.recvPin===n0+1);
  ok('…and the pose stays up (the pin needs it)',r.pinOn===true&&r.pinPose===true);
  ok('…with the receiving over',r.rvUntil===0);}
 {const {from,r}=world(X);r.pinB={m:{position:{x:-8.3,y:X.BALL_R,z:12}},v:{x:0,y:0,z:0}};r.pinOn=true;r.pinPose=true;r.pinA=0.4;r.act='recv';X.recvEnd(r,'x');
  ok('ending with a ball pinned leaves the pin up',r.pinOn===true&&r.pinA===0.4&&r.act===null);
  const w=world(X);w.r.pinOn=true;w.r.pinPose=true;w.r.pinA=0.4;w.r.act='recv';w.r.rvUntil=5;w.r.aiMan=3;X.recvEnd(w.r,'x');
  ok('…and with none it brings the pose down and frees the man',w.r.pinOn===false&&w.r.pinPose===false&&w.r.pinA===null&&w.r.aiMan===-1&&w.r.rvUntil===0);}
 // ---- ready: before the pass -------------------------------------------------------------------------------------------
 const RD=RV.ready;
 {const {from,r,blue}=world(X);
  const t0=X.S.time;X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);
  ok('a holder looking at a mate gets him ready: armed for the hold, on the lane it is looking at, given the wait to get onto it',r.rvReady===true&&near(r.rvUntil,t0+RD.hold,1e-9)&&r.rvZ===12&&r.rvFl===RD.wait);
  X.S.time+=0.3;X.recvReady(from,[{rod:r,man:3,z:11,score:5}]);
  ok('…and while it keeps looking it is held (the lane follows the mate)',near(r.rvUntil,X.S.time+RD.hold,1e-9)&&r.rvZ===11);
  X.recvReady(from,[{rod:blue,man:3,z:0,score:5},{rod:from,man:0,z:0,score:5}]);
  ok('…the other team\'s rod and the holder itself are never made ready',blue.rvReady!==true&&from.rvReady!==true);
  const g2=world(X,{role:'GK'});X.recvReady(g2.from,[{rod:g2.r,man:3,z:12,score:5}]);
  ok('…nor a rod that does not take the pose (the keeper)',g2.r.rvReady!==true);
  const h=world(X);h.r.human=true;X.recvReady(h.from,[{rod:h.r,man:3,z:12,score:5}]);
  ok('…nor one a human holds',h.r.rvReady!==true);
  const f=world(X);f.r.rvUntil=X.S.time+1;f.r.rvReady=false;f.r.rvZ=7;X.recvReady(f.from,[{rod:f.r,man:3,z:12,score:5}]);
  ok('…nor one a real pass is already on its way to (the flight is not cut short or re-aimed)',f.r.rvReady===false&&f.r.rvZ===7);
  RD.on=false;const o=world(X);X.recvReady(o.from,[{rod:o.r,man:3,z:12,score:5}]);
  ok('switched off, nobody is made ready',o.r.rvReady!==true);RD.on=true;
  const n=world(X);X.recvReady(n.from,undefined);
  ok('a holder with nobody in view gets nobody ready',n.r.rvReady!==true);}
 // possession: the team has the ball behind a rod, slowly
 const PSS=X.AIC.dribble.pass;
RD.maxBall=0;
 {const {r}=world(X);const ballAt=(x,z,v,y,vx)=>({real:null,m:{position:{x:x,y:y==null?X.BALL_R:y,z:z}},v:{x:vx||0,y:0,z:0,length(){return v||0;}}});
  const b=ballAt(-30,14,5);b.real=b;X.S.lastTouch=0;const t0=X.S.time;
  X.recvPossess(r,b);
  ok('the team has the ball behind a rod, slowly: the rod is ready, on the ball\'s lane, held for the hold',r.rvReady===true&&r.rvZ===14&&near(r.rvUntil,t0+RD.hold,1e-9)&&r.rvFl===RD.wait,r.rvZ);
  const o=world(X).r;X.S.lastTouch=1;X.recvPossess(o,b);
  ok('…not when the other team touched it last (it is theirs)',o.rvReady!==true);X.S.lastTouch=0;
  const nr=world(X).r;X.recvPossess(nr,ballAt(-7.5-PSS.minAhead+2,14,5));
  ok('…not when it is too close behind the rod (it is nearly there, or past)',nr.rvReady!==true);
  const fr=world(X).r;X.recvPossess(fr,ballAt(-7.5-RD.reach-2,14,5));
  ok('…nor too far behind it (nothing for this rod to do yet)',fr.rvReady!==true);
  const fa=ballAt(-30,14,80,undefined,80);fa.real=fa;const far=world(X).r;X.recvPossess(far,fa);
  ok('…at any speed: a ball pinged fast at the rod is one it stands ready for',far.rvReady===true&&far.rvZ===14);
  RD.maxBall=40;const cap=ballAt(-30,14,80,undefined,80);cap.real=cap;const capr=world(X).r;X.recvPossess(capr,cap);
  ok('…unless a speed limit is set (maxBall): then a quicker ball is a clearance or a shot, not the build-up',capr.rvReady!==true);
  const slw=ballAt(-30,14,30,undefined,30);slw.real=slw;const slr=world(X).r;X.recvPossess(slr,slw);RD.maxBall=0;
  ok('…and one under it still is',slr.rvReady===true);
  const aw=ballAt(-30,14,80,undefined,-80);aw.real=aw;const awr=world(X).r;X.recvPossess(awr,aw);
  ok('…not one running away from it toward the team\'s own goal',awr.rvReady!==true);
  const dr=ballAt(-30,14,5,undefined,-5);dr.real=dr;const drr=world(X).r;X.recvPossess(drr,dr);
  ok('…but a ball only drifting back slowly still is',drr.rvReady===true);
  const hi=world(X).r;X.recvPossess(hi,ballAt(-30,14,5,X.AIC.lowY+1));
  ok('…nor in the air',hi.rvReady!==true);
  const fo=world(X).r;fo.force=true;X.recvPossess(fo,b);
  ok('…nor when the whistle is close',fo.rvReady!==true);
  const gk=world(X,{role:'GK'}).r;X.recvPossess(gk,b);
  ok('…nor for a rod that does not take the pose (the keeper)',gk.rvReady!==true);
  const pf=world(X).r;pf.rvUntil=X.S.time+1;pf.rvReady=false;pf.rvZ=7;X.recvPossess(pf,b);
  ok('…nor one a real pass is already on its way to',pf.rvReady===false&&pf.rvZ===7);
  const cd=world(X).r;cd.rvCd=X.S.time+1;X.recvPossess(cd,b);
  ok('…nor one that could not get onto a lane a moment ago',cd.rvReady!==true);
  const ln=world(X).r;ln.rvLaneT=X.S.time;ln.rvZ=-6;ln.rvReady=true;ln.rvUntil=X.S.time+0.2;X.recvPossess(ln,b);
  ok('a lane a holder is looking at keeps its say (the ball\'s lane does not replace it), and it is held on',ln.rvZ===-6&&near(ln.rvUntil,X.S.time+RD.hold,1e-9));
  const ol=world(X).r;ol.rvLaneT=X.S.time-RD.hold-0.1;ol.rvZ=-6;ol.rvReady=true;ol.rvUntil=X.S.time+0.2;X.recvPossess(ol,b);
  ok('…once nobody has been looking at it for the hold, the ball\'s lane is the lane again',ol.rvZ===14);
  // a ball lying in reach of one of the team's rods is the team's to play, whoever touched it last
  const theirs=(ball,opt)=>{const w=world(X,opt);w.from.team=opt&&opt.fromTeam!=null?opt.fromTeam:0;w.from.kickDir=w.from.team===0?1:-1;X.S.lastTouch=1;X.recvPossess(w.r,ball);return w.r;};
  const fb=ballAt(-36,14,5);fb.real=fb;
  const ft=theirs(fb);
  ok('…also a ball the other team touched last that lies at the foot of one of the team\'s rods (it is the team\'s to play)',ft.rvReady===true&&ft.rvZ===14);
  const hl=ballAt(-40,14,5);hl.real=hl;const hr=theirs(hl);
  ok('…or just behind its heel',hr.rvReady===true);
  const fh=ballAt(-45,14,5);fh.real=fh;const fhr=theirs(fh);
  ok('…not one further behind it than the rod can play',fhr.rvReady!==true);
  const wf=theirs(fb,{fromTeam:1});
  ok('…nor one at the foot of the other team\'s rod',wf.rvReady!==true);
  const fl=ballAt(-36,14,80,undefined,80);fl.real=fl;const flr=theirs(fl);
  ok('…and a fast one at it too',flr.rvReady===true);
  const mirror=(x)=>{const w=world(X);w.from.team=1;w.from.kickDir=-1;w.from.x=37.5;w.r.team=1;w.r.kickDir=-1;w.r.x=7.5;X.S.lastTouch=0;const bm=ballAt(x,14,5);bm.real=bm;X.recvPossess(w.r,bm);return w.r;};
  ok('a team attacking the other way reads the reach in its own direction (at its foot: ready)',mirror(36).rvReady===true);
  ok('…and a ball behind its heel by more than the reach is not',mirror(43.5).rvReady!==true);
  RD.feet=false;const nf=theirs(fb);
  ok('with the foot reach switched off only a ball the team touched last readies a rod',nf.rvReady!==true);RD.feet=true;X.S.lastTouch=0;
  RD.possession=false;const off=world(X).r;X.recvPossess(off,b);
  ok('with possession off the rods are left as they were',off.rvReady!==true);RD.possession=true;
  // a human on the team holding finesse and kick (shots.js shotRecvAsk): its mates stand ready for any ball coming up at them
  const ask=(ball,o)=>{o=o||{};X.S.seats=[{team:o.seat==null?0:o.seat,rcvAsk:true}];const w=world(X,o);if(o.cd)w.r.rvCd=X.S.time+1;if(o.force)w.r.force=true;X.S.lastTouch=o.lt==null?0:o.lt;X.recvPossess(w.r,ball);X.S.seats=undefined;X.S.lastTouch=0;return w.r;};
  const up=ballAt(-30,14,60,undefined,60);up.real=up;
  ok('a human asking: ready for a ball coming up at the rod even straight after a kick let it go (cooldown)',ask(up,{cd:true}).rvReady===true);
  ok('...even when the other team touched it last',ask(up,{lt:1}).rvReady===true);
  RD.maxBall=40;ok('...even over the speed limit',ask(up).rvReady===true);RD.maxBall=0;
  RD.possession=false;ok('...even with possession off',ask(up).rvReady===true);RD.possession=true;
  const hop=ballAt(-30,14,60,X.AIC.lowY+0.5,60);hop.real=hop;
  ok('...and a pass hopping off the boot (under recv.maxY)',ask(hop).rvReady===true);
  const sky=ballAt(-30,14,60,X.AIC.catch.recv.maxY+1,60);sky.real=sky;
  ok('...not one higher than recv.maxY',ask(sky).rvReady!==true);
  const crawl=ballAt(-30,14,5,undefined,RD.trackV-5);crawl.real=crawl;
  ok('...a ball slower than trackV is not asked for (the cooldown stands)',ask(crawl,{cd:true}).rvReady!==true);
  ok('...the other team\'s human asking does nothing for this rod',ask(up,{seat:1,cd:true}).rvReady!==true);
  ok('...nor for the keeper',ask(up,{role:'GK'}).rvReady!==true);
  ok('...nor with the whistle close',ask(up,{force:true}).rvReady!==true);
  const cl=ballAt(-7.5-PSS.minAhead+2,14,60,undefined,60);cl.real=cl;
  ok('...nor a ball already too close to stand ready for',ask(cl).rvReady!==true);
  RD.on=false;const off2=world(X).r;X.recvPossess(off2,b);
  ok('…and with the ready state off',off2.rvReady!==true);RD.on=true;}
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);
  ok('a lane a holder looks at is stamped, so possession does not override it',r.rvLaneT===X.S.time);
  const c=world(X);c.r.rvCd=X.S.time+1;X.recvReady(c.from,[{rod:c.r,man:3,z:12,score:5}]);
  ok('…and a rod that could not get onto a lane a moment ago is left alone',c.r.rvReady!==true);}
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:14,score:5}]);X.recvStart(r);
  X.recvStep(r,null,D,dt);
  ok('a ready rod poses at once, with no ball in flight: pin on, the forward angle',r.act==='recv'&&r.pinOn===true&&r.pinPose===true&&near(r.pinA,RV.angle));
  ok('…the man is the one on the lane, and the rod slides to put him there',r.rvMan===3&&r.aiMan===3&&near(r.target,2,1e-6),r.rvMan+' '+r.target);
  r.rvT0=X.S.time-5;
  X.S.time+=RV.grace+0.1;X.S.lastTouch=1;X.recvStep(r,null,D,dt);
  ok('…it does not read "through" or "taken" while nothing has been passed (no ball, the other team\'s last touch): it is waiting',r.act==='recv');
  X.S.time=r.rvUntil+0.01;const n0=X.CAW['recv:idle']||0;X.recvStep(r,null,D,dt);
  ok('…and when the holder stops looking (nothing refreshes it) it lets go: idle, the pose down',r.act===null&&X.CAW['recv:idle']===n0+1&&r.pinOn===false&&r.rvReady===false);}
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:30,score:5}]);X.recvStart(r);X.rods.forEach(q=>{});
  r.removedUntil=[1e9,1e9,1e9,1e9,1e9];const n0=X.CAW['recv:reach']||0;X.recvStep(r,null,D,dt);
  ok('a ready rod with no man to put on the lane ends it for want of reach',r.act===null&&X.CAW['recv:reach']===n0+1);
  ok('…and waits before it is readied again',r.rvCd>X.S.time&&near(r.rvCd-X.S.time,RD.cd,1e-9));}
 // a ready rod follows a ball already on its way
 {const mk=()=>{const {from,r}=world(X);X.recvReady(from,[{rod:r,man:2,z:0,score:5}]);X.recvStart(r);X.recvStep(r,null,D,dt);return r;};
  const bl=(vx,vz,y)=>{const b=ball(X,-27.5,5,vx,vz,y);X.S.balls=[b];};
  const r=mk();bl(60,6);X.recvStep(r,null,D,dt);
  ok('a ready rod follows a ball already coming at it fast (an unarmed pass, a clearance, the keeper\'s kick): the man goes to where its line will be, not the lane',near(r.baseZ[r.rvMan]+r.target,7,0.4)&&r.pinPose===true,'z='+(r.baseZ[r.rvMan]+r.target));
  const q=mk();bl(RV.ready.trackV-2,6);X.recvStep(q,null,D,dt);
  ok('…not one that is slow (the lane stays)',near(q.target,0,1e-6),'target='+q.target);
  const a=mk();bl(-60,6);X.recvStep(a,null,D,dt);
  ok('…nor one running away from it',near(a.target,0,1e-6));
  const h=mk();bl(60,6,RV.maxY+1);X.recvStep(h,null,D,dt);
  ok('…nor one in the air (over the pin)',near(h.target,0,1e-6));
  ok('…and it stays ready all the while: the pose is up, the action is the same',r.act==='recv'&&r.rvReady===true&&r.pinOn===true);}
 {const sp0=X.DIFFS.pro.speed;X.DIFFS.pro.speed=10;
  const {from,r}=world(X);r.offset=-6;X.recvReady(from,[{rod:r,man:4,z:24,score:5}]);X.recvStart(r);
  X.recvStep(r,null,D,dt);
  ok('a ready rod is not in a hurry: a slow rod, a lane 6 off (more than the 0.45 s a pass takes would give it) is still one it gets onto',r.act==='recv'&&r.rvMan===4&&near(r.target,0,1e-6),r.act+' '+r.rvMan+' '+r.target);
  X.DIFFS.pro.speed=sp0;}
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);X.recvStart(r);X.recvStep(r,null,D,dt);
  X.recvArm(from,{x:-7.5,z:12});
  ok('a real pass takes over: no longer just ready, the flight timed from now',r.rvReady===false&&r.rvT0===X.S.time&&near(r.rvFl,30/RV.speed,1e-6));
  X.S.balls=[ball(X,-20,12,48,0)];X.S.lastTouch=1;X.recvStep(r,null,D,dt);
  ok('…so the usual reading applies again: before the grace the last touch is not read',r.act==='recv');
  X.S.time+=RV.grace+0.05;const n0=X.CAW['recv:taken']||0;X.recvStep(r,null,D,dt);
  ok('…and after it a ball the other team took ends it',r.act===null&&X.CAW['recv:taken']===n0+1);}
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);X.recvStart(r);
  r.pinB={m:{position:{x:-8.3,y:X.BALL_R,z:12}},v:{x:0,y:0,z:0},pinMan:3};
  X.recvStep(r,null,D,dt);
  ok('a ball the pin takes while ready goes to the hold too, and the ready state is over',r.act==='catch'&&r.rvReady===false&&r.rvUntil===0);}
 {const w=world(X);w.r.rvReady=true;w.r.rvUntil=5;w.r.act='recv';X.recvEnd(w.r,'x');
  ok('ending clears the ready state',w.r.rvReady===false&&w.r.rvUntil===0);}
 // ---- what counts as ready ---------------------------------------------------------------------------------------------
 {const {r}=world(X);const pk={rod:r,man:3,z:12};
  ok('a mate not yet in the pose is not ready',X.recvReadyNow(pk)===false);
  r.act='recv';r.rvReady=true;r.angle=RV.angle-RD.tol-0.05;r.offset=0;
  ok('…the action running but the pose short of its angle: not ready',X.recvReadyNow(pk)===false);
  r.angle=RV.angle;r.offset=2;
  ok('…the pose up but the man off the lane: not ready',X.recvReadyNow(pk)===false);
  r.offset=0;r.act=null;
  ok('…the pose up and the man on the lane but the rod not in the action (nobody arranged it): not ready',X.recvReadyNow(pk)===false);
  r.act='recv';
  ok('…the pose up and the man on the lane: ready',X.recvReadyNow(pk)===true);
  r.angle=RV.angle+RD.tol-0.01;
  ok('…within the tolerance either side',X.recvReadyNow(pk)===true);
  r.rvReady=false;
  ok('…but a rod that is only in the receiving action for a pass in flight is not "ready" for another',X.recvReadyNow(pk)===false);
  r.rvReady=true;r.act='catch';
  ok('a rod busy with something else is not waited for (ready, nothing to wait for)',X.recvReadyNow(pk)===true);
  r.act=null;r.role='GK';
  ok('…nor one that does not take the pose',X.recvReadyNow(pk)===true);
  r.role='MID';r.human=true;
  ok('…nor one a human holds',X.recvReadyNow(pk)===true);
  r.human=false;RD.on=false;
  ok('with the wait switched off, everyone is ready',X.recvReadyNow(pk)===true);RD.on=true;
  ok('with no mate in view there is nothing to wait for',X.recvReadyNow(null)===true);}
 // ---- the dead-ball push ---------------------------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);X.recvStart(r);X.recvStep(r,null,D,dt);
  r.force=true;const n0=X.CAW['recv:force']||0;X.recvStep(r,null,D,dt);
  ok('a ready rod lets go when the whistle is close, so the dead-ball push can play the ball',r.act===null&&r.pinOn===false&&X.CAW['recv:force']===n0+1);}
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);X.S.balls=[ball(X,-20,12,48,0)];
  r.force=true;X.recvStep(r,null,D,dt);
  ok('…and a pass in flight too (the ball is dead, the whistle wins)',r.act===null);}
 // ---- a pass the leg has stopped dead --------------------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);X.S.time+=RV.grace+0.1;
  X.S.balls=[ball(X,r.x+3.0,12,0,0.8)];r.target=3;r.offset=2;X.recvStep(r,null,D,dt);
  ok('a ball the leg has stopped dead is waited for: the pose is held for the pin and the man stays where he is',r.act==='recv'&&r.pinOn===true&&r.pinPose===true&&near(r.pinA,RV.angle)&&r.target===2);
  X.S.time+=RV.rest/2;X.recvStep(r,null,D,dt);
  ok('…for part of RV.rest',r.act==='recv');
  X.S.time+=RV.rest;X.recvStep(r,null,D,dt);
  ok('…and no longer: it is through',r.act===null&&r.pinOn===false&&X.CAW['recv:through']>0);
  X.recvArm(from,{x:-7.5,z:12});
  ok('a new pass starts the wait afresh',r.rvRestT===0);}
 {const mk=(x,z,vx,vz,y)=>{const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);X.S.time+=RV.grace+0.1;X.S.balls=[ball(X,r.x+x,z,vx,vz,y)];X.recvStep(r,null,D,dt);return r;};
  ok('a ball that is still quick is not waited for (the pin does not hold it)',mk(3.0,12,0,X.SHOT_capV+5).act===null);
  ok('…nor one nearer than the forward foot reaches',mk(X.SHOT_fwdBack-1,12,0,0).act===null);
  ok('…nor one in the air',mk(3.0,12,0,0,4).act===null);
  ok('…nor one past the foot',mk(X.SHOT_fwdFront+1,12,0,0).act===null);
  const w=world(X);X.recvArm(w.from,{x:-7.5,z:12});X.recvStart(w.r);X.S.time+=RV.grace+0.1;const pb=ball(X,w.r.x+3.0,12,0,0);pb.pinR=w.blue;X.S.balls=[pb];X.recvStep(w.r,null,D,dt);
  ok('…nor one another rod already holds',w.r.act===null);
  const w2=world(X);X.recvArm(w2.from,{x:-7.5,z:12});X.recvStart(w2.r);X.S.time+=RV.grace+0.1;const sc=ball(X,w2.r.x+3.0,12,0,0);sc.scored=true;X.S.balls=[sc];X.recvStep(w2.r,null,D,dt);
  ok('…nor a scored one',w2.r.act===null);
  const w3=world(X);X.recvArm(w3.from,{x:-7.5,z:12});X.recvStart(w3.r);X.S.time+=RV.grace+0.1;w3.r.vz=20;X.S.balls=[ball(X,w3.r.x+3.0,12,0,20)];X.recvStep(w3.r,null,D,dt);
  ok('a ball running along with the sliding rod is at rest against it (the pin judges the speed against the rod\'s)',w3.r.act==='recv');}
 // ---- a human taking the rod ----------------------------------------------------------------------------------------------
 {const {from,r}=world(X);X.recvReady(from,[{rod:r,man:3,z:12,score:5}]);X.recvStart(r);X.recvStep(r,null,D,dt);
  X.clearRodAI(r);
  ok('a player taking a ready rod takes the receiving state with it (nothing stale to come back to the AI)',r.act===null&&r.rvReady===false&&r.rvUntil===0);
  const w=world(X);X.recvArm(w.from,{x:-7.5,z:12});X.clearRodAI(w.r);
  ok('…and a pass armed for it',w.r.rvUntil===0);}
 // ---- a ball on its way is not met by a lift ---------------------------------------------------------------------------------
 {const mk=()=>{const {from,r}=world(X);X.recvReady(from,[{rod:r,man:2,z:0,score:5}]);X.recvStart(r);X.recvStep(r,null,D,dt);return r;};
  const lapse=(vx,y)=>{const r=mk();X.S.balls=vx==null?[]:[ball(X,-12.5,0,vx,0,y)];r.rvUntil=X.S.time+0.004;X.S.time+=0.008;X.recvStep(r,null,D,dt);return r;};
  const on=lapse(50);
  ok('a ready rod whose hold has run out with a ball running at it stays ready, held on for RD.arrive',on.act==='recv'&&on.rvReady===true&&near(on.rvUntil,X.S.time+RD.arrive,1e-9),on.act+' '+(on.rvUntil-X.S.time));
  ok('…with nothing coming at it the hold runs out as it did: idle',lapse(null).act===null);
  ok('…nor does a slow ball (under trackV) hold it',lapse(RD.trackV-2).act===null);
  ok('…nor one in the air',lapse(50,RV.maxY+1).act===null);
  ok('…nor one running away',lapse(-50).act===null);}
 {const mk=(x)=>{const {from,r}=world(X);X.recvArm(from,{x:-7.5,z:12});X.recvStart(r);X.S.balls=[ball(X,x,12,48,0,RV.maxY+0.5)];X.S.time+=RV.grace+0.05;const n=X.CAW['recv:through']||0;X.recvStep(r,null,D,dt);return {r,n};};
  const edge=48*RV.liftT,c=mk(-7.5-edge*0.5);
  ok('a pass that has gone above the pin is held for when it is closer than a lift takes (RV.liftT): the lift would go across it',c.r.act==='recv'&&c.r.pinPose===true&&X.CAW['recv:through']===c.n);
  const f=mk(-7.5-edge-1);
  ok('…farther than that it is through, as before',f.r.act===null&&X.CAW['recv:through']===f.n+1);}
 // ---- the keeper's kick ----------------------------------------------------------------------------------------------------
 const GKc=PSS.gk;
 const gkWorld=(opt)=>{opt=opt||{};X.S.time=1;X.S.balls=[];
  const gk={x:-52.5,team:0,kickDir:1,role:'GK',baseZ:[0],maxOff:10,removedUntil:[],offset:0,angle:0,act:null,kickT:-1,pinB:null,force:false};
  const d={x:-37.5,team:0,kickDir:1,role:'DEF',baseZ:[-12,12],maxOff:18,removedUntil:[],offset:0,angle:opt.ang==null?RV.angle:opt.ang,act:opt.act===undefined?'recv':opt.act,rvReady:opt.ready!==false,rvUntil:opt.ready===false?0:X.S.time+5,rvCd:0,kickT:-1,pinB:null,human:!!opt.human};
  const blue={x:-22.5,team:1,kickDir:-1,role:'ATT',baseZ:[0],removedUntil:[],offset:0,angle:0,maxOff:18};
  X.rods.length=0;X.rods.push(gk,d,blue);return {gk,d,blue};};
 const held=(w,bp,speed)=>{let k=0;while(X.gkHold(w.gk,bp,speed==null?5:speed,dt)&&k<400)k++;return k;};
 const lane={x:-49,z:12},off={x:-49,z:0},fr=t=>Math.round(t/dt);
 {const w=gkWorld();const t0=X.S.time;
  X.S.balls=[ball(X,-45,0,50,0)];
  X.recvRelease(w.gk);
  ok('a keeper\'s kick with a ball already running at the ready mate leaves him ready: he takes it',w.d.rvUntil>t0&&(w.d.rvCd||0)<=t0);
  const slow=gkWorld();X.S.balls=[ball(X,-45,0,RD.trackV-3,0)];X.recvRelease(slow.gk);
  ok('…a ball under trackV is no ball running at him: he is let go',slow.d.rvUntil===0&&slow.d.rvCd>X.S.time);
  const hi=gkWorld();X.S.balls=[ball(X,-45,0,50,0,RV.maxY+1)];X.recvRelease(hi.gk);
  ok('…nor one over the pin',hi.d.rvUntil===0);
  const rest=gkWorld();X.S.balls=[ball(X,-50,0,0,0)];X.recvRelease(rest.gk);
  ok('…and with the ball at rest he is let go, as before',rest.d.rvUntil===0);
  const out=gkWorld();out.gk.role='DEF';X.S.balls=[ball(X,-45,0,50,0)];X.recvRelease(out.gk);
  ok('…another rod\'s kick lets him go either way',out.d.rvUntil===0);
  GKc.on=false;const offw=gkWorld();X.S.balls=[ball(X,-45,0,50,0)];X.recvRelease(offw.gk);GKc.on=true;
  ok('…and with the keeper\'s pass switched off',offw.d.rvUntil===0);}
 {const w=gkWorld();
  const n=held(w,lane);
  ok('a keeper with no pass gives a mate standing ready the time to get onto the lane, then lets him go and waits for him to lift: readyT + clearT',Math.abs(n-fr(GKc.readyT)-fr(GKc.clearT))<=3,n);
  const g1=gkWorld();for(let i=0;i<fr(GKc.readyT)-3;i++)X.gkHold(g1.gk,lane,5,dt);
  ok('…he is not let go while he has that time, and the pass is looked for again every step',g1.d.rvUntil>X.S.time&&g1.gk.passEvT===0);
  for(let i=0;i<10;i++)X.gkHold(g1.gk,lane,5,dt);
  ok('…then he is let go: the pose comes down and he is not readied again for a while',g1.d.rvUntil===0&&g1.d.rvCd>X.S.time);
  const lift=gkWorld();for(let i=0;i<fr(GKc.readyT)+5;i++)X.gkHold(lift.gk,lane,5,dt);
  lift.d.angle=GKc.clearA-0.1;lift.d.act=null;lift.d.rvReady=false;
  ok('…and the kick goes the moment his leg is over the ball, the wait over',X.gkHold(lift.gk,lane,5,dt)===false&&lift.gk.gkWaitT===0&&lift.gk.gkClearT===0);
  const cl=gkWorld();const k=held(cl,off);
  ok('a ready mate with no man in the ball\'s lane is given the ready time, and not let go (he is out of the way)',Math.abs(k-fr(GKc.readyT))<=3&&cl.d.rvUntil>X.S.time,k);
  const dn=gkWorld({ang:0,act:null,ready:false});const kd=held(dn,lane);
  ok('a mate that is not ready but has his men down in the lane is waited for to lift, clearT, with nothing to wait for before',Math.abs(kd-fr(GKc.clearT))<=3,kd);
  const up=gkWorld({ang:GKc.clearA-0.2,act:null,ready:false});
  ok('a mate with his leg over the ball is no reason to wait',X.gkHold(up.gk,lane,5,dt)===false&&up.gk.gkWaitT===0);
  const nr=gkWorld({ang:RV.angle,act:null,ready:true});const kn=held(nr,off);
  ok('a mate that is "ready" but not in the receiving action (nothing arranged it) is not waited for',kn===0);
  ok('the wait starts afresh once nothing is in the way',(()=>{const x=gkWorld();held(x,lane);x.d.angle=-1.3;x.d.act=null;x.d.rvReady=false;X.gkHold(x.gk,lane,5,dt);return x.gk.gkWaitT===0&&x.gk.gkClearT===0;})());}
 {const none=(f)=>{const w=gkWorld();f(w);return held(w,lane);};
  ok('a ball quicker than gk.maxBall is a save: nothing is waited for',held(gkWorld(),lane,GKc.maxBall+5)===0);
  ok('the dead-ball push is not held up',none(w=>{w.gk.force=true;})===0);
  ok('a rod that is not the keeper does not wait',none(w=>{w.gk.role='DEF';})===0);
  GKc.on=false;const offk=held(gkWorld(),lane);GKc.on=true;
  ok('switched off, nothing is waited for',offk===0);
  ok('a rod a human holds is not waited for',none(w=>{w.d.human=true;})===0);
  ok('a mate behind the keeper is no concern',none(w=>{w.d.x=-60;})===0);
  ok('…nor one further ahead than gk.reach',none(w=>{w.d.x=-52.5+GKc.reach+3;})===0);
  ok('…nor the other team\'s rod',none(w=>{w.d.team=1;w.d.kickDir=-1;})===0);}
 // ---- coming back to rest --------------------------------------------------------------------------------------------
 ok('the drop from a forward pose is a back-lift the guard holds short of a ball (rods.js)',/else\{r\.heldFwd=false;r\.angle=lerp\(r\.angle,backLimit\(r,0,KICK\.dropLerp(,r\.fwdOut)?\),/.test(rd('js/rods.js')));
 // ---- which ball -----------------------------------------------------------------------------------------------------
 {const {r}=world(X);
  const slow=ball(X,-20,0,10,0),fast=ball(X,-25,0,50,0),away=ball(X,-20,0,-50,0),past=ball(X,0,0,50,0),gone=ball(X,-25,0,90,0);gone.scored=true;
  X.S.balls=[slow,away,past,gone,fast];
  ok('the ball for a pass is the one coming at the rod fastest from behind (not one going away, one already past, or a scored one)',X.recvBall(r)===fast);
  X.S.balls=[away,past];
  ok('…none when nothing is',X.recvBall(r)===null);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info!=null?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'a rod keeps waiting for a pass the whistle is about to end',part:'catch',from:"if(r.force){recvEnd(r,'force');return;}",to:''},
 {n:'possession never readies a rod',part:'catch',from:'r.rvReady=true;r.rvUntil=S.time+RD.hold;r.rvFl=RD.wait;\n}',to:'\n}'},
 {n:'…the other team\'s ball readies it too',part:'catch',from:'||(S.lastTouch!==r.team&&!recvOwn(r,p))))return;',to:'))return;'},
 {n:'…a ball too close (past, or nearly there) readies it',part:'catch',from:'if(ahead<PS.minAhead||ahead>RD.reach||',to:'if(ahead>RD.reach||'},
 {n:'…a ball too far behind readies it',part:'catch',from:'||ahead>RD.reach||p.y>(ask',to:'||p.y>(ask'},
 {n:'…a ball running away fast readies it',part:'catch',from:'if(!ask&&(b.v.x*r.kickDir<-RD.awayV||(RD.maxBall',to:'if(!ask&&((RD.maxBall'},
 {n:'…the speed limit is ignored',part:'catch',from:'||(RD.maxBall>0&&b.v.length()>RD.maxBall)||',to:'||'},
 {n:'…a limit of 0 is a limit of nothing',part:'catch',from:'(RD.maxBall>0&&b.v.length()>RD.maxBall)',to:'(b.v.length()>RD.maxBall)'},
 {n:'…a ball drifting back slowly does not',part:'catch',from:'b.v.x*r.kickDir<-RD.awayV',to:'b.v.x*r.kickDir<0'},
 {n:'…a fast ball coming at the rod does not',part:'catch',from:'b.v.x*r.kickDir<-RD.awayV',to:'Math.abs(b.v.x)>RD.awayV'},
 {n:'…a ball in the air readies it',part:'catch',from:'||p.y>(ask?RV.maxY:AIC.lowY))return;',to:')return;'},
 {n:'a ready rod ignores the ball coming at it',part:'catch',from:'if(b&&b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY){tAr=',to:'if(false){tAr='},
 {n:'…follows a slow ball too',part:'catch',from:'if(b&&b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY){tAr=',to:'if(b&&b.v.x*dir>=-1e9&&b.m.position.y<=RV.maxY){tAr='},
 {n:'…follows a ball in the air',part:'catch',from:'&&b.m.position.y<=RV.maxY){tAr=',to:'){tAr='},
 {n:'…goes to where the ball is, not where its line will be',part:'catch',from:'za=b.m.position.z+b.v.z*tAr;}',to:'za=b.m.position.z;}'},
 {n:'…the whistle does not stop it',part:'catch',from:'RV.roles.indexOf(r.role)<0||r.force||((r.rvUntil||0)>S.time&&!r.rvReady))return;',to:'RV.roles.indexOf(r.role)<0||((r.rvUntil||0)>S.time&&!r.rvReady))return;'},
 {n:'…the keeper is readied',part:'catch',from:'!RD.on||RV.roles.indexOf(r.role)<0||r.force||((r.rvUntil',to:'!RD.on||r.force||((r.rvUntil'},
 {n:'…a pass already on its way is re-aimed',part:'catch',from:'||((r.rvUntil||0)>S.time&&!r.rvReady))return;\n const b=',to:')return;\n const b='},
 {n:'…a rod on cooldown is readied',part:'catch',from:'if(!ask&&(!RD.possession||(r.rvCd||0)>S.time))return;',to:'if(!ask&&!RD.possession)return;'},
 {n:'a human\'s ask is never read',part:'catch',from:'const ask=recvAsk(r.team)&&',to:'const ask=false&&'},
 {n:'…a slow ball is asked for too',part:'catch',from:'const ask=recvAsk(r.team)&&b.v.x*r.kickDir>=RD.trackV;',to:'const ask=recvAsk(r.team);'},
 {n:'…the other team\'s human asks',part:'catch',from:'if(ss[i].team===t&&ss[i].rcvAsk)return true;',to:'if(ss[i].rcvAsk)return true;'},
 {n:'…the ask still waits out the cooldown',part:'catch',from:'if(!ask&&(!RD.possession||(r.rvCd||0)>S.time))return;',to:'if((r.rvCd||0)>S.time||(!ask&&!RD.possession))return;'},
 {n:'…the ask still needs the team to have touched it',part:'catch',from:'if(!ask&&(b.v.x*r.kickDir<-RD.awayV||',to:'if((S.lastTouch!==r.team&&!recvOwn(r,p))||!ask&&(b.v.x*r.kickDir<-RD.awayV||'},
 {n:'…the ask keeps the speed limit',part:'catch',from:'if(!ask&&(b.v.x*r.kickDir<-RD.awayV||',to:'if((RD.maxBall>0&&b.v.length()>RD.maxBall)||!ask&&(b.v.x*r.kickDir<-RD.awayV||'},
 {n:'…the ask drops a pass hopping off the boot',part:'catch',from:'p.y>(ask?RV.maxY:AIC.lowY)',to:'p.y>AIC.lowY'},
 {n:'…the ask takes a ball high in the air',part:'catch',from:'p.y>(ask?RV.maxY:AIC.lowY)',to:'p.y>(ask?1e9:AIC.lowY)'},
 {n:'…a holder\'s lane is overridden by the ball\'s',part:'catch',from:'if(S.time-(r.rvLaneT||-9)>=RD.hold)r.rvZ=p.z;',to:'r.rvZ=p.z;'},
 {n:'…the ball\'s lane is never taken',part:'catch',from:'if(S.time-(r.rvLaneT||-9)>=RD.hold)r.rvZ=p.z;',to:''},
 {n:'…it is held only for the moment',part:'catch',from:'r.rvReady=true;r.rvUntil=S.time+RD.hold;r.rvFl=RD.wait;\n}',to:'r.rvReady=true;r.rvFl=RD.wait;\n}'},
 {n:'a lane a holder looks at is not stamped',part:'catch',from:'q.rvZ=c.z;q.rvFl=RD.wait;q.rvLaneT=S.time;',to:'q.rvZ=c.z;q.rvFl=RD.wait;'},
 {n:'a rod on cooldown is readied by a holder',part:'catch',from:'||(q.rvCd||0)>S.time)continue;',to:')continue;'},
 {n:'a failed reach sets no cooldown',part:'catch',from:"if(why==='reach')r.rvCd=S.time+AIC.catch.recv.ready.cd;",to:''},
 {n:'a ready rod is given only the time a pass takes to get onto the lane',part:'catch',from:'let za=r.rvZ,tAr=RV.ready.reachT;',to:'let za=r.rvZ,tAr=r.rvFl;'},
 {n:'a holder\'s mates are never made ready',part:'catch',from:'q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvZ=c.z;q.rvFl=RD.wait;',to:''},
 {n:'…the lane they are made ready for is forgotten',part:'catch',from:'q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvZ=c.z;q.rvFl=RD.wait;',to:'q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvFl=RD.wait;'},
 {n:'…the time to get onto it is forgotten',part:'catch',from:'q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvZ=c.z;q.rvFl=RD.wait;',to:'q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvZ=c.z;'},
 {n:'…it is made ready for ever',part:'catch',from:'q.rvReady=true;q.rvUntil=S.time+RD.hold;',to:'q.rvReady=true;q.rvUntil=1e9;'},
 {n:'…the other team\'s rods are made ready too',part:'catch',from:'if(!q||q===from||q.team!==from.team||',to:'if(!q||q===from||'},
 {n:'…the holder is made ready for itself',part:'catch',from:'if(!q||q===from||q.team!==from.team||',to:'if(!q||q.team!==from.team||'},
 {n:'…the keeper is made ready',part:'catch',from:'||RV.roles.indexOf(q.role)<0||isUserRod(q))continue;',to:'||isUserRod(q))continue;'},
 {n:'…a rod a human holds is made ready',part:'catch',from:'||RV.roles.indexOf(q.role)<0||isUserRod(q))continue;',to:'||RV.roles.indexOf(q.role)<0)continue;'},
 {n:'…a pass already on its way is re-aimed',part:'catch',from:'if(((q.rvUntil||0)>S.time&&!q.rvReady)||(q.rvCd||0)>S.time)continue;',to:'if((q.rvCd||0)>S.time)continue;'},
 {n:'…switched off, mates are still made ready',part:'catch',from:'if(!RV.on||!RD.on||!cands)return;',to:'if(!RV.on||!cands)return;'},
 {n:'a mate is ready with no pose',part:'catch',from:'return q.act===\'recv\'&&!!q.rvReady&&Math.abs(q.angle*q.kickDir-RV.angle)<RD.tol&&',to:'return q.act===\'recv\'&&!!q.rvReady&&'},
 {n:'…or no man on the lane',part:'catch',from:'&&Math.abs(q.baseZ[pk.man]+q.offset-pk.z)<RD.zTol;\n}',to:';\n}'},
 {n:'…or not in the action at all',part:'catch',from:'return q.act===\'recv\'&&!!q.rvReady&&',to:'return !!q.rvReady&&'},
 {n:'…or only for a pass already on its way',part:'catch',from:'return q.act===\'recv\'&&!!q.rvReady&&',to:'return q.act===\'recv\'&&'},
 {n:'a rod busy with something else is waited for',part:'catch',from:'||isUserRod(q)||(q.act&&q.act!==\'recv\'))return true;',to:'||isUserRod(q))return true;'},
 {n:'a human\'s rod is waited for',part:'catch',from:'||isUserRod(q)||(q.act&&q.act!==\'recv\'))return true;',to:'||(q.act&&q.act!==\'recv\'))return true;'},
 {n:'the keeper is waited for',part:'catch',from:'if(RV.roles.indexOf(q.role)<0||isUserRod(q)||(q.act&&',to:'if(isUserRod(q)||(q.act&&'},
 {n:'with the wait off, a mate is still waited for',part:'catch',from:'if(!RV.on||!RD.on||!pk)return true;\n const q=pk.rod;',to:'if(!RV.on||!pk)return true;\n const q=pk.rod;'},
 {n:'a ready rod is not posed until the pass is struck',part:'catch',from:'  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);\n  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n  return;\n }',to:'  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);\n  return;\n }'},
 {n:'…or its man is not put on the lane',part:'catch',from:'  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);\n  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n  return;\n }',to:'  r.aiMan=r.rvMan;\n  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n  return;\n }'},
 {n:'…or it reads the flight that has not begun (through)',part:'catch',from:'if(r.rvReady){                                                       // no pass yet',to:'if(false){                                                       // no pass yet'},
 {n:'a ready rod that cannot reach the lane waits on',part:'catch',from:'  if(r.rvMan<0){recvEnd(r,\'reach\');return;}\n  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);\n  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n  return;',to:'  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);\n  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n  return;'},
 {n:'a real pass leaves the rod "ready" (it is read as waiting, not as a flight)',part:'catch',from:'rx.rvZ=aim.z;rx.rvReady=false;rx.rvRestT=0;}',to:'rx.rvZ=aim.z;rx.rvRestT=0;}'},
 {n:'a pinned ball leaves the rod "ready"',part:'catch',from:'r.catT=0;r.rvUntil=0;r.rvReady=false;return;}',to:'r.catT=0;r.rvUntil=0;return;}'},
 {n:'ending leaves the rod ready',part:'catch',from:'r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;',to:'r.act=null;r.rvUntil=0;r.rvRestT=0;r.aiMan=-1;'},
 {n:'a rod a player takes keeps its ready flag',part:'seat',from:'r.rvUntil=0;r.rvReady=false;',to:''},
 {n:'a rod a player takes keeps its arming',part:'seat',from:'r.rvUntil=0;r.rvReady=false;',to:'r.rvReady=false;'},
 {n:'the foot reach is never asked',part:'catch',from:'if(!RD.feet)return false;',to:'return false;'},
 {n:'…the other team\'s rods count as the team\'s',part:'catch',from:'if(h.team!==r.team)continue;',to:''},
 {n:'…the heel is not in reach',part:'catch',from:'rel>=RD.ownBack&&rel<=RD.ownFront',to:'rel>=0&&rel<=RD.ownFront'},
 {n:'…the reach behind is unlimited',part:'catch',from:'rel>=RD.ownBack&&rel<=RD.ownFront',to:'rel<=RD.ownFront'},
 {n:'…the foot is not in reach',part:'catch',from:'rel>=RD.ownBack&&rel<=RD.ownFront',to:'rel>=RD.ownBack&&rel<=0'},
 {n:'…the reach in front is unlimited',part:'catch',from:'rel>=RD.ownBack&&rel<=RD.ownFront',to:'rel>=RD.ownBack'},
 {n:'…the rod reads the wrong way (the world x, not its own)',part:'catch',from:'const rel=(p.x-h.x)*h.kickDir;',to:'const rel=(p.x-h.x);'},
 {n:'a stopped ball is not waited for (the old ending)',part:'catch',from:'if(!recvRest(r)||S.time-(r.rvRestT||(r.rvRestT=S.time))>=RV.rest){',to:'if(true){'},
 {n:'…it is waited for for ever',part:'catch',from:'||S.time-(r.rvRestT||(r.rvRestT=S.time))>=RV.rest){',to:'){'},
 {n:'…the wait never starts, so it is waited for as long as it lies there',part:'catch',from:'(r.rvRestT||(r.rvRestT=S.time))',to:'(r.rvRestT||0)'},
 {n:'…the pose is not held',part:'catch',from:'r.target=r.offset;r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;   // stopped against the leg: held for the pin',to:'r.target=r.offset;'},
 {n:'…the man is sent after the aim',part:'catch',from:'r.target=r.offset;r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;   // stopped against the leg',to:'r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;   // stopped against the leg'},
 {n:'…a quick ball counts as stopped',part:'catch',from:'Math.hypot(b.v.x,b.v.z-r.vz)<=P.capV)return true;',to:'true)return true;'},
 {n:'…the rod\'s own slide is not discounted',part:'catch',from:'Math.hypot(b.v.x,b.v.z-r.vz)<=P.capV)return true;',to:'Math.hypot(b.v.x,b.v.z)<=P.capV)return true;'},
 {n:'…a ball in the air counts',part:'catch',from:'p.y<=BALL_R+P.yTol&&Math.hypot',to:'Math.hypot'},
 {n:'…a ball nearer than the foot counts',part:'catch',from:'fwd?rel>P.fwdBack&&rel<P.fwdFront:',to:'fwd?rel<P.fwdFront:'},
 {n:'…a ball past the foot counts',part:'catch',from:'fwd?rel>P.fwdBack&&rel<P.fwdFront:',to:'fwd?rel>P.fwdBack:'},
 {n:'…a ball already held counts',part:'catch',from:'if(b.scored||b.pinR)continue;\n  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;\n  if((fwd',to:'if(b.scored)continue;\n  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;\n  if((fwd'},
 {n:'…a scored ball counts',part:'catch',from:'if(b.scored||b.pinR)continue;\n  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;\n  if((fwd',to:'if(b.pinR)continue;\n  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;\n  if((fwd'},
 {n:'a pass arms the passer as well',part:'catch',from:'if(q.team===from.team&&q!==from&&Math.abs(q.x-aim.x)<0.5){rx=q;break;}',to:'if(q.team===from.team&&Math.abs(q.x-aim.x)<0.5){rx=q;break;}'},
 {n:'a pass arms a rod of the other team',part:'catch',from:'if(q.team===from.team&&q!==from&&',to:'if(q!==from&&'},
 {n:'switched off, a pass still arms',part:'catch',from:'if(!RV||!RV.on)return;\n let rx=null;',to:'if(!RV)return;\n let rx=null;'},
 {n:'the arming forgets the flight',part:'catch',from:'rx.rvUntil=S.time+rx.rvFl+RV.pad+RV.grace;',to:'rx.rvUntil=S.time+RV.pad+RV.grace;'},
 {n:'the arming forgets the grace',part:'catch',from:'rx.rvUntil=S.time+rx.rvFl+RV.pad+RV.grace;',to:'rx.rvUntil=S.time+rx.rvFl+RV.pad;'},
 {n:'the arming forgets where the pass was aimed',part:'catch',from:'rx.rvZ=aim.z;',to:''},
 {n:'the arming forgets when it began',part:'catch',from:'rx.rvT0=S.time;',to:''},
 {n:'the whistle does not stop a start',part:'catch',from:'||r.force||(r.rvUntil||0)<=S.time)return false;',to:'||(r.rvUntil||0)<=S.time)return false;'},
 {n:'an expired arming still starts',part:'catch',from:'||r.force||(r.rvUntil||0)<=S.time)return false;',to:'||r.force)return false;'},
 {n:'any role starts',part:'catch',from:'||RV.roles.indexOf(r.role)<0||r.force',to:'||r.force'},
 {n:'a start is not counted',part:'catch',from:'r.rvMan=-1;CAS.recv++;',to:'r.rvMan=-1;'},
 {n:'the pose is tilted the wrong way for a rod looking the other way',part:'catch',from:'r.pinA=RV.angle*dir;',to:'r.pinA=RV.angle;'},
 {n:'the pose is never raised',part:'catch',from:'r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;\n}',to:'\n}'},
 {n:'the raise latch is left on',part:'catch',from:'r.actT+=dt;r.raise=false;r.behindFlag=false;\n if(r.force)',to:'r.actT+=dt;\n if(r.force)'},
 {n:'the man is not put on the line',part:'catch',from:'r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);',to:'r.aiMan=r.rvMan;'},
 {n:'the man never re-aims as the ball\'s line firms up',part:'catch',from:'tAr=Math.max(0,-rel/Math.max(vf,5));za=p.z+b.v.z*tAr;',to:'tAr=Math.max(0,-rel/Math.max(vf,5));'},
 {n:'the man waits at no z before the pass is struck',part:'catch',from:'let za=r.rvZ,tAr=r.rvFl||0.3;',to:'let za=0,tAr=r.rvFl||0.3;'},
 {n:'the last touch is read before the pass has been struck',part:'catch',from:'if(since>=RV.grace&&S.lastTouch!==r.team){recvEnd(r,\'taken\');return;}',to:'if(S.lastTouch!==r.team){recvEnd(r,\'taken\');return;}'},
 {n:'a ball the other team took is still waited for',part:'catch',from:'if(since>=RV.grace&&S.lastTouch!==r.team){recvEnd(r,\'taken\');return;}',to:''},
 {n:'a pass that hops is thought lifted (the AI\'s own height limit)',part:'catch',from:'if(p.y>RV.maxY&&!late)',to:'if(p.y>AIC.lowY&&!late)'},
 {n:'a lifted ball is still waited for',part:'catch',from:'if(p.y>RV.maxY&&!late){recvEnd(r,\'through\');return;}',to:''},
 {n:'with the grace over and no ball it waits on',part:'catch',from:'if(!recvRest(r)||S.time-(r.rvRestT||(r.rvRestT=S.time))>=RV.rest){recvEnd(r,\'through\');return;}',to:''},
 {n:'the flight (or a ready rod no one is looking at) never ends',part:'catch',from:'if((r.rvUntil||0)<=S.time){recvEnd(r,r.rvReady?\'idle\':\'time\');return;}',to:''},
 {n:'a man that cannot reach is posed for anyway',part:'catch',from:'if(r.rvMan<0){recvEnd(r,\'reach\');return;}',to:''},
 {n:'a pinned ball is not handed to the catch',part:'catch',from:'if(r.pinB){CAS.recvPin++;r.act=\'catch\';r.catPh=\'front\';r.catT=0;r.rvUntil=0;r.rvReady=false;return;}',to:'if(r.pinB){CAS.recvPin++;return;}'},
 {n:'…or not counted',part:'catch',from:'if(r.pinB){CAS.recvPin++;r.act=',to:'if(r.pinB){r.act='},
 {n:'…or left armed',part:'catch',from:'r.catT=0;r.rvUntil=0;r.rvReady=false;return;}',to:'r.catT=0;r.rvReady=false;return;}'},
 {n:'ending drops the pose even with a ball pinned',part:'catch',from:'if(!r.pinB){r.pinOn=false;r.pinPose=false;r.pinA=null;}\n r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;',to:'r.pinOn=false;r.pinPose=false;r.pinA=null;\n r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;'},
 {n:'ending leaves the pose up with no ball',part:'catch',from:'if(!r.pinB){r.pinOn=false;r.pinPose=false;r.pinA=null;}\n r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;',to:'r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;'},
 {n:'ending leaves the rod armed',part:'catch',from:'r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;\n if(why',to:'r.act=null;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;\n if(why'},
 {n:'ending is not remembered by reason',part:'catch',from:"CAW['recv:'+why]=(CAW['recv:'+why]||0)+1;",to:''},
 {n:'the ball for a pass is the slowest, not the fastest',part:'catch',from:'if(rel<to&&vf>bv){bv=vf;bb=b;}',to:'if(rel<to&&vf>1&&(!bb||vf<bv)){bv=vf;bb=b;}'},
 {n:'a ball going away is taken for the pass',part:'catch',from:'if(rel<to&&vf>bv){',to:'if(rel<to&&Math.abs(vf)>bv){'},
 {n:'a ball already past the foot is taken for the pass',part:'catch',from:'if(rel<to&&vf>bv){',to:'if(vf>bv){'},
 {n:'a scored ball is taken for the pass',part:'catch',from:'for(const b of S.balls){if(b.scored)continue;const vf=b.v.x*r.kickDir,rel',to:'for(const b of S.balls){const vf=b.v.x*r.kickDir,rel'},
 {n:'a ready rod with a ball running at it times out as it did',part:'catch',from:'if(r.rvReady&&b&&b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY)r.rvUntil=Math.max(r.rvUntil||0,S.time+RV.ready.arrive);',to:''},
 {n:'…a slow ball holds it',part:'catch',from:'if(r.rvReady&&b&&b.v.x*dir>=RV.ready.trackV&&',to:'if(r.rvReady&&b&&b.v.x*dir>=-1e9&&'},
 {n:'…a ball in the air holds it',part:'catch',from:'b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY)r.rvUntil=',to:'b.v.x*dir>=RV.ready.trackV)r.rvUntil='},
 {n:'…and only for this step',part:'catch',from:'S.time+RV.ready.arrive);',to:'S.time);'},
 {n:'…a rod armed for a pass is held on too',part:'catch',from:'if(r.rvReady&&b&&b.v.x*dir>=RV.ready.trackV&&',to:'if(b&&b.v.x*dir>=RV.ready.trackV&&'},
 {n:'a high ball just in front of the rod is let through whatever the lift takes',part:'catch',from:'late=!!b&&-(b.m.position.x-r.x)*dir<=b.v.x*dir*RV.liftT;',to:'late=false;'},
 {n:'…every high ball is held for',part:'catch',from:'late=!!b&&-(b.m.position.x-r.x)*dir<=b.v.x*dir*RV.liftT;',to:'late=!!b;'},
 {n:'…the lift takes no time',part:'catch',from:'<=b.v.x*dir*RV.liftT;',to:'<=b.v.x*dir*0;'},
 {n:'a keeper\'s kick lets go a mate with a ball already running at him',part:'catch',from:'if(from.role===\'GK\'&&GK&&GK.on){const fb=recvBall(q);if(fb&&fb.v.x*q.kickDir>=RD.trackV&&fb.m.position.y<=RV.maxY)continue;}',to:''},
 {n:'…a slow ball is one running at him',part:'catch',from:'if(fb&&fb.v.x*q.kickDir>=RD.trackV&&fb.m.position.y<=RV.maxY)continue;}',to:'if(fb&&fb.v.x*q.kickDir>=-1e9&&fb.m.position.y<=RV.maxY)continue;}'},
 {n:'…a ball over the pin is one running at him',part:'catch',from:'fb.v.x*q.kickDir>=RD.trackV&&fb.m.position.y<=RV.maxY)continue;}',to:'fb.v.x*q.kickDir>=RD.trackV)continue;}'},
 {n:'…every kick keeps him',part:'catch',from:'if(from.role===\'GK\'&&GK&&GK.on){const fb=',to:'if(GK&&GK.on){const fb='},
 {n:'…switched off the keeper still keeps him',part:'catch',from:'if(from.role===\'GK\'&&GK&&GK.on){const fb=',to:'if(from.role===\'GK\'&&GK){const fb='},
 {n:'the keeper never waits for a ready receiver',part:'catch',from:'if(ready&&(r.gkWaitT=(r.gkWaitT||0)+dt)<GK.readyT){r.passEvT=0;return true;}',to:''},
 {n:'…the pass is not looked for again while it waits',part:'catch',from:'{r.passEvT=0;return true;}',to:'{return true;}'},
 {n:'…it waits for ever',part:'catch',from:'(r.gkWaitT=(r.gkWaitT||0)+dt)<GK.readyT)',to:'(r.gkWaitT=(r.gkWaitT||0)+dt)>=0)'},
 {n:'…a mate that is "ready" but not in the receiving action is waited for',part:'catch',from:'if(q.act===\'recv\'&&q.rvReady)ready=true;',to:'if(q.rvReady)ready=true;'},
 {n:'a mate in the lane is not let go',part:'catch',from:' recvRelease(r);\n return(r.gkClearT',to:' return(r.gkClearT'},
 {n:'…and waited for for ever',part:'catch',from:'return(r.gkClearT=(r.gkClearT||0)+dt)<GK.clearT;',to:'return true;'},
 {n:'…the wait for it is not counted',part:'catch',from:'return(r.gkClearT=(r.gkClearT||0)+dt)<GK.clearT;',to:'return(r.gkClearT||0)<GK.clearT;'},
 {n:'a mate with his leg over the ball is waited for',part:'catch',from:'if(q.angle*q.kickDir>GK.clearA&&inLaneZ(q,bp.z,GK.laneZ))blocked=true;',to:'if(inLaneZ(q,bp.z,GK.laneZ))blocked=true;'},
 {n:'…and one out of the lane',part:'catch',from:'if(q.angle*q.kickDir>GK.clearA&&inLaneZ(q,bp.z,GK.laneZ))blocked=true;',to:'if(q.angle*q.kickDir>GK.clearA)blocked=true;'},
 {n:'a ready mate out of the lane is let go after the ready time anyway',part:'catch',from:' if(!blocked)return false;\n recvRelease(r);',to:' recvRelease(r);'},
 {n:'a save is waited on',part:'catch',from:'&&!r.force&&speed<=GK.maxBall){',to:'&&!r.force){'},
 {n:'the whistle does not stop the wait',part:'catch',from:'&&!r.force&&speed<=GK.maxBall){',to:'&&speed<=GK.maxBall){'},
 {n:'any rod waits',part:'catch',from:'if(GK&&GK.on&&r.role===\'GK\'&&',to:'if(GK&&GK.on&&'},
 {n:'switched off, the keeper waits',part:'catch',from:'if(GK&&GK.on&&r.role===\'GK\'&&',to:'if(GK&&r.role===\'GK\'&&'},
 {n:'a rod a human holds is waited for',part:'catch',from:'ahead>GK.reach||isUserRod(q))continue;',to:'ahead>GK.reach)continue;'},
 {n:'a mate behind the keeper is waited for',part:'catch',from:'if(q.team!==r.team||ahead<=0||ahead>GK.reach||',to:'if(q.team!==r.team||ahead>GK.reach||'},
 {n:'…one far ahead',part:'catch',from:'if(q.team!==r.team||ahead<=0||ahead>GK.reach||',to:'if(q.team!==r.team||ahead<=0||'},
 {n:'the other team\'s rod is waited for',part:'catch',from:'if(q.team!==r.team||ahead<=0',to:'if(ahead<=0'},
 {n:'the wait never starts afresh',part:'catch',from:'if(!blocked&&!ready){r.gkWaitT=0;r.gkClearT=0;return false;}',to:'if(!blocked&&!ready){return false;}'},
 {n:'…the ready time is carried over',part:'catch',from:'if(!blocked&&!ready){r.gkWaitT=0;r.gkClearT=0;return false;}',to:'if(!blocked&&!ready){r.gkClearT=0;return false;}'},
 {n:'…the lift time is carried over',part:'catch',from:'if(!blocked&&!ready){r.gkWaitT=0;r.gkClearT=0;return false;}',to:'if(!blocked&&!ready){r.gkWaitT=0;return false;}'}
];
let caught=0;
for(const m of MUT){
 let res;
 try{const x=suite(boot(m));res=x.filter(t=>!t.ok).length;}catch(e){res='THREW '+e.message.split(NL)[0];}
 if(typeof res==='number'&&res>0){caught++;console.log('  caught  ('+res+' assertions)  '+m.n);}
 else console.log('  MISSED  ('+res+')  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
