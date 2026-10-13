// raise-back harness. node tools/raiseback-harness.js
// slices the real raise latch (aiUpdate), rodHoldRaise (a benched rod), laneMate and the lane action's lift (ai.js) and runs them on live CONFIG
// question: with CONFIG.ai.raiseBack off, does an AI rod never lift back for a ball coming from behind (latch, benched raise, DEF lane lift), while evade's own raise still holds; on = the old behaviour exactly; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const stmt=(src,from)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);return src.slice(a,src.indexOf(';',a)+1);};
const AI=rd('js/ai.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 foot:slice(AI,'function inFootRange(',NL+'const _fb={nx:0'),
 lane:slice(AI,'function laneMate(r,b){',NL+'function evadeDir('),
 hold:slice(AI,'function rodHoldRaise(r){',NL+'function autoHoldRod('),
 latch:slice(AI,'   if(latchStuck){',NL+'  const CL=AIC.clearLane;'),
 lift:stmt(AI,'r.raise=AIC.raiseBack&&CL.lift&&!footStuck;')
};
const stubs="var S={balls:[],time:0}; var rods=[];";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.foot,g.lane,g.hold,
  'function latch(r,relReal,overFoot,latchStuck){'+g.latch+NL+'}',
  'function laneLift(r,CL,footStuck){'+g.lift+NL+'}',
  ';globalThis.X={S:S,AIC:AIC,BALL_R:BALL_R,latch:latch,laneLift:laneLift,rodHoldRaise:rodHoldRaise,setRods:function(a){rods=a;}};'].join(NL),ctx);
 return ctx.X;
}

/* A red rod of one man at z=0 at x; the ball on the floor at dir-relative x `rel`. */
function mk(over){
 return Object.assign({x:-7.5,team:0,kickDir:1,role:'MID',baseZ:[0],maxOff:12,removedUntil:[],offset:0,angle:0,kickT:-1,raise:false,behindFlag:false,lhT:0},over||{});
}
function ball(X,r,rel,bz){X.S.balls=[{scored:false,m:{position:{x:r.x+rel,y:X.BALL_R,z:bz||0}},v:{x:60,y:0,z:0}}];}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const set=v=>{X.AIC.raiseBack=v;};
 // ---- the latch in aiUpdate ---------------------------------------------------------------------------
 set(true);
 {const r=mk();X.latch(r,-10,false,false);ok('ON: a ball 10 behind the rod raises it and latches',r.raise===true&&r.behindFlag===true);}
 {const r=mk();X.latch(r,-5,false,false);ok('ON: a ball only 5 behind is not far enough back to raise',r.raise===false&&r.behindFlag===false);}
 set(false);
 {const r=mk();X.latch(r,-10,false,false);ok('OFF: a ball 10 behind does not raise the rod',r.raise===false&&r.behindFlag===false,'raise='+r.raise+' flag='+r.behindFlag);}
 {const r=mk();X.latch(r,-25,false,false);ok('OFF: nor does one 25 behind (the whole flight of a pass from the rod behind)',r.raise===false&&r.behindFlag===false);}
 {const r=mk({behindFlag:true});X.latch(r,-3,false,false);ok("OFF: evade's own latch (behindFlag set by the clear) still holds the raise until the ball is at the feet",r.raise===true&&r.behindFlag===true);}
 {const r=mk({behindFlag:true,raise:true});X.latch(r,-1,true,true);ok('OFF: a ball right at the feet drops the rod, as before',r.raise===false&&r.behindFlag===false);}
 set(true);
 {const r=mk({raise:true,behindFlag:true});X.latch(r,-1,true,true);ok('ON: a ball right at the feet drops the rod (latchStuck wins)',r.raise===false&&r.behindFlag===false);}
 // ---- the benched rod's passive raise -----------------------------------------------------------------
 {const r=mk();ball(X,r,-10);X.rodHoldRaise(r);ok('ON: a benched rod raises for a ball 10 behind',r.raise===true&&r.behindFlag===true);}
 set(false);
 {const r=mk();ball(X,r,-10);const got=X.rodHoldRaise(r);ok('OFF: a benched rod stays down for a ball 10 behind',got===false&&r.raise===false&&r.behindFlag===false);}
 {const r=mk({behindFlag:true});ball(X,r,-3);const got=X.rodHoldRaise(r);ok("OFF: …but keeps evade's raise until the ball is at the feet",got===true&&r.raise===true);}
 {const r=mk({behindFlag:true,raise:true});ball(X,r,-1);const got=X.rodHoldRaise(r);ok('OFF: a ball at the feet drops a benched rod',got===false&&r.raise===false);}
 // ---- the DEF's lane lift (a mate behind is about to clear the ball through the row) ------------------
 const gk={x:-52.5,team:0,kickDir:1,role:'GK',baseZ:[0],maxOff:8,offset:0},def=mk({x:-37.5,role:'DEF',baseZ:[-12,12],maxOff:18});
 X.setRods([gk,def]);
 set(true);
 {ball(X,def,-7.5,3);X.rodHoldRaise(def);ok('ON: a benched DEF lifts out of its keeper\'s clearance lane',def.raise===true&&def.behindFlag===false,'raise='+def.raise);}
 set(false);
 {def.raise=false;ball(X,def,-7.5,3);X.rodHoldRaise(def);ok('OFF: the same DEF stays down',def.raise===false);}
 {const r=mk({role:'DEF',raise:false});X.AIC.raiseBack=true;ok('ON: the lane action lifts once the back-swing cannot clip',(X.laneLift(r,X.AIC.clearLane,false),r.raise===true));}
 {const r=mk({role:'DEF',raise:false});X.AIC.raiseBack=true;X.laneLift(r,X.AIC.clearLane,true);ok('ON: …and not while the ball is in the back-swing reach',r.raise===false);}
 {const r=mk({role:'DEF',raise:false});X.AIC.raiseBack=false;X.laneLift(r,X.AIC.clearLane,false);ok('OFF: the lane action only steps aside: no lift',r.raise===false);}
 set(false);
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {name:'the latch enters on a ball behind even with raiseBack off',part:'latch',from:'if(!r.behindFlag && AIC.raiseBack && relReal<AIC.raiseBehind)',to:'if(!r.behindFlag && relReal<AIC.raiseBehind)'},
 {name:'the latch re-raises on the next frame even with raiseBack off',part:'latch',from:'r.raise=AIC.raiseBack && relReal<AIC.raiseBehind;',to:'r.raise=relReal<AIC.raiseBehind;'},
 {name:'the latch inverts the switch (raises only when it is off)',part:'latch',from:'AIC.raiseBack && relReal<AIC.raiseBehind) r.behindFlag=true',to:'!AIC.raiseBack && relReal<AIC.raiseBehind) r.behindFlag=true'},
 {name:"the latch drops evade's raise when raiseBack is off",part:'latch',from:'if(r.behindFlag){',to:'if(r.behindFlag&&AIC.raiseBack){'},
 {name:'the latch never lets go at the feet',part:'latch',from:'r.raise=false;r.behindFlag=false;       // ball right at the feet',to:'r.raise=r.raise;r.behindFlag=r.behindFlag;       // ball right at the feet'},
 {name:"a benched rod's latch enters with raiseBack off",part:'hold',from:'if(!r.behindFlag && RB && rel<AIC.raiseBehind)',to:'if(!r.behindFlag && rel<AIC.raiseBehind)'},
 {name:"a benched rod re-raises with raiseBack off",part:'hold',from:'r.raise=RB && rel<AIC.raiseBehind;',to:'r.raise=rel<AIC.raiseBehind;'},
 {name:"a benched rod's lane lift ignores raiseBack",part:'hold',from:'if(RB&&AIC.clearLane.on',to:'if(AIC.clearLane.on'},
 {name:"a benched rod never lifts when raiseBack is on",part:'hold',from:'if(!r.behindFlag && RB && rel<AIC.raiseBehind)',to:'if(!r.behindFlag && !RB && rel<AIC.raiseBehind)'},
 {name:'the lane action lifts with raiseBack off',part:'lift',from:'r.raise=AIC.raiseBack&&CL.lift',to:'r.raise=CL.lift'},
 {name:'the lane action lifts into a ball in back-swing reach',part:'lift',from:'&&!footStuck',to:''},
 {name:'the lane action never lifts',part:'lift',from:'r.raise=AIC.raiseBack&&CL.lift&&!footStuck;',to:'r.raise=false;'}
];
let missed=0;
for(const m of MUT){
 const res=suite(boot(m)),failed=res.filter(t=>!t.ok);
 if(failed.length){console.log('  caught  ('+failed.length+' assertions)  '+m.name);}
 else{missed++;console.log('  MISSED  '+m.name);}
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
