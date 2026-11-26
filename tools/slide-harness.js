// slide harness. node tools/slide-harness.js
// CONFIG.ai.slide (rods.js aiSlide, rodAcc): pro/legend rods brake onto a target (acceleration by difficulty, the target's motion fed forward no faster than it moves now), speed commands (target = offset + v·dt) and strike slides are driven as given, the ATT near the ball keeps the old run; whole-rod numbers in tools/slide-probe.js
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const RODS=rd('js/rods.js');
const parts={slide:slice(RODS,'function aiSlide(r,ms,cvS,dt){',NL+'function updateRods('),acc:slice(RODS,'function rodAcc(r){',NL)};
const stubs="var DIFF='pro'; function teamDiff(){return DIFF;} function pushBurst(){return 0;} var AG=1; function stAgil(){return AG;}";
function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,localStorage:{getItem:()=>null,setItem:()=>{}}};ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.acc,g.slide,
  ';globalThis.X={AIC:AIC,DIFFS:DIFFS,aiSlide:aiSlide,rodAcc:rodAcc,setDiff:function(d){DIFF=d;},setAg:function(a){AG=a;}};'].join(NL),ctx);
 return ctx.X;
}
const dt=1/120,MS=53;
function rod(X,o){o=o||{};X.setDiff(o.diff||'pro');return {team:0,role:o.role||'MID',x:-7.5,kickDir:1,aiBX:o.ballX!=null?o.ballX:-40,offset:0,target:0,slideV:o.v||0,tgP:null,tgF:0,maxOff:9,kickT:-1,catSw:false,act:null};}
// one step as updateRods drives it: the target written (fn), the slide, slideV re-synced, tgP moved on
function step(X,r,fn){r.target=clamp(fn(r),-r.maxOff,r.maxOff);const p=r.offset;X.aiSlide(r,MS,1,dt);r.slideV=(r.offset-p)/dt;r.tgP=r.target;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function jump(X,r,T,secs){let over=0,settle=0;for(let i=0;i<secs/dt;i++){step(X,r,()=>T);const d=T-r.offset;over=Math.max(over,-d*Math.sign(T));if(Math.abs(d)>0.25||Math.abs(r.slideV)>3)settle=(i+1)*dt;}return {over,settle};}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const SL=X.AIC.slide;
 ok('the shipped block: braking on for pro and legend, every role, the ATT keeps the old run near the ball',SL.brake===true&&SL.diffs.join()==='pro,legend'&&SL.roles.length===4&&SL.strike.roles.join()==='ATT',JSON.stringify(SL));
 {const j=jump(X,rod(X),3,1.2);ok('pro: a 3 u move barely overshoots',j.over<0.3,'over '+j.over.toFixed(2));ok('...and settles within 0.3 s',j.settle<0.3,'settle '+j.settle.toFixed(3));}
 {const j=jump(X,rod(X,{diff:'legend'}),6,1.2);ok('legend: a 6 u move settles within 0.35 s',j.settle<0.35&&j.over<0.3,JSON.stringify(j));}
 {const j=jump(X,rod(X,{diff:'rookie'}),3,1.2);ok('rookie keeps the old run: it overshoots and comes back',j.over>1,'over '+j.over.toFixed(2));}
 {const s0=SL.brake;SL.brake=false;const j=jump(X,rod(X),3,1.2);SL.brake=s0;ok('brake off is the old run',j.over>0.4,'over '+j.over.toFixed(2));}
 {const s0=SL.brake;SL.brake=[false,true];const j=jump(X,rod(X),3,1.2);SL.brake=s0;ok('brake [red,blue]: red off overshoots',j.over>0.4);}
 {const r=rod(X);for(let i=0;i<24;i++)step(X,r,q=>q.offset+30*dt);ok('a speed command (offset + v·dt) is driven at its speed',Math.abs(r.slideV-30)<1,'v '+r.slideV.toFixed(1));}
 {const r=rod(X,{v:40});for(let i=0;i<30;i++)step(X,r,q=>q.offset);ok('a stop command (target = offset) stops and stays stopped',Math.abs(r.slideV)<0.5,'v '+r.slideV.toFixed(2));}
 {const r=rod(X);r.catSw=true;r.kickT=0;for(let i=0;i<20;i++)step(X,r,q=>q.offset+45*dt);ok('a planned strike slide is driven as given',Math.abs(r.slideV-45)<1,'v '+r.slideV.toFixed(1));}
 {const r=rod(X,{v:45});r.catSw=true;r.kickT=0;r.tgP=-5;step(X,r,q=>q.offset+45*dt);ok('...even on the step it starts (no braking out of a run)',r.slideV>44,'v '+r.slideV.toFixed(1));}
 {X.setAg(0.4);const r=rod(X);r.tgP=0;const j=jump(X,r,3,1.2);X.setAg(1);ok('a target jump is not read as target motion (tired: the old acceleration)',j.over<0.3,'over '+j.over.toFixed(2));}
 {const j=jump(X,rod(X,{role:'ATT',ballX:-7.5+4}),3,1.2);ok('the ATT with the ball in reach keeps the old run',j.over>0.4,'over '+j.over.toFixed(2));
  const k=jump(X,rod(X,{role:'ATT',ballX:-7.5+30}),3,1.2);ok('...and brakes when the ball is far',k.over<0.3,'over '+k.over.toFixed(2));}
 {const k=1-Math.exp(-dt/X.DIFFS.pro.react);X.setAg(0.4);const r=rod(X);let w=0,over=0;for(let i=0;i<144;i++){w+=(10-w)*k;step(X,r,()=>w);over=Math.max(over,r.offset-10);}X.setAg(1);ok('a spot glided in by the reaction smoothing (pro, tired) is not run past',over<0.2,'over '+over.toFixed(2));}
 {X.setAg(0.4);const r=rod(X);r.offset=r.target=-9;let T=-9,over=0;for(let i=0;i<144;i++){T=Math.min(T+1.5,6);step(X,r,()=>T);over=Math.max(over,r.offset-6);}X.setAg(1);ok('a target racing in jumps past the rod speed, then stopping, is not run past',over<0.3,'over '+over.toFixed(2));}
 {const a=['rookie','pro','legend'].map(d=>X.rodAcc({team:0},X.setDiff(d)));X.setDiff('pro');ok('legend accelerates hardest, rookie least',a[2]>a[1]&&a[1]>a[0],a.join());}
 {const r=rod(X,{diff:'legend',v:50});let over=0;for(let i=0;i<60;i++){step(X,r,()=>0);over=Math.max(over,r.offset);}ok('legend: from 50 u/s it stops on its spot within 0.7 u',over<0.7,'over '+over.toFixed(2));}
 {X.setAg(0.4);const r=rod(X);let e2=0,n=0;for(let i=0;i<360;i++){const t=i*dt,T=6*Math.sin(2*Math.PI*1.2*t);step(X,r,()=>T);if(t>1){e2+=(T-r.offset)**2;n++;}}X.setAg(1);const rms=Math.sqrt(e2/n);ok('a moving target is followed closely (tired)',rms<0.08,'rms '+rms.toFixed(2));}
 return R;
}

const MUT=[
 {n:'no braking',part:'slide',from:'Math.min(Math.abs(d)/dt,Math.sqrt(2*aR*Math.abs(d)))',to:'Math.abs(d)/dt'},
 {n:'no speed-command detection',part:'slide',from:'const cmd=brk&&',to:'const cmd=false&&'},
 {n:'no feed-forward',part:'slide',from:'const tv=brk&&!cmd&&r.tgF*tgM>0?',to:'const tv=false?'},
 {n:'stale feed-forward (the lagged read, not the target speed now)',part:'slide',from:'Math.min(Math.abs(r.tgF),Math.abs(tgM))',to:'Math.abs(r.tgF)'},
 {n:'difficulty acceleration ignored',part:'acc',from:'(DIFFS[teamDiff(r.team)].acc||1)',to:'1'},
 {n:'strike slide braked',part:'slide',from:'!(r.catSw&&r.kickT>=0)&&',to:''},
 {n:'difficulty ignored',part:'slide',from:'&&SL.diffs.indexOf(teamDiff(r.team))>=0',to:''},
 {n:'no striker exemption',part:'slide',from:"&&!(r.act!=='run'&&SR.roles.indexOf(r.role)>=0&&srel>SR.rel[0]&&srel<SR.rel[1])",to:''},
 {n:'per-team brake ignored',part:'slide',from:'Array.isArray(SL.brake)?SL.brake[r.team]:SL.brake',to:'!!SL.brake'}
];

let bad=0;
{const res=suite(boot());for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok    ':'  FAIL  ')+t.name+(t.ok||!t.info?'':'   ['+t.info+']'));}
 console.log('  '+(res.length-bad)+' passed, '+bad+' failed');}
let caught=0;
for(const m of MUT){let res;const X=boot(m);
 try{res=suite(X);}catch(e){caught++;console.log('  caught  (threw)  '+m.n);continue;}
 const broke=res.filter(t=>!t.ok);
 if(broke.length){caught++;console.log('  caught  ('+broke.length+' assertions)  '+m.n);}
 else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
