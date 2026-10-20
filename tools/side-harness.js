// side-catch harness. node tools/side-harness.js
// slices the real catch block (sidePick / sideAngle / sideStep / catchPick / catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: does an AI rod lift for a ball rolling along its row, drop the pin pose onto it just before it arrives at the angle that holds the leg clear of it, cushion a quick one by running along with it,
// let a quicker one roll on through, and leave everything else (balls running at the rod, off the row, too close, too slow, too deep) to the old code; each mutation must break an assertion
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
 "var RNGV=0.99; function rngAi(){return function(){return RNGV;};}",
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),   // physics.js: the foot box ai.js footAngle measures against
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()   // physics.js: the swing played from the pin
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,F:F,DIFFS:DIFFS,ARM:ARM,ROD_H:ROD_H,BALL_R:BALL_R,PRAD:PRAD,rods:rods,CAS:CAS,CAW:CAW,sidePick:sidePick,sideAngle:sideAngle,footAngle:footAngle,footBoxD:footBoxD,SHOT:SHOT,sideStep:sideStep,catchPick:catchPick,catchStep:catchStep,catchEnd:catchEnd,setSweep:function(v){SWEEP=v;}};'].join(NL),ctx);
 return ctx.X;
}

// the red ATT (x 22.5, attacking +x), three men at -12 / 0 / 12, nobody else on the table
function world(X,over){
 X.S.time=0;X.S.balls=[];X.setSweep(false);for(const k in X.CAW)delete X.CAW[k];
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:'ATT',aiIQ:true,baseZ:[-12,0,12],maxOff:9,removedUntil:[],offset:0,target:3,slideV:0,angle:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:'catch',catPh:'side',catT:0,catMan:1,catSg:1,catCush:false,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0},over||{});
 X.rods.length=0;X.rods.push(r);return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?1.9:y,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
const dt=1/120,D0={cd:1};

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const SD=X.AIC.catch.side;
 const pick=(rel,z,vx,vz,over)=>{const r=world(X,over);const b=view(X,rel,z,vx,vz);return {r,got:X.sidePick(r,b)};};
 // how far the foot box is from a ball lying rel ahead of the rod at rod-local angle a (pinUpdate's own measure), less the ball's reach
 const footGap=(a,rel)=>X.footBoxD({x:0,kickDir:1,angle:a},{x:rel,y:X.BALL_R,z:0},0,[0,0])-X.BALL_R;

 // ---- which balls ----
 {const p=pick(-3.0,-8,0,10);ok('a ball rolling along the row toward a man is one to receive, and the man is the first it meets',p.got&&p.r.catMan===1&&p.r.catSg===1,'man '+p.r.catMan);}
 {const p=pick(-3.0,8,0,-10);ok('...either way along the row',p.got&&p.r.catMan===1&&p.r.catSg===-1);}
 {const p=pick(-3.0,-20,0,10,{baseZ:[-12,0,12]});ok('...past a man that is behind it, to the next one ahead',p.got&&p.r.catMan===0,'man '+p.r.catMan);}
 {const p=pick(-3.0,-6,0,14,{removedUntil:[0,1e9,0]});ok('a man a cannonball took is not the one it is received by',p.got&&p.r.catMan===2,'man '+p.r.catMan);}
 {ok('not too slow (retrieve\'s)',!pick(-3.0,-8,0,SD.minV-1).got);}
 {ok('not too quick (a shot to block)',!pick(-3.0,-8,0,SD.maxV+1).got);}
 {ok('not a ball that is also running up the table',!pick(-3.0,-8,SD.maxVX+1,10).got);}
 {ok('not deeper than the pin\'s own window',!pick(X.SHOT.pin.back-0.1,-8,0,10).got&&pick(X.SHOT.pin.back+0.3,-8,0,10).got);}
 {ok('not under the rod, where no foot can come down on it',!pick(-1.00,-8,0,10).got&&!pick(1.5,-8,0,10).got&&pick(-2.0,-8,0,10).got);}
 {ok('not a man it is already on top of (the lift would clip it)',!pick(-3.0,-SD.near+0.5,0,10,{baseZ:[0]}).got&&pick(-3.0,-SD.near-0.5,0,10,{baseZ:[0]}).got);}
 {ok('not a ball that is not going to reach a man (rolling away from the last one)',!pick(-3.0,14,0,10).got);}
 {ok('not one that is too long in coming',!pick(-3.0,-8,0,10,{baseZ:[0],offset:SD.tMax*10+0.5-8}).got&&pick(-3.0,-8,0,10,{baseZ:[0],offset:SD.tMax*10-0.5-8}).got);}
 {ok('not one that is on the man before there is time to lift',!pick(-3.0,-(SD.near+0.2),0,30,{baseZ:[0]}).got&&pick(-3.0,-(SD.near+0.2),0,SD.minV+1,{baseZ:[0]}).got);}
 {const p=pick(-3.0,-8,0,SD.pinV+4);ok('a quick one is picked too (to cushion, or let through)',p.got);
  SD.through=false;const q=pick(-3.0,-8,0,SD.pinV+4);SD.through=true;
  ok('...unless through is off',!q.got);}
 {const was=SD.on;SD.on=false;const p=pick(-3.0,-8,0,10);SD.on=was;ok('side.on false restores the old catch',!p.got);}
 {const r=world(X,{act:null});const b=view(X,-3.0,-8,0,10);ok('catchPick says side for it',X.catchPick(r,b)==='side');
  const f=view(X,9,0,-20,0);ok('...and still front for a ball running at the rod',X.catchPick(world(X,{act:null}),f)==='front');}

 // ---- the stance and the drop ----
 const step=(rel,z,vz,over)=>{const r=world(X,over);const b=view(X,rel,z,0,vz);X.catchStep(r,b,D0);return r;};
 // a ball rolling along the row AHEAD of the rod (a tap from a ball held ahead, or any ball that is): a forward leg comes down on it from above
 {const p=pick(4,-8,0,10);ok('a ball rolling along the row ahead of the rod is received, under a forward leg, by the first man it meets',p.got&&p.r.catFwd===true&&p.r.catMan===1,'fwd='+p.r.catFwd);
  ok('...from where the forward foot first reaches out to fwdFront and not beyond either way',pick(3.1,-8,0,10).got&&!pick(2.5,-8,0,10).got&&pick(SD.fwdFront-0.1,-8,0,10).got&&!pick(SD.fwdFront+0.3,-8,0,10).got);}
 {const r=step(4.4,-2,10,{catFwd:true});ok('...close enough to drop: the forward foot comes down on it, a forward pin',r.pinOn&&r.pinPose&&r.pinFwd===true&&Math.abs(r.pinA-X.footAngle(4.4,true))<1e-9,'pinA='+r.pinA+' fwd='+r.pinFwd);
  const f=step(4.4,-8,10,{catFwd:true});ok('...far: the leg is up and forward, no forward pin yet',!f.pinOn&&f.pinPose&&!f.pinFwd&&Math.abs(f.pinA-X.AIC.catch.recv.lift.angle)<1e-9);
  const n=pick(-3.0,-8,0,10);ok('...a ball behind the rod is taken by the back foot (forward or back is where it is)',n.got&&n.r.catFwd===false);
  ok('...a side catch of a ball ahead goes on while it is inside fwdFront (and one over)',step(SD.fwdFront+0.5,-2,10,{catFwd:true}).act==='catch'&&step(SD.fwdFront+1.5,-2,10,{catFwd:true}).act===null&&step(SD.front+1.5,-2,10,{catFwd:false}).act===null);}
 const v=10;
 {const r=step(-3.0,-8,v);ok('rolling in: the men are up and the pin pose is off',r.raise&&!r.pinPose&&!r.pinOn);
  ok('...and the rod does not slide (the ball comes to the man)',r.target===r.offset&&r.aiMan===1);}
 {const r=step(-3.0,-(SD.dropT-0.02)*v,v);ok('the pose drops this late before it arrives',r.pinPose&&r.pinOn,'ahead '+((SD.dropT-0.02)*v).toFixed(2));
  const q=step(-3.0,-(SD.dropT+0.05)*v,v);ok('...and not before',!q.pinPose&&q.raise);}
 {let all=true,info=[];for(const rel of [-2.0,-2.8,-3.5,-4.2]){const r=step(rel,-1,v),d=footGap(r.pinA,rel);info.push(d.toFixed(3));
   if(!(r.pinPose&&d>0&&Math.abs(d-SD.topGap)<0.01&&d<=X.SHOT.pin.touch))all=false;}
  ok('the pose holds the foot topGap above the ball at every depth (clear of it, inside the pin\'s touch)',all,info.join(' '));}
 {const a=step(-2.0,-1,v).pinA,b=step(-4.0,-1,v).pinA;ok('...which takes a deeper ball more tilted back',b<a,a.toFixed(2)+' vs '+b.toFixed(2));}
 {const r=world(X);const real=view(X,-3.0,-8,0,v);const seen=view(X,-3.0,-8,0,0);seen.real=real;X.catchStep(r,seen,D0);
  ok('it reads the real ball, not the delayed view (which still shows a ball that was held)',r.act==='catch'&&r.raise&&!X.CAW['side:slow'],JSON.stringify(X.CAW));}
 {const r=step(-3.4,-1,SD.cushionV+8);ok('a ball too quick even to cushion is let through: the men stay up all the way',!r.pinPose&&r.raise&&!r.catCush);}
 {const r=step(-3.4,0.4,v,{});ok('just past the man it is still being waited on (the pose holds)',r.pinPose&&r.act==='catch');}

 // ---- the cushion: a quick ball is met by a rod already running along with it ----
 const vq=22,cT=SD.cushionT,w=vq-SD.cushionW,eng=Math.min(cT*vq,SD.cushionD);   // the slide left to the man that the cushion starts from
 {const r=step(-3.2,-(eng-0.1),vq);ok('a ball the pin could not take is cushioned: the rod runs along with it',r.catCush&&r.target>r.offset,'target '+r.target.toFixed(3));
  ok('...at its speed less the margin it still closes on the man by',Math.abs((r.target-r.offset)/dt-w)<1e-6,((r.target-r.offset)/dt).toFixed(2)+' vs '+w);}
 {const r=step(-3.2,-(eng+0.1),vq);ok('...not before it is time',!r.catCush&&r.target===r.offset&&r.raise);}
 {const r=step(-3.2,(eng-0.1)*-1,-vq,{baseZ:[-12,0,12],catMan:1,catSg:-1});r.target;
  const q=world(X,{catSg:-1,catMan:1});X.catchStep(q,view(X,-3.2,(eng-0.1),0,-vq),D0);ok('...either way along the row',q.catCush&&q.target<q.offset);}
 {const off=9-(SD.cushionRoom-0.5),r=step(-3.2,off-(eng-0.1),vq,{offset:off});ok('no room to run: no cushion (it rolls on through)',!r.catCush&&r.raise);
  const q=step(-3.2,off-(eng-0.1),vq,{offset:off-SD.cushionRoom});ok('...but with the room it is cushioned',q.catCush);}
 {SD.cushion=false;const r=step(-3.2,-(eng-0.1),vq);SD.cushion=true;ok('cushion off: a quick ball is let through as before',!r.catCush&&!r.pinPose&&r.raise);}
 {const vs=SD.pinV+1;const a=step(-3.2,-(cT*vs+0.2),vs),b=step(-3.2,-(cT*vs-0.2),vs);ok('a ball only just over what the pin can take is cushioned at the time (cushionT), not from the distance cap',SD.cushionT*vs<SD.cushionD&&!a.catCush&&b.catCush,'cap '+SD.cushionD+' vs '+(cT*vs).toFixed(2));}
 {const vf=40;const a=step(-3.2,-(SD.cushionD+0.2),vf),b=step(-3.2,-(SD.cushionD-0.1),vf);ok('a quick ball is cushioned from no further off than the distance cap (the rod would run its whole slide before it was caught)',SD.cushionT*vf>SD.cushionD&&!a.catCush&&b.catCush);}
 {const sp=X.DIFFS.pro.speed;X.DIFFS.pro.speed=20;const lim=20+SD.pinV+SD.cushionSlack,a=step(-3.2,-(eng-0.1),lim+1.5),b=step(-3.2,-(eng-0.1),lim-0.5);X.DIFFS.pro.speed=sp;
  ok('a ball the rod could not match even flat out is let through (its speed plus what the pin takes plus a little)',!a.catCush&&a.raise&&b.catCush,'limit '+lim);}
 {const r=step(-3.2,-0.8,20,{slideV:12});ok('a rod already running along with the ball needs no cushion: the pin judges the difference',!r.catCush&&r.pinPose,'pose '+r.pinPose);}
 {const r=step(-3.2,-1,vq,{catCush:true,slideV:vq-SD.cushionW});ok('once cushioning it keeps running along (the ball is no longer quick against the rod)',r.target>r.offset&&r.catCush);}
 {const r=step(-3.2,-1,vq,{catCush:true,slideV:vq-SD.cushionW});ok('...and poses the pin, whatever the ball\'s own speed',r.pinPose&&r.pinOn);}

 // ---- a catch, and the ways it ends ----
 {const r=world(X);r.pinB={m:{position:{x:22,y:1.9,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.catchStep(r,view(X,-3.4,0,0,0),D0);
  ok('once the pin takes it the action is the ordinary hold (carry, shoot, pass)',r.catPh==='hold'&&r.pinPose&&r.aiMan===1);}
 {const r=step(-3.4,12+SD.passed+1,v,{baseZ:[0,12,24]});ok('rolled on past the man: done, and free to pick the next one at once',r.act===null&&r.catCd===0&&X.CAW['side:past']===1,JSON.stringify(X.CAW));}
 {const r=step(X.SHOT.pin.back-1.5,-8,v);ok('left the row: done, with the catch\'s own lockout',r.act===null&&r.catCd===X.AIC.catch.cd&&X.CAW['side:off']===1);}
 {const r=step(-3.4,-8,0.5);ok('it has died: done at once (retrieve takes a slow ball)',r.act===null&&r.catCd===0&&X.CAW['side:slow']===1);}
 {const b=view(X,-3.4,-8,0,v,5);const r=world(X);X.catchStep(r,b,D0);ok('lifted off the floor: done',r.act===null&&X.CAW['side:lifted']===1);}
 {const r=world(X,{force:true});X.catchStep(r,view(X,-3.4,-8,0,v),D0);ok('a dead-ball push: done',r.act===null&&X.CAW['side:force']===1);}
 {const r=world(X,{catT:SD.abortT});X.catchStep(r,view(X,-3.4,-8,0,v),D0);ok('too long: done',r.act===null&&X.CAW['side:time']===1);}
 {const r=world(X,{catPh:'front'});const b=view(X,5,0,-20,0);X.catchStep(r,b,D0);ok('a front catch is untouched by all of this (it poses, it does not sit raised)',r.catPh==='front'&&!r.raise);}
 return R;
}

let bad=0;
const res=suite(boot());
console.log(NL+'=== side catch ===');
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info?'   ['+t.info+']':''));}
console.log(NL+'  '+(res.length-bad)+' passed, '+bad+' failed'+NL);

console.log('=== mutations: each must break an assertion ===');
const MUT=[
 {n:'any x speed will do',from:'||Math.abs(v.x)>SD.maxVX||sp<SD.minV',to:'||sp<SD.minV'},
 {n:'a man it is already on top of is picked',from:'if(d>=SD.near&&d<=SD.far&&d<bd)',to:'if(d>=-9&&d<=SD.far&&d<bd)'},
 {n:'any depth will do',from:'rel<SHOT.pin.back||rel>SD.fwdFront||',to:'rel>SD.fwdFront||'},
 {n:'the forward edge is gone',from:'rel<SHOT.pin.back||rel>SD.fwdFront||',to:'rel<SHOT.pin.back||'},
 {n:'a ball ahead of the rod is not taken',from:'const ahead=rel>0;',to:'const ahead=false;'},
 {n:'a ball no foot can come down on is picked',from:'||footAngle(rel,ahead)==null)return false;',to:')return false;'},
 {n:'the foot angle ignores whether it is on top of the ball',from:'return FA_D[0]>=SHOT.pin.down?lo:null;',to:'return lo;'},
 {n:'a ball ahead is taken under a back leg',from:'r.catSg=sg;r.catCush=false;r.catFwd=ahead;',to:'r.catSg=sg;r.catCush=false;r.catFwd=false;'},
 {n:'a side catch ahead ends the moment it is past the old line',from:'rel>(r.catFwd?SD.fwdFront:SD.front)+1',to:'rel>SD.front+1'},
 {n:'the pose ahead is not a forward pin',from:'r.pinFwd=r.catFwd;r.pinA=fa*dir;}',to:'r.pinFwd=false;r.pinA=fa*dir;}'},
 {n:'it only rolls one way',from:'const sg=Math.sign(v.z);',to:'const sg=1;'},
 {n:'the FARTHEST man ahead is the one picked',from:'d<=SD.far&&d<bd)',to:'d<=SD.far&&d>bd)'},
 {n:'a cannonballed man is still picked',from:'if(!manLive(r,i))continue;\n  const d=(r.baseZ[i]+r.offset-p.z)*sg;',to:'const d=(r.baseZ[i]+r.offset-p.z)*sg;'},
 {n:'a quick ball is not picked (through off)',from:'||(sp>SD.pinV&&!SD.through)||',to:'||(sp>SD.pinV)||'},
 {n:'the time window is ignored',from:'bd/sp<SD.tMin||bd/sp>SD.tMax',to:'false'},
 {n:'catchPick never asks for a side catch',from:"if(sidePick(r,best))return 'side';",to:''},
 {n:'the pose goes on at once (no waiting for it to roll in)',from:'(r.catCush||cl<=SD.pinV)&&tA<=SD.dropT)',to:'(r.catCush||cl<=SD.pinV))'},
 {n:'the pose is the fixed pin angle, whatever the ball\'s depth',from:'r.pinFwd=r.catFwd;r.pinA=fa*dir;}',to:'r.pinFwd=r.catFwd;r.pinA=CA.front.angle*dir;}'},
 {n:'the pose ignores how far the foot is to be held from the ball',from:'R=BALL_R*FOOT_BOX_REACH+AIC.catch.side.topGap,',to:'R=BALL_R*FOOT_BOX_REACH+AIC.catch.side.topGap+0.5,'},
 {n:'a quick ball is posed at though nothing slows it',from:'if(fa!=null&&(r.catCush||cl<=SD.pinV)&&tA',to:'if(fa!=null&&tA'},
 {n:'the step reads the delayed view',from:'rb=best.real||best',to:'rb=best'},
 {n:'the men are never lifted',from:'r.pinA=fw?AIC.catch.recv.lift.angle*r.kickDir:null;r.raise=!fw;',to:'r.pinA=fw?AIC.catch.recv.lift.angle*r.kickDir:null;'},
 {n:'the rod slides after a ball it is not cushioning',from:'-r.maxOff,r.maxOff):r.offset;',to:'-r.maxOff,r.maxOff):r.offset+3;'},
 {n:'rolling on past waits out the lockout',from:"catchEnd(r,why==='past'||why==='slow'?0:CA.cd,'side:'+why)",to:"catchEnd(r,CA.cd,'side:'+why)"},
 {n:'a dead ball is waited on for ever',from:'else if(sp<SD.minV*0.5)why=\'slow\';else if(ahead<-SD.passed)why=\'past\';',to:'else if(ahead<-SD.passed)why=\'past\';'},
 {n:'it never gives up on a ball that has gone past',from:'else if(sp<SD.minV*0.5)why=\'slow\';else if(ahead<-SD.passed)why=\'past\';',to:'else if(sp<SD.minV*0.5)why=\'slow\';'},
 {n:'the side branch is gone from catchStep',from:"if(r.catPh==='side'){sideStep(r,best);return;}",to:''},
 {n:'a lifted ball is still waited on',from:'if(rb.scored)why=\'scored\';else if(p.y>AIC.lowY)why=\'lifted\';else if(r.force)why=\'force\';else if(r.catT>SD.abortT)why=\'time\';',to:'if(rb.scored)why=\'scored\';else if(r.force)why=\'force\';else if(r.catT>SD.abortT)why=\'time\';'},
 // the cushion
 {n:'no cushion at all',from:'if(!r.catCush&&quick&&',to:'if(false&&quick&&'},
 {n:'the cushion ignores the switch',from:'const quick=SD.cushion&&cl>SD.pinV',to:'const quick=cl>SD.pinV'},
 {n:'the cushion starts at once',from:'&&ahead<=Math.min(SD.cushionT*Math.max(cl,1),SD.cushionD))r.catCush=true;',to:')r.catCush=true;'},
 {n:'the cushion starts from the distance cap only (the time is ignored)',from:'Math.min(SD.cushionT*Math.max(cl,1),SD.cushionD)',to:'SD.cushionD'},
 {n:'the cushion has no distance cap',from:'Math.min(SD.cushionT*Math.max(cl,1),SD.cushionD)',to:'SD.cushionT*Math.max(cl,1)'},
 {n:'the speed of the rod itself is not asked about',from:'&&bv<=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)+SD.pinV+SD.cushionSlack',to:''},
 {n:'the slack on the rod speed is ignored',from:'+SD.pinV+SD.cushionSlack',to:'+SD.pinV'},
 {n:'the cushion tries a ball it cannot match',from:'&&bv<=SD.cushionV&&',to:'&&'},
 {n:'the cushion ignores the room it has',from:'&&(sg>0?r.maxOff-r.offset:r.offset+r.maxOff)>=SD.cushionRoom;',to:';'},
 {n:'the cushion runs at the ball\'s own speed (it never closes)',from:'Math.max(0,bv-SD.cushionW)',to:'Math.max(0,bv)'},
 {n:'the cushion runs the wrong way',from:'clamp(r.offset+sg*Math.max(0,bv-SD.cushionW)*dt',to:'clamp(r.offset-sg*Math.max(0,bv-SD.cushionW)*dt'},
 {n:'the cushion judges the ball alone, not against the rod',from:'cl=bv-r.slideV*sg;',to:'cl=bv;'},
 {n:'the cushion lets go the moment the ball is slow enough',from:'r.target=r.catCush?clamp(',to:'r.target=(r.catCush&&cl>SD.pinV)?clamp('}
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
