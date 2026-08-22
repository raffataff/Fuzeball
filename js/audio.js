'use strict';
/* ================= audio (all synthesized via WebAudio) ================= */
/* rate / vol are GLOBAL modifiers applied by the two primitives (beep, noise) and by post.
   Both sit at 1 for all live play; the goal replay sets them around its sound-fire loop and
   resets them in the same breath (js/replay.js replaySndUpdate), so nothing can leak a
   detuned Au into the next rally. rate is a tape-speed multiplier — frequencies scale with
   it and every duration scales inversely, so rate<1 is a slower, deeper, softer-attack
   version of the same hit rather than a different sound. */

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

/* Crowd reaction shapes (Au.react). f0->f1 is the band sweep across the whole envelope, which is
   what carries the MEANING: an intake of breath rises, a groan falls. Hardcoded here rather than in
   CONFIG because these are match chrome like goal()/whistle(), not per-ball-type character. */
const AUREACT={ooh:{f0:620,f1:930,q:1.7,a:.16,d:.52,v:.17,exc:.30},
               groan:{f0:470,f1:235,q:1.4,a:.22,d:.80,v:.16,exc:.12}};
const Au={ctx:null,mg:null,lim:null,crowd:null,nbuf:null,exc:0,rate:1,vol:1,
 vc:{},   // per-key voice bookkeeping for vgate(): last fire time + a ring of voice end-times
 rl:null, // [floor, wall] roll voices, or null when CONFIG.audioMix.roll.on is false
 ch:null, // the held charge voice (js/shots.js), or null when CONFIG.shots.charge.tone.on is false

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
  this.mg=c.createGain();this.mg.gain.value=cfg.sound?AUMIX.master:0;
  this.mg.connect(this.lim||c.destination);
  this.nbuf=this.mkNoise(3);
  // crowd bed: slow-drifting bandpassed noise, level driven by this.exc
  const len=2*c.sampleRate,b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);
  let l=0;for(let i=0;i<len;i++){l=(l+(Math.random()*2-1)*.02)*.985;d[i]=l*6;}
  const s=c.createBufferSource();s.buffer=b;s.loop=true;
  const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=560;f.Q.value=.55;
  this.crowd=c.createGain();this.crowd.gain.value=0;
  s.connect(f);f.connect(this.crowd);this.crowd.connect(this.mg);s.start();
  if(AUMIX.roll&&AUMIX.roll.on)this.rl=[this.mkRoll(),this.mkRoll()];
  if(CONFIG.shots&&CONFIG.shots.charge.tone.on)this.ch=this.mkCharge();
 }catch(e){}},

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
   live=cfg.sound&&typeof S!=='undefined'&&S.phase!=='menu'&&S.phase!=='win',
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

 setOn(on){if(this.mg)this.mg.gain.value=on?AUMIX.master:0;if(!on){this.rollStop();this.chargeStop();}},

 /* Voice gate for one-shots: retrigger cooldown + concurrent cap, per sound key. This is the
    generic half of the fix — physics decides WHETHER a contact is an event, this decides
    whether the mix has room for it. Over-cap hits are dropped rather than stealing a voice:
    a hit that arrives while `max` copies of the same sound are still ringing is masked by
    them anyway, and dropping costs nothing. Cooldown scales with 1/rate so a slow-mo replay
    (where every sound is stretched) doesn't machine-gun at playback speed. */
 vgate(key,dur){const g=AUMIX.voices&&AUMIX.voices[key];if(!g)return true;
  const t=this.ctx.currentTime,R=this.rate>0?this.rate:1;
  let s=this.vc[key];
  if(!s)s=this.vc[key]={last:-1e9,i:0,end:new Float64Array(Math.max(1,g.max))};
  if(t-s.last<g.gap/R)return false;
  let n=0;for(let i=0;i<s.end.length;i++)if(s.end[i]>t)n++;
  if(n>=g.max)return false;
  s.last=t;s.end[s.i]=t+dur/R;s.i=(s.i+1)%s.end.length;return true;},

 tick(dt){if(this.crowd){this.exc=Math.max(0,this.exc-dt*.3);
  const inMatch=typeof S!=='undefined'&&S.phase!=='menu'&&S.phase!=='win';
  this.crowd.gain.value=(cfg.ambience&&inMatch)?.05+this.exc*.28:0;}
  this.rollTick(dt);this.chargeVoice(dt);},

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
   live=cfg.sound&&typeof S!=='undefined'&&S.phase!=='menu'&&S.phase!=='win';
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
  this.env(g,c.currentTime,.006/R,d,v);o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+d+.1);},

 // Plays a random slice of the shared buffer instead of building one. Same sound, no allocation.
 noise(d=.08,fq=1800,v=.22,j=0,q=.9){if(!this.ctx||!this.nbuf)return;const c=this.ctx,R=this.rate>0?this.rate:1;
  const pj=j?1+(Math.random()*2-1)*j:1;
  fq*=R*pj;d/=R;v*=this.vol*(j?1+(Math.random()*2-1)*j*.6:1);
  const s=c.createBufferSource();s.buffer=this.nbuf;s.playbackRate.value=pj;
  const span=this.nbuf.duration-d-.05,off=span>0?Math.random()*span:0;
  const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=fq;f.Q.value=q;
  const g=c.createGain();this.env(g,c.currentTime,.004/R,d,v);
  s.connect(f);f.connect(g);g.connect(this.mg);s.start(c.currentTime,off,d+.05);},

 kick(p,aC){const ak=aC||{},J=AUMIX.jitter,
  nd=ak.noiseDur??.06,nf=(ak.noiseFreq??900)+p*(ak.noiseFreqScale??8),
  nv=Math.min(ak.noiseVolMax??.4,(ak.noiseVol??.1)+p*(ak.noiseVolScale??.003)),
  bf=(ak.beepFreq??95),bd=ak.beepDur??.09,bt=ak.beepType??'sine',
  bv=Math.min(ak.beepVolMax??.45,(ak.beepVol??.08)+p*(ak.beepVolScale??.003)),
  bs=ak.beepSlide??-45;
  if(!this.ctx||!this.vgate('kick',Math.max(nd,bd)))return;
  this.noise(nd,nf,nv,J.pitch);this.beep(bf,bd,bt,bv,bs,J.pitch*.5);},

 /* Wall/floor TAP. Only reached for a fresh, above-threshold contact now (physics.js hitFresh),
    so p spans a real range instead of sitting on the base volume forever — hence the widened
    default curve: quiet contacts really are quiet, and the loud end has somewhere to go. */
 wall(p,aC){const ak=aC||{},J=AUMIX.jitter,
  nd=ak.noiseDur??.045,nf=(ak.noiseFreq??2300)+p*(ak.noiseFreqScale??4),
  nv=Math.min(ak.noiseVolMax??.28,(ak.noiseVol??.012)+p*(ak.noiseVolScale??.0035));
  if(!this.ctx||!this.vgate('wall',nd))return;
  this.noise(nd,nf,nv,J.pitch,ak.q??.9);
  // a hard slap gets a short low body under the tick so it reads as mass, not just as treble
  const bt=ak.bodyFrom??55;
  if(p>bt)this.beep(ak.bodyFreq??150,ak.bodyDur??.055,'sine',
   Math.min(ak.bodyVolMax??.16,(p-bt)*(ak.bodyVolScale??.0016)),ak.bodySlide??-55,J.pitch*.5);},

 post(p,aC){if(!this.ctx)return;const c=this.ctx,ak=aC||{},R=this.rate>0?this.rate:1,J=AUMIX.jitter,
  frs=ak.freqs||[523,832,1290,1900],dr=ak.droop??.94,
  at=(ak.attack??.003)/R,de=(ak.decay??.28)/R,ds=(ak.decayShift??.045)/R,
  vm=ak.volMax??.5,vb=ak.vol??.14,vs=ak.volScale??.004,
  v=Math.min(vm,vb+p*vs),gv=v*this.vol;   // gv = the oscillator level; v stays clean for the noise
                                          // call below, which applies this.vol itself (no double-dip)
  if(!this.vgate('post',de+.14))return;
  const pj=1+(Math.random()*2-1)*J.pitch*.35;   // metal rings at a fixed pitch, so detune it only slightly
  frs.forEach((fr,i)=>{const o=c.createOscillator(),g=c.createGain(),f=fr*R*pj;
   o.type=i?'triangle':'sine';o.frequency.setValueAtTime(f,c.currentTime);
   o.frequency.exponentialRampToValueAtTime(f*dr,c.currentTime+de);
   this.env(g,c.currentTime,at,de-i*ds,gv*(1-i*(ak.falloff??.18)));o.connect(g);g.connect(this.mg);o.start();o.stop(c.currentTime+de+.14/R);});
  this.noise(ak.noiseDur??.03,ak.noiseFreq??3200,v*(ak.noiseVolScale??.5),J.pitch);this.exc=Math.min(1,this.exc+.25);},

/* Crowd REACTION — a shaped swell over the bed, not another impact one-shot. Au.exc only ever
    swells AFTER a loud contact; this is the crowd responding to something that made NO noise of its
    own — a shot that missed, a keeper who got there. The noise primitive can't do it: its attack is
    pinned at 4ms, and a gasp is entirely in the swell.
    Gated on cfg.ambience with the bed — turn the crowd off and they stop reacting too.
    Two shapes only; roar / hush / the tension ramp are still to come (FEATURE-IDEAS 1.2). */
 react(kind){
  if(!this.ctx||!this.nbuf||!cfg.ambience)return;
  const K=AUREACT[kind];if(!K)return;
  const R=this.rate>0?this.rate:1,a=K.a/R,d=K.d/R;
  if(!this.vgate('react',a+d))return;
  const c=this.ctx,t0=c.currentTime,s=c.createBufferSource();
  s.buffer=this.nbuf;s.loop=true;                       // 3s buffer, but loop so a slowed replay can't run it dry
  const f=c.createBiquadFilter();f.type='bandpass';f.Q.value=K.q;
  f.frequency.setValueAtTime(K.f0*R,t0);f.frequency.linearRampToValueAtTime(K.f1*R,t0+a+d);
  const g=c.createGain();this.env(g,t0,a,d,K.v*this.vol);
  s.connect(f);f.connect(g);g.connect(this.mg);s.start(t0);s.stop(t0+a+d+.1);
  this.exc=Math.min(1,this.exc+K.exc);                  // and it leaves the bed lifted behind it
 },
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
  ui(){this.beep(720,.05,'triangle',.1);},
   warnBeep(k=0){this.beep(900+600*k,.09,'square',.22);}}; // countdown tick for the cannonball warning (higher pitch as it nears detonation)
