// keep harness (catch.keep: a re-pin of the ball a rod just lost is the same possession). node tools/keep-harness.js
// slices the real pinPlayStart (ai.js) against live CONFIG; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={start:slice(AI,'function pinPlayStart(r){',NL+'function forwardPinCarry(')};
const stubs="var S={time:0}; const CAS={keep:0};";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,localStorage:{getItem:()=>null,setItem:()=>{}}};ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.start,';globalThis.X={S:S,CAS:CAS,AIC:AIC,pinPlayStart:pinPlayStart};'].join(NL),ctx);
 return ctx.X;
}
const ball=z=>({m:{position:{x:0,y:1,z}}});
// a rod that held b at z until `t` with pull / walk tries spent and its draws made, then lost it
function used(X,b,z,t,age){
 return {pinB:b,pkB:b,pkT:t,pkZ:z,pkAge:age,puN:2,puRoll:true,pcWalkN:3,ttRoll:false,pcSnD:true,pcTz:4,pcTurnT:9,puPh:'burst',pcAge:age};
}
function suite(X){
 const R=[],ok=(n,c,i)=>R.push({name:n,ok:!!c,info:i});
 const K=X.AIC.catch.keep;
 ok('catch.keep exists and is on',K&&K.on&&K.t>0&&K.d>0);
 {const b=ball(10),r=used(X,b,10,5,1.2);X.S.time=5+K.t*0.5;const n0=X.CAS.keep;X.pinPlayStart(r);
  ok('a re-pin of the same ball soon after, near where it was held, keeps the possession: tries and draws stay',r.puN===2&&r.puRoll===true&&r.pcWalkN===3&&r.ttRoll===false&&r.pcSnD===true,JSON.stringify(r));
  ok('...the hold\'s age carries on, and it is counted',r.pcAge===1.2&&X.CAS.keep===n0+1);
  ok('...the per-hold state still starts afresh (carry target, turn timer, pull phase)',r.pcTz===null&&r.pcTurnT===0&&r.puPh===null&&r.pcZ0===10);}
 {const b=ball(10),r=used(X,b,10,5,1.2);X.S.time=5+K.t+0.01;X.pinPlayStart(r);
  ok('too long after: a fresh possession',r.puN===0&&r.puRoll===null&&r.pcWalkN===0&&r.ttRoll===null&&r.pcSnD===null&&r.pcAge===0);}
 {const b=ball(10+K.d+0.1),r=used(X,b,10,5,1.2);X.S.time=5.1;X.pinPlayStart(r);
  ok('too far from where it was held (a tap, a tic-tac): a fresh possession',r.puN===0&&r.pcAge===0);}
 {const b=ball(10+K.d+8),r=used(X,b,10,5,1.2);r.tapWk=true;r.wkRoll=true;X.S.time=5.1;X.pinPlayStart(r);
  ok('a work tap re-pin, however far it rolled, keeps the possession (age, draws) and clears the flag',r.pcAge===1.2&&r.puN===2&&r.wkRoll===true&&r.tapWk===false);}
 {const b=ball(10),r=used(X,b,10,5,1.2);r.wkRoll=true;X.S.time=5+K.t+0.01;X.pinPlayStart(r);
  ok('a fresh possession draws the work tap again',r.wkRoll===null);}
 {const b=ball(10),r=used(X,ball(10),10,5,1.2);r.pinB=b;X.S.time=5.1;X.pinPlayStart(r);
  ok('another ball: a fresh possession',r.puN===0&&r.pcAge===0);}
 {const b=ball(10),r=used(X,b,10,5,1.2);r.pkB=null;X.S.time=5.1;X.pinPlayStart(r);
  ok('a played ball (pkB cleared by the swing): a fresh possession',r.puN===0);}
 {const b=ball(10),r={pinB:b};X.S.time=0;X.pinPlayStart(r);
  ok('a rod that never held anything starts clean',r.puN===0&&r.pcAge===0&&r.pcWalkN===0);}
 {const b=ball(10),r=used(X,b,10,5,1.2);K.on=false;X.S.time=5.1;X.pinPlayStart(r);K.on=true;
  ok('keep.on false: every pin is a fresh hold',r.puN===0&&r.pcAge===0);}
 return R;
}
// pinPlay and pinFire write what keep reads: checked in the source (pinPlay has too many parts to boot here)
const src=[
 ['pinPlay records the held ball each step',"r.pkB=b;r.pkT=S.time;r.pkZ=p.z;r.pkAge=(r.pcAge||0)+t;"],
 ['pinPlay\'s late clock is the possession\'s age',"const late=r.pkAge>=catchT(r,'holdT')||r.force"],
 ['a swing ends the possession (pinFire)',"r.pkB=null;"],
 ['retrieve hands an outfield pin to the hold','if(AIC.catch.on&&AIC.catch.roles.includes(r.role)){retrieveHold(r);return;}'],
 ['a match start forgets the last possession (rods.js)','r.pkB=null;r.pkT=-1e9;',rd('js/rods.js')]
];
let bad=0;
for(const t of suite(boot())){if(!t.ok)bad++;console.log((t.ok?'  ok   ':'  FAIL ')+t.name+(t.info&&!t.ok?'   ['+t.info+']':''));}
for(const [n,s,f] of src){const ok=(f||AI).includes(s);if(!ok)bad++;console.log((ok?'  ok   ':'  FAIL ')+n);}
const MUT=[
 {n:'keep ignores the time',part:'start',from:'&&S.time-r.pkT<=K.t',to:''},
 {n:'keep ignores the distance',part:'start',from:'(wk||Math.abs(p.z-r.pkZ)<=K.d)',to:'true'},
 {n:'a work tap re-pin is a fresh hold',part:'start',from:'(wk||',to:'(false||'},
 {n:'the work tap flag survives the re-pin',part:'start',from:'r.puB=false;r.tapWk=false;',to:'r.puB=false;'},
 {n:'a fresh possession keeps the work draw',part:'start',from:'r.puRoll=null;r.wkRoll=null;',to:'r.puRoll=null;'},
 {n:'keep ignores which ball',part:'start',from:'r.pkB===b&&',to:''},
 {n:'keep ignores its switch',part:'start',from:'K&&K.on&&',to:'K&&'},
 {n:'the age is not carried',part:'start',from:'r.pcAge=r.pkAge;CAS.keep++;',to:'r.pcAge=0;CAS.keep++;'},
 {n:'a kept possession resets the pull tries',part:'start',from:'r.pcAge=r.pkAge;CAS.keep++;return;',to:'r.pcAge=r.pkAge;CAS.keep++;r.puN=0;return;'},
 {n:'a fresh possession keeps the pull tries',part:'start',from:'r.puN=0;r.puRoll=null;',to:'r.puRoll=null;'},
 {n:'a fresh possession keeps the walk tries',part:'start',from:'r.pcAge=0;r.pcWalkN=0;',to:'r.pcAge=0;'},
 {n:'a kept possession keeps the old carry target',part:'start',from:'r.pcZ0=p.z;r.pcTz=null;',to:'r.pcZ0=p.z;'},
 {n:'a kept possession is not counted',part:'start',from:'CAS.keep++;',to:''}
];
let missed=0;
for(const m of MUT){let c=false,d='';try{c=suite(boot(m)).some(t=>!t.ok);}catch(e){d=' THREW '+e.message;}if(!c)missed++;console.log('  '+(c?'caught ':'MISSED ')+m.n+d);}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
