// The assist ledger (js/assists.js) in whole matches. Terminal:
//      node tools/page-run.js tools/assist-soak.js "asSoakAll({seeds:6,secs:180})"     // both arms: a keyboard + mouse player and a pad player
//      asLedger({dev:'kbm',seeds:6,secs:180})                                             // one arm ('kbm' | 'pad')
// a red human seat played by a bot through the real input path (keys and mouse events, or a synthetic pad), auto-switch on, the AI playing the rest
// the bot follows the ball with the nearest man, taps a ball at the foot (a third of them with power), back-pins a slow ball behind (finesse + raise) and plays it (ATT: the pin shot; else the pin pass or power + kick, the pin shot),
//   forward-pins a slow ball ahead (finesse + kick held; then the snake or it lets go) and receives a ball coming from behind (finesse + kick held)
// returns per arm: each assist's mean count per match and per minute, and its mean value (the ledger's own per-match records)
'use strict';
(function(){
 const FIX=1/SIM.hz,DT=1/60;
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 let sd=1;const rnd=()=>((sd=(Math.imul(sd,1103515245)+12345)>>>0)/4294967296);
 const key=a=>bindList(a).find(c=>bindDev(c)==='kbd');
 const set=(code,on)=>{if(!code||!!keys[code]===on)return;keys[code]=on;if(on)bindPress(code);else bindRelease(code);};
 // --- the synthetic pad: A 0, X 2, LT 6 (squeezed in over a few frames, like a finger), RT 7, left stick y = slide ---
 const PAD={id:'asl-bot',index:0,connected:true,mapping:'standard',timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
 const pb=(i,v)=>{PAD.buttons[i].value=v;PAD.buttons[i].pressed=v>0.5;};
 let ltWant=0;
 // --- the two hands ---
 const KBM={pad:false,mz:0,
  fin:on=>set(key('finesse'),on),kick:on=>set(key('kick'),on),raise:on=>set(key('raise'),on),power:on=>set(key('power'),on),
  // the mouse: one mousemove a frame toward the wanted offset at most 140 u/s, in whole pixels (the remainder is kept); it carries the held modifiers like a real one (input.js modSync drops any it says are up)
  slide(r,o){const d=clamp(clamp(o,-r.maxOff,r.maxOff)-r.target,-140*DT,140*DT),k=CTRL.mouseSpan*CTRL.mouseSens*cfg.mouseSens/innerHeight;
   this.mz+=d/k;const px=Math.trunc(this.mz);if(!px)return;this.mz-=px;
   $('game').dispatchEvent(new MouseEvent('mousemove',{movementY:px,bubbles:true,ctrlKey:!!(keys.ControlLeft||keys.ControlRight),shiftKey:!!(keys.ShiftLeft||keys.ShiftRight),altKey:!!(keys.AltLeft||keys.AltRight),metaKey:!!(keys.MetaLeft||keys.MetaRight)}));},
  tick(){},off(){for(const a of ['finesse','kick','raise','power','slideUp','slideDown'])set(key(a),false);this.mz=0;}};
 const PADH={pad:true,
  fin:on=>{ltWant=on?1:0;},kick:on=>pb(0,on?1:0),raise:on=>pb(2,on?1:0),power:on=>pb(7,on?1:0),
  slide(r,o){const u=clamp((clamp(o,-r.maxOff,r.maxOff)-r.offset)/2,-1,1),v=Math.abs(u)<0.12?0:Math.sign(u)*Math.max(Math.abs(u),cfg.padDeadzone+0.12);PAD.axes[1]=cfg.padSlideInvert?-v:v;},
  tick(){const b=PAD.buttons[6];pb(6,clamp(b.value+clamp(ltWant-b.value,-0.34,0.34),0,1));PAD.timestamp+=DT*1000;},
  off(){ltWant=0;for(const i of [0,2,6,7])pb(i,0);PAD.axes[1]=0;}};
 // --- one frame: the pad poll and shot step once, two sim steps (main.js) ---
 function frame(H){
  H.tick();
  if(H.pad)gamepadUpdate(DT);
  shotSeatsUpdate(DT);
  for(let k=0;k<2;k++){
   if(S.phase==='play'){aiUpdate(FIX);userControlUpdate(FIX);deadBallUpdate(FIX);}
   updateRods(FIX);physics(FIX);S.time+=FIX;for(const q of S.balls)q.cur.copy(q.m.position);
  }
  if(S.phase==='play'){S.matchTime+=DT;if(S.asl&&S.asl.m)S.asl.m.secs+=DT;}
 }
 const ballFor=u=>{let b=null,bd=1e9;for(const q of S.balls){if(q.scored)continue;const d=Math.abs(q.m.position.x-u.x);if(d<bd){bd=d;b=q;}}return b;};
 const near=(u,z)=>{let i=0,d=1e9;for(let k=0;k<u.baseZ.length;k++){const e=Math.abs(z-u.baseZ[k]-u.offset);if(e<d){d=e;i=k;}}return {i,d};};
 // --- the player ---
 function think(B,H){
  const s=S.seats[0],u=s&&seatRod(s);
  if(u!==B.u){H.off();B.u=u;B.ph='idle';B.t=0;}
  if(!u||S.phase!=='play')return;
  B.t+=DT;
  const b=ballFor(u);if(!b){H.off();B.ph='idle';return;}
  const p=b.m.position,dir=u.kickDir,rel=(p.x-u.x)*dir,vf=b.v.x*dir,sp=Math.hypot(b.v.x,b.v.z),nm=near(u,p.z),low=p.y<BALL_R+0.6;
  const go=p.z-u.baseZ[nm.i],end=()=>{H.off();B.ph='idle';B.t=0;},PWS=()=>CONFIG.shots.pin.press.shoot==='power';
  switch(B.ph){
   case 'idle':
    H.slide(u,go);
    if(u.kickT>=0||u.role==='GK'&&rel<0)break;
    if(u.role!=='GK'&&low&&sp<30&&rel<-1.8&&rel>-6.5&&nm.d<5){B.ph='bpin';B.t=0;H.fin(true);H.raise(true);}
    else if(u.role!=='GK'&&low&&sp<25&&rel>2.6&&rel<6&&nm.d<4){B.ph='fpin';B.t=0;H.fin(true);H.kick(true);}
    else if(u.role!=='GK'&&low&&vf>12&&rel<-3&&rel>-30&&S.time>B.rcd){B.ph='recv';B.t=0;H.fin(true);H.kick(true);}
    else if(low&&rel>0.3&&rel<4.2&&nm.d<1.6){B.ph='kick';B.t=0;if(rnd()<0.33)H.power(true);H.kick(true);}
    break;
   case 'kick':if(B.t>=DT*1.5)end();break;
   case 'bpin':
    H.slide(u,go);
    if(u.pinB){B.ph='bhold';B.t=0;B.hold=0.3+rnd()*0.8;B.dz=(rnd()-0.5)*16;B.z0=u.offset;}
    else if(B.t>1.2||rel>0||sp>45)end();
    break;
   case 'bhold':
    if(!u.pinB){end();break;}
    H.slide(u,B.z0+B.dz);
    if(B.t>B.hold){B.ph=(u.role==='ATT'||rnd()<0.5)?'two':'one';B.t=0;if(B.ph==='two'&&PWS())H.power(true);H.kick(true);}
    break;
   case 'one':if(B.t>=DT*1.5)H.kick(false);if(B.t>0.35)end();break;   // a kick: the pin pass (shots.pin.press)
   case 'two':if(PWS()){if(B.t>=DT*1.5){H.kick(false);H.power(false);}}else H.kick(B.t<DT*1.5||(B.t>=0.08&&B.t<0.08+DT*1.5));if(B.t>0.3)end();break;   // power + kick ('double': two kicks): the pin shot
   case 'fpin':
    H.slide(u,go);
    if(u.pinB&&u.pinFwd){B.ph='fhold';B.t=0;B.snake=rnd()<0.4;}
    else if(B.t>1.5||rel<1.5||rel>8)end();
    break;
   case 'fhold':
    if(!u.pinB){end();break;}
    if(B.t<0.5)break;
    if(!B.snake){end();break;}
    if(PWS()){H.power(B.t>=0.5+DT*2);H.kick(!(B.t<0.5+DT*4));}   // let go, then power + kick: the snake
    else H.kick(!(B.t<0.5+DT*2||(B.t>=0.5+DT*4&&B.t<0.5+DT*6)));   // 'double': let go, then two quick presses
    if(B.t>0.8)end();
    break;
   case 'recv':
    H.slide(u,go);
    if(u.pinB||B.t>2||vf<0||rel>4){B.rcd=S.time+1;end();}
    break;
  }
 }
 // --- matches ---
 function asLedger(o){
  o=Object.assign({dev:'kbm',seeds:6,secs:180,seed0:1,diff:'pro'},o||{});
  const H=o.dev==='pad'?PADH:KBM,gp=navigator.getGamepads,keep=[cfg.diffRed,cfg.diffBlue,cfg.auto,CONFIG.feel.on],wh=Au.whistle;
  navigator.getGamepads=()=>H.pad?[PAD]:[];
  cfg.diffRed=cfg.diffBlue=o.diff;cfg.auto=true;CONFIG.feel.on=false;Au.whistle=function(){};
  aslToggle(true,true);S.asl.hist=[];
  const goals=[];
  try{
   for(let si=0;si<o.seeds;si++){
    sd=o.seed0+si*7;S.seedNext=o.seed0+si*7;startMatchNow('red');
    if(typeof NAV!=='undefined')NAV.root=null;   // page-run starts from home: padnav must not own the pad
    S.phase='count';S.countT=0;serve();
    H.off();for(const k of Object.keys(keys))keys[k]=false;
    rods.forEach(r=>{r.bgT=-9;r.lhT=0;r.catCd=0;r.rvUntil=0;r.rvReady=false;});
    const B={u:null,ph:'idle',t:0,rcd:0},s0=S.score[0]+S.score[1],n=Math.round(o.secs/DT);
    for(let i=0;i<n;i++){
     if(S.phase!=='play'){S.phase='count';serve();S.phase='play';}
     think(B,H);frame(H);
    }
    H.off();goals.push(S.score[0]+S.score[1]-s0);
    aslEnd();
   }
  }finally{navigator.getGamepads=gp;cfg.diffRed=keep[0];cfg.diffBlue=keep[1];cfg.auto=keep[2];CONFIG.feel.on=keep[3];Au.whistle=wh;H.off();for(const k of Object.keys(keys))keys[k]=false;}
  return asSum(S.asl.hist,{dev:o.dev,goals});
 }
 // mean per match, per minute and mean value for each assist across the records
 function asSum(h,extra){
  const n=Math.max(1,h.length),mins=h.reduce((a,m)=>a+m.secs,0)/60,out={};
  for(const d of ASL_DEFS){
   let c=0,t=0,vn=0,v=0;for(const m of h){const e=m.ids[d.id];if(e){c+=e.n;t+=e.t;vn+=e.vn;v+=e.v;}}
   out[d.id]={perMatch:+(c/n).toFixed(1),perMin:+(c/Math.max(1e-3,mins)).toFixed(2),secsPerMatch:+(t/n).toFixed(1),avg:vn?+(v/vn).toFixed(1):null};
  }
  return Object.assign({matches:h.length,mins:+mins.toFixed(1)},extra,{ids:out,records:h});
 }
 function asSoakAll(o){return {kbm:asLedger(Object.assign({},o,{dev:'kbm'})),pad:asLedger(Object.assign({},o,{dev:'pad'}))};}
 Object.assign(window,{asLedger,asSoakAll,asSum});
})();
