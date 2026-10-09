// tap-back harness (the receiving man's lane shuts, the ball goes back). node tools/back-harness.js
// slices the real catch block (backEval / backStep / sideStep's decision / catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: while a tap is rolling to its man, does the rod notice his lane has shut and the man it came from has one open where the ball would come back to (and only then, and only with time for the
// men to go down), put the men down, slide the man into the ball as it arrives, and hand the ball that bounces back to the man it came from as a side catch; each mutation must break an assertion
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
 "var S={balls:[],time:0}; var rods=[];",
 "var RELEASED=0,STRIKE=true,SWEEP=false,PICK=null;",
 "function pinRelease(r){r.pinB=null;RELEASED++;}",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;}",
 "function strikeOn(){return STRIKE;} function sweepClips(){return SWEEP;} function passPick(){return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,F:F,BALL_R:BALL_R,ARM:ARM,FOOT_BOX_OFF:FOOT_BOX_OFF,rods:rods,CAS:CAS,CAW:CAW,pinOutlet:pinOutlet,backEval:backEval,backStep:backStep,catchStep:catchStep,catchEnd:catchEnd};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120,D0={cd:1};
const SP=[-10,0,10];
// the red ATT (x 22.5, attacking +x), three men 10 apart at offset 5 (men at -5 / 5 / 15); a tap from man 0 to man 1 is on its way. Blue's DEF and keeper are where the lanes are judged
function world(X,over,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];for(const k in X.CAW)delete X.CAW[k];for(const k in X.CAS)X.CAS[k]=0;
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:'ATT',aiIQ:true,baseZ:SP,maxOff:9,removedUntil:[],offset:5,target:5,slideV:0,angle:0,raise:true,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:'catch',catPh:'side',catT:0.1,catMan:1,catSg:1,catCush:false,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0,
  tapPend:true,tapN:1,tbEv:0,bkRev:false},over||{});
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:[0,24],offset:opt.defOff!=null?opt.defOff:20,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff!=null?opt.gkOff:20,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,zOff,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?1.9:y,z:zOff}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,TP=CA.tap,TB=TP.back,goalX=X.F.L/2,drift=TP.drift,lc=CA.lineClear;
 const keep=JSON.stringify(TB),restore=()=>{const k=JSON.parse(keep);for(const x in k)TB[x]=k[x];};
 const out=(r,z,blockers)=>X.pinOutlet(r,22.5-0.7,z,blockers,goalX,0);
 // the geometry: sender man 0 at -5, receiver man 1 at +5, both inside the mouth (a lane at +-7 is open, one further out is not); the ball is rolling +z at vb, TB.clear off the sender
 const zI=-5,zJ=5,vb=10,pz=zI+TB.clear+0.1;
 // blockers: the receiver's lane shut where he will have drifted to (zJ + drift), the sender's open where it would come back to (zI - drift)
 const shutJ=[{x:37.5,z:zJ+drift}],shutBoth=[{x:37.5,z:zJ+drift},{x:37.5,z:zI-drift}],open=[];
 const ev=(over,obs,z)=>{const r=world(X,over);return X.backEval(r,{x:22.5-0.7,z:z==null?pz:z},obs,goalX);};
 {const r=world(X);ok('(the set-up) the receiver\'s lane is shut and the sender\'s open',out(r,zJ+drift,shutJ)<lc&&out(r,zI-drift,shutJ)>=lc,out(r,zJ+drift,shutJ).toFixed(2)+' / '+out(r,zI-drift,shutJ).toFixed(2));}

 // ---- when it goes back ----
 ok('the receiver\'s lane shut and the sender\'s open: it goes back',ev(null,shutJ)===true);
 ok('...not when the receiver\'s lane is still open',ev(null,open)===false);
 ok('...not when the sender\'s lane is shut too',ev(null,shutBoth)===false);
 {const lo=[{x:37.5,z:zJ+drift+4.5}];const r=world(X);ok('(the set-up) a blocker that shuts the receiver\'s lane only where he will have drifted to',out(r,zJ+drift,lo)<lc&&out(r,zJ,lo)>=lc&&out(r,zI-drift,lo)>=lc);
   ok('the receiver\'s lane is judged where he will have drifted to, not where he stands',ev(null,lo)===true);}
 {const lo=[{x:37.5,z:zJ+drift},{x:37.5,z:zI-drift-4.5}];const r=world(X);ok('(the set-up) a blocker that shuts the sender\'s lane only where he will have drifted back to',out(r,zI-drift,lo)<lc&&out(r,zI,lo)>=lc&&out(r,zI+drift,lo)>=lc);
   ok('the sender\'s lane is judged where he will have drifted back to (the way it came)',ev(null,lo)===false);}
 {ok('not with nobody to go back to (the receiver is the end of the row)',ev({catMan:0,catSg:1},shutJ)===false);}
 {ok('...either way along the row (the ball rolling -z from man 1 to man 0)',ev({catMan:0,catSg:-1},[{x:37.5,z:zI-drift}],zJ-TB.clear-0.1)===true);}
 {ok('not to a man a cannonball took',ev({removedUntil:[1e9,0,0]},shutJ)===false);}
 {ok('not while the ball is still on top of the man it left',ev(null,shutJ,zI+TB.clear-0.1)===false&&ev(null,shutJ,zI+TB.clear+0.1)===true);}
 {const room=TP.room;ok('not with no slide left to run the other way (the ball rolling -z, so back is +z: maxOff - offset)',ev({catMan:0,catSg:-1,maxOff:5+room-0.5},[{x:37.5,z:zI-drift}],zJ-TB.clear-0.1)===false&&ev({catMan:0,catSg:-1,maxOff:5+room+0.5},[{x:37.5,z:zI-drift}],zJ-TB.clear-0.1)===true);}
 {ok('(the middle of the row) it goes back to the man it came from and to no other',ev({catMan:2,catSg:1},[],zJ+TB.clear+0.1)===true&&ev({catMan:2,catSg:1},[{x:37.5,z:zJ-drift}],zJ+TB.clear+0.1)===false);}

 // ---- the decision, in the side catch ----
 const ahead0=TB.contact+TB.tMin*vb;                              // the least z left to the man that still leaves time
 const dec=(over,opt,z)=>{const r=world(X,over,opt);X.catchStep(r,view(X,-0.7,z==null?(zJ-ahead0-0.1):z,0,vb),D0);return r;};
 const defShut={defOff:zJ+drift,gkOff:60},defOpen={defOff:60,gkOff:60};   // blue's DEF man 0 dead in line with the receiver (+drift); the rest out of the way
 {const r=dec(null,defShut);ok('a tap rolling to a man whose lane has shut: the rod goes back (the men go down, the man slides in)',r.catPh==='back'&&X.CAS.back===1,'ph '+r.catPh+' back '+X.CAS.back);
  ok('...counted in the chain (a tap back is a tap) and the reversal flag is fresh',r.tapN===2&&r.bkRev===false);}
 {const r=dec({bkRev:true,pinOn:true,pinPose:true,pinA:-1},defShut);ok('...the step is taken that frame (the pin off, the boot down) and a flag left up from last time is cleared',r.catPh==='back'&&r.bkRev===false&&!r.pinOn&&r.pinPose&&r.pinA<0&&r.pinA!==-1&&r.raise===false);}
 {const r=dec(null,defOpen);ok('...but not while his lane is open',r.catPh==='side'&&X.CAS.back===0);}
 {const r=dec({tapPend:false},defShut);ok('...not for a ball that is no tap (a side catch of any ball keeps to the old way)',r.catPh==='side');}
 {const r=dec({tapN:TP.maxChain},defShut);ok('...not once the chain is as long as it goes',r.catPh==='side');}
 {const r=dec(null,defShut,zJ-ahead0+0.1);ok('...not too late (the men need time to go down)',r.catPh==='side');}
 {const r=dec(null,defShut,zJ-ahead0-0.1);ok('...but with that much time it does',r.catPh==='back');}
 {const r=dec({catCush:true},defShut);ok('...not once the rod is running along with the ball',r.catPh==='side');}
 {const r=dec({catDeep:true},defShut);ok('...not for a deep ball (the leans and the bounce are worked out for the shallow band)',r.catPh==='side'&&X.CAS.back===0);}
 {const r=dec({catFwd:true},defShut);ok('...not for a forward side catch (the men would have to go down square onto the ball: it is a tap to a back pin or nothing)',r.catPh==='side'&&X.CAS.back===0);}
 {const r=dec({tbEv:0.05},defShut);ok('...it looks at the lanes every so often, not every frame',r.catPh==='side'&&Math.abs(r.tbEv-(0.05-dt))<1e-9,'tbEv '+r.tbEv);}
 {const r=dec({tbEv:0},defOpen);ok('...and starts the clock again after a look',Math.abs(r.tbEv-TB.every)<1e-9,'tbEv '+r.tbEv);}
 {TB.on=false;const r=dec(null,defShut);restore();ok('tap.back.on false: no tap back',r.catPh==='side');}
 {const r=world(X,null,defShut);const real=view(X,-0.7,zJ-ahead0-0.1,0,vb),seen=view(X,-0.7,zJ-ahead0-0.1,0,0);seen.real=real;X.catchStep(r,seen,D0);
  ok('the decision reads the real ball, not the delayed view (which still shows a ball that was held)',r.catPh==='back');}

 // ---- the tap back itself ----
 const bk=(over,rel,z,vz,y)=>{const r=world(X,Object.assign({catPh:'back',catT:0.2},over||{}));X.catchStep(r,view(X,rel,z,0,vz,y),D0);return r;};
 const zFar=zI+TB.clear-0.5,zClr=zI+TB.clear+0.5;
 {const r=bk(null,-0.7,zFar,vb);ok('the ball still close to the man it left: the men stay up (a boot swinging down would hit it)',r.raise&&!r.pinPose&&!r.pinOn&&r.target===r.offset&&r.catPh==='back');}
 {const r=bk(null,-0.7,zClr,vb);ok('...once it is clear of him the men go down, no pin',!r.raise&&r.pinPose&&!r.pinOn&&r.aiMan===1);}
 {let all=true,info=[];for(const rel of [-0.55,-0.7,-0.95,-1.5]){const r=bk(null,rel,zClr,vb),want=Math.asin((rel-X.FOOT_BOX_OFF.y)/(X.ARM+X.FOOT_BOX_OFF.x));info.push(r.pinA==null?'-':r.pinA.toFixed(2));if(!(r.pinA!=null&&Math.abs(r.pinA-want)<1e-9&&r.pinA<0))all=false;}
  ok('...the boot square onto the ball (its box centred on the ball\'s depth, so it hits a flat face and is not knocked backward by a corner), a deeper ball leaning it further',all,info.join(' '));}
 {const r=bk(null,-0.7,zJ-TB.runD-0.3,vb);ok('the man slides into the ball only as it arrives',r.target===r.offset);
  const q=bk(null,-0.7,zJ-TB.runD+0.3,vb);ok('...against its roll, at runV',Math.abs((q.target-q.offset)/dt+TB.runV)<1e-6,((q.target-q.offset)/dt).toFixed(2));}
 {const r=bk({catMan:0,catSg:-1},-0.7,zI+TB.runD-0.3,-vb);ok('...either way along the row',(r.target-r.offset)/dt>0);}
 {const nar={baseZ:[-6,0,6],offset:1,target:1},a=bk(nar,-0.7,-2,vb),c=bk(nar,-0.7,-1.3,vb);ok('...but not before the men are down (the ball clear of the man it left), even when it is that close to the man it is rolling to',a.target===a.offset&&c.target!==c.offset,(a.target-a.offset).toFixed(2)+' / '+(c.target-c.offset).toFixed(2));}
 {const r=bk({bkRev:true},-0.7,zJ-3.0,-vb*0.8);ok('it bounced: the rod brakes (no more slide into it) and the flag stays',r.bkRev===true&&r.target===r.offset&&r.catPh==='back');}
 {const r=bk(null,-0.7,zJ-1,-8);ok('a ball turned round is noticed',r.bkRev===true);}
 {const r=bk(null,-0.7,zJ-1,-0.5);ok('...a ball that has only slowed is not a bounce',r.bkRev===false);}
 {const r=bk({bkRev:true},-0.7,zJ-TB.clear+0.2,-12);ok('turned round but still on top of the man: the men stay down, waiting for it to clear him',r.catPh==='back');}
 {const r=bk({bkRev:true,catCush:true},-0.7,zJ-TB.clear-0.1,-12);
  ok('once it is away from him the man it came from takes it as a side catch',r.catPh==='side'&&r.catMan===0&&r.catSg===-1&&r.catCush===false&&r.catT===0,'ph '+r.catPh+' man '+r.catMan+' sg '+r.catSg);}
 {const r=bk({bkRev:true,catMan:2,catSg:1},-0.7,zJ+10-TB.clear-0.1,-12);ok('...whichever man it was rolling to',r.catPh==='side'&&r.catMan===1&&r.catSg===-1,'man '+r.catMan);}
 {const r=world(X,{catPh:'back',catT:0.2,tapPend:true});const real=view(X,-0.7,zClr,0,vb);const seen=view(X,-0.7,zFar,0,0);seen.real=real;X.catchStep(r,seen,D0);
  ok('it reads the real ball, not the delayed view',!r.raise);}
 {const r=bk({tapPend:true,pinB:null},-0.7,zJ+TB.passed+0.3,vb);ok('it rolled on through him: done, a tap that failed',r.act===null&&X.CAW['back:through']===1&&X.CAS.tapFail===1,JSON.stringify(X.CAW));}
 {const r=bk(null,-0.7,zJ+TB.passed-0.3,vb);ok('...but not while it is only just past his middle',r.act==='catch');}
 {const r=bk({catT:TB.abortT},-0.7,zClr,vb);ok('too long: done',r.act===null&&X.CAW['back:time']===1);}
 {const r=bk({force:true},-0.7,zClr,vb);ok('a dead-ball push: done',r.act===null&&X.CAW['back:force']===1);}
 {const r=bk(null,-0.7,zClr,vb,5);ok('lifted off the floor: done',r.act===null&&X.CAW['back:lifted']===1);}
 {const r=bk(null,CA.side.back-1.5,zClr,vb);ok('it left the row: done',r.act===null&&X.CAW['back:off']===1);}
 {const r=world(X,{catPh:'back',catT:0.2});const b=view(X,-0.7,zClr,0,vb);b.scored=true;X.catchStep(r,b,D0);ok('scored: done',r.act===null&&X.CAW['back:scored']===1);}
 {const r=world(X,{catPh:'back',catT:0.2});r.pinB={m:{position:{x:22,y:1.9,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.catchStep(r,view(X,-0.7,0,0,0),D0);
  ok('a pin that takes the ball during it (a stray catch) is the ordinary hold, and counts as landed',r.catPh==='hold'&&X.CAS.tapOk===1);}
 {const r=world(X,{catPh:'side',catMan:1,catSg:1,tapPend:false});X.catchStep(r,view(X,-0.7,zClr,0,vb),D0);ok('a plain side catch is not sent back',r.catPh==='side'&&X.CAS.back===0);}
 return R;
}

let bad=0;
const res=suite(boot());
console.log(NL+'=== a tap goes back when the receiver\'s lane shuts ===');
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info?'   ['+t.info+']':''));}
console.log(NL+'  '+(res.length-bad)+' passed, '+bad+' failed'+NL);

console.log('=== mutations: each must break an assertion ===');
const MUT=[
 {n:'it goes back whatever the receiver\'s lane',from:'if(pinOutlet(r,p.x,clamp(r.baseZ[j]+r.offset+s*TP.drift,-zl,zl),obs,goalX,0)>=CA.lineClear)return false;',to:''},
 {n:'it goes back whatever the sender\'s lane',from:'return pinOutlet(r,p.x,clamp(r.baseZ[i]+r.offset-s*TP.drift,-zl,zl),obs,goalX,0)>=CA.lineClear;',to:'return true;'},
 {n:'the receiver\'s drift is ignored',from:'clamp(r.baseZ[j]+r.offset+s*TP.drift,-zl,zl)',to:'clamp(r.baseZ[j]+r.offset,-zl,zl)'},
 {n:'the sender\'s drift is ignored',from:'clamp(r.baseZ[i]+r.offset-s*TP.drift,-zl,zl)',to:'clamp(r.baseZ[i]+r.offset,-zl,zl)'},
 {n:'the sender\'s drift is the wrong way',from:'clamp(r.baseZ[i]+r.offset-s*TP.drift,-zl,zl)',to:'clamp(r.baseZ[i]+r.offset+s*TP.drift,-zl,zl)'},
 {n:'a cannonballed man is gone back to',from:'if(i<0||i>=r.baseZ.length||!manLive(r,i)||',to:'if(i<0||i>=r.baseZ.length||'},
 {n:'the ball can still be on top of the sender',from:'||(p.z-(r.baseZ[i]+r.offset))*s<TP.back.clear)return false;',to:')return false;'},
 {n:'the room to run the other way is not asked for',from:'if((s>0?r.offset+r.maxOff:r.maxOff-r.offset)<TP.room)return false;',to:''},
 {n:'the room is judged for the wrong direction',from:'(s>0?r.offset+r.maxOff:r.maxOff-r.offset)<TP.room',to:'(s>0?r.maxOff-r.offset:r.offset+r.maxOff)<TP.room'},
 // the decision
 {n:'it looks at every ball, not only a tap',from:'if(r.tapPend&&TB&&TB.on&&',to:'if(TB&&TB.on&&'},
 {n:'the switch is ignored',from:'&&TB&&TB.on&&!deep&&!r.catFwd&&!r.catCush',to:'&&TB&&!deep&&!r.catFwd&&!r.catCush'},
 {n:'a tap back is tried for a deep ball too',from:'TB.on&&!deep&&!r.catFwd&&!r.catCush',to:'TB.on&&!r.catFwd&&!r.catCush'},
 {n:'it keeps going back for ever (no chain limit)',from:'&&(r.tapN|0)<CA.tap.maxChain&&ahead-TB.contact',to:'&&ahead-TB.contact'},
 {n:'it decides with no time left',from:'&&ahead-TB.contact>=TB.tMin*bv&&',to:'&&'},
 {n:'the time is judged to the man\'s middle, not to where the ball touches him',from:'ahead-TB.contact>=TB.tMin*bv',to:'ahead>=TB.tMin*bv'},
 {n:'it decides while the rod is already cushioning',from:'!deep&&!r.catFwd&&!r.catCush&&',to:'!deep&&!r.catFwd&&'},
 {n:'it goes back for a forward side catch too',from:'!deep&&!r.catFwd&&!r.catCush&&',to:'!deep&&!r.catCush&&'},
 {n:'it looks every frame',from:'(r.tbEv=(r.tbEv||0)-dt)<=0){',to:'true){'},
 {n:'the clock is never restarted',from:'  r.tbEv=TB.every;\n',to:'\n'},
 {n:'the chain is not counted',from:"r.catPh='back';r.catT=0;r.tapN++;r.bkRev=false;CAS.back++;",to:"r.catPh='back';r.catT=0;r.bkRev=false;CAS.back++;"},
 {n:'the reversal flag is left up from last time',from:"r.catPh='back';r.catT=0;r.tapN++;r.bkRev=false;",to:"r.catPh='back';r.catT=0;r.tapN++;"},
 {n:'a tap back is not counted',from:'r.bkRev=false;CAS.back++;backStep(r,best);return;',to:'r.bkRev=false;backStep(r,best);return;'},
 {n:'the decision is made but never taken up',from:'CAS.back++;backStep(r,best);return;',to:'CAS.back++;'},
 // the step
 {n:'the back branch is gone from catchStep',from:"if(r.catPh==='back'){backStep(r,best);return;}",to:''},
 {n:'the men go down at once (a boot swings down onto the ball)',from:'r.raise=!clearI;',to:'r.raise=false;'},
 {n:'the men never go down',from:'r.raise=!clearI;',to:'r.raise=true;'},
 {n:'the pin is left on',from:'r.aiMan=j;r.pinOn=false;\n r.raise',to:'r.aiMan=j;r.pinOn=true;\n r.raise'},
 {n:'the boot is left upright (no lean onto the ball)',from:'Math.asin(clamp((rel-FOOT_BOX_OFF.y)/(ARM+FOOT_BOX_OFF.x),-0.95,0.95))*dir:null',to:'0:null'},
 {n:'the lean ignores the ball\'s depth',from:'Math.asin(clamp((rel-FOOT_BOX_OFF.y)/(ARM+FOOT_BOX_OFF.x),-0.95,0.95))*dir:null',to:'-0.2*dir:null'},
 {n:'the lean ignores the box\'s own offset',from:'(rel-FOOT_BOX_OFF.y)/(ARM+FOOT_BOX_OFF.x)',to:'rel/ARM'},
 {n:'the pose goes on before the ball is clear of the man it left',from:'r.pinPose=clearI;r.pinA=clearI?',to:'r.pinPose=true;r.pinA=true?'},
 {n:'the man never slides into it',from:'r.target=(!r.bkRev&&clearI&&ahead<=TB.runD)?clamp(r.offset-s*TB.runV*dt,-r.maxOff,r.maxOff):r.offset;',to:'r.target=r.offset;'},
 {n:'the man slides AWAY from it',from:'clamp(r.offset-s*TB.runV*dt,-r.maxOff,r.maxOff)',to:'clamp(r.offset+s*TB.runV*dt,-r.maxOff,r.maxOff)'},
 {n:'the slide starts at once',from:'(!r.bkRev&&clearI&&ahead<=TB.runD)',to:'(!r.bkRev&&clearI)'},
 {n:'the slide starts before the men are down',from:'(!r.bkRev&&clearI&&ahead<=TB.runD)',to:'(!r.bkRev&&ahead<=TB.runD)'},
 {n:'he keeps sliding into it after the bounce',from:'(!r.bkRev&&clearI&&ahead<=TB.runD)',to:'(clearI&&ahead<=TB.runD)'},
 {n:'a bounce is never noticed',from:'if(v.z*s<-1)r.bkRev=true;',to:''},
 {n:'any slowing is taken for a bounce',from:'if(v.z*s<-1)r.bkRev=true;',to:'if(v.z*s<TB.runV)r.bkRev=true;'},
 {n:'it hands the ball on before it is clear of the man',from:'if(r.bkRev&&ahead>=TB.clear)',to:'if(r.bkRev)'},
 {n:'it never hands the ball on',from:"if(r.bkRev&&ahead>=TB.clear){r.catPh='side';r.catMan=i;r.catSg=-s;r.catCush=false;r.catT=0;return;}",to:''},
 {n:'the ball is handed back to the man that took it',from:"r.catPh='side';r.catMan=i;r.catSg=-s;",to:"r.catPh='side';r.catMan=j;r.catSg=-s;"},
 {n:'the direction of the roll is not turned round',from:"r.catPh='side';r.catMan=i;r.catSg=-s;",to:"r.catPh='side';r.catMan=i;r.catSg=s;"},
 {n:'the hand-on keeps the old clock',from:"r.catSg=-s;r.catCush=false;r.catT=0;return;",to:"r.catSg=-s;r.catCush=false;return;"},
 {n:'the step reads the delayed view',from:'rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,j=r.catMan,s=r.catSg,i=j-s;',to:'rb=best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,j=r.catMan,s=r.catSg,i=j-s;'},
 // the ends
 {n:'rolling on through him is not noticed',from:"else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)why='through';",to:"else if(rel<SD.back-1||rel>SD.front+1)why='off';"},
 {n:'it is never given up on',from:"else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)",to:"else if(r.force)why='force';\n else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)"},
 {n:'a dead-ball push does not stop it',from:"else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)",to:"else if(r.catT>TB.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)"},
 {n:'a lifted ball is waited on',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';",to:"if(rb.scored)why='scored';else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';"},
 {n:'a ball that left the row is waited on',from:"else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)",to:"else if(ahead<-TB.passed)"},
 {n:'a scored ball is waited on',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';",to:"if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';"}
];
let missed=0;
for(const m of MUT){
 m.part='catch';
 let caught=false,detail='';
 try{const r=suite(boot(m));caught=r.some(t=>!t.ok);if(caught)detail=r.filter(t=>!t.ok).length+' assertions';}
 catch(e){detail='THREW '+e.message;missed++;}
 if(!caught&&!detail.startsWith('THREW')){missed++;detail='NOT CAUGHT';}
 console.log('  '+(caught?'caught ':'MISSED ')+' ('+(detail||'-')+')  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length+NL);
process.exit(bad||missed?1:0);
