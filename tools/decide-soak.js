// Decision soak: what every AI rod is doing, and what it does with a slow ball in its reach.
//      node tools/page-run.js tools/decide-soak.js "dsSoak({seeds:12,secs:120,diff:'pro'})"
//      dsSoak({seeds,secs,seed0,diff,set:{'ai.hand.on':false}})   // set: CONFIG paths overridden for the run, restored after
//      dsLog({seed,secs,diff,role,n})   // one match: the first n state changes of rods of that role with a slow ball in reach
// state = act (catch:<catPh>, retrieve:<retPh>, none...); near = a slow ball (under slowV, below lowY) in the rod's reach (rel reachB..reachF)
// near.share: state shares while a slow ball is in reach; ep: per slow-ball visit, how it ended (pin, kick, touch = other control, gone = left untouched) and how long to it; side = share of that time with no man within alignTol of it
// kicks: per role:style a match; whiff = no touch by that rod within whiffT of the swing; slide = mean |slide speed| with a ball near
'use strict';
(function(){
 const FIX=1/SIM.hz,slowV=15,reachB=-6,reachF=6.5,alignTol=1.5,whiffT=0.4;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 const st=r=>r.act==='catch'?'catch:'+(r.catPh||'?'):r.act==='retrieve'?'ret:'+(r.retPh||'?'):(r.act||'none')+(r.pinB?'+pin':'');
 function near(r,b){
  if(!b||b.m.position.y>AIC.lowY)return null;
  const p=b.m.position,v=Math.hypot(b.v.x,b.v.z),rel=(p.x-r.x)*r.kickDir;
  if(v>slowV||rel<reachB||rel>reachF)return null;
  const m=nearestMan(r,p.z);if(m<0)return null;
  return {rel,v,dz:Math.abs(r.baseZ[m]+r.offset-p.z)};
 }
 function run(o,each){
  const olds=[];if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  cfg.diffRed=o.diff;cfg.diffBlue=o.diff;
  const kr=window.kickRod,mc=window.momContact,og=window.onGoal,rb=window.redropBall;
  const K=[],T={goals:0,redrops:0,n:0};
  window.kickRod=function(r,style){
   if(r.kickT<0&&!isUserRod(r)){const b=S.balls[0],nb=b&&near(r,b);K.push({r,role:r.role,style,t:S.time,hit:false,pin:!!r.pinB,rel:nb?+nb.rel.toFixed(1):null,dz:nb?+nb.dz.toFixed(1):null,act:st(r)});}
   return kr.apply(this,arguments);
  };
  window.momContact=function(b,r){for(let i=K.length-1;i>=0&&S.time-K[i].t<=whiffT;i--)if(K[i].r===r)K[i].hit=true;if(each&&each.touch)each.touch(b,r);return mc.apply(this,arguments);};
  window.onGoal=function(){T.goals++;return og.apply(this,arguments);};
  window.redropBall=function(){T.redrops++;return rb.apply(this,arguments);};
  const c0={CAS:Object.assign({},CAS),BGS:Object.assign({},BGS),KWS:Object.assign({},KWS)};
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=(o.seed0||1)+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    const prev=new Map();
    for(let i=0;i<Math.round(o.secs*SIM.hz);i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     for(const r of rods)prev.set(r,r.offset);
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     if(each)each.step(prev);
    }
    T.n++;
   }
  }finally{window.kickRod=kr;window.momContact=mc;window.onGoal=og;window.redropBall=rb;for(const [k,v] of olds.reverse())setPath(k,v);}
  const d={};for(const g in c0){d[g]={};const G=window[g]||eval(g);for(const k in G){const x=G[k]-c0[g][k];if(x)d[g][k]=+(x/T.n).toFixed(1);}}
  return {K,T,d};
 }
 window.dsSoak=function(o){
  o=Object.assign({seeds:12,secs:120,diff:'pro',set:null},o||{});
  const all={},nr={},ep={},sl={},open=new Map();
  const add=(o,k,v)=>{o[k]=(o[k]||0)+v;};
  const close=(r,e,how)=>{const E=ep[r.role]=ep[r.role]||{n:0,pin:0,kick:0,touch:0,gone:0,tPin:0,side:0,dur:0,stuck:0};E.n++;E[how]++;E.dur+=e.dur;E.side+=e.side;if(how==='pin')E.tPin+=e.dur;if(e.dur>2&&how!=='pin')E.stuck++;open.delete(r);};
  const res=run(o,{
   touch(b,r){const e=open.get(r);if(e&&!e.end)e.end=r.pinB?'pin':'touch';},
   step(prev){
    const b=S.balls[0];
    for(const r of rods){
     if(isUserRod(r)||!isActiveRod(r))continue;
     const s=st(r);add(all[r.role]=all[r.role]||{},s,FIX);
     const nb=near(r,b);let e=open.get(r);
     if(nb){
      add(nr[r.role]=nr[r.role]||{},s,FIX);
      const S2=sl[r.role]=sl[r.role]||{t:0,v:0};S2.t+=FIX;S2.v+=Math.abs(r.offset-prev.get(r))/FIX*FIX;
      if(!e){if(r.pinB===b)continue;e={dur:0,side:0};open.set(r,e);}
      e.dur+=FIX;if(nb.dz>alignTol)e.side+=FIX;
      if(r.pinB===b){close(r,e,'pin');continue;}
      if(r.kickT>=0&&r.kickT<0.05){close(r,e,'kick');continue;}
      if(e.end==='touch'){close(r,e,'touch');continue;}
     }else if(e){close(r,e,r.pinB===b?'pin':'gone');}
    }
   }
  });
  const n=res.T.n,pct=o=>{let s=0;for(const k in o)s+=o[k];const q={};for(const k of Object.keys(o).sort((a,b)=>o[b]-o[a]))if(o[k]/s>=0.005)q[k]=+(100*o[k]/s).toFixed(1);return q;};
  const out={goals:+(res.T.goals/n).toFixed(2),redrops:+(res.T.redrops/n).toFixed(2),state:{},near:{},nearSecs:{},ep:{},slide:{},kicks:{},whiff:{},counts:res.d};
  for(const k in all)out.state[k]=pct(all[k]);
  for(const k in nr){out.near[k]=pct(nr[k]);let s=0;for(const q in nr[k])s+=nr[k][q];out.nearSecs[k]=+(s/n).toFixed(1);}
  for(const k in ep){const E=ep[k];out.ep[k]={pm:+(E.n/n).toFixed(1),pin:+(E.pin/E.n).toFixed(2),kick:+(E.kick/E.n).toFixed(2),touch:+(E.touch/E.n).toFixed(2),gone:+(E.gone/E.n).toFixed(2),tPin:E.pin?+(E.tPin/E.pin).toFixed(2):null,dur:+(E.dur/E.n).toFixed(2),side:+(E.side/Math.max(1e-9,E.dur)).toFixed(2),stuck2s:+(E.stuck/n).toFixed(1)};}
  for(const k in sl)out.slide[k]=+(sl[k].v/sl[k].t).toFixed(1);
  const W={};for(const k of res.K){const g=k.role+':'+k.style;const G=out.kicks[g]=out.kicks[g]||{pm:0,whiff:0};G.pm++;if(!k.hit){G.whiff++;(W[g]=W[g]||[]).push([k.act,k.pin?1:0,k.rel,k.dz]);}}
  for(const g in out.kicks){const G=out.kicks[g];G.whiff=+(G.whiff/G.pm).toFixed(2);G.pm=+(G.pm/n).toFixed(1);}
  for(const g in W)out.whiff[g]=W[g].slice(0,8);
  return JSON.stringify(out);
 };
 window.dsLog=function(o){
  o=Object.assign({seed:1,secs:60,diff:'pro',role:'ATT',n:80,set:null},o||{});
  const L=[],last=new Map();
  run({seeds:1,seed0:o.seed,secs:o.secs,diff:o.diff,set:o.set},{
   touch(b,r){if(r.role===o.role&&L.length<o.n&&!(S.time-(r.__dsT||-9)<0.3))L.push((+S.time.toFixed(2))+' '+(r.team?'B':'R')+r.role+' TOUCH'+(r.pinB?' pinned':'')+' kick '+(r.kickT>=0?r.kickStyle:'-'));r.__dsT=S.time;},
   step(){
    const b=S.balls[0];
    for(const r of rods){
     if(r.role!==o.role||isUserRod(r)||!isActiveRod(r))continue;
     const s=st(r)+(r.ttPh?'/'+r.ttPh:'')+(r.puPh?'/pu:'+r.puPh:''),nb=near(r,b);
     if(last.get(r)!==s&&L.length<o.n){
      const p=b?b.m.position:null;
      L.push((+S.time.toFixed(2))+' '+(r.team?'B':'R')+r.role+' '+(last.get(r)||'-')+' -> '+s+(nb?'  ball rel '+nb.rel.toFixed(1)+' dz '+nb.dz.toFixed(1)+' v '+nb.v.toFixed(1):p?'  (ball x '+p.x.toFixed(0)+' v '+Math.hypot(b.v.x,b.v.z).toFixed(0)+')':'')+(r.pcWhy?' why '+r.pcWhy:''));
      last.set(r,s);
     }
    }
   }
  });
  return L.join('\n');
 };
})();
