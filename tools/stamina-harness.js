// stamina harness. node tools/stamina-harness.js
// boots the real stats.js on live CONFIG with plain-object rods
// question: does every swing tire the rod that makes it (a kick, a power swing, a pad stick swing that never calls kickRod), once a swing, for AI and human rods alike,
// does a rod shooting a few times a minute actually tire while a keeper's rate does not, and is updateRods wired to it; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const parts={stats:rd('js/stats.js'),rods:rd('js/rods.js')};
const stubs="var S={time:0,matchTime:0,teamStats:null,eff:[{},{}]};function seatOf(r){return r.human?{}:null;}";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.stats,
  ';globalThis.X={S:S,CONFIG:CONFIG,STC:STC,stExertKick:stExertKick,stExertStick:stExertStick,stExertTick:stExertTick,stExert:stExert};'].join(NL),ctx);
 ctx.X.rodsSrc=g.rods;
 return ctx.X;
}

const dt=1/120;
const rod=over=>Object.assign({team:0,kickDir:1,role:'MID',exert:0,angVel:0,kickT:-1,padAngleOn:false,pinMag:null,shotExert:1,human:false},over||{});
// a pad moves the leg once a frame: at 120 Hz every other step turns it and the step between reads still
function stickSwing(X,r,w,steps){for(let i=0;i<steps;i++){r.angVel=i%2?0:w;X.stExertStick(r);}}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info}),near=(a,b,e)=>Math.abs(a-b)<=(e==null?1e-6:e);
 const K=X.STC.kickFat;
 // ---- a kick (kickRod) ---------------------------------------------------------------------------------------------------------
 {const a=rod();X.stExertKick(a);
  ok('an AI kick banks one swing',near(a.exert,K.per));
  const h=rod({human:true});X.stExertKick(h);
  ok('...a human rod\'s the same (userDrain)',near(h.exert,K.per));
  const p=rod({shotExert:X.CONFIG.shots.mod.hardExert});X.stExertKick(p);
  ok('a full-power swing banks hardExert swings',near(p.exert,K.per*X.CONFIG.shots.mod.hardExert),p.exert);
  const c=rod({exert:K.full*K.cap-0.5});X.stExertKick(c);X.stExertKick(c);
  ok('banked exertion stops at full x cap',near(c.exert,K.full*K.cap));}
 // ---- a pad stick swing ---------------------------------------------------------------------------------------------------------
 {const r=rod({padAngleOn:true,human:true});
  stickSwing(X,r,K.stickW*2.5,8);
  ok('a stick swing banks one swing, however many steps it takes',near(r.exert,K.per),r.exert);
  stickSwing(X,r,K.stickW*2.5,8);
  ok('...still one while the leg keeps going forward',near(r.exert,K.per),r.exert);
  stickSwing(X,r,-K.stickW*2,4);
  ok('...the leg coming back banks nothing',near(r.exert,K.per),r.exert);
  stickSwing(X,r,K.stickW*2.5,8);
  ok('...the next swing after it came back banks another',near(r.exert,2*K.per),r.exert);
  const s=rod({padAngleOn:true,human:true});stickSwing(X,s,K.stickW*0.8,20);
  ok('a stick turned forward slower than stickW is not a swing',near(s.exert,0),s.exert);
  const sw=rod({padAngleOn:true,human:true});stickSwing(X,sw,X.CONFIG.control.handover.stickW,20);
  ok('a rod switch turning the leg at handover.stickW is not a swing',near(sw.exert,0),sw.exert);
  const tc=rod({padAngleOn:true,human:true,shotExert:X.CONFIG.shots.mod.hardExert});stickSwing(X,tc,K.stickW*3,6);
  ok('a Total Control power strike banks its shotExert',near(tc.exert,K.per*X.CONFIG.shots.mod.hardExert),tc.exert);
  const k=rod({padAngleOn:true,human:true,kickT:0.02});stickSwing(X,k,K.stickW*3,6);
  ok('a kickRod swing in flight is not charged again by the stick',near(k.exert,0),k.exert);
  const pm=rod({padAngleOn:true,human:true,pinMag:0.9});stickSwing(X,pm,K.stickW*3,6);
  ok('the stick settling a pin (pinMag) is not a swing',near(pm.exert,0),pm.exert);
  const ai=rod();stickSwing(X,ai,K.stickW*3,6);
  ok('a rod off the stick (any AI rod) turning fast is not charged here',near(ai.exert,0),ai.exert);
  const b=rod({team:1,kickDir:-1,padAngleOn:true,human:true});stickSwing(X,b,-K.stickW*2.5,8);
  ok('the blue side swings the other way round',near(b.exert,K.per),b.exert);
  const w0=K.stickW;K.stickW=0;const z=rod({padAngleOn:true,human:true});stickSwing(X,z,40,6);K.stickW=w0;
  ok('stickW 0: stick swings are free',near(z.exert,0),z.exert);}
 // ---- the rate: shooting tires, a keeper's few kicks do not ------------------------------------------------------------------
 {const run=(perMin,secs)=>{const r=rod(),every=Math.round(60/perMin/dt),n=Math.round(secs/dt);
   for(let i=0;i<n;i++){if(i%every===0)X.stExertKick(r);X.stExertTick(r,dt);}return X.stExert(r);};
  const busy=run(4,240),gk=run(1,240);
  ok('a rod swinging 4 times a minute is well tired by 4 minutes',busy>0.3,busy.toFixed(3));
  ok('...a keeper\'s once a minute hardly',gk<0.1,gk.toFixed(3));
  const r=rod({exert:5});X.stExertTick(r,10);
  ok('exertion bleeds off at recover a second',near(r.exert,5-10*K.recover));}
 // ---- updateRods' hook ----------------------------------------------------------------------------------------------------------
 {const up=slice(X.rodsSrc,'function updateRods(',NL+'function '),a=up.indexOf('r.angVel=(r.angle-r.prevAngle)/dt;'),s=up.indexOf('stExertStick(r);');
  ok('updateRods charges stick swings, after it measures angVel',a>=0&&s>a);
  const rr=slice(X.rodsSrc,'function resetRodRotation(',NL+'function ');
  ok('a rally\'s end clears the stick latch',rr.indexOf('r.exStk=false;')>=0);}
 return R;
}

const res=suite(boot());let bad=0;
for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok    ':'  FAIL  ')+t.name+(t.ok||t.info===undefined?'':'   ['+t.info+']'));}
console.log('  '+(res.length-bad)+' passed, '+bad+' failed');
const MUT=[
 {n:'a human rod pays only a power swing\'s extra',part:'stats',from:'if(!K.userDrain&&typeof seatOf',to:'if(typeof seatOf'},
 {n:'a power swing costs a plain one',part:'stats',from:' r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*ex);'+NL+'}',to:' r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per);'+NL+'}'},
 {n:'no ceiling',part:'stats',from:' r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*ex);'+NL+'}',to:' r.exert=(r.exert||0)+K.per*ex;'+NL+'}'},
 {n:'recovery four times as fast',part:'stats',from:'r.exert-STC.kickFat.recover*dt',to:'r.exert-STC.kickFat.recover*4*dt'},
 {n:'stick swings are free',part:'stats',from:'r.exStk=true;stExertKick(r);',to:'r.exStk=true;'},
 {n:'every step of a stick swing is charged',part:'stats',from:'if(!r.exStk&&r.padAngleOn',to:'if(r.padAngleOn'},
 {n:'the latch never re-arms',part:'stats',from:'if(w<0){r.exStk=false;return;}',to:'if(w<0)return;'},
 {n:'the latch re-arms on a still step',part:'stats',from:'if(w<0){r.exStk=false;return;}',to:'if(w<=0){r.exStk=false;return;}'},
 {n:'any forward turn is a swing',part:'stats',from:'&&w>K.stickW)',to:'&&w>0)'},
 {n:'a rod off the stick is charged',part:'stats',from:'r.padAngleOn&&r.kickT<0',to:'r.kickT<0'},
 {n:'a kickRod swing is charged twice',part:'stats',from:'r.kickT<0&&r.pinMag==null',to:'r.pinMag==null'},
 {n:'the pin settle is a swing',part:'stats',from:'&&r.pinMag==null&&',to:'&&'},
 {n:'the blue side is not mirrored',part:'stats',from:'const w=r.angVel*r.kickDir;',to:'const w=r.angVel;'},
 {n:'stickW 0 is not honoured',part:'stats',from:'if(!K.on||!(K.stickW>0))return;',to:'if(!K.on)return;'},
 {n:'updateRods does not charge stick swings',part:'rods',from:'stExertTick(r,dt);stExertStick(r);',to:'stExertTick(r,dt);'},
 {n:'the latch survives the rally',part:'rods',from:'r.kickHold=false;r.exStk=false;',to:'r.kickHold=false;'}
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
