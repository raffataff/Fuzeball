// The tutorial played through on the real sim: a bot on the keys (the first keyboard binding of each action) or on a synthetic pad finishes each lesson. Run from a terminal:
//      node tools/page-run.js tools/tutorial-soak.js "tsAll()"
//      tsRun({course:'adv',kind:'kbm'})            // every lesson of a course, how long each took and how often its ball was re-served
//      tsRun({course:'adv',kind:'pad',only:['walk']})
//      tsRun({course:'adv',idle:true,T:12})       // no input at all: no lesson may pass by itself
//      tsRun({only:['walk'],off:-7.5})           // the lesson's rods left off-centre by the one before
//      tsBinds()                                   // rebind finesse and kick: the lesson text and the bottom hint follow at once
// a lesson's bot is a person doing what its text says; the shot step runs once a 60 fps frame (2 sim steps), like main.js
'use strict';
(function(){
 const FIX=1/SIM.hz;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 let PAD=null;
 const gp0=navigator.getGamepads?navigator.getGamepads.bind(navigator):null;
 navigator.getGamepads=function(){return PAD?[PAD]:(gp0?gp0():[]);};
 function pad(){const b=[];for(let i=0;i<17;i++)b.push({pressed:false,value:0});return {id:'synthetic',connected:true,axes:[0,0,0,0],buttons:b};}
 function frame(){
  if(PAD)gamepadUpdate(1/60);
  shotSeatsUpdate(1/60);
  for(let k=0;k<2;k++){if(S.phase==='play'){aiUpdate(FIX);userControlUpdate(FIX);}updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);}
  if(S.trn)trainingTick();
 }
 // ---- input: one face for keys and pad ----
 const key=a=>bindList(a).find(c=>bindDev(c)==='kbd');
 function In(kind){
  const set=(code,on)=>{if(!code||!!keys[code]===on)return;keys[code]=on;if(on)bindPress(code);else bindRelease(code);};
  const btn=(i,on)=>{PAD.buttons[i].pressed=on;PAD.buttons[i].value=on?1:0;};
  return kind==='pad'?{fin:on=>btn(6,on),kick:on=>btn(0,on),raise:on=>btn(2,on),slide:d=>{btn(12,d<0);btn(13,d>0);},
    off(){for(let i=0;i<17;i++)btn(i,false);}}
   :{fin:on=>set(key('finesse'),on),kick:on=>set(key('kick'),on),raise:on=>set(key('raise'),on),
    slide:d=>{set(key('slideUp'),d<0);set(key('slideDown'),d>0);},
    off(){for(const a of ['finesse','kick','raise','slideUp','slideDown'])set(key(a),false);}};
 }
 // ---- the bots: what each lesson's text tells a person to do ----
 const mz=(r,i)=>r.baseZ[i]+r.offset;
 function nearMan(r,z){let bi=0,bd=1e9;for(let i=0;i<r.baseZ.length;i++){const d=Math.abs(z-mz(r,i));if(d<bd){bd=d;bi=i;}}return bi;}
 const BOTS={
  fwdPin(I,B){I.fin(true);if(B.f>=2)I.kick(true);},
  recv(I,B){I.fin(true);if(B.f===3)I.kick(true);if(B.f>=3+5)I.kick(false);},   // a tap: 5 frames
  pinPass(I,B,r,b){
   I.fin(true);
   const h=tutHome(tutLesson());
   if(!B.k){I.raise(true);if(h.pinB===b){B.pt=B.pt||B.f;if(B.f-B.pt>=15){I.raise(false);I.kick(true);B.k=1;}}}
  },
  // tap from rest: the man nearest the ball slides into it, lets go once it is away, waits for it to stop at the other man
  tictac(I,B,r,b){
   I.fin(true);if(B.f<20)return;
   const p=b.m.position,sp=Math.hypot(b.v.x,b.v.z);
   if(!B.st){
    const m=nearMan(r,p.z),gz=p.z-mz(r,m),come=-b.v.z*Math.sign(gz)>1;
    if(sp<1||(B.o.meet&&come&&Math.abs(gz)<FOOT_BOX.z+BALL_R+B.o.meet)){B.m=m;B.way=Math.sign(gz)||1;B.st='tap';}
    return;}
   if(B.st==='tap'){I.slide(B.way);if(b.v.z*B.way>6||B.f-(B.t0||(B.t0=B.f))>90){I.slide(0);B.st=null;B.t0=0;}}
  },
  // keep raise held; finesse down pins, slide it on, finesse up lifts off, slide the next man over it
  walk(I,B,r,b){
   I.raise(true);
   const p=b.m.position;
   if(B.dz==null){B.dz=p.z<0?1:-1;B.m=nearMan(r,p.z);B.st='pin';B.t=B.f;}
   if(B.st==='pin'){
    I.fin(true);
    const d=p.z-mz(r,B.m),up=r.pinA!=null&&Math.abs(r.angle-r.pinA)<0.05;
    if(!up&&B.f-B.t<36&&!B.o.rush)I.slide(0);else I.slide(d>0.6?1:d<-0.6?-1:0);
    if(r.pinB===b){B.st='carry';I.slide(0);}
   }else if(B.st==='carry'){
    I.slide(B.dz);
    if(B.dz*r.offset>=r.maxOff-0.3||!r.pinB){I.slide(0);B.st='lift';B.t=B.f;}
   }else if(B.st==='lift'){
    if(B.f-B.t>=6)I.fin(false);
    if(B.f-B.t>=18){const n=B.m+B.dz;if(n<0||n>=r.baseZ.length)return;B.m=n;B.st='shift';}
   }else if(B.st==='shift'){
    const d=p.z-mz(r,B.m);
    if(B.o.early)I.fin(true);
    if(d*B.dz<-0.6-(B.o.over||0))I.slide(-B.dz);else{I.slide(0);B.st='pin';B.t=B.f;}
   }
  }
 };
 BOTS.fwdCatch=BOTS.fwdPin;
 // ---- the run ----
 function begin(o){
  TUT.course=o.course;TUT.kind=o.kind;TUT.pending=true;TUT.cont=null;TUT.back='training';
  PAD=o.kind==='pad'?pad():null;
  for(const k of Object.keys(keys))keys[k]=false;
  startMatchNow('training');
  if(typeof NAV!=='undefined')NAV.root=null;   // a match started from the home screen leaves the menu owning the pad
  resetRodRotation();
  rods.forEach(q=>{q.offset=q.target=q.prevOffset=q.iPrevOff=0;q.vz=0;q.pivot.position.z=0;});
  S.lastSwitch=-9;
 }
 function tsRun(o){
  o=Object.assign({course:'adv',kind:'kbm',only:null,T:20,idle:false},o||{});
  const a0=cfg.auto;
  try{
   if(o.autoOff)cfg.auto=false;
   begin(o);
   const I=In(o.kind),out=[];
   const list=tutList();
   for(let li=0;li<list.length;li++){
    const L=list[li];
    if(o.only&&o.only.indexOf(L.id)<0){tutGo(li+1);continue;}
    if(o.off!=null)for(const q of rods)if(q.team===0&&L.rods.indexOf(q.role)>=0){q.offset=q.target=q.prevOffset=q.iOff=q.iPrevOff=clamp(o.off,-q.maxOff,q.maxOff);q.pivot.position.z=q.offset;}   // the rod left off-centre by the lesson before
    if(TUT.i!==li||o.off!=null)tutGo(li);
    I.off();if(PAD)PAD.axes=[0,0,0,0];
    let B={f:0,o},serves=0,sAt=TUT.servedAt,t=null,maxF=o.T*60;
    for(let f=0;f<maxF;f++){
     const r=tutRod(),b=S.balls[0];
     if(TUT.servedAt!==sAt){serves++;sAt=TUT.servedAt;I.off();B={f:0,o};}
     if(!o.idle&&BOTS[L.id]&&r&&b)BOTS[L.id](I,B,r,b);
     B.f++;
     frame();
     if(TUT.done){t=+(S.time-TUT.t0).toFixed(2);break;}
    }
    I.off();
    out.push({id:L.id,done:t!=null,t,serves,prog:TUT.prog});
    for(let f=0;f<6;f++)frame();
   }
   return out;
  }finally{cfg.auto=a0;if(typeof In==='function')In(o.kind).off();PAD=null;for(const k of Object.keys(keys))keys[k]=false;}
 }
 // the lesson text and the bottom hint are the bindings as they are now
 function tsBinds(){
  const was={finesse:bindList('finesse').slice(),kick:bindList('kick').slice()};
  try{
   begin({course:'adv',kind:'kbm'});frame();
   const txt0=$('tutTxt').innerHTML,h0=JSON.stringify(HUD.hint);
   bindSet('finesse',['KeyZ']);bindSet('kick',['KeyX','Mouse1']);
   frame();
   const txt1=$('tutTxt').innerHTML,h1=JSON.stringify(HUD.hint);
   return {before:txt0,after:txt1,
    textFollows:/>Z</.test(txt1)&&/>X</.test(txt1)&&/>MMB</.test(txt1)&&!/R-CTRL/.test(txt1)&&/R-CTRL/.test(txt0),
    hintFollows:h1!==h0&&/"Z"|Z\]|\[Z/.test(h1)};
  }finally{bindSet('finesse',was.finesse);bindSet('kick',was.kick);}
 }
 function tsAll(){
  return {kbm:tsRun({kind:'kbm'}),pad:tsRun({kind:'pad'}),autoOff:tsRun({kind:'kbm',only:['recv','pinPass'],autoOff:true}),
   idle:tsRun({idle:true,T:12}).filter(x=>x.done).map(x=>x.id),basicIdle:tsRun({course:'basic',idle:true,T:8}).filter(x=>x.done).map(x=>x.id),binds:tsBinds()};
 }
 window.tsRun=tsRun;window.tsBinds=tsBinds;window.tsAll=tsAll;
})();
