// SFX Lab engine: recipe -> stereo samples. Pure JS, deterministic for a seed, runs in the page and in node (tools/sfx-harness.js)
'use strict';
(function(G){
const SR=48000,TAU=Math.PI*2;
const KEYS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES={
 major:  {n:'Major',s:[0,2,4,5,7,9,11]},
 minor:  {n:'Natural minor',s:[0,2,3,5,7,8,10]},
 dorian: {n:'Dorian',s:[0,2,3,5,7,9,10]},
 phryg:  {n:'Phrygian',s:[0,1,3,5,7,8,10]},
 lydian: {n:'Lydian',s:[0,2,4,6,7,9,11]},
 mixo:   {n:'Mixolydian',s:[0,2,4,5,7,9,10]},
 harmMin:{n:'Harmonic minor',s:[0,2,3,5,7,8,11]},
 majPent:{n:'Major pentatonic',s:[0,2,4,7,9]},
 minPent:{n:'Minor pentatonic',s:[0,3,5,7,10]},
 susPent:{n:'Suspended pentatonic',s:[0,2,5,7,10]},
 lydPent:{n:'Lydian pentatonic',s:[0,4,6,7,11]},
 whole:  {n:'Whole tone',s:[0,2,4,6,8,10]},
 hira:   {n:'Hirajoshi',s:[0,2,3,7,8]},
 inSen:  {n:'In-sen',s:[0,1,5,7,10]},
 chrom:  {n:'Chromatic',s:[0,1,2,3,4,5,6,7,8,9,10,11]}};
const MODAL={
 bell:'1 2.76 5.4 8.93', glass:'1 2.32 4.25 6.63 9.38', marimba:'1 3.93 9.54', bar:'1 2.756 5.404 8.933 13.344',
 crystal:'1 2.01 3.03 4.98 7.1', membrane:'1 1.594 2.136 2.296 2.653 2.918', plate:'1 1.41 2.24 2.93 3.6 4.12', harm:'1 2 3 4 5 6'};

// --- parameter schema: [path, label, kind, min, max, opts]; drives the editor, the randomiser and mutate ---
const SEL={
 type:['osc','fm','noise','pluck','modal','add'], wave:['sine','triangle','saw','square','pulse'], color:['white','pink','brown','blue','crackle'],
 play:['chord','arp','rand'], pmode:['scale','hz'], ftype:['none','lp','hp','bp','notch'], poles:[2,4], tshape:['sine','square','ramp'],
 model:Object.keys(MODAL).concat('custom'), norm:['peak','loud','off']};
const LSCHEMA={
 main:[['gain','Level dB','num',-40,6],['pan','Pan','num',-1,1],['t0','Start s','num',0,2]],
 osc:[['osc.wave','Wave','sel',SEL.wave],['osc.pw','Pulse width','num',.05,.95],['osc.uni','Unison','int',1,7],['osc.det','Detune ct','num',0,60],['osc.spread','Stereo spread','num',0,1]],
 fm:[['fm.ratio','Ratio','log',.25,16],['fm.idx','Index start','num',0,20],['fm.idxEnd','Index end','num',0,20],['fm.idxTime','Index time','log',.001,2],['fm.fb','Feedback','num',0,1],['osc.uni','Unison','int',1,7],['osc.det','Detune ct','num',0,60],['osc.spread','Stereo spread','num',0,1]],
 noise:[['noise.color','Colour','sel',SEL.color],['noise.dens','Crackle /s','log',10,20000],['osc.spread','Stereo spread','num',0,1]],
 pluck:[['pluck.decay','Ring s','log',.02,6],['pluck.bright','Bright','num',0,1]],
 modal:[['modal.model','Model','sel',SEL.model],['modal.ratios','Custom ratios','txt'],['modal.decay','Ring s','log',.02,6],['modal.tilt','High decay','num',.05,1],['modal.bright','Bright','num',0,1],['modal.hit','Mallet','num',0,1]],
 add:[['add.harm','Harmonics','txt'],['add.stretch','Stretch','num',-.05,.05],['osc.uni','Unison','int',1,7],['osc.det','Detune ct','num',0,60],['osc.spread','Stereo spread','num',0,1]],
 pitch:[['pitch.mode','Pitch','sel',SEL.pmode],['pitch.deg','Scale degree','int',-14,21],['pitch.oct','Octave','int',1,8],['pitch.acc','Accidental','int',-1,1],['pitch.hz','Hz (free)','log',20,12000],
  ['pitch.cents','Fine ct','num',-100,100],['pitch.notes','Notes (degrees)','txt'],['pitch.play','Play','sel',SEL.play],['pitch.step','Step / strum s','num',0,.5],['pitch.stepGain','Step level','num',.2,1.5],
  ['pitch.reps','Repeats','int',1,16],['pitch.repEvery','Repeat every s','num',.01,1],['pitch.repGain','Repeat level','num',.1,1.2],['pitch.repShift','Repeat shift deg','int',-7,7]],
 motion:[['pitch.penv.st','Sweep st','num',-48,48],['pitch.penv.time','Sweep time','log',.001,2],['pitch.penv.curve','Sweep curve','num',.3,6],
  ['pitch.glide.deg','Glide to deg','int',-14,14],['pitch.glide.time','Glide time','num',0,2],['pitch.glide.delay','Glide delay','num',0,2],
  ['pitch.vib.depth','Vibrato ct','num',0,100],['pitch.vib.rate','Vibrato Hz','log',.1,30],['pitch.rnd','Humanise ct','num',0,50]],
 amp:[['amp.a','Attack','log',.0005,1],['amp.h','Hold','num',0,1],['amp.d','Decay','log',.005,4],['amp.s','Sustain','num',0,1],['amp.len','Gate','num',0,4],['amp.r','Release','log',.005,4]],
 filt:[['filt.type','Filter','sel',SEL.ftype],['filt.poles','Poles','sel',SEL.poles],['filt.cut','Cutoff Hz','log',20,20000],['filt.q','Resonance','log',.3,20],['filt.track','Key track','num',0,1],
  ['filt.env','Env oct','num',-8,8],['filt.ea','Env attack','log',.0005,1],['filt.ed','Env decay','log',.005,4],['filt.lfo','LFO oct','num',0,4],['filt.lfoRate','LFO Hz','log',.1,40]],
 mod:[['mod.drive','Drive','num',0,1],['mod.ring','Ring mod','num',0,1],['mod.ringRatio','Ring ratio','log',.1,16],['mod.trem','Tremolo','num',0,1],['mod.tremRate','Trem Hz','log',.5,60],['mod.tremShape','Trem shape','sel',SEL.tshape],
  ['mod.crush','Bits (0 off)','int',0,16],['mod.down','Downsample','int',1,32],['mod.glitch','Glitch','num',0,1],['mod.glitchRate','Glitch /s','log',2,80]]};
const MSCHEMA={
 out:[['gain','Gain dB','num',-24,12],['norm.mode','Normalise','sel',SEL.norm],['norm.db','Target dB','num',-40,0],['width','Width','num',0,2],['drive','Drive','num',0,1],['mono','Mono file','bool']],
 eq:[['lowcut','Low cut Hz','log',20,2000],['shelf.f','Shelf Hz','log',500,16000],['shelf.db','Shelf dB','num',-18,12]],
 chorus:[['chorus.mix','Chorus','num',0,1],['chorus.rate','Rate Hz','log',.05,8],['chorus.depth','Depth ms','num',0,12]],
 delay:[['delay.mix','Delay','num',0,1],['delay.time','Time s','log',.01,1],['delay.fb','Feedback','num',0,.95],['delay.tone','Tone Hz','log',500,16000],['delay.ping','Ping-pong','bool']],
 verb:[['verb.mix','Reverb','num',0,1],['verb.size','Size','num',0,1],['verb.damp','Damping','num',0,1],['verb.pre','Pre-delay s','num',0,.2]],
 tail:[['tail.trim','Trim below dB','num',-100,-30],['tail.fade','Fade out s','num',0,.5],['tail.max','Max length s','num',.1,10]],
 vary:[['seed','Seed','int',1,9999],['vary.cents','Take pitch ct','num',0,100],['vary.time','Take time %','num',0,.5],['vary.filt','Take filter %','num',0,.5],['vary.gain','Take level dB','num',0,6]]};

const LDEF={on:true,solo:false,name:'',type:'osc',gain:-6,pan:0,t0:0,
 osc:{wave:'sine',pw:.5,uni:1,det:8,spread:.4},fm:{ratio:2,idx:2,idxEnd:0,idxTime:.15,fb:0},noise:{color:'white',dens:800},
 pluck:{decay:.6,bright:.6},modal:{model:'glass',ratios:'1 2.32 4.25',decay:.6,tilt:.5,bright:.45,hit:.2},add:{harm:'1 .5 .33 .25',stretch:0},
 pitch:{mode:'scale',deg:0,oct:5,acc:0,hz:440,cents:0,notes:'0',play:'chord',step:.05,stepGain:1,reps:1,repEvery:.12,repGain:.6,repShift:0,
  penv:{st:0,time:.03,curve:2},glide:{deg:0,time:0,delay:0},vib:{depth:0,rate:6},rnd:0},
 amp:{a:.001,h:0,d:.15,s:0,len:0,r:.05},
 filt:{type:'none',poles:2,cut:8000,q:.7,track:0,env:0,ea:.001,ed:.1,lfo:0,lfoRate:2},
 mod:{drive:0,ring:0,ringRatio:1.5,trem:0,tremRate:12,tremShape:'sine',crush:0,down:1,glitch:0,glitchRate:16}};
const MDEF={gain:0,norm:{mode:'peak',db:-1},width:1,drive:0,mono:false,lowcut:40,shelf:{f:8000,db:0},
 chorus:{mix:0,rate:.6,depth:3},delay:{mix:0,time:.11,fb:.25,tone:6000,ping:true},verb:{mix:.08,size:.4,damp:.5,pre:.008},
 tail:{trim:-72,fade:.01,max:6},seed:1,vary:{cents:12,time:.06,filt:.12,gain:1}};
const KDEF={name:'Untitled kit',key:'D',scale:'susPent',a4:440,sounds:{}};

const clone=o=>JSON.parse(JSON.stringify(o));
function merge(d,o){if(o==null||typeof d!=='object'||Array.isArray(d))return o==null?clone(d):o;
 const r={};for(const k in d)r[k]=merge(d[k],o[k]);for(const k in o)if(!(k in d))r[k]=o[k];return r;}
const fill=rec=>{rec=rec||{};return {v:1,name:rec.name||'',note:rec.note||'',takes:Math.max(1,Math.min(8,rec.takes|0||3)),bits:rec.bits===24?24:16,master:merge(MDEF,rec.master),layers:(rec.layers||[]).map(l=>merge(LDEF,l))};};
const getP=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);
function setP(o,p,v){const k=p.split('.'),l=k.pop();let a=o;for(const s of k)a=a[s]=a[s]||{};a[l]=v;}

// --- pitch ---
function midiOf(kit,deg,oct,acc){const sc=(SCALES[kit.scale]||SCALES.major).s,n=sc.length,o=Math.floor(deg/n),i=deg-o*n;
 return 12*(oct+1)+Math.max(0,KEYS.indexOf(kit.key))+sc[i]+12*o+(acc||0);}
const hzOf=(kit,m)=>(kit.a4||440)*Math.pow(2,(m-69)/12);
const nums=s=>String(s==null?'':s).trim().split(/[\s,]+/).filter(x=>x!=='').map(Number).filter(isFinite);
const inScale=(kit,m)=>{const sc=(SCALES[kit.scale]||SCALES.major).s,k=Math.max(0,KEYS.indexOf(kit.key));return sc.includes(((m-k)%12+12)%12);};
const noteName=m=>KEYS[((m%12)+12)%12]+(Math.floor(m/12)-1);

// --- rng ---
function rngOf(s){let a=s>>>0;a=Math.imul(a^(a>>>16),0x85ebca6b);a=Math.imul(a^(a>>>13),0xc2b2ae35);a=((a^(a>>>16))>>>0)||1;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

// --- envelopes ---
const T60=6.907755;
function gateOf(A){return Math.max(A.len>0?A.len:A.a+A.h+A.d,A.a+A.h);}
function envAt(A,t){const g=gateOf(A);
 const pre=x=>{if(x<A.a)return A.a>0?x/A.a:1;if(x<A.a+A.h)return 1;return A.s+(1-A.s)*Math.exp(-T60*(x-A.a-A.h)/Math.max(A.d,1e-4));};
 return t<=g?pre(t):pre(g)*Math.exp(-T60*(t-g)/Math.max(A.r,1e-4));}
const voiceDur=A=>gateOf(A)+Math.max(A.r,.002);

// --- the notes a layer plays: [{t, m (midi or null), hz0, hz1, g}] ---
function notesOf(L,kit,J){J=J||{time:1};const P=L.pitch,offs=nums(P.notes);if(!offs.length)offs.push(0);
 const ord=offs.map((o,i)=>i),out=[];
 for(let r=0;r<Math.max(1,P.reps|0);r++){
  let seq=ord.slice();if(P.play==='rand'){const R=rngOf(1000+r*31);for(let i=seq.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[seq[i],seq[j]]=[seq[j],seq[i]];}}
  seq.forEach((oi,i)=>{const t=L.t0+(r*P.repEvery+i*P.step)*J.time,g=Math.pow(P.stepGain,i)*Math.pow(P.repGain,r);
   if(P.mode==='hz'){const st=offs[oi]+r*P.repShift,hz=P.hz*Math.pow(2,st/12);out.push({t,m:null,hz0:hz,hz1:hz*Math.pow(2,P.glide.deg/12),g});return;}
   const d=P.deg+offs[oi]+r*P.repShift,m=midiOf(kit,d,P.oct,P.acc);
   out.push({t,m,hz0:hzOf(kit,m),hz1:hzOf(kit,midiOf(kit,d+P.glide.deg,P.oct,P.acc)),g});});}
 return out;}

// --- one voice: mono source per unison sub-voice, stereo through filter / mods / amp ---
function polyblep(t,dt){if(t<dt){t/=dt;return t+t-t*t-1;}if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;}return 0;}
function svf(){return {a:0,b:0};}
function svfStep(s,x,fc,q,type,sr){const g=Math.tan(Math.PI*Math.min(Math.max(fc,10),sr*.45)/sr),k=1/q,a1=1/(1+g*(g+k)),a2=g*a1,a3=g*a2;
 const v3=x-s.b,v1=a1*s.a+a2*v3,v2=s.b+a2*s.a+a3*v3;s.a=2*v1-s.a;s.b=2*v2-s.b;
 return type==='lp'?v2:type==='hp'?x-k*v1-v2:type==='bp'?v1*k:x-k*v1;}
function renderVoice(L,nt,J,sr,seed){
 const A={a:L.amp.a*J.time,h:L.amp.h*J.time,d:L.amp.d*J.time,s:L.amp.s,len:L.amp.len*J.time,r:L.amp.r*J.time};
 const N=Math.ceil(voiceDur(A)*sr)+1,P=L.pitch,R=rngOf(seed);
 const cents=P.cents+J.cents+(P.rnd?(R()*2-1)*P.rnd:0);
 const fr=new Float32Array(N);
 for(let i=0;i<N;i++){const t=i/sr;let f=nt.hz0;
  if(P.glide.time>0||P.glide.deg){const x=P.glide.time>0?Math.min(1,Math.max(0,(t-P.glide.delay)/P.glide.time)):(t>=P.glide.delay?1:0),e=x*x*(3-2*x);f=nt.hz0*Math.pow(nt.hz1/nt.hz0,e);}
  let st=0;if(P.penv.st){const x=Math.min(1,t/Math.max(P.penv.time,1e-4));st=P.penv.st*Math.pow(1-x,P.penv.curve);}
  let c=cents;if(P.vib.depth)c+=P.vib.depth*Math.sin(TAU*P.vib.rate*t)*Math.min(1,t/.05);
  fr[i]=Math.min(f*Math.pow(2,st/12+c/1200),sr*.49);}
 const O=L.osc,U=(L.type==='osc'||L.type==='fm'||L.type==='add')?Math.max(1,O.uni|0):L.type==='noise'?(O.spread>0?2:1):1;
 const vl=new Float32Array(N),vr=new Float32Array(N),src=new Float32Array(N);
 for(let u=0;u<U;u++){const sp=U>1?(u/(U-1))*2-1:0,det=Math.pow(2,sp*O.det/1200),pan=Math.max(-1,Math.min(1,sp*O.spread));
  src.fill(0);source(L,src,fr,det,sr,rngOf(seed*31+u+1),u);
  const gl=Math.cos((pan+1)*Math.PI/4),gr=Math.sin((pan+1)*Math.PI/4),nrm=1/Math.sqrt(U);
  for(let i=0;i<N;i++){vl[i]+=src[i]*gl*nrm*1.4142;vr[i]+=src[i]*gr*nrm*1.4142;}}
 const F=L.filt,M=L.mod,out=[vl,vr],GR=rngOf(seed*7+3);
 const gslices=[];if(M.glitch>0){const sl=Math.max(1,Math.round(sr/M.glitchRate));for(let s=0;s*sl<N;s++){const r=GR();gslices.push(r<M.glitch?(GR()<.5?0:1):2);}}
 for(let ch=0;ch<2;ch++){const x=out[ch],f1=svf(),f2=svf();let pr=0,hold=0,hc=0;
  const k=1+M.drive*9,tk=Math.tanh(k),q=Math.pow(2,Math.max(1,M.crush)-1);
  for(let i=0;i<N;i++){const t=i/sr;let y=x[i];
   if(M.drive>0)y=Math.tanh(y*k)/tk;
   if(F.type!=='none'){let fc=F.cut*J.filt;if(F.track)fc*=Math.pow(fr[i]/440,F.track);
    if(F.env){const e=t<F.ea?t/Math.max(F.ea,1e-5):Math.exp(-T60*(t-F.ea)/Math.max(F.ed,1e-4));fc*=Math.pow(2,F.env*e);}
    if(F.lfo)fc*=Math.pow(2,F.lfo*Math.sin(TAU*F.lfoRate*t));
    y=svfStep(f1,y,fc,F.q,F.type,sr);if(+F.poles===4)y=svfStep(f2,y,fc,Math.SQRT1_2,F.type,sr);}
   if(M.ring>0){pr+=fr[i]*M.ringRatio/sr;y*=1-M.ring+M.ring*Math.sin(TAU*pr);}
   if(M.crush>0)y=Math.round(y*q)/q;
   if(M.down>1){if(hc++%M.down===0)hold=y;y=hold;}
   if(M.trem>0){const ph=(M.tremRate*t)%1,w=M.tremShape==='square'?(ph<.5?1:0):M.tremShape==='ramp'?1-ph:.5-.5*Math.cos(TAU*ph);y*=1-M.trem*w;}
   x[i]=y;}}
 if(gslices.length){const sl=Math.max(1,Math.round(sr/M.glitchRate));
  for(let ch=0;ch<2;ch++){const x=out[ch],c=x.slice();for(let s=0;s<gslices.length;s++)for(let j=0;j<sl;j++){const i=s*sl+j;if(i>=N)break;
   x[i]=gslices[s]===0?0:gslices[s]===1&&s>0?c[i-sl]:c[i];}}}
 for(let i=0;i<N;i++){const e=envAt(A,i/sr);vl[i]*=e;vr[i]*=e;}
 return {l:vl,r:vr,N};}

function source(L,o,fr,det,sr,R,u){const N=o.length;
 if(L.type==='osc'){const w=L.osc.wave,pw=L.osc.pw;let p=R();if(w==='sine'||w==='triangle')p=u?R():0;
  for(let i=0;i<N;i++){const dt=fr[i]*det/sr;let y;
   if(w==='sine')y=Math.sin(TAU*p);else if(w==='triangle')y=1-4*Math.abs(p-.5);
   else if(w==='saw')y=2*p-1-polyblep(p,dt);
   else{const d=w==='square'?.5:pw;y=(p<d?1:-1)+polyblep(p,dt)-polyblep((p-d+1)%1,dt);}
   o[i]=y*.8;p+=dt;if(p>=1)p-=1;}}
 else if(L.type==='fm'){const F=L.fm;let pc=u?R():0,pm=0,last=0;
  for(let i=0;i<N;i++){const t=i/sr,f=fr[i]*det,I=F.idxEnd+(F.idx-F.idxEnd)*Math.exp(-t*3/Math.max(F.idxTime,1e-4));
   const m=Math.sin(TAU*pm+F.fb*last*Math.PI);last=m;o[i]=Math.sin(TAU*pc+I*m)*.8;pc+=f/sr;pm+=f*F.ratio/sr;pc%=1;pm%=1;}}
 else if(L.type==='noise'){const c=L.noise.color;let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,br=0,prev=0;const pd=L.noise.dens/sr;
  for(let i=0;i<N;i++){const w=R()*2-1;let y;
   if(c==='pink'){b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;y=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11;b6=w*.115926;}
   else if(c==='brown'){br=(br+.02*w)/1.02;y=br*3.5;}
   else if(c==='blue'){y=(w-prev)*.5;prev=w;}
   else if(c==='crackle'){y=R()<pd?(R()*2-1):0;}
   else y=w*.6;
   o[i]=y;}}
 else if(L.type==='pluck'){const K=L.pluck,B=new Float32Array(8192),mask=8191,P0=sr/fr[0];let w=0,lp=0;
  const fill=Math.min(8000,Math.ceil(P0)+2),a=.05+.9*K.bright;for(let j=0;j<fill;j++){lp+=a*((R()*2-1)-lp);B[j]=lp;}w=fill;
  const g=Math.pow(10,-3/(Math.max(K.decay,.005)*sr)),damp=.5+.45*K.bright;let prev=0;
  for(let i=0;i<N;i++){const per=Math.min(8000,sr/fr[i]),rp=w-per,i0=Math.floor(rp),fr0=rp-i0;
   const y=B[i0&mask]*(1-fr0)+B[(i0+1)&mask]*fr0,f=g*(damp*y+(1-damp)*prev);prev=y;B[w&mask]=f;w++;o[i]=y;}}
 else if(L.type==='modal'){const K=L.modal,rat=nums(K.model==='custom'?K.ratios:MODAL[K.model]||K.ratios);
  for(let k=0;k<rat.length;k++){const amp=Math.pow(K.bright,k),T=Math.max(K.decay,.005)*Math.pow(K.tilt,k);let p=u?R():0;if(amp<1e-4)continue;
   for(let i=0;i<N;i++){const f=fr[i]*det*rat[k];if(f>sr*.45)break;o[i]+=Math.sin(TAU*p)*amp*Math.exp(-T60*i/sr/T);p+=f/sr;}}
  if(K.hit>0){const n=Math.min(N,Math.round(sr*.004));let lp=0;for(let i=0;i<n;i++){lp+=.5*((R()*2-1)-lp);o[i]+=lp*K.hit*(1-i/n);}}
  for(let i=0;i<N;i++)o[i]*=.55;}
 else if(L.type==='add'){const H=nums(L.add.harm),S=L.add.stretch;
  for(let k=0;k<H.length;k++){if(!H[k])continue;const m=Math.pow(k+1,1+S);let p=u?R():0;
   for(let i=0;i<N;i++){const f=fr[i]*det*m;if(f>sr*.45)break;o[i]+=Math.sin(TAU*p)*H[k];p+=f/sr;}}
  let s=0;for(const h of H)s+=Math.abs(h);const n=.8/Math.max(1,s*.7);for(let i=0;i<N;i++)o[i]*=n;}}

// --- master effects ---
function biquad(type,f,q,db,sr){const w=TAU*f/sr,c=Math.cos(w),s=Math.sin(w),al=s/(2*q),A=Math.pow(10,db/40);let b0,b1,b2,a0,a1,a2;
 if(type==='hp'){b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+al;a1=-2*c;a2=1-al;}
 else{const sq=2*Math.sqrt(A)*al;b0=A*((A+1)+(A-1)*c+sq);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-sq);a0=(A+1)-(A-1)*c+sq;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-sq;}
 return {b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0};}
function bq(x,k){let x1=0,x2=0,y1=0,y2=0;for(let i=0;i<x.length;i++){const y=k.b0*x[i]+k.b1*x1+k.b2*x2-k.a1*y1-k.a2*y2;x2=x1;x1=x[i];y2=y1;y1=y;x[i]=y;}}
function chorus(L,R,C,sr){const n=L.length,B=4096,bl=new Float32Array(B),br=new Float32Array(B);
 for(let i=0;i<n;i++){bl[i%B]=L[i];br[i%B]=R[i];const t=i/sr;
  const rd=(ph,b)=>{const d=(.012+C.depth/1000*(.5+.5*Math.sin(TAU*C.rate*t+ph)))*sr,p=i-d,i0=Math.floor(p),f=p-i0;return i0<0?0:b[((i0%B)+B)%B]*(1-f)+b[((i0+1)%B+B)%B]*f;};
  const wl=rd(0,bl),wr=rd(Math.PI/2,br);L[i]=L[i]*(1-C.mix*.5)+wl*C.mix*.5;R[i]=R[i]*(1-C.mix*.5)+wr*C.mix*.5;}}
function delay(L,R,D,sr){const n=L.length,d=Math.max(1,Math.round(D.time*sr)),B=d+1,bl=new Float32Array(B),br=new Float32Array(B),a=1-Math.exp(-TAU*D.tone/sr);let ll=0,lr=0;
 for(let i=0;i<n;i++){const j=i%B,yl=bl[j],yr=br[j];ll+=a*(yl-ll);lr+=a*(yr-lr);
  if(D.ping){bl[j]=(L[i]+R[i])*.5+D.fb*lr;br[j]=D.fb*ll;}else{bl[j]=L[i]+D.fb*ll;br[j]=R[i]+D.fb*lr;}
  L[i]+=yl*D.mix;R[i]+=yr*D.mix;}}
function reverb(L,R,V,sr){const n=L.length,sc=sr/44100,CT=[1116,1188,1277,1356,1422,1491,1557,1617],AT=[556,441,341,225],SP=23;
 const fb=.7+.28*V.size,dp=V.damp*.4,pre=Math.round(V.pre*sr);
 const mk=(t,o)=>({b:new Float32Array(Math.round((t+o)*sc)),i:0,s:0});
 const ch=[0,SP].map(o=>({c:CT.map(t=>mk(t,o)),a:AT.map(t=>mk(t,o))}));
 const inp=new Float32Array(n);for(let i=0;i<n;i++){const j=i-pre;inp[i]=j>=0?(L[j]+R[j])*.5*.015:0;}
 const out=[L,R];
 ch.forEach((C,k)=>{const o=out[k];for(let i=0;i<n;i++){let y=0;const x=inp[i];
  for(const c of C.c){const v=c.b[c.i];c.s=v*(1-dp)+c.s*dp;c.b[c.i]=x+c.s*fb;if(++c.i>=c.b.length)c.i=0;y+=v;}
  for(const a of C.a){const v=a.b[a.i];const w=-y+v;a.b[a.i]=y+v*.5;if(++a.i>=a.b.length)a.i=0;y=w;}
  o[i]+=y*V.mix*3;}});}
function tailOf(M){let t=0;if(M.verb.mix>0)t=Math.max(t,.25+3*M.verb.size*M.verb.size*(1-.5*M.verb.damp)+M.verb.pre);
 if(M.delay.mix>0&&M.delay.fb>0)t=Math.max(t,Math.min(5,M.delay.time*(Math.log(.001)/Math.log(M.delay.fb)+1)));else if(M.delay.mix>0)t=Math.max(t,M.delay.time+.02);
 if(M.chorus.mix>0)t+=.03;return t;}
function loudOf(L,R,sr){const w=Math.round(sr*.05),n=L.length;let best=0,acc=0;
 const e=i=>(L[i]*L[i]+R[i]*R[i])*.5;for(let i=0;i<n;i++){acc+=e(i);if(i>=w)acc-=e(i-w);if(i>=w-1||i===n-1)best=Math.max(best,acc/Math.min(w,i+1));}
 return best>0?10*Math.log10(best):-120;}
function peakOf(L,R){let p=0;for(let i=0;i<L.length;i++)p=Math.max(p,Math.abs(L[i]),Math.abs(R[i]));return p;}
const db=x=>x>0?20*Math.log10(x):-120;

// --- the whole render ---
function jitterOf(V,take,seed){if(!take)return {cents:0,time:1,filt:1,gain:0};const R=rngOf(seed*7919+take*104729);const s=()=>R()*2-1;
 return {cents:s()*V.cents,time:1+s()*V.time,filt:1+s()*V.filt,gain:s()*V.gain};}
function render(rec,kit,opt){opt=opt||{};rec=fill(rec);kit=Object.assign({},KDEF,kit||{});
 const sr=opt.sr||SR,M=rec.master,take=opt.take|0,J=jitterOf(M.vary,take,M.seed|0),solo=rec.layers.some(l=>l.on&&l.solo);
 const live=rec.layers.filter(l=>l.on&&(!solo||l.solo)),voices=[];
 live.forEach((L,li)=>notesOf(L,kit,J).forEach((nt,ni)=>voices.push({L,nt,seed:(M.seed|0)*1000003+take*7717+li*131+ni*17+1})));
 const A0=L=>({a:L.amp.a*J.time,h:L.amp.h*J.time,d:L.amp.d*J.time,s:L.amp.s,len:L.amp.len*J.time,r:L.amp.r*J.time});
 let end=.02;for(const v of voices)end=Math.max(end,v.nt.t+voiceDur(A0(v.L)));
 const len=Math.min(M.tail.max,end+tailOf(M)),n=Math.max(1,Math.ceil(len*sr));
 const L=new Float32Array(n),R=new Float32Array(n);
 for(const v of voices){const V=renderVoice(v.L,v.nt,J,sr,v.seed),off=Math.round(v.nt.t*sr),g=Math.pow(10,v.L.gain/20)*v.nt.g;
  const pl=Math.cos((v.L.pan+1)*Math.PI/4)*1.4142,pr=Math.sin((v.L.pan+1)*Math.PI/4)*1.4142;
  for(let i=0;i<V.N&&off+i<n;i++){L[off+i]+=V.l[i]*g*Math.min(pl,1.4142);R[off+i]+=V.r[i]*g*Math.min(pr,1.4142);}}
 if(M.drive>0){const k=1+M.drive*6,tk=Math.tanh(k);for(let i=0;i<n;i++){L[i]=Math.tanh(L[i]*k)/tk;R[i]=Math.tanh(R[i]*k)/tk;}}
 if(M.lowcut>20){const k=biquad('hp',M.lowcut,Math.SQRT1_2,0,sr);bq(L,k);bq(R,k);}
 if(M.shelf.db){const k=biquad('shelf',M.shelf.f,Math.SQRT1_2,M.shelf.db,sr);bq(L,k);bq(R,k);}
 if(M.chorus.mix>0)chorus(L,R,M.chorus,sr);
 if(M.delay.mix>0)delay(L,R,M.delay,sr);
 if(M.verb.mix>0)reverb(L,R,M.verb,sr);
 if(M.width!==1||M.mono){const w=M.mono?0:M.width;for(let i=0;i<n;i++){const m=(L[i]+R[i])*.5,s=(L[i]-R[i])*.5*w;L[i]=m+s;R[i]=m-s;}}
 let g=Math.pow(10,(M.gain+J.gain)/20);const pk=peakOf(L,R),ld=loudOf(L,R,sr);
 if(M.norm.mode==='peak'&&pk>0)g=Math.pow(10,(M.norm.db+J.gain)/20)/pk;
 else if(M.norm.mode==='loud'&&ld>-120)g=Math.pow(10,(M.norm.db+J.gain-ld)/20);
 let clip=false;if(pk*g>.98){g=.98/pk;clip=M.norm.mode!=='peak';}
 for(let i=0;i<n;i++){L[i]*=g;R[i]*=g;}
 const thr=pk*g*Math.pow(10,M.tail.trim/20);let last=n-1;while(last>0&&Math.abs(L[last])<thr&&Math.abs(R[last])<thr)last--;
 const fade=Math.round(M.tail.fade*sr),cut=Math.min(n,last+1+fade);
 const oL=L.slice(0,cut),oR=R.slice(0,cut);for(let i=0;i<fade&&i<cut;i++){const k=cut-1-i,f=i/fade;oL[k]*=f;oR[k]*=f;}
 const notes=[];live.forEach((L2,li)=>L2.type!=='noise'&&notesOf(L2,kit,J).forEach(nt=>notes.push({layer:li,t:nt.t,m:nt.m,hz:nt.hz0})));
 return {L:oL,R:oR,sr,len:cut/sr,peak:db(peakOf(oL,oR)),loud:loudOf(oL,oR,sr),clip,notes,mono:!!M.mono};}

// --- WAV ---
function wav(r,bits,mono){bits=bits||16;const ch=mono?1:2,n=r.L.length,bp=bits/8,data=n*ch*bp,b=new ArrayBuffer(44+data),v=new DataView(b);
 const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,36+data,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);
 v.setUint32(24,r.sr,true);v.setUint32(28,r.sr*ch*bp,true);v.setUint16(32,ch*bp,true);v.setUint16(34,bits,true);str(36,'data');v.setUint32(40,data,true);
 let o=44;const full=Math.pow(2,bits-1)-1;
 for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const s=Math.max(-1,Math.min(1,mono?(r.L[i]+r.R[i])*.5:c?r.R[i]:r.L[i])),q=Math.round(s*full);
  if(bits===16)v.setInt16(o,q,true);else{v.setUint8(o,q&255);v.setUint8(o+1,(q>>8)&255);v.setUint8(o+2,(q>>16)&255);}o+=bp;}
 return new Uint8Array(b);}

const API={SR,KEYS,SCALES,MODAL,SEL,LSCHEMA,MSCHEMA,LDEF,MDEF,KDEF,clone,merge,fill,getP,setP,midiOf,hzOf,inScale,noteName,nums,rngOf,envAt,gateOf,notesOf,render,wav};
G.SFX=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof globalThis!=='undefined'?globalThis:this);
