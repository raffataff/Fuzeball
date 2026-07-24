'use strict';
/* ================= training mode (sandbox practice) =================
   Entered via the TRAINING card → startMatch('training') → trainingEnter(). While live,
   S.trn points at TRN and other modules read ONLY S.trn + r.trnHidden (ai gate, physics
   skip, powerup/deadball guards, main-loop freeze), so a missing training.js can never
   break the game. All defaults in CONFIG.training. Keys: T panel · P freeze · O step ·
   G click-place. Saved spots persist in cfg.trnSpots (normal 'fuzeball' localStorage). */
const TRNC=CONFIG.training;
const TRN={on:false,ai:[false,false],freeze:false,stepQ:0,placing:false,deadball:false,score:false,
 ballType:'classic',hidden:[],spots:null,lastSpot:null};
let trnBuilt=false,trnRing=null,trnAngT=null,trnNeedle=null;
const trnRay=new THREE.Raycaster();
function trnClampX(x){return clamp(x,-F.L/2+TRNC.clampMargin,F.L/2-TRNC.clampMargin);}
function trnClampZ(z){return clamp(z,-F.W/2+TRNC.clampMargin,F.W/2-TRNC.clampMargin);}
function trnBall(){return S.balls.length?S.balls[0]:null;}
function trnSpot(){return TRN.lastSpot||TRNC.spawn;}
function trnSpawnBall(key,x,z){
 const b=makeBall(BALL_TYPES[key]?key:'classic');
 b.m.position.set(trnClampX(x),BALL_R,trnClampZ(z));b.v.set(0,0,0);b.spin=0;b.stuckT=0;b.bbMin=b.bbMax=null;
 if(ARENA_ON)arenaClampSpawn(b.m.position);
 syncBall(b);
 $('ballTag').textContent=b.t.name;
 TRN.lastSpot={x:b.m.position.x,z:b.m.position.z};
 return b;
}
/* Teleport the first live ball (spawning one if none) to x,z at rest. The ONE place a
   training ball is hard-set — always syncBall'd so the interp/AI-history can't streak. */
function trnPlace(x,z){
 x=trnClampX(x);z=trnClampZ(z);
 let b=trnBall();
 if(!b){b=trnSpawnBall(TRN.ballType,x,z);}
 else{
  b.m.position.set(x,BALL_R,z);b.v.set(0,0,0);b.spin=0;b.stuckT=0;b.bbMin=b.bbMax=null;b.scored=false;
  if(ARENA_ON)arenaClampSpawn(b.m.position);
  syncBall(b);
 }
 TRN.lastSpot={x:b.m.position.x,z:b.m.position.z};
 if(trnBuilt){$('trnX').value=b.m.position.x.toFixed(1);$('trnZ').value=b.m.position.z.toFixed(1);}
 return b;
}
/* Launcher: fire the ball from where it sits with the panel's speed/angle/loft.
   0° = toward the RIGHT goal (+x), 90° = toward the near side (+z). */
function trnLaunch(){
 const sp=clamp(+$('trnSpeed').value||0,0,TRNC.speedMax),
       an=(+$('trnAngle').value||0)*Math.PI/180,
       lo=clamp(+$('trnLoft').value||0,0,TRNC.speedMax);
 const b=trnBall()||trnSpawnBall(TRN.ballType,trnSpot().x,trnSpot().z);
 b.v.set(Math.cos(an)*sp,lo,Math.sin(an)*sp);b.spin=0;b.stuckT=0;b.bbMin=b.bbMax=null;
 Au.ui();
}
function trnResetLaunch(){const s=trnSpot();trnPlace(s.x,s.z);trnLaunch();}
/* ---- saved spots (position + launcher settings, 4 slots, persisted) ---- */
function trnSaveSpot(i){
 const b=trnBall(),p=b?b.cur:trnSpot();
 TRN.spots[i]={x:p.x,z:p.z,sp:+$('trnSpeed').value||TRNC.launch.speed,an:+$('trnAngle').value||0,lo:+$('trnLoft').value||0};
 cfg.trnSpots=TRN.spots;saveCfg();trnRefreshSpots();Au.ui();
}
function trnLoadSpot(i){
 const s=TRN.spots[i];if(!s)return;
 $('trnSpeed').value=s.sp;$('trnAngle').value=s.an;$('trnLoft').value=s.lo;
 trnPlace(s.x,s.z);Au.ui();
}
function trnRefreshSpots(){
 for(let i=0;i<4;i++){const s=TRN.spots&&TRN.spots[i],b=$('trnSlot'+i);if(!b)continue;
  b.classList.toggle('on',!!s);
  b.title=s?('x '+s.x.toFixed(0)+' · z '+s.z.toFixed(0)+' · '+s.sp+'u/s @ '+s.an+'°'):'empty — save first';}
}
/* ---- click-to-place: raycast the mouse onto the y=BALL_R plane ---- */
function trnRayPoint(e){
 trnRay.setFromCamera({x:(e.clientX/innerWidth)*2-1,y:-(e.clientY/innerHeight)*2+1},camera);
 const o=trnRay.ray.origin,d=trnRay.ray.direction;
 if(Math.abs(d.y)<1e-6)return null;
 const t=(BALL_R-o.y)/d.y;if(t<=0)return null;
 return{x:trnClampX(o.x+d.x*t),z:trnClampZ(o.z+d.z*t)};
}
function trnEnsureRing(){
 if(trnRing)return;
 trnRing=new THREE.Mesh(new THREE.RingGeometry(BALL_R*.9,BALL_R*1.5,28),
  new THREE.MeshBasicMaterial({color:TRNC.ringColor,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));
 trnRing.rotation.x=-Math.PI/2;trnRing.position.y=.15;trnRing.visible=false;scene.add(trnRing);
}
function trnRingVis(v){if(trnRing)trnRing.visible=v;}
function trnSetPlacing(v){
 TRN.placing=v;
 if(trnBuilt){const bt=$('trnPick');bt.classList.toggle('on',v);bt.textContent=v?'📍 CLICK TABLE — ON':'📍 Click-place (G)';}
 cvs.style.cursor=v?'crosshair':'';
 trnRingVis(false);
}
/* Window-CAPTURE listeners so they beat input.js's canvas handlers (which would kick/
   slide the rod): while placing, a canvas click drops the ball instead. R-click cancels. */
addEventListener('mousedown',e=>{
 if(!TRN.on||!TRN.placing||e.target!==cvs)return;
 e.stopPropagation();e.preventDefault();
 if(e.button===0){const p=trnRayPoint(e);if(p){trnPlace(p.x,p.z);Au.ui();}}
 else trnSetPlacing(false);
},true);
addEventListener('mousemove',e=>{
 if(!TRN.on||!TRN.placing||e.target!==cvs)return;
 e.stopPropagation();
 const p=trnRayPoint(e);
 if(p){trnEnsureRing();trnRing.position.x=p.x;trnRing.position.z=p.z;trnRingVis(true);}
 else trnRingVis(false);
},true);
// scrolling the panel must not hit input.js's global wheel handler (it switches rods)
addEventListener('wheel',e=>{if(TRN.on&&e.target&&e.target.closest&&e.target.closest('#trnPanel'))e.stopPropagation();},{capture:true,passive:true});
addEventListener('keydown',e=>{
 if(!TRN.on||S.phase==='menu')return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(e.code==='KeyT'){$('trnPanel').classList.toggle('hidden');Au.ui();}
 if(e.code==='KeyP')trnToggleFreeze();
 if(e.code==='KeyO'){if(!TRN.freeze)trnToggleFreeze();TRN.stepQ++;}
 if(e.code==='KeyG')trnSetPlacing(!TRN.placing);
});
function trnToggleFreeze(){
 TRN.freeze=!TRN.freeze;TRN.stepQ=0;
 if(trnBuilt)$('trnFreeze').classList.toggle('on',TRN.freeze);
 Au.ui();
}
function trnSetRodShown(i,v){
 const r=rods[i];if(!r)return;
 r.trnHidden=!v;r.pivot.visible=v;TRN.hidden[i]=!v;
}
/* Rod show/hide checkboxes. Rebuilt on demand (NOT once with the panel) — the panel can be
   built before the rods exist, and a 0-row list would then stay empty for the whole session. */
function trnRodRows(){
 const box=$('trnRods');if(!box||box.childElementCount===rods.length)return;
 let h='';
 rods.forEach((r,i)=>{h+='<label class="trnRod"><input type="checkbox" id="trnRod'+i+'" checked><span class="'+(r.team===0?'lblR':'lblB')+'">'+(r.team===0?'T1':'T2')+'</span> '+r.role+'<i>'+(r.x>0?'+':'')+r.x+'</i></label>';});
 box.innerHTML=h;
 rods.forEach((r,i)=>{const c=$('trnRod'+i);if(c)c.onchange=e=>trnSetRodShown(i,e.target.checked);});
}
/* ---- panel (built once, gold-panel chrome like the debug AI panel) ---- */
function buildTrnPanel(){
 if(trnBuilt)return;trnBuilt=true;
 const p=document.createElement('div');p.id='trnPanel';p.className='hidden';
 let typeOpts='';for(const k in BALL_TYPES)typeOpts+='<option value="'+k+'">'+BALL_TYPES[k].name+'</option>';
 p.innerHTML=
  '<h3>🎯 TRAINING <button class="trnMin" id="trnMin" title="collapse (T hides the panel)">—</button></h3>'+
  '<div class="trnBody">'+
  '<div class="trnSect">Sim</div>'+
  '<div class="trnBtns"><button class="trnBtn" id="trnFreeze">⏸ Freeze (P)</button><button class="trnBtn" id="trnStep">⏭ Step (O)</button></div>'+
  '<div class="trnBtns"><button class="trnBtn wide" id="trnRedrop">☂ Re-drop ball</button></div>'+
  '<div class="trnSect">Ball</div>'+
  '<div class="trnRow"><label>Type</label><select id="trnType">'+typeOpts+'</select></div>'+
  '<div class="trnBtns"><button class="trnBtn" id="trnSpawn">+ New ball</button><button class="trnBtn" id="trnClear">✕ Clear</button></div>'+
  '<div class="trnRow"><label>X</label><input type="number" id="trnX" step="1" value="0"><label>Z</label><input type="number" id="trnZ" step="1" value="0"><button class="trnBtn" id="trnSet">Set</button></div>'+
  '<div class="trnBtns"><button class="trnBtn wide" id="trnPick">📍 Click-place (G)</button></div>'+
  '<div class="trnSect">Launcher</div>'+
  '<div class="trnRow"><label>Speed</label><input type="number" id="trnSpeed" step="5" value="'+TRNC.launch.speed+'"><label>Loft</label><input type="number" id="trnLoft" step="5" value="'+TRNC.launch.loft+'"></div>'+
  '<div class="trnRow"><label>Angle°</label><input type="number" id="trnAngle" step="5" value="'+TRNC.launch.angle+'"><span class="trnHint">0° → right goal · 90° → near side</span></div>'+
  '<div class="trnBtns"><button class="trnBtn" id="trnLaunch">🚀 Launch</button><button class="trnBtn" id="trnRelaunch">↻ Reset + launch</button></div>'+
  '<div class="trnSect">Spots</div>'+
  '<div class="trnRow"><label>Save</label><span class="trnSlots" id="trnSave"></span></div>'+
  '<div class="trnRow"><label>Load</label><span class="trnSlots" id="trnLoad"></span></div>'+
  '<div class="trnSect">AI</div>'+
  '<div class="trnRow"><label><span class="lblR">Team 1</span> AI</label><input type="checkbox" id="trnAiR"></div>'+
  '<div class="trnRow"><label><span class="lblB">Team 2</span> AI</label><input type="checkbox" id="trnAiB"></div>'+
  '<div class="trnSect">Rods · show / hide</div>'+
  '<div class="trnRods" id="trnRods"></div>'+
  '<div class="trnSect">Rules</div>'+
  '<div class="trnRow"><label>Count goals</label><input type="checkbox" id="trnScore"></div>'+
  '<div class="trnRow"><label>Auto dead-ball re-drop</label><input type="checkbox" id="trnDead"></div>'+
  '<div class="trnInfo" id="trnInfo"></div>'+
  // held-rod angle, under the ball metrics: text + a dial that hangs down at 0 and swings
  // toward +x (screen-right) with the rod, so it reads like the table does.
  '<div class="trnAng"><div class="trnAngT" id="trnAngT"></div>'+
   '<svg viewBox="-32 -30 64 62" width="58" height="54">'+
    '<path d="M -24 0 A 24 24 0 0 0 24 0" fill="none" stroke="rgba(255,207,77,.16)"/>'+
    '<line x1="-29" y1="0" x2="29" y2="0" stroke="rgba(255,207,77,.14)"/>'+
    '<line x1="0" y1="0" x2="0" y2="27" stroke="rgba(255,207,77,.3)" stroke-dasharray="2 3"/>'+
    '<line id="trnNeedle" x1="0" y1="0" x2="0" y2="26" stroke="#ffcf4d" stroke-width="2.6" stroke-linecap="round"/>'+
    '<circle cx="0" cy="0" r="2.6" fill="#ffcf4d"/>'+
   '</svg></div>'+
  '</div>';
 document.body.appendChild(p);
 trnAngT=$('trnAngT');trnNeedle=$('trnNeedle');
 // blur any clicked button so SPACE (kick) can't re-fire it
 p.addEventListener('click',e=>{const b=e.target.closest('button');if(b)b.blur();});
 $('trnMin').onclick=()=>p.classList.toggle('trnCollapsed');
 $('trnFreeze').onclick=()=>trnToggleFreeze();
 $('trnStep').onclick=()=>{if(!TRN.freeze)trnToggleFreeze();TRN.stepQ++;};
 $('trnRedrop').onclick=()=>{if(S.balls.length)for(const b of S.balls.slice())redropBall(b);else trnSpawnBall(TRN.ballType,trnSpot().x,trnSpot().z);Au.ui();};
 $('trnType').onchange=e=>{TRN.ballType=e.target.value;};
 $('trnSpawn').onclick=()=>{trnSpawnBall(TRN.ballType,trnSpot().x,trnSpot().z);Au.ui();};
 $('trnClear').onclick=()=>{clearBalls();$('ballTag').textContent='—';Au.ui();};
 $('trnSet').onclick=()=>trnPlace(+$('trnX').value||0,+$('trnZ').value||0);
 $('trnPick').onclick=()=>trnSetPlacing(!TRN.placing);
 $('trnLaunch').onclick=()=>trnLaunch();
 $('trnRelaunch').onclick=()=>trnResetLaunch();
 const sv=$('trnSave'),ld=$('trnLoad');
 for(let i=0;i<4;i++){
  const sb=document.createElement('button');sb.className='trnBtn slot';sb.textContent=String(i+1);sb.onclick=()=>trnSaveSpot(i);sv.appendChild(sb);
  const lb=document.createElement('button');lb.className='trnBtn slot';lb.id='trnSlot'+i;lb.textContent=String(i+1);lb.onclick=()=>trnLoadSpot(i);ld.appendChild(lb);
 }
 $('trnAiR').onchange=e=>{TRN.ai[0]=e.target.checked;};
 $('trnAiB').onchange=e=>{TRN.ai[1]=e.target.checked;};
 trnRodRows();
 $('trnScore').onchange=e=>{TRN.score=e.target.checked;};
 $('trnDead').onchange=e=>{TRN.deadball=e.target.checked;};
}
/* Called by startMatch('training') AFTER the normal reset — skips the countdown, drops a
   ball at the spawn point and takes over the phase. Re-entrant (pause→Restart reuses it),
   keeping the last panel setup (AI toggles, hidden rods, launcher fields). */
function trainingEnter(){
 TRN.on=true;S.trn=TRN;
 TRN.freeze=false;TRN.stepQ=0;TRN.placing=false;
 if(!TRN.spots)TRN.spots=(Array.isArray(cfg.trnSpots)&&cfg.trnSpots.length===4)?cfg.trnSpots:[null,null,null,null];
 buildTrnPanel();trnRodRows();
 rods.forEach((r,i)=>{r.trnHidden=!!TRN.hidden[i];r.pivot.visible=!r.trnHidden;const c=$('trnRod'+i);if(c)c.checked=!r.trnHidden;});
 $('trnAiR').checked=TRN.ai[0];$('trnAiB').checked=TRN.ai[1];
 $('trnScore').checked=TRN.score;$('trnDead').checked=TRN.deadball;
 $('trnType').value=TRN.ballType;
 $('trnFreeze').classList.remove('on');
 trnSetPlacing(false);trnRefreshSpots();
 $('trnPanel').classList.remove('hidden');
 $('count').style.display='none';
 $('hint').innerHTML='T — panel · P — freeze · O — step · G — click-place<br>SPACE / click — kick · SHIFT / R-click — raise · V — camera · C — debug';
 S.phase='play';S.lastTouch=-1;
 trnSpawnBall(TRN.ballType,TRNC.spawn.x,TRNC.spawn.z);
 banner('TRAINING','PLACE · LAUNCH · TUNE — NO SCORING',1.8);
}
/* Goal in training (routed from onGoal): fx + optional score tick, then the ball resets
   to the last placed spot so a shot is instantly repeatable. Never ends the match. */
function trainingGoal(team,b){
 b.scored=true;
 if(TRN.score){S.score[team]+=(b.t.value||1);updateScoreUI(team);}
 goalFx(team,b);
 removeBall(b);
 banner(teamName(team)+' GOAL','BALL RESET',1.1);
 if(!S.balls.length){const s=trnSpot();trnSpawnBall(TRN.ballType,s.x,s.z);}
}
/* The last live ball left play without a goal (cannonball detonation etc) — respawn at the
   last placed spot so the sandbox never drops into the match goal-hold/serve flow. */
function trainingBallGone(){const s=trnSpot();trnSpawnBall(TRN.ballType,s.x,s.z);}
/* Torn down from gotoMenu — restores every hidden rod and clears the cross-module gate. */
function trainingExit(){
 trnSetPlacing(false);
 TRN.on=false;S.trn=null;TRN.freeze=false;TRN.stepQ=0;
 rods.forEach(r=>{r.trnHidden=false;r.pivot.visible=true;});
 trnRingVis(false);
 const p=$('trnPanel');if(p)p.classList.add('hidden');
}
/* Per-frame readout (main loop, only while S.trn is live). */
function trainingTick(){
 if(!trnBuilt)return;
 const b=trnBall(),el=$('trnInfo');
 el.textContent=b?('ball  x '+b.cur.x.toFixed(1)+' · z '+b.cur.z.toFixed(1)+' · '+b.v.length().toFixed(0)+' u/s'+(TRN.freeze?'  ⏸ FROZEN':'')):'no ball';
 trnAngTick();
}
/* Held-rod angle, under the ball metrics. ANG is the world rotation (what you see on the
   table); SWING is the same angle rod-local (÷kickDir) so both teams read alike and it lines
   up with CONFIG.kick's windupA / raiseA / trap.angle. Both are the SIM angle, not the
   interpolated pivot — the value the swing curve and the contact impulse actually use, so an
   ω spike here (≈80 against a swing's 21.8) is a step where the angle JUMPED, not swept.
   Shows the rod the human holds; when every rod is on AI it traces the kick-logged rod (L). */
function trnAngTick(){
 if(!trnAngT)return;
 const r=(typeof userRod==='function'?userRod():null)||(typeof dbgLogRod!=='undefined'?dbgLogRod:null);
 if(!r){trnAngT.innerHTML='<span>rod</span>none held';trnNeedle.setAttribute('transform','rotate(0)');return;}
 const D=180/Math.PI,a=r.angle,
       st=r.kickT>=0?'KICK '+r.kickT.toFixed(3):r.act?r.act.toUpperCase():r.raise?'RAISE':'REST';
 trnAngT.innerHTML='<span>rod</span><b>'+(r.team===0?'T1 ':'T2 ')+r.role+'</b><b class="st">'+st+'</b><br>'+
  '<span>ang</span><b>'+(a*D).toFixed(1)+'°</b><span>swing</span><b>'+(a/r.kickDir*D).toFixed(1)+'°</b><br>'+
  '<span>ω</span><b>'+(r.angVel||0).toFixed(1)+'</b> rad/s';
 trnNeedle.setAttribute('transform','rotate('+(-a*D).toFixed(2)+')');
}
(function(){const b=$('btnTraining');if(b)b.onclick=()=>startMatch('training');})();
