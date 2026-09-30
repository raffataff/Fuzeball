'use strict';
/* ================= audio (WebAudio: recorded takes where they exist, synthesis where they don't) ================= */
/* rate / vol are GLOBAL modifiers applied by the primitives (beep, noise, fire) and by post.
   Both sit at 1 for all live play; the goal replay sets them around its sound-fire loop and
   resets them in the same breath (js/replay.js replaySndUpdate), so nothing can leak a
   detuned Au into the next rally. rate is a tape-speed multiplier — frequencies scale with
   it and every duration scales inversely, so rate<1 is a slower, deeper, softer-attack
   version of the same hit rather than a different sound. */

/* ---- SAMPLES OVER SYNTHESIS -----------------------------------------------
   Every sound has an id (CONFIG.audioMix.sounds). Au.play(id) plays a recorded take from
   assets/audio/ when the manifest lists one, and returns false when it doesn't, so each caller
   falls through to its synthesized version. An empty folder is therefore a complete game, and a
   recording session replaces sounds one id at a time with no code change.
   What synthesis is still FOR: things that are a continuous function of play (the roll, the
   charge wind-up) and stand-ins. What it is bad at: anything organic. That's why the crowd is
   no longer filtered noise (which reads as wind) but a room of synthesized VOICES (auVox).

   Where a sound lands: every one-shot goes through route(), which pans it by where the ball is
   on screen (auPanOf) and sends some of it into the current room's reverb. The room reverb is a
   convolver per bus (fx, crowd) whose impulse is generated from CONFIG.audioMix.reverb (auIR),
   or a recorded ir_<room>. */

/* ---- CONTACT SOUND MODEL -------------------------------------------------
   An IMPACT is an EVENT; a ROLL is a STATE. Every shipped physics game draws this line
   (Unity calls it OnCollisionEnter vs OnCollisionStay; FMOD/Wwise ship the one-shot half
   with "min time between instances" + "max instances" built in). Fuzeball used to have only
   the event half, and the wall bounce had no velocity gate at all, so a ball hugging a wall
   re-fired a full 45ms noise burst on EVERY substep — 3-7 per rendered frame, up to ~420 a
   second. Identical transients landing 2-15ms apart comb-filter into a metallic buzzsaw,
   which is exactly what it sounded like.

   The split now is:
     IMPACT  physics.js hitFresh() — fires once, only on a contact that is genuinely NEW
             (that surface was clear for PHY.contactHold) and hard enough to clear the
             surface threshold. vgate() below adds a cooldown + concurrent-voice cap as a
             backstop so a multiball scramble can't stack twenty copies into a wall of noise.
     ROLL    physics.js rollProbe() → Au.rollFeed() → Au.rollTick(). Two permanently-running
             looping voices (floor, wall) sitting at gain 0. While a ball stays in contact
             they're driven by how fast it travels ALONG the surface: level, filter cutoff
             and grain rate all track speed, attack fast / release slow so the roll appears
             on contact and doesn't chatter between probe misses.
   Cost of the roll layer: two BufferSources that never stop, and a handful of AudioParam
   writes per frame. Cheaper than the burst it replaces — the old noise() allocated and
   Math.random()-filled a fresh AudioBuffer per hit (~2k random() calls), hundreds of times
   a second. Everything now plays random slices of one shared 3s buffer built at init. */

/* ---- pure helpers (no WebAudio; tools/audio-harness.js and tools/audio-preview.js run them) ---- */
// Seeded, so a rendered crowd or impulse is the same every boot and a harness can measure it.
// Cosmetic, so it is NOT on rng.js: nothing here changes an outcome.
function auRng(s){s=(s>>>0)||1;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Piecewise-linear lookup in [[t,v],...].
function auLin(p,t){if(t<=p[0][0])return p[0][1];
 for(let i=1;i<p.length;i++)if(t<=p[i][0]){const a=p[i-1],b=p[i];return a[1]+(b[1]-a[1])*(t-a[0])/Math.max(1e-9,b[0]-a[0]);}
 return p[p.length-1][1];}
// Round-robin that never plays the same take twice running: uniform over the OTHERS.
function auPick(n,last,r){if(n<2)return 0;if(!(last>=0&&last<n))return Math.floor(r*n)%n;let k=Math.floor(r*(n-1));if(k>=last)k++;return k;}
// -1..1 = where a world position sits across the screen. From the camera, not the table, so a sound
// stays with the ball through every camera mode and the replay's. Behind the camera is clamped.
const _auV=typeof THREE!=='undefined'?new THREE.Vector3():null;
function auPanOf(s){
 if(!_auV||typeof camera==='undefined'||!camera||!s)return 0;
 const p=s.m?s.m.position:s;if(!p||!(p.x===p.x))return 0;
 _auV.set(p.x,p.y||0,p.z).applyMatrix4(camera.matrixWorldInverse);
 const h=Math.max(1,-_auV.z)*Math.tan((camera.fov||55)*Math.PI/360)*(camera.aspect||1.6);
 return Math.max(-1,Math.min(1,_auV.x/h));}

/* A room impulse: stereo noise under an exponential decay reaching -60 dB at A.decay, through a
   lowpass that closes as the tail goes on (air and soft surfaces eat the top end first), plus a
   few discrete first reflections. The noise is divided by the lowpass's own gain, so closing the
   filter darkens the tail without also shortening it: decay stays the real RT60. */
function auIR(sr,A,seed){
 const T=Math.max(.05,A.decay),pre=Math.floor(sr*(A.pre||0)),n=pre+Math.ceil(sr*T*1.1),k=6.9078/T,
  out=[new Float32Array(n),new Float32Array(n)];
 for(let ch=0;ch<2;ch++){const d=out[ch],rnd=auRng((seed||1)*2+ch);let lp=0;
  for(let i=pre;i<n;i++){const t=(i-pre)/sr,fc=Math.max(120,(A.damp||5000)*Math.exp(-t*(A.darken||0))),
    a=1-Math.exp(-6.283185*fc/sr);
   lp+=((rnd()*2-1)-lp)*a;
   d[i]=lp/Math.sqrt(a/(2-a))*Math.exp(-k*t)*Math.min(1,(i-pre)/(sr*.002));}
  const er=A.early||0;   // first reflections: a handful of taps inside 30ms, different per ear
  for(let j=0;j<6&&er>0;j++){const i=pre+Math.floor(sr*(.002+rnd()*.028));if(i<n)d[i]+=er*(rnd()<.5?-1:1)*(1-j*.12)*1.5;}
  const f=Math.floor(n*.05);for(let i=0;i<f;i++)d[n-1-i]*=i/f;   // taper the last 5%: never end on a step
 }
 return out;}

/* ---- SYNTHESIZED VOICES: the stand-in crowd -----------------------------------------
   A crowd is people, so it is built from voices. Each voice is a band-limited sawtooth (a
   glottis) at its own pitch; voices share a few VOWEL FILTERS (three formant resonators each,
   gliding between vowels), and a group sits at its own place in the stereo field, some of them
   far off (quieter, duller). In talk mode every voice speaks in syllables and phrases with
   pauses, and 36 of them at once is room murmur. In shape mode every voice follows one envelope,
   pitch contour and vowel path with its own onset, which is what a crowd reaction is: an "ooh"
   is thirty people saying oo at once, rising and falling. `lift` = excitement: higher pitch, more
   open vowels, faster syllables, shorter pauses.
   Rendered in slices (step) so building it never stalls a frame; 24 kHz is plenty for voices. */
const AU_VOW={a:[730,1090,2440],e:[530,1840,2480],i:[300,2240,2900],o:[570,840,2410],u:[320,900,2380],
 ae:[660,1720,2410],uh:[520,1190,2390],er:[490,1350,1690],aw:[640,1000,2400]};
function auVowAt(path,t,out){
 let a=path[0],b=a;for(let i=1;i<path.length;i++){if(t<path[i][0]){b=path[i];break;}a=b=path[i];}
 const u=b===a?0:Math.max(0,Math.min(1,(t-a[0])/Math.max(1e-9,b[0]-a[0]))),fa=AU_VOW[a[1]],fb=AU_VOW[b[1]];
 for(let k=0;k<3;k++)out[k]=fa[k]+(fb[k]-fa[k])*u;return out;}
function auVox(o){
 const sr=o.sr||24000,dt=1/sr,rnd=auRng(o.seed||7),sh=o.shape||null,lift=o.lift||0,
  len=Math.floor(sr*(sh?sh.len:(o.secs||8))),xf=sh?0:Math.floor(sr*(o.xf||.5)),N=len+xf,
  NV=o.voices||36,G=Math.max(1,Math.min(NV,o.groups||12)),VK=Object.keys(AU_VOW),OPEN=['a','ae','aw','e'],
  BW=[90,110,170],FG=[1,.5,.28],BLK=32,L=new Float32Array(N),R=new Float32Array(N);
 const vowel=()=>AU_VOW[(lift>0&&rnd()<lift*.6)?OPEN[(rnd()*OPEN.length)|0]:VK[(rnd()*VK.length)|0]];
 const gs=[];
 for(let g=0;g<G;g++){const far=g>=Math.round(G*(1-(o.far??.35))),p=(rnd()*2-1)*.85,v=vowel();
  gs.push({far,gl:Math.cos((p+1)*Math.PI/4),gr:Math.sin((p+1)*Math.PI/4),lvl:far?.5:1,
   f:v.slice(),tf:v.slice(),vt:rnd()*.2,own:rnd()<.35,x:0,lp:0,
   s:new Float64Array(12),c:new Float64Array(9)});}   // per formant: x1,x2,y1,y2 | b0,a1,a2
 const vs=[];
 for(let i=0;i<NV;i++){const fem=rnd()<.45;
  vs.push({g:gs[i%G],f0:(fem?160+rnd()*75:90+rnd()*55)*(1+lift*.3)*(sh?1+(rnd()*2-1)*.08:1),
   ph:rnd(),lvl:.5+rnd()*.5,on:rnd()<.55,st:rnd()*2,sy:rnd(),sd:.18,acc:1,env:0,tgt:0,
   on0:sh?rnd()*(sh.jit||.1):0,vib:rnd()*6.283,vr:4.5+rnd()*2,wan:1,f:100});}
 const coef=g=>{for(let k=0;k<3;k++){const f=g.f[k],w=6.283185*Math.min(f,sr*.45)/sr,Q=f/(BW[k]*(g.far?1.4:1)),
   al=Math.sin(w)/(2*Q),a0=1+al;g.c[k*3]=al/a0;g.c[k*3+1]=-2*Math.cos(w)/a0;g.c[k*3+2]=(1-al)/a0;}};
 gs.forEach(coef);
 const vk=1-Math.exp(-BLK*dt/.04),ek=1-Math.exp(-dt/.012),flp=1-Math.exp(-6.283185*1600/sr);
 const blk=t=>{
  for(const g of gs){
   if(sh){if(!(g.own&&sh.mix))auVowAt(sh.vow,Math.max(0,t-g.vt*.3),g.tf);}
   else if((g.vt-=BLK*dt)<=0){g.vt=(.09+rnd()*.22)*(1-lift*.3);g.tf=vowel().slice();}
   for(let k=0;k<3;k++)g.f[k]+=(g.tf[k]-g.f[k])*vk;
   coef(g);}
  for(const v of vs){
   if(sh){const tt=t-v.on0;v.tgt=tt<0?0:auLin(sh.env,tt);
    v.wan=Math.max(.86,Math.min(1.16,v.wan*(1+(rnd()*2-1)*(sh.wander||0))));}
   else if((v.st-=BLK*dt)<=0){v.on=!v.on;v.st=v.on?.8+rnd()*2.6*(1-lift*.3):.2+rnd()*1.4*(1-lift*.7);}
   v.vib+=BLK*dt*v.vr*6.283;
   const pm=1+.012*Math.sin(v.vib);
   v.f=sh?v.f0*auLin(sh.pit,Math.max(0,t-v.on0))*v.wan*pm:v.f0*v.acc*pm;}
 };
 let i=0;
 return {sr,L:null,R:null,done:false,
  step(k){if(this.done)return true;const e=Math.min(N,i+k);
   for(;i<e;i++){const t=i*dt;if(i%BLK===0)blk(t);
    for(const v of vs){
     let a;
     if(sh)a=v.tgt;
     else{v.sy+=dt/v.sd;if(v.sy>=1){v.sy-=1;v.sd=(.11+rnd()*.17)*(1-lift*.25);v.acc=.8+rnd()*.4;}
      a=v.on?4*v.sy*(1-v.sy):0;}
     v.env+=(a-v.env)*ek;                                  // smoothed: no clicks at phrase edges
     if(v.env<1e-4)continue;
     const d=v.f*(sh?1:1-.06*v.sy)*dt;                     // talk: each syllable falls a little
     v.ph+=d;if(v.ph>=1)v.ph-=1;
     let s=2*v.ph-1;                                       // polyBLEP sawtooth: no aliasing whine
     if(v.ph<d){const u=v.ph/d;s-=u+u-u*u-1;}else if(v.ph>1-d){const u=(v.ph-1)/d;s-=u*u+u+u+1;}
     if(sh){if(sh.breath)s=s*(1-sh.breath)+(rnd()*2-1)*sh.breath*1.6;else if(lift>.5)s+=(rnd()*2-1)*.25*lift;}
     else if(v.on&&v.sy<.1)s+=(rnd()*2-1)*.6*(1-v.sy*10);   // a consonant at each syllable's start
     v.g.x+=s*v.env*v.lvl;}
    let l=0,r=0;
    for(const g of gs){const x=g.x,S2=g.s,C=g.c;g.x=0;let y=0;
     for(let q=0;q<3;q++){const o4=q*4,o3=q*3,yy=C[o3]*(x-S2[o4+1])-C[o3+1]*S2[o4+2]-C[o3+2]*S2[o4+3];
      S2[o4+1]=S2[o4];S2[o4]=x;S2[o4+3]=S2[o4+2];S2[o4+2]=yy;y+=yy*FG[q];}
     if(g.far){g.lp+=(y-g.lp)*flp;y=g.lp;}
     y*=g.lvl;l+=y*g.gl;r+=y*g.gr;}
    L[i]=l;R[i]=r;}
   if(i>=N)this.fin();
   return this.done;},
  fin(){
   const hp=1-Math.exp(-6.283185*90/sr);
   for(const d of [L,R]){let lp=0;for(let j=0;j<N;j++){lp+=(d[j]-lp)*hp;d[j]-=lp;}}
   let oL=L,oR=R;
   if(xf>0){oL=L.slice(0,len);oR=R.slice(0,len);   // loop seam: the overrun fades into the start
    for(let j=0;j<xf;j++){const u=j/xf,a=Math.sin(u*Math.PI/2),b=Math.cos(u*Math.PI/2);oL[j]=L[j]*a+L[len+j]*b;oR[j]=R[j]*a+R[len+j]*b;}}
   else{const f=Math.min(len,Math.floor(sr*.04));for(let j=0;j<f;j++){const w=j/f;oL[len-1-j]*=w;oR[len-1-j]*=w;}}
   auNorm(oL,oR,.9);this.L=oL;this.R=oR;this.done=true;}};
}
function auNorm(L,R,to){let pk=0;for(let j=0;j<L.length;j++){const a=Math.abs(L[j]),b=Math.abs(R[j]);if(a>pk)pk=a;if(b>pk)pk=b;}
 if(pk>0){const s=to/pk;for(let j=0;j<L.length;j++){L[j]*=s;R[j]*=s;}}}
/* Applause: every person claps at their own rate, each clap a short resonant noise burst at its own
   pitch, with density following o.env. Transients are what noise IS good at, so this one is honest. */
function auClaps(o){
 const sr=o.sr||24000,rnd=auRng(o.seed||5),len=Math.floor(sr*o.secs),L=new Float32Array(len),R=new Float32Array(len),P=o.people||40;
 for(let p=0;p<P;p++){const pan=(rnd()*2-1)*.9,gl=Math.cos((pan+1)*Math.PI/4),gr=Math.sin((pan+1)*Math.PI/4),
   rate=3.2+rnd()*2.2,fc=700+rnd()*1700,Q=2+rnd()*3,lv=p<P*.3?.7+rnd()*.3:.3+rnd()*.3;
  let t=rnd()*.35;
  while(t<o.secs){const dn=auLin(o.env,t);
   if(dn>0&&rnd()<dn){const i0=Math.floor(t*sr),tau=(.003+rnd()*.004)*sr,n=Math.min(len-i0,Math.floor(tau*5)),
     w=6.283185*fc*(.9+rnd()*.2)/sr,al=Math.sin(w)/(2*Q),a0=1+al,b0=al/a0,a1=-2*Math.cos(w)/a0,a2=(1-al)/a0,amp=lv*(.7+rnd()*.3)*dn;
    let x1=0,x2=0,y1=0,y2=0;
    for(let j=0;j<n;j++){const x=(rnd()*2-1)*Math.exp(-j/tau),y=b0*(x-x2)-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;L[i0+j]+=y*amp*gl;R[i0+j]+=y*amp*gr;}}
   t+=(1/rate)*(.85+rnd()*.3);}}
 auNorm(L,R,.9);
 return {sr,L,R,done:true,step(){return true;}};}

/* The synthesized reactions (used only while crowd_<kind> has no recording). env/pit are [[t,v]]
   over the reaction, vow a vowel path, jit the spread of onsets across the crowd, wander a per-voice
   pitch drift (a cheer is not a choir), mix = some groups keep their own vowel, breath = voiced
   → breathy (a gasp is an intake of air, not a note). */
const AUREACT={
 ooh:  {len:1.5,jit:.12,voices:30,lift:.4,env:[[0,0],[.22,1],[.7,.8],[1.4,0]],vow:[[0,'u'],[.5,'u'],[1.2,'o']],pit:[[0,1],[.35,1.22],[.9,1.08],[1.4,.9]],wander:.004},
 gasp: {len:.7,jit:.06,voices:26,lift:.6,env:[[0,0],[.08,1],[.3,.6],[.65,0]],vow:[[0,'aw'],[.3,'a']],pit:[[0,1.3],[.6,1.4]],breath:.85},
 groan:{len:1.7,jit:.15,voices:30,lift:.2,env:[[0,0],[.25,1],[.8,.8],[1.6,0]],vow:[[0,'aw'],[.6,'uh'],[1.4,'uh']],pit:[[0,1.08],[.5,.95],[1.5,.72]],wander:.004},
 cheer:{len:2.4,jit:.2,voices:34,lift:.8,mix:1,env:[[0,0],[.18,1],[1.4,.85],[2.3,0]],vow:[[0,'e'],[.2,'ae'],[.9,'a'],[2,'a']],pit:[[0,1.25],[.25,1.5],[1.2,1.4],[2.3,1.15]],wander:.012},
 roar: {len:3.2,jit:.25,voices:40,lift:1,mix:1,env:[[0,0],[.15,1],[1.8,.9],[3.1,0]],vow:[[0,'a'],[.4,'ae'],[1.5,'a'],[2.8,'o']],pit:[[0,1.3],[.3,1.65],[1.6,1.5],[3.1,1.2]],wander:.015}};
const AU_CLAP={secs:3.4,people:40,env:[[0,0],[.25,1],[1.6,.9],[3.2,0]]};

/* Menu sounds: one family, all in D major pentatonic, so a run of them lands in one key. Two
   timbres, mirroring the palette: 'w' (wood — a sine and a quick marimba overtone) is the blue,
   structural sound for moving about; 'b' (bell partials) is the gold, only for committing to
   something. Each note: [freq, start s, length s, level, timbre]. The more often a sound is heard,
   the quieter and shorter it is: a cursor move is the tiniest thing in the game. */
const AU_UI={
 move: [[880,0,.04,.05,'w']],
 value:[[739.99,0,.045,.055,'w']],
 rod:  [[587.33,0,.035,.04,'w']],
 tab:  [[1318.51,0,.045,.05,'w']],
 click:[[880,0,.05,.05,'b'],[1174.66,.04,.09,.05,'b']],
 back: [[880,0,.05,.055,'w'],[587.33,.04,.08,.055,'w']],
 open: [[739.99,0,.08,.045,'w'],[880,0,.08,.04,'w']],
 error:[[293.66,0,.06,.07,'w'],[293.66,.08,.08,.06,'w']],
 start:[[587.33,0,.07,.045,'b'],[739.99,.045,.07,.045,'b'],[880,.09,.07,.045,'b'],[1174.66,.135,.35,.055,'b']]};
/* Stingers. The Federation is brass (a section: two saws a hair apart through a lowpass that opens on
   the attack) and gold (bells). The old goal horn slid DOWN a fifth, which is a sad trombone; these
   all resolve upward. Notes: [freq, start s, length s]. */
const AU_STING={
 goal:  {v:.05,brass:[[220,0,.1],[220,.13,.1],[146.83,.26,.95],[293.66,.26,.95],[369.99,.26,.95],[440,.26,.95]]},
 win:   {v:.045,brass:[[220,0,.13],[293.66,.15,.13],[369.99,.30,.13],[146.83,.45,1.5],[293.66,.45,1.5],[440,.45,1.5],[587.33,.45,1.5]]},
 trophy:{v:.045,bell:[[1174.66,0,1.4],[1479.98,.09,1.4],[1760,.18,1.6],[2349.32,.27,2]],brass:[[146.83,.27,1.4],[293.66,.27,1.4],[440,.27,1.4]]},
 medal: {v:.05,bell:[[1174.66,0,1.2],[1479.98,.08,1.2],[1760,.16,1.6]]}};

const Au={ctx:null,mg:null,cb:null,ub:null,sum:null,out:null,lim:null,nbuf:null,exc:0,rate:1,vol:1,
 dst:null, // beep/noise/wood/bell/brass route here instead of mg while set (route() / ui point it)
 bg:false, // window is unfocused / hidden — silenced when cfg.muteBg
 vc:{},   // per-key voice bookkeeping for vgate(): last fire time + a ring of voice end-times
 rl:null, // [floor, wall] roll voices, or null when CONFIG.audioMix.roll.on is false
 ch:null, // the held charge voice (js/shots.js), or null when CONFIG.shots.charge.tone.on is false
 bank:null,   // id → [AudioBuffer]: recorded takes (assets/audio/manifest.json). {} once loading starts
 listed:null, // ids the manifest lists, decoded or not: synthesis isn't built for these
 last:{},     // id → the take played last, so round-robin never repeats one
 syn:{},      // id → AudioBuffer rendered by the stand-ins (crowd beds, reactions, applause)
 jobs:[],     // stand-ins still to render, a slice at a time in idle time
 irs:{},      // room id → generated impulse
 bed:null,    // the crowd bed: {layers, x (excitement heard), ten (tension), lvl, g, s}
 rv:null,     // the room: {rm, id, A (its acoustic), f / c (fx / crowd convolvers)}

 /* BUSES (Options → Audio). mg is the EFFECTS bus — every one-shot and voice already connects to it,
    so the name stayed. cb = crowd (bed + reactions), ub = menu clicks. All three sum into `sum`
    (unity; the clip recorder taps it, so a saved clip doesn't inherit your volume or a mute), then
    `out` (master volume + the Sound switch) → limiter → speakers. The crowd bus passes the room's
    band-limit first (cHp / cLp), so Void's crowd can be a comms feed. */
 init(){if(this.ctx)return;try{
  this.ctx=new (window.AudioContext||window.webkitAudioContext)();
  const c=this.ctx;
  // master → limiter → out. The limiter is the "sum then squeeze" stage every game mix has:
  // simultaneous hits duck each other instead of clipping, so a six-ball pile-up gets louder
  // in a controlled way rather than crunching. Everything (crowd included) runs through it.
  const L=AUMIX.limiter;
  if(L&&L.on){this.lim=c.createDynamicsCompressor();
   this.lim.threshold.value=L.threshold;this.lim.knee.value=L.knee;this.lim.ratio.value=L.ratio;
   this.lim.attack.value=L.attack;this.lim.release.value=L.release;this.lim.connect(c.destination);}
  this.out=c.createGain();this.out.connect(this.lim||c.destination);
  this.sum=c.createGain();this.sum.connect(this.out);
  this.mg=c.createGain();this.cb=c.createGain();this.ub=c.createGain();
  this.cHp=c.createBiquadFilter();this.cHp.type='highpass';this.cHp.frequency.value=20;
  this.cLp=c.createBiquadFilter();this.cLp.type='lowpass';this.cLp.frequency.value=20000;
  this.mg.connect(this.sum);this.cb.connect(this.cHp);this.cHp.connect(this.cLp);this.cLp.connect(this.sum);this.ub.connect(this.sum);
  this.mix();
  this.nbuf=this.mkNoise(3);
  this.bed={layers:[],x:0,ten:0,lvl:0,g:c.createGain(),s:null};this.bed.g.gain.value=0;this.bed.g.connect(this.cb);
  if(AUMIX.roll&&AUMIX.roll.on)this.rl=[this.mkRoll(),this.mkRoll()];
  if(CONFIG.shots&&CONFIG.shots.charge.tone.on)this.ch=this.mkCharge();
  this.rvTick();
  this.load();
 }catch(e){}},

 /* Push cfg's switches and volumes onto the buses. Volumes are 0..1 sliders heard on a square
    curve, so the middle of the slider sounds like the middle. Short ramp: a slider drag or a focus
    change must not click. */
 mix(){if(!this.out)return;
  const t=this.ctx.currentTime,v=k=>{const x=clamp(+cfg[k],0,1);return x===x?x*x:1;},
   set=(n,g)=>n.gain.setTargetAtTime(g,t,.015);
  set(this.out,cfg.sound&&!(cfg.muteBg&&this.bg)?AUMIX.master*v('volMaster'):0);
  set(this.mg,v('volFx'));set(this.cb,v('volCrowd'));set(this.ub,v('volUi'));},

 inMatch(){return typeof S!=='undefined'&&S.phase!=='menu'&&S.phase!=='win';},

 /* ---- recorded takes ---- */
 /* The manifest is written by tools/build_audio_manifest.js (a browser can't list a folder). No
    manifest, a file:// page, a 404 or a file that won't decode are all legal: that id just stays
    synthesized. Stand-ins are queued as soon as the manifest is READ, for the ids it doesn't list,
    so a long decode never leaves the room silent. */
 load(){const M=AUMIX.samples;this.bank={};this.listed=new Set();
  const after=()=>{this.bedSync();if(this.rv&&this.has('ir_'+this.rv.id))this.rvSet(this.rv.id,this.rv.rm);};
  if(!M||!M.on||typeof fetch!=='function'){this.synthQueue();return;}
  fetch(M.folder+M.manifest).then(r=>r.ok?r.json():null).catch(()=>null).then(j=>{
   const ls=(j&&j.sounds)||{};for(const id in ls)if(ls[id]&&ls[id].length)this.listed.add(id);
   this.synthQueue();
   return Promise.all(Object.keys(ls).map(id=>Promise.all((ls[id]||[]).map(f=>fetch(M.folder+f)
     .then(r=>r.ok?r.arrayBuffer():null).then(a=>a?this.ctx.decodeAudioData(a):null).catch(()=>null)))
    .then(bs=>{bs=bs.filter(Boolean);if(bs.length)this.bank[id]=bs;})));
  }).then(after,after);},
 has(id){const b=this.bank&&this.bank[id];return!!(b&&b.length);},
 busOf(D){return D.bus==='crowd'?this.cb:D.bus==='ui'?this.ub:this.mg;},

 /* Play a recorded take of `id`. false = there is none (the caller synthesizes instead); true = it
    played, OR a take exists but the voice gate held it back — either way the caller is done.
    o: p (impact speed, scales level and pitch through pRef), src (a ball or {x,y,z,key}: pans the
    sound and picks a ball-type take), vol, rate, send (x the sound's), bus, at (delay s), gate:false. */
 play(id,o){if(!this.ctx||!this.bank)return false;o=o||{};
  const D=AUSND[id]||{},src=o.src||null,key=src&&src.key,
   n=(o.p==null||!D.pRef)?1:clamp(o.p/D.pRef,0,1);
  let use=null;
  if(key&&key!=='classic'&&this.has(id+'_'+key))use=id+'_'+key;
  else if(D.hardFrom!=null&&n>=D.hardFrom&&this.has(id+'_hard'))use=id+'_hard';
  else if(this.has(id))use=id;
  if(!use)return false;
  const bk=this.bank[use],k=auPick(bk.length,this.last[use]??-1,Math.random()),buf=bk[k],
   rt=(o.rate||1)*(1+(Math.random()*2-1)*(D.pitch||0))*(D.pRef&&D.pPitch?1+(n-.5)*D.pPitch:1);
  if(D.gate&&o.gate!==false&&!this.vgate(D.gate,buf.duration/rt))return true;
  this.last[use]=k;
  const pf=D.pFloor||0,
   v=(D.vol??1)*(o.vol??1)*(1+(Math.random()*2-1)*(D.volJ||0))*(D.pRef?pf+(1-pf)*Math.pow(n,D.pCurve||1):1);
  this.fire(buf,o.bus||this.busOf(D),src,v,rt,(D.send||0)*(o.send??1),o.at);
  return true;},
 // One buffer, once. Global rate/vol apply here, like every other primitive.
 fire(buf,bus,src,v,rt,send,at){const c=this.ctx,R=this.rate>0?this.rate:1,s=c.createBufferSource(),g=c.createGain();
  s.buffer=buf;s.playbackRate.value=rt*R;g.gain.value=v*this.vol;s.connect(g);g.connect(this.route(bus,src,send));
  s.start(c.currentTime+(at>0?at/R:0));return s;},
 /* Where a one-shot goes: an input node → (panned by src) → bus, plus a send into the room's
    convolver for that bus. Allocated per sound; WebAudio drops the lot when the source ends. */
 route(bus,src,send){const c=this.ctx,n=c.createGain(),P=AUMIX.pan;
  let pn=null;
  if(src&&P&&P.on&&c.createStereoPanner){const v=auPanOf(src)*P.width;if(v){pn=c.createStereoPanner();pn.pan.value=v;}}
  if(pn){n.connect(pn);pn.connect(bus);}else n.connect(bus);
  const rv=this.rv,cr=bus===this.cb,cv=rv&&(cr?rv.c:rv.f);
  if(cv&&send>0){const Rv=AUMIX.reverb,s=c.createGain();
   s.gain.value=send*(cr?Rv.crowd*(rv.A.crowd??1):Rv.fx*(rv.A.fx??1));n.connect(s);s.connect(cv);}
  return n;},

 /* ---- the room ---- */
 /* Polled, not hooked: the room is whatever world.js last applied (activeRoom). A new convolver per
    room rather than swapping the buffer of a live one — the old room's tails ring out on their own
    and are disconnected once they're done, so a venue change never chops a sound. */
 rvTick(){if(!this.ctx)return;const rm=typeof activeRoom!=='undefined'?activeRoom:null;
  if(this.rv&&this.rv.rm===rm)return;
  let id='open';if(rm&&typeof CONFIG!=='undefined')for(const k in CONFIG.rooms)if(CONFIG.rooms[k]===rm){id=k;break;}
  this.rvSet(id,rm);},
 rvSet(id,rm){const c=this.ctx,Rv=AUMIX.reverb;if(!c||!Rv)return;
  const A=Object.assign({},Rv.def,(Rv.rooms&&Rv.rooms[id])||{}),old=this.rv,t=c.currentTime,
   rv={rm,id,A,f:null,c:null};
  this.cHp.frequency.setTargetAtTime(A.crowdHp||20,t,.05);this.cLp.frequency.setTargetAtTime(A.crowdLp||20000,t,.05);
  if(Rv.on&&c.createConvolver){const b=this.irFor(id,A);
   rv.f=c.createConvolver();rv.f.buffer=b;rv.f.connect(this.mg);
   rv.c=c.createConvolver();rv.c.buffer=b;rv.c.connect(this.cb);}
  this.rv=rv;
  const B=this.bed;
  if(B){if(B.s){B.g.disconnect(B.s);B.s=null;}
   if(rv.c){B.s=c.createGain();B.s.gain.value=Rv.crowd*(A.crowd??1);B.g.connect(B.s);B.s.connect(rv.c);}}
  if(old&&(old.f||old.c))setTimeout(()=>{try{if(old.f)old.f.disconnect();if(old.c)old.c.disconnect();}catch(e){}},(old.A.decay*1.2+.5)*1000);},
 irFor(id,A){if(this.has('ir_'+id))return this.bank['ir_'+id][0];
  if(!this.irs[id]){const c=this.ctx,d=auIR(c.sampleRate,A,[...id].reduce((h,ch)=>h*31+ch.charCodeAt(0),7)),
    b=c.createBuffer(2,d[0].length,c.sampleRate);b.copyToChannel(d[0],0);b.copyToChannel(d[1],1);this.irs[id]=b;}
  return this.irs[id];},

 /* ---- the crowd ---- */
 /* (Re)build the bed layers from what exists. Recorded beds win outright — a real room crossfading
    into a synthesized one would be worse than either — so the stand-ins only play when no bed tier
    has a recording. Each layer loops from a random point, so two sessions never line up. */
 bedSync(){const B=this.bed,c=this.ctx;if(!B||!c)return;
  const T=[['calm',0],['busy',.5],['wild',1]],rec=T.some(q=>this.has('crowd_bed_'+q[0]));
  for(const [t,pos] of T){const id='crowd_bed_'+t,
    buf=rec?(this.has(id)?this.bank[id][(Math.random()*this.bank[id].length)|0]:null):(this.syn[id]||null);
   let l=B.layers.find(q=>q.t===t);
   if(l&&(l.buf===buf||(rec&&l.rec&&buf)))continue;
   if(l){try{l.src.stop();}catch(e){}l.g.disconnect();B.layers.splice(B.layers.indexOf(l),1);}
   if(!buf)continue;
   const s=c.createBufferSource();s.buffer=buf;s.loop=true;const g=c.createGain();g.gain.value=0;
   let lp=null;
   if(!rec){lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=AUC.synthLp[0];s.connect(lp);lp.connect(g);}
   else s.connect(g);
   g.connect(B.g);s.start(0,Math.random()*buf.duration);
   B.layers.push({t,pos,buf,src:s,g,lp,rec});}
  B.layers.sort((a,b)=>a.pos-b.pos);},
 /* Excitement heard = base + the last big moment + tension, smoothed. Tension is the one that makes
    a crowd sound like it's WATCHING: it lifts as a ball gets into either attacking third, before
    anything has happened. The layers either side of it crossfade on equal power. */
 bedTick(dt){const B=this.bed;if(!B)return;const C=AUC,live=!!cfg.ambience&&this.inMatch();
  let tn=0;
  if(live&&typeof S!=='undefined'&&S.balls){const h=CONFIG.table.L/2;
   for(const b of S.balls){if(!b.m)continue;const u=clamp((Math.abs(b.m.position.x)/h-C.tensionFrom)/(1-C.tensionFrom),0,1);if(u>tn)tn=u;}}
  B.ten+=(tn-B.ten)*(1-Math.exp(-dt/(tn>B.ten?.5:1.5)));
  B.x+=(clamp(C.base+this.exc+B.ten*C.tension,0,1)-B.x)*(1-Math.exp(-dt/.12));
  B.lvl+=((live?lerp(C.volLo,C.volHi,B.x):0)-B.lvl)*(1-Math.exp(-dt/.25));
  B.g.gain.value=B.lvl<1e-4?0:B.lvl;
  const Ls=B.layers;if(!Ls.length)return;
  let lo=Ls[0],hi=Ls[Ls.length-1];
  for(const l of Ls){if(l.pos<=B.x&&l.pos>=lo.pos)lo=l;if(l.pos>=B.x&&l.pos<=hi.pos)hi=l;}
  const u=hi===lo?0:clamp((B.x-lo.pos)/(hi.pos-lo.pos),0,1);
  for(const l of Ls){l.g.gain.value=l===lo&&l===hi?1:l===lo?Math.cos(u*Math.PI/2):l===hi?Math.sin(u*Math.PI/2):0;
   if(l.lp)l.lp.frequency.value=lerp(C.synthLp[0],C.synthLp[1],B.x);}},
 /* Queue the stand-ins for every crowd id the manifest doesn't list, then render them in idle
    slices. Beds first (the calm one is heard the moment a match starts), then the reactions. */
 synthQueue(){if(this.jobsOn)return;this.jobsOn=true;const C=AUC,J=this.jobs,L=this.listed||new Set();
  if(!['calm','busy','wild'].some(t=>L.has('crowd_bed_'+t))){
   J.push({id:'crowd_bed_calm',bed:1,gen:auVox({sr:C.sr,secs:C.secs,voices:C.voices,seed:11,xf:.6,lift:0})});
   J.push({id:'crowd_bed_wild',bed:1,gen:auVox({sr:C.sr,secs:C.secs,voices:Math.round(C.voices*1.3),seed:23,xf:.6,lift:1})});}
  let sd=31;
  for(const k in AUREACT){const id='crowd_'+k;if(!L.has(id))J.push({id,gen:auVox({sr:C.sr,seed:sd++,shape:AUREACT[k],voices:AUREACT[k].voices,lift:AUREACT[k].lift})});}
  if(!L.has('crowd_applause'))J.push({id:'crowd_applause',gen:auClaps(Object.assign({sr:C.sr,seed:47},AU_CLAP))});
  this.runJobs();},
 /* Idle time when there is some; when there isn't (a match running flat out, or a page that isn't
    drawing), the timeout still hands over a 4ms slice every 100ms, so the crowd is ready in seconds
    either way. One slice is a few 1024-sample steps (~1.5ms each). */
 runJobs(){const J=this.jobs;if(!J.length)return;
  const ric=typeof requestIdleCallback==='function',
   later=()=>ric?requestIdleCallback(work,{timeout:100}):setTimeout(work,16),
   work=dl=>{const t0=performance.now(),
     end=t0+(dl&&!dl.didTimeout&&dl.timeRemaining?Math.max(1,dl.timeRemaining()-1):4);
    do{const j=J[0];if(!j)break;
     if(j.gen.step(1024)){J.shift();this.syn[j.id]=this.toBuf(j.gen);if(j.bed)this.bedSync();}
    }while(J.length&&performance.now()<end);
    if(J.length)later();};
  later();},
 toBuf(g){const b=this.ctx.createBuffer(2,g.L.length,g.sr);b.copyToChannel(g.L,0);b.copyToChannel(g.R,1);return b;},

 /* Crowd REACTION — a shaped swell over the bed, not another impact one-shot. Au.exc only ever
    swells AFTER a loud contact; this is the crowd responding to something that made NO noise of its
    own — a shot that missed, a keeper who got there — or cheering one that did.
    Gated on cfg.ambience with the bed — turn the crowd off and they stop reacting too.
    at = seconds from now (applause follows a roar). */
 react(kind,at){
  if(!this.ctx||!cfg.ambience)return;
  const id='crowd_'+kind,D=AUSND[id];if(!D)return;
  let ok=this.play(id,{at});
  if(!ok&&D.syn!==false){const b=this.syn[id];
   if(b){if(!D.gate||this.vgate(D.gate,b.duration))this.fire(b,this.cb,null,(D.vol??1)*(1+(Math.random()*2-1)*(D.volJ||0)),1+(Math.random()*2-1)*(D.pitch||0),D.send||0,at);ok=true;}}
  if(ok)this.exc=Math.min(1,this.exc+(D.exc||0));
 },

 /* One shared noise buffer for every one-shot AND both roll voices. White + a brown
    (leaky-integrated) component: pure white has almost no energy left once the roll's
    lowpass drops to 250Hz, and a roll with no low end reads as hiss, not as a ball. */
 mkNoise(secs){const c=this.ctx,len=Math.floor(c.sampleRate*secs),
  b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);
  let br=0,pk=0;
  for(let i=0;i<len;i++){const w=Math.random()*2-1;br=(br+w*.035)*.992;
   const x=w*.55+br*3.2;d[i]=x;const a=x<0?-x:x;if(a>pk)pk=a;}
  if(pk>0){const k=.92/pk;for(let i=0;i<len;i++)d[i]*=k;}   // normalise once, not per-sample-clamp
  return b;},

 /* A roll voice: shared noise → lowpass (cutoff = speed) → peaking body → gain (level = speed).
    Started once and never stopped; silent voices cost a filter sweep of nothing. */
 mkRoll(){const c=this.ctx,s=c.createBufferSource();s.buffer=this.nbuf;s.loop=true;
  const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=300;lp.Q.value=.8;
  const bp=c.createBiquadFilter();bp.type='peaking';bp.frequency.value=190;bp.Q.value=1.1;bp.gain.value=5;
  const g=c.createGain();g.gain.value=0;
  s.connect(lp);lp.connect(bp);bp.connect(g);g.connect(this.mg);s.start();
  return {src:s,lp:lp,g:g,lvl:0,spd:0,want:0,cfg:null};},

 /* THE CHARGE VOICE — a wind-up is a STATE, exactly like a roll, and it is built the same way for
    the same two reasons. Sonically, discrete ticks are what make a charge read as a chiptune; a
    held voice swept continuously reads as energy gathering. Structurally, a voice that is FED per
    frame and fades when the feeding stops CANNOT leak — there is no chargeEnd to forget on a match
    that ends mid-wind-up, which was the objection that put the first cut on one-shots. Nodes are
    resident, so a charge allocates nothing and costs a handful of AudioParam writes while audible. */
 mkCharge(){const c=this.ctx,T=CONFIG.shots.charge.tone;
  const g=c.createGain();g.gain.value=0;g.connect(this.mg);
  const o=c.createOscillator();o.type='sine';o.frequency.value=T.f0;o.connect(g);o.start();
  const o5=c.createOscillator();o5.type='sine';o5.frequency.value=T.f0*1.5;
  const fg=c.createGain();fg.gain.value=0;o5.connect(fg);fg.connect(g);o5.start();
  const s=c.createBufferSource();s.buffer=this.nbuf;s.loop=true;s.playbackRate.value=.8;
  const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=T.nf0;lp.Q.value=.7;
  const ng=c.createGain();ng.gain.value=T.noiseVol;
  s.connect(lp);lp.connect(ng);ng.connect(g);s.start();
  return {g:g,o:o,o5:o5,fg:fg,lp:lp,lvl:0,k:0,want:-1,t:0};},

 // shots.js reports the live charge here once per frame. MAX, like rollFeed: in co-op two seats can
 // be winding up at once and one voice is indistinguishable from two at this scale.
 chargeFeed(k,band){const v=this.ch;if(v&&k>v.want)v.want=k;},
 chargeStop(){const v=this.ch;if(!v)return;v.lvl=0;v.k=0;v.want=-1;if(v.g)v.g.gain.value=0;},

 /* Drive the voice toward whatever was fed, then clear the accumulator — so letting go of the
    trigger simply stops feeding it and it sweeps DOWN and out on its own release time constant,
    which is what a dissipating charge should sound like. k is smoothed as well as the level, or
    the pitch would step on every frame the trigger depth moved. */
 chargeVoice(dt){const v=this.ch;if(!v||!this.ctx)return;
  // Idle is the common case by a mile — this runs every frame of every match and a charge is a
  // second or two of it. Bail before the exp() when there is nothing to drive and nothing ringing.
  if(v.want<0&&v.lvl<=0){v.want=-1;return;}
  const T=CONFIG.shots.charge.tone,CH=CONFIG.shots.charge,
   live=cfg.sound&&this.inMatch(),
   fed=live&&v.want>=0,
   tc=fed?T.attack:T.release,a=1-Math.exp(-dt/Math.max(1e-3,tc));
  v.k+=((fed?v.want:0)-v.k)*a;
  v.lvl+=((fed?Math.pow(clamp(v.k,0,1),T.curve)*T.vol:0)-v.lvl)*a;
  v.want=-1;
  if(v.lvl<1e-4){if(v.lvl!==0){v.lvl=0;v.k=0;v.g.gain.value=0;}return;}
  v.t+=dt;
  const over=CH.sweetTo>=1?0:clamp((v.k-CH.sweetTo)/(1-CH.sweetTo),0,1),
   band=clamp((v.k-CH.sweetFrom)/Math.max(1e-3,CH.sweetTo-CH.sweetFrom),0,1),
   f=T.f0+(T.f1-T.f0)*clamp(v.k,0,1);
  v.g.gain.value=v.lvl*this.vol*(1+Math.sin(v.t*T.wobHz*6.2832)*T.wobDepth*over);
  v.o.frequency.value=f;
  v.o5.frequency.value=f*1.5*(1-over*T.overDetune);
  v.fg.gain.value=band*T.fifthVol;
  v.lp.frequency.value=T.nf0+(T.nf1-T.nf0)*clamp(v.k,0,1);},

 /* The RELEASE. Three short layers rather than one, all scaled by the charge that went off, and all
    landing ~17ms before the contact's own Au.kick so the two read as a single event: a body sine
    dropping in pitch (the weight), a bandpass noise sweeping DOWN (the discharge — a down-sweep is
    release where the build-up's up-sweep was tension), and a bright snap that fires ONLY from
    inside the sweet band, so hitting it is something you hear rather than something you read. */
 chargeFire(k,sweet){if(!this.ctx)return;
  const T=CONFIG.shots.charge.tone,s=clamp(k,0,1);
  if(s<T.fireMin)return;
  const c=this.ctx,R=this.rate>0?this.rate:1,t=c.currentTime;
  const o=c.createOscillator(),g=c.createGain();
  o.type='sine';o.frequency.setValueAtTime(T.bodyF0*R,t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30,T.bodyF1*R),t+T.bodyD/R);
  this.env(g,t,.004/R,T.bodyD/R,T.bodyVol*s*this.vol);
  o.connect(g);g.connect(this.mg);o.start();o.stop(t+T.bodyD/R+.1);
  const n=c.createBufferSource();n.buffer=this.nbuf;
  const f=c.createBiquadFilter();f.type='bandpass';f.Q.value=.9;
  f.frequency.setValueAtTime(T.airF0*R,t);
  f.frequency.exponentialRampToValueAtTime(Math.max(60,T.airF1*R),t+T.airD/R);
  const ng=c.createGain();this.env(ng,t,T.airA/R,T.airD/R,T.airVol*s*this.vol);
  n.connect(f);f.connect(ng);ng.connect(this.mg);
  const span=this.nbuf.duration-T.airD/R-.05;
  n.start(t,span>0?Math.random()*span:0,T.airD/R+.05);
  // A high Q makes the snap a defined PING rather than a hiss — at the default 0.9 it measured only
  // 13% brighter than a bandless release, i.e. the band was not audibly distinguishable at all.
  if(sweet)this.noise(T.snapD,T.snapF,T.snapVol*s,0,T.snapQ);},

 // The band edges. A soft SINE bloom with a 30ms attack — the point of this pass was that a blip is
 // the chiptune tell, so the marker cannot be one either. Bright going in, dull and falling out.
 chargeMark(good){if(!this.ctx)return;
  const T=CONFIG.shots.charge.tone,c=this.ctx,R=this.rate>0?this.rate:1,t=c.currentTime,
   d=T.markD/R,fr=(good?T.markFHi:T.markFLo)*R;
  const o=c.createOscillator(),g=c.createGain();
  o.type='sine';o.frequency.setValueAtTime(fr,t);
  if(!good)o.frequency.exponentialRampToValueAtTime(Math.max(40,fr*.7),t+d);
  this.env(g,t,T.markA/R,d,T.markVol*this.vol);
  o.connect(g);g.connect(this.mg);o.start();o.stop(t+d+.1);},

 setOn(on){this.mix();if(!on){this.rollStop();this.chargeStop();}},

 /* Voice gate for one-shots: retrigger cooldown + concurrent cap, per sound key. This is the
    generic half of the fix — physics decides WHETHER a contact is an event, this decides
    whether the mix has room for it. Over-cap hits are dropped rather than stealing a voice:
    a hit that arrives while `max` copies of the same sound are still ringing is masked by
    them anyway, and dropping costs nothing. Cooldown scales with 1/rate so a slow-mo replay
    (where every sound is stretched) doesn't machine-gun at playback speed. A recorded take and
    its synthesized version share one key, so switching source never doubles the cap. */
 vgate(key,dur){const g=AUMIX.voices&&AUMIX.voices[key];if(!g)return true;
  const t=this.ctx.currentTime,R=this.rate>0?this.rate:1;
  let s=this.vc[key];
  if(!s)s=this.vc[key]={last:-1e9,i:0,end:new Float64Array(Math.max(1,g.max))};
  if(t-s.last<g.gap/R)return false;
  let n=0;for(let i=0;i<s.end.length;i++)if(s.end[i]>t)n++;
  if(n>=g.max)return false;
  s.last=t;s.end[s.i]=t+dur/R;s.i=(s.i+1)%s.end.length;return true;},

 tick(dt){if(!this.ctx)return;
  this.exc=Math.max(0,this.exc-dt*(AUC.excDecay??.3));
  this.rvTick();this.bedTick(dt);this.rollTick(dt);this.chargeVoice(dt);},

 /* Physics reports rolling contact here, once per ball per surface per frame (rollProbe) and
    from the arena bowl's inelastic branch. MAX, not sum: a double-report is harmless, and the
    fastest contact in play owns the timbre. That's the "dominant emitter" simplification —
    one voice per surface is indistinguishable from N at this scale and costs nothing.
    k: 0 = floor, 1 = wall. aC = the ball type's audio block (its .roll picks the character). */
 rollFeed(k,spd,aC){const r=this.rl&&this.rl[k];if(!r||!(spd>0))return;
  if(spd>r.want){r.want=spd;r.cfg=(aC&&aC.roll)||null;}},

 rollStop(){if(!this.rl)return;for(const r of this.rl){r.lvl=0;r.spd=0;r.want=0;r.cfg=null;if(r.g)r.g.gain.value=0;}},

 /* Drive both roll voices toward what physics fed this frame, then clear the accumulator.
    Attack is fast and release slow on purpose: contact must be audible the instant it starts,
    but a probe that misses for one frame (ball skipping a hair off the wall) must not chop
    the sound. That asymmetry is the whole difference between a roll and a rattle — and it is
    also what decouples this from the sim/render rate mismatch: the sim is fixed at SIM.hz 120
    while tick() runs per rendered frame, so above 120Hz some frames legitimately arrive with
    nothing fed. At release=0.16s a skipped frame costs ~2% of level, which is inaudible; a
    fast release would turn it into tremolo. Don't shorten it below ~0.1s. */
 rollTick(dt){if(!this.rl||!this.ctx)return;
  const R=AUMIX.roll,
   live=cfg.sound&&this.inMatch();
  for(let k=0;k<2;k++){
   const r=this.rl[k],key=k?'wall':'floor',
    rc=(r.cfg&&r.cfg[key])||R.def[key],
    sp=live?r.want:0,
    n=clamp((sp-R.speedMin)/Math.max(1e-3,R.speedRef-R.speedMin),0,1),
    tgt=n>0?Math.pow(n,R.curve)*rc.vol:0,
    tc=tgt>r.lvl?R.attack:R.release,
    a=1-Math.exp(-dt/Math.max(1e-3,tc));
   r.lvl+=(tgt-r.lvl)*a;
   r.spd+=(sp-r.spd)*a;   // smooth the SPEED too, on the same envelope. Writing cutoff/grain rate
                          // straight from the raw value makes the timbre jump on every bounce; and
                          // because sp is 0 during release, the roll now sweeps DOWN as it fades —
                          // a ball spinning to a stop, which is what the ear expects.
   if(r.lvl<1e-4){r.lvl=0;r.spd=0;}
   r.g.gain.value=r.lvl*this.vol;
   if(r.lvl>0){                                   // only pay for the param writes while audible
    r.lp.frequency.value=clamp(rc.freq+r.spd*rc.freqScale,60,16000);
    r.lp.Q.value=rc.q;
    r.src.playbackRate.value=R.rateBase+clamp((r.spd-R.speedMin)/Math.max(1e-3,R.speedRef-R.speedMin),0,1)*R.rateScale;
   }
   r.want=0;r.cfg=null;
  }},

 env(g,t0,a,d,pk){g.gain.setValueAtTime(0.0001,t0);g.gain.linearRampToValueAtTime(pk,t0+a);g.gain.exponentialRampToValueAtTime(.0001,t0+a+d);},

 // R is guarded >0 in all three: every duration is divided by it, and a zero would put an
 // Infinity into a buffer length / an AudioParam time and throw from deep inside WebAudio.
 // j = per-call randomisation depth (0 = exact, as before). Two IDENTICAL transients a few ms
 // apart sum coherently and read as one synthetic tone; a few percent of detune and level
 // spread between them is what makes repeated contacts sound like separate physical events.
 // Signature sounds (ui, whistle, countdown, goal, boom) pass no j and are bit-identical to before.
 beep(fr,d=.1,type='square',v=.18,slide=0,j=0){if(!this.ctx)return;const c=this.ctx,o=c.createOscillator(),g=c.createGain(),R=this.rate>0?this.rate:1;
  const pj=j?1+(Math.random()*2-1)*j:1;
  fr*=R*pj;slide*=R*pj;d/=R;v*=this.vol*(j?1+(Math.random()*2-1)*j*.6:1);   // slide is a freq DELTA, so it scales with pitch, not with time
  o.type=type;o.frequency.setValueAtTime(fr,c.currentTime);
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,fr+slide),c.currentTime+d);
  this.env(g,c.currentTime,.006/R,d,v);o.connect(g);g.connect(this.dst||this.mg);o.start();o.stop(c.currentTime+d+.1);},

 // Plays a random slice of the shared buffer instead of building one. Same sound, no allocation.
 noise(d=.08,fq=1800,v=.22,j=0,q=.9){if(!this.ctx||!this.nbuf)return;const c=this.ctx,R=this.rate>0?this.rate:1;
  const pj=j?1+(Math.random()*2-1)*j:1;
  fq*=R*pj;d/=R;v*=this.vol*(j?1+(Math.random()*2-1)*j*.6:1);
  const s=c.createBufferSource();s.buffer=this.nbuf;s.playbackRate.value=pj;
  const span=this.nbuf.duration-d-.05,off=span>0?Math.random()*span:0;
  const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=fq;f.Q.value=q;
  const g=c.createGain();this.env(g,c.currentTime,.004/R,d,v);
  s.connect(f);f.connect(g);g.connect(this.dst||this.mg);s.start(c.currentTime,off,d+.05);},

 // A struck bar: a sine and a quick marimba overtone (3.93×). The menus' structural sound.
 wood(f,t0,d,v){const c=this.ctx,R=this.rate>0?this.rate:1;f*=R;d/=R;
  for(const [m,gv,dm] of [[1,1,1],[3.93,.28,.35]]){const o=c.createOscillator(),g=c.createGain();
   o.type='sine';o.frequency.value=f*m;
   g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(v*gv*this.vol,t0+.002);g.gain.exponentialRampToValueAtTime(.0001,t0+.002+d*dm);
   o.connect(g);g.connect(this.dst||this.mg);o.start(t0);o.stop(t0+d*dm+.05);}},
 // A bell: inharmonic partials, upper ones dying first. The gold.
 bell(f,t0,d,v){const c=this.ctx,R=this.rate>0?this.rate:1;f*=R;d/=R;
  for(const [m,gv,dm] of [[1,1,1],[2.76,.45,.6],[5.4,.25,.4],[8.93,.12,.25]]){if(f*m>c.sampleRate*.45)continue;
   const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=f*m;
   g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(v*gv*this.vol,t0+.003);g.gain.exponentialRampToValueAtTime(.0001,t0+.003+d*dm);
   o.connect(g);g.connect(this.dst||this.mg);o.start(t0);o.stop(t0+d*dm+.05);}},
 // A brass section note: two saws a hair apart, through a lowpass that opens on the attack.
 brass(f,t0,d,v){const c=this.ctx,R=this.rate>0?this.rate:1;f*=R;d/=R;
  const lp=c.createBiquadFilter(),g=c.createGain(),hi=Math.min(9000,f*7),top=Math.min(9000,f*3.2);
  lp.type='lowpass';lp.Q.value=.7;
  lp.frequency.setValueAtTime(f*1.5,t0);lp.frequency.linearRampToValueAtTime(hi,t0+.06);lp.frequency.exponentialRampToValueAtTime(top,t0+Math.max(.07,Math.min(d,.35)));
  g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(v*this.vol,t0+.03);
  g.gain.linearRampToValueAtTime(v*this.vol*.8,t0+Math.max(.04,d-.08));g.gain.exponentialRampToValueAtTime(.0001,t0+d+.12);
  lp.connect(g);g.connect(this.dst||this.mg);
  for(const m of [1,1.004]){const o=c.createOscillator();o.type='sawtooth';o.frequency.value=f*m;o.connect(lp);o.start(t0);o.stop(t0+d+.2);}},

 kick(p,aC,src){if(!this.ctx)return;
  if(this.play('ball_kick',{p,src}))return;
  const ak=aC||{},J=AUMIX.jitter,
  nd=ak.noiseDur??.06,nf=(ak.noiseFreq??900)+p*(ak.noiseFreqScale??8),
  nv=Math.min(ak.noiseVolMax??.4,(ak.noiseVol??.1)+p*(ak.noiseVolScale??.003)),
  bf=(ak.beepFreq??95),bd=ak.beepDur??.09,bt=ak.beepType??'sine',
  bv=Math.min(ak.beepVolMax??.45,(ak.beepVol??.08)+p*(ak.beepVolScale??.003)),
  bs=ak.beepSlide??-45;
  if(!this.vgate('kick',Math.max(nd,bd)))return;
  this.dst=this.route(this.mg,src,AUSND.ball_kick.send||0);
  this.noise(nd,nf,nv,J.pitch);this.beep(bf,bd,bt,bv,bs,J.pitch*.5);
  this.dst=null;},

 /* Wall/floor TAP. Only reached for a fresh, above-threshold contact now (physics.js hitFresh),
    so p spans a real range instead of sitting on the base volume forever — hence the widened
    default curve: quiet contacts really are quiet, and the loud end has somewhere to go.
    k: 0 = side/end wall, 1 = the pitch (a drop), 2 = another ball. One synthesized voice for all
    three; a recording can tell them apart. */
 wall(p,aC,src,k){if(!this.ctx)return;
  const id=k===1?'ball_floor':k===2?'ball_hit':'ball_wall';
  if(this.play(id,{p,src}))return;
  const ak=aC||{},J=AUMIX.jitter,
  nd=ak.noiseDur??.045,nf=(ak.noiseFreq??2300)+p*(ak.noiseFreqScale??4),
  nv=Math.min(ak.noiseVolMax??.28,(ak.noiseVol??.012)+p*(ak.noiseVolScale??.0035));
  if(!this.vgate('wall',nd))return;
  this.dst=this.route(this.mg,src,AUSND[id].send||0);
  this.noise(nd,nf,nv,J.pitch,ak.q??.9);
  // a hard slap gets a short low body under the tick so it reads as mass, not just as treble
  const bt=ak.bodyFrom??55;
  if(p>bt)this.beep(ak.bodyFreq??150,ak.bodyDur??.055,'sine',
   Math.min(ak.bodyVolMax??.16,(p-bt)*(ak.bodyVolScale??.0016)),ak.bodySlide??-55,J.pitch*.5);
  this.dst=null;},

 post(p,aC,src){if(!this.ctx)return;
  if(this.play('ball_post',{p,src})){this.exc=Math.min(1,this.exc+.25);return;}
  const c=this.ctx,ak=aC||{},R=this.rate>0?this.rate:1,J=AUMIX.jitter,
  frs=ak.freqs||[523,832,1290,1900],dr=ak.droop??.94,
  at=(ak.attack??.003)/R,de=(ak.decay??.28)/R,ds=(ak.decayShift??.045)/R,
  vm=ak.volMax??.5,vb=ak.vol??.14,vs=ak.volScale??.004,
  v=Math.min(vm,vb+p*vs),gv=v*this.vol;   // gv = the oscillator level; v stays clean for the noise
                                          // call below, which applies this.vol itself (no double-dip)
  if(!this.vgate('post',de+.14))return;
  const pj=1+(Math.random()*2-1)*J.pitch*.35,   // metal rings at a fixed pitch, so detune it only slightly
   out=this.route(this.mg,src,AUSND.ball_post.send||0);
  frs.forEach((fr,i)=>{const o=c.createOscillator(),g=c.createGain(),f=fr*R*pj;
   o.type=i?'triangle':'sine';o.frequency.setValueAtTime(f,c.currentTime);
   o.frequency.exponentialRampToValueAtTime(f*dr,c.currentTime+de);
   this.env(g,c.currentTime,at,de-i*ds,gv*(1-i*(ak.falloff??.18)));o.connect(g);g.connect(out);o.start();o.stop(c.currentTime+de+.14/R);});
  this.dst=out;this.noise(ak.noiseDur??.03,ak.noiseFreq??3200,v*(ak.noiseVolScale??.5),J.pitch);this.dst=null;
  this.exc=Math.min(1,this.exc+.25);},

 // Recorded only: the ball dropping into the goal and down the return, and the serve.
 goalIn(src){if(this.ctx)this.play('ball_goal',{src});},
 drop(src){if(this.ctx)this.play('ball_drop',{src});},

 /* A stinger and the crowd's answer to it. kind: goal (a goal, and the replay's freeze-frame),
    win (full time), trophy (league title, cup), medal (a trial or the tutorial finished). */
 goal(kind){if(!this.ctx)return;const k=AU_STING[kind]?kind:'goal';
  if(!this.play('sting_'+k))this.sting(k);
  if(k==='goal'){this.exc=1;this.react('roar');this.react('applause',1.1);}
  else if(k==='win'){this.exc=1;this.react('cheer');this.react('applause',.9);}
  else if(k==='trophy')this.react('applause',.4);},
 sting(k){const P=AU_STING[k],t=this.ctx.currentTime;if(!P||!this.vgate('sting',1.5))return;
  for(const n of P.brass||[])this.brass(n[0],t+n[1],n[2],P.v);
  for(const n of P.bell||[])this.bell(n[0],t+n[1],n[2],P.v*1.3);},
 /* The referee. A pea whistle is a tone near 2.8 kHz warbled ~36 times a second by the pea, with
    breath under it — the old square wave was a phone ringing. n>1 is full time: the last one long. */
 whistle(n=1){if(!this.ctx)return;if(n>1&&this.play('whistle_end'))return;
  for(let i=0;i<n;i++)setTimeout(()=>{if(!this.play('whistle'))this.pea(i===n-1&&n>1?.55:.24);},i*270);},
 pea(d){const c=this.ctx,R=this.rate>0?this.rate:1,t=c.currentTime,f=2750*R,dd=d/R;
  const o=c.createOscillator(),lfo=c.createOscillator(),lg=c.createGain(),g=c.createGain();
  o.type='sine';o.frequency.setValueAtTime(f*.9,t);o.frequency.exponentialRampToValueAtTime(f,t+.03);
  lfo.frequency.value=36;lg.gain.value=f*.055;lfo.connect(lg);lg.connect(o.frequency);
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.09*this.vol,t+.015);
  g.gain.setValueAtTime(.09*this.vol,t+dd);g.gain.exponentialRampToValueAtTime(.0001,t+dd+.05);
  o.connect(g);g.connect(this.dst||this.mg);o.start(t);lfo.start(t);o.stop(t+dd+.1);lfo.stop(t+dd+.1);
  this.noise(d,2750,.03,0,4);},   // breath: noise() applies the rate itself
 // Kick-off countdown: n = 3,2,1 ticks, 0 = go. n<0 = the clock's last seconds.
 count(n){if(!this.ctx)return;
  if(this.play(n>0?'count_tick':n===0?'count_go':'clock_tick'))return;
  const t=this.ctx.currentTime;
  if(n===0){this.bell(1174.66,t,.5,.09);this.bell(880,t,.5,.06);}
  else if(n>0)this.bell(880,t,.25,.08);
  else this.wood(1318.51,t,.05,.07);},
 power(){if(this.play('power_pickup'))return;[660,880,1320].forEach((f,i)=>setTimeout(()=>this.beep(f,.09,'triangle',.18),i*70));},
 boom(){if(!this.ctx)return;this.exc=1;if(this.play('cannon_boom'))return;const c=this.ctx;   // cannonball detonation: sub-bass drop + body rumble + crack
  const o=c.createOscillator(),g=c.createGain();o.type='sine';
  o.frequency.setValueAtTime(170,c.currentTime);o.frequency.exponentialRampToValueAtTime(36,c.currentTime+.55);
  this.env(g,c.currentTime,.005,.6,.6);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+.8);
  this.noise(.45,300,.5);this.noise(.16,1700,.34);},                // low rumble body + high crack transient
 /* Menus. k = move | value | tab | click | back | open | error | start | rod. One shared gate, so
    when a pad press and the handler it triggers both ask for a sound, the first (the specific one)
    wins and the generic click is dropped. */
 ui(k){if(!this.ctx)return;k=AU_UI[k]?k:'click';
  if(!this.vgate('ui',.06))return;
  if(this.play('ui_'+k,{bus:this.ub,gate:false}))return;
  const P=AU_UI[k],t=this.ctx.currentTime;this.dst=this.ub;
  for(const n of P)(n[4]==='b'?this.bell:this.wood).call(this,n[0],t+n[1],n[2],n[3]);
  this.dst=null;},
 // countdown tick for the cannonball warning (higher pitch as it nears detonation)
 warnBeep(k=0){if(this.play('cannon_warn',{rate:1+k*.4}))return;this.beep(900+600*k,.09,'square',.22);}};

// Options → Audio 'Mute in background': a blur is the window losing focus (alt-tab, the Steam overlay's
// own window), a hidden document is a minimise. Tracked always, applied only when cfg.muteBg is on.
function auBg(){Au.bg=document.hidden||!document.hasFocus();Au.mix();}
addEventListener('blur',auBg);addEventListener('focus',auBg);document.addEventListener('visibilitychange',auBg);
