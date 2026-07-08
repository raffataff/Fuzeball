'use strict';
/* ================= input ================= */
const keys={};
function setCtrl(i){
 if(S.userTeam<0||!S.ctrlRods.length)return;
 S.ctrl=(i+S.ctrlRods.length)%S.ctrlRods.length;
 S.lastSwitch=S.time;
 updateChips();Au.ui();
}
addEventListener('keydown',e=>{
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
 if(e.repeat)return;keys[e.code]=true;
 if(e.code==='Escape'){
  if(!$('lgForfeit').classList.contains('hidden')){$('lgForfeit').classList.add('hidden');return;}
  if(!$('league').classList.contains('hidden')&&S.phase==='menu'){$('league').classList.add('hidden');$('menu').classList.remove('hidden');Au.ui();return;}
  togglePause();return;
 }
  if(e.code==='KeyV'&&S.phase!=='menu'){S.camMode=(S.camMode+1)%CAM.modes.length;Au.ui();}
 if(e.code==='KeyC'&&S.phase!=='menu'){toggleDebug();return;}
 if(e.code==='KeyF'&&S.phase!=='menu'){toggleFreeRoam();return;}
 if(S.freeRoam)return;
 if(S.phase!=='play'&&S.phase!=='count')return;
 if(S.userTeam<0)return;
 if(e.code==='Space')kickRod(S.ctrlRods[S.ctrl]);
 if(e.code==='ShiftLeft'||e.code==='ShiftRight')S.ctrlRods[S.ctrl].raise=true;
 if(e.code==='ArrowLeft'||e.code==='KeyQ')setCtrl(S.ctrl-1);
 if(e.code==='ArrowRight'||e.code==='KeyE')setCtrl(S.ctrl+1);
 if(/^Digit[1-4]$/.test(e.code))setCtrl(+e.code[5]-1);
});
addEventListener('keyup',e=>{keys[e.code]=false;
 if(S.freeRoam)return;
 if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&S.userTeam>=0&&S.ctrlRods.length)S.ctrlRods[S.ctrl].raise=false;});
const cvs=$('game');
cvs.addEventListener('mousemove',e=>{
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count')||S.userTeam<0)return;
 const r=S.ctrlRods[S.ctrl];
 r.target=((e.clientY/innerHeight)-.5)*2*r.maxOff*CTRL.mouseSens;
});
cvs.addEventListener('mousedown',e=>{
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count')||S.userTeam<0)return;
 if(e.button===0)kickRod(S.ctrlRods[S.ctrl]);
 if(e.button===2)S.ctrlRods[S.ctrl].raise=true;
});
addEventListener('mouseup',e=>{if(!S.freeRoam&&e.button===2&&S.userTeam>=0&&S.ctrlRods.length)S.ctrlRods[S.ctrl].raise=false;});
cvs.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{if(!S.freeRoam&&S.phase==='play'&&S.userTeam>=0)setCtrl(S.ctrl+(e.deltaY>0?1:-1));});
function userControlUpdate(dt){
 if(S.freeRoam||S.userTeam<0||!S.ctrlRods.length)return;
 const r=S.ctrlRods[S.ctrl];
 let dz=0;
 if(keys.ArrowUp||keys.KeyW)dz-=1;
 if(keys.ArrowDown||keys.KeyS)dz+=1;
 if(dz)r.target=clamp(r.target+dz*CTRL.slideSpeed*dt,-r.maxOff,r.maxOff);
 if(cfg.auto&&S.phase==='play'&&S.time-S.lastSwitch>CTRL.autoDelay&&S.balls.length){
  const bp=S.balls[0].m.position;
  let bi=S.ctrl,bd=1e9;
  S.ctrlRods.forEach((rr,i)=>{const d=Math.abs(bp.x-rr.x);if(d<bd){bd=d;bi=i;}});
  if(bi!==S.ctrl){S.ctrl=bi;updateChips();}
 }
}
function toggleFreeRoam(){
 S.freeRoam=!S.freeRoam;
 if(S.freeRoam){
  const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  S.camYaw=e.y;S.camPitch=e.x;
  banner('FREE ROAM','WASD move · Q/E up/down · Shift sprint · Esc exit',1.8);
 }else{
  document.exitPointerLock();
  banner('FREE ROAM','OFF',0.9);
 }
 Au.ui();
}
cvs.addEventListener('click',()=>{if(S.freeRoam&&S.phase!=='menu')cvs.requestPointerLock();});
document.addEventListener('pointerlockchange',()=>{
 if(!document.pointerLockElement&&S.freeRoam)S.freeRoam=false;
});
document.addEventListener('mousemove',e=>{
 if(!S.freeRoam||!document.pointerLockElement)return;
 S.camYaw-=e.movementX*CAM.freeRoamSens*.001;
 S.camPitch-=e.movementY*CAM.freeRoamSens*.001;
 S.camPitch=clamp(S.camPitch,-Math.PI/2+.01,Math.PI/2-.01);
});
