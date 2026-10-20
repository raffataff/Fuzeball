// SFX Lab presets, kit starters, the per-category randomiser and mutate. Pitches are scale degrees, so anything made here sits in the kit's key
'use strict';
(function(G){
const X=G.SFX||require('./engine.js');
const lay=(type,o)=>X.merge(X.LDEF,X.merge({type},o||{}));
const rec=(name,layers,master,note)=>X.fill({name,note:note||'',layers,master:master||{}});
const dbl=(a,b)=>Object.assign({},a,b);

// --- the console look: soft sines and glass FM, a breath of air, a small bright room ---
const HOLO_M={lowcut:120,tail:{trim:-60,fade:.01,max:6},verb:{mix:.12,size:.35,damp:.35,pre:.006},delay:{mix:.08,time:.075,fb:.2,tone:7000,ping:true},norm:{mode:'loud',db:-18}};
const air=(o)=>lay('noise',X.merge({name:'air',gain:-24,noise:{color:'white'},osc:{spread:.6},amp:{a:.0005,d:.02,r:.01},filt:{type:'hp',cut:7000,q:.7}},o||{}));
const HOLO={
 ui_move:rec('ui_move',[
  lay('osc',{name:'blip',gain:-6,pitch:{deg:3,oct:6,penv:{st:4,time:.006,curve:2}},osc:{wave:'sine'},amp:{a:.0008,d:.045,r:.02}}),
  air({gain:-28,amp:{d:.012}})],dbl(HOLO_M,{norm:{mode:'loud',db:-22}}),'hover: one high sine blip and a tick of air'),
 ui_value:rec('ui_value',[
  lay('osc',{name:'tick',gain:-6,pitch:{deg:2,oct:6,penv:{st:7,time:.008,curve:2}},osc:{wave:'triangle'},amp:{a:.0008,d:.05,r:.02},filt:{type:'lp',cut:6000,q:.7}}),
  lay('fm',{name:'glint',gain:-18,pitch:{deg:2,oct:7},fm:{ratio:3.5,idx:1.5,idxEnd:0,idxTime:.03},amp:{a:.001,d:.04,r:.02}})],dbl(HOLO_M,{norm:{mode:'loud',db:-21}}),'value step: a triangle tick with a glass glint'),
 ui_rod:rec('ui_rod',[
  lay('osc',{name:'tick',gain:-6,pitch:{deg:0,oct:5,penv:{st:5,time:.01,curve:2}},osc:{wave:'sine'},amp:{a:.0008,d:.035,r:.015}}),
  air({gain:-26,filt:{type:'bp',cut:4500,q:2},amp:{d:.01}})],dbl(HOLO_M,{norm:{mode:'loud',db:-23}}),'rod switch: a low soft tick'),
 ui_tab:rec('ui_tab',[
  lay('noise',{name:'swish',gain:-14,noise:{color:'pink'},osc:{spread:.7},amp:{a:.01,d:.06,r:.03},filt:{type:'bp',cut:1800,q:1.6,env:2,ea:.04,ed:.08}}),
  lay('osc',{name:'blip',gain:-7,t0:.025,pitch:{deg:6,oct:5,penv:{st:-3,time:.01}},osc:{wave:'sine'},amp:{a:.001,d:.06,r:.02}})],dbl(HOLO_M,{norm:{mode:'loud',db:-20}}),'tab: a short swish into a blip'),
 ui_click:rec('ui_click',[
  lay('fm',{name:'glass',gain:-6,pitch:{deg:3,oct:5,notes:'0 2',play:'arp',step:.045,stepGain:1.1},fm:{ratio:3.5,idx:2.4,idxEnd:.2,idxTime:.06},amp:{a:.001,d:.18,r:.06}}),
  lay('add',{name:'halo',gain:-20,t0:.045,pitch:{deg:5,oct:6},add:{harm:'1 0 .3 0 .15'},osc:{uni:3,det:9,spread:.8},amp:{a:.01,d:.25,r:.1}}),
  air({gain:-24})],dbl(HOLO_M,{delay:{mix:.14,time:.09,fb:.25,tone:6000,ping:true},norm:{mode:'loud',db:-18}}),'confirm: two rising glass notes with a halo'),
 ui_back:rec('ui_back',[
  lay('fm',{name:'glass',gain:-6,pitch:{deg:3,oct:5,notes:'0 -2',play:'arp',step:.045,stepGain:.9},fm:{ratio:2,idx:1.6,idxEnd:0,idxTime:.05},amp:{a:.001,d:.12,r:.05},filt:{type:'lp',cut:4000,q:.7}}),
  air({gain:-28})],dbl(HOLO_M,{norm:{mode:'loud',db:-20}}),'back: the confirm turned down and darker'),
 ui_open:rec('ui_open',[
  lay('noise',{name:'rise',gain:-14,noise:{color:'pink'},osc:{spread:.8},amp:{a:.06,d:.12,r:.05},filt:{type:'bp',cut:700,q:1.2,env:3,ea:.09,ed:.15}}),
  lay('fm',{name:'chord',gain:-9,t0:.06,pitch:{deg:0,oct:5,notes:'0 2 4',play:'chord',step:.018},fm:{ratio:3,idx:1.2,idxEnd:0,idxTime:.1},osc:{uni:2,det:6,spread:.6},amp:{a:.004,d:.3,r:.12}})],
  dbl(HOLO_M,{verb:{mix:.16,size:.45,damp:.35,pre:.01},norm:{mode:'loud',db:-19}}),'panel open: air rising into a strummed glass chord'),
 ui_error:rec('ui_error',[
  lay('osc',{name:'buzz',gain:-6,pitch:{deg:-5,oct:5,reps:2,repEvery:.11,repGain:.85},osc:{wave:'saw',uni:2,det:14,spread:.3},amp:{a:.003,h:.04,d:.06,r:.03},filt:{type:'lp',cut:1400,q:2,env:1,ed:.05},mod:{trem:.6,tremRate:38,tremShape:'square'}}),
  lay('osc',{name:'rub',gain:-14,pitch:{deg:-5,oct:5,acc:1,reps:2,repEvery:.11},osc:{wave:'square'},amp:{a:.003,h:.04,d:.06,r:.03},filt:{type:'lp',cut:1000,q:.7}})],
  dbl(HOLO_M,{verb:{mix:.06,size:.3,damp:.5,pre:.005},delay:{mix:0},norm:{mode:'loud',db:-18}}),'denied: two flickering low buzzes, a semitone rub on purpose'),
 ui_start:rec('ui_start',[
  lay('fm',{name:'arp',gain:-7,pitch:{deg:0,oct:5,notes:'0 2 3 5',play:'arp',step:.055,stepGain:1.05},fm:{ratio:3.5,idx:2,idxEnd:.2,idxTime:.05},amp:{a:.001,d:.16,r:.05}}),
  lay('modal',{name:'bell',gain:-8,t0:.22,pitch:{deg:5,oct:5},modal:{model:'glass',decay:1.1,tilt:.5,bright:.4,hit:.15},amp:{a:.001,s:1,len:1.2,r:.3}}),
  lay('add',{name:'shimmer',gain:-20,t0:.22,pitch:{deg:5,oct:6,vib:{depth:6,rate:5}},add:{harm:'1 0 .4 0 .2'},osc:{uni:4,det:10,spread:1},amp:{a:.08,d:.9,r:.4}})],
  dbl(HOLO_M,{verb:{mix:.22,size:.6,damp:.3,pre:.012},delay:{mix:.15,time:.11,fb:.3,tone:6000,ping:true},norm:{mode:'loud',db:-16}}),'match start: a rising arpeggio landing on a glass bell'),
 ui_wipe:rec('ui_wipe',[
  lay('noise',{name:'sweep',gain:-8,noise:{color:'pink'},osc:{spread:1},amp:{a:.08,d:.2,r:.08},filt:{type:'bp',cut:500,q:1.4,env:3.5,ea:.16,ed:.2}}),
  lay('osc',{name:'glint',gain:-22,pitch:{deg:0,oct:6,glide:{deg:5,time:.2}},osc:{wave:'sine',uni:2,det:8,spread:.8},amp:{a:.05,d:.2,r:.08}})],
  dbl(HOLO_M,{verb:{mix:.12,size:.4,damp:.4,pre:.008},norm:{mode:'loud',db:-20}}),'screen wipe: a filtered air sweep with a faint rising glint')};

// --- the game's own synthesized stand-ins (audio.js AU_UI), in D suspended pentatonic ---
const WOOD=(deg,oct,t,d,v)=>lay('modal',{name:'wood',gain:20*Math.log10(v/.05),t0:t,pitch:{deg,oct},modal:{model:'custom',ratios:'1 3.93',decay:d*.75,tilt:.35,bright:.28,hit:0},amp:{a:.002,s:1,len:d,r:.02}});
const BELL=(deg,oct,t,d,v)=>lay('modal',{name:'bell',gain:20*Math.log10(v/.05),t0:t,pitch:{deg,oct},modal:{model:'bell',decay:d*.75,tilt:.6,bright:.45,hit:0},amp:{a:.003,s:1,len:d,r:.02}});
const LM={lowcut:20,verb:{mix:0},delay:{mix:0},norm:{mode:'off'},gain:0};
const LEGACY={
 ui_move:rec('ui_move',[WOOD(3,5,0,.04,.05)],LM),ui_value:rec('ui_value',[WOOD(2,5,0,.045,.055)],LM),ui_rod:rec('ui_rod',[WOOD(0,5,0,.035,.04)],LM),
 ui_tab:rec('ui_tab',[WOOD(6,5,0,.045,.05)],LM),ui_click:rec('ui_click',[BELL(3,5,0,.05,.05),BELL(5,5,.04,.09,.05)],LM),
 ui_back:rec('ui_back',[WOOD(3,5,0,.05,.055),WOOD(0,5,.04,.08,.055)],LM),ui_open:rec('ui_open',[WOOD(2,5,0,.08,.045),WOOD(3,5,0,.08,.04)],LM),
 ui_error:rec('ui_error',[WOOD(-5,5,0,.06,.07),WOOD(-5,5,.08,.08,.06)],LM),
 ui_start:rec('ui_start',[BELL(0,5,0,.07,.045),BELL(2,5,.045,.07,.045),BELL(3,5,.09,.07,.045),BELL(5,5,.135,.35,.055)],LM)};

// --- randomiser ---
function gen(cat,seed,kit){const R=X.rngOf(seed*2654435761>>>0||1),rr=(a,b)=>a+(b-a)*R(),rl=(a,b)=>a*Math.pow(b/a,R()),ri=(a,b)=>Math.floor(rr(a,b+1)),pick=a=>a[Math.floor(R()*a.length)],ch=p=>R()<p;
 const n=(kit&&X.SCALES[kit.scale]?X.SCALES[kit.scale].s.length:5),deg=()=>ri(0,n-1),up=()=>pick(['0 1','0 2','0 2 4','0 1 2','0 '+(n>5?4:3),'0 2 '+n]);
 const down=()=>pick(['0 -1','0 -2','0 -2 -4','0 -'+(n>5?4:3)]);
 const tone=(o)=>{const t=pick(['osc','fm','fm','modal','add']);const b={osc:{wave:pick(['sine','sine','triangle'])},fm:{ratio:pick([1,2,3,3.5,4,5,7]),idx:rr(.5,4),idxEnd:rr(0,.5),idxTime:rl(.01,.2)},
  modal:{model:pick(['glass','bell','crystal','bar','marimba']),decay:rl(.05,1),tilt:rr(.3,.7),bright:rr(.2,.6),hit:rr(0,.3)},add:{harm:pick(['1 0 .3 0 .15','1 .5 .25','1 0 0 .3 0 0 .15','1 .2 .4 .1'])}};
  return lay(t,X.merge(b[t],X.merge(t==='modal'?{amp:{a:.001,s:1,len:rl(.05,.6),r:.05}}:{},o||{})));};
 const airL=(g)=>lay('noise',{name:'air',gain:g||rr(-30,-20),noise:{color:pick(['white','pink'])},osc:{spread:rr(.3,1)},amp:{a:.0005,d:rl(.008,.03),r:.01},filt:{type:'hp',cut:rl(4000,10000),q:.7}});
 const room=(mix,size)=>({lowcut:rl(60,200),verb:{mix:mix,size:size,damp:rr(.2,.6),pre:rr(.003,.02)},delay:{mix:ch(.5)?rr(.05,.2):0,time:rl(.05,.2),fb:rr(.1,.4),tone:rl(3000,9000),ping:ch(.7)},norm:{mode:'loud',db:-18},seed:ri(1,9999)});
 const L=[];let M=room(rr(.05,.18),rr(.2,.5)),name=cat;
 const C={
  hover(){L.push(tone({name:'blip',pitch:{deg:deg(),oct:ri(6,7),penv:{st:rr(-6,8),time:rl(.003,.02)}},amp:{a:.0008,d:rl(.02,.06),r:.015}}));if(ch(.6))L.push(airL());M.norm.db=-22;},
  confirm(){L.push(tone({name:'notes',pitch:{deg:deg(),oct:5,notes:up(),play:'arp',step:rr(.03,.07),stepGain:rr(.95,1.15)},amp:{a:.001,d:rl(.1,.3),r:.06}}));
   if(ch(.6))L.push(lay('add',{name:'halo',gain:rr(-24,-16),t0:rr(.03,.08),pitch:{deg:deg(),oct:6},add:{harm:'1 0 .3 0 .15'},osc:{uni:3,det:rr(5,14),spread:.8},amp:{a:.01,d:rl(.15,.4),r:.1}}));if(ch(.5))L.push(airL());},
  cancel(){L.push(tone({name:'notes',pitch:{deg:deg()+2,oct:5,notes:down(),play:'arp',step:rr(.035,.07),stepGain:rr(.8,1)},amp:{a:.001,d:rl(.08,.2),r:.05},filt:{type:'lp',cut:rl(1500,5000),q:.7}}));M.norm.db=-20;},
  error(){const w=pick(['saw','square','pulse']);L.push(lay('osc',{name:'buzz',pitch:{deg:-n,oct:5,reps:ri(1,3),repEvery:rr(.08,.14),repGain:rr(.7,1)},osc:{wave:w,pw:rr(.2,.4),uni:ri(1,3),det:rr(5,20)},amp:{a:.003,h:rr(.02,.08),d:rl(.03,.1),r:.03},filt:{type:'lp',cut:rl(600,2500),q:rr(.7,4)},mod:{trem:ch(.6)?rr(.3,.8):0,tremRate:rl(20,50),tremShape:'square'}}));
   if(ch(.7))L.push(lay('osc',{name:'rub',gain:rr(-18,-10),pitch:{deg:-n,oct:5,acc:pick([1,-1]),reps:L[0].pitch.reps,repEvery:L[0].pitch.repEvery},osc:{wave:'square'},amp:dbl(L[0].amp,{}),filt:{type:'lp',cut:1000,q:.7}}));M.delay.mix=0;},
  open(){L.push(lay('noise',{name:'rise',gain:rr(-16,-10),noise:{color:'pink'},osc:{spread:.8},amp:{a:rl(.03,.12),d:rl(.08,.2),r:.05},filt:{type:'bp',cut:rl(400,1000),q:rr(.8,2),env:rr(2,4),ea:rl(.05,.15),ed:rl(.1,.2)}}));
   L.push(tone({name:'chord',t0:rr(.04,.1),pitch:{deg:deg(),oct:5,notes:'0 2 4',play:'chord',step:rr(0,.03)},osc:{uni:2,det:6,spread:.6},amp:{a:.004,d:rl(.2,.5),r:.12}}));},
  close(){L.push(lay('noise',{name:'fall',gain:rr(-16,-10),noise:{color:'pink'},osc:{spread:.8},amp:{a:.004,d:rl(.08,.2),r:.05},filt:{type:'bp',cut:rl(3000,6000),q:rr(.8,2),env:-rr(2,4),ea:.001,ed:rl(.08,.2)}}));
   L.push(tone({name:'notes',pitch:{deg:deg()+n,oct:5,notes:down(),play:'arp',step:rr(.03,.06)},amp:{a:.001,d:rl(.08,.2),r:.05},filt:{type:'lp',cut:rl(2000,5000),q:.7}}));},
  whoosh(){const upw=ch(.6);L.push(lay('noise',{name:'sweep',gain:-8,noise:{color:pick(['pink','white','brown'])},osc:{spread:1},amp:{a:rl(.04,.2),d:rl(.1,.4),r:.08},filt:{type:'bp',cut:upw?rl(300,700):rl(3000,7000),q:rr(1,3),env:upw?rr(2,4):-rr(2,4),ea:rl(.1,.3),ed:rl(.1,.4)}}));
   if(ch(.6))L.push(lay('osc',{name:'glint',gain:rr(-26,-18),pitch:{deg:deg(),oct:6,glide:{deg:upw?ri(2,5):-ri(2,5),time:rr(.1,.3)}},osc:{wave:'sine',uni:2,det:8,spread:.8},amp:{a:rl(.03,.1),d:rl(.1,.3),r:.08}}));M.norm.db=-20;},
  chime(){L.push(lay('modal',{name:'chime',pitch:{deg:deg(),oct:ri(5,6),notes:pick(['0','0 2 4','0 4','0 2']),play:pick(['chord','arp']),step:rr(.02,.08)},modal:{model:pick(['glass','bell','crystal','bar']),decay:rl(.6,2),tilt:rr(.4,.7),bright:rr(.3,.6),hit:rr(.05,.3)},amp:{a:.001,s:1,len:rl(.8,2),r:.3}}));
   M=dbl(M,room(rr(.15,.3),rr(.4,.7)));M.norm.db=-17;},
  sparkle(){L.push(tone({name:'sparks',pitch:{deg:deg(),oct:7,notes:'0 1 2 3 4',play:'rand',step:rr(.02,.05),stepGain:rr(.85,1),reps:ri(1,3),repEvery:rr(.1,.2),repGain:.6},amp:{a:.0008,d:rl(.03,.1),r:.02}}));
   M.delay={mix:rr(.2,.4),time:rl(.06,.15),fb:rr(.3,.5),tone:8000,ping:true};M.verb.mix=rr(.15,.3);M.norm.db=-20;},
  scan(){L.push(lay('osc',{name:'scan',pitch:{deg:deg(),oct:ri(5,7),glide:{deg:ri(-5,5),time:rr(.2,.6)}},osc:{wave:pick(['square','pulse','triangle']),pw:rr(.1,.4)},amp:{a:.01,h:rr(.1,.4),d:rl(.05,.2),r:.05},filt:{type:'bp',cut:rl(1000,5000),q:rr(1,5),lfo:rr(.5,2),lfoRate:rl(2,10)},mod:{trem:rr(.5,1),tremRate:rl(10,40),tremShape:'square',crush:ch(.4)?ri(6,10):0}}));M.norm.db=-21;},
  data(){L.push(lay('osc',{name:'chatter',pitch:{deg:deg(),oct:ri(6,7),notes:'0 1 2 3 4 5',play:'rand',step:rr(.02,.04),reps:ri(2,5),repEvery:rr(.12,.2),repShift:pick([0,0,1,-1])},osc:{wave:pick(['square','sine','pulse']),pw:.25},amp:{a:.0005,d:rl(.01,.03),r:.005},mod:{crush:ch(.5)?ri(5,9):0,down:ch(.3)?ri(2,6):1}}));M.norm.db=-22;},
  glitch(){L.push(lay(pick(['fm','noise','osc']),{name:'glitch',pitch:{deg:deg(),oct:ri(5,7),penv:{st:rr(-24,24),time:rl(.01,.1)}},fm:{ratio:rl(1,11),idx:rr(3,12),idxEnd:rr(0,6),idxTime:rl(.02,.2)},osc:{wave:'square'},amp:{a:.0005,h:rr(.05,.15),d:rl(.03,.15),r:.02},filt:{type:'bp',cut:rl(800,6000),q:rr(.7,4)},mod:{crush:ri(3,8),down:ri(1,10),glitch:rr(.3,.7),glitchRate:rl(15,60)}}));M.verb.mix=rr(0,.1);M.norm.db=-20;},
  powerup(){L.push(tone({name:'rise',pitch:{deg:deg(),oct:4,notes:pick(['0 2 4 7','0 1 2 3 4 5','0 2 4 6 8']),play:'arp',step:rr(.04,.08),stepGain:1.05,glide:{deg:ri(2,5),time:rr(.2,.5)}},amp:{a:.002,d:rl(.15,.4),r:.08}}));
   L.push(lay('osc',{name:'sweep',gain:rr(-20,-12),pitch:{deg:0,oct:4,glide:{deg:n*2,time:rr(.3,.6)}},osc:{wave:'saw',uni:3,det:15,spread:.8},amp:{a:.05,h:.2,d:.3,r:.1},filt:{type:'lp',cut:400,q:3,env:4,ea:.4,ed:.3}}));M=dbl(M,room(rr(.15,.3),rr(.4,.7)));},
  powerdown(){L.push(lay('osc',{name:'fall',pitch:{deg:deg(),oct:6,penv:{st:-rr(12,30),time:rl(.2,.6),curve:.6}},osc:{wave:pick(['saw','square','triangle']),uni:2,det:10},amp:{a:.005,h:rr(.1,.3),d:rl(.1,.3),r:.1},filt:{type:'lp',cut:rl(2000,6000),q:rr(1,4),env:-3,ea:.001,ed:rl(.2,.5)}}));M.norm.db=-18;},
  laser(){L.push(lay('fm',{name:'zap',pitch:{deg:deg(),oct:ri(6,7),penv:{st:-rr(18,40),time:rl(.05,.25),curve:rr(.5,1.5)}},fm:{ratio:pick([.5,1,1.5,2]),idx:rr(2,8),idxEnd:rr(0,2),idxTime:rl(.03,.2)},amp:{a:.0005,d:rl(.08,.25),r:.03}}));M.delay.mix=rr(.1,.25);M.norm.db=-18;},
  impact(){L.push(lay('osc',{name:'thump',pitch:{deg:0,oct:ri(2,3),penv:{st:rr(12,24),time:rl(.02,.06),curve:2}},osc:{wave:'sine'},amp:{a:.0005,d:rl(.1,.35),r:.05}}));
   L.push(lay('noise',{name:'crack',gain:rr(-16,-8),noise:{color:pick(['white','pink'])},osc:{spread:.6},amp:{a:.0003,d:rl(.02,.08),r:.02},filt:{type:'lp',cut:rl(1500,6000),q:.7}}));
   if(ch(.5))L.push(lay('modal',{name:'body',gain:-12,pitch:{deg:deg(),oct:3},modal:{model:'membrane',decay:rl(.1,.4),tilt:.5,bright:.5,hit:.3},amp:{a:.001,s:1,len:.4,r:.05}}));M.lowcut=30;M.norm.db=-16;},
  alarm(){L.push(lay('osc',{name:'alarm',pitch:{deg:deg(),oct:5,notes:pick(['0 2','0 1','0 3']),play:'arp',step:rr(.1,.2),reps:ri(2,4),repEvery:rr(.25,.4),repGain:.95},osc:{wave:pick(['square','saw','triangle']),uni:2,det:8},amp:{a:.005,h:rr(.05,.1),d:.05,s:.6,len:rr(.08,.15),r:.02},filt:{type:'lp',cut:rl(1500,4000),q:1.2},mod:{trem:rr(0,.4),tremRate:rl(15,30)}}));M.norm.db=-18;},
  hum(){L.push(lay(pick(['add','osc']),{name:'hum',pitch:{deg:0,oct:ri(2,3),vib:{depth:rr(2,8),rate:rr(.2,1)}},add:{harm:'1 .5 .3 .2 .15 .1'},osc:{wave:'saw',uni:ri(3,5),det:rr(5,15),spread:1},amp:{a:rl(.1,.4),s:1,len:rr(1,2),r:rl(.2,.6)},filt:{type:'lp',cut:rl(300,1500),q:rr(1,4),lfo:rr(.3,1),lfoRate:rl(.1,1)}}));
   M.chorus={mix:rr(.3,.7),rate:rr(.2,.8),depth:rr(2,6)};M.lowcut=30;M.norm.db=-20;},
  pluck(){L.push(lay('pluck',{name:'pluck',pitch:{deg:deg(),oct:ri(4,6),notes:pick(['0','0 2','0 2 4']),play:pick(['chord','arp']),step:rr(0,.05)},pluck:{decay:rl(.1,1),bright:rr(.3,.9)},amp:{a:.0005,s:1,len:rr(.2,.8),r:.08}}));M.norm.db=-18;}};
 (C[cat]||C.confirm)();
 return rec(name,L,M,'generated: '+cat+' #'+seed);}
const CATS=['hover','confirm','cancel','error','open','close','whoosh','chime','sparkle','scan','data','glitch','powerup','powerdown','laser','impact','alarm','hum','pluck'];

// --- mutate: nudge every unlocked number by up to amt of its range (log ranges in log), sometimes a step of a selector or a degree ---
function mutate(r,amt,seed,locks){locks=locks||{};const R=X.rngOf(seed*2246822519>>>0||1),o=X.clone(X.fill(r));
 const nudge=(obj,sc)=>{for(const g in sc){if(locks[g])continue;for(const e of sc[g]){const [p,,k,a,b]=e;if(p==='seed'||p==='pitch.hz'&&obj.pitch&&obj.pitch.mode!=='hz')continue;
  const v=X.getP(obj,p);if(v==null)continue;
  if(k==='num'&&R()<.6)X.setP(obj,p,Math.min(b,Math.max(a,v+(R()*2-1)*amt*(b-a)*.25)));
  else if(k==='log'&&R()<.6){const lo=Math.max(a,1e-6);X.setP(obj,p,Math.min(b,Math.max(lo,Math.max(v,lo)*Math.exp((R()*2-1)*amt*Math.log(b/lo)*.25))));}
  else if(k==='int'&&R()<amt*.3&&!/acc|crush|down|uni|reps/.test(p))X.setP(obj,p,Math.min(b,Math.max(a,v+(R()<.5?-1:1))));
  else if(k==='sel'&&R()<amt*.08&&!/mode|type|poles|play/.test(p))X.setP(obj,p,a[Math.floor(R()*a.length)]);}}};
 o.layers.forEach((l,i)=>{if(locks['layer'+i])return;const sc={};for(const g of ['main','pitch','motion','amp','filt','mod',l.type])sc[g]=X.LSCHEMA[g];nudge(l,sc);});
 if(!locks.master)nudge(o.master,X.MSCHEMA);
 return o;}

const API={HOLO,LEGACY,CATS,gen,mutate,lay,rec};
X.P=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof globalThis!=='undefined'?globalThis:this);
