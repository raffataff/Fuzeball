'use strict';
/* ================= options screen =================
   Dedicated OPTIONS panel (main-menu gear + pause "Options"). Controller config
   (per-stick axis / sensitivity / invert + deadzone), mouse & keyboard sensitivity,
   and a live pad tester. Everything writes straight to `cfg` (persisted via saveCfg);
   input.js reads those keys each frame, so changes take effect instantly — no reload.
   Sensitivities are MULTIPLIERS on the CONFIG bases (1 = the tuned default). */

const OPT_DEFAULTS={padSlideAxis:'ly',padAngleAxis:'ry',padSlideSens:1,padAngleSens:1,padSlideCurve:1,
 padSlideInvert:false,padAngleInvert:false,padDeadzone:0.25,mouseSens:1,kbdSens:1};

// Standard-layout button map for the live tester (index → label).
const OPT_BTNS=[[0,'A'],[1,'B'],[2,'X'],[3,'Y'],[4,'LB'],[5,'RB'],[6,'LT'],[7,'RT'],
 [8,'BACK'],[9,'START'],[10,'L3'],[11,'R3'],[12,'▲'],[13,'▼'],[14,'◀'],[15,'▶']];
let optPills=[], optRAF=0, optFrom='menu';

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
}
function updateAxisLines(){                                   // highlight the bound axis on each well
 $('optLAxis').className='optAxisLine '+(cfg.padSlideAxis==='ly'?'vert':'horz');
 $('optRAxis').className='optAxisLine '+(cfg.padAngleAxis==='ry'?'vert':'horz');
 $('optLLbl').textContent='L · '+(cfg.padSlideAxis==='ly'?'↕':'↔')+' slide';
 $('optRLbl').textContent='R · '+(cfg.padAngleAxis==='ry'?'↕':'↔')+' angle';
}
function syncOptionsUI(){                                     // push cfg → controls
 $('optSlideAxis').value=cfg.padSlideAxis;$('optAngleAxis').value=cfg.padAngleAxis;
 $('optSlideSens').value=cfg.padSlideSens;$('optAngleSens').value=cfg.padAngleSens;
 $('optSlideInv').checked=cfg.padSlideInvert;$('optAngleInv').checked=cfg.padAngleInvert;
 $('optDead').value=cfg.padDeadzone;
 $('optMouseSens').value=cfg.mouseSens;$('optKbdSens').value=cfg.kbdSens;
 updateOptLabels();updateAxisLines();
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
 optRAF=requestAnimationFrame(optionsTick);
}
function openOptions(from){
 optFrom=from||'menu';
 (optFrom==='pause'?$('pause'):$('menu')).classList.add('hidden');
 syncOptionsUI();
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
 $('optReset').onclick=()=>{Object.assign(cfg,OPT_DEFAULTS);saveCfg();syncOptionsUI();Au.ui();};
 syncOptionsUI();
}
