'use strict';
/* ================= audio (all synthesized via WebAudio) ================= */
const Au={ctx:null,mg:null,crowd:null,exc:0,
 init(){if(this.ctx)return;try{
  this.ctx=new (window.AudioContext||window.webkitAudioContext)();
  this.mg=this.ctx.createGain();this.mg.gain.value=cfg.sound?0.55:0;this.mg.connect(this.ctx.destination);
  const c=this.ctx,len=2*c.sampleRate,b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);
  let l=0;for(let i=0;i<len;i++){l=(l+(Math.random()*2-1)*.02)*.985;d[i]=l*6;}
  const s=c.createBufferSource();s.buffer=b;s.loop=true;
  const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=560;f.Q.value=.55;
  this.crowd=c.createGain();this.crowd.gain.value=.05;
  s.connect(f);f.connect(this.crowd);this.crowd.connect(this.mg);s.start();
 }catch(e){}},
 setOn(on){if(this.mg)this.mg.gain.value=on?0.55:0;},
 tick(dt){if(this.crowd){this.exc=Math.max(0,this.exc-dt*.3);this.crowd.gain.value=.05+this.exc*.28;}},
 env(g,t0,a,d,pk){g.gain.setValueAtTime(0.0001,t0);g.gain.linearRampToValueAtTime(pk,t0+a);g.gain.exponentialRampToValueAtTime(.0001,t0+a+d);},
 beep(fr,d=.1,type='square',v=.18,slide=0){if(!this.ctx)return;const c=this.ctx,o=c.createOscillator(),g=c.createGain();
  o.type=type;o.frequency.setValueAtTime(fr,c.currentTime);
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,fr+slide),c.currentTime+d);
  this.env(g,c.currentTime,.006,d,v);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+d+.1);},
 noise(d=.08,fq=1800,v=.22){if(!this.ctx)return;const c=this.ctx,n=Math.floor(c.sampleRate*d)+64,b=c.createBuffer(1,n,c.sampleRate),o=b.getChannelData(0);
  for(let i=0;i<n;i++)o[i]=Math.random()*2-1;
  const s=c.createBufferSource();s.buffer=b;
  const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=fq;f.Q.value=.9;
  const g=c.createGain();this.env(g,c.currentTime,.004,d,v);
  s.connect(f);f.connect(g);g.connect(this.mg);s.start();},
 kick(p,aC){const ak=aC||{},
  nd=ak.noiseDur??.06,nf=(ak.noiseFreq??900)+p*(ak.noiseFreqScale??8),
  nv=Math.min(ak.noiseVolMax??.4,(ak.noiseVol??.1)+p*(ak.noiseVolScale??.003)),
  bf=(ak.beepFreq??95),bd=ak.beepDur??.09,bt=ak.beepType??'sine',
  bv=Math.min(ak.beepVolMax??.45,(ak.beepVol??.08)+p*(ak.beepVolScale??.003)),
  bs=ak.beepSlide??-45;
  this.noise(nd,nf,nv);this.beep(bf,bd,bt,bv,bs);},
 wall(p,aC){const ak=aC||{},
  nd=ak.noiseDur??.045,nf=ak.noiseFreq??2300,
  nv=Math.min(ak.noiseVolMax??.28,(ak.noiseVol??.04)+p*(ak.noiseVolScale??.002));
  this.noise(nd,nf,nv);},
 post(p,aC){if(!this.ctx)return;const c=this.ctx,ak=aC||{},
  frs=ak.freqs||[523,832,1290,1900],dr=ak.droop??.94,
  at=ak.attack??.003,de=ak.decay??.28,
  vm=ak.volMax??.5,vb=ak.vol??.14,vs=ak.volScale??.004,
  v=Math.min(vm,vb+p*vs);
  frs.forEach((fr,i)=>{const o=c.createOscillator(),g=c.createGain();
   o.type=i?'triangle':'sine';o.frequency.setValueAtTime(fr,c.currentTime);
   o.frequency.exponentialRampToValueAtTime(fr*dr,c.currentTime+de);
   this.env(g,c.currentTime,at,de-i*(ak.decayShift??.045),v*(1-i*(ak.falloff??.18)));o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+de+.14);});
  this.noise(ak.noiseDur??.03,ak.noiseFreq??3200,v*(ak.noiseVolScale??.5));this.exc=Math.min(1,this.exc+.25);},
 goal(){if(!this.ctx)return;const c=this.ctx;
  [220,277,330].forEach(fr=>{const o=c.createOscillator(),g=c.createGain();o.type='sawtooth';
   o.frequency.setValueAtTime(fr,c.currentTime);o.frequency.linearRampToValueAtTime(fr*.8,c.currentTime+.95);
   this.env(g,c.currentTime,.03,.95,.15);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+1.15);});
  this.noise(.5,700,.3);this.exc=1;},
 whistle(n=1){for(let i=0;i<n;i++)setTimeout(()=>this.beep(2150,.22,'square',.11,320),i*270);},
 power(){[660,880,1320].forEach((f,i)=>setTimeout(()=>this.beep(f,.09,'triangle',.18),i*70));},
 boom(){if(!this.ctx)return;const c=this.ctx;                                  // cannonball detonation: sub-bass drop + body rumble + crack
  const o=c.createOscillator(),g=c.createGain();o.type='sine';
  o.frequency.setValueAtTime(170,c.currentTime);o.frequency.exponentialRampToValueAtTime(36,c.currentTime+.55);
  this.env(g,c.currentTime,.005,.6,.6);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+.8);
  this.noise(.45,300,.5);this.noise(.16,1700,.34);this.exc=1;},                // low rumble body + high crack transient + crowd 'ooh'
 ui(){this.beep(720,.05,'triangle',.1);}};
