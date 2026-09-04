'use strict';
/* ================= options screen =================
   Dedicated OPTIONS panel (main-menu gear + pause "Options"). Controller config
   (per-stick axis / sensitivity / invert + deadzone), mouse & keyboard sensitivity,
   and a live pad tester. Everything writes straight to `cfg` (persisted via saveCfg);
   input.js reads those keys each frame, so changes take effect instantly — no reload.
   Sensitivities are MULTIPLIERS on the CONFIG bases (1 = the tuned default). */

const OPT_DEFAULTS={padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,mouseSens:1,kbdSens:1,mouseLock:true,
 padControlMode:'classic',padTCBase:0.75,padTCFine:0.35,padTCFast:1.6,padTCSwerve:1,padTCSpinInvert:false,
 padChargeBtn:'rt'};

// Standard-layout button map for the live tester (index → label).
const OPT_BTNS=[[0,'A'],[1,'B'],[2,'X'],[3,'Y'],[4,'LB'],[5,'RB'],[6,'LT'],[7,'RT'],
 [8,'BACK'],[9,'START'],[10,'L3'],[11,'R3'],[12,'▲'],[13,'▼'],[14,'◀'],[15,'▶']];
let optPills=[], optRAF=0, optFrom='menu', optSwingPh=0, optSwing=null, optSwingPrev=false, optLiveSx=null;
// Display-tab refresh detector (measured from optionsTick's own rAF cadence, which is uncapped even
// when the game's fps cap is on) — see optionsTick.
let optRefLast=0, optRefAcc=[], optRefShown=0;

/* ---- Display / graphics ------------------------------------------------
   Quality presets bundle the four heavy knobs so a casual player gets one-click choices; touching any
   individual control flips the preset to 'custom'. Applied live via applyDisplay() (render scale +
   shadows, world.js) and applyRoom()/refreshBallReflect() (reflections) — no reload. */
const GFX_PRESETS={
 low:{renderScale:0.5,shadows:false,shadowQuality:'low',reflections:false,fpsCap:30,reducedFx:true},
 medium:{renderScale:0.75,shadows:true,shadowQuality:'low',reflections:false,fpsCap:60,reducedFx:true},
 high:{renderScale:1,shadows:true,shadowQuality:'high',reflections:true,fpsCap:0,reducedFx:false}
};
function applyReducedFx(){document.body.classList.toggle('lowFx',!!cfg.reducedFx);}   // cheap-CSS mode (see .lowFx in styles.css)
function applyGfxPreset(name){
 const p=GFX_PRESETS[name];if(!p)return;
 cfg.renderScale=p.renderScale;cfg.shadows=p.shadows;cfg.shadowQuality=p.shadowQuality;
 cfg.reflections=p.reflections;cfg.fpsCap=p.fpsCap;cfg.reducedFx=p.reducedFx;
 cfg.gfxPreset=name;
 applyDisplay();applyReducedFx();
 // A preset moves `reflections`, which re-decides the room's env map and pays a PMREM bake — so
 // it goes through the staged gate (js/flow.js) like every other venue-touching control.
 venueLoad(d=>{applyRoom(d);refreshBallReflect();},{label:'APPLYING PRESET'});
 if($('setReflect'))$('setReflect').checked=cfg.reflections;   // keep the Match-Setup mirror in step
 syncDisplayUI();saveCfg();
}
/* Shadow quality only means anything while shadows are ON, so it greys out with the tick rather
   than sitting there as a live control that does nothing — same call as the charge-input row. */
function syncShadowQ(){
 $('optShadowQ').value=cfg.shadowQuality==='high'?'high':'low';
 $('optShadowQ').disabled=cfg.shadows===false;
}
function syncDisplayUI(){                                     // push cfg → display controls
 $('optPreset').value=cfg.gfxPreset||'custom';
 $('optRScale').value=cfg.renderScale;
 $('optRScaleV').textContent=Math.round(cfg.renderScale*100)+'%';
 $('optShadows').checked=cfg.shadows!==false;
 syncShadowQ();
 $('optReflect2').checked=!!cfg.reflections;
 $('optReducedFx').checked=!!cfg.reducedFx;
 $('optTrails').checked=cfg.trails!==false;
 $('optParticles').checked=cfg.particles!==false;
 $('optMarks').checked=cfg.marks!==false;
 $('optRodHoles').checked=cfg.rodHoles!==false;
 $('optFog').checked=cfg.fog!==false;
 $('optFpsCap').value=String(cfg.fpsCap||0);
 $('optPhysQ').value=cfg.physQuality||'high';
 $('optShowFps').checked=!!cfg.showFps;
}
function optSetTab(name){
 const isC=name!=='display';
 $('optTab_controls').classList.toggle('hidden',!isC);
 $('optTab_display').classList.toggle('hidden',isC);
 $('optTabBtnControls').classList.toggle('on',isC);
 $('optTabBtnDisplay').classList.toggle('on',!isC);
}

/* ---- TC swing analyser -------------------------------------------------
   Simulates a struck ball's horizontal flight with the REAL match physics —
   stepBall's Magnus rotation (spinTurn/spinMax), spin decay, floor friction —
   from a representative strike speed, out to goal range. The live faint curve
   tracks the stick; pressing A 'swings' and locks the full breakdown. */
const TC_SIM={v0:90,range:60,h:1/120};                       // strike speed (u/s), downrange sample distance, sim step
function tcShotSim(sx){
 const spin0=clamp(sx*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
 const h=TC_SIM.h;let vx=0,vy=TC_SIM.v0,x=0,y=0,spin=spin0,bend=0,t=0;
 const pts=[{x:0,y:0}];
 while(y<TC_SIM.range&&t<1.6){
  if(spin){const a=clamp(spin*PHY.spinTurn*h,-PHY.spinMax,PHY.spinMax),cs=Math.cos(a),sn=Math.sin(a),ox=vx;
   vx=ox*cs-vy*sn;vy=ox*sn+vy*cs;bend+=a;spin*=Math.exp(-PHY.spinDecay*h);if(Math.abs(spin)<PHY.spinCut)spin=0;}
  const f=Math.exp(-PHY.floorFric*h);vx*=f;vy*=f;
  x+=vx*h;y+=vy*h;t+=h;pts.push({x,y});
 }
 return{sx,spin:spin0,pts,bend:Math.abs(bend)*180/Math.PI,drift:Math.abs(x)};
}
function tcSwingPath(sim){                                    // world pts → SVG path (75=centre, 1.5px/u, 102→12 downrange)
 const s=90/TC_SIM.range;let d='';
 for(let i=0;i<sim.pts.length;i+=3){const p=sim.pts[i];
  d+=(d?'L':'M')+clamp(75-p.x*1.5,5,145).toFixed(1)+' '+(102-Math.min(p.y,TC_SIM.range)*s).toFixed(1)+' ';}
 const p=sim.pts[sim.pts.length-1];
 return d+'L'+clamp(75-p.x*1.5,5,145).toFixed(1)+' '+(102-Math.min(p.y,TC_SIM.range)*s).toFixed(1);
}
function tcSwingType(sim){
 const m=Math.abs(sim.sx);if(m<.06)return'STRAIGHT';
 return(m<.35?'CURL':m<.7?'BENDER':'BANANA')+(sim.sx>0?' RIGHT':' LEFT');
}
function tcLockSwing(sx){                                     // A pressed → freeze this swing + fill the stat readout
 optSwing=tcShotSim(sx);optSwingPh=0;
 $('optSwervePath').setAttribute('d',tcSwingPath(optSwing));
 $('optSwerveBall').style.opacity=1;
 $('optSwerveType').textContent=tcSwingType(optSwing);
 $('optSwStatSw').textContent=Math.round(Math.abs(sx)*100)+'%'+(Math.abs(sx)<.02?'':sx>0?' R':' L');
 $('optSwStatSpin').textContent=(optSwing.spin>0?'+':'')+optSwing.spin.toFixed(2);
 $('optSwStatBend').textContent=Math.round(optSwing.bend)+'°';
 $('optSwStatDrift').textContent=optSwing.drift.toFixed(1)+'u';
}
function tcSwingReset(){                                      // back to the 'no swing yet' prompt
 optSwing=null;optLiveSx=null;optSwingPrev=false;
 $('optSwervePath').setAttribute('d','');$('optSwerveLive').setAttribute('d','');
 $('optSwerveBall').style.opacity=0;
 $('optSwerveType').textContent='SWING (A) TO READ IT';
 for(const id of['optSwStatSw','optSwStatSpin','optSwStatBend','optSwStatDrift'])$(id).textContent='—';
}

function buildOptBtns(){
 const box=$('optBtns');box.innerHTML='';optPills=[];
 for(const [i,lbl] of OPT_BTNS){
  const el=document.createElement('span');el.className='optBtn';el.textContent=lbl;
  box.appendChild(el);optPills.push({i,el,on:false});
 }
}
function updateOptLabels(){
 $('optSlideSensV').textContent=(+cfg.padSlideSens).toFixed(2)+'×';
 $('optAngleSensV').textContent=(+cfg.padAngleSens).toFixed(2)+'×';
 $('optDeadV').textContent=(+cfg.padDeadzone).toFixed(2);
 $('optMouseSensV').textContent=(+cfg.mouseSens).toFixed(2)+'×';
 $('optKbdSensV').textContent=(+cfg.kbdSens).toFixed(2)+'×';
 $('optTCBaseV').textContent=(+cfg.padTCBase).toFixed(2)+'×';
 $('optTCFineV').textContent=(+cfg.padTCFine).toFixed(2)+'×';
 $('optTCFastV').textContent=(+cfg.padTCFast).toFixed(2)+'×';
 $('optTCSwerveV').textContent=(+cfg.padTCSwerve).toFixed(2)+'×';
}
function updateTCVis(){                                    // TC sliders + tester swerve preview only make sense in Total Control mode
 const off=cfg.padControlMode!=='total';
 $('optTC').classList.toggle('hidden',off);$('optSwerve').classList.toggle('hidden',off);
 /* The charge-input row is CLASSIC-only: in Total Control the right stick's pull-back is the
    wind-up and the two triggers held together arm it, so there is nothing to choose. A live control
    that silently does nothing is the thing you debug twice — same call as the room editor's fog
    boxes, which now say so rather than sitting there inert. */
 const shots=(typeof shotsOn==='function')&&shotsOn();
 $('optChargeRow').classList.toggle('hidden',!off||!shots);
 $('optChargeHint').classList.toggle('hidden',!shots);
 $('optChargeHint').innerHTML=off
  ?'<b>RT / R2</b> holds the wind-up and the kick button stays instant — nothing about a tapped kick changes. Moving the charge onto the kick button makes a tap fire on RELEASE, which costs you the length of your own tap before the ball is struck.'
  :'In <b>Total Control</b> the wind-up is the right stick: pull back and hold <b>both triggers</b> to charge, flick forward to strike.';
}
function updateAxisLines(){                                   // highlight the bound axis on each well
 const tc=cfg.padControlMode==='total';
 $('optLAxis').className='optAxisLine '+(cfg.padSlideAxis==='ly'?'vert':'horz');
 $('optRAxis').className='optAxisLine '+(cfg.padAngleAxis==='ry'?'vert':'horz');
 $('optLLbl').textContent='L · '+(cfg.padSlideAxis==='ly'?'↕':'↔')+' slide';
 $('optRLbl').textContent='R · '+(cfg.padAngleAxis==='ry'?'↕':'↔')+' angle'+(tc?' + '+(cfg.padAngleAxis==='ry'?'↔':'↕')+' swerve':'');
 // TC hint names the actual axes in play, so rebinding the angle axis re-labels the swerve line.
 $('optTCHint').textContent='LT = precision steps + a softer swing · RT = fast steps + a harder one · BOTH, with the '
  +'stick pulled back = charge · A = kick · X = raise · right stick '
  +(cfg.padAngleAxis==='ry'?'↔':'↕')+' = swerve line (bends the ball on contact) · angle stays '
  +(cfg.padAngleAxis==='ry'?'↕':'↔')+'. Triggers are analog — half-squeeze, half effect.';
}
function syncOptionsUI(){                                     // push cfg → controls
 $('optSlideAxis').value=cfg.padSlideAxis;$('optAngleAxis').value=cfg.padAngleAxis;
 $('optSlideSens').value=cfg.padSlideSens;$('optAngleSens').value=cfg.padAngleSens;
 $('optSlideInv').checked=cfg.padSlideInvert;$('optAngleInv').checked=cfg.padAngleInvert;
 $('optDead').value=cfg.padDeadzone;
 $('optMouseSens').value=cfg.mouseSens;$('optKbdSens').value=cfg.kbdSens;
 $('optMouseLock').checked=cfg.mouseLock!==false;
 $('optCtlMode').value=cfg.padControlMode;
 $('optChargeBtn').value=cfg.padChargeBtn||'rt';
 $('optTCBase').value=cfg.padTCBase;$('optTCFine').value=cfg.padTCFine;
 $('optTCFast').value=cfg.padTCFast;$('optTCSwerve').value=cfg.padTCSwerve;
 $('optTCSpinInv').checked=!!cfg.padTCSpinInvert;
 updateOptLabels();updateAxisLines();updateTCVis();syncDisplayUI();
}
function optDot(id,x,y){const R=34;                           // move a well dot to the live stick position
 $(id).style.transform='translate(calc(-50% + '+(clamp(x,-1,1)*R)+'px), calc(-50% + '+(clamp(y,-1,1)*R)+'px))';}
function optionsTick(){                                       // self-driven while the screen is open
 if($('options').classList.contains('hidden')){optRAF=0;return;}
 // Refresh detector (Display tab): time this rAF against the last. This callback is NOT the game loop,
 // so it isn't affected by the fps cap — it samples the true display cadence. Median of recent frames
 // → Hz, so a one-off long frame can't skew it. Read-only: browsers don't let a page set refresh/vsync.
 {const now=performance.now();
  if(optRefLast){const d=now-optRefLast;if(d>1&&d<100){optRefAcc.push(d);if(optRefAcc.length>90)optRefAcc.shift();}}
  optRefLast=now;
  if(optRefAcc.length>=20){const s=[...optRefAcc].sort((a,b)=>a-b),med=s[s.length>>1],hz=Math.round(1000/med);
   detectedHz=hz;   // refine the global used by the 'Match display' frame limit (catches a monitor change)
   if(hz!==optRefShown){optRefShown=hz;$('optRefresh').textContent=hz+' Hz';}}}
 const pads=navigator.getGamepads?navigator.getGamepads():[];let gp=null;
 for(const p of pads){if(p){gp=p;break;}}
 const st=$('optPadStatus');
 if(gp){st.classList.add('on');st.textContent=(gp.id||'Controller').slice(0,36);}
 else{st.classList.remove('on');st.textContent='No controller detected';}
 const ax=gp?gp.axes:[];
 optDot('optLDot',ax[0]||0,ax[1]||0);optDot('optRDot',ax[2]||0,ax[3]||0);
 for(const p of optPills){const d=!!(gp&&gpDown(gp,p.i));if(p.on!==d){p.on=d;p.el.classList.toggle('on',d);}}
 // TC swing analyser: tcSwerveFromAxes is the SAME pipeline input.js feeds the strike with, and the
 // sim uses stepBall's spin constants — so the readout IS what a contact at that stick would do.
 // Faint dashed curve + % track the stick live; pressing A (kick) locks the swing: bold flight
 // curve, ball looping along it, and the stat row (swerve/spin/bend/drift) underneath.
 const sw=$('optSwerve');
 if(!sw.classList.contains('hidden')){
  const sx=gp?tcSwerveFromAxes(gp):0;
  if(optLiveSx===null||Math.abs(sx-optLiveSx)>.004){optLiveSx=sx;
   $('optSwerveLive').setAttribute('d',tcSwingPath(tcShotSim(sx)));}
  $('optSwerveLivePct').textContent=Math.round(Math.abs(sx)*100)+'%';
  $('optSwerveL').classList.toggle('on',sx<-.02);$('optSwerveR').classList.toggle('on',sx>.02);
  const a=!!(gp&&gpDown(gp,0));
  if(a&&!optSwingPrev)tcLockSwing(sx);
  optSwingPrev=a;
  if(optSwing){optSwingPh=(optSwingPh+.011)%1;
   const p=$('optSwervePath'),pt=p.getPointAtLength(p.getTotalLength()*optSwingPh);
   $('optSwerveBall').setAttribute('cx',pt.x.toFixed(1));$('optSwerveBall').setAttribute('cy',pt.y.toFixed(1));}
 }
 optRAF=requestAnimationFrame(optionsTick);
}
/* Options is reachable from more than one place, so its back-target is written per open rather
   than declared in the registry. The PAUSE route stays off the router entirely: #pause is an
   overlay sitting on a LIVE match, so routing to it would leave the router's current screen
   pointing at a menu that isn't coming back until gotoMenu. */
SCREENS.options.onHide=()=>{if(optRAF){cancelAnimationFrame(optRAF);optRAF=0;}};
function openOptions(from){
 optFrom=from||'menu';
 optRefLast=0;optRefAcc.length=0;   // fresh refresh sampling each open (drop the stale gap since last close)
 syncOptionsUI();tcSwingReset();
 if(optFrom==='pause'){$('pause').classList.add('hidden');$('options').classList.remove('hidden');}
 else{SCREENS.options.back=optFrom;showScreen('options');}
 Au.ui();
 if(!optRAF)optRAF=requestAnimationFrame(optionsTick);
}
function closeOptions(){
 if(optFrom==='pause'){$('options').classList.add('hidden');if(optRAF){cancelAnimationFrame(optRAF);optRAF=0;}$('pause').classList.remove('hidden');}
 else showScreen(SCREENS.options.back||'menu');   // onHide above kills the rAF
 Au.ui();
}
function bindOptions(){
 buildOptBtns();
 $('btnOptions').onclick=()=>openOptions('menu');
 $('btnPauseOptions').onclick=()=>openOptions('pause');
 $('optDone').onclick=()=>closeOptions();
 $('optSlideAxis').onchange=e=>{cfg.padSlideAxis=e.target.value;updateAxisLines();saveCfg();};
 $('optAngleAxis').onchange=e=>{cfg.padAngleAxis=e.target.value;updateAxisLines();saveCfg();};
 $('optSlideSens').oninput=e=>{cfg.padSlideSens=+e.target.value;updateOptLabels();saveCfg();};
 $('optAngleSens').oninput=e=>{cfg.padAngleSens=+e.target.value;updateOptLabels();saveCfg();};
 $('optSlideInv').onchange=e=>{cfg.padSlideInvert=e.target.checked;saveCfg();};
 $('optAngleInv').onchange=e=>{cfg.padAngleInvert=e.target.checked;saveCfg();};
 $('optDead').oninput=e=>{cfg.padDeadzone=+e.target.value;updateOptLabels();saveCfg();};
 $('optMouseSens').oninput=e=>{cfg.mouseSens=+e.target.value;updateOptLabels();saveCfg();};
 $('optKbdSens').oninput=e=>{cfg.kbdSens=+e.target.value;updateOptLabels();saveCfg();};
 $('optMouseLock').onchange=e=>{cfg.mouseLock=e.target.checked;saveCfg();};   // input.js re-reads it every frame, so it takes effect mid-match
 $('optCtlMode').onchange=e=>{cfg.padControlMode=e.target.value;updateTCVis();updateAxisLines();saveCfg();};
 $('optChargeBtn').onchange=e=>{cfg.padChargeBtn=e.target.value;saveCfg();};
 $('optTCBase').oninput=e=>{cfg.padTCBase=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCFine').oninput=e=>{cfg.padTCFine=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCFast').oninput=e=>{cfg.padTCFast=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCSwerve').oninput=e=>{cfg.padTCSwerve=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCSpinInv').onchange=e=>{cfg.padTCSpinInvert=e.target.checked;saveCfg();};
 // --- Display tab ---
 $('optTabBtnControls').onclick=()=>{optSetTab('controls');Au.ui();};
 $('optTabBtnDisplay').onclick=()=>{optSetTab('display');Au.ui();};
 $('optPreset').onchange=e=>{if(e.target.value==='custom'){cfg.gfxPreset='custom';saveCfg();}else applyGfxPreset(e.target.value);};
 $('optRScale').oninput=e=>{cfg.renderScale=+e.target.value;cfg.gfxPreset='custom';$('optPreset').value='custom';
  $('optRScaleV').textContent=Math.round(cfg.renderScale*100)+'%';applyDisplay();saveCfg();};
 $('optShadows').onchange=e=>{cfg.shadows=e.target.checked;cfg.gfxPreset='custom';$('optPreset').value='custom';
  syncShadowQ();applyDisplay();saveCfg();};
 // Map size + filter + bias, from CONFIG.render.shadow.quality — applyDisplay swaps them live.
 $('optShadowQ').onchange=e=>{cfg.shadowQuality=e.target.value==='high'?'high':'low';
  cfg.gfxPreset='custom';$('optPreset').value='custom';applyDisplay();saveCfg();};
 $('optReflect2').onchange=e=>{cfg.reflections=e.target.checked;cfg.gfxPreset='custom';$('optPreset').value='custom';
  venueLoad(d=>{applyRoom(d);refreshBallReflect();},{label:'REFLECTIONS'});
  if($('setReflect'))$('setReflect').checked=e.target.checked;saveCfg();};
 $('optReducedFx').onchange=e=>{cfg.reducedFx=e.target.checked;cfg.gfxPreset='custom';$('optPreset').value='custom';applyReducedFx();saveCfg();};
 $('optTrails').onchange=e=>{cfg.trails=e.target.checked;saveCfg();};        // fx.js spawnTrail reads cfg.trails live
 $('optParticles').onchange=e=>{cfg.particles=e.target.checked;saveCfg();};  // fx.js burst* read cfg.particles live
 $('optMarks').onchange=e=>{cfg.marks=e.target.checked;if(!cfg.marks)clearMarks();saveCfg();};  // off wipes what is already up
 $('optRodHoles').onchange=e=>{cfg.rodHoles=e.target.checked;saveCfg();};   // rings settle back to their authored look on their own
 // Deliberately does NOT flip the preset to 'custom': fog is a LOOK, not one of the four heavy
 // knobs a preset bundles, so it is no more a preset member than ball trails are.
 $('optFog').onchange=e=>{cfg.fog=e.target.checked;applyFog();saveCfg();};   // world.js: one recompile per real change
 $('optFpsCap').onchange=e=>{const v=e.target.value;cfg.fpsCap=v==='match'?'match':+v;cfg.gfxPreset='custom';$('optPreset').value='custom';saveCfg();};
 $('optPhysQ').onchange=e=>{cfg.physQuality=e.target.value;applyPhysQuality();saveCfg();};   // CPU sim precision — separate from the GPU preset
 $('optShowFps').onchange=e=>{cfg.showFps=e.target.checked;saveCfg();};
 $('optReset').onclick=()=>{Object.assign(cfg,OPT_DEFAULTS);saveCfg();syncOptionsUI();Au.ui();};
 applyReducedFx();   // apply saved reduced-effects mode at boot (physics/render quality already applied in config/world)
 syncOptionsUI();
}
