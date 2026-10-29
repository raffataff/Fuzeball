// The drill trials (CONFIG.trials, goal.kind 'drill') played on the real sim by a bot: the buttons on their first keyboard bindings, the slide as a mouse moves it (the slide target, a little each frame). Run from a terminal:
//      node tools/page-run.js tools/trials-soak.js "trSeeds({n:12})"
//      trRun({only:['aTtLane'],T:60})            // each drill: done, how long (trial seconds), how far it got, balls served
//      trRun({cat:'MID'})                        // one discipline
//      trRun({idle:true,T:20})                   // no input at all: no drill may finish by itself
//      trSeeds({cat:"ATT",n:8})                  // each drill on n seeds: how many finished, median / best / worst seconds
//      trCreep()                                 // the rally alone: touches, and how far the ball crept along x
// a drill's bot is a person doing what its blurb says; the shot step runs once a 60 fps frame (2 sim steps), like main.js
'use strict';
(function(){
 const FIX=1/SIM.hz,DT=1/60;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 function frame(){
  shotSeatsUpdate(DT);
  for(let k=0;k<2;k++){if(S.phase==='play'){aiUpdate(FIX);userControlUpdate(FIX);}updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
  if(S.trn)trainingTick();
 }
 // ---- input: the buttons on keys, the slide as a mouse ----
 const key=a=>bindList(a).find(c=>bindDev(c)==='kbd');
 const set=(code,on)=>{if(!code||!!keys[code]===on)return;keys[code]=on;if(on)bindPress(code);else bindRelease(code);};
 const I={fin:on=>set(key('finesse'),on),kick:on=>set(key('kick'),on),raise:on=>set(key('raise'),on),
  off(){for(const a of ['finesse','kick','raise','slideUp','slideDown','power'])set(key(a),false);}};
 // the mouse: the slide target moves toward o at no more than v (u/s) this frame; null = the hand is still
 function slideTo(r,o,v){o=clamp(o,-r.maxOff,r.maxOff);const d=clamp(o-r.target,-v*DT,v*DT);if(Math.abs(d)>1e-6)r.target+=d;}
 function slideV(r,v){if(v)r.target=clamp(r.target+v*DT,-r.maxOff,r.maxOff);}
 const mz=(r,i)=>r.baseZ[i]+r.offset,rel=(r,b)=>(b.m.position.x-r.x)*r.kickDir;
 function nearMan(r,z){let bi=0,bd=1e9;for(let i=0;i<r.baseZ.length;i++){const d=Math.abs(z-mz(r,i));if(d<bd){bd=d;bi=i;}}return bi;}
 // the man that can be slid onto z with the least travel, and the offset that does it
 function bestMan(r,z){let bi=-1,bo=0,bd=1e9;for(let i=0;i<r.baseZ.length;i++){const o=z-r.baseZ[i];if(Math.abs(o)>r.maxOff+0.5)continue;const d=Math.abs(o-r.offset);if(d<bd){bd=d;bi=i;bo=clamp(o,-r.maxOff,r.maxOff);}}return bi<0?null:{i:bi,o:bo};}
 // where a ball rolling at the rod crosses rel x0 (z then), and when
 function arrive(r,b,x0){const vf=-b.v.x*r.kickDir,d=rel(r,b)-x0;if(vf<0.5)return {z:b.m.position.z,t:0};const t=d/vf;return {z:clamp(b.m.position.z+b.v.z*t,-F.W/2+BALL_R,F.W/2-BALL_R),t:t};}
 // ---- the bots ----
 const FACE=()=>FOOT_BOX.z+BALL_R;
 // the gap (pair i, i+1) the ball lies in, -1 outside the outer men
 function gapOf(r,z){for(let i=0;i+1<r.baseZ.length;i++)if(z>mz(r,i)&&z<mz(r,i+1))return i;return -1;}
 // tic-tac with finesse held (the feet square, a man's side stops the ball dead): the man the ball lies against, or is rolling at, slides into it; between touches the rod drifts the pair onto `want`
 function rally(r,b,B,want,dv){
  const p=b.m.position,vz=b.v.z,g=gapOf(r,p.z);
  I.raise(false);I.fin(true);
  if(g<0)return false;
  if(B.tap){
   const s=B.tap.s;
   slideV(r,s*tapV(r,B));
   if(vz*s>DRILL.touchV+1||B.f-B.tap.f>40)B.tap=null;
   return true;
  }
  // at rest, the nearer of the two men whose slide can bring his face to it; rolling, the man it rolls at
  const can=i=>Math.abs(p.z-Math.sign(p.z-mz(r,i))*FACE()-r.baseZ[i])<=r.maxOff;
  const A=Math.abs(vz)<2?((p.z-mz(r,g)<mz(r,g+1)-p.z?can(g):!can(g+1))?g:g+1):(vz>0?g+1:g),s=Math.sign(p.z-mz(r,A)),fd=Math.abs(p.z-mz(r,A))-FACE();
  // a ball at rest is gone to by the nearer man; one rolling at a man is met at his face
  if((Math.abs(vz)<2||(fd<B.o.meet&&-vz*s>0))&&B.f-(B.tl||-99)>B.o.wait){B.tap={s:s,f:B.f};B.tl=B.f;return true;}
  if(want!=null){const d=want-r.offset;if(Math.abs(d)>0.5){const v=clamp(d*6,-dv,dv);
   // never drift a man onto a ball resting against his face
   const M=v>0?g+1:g,fm=Math.abs(p.z-mz(r,M))-FACE();if(!(fm<1.2&&Math.sign(p.z-mz(r,M))===Math.sign(v)))slideV(r,v);}}
  return true;
 }
 const DRILL=CONFIG.trials.drill;
 const tapV=(r,B)=>Math.min(B.o.tapV,Math.abs(r.baseZ[1]-r.baseZ[0])*B.o.tapK);
 const BOTS={
  // tic-tac in a lane: the pair whose gap can sit on the lane; to change gap, step the men over a ball at rest (one man at a time) if the slide allows, else push it and let it roll under the man in the way
  tictac(r,b,B,D){
   const ln=D.lane,p=b.m.position,k=r.baseZ.length,vz=b.v.z;
   if(!ln)return;
   let pi=0,po=0,pd=1e9;
   for(let i=0;i+1<k;i++){const gc=(r.baseZ[i]+r.baseZ[i+1])/2,o=clamp(ln.c-gc,-r.maxOff,r.maxOff),d=Math.abs(gc+o-ln.c)*10+Math.abs(o-r.offset);if(d<pd){pd=d;pi=i;po=o;}}
   if(B.f<10){I.fin(true);return;}
   const g=gapOf(r,p.z),cl=FACE()+1.2;
   if(B.over){
    I.fin(false);I.raise(true);slideTo(r,B.over.o,30);
    if(Math.abs(r.offset-B.over.o)<0.3){B.over=null;I.raise(false);I.fin(true);B.tl=B.f;}
    else if(B.f-B.over.f>120)B.over=null;
    return;
   }
   if(B.thru){
    // up while it rolls under the man in the way; down once it is in the lane's gap, clear of him
    const T=B.thru,ng=gapOf(r,p.z);
    I.fin(false);I.raise(true);
    if((ng===pi&&Math.abs(p.z-mz(r,T.s>0?pi:pi+1))>FACE()+B.o.downD)||Math.abs(vz)<1||vz*T.s<0||B.f-T.f>150){B.thru=null;I.raise(false);I.fin(true);B.tl=B.f;}
    return;
   }
   if(g===pi){rally(r,b,B,po,B.o.drift);return;}
   const tg=g<0?(p.z<mz(r,0)?0:k-2):g+Math.sign(pi-g),s=Math.sign((r.baseZ[tg]+r.baseZ[tg+1])/2+r.offset-p.z)||1;
   if(Math.abs(vz)<2){
    // at rest: step over it into the next gap toward the lane's, if the slide allows
    const lo=Math.max(-r.maxOff,p.z-r.baseZ[tg+1]+cl),hi=Math.min(r.maxOff,p.z-r.baseZ[tg]-cl);
    if(lo<=hi){B.over={o:clamp(tg===pi?po:r.offset,lo,hi),f:B.f};B.tap=null;return;}
   }else if(vz*s>DRILL.touchV&&g>=0){B.thru={s:s,f:B.f};B.tap=null;return;}
   if(g<0){rally(r,b,B,null,0);return;}
   // push it gently toward that gap with the man behind it, if he can reach it; else tap it the other way and try again from there
   I.raise(false);I.fin(true);
   const M=s>0?g:g+1,can=Math.abs(p.z-s*FACE()-r.baseZ[M])<=r.maxOff;
   if(!B.tap&&B.f-(B.tl||-99)>B.o.wait&&Math.abs(vz)<2){B.tap={s:can?s:-s,f:B.f,v:B.o.thruV};B.tl=B.f;}
   if(B.tap){slideV(r,B.tap.s*(B.tap.v||tapV(r,B)));if(vz*B.tap.s>DRILL.touchV+1||B.f-B.tap.f>60)B.tap=null;}
  },
  // tic-tac, then the strike: finesse up and the men raised so the ball rolls in front of the man it is heading for, kick as it reaches his foot
  ttShot(r,b,B,D){
   const p=b.m.position,vz=b.v.z;
   if(B.f<10){I.fin(true);return;}
   if(B.st==='kick'){if(B.f-B.kf>20){I.kick(false);I.raise(false);B.st=null;}return;}
   if(D.ch>=D.g.rally&&Math.abs(vz)>=8&&!B.st){
    const g=gapOf(r,p.z);
    if(g>=0){const M=vz>0?g+1:g,d=Math.abs(p.z-mz(r,M));if(d>FACE()+1.5){B.st='aim';B.m=M;}}
   }
   if(B.st==='aim'){
    I.fin(false);I.raise(true);
    const d=(mz(r,B.m)-p.z)*Math.sign(vz);
    if(d<=Math.abs(vz)*B.o.lead){I.kick(true);B.st='kick';B.kf=B.f;}
    else if(Math.abs(vz)<3||d<-2){B.st=null;I.raise(false);}
    return;
   }
   rally(r,b,B,null,0);
  },
  // pin and place: pin it (raise and finesse held), carry it to the lane; past this man's slide, lift off, the next man over it, pin again
  place(r,b,B,D){
   const ln=D.lane;if(!ln)return;
   walkTo(r,b,B,ln.c);
  },
  // walk: the next man in turn pins it; he is brought over it, so the man before must carry it into his reach
  walk(r,b,B,D){
   const m=D.seq[D.n];if(m==null)return;
   walkTo(r,b,B,null,m);
  },
  roll(r,b,B,D){rollBot(r,b,B,D);},
  // pin shot: the back pin takes the served ball, the man carries it beside the keeper, the kick fires from the pin
  pinShot(r,b,B,D){
   if(B.st==='shot'){if(B.f-B.kf>8)I.kick(false);return;}
   I.raise(true);I.fin(true);
   if(r.pinB===b){aimShot(r,b,B);return;}
   const a=arrive(r,b,-3.6),m=bestMan(r,a.z);if(m)slideTo(r,m.o,60);
  },
  // roll and fire: a roll first, then the pin it reached carries it beside the keeper and shoots
  rollShot(r,b,B,D){
   if(B.st==='shot'){if(B.f-B.kf>8)I.kick(false);return;}
   if(D.pin&&D.pin.roll&&r.pinB===b){I.raise(true);I.fin(true);aimShot(r,b,B);return;}
   rollBot(r,b,B,D);
  }
 };
 // carry the pinned ball to a lane beside the keeper (±aim, or as near as this man reaches), stop, kick
 function aimShot(r,b,B){
  const p=b.m.position,m=nearMan(r,p.z),dz=p.z-mz(r,m),lo=r.baseZ[m]-r.maxOff+dz,hi=r.baseZ[m]+r.maxOff+dz;
  const s=p.z>=0?1:-1,c=[s*B.o.aim,-s*B.o.aim].map(z=>clamp(z,lo,hi)).sort((x,y)=>Math.abs(Math.abs(x)-B.o.aim)-Math.abs(Math.abs(y)-B.o.aim))[0];
  slideTo(r,r.offset+(c-p.z),30);
  if(Math.abs(c-p.z)<0.4&&Math.abs(r.vz)<2){I.kick(true);B.st='shot';B.kf=B.f;}
 }
 // the ball to z (or onto man `to`): pinned, carried, lifted off and handed on along the row; raise held throughout, finesse down pins
 function walkTo(r,b,B,z,to){
  const p=b.m.position;
  I.raise(true);
  if(!B.st){B.st='pin';B.t=B.f;}
  const cur=r.pinB===b?nearMan(r,p.z):null;
  // which man should hold it now: the one that can bring it nearest the target
  const tz=to!=null?r.baseZ[to]:z,want=to!=null?to:(()=>{let bi=0,bd=1e9;for(let i=0;i<r.baseZ.length;i++){const d=Math.abs(clamp(tz-r.baseZ[i],-r.maxOff,r.maxOff)+r.baseZ[i]-tz);if(d<bd-0.5||(Math.abs(d-bd)<=0.5&&Math.abs(p.z-mz(r,i))<Math.abs(p.z-mz(r,bi)))){bd=d;bi=i;}}return bi;})();
  if(B.st==='pin'){
   I.fin(true);
   const bm=bestMan(r,p.z),m=B.m!=null?B.m:(bm?bm.i:nearMan(r,p.z));B.m=m;
   const d=p.z-mz(r,m),up=r.pinA!=null&&Math.abs(r.angle-r.pinA)<0.05;
   if(up||B.f-B.t>=36)slideTo(r,r.offset+d,20);
   if(r.pinB===b){B.st='carry';B.t=B.f;}
   return;
  }
  if(B.st==='carry'){
   I.fin(true);
   if(r.pinB!==b){B.st='pin';B.m=null;B.t=B.f;return;}
   const m=cur;
   if(to!=null&&m===to){slideTo(r,r.offset,0);return;}
   if(m===want){
    if(to!=null)return;
    slideTo(r,tz-(p.z-mz(r,m))-r.baseZ[m],30);
    return;
   }
   // carry toward the next man's reach, as far as this man's slide allows, then lift off
   const n=m+Math.sign(want-m),nz=clamp(p.z,r.baseZ[n]-r.maxOff+0.8,r.baseZ[n]+r.maxOff-0.8),o=r.offset+(nz-p.z);
   slideTo(r,o,30);
   if(Math.abs(o-r.offset)<0.3||Math.abs(r.offset)>=r.maxOff-0.05){B.st='lift';B.t=B.f;B.n=n;}
   return;
  }
  if(B.st==='lift'){
   if(B.f-B.t>=4)I.fin(false);
   if(B.f-B.t>=16){B.m=B.n;B.st='shift';}
   return;
  }
  if(B.st==='shift'){
   I.fin(false);
   if(Math.abs(p.z-r.baseZ[B.m])>r.maxOff+1){const bm=bestMan(r,p.z);if(bm)B.m=bm.i;}   // he cannot reach it: the man who can
   const d=p.z-mz(r,B.m);
   slideTo(r,r.offset+d,60);
   if(Math.abs(d)<0.6){B.st='pin';B.t=B.f;}
  }
 }
 // roll: pin it, back off, carry it toward the neighbour with room to run, let go at a set speed, stop the rod; finesse again once it has left the man, and the neighbour pins it
 function rollBot(r,b,B,D){
  const p=b.m.position,k=r.baseZ.length;
  I.raise(true);
  if(!B.st){B.st='pin';B.t=B.f;}
  if(B.st==='pin'){
   I.fin(true);
   const bm=bestMan(r,p.z),m=B.m!=null?B.m:(bm?bm.i:nearMan(r,p.z));B.m=m;
   const d=p.z-mz(r,m),up=r.pinA!=null&&Math.abs(r.angle-r.pinA)<0.05;
   if(up||B.f-B.t>=36)slideTo(r,r.offset+d,20);
   if(r.pinB===b){B.st='set';B.t=B.f;B.m=nearMan(r,p.z);B.dir=null;B.back=null;}
   return;
  }
  if(B.st==='set'){
   I.fin(true);
   if(r.pinB!==b){B.st='pin';B.m=null;B.t=B.f;return;}
   const m=B.m;
   if(B.dir==null){const room=s=>(s>0?r.maxOff-r.offset:r.offset+r.maxOff);B.dir=m===0?1:m===k-1?-1:(room(1)>=room(-1)?1:-1);B.back=clamp(-B.dir*r.maxOff*B.o.backF,-r.maxOff,r.maxOff);}
   slideTo(r,B.back,40);
   if(Math.abs(r.offset-B.back)<0.3){B.st='run';B.t=B.f;B.n=m+B.dir;}
   return;
  }
  if(B.st==='run'){
   I.fin(true);
   slideV(r,B.dir*B.o.rollV);
   if(B.f-B.t>=B.o.runF||Math.abs(r.offset)>=r.maxOff-0.1){B.st='go';B.t=B.f;I.fin(false);}
   return;
  }
  if(B.st==='go'){
   slideV(r,B.dir*B.o.rollV*B.o.follow);
   if(Math.abs(p.z-mz(r,B.m))>B.o.catchD)I.fin(true);
   if(r.pinB===b){B.st='set';B.m=nearMan(r,p.z);B.dir=null;B.t=B.f;}
   else if(B.f-B.t>150||Math.abs(b.v.z)<0.5){B.st='pin';B.m=null;B.t=B.f;}
  }
 }
 Object.assign(BOTS,{
  // back pin: raise and finesse held, the man nearest the ball's line on it as it arrives
  pin(r,b,B,D){
   if(D.g.pin==='fwd')return BOTS.fwd(r,b,B,D);
   I.raise(true);I.fin(true);
   if(r.pinB)return;
   const a=arrive(r,b,-3.6),m=bestMan(r,a.z);if(m)slideTo(r,m.o,60);
  },
  // forward pin: a man brought near the ball, then finesse and kick held: the assist steps off, lifts, comes over and lowers
  fwd(r,b,B,D){
   if(r.pinB){I.fin(true);I.kick(true);return;}
   const moving=-b.v.x*r.kickDir>1,a=moving?arrive(r,b,4):{z:b.m.position.z},m=bestMan(r,a.z);
   if(!B.go){
    if(m)slideTo(r,m.o+(moving?0:B.o.side||0),60);
    if(m&&Math.abs(r.offset-m.o-(moving?0:B.o.side||0))<1.2){B.go=B.f;}
    return;
   }
   I.fin(true);if(B.f-B.go>=2)I.kick(true);
   if(moving&&m)slideTo(r,m.o,20);
  }
 });
 // ---- the run ----
 function begin(d){
  for(const k of Object.keys(keys))keys[k]=false;
  if(S.trial)trialExit();
  if(cfg.table!==d.table){cfg.table=d.table;if(typeof applyTable==='function')applyTable();}
  TRL.pending=d;S.seedNext=d.seed>>>0;S.teamStats=null;
  startMatchNow('training',d.hold||null);
  if(typeof NAV!=='undefined')NAV.root=null;   // a match started from the home screen leaves the menu owning the pad
 }
 const OPT={T:90,idle:false,trace:false,tapV:40,tapK:2.2,thruV:7,upD:2,downD:0.3,meet:1.5,wait:6,drift:14,lead:0.03,rollV:20,runF:20,follow:0,catchD:4,backF:0.6,aim:6.5};
 // one attempt at drill d by its bot: done, trial seconds, how far it got, balls served
 function play(d,o){
  begin(d);I.off();
  let B={f:0,o:o},serves=0,sp=TRL.spawn;
  const bot=BOTS[d.goal.move],tr=[];
  for(let f=0;f<o.T*60;f++){
   const D=TRL.dr,r=D&&D.r,b=S.balls[0];
   if(TRL.spawn!==sp){serves++;sp=TRL.spawn;I.off();B={f:0,o:o};}
   if(!o.idle&&bot&&r&&b&&!TRL.serving)bot(r,b,B,D);
   B.f++;
   frame();
   if(o.trace&&f%6===0&&b&&r)tr.push([+S.time.toFixed(2),+rel(r,b).toFixed(2),+b.m.position.z.toFixed(2),+b.v.x.toFixed(1),+b.v.z.toFixed(1),+r.offset.toFixed(2),+r.target.toFixed(2),+r.angle.toFixed(2),r.pinB?1:0,D.n,D.lane?+D.lane.c.toFixed(1):null,D.lk,D.ch,B.thru?'T':B.tap?'t':(B.st||''),D.rel?[D.rel.man,+D.rel.v.toFixed(1),D.rel.on?1:0]:null]);
   if(TRL.done)break;
  }
  I.off();
  const D=TRL.dr,res={id:d.id,done:TRL.done&&TRL.ok,t:TRL.done?+TRL.secs.toFixed(2):null,n:D?D.n:0,serves:serves,medal:TRL.medal};
  if(o.trace)res.trace=tr;
  for(let f=0;f<4;f++)frame();
  return res;
 }
 const DRILLS=o=>CONFIG.trials.list.filter(d=>d.goal.kind==='drill'&&(!o.only||o.only.indexOf(d.id)>=0)&&(!o.cat||d.cat===o.cat));
 function trRun(o){
  o=Object.assign({only:null,cat:null},OPT,o||{});
  try{return DRILLS(o).map(d=>play(d,o));}
  finally{I.off();for(const k of Object.keys(keys))keys[k]=false;if(S.trial)trialExit();}
 }
 // each drill on n seeds (its own first, then fresh ones): how many it finished, and the median / best / worst trial seconds of those
 function trSeeds(o){
  o=Object.assign({only:null,cat:null,n:6},OPT,o||{});
  const out=[];
  try{
   for(const d of DRILLS(o)){
    const ts=[];let done=0;
    for(let k=0;k<o.n;k++){const res=play(Object.assign({},d,{seed:(d.seed+k*7919)>>>0}),o);if(res.done){done++;ts.push(res.t);}}
    ts.sort((a,b)=>a-b);
    out.push({id:d.id,done:done+'/'+o.n,med:ts.length?ts[ts.length>>1]:null,best:ts[0]||null,worst:ts.length?ts[ts.length-1]:null,medals:d.medals,limit:d.limit});
   }
   return out;
  }finally{I.off();for(const k of Object.keys(keys))keys[k]=false;if(S.trial)trialExit();}
 }
 // the rally alone (a drill's ball, no lane, no shot) for T s: touches, and how far the ball has crept along x (dir-relative) per touch
 function trCreep(o){
  o=Object.assign({ids:['aTtLane','mTtLane','dTtLane']},OPT,{T:12},o||{});
  const out=[];
  try{
   for(const id of o.ids){
    const d=trialById(id);begin(d);I.off();
    const D=TRL.dr,r=D.r;D.lane=null;
    let B={f:0,o:o},ch=0,touches=0,rel0=null,relEnd=null,lost=0;
    for(let f=0;f<o.T*60;f++){
     const b=S.balls[0];
     if(b&&!TRL.serving){if(rel0==null)rel0=rel(r,b);rally(r,b,B,null,0);}
     B.f++;frame();
     if(TRL.serving){lost++;B={f:0,o:o};rel0=null;while(TRL.serving)frame();}
     if(D.ch>ch)touches++;ch=D.ch;
     const b2=S.balls[0];if(b2)relEnd=rel(r,b2);
    }
    out.push({id,touches,lost,rel0:rel0==null?null:+rel0.toFixed(2),relEnd:relEnd==null?null:+relEnd.toFixed(2)});
   }
   return out;
  }finally{I.off();if(S.trial)trialExit();}
 }
 window.trRun=trRun;window.trSeeds=trSeeds;window.trCreep=trCreep;
})();
