'use strict';
/* ================= options screen =================
   Dedicated OPTIONS panel (main-menu gear + pause "Options"). Controller config
   (per-stick axis / sensitivity / invert + deadzone), mouse & keyboard sensitivity,
   and a live pad tester. Everything writes straight to `cfg` (persisted via saveCfg);
   input.js reads those keys each frame, so changes take effect instantly — no reload.
   Sensitivities are MULTIPLIERS on the CONFIG bases (1 = the tuned default). */

const OPT_DEFAULTS={padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,mouseSens:1,kbdSens:1,
 padControlMode:'classic',padTCBase:0.75,padTCFine:0.35,padTCFast:1.6,padTCSwerve:1,padTCSpinInvert:false};

// Standard-layout button map for the live tester (index → label).
const OPT_BTNS=[[0,'A'],[1,'B'],[2,'X'],[3,'Y'],[4,'LB'],[5,'RB'],[6,'LT'],[7,'RT'],
 [8,'BACK'],[9,'START'],[10,'L3'],[11,'R3'],[12,'▲'],[13,'▼'],[14,'◀'],[15,'▶']];
let optPills=[], optRAF=0, optFrom='menu', optSwingPh=0, optSwing=null, optSwingPrev=false, optLiveSx=null;

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
}
function updateAxisLines(){                                   // highlight the bound axis on each well
 const tc=cfg.padControlMode==='total';
 $('optLAxis').className='optAxisLine '+(cfg.padSlideAxis==='ly'?'vert':'horz');
 $('optRAxis').className='optAxisLine '+(cfg.padAngleAxis==='ry'?'vert':'horz');
 $('optLLbl').textContent='L · '+(cfg.padSlideAxis==='ly'?'↕':'↔')+' slide';
 $('optRLbl').textContent='R · '+(cfg.padAngleAxis==='ry'?'↕':'↔')+' angle'+(tc?' + '+(cfg.padAngleAxis==='ry'?'↔':'↕')+' swerve':'');
 // TC hint names the actual axes in play, so rebinding the angle axis re-labels the swerve line.
 $('optTCHint').textContent='Hold LT = precision steps · RT = fast · A = kick · X = raise · right stick '
  +(cfg.padAngleAxis==='ry'?'↔':'↕')+' = swerve line (bends the ball on contact) · angle stays '
  +(cfg.padAngleAxis==='ry'?'↕':'↔')+'. Triggers are analog — half-squeeze, half effect.';
}
function syncOptionsUI(){                                     // push cfg → controls
 $('optSlideAxis').value=cfg.padSlideAxis;$('optAngleAxis').value=cfg.padAngleAxis;
 $('optSlideSens').value=cfg.padSlideSens;$('optAngleSens').value=cfg.padAngleSens;
 $('optSlideInv').checked=cfg.padSlideInvert;$('optAngleInv').checked=cfg.padAngleInvert;
 $('optDead').value=cfg.padDeadzone;
 $('optMouseSens').value=cfg.mouseSens;$('optKbdSens').value=cfg.kbdSens;
 $('optCtlMode').value=cfg.padControlMode;
 $('optTCBase').value=cfg.padTCBase;$('optTCFine').value=cfg.padTCFine;
 $('optTCFast').value=cfg.padTCFast;$('optTCSwerve').value=cfg.padTCSwerve;
 $('optTCSpinInv').checked=!!cfg.padTCSpinInvert;
 updateOptLabels();updateAxisLines();updateTCVis();
}
function optDot(id,x,y){const R=34;                           // move a well dot to the live stick position
 $(id).style.transform='translate(calc(-50% + '+(clamp(x,-1,1)*R)+'px), calc(-50% + '+(clamp(y,-1,1)*R)+'px))';}
function optionsTick(){                                       // self-driven while the screen is open
 if($('options').classList.contains('hidden')){optRAF=0;return;}
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
function openOptions(from){
 optFrom=from||'menu';
 (optFrom==='pause'?$('pause'):$('menu')).classList.add('hidden');
 syncOptionsUI();tcSwingReset();
 $('options').classList.remove('hidden');Au.ui();
 if(!optRAF)optRAF=requestAnimationFrame(optionsTick);
}
function closeOptions(){
 $('options').classList.add('hidden');
 if(optRAF){cancelAnimationFrame(optRAF);optRAF=0;}
 (optFrom==='pause'?$('pause'):$('menu')).classList.remove('hidden');Au.ui();
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
 $('optCtlMode').onchange=e=>{cfg.padControlMode=e.target.value;updateTCVis();updateAxisLines();saveCfg();};
 $('optTCBase').oninput=e=>{cfg.padTCBase=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCFine').oninput=e=>{cfg.padTCFine=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCFast').oninput=e=>{cfg.padTCFast=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCSwerve').oninput=e=>{cfg.padTCSwerve=+e.target.value;updateOptLabels();saveCfg();};
 $('optTCSpinInv').onchange=e=>{cfg.padTCSpinInvert=e.target.checked;saveCfg();};
 $('optReset').onclick=()=>{Object.assign(cfg,OPT_DEFAULTS);saveCfg();syncOptionsUI();Au.ui();};
 syncOptionsUI();
}
