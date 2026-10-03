'use strict';
// ================= the tutorial =================
// training with a lesson plan on top, like trials.js: it runs as mode 'training' behind one more nullable gate, S.tut
// #tutorial asks KEYBOARD & MOUSE or CONTROLLER (prompts only, never which devices work); lessons run back to back (CONFIG.tutorial.lessons), checked once per frame (tutCheck)
// ways in: the Training card, the first Kick Off or League start (once, cfg.tutSeen), and REDO; TUT.back / TUT.cont remember where to go and what the player was doing
// finishing sets cfg.tutDone (a PLAYER key, never cleared); the achievement (ACHIEVEMENTS.md) reads it, so it's granted retroactively
const TUTC=CONFIG.tutorial;
const TUT={on:false,pending:false,kind:'kbm',i:0,t0:0,lastT:0,done:false,nextAt:0,fin:false,card:false,
 cont:null,contLbl:'',back:'training',offer:false,saved:null,hudBuilt:false,sig:'',
 // per-lesson progress (reset by tutGo)
 acc:0,lastOff:null,seen:null,raised:false,behind:false,chgT:-1,goals:0,servedAt:0,deadT:0,stuck:false};
function tutOn(){return !!(TUTC&&TUTC.on&&TUTC.lessons&&TUTC.lessons.length);}
function tutLesson(){return tutOn()?(TUTC.lessons[TUT.i]||null):null;}
function tutRod(){return (S.seats&&S.seats[0])?seatRod(S.seats[0]):null;}

// ---- ways in ----
// back: the screen to return to when it's over; cont: what to do after that (first-match only)
function tutOpen(back,cont,contLbl){
 if(!tutOn())return false;
 TUT.back=back||'training';TUT.cont=cont||null;TUT.contLbl=contLbl||'Play match';TUT.offer=!!cont;
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
 tutHint();
 tutGo(0);
 return true;
}
// the bottom hint speaks to the chosen device only (hud.js draws whichever of the two it's given)
function tutHint(){
 if(TUT.kind==='pad')hudHint(null,'{START} pause · {LB} {RB} switch rod\n{A} kick · {X} raise · {LT} touch · {RT}+{X} wind up');
 else{const H=bindHintRods(true,true);
  hudHint([bindJoin(['[ESC] pause',H.sw,H.slide]),H.act,H.mod].filter(Boolean).join('\n'),null);}
}
// set up lesson i: which of your rods are on the table (the opposition never is), which one you're handed, and the ball; a `keep` lesson carries a ball already pinned over
function tutGo(i){
 TUT.i=i;const L=tutLesson();
 if(!L){tutFinish();return;}
 const r0=tutRod(),keep=!!(L.keep&&r0&&r0.pinB);
 TUT.t0=S.time;TUT.lastT=S.time;TUT.done=false;TUT.nextAt=0;TUT.stuck=false;TUT.acc=0;TUT.lastOff=null;
 TUT.seen=[];TUT.raised=false;TUT.behind=false;TUT.goals=0;TUT.deadT=0;
 TRN.freeze=false;TRN.stepQ=0;TRN.score=false;TRN.deadball=false;TRN.ai=[false,false];TRN.ballType='classic';
 // your rods you aren't holding lift out of the way (as in a trial), except where a lesson needs one to receive
 TRN.lift=[L.lift!==false,false];
 rods.forEach((r,k)=>trnSetRodShown(k,r.team===0&&L.rods.indexOf(r.role)>=0));
 const s=S.seats[0];
 if(s){
  const mine=rods.filter(r=>r.team===0&&L.rods.indexOf(r.role)>=0).sort((a,b)=>a.x-b.x);
  const was=seatRod(s);
  s.rods=mine;s.ctrl=Math.max(0,mine.findIndex(r=>r.role===(L.start||L.rods[0])));
  if(was&&was!==seatRod(s))rodInputRelease(was);
  if(typeof updateChips==='function')updateChips();
 }
 const r=tutRod();
 TUT.chgT=(r&&r.chgEndT!=null)?r.chgEndT:-1;   // a charge released BEFORE this lesson must not count for it
 if(!keep){clearBalls();if(L.ball)tutServe();}
 S.stats=freshStats();S.lastTouch=-1;S.phase='play';
 TUT.sig='';tutHudSync();
}
// Put this lesson's ball down — and roll it, if the lesson rolls one at you.
function tutServe(){
 const L=tutLesson();if(!L||!L.ball)return;
 const b=trnPlace(L.ball.x,L.ball.z);
 b.v.set(L.ball.vx||0,0,L.ball.vz||0);
 TUT.servedAt=S.time;TUT.deadT=0;TUT.behind=false;
}
// has the player done what the lesson asks? once per frame; only SLIDE, SWITCH and RAISE accumulate anything of their own
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
 }
 return false;
}
// a ball that dies away from the lesson has to come back: a rolled ball is re-served once dead for a beat or run off behind the rod, a placed ball once at rest elsewhere
function tutKeepBall(L,r,dt){
 if(!L.ball)return;
 const b=S.balls[0];
 if(!b){tutServe();return;}
 if(b.pinR){TUT.deadT=0;return;}
 const sp=Math.hypot(b.v.x,b.v.z),away=Math.hypot(b.m.position.x-L.ball.x,b.m.position.z-(L.ball.z||0));
 if(sp<2&&(L.ball.vx||away>3))TUT.deadT+=dt;else TUT.deadT=0;
 const rel=r?(b.m.position.x-r.x)*r.kickDir:0;
 const lost=L.ball.vx?(TUT.deadT>=1.2||(L.check!=='raise'&&rel<-12)):TUT.deadT>=2.5;
 if(lost&&S.time-TUT.servedAt>1)tutServe();
}
// Once per frame, from trainingTick.
function tutTick(){
 if(!S.tut||TUT.fin)return;
 const L=tutLesson();if(!L)return;
 const dt=Math.max(0,S.time-TUT.lastT);TUT.lastT=S.time;
 const s=S.seats[0],r=tutRod();
 if(TUT.done){if(S.time>=TUT.nextAt)tutGo(TUT.i+1);return;}
 if(tutCheck(L,r,s)){
  TUT.done=true;TUT.nextAt=S.time+TUTC.nextDelay;
  Au.power();
 }else{
  tutKeepBall(L,r,dt);
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
 if(!cfg.tutDone){cfg.tutDone=true;saveCfg();}   // monotonic: the achievement reads this
 TRN.freeze=true;
 Au.goal('medal');if(typeof confetti==='function')confetti();
 TUT.sig='';tutHudSync();
}
// from trainingExit (gotoMenu): drop the gate, hide the chrome, give the sandbox its settings back
function tutExit(){
 S.tut=null;TUT.on=false;TUT.pending=false;TUT.fin=false;TUT.card=false;TUT.done=false;
 TRN.freeze=false;TRN.stepQ=0;
 if(TUT.saved){const v=TUT.saved;TRN.hidden=v.hidden;TRN.ai=v.ai;TRN.lift=v.lift;TRN.deadball=v.deadball;
  TRN.score=v.score;TRN.ballType=v.ballType;TUT.saved=null;}
 const h=$('tutHud');if(h)h.classList.add('hidden');
 const c=$('tutCard');if(c)c.classList.add('hidden');
}
// ---- the finish card's three ways out ----
function tutCardGo(){                    // CONTINUE into what the first match was for, or DONE
 Au.ui();const c=TUT.cont;TUT.cont=null;TUT.offer=false;
 S.fromScreen=TUT.back;gotoMenu();
 if(c)c();
}
function tutCardRedo(){Au.ui();S.fromScreen='tutorial';gotoMenu();}   // back to pick the controls again

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
  c.innerHTML='<div class="trlRes ok">TUTORIAL COMPLETE</div>'
   +'<div class="tutCardSub" id="tutCardSub"></div>'
   +'<div class="trlBtns"><button class="btn" id="tutCardGo"></button>'
   +'<button class="btn ghost" id="tutCardRedo">Redo</button></div>'
   +'<div class="trlKeys">Redo to try it with the other controls</div>';
  document.body.appendChild(c);
  $('tutCardGo').onclick=tutCardGo;
  $('tutCardRedo').onclick=tutCardRedo;
 }
 $('tutHud').classList.remove('hidden');
}
function tutHudSync(){
 if(!TUT.hudBuilt||!S.tut)return;
 const L=tutLesson(),n=TUTC.lessons.length;
 const sig=TUT.i+'|'+TUT.done+'|'+TUT.stuck+'|'+TUT.fin+'|'+TUT.kind+'|'+(TUT.cont?1:0);
 if(sig===TUT.sig)return;
 TUT.sig=sig;
 $('tutHud').classList.toggle('hidden',TUT.fin);
 const card=$('tutCard');card.classList.toggle('hidden',!TUT.card);
 if(TUT.card){
  $('tutCardGo').textContent=TUT.cont?TUT.contLbl:'Done';
  $('tutCardSub').textContent=TUT.cont?'You know the moves. Now play one.':'You know the moves.';
  return;
 }
 if(!L)return;
 $('tutStep').textContent='LESSON '+(TUT.i+1)+' / '+n;
 const nm=$('tutName');nm.textContent=TUT.done?L.name+' · DONE':L.name;nm.classList.toggle('ok',TUT.done);
 $('tutTxt').innerHTML=tutText(TUT.kind==='pad'?L.pad:L.kbm,TUT.kind);
 let dots='';for(let k=0;k<n;k++)dots+='<i class="'+(k<TUT.i||(k===TUT.i&&TUT.done)?'on':k===TUT.i?'cur':'')+'"></i>';
 $('tutDots').innerHTML=dots;
 const st=$('tutStuck');st.classList.toggle('hidden',!TUT.stuck||TUT.done);
 if(TUT.stuck)st.innerHTML='Stuck? '+tutText(TUT.kind==='pad'?'{VIEW} skips this lesson':'[retry] skips this lesson',TUT.kind);
 if(TUT.kind==='pad'&&typeof padLabels==='function')padLabels();
}

// ---- #tutorial: pick the controls ----
SCREENS.tutorial.onShow=()=>{
 const again=!!cfg.tutDone;
 $('tutTitle').textContent=TUT.offer&&!again?'FIRST MATCH?':'TUTORIAL';
 $('tutTag').textContent=TUT.offer&&!again?'Learn the controls first · about a minute':'Learn the controls · about a minute';
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
 const card=$('btnTrnTutorial');if(card&&!tutOn())card.classList.add('hidden');
})();
// the retry key skips a lesson once offered; owned here so a missing tutorial.js can't change any key
addEventListener('keydown',e=>{
 if(!S.tut||S.photo)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(typeof bindIs==='function'?bindIs('retry',e.code):e.code==='KeyR'){if(tutSkip())e.preventDefault();}
});
