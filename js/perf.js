'use strict';
/* ================= frame profiler (M) =================
   The FPS counter tells you the frame rate dipped. This tells you what the frame was
   DOING when it did. Built for one job: catching the random multi-second sags that an
   average hides, and naming the cause without a browser profiler attached.

   TWO CLOCKS PER FRAME, and the difference between them is the whole point:
     ms  — rAF to rAF. The TRUE frame interval: our work PLUS compositing, GPU wait,
           texture upload and any GC that ran between frames.
     js  — time inside loop(). Our own work, split into sim / rend / refl / fx.
   gap = ms − js. Under vsync a healthy gap is just idle time. A gap that SPIKES while
   js stays flat means the stall is NOT in our code — driver, compositor or GC — and no
   amount of optimising the sim will touch it. That one distinction is most of the value
   here, because everything else we can already guess at by reading.

   WHY A SPIKE LOG AND NOT A GRAPH. The sag we're chasing is intermittent, so a rolling
   average is exactly the wrong instrument — it smears the evidence. Every frame that
   exceeds CONFIG.perf.spikeMs (or spikeMult x the running-typical frame) writes ONE
   line with its full breakdown, newest first. Play until it happens, then read the log
   or paste perfDump() out of the console.

   THE VERDICT on each line is a heuristic, in priority order:
     SHADER   renderer.info.programs GREW this frame — a material compiled mid-play.
              The classic multi-hundred-ms freeze; see the fx-light-pool note in
              CLAUDE.md for why r128 does this so easily (light count is baked into
              every material's program, so one added light recompiles the scene).
     GC       the JS heap FELL by gcDrop MB — a collection ran. Chrome only
              (performance.memory); reads 0 elsewhere and the check just never fires.
     GPU/BR   gap dominated: the stall happened outside our JS entirely.
     SIM      the fixed-step loop dominated. `steps` is the tell — main.js banks up to
              SIM.maxSteps steps per frame, so a SLOW frame runs MORE sim than a fast
              one and the cost latches. steps pinned at max = that feedback loop, and
              the trigger may have been something long gone.
     RENDER   renderer.render + the ball-reflection cube pass. Watch `draw`:
              updateBallReflect renders the whole scene 6 MORE times every `every`
              frames, so anything that adds objects is multiplied here.

   renderer.info.autoReset is turned OFF while profiling so draw/tri ACCUMULATE across
   the cube pass and the main pass — i.e. a true per-frame total rather than just the
   last render() call. Restored on toggle-off. fpsDiag()'s once-a-second DRAW line reads
   the same counter and stays correct either way.

   Cost when off: one boolean read per hook. Nothing is allocated, nothing is measured. */

const PERF={on:false,f:null,worst:null,pub:null,pubT:0,t0:0,spikes:[],
 prog:0,heap:0,draw:0,typ:16.7,fs:0,prev:0,panel:null,now:null,log:null};
const _pmk={};                                    // mark timestamps, keyed; pairs are sequential, never nested
function perfMark(k){if(PERF.on)_pmk[k]=performance.now();}
function perfAdd(k,b){if(!PERF.on||!PERF.f)return;const t=_pmk[k];if(t)PERF.f[b]+=performance.now()-t;}
function perfSteps(n){if(PERF.on&&PERF.f)PERF.f.steps=n;}
function perfSub(n){if(PERF.on&&PERF.f&&n>PERF.f.sub)PERF.f.sub=n;}   // physics.js: substeps actually run

/* Open a frame. Called from loop() AFTER the fps-cap early-return, so a capped-away rAF
   tick isn't counted as a frame we rendered. info.reset() here is what makes draw/tri a
   per-frame total across every render pass (see header). */
function perfFrame(){
 if(!PERF.on)return;
 const n=performance.now();
 PERF.f={ms:PERF.prev?n-PERF.prev:0,js:0,gap:0,sim:0,rend:0,refl:0,fx:0,steps:0,sub:0};
 PERF.prev=n;PERF.fs=n;
 // autoReset is cleared HERE rather than only in perfSet: perf.js can be enabled from a saved
 // cfg before initThree has built the renderer, and this self-heals whenever it does exist.
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 if(ri){if(ri.autoReset)ri.autoReset=false;ri.reset();}
}
/* Close a frame: stamp the counters, diff them against last frame, log a spike if this
   one was slow, and repaint the panel at most once every CONFIG.perf.pub ms. */
function perfFrameEnd(){
 if(!PERF.on||!PERF.f)return;
 const P=CONFIG.perf,f=PERF.f,n=performance.now();
 f.js=n-PERF.fs;f.gap=Math.max(0,f.ms-f.js);
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 f.draw=ri?ri.render.calls:0;f.tri=ri?ri.render.triangles:0;
 f.prog=(ri&&ri.programs)?ri.programs.length:0;
 f.geo=ri?ri.memory.geometries:0;f.tex=ri?ri.memory.textures:0;
 const pm=performance.memory;f.heap=pm?pm.usedJSHeapSize/1048576:0;
 f.dProg=PERF.prog?f.prog-PERF.prog:0;                  // >0 = a shader compiled THIS frame
 f.dHeap=PERF.heap?f.heap-PERF.heap:0;                  // <0 = a collection ran
 f.dDraw=PERF.draw?f.draw-PERF.draw:0;
 PERF.prog=f.prog;PERF.heap=f.heap;PERF.draw=f.draw;
 if(f.ms>0){
  PERF.typ+=(f.ms-PERF.typ)*.05;                        // running-typical frame (EMA), the spike baseline
  if(f.ms>Math.max(P.spikeMs,PERF.typ*P.spikeMult)){
   // Timestamp is seconds since the profiler was switched on, NOT S.time — the match clock is
   // frozen outside a match, which would stamp every menu-side spike identically.
   PERF.spikes.unshift({t:(n-PERF.t0)/1000,f,v:perfVerdict(f)});
   while(PERF.spikes.length>P.spikeMax)PERF.spikes.pop();
  }
 }
 if(!PERF.worst||f.ms>PERF.worst.ms)PERF.worst=f;
 if(n-PERF.pubT>P.pub){PERF.pubT=n;PERF.pub=PERF.worst;PERF.worst=null;perfRender();}
}
/* Name the dominant cost. Order matters: a shader compile or a GC will ALSO show up as a
   big gap or a big js, so those two are tested first or they'd be misattributed. */
function perfVerdict(f){
 const P=CONFIG.perf;
 if(f.dProg>0)return{t:'SHADER +'+f.dProg,c:'shader'};
 if(f.dHeap<=-P.gcDrop)return{t:'GC '+f.dHeap.toFixed(0)+'MB',c:'gc'};
 if(f.gap>f.js)return{t:'GPU/BROWSER',c:'gpu'};
 if(f.sim>=f.rend+f.refl&&f.sim>=f.fx)return{t:'SIM x'+f.steps,c:'sim'};
 if(f.rend+f.refl>=f.fx)return{t:'RENDER',c:'rend'};
 return{t:'JS',c:'js'};
}

/* ---- panel (built in JS like the AI debug panel — no index.html template) ---- */
function perfBuild(){
 if(PERF.panel)return;
 const d=document.createElement('div');d.id='perfPanel';
 d.innerHTML='<h4>FRAME PROFILER<b>M</b></h4><div id="perfNow"></div>'
  +'<div class="pfHead">SPIKES · worst frames first · perfDump() to copy</div><div id="perfLog"></div>';
 document.body.appendChild(d);
 PERF.panel=d;PERF.now=$('perfNow');PERF.log=$('perfLog');
}
function pfN(v){return v.toFixed(1);}
function pfK(v){return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':String(v);}
function pfRow(k,v){return '<div class="pfR"><span>'+k+'</span>'+v+'</div>';}
function perfRender(){
 const f=PERF.pub;if(!f||!PERF.panel)return;
 const cap=(typeof SIM!=='undefined'&&SIM)?SIM.maxSteps:'?';
 PERF.now.innerHTML=
  pfRow('worst',pfN(f.ms)+'ms <i>'+(f.ms>0?(1000/f.ms).toFixed(0):'--')+'fps</i>')
 +pfRow('js',pfN(f.js)+' <i>gap</i> '+pfN(f.gap))
 +pfRow('sim',pfN(f.sim)+' <i>steps</i> '+f.steps+'/'+cap+' <i>sub</i> '+f.sub)
 +pfRow('render',pfN(f.rend)+' <i>refl</i> '+pfN(f.refl)+' <i>fx</i> '+pfN(f.fx))
 +pfRow('draw',f.draw+' <i>tri</i> '+pfK(f.tri)+' <i>prog</i> '+f.prog)
 +pfRow('geo',f.geo+' <i>tex</i> '+f.tex+' <i>heap</i> '+f.heap.toFixed(0)+'MB');
 let h='';
 for(const s of PERF.spikes){
  const f2=s.f;
  h+='<div class="pfL"><b class="pf-'+s.v.c+'">'+s.v.t+'</b>'
   +'<u>'+s.t.toFixed(1)+'s</u> '+pfN(f2.ms)+'ms'
   +' <i>js</i>'+pfN(f2.js)+' <i>gap</i>'+pfN(f2.gap)
   +' <i>sim</i>'+pfN(f2.sim)+'<i>x</i>'+f2.steps
   +' <i>rn</i>'+pfN(f2.rend)+' <i>rf</i>'+pfN(f2.refl)+' <i>fx</i>'+pfN(f2.fx)
   +' <i>dr</i>'+f2.draw+(f2.dDraw?'<em>'+(f2.dDraw>0?'+':'')+f2.dDraw+'</em>':'')
   +' <i>pg</i>'+f2.prog+' <i>hp</i>'+f2.heap.toFixed(0)
   +'</div>';
 }
 PERF.log.innerHTML=h||'<div class="pfL pfNone">no spikes yet — play on</div>';
}
/* Console dump: one flat line per spike, newest first. This is the thing to paste when
   asking someone else what they're looking at. */
function perfDump(){
 const L=PERF.spikes.map(s=>{const f=s.f;return s.t.toFixed(1)+'s '+s.v.t
  +' ms='+pfN(f.ms)+' js='+pfN(f.js)+' gap='+pfN(f.gap)
  +' sim='+pfN(f.sim)+' rend='+pfN(f.rend)+' refl='+pfN(f.refl)+' fx='+pfN(f.fx)
  +' steps='+f.steps+' sub='+f.sub
  +' draw='+f.draw+'('+(f.dDraw>0?'+':'')+f.dDraw+') tri='+f.tri
  +' prog='+f.prog+'('+(f.dProg>0?'+':'')+f.dProg+')'
  +' geo='+f.geo+' tex='+f.tex+' heap='+f.heap.toFixed(0)+'('+(f.dHeap>0?'+':'')+f.dHeap.toFixed(1)+')';});
 console.log('--- fuzeball frame spikes ('+L.length+', newest first) ---\n'+(L.join('\n')||'none'));
 return L.length+' spike(s)';
}
function perfClear(){PERF.spikes.length=0;perfRender();}

/* Toggle. autoReset is flipped with the profiler (see header) and the running baselines
   are reset so the first frame back can't log itself as a spike. */
function perfSet(on){
 perfBuild();
 PERF.on=!!on;
 PERF.panel.style.display=PERF.on?'block':'none';
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 if(ri){ri.autoReset=!PERF.on;ri.reset();}   // perfFrame re-clears it if the renderer wasn't up yet
 PERF.prev=0;PERF.worst=null;PERF.pub=null;PERF.typ=16.7;PERF.prog=0;PERF.heap=0;PERF.draw=0;
 PERF.pubT=PERF.t0=performance.now();
 if(cfg.profiler!==PERF.on){cfg.profiler=PERF.on;saveCfg();}
}
function togglePerf(){
 perfSet(!PERF.on);
 toast('FRAME PROFILER',PERF.on?'M to hide · perfDump() in console':'off',1.1);
 Au.ui();
}
// Restore the saved state once the renderer exists (perf.js parses before initThree runs).
addEventListener('load',()=>{if(cfg.profiler)perfSet(true);});
