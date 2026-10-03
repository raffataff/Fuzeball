// pin hint harness. node tools/pinhint-harness.js
// what the pin shows the player (CONFIG.shots.pin.mark / .hint, cfg.pinHint): the ring under a caught ball (fx.js pinMarkUpdate) and the kick plate (hud.js hudPinHint)
// slices the real shotPinBall / shotPinSeat / shotPinHintOn (shots.js), pinMarkUpdate (fx.js), hudPinHint + hudTok (hud.js) and runs them on live CONFIG with plain-object seats, rods, balls and a recording canvas
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=src.indexOf(to,a);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var S={time:0,phase:'play',seats:[],tut:null};var SHOTC=CONFIG.shots;var pinRings=[];",
"function seatRod(s){return s&&s.rods&&s.rods.length?s.rods[s.ctrl||0]:null;}",
"function seatCol(s){return s.col;}",
"var PADNOW=false,BIND=true;function hudPadNow(){return PADNOW;}function bindHint(a,w,n){return BIND?'[SPACE] [LMB] '+w:'';}",
"var LINES=[];var HUD={t:0,W:1280,H:800,u:1,chipY:755,pin:{a:0,on:false,t:-9,s:null,tok:null,tokP:null},x:{globalAlpha:1,fillStyle:'',fillRect:function(){},fill:function(){}}};",
"function hudPar(){}function hudCol(c){return c;}function hudLineW(){return 120;}",
"function hudLine(L,x,cy,u,col){LINES.push({L:L,alpha:HUD.x.globalAlpha,x:x,cy:cy});}"
].join(NL);

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(SHOTS,FX,HUDJS){
 const real=[
  slice(SHOTS,'function shotsOn(){','\n'),
  slice(SHOTS,'function shotPinBall(s){','const SHOT_CURVE_KEYS'),
  slice(FX,'function pinMarkUpdate(rdt){','function spawnTrail('),
  slice(HUDJS,'const hC=','\n'),
  slice(HUDJS,'function hudTok(src){','const HUD_GLYPH'),
  slice(HUDJS,'function hudPinHint(a,rdt){','function hudNotice(){')].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={C:CONFIG,S:S,cfg:cfg,HUD:HUD,LINES:LINES,setPad:function(v){PADNOW=v;},setBind:function(v){BIND=v;},'+
  'shotPinBall:shotPinBall,shotPinSeat:shotPinSeat,shotPinHintOn:shotPinHintOn,pinMarkUpdate:pinMarkUpdate,hudPinHint:hudPinHint,'+
  'setRings:function(a){pinRings=a;}};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.C)throw new Error('export line did not run');
 return ctx.X;
}

/* ---- a tiny match ---- */
const ring=()=>({visible:false,userData:{a:0,x:0,z:0,col:null},position:{x:0,y:0,z:0,set(a,b,c){this.x=a;this.y=b;this.z=c;}},
 scale:{v:0,setScalar(v){this.v=v;}},material:{opacity:0,color:{c:null,set(c){this.c=c;}}}});
const ball=(x,z)=>({m:{position:{x:x,z:z}},scored:false});
const seat=(col,devs,rod)=>({col:col,devs:devs,rods:[rod],ctrl:0});
const rodOf=b=>({pinB:b||null});
function fresh(X,seats){
 X.S.seats=seats;X.S.phase='play';X.S.tut=null;X.S.time=0;X.cfg.pinHint=true;
 X.C.shots.on=true;X.C.shots.pin.on=true;X.C.shots.pin.mark.on=true;X.C.shots.pin.hint.on=true;
 X.setPad(false);X.setBind(true);X.LINES.length=0;
 const P=X.HUD.pin;P.a=0;P.on=false;P.t=-9;P.s=null;P.tok=null;P.tokP=null;X.HUD.t=0;X.HUD.x.globalAlpha=1;
 const rings=seats.map(ring);X.setRings(rings);return rings;
}
// one HUD frame at dt, advancing the HUD clock
function frame(X,dt,a){X.HUD.t+=dt;X.hudPinHint(a==null?1:a,dt);}
const caps=L=>L.filter(k=>k.cap).map(k=>k.cap).join('+'),pads=L=>L.filter(k=>k.pad).map(k=>k.pad).join('+'),words=L=>L.filter(k=>k.t).map(k=>k.t).join(' ');

function suite(X,quiet){
 const M=X.C.shots.pin.mark,H=X.C.shots.pin.hint;let rs,b,s,r;

 /* 1. who has a ball */
 b=ball(5,2);r=rodOf(b);s=seat('#f00',['kbd','mouse'],r);fresh(X,[s]);
 ok(X.shotPinBall(s)===b,'a seat whose rod holds a ball on the pin has it');
 ok(X.shotPinBall(seat('#f00',['kbd'],rodOf()))===null,'a rod with nothing pinned has none');
 ok(X.shotPinBall(null)===null,'no seat, no ball');
 ok(X.shotPinBall({col:'#f00',devs:[],rods:[],ctrl:0})===null,'a seat with no rod has none');
 b.scored=true;ok(X.shotPinBall(s)===null,'a scored ball is not a caught ball');b.scored=false;
 const s2=seat('#0f0',['pad*'],rodOf(ball(1,1)));fresh(X,[seat('#f00',['kbd'],rodOf()),s2]);
 ok(X.shotPinSeat()===s2,'the seat that holds the pinned ball is the one found');
 fresh(X,[seat('#f00',['kbd'],rodOf())]);ok(X.shotPinSeat()===null,'nobody pinned: no seat');

 /* 2. when the plate may show */
 fresh(X,[s]);ok(X.shotPinHintOn(),'live play, hint on: shown');
 X.cfg.pinHint=false;ok(!X.shotPinHintOn(),'the player switched it off: not shown');
 delete X.cfg.pinHint;ok(X.shotPinHintOn(),'a save from before the option reads as on');X.cfg.pinHint=true;
 X.S.phase='pause';ok(!X.shotPinHintOn(),'paused: not shown');
 X.S.phase='count';ok(!X.shotPinHintOn(),'countdown: not shown');
 X.S.phase='play';X.S.tut={};ok(!X.shotPinHintOn(),'the tutorial teaches the shot itself: not shown');X.S.tut=null;
 X.C.shots.pin.hint.on=false;ok(!X.shotPinHintOn(),'CONFIG switch off: not shown');X.C.shots.pin.hint.on=true;
 X.C.shots.pin.on=false;ok(!X.shotPinHintOn(),'no pin in this build: not shown');X.C.shots.pin.on=true;
 X.C.shots.on=false;ok(!X.shotPinHintOn(),'shots off: not shown');X.C.shots.on=true;

 /* 3. the ring */
 b=ball(5,2);r=rodOf();s=seat('#ff3b3b',['kbd'],r);rs=fresh(X,[s]);
 X.pinMarkUpdate(0.016);ok(!rs[0].visible,'nothing pinned: no ring');
 r.pinB=b;X.pinMarkUpdate(-5);ok(!rs[0].visible,'a negative frame time (a clock that stepped back) is not a negative fade');
 X.pinMarkUpdate(M.inT*0.25);
 const first=rs[0].scale.v;
 ok(rs[0].visible&&rs[0].material.opacity>0&&rs[0].material.opacity<M.alpha,'a catch fades the ring in');
 ok(rs[0].material.color.c==='#ff3b3b','…in the holding seat\'s colour');
 ok(rs[0].position.x===5&&rs[0].position.z===2&&rs[0].position.y===M.y,'…under the ball, on the pitch');
 X.pinMarkUpdate(M.inT*2);
 ok(rs[0].material.opacity===M.alpha,'…to full strength');
 ok(first>rs[0].scale.v,'…arriving bigger than it settles');
 ok(rs[0].scale.v>=M.r*(1-M.pulse)-1e-9&&rs[0].scale.v<=M.r*(1+M.pulse)+1e-9,'…and settles at the ring radius, give or take the breathing');
 b.m.position.x=9;b.m.position.z=-3;X.pinMarkUpdate(0.016);
 ok(rs[0].position.x===9&&rs[0].position.z===-3,'the ring rides a carried ball');
 r.pinB=null;b.m.position.x=20;X.pinMarkUpdate(M.outT*0.25);
 ok(rs[0].visible&&rs[0].material.opacity>0&&rs[0].material.opacity<M.alpha,'let go: it fades rather than vanishing');
 ok(rs[0].position.x===9,'…where the ball was let go, not following it');
 X.pinMarkUpdate(M.outT);ok(!rs[0].visible,'…and is gone once faded');
 b.scored=true;r.pinB=b;X.pinMarkUpdate(0.5);ok(!rs[0].visible,'a scored ball gets no ring');b.scored=false;
 r.pinB=b;X.pinMarkUpdate(0.5);X.S.phase='pause';X.pinMarkUpdate(0.016);ok(rs[0].visible,'paused: the ring stays');
 X.S.phase='goal';X.pinMarkUpdate(0.016);ok(!rs[0].visible,'a dead phase hides it at once');
 X.S.phase='play';r.pinB=null;X.pinMarkUpdate(0.016);ok(!rs[0].visible,'…and it does not come back by itself');
 r.pinB=b;X.C.shots.pin.mark.on=false;X.pinMarkUpdate(0.5);ok(!rs[0].visible,'CONFIG switch off: no ring');X.C.shots.pin.mark.on=true;
 const sa=seat('#f00',['kbd'],rodOf(ball(1,1))),sb=seat('#00f',['pad*'],rodOf());rs=fresh(X,[sa,sb]);X.pinMarkUpdate(0.5);
 ok(rs[0].visible&&!rs[1].visible,'one ring per seat: only the holder\'s shows');
 sb.rods[0].pinB=ball(-4,4);X.pinMarkUpdate(0.5);ok(rs[1].visible&&rs[1].material.color.c==='#00f','…and each in its own colour');
 X.cfg.pinHint=false;X.pinMarkUpdate(0.5);ok(rs[0].visible,'the hint switch does not touch the ring');X.cfg.pinHint=true;

 /* 4. the plate */
 b=ball(5,2);r=rodOf();s=seat('#ff3b3b',['kbd','mouse'],r);fresh(X,[s]);
 for(let i=0;i<10;i++)frame(X,0.05);ok(X.LINES.length===0&&X.HUD.pin.a===0,'nothing pinned: no plate');
 r.pinB=b;frame(X,H.inT*0.5);
 ok(X.LINES.length===1&&X.LINES[0].alpha>0&&X.LINES[0].alpha<1,'a catch fades the plate in');
 const L=X.LINES[0].L;
 ok(caps(L)==='SPACE+LMB'&&words(L)==='PIN SHOT','a keyboard seat reads the kick keys and "pin shot"');
 frame(X,H.inT*2);ok(X.LINES[X.LINES.length-1].alpha===1,'…to full strength');
 ok(X.LINES[X.LINES.length-1].cy+14<=X.HUD.chipY-H.gap+1e-6,'…sitting clear above the rod chips, not on them');
 X.LINES.length=0;frame(X,0.5,0.5);ok(X.LINES[0].alpha===0.5,'it rides the HUD chrome\'s own fade');
 X.LINES.length=0;frame(X,H.hold);frame(X,1.2+0.5);
 ok(Math.abs(X.LINES[X.LINES.length-1].alpha-H.dim)<1e-9,'held past `hold` it settles to `dim`');
 X.LINES.length=0;r.pinB=null;frame(X,H.outT*0.5);
 ok(X.LINES.length===1&&X.LINES[0].alpha<H.dim,'let go: it fades out');
 frame(X,H.outT*2);X.LINES.length=0;frame(X,0.1);ok(X.LINES.length===0&&X.HUD.pin.a===0,'…and stops drawing');
 // a second catch starts at full strength again, with the keys as bound NOW
 X.setBind(false);r.pinB=b;X.LINES.length=0;frame(X,H.inT*2);
 ok(X.LINES.length===1&&words(X.LINES[0].L)==='PIN SHOT'&&caps(X.LINES[0].L)==='','an unbound kick still reads "pin shot" (rebuilt per catch)');
 ok(X.LINES[0].alpha===1,'a fresh catch is full strength again, not dimmed');X.setBind(true);
 X.cfg.pinHint=false;X.LINES.length=0;frame(X,0.5);ok(X.LINES.length===0,'the player\'s switch hides the plate while a ball is pinned');X.cfg.pinHint=true;
 const sp=seat('#00f',['pad2'],rodOf(ball(1,1)));fresh(X,[sp]);frame(X,0.5);
 ok(pads(X.LINES[0].L)==='A'&&caps(X.LINES[0].L)==='','a pad seat reads the A button');
 const so=seat('#00f',['kbd','mouse','pad*'],rodOf(ball(1,1)));fresh(X,[so]);X.setPad(true);frame(X,0.5);
 ok(pads(X.LINES[0].L)==='A','a seat with every device reads the pad once the pad was touched last');
 fresh(X,[so]);X.setPad(false);frame(X,0.5);ok(caps(X.LINES[0].L)==='SPACE+LMB','…and the keys when the keyboard was');
 fresh(X,[seat('#00f',['kbd'],rodOf(ball(1,1)))]);X.setPad(true);frame(X,0.5);
 ok(caps(X.LINES[0].L)==='SPACE+LMB','a keyboard-only seat never reads pad glyphs, whoever touched what');
 fresh(X,[so]);X.S.tut={};frame(X,0.5);ok(X.LINES.length===0,'no plate in the tutorial');

 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const SHOTS=rd('js/shots.js'),FX=rd('js/fx.js'),HUDJS=rd('js/hud.js');
const base=suite(boot(SHOTS,FX,HUDJS),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['shots','return b&&!b.scored?b:null;','return b||null;','a scored ball keeps its ring'],
 ['shots','&&cfg.pinHint!==false','','the Options switch does nothing'],
 ['shots','&&cfg.pinHint!==false','&&cfg.pinHint===true','a save from before the option never shows it'],
 ['shots',"&&S.phase==='play'&&!S.tut)","&&!S.tut)",'the plate shows while paused'],
 ['shots',"&&S.phase==='play'&&!S.tut)","&&S.phase==='play')",'the plate shows over the tutorial'],
 ['shots','for(let i=0;i<S.seats.length;i++)if(shotPinBall(S.seats[i]))return S.seats[i];return null;','return S.seats[0]||null;','the plate belongs to the first seat, not the one that pinned'],
 ['fx',"if(!live){u.a=0;m.visible=false;continue;}",'','a ring lingers through a goal'],
 ['fx','}else u.a=Math.max(0,u.a-rdt/Math.max(.01,M.outT));','}else u.a=0;','the ring blinks out on release'],
 ['fx','u.x=b.m.position.x;u.z=b.m.position.z;','','the ring stays where the ball was caught'],
 ['fx','M.r*(1+(1-e)*M.from)*br','M.r*br','the ring does not settle in'],
 ['fx','const live=M.on&&','const live=','the CONFIG switch is ignored'],
 ['fx',' rdt=rdt>0?rdt:0;',' ','a clock that steps back hides the ring for a second'],
 ['fx','if(u.col!==c){u.col=c;m.material.color.set(c);}','','a ring ignores its seat colour'],
 ['hud','else P.on=false;','','the plate never goes away'],
 ['hud','if(!P.on){P.on=true;P.t=HUD.t;P.tok=','if(!P.on){P.on=true;P.tok=','a long-held catch is never dimmed afresh'],
 ['hud','(hasPad&&(!hasKb||hudPadNow())?P.tokP:P.tok)[0]','P.tok[0]','a pad player is shown keyboard keys'],
 ['hud','(hasPad&&(!hasKb||hudPadNow())?P.tokP:P.tok)[0]','P.tokP[0]','a keyboard player is shown pad buttons'],
 ['hud','(age<H.hold?1:1-(1-H.dim)*hO3(hC((age-H.hold)/1.2)))','1','the plate never settles back'],
 ['hud','X.globalAlpha=a*ei*','X.globalAlpha=ei*','the plate ignores the chrome fade'],
 ['hud','y=HUD.chipY-H.gap*u-h+','y=HUD.chipY-h+','the plate sits on the rod chips'],
 ['hud','P.tok=hudTok(bindHint(\'kick\',\'pin shot\',2)||\'pin shot\');','P.tok=hudTok(\'[SPACE] pin shot\');','the plate ignores a rebind']
];
let caught=0;
for(const [file,find,repl,name] of muts){
 const src=file==='shots'?SHOTS:file==='fx'?FX:HUDJS;
 if(src.indexOf(find)<0){console.log('  BROKEN  '+name+' — anchor not found');continue;}
 const m=src.replace(find,repl);
 if(m===src){console.log('  BROKEN  '+name+' — no-op');continue;}
 pass=0;fail=0;fails.length=0;
 let f;try{f=suite(boot(file==='shots'?m:SHOTS,file==='fx'?m:FX,file==='hud'?m:HUDJS),true);}catch(e){f=1;}
 if(f>0){caught++;console.log('  caught  ('+f+' assertions)  '+name);}
 else console.log('  SURVIVED  '+name);
}
console.log('mutations caught: '+caught+'/'+muts.length);
process.exitCode=(base>0||caught<muts.length)?1:0;
