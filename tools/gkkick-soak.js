// Keeper-kick soak. Browser side: load the game (preview 'fuzeball'), then
//      fetch('tools/gkkick-soak.js',{cache:'no-store'}).then(r=>r.text()).then(eval)
//      gkKick({seeds:40,secs:120,diff:'pro'})   // whole AI-vs-AI matches: every keeper kick is followed for `win` s, what the DEF ahead of it was doing and what became of the ball
//      gkKick({seeds:120,keep:12})              // plus the first 12 balls that bounced back / stalled at the DEF: pose, why its receiving ended (recvEnd), the contact, the steps around it
// run from a terminal: node tools/page-run.js tools/gkkick-soak.js "gkKick({seeds:120,diff:'pro'})"
// why: 'the DEF raises back across the keeper's kick' is a whole-match question (it needs the DEF standing ready, which only play produces); 120 matches a side tell a change apart from noise
// tallies: kicks; byStyle: plain / pass(aimed) / trapShot; byPose: the DEF at the kick (fwd = leg over 0.2, raised, rest) / its action; holdN: steps the keeper held a plain kick (CONFIG.ai.dribble.pass.gk);
//   out: 'style|fwd or dn -> fate', fate = pinned (the DEF holds it) / through (past the DEF) / slowed / BOUNCED BACK (reversed at the DEF) / STALLED (stopped dead, not pinned) / lost to other team / other
// the number to watch is BOUNCED BACK + STALLED, and 'through' for a keeper that should be passing
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 window.gkKick=function(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:'pro',win:0.9,keep:0},o||{});
  const kd=[cfg.diffRed,cfg.diffBlue];cfg.diffRed=cfg.diffBlue=o.diff;
  const T={kicks:0,byStyle:{},byPose:{},out:{},holdN:0,blocks:[]};
  const kr=window.kickRod,re=window.recvEnd,gh=window.gkHold;let live=[];
  if(gh)window.gkHold=function(){const v=gh.apply(this,arguments);if(v)T.holdN++;return v;};
  window.recvEnd=function(r,why){for(const k of live)if(k.def===r&&!k.done)(k.ends=k.ends||[]).push([+(S.time-k.t0).toFixed(3),why,+S.balls[0].m.position.y.toFixed(2),+((S.balls[0].m.position.x-r.x)*r.kickDir).toFixed(1)]);return re.apply(this,arguments);};
  window.kickRod=function(r,style,aimAt,curve){
   const before=r.kickT,res=kr.apply(this,arguments);
   if(r.role==='GK'&&before<0&&r.kickT>=0){
    const def=rods.find(q=>q.team===r.team&&q.role==='DEF'),dir=r.kickDir;
    live.push({r,def,dir,t0:S.time,style:style||'plain',pass:!!(aimAt&&style==='pass'),tr:[],done:false,seed:o.cur,
     pose:{ang:+(def.angle*dir).toFixed(2),act:def.act||'-',ready:!!def.rvReady,raise:!!def.raise}});
   }
   return res;
  };
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;o.cur=seed;
    S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;});
    live=[];
    const n=Math.round(o.secs*SIM.hz);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();live=[];}
     const b0=S.balls[0];if(!b0)break;
     const pv=b0.v.clone();
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
     for(const k of live){
      if(k.done)continue;
      const d=k.def,dir=k.dir,p=b0.m.position,rel=(p.x-d.x)*dir,vx=b0.v.x*dir,el=S.time-k.t0;
      const dv=Math.hypot(b0.v.x-pv.x,b0.v.z-pv.z);
      if(o.keep)k.tr.push([+el.toFixed(3),+rel.toFixed(1),+vx.toFixed(1),+b0.v.z.toFixed(1),+(d.angle*dir).toFixed(2),+(d.angVel*dir).toFixed(1),d.act||'-',d.pinB?1:0,d.raise?1:0,d.pinPose?1:0]);
      if(rel>-4.5&&rel<4&&dv>6&&!k.hit)k.hit={t:+el.toFixed(3),rel:+rel.toFixed(2),vx0:+(pv.x*dir).toFixed(1),vx1:+vx.toFixed(1),ang:+(d.angle*dir).toFixed(2),act:d.act||'-',pinPose:!!d.pinPose};
      if(d.pinB&&k.pinned==null)k.pinned=el;
      if(el<o.win&&rel<=6)continue;
      k.done=true;T.kicks++;
      const sk=k.style+(k.pass?'(aimed)':'');T.byStyle[sk]=(T.byStyle[sk]||0)+1;
      const pk=(k.pose.ready||k.pose.ang>0.2?'fwd':(k.pose.raise?'raised':'rest'))+'/'+k.pose.act;T.byPose[pk]=(T.byPose[pk]||0)+1;
      let out;
      if(k.pinned!=null)out='pinned';
      else if(k.hit&&k.hit.vx1<k.hit.vx0-12&&(k.hit.vx1<0||vx<8))out=(k.hit.vx1<0||vx<0)?'BOUNCED BACK':'STALLED';
      else if(k.hit&&k.hit.vx1<k.hit.vx0-12)out='slowed';
      else if(rel>4&&vx>10)out='through';
      else if(S.lastTouch!==k.r.team)out='lost to other team';
      else out='other';
      const key=sk+'|'+(k.pose.ang>0.2?'fwd':'dn')+' -> '+out;T.out[key]=(T.out[key]||0)+1;
      if((out==='BOUNCED BACK'||out==='STALLED')&&T.blocks.length<o.keep)T.blocks.push({seed:k.seed,style:sk,pose:k.pose,ends:k.ends,hit:k.hit,tr:k.tr.filter((x,i)=>i%2==0).slice(0,40)});
     }
     live=live.filter(k=>!k.done);
    }
   }
  }finally{window.kickRod=kr;window.recvEnd=re;if(gh)window.gkHold=gh;cfg.diffRed=kd[0];cfg.diffBlue=kd[1];}
  return T;
 };
})();
