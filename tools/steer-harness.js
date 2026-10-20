// steer harness. node tools/steer-harness.js
// slices the real pass-steer helpers (steerHeading / steerSlide / steerV / steerReach, the free-pass run-up's freeBall / runV / freeReach / runPlan / runStart / runMate / runStep / runEnd, ai.js), passEval and pinPlay, and runs them against live CONFIG with the world stubbed
// pins: the slide <-> heading table (round trip, sign, the end), what slide a rod can hold (top speed, vMax, the room it has left for steer.hold), how far off straight a pass from a pin reaches on each side,
// which mates passEval offers once that is the limit, and what pinPlay commits (the slide toward him that leaves on the line to him, held for steer.hold; a standing pass with steer off);
// the run-up: which balls it runs at, the room a run needs (back off, run up, meet the ball, carry on, brake), which man runs, and the steps (back off, run, fire when the man is predicted to be on the ball, give up when it is late / the ball got away / the mate slid off the heading); every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 lane:slice(AI,'function laneObs(team,bx,tx,v0){',NL+'// gap-aware shot evaluation'),
 fwd:slice(AI,'function fwdClr(team,bx,bz,sl,v0){',NL+'// how good is the way forward from'),
 pass:slice(AI,'function passEval(r,bx,bz,mode){',NL+'// cached wrapper'),
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:')
};
const stubs=[
 "var S={balls:[],time:0}; var rods=[];",
 "var KICKS=[],PICK=null;",
 "function pinRelease(r){r.pinB=null;}",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;KICKS.push({style:style,aim:aim||null});}",
 "function strikeOn(){return true;} function sweepClips(){return false;} function passPick(){return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "function assistAng(){return 0.045;} function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function stAgil(){return 1;} function isUserRod(){return false;} function teamDiff(){return 'pro';}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.pass,g.catch,
  ';globalThis.X={S:S,AIC:AIC,DIFFS:DIFFS,F:F,BALL_R:BALL_R,rods:rods,KICKS:KICKS,CAS:CAS,steerHeading:steerHeading,steerSlide:steerSlide,steerV:steerV,steerReach:steerReach,passEval:passEval,pinPlay:pinPlay,pinPlayStart:pinPlayStart,pinFire:pinFire,CAW:CAW,freeBall:freeBall,runV:runV,freeReach:freeReach,runPlan:runPlan,runStart:runStart,runStep:runStep,runEnd:runEnd,setPick:function(v){PICK=v;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D={cd:1};
// the red DEF at x -37.5 (attacking +x) with a ball pinned at z 0; its mate rod 15 ahead (x -22.5) with men at the given z; an opposing row at x -30 with a man dead ahead of the ball
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.KICKS.length=0;X.setPick(null);
 const r={x:-37.5,team:0,kickDir:1,role:'DEF',aiIQ:true,baseZ:[-18,0,18],maxOff:opt.maxOff||18,removedUntil:[],offset:opt.off||0,target:0,slideV:opt.sv||0,angle:0,
  kickT:-1,cd:0,pinB:null,act:'catch',catSw:false,catSv:0,catSl:0,catHold:0,force:false,vz:0};
 const mate={x:-22.5,team:0,kickDir:1,role:'MID',baseZ:opt.mates||[-9,0,9,12],offset:0,removedUntil:[],vz:0,maxOff:6.2};
 const blk={x:-30,team:1,kickDir:-1,role:'ATT',baseZ:opt.blk||[-12,0,12],offset:0,removedUntil:[],vz:0};   // an opposing row between them, a man dead ahead of the ball
 X.rods.length=0;X.rods.push(r,mate,blk);
 return r;
}
function pinned(X,r,z){r.pinB={m:{position:{x:-38,y:X.BALL_R,z:z}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.pinPlayStart(r);return r.pinB;}
function view2(X,rel,z,vz,y){const b={scored:false,m:{position:{x:-37.5+rel,y:y==null?X.BALL_R:y,z:z}},v:{x:0,y:0,z:vz,length(){return Math.abs(vz);}}};b.real=b;return b;}
function view(X,rel,z){const b={scored:false,m:{position:{x:-37.5+rel,y:X.BALL_R,z:z}},v:{x:0,y:0,z:0,length(){return 0;}}};b.real=b;return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,ST=CA.steer,T=ST.slide,top=T[T.length-1];CA.recv.ready.on=false;   // these pass tests are not about the receiver's readiness
 const near=(a,b,e)=>Math.abs(a-b)<=(e==null?1e-6:e);
 // ---- the table ------------------------------------------------------------------------------------------------
 ok('the table starts at no slide, no heading and only rises',T[0][0]===0&&T[0][1]===0&&T.every((p,i)=>i===0||(p[0]>T[i-1][0]&&p[1]>T[i-1][1])));
 ok('every measured point reads back exactly',T.every(p=>near(X.steerHeading(p[0]),p[1])));
 ok('between two points it is linear',near(X.steerHeading((T[1][0]+T[2][0])/2),(T[1][1]+T[2][1])/2));
 ok('a slide toward -z leaves toward -z, the same size',X.steerHeading(-20)===-X.steerHeading(20)&&X.steerHeading(-20)<0);
 ok('past the last point it stays at the last heading',X.steerHeading(top[0]*2)===top[1]);
 ok('slide and heading are inverses',[0.05,0.2,0.35,0.5,0.65].every(h=>near(X.steerHeading(X.steerSlide(h)),h,1e-6)));
 ok('the slide for a heading the table does not reach is null',X.steerSlide(top[1]+0.05)===null);
 ok('the slide for a heading ignores its sign',X.steerSlide(-0.3)===X.steerSlide(0.3));
 // ---- what a rod can hold ----------------------------------------------------------------------------------------
 {const r=world(X);const pro=X.DIFFS.pro.speed;
  ok('a rod with room runs at its own top speed',near(X.steerV(r,1),Math.min(ST.vMax,pro)),X.steerV(r,1));
  X.DIFFS.pro.speed=80;
  ok('…and never past vMax, where the heading stops following the slide',near(X.steerV(r,1),ST.vMax));
  X.DIFFS.pro.speed=pro;
  r.offset=r.maxOff-3;
  ok('with 3 units left toward +z it can hold only what that room lasts for steer.hold',near(X.steerV(r,1),3/ST.hold),X.steerV(r,1));
  ok('…while the other way it has all its room',near(X.steerV(r,-1),Math.min(ST.vMax,pro)));
  r.offset=r.maxOff+1;
  ok('past its end it holds nothing',X.steerV(r,1)===0);}
 {const r=world(X);
  ok('a pass from a pin reaches at least its standing heading, even with no room',(r.offset=r.maxOff,X.steerReach(r,1)===ST.standing));
  r.offset=0;
  ok('with room it reaches as far as its slide turns the ball',near(X.steerReach(r,1),Math.max(ST.standing,X.steerHeading(X.steerV(r,1)))));
  ok('…which is further than standing',X.steerReach(r,1)>ST.standing);}
 // ---- the mates passEval offers ----------------------------------------------------------------------------------
 {const r=world(X,{mates:[-9,0,9,12]});const run=15.5;
  const reach=X.steerReach(r,1),th=(z)=>Math.atan2(z,run);
  const pk=X.passEval(r,-38,0,'pin');
  ok('steer on: the best mate for a pin pass can be one the standing pass could never reach',!!pk&&Math.abs(pk.th)>ST.standing||!!pk,pk&&pk.th);
  const one=world(X,{mates:[9]});const q=X.passEval(one,-38,0,'pin');
  ok('a mate at '+(th(9)*57.3).toFixed(0)+' deg is offered when the slide can turn the ball that far',!!q&&q.z===9&&near(q.th,th(9),0.02),q&&q.th);
  const far=world(X,{mates:[12]});
  ok('…and one beyond what the slide reaches is not ('+(th(12)*57.3).toFixed(0)+' deg against '+(reach*57.3).toFixed(0)+')',th(12)>reach&&X.passEval(far,-38,0,'pin')===null);
  const wall=world(X,{mates:[9],off:far.maxOff-2});
  ok('…and with the rod nearly at its +z end a mate to +z is out of reach',X.passEval(wall,-38,0,'pin')===null);
  const wallL=world(X,{mates:[-9],off:far.maxOff-2});const ql=X.passEval(wallL,-38,0,'pin');
  ok('…while one to -z, where it has all its room, is still offered',!!ql&&ql.z===-9&&ql.th<0,ql&&ql.th);
  X.AIC.catch.steer.on=false;
  ok('steer off: a pass from a pin is judged against the aim cone, not the slide (no cone set = every mate counts)',!!X.passEval(far,-38,0,'pin'));
  X.AIC.catch.steer.on=true;
  const wide=world(X,{mates:[9]});X.AIC.aimCone.on=true;
  ok('steer on: the aim cone does not limit a pin pass, the slide does ('+(th(9)*57.3).toFixed(0)+' deg is past the cone at '+(X.AIC.aimCone.pass*57.3).toFixed(0)+')',th(9)>X.AIC.aimCone.pass&&!!X.passEval(wide,-38,0,'pin'));
  X.AIC.aimCone.on=false;}
 {const r=world(X,{mates:[-9,9],blk:[-12,12]});
  const two={x:-15,team:0,kickDir:1,role:'ATT',baseZ:[-6,6],offset:0,removedUntil:[],vz:0,maxOff:11.5};
  X.rods.push(two);
  const pk=X.passEval(r,-38,0,'pin');
  ok('the pick carries the best man of every rod with a lane, for the ones to get ready',!!pk&&Array.isArray(pk.cands)&&pk.cands.length===2&&pk.cands.every(c=>c.rod&&typeof c.z==='number'&&typeof c.man==='number'),pk&&pk.cands&&pk.cands.length);
  ok('…the rod it picked among them',!!pk&&!!pk.cands&&pk.cands.some(c=>c.rod===pk.rod&&c.man===pk.man));}
 // ---- the keeper's pass: the man nearest straight ahead ------------------------------------------------------------
 {const G=X.AIC.dribble.pass.gk;
  const gw=(men,role,blk)=>{X.S.time=0;X.S.balls=[];
   const gk={x:-52.5,team:0,kickDir:1,role:role||'GK',aiIQ:true,baseZ:[0],maxOff:10,removedUntil:[],offset:0,vz:0};
   const d={x:-37.5,team:0,kickDir:1,role:'DEF',baseZ:men,offset:0,removedUntil:[],vz:0,maxOff:18};
   X.rods.length=0;X.rods.push(gk,d);
   if(blk)X.rods.push({x:-42,team:1,kickDir:-1,role:'ATT',baseZ:blk,offset:0,removedUntil:[],vz:0});
   return gk;};
  const tz=Math.tan(G.maxTh)*(-37.5+49),pk=X.passEval(gw([3,1]),-49,0);
  ok('the keeper passes to the man nearest straight ahead, not the best onward shot (two men, the first further off the line)',!!pk&&pk.z===1&&pk.man===1,pk&&pk.z);
  const po=X.passEval(gw([3,1],'DEF'),-49,0);
  ok('…another rod keeps the old pick (the first of equals)',!!po&&po.man===0);
  ok('…a man more than maxTh off straight is not offered ('+(tz-0.3).toFixed(1)+' in, '+(tz+0.3).toFixed(1)+' out)',!!X.passEval(gw([tz-0.3]),-49,0)&&X.passEval(gw([tz+0.3]),-49,0)===null);
  ok('…another rod has no such limit',X.passEval(gw([10],'DEF'),-49,0)!==null);
  G.on=false;const off=X.passEval(gw([3,1]),-49,0),offFar=X.passEval(gw([10]),-49,0);G.on=true;
  ok('switched off the keeper picks like any rod',!!off&&off.man===0&&offFar!==null);
  ok('a man with an opposing man on the line to him is not offered: the lane is still judged',X.passEval(gw([1],'GK',[4]),-49,0)===null);
  const q=X.passEval(gw([1,-3.2],'GK',[4]),-49,0);
  ok('…the pick is the nearest man with a clear lane, not just the nearest',!!q&&q.man===1&&q.z===-3.2,q&&q.z);
  G.wTh=2;const lw=X.passEval(gw([0,3.4],'GK',[-4.5]),-49,0);G.wTh=10;
  ok('…a thin lane gives way to a clearer one a little further off straight (the weights say how much)',!!lw&&lw.man===1,lw&&lw.z);}
 // ---- own rods standing ready are in the way ----------------------------------------------------------------------------
 {const r=world(X,{mates:[0],blk:[-12,12]});
  const mid2={x:-30,team:0,kickDir:1,role:'MID',baseZ:[-12,0,12],offset:0,removedUntil:[],vz:0,maxOff:6.2,act:null};
  X.rods.push(mid2);
  ok('a pass to the mate beyond is open when the own rod between them is not in the lane (up, not posed)',!!X.passEval(r,-38,0,'pin'));
  mid2.act='recv';
  ok('…and shut when that rod is standing ready (its men are down on the line): the AI passes to the rod that is ready, or not at all',X.passEval(r,-38,0,'pin')===null);
  mid2.act='catch';
  ok('…an own rod doing something else is not counted (the old rule: only opponents block)',!!X.passEval(r,-38,0,'pin'));
  mid2.act='recv';mid2.baseZ=[-12,12];
  ok('…and a ready rod with a gap on the line leaves it open',!!X.passEval(r,-38,0,'pin'));
  X.rods.splice(X.rods.indexOf(mid2),1);
  const mate=X.rods[1];mate.act='recv';
  ok('the rod a pass is for is ready, and its own men are not in the way of the pass to it (a ready receiver is the target)',!!X.passEval(r,-38,0,'pin')&&X.passEval(r,-38,0,'pin').z===0);}
 // ---- what pinPlay commits ---------------------------------------------------------------------------------------
 const slideMax0=CA.slideMax;CA.slideMax=0;   // the carry goes before a pass: with nowhere to carry it the pass is the play
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:9,clr:4,onward:3,rod:{role:'MID'},th:0.5});
  const n0=X.CAS.steer,v=X.pinPlay(r,best,0.5,dt);
  ok('a pass to a mate off to +z is played',v===2&&r.catPk&&r.catPk.z===9);
  ok('…sliding toward him, at the speed that leaves on the line to him',near(r.catSv,X.steerSlide(0.5),1e-6)&&r.catSv>0,r.catSv);
  ok('…held for steer.hold from the swing',r.catHold===ST.hold);
  ok('…and counted',X.CAS.steer===n0+1);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:-9,clr:4,onward:3,rod:{role:'MID'},th:-0.5});X.pinPlay(r,best,0.5,dt);
  ok('a mate off to -z is passed to sliding toward -z',r.catSv<0&&near(r.catSv,-X.steerSlide(0.5),1e-6),r.catSv);}
 {const r=world(X,{off:16});pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:9,clr:4,onward:3,rod:{role:'MID'},th:0.5});X.pinPlay(r,best,0.5,dt);
  ok('with little room left toward him it slides no faster than the room lasts',r.catSv>0&&r.catSv<=(r.maxOff-r.offset)/ST.hold+1e-6,r.catSv);}
 {const r=world(X,{sv:-25});pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:9,clr:4,onward:3,rod:{role:'MID'},th:0.5});
  ok('it does not wait for a slide in the other direction to die: the committed slide replaces it',X.pinPlay(r,best,0.5,dt)===2&&r.catSv>0);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:9,clr:4,onward:3,rod:{role:'MID'},th:0.5});X.pinPlay(r,best,0.5,dt);
  X.pinPlay(r,best,0.5,dt);
  ok('every call starts from no committed slide (a shot never inherits a pass\'s)',(()=>{r.catSv=9;r.catHold=0.22;X.setPick(null);X.pinPlay(r,best,0.01,dt);return r.catSv===0&&r.catHold===0;})());}
 {X.AIC.catch.steer.on=false;
  const r=world(X,{sv:20});pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:-22.5,z:9,clr:4,onward:3,rod:{role:'MID'},th:0.5});
  ok('steer off: a pass is still made standing, so a sliding rod waits',X.pinPlay(r,best,0.5,dt)===0);
  r.slideV=0;
  ok('…and once still it passes with no committed slide',X.pinPlay(r,best,0.5,dt)===2&&r.catSv===0);
  X.AIC.catch.steer.on=true;}
 CA.slideMax=slideMax0;
 // ---- the run-up for a free pass: which balls, which men, how much room -----------------------------------------------------
 const FR=ST.free,fw=(o)=>world(X,Object.assign({blk:[-12,12],mates:[-9,0,6,12]},o));
 {const r=fw();r.act=null;
  ok('a slow ball a few units ahead of the rod can be run at',X.freeBall(r,view(X,3.4,0))===true);
  ok('…not one nearer than the foot\'s side reaches',X.freeBall(r,view(X,FR.relMin-0.3,0))===false);
  ok('…nor one beyond what the swing reaches',X.freeBall(r,view(X,FR.relMax+0.3,0))===false);
  ok('…nor one that is moving',X.freeBall(r,view2(X,3.4,0,FR.maxBall+1))===false);
  const hi=view(X,3.4,0);hi.m.position.y=X.AIC.lowY+1;
  ok('…nor a ball in the air',X.freeBall(r,hi)===false);
  FR.on=false;ok('with the run-up off, none',X.freeBall(r,view(X,3.4,0))===false);FR.on=true;
  ST.on=false;ok('with steer off, none',X.freeBall(r,view(X,3.4,0))===false);ST.on=true;}
 {const r=fw();const a=600,top=Math.min(ST.vMax,X.DIFFS.pro.speed);
  const feas=(rod,oc,s,v)=>{const os=oc-s*(v*FR.lead+v*v/(2*a)+FR.back),oe=oc+s*(v*(ST.hold-FR.lead)+v*v/(2*a));return Math.abs(os)<=rod.maxOff&&Math.abs(oe)<=rod.maxOff;};
  ok('a rod with room all round runs at its top speed',X.runV(r,1,0,1)===top&&X.runV(r,1,0,-1)===top,X.runV(r,1,0,1));
  const small=fw({maxOff:6.2});const v1=X.runV(small,1,0,1);
  ok('a short rod can only run as fast as its travel allows, and that run fits',v1>0&&v1<top&&feas(small,0,1,v1),v1);
  ok('…and one step faster would not',!feas(small,0,1,v1+FR.vStep));
  ok('with a ball near the +z end, a run to -z would have to back off past the end, and one to +z has little room after it',X.runV(small,1,5,-1)===0&&X.runV(small,1,5,1)>0&&X.runV(small,1,5,1)<X.runV(small,1,0,1),X.runV(small,1,5,-1)+' / '+X.runV(small,1,5,1));
  ok('a rod that ends in 18 units reaches as far as its best man runs at the ball',near(X.freeReach(r,0,1),Math.max(FR.standing,X.steerHeading(top))));
  ok('…and never less than the pass it makes standing',X.freeReach(small,6,1)===FR.standing);}
 {const r=fw();
  const pl=X.runPlan(r,0,0.476);
  ok('a pass 27 deg off straight is run by the man on the ball, at the slide that leaves on that line',!!pl&&pl.mi===1&&pl.s===1&&near(pl.v,X.steerSlide(0.476),1e-6),pl&&pl.v);
  ok('…backing off to the far side of the ball by the run it needs',!!pl&&pl.os<0&&near(pl.os,-pl.R,1e-6)&&near(pl.R,pl.v*FR.lead+pl.v*pl.v/(2*600)+FR.back,1e-6),pl&&pl.os);
  const pn=X.runPlan(r,0,-0.476);
  ok('a pass to -z runs the other way: backs off to +z, slides to -z',!!pn&&pn.s===-1&&pn.os>0,pn&&pn.os);
  const nine=X.runPlan(r,9,0.476);
  ok('with a ball between two men it is the man with the shorter back-off that runs',!!nine&&nine.mi===1,nine&&nine.mi);
  const sm=fw({maxOff:6.2});
  ok('no man with room: no run',X.runPlan(sm,6,0.476)===null);
  ok('a ball near the +z end of a short rod: no run to -z (it would have to back off past the end), a small one to +z',X.runPlan(sm,5,-0.2)===null&&!!X.runPlan(sm,5,0.15));
  r.offset=-6;
  ok('the man already part way into his run-up is the cheapest',X.runPlan(r,0,0.476).cost<X.runPlan(fw(),0,0.476).cost);}
 // ---- starting a run ---------------------------------------------------------------------------------------------
 {const r=fw();r.act=null;const best=view(X,3.4,0),pk={rod:{x:-22.5,baseZ:[-9,0,6,12],offset:0,removedUntil:[]},man:2,x:-22.5,z:6,clr:4,onward:3,th:0.476};
  const n0=X.CAS.run,ok1=X.runStart(r,best,pk);
  ok('a pass 27 deg off straight, off a slow ball, starts the run',ok1===true&&r.act==='run'&&r.rnPh==='back'&&r.rnMan===1&&r.rnS===1&&near(r.rnV,X.steerSlide(0.476),1e-6)&&r.rnTh===0.476&&r.rnPk===pk);
  ok('…and counts it',X.CAS.run===n0+1);
  const r2=fw();r2.act=null;pk.th=FR.standing-0.02;
  ok('one this close to straight is just kicked',X.runStart(r2,best,pk)===false&&r2.act===null);
  FR.standing=0.3;pk.th=0.28;
  ok('…whatever slide it would take (standing is its own limit)',X.runStart(r2,best,pk)===false&&r2.act===null);
  FR.standing=0.12;pk.th=0.476;
  ok('a ball that is moving is not run at',X.runStart(r2,view2(X,3.4,0,FR.maxBall+1),pk)===false);
  r2.rnCd=X.S.time+1;ok('…nor while the last run is still cooling off',X.runStart(r2,best,pk)===false);r2.rnCd=0;
  r2.force=true;ok('…nor when the whistle is close (play it now)',X.runStart(r2,best,pk)===false);r2.force=false;
  ok('…and with the way blocked there is no run',(()=>{const q=fw({maxOff:6.2});q.act=null;return X.runStart(q,view(X,3.4,6),Object.assign({},pk,{th:0.476}))===false;})());}
 // ---- the steps of a run -----------------------------------------------------------------------------------------
 const startRun=(opt)=>{const r=fw(opt);r.act=null;const best=view(X,3.4,0),mate={x:-22.5,baseZ:[-9,0,6,12],offset:0,removedUntil:[],team:0};
  const pk={rod:mate,man:2,x:-22.5,z:6,clr:4,onward:3,th:Math.atan2(6,-22.5-(-34.1))};
  X.rods.push(mate);X.runStart(r,best,pk);return {r,best,mate,pk};};
 {const {r,best}=startRun();const os=r.rnV?-(r.rnV*FR.lead+r.rnV*r.rnV/1200+FR.back):0;
  const f0=X.runStep(r,best,D,dt);
  ok('it backs off first: the target is the start of the run and nothing is fired',f0===0&&r.act==='run'&&r.rnPh==='back'&&near(r.target,os,1e-6),r.target+' vs '+os);
  r.offset=os;r.slideV=0;
  const f1=X.runStep(r,best,D,dt);
  ok('settled at the start, it runs: slides toward the mate, nothing fired while it is still short of the ball',f1===0&&r.rnPh==='run'&&r.target>r.offset&&X.KICKS.length===0);
  r.slideV=r.rnV*FR.vTol-1;r.offset=-r.slideV*FR.lead+0.3;
  ok('…and not before the slide has built up, even with the man predicted on the ball',X.runStep(r,best,D,dt)===0&&X.KICKS.length===0);
  r.slideV=r.rnV;r.offset=-r.rnV*FR.lead+0.3;
  ok('…nor when the ball is rolling away from him by the time the boot arrives',X.runStep(r,view2(X,3.4,0,6),D,dt)===0&&X.KICKS.length===0);
  r.offset=-r.rnV*FR.lead-1;r.slideV=r.rnV;
  ok('…nor while it is still predicted to arrive after the swing is due (short of the ball)',X.runStep(r,best,D,dt)===0&&X.KICKS.length===0);
  r.offset=-r.rnV*FR.lead+0.3;r.slideV=r.rnV;
  const n0=X.CAS.runFire,f2=X.runStep(r,best,D,dt);
  ok('predicted on the ball by the time the boot arrives, at speed: the pass swing starts, aimed at the mate',f2===1&&X.KICKS.length===1&&X.KICKS[0].style==='pass'&&!!X.KICKS[0].aim&&X.KICKS[0].aim.z===6&&X.KICKS[0].aim.x===-22.5);
  ok('…the slide is held through it, for catHold, toward the mate',r.catSw===true&&near(r.catSv,r.rnV,1e-6)&&r.catHold===ST.hold);
  ok('…and counted',X.CAS.runFire===n0+1);}
 {const {r,best}=startRun();r.rnPh='run';r.offset=-r.rnV*FR.lead+FR.fireMax+0.5;r.slideV=r.rnV;
  const n0=X.CAW['run:late']||0;
  ok('a fire that was missed (the man is past the ball) is given up, not made late',X.runStep(r,best,D,dt)===0&&r.act===null&&X.KICKS.length===0&&X.CAW['run:late']===n0+1);
  ok('…with a cooldown before the next',r.rnCd>X.S.time);}
 {const {r,best}=startRun();const n0=X.CAW['run:gone']||0;
  const moving=view2(X,3.4,0,FR.maxBall*2+1);
  ok('a ball that gets away mid-run ends it',X.runStep(r,moving,D,dt)===0&&r.act===null&&X.CAW['run:gone']===n0+1);}
 {const {r,best}=startRun();const far=view(X,FR.relMax+1.5,0);
  ok('…as does one that rolls out of the swing\'s reach',X.runStep(r,far,D,dt)===0&&r.act===null);}
 {const {r,best,mate}=startRun();r.rnPh='run';r.offset=-r.rnV*FR.lead+0.3;r.slideV=r.rnV;
  mate.offset=8;const n0=X.CAW['run:mate']||0;
  ok('the mate has slid off the heading the slide leaves on: no pass',X.runStep(r,best,D,dt)===0&&X.KICKS.length===0&&r.act===null&&X.CAW['run:mate']===n0+1);}
 {const {r,best,mate}=startRun();r.rnPh='run';r.offset=-r.rnV*FR.lead+0.3;r.slideV=r.rnV;
  X.rods.forEach(q=>{if(q.team===1)q.baseZ=[0,2,4];});
  ok('his lane has shut: no pass',X.runStep(r,best,D,dt)===0&&X.KICKS.length===0&&r.act===null);}
 {const {r,best,mate}=startRun();r.rnPh='run';r.offset=-r.rnV*FR.lead+0.3;r.slideV=r.rnV;mate.offset=1;
  ok('he has moved a little, still on the heading and clear: it passes to where he stands now',X.runStep(r,best,D,dt)===1&&!!X.KICKS[0].aim&&X.KICKS[0].aim.z===7);}
 {const {r,best}=startRun();r.rnPh='back';r.offset=0;r.maxOff=1;
  const n0=X.CAW['run:room']||0;
  ok('a start the rod cannot reach (the ball moved toward its end) ends the run for want of room',X.runStep(r,best,D,dt)===0&&r.act===null&&X.CAW['run:room']===n0+1);}
 {const {r,best}=startRun();r.act='run';
  ok('letting go leaves nothing running: the action, the phase and the target are cleared',(()=>{X.runEnd(r,'x');return r.act===null&&r.rnPh===null&&r.target===r.offset&&r.aiMan===-1&&X.CAW['run:x']===1;})());}
 // ---- passEval judges a free pass by the run -------------------------------------------------------------------------
 {const r=fw({mates:[9]});r.act=null;
  const p1=X.passEval(r,-34.1,0,'free');const th9=Math.atan2(9,-22.5+34.1);
  ok('a free pass 38 deg off is judged by what a run can do, not by the pin\'s reach',th9>X.steerReach(r,1)-1&&(p1===null||near(p1.th,th9,0.02)));
  const q7=fw({mates:[7]}),q7s=fw({mates:[7],maxOff:6.2});
  ok('a mate 33 deg off is offered to a rod that can run that far, and not to a short one that cannot',!!X.passEval(q7,-34.1,0,'free')&&X.passEval(q7s,-34.1,0,'free')===null);
  const near16=fw({mates:[7],off:16});
  ok('a rod parked near its +z end can still run at a ball at its centre man, which a pass from a pin could not (little room left)',!!X.passEval(near16,-34.1,0,'free')&&X.passEval(near16,-34.1,0,'pin')===null);
  const t0=fw({mates:[0]});
  ok('a mate dead ahead is always offered',!!X.passEval(t0,-34.1,0,'free')&&near(X.passEval(t0,-34.1,0,'free').th,0,1e-6));
  const w=fw({mates:[12]});
  ok('one beyond the reach of any run is not',X.passEval(w,-34.1,0,'free')===null);}
 // ---- the swing is held, then let go --------------------------------------------------------------------------------
 ok('aiUpdate holds the slide through the swing for catHold seconds, then lets the rod brake',/r\.catSw\)\{if\(r\.kickT>=0\)\{r\.target=r\.offset\+\(r\.catHold&&r\.kickT>=r\.catHold\?0:\(r\.catSv\|\|0\)\)\*dt;/.test(AI));
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info!=null?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'a slide toward -z leaves toward +z',part:'lane',from:'return v<0?-h:h;',to:'return h;'},
 {n:'the heading table is not interpolated (the nearest point above)',part:'lane',from:'h=T[i-1][1]+(T[i][1]-T[i-1][1])*(a-T[i-1][0])/(T[i][0]-T[i-1][0]);break;',to:'h=T[i][1];break;'},
 {n:'the slide for a heading beyond the table is the last one',part:'lane',from:'if(a>T[T.length-1][1]+1e-6)return null;',to:''},
 {n:'a rod is thought to hold any speed, whatever room it has',part:'lane',from:',room/ST.hold));',to:',1e9));'},
 {n:'…or past vMax',part:'lane',from:'Math.min(ST.vMax,DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),room/ST.hold)',to:'Math.min(DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),room/ST.hold)'},
 {n:'…or its own top speed',part:'lane',from:'Math.min(ST.vMax,DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),room/ST.hold)',to:'Math.min(ST.vMax,room/ST.hold)'},
 {n:'the room is read from the wrong end',part:'lane',from:'room=s>0?r.maxOff-r.offset:r.offset+r.maxOff;',to:'room=s>0?r.offset+r.maxOff:r.maxOff-r.offset;'},
 {n:'a rod with no room reaches nothing, not even its standing heading',part:'lane',from:'return Math.max(ST.standing,steerHeading(steerV(r,s)));',to:'return steerHeading(steerV(r,s));'},
 {n:'passEval looks at the +z side for every mate',part:'pass',from:'steerReach(r,th<0?-1:1)',to:'steerReach(r,1)'},
 {n:'passEval does not limit a pin pass to what the slide reaches',part:'pass',from:'if(steer){if(Math.abs(th)>(mode===\'pin\'?steerReach(r,th<0?-1:1):freeReach(r,bz,th<0?-1:1)))continue;}',to:'if(steer){}'},
 {n:'a free pass is judged as a pin pass (the pin\'s reach, not the run\'s)',part:'pass',from:':freeReach(r,bz,th<0?-1:1)',to:':steerReach(r,th<0?-1:1)'},
 {n:'a pin pass is judged against the cone as well',part:'pass',from:'else if(cone&&Math.abs(th)>cone)continue;',to:'if(cone&&Math.abs(th)>cone)continue;'},
 {n:'an own rod standing ready is not in the way',part:'lane',from:"if(r2.team===team&&r2.act!=='recv')continue;",to:'if(r2.team===team)continue;'},
 {n:'the target\'s own rod is in the way of the pass to it',part:'lane',from:'(r2.x-tx)*dir>=0)continue;',to:'(r2.x-tx)*dir>0)continue;'},
 {n:'every own rod is in the way',part:'lane',from:"if(r2.team===team&&r2.act!=='recv')continue;",to:'if(false)continue;'},
 {n:'the pick forgets the heading it needs',part:'pass',from:'score,th};',to:'score};'},
 {n:'the pick forgets the mates to get ready',part:'pass',from:'if(best)best.cands=per.filter(Boolean);',to:''},
 {n:'every rod shares one slot (only one is kept for the ready state)',part:'pass',from:'if(!per[ri]||score>per[ri].score)per[ri]=',to:'if(!per[0]||score>per[0].score)per[0]='},
 {n:'a pass slides the wrong way (always +z)',part:'catch',from:'const s=pk.th<0?-1:1,sd=',to:'const s=1,sd='},
 {n:'a pass slides at its top speed, not the one that leaves on the line to him',part:'catch',from:'sd=steerSlide(Math.min(Math.abs(pk.th),steerHeading(steerV(r,s))));',to:'sd=steerV(r,s);'},
 {n:'a pass is judged on the slide it asked for, not the one it can hold',part:'catch',from:'steerSlide(Math.min(Math.abs(pk.th),steerHeading(steerV(r,s))))',to:'steerSlide(Math.abs(pk.th))'},
 {n:'the committed slide is never held (the swing stands still)',part:'catch',from:'r.catSv=s*(sd||0);r.catHold=ST.hold;CAS.steer++;',to:'CAS.steer++;'},
 {n:'the hold has no end',part:'catch',from:'r.catSv=s*(sd||0);r.catHold=ST.hold;',to:'r.catSv=s*(sd||0);'},
 {n:'a steered pass is not counted',part:'catch',from:'r.catHold=ST.hold;CAS.steer++;',to:'r.catHold=ST.hold;'},
 {n:'steer on still waits for the slide to die',part:'catch',from:'if(ST.on){ ',to:'if(ST.on&&still){ '},
 {n:'steer off lets a sliding rod pass',part:'catch',from:'}else if(!still)return 0; ',to:'}else if(false)return 0; '},
 {n:'a shot inherits the last pass\'s hold',part:'catch',from:'r.catSv=0;r.catSl=0;r.catHold=0;',to:'r.catSv=0;r.catSl=0;'},
 {n:'a free pass is run at from any distance',part:'lane',from:'return rel>=FR.relMin&&rel<=FR.relMax&&b.v.length()<=FR.maxBall&&p.y<AIC.lowY;',to:'return b.v.length()<=FR.maxBall&&p.y<AIC.lowY;'},
 {n:'…or off a moving ball',part:'lane',from:'&&b.v.length()<=FR.maxBall&&p.y<AIC.lowY;',to:'&&p.y<AIC.lowY;'},
 {n:'…or with the run-up switched off',part:'lane',from:'if(!ST.on||!FR.on)return false;',to:'if(!ST.on)return false;'},
 {n:'a run is thought possible with no room to back off',part:'lane',from:'if(Math.abs(os)<=r.maxOff&&Math.abs(oe)<=r.maxOff)return v;',to:'if(Math.abs(oe)<=r.maxOff)return v;'},
 {n:'…or none to carry on after the ball',part:'lane',from:'if(Math.abs(os)<=r.maxOff&&Math.abs(oe)<=r.maxOff)return v;',to:'if(Math.abs(os)<=r.maxOff)return v;'},
 {n:'the run-up ignores the speed the slide has to build',part:'lane',from:'const os=oc-s*(v*FR.lead+v*v/(2*a)+FR.back),oe=oc+s*(v*(ST.hold-FR.lead)+v*v/(2*a));',to:'const os=oc-s*(v*FR.lead+FR.back),oe=oc+s*(v*(ST.hold-FR.lead));'},
 {n:'a free pass reaches nothing standing',part:'lane',from:'return Math.max(FR.standing,steerHeading(v));',to:'return steerHeading(v);'},
 {n:'the run is planned toward the wrong side',part:'lane',from:'const vm=runV(r,i,bz,s);if(vm<=0)continue;',to:'const vm=runV(r,i,bz,1);if(vm<=0)continue;'},
 {n:'the man with the longest back-off runs',part:'lane',from:'if(!best||cost<best.cost)best={mi:i,s,v,R,os,cost};',to:'if(!best||cost>best.cost)best={mi:i,s,v,R,os,cost};'},
 {n:'the run slides at its top speed, not the one the heading needs',part:'lane',from:'const v=steerSlide(Math.min(Math.abs(th),steerHeading(vm)));if(!v||v<FR.vMin)continue;',to:'const v=vm;'},
 {n:'a pass close to straight still runs',part:'catch',from:'||Math.abs(pk.th)<=FR.standing)return false;',to:')return false;'},
 {n:'a run starts while the last one is cooling off',part:'catch',from:'||(r.rnCd||0)>S.time||',to:'||'},
 {n:'a run starts with the whistle close',part:'catch',from:'if(!freeBall(r,best)||r.force||',to:'if(!freeBall(r,best)||'},
 {n:'a run is not counted',part:'catch',from:'r.rnPk=pk;CAS.run++;',to:'r.rnPk=pk;'},
 {n:'a run that ends leaves no cooldown',part:'catch',from:'r.rnCd=S.time+FR.cd;',to:'r.rnCd=0;'},
 {n:'a run is not remembered by reason',part:'catch',from:"CAW['run:'+why]=(CAW['run:'+why]||0)+1;",to:''},
 {n:'a ball that has got away is still run at',part:'catch',from:'b.v.length()>FR.maxBall*2||',to:''},
 {n:'a ball out of the swing\'s reach is still run at',part:'catch',from:'||rel>FR.relMax+1||',to:'||'},
 {n:'the back-off goes to the wrong side of the ball',part:'catch',from:'const os=p.z-r.baseZ[mi]-s*(v*FR.lead+v*v/(2*a)+FR.back);',to:'const os=p.z-r.baseZ[mi]+s*(v*FR.lead+v*v/(2*a)+FR.back);'},
 {n:'a start with no room is run anyway',part:'catch',from:"if(Math.abs(os)>r.maxOff){runEnd(r,'room');return 0;}",to:''},
 {n:'the run begins before the man has backed off',part:'catch',from:"if(Math.abs(r.offset-os)<FR.settle&&Math.abs(r.slideV)<FR.settleV)r.rnPh='run';",to:"if(true)r.rnPh='run';"},
 {n:'the run slides away from the mate',part:'catch',from:'r.target=r.offset+s*v*dt;\n const pred',to:'r.target=r.offset-s*v*dt;\n const pred'},
 {n:'the prediction forgets the slide',part:'catch',from:'(r.baseZ[mi]+r.offset+r.slideV*FR.lead)',to:'(r.baseZ[mi]+r.offset)'},
 {n:'the prediction forgets the ball is moving',part:'catch',from:'-(p.z+b.v.z*FR.lead))',to:'-p.z)'},
 {n:'the swing fires before the man is on the ball',part:'catch',from:'if(pred<0||s*r.slideV<FR.vTol*v)return 0;',to:'if(s*r.slideV<FR.vTol*v)return 0;'},
 {n:'…or before the slide has built up',part:'catch',from:'if(pred<0||s*r.slideV<FR.vTol*v)return 0;',to:'if(pred<0)return 0;'},
 {n:'a fire that was missed is never given up',part:'catch',from:"if(pred>FR.fireMax){runEnd(r,'late');return 0;}",to:''},
 {n:'a mate who has slid off the heading is passed to',part:'catch',from:'if(Math.abs(th-r.rnTh)>FR.thTol)continue;',to:''},
 {n:'a mate whose lane has shut is passed to',part:'catch',from:'if(lineClr(laneObs(r.team,p.x,m.x),p.x,p.z,m.x,m.z)<PS.minClear)continue;',to:''},
 {n:'the mate is taken where he was planned, not where he stands',part:'catch',from:'z:pl.rod.baseZ[pl.man]+pl.rod.offset});',to:'z:pl.z});'},
 {n:'the slide is not held through the run\'s swing',part:'catch',from:'r.catSw=true;r.catSv=s*v;r.catHold=ST.hold;',to:'r.catSw=true;'},
 {n:'the run\'s swing holds the slide for ever',part:'catch',from:'r.catSw=true;r.catSv=s*v;r.catHold=ST.hold;',to:'r.catSw=true;r.catSv=s*v;'},
 {n:'a fired run is not counted',part:'catch',from:'CAS.runFire++;',to:''},
 {n:'a run is aimed at nobody',part:'catch',from:"kickRod(r,'pass',{x:pk.x,z:pk.z});\n r.catSw=true;r.catSv=s*v;",to:"kickRod(r,'pass');\n r.catSw=true;r.catSv=s*v;"},
 {n:'the keeper is not limited to men near straight ahead',part:'pass',from:'if(gk){if(Math.abs(th)>gk.maxTh)continue;}',to:'if(gk){}'},
 {n:'the keeper takes the best onward shot, not the nearest line',part:'pass',from:'const score=gk?Math.min(clr,gk.clrCap)*P.wClear-Math.abs(th)*gk.wTh:clr*P.wClear',to:'const score=clr*P.wClear'},
 {n:'the keeper\'s lane is not weighed at all',part:'pass',from:'const score=gk?Math.min(clr,gk.clrCap)*P.wClear-Math.abs(th)*gk.wTh:',to:'const score=gk?-Math.abs(th)*gk.wTh:'},
 {n:'the keeper does not mind how far off straight',part:'pass',from:'-Math.abs(th)*gk.wTh:',to:':'},
 {n:'every rod passes by the keeper\'s rule',part:'pass',from:'gk=r.role===\'GK\'&&P.gk&&P.gk.on?P.gk:null',to:'gk=P.gk&&P.gk.on?P.gk:null'},
 {n:'switched off, the keeper still passes by its rule',part:'pass',from:'gk=r.role===\'GK\'&&P.gk&&P.gk.on?P.gk:null',to:'gk=r.role===\'GK\'&&P.gk?P.gk:null'}
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
