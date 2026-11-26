// hand harness. node tools/hand-harness.js
// CONFIG.ai.hand (rods.js handSlide / handPlan / handAng): an AI rod's slide and leg move as aimed moves
// slices the real hand section and aiSlide (rods.js) and runs them on live CONFIG: a move lands at rest on its spot with no run past and back, a jittery spot is not chased,
// the landing misses by skill and is corrected, a moving spot is followed, speed commands / the striker's run / a human rod are not the hand's, the leg turns on the same curve and never past its pose
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const RODS=rd('js/rods.js');
const parts={
 slide:slice(RODS,'function aiSlide(r,ms,cvS,dt){',NL+'function updateRods('),
 hand:slice(RODS,'// --- hand (CONFIG.ai.hand)')
};
const stubs=[
 "var S={time:0,userTeam:-1}; var DIFF='pro',SEAT=null;",
 "function teamDiff(){return DIFF;} function seatOf(){return SEAT;} function stAgil(){return 1;} function rodAcc(r){return AIC.slideAccel*(DIFFS[teamDiff(r.team)].acc||1)*stAgil(r);} function pushBurst(){return 0;}",
 "var RG=null,RSEED=1; function rngFor(){if(!RG){let a=RSEED;RG=function(){a=(a*16807)%2147483647;return a/2147483647;};}return RG;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.slide,g.hand,
  ';globalThis.X={S:S,AIC:AIC,DIFFS:DIFFS,SIM:SIM,aiSlide:aiSlide,handSlide:handSlide,handAng:handAng,rodEase:rodEase,handOn:handOn,'+
  'setDiff:function(d){DIFF=d;},setSeat:function(s){SEAT=s;},seed:function(s){RSEED=s;RG=null;}};'].join(NL),ctx);
 return ctx.X;
}

const dt=1/120;
const rod=o=>Object.assign({team:0,x:-7.5,kickDir:1,role:'MID',act:null,aiBX:-60,offset:0,target:0,slideV:0,maxOff:9,tgP:null,kickT:-1,catSw:false,angle:0,angVel:0,prevAngle:0,idx:3},o||{});
// one step as updateRods drives it: the hand, else aiSlide; slideV re-synced, tgP moved on
function step(X,r){const p=r.offset,ms=X.DIFFS[r.diff||'pro'].speed;r.target=Math.max(-r.maxOff,Math.min(r.maxOff,r.target));const h=X.handSlide(r,ms,1,dt);if(!h)X.aiSlide(r,ms,1,dt);r.slideV=(r.offset-p)/dt;r.tgP=r.target;X.S.time+=dt;return h;}
function legStep(X,r,goal,rate){r.angle=X.handAng(r,goal,rate,dt);r.angVel=(r.angle-r.prevAngle)/dt;r.prevAngle=r.angle;}
const reversals=vs=>{let n=0,s=0;for(const v of vs){if(Math.abs(v)<0.5)continue;const g=Math.sign(v);if(s&&g!==s)n++;s=g;}return n;};

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const HS=X.AIC.hand.slide,HL=X.AIC.hand.leg,err0=HS.err;
 ok('the shipped block: on for every difficulty, leg and arc on, the slide off (its tracking left men beside the ball)',X.AIC.hand.on&&!HS.on&&HL.on&&X.AIC.hand.arc.on&&['rookie','pro','legend'].every(d=>X.AIC.hand.diffs.includes(d)));
 HS.on=true;   // the slide's own tests below
 {X.setDiff('pro');const r=rod({target:0});let v=0;for(let i=0;i<30;i++){r.target=r.offset+20*dt;if(!X.handSlide(r,85,1,dt))X.aiSlide(r,85,1,dt);r.tgP=r.target;v=r.slideV;}
  ok('a speed command from rest (a hit\'s run, a tic-tac lunge: target = offset + v·dt) reaches its speed, not a creep',v>18,'v '+v.toFixed(2));}
 // ---- one aimed move, no miss ----
 HS.err={rookie:0,pro:0,legend:0};
 {X.setDiff('pro');const r=rod();r.target=6;const os=[],vs=[];for(let i=0;i<72;i++){step(X,r);os.push(r.offset);vs.push(r.slideV);}
  const mx=Math.max(...os),pk=vs.indexOf(Math.max(...vs)),land=os.findIndex(o=>Math.abs(o-6)<0.05),ms=X.DIFFS.pro.speed;
  ok('pro: a 6 u move never runs past its spot',mx<=6+1e-6,'max='+mx.toFixed(4));
  ok('...lands on it at rest',Math.abs(os[os.length-1]-6)<1e-3&&Math.abs(vs[vs.length-1])<0.5,'o='+os[os.length-1]+' v='+vs[vs.length-1]);
  ok('...quickly (within 0.3 s)',land>=0&&land*dt<=0.3,'t='+(land*dt).toFixed(3));
  ok('...never turning back on the way (no rubber band)',reversals(vs)===0);
  ok('...its speed rising, peaking near the middle, falling (an aimed move, not a bang-bang run)',pk>land*0.3&&pk<land*0.7,'peak step '+pk+' of '+land);
  ok('...under the rod\'s top speed',Math.max(...vs)<=ms+1e-6);}
 {X.setDiff('legend');const r=rod({diff:'legend'});r.target=3;let land=-1;for(let i=0;i<60;i++){step(X,r);if(land<0&&Math.abs(r.offset-3)<0.05)land=i;}
  X.setDiff('rookie');const q=rod({diff:'rookie'});q.target=3;let lq=-1;for(let i=0;i<60;i++){step(X,q);if(lq<0&&Math.abs(q.offset-3)<0.05)lq=i;}
  ok('a legend lands a 3 u move sooner than a rookie',land>=0&&lq>land,'legend '+land+' rookie '+lq);}
 // ---- a jittery spot is not chased ----
 {const jit=(useHand)=>{X.setDiff('pro');X.AIC.hand.on=useHand;const r=rod();let a=7;const vs=[];
   for(let i=0;i<180;i++){a=(a*16807)%2147483647;r.target=4+((a/2147483647)-0.5)*0.5+(i>90?1.2:0);step(X,r);vs.push(r.slideV);}
   X.AIC.hand.on=true;return reversals(vs);};
  const h=jit(true),o=jit(false);
  ok('a spot that jitters by ±0.25 u is not chased: fewer turns than the braking servo',h<o&&h<=1,'hand '+h+' servo '+o);
  X.setDiff('pro');const r=rod();r.target=4;for(let i=0;i<60;i++)step(X,r);const o0=r.offset;let mv=0;
  for(let i=0;i<40;i++){r.target=i===0?4.8:4;step(X,r);mv=Math.max(mv,Math.abs(r.offset-o0));}
  ok('...nor a one-step blip past commit (the smoothed spot has to agree)',mv<1e-6,'moved '+mv.toFixed(3));}
 // ---- the miss, by skill, then the correction ----
 HS.err=err0;
 {const miss=(d)=>{X.setDiff(d);let sum=0,fixed=0;for(let s=1;s<=24;s++){X.seed(s*7919);const r=rod({diff:d});r.target=8;let m=null;
    for(let i=0;i<150;i++){step(X,r);if(m==null&&r.hd&&r.hd.t>=r.hd.T)m=Math.abs(r.offset-8);}
    sum+=m||0;if(Math.abs(r.offset-8)<=HS.fix[d]+1e-6)fixed++;}return {m:sum/24,fixed};};
  const rk=miss('rookie'),pr=miss('pro'),lg=miss('legend');
  ok('the first move misses more the worse the player (rookie > pro > legend)',rk.m>pr.m&&pr.m>lg.m&&lg.m>0,rk.m.toFixed(3)+' / '+pr.m.toFixed(3)+' / '+lg.m.toFixed(3));
  ok('...and every miss past fix is corrected within 1.25 s',rk.fixed===24&&pr.fixed===24&&lg.fixed===24,rk.fixed+'/'+pr.fixed+'/'+lg.fixed);}
 HS.err={rookie:0,pro:0,legend:0};
 {X.setDiff('legend');const r=rod({diff:'legend'});r.target=5;for(let i=0;i<60;i++)step(X,r);const o0=r.offset;r.target=5+HS.fix.legend*0.5;let mv=0;for(let i=0;i<60;i++){step(X,r);mv=Math.max(mv,Math.abs(r.offset-o0));}
  ok('a spot nudged by less than fix: the man stands',mv<1e-6,'moved '+mv);
  r.target=5+HS.commit.legend*0.8;for(let i=0;i<60;i++)step(X,r);ok('...by less than commit but past fix: corrected once it has stood fixT',Math.abs(r.offset-r.target)<=HS.fix.legend);
  const o1=r.offset;r.target=0;step(X,r);step(X,r);ok('...a real move away: re-aimed at once',r.hd&&r.hd.goal===0&&r.offset<o1,'o '+o1+' -> '+r.offset);}
 // ---- a moving spot is followed ----
 {X.setDiff('pro');const r=rod();let lag=0,v=0;for(let i=0;i<90;i++){r.target=-6+20*i*dt;step(X,r);if(i>=60){lag=Math.max(lag,Math.abs(r.target-r.offset));v+=r.slideV/30;}}
  ok('a spot moving at 20 u/s is followed with it (no stop and go)',lag<1.0&&Math.abs(v-20)<3,'lag='+lag.toFixed(2)+' v='+v.toFixed(1));}
 // ---- not the hand's ----
 {X.setDiff('pro');const r=rod();r.slideV=30;r.tgP=0;r.target=30*dt;ok('a speed command (target = offset + v·dt) is aiSlide\'s',X.handSlide(r,85,1,dt)===false&&r.hd===null);}
 {const r=rod({role:'ATT',x:22.5,aiBX:25.5});r.target=4;ok('the striker with the ball in reach keeps its old run (aiSlide)',X.handSlide(r,85,1,dt)===false);
  r.act='catch';ok('...but its pin approach is the hand\'s',X.handSlide(r,85,1,dt)===true);}
 {X.setSeat({});const r=rod();r.target=4;r.hd={};ok('a human rod is never the hand\'s',X.handSlide(r,85,1,dt)===false&&r.hd===null&&!X.handOn(r,'leg'));X.setSeat(null);}
 {X.AIC.hand.diffs=['legend'];X.setDiff('pro');ok('a difficulty off the list keeps aiSlide',X.handSlide(rod({target:4}),85,1,dt)===false);X.AIC.hand.diffs=['rookie','pro','legend'];}
 HS.err=err0;
 // ---- the leg ----
 {const r=rod(),as=[],ws=[];for(let i=0;i<30;i++){legStep(X,r,-1.3,25);as.push(r.angle);ws.push(r.angVel);}
  const T=HL.k/25*Math.sqrt(1.3),done=as.findIndex(a=>a===-1.3),pk=ws.indexOf(Math.min(...ws));
  ok('leg: a raise lands on its pose exactly, never past it',Math.min(...as)>=-1.3-1e-9&&done>=0&&done*dt<=T+dt,'done '+done+' T '+(T/dt).toFixed(1));
  ok('...its turn speeds up and slows down (an ease would be fastest on the first step)',pk>=2&&pk<=done-2,'peak '+pk+' of '+done);
  const q=rod();q.angle=X.rodEase(q,-1.3,25,dt,false);ok('...the old ease is the lerp',Math.abs(q.angle-(-1.3*25*dt))<1e-12);
  let ds=-1;const s2=rod();for(let i=0;i<60;i++){legStep(X,s2,-1.3,10);if(ds<0&&s2.angle===-1.3)ds=i;}
  ok('...a slower ease rate is a slower turn',ds>done,'rate 10: '+ds+' rate 25: '+done);}
 {const r=rod();let past=0;for(let i=0;i<40;i++){const g=i<5?-1.3:-0.45;legStep(X,r,g,25);if(i>=5)past=Math.min(past,r.angle+0.45);}
  ok('...a pose pulled back mid-turn (a backLimit) is never passed',past>=-1e-9&&Math.abs(r.angle+0.45)<1e-9,'past by '+(-past).toFixed(3));}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}else console.log('  ok    '+t.name+(t.info?'   ['+t.info+']':''));}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'no landing (the quintic\'s last term dropped)',part:'hand',from:'h.c5=6*D-3*(v0+v1)*T-0.5*a0*TT;',to:'h.c5=0;'},
 {n:'re-aimed every step',part:'hand',from:'>cm&&Math.abs(r.hdW-ex)>cm*HS.confirm)',to:'>-1)'},
 {n:'no correction',part:'hand',from:'go=h.fw>=handBy(HS.fixT,r);',to:'go=false;'},
 {n:'a speed command from rest is taken as a spot (the creep)',part:'hand',from:'&&(d===0?r.slideV!==0||tgD!==0:r.slideV!==0&&tgD!==0);',to:'&&(d===0&&(r.slideV!==0||tgD!==0)||Math.abs(tgD)>HS.follow);'},
 {n:'the miss ignores skill',part:'hand',from:'handBy(HS.err,r)*ad',to:'HS.err.pro*ad'},
 {n:'a moving spot is not followed',part:'hand',from:'gv=Math.abs(r.hdGV)>HS.follow?clamp(r.hdGV,-ms,ms):0',to:'gv=0'},
 {n:'speed commands taken as spots',part:'hand',from:'if(cmd||strike||',to:'if(strike||'},
 {n:'the striker\'s run is the hand\'s',part:'hand',from:'if(cmd||strike||',to:'if(cmd||'},
 {n:'human rods are the hand\'s',part:'hand',from:'&&!seatOf(r)&&',to:'&&'},
 {n:'the difficulty list ignored',part:'hand',from:'&&H.diffs.indexOf(teamDiff(r.team))>=0',to:''},
 {n:'Fitts time ignores skill',part:'hand',from:'handBy(HS.a,r)+handBy(HS.b,r)',to:'HS.a.pro+HS.b.pro'},
 {n:'the leg passes its pose',part:'hand',from:'return !s||(goal-a)*s<0?goal:a;',to:'return a;'},
 {n:'the leg ignores the ease rate',part:'hand',from:'HL.k/rate*',to:'HL.k/25*'},
 {n:'the old ease is the hand',part:'hand',from:'return hand?handAng(r,to,rate,dt):',to:'return true?handAng(r,to,rate,dt):'},
 {n:'jitter is aimed at as it is',part:'hand',from:'!(fix||Math.abs(r.target-r.hdW)<cm)',to:'!fix'},
 {n:'re-aims need no confirming',part:'hand',from:'&&Math.abs(r.hdW-ex)>cm*HS.confirm',to:''}
];
let caught=0;
for(const m of MUT){
 let res;try{res=suite(boot(m));}catch(e){console.log('  MISSED  (THREW '+e.message+')  '+m.n);continue;}
 const broke=res.filter((t,i)=>base[i]&&base[i].ok&&!t.ok).length;
 if(broke){caught++;console.log('  caught  ('+broke+' assertions)  '+m.n);}else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
