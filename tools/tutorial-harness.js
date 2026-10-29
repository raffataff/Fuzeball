// tutorial harness. node tools/tutorial-harness.js
// the tutorial's two courses (CONFIG.tutorial.lessons / .advanced), its text off the live bindings, the advanced checks (forward pin, receive, pin pass, tic-tac, walk), the ball keeping, the lesson set-up and the finish card
// runs the whole of js/tutorial.js and js/binds.js on live CONFIG with plain-object rods, balls and a stub DOM; slices userControlUpdate (input.js) for the lesson's own auto-switch
// the moves themselves are played on the real sim by tools/tutorial-soak.js
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var EL={};function elNew(id){const cl=new Set(),e={id:id||'',textContent:'',_h:'',writes:0,style:{},dataset:{},onclick:null,",
" classList:{add:c=>cl.add(c),remove:c=>cl.delete(c),contains:c=>cl.has(c),toggle:(c,on)=>{if(on===undefined)on=!cl.has(c);if(on)cl.add(c);else cl.delete(c);}}};",
" Object.defineProperty(e,'innerHTML',{get(){return e._h;},set(v){e._h=String(v);e.writes++;}});return e;}",
"var document={getElementById:id=>EL[id]||(EL[id]=elNew(id)),createElement:()=>elNew(''),body:{appendChild:e=>{if(e.id)EL[e.id]=e;}}};",
"var LISTEN=[];function addEventListener(t,f){LISTEN.push(t);}",
"var keys={};function seatForDev(d){return S.seats[0]||null;}function shotsOn(){return true;}",
"var S={time:0,seats:[],balls:[],phase:'play',lastSwitch:0,stats:null,lastTouch:-1,tut:null,photo:false,freeRoam:false};",
"var rods=[];var TRN={hidden:[],ai:[false,false],lift:[false,false],freeze:false,stepQ:0,deadball:false,score:false,ballType:'classic'};",
"var SCREENS={tutorial:{}};var SHOWN=[];function showScreen(id){SHOWN.push(id);}function screenId(){return 'home';}",
"var STARTS=[];function startMatch(m){STARTS.push(m);}function gotoMenu(){}function confetti(){}",
"var HINTS=[];function hudHint(k,p){HINTS.push([k,p]);}",
"var Au={init(){},ui(){},power(){},goal(){}};",
"function seatRod(s){return s&&s.rods&&s.rods.length?s.rods[s.ctrl||0]:null;}",
"function trnSetRodShown(k,v){const r=rods[k];if(r){r.trnHidden=!v;TRN.hidden[k]=!v;}}",
"function rodInputRelease(){}function freshStats(){return {passes:[0,0]};}",
"function clearBalls(){for(const b of S.balls)for(const r of rods)if(r.pinB===b)r.pinB=null;S.balls.length=0;}",
"function mkBall(x,z){return {m:{position:{x:x,y:BALL_R,z:z}},v:{x:0,y:0,z:0,set(a,b,c){this.x=a;this.y=b;this.z=c;}},pinR:null,scored:false};}",
"function trnPlace(x,z){let b=S.balls[0];if(!b){b=mkBall(x,z);S.balls.push(b);}else{b.m.position.x=x;b.m.position.z=z;b.m.position.y=BALL_R;b.v.set(0,0,0);}return b;}",
// input.js userControlUpdate's neighbours
"function seatSlideOK(){return true;}function zonePick(){return -1;}function autoHoldRod(){return false;}function rodTaken(){return false;}",
"function clearRodAI(){}function updateChips(){}function rodHoldRaise(){return false;}",
"function focusBall(){return S.balls[0]||null;}"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(TUTJS,INPUT,BINDS){
 const real=[
  slice(rd('js/ai.js'),'function manLive(r,i){','\n'),
  BINDS,
  slice(INPUT,'function userControlUpdate(dt){','// ---- gamepad'),
  TUTJS].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Number,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={C:CONFIG,S:S,cfg:cfg,TUT:TUT,TUTC:TUTC,TRN:TRN,EL:EL,HINTS:HINTS,STARTS:STARTS,SHOWN:SHOWN,rods:rods,mkBall:mkBall,BALL_R:BALL_R,FB:FOOT_BOX,'+
  'tutOpen:tutOpen,tutOffer:tutOffer,tutList:tutList,tutLesson:tutLesson,tutArm:tutArm,tutGo:tutGo,tutTick:tutTick,tutCheck:tutCheck,tutKeepBall:tutKeepBall,tutServe:tutServe,'+
  'tutText:tutText,tutHudSync:tutHudSync,tutHint:tutHint,tutFinish:tutFinish,tutExit:tutExit,tutCardAdvanced:tutCardAdvanced,tutRod:tutRod,tutHome:tutHome,tutTo:tutTo,'+
  'bindSet:bindSet,bindReset:bindReset,userControlUpdate:userControlUpdate,SCREENS:SCREENS,'+
  'setRods:function(a){rods.length=0;for(const r of a)rods.push(r);}};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.C)throw new Error('export line did not run');
 return ctx.X;
}

/* ---- a tiny table ---- */
const C0=JSON.parse(JSON.stringify(require('vm').runInNewContext(rd('js/config.js').split('const F=CONFIG.table;')[0]+';CONFIG',{Math,localStorage:{getItem:()=>null,setItem:()=>{}}})));
const SP=C0.rods.spacing,MARGIN=C0.rods.margin,W=C0.table.W;
function rodOf(d){
 const n=d.men,s=n===2?SP.two:n===3?SP.three:SP.other,bz=[];for(let i=0;i<n;i++)bz.push((i-(n-1)/2)*s);
 return {role:d.role,team:d.team,x:d.x,kickDir:d.team===0?1:-1,baseZ:bz,offset:0,target:0,prevOffset:0,iOff:0,iPrevOff:0,slideV:0,vz:0,
  maxOff:d.slideCap||(W-MARGIN-(n-1)*s)/2,removedUntil:[],pivot:{position:{z:0},visible:true},angle:0,pinB:null,pinFwd:false,trnHidden:false};
}
function fresh(X){
 const rs=C0.rods.defs.map(rodOf);X.setRods(rs);
 X.S.time=10;X.S.balls.length=0;X.S.seats.length=0;X.S.seats.push({team:0,rods:[],ctrl:0});X.S.tut=null;X.S.lastSwitch=0;X.S.stats=null;
 X.cfg.auto=true;X.cfg.tutDone=false;X.cfg.tutSeen=false;X.cfg.keyBinds={};
 X.TUT.pending=false;X.TUT.saved=null;X.TUT.cont=null;X.TUT.kind='kbm';X.TUT.course='basic';X.TUT.fin=false;X.TUT.card=false;X.TUT.auto=false;
 X.HINTS.length=0;X.STARTS.length=0;X.SHOWN.length=0;
 return rs;
}
const role=(X,ro)=>X.rods.find(r=>r.team===0&&r.role===ro);
const idx=(X,list,id)=>list.findIndex(L=>L.id===id);
// arm a course at lesson `id`, as tutBegin + trainingEnter would
function arm(X,course,id,kind){
 X.TUT.course=course;X.TUT.kind=kind||'kbm';X.TUT.pending=true;X.tutArm();
 const i=idx(X,X.tutList(),id);if(i>0)X.tutGo(i);
 return X.tutLesson();
}
function step(X,dt){X.S.time+=dt;X.tutTick();}

function suite(X,quiet){
 const T=X.TUTC,B=X.TUT;let rs,L,r,b,s;

 /* 1. the lesson plan itself */
 const caseSet=new Set([...TUTJS_SRC.match(/function tutCheck\([\s\S]*?\n}\n/)[0].matchAll(/case '(\w+)'/g)].map(m=>m[1]));
 const acts=new Set(Object.keys(X.C.binds.def).concat(['mouse']));
 const padNav=rd('js/padnav.js'),padKeys=new Set([...slice(padNav,'const PAD_GLYPH={','};').matchAll(/(\w+):\{/g)].map(m=>m[1]).concat([...slice(padNav,'const PAD_ANY={','};').matchAll(/(\w+):\{/g)].map(m=>m[1])));
 for(const [nm,list] of [['basic',T.lessons],['advanced',T.advanced]]){
  ok(Array.isArray(list)&&list.length>0,nm+': the course has lessons');
  ok(new Set(list.map(l=>l.id)).size===list.length,nm+': lesson ids are unique');
  for(const l of list){
   ok(caseSet.has(l.check),nm+'/'+l.id+': its check "'+l.check+'" is one tutCheck knows');
   ok(l.name&&l.kbm&&l.pad&&l.rods&&l.rods.length,nm+'/'+l.id+': name, both texts and rods');
   for(const m of l.kbm.matchAll(/\[(\w+)\]/g))ok(acts.has(m[1]),nm+'/'+l.id+': [' +m[1]+'] is a bindable action');
   for(const m of l.pad.matchAll(/\{([A-Z+\/]+)\}/g))for(const k of m[1].split(/[+\/]/))ok(padKeys.has(k),nm+'/'+l.id+': {'+k+'} is a pad glyph');
   if(l.ball){ok(Math.abs(l.ball.z||0)<W/2-X.BALL_R&&Math.abs(l.ball.x)<C0.table.L/2,nm+'/'+l.id+': its ball is on the table');}
  }
 }
 for(const l of T.advanced){
  ok(l.centre===true,'advanced/'+l.id+': its rods start centred');
  const d=C0.rods.defs.find(q=>q.team===0&&q.role===(l.start||l.rods[0])),h=rodOf(d);
  // a ball put down at rest must be clear of every man of its rod at the centre: in a man's lane it would land inside his foot (or under a raise)
  if(l.ball&&!l.ball.vx&&(l.check==='tictac'||l.check==='walk'))
   ok(h.baseZ.every(z=>Math.abs(l.ball.z-z)>=X.FB.z+X.BALL_R+0.5),'advanced/'+l.id+': its ball lies beside the men, not in a lane');
  if(l.auto)ok(l.rods.length===2&&l.start,'advanced/'+l.id+': an auto lesson passes from its start rod to the other');
 }

 /* 2. the courses */
 fresh(X);X.tutOpen('training');ok(B.course==='basic'&&X.tutList()===T.lessons,'the Tutorial card opens the basics');
 X.tutOpen('training',null,null,'adv');ok(B.course==='adv'&&X.tutList()===T.advanced,'the Advanced card opens the advanced course');
 ok(X.SHOWN[X.SHOWN.length-1]==='tutorial','...on the control picker');
 X.cfg.tutSeen=false;X.tutOffer(()=>{},'Play match');ok(B.course==='basic','the first-match offer is always the basics');
 X.tutOpen('training',null,null,'adv');X.SCREENS.tutorial.onShow();
 ok(X.EL.tutTitle.textContent==='ADVANCED MOVES'&&/tic-tac/.test(X.EL.tutTag.textContent),'the picker is titled for the advanced course');
 X.tutOpen('training');X.SCREENS.tutorial.onShow();ok(X.EL.tutTitle.textContent==='TUTORIAL','...and for the basics');
 X.cfg.tutDone=false;X.tutOpen('home',()=>{},'Play match');X.SCREENS.tutorial.onShow();ok(X.EL.tutTitle.textContent==='FIRST MATCH?','...and as the first-match offer');

 /* 3. text off the bindings */
 fresh(X);
 ok(/>R-CTRL</.test(X.tutText('[finesse]','kbm')),'finesse reads its default key');
 ok(/>SPACE<.*tutKey m">LMB</.test(X.tutText('[kick]','kbm')),'kick reads its first key and its first mouse button');
 X.bindSet('finesse',['KeyZ']);ok(/>Z</.test(X.tutText('[finesse]','kbm'))&&!/R-CTRL/.test(X.tutText('[finesse]','kbm')),'a rebind is what the text says');
 X.bindSet('kick',[]);ok(/UNBOUND/.test(X.tutText('[kick]','kbm')),'an unbound action says so');
 X.bindReset();ok(/>R-CTRL</.test(X.tutText('[finesse]','kbm')),'reset to defaults reads the defaults again');
 ok(/data-pad="LT"/.test(X.tutText('{LT}','pad'))&&!/R-CTRL/.test(X.tutText('{LT} [finesse]','pad')),'a pad lesson reads glyphs, never keys');

 // the live panel: rebuilt when a key moves, left alone when nothing changed
 fresh(X);L=arm(X,'adv','fwdPin');step(X,1/60);
 const tx=X.EL.tutTxt,w0=tx.writes;
 ok(/>R-CTRL</.test(tx.innerHTML),'the lesson panel shows the finesse key');
 step(X,1/60);step(X,1/60);ok(tx.writes===w0,'no rebind, no rewrite');
 X.bindSet('finesse',['KeyZ']);step(X,1/60);
 ok(/>Z</.test(tx.innerHTML)&&!/R-CTRL/.test(tx.innerHTML),'a key rebound mid-lesson shows on the next frame');
 // the bottom hint: handed over once, again only when it changes
 const h0=X.HINTS.length;step(X,1/60);step(X,1/60);
 ok(X.HINTS.length===h0,'the bottom hint is not handed over again while it is the same');
 X.bindSet('raise',['KeyV']);step(X,1/60);
 ok(X.HINTS.length===h0+1&&/\[V\]/.test(X.HINTS[X.HINTS.length-1][0]),'a rebind hands the hint over with the new key');
 B.stuck=true;step(X,1/60);ok(/>R</.test(X.EL.tutStuck.innerHTML),'the skip line reads the retry key');
 X.bindSet('retry',['KeyY']);step(X,1/60);ok(/>Y</.test(X.EL.tutStuck.innerHTML),'...and follows its rebind');
 fresh(X);arm(X,'adv','fwdPin','pad');step(X,1/60);
 const ph=X.HINTS[X.HINTS.length-1];ok(ph&&ph[0]===null&&/\{LT\}\+\{A\} forward pin/.test(ph[1])&&/\{LT\}\+\{X\} pin/.test(ph[1]),'the pad hint names the pin and the forward pin');

 /* 4. the checks */
 // forward pin: a ball held under the forward leg, not the back pin
 fresh(X);L=arm(X,'adv','fwdPin');r=X.tutRod();b=X.S.balls[0];
 ok(r.role==='ATT'&&b&&Math.abs(b.m.position.x-L.ball.x)<1e-9,'FORWARD PIN: the attack holds, the ball is down');
 r.pinB=b;r.pinFwd=false;ok(!X.tutCheck(L,r,X.S.seats[0]),'a back pin is not the forward pin');
 r.pinFwd=true;ok(X.tutCheck(L,r,X.S.seats[0]),'held under the forward leg: done');
 // receive: only the rod passed to holding it counts
 fresh(X);L=arm(X,'adv','recv');r=X.tutRod();
 ok(r.role==='MID'&&X.tutTo(L).role==='ATT','PASS AND RECEIVE: the midfield passes to the attack');
 r.pinB=X.S.balls[0];ok(!X.tutCheck(L,r,X.S.seats[0]),'the passer pinning it is not a receive');r.pinB=null;
 role(X,'ATT').pinB=X.S.balls[0];ok(X.tutCheck(L,X.tutRod(),X.S.seats[0]),'the attack has it on the pin: done');
 // pin pass: the passer pins first, then the receiver
 fresh(X);L=arm(X,'adv','pinPass');const mid=role(X,'MID'),att=role(X,'ATT');b=X.S.balls[0];
 att.pinB=b;ok(!X.tutCheck(L,X.tutRod(),X.S.seats[0]),'PIN PASS: the attack holding it without the midfield pinning it first is not it');att.pinB=null;
 mid.pinB=b;ok(!X.tutCheck(L,X.tutRod(),X.S.seats[0]),'the midfield pin alone is not it');mid.pinB=null;
 att.pinB=b;ok(X.tutCheck(L,X.tutRod(),X.S.seats[0]),'pinned, passed, pinned by the attack: done');
 // tic-tac: touches along the row, each by the other man
 fresh(X);L=arm(X,'adv','tictac');r=X.tutRod();b=X.S.balls[0];s=X.S.seats[0];
 const tt=(z,vz,vx,rel,y)=>{b.m.position.z=z;b.v.z=vz;b.v.x=vx||0;b.m.position.x=r.x+(rel==null?-1.5:rel)*r.kickDir;b.m.position.y=y==null?X.BALL_R:y;return X.tutCheck(L,r,s);};
 const m1=r.baseZ[1],m2=r.baseZ[2];
 ok(Math.abs(b.m.position.z-L.ball.z)<1e-9&&b.m.position.z>m1&&b.m.position.z<m2,'TIC-TAC: the ball lies between two men');
 tt(m1+3.3,27);ok(B.acc===1&&B.prog==='1 / '+T.ttTouches,'a tap along the row is a touch, shown as progress');
 tt(m1+9,27);ok(B.acc===1,'still rolling the same way: no new touch');
 tt(m2-3.3,-27);ok(B.acc===2,'tapped back by the other man: two');
 tt(m2-3.3,0);tt(m2-3.3,-27);ok(B.acc===1,'the same man again after it stopped starts the count again');
 tt(m1+3.3,27);tt(m2-3.3,-27);tt(m1+3.3,27);ok(B.acc===4&&tt(m1+3.3,27),'four in a row, alternating: done');
 fresh(X);L=arm(X,'adv','tictac');r=X.tutRod();b=X.S.balls[0];s=X.S.seats[0];
 tt(m1+3.3,27);tt(m2-3.3,-27);tt(m2-3.3,-27,0,T.rowBand+1);ok(B.acc===0,'off the row starts again');
 tt(m1+3.3,27);tt(m2-3.3,-27,0,-1.5,X.BALL_R+2);ok(B.acc===0,'a ball in the air starts again');
 tt(m1+3.3,27);b.pinR=r;tt(m2-3.3,-27);ok(B.acc===0,'a pinned ball starts again');b.pinR=null;
 tt(m1+3.3,T.ttV*0.6);ok(B.acc===0,'too slow along the row is not a touch');
 tt(m1+3.3,8,40);ok(B.acc===0,'a ball sent up the table is not a touch along the row');
 // walk: every man of the rod has held it
 fresh(X);L=arm(X,'adv','walk');r=X.tutRod();b=X.S.balls[0];s=X.S.seats[0];
 const pinAt=i=>{b.m.position.z=r.baseZ[i]+r.offset+0.2;r.pinB=b;const d=X.tutCheck(L,r,s);r.pinB=null;X.tutCheck(L,r,s);return d;};
 ok(!X.tutCheck(L,r,s)&&B.prog==='0 / 3','WALK: nothing held yet, 0 of 3');
 ok(!pinAt(2)&&B.prog==='1 / 3','one man has held it');
 ok(!pinAt(2)&&B.prog==='1 / 3','the same man again is still one');
 ok(!pinAt(1)&&pinAt(0)&&B.prog==='3 / 3','all three: done');
 fresh(X);L=arm(X,'adv','walk');r=X.tutRod();b=X.S.balls[0];s=X.S.seats[0];
 r.removedUntil[0]=X.S.time+99;ok(!pinAt(2)&&pinAt(1)&&B.prog==='2 / 2','a man knocked off the table is not asked for');

 /* 5. keeping the ball */
 // a row lesson's ball lying along the rod stays for rowIdle, then comes back
 fresh(X);L=arm(X,'adv','tictac');r=X.tutRod();b=X.S.balls[0];
 b.m.position.z=r.baseZ[2]-3.3;const z0=b.m.position.z;
 for(let t=0;t<4;t+=0.1)X.tutKeepBall(L,0.1),X.S.time+=0.1;
 ok(Math.abs(b.m.position.z-z0)<1e-9,'TIC-TAC: a ball at rest against a man is not re-served after 4 s');
 for(let t=0;t<T.rowIdle;t+=0.1)X.tutKeepBall(L,0.1),X.S.time+=0.1;
 ok(Math.abs(b.m.position.z-L.ball.z)<1e-9,'...it is after lying there rowIdle');
 // zRod: put down between the same two men wherever the rod is
 r.offset=4;X.tutServe();ok(Math.abs(b.m.position.z-(L.ball.z+4))<1e-9,'a re-serve follows the rod: between the same two men');r.offset=0;
 // a lesson off the row is re-served once at rest elsewhere
 fresh(X);L=arm(X,'adv','fwdPin');b=X.S.balls[0];b.m.position.z=10;
 for(let t=0;t<3;t+=0.1)X.tutKeepBall(L,0.1),X.S.time+=0.1;
 ok(Math.abs(b.m.position.z-L.ball.z)<1e-9,'FORWARD PIN: a ball at rest elsewhere comes back after 2.5 s');
 // a rolled ball is judged from the lesson's rod, not the one the seat has been handed
 fresh(X);L=arm(X,'adv','pinPass');b=X.S.balls[0];
 X.S.seats[0].ctrl=1;ok(X.tutRod().role==='ATT','PIN PASS: the seat has been handed the attack');
 b.m.position.x=10;b.v.x=110;X.S.time+=2;X.tutKeepBall(L,1/60);
 ok(b.v.x===110&&b.m.position.x===10,'a pass on its way up is not re-served for being behind the attack');
 b.m.position.x=role(X,'MID').x-13;b.v.x=-15;X.tutKeepBall(L,1/60);
 ok(b.m.position.x===L.ball.x,'a ball run off behind the midfield is re-served');

 /* 6. setting a lesson up */
 fresh(X);role(X,'ATT').offset=7;role(X,'ATT').target=7;role(X,'ATT').pivot.position.z=7;L=arm(X,'adv','tictac');r=X.tutRod();
 ok(r.offset===0&&r.target===0&&r.pivot.position.z===0&&r.iOff===0&&r.iPrevOff===0,'a centre lesson starts its rod in the middle');
 fresh(X);role(X,'ATT').offset=7;role(X,'ATT').target=7;arm(X,'basic','pin');
 ok(role(X,'ATT').offset===7,'a basic lesson leaves the rod where it is');
 fresh(X);X.S.lastSwitch=X.S.time;arm(X,'adv','recv');
 ok(B.auto===true&&X.S.time-X.S.lastSwitch>X.C.control.autoDelay,'an auto lesson switches on its hand-over, at once');
 arm(X,'adv','tictac');ok(B.auto===false,'...and a lesson without it does not');
 arm(X,'adv','recv');X.tutExit();ok(B.auto===false&&X.S.tut===null,'leaving the tutorial lets go of it');
 // the hand-over itself (input.js): the lesson's switch works whatever Options says
 fresh(X);L=arm(X,'adv','recv');X.cfg.auto=false;X.S.lastSwitch=-1e9;
 b=X.S.balls[0];b.m.position.x=role(X,'ATT').x-3;
 X.userControlUpdate(1/120);ok(X.tutRod().role==='ATT','with auto-switch off in Options, the lesson still hands the attack over');
 X.S.tut=null;X.S.seats[0].ctrl=0;X.userControlUpdate(1/120);ok(X.tutRod().role==='MID','...outside the tutorial it does not');
 fresh(X);L=arm(X,'basic','pass');X.cfg.auto=false;X.S.lastSwitch=-1e9;
 X.S.balls[0].m.position.x=role(X,'ATT').x-3;X.userControlUpdate(1/120);ok(X.tutRod().role==='MID','a lesson without it follows Options (off: no hand-over)');

 /* 7. finishing */
 fresh(X);arm(X,'basic','slide');X.tutFinish();
 ok(X.cfg.tutDone===true,'finishing the basics marks the tutorial done');
 ok(/TUTORIAL COMPLETE/.test(X.EL.tutCardRes.textContent)&&!X.EL.tutCardAdv.classList.contains('hidden'),'the basics from Training offer the advanced moves next');
 fresh(X);X.TUT.cont=()=>{};arm(X,'basic','slide');X.tutFinish();
 ok(X.EL.tutCardAdv.classList.contains('hidden'),'...not when a first match is waiting');
 fresh(X);arm(X,'adv','fwdPin');X.tutFinish();
 ok(X.cfg.tutDone===false,'the advanced course is not what the achievement reads');
 ok(/ADVANCED MOVES COMPLETE/.test(X.EL.tutCardRes.textContent)&&X.EL.tutCardAdv.classList.contains('hidden'),'its card says so and offers nothing further');
 fresh(X);X.TUT.kind='pad';arm(X,'basic','slide','pad');X.tutFinish();X.STARTS.length=0;X.tutCardAdvanced();
 ok(B.course==='adv'&&B.kind==='pad'&&B.pending&&X.STARTS[0]==='training','ADVANCED MOVES from the card starts that course on the same controls');
 X.tutArm();ok(X.tutLesson()&&X.tutLesson().id===X.TUTC.advanced[0].id&&!B.card,'...from its first lesson');

 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const TUTJS_SRC=rd('js/tutorial.js'),INPUT=rd('js/input.js'),BINDS=rd('js/binds.js');
const base=suite(boot(TUTJS_SRC,INPUT,BINDS),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['tut','TUT.acc=m!==TUT.lastMan?TUT.acc+1:1;','TUT.acc++;','tic-tac counts the same man twice'],
 ['tut','if(Math.abs(rel)>TUTC.rowBand||p.y>BALL_R+1||b.pinR)','if(p.y>BALL_R+1||b.pinR)','tic-tac keeps counting off the row'],
 ['tut','(Math.abs(vz)>=TUTC.ttV&&Math.abs(vz)>2*Math.abs(b.v.x))','(Math.abs(vz)>2*Math.abs(b.v.x))','a crawl along the row is a touch'],
 ['tut','(Math.abs(vz)>=TUTC.ttV&&Math.abs(vz)>2*Math.abs(b.v.x))','(Math.abs(vz)>=TUTC.ttV)','a ball sent up the table is a touch'],
 ['tut','if(m>=0&&TUT.seen.indexOf(m)<0)TUT.seen.push(m);','if(m>=0)TUT.seen.push(m);','the walk counts pins, not men'],
 ['tut','case \'fwdPin\':return !!(r&&r.pinB&&r.pinFwd);','case \'fwdPin\':return !!(r&&r.pinB);','a back pin passes the forward pin'],
 ['tut','case \'recv\':{const q=tutTo(L);','case \'recv\':{const q=r;','the passer pinning it passes the receive'],
 ['tut','return TUT.mark&&!!(q&&q.pinB);','return !!(q&&q.pinB);','the pin pass needs no pin'],
 ['tut','TUT.deadT>=(row?TUTC.rowIdle:2.5)','TUT.deadT>=2.5','a ball worked along the row is taken away'],
 ['tut','const h=tutHome(L),sp=','const h=tutRod(),sp=','a pass on its way is re-served once the seat moves on'],
 ['tut','(L.ball.z||0)+(h?h.offset:0)','(L.ball.z||0)','a re-serve lands on a man once the rod has slid'],
 ['tut','if(L.centre&&!keep)','if(false)','lessons start with the rod wherever it was'],
 ['tut','if(L.centre&&!keep)','if(!keep)','every lesson snaps its rods to the middle'],
 ['tut',' TUT.auto=!!L.auto;\n',' ','the receive lessons have no hand-over'],
 ['tut',' if(L.auto)S.lastSwitch=-1e9;',' ','the hand-over waits out the last switch'],
 ['tut',"+'|'+TUT.prog+'|'+txt+'|'+stk;","+'|'+TUT.prog;",'a rebind mid-lesson leaves the old key on screen'],
 ['tut',' if(k===TUT.hintK&&p===TUT.hintP)return;\n',' ','the bottom hint restarts its fade every frame'],
 ['tut',' tutHint();\n if(TUT.done)',' if(TUT.done)','the bottom hint keeps the old key after a rebind'],
 ['tut','{LT}+{X} pin · {LT}+{A} forward pin','{LT}+{X} pin','the pad hint leaves out the forward pin'],
 ['tut',"if(TUT.course!=='adv'&&!cfg.tutDone)",'if(!cfg.tutDone)','the advanced course grants the tutorial achievement'],
 ['tut',"$('tutCardAdv').classList.toggle('hidden',adv||!!TUT.cont||!tutAdvOn());","$('tutCardAdv').classList.toggle('hidden',adv);",'a first match waiting still offers the advanced course'],
 ['tut',"TUT.course=course==='adv'&&tutAdvOn()?'adv':'basic';","TUT.course='basic';",'the Advanced card opens the basics'],
 ['tut',"function tutCardAdvanced(){TUT.course='adv';","function tutCardAdvanced(){",'the card\'s Advanced moves runs the basics again'],
 ['tut','S.tut=null;TUT.on=false;TUT.pending=false;TUT.fin=false;TUT.card=false;TUT.done=false;TUT.auto=false;','S.tut=null;TUT.on=false;TUT.pending=false;TUT.fin=false;TUT.card=false;TUT.done=false;','leaving keeps the lesson\'s hand-over on'],
 ['tut',"const l=(typeof bindList==='function')?bindList(act):[];","const l=BINDC.def[act]||[];",'the lesson text reads the default keys'],
 ['tut',"$('tutTitle').textContent=adv?'ADVANCED MOVES':","$('tutTitle').textContent=",'the advanced picker is titled TUTORIAL'],
 ['input','if((cfg.auto||(S.tut&&S.tut.auto))&&','if(cfg.auto&&','the lesson cannot switch the hand-over on'],
 ['input','if((cfg.auto||(S.tut&&S.tut.auto))&&','if((cfg.auto||S.tut)&&','every tutorial lesson hands rods over']
];
let caught=0;
for(const [file,find,repl,name] of muts){
 const src=file==='tut'?TUTJS_SRC:INPUT;
 if(src.indexOf(find)<0){console.log('  BROKEN  '+name+' — anchor not found');continue;}
 const m=src.replace(find,repl);
 if(m===src){console.log('  BROKEN  '+name+' — no-op');continue;}
 pass=0;fail=0;fails.length=0;
 let f;try{f=suite(boot(file==='tut'?m:TUTJS_SRC,file==='input'?m:INPUT,BINDS),true);}catch(e){f=1;}
 if(f>0){caught++;console.log('  caught  ('+f+' assertions)  '+name);}
 else console.log('  SURVIVED  '+name);
}
console.log('mutations caught: '+caught+'/'+muts.length);
process.exitCode=(base>0||caught<muts.length)?1:0;
