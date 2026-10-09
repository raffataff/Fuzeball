// meet harness (a man slides to meet a slow ball). node tools/meet-harness.js
// slices the real catch block (meetPick / meetStep / catchPick / catchStep / catchEnd, ai.js) and runs it against live CONFIG with bare-bones rods
// question: does an AI rod take a slow ball along its row that no man will roll into (the nearest man ahead of it in its roll, with no man already on it), slide that man to it fast while far and
// closing at closeV when near, raise the men until the pin pose is due just before he is there, and leave faster balls, balls on a man, balls rolling away and everything else to the old code; each mutation must break an assertion
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
 "function stCd(){return 1;} function stReact(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.catch,
  ';globalThis.X={S:S,AIC:AIC,SHOT:SHOT,DIFFS:DIFFS,F:F,ARM:ARM,ROD_H:ROD_H,BALL_R:BALL_R,rods:rods,CAS:CAS,CAW:CAW,meetPick:meetPick,meetStep:meetStep,sidePick:sidePick,sideAngle:sideAngle,catchPick:catchPick,catchStep:catchStep,catchEnd:catchEnd};'].join(NL),ctx);
 return ctx.X;
}

// the red ATT (x 22.5, attacking +x), three men 18.5 apart, nobody else on the table
function world(X,over){
 X.S.time=0;X.S.balls=[];for(const k in X.CAW)delete X.CAW[k];for(const k in X.CAS)X.CAS[k]=0;
 const r=Object.assign({x:22.5,team:0,kickDir:1,role:'ATT',aiIQ:true,baseZ:[-18.5,0,18.5],maxOff:11.5,removedUntil:[],offset:0,target:0,slideV:0,angle:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:null,catPh:null,catT:0,catMan:-1,catSg:1,catCush:false,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0},over||{});
 X.rods.length=0;X.rods.push(r);return r;
}
function view(X,rel,z,vx,vz,y){const b={scored:false,m:{position:{x:22.5+rel,y:y==null?1.9:y,z:z}},v:{x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.y,this.z);}}};b.real=b;return b;}
const dt=1/120,D0={cd:1};

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const MT=X.AIC.catch.meet,SD=X.AIC.catch.side,CA=X.AIC.catch;
 const pick=(rel,z,vx,vz,over)=>{const r=world(X,over);const b=view(X,rel,z,vx,vz);return {r,got:X.meetPick(r,b)};};
 const v=3;

 // ---- which balls ----
 {const p=pick(-1.0,-9,0,v);ok('a slow ball rolling along the row toward a man no man will roll into: the man ahead of it takes it, and goes toward it',p.got&&p.r.catMan===1&&p.r.catSg===-1,'man '+p.r.catMan+' sg '+p.r.catSg);}
 {const p=pick(-1.0,9,0,-v);ok('...either way along the row',p.got&&p.r.catMan===1&&p.r.catSg===1);}
 {const p=pick(-1.0,-20,0,v,{baseZ:[-10,10,30],maxOff:40});ok('the nearest man ahead of it (the least slide), not the first or the last',p.got&&p.r.catMan===0,'man '+p.r.catMan);}
 {ok('not a man behind it (it would have to chase it, and pushes it)',!pick(-1.0,-9,0,v,{baseZ:[-18.5]}).got);}
 {ok('...though one ahead of it is picked past one behind',pick(-1.0,-9,0,v,{baseZ:[-18.5,0]}).got);}
 {ok('not with a man already on it (the lift would clip it)',!pick(-1.0,-(MT.clear-0.1),0,v).got&&pick(-1.0,-(MT.clear+0.1),0,v).got);}
 {ok('...nor one just behind it',!pick(-1.0,-18.5+MT.clear-0.1,0,v,{maxOff:20}).got&&pick(-1.0,-18.5+MT.clear+0.1,0,v,{maxOff:20}).got);}
 {ok('not at rest (retrieve\'s)',!pick(-1.0,-9,0,MT.minV-0.1).got&&pick(-1.0,-9,0,MT.minV+0.1).got);}
 {ok('not a quick one (received by the side catch)',!pick(-1.0,-9,0,MT.maxV+0.1).got&&pick(-1.0,-9,0,MT.maxV-0.1).got);}
 {ok('not a ball that is also running up the table',!pick(-1.0,-9,SD.maxVX+1,v).got);}
 {ok('not too deep (the dropping boot would land on it)',!pick(SD.back-0.1,-9,0,v).got&&pick(SD.back+0.1,-9,0,v).got);}
 {ok('not in front of where the leg reaches',!pick(SD.front+0.1,-9,0,v).got&&pick(SD.front-0.1,-9,0,v).got);}
 {ok('not a man too far off to slide to',!pick(-1.0,-(MT.far+5),0,v,{baseZ:[0],maxOff:40}).got&&pick(-1.0,-(MT.far-5),0,v,{baseZ:[0],maxOff:40}).got);}
 {ok('not a man whose slide cannot reach the ball\'s z',!pick(-1.0,-(5+MT.zTol+0.1),0,v,{baseZ:[0],maxOff:5}).got&&pick(-1.0,-(5+MT.zTol-0.1),0,v,{baseZ:[0],maxOff:5}).got);}
 {ok('not a man a cannonball took',!pick(-1.0,-9,0,v,{baseZ:[0],removedUntil:[1e9]}).got);}
 {const was=MT.on;MT.on=false;const p=pick(-1.0,-9,0,v);MT.on=was;ok('meet.on false: no meet',!p.got);}
 {const r=world(X);const b=view(X,-1.0,-9,0,v);ok('catchPick says meet for it',X.catchPick(r,b)==='meet');
  const q=world(X);ok('...and side for a ball a man will roll into by himself (the side catch comes first)',X.catchPick(q,view(X,-1.0,-8,0,10))==='side');
  const f=world(X);ok('...and front for a ball running at the rod',X.catchPick(f,view(X,9,0,-20,0))==='front');}

 // ---- the approach ----
 const step=(over,rel,z,vz,dz)=>{const r=world(X,Object.assign({act:'catch',catPh:'meet',catMan:1,catSg:-1},over||{}));X.catchStep(r,view(X,rel,z,0,vz),D0);return r;};
 const vmax=X.DIFFS.pro.speed*MT.use;
 const spd=(r)=>(r.target-r.offset)/dt;
 {const r=step(null,-1.0,-9,v);ok('the man slides toward the ball, the men up and the pose off',spd(r)<0&&r.raise&&!r.pinPose&&!r.pinOn&&r.aiMan===1,'speed '+spd(r).toFixed(1));}
 {const r=step({catSg:1},-1.0,9,-v);ok('...either way along the row',spd(r)>0);}
 {const r=step(null,-1.0,-9,v);ok('far off he runs flat out (the rod\'s speed less a margin)',Math.abs(spd(r)+vmax)<1e-6,spd(r).toFixed(2)+' vs '+vmax.toFixed(2));}
 {const r=step(null,-1.0,-MT.slow,v);ok('from slow off he closes at closeV: his speed plus the ball\'s own is closeV',Math.abs(-spd(r)+v-MT.closeV)<1e-6,(-spd(r)).toFixed(2));}
 {const r=step(null,-1.0,-MT.slow,3.5);ok('...whatever the ball does (a quicker ball is met more slowly)',Math.abs(-spd(r)+3.5-MT.closeV)<1e-6);}
 {const r=step(null,-1.0,-MT.slow,MT.closeV+5);ok('a ball already closing faster than that: he stands (it arrives by itself)',spd(r)===0);}
 {const a=step(null,-1.0,-(MT.slow+1),v),b=step(null,-1.0,-(MT.slow+4),v);ok('he brakes as he nears: the planned braking, not the rod\'s limit',-spd(a)<-spd(b)&&-spd(a)>MT.closeV-v&&Math.abs(spd(a)+Math.sqrt((MT.closeV-v)**2+2*MT.brake))<1e-6,(-spd(a)).toFixed(1)+' / '+(-spd(b)).toFixed(1));}
 {const r=step({slideV:-6},-1.0,-6.0,v);ok('the pose goes on this long before he is there (at the closing speed he has)',r.pinPose&&r.pinOn&&!r.raise,'pose '+r.pinPose);}
 {const r=step({slideV:-6},-1.0,-7.0,v);ok('...and not before',!r.pinPose&&r.raise);}
 {let all=true,info=[];for(const rel of [-0.6,-1.0,-1.5,-2.0]){const r=step({slideV:-6},rel,-2.5,v);info.push(r.pinA==null?'-':r.pinA.toFixed(2));if(!(r.pinPose&&r.pinA!=null&&Math.abs(r.pinA-X.sideAngle(rel))<1e-9))all=false;}
  ok('the pose is the side catch\'s: the leg held clear of the ball at the angle for its depth',all,info.join(' '));}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1});const real=view(X,-1.0,-MT.slow,0,v);const seen=view(X,-1.0,-MT.slow,0,0);seen.real=real;X.catchStep(r,seen,D0);
  ok('it reads the real ball, not the delayed view',Math.abs(-spd(r)-(MT.closeV-v))<1e-6,(-spd(r)).toFixed(2));}

 // ---- a catch, and the ways it ends ----
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1});r.pinB={m:{position:{x:22,y:1.9,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.catchStep(r,view(X,-0.7,0,0,0),D0);
  ok('once the pin takes it the action is the ordinary hold, counted as a meet that landed',r.catPh==='hold'&&r.pinPose&&r.aiMan===1&&X.CAS.meetOk===1,'meetOk '+X.CAS.meetOk);}
 {const r=world(X,{act:'catch',catPh:'front'});r.pinB={m:{position:{x:22,y:1.9,z:0}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,scored:false};X.catchStep(r,view(X,-0.7,0,0,0),D0);ok('...a front catch that pins is not counted as one',X.CAS.meetOk===0);}
 {const r=step({baseZ:[0],catMan:0,offset:-9},-1.0,-9+MT.passed+0.2,v);
  ok('slid on past it: done, and free to pick the next ball at once',r.act===null&&X.CAW['meet:miss']===1&&r.catCd===CA.cd,JSON.stringify(X.CAW));}
 {const r=step({baseZ:[0],catMan:0,offset:-9},-1.0,-9+MT.passed-0.3,v);ok('...but not while it is still just ahead of him',r.act==='catch');}
 {const r=step({baseZ:[0],catMan:0,maxOff:5},-1.0,-(5+MT.zTol+1.1),v);ok('it rolled out of reach of his slide: done',r.act===null&&X.CAW['meet:range']===1,JSON.stringify(X.CAW));}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1,catT:MT.abortT});X.catchStep(r,view(X,-1.0,-9,0,v),D0);ok('too long: done',r.act===null&&X.CAW['meet:time']===1);}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1,force:true});X.catchStep(r,view(X,-1.0,-9,0,v),D0);ok('a dead-ball push: done',r.act===null&&X.CAW['meet:force']===1);}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1});X.catchStep(r,view(X,-1.0,-9,0,v,5),D0);ok('lifted off the floor: done',r.act===null&&X.CAW['meet:lifted']===1);}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1});X.catchStep(r,view(X,SD.back-1.5,-9,0,v),D0);ok('it left the row: done',r.act===null&&X.CAW['meet:off']===1);}
 {const r=world(X,{act:'catch',catPh:'meet',catMan:1,catSg:-1});const b=view(X,-1.0,-9,0,v);b.real.scored=true;X.catchStep(r,b,D0);ok('scored: done',r.act===null&&X.CAW['meet:scored']===1);}
 {const r=step(null,-1.0,-9,0.2);ok('a ball that has stopped on the way is still met (he carries on and takes it)',r.act==='catch'&&spd(r)<0);}
 return R;
}

let bad=0;
const res=suite(boot());
console.log(NL+'=== a man slides to meet a slow ball ===');
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info?'   ['+t.info+']':''));}
console.log(NL+'  '+(res.length-bad)+' passed, '+bad+' failed'+NL);

console.log('=== mutations: each must break an assertion ===');
const MUT=[
 {n:'any lateral speed will do (no floor)',from:'||sp<MT.minV||sp>MT.maxV)return false;',to:'||sp>MT.maxV)return false;'},
 {n:'any lateral speed will do (no ceiling)',from:'||sp<MT.minV||sp>MT.maxV)return false;',to:'||sp<MT.minV)return false;'},
 {n:'any x speed will do',from:'||Math.abs(v.x)>SD.maxVX||sp<MT.minV',to:'||sp<MT.minV'},
 {n:'any depth will do',from:'rel<SD.back||rel>SD.front||Math.abs(v.x)>SD.maxVX||sp<MT.minV',to:'Math.abs(v.x)>SD.maxVX||sp<MT.minV'},
 {n:'the front edge is gone',from:'rel<SD.back||rel>SD.front||Math.abs(v.x)>SD.maxVX||sp<MT.minV',to:'rel<SD.back||Math.abs(v.x)>SD.maxVX||sp<MT.minV'},
 {n:'a man on the ball is no reason to refuse',from:'if(Math.abs(ahead)<MT.clear)return false;',to:''},
 {n:'only a man AHEAD is looked at for the clearance',from:'if(Math.abs(ahead)<MT.clear)return false;',to:'if(ahead>0&&ahead<MT.clear)return false;'},
 {n:'a man behind it is picked (the chase)',from:'if(ahead>0&&Math.abs(p.z-(r.baseZ[i]+o))<=MT.zTol',to:'if(Math.abs(p.z-(r.baseZ[i]+o))<=MT.zTol'},
 {n:'the FARTHEST slide wins',from:'&&d<=MT.far&&d<bd){bd=d;bi=i;}',to:'&&d<=MT.far&&(bi<0||d>bd)){bd=d;bi=i;}'},
 {n:'a slide of any length will do',from:'&&d<=MT.far&&d<bd)',to:'&&d<bd)'},
 {n:'a man that cannot reach its z is picked',from:'Math.abs(p.z-(r.baseZ[i]+o))<=MT.zTol&&d<=MT.far',to:'d<=MT.far'},
 {n:'a cannonballed man is picked',from:'if(!manLive(r,i))continue;\n  const ahead=',to:'const ahead='},
 {n:'it only rolls one way',from:'sg=Math.sign(v.z);\n if(!MT',to:'sg=1;\n if(!MT'},
 {n:'the switch is ignored',from:'if(!MT||!MT.on||rel<SD.back',to:'if(!MT||rel<SD.back'},
 {n:'the man goes AWAY from the ball',from:'r.catMan=bi;r.catSg=-sg;r.catCush=false;',to:'r.catMan=bi;r.catSg=sg;r.catCush=false;'},
 {n:'catchPick never asks for a meet',from:"if(meetPick(r,best))return 'meet';",to:''},
 {n:'a meet comes before the side catch',from:"if(sidePick(r,best))return 'side';\n if(meetPick(r,best))return 'meet';",to:"if(meetPick(r,best))return 'meet';\n if(sidePick(r,best))return 'side';"},
 {n:'the meet branch is gone from catchStep',from:"if(r.catPh==='meet'){meetStep(r,best);return;}",to:''},
 {n:'a landed meet is not counted',from:"if(r.catPh==='meet')CAS.meetOk++;",to:''},
 {n:'every pin counts as a landed meet',from:"if(r.catPh==='meet')CAS.meetOk++;",to:'CAS.meetOk++;'},
 // the approach
 {n:'he slides AWAY from the ball',from:'r.target=clamp(r.offset+e*mu*dt,-r.maxOff,r.maxOff);\n const tA',to:'r.target=clamp(r.offset-e*mu*dt,-r.maxOff,r.maxOff);\n const tA'},
 {n:'he runs at the closing speed all the way (no rush while far)',from:'Math.sqrt(u*u+2*MT.brake*Math.max(0,dist-MT.slow))',to:'u'},
 {n:'he never brakes (flat out to the end)',from:'Math.min(DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*MT.use,Math.sqrt(u*u+2*MT.brake*Math.max(0,dist-MT.slow)))',to:'DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*MT.use'},
 {n:'he runs at the rod\'s whole speed, no margin',from:'DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*MT.use,Math.sqrt',to:'DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),Math.sqrt'},
 {n:'he closes without allowing for the ball\'s own speed',from:'u=Math.max(0,MT.closeV+bu)',to:'u=MT.closeV'},
 {n:'a ball already closing fast is run into',from:'u=Math.max(0,MT.closeV+bu)',to:'u=Math.abs(MT.closeV+bu)'},
 {n:'the braking never starts (the slow distance is the whole way)',from:'Math.max(0,dist-MT.slow)',to:'Math.max(0,dist)'},
 {n:'the pose goes on at once',from:'if(tA<=MT.dropT){r.pinOn=true',to:'if(true){r.pinOn=true'},
 {n:'the pose never goes on',from:'if(tA<=MT.dropT){r.pinOn=true',to:'if(false){r.pinOn=true'},
 {n:'the pose time ignores the closing speed',from:'/Math.max(r.slideV*e-bu,1);',to:'/Math.max(1,1);'},
 {n:'the pose is the fixed pin angle, whatever the ball\'s depth',from:'r.pinA=sideAngle(rel,r.catFwd)*dir;r.raise=false;}',to:'r.pinA=CA.front.angle*dir;r.raise=false;}'},
 {n:'the men are never lifted',from:'else catchUp(r);\n}\n// is this ball',to:'else{r.pinOn=false;r.pinPose=false;r.pinA=null;}\n}\n// is this ball'},
 {n:'the step reads the delayed view',from:'rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,m=r.catMan;',to:'rb=best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,m=r.catMan;'},
 // the ends
 {n:'a ball that is out of his reach is waited on',from:"else if(Math.abs(p.z-(r.baseZ[m]+o))>MT.zTol+1)why='range';else if(d*r.catSg<-MT.passed)why='miss';",to:"else if(d*r.catSg<-MT.passed)why='miss';"},
 {n:'sliding on past it is not noticed',from:"else if(Math.abs(p.z-(r.baseZ[m]+o))>MT.zTol+1)why='range';else if(d*r.catSg<-MT.passed)why='miss';",to:"else if(Math.abs(p.z-(r.baseZ[m]+o))>MT.zTol+1)why='range';"},
 {n:'a meet is never given up on',from:"else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1||Math.abs(v.x)>SD.maxVX*2)why='off';\n else if(Math.abs(p.z",to:"else if(r.force)why='force';\n else if(rel<SD.back-1||rel>SD.front+1||Math.abs(v.x)>SD.maxVX*2)why='off';\n else if(Math.abs(p.z"},
 {n:'a dead-ball push does not stop it',from:"else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1||Math.abs(v.x)>SD.maxVX*2)why='off';\n else if(Math.abs(p.z",to:"else if(r.catT>MT.abortT)why='time';\n else if(rel<SD.back-1||rel>SD.front+1||Math.abs(v.x)>SD.maxVX*2)why='off';\n else if(Math.abs(p.z"},
 {n:'a lifted ball is still waited on',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';",to:"if(rb.scored)why='scored';else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';"},
 {n:'a ball that left the row is still waited on',from:"else if(rel<SD.back-1||rel>SD.front+1||Math.abs(v.x)>SD.maxVX*2)why='off';\n else if(Math.abs(p.z",to:"else if(Math.abs(p.z"},
 {n:'a scored ball is still waited on',from:"if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';",to:"if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';"}
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
