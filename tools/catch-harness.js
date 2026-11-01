// catch harness. node tools/catch-harness.js
// slices the real catch block (pinOutlet / pinTarget / pinPlay / pinFire / catchEnd / catchMan / catchPick / catchStep, ai.js) and the lane helpers it reads, and runs them against live CONFIG with bare-bones rods
// pins: which balls are worth catching (front / behind, speed and time windows, reach), the pose timing, the carry (open lane: play it, still or as a push while sliding; else slide to a z that opens, turning round for a better one; else a pass; else wait, then play), the hand-off to retrieve, and every way the action ends; every mutation must break an assertion
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
 ret:slice(AI,'function retrieveMan(r,bz){',NL+'function retrievePhase('),
 clr:slice(AI,'function clearOffset(r,bz,cz,prefer){',NL+'// z of the live foot nearest'),
 lz:slice(AI,'function inLaneZ(r,lz,cz){',NL+'// the teammate behind us'),
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:')
};
const stubs=[
 "var S={balls:[],time:0}; var rods=[]; var DIFFS_T='pro';",
 "var KICKS=[],RELEASED=0,RELK,STRIKE=true,SWEEP=false,PICK=null,PASSED=0;",
 "function pinRelease(r,ext,k){r.pinB=null;RELEASED++;RELK=k;}",
 "function kickRod(r,style,aim,curve){r.kickT=0;r.act=null;KICKS.push({style:style,aim:aim||null,curve:curve||null,ex:r.shotExert,relK:RELK});}",
 "var SEEN=null; function strikeOn(r){SEEN=r?r.target-r.offset:null;return STRIKE;} function sweepClips(){return SWEEP;} function passPick(){PASSED++;return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "var BGS={retEnter:0}; function retrievePhase(r,ph){r.retPh=ph;} function isUserRod(){return false;}",
 "var RNGV=0.99; function rngAi(){return function(){return RNGV;};}",
 "function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.ret,g.clr,g.lz,g.catch,
  ';globalThis.X={S:S,AIC:AIC,SHOT:SHOT,SIM:SIM,F:F,BALL_R:BALL_R,ARM:ARM,ROD_H:ROD_H,DIFFS:DIFFS,rods:rods,KICKS:KICKS,CAS:CAS,CAW:CAW,pinOutlet:pinOutlet,laneObs:laneObs,pushSlope:pushSlope,pushOutlet:pushOutlet,puWant:puWant,puStep:puStep,pushBurst:pushBurst,pinTarget:pinTarget,pinPlayStart:pinPlayStart,pinPlay:pinPlay,pinFire:pinFire,'+
  'catchEnd:catchEnd,catchPick:catchPick,catchStep:catchStep,tapStart:tapStart,tapStep:tapStep,setTapEval:function(f){tapEval=f;},setRng:function(v){RNGV=v;},takeFwd:takeFwd,sidePick:sidePick,meetPick:meetPick,sideStep:sideStep,sideAngle:sideAngle,footAngle:footAngle,footBoxD:footBoxD,thruStep:thruStep,catchUp:catchUp,tapEval:tapEval,released:function(){return RELEASED;},setStrike:function(v){STRIKE=v;},setSweep:function(v){SWEEP=v;},setPick:function(v){PICK=v;},passed:function(){return PASSED;},seen:function(){return SEEN;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120;
function AIC_lowY(X){return X.AIC.lowY;}
// the red ATT (x 22.5, attacking +x) with three men and a ball view; opposing DEF at x 37.5 (men at -1.1 and 22.9) and keeper at 52.5
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.KICKS.length=0;X.setStrike(true);X.setSweep(false);X.setPick(null);
 const r={x:22.5,team:0,kickDir:1,role:'ATT',aiIQ:true,baseZ:[-12,0,12],maxOff:opt.maxOff!=null?opt.maxOff:9,removedUntil:[],offset:0,target:0,slideV:0,angle:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:'catch',catPh:'front',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0};
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:opt.defBase||[0,24],offset:opt.defOff!=null?opt.defOff:-1.1,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff!=null?opt.gkOff:3.5,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?X.BALL_R:y,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
function pinned(X,r,z){r.pinB={m:{position:{x:22.0,y:X.BALL_R,z:z}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.pinPlayStart(r);return r.pinB;}
const D={cd:1};

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch;CA.recv.ready.on=false;CA.recv.settleT=0;CA.recv.tap.first=true;CA.turnT=0;CA.hit.on=false;CA.hit.loose.on=false;   // the tests below that are not about the receiver's readiness, the forward hold or the tap order see none of them
 // ---- the way forward ------------------------------------------------------------------------------------------
 {const r=world(X);const obs=null;
  const o=(z)=>{const ob=[{x:37.5,z:-1.1},{x:37.5,z:22.9},{x:52.5,z:3.5}];return X.pinOutlet(r,22,z,ob,X.F.L/2);};
  ok('ATT: a ball dead in line with a man is blocked, one clear of every man is not',o(0)<0&&o(-6)>=CA.lineClear,'z0='+o(0).toFixed(2)+' z-6='+o(-6).toFixed(2));
  ok('ATT: a straight line that misses the mouth is no way forward',o(-12)<0&&o(12)<0,'z-12='+o(-12).toFixed(2));}
 // ---- pinPlay: the carry ---------------------------------------------------------------------------------------
 {const r=world(X);const b=pinned(X,r,-6);const best=view(X,-0.5,-6);
  ok('an open lane at the ball: play it (shoot)',X.pinPlay(r,best,CA.settleT+0.01,dt)===1);}
 {const r=world(X);const b=pinned(X,r,-6);const best=view(X,-0.5,-6);
  ok('…but only after the held ball has settled',X.pinPlay(r,best,CA.settleT-0.05,dt)===0&&r.target===r.offset);
  r.slideV=(CA.fireV+CA.push.minV)/2;
  ok('…and not while the rod is still sliding slowly (a swing off a drifting rod sprays sideways)',X.pinPlay(r,best,0.5,dt)===0);
  ok('…unless it is late: then it plays on',X.pinPlay(r,best,CA.holdT+0.01,dt)===1);}
 {const r=world(X,{gkOff:-9});const b=pinned(X,r,0);const best=view(X,-0.5,0);
  const v=X.pinPlay(r,best,CA.settleT+0.01,dt);
  ok('blocked here, a z in reach is open: carry to it (target on that side, nothing played)',v===0&&r.target>0.5&&r.pcTz>0,'v='+v+' target='+r.target.toFixed(2)+' pcTz='+r.pcTz);}
 {const r=world(X);const b=pinned(X,r,0);const best=view(X,-0.5,0);
  const v=X.pinPlay(r,best,0.5,dt);
  ok('blocked everywhere in reach and no pass: play nothing',v===0);
  ok('…until holdT, then play it',X.pinPlay(r,best,CA.holdT+0.01,dt)===1);}
 {const r=world(X,{maxOff:0});pinned(X,r,0);const best=view(X,-0.5,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  const v=X.pinPlay(r,best,0.5,dt);
  ok('blocked, nowhere to carry it, and a mate is better placed: pass (to him)',v===2&&r.catPk&&r.catPk.x===7.5);
  X.setStrike(false);
  ok('…but not if the boot would miss on the pass swing',X.pinPlay(r,best,0.5,dt)!==2);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  const c0=X.CAS.carryFirst,v=X.pinPlay(r,best,0.5,dt);
  ok('blocked, a z in reach is better and a mate is better placed: the carry goes before the pass (counted once)',v===0&&r.pcTz!=null&&r.target!==r.offset&&X.CAS.carryFirst===c0+1,'v='+v+' pcTz='+r.pcTz);
  X.pinPlay(r,best,0.6,dt);
  ok('…not once a frame',X.CAS.carryFirst===c0+1);
  r.pcTz=null;r.tapPk=null;r.pcEv=5;
  ok('…and once the carry has nowhere left to go the pass is the play',X.pinPlay(r,best,0.7,dt)===2);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  r.pcEv=5;r.pcTz=null;r.tapPk={j:2,s:1,out:9};const t0=X.CAS.tapFirst;
  ok('…a tap on offer goes before the pass too',X.pinPlay(r,best,0.5,dt,true)===3&&X.CAS.tapFirst===t0+1);}
 {CA.carryFirst=false;const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});r.pcEv=5;r.pcTz=6;r.tapPk={j:2,s:1,out:9};
  ok('carryFirst off: the usual back-tilted pin passes before a carry or a tap (the old rule)',X.pinPlay(r,best,0.5,dt,true)===2);
  const q=world(X);q.catPh='front';q.angle=CA.recv.fwdMin+0.25;pinned(X,q,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});q.pcEv=5;q.pcTz=6;q.tapPk={j:2,s:1,out:9};
  ok('…a forward pin carries or taps first whatever it says',X.pinPlay(q,best,0.5,dt,true)===3);CA.carryFirst=true;}
 {const r=world(X);pinned(X,r,-6);const best=view(X,-0.5,-6);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});X.pinPlay(r,best,0.5,dt);const n0=X.passed();
  ok('an open lane is not worth a look at the passes (the attacker shoots)',X.pinPlay(r,best,0.5,dt)===1&&X.passed()===n0);}
 // ---- an open lane: shoot or pass, by role -------------------------------------------------------------------------------
 {const strong={score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}},weak={score:3,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}},best=view(X,-0.5,-6);
  const mk=(role,pick,opt)=>{const r=world(X,opt||{maxOff:0});r.role=role;pinned(X,r,-6);X.setPick(pick);return r;};
  {const n0=X.passed(),d=mk('DEF',strong),v=X.pinPlay(d,best,0.5,dt);ok('the defence passes an open lane when a mate is on offer',v===2&&d.catPk&&d.catPk.x===7.5&&d.pcWhy==='open-pass'&&X.passed()>n0,'v='+v);}
  {const g=mk('GK',strong);ok('…and so does the keeper',X.pinPlay(g,best,0.5,dt)===2);}
  {const m=mk('MID',strong);ok('a midfielder shoots an open lane unless the mate is much better placed: a strong pass goes',X.pinPlay(m,best,0.5,dt)===2);
   const m2=mk('MID',weak);ok('…a modest one does not: it shoots',X.pinPlay(m2,best,0.5,dt)===1&&m2.pcWhy==='open');}
  {const a=mk('ATT',strong);ok('the attacker shoots an open lane whatever a mate has',X.pinPlay(a,best,0.5,dt)===1);}
  {const d=mk('DEF',null);ok('the defence with no mate to pass to shoots the open lane',X.pinPlay(d,best,0.5,dt)===1);}
  {const d=mk('DEF',strong);X.setStrike(false);ok('…and so does one whose pass swing would miss',X.pinPlay(d,best,0.5,dt)===1);X.setStrike(true);}
  {const d=mk('DEF',strong,{gkOff:-9});const n0=X.CAS.carryFirst;
   ok('an open pass does not wait for a carry (the lane is there now)',X.pinPlay(d,best,0.5,dt)===2&&X.CAS.carryFirst===n0);}
  const def0=CA.open.DEF;delete CA.open.DEF;{const d=mk('DEF',strong);ok('a role with no entry in catch.open shoots (the old rule)',X.pinPlay(d,best,0.5,dt)===1);}CA.open.DEF=def0;
  X.setPick(null);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);r.force=true;
  ok('the dead-ball push plays it at once, lane or not',X.pinPlay(r,best,CA.settleT+0.01,dt)===1);}
 // ---- the push: a shot fired while sliding -------------------------------------------------------------------------
 {const r=world(X);const P=CA.push;
  ok('no push below minV, and the slope follows the slide',X.pushSlope(r,P.minV-1)===0&&X.pushSlope(r,20)>0&&X.pushSlope(r,-20)<0&&Math.abs(X.pushSlope(r,20)-P.k*20)<1e-12);
  r.offset=r.maxOff-1;
  ok('…nor when there is no slide left to carry on through the swing (but the other way is fine)',X.pushSlope(r,20)===0&&X.pushSlope(r,-20)<0);}
 {const mk=(sv)=>{const r=world(X,{defOff:-3,gkOff:-9});pinned(X,r,0);r.slideV=sv;return r;},best=view(X,-0.5,0);
  const r=mk(0);ok('a man in line blocks the straight shot',X.pinPlay(r,best,0.5,dt)===0);
  const p=mk(20);const v=X.pinPlay(p,best,0.5,dt);
  ok('…but a push toward the gap fires (the lane is judged on the line it leaves on)',v===1&&p.catSv===20&&Math.abs(p.catSl-CA.push.k*20)<1e-12,'v='+v+' catSv='+p.catSv);
  const n=mk(-20);ok('…and the same slide the other way, into the man, does not',X.pinPlay(n,best,0.5,dt)===0&&n.catSv===0);
  const m=mk((CA.fireV+CA.push.minV)/2);ok('…a slide between a still shot and a push is judged on nothing',X.pinPlay(m,best,0.5,dt)===0);
  const l=mk((CA.fireV+CA.push.minV)/2);ok('…unless it is late: it plays on, straight, the rod to stop',X.pinPlay(l,best,CA.holdT+0.01,dt)===1&&l.catSv===0);
  const e=mk(20);e.offset=e.maxOff-1;ok('a push with no slide room left is not judged',X.pinPlay(e,best,0.5,dt)===0);
  const sl=mk(0);sl.slideV=1;ok('a rod that has all but stopped shoots still: nothing is carried through the swing',X.pinPlay(mk(1),best,0.5,dt)===0&&mk(1).catSv===0);}
 // a rod that favours passing (catch.open push:false) never shoots on the slide
 {const mk=(role)=>{const r=world(X,{defOff:-3,gkOff:-9});r.role=role;pinned(X,r,0);r.slideV=20;return r;},best=view(X,-0.5,0);
  ok('the defence has no push: a slide gives it no heading',X.pushSlope(mk('DEF'),20)===0&&X.pushSlope(mk('GK'),-20)===0&&X.pushSlope(mk('MID'),20)>0&&X.pushSlope(mk('ATT'),20)>0);
  const d=mk('DEF');ok('…so a carry at speed toward a lane that a push would open fires nothing (it settles, then the still lane decides)',X.pinPlay(d,best,0.5,dt)===0&&d.catSv===0);
  const m=mk('MID');ok('…while a midfielder fires the same push',X.pinPlay(m,best,0.5,dt)===1&&m.catSv===20);}
 // under a forward leg a swing play lets the ball go: not while the rod carries it at speed
 {const mk=(sv,ang)=>{const r=world(X,{defOff:-3,gkOff:-9});pinned(X,r,0);r.slideV=sv;r.angle=ang;return r;},best=view(X,-0.5,0),FW=CA.recv.fwdMin+0.25,n0=X.CAS.fwdBrake;
  const p=mk(20,FW);const v=X.pinPlay(p,best,0.5,dt);
  ok('under a forward leg a push is not fired (the ball would be let go rolling away): the carry goes on, counted',v===0&&p.catSv===0&&X.CAS.fwdBrake===n0+1,'v='+v);
  X.pinPlay(p,best,0.6,dt);
  ok('…counted once for a hold, not once a frame',X.CAS.fwdBrake===n0+1);
  ok('…the same slide under a back-tilted pin is a push, as before',X.pinPlay(mk(20,-0.75),best,0.5,dt)===1);
  ok('…a ball held too long is played on whatever the slide',X.pinPlay(mk(20,FW),best,CA.holdT+0.01,dt)===1);
  CA.recv.fwdBrake=false;ok('…with the brake switched off it fires as a push',X.pinPlay(mk(20,FW),best,0.5,dt)===1);CA.recv.fwdBrake=true;
  const q=world(X);pinned(X,q,-6);q.angle=FW;
  ok('…and a forward leg at rest plays an open lane (catchStep re-seats it)',X.pinPlay(q,view(X,-0.5,-6),0.5,dt)===1);}
 {const r=world(X,{defOff:-5,gkOff:-9});pinned(X,r,0);const best=view(X,-0.5,0);
  ok('a row sliding away from the lane leaves it open',X.pinPlay(r,best,0.5,dt)===1);
  const q=world(X,{defOff:-5,gkOff:-9});pinned(X,q,0);q.rods;X.rods[1].vz=30;
  ok('…the same row sliding INTO it closes it before the ball gets there (ATT)',X.pinPlay(q,best,0.5,dt)===0);
  const m=world(X,{defOff:-5,gkOff:-9});m.role='MID';pinned(X,m,0);X.rods[1].vz=30;
  ok('…and for the other rods (the gap past the row ahead)',X.pinPlay(m,best,0.5,dt)===0&&(()=>{const k=world(X,{defOff:-5,gkOff:-9});k.role='MID';pinned(X,k,0);return X.pinPlay(k,best,0.5,dt)===1;})());}
 {const r=world(X,{defOff:-3,defBase:[0,9,-11,15]});r.role='MID';pinned(X,r,0);const best=view(X,-0.5,0);
  X.pinPlay(r,best,CA.settleT+0.01,dt);
  ok('a z that is shut standing but open pushed the way it would be carried is a target (each side is judged on its own push)',r.pcTz===-4.5,'pcTz='+r.pcTz);}
 // ---- turning round --------------------------------------------------------------------------------------------------
 {const r=world(X,{defOff:-3,gkOff:-9});pinned(X,r,0);const best=view(X,-0.5,0);const f0=X.CAS.flip;
  X.pinPlay(r,best,CA.settleT+0.01,dt);
  ok('the only open z is on the +z side: carry that way',r.target>r.offset&&r.pcTz>0,'pcTz='+r.pcTz);
  X.rods[1].offset=3;X.rods[2].offset=9;r.pcEv=0;r.slideV=0;
  X.pinPlay(r,best,CA.settleT+0.02,dt);
  ok('the lanes move: the only open z is now on the -z side, and it turns round for it',r.target<r.offset&&r.pcTz<0&&X.CAS.flip===f0+1,'pcTz='+r.pcTz+' flips='+(X.CAS.flip-f0));}
 {const r=world(X,{defOff:0,gkOff:0});pinned(X,r,0);const best=view(X,-0.5,0);r.pcTz=4.5;r.pcEv=0;
  X.pinPlay(r,best,CA.settleT+0.01,dt);
  ok('two z\'s as good as each other: it keeps the one it is heading for (no dithering)',r.pcTz===4.5,'pcTz='+r.pcTz);}
 // ---- pinFire ------------------------------------------------------------------------------------------------------
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);
  ok('shoot: a trapShot swing, the rod stands still through it (catSw), cooldown set',X.pinFire(r,best,D,1)===1&&X.KICKS.length===1&&X.KICKS[0].style==='trapShot'&&r.catSw===true&&r.cd>0);}
 {const r=world(X);const best=view(X,-0.5,0);r.catSv=20;r.catSl=CA.push.k*20;r.pinB={m:{position:{x:22,y:X.BALL_R,z:2}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};
  ok('a push: the strike gate is told the slide carries on through the swing, and the aim point sits on the line it leaves on',X.pinFire(r,best,D,1)===1&&Math.abs(X.seen()-20*CA.push.lead)<1e-9&&Math.abs(r.aimEv.best.tz-(2+CA.push.drift*20+(X.F.L/2-22)*CA.push.k*20))<1e-9&&r.catSw,'seen='+X.seen());}
 {const r=world(X);const best=view(X,-0.5,0);r.pinB={m:{position:{x:22,y:X.BALL_R,z:2}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};
  ok('a still shot aims dead ahead (the assist never drags a judged lane toward the middle)',X.pinFire(r,best,D,1)===1&&X.seen()===0&&r.aimEv.best.tz===2);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);X.setStrike(false);
  ok('the strike gate refuses: no swing',X.pinFire(r,best,D,1)===-1&&X.KICKS.length===0);}
 {const r=world(X);const best=view(X,-0.5,0);r.catPk={x:7.5,z:5};
  ok('pass: a pass swing aimed at the receiver',X.pinFire(r,best,D,2)===1&&X.KICKS[0].style==='pass'&&X.KICKS[0].aim.x===7.5&&X.KICKS[0].aim.z===5);}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);r.kickT=0.05;
  ok('mid-swing: nothing more is started',X.pinFire(r,best,D,1)===0&&X.KICKS.length===0);}
 // ---- catchPick: which balls ----------------------------------------------------------------------------------------
 {const r=world(X);r.act=null;
  ok('a ball running at the rod from upfield, in time and in reach: front',X.catchPick(r,view(X,10,0,-20,0))==='front'&&r.catMan>=0);
  ok('…too fast is a shot to block, not a ball to hold',X.catchPick(r,view(X,10,0,-(CA.front.maxClose+10),0))===null);
  ok('…not closing is not coming (a creep at the pin edge included)',X.catchPick(r,view(X,10,0,5,0))===null&&X.catchPick(r,view(X,CA.front.near+0.2,0,-(CA.front.minClose-1),0))===null);
  ok('…not in time to bother (tMax)',X.catchPick(r,view(X,23,0,-10,0))===null);
  ok('…not in reach of any man',X.catchPick(r,view(X,10,38,-20,0))===null);
  X.setSweep(true);
  ok('…not when tilting the leg would shove it',X.catchPick(r,view(X,10,0,-20,0))===null);X.setSweep(false);}
 {const r=world(X);r.act=null;
  ok('a ball coming up from the rod behind: behind',X.catchPick(r,view(X,-10,0,25,0))==='behind');
  ok('…already at the heel is retrieve\'s',X.catchPick(r,view(X,-4,0,25,0))===null&&X.catchPick(r,view(X,-(CA.behind.near-1),0,8,0))===null);
  ok('…running back is not coming',X.catchPick(r,view(X,-10,0,-25,0))===null);
  ok('…too fast to stop at the heel',X.catchPick(r,view(X,-10,0,CA.behind.maxClose+10,0))===null);}
 {const r=world(X);r.act=null;const m=view(X,10,0,-20,6);
  ok('the man is picked for where the ball will be, not where it is',X.catchPick(r,m)==='front'&&r.catO>1,'catO='+r.catO);}
 // ---- catchStep ----------------------------------------------------------------------------------------------------
 {const r=world(X);r.catPh='front';
  X.catchStep(r,view(X,20,0,-20,0),D);
  ok('a ball a second out: slide to it, the leg stays down (no pose yet)',r.act==='catch'&&!r.pinOn&&!r.pinPose&&r.pinA===null);
  X.catchStep(r,view(X,6,0,-20,0),D);
  ok('inside poseT the leg tilts to the pin angle, ahead of the ball',r.pinOn&&r.pinPose&&Math.abs(r.pinA-CA.front.angle)<1e-9,'pinA='+r.pinA);}
 {const r=world(X);r.catPh='behind';X.catchStep(r,view(X,-5,0,25,0),D);
  ok('behind: the boot comes straight down for it',r.pinOn&&r.pinPose&&Math.abs(r.pinA-CA.behind.angle)<1e-9);}
 {const r=world(X);r.catPh='front';X.catchStep(r,view(X,6,0,-20,0),D);const o0=r.target;
  const r2=world(X);r2.catPh='front';X.catchStep(r2,view(X,6,6,-20,0),D);
  ok('the rod slides to the ball\'s z',Math.abs(o0)<0.5&&r2.target>3,'t0='+o0+' t6='+r2.target);}
 for(const [n,rel,vx,vz] of [['past us',-8,-10],['running off',3,8],['stopped short of the pin window, too near to take from above',2.2,-1]]){
  const r=world(X);r.catPh='front';X.catchStep(r,view(X,rel,0,vx,vz||0),D);
  ok('front ends: '+n,r.act===null&&r.catCd>0&&!r.pinOn,'act='+r.act);}
 {const r=world(X);r.catPh='front';r.catT=1;const f0=X.CAS.stoppedFetch;X.catchStep(r,view(X,4.5,0,-1,0),D);
  ok('front: a ball that stopped lying ahead of the leg is taken from above (the catch becomes a fetch, no cooldown, no kick in between)',r.act==='catch'&&r.catPh==='fetch'&&X.CAS.stoppedFetch===f0+1&&r.catCd===0&&r.catT<0.5,'ph='+r.catPh);
  const q=world(X,{defOff:10,gkOff:-20});q.catPh='front';X.catchStep(q,view(X,4.5,1,-1,0),D);
  ok('...unless a shot is open to it: that is the kick\'s',q.act===null&&q.catCd>0);
  X.AIC.catch.fetch.on=false;const w=world(X);w.catPh='front';X.catchStep(w,view(X,4.5,0,-1,0),D);
  ok('...and with the fetch off it ends as it did',w.act===null);X.AIC.catch.fetch.on=true;}
 {const r=world(X);r.catPh='front';const ly=X.AIC.catch.liftY;X.catchStep(r,view(X,10,0,-20,0,ly-0.1),D);
  ok('a ball hopping a little (a pass off the boot) does not end the catch',r.act==='catch');
  const r2=world(X);r2.catPh='front';X.catchStep(r2,view(X,10,0,-20,0,ly+0.1),D);ok('...a ball above liftY does',r2.act===null);}
 {const r=world(X);r.catPh='behind';X.catchStep(r,view(X,-0.2,0,25,0),D);
  ok('behind ends: it has gone past the rod',r.act===null);
  const r2=world(X);r2.catPh='behind';X.catchStep(r2,view(X,-8,0,CA.restV-1,0),D);
  ok('behind ends: it died before the heel',r2.act===null);
  const r3=world(X);r3.catPh='behind';X.catchStep(r3,view(X,-8,0,5,0),D);
  ok('…but a slow roll still arriving is waited for',r3.act==='catch');}
 {const r=world(X);r.catPh='front';X.catchStep(r,view(X,6,0,-20,0,X.AIC.lowY+1),D);
  ok('a ball that has gone up ends it',r.act===null);
  const r2=world(X);r2.catPh='front';r2.force=true;X.catchStep(r2,view(X,6,0,-20,0),D);
  ok('the dead-ball push ends it',r2.act===null);
  const r3=world(X);r3.catPh='front';r3.catT=CA.abortT+0.1;X.catchStep(r3,view(X,6,0,-20,0),D);
  ok('a catch that never lands times out',r3.act===null);}
 {const r=world(X);r.catPh='front';pinned(X,r,-6);const best=view(X,-0.5,-6);
  X.catchStep(r,best,D);
  ok('caught in front: the action turns to holding, the pose frozen where it caught',r.act==='catch'&&r.catPh==='hold'&&r.pinOn&&r.pinPose&&r.pinA===r.angle);
  let steps=0;while(r.act==='catch'&&steps++<200)X.catchStep(r,best,D);
  ok('…carries/plays it, ends with a pin shot, pin flags down, cooldown set',X.KICKS.length===1&&X.KICKS[0].style==='trapShot'&&r.act===null&&!r.pinOn&&r.catCd>0&&r.catSw);}
 {const r=world(X);r.catPh='front';r.angle=CA.recv.fwdMin+0.25;pinned(X,r,-6);const best=view(X,-0.5,-6);const n0=X.CAS.reseat;
  X.catchStep(r,best,D);let steps=0;while(r.act==='catch'&&steps++<200)X.catchStep(r,best,D);
  ok('a ball held under a forward leg (the receiving pose) is not played with a swing: no kick, the pin let go',X.KICKS.length===0&&r.pinB===null&&X.released()>=1);
  ok('…retrieve takes it from the side phase, may pin whatever the iq roll says, and it is counted',r.act==='retrieve'&&r.retPh==='side'&&r.catUntil>X.S.time&&X.CAS.reseat===n0+1&&!r.pinOn&&!r.pinPose,'act='+r.act+' ph='+r.retPh);}
 {const r=world(X);r.catPh='hold';r.catT=1;r.angle=CA.recv.fwdMin+0.25;pinned(X,r,0);const best=view(X,-0.5,0);const n0=X.CAS.reseat;
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  r.pcEv=1e9;r.pcTz=null;r.tapPk=null;   // already holding, nothing to carry or tap to: the pass is the play
  X.catchStep(r,best,D);let steps=0;while(r.act==='catch'&&steps++<200)X.catchStep(r,best,D);
  ok('…and a pass is not made from it either (a mate better placed, the lane shut): it is re-seated, not swung',X.KICKS.length===0&&r.act==='retrieve'&&X.CAS.reseat===n0+1);}
 {const r=world(X,{gkOff:-9});r.catPh='front';r.angle=CA.recv.fwdMin+0.25;pinned(X,r,0);const best=view(X,-0.5,0);const n0=X.CAS.reseat;
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  const v=X.pinPlay(r,best,0.5,dt);
  ok('from a forward pin a carry to a z that opens goes before a pass (the pass would have to re-seat the ball)',v===0&&r.pcTz>0.5&&r.target>0.5&&X.CAS.reseat===n0,'v='+v+' pcTz='+r.pcTz);}
 {const r=world(X);r.catPh='front';r.angle=CA.recv.fwdMin+0.25;pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  r.pcEv=5;r.pcTz=null;r.tapPk={j:2,s:1,out:9};
  ok('…and a tap before a pass',X.pinPlay(r,best,0.5,dt,true)===3);}
 {const r=world(X);r.catPh='front';r.angle=CA.recv.fwdMin+0.25;pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  r.pcEv=5;r.pcTz=null;r.tapPk=null;
  ok('…with neither on offer the pass is the play (and catchStep re-seats it)',X.pinPlay(r,best,0.5,dt,true)===2);}
 {const r=world(X);r.angle=-0.75;pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
  r.pcEv=5;r.pcTz=6;r.tapPk={j:2,s:1,out:9};
  ok('from the usual back-tilted pin a tap on offer goes before the pass too',X.pinPlay(r,best,0.5,dt,true)===3);
  r.tapPk=null;r.pcEv=5;
  ok('…and so does a carry',X.pinPlay(r,best,0.5,dt,true)===0&&r.target!==r.offset);}
 {const r=world(X);r.catPh='front';r.angle=CA.recv.fwdMin+0.25;pinned(X,r,0);const best=view(X,-0.5,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});r.pcEv=5;r.pcTz=6;r.tapPk={j:2,s:1,out:9};
  ok('…and a ball held too long is played whatever the carry could do (late)',X.pinPlay(r,best,CA.holdT+0.01,dt,true)===2);}
 // ---- leaving a forward pin: the leg turns up and forward (recv.lift) ----------------------------------------------------
 {const RV=CA.recv,LF=RV.lift,fwdA=RV.fwdMin+0.25,best=view(X,-0.5,-6);
  const hold=(opt)=>{const r=world(X,opt);r.catPh='hold';r.catT=1;r.angle=fwdA;pinned(X,r,-6);r.pinPose=true;r.pinOn=true;return r;};   // an open lane at z -6: a shot, which from a forward pin is a re-seat
  {const r=hold(),n0=X.CAS.reseat,l0=X.CAS.fwdLift,rel0=X.released();
   X.catchStep(r,best,D);
   ok('a re-seat from a forward pin starts the lift, not a hand-off: the action goes on, the pin is still held, counted',r.act==='catch'&&r.catPh==='flift'&&r.flNext==='retrieve'&&!!r.pinB&&X.released()===rel0&&X.CAS.reseat===n0+1&&X.CAS.fwdLift===l0+1,'ph='+r.catPh);
   r.pinOn=false;r.pinPose=false;r.aiMan=-1;X.catchStep(r,best,D);
   ok('…the leg is asked to turn up and forward, pin on, on the man that held the ball, and the rod braked',r.pinOn===true&&r.pinPose===true&&Math.abs(r.pinA-LF.angle)<1e-9&&r.target===r.offset&&r.aiMan===1);
   r.slideV=LF.restV+5;X.catchStep(r,best,D);
   ok('…a rod still sliding holds the pose until it has stopped: the ball would be let go moving',r.pinA===r.angle&&r.target===r.offset);
   r.slideV=0;r.pinB=null;r.angle=LF.done-0.1;X.catchStep(r,best,D);
   ok('…the pin lets go by itself (the turn): the leg keeps going up until it is lifted',r.act==='catch'&&r.catPh==='flift'&&Math.abs(r.pinA-LF.angle)<1e-9&&r.target===r.offset);
   r.angle=LF.done+0.01;X.catchStep(r,best,D);
   ok('…then retrieve takes it from the side phase: the leg held up, the real ball read for a while, the iq roll waived',r.act==='retrieve'&&r.retPh==='side'&&r.retFl===true&&r.retKnow>X.S.time&&r.catUntil>X.S.time&&r.catPh===null);}
  {const r=hold();X.catchStep(r,best,D);const rel0=X.released();let n=0;while(r.act==='catch'&&n++<200)X.catchStep(r,best,D);
   ok('a pin that never lets go is let go in place after abortT and the re-seat goes on',r.act==='retrieve'&&X.released()===rel0+1&&Math.abs(n*dt-LF.abortT)<0.05,'n='+n);}
  {LF.on=false;const r=hold(),n0=X.CAS.reseat,l0=X.CAS.fwdLift;X.catchStep(r,best,D);
   ok('with the lift switched off it is the old hand-off: retrieve at once, no flag',r.act==='retrieve'&&r.retFl===false&&X.CAS.fwdLift===l0&&X.CAS.reseat===n0+1);LF.on=true;}
  // a tap from a forward pin
  {X.setTapEval(()=>({j:2,s:1,out:9}));
   const blocked=(ang)=>{const r=world(X,{gkOff:-9});r.catPh='hold';r.catT=1;r.angle=ang;pinned(X,r,0);return r;},b0=view(X,-0.5,0);
   {const r=blocked(fwdA),f0=X.CAS.fwdTap,v=X.pinPlay(r,b0,0.5,dt,true);
    ok('from a forward pin a neighbour with an open lane is tapped to even when the carry has a z that opens too (it lands as a back pin)',v===3&&r.tapPk&&r.tapPk.j===2&&r.pcTz>0.5,'v='+v);
    ok('…and it is counted once for a hold',X.CAS.fwdTap===f0+1&&(X.pinPlay(r,b0,0.5,dt,true),X.CAS.fwdTap===f0+1));}
   {const r=blocked(fwdA),v=X.pinPlay(r,b0,0.5,dt);ok('…a caller that does not ask for the tap (the carry alone) gets the carry',v===0&&r.tapPk===null&&r.pcTz>0.5,'v='+v);}
   {LF.on=false;const r=world(X);r.catPh='hold';r.catT=1;r.angle=fwdA;pinned(X,r,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});r.pcEv=5;r.pcTz=null;r.tapPk={j:2,s:1,out:9};
    ok('with the lift off a tap on offer still goes before a pass (the old rule)',X.pinPlay(r,view(X,-0.5,0),0.5,dt,true)===3);
    const c=world(X,{gkOff:-9});c.catPh='hold';c.catT=1;c.angle=fwdA;pinned(X,c,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});
    const vc=X.pinPlay(c,view(X,-0.5,0),0.5,dt,true);
    ok('…and a carry to a z that opens goes before a pass (the old rule: the carry is looked for first)',vc===0&&c.pcTz>0.5,'v='+vc);LF.on=true;X.setPick(null);}
   {const r=blocked(-0.75),v=X.pinPlay(r,b0,0.5,dt,true);ok('…a back-tilted pin carries as before (the tap is looked at only when the carry finds nothing)',v===0&&r.tapPk===null&&r.pcTz>0.5,'v='+v);}
   {RV.tap.on=false;const r=blocked(fwdA),v=X.pinPlay(r,b0,0.5,dt,true);RV.tap.on=true;ok('…with the tap switched off it carries',v===0&&r.tapPk===null);}
   {LF.on=false;const r=blocked(fwdA),v=X.pinPlay(r,b0,0.5,dt,true);LF.on=true;ok('…and with the lift off (the tap could not get away clean)',v===0&&r.tapPk===null);}
   {const r=blocked(fwdA);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});r.pcEv=0;
    const f0=X.CAS.fwdTap;
    ok('a pass wanted from a forward pin is a tap to a neighbour first (a pass would have to re-seat the ball)',X.pinPlay(r,b0,0.5,dt,true)===3&&X.CAS.fwdTap===f0+1);
    ok('…counted once for the hold, not once a frame',(X.pinPlay(r,b0,0.5,dt,true),X.CAS.fwdTap===f0+1));X.setPick(null);}
   {const r=world(X);r.catPh='hold';r.catT=1;r.angle=fwdA;pinned(X,r,-6);
    ok('an open lane where the ball is stays a shot (a re-seat), not a tap',X.pinPlay(r,best,0.5,dt,true)===1);
    RV.tap.open=true;r.pcEv=0;r.tapPk=null;
    ok('…unless tap.open says to tap even then',X.pinPlay(r,best,0.5,dt,true)===3);RV.tap.open=false;}
   {const r=blocked(fwdA);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});r.pcEv=0;
    ok('…and a ball held too long is played whatever a neighbour could do (late)',X.pinPlay(r,b0,CA.holdT+0.01,dt,true)===2);X.setPick(null);}
   X.setTapEval(()=>null);}
  {const r=hold();r.tapPk={j:2,s:1,out:9};X.tapStart(r);
   ok('a tap started under a forward leg is marked: it lets go by turning up',r.catPh==='tap'&&r.tapF===true);
   const q=world(X);q.angle=-0.75;pinned(X,q,0);q.tapPk={j:2,s:1,out:9};X.tapStart(q);
   ok('…a back-tilted pin is not',q.tapF===false);
   const rel1=X.released();q.slideV=1000;q.pinPose=true;q.pinA=q.angle;X.tapStep(q,best);
   ok('…and it lets go as before: the pin released, the side phase on, the pose NOT dropped in that frame (it would swing the boot forward through the ball)',q.catPh==='side'&&X.released()===rel1+1&&q.pinOn===false&&q.pinPose===true&&q.pinA===q.angle);
   LF.on=false;const w=hold();w.tapPk={j:2,s:1,out:9};X.tapStart(w);LF.on=true;
   ok('…nor with the lift off',w.tapF===false);}
  {const r=hold();r.tapPk={j:2,s:1,out:9};X.tapStart(r);const rel0=X.released();
   r.slideV=0;X.tapStep(r,best);
   ok('the tap runs with the pin held until the rod has the speed',r.catPh==='tap'&&X.released()===rel0&&r.target>r.offset);
   r.slideV=1000;X.tapStep(r,best);
   ok('…at the speed it does not let go in place: the leg turns up and the rod runs on (lift, then the tap)',r.catPh==='flift'&&r.flNext==='tap'&&X.released()===rel0&&!!r.pinB);
   X.catchStep(r,best,D);
   ok('…the rod keeps running toward the receiver while the leg turns up',r.target>r.offset&&Math.abs(r.pinA-LF.angle)<1e-9);
   r.pinB=null;r.angle=LF.done+0.01;const t0=X.CAS.tap;X.catchStep(r,best,D);
   ok('…the pin let go and the leg up: the receiving man takes it as a side catch (chain and tap counted, rod braked, not deep)',r.catPh==='side'&&r.catMan===2&&r.catSg===1&&r.tapN===1&&r.tapPend===true&&r.target===r.offset&&!r.pinOn&&r.tapF===false&&r.catDeep===false&&X.CAS.tap===t0+1);}
  {const r=hold();r.tapPk={j:2,s:1,out:9};X.tapStart(r);r.slideV=1000;X.tapStep(r,best);r.pinB=null;r.angle=0.2;r.catT=LF.abortT+0.1;X.catchStep(r,best,D);
   ok('a lift that is slow to come up is given up on after abortT: the tap goes on',r.catPh==='side'&&r.catMan===2);}}
 // ---- a forward pin is held a while, carried, before anything is played; the carry goes before a tap ----------------------------
 {const RV=CA.recv,fwdA=RV.fwdMin+0.25,best=view(X,-0.5,-6);RV.settleT=0.6;
  {const r=world(X);r.catPh='hold';r.angle=fwdA;pinned(X,r,-6);
   ok('a ball under a forward leg is held before anything is played, an open lane or not',X.pinPlay(r,best,0.4,dt,true)===0);
   ok('…then the open lane is played',X.pinPlay(r,best,RV.settleT+0.01,dt,true)===1);}
  {const r=world(X);r.catPh='hold';r.angle=-0.75;pinned(X,r,-6);
   ok('…a back-tilted pin is not held longer: it shoots at once',X.pinPlay(r,best,CA.settleT+0.01,dt,true)===1);}
  {const r=world(X);r.catPh='hold';r.angle=fwdA;pinned(X,r,-6);r.force=true;
   ok('…nor when the whistle is close (the dead-ball push plays it)',X.pinPlay(r,best,0.4,dt,true)===1);}
  {const r=world(X,{gkOff:-9});r.catPh='hold';r.angle=fwdA;pinned(X,r,0);const v=X.pinPlay(r,view(X,-0.5,0),0.4,dt,true);
   ok('…but it is carried meanwhile: a z that opens is headed for',v===0&&r.pcTz>0.5&&r.target>0.5,'v='+v+' pcTz='+r.pcTz);}
  {const mm={role:'MID',team:0,kickDir:1,angle:0,act:null,baseZ:[0],offset:0};
   const r=world(X);r.catPh='hold';r.angle=fwdA;pinned(X,r,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:mm,man:0,cands:[{rod:mm,man:0,z:5,score:30}]});
   X.pinPlay(r,view(X,-0.5,0),0.4,dt,true);
   ok('…and the mates are not made ready for a pass while it is held',!mm.rvReady);X.setPick(null);}
  {X.setTapEval(()=>({j:2,s:1,out:9}));RV.tap.first=true;
   const r=world(X,{gkOff:-9});r.catPh='hold';r.angle=fwdA;pinned(X,r,0);
   ok('…and no tap is looked at while it is held, even with the tap first',X.pinPlay(r,view(X,-0.5,0),0.4,dt,true)===0&&r.tapPk===null);
   RV.tap.first=false;
   const c=world(X,{gkOff:-9});c.catPh='hold';c.angle=fwdA;pinned(X,c,0);const vc=X.pinPlay(c,view(X,-0.5,0),RV.settleT+0.01,dt,true);
   ok('with the carry first, a z that opens goes before a neighbour with a lane (the carry is what the AI does with a forward pin)',vc===0&&c.tapPk===null&&c.pcTz>0.5,'v='+vc);
   const n=world(X);n.catPh='hold';n.angle=fwdA;pinned(X,n,0);
   ok('…and the tap is for when the carry finds nothing',X.pinPlay(n,view(X,-0.5,0),RV.settleT+0.01,dt,true)===3);
   RV.tap.first=true;X.setTapEval(()=>null);}
  RV.settleT=0;}

 // ---- taking a ball under a forward leg: the choice, the side catch, the ball let through, the ball from behind ------------------------
 {const TK=CA.recv.take,TH=TK.thru,TBH=TK.behind,RV=CA.recv,dirx=1,fwdA=RV.fwdMin+0.25;
  const pose=(r)=>({pinOn:r.pinOn,pinPose:r.pinPose,pinA:r.pinA,raise:r.raise});
  // takeFwd: only when no shot is open where it arrives, and by chance
  {const r=world(X);X.setRng(0);
   ok("a ball that would find the lane shut is taken forward (the chance says yes)",X.takeFwd(r,22,0)===true&&X.CAS.take>0);
   ok("...not one that would find a shot open (it is pinned as usual, ready to shoot)",X.takeFwd(r,22,-6)===false);
   X.setRng(0.99);ok("...and the chance can say no",X.takeFwd(r,22,0)===false);
   X.setRng(TK.share-0.01);ok("...the share is the chance",X.takeFwd(r,22,0)===true);X.setRng(TK.share+0.01);ok("...just over it is not",X.takeFwd(r,22,0)===false);
   X.setRng(0);
   TK.on=false;ok("the switch turns it off",X.takeFwd(r,22,0)===false);TK.on=true;
   RV.lift.on=false;ok("...and so does the lift (a forward pin that could not be let go clean)",X.takeFwd(r,22,0)===false);RV.lift.on=true;
   RV.on=false;ok("...and the receiving pose",X.takeFwd(r,22,0)===false);RV.on=true;
   const g=world(X);g.role="GK";ok("a role that does not take the pose (the keeper) never does",X.takeFwd(g,22,0)===false);
   const c0=X.CAS.take;X.takeFwd(r,22,-6);ok("a shot open is not counted as a ball that could be taken",X.CAS.take===c0);X.setRng(0.99);}
  // the side catch: behind the rod the back foot comes down on the ball, ahead of it the forward foot (where it is decides, not the lanes)
  {const r=world(X);X.setRng(0);ok("a ball rolling along the row behind the rod is taken by the back foot, whatever the lanes",X.sidePick(r,view(X,-3.0,-8,0,10))===true&&r.catFwd===false,"fwd="+r.catFwd);
   const q=world(X);ok("...one ahead of it by the forward foot",X.sidePick(q,view(X,3.5,-8,0,10))===true&&q.catFwd===true,"fwd="+q.catFwd);X.setRng(0.99);}
  {const mk=(over)=>{const r=world(X,Object.assign({defOff:-6},over||{}));r.catPh="side";r.catMan=1;r.catSg=1;r.catFwd=true;return r;};
   const up=mk(),bu=view(X,3.5,-8,0,10);X.sideStep(up,bu);
   ok("a forward side catch: while the ball rolls in the leg is up and forward, not raised back, and the pin is off",up.pinOn===false&&up.pinPose===true&&Math.abs(up.pinA-CA.recv.lift.angle)<1e-9&&up.raise===false,JSON.stringify(pose(up)));
   const dn=mk(),bd=view(X,3.5,-2,0,10);X.sideStep(dn,bd);
   const want=X.footAngle(3.5,true);
   ok("...and the forward foot comes down onto it, a forward pin",dn.pinOn===true&&dn.pinPose===true&&dn.pinFwd===true&&dn.pinA>0&&Math.abs(dn.pinA-want)<1e-9,"pinA="+dn.pinA);
   const gap=X.footBoxD({x:0,kickDir:1,angle:want},{x:3.5,y:X.BALL_R,z:0},0,[0,0])-X.BALL_R;
   ok("...topGap above the ball",Math.abs(gap-CA.side.topGap)<0.01,"gap="+gap.toFixed(3));
   ok("the back pose is on the other side of the rod",X.footAngle(-3.0,false)<0&&X.footAngle(3.5,true)>0);
   const bk=mk({});bk.catFwd=false;X.sideStep(bk,view(X,-3.0,-8,0,10));
   ok("a side catch as usual raises the men back and over, as before",bk.raise===true&&bk.pinPose===false&&bk.pinOn===false);
   }
  {const r=world(X);r.catFwd=true;X.catchUp(r);ok("the men up for a forward leg: forward and up, nothing raised back",r.pinPose===true&&r.pinOn===false&&r.raise===false&&Math.abs(r.pinA-CA.recv.lift.angle)<1e-9);
   const q=world(X);q.catFwd=false;X.catchUp(q);ok("...and as usual: back and over",q.pinPose===false&&q.pinOn===false&&q.raise===true&&q.pinA===null);}
  // the meet: a slow ball along the row that no man will roll into
  {const mp=(rel)=>{const r=world(X,{defOff:-6});X.setRng(0);const got=X.meetPick(r,view(X,rel,-6,0,3));return {r,got};};
   const a=mp(-3.0);ok("a slow ball behind the rod is met by the back foot, whatever the lanes",a.got===true&&a.r.catFwd===false,"got="+a.got+" fwd="+a.r.catFwd);
   const b=mp(3.5);ok("...one ahead of it by the forward foot",b.got===true&&b.r.catFwd===true,"got="+b.got+" fwd="+b.r.catFwd);X.setRng(0.99);}
  // a ball let through: picked, the leg up while it rolls under, down onto it
  {const thW=TH.on;TH.on=true;const r=world(X);X.setRng(0);const pick=(rel,vx,vz,over,y)=>{const q=world(X,over);return {q,ph:X.catchPick(q,view(X,rel,0,vx,vz,y))};};   // off in CONFIG: its own tests switch it on
   const a=pick(12,-10,0);
   ok("a slow ball running at the rod from upfield, to a man whose lane is shut: let through",a.ph==="thru"&&a.q.catFwd===true,a.ph);
   ok("...the man is the one it will arrive at",a.q.catMan===1);
   ok("...too near for the leg to go up and forward without striking it: not",pick(TH.near-1,-10,0).ph==="front");
   ok("...too far (at the feet of the rod in front)",pick(TH.far+1.5,-12,0).ph==="front");
   {const tm=CA.front.tMax;CA.front.tMax=10;ok("...too slow to be worth waiting for",pick(12,-(TH.minV-1),0).ph==="front");CA.front.tMax=tm;}
   ok("...too quick for the pin to hold",pick(12,-(TH.maxV+2),0).ph==="front");
   ok("...a ball with a sideways speed the pin could not hold",pick(12,-10,TH.maxVZ+2).ph==="front");
   ok("...a ball in the air",pick(12,-10,0,null,AIC_lowY(X)+0.5).ph==="front"||pick(12,-10,0,null,AIC_lowY(X)+0.5).ph===null);
   X.setRng(0.99);ok("...by chance it is caught as usual",pick(12,-10,0).ph==="front");X.setRng(0);
   ok("...with the lane open (z -6) it is caught as usual, ready to shoot",(()=>{const q=world(X);return X.catchPick(q,view(X,12,-6,-10,0));})()==="front");
   TH.on=false;ok("...the switch",pick(12,-10,0).ph==="front");TH.on=true;
   ok("...a front ball not let through leaves the style as usual",pick(12,-30,0).q.catFwd===false);X.setRng(0.99);TH.on=thW;}
  {const mk=(props)=>{const r=world(X);r.catPh="thru";r.catFwd=true;r.catMan=1;r.catO=0;r.catT=0;return Object.assign(r,props||{});};X.setRng(0);
   const up=mk(),bu=view(X,12,0,-10,0);X.thruStep(up,bu);
   ok("a ball let through, still far: the leg is up and forward, pin off, the man on its line",up.pinOn===false&&up.pinPose===true&&Math.abs(up.pinA-CA.recv.lift.angle)<1e-9&&up.aiMan===1&&up.target===0&&up.act==="catch");
   const c=10,relD=TH.catchRel+TH.dropT*c-0.05,dn=mk(),bd=view(X,relD,0,-c,0);X.thruStep(dn,bd);
   ok("...it comes down when the ball is dropT from where it rests (catchRel) behind the rod",dn.pinOn===true&&dn.pinPose===true&&Math.abs(dn.pinA-CA.recv.angle)<1e-9,"relD="+relD.toFixed(2));
   const bf=mk(),bb=view(X,TH.catchRel+TH.dropT*c+0.8,0,-c,0);X.thruStep(bf,bb);
   ok("...and not before",bf.pinOn===false);
   const ends=(name,why,b,over)=>{const q=mk(over);const n0=X.CAW["thru:"+why]||0;X.thruStep(q,b);ok("a ball let through ends: "+name,q.act===null&&(X.CAW["thru:"+why]||0)===n0+1&&!q.pinPose&&q.catFwd===false,"act="+q.act);};
   ends("it scored","scored",Object.assign(view(X,10,0,-10,0),{scored:true}));
   ends("it went up","lifted",view(X,10,0,-10,0,AIC_lowY(X)+0.5));
   ends("the whistle is close","force",view(X,10,0,-10,0),{force:true});
   ends("it took too long","time",view(X,10,0,-10,0),{catT:TH.abortT+0.1});
   ends("it rolled through","past",view(X,TH.catchRel-TH.past-0.2,0,-10,0));
   ends("it bounced back upfield","away",view(X,10,0,10,0));
   ends("it stopped short of the rod","stopped",view(X,10,0,-1,0));
   const pn=mk();pn.pinB={m:{position:{x:22.5-0.8,y:X.BALL_R,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.pinPlayStart(pn);const o0=X.CAS.thruOk;
   X.catchStep(pn,view(X,-0.8,0,0,0),D);
   ok("pinned: the action goes to the hold, counted, like any catch",pn.catPh==="hold"&&X.CAS.thruOk===o0+1);
   const di=mk();X.catchStep(di,view(X,12,0,-10,0),D);ok("catchStep runs it",di.pinPose===true&&di.pinOn===false);X.setRng(0.99);}
  // a ball from behind, held in the receiving pose
  {const pick=(rel,vx,over)=>{const q=world(X,over);return {q,ph:X.catchPick(q,view(X,rel,0,vx,0))};};X.setRng(0);
   const a=pick(-10,25);
   ok("a ball coming up from the rod behind, to a man whose lane is shut: caught in the receiving pose",a.ph==="behind"&&a.q.catFwd===true,a.ph+" "+a.q.catFwd);
   X.setRng(0.99);ok("...or as usual, by chance (at the heel, for retrieve)",pick(-10,25).q.catFwd===false);X.setRng(0);
   ok("...a lane open: as usual",(()=>{const q=world(X);const ph=X.catchPick(q,view(X,-10,-6,25,0));return ph==="behind"&&q.catFwd===false;})());
   TBH.on=false;ok("...the switch",pick(-10,25).q.catFwd===false);TBH.on=true;
   ok("a ball running at the rod (front) takes no part: it is not a ball from behind",pick(12,-30).q.catFwd===false);
   const mk=(rel,vx,over)=>{const r=world(X,over);r.catPh="behind";r.catFwd=true;r.catMan=1;r.catO=0;return {r,b:view(X,rel,0,vx,0)};};
   const near=mk(-(0.45*10+TBH.stop-0.3),10);X.catchStep(near.r,near.b,D);
   ok("held forward: the pose goes on poseT before it arrives at where it rests (stop), at the receiving angle",near.r.pinOn===true&&near.r.pinPose===true&&Math.abs(near.r.pinA-CA.recv.angle)<1e-9,"pinA="+near.r.pinA);
   const far=mk(-(0.45*10+TBH.stop+0.5),10);X.catchStep(far.r,far.b,D);ok("...and not before",far.r.pinOn===false);
   const bk=mk(-(0.45*10+TBH.stop-0.3),10);bk.r.catFwd=false;X.catchStep(bk.r,bk.b,D);
   ok("as usual the pose is the straight one, at the heel's own timing",bk.r.pinA===0&&bk.r.pinOn===true);
   const pn=mk(-0.8,0);pn.r.pinB={m:{position:{x:22.5-0.8,y:X.BALL_R,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.pinPlayStart(pn.r);const h0=X.CAS.hand,k0=X.CAS.behindOk;
   X.catchStep(pn.r,pn.b,D);
   ok("pinned in the receiving pose it is HELD (carried, tapped), not handed to retrieve, and counted",pn.r.catPh==="hold"&&pn.r.act==="catch"&&X.CAS.hand===h0&&X.CAS.behindOk===k0+1);
   const hd=mk(-3.4,0);hd.r.catFwd=false;hd.r.pinB={m:{position:{x:22.5-3.4,y:X.BALL_R,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.pinPlayStart(hd.r);X.catchStep(hd.r,hd.b,D);
   ok("...a ball pinned at the heel is handed on as before",X.CAS.hand===h0+1&&hd.r.act===null);
   // a ball stopped dead against the leg is waited on for the pin
   const sl=mk(3.0,0);X.S.balls=[sl.b];sl.r.catT=0;X.S.time=1;
   X.catchStep(sl.r,sl.b,D);ok("a ball the forward foot has stopped dead (in the pin window) keeps the pose for a moment: the pin takes it on the next physics step",sl.r.act==="catch"&&sl.r.pinOn===true);
   X.S.time=1+CA.recv.rest+0.05;X.catchStep(sl.r,sl.b,D);ok("...not for ever",sl.r.act===null&&(X.CAW.slow||0)>=1);
   const sm=mk(-6,0);X.S.balls=[sm.b];X.S.time=5;X.catchStep(sm.r,sm.b,D);ok("a ball that has simply stopped short of the pin window is over at once",sm.r.act===null);
   const p1=mk(0.4,10);X.catchStep(p1.r,p1.b,D);ok("a ball just past the pivot is not yet past a forward catch",p1.r.act==="catch");
   const p2=mk(X.SHOT.pin.fwdFront+0.2,10);X.catchStep(p2.r,p2.b,D);ok("...past the forward foot it is",p2.r.act===null);
   const pb=mk(-0.2,-1);X.S.balls=[pb.b];X.catchStep(pb.r,pb.b,D);X.S.balls=[];X.setRng(0.99);}
  // the carry turns round only after it has been going one way a while
  {CA.turnT=0.8;const r=world(X,{defOff:-3,gkOff:-9});r.angle=-0.75;pinned(X,r,0);const best=view(X,-0.5,0);
   X.S.time=0;X.pinPlay(r,best,CA.settleT+0.01,dt);
   ok("the carry sets off toward the open z",r.pcTz>0);
   X.rods[1].offset=3;X.rods[2].offset=9;r.pcEv=0;r.slideV=0;X.S.time=0.4;
   X.pinPlay(r,best,CA.settleT+0.02,dt);
   ok("the lanes move to the other side: it keeps going the way it was for turnT",r.pcTz>0&&r.target>r.offset,"pcTz="+r.pcTz);
   r.pcEv=0;X.S.time=CA.turnT+0.1;X.pinPlay(r,best,CA.settleT+0.03,dt);
   ok("...and turns round once it has been",r.pcTz<0,"pcTz="+r.pcTz);
   CA.turnT=0;}
 }
 // ---- a pin pass waits for its receiver ---------------------------------------------------------------------------------
 {CA.recv.ready.on=true;const RDY=CA.recv.ready;
  const r=world(X,{maxOff:0});pinned(X,r,0);const best=view(X,-0.5,0);
  const mate={role:'MID',kickDir:1,angle:0,act:null,baseZ:[0,12],offset:0};
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:mate,man:0});
  let v=X.pinPlay(r,best,0.5,dt);
  ok('a mate that is not ready (the pose not up) is waited for, not passed to yet',v===0&&r.pcRdy>0,'v='+v);
  mate.act='recv';mate.rvReady=true;mate.angle=CA.recv.angle-0.3;
  ok('…the pose up but short of its angle: still waiting',X.pinPlay(r,best,0.5,dt)===0);
  ok('…and while it waits it holds still (a carry would start the slide that reads as a push lane)',r.target===r.offset&&r.pcTz==null);
  const rc=world(X,{gkOff:-9});pinned(X,rc,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID',kickDir:1,angle:0,act:null,baseZ:[0],offset:0},man:0});
  ok('with a z to carry to that opens a lane the carry goes first: no wait for a pass',X.pinPlay(rc,best,0.5,dt)===0&&rc.target>rc.offset&&!rc.pcRdy,'target='+rc.target);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:mate,man:0});
  mate.angle=CA.recv.angle;mate.baseZ=[3,15];
  ok('…the pose up but the man off the lane: still waiting',X.pinPlay(r,best,0.5,dt)===0);
  mate.baseZ=[5.3,15];
  ok('…ready (pose, and a man on the lane): the pass goes',X.pinPlay(r,best,0.5,dt)===2);
  const r2=world(X,{maxOff:0});pinned(X,r2,0);let n=0,got=0;
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID',kickDir:1,angle:0,act:null,baseZ:[0],offset:0},man:0});
  while(n++<400&&!(got=X.pinPlay(r2,best,0.5,dt)));
  ok('a mate that never gets ready is waited for only so long, then passed to',got===2&&n*dt<=RDY.wait+0.05&&n*dt>=RDY.wait-0.05,'n='+n);
  const r3=world(X,{maxOff:0});pinned(X,r3,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID',kickDir:1,angle:0,act:'catch',baseZ:[0],offset:0},man:0});
  ok('…and one busy with something else is not waited for',X.pinPlay(r3,best,0.5,dt)===2);
  const r4=world(X,{maxOff:0});pinned(X,r4,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'GK',kickDir:1,angle:0,act:null,baseZ:[0],offset:0},man:0});
  ok('…nor a rod that does not take the pose (the keeper)',X.pinPlay(r4,best,0.5,dt)===2);
  const r5=world(X,{maxOff:0});pinned(X,r5,0);
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID',kickDir:1,angle:0,act:null,baseZ:[0],offset:0},man:0});
  ok('…and a ball held too long is passed whether he is ready or not',X.pinPlay(r5,best,CA.holdT+0.01,dt)===2);
  const r6=world(X,{maxOff:0});pinned(X,r6,0);const mm={role:'MID',team:0,kickDir:1,angle:0,act:null,baseZ:[0],offset:0};
  X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:mm,man:0,cands:[{rod:mm,man:0,z:5,score:30}]});
  X.pinPlay(r6,best,0.5,dt);
  ok('a holder looking at passing arms the mates it could pass to',mm.rvReady===true&&mm.rvUntil>X.S.time&&mm.rvZ===5);
  CA.recv.ready.on=false;}
 {const r=world(X);r.catPh='front';r.angle=CA.recv.fwdMin-0.05;pinned(X,r,-6);const best=view(X,-0.5,-6);const n0=X.CAS.reseat;
  X.catchStep(r,best,D);let steps=0;while(r.act==='catch'&&steps++<200)X.catchStep(r,best,D);
  ok('…but a leg tilted forward less than that (or back, the front pin) plays as before: the pin shot',X.KICKS.length===1&&X.KICKS[0].style==='trapShot'&&X.CAS.reseat===n0);}
 {const r=world(X);r.catPh='behind';const b=pinned(X,r,0);const t0=X.S.time;
  X.catchStep(r,view(X,-3.4,0),D);
  ok('caught behind: let go and hand to retrieve, which may pin whatever the iq roll says',r.act===null&&r.pinB===null&&r.catUntil>t0+1&&!r.pinOn&&r.catCd===0,'catUntil='+r.catUntil);}
 {const r=world(X);r.catPh='hold';X.catchStep(r,view(X,-2,0,10,0),D);
  ok('a pinned ball knocked loose ends it',r.act===null&&r.catCd>0);}
 // ---- the snake from under a forward leg (catch.snake) ------------------------------------------------------------
 {const SN=CA.snake,K0=JSON.stringify(SN),FW=CA.recv.fwdMin+0.25,gx=X.F.L/2,TF=CA.tictac.first,clear={defOff:-12,gkOff:-9};
  const hold=(rel,z,o)=>{o=o||{};const r=world(X,o);r.catPh='hold';r.catT=1;r.angle=o.ang!=null?o.ang:FW;r.role=o.role||'ATT';r.slideV=o.sv||0;
   const b=pinned(X,r,z);b.pinDx=rel;b.m.position.x=r.x+rel;r.pcEv=1e9;r.pcTz=null;r.tapPk=null;return r;};
  const reseated=(r,z,rel)=>{const s0=X.CAS.reseat;let n=0;while(X.CAS.reseat===s0&&!X.KICKS.length&&n++<100)X.catchStep(r,view(X,rel,z),D);return X.KICKS.length===0&&X.CAS.reseat===s0+1;};   // a pass waits a moment for its receiver first
  X.setRng(0.1);CA.tictac.first=false;
  {const r=hold(3.5,-6),n0=X.CAS.snake,s0=X.CAS.reseat,e0=X.CAW.snake||0;X.catchStep(r,view(X,3.5,-6),D);const k=X.KICKS[0]||{};
   ok('a shot from a ball held under a forward leg is the snake: one swing, no re-seat, counted, the catch ended as one',X.KICKS.length===1&&k.style==='snake'&&X.CAS.snake===n0+1&&X.CAS.reseat===s0&&(X.CAW.snake||0)===e0+1&&r.act===null,'kicks='+JSON.stringify(X.KICKS));
   ok('…the player\'s snake: its curve, the ball let go with its slide, the stamina of one, back to a plain swing\'s after',k.curve===X.SHOT.snake&&k.relK===X.SHOT.snake.carry&&k.ex===X.SHOT.snake.exert&&r.shotExert===1,'relK='+k.relK+' ex='+k.ex);
   ok('…aimed where it was judged, the slide held through the spin then braked',!!r.catAim&&r.aimEv===r.catAim&&r.catAim.best.tz===-6&&r.catSw&&r.catHold===X.SHOT.snake.spin+X.SHOT.snake.follow,'tz='+(r.catAim&&r.catAim.best.tz));}
  for(const rel of [SN.relMin-0.2,SN.relMax+0.2])ok('a ball held nearer or further than the snake reaches ('+rel.toFixed(1)+') is re-seated as before',reseated(hold(rel,-6),-6,rel));
  {SN.on=false;const ok1=reseated(hold(3.5,-6),-6,3.5);SN.on=true;ok('switched off, a forward hold re-seats as before',ok1);}
  {SN.roles=['ATT'];const r=hold(3.5,-6,{role:'MID'});X.pinPlay(r,view(X,3.5,-6),1,dt);const a=r.pcSn;r.role='ATT';X.pinPlayStart(r);X.pinPlay(r,view(X,3.5,-6),1,dt);SN.roles=JSON.parse(K0).roles;
   ok('only the roles listed snake',a===false&&r.pcSn===true);}
  {const r=hold(3.5,-6,{ang:-0.3});X.pinPlay(r,view(X,3.5,-6),1,dt);
   ok('a leg not tilted forward never snakes (the back pin shoots the pin shot)',r.pcSn===false);}
  {X.setRng(0.99);const r=hold(3.5,-6);X.pinPlay(r,view(X,3.5,-6),1,dt);const a=r.pcSn;X.setRng(0.1);X.pinPlay(r,view(X,3.5,-6),1,dt);const b=r.pcSn;X.pinPlayStart(r);X.pinPlay(r,view(X,3.5,-6),1,dt);
   ok('the share is drawn once a hold (catch.snake.use): a roll over it re-seats, the hold keeps its draw, a new hold draws again',a===false&&b===false&&r.pcSn===true,'a='+a+' b='+b+' c='+r.pcSn);}
  {const r=hold(3.5,0,Object.assign({sv:10},clear)),v=X.pinPlay(r,view(X,3.5,0),1,dt);
   ok('sliding (slower than a pin shot\'s push): no brake, the snake fires with the slide carried, on its own slope',v===1&&r.pcSn&&r.catSv===10&&Math.abs(r.catSl-SN.k*10)<1e-9&&r.catHold>0,'v='+v+' sl='+r.catSl);
   const q=hold(3.5,0,Object.assign({sv:10},clear));X.catchStep(q,view(X,3.5,0),D);const tz=SN.drift*10+(gx-26)*SN.k*10;
   ok('…aimed on the line its slide leaves on',X.KICKS.length===1&&!!q.catAim&&Math.abs(q.catAim.best.tz-tz)<1e-6,'tz='+(q.catAim&&q.catAim.best.tz)+' want '+tz);}
  {SN.brake=true;const r=hold(3.5,0,Object.assign({sv:10},clear)),v=X.pinPlay(r,view(X,3.5,0),1,dt);SN.brake=false;
   ok('…with catch.snake.brake it waits for the rod to stop, like a re-seat',v===0);}
  {const r=hold(3.5,-6);r.pcSn=true;const ob=[{x:37.5,z:-1.1}];
   ok('a snake hold judges its push on the snake\'s drift and slope, at any slide',Math.abs(X.pushOutlet(r,25,-6,8,ob,gx)-X.pinOutlet(r,25,-6+SN.drift*8,ob,gx,SN.k*8))<1e-9);
   r.pcSn=false;ok('…a pin shot\'s push is its own (none under minV)',X.pushOutlet(r,25,-6,8,ob,gx)===-1e9);}
  {const ze=X.F.goalHalf*X.AIC.aimGoalZ-CA.lineClear-0.3;
   const a=hold(3.5,ze,clear),va=X.pinPlay(a,view(X,3.5,ze),1,dt),b=hold(3.5,ze,Object.assign({sv:4},clear)),vb=X.pinPlay(b,view(X,3.5,ze),1,dt);
   ok('a snake creeping toward the post is judged where it will go: standing it is open, creeping it is not',va===1&&vb!==1,'va='+va+' vb='+vb);}
  {SN.clear=50;const r=hold(3.5,-6),v=X.pinPlay(r,view(X,3.5,-6),1,dt);SN.clear=JSON.parse(K0).clear;
   ok('the lane must clear by catch.snake.clear',v!==1);}
  {const bR=X.AIC.gapAim.blockR,bx=22.5+3.5,d150=-40*(37.5-bx)/SN.shotV,r=hold(3.5,-6),ob=X.rods[1];ob.vz=-40;ob.offset=-6+bR+SN.clear+0.4-d150;
   const v=X.pinPlay(r,view(X,3.5,-6),1,dt),ln=X.laneObs(0,bx,gx,SN.shotV),ls=X.laneObs(0,bx,gx,CA.shotV),oa=X.pinOutlet(r,bx,-6,ln,gx,0)>=SN.clear,ob2=X.pinOutlet(r,bx,-6,ls,gx,0)>=SN.clear;ob.vz=0;
   ok('the rows are read at the snake\'s speed',oa!==ob2&&v===(oa?1:0),'v='+v+' at150='+oa+' at105='+ob2);}
  {const r=hold(3.5,0,{defOff:0}),v=X.pinPlay(r,view(X,3.5,0),CA.holdT+0.1,dt);
   ok('late with the lane shut it is the snake too, not a re-seat',v===1&&r.pcSn);}
  {const r=hold(3.5,0);X.setPick({score:30,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});const ok1=reseated(r,0,3.5);X.setPick(null);   // world() clears the pick
   ok('a pass from a snake hold still re-seats (the snake is a shot)',ok1&&r.pcSn,'kicks='+JSON.stringify(X.KICKS.map(k=>k.style)));}
  Object.assign(SN,JSON.parse(K0));X.setRng(0.99);CA.tictac.first=TF;}
 // ---- the pull (catch.push.play): wide, then a burst back toward the middle, shot to the near post ----------------------
 {const PL=CA.push.play,P=CA.push,K0=JSON.stringify(PL),TF=CA.tictac.first;CA.tictac.first=false;
  const c=P.drift+P.k*Math.abs(X.F.L/2-22.0),top=X.DIFFS.pro.speed*PL.burst;   // the ball sits at x 22 (pinned())
  const hold=(off,z,o)=>{const r=world(X,Object.assign({gkOff:3.5},o||{}));r.offset=off;r.target=off;pinned(X,r,z);return r;};
  X.setRng(0.1);
  {const r=hold(-6,-18);r.role='MID';ok('a role not in play.roles never pulls',!X.puWant(r,r.pinB)&&r.puPh==null);}
  {const r=hold(0,0);ok('a ball that cannot be taken wide enough is not pulled (the carry has it)',!X.puWant(r,r.pinB)&&r.puPh==null);}
  {X.setRng(0.99);const r=hold(-6,-18);ok('a hold that rolls no pull plays as before',!X.puWant(r,r.pinB)&&r.puRoll===false);
   X.setRng(0.1);ok('…and the roll is once a hold, not once a frame',!X.puWant(r,r.pinB));
   X.pinPlayStart(r);ok('…a new hold draws again, with no pull left over',r.puRoll===null&&r.puPh===null&&r.puN===0&&X.puWant(r,r.pinB));}
  {const r=hold(-6,-18),f0=X.CAS.puFake;
   ok('a wide ball: the burst runs toward the middle, the fake sells it wider first (as far as the rod lets it)',X.puWant(r,r.pinB)&&r.puS===1&&r.puPh==='sell'&&Math.abs(r.puD-3)<1e-9&&X.CAS.puFake===f0+1,'puS='+r.puS+' ph='+r.puPh+' puD='+r.puD);
   ok('…a play in hand is kept',X.puWant(r,r.pinB)&&r.puN===1);}
  {const r=hold(4,-8),w0=X.CAS.puWide;
   ok('a ball short of play.wide is taken out to it first, fake or not',X.puWant(r,r.pinB)&&r.puPh==='sell'&&Math.abs(r.puD-(PL.wide-8))<1e-9&&X.CAS.puWide===w0+1,'ph='+r.puPh+' puD='+r.puD);}
  {PL.fake={rookie:0,pro:0,legend:0};const r=hold(-6,-18);
   ok('a wide ball with no fake bursts at once',X.puWant(r,r.pinB)&&r.puPh==='burst');Object.assign(PL,JSON.parse(K0));}
  {const r=hold(-6,-18);r.force=true;ok('the dead-ball push plays no pull',!X.puWant(r,r.pinB));}
  {const r=hold(-6,-18);r.puN=PL.tries;ok('…nor does a hold that has made its tries',!X.puWant(r,r.pinB));}
  // the sell and the burst
  {const r=hold(-6,-18);X.puWant(r,r.pinB);
   ok('the sell heads out its length, nothing fired',X.puStep(r,r.pinB,dt,0)===false&&Math.abs(r.target-(-9))<1e-9&&r.puPh==='sell');
   r.offset=-9;X.puStep(r,r.pinB,dt,0);ok('…and turns into the burst once there',r.puPh==='burst'&&r.target>r.offset);}
  {const r=hold(-6,-18);X.puWant(r,r.pinB);r.puT=PL.sellT;X.puStep(r,r.pinB,dt,0);ok('…or once its time is up',r.puPh==='burst');}
  const burst=(z,sv,off)=>{const r=hold(off==null?-9:off,z);r.puPh='burst';r.puS=1;r.puN=1;r.puRoll=true;r.puT=0;r.slideV=sv;return r;};
  {const r=burst(-21,0),f=X.puStep(r,r.pinB,dt,0),want=Math.min(top,Math.max(P.minV,(21-PL.aim)/c));
   ok('the burst slides at the speed that lands the push by the near post',!f&&Math.abs((r.target-r.offset)/dt-want)<1e-6,'v='+((r.target-r.offset)/dt).toFixed(2)+' want='+want.toFixed(2));}
  {const r=burst(-15,0),want=Math.max(P.minV,(15-PL.aim)/c);X.puStep(r,r.pinB,dt,0);
   ok('…slower from a narrower ball',Math.abs((r.target-r.offset)/dt-want)<1e-6&&want<top);}
  {const fire=(z,sv,now)=>{const q=burst(z,sv);return X.puStep(q,q.pinB,dt,now||0);},sv=(21-PL.aim)/c;
   ok('the line reaching the goal by the near post fires',fire(-21,sv)===true);
   ok('…not with a man standing well inside it',fire(-21,sv,PL.clear-0.1)===false);
   ok('…nor on a slide the wrong way',fire(-21,-sv)===false);
   ok('…nor past the band (nearer the middle)',fire(-21,(21-PL.post[0])/c+1)===false);
   ok('…nor short of it (wide of the post)',fire(-21,(21-PL.post[1])/c-1)===false);
   ok('…nor under a push\'s speed (at it, the same landing fires)',fire(-(PL.aim+(P.minV-1)*c),P.minV-1)===false&&fire(-(PL.aim+P.minV*c),P.minV)===true);}
  {const r=burst(-6,30),m0=X.CAS.puMiss;X.puStep(r,r.pinB,dt,0);
   ok('a ball come nearer the middle than the band can reach is given up: the rod stops',r.puPh==='stop'&&r.target===r.offset&&X.CAS.puMiss===m0+1);
   r.slideV=CA.fireV+1;X.puStep(r,r.pinB,dt,0);ok('…held while it still slides',r.puPh==='stop');
   r.slideV=0;X.puStep(r,r.pinB,dt,0);ok('…and over once it has stopped',r.puPh===null);}
  {const r=burst(-21,0);r.puT=PL.burstT;X.puStep(r,r.pinB,dt,0);ok('the burst gives up at its time',r.puPh==='stop');}
  // in pinPlay, and the swing
  {const sv=(21-PL.aim)/c,r=burst(-21,sv),f0=X.CAS.puFire,v=X.pinPlay(r,view(X,-0.5,-21),1,dt);
   ok('pinPlay shoots the pull, the slide carried through the swing',v===1&&r.pcWhy==='pull'&&r.catSv===sv&&Math.abs(r.catSl-X.pushSlope(r,sv))<1e-12&&X.CAS.puFire===f0+1,'v='+v+' why='+r.pcWhy);
   r.kickT=-1;X.pinFire(r,view(X,-0.5,-21),D,1);ok('…and the burst keeps its speed through that swing',r.puB===true&&r.puPh===null);
   ok('…pushBurst says so while it swings, and not after',X.pushBurst(r)===PL.burst&&(r.kickT=-1,X.pushBurst(r)===0));}
  {const r=hold(-6,-6);r.puPh='sell';r.puS=1;r.puD=3;r.puO=-6;r.puN=1;r.puT=0;
   ok('a running pull owns the shot: an open straight lane does not cut it short',X.pinPlay(r,view(X,-0.5,-6),1,dt)===0&&r.puPh==='sell');
   ok('…unless the ball has been held too long',X.pinPlay(r,view(X,-0.5,-6),CA.holdT+0.01,dt)===1);}
  {const r=hold(-6,-6);ok('an open lane before any pull is shot as before',X.pinPlay(r,view(X,-0.5,-6),1,dt)===1&&r.puPh==null);}
  {const r=hold(-6,-18);r.angle=CA.recv.fwdMin+0.25;X.pinPlay(r,view(X,-0.5,-18),1,dt);ok('a forward pin plays no pull',r.puPh==null);}
  {const r=burst(-21,0);ok('pushBurst: the burst speed while it bursts with the ball',X.pushBurst(r)===PL.burst);
   r.puPh='sell';ok('…none while it sells',X.pushBurst(r)===0);
   r.puPh='burst';r.pinB=null;ok('…none once the ball is gone with no swing of its own',X.pushBurst(r)===0);}
  {const r=burst(-21,0);X.catchEnd(r,0);ok('ending the catch ends the pull',r.puPh===null);}
  Object.assign(PL,JSON.parse(K0));X.setRng(0.99);CA.tictac.first=TF;}
 // ---- catchEnd -----------------------------------------------------------------------------------------------------
 {const r=world(X);pinned(X,r,0);r.pinOn=true;r.pinPose=true;r.pinA=-0.5;const n0=X.released();X.catchEnd(r,0.9,'x');
  ok('ending lets the pin go and puts every flag down',r.pinB===null&&X.released()===n0+1&&!r.pinOn&&!r.pinPose&&r.pinA===null&&r.act===null&&r.catPh===null&&r.catCd===0.9);
  ok('…and tallies why',X.CAW.x===1);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'a held ball is played before it has settled',part:'catch',from:' if(t<CA.settleT)return 0;',to:''},
 {n:'every lane counts as open',part:'catch',from:'open=now>=(sn?SN.clear:CA.lineClear),',to:'open=true,'},
 {n:'a ball with no way forward is never played, however long it is held',part:'catch',from:'else if(late){v=1;',to:'else if(false){v=1;'},
 {n:'a pass is made without asking the strike gate',part:'catch',from:'&&strikeOn(r,best,\'pass\',pinSwing(true)))',to:')'},
 {n:'the passes are looked at even with an open lane (the attacker)',part:'catch',from:'const pk=((open&&!OP)||mull)?null:passPick(r,p.x,p.z,\'pin\');',to:'const pk=mull?null:passPick(r,p.x,p.z,\'pin\');'},
 {n:'no rod looks at the passes with an open lane',part:'catch',from:'const OP=open&&CA.open?CA.open[r.role]:null;',to:'const OP=null;'},
 {n:'every rod looks at the passes with an open lane',part:'catch',from:'const OP=open&&CA.open?CA.open[r.role]:null;',to:'const OP=open?{k:0,b:-9}:null;'},
 {n:'an open pass is made without asking the strike gate',part:'catch',from:'pk.score>now*OP.k+OP.b&&strikeOn(r,best,\'pass\',pinSwing(true))){',to:'pk.score>now*OP.k+OP.b){'},
 {n:'an open pass ignores how good the mate is',part:'catch',from:'pk.score>now*OP.k+OP.b&&',to:'pk.score>0&&'},
 {n:'an open pass is held for a carry',part:'catch',from:'if(!open&&(CA.carryFirst||fwd)){\n   pinCarryEval(',to:'if((CA.carryFirst||fwd)){\n   pinCarryEval('},
 {n:'a push is judged without the slide the ball gains before it leaves the boot',part:'catch',from:'pinOutlet(r,bx,bz+AIC.catch.push.drift*sv,obs,goalX,sl)',to:'pinOutlet(r,bx,bz,obs,goalX,sl)'},
 {n:'the defence pushes too',part:'catch',from:'(OP&&OP.push===false)||',to:''},
 {n:'a slow slide counts as a push',part:'catch',from:'if(!P.on||(OP&&OP.push===false)||Math.abs(sv)<P.minV)return 0;',to:'if(!P.on||(OP&&OP.push===false))return 0;'},
 {n:'a push is judged with no slide left for the swing',part:'catch',from:'>=P.room?P.k*sv:0;',to:'>=-1e9?P.k*sv:0;'},
 {n:'a push heads away from the slide',part:'catch',from:'?P.k*sv:0;',to:'?P.k*Math.abs(sv):0;'},
 {n:'a sliding rod is treated as still',part:'catch',from:'still=Math.abs(sv)<=CA.fireV,',to:'still=true,'},
 {n:'a push is never played (the swing speed is not kept)',part:'catch',from:'if(sl){r.catSv=sv;r.catSl=sl;}',to:''},
 {n:'the strike gate is not told about the slide',part:'catch',from:'if(r.catSv)r.target=r.offset+r.catSv*AIC.catch.push.lead;',to:''},
 {n:'the aim point is not on the line the push leaves on',part:'catch',from:'ev.best={tz:p.z+(sl?dr*r.catSv:0)+Math.abs(ev.goalX-p.x)*sl,clr:ev.best.clr};',to:'ev.best={tz:0,clr:ev.best.clr};'},
 {n:'it never turns round for a better z (no candidate for the one it heads for)',part:'catch',from:'for(let i=0;i<=n;i++){',to:'for(let i=0;i<n;i++){'},
 {n:'the z it heads for gets no bonus (it dithers)',part:'catch',from:'+(i===n?CA.flipGain:0);',to:'+0;'},
 {n:'the carry only looks at the side it started toward',part:'catch',from:'pushOutlet(r,p.x,z,z>p.z?cv:-cv,obs,goalX)',to:'pushOutlet(r,p.x,z,cv,obs,goalX)'},
 {n:'the opposing men are judged where they are, not where they are sliding to (ATT)',part:'lane',from:'const dz=v0?r2.vz*(r2.x-bx)*dir/v0:0;',to:'const dz=0;'},
 {n:'…or the row ahead (the rest)',part:'fwd',from:'dz=v0?row.vz*rd/v0:0;',to:'dz=0;'},
 {n:'the dead-ball push does not play a held ball',part:'catch',from:'late=t>=CA.holdT||r.force;',to:'late=t>=CA.holdT;'},
 {n:'a forward leg fires a push all the same',part:'catch',from:'if(v&&fwd&&(!sn||SN.brake)&&!still&&!late&&RV.fwdBrake){v=0;if(!r.pcBrk){r.pcBrk=1;CAS.fwdBrake++;}}',to:''},
 {n:'…the brake is not counted',part:'catch',from:'v=0;if(!r.pcBrk){r.pcBrk=1;CAS.fwdBrake++;}',to:'v=0;'},
 {n:'…it is counted every frame',part:'catch',from:'if(!r.pcBrk){r.pcBrk=1;CAS.fwdBrake++;}',to:'CAS.fwdBrake++;'},
 {n:'…it holds a late ball too',part:'catch',from:'if(v&&fwd&&(!sn||SN.brake)&&!still&&!late&&RV.fwdBrake)',to:'if(v&&fwd&&(!sn||SN.brake)&&!still&&RV.fwdBrake)'},
 {n:'…it holds a back-tilted pin too',part:'catch',from:'if(v&&fwd&&(!sn||SN.brake)&&!still&&!late',to:'if(v&&(!sn||SN.brake)&&!still&&!late'},
 {n:'…it holds a rod at rest too',part:'catch',from:'if(v&&fwd&&(!sn||SN.brake)&&!still&&!late',to:'if(v&&fwd&&(!sn||SN.brake)&&!late'},
 {n:'…the switch is ignored',part:'catch',from:'&&!late&&RV.fwdBrake){',to:'&&!late){'},
 {n:'a ball under a forward leg is played with a swing',part:'catch',from:'if((v===1||v===2)&&r.angle*dir>CA.recv.fwdMin&&!(v===1&&r.pcSn)){reseat(r);return;}',to:''},
 {n:'…or only a shot, not a pass',part:'catch',from:'if((v===1||v===2)&&r.angle*dir>CA.recv.fwdMin&&',to:'if(v===1&&r.angle*dir>CA.recv.fwdMin&&'},
 {n:'a back-tilted pin (the front pin) is re-seated too',part:'catch',from:'&&r.angle*dir>CA.recv.fwdMin&&!(v===1&&r.pcSn)){reseat(r);return;}',to:'&&!(v===1&&r.pcSn)){reseat(r);return;}'},
 {n:'the re-seat does not let the ball go',part:'catch',from:"catchEnd(r,0,'reseat');\n r.act='retrieve'",to:"r.act='retrieve'"},
 {n:'the re-seat is not counted',part:'catch',from:'CAS.reseat++;\n if(r.pinB&&AIC.catch.fetch.on',to:' if(r.pinB&&AIC.catch.fetch.on'},
 {n:'retrieve is not started by the re-seat',part:'catch',from:"r.act='retrieve';r.actT=0;r.retDir=0;r.retZ=null;r.retMan=-1;",to:''},
 {n:'retrieve may drop the ball on its iq roll',part:'catch',from:'r.catUntil=S.time+AIC.catch.behind.keepIQ;BGS.retEnter++;',to:'BGS.retEnter++;'},
 {n:'a ball under a forward leg is passed before any carry or tap',part:'catch',from:'if(r.tapPk||r.pcTz!=null){v=0;',to:'if(false){v=0;'},
 {n:'…the carry is not looked for first',part:'catch',from:'pinCarryEval(r,b,obs,goalX,tap);\n   if(r.tapPk||r.pcTz!=null){v=0;',to:'\n   if(r.tapPk||r.pcTz!=null){v=0;'},
 {n:'…a tap does not count',part:'catch',from:'if(r.tapPk||r.pcTz!=null){v=0;',to:'if(r.pcTz!=null){v=0;'},
 {n:'…a carry does not count',part:'catch',from:'if(r.tapPk||r.pcTz!=null){v=0;',to:'if(r.tapPk){v=0;'},
 {n:'the carry goes before a pass from a forward pin only',part:'catch',from:'if(!open&&(CA.carryFirst||fwd)){\n   pinCarryEval(',to:'if(!open&&fwd){\n   pinCarryEval('},
 {n:'a carry before a pass is not counted',part:'catch',from:':(r.tapPk?\'tapFirst\':\'carryFirst\')]++;',to:':(r.tapPk?\'tapFirst\':\'carryFirst\')]+=0;'},
 {n:'a ball held too long still waits for a carry',part:'catch',from:'if(v===2&&!late){',to:'if(v===2){'},
 {n:'a pass does not wait for its receiver',part:'catch',from:'if(v===2&&!recvReadyNow(pk)){',to:'if(false){'},
 {n:'…or waits for ever',part:'catch',from:'<CA.recv.ready.wait){if(',to:'<1e9){if('},
 {n:'…and a holder waiting for its receiver goes on to carry the ball (the slide reads as a push lane next frame)',part:'catch',from:'CAS.rdyWait++;return 0;}',to:'CAS.rdyWait++;}'},
 {n:'…the wait is never counted',part:'catch',from:'if((r.pcRdy=(r.pcRdy||0)+dt)<CA.recv.ready.wait){if(',to:'if(((r.pcRdy=0)+dt)<CA.recv.ready.wait){if('},
 {n:'a holder does not get its mates ready',part:'catch',from:'if(pk&&(!open||v===2))recvReady(r,pk.cands);',to:''},
 {n:'the pin shot fires without asking the strike gate',part:'catch',from:'if(!strikeOn(r,best,\'trapShot\',pinSwing()))return -1;',to:''},
 {n:'the rod is not held still through the swing',part:'catch',from:' r.catSw=true;',to:' r.catSw=false;'},
 {n:'a swing already running is started again',part:'catch',from:' if(r.kickT>=0)return 0;\n if(v===2)',to:' if(v===2)'},
 {n:'a ball too fast to hold is still caught (front)',part:'catch',from:'c<A.minClose||c>A.maxClose)return fetchPick(r,best)?\'fetch\':null;\n  tAr=rel/c;',to:'c<A.minClose)return fetchPick(r,best)?\'fetch\':null;\n  tAr=rel/c;'},
 {n:'a ball that is not closing is caught',part:'catch',from:'c<A.minClose||c>A.maxClose)return fetchPick(r,best)?\'fetch\':null;\n  tAr=rel/c;',to:'c>A.maxClose)return fetchPick(r,best)?\'fetch\':null;\n  tAr=rel/c;'},
 {n:'a ball too far in time is caught',part:'catch',from:'if(tAr>A.tMax||tAr<0.05)return null;',to:'if(tAr<0.05)return null;'},
 {n:'a ball at the heel is caught as one from behind',part:'catch',from:'if(-rel<A.near||-rel>A.far||c<A.minClose||c>A.maxClose)return null;',to:'if(-rel>A.far||c<A.minClose||c>A.maxClose)return null;'},
 {n:'the pose is allowed to shove the ball',part:'catch',from:'if(sweepClips(r,best,r.angle,(fb?CA.recv.angle:A.angle)*dir))return null;',to:'if(false)return null;'},
 {n:'a ball no man can reach is caught',part:'catch',from:'if(e>CA.zTol||Math.abs(o-r.offset)>sp*tAr+CA.zTol)continue;',to:''},
 {n:'the man is picked for where the ball is, not where it will be',part:'catch',from:'catchMan(r,clamp(p.z+v.z*tAr,-zl,zl),tAr)',to:'catchMan(r,clamp(p.z,-zl,zl),tAr)'},
 {n:'the leg tilts the moment the catch is chosen',part:'catch',from:'if(tAr<=CA.poseT){',to:'if(true){'},
 {n:'the front pose is the behind pose',part:'catch',from:'const front=r.catPh===\'front\',A=front?CA.front:CA.behind;',to:'const front=r.catPh===\'front\',A=CA.behind;'},
 {n:'a ball that has gone past is still waited for (front)',part:'catch',from:'if(rel<SHOT.pin.back-1)why=\'past\';',to:'if(false)why=\'past\';'},
 {n:'a ball running off is still waited for',part:'catch',from:'else if(vf>1&&rel>A.near)why=\'away\';',to:''},
 {n:'a ball that stopped short is still waited for',part:'catch',from:'else if(sp<CA.restV&&rel>SHOT.pin.front+0.3)why=\'stopped\';',to:''},
 {n:'a ball that went past the rod behind is still waited for',part:'catch',from:'if(rel>(r.catFwd?SHOT.pin.fwdFront:-0.5))why=\'past\';',to:'if(false)why=\'past\';'},
 {n:'a ball that died before the heel is still waited for',part:'catch',from:'else if(sp<CA.restV&&!(r.catFwd&&recvRest(r)&&S.time-(r.rvRestT||(r.rvRestT=S.time))<CA.recv.rest))why=\'slow\';',to:''},
 {n:'a ball in the air does not end it',part:'catch',from:'else if(p.y>CA.liftY)why=\'lifted\';',to:''},
 {n:'a hopping ball ends it (the old lowY limit)',part:'catch',from:'else if(p.y>CA.liftY)why=\'lifted\';',to:'else if(p.y>AIC.lowY)why=\'lifted\';'},
 {n:'a stopped ball is not fetched',part:'catch',from:'if(why===\'stopped\'&&fetchPick(r,best)){',to:'if(false){'},
 {n:'a stopped ball is fetched whatever a shot says',part:'catch',from:'if(why===\'stopped\'&&fetchPick(r,best)){',to:'if(why===\'stopped\'){'},
 {n:'a stopped ball taken keeps the old catch timer',part:'catch',from:'r.catPh=\'fetch\';r.catT=0;r.ftPh=null;CAS.fetch++;',to:'r.catPh=\'fetch\';r.ftPh=null;CAS.fetch++;'},
 {n:'a stopped ball taken is not counted',part:'catch',from:'CAS.stoppedFetch++;',to:''},
 {n:'a catch with no end in sight never times out',part:'catch',from:'else if(r.catT>CA.abortT)why=\'time\';',to:''},
 {n:'the dead-ball push does not end a catch',part:'catch',from:'else if(r.force)why=\'force\';',to:''},
 {n:'a caught ball behind the rod is carried instead of handed to retrieve',part:'catch',from:'if(r.catPh===\'behind\'&&!r.catFwd){CAS.hand++;r.catUntil=S.time+CA.behind.keepIQ;catchEnd(r,0,\'handed\');return;}',to:''},
 {n:'the hand-off forgets retrieve may pin',part:'catch',from:'r.catUntil=S.time+CA.behind.keepIQ;',to:''},
 {n:'a ball knocked out of the pin keeps the catch alive',part:'catch',from:'if(r.catPh===\'hold\'){CAS.lost++;catchEnd(r,CA.cd,\'knocked\');return;}',to:''},
 {n:'the pose is not frozen once caught',part:'catch',from:'r.pinOn=true;r.pinPose=true;r.pinA=r.angle;                     // frozen where it caught',to:'r.pinOn=true;r.pinPose=true;r.pinA=CA.front.angle*dir;'},
 {n:'ending leaves the pin held',part:'catch',from:' if(r.pinB)pinRelease(r);\n r.pinOn=false;',to:' r.pinOn=false;'},
 {n:'ending leaves the pin flags up',part:'catch',from:' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.ftPh=null;r.puPh=null;\n r.act=null;r.catPh=null;',to:' r.puPh=null;\n r.act=null;r.catPh=null;'},
 {n:'ending sets no cooldown',part:'catch',from:'r.catCd=cd||0;',to:'r.catCd=0;'},
 {n:"the re-seat lets the ball go in place, no lift",part:'catch',from:"if(AIC.catch.recv.lift.on){fliftStart(r,'retrieve');return;}",to:""},
 {n:"…even with the lift switched off",part:'catch',from:"if(AIC.catch.recv.lift.on)",to:"if(true)"},
 {n:"the lift is not counted",part:'catch',from:"CAS.fwdLift++;",to:""},
 {n:"the re-seat does not wait for the slide to stop",part:'catch',from:"if(!tap&&Math.abs(r.slideV)>FL.restV)r.pinA=r.angle;",to:"if(false)r.pinA=r.angle;"},
 {n:"…a tap waits for it too",part:'catch',from:"if(!tap&&Math.abs(r.slideV)>FL.restV)",to:"if(Math.abs(r.slideV)>FL.restV)"},
 {n:"the leg turns the wrong way",part:'catch',from:"else r.pinA=FL.angle*dir;",to:"else r.pinA=-FL.angle*dir;"},
 {n:"the leg turns only a little",part:'catch',from:"else r.pinA=FL.angle*dir;",to:"else r.pinA=0.5*FL.angle*dir;"},
 {n:"the tap does not run on while the leg turns",part:'catch',from:"r.target=tap?clamp(r.offset+r.tapS*CA.tap.run,-r.maxOff,r.maxOff):r.offset;",to:"r.target=r.offset;"},
 {n:"the re-seat runs on while the leg turns",part:'catch',from:"r.target=tap?clamp(r.offset+r.tapS*CA.tap.run,-r.maxOff,r.maxOff):r.offset;",to:"r.target=clamp(r.offset+(r.tapS||1)*CA.tap.run,-r.maxOff,r.maxOff);"},
 {n:"the tap runs the wrong way while the leg turns",part:'catch',from:"r.target=tap?clamp(r.offset+r.tapS*CA.tap.run,",to:"r.target=tap?clamp(r.offset-r.tapS*CA.tap.run,"},
 {n:"the pin is not asked to hold the pose during the lift",part:'catch',from:"r.pinOn=true;r.pinPose=true;r.aiMan=r.flMan;",to:"r.aiMan=r.flMan;"},
 {n:"the lift keeps the wrong man",part:'catch',from:"r.pinOn=true;r.pinPose=true;r.aiMan=r.flMan;",to:"r.pinOn=true;r.pinPose=true;"},
 {n:"it hands over before the leg is up",part:'catch',from:"if(r.angle*dir<FL.done&&r.catT<=FL.abortT)return;",to:"if(false)return;"},
 {n:"it never hands over (the lift is waited on for ever)",part:'catch',from:"&&r.catT<=FL.abortT)return;",to:")return;"},
 {n:"a pin that never lets go is waited on for ever",part:'catch',from:"if(r.catT>FL.abortT){pinRelease(r);}",to:"if(false){pinRelease(r);}"},
 {n:"the abort lets go but the ball is not counted released",part:'catch',from:"if(r.catT>FL.abortT){pinRelease(r);}",to:"if(r.catT>FL.abortT){r.pinB=null;}"},
 {n:"the tap hand-off is the re-seat's",part:'catch',from:"if(tap)tapSide(r,false);else if(r.flNext==='hit')hitGo(r);else reseatGo(r);",to:"reseatGo(r);"},
 {n:"the re-seat hand-off is the tap's",part:'catch',from:"if(tap)tapSide(r,false);else if(r.flNext==='hit')hitGo(r);else reseatGo(r);",to:"tapSide(r,false);"},
 {n:"the hand-off leaves the leg up for retrieve to hold: no flag",part:'catch',from:"r.retFl=RV.lift.on&&r.angle*r.kickDir>RV.fwdMin;",to:"r.retFl=false;"},
 {n:"…every re-seat holds it",part:'catch',from:"r.retFl=RV.lift.on&&r.angle*r.kickDir>RV.fwdMin;",to:"r.retFl=true;"},
 {n:"…whatever the switch says",part:'catch',from:"r.retFl=RV.lift.on&&r.angle*r.kickDir>RV.fwdMin;",to:"r.retFl=r.angle*r.kickDir>RV.fwdMin;"},
 {n:"retrieve is not told to read the real ball",part:'catch',from:"r.retKnow=S.time+RV.lift.know;",to:""},
 {n:"a tap from a forward pin does not turn the leg up",part:'catch',from:"if(r.tapF&&!ahead){fliftStart(r,'tap');return;}",to:""},
 {n:"a tap is never marked as under a forward leg",part:'catch',from:"r.tapF=!!(RV.lift.on&&b&&r.angle*r.kickDir>RV.fwdMin);",to:"r.tapF=false;"},
 {n:"every tap turns the leg up",part:'catch',from:"r.tapF=!!(RV.lift.on&&b&&r.angle*r.kickDir>RV.fwdMin);",to:"r.tapF=true;"},
 {n:"…a back-tilted pin too",part:'catch',from:"r.tapF=!!(RV.lift.on&&b&&r.angle*r.kickDir>RV.fwdMin);",to:"r.tapF=!!(RV.lift.on&&b);"},
 {n:"…whatever the switch",part:'catch',from:"r.tapF=!!(RV.lift.on&&b&&r.angle*r.kickDir>RV.fwdMin);",to:"r.tapF=!!(b&&r.angle*r.kickDir>RV.fwdMin);"},
 {n:"the neighbour is not looked at under a forward leg whatever the carry finds",part:'catch',from:"fwdTap=fwd&&RV.tap.on&&RV.lift.on&&RV.tap.first;",to:"fwdTap=false;"},
 {n:"the tap switch is ignored",part:'catch',from:"fwdTap=fwd&&RV.tap.on&&RV.lift.on&&RV.tap.first;",to:"fwdTap=fwd&&tap&&RV.lift.on;"},
 {n:"the lift switch is ignored by the tap",part:'catch',from:"fwdTap=fwd&&RV.tap.on&&RV.lift.on&&RV.tap.first;",to:"fwdTap=fwd&&tap&&RV.tap.on;"},
 {n:"a back-tilted pin taps first too",part:'catch',from:"fwdTap=fwd&&RV.tap.on&&RV.lift.on&&RV.tap.first;",to:"fwdTap=tap&&RV.tap.on&&RV.lift.on;"},
 {n:"an open lane is tapped away from",part:'catch',from:"if(v&&fwdTap&&!late&&(v===2||RV.tap.open)){",to:"if(v&&fwdTap&&!late){"},
 {n:"a pass is not tapped for first",part:'catch',from:"if(v&&fwdTap&&!late&&(v===2||RV.tap.open)){",to:"if(v&&fwdTap&&!late&&RV.tap.open){"},
 {n:"a late ball is tapped",part:'catch',from:"if(v&&fwdTap&&!late&&(v===2||RV.tap.open)){",to:"if(v&&fwdTap&&(v===2||RV.tap.open)){"},
 {n:"a tap from a forward pin is not counted",part:'catch',from:"if(r.tapPk){if(!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}",to:"if(r.tapPk){return 3;}"},
 {n:"…it is counted every frame",part:'catch',from:"if(r.tapPk){if(!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}",to:"if(r.tapPk){CAS.fwdTap++;return 3;}"},
 {n:"the eval does not look for a tap under a forward leg",part:'catch',from:"(fwdTap||r.pcOut<CA.lineClear)",to:"(r.pcOut<CA.lineClear)"},
 {n:"the carry's tail does not look for one",part:'catch',from:"pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);\n if(r.tapPk)",to:"pinCarryEval(r,b,obs,goalX,tap,fwdTap);\n if(r.tapPk)"},
 {n:"the first look is not the forward one",part:'catch',from:"pinCarryEval(r,b,obs,goalX,tap,true);",to:"pinCarryEval(r,b,obs,goalX,tap);"},
 {n:"a tap taken in the carry's tail is not counted",part:'catch',from:"if(r.tapPk){if(fwdTap&&!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}",to:"if(r.tapPk)return 3;"},
 {n:"the release drops the pose in the same frame",part:'catch',from:"r.pinOn=false;r.tapF=false;",to:"r.pinOn=false;r.pinPose=false;r.tapF=false;"},
 {n:"a forward pin is not held",part:'catch',from:"const mull=fwd&&t<RV.settleT&&!r.force;",to:"const mull=false;"},
 {n:"…a back-tilted pin is held too",part:'catch',from:"const mull=fwd&&t<RV.settleT&&!r.force;",to:"const mull=t<RV.settleT&&!r.force;"},
 {n:"…the whistle waits too",part:'catch',from:"const mull=fwd&&t<RV.settleT&&!r.force;",to:"const mull=fwd&&t<RV.settleT;"},
 {n:"…the hold never ends",part:'catch',from:"const mull=fwd&&t<RV.settleT&&!r.force;",to:"const mull=fwd&&!r.force;"},
 {n:"…and is played anyway",part:'catch',from:"if(mull){}\n else if(open)",to:"if(false){}\n else if(open)"},
 {n:"a tap is looked at while it is held",part:'catch',from:"pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);",to:"pinCarryEval(r,b,obs,goalX,tap,fwdTap);"},
 {n:"…not the carry",part:'catch',from:"pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);",to:"if(!mull)pinCarryEval(r,b,obs,goalX,tap,fwdTap);"},
 {n:"a tap goes before the carry whatever the switch says",part:'catch',from:"&&RV.lift.on&&RV.tap.first;",to:"&&RV.lift.on;"},
 {n:"every ball is taken forward, a shot open or not",part:'catch',from:"if(pinOutlet(r,bx,bz,laneObs(r.team,bx,gx,CA.shotV),gx,0)>=CA.lineClear)return false;",to:""},
 {n:"the take switch is ignored",part:'catch',from:"if(!TK||!TK.on||!CA.recv.on",to:"if(!TK||!CA.recv.on"},
 {n:"the receiving pose switch is ignored",part:'catch',from:"||!CA.recv.on||!CA.recv.lift.on",to:"||!CA.recv.lift.on"},
 {n:"the lift switch is ignored by the take",part:'catch',from:"||!CA.recv.lift.on||TK.roles",to:"||TK.roles"},
 {n:"every role takes",part:'catch',from:"||TK.roles.indexOf(r.role)<0)return false;",to:")return false;"},
 {n:"the share is ignored",part:'catch',from:"return rngAi(r.idx)()<TK.share;",to:"return true;"},
 {n:"the chance is the wrong way round",part:'catch',from:"return rngAi(r.idx)()<TK.share;",to:"return rngAi(r.idx)()>=TK.share;"},
 {n:"a ball that could be taken is not counted",part:'catch',from:"CAS.take++;",to:""},
 {n:"the side catch never takes forward",part:'catch',from:"r.catSg=sg;r.catCush=false;r.catFwd=ahead;",to:"r.catSg=sg;r.catCush=false;r.catFwd=false;"},
 {n:"the side catch always takes forward",part:'catch',from:"r.catSg=sg;r.catCush=false;r.catFwd=ahead;",to:"r.catSg=sg;r.catCush=false;r.catFwd=true;"},
  {n:"the meet never takes forward",part:'catch',from:"r.catSg=-sg;r.catCush=false;r.catFwd=rel>0;",to:"r.catSg=-sg;r.catCush=false;r.catFwd=false;"},
 {n:"the forward pose drops on the back angle",part:'catch',from:" const fa=footAngle(rel,r.catFwd);\n if(fa!=null&&(r.catCush",to:" const fa=footAngle(rel,false);\n if(fa!=null&&(r.catCush"},
 {n:"the forward angle search looks on the back side",part:'catch',from:"let lo=fwd?1.4:-1.4,hi=fwd?0.1:-0.2;",to:"let lo=-1.4,hi=-0.2;"},
 {n:"the men go up back and over for a forward catch",part:'catch',from:"r.pinOn=false;r.pinPose=!!fw;",to:"r.pinOn=false;r.pinPose=false;"},
 {n:"...raised as well",part:'catch',from:"r.raise=!fw;",to:"r.raise=true;"},
 {n:"...never raised for a catch as usual",part:'catch',from:"r.raise=!fw;",to:"r.raise=false;"},
 {n:"the up pose is tilted the wrong way",part:'catch',from:"r.pinA=fw?AIC.catch.recv.lift.angle*r.kickDir:null;",to:"r.pinA=fw?-AIC.catch.recv.lift.angle*r.kickDir:null;"},
 {n:"a ball is let through whatever its speed (too slow)",part:'catch',from:"cr>=TH.minV&&cr<=TH.maxV&&",to:"cr<=TH.maxV&&"},
 {n:"...too quick",part:'catch',from:"cr>=TH.minV&&cr<=TH.maxV&&",to:"cr>=TH.minV&&"},
 {n:"...whatever its sideways speed",part:'catch',from:"Math.abs(rb.v.z)<=TH.maxVZ&&",to:""},
 {n:"...in the air",part:'catch',from:"rb.m.position.y<AIC.lowY&&",to:""},
 {n:"...too near",part:'catch',from:"&&rel>=TH.near&&rel<=TH.far&&",to:"&&rel<=TH.far&&"},
 {n:"...too far",part:'catch',from:"&&rel>=TH.near&&rel<=TH.far&&",to:"&&rel>=TH.near&&"},
 {n:"...the switch",part:'catch',from:"if(ph==='front'&&TH&&TH.on&&",to:"if(ph==='front'&&TH&&"},
 {n:"...whatever the chance says",part:'catch',from:"&&takeFwd(r,p.x,r.baseZ[m.i]+m.o)){r.catMan=m.i;r.catO=m.o;r.catFwd=true;return 'thru';}",to:"){r.catMan=m.i;r.catO=m.o;r.catFwd=true;return 'thru';}"},
 {n:"...and is a front catch all the same",part:'catch',from:"r.catFwd=true;return 'thru';}",to:"r.catFwd=true;return ph;}"},
 {n:"a ball from behind takes forward whatever the chance says",part:'catch',from:"fb=ph==='behind'&&TB&&TB.on&&takeFwd(r,r.x+dir*TB.stop,r.baseZ[m.i]+m.o);",to:"fb=ph==='behind'&&TB&&TB.on;"},
 {n:"...and a front ball takes the style too",part:'catch',from:"fb=ph==='behind'&&TB&&TB.on&&",to:"fb=TB&&TB.on&&"},
 {n:"...the switch",part:'catch',from:"fb=ph==='behind'&&TB&&TB.on&&",to:"fb=ph==='behind'&&TB&&"},
 {n:"a ball held forward from behind is handed to retrieve",part:'catch',from:"if(r.catPh==='behind'&&!r.catFwd){CAS.hand++;",to:"if(r.catPh==='behind'){CAS.hand++;"},
 {n:"...and is not counted",part:'catch',from:"if(r.catPh==='behind')CAS.behindOk++;",to:""},
 {n:"a ball from behind is held on the straight pose",part:'catch',from:"r.pinA=(r.catFwd?CA.recv.angle:A.angle)*dir;",to:"r.pinA=A.angle*dir;"},
 {n:"a forward catch from behind times the pose to the heel",part:'catch',from:"r.catFwd?CA.recv.take.behind.stop:A.stop",to:"A.stop"},
 {n:"a ball from behind that has rolled under to the forward foot is still on its way",part:'catch',from:"tAr=Math.max(0,((front?rel:-rel)-",to:"tAr=Math.max(0,(Math.abs(rel)-"},
 {n:"a forward catch from behind is over at the pivot",part:'catch',from:"rel>(r.catFwd?SHOT.pin.fwdFront:-0.5)",to:"rel>-0.5"},
 {n:"a ball stopped dead against the leg is not waited on",part:'catch',from:"&&!(r.catFwd&&recvRest(r)&&S.time-(r.rvRestT||(r.rvRestT=S.time))<CA.recv.rest))",to:"&&true)"},
 {n:"...any slow ball is",part:'catch',from:"!(r.catFwd&&recvRest(r)&&",to:"!(r.catFwd&&"},
 {n:"...for ever",part:'catch',from:"S.time-(r.rvRestT||(r.rvRestT=S.time))<CA.recv.rest",to:"true"},
 {n:"a let-through ends when it has rolled through (it never does)",part:'catch',from:"else if(rel<TH.catchRel-TH.past)why='past';",to:"else if(false)why='past';"},
 {n:"...or bounced back",part:'catch',from:"else if(vf>1&&rel>CA.front.near)why='away';",to:"else if(false)why='away';"},
 {n:"...or stopped short",part:'catch',from:"else if(v.length()<CA.restV&&rel>SHOT.pin.front+0.3)why='stopped';",to:"else if(false)why='stopped';"},
 {n:"...or took too long",part:'catch',from:"else if(r.catT>TH.abortT)why='time';",to:"else if(false)why='time';"},
 {n:"...or went up",part:'catch',from:"else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TH.abortT)",to:"else if(r.force)why='force';else if(r.catT>TH.abortT)"},
 {n:"the leg comes down at once",part:'catch',from:"if(tAr<=TH.dropT){r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;}",to:"if(true){r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;}"},
 {n:"the leg never comes down",part:'catch',from:"if(tAr<=TH.dropT){r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;}",to:"if(false){r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;}"},
 {n:"the leg lands somewhere else than where it rests",part:'catch',from:"const c=Math.max(2,-vf),tAr=Math.max(0,(rel-TH.catchRel)/c);",to:"const c=Math.max(2,-vf),tAr=Math.max(0,rel/c);"},
 {n:"the let-through is not routed from catchStep",part:'catch',from:"if(r.catPh==='thru'){thruStep(r,best);return;}",to:""},
 {n:"a let-through that is pinned is not counted",part:'catch',from:"if(r.catPh==='thru')CAS.thruOk++;",to:""},
 {n:"the AI never snakes",part:'catch',from:"const sn=r.pcSn=fwd&&snakeHold(r,b),SN=CA.snake;",to:"const sn=r.pcSn=false,SN=CA.snake;"},
 {n:"a leg tilted back snakes too",part:'catch',from:"r.pcSn=fwd&&snakeHold(r,b)",to:"r.pcSn=snakeHold(r,b)"},
 {n:"the snake reaches every depth",part:'catch',from:"||b.pinDx<SN.relMin||b.pinDx>SN.relMax",to:""},
 {n:"...too near",part:'catch',from:"||b.pinDx<SN.relMin",to:""},
 {n:"...too far",part:'catch',from:"||b.pinDx>SN.relMax",to:""},
 {n:"the snake switch is ignored",part:'catch',from:"if(!SN||!SN.on||!SHOT.snake",to:"if(!SN||!SHOT.snake"},
 {n:"every role snakes",part:'catch',from:"||SN.roles.indexOf(r.role)<0",to:""},
 {n:"the snake share is drawn every frame",part:'catch',from:"if(r.pcSnD==null){",to:"{"},
 {n:"the snake share is ignored",part:'catch',from:"rngAi(r.idx)()<u",to:"true"},
 {n:"a new hold keeps the last snake draw",part:'catch',from:"r.pcSn=false;r.pcSnD=null;r.puPh",to:"r.pcSn=false;r.puPh"},
 {n:"a sliding snake is braked",part:'catch',from:"(!sn||SN.brake)",to:"true"},
 {n:"the snake brake switch is ignored",part:'catch',from:"(!sn||SN.brake)",to:"!sn"},
 {n:"a snake hold judges the pin shot push",part:'catch',from:"if(r.pcSn){const SN=AIC.catch.snake;return pinOutlet(r,bx,bz+SN.drift*sv,obs,goalX,SN.k*sv);}",to:""},
 {n:"a creeping snake is judged standing",part:'catch',from:"now=(still&&!sn)?",to:"now=still?"},
 {n:"the snake lane margin is the pin shot one",part:'catch',from:"open=now>=(sn?SN.clear:CA.lineClear)",to:"open=now>=CA.lineClear"},
 {n:"the snake reads the rows at the pin shot speed",part:'catch',from:"laneObs(r.team,p.x,goalX,sn?SN.shotV:CA.shotV)",to:"laneObs(r.team,p.x,goalX,CA.shotV)"},
 {n:"the slide is not carried into the snake",part:'catch',from:"if(sn){r.catSv=sv;r.catSl=sl;r.catHold=SHOT.snake.spin+SHOT.snake.follow;}",to:"if(sn){}"},
 {n:"the snake never brakes after its strike",part:'catch',from:"r.catHold=SHOT.snake.spin+SHOT.snake.follow;}",to:"}"},
 {n:"the snake slope is the push one",part:'catch',from:"sl=sn?SN.k*sv:still?0:pushSlope(r,sv)",to:"sl=still?0:pushSlope(r,sv)"},
 {n:"a snake shot is fired as the pin shot",part:'catch',from:"else if(r.pcSn)snakeFire(r);",to:""},
 {n:"the snake is counted as a pin shot",part:'catch',from:"else if(r.pcSn)CAS.snake++;else CAS.shot++;",to:"else CAS.shot++;"},
 {n:"the snake lets the ball go at the roll speed",part:'catch',from:"pinRelease(r,false,K.carry);",to:"pinRelease(r);"},
 {n:"the snake costs a plain swing",part:'catch',from:"r.shotExert=K.exert;kickRod",to:"kickRod"},
 {n:"the snake leaves its stamina on the rod",part:'catch',from:"kickRod(r,'snake',null,K);r.shotExert=1;",to:"kickRod(r,'snake',null,K);"},
 {n:"the snake swing is the plain curve",part:'catch',from:"kickRod(r,'snake',null,K);",to:"kickRod(r,'snake',null,null);"},
 {n:"the snake is not aimed",part:'catch',from:"r.catAim=pinAim(r,r.pinB,r.catSl||0);r.aimEv=r.catAim;\n pinRelease(r,false,K.carry);",to:"pinRelease(r,false,K.carry);"},
 {n:"the snake aims with the push drift",part:'catch',from:"dr=r.pcSn?AIC.catch.snake.drift:AIC.catch.push.drift",to:"dr=AIC.catch.push.drift"},
 {n:"a snake hold re-seats its shot",part:'catch',from:"&&!(v===1&&r.pcSn)){reseat(r);return;}",to:"){reseat(r);return;}"},
 {n:"a snake hold swings its pass",part:'catch',from:"&&!(v===1&&r.pcSn)){reseat",to:"&&!r.pcSn){reseat"},
 {n:"the catch end is not called a snake",part:'catch',from:"v===2?'passed':r.pcSn?'snake':'shot'",to:"v===2?'passed':'shot'"},
 {n:"the carry turns round at once",part:'catch',from:"S.time<r.pcTurnT)nz=r.pcTz;",to:"false)nz=r.pcTz;"},
 {n:"...and is never held to the turn time",part:'catch',from:"else if(sg!==r.pcSgn){r.pcSgn=sg;r.pcTurnT=S.time+CA.turnT;}",to:"else if(sg!==r.pcSgn){r.pcSgn=sg;}"},
 {n:"every role pulls",part:'catch',from:"||PL.roles.indexOf(r.role)<0||r.force",to:"||r.force"},
 {n:"the pull is drawn every frame",part:'catch',from:"if(r.puRoll==null)r.puRoll=",to:"r.puRoll="},
 {n:"a pull with its tries spent goes on",part:'catch',from:"||(r.puN|0)>=PL.tries)return false;",to:")return false;"},
 {n:"the dead-ball push pulls",part:'catch',from:"PL.roles.indexOf(r.role)<0||r.force||",to:"PL.roles.indexOf(r.role)<0||"},
 {n:"a ball that cannot get wide is pulled",part:'catch',from:"if(zw<PL.wide)return false;",to:""},
 {n:"the burst runs away from the middle",part:'catch',from:"r.puS=-w;",to:"r.puS=w;"},
 {n:"a narrow ball is never taken wide",part:'catch',from:"Math.max(PL.wide,wz+(fake?PL.sellD:0))",to:"wz+(fake?PL.sellD:0)"},
 {n:"the fake is never sold",part:'catch',from:"if(tw>wz+0.5){",to:"if(false){"},
 {n:"a new hold keeps the last pull",part:'catch',from:"r.puPh=null;r.puN=0;r.puRoll=null;r.puB=false;}",to:"r.puB=false;}"},
 {n:"the sell goes the wrong way",part:'catch',from:"r.target=r.puO-s*r.puD;",to:"r.target=r.puO+s*r.puD;"},
 {n:"the sell never turns",part:'catch',from:"if(Math.abs(r.offset-r.target)>0.3&&r.puT<PL.sellT)return false;",to:"return false;"},
 {n:"the sell has no time limit",part:'catch',from:"&&r.puT<PL.sellT)return false;",to:")return false;"},
 {n:"the burst runs flat out whatever the landing",part:'catch',from:"clamp((-s*p.z-PL.aim)/c,P.minV,",to:"clamp(1e9,P.minV,"},
 {n:"the pull fires anywhere in the mouth",part:'catch',from:"post>=PL.post[0]&&post<=PL.post[1]&&",to:""},
 {n:"the pull fires through a man",part:'catch',from:"&&now>=PL.clear&&",to:"&&"},
 {n:"the pull fires on a slide either way",part:'catch',from:"if(s*sv>=P.minV&&",to:"if(Math.abs(sv)>=P.minV&&"},
 {n:"the pull never gives up on a ball past the band",part:'catch',from:"||-s*p.z<PL.post[0]){",to:"){"},
 {n:"the burst has no time limit",part:'catch',from:"if(r.puT>=PL.burstT||room<P.room",to:"if(room<P.room"},
 {n:"the stop never ends",part:'catch',from:"if(Math.abs(r.slideV)<=AIC.catch.fireV)r.puPh=null;return false;}",to:"return false;}"},
 {n:"an open lane cuts a running pull short",part:'catch',from:"(r.puPh||!open)&&puWant",to:"!open&&puWant"},
 {n:"a forward pin pulls",part:'catch',from:"if(!late&&!fwd&&(r.puPh",to:"if(!late&&(r.puPh"},
 {n:"a late hold keeps pulling",part:'catch',from:"if(!late&&!fwd&&(r.puPh",to:"if(!fwd&&(r.puPh"},
 {n:"the pull's shot keeps no slide",part:'catch',from:"r.pcWhy='pull';r.catSv=sv;r.catSl=sl;",to:"r.pcWhy='pull';"},
 {n:"the burst speed is dropped for its swing",part:'catch',from:"r.puB=r.puPh==='burst';",to:"r.puB=false;"},
 {n:"pushBurst ignores the burst",part:'catch',from:"?AIC.catch.push.play.burst:0;}",to:"?0:0;}"},
 {n:"pushBurst outlives the ball",part:'catch',from:"(r.puPh==='burst'&&r.pinB)",to:"(r.puPh==='burst')"},
 {n:"the catch end leaves the pull running",part:'catch',from:"r.ftPh=null;r.puPh=null;\n",to:"r.ftPh=null;\n"},
];
let missed=0;
for(const m of MUT){
 let caught=false,detail='';
 try{const res=suite(boot(m));caught=res.some(t=>!t.ok);if(caught)detail=res.filter(t=>!t.ok).length+' assertions';}
 catch(e){detail='THREW '+e.message;missed++;}
 if(!caught&&!detail.startsWith('THREW')){missed++;detail='NOT CAUGHT';}
 console.log('  '+(caught?'caught ':'MISSED ')+' ('+(detail||'-')+')  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
if(bad||missed)process.exit(1);
