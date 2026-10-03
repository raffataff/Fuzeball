'use strict';
// ================= frame profiler (M) =================
// catches intermittent sags an average hides and names the cause
// ms = rAF to rAF (the true interval incl. compositing, GPU wait, uploads, GC); js = time inside loop() (sim / rend / refl / fx); gap = ms - js (a gap spiking while js is flat = not our code)
// a spike log, not a graph: a frame over CONFIG.perf.spikeMs (or spikeMult x typical) writes one line with its breakdown, newest first; perfDump() prints them
// verdict, in order: SHADER (programs grew this frame), GC (heap fell by gcDrop MB, Chrome only), GPU/BR (gap dominated), SIM (fixed-step loop dominated; `steps` pinned at SIM.maxSteps = slow-frame feedback), RENDER (render + the ball-reflection cube pass)
// renderer.info.autoReset is off while profiling so draw/tri accumulate across passes; cost when off: one boolean read per hook

const PERF={on:false,f:null,worst:null,pub:null,pubT:0,t0:0,spikes:[],
 prog:0,heap:0,draw:0,typ:16.7,fs:0,prev:0,panel:null,now:null,log:null};
const _pmk={};                                    // mark timestamps, keyed; pairs are sequential, never nested
function perfMark(k){if(PERF.on)_pmk[k]=performance.now();}
function perfAdd(k,b){if(!PERF.on||!PERF.f)return;const t=_pmk[k];if(t)PERF.f[b]+=performance.now()-t;}
function perfSteps(n){if(PERF.on&&PERF.f)PERF.f.steps=n;}
function perfSub(n){if(PERF.on&&PERF.f&&n>PERF.f.sub)PERF.f.sub=n;}   // physics.js: substeps actually run

// open a frame (after the fps-cap return, so a capped tick isn't counted); info.reset() makes draw/tri a per-frame total
function perfFrame(){
 if(!PERF.on)return;
 const n=performance.now();
 PERF.f={ms:PERF.prev?n-PERF.prev:0,js:0,gap:0,sim:0,rend:0,refl:0,fx:0,steps:0,sub:0};
 PERF.prev=n;PERF.fs=n;
 // autoReset is cleared here too: perf.js can be enabled from a saved cfg before initThree builds the renderer
 const ri=(typeof renderer!=='undefined'&&renderer)?renderer.info:null;
 if(ri){if(ri.autoReset)ri.autoReset=false;ri.reset();}
}
// close a frame: stamp the counters, diff against last frame, log a spike if slow, repaint the panel at most every CONFIG.perf.pub ms
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
   // timestamp is seconds since the profiler was switched on, not S.time (frozen outside a match)
   PERF.spikes.unshift({t:(n-PERF.t0)/1000,f,v:perfVerdict(f)});
   while(PERF.spikes.length>P.spikeMax)PERF.spikes.pop();
  }
 }
 if(!PERF.worst||f.ms>PERF.worst.ms)PERF.worst=f;
 if(n-PERF.pubT>P.pub){PERF.pubT=n;PERF.pub=PERF.worst;PERF.worst=null;perfRender();}
}
// name the dominant cost; a shader compile or GC also shows as a big gap or js, so they're tested first
function perfVerdict(f){
 const P=CONFIG.perf;
 if(f.dProg>0)return{t:'SHADER +'+f.dProg,c:'shader'};
 if(f.dHeap<=-P.gcDrop)return{t:'GC '+f.dHeap.toFixed(0)+'MB',c:'gc'};
 if(f.gap>f.js)return{t:'GPU/BROWSER',c:'gpu'};
 if(f.sim>=f.rend+f.refl&&f.sim>=f.fx)return{t:'SIM x'+f.steps,c:'sim'};
 if(f.rend+f.refl>=f.fx)return{t:'RENDER',c:'rend'};
 return{t:'JS',c:'js'};
}

// ---- panel (built in JS like the AI debug panel, no index.html template) ----
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
// console dump: one flat line per spike, newest first (paste this when asking someone)
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

// toggle: autoReset flips with the profiler and the baselines reset so the first frame back can't log a spike
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
// restore the saved state once the renderer exists (perf.js parses before initThree runs)
addEventListener('load',()=>{if(cfg.profiler)perfSet(true);});
