// A/B queue. Browser side: load the soaks you want (kickangle-soak, backswing-soak, posture-soak), then
//      fetch('tools/ab-queue.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      abQ([{kind:'ka',label:'on',set:{'ai.catch.recv.ready.feet':true},diff:'legend',seed0:4001,seeds:24,secs:120}, {...label:'off'...}])   // runs the jobs one after another in the page
//      abLeft()          // jobs still to run; poll with calls that return at once (a call that awaits a timer starves the queue and dies at 45 s)
//      abAgg()           // per kind + diff + label: matches, goals, whistles, passes, landing, pins, knocks, own goals
// why: one call of the preview JS tool is capped at 45 s, a 24-match soak takes 15-40 s; the queue runs in the page between calls and every job restores the CONFIG paths it set
// kinds: 'ka' = kaSoak (goals, whistles, passes, who touches them, pinned when received), 'bs' = bsSoak (goalward knocks, own goals, redrops), 'cover' = rdCover (the standing posture by who has the ball),
//   'rs' = rsSoak (what follows a re-seat: how it ends and how long it takes)
// set: { 'ai.catch.recv.rest': 0 } = CONFIG paths from CONFIG.; a job writes them, runs, restores
'use strict';
(function(){
 const path=(p,v,get)=>{const k=p.split('.');let o=CONFIG;for(let i=0;i<k.length-1;i++)o=o[k[i]];const last=k[k.length-1];if(get)return o[last];o[last]=v;};
 function run(j){
  const keep=Object.keys(j.set||{}).map(p=>[p,path(p,0,true)]),dk=[cfg.diffRed,cfg.diffBlue];
  try{
   for(const p in (j.set||{}))path(p,j.set[p]);
   if(j.diff){cfg.diffRed=cfg.diffBlue=j.diff;}
   const o={seeds:j.seeds||24,secs:j.secs||120,seed0:j.seed0||1};
   if(j.kind==='bs'){const T=bsSoak(Object.assign({secs:j.secs||180},o));return {kind:'bs',label:j.label,diff:j.diff,seed0:o.seed0,m:o.seeds,goals:T.goals,own:T.own,knocks:T.knocks,redrops:T.redrops,byAct:T.byAct};}
   if(j.kind==='rs'){const R=rsSoak(o);return {kind:'rs',label:j.label,diff:j.diff,seed0:o.seed0,m:R.matches,reseats:R.reseatsPerMatch*R.matches,ends:window.__rs_last.map(x=>[x.how.split(':')[0],+x.t.toFixed(2)])};}
   if(j.kind==='cover'){const R=rdCover(o);return {kind:'cover',label:j.label,diff:j.diff,seed0:o.seed0,m:R.matches,cover:R.cover,holder:R.byHolder};}
   const R=kaSoak(Object.assign({diff:j.diff,maxMs:1e9},o)),P=window.__ka_last.filter(s=>s.k==='pass'&&s.n>0),Pf=P.filter(s=>s.ft),rc=Pf.filter(s=>s.rcv);
   return {kind:'ka',label:j.label,diff:j.diff,seed0:o.seed0,m:R.matches,goals:R.goalsPerMatch*R.matches,wh:R.deadBallPerMatch*R.matches,passes:P.length,touched:Pf.length,own:Pf.filter(s=>s.ft==='own').length,rcv:rc.length,rcvPin:rc.filter(s=>s.ipin).length,plain:R.plain.perMatch*R.matches,pin:R.pin.perMatch*R.matches};
  }finally{for(const [p,v] of keep)path(p,v);cfg.diffRed=dk[0];cfg.diffBlue=dk[1];}
 }
 window.abQ=function(jobs){window.__ab={left:jobs.length,log:[]};let i=0;const step=()=>{if(i>=jobs.length)return;const j=jobs[i++];try{__ab.log.push(run(j));}catch(e){__ab.log.push({err:String(e),job:j.label});}__ab.left--;setTimeout(step,20);};setTimeout(step,20);return 'queued '+jobs.length;};
 window.abLeft=()=>__ab.left;
 window.abAgg=function(){
  const g={};
  for(const j of __ab.log){
   if(j.err)continue;
   const k=j.kind+'|'+(j.diff||'')+'|'+j.label,a=g[k]=g[k]||{n:0,m:0,goals:0,wh:0,passes:0,touched:0,own:0,rcv:0,rcvPin:0,plain:0,pin:0,knocks:0,redrops:0,byAct:{},cover:{}};
   a.n++;a.m+=j.m;
   for(const f of ['goals','wh','passes','touched','own','rcv','rcvPin','plain','pin','knocks','redrops'])a[f]+=j[f]||0;
   for(const x in (j.byAct||{}))a.byAct[x]=(a.byAct[x]||0)+j.byAct[x];
   for(const c in (j.cover||{})){const q=a.cover[c]=a.cover[c]||{s:0,f:0,u:0};q.s+=j.cover[c].samples;q.f+=(j.cover[c].fwd||0)*j.cover[c].samples;q.u+=(j.cover[c].up||0)*j.cover[c].samples;}
   for(const c in (j.holder||{})){const q=(a.holder=a.holder||{})[c]=a.holder[c]||{s:0,f:0};q.s+=j.holder[c].samples;q.f+=j.holder[c].fwd*j.holder[c].samples;}
  }
  const out={},pm=(x,m)=>+(x/m).toFixed(2),sh=(x,y)=>y?+(x/y).toFixed(2):null;
  const rs={};
  for(const j of __ab.log){
   if(j.err||j.kind!=='rs')continue;
   const a=rs[j.diff+'|'+j.label]=rs[j.diff+'|'+j.label]||{m:0,reseats:0,ends:[]};
   a.m+=j.m;a.reseats+=j.reseats;for(const e of j.ends)a.ends.push(e);
  }
  for(const k in rs){
   const a=rs[k],by={},q=(v,p)=>{v=v.slice().sort((x,y)=>x-y);return v.length?+v[Math.min(v.length-1,Math.floor(v.length*p))].toFixed(2):null;};
   for(const [h,t] of a.ends)(by[h]=by[h]||[]).push(t);
   out['rs|'+k]={matches:a.m,reseatsPerMatch:pm(a.reseats,a.m),ends:Object.fromEntries(Object.entries(by).map(([h,v])=>[h,{n:v.length,median:q(v,0.5),p90:q(v,0.9)}]))};
  }
  for(const k in g){
   const a=g[k],m=a.m;
   if(k.startsWith('rs'))continue;
   if(k.startsWith('bs'))out[k]={sets:a.n,matches:m,goals:a.goals,own:a.own,knocks:a.knocks,redrops:a.redrops,byAct:a.byAct};
   else if(k.startsWith('cover'))out[k]={sets:a.n,matches:m,fwdShare:Object.fromEntries(Object.entries(a.cover).map(([c,q])=>[c,{samples:q.s,fwd:sh(q.f,q.s),up:sh(q.u,q.s)}])),byHolder:Object.fromEntries(Object.entries(a.holder||{}).map(([c,q])=>[c,{samples:q.s,fwd:sh(q.f,q.s)}]))};
   else out[k]={sets:a.n,matches:m,goals:pm(a.goals,m),wh:pm(a.wh,m),passes:pm(a.passes,m),plain:pm(a.plain,m),pinShots:pm(a.pin,m),landing:sh(a.own,a.touched),rcvN:a.rcv,pinnedOfRcv:sh(a.rcvPin,a.rcv),pinnedPerMatch:pm(a.rcvPin,m)};
  }
  return out;
 };
})();
