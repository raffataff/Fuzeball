'use strict';
/* ================= rod-hole stamina rings — harness =================
   node tools/rodholes-harness.js

   Slices the REAL registerRodHoles + rodHoleShader (js/models.js) and the REAL rodHoles block
   (js/fx.js) out of their files and drives them in one vm context on top of the LIVE core.js +
   config.js + stats.js, against a minimal THREE stub. Nothing here restates the code it is
   testing, so a retune of CONFIG.fx.rodHoles or CONFIG.stats moves the expectations with it.

   THE FOUR THINGS THAT ARE INVISIBLE TO READING, and why each has a mutation below:

   · WORLD-X CLASSIFICATION. A ring that matches no rod must be refused, not snapped to the
     nearest — snapping fails as "the wrong ring lights all match", which nobody looks for.
   · THE LEVEL IS STAT-INDEPENDENT. rodHoleFill runs off stFatRamp, so every rod drains its ring
     over the same 0..1 no matter its stamina; the COLOUR is what varies. Wire the fill to stFat by
     mistake and a stamina-10 rod's ring never moves — which reads as "the feature is broken on
     good rods" rather than as an error.
   · THE COST CURVE. stFat's output is a narrow band (1.000..0.875 for a default rod) that has to
     be normalised before it can drive anything. A stray divide reads as "nothing happens".
   · THE SHADER INJECTION. onBeforeCompile edits someone else's GLSL by string match. If a chunk
     name ever moves the ring must keep its authored look and say so, not render black.

   rd() strips CRLF at the READ: js/models.js and js/fx.js are CRLF files and a multi-line needle
   written as a template literal has its terminators normalised to LF by the lexer itself, so it
   could never match. Fixed once here rather than per-needle. */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL '+m));};
const near=(a,b,e,m)=>ok(Math.abs(a-b)<=(e||1e-6),m+'  (got '+a+', want '+b+')');

function slice(src,name){
 const i=src.indexOf('function '+name+'(');
 if(i<0)throw new Error('slice: '+name+' not found');
 let d=0;
 for(let k=src.indexOf('{',i);k<src.length;k++){const c=src[k];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(i,k+1);}}
 throw new Error('slice: '+name+' unbalanced');
}
function region(src,from,to){
 const a=src.indexOf(from);if(a<0)throw new Error('region start missing: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('region end missing: '+to);
 return src.slice(a,b);
}

/* ---- minimal THREE, plus GLSL close enough to r128's to test the injection against ---- */
const THREE_STUB=`
var THREE={Color:function(h){this.r=this.g=this.b=0;if(h!=null)this.set(h);},Box3:function(){}};
THREE.Color.prototype.set=function(h){
 if(typeof h==='string')h=parseInt(h.replace('#',''),16);
 if(typeof h==='number'){this.r=((h>>16)&255)/255;this.g=((h>>8)&255)/255;this.b=(h&255)/255;}
 else if(h&&h.isC){this.r=h.r;this.g=h.g;this.b=h.b;} return this;};
THREE.Color.prototype.isC=true;
THREE.Color.prototype.setRGB=function(r,g,b){this.r=r;this.g=g;this.b=b;return this;};
THREE.Color.prototype.clone=function(){return new THREE.Color().copy(this);};
THREE.Color.prototype.copy=function(o){this.r=o.r;this.g=o.g;this.b=o.b;return this;};
THREE.Color.prototype.lerp=function(o,t){this.r+=(o.r-this.r)*t;this.g+=(o.g-this.g)*t;this.b+=(o.b-this.b)*t;return this;};
THREE.Color.prototype.multiplyScalar=function(s){this.r*=s;this.g*=s;this.b*=s;return this;};
THREE.Color.prototype.getHex=function(){return (Math.round(this.r*255)<<16)|(Math.round(this.g*255)<<8)|Math.round(this.b*255);};
THREE.Box3.prototype.setFromObject=function(o){this.min=o.__bb.min;this.max=o.__bb.max;return this;};
// the two chunk names the injection matches on, in context
var VERT_SRC='void main(){\\n#include <begin_vertex>\\n#include <project_vertex>\\n}';
var FRAG_SRC='void main(){\\nvec3 outgoingLight=vec3(0.0);\\ngl_FragColor=vec4(outgoingLight,1.0);\\n#include <tonemapping_fragment>\\n#include <encodings_fragment>\\n}';
`;
const STUBS=`
var skinRodHoles={},rodHoleMeshes=[],rods=[],matClones=0,warned=[];
function onm(o){return (o.name||'').toLowerCase();}
function mkMat(){return {color:new THREE.Color(0x808080),emissive:new THREE.Color(0),emissiveIntensity:0,
  userData:{},clone:function(){matClones++;var m=mkMat();m.color=this.color.clone();return m;}};}
var SHARED=mkMat();
function ring(name,x,y0,y1){return {isMesh:true,name:name,castShadow:true,material:SHARED,
  __bb:{min:{x:x-1.4,y:y0==null?6.1:y0,z:-37},max:{x:x+1.4,y:y1==null?8.9:y1,z:37}}};}
function root(list){return {traverse:function(cb){cb(this);list.forEach(cb);}};}
function mkRod(team,sta){return {team:team,role:'MID',stats:{spd:5,str:5,acc:5,ctl:5,rea:5,sta:sta,iq:5},
  chg:-1,chgBlock:0,exert:0};}
// run a material's onBeforeCompile the way the renderer would, once, and hand back the shader
function compile(m,vs,fs){
 var sh={uniforms:{},vertexShader:vs==null?VERT_SRC:vs,fragmentShader:fs==null?FRAG_SRC:fs};
 if(m.onBeforeCompile)m.onBeforeCompile(sh);
 return sh;
}
var S={time:0,matchTime:0,teamStats:null,balls:[],seats:[]};
function seatOf(){return null;}
var CHG_COL=CONFIG.shots.charge.bandCol;
`;

const src=[
 rd('js/core.js'),
 rd('js/config.js'),
 THREE_STUB,
 STUBS,
 rd('js/stats.js'),
 'const SHOTC=CONFIG.shots;',
 ['shotsOn','shotChgBand','shotCharge','shotChargeBand','shotChargeBlock'].map(n=>slice(rd('js/shots.js'),n)).join('\n'),
 slice(rd('js/matchstats.js'),'msScorer'),
 slice(rd('js/models.js'),'rodHoleShader'),
 slice(rd('js/models.js'),'registerRodHoles'),
 // the goal-flash state + arming live up beside the LED goal state they mirror, so they come in
 // as their own region rather than with the rest of the rod-hole block
 region(rd('js/fx.js'),'let rhGoalRod=-1,rhGoalT=0;','function rodHoleGoal(')+slice(rd('js/fx.js'),'rodHoleGoal'),
 region(rd('js/fx.js'),'const RH=CONFIG.fx.rodHoles;','function spawnTrail('),
 'globalThis.__x={};for(const k of ["registerRodHoles","rodHoleShader","rodHolesUpdate","rodHoleSpent",'+
 '"rodHoleFill","stFat","stFatRamp","RH","RH_IDLE","RH_WARM","RH_HOT","RH_BAND","CONFIG","skinRodHoles",'+
 '"msScorer","rodHoleGoal","stTire","stExert"])globalThis.__x[k]=eval(k);'+
 'globalThis.__set=(k,v)=>{eval(k+"=v");};globalThis.__get=k=>eval(k);'
].join('\n');

function boot(mutate){
 let s=src;
 if(mutate){const before=s;s=mutate(s);if(s===before)throw new Error('MUTATION DID NOT APPLY');}
 const warns=[];
 const ctx={console:{log(){},warn(m){warns.push(String(m));},error(){}},Math,Date,JSON,Set,Map,Object,Array,
  String,Number,parseInt,parseFloat,isNaN,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  document:{createElement:()=>({style:{},classList:{add(){},remove(){}}}),getElementById:()=>null,addEventListener(){}},
  window:{addEventListener(){}},navigator:{userAgent:'node'},performance:{now:()=>0},globalThis:null};
 ctx.globalThis=ctx;ctx.self=ctx;ctx.__warns=warns;
 vm.runInNewContext(s,ctx,{filename:'rodholes-chain.js'});
 return ctx;
}
/* one converted skin, wired up and ready to drive */
function rig(c,sta){
 const DEFS=c.__x.CONFIG.rods.defs;
 const rs=DEFS.map((d,i)=>c.__get('ring')('rod_hole_'+(i+1),d.x));
 c.__get('registerRodHoles')(c.__get('root')(rs),'classic','wood');
 const list=c.__x.skinRodHoles.classic.wood;
 list.forEach(e=>{e.mat.userData.rhU=c.__get('compile')(e.mat).uniforms;});   // stand in for first render
 c.__set('rodHoleMeshes',list);
 c.__set('rods',DEFS.map((d,i)=>{const r=c.__get('mkRod')(0,sta==null?5:sta);r.idx=i;return r;}));
 return list;
}
/* Drive stFatRamp to exactly `x`. Setting BOTH channels to x is what makes the blend land on x
   whatever kickFat.weight is — nudging only the clock caps the ramp at (1-weight), which is the
   mistake that made this harness's first pass assert the wrong numbers. */
const spend=(c,x)=>{const ST=c.__x.CONFIG.stats;
 c.__get('rods').forEach(r=>{r.exert=ST.kickFat.full*x;});
 c.__set('S',{...c.__get('S'),matchTime:ST.fatStart+x*(ST.fatEnd-ST.fatStart),time:1});};
const run=(c,n)=>{for(let i=0;i<(n||300);i++)c.__get('rodHolesUpdate')(1/60);};
const dist=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.g-b.g)+Math.abs(a.b-b.b);

console.log('\n=== rod-hole rings ===\n');
const C=boot(),X=C.__x,CFG=X.CONFIG,RH=X.RH,DEFS=CFG.rods.defs;

/* ---------- A · CONFIG ---------- */
ok(RH&&typeof RH.on==='boolean','A1 CONFIG.fx.rodHoles exists');
ok(RH.mid>0&&RH.mid<1,'A2 mid sits strictly inside the colour ramp');
ok(RH.fillMin>=0&&RH.fillMin<0.5,'A3 fillMin leaves most of the travel to the gauge');
ok(RH.fillSoft>0,'A4 fillSoft positive (0 would alias the waterline at 30px)');
ok(RH.lerp>0,'A5 lerp positive');
ok(X.RH_BAND.length===CFG.shots.charge.bandCol.length,'A6 band colours come from CONFIG.shots.charge');

/* ---------- B · classification ---------- */
const listB=rig(boot());
ok(true,'B0 rig built');
const C1=boot(),lB=rig(C1);
ok(lB.length===DEFS.length,'B1 every ring registered');
ok(lB.every((e,i)=>e.rod===i),'B2 each ring maps to the rod it sits on');
ok(C1.__get('matClones')===DEFS.length,'B3 one material clone per ring');
ok(new Set(lB.map(e=>e.mat)).size===DEFS.length,'B4 no two rings share a material');
const C2=boot();
C2.__get('registerRodHoles')(C2.__get('root')([C2.__get('ring')('rod_hole_stray',0)]),'t','s');
ok(!(C2.__x.skinRodHoles.t&&C2.__x.skinRodHoles.t.s.length),'B5 a ring midway between rods is refused');
const C3=boot();
C3.__get('registerRodHoles')(C3.__get('root')([C3.__get('ring')('rod_hole_9.001',DEFS[3].x)]),'t','s');
ok(C3.__x.skinRodHoles.t.s[0].rod===3,'B6 the name\'s number is ignored — position decides');
const C3b=boot();
C3b.__get('registerRodHoles')(C3b.__get('root')([C3b.__get('ring')('wall_side_n',DEFS[0].x)]),'t','s');
ok(!C3b.__x.skinRodHoles.t,'B7 a mesh not named rod_hole* is ignored');

/* ---------- C · the shader injection ---------- */
const CS=boot(),lS=rig(CS);
const sh=CS.__get('compile')(lS[0].mat);
ok(/varying float vRhY/.test(sh.vertexShader),'C1 vertex declares the varying');
ok(/vRhY=\(modelMatrix\*vec4\(transformed,1\.0\)\)\.y/.test(sh.vertexShader),'C2 ...and fills it from WORLD y, not object y');
ok(/uniform float rhFill/.test(sh.fragmentShader),'C3 fragment declares the uniforms');
ok(/gl_FragColor\.rgb\+=rhGlow\*smoothstep/.test(sh.fragmentShader),'C4 ...and adds the glow through a soft waterline');
ok(sh.fragmentShader.indexOf('gl_FragColor.rgb+=rhGlow')<sh.fragmentShader.indexOf('#include <tonemapping_fragment>'),
   'C5 the add lands BEFORE tone mapping (linear space, where emissive would have gone)');
ok(['rhFill','rhY0','rhY1','rhSoft','rhGlow'].every(u=>sh.uniforms[u]),'C6 all five uniforms present');
near(sh.uniforms.rhY0.value,6.1,1e-6,'C7 rhY0 is this ring\'s own measured bottom');
near(sh.uniforms.rhY1.value,8.9,1e-6,'C8 rhY1 is this ring\'s own measured top');
const tall=boot(); tall.__get('registerRodHoles')(tall.__get('root')([tall.__get('ring')('rod_hole_1',DEFS[0].x,5.65,9.35)]),'t','s');
near(tall.__get('compile')(tall.__x.skinRodHoles.t.s[0].mat).uniforms.rhY1.value,9.35,1e-6,
   'C9 a skin whose rings are a different height gets its own bounds (strike is 5.65..9.35)');
// a chunk name that has moved must degrade, not explode
const CB=boot(),lB2=rig(CB);
CB.__get('compile')(lB2[1].mat,'void main(){}',null);
ok(lB2[1].mat.userData.rhU===null,'C10 a missing VERTEX anchor leaves the ring plain rather than black');
CB.__get('compile')(lB2[2].mat,null,'void main(){}');
ok(lB2[2].mat.userData.rhU===null,'C11 a missing FRAGMENT anchor does the same — the guards are separate');
ok(CB.__warns.filter(w=>/rod hole shader/.test(w)).length>=2,'C12 ...and each says so in the console');

/* ---------- D · stamina scales the RATE of tiring ---------- */
/* The property this whole model turns on: at identical clock and identical swings, a fitter rod's
   ring is fuller. Everything else in this section is a corner of that one sentence. */
const fillAt=(sta,x)=>{const c=boot();rig(c,sta);spend(c,x);run(c,600);return c.__get('rodHoleMeshes')[0].fill;};
const F0=boot(); rig(F0,0); spend(F0,1); run(F0,600);
const F10=boot(); rig(F10,CFG.stats.max); spend(F10,1); run(F10,600);
const D0=boot(); rig(D0,0); spend(D0,0); run(D0);
near(D0.__get('rodHoleMeshes')[0].fill,1,0.02,'D1 a fresh rod\'s ring is full');
near(F0.__get('rodHoleMeshes')[0].fill,RH.fillMin,0.02,'D2 a fully tired sta-0 rod drains to fillMin');
const ladder=[0,3,5,8,CFG.stats.max].map(sta=>fillAt(sta,1));
ok(ladder.every((v,i)=>i===0||v>ladder[i-1]+0.02),
   'D3 more stamina = a fuller ring after the same match and the same swings  ['+ladder.map(v=>v.toFixed(2)).join(', ')+']');
ok(F10.__get('rodHoleMeshes')[0].fill>F0.__get('rodHoleMeshes')[0].fill+0.5,
   'D4 ...and the gap between best and worst is worth looking at');
// a sta-0 rod has stTire 1, so its raw ramp IS its ramp — the only rod that can check the shape
const H0=boot(); rig(H0,0); spend(H0,0.5); run(H0,600);
near(H0.__get('rodHoleMeshes')[0].fill,RH.fillMin+(1-RH.fillMin)*0.5,0.02,'D5 half tired reads as half a ring');
near(X.stTire(C.__get('mkRod')(0,0)),1,1e-9,'D6 stTire is 1 at stamina 0 — the reference rod');
ok(X.stTire(C.__get('mkRod')(0,CFG.stats.max))<=Math.max(CFG.stats.tireFloor,1e-9)+1e-9,
   'D7 ...and bottoms out at tireFloor');

/* ---------- E · the physics did NOT change ---------- */
/* Moving the stat from the penalty onto the ramp is only safe because it is the same product. This
   asserts that against the OLD formula directly, at every stat value and several ramp depths — if
   anyone ever re-tunes stTire into a shape that is not (1 - sta/max), this is what will say so. */
{
 const c=boot(),ST=c.__x.CONFIG.stats,K=ST.kickFat;
 let worst=0,checked=0;
 for(let sta=0;sta<=ST.max;sta++)for(const x of [0,0.25,0.5,0.75,1]){
  const r=c.__get('mkRod')(0,sta);
  r.exert=K.full*x;
  c.__set('S',{...c.__get('S'),matchTime:ST.fatStart+x*(ST.fatEnd-ST.fatStart)});
  const wgt=K.on?K.weight:0;
  const rawRamp=wgt?x*(1-wgt)+x*wgt:x;                       // both channels at x
  const old=1-ST.fatMax*(1-sta/ST.max)*rawRamp;              // the model as it shipped
  worst=Math.max(worst,Math.abs(c.__x.stFat(r)-old));checked++;
 }
 ok(worst<1e-12,'E1 stFat matches the old model exactly across '+checked+' (stamina, tiredness) pairs — max drift '+worst.toExponential(1));
}
{ // and the capped-exertion corner, which is where a careless clamp order silently buffs high stamina
 const c=boot(),ST=c.__x.CONFIG.stats,K=ST.kickFat;
 const r=c.__get('mkRod')(0,ST.max);r.exert=K.full*K.cap;     // banked above `full`
 c.__set('S',{...c.__get('S'),matchTime:0});
 const wgt=K.on?K.weight:0;
 near(c.__x.stFat(r),1-ST.fatMax*(1-ST.max/ST.max)*(1*wgt),1e-12,
   'E2 a rod banked past kickFat.full still matches — the clamp happens before stTire, not after');
}

/* ---------- G2 · the colour ---------- */
ok(dist(F0.__get('rodHoleMeshes')[0].col,X.RH_HOT)<0.05,'E3 a drained sta-0 ring arrives at `hot`');
ok(dist(F10.__get('rodHoleMeshes')[0].col,X.RH_IDLE)<0.05,'E4 a max-stamina ring is still `idle` after the same match');
const M5=boot(); rig(M5,5); spend(M5,1); run(M5,600);
const c5=M5.__get('rodHoleMeshes')[0].col;
ok(dist(c5,X.RH_IDLE)>0.1&&dist(c5,X.RH_HOT)>0.1,'E5 a default sta-5 rod lands between the two');
{ // gamma is what earns the colour its place: the hue must run AHEAD of the drain
 const c=boot();rig(c,0);spend(c,0.3);run(c,600);
 const e=c.__get('rodHoleMeshes')[0],drained=1-(e.fill-RH.fillMin)/(1-RH.fillMin);
 ok(e.v>drained+0.05,'E6 the colour leads the level (gamma) — '+(e.v*100).toFixed(0)+'% coloured at '+(drained*100).toFixed(0)+'% drained');
}

/* ---------- F · charge, and the off switch ---------- */
const G=boot(),lG=rig(G,0); spend(G,1); run(G,600);
ok(G.__get('rodHoleMeshes')[0].fill<0.3,'F1 the ring is drained before the wind-up');
const sweet=(CFG.shots.charge.sweetFrom+CFG.shots.charge.sweetTo)/2;
G.__get('rods').forEach(r=>{r.chg=sweet;}); run(G,600);
near(lG[0].fill,1,0.02,'F2 a wind-up fills the ring completely — a charge is not a level');
ok(dist(lG[0].col,X.RH_BAND[1])<0.06,'F3 ...in the SAME gold as the seat marker');
G.__get('rods').forEach(r=>{r.chgBlock=CFG.shots.charge.blockAt;}); run(G,600);
ok(dist(lG[0].col,X.RH_BAND[3])<0.06,'F4 a wind-up the sweep guard refuses shows the blocked colour, not gold');
G.__get('rods').forEach(r=>{r.chg=-1;r.chgBlock=0;});
G.__set('cfg.rodHoles',false); run(G,10);
near(lG[0].mat.userData.rhU.rhFill.value,1,1e-9,'F5 Options toggle off hands the ring back full');
ok(lG[0].mat.userData.rhU.rhGlow.value.getHex()===0,'F6 ...and unlit');
const E=boot();E.__set('rodHoleMeshes',[]);
let threw=false;try{run(E,10);}catch(err){threw=true;}
ok(!threw,'F7 a skin with no rings is inert');

/* ---------- G · the goal flash ---------- */
const mkRec=(rod,team,sw)=>({team:team,role:'MID',rod:rod,sw:sw,t:0});
const GG=boot(),lGG=rig(GG,5);
const gRods=GG.__get('rods'),msScorer=GG.__x.msScorer;
// striker on team 0 swings, then it clips a team-1 defender on the way in: still the striker's goal
let g=msScorer({msc:mkRec(gRods[6],1,false),mss:mkRec(gRods[5],0,true)},0);
ok(g.rod===gRods[5]&&!g.own,'G1 a deflected goal is credited to the last SWING, not the deflection');
// team 1 swings it into its own net; team 0 benefits
g=msScorer({msc:mkRec(gRods[6],1,true),mss:mkRec(gRods[6],1,true)},0);
ok(g.rod===gRods[6]&&g.own,'G2 last contact being a swing by the conceding side is an own goal');
ok(msScorer({},0).rod===null,'G3 a ball with no records yields no scorer (stats off = no flash)');

GG.__x.rodHoleGoal(msScorer({msc:mkRec(gRods[2],0,true),mss:mkRec(gRods[2],0,true)},0),0);
run(GG,1);
const gCol=new (GG.__get('THREE').Color)(GG.__get('cfg').redColor);
ok(dist(lGG[2].col,gCol)<0.02,'G4 the SCORER\'s ring takes the scoring team\'s colour on the first frame — a flash does not ease in');
ok(dist(lGG[5].col,gCol)>0.1,'G5 ...and only that ring; the rest carry on reading stamina');
// it must outrank a live wind-up too
const sw2=(CFG.shots.charge.sweetFrom+CFG.shots.charge.sweetTo)/2;
gRods.forEach(r=>{r.chg=sw2;}); run(GG,1);
ok(dist(lGG[2].col,gCol)<0.02,'G6 a goal outranks a live charge on the same rod');
gRods.forEach(r=>{r.chg=-1;});
// strobe: the glow has to go somewhere over a couple of cycles
const seen=[];for(let i=0;i<40;i++){run(GG,1);seen.push(lGG[2].mat.userData.rhU.rhGlow.value.r);}
ok(Math.max(...seen)-Math.min(...seen)>0.2,'G7 it strobes rather than sitting at one brightness');
// and it lets go
run(GG,240);
ok(GG.__get('rhGoalT')===0,'G8 the flash expires on its own');
ok(dist(lGG[2].col,gCol)>0.1,'G9 ...and the ring settles back to its stamina reading');

// an OWN goal must not celebrate in the beneficiary's colour on the offending rod
const OG=boot(),lOG=rig(OG,5),oRods=OG.__get('rods');
OG.__x.rodHoleGoal(OG.__x.msScorer({msc:mkRec(oRods[3],1,true),mss:mkRec(oRods[3],1,true)},0),0);
run(OG,1);
const ownCol=new (OG.__get('THREE').Color)(RH.goal.own),benCol=new (OG.__get('THREE').Color)(OG.__get('cfg').redColor);
ok(dist(lOG[3].col,ownCol)<0.02,'G10 an own goal flashes the offending rod in `own`');
ok(dist(lOG[3].col,benCol)>0.1,'G11 ...and never in the beneficiary\'s colour');

// the countdown must not stall on a skin that ships no rings
const NG=boot(); NG.__set('rodHoleMeshes',[]);
NG.__x.rodHoleGoal({rod:{idx:0},own:false},0);
const t0=NG.__get('rhGoalT'); run(NG,30);
ok(NG.__get('rhGoalT')<t0,'G12 the countdown ticks even with no rings registered');

/* ---------- H · mutations ---------- */
const MUT=[
 ['classification snaps to the nearest rod instead of refusing',
  s=>s.replace('let ri=-1,best=tol;','let ri=-1,best=Infinity;'),
  c=>{c.__get('registerRodHoles')(c.__get('root')([c.__get('ring')('rod_hole_stray',0)]),'t','s');
      return !!(c.__x.skinRodHoles.t&&c.__x.skinRodHoles.t.s.length);}],
 ['the LEVEL is wired to stFat rather than to the ramp',
  s=>s.replace('(1-clamp(stFatRamp(r),0,1))','(clamp(stFat(r),0,1))'),
  c=>{rig(c,0);spend(c,1);run(c,600);
      return Math.abs(c.__get('rodHoleMeshes')[0].fill-c.__x.RH.fillMin)>0.05;}],
 ['stamina no longer scales the tiring rate at all',
  s=>s.replace("function stTire(r){return Math.max(STC.tireFloor,1-ST(r,'sta')/STC.max);}",
               'function stTire(r){return 1;}'),
  c=>{const f0=(()=>{rig(c,0);spend(c,1);run(c,600);return c.__get('rodHoleMeshes')[0].fill;})();
      const d=boot(s=>s.replace("function stTire(r){return Math.max(STC.tireFloor,1-ST(r,'sta')/STC.max);}",
               'function stTire(r){return 1;}'));
      rig(d,d.__x.CONFIG.stats.max);spend(d,1);run(d,600);
      return Math.abs(d.__get('rodHoleMeshes')[0].fill-f0)<0.05;}],
 ['the rate is applied to the clock but NOT to swinging',
  s=>s.replace("return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1)*stTire(r):0;",
               "return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1):0;"),
  c=>{const ST=c.__x.CONFIG.stats;
      const swingOnly=(ctx,sta)=>{rig(ctx,sta);
        ctx.__get('rods').forEach(r=>{r.exert=ST.kickFat.full;});
        ctx.__set('S',{...ctx.__get('S'),matchTime:0,time:1});   // clock channel silent
        run(ctx,600);return ctx.__get('rodHoleMeshes')[0].fill;};
      const a=swingOnly(c,0),d=boot(s=>s.replace("return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1)*stTire(r):0;",
               "return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1):0;"));
      return Math.abs(swingOnly(d,ST.max)-a)<0.05;}],
 ['stTire takes the MIN against the floor, so nothing ever tires',
  s=>s.replace('Math.max(STC.tireFloor,1-','Math.min(STC.tireFloor,1-'),
  c=>{rig(c,0);spend(c,1);run(c,600);return c.__get('rodHoleMeshes')[0].fill>0.9;}],
 ['the level is inverted (full when spent)',
  s=>s.replace('(1-clamp(stFatRamp(r),0,1))','(clamp(stFatRamp(r),0,1))'),
  c=>{rig(c,5);spend(c,0);run(c,300);return c.__get('rodHoleMeshes')[0].fill<0.9;}],
 ['fillMin ignored, so a spent ring goes completely dark',
  s=>s.replace('return RH.fillMin+(1-RH.fillMin)*','return 0+(1-0)*'),
  c=>{rig(c,0);spend(c,1);run(c,600);return c.__get('rodHoleMeshes')[0].fill<c.__x.RH.fillMin*0.5;}],
 ['gamma dropped, so the colour no longer leads the level',
  s=>s.replace('Math.pow(clamp(stFatRamp(r),0,1),RH.gamma)','clamp(stFatRamp(r),0,1)'),
  c=>{rig(c,0);spend(c,0.3);run(c,600);
      const e=c.__get('rodHoleMeshes')[0],dr=1-(e.fill-c.__x.RH.fillMin)/(1-c.__x.RH.fillMin);
      return e.v<=dr+0.05;}],
 ['the colour ramp stops at amber',
  s=>s.replace(':_rhA.copy(RH_WARM).lerp(RH_HOT,RH.mid<1?(sp-RH.mid)/(1-RH.mid):1);',':_rhA.copy(RH_WARM);'),
  c=>{rig(c,0);spend(c,1);run(c,600);
      return dist(c.__get('rodHoleMeshes')[0].col,c.__x.RH_HOT)>=0.05;}],
 ['a wind-up no longer fills the ring',
  s=>s.replace('tc=RH_BAND[band]||RH_IDLE;tg=RH.charge.glow;','tc=RH_BAND[band]||RH_IDLE;tg=RH.charge.glow;tf=0;'),
  c=>{const l=rig(c,5);spend(c,1);
      const sw=(c.__x.CONFIG.shots.charge.sweetFrom+c.__x.CONFIG.shots.charge.sweetTo)/2;
      c.__get('rods').forEach(r=>{r.chg=sw;});run(c,600);
      return Math.abs(l[0].fill-1)>0.05;}],
 ['the shader injects without checking the anchor exists',
  s=>s.replace("if(!anchor){console.warn('rod hole shader: no fragment anchor - ring left plain');return;}",
               "if(!anchor){anchor='';}"),
  c=>{const l=rig(c,5);
      try{c.__get('compile')(l[2].mat,null,'void main(){}');}catch(e){return true;}   // valid vertex, broken fragment
      return l[2].mat.userData.rhU!==null;}],
 ['an own goal celebrates in the beneficiary\'s colour',
  s=>s.replace('rhGoalCol.set(scorer.own?G.own:(team===0?cfg.redColor:cfg.blueColor));',
               'rhGoalCol.set(team===0?cfg.redColor:cfg.blueColor);'),
  c=>{const l=rig(c,5),rr=c.__get('rods');
      c.__x.rodHoleGoal(c.__x.msScorer({msc:{team:1,role:'MID',rod:rr[3],sw:true,t:0},mss:{team:1,role:'MID',rod:rr[3],sw:true,t:0}},0),0);
      run(c,1);
      const own=new (c.__get('THREE').Color)(c.__x.RH.goal.own);
      return dist(l[3].col,own)>=0.02;}],
 ['the goal flashes every ring, not just the scorer\'s',
  s=>s.replace('if(goalOn&&e.rod===rhGoalRod){','if(goalOn){'),
  c=>{const l=rig(c,5),rr=c.__get('rods');
      c.__x.rodHoleGoal(c.__x.msScorer({msc:{team:0,role:'MID',rod:rr[2],sw:true,t:0},mss:{team:0,role:'MID',rod:rr[2],sw:true,t:0}},0),0);
      run(c,1);
      const gc=new (c.__get('THREE').Color)(c.__get('cfg').redColor);
      return dist(l[5].col,gc)<0.1;}],
 ['the credit falls back to the last CONTACT, so deflections steal goals',
  s=>s.replace('const last=b&&b.msc,own=!!(last&&last.sw&&last.team===1-team),src=own?last:((b&&b.mss)||last);',
               'const last=b&&b.msc,own=!!(last&&last.sw&&last.team===1-team),src=last;'),
  c=>{rig(c,5);const r2=c.__get('rods');
      const g=c.__x.msScorer({msc:{team:1,role:'GK',rod:r2[7],sw:false,t:0},mss:{team:0,role:'MID',rod:r2[5],sw:true,t:0}},0);
      return g.rod!==r2[5];}],
 ['the goal flash lerps in instead of snapping',
  s=>s.replace('e.fill=1;e.v=0;e.col.copy(rhGoalCol);','e.fill=1;e.v=0;e.col.lerp(rhGoalCol,0.1);'),
  c=>{const l=rig(c,5),rr=c.__get('rods');
      c.__x.rodHoleGoal(c.__x.msScorer({msc:{team:0,role:'MID',rod:rr[2],sw:true,t:0},mss:{team:0,role:'MID',rod:rr[2],sw:true,t:0}},0),0);
      run(c,1);
      const gc=new (c.__get('THREE').Color)(c.__get('cfg').redColor);
      return dist(l[2].col,gc)>=0.02;}]
];
let caught=0;
console.log('\n--- mutations ---');
for(const [name,mut,test] of MUT){
 let broke=false,stale=false;
 try{ broke=test(boot(mut)); }
 catch(e){ if(/MUTATION DID NOT APPLY/.test(e.message))stale=true; else broke=true; }
 /* A mutation whose needle has drifted out of the source must NOT be scored as caught — the
    catch-all above would happily do that, and the suite would then rot one silent entry at a
    time while still reporting a perfect score. */
 if(stale){fail++;console.log('  STALE:  '+name+'  <- the needle no longer matches the source');}
 else if(broke){caught++;console.log('  caught: '+name);}
 else console.log('  MISSED: '+name);
}
console.log('\n'+pass+' passed, '+fail+' failed · '+caught+'/'+MUT.length+' mutations caught\n');
process.exit(fail||caught<MUT.length?1:0);
