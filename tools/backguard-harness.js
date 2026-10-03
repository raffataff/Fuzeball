// back-guard harness. node tools/backguard-harness.js
// slices the real backHit / backLimit / slideBlocked (ai.js) and the footBoxDist under them and runs them on live CONFIG
// question: does an AI rod refuse to swing a boot back through a ball behind it and refuse to walk a man into one, while leaving legitimate moves alone (z-clear lifts, balls ahead, sliding away, kick swings, a human's rod); each mutation must break an assertion
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
 guard:slice(AI,'const BGS={lift:0',NL+'function clearOffset(')
};
const stubs="var S={balls:[],time:0}; var SEAT=null; function seatOf(){return SEAT;}";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.foot,g.guard,
  ';globalThis.X={S:S,AIC:AIC,KICK:KICK,BALL_R:BALL_R,backLimit:backLimit,slideBlocked:slideBlocked,setSeat:function(v){SEAT=v;}};'].join(NL),ctx);
 return ctx.X;
}

/* One red man at z=0 on the keeper's rod; ball on the floor at dir-relative x `rel`, z `bz`. */
function mk(X,over){
 return Object.assign({x:-52.5,team:0,kickDir:1,baseZ:[0],removedUntil:[],offset:0,angle:0,kickT:-1,pinB:null,act:null,raise:false,lhT:0},over||{});
}
function ball(X,rel,bz,v){X.S.balls=[{scored:false,m:{position:{x:-52.5+rel,y:X.BALL_R,z:bz}},v:{x:0,y:0,z:0}}];if(v)Object.assign(X.S.balls[0].v,v);}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const A=X.KICK.raiseA,full=A;                                  // world angle of a full lift (red: negative = back)
 // ---- lift -------------------------------------------------------------------------------------------
 {const r=mk(X);ball(X,-4,0);const h=X.backLimit(r,full);
  ok('a z-aligned ball behind the rod holds the lift short of the ball',h>-0.6&&h<=0,'h='+h);
  ok('…and stamps r.lhT so ai.js can drop the raise latch',r.lhT>0,'lhT='+r.lhT);}
 {const r=mk(X,{offset:6});ball(X,-4,0);ok('the same ball with the man z-clear lets the lift through',X.backLimit(r,full)===full);}
 {const r=mk(X);ball(X,-4,0,{x:-2});X.S.balls[0].v.x=200;ok('a fast ball is not "loitering": no hold on a speculative sweep',X.backLimit(r,full)===full);}
 {const r=mk(X,{angle:-0.44});ball(X,-1.8,0);const h=X.backLimit(r,full);ok('a ball INSIDE the box (the normal is undefined and reads forward) still holds the lift',h===r.angle,'h='+h);}
 {const r=mk(X);ball(X,2.8,0);ok('a ball AHEAD of the boot (contact normal forward) never blocks a back-lift',X.backLimit(r,full)===full);}
 {const r=mk(X);ball(X,-6.7,0);const h=X.backLimit(r,full);
  ok('a ball far behind is reached over a thin band of angles and is not stepped over',h>full&&h<0,'h='+h);}
 {const r=mk(X);ball(X,-4,0);X.AIC.backGuard.on=false;const h=X.backLimit(r,full);X.AIC.backGuard.on=true;ok('backGuard.on:false restores the old lift exactly',h===full);}
 {const r=mk(X,{kickT:0.05});ball(X,-4,0);ok('a kick swing is exempt',X.backLimit(r,full)===full);}
 {const r=mk(X);ball(X,-4,0);X.setSeat({});const h=X.backLimit(r,full);X.setSeat(null);ok('a human-held rod is exempt',h===full);}
 {const r=mk(X,{angle:-1.3});ball(X,-4,0);ok('a forward move is not a back-swing: the drop through a ball behind it is left alone',X.backLimit(r,0)===0);}
 {const r=mk(X,{team:1,kickDir:-1,x:52.5});X.S.balls=[{scored:false,m:{position:{x:56.5,y:X.BALL_R,z:0}},v:{x:0,y:0,z:0}}];
  const h=X.backLimit(r,-full);ok('blue mirrors red (its back-swing is the positive angle)',h<1&&h>=0&&h<0.6,'h='+h);}
 // ---- slide ------------------------------------------------------------------------------------------
 {const r=mk(X);ball(X,-1.5,4);ok('sliding a man into a ball behind his heel is refused',X.slideBlocked(r,0,1.0)===true);}
 {const r=mk(X);ball(X,-1.5,2);ok('…but a rod already overlapped can always slide AWAY, even while still touching',X.slideBlocked(r,0,-0.3)===false);}
 {const r=mk(X);ball(X,1,4);ok('a ball beside/ahead of the boot is ordinary strike geometry, left alone',X.slideBlocked(r,0,1.0)===false);}
 {const r=mk(X,{angle:-0.44,offset:2.5});ball(X,-1.8,0);X.AIC.backGuard.lane=false;const b=X.slideBlocked(r,2.5,1.0);X.AIC.backGuard.lane=true;
  ok('CONTACT: a ball INSIDE the half-lifted box blocks a slide onto it (its normal reads forward)',b===true);}
 {const r=mk(X,{act:'trap'});ball(X,-1.5,4);ok('a trap is contact on purpose',X.slideBlocked(r,0,1.0)===false);}
 {const r=mk(X,{act:'dribble'});ball(X,-1.5,4);ok('a dribble is contact on purpose',X.slideBlocked(r,0,1.0)===false);}
 {const r=mk(X,{act:'retrieve',retPh:'pin'});ball(X,-1.5,4);ok("retrieve's pin descent is contact on purpose",X.slideBlocked(r,0,1.0)===false);}
 {const r=mk(X,{act:'retrieve',retPh:'side'});ball(X,-1.5,4);ok('…but its other phases are still guarded',X.slideBlocked(r,0,1.0)===true);}
 {const r=mk(X);ball(X,-1.5,4);X.setSeat({});const b=X.slideBlocked(r,0,1.0);X.setSeat(null);ok('a human-held rod is exempt',b===false);}
 {const r=mk(X,{force:true,role:'DEF'});ball(X,-1.5,4);ok('a rod in the dead-ball push (CONFIG.ai.force) may slide through a ball beside its heel',X.slideBlocked(r,0,1.0)===false);}
 {const r=mk(X,{force:true,role:'GK'});ball(X,-1.5,4);ok('…but the keeper never does: a squirt there can end in its own goal',X.slideBlocked(r,0,1.0)===true);}
 {const r=mk(X,{angle:-0.3});ball(X,-6,4);ok('LANE: a half-lifted boot is not walked into the z lane of a ball it still has to swing back through (no contact yet)',X.slideBlocked(r,0,1.6)===true);}
 {const r=mk(X);ball(X,-6,4);ok('…a rod that is down and not lifting is left to the ordinary logic',X.slideBlocked(r,0,1.6)===false);}
 {const r=mk(X,{angle:-1.45,raise:true});ball(X,-6,4);ok('…and once the boot is over the ball the slide-in is free',X.slideBlocked(r,0,1.6)===false);}
 {const r=mk(X,{angle:-0.3,offset:1.6});ball(X,-6,4);ok('…a rod already IN the lane is not pinned there: moving within it is allowed',X.slideBlocked(r,1.6,1.3)===false);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {n:'coarse lift sampling steps over a thin contact band',part:'guard',from:'Math.ceil(Math.abs(aT-a0)/G.arcStep)',to:'2'},
 {n:'the forward-normal exemption is gone (balls ahead block the lift)',part:'guard',from:'(d<G.deepD||_fb.nx*dir<G.backDot)',to:'(true)'},
 {n:'a ball INSIDE the box no longer counts (its degenerate forward normal reads as "ahead")',part:'guard',from:'(d<G.deepD||_fb.nx*dir<G.backDot)',to:'(_fb.nx*dir<G.backDot)'},
 {n:'the slide guard forgets a ball inside the box',part:'guard',from:'(d1>=G.deepD&&_fb.nx*dir>=G.backDot)',to:'(_fb.nx*dir>=G.backDot)'},
 {n:'a fast ball is swept as if it were loitering',part:'guard',from:'||v.x*v.x+v.y*v.y+v.z*v.z>ms2',to:''},
 {n:'the lift never reports a hold (latch stamp lost)',part:'guard',from:'BGS.lift++;r.lhT=G.holdT;',to:'BGS.lift++;'},
 {n:'a kick swing is no longer exempt',part:'guard',from:'||r.kickT>=0||seatOf(r)||(aT-r.angle)',to:'||seatOf(r)||(aT-r.angle)'},
 {n:'a human-held rod is no longer exempt from the lift guard',part:'guard',from:'||r.kickT>=0||seatOf(r)||(aT-r.angle)',to:'||r.kickT>=0||(aT-r.angle)'},
 {n:'a forward move is treated as a back-swing',part:'guard',from:'||(aT-r.angle)*r.kickDir>=0)return aT;',to:')return aT;'},
 {n:'a slide AWAY from a ball is refused too (no closing test)',part:'guard',from:'if(d1<footBoxDist(r,r.angle,i,p.x,p.y,p.z,o0)-1e-4)',to:'if(true)'},
 {n:'a ball beside/ahead of the boot blocks the slide (no behind test)',part:'guard',from:'||(p.x-r.x)*dir>G.behindRel)continue;',to:')continue;'},
 {n:'a trap is no longer exempt from the slide guard',part:'guard',from:"||r.act==='trap'||r.act==='dribble'||(r.act==='retrieve'",to:"||r.act==='dribble'||(r.act==='retrieve'"},
 {n:"retrieve's pin descent is no longer exempt from the slide guard",part:'guard',from:"||(r.act==='retrieve'&&r.retPh==='pin')||(r.force",to:"||(r.force"},
 {n:'a forced rod is still held back by the slide guard',part:'guard',from:"||(r.force&&r.role!=='GK')||seatOf(r))return false;",to:"||seatOf(r))return false;"},
 {n:'the keeper is exempt from the slide guard when forced',part:'guard',from:"||(r.force&&r.role!=='GK')||seatOf(r))return false;",to:"||r.force||seatOf(r))return false;"},
 {n:'the lane check is gone',part:'guard',from:'if(G.lane&&(',to:'if(false&&('},
 {n:'the lane check fires on a rod that is down and not lifting',part:'guard',from:"(r.raise||r.act==='safeRaise'||r.angle*dir<-0.05)",to:'true'},
 {n:'the lane check forgets the boot is already over the ball',part:'guard',from:'backHit(r,aT,o1)!==null&&backHit(r,aT,o0)===null',to:'backHit(r,aT,o1)!==null'}
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
