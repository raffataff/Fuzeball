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
 kick(p){this.noise(.06,900+p*8,Math.min(.4,.1+p*.003));this.beep(95,.09,'sine',Math.min(.45,.08+p*.003),-45);},
 wall(p){this.noise(.045,2300,Math.min(.28,.04+p*.002));},
 post(p){if(!this.ctx)return;const c=this.ctx,v=Math.min(.5,.14+p*.004);      // metallic 'DOINK' off the woodwork
  [523,832,1290,1900].forEach((fr,i)=>{const o=c.createOscillator(),g=c.createGain();
   o.type=i?'triangle':'sine';o.frequency.setValueAtTime(fr,c.currentTime);
   o.frequency.exponentialRampToValueAtTime(fr*.94,c.currentTime+.28);          // slight inharmonic droop = struck-bar ring
   this.env(g,c.currentTime,.003,.28-i*.045,v*(1-i*.18));o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+.42);});
  this.noise(.03,3200,v*.5);this.exc=Math.min(1,this.exc+.25);},                // click transient + a crowd 'ooh'
 goal(){if(!this.ctx)return;const c=this.ctx;
  [220,277,330].forEach(fr=>{const o=c.createOscillator(),g=c.createGain();o.type='sawtooth';
   o.frequency.setValueAtTime(fr,c.currentTime);o.frequency.linearRampToValueAtTime(fr*.8,c.currentTime+.95);
   this.env(g,c.currentTime,.03,.95,.15);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+1.15);});
  this.noise(.5,700,.3);this.exc=1;},
 whistle(n=1){for(let i=0;i<n;i++)setTimeout(()=>this.beep(2150,.22,'square',.11,320),i*270);},
 power(){[660,880,1320].forEach((f,i)=>setTimeout(()=>this.beep(f,.09,'triangle',.18),i*70));},
 ui(){this.beep(720,.05,'triangle',.1);}};
