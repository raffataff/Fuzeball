// fetch harness. node tools/fetch-harness.js
// the forward pin's front door (CONFIG.ai.catch.fetch): a loose ball lying ahead of the rod, no shot open to it, is taken from above (clear, up, over, down), and held under the forward leg where it lies
// slices the real fetchPick / fetchStep / catchPick / catchStep / catchEnd (ai.js) and pinUpdate / pinBallStep / pinRelease (physics.js) and runs them against live CONFIG with bare-bones rods; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js'),PHYS=rd('js/physics.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 lane:slice(AI,'function laneObs(team,bx,tx,v0){',NL+'// gap-aware shot evaluation'),
 fwd:slice(AI,'function fwdClr(team,bx,bz,sl,v0){',NL+'// how good is the way forward from'),
 ret:slice(AI,'function retrieveMan(r,bz){',NL+'function retrievePhase('),
 clr:slice(AI,'function clearOffset(r,bz,cz,prefer){',NL+'// z of the live foot nearest'),
 lz:slice(AI,'function inLaneZ(r,lz,cz){',NL+'// the teammate behind us'),
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:'),
 phys:slice(PHYS,'function pinUpdate(){',NL+'// ================= contact AUDIO gating')
};
const stubs=[
 "var S={balls:[],time:0}; var rods=[]; var DIFFS_T='pro';",
 "var KICKS=[],STRIKE=true,SWEEP=false,PICK=null;",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;KICKS.push({style:style,aim:aim||null});}",
 "function strikeOn(r){return STRIKE;} function sweepClips(){return SWEEP;} function passPick(){return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "var BGS={retEnter:0}; function retrievePhase(r,ph){r.retPh=ph;} function isUserRod(){return false;}",
 "var RNGV=0.99; function rngAi(){return function(){return RNGV;};}",
 "function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 "function V(x,y,z){return {x:x||0,y:y||0,z:z||0,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.ret,g.clr,g.lz,g.phys,g.catch,
  ';globalThis.X={S:S,AIC:AIC,SHOT:SHOT,SIM:SIM,F:F,BALL_R:BALL_R,ARM:ARM,rods:rods,KICKS:KICKS,CAS:CAS,CAW:CAW,V:V,pinUpdate:pinUpdate,pinBallStep:pinBallStep,pinRelease:pinRelease,'+
  'catchEnd:catchEnd,reseat:reseat,tapStep:tapStep,tapEval:tapEval,sidePick:sidePick,catchPick:catchPick,catchStep:catchStep,fetchPick:fetchPick,fetchStep:fetchStep,sideAngle:sideAngle,setPick:function(v){PICK=v;},setRng:function(v){RNGV=v;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D={cd:1};
// the red ATT (x 22.5, attacking +x), three men; opposing DEF at 37.5 (men at -1.1 and 22.9) and keeper at 52.5: a ball at z 0 has no shot
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.KICKS.length=0;X.setPick(null);
 const r={x:22.5,team:0,kickDir:1,role:opt.role||'ATT',aiIQ:opt.iq!=null?opt.iq:true,baseZ:[-12,0,12],maxOff:9,removedUntil:[0,0,0],offset:opt.off||0,target:0,slideV:0,vz:0,angle:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,pinFwd:false,act:'catch',catPh:'fetch',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,ftPh:null,ftT:0};
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:opt.defBase||[0,24],offset:opt.defOff!=null?opt.defOff:-1.1,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff!=null?opt.gkOff:3.5,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:X.V(22.5+rel,y==null?X.BALL_R:y,z)},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);},set(a,b2,c){this.x=a;this.y=b2;this.z=c;return this;}},spin:0};b.real=b;return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,FE=CA.fetch,RV=CA.recv,P=X.SHOT.pin,dir=1;
 CA.iqGate=true;   // this suite is about what a rod whose roll failed still does; the gate-off case has its own line below
 CA.recv.ready.on=false;
 // ---- the pin physics: a forward pose reaches a ball lying ahead ----
 {const r=world(X),a=X.sideAngle(4.5,true),b=view(X,4.5,0);X.S.balls.push(b);
  r.pinOn=true;r.pinPose=true;r.pinA=a;r.angle=a;X.pinUpdate();
  ok('a rod posed over a ball lying ahead does not catch it from the usual window',!r.pinB,'a='+a.toFixed(2));
  r.pinFwd=true;X.pinUpdate();
  ok('...as a forward pin it does, wherever the leg touches it',!!r.pinB&&r.pinB===b&&b.pinDx>4.4&&b.pinDx<4.6,'pinDx='+b.pinDx);
  r.offset=4;for(let i=0;i<5;i++)X.pinBallStep(b,dt);
  ok('...and carries it with the rod, where it lies (x unchanged, z follows)',Math.abs(b.m.position.x-(r.x+4.5))<0.05&&Math.abs(b.m.position.z-(r.baseZ[1]+4))<0.05,'x='+b.m.position.x+' z='+b.m.position.z);}
 {const r=world(X),b=view(X,12.5,0);X.S.balls.push(b);r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=1.0;r.angle=1.0;X.pinUpdate();
  ok('a ball out of the leg\'s touch is not caught, however wide the window',!r.pinB);}
 {const r=world(X),a=X.sideAngle(4.5,true),b=view(X,4.5,0,-30,0);X.S.balls.push(b);r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=a;r.angle=a;X.pinUpdate();
  ok('...nor one running at the leg too fast to hold',!r.pinB);}
 // ---- which balls are fetched ----
 {const r=world(X);const b=view(X,4,0);
  ok('a ball lying 4 ahead with no shot to it is fetched',X.fetchPick(r,b)===true);
  const m=world(X,{role:'MID'});ok('...by a midfielder too',X.fetchPick(m,view(X,4,0))===true);
  const k=world(X,{role:'GK'});ok('...not by the keeper',X.fetchPick(k,view(X,4,0))===false);
  ok('not one the boot at rest already touches',X.fetchPick(world(X),view(X,FE.near-0.3,0))===false);
  ok('...nor one too far to reach',X.fetchPick(world(X),view(X,FE.far+0.3,0))===false);
  ok('...nor one that is rolling',X.fetchPick(world(X),view(X,4,0,FE.maxV+2,0))===false);
  ok('...nor one in the air',X.fetchPick(world(X),view(X,4,0,0,0,AIC_lowY(X)+0.5))===false);
  ok('...nor one a shot is open to (the kick takes it)',X.fetchPick(world(X,{defOff:-9,gkOff:-9}),view(X,4,-6))===true&&X.fetchPick(world(X,{defOff:10,gkOff:-20}),view(X,4,1))===false,'');
  const e=world(X,{off:0});e.removedUntil=[1e9,1e9,1e9];ok('...nor one no man is left to reach',X.fetchPick(e,view(X,4,0))===false);
  CA.fetch.on=false;ok('...and with the switch off none',X.fetchPick(world(X),view(X,4,0))===false);CA.fetch.on=true;}
 // ---- the sequence ----
 {const r=world(X),b=view(X,4,0);X.S.balls.push(b);b.v.set(0,0,0);
  X.fetchPick(r,b);r.act='catch';r.catPh='fetch';
  // the man is on the ball: slide off it first, the leg down
  r.offset=0;X.fetchStep(r,b);
  ok('the man is on the ball\'s lane: it slides clear first, the leg down',r.ftPh==='clear'&&!r.pinOn&&!r.pinFwd&&Math.abs(r.target)>=FOOT_Z(X)-0.5&&r.target!==0,'ph='+r.ftPh+' tgt='+r.target);
  r.offset=r.target;r.target=r.offset+3;X.fetchStep(r,b);
  ok('...clear of it, the leg goes up and forward (a forward pin pose)',r.ftPh==='up'&&r.pinOn&&r.pinPose&&r.pinFwd&&r.pinA===RV.lift.angle*dir&&r.target===r.offset,'ph='+r.ftPh);
  r.angle=0.2;X.fetchStep(r,b);ok('...and waits for it',r.ftPh==='up');
  r.ftT=FE.downT+0.1;X.fetchStep(r,b);ok('...but not for ever',r.ftPh==='over');r.ftPh='up';r.ftT=0;
  r.angle=RV.lift.angle;X.fetchStep(r,b);
  ok('...up, the man slides over the ball with the leg still up',r.ftPh==='over'&&r.pinA===RV.lift.angle*dir&&r.aiMan>=0&&Math.abs(r.target-0)<=r.maxOff,'ph='+r.ftPh+' man='+r.aiMan);
  r.offset=r.target-2;X.fetchStep(r,b);ok('...and waits to be over it',r.ftPh==='over');
  r.offset=r.target;r.slideV=FE.slideV+5;X.fetchStep(r,b);ok('...and to slow down (the pin takes a ball only at a small speed relative to the rod)',r.ftPh==='over');
  r.slideV=0;X.fetchStep(r,b);
  ok('...over it and still, the leg comes down onto it at the angle that holds it just inside the pin\'s reach',r.ftPh==='down'&&r.pinFwd&&Math.abs(r.pinA-X.sideAngle(4,true))<1e-9,'ph='+r.ftPh+' a='+r.pinA);
  r.catT=0;r.ftT=FE.downT+0.01;X.fetchStep(r,b);
  ok('a leg that never takes it lets go and the catch ends',r.act===null&&r.catCd>0&&X.CAW['fetch:nopin']>=1);}
 {const r=world(X),b=view(X,4,0);X.S.balls.push(b);r.maxOff=0.3;X.fetchStep(r,b);
  ok('with no room to stand clear of it the catch ends',r.act===null&&X.CAW['fetch:room']>=1);}
 {const r=world(X),b=view(X,4,0);X.S.balls.push(b);
  r.ftPh='up';r.ftT=0;r.offset=9;X.fetchStep(r,b);X.fetchStep(r,b);
  const bz=b.m.position.z;b.m.position.z=r.baseZ[2]+r.offset;X.fetchStep(r,b);
  ok('the ball rolls into the lane while the leg is going up: back to clearing',r.ftPh==='clear'||r.act===null);}
 {const mk=(f)=>{const r=world(X),b=view(X,4,0);X.S.balls.push(b);r.catPh='fetch';r.ftPh='over';f(r,b);X.fetchStep(r,b);return r;};
  ok('the ball lifts: ended',mk((r,b)=>{b.m.position.y=AIC_lowY(X)+1;}).act===null&&X.CAW['fetch:lifted']>=1);
  ok('...speeds up: ended',mk((r,b)=>{b.v.set(FE.bailV+2,0,0);}).act===null&&X.CAW['fetch:moved']>=1);
  ok('...rolls away or into the boot: ended',mk((r,b)=>{b.m.position.x=22.5+FE.far+3;}).act===null&&X.CAW['fetch:off']>=1);
  ok('...the dead-ball push: ended',mk((r)=>{r.force=true;}).act===null&&X.CAW['fetch:force']>=1);
  ok('...too long: ended',mk((r)=>{r.catT=FE.abortT+1;}).act===null&&X.CAW['fetch:time']>=1);
  ok('...goes in the goal: ended',mk((r,b)=>{b.scored=true;}).act===null&&X.CAW['fetch:scored']>=1);
  ok('...no man can reach it any more: ended',mk((r,b)=>{r.removedUntil=[1e9,1e9,1e9];}).act===null&&X.CAW['fetch:reach']>=1);
  const e=mk((r)=>{r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=1.1;r.force=true;});ok('ending clears the pose and the forward flag',!e.pinOn&&!e.pinPose&&!e.pinFwd&&e.ftPh===null);}
 // ---- caught: held where it lies ----
 {const r=world(X),a=X.sideAngle(4,true),b=view(X,4,0);X.S.balls.push(b);
  r.angle=a;r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=a;r.catPh='fetch';r.ftPh='down';r.act='catch';
  X.pinUpdate();ok('(the leg is down on it: pinned)',!!r.pinB);
  const f0=X.CAS.fetchOk;X.catchStep(r,b,D);
  ok('a caught fetch is a hold, counted, held where it lies (the man never moves through the ball)',r.catPh==='hold'&&X.CAS.fetchOk===f0+1&&!!r.pinB&&b.pinDx>3.9&&r.pinFwd&&r.pinOn&&r.pinPose&&r.pinA===r.angle,'ph='+r.catPh);
  X.catchStep(r,b,D);ok('...and stays so',r.catPh==='hold'&&!!r.pinB&&b.pinDx>3.9);}
 // ---- played with a swing: let go, off its z, the leg down, back onto it ----
 {const mk=(dx)=>{const r=world(X),a=dx<0?RV.angle:X.sideAngle(Math.max(dx,1.5),true),b=view(X,dx,0);X.S.balls.push(b);r.angle=a;r.pinOn=true;r.pinPose=true;r.pinFwd=dx>1.4;r.pinA=a;r.catPh='hold';r.act='catch';X.pinUpdate();if(!r.pinB){r.pinB=b;b.pinDx=dx;b.pinDz=0;b.pinR=r;b.pinMan=1;}return {r,b};};
  const m=mk(4),a0=X.CAS.ahead,s0=X.CAS.reseat;X.reseat(m.r);
  ok('a ball held 4 ahead of the rod is played by the man going away and coming back (not re-pinned from behind)',m.r.catPh==='ahead'&&m.r.ahPh==='rest'&&X.CAS.ahead===a0+1&&X.CAS.reseat===s0+1&&!!m.r.pinB,'ph='+m.r.catPh);
  const u=mk(-0.8);u.r.pinB.pinDx=-0.8;X.reseat(u.r);ok('...one under the leg is still re-seated the old way (the leg turns up, retrieve re-pins it)',u.r.catPh==='flift');
  FE.on=false;const o=mk(4);X.reseat(o.r);ok('...and with the fetch off every ball is',o.r.catPh==='flift');FE.on=true;
  const n=mk(FE.aheadMin+0.2);X.reseat(n.r);ok('...the line is aheadMin',n.r.catPh==='ahead');
  const q=mk(4);q.r.pinB.pinDx=FE.aheadMin-0.2;X.reseat(q.r);ok('...nearer than that it is under the leg',q.r.catPh==='flift');}
 {const mk=()=>{const r=world(X),b=view(X,4,0);X.S.balls.push(b);const a=X.sideAngle(4,true);r.angle=a;r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=a;X.pinUpdate();r.catPh='ahead';r.ahPh='rest';r.ahT=0;r.catT=0;return {r,b};};
  const m=mk();m.r.slideV=RV.lift.restV+8;X.catchStep(m.r,m.b,D);
  ok('the rod is still sliding: it brakes first, the ball still held',m.r.ahPh==='rest'&&!!m.r.pinB&&m.r.target===m.r.offset&&m.r.pinA===m.r.angle);
  m.r.slideV=0;X.catchStep(m.r,m.b,D);
  ok('...stopped, the ball is let go at rest and the man goes off its z with the leg up and forward',m.r.pinB===null&&m.r.ahPh==='side'&&!m.r.pinOn&&m.r.pinPose&&m.r.pinA===RV.lift.angle*dir&&!m.r.pinFwd&&Math.abs(m.r.target)>=FOOT_Z(X)-0.5,'ph='+m.r.ahPh+' tgt='+m.r.target);
  m.r.offset=m.r.target;X.catchStep(m.r,m.b,D);
  ok('...clear of it, the leg comes down at rest (the pose is let go)',m.r.ahPh==='down'&&!m.r.pinPose&&m.r.pinA===null);
  m.r.angle=1.0;X.catchStep(m.r,m.b,D);ok('...and it waits for the leg',m.r.ahPh==='down');
  m.r.ahT=FE.downWait+0.1;X.catchStep(m.r,m.b,D);ok('...but not for ever',m.r.ahPh==='back');m.r.ahPh='down';m.r.ahT=0;m.r.angle=0.05;X.catchStep(m.r,m.b,D);
  ok('...down, it slides back onto the ball with the boot down',m.r.ahPh==='back'&&!m.r.pinPose&&m.r.act==='catch'&&Math.abs(m.r.target)<=m.r.maxOff&&m.r.aiMan>=0,'ph='+m.r.ahPh);
  m.r.offset=m.r.target-3;X.catchStep(m.r,m.b,D);ok('...and keeps going until it is on it',m.r.act==='catch');
  m.r.offset=m.r.target;const c0=X.CAW['ahead:done']||0;X.catchStep(m.r,m.b,D);
  ok('...on it, the action is over with a short cooldown (the ordinary swing is next) and no fetch for a while',m.r.act===null&&X.CAW['ahead:done']===c0+1&&m.r.catCd>0&&m.r.ftCd>X.S.time,'ftCd='+m.r.ftCd);
  ok('...a fetch is not made of the ball again while that lasts',X.fetchPick(m.r,m.b)===false);m.r.ftCd=0;ok('...and is after it',X.fetchPick(m.r,m.b)===true);}
 {const mk=(ph,f)=>{const r=world(X),b=view(X,4,0);X.S.balls.push(b);r.catPh='ahead';r.ahPh=ph;r.ahT=0;f(r,b);X.catchStep(r,b,D);return r;};
  ok('played: the ball lifts, ended',mk('side',(r,b)=>{b.m.position.y=AIC_lowY(X)+1;}).act===null&&X.CAW['ahead:lifted']>=1);
  ok('...the ball rolls off, ended',mk('down',(r,b)=>{b.v.set(FE.bailV+2,0,0);}).act===null&&X.CAW['ahead:moved']>=1);
  ok('...but a held one still being carried is not moved',mk('rest',(r,b)=>{b.v.set(FE.bailV+2,0,0);r.pinB={m:b.m,v:b.v,pinMan:1,pinDx:4,pinDz:0};r.slideV=50;}).act==='catch');
  ok('...the dead-ball push, ended',mk('side',(r)=>{r.force=true;}).act===null&&X.CAW['ahead:force']>=1);
  ok('...too long, ended',mk('back',(r)=>{r.ahT=FE.aheadT+0.1;}).act===null&&X.CAW['ahead:time']>=1);
  ok('...no man can reach it, ended',mk('back',(r)=>{r.removedUntil=[1e9,1e9,1e9];}).act===null&&X.CAW['ahead:reach']>=1);
  const w=world(X),wb=view(X,4,0);X.S.balls.push(wb);w.catPh='ahead';w.ahPh='side';w.ahT=0;w.maxOff=0.3;X.catchStep(w,wb,D);ok('...no room to stand clear, ended',w.act===null&&X.CAW['ahead:room']>=1);}
 // ---- a forward leg holds a ball from above only: the foot has to reach the top of it ----
 {const hold=(rel,ang,vx)=>{const r=world(X),b=view(X,rel,0,vx||0,0);X.S.balls.push(b);r.angle=ang;r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=ang;X.pinUpdate();return !!r.pinB;},sa=X.sideAngle;
  ok('a leg lowered onto a ball lying 3, 4 and 4.9 ahead until it touches the top of it holds it',hold(3,sa(3,true))&&hold(4,sa(4,true))&&hold(4.9,sa(4.9,true)));
  ok('...a leg hovering over it (further off than fwdTouch) does not',!hold(4,sa(4,true)+0.06)&&!hold(4.9,sa(4.9,true)+0.12));
  ok('...a ball in front of a low raised leg (touching its side, not its top) is pushed away, not held (the toe cannot pin)',!hold(4.7,0.3)&&!hold(4.4,0.3)&&!hold(3.0,0.1));
  ok('...a ball too near for the foot to sit on it (the contact is low on its side) is not held',!hold(1.5,0.8));
  const keep=P.fwdFront;P.fwdFront=3.5;ok('...a ball past fwdFront is not held, touching or not',!hold(4,sa(4,true)));P.fwdFront=keep;
  const dn=P.fwdDown;P.fwdDown=-1;ok('(the rule is fwdDown: with it off the low touch holds again)',hold(4.7,0.3)&&hold(1.5,0.8));P.fwdDown=dn;
  const tc=P.fwdTouch;P.fwdTouch=P.touch;ok('(...and fwdTouch: with the old slop a leg 0.06 over it holds)',hold(4,sa(4,true)+0.06));P.fwdTouch=tc;
  const q=world(X);ok('a ball running at the rod is never taken by a toe now: the shaft stops it',X.catchPick(q,view(X,18,0,-30,0))==='front'&&!q.catFwd);
  ok('the pose that sits the foot on a ball lying ahead is higher the further the ball (a leg lowered onto it)',sa(3,true)<sa(4,true)&&sa(4,true)<sa(4.9,true));
  ok('...and out of its reach the leg stays up',sa(P.fwdFront+3,true)===RV.lift.angle);}
 // ---- a tap from a ball held ahead ----
 {const TP=CA.tap,mk=(dx,ang,fwd)=>{const r=world(X);r.baseZ=[-6,0,6];r.catPh='tap';r.tapS=1;r.tapJ=1;r.tapF=fwd;r.angle=ang;r.pinOn=true;r.pinPose=true;r.pinFwd=fwd&&dx>1.4;r.pinA=ang;r.slideV=1e3;
   const b=view(X,dx,-6);b.pinMan=0;X.S.balls.push(b);X.pinUpdate();if(!r.pinB){r.pinB=b;}b.pinDx=dx;b.pinDz=0;b.pinR=r;return {r,b};};
  const a=mk(4,X.sideAngle(4,true),true),t0=X.CAS.tap;X.tapStep(a.r,a.b);
  ok('a tap from a ball held 4 ahead lets it go as it is (the leg is already clear of it) and the next man takes it under a forward leg',a.r.catPh==='side'&&a.r.catFwd===true&&a.r.pinB===null&&a.r.catMan===1&&a.r.catSg===1&&X.CAS.tap===t0+1,'ph='+a.r.catPh+' fwd='+a.r.catFwd);
  const u=mk(-0.8,RV.angle,true);X.tapStep(u.r,u.b);ok('...from under the leg the leg still turns up to let it go',u.r.catPh==='flift');
  const k=mk(-0.7,-0.75,false);X.tapStep(k.r,k.b);ok('...from the back pin the receiver is a back pin',k.r.catPh==='side'&&k.r.catFwd===false);
  const e=world(X);e.baseZ=[-6,0,6];e.angle=X.sideAngle(4,true);const eb={m:{position:X.V(26.5,X.BALL_R,-6)},v:X.V(),pinMan:0,pinDx:4,pinDz:0};
  ok('the tap looks at a ball held ahead (a forward leg)',X.tapEval(e,eb,[],X.F.L/2)!==null);
  const f=world(X);f.baseZ=[-6,0,6];f.angle=-0.75;ok('...not at one ahead of a back leg (it cannot be held there)',X.tapEval(f,eb,[],X.F.L/2)===null);}
 // ---- the entry: any rod, whatever the iq roll ----
 {const r=world(X,{iq:false}),b=view(X,4,0);ok('a rod whose iq roll is off still fetches a loose ball',X.catchPick(r,b)==='fetch');
  const c=view(X,6,0,-20,0),ig=X.AIC.catch.iqGate;X.AIC.catch.iqGate=true;ok('...but a ball running at it is the front catch\'s, which the roll gates (when the gate is on)',X.catchPick(world(X,{iq:false}),c)===null);X.AIC.catch.iqGate=false;ok('...and which every rod has when it is off',X.catchPick(world(X,{iq:false}),c)==='front');X.AIC.catch.iqGate=ig;
  const s=world(X,{iq:true});ok('...a smart rod takes that one',X.catchPick(s,view(X,6,0,-20,0))==='front');
  ok('...and a loose ball no catch window wants is fetched by a smart rod too',X.catchPick(world(X,{iq:true}),view(X,4,0))==='fetch');
  ok('...and a ball behind the heel is not fetched',X.catchPick(world(X,{iq:false}),view(X,-3,0))===null);}
 return R;
}
function AIC_lowY(X){return X.AIC.lowY;}
function FOOT_Z(X){return 1.35+X.BALL_R;}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'the pin window ignores the forward flag',part:'phys',from:'front=fwd?P.fwdFront:P.front',to:'front=P.front'},
 {n:'a forward leg holds a ball it only touches on the side',part:'phys',from:'||(fwd&&-ny<P.fwdDown*Math.sqrt(d2))',to:''},
 {n:'a forward leg holds a ball it hovers over',part:'phys',from:'reach=BALL_R+PRAD+(fwd?P.fwdTouch:P.touch)',to:'reach=BALL_R+PRAD+P.touch'},
 {n:'every role fetches',part:'catch',from:'FE.roles.indexOf(r.role)<0||',to:''},
 {n:'a ball at the boot is fetched',part:'catch',from:'rel<FE.near||rel>FE.far||',to:'rel>FE.far||'},
 {n:'a ball too far is fetched',part:'catch',from:'rel<FE.near||rel>FE.far||',to:'rel<FE.near||'},
 {n:'a rolling ball is fetched',part:'catch',from:'||rb.v.length()>FE.maxV)return false;',to:')return false;'},
 {n:'a ball in the air is fetched',part:'catch',from:'p.y>=AIC.lowY||rb.v.length()>FE.maxV',to:'rb.v.length()>FE.maxV'},
 {n:'a ball a shot is open to is fetched',part:'catch',from:'if(pinOutlet(r,p.x,p.z,laneObs(r.team,p.x,gx,CA.shotV),gx,0)>=CA.lineClear)return false;',to:''},
 {n:'a ball no man can reach is fetched',part:'catch',from:'if(!retrieveMan(r,p.z))return false;',to:''},
 {n:'the switch is ignored',part:'catch',from:'if(!FE||!FE.on||',to:'if(!FE||'},
 {n:'the leg goes up with the man on the lane',part:'catch',from:'  if(inLaneZ(r,bz,cz)){\n   const o=clearOffset',to:'  if(false){\n   const o=clearOffset'},
 {n:'clearing never ends (no room is not a reason to stop)',part:'catch',from:"if(o==null){catchEnd(r,CA.cd,'fetch:room');return;}",to:'if(o==null){return;}'},
 {n:'the leg is not posed forward going up',part:'catch',from:"if(r.ftPh==='up'){\n  r.pinOn=true;r.pinPose=true;r.pinFwd=true;",to:"if(r.ftPh==='up'){\n  r.pinOn=true;r.pinPose=true;r.pinFwd=false;"},
 {n:'the man slides under the leg while it goes up',part:'catch',from:'r.pinA=RV.lift.angle*dir;r.target=r.offset;r.aiMan=-1;',to:'r.pinA=RV.lift.angle*dir;r.target=r.target;r.aiMan=-1;'},
 {n:'it does not wait for the leg to be up',part:'catch',from:'if(r.angle*dir<RV.lift.angle-FE.upTol&&r.ftT<FE.downT)return;',to:''},
 {n:'it waits for the leg for ever',part:'catch',from:'if(r.angle*dir<RV.lift.angle-FE.upTol&&r.ftT<FE.downT)return;',to:'if(r.angle*dir<RV.lift.angle-FE.upTol)return;'},
 {n:'it does not wait to be over the ball',part:'catch',from:'if(Math.abs(bz-(r.baseZ[mn.i]+r.offset))>FE.alignZ||Math.abs(r.slideV)>FE.slideV)return;',to:''},
 {n:'it does not wait for the slide to die',part:'catch',from:'||Math.abs(r.slideV)>FE.slideV)return;',to:')return;'},
 {n:'the leg comes down at the wrong angle',part:'catch',from:'r.pinA=sideAngle(rel,true)*dir;r.target=mn.o;',to:'r.pinA=RV.lift.angle*dir;r.target=mn.o;'},
 {n:'the leg that never takes it stays down for ever',part:'catch',from:"if(r.ftT>FE.downT)catchEnd(r,CA.cd,'fetch:nopin');",to:''},
 {n:'a ball that moved is still waited for',part:'catch',from:"else if(rb.v.length()>FE.bailV)why='moved';",to:''},
 {n:'a ball that rolled out of range is still waited for',part:'catch',from:"else if(rel<FE.near-1||rel>FE.far+1)why='off';",to:''},
 {n:'a fetch that never ends',part:'catch',from:"else if(r.catT>FE.abortT)why='time';",to:''},
 {n:'a lifted ball does not end it',part:'catch',from:"else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(rb.v",to:"else if(r.force)why='force';else if(rb.v"},
 {n:'the dead-ball push does not end it',part:'catch',from:"else if(r.force)why='force';else if(rb.v.length()>FE.bailV)",to:"else if(rb.v.length()>FE.bailV)"},
 {n:'a man no one can reach does not end it',part:'catch',from:"if(!why&&!mn)why='reach';",to:''},
 {n:'the fetch is not counted',part:'catch',from:'CAS.fetchOk++;',to:''},
 {n:'ending leaves the forward flag and the sequence up',part:'catch',from:'r.pinFwd=false;r.ftPh=null;',to:''},
 {n:'a ball held ahead is re-seated as one under the leg',part:'catch',from:'AIC.catch.fetch.on&&r.pinB.pinDx>AIC.catch.fetch.aheadMin',to:'false'},
 {n:'every forward pin is played the ahead way',part:'catch',from:'AIC.catch.fetch.on&&r.pinB.pinDx>AIC.catch.fetch.aheadMin',to:'AIC.catch.fetch.on'},
 {n:'the ahead action is routed after the pin hold',part:'catch',from:" if(r.catPh==='ahead'){aheadStep(r,best);return;}\n if(r.catPh==='hit'){hitStep(r,best);return;}\n if(r.pinB){",to:" if(r.catPh==='hit'){hitStep(r,best);return;}\n if(r.pinB){"},
 {n:'the ahead action is not counted',part:'catch',from:'CAS.ahead++;',to:''},
 {n:'the ahead action does not brake first',part:'catch',from:'if(r.pinB&&Math.abs(r.slideV)>RV.lift.restV&&r.ahT<RV.lift.abortT)return;',to:''},
 {n:'the ball is not let go',part:'catch',from:"  if(r.pinB)pinRelease(r);\n  r.ahPh='side';",to:"  r.ahPh='side';"},
 {n:'the man does not go off the ball',part:'catch',from:"  if(inLaneZ(r,bz,cz)){\n   const o=clearOffset(r,bz,cz,0);\n   if(o==null){catchEnd(r,CA.cd,'ahead:room');return;}",to:"  if(false){\n   const o=clearOffset(r,bz,cz,0);\n   if(o==null){catchEnd(r,CA.cd,'ahead:room');return;}"},
 {n:'the leg is not up while the man slides off',part:'catch',from:'r.pinOn=false;r.pinPose=true;r.pinFwd=false;r.pinA=RV.lift.angle*dir;r.aiMan=-1;',to:'r.pinOn=false;r.pinPose=false;r.pinFwd=false;r.pinA=null;r.aiMan=-1;'},
 {n:'it does not wait for the leg to come down',part:'catch',from:'if(r.angle*dir>FE.downA&&r.ahT<FE.downWait)return;',to:''},
 {n:'it waits for the leg for ever',part:'catch',from:'if(r.angle*dir>FE.downA&&r.ahT<FE.downWait)return;',to:'if(r.angle*dir>FE.downA)return;'},
 {n:'the leg stays posed while it lowers',part:'catch',from:"r.pinOn=false;r.pinPose=false;r.pinA=null;r.target=r.offset;r.aiMan=-1;\n  if(r.angle*dir>FE.downA",to:"r.pinOn=false;r.pinPose=true;r.pinA=RV.lift.angle*dir;r.target=r.offset;r.aiMan=-1;\n  if(r.angle*dir>FE.downA"},
 {n:'the man does not come back onto the ball',part:'catch',from:'r.target=mn.o;r.aiMan=mn.i;                 // back',to:'r.target=r.offset;r.aiMan=mn.i;                 // back'},
 {n:'it ends before it is on the ball',part:'catch',from:'if(Math.abs(bz-(r.baseZ[mn.i]+r.offset))<=FE.alignZ){r.ftCd',to:'if(true){r.ftCd'},
 {n:'it fetches the ball again at once',part:'catch',from:"r.ftCd=S.time+FE.cd;catchEnd(r,CA.cd,'ahead:done');",to:"catchEnd(r,CA.cd,'ahead:done');"},
 {n:'a fetch ignores the lockout',part:'catch',from:'(r.ftCd||0)>S.time||',to:''},
 {n:'a ball that moved does not end it',part:'catch',from:"else if(r.ahPh!=='rest'&&(rb.v.length()>FE.bailV||rel<FE.near-1||rel>FE.far+1))why='moved';",to:''},
 {n:'a carried ball counts as moved',part:'catch',from:"else if(r.ahPh!=='rest'&&(",to:"else if(("},
 {n:'a lifted ball does not end it (ahead)',part:'catch',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.ahT>FE.aheadT)why='time';",to:"if(rb.scored)why='scored';else if(r.force)why='force';else if(r.ahT>FE.aheadT)why='time';"},
 {n:'the ahead action never times out',part:'catch',from:"else if(r.ahT>FE.aheadT)why='time';",to:''},
 {n:'a tap from ahead turns the leg up first',part:'catch',from:'const ahead=b.pinDx>CA.side.aheadMin;',to:'const ahead=false;'},
 {n:'a tap from ahead does not say so',part:'catch',from:'r.tapAhead=ahead;',to:'r.tapAhead=false;'},
 {n:'the receiver of a tap from ahead is a back pin',part:'catch',from:'r.catFwd=!!r.tapAhead;r.tapAhead=false;',to:'r.catFwd=false;r.tapAhead=false;'},
 {n:'every tap lets go without turning up',part:'catch',from:'if(r.tapF&&!ahead){fliftStart',to:'if(false){fliftStart'},
 {n:'the iq roll gates the fetch too',part:'catch',from:"if(!smart)return fetchPick(r,best)?'fetch':null;",to:"if(!smart)return null;"},
 {n:'a smart rod ignores a loose ball',part:'catch',from:"c<A.minClose||c>A.maxClose)return fetchPick(r,best)?'fetch':null;",to:"c<A.minClose||c>A.maxClose)return null;"},
 {n:'a rod that is not smart takes the other catches',part:'catch',from:"if(!smart)return fetchPick(r,best)?'fetch':null;",to:"if(false)return null;"}
];
let caught=0;
for(const m of MUT){
 let X,res;
 try{X=boot(m);}catch(e){console.log('  MISSED  (THREW '+String(e.message).slice(0,90)+')  '+m.n);continue;}
 try{res=suite(X);}catch(e){caught++;console.log('  caught  (threw)  '+m.n);continue;}
 const broke=res.filter(t=>!t.ok);
 if(broke.length){caught++;console.log('  caught  ('+broke.length+' assertions)  '+m.n);}
 else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
