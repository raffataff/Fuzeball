// Lane-look soak: every AI shot, and for each opposing row ahead what it was doing at the kick (offset, slide, target, top speed) and where it really was when the ball reached it (or touched it).
//      node tools/page-run.js tools/lanelook-soak.js "llSoak({seeds:48})" > tools/build/ll.json
//      node tools/lanelook-models.js tools/build/ll.json      // scores forecasts (laneObs's, toward the target, reach) by how many lanes they call open and how many of those the row touched
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 window.llSoak=function(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,set:null,diff:'pro'},o||{});
  const olds=[];if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  cfg.diffRed=o.diff;cfg.diffBlue=o.diff;
  const K=[],open=[];window.__ll=K;
  const kr=window.kickRod;
  window.kickRod=function(r,style){
   const shot=style==null||style==='trapShot'||style==='snake';
   if(r.kickT<0&&!isUserRod(r)&&shot&&r.role!=='GK'){
    let b=null,bd=1e9;for(const q of S.balls){const d=Math.abs(q.m.position.x-r.x);if(d<bd){bd=d;b=q;}}
    const ev=r.catAim||r.aimEv;
    if(b&&ev&&ev.best){
     const p=b.m.position,dir=r.kickDir,gx=dir*F.L/2;
     const kind=style==null?(r.act==='run'?'run':'plain'):r.pinB?(style==='snake'?'snake':'pin:'+(r.pcWhy||'-')):'tt';
     const rows=[];
     for(const q of rods){if(q.team===r.team)continue;const ah=(q.x-p.x)*dir;if(ah<=AIC.gapAim.minAhead)continue;
      rows.push({q,x:q.x,ah,base:q.baseZ.filter((z,i)=>manLive(q,i)),off0:q.offset,vz0:q.vz||0,tg0:q.target,ms:DIFFS[teamDiff(q.team)].speed*rodSpeedMult(q),act:q.act||'-',role:q.role,done:false});}
     K.push({rod:r,role:r.role,kind,style:style||'plain',t:S.time,lv:null,vx:0,bx:p.x,bz:p.z,tz:ev.best.tz,clr:ev.best.clr,dir,rows,b,end:null,touch:null,kick0:null});
     open.push(K[K.length-1]);
    }
   }
   return kr.apply(this,arguments);
  };
  const mc=window.momContact;
  window.momContact=function(b,r){
   for(let i=open.length-1;i>=0;i--){const k=open[i];if(k.b!==b)continue;if(r===k.rod){if(k.kick0==null)k.kick0=S.time-k.t;continue;}if(k.kick0==null)continue;k.touch=r.role+(r.team===k.rod.team?':own':':opp');k.tRod=r;{const w=k.rows.find(w=>w.q===r&&!w.done),p=b.m.position;if(w){w.done=true;w.t=S.time-k.t;w.off=r.offset;w.bz=p.z;w.lz=k.bz+(k.tz-k.bz)*((w.x-k.bx)/((k.dir*F.L/2)-k.bx));}}k.end='touch';open.splice(i,1);}
   return mc.apply(this,arguments);
  };
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();open.length=0;
    for(let i=0;i<Math.round(o.secs*SIM.hz);i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(let j=open.length-1;j>=0;j--){const k=open[j],p=k.b.m.position;
      if(S.time-k.t>2||k.b.scored){k.end=k.end||(k.b.scored?'goal':'time');open.splice(j,1);continue;}
      {const sp=k.b.v.length();if(k.lv==null&&sp>25)k.lv=S.time-k.t;if(k.lv!=null&&S.time-k.t-k.lv<0.1)k.vx=Math.max(k.vx,sp);}
      for(const w of k.rows){if(w.done)continue;if((p.x-w.x)*k.dir>=0){w.done=true;w.t=S.time-k.t;w.off=w.q.offset;w.bz=p.z;w.lz=k.bz+(k.tz-k.bz)*((w.x-k.bx)/((k.dir*F.L/2)-k.bx));}}
     }
    }
    for(const k of open)k.end=k.end||'time';open.length=0;
   }
  }finally{window.kickRod=kr;window.momContact=mc;for(const [k,v] of olds.reverse())setPath(k,v);}
  return JSON.stringify(K.map(k=>({role:k.role,kind:k.kind,lv:k.lv==null?null:+k.lv.toFixed(3),vx:+k.vx.toFixed(0),clr:+k.clr.toFixed(2),k0:k.kick0==null?null:+k.kick0.toFixed(3),end:k.end,touch:k.touch,rows:k.rows.filter(w=>w.done).map(w=>({blk:k.tRod===w.q,base:w.base,role:w.role,act:w.act,ah:+w.ah.toFixed(1),t:+w.t.toFixed(3),off0:+w.off0.toFixed(2),vz0:+w.vz0.toFixed(1),tg0:+w.tg0.toFixed(2),ms:+w.ms.toFixed(0),off:+w.off.toFixed(2),bz:+w.bz.toFixed(2),lz:+w.lz.toFixed(2)}))})));
 };
})();
