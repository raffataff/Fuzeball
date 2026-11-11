// Covered-kick soak: which AI kicks fire into a covered lane (every kind), and what kept a catch from taking the ball instead.
//      node tools/page-run.js tools/plainkick-soak.js "pkSoak({seeds:24,secs:120,diff:'pro'})"
//      pkSoak({seeds,secs,seed0,diff,set:{'ai.catch.front.maxClose':60}})   // set: CONFIG paths overridden for the run, restored after
// kinds: plain (the canKick path), dribble (its release), pinShot, snake, ttStrike, pinPass / kickPass / runPass / dribPass
// covered = pinPlay's own test (pinOutlet < catch.lineClear, straight on); a pass: the lane to its aim point under dribble.pass.minClear; ce = how the rod's last catch ended (within 1.5 s)
// next = the first rod other than the kicker to touch the ball within 2.5 s: opp / own / none; row = it was the opposing row straight ahead
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 if(!window.__pk_kr0)window.__pk_kr0=kickRod;
 if(!window.__pk_mc0)window.__pk_mc0=momContact;
 let T=null;
 const bin=(x,edges,names)=>{for(let i=0;i<edges.length;i++)if(x<edges[i])return names[i];return names[names.length-1];};
 function rowAhead(team,bx){const dir=team===0?1:-1;let row=null,rd=1e9;for(const o of rods){if(o.team===team)continue;const a=(o.x-bx)*dir;if(a>0.5&&a<rd){rd=a;row=o;}}return row;}
 window.momContact=function(b,r){
  const o=__pk_mc0.apply(this,arguments);
  if(T)for(let i=T.open.length-1;i>=0;i--){const k=T.open[i];
   if(S.time-k.t>2.5){k.next='none';T.open.splice(i,1);continue;}
   if(r===k.rod)continue;
   k.next=r.team===k.team?'own':'opp';k.nextRole=r.role;k.row=r===k.ahead;k.nextT=+(S.time-k.t).toFixed(2);T.open.splice(i,1);
  }
  return o;
 };
 if(!window.__pk_ce0)window.__pk_ce0=catchEnd;
 window.catchEnd=function(r,cd,why){r.__ce={why:why||'-',t:S.time};return __pk_ce0.apply(this,arguments);};
 function kindOf(r,style){
  if(!style)return r.act==='dribble'?'dribble':'plain';
  if(style==='snake')return 'snake';
  if(style==='trapShot')return r.ttOn?'ttStrike':r.pinB?'pinShot':'trapShot';
  if(style==='pass')return r.pinB?'pinPass':r.act==='run'?'runPass':r.act==='dribble'?'dribPass':'kickPass';
  return style;
 }
 window.kickRod=function(r,style,aim,curve){
  if(T&&r.kickT<0&&!isUserRod(r)){
   const CA=AIC.catch,FE=CA.fetch,dir=r.kickDir,kind=kindOf(r,style);let b=null,bd=1e9;
   for(const q of S.balls){if(q.scored)continue;const d=Math.abs(q.m.position.x-r.x);if(d<bd){bd=d;b=q;}}
   if(b){
    const p=b.m.position,v=b.v,gx=dir>0?F.L/2:-F.L/2,rel=(p.x-r.x)*dir,spd=v.length(),vf=v.x*dir;
    const out=aim?lineClr(laneObs(r.team,p.x,aim.x),p.x,p.z,aim.x,aim.z):pinOutlet(r,p.x,p.z,laneObs(r.team,p.x,gx,CA.shotV),gx,0),cov=out<(aim?AIC.dribble.pass.minClear:CA.lineClear);
    const ce=r.__ce&&S.time-r.__ce.t<1.5?r.__ce.why.split(':').slice(0,2).join(':'):'-';
    let dz=1e9;for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;dz=Math.min(dz,Math.abs(p.z-(r.baseZ[i]+r.offset)));}
    const ogd=Math.abs(p.x-(dir>0?-F.L/2:F.L/2));
    const why=r.force?'force':r.act==='dribble'?'dribble':r.role==='GK'?'gk':ogd<=CA.ownGoalGuard?'owngoal':(r.catCd||0)>0?'catCd':
     (rel>=FE.near&&rel<=FE.far&&spd<=FE.maxV&&(r.ftCd||0)>S.time)?'ftCd':
     (rel>=FE.near&&rel<=FE.far&&spd<=FE.maxV)?'fetchband':
     (rel>CA.front.near&&-vf>=CA.front.minClose&&-vf<=CA.front.maxClose)?'frontband':
     (-vf>CA.front.maxClose)?'fastIn':'other';
    const k={rod:r,t:S.time,team:r.team,role:r.role,kind,pcWhy:(kind==='pinShot'||kind==='snake'||kind==='pinPass')?r.pcWhy:'-',ce,dir:vf<-2?'in':vf>2?'out':'still',iq:!!r.aiIQ,cov,out:+out.toFixed(2),rel:+rel.toFixed(2),spd:+spd.toFixed(1),vf:+vf.toFixed(1),vz:+v.z.toFixed(1),y:+p.y.toFixed(2),dz:+dz.toFixed(2),
     why,cd:+(r.catCd||0).toFixed(2),ahead:rowAhead(r.team,p.x),next:null,nextRole:null,row:false,nextT:null,
     spdB:bin(spd,[3,15,35],['<3','3-15','15-35','35+']),relB:bin(rel,[2,FE.near,FE.far],['<2','2-'+FE.near,FE.near+'-'+FE.far,'>'+FE.far])};
    k.pass=typeof laneShut!=='function'?'-':r.role==='GK'?'gk':r.force?'force':laneShut(r,b)?'view':'gate';   // why an under-0 kick got through: the keeper, the dead-ball push, the delayed view (shut on the real ball), or the gate itself
    T.all.push(k);T.open.push(k);T.last[r.team]=k;
   }
  }
  return __pk_kr0.apply(this,arguments);
 };
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 function share(list,fn){return list.length?+(list.filter(fn).length/list.length).toFixed(2):0;}
 function tally(list,key,m){const o={};for(const k of list){const g=k[key];(o[g]=o[g]||{n:0,opp:0,row:0});o[g].n++;if(k.next==='opp')o[g].opp++;if(k.row)o[g].row++;}
  for(const g in o){const c=o[g];o[g]={perMatch:+(c.n/m).toFixed(2),opp:+(c.opp/c.n).toFixed(2),row:+(c.row/c.n).toFixed(2)};}return o;}
 function pkSoak(o){
  o=Object.assign({seeds:24,secs:120,seed0:1,diff:null,set:null},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],olds=[];
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  T={all:[],open:[],m:0,goals:0,whistles:0,dead:0,pins:0,pinShots:0,passes:0,last:[null,null],gl:{},db:{}};
  const wh=Au.whistle;Au.whistle=function(){T.whistles++;};
  // whistles = dead balls + balls out of play; a dead ball is labelled by the nearest rod with it in kick reach: its role, and whether the gate had it shut (deadzone = no rod in reach)
  const rb=window.redropBall;window.redropBall=function(b){
   T.dead++;let lab='zone';
   if(b&&deadzoneMult(b.cur||b.m.position)===1){let bd=1e9;for(const r of rods){const rel=(b.m.position.x-r.x)*r.kickDir;if(rel<-3||rel>AIC.inFrontMax||Math.abs(rel)>=bd)continue;bd=Math.abs(rel);lab=r.role+':'+(typeof laneShut==='function'&&laneShut(r,b)?'shut':'open')+':'+(r.pinB?'pin':(r.act||'-'));}}
   T.db[lab]=(T.db[lab]||0)+1;return rb.apply(this,arguments);};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    S.seedNext=o.seed0+si*7;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz),sc0=S.score[0]+S.score[1],cas0=Object.assign({},CAS);let scT=[S.score[0],S.score[1]];T.last=[null,null];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);
     for(const tm of [0,1])if(S.score[tm]>scT[tm]){const k=T.last[tm],g=k?k.kind+(k.out<0?':under0':':clear'):'none';T.gl[g]=(T.gl[g]||0)+1;}   // a goal, by the scoring team's last kick
     scT=[S.score[0],S.score[1]];
     updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
    }
    for(const k of T.open)k.next='none';T.open.length=0;
    T.goals+=S.score[0]+S.score[1]-sc0;T.pins+=CAS.pin-cas0.pin;T.pinShots+=CAS.shot-cas0.shot;T.passes+=CAS.pass-cas0.pass;T.m++;
   }
  }finally{Au.whistle=wh;window.redropBall=rb;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];for(const [k,v] of olds.reverse())setPath(k,v);}
  const A=T.all,m=Math.max(1,T.m),pm=x=>+(x/m).toFixed(2);
  const R={diff:o.diff||cfg.diffRed,matches:T.m,wallS:+((performance.now()-t0)/1000).toFixed(1),goals:pm(T.goals),whistles:pm(T.whistles),dead:pm(T.dead),pins:pm(T.pins),pinShots:pm(T.pinShots),catchPasses:pm(T.passes),kinds:{}};
  for(const kd of [...new Set(A.map(k=>k.kind))]){
   const L=A.filter(k=>k.kind===kd),cov=L.filter(k=>k.cov),opn=L.filter(k=>!k.cov);
   R.kinds[kd]={perMatch:pm(L.length),covered:pm(cov.length),nextOpp:{covered:share(cov,k=>k.next==='opp'),open:share(opn,k=>k.next==='opp')},rowAhead:{covered:share(cov,k=>k.row),open:share(opn,k=>k.row)}};
   if(kd==='plain'){R.kinds[kd].under0By=tally(L.filter(k=>k.out<0),'pass',m);for(const k of L)k.outB=bin(k.out,[-2,0,0.75,1.5,3],['<-2','-2..0','0..0.75','0.75..1.5','1.5..3','3+']);R.kinds[kd].byOut=tally(L,'outB',m);R.kinds[kd].byOutATT=tally(L.filter(k=>k.role==='ATT'),'outB',m);}
   if(kd==='plain'||kd==='dribble'){const K=R.kinds[kd];K.covByRole=tally(cov,'role',m);K.covByWhy=tally(cov,'why',m);K.covBySpeed=tally(cov,'spdB',m);K.covByRel=tally(cov,'relB',m);K.covByDir=tally(cov,'dir',m);K.covByCatchEnd=tally(cov,'ce',m);}
   if(kd==='pinShot'||kd==='snake'||kd==='pinPass')R.kinds[kd].covByPcWhy=tally(cov,'pcWhy',m);
  }
  R.deadBy={};for(const g of Object.keys(T.db).sort((x,y)=>T.db[y]-T.db[x]))R.deadBy[g]=pm(T.db[g]);
  R.goalsByLastKick={};for(const g in T.gl)R.goalsByLastKick[g]=pm(T.gl[g]);
  window.__pk_last=A;
  return R;
 }
 window.pkSoak=pkSoak;
})();
