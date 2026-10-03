// retrieve harness. node tools/retrieve-harness.js
// slices the real retrieveStep / retrieveEnd / retrieveMan (ai.js) and helpers and steps them against live CONFIG with a bare-bones rod (slide and lift ease like updateRods, a pin takes when the leg is over the ball); the entry and bail tests live in aiUpdate and aren't covered
// pins the sequence: side (clear of the ball) > lift > over > pin / drop, in that order and never out of it; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 foot:slice(AI,'const _fb={nx:0',NL+'function sweepClips('),
 guard:slice(AI,'const BGS={lift:0',NL+'function clearOffset('),   // the retrieve block sits at its end
 clearOffset:slice(AI,'function clearOffset(r,bz,cz,prefer){',NL+'function nearestFootZ('),
 lane:slice(AI,'function inLaneZ(r,lz,cz){',NL+'function laneMate(')
};
const stubs=[
 "var S={balls:[],time:0}; var SEAT=null; function seatOf(){return SEAT;}",
 "var dbgLogRod=null; function dbgRod(){}",
 "var KICKS=[],STRIKE=true,RELEASED=0;",
 "function pinRelease(r){r.pinB=null;RELEASED++;}",
 "function kickRod(r,style){r.kickT=0;r.act=null;KICKS.push(style);}",
 "function strikeOn(){return STRIKE;} function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.foot,g.guard,g.clearOffset,g.lane,
  ';globalThis.X={S:S,AIC:AIC,KICK:KICK,SIM:SIM,BALL_R:BALL_R,ARM:ARM,retrieveStep:retrieveStep,retrieveMan:retrieveMan,'+
  'retrievePhase:retrievePhase,KICKS:KICKS,setStrike:function(v){STRIKE=v;},released:function(){return RELEASED;}};'].join(NL),ctx);
 return ctx.X;
}

/* A red keeper-style rod with `baseZ` men, in the state aiUpdate leaves it on entry to the action. */
function mkRod(X,over){
 return Object.assign({x:-52.5,team:0,kickDir:1,role:'MID',aiIQ:true,baseZ:[0],maxOff:10,removedUntil:[],offset:0,target:0,slideV:0,
  angle:0,raise:false,behindFlag:false,aiMan:-1,kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,
  act:'retrieve',retPh:'side',retT:0,retDir:0,retZ:null,retMan:-1,retHold:0,retCd:0},over||{});
}
function mkBall(X,rel,bz){const b={scored:false,m:{position:{x:-52.5+rel,y:X.BALL_R,z:bz}},v:{x:0,y:0,z:0}};X.S.balls=[b];return b;}
// run the action; returns {phase log, trace of {ph,raise,ang,off}}; the rod moves as updateRods moves it (slide capped at 40 u/s, exponential lift/drop/pin ease); `takePin:false` = a pin that never catches
function run(X,r,b,opt){
 opt=opt||{};const dt=1/X.SIM.hz,D={cd:1},tr=[],phases=[];
 const best={m:b.m,v:b.v,real:b,scored:false};
 const fin=Math.asin(Math.max(-0.95,Math.min(0.95,(b.m.position.x-r.x)/X.ARM)));
 for(let i=0;i<Math.round((opt.T||6)*X.SIM.hz)&&r.act==='retrieve';i++){
  X.retrieveStep(r,best,D);
  if(r.retPh&&r.retPh!==phases[phases.length-1])phases.push(r.retPh);   // retPh goes null when the action ends
  r.offset+=Math.max(-40*dt,Math.min(40*dt,r.target-r.offset));
  const tgt=(r.pinPose&&r.pinA!=null)?r.pinA:(r.raise?X.KICK.raiseA:0),rate=(r.pinPose&&r.pinA!=null)?X.AIC.retrieve.pinLead*0+14:(r.raise?X.KICK.raiseLerp:X.KICK.dropLerp);
  r.angle+=(tgt-r.angle)*Math.min(1,rate*dt);
  if(r.pinPose&&!r.pinB&&opt.takePin!==false&&r.angle>=fin-0.06&&Math.abs(r.offset+r.baseZ[0]-b.m.position.z)<1.5)r.pinB=b;
  tr.push({ph:r.retPh,raise:r.raise,ang:r.angle,off:r.offset,pinA:r.pinA,pose:r.pinPose,pinB:!!r.pinB,act:r.act});
 }
 return {phases,tr};
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const order=(ph)=>{const want=['side','lift','over','pin','drop'];let k=-1;for(const p of ph){const j=want.indexOf(p);if(j<k)return false;k=j;}return true;};
 // ---- the sequence, ball beside a man ------------------------------------------------------------------
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-1.5,1.0);const o=run(X,r,b);
  ok('a man on the ball steps clear, lifts, slides over, pins, then plays the pin shot (phases in order)',o.phases.join('>')==='side>lift>over>pin','phases='+o.phases.join('>'));
  const firstLift=o.tr.findIndex(t=>t.raise);
  ok('the boot is never raised while a man still overlaps the ball lane',o.tr.slice(0,Math.max(0,firstLift)).every(t=>t.ph==='side'||!t.raise)&&firstLift>0&&
   Math.abs(o.tr[firstLift].off+r.baseZ[0]-b.m.position.z)>3.3,'first lift at dz='+(firstLift>0?Math.abs(o.tr[firstLift].off-b.m.position.z).toFixed(2):'-'));
  ok('the slide to the ball starts only after the boot is over it',(()=>{const i=o.tr.findIndex(t=>t.ph==='over');return i>=0&&o.tr[i].ang<-0.5;})());   // a ball 1.5 behind is passed at ~-0.75: the boot is then behind it and every contact faces forward
  ok('a pin takes and exactly one pin shot is played',X.KICKS.length===1&&X.KICKS[0]==='trapShot','kicks='+X.KICKS.join(','));
  ok('the action winds up clean: act cleared, pin flags down',r.act===null&&!r.pinOn&&!r.pinPose&&r.pinA===null&&r.retCd>0);}
 // ---- direction ----------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:3});const b=mkBall(X,-1.5,1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('the man on the ball (at +z of it) steps away to +z, not through it',r.retDir===1&&r.target>r.offset,'retDir='+r.retDir+' tgt='+r.target);}
 {const r=mkRod(X,{offset:-3});const b=mkBall(X,-1.5,-1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('…and at -z of it, to -z',r.retDir===-1&&r.target<r.offset,'retDir='+r.retDir+' tgt='+r.target);}
 {const r=mkRod(X,{offset:9.9,baseZ:[0]});const b=mkBall(X,-1.5,8.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('pinned at his slide limit with the only way clear THROUGH a close ball: give up rather than push past it',r.act===null&&r.retCd>=X.AIC.retrieve.cd*2-1e-9,'act='+r.act);}
 {const r=mkRod(X,{offset:9.9,baseZ:[0]});const b=mkBall(X,-4.5,8.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('…but a ball beyond the reach of a passing boot may be crossed',r.act==='retrieve'&&r.retDir===-1,'act='+r.act+' retDir='+r.retDir);}
 // ---- the pin --------------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b);
  const pinning=o.tr.filter(t=>t.ph==='pin'&&t.pose&&!t.pinB);
  ok('the pin pose LEADS the boot by no more than pinLead on the way down (the catch stays armed)',pinning.length>3&&pinning.every(t=>Math.abs(t.pinA-t.ang)<=X.AIC.retrieve.pinLead+0.011),'max lead='+Math.max(...pinning.map(t=>Math.abs(t.pinA-t.ang))).toFixed(3));}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b);
  const held=o.tr.filter(t=>t.pinB).length;
  ok('a caught ball is held for settleT before it is played',held*(1/X.SIM.hz)>=X.AIC.retrieve.settleT-0.02,'held='+(held/X.SIM.hz).toFixed(2)+'s');}
 {X.KICKS.length=0;X.setStrike(false);const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{T:4});X.setStrike(true);
  ok('when the strike gate refuses the pin shot the rod DROPS instead of swinging at nothing',X.KICKS.length===0&&o.phases.includes('drop'),'kicks='+X.KICKS.length+' phases='+o.phases.join('>'));}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{takePin:false,T:5});
  ok('a pin that never takes falls back to the drop (pinT), with no kick',o.phases.join('>').endsWith('pin>drop')&&X.KICKS.length===0,'phases='+o.phases.join('>'));}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'MID',aiIQ:false});const b=mkBall(X,-3,0);const o=run(X,r,b);
  ok('a rod that is neither the keeper nor smart drops through the ball (no pin)',!o.phases.includes('pin')&&o.phases.includes('drop')&&X.KICKS.length===0,'phases='+o.phases.join('>'));}
 {const r=mkRod(X,{offset:0,role:'GK',aiIQ:false});const b=mkBall(X,-3,0);const o=run(X,r,b);
  ok('…except the keeper, who always tries to pin',o.phases.includes('pin'),'phases='+o.phases.join('>'));}
 {const r=mkRod(X,{offset:0});const b=mkBall(X,-5.9,0);const o=run(X,r,b);
  ok('a ball beyond the pin window (shots.pin.back) is dropped through, not pinned',!o.phases.includes('pin')&&o.phases.includes('drop'),'phases='+o.phases.join('>'));}
 // ---- housekeeping ----------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:0,baseZ:[0]});const b=mkBall(X,-1.5,2);b.m.position.z=40;X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('a ball no man can get to (out of slide reach) ends the action',r.act===null);}
 {const r=mkRod(X,{offset:0,pinB:{}});r.pinPose=true;r.pinOn=true;r.pinA=-0.5;const b=mkBall(X,-1.5,2);b.m.position.z=40;X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('ending releases a held pin',r.pinB===null&&!r.pinOn&&!r.pinPose&&r.pinA===null);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'side no longer waits for the lane to clear (lifts on the ball)',part:'guard',from:'if(inLaneZ(r,bz,cz)){\n   if(!r.retDir)',to:'if(false&&inLaneZ(r,bz,cz)){\n   if(!r.retDir)'},
 {n:'the direction is the nearest clear offset again, not AWAY from the man',part:'guard',from:'const away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?-1:1;',to:'const away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?1:-1;'},
 {n:'a pinned-at-the-limit man crosses a close ball anyway',part:'guard',from:'else if(rel<RT.crossRel)r.retDir=-away;',to:'else if(true)r.retDir=-away;'},
 {n:'a far ball is never crossed',part:'guard',from:'else if(rel<RT.crossRel)r.retDir=-away;',to:'else if(false)r.retDir=-away;'},
 {n:'the slide-in starts before the boot is over the ball',part:'guard',from:'if(backHit(r,KICK.raiseA*dir,mn.o)===null)retrievePhase(r,\'over\');',to:'if(true)retrievePhase(r,\'over\');'},
 {n:'the pin pose is set at the FINAL angle (out of the catch window all the way down)',part:'guard',from:'r.pinA=r.pinB?r.angle:r.angle+clamp(fin-r.angle,-RT.pinLead,RT.pinLead);',to:'r.pinA=fin;'},
 {n:'a caught ball is played at once (no settle)',part:'guard',from:'if(r.retHold>=RT.settleT&&r.kickT<0&&r.cd<=0){',to:'if(r.kickT<0&&r.cd<=0){'},
 {n:'the pin shot fires without asking the strike gate',part:'guard',from:'if(strikeOn(r,best,\'trapShot\')){',to:'if(true){'},
 {n:'a pin that never takes hangs on instead of dropping',part:'guard',from:'if(r.retT>RT.pinT)retrievePhase(r,\'drop\');',to:'void 0;'},
 {n:'every rod pins, smart or not',part:'guard',from:'(r.aiIQ||r.role===\'GK\'||!RT.pinIQ)',to:'true'},
 {n:'the keeper is no longer exempt from the iq gate',part:'guard',from:'(r.aiIQ||r.role===\'GK\'||!RT.pinIQ)',to:'(r.aiIQ||!RT.pinIQ)'},
 {n:'the pin window is ignored (a ball too deep to pin is pinned)',part:'guard',from:'rel>SHOT.pin.back+0.2&&',to:''},
 {n:'an unreachable ball no longer ends the action',part:'guard',from:'if(!mn){retrieveEnd(r,RT.cd);return;}',to:'if(!mn){return;}'},
 {n:'ending leaves the pin held',part:'guard',from:' if(r.pinB)pinRelease(r);\n r.pinOn=false;r.pinPose=false;r.pinA=null;\n r.act=null;',to:' r.pinOn=false;r.pinPose=false;r.pinA=null;\n r.act=null;'},
 {n:'ending leaves the pin flags up',part:'guard',from:' r.pinOn=false;r.pinPose=false;r.pinA=null;\n r.act=null;',to:' r.act=null;'}
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
process.exit(bad||missed?1:0);
