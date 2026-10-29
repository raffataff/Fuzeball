'use strict';
// ================= the tutorial =================
// training with a lesson plan on top, like trials.js: it runs as mode 'training' behind one more nullable gate, S.tut
// #tutorial asks KEYBOARD & MOUSE or CONTROLLER (prompts only, never which devices work); lessons run back to back (CONFIG.tutorial.lessons), checked once per frame (tutCheck)
// two courses: the basics (TUTC.lessons, also offered before the first match) and ADVANCED MOVES (TUTC.advanced, from the Training screen); TUT.course picks the list
// ways in: the Training cards, the first Kick Off or League start (once, cfg.tutSeen), and REDO; TUT.back / TUT.cont remember where to go and what the player was doing
// finishing the basics sets cfg.tutDone (a PLAYER key, never cleared); the achievement (ACHIEVEMENTS.md) reads it, so it's granted retroactively
const TUTC=CONFIG.tutorial;
const TUT={on:false,pending:false,kind:'kbm',course:'basic',i:0,t0:0,lastT:0,done:false,nextAt:0,fin:false,card:false,
 cont:null,contLbl:'',back:'training',offer:false,saved:null,hudBuilt:false,sig:'',auto:false,hintK:null,hintP:null,
 // per-lesson progress (reset by tutGo)
 acc:0,lastOff:null,seen:null,raised:false,behind:false,chgT:-1,goals:0,servedAt:0,deadT:0,stuck:false,prog:'',mark:false,ttDir:0,lastMan:-1};
function tutOn(){return !!(TUTC&&TUTC.on&&TUTC.lessons&&TUTC.lessons.length);}
function tutAdvOn(){return tutOn()&&!!(TUTC.advanced&&TUTC.advanced.length);}
function tutList(){return TUT.course==='adv'&&tutAdvOn()?TUTC.advanced:TUTC.lessons;}
function tutLesson(){return tutOn()?(tutList()[TUT.i]||null):null;}
function tutRod(){return (S.seats&&S.seats[0])?seatRod(S.seats[0]):null;}
function tutTeamRod(role){return rods.find(q=>q.team===0&&q.role===role)||null;}
// the rod a lesson is set up on (the ball is placed and judged from it), and the one a pass in it goes to
function tutHome(L){return tutTeamRod(L.start||L.rods[0]);}
function tutTo(L){return tutTeamRod(L.rods.find(x=>x!==(L.start||L.rods[0]))||L.rods[0]);}
// the man of rod r whose z is nearest z
function tutMan(r,z){
 let bi=-1,bd=1e9;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(z-(r.baseZ[i]+r.offset));if(d<bd){bd=d;bi=i;}}
 return bi;
}

// ---- ways in ----
// back: the screen to return to when it's over; cont: what to do after that (first-match only); course: 'adv' for ADVANCED MOVES
function tutOpen(back,cont,contLbl,course){
 if(!tutOn())return false;
 TUT.back=back||'training';TUT.cont=cont||null;TUT.contLbl=contLbl||'Play match';TUT.offer=!!cont;
 TUT.course=course==='adv'&&tutAdvOn()?'adv':'basic';
 SCREENS.tutorial.back=TUT.back;
 showScreen('tutorial');
 return true;
}
// the first-match gate: roster.js (Kick Off's Start) and league.js (the League card) ask this and stop if it returns true; offered once, ever
function tutOffer(cont,contLbl){
 if(!tutOn()||!TUTC.firstMatch||cfg.tutSeen)return false;
 return tutOpen(screenId(),cont,contLbl);
}
function tutBegin(kind){
 cfg.tutSeen=true;saveCfg();
 TUT.kind=kind==='pad'?'pad':'kbm';TUT.pending=true;
 Au.init();Au.ui();
 S.teamStats=null;            // a league build scales the player's hit — a lesson is base stats
 startMatch('training');
}
function tutSkipAll(){
 cfg.tutSeen=true;saveCfg();Au.ui();
 const c=TUT.cont;TUT.cont=null;TUT.offer=false;
 showScreen(TUT.back);
 if(c)c();
}

// ---- the run ----
// called at the end of trainingEnter, like trialArm; true when it took the sandbox over
// S.tut set with nothing pending is the pause menu's RESTART, which restarts the plan from the top
function tutArm(){
 if(!TUT.pending&&!S.tut)return false;
 TUT.pending=false;TUT.on=true;S.tut=TUT;TUT.fin=false;TUT.card=false;
 // the sandbox's own settings are the player's (its panel persists them); give them back on the way out
 if(!TUT.saved)TUT.saved={hidden:TRN.hidden.slice(),ai:TRN.ai.slice(),lift:TRN.lift.slice(),
  deadball:TRN.deadball,score:TRN.score,ballType:TRN.ballType};
 buildTutHud();
 const p=$('trnPanel');if(p)p.classList.add('hidden');
 TUT.hintK=TUT.hintP=null;tutHint();
 tutGo(0);
 return true;
}
// the bottom hint speaks to the chosen device only (hud.js draws whichever of the two it's given); rebuilt every frame off the bindings, handed over only when it changed (hudHint restarts the fade)
function tutHint(){
 let k=null,p=null;
 if(TUT.kind==='pad')p='{START} pause · {LB} {RB} switch rod\n{A} kick · {X} raise · {LT} touch · {RT}+{X} wind up\n{LT}+{X} pin · {LT}+{A} forward pin';
 else{const H=bindHintRods(true,true);k=[bindJoin(['[ESC] pause',H.sw,H.slide]),H.act,H.mod].filter(Boolean).join('\n');}
 if(k===TUT.hintK&&p===TUT.hintP)return;
 TUT.hintK=k;TUT.hintP=p;
 hudHint(k,p);
}
// set up lesson i: which of your rods are on the table (the opposition never is), which one you're handed, and the ball; a `keep` lesson carries a ball already pinned over
// `centre`: the lesson's rods start in the middle of their slide, as at a kickoff, so its ball lands where the text says
function tutGo(i){
 TUT.i=i;const L=tutLesson();
 if(!L){tutFinish();return;}
 const r0=tutRod(),keep=!!(L.keep&&r0&&r0.pinB);
 TUT.t0=S.time;TUT.lastT=S.time;TUT.done=false;TUT.nextAt=0;TUT.stuck=false;TUT.acc=0;TUT.lastOff=null;
 TUT.seen=[];TUT.raised=false;TUT.behind=false;TUT.goals=0;TUT.deadT=0;TUT.prog='';TUT.mark=false;TUT.ttDir=0;TUT.lastMan=-1;
 TUT.auto=!!L.auto;
 TRN.freeze=false;TRN.stepQ=0;TRN.score=false;TRN.deadball=false;TRN.ai=[false,false];TRN.ballType='classic';
 // your rods you aren't holding lift out of the way (as in a trial), except where a lesson needs one to receive
 TRN.lift=[L.lift!==false,false];
 rods.forEach((r,k)=>trnSetRodShown(k,r.team===0&&L.rods.indexOf(r.role)>=0));
 if(L.centre&&!keep)for(const q of rods)if(q.team===0&&L.rods.indexOf(q.role)>=0){
  q.offset=q.target=q.prevOffset=q.iOff=q.iPrevOff=0;q.slideV=0;q.vz=0;q.pivot.position.z=0;}
 const s=S.seats[0];
 if(s){
  const mine=rods.filter(r=>r.team===0&&L.rods.indexOf(r.role)>=0).sort((a,b)=>a.x-b.x);
  const was=seatRod(s);
  s.rods=mine;s.ctrl=Math.max(0,mine.findIndex(r=>r.role===(L.start||L.rods[0])));
  if(was&&was!==seatRod(s))rodInputRelease(was);
  if(typeof updateChips==='function')updateChips();
 }
 if(L.auto)S.lastSwitch=-1e9;   // the hand-over may come at once, not autoDelay after the last switch
 const r=tutRod();
 TUT.chgT=(r&&r.chgEndT!=null)?r.chgEndT:-1;   // a charge released BEFORE this lesson must not count for it
 if(!keep){clearBalls();if(L.ball)tutServe();}
 S.stats=freshStats();S.lastTouch=-1;S.phase='play';
 TUT.sig='';tutHudSync();
}
// Put this lesson's ball down — and roll it, if the lesson rolls one at you; zRod: z is from the rod's centre, so it lands between the same two men wherever the rod has slid
function tutServe(){
 const L=tutLesson();if(!L||!L.ball)return;
 const h=L.ball.zRod?tutHome(L):null;
 const b=trnPlace(L.ball.x,(L.ball.z||0)+(h?h.offset:0));
 b.v.set(L.ball.vx||0,0,L.ball.vz||0);
 TUT.servedAt=S.time;TUT.deadT=0;TUT.behind=false;
}
// has the player done what the lesson asks? once per frame; SLIDE, SWITCH, RAISE, PIN PASS, TIC-TAC and WALK accumulate their own progress
function tutCheck(L,r,s){
 const b=S.balls[0]||null;
 switch(L.check){
  case 'slide':
   if(!r)return false;
   if(TUT.lastOff!=null)TUT.acc+=Math.abs(r.offset-TUT.lastOff);
   TUT.lastOff=r.offset;
   return TUT.acc>=TUTC.slideDist;
  case 'goal':return TUT.goals>0;
  case 'raise':{
   // the men must be up while the ball goes under them (raising after it rests against their backs would fire it at your own goal)
   if(!r||!b)return false;
   const rel=(b.m.position.x-r.x)*r.kickDir,up=r.angle*r.kickDir<KICK.raiseA*0.5;
   if(rel<-1)TUT.behind=true;
   if(Math.abs(rel)<BALL_R+2)TUT.raised=up&&(TUT.raised||rel<0);   // up from the moment it reaches the line
   else if(rel<0)TUT.raised=false;
   return TUT.behind&&TUT.raised&&rel>BALL_R+1.5;
  }
  case 'switch':
   if(!r)return false;
   if(TUT.seen.indexOf(r)<0)TUT.seen.push(r);
   return TUT.seen.length>=Math.min(3,s?s.rods.length:3);
  case 'pass':return !!(S.stats&&S.stats.passes[0]>0);
  // a released wind-up stamped in the sweet band (shots.js shotVerdict), whose swing actually went
  case 'charge':return !!(r&&r.chgEndT!=null&&r.chgEndT>TUT.chgT&&r.chgEndBand===1&&r.kickT>=0);
  case 'pin':return !!(r&&r.pinB);
  case 'pinShot':return !!(r&&r.kickT>=0&&r.kickStyle==='trapShot'&&r.kickHit);
  case 'fwdPin':return !!(r&&r.pinB&&r.pinFwd);
  // the rod passed to holds it on the pin: it can only have got there from the passer
  case 'recv':{const q=tutTo(L);return !!(q&&q.pinB);}
  case 'pinPass':{
   const h=tutHome(L),q=tutTo(L);
   if(h&&h.pinB)TUT.mark=true;
   return TUT.mark&&!!(q&&q.pinB);
  }
  // touches along the row, each by the other man of the pair: a new sideways heading is a touch by the man nearest the ball; off the row (or caught, or in the air) starts again
  case 'tictac':{
   if(!r||!b)return false;
   const p=b.m.position,rel=(p.x-r.x)*r.kickDir;
   if(Math.abs(rel)>TUTC.rowBand||p.y>BALL_R+1||b.pinR){TUT.acc=0;TUT.lastMan=-1;TUT.ttDir=0;}
   else{
    const vz=b.v.z,d=(Math.abs(vz)>=TUTC.ttV&&Math.abs(vz)>2*Math.abs(b.v.x))?Math.sign(vz):0;
    if(d&&d!==TUT.ttDir){const m=tutMan(r,p.z);TUT.acc=m!==TUT.lastMan?TUT.acc+1:1;TUT.lastMan=m;TUT.ttDir=d;}
    else if(Math.abs(vz)<1)TUT.ttDir=0;
   }
   TUT.prog=TUT.acc+' / '+TUTC.ttTouches;
   return TUT.acc>=TUTC.ttTouches;
  }
  // every man of the rod has held the ball on the pin
  case 'walk':{
   if(!r||!b)return false;
   if(r.pinB===b){const m=tutMan(r,b.m.position.z);if(m>=0&&TUT.seen.indexOf(m)<0)TUT.seen.push(m);}
   let n=0;for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))n++;
   TUT.prog=TUT.seen.length+' / '+n;
   return n>0&&TUT.seen.length>=n;
  }
 }
 return false;
}
// a ball that dies away from the lesson has to come back: a rolled ball is re-served once dead for a beat or run off behind the rod, a placed ball once at rest elsewhere
// judged from the lesson's own rod, not the one held (a pass hands the seat on); a `row` lesson's ball lying along the rod is in play for rowIdle
function tutKeepBall(L,dt){
 if(!L.ball)return;
 const b=S.balls[0];
 if(!b){tutServe();return;}
 if(b.pinR){TUT.deadT=0;return;}
 const h=tutHome(L),sp=Math.hypot(b.v.x,b.v.z),away=Math.hypot(b.m.position.x-L.ball.x,b.m.position.z-(L.ball.z||0)-(L.ball.zRod&&h?h.offset:0));
 if(sp<2&&(L.ball.vx||away>3))TUT.deadT+=dt;else TUT.deadT=0;
 const rel=h?(b.m.position.x-h.x)*h.kickDir:0,row=!!L.row&&Math.abs(rel)<=TUTC.rowBand;
 const lost=L.ball.vx?(TUT.deadT>=1.2||(L.check!=='raise'&&rel<-12)):TUT.deadT>=(row?TUTC.rowIdle:2.5);
 if(lost&&S.time-TUT.servedAt>1)tutServe();
}
// Once per frame, from trainingTick.
function tutTick(){
 if(!S.tut||TUT.fin)return;
 const L=tutLesson();if(!L)return;
 const dt=Math.max(0,S.time-TUT.lastT);TUT.lastT=S.time;
 const s=S.seats[0],r=tutRod();
 tutHint();
 if(TUT.done){if(S.time>=TUT.nextAt)tutGo(TUT.i+1);return;}
 if(tutCheck(L,r,s)){
  TUT.done=true;TUT.nextAt=S.time+TUTC.nextDelay;
  Au.power();
 }else{
  tutKeepBall(L,dt);
  if(!TUT.stuck&&S.time-TUT.t0>=TUTC.stuckT)TUT.stuck=true;
 }
 tutHudSync();
}
// a training goal (trainingGoal, before the sandbox respawns the ball); team 0 = the player scored
function tutGoal(team){if(S.tut&&team===0)TUT.goals++;}
// Skip the lesson — offered on the retry key / VIEW once a lesson has run past stuckT.
function tutSkip(){
 if(!S.tut||TUT.fin||TUT.done||!TUT.stuck)return false;
 Au.ui();tutGo(TUT.i+1);return true;
}
function tutFinish(){
 TUT.fin=true;TUT.card=true;
 if(TUT.course!=='adv'&&!cfg.tutDone){cfg.tutDone=true;saveCfg();}   // monotonic: the achievement reads this
 TRN.freeze=true;
 Au.goal('medal');if(typeof confetti==='function')confetti();
 TUT.sig='';tutHudSync();
}
// from trainingExit (gotoMenu): drop the gate, hide the chrome, give the sandbox its settings back
function tutExit(){
 S.tut=null;TUT.on=false;TUT.pending=false;TUT.fin=false;TUT.card=false;TUT.done=false;TUT.auto=false;
 TRN.freeze=false;TRN.stepQ=0;
 if(TUT.saved){const v=TUT.saved;TRN.hidden=v.hidden;TRN.ai=v.ai;TRN.lift=v.lift;TRN.deadball=v.deadball;
  TRN.score=v.score;TRN.ballType=v.ballType;TUT.saved=null;}
 const h=$('tutHud');if(h)h.classList.add('hidden');
 const c=$('tutCard');if(c)c.classList.add('hidden');
}
// ---- the finish card's ways out ----
function tutCardGo(){                    // CONTINUE into what the first match was for, or DONE
 Au.ui();const c=TUT.cont;TUT.cont=null;TUT.offer=false;
 S.fromScreen=TUT.back;gotoMenu();
 if(c)c();
}
function tutCardRedo(){Au.ui();S.fromScreen='tutorial';gotoMenu();}   // back to pick the controls again
function tutCardAdvanced(){TUT.course='adv';TUT.cont=null;TUT.offer=false;tutBegin(TUT.kind);}   // the basics done from Training: straight on to ADVANCED MOVES, same controls

// ---- lesson text ----
const tutEsc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// an action's keycaps: its first key and, beside it, its first mouse input ("SPACE / LMB"); one with nothing bound says so
function tutKey(act){
 if(act==='mouse')return'<b class="tutKey m">MOUSE</b>';
 const l=(typeof bindList==='function')?bindList(act):[];
 const k=l.find(c=>bindDev(c)!=='mouse'),m=l.find(c=>bindDev(c)==='mouse');
 if(!k&&!m)return'<b class="tutKey">UNBOUND</b>';
 return[k?'<b class="tutKey">'+tutEsc(bindLabel(k))+'</b>':'',m?'<b class="tutKey m">'+tutEsc(bindLabel(m))+'</b>':'']
  .filter(Boolean).join('<i class="tutOr">/</i>');
}
// [act] > that action's first key binding as a keycap; {A} / {LT+X} > pad glyphs (padnav.js padLabels)
function tutText(t,kind){
 return kind==='pad'?t.replace(/\{([A-Z+\/]+)\}/g,'<span class="tutPad" data-pad="$1"></span>')
  :t.replace(/\[(\w+)\]/g,(m,a)=>tutKey(a));
}

// ---- HUD (DOM, like the trial HUD, see buildTrialHud for why the card is a sibling) ----
function buildTutHud(){
 if(!TUT.hudBuilt){
  TUT.hudBuilt=true;
  const d=document.createElement('div');d.id='tutHud';d.className='hidden';
  d.innerHTML='<div class="tutStep" id="tutStep"></div><div class="tutName" id="tutName"></div>'
   +'<div class="tutTxt" id="tutTxt"></div><div class="tutDots" id="tutDots"></div>'
   +'<div class="tutStuck hidden" id="tutStuck"></div>';
  document.body.appendChild(d);
  const c=document.createElement('div');c.id='tutCard';c.className='trlCard hidden';
  c.innerHTML='<div class="trlRes ok" id="tutCardRes">TUTORIAL COMPLETE</div>'
   +'<div class="tutCardSub" id="tutCardSub"></div>'
   +'<div class="trlBtns"><button class="btn" id="tutCardGo"></button>'
   +'<button class="btn ghost hidden" id="tutCardAdv">Advanced moves</button>'
   +'<button class="btn ghost" id="tutCardRedo">Redo</button></div>'
   +'<div class="trlKeys">Redo to try it with the other controls</div>';
  document.body.appendChild(c);
  $('tutCardGo').onclick=tutCardGo;
  $('tutCardAdv').onclick=tutCardAdvanced;
  $('tutCardRedo').onclick=tutCardRedo;
 }
 $('tutHud').classList.remove('hidden');
}
// the text is built every frame and compared, so a key rebound from the pause menu shows in the lesson at once
function tutHudSync(){
 if(!TUT.hudBuilt||!S.tut)return;
 const L=tutLesson(),n=tutList().length,adv=TUT.course==='adv',pad=TUT.kind==='pad';
 const txt=(L&&!TUT.card)?tutText(pad?L.pad:L.kbm,TUT.kind):'';
 const stk=TUT.stuck?tutText(pad?'{VIEW} skips this lesson':'[retry] skips this lesson',TUT.kind):'';
 const sig=TUT.i+'|'+TUT.done+'|'+TUT.stuck+'|'+TUT.fin+'|'+TUT.kind+'|'+TUT.course+'|'+(TUT.cont?1:0)+'|'+TUT.prog+'|'+txt+'|'+stk;
 if(sig===TUT.sig)return;
 TUT.sig=sig;
 $('tutHud').classList.toggle('hidden',TUT.fin);
 const card=$('tutCard');card.classList.toggle('hidden',!TUT.card);
 if(TUT.card){
  $('tutCardRes').textContent=adv?'ADVANCED MOVES COMPLETE':'TUTORIAL COMPLETE';
  $('tutCardGo').textContent=TUT.cont?TUT.contLbl:'Done';
  $('tutCardAdv').classList.toggle('hidden',adv||!!TUT.cont||!tutAdvOn());
  $('tutCardSub').textContent=TUT.cont?'You know the moves. Now play one.':adv?'You know the advanced moves.':'You know the moves.';
  return;
 }
 if(!L)return;
 $('tutStep').textContent=(adv?'ADVANCED · ':'')+'LESSON '+(TUT.i+1)+' / '+n;
 const nm=$('tutName');nm.textContent=TUT.done?L.name+' · DONE':TUT.prog?L.name+' · '+TUT.prog:L.name;nm.classList.toggle('ok',TUT.done);
 $('tutTxt').innerHTML=txt;
 let dots='';for(let k=0;k<n;k++)dots+='<i class="'+(k<TUT.i||(k===TUT.i&&TUT.done)?'on':k===TUT.i?'cur':'')+'"></i>';
 $('tutDots').innerHTML=dots;
 const st=$('tutStuck');st.classList.toggle('hidden',!TUT.stuck||TUT.done);
 if(TUT.stuck)st.innerHTML='Stuck? '+stk;
 if(pad&&typeof padLabels==='function')padLabels();
}

// ---- #tutorial: pick the controls ----
SCREENS.tutorial.onShow=()=>{
 const again=!!cfg.tutDone,adv=TUT.course==='adv',first=TUT.offer&&!again;
 $('tutTitle').textContent=adv?'ADVANCED MOVES':first?'FIRST MATCH?':'TUTORIAL';
 $('tutTag').textContent=adv?'Forward pin · pass and receive · tic-tac · walking the ball'
  :first?'Learn the controls first · about a minute':'Learn the controls · about a minute';
 const sk=$('tutSkip');
 sk.classList.toggle('hidden',!TUT.cont);
 sk.textContent=again?TUT.contLbl:'Skip, just play';
 // the cursor starts on the device the player last touched
 if(typeof NAV_SCREENS!=='undefined'&&NAV_SCREENS.tutorial)
  NAV_SCREENS.tutorial.def=[(typeof inputKind==='function'&&inputKind()==='pad')?'tutPad':'tutKbm'];
};
(function(){
 const on=(id,f)=>{const b=$(id);if(b)b.onclick=f;};
 on('tutKbm',()=>tutBegin('kbm'));
 on('tutPad',()=>tutBegin('pad'));
 on('tutSkip',tutSkipAll);
 on('tutBack',()=>{Au.ui('back');showScreen(TUT.back);});
 on('btnTrnTutorial',()=>{Au.init();Au.ui();tutOpen('training',null);});
 on('btnTrnAdvanced',()=>{Au.init();Au.ui();tutOpen('training',null,null,'adv');});
 const card=$('btnTrnTutorial');if(card&&!tutOn())card.classList.add('hidden');
 const adv=$('btnTrnAdvanced');if(adv&&!tutAdvOn())adv.classList.add('hidden');
})();
// the retry key skips a lesson once offered; owned here so a missing tutorial.js can't change any key
addEventListener('keydown',e=>{
 if(!S.tut||S.photo)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(typeof bindIs==='function'?bindIs('retry',e.code):e.code==='KeyR'){if(tutSkip())e.preventDefault();}
});
