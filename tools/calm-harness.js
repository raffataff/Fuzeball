// calm harness. node tools/calm-harness.js
// slices the real calmK / calmGo / coverSlide (ai.js) and runs them on live CONFIG
// question: is a rod the play is far from calm (ahead of it unless its own team has the ball, behind it, never a ball coming at it fast), does a calm rod hold its ground through a rally's back and forth,
// set off only for a real move and then go all the way, start afresh after an action owned its slide, and slide slower; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={calm:slice(AI,'function coverSlide(',NL+'function coverZ(')};
const stubs="var S={time:0,lastTouch:-1};";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.calm,
  ';globalThis.X={S:S,AIC:AIC,calmK:calmK,calmGo:calmGo,coverSlide:coverSlide};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120;
const rod=(team,x,over)=>Object.assign({team,x,target:0,offset:0,act:null,kickT:-1,cvOn:false,clOn:false,clC:0},over||{});
const ball=(x,vx)=>({m:{position:{x,y:0.9,z:0}},v:{x:vx||0,y:0,z:0}});
// steps calmGo the way aiUpdate does: the target is what it returns (past retargetDead)
function run(X,r,want,secs){
 const n=Math.round(secs/dt);let moved=0;
 for(let i=0;i<n;i++){X.S.time+=dt;const o=X.calmGo(r,typeof want==='function'?want(X.S.time):want,dt);if(Math.abs(o-r.target)>X.AIC.retargetDead){r.target=o;moved++;}}
 return moved;
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info}),near=(a,b,e)=>Math.abs(a-b)<=(e==null?1e-6:e);
 const CM=X.AIC.calm;
 // ---- how calm: the play's distance from the rod ----------------------------------------------------------------------
 {X.S.lastTouch=1;
  const gk=rod(0,-52.5);
  ok('a ball in front of the keeper is the keeper\'s: not calm',X.calmK(gk,ball(-52.5+CM.ahead[0]-1))===0);
  ok('a ball at the far end is: fully calm',X.calmK(gk,ball(-52.5+CM.ahead[1]+1))===1);
  ok('...between the two it ramps',near(X.calmK(gk,ball(-52.5+(CM.ahead[0]+CM.ahead[1])/2)),0.5,1e-9));
  const mid=rod(0,-7.5),own=-7.5+(CM.own[1]+CM.ahead[0])/2;
  ok('a ball ahead the other team has, within ahead[0]: not calm',X.calmK(mid,ball(own))===0);
  X.S.lastTouch=0;
  ok('...the same ball the rod\'s own team has: calm (nothing to block)',X.calmK(mid,ball(own))===1);
  const att=rod(0,22.5);
  ok('a ball well behind the rod: calm',X.calmK(att,ball(22.5-CM.behind[1]-1))===1);
  ok('...a ball just behind it: not',X.calmK(att,ball(22.5-CM.behind[0]+1))===0);
  const b1=rod(1,52.5);X.S.lastTouch=0;
  ok('the blue keeper reads the table from its own end (mirrored)',X.calmK(b1,ball(52.5-CM.ahead[1]-1))===1&&X.calmK(b1,ball(52.5-CM.ahead[0]+1))===0);
  X.S.lastTouch=1;
  const far=-52.5+CM.ahead[1]+10,sh=ball(far,-(CM.ahead[1]+10)/(CM.t[0]*0.8));
  ok('a shot coming at the rod from far off, there inside t[0]: not calm',X.calmK(gk,sh)===0,X.calmK(gk,sh));
  const sl=ball(far,-(CM.ahead[1]+10)/(CM.t[1]*1.2));
  ok('...a slow ball coming at it, there after t[1]: still calm',X.calmK(gk,sl)===1,X.calmK(gk,sl));
  const aw=ball(far,200);
  ok('...a fast ball going away: still calm',X.calmK(gk,aw)===1);
  const on=CM.on;CM.on=false;
  ok('calm off: never calm',X.calmK(gk,ball(far))===0);
  CM.on=on;}
 // ---- the slide a calm rod takes ---------------------------------------------------------------------------------------
 {X.S.time=5;
  const r=rod(0,-52.5,{clC:1});
  const o=X.calmGo(r,6,dt);
  ok('a calm rod does not jump to a new wanted slide',near(o,0)&&r.clOn===true);
  const rr=rod(0,-52.5,{clC:1});X.S.time=10;
  const n=run(X,rr,t=>((t*1000|0)%300<150?2:-2),3);
  ok('a rally\'s back and forth (+-2 every 0.15 s) never sets it off',n===0&&near(rr.target,0),'moved '+n+' target '+rr.target);
  const m=rod(0,-52.5,{clC:1});X.S.time=20;
  run(X,m,8,0.1);
  ok('a real move: it waits while the smoothed slide is inside dead',near(m.target,0));
  run(X,m,8,3);
  ok('...then goes all the way',near(m.target,8),'target '+m.target);
  const n2=run(X,m,t=>8+((t*1000|0)%300<150?2:-2),3);
  ok('...and stands there again through a rally',n2===0&&near(m.target,8),'moved '+n2+' target '+m.target);
  const h=rod(0,-52.5,{clC:0.5});X.S.time=30;
  run(X,h,CM.dead*0.75,1);
  ok('half calm: the dead zone is half as wide (a move a fully calm rod would sit out)',near(h.target,CM.dead*0.75),'target '+h.target);
  const b=rod(0,-52.5,{clC:0,target:3});X.S.time=40;
  ok('a busy rod (not calm) takes the wanted slide as it is',X.calmGo(b,-5,dt)===-5&&b.clOn===false);
  const g=rod(0,-52.5,{clC:1,target:0});X.S.time=50;run(X,g,4,0.2);
  g.target=-7;X.S.time+=1;                                         // an action owned the slide for a second
  const og=X.calmGo(g,4,dt);
  ok('after an action owned the slide it starts from where that left it, not from the old smoothing',near(og,-7)&&near(g.clT,-7,0.2),'clT '+g.clT);}
 // ---- slide speed --------------------------------------------------------------------------------------------------------
 {const r=rod(0,-52.5,{clOn:true,clC:1});
  ok('a calm rod slides at calm.v',near(X.coverSlide(r,null),CM.v));
  ok('...half calm, halfway',near(X.coverSlide(Object.assign({},r,{clC:0.5}),null),(1+CM.v)/2));
  ok('...a calm covering keeper takes both',near(X.coverSlide(Object.assign({},r,{cvOn:true}),null),X.AIC.cover.slide*CM.v));
  ok('...not a rod calmGo did not run for (clOn off)',X.coverSlide(Object.assign({},r,{clOn:false}),null)===1);
  ok('...not a human\'s',X.coverSlide(r,{})===1);}
 return R;
}

const res=suite(boot());let bad=0;
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok    ':'  FAIL  ')+t.name+(t.ok||t.info===undefined?'':'   ['+t.info+']'));}
console.log('  '+(res.length-bad)+' passed, '+bad+' failed');
const MUT=[
 {n:'own possession ahead reads as the other team\'s',part:'calm',from:'S.lastTouch===r.team?CM.own:CM.ahead',to:'CM.ahead'},
 {n:'behind reads as ahead',part:'calm',from:'R=rel<0?CM.behind:',to:'R=rel<0?CM.ahead:'},
 {n:'the blue side is not mirrored',part:'calm',from:'const dir=r.team===0?1:-1,rel=(b.m.position.x-r.x)*dir',to:'const dir=1,rel=(b.m.position.x-r.x)*dir'},
 {n:'a ball coming at the rod fast stays calm',part:'calm',from:'if(c>0&&cl>0)c*=',to:'if(false)c*='},
 {n:'a ball going away counts as closing',part:'calm',from:'if(c>0&&cl>0)c*=clamp((d/cl-',to:'if(c>0)c*=clamp((d/Math.abs(cl)-'},
 {n:'the switch is ignored',part:'calm',from:'if(!CM||!CM.on||!b)return 0;',to:'if(!CM||!b)return 0;'},
 {n:'no dead zone (a calm rod follows every wobble)',part:'calm',from:'Math.abs(r.clT-r.target)>CM.dead*c',to:'Math.abs(r.clT-r.target)>0'},
 {n:'the dead zone does not shrink as the play nears',part:'calm',from:'>CM.dead*c)',to:'>CM.dead)'},
 {n:'no smoothing',part:'calm',from:'r.clT=lerp(r.clT,o,1-Math.exp(-dt/(CM.tau*c)));',to:'r.clT=o;'},
 {n:'it stops as soon as it sets off',part:'calm',from:'return r.clMv?r.clT:r.target;',to:'const mv=r.clMv;r.clMv=false;return mv?r.clT:r.target;'},
 {n:'it never stops following',part:'calm',from:'else if(r.clMv&&Math.abs(o-r.clT)<CM.settle){r.clMv=false;r.clT=o;return o;}',to:''},
 {n:'it stops settle short',part:'calm',from:'{r.clMv=false;r.clT=o;return o;}',to:'r.clMv=false;'},
 {n:'the smoothing carries over an action',part:'calm',from:'if(!(S.time>r.clAt&&S.time-r.clAt<dt*1.5)){r.clT=r.target;r.clMv=false;}',to:'if(r.clT==null){r.clT=r.target;r.clMv=false;}'},
 {n:'a busy rod is calmed too',part:'calm',from:'if(!(c>0)){r.clT=o;r.clMv=false;return o;}',to:'if(c==null){r.clT=o;r.clMv=false;return o;}'},
 {n:'a calm rod is not flagged for the slide',part:'calm',from:' r.clOn=true;',to:''},
 {n:'calm slides at full speed',part:'calm',from:'(r.clOn?lerp(1,AIC.calm.v,r.clC):1)',to:'1'},
 {n:'calm slides at calm.v however calm',part:'calm',from:'lerp(1,AIC.calm.v,r.clC)',to:'AIC.calm.v'}
];
let missed=0;
for(const m of MUT){
 let failed=0,why='';
 try{for(const t of suite(boot(m)))if(!t.ok)failed++;}catch(e){why=e.message;}
 if(why){missed++;console.log('  MISSED  (THREW '+why+')  '+m.n);}
 else if(!failed){missed++;console.log('  MISSED  '+m.n);}
 else console.log('  caught  ('+failed+' assertions)  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
