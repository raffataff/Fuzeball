// hit harness (the tap proper). node tools/hit-harness.js
// slices the real hit block (hitAngle / hitStand / hitFits / hitOk / hitStart / hitGo / hitStep / hitLoose, tapStart / tapSide / fliftStep, catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: a held (or loose) ball is knocked along the row with the man's SIDE: the angle that squares the foot onto its depth, the man stepping off it away from the neighbour, the run, the brake, the hand-off to the side catch; each mutation must break an assertion
// (what the ball actually does when the foot meets it is the real sim's: tools/hit-soak.js hitScene / hitTapGrid)
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
 "var S={balls:[],time:0}; var rods=[]; var BGS={retEnd:0,retEnter:0}; var OUT=null,RNGV=0.1,RELEASED=0;",
 "function pinRelease(r){r.pinB=null;RELEASED++;} function rngAi(){return function(){return RNGV;};}",
 "function kickRod(){} function strikeOn(){return true;} function sweepClips(){return false;} function passPick(){return null;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "function isUserRod(){return false;} function retrieveMan(r,bz){return {i:1,o:0};} function retrievePhase(r,ph){r.retPh=ph;}",
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 g.catch=g.catch.replace('function pinOutlet(r,bx,bz,obs,goalX,sl){','function pinOutlet(r,bx,bz,obs,goalX,sl){if(OUT)return OUT(r,bx,bz);');   // the lanes are scripted: this file is about what the man does with them
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,F:F,BALL_R:BALL_R,ARM:ARM,ROD_H:ROD_H,FOOT_BOX:FOOT_BOX,FOOT_BOX_OFF:FOOT_BOX_OFF,FOOT_T:FOOT_T,rods:rods,CAS:CAS,CAW:CAW,hitAngle:hitAngle,hitStand:hitStand,hitFits:hitFits,hitOk:hitOk,hitStart:hitStart,hitGo:hitGo,hitStep:hitStep,hitLoose:hitLoose,'+
  'tapStart:tapStart,tapSide:tapSide,fliftStep:fliftStep,catchStep:catchStep,catchEnd:catchEnd,catchPick:catchPick,'+
  'setOut:function(f){OUT=f;},setRng:function(v){RNGV=v;},released:function(){return RELEASED;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D={cd:1};
// the red ATT (x 22.5, attacking +x): three men 12 apart
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.setOut(null);X.setRng(0.1);for(const k in X.CAW)delete X.CAW[k];for(const k in X.CAS)X.CAS[k]=0;
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:opt.role||'ATT',idx:0,aiIQ:true,baseZ:opt.baseZ||[-12,0,12],maxOff:opt.maxOff||11.5,removedUntil:[],offset:opt.off||0,target:0,slideV:0,vz:0,angle:opt.angle!=null?opt.angle:-0.75,angVel:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,pinFwd:false,act:'catch',catPh:'hold',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,tapN:0,tapPk:null},opt.over||{});
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:[0,24],offset:-1.1,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:3.5,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?X.BALL_R:y,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
// a ball pinned under man mi at depth rel
function pinned(X,r,mi,rel,dz){const b=view(X,rel,r.baseZ[mi]+r.offset+(dz||0));b.pinMan=mi;b.pinDz=dz||0;b.pinDx=rel;r.pinB=b;X.S.balls.push(b);return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,HT=CA.hit,RV=CA.recv,FB=X.FOOT_BOX,dir=1,cz=FB.z+X.BALL_R+X.AIC.clearMargin+HT.pad;
 CA.recv.ready.on=false;
 // ---- the angle that squares the foot onto a ball ----
 {const lx=(a,rel)=>{const sa=Math.sin(a),ca=Math.cos(a),fx=sa*X.ARM*X.FOOT_T,fy=X.ROD_H-ca*X.ARM*X.FOOT_T,bcx=fx+X.FOOT_BOX_OFF.x*sa+X.FOOT_BOX_OFF.y*ca,bcy=fy-X.FOOT_BOX_OFF.x*ca+X.FOOT_BOX_OFF.y*sa,dx=rel-bcx,dy=X.BALL_R-bcy;return [dx*sa-dy*ca,dx*ca+dy*sa];};
  let allIn=true,mono=true,prev=-9;
  for(const rel of [-3.8,-3,-2,-1,-0.7,2,3,3.9]){const a=X.hitAngle(rel);if(a==null){allIn=false;continue;}const [u,v]=lx(a,rel);if(Math.abs(u)>FB.x*HT.fit+1e-9||Math.abs(v)>FB.y*HT.fit+1e-9)allIn=false;if(a<=prev&&rel!==2)mono=false;prev=a;}
  ok('every depth the bands name has an angle that puts the ball inside the foot box\'s face',allIn);
  ok('...a ball behind the pivot turns the leg back, a ball ahead turns it forward, and the further ahead the further forward',X.hitAngle(-3)<X.hitAngle(-1)&&X.hitAngle(-1)<0&&X.hitAngle(3)>X.hitAngle(2)&&X.hitAngle(2)>0&&mono);
  ok('a ball at a depth no angle reaches (well past the foot) has none',X.hitAngle(7)===null&&X.hitAngle(-7)===null);
  const keep=HT.fit;HT.fit=0.05;ok('...and the fit is the tolerance',X.hitAngle(4)===null);HT.fit=keep;}
 // ---- where the man stands to run at it ----
 {const r=world(X);
  ok('the man runs at it from off its z by the foot\'s reach and the run-up, on the side away from the neighbour (s +1: below it)',Math.abs(X.hitStand(r,1,6,1)-(6-(cz+HT.runUp)))<1e-9&&Math.abs(X.hitStand(r,1,6,-1)-(6+cz+HT.runUp))<1e-9,X.hitStand(r,1,6,1)+' / '+X.hitStand(r,1,6,-1));
  ok('...from a man that is not the middle one, offset against his own place',Math.abs(X.hitStand(r,2,6,1)-(6-(cz+HT.runUp)-12))<1e-9);}
 // ---- room, and the neighbour staying clear ----
 {const r=world(X);
  ok('a ball between the middle man and the next, with room both sides, fits',X.hitFits(r,1,2,1,6)===true);
  r.maxOff=1;ok('...not with no room to step off and run',X.hitFits(r,1,2,1,6)===false);r.maxOff=11.5;
  const so=world(X,{maxOff:3});ok('...not with the room to run on and brake but none to step off first',X.hitFits(so,1,2,1,-1)===false&&X.hitFits(so,1,2,1,3)===true);
  const ro=world(X,{maxOff:4});ok('...nor with the room to step off but none to run on and brake',X.hitFits(ro,1,2,1,8)===false&&X.hitFits(ro,1,2,1,5)===true);
  const t=world(X,{baseZ:[-6,0,6]});ok('...not when the men are so close that stepping off puts the neighbour on the ball',X.hitFits(t,1,2,1,-2)===false);
  const e=world(X);ok('...the same ball hit the other way, from the near man to the far, fits',X.hitFits(e,1,0,-1,-6)===true&&X.hitFits(e,1,2,1,2)===true);
  const g=HT.jGap;HT.jGap=-9;ok('(the neighbour\'s clearance is jGap)',X.hitFits(t,1,2,1,-2)===true);HT.jGap=g;}
 // ---- which held balls ----
 {const mk=(rel,opt,dz)=>{const r=world(X,opt);r.tapS=1;r.tapJ=2;const b=pinned(X,r,1,rel,dz);return {r,b};};
  const a=mk(-0.7);ok('a ball held at the back pin\'s depth, a neighbour to send it to, room: knocked (at the chance the share gives)',X.hitOk(a.r,a.b)===true);
  X.setRng(0.99);ok('...not at the other chances: the roll is the rest',X.hitOk(a.r,a.b)===false);X.setRng(0.1);
  ok('...a deep ball (retrieve\'s) too',X.hitOk(mk(-3.2).r,mk(-3.2).b)===true);
  ok('...and one lying ahead, held under a forward leg',X.hitOk(mk(3.3,{angle:1.0}).r,mk(3.3,{angle:1.0}).b)===true);
  ok('...not one in the dead zone between the bands (the neighbour cannot take it, the foot is nowhere near)',X.hitOk(mk(0.5).r,mk(0.5).b)===false&&X.hitOk(mk(1.2).r,mk(1.2).b)===false);
  ok('...nor one deeper than the foot reaches or the neighbour takes',X.hitOk(mk(-4.2).r,mk(-4.2).b)===false);
  ok('...nor one ahead the foot does not reach',X.hitOk(mk(4.6,{angle:1.0}).r,mk(4.6,{angle:1.0}).b)===false);
  const k=mk(-0.7,{role:'GK'});ok('...not the keeper (one man)',X.hitOk(k.r,k.b)===false);
  const f=mk(-0.8,{angle:0.4});ok('...a ball flush under a forward leg is let go by turning up, then knocked',X.hitOk(f.r,f.b)===true);
  RV.lift.on=false;ok('...unless the leg cannot turn up',X.hitOk(f.r,f.b)===false);RV.lift.on=true;
  HT.on=false;ok('...and with the switch off none',X.hitOk(a.r,a.b)===false);HT.on=true;
  const fit=HT.fit;HT.fit=0.01;ok('...nor one the foot cannot be squared onto',X.hitOk(a.r,a.b)===false);HT.fit=fit;
  const t=mk(-0.7,{off:3});t.r.maxOff=1;ok('...no room to step off and run: the roll',X.hitOk(t.r,t.b)===false);}
 // ---- starting ----
 {const mk=(rel,opt)=>{const r=world(X,opt);const b=pinned(X,r,1,rel);r.tapPk={j:2,s:1,out:9};return {r,b};};
  const a=mk(-0.7),h0=X.CAS.hit;X.tapStart(a.r);
  ok('a tap from a back pin is a hit: the phase, resting first with the ball still held, counted',a.r.catPh==='hit'&&a.r.hPh==='rest'&&a.r.tapS===1&&a.r.tapJ===2&&a.r.hMan===1&&a.r.tapHit===true&&X.CAS.hit===h0+1&&a.r.tapPk===null,a.r.catPh+'/'+a.r.hPh);
  ok('...a ball in the shallow band is not deep and not ahead',a.r.hDeep===false&&a.r.hAhead===false);
  const d=mk(-3.2);X.tapStart(d.r);ok('...a deep one says so, for the receiver',d.r.hDeep===true&&d.r.hAhead===false);
  const h=mk(3.3,{angle:1.0});X.tapStart(h.r);ok('...one lying ahead says so too',h.r.hAhead===true&&h.r.hDeep===false);
  const f=mk(-0.8,{angle:0.4});X.tapStart(f.r);ok('...flush under a forward leg the leg turns up first (the lift, then the step off)',f.r.catPh==='flift'&&f.r.flNext==='hit'&&f.r.tapHit===true);
  const n=mk(-0.7);X.setRng(0.99);X.tapStart(n.r);ok('...at the other chances it is the roll: the old tap',n.r.catPh==='tap'&&!n.r.tapHit&&n.r.hPh===undefined);X.setRng(0.1);
  const u=world(X);u.tapPk={j:2,s:1,out:9};X.tapStart(u);ok('(a tap with no ball held is the roll, whatever the chance)',u.catPh==='tap'&&!u.tapHit);}
 // ---- the lift hands over ----
 {const r=world(X,{angle:0.4});const b=pinned(X,r,1,-0.8);r.tapPk={j:2,s:1,out:9};X.tapStart(r);
  r.pinB=null;r.angle=1.2;r.flMan=1;X.fliftStep(r);
  ok('the leg up and the ball let go: the hit goes on, stepping off',r.catPh==='hit'&&r.hPh==='clear',r.catPh+'/'+r.hPh);
  const q=world(X,{angle:0.4});pinned(X,q,1,-0.8);q.tapPk={j:2,s:1,out:9};q.flNext='tap';q.catPh='flift';q.tapS=1;q.tapJ=2;q.pinB=null;q.angle=1.2;q.flMan=1;X.fliftStep(q);
  ok('...a tap\'s lift still goes to the receiver',q.catPh==='side');}
 // ---- the sequence ----
 {const mk=(rel,opt)=>{const r=world(X,opt);const b=pinned(X,r,1,rel);r.tapPk={j:2,s:1,out:9};X.tapStart(r);r.catT=0;return {r,b};};
  const a=mk(-0.7);a.r.slideV=HT.restV+8;a.r.offset=1;X.hitStep(a.r,a.b);
  ok('rest: the rod is still sliding: it brakes, the pose held, the ball still held',a.r.hPh==='rest'&&a.r.pinOn&&a.r.pinPose&&a.r.pinA===a.r.angle&&a.r.target===a.r.offset&&!!a.r.pinB);
  {const w=a.r.hT;a.r.hT=HT.restT+0.1;X.hitStep(a.r,a.b);ok('...but not for ever (it is let go at the slide it has)',a.r.hPh==='clear'&&a.r.pinB===null);a.r.pinB=a.b;a.r.hPh='rest';a.r.hT=w;a.r.pinOn=true;}
  a.r.slideV=0;X.hitStep(a.r,a.b);
  ok('...stopped: the ball is let go at rest and the man starts to step off',a.r.pinB===null&&a.r.hPh==='clear'&&a.r.pinOn===false&&a.r.pinPose===true,a.r.hPh);
  ok('...away from the neighbour, to where he runs from',Math.abs(a.r.target-X.hitStand(a.r,1,a.b.m.position.z,1))<1e-9&&a.r.target<a.r.offset+1e-9,'tgt='+a.r.target);
  a.r.catT=0;X.hitStep(a.r,a.b);ok('...still too near it: it keeps stepping off',a.r.hPh==='clear');
  {const fit=HT.fit,ks=a.r.catT;a.r.offset=a.r.target;HT.fit=0.001;X.hitStep(a.r,a.b);ok('...clear of it but the foot cannot be squared onto it: ended',a.r.act===null&&X.CAW['hit:reach']>=1);HT.fit=fit;a.r.act='catch';a.r.catPh='hit';a.r.hPh='clear';a.r.catT=0;a.r.offset=a.r.target-2;}
  a.r.offset=a.r.target;a.r.catT=0;X.hitStep(a.r,a.b);
  ok('...clear of it: the leg turns to the angle that squares the foot onto it',a.r.hPh==='aim'&&Math.abs(a.r.hA-X.hitAngle(-0.7))<1e-9&&Math.abs(a.r.pinA-a.r.hA*dir)<1e-9&&a.r.pinPose&&!a.r.pinOn,a.r.hPh+' hA='+a.r.hA);
  a.r.catT=0;X.hitStep(a.r,a.b);ok('...and waits for it',a.r.hPh==='aim');
  a.r.angle=a.r.pinA+HT.tolA*0.5;a.r.angVel=HT.tolW*2;a.r.catT=0;X.hitStep(a.r,a.b);ok('...and for the leg to stop turning (a foot still moving hands the ball its forward speed)',a.r.hPh==='aim');
  a.r.angVel=0;a.r.slideV=HT.restV+3;a.r.catT=0;X.hitStep(a.r,a.b);ok('...and for the man to stop',a.r.hPh==='aim');
  const oc=Math.max(-a.r.maxOff,Math.min(a.r.maxOff,X.hitStand(a.r,1,a.b.m.position.z,1)));a.r.slideV=0;a.r.offset=oc-1;a.r.catT=0;X.hitStep(a.r,a.b);ok('...and to be where he runs from',a.r.hPh==='aim');
  a.r.hT=HT.aimT+0.1;a.r.angle=0;a.r.catT=0;X.hitStep(a.r,a.b);ok('...but not for ever',a.r.hPh==='run');a.r.hPh='aim';a.r.hT=0;a.r.angle=a.r.pinA;a.r.offset=oc;a.r.angVel=0;a.r.slideV=0;a.r.catT=0;X.hitStep(a.r,a.b);
  ok('...aligned and still: the run, a step ahead toward the neighbour at the run speed',a.r.hPh==='run'&&Math.abs(a.r.target-(a.r.offset+HT.runV*dt))<1e-9,a.r.hPh+' tgt-off='+(a.r.target-a.r.offset));
  X.hitStep(a.r,a.b);ok('...the ball not touched yet: it runs on',a.r.hPh==='run');
  const b=a.b;b.m.position.z=a.r.baseZ[1]+a.r.offset+FB.z+X.BALL_R+0.1;b.v.z=10;a.r.catT=0;const hh=X.CAS.hitHit;X.hitStep(a.r,b);
  ok('...the foot meets it: the ball moves along the row with the box on it, and the rod brakes',a.r.hPh==='out'&&X.CAS.hitHit===hh+1&&a.r.target===a.r.offset,a.r.hPh);
  X.hitStep(a.r,b);ok('...the ball still against the man: not handed over yet',a.r.hPh==='out'&&a.r.catPh==='hit');
  X.hitStep(a.r,b);ok('...(the pose is held while it leaves)',a.r.pinPose&&!a.r.pinOn&&Math.abs(a.r.pinA-a.r.hA*dir)<1e-9);
  b.m.position.z=a.r.baseZ[1]+a.r.offset+cz+HT.clearOut+0.3;b.v.z=18;a.r.catT=0;const s0=X.CAS.hitSent,t0=X.CAS.tap;X.hitStep(a.r,b);
  ok('...clear of the man: the neighbour takes it as a side catch (counted as a tap that is on its way, and a hit sent)',a.r.catPh==='side'&&a.r.catMan===2&&a.r.catSg===1&&a.r.tapPend===true&&X.CAS.hitSent===s0+1&&X.CAS.tap===t0+1&&a.r.catFwd===false&&a.r.catDeep===false,a.r.catPh);
  const g=mk(-0.7);g.r.hPh='out';g.r.hA=X.hitAngle(-0.7);g.r.hT=HT.outT+0.1;g.b.v.z=0;g.r.pinB=null;X.hitStep(g.r,g.b);ok('a ball that never left the man (it is not moving) is not sent: stuck',g.r.act===null&&X.CAW['hit:stuck']>=1);
  const p=mk(-3.2);p.r.hPh='out';p.r.hA=X.hitAngle(-3.2);p.r.hT=HT.outT+0.1;p.b.v.z=15;p.r.pinB=null;X.hitStep(p.r,p.b);ok('a deep ball is received as one (the receiver\'s own band)',p.r.catPh==='side'&&p.r.catDeep===true);
  const q=mk(3.3,{angle:1.0});q.r.hPh='out';q.r.hA=X.hitAngle(3.3);q.r.hT=HT.outT+0.1;q.b.v.z=15;q.r.pinB=null;X.hitStep(q.r,q.b);ok('...one that lay ahead is received under a forward leg',q.r.catPh==='side'&&q.r.catFwd===true);}
 // ---- the run that misses ----
 {const r=world(X);const b=pinned(X,r,1,-0.7);r.tapPk={j:2,s:1,out:9};X.tapStart(r);r.catT=0;r.pinB=null;r.hPh='run';r.hA=X.hitAngle(-0.7);r.hT=HT.runT+0.1;X.hitStep(r,b);
  ok('a run that never reaches the ball ends',r.act===null&&X.CAW['hit:miss']>=1);
  const q=world(X);const c=pinned(X,q,1,-0.7);q.tapPk={j:2,s:1,out:9};X.tapStart(q);q.catT=0;q.pinB=null;q.hPh='run';q.hA=X.hitAngle(-0.7);c.m.position.z=q.baseZ[1]+q.offset+7;c.v.z=12;X.hitStep(q,c);
  ok('...a ball already moving but nowhere near the foot is not a hit',q.hPh==='run');}
 // ---- every way it ends ----
 {const mk=(ph,f)=>{const r=world(X);const b=pinned(X,r,1,-0.7);r.tapPk={j:2,s:1,out:9};X.tapStart(r);r.catT=0;r.hPh=ph;if(ph!=='rest')r.pinB=null;r.hA=X.hitAngle(-0.7);f&&f(r,b);X.hitStep(r,b);return r;};
  ok('the ball scores: ended',mk('clear',(r,b)=>{b.scored=true;}).act===null&&X.CAW['hit:scored']>=1);
  ok('...lifts: ended',mk('aim',(r,b)=>{b.m.position.y=X.AIC.lowY+1;}).act===null&&X.CAW['hit:lifted']>=1);
  ok('...the dead-ball push: ended',mk('clear',(r)=>{r.force=true;}).act===null&&X.CAW['hit:force']>=1);
  ok('...too long: ended',mk('aim',(r)=>{r.catT=HT.abortT+1;}).act===null&&X.CAW['hit:time']>=1);
  ok('...the held ball knocked loose before it was let go: ended',mk('rest',(r)=>{r.pinB=null;}).act===null&&X.CAW['hit:lost']>=1);
  ok('...the ball rolls off while the man steps off or turns: ended',mk('clear',(r,b)=>{b.v.z=HT.bailV+2;}).act===null&&X.CAW['hit:moved']>=1&&mk('aim',(r,b)=>{b.v.x=HT.bailV+2;}).act===null);
  ok('...a ball moving in the run is the hit, not a reason to stop',mk('run',(r,b)=>{b.v.z=HT.bailV+2;}).act==='catch');
  ok('...the ball leaves the depths it can be reached at: ended',mk('aim',(r,b)=>{b.m.position.x=22.5+HT.bands[HT.bands.length-1][1]+3;}).act===null&&X.CAW['hit:moved']>=1);
  ok('...no room to stand where he runs from (a ball he cannot get behind): ended',mk('clear',(r)=>{r.maxOff=0.2;r.offset=0;}).act===null&&X.CAW['hit:room']>=1);
  const e=mk('clear',(r)=>{r.force=true;});ok('ending clears the hit\'s state',e.hPh===null&&e.tapHit===false&&!e.pinPose);}
 // ---- the dispatch, and what a landing counts ----
 {const r=world(X);const b=pinned(X,r,1,-0.7);r.tapPk={j:2,s:1,out:9};X.tapStart(r);r.catT=0;
  X.catchStep(r,b,D);ok('a rod in a hit is run by hitStep, ahead of the pin hold, whatever it is holding',r.catPh==='hit'&&r.hPh==='clear'&&r.pinB===null&&r.catT>0);
  const q=world(X);const c=pinned(X,q,1,-0.7);q.catPh='side';q.tapPend=true;q.tapHit=true;q.catMan=1;q.catSg=1;X.catchStep(q,c,D);
  ok('a hit that lands (the receiver pins it) is counted',X.CAS.hitOk===1&&q.tapHit===false&&q.tapPend===false&&X.CAS.tapOk===1,'hitOk='+X.CAS.hitOk);}
 // ---- a loose ball lying between two men ----
 {const LS=HT.loose,open=(r,bx,bz)=>bz<0?9:-9;   // a lane toward the low-z end only
  const mk=(rel,z,opt,sp)=>{const r=world(X,opt);X.setOut(open);return {r,b:view(X,rel,z,sp||0,0)};};
  const a=mk(-0.7,6);
  ok('a ball at rest between two men, no shot where it lies, a neighbour whose lane is open: knocked to him (here the near-z one, sent from the man above)',X.hitLoose(a.r,a.b)===true&&a.r.tapS===-1&&a.r.tapJ===1&&a.r.hMan===2&&a.r.hPh==='clear'&&a.r.tapHit===true&&X.CAS.hitLoose===1,'s='+a.r.tapS+' j='+a.r.tapJ+' man='+a.r.hMan);
  ok('...the pose held where it is until it is turned',a.r.pinA===a.r.angle);
  X.setRng(0.1);const b=mk(-0.7,6);b.r.htT=1e9;X.S.time=0;ok('...once a LS.every, not every frame',X.hitLoose(b.r,b.b)===false);
  const c=mk(-0.7,6);X.setRng(0.99);ok('...at the chance the share gives',X.hitLoose(c.r,c.b)===false&&c.r.htT===X.S.time+LS.every);X.setRng(0.1);
  ok('...not a ball in the air or rolling about',X.hitLoose(...(()=>{const m=mk(-0.7,6,{},LS.maxV+2);return [m.r,m.b];})())===false&&X.hitLoose(...(()=>{const m=mk(-0.7,6);m.b.m.position.y=X.AIC.lowY+1;return [m.r,m.b];})())===false);
  const e=mk(-0.7,1.5);ok('...not one a man is on (the fetch\'s and the retrieve\'s)',X.hitLoose(e.r,e.b)===false);
  const f=mk(-0.7,6);f.r.removedUntil=[0,1e9,0];ok('...not with a man gone',X.hitLoose(f.r,f.b)===false);
  const g=mk(-0.7,17);ok('...nor one beyond the last man (nobody to send it to)',X.hitLoose(g.r,g.b)===false);
  const h=mk(-0.7,6);X.setOut(()=>9);ok('...nor one a shot is open to (the kick takes it)',X.hitLoose(h.r,h.b)===false);
  const i=mk(-0.7,6);X.setOut(()=>-9);ok('...nor with every lane shut',X.hitLoose(i.r,i.b)===false);
  const j=mk(0.5,6);ok('...nor a ball at a depth in the dead zone',X.hitLoose(j.r,j.b)===false);
  const k=mk(-0.7,6,{role:'GK'});ok('...not the keeper',X.hitLoose(k.r,k.b)===false);
  LS.on=false;const l=mk(-0.7,6);ok('...and with the switch off none',X.hitLoose(l.r,l.b)===false);LS.on=true;
  HT.on=false;const m=mk(-0.7,6);ok('...nor with the hit off',X.hitLoose(m.r,m.b)===false);HT.on=true;
  const n=mk(-0.7,6,{iq:false});n.r.aiIQ=false;ok('a rod whose iq roll is off still does (taking a loose ball is for every rod)',X.catchPick(n.r,n.b)==='hit');
  const o=mk(-0.7,-6);X.setOut((r,bx,bz)=>bz<-8?9:-9);ok('...a ball between the other two men goes the other way when that is where the lane is',X.hitLoose(o.r,o.b)===true&&o.r.tapS===-1&&o.r.tapJ===0&&o.r.hMan===1,'s='+o.r.tapS+' j='+o.r.tapJ);
  X.setOut(null);}
 return R;
}

let bad=0,total=0;
const base=suite(boot()),baseFail=new Set(base.filter(t=>!t.ok).map(t=>t.name));
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'the angle ignores the depth',part:'catch',from:'return bs<=AIC.catch.hit.fit?best:null;',to:'return 0;'},
 {n:'the fit is ignored',part:'catch',from:'return bs<=AIC.catch.hit.fit?best:null;',to:'return best;'},
 {n:'the angle search stops short',part:'catch',from:'for(let a=-1.3;a<=1.3;a+=0.02){',to:'for(let a=-0.3;a<=0.3;a+=0.02){'},
 {n:'the man runs at it from the near side',part:'catch',from:'return bz-s*(FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad+HT.runUp)-r.baseZ[mi];',to:'return bz+s*(FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad+HT.runUp)-r.baseZ[mi];'},
 {n:'there is no run-up',part:'catch',from:'AIC.clearMargin+HT.pad+HT.runUp)-r.baseZ[mi];',to:'AIC.clearMargin+HT.pad)-r.baseZ[mi];'},
 {n:'the room to run on is not asked',part:'catch',from:'return Math.abs(o0)<=r.maxOff&&Math.abs(o1)<=r.maxOff&&',to:'return Math.abs(o0)<=r.maxOff&&'},
 {n:'the room to step off is not asked',part:'catch',from:'return Math.abs(o0)<=r.maxOff&&Math.abs(o1)<=r.maxOff&&',to:'return Math.abs(o1)<=r.maxOff&&'},
 {n:'the neighbour may stand on the ball',part:'catch',from:'(r.baseZ[j]+o0-bz)*s>=cz+HT.jGap;',to:'true;'},
 {n:'the neighbour\'s clearance is read from the wrong end',part:'catch',from:'(r.baseZ[j]+o0-bz)*s>=cz+HT.jGap;',to:'(r.baseZ[j]-bz)*s>=cz+HT.jGap;'},
 {n:'every role hits',part:'catch',from:'if(!HT||!HT.on||HT.roles.indexOf(r.role)<0)return false;\n const p=b.m.position',to:'if(!HT||!HT.on)return false;\n const p=b.m.position'},
 {n:'the switch is ignored',part:'catch',from:'if(!HT||!HT.on||HT.roles.indexOf(r.role)<0)return false;\n const p=b.m.position',to:'if(!HT||HT.roles.indexOf(r.role)<0)return false;\n const p=b.m.position'},
 {n:'the bands are ignored',part:'catch',from:'if(!ok||hitAngle(rel)==null||!hitFits(r,mi,r.tapJ,s,p.z))return false;',to:'if(hitAngle(rel)==null||!hitFits(r,mi,r.tapJ,s,p.z))return false;'},
 {n:'a ball the foot cannot square onto is hit',part:'catch',from:'if(!ok||hitAngle(rel)==null||',to:'if(!ok||'},
 {n:'the room is not asked of a held ball',part:'catch',from:'if(!ok||hitAngle(rel)==null||!hitFits(r,mi,r.tapJ,s,p.z))return false;',to:'if(!ok||hitAngle(rel)==null)return false;'},
 {n:'a flush ball under a forward leg is hit whatever the lift',part:'catch',from:'if(r.angle*r.kickDir>CA.recv.fwdMin&&rel<CA.side.aheadMin&&!CA.recv.lift.on)return false;',to:''},
 {n:'every tap is a hit',part:'catch',from:'return rngAi(r.idx)()<HT.share;\n}\nfunction hitStart',to:'return true;\n}\nfunction hitStart'},
 {n:'no tap is a hit',part:'catch',from:'return rngAi(r.idx)()<HT.share;\n}\nfunction hitStart',to:'return false;\n}\nfunction hitStart'},
 {n:'a hit is not started from a tap',part:'catch',from:'if(b&&hitOk(r,b)){hitStart(r,b);return;}',to:''},
 {n:'a hit is not counted',part:'catch',from:'r.tapHit=true;CAS.hit++;\n if(',to:'r.tapHit=true;\n if('},
 {n:'a ball flush under a forward leg is let go in place',part:'catch',from:'if(r.angle*r.kickDir>CA.recv.fwdMin&&!r.hAhead){fliftStart(r,\'hit\');return;}',to:''},
 {n:'a deep ball is not marked deep',part:'catch',from:'r.hDeep=b.pinDx<CA.side.back;r.hAhead',to:'r.hDeep=false;r.hAhead'},
 {n:'a ball lying ahead is not marked ahead',part:'catch',from:'r.hAhead=b.pinDx>CA.side.aheadMin;r.tapHit=true;CAS.hit++;',to:'r.hAhead=false;r.tapHit=true;CAS.hit++;'},
 {n:'the lift does not hand over to the hit',part:'catch',from:"else if(r.flNext==='hit')hitGo(r);",to:''},
 {n:'the hit does not step off first',part:'catch',from:"function hitGo(r){r.catPh='hit';r.hPh='clear';",to:"function hitGo(r){r.catPh='hit';r.hPh='aim';"},
 {n:'the hit is routed after the pin hold',part:'catch',from:" if(r.catPh==='hit'){hitStep(r,best);return;}\n if(r.pinB){",to:" if(r.pinB){"},
 {n:'the ball is let go while the rod slides',part:'catch',from:'if(Math.abs(r.slideV)>HT.restV&&r.hT<HT.restT)return;',to:''},
 {n:'it waits for the slide for ever',part:'catch',from:'if(Math.abs(r.slideV)>HT.restV&&r.hT<HT.restT)return;',to:'if(Math.abs(r.slideV)>HT.restV)return;'},
 {n:'the ball is not let go',part:'catch',from:'pinRelease(r);r.hPh=\'clear\';',to:'r.hPh=\'clear\';'},
 {n:'the pin stays on while the man steps off',part:'catch',from:' r.pinOn=false;r.pinPose=true;                                     // the leg holds where it is until it is turned',to:' r.pinOn=true;r.pinPose=true;'},
 {n:'the man steps off toward the neighbour',part:'catch',from:'r.target=oc;\n  if(gap<cz)return;',to:'r.target=r.offset+r.tapS*3;\n  if(gap<cz)return;'},
 {n:'it turns the leg before it is clear',part:'catch',from:'  if(gap<cz)return;',to:''},
 {n:'it never turns the leg',part:'catch',from:'  r.hPh=\'aim\';r.hT=0;\n }',to:'  r.hPh=\'run\';r.hT=0;\n }'},
 {n:'a ball it cannot square onto does not end it',part:'catch',from:"if(r.hA==null){catchEnd(r,CA.cd,'hit:reach');return;}",to:''},
 {n:'the leg turns to the wrong angle',part:'catch',from:'r.pinA=r.hA*dir;r.target=oc;',to:'r.pinA=0;r.target=oc;'},
 {n:'it does not wait for the leg',part:'catch',from:'(Math.abs(r.angle-r.pinA)>HT.tolA||',to:'(false||'},
 {n:'it does not wait for the leg to stop turning',part:'catch',from:'Math.abs(r.angVel)>HT.tolW||',to:''},
 {n:'it does not wait to be where it runs from',part:'catch',from:'Math.abs(r.offset-oc)>HT.tolZ||',to:''},
 {n:'it does not wait for the slide to die before the run',part:'catch',from:'||Math.abs(r.slideV)>HT.restV)&&r.hT<HT.aimT)return;',to:')&&r.hT<HT.aimT)return;'},
 {n:'it waits for the leg for ever',part:'catch',from:'&&r.hT<HT.aimT)return;',to:')return;'},
 {n:'the run does not go toward the neighbour',part:'catch',from:'r.target=clamp(r.offset+s*HT.runV*dt,-r.maxOff,r.maxOff);',to:'r.target=clamp(r.offset-s*HT.runV*dt,-r.maxOff,r.maxOff);'},
 {n:'the run is not at the run speed',part:'catch',from:'r.target=clamp(r.offset+s*HT.runV*dt,-r.maxOff,r.maxOff);',to:'r.target=clamp(r.offset+s*HT.runV*dt*9,-r.maxOff,r.maxOff);'},
 {n:'a ball that moves anywhere is a hit',part:'catch',from:'if(gap<=FOOT_BOX.z+BALL_R+HT.contact&&rb.v.z*s>HT.hitV){',to:'if(rb.v.z*s>HT.hitV){'},
 {n:'a ball that is touched but not moving is a hit',part:'catch',from:'if(gap<=FOOT_BOX.z+BALL_R+HT.contact&&rb.v.z*s>HT.hitV){',to:'if(gap<=FOOT_BOX.z+BALL_R+HT.contact){'},
 {n:'the hit is not counted when it lands',part:'catch',from:'CAS.hitHit++;',to:''},
 {n:'a run that misses never ends',part:'catch',from:"else{if(r.hT>HT.runT)catchEnd(r,CA.cd,'hit:miss');return;}",to:'else return;'},
 {n:'the rod does not brake once it has hit it',part:'catch',from:' r.pinA=r.hA*dir;r.target=r.offset;                                // out: the rod brakes and the ball leaves',to:' r.pinA=r.hA*dir;r.target=r.offset+r.tapS*9;'},
 {n:'it hands over before the ball is clear',part:'catch',from:'if(gap>=cz+HT.clearOut||r.hT>HT.outT){',to:'if(true){'},
 {n:'it never hands over',part:'catch',from:'if(gap>=cz+HT.clearOut||r.hT>HT.outT){',to:'if(false){'},
 {n:'a ball that did not leave is sent',part:'catch',from:"if(rb.v.z*s<HT.hitV*0.5){catchEnd(r,CA.cd,'hit:stuck');return;}",to:''},
 {n:'the receiver is told nothing of how it lies',part:'catch',from:'r.tapAhead=r.hAhead;CAS.hitSent++;tapSide(r,r.hDeep);',to:'CAS.hitSent++;tapSide(r,r.hDeep);'},
 {n:'the receiver is told nothing of the depth',part:'catch',from:'r.tapAhead=r.hAhead;CAS.hitSent++;tapSide(r,r.hDeep);',to:'r.tapAhead=r.hAhead;CAS.hitSent++;tapSide(r,false);'},
 {n:'a sent hit is not counted',part:'catch',from:'CAS.hitSent++;tapSide',to:'tapSide'},
 {n:'a ball that scores does not end it',part:'catch',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';\n else if(r.hPh===",to:"if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';\n else if(r.hPh==="},
 {n:'a lifted ball does not end it',part:'catch',from:"else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';\n else if(r.hPh===",to:"else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';\n else if(r.hPh==="},
 {n:'the dead-ball push does not end it',part:'catch',from:"else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';\n else if(r.hPh===",to:"else if(r.catT>HT.abortT)why='time';\n else if(r.hPh==="},
 {n:'the hit never times out',part:'catch',from:"else if(r.catT>HT.abortT)why='time';\n else if(r.hPh===",to:"\n else if(r.hPh==="},
 {n:'a ball knocked loose before it is let go does not end it',part:'catch',from:"else if(r.hPh==='rest'&&!r.pinB)why='lost';",to:''},
 {n:'a ball that rolls off while the man steps off does not end it',part:'catch',from:"(r.hPh==='clear'||r.hPh==='aim')&&(sp>HT.bailV||rel<lo||rel>hi))why='moved';",to:"false)why='moved';"},
 {n:'the run counts the ball moving as moved',part:'catch',from:"(r.hPh==='clear'||r.hPh==='aim')&&(sp>HT.bailV||rel<lo||rel>hi))why='moved';",to:"(sp>HT.bailV||rel<lo||rel>hi))why='moved';"},
 {n:'no room does not end it',part:'catch',from:"Math.abs(hitStand(r,mi,p.z,s))>r.maxOff)why='room';",to:"false)why='room';"},
 {n:'ending leaves the hit\'s state up',part:'catch',from:'r.rvRestT=0;r.hPh=null;r.tapHit=false;',to:'r.rvRestT=0;'},
 {n:'a landing is not counted as a hit',part:'catch',from:'if(r.tapHit){CAS.hitOk++;r.tapHit=false;}',to:''},
 {n:'a loose ball is knocked by every role',part:'catch',from:'if(!HT.on||!LS||!LS.on||HT.roles.indexOf(r.role)<0||',to:'if(!HT.on||!LS||!LS.on||'},
 {n:'the loose switch is ignored',part:'catch',from:'if(!HT.on||!LS||!LS.on||HT.roles',to:'if(!HT.on||!LS||HT.roles'},
 {n:'a rolling ball is knocked',part:'catch',from:'||rb.v.length()>LS.maxV)return false;',to:')return false;'},
 {n:'a ball in the air is knocked',part:'catch',from:'(r.htT||0)>S.time||p.y>=AIC.lowY||rb.v.length()>LS.maxV',to:'(r.htT||0)>S.time||rb.v.length()>LS.maxV'},
 {n:'a ball a man is on is knocked',part:'catch',from:'if(Math.abs(p.z-z)<cz)return false;',to:''},
 {n:'a row with a man gone is trusted',part:'catch',from:"if(!manLive(r,i))return false;                                    // a man gone",to:"if(!manLive(r,i))continue;                                    // a man gone"},
 {n:'a shot open where it lies is not the kick\'s',part:'catch',from:'if(pinOutlet(r,p.x,p.z,obs,gx,0)>=CA.lineClear)return false;       // a shot is open where it lies: that is the kick\'s',to:''},
 {n:'a lane that is shut will do',part:'catch',from:'if(out>=CA.lineClear&&(!bs||out>bs.out))bs={mi,j,s,out};',to:'if(!bs||out>bs.out)bs={mi,j,s,out};'},
 {n:'the lane is judged at the wrong end',part:'catch',from:'const out=pinOutlet(r,p.x,clamp(r.baseZ[j]+hitStand(r,mi,p.z,s)+s*CA.tap.drift,-zl,zl),obs,gx,0);',to:'const out=pinOutlet(r,p.x,p.z,obs,gx,0);'},
 {n:'the sender is the man on the wrong side',part:'catch',from:'const mi=s>0?lo:lo+1,j=mi+s;',to:'const mi=s>0?lo+1:lo,j=mi+s;'},
 {n:'it decides every frame',part:'catch',from:'r.htT=S.time+LS.every;\n if(rngAi(r.idx)()>=LS.share)return false;',to:'if(rngAi(r.idx)()>=LS.share)return false;'},
 {n:'it never takes its chance',part:'catch',from:'if(rngAi(r.idx)()>=LS.share)return false;',to:'return false;'},
 {n:'it always takes its chance',part:'catch',from:'if(rngAi(r.idx)()>=LS.share)return false;',to:''},
 {n:'a loose hit does not start by stepping off',part:'catch',from:"r.tapHit=true;r.hPh='clear';r.hT=0;",to:"r.tapHit=true;r.hPh='rest';r.hT=0;"},
 {n:'a loose hit is not counted',part:'catch',from:'CAS.hitLoose++;',to:''},
 {n:'the loose hit is taken after the iq gate',part:'catch',from:" if(hitLoose(r,best))return 'hit';                                  // a ball lying between two men is knocked to the one with the lane\n if(!smart)return fetchPick(r,best)?'fetch':null;",to:" if(!smart)return fetchPick(r,best)?'fetch':null;"}
];
let caught=0;
for(const m of MUT){
 let res;
 try{res=suite(boot(m));}catch(e){
  if(/no-op/.test(e.message)){console.log('  MISSED  (THREW '+e.message+')  '+m.n);continue;}
  caught++;console.log('  caught  (threw)  '+m.n);continue;}
 const fails=res.filter(t=>!t.ok&&!baseFail.has(t.name));
 if(fails.length){caught++;console.log('  caught  ('+fails.length+' assertions)  '+m.n);}
 else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
