// Short-line soak: while an opposing ATT holds the ball, how often neither the keeper nor the DEF stands on the ball→nearest-mouth line, and why.
//      node tools/page-run.js tools/shortline-soak.js "slSoak({seeds:12,secs:120,diff:'pro'})"
//      slSoak({seeds,secs,seed0,diff,set})   // set: CONFIG paths overridden for the run
// d = nearest live GK/DEF man to the line from the REAL ball (u); open = d > cover.short.tol; spells = runs of open past spellT
// why (per open step): noRead (read not live: sub = its reason), fitGap (the fit itself leaves the line), lag (fit covers, a rod hasn't got there), off (a rod not on its fit: act / force / not fitted)
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function setPath(path,val){const ks=path.split('.');let o=CONFIG;for(let i=0;i<ks.length-1;i++)o=o[ks[i]];const old=o[ks[ks.length-1]];o[ks[ks.length-1]]=val;return old;}
 const bump=(o,k,v)=>{o[k]=(o[k]||0)+(v===undefined?1:v);};
 function attHold(u,b){
  const H=AIC.read.hold,p=b.m.position;
  if(p.y>AIC.lowY||Math.abs(b.v.x)>H.vx)return null;
  const d=u===0?1:-1;
  for(const o of rods){if(o.team!==u||o.role!=='ATT'||o.trnHidden)continue;const rel=(p.x-o.x)*d;if(rel>H.rel[0]&&rel<H.rel[1])return o;}
  return null;
 }
 window.slSoak=function(o){
  o=Object.assign({seeds:12,secs:120,seed0:1,diff:'pro',set:null,spellT:0.1,ex:12},o||{});
  const keep=[cfg.diffRed,cfg.diffBlue],olds=[];
  if(o.diff){cfg.diffRed=o.diff;cfg.diffBlue=o.diff;}
  if(o.set)for(const k in o.set)olds.push([k,setPath(k,o.set[k])]);
  const SH=AIC.cover.short,tol=SH.tol,gh=F.goalHalf*AIC.cover.mouth;
  const A={holdT:0,openT:0,dHist:{},why:{},sub:{},rodOff:{},rel:{},tn:{},lg:{},fg:{},big:{},bigT:0,vErr:{},spells:0,spellT:0,longSpells:0,holds:0,openHolds:0,
   shots:0,shotsOpen:0,goals:0,goalsOpen:0,goalsAtt:0,ex:[],m:0,goalsAll:0};
  const t0=performance.now();
  try{
   for(let si=0;si<o.seeds;si++){
    const seed=o.seed0+si*7;S.seedNext=seed;startMatchNow('ai');S.phase='count';S.countT=0;serve();
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;});
    const n=Math.round(o.secs*SIM.hz),st=[{h:null,ht:0,ot:0,run:0,dRel:0,open:false},{h:null,ht:0,ot:0,run:0,dRel:0,open:false}];
    let sc=[S.score[0],S.score[1]];const pend=[];
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();}
     if(!S.balls[0])break;
     aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);
     for(const tm of [0,1])if(S.score[tm]>sc[tm]){A.goalsAll++;
      for(let k=pend.length-1;k>=0;k--){const p=pend[k];if(p.att===tm&&S.time-p.t<2.5){A.goals++;if(p.open)A.goalsOpen++;pend.splice(k,1);break;}}}
     sc=[S.score[0],S.score[1]];
     if(S.phase==='play'){
      const b=S.balls[0],p=b.m.position;
      for(let t=0;t<2;t++){
       const u=1-t,s=st[t],h=attHold(u,b),gx=t===0?-F.L/2:F.L/2,dg=gx>0?1:-1;
       if(!h){
        if(s.h&&s.ht>=AIC.read.hold.minT){   // the hold ended: a shot if it leaves goalward fast
         if(b.v.x*dg>AIC.read.shotV){A.shots++;if(s.dRel>tol)A.shotsOpen++;pend.push({att:u,t:S.time,open:s.dRel>tol});}
        }
        if(s.run>=o.spellT){A.spells++;A.spellT+=s.run;if(s.run>=0.5)A.longSpells++;}
        s.h=null;s.ht=0;s.run=0;s.open=false;continue;
       }
       if(h!==s.h){s.h=h;s.ht=0;s.ot=0;s.run=0;s.open=false;s.exd=false;}
       s.ht+=FIX;
       if(s.ht<AIC.read.hold.minT)continue;
       if(s.ht-FIX<AIC.read.hold.minT)A.holds++;
       const sgz=clamp(p.z,-gh,gh);
       let g=null,df=null;for(const q of rods)if(q.team===t){if(q.role==='GK')g=q;else if(q.role==='DEF')df=q;}
       let d=1e9;for(const q of [g,df])if(q)d=shortOff(q,q.offset,p.x,p.z,gx,sgz,d);
       s.dRel=d;A.holdT+=FIX;
       bump(A.dHist,d<=tol?'<=tol':d<=2?'tol-2':d<=4?'2-4':d<=7?'4-7':'7+',FIX);
       if(d<=tol){if(s.run>=o.spellT){A.spells++;A.spellT+=s.run;if(s.run>=0.5)A.longSpells++;}s.run=0;continue;}
       A.openT+=FIX;s.run+=FIX;bump(A.rel,(t===0?p.x-(-F.L/2):F.L/2-p.x)<0?'?':Math.abs(p.z)>F.goalHalf?'wide':'central',FIX);if(!s.open){s.open=true;A.openHolds++;}
       // why
       const rd=RD[t];let why,sub='-';
       const fitted=[g,df].filter(q=>q&&rd.live&&rd.off[q.idx]!==undefined);
       if(!rd.live){why='noRead';
        const D=DIFFS[teamDiff(t)];let vh=null;
        for(const bb of S.balls){if(bb.scored)continue;const pv=aiView(g,bb,(D.reactDelay||0)*stReact(g)),pp=pv.m.position;vh=readHolder(u,pp.x,pp.y,pp.z,pv.v.x);if(vh)break;}
        sub=!vh?'viewNoHold':S.time-rd.t0<AIC.read.hold.minT?'minT':'noRods';
       }else{
        let fd=1e9,td=1e9;
        for(const q of [g,df]){if(!q)continue;const fo=rd.off[q.idx]!==undefined?rd.off[q.idx]:q.offset;fd=shortOff(q,fo,rd.bx,rd.bz,gx,clamp(rd.bz,-gh,gh),fd);}
        // the fit judged against the real ball too
        for(const q of [g,df]){if(!q)continue;const fo=rd.off[q.idx]!==undefined?rd.off[q.idx]:q.offset;td=shortOff(q,fo,p.x,p.z,gx,sgz,td);}
        const notFit=[g,df].filter(q=>q&&rd.off[q.idx]===undefined);
        if(fd>tol){let rc=1e9;const vz=clamp(rd.bz,-gh,gh);for(const q of [g,df]){if(!q)continue;for(let a=-q.maxOff;a<=q.maxOff;a+=0.25)rc=shortOff(q,a,rd.bx,rd.bz,gx,vz,rc);}
         bump(A.fg,(rc>tol?'unreachable':'reachable')+':'+(fd<=2?'tol-2':fd<=4?'2-4':'4+')+':'+(fitted.length===2?'both':fitted.map(q=>q.role).join('')+'only'),FIX);}
        if(notFit.length===2)why='off';
        else if(fd>tol)why='fitGap';
        else if(td>tol)why='viewLag';   // fit covers the line the keeper sees, not the real one
        else{let gd=1e9;for(const q of [g,df]){if(!q)continue;gd=shortOff(q,rd.off[q.idx]!==undefined?q.target:q.offset,p.x,p.z,gx,sgz,gd);}
         why=gd>tol?'tgtNotFit':'lag';}   // the rods' targets aren't the fit, else they are still sliding there
        sub=notFit.map(q=>q.role+':'+(q.act||(q.force?'force':isUserRod(q)?'user':(rd.bx-q.x)*(t===0?1:-1)<=AIC.read.defAhead?'nearHold':'-'))).join(',')||'both';
       }
       if(why==='tgtNotFit')for(const q of [g,df])if(q&&rd.off[q.idx]!==undefined&&Math.abs(q.target-rd.off[q.idx])>1)bump(A.tn,q.role+':cvOn'+(+!!q.cvOn)+':iq'+(+!!q.aiIQ)+':calm'+(+!!q.clOn),FIX);
       if(why==='lag'||why==='viewLag')bump(A.lg,why+':'+[g,df].map(q=>q?q.role+(Math.abs(q.offset-(rd.off[q.idx]!==undefined?rd.off[q.idx]:q.offset))>1?'Moving':'There'):'').join('/'),FIX);
       bump(A.why,why,FIX);bump(A.sub,why+'|'+sub,FIX);if(d>4){A.bigT+=FIX;bump(A.big,why,FIX);}if(rd.live){const e=Math.abs(rd.bz-p.z);bump(A.vErr,e<1?'<1':e<3?'1-3':e<6?'3-6':'6+',FIX);}
       for(const q of [g,df])if(q)bump(A.rodOff,q.role+':'+(rd.live&&rd.off[q.idx]!==undefined?(Math.abs(q.offset-rd.off[q.idx])>1?'farFromFit':'onFit'):'unfit:'+(q.act||'-')),FIX);
       if(A.ex.length<o.ex&&s.run>=0.3&&!s.exd){s.exd=true;
        const rw=q=>q?{off:+q.offset.toFixed(2),tgt:+q.target.toFixed(2),fit:rd.off[q.idx]!==undefined?+rd.off[q.idx].toFixed(2):null,act:q.act||'-',vz:+(q.vz||0).toFixed(1)}:null;
        A.ex.push({seed,t:+S.time.toFixed(2),team:t,d:+d.toFixed(2),why,sub,ball:[+p.x.toFixed(1),+p.z.toFixed(1)],view:rd.live?[+rd.bx.toFixed(1),+rd.bz.toFixed(1)]:null,holdT:+s.ht.toFixed(2),GK:rw(g),DEF:rw(df),ph:rd.ph,jo:Object.assign({},rd.jo)});
       }
      }
     }
     updateRods(FIX);physics(FIX);S.time+=FIX;
     for(const q of S.balls)q.cur.copy(q.m.position);
    }
    A.m++;
   }
  }finally{cfg.diffRed=keep[0];cfg.diffBlue=keep[1];for(const [k,v] of olds.reverse())setPath(k,v);}
  const r2=x=>+x.toFixed(2),sh=(o2,tot)=>{const r={};for(const k of Object.keys(o2).sort((a,b)=>o2[b]-o2[a]))r[k]=r2(o2[k]/(tot||1));return r;};
  return {diff:o.diff,matches:A.m,wallS:r2((performance.now()-t0)/1000),
   attHoldSecsPerMatch:r2(A.holdT/A.m),openShare:r2(A.openT/(A.holdT||1)),holdsPerMatch:r2(A.holds/A.m),holdsEverOpen:r2(A.openHolds/(A.holds||1)),
   spellsPerMatch:r2(A.spells/A.m),spellsOver0_5sPerMatch:r2(A.longSpells/A.m),meanSpell:r2(A.spellT/(A.spells||1)),
   dShare:sh(A.dHist,A.holdT),openWhy:sh(A.why,A.openT),openWhyDetail:sh(A.sub,A.openT),rodStateWhenOpen:sh(A.rodOff,A.openT),openBallZ:sh(A.rel,A.openT),bigGapWhy:sh(A.big,A.bigT),fitGapDetail:sh(A.fg,A.openT),tgtNotFitBy:sh(A.tn,A.openT),lagBy:sh(A.lg,A.openT),viewZErrWhenOpen:sh(A.vErr,A.openT),
   shotsPerMatch:r2(A.shots/A.m),shotsFromOpen:r2(A.shotsOpen/(A.shots||1)),goalsFromHolds:A.goals,goalsFromOpen:A.goalsOpen,goalsAll:A.goalsAll,examples:A.ex};
 };
})();
