// work tap harness (catch.recv.tap.work: a stuck forward hold rolls the ball to the neighbour's forward foot, open lane or not). node tools/worktap-harness.js
// slices the real tapEval / workTap / workDraw (ai.js) against live CONFIG; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={tap:slice(AI,'function tapEval(r,b,obs,goalX,walk,any){',NL+'function tapStart(r){')};
// pinOutlet: the lane at z, from a table the scene sets; footAngle: any forward depth a pin reaches
const stubs="var S={time:0}; const CAS={}; let LANE=()=>0, ROLL=0.5;"+
 "function manLive(){return true;} function laneMin(){return AIC.lanes.clear;} function teamDiff(){return 'pro';}"+
 "function rngAi(){return ()=>ROLL;} function footAngle(rel){return rel>=2.06&&rel<=SHOT.pin.fwdFront?0.9:null;}"+
 "function pinOutlet(r,x,z){return LANE(z);}";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,localStorage:{getItem:()=>null,setItem:()=>{}}};ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.tap,
  ';globalThis.X={S,CAS,AIC,SWINGS,SHOT,tapEval,workTap,workDraw,set:(l,u)=>{if(l)LANE=l;if(u!=null)ROLL=u;}};'].join(NL),ctx);
 return ctx.X;
}
// an ATT rod (men 18.5 apart) holding a received ball under its middle man's forward foot at 4.85
function rod(X){return {role:'ATT',team:0,idx:0,kickDir:1,angle:0.95,offset:0,maxOff:10,baseZ:[-18.5,0,18.5],tapCd:0};}
const ball=(z,dx)=>({m:{position:{x:0,y:1.9,z}},pinMan:1,pinDx:dx});
function suite(X){
 const R=[],ok=(n,c,i)=>R.push({name:n,ok:!!c,info:i});
 const W=X.AIC.catch.recv.tap.work,open=X.SWINGS.pinShot.open;
 ok('recv.tap.work exists and is on',W&&W.on&&W.chain>0&&W.wait>0&&W.share);
 X.set(()=>open-1,0.5);
 {const r=rod(X),b=ball(0,4.85);
  ok('every lane shut: the lane tap finds nobody',X.tapEval(r,b,null,60,true)===null);
  const pk=X.workTap(r,b,null,60);
  ok('...the work tap still rolls it to a neighbour, marked as work',pk&&pk.work===true&&(pk.j===0||pk.j===2),JSON.stringify(pk));}
 X.set(z=>z>0?open+1:open-1);
 {const r=rod(X),pk=X.workTap(r,ball(0,4.85),null,60);
  ok('one neighbour open: the work tap takes that one, and it is a lane tap (not work)',pk&&pk.j===2&&pk.work===false,JSON.stringify(pk));}
 X.set(z=>z<0?open-0.5:open-3);
 {const pk=X.workTap(rod(X),ball(0,4.85),null,60);
  ok('both shut: it goes to the better lane',pk&&pk.j===0,JSON.stringify(pk));}
 X.set(()=>open-1);
 {const r=rod(X);r.wkN=W.chain;
  ok('the chain is spent: no work tap',X.workTap(r,ball(0,4.85),null,60)===null);}
 {const r=rod(X);W.on=false;const pk=X.workTap(r,ball(0,4.85),null,60);W.on=true;
  ok('work.on false: no work tap',pk===null);}
 {const r=rod(X);
  ok('past the forward window: not tapped',X.workTap(r,ball(0,X.SHOT.pin.fwdFront+0.5),null,60)===null);
  ok('inside it where no foot comes down on the ball (the neighbour could not take it): not tapped',X.workTap(r,ball(0,1.0),null,60)===null);}
 {const r=rod(X);r.offset=-r.maxOff+1;
  const pk=X.workTap(r,ball(r.offset,4.85),null,60);
  ok('no room to run one way: it runs the other',pk&&pk.s>0,JSON.stringify(pk));}
 const sh=W.share.pro;
 {const r=rod(X);X.set(null,sh-0.01);
  ok('the draw under the share works the ball',X.workDraw(r)===true);
  X.set(null,0.999);ok('...and is drawn once a hold',X.workDraw(r)===true);}
 {const r=rod(X);X.set(null,sh+0.01);
  ok('the draw over the share does not',X.workDraw(r)===false);}
 return R;
}
// the hooks that play it: checked in the source
const src=[
 ['pinPlay: a forward hold works the ball before the walk','if(!mull&&wkOk&&workDraw(r)&&(r.tapPk=workTap(r,b,obs,goalX)))return 3;'],
 ['pinPlay: a late forward hold rolls it whatever the draw','return work&&wkOk&&(r.tapPk=workTap(r,b,obs,goalX))?3:0;'],
 ['catchStep: the whistle near, it rolls before a blind snake or a re-seat','if(dl<FC.tapLeft&&!r.force){'],
 ['tapStart marks a work tap','r.tapWk=!!pk.work;'],
 ['tapSide: a work tap counts on its own chain','if(r.tapWk){r.wkN=(r.wkN|0)+1;CAS.fwdWork++;}else r.tapN=(r.tapN|0)+1;'],
 ['catchEnd resets the chain','r.tapN=0;r.wkN=0;r.tapWk=false;']
];
let bad=0;
const X0=boot();
for(const t of suite(X0)){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info&&!t.ok?'   ['+t.info+']':''));}
for(const [n,s] of src){const ok=AI.includes(s);if(!ok)bad++;console.log((ok?'  ok   ':'  FAIL ')+n);}
const MUT=[
 {n:'any is ignored',part:'tap',from:'||progress||any)',to:'||progress)'},
 {n:'a work tap is not marked',part:'tap',from:'work:!!any&&',to:'work:false&&'},
 {n:'an open neighbour is marked work',part:'tap',from:'&&out<SWINGS.pinShot.open&&!progress',to:''},
 {n:'the best lane is not preferred',part:'tap',from:'(!best||out>best.out)',to:'(!best)'},
 {n:'the chain is ignored',part:'tap',from:'||(r.wkN|0)>=W.chain',to:''},
 {n:'the switch is ignored',part:'tap',from:'if(!W||!W.on||',to:'if(!W||'},
 {n:'the foot reach is not checked for a work tap',part:'tap',from:'if((walk||any)&&',to:'if(walk&&'},
 {n:'the draw is made every step',part:'tap',from:'if(r.wkRoll==null)',to:''},
 {n:'the draw ignores the share',part:'tap',from:'rngAi(r.idx)()<u',to:'true'}
];
let missed=0;
for(const m of MUT){let c=false,d='';try{c=suite(boot(m)).some(t=>!t.ok);}catch(e){d=' THREW '+e.message;}if(!c)missed++;console.log('  '+(c?'caught ':'MISSED ')+m.n+d);}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
