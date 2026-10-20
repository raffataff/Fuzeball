// SFX Lab harness. node tools/sfx-harness.js
// boots tools/sfx/engine.js + presets.js in a vm and checks the pitch maths, the render, normalising, takes, WAV, the presets and the randomiser; then mutates each and expects a failure
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ENG=fs.readFileSync(path.join(__dirname,'sfx','engine.js'),'utf8'),PRE=fs.readFileSync(path.join(__dirname,'sfx','presets.js'),'utf8');

function boot(eng,pre){const ctx={Math,JSON,Object,Array,Float32Array,Float64Array,Uint8Array,ArrayBuffer,DataView,String,Number,Set,isFinite,console};ctx.globalThis=ctx;
 vm.runInNewContext(eng+'\n;'+pre,ctx);if(!ctx.SFX||!ctx.SFX.P)throw new Error('engine did not boot');return ctx.SFX;}

function suite(X){const P=X.P,fails=[];let pass=0;const ok=(c,m)=>{if(c)pass++;else fails.push(m);};
 const D={key:'D',scale:'susPent',a4:440},C={key:'C',scale:'major',a4:440};
 // pitch
 ok(X.midiOf(D,0,5,0)===74,'D susPent deg 0 oct 5 is D5');ok(X.midiOf(D,3,5,0)===81,'deg 3 is A5');ok(X.midiOf(D,5,5,0)===86,'deg 5 is D6');
 ok(X.midiOf(D,-1,5,0)===72,'deg -1 is C5');ok(X.midiOf(D,-5,5,0)===62,'deg -5 is D4');ok(X.midiOf(C,7,4,0)===72,'C major deg 7 oct 4 is C5');ok(X.midiOf(C,2,4,1)===65,'accidental raises a semitone');
 ok(Math.abs(X.hzOf(D,81)-880)<1e-9,'A5 is 880');ok(X.inScale(D,81)&&!X.inScale(D,78),'A in D susPent, F# not');
 // notes and timing
 const arp=X.fill({layers:[{pitch:{notes:'0 2',play:'arp',step:.05,reps:2,repEvery:.2,repShift:1}}]}).layers[0],ns=X.notesOf(arp,D);
 ok(ns.length===4,'2 notes x 2 repeats');ok(Math.abs(ns[1].t-.05)<1e-9&&Math.abs(ns[2].t-.2)<1e-9,'arp step and repeat times');ok(ns[2].m===X.midiOf(D,1,5,0),'repeat shift moves up the scale');
 // envelope
 const A={a:.01,h:0,d:.2,s:0,len:0,r:.05};ok(X.envAt(A,0)===0&&Math.abs(X.envAt(A,.01)-1)<1e-9,'attack ramps 0 to 1');ok(Math.abs(X.envAt(A,.21)-.001)<2e-4,'decay is time to -60 dB');
 // a sine at A5: count zero crossings
 const sine=X.fill({layers:[{type:'osc',gain:0,pitch:{deg:3,oct:5},amp:{a:.001,h:.3,d:.1,s:1,len:.4,r:.05}}],master:{verb:{mix:0},lowcut:20,norm:{mode:'peak',db:-1}}});
 const rs=X.render(sine,D),zc=(arr,a,b)=>{let n=0;for(let i=a+1;i<b;i++)if(arr[i-1]<0&&arr[i]>=0)n++;return n;};
 ok(Math.abs(zc(rs.L,4800,4800+9600)/.2-880)<10,'sine at A5 measures 880 Hz ('+zc(rs.L,4800,14400)/.2+')');
 ok(Math.abs(rs.peak-(-1))<.05,'peak normalised to -1 dB ('+rs.peak.toFixed(2)+')');
 let bad=0;for(const v of rs.L)if(!isFinite(v))bad++;ok(!bad,'no NaN');
 // glide up a fifth of the scale (5 degrees = an octave in a pentatonic)
 const gl=X.fill(Object.assign(X.clone(sine),{}));gl.layers[0].pitch.glide={deg:5,time:.05,delay:0};const rg=X.render(gl,D);
 ok(Math.abs(zc(rg.L,9600,9600+9600)/.2-1760)<15,'glide reaches the octave ('+zc(rg.L,9600,19200)/.2+')');
 // loudness normalising
 const ld=X.clone(sine);ld.master.norm={mode:'loud',db:-20};const rl=X.render(ld,D);ok(Math.abs(rl.loud-(-20))<.15,'loud normalised to -20 ('+rl.loud.toFixed(2)+')');
 // determinism, takes, seed
 const holo=P.HOLO.ui_click,a1=X.render(holo,D),a2=X.render(holo,D),t1=X.render(holo,D,{take:1});
 ok(a1.L.length===a2.L.length&&a1.L.every((v,i)=>v===a2.L[i]),'same recipe renders the same samples');
 const s0=X.render(sine,D),s1=X.render(sine,D,{take:1});ok(s1.L.some((v,i)=>v!==s0.L[i]),'take 2 differs from take 1 (pitch / time / level jitter)');
 const nz=X.fill({layers:[{type:'noise',amp:{d:.1}}],master:{verb:{mix:0}}}),n2=X.clone(nz);n2.master.seed=2;ok(X.render(nz,D).L[100]!==X.render(n2,D).L[100],'the seed changes the noise');
 // key change transposes every note
 const kd=a1.notes.map(n=>n.m),ke=X.render(holo,{key:'D#',scale:'susPent'}).notes.map(n=>n.m);ok(kd.length&&kd.every((m,i)=>ke[i]===m+1),'kit key up a semitone moves every note up one');
 // filter
 const wn=X.fill({layers:[{type:'noise',noise:{color:'white'},amp:{a:.001,h:.2,s:1,len:.2,d:.1}}],master:{verb:{mix:0},norm:{mode:'off'},lowcut:20}}),lp=X.clone(wn);lp.layers[0].filt={type:'lp',cut:500,q:.7};
 const hf=r=>{let s=0;for(let i=1;i<r.L.length;i++){const d=r.L[i]-r.L[i-1];s+=d*d;}return s;};ok(hf(X.render(lp,D))<hf(X.render(wn,D))*.05,'lowpass at 500 Hz removes the highs');
 // tail trim
 const tr=X.render(P.HOLO.ui_move,D);ok(Math.abs(tr.L[tr.L.length-1])<1e-3,'faded to silence');
 const dl=X.fill({layers:[{pitch:{deg:3},amp:{d:.05}}],master:{verb:{mix:0},delay:{mix:.1,fb:.2,time:.11},tail:{trim:-60}}}),dn=X.clone(dl);dn.master.tail.trim=-200;
 ok(X.render(dl,D).len<X.render(dn,D).len-.05,'the quiet tail is trimmed');
 // WAV
 const w=X.wav(rs,16,false),dv=new DataView(w.buffer);ok(String.fromCharCode(w[0],w[1],w[2],w[3])==='RIFF'&&dv.getUint32(24,true)===48000&&dv.getUint16(22,true)===2,'WAV header 48k stereo');
 ok(dv.getUint32(40,true)===rs.L.length*4&&w.length===44+rs.L.length*4,'16-bit data length');
 const w24=X.wav(rs,24,true);ok(w24.length===44+rs.L.length*3&&new DataView(w24.buffer).getUint16(22,true)===1,'24-bit mono length');
 // presets: every pitched note in key (a deliberate accidental excepted)
 let off=0;for(const k in P.HOLO)for(const L of X.fill(P.HOLO[k]).layers)if(L.type!=='noise'&&!L.pitch.acc)for(const n of X.notesOf(L,D))if(!X.inScale(D,n.m))off++;ok(!off,'holographic notes all in the scale ('+off+' off)');
 const leg=X.render(P.LEGACY.ui_click,D).notes.map(n=>Math.round(X.hzOf(D,n.m)*100)/100);ok(leg[0]===880&&leg[1]===1174.66,'stand-in click is 880 then 1174.66 like audio.js');ok(X.render(P.LEGACY.ui_move,D).len<.06,'stand-in move is a 40 ms tick');
 // randomiser: every category renders, in key, and seeds differ
 let gbad=0,goff=0;for(const c of P.CATS)for(const s of [1,7]){const r=P.gen(c,s,D),o=X.render(r,D);for(let i=0;i<o.L.length;i+=7)if(!isFinite(o.L[i])){gbad++;break;}
  for(const L of r.layers)if(L.type!=='noise'&&!L.pitch.acc)for(const n of X.notesOf(L,D))if(!X.inScale(D,n.m))goff++;}
 ok(!gbad,'every category renders finite');ok(!goff,'generated notes in the scale ('+goff+' off)');
 const degs=new Set();for(let s=1;s<=20;s++)degs.add(P.gen('hover',s,D).layers[0].pitch.deg);ok(degs.size>=5,'neighbouring seeds pick different notes ('+degs.size+')');
 const sig=s=>P.gen('confirm',s,D).layers.map(l=>l.type+l.pitch.deg).join();let twins=0;for(let s=1;s<=40;s++)if(sig(s)===sig(s+1))twins++;ok(!twins,'no two neighbouring seeds make the same sound ('+twins+')');
 // mutate
 const m=P.mutate(holo,.5,3,{pitch:true,motion:true});ok(JSON.stringify(m.layers.map(l=>l.pitch))===JSON.stringify(X.fill(holo).layers.map(l=>l.pitch)),'locked pitch survives mutate');
 ok(JSON.stringify(m.layers.map(l=>l.amp))!==JSON.stringify(X.fill(holo).layers.map(l=>l.amp)),'unlocked envelope moves');
 return {pass,fails};}

const base=suite(boot(ENG,PRE));
console.log('sfx-harness: '+base.pass+' passed, '+base.fails.length+' failed');for(const f of base.fails)console.log('  FAIL '+f);

const MUT=[
 ['E','12*(oct+1)+Math.max(0,KEYS.indexOf(kit.key))','12*oct+Math.max(0,KEYS.indexOf(kit.key))'],
 ['E','o=Math.floor(deg/n),i=deg-o*n','o=Math.floor(deg/n),i=Math.abs(deg)%n'],
 ['E','g=Math.pow(10,(M.norm.db+J.gain)/20)/pk','g=Math.pow(10,(M.norm.db+J.gain)/20)'],
 ['E','g=Math.pow(10,(M.norm.db+J.gain-ld)/20)','g=Math.pow(10,(M.norm.db+J.gain)/20)'],
 ['E','if(!take)return {cents:0,time:1,filt:1,gain:0};','return {cents:0,time:1,filt:1,gain:0};'],
 ['E','v.setUint32(24,r.sr,true)','v.setUint32(24,44100,true)'],
 ['E','Math.exp(-T60*(x-A.a-A.h)/Math.max(A.d,1e-4))','Math.exp(-(x-A.a-A.h)/Math.max(A.d,1e-4))'],
 ['E',"return type==='lp'?v2:","return type==='lp'?x:"],
 ['E','const t=L.t0+(r*P.repEvery+i*P.step)*J.time','const t=L.t0+(r*P.repEvery)*J.time'],
 ['E','f=nt.hz0*Math.pow(nt.hz1/nt.hz0,e)','f=nt.hz0'],
 ['E','o[i]=y*.8;p+=dt;','o[i]=y*.8;p+=dt*1.02;'],
 ['E','let a=s>>>0;a=Math.imul(a^(a>>>16),0x85ebca6b);a=Math.imul(a^(a>>>13),0xc2b2ae35);a=((a^(a>>>16))>>>0)||1;','let a=(s>>>0)||1;'],
 ['E','const d=P.deg+offs[oi]+r*P.repShift','const d=P.deg+offs[oi]'],
 ['E','while(last>0&&Math.abs(L[last])<thr&&Math.abs(R[last])<thr)last--;',''],
 ['P','if(locks[g])continue;',''],
 ['P',"ratios:'1 3.93',decay:d*.75","ratios:'1 3.93',decay:d*3"],
];
let caught=0;
for(const [f,a,b] of MUT){const src=f==='E'?ENG:PRE;if(!src.includes(a))throw new Error('mutation anchor missing: '+a);if(a===b)throw new Error('no-op mutation');
 let r;try{r=suite(boot(f==='E'?src.replace(a,b):ENG,f==='P'?src.replace(a,b):PRE));}catch(e){r={fails:['threw']};}
 if(r.fails.length>base.fails.length)caught++;else console.log('  MUTANT SURVIVED: '+a);}
console.log('mutations: '+caught+' / '+MUT.length+' caught');
process.exitCode=base.fails.length||caught<MUT.length?1:0;
