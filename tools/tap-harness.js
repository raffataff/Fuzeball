// tap harness (the AI starts a tic-tac). node tools/tap-harness.js
// slices the real catch block (tapEval / pinPlay / tapStart / tapStep / catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: does a rod holding a ball with nothing to shoot at and nowhere to carry it send it along the row to a neighbouring man whose lane is open (and only then), run with it, let go at speed and hand it to the
// side catch, count what comes of it, and leave retrieve's shared carry, the passes and the shots alone; each mutation must break an assertion
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
 "var S={balls:[],time:0}; var rods=[]; var BGS={retEnd:0};",
 "var RELEASED=0,STRIKE=true,SWEEP=false,PICK=null,KICKS=[];",
 "function pinRelease(r){r.pinB=null;RELEASED++;}",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;KICKS.push(style);}",
 "function strikeOn(){return STRIKE;} function sweepClips(){return SWEEP;} function passPick(){return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "function isUserRod(){return false;} var RNGV=0.99; function rngAi(){return function(){return RNGV;};}",
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,DIFFS:DIFFS,F:F,BALL_R:BALL_R,rods:rods,CAS:CAS,CAW:CAW,KICKS:KICKS,pinOutlet:pinOutlet,pinCarryV:pinCarryV,pinPlayStart:pinPlayStart,pinPlay:pinPlay,tapEval:tapEval,tapStart:tapStart,retrieveTap:retrieveTap,tapStep:tapStep,catchStep:catchStep,catchEnd:catchEnd,'+
  'released:function(){return RELEASED;},setPick:function(v){PICK=v;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120;
// the red ATT (x 22.5, attacking +x): three men 12 apart, the blue DEF (x 37.5) and keeper (52.5) in the way
function world(X,over,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.setPick&&X.setPick(null);X.KICKS.length=0;for(const k in X.CAW)delete X.CAW[k];for(const k in X.CAS)X.CAS[k]=0;
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:'ATT',aiIQ:true,baseZ:[-12,0,12],maxOff:9,removedUntil:[],offset:0,target:0,slideV:0,angle:-0.75,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:'catch',catPh:'hold',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0,tapN:0},over||{});
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:opt.defBase||[0,24],offset:opt.defOff!=null?opt.defOff:-1.1,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff!=null?opt.gkOff:3.5,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z,vx,vz){const b={scored:false,m:{position:{x:22.5+rel,y:X.BALL_R,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
// a ball pinned under man `mi` at depth rel, dz off its z
function pinned(X,r,mi,rel,dz){const b={m:{position:{x:22.5+(rel==null?-0.7:rel),y:X.BALL_R,z:r.baseZ[mi]+r.offset+(dz||0)}},v:{x:0,y:0,z:0},pinMan:mi,pinDz:dz||0,pinDx:rel==null?-0.7:rel,scored:false};
 r.pinB=b;X.pinPlayStart(r);return b;}
const D={cd:1};

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,TP=CA.tap,goalX=X.F.L/2;CA.recv.ready.on=false;CA.hit.on=false;   // the roll is what this file is about; hit-harness has the tap proper
    // its passes are not about the receiver's readiness
 const keep=JSON.stringify(TP);
 const back=()=>{const k=JSON.parse(keep);for(const x in k)TP[x]=k[x];};
 // blue's men: DEF at -6 and 18 (dead in line with a ball at -6), the keeper off to the side, so a ball at +8 has a clear line to the mouth
 const obs=[{x:37.5,z:-6},{x:37.5,z:18},{x:52.5,z:-9}];
 const out=(r,z)=>X.pinOutlet(r,22.5-0.7,z,obs,goalX,0);

 // ---- where a tap could go ----
 // men at -6 / 0 / 6 so a neighbour's ball (+2 of drift) lands inside the mouth; blue's DEF stands dead in line with the ball under man 0, nothing in the way at the next man
 const SP=[-6,0,6],o3=3.5;                                             // offset 3.5: man 0 at -2.5, man 1 at 3.5, man 2 at 9.5
 const blockHere=[{x:37.5,z:-2.5},{x:37.5,z:21.5},{x:52.5,z:-9}];
 const hold=(over,mi,rel)=>{const r=world(X,Object.assign({baseZ:SP,offset:o3},over||{}));return {r,b:pinned(X,r,mi==null?0:mi,rel)};};
 {const {r,b}=hold();const o0=X.pinOutlet(r,22.5-0.7,b.m.position.z,blockHere,goalX,0),o1=X.pinOutlet(r,22.5-0.7,r.baseZ[1]+r.offset+TP.drift,blockHere,goalX,0);
  ok('(the set-up) the lane is shut where the ball is and open where the next man will have it',o0<CA.lineClear&&o1>=CA.lineClear,o0.toFixed(2)+' / '+o1.toFixed(2));
  const t=X.tapEval(r,b,blockHere,goalX);ok('a neighbouring man with an open lane is the one to tap to',t&&t.j===1&&t.s===1&&t.out>=CA.lineClear,JSON.stringify(t));}
 {const {r,b}=hold();ok('...and nobody the other way (man 0 is the end of the row)',X.tapEval(r,b,blockHere,goalX).s===1);}
 {const {r,b}=hold({offset:-o3},2);const t=X.tapEval(r,b,[{x:37.5,z:2.5},{x:37.5,z:-21.5},{x:52.5,z:9}],goalX);
  ok('...either way along the row',t&&t.j===1&&t.s===-1,JSON.stringify(t));}
 {const {r,b}=hold({offset:0,baseZ:[-5.2,0,5.2]},1);const t=X.tapEval(r,b,[{x:37.5,z:-7.2},{x:37.5,z:16},{x:52.5,z:-9}],goalX);
  ok('given two neighbours, the one with the better lane',t&&t.s===1,JSON.stringify(t));
  const q=X.tapEval(r,b,[{x:37.5,z:7.2},{x:37.5,z:-16},{x:52.5,z:9}],goalX);ok('...and the other way round',q&&q.s===-1,JSON.stringify(q));}
 // a blocker placed so the lane is open at the man's own z and shut 2 further on, where the receiving man drifts to
 {const {r,b}=hold();const zB=r.baseZ[1]+r.offset;let zq=null;
  for(let z=zB+2;z<zB+12;z+=0.05){const ob=[{x:37.5,z:z}];if(X.pinOutlet(r,22.5-0.7,zB+TP.drift,ob,goalX,0)<CA.lineClear&&X.pinOutlet(r,22.5-0.7,zB,ob,goalX,0)>=CA.lineClear){zq=z;break;}}
  ok('(the set-up) a lane that is open at the man and shut where it drifts to',zq!=null,'blocker '+zq);
  ok('the lane is judged where the receiving man will have drifted to, not where he stands',zq!=null&&X.tapEval(r,b,[{x:37.5,z:zq}],goalX)===null);}
 {const {r,b}=hold();ok('not when the lane there is shut too',X.tapEval(r,b,[{x:37.5,z:-2.5},{x:37.5,z:5.5},{x:52.5,z:-9}],goalX)===null);}
 {const {r,b}=hold({},0,TP.relMax+0.1);ok('not a ball held too far forward (the leg would not clear it as it leaves)',X.tapEval(r,b,blockHere,goalX)===null);}
 {const {r,b}=hold({},0,TP.relMin-0.1);ok('...nor one held too deep',X.tapEval(r,b,blockHere,goalX)===null);}
 {const fa=CA.recv.fwdMin+0.25,FB=TP.fwd;
  {const {r,b}=hold({angle:fa},0,(FB.min+FB.max)/2);ok('under a forward leg the ball is held further back and nearer the pivot: it has its own band',X.tapEval(r,b,blockHere,goalX)!==null);}
  {const {r,b}=hold({angle:fa},0,FB.max+0.1);ok('...not past its near edge',X.tapEval(r,b,blockHere,goalX)===null);}
  {const {r,b}=hold({angle:fa},0,FB.min-0.1);ok('...nor its deep edge',X.tapEval(r,b,blockHere,goalX)===null);}
  {const {r,b}=hold({angle:fa},0,TP.relMax-0.1);ok('...a ball in the back pin band is in this one too (a side catch rests there)',X.tapEval(r,b,blockHere,goalX)!==null);}
  {const {r,b}=hold({},0,FB.max-0.1);ok('the usual pin keeps its own band: the same depth is too near for it',X.tapEval(r,b,blockHere,goalX)===null);}}
 {const {r,b}=hold({role:'GK'});ok('not a rod that is not on the list (roles: the keeper has one man)',X.tapEval(r,b,blockHere,goalX)===null);}
 // the defence: two men 24 apart, the lane is the gap past the blue row in front (one blue man on the ball under man 0, nothing where man 1 will have it)
 {let found=null;const dB=[-12,12];
  for(let off=-12;off<=12&&!found;off+=0.25){const r=world(X,{role:'DEF',baseZ:dB,maxOff:18,offset:0},{defOff:off,defBase:[0,60],gkOff:0});const b=pinned(X,r,0,-0.7);
   const here=X.pinOutlet(r,22.5-0.7,b.m.position.z,[],goalX,0),there=X.pinOutlet(r,22.5-0.7,r.baseZ[1]+r.offset+TP.drift,[],goalX,0);
   if(here<CA.lineClear&&there>=CA.lineClear)found={off,r,b};}
  ok('(the set-up) the defence\'s lane is shut at the ball and open where the other man will have it',!!found,found&&('blue row at '+found.off));
  const t=found&&X.tapEval(found.r,found.b,[],goalX);
  ok('the defence taps across its two men, 24 apart',t&&t.j===1&&t.s===1,JSON.stringify(t));
  found.r.baseZ=[-12,-12+TP.maxD+0.5];
  ok('...but not to a man beyond maxD',X.tapEval(found.r,found.b,[],goalX)===null);}
 {TP.on=false;const {r,b}=hold();const t=X.tapEval(r,b,blockHere,goalX);back();ok('tap.on false: no tap',t===null);}
 {const {r,b}=hold({baseZ:[-6,-3,6]});ok('not a man too close to be worth it',X.tapEval(r,b,blockHere,goalX)===null);}
 {const sp=TP.maxD+0.5,mk=(d)=>hold({baseZ:[-12,-12+d,40],maxOff:14,offset:-11},0);
  const far=mk(sp),near=mk(TP.maxD-0.5);ok('...or too far (a wing ball whose next man is just past maxD, in the mouth)',X.tapEval(far.r,far.b,[{x:37.5,z:-23}],goalX)===null&&X.tapEval(near.r,near.b,[{x:37.5,z:-23}],goalX)!==null);}
 {const sp=[-5.2,0,5.2],a=hold({baseZ:sp,offset:9-(TP.room-0.2)}),c=hold({baseZ:sp,offset:9-(TP.room+0.3)});
  ok('not without the slide left to run, brake and cushion in that direction',X.tapEval(a.r,a.b,[{x:37.5,z:-30}],goalX)===null);
  ok('...but with it, yes (the same lane)',X.tapEval(c.r,c.b,[{x:37.5,z:-30}],goalX)!==null);}
 // two open lanes, one clearer: the clearer one (the mouth term caps a clear lane at 2.15, so a blocker has to pull the other one under that; lineClear is lowered to leave room for it)
 {const lc=CA.lineClear;CA.lineClear=0.4;
  const {r,b}=hold({offset:0,baseZ:[-5.2,0,5.2]},1);let zq=null,oR=null;
  for(let z=16;z>7;z-=0.05){oR=X.pinOutlet(r,22.5-0.7,5.2+TP.drift,[{x:37.5,z:z}],goalX,0);if(oR>=0.4&&oR<1.5){zq=z;break;}}
  const t=zq==null?null:X.tapEval(r,b,[{x:37.5,z:zq}],goalX);CA.lineClear=lc;
  ok('(two open lanes, one clearer) the clearer one is the one it taps to',zq!=null&&t&&t.s===-1,'blocker '+zq+' right '+(oR&&oR.toFixed(2))+' '+JSON.stringify(t));}
 {const {r,b}=hold({removedUntil:[0,1e9,0]});ok('not to a man a cannonball took',X.tapEval(r,b,blockHere,goalX)===null);}

 // ---- when the rod decides to ----
 // blue's DEF stands on man 0's ball (-8.5 at offset 3.5, spacing 12), the keeper beside it; the rod's slide is clamped to 0.4 so it cannot carry the ball anywhere that opens
 const play=(r,t,tap)=>X.pinPlay(r,view(X,-0.7,r.pinB.m.position.z),t==null?CA.settleT+0.01:t,dt,tap===undefined?true:tap);
 const stuck=(over)=>{TP.room=-99;const r=world(X,Object.assign({offset:o3,maxOff:0.4,baseZ:[-12,-6,0]},over||{}),{defOff:-8.5,gkOff:-9});return r;};
 {const r=stuck();pinned(X,r,0,-0.7);const v=play(r);const pk=r.tapPk;back();
  ok('blocked here, nowhere to carry it, a neighbour is open: tap it',v===3&&pk&&pk.j===1,'v='+v+' pk='+JSON.stringify(pk));}
 {const r=stuck();pinned(X,r,0,-0.7);const v=play(r,null,false);const pk=r.tapPk;back();
  ok('...but only when the caller asks for it (retrieve shares this carry and cannot tap)',v!==3&&!pk);}
 {const r=stuck();pinned(X,r,0,-0.7);const v=play(r,CA.settleT-0.05);back();ok('...not before the held ball has settled',v===0);}
 {const r=stuck({tapN:TP.maxChain});pinned(X,r,0,-0.7);const v=play(r);back();ok('...not once it has been tapped maxChain times on this possession',v!==3);}
 {const r=stuck();pinned(X,r,0,-0.7);const v=play(r,CA.holdT+0.01);back();ok('...a ball held too long is played (late), not tapped',v===1);}
 {const r=stuck();pinned(X,r,0,-0.7);X.setPick({score:60,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});const v=play(r);back();X.setPick(null);
  ok('a better-placed mate does not beat a tap: the tap goes before the pass',v===3,'v='+v);}
 {const sm=CA.slideMax;CA.slideMax=0;const r=stuck({tapN:TP.maxChain});pinned(X,r,0,-0.7);X.setPick({score:60,x:7.5,z:5,clr:4,onward:3,rod:{role:'MID'}});const v=play(r);back();X.setPick(null);CA.slideMax=sm;
  ok('...with the chain used up and nowhere to carry it the pass is the play',v===2,'v='+v);}
 {const r=world(X,{offset:0},{defOff:10,gkOff:-20});pinned(X,r,1,-0.7);const v=play(r);ok('an open lane is a shot, never a tap',v===1&&!r.tapPk,'v='+v);}
 {const r=world(X,{offset:o3,baseZ:SP},{defOff:-2.5,gkOff:-9});pinned(X,r,0,-0.7);const v=play(r);
  ok('a carry that finds an open lane in reach is preferred to a tap',v!==3&&!r.tapPk,'v='+v);}

 {const r=stuck();pinned(X,r,0,-0.7);r.catT=CA.settleT+0.01-dt;X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);const ph=r.catPh,pk=r.tapPk,ks=X.KICKS.length;back();
  ok('catchStep takes the decision up: the tap phase, nothing fired',ph==='tap'&&pk===null&&ks===0,'ph '+ph+' kicks '+ks);}

 // ---- the run, the release, the hand-off ----
 const T0=(over)=>{const r=world(X,Object.assign({offset:6,catPh:'tap',tapS:1,tapJ:1},over||{}));const b=pinned(X,r,0,-0.7);r.pinB=b;return r;};
 const carryV=r=>X.pinCarryV(r);
 {const r=T0();X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);
  ok('the run: the rod asks for a slide along the row, the pin held, the pose kept',r.target>r.offset&&r.pinOn&&r.pinPose&&r.catPh==='tap'&&r.pinB,'target '+r.target.toFixed(2));
  ok('...and does not let go while it is still slow',X.released()===0);}
 {const r=T0({slideV:TP.releaseV*carryV(r0())-1});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('...still holding a hair under the release speed',r.pinB&&r.catPh==='tap');}
 function r0(){return {role:'ATT',team:0,kickDir:1};}
 {const r=T0({slideV:TP.releaseV*carryV(r0())+1});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);
  ok('at speed it lets go: the ball is released and the rod brakes',!r.pinB&&X.released()===1&&r.target===r.offset&&!r.pinOn);
  ok('...and the receiving man takes over as a side catch',r.catPh==='side'&&r.catMan===1&&r.catSg===1&&!r.catCush&&r.catT===0,'ph '+r.catPh);
  ok('...counted: a tap, a chain of one, and one waiting to see if it lands',X.CAS.tap===1&&r.tapN===1&&r.tapPend===true);
  ok('...and the look at the lanes (a tap back) starts at once',r.tbEv===0);}
 {const r=T0({tapS:-1,tapJ:0,offset:-6});const b=r.pinB;b.pinMan=1;r.slideV=-(TP.releaseV*carryV(r0())+1);X.catchStep(r,view(X,-0.7,b.m.position.z),D);ok('...either way along the row',r.catPh==='side'&&r.catSg===-1&&r.catMan===0);}
 {const r=T0({slideV:-30});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('a rod sliding the WRONG way is not at release speed',r.pinB&&r.catPh==='tap');}
 {const r=T0();r.pinB=null;X.catchStep(r,view(X,-0.7,0),D);ok('the ball knocked away mid-run: done',r.act===null&&X.CAW['tap:lost']===1);}
 {const r=T0({catT:TP.abortT});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('a run that never gets there: done',r.act===null&&X.CAW['tap:time']===1);}
 {const r=T0({force:true});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('a dead-ball push: done',r.act===null&&X.CAW['tap:force']===1);}
 {const r=T0();X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('a tap phase with the ball pinned is NOT turned into a hold (the pin is still the carry)',r.catPh==='tap'&&X.CAS.pin===0);}
 {const r=world(X,{offset:6});const b=pinned(X,r,0,-0.7);r.tapPk={j:1,s:1,out:5};X.tapStart(r);
  ok('tapStart takes the decision: phase, direction, receiver, a fresh clock, the decision spent',r.catPh==='tap'&&r.tapS===1&&r.tapJ===1&&r.catT===0&&r.tapPk===null);}

 // ---- what came of it ----
 {const r=world(X,{catPh:'side',tapPend:true,tapN:1,catMan:1,catSg:1});pinned(X,r,1,-0.7);X.catchStep(r,view(X,-0.7,0),D);
  ok('the receiving man pins it: a tap that landed, and the carry is the ordinary hold',r.catPh==='hold'&&X.CAS.tapOk===1&&r.tapPend===false&&X.CAS.tapFail===0);}
 {const r=world(X,{catPh:'side',tapPend:true,tapN:1,catMan:1,catSg:1,catT:0});X.catchStep(r,view(X,-0.7,-8,0,0.5),D);
  ok('it never lands (the ball dies): a tap that failed, and the chain count is cleared',r.act===null&&X.CAS.tapFail===1&&r.tapN===0&&r.tapPend===false);}
 {const r=world(X,{tapN:1,tapPk:{j:1,s:1,out:3},catCush:true});X.catchEnd(r,0,'x');ok('every ending clears the chain, the decision and the cushion',r.tapN===0&&r.tapPk===null&&r.catCush===false);}
 {const r=world(X,{catPh:'side',tapPend:false,catMan:1,catSg:1});X.catchStep(r,view(X,-0.7,-8,0,0.5),D);ok('a side catch that was no tap counts no failure',X.CAS.tapFail===0);}
 // ---- deep: a ball held as retrieve holds one (about -3 behind the rod) ----
 const TD=TP.deep;
 {const {r,b}=hold({},0,-3.0);ok('a ball held deep, as retrieve holds one, is tapped like any other',X.tapEval(r,b,blockHere,goalX)!==null);}
 {const {r,b}=hold({},0,-1.5);ok('...but not one between the shallow band and the deep one',X.tapEval(r,b,blockHere,goalX)===null);}
 {const a=hold({},0,TD.max),c=hold({},0,TD.max+0.1);ok('...the deep band stops at its shallow edge',X.tapEval(a.r,a.b,blockHere,goalX)!==null&&X.tapEval(c.r,c.b,blockHere,goalX)===null);}
 {const a=hold({},0,TD.min),c=hold({},0,TD.min-0.1);ok('...and at its deep edge',X.tapEval(a.r,a.b,blockHere,goalX)!==null&&X.tapEval(c.r,c.b,blockHere,goalX)===null);}
 {TD.on=false;const {r,b}=hold({},0,-3.0);const t=X.tapEval(r,b,blockHere,goalX);TD.on=true;ok('deep.on false: no deep tap',t===null);}
 {const r=T0({slideV:TP.releaseV*carryV(r0())+1});r.pinB.pinDx=-3.0;X.catchStep(r,view(X,-3.0,r.pinB.m.position.z),D);ok('a deep ball let go is marked deep (the roll is judged over later)',r.catPh==='side'&&r.catDeep===true,'deep '+r.catDeep);}
 {const r=T0({slideV:TP.releaseV*carryV(r0())+1});X.catchStep(r,view(X,-0.7,r.pinB.m.position.z),D);ok('...a shallow one is not',r.catPh==='side'&&r.catDeep===false);}
 {const r=world(X,{catPh:'side',catDeep:true,catMan:1,catSg:1,tapPend:true,tapN:1});X.catchStep(r,view(X,CA.side.back-2.5,-8,0,12),D);
  ok('a deep roll is not over while it is still inside the deep limit',r.act==='catch'&&!X.CAW['side:off'],JSON.stringify(X.CAW));
  const q=world(X,{catPh:'side',catMan:1,catSg:1});X.catchStep(q,view(X,CA.side.back-2.5,-8,0,12),D);ok('...an ordinary one is (it left the row)',q.act===null&&X.CAW['side:off']===1);
  const e=world(X,{catPh:'side',catDeep:true,catMan:1,catSg:1,tapPend:true,tapN:1});X.catchStep(e,view(X,TD.back-1.5,-8,0,12),D);ok('...and a deep roll is over past that',e.act===null&&X.CAW['side:off']===1);}
 {const r=world(X,{catDeep:true,tapN:1});X.catchEnd(r,0,'x');ok('every ending clears the deep mark',r.catDeep===false);}
 // ---- a ball retrieve pinned ----
 {const r=world(X,{act:'retrieve',catPh:null,retPh:'pin',retMan:0,retDir:1,retZ:2,tapPk:{j:1,s:1,out:5}});pinned(X,r,0,-3.0);X.retrieveTap(r);
  ok('a pin of retrieve that has nowhere to go: the rod becomes the catch tap, the pin still on the ball',r.act==='catch'&&r.catPh==='tap'&&r.pinB&&r.tapS===1&&r.tapJ===1&&r.tapPk===null,'act '+r.act+' ph '+r.catPh);
  ok('...retrieve is wound up (its phase, man and lockout) and it is counted',r.retPh===null&&r.retMan===-1&&r.retCd===X.AIC.retrieve.cd&&X.CAS.retTap===1);}
 return R;
}

let bad=0;
const res=suite(boot());
console.log(NL+'=== the AI starts a tic-tac ===');
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info?'   ['+t.info+']':''));}
console.log(NL+'  '+(res.length-bad)+' passed, '+bad+' failed'+NL);

console.log('=== mutations: each must break an assertion ===');
const MUT=[
 {n:'any depth of ball will do',from:':((b.pinDx<TP.relMin||b.pinDx>TP.relMax)&&!(TP.deep&&TP.deep.on&&b.pinDx>=TP.deep.min&&b.pinDx<=TP.deep.max))',to:':false'},
 {n:'the front edge of the depth band is gone',from:'((b.pinDx<TP.relMin||b.pinDx>TP.relMax)&&',to:'((b.pinDx<TP.relMin)&&'},
 {n:'every role taps',from:'TP.roles.indexOf(r.role)<0||',to:''},
 {n:'the switch is ignored',from:'if(!TP||!TP.on||',to:'if(!TP||'},
 {n:'a man that is too close is a candidate',from:'if(d<TP.minD||d>TP.maxD||',to:'if(d>TP.maxD||'},
 {n:'a man that is too far is a candidate',from:'if(d<TP.minD||d>TP.maxD||',to:'if(d<TP.minD||'},
 {n:'the room to run is not asked for',from:'<TP.room)continue;',to:'<-99)continue;'},
 {n:'a cannonballed man is a candidate',from:'if(j<0||j>=r.baseZ.length||!manLive(r,j))continue;',to:'if(j<0||j>=r.baseZ.length)continue;'},
 {n:'the lane at the receiver is not asked to be open',from:'if(out>=CA.lineClear&&(!best||out>best.out))',to:'if(!best||out>best.out)'},
 {n:'the WORSE lane wins',from:'(!best||out>best.out)',to:'(!best||out<best.out)'},
 {n:'the receiver\'s drift is ignored when judging the lane',from:'clamp(zB+s*TP.drift,-zl,zl)',to:'clamp(zB,-zl,zl)'},
 {n:'it taps even when a carry would open a lane',from:'(tap&&(r.tapN|0)<CA.tap.maxChain&&(fwdTap||r.pcOut<CA.lineClear))',to:'(tap&&(r.tapN|0)<CA.tap.maxChain)'},
 {n:'there is no limit to a chain',from:'(r.tapN|0)<CA.tap.maxChain&&',to:''},
 {n:'retrieve\'s carry can tap too',from:'r.tapPk=(tap&&',to:'r.tapPk=('},
 {n:'the tap is never taken up (pinPlay\'s 3 is ignored)',from:'if(v===3){tapStart(r);return;}',to:''},
 {n:'the tap phase is routed after the pin hold',from:"if(r.catPh==='tap'){tapStep(r,best);return;}\n if(r.catPh==='flift'){fliftStep(r);return;}\n if(r.catPh==='ahead'){aheadStep(r,best);return;}\n if(r.catPh==='hit'){hitStep(r,best);return;}\n if(r.pinB){",to:"if(r.catPh==='flift'){fliftStep(r);return;}\n if(r.catPh==='ahead'){aheadStep(r,best);return;}\n if(r.catPh==='hit'){hitStep(r,best);return;}\n if(r.pinB){"},
 {n:'it lets go at once',from:'if(r.slideV*s<TP.releaseV*pinCarryV(r))return;',to:''},
 {n:'it lets go whichever way it slides',from:'if(r.slideV*s<TP.releaseV*pinCarryV(r))return;',to:'if(Math.abs(r.slideV)<TP.releaseV*pinCarryV(r))return;'},
 {n:'it runs the wrong way',from:'r.target=clamp(r.offset+s*TP.run,-r.maxOff,r.maxOff);',to:'r.target=clamp(r.offset-s*TP.run,-r.maxOff,r.maxOff);'},
 {n:'it keeps running after the release',from:' r.target=r.offset;\n r.catPh=\'side\';',to:' r.catPh=\'side\';'},
 {n:'the ball is never let go',from:'pinRelease(r);\n tapSide(r,deep);',to:'tapSide(r,deep);'},
 {n:'the receiver is the man it left',from:'r.catPh=\'side\';r.catMan=r.tapJ;',to:'r.catPh=\'side\';r.catMan=r.tapJ-r.tapS;'},
 {n:'the direction of the roll is lost',from:'r.catSg=r.tapS;r.catCush=false;r.catT=0;',to:'r.catSg=1;r.catCush=false;r.catT=0;'},
 {n:'the tap is not counted in the chain',from:'r.tapN=(r.tapN|0)+1;r.tapPend=true;',to:'r.tapPend=true;'},
 {n:'a tap that lands is not counted',from:'if(r.tapPend){CAS.tapOk++;r.tapPend=false;if(r.tapHit){CAS.hitOk++;r.tapHit=false;}}',to:''},
 {n:'a tap that fails is not counted',from:'if(r.tapPend){CAS.tapFail++;r.tapPend=false;}',to:''},
 {n:'the look at the lanes is not started at the release',from:'r.tapPend=true;CAS.tap++;r.tbEv=0;',to:'r.tapPend=true;CAS.tap++;'},
 {n:'the deep band is never accepted',from:'!(TP.deep&&TP.deep.on&&',to:'!(false&&'},
 {n:'the deep switch is ignored',from:'TP.deep&&TP.deep.on&&',to:'TP.deep&&'},
 {n:'any depth is deep',from:'b.pinDx>=TP.deep.min&&b.pinDx<=TP.deep.max',to:'true'},
 {n:'the deep band has no deep edge',from:'b.pinDx>=TP.deep.min&&b.pinDx<=TP.deep.max',to:'b.pinDx<=TP.deep.max'},
 {n:'the deep band has no shallow edge',from:'b.pinDx>=TP.deep.min&&b.pinDx<=TP.deep.max',to:'b.pinDx>=TP.deep.min'},
 {n:'a deep ball is never marked',from:'const deep=b.pinDx<CA.side.back;',to:'const deep=false;'},
 {n:'every tapped ball is marked deep',from:'const deep=b.pinDx<CA.side.back;',to:'const deep=true;'},
 {n:'an ending leaves the deep mark up',from:'r.catCush=false;r.catDeep=false;',to:'r.catCush=false;'},
 {n:'a deep roll is judged by the shallow limit',from:'rel<(deep?CA.tap.deep.back:SD.back)-1',to:'rel<SD.back-1'},
 {n:'every roll is judged by the deep limit',from:'rel<(deep?CA.tap.deep.back:SD.back)-1',to:'rel<CA.tap.deep.back-1'},
 {n:'the tap from retrieve does not take the action over',from:"r.act='catch';r.actT=0;r.retPh=null;",to:"r.actT=0;r.retPh=null;"},
 {n:'the tap from retrieve leaves retrieve running',from:'r.retPh=null;r.retMan=-1;r.retDir=0;',to:'r.retMan=-1;r.retDir=0;'},
 {n:'the tap from retrieve never starts the run',from:'r.retCd=AIC.retrieve.cd;\n tapStart(r);',to:'r.retCd=AIC.retrieve.cd;'},
 {n:'the tap from retrieve sets no lockout',from:'r.retZ=null;r.retCd=AIC.retrieve.cd;',to:'r.retZ=null;'},
 {n:'the tap from retrieve is not counted',from:'BGS.retEnd++;CAS.retTap++;',to:'BGS.retEnd++;'},
 {n:'an ending leaves the chain count up',from:'r.tapN=0;r.tapPk=null;r.catCush=false;',to:'r.tapPk=null;r.catCush=false;'},
 {n:'a lost ball is waited on',from:"if(!b||r.force||r.catT>TP.abortT){catchEnd(r,CA.cd,!b?'tap:lost':r.force?'tap:force':'tap:time');return;}",to:"if(!b)return;if(r.force||r.catT>TP.abortT){catchEnd(r,CA.cd,r.force?'tap:force':'tap:time');return;}"},
 {n:'a run is never given up on',from:'||r.catT>TP.abortT){catchEnd(r,CA.cd,!b',to:'){catchEnd(r,CA.cd,!b'},
 {n:"a forward leg has no band of its own",from:"const fb=r.angle*r.kickDir>CA.recv.fwdMin?TP.fwd:null;",to:"const fb=null;"},
 {n:"...every pin has the forward one",from:"const fb=r.angle*r.kickDir>CA.recv.fwdMin?TP.fwd:null;",to:"const fb=TP.fwd;"},
 {n:"the forward band has no near edge",from:"(fb?(b.pinDx<fb.min||b.pinDx>fb.max):",to:"(fb?(b.pinDx<fb.min):"},
 {n:"the forward band has no deep edge",from:"(fb?(b.pinDx<fb.min||b.pinDx>fb.max):",to:"(fb?(b.pinDx>fb.max):"}
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
