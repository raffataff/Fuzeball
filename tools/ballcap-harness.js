'use strict';
/* tools/ballcap-harness.js — the per-contact SPEED CEILING (CONFIG.kick.cap, physics.js capSpeed).
   Slices the REAL capSpeed and stCapFrac out of their files rather than restating them, and drives
   them against the LIVE config, so a retune that breaks a promise fails here. rd() strips CRLF —
   physics.js and stats.js are CRLF files and a multi-line needle can never match one otherwise. */
const fs=require('fs'),vm=require('vm'),path=require('path');
const J=p=>path.join(__dirname,'..','js',p);
const rd=p=>fs.readFileSync(J(p),'utf8').replace(/\r\n/g,'\n');

let pass=0,fail=0;const fails=[];
const ok=(c,m)=>{c?pass++:(fail++,fails.push(m));};
const near=(a,b,e,m)=>ok(Math.abs(a-b)<=e,m+`  (got ${a}, want ${b}±${e})`);

/* ---- live CONFIG ---------------------------------------------------------------------------- */
const ctx={console,Math,JSON};vm.createContext(ctx);
vm.runInContext(rd('config.js').replace(/^/,rd('core.js')+'\n')+'\n;globalThis.__out={CONFIG,BALL_TYPES,KICK};',ctx);
const {CONFIG,BALL_TYPES,KICK}=ctx.__out;
const clamp=(v,a,b)=>Math.min(Math.max(v,a),b);

/* ---- slice the real functions --------------------------------------------------------------- */
function slice(src,name){
 const s=src.indexOf('function '+name+'(');
 if(s<0)throw new Error('no '+name);
 let d=0,i=src.indexOf('{',s);
 for(let j=i;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'&&--d===0)return src.slice(s,j+1);}
 throw new Error('unbalanced '+name);
}
const STC=CONFIG.stats;
const ST=(r,k)=>(r.stats&&r.stats[k]!=null)?r.stats[k]:STC.base;
const stCapFrac=new Function('ST','STC','clamp','return '+slice(rd('stats.js'),'stCapFrac'))(ST,STC,clamp);
const S={time:0,eff:[{boost:-1},{boost:-1}]};
const capSpeed=new Function('KICK','clamp','stCapFrac','S','return '+slice(rd('physics.js'),'capSpeed'))(KICK,clamp,stCapFrac,S);

const C=KICK.cap,MV=BALL_TYPES.classic.maxV;
const rod=(str,o={})=>Object.assign({team:0,stats:{str},shotOn:false,shotPow:1},o);
// drive a head-on strike: ball at speed `sp` along +x, arriving at `inSp`
function run(sp,r,sweet,inSp){
 const b={v:{x:sp,y:0,z:0},t:BALL_TYPES.classic};
 capSpeed(b,r,!!sweet,(inSp||0)*(inSp||0));
 return Math.hypot(b.v.x,b.v.y,b.v.z);
}
const ceilOf=(r,sweet)=>{let f=C.base+C.str*stCapFrac(r);if(sweet)f+=C.sweet;
 if(r.shotOn)f+=C.shot*(r.shotPow-1);if(S.eff[r.team].boost>S.time)f+=C.boost;return MV*clamp(f,C.min,C.max);};

/* ---- A · the knee passes everything under it through UNCHANGED ------------------------------ */
for(const str of [0,5,10]){
 const r=rod(str),knee=ceilOf(r)*C.knee;
 near(run(knee*0.5,r),knee*0.5,1e-9,`A str${str}: half the knee is untouched`);
 near(run(knee*0.999,r),knee*0.999,1e-9,`A str${str}: just under the knee is untouched`);
 ok(run(knee*1.001,r)<knee*1.001,`A str${str}: just over the knee is compressed`);
 near(run(knee*1.001,r),knee*1.001,0.01,`A str${str}: the compression has NO STEP at the knee`);
}

/* ---- B · monotonic, bounded by the ceiling, and asymptotic ---------------------------------- */
{
 const r=rod(5),cap=ceilOf(r);let prev=0;
 for(let sp=1;sp<=600;sp+=1){
  const out=run(sp,r);
  ok(out<cap+1e-9,`B str5: sp ${sp} never exceeds the ceiling`);
  ok(out>=prev-1e-9,`B str5: sp ${sp} is monotonic`);
  ok(out<=sp+1e-9,`B str5: sp ${sp} is never SPED UP`);
  prev=out;
 }
 ok(run(1e4,r)<=cap&&run(1e4,r)>cap*0.999,'B: an absurd impulse saturates AT the ceiling, never past it');
}

/* ---- C · the ceiling separates the stats, and the sweet spot / charge / boost move it -------- */
{
 const a=run(184,rod(0)),b=run(184,rod(5)),c=run(184,rod(10));
 ok(a<b&&b<c,`C: the same impulse separates by str (${a.toFixed(1)} / ${b.toFixed(1)} / ${c.toFixed(1)})`);
 ok(run(245,rod(10),true)>run(245,rod(10),false),'C: a sweet strike out-runs an ordinary one at str 10');
 ok(run(245,rod(5),true)>run(245,rod(5),false),'C: ...and at base str, where the old clip ate it entirely');
 const chg=rod(10,{shotOn:true,shotPow:1.166}),fin=rod(10,{shotOn:true,shotPow:0.80});
 ok(run(245,chg,true)>run(245,rod(10),true),'C: a well-timed charge raises the ceiling over a plain sweet hit');
 ok(run(245,fin)<run(245,rod(10)),'C: a FINESSE touch lowers its own ceiling');
 S.eff[0].boost=1;S.time=0;
 ok(run(184,rod(5))>b,'C: POWER HITS raises the ceiling too, so its 2.5x impulse is visible');
 S.eff[0].boost=-1;
}

/* ---- D · only the best strikes may reach maxV, and they DO ----------------------------------- */
{
 const best=rod(10,{shotOn:true,shotPow:1.166});
 ok(ceilOf(best,true)>MV,'D: a str-10 sweet charged strike asks for a ceiling past maxV...');
 ok(run(245,best,true)>MV,'D: ...and gets there, so stepBall\'s clamp finishes it and the heat glow can fill');
 ok(run(1e4,rod(10),true)<MV,'D: a sweet strike with no charge never reaches maxV on its own');
 ok(run(1e4,rod(10))<MV*CONFIG.fx.heat.from,'D: an ORDINARY str-10 strike can never glow');
 ok(run(1e4,rod(5))<MV*CONFIG.fx.heat.from,'D: nor an ordinary base-str one - which is the whole complaint');
}

/* ---- E · the ceiling bounds what a contact ADDED, never the speed it arrived with ------------ */
{
 const r=rod(0),cap=ceilOf(r);
 near(run(145,r,false,150),145,1e-9,'E: a weak boot grazing a 150 screamer does NOT slow it');
 near(run(145,r,false,145),145,1e-9,'E: ...nor one it neither sped up nor slowed');
 ok(run(145,r,false,100)>cap,'E: a graze off a 100 ball keeps more than the ceiling');
 near(run(145,r,false,100),100,1e-9,'E: ...exactly what it arrived with');
 ok(run(145,r,false,0)<cap,'E: a strike from a standing start IS capped');
 ok(run(34,r,false,140)===34,'E: a head-on deflection still sheds speed - that is the impulse, not this');
}

/* ---- E2 - a trap/dribble contact is untouched: it never gets near the lowest knee ------------ */
{
 const lo=MV*C.min*C.knee;
 const src=rd('physics.js');
 ok((src.match(/if\(!trapping\)capSpeed\(/g)||[]).length===2,'E2: BOTH call sites exempt a held contact - a trap/dribble is not a strike');
 ok(lo>CONFIG.shots.hold.grip*KICK.userSpeed*CONFIG.shots.hold.carry,'E2: ...and a full-speed carry would not have reached the lowest knee anyway');
 for(const sp of [5,12,20,32,39])near(run(sp,rod(0)),sp,1e-9,`E2: a ${sp} u/s carry is untouched at the weakest possible ceiling`);
}

/* ---- F · the off switch is a TRUE off switch ------------------------------------------------- */
{
 const was=C.on;C.on=false;
 near(run(245,rod(0)),245,1e-9,'F: cap.on:false leaves the impulse exactly as it was');
 C.on=was;
}

/* ---- G · mutations: each must break something ------------------------------------------------ */
function mutate(label,src,find,repl,check){
 const m=src.replace(find,repl);
 if(m===src){fail++;fails.push('MUTATION DID NOT APPLY: '+label);return;}
 const f=new Function('KICK','clamp','stCapFrac','S','return '+m)(KICK,clamp,stCapFrac,S);
 const runM=(sp,r,sw,inSp)=>{const b={v:{x:sp,y:0,z:0},t:BALL_TYPES.classic};
  f(b,r,!!sw,(inSp||0)*(inSp||0));return Math.abs(b.v.x);};
 ok(check(runM),'G mutation caught: '+label);
}
const CS=slice(rd('physics.js'),'capSpeed');
mutate('the arriving-speed floor dropped',CS,/ if\(out<inSp\)out=Math\.min\(sp,inSp\);.*\n/,'\n',
 rm=>rm(145,rod(0),false,150)<145);
mutate('a hard clip instead of the knee',CS,/let out=knee\+span\*\(1-Math\.exp\(-\(sp-knee\)\/span\)\);/,'let out=cap;',
 rm=>Math.abs(rm(200,rod(5))-rm(400,rod(5)))<1e-9);
mutate('the ceiling ignores str',CS,/let f=C\.base\+C\.str\*stCapFrac\(r\);/,'let f=C.base;',
 rm=>Math.abs(rm(184,rod(0))-rm(184,rod(10)))<1e-9);
mutate('the sweet spot no longer raises the ceiling',CS,/ if\(sweet\)f\+=C\.sweet;/,'',
 rm=>Math.abs(rm(245,rod(10),true)-rm(245,rod(10),false))<1e-9);

/* ---- the table ------------------------------------------------------------------------------ */
const HEAT=MV*CONFIG.fx.heat.from;
const raw=(str,sweet,shot)=>{ // reproduce collideRod's impulse for a head-on strike
 const foot=(KICK.strikeA/KICK.strike)*Math.hypot(CONFIG.physics.arm+CONFIG.physics.footBoxOff.x,CONFIG.physics.footBoxOff.y);
 const bin=40,vn=-(bin+foot),m=BALL_TYPES.classic.mass;
 let jm=-(1+KICK.restPower)*vn/m*Math.max(.2,1+(str-5)*CONFIG.stats.str);
 if(shot)jm*=shot;
 if(sweet)jm*=1+KICK.sweetSpot.strBase;
 let v=-bin+jm;return v+(foot-v)*KICK.grip;
};
console.log('\n  classic ball, mid-boot power swing, ball arriving at 40 u/s.  maxV '+MV+', glows from '+HEAT.toFixed(0));
console.log('  str | ordinary  was -> now | sweet      was -> now | sweet+charge');
for(const str of [0,2,4,6,8,10]){
 const cells=[[false,0],[true,0],[true,1.166]].map(([sw,sp])=>{
  const r=rod(str,sp?{shotOn:true,shotPow:sp}:{}),o=raw(str,sw,sp);
  const before=Math.min(o,MV),after=Math.min(run(o,r,sw,40),MV);
  return `${before.toFixed(0).padStart(3)} -> ${after.toFixed(0).padStart(3)}${after>=HEAT?' *':'  '}`;
 });
 console.log('  '+String(str).padStart(3)+' | '+cells.join('   | '));
}
console.log('  (* = hot enough to glow)');

console.log(`\n  ${pass} passed, ${fail} failed`);
for(const f of fails)console.log('   FAIL  '+f);
process.exit(fail?1:0);
