// SFX Lab editor: the kit, one recipe at a time, generate / vary / audition / export
'use strict';
(function(){
const X=SFX,P=SFX.P,LSK='sfxlab_kit',LSU='sfxlab_ui',q=id=>document.getElementById(id);
function h(t,a,...c){const e=document.createElement(t);if(a)for(const k in a){const v=a[k];
  if(k==='class')e.className=v;else if(k==='style')e.style.cssText=v;else if(k==='value'||k==='checked')e[k]=v;
  else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,v);}
 for(const x of c.flat())if(x!=null&&x!==false)e.append(x.nodeType?x:String(x));return e;}
const store=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}},load=k=>{try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}};
const fmt=(v,k)=>k==='int'?String(v|0):Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):Math.abs(v)>=1?v.toFixed(2):v.toFixed(3);
const hash=s=>{let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619);}return (x>>>0).toString(36);};
let toastT=0;function toast(m,ms){const t=q('toast');t.textContent=m;t.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>t.style.display='none',ms||2600);}

// --- state ---
const UI=Object.assign({loop:false,auto:true,view:'wave',amt:.35,locks:{},shut:{},vol:.7,cur:'ui_move'},load(LSU)||{});
const ST={kit:null,ids:[],files:{},server:false,ctx:null,out:null,src:null,last:null,take:0,cands:[],hist:{},hi:{},ab:0,ms:0};
const saveUI=()=>store(LSU,UI);
const GROUPS=[['Menus',id=>id.startsWith('ui_')],['Match & power-ups',id=>!/^(ui_|sting_|crowd_|ball_|ir_)/.test(id)],['Stingers',id=>id.startsWith('sting_')],['Table',id=>id.startsWith('ball_')],['Crowd',id=>id.startsWith('crowd_')]];
const LADDER={ui_move:-22,ui_rod:-23,ui_value:-21,ui_tab:-20,ui_back:-20,ui_click:-18,ui_open:-19,ui_error:-18,ui_start:-16,ui_wipe:-21};
const TOUR=[['ui_move',0],['ui_move',.22],['ui_move',.42],['ui_value',.8],['ui_value',1],['ui_tab',1.45],['ui_move',1.8],['ui_click',2.15],['ui_open',2.45],['ui_move',3.05],
 ['ui_rod',3.35],['ui_rod',3.55],['ui_back',3.95],['ui_error',4.55],['ui_move',5.15],['ui_start',5.55],['ui_wipe',5.65]];

const SND=()=>typeof CONFIG!=='undefined'&&CONFIG.audioMix?CONFIG.audioMix.sounds:{};
const kp=()=>({key:ST.kit.key,scale:ST.kit.scale,a4:ST.kit.a4});
const curRec=()=>ST.kit.sounds[UI.cur]||null;
function newKit(holo){return {name:'Holographic Console',key:'D',scale:'susPent',a4:440,sounds:holo?X.clone(P.HOLO):{},exp:{}};}
function kitSave(){store(LSK,ST.kit);}
function recHash(r){return hash(JSON.stringify([X.fill(r),kp()]));}

// --- audio out ---
function actx(){if(!ST.ctx){ST.ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});ST.out=ST.ctx.createGain();ST.out.connect(ST.ctx.destination);}
 ST.out.gain.value=UI.vol;if(ST.ctx.state==='suspended')ST.ctx.resume();return ST.ctx;}
function bufOf(o){const c=actx(),b=c.createBuffer(2,Math.max(1,o.L.length),o.sr);b.copyToChannel(o.L,0);b.copyToChannel(o.R,1);return b;}
function playBuf(b,o){o=o||{};const c=actx();if(!o.mix)stop();const s=c.createBufferSource(),g=c.createGain();s.buffer=b;g.gain.value=o.gain==null?1:o.gain;s.connect(g);g.connect(ST.out);
 const at=c.currentTime+(o.when||0);s.start(at);if(!o.mix){ST.src=s;ST.pt=at;ST.pl=b.duration;s.onended=()=>{if(ST.src!==s)return;ST.src=null;if(UI.loop&&!o.once)setTimeout(()=>{if(!ST.src)play();},180);};head();}return s;}
function stop(){if(ST.src){const s=ST.src;ST.src=null;try{s.stop();}catch(e){}}}
function play(){const r=curRec();if(!r)return;if(!ST.last)doRender();if(ST.last)playBuf(bufOf(ST.last));}
function head(){const tick=()=>{drawView();if(ST.src)requestAnimationFrame(tick);};requestAnimationFrame(tick);}
function playRec(r,o){o=o||{};const out=X.render(r,kp(),{take:o.take|0});playBuf(bufOf(out),Object.assign({once:true},o));return out;}

// --- render ---
let rT=0;function sched(playIt){clearTimeout(rT);rT=setTimeout(()=>{doRender();if(playIt&&UI.auto)play();},60);}
function doRender(){const r=curRec();if(!r){ST.last=null;return;}const t=performance.now();ST.last=X.render(r,kp(),{take:ST.take});ST.ms=performance.now()-t;drawView();drawHarm();meters();}

// --- history (per sound) ---
let cT=0,cL='';
function touch(label){cL=label||cL;clearTimeout(cT);cT=setTimeout(()=>commit(cL),450);}
function commit(label){const id=UI.cur,r=curRec();if(!r)return;const j=JSON.stringify(r),H=ST.hist[id]=ST.hist[id]||[];let i=ST.hi[id]==null?-1:ST.hi[id];
 if(H[i]&&H[i].j===j)return;H.length=i+1;H.push({l:label||'edit',j});if(H.length>150)H.shift();ST.hi[id]=H.length-1;kitSave();drawHist();drawList();}
function histInit(){const id=UI.cur,r=curRec();if(r&&!ST.hist[id]){ST.hist[id]=[{l:'opened',j:JSON.stringify(r)}];ST.hi[id]=0;}}
function histGo(i){const id=UI.cur,H=ST.hist[id];if(!H||i<0||i>=H.length)return;clearTimeout(cT);ST.hi[id]=i;ST.kit.sounds[id]=JSON.parse(H[i].j);kitSave();buildMain();sched(true);drawHist();}
const undo=()=>{clearTimeout(cT);commit(cL);histGo((ST.hi[UI.cur]|0)-1);},redo=()=>histGo((ST.hi[UI.cur]|0)+1);
function drawHist(){const el=q('hist');el.innerHTML='';const H=ST.hist[UI.cur]||[];
 H.forEach((e,i)=>el.prepend(h('div',{class:i===ST.hi[UI.cur]?'now':'',onclick:()=>histGo(i)},(i+1)+'. '+e.l)));}
function setRec(r,label){ST.kit.sounds[UI.cur]=X.fill(Object.assign(X.clone(r),{name:UI.cur}));histInit();commit(label);buildMain();sched(true);drawList();}

// --- the kit list ---
function drawList(){const el=q('klist'),f=q('find').value.trim().toLowerCase();el.innerHTML='';
 const all=ST.ids.map(x=>x.id),free=Object.keys(ST.kit.sounds).filter(k=>!all.includes(k));
 const grp=GROUPS.map(([n,t])=>[n,all.filter(t)]).concat([['Free sounds',free]]);
 for(const [n,ids] of grp){const vis=ids.filter(id=>!f||id.includes(f));if(!vis.length)continue;
  el.append(h('div',{class:'kgrp'},h('h3',null,n+' '),h('span',{class:'hint',style:'margin-left:6px'},vis.filter(id=>ST.kit.sounds[id]).length+'/'+vis.length)));
  for(const id of vis){const r=ST.kit.sounds[id],meta=ST.ids.find(x=>x.id===id),fl=(ST.files[id]||[]).length,ch=r&&ST.kit.exp&&ST.kit.exp[id]&&ST.kit.exp[id]!==recHash(r);
   el.append(h('div',{class:'krow'+(id===UI.cur?' sel':''),onclick:()=>select(id),title:id},
    h('i',{class:'dot'+(r?' kit':'')}),h('i',{class:'dot'+(fl?' file':meta&&!meta.syn?' sil':'')}),
    h('span',{class:'id'},id),ch?h('span',{class:'hint',title:'changed since it was exported'},'edited'):null,
    h('button',{class:'b ic sm pl',title:r?'play the kit version':'play the game file',onclick:e=>{e.stopPropagation();if(r)playRec(r,{take:0});else abPlay(id);}},'▶')));}}}
function select(id){clearTimeout(cT);if(curRec()&&ST.hist[UI.cur])commit(cL);UI.cur=id;saveUI();ST.take=0;ST.cands=ST.cands||[];histInit();drawList();buildMain();drawHist();sched(false);}

// --- parameter rows ---
const VIS={
 'pitch.hz':o=>o.pitch.mode==='hz','pitch.deg':o=>o.pitch.mode!=='hz','pitch.oct':o=>o.pitch.mode!=='hz','pitch.acc':o=>o.pitch.mode!=='hz',
 'pitch.repEvery':o=>o.pitch.reps>1,'pitch.repGain':o=>o.pitch.reps>1,'pitch.repShift':o=>o.pitch.reps>1,
 'pitch.penv.time':o=>!!o.pitch.penv.st,'pitch.penv.curve':o=>!!o.pitch.penv.st,'pitch.glide.time':o=>!!o.pitch.glide.deg,'pitch.glide.delay':o=>!!o.pitch.glide.deg,'pitch.vib.rate':o=>!!o.pitch.vib.depth,
 'osc.pw':o=>o.osc.wave==='pulse','osc.det':o=>o.osc.uni>1,'osc.spread':o=>o.type==='noise'||o.osc.uni>1,'noise.dens':o=>o.noise.color==='crackle','modal.ratios':o=>o.modal.model==='custom',
 'mod.ringRatio':o=>o.mod.ring>0,'mod.tremRate':o=>o.mod.trem>0,'mod.tremShape':o=>o.mod.trem>0,'mod.down':o=>true,'mod.glitchRate':o=>o.mod.glitch>0,
 'norm.db':o=>o.norm.mode!=='off','chorus.rate':o=>o.chorus.mix>0,'chorus.depth':o=>o.chorus.mix>0,'delay.time':o=>o.delay.mix>0,'delay.fb':o=>o.delay.mix>0,'delay.tone':o=>o.delay.mix>0,'delay.ping':o=>o.delay.mix>0,
 'verb.size':o=>o.verb.mix>0,'verb.damp':o=>o.verb.mix>0,'verb.pre':o=>o.verb.mix>0};
function visOf(p,o){if(/^filt\./.test(p)&&p!=='filt.type'&&o.filt&&o.filt.type==='none')return false;const f=VIS[p];return f?f(o):true;}
function row(obj,e,def,card){const [p,label,k,a,b]=e,v0=X.getP(obj,p),lb=h('label',{title:p+' (double-click: reset)'},label);let rng=null,inp;
 const changed=()=>JSON.stringify(X.getP(obj,p))!==JSON.stringify(X.getP(def,p));
 const R=h('div',{class:'row','data-p':p},lb);
 const set=(v,quiet)=>{X.setP(obj,p,v);R.classList.toggle('changed',changed());if(!quiet){refresh(card,obj);sched(true);touch(label);}};
 if(k==='num'||k==='log'||k==='int'){const lo=k==='log'?Math.max(a,1e-5):a;
  const toS=v=>k==='log'?1000*Math.log(Math.max(v,lo)/lo)/Math.log(b/lo):v,frS=s=>k==='log'?lo*Math.pow(b/lo,s/1000):k==='int'?Math.round(s):+s;
  rng=h('input',{type:'range',min:k==='log'?0:a,max:k==='log'?1000:b,step:k==='int'?1:k==='log'?1:(b-a)/400,value:toS(v0)});
  inp=h('input',{type:'number',class:'val',step:k==='int'?1:'any',value:fmt(v0,k)});
  rng.oninput=()=>{const v=frS(+rng.value);inp.value=fmt(v,k);set(v);};
  inp.onchange=()=>{let v=+inp.value;if(!isFinite(v))return;if(k==='int')v=Math.round(v);v=Math.min(b,Math.max(a,v));inp.value=fmt(v,k);rng.value=toS(v);set(v);};
  R.append(rng,inp);R._sync=()=>{const v=X.getP(obj,p);rng.value=toS(v);inp.value=fmt(v,k);};}
 else if(k==='sel'){inp=h('select',{class:'wide'},a.map(o=>h('option',{value:o},String(o))));inp.value=String(v0);
  inp.onchange=()=>{const v=typeof v0==='number'?+inp.value:inp.value;set(v);if(p==='type')buildMain();};R.append(inp);R._sync=()=>inp.value=String(X.getP(obj,p));}
 else if(k==='txt'){inp=h('input',{type:'text',class:'wide',value:v0==null?'':v0});inp.oninput=()=>set(inp.value);R.append(inp);R._sync=()=>inp.value=X.getP(obj,p);}
 else if(k==='bool'){inp=h('input',{type:'checkbox',checked:!!v0});inp.onchange=()=>set(inp.checked);R.append(inp,h('span'));R._sync=()=>inp.checked=!!X.getP(obj,p);}
 lb.ondblclick=()=>{X.setP(obj,p,X.clone(X.getP(def,p)));R._sync();set(X.getP(obj,p));};
 R.classList.toggle('changed',changed());return R;}
function refresh(card,obj){if(!card)return;for(const r of card.querySelectorAll('.row'))r.classList.toggle('hid',!visOf(r.dataset.p,obj));
 const dl=card.querySelector('[data-p="pitch.deg"]>label');if(dl&&obj.pitch){const m=X.midiOf(kp(),obj.pitch.deg,obj.pitch.oct,obj.pitch.acc);dl.textContent='Degree  '+X.noteName(m)+(X.inScale(kp(),m)?'':' (out)');}
 const gl=card.querySelector('[data-p="pitch.glide.deg"]>label');if(gl&&obj.pitch){gl.textContent=obj.pitch.glide.deg?'Glide to  '+X.noteName(X.midiOf(kp(),obj.pitch.deg+obj.pitch.glide.deg,obj.pitch.oct,obj.pitch.acc)):'Glide to deg';}
 const ev=card.querySelector('canvas.env');if(ev)drawEnv(ev,obj.amp);}
function section(key,title,obj,entries,def,card,extra){const S=h('div',{class:'sec'+(UI.shut[key]?' shut':'')}),rows=h('div',{class:'rows'});
 S.append(h('h3',{onclick:()=>{UI.shut[key]=!UI.shut[key];S.classList.toggle('shut',!!UI.shut[key]);saveUI();refresh(card,obj);}},title),rows);
 for(const e of entries)rows.append(row(obj,e,def,card));if(extra)rows.append(extra);return S;}

// --- the main column ---
function buildMain(){const m=q('main');m.innerHTML='';const id=UI.cur,r=curRec(),meta=ST.ids.find(x=>x.id===id);
 const fl=ST.files[id]||[],cfgS=SND()[id];
 const sh=h('div',{class:'shead'},h('span',{class:'title'},id||'no sound'));
 if(!r){m.append(sh,h('div',{class:'box empty'},h('p',null,id+' has no recipe in this kit yet.'),
   P.HOLO[id]?h('button',{class:'b gold',onclick:()=>setRec(P.HOLO[id],'holographic preset')},'Start from Holographic'):null,
   P.LEGACY[id]?h('button',{class:'b',onclick:()=>setRec(P.LEGACY[id],'game stand-in')},'Start from the game stand-in'):null,
   h('button',{class:'b',onclick:()=>setRec(blank(),'blank')},'Blank'),
   fl.length?h('button',{class:'b',onclick:()=>abPlay(id)},'Play the game file'):null,
   h('p',{class:'hint'},'Or press a Generate category on the right and Use a candidate.'),
   cfgS?h('p',{class:'hint'},'In game: bus '+cfgS.bus+', level '+(cfgS.vol==null?1:cfgS.vol)+(cfgS.pitch?', pitch spread '+cfgS.pitch:'')+(cfgS.syn===false?', recorded only (silent without a file)':'')):null));
  ST.last=null;drawHist();return;}
 sh.append(h('input',{type:'text',class:'note',value:r.note||'',placeholder:'what this sound is for',oninput:e=>{r.note=e.target.value;touch('note');}}),
  h('span',{class:'grp'},h('label',null,'Octave'),h('button',{class:'b ic sm',onclick:()=>octShift(-1)},'−'),h('button',{class:'b ic sm',onclick:()=>octShift(1)},'+')),
  h('span',{class:'grp'},h('label',null,'Takes'),h('input',{type:'number',min:1,max:8,value:r.takes,style:'width:48px',onchange:e=>{r.takes=Math.max(1,Math.min(8,e.target.value|0));e.target.value=r.takes;touch('takes');buildMain();}})),
  h('span',{class:'grp'},h('label',null,'Bits'),(()=>{const s=h('select',null,h('option',{value:16},'16'),h('option',{value:24},'24'));s.value=String(r.bits);s.onchange=()=>{r.bits=+s.value;touch('bits');};return s;})()),
  h('button',{class:'b gold',title:'Ctrl E',onclick:exportGame},ST.server?'Export to game':'Download takes'),
  h('button',{class:'b sm',onclick:dlCur},'WAV'),
  h('button',{class:'b sm',title:'remove this recipe from the kit',onclick:()=>{if(!confirm('Remove '+id+' from the kit? (undo keeps it in history)'))return;delete ST.kit.sounds[id];kitSave();buildMain();drawList();}},'Remove'));
 const view=h('div',{class:'view'},h('canvas',{id:'cv'}));
 view.onclick=e=>{if(!ST.last)return;const b=view.getBoundingClientRect(),t=(e.clientX-b.left)/b.width*ST.last.len;const c=actx(),bf=bufOf(ST.last);stop();const s=c.createBufferSource();s.buffer=bf;s.connect(ST.out);s.start(0,t);ST.src=s;ST.pt=c.currentTime-t;ST.pl=bf.duration;s.onended=()=>{if(ST.src===s)ST.src=null;};head();};
 const tr=h('div',{class:'transport'},
  h('button',{class:'b gold',title:'Space',onclick:play},'▶ Play'),h('button',{class:'b',onclick:stop},'■'),
  tog('Loop','loop'),tog('Auto-play','auto'),
  h('button',{class:'b',onclick:()=>{UI.view=UI.view==='wave'?'spec':'wave';saveUI();drawView();e2.textContent=UI.view==='wave'?'Spectrum':'Wave';}},UI.view==='wave'?'Spectrum':'Wave'),
  h('span',{class:'grp'},h('label',null,'Take'),h('button',{class:'b ic sm',onclick:()=>takeStep(-1)},'◀'),h('span',{id:'takeN',style:'min-width:34px;text-align:center'},(ST.take+1)+'/'+r.takes),h('button',{class:'b ic sm',onclick:()=>takeStep(1)},'▶')),
  h('button',{class:'b',onclick:playTakes,title:'play every take in turn, as the game would'},'All takes'),
  fl.length?h('button',{class:'b',onclick:()=>abPlay(id),title:'the file the game plays now'},'Game file'):null,
  P.LEGACY[id]?h('button',{class:'b',onclick:()=>playRec(P.LEGACY[id]),title:'the synthesized stand-in the game plays without a file'},'Stand-in'):null);
 const e2=tr.children[4];
 m.append(sh,view,h('div',{class:'meters',id:'met'}),tr,h('div',{class:'harm',title:'the kit\'s scale; gold = this sound, cyan = the rest of the kit; click to hear a note'},h('canvas',{id:'hv',onclick:harmClick})));
 r.layers.forEach((L,i)=>m.append(layerCard(r,L,i)));
 m.append(h('div',{style:'display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px'},h('span',{class:'hint',style:'align-self:center'},'Add layer:'),
  X.SEL.type.map(t=>h('button',{class:'b sm',onclick:()=>{r.layers.push(newLayer(t));touch('add '+t);commit('add '+t);buildMain();sched(true);}},'+ '+t))));
 m.append(masterCard(r));
 requestAnimationFrame(()=>{drawView();drawHarm();meters();});}
function tog(label,key){const b=h('button',{class:'b'+(UI[key]?' on':''),onclick:()=>{UI[key]=!UI[key];b.classList.toggle('on',UI[key]);saveUI();}},label);return b;}
function blank(){return P.rec(UI.cur,[newLayer('osc')],{});}
function newLayer(t){const o={name:t,pitch:{deg:0,oct:5}};if(t==='modal'||t==='pluck')o.amp={a:.001,s:1,len:.5,r:.1};if(t==='noise')o.filt={type:'bp',cut:3000,q:1};return P.lay(t,o);}
function layerCard(r,L,i){const card=h('div',{class:'layer'+(L.on?'':' off')});
 const solo=h('button',{class:'b ic sm'+(L.solo?' on':''),title:'solo',onclick:()=>{L.solo=!L.solo;solo.classList.toggle('on',L.solo);touch('solo');sched(true);}},'S');
 const ty=h('select',null,X.SEL.type.map(t=>h('option',{value:t},t)));ty.value=L.type;ty.onchange=()=>{L.type=ty.value;touch('type');commit('type '+L.type);buildMain();sched(true);};
 const mv=(d)=>{const j=i+d;if(j<0||j>=r.layers.length)return;[r.layers[i],r.layers[j]]=[r.layers[j],r.layers[i]];commit('move layer');buildMain();};
 card.append(h('div',{class:'lh'},
  h('input',{type:'checkbox',checked:L.on,title:'on',onchange:e=>{L.on=e.target.checked;card.classList.toggle('off',!L.on);touch('mute');sched(true);}}),solo,
  h('span',{class:'ty'},'LAYER '+(i+1)),h('input',{type:'text',class:'nm',value:L.name||'',oninput:e=>{L.name=e.target.value;touch('rename');}}),ty,h('span',{class:'sp'}),
  h('button',{class:'b ic sm',title:'up',onclick:()=>mv(-1)},'▲'),h('button',{class:'b ic sm',title:'down',onclick:()=>mv(1)},'▼'),
  h('button',{class:'b ic sm',title:'duplicate',onclick:()=>{r.layers.splice(i+1,0,X.clone(L));commit('duplicate layer');buildMain();sched(true);}},'⧉'),
  h('button',{class:'b ic sm',title:'delete',onclick:()=>{r.layers.splice(i,1);commit('delete layer');buildMain();sched(true);}},'✕')));
 const S=X.LSCHEMA,D=X.LDEF,secs=h('div',{class:'secs'});
 const env=h('canvas',{class:'env'});
 secs.append(section('Lmain','Level',L,S.main,D,card),section('Lsrc','Source: '+L.type,L,S[L.type],D,card),section('Lpitch','Pitch',L,S.pitch,D,card),
  section('Lmotion','Pitch motion',L,S.motion,D,card),section('Lamp','Envelope',L,S.amp,D,card,env),section('Lfilt','Filter',L,S.filt,D,card),section('Lmod','Mods',L,S.mod,D,card));
 card.append(secs);requestAnimationFrame(()=>refresh(card,L));return card;}
function masterCard(r){const card=h('div',{class:'layer master'}),S=X.MSCHEMA,D=X.MDEF,M=r.master,secs=h('div',{class:'secs'});
 card.append(h('div',{class:'lh'},h('span',{class:'ty'},'MASTER'),h('span',{class:'hint'},'effects on the whole sound, the file\'s level and the takes')));
 secs.append(section('Mout','Output',M,S.out,D,card),section('Meq','EQ',M,S.eq,D,card),section('Mch','Chorus',M,S.chorus,D,card),section('Mdl','Delay',M,S.delay,D,card),
  section('Mvb','Reverb',M,S.verb,D,card),section('Mtl','Length',M,S.tail,D,card),section('Mvy','Takes & seed',M,S.vary,D,card));
 card.append(secs);requestAnimationFrame(()=>refresh(card,M));return card;}
function octShift(d){const r=curRec();if(!r)return;for(const L of r.layers){if(L.pitch.mode==='hz')L.pitch.hz*=Math.pow(2,d);else L.pitch.oct=Math.max(1,Math.min(8,L.pitch.oct+d));}commit('octave '+(d>0?'+':'−'));buildMain();sched(true);}
function takeStep(d){const r=curRec();if(!r)return;ST.take=(ST.take+d+r.takes)%r.takes;const t=q('takeN');if(t)t.textContent=(ST.take+1)+'/'+r.takes;doRender();play();}
function playTakes(){const r=curRec();if(!r)return;stop();let at=0;for(let k=0;k<r.takes;k++){const o=X.render(r,kp(),{take:k});playBuf(bufOf(o),{mix:true,when:at});at+=Math.max(.25,Math.min(o.len,1.2))+.15;}}

// --- drawing ---
function fit(cv){const b=cv.getBoundingClientRect(),d=window.devicePixelRatio||1,w=Math.max(1,Math.round(b.width*d)),hh=Math.max(1,Math.round(b.height*d));if(cv.width!==w||cv.height!==hh){cv.width=w;cv.height=hh;}return {w,h:hh,d};}
let specC=null,specK='';
function drawView(){const cv=q('cv');if(!cv)return;const {w,h:H,d}=fit(cv),g=cv.getContext('2d'),o=ST.last;g.fillStyle='#050912';g.fillRect(0,0,w,H);if(!o)return;
 const n=o.L.length,len=o.len;
 const step=len>2?.5:len>1?.25:len>.4?.1:.05;g.font=(10*d)+'px Exo 2, sans-serif';g.fillStyle='#4a5f85';g.strokeStyle='#14223b';g.lineWidth=1;
 for(let t=0;t<=len;t+=step){const x=Math.round(t/len*w)+.5;g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();g.fillText(t.toFixed(step<.1?2:2).replace(/0$/,'')+'s',x+3,H-4*d);}
 if(UI.view==='spec'){const k=o.L.length+':'+o.L[0]+':'+o.L[n>>1]+':'+w;if(specK!==k){specC=spec(o,w,H);specK=k;}g.drawImage(specC,0,0);}
 else{const lanes=[[o.L,H*.27,'#4fa3ff'],[o.R,H*.71,'#5fe0ff']],amp=H*.22;
  for(const [ch,cy,col] of lanes){g.fillStyle=col;g.globalAlpha=.85;for(let x=0;x<w;x++){const a=Math.floor(x/w*n),b=Math.max(a+1,Math.floor((x+1)/w*n));let mn=1,mx=-1;for(let i=a;i<b&&i<n;i++){const v=ch[i];if(v<mn)mn=v;if(v>mx)mx=v;}if(mx<mn)continue;g.fillRect(x,cy-mx*amp,1,Math.max(1,(mx-mn)*amp));}
   g.globalAlpha=1;g.fillStyle='#22365a';g.fillRect(0,cy,w,1);}}
 g.fillStyle='#F0B24A';g.font=(10*d)+'px Exo 2, sans-serif';const seen={};
 for(const nt of o.notes){if(nt.m==null)continue;const x=Math.round(nt.t/len*w);g.globalAlpha=.6;g.fillRect(x,0,1,8*d);g.globalAlpha=1;const k=x>>4;if(!seen[k]){g.fillText(X.noteName(nt.m),x+2,11*d);seen[k]=1;}}
 if(ST.src&&ST.ctx){const t=ST.ctx.currentTime-ST.pt;if(t>=0&&t<=ST.pl){const x=t/len*w;g.fillStyle='#fff';g.fillRect(x,0,1.5*d,H);}}}
function spec(o,w,H){const c=document.createElement('canvas');c.width=w;c.height=H;const g=c.getContext('2d'),N=1024,n=o.L.length,img=g.createImageData(w,H),re=new Float64Array(N),im=new Float64Array(N),win=new Float64Array(N);
 for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/(N-1));const lo=Math.log(40),hi=Math.log(o.sr/2);
 for(let x=0;x<w;x++){const c0=Math.floor(x/w*n)-N/2;for(let i=0;i<N;i++){const j=c0+i,v=j>=0&&j<n?(o.L[j]+o.R[j])*.5:0;re[i]=v*win[i];im[i]=0;}fft(re,im);
  for(let y=0;y<H;y++){const f=Math.exp(hi-(y/H)*(hi-lo)),bin=Math.min(N/2-1,Math.round(f/o.sr*N)),m=Math.hypot(re[bin],im[bin])/N*4,dbv=20*Math.log10(m+1e-9),t=Math.max(0,Math.min(1,(dbv+90)/80));
   const p=(y*w+x)*4,[r,gg,b]=heat(t);img.data[p]=r;img.data[p+1]=gg;img.data[p+2]=b;img.data[p+3]=255;}}
 g.putImageData(img,0,0);return c;}
function heat(t){if(t<.35){const k=t/.35;return [5+10*k,9+40*k,18+90*k];}if(t<.7){const k=(t-.35)/.35;return [15+80*k,49+175*k,108+147*k];}const k=(t-.7)/.3;return [95+145*k,224-46*k,255-181*k];}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j],k=i+j+len/2,vr=re[k]*cr-im[k]*ci,vi=re[k]*ci+im[k]*cr;
   re[i+j]=ur+vr;im[i+j]=ui+vi;re[k]=ur-vr;im[k]=ui-vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}}
function drawEnv(cv,A){const {w,h:H}=fit(cv),g=cv.getContext('2d');g.fillStyle='#050912';g.fillRect(0,0,w,H);const T=X.gateOf(A)+A.r;g.strokeStyle='#4fa3ff';g.lineWidth=1.5;g.beginPath();
 for(let x=0;x<w;x++){const v=X.envAt(A,x/w*T),y=H-2-v*(H-6);x?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();g.fillStyle='#4a5f85';g.font='10px Exo 2';g.fillText(T.toFixed(3)+' s',4,11);}
const HLO=36,HHI=108;
function kitNotes(){const out=[];for(const id in ST.kit.sounds){if(id===UI.cur)continue;const r=X.fill(ST.kit.sounds[id]);for(const L of r.layers)if(L.on&&L.type!=='noise')for(const n of X.notesOf(L,kp()))if(n.m!=null)out.push(n.m);}return out;}
function drawHarm(){const cv=q('hv');if(!cv)return;const {w,h:H,d}=fit(cv),g=cv.getContext('2d'),N=HHI-HLO+1,cw=w/N,k0=X.KEYS.indexOf(ST.kit.key);g.fillStyle='#050912';g.fillRect(0,0,w,H);
 for(let m=HLO;m<=HHI;m++){const x=(m-HLO)*cw,pc=((m-k0)%12+12)%12;if(X.inScale(kp(),m)){g.fillStyle=pc===0?'#24406e':'#16284a';g.fillRect(x+1,0,cw-2,H);}
  if(pc===0){g.fillStyle='#F0B24A';g.fillRect(x+1,H-2*d,cw-2,2*d);}
  if(m%12===0){g.fillStyle='#4a5f85';g.font=(9*d)+'px Exo 2';g.fillText('C'+(m/12-1),x+2,H-5*d);}}
 const cnt={};for(const m of kitNotes())cnt[m]=(cnt[m]||0)+1;
 for(const m in cnt){if(m<HLO||m>HHI)continue;const x=(m-HLO)*cw;g.fillStyle='#5fe0ff';g.globalAlpha=.35+Math.min(.5,cnt[m]*.1);g.fillRect(x+cw*.3,4*d,cw*.4,H*.32);g.globalAlpha=1;}
 const r=curRec();if(r){const f=X.fill(r);for(const L of f.layers)if(L.on&&L.type!=='noise')for(const n of X.notesOf(L,kp())){if(n.m==null||n.m<HLO||n.m>HHI)continue;const x=(n.m-HLO)*cw;
   g.fillStyle=X.inScale(kp(),n.m)?'#F0B24A':'#ff5d5d';g.fillRect(x+cw*.15,H*.42,cw*.7,H*.28);}}}
function harmClick(e){const cv=q('hv'),b=cv.getBoundingClientRect(),m=HLO+Math.floor((e.clientX-b.left)/b.width*(HHI-HLO+1));
 playRec(P.rec('note',[P.lay('osc',{gain:-6,pitch:{mode:'hz',hz:X.hzOf(kp(),m)},amp:{a:.005,d:.5,r:.1}})],{verb:{mix:0},norm:{mode:'loud',db:-22}}),{mix:true});toast(X.noteName(m)+(X.inScale(kp(),m)?'':' (not in the scale)'),900);}
function meters(){const el=q('met');if(!el)return;const o=ST.last;if(!o){el.textContent='';return;}
 const ns=[...new Set(o.notes.filter(n=>n.m!=null).map(n=>n.m))].sort((a,b)=>a-b);
 el.innerHTML='';el.append(...[h('span',null,'Length ',h('b',null,o.len.toFixed(3)+' s')),h('span',null,'Peak ',h('b',{class:o.peak>-.3?'warn':''},o.peak.toFixed(1)+' dB')),
  h('span',null,'Loud ',h('b',null,o.loud.toFixed(1)+' dB')),o.clip?h('b',{class:'warn',title:'the loudness target would clip: the level was held at the peak'},'held at peak'):null,
  h('span',null,'Notes ',...ns.map(m=>h('b',{style:'margin-right:4px;color:'+(X.inScale(kp(),m)?'':'#ff5d5d')},X.noteName(m)))),
  h('span',{class:'sp'}),h('span',null,'render '+ST.ms.toFixed(0)+' ms')].filter(Boolean));}

// --- candidates ---
function drawCands(){const el=q('cands');el.innerHTML='';if(!ST.cands.length){el.append(h('div',{class:'hint'},'Nothing yet.'));return;}
 ST.cands.forEach((c,i)=>el.append(h('div',{class:'cand'},h('button',{class:'b ic sm',onclick:()=>playRec(c.r)},'▶'),h('span',{title:c.l},(i+1)+'. '+c.l),
  h('button',{class:'b sm gold',onclick:()=>{const r=curRec(),k=X.clone(c.r);if(r){k.takes=r.takes;k.bits=r.bits;if(!c.keepNote)k.note=r.note||k.note;}setRec(k,'use '+c.l);}},'Use'))));}
const rseed=()=>1+Math.floor(Math.random()*999999);
function genCands(cat){ST.cands=[];for(let i=0;i<6;i++){const s=rseed();ST.cands.push({l:cat+' #'+s,r:P.gen(cat,s,kp()),keepNote:false});}drawCands();playRec(ST.cands[0].r);}
function locksOf(){const L=Object.assign({},UI.locks);if(L.src){for(const t of X.SEL.type)L[t]=true;}return L;}
function mutCands(){const r=curRec();if(!r)return toast('Pick a sound with a recipe first');ST.cands=[];for(let i=0;i<6;i++){const s=rseed();ST.cands.push({l:'variation '+Math.round(UI.amt*100)+'% #'+s,r:P.mutate(r,UI.amt,s,locksOf()),keepNote:true});}drawCands();playRec(ST.cands[0].r);}

// --- game files ---
async function refreshFiles(){try{const m=await fetch('../../assets/audio/manifest.json',{cache:'no-store'}).then(r=>r.json());ST.files=m.sounds||{};}catch(e){ST.files={};}drawList();}
const abBuf={};
async function abPlay(id){const fl=ST.files[id]||[];if(!fl.length)return toast('The game has no file for '+id);const f=fl[ST.ab++%fl.length];
 try{if(!abBuf[f])abBuf[f]=await actx().decodeAudioData(await fetch('../../assets/audio/'+f,{cache:'no-store'}).then(r=>r.arrayBuffer()));playBuf(abBuf[f],{once:true});toast('game file: '+f,1400);}catch(e){toast('could not play '+f);}}

// --- export / download ---
function b64(u8){let s='';for(let i=0;i<u8.length;i+=32768)s+=String.fromCharCode.apply(null,u8.subarray(i,i+32768));return btoa(s);}
function dl(name,bytes,type){const a=h('a',{href:URL.createObjectURL(new Blob([bytes],{type:type||'audio/wav'})),download:name});document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
function dlCur(){const r=curRec();if(!r||!ST.last)return;dl(UI.cur+'_'+String(ST.take+1).padStart(2,'0')+'.wav',X.wav(ST.last,r.bits,r.master.mono));}
async function exportGame(){const r=curRec(),id=UI.cur;if(!r)return;commit(cL);const files=[];
 for(let k=0;k<r.takes;k++)files.push(X.wav(X.render(r,kp(),{take:k}),r.bits,r.master.mono));
 if(!ST.server){files.forEach((f,k)=>dl(id+'_'+String(k+1).padStart(2,'0')+'.wav',f));toast('Downloaded '+files.length+' take(s). Run node tools/sfx-server.js to export straight into the game.',4500);return;}
 try{const res=await fetch('/__sfx/export',{method:'POST',body:JSON.stringify({id,files:files.map(b64)})}).then(x=>x.json());
  if(!res.ok)return toast('Export failed: '+res.err,5000);
  ST.kit.exp=ST.kit.exp||{};ST.kit.exp[id]=recHash(r);kitSave();saveKitSrv(true);delete abBuf[res.wrote[0]];for(const w of res.wrote)delete abBuf[w];
  toast('Wrote '+res.wrote.join(', ')+(res.moved.length?'. Old files moved to '+res.backup:'')+'. Reload the game to hear it.',6000);await refreshFiles();}
 catch(e){toast('Export failed: '+e.message,5000);}}

// --- kits ---
async function saveKitSrv(quiet){ST.kit.name=q('kitName').value.trim()||'Untitled kit';kitSave();
 if(!ST.server){if(!quiet){dl(ST.kit.name+'.json',JSON.stringify(ST.kit,null,1),'application/json');toast('No server: kit downloaded as a file');}return;}
 try{const r=await fetch('/__sfx/kit/'+encodeURIComponent(ST.kit.name),{method:'POST',body:JSON.stringify(ST.kit)}).then(x=>x.json());if(!quiet)toast(r.ok?'Saved tools/sfx/kits/'+r.name+'.json':'Save failed: '+r.err);kitList();}catch(e){if(!quiet)toast('Save failed');}}
async function kitList(){const s=q('kitLoad');s.innerHTML='';s.append(h('option',{value:''},'load…'));if(!ST.server)return;
 try{const r=await fetch('/__sfx/kits').then(x=>x.json());for(const k of r.kits)s.append(h('option',{value:k},k));}catch(e){}}
function setKit(k){ST.kit=Object.assign(newKit(false),k);ST.kit.sounds=ST.kit.sounds||{};ST.kit.exp=ST.kit.exp||{};ST.hist={};ST.hi={};kitSave();headerSync();select(UI.cur);}
function headerSync(){q('kitName').value=ST.kit.name;q('kKey').value=ST.kit.key;q('kScale').value=ST.kit.scale;q('kA4').value=ST.kit.a4;}

// --- tour / group / balance ---
function tour(){const c=actx();stop();const n={};let any=0;
 for(const [id,t] of TOUR){const r=ST.kit.sounds[id];if(!r)continue;any++;const f=X.fill(r),k=(n[id]=(n[id]||0)+1)-1,cs=SND()[id];
  playBuf(bufOf(X.render(f,kp(),{take:k%f.takes})),{mix:true,when:t+.05,gain:cs&&cs.vol!=null?cs.vol:1});}
 if(!any)toast('No menu sounds in this kit yet');}
function playGroup(){const G=GROUPS.find(([,t])=>t(UI.cur||'ui_'))||GROUPS[0],ids=Object.keys(ST.kit.sounds).filter(G[1]);stop();let at=0;
 for(const id of ids){const o=X.render(ST.kit.sounds[id],kp(),{take:0});playBuf(bufOf(o),{mix:true,when:at});at+=Math.min(o.len,1.4)+.3;}toast(ids.join(' · '),Math.max(2600,at*1000));}
function balance(){let n=0;for(const id in LADDER){const r=ST.kit.sounds[id];if(!r)continue;r.master=r.master||{};r.master.norm={mode:'loud',db:LADDER[id]};n++;}
 kitSave();buildMain();sched(false);toast('Set '+n+' menu sounds on the loudness ladder (hover quietest, start loudest)');}

// --- right column wiring ---
function rightCol(){const cats=q('cats');for(const c of P.CATS)cats.append(h('button',{class:'b',onclick:()=>genCands(c)},c));
 const amt=q('amt');amt.value=UI.amt;q('amtV').textContent=Math.round(UI.amt*100)+'%';amt.oninput=()=>{UI.amt=+amt.value;q('amtV').textContent=Math.round(UI.amt*100)+'%';saveUI();};
 const LK=[['pitch','Notes'],['motion','Motion'],['amp','Envelope'],['filt','Filter'],['mod','Mods'],['src','Source'],['main','Level / pan'],['master','Master']];
 for(const [k,l] of LK)q('locks').append(h('label',null,h('input',{type:'checkbox',checked:!!UI.locks[k],onchange:e=>{UI.locks[k]=e.target.checked;saveUI();}}),'lock '+l));
 q('mut6').onclick=mutCands;
 q('mut1').onclick=()=>{const r=curRec();if(!r)return;setRec(P.mutate(r,UI.amt,rseed(),locksOf()),'mutate '+Math.round(UI.amt*100)+'%');};
 q('reseed').onclick=()=>{const r=curRec();if(!r)return;r.master.seed=1+Math.floor(Math.random()*9999);commit('new seed');buildMain();sched(true);};
 q('pHolo').onclick=()=>P.HOLO[UI.cur]?setRec(P.HOLO[UI.cur],'holographic preset'):toast('No Holographic preset for '+UI.cur);
 q('pLegacy').onclick=()=>P.LEGACY[UI.cur]?setRec(P.LEGACY[UI.cur],'game stand-in'):toast('No stand-in for '+UI.cur);
 q('pBlank').onclick=()=>setRec(blank(),'blank');
 q('pCopy').onclick=()=>{const r=curRec();if(!r)return;const s=JSON.stringify(r);(navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(()=>toast('Recipe copied'),()=>prompt('Copy this recipe',s));};
 q('pPaste').onclick=()=>{const s=prompt('Paste a recipe JSON');if(!s)return;try{setRec(JSON.parse(s),'paste');}catch(e){toast('That is not a recipe');}};
 q('kHolo').onclick=()=>{if(!confirm('Replace every menu sound in this kit with the Holographic Console versions? (each is undoable from its history)'))return;
  for(const id in P.HOLO){const cur=UI.cur;UI.cur=id;histInit();ST.kit.sounds[id]=X.clone(P.HOLO[id]);commit('holographic kit');UI.cur=cur;}buildMain();drawList();sched(false);};
 q('undo').onclick=undo;q('redo').onclick=redo;}
function header(){const k=q('kKey'),s=q('kScale');for(const n of X.KEYS)k.append(h('option',{value:n},n));for(const id in X.SCALES)s.append(h('option',{value:id},X.SCALES[id].n));
 const kit=()=>{ST.kit.key=k.value;ST.kit.scale=s.value;ST.kit.a4=Math.max(400,Math.min(480,+q('kA4').value||440));kitSave();buildMain();sched(true);};
 k.onchange=kit;s.onchange=kit;q('kA4').onchange=kit;
 const tr=d=>{const i=(X.KEYS.indexOf(ST.kit.key)+d+12)%12;ST.kit.key=X.KEYS[i];k.value=ST.kit.key;kitSave();buildMain();sched(true);toast('Kit key: '+ST.kit.key);};
 q('kDn').onclick=()=>tr(-1);q('kUp').onclick=()=>tr(1);
 q('kitName').onchange=()=>{ST.kit.name=q('kitName').value.trim()||'Untitled kit';kitSave();};
 q('kitSave').onclick=()=>saveKitSrv(false);
 q('kitLoad').onchange=async e=>{const n=e.target.value;e.target.value='';if(!n)return;if(!confirm('Load the kit "'+n+'"? The current one stays in this browser only until you save it.'))return;
  try{setKit(await fetch('kits/'+encodeURIComponent(n)+'.json',{cache:'no-store'}).then(x=>x.json()));toast('Loaded '+n);}catch(err){toast('Could not load '+n);}};
 q('kitIO').onclick=()=>dl((ST.kit.name||'kit')+'.json',JSON.stringify(ST.kit,null,1),'application/json');
 q('kitImp').onclick=()=>q('fileIn').click();
 q('fileIn').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const j=JSON.parse(await f.text());if(j.layers){setRec(j,'open '+f.name);}else setKit(j);toast('Opened '+f.name);}catch(err){toast('Not a kit or recipe file');}};
 const v=q('vol');v.value=UI.vol;v.oninput=()=>{UI.vol=+v.value;if(ST.out)ST.out.gain.value=UI.vol;saveUI();};
 q('helpB').onclick=()=>q('help').style.display='flex';
 q('find').oninput=drawList;q('tour').onclick=tour;q('playAll').onclick=playGroup;q('balance').onclick=balance;
 q('newS').onclick=()=>{const n=(prompt('Name for a free sound (letters, digits, _)')||'').toLowerCase().replace(/[^a-z0-9_]/g,'');if(!n)return;if(!ST.kit.sounds[n])ST.kit.sounds[n]=blank();UI.cur=n;kitSave();select(n);};}
document.addEventListener('keydown',e=>{const t=e.target;if(t&&t.tagName==='BUTTON'&&e.code==='Space')t.blur();const typing=t&&(t.tagName==='TEXTAREA'||t.tagName==='INPUT'&&/text|number/.test(t.type)||t.tagName==='SELECT');
 if(e.ctrlKey||e.metaKey){const k=e.key.toLowerCase();if(k==='z'&&!e.shiftKey&&!typing){e.preventDefault();undo();}else if((k==='y'||k==='z'&&e.shiftKey)&&!typing){e.preventDefault();redo();}
  else if(k==='s'){e.preventDefault();saveKitSrv(false);}else if(k==='e'){e.preventDefault();exportGame();}return;}
 if(e.code==='Space'&&!typing){e.preventDefault();if(ST.src)stop();else play();}
 if(e.key==='Escape')q('help').style.display='none';});
addEventListener('resize',()=>{specK='';drawView();drawHarm();});

// --- boot ---
async function boot(){const S=SND();ST.ids=Object.keys(S).map(id=>({id,bus:S[id].bus||'fx',syn:S[id].syn!==false}));
 if(!ST.ids.length)ST.ids=Object.keys(P.HOLO).map(id=>({id,bus:'ui',syn:true}));
 const k=load(LSK);ST.kit=k&&k.sounds?Object.assign(newKit(false),k):newKit(true);ST.kit.exp=ST.kit.exp||{};
 header();rightCol();headerSync();
 try{ST.server=(await fetch('/__sfx/ping',{cache:'no-store'}).then(r=>r.json())).ok;}catch(e){ST.server=false;}
 const sv=q('srv');sv.textContent=ST.server?'export on':'no server: downloads';sv.className='pill '+(ST.server?'ok':'no');
 sv.title=ST.server?'node tools/sfx-server.js is running: Export writes into assets/audio':'start node tools/sfx-server.js and open http://localhost:8124/tools/sfx/ to export into the game';
 kitList();if(!ST.ids.find(x=>x.id===UI.cur)&&!ST.kit.sounds[UI.cur])UI.cur='ui_move';select(UI.cur);await refreshFiles();}
window.SFXLAB={ST,UI,select,play,doRender,exportGame,genCands,mutCands,tour};
boot();
})();
