// lanes harness. node tools/lanes-harness.js
// the lane gate (CONFIG.ai.lanes; laneMin / laneShut, ai.js): no AI kick leaves into an opposing man. A held ball past catch.holdT is shot only through a lane (pinPlay), the snake the same; the dead-ball push, a role off the list and the switch put the old play back
// slices the real catch block (pinOutlet / pinPlay / laneMin / laneShut) with the lane helpers, runs them against live CONFIG with bare-bones rods; the plain kick and the dribble release are checked whole-match by tools/plainkick-soak.js; every mutation must break an assertion
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
 "var S={balls:[],time:0}; var rods=[];",
 "var KICKS=[],PICK=null;",
 "function pinRelease(r){r.pinB=null;}",
 "function kickRod(r,style,aim){r.kickT=0;r.act=null;KICKS.push({style:style,aim:aim||null});}",
 "function strikeOn(){return true;} function sweepClips(){return false;} function passPick(){return PICK;}",
 "function shotEval(team,bx,bz){return {lanes:[],best:{tz:0,clr:1},goalX:team===0?F.L/2:-F.L/2,ox:bx,oz:bz};}",
 "var BGS={retEnter:0}; function retrievePhase(r,ph){r.retPh=ph;} function isUserRod(){return false;}",
 "function rngAi(){return function(){return 0.99;};}",
 "function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;} function rodSpeedMult(){return 1;} function teamDiff(){return 'pro';}",
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('function footBoxD('),b=s.indexOf(NL+'// the ball is under this man',a);return s.slice(a,b);})(),
 (()=>{const s=rd('js/physics.js'),a=s.indexOf('const PIN_SW={}'),b=s.indexOf(NL+'// let go:',a);return s.slice(a,b);})()
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,isFinite,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.lane,g.fwd,g.ret,g.clr,g.lz,g.catch,
  ';globalThis.X={S:S,AIC:AIC,SHOT:SHOT,F:F,BALL_R:BALL_R,rods:rods,KICKS:KICKS,CAS:CAS,pinOutlet:pinOutlet,laneObs:laneObs,pinPlay:pinPlay,pinPlayStart:pinPlayStart,laneMin:laneMin,laneShut:laneShut,setPick:function(v){PICK=v;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120;
// the red rod at x 22.5 (attacking +x), three men; the opposing DEF at 37.5 (men at defOff and defOff+24) and keeper at 52.5
function world(X,opt){
 opt=opt||{};
 X.S.time=0;X.S.balls=[];X.KICKS.length=0;X.setPick(null);
 const r={x:22.5,team:0,kickDir:1,role:opt.role||'ATT',aiIQ:true,baseZ:[-12,0,12],maxOff:opt.maxOff!=null?opt.maxOff:9,removedUntil:[],offset:0,target:0,slideV:0,angle:0,raise:false,behindFlag:false,aiMan:-1,
  kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,act:'catch',catPh:'hold',catT:0,catMan:-1,catO:0,catCd:0,catUntil:0,force:false,catSw:false,catSv:0,catSl:0,vz:0};
 const def={x:37.5,team:1,kickDir:-1,role:'DEF',baseZ:[0,24],offset:opt.defOff!=null?opt.defOff:-1.1,removedUntil:[],vz:0};
 const gk={x:52.5,team:1,kickDir:-1,role:'GK',baseZ:[0],offset:opt.gkOff!=null?opt.gkOff:3.5,removedUntil:[],vz:0};
 X.rods.length=0;X.rods.push(r,def,gk);
 return r;
}
function view(X,rel,z){const b={scored:false,m:{position:{x:22.5+rel,y:X.BALL_R,z:z}},v:{x:0,y:0,z:0,length(){return 0;}}};b.real=b;return b;}
function pinned(X,r,z,rel){rel=rel==null?-0.5:rel;r.pinB={m:{position:{x:22.5+rel,y:X.BALL_R,z:z}},v:{x:0,y:0,z:0},pinMan:1,pinDz:0,pinDx:rel,scored:false};X.pinPlayStart(r);return r.pinB;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CA=X.AIC.catch,LN=X.AIC.lanes,L0=JSON.stringify(LN),late=CA.holdT+0.01;
 CA.recv.ready.on=false;CA.recv.settleT=0;CA.tictac.first=false;CA.tictac.on=false;CA.hit.on=false;CA.hit.loose.on=false;CA.push.play.on=false;CA.tap.on=false;   // nothing but the carry, the pass and the shot
 ok('the shipped gate is on, for the outfield rows, at a clearance of 0 (the line just misses the nearest man)',LN.on===true&&LN.clear===0&&LN.roles.join()==='DEF,MID,ATT',L0);
 // ---- laneMin ----
 {const r=world(X);
  ok('laneMin: the gate\'s clearance for an outfield rod',X.laneMin(r)===LN.clear);
  r.force=true;ok('…none under the dead-ball push',X.laneMin(r)<=-1e9);r.force=false;
  r.role='GK';ok('…none for a role off the list (the keeper)',X.laneMin(r)<=-1e9);r.role='ATT';
  LN.on=false;ok('…none with the gate off',X.laneMin(r)<=-1e9);LN.on=true;}
 // ---- laneShut: a straight kick from where the ball lies ----
 {const r=world(X),bx=22.5+3;
  ok('ATT: a ball in line with a defender is shut',X.laneShut(r,view(X,3,0))===true);
  ok('…one clear of every man and inside the mouth is not',X.laneShut(r,view(X,3,-6))===false);
  ok('…one whose straight line misses the mouth is',X.laneShut(r,view(X,3,-14))===true);
  r.force=true;ok('…nothing is shut under the dead-ball push',X.laneShut(r,view(X,3,0))===false);r.force=false;
  r.role='GK';ok('…nor for the keeper',X.laneShut(r,view(X,3,0))===false);r.role='ATT';
  LN.on=false;ok('…nor with the gate off',X.laneShut(r,view(X,3,0))===false);LN.on=true;}
 {const r=world(X,{role:'MID'}),bx=22.5+3;
  ok('MID: the row ahead decides, the mouth does not',X.laneShut(r,view(X,3,0))===true&&X.laneShut(r,view(X,3,-14))===false);}
 {const r=world(X),seen=view(X,3,-6),real=view(X,3,0),seen2=view(X,3,0);seen.real=real;seen2.real=view(X,3,-6);
  ok('the real ball is judged, not the rod\'s delayed view of it (shut where it is, open where it was seen)',X.laneShut(r,seen)===true&&X.laneShut(r,seen2)===false);}
 {const r=world(X,{defOff:-3,gkOff:-9}),bx=22.5+3,o=X.pinOutlet(r,bx,0,X.laneObs(0,bx,X.F.L/2,CA.shotV),X.F.L/2,0);
  ok('a line that misses the man but by less than catch.lineClear is not shut (the gate is not the hold\'s open test)',o>=0&&o<CA.lineClear&&X.laneShut(r,view(X,3,0))===false,'out='+o.toFixed(2));}
 {const r=world(X,{defOff:-3}),bx=22.5+3,d=X.rods[1];   // the defender 0.4 clear of z -6 standing, past it by the time a shot arrives sliding at 40
  ok('a defender standing just clear of the line leaves it open',X.laneShut(r,view(X,3,-6))===false);
  d.vz=-40;ok('…sliding into it he shuts it (the rows are read where they will be at catch.shotV)',X.laneShut(r,view(X,3,-6))===true);
  d.vz=40;ok('…sliding away he does not',X.laneShut(r,view(X,3,-6))===false);d.vz=0;}
 // ---- pinPlay past holdT ----
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0),n0=X.CAS.laneLate;
  ok('blocked everywhere in reach, no pass: nothing played while it is young',X.pinPlay(r,best,0.5,dt)===0);
  ok('…nor once it is past holdT: a shot needs a lane (counted)',X.pinPlay(r,best,late,dt)===0&&X.CAS.laneLate===n0+1);
  X.pinPlay(r,best,late+0.1,dt);ok('…counted once a hold, not once a frame',X.CAS.laneLate===n0+1);
  X.pinPlayStart(r);X.pinPlay(r,best,late,dt);ok('…a new hold counts again',X.CAS.laneLate===n0+2);
  r.force=true;ok('…the dead-ball push plays it',X.pinPlay(r,best,late,dt)===1&&r.pcWhy==='force');r.force=false;}
 {const r=world(X);pinned(X,r,0);const best=view(X,-0.5,0);LN.on=false;
  ok('the gate off: played at holdT whatever the lane (the old rule)',X.pinPlay(r,best,late,dt)===1&&r.pcWhy==='late');LN.on=true;}
 {const r=world(X);r.role='GK';pinned(X,r,0);const best=view(X,-0.5,0);
  ok('a role off the list is played at holdT as before',X.pinPlay(r,best,late,dt)===1);}
 {const r=world(X,{defOff:-3,gkOff:-9});pinned(X,r,0);const best=view(X,-0.5,0);
  ok('a lane short of catch.lineClear but past the gate: held while young, shot at holdT',X.pinPlay(r,best,0.5,dt)===0&&X.pinPlay(r,best,late,dt)===1);}
 {const r=world(X,{defOff:-3,gkOff:-9,maxOff:0});pinned(X,r,0);const best=view(X,-0.5,0);r.slideV=(CA.fireV+CA.push.minV)/2;
  ok('a rod sliding too slowly to push is judged on the straight line at holdT (it leaves straight)',X.pinPlay(r,best,late,dt)===1&&r.catSv===0);}
 {const r=world(X,{maxOff:0});pinned(X,r,0);const best=view(X,-0.5,0);X.setPick({score:3,x:7.5,z:5,clr:4,onward:3,th:0.1,rod:{role:'MID'}});
  ok('a pass with a lane is still the play at holdT (passes judge their own lane)',X.pinPlay(r,best,late,dt)===2);X.setPick(null);}
 // ---- the snake past holdT ----
 {const SN=CA.snake,K0=JSON.stringify(SN);SN.use={rookie:1,pro:1,legend:1};SN.relMin=0;SN.relMax=9;
  const r=world(X);r.angle=CA.recv.fwdMin+0.4;pinned(X,r,0,3.5);const best=view(X,3.5,0);
  const v=X.pinPlay(r,best,late,dt);
  ok('a snake hold with its lane shut is not fired at holdT',v===0&&r.pcSn===true,'v='+v+' sn='+r.pcSn);
  r.force=true;ok('…the dead-ball push fires the snake',X.pinPlay(r,best,late,dt)===1&&r.pcSn===true);r.force=false;
  Object.assign(SN,JSON.parse(K0));}
 Object.assign(LN,JSON.parse(L0));
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'laneMin ignores the dead-ball push',part:'catch',from:'||r.force||LN.roles',to:'||LN.roles'},
 {n:'laneMin ignores the role list',part:'catch',from:'||LN.roles.indexOf(r.role)<0)',to:')'},
 {n:'laneMin ignores the switch',part:'catch',from:'(!LN||!LN.on||r.force',to:'(!LN||r.force'},
 {n:'the gate reads the hold\'s open test instead of its own clearance',part:'catch',from:'-Infinity:LN.clear;}',to:'-Infinity:AIC.catch.lineClear;}'},
 {n:'laneShut reads the rows where they stand',part:'catch',from:'laneObs(r.team,p.x,gx,AIC.catch.shotV),gx,0)<m;',to:'laneObs(r.team,p.x,gx),gx,0)<m;'},
 {n:'laneShut reads the delayed view',part:'catch',from:'const p=(b.real||b).m.position,gx=',to:'const p=b.m.position,gx='},
 {n:'laneShut never shuts',part:'catch',from:'if(m===-Infinity)return false;',to:'return false;'},
 {n:'past holdT a shot needs no lane',part:'catch',from:'if(lnow>=laneMin(r)){v=1;',to:'if(true){v=1;'},
 {n:'past holdT the lane is judged on the slide even when it leaves straight',part:'catch',from:'const lnow=(still||sn||sl)?now:',to:'const lnow=true?now:'},
 {n:'a held-on late ball is not counted',part:'catch',from:'else if(!r.pcLn){r.pcLn=1;CAS.laneLate++;}',to:''},
 {n:'…it is counted every frame',part:'catch',from:'if(!r.pcLn){r.pcLn=1;CAS.laneLate++;}',to:'if(true){CAS.laneLate++;}'},
 {n:'…a new hold does not count again',part:'catch',from:'r.pcSn=false;r.pcSnD=null;r.pcLn=0;',to:'r.pcSn=false;r.pcSnD=null;'}
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
