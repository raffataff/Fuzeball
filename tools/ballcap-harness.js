'use strict';
// tools/ballcap-harness.js: the per-contact SPEED CEILING (CONFIG.kick.cap, physics.js capSpeed)
// slices the real capSpeed and stCapFrac and drives them against live config, so a retune that breaks a promise fails here; rd() strips CRLF (physics.js and stats.js are CRLF and a multi-line needle can't match one)
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
const boostSwing=new Function('KICK','return '+slice(rd('physics.js'),'boostSwing'))(KICK);
const capSpeed=new Function('KICK','clamp','stCapFrac','S','boostSwing','return '+slice(rd('physics.js'),'capSpeed'))(KICK,clamp,stCapFrac,S,boostSwing);

const C=KICK.cap,MV=BALL_TYPES.classic.maxV;
const rod=(str,o={})=>Object.assign({team:0,stats:{str},shotOn:false,shotPow:1},o);
// drive a head-on strike: ball at speed `sp` along +x, arriving at `inSp`
function run(sp,r,sweet,inSp){
 const b={v:{x:sp,y:0,z:0},t:BALL_TYPES.classic};
 capSpeed(b,r,!!sweet,(inSp||0)*(inSp||0));
 return Math.hypot(b.v.x,b.v.y,b.v.z);
}
const ceilOf=(r,sweet)=>{let f=C.base+C.str*stCapFrac(r);if(sweet)f+=C.sweet;
 if(r.shotOn)f+=C.shot*(r.shotPow-1);if(S.eff[r.team].boost>S.time&&boostSwing(r))f+=C.boost;return MV*clamp(f,C.min,C.max);};

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
 ok(run(1e4,r)<=cap+1e-9&&run(1e4,r)>cap*0.999,'B: an absurd impulse saturates AT the ceiling, never past it');   // +1e-9: knee+(cap-knee) can round a hair over cap
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
 ok(run(184,rod(5,{kickT:0.01,angVel:30,kickDir:1}))>b,'C: POWER HITS raises the ceiling of a swing too, so its 2.5x impulse is visible');
 ok(run(184,rod(5,{kickT:-1,angVel:0,kickDir:1}))===b,'C: ...and not of a touch that is not a strike (a trap, a pin, a bounce)');
 S.eff[0].boost=-1;
}

/* ---- C2 · a WELL-TIMED CHARGE beats the cap (r.shotOver, owner 2026-09-25) ------------------ */
{
 const ch=(w,o)=>rod(5,Object.assign({shotOn:true,shotPow:1.166,shotOver:w},o||{}));
 const bv=()=>({v:{x:1e4,y:0,z:0},t:BALL_TYPES.classic});
 const full=bv();capSpeed(full,ch(1),true,0);
 ok(Math.abs(full.v.x)>MV,'C2: a full-worth charge leaves a ball PAST maxV (got '+Math.abs(full.v.x).toFixed(1)+' vs '+MV+')');
 ok(full.over>MV&&Math.abs(full.v.x)<=full.over+1e-9,'C2: ...and hands stepBall an allowance that covers it');
 ok(Math.abs(full.v.x)<=MV*(C.max+C.chargeTop)+1e-9,'C2: ...but never past max + chargeTop');
 const none=bv();capSpeed(none,ch(0),true,0);
 ok(Math.abs(none.v.x)<Math.abs(full.v.x)&&!(none.over>0),'C2: an overcooked charge (worth 0) earns no overspeed and no allowance');
 const half=bv();capSpeed(half,ch(0.5),true,0);
 ok(Math.abs(half.v.x)>Math.abs(none.v.x)&&Math.abs(half.v.x)<Math.abs(full.v.x),'C2: a half-worth charge lands between');
 // the SAME swing, as it really runs: one charged contact, then the shot is spent and the boot meets
 // the ball again on later substeps (shotOn false, the swing still in flight, r.swOver marking it)
 const sw=rod(5,{shotOn:true,shotPow:1.166,shotOver:1,kickT:0.02,swOver:1});
 capSpeed(bv(),sw,true,0);sw.shotOn=false;sw.shotOver=0;
 const fol=bv();capSpeed(fol,sw,true,0);
 ok(Math.abs(fol.v.x)>MV,'C2: a later contact of the SAME charged swing (shot already spent) still beats the cap');
 ok(Math.abs(Math.abs(fol.v.x)-Math.abs(full.v.x))<1e-9,'C2: ...and keeps exactly the ceiling the charged contact earned');
 sw.kickT=-1;const late=bv();capSpeed(late,sw,true,0);
 ok(Math.abs(late.v.x)<=MV*C.max+1e-9,'C2: ...but not once that swing is over');
 const flat=bv();capSpeed(flat,rod(10,{shotOn:true,shotPow:1.166}),true,0);
 ok(!(flat.over>0),'C2: a strike with no charge at all never gets an allowance');
}

/* ---- C3 · the pin / trap shot keeps its ceiling for the WHOLE swing --------------------------- */
{
 // the boot meets the ball ~40 times in one swing and the shot's own trim is spent on the first touch, so the ceiling cannot ride on shotOn
 const pinS=(o)=>rod(5,Object.assign({kickStyle:'trapShot',kickT:0.12},o||{}));
 const bv=()=>({v:{x:1e4,y:0,z:0},t:BALL_TYPES.classic});
 const plain=bv();capSpeed(plain,rod(5,{kickT:0.12}),true,0);
 const first=bv();capSpeed(first,pinS({shotOn:true,shotPow:1.15}),true,0);
 const later=bv();capSpeed(later,pinS(),true,0);   // shot already spent: shotOn false, the swing still in flight
 ok(C.pin>0,'C3: the pin ceiling bonus is on');
 ok(Math.abs(later.v.x)>Math.abs(plain.v.x)+1,'C3: a later contact of a pin shot out-runs a plain swing\'s');
 ok(Math.abs(later.v.x)>=Math.abs(plain.v.x)+MV*C.pin*0.3,'C3: ...by a real margin, not a rounding error');
 ok(Math.abs(first.v.x)>=Math.abs(later.v.x)-1e-9,'C3: the armed first touch is never LOWER than a spent follow-up');
 ok(Math.abs(later.v.x)<MV,'C3: ...and the pin shot still never reaches maxV on its own (that stays the charge\'s)');
 const pass=bv();capSpeed(pass,rod(5,{kickStyle:'pass',kickT:0.12}),true,0);
 ok(Math.abs(pass.v.x)<=Math.abs(plain.v.x)+1e-9,'C3: a pass swing gets no pin bonus');
 const was=C.pin;C.pin=0;const off=bv();capSpeed(off,pinS(),true,0);C.pin=was;
 ok(Math.abs(off.v.x)<=Math.abs(plain.v.x)+1e-9,'C3: cap.pin 0 puts the pin shot back on the plain ceiling');
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
 ok((src.match(/(=trapping\|\||=!trapping&&)capSpeed\(/g)||[]).length===2,'E2: BOTH call sites exempt a held contact - a trap/dribble is not a strike');
 ok(lo>CONFIG.shots.hold.grip*KICK.userSpeed*CONFIG.shots.hold.carry,'E2: ...and a full-speed carry would not have reached the lowest knee anyway');
 for(const sp of [5,12,20,32,39])near(run(sp,rod(0)),sp,1e-9,`E2: a ${sp} u/s carry is untouched at the weakest possible ceiling`);
}

/* ---- F · the off switch is a TRUE off switch ------------------------------------------------- */
{
 const was=C.on;C.on=false;
 near(run(245,rod(0)),245,1e-9,'F: cap.on:false leaves the impulse exactly as it was');
 C.on=was;
}

/* ---- H · keep: a re-hit by a boot faster than the ball keeps the strike's heading (cap.keep) ---- */
// the boot's contact point runs at ~240 u/s against a ceiling of ~104, so it meets the ball ~20 times a swing; scaling the whole velocity let every re-hit re-aim it straight
const DEG=180/Math.PI,hd=v=>Math.atan2(v.z,v.x)*DEG;
function keepRun(fn,v,v0,inSp,r,keep){
 const was=C.keep;C.keep=keep;
 const b={v:Object.assign({},v),t:BALL_TYPES.classic};if(v0)b.v0=Object.assign({},v0);
 try{const ret=fn(b,r||rod(5,{kickT:0.01}),false,(inSp==null?(v0?Math.hypot(v0.x,v0.y,v0.z):0):inSp)**2);return {v:b.v,ret};}finally{C.keep=was;}
}
function keepChecks(fn,tag){
 const r=rod(5,{kickT:0.01}),cap=ceilOf(r),fails=[],chk=(c,m)=>{if(!c)fails.push(m);};
 // a strike from rest: exactly the old rescale
 {const v={x:4*cap,y:0.3*cap,z:1.5*cap},z0={x:0,y:0,z:0},a=keepRun(fn,v,z0,0,r,true),o=keepRun(fn,v,z0,0,r,false);
  chk(Math.abs(a.v.x-o.v.x)+Math.abs(a.v.y-o.v.y)+Math.abs(a.v.z-o.v.z)<1e-9,'H: a strike from rest leaves exactly as the old rescale');
  chk(a.ret===true,'H: ...and it aims (the assist may bend it)');}
 // a re-hit at the ceiling: the boot dragged it forward and the ceiling threw that away
 {const v0={x:0.95*cap*Math.cos(14/DEG),y:0,z:0.95*cap*Math.sin(14/DEG)},v={x:2.3*cap,y:0.2*cap,z:0.1*cap};
  const a=keepRun(fn,v,v0,null,r,true),o=keepRun(fn,v,v0,null,r,false);
  chk(hd(o.v)<4,'H: off, a re-hit re-aims the ball straight (the bug)');
  chk(Math.abs(hd(a.v)-14)<1e-6,`H: on, a re-hit keeps the heading the strike gave it (${hd(a.v).toFixed(2)} of 14)`);
  chk(Math.abs(Math.hypot(a.v.x,a.v.y,a.v.z)-Math.hypot(o.v.x,o.v.y,o.v.z))<1e-9,'H: ...at exactly the old speed');
  chk(Math.abs(a.v.y-o.v.y)<1e-9,'H: ...and the old lift');
  chk(a.ret===false,'H: ...and a re-hit aims nothing (no assist piling up over the swing)');
  chk(o.ret===true,'H: off, every contact aims as before');}
 // a re-hit that turns the ball's speed into lift: the old, lower horizontal speed on the kept heading
 {const v0={x:0.98*cap*Math.cos(10/DEG),y:0,z:0.98*cap*Math.sin(10/DEG)},v={x:1.2*cap,y:2*cap,z:0.05*cap};
  const a=keepRun(fn,v,v0,null,r,true),o=keepRun(fn,v,v0,null,r,false);
  chk(Math.abs(hd(a.v)-10)<1e-6,`H: a lifting re-hit keeps the heading (${hd(a.v).toFixed(2)} of 10)`);
  chk(Math.abs(Math.hypot(a.v.x,a.v.z)-Math.hypot(o.v.x,o.v.z))<1e-9&&Math.abs(a.v.y-o.v.y)<1e-9,'H: ...at the old horizontal speed and lift');}
 // a ball rolling along the row, struck up: a strike, exactly as before
 {const v0={x:0.1*cap,y:0,z:0.4*cap},v={x:3*cap,y:0,z:0.5*cap},a=keepRun(fn,v,v0,null,r,true),o=keepRun(fn,v,v0,null,r,false);
  chk(a.ret===true&&a.v.x===o.v.x&&a.v.z===o.v.z,'H: a ball struck up from a slow roll is a strike: it aims and leaves as before');}
 // a ball running at the boot is turned round, not held on its way in
 {const v0={x:-0.4*cap,y:0,z:0.1*cap},v={x:2.5*cap,y:0.1*cap,z:0.2*cap},a=keepRun(fn,v,v0,null,r,true),o=keepRun(fn,v,v0,null,r,false);
  chk(a.v.x>0.5*cap&&a.v.x===o.v.x,'H: a ball arriving head-on is sent back out as before');}
 // ...and so is a FAST one, which arrives at more than the speed it leaves at
 {const v0={x:-1.1*cap,y:0,z:0.2*cap},v={x:2*cap,y:0,z:0.3*cap},a=keepRun(fn,v,v0,null,r,true);
  chk(a.v.x>0&&a.ret===true,'H: a fast ball running at the boot is struck back, not kept on its way in');}
 // a deflection the ceiling lets through untouched keeps its new heading
 {const v0={x:1.5*cap,y:0,z:0},v={x:1.2*cap,y:0,z:0.6*cap},a=keepRun(fn,v,v0,null,r,true);
  chk(a.v.x===1.2*cap&&a.v.z===0.6*cap,'H: a glancing deflection the ceiling does not clip keeps its new heading');}
 // a contact under the knee, and a ball with no arrival velocity, are untouched
 {const a=keepRun(fn,{x:0.3*cap,y:0,z:0.1*cap},{x:0,y:0,z:0.2*cap},null,r,true);chk(a.v.x===0.3*cap&&a.v.z===0.1*cap&&a.ret===true,'H: a contact under the knee is passed through');}
 {const v={x:2.3*cap,y:0.2*cap,z:0.1*cap},a=keepRun(fn,v,null,0.95*cap,r,true),o=keepRun(fn,v,null,0.95*cap,r,false);chk(a.v.x===o.v.x&&a.v.z===o.v.z,'H: a ball with no arrival velocity (b.v0) gets the old rescale');}
 if(tag==null)for(const f of fails)ok(false,f);
 return fails.length;
}
ok(C.keep===true,'H: keep is on');
keepChecks(capSpeed);

/* ---- G · mutations: each must break something ------------------------------------------------ */
function mutate(label,src,find,repl,check){
 const m=src.replace(find,repl);
 if(m===src){fail++;fails.push('MUTATION DID NOT APPLY: '+label);return;}
 const f=new Function('KICK','clamp','stCapFrac','S','boostSwing','return '+m)(KICK,clamp,stCapFrac,S,boostSwing);
 const runM=(sp,r,sw,inSp)=>{const b={v:{x:sp,y:0,z:0},t:BALL_TYPES.classic};
  f(b,r,!!sw,(inSp||0)*(inSp||0));return Math.abs(b.v.x);};
 ok(check(runM),'G mutation caught: '+label);
}
const CS=slice(rd('physics.js'),'capSpeed');
mutate('the arriving-speed floor dropped',CS,/ if\(out<inSp\)out=Math\.min\(sp,inSp\);.*\n/,'\n',
 rm=>rm(145,rod(0),false,150)<145);
mutate('a hard clip instead of the knee',CS,/let out=knee\+span\*\(1-Math\.exp\(-\(sp-knee\)\/span\)\);/,'let out=cap;',
 rm=>Math.abs(rm(200,rod(5))-rm(400,rod(5)))<1e-9);
mutate('the ceiling ignores str',CS,/let f=C\.base\+C\.str\*stCapFrac\(r\),mx=C\.max;/,'let f=C.base,mx=C.max;',
 rm=>Math.abs(rm(184,rod(0))-rm(184,rod(10)))<1e-9);
mutate('the sweet spot no longer raises the ceiling',CS,/ if\(sweet\)f\+=C\.sweet;/,'',
 rm=>Math.abs(rm(245,rod(10),true)-rm(245,rod(10),false))<1e-9);
mutate('a follow-up contact in the same charged swing falls back to the plain ceiling',CS,/ else if\(r\.kickT>=0&&r\.swOver>0&&r\.swF>0\)\{if\(r\.swF>f\)f=r\.swF;if\(r\.swMx>mx\)mx=r\.swMx;\}/,'',
 rm=>{const sw=rod(5,{shotOn:true,shotPow:1.166,shotOver:1,kickT:0.02,swOver:1});rm(1e4,sw,true);sw.shotOn=false;sw.shotOver=0;return rm(1e4,sw,true)<=MV*C.max+1e-9;});
mutate('a pin shot falls back to the plain ceiling',CS,/ if\(r\.kickStyle==='trapShot'\)f\+=C\.pin\|\|0;.*\n/,'\n',
 rm=>Math.abs(rm(1e4,rod(5,{kickStyle:'trapShot',kickT:0.12}),true)-rm(1e4,rod(5,{kickT:0.12}),true))<1e-9);
mutate('every swing gets the pin bonus',CS,/if\(r\.kickStyle==='trapShot'\)f\+=C\.pin\|\|0;/,'f+=C.pin||0;',
 rm=>Math.abs(rm(1e4,rod(5,{kickStyle:'pass',kickT:0.12}),true)-rm(1e4,rod(5,{kickStyle:'trapShot',kickT:0.12}),true))<1e-9);
mutate('a charge no longer raises the most a ceiling may be',CS,/mx\+=\(C\.chargeTop\|\|0\)\*w;/,'',
 rm=>rm(1e4,rod(5,{shotOn:true,shotPow:1.166,shotOver:1}),true)<=MV*C.max+1e-9);
mutate('boost raises the ceiling of a touch that is not a strike',CS,'if(S.eff[r.team].boost>S.time&&boostSwing(r))','if(S.eff[r.team].boost>S.time)',
 rm=>{S.eff[0].boost=1;S.time=0;const v=rm(184,rod(5,{kickT:-1,angVel:0,kickDir:1}));S.eff[0].boost=-1;return v>rm(184,rod(5,{kickT:-1,angVel:0,kickDir:1}));});
function mutateK(label,src,find,repl){
 const m=src.replace(find,repl);
 if(m===src){fail++;fails.push('MUTATION DID NOT APPLY: '+label);return;}
 const f=new Function('KICK','clamp','stCapFrac','S','boostSwing','return '+m)(KICK,clamp,stCapFrac,S,boostSwing);
 ok(keepChecks(f,label)>0,'G mutation caught: '+label);
}
mutateK('keep ignored: a re-hit is rescaled as before',CS,'const v0=C.keep&&b.v0;','const v0=null;');
mutateK('a re-hit still aims',CS,'v.z=v0.z*hs/h0;}\n return false;','v.z=v0.z*hs/h0;}\n return true;');
mutateK('the kept heading loses the old speed',CS,'if(h0>1e-6){v.x=v0.x*hs/h0;v.z=v0.z*hs/h0;}','if(h0>1e-6){v.x=v0.x;v.z=v0.z;}');
mutateK('every clipped contact counts as a re-hit',CS,'||inSp<out*C.held','');
mutateK('a contact the ceiling did not clip counts as a re-hit',CS,'k>=1||','');
mutateK('a ball running at the boot counts as a re-hit',CS,'||v0.x*v.x+v0.z*v.z<=0','');
mutate('overspeed paid on any charge, however overcooked',CS,/const w=\(r\.shotOn&&r\.shotOver>0\)\?r\.shotOver:0;/,'const w=r.shotOn?1:0;',
 rm=>Math.abs(rm(1e4,rod(5,{shotOn:true,shotPow:1.166,shotOver:0}),true)-rm(1e4,rod(5,{shotOn:true,shotPow:1.166,shotOver:1}),true))<1e-9);

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
