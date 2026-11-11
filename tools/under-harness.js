// under harness. node tools/under-harness.js
// a slow ball under a forward leg that the pin did not take (CONFIG.ai.catch.under): no AI swing sets off backward through it (kickBack, on the real foot box), and the rod takes it:
// the leg goes on up, then fetch slides the man over it and lowers the leg onto it, or (too near the rod for a pin from above, or tried already) the man steps off its line and the leg comes down beside it
// slices the real foot-box geometry, kickBack / legBack and the catch block (ai.js) with pinUpdate (physics.js) and runs them against live CONFIG with bare-bones rods; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js'),PHYS=rd('js/physics.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 geo:slice(AI,'const _fb={nx:0,ny:0,cwx:0,cwy:0};',NL+'// --- strike gate ---'),
 lane:slice(AI,'function laneObs(team,bx,tx,v0){',NL+'// gap-aware shot evaluation'),
 fwd:slice(AI,'function fwdClr(team,bx,bz,sl,v0){',NL+'// how good is the way forward from'),
 ret:slice(AI,'function retrieveMan(r,bz){',NL+'function retrievePhase('),
 clr:slice(AI,'function clearOffset(r,bz,cz,prefer){',NL+'// z of the live foot nearest'),
 lz:slice(AI,'function inLaneZ(r,lz,cz){',NL+'// the teammate behind us'),
 catch:slice(AI,'// --- catch (CONFIG.ai.catch) ---',NL+'// the passive raise:'),
 phys:slice(PHYS,'function pinUpdate(){',NL+'// ================= contact AUDIO gating')
};
const stubs=[
 "var S={balls:[],time:0}; var rods=[];",
 "var KICKS=[];",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;KICKS.push({style:style,aim:aim||null});}",
 "function strikeOn(){return true;} function passPick(){return null;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "var BGS={retEnter:0}; function retrievePhase(r,ph){r.retPh=ph;} function isUserRod(){return false;}",
 "function rngAi(){return function(){return 0.99;};}",
 "function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 "function V(x,y,z){return {x:x||0,y:y||0,z:z||0,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}};}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.geo,g.lane,g.fwd,g.ret,g.clr,g.lz,g.phys,g.catch,
  ';globalThis.X={S:S,AIC:AIC,SHOT:SHOT,KICK:KICK,F:F,BALL_R:BALL_R,FOOT_BOX:FOOT_BOX,rods:rods,KICKS:KICKS,CAS:CAS,CAW:CAW,V:V,kickBack:kickBack,legBack:legBack,underPick:underPick,underStep:underStep,catchStep:catchStep,catchEnd:catchEnd,footAngle:footAngle,inLaneZ:inLaneZ};'].join(NL),ctx);
 return ctx.X;
}

const D={cd:1};
// the red ATT (x 22.5, attacking +x), three men 12 apart, or the blue one mirrored at -22.5; a = the leg's rod-local angle (dir-relative)
function world(X,opt){
 opt=opt||{};
 X.S.time=10;X.S.balls=[];X.KICKS.length=0;
 const dir=opt.blue?-1:1,a=opt.a==null?0.9:opt.a;
 const r={x:22.5*dir,team:opt.blue?1:0,kickDir:dir,role:'ATT',aiIQ:true,baseZ:[-12,0,12],maxOff:9,removedUntil:[0,0,0],offset:0,target:0,slideV:0,vz:0,angle:a*dir,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,pinFwd:false,act:'catch',catPh:'under',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,ftPh:null,ftT:0,unPh:null,unT:-9,unCd:0};
 X.rods.length=0;X.rods.push(r);
 return r;
}
function ball(X,r,rel,z,vx,vz,y){const b={scored:false,pinR:null,m:{position:X.V(r.x+r.kickDir*rel,y==null?X.BALL_R:y,z)},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);},set(a,b2,c){this.x=a;this.y=b2;this.z=c;return this;}},spin:0};b.real=b;X.S.balls.push(b);return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,U=CA.under,FE=CA.fetch,RV=CA.recv,P=X.SHOT.pin,PS=X.AIC.passShot;
 // ---- the swing guard ----
 {const r=world(X),b=ball(X,r,2.95,0);
  ok('a plain swing from the receive pose sets off back through the ball the leg stopped',X.kickBack(r,b)===true);
  const r2=world(X),b2=ball(X,r2,2.95,1.6);ok('...and through one the leg stopped off the man\'s line',X.kickBack(r2,b2)===true);
  const r3=world(X,{a:0}),b3=ball(X,r3,2.95,0);ok('...not from rest: the swing goes forward',X.kickBack(r3,b3)===false);
  const r4=world(X,{a:0.6}),b4=ball(X,r4,1.5,0);ok('...nor from a leg short of the strike angle, for the plain kick; the pass (its wind-up goes back) is',X.kickBack(r4,b4)===false&&X.kickBack(r4,b4,PS)===true);
  const r5=world(X),b5=ball(X,r5,2.95,6);ok('...nor with the ball clear of every man',X.kickBack(r5,b5)===false);
  const r6=world(X),b6=ball(X,r6,12,0);ok('...nor with the ball far out ahead',X.kickBack(r6,b6)===false);
  const r7=world(X,{blue:true}),b7=ball(X,r7,2.95,0);ok('...the blue rod, mirrored, the same',X.kickBack(r7,b7)===true);
  const r8=world(X,{a:0.1}),b8=ball(X,r8,-1.0,0);ok('a pass from a leg barely off rest is not guarded (its wind-up is the curve\'s own business)',X.kickBack(r8,b8,PS)===false);
  const r9=world(X,{a:1.15}),b9=ball(X,r9,6.0,1.6);ok('a swing from a leg raised forward that only clips a ball beside the toe is refused too (that quick, the clip knocks it back)',X.kickBack(r9,b9)===true&&X.legBack(r9,b9,X.KICK.strikeA)===false);
  for(const blue of [false,true]){const q=world(X,{blue,a:0.5}),bq=ball(X,q,-4,0);ok('turning a leg back to rest does not reach a ball lying behind the heel'+(blue?' (blue)':''),X.legBack(q,bq,0)===false);}}
 // ---- which balls are taken ----
 {const r=world(X),b=ball(X,r,2.95,1.6);
  ok('a slow ball under a forward leg it cannot come down past is taken',X.underPick(r,b)===true);
  b.pinR=r;ok('...not one a rod holds',X.underPick(r,b)===false);b.pinR=null;
  b.v.x=U.maxV+2;ok('...nor a quick one',X.underPick(r,b)===false);b.v.x=0;
  b.m.position.y=X.AIC.lowY+1;ok('...nor one in the air',X.underPick(r,b)===false);b.m.position.y=X.BALL_R;
  r.angle=U.minA-0.1;ok('...nor under a leg barely forward',X.underPick(r,b)===false);r.angle=0.9;
  r.unCd=X.S.time+0.5;ok('...nor just after the last one ended',X.underPick(r,b)===false);r.unCd=0;
  U.on=false;ok('...nor with it switched off',X.underPick(r,b)===false);U.on=true;
  const r2=world(X),b2=ball(X,r2,2.95,6);ok('...nor one the leg can come down past',X.underPick(r2,b2)===false);
  const r3=world(X),b3=ball(X,r3,-1.5,0);ok('...nor one behind the rod',X.underPick(r3,b3)===false);
  const r4=world(X,{blue:true}),b4=ball(X,r4,2.95,1.6);ok('...the blue rod, mirrored, the same',X.underPick(r4,b4)===true);}
 // ---- the play ----
 {const r=world(X),b=ball(X,r,3.0,1.6);
  X.catchStep(r,b,D);
  ok('the leg goes on up and forward first, the man where he is',r.act==='catch'&&r.catPh==='under'&&r.unPh==='up'&&r.pinOn&&r.pinPose&&Math.abs(r.pinA-RV.lift.angle)<1e-9&&r.target===r.offset);
  const n0=X.CAS.underFetch;r.angle=RV.lift.angle;X.underStep(r,b);
  ok('...once up, a ball a pin from above reaches is fetch\'s: the man slides over it',r.catPh==='fetch'&&r.ftPh==='over'&&X.CAS.underFetch===n0+1&&Math.abs(r.target-1.6)<0.01,'tgt='+r.target);
  ok('...and the try is stamped',r.unT===X.S.time);}
 {const r=world(X),b=ball(X,r,3.0,1.6);r.catT=FE.downT+0.01;X.underStep(r,b);
  ok('a leg that never gets up is not waited for',r.unPh!=='up');}
 {const r=world(X),b=ball(X,r,3.0,1.6);r.unT=X.S.time-U.retryT/2;r.angle=RV.lift.angle;X.underStep(r,b);
  const cz=X.FOOT_BOX.z+X.BALL_R+X.AIC.clearMargin+FE.clearPad;
  ok('a rod whose fetch from here just failed steps off the ball\'s line instead, the leg still up',r.catPh==='under'&&r.unPh==='off'&&r.pinOn&&Math.abs(1.6-r.target)>=cz-1e-6,'tgt='+r.target);
  r.offset=r.target;X.underStep(r,b);
  ok('...once clear the leg comes down beside it, the man still',r.unPh==='down'&&!r.pinOn&&!r.pinPose&&r.pinA===null&&r.target===r.offset&&r.act==='catch');
  X.underStep(r,b);ok('...and it waits for the leg',r.act==='catch');
  const n0=X.CAW['under:off']||0;r.angle=0.05;X.underStep(r,b);
  ok('...then lets go, and is not picked again for a while',r.act===null&&(X.CAW['under:off']||0)===n0+1&&r.unCd>X.S.time);}
 {const r=world(X),b=ball(X,r,3.0,1.6);r.unT=X.S.time-U.retryT/2;r.angle=RV.lift.angle;X.underStep(r,b);r.offset=r.target;X.underStep(r,b);
  r.catT+=FE.downWait+0.01;X.underStep(r,b);ok('...a leg that never comes down is not waited for',r.act===null);}
 {const r=world(X),b=ball(X,r,2.55,1.6);r.angle=RV.lift.angle;X.underStep(r,b);
  ok('a ball nearer the rod than the pin reaches is stepped off, not fetched',r.catPh==='under'&&r.unPh==='off');}
 {const mk=f=>{const r=world(X),b=ball(X,r,3.0,1.6);f(r,b);X.underStep(r,b);return r;};
  ok('a ball that has moved off ends it',mk((r,b)=>{b.v.x=FE.bailV+1;}).act===null);
  ok('...and so does the clock',mk(r=>{r.catT=U.abortT+0.1;}).act===null);
  ok('...and the whistle',mk(r=>{r.force=true;}).act===null);
  ok('...and a ball in the air',mk((r,b)=>{b.m.position.y=X.AIC.lowY+1;}).act===null);}
 {const r=world(X);r.catPh='fetch';X.catchEnd(r,1,'x');ok('another catch ending does not lock this one out',!r.unCd);}
 return R;
}

const base=suite(boot());
let bad=0;for(const t of base){if(!t.ok)bad++;console.log((t.ok?'  ok    ':'  FAIL  ')+t.name+(t.ok||!t.info?'':'   ['+t.info+']'));}
console.log('  '+(base.length-bad)+' passed, '+bad+' failed');
const MUT=[
 {n:'the swing guard reads the world angle',part:'geo',from:'a=r.angle*r.kickDir,bb=b.real||b;',to:'a=r.angle,bb=b.real||b;'},
 {n:'the pass curve\'s wind-up is not counted',part:'geo',from:'t=KS.windup>0?KS.windupA:KS.strikeA',to:'t=KS.strikeA'},
 {n:'a leg barely off rest is guarded',part:'geo',from:'if(a<=AIC.catch.recv.fwdMin||a<=t)return false;',to:'if(a<=t)return false;'},
 {n:'a side clip is not counted',part:'geo',from:'for(let x=a;x>t;x-=0.1)if(footHolds(r,bb,x*r.kickDir))return true;',to:''},
 {n:'the guard never refuses',part:'geo',from:'if(legBack(r,bb,t))return true;',to:'return false;'},
 {n:'the leg\'s walk back reads the world angle',part:'geo',from:'Math.max(a1,a-0.15)*dir',to:'Math.max(a1,a-0.15)'},
 {n:'a held ball is taken',part:'catch',from:'rb.scored||rb.pinR||(r.unCd',to:'rb.scored||(r.unCd'},
 {n:'it is picked again at once',part:'catch',from:'(r.unCd||0)>S.time||r.angle',to:'r.angle'},
 {n:'the pick reads the world angle',part:'catch',from:'r.angle*r.kickDir<U.minA',to:'r.angle<U.minA'},
 {n:'a ball in the air is taken',part:'catch',from:'||p.y>AIC.lowY||rb.v.length()>U.maxV',to:'||rb.v.length()>U.maxV'},
 {n:'a quick ball is taken',part:'catch',from:'||rb.v.length()>U.maxV||rel<0',to:'||rel<0'},
 {n:'a ball behind the rod is taken',part:'catch',from:'||rel<0||rel>SHOT.pin.fwdFront)return false;\n return legBack',to:'||rel>SHOT.pin.fwdFront)return false;\n return legBack'},
 {n:'any ball near a forward leg is taken',part:'catch',from:' return legBack(r,rb,0);',to:' return true;'},
 {n:'the switch does nothing',part:'catch',from:'if(!U||!U.on||rb.scored',to:'if(!U||rb.scored'},
 {n:'the leg is not lifted first',part:'catch',from:'  if(r.angle*dir<RV.lift.angle-FE.upTol&&r.catT<FE.downT)return;\n  if(S.time-(r.unT',to:'  if(S.time-(r.unT'},
 {n:'the lift is waited for for ever',part:'catch',from:'  if(r.angle*dir<RV.lift.angle-FE.upTol&&r.catT<FE.downT)return;\n  if(S.time-(r.unT',to:'  if(r.angle*dir<RV.lift.angle-FE.upTol)return;\n  if(S.time-(r.unT'},
 {n:'a failed fetch is tried again at once',part:'catch',from:'if(S.time-(r.unT||-9)>=U.retryT&&rel',to:'if(rel'},
 {n:'a ball nearer than the pin reaches is fetched',part:'catch',from:'&&rel>=SHOT.pin.fwdBack&&rel<=FE.far&&footAngle',to:'&&rel<=FE.far&&footAngle'},
 {n:'the try is not stamped',part:'catch',from:'r.unT=S.time;r.unPh=null;r.catPh=\'fetch\'',to:'r.unPh=null;r.catPh=\'fetch\''},
 {n:'fetch is handed the wrong phase',part:'catch',from:"r.catPh='fetch';r.ftPh='over';",to:"r.catPh='fetch';r.ftPh=null;"},
 {n:'the man does not step off',part:'catch',from:'if(o!=null){r.target=o;return;}}\n  r.unPh=\'down\'',to:'if(o!=null){return;}}\n  r.unPh=\'down\''},
 {n:'the leg comes down with him still on its line',part:'catch',from:'  if(inLaneZ(r,bz,cz)){const o=clearOffset(r,bz,cz,0);if(o!=null){r.target=o;return;}}\n  r.unPh=\'down\'',to:'  r.unPh=\'down\''},
 {n:'the leg stays up when it should come down',part:'catch',from:' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.target=r.offset;\n if(r.angle*dir>FE.downA&&r.catT-r.unD',to:' r.target=r.offset;\n if(r.angle*dir>FE.downA&&r.catT-r.unD'},
 {n:'it lets go before the leg is down',part:'catch',from:' if(r.angle*dir>FE.downA&&r.catT-r.unD<FE.downWait)return;\n CAS.underOff',to:' CAS.underOff'},
 {n:'it waits for the leg for ever',part:'catch',from:'if(r.angle*dir>FE.downA&&r.catT-r.unD<FE.downWait)return;',to:'if(r.angle*dir>FE.downA)return;'},
 {n:'no lockout after it ends',part:'catch',from:" if(r.catPh==='under')r.unCd=S.time+AIC.catch.under.cd;",to:''},
 {n:'every catch end locks it out',part:'catch',from:" if(r.catPh==='under')r.unCd=",to:" r.unCd="},
 {n:'a moved ball does not end it',part:'catch',from:"else if(rb.v.length()>FE.bailV)why='moved';else if(r.catT>U.abortT)",to:"else if(r.catT>U.abortT)"},
 {n:'it never times out',part:'catch',from:"else if(r.catT>U.abortT)why='time';\n if(why){catchEnd(r,CA.cd,'under:'",to:"\n if(why){catchEnd(r,CA.cd,'under:'"},
 {n:'the whistle does not end it',part:'catch',from:"why='lifted';else if(r.force)why='force';else if(rb.v.length()>FE.bailV)why='moved';else if(r.catT>U.abortT)",to:"why='lifted';else if(rb.v.length()>FE.bailV)why='moved';else if(r.catT>U.abortT)"},
 {n:'a lifted ball does not end it',part:'catch',from:"else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(rb.v.length()>FE.bailV)why='moved';else if(r.catT>U.abortT)",to:"else if(r.force)why='force';else if(rb.v.length()>FE.bailV)why='moved';else if(r.catT>U.abortT)"},
 {n:'the catch never runs it',part:'catch',from:" if(r.catPh==='under'){underStep(r,best);return;}",to:''}
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
