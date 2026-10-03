// audio-preview.js: render the synthesized crowd to WAV files you can listen to outside the game.
//      node tools/audio-preview.js [outDir]        (default tools/build/audio-preview/, gitignored)
// boots the real js/audio.js (auVox / auClaps / AUREACT, CONFIG.audioMix.crowd), so you hear what the game builds minus the room reverb and limiter; writes crowd_bed_calm.wav, crowd_bed_wild.wav (through the in-game lowpass), crowd_<reaction>.wav, and crowd_moment.wav (12 s: the bed building on tension, a goal roar, applause)
// prints each one's peak / RMS and render time
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(process.argv[2]||path.join(ROOT,'tools','build','audio-preview'));

function boot(){
 const ctx={console,Math,Date,JSON,Object,Array,isFinite,isNaN,Float32Array,Float64Array,
  addEventListener(){},document:{addEventListener(){},hidden:false,hasFocus:()=>true}};
 ctx.globalThis=ctx;vm.createContext(ctx);
 for(const f of ['js/core.js','js/config.js','js/audio.js'])
  new vm.Script(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}).runInContext(ctx);
 new vm.Script('globalThis.__a={AUREACT,AU_CLAP,AUC,CONFIG};').runInContext(ctx);
 return ctx;
}
function wav(file,L,R,sr){
 const n=L.length,b=Buffer.alloc(44+n*4);
 b.write('RIFF',0);b.writeUInt32LE(36+n*4,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);
 b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);
 b.write('data',36);b.writeUInt32LE(n*4,40);
 for(let i=0;i<n;i++){b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,L[i]))*32767),44+i*4);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,R[i]))*32767),46+i*4);}
 fs.writeFileSync(file,b);
}
// RBJ lowpass, the same response as a WebAudio BiquadFilterNode (Q 1/sqrt2 ≈ its default 1).
function lowpass(x,sr,fc,q=.7071){
 const w=2*Math.PI*fc/sr,al=Math.sin(w)/(2*q),cw=Math.cos(w),a0=1+al,
  b0=(1-cw)/2/a0,b1=(1-cw)/a0,b2=b0,a1=-2*cw/a0,a2=(1-al)/a0,y=new Float32Array(x.length);
 let x1=0,x2=0,y1=0,y2=0;
 for(let i=0;i<x.length;i++){const v=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=x[i];y2=y1;y1=v;y[i]=v;}
 return y;
}
const stat=(L,R)=>{let pk=0,ss=0;for(let i=0;i<L.length;i++){pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));ss+=L[i]*L[i]+R[i]*R[i];}
 const rms=Math.sqrt(ss/(2*L.length));return{pk,rms,db:20*Math.log10(rms||1e-9)};};
function render(gen){const t0=Date.now();while(!gen.step(4096));return{g:gen,ms:Date.now()-t0};}

if(require.main===module){
 const ctx=boot(),{AUREACT,AU_CLAP,AUC,CONFIG}=ctx.__a,sr=AUC.sr;ctx.CONFIG=CONFIG;
 fs.mkdirSync(OUT,{recursive:true});
 const line=(n,s,ms,gain)=>console.log('  '+(n+' '.repeat(22)).slice(0,22)+'peak '+s.pk.toFixed(2)+'  rms '+s.rms.toFixed(3)+' ('+s.db.toFixed(1)+' dB)'+
  (gain!=null?'  in game ×'+gain.toFixed(2)+' → '+(s.db+20*Math.log10(gain)).toFixed(1)+' dB':'')+'  '+ms+' ms');
 console.log('\n'+OUT+'\n');
 const beds={};
 for(const [id,o,fc,gain] of [['crowd_bed_calm',{voices:AUC.voices,seed:11,lift:0},AUC.synthLp[0],AUC.volLo],
                              ['crowd_bed_wild',{voices:Math.round(AUC.voices*1.3),seed:23,lift:1},AUC.synthLp[1],AUC.volHi]]){
  const {g,ms}=render(ctx.auVox(Object.assign({sr,secs:AUC.secs,xf:.6},o))),L=lowpass(g.L,sr,fc),R=lowpass(g.R,sr,fc);
  beds[id]={L,R};wav(path.join(OUT,id+'.wav'),L,R,sr);line(id,stat(L,R),ms,gain);}
 const one={};
 for(const k in AUREACT){const sh=AUREACT[k],{g,ms}=render(ctx.auVox({sr,seed:31,shape:sh,voices:sh.voices,lift:sh.lift}));
  one[k]=g;wav(path.join(OUT,'crowd_'+k+'.wav'),g.L,g.R,sr);line('crowd_'+k,stat(g.L,g.R),ms,ctx.CONFIG.audioMix.sounds['crowd_'+k].vol);}
 {const t0=Date.now(),g=ctx.auClaps(Object.assign({sr,seed:47},AU_CLAP));one.applause=g;
  wav(path.join(OUT,'crowd_applause.wav'),g.L,g.R,sr);line('crowd_applause',stat(g.L,g.R),Date.now()-t0,ctx.CONFIG.audioMix.sounds.crowd_applause.vol);}
 // the moment, as bedTick does it offline: excitement = base + tension (a ball pushed up the table over seconds 2-6) + exc (1 at the goal, decaying at excDecay); calm/wild crossfade on equal power; roar at 6 s, applause 1.1 s after (as Au.goal('goal') schedules)
 {const secs=12,n=sr*secs,L=new Float32Array(n),R=new Float32Array(n),C=AUC,S=ctx.CONFIG.audioMix.sounds,
   cL=beds.crowd_bed_calm,wL=beds.crowd_bed_wild,bn=cL.L.length;
  let x=0,lvl=0;
  for(let i=0;i<n;i++){const t=i/sr,ten=t<2?0:t<6?(t-2)/4:0,exc=t<6?0:Math.max(0,1-(t-6)*C.excDecay);
   x+=(Math.min(1,C.base+exc+ten*C.tension)-x)*(1-Math.exp(-1/sr/.12));
   lvl+=(C.volLo+(C.volHi-C.volLo)*x-lvl)*(1-Math.exp(-1/sr/.25));
   const a=Math.cos(x*Math.PI/2)*lvl,b=Math.sin(x*Math.PI/2)*lvl,j=i%bn;
   L[i]=cL.L[j]*a+wL.L[j%wL.L.length]*b;R[i]=cL.R[j]*a+wL.R[j%wL.R.length]*b;}
  const put=(g,at,v)=>{const o=Math.floor(at*sr);for(let i=0;i<g.L.length&&o+i<n;i++){L[o+i]+=g.L[i]*v;R[o+i]+=g.R[i]*v;}};
  put(one.roar,6,S.crowd_roar.vol);put(one.applause,7.1,S.crowd_applause.vol);
  wav(path.join(OUT,'crowd_moment.wav'),L,R,sr);line('crowd_moment',stat(L,R),0);}
 console.log('');
}
module.exports={boot,lowpass,stat};
