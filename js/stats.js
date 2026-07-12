'use strict';
/* ================= rod stats ================= */
// Lookup is lazy so nothing needs wiring at build time:
//   r.stats (per rod) → S.teamStats[team][role or ALL] → CONFIG.stats.base.
// League mode fills S.teamStats per match; console test:
//   S.teamStats=[{ALL:{spd:9,str:9,acc:9,ctl:9,rea:9,sta:9}},null]
const STC=CONFIG.stats;
function ST(r,k){const t=S.teamStats&&S.teamStats[r.team],s=r.stats||(t&&(t[r.role]||t.ALL)),v=s&&s[k];return v==null?STC.base:v;}
function stFat(r){const ramp=clamp((S.matchTime-STC.fatStart)/(STC.fatEnd-STC.fatStart),0,1);return 1-STC.fatMax*(1-ST(r,'sta')/STC.max)*ramp;}
function stSpeed(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.spd)*stFat(r));}
function stHit(r){return Math.max(.2,1+(ST(r,'str')-STC.base)*STC.str);}
function stGrip(r){return clamp(KICK.grip*(1+(ST(r,'ctl')-STC.base)*STC.ctl),0,.6);}
function stReact(r){return Math.max(.2,1-(ST(r,'rea')-STC.base)*STC.rea)/stFat(r);}
function stCd(r){return Math.max(.25,1-(ST(r,'rea')-STC.base)*STC.cd);}
function stErr(r){return Math.max(.15,1-(ST(r,'acc')-STC.base)*STC.accErr);}
function stAim(r,a){return clamp(a+(ST(r,'acc')-STC.base)*STC.accAim,0,1);}
// 0..1 fraction of a rod's acc stat ABOVE base — how far toward max accuracy it is.
// Used to scale the sweet-spot power bonus (see collideRod): base 5 → 0, max 10 → 1.
function stAccFrac(r){return clamp((ST(r,'acc')-STC.base)/(STC.max-STC.base),0,1);}
// Decision intelligence multiplier on the difficulty's base iq roll (see ai.js). Base 5 = 1
// (unchanged); higher = more likely to trap/wait for the sweet spot, lower = greedier.
function stIQ(r){return Math.max(0,1+(ST(r,'iq')-STC.base)*STC.iq);}
// Kick aim-assist: bend the outgoing shot's heading toward the goal-mouth centre.
// Pure horizontal rotation (Magnus-style) — adds no energy, so it's stable. Only
// acts above base accuracy, only on goalward shots already near the target cone,
// and the bend is clamped small — it sweetens good strikes, it can't rescue bad ones.
function aimAssist(b,r){
 const a=Math.max(0,ST(r,'acc')-STC.base)/(STC.max-STC.base)*STC.assistMax;if(a<=0)return;
 const dir=r.team===0?1:-1,v=b.v,p=b.m.position;
 if(v.x*dir<STC.assistMinVX)return;
 // aim at the rod's chosen gap when gap-aiming this frame, else the goal-mouth centre (z=0)
 const tz=(r.aimEv&&CONFIG.ai.gapAim.gap)?r.aimEv.best.tz:0;
 const cur=Math.atan2(v.z,v.x*dir),want=Math.atan2(tz-p.z,(dir*F.L/2-p.x)*dir);
 let da=want-cur;if(da>Math.PI)da-=2*Math.PI;else if(da<-Math.PI)da+=2*Math.PI;
 if(Math.abs(da)>STC.assistCone)return;
 const th=clamp(da,-a,a)*dir,cs=Math.cos(th),sn=Math.sin(th),vx=v.x,vz=v.z;
 v.x=vx*cs-vz*sn;v.z=vx*sn+vz*cs;
}
