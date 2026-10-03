// dead-ball projection harness. node tools/deadforce-harness.js
// slices the real deadzoneMult / liveZone / deadLeft (powerups.js) and runs them on live CONFIG
// question: does deadLeft report the real seconds before the whistle (deadzone speed-up, live-zone discount until graceMax is spent, the multi-ball wedge limit, the sandbox switch) so the AI's last-chance push (ai.js, CONFIG.ai.force) fires when the clock says; each mutation must break an assertion
// the AI wiring itself is measured in the browser: tools/deadforce-soak.js
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const PU=rd('js/powerups.js');
const part=slice(PU,'function rodGaps(){',NL+'function deadBallUpdate(');
const stubs="var S={balls:[],time:0,trn:null,eff:[{big:0},{big:0}]}; var rods=[]; var activeTable={deadzones:[]};";

function boot(mut){
 let src=part;
 if(mut){const before=src;src=src.split(mut.from).join(mut.to);
  if(src===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,src,
  ';globalThis.X={S:S,DEAD:DEAD,ROD_H:ROD_H,setRods:function(v){rods=v;},setTable:function(v){activeTable=v;},deadLeft:deadLeft};'].join(NL),ctx);
 return ctx.X;
}

// a ball at world x with the dead-ball clock at `st` stall seconds and `gr` grace seconds spent
const ball=(x,st,gr,z,y)=>({cur:{x:x,y:y==null?1.9:y,z:z||0},stuckT:st||0,graceT:gr||0});
// one red rod at x=10 with a man on z=0; a ball two units in front of it is strikeable
const rod=()=>({x:10,kickDir:1,baseZ:[0],offset:0,removedUntil:[],trnHidden:false});

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const D=X.DEAD,L=D.live,near=(a,b)=>Math.abs(a-b)<1e-6;
 const reset=()=>{X.S.balls=[];X.S.trn=null;X.setRods([]);X.setTable({deadzones:[]});};
 {reset();const b=ball(5,0);X.S.balls=[b];ok('plain ball: the full stall time',near(X.deadLeft(b),D.stallT),'got '+X.deadLeft(b));}
 {reset();const b=ball(5,2);X.S.balls=[b];ok('...less what the box has already run',near(X.deadLeft(b),D.stallT-2));}
 {reset();const b=ball(5,D.stallT+0.1);X.S.balls=[b];ok('a clock already past the limit reads 0 (the whistle is due)',X.deadLeft(b)===0,'got '+X.deadLeft(b));}
 {reset();const b=ball(0,0);X.S.balls=[b];ok('a lane between the rows runs the clock faster',near(X.deadLeft(b),D.stallT/D.rodGaps.mult),'got '+X.deadLeft(b));}
 {reset();X.setTable({deadzones:[{xMin:40,zMin:20}]});const b=ball(45,1,0,25);X.S.balls=[b];ok('a table deadzone runs it at zoneMult',near(X.deadLeft(b),(D.stallT-1)/D.zoneMult),'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,0);X.S.balls=[b];
  const slowT=L.graceMax/(1-L.mult),gain=slowT*L.mult;
  ok('a strikeable ball: the grace budget buys slow seconds first, then the clock runs at full speed',near(X.deadLeft(b),slowT+D.stallT-gain),'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,D.stallT-0.4);X.S.balls=[b];
  ok('...and when the grace outlasts the stall, the remainder ticks at the discounted speed',near(X.deadLeft(b),0.4/L.mult),'got '+X.deadLeft(b));}
 {reset();const r=rod();r.x=-2;X.setRods([r]);const b=ball(0,0);X.S.balls=[b];ok('a lane outranks the live discount (nobody can swing at a ball there)',near(X.deadLeft(b),D.stallT/D.rodGaps.mult),'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,3,L.graceMax);X.S.balls=[b];ok('a spent grace budget: no discount left',near(X.deadLeft(b),D.stallT-3),'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,3,1);X.S.balls=[b];
  const slowT=(L.graceMax-1)/(1-L.mult),gain=slowT*L.mult;
  ok('a part-spent budget buys only what is left of it',near(X.deadLeft(b),slowT+(D.stallT-3)-gain)&&X.deadLeft(b)>D.stallT-3,'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,0,0,0,X.ROD_H+1);X.S.balls=[b];ok('a ball above the rod axis is not strikeable: plain clock',near(X.deadLeft(b),D.stallT),'got '+X.deadLeft(b));}
 {reset();X.setRods([rod()]);const b=ball(12,0);X.S.balls=[b];L.on=false;const v=X.deadLeft(b);L.on=true;ok('live.on:false restores the plain clock',near(v,D.stallT),'got '+v);}
 {reset();const b=ball(5,0),c=ball(5,0);X.S.balls=[b,c];ok('multi-ball: a wedged ball goes at wedgeT, not stallT',near(X.deadLeft(b),D.wedgeT),'got '+X.deadLeft(b));}
 {reset();X.S.trn={deadball:false};const b=ball(5,3);X.S.balls=[b];ok('a training sandbox with the dead ball off never whistles',X.deadLeft(b)===Infinity);}
 {reset();X.S.trn={deadball:true};const b=ball(5,3);X.S.balls=[b];ok('...with it on the clock is the normal one',near(X.deadLeft(b),D.stallT-3));}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {n:'multi-ball uses the whole-table stall limit',from:'(S.balls.length>1?DEAD.wedgeT:DEAD.stallT)',to:'DEAD.stallT'},
 {n:'a due whistle can read negative',from:'if(need<=0)return 0;',to:''},
 {n:'the deadzone speed-up is ignored',from:'return need/Math.max(zm,1e-6);',to:'return need;'},
 {n:'the live discount is applied in a deadzone too',from:'if(zm===1&&L&&L.on',to:'if(L&&L.on'},
 {n:'a part-spent budget is read as a full one',from:'const slowT=(L.graceMax-(b.graceT||0))/(1-L.mult)',to:'const slowT=L.graceMax/(1-L.mult)'},
 {n:'the discounted seconds are not counted as stall gained',from:'gain=slowT*L.mult;',to:'gain=0;'},
 {n:'a grace budget that outlasts the stall still adds the slow window',from:'return need<=gain?need/L.mult:slowT+need-gain;',to:'return slowT+need-gain;'},
 {n:'the sandbox switch is ignored',from:'if(S.trn&&!S.trn.deadball)return Infinity;',to:''},
 {n:'live.on is ignored',from:'zm===1&&L&&L.on&&',to:'zm===1&&L&&'}
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
