// kick-worth harness. node tools/kickworth-harness.js
// CONFIG.ai.kickWorth: a plain kick fires on an open lane, a fast ball, a threat, a contested ball or once the hold runs out; whole-match effect in tools/plainkick-soak.js (KWS tallies)
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={kw:slice(AI,'const KWS={',NL+'// a straight kick at ball b')};
const stubs="var S={time:0}; var rods=[]; var DIFF='pro'; function teamDiff(){return DIFF;}";
function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,localStorage:{getItem:()=>null,setItem:()=>{}}};ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.kw,
  ';globalThis.X={S:S,AIC:AIC,rods:rods,kickWorth:kickWorth,KWS:KWS,setDiff:function(d){DIFF=d;}};'].join(NL),ctx);
 return ctx.X;
}
const dt=1/120;
function world(X,o){
 o=o||{};X.S.time=0;X.setDiff(o.diff||'pro');
 const r={x:-7.5,team:0,kickDir:1,role:o.role||'MID',aiIQ:o.iq!==false,force:false};
 X.rods.length=0;X.rods.push(r,{x:7.5,team:1},{x:-22.5,team:1});
 return r;
}
function ball(x,vx,vz){const v={x:vx||0,y:0,z:vz||0,length(){return Math.hypot(this.x,this.z);}};const b={m:{position:{x:x,y:0.9,z:0}},v:v};b.real=b;return b;}
const shot=c=>({ev:{best:{clr:c}}});
// frames until kickWorth lets the kick go (cap 10 s)
function held(X,r,b,s){for(let i=0;i<1200;i++){if(X.kickWorth(r,b,s))return i*dt;X.S.time+=dt;}return Infinity;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const KW=X.AIC.kickWorth,W=KW.wait,covered=shot(0),still=()=>ball(-3.5);
 ok('the shipped block names every knob (shipped off)',KW.on===false&&KW.roles.join()==='DEF,MID,ATT'&&KW.open.ATT>0&&KW.ctrlV>0&&W.pro>0&&KW.dumb>0&&KW.dumb<1&&KW.gap>0,JSON.stringify(KW));
 const on0=KW.on;KW.on=true;
 {const r=world(X);
  ok('a slow ball with a covered lane is held',X.kickWorth(r,still(),covered)===false);
  X.S.time=0;r.kwS=-9;const t=held(X,r,still(),covered);
  ok('…for the difficulty\'s wait, then kicked',Math.abs(t-W.pro)<2*dt,'t='+t);
  ok('…and the next ball starts a fresh wait',X.kickWorth(r,still(),covered)===false);}
 {const r=world(X,{iq:false});const t=held(X,r,still(),covered);
  ok('a rod off its iq roll waits dumb x as long',Math.abs(t-W.pro*KW.dumb)<2*dt,'t='+t);}
 {const r=world(X,{diff:'rookie'}),a=held(X,r,still(),covered);const r2=world(X,{diff:'legend'}),b=held(X,r2,still(),covered);
  ok('legend waits longer than rookie',b>a,'rookie '+a+' legend '+b);}
 {const r=world(X);X.kickWorth(r,still(),covered);X.S.time+=W.pro*0.6;X.kickWorth(r,still(),covered);X.S.time+=KW.gap+0.05;
  ok('a hold broken past gap starts over',X.kickWorth(r,still(),covered)===false);
  X.S.time+=W.pro*0.6;ok('…and is not counted from the first hold',X.kickWorth(r,still(),covered)===false);}
 {const r=world(X);
  ok('an open lane kicks at once',X.kickWorth(r,still(),shot(KW.open.MID+0.01))===true);
  ok('…a lane just short of it is held',X.kickWorth(r,still(),shot(KW.open.MID-0.01))===false);}
 {const r=world(X);ok('a ball at ctrlV kicks at once',X.kickWorth(r,ball(-3.5,0,KW.ctrlV),covered)===true);}
 {const r=world(X);ok('a ball heading for our goal past threat kicks at once',X.kickWorth(r,ball(-3.5,-(KW.threat+1),0),covered)===true);
  r.kwS=-9;ok('…one heading away as fast is held',X.kickWorth(r,ball(-3.5,KW.threat+1,0),covered)===false);}
 {const r=world(X);ok('an opposing rod within oppX contests it: kick',X.kickWorth(r,ball(7.5-KW.oppX+0.1),covered)===true);}
 {const r=world(X);r.force=true;ok('the dead-ball push always kicks',X.kickWorth(r,still(),covered)===true);
  r.force=false;r.role='GK';ok('the keeper always kicks',X.kickWorth(r,still(),covered)===true);
  r.role='MID';KW.on=false;ok('switched off, every kick goes',X.kickWorth(r,still(),covered)===true);KW.on=true;}
 {const r=world(X);ok('no plan (null shot) is held like a covered one',X.kickWorth(r,still(),null)===false);}
 KW.on=on0;
 return R;
}

const MUT=[
 {n:'no force exemption',part:'kw',from:'||r.force||KW.roles',to:'||KW.roles'},
 {n:'open lane ignored',part:'kw',from:'shot.ev.best.clr>=KW.open[r.role]',to:'shot.ev.best.clr>=1e9'},
 {n:'fast ball held',part:'kw',from:'v.length()>=KW.ctrlV',to:'v.length()>=1e9'},
 {n:'threat sign flipped',part:'kw',from:'-v.x*r.kickDir>KW.threat',to:'v.x*r.kickDir>KW.threat'},
 {n:'no contested check',part:'kw',from:'Math.abs(o.x-p.x)<KW.oppX',to:'false'},
 {n:'no gap restart',part:'kw',from:'>KW.gap)r.kwT0=S.time',to:'>1e9)r.kwT0=S.time'},
 {n:'iq ignored',part:'kw',from:'(r.aiIQ?1:KW.dumb)',to:'1'},
 {n:'difficulty ignored',part:'kw',from:'KW.wait[teamDiff(r.team)]',to:'KW.wait.pro'},
 {n:'no fresh wait after a kick',part:'kw',from:' r.kwS=-9;KWS.wait++;',to:' KWS.wait++;'}
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
