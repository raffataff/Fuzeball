// tt harness (the tic-tac). node tools/tt-harness.js
// slices the real catch block (ttRoom / ttSlides / ttPick / ttWant / ttStart / ttGo / ttCatch / ttObs / ttPlan / ttOpts / ttBest / ttStrike / ttStep, pinPlay's hook, hitStep's hand-over, catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: does a rod with a pinned ball and nowhere to carry or tap it start working it between two neighbouring men (and only then), keep it bouncing at the rod's own pace without turning the foot, read the rows each way,
// commit a strike only when a lane is open, decide the slide (straight or a cut) at the last moment the man can get going, fire with the ball where the plan put it, and take the ball as a side catch whenever it ends
// without one; each mutation must break an assertion (what the ball does when the boot meets it is the real sim's: tools/tt-soak.js ttStrikeScene / ttScene)
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
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:')
};
const stubs=[
 "var S={balls:[],time:0}; var rods=[]; var BGS={retEnd:0,retEnter:0}; var OUT=null,RNGV=0.1,RNI=0,RELEASED=0,STRIKE=true,KICKS=[],DIFF='pro',GATEROOM=0;",
 "function pinRelease(r){r.pinB=null;RELEASED++;} function rngAi(){return function(){const v=RNGV;return Array.isArray(v)?v[RNI++%v.length]:v;};}",
 "function kickRod(r,style){r.kickT=0;r.act=null;KICKS.push(style);} function strikeOn(r){GATEROOM=r.target-r.offset;return STRIKE;} function sweepClips(){return false;} function passPick(){return null;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "function isUserRod(){return false;} function retrieveMan(r,bz){return {i:1,o:0};} function retrievePhase(r,ph){r.retPh=ph;}",
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function stAgil(){return 1;} function teamDiff(){return DIFF;}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 g.catch=g.catch.replace('function pinOutlet(r,bx,bz,obs,goalX,sl){','function pinOutlet(r,bx,bz,obs,goalX,sl){if(OUT)return OUT(r,bx,bz,obs,goalX,sl);');   // the lanes can be scripted: this file is about what the rod does with them
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,DIFFS:DIFFS,F:F,BALL_R:BALL_R,FOOT_BOX:FOOT_BOX,rods:rods,CAS:CAS,CAW:CAW,KICKS:KICKS,pinOutlet:pinOutlet,pinPlayStart:pinPlayStart,pinPlay:pinPlay,sideAngle:sideAngle,hitAngle:hitAngle,hitStep:hitStep,'+
  'ttVal:ttVal,ttRoom:ttRoom,ttSlides:ttSlides,ttPick:ttPick,ttWant:ttWant,ttLoose:ttLoose,hitLoose:hitLoose,ttStart:ttStart,ttGo:ttGo,ttCatch:ttCatch,ttObs:ttObs,ttOutlet:ttOutlet,ttPlan:ttPlan,ttOpts:ttOpts,ttBest:ttBest,ttStrike:ttStrike,ttStep:ttStep,ttRoll:ttRoll,catchPick:catchPick,ttEase:ttEase,ttRevert:ttRevert,catchStep:catchStep,catchEnd:catchEnd,'+
  'gateRoom:function(){return GATEROOM;},setOut:function(f){OUT=f;},setRng:function(v){RNGV=v;RNI=0;},setStrike:function(v){STRIKE=v;},setDiff:function(v){DIFF=v;},released:function(){return RELEASED;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D={cd:1},dir=1;
// the red ATT (x 22.5, attacking +x): three men 18.5 apart; the blue DEF (x 37.5, two men) and keeper (x 52.5) in the way
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.setRng(0.1);X.setStrike(true);X.setDiff('pro');X.KICKS.length=0;for(const k in X.CAW)delete X.CAW[k];for(const k in X.CAS)X.CAS[k]=0;
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:opt.role||'ATT',idx:0,aiIQ:true,baseZ:opt.baseZ||[-18.5,0,18.5],maxOff:11.5,removedUntil:[],offset:opt.off||0,target:opt.off||0,slideV:0,vz:0,angle:-0.19,angVel:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,pinFwd:false,act:'catch',catPh:'hold',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,tapN:0,tapPk:null},opt.over||{});
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:[-12,12],offset:opt.defOff||0,target:opt.defTgt!=null?opt.defTgt:(opt.defOff||0),tgV:opt.defV||0,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff||0,target:opt.gkTgt!=null?opt.gkTgt:(opt.gkOff||0),tgV:0,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?X.BALL_R:y,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
function pinned(X,r,mi,rel,dz){const b=view(X,rel==null?-0.7:rel,r.baseZ[mi]+r.offset+(dz||0));b.pinMan=mi;b.pinDz=dz||0;b.pinDx=rel==null?-0.7:rel;r.pinB=b;X.S.balls.push(b);X.pinPlayStart(r);return b;}
// a tic-tac under way between men lo and lo+1 (the foot squared at ttA on the depth the ball was hit at)
function rally(X,opt){
 opt=opt||{};const r=world(X,opt);
 Object.assign(r,{catPh:'tictac',ttOn:true,ttPh:'bounce',ttLo:opt.lo==null?0:opt.lo,ttN:1,ttT:0,ttSg:opt.sg||1,ttEv:1,ttDead:0,ttGo:false,ttA:X.hitAngle(-0.65),ttRel:-0.65,pinPose:true,pinA:X.hitAngle(-0.65)*dir},opt.set||{});
 return r;
}
// the slide law updateRods runs, one step
function slideStep(r,A,ms){const want=Math.max(-ms,Math.min(ms,(r.target-r.offset)/dt)),acc=A*dt;r.slideV=Math.max(r.slideV-acc,Math.min(r.slideV+acc,want));r.offset+=r.slideV*dt;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,T=CA.tictac,ST=T.strike,FB=X.FOOT_BOX,c0=FB.z+X.BALL_R,A=X.AIC.slideAccel;
 CA.recv.ready.on=false;CA.push.play.on=false;X.setOut(null);   // the pull (catch-harness) would take the wide holds these tests work
 const SQ=T.square,TH=T.thru,HT=Math.max(T.minHold,CA.settleT)+0.01;   // the rally's older rules first (a fixed foot, no let-through, no warm-up, no revert, no lunge room, tic-tac last); the newer ones have their own blocks below
 T.first=false;SQ.on=false;TH.on=false;ST.warm=0;ST.back=-1e9;T.lungeRoom=0;
 // ---- the pair ----
 {const r=world(X);
  ok('two ATT men 18.5 apart have room between their faces for the ball (the pair 0-1 and 1-2)',X.ttRoom(r,0)===true&&X.ttRoom(r,1)===true);
  ok('...there is no pair past the last man or before the first',X.ttRoom(r,2)===false&&X.ttRoom(r,-1)===false);
  const mid=world(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8]});
  ok('...the five-man rod\'s men (11.9 apart leaves 5.4 of run) have room by the rod\'s own setting (byRole)',X.ttRoom(mid,1)===true&&X.ttRoom(mid,0)===true&&X.ttRoom(mid,3)===true);
  const mr=T.byRole.MID.room;T.byRole.MID.room=6;ok('...and not by the common 6',X.ttRoom(mid,1)===false);T.byRole.MID.room=mr;
  const q=world(X);q.removedUntil=[0,1e9,0];ok('...a man gone from the pair: none',X.ttRoom(q,0)===false&&X.ttRoom(q,1)===false);
  const keep=T.room;T.room=13;ok('...the room asked for is T.room',X.ttRoom(world(X),0)===false);T.room=keep;
  ok('a setting is the rod\'s own where byRole has one and the common one otherwise',X.ttVal(mid,'pace')===T.byRole.MID.pace&&X.ttVal(world(X),'pace')===T.pace&&X.ttVal(mid,'maxT')===T.maxT);}
 // ---- the slides ----
 {const r=world(X),s=X.ttSlides(r);
  ok('a pro rod can arrive at no slide and at 12 / 22 / 32 either way (its top speed is 39)',s.length===7&&s.indexOf(0)>=0&&[12,22,32,-12,-22,-32].every(w=>s.indexOf(w)>=0),JSON.stringify(s));
  ok('...no slide is listed twice, and zero once',s.filter(w=>w===0).length===1);
  X.setDiff('rookie');const z=X.ttSlides(r);ok('...a rookie rod (30) stops short of 32',z.indexOf(32)<0&&z.indexOf(-32)<0&&z.indexOf(22)>=0,JSON.stringify(z));X.setDiff('pro');}
 // ---- who it is worked with ----
 {const open=(tzMin)=>(r,bx,bz,obs,gx,sl)=>{const tz=bz+Math.abs(gx-bx)*sl;return tz>=tzMin?5:-5;};
  const mk=(rel,opt)=>{const r=world(X,opt);const b=pinned(X,r,1,rel);return {r,b};};
  const pk=m=>X.ttPick(m.r,m.b.m.position,m.b.pinDx,[[m.b.pinMan,-1],[m.b.pinMan,1]],[],60);
  const a=mk(-0.7);X.setOut(open(3));
  const p=pk(a);ok('a ball under the middle man: the neighbour on the side whose lanes are open at the middle of the gap (up in z)',p&&p.s===1&&p.j===2&&p.mi===1,JSON.stringify(p));
  X.setOut((r,bx,bz,obs,gx,sl)=>(bz+Math.abs(gx-bx)*sl)<=-3?5:-5);const q=pk(a);ok('...and the other when that is where they are',q&&q.s===-1&&q.j===0,JSON.stringify(q));
  X.setOut((r,bx,bz,obs,gx,sl)=>Math.abs(bz+Math.abs(gx-bx)*sl-4)<1.5?5:-5);const cu=pk(a);ok('...a lane only a cut reaches counts (the pair whose middle is 9 up can cut down to 4; the other cannot get there)',cu&&cu.s===1&&cu.j===2,JSON.stringify(cu));
  X.setOut(()=>-5);ok('...with every lane shut either side is as good (a pick is still made: the chance and the stuck test decide, not this)',pk(a)!==null);
  X.setOut(open(3));
  ok('...a ball held anywhere from just ahead of the pivot to the back of the side band is worked (where most pins hold it)',pk(mk(-0.3))!==null&&pk(mk(0.1))!==null&&pk(mk(-1.9))!==null);
  ok('...not one outside the depth the foot can be squared on and the strike pose reached from (too far forward / too deep)',pk(mk(T.relMax+0.5))===null&&pk(mk(T.relMin-0.5))===null);
  const e=mk(-0.7);e.b.pinMan=0;e.b.m.position.z=e.r.baseZ[0];ok('...the end man has one neighbour: that one',(()=>{const x=pk(e);return x&&x.s===1&&x.j===1&&x.mi===0;})());
  const g=mk(-0.7);g.r.removedUntil=[0,0,1e9];g.b.pinMan=1;ok('...a neighbour gone: the other',(()=>{const x=pk(g);return x&&x.s===-1;})());
  const n=mk(-0.7,{over:{maxOff:2}});ok('...no room for the hit that starts it (step off and run): none',pk(n)===null);
  // a ball lying between two men: the pair it lies between, the man of it that plays first the one with the better lanes
  {const lb=(z,rel)=>{const r=world(X);return {r,p:{x:22.5+rel,z}};};
   const l=lb(-9.25,-1.2),cs=[[0,1],[1,-1]];
   X.setOut(open(3));const x=X.ttPick(l.r,l.p,-1.2,cs,[],60);ok('a ball lying between men 0 and 1: the pair is those two (the hit comes from the man whose way to the other it is)',x&&x.j!==x.mi&&Math.min(x.mi,x.j)===0&&Math.max(x.mi,x.j)===1&&x.s===x.j-x.mi,JSON.stringify(x));
   ok('...not at a depth the foot cannot work at',X.ttPick(l.r,l.p,T.relMin-1,cs,[],60)===null&&X.ttPick(l.r,l.p,T.relMax+0.5,cs,[],60)===null);
   const y=X.ttPick(l.r,l.p,-1.2,[[1,-1]],[],60);ok('...only the men it is offered from',y&&y.mi===1&&y.j===0&&y.s===-1);
   const lr=lb(-9.25,-1.2);lr.r.removedUntil=[0,1e9,0];ok('...a man of the pair gone: none',X.ttPick(lr.r,lr.p,-1.2,cs,[],60)===null);}
  X.setOut(null);}
 // ---- when a pin is stuck ----
 {const mk=(opt)=>{const r=world(X,opt);const b=pinned(X,r,1,-0.7);return {r,b};};
  X.setOut(()=>-5);
  const a=mk();ok('a rod holding a ball with nowhere to go, past the minimum hold: a tic-tac, and the neighbour is remembered',X.ttWant(a.r,a.b,T.minHold+0.01,[],60)===true&&a.r.ttPk&&a.r.ttPk.j!=null);
  const b=mk();ok('...not before the minimum hold (the carry and the tap have had their look)',X.ttWant(b.r,b.b,T.minHold-0.05,[],60)===false);
  const c=mk({role:'GK'});ok('...not a rod the switch does not name',X.ttWant(c.r,c.b,1,[],60)===false);
  {const rl=T.roles;T.roles=['ATT','MID'];const c2=mk({role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8]});ok('...a MID is one when the switch names it',X.ttWant(c2.r,c2.b,1,[],60)===true);T.roles=rl;}
  const d=mk();d.r.ttCd=X.S.time+1;ok('...not while the last one is cooling',X.ttWant(d.r,d.b,1,[],60)===false);d.r.ttCd=X.S.time-1;ok('...and again once it has',X.ttWant(d.r,d.b,1,[],60)===true);
  const e=mk();e.r.force=true;ok('...not under the dead-ball push',X.ttWant(e.r,e.b,1,[],60)===false);
  const f=mk();X.setRng(0.99);ok('...at the chance the share gives',X.ttWant(f.r,f.b,1,[],60)===false);X.setRng(0.1);ok('...the chance is rolled once per hold (a second look does not re-roll it)',X.ttWant(f.r,f.b,1,[],60)===false);
  X.pinPlayStart(f.r);ok('...a new hold rolls again',X.ttWant(f.r,f.b,1,[],60)===true);
  T.on=false;ok('...and with the switch off none',X.ttWant(mk().r,mk().b,1,[],60)===false);T.on=true;
  X.setOut(null);}
 // ---- pinPlay's hook ----
 {const mk=(opt)=>{const r=world(X,opt);const b=pinned(X,r,1,-0.7);return {r,b};},best=null;
  X.setOut(()=>-5);
  const a=mk();ok('pinPlay: nothing opens a lane by carrying or by a tap, held long enough, the catch asking for taps: 4 (a tic-tac)',X.pinPlay(a.r,a.b,HT,dt,true)===4&&a.r.ttPk!=null);
  const b=mk();ok('...retrieve shares the carry and cannot act on a 4: it is never offered (no `tap` passed)',X.pinPlay(b.r,b.b,HT,dt)===0);
  const c=mk({over:{angle:0.4}});ok('...nor under a forward leg (a re-seat is that one\'s way out)',X.pinPlay(c.r,c.b,HT+CA.recv.settleT,dt,true)!==4);
  X.setOut((r,bx,bz)=>bz>8?5:-5);const d=mk();const rd4=X.pinPlay(d.r,d.b,HT,dt,true);ok('...a carry to a z that opens a lane goes first (it heads there, the target set)',rd4!==4&&d.r.pcTz!=null,'v='+rd4+' pcTz='+d.r.pcTz);
  X.setOut((r,bx,bz)=>bz>16?5:-5);const e=mk();const v5=X.pinPlay(e.r,e.b,HT,dt,true);ok('...and a tap to a neighbour whose lane is open where the ball would arrive goes before a tic-tac',v5===3||v5===0,'v='+v5);
  X.setOut(()=>-5);const f=mk();ok('...not before the minimum hold',X.pinPlay(f.r,f.b,HT-0.3,dt,true)!==4);
  X.setOut((r,bx,bz)=>bz>8?1:-5);const g=mk();const vg=X.pinPlay(g.r,g.b,HT,dt,true);ok('...and so does a carry to a z that is better but opens no lane yet (it is not stuck while it can still get somewhere)',vg!==4&&g.r.pcTz!=null,'v='+vg+' pcTz='+g.r.pcTz);
  X.setOut(()=>-5);{const h=mk();h.r.catPh='hold';h.r.catT=HT;h.r.catUntil=0;X.catchStep(h.r,h.b,D);ok('catchStep: a 4 starts the tic-tac (the hit that is its first touch)',h.r.catPh==='hit'&&h.r.ttOn===true&&X.CAS.tt===1,h.r.catPh);}
  X.setOut(null);}
 // ---- starting, and the first touch ----
 {X.setOut(()=>-5);
  const r=world(X);const b=pinned(X,r,1,-0.7);r.ttPk={s:1,j:2,mi:1,v:0};const t0=X.CAS.tt;X.ttStart(r);
  ok('starting: the first touch is a hit toward the neighbour, resting first with the ball still held',r.catPh==='hit'&&r.hPh==='rest'&&r.tapS===1&&r.tapJ===2&&r.hMan===1&&X.CAS.tt===t0+1&&r.ttPk===null&&X.CAS.ttLoose===0);
  ok('...the pair is the two men, whichever way it goes',r.ttLo===1&&r.ttOn===true&&r.ttN===0);
  const q=world(X);const c=pinned(X,q,1,-0.7);q.ttPk={s:-1,j:0,mi:1,v:0};X.ttStart(q);ok('...from the middle man down the row the pair is 0-1',q.ttLo===0&&q.tapS===-1);
  const lq=world(X);lq.ttPk={s:-1,j:0,mi:1,v:0};X.ttStart(lq,true);ok('...from a ball lying loose: the man that hits it steps off first (no ball is held to let go), counted as a loose start',lq.catPh==='hit'&&lq.hPh==='clear'&&lq.hMan===1&&lq.ttLo===0&&X.CAS.ttLoose===1&&lq.ttOn===true);
  
  ok('...it is a tic-tac, not a tap that is counted (the receiver is not waiting for a side catch)',r.tapHit===false&&!r.tapPend);
  // the hit lands: a tic-tac goes on, not a side catch
  const h=world(X);const hb=pinned(X,h,1,-0.7);h.ttPk={s:1,j:2,mi:1,v:0};X.ttStart(h);h.pinB=null;h.hPh='out';h.hA=X.hitAngle(-0.7);h.hT=CA.hit.outT+0.1;hb.v.z=15;hb.m.position.z=h.baseZ[1]+h.offset+c0+CA.hit.clearOut+1;
  X.hitStep(h,hb);
  ok('the hit lands: the tic-tac goes on (the rod keeps the angle it hit at and the depth, the ball rolling toward the neighbour)',h.catPh==='tictac'&&h.ttPh==='bounce'&&h.ttN===1&&h.ttSg===1&&Math.abs(h.ttA-X.hitAngle(-0.7))<1e-9&&Math.abs(h.ttRel+0.7)<1e-6,h.catPh+' '+h.ttPh);
  ok('...and it is not handed to a side catch or counted as a hit sent',X.CAS.hitSent===0&&!h.tapPend&&X.CAS.ttGo===1);
  const k=world(X);const kb=pinned(X,k,1,-0.7);k.tapS=1;k.tapJ=2;k.tapHit=true;k.hMan=1;k.hPh='out';k.hA=X.hitAngle(-0.7);k.hT=CA.hit.outT+0.1;k.pinB=null;kb.v.z=15;kb.m.position.z=k.baseZ[1]+k.offset+c0+CA.hit.clearOut+1;k.catPh='hit';
  X.hitStep(k,kb);ok('(a hit that is no tic-tac still goes to the side catch)',k.catPh==='side'&&X.CAS.hitSent===1);
  X.setOut(null);}
 // ---- a ball lying loose between two men ----
 {const loose=(rel,z,opt)=>{const r=world(X,opt);const b=view(X,rel,z,0,0);X.S.balls.push(b);return {r,b};};
  const shutAt=z0=>X.setOut((r,bx,bz)=>Math.abs(bz-z0)<1?-5:5);   // shut where it lies, open anywhere else: no shot, a neighbour with a lane
  const L=m=>X.hitLoose(m.r,m.b);
  X.setOut(()=>-5);
  const a=loose(-1.2,-9.25);const t0=X.CAS.ttLoose;
  ok('a ball at rest between men 0 and 1, no shot open and no neighbour with a lane: a tic-tac starts, the man stepping off it first',L(a)===true&&a.r.ttOn===true&&a.r.catPh==='hit'&&a.r.hPh==='clear'&&a.r.ttLo===0&&X.CAS.ttLoose===t0+1&&X.CAS.hitLoose===0&&X.CAS.tt===1,JSON.stringify({ph:a.r.hPh,lo:a.r.ttLo}));
  ok('...the man that plays first is one of the two it lies between, and the other is the neighbour',(a.r.hMan===0&&a.r.tapJ===1&&a.r.tapS===1)||(a.r.hMan===1&&a.r.tapJ===0&&a.r.tapS===-1));
  const b=loose(-1.2,-9.25);T.loose=false;ok('...not with the loose start switched off (no neighbour has a lane: nothing at all)',L(b)===false&&b.r.ttOn!==true);T.loose=true;
  const c=loose(-1.2,-9.25);T.on=false;ok('...nor with the tic-tac off',L(c)===false);T.on=true;
  const d=loose(-1.2,-9.25);d.r.ttCd=X.S.time+1;ok('...nor while the last one is cooling',L(d)===false);
  {const rl=T.roles;T.roles=['ATT'];const e=loose(-1.2,-9.25,{role:'MID'});ok('...nor for a rod the switch does not name (a hit would do it)',L(e)===false&&e.r.ttOn!==true);T.roles=rl;}
  {const rm=T.relMin;T.relMin=-2.5;const f=loose(-3,-9.25);ok('...nor a ball deeper than relMin (the depth it is worked at)',L(f)===false&&f.r.ttOn!==true);T.relMin=rm;}
  const g=loose(-1.2,-9.25);g.r.force=true;ok('...nor under the dead-ball push',L(g)===false);
  const h=loose(-1.2,-9.25);X.setRng([0.99]);ok('...the loose hit\'s own chance is asked first (a tic-tac is no more often than a hit)',L(h)===false&&h.r.ttOn!==true);X.setRng(0.1);
  const i=loose(-1.2,-9.25);i.r.removedUntil=[0,1e9,0];ok('...a man of the pair gone: not from those two',L(i)===false);
  const j=loose(-1.2,-9.25);j.b.m.position.z=-30;ok('...a ball outside the men: nobody to send it to',L(j)===false);
  {const used=new Set();for(let z=-16;z<-2;z+=0.25){const q=loose(-1.2,z);if(L(q))used.add(q.r.hMan);}ok('...across the gap either man plays it first, whichever has the room to step off and run',used.has(0)&&used.has(1),JSON.stringify([...used]));}
  // a plain hit on offer as well: the share chooses
  shutAt(-9.25);
  const k=loose(-1.2,-9.25);X.setRng([0.1,0.1]);const c1=X.CAS.hitLoose;ok('a neighbour with an open lane as well: the tic-tac share takes the tic-tac (its pick of the man that plays)',L(k)===true&&k.r.ttOn===true&&X.CAS.hitLoose===c1&&k.r.hMan===0&&k.r.tapS===1);
  const l=loose(-1.2,-9.25);X.setRng([0.1,0.99]);ok('...and the rest of the time the plain hit to him (its pick of the man)',L(l)===true&&l.r.ttOn!==true&&X.CAS.hitLoose===c1+1&&l.r.tapHit===true&&l.r.hPh==='clear'&&l.r.hMan===1&&l.r.tapS===-1);
  X.setRng(0.1);X.setOut(null);}
 // ---- the way forward for a strike ----
 {const ob=rows=>rows.map(q=>({x:q[0],z:q[1],own:!!q[2]}));
  const m=world(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8]}),obs=ob([[37.5,-12],[37.5,12],[52.5,0],[30,0,true]]);
  ok('a MID: the gap past the nearest opposing row, read from the rows given (here a DEF pair 24 apart: straight through the middle clears each man by 12, less the ball)',Math.abs(X.ttOutlet(m,22.5,0,obs,60,0)-(12-X.AIC.gapAim.blockR))<1e-9);
  ok('...a ball leaving on a slope is judged where it crosses that row (z 12 at x 37.5: on a man)',X.ttOutlet(m,22.5,0,obs,60,12/15)<0&&Math.abs(X.ttOutlet(m,22.5,0,obs,60,12/15)+X.AIC.gapAim.blockR)<1e-9);
  ok('...the row beyond it is not asked (the keeper stands in the line)',X.ttOutlet(m,22.5,0,obs,60,0)>0);
  ok('...a rod of its own team standing ready is no row',X.ttOutlet(m,22.5,0,ob([[37.5,-12],[37.5,12],[30,0,true]]),60,0)>0&&X.ttOutlet(m,22.5,0,ob([[30,0,true]]),60,0)===1e3);
  ok('...with no opposing row ahead nothing is in the way',X.ttOutlet(m,22.5,0,ob([]),60,0)===1e3);
  const att=world(X);X.setOut(()=>77);ok('an ATT: the line to goal and the mouth, whatever pinOutlet says of them',X.ttOutlet(att,22.5,0,obs,60,0)===77);X.setOut(null);
  const d=world(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8],defOff:0,defTgt:8,gkOff:0,gkTgt:0});const rs=X.ttObs(0,22.5,60,0.3);
  ok('...the rows it reads are where they are heading (the DEF target 8 off: its men are not at their 12 any more), and are marked as the opposing ones',rs.filter(o=>o.x===37.5).every(o=>Math.abs(o.z)!==12)&&rs.every(o=>o.own===false)&&Math.abs(X.ttOutlet(d,22.5,0,rs,60,0)-(Math.min.apply(null,rs.filter(o=>o.x===37.5).map(o=>Math.abs(o.z)))-X.AIC.gapAim.blockR))<1e-9);}
 // ---- ending it as a side catch ----
 {const r=rally(X);r.ttPh='strike';const c0s=X.CAS.ttCatch;X.S.time=10;X.ttCatch(r,1,1,'shut');
  ok('ending it hands the ball to the man it is rolling to as a side catch, the way it rolls',r.catPh==='side'&&r.catMan===1&&r.catSg===1&&r.catCush===false&&r.catFwd===false&&r.catT===0&&r.act==='catch');
  ok('...counts it, says why, and starts the cooldown',X.CAS.ttCatch===c0s+1&&X.CAW['tt:shut']===1&&r.ttOn===false&&r.ttPh===null&&Math.abs(r.ttCd-(10+T.cd))<1e-9);
  const q=rally(X);q.tapPend=true;X.ttCatch(q,0,-1,'time');ok('...no tap is waiting to land (the tap back is not for it)',q.tapPend===false&&q.catSg===-1&&q.catMan===0);}
 // ---- catchEnd and the dispatch ----
 {const r=rally(X);X.S.time=5;X.catchEnd(r,0.9,'x');ok('ending a tic-tac any other way starts the cooldown too and clears it',r.ttOn===false&&r.ttPh===null&&Math.abs(r.ttCd-(5+T.cd))<1e-9&&r.act===null);
  const q=world(X);q.ttCd=0;X.catchEnd(q,0,'y');ok('...a rod that was not in one is not given a cooldown',q.ttCd===0);
  const s=rally(X);const b=view(X,-0.65,-9,0,20);s.pinB=null;const t0=s.ttT;X.catchStep(s,b,D);ok('a rod in a tic-tac is run by ttStep, ahead of every other phase',s.ttT>t0&&s.catPh==='tictac');}
 // ---- the plan: where the man is when the ball gets there ----
 {const r=world(X);let worst=0,wv=0,n=0;
  for(const v0 of [0,39,-39])for(const w of [0,12,-12,22,-22,32,-32])for(const [bz,vz] of [[-14,20],[-14,35],[-4,-25],[8,-20],[-12,28]]){
   const rr=world(X);rr.slideV=v0;rr.offset=0;const f=vz>0?1:0,b=view(X,-0.7,bz,0,vz),q=X.ttPlan(rr,f,b.m.position,b.v,w);
   if(!(q.t>0)||q.d<0)continue;
   // run the rod law: brake and wait for d, then slide at w; at the planned contact time he is at speed with the ball ST.gap short of his centre
   const ms=39,r2=world(X),tb=Math.abs(v0)/A;r2.slideV=v0;r2.offset=0;r2.target=0;let t=0;
   while(t<q.t-1e-9){r2.target=t<tb+q.d?r2.offset:r2.offset+w*dt;slideStep(r2,A,ms);t+=dt;}   // brake to rest (tb), wait the rest of d, then slide
   const sg=vz>0?1:-1,gap=(r2.baseZ[f]+r2.offset-(bz+vz*t))*sg;
   worst=Math.max(worst,Math.abs(gap-ST.gap));wv=Math.max(wv,Math.abs(r2.slideV-w));n++;}
  ok('the plan: braked, waited and then slid at w, the man is at speed w when the ball gets to him, with the ball ST.gap short of his centre ('+n+' cases)',n>40&&worst<0.6&&wv<1.5,'gap off by '+worst.toFixed(2)+', speed off by '+wv.toFixed(2));
  const a=world(X),b=view(X,-0.7,-14,0,25),q0=X.ttPlan(a,1,b.m.position,b.v,0),t0=q0.t;
  ok('...a man already running is planned from where he will have braked to',(()=>{const m=world(X);m.slideV=30;const q=X.ttPlan(m,1,b.m.position,b.v,0);return Math.abs(q.zc-(30*30/(2*A)))<1e-9;})());
  ok('...a slide against the ball is a longer ramp and a shorter wait (d falls); with it the man is further on when the ball gets there and has longer',X.ttPlan(a,1,b.m.position,b.v,-32).d<X.ttPlan(a,1,b.m.position,b.v,0).d&&X.ttPlan(a,1,b.m.position,b.v,32).t>X.ttPlan(a,1,b.m.position,b.v,0).t);
  ok('...the ball ST.gap short of his centre on the side it comes from (a ball rolling up in z: below)',Math.abs(X.ttPlan(a,1,b.m.position,b.v,0).cz-(a.baseZ[1]+a.offset-ST.gap))<1e-9&&Math.abs(X.ttPlan(a,0,view(X,-0.7,5,0,-25).m.position,view(X,-0.7,5,0,-25).v,0).cz-(a.baseZ[0]+a.offset+ST.gap))<1e-9);}
 // ---- the rows a strike will meet ----
 {const r=world(X,{defOff:0,defTgt:10,gkOff:0,gkTgt:0});
  const near=X.ttObs(0,22.5,60,0),far=X.ttObs(0,22.5,60,1);
  const dm=X.DIFFS.pro.speed;
  ok('the opposing rows are read where they are heading: a DEF with its target 10 off has got there by the time a ball struck in a second arrives, and part of the way (as far as it can slide) before',
   far.filter(o=>o.x===37.5).every(o=>Math.abs((o.z-(o.x===37.5?(o.z>0?12:-12):0))-10)<1e-9)&&near.filter(o=>o.x===37.5).every(o=>{const mv=dm*((37.5-22.5)/CA.shotV);return Math.abs((o.z-(o.z>0?12:-12))-Math.min(10,mv))<1e-6;}));
  const w=world(X,{defOff:0,defTgt:0,defV:0});X.rods[1].tgV=20;const a=X.ttObs(0,22.5,60,0.2);
  ok('...its target carried on at the pace it is moving, over the time to the strike',a.filter(o=>o.x===37.5).every(o=>{const tt=0.2+15/CA.shotV;return Math.abs((o.z-(o.z>0?12:-12))-Math.min(dm*tt,20*ST.tgtLead*tt))<1e-6;}));
  ST.tgtLead=0;const b=X.ttObs(0,22.5,60,0.2);ok('...unless T.tgtLead is 0',b.filter(o=>o.x===37.5).every(o=>Math.abs(o.z-(o.z>0?12:-12))<1e-9));ST.tgtLead=1;
  ok('...its men all counted (two for the DEF, one for the keeper), and only the rows between the ball and the goal',X.ttObs(0,22.5,60,0).length===3&&X.ttObs(0,45,60,0).length===1&&X.ttObs(0,55,60,0).length===0);
  const z=world(X);z.removedUntil=[1e9,0,0];X.rods[1].removedUntil=[1e9,0];ok('...a man gone is not an obstacle',X.ttObs(0,22.5,60,0).length===2);
  const m=world(X);X.rods.push({x:30,team:0,kickDir:1,role:'MID',baseZ:[0],offset:0,target:0,removedUntil:[],vz:0,act:null});ok('...a rod of its own team ahead is not, unless it stands ready (its men are down in the lane)',X.ttObs(0,22.5,60,0).length===3);
  X.rods[3].act='recv';ok('...standing ready it is, and marked as the own one (a lane past a row of the other team ignores it)',X.ttObs(0,22.5,60,0).length===4&&X.ttObs(0,22.5,60,0).filter(o=>o.own).length===1&&X.ttObs(0,22.5,60,0).filter(o=>!o.own).length===3);
  world(X);
  ok('...and the other way round: the blue rods read the red ones (here the three men of the red ATT)',X.ttObs(1,52.5,0,0).length===3&&X.ttObs(1,52.5,0,0).every(o=>o.x===22.5));}
 // ---- the strikes on offer ----
 {const lanes=(r,bx,bz,obs,gx,sl)=>{const tz=bz+Math.abs(gx-bx)*sl;return 6-Math.abs(tz-TZ);};let TZ=0;
  X.setOut(lanes);
  // the ball rolling up in z toward man 1, a tic-tac between men 0 and 1; find the z where the leg has just time to get back
  const mk=(bz,vz,opt)=>{const r=rally(X,Object.assign({lo:0,sg:vz>0?1:-1},opt||{}));return {r,b:view(X,-0.65,bz,0,vz)};};
  let hit=null;for(let z=-18;z<-1&&!hit;z+=0.05){const m=mk(z,25);const o=X.ttOpts(m.r,m.b,false);if(o.length)hit={z,o};}
  ok('a strike is offered once the ball is the leg\'s time (T.tilt) from the man\'s face and not before',!!hit);
  if(hit){
   const m=mk(hit.z-6,25);ok('...earlier (the ball still far off) none: the rows are read as late as they can be',X.ttOpts(m.r,m.b,false).length===0);
   ok('...and with the ball on top of the man none (the leg cannot get back)',X.ttOpts(mk(-3.5,25).r,mk(-3.5,25).b,false).length===0);
   const o=hit.o;ok('...no slide twice, each with its lane, contact z, time and when to start',o.every((q,i)=>o.findIndex(p=>p.w===q.w)===i&&q.t>0&&q.d>=0&&Math.abs(q.tz-(q.cz+Math.abs(60-(22.5-0.65))*ST.k*q.w))<1e-9));
   ok('...a slide with the ball is no more than T.pushMax of its speed (it has to overtake the man): at 25 u/s that rules out 22 and 32 with it, not 12',(()=>{let n12=0,nbig=0;for(let z=-18;z<-1;z+=0.05){const m=mk(z,25);for(const q of X.ttOpts(m.r,m.b,false)){if(q.w===12)n12++;if(q.w===22||q.w===32)nbig++;}}return n12>0&&nbig===0;})());
   ok('...the same once the leg is back (live): no slide with a 25 u/s ball above 20, and with a 14 u/s ball none of 12 either, though one against it is on offer',(()=>{let big=0,n=0,pulls=0;for(let z=-18;z<-1;z+=0.05){const m=mk(z,25),m2=mk(z,14);for(const q of X.ttOpts(m.r,m.b,true))if(q.w===22||q.w===32)big++;for(const q of X.ttOpts(m2.r,m2.b,true)){if(q.w===12)n++;if(q.w===-12)pulls++;}}return big===0&&n===0&&pulls>0;})());
   let pulls=0,pushes=0;for(let z=-18;z<-1;z+=0.1){const m=mk(z,25);for(const q of X.ttOpts(m.r,m.b,false)){if(q.w<0)pulls++;if(q.w>0)pushes++;}}ok('...slides against the ball are offered, and with it too (the small ones)',pulls>0&&pushes>0,'pull '+pulls+' push '+pushes);
   const live=X.ttOpts(mk(-3.5,25).r,mk(-3.5,25).b,true);ok('live (the leg already back): offered at any time the man can still get going, the window ignored',live.length>0&&live.every(q=>q.d>=0));
   const best=X.ttBest(o);ok('ttBest takes the best lane',best&&o.every(q=>q.clr<=best.clr+1e-9));
   TZ=best.tz;ok('...the lane is scripted to the open point: it is the one aimed there',X.ttBest(X.ttOpts(mk(hit.z,25).r,mk(hit.z,25).b,false)).tz===best.tz);
   const none=X.ttBest([]);ok('(no options: none)',none===null);
   const pz=mk(0,25);pz.b.m.position.z=pz.r.baseZ[1]+2;ok('...a ball that is already past where the man would meet it: none (live or not)',X.ttOpts(pz.r,pz.b,true).length===0&&X.ttOpts(pz.r,pz.b,false).length===0);
   {let seen={};for(let z=-18;z<-1;z+=0.1){const m=mk(z,25,{off:10.5});for(const q of X.ttOpts(m.r,m.b,true))seen[q.w]=1;}
    ok('...a rod near the end of its slide has no room for a slide that way: nothing past its end, nor one it could not carry on through the swing (12 up from 10.5 lands inside but runs out)',seen[0]&&seen[-12]&&seen[-22]&&!seen[12]&&!seen[22]&&!seen[32],JSON.stringify(Object.keys(seen)));}
   {const m=mk(hit.z,25);let v=-1;X.setOut((r,bx,bz,obs)=>obs[1].z);const a1=X.ttOpts(m.r,m.b,false);X.rods[1].target=8;X.rods[1].offset=0;const a2=X.ttOpts(m.r,m.b,false);
    ok('...the rows are read as they will be when the ball is struck (the time of that option)',a2.length>0&&a2.every(q=>Math.abs(q.clr-X.ttObs(0,22.5-0.65,60,q.t)[1].z)<1e-9),a2.map(q=>q.clr.toFixed(2)).join(','));X.rods[1].target=0;X.setOut(lanes);}
  }
  X.setOut(null);}
 // ---- a MID's strikes ----
 {X.setOut(()=>{throw new Error('pinOutlet asked for a MID');});
  const mm=bz=>({r:rally(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8],lo:1,sg:1,off:0,over:{maxOff:6.2}}),b:view(X,-0.65,bz,0,14)});
  let got=null;for(let z=-11.9;z<-3&&!got;z+=0.05){const m=mm(z),o=X.ttOpts(m.r,m.b,true);if(o.length)got={m,o};}
  ok('a MID is offered strikes too',!!got&&got.o.length>0);
  if(got)ok('...each lane read as the gap past the row in front (never as the line to goal)',got.o.every(q=>{const rx=37.5-(22.5-0.65),lz=q.cz+ST.k*q.w*rx,dm=Math.min(Math.abs(lz+12),Math.abs(lz-12))-X.AIC.gapAim.blockR;return Math.abs(q.clr-dm)<1e-6;}));
  X.setOut(null);}
 // ---- the bounce ----
 {const sim=(r,b,n)=>{for(let i=0;i<n;i++)X.ttStep(r,b,D);};
  const T0=T.strike.on;
  // ends
  const ends=(why,mut)=>{const r=rally(X);const b=view(X,-0.65,-9,0,20);mut&&mut(r,b);X.ttStep(r,b,D);return r.act===null&&X.CAW['tt:'+why]>=1&&r.ttOn===false;};
  ok('a tic-tac ends when the ball scores',ends('scored',(r,b)=>{b.scored=true;}));
  ok('...is lifted',ends('lifted',(r,b)=>{b.m.position.y=X.AIC.lowY+1;}));
  ok('...the dead-ball push',ends('force',(r)=>{r.force=true;}));
  ok('...a man of the pair is gone',ends('man',(r)=>{r.removedUntil=[0,1e9,0];}));
  ok('...the ball leaves the depth the foot works at',ends('off',(r,b)=>{b.m.position.x=22.5+T.relMax+3;})&&ends('off',(r,b)=>{b.v.x=T.maxVX+2;}));
  ok('...rolls out past a man',ends('through',(r,b)=>{b.m.position.z=r.baseZ[1]+r.offset+ST.past+1;})&&ends('through',(r,b)=>{b.m.position.z=r.baseZ[0]+r.offset-ST.past-1;}));
  {const r=rally(X);const b=view(X,-0.65,-9,0,1);for(let i=0;i<Math.round((T.deadT+0.2)*120)&&r.act;i++)X.ttStep(r,b,D);ok('...the ball has died between the men: ended, and left to the ordinary play (no cooldown on the catch)',r.act===null&&X.CAW['tt:dead']===1);}
  {const r=rally(X);const b=view(X,-0.65,-9,0,1);for(let i=0;i<Math.round(0.3*120);i++)X.ttStep(r,b,D);ok('...(a ball slow for a moment has not died)',r.act==='catch'&&r.ttOn===true);b.v.z=20;X.ttStep(r,b,D);b.v.z=1;for(let i=0;i<Math.round(0.3*120);i++)X.ttStep(r,b,D);ok('...and the clock starts again once it is moving',r.act==='catch'&&r.ttOn===true);}
  ok('...the ball is further back than the foot works at',ends('off',(r,b)=>{b.m.position.x=22.5+T.relMin-3;}));
  {const r=rally(X);const b=view(X,-0.65,-9,0,20);b.m.position.x=22.5+r.ttRel+0.1;X.ttStep(r,b,D);r.pinOn=true;X.ttStep(r,b,D);ok('...the pin is never on (the ball bounces off the foot: it is not held)',r.pinOn===false);}
  {const r=rally(X);const b=view(X,-0.65,-9,0,20);r.ttT=T.maxT+0.1;X.ttStep(r,b,D);ok('...long enough: the ball is taken as a side catch, by the man it is rolling to',r.catPh==='side'&&r.catMan===1&&r.catSg===1&&X.CAW['tt:time']===1);}
  {const r=rally(X);const b=view(X,-0.65,-9,0,-20);r.ttSg=-1;r.ttT=T.maxT+0.1;X.ttStep(r,b,D);ok('...rolling the other way: the other man',r.catPh==='side'&&r.catMan===0&&r.catSg===-1);}
  {const r=rally(X);const b=view(X,-0.65,-9,0,20);b.m.position.x=22.5+r.ttRel+T.drift+0.05;X.ttStep(r,b,D);ok('...the ball has crept off the depth the foot is squared on: taken as a side catch',r.catPh==='side'&&X.CAW['tt:drift']===1);}
  {const r=rally(X);const b=view(X,-0.65,-9,0,20);b.m.position.x=22.5+r.ttRel+T.drift-0.2;X.ttStep(r,b,D);ok('...a little creep is no reason to',r.catPh==='tictac');}
  // touches
  {const r=rally(X,{sg:1});const b=view(X,-0.65,-9,0,-20);const n0=X.CAS.ttTouch;X.ttStep(r,b,D);ok('a touch is the ball changing direction: counted, the new way remembered',r.ttN===2&&r.ttSg===-1&&X.CAS.ttTouch===n0+1);
   X.ttStep(r,b,D);ok('...once only',r.ttN===2);}
  {const r=rally(X,{sg:1,set:{ttN:T.maxTouch}});const b=view(X,-0.65,-9,0,-20);X.ttStep(r,b,D);ok('...past the last one it is taken as a side catch',r.catPh==='side'&&X.CAW['tt:touches']===1&&r.catMan===0);}
  {const r=rally(X,{sg:1});const b=view(X,-0.65,-9,0,-0.5);X.ttStep(r,b,D);ok('...a ball too slow to say which way is not a touch',r.ttN===1&&r.ttSg===1);}
  {const r=rally(X,{sg:1,set:{ttEv:1}});const b=view(X,-0.65,-9,0,-20);const l0=X.CAS.ttLook;X.ttStep(r,b,D);ok('...the rows are looked at the moment of a touch (a fresh traverse), not a look later',X.CAS.ttLook===l0+1);}
  {const r=rally(X,{sg:1,set:{ttEv:0}});const b=view(X,-0.65,-9,0,0.4);const l0=X.CAS.ttLook;X.ttStep(r,b,D);ok('...and never at a ball at rest',X.CAS.ttLook===l0);}
  // the pose: it stays where it is
  {const r=rally(X);const b=view(X,-0.65,-9,0,20);X.ttStep(r,b,D);const a0=r.pinA;b.m.position.x+=0.4;X.ttStep(r,b,D);ok('the foot stays squared on the depth it was hit at: it does not turn to follow the ball',r.pinPose===true&&r.pinOn===false&&r.pinA===a0&&Math.abs(r.pinA-r.ttA*dir)<1e-12);}
  // the lunge
  {const vm=X.DIFFS.pro.speed*T.pace,rampOf=(r)=>Math.max(0,vm-r.slideV*(-1))/A;
   const mk=(bz,vz)=>{const r=rally(X,{sg:vz>0?1:-1,off:0});r.slideV=0;return {r,b:view(X,-0.65,bz,0,vz)};};
   T.strike.on=false;
   // a ball rolling up to man 1: its face is at z - c0 - margin from his centre; the man lunges toward where it came from (-z)
   const lungeAt=(sv)=>{let lo=0,hi=30;for(let i=0;i<40;i++){const mid=(lo+hi)/2,m=mk(0-c0-T.margin-mid,25);m.r.slideV=sv;X.ttStep(m.r,m.b,D);if(m.r.target<m.r.offset-1e-9)lo=mid;else hi=mid;}return lo;};
   const far=mk(-14,25);X.ttStep(far.r,far.b,D);ok('the man the ball is rolling to waits while it is far off (the target is where he stands, drifting toward the home of the pair)',Math.abs(far.r.target-far.r.offset)<=T.homeV*dt+1e-9,'target-offset='+(far.r.target-far.r.offset));
   // time of arrival at the face = dist/sp; lunge when that is within ramp + T.lunge
   const dist=(25*(rampOf(far.r)+T.lunge))*1;let lo=0,hi=20;for(let i=0;i<40;i++){const mid=(lo+hi)/2,m=mk(0-c0-T.margin-mid,25);X.ttStep(m.r,m.b,D);if(m.r.target<m.r.offset-1e-9)lo=mid;else hi=mid;}
   const bz0=0-c0-T.margin-lo;const exp=25*(rampOf(far.r)+T.lunge);
   ok('...and starts to slide into it once it is within the ramp and T.lunge of the face (ramp from rest: '+(vm/A).toFixed(3)+' s)',Math.abs(lo-exp)<0.4,'lunges at '+lo.toFixed(2)+' from the face, expected '+exp.toFixed(2));
   const m=mk(0-c0-T.margin-lo*0.5,25);X.ttStep(m.r,m.b,D);ok('...toward where the ball came from, at the pace T.pace of the rod\'s speed',Math.abs(m.r.target-(m.r.offset-vm*dt))<1e-9,'target='+m.r.target);
   const m2=mk(-18.5+c0+T.margin+lo*0.5,-25);X.ttStep(m2.r,m2.b,D);ok('...the other way for a ball rolling the other way (down in z, to man 0)',Math.abs(m2.r.target-(m2.r.offset+vm*dt))<1e-9,'target='+m2.r.target);
   const lg=lungeAt(-vm),exp2=(25+vm)*T.lunge;ok('a man already moving toward it needs no ramp and closes on it faster: the lunge is later (in time to contact: it covers more ground in it)',Math.abs(lg-exp2)<0.4&&lg/(25+vm)<lo/25,'lunges at '+lg.toFixed(2)+', expected '+exp2.toFixed(2)+' lo='+lo.toFixed(2)+' vm='+vm.toFixed(1));
   const lg2=lungeAt(vm),exp3=25*((vm+vm)/A+T.lunge);ok('...one moving away has to turn first: earlier',Math.abs(lg2-exp3)<0.5&&lg2>lo,'lunges at '+lg2.toFixed(2)+', expected '+exp3.toFixed(2));
   const slow=mk(-9,0.4);X.ttStep(slow.r,slow.b,D);ok('a ball at rest between the men: the rod stands',slow.r.target===slow.r.offset);
   const q=mk(-14,25);q.r.offset=2;q.r.target=2;X.ttStep(q.r,q.b,D);ok('waiting, the rod drifts toward where the pair is centred on the goal (pair 0-1: 9 up, so both men are within reach of the mouth), at T.homeV',q.r.target>q.r.offset&&Math.abs(q.r.target-q.r.offset-T.homeV*dt)<1e-9,'target-offset='+(q.r.target-q.r.offset));
   const q3=mk(2,25);q3.r.offset=11;q3.r.target=11;X.ttStep(q3.r,q3.b,D);ok('...down again when it is past that',q3.r.target<q3.r.offset);
   const hv=T.homeV;T.homeV=0;const q2=mk(-14,25);q2.r.offset=2;q2.r.target=2;X.ttStep(q2.r,q2.b,D);ok('...not with T.homeV 0',q2.r.target===q2.r.offset);T.homeV=hv;
   {const mm=rally(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8],lo:1,sg:1,off:0});mm.slideV=0;X.ttStep(mm,view(X,-0.65,-c0-T.margin-0.1,0,25),D);
    const vmM=X.DIFFS.pro.speed*T.byRole.MID.pace;ok('a MID is worked at its own pace (byRole: its men are close, and the leg needs the time to tilt back)',Math.abs(mm.target-(mm.offset-vmM*dt))<1e-9&&vmM<=vm,'target='+mm.target);}
   T.strike.on=T0;}
 }
 // committing
  {const lanes=(r,bx,bz,obs,gx,sl)=>{const tz=bz+Math.abs(gx-bx)*sl;return 6-Math.abs(tz-TZ);};let TZ=0;X.setOut(lanes);
   const mk=(bz,vz)=>{const r=rally(X,{sg:vz>0?1:-1,off:0,set:{ttEv:0}});return {r,b:view(X,-0.65,bz,0,vz)};};
   let z0=null;for(let z=-18;z<-1&&z0==null;z+=0.05){const m=mk(z,25);if(X.ttOpts(m.r,m.b,false).length)z0=z;}
   if(z0!=null){
    const m0=mk(z0,25),opts=X.ttOpts(m0.r,m0.b,false),best=X.ttBest(opts);TZ=best.tz;
    const m=mk(z0,25),c1=X.CAS.ttCommit;X.ttStep(m.r,m.b,D);
    ok('a strike is committed when a lane is open on its next arrival: the leg goes back (strike phase), the man, slide and lane are noted, counted as straight or a cut',m.r.ttPh==='strike'&&m.r.ttMan===1&&m.r.ttW===best.w&&Math.abs(m.r.ttTz-best.tz)<1e-9&&X.CAS.ttCommit===c1+1&&(best.w?X.CAS.ttCut===1:X.CAS.ttStraight===1),m.r.ttPh+' w='+m.r.ttW);
    {let zb=null;for(let z=-18;z<-1&&zb==null;z+=0.05){const mm=mk(z,25),oo=X.ttOpts(mm.r,mm.b,false);if(oo.some(o=>o.w===0)&&oo.some(o=>o.w!==0))zb=z;}
     if(zb!=null){const z0=zb;X.setOut((r,bx,bz,obs,gx,sl)=>Math.abs(sl)<1e-9?2.0:2.0+ST.stick*0.6);const k=mk(zb,25);X.ttStep(k.r,k.b,D);ok('...the slide it chose is the one it keeps (a cut better than the straight shot by less than T.stick is still the one committed)',k.r.ttPh==='strike'&&k.r.ttW!==0,'w='+k.r.ttW);X.setOut(lanes);}else ok('(a straight and a cut on offer together at the window)',false);}
    X.setOut(()=>-5);const n=mk(z0,25);X.ttStep(n.r,n.b,D);ok('...not when every lane is shut (the rally goes on)',n.r.ttPh==='bounce');
    X.setOut(lanes);const p=T.strike.prep;ST.prep=7;const q=mk(z0,25);X.ttStep(q.r,q.b,D);ok('...not under T.prep',q.r.ttPh==='bounce');ST.prep=p;
    ST.on=false;const s=mk(z0,25);X.ttStep(s.r,s.b,D);ok('...not with the strikes off',s.r.ttPh==='bounce');ST.on=true;
    const w=mk(z0,25);w.r.ttEv=1;X.ttStep(w.r,w.b,D);ok('...looking at the rows only every T.look',w.r.ttPh==='bounce'&&w.r.ttEv<1);
    const l=mk(z0,25);l.r.ttEv=0;const lk=X.CAS.ttLook;X.ttStep(l.r,l.b,D);ok('...a look is counted',X.CAS.ttLook===lk+1);
   }else ok('there is a z the strike window opens at',false);
   X.setOut(null);}
 // ---- the strike ----
 {const lanesAt=(TZ)=>(r,bx,bz,obs,gx,sl)=>{const tz=bz+Math.abs(gx-bx)*sl;return 6-Math.abs(tz-TZ);};
  // a strike phase with man 1 the one it is rolling to, the ball placed so that a man at rest (w 0) has `d` s to spare before he must start
  const mk=(d,opt)=>{opt=opt||{};const r=world(X,{off:opt.off||0}),rel=opt.rel==null?-0.65:opt.rel;const sa=X.sideAngle(rel,false)*dir;
   Object.assign(r,{catPh:'tictac',ttOn:true,ttPh:'strike',ttLo:0,ttN:2,ttT:1,ttSg:1,ttEv:1,ttDead:0,ttGo:false,ttA:X.hitAngle(rel),ttRel:rel,ttMan:1,ttW:opt.w||0,ttSt:0,ttTz:3,ttClr:5,ttFound:0,ttGoT:0,pinPose:opt.back===false?false:true,pinA:opt.back===false?null:sa,angle:sa},opt.set||{});
   const vz=opt.vz||25,zm=r.baseZ[1]+r.offset,cz=zm-ST.gap,t=d+ST.settle+Math.abs(r.slideV)/A,bz=cz-vz*t;
   return {r,b:view(X,rel,bz,0,vz),sa,vz,zm};};
  const openAt=(m)=>X.setOut((r,bx,bz,obs,gx,sl)=>6-Math.abs(bz+Math.abs(gx-bx)*sl-(m.r.baseZ[1]-ST.gap)));
  X.setOut(()=>-9);
  // before the man has to start: he waits, the leg goes back
  {const m=mk(0.1,{back:false,rel:-1.2});openAt(m);X.ttStep(m.r,m.b,D);
   ok('a committed strike, the man with time to spare: he waits where he is (the rod brakes), the leg is sent back to the side-catch pose for the ball\'s depth',m.r.ttPh==='strike'&&m.r.ttGo===false&&m.r.target===m.r.offset&&Math.abs(m.r.pinA-m.sa)<1e-12&&m.r.pinPose===true&&X.KICKS.length===0&&Math.abs(m.sa-X.sideAngle(-0.65,false)*dir)>0.02,m.r.ttPh+' go='+m.r.ttGo);
   ok('...his lane and aim are kept up to date for the swing',m.r.ttClr>=ST.go&&Math.abs(m.r.ttTz-(m.r.baseZ[1]-ST.gap))<1e-6,'clr='+m.r.ttClr+' tz='+m.r.ttTz);}
  // which way: the best lane, changed only for clearly better
  {const m=mk(0.1,{w:0});const w0=X.ttOpts(m.r,m.b,true),cand=w0.filter(o=>o.w!==0)[0];
   X.setOut(lanesAt(cand.tz));X.ttStep(m.r,m.b,D);
   ok('the slide is decided at the last moment from the rows then: a better lane than the one it was committed to takes it (by more than T.stick)',m.r.ttW===cand.w,'w='+m.r.ttW+' wanted '+cand.w);
   const q=mk(0.1,{w:0});X.setOut((r,bx,bz,obs,gx,sl)=>Math.abs(sl)<1e-9?2.0:2.0+ST.stick*0.5);
   X.ttStep(q.r,q.b,D);ok('...a lane only a little better does not (it would change its mind every frame)',q.r.ttW===0);
   const z=mk(0.1,{w:32});X.setOut(()=>3);const zo=X.ttOpts(z.r,z.b,true);X.ttStep(z.r,z.b,D);ok('...the best of what is on offer takes the place of a slide that is no longer there',zo.length>0&&(zo.some(o=>o.w===z.r.ttW)));}
  // the last moment to get going
  {const m=mk(dt*0.5);X.S.time=5;openAt(m);X.ttStep(m.r,m.b,D);
   ok('the last moment the man can get going, the lane open: he goes (the slide at its speed, a step ahead), the moment noted',m.r.ttGo===true&&Math.abs(m.r.ttGoT-X.S.time)<1e-9,'go='+m.r.ttGo);
   const n=mk(dt*0.5,{w:0});X.setOut(()=>-5);X.ttStep(n.r,n.b,D);ok('...the lane shut then: the strike is given up and the ball taken as a side catch by the man it is rolling to',n.r.ttGo===false&&n.r.catPh==='side'&&n.r.catMan===1&&X.CAW['tt:shut']===1);
   const o=mk(dt*0.5);openAt(o);const g0=ST.go;ST.go=99;X.ttStep(o.r,o.b,D);ok('...he needs T.go of it, not T.prep',o.r.catPh==='side'&&o.r.ttGo===false);ST.go=g0;
   const p=mk(0.3);openAt(p);X.ttStep(p.r,p.b,D);ok('...not yet while there is time: he waits',p.r.ttGo===false&&p.r.catPh==='tictac');
   const p2=mk(0.05);openAt(p2);X.ttStep(p2.r,p2.b,D);ok('...nor a twentieth of a second early (he goes at the last moment, not before)',p2.r.ttGo===false&&p2.r.catPh==='tictac');
   const p3=mk(0.1,{w:-12});X.setOut(()=>5);X.ttStep(p3.r,p3.b,D);ok('...a cut that has not got to go yet waits too: the rod brakes, it is not already sliding',p3.r.ttW===-12&&p3.r.ttGo===false&&p3.r.target===p3.r.offset);}
  // on his way
  {const mk2=(opt)=>{const m=mk(0.1,opt);m.r.ttGo=true;m.r.slideV=m.r.ttW;m.r.target=m.r.offset+m.r.ttW*dt;return m;};
   const m=mk2({w:-12});X.setOut(()=>5);X.ttStep(m.r,m.b,D);ok('under way: the rod slides at w, a step ahead each frame',m.r.ttGo===true&&Math.abs(m.r.target-(m.r.offset+m.r.ttW*dt))<1e-9&&X.KICKS.length===0);
   const n=mk2({w:-12});n.r.ttEv=0;X.setOut(()=>-5);X.ttStep(n.r,n.b,D);ok('...the lane shutting altogether (under T.drop) gives it up: a side catch',n.r.catPh==='side'&&X.CAW['tt:shut']===1);
   const o=mk2({w:-12});o.r.ttEv=0;X.setOut(()=>ST.drop+0.3);X.ttStep(o.r,o.b,D);ok('...a lane that is poorer but not shut keeps it',o.r.catPh==='tictac'&&o.r.ttGo===true);
   const q=mk2({w:-12});q.r.ttEv=1;X.setOut(()=>-5);X.ttStep(q.r,q.b,D);ok('...looked at only every T.look',q.r.catPh==='tictac');}
  // the swing
  {const go=(opt)=>{const m=mk(0.1,opt);m.r.ttGo=true;m.r.slideV=m.r.ttW;m.r.target=m.r.offset+m.r.ttW*dt;
    // the ball a little short of where the plan puts it at contact: the swing fires when the gap less what the ball closes in the swing's lag is the gap the plan wants
    m.b.m.position.z=(m.r.baseZ[1]+m.r.offset)-ST.gap-(Math.abs(m.vz)-m.r.slideV)*ST.lag+0.02;m.r.ttEv=1;return m;};
   X.setOut(()=>5);
   const m=go({w:0});X.ttStep(m.r,m.b,D);
   ok('the ball where the plan puts it, the leg back, the man at speed: the swing is fired (the trap-shot swing), the strike gate asked',X.KICKS.length===1&&X.KICKS[0]==='trapShot'&&m.r.act===null&&m.r.ttOn===false,JSON.stringify(X.KICKS));
   ok('...the rod holds its slide through the swing (r.catSv) for T.hold, and the aim assist is told the lane the shot was judged on',m.r.catSv===0&&m.r.catHold===ST.hold&&m.r.catSw===true&&m.r.aimEv&&m.r.aimEv===m.r.catAim&&m.r.catAim.best.tz===m.r.ttTz);
   ok('...a straight one is counted and ended as one, the shot tallied',X.CAW['tt:straight']===1&&X.CAS.ttShot===1);
   const c=go({w:-12});X.KICKS.length=0;X.ttStep(c.r,c.b,D);ok('...a cut is held at its slide, and the strike gate was shown it carrying on (room to go on sliding at w for T.lead of slide)',X.KICKS.length===1&&c.r.catSv===-12&&X.CAW['tt:cut']===1&&Math.abs(X.gateRoom()-(-12*CA.push.lead))<1e-9,'room '+X.gateRoom());
   const d=go({w:0});d.b.m.position.z-=3;X.KICKS.length=0;X.ttStep(d.r,d.b,D);ok('...the ball still short of where the plan puts it: not yet',X.KICKS.length===0&&d.r.catPh==='tictac');
   const e=go({w:0});e.r.angle=e.sa+0.5;X.KICKS.length=0;X.ttStep(e.r,e.b,D);ok('...the leg not back by then: no swing (it would meet the ball with the box), a side catch',X.KICKS.length===0&&e.r.catPh==='side'&&X.CAW['tt:pose']===1);
   const f=go({w:0});X.setStrike(false);X.KICKS.length=0;const gt=X.CAS.ttGate;X.ttStep(f.r,f.b,D);ok('...the strike gate says the boot would miss: no swing, counted, the rod keeps its slide and waits',X.KICKS.length===0&&X.CAS.ttGate===gt+1&&f.r.catPh==='tictac'&&Math.abs(f.r.target-(f.r.offset+f.r.ttW*dt))<1e-9);X.setStrike(true);
   const h=go({w:0});h.r.ttSt=ST.abortT+0.1;X.KICKS.length=0;X.ttStep(h.r,h.b,D);ok('...a strike that takes too long is given up: a side catch',h.r.catPh==='side'&&X.CAW['tt:slow']===1);
   const i=go({w:0});i.b.m.position.z=i.r.baseZ[1]+i.r.offset+ST.past+0.5;i.b.m.position.z=Math.min(i.b.m.position.z,i.r.baseZ[1]+i.r.offset+ST.past+0.5);X.KICKS.length=0;X.ttStep(i.r,i.b,D);ok('...a ball that has rolled on past the man: given up',i.r.catPh!=='tictac'&&X.KICKS.length===0&&(X.CAW['tt:past']>=1||X.CAW['tt:through']>=1));
   const j=mk(0.1);j.b.v.z=-25;X.ttStep(j.r,j.b,D);ok('...a ball that has turned round (it met something): given up, taken by the man it is rolling to now',j.r.catPh==='side'&&j.r.catMan===0&&X.CAW['tt:flip']===1);
   const k=mk(0.1);k.b.m.position.z=k.r.baseZ[1]+k.r.offset-ST.gap+0.6;k.b.v.z=25;X.setOut(()=>5);X.ttStep(k.r,k.b,D);ok('...a ball that is nearer than any slide can be got going for: nothing on offer, a side catch',k.r.catPh==='side'&&X.CAW['tt:plan']===1,k.r.catPh+' '+JSON.stringify(X.CAW));}
  X.setOut(null);}
 // ---- the rally's newer rules (the older tests above run with these off) ----
 {const tmk=(opt)=>{const r=world(X,opt);const b=pinned(X,r,1,-0.7);return {r,b};};
  const saved=[T.first,SQ.on,TH.on,ST.warm,ST.back,T.lungeRoom,ST.on];
  // first: a held ball with no shot open is worked between two men before it is carried, tapped or passed
  T.first=true;
  X.setOut((r,bx,bz)=>bz>8?5:-5);const f1=tmk();ok('first: a carry to a z that opens a lane no longer goes first, the tic-tac does',X.pinPlay(f1.r,f1.b,HT,dt,true)===4&&f1.r.ttPk!=null);
  X.setOut((r,bx,bz)=>bz>16?5:-5);const f2=tmk();ok('...nor a tap to a neighbour whose lane is open',X.pinPlay(f2.r,f2.b,HT,dt,true)===4);
  X.setOut(()=>5);const f3=tmk();ok('...a shot that is open where the ball lies is still taken',X.pinPlay(f3.r,f3.b,HT,dt,true)===1);
  X.setOut(()=>-5);const f4=tmk();ok('...retrieve is never offered it (no tap passed)',X.pinPlay(f4.r,f4.b,HT,dt)!==4);
  const f5=tmk({over:{angle:0.4}});ok('...a forward leg is offered it (it lets go by turning up)',X.pinPlay(f5.r,f5.b,HT,dt,true)===4);
  const f6=tmk();ok('...not before the catch has settled',X.pinPlay(f6.r,f6.b,CA.settleT-0.05,dt,true)!==4);
  T.first=false;X.setOut((r,bx,bz)=>bz>8?5:-5);const f7=tmk();ok('...switched off, the carry goes first',X.pinPlay(f7.r,f7.b,HT,dt,true)!==4);
  T.first=true;
  // starting under a forward leg: the leg turns up and the pin lets go, then the man steps off
  X.setOut(()=>-5);
  {const r=world(X,{over:{angle:0.4}});pinned(X,r,1,-0.7);r.ttPk={s:1,j:2,mi:1,v:0};const n0=X.CAS.ttFwd;X.ttStart(r);
   ok('starting under a forward leg: the leg turns up first (a lift into the hit), counted',r.catPh==='flift'&&r.flNext==='hit'&&r.ttOn===true&&X.CAS.ttFwd===n0+1&&X.CAS.tt===1,r.catPh);
   const q=world(X,{over:{angle:0.4}});const bb=pinned(X,q,1,3);q.ttPk={s:1,j:2,mi:1,v:0};X.ttStart(q);
   ok('...a ball held ahead of the rod is not under the leg: the hit as usual, from the ball let go at rest',q.catPh==='hit'&&q.hPh==='rest'&&q.hAhead===true);
   const z=world(X);pinned(X,z,1,-0.7);Object.assign(z,{ttLock:99,ttDec:5,ttSq:7,ttPh:'strike'});z.ttPk={s:1,j:2,mi:1,v:0};X.ttStart(z);ok('a new rally starts with no lock, no decision made and the squaring due',z.ttLock===0&&z.ttDec===-1&&z.ttSq===0);
   const l=world(X,{over:{angle:0.4}});l.ttPk={s:1,j:2,mi:1,v:0};X.ttStart(l,true);ok('...a ball lying loose has nothing to let go',l.catPh==='hit'&&l.hPh==='clear');}
  // the window a strike is committed in is the standing man's face
  {X.setOut(()=>6);
   const seen=[];let withBall=0;
   for(let z=-18;z<-1;z+=0.05){const r=rally(X,{sg:1,off:0});const b=view(X,-0.65,z,0,25);const ts=(-(c0+T.margin)-z)/25;
    for(const o of X.ttOpts(r,b,false)){if(ts>o.d)continue;seen.push(ts);if(o.w>0)withBall++;}}   // a slide that starts before the ball reaches his standing face is the moving man's, and has no standing face to count to
   ok('a strike is offered only in the last T.late s before the leg could no longer get back, counted to the face of the man where he stands (he does not move until his go), whatever the slide',seen.length>0&&withBall>0&&seen.every(t=>t>=ST.tilt-0.02&&t<=ST.tilt+ST.late+0.02),'n='+seen.length+' withBall='+withBall+' span='+Math.min.apply(null,seen).toFixed(3)+'..'+Math.max.apply(null,seen).toFixed(3));}
  // the warm-up and the lock
  {X.setOut(()=>6);ST.on=true;ST.warm=3;
   let z0=null;for(let z=-18;z<-1&&z0==null;z+=0.05){const r=rally(X,{sg:1,off:0});if(X.ttOpts(r,view(X,-0.65,z,0,25),false).length)z0=z;}
   const mkw=(set)=>{const r=rally(X,{sg:1,off:0,set:Object.assign({ttEv:0},set)});return {r,b:view(X,-0.65,z0,0,25)};};
   const a=mkw({ttN:2});X.ttStep(a.r,a.b,D);ok('warm: the rows are not read for a strike before the ball has been touched T.warm times',a.r.ttPh==='bounce');
   const b=mkw({ttN:3});X.ttStep(b.r,b.b,D);ok('...from then they are',b.r.ttPh==='strike');
   const c=mkw({ttN:3,ttLock:X.S.time+1});X.ttStep(c.r,c.b,D);ok('...not while the lock from a given-up strike lasts',c.r.ttPh==='bounce');
   const d=mkw({ttN:3,ttLock:X.S.time-1});X.ttStep(d.r,d.b,D);ok('...and again once it is over',d.r.ttPh==='strike');
   ST.warm=0;ST.on=false;}
  // the ease: a rally that has gone on settles for a narrower gap
  {const r=rally(X);r.ttT=ST.patient-0.5;const e0=X.ttEase(r);r.ttT=T.maxT;const e1=X.ttEase(r);r.ttT=(ST.patient+T.maxT)/2;const e2=X.ttEase(r);
   ok('ease: none while the rally is young, the full ST.ease at T.maxT, half of it between',e0===0&&Math.abs(e1-ST.ease)<1e-9&&Math.abs(e2-ST.ease/2)<1e-6,e0+' '+e1+' '+e2);
   X.setOut((r,bx,bz)=>ST.prep-0.5);ST.on=true;ST.warm=0;let zz=null;for(let z=-18;z<-1&&zz==null;z+=0.05){const q=rally(X,{sg:1,off:0});if(X.ttOpts(q,view(X,-0.65,z,0,25),false).length)zz=z;}
   const y=rally(X,{sg:1,off:0,set:{ttEv:0,ttT:0}});X.ttStep(y,view(X,-0.65,zz,0,25),D);ok('...a lane under T.prep is not enough to a young rally',y.ttPh==='bounce');
   const o=rally(X,{sg:1,off:0,set:{ttEv:0,ttT:T.maxT-0.1}});X.ttStep(o,view(X,-0.65,zz,0,25),D);ok('...but is to an old one',o.ttPh==='strike');ST.on=false;}
  // revert: a committed strike whose lane shuts while the ball is still far from his face squares the leg up again
  {ST.back=1;
   const smk=(d,set)=>{const r=world(X,{off:0}),rel=-0.65,sa=X.sideAngle(rel,false)*dir;
    Object.assign(r,{catPh:'tictac',ttOn:true,ttPh:'strike',ttLo:0,ttN:4,ttT:1,ttSg:1,ttEv:1,ttDead:0,ttGo:false,ttA:X.hitAngle(rel),ttRel:rel,ttMan:1,ttW:0,ttSt:0,ttTz:3,ttClr:5,ttFound:0,ttGoT:0,pinPose:true,pinA:sa,angle:sa},set||{});
    const vz=25,cz=r.baseZ[1]+r.offset-ST.gap,t=d+ST.settle,bz=cz-vz*t;return {r,b:view(X,rel,bz,0,vz),sa};};
   X.setOut(()=>-5);const a=smk(0.3);const b0=X.CAS.ttBack;X.ttStep(a.r,a.b,D);
   ok('revert: the lane has shut with the ball still far from his face: back to bouncing, counted, the rally goes on',a.r.ttPh==='bounce'&&a.r.catPh==='tictac'&&a.r.ttOn===true&&X.CAS.ttBack===b0+1&&a.r.ttGo===false);
   ok('...no strike is read for again for T.relock',a.r.ttLock>X.S.time&&Math.abs(a.r.ttLock-X.S.time-ST.relock)<1e-9);
   X.ttStep(a.r,a.b,D);ok('...the next frame the foot goes back to the squared angle',a.r.pinPose===true&&Math.abs(a.r.pinA-a.r.ttA*dir)<1e-12);
   X.setOut(()=>5);const b=smk(0.3);X.ttStep(b.r,b.b,D);ok('...not while the lane is open',b.r.ttPh==='strike');
   X.setOut(()=>ST.back+0.2);const c=smk(0.3);X.ttStep(c.r,c.b,D);ok('...nor while it clears by T.back',c.r.ttPh==='strike');
   X.setOut(()=>ST.back-0.2);const d=smk(0.3);X.ttStep(d.r,d.b,D);ok('...a lane just under T.back is enough',d.r.ttPh==='bounce');
   X.setOut(()=>-5);const e=smk(0.02);X.ttStep(e.r,e.b,D);ok('...not once the ball is nearly at his face (the leg could not come back in time and would meet it turning)',e.r.ttPh==='strike'&&e.r.catPh==='tictac');
   X.setOut(()=>0.2);const f=smk(0.3,{ttT:T.maxT});X.ttStep(f.r,f.b,D);ok('...an old rally gives up less readily (the ease lowers T.back)',f.r.ttPh==='strike');
   X.setOut(()=>ST.go-0.4);const g1=smk(dt*0.5);X.ttStep(g1.r,g1.b,D);ok('...at the last moment he needs T.go of it',g1.r.catPh==='side'&&g1.r.ttGo===false);
   const g2=smk(dt*0.5,{ttT:T.maxT});X.ttStep(g2.r,g2.b,D);ok('...and less than that in an old rally (the ease lowers T.go too)',g2.r.ttGo===true);
   ST.back=-1e9;}
  // square: between touches the foot follows the ball's depth
  {SQ.on=true;
   const mk=(rel,z,set)=>{const r=rally(X,{sg:1,off:0,set:Object.assign({ttSq:0,ttEv:9},set||{})});return {r,b:view(X,rel,z,0,20),a0:r.ttA};};
   const a1=X.hitAngle(-0.25),a0=X.hitAngle(-0.65);
   const m=mk(-0.25,-9.25);X.ttStep(m.r,m.b,D);ok('square: the ball between the faces has crept off the depth: the foot turns toward the angle that squares it',Math.abs(m.r.ttA-Math.max(a0-SQ.step,Math.min(a0+SQ.step,a1)))<1e-9&&m.r.ttA!==a0,'ttA='+m.r.ttA+' a0='+a0+' a1='+a1);
   const w=X.hitAngle(2.0),m2=mk(2.0,-9.25);X.ttStep(m2.r,m2.b,D);ok('...by no more than SQ.step a look',Math.abs(m2.r.ttA-(a0+Math.sign(w-a0)*SQ.step))<1e-9,'ttA='+m2.r.ttA);
   const m3=mk(-0.25,-3);X.ttStep(m3.r,m3.b,D);ok('...not while it is close to a face (a foot still turning at the contact hands the ball its forward speed)',m3.r.ttA===m3.a0);
   const m4=mk(-0.25,-9.25,{ttSq:SQ.every});X.ttStep(m4.r,m4.b,D);ok('...looked at only every SQ.every',m4.r.ttA===m4.a0);
   let rn=null;for(let q=T.relMax;q<=T.offMax;q+=0.05)if(X.hitAngle(q)==null){rn=q;break;}
   if(rn!=null){const m5=mk(rn,-9.25);X.ttStep(m5.r,m5.b,D);ok('...a depth no angle squares the foot on: taken as a side catch',m5.r.catPh==='side'&&X.CAW['tt:drift']===1);}
   const m6=mk(-0.25,-9.25);m6.b.m.position.x=22.5+T.offMax+0.1;X.ttStep(m6.r,m6.b,D);ok('...a ball beyond T.offMax ends it whatever the foot does',m6.r.ttOn===false&&X.CAW['tt:off']===1);
   SQ.on=false;}
  // thru: a ball rolling to a man with another beyond him is sometimes let through
  {TH.on=true;ST.on=false;const fz=c0+T.margin;
   const mk=(ts,set,o)=>{const r=rally(X,Object.assign({sg:1,off:0,set:Object.assign({ttEv:9,ttDec:-1},set||{})},o||{}));return {r,b:view(X,-0.65,-fz-ts*25,0,25)};};
   const a=mk(0.25);const t0=X.CAS.ttThru;X.ttStep(a.r,a.b,D);
   ok('thru: the ball 0.25 s from the face of a man with another beyond him, the chance taken: the leg goes back, the man stands, counted, the man it passes and the one it is for noted',a.r.ttPh==='thru'&&a.r.ttThruF===1&&a.r.ttThruN===2&&X.CAS.ttThru===t0+1);
   X.ttStep(a.r,a.b,D);ok('...the pose is the strike pose for the ball\'s depth, the rod holds still, the man is the one it passes',Math.abs(a.r.pinA-X.sideAngle(-0.65,false)*dir)<1e-12&&a.r.target===a.r.offset&&a.r.aiMan===1&&a.r.ttPh==='thru');
   const bz=a.r.baseZ[1]+a.r.offset+TH.past-0.2;a.b.m.position.z=bz;X.ttStep(a.r,a.b,D);ok('...it goes on with the ball past the man by more than ST.past (it is not "rolled through": the rally goes on)',a.r.ttPh==='thru'&&a.r.ttOn===true&&a.r.ttLo===0);
   a.b.m.position.z=a.r.baseZ[1]+a.r.offset+TH.past+0.1;X.ttStep(a.r,a.b,D);ok('...once the ball is TH.past beyond his centre the foot squares up for the next man: the pair is the two men beyond him',a.r.ttPh==='bounce'&&a.r.ttLo===1&&a.r.catPh==='tictac');
   const f=mk(0.25);X.ttStep(f.r,f.b,D);f.b.v.z=-25;X.ttStep(f.r,f.b,D);ok('...a ball that turns round in it (it met something) is taken as a side catch',f.r.catPh==='side'&&X.CAW['tt:flip']===1);
   const g=mk(0.25);X.setRng(0.99);X.ttStep(g.r,g.b,D);ok('...the chance not taken: it bounces, and does not ask again this trip',g.r.ttPh==='bounce'&&g.r.ttDec===g.r.ttN);X.setRng(0.1);X.ttStep(g.r,g.b,D);ok('...(however often it looks)',g.r.ttPh==='bounce');
   const h=mk(0.4);X.ttStep(h.r,h.b,D);ok('...not decided while the ball is further off than TH.lead',h.r.ttPh==='bounce'&&h.r.ttDec===-1);
   const i=mk(0.1);X.ttStep(i.r,i.b,D);ok('...nor when the leg would not be back in time (TH.min)',i.r.ttPh==='bounce');
   const j=rally(X,{sg:1,off:0,lo:1,set:{ttEv:9,ttDec:-1}});X.ttStep(j,view(X,-0.65,18.5-fz-0.25*25,0,25),D);ok('...nor with no man beyond the one the ball is for',j.ttPh==='bounce');
   const k=mk(0.25);k.r.removedUntil=[0,0,1e9];X.ttStep(k.r,k.b,D);ok('...nor when that man is gone',k.r.ttPh!=='thru');
   const l=mk(0.25);const rr=TH.run;TH.run=99;X.ttStep(l.r,l.b,D);TH.run=rr;ok('...nor when the run to him is shorter than the foot needs to square up',l.r.ttPh==='bounce');
   const mid=rally(X,{role:'MID',baseZ:[-23.8,-11.9,0,11.9,23.8],lo:1,sg:1,off:0,set:{ttEv:9,ttDec:-1}});const r0=TH.run;TH.run=0.05;X.ttStep(mid,view(X,-0.65,-fz-0.25*25,0,25),D);TH.run=r0;ok('...nor by a rod the switch does not name',mid.ttPh==='bounce');
   {const vs=TH.minV-1,m=rally(X,{sg:1,off:0,set:{ttEv:9,ttDec:-1}});X.ttStep(m,view(X,-0.65,-fz-0.25*vs,0,vs),D);ok('...nor a ball slower than TH.minV (it would die on its way to the next man)',m.ttPh==='bounce');}
   TH.on=false;const n=mk(0.25);X.ttStep(n.r,n.b,D);ok('...nor with the switch off',n.r.ttPh==='bounce');
   TH.on=true;const o=mk(0.25);X.ttStep(o.r,o.b,D);o.b.m.position.z=o.r.baseZ[1]+o.r.offset+ST.past+1;X.ttStep(o.r,o.b,D);ok('...a ball beyond the man by more than ST.past is not "through" while it is let through',X.CAW['tt:through']===undefined&&o.r.ttOn===true);
   TH.on=false;}
  // lunge room
  {T.lungeRoom=2.5;const fz=c0+T.margin;
   const mk=(off,dz)=>{const r=rally(X,{sg:1,off:off});return {r,b:view(X,-0.65,r.baseZ[1]+off-fz-dz,0,25)};};
   const a=mk(-11.4,0.5);X.ttStep(a.r,a.b,D);ok('lunge room: the man the ball is rolling to has no slide left to go into it: handed over as a side catch before it is stopped dead',a.r.catPh==='side'&&X.CAW['tt:room']===1);
   const b=mk(-5,0.5);X.ttStep(b.r,b.b,D);ok('...with the room he lunges as before',b.r.catPh==='tictac'&&b.r.target<b.r.offset);
   const c=mk(8.95,8);X.ttStep(c.r,c.b,D);ok('...waiting, the rod does not drift closer to the end of its slide than T.lungeRoom',c.r.target<=c.r.maxOff-T.lungeRoom+1e-9,'target='+c.r.target);
   T.lungeRoom=0;const d=mk(-11.4,0.5);X.ttStep(d.r,d.b,D);ok('...with 0 asked for it is the older rule: it lunges where it stands',d.r.catPh==='tictac');}
  // a ball rolling along the row is worked from where it is (T.roll); the rally goes to a slow ball (T.meet) and drifts only from the first touch
  {const RL=T.roll,fz=c0+T.margin,keep=[RL.on,RL.under];
   const rl=(rel,z,vz,o,vx)=>{const r=world(X,o);r.act=null;r.catPh=null;return {r,got:X.ttRoll(r,view(X,rel,z,vx||0,vz))};};
   const a=rl(-0.6,-18.5+fz+0.5,14);
   ok('roll: a ball rolling along the row under the rod between two men is worked at once: the bounce, the man it rolls to, the foot squared on its depth, no touch yet',a.got&&a.r.ttOn&&a.r.ttPh==='bounce'&&a.r.ttLo===0&&a.r.ttSg===1&&a.r.catMan===1&&a.r.ttN===0&&Math.abs(a.r.ttA-X.hitAngle(-0.6))<1e-12&&X.CAS.ttRoll===1,'got='+a.got+' man='+a.r.catMan);
   const b=rl(-0.6,-fz-0.5,-14);ok('...either way along the row',b.got&&b.r.catMan===0&&b.r.ttLo===0&&b.r.ttSg===-1);
   ok('...not too slow',!rl(-0.6,-9,RL.minV-0.5).got&&rl(-0.6,-9,RL.minV+0.5).got);
   ok('...not too quick',!rl(-0.6,-9,RL.maxV+1).got);
   ok('...not a ball also running up the table',!rl(-0.6,-9,14,null,CA.side.maxVX+1).got);
   ok('...not one on a man\'s foot (that is the kick), whichever way it rolls',!rl(-0.6,-fz+0.5,14).got&&!rl(-0.6,-fz+0.5,-14).got);
   ok('...not one too near the face for the foot to square up',!rl(-0.6,-fz-0.5*RL.tMin*14,14).got&&rl(-0.6,-fz-2*RL.tMin*14,14).got);
   ok('...not one outside the end men',!rl(-0.6,-18.5-5,14).got);
   ok('...not by the keeper',!rl(-0.6,-9,14,{role:'GK'}).got);
   ok('...not under the dead-ball push',!rl(-0.6,-9,14,{over:{force:true}}).got);
   ok('...not while the last rally cools',!rl(-0.6,-9,14,{over:{ttCd:99}}).got);
   RL.on=false;ok('...not with the switch off',!rl(-0.6,-9,14).got);RL.on=keep[0];
   RL.under=true;ok('under: only a ball no foot can come down on (a ball at -3 is the side catch\'s)',!rl(-3.0,-9,14).got&&rl(-0.6,-9,14).got);
   RL.under=false;ok('...off: any ball along the row the side catch and the meet leave',rl(-3.0,-9,14).got);RL.under=keep[1];
   {const q=world(X);q.act=null;q.catPh=null;ok('catchPick says tictac for it',X.catchPick(q,view(X,-0.6,-9,0,14))==='tictac');}
   const d=rally(X,{sg:1,off:2,set:{ttN:0}});X.ttStep(d,view(X,-0.65,-14,0,25),D);ok('no drift to the middle of the goal before the first touch (a slow ball rolling the same way would never reach the face)',d.target===d.offset,'target-offset='+(d.target-d.offset));
   const MT=T.meet,sl=rally(X,{sg:1,off:0});X.ttStep(sl,view(X,-0.65,-14,0,5),D);
   ok('meet: a slow ball far off is gone to: the face slides toward it so the gap closes at meet.v',Math.abs(sl.target-(sl.offset-(MT.v-5)*dt))<1e-9,'target='+sl.target);
   const nr=rally(X,{sg:1,off:0});X.ttStep(nr,view(X,-0.65,-fz-5*0.4,0,5),D);ok('...not once it is near (it is waited for, then lunged into)',nr.target>=nr.offset);
   T.meet=null;const nm=rally(X,{sg:1,off:0});X.ttStep(nm,view(X,-0.65,-14,0,5),D);ok('...not with it off',nm.target>=nm.offset);T.meet=MT;}
  // ending: the cooldown after a rally that ran out of time, and a forward catch for a rally in front of the pivot
  {const r=rally(X);const t0=X.S.time;X.ttCatch(r,1,1,'time');ok('ending: a rally that ran out of time waits T.cdTime before the next',Math.abs(r.ttCd-(t0+T.cdTime))<1e-9);
   const q=rally(X);X.ttCatch(q,1,1,'drift');ok('...any other end T.cd',Math.abs(q.ttCd-(X.S.time+T.cd))<1e-9);
   const s=rally(X);X.ttCatch(s,1,1,'touches');ok('...the touches limit is a long rally too',Math.abs(s.ttCd-(X.S.time+T.cdTime))<1e-9);
   const f=rally(X);f.ttRelNow=CA.side.aheadMin+0.2;X.ttCatch(f,1,1,'shut');ok('...a rally in front of the pivot is taken under a forward leg',f.catFwd===true);
   const g=rally(X);g.ttRelNow=0.5;X.ttCatch(g,1,1,'shut');ok('...one behind it as a back pin',g.catFwd===false);}
  T.first=saved[0];SQ.on=saved[1];TH.on=saved[2];ST.warm=saved[3];ST.back=saved[4];T.lungeRoom=saved[5];ST.on=saved[6];X.setOut(null);}
 return R;
}

let bad=0,total=0;
const base=suite(boot()),baseFail=new Set(base.filter(t=>!t.ok).map(t=>t.name));
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'a rolling ball is never worked',part:'catch',from:"if(ttRoll(r,best))return 'tictac';",to:''},
 {n:'roll: the switch is ignored',part:'catch',from:'!RL||!RL.on||T.roles',to:'!RL||T.roles'},
 {n:'roll: the keeper works it',part:'catch',from:'T.roles.indexOf(r.role)<0||r.force||(r.ttCd||0)>S.time||p.y>=AIC.lowY)return false;',to:'r.force||(r.ttCd||0)>S.time||p.y>=AIC.lowY)return false;'},
 {n:'roll: the dead-ball push is ignored',part:'catch',from:'T.roles.indexOf(r.role)<0||r.force||(r.ttCd||0)>S.time||p.y',to:'T.roles.indexOf(r.role)<0||(r.ttCd||0)>S.time||p.y'},
 {n:'roll: the cooldown is ignored',part:'catch',from:'||r.force||(r.ttCd||0)>S.time||p.y>=AIC.lowY)return false;',to:'||r.force||p.y>=AIC.lowY)return false;'},
 {n:'roll: any x speed will do',part:'catch',from:'if(Math.abs(v.x)>AIC.catch.side.maxVX||sp<RL.minV',to:'if(sp<RL.minV'},
 {n:'roll: no floor on the speed',part:'catch',from:'||sp<RL.minV||sp>RL.maxV||',to:'||sp>RL.maxV||'},
 {n:'roll: no ceiling on the speed',part:'catch',from:'||sp<RL.minV||sp>RL.maxV||',to:'||sp<RL.minV||'},
 {n:'roll: under is ignored',part:'catch',from:'(RL.under&&footAngle(rel,rel>0)!=null)',to:'false'},
 {n:'roll: a ball on a man\'s foot is worked',part:'catch',from:'if(p.z<zl||p.z>zh||(sg>0',to:'if((sg>0'},
 {n:'roll: no time asked for the foot to square',part:'catch',from:'||(sg>0?zh-p.z:p.z-zl)/sp<RL.tMin)return false;',to:')return false;'},
 {n:'roll: the man is the one behind it',part:'catch',from:'r.catMan=sg>0?lo+1:lo;r.ttLo=lo;',to:'r.catMan=sg>0?lo:lo+1;r.ttLo=lo;'},
 {n:'roll: it starts with a touch counted',part:'catch',from:'r.ttN=0;r.ttT=0;r.ttEv=0;r.ttDead=0;r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;r.hPh=null;r.pinOn=false;\n CAS.tt++;CAS.ttRoll++;',to:'r.ttN=1;r.ttT=0;r.ttEv=0;r.ttDead=0;r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;r.hPh=null;r.pinOn=false;\n CAS.tt++;CAS.ttRoll++;'},
 {n:'the rod drifts before the first touch',part:'catch',from:'stay=hv&&r.ttN>0?',to:'stay=hv?'},
 {n:'meet: a slow ball far off is waited for',part:'catch',from:'far?clamp(r.offset+tw*clamp(MT.v-sp,0,vm)*dt,-r.maxOff,r.maxOff):',to:''},
 {n:'meet: the face goes away from it',part:'catch',from:'far?clamp(r.offset+tw*',to:'far?clamp(r.offset-tw*'},
 {n:'meet: a quick ball is met too',part:'catch',from:'&&sp<MT.v&&dist>0',to:'&&dist>0'},
 {n:'a ball slower than thru.minV is let through',part:'catch',from:'sp>Math.max(T.minV,TH.minV||0)&&r.ttDec!==r.ttN',to:'sp>T.minV&&r.ttDec!==r.ttN'},
 // the pair
 {n:'a pair needs no room between the faces',part:'catch',from:"r.baseZ[lo+1]-r.baseZ[lo]-2*(FOOT_BOX.z+BALL_R)>=ttVal(r,'room');",to:'true;'},
 {n:'a man gone does not spoil a pair',part:'catch',from:'manLive(r,lo)&&manLive(r,lo+1)&&r.baseZ[lo+1]',to:'r.baseZ[lo+1]'},
 // a rod's own settings
 {n:'every rod has the common settings',part:'catch',from:'return B&&B[k]!=null?B[k]:AIC.catch.tictac[k];',to:'return AIC.catch.tictac[k];'},
 {n:'a rod with its own settings has only those',part:'catch',from:'return B&&B[k]!=null?B[k]:AIC.catch.tictac[k];',to:'return B?B[k]:AIC.catch.tictac[k];'},
 // a ball lying loose
 {n:'a loose ball never starts one',part:'catch',from:'const tp=ttLoose(r)?ttPick(r,p,rel,[[lo,1],[lo+1,-1]],obs,gx):null;',to:'const tp=null;'},
 {n:'a loose ball starts one without the switch',part:'catch',from:'return !!(T&&T.on&&T.loose&&T.roles.indexOf(r.role)>=0&&!r.force&&(r.ttCd||0)<=S.time);',to:'return !!(T&&T.roles.indexOf(r.role)>=0&&!r.force&&(r.ttCd||0)<=S.time);'},
 {n:'a loose start is not its own switch',part:'catch',from:'T&&T.on&&T.loose&&T.roles',to:'T&&T.on&&T.roles'},
 {n:'a loose start ignores the rod',part:'catch',from:'T&&T.on&&T.loose&&T.roles.indexOf(r.role)>=0&&!r.force',to:'T&&T.on&&T.loose&&!r.force'},
 {n:'a loose start ignores the cooldown',part:'catch',from:'&&!r.force&&(r.ttCd||0)<=S.time);',to:'&&!r.force);'},
 {n:'a loose start ignores the dead-ball push',part:'catch',from:'T.roles.indexOf(r.role)>=0&&!r.force&&(r.ttCd||0)<=S.time);',to:'T.roles.indexOf(r.role)>=0&&(r.ttCd||0)<=S.time);'},
 {n:'a loose start needs a neighbour with a lane as well',part:'catch',from:'if(!bs&&!tp)return false;',to:'if(!bs)return false;'},
 {n:'a loose start needs nothing at all',part:'catch',from:'if(!bs&&!tp)return false;',to:''},
 {n:'the pair it lies between is not the one',part:'catch',from:'[[lo,1],[lo+1,-1]]',to:'[[lo,1],[lo,-1]]'},
 {n:'only one man may play it first',part:'catch',from:'[[lo,1],[lo+1,-1]]',to:'[[lo,1]]'},
 {n:'the tic-tac is always taken over the plain hit',part:'catch',from:'const tt=!!tp&&(!bs||rngAi(r.idx)()<AIC.catch.tictac.share);',to:'const tt=!!tp;'},
 {n:'the plain hit is always taken over the tic-tac',part:'catch',from:'const tt=!!tp&&(!bs||rngAi(r.idx)()<AIC.catch.tictac.share);',to:'const tt=!!tp&&!bs;'},
 {n:'the plain hit is by the wrong man',part:'catch',from:'r.tapS=bs.s;r.tapJ=bs.j;r.hMan=bs.mi;r.hA=null;',to:'r.tapS=bs.s;r.tapJ=bs.j;r.hMan=bs.j;r.hA=null;'},
 {n:'the chance of a loose hit is not asked',part:'catch',from:'if(rngAi(r.idx)()>=LS.share)return false;\n const tt=',to:'const tt='},
 {n:'a tic-tac from a loose ball does not step off first',part:'catch',from:'if(tt){r.ttPk=tp;ttStart(r,true);return true;}',to:'if(tt){r.ttPk=tp;ttStart(r);return true;}'},
 {n:'a plain loose hit is not counted',part:'catch',from:'CAS.hitLoose++;\n return true;',to:'return true;'},
 {n:'a tic-tac from a loose ball is not started',part:'catch',from:'if(tt){r.ttPk=tp;ttStart(r,true);return true;}',to:'if(tt){r.ttPk=tp;return true;}'},
 {n:'a loose start is held first like a pin',part:'catch',from:"r.hPh=loose?'clear':'rest';",to:"r.hPh='rest';"},
 {n:'a loose start is not counted',part:'catch',from:'if(loose)CAS.ttLoose++;',to:''},
 {n:'every start is counted as a loose one',part:'catch',from:'if(loose)CAS.ttLoose++;',to:'CAS.ttLoose++;'},
 // the way forward
 {n:'an ATT is judged as the others are',part:'catch',from:"if(r.role==='ATT')return pinOutlet(r,bx,bz,obs,gx,sl);",to:''},
 {n:'the others are judged as an ATT is',part:'catch',from:"if(r.role==='ATT')return pinOutlet(r,bx,bz,obs,gx,sl);",to:'return pinOutlet(r,bx,bz,obs,gx,sl);'},
 {n:'an own rod standing ready is the row in front',part:'catch',from:'for(const o of obs)if(!o.own)rx=Math.min(rx,(o.x-bx)*r.kickDir);',to:'for(const o of obs)rx=Math.min(rx,(o.x-bx)*r.kickDir);'},
 {n:'an own rod standing ready is a man in the gap',part:'catch',from:'if(!o.own&&(o.x-bx)*r.kickDir-rx<0.01)d=',to:'if((o.x-bx)*r.kickDir-rx<0.01)d='},
 {n:'every row ahead is in the gap',part:'catch',from:'if(!o.own&&(o.x-bx)*r.kickDir-rx<0.01)d=',to:'if(!o.own)d='},
 {n:'the row in front is the furthest',part:'catch',from:'rx=Math.min(rx,(o.x-bx)*r.kickDir);',to:'rx=rx===1e9?(o.x-bx)*r.kickDir:Math.max(rx,(o.x-bx)*r.kickDir);'},
 {n:'the slope is ignored',part:'catch',from:'d=Math.min(d,Math.abs(bz+sl*rx-o.z));',to:'d=Math.min(d,Math.abs(bz-o.z));'},
 {n:'the ball is not allowed for',part:'catch',from:'return d-AIC.gapAim.blockR;\n}\n// man f brakes',to:'return d;\n}\n// man f brakes'},
 {n:'no row ahead is a shut lane',part:'catch',from:'if(rx===1e9)return 1e3;\n for(const o of obs)if(!o.own&&',to:'if(rx===1e9)return -1e3;\n for(const o of obs)if(!o.own&&'},
 {n:'a rod standing ready is not marked as the own one',part:'catch',from:'z:r2.baseZ[i]+r2.offset+dz,own:r2.team===team});',to:'z:r2.baseZ[i]+r2.offset+dz,own:false});'},

 // the slides
 {n:'a rod can slide faster than its top speed',part:'catch',from:'if(w>top)continue;a.push(w);',to:'a.push(w);'},
 {n:'only one side is offered',part:'catch',from:'if(w)a.push(-w);',to:''},
 {n:'the top speed is not the rod\'s own',part:'catch',from:'speed*rodSpeedMult(r)*0.97,a=[];',to:'speed*rodSpeedMult(r)*9,a=[];'},
 // who it is worked with
 {n:'any depth is worked',part:'catch',from:'if(rel<T.relMin||rel>T.relMax||hitAngle(rel)==null)return null;',to:'if(hitAngle(rel)==null)return null;'},
 {n:'the room between the faces is not asked when picking',part:'catch',from:'if(!ttRoom(r,Math.min(mi,j))||!hitFits(r,mi,j,s,p.z))continue;',to:'if(!hitFits(r,mi,j,s,p.z))continue;'},
 {n:'the hit that starts it need not fit',part:'catch',from:'if(!ttRoom(r,Math.min(mi,j))||!hitFits(r,mi,j,s,p.z))continue;',to:'if(!ttRoom(r,Math.min(mi,j)))continue;'},
 {n:'the lanes are looked at only straight on',part:'catch',from:'for(const w of ws)v=Math.max(v,pinOutlet(r,p.x,zm,obs,goalX,T.strike.k*w));',to:'v=pinOutlet(r,p.x,zm,obs,goalX,0);'},
 {n:'the lanes are looked at from where the ball is, not the middle of the gap',part:'catch',from:'const zm=(r.baseZ[mi]+r.baseZ[j])/2+r.offset;',to:'const zm=p.z;'},
 {n:'the first side that fits is taken',part:'catch',from:'if(!best||v>best.v)best={s,j,mi,v};',to:'if(!best)best={s,j,mi,v};'},
 {n:'the worse side is taken',part:'catch',from:'if(!best||v>best.v)best={s,j,mi,v};',to:'if(!best||v<best.v)best={s,j,mi,v};'},
 // when
 {n:'a tic-tac needs no hold',part:'catch',from:'||t<T.minHold||r.force||',to:'||r.force||'},
 {n:'it starts under the dead-ball push',part:'catch',from:'||t<T.minHold||r.force||',to:'||t<T.minHold||'},
 {n:'the cooldown is ignored',part:'catch',from:'||(r.ttCd||0)>S.time)return false;',to:')return false;'},
 {n:'every role does it',part:'catch',from:'if(!T||!T.on||T.roles.indexOf(r.role)<0||t<T.minHold',to:'if(!T||!T.on||t<T.minHold'},
 {n:'the switch is ignored',part:'catch',from:'if(!T||!T.on||T.roles',to:'if(!T||T.roles'},
 {n:'the chance is rolled every look',part:'catch',from:'if(r.ttRoll==null)r.ttRoll=rngAi(r.idx)()<T.share;',to:'r.ttRoll=rngAi(r.idx)()<T.share;'},
 {n:'the chance is not asked',part:'catch',from:'if(!r.ttRoll)return false;',to:''},
 {n:'it always starts when it can',part:'catch',from:'if(r.ttRoll==null)r.ttRoll=rngAi(r.idx)()<T.share;',to:'r.ttRoll=true;'},
 {n:'a new hold does not roll again',part:'catch',from:'r.pcTurnT=0;r.ttRoll=null;r.pcSn=false;',to:'r.pcTurnT=0;r.pcSn=false;'},
 // pinPlay's hook
 {n:'retrieve is offered a tic-tac',part:'catch',from:'if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(',to:'if(!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant('},
 {n:'a forward leg is offered a tic-tac',part:'catch',from:'if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(',to:'if(tap&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant('},
 {n:'a rod with somewhere to carry it is offered a tic-tac',part:'catch',from:'if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(',to:'if(tap&&!fwd&&!mull&&r.pcOut<CA.lineClear&&ttWant('},
 {n:'the tic-tac goes before the tap',part:'catch',from:' pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);\n if(r.tapPk){if(fwdTap&&!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}\n if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(r,b,t,obs,goalX))return 4;',to:' pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);\n if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(r,b,t,obs,goalX))return 4;\n if(r.tapPk){if(fwdTap&&!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}'},
 {n:'a 4 is not acted on',part:'catch',from:'  if(v===4){ttStart(r);return;}\n',to:''},
 // starting
 {n:'the pair is not the two men',part:'catch',from:'r.ttLo=Math.min(pk.mi,pk.j);',to:'r.ttLo=pk.mi;'},
 {n:'the first touch is not a hit',part:'catch',from:"r.catPh='hit';r.hPh=loose?'clear':'rest';r.hT=0;",to:"r.catPh='tap';r.hPh=loose?'clear':'rest';r.hT=0;"},
 {n:'a tic-tac is not counted',part:'catch',from:"CAS.tt++;\n if(loose)CAS.ttLoose++;",to:"if(loose)CAS.ttLoose++;"},
 {n:'the neighbour is not the one picked',part:'catch',from:'r.tapS=pk.s;r.tapJ=pk.j;r.catT=0;',to:'r.tapS=pk.s;r.tapJ=pk.j-pk.s*2;r.catT=0;'},
 {n:'it is not marked as one',part:'catch',from:'r.ttOn=true;r.ttLo=',to:'r.ttOn=false;r.ttLo='},
 {n:'the first touch lands in a side catch',part:'catch',from:'  if(r.ttOn){ttGo(r,rb);return;}',to:''},
 {n:'the foot turns to the angle of the first hit, not stays',part:'catch',from:'r.ttA=r.hA;',to:'r.ttA=0;'},
 {n:'the depth is not remembered',part:'catch',from:'r.ttRel=(rb.m.position.x-r.x)*r.kickDir;',to:'r.ttRel=0;'},
 {n:'the way it is rolling is not remembered',part:'catch',from:'r.ttN=1;r.ttT=0;r.catT=0;r.ttSg=r.tapS;',to:'r.ttN=1;r.ttT=0;r.catT=0;r.ttSg=-r.tapS;'},
 {n:'the first touch is not counted',part:'catch',from:'r.ttN=1;r.ttT=0;r.catT=0;',to:'r.ttN=0;r.ttT=0;r.catT=0;'},
 // ending
 {n:'ending hands the ball to the wrong man',part:'catch',from:'r.catPh=\'side\';r.catMan=f;r.catSg=sg;',to:'r.catPh=\'side\';r.catMan=f===0?1:0;r.catSg=sg;'},
 {n:'ending hands it over the wrong way round',part:'catch',from:'r.catPh=\'side\';r.catMan=f;r.catSg=sg;',to:'r.catPh=\'side\';r.catMan=f;r.catSg=-sg;'},
 {n:'ending is not a side catch',part:'catch',from:'r.catPh=\'side\';r.catMan=f;r.catSg=sg;',to:'r.catPh=\'hold\';r.catMan=f;r.catSg=sg;'},
 {n:'a tap is left waiting to land',part:'catch',from:'r.catDeep=false;r.catT=0;r.tapPend=false;r.tbEv=0;   // a rally',to:'r.catDeep=false;r.catT=0;r.tbEv=0;   // a rally'},
 {n:'there is no cooldown after a catch',part:'catch',from:'r.ttOn=false;r.ttPh=null;r.ttCd=S.time+(why===\'time\'||why===\'touches\'?T.cdTime:T.cd);\n r.catPh',to:'r.ttOn=false;r.ttPh=null;\n r.catPh'},
 {n:'the end is not counted',part:'catch',from:"CAW['tt:'+why]=(CAW['tt:'+why]||0)+1;CAS.ttCatch++;",to:''},
 {n:'ending any other way leaves the tic-tac marked',part:'catch',from:' if(r.ttOn){r.ttOn=false;r.ttPh=null;r.ttCd=S.time+AIC.catch.tictac.cd;}',to:''},
 {n:'the tic-tac is routed after the others',part:'catch',from:" if(r.catPh==='tictac'){ttStep(r,best,D);return;}\n if(r.catPh==='tap')",to:" if(r.catPh==='tap')"},
 // the rows
 {n:'an own rod standing ready is not an obstacle',part:'catch',from:"if(r2.team===team&&r2.act!=='recv')continue;\n  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;\n  const tt=",to:"if(r2.team===team)continue;\n  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;\n  const tt="},
 {n:'an own rod is an obstacle',part:'catch',from:"if(r2.team===team&&r2.act!=='recv')continue;\n  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;\n  const tt=",to:"if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;\n  const tt="},
 {n:'a row behind the ball blocks',part:'catch',from:'if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;\n  const tt=',to:'if((r2.x-tx)*dir>=0)continue;\n  const tt='},
 {n:'the rows are read where they stand',part:'catch',from:'dz=clamp(r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset,-m,m);',to:'dz=0;'},
 {n:'the rows are read where they are heading at once, however far',part:'catch',from:'dz=clamp(r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset,-m,m);',to:'dz=r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset;'},
 {n:'the target is not carried on',part:'catch',from:'dz=clamp(r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset,-m,m);',to:'dz=clamp(r2.target-r2.offset,-m,m);'},
 {n:'the rows are read by their slide, not their target',part:'catch',from:'dz=clamp(r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset,-m,m);',to:'dz=clamp(r2.vz*tt,-m,m);'},
 {n:'a man gone is an obstacle',part:'catch',from:'for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset+dz,own:r2.team===team});}',to:'for(let i=0;i<r2.baseZ.length;i++){obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset+dz,own:r2.team===team});}'},
 {n:'the rows are read at the instant the ball is struck, not as it flies on',part:'catch',from:'const tt=t+(r2.x-bx)*dir/AIC.catch.shotV,',to:'const tt=t,'},
 // the plan
 {n:'the plan forgets the man is braking',part:'catch',from:'z0=r.baseZ[f]+r.offset+v0*Math.abs(v0)/(2*A),zc=z0+w*Math.abs(w)/(2*A)+w*ST.settle;',to:'z0=r.baseZ[f]+r.offset,zc=z0+w*Math.abs(w)/(2*A)+w*ST.settle;'},
 {n:'the plan forgets the ramp',part:'catch',from:'z0=r.baseZ[f]+r.offset+v0*Math.abs(v0)/(2*A),zc=z0+w*Math.abs(w)/(2*A)+w*ST.settle;',to:'z0=r.baseZ[f]+r.offset+v0*Math.abs(v0)/(2*A),zc=z0+w*ST.settle;'},
 {n:'the plan forgets the time at speed',part:'catch',from:'+w*Math.abs(w)/(2*A)+w*ST.settle;',to:'+w*Math.abs(w)/(2*A);'},
 {n:'the ball is long past rather than short of his centre',part:'catch',from:'_tp.cz=zc-sg*ST.gap;',to:'_tp.cz=zc+sg*ST.gap;'},
 {n:'the wait forgets the braking',part:'catch',from:'_tp.d=_tp.t-(Math.abs(v0)+Math.abs(w))/A-ST.settle;',to:'_tp.d=_tp.t-Math.abs(w)/A-ST.settle;'},
 {n:'the wait forgets the ramp',part:'catch',from:'_tp.d=_tp.t-(Math.abs(v0)+Math.abs(w))/A-ST.settle;',to:'_tp.d=_tp.t-Math.abs(v0)/A-ST.settle;'},
 {n:'the wait forgets the time at speed',part:'catch',from:'_tp.d=_tp.t-(Math.abs(v0)+Math.abs(w))/A-ST.settle;',to:'_tp.d=_tp.t-(Math.abs(v0)+Math.abs(w))/A;'},
 {n:'the rod is slower to speed up than the plan thinks',part:'catch',from:'const ST=AIC.catch.tictac.strike,A=AIC.slideAccel*stAgil(r),v0=r.slideV,sg=v.z>0?1:-1;',to:'const ST=AIC.catch.tictac.strike,A=AIC.slideAccel*stAgil(r)*3,v0=r.slideV,sg=v.z>0?1:-1;'},
 // the options
 {n:'a slide with the ball may be as fast as it',part:'catch',from:'if(w*sg>0&&Math.abs(w)>sp*ST.pushMax)continue;',to:''},
 {n:'a man who cannot get going in time is offered',part:'catch',from:'if(!(q.d>=0))continue;',to:''},
 {n:'the leg need not be back before the ball reaches the face',part:'catch',from:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}',to:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(tt>ST.tilt+ST.late)continue;}'},
 {n:'a strike is offered as early as it can be seen',part:'catch',from:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}',to:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt))continue;}'},
 {n:'the window is never asked',part:'catch',from:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}',to:''},
 {n:'the window is asked when the leg is already back',part:'catch',from:'if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}',to:'{const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}'},
 {n:'the slide may run out of rod',part:'catch',from:'if(Math.abs(oc)>r.maxOff-0.3||Math.abs(oc+w*ST.hold)>r.maxOff)continue;',to:''},
 {n:'the slide may run out of rod in the swing',part:'catch',from:'if(Math.abs(oc)>r.maxOff-0.3||Math.abs(oc+w*ST.hold)>r.maxOff)continue;',to:'if(Math.abs(oc)>r.maxOff-0.3)continue;'},
 {n:'the lane is read from the wrong slope',part:'catch',from:'const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,q.t),gx,ST.k*w);\n  a.push',to:'const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,q.t),gx,0);\n  a.push'},
 {n:'the lane is read from the wrong z',part:'catch',from:'const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,q.t),gx,ST.k*w);\n  a.push',to:'const clr=ttOutlet(r,p.x,p.z,ttObs(r.team,p.x,gx,q.t),gx,ST.k*w);\n  a.push'},
 {n:'the rows are read at the wrong time',part:'catch',from:'const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,q.t),gx,ST.k*w);\n  a.push',to:'const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,0),gx,ST.k*w);\n  a.push'},
 {n:'the aim point is not on the lane',part:'catch',from:'tz:q.cz+Math.abs(gx-p.x)*ST.k*w});',to:'tz:q.cz});'},
 {n:'the man picked is the one the ball has left',part:'catch',from:'f=sg>0?r.ttLo+1:r.ttLo,gx=r.kickDir>0?F.L/2:-F.L/2,sp=Math.abs(v.z),c=',to:'f=sg>0?r.ttLo:r.ttLo+1,gx=r.kickDir>0?F.L/2:-F.L/2,sp=Math.abs(v.z),c='},
 {n:'the worst lane is the best',part:'catch',from:'function ttBest(a){let b=null;for(const o of a)if(!b||o.clr>b.clr)b=o;return b;}',to:'function ttBest(a){let b=null;for(const o of a)if(!b||o.clr<b.clr)b=o;return b;}'},
 {n:'the first lane is the best',part:'catch',from:'function ttBest(a){let b=null;for(const o of a)if(!b||o.clr>b.clr)b=o;return b;}',to:'function ttBest(a){let b=null;for(const o of a)if(!b)b=o;return b;}'},
 // the strike
 {n:'a strike never times out',part:'catch',from:"if(r.ttSt>ST.abortT){ttCatch(r,f,sg,'slow');return;}",to:''},
 {n:'the slide is changed for any better lane, however little',part:'catch',from:'if(b&&(!cur||b.clr>cur.clr+ST.stick)){cur=b;w=r.ttW=b.w;}',to:'if(b&&(!cur||b.clr>cur.clr)){cur=b;w=r.ttW=b.w;}'},
 {n:'the slide is never changed',part:'catch',from:'if(b&&(!cur||b.clr>cur.clr+ST.stick)){cur=b;w=r.ttW=b.w;}',to:'if(b&&!cur){cur=b;w=r.ttW=b.w;}'},
 {n:'a strike with nothing on offer is carried on',part:'catch',from:"if(!cur){ttCatch(r,f,sg,'plan');return;}",to:"if(!cur){return;}"},
 {n:'the man goes as soon as the strike is committed',part:'catch',from:'if(cur.d<=dt*1.5){',to:'if(cur.d<=1e9){'},
 {n:'the man never gets going',part:'catch',from:'if(cur.d<=dt*1.5){',to:'if(false){'},
 {n:'the man goes too soon (a tenth of a second ahead)',part:'catch',from:'if(cur.d<=dt*1.5){',to:'if(cur.d<=0.1){'},
 {n:'a shut lane does not stop the man getting going',part:'catch',from:"if(cur.clr<ST.go-ez){ttCatch(r,f,sg,'shut');return;}",to:''},
 {n:'the lane is judged by the prep, not the go',part:'catch',from:'if(cur.clr<ST.go-ez){',to:'if(cur.clr<ST.prep-ez){'},
 {n:'the moment he goes is not noted',part:'catch',from:'r.ttGo=true;r.ttGoT=S.time;',to:'r.ttGo=true;'},
 {n:'the man slides before he is told to',part:'catch',from:'r.target=r.ttGo?clamp(r.offset+w*dt,-r.maxOff,r.maxOff):r.offset;\n const cs',to:'r.target=clamp(r.offset+w*dt,-r.maxOff,r.maxOff);\n const cs'},
 {n:'the man slides the wrong way',part:'catch',from:'r.target=r.ttGo?clamp(r.offset+w*dt,-r.maxOff,r.maxOff):r.offset;\n const cs',to:'r.target=r.ttGo?clamp(r.offset-w*dt,-r.maxOff,r.maxOff):r.offset;\n const cs'},
 {n:'the man does not slide once told to',part:'catch',from:'r.target=r.ttGo?clamp(r.offset+w*dt,-r.maxOff,r.maxOff):r.offset;\n const cs',to:'r.target=r.offset;\n const cs'},
 {n:'a lane that shuts under way is not given up',part:'catch',from:"if(clr<ST.drop){ttCatch(r,f,sg,'shut');return;}",to:''},
 {n:'the lane is looked at under way every frame',part:'catch',from:'if(r.ttGo&&(r.ttEv-=dt)<=0){',to:'if(r.ttGo){'},
 {n:'the lane is never looked at under way',part:'catch',from:'if(r.ttGo&&(r.ttEv-=dt)<=0){',to:'if(false){'},
 {n:'the swing fires the moment the man gets going',part:'catch',from:'if(!r.ttGo||gap-cs*ST.lag>ST.gap)return;',to:'if(!r.ttGo)return;'},
 {n:'the swing never fires',part:'catch',from:'if(!r.ttGo||gap-cs*ST.lag>ST.gap)return;',to:'return;'},
 {n:'the swing ignores how fast the ball closes',part:'catch',from:'const cs=sp-r.slideV*sg;',to:'const cs=0;'},
 {n:'the closing speed forgets the man\'s own slide',part:'catch',from:'const cs=sp-r.slideV*sg;',to:'const cs=sp;'},
 {n:'the swing fires with the leg anywhere',part:'catch',from:"if(Math.abs(r.angle-sa)>ST.tolA){ttCatch(r,f,sg,'pose');return;}",to:''},
 {n:'the strike gate is not asked',part:'catch',from:"if(!strikeOn(r,best,'trapShot')){r.target=clamp(r.offset+w*dt,-r.maxOff,r.maxOff);CAS.ttGate++;return;}",to:''},
 {n:'a refused gate is not counted',part:'catch',from:'r.maxOff,r.maxOff);CAS.ttGate++;return;}',to:'r.maxOff,r.maxOff);return;}'},
 {n:'the strike gate is not shown the slide',part:'catch',from:'r.target=clamp(r.offset+w*CA.push.lead,-r.maxOff,r.maxOff);',to:'r.target=r.offset;'},
 {n:'the slide is not held through the swing',part:'catch',from:'r.catSv=w;r.catHold=ST.hold;\n',to:'r.catSv=0;r.catHold=ST.hold;\n'},
 {n:'the slide is held for no time',part:'catch',from:'r.catSv=w;r.catHold=ST.hold;\n',to:'r.catSv=w;r.catHold=0.001;\n'},
 {n:'the aim assist is not told the lane',part:'catch',from:'r.catAim={best:{tz:r.ttTz,clr:r.ttClr},lanes:[],goalX:gx,ox:p.x,oz:p.z};r.aimEv=r.catAim;',to:''},
 {n:'the aim assist is told the wrong lane',part:'catch',from:'r.catAim={best:{tz:r.ttTz,clr:r.ttClr},lanes:[],goalX:gx,ox:p.x,oz:p.z};r.aimEv=r.catAim;',to:'r.catAim={best:{tz:0,clr:r.ttClr},lanes:[],goalX:gx,ox:p.x,oz:p.z};r.aimEv=r.catAim;'},
 {n:'the swing is the wrong one',part:'catch',from:"kickRod(r,'trapShot');\n r.catSw=true;",to:"kickRod(r,'pass');\n r.catSw=true;"},
 {n:'no swing is fired',part:'catch',from:"kickRod(r,'trapShot');\n r.catSw=true;",to:"r.catSw=true;"},
 {n:'the rod is not told it is in a swing',part:'catch',from:"kickRod(r,'trapShot');\n r.catSw=true;",to:"kickRod(r,'trapShot');\n "},
 {n:'a shot is not counted',part:'catch',from:'CAS.ttShot++;CAS.ttLat+=S.time-r.ttFound;CAS.ttGoLat+=S.time-r.ttGoT;',to:'CAS.ttLat+=S.time-r.ttFound;CAS.ttGoLat+=S.time-r.ttGoT;'},
 {n:'a shot is not ended',part:'catch',from:"catchEnd(r,CA.cd,w?'tt:cut':'tt:straight');",to:''},
 {n:'every shot is a cut',part:'catch',from:"catchEnd(r,CA.cd,w?'tt:cut':'tt:straight');",to:"catchEnd(r,CA.cd,'tt:cut');"},
 {n:'the leg is not sent back for a strike',part:'catch',from:'r.pinPose=true;r.pinA=sa;r.aiMan=f;',to:'r.aiMan=f;'},
 {n:'the leg is sent to the wrong angle',part:'catch',from:'r.pinPose=true;r.pinA=sa;r.aiMan=f;',to:'r.pinPose=true;r.pinA=r.ttA*dir;r.aiMan=f;'},
 {n:'the pose angle is for the wrong depth',part:'catch',from:'sa=sideAngle(rel,false)*dir;\n let w=r.ttW',to:'sa=sideAngle(-0.65,false)*dir;\n let w=r.ttW'},
 // the bounce
 {n:'a scored ball does not end it',part:'catch',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';\n else if(!manLive(r,lo)",to:"if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';\n else if(!manLive(r,lo)"},
 {n:'a lifted ball does not end it',part:'catch',from:"else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';\n else if(!manLive(r,lo)",to:"else if(r.force)why='force';\n else if(!manLive(r,lo)"},
 {n:'the dead-ball push does not end it',part:'catch',from:"else if(r.force)why='force';\n else if(!manLive(r,lo)",to:"\n else if(!manLive(r,lo)"},
 {n:'a man gone does not end it',part:'catch',from:"else if(!manLive(r,lo)||!manLive(r,hi))why='man';",to:""},
 {n:'a ball off the depth does not end it',part:'catch',from:"else if(rel<T.offMin||rel>T.offMax||Math.abs(v.x)>T.maxVX)why='off';",to:""},
 {n:'a ball rolling forward does not end it',part:'catch',from:"||Math.abs(v.x)>T.maxVX)why='off';",to:")why='off';"},
 {n:'a ball too deep does not end it',part:'catch',from:"else if(rel<T.offMin||rel>T.offMax||",to:"else if(rel>T.offMax||"},
 {n:'a ball rolled past a man does not end it',part:'catch',from:"else if(r.ttPh!=='thru'&&(p.z<r.baseZ[lo]+r.offset-ST.past||p.z>r.baseZ[hi]+r.offset+ST.past))why='through';",to:""},
 {n:'a ball rolled past the low man does not end it',part:'catch',from:"else if(r.ttPh!=='thru'&&(p.z<r.baseZ[lo]+r.offset-ST.past||p.z>",to:"else if(r.ttPh!=='thru'&&(p.z>"},
 {n:'a ball that has died does not end it',part:'catch',from:"if(sp<T.deadV){if((r.ttDead+=dt)>T.deadT){catchEnd(r,0,'tt:dead');return;}}else r.ttDead=0;",to:""},
 {n:'a ball slow for a moment ends it',part:'catch',from:"if((r.ttDead+=dt)>T.deadT){",to:"if((r.ttDead+=dt)>0){"},
 {n:'the dead clock is not reset',part:'catch',from:"}else r.ttDead=0;",to:"}"},
 {n:'a touch is not counted',part:'catch',from:'r.ttSg=sg;r.ttN++;r.ttEv=0;CAS.ttTouch++;',to:'r.ttSg=sg;r.ttEv=0;CAS.ttTouch++;'},
 {n:'a touch is counted every frame',part:'catch',from:'r.ttSg=sg;r.ttN++;r.ttEv=0;CAS.ttTouch++;',to:'r.ttN++;r.ttEv=0;CAS.ttTouch++;'},
 {n:'a slow ball is a touch',part:'catch',from:'if(sp>T.minV&&sg!==r.ttSg){',to:'if(sg!==r.ttSg){'},
 {n:'too many touches does not end it',part:'catch',from:"if(r.ttN>T.maxTouch){ttCatch(r,sg>0?hi:lo,sg,'touches');return;}",to:''},
 {n:'too many touches hands it to the wrong man',part:'catch',from:"ttCatch(r,sg>0?hi:lo,sg,'touches')",to:"ttCatch(r,sg>0?lo:hi,sg,'touches')"},
 {n:'a ball that flips in a strike is still struck at',part:'catch',from:"if(r.ttPh!=='bounce'){ttCatch(r,sg>0?hi:lo,sg,'flip');return;}",to:''},
 {n:'it never times out',part:'catch',from:"if(r.ttPh==='bounce'&&r.ttT>T.maxT){ttCatch(r,sg>0?hi:lo,sg,'time');return;}",to:""},
 {n:'a ball that creeps is not handed over',part:'catch',from:"else if(r.ttPh==='bounce'&&Math.abs(rel-r.ttRel)>T.drift){",to:"else if(false){"},
 {n:'the foot turns to chase the ball',part:'catch',from:'r.pinPose=true;r.pinA=r.ttA*dir;\n const hv',to:'r.pinPose=true;r.pinA=(hitAngle(rel)==null?r.ttA:hitAngle(rel))*dir;\n const hv'},
 {n:'the foot is not held squared',part:'catch',from:'r.pinPose=true;r.pinA=r.ttA*dir;\n const hv',to:'r.pinPose=false;r.pinA=r.ttA*dir;\n const hv'},
 {n:'the pin is left on',part:'catch',from:'r.aiMan=lo;r.pinOn=false;',to:'r.aiMan=lo;'},
 {n:'a ball at rest is gone for',part:'catch',from:'if(sp<T.minV){r.target=r.offset;return;}',to:''},
 {n:'the man slides to the wrong end',part:'catch',from:'const f=sg>0?hi:lo,zf=r.baseZ[f]+r.offset,dist=',to:'const f=sg>0?lo:hi,zf=r.baseZ[f]+r.offset,dist='},
 {n:'the man slides with the ball, not into it',part:'catch',from:'dist=(zf-sg*fz-p.z)*sg,tw=-sg;',to:'dist=(zf-sg*fz-p.z)*sg,tw=sg;'},
 {n:'the face is taken to be on the far side of the man',part:'catch',from:'dist=(zf-sg*fz-p.z)*sg,tw=-sg;',to:'dist=(zf+sg*fz-p.z)*sg,tw=-sg;'},
 {n:'he slides at the rod\'s top speed, not its pace',part:'catch',from:"const vm=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*ttVal(r,'pace'),",to:'const vm=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),'},
 {n:'he never starts early for the ramp',part:'catch',from:'lunge=dist<0.2||tc<=ramp+T.lunge;',to:'lunge=dist<0.2||tc<=T.lunge;'},
 {n:'he starts at once',part:'catch',from:'lunge=dist<0.2||tc<=ramp+T.lunge;',to:'lunge=true;'},
 {n:'he never starts',part:'catch',from:'lunge=dist<0.2||tc<=ramp+T.lunge;',to:'lunge=false;'},
 {n:'the lunge forgets the slack',part:'catch',from:'tc<=ramp+T.lunge;',to:'tc<=ramp;'},
 {n:'the ramp ignores the speed he already has',part:'catch',from:'const ramp=Math.max(0,vm-cur)/A,tc=dist/(sp+Math.max(0,cur)),',to:'const ramp=vm/A,tc=dist/(sp+Math.max(0,cur)),'},
 {n:'the time to the face ignores how fast he closes on it',part:'catch',from:'tc=dist/(sp+Math.max(0,cur)),',to:'tc=dist/sp,'},
 {n:'the rod does not drift to the middle of the goal',part:'catch',from:'stay=hv&&r.ttN>0?clamp(hm-r.offset,-hv*dt,hv*dt):0;',to:'stay=0;'},
 {n:'the rod drifts away from the middle of the goal',part:'catch',from:'stay=hv&&r.ttN>0?clamp(hm-r.offset,-hv*dt,hv*dt):0;',to:'stay=hv&&r.ttN>0?clamp(r.offset-hm,-hv*dt,hv*dt):0;'},
 {n:'the rod drifts at no pace',part:'catch',from:'stay=hv&&r.ttN>0?clamp(hm-r.offset,-hv*dt,hv*dt):0;',to:'stay=hv&&r.ttN>0?(hm-r.offset)/dt*dt:0;'},
 {n:'the middle is the wrong place',part:'catch',from:'hm=clamp(-(r.baseZ[lo]+r.baseZ[hi])/2,-r.maxOff+T.lungeRoom,r.maxOff-T.lungeRoom)',to:'hm=0'},
 {n:'a rod waits by moving the target off its offset for good',part:'catch',from:':r.offset+stay;',to:':r.offset+stay*50;'},
 // committing
 {n:'a strike is committed whatever the lane',part:'catch',from:'if(o&&o.clr>=ST.prep-ttEase(r)){',to:'if(o){'},
 {n:'a strike is never committed',part:'catch',from:'if(o&&o.clr>=ST.prep-ttEase(r)){',to:'if(false){'},
 {n:'the strikes are not switched off by the switch',part:'catch',from:"if(r.ttPh==='bounce'&&ST.on&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){",to:"if(r.ttPh==='bounce'&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){"},
 {n:'the rows are looked at every frame',part:'catch',from:"if(r.ttPh==='bounce'&&ST.on&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){",to:"if(r.ttPh==='bounce'&&ST.on&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)){"},
 {n:'a look is not counted',part:'catch',from:'r.ttEv=ST.look;CAS.ttLook++;',to:'r.ttEv=ST.look;'},
 {n:'the rows are not looked at at the bounce',part:'catch',from:"r.ttSg=sg;r.ttN++;r.ttEv=0;CAS.ttTouch++;",to:"r.ttSg=sg;r.ttN++;CAS.ttTouch++;"},
 {n:'a strike on a ball at rest',part:'catch',from:"&&ST.on&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){",to:"&&ST.on&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){"},
 {n:'the man chosen is not kept',part:'catch',from:"r.ttPh='strike';r.ttMan=o.f;r.ttW=o.w;",to:"r.ttPh='strike';r.ttMan=r.ttLo;r.ttW=o.w;"},
 {n:'the slide chosen is not kept',part:'catch',from:"r.ttMan=o.f;r.ttW=o.w;r.ttGo=false;",to:"r.ttMan=o.f;r.ttW=0;r.ttGo=false;"},
 {n:'a commit is not counted',part:'catch',from:"CAS.ttCommit++;CAS[o.w?'ttCut':'ttStraight']++;",to:"CAS[o.w?'ttCut':'ttStraight']++;"},
 {n:'a commit is counted as the wrong kind',part:'catch',from:"CAS.ttCommit++;CAS[o.w?'ttCut':'ttStraight']++;",to:"CAS.ttCommit++;CAS[o.w?'ttStraight':'ttCut']++;"},
 {n:'the strike phase is never run',part:'catch',from:"if(r.ttPh==='strike'){ttStrike(r,rb,best,D,sp,sg);return;}",to:''},
 // first
 {n:'tic-tac first ignores the switch',part:'catch',from:'if(tap&&!open&&CA.tictac.first&&ttWant(',to:'if(tap&&!open&&ttWant('},
 {n:'tic-tac first does not wait for the shot to be shut',part:'catch',from:'if(tap&&!open&&CA.tictac.first&&ttWant(',to:'if(tap&&CA.tictac.first&&ttWant('},
 {n:'tic-tac first is offered to retrieve',part:'catch',from:'if(tap&&!open&&CA.tictac.first&&ttWant(',to:'if(!open&&CA.tictac.first&&ttWant('},
 {n:'tic-tac first is never taken',part:'catch',from:'if(tap&&!open&&CA.tictac.first&&ttWant(',to:'if(false&&tap&&!open&&CA.tictac.first&&ttWant('},
 {n:'tic-tac first is not asked of a forward leg',part:'catch',from:'if(tap&&!open&&CA.tictac.first&&ttWant(',to:'if(tap&&!fwd&&!open&&CA.tictac.first&&ttWant('},
 // starting under a forward leg
 {n:'a forward start is not lifted',part:'catch',from:"if(!loose&&r.pinB&&!r.hAhead&&r.angle*r.kickDir>AIC.catch.recv.fwdMin){CAS.ttFwd++;fliftStart(r,'hit');return;}",to:''},
 {n:'a forward start is not counted',part:'catch',from:"{CAS.ttFwd++;fliftStart(r,'hit');return;}",to:"{fliftStart(r,'hit');return;}"},
 {n:'a ball held ahead is lifted from too',part:'catch',from:'if(!loose&&r.pinB&&!r.hAhead&&r.angle',to:'if(!loose&&r.pinB&&r.angle'},
 {n:'a ball held ahead is not known',part:'catch',from:'r.hAhead=!loose&&!!r.pinB&&r.pinB.pinDx>AIC.catch.side.aheadMin;',to:'r.hAhead=false;'},
 {n:'a new rally keeps the last lock',part:'catch',from:'r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;',to:'r.ttGo=false;r.ttSq=0;r.ttDec=-1;'},
 {n:'a new rally keeps the last squaring clock',part:'catch',from:'r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;',to:'r.ttGo=false;r.ttLock=0;r.ttDec=-1;'},
 {n:'a new rally keeps the last let-through decision',part:'catch',from:'r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;',to:'r.ttGo=false;r.ttLock=0;r.ttSq=0;'},
 // ending
 {n:'a rally that ran out of time has the short cooldown',part:'catch',from:"why==='time'||why==='touches'?T.cdTime:T.cd",to:'T.cd'},
 {n:'a rally that ran out of touches has the short cooldown',part:'catch',from:"why==='time'||why==='touches'?T.cdTime:T.cd",to:"why==='time'?T.cdTime:T.cd"},
 {n:'a rally in front of the pivot is taken as a back pin',part:'catch',from:'r.catFwd=(r.ttRelNow||0)>=AIC.catch.side.aheadMin;',to:'r.catFwd=false;'},
 {n:'every rally is taken under a forward leg',part:'catch',from:'r.catFwd=(r.ttRelNow||0)>=AIC.catch.side.aheadMin;',to:'r.catFwd=true;'},
 // the commit window
 {n:'the standing face is not counted to',part:'catch',from:'tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);',to:'tt=q.t-c/Math.max(sp-w*sg,1);'},
 // revert
 {n:'a shut lane never gives a strike up while the ball is on its way',part:'catch',from:'if(tf>ST.untilt&&(!cur||cur.clr<ST.back-ez)){ttRevert(r);return;}',to:''},
 {n:'a strike is given up only for a lane that clears by the prep',part:'catch',from:'cur.clr<ST.back-ez)){ttRevert',to:'cur.clr<ST.prep-ez)){ttRevert'},
 {n:'an old rally gives up as readily as a young one',part:'catch',from:'cur.clr<ST.back-ez)){ttRevert',to:'cur.clr<ST.back)){ttRevert'},
 {n:'a strike is given up with the ball at his face',part:'catch',from:'if(tf>ST.untilt&&(!cur',to:'if((!cur'},
 {n:'a given-up strike stays a strike',part:'catch',from:"r.ttPh='bounce';r.ttGo=false;r.ttEv=0;r.ttLock=",to:"r.ttGo=false;r.ttEv=0;r.ttLock="},
 {n:'a given-up strike is read for again at once',part:'catch',from:'r.ttLock=S.time+AIC.catch.tictac.strike.relock;',to:''},
 {n:'a given-up strike is not counted',part:'catch',from:'CAS.ttBack++;',to:''},
 {n:'the last moment needs the go whatever the age of the rally',part:'catch',from:"if(cur.clr<ST.go-ez){ttCatch(r,f,sg,'shut');return;}",to:"if(cur.clr<ST.go){ttCatch(r,f,sg,'shut');return;}"},
 // ease
 {n:'a long rally settles for no less',part:'catch',from:'return ST.ease*clamp(',to:'return 0*clamp('},
 {n:'the ease starts at once',part:'catch',from:'(r.ttT-ST.patient)/Math.max(0.1,T.maxT-ST.patient)',to:'(r.ttT)/Math.max(0.1,T.maxT-ST.patient)'},
 {n:'the ease has no top',part:'catch',from:'clamp((r.ttT-ST.patient)/Math.max(0.1,T.maxT-ST.patient),0,1)',to:'((r.ttT-ST.patient)/Math.max(0.1,T.maxT-ST.patient))'},
 {n:'a strike is committed at the full prep however old the rally',part:'catch',from:'o.clr>=ST.prep-ttEase(r)',to:'o.clr>=ST.prep'},
 // the warm-up and the lock
 {n:'the rows are read before the rally has warmed up',part:'catch',from:'&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&',to:'&&S.time>=(r.ttLock||0)&&'},
 {n:'the lock is ignored',part:'catch',from:'&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&',to:'&&r.ttN>=ST.warm&&'},
 // square
 {n:'the foot jumps to the angle that squares it',part:'catch',from:'r.ttA+=clamp(a-r.ttA,-SQ.step,SQ.step);',to:'r.ttA=a;'},
 {n:'the foot turns with the ball at a face',part:'catch',from:'if(near>=SQ.farT*sp)r.ttA+=',to:'r.ttA+='},
 {n:'a depth no angle fits does not end it',part:'catch',from:"if(a==null){ttCatch(r,sg>0?hi:lo,sg,'drift');return;}",to:''},
 {n:'the foot looks at the depth every frame',part:'catch',from:'if((r.ttSq=(r.ttSq||0)-dt)<=0&&sp>T.minV){',to:'if(sp>T.minV){'},
 {n:'the foot follows the ball whatever the switch',part:'catch',from:"if(r.ttPh==='bounce'&&SQ&&SQ.on){",to:"if(r.ttPh==='bounce'&&SQ){"},
 {n:'the foot never follows the ball',part:'catch',from:"if(r.ttPh==='bounce'&&SQ&&SQ.on){",to:'if(false){'},
 // thru
 {n:'a ball is never let through',part:'catch',from:"if(r.ttPh==='bounce'&&TH&&TH.on&&TH.roles.indexOf(r.role)>=0&&sp>Math.max(T.minV,TH.minV||0)&&r.ttDec!==r.ttN){",to:'if(false){'},
 {n:'a let-through ignores the switch',part:'catch',from:'&&TH&&TH.on&&TH.roles',to:'&&TH&&TH.roles'},
 {n:'every rod lets a ball through',part:'catch',from:'&&TH.roles.indexOf(r.role)>=0&&sp>Math.max(T.minV,TH.minV||0)',to:'&&sp>Math.max(T.minV,TH.minV||0)'},
 {n:'a let-through is asked again at every look',part:'catch',from:'&&sp>Math.max(T.minV,TH.minV||0)&&r.ttDec!==r.ttN){',to:'&&sp>Math.max(T.minV,TH.minV||0)){'},
 {n:'a let-through trip is not remembered as decided',part:'catch',from:'   r.ttDec=r.ttN;\n   if(ts>=TH.min',to:'   if(ts>=TH.min'},
 {n:'a let-through is decided at any distance',part:'catch',from:'if(ts<=TH.lead){',to:'if(true){'},
 {n:'a let-through is decided too late for the leg',part:'catch',from:'if(ts>=TH.min&&n>=0',to:'if(n>=0'},
 {n:'a man that is gone is let the ball through to',part:'catch',from:'&&manLive(r,n)&&((r.baseZ[n]',to:'&&((r.baseZ[n]'},
 {n:'the run to the next man is not asked',part:'catch',from:'((r.baseZ[n]-r.baseZ[f])*sg-2*fz)/Math.max(sp,1)>=TH.run&&',to:''},
 {n:'the chance of a let-through is not asked',part:'catch',from:'&&rngAi(r.idx)()<TH.share){',to:'){'},
 {n:'a let-through is not counted',part:'catch',from:'r.ttThruN=n;CAS.ttThru++;',to:'r.ttThruN=n;'},
 {n:'a let-through notes the wrong man',part:'catch',from:'r.ttThruF=f;r.ttThruN=n;',to:'r.ttThruF=n;r.ttThruN=f;'},
 {n:'a ball let through is met by the squared foot',part:'catch',from:'r.aiMan=f;r.pinPose=true;r.pinA=sideAngle(rel,false)*dir;r.target=r.offset;',to:'r.aiMan=f;r.pinPose=true;r.pinA=r.ttA*dir;r.target=r.offset;'},
 {n:'the man slides while the ball is let through',part:'catch',from:'r.pinA=sideAngle(rel,false)*dir;r.target=r.offset;\n  if((p.z-',to:'r.pinA=sideAngle(rel,false)*dir;r.target=r.offset+3;\n  if((p.z-'},
 {n:'the pair does not move on after a let-through',part:'catch',from:"r.ttLo=Math.min(f,r.ttThruN);r.ttPh='bounce';",to:"r.ttPh='bounce';"},
 {n:'the foot squares up as soon as the ball is under him',part:'catch',from:'*sg>=TH.past){r.ttLo',to:'*sg>=0){r.ttLo'},
 {n:'the foot never squares up for the next man',part:'catch',from:'*sg>=TH.past){r.ttLo',to:'*sg>=1e9){r.ttLo'},
 {n:'a ball let through has rolled through',part:'catch',from:"else if(r.ttPh!=='thru'&&(p.z<r.baseZ[lo]+r.offset-ST.past||p.z>r.baseZ[hi]+r.offset+ST.past))why='through';",to:"else if(p.z<r.baseZ[lo]+r.offset-ST.past||p.z>r.baseZ[hi]+r.offset+ST.past)why='through';"},
 {n:'a ball that turns round in a let-through goes on',part:'catch',from:"if(r.ttPh!=='bounce'){ttCatch(r,sg>0?hi:lo,sg,'flip');return;}",to:"if(r.ttPh==='strike'){ttCatch(r,sg>0?hi:lo,sg,'flip');return;}"},
 // lunge room
 {n:'the drift reaches the end of the slide',part:'catch',from:'hm=clamp(-(r.baseZ[lo]+r.baseZ[hi])/2,-r.maxOff+T.lungeRoom,r.maxOff-T.lungeRoom)',to:'hm=clamp(-(r.baseZ[lo]+r.baseZ[hi])/2,-r.maxOff,r.maxOff)'},
 {n:'a lunge with no slide left goes on',part:'catch',from:"if(lunge&&(tw>0?r.maxOff-r.offset:r.offset+r.maxOff)<T.lungeRoom*0.25){ttCatch(r,f,sg,'room');return;}",to:''},
 {n:'the slide left is measured the wrong way round',part:'catch',from:'(tw>0?r.maxOff-r.offset:r.offset+r.maxOff)<T.lungeRoom*0.25',to:'(tw>0?r.offset+r.maxOff:r.maxOff-r.offset)<T.lungeRoom*0.25'}
];
let caught=0;
for(const m of MUT){
 let res;
 try{res=suite(boot(m));}catch(e){
  if(/no-op/.test(e.message)){console.log('  MISSED  (THREW '+e.message.slice(0,120)+')  '+m.n);continue;}
  caught++;console.log('  caught  (threw)  '+m.n);continue;}
 const fails=res.filter(t=>!t.ok&&!baseFail.has(t.name));
 if(fails.length){caught++;console.log('  caught  ('+fails.length+' assertions)  '+m.n);}
 else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
