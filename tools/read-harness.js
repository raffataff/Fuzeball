// strike reaction + holder read harness. node tools/read-harness.js
// CONFIG.ai.jolt: an opponent's strike is seen a reaction late; CONFIG.ai.rodView: so are the opponent's rods; CONFIG.ai.read: the keeper and DEF stand against the shots a held ball can become, bait, jostle, learn
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={
 view:slice(AI,'const REACT_LEN=','function teamRods('),
 man:slice(AI,'function manLive(','function inFootRange('),
 read:slice(AI,'const RD=[{},{}]','// z this keeper/DEF man takes'),
 lanes:slice(AI,'function laneObs(','function lineClr(')
};
const stubs=["var S={time:0,balls:[],phase:'play'}; var rods=[]; var DIFF=['pro','pro']; function teamDiff(t){return DIFF[t];}",
 "function stReact(){return 1;} function isUserRod(){return false;} function isActiveRod(){return true;} function rodSpeedMult(){return 1;} function rodTopV(r){return DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r);} function rodAcc(r){return AIC.slideAccel*(DIFFS[teamDiff(r.team)].acc||1)*stAgil(r);}",
 "var THREE={Vector3:function(){this.x=0;this.y=0;this.z=0;}};",
 "THREE.Vector3.prototype.set=function(x,y,z){this.x=x;this.y=y;this.z=z;return this;};",
 "THREE.Vector3.prototype.copy=function(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;};"].join(NL);
function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Object,Array,Float64Array,Map,localStorage:{getItem:()=>null,setItem:()=>{}}};ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),rd('js/rng.js'),stubs,g.view,g.man,g.read,g.lanes,
  ';globalThis.X={S,AIC,DIFFS,F,BALL_R,rods,RD,RDS,ballRecord,primeBallHist,aiView,joltRT,readReset,readHolder,readLearn,readFit,readTick,readOff,rngSeed,rodRecord,rodSeen,laneObs,setDiff:function(a,b){DIFF[0]=a;DIFF[1]=b||a;}};'].join(NL),ctx);
 return ctx.X;
}
const dt=1/120;
function rod(X,idx,x,team,role,men,sp,cap){
 const baseZ=[];for(let i=0;i<men;i++)baseZ.push((i-(men-1)/2)*sp);
 let maxOff=(X.F.W-8-(men-1)*sp)/2;if(cap!=null)maxOff=Math.min(maxOff,cap);
 return {idx,x,team,role,baseZ,maxOff,offset:0,target:0,kickT:-1,angVel:0,act:null,force:false,removedUntil:[]};
}
// red keeper + DEF against blue's ATT (blue attacks -x)
function world(X,o){
 o=o||{};X.S.time=0;X.S.balls.length=0;X.setDiff(o.diff||'pro',o.diffB);X.rngSeed(o.seed||7);X.readReset();
 X.rods.length=0;
 const g=rod(X,0,-52.5,0,'GK',1,0,11),d=rod(X,1,-37.5,0,'DEF',2,24),a=rod(X,2,-22.5,1,'ATT',3,18.5);
 X.rods.push(g,d,a);return {g,d,a};
}
function ball(X,x,z,vx,vz){
 const b={m:{position:{x,y:X.BALL_R,z}},v:{x:vx||0,y:0,z:vz||0},scored:false};X.S.balls.push(b);X.primeBallHist(b);return b;
}
function step(X,n){for(let i=0;i<(n||1);i++){for(const b of X.S.balls){X.ballRecord(b);}X.readTick(dt);
 for(const b of X.S.balls){const p=b.m.position;p.x+=b.v.x*dt;p.z+=b.v.z*dt;}X.S.time+=dt;}}
// blue's ATT strikes the ball: a contact stamp and a new velocity, as collideRod leaves it
function strike(X,b,team,vx,vz){b.tchT=X.S.time;b.tchTm=team;b.v.x=vx;b.v.z=vz;}
// hold a ball under blue's ATT until the read is live
function hold(X,w,z){const b=ball(X,-22.5-1,z==null?0:z);for(let i=0;i<40&&!X.RD[0].live;i++)step(X);step(X,6);return b;}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const J=X.AIC.jolt,RC=X.AIC.read,D=X.DIFFS;
 ok('reaction times are human and each difficulty is faster',J.on&&D.rookie.rt>D.pro.rt&&D.pro.rt>D.legend.rt&&D.legend.rt>=0.14&&D.rookie.rt<=0.3,[D.rookie.rt,D.pro.rt,D.legend.rt].join());
 ok('the read ships on with every knob',RC.on&&RC.moves.length===RC.moveP.length&&RC.tzP.length===RC.targets&&RC.bait.p&&RC.mem.use.legend>RC.mem.use.rookie);
 const JO=RC.jostle;
 ok('the jostle ships on, wider and quicker with difficulty',JO.on===true&&JO.amp.rookie<JO.amp.pro&&JO.amp.pro<=JO.amp.legend&&JO.every.legend[1]<JO.every.rookie[1]&&JO.roles.indexOf('ATT')>=0);
 const jon=JO.on;JO.on=false;   // off for the fit and plan tests; its own tests below switch it on
 const bp=RC.bait.p;RC.bait.p={rookie:0,pro:0.3,legend:0.45};   // the rest tests it switched on
 // --- strike reaction ---
 {const w=world(X);const b=ball(X,-23.5,2);step(X,3);strike(X,b,1,-110,8);step(X,1);
  const v=X.aiView(w.g,b,0);
  ok('an opponent\'s strike is not seen at once',Math.abs(v.v.x)<1&&Math.abs(v.m.position.x-(-23.5))<0.5,'vx '+v.v.x.toFixed(1)+' x '+v.m.position.x.toFixed(2));
  const own=X.aiView(w.a,b,0);ok('…the striker\'s own team sees it',own.v.x<-100);
  const rt=X.joltRT(w.g);let t=0;while(t<0.5&&Math.abs(X.aiView(w.g,b,0).v.x)<1){step(X);t+=dt;}
  ok('…and it is seen after the difficulty\'s rt',Math.abs(t+dt-rt)<2.5*dt,'seen '+(t+dt).toFixed(3)+' rt '+rt);}
 {const w=world(X);const b=ball(X,-23.5,2,0,20);step(X,3);strike(X,b,1,-110,8);step(X,1);step(X,12);
  const v=X.aiView(w.g,b,0);ok('…meanwhile the ball is seen carrying on as it was',Math.abs(v.m.position.z-(2+20*13*dt+20*3*dt))<1,'z '+v.m.position.z.toFixed(2));}
 {const r=[];for(const d of ['rookie','legend']){const w=world(X,{diff:d});const b=ball(X,-23.5,0);step(X,2);strike(X,b,1,-110,0);step(X,1);let t=0;while(t<0.5&&Math.abs(X.aiView(w.g,b,0).v.x)<1){step(X);t+=dt;}r.push(t);}
  ok('legend sees a strike sooner than rookie',r[1]<r[0]-0.05,r.join());}
 {const w=world(X);const b=ball(X,-23.5,0,-10,0);step(X,2);strike(X,b,1,-10-J.v*0.8,0);step(X,1);
  ok('a soft touch is no strike',Math.abs(X.aiView(w.g,b,0).v.x)>20);}
 {const w=world(X);const b=ball(X,-23.5,0,-110,0);step(X,2);b.v.x=110;step(X,1);
  ok('a wall bounce is no strike (no contact)',X.aiView(w.g,b,0).v.x>100);}
 {const w=world(X);const b=ball(X,-23.5,0);step(X,2);strike(X,b,1,-110,0);step(X,1);X.primeBallHist(b);
  ok('a hard set ends it',Math.abs(X.aiView(w.g,b,0).v.x)>100);}
 // --- the other team's rods, a reaction late ---
 {const V=X.AIC.rodView,von=V.on;ok('the rod view ships off, lagging the difficulty rt when on',V&&V.on===false&&V.k===1);V.on=true;
  // blue's DEF slides +60 for 0.3 s toward +20, then turns back toward -20
  const run=(diff,rev)=>{world(X,{diff});const q=rod(X,3,37.5,1,'DEF',2,24);X.rods.push(q);const tr=[];
   const go=(v,tg,n)=>{for(let i=0;i<n;i++){q.vz=v;q.offset+=v*dt;q.target=tg;X.rodRecord();X.S.time+=dt;tr.push(q.offset);}};
   go(60,20,36);if(rev)go(-60,-20,rev);return {q,tr};};
  {const {q}=run('pro',0);const s=X.rodSeen(q,0).offset;
   ok('…the other team sees its steady slide carried on to where it is',Math.abs(s-q.offset)<1,'seen '+s.toFixed(2)+' live '+q.offset.toFixed(2));}
  {const {q}=run('pro',12),s=X.rodSeen(q,0).offset;
   ok('a rod is seen live by its own team',X.rodSeen(q,1).offset===q.offset);
   ok('a turn is not seen until a reaction later: the rod is seen still running the old way',s>q.offset+4,'seen '+s.toFixed(2)+' live '+q.offset.toFixed(2));
   const ob=X.laneObs(0,10,60);const mz=Math.min(...ob.map(o=>Math.abs(o.z-(q.baseZ[0]+s))));
   ok('…and the shooter reads its lanes off that view',ob.length===2&&mz<1e-6,'obs '+ob.map(o=>o.z.toFixed(2)).join());}
  {world(X);const q=rod(X,3,37.5,1,'DEF',2,24);X.rods.push(q);for(let i=0;i<30;i++){q.vz=i<20?60:0;q.offset=Math.min(q.offset+60*dt,2);q.target=2;X.rodRecord();X.S.time+=dt;}
   ok('…never carried past where it was heading',X.rodSeen(q,0).offset<=2+1e-9,X.rodSeen(q,0).offset.toFixed(2));}
  {const late=d=>{const {q}=run(d,24);return X.rodSeen(q,0).offset-q.offset;};
   const rk=late('rookie'),lg=late('legend');ok('legend sees a turn sooner than rookie',lg<rk-1,'still seen running the old way by rookie '+rk.toFixed(2)+', legend '+lg.toFixed(2));}
  {world(X);const q=rod(X,3,37.5,1,'DEF',2,24);X.rods.push(q);q.offset=5;q.rvW=0;ok('a reset rod is seen where it is',X.rodSeen(q,0).offset===5);}
  {const on=V.on;V.on=false;const {q}=run('pro',12);ok('switched off, the rods are seen live',X.rodSeen(q,0).offset===q.offset);
   V.on=[false,true];ok('[red, blue]: only the team switched on reads late',X.rodSeen(q,0).offset===q.offset);V.on=on;}V.on=von;}
 // --- the holder ---
 {const w=world(X);ok('a slow ball just ahead of their ATT is held by it',X.readHolder(1,-23.5,X.BALL_R,0,0)===w.a);
  ok('…not when it is running along the table',X.readHolder(1,-23.5,X.BALL_R,0,RC.hold.vx+5)===null);
  ok('…nor our own',X.readHolder(0,-23.5,X.BALL_R,0,0)===null);}
 {const w=world(X);const b=ball(X,-23.5,0);step(X,2);ok('not read before minT',!X.RD[0].live);
  step(X,Math.ceil(RC.hold.minT/dt)+2);ok('…read after it, keeper and DEF fitted',X.RD[0].live&&X.readOff(w.g)!==undefined&&X.readOff(w.d)!==undefined);}
 // --- the fit ---
 // where the keeper stands against a ball held at z with a memory of every shot going to one post
 const keeperAt=(o)=>{const w=world(X,{diff:o.diff||'legend'});const r=X.RD[0];
  if(o.def!=null)w.d.offset=w.d.target=o.def;r.hr=w.a;r.bx=-23.5;r.bz=o.z||0;r.ph=o.ph||'set';r.gj=-1;r.bait=!!o.bait;r.bk=o.bk==null?-1:o.bk;
  if(o.post){for(let i=0;i<12;i++){r.mem.tz[o.post>0?r.mem.tz.length-1:0]+=1;r.mem.mv[1]+=1;}}
  X.readFit(r,0,o.solo?[w.g]:[w.g,w.d]);return {g:r.off[w.g.idx],d:r.off[w.d.idx],w};};
 {const k0=keeperAt({}),kp=keeperAt({post:1}),km=keeperAt({post:-1});
  const dm=k0.w.d.baseZ.map(z=>z+k0.d).reduce((a,z)=>Math.abs(z)<Math.abs(a)?z:a);
  ok('a centred hold with nothing learned: the pair splits the goal (keeper one side, DEF the other)',Math.abs(k0.g)<8&&(k0.g*dm<0||Math.abs(dm)<1),'gk '+k0.g+' DEF man '+dm);
  ok('learned shots to the +z post pull the keeper that way',kp.g>k0.g+1&&km.g<k0.g-1,'0 '+k0.g+' + '+kp.g+' - '+km.g);
  const kr=keeperAt({post:1,diff:'rookie'});ok('…rookie leans on it less',kr.g<kp.g,'rookie '+kr.g+' legend '+kp.g);}
 {const kc=keeperAt({solo:true,z:0}),kz=keeperAt({solo:true,z:8});
  ok('a keeper alone follows the hold\'s z',kz.g>kc.g+1,kc.g+' '+kz.g);}
 {const at=(o)=>{const w=world(X,{diff:'legend'});w.d.offset=w.d.target=o;const r=X.RD[0];r.hr=w.a;r.bx=-23.5;r.bz=0;r.ph='set';X.readFit(r,0,[w.g]);return r.off[w.g.idx];};
  const lo=at(11),hi=at(-11);ok('a keeper alone takes the side its DEF (on the short line) leaves open',lo>hi+2,'DEF man -1: '+lo+' DEF man +1: '+hi);}
 // --- the short line: ball to the nearest point of the mouth, held by the keeper or the DEF ---
 const SH=X.AIC.cover.short,gh=X.F.goalHalf*X.AIC.cover.mouth;
 const lineD=(w,z,g,d)=>{const gz=Math.max(-gh,Math.min(gh,z)),L=x=>z+(gz-z)*(x+23.5)/(-60+23.5);
  return [Math.abs(L(w.g.x)-w.g.baseZ[0]-g),Math.min(...w.d.baseZ.map(b=>Math.abs(L(w.d.x)-b-d)))];};
 {const r=[0,6,-15,18].map(z=>{const k=keeperAt({z});return lineD(k.w,z,k.g,k.d);});
  ok('a held ball: the keeper or the DEF stands on its short line, centred or wide',r.every(q=>Math.min(...q)<=SH.tol+1e-6),r.map(q=>q.map(v=>v.toFixed(1)).join('/')).join(' '));
  ok('…and the other takes another lane',r.every(q=>Math.max(...q)>2),r.map(q=>q.map(v=>v.toFixed(1)).join('/')).join(' '));}
 {const at=(z,o)=>{const w=world(X,{diff:'legend'});w.d.act='catch';w.d.offset=w.d.target=o;const r=X.RD[0];r.hr=w.a;r.bx=-23.5;r.bz=z;r.ph='set';X.readFit(r,0,[w.g]);return lineD(w,z,r.off[w.g.idx],o);};
  const far=at(15,18),on=at(0,12);
  ok('a DEF busy off the line (a wide hold, its men at the wall): the keeper takes the near post line',far[0]<=SH.tol+1e-6,'keeper '+far[0].toFixed(2)+' DEF '+far[1].toFixed(2));
  ok('a DEF busy on the line: the keeper is free to take another lane',on[1]<0.01&&on[0]>SH.tol,'keeper '+on[0].toFixed(2));}
 {const hl=z=>{const w=world(X,{diff:'legend'});w.a.role='ATT';const b=hold(X,w,z);let bad=0,n=0,mx=0;
   for(let i=0;i<Math.round(4/dt);i++){step(X);const g=X.readOff(w.g),d=X.readOff(w.d);if(g===undefined||d===undefined)continue;w.g.target=g;w.d.target=d;
    const q=Math.min(...lineD(w,X.RD[0].bz,g,d));n++;if(q>SH.tol+1e-6)bad++;mx=Math.max(mx,q);}
   return {bad,n,mx};};
  const jo0=JO.on,bp0=RC.bait.p;JO.on=true;RC.bait.p={rookie:0,pro:0,legend:0};const c=hl(0),wd=hl(14);JO.on=jo0;RC.bait.p=bp0;
  ok('the jostle never leaves the short line open',c.n>200&&wd.n>200&&c.bad===0&&wd.bad===0,'centred '+c.bad+'/'+c.n+' worst '+c.mx.toFixed(2)+', wide '+wd.bad+'/'+wd.n+' worst '+wd.mx.toFixed(2));}
 {const bk=X.RD[0].mem.tz.length-1,ba=keeperAt({bait:true,bk,ph:'bait',solo:true,def:12}),ju=keeperAt({bait:true,bk,ph:'jump',solo:true,def:12});
  ok('baiting leaves the +z post lane open, the jump closes it',ju.g>ba.g+2,'bait '+ba.g+' jump '+ju.g);}
 // --- memory ---
 {const w=world(X);const r=X.RD[0];r.rz0=0;r.rt0=-0.7;const b={m:{position:{x:-24,y:X.BALL_R,z:3}},v:{x:-100,y:0,z:(9-3)/((-60)-(-24))*-100},jlP:{z:3}};   // a line from z 3 to 9 on the goal line
  X.readLearn(r,b,-60);const M=r.mem;
  ok('a shot to the +z post is learned in the top bin',M.tz[M.tz.length-1]>0.9&&M.n===1,Array.from(M.tz).join());
  ok('…with the strike side (+3 from the hold is a push)',M.mv[2]>0.9,Array.from(M.mv).join());
  ok('…and how long it was held',Math.abs(M.hs-0.7)<1e-6);}
 {const w=world(X);hold(X,w);const r=X.RD[0];const b=X.S.balls[0];
  strike(X,b,1,-110,-12);step(X,2);ok('a shot out of a hold is learned on the real ball',r.mem.n===1,'n '+r.mem.n);}
 // --- the plan ---
 {let n=0;for(let s=1;s<=40;s++){const w=world(X,{diff:'legend',seed:s});hold(X,w);if(X.RD[0].bait)n++;}
  ok('legend baits some holds, not all',n>3&&n<30,'baits '+n+'/40');}
 {let n=0;for(let s=1;s<=20;s++){const w=world(X,{diff:'rookie',seed:s});hold(X,w);if(X.RD[0].bait)n++;}ok('rookie never baits',n===0);}
 {let s=1,w;for(;s<200;s++){w=world(X,{diff:'legend',seed:s});hold(X,w);if(X.RD[0].bait)break;}
  const r=X.RD[0];r.jumpAt=Infinity;w.a.kickT=0;step(X,1);const t0=X.S.time;
  ok('a tell does not jump the bait at once',r.ph==='bait');
  while(r.ph==='bait'&&X.S.time-t0<0.5)step(X);
  ok('…it jumps a reaction later',r.ph==='jump'&&Math.abs(X.S.time-t0-X.joltRT(w.g))<3*dt,'after '+(X.S.time-t0).toFixed(3));}
 {let s=1,w;for(;s<200;s++){w=world(X,{diff:'legend',seed:s});hold(X,w);if(X.RD[0].bait)break;}
  const r=X.RD[0],t=r.jumpAt;while(r.ph==='bait'&&X.S.time<t+0.5)step(X);
  ok('with no tell the bait jumps on its timer',r.ph==='jump'&&X.S.time>=t&&X.S.time<t+2*dt);}
 {const w=world(X);hold(X,w);X.S.balls[0].m.position.x=0;step(X,Math.ceil((RC.hold.grace+X.DIFFS.pro.reactDelay)/dt)+3);
  ok('a lost hold ends the read',!X.RD[0].live&&X.readOff(w.g)===undefined);}
 {const w=world(X);w.d.act='catch';hold(X,w);ok('a DEF busy with the ball is not fitted',X.readOff(w.d)===undefined&&X.readOff(w.g)!==undefined);}
 {const on=RC.on;RC.on=false;const w=world(X);hold(X,w);ok('switched off, nothing is read',!X.RD[0].live);RC.on=on;}
 {const on=RC.on;RC.on=[false,true];const w=world(X);hold(X,w);ok('[red, blue]: a team switched off reads nothing',!X.RD[0].live);RC.on=on;}
 // --- the jostle ---
 JO.on=true;RC.bait.p={rookie:0,pro:0,legend:0};
 // spots the keeper (and DEF) take over secs against a still hold, each rod's target following its read as coverZ's does
 const jog=(o)=>{const w=world(X,{diff:o.diff||'pro',seed:o.seed});if(o.def!=null){w.d.act='catch';w.d.offset=w.d.target=o.def;}if(o.role)w.a.role=o.role;
  hold(X,w,o.z);const r=X.RD[0],sp=[],js=[],ds=[];let last=null;
  for(let i=0;i<Math.round((o.secs||4)/dt);i++){step(X);for(const q of [w.g,w.d]){const v=X.readOff(q);if(v!==undefined)q.target=v;}if(!r.live)continue;const j=r.jo[w.g.idx]||0;if(j!==last){sp.push(X.readOff(w.g));js.push(j);last=j;}ds.push(r.jo[w.d.idx]||0);}
  return {w,r,sp,js,ds};};
 {const a=jog({}),amp=JO.amp.pro;let minD=1e9;for(let i=1;i<a.js.length;i++)minD=Math.min(minD,Math.abs(a.js[i]-a.js[i-1]));
  ok('against a held ATT ball the keeper keeps moving to fresh spots',a.sp.length>=10,'spots '+a.sp.length+' in 4 s');
  ok('…each a real move, not a twitch',minD>=JO.step-1e-6,'smallest '+minD.toFixed(2));
  ok('…all near its fit',a.js.every(j=>Math.abs(j)<=amp+1e-6)&&a.js.some(j=>Math.abs(j)>amp*0.5),a.js.map(j=>j.toFixed(1)).join());
  ok('…both ways',a.js.some(j=>j>0.5)&&a.js.some(j=>j<-0.5));
  ok('the DEF jostles too (holding the short line: a wig-wag inside cover.short.tol)',new Set(a.ds.map(j=>j.toFixed(2))).size>=2);}
 {const a=jog({seed:3}),b=jog({seed:3}),c=jog({seed:4});
  ok('the spots are seeded (a retry replays them)',a.js.join()===b.js.join()&&a.js.join()!==c.js.join());}
 {const rk=jog({diff:'rookie'}),lg=jog({diff:'legend'});
  ok('legend jostles more often and wider than rookie',lg.sp.length>rk.sp.length*1.3&&Math.max(...lg.js.map(Math.abs))>Math.max(...rk.js.map(Math.abs)),'spots '+rk.sp.length+' / '+lg.sp.length);}
 {const mean=a=>a.reduce((s,x)=>s+x,0)/a.length,sl=JO.slack;JO.slack=0.01;const lo=jog({def:11,secs:8}),hi=jog({def:-11,secs:8});JO.slack=sl;
  ok('spots are drawn by cover: the keeper jostles more toward the side its DEF leaves open',mean(lo.js)>mean(hi.js)+0.4,'DEF man -1: '+mean(lo.js).toFixed(2)+' DEF man +1: '+mean(hi.js).toFixed(2));}
 {const a=jog({role:'MID'});ok('a MID hold is not jostled against',a.js.every(j=>j===0));}
 {const w=world(X);hold(X,w);step(X,40);const r=X.RD[0];w.a.kickT=0;let n=0;while(!r.commit&&n++<120)step(X);step(X,8);
  ok('a swing, once seen, settles the keeper back on its fit',r.commit&&(r.jo[w.g.idx]||0)===0);}
 {const w=world(X);hold(X,w);step(X,40);const r=X.RD[0];w.a.kickT=0;const n0=X.RDS.jostles;step(X,Math.floor(X.joltRT(w.g)/dt)-2);
  ok('…not before a reaction',!r.swS&&X.RDS.jostles>n0);}
 {const w=world(X);hold(X,w);step(X,10);w.a.angVel=RC.tell.w*2;const n0=X.RDS.jostles;step(X,240);
  ok('the holder fiddling with the rod does not stop the jostle',X.RD[0].tellT>=0&&X.RDS.jostles-n0>=8,'picks '+(X.RDS.jostles-n0));}
 {JO.on=false;const a=jog({});ok('switched off, the keeper stands on its fit',a.sp.length===1&&a.js[0]===0);
  JO.on=[false,true];const b=jog({});ok('[red, blue]: a team switched off stands still',b.sp.length===1);JO.on=true;}
 JO.on=jon;
 RC.bait.p=bp;
 return R;
}

const MUT=[
 {n:'opponents see the strike at once',part:'view',from:'b.jlTm!==r.team&&',to:'b.jlTm===r.team&&'},
 {n:'rt ignored',part:'view',from:'(DIFFS[teamDiff(r.team)].rt||0)',to:'0.2'},
 {n:'no contact needed',part:'view',from:'b.tchT!=null&&S.time-b.tchT<=1.5/SIM.hz',to:'true'},
 {n:'strike threshold ignored',part:'view',from:'>J.v){',to:'>0){'},
 {n:'no carry-on extrapolation',part:'view',from:'P.z+P.vz*a',to:'P.z'},
 {n:'hard set keeps the strike',part:'view',from:'b.histW=REACT_LEN;b.jlT=null;',to:'b.histW=REACT_LEN;'},
 {n:'holder vx gate',part:'read',from:'||Math.abs(vx)>H.vx)return null',to:')return null'},
 {n:'minT ignored',part:'read',from:'if(S.time-rd.t0<RC.hold.minT){rd.live=false;continue;}',to:''},
 {n:'memory ignored',part:'read',from:'return 1+((c[i]+a)/(s+n*a)*n-1)*use;',to:'return 1;'},
 {n:'bait leave/take swapped',part:'read',from:"rd.ph==='bait'?RC.bait.leave:rd.ph==='jump'?RC.bait.take:1",to:"rd.ph==='bait'?RC.bait.take:rd.ph==='jump'?RC.bait.leave:1"},
 {n:'tell seen at once',part:'read',from:'S.time-rd.tellT>=joltRT(g)',to:'true'},
 {n:'no bait timer',part:'read',from:'(seen||S.time>=rd.jumpAt)',to:'seen'},
 {n:'no grace end',part:'read',from:'else{rd.hr=null;rd.live=false;continue;}',to:'else{vh=rd.hr;}'},
 {n:'busy DEF fitted',part:'read',from:'&&!o.act&&!o.force',to:''},
 {n:'shots not learned',part:'read',from:'&&S.time-rd.rt0>=RC.hold.minT)readLearn(rd,rd.rb,gx)',to:'&&false)readLearn(rd,rd.rb,gx)'},
 {n:'strike side flipped',part:'read',from:'M.mv[d<-RC.moveTol?0:d>RC.moveTol?2:1]',to:'M.mv[d<-RC.moveTol?2:d>RC.moveTol?0:1]'},
 {n:'fixed rows ignored by the fit (keeper ignores the DEF)',part:'read',from:'OF.push(op*W[c]/(ws||1))',to:'OF.push(W[c]/(ws||1))'},
 {n:'rod view: own team late',part:'view',from:'if(r2.team===team||!V',to:'if(!V'},
 {n:'rod view: no lag',part:'view',from:'*V.k*SIM.hz',to:'*0*SIM.hz'},
 {n:'rod view: no carry-on',part:'view',from:'*back/SIM.hz*V.lead',to:'*0'},
 {n:'rod view: carried past the target',part:'view',from:'s.offset=o+clamp(tg-o,-a,a)',to:'s.offset=o+Math.sign(h[k+1])*a'},
 {n:'rod view: off ignored',part:'view',from:'||!byTeam(V.on,team)',to:''},
 {n:'rod view: lanes read live',part:'lanes',from:'const q=rodSeen(r2,team);',to:'const q=r2;'},
 {n:'jostle never re-picks',part:'read',from:'rd.jt[k]=S.time+rngR(R,ev[0],ev[1])',to:'rd.jt[k]=1e9'},
 {n:'jostle twitches',part:'read',from:'if(Math.abs(z-cur)<JO.step)continue;',to:''},
 {n:'jostle blind to cover',part:'read',from:'JW[q]=Math.exp(-(JW[q]-cm)/JO.slack)',to:'JW[q]=1'},
 {n:'jostle amp ignored',part:'read',from:'JO.amp[dif]||0',to:'8'},
 {n:'jostle against every row',part:'read',from:'&&JO.roles.indexOf(hr.role)>=0?',to:'?'},
 {n:'jostle through a seen swing',part:'read',from:"rd.ph==='set'&&!rd.swS&&JO.roles",to:"rd.ph==='set'&&JO.roles"},
 {n:'swing seen at once',part:'read',from:'S.time-rd.swT>=joltRT(g)',to:'true'},
 {n:'jostle off switch ignored',part:'read',from:'amp=JO&&byTeam(JO.on,t)&&',to:'amp=JO&&'},
 {n:'jostle from the fit, not the spot',part:'read',from:'o[q]=clamp(p[q]+(rd.jo[mine[q].idx]||0)',to:'o[q]=clamp(p[q]'},
 {n:'short line ignored',part:'read',from:'s+=shortCost(d,SH.read);',to:''},
 {n:'short line run to the goal centre',part:'read',from:'sgz=clamp(rd.bz,-gh,gh)',to:'sgz=0'},
 {n:'a busy DEF on the line not counted',part:'read',from:'mine.indexOf(q)<0)sfd=',to:'mine.indexOf(q)<0&&false)sfd='},
 {n:'DEF fitted only past defend.engage',part:'read',from:'>RC.defAhead))',to:'>AIC.defend.engage))'},
 {n:'a refit leaves the jostle off the line',part:'read',from:'if(d>SH.tol&&bj>=0)rd.jo',to:'if(false)rd.jo'},
 {n:'no room on the line for the jostle',part:'read',from:'Math.max(0,d-AIC.cover.short.tol)',to:'d'}
];

let bad=0;
{const res=suite(boot());for(const t of res){if(!t.ok)bad++;console.log((t.ok?'  ok    ':'  FAIL  ')+t.name+(t.ok||!t.info?'':'   ['+t.info+']'));}
 console.log('  '+(res.length-bad)+' passed, '+bad+' failed');}
let caught=0;
for(const m of MUT){let res;const X=boot(m);
 try{res=suite(X);}catch(e){caught++;console.log('  caught  (threw)  '+m.n);continue;}
 const broke=res.filter(t=>!t.ok);
 if(broke.length){caught++;console.log('  caught  ('+broke.length+' assertions)  '+m.n);}
 else console.log('  MISSED  '+m.n);
}
console.log('  mutations caught: '+caught+'/'+MUT.length);
process.exit(bad||caught<MUT.length?1:0);
