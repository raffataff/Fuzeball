// goal-cover harness. node tools/cover-harness.js
// slices the real coverMen / coverGap / coverFit / coverMan / coverZ (ai.js) and runs them on live CONFIG
// question: do the keeper and the defender split the mouth between them (the open width of the goal drops against both sitting on the ball-to-goal line), does the rod that plays the ball stay out of it while its mate covers, is a human or busy mate held where it stands, is the pair steady (no side flips, no jumps), and does the keeper go for a shot going in; each mutation must break an assertion
// the open width is measured here by testing real lines from the ball against every man, not by the shadow maths under test
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 cover:slice(AI,'const CVB=new Float64Array',NL+' function aiUpdate(')
};
const stubs="var S={time:0}; var rods=[]; function isUserRod(r){return !!r.human;} function isActiveRod(r){return !r.benched;} function teamDiff(){return 'pro';} function stPred(){return 1;}";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,Float64Array,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.cover,
  ';globalThis.X={S:S,AIC:AIC,F:F,setRods:function(v){rods=v;},coverZ:coverZ,coverMen:coverMen,coverGap:coverGap,coverFit:coverFit,coverReach:coverReach,DIFFS:DIFFS,CVB:CVB};'].join(NL),ctx);
 return ctx.X;
}

const DT=1/120;
const mkRod=(x,team,role,baseZ,maxOff,over)=>Object.assign({x,team,role,baseZ,maxOff,offset:0,target:0,removedUntil:[],aiBX:0,aiBZ:0,aiBVX:0,aiBVZ:0,act:null,force:false},over||{});
function table(X){
 const T={gk:mkRod(-52.5,0,'GK',[0],10),df:mkRod(-37.5,0,'DEF',[-12,12],18),gk1:mkRod(52.5,1,'GK',[0],10),df1:mkRod(37.5,1,'DEF',[-12,12],18)};
 X.setRods([T.gk,T.df,T.gk1,T.df1]);return T;
}
// one rod's coverZ the way aiUpdate calls it: dir-relative distance of the ball in front of this rod
function call(X,r,bx,bz,dt,vx,vz){const dir=r.team===0?1:-1;r.aiBX=bx;r.aiBZ=bz;r.aiBVX=vx||0;r.aiBVZ=vz||0;return X.coverZ(r,bz,(bx-r.x)*dir,dt===undefined?DT:dt);}
const live=(r,o)=>r.baseZ.map((b,i)=>({x:r.x,z:b+o,i})).filter(q=>!(r.removedUntil[q.i]&&r.removedUntil[q.i]>0));
// open width of the mouth (u): lines from the ball to the goal line that no man touches, tested line by line
function open(X,men,ox,oz,gx){
 const m=X.F.goalHalf*X.AIC.cover.mouth,hw=X.AIC.gapAim.blockR;let w=0;
 for(let z=-m;z<=m;z+=0.05){let hit=false;
  for(const q of men){const t=(q.x-ox)/(gx-ox);if(t<=0)continue;if(Math.abs(oz+(z-oz)*t-q.z)<hw){hit=true;break;}}
  if(!hit)w+=0.05;}
 return w;
}
// the widest single gap, same test
function widest(X,men,ox,oz,gx){
 const m=X.F.goalHalf*X.AIC.cover.mouth,hw=X.AIC.gapAim.blockR;let run=0,mx=0;
 for(let z=-m;z<=m;z+=0.05){let hit=false;
  for(const q of men){const t=(q.x-ox)/(gx-ox);if(t<=0)continue;if(Math.abs(oz+(z-oz)*t-q.z)<hw){hit=true;break;}}
  if(hit)run=0;else{run+=0.05;if(run>mx)mx=run;}}
 return mx;
}
// the old behaviour: both rods on the ball-to-goal-centre line (DEF's first reachable man on it)
function lineOffsets(X,T,bx,bz){
 const gx=-60,tg=(T.gk.x-bx)/(gx-bx),td=(T.df.x-bx)/(gx-bx);
 return {g:clamp(bz*(1-tg),-T.gk.maxOff,T.gk.maxOff),d:clamp(bz*(1-td)-T.df.baseZ[0],-T.df.maxOff,T.df.maxOff)};
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
// both rods solve (DEF first, as blue's order would), then read what each was given
function pairSolve(X,T,bx,bz){
 T.gk.cvM=0;T.df.cvM=0;
 const zD=call(X,T.df,bx,bz),zG=call(X,T.gk,bx,bz);
 return {zG,zD,og:T.gk.cvO,od:T.df.cvO};
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const CV=X.AIC.cover,gx=-60;
 const balls=[];for(const bx of [-22,-5,12,28])for(const bz of [-24,-12,0,8,20])balls.push([bx,bz]);

 // ---- shadows --------------------------------------------------------------------------------------------
 {const T=table(X);X.coverMen(T.gk,0,-10,0,gx,0);const w=X.CVB[1]-X.CVB[0],t=(T.gk.x+10)/(gx+10);
  ok('a man hides a stretch of goal line 2*blockR/t wide',Math.abs(w-2*X.AIC.gapAim.blockR/t)<1e-9,'w='+w+' want '+2*X.AIC.gapAim.blockR/t);}
 {const T=table(X);X.coverMen(T.df,0,-34.5,0,gx,0);const w=X.CVB[1]-X.CVB[0];
  ok('a man almost on the ball is shaded as tMin out, not as the whole mouth',Math.abs(w-2*X.AIC.gapAim.blockR/CV.tMin)<1e-9,'w='+w);}
 {const T=table(X);const k=X.coverMen(T.df,0,-30,0,gx,0);ok('a rod with two live men writes two shadows',k===2);
  T.df.removedUntil[1]=1e9;const k2=X.coverMen(T.df,0,-30,0,gx,0);ok('…a removed man writes none',k2===1);
  const k3=X.coverMen(T.df,0,-38,0,gx,0);ok('a rod behind the shot point hides nothing',k3===0,'k='+k3);}
 {const gm=X.F.goalHalf*CV.mouth;
  X.CVB[0]=-1;X.CVB[1]=1;ok('an open mouth with one shadow in it scores the two side gaps squared',Math.abs(X.coverGap(1,gm)-2*(gm-1)*(gm-1))<1e-9);
  X.CVB[0]=-gm;X.CVB[1]=gm;ok('a covered mouth scores nothing',X.coverGap(1,gm)===0);
  X.CVB[0]=-4;X.CVB[1]=0;X.CVB[2]=-2;X.CVB[3]=2;const a=X.coverGap(2,gm);X.CVB[0]=-4;X.CVB[1]=0;X.CVB[2]=0;X.CVB[3]=4;const b=X.coverGap(2,gm);
  ok('the same cover scores worse when the two shadows overlap',a>b+0.1,'a='+a.toFixed(2)+' b='+b.toFixed(2));
  X.CVB[0]=0;X.CVB[1]=4;X.CVB[2]=-4;X.CVB[3]=0;ok('shadows are sorted before the sweep (either slot order)',Math.abs(X.coverGap(2,gm)-b)<1e-9);}

 // ---- both defend: the pair splits the mouth -------------------------------------------------------------
 {let worst=0,bad=null,sumFit=0,sumLine=0;
  for(const [bx,bz] of balls){const T=table(X);const s=pairSolve(X,T,bx,bz);
   const fit=open(X,[...live(T.gk,s.og),...live(T.df,s.od)],bx,bz,gx);
   const L=lineOffsets(X,T,bx,bz),line=open(X,[...live(T.gk,L.g),...live(T.df,L.d)],bx,bz,gx);
   sumFit+=fit;sumLine+=line;if(fit>line+0.2){bad=[bx,bz,fit.toFixed(1),line.toFixed(1)];}
   if(line>0)worst=Math.max(worst,fit/line);}
  ok('from every ball position the split leaves no more of the mouth open than the old shared line',bad===null,'at '+bad);
  ok('…and over the table it leaves well under 60% of what the shared line did',sumFit<0.6*sumLine,'fit '+sumFit.toFixed(0)+' vs line '+sumLine.toFixed(0));}
 {const T=table(X);const L=lineOffsets(X,T,28,0),line=open(X,[...live(T.gk,L.g),...live(T.df,L.d)],28,0,gx);
  ok('sanity: both rods on one line leave a lot of the mouth open (the thing being fixed)',line>8,'open='+line.toFixed(1));}
 {const T=table(X);const s=pairSolve(X,T,28,0),w=widest(X,[...live(T.gk,s.og),...live(T.df,s.od)],28,0,gx),tot=open(X,[...live(T.gk,s.og),...live(T.df,s.od)],28,0,gx);
  ok('the gaps are even: no single gap holds most of what is open',w<0.55*tot,'widest '+w.toFixed(1)+' of '+tot.toFixed(1));}
 {let worst=0;const T=table(X);
  for(const [bx,bz] of balls){const s=pairSolve(X,T,bx,bz);
   // brute force the best pair on the same line test (coarse), the fit should be near it
   let best=1e9;for(let g=-10;g<=10;g+=1)for(let d=-18;d<=18;d+=1.5){const o=open(X,[...live(T.gk,g),...live(T.df,d)],bx,bz,gx);if(o<best)best=o;}
   const fit=open(X,[...live(T.gk,s.og),...live(T.df,s.od)],bx,bz,gx);worst=Math.max(worst,fit-best);}
  ok('the fit is within 2.5u of the best open width a brute-force search can find (the real ball is the shot point)',worst<2.5,'worst excess '+worst.toFixed(1));}
 {const T=table(X);const a=pairSolve(X,T,28,8);T.gk1.cvM=0;T.df1.cvM=0;call(X,T.df1,-28,8);call(X,T.gk1,-28,8);
  ok('blue mirrors red (same offsets for the mirrored ball)',Math.abs(a.og-T.gk1.cvO)<1e-9&&Math.abs(a.od-T.df1.cvO)<1e-9,'red '+a.og+','+a.od+' blue '+T.gk1.cvO+','+T.df1.cvO);}
 {let over=null;for(const [bx,bz] of balls){const T=table(X);const s=pairSolve(X,T,bx,bz);
   if(Math.abs(s.og)>T.gk.maxOff+1e-9||Math.abs(s.od)>T.df.maxOff+1e-9)over=[bx,bz,s.og,s.od];}
  ok('neither rod is asked past its slide limit',over===null,'at '+over);}
 {const T=table(X);T.df.removedUntil[1]=1e9;const s=pairSolve(X,T,12,0);
  ok('with one defender removed the fit uses the one that is left and names him',T.df.aiMan===0&&Math.abs(s.zD-(T.df.baseZ[0]+s.od))<1e-9,'man '+T.df.aiMan);}
 {const T=table(X);const s=pairSolve(X,T,12,-6);
  ok('the DEF is given the man nearest the middle of the mouth, and lands on the fitted offset',Math.abs(s.zD-(T.df.baseZ[T.df.aiMan]+s.od))<1e-9&&(T.df.aiMan===0||T.df.aiMan===1),'man '+T.df.aiMan);}

 // ---- the rod that plays the ball does not cover ---------------------------------------------------------
 {let allNaN=true,allOn=true,near=null;
  for(const z of [-8,0,4,9]){const T=table(X);T.gk.offset=T.gk.target=z;T.df.offset=T.df.target=clamp(z+12,-18,18);T.df.cvM=0;T.gk.cvM=0;
   const zG=call(X,T.gk,-50,z),zD=call(X,T.df,-50,z);
   if(!(zG!==zG))allNaN=false;if(!(zD!==zD)||T.df.cvM!==0){allOn=false;near=[z,zD];}}
  ok('KEEPER HAS THE BALL: the keeper plays it (no cover z)',allNaN);
  ok('…and so does the defender: it keeps to the ball, it does not slide in to cover the keeper\'s man',allOn,'at '+near);}
 {let bad=null;
  for(const [bx,bz] of [[-57,24],[-50,-21],[-47,20],[-44,-18]]){const T=table(X);T.gk.offset=T.gk.target=Math.sign(bz)*10;T.df.offset=T.df.target=clamp(bz-Math.sign(bz)*12,-18,18);T.gk.cvM=0;T.df.cvM=0;
   const zD=call(X,T.df,bx,bz),zG=call(X,T.gk,bx,bz);
   if(!(zD!==zD)||zG!==zG||Math.abs(zG)>6||T.gk.cvW!==true)bad=[bx,bz,zD,zG];}
  ok('A BALL WIDE OF THE KEEPER: the defender stays on it (no cover z) and the keeper holds the middle of the goal, not the post',bad===null,'at '+bad);}
 {const T=table(X);T.gk.offset=T.gk.target=10;T.df.offset=T.df.target=12;call(X,T.df,-57,24);call(X,T.gk,-57,24);const w=T.gk.cvW;
  const T2=table(X);call(X,T2.df,-57,3);call(X,T2.gk,-57,3);
  ok('…the keeper flags it (so aiUpdate does not half-chase it); a ball in the mouth is not flagged, and neither is the defender',w===true&&T2.gk.cvW===false&&T.df.cvW===false,'wide '+w+' mouth '+T2.gk.cvW+' df '+T.df.cvW);}
 {const T=table(X);T.gk.offset=T.gk.target=10;T.df.offset=T.df.target=12;const z=call(X,T.gk,-46,24,DT,25,0),iz=24*(1-clamp((-52.5+46)/(-60+46),0,1));
  ok('…just past the keeper it is still off the ball\'s line to goal (the line runs out to the post)',z===z&&Math.abs(z)<6&&Math.abs(z-iz)>3,'z='+z+' line '+iz);}
 {const mk=(vx)=>{const T=table(X);T.gk.offset=T.gk.target=0;T.df.offset=T.df.target=4;return call(X,T.gk,-35,24,DT,vx,0);},iz=24*(1-clamp((-52.5+35)/(-60+35),0,1));
  const fast=mk(-80),slow=mk(0);
  ok('…but a wide ball flying at the goal puts the keeper back on its line',fast===fast&&Math.abs(fast-iz)<1.2,'z='+fast+' line '+iz);
  ok('…which the same ball at rest does not (the defender\'s shadow moves the fit off the line)',slow===slow&&Math.abs(slow-iz)>1.5,'z='+slow+' line '+iz);}
 {const T=table(X);T.gk.offset=T.gk.target=0;T.df.offset=T.df.target=0;T.df.cvM=0;
  const behind=call(X,T.df,-45,6),near=call(X,T.df,-35,6),out=call(X,T.df,-28,6);
  ok('the defender covers only once the ball is out in front of its play zone',behind!==behind&&near!==near&&out===out&&T.df.cvM!==0,'behind '+behind+' near '+near+' out '+out);}
 {let allNaN=true,allClear=true,near=null;
  for(const z of [-12,-5,0,6,14]){const T=table(X);T.df.offset=T.df.target=(z<=0?z+12:z-12);T.gk.offset=T.gk.target=z*0.3;T.df.cvM=0;T.gk.cvM=0;
   const zD=call(X,T.df,-40,z),zG=call(X,T.gk,-40,z);
   if(!(zD!==zD))allNaN=false;if(zG!==zG||Math.abs(zG-z)<3){allClear=false;near=[z,zG];}}
  ok('DEFENDER HAS THE BALL: the defender plays it (no cover z)',allNaN);
  ok('…and the keeper covers what it leaves: at least 3u off the defender, never on its z',allClear,'at '+near);}
 {const T=table(X);T.df.offset=T.df.target=0;call(X,T.gk,-40,5);ok('with the defender playing it the keeper does not fit the pair (its mate keeps its own slot)',T.df.cvO===undefined&&T.gk.cvM===1,'dfO='+T.df.cvO+' mode '+T.gk.cvM);}
 {const T=table(X);const z=call(X,T.gk,-56,3);ok('a ball behind the keeper itself: the keeper plays it',z!==z);}

 // ---- a mate that is not on the plan is held ---------------------------------------------------------------
 {const T=table(X);T.gk.human=true;T.gk.offset=6;T.gk.target=6;T.df.cvM=0;const zD=call(X,T.df,12,0);
  ok('a human keeper is held where it stands: the AI defender fits around it (mode 1) and never writes its slot',T.gk.cvO===undefined&&T.df.cvM===1,'gkO='+T.gk.cvO+' mode '+T.df.cvM);
  const men=[...live(T.gk,6),...live(T.df,T.df.cvO)];const withHold=open(X,men,12,0,gx);
  const stacked=open(X,[...live(T.gk,6),...live(T.df,6-T.df.baseZ[0])],12,0,gx);
  ok('…and that leaves less open than the defender stacked on it',withHold<stacked-2,'fit '+withHold.toFixed(1)+' stacked '+stacked.toFixed(1));}
 {const T=table(X);T.df.human=true;T.df.offset=-4;T.df.target=-4;call(X,T.gk,12,0);
  ok('a human defender is held the same way for the AI keeper',T.df.cvO===undefined&&T.gk.cvM===1);}
 {const T=table(X);T.gk.act='trap';T.gk.target=3;call(X,T.df,12,0);
  ok('a mate in an action (trap, retrieve, dribble…) is held at its target, not re-planned',T.gk.cvO===undefined&&T.df.cvM===1);}
 {const T=table(X);T.gk.trnHidden=true;const z=call(X,T.df,12,0);ok('a hidden rod (training) is no mate at all: the other rod gets no cover z and keeps the old line',z!==z&&T.df.cvM===0);}
 {const T=table(X);T.gk.benched=true;call(X,T.df,12,0);ok('a benched mate is held too',T.gk.cvO===undefined&&T.df.cvM===1);}
 {const T=table(X);T.gk.force=true;call(X,T.df,12,0);ok('a mate in the dead-ball push is held too',T.gk.cvO===undefined&&T.df.cvM===1);}
 {const T=table(X);call(X,T.df,12,0);ok('two free AI rods are fitted together: one call fills both slots (mode 2)',T.gk.cvO!==undefined&&T.df.cvO!==undefined&&T.gk.cvM===2&&T.df.cvM===2);}

 // ---- reach: how far off the old line a rod can afford to stand --------------------------------------------
 {const T=table(X),E=X.AIC.defend.engage,sp=X.DIFFS.pro.speed*CV.speedMul;
  const near=X.coverReach(Object.assign({},T.df,{aiBVX:0,aiBVZ:0}),E+3),farRest=X.coverReach(Object.assign({},T.df,{aiBVX:0,aiBVZ:0}),60),fast=X.coverReach(Object.assign({},T.df,{aiBVX:-90,aiBVZ:0}),E+4),inside=X.coverReach(T.df,E-1);
  ok('a ball at rest far out leaves the rod all the room there is',farRest===CV.reachMax,'R='+farRest);
  ok('a fast ball close in leaves it none',fast===0,'R='+fast);
  ok('even a ball at rest, a few units out, leaves only a short slide (it gets there in a second)',near>0&&near<10&&Math.abs(near-sp*Math.max(0,3/CV.vFloor-CV.slack))<1e-9,'R='+near);
  ok('a rod whose ball is already in its play zone is not budgeted (it is not the one covering)',inside===CV.reachMax);}
 {const T=table(X);const bx=-37.5+12,bz=14;const iz=bz*(1-clamp((T.df.x-bx)/(-60-bx),0,1));
  const zFast=call(X,T.df,bx,bz,DT,-90,0);ok('a fast ball close in puts the DEF back on the old ball-to-goal line',Math.abs(zFast-iz)<1e-9,'z='+zFast+' line '+iz);
  const T2=table(X);const zRest=call(X,T2.df,bx+30,bz,DT,0,0);const iz2=bz*(1-clamp((T2.df.x-(bx+30))/(-60-(bx+30)),0,1));
  ok('...while a ball at rest further out leaves it in its slot, off the line',Math.abs(zRest-iz2)>1,'z='+zRest+' line '+iz2);}
 {const T=table(X);const bx=12,bz=14;CV.mix=1;const z1=call(X,T.df,bx,bz);const iz=bz*(1-clamp((T.df.x-bx)/(-60-bx),0,1));
  const T2=table(X);CV.mix=0;const z0=call(X,T2.df,bx,bz);const T3=table(X);CV.mix=0.5;const zh=call(X,T3.df,bx,bz);CV.mix=1;
  ok('mix 0 is the old line and mix 0.5 stands half the way off it',Math.abs(z0-iz)<1e-9&&Math.abs(zh-(iz+0.5*(z1-iz)))<1e-9,'z0 '+z0+' zh '+zh+' z1 '+z1+' line '+iz);}
 // ---- a ball flying at the goal is a real shot, whoever is playing it ------------------------------------------
 {const bx=-40,bz=6,dfOff=12;
  const mk=(vx)=>{const T=table(X);T.df.offset=T.df.target=dfOff;T.gk.cvM=0;call(X,T.gk,bx,bz,DT,vx,0);return T;};
  const slow=mk(0),fast=mk(-80);
  const real=X.coverFit(bx,bz,gx,[fast.gk],fast.df,dfOff)[0],nominal=X.coverFit(-37.5+CV.nomAhead,bz*CV.nomZ,gx,[slow.gk],slow.df,dfOff)[0];
  ok('with the DEF playing a slow ball the keeper fits an assumed shot from further up the pitch',Math.abs(slow.gk.cvO-nominal)<1e-9,'got '+slow.gk.cvO+' want '+nominal);
  ok('...but a ball flying at the goal past the DEF is fitted as the real shot',Math.abs(fast.gk.cvO-real)<1e-9,'got '+fast.gk.cvO+' want '+real);
  ok('...and the two are not the same answer (the fade matters)',Math.abs(real-nominal)>0.3,'real '+real+' nominal '+nominal);}
 // ---- a shot going in: the keeper goes for it -----------------------------------------------------------------
 {const fol=CV.gkFollow,P=X.DIFFS.pro,pred0=P.pred,gkx=-52.5;
  const shotAt=(bx,bz,zk,v,f,role)=>{const sl=(zk-bz)/(gkx-bx),vx=-v/Math.hypot(1,sl),vz=vx*sl;CV.gkFollow=f;const T=table(X);T.gk.offset=T.gk.target=0;T.df.offset=T.df.target=12;T.gk.cvM=0;T.df.cvM=0;
   const z=role==='DEF'?call(X,T.df,bx,bz,DT,vx,vz):call(X,T.gk,bx,bz,DT,vx,vz);CV.gkFollow=fol;return {z,sl,vx};};
  const a0=shotAt(-30,-14,2,80,0),a1=shotAt(-30,-14,2,80,fol),zc=-14+a1.sl*pred0*(gkx+30);
  ok('A SHOT GOING IN: the keeper moves gkFollow of the way from the cover answer to where it reads the ball will cross its rod',Math.abs(a1.z-(a0.z+(zc-a0.z)*fol))<1e-9,'z '+a1.z+' cover '+a0.z+' read '+zc);
  P.pred=1;const p1=shotAt(-30,-14,2,80,fol);P.pred=pred0;
  ok('…which, read with full anticipation, takes it toward the ball\'s real crossing',fol>0&&Math.abs(p1.z-2)<Math.abs(a0.z-2)-1,'z '+p1.z+' cover '+a0.z);
  P.pred=0.4;const lo=shotAt(-30,-14,2,80,fol);P.pred=pred0;const zlo=-14+lo.sl*0.4*(gkx+30);
  ok('…read with the difficulty\'s anticipation: a keeper that leads less stays nearer the ball\'s own z',Math.abs(lo.z-(a0.z+(zlo-a0.z)*fol))<1e-9,'z '+lo.z+' want '+(a0.z+(zlo-a0.z)*fol));
  const h0=shotAt(-30,-14,2,25,0),h1=shotAt(-30,-14,2,25,fol),sh=(-h1.vx-CV.shotV[0])/(CV.shotV[1]-CV.shotV[0]);
  ok('…and only as far as the ball is a shot (closing between the shotV speeds goes part of the way)',Math.abs(h1.z-(h0.z+(zc-h0.z)*fol*sh))<1e-9,'z '+h1.z+' want '+(h0.z+(zc-h0.z)*fol*sh));
  const w0=shotAt(-30,0,15,80,0),w1=shotAt(-30,0,15,80,fol);
  ok('a shot the keeper reads going past the post is not followed',w1.z===w0.z,'z '+w1.z+' cover '+w0.z);
  const d0=shotAt(-25,-14,2,80,0,'DEF'),d1=shotAt(-25,-14,2,80,fol,'DEF');
  ok('the DEF does not follow (it keeps its cover answer)',d1.z===d0.z,'z '+d1.z+' cover '+d0.z);}
 // ---- the keeper while the DEF plays: a short window on the old line -------------------------------------------
 {const T=table(X);T.gk.offset=T.gk.target=0;T.df.offset=T.df.target=12;const bx=-40,bz=0;const z=call(X,T.gk,bx,bz);
  ok('with the DEF playing the ball the keeper steps off it by no more than playReach from the old line',Math.abs(z)<=CV.playReach+1e-9,'z='+z);
  const T2=table(X);T2.gk.offset=T2.gk.target=0;T2.df.offset=T2.df.target=12;const keep=CV.playReach;CV.playReach=40;const zf=call(X,T2.gk,bx,bz);CV.playReach=keep;
  ok('...while the fit alone would have sent it further (the window is doing the work)',Math.abs(zf)>CV.playReach+0.5,'free z='+zf);}
 // ---- cadence --------------------------------------------------------------------------------------------------
 {const T=table(X);pairSolve(X,T,12,-8);const od1=T.df.cvO;call(X,T.df,12,15,DT);ok('inside the cadence the answer is reused, not re-solved',T.df.cvO===od1);
  call(X,T.df,12,15,CV.every);ok('…and once the cadence runs out it is re-solved for the new ball',T.df.cvO!==od1);}
 {const T=table(X);call(X,T.df,12,0);const was=T.df.cvO;T.gk.act='retrieve';T.gk.target=-6;call(X,T.df,12,15,DT);
  ok('a change of mode (mate goes busy) re-solves at once, inside the cadence',T.df.cvM===1&&T.df.cvO!==was);}

 // ---- search ---------------------------------------------------------------------------------------------
 {let worst=0,at=null;
  const cost=(T,ox,oz,og,od)=>{let k=X.coverMen(T.df,od,ox,oz,gx,0);k=X.coverMen(T.gk,og,ox,oz,gx,k);return X.coverGap(k,X.F.goalHalf*CV.mouth)+CV.travel*(Math.abs(og-T.gk.target)+Math.abs(od-T.df.target));};
  let s0=7;const rnd=()=>{s0=(s0*1664525+1013904223)>>>0;return s0/4294967296;};
  for(let n=0;n<240;n++){const T=table(X);let ox=-40+rnd()*60,oz=(rnd()*2-1)*28;
   if(n%2){const o0=X.coverFit(ox,oz,gx,[T.gk,T.df]);T.gk.target=o0[0];T.df.target=o0[1];ox+=rnd()*3-1.5;oz+=rnd()*3-1.5;}   // half the trials start from a fitted pair and a ball that has moved a little: the state that matters
   else{T.gk.target=(rnd()*2-1)*10;T.df.target=(rnd()*2-1)*18;}
   const o=X.coverFit(ox,oz,gx,[T.gk,T.df]);const d=cost(T,ox,oz,o[0],o[1])-cost(T,ox,oz,T.gk.target,T.df.target);if(d>worst){worst=d;at=[ox.toFixed(0),oz.toFixed(0)];}}
  ok('the fit is never worse than leaving both rods where they are (the coarse grid alone would flip a pair that is already well placed)',worst<1e-9,'worst '+worst.toFixed(3)+' at '+at);}
 {let over=null;
  for(const [bx,bz] of balls){const T=table(X);T.gk.maxOff=2;T.df.maxOff=3;const s=pairSolve(X,T,bx,bz);if(Math.abs(s.og)>2+1e-9||Math.abs(s.od)>3+1e-9)over=[bx,bz,s.og,s.od];}
  ok('a short slide limit is respected by the whole search (grid and polish)',over===null,'at '+over);}

 // ---- steady ---------------------------------------------------------------------------------------------
 {const run=(zs,bx)=>{const T=table(X);T.gk.cvM=0;T.df.cvM=0;let prev=null,jump=0;
   for(const bz of zs){T.gk.aiBX=T.df.aiBX=bx;
    for(let s=0;s<10;s++){const zD=call(X,T.df,bx,bz),zG=call(X,T.gk,bx,bz);
     const tg=clamp(zG,-T.gk.maxOff,T.gk.maxOff),td=clamp(zD-T.df.baseZ[T.df.aiMan],-T.df.maxOff,T.df.maxOff);
     for(const [r,t] of [[T.gk,tg],[T.df,td]]){r.target=t;r.offset+=clamp(t-r.offset,-40*DT,40*DT);}}
    const cur=[T.gk.target,T.df.target];if(prev)jump=Math.max(jump,Math.abs(cur[0]-prev[0]),Math.abs(cur[1]-prev[1]));prev=cur;}
   return jump;};
  const up=[],dn=[];for(let z=-24;z<=24;z+=0.5){up.push(z);dn.unshift(z);}
  const j=Math.max(run(up,-5),run(dn,-5),run(up,25),run(dn,25));
  ok('a ball sweeping across the table moves the pair smoothly: no target jumps more than 4u in a half-unit of ball travel',j<4,'max jump '+j.toFixed(1));}
 {const T=table(X);
  const a=(()=>{T.gk.target=4.3;T.df.target=-15;T.gk.cvM=0;T.df.cvM=0;call(X,T.df,12,0);return T.gk.cvO;})();
  const b=(()=>{T.gk.target=-4.3;T.df.target=15;T.gk.cvM=0;T.df.cvM=0;call(X,T.df,12,0);return T.gk.cvO;})();
  ok('with the ball dead centre the pair keeps the side it is on (hysteresis), whichever it is',a>0&&b<0,'a='+a+' b='+b);}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {n:'the tMin shading is gone (a close man hides the whole mouth)',part:'cover',from:'const t=Math.max(t0,AIC.cover.tMin),h=',to:'const t=t0,h='},
 {n:'gaps are summed, not squared (uneven gaps score as well as even ones)',part:'cover',from:'const g=Math.min(l,m)-x;s+=g*g;',to:'const g=Math.min(l,m)-x;s+=g;'},
 {n:'the open tail is summed, not squared',part:'cover',from:'return (x<m?s+(m-x)*(m-x):s)+',to:'return (x<m?s+(m-x):s)+'},
 {n:'overlap costs nothing (shadows stack on a tie)',part:'cover',from:'+AIC.cover.overlap*ov;',to:'+0*ov;'},
 {n:'sliding is free (a tie does not keep its side)',part:'cover',from:'c+=CV.travel*Math.abs(o[j]-mine[j].target);',to:'c+=0;'},
 {n:'no polish from the current slots (the coarse grid flips the pair)',part:'cover',from:' polish(clamp(mine[0].target,-m0,m0),n>1?clamp(mine[1].target,-m1,m1):0);',to:''},
 {n:'the pair is fitted even when the mate is a human',part:'cover',from:'dEng&&gEng&&!isUserRod(mate)&&',to:'dEng&&gEng&&'},
 {n:'the pair is fitted even when the mate is in an action',part:'cover',from:'&&!mate.act&&!mate.force&&',to:'&&'},
 {n:'a benched mate is planned for like a free one',part:'cover',from:'&&isActiveRod(mate),mode=',to:',mode='},
 {n:'a mate in the dead-ball push is planned for',part:'cover',from:'&&!mate.force&&',to:'&&'},
 {n:'the man is not named (man selection would pick the first reachable one and move the rod 24u)',part:'cover',from:'r.aiMan=mi;',to:''},
 {n:'a hidden training rod is planned around as if it stood there',part:'cover',from:'if(!mate||mate.trnHidden){',to:'if(!mate){'},
 {n:'the keeper covers while it plays the ball',part:'cover',from:'if(gk?!gEng&&!wide:!dEng)',to:'if(gk?false:!dEng)'},
 {n:'the defender covers while it plays the ball (slides in off the ball)',part:'cover',from:'if(gk?!gEng&&!wide:!dEng)',to:'if(gk?!gEng&&!wide:false)'},
 {n:'the defender covers once the ball is only level with it',part:'cover',from:'if(gk?!gEng&&!wide:!dEng)',to:'if(gk?!gEng&&!wide:relD<-E)'},
 {n:'the keeper chases a ball it cannot reach (no wide case)',part:'cover',from:'if(gk?!gEng&&!wide:!dEng)',to:'if(gk?!gEng:!dEng)'},
 {n:'the wide flag is never raised for aiUpdate',part:'cover',from:'const wide=r.cvW=gk&&',to:'const wide=gk&&'},
 {n:'a wide ball is judged against the keeper\'s whole slide plus nothing (the threshold is gone)',part:'cover',from:'>CV.gkWide;',to:'>-1e9;'},
 {n:'a wide ball keeps the keeper on the budget (stays on its line past the keeper)',part:'cover',from:'(wide?lerp(CV.reachMax,Rb,shot):Math.min(Rb,CV.playReach))',to:'(wide?Rb:Math.min(Rb,CV.playReach))'},
 {n:'a wide ball flying at the goal gets the full reach',part:'cover',from:'(wide?lerp(CV.reachMax,Rb,shot):Math.min(Rb,CV.playReach))',to:'(wide?CV.reachMax:Math.min(Rb,CV.playReach))'},
 {n:'the pair is fitted while the DEF is still playing the ball (no mate hold)',part:'cover',from:'const pair=dEng&&gEng&&',to:'const pair=gEng&&'},
 {n:'the reach budget is gone (a rod stays in its slot however fast the ball)',part:'cover',from:'const cz=iz+clamp((z-iz)*CV.mix,-R,R);',to:'const cz=iz+clamp((z-iz)*CV.mix,-1e9,1e9);'},
 {n:'the mix is ignored (always the full split)',part:'cover',from:'const cz=iz+clamp((z-iz)*CV.mix,-R,R);',to:'const cz=iz+clamp((z-iz),-R,R);'},
 {n:'the keeper never follows a shot (the cover answer only)',part:'cover',from:'if(!gk||!(shot>0)||!CV.gkFollow)return cz;',to:'return cz;'},
 {n:'the DEF follows the shot too',part:'cover',from:'if(!gk||!(shot>0)',to:'if(!(shot>0)'},
 {n:'the read ignores the anticipation stat (every keeper leads perfectly)',part:'cover',from:'*DIFFS[teamDiff(r.team)].pred*stPred(r)',to:''},
 {n:'a shot past the post is followed',part:'cover',from:'clamp((F.goalHalf+BALL_R+CV.gkPost-Math.abs(zg))/CV.gkPost,0,1)',to:'1'},
 {n:'half a shot is followed as far as a whole one',part:'cover',from:'shot*CV.gkFollow*',to:'CV.gkFollow*'},
 {n:'the crossing is read at the goal line, not at the keeper\'s rod',part:'cover',from:'zc=r.aiBZ+k*(r.x-bx)',to:'zc=r.aiBZ+k*(gx-bx)'},
 {n:'the budget counts only the speed toward the goal (a ball at rest gives all the time there is)',part:'cover',from:'Math.max(Math.hypot(r.aiBVX,r.aiBVZ),CV.vFloor)',to:'Math.max(-r.aiBVX*(r.team===0?1:-1),1e-6)'},
 {n:'the budget has no speed floor (a ball at rest is never close)',part:'cover',from:'Math.max(Math.hypot(r.aiBVX,r.aiBVZ),CV.vFloor)',to:'Math.max(Math.hypot(r.aiBVX,r.aiBVZ),1e-6)'},
 {n:'the budget ignores the slack (a rod counts on moving the instant the ball is struck)',part:'cover',from:'Math.max(0,T-CV.slack)',to:'Math.max(0,T)'},
 {n:'a rod in its own play zone is budgeted like a covering one',part:'cover',from:'if(relFront<=E)return CV.reachMax;',to:''},
 {n:'a ball flying at the goal stays an assumed shot behind the DEF (no speed fade)',part:'cover',from:'clamp((close-CV.shotV[0])/(CV.shotV[1]-CV.shotV[0]),0,1)',to:'0'},
 {n:'the keeper has no window while the DEF plays',part:'cover',from:'(wide?lerp(CV.reachMax,Rb,shot):Math.min(Rb,CV.playReach))',to:'(wide?lerp(CV.reachMax,Rb,shot):Rb)'},
 {n:'the shot point is always the assumed one (the real ball is ignored)',part:'cover',from:'ox=lerp(d.x+dir*CV.nomAhead,bx,s)',to:'ox=d.x+dir*CV.nomAhead'},
 {n:'the shot point is always the real ball (a ball behind the DEF has nothing to shade)',part:'cover',from:'s=Math.max(clamp((relD-E)/CV.blend,0,1),shot)',to:'s=1'},
 {n:'the cadence is ignored (a solve every step)',part:'cover',from:'if(r.cvM!==mode||(r.cvT-=dt)<=0){',to:'if(true){'},
 {n:'a mode change waits out the cadence',part:'cover',from:'if(r.cvM!==mode||(r.cvT-=dt)<=0){',to:'if(r.cvM===undefined||(r.cvT-=dt)<=0){'},
 {n:'the polish steps ignore the slide limit',part:'cover',from:'o[j]=clamp(p[j]+sg*s,-mine[j].maxOff,mine[j].maxOff);',to:'o[j]=p[j]+sg*s;'},
 {n:'the slide limit is ignored in the search',part:'cover',from:'const m0=mine[0].maxOff,m1=n>1?mine[1].maxOff:0,',to:'const m0=mine[0].maxOff*2,m1=n>1?mine[1].maxOff*2:0,'},
 {n:'the blue DEF reads the wrong end of the table (goal x not mirrored)',part:'cover',from:'gx=dir>0?-F.L/2:F.L/2;',to:'gx=-F.L/2;'},
 {n:'a removed man still casts a shadow',part:'cover',from:'for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const c=oz+',to:'for(let i=0;i<r.baseZ.length;i++){const c=oz+'}
];
let missed=0;
for(const m of MUT){
 let failed=0;
 try{for(const t of suite(boot(m)))if(!t.ok)failed++;}catch(e){failed=1;}
 if(!failed){missed++;console.log('  MUTATION SURVIVED: '+m.n);}
}
console.log('  '+(MUT.length-missed)+'/'+MUT.length+' mutations caught');
process.exit(bad||missed?1:0);
