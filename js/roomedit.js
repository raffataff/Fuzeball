'use strict';
/* ===== room editor (dev tool, F2) =========================================
   Gated on CONFIG.debug.roomEditor. Off by default and self-contained: the cross-
   module gate is S.redit (null when off), tested by input.js and nothing else, so a
   missing roomedit.js cannot break the game. Same discipline as S.photo / S.trn.

   WHAT IT EDITS. One room's PROP SPECS (CONFIG.rooms[id].props), its AUTHORED LIGHTS
   (CONFIG.rooms[id].lights) and its room-level look — in memory, live. There is
   deliberately no hidden save: edits do not persist to localStorage and are NOT
   reloaded behind your back, because a shadow layer that silently overrides config.js
   is the thing that makes a level editor untrustworthy. EXPORT emits the WHOLE room
   block in config.js's own shape and key order, so authoring is: edit, copy, replace
   the block. (A crash-backup is written each change and is only ever restored by
   clicking Restore — never automatically.)

   WHY IT EDITS SPECS AND REBUILDS, rather than nudging matrices or light objects in
   place: the authored thing IS the spec list. Editing the scene would leave the spec
   and the scene disagreeing the moment a scatter is involved, and then the export
   would be a lie. Rebuilding is a handful of milliseconds at these counts.

   SELECTION RULE, which falls out of the same reasoning: clicking an instance that
   came from an explicit `at` entry selects THAT placement and you move it. Clicking
   one that came from a `scatter` selects the SPEC — individual scatter instances are
   generated, so there is nothing meaningful to drag; you edit the generator instead.

   TWO KINDS OF LIGHT, and the difference is the whole of the lighting UI.
     BAKED    KHR_lights_punctual inside the room GLB. Its position lives in the model,
              so the editor cannot move it and pretend that survives a reload. What it
              CAN do is switch one off (rooms.<id>.lightsOff) or DETACH it — copy it
              into an authored light at the same place, which then moves freely.
     AUTHORED rooms.<id>.lights. Plain three.js units, no candela transfer (see the
              note in CONFIG.rooms), drawn from CONFIG.render.roomLightPool so adding
              or moving one never changes the scene's light count and therefore never
              recompiles every material in the game. That pool is the only reason a
              light gizmo is usable here at all.

   THE CAMERA is free roam (fx.js), which reads S.camYaw/S.camPitch. input.js only
   requests pointer lock during a MATCH, and this tool deliberately runs with none —
   so mouse-look is wired here as a right-button DRAG instead. That also leaves the
   left button free for click-to-select and drag-to-move, which is the convention
   every other 3D editor uses and the reason it is worth the twelve lines.
   ========================================================================= */
const RE={on:false,room:null,sel:null,panel:null,css:false,ray:null,prev:null,box:null,
 tab:'props',snap:0,mk:null,mkGrp:null,pick:[],drag:null,look:null,showMk:true,geo:null};

const RE_TABS=[['props','props'],['lights','lights'],['world','world'],['out','export']];
/* Marker size is driven by DISTANCE TO CAMERA, not a fixed world size: a room's fixtures
   hang 100-400 units up while its props sit on the floor, so one constant is either a
   speck on the ceiling or a boulder on the rug. Clamped so it stays grabbable either way. */
const RE_MK={scale:0.022,min:2.4,max:16,
 /* Below this |camera-forward.y| the ground plane is too edge-on to drag on — see the note
    in reditDragStart. 0.25 is about 14 degrees above horizontal. */
 grazeDot:0.25};

function reditEnabled(){return !!(typeof CONFIG!=='undefined'&&CONFIG.debug&&CONFIG.debug.roomEditor);}
function reditRoomId(){return (typeof cfg!=='undefined'&&CONFIG.rooms[cfg.room])?cfg.room:'open';}
function reditRoom(){return CONFIG.rooms[reditRoomId()];}
/* The live lists. Created on the room object the first time it is edited, so a room that
   declares neither props nor lights is still editable. */
function reditSpecs(){const rm=reditRoom();if(!rm.props)rm.props=[];return rm.props;}
function reditLights(){const rm=reditRoom();if(!rm.lights)rm.lights=[];return rm.lights;}
function reditOff(){const rm=reditRoom();if(!rm.lightsOff)rm.lightsOff=[];return rm.lightsOff;}

/* F2 / the home card. The editor deliberately runs with NO match: it opens the picker
   screen rather than the editor itself, so you choose a room instead of editing
   whichever one the last match happened to use. Refused during play — the sim moving
   under you while you place furniture is exactly what this is meant to avoid. */
function reditToggle(){
 if(!reditEnabled()){if(typeof toast==='function')toast('ROOM EDITOR','set CONFIG.debug.roomEditor = true',2.2);return;}
 if(RE.on){reditExit();return;}
 if(typeof scrCur!=='undefined'&&scrCur==='roomEdit'&&!RE.on){return;}   // already on the picker
 if(S.phase!=='menu'){
  if(typeof toast==='function')toast('ROOM EDITOR','quit to the menu first — the editor runs with no match',2.4);
  return;}
 openRoomEdit();
}
function reditEnter(){
 RE.on=true;S.redit=RE;RE.room=reditRoomId();RE.sel=null;RE.drag=null;RE.look=null;
 if(!S.freeRoam&&typeof toggleFreeRoam==='function')toggleFreeRoam();   // reuse the existing rig
 reditCSS();buildREPanel();RE.panel.style.display='flex';
 reditMarkers();reditSync();
 if(typeof toast==='function')toast('ROOM EDITOR','LMB select/drag · RMB look · WASD+QE fly · F2 exits',2.6);
 if(typeof Au!=='undefined')Au.ui();
}
/* Leaving the editor returns to the PICKER, not to the game — the venue stays applied so
   the scene behind the picker is still the room you were working on. The player's own
   room/table are put back by SCREENS.roomEdit.onHide, i.e. only when you leave the editor
   area entirely. Same stash-and-restore rule league.js uses for a division's venue, and
   for the same reason: without it, editing a room silently becomes the player's Kick Off
   setting the next time anything calls saveCfg. */
function reditExit(){
 if(!RE.on)return;
 RE.on=false;S.redit=null;RE.sel=null;RE.drag=null;RE.look=null;
 if(RE.panel)RE.panel.style.display='none';
 if(S.freeRoam&&typeof toggleFreeRoam==='function')toggleFreeRoam();
 reditClearMarkers();reditHilite(null);
 if(typeof showScreen==='function')showScreen('roomEdit');
 if(typeof Au!=='undefined')Au.ui();
}

/* --- apply -----------------------------------------------------------------
   Everything that mutates a spec funnels through one of these, so the scene can never
   drift from the data. Props need a rebuild (instanced meshes); lights are a re-drive
   of the resident pool, which is cheap enough to run on every slider tick. */
function reditApply(){
 const id=reditRoomId();
 if(typeof buildRoomProps==='function')buildRoomProps(id,CONFIG.rooms[id],()=>{
  if(typeof propGroups!=='undefined'&&propGroups[id])propGroups[id].visible=true;
  reditMarkers();reditHilite(RE.sel);
 });
 reditBackup();
}
function reditApplyLights(){
 if(typeof applyAuthoredLights==='function')applyAuthoredLights(reditRoom());
 reditMarkers();reditHilite(RE.sel);reditLightReadout();reditBackup();
}

/* --- panel ---------------------------------------------------------------
   Built with createElement + one injected <style>, like buildAIPanel — so the tool
   needs no markup in index.html and no rule in styles.css to maintain. */
function reditCSS(){
 if(RE.css)return;RE.css=true;
 const s=document.createElement('style');
 s.textContent=[
 '#reditPanel{position:fixed;top:12px;left:12px;width:342px;max-height:calc(100vh - 24px);display:none;',
 ' flex-direction:column;background:rgba(10,12,18,.94);border:1px solid #4d7fff55;border-radius:8px;',
 ' padding:9px 10px;z-index:60;font:11px/1.45 Rajdhani,system-ui,sans-serif;color:#cfe0ff;letter-spacing:.02em}',
 '#reditPanel h4{margin:9px 0 5px;font:12px/1 "Russo One",sans-serif;color:#7fb0ff;letter-spacing:.09em;',
 ' text-transform:uppercase;border-top:1px solid #4d7fff33;padding-top:8px}',
 '#reditPanel h4:first-child{border-top:0;margin-top:0;padding-top:0}',
 '#reditPanel .reRow{display:flex;align-items:center;gap:5px;margin:3px 0}',
 '#reditPanel .reRow label{flex:0 0 58px;color:#8fa4c8}',
 '#reditPanel input[type=number],#reditPanel select,#reditPanel input[type=text]{flex:1;min-width:0;',
 ' background:#0c1220;border:1px solid #35507f;color:#dce9ff;border-radius:4px;padding:2px 5px;font:11px Rajdhani,sans-serif}',
 '#reditPanel input[type=range]{flex:1;min-width:0}',
 '#reditPanel input[type=color]{flex:0 0 30px;height:19px;padding:0;background:#0c1220;',
 ' border:1px solid #35507f;border-radius:4px;cursor:pointer}',
 '#reditPanel button{background:#16233c;border:1px solid #3d67b5;color:#cfe0ff;border-radius:4px;',
 ' padding:3px 7px;cursor:pointer;font:11px Rajdhani,sans-serif}',
 '#reditPanel button:hover{background:#20335a}',
 '#reditPanel button.reDanger{border-color:#b5433d;color:#ffd0cc}',
 '#reditPanel button.reOn{background:#24406e;border-color:#7fb0ff;color:#fff}',
 '#reditPanel .reList{max-height:158px;overflow-y:auto;border:1px solid #4d7fff33;border-radius:4px;margin:3px 0}',
 '#reditPanel .reItem{padding:3px 6px;cursor:pointer;display:flex;justify-content:space-between;',
 ' align-items:center;gap:6px}',
 '#reditPanel .reItem:hover{background:#1a2a44}',
 '#reditPanel .reItem.sel{background:#24406e;color:#fff}',
 '#reditPanel .reItem.off{opacity:.45}',
 '#reditPanel .reMuted{color:#7d90b0}',
 '#reditPanel .reHead{display:flex;justify-content:space-between;align-items:center;gap:6px}',
 '#reditPanel .reVal{color:#9fc4ff;min-width:44px;text-align:right}',
 '#reditPanel .reTabs{display:flex;gap:3px;margin:7px 0 2px}',
 '#reditPanel .reTabs button{flex:1;padding:3px 0;font-size:10px;letter-spacing:.08em;text-transform:uppercase}',
 '#reditPanel .reBody{overflow-y:auto;flex:1 1 auto;min-height:0}',
 '#reditPanel .reSwatch{width:11px;height:11px;border-radius:2px;border:1px solid #ffffff33;flex:0 0 auto}',
 '#reditPanel .reTag{font-size:9px;letter-spacing:.09em;color:#7d90b0;text-transform:uppercase}',
 '#reditPanel textarea{width:100%;height:130px;background:#0c1220;border:1px solid #35507f;color:#a8c8ff;',
 ' border-radius:4px;font:10px/1.35 ui-monospace,Consolas,monospace;padding:5px;resize:vertical}'].join('');
 document.head.appendChild(s);
}
function reEl(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;}
function reNum(lab,val,step,cb){
 const r=reEl('div','reRow');r.appendChild(reEl('label',null,lab));
 const i=document.createElement('input');i.type='number';i.value=val;i.step=step===undefined?1:step;
 i.addEventListener('input',()=>cb(parseFloat(i.value)||0));
 r.appendChild(i);return r;
}
function reSlider(lab,val,min,max,step,cb){
 const r=reEl('div','reRow');r.appendChild(reEl('label',null,lab));
 const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=val;
 const v=reEl('span','reVal',(+val).toFixed(2));
 i.addEventListener('input',()=>{const n=parseFloat(i.value);v.textContent=n.toFixed(2);cb(n);});
 r.appendChild(i);r.appendChild(v);return r;
}
function reHex(n){return '0x'+('000000'+((n|0)>>>0).toString(16)).slice(-6);}
function reCssHex(n){return '#'+('000000'+((n|0)>>>0).toString(16)).slice(-6);}
function reColor(lab,val,cb){
 const r=reEl('div','reRow');r.appendChild(reEl('label',null,lab));
 const i=document.createElement('input');i.type='color';i.value=reCssHex(val);
 const t=reEl('span','reVal',reHex(val));
 i.addEventListener('input',()=>{const n=parseInt(i.value.slice(1),16);t.textContent=reHex(n);cb(n);});
 r.appendChild(i);r.appendChild(t);return r;
}
function reBtnRow(){return reEl('div','reRow');}
function buildREPanel(){
 if(RE.panel)return;
 const p=RE.panel=reEl('div');p.id='reditPanel';
 const head=reEl('div','reHead');
 head.appendChild(reEl('b',null,'ROOM EDITOR'));
 const x=reEl('button',null,'◀ rooms');x.title='Back to the room list (Esc)';x.onclick=reditExit;head.appendChild(x);
 p.appendChild(head);
 const sub=reEl('div','reMuted');sub.id='reRoomLab';p.appendChild(sub);
 const tabs=reEl('div','reTabs');tabs.id='reTabs';p.appendChild(tabs);
 RE_TABS.forEach(t=>{const b=reEl('button',null,t[1]);b.dataset.tab=t[0];
  b.onclick=()=>{RE.tab=t[0];reditSync();};tabs.appendChild(b);});
 const body=reEl('div','reBody');body.id='reBody';p.appendChild(body);
 const sel=reEl('div');sel.id='reSel';p.appendChild(sel);
 document.body.appendChild(p);
}

/* --- panel contents (rebuilt on every change; it is a dev tool, not a hot path) -- */
function reditSync(){
 if(!RE.panel)return;
 const lab=document.getElementById('reRoomLab');
 if(lab)lab.textContent='room: '+reditRoomId()+'   ·   snap '+(RE.snap?RE.snap:'off');
 const tabs=document.getElementById('reTabs');
 if(tabs)Array.prototype.forEach.call(tabs.children,b=>b.className=(b.dataset.tab===RE.tab)?'reOn':'');
 const b=document.getElementById('reBody');b.innerHTML='';
 if(RE.tab==='props')reditTabProps(b);
 else if(RE.tab==='lights')reditTabLights(b);
 else if(RE.tab==='world')reditTabWorld(b);
 else reditTabOut(b);
 reditSyncSel();
}

/* --- PROPS tab ------------------------------------------------------------ */
function reditTabProps(w){
 const specs=reditSpecs();
 w.appendChild(reEl('h4',null,'library'));
 const ids=(typeof propIds==='function')?propIds():[];
 if(!ids.length){
  w.appendChild(reEl('div','reMuted','no props. Drop .glb files in assets/props/ then run:'));
  const c=reEl('div','reMuted','node tools/build_props_manifest.js');c.style.color='#9fc4ff';w.appendChild(c);
 }else{
  const list=reEl('div','reList');
  ids.forEach(id=>{const it=reEl('div','reItem');
   it.appendChild(reEl('span',null,id));
   const bt=reEl('button',null,'+');bt.title='Place one where the camera is looking';
   bt.onclick=e=>{e.stopPropagation();reditAdd(id);};
   it.appendChild(bt);list.appendChild(it);});
  w.appendChild(list);
 }
 w.appendChild(reEl('h4',null,'placed  ('+specs.length+')'));
 const pList=reEl('div','reList');
 specs.forEach((sp,i)=>{
  const it=reEl('div','reItem'+(RE.sel&&RE.sel.kind==='prop'&&RE.sel.spec===i?' sel':''));
  const n=(sp.at?sp.at.length:0)+(sp.scatter?(sp.scatter.n|0)||0:0);
  it.appendChild(reEl('span',null,sp.prop+(sp.scatter?' ['+sp.scatter.kind+']':'')+'  x'+n));
  const d=reEl('button','reDanger','del');
  d.onclick=e=>{e.stopPropagation();specs.splice(i,1);RE.sel=null;reditApply();reditSync();};
  it.appendChild(d);
  it.onclick=()=>{RE.sel={kind:'prop',spec:i,idx:null};reditSync();reditHilite(RE.sel);};
  pList.appendChild(it);
 });
 if(!specs.length)pList.appendChild(reEl('div','reItem reMuted','nothing placed yet'));
 w.appendChild(pList);
}

/* --- LIGHTS tab -----------------------------------------------------------
   Authored lights first (they are the ones you can move), then the room GLB's baked
   fixtures with a switch and a DETACH. Detaching is exact rather than approximate: the
   candela transfer has already run by the time we read the light, so its live intensity
   IS the delivered screen value, and an authored copy carrying that number looks
   identical the frame it appears. That is what makes the swap safe to offer. */
function reditTabLights(w){
 const list=reditLights();
 w.appendChild(reEl('h4',null,'add'));
 const add=reBtnRow();
 [['point','+ point'],['spot','+ spot'],['dir','+ dir']].forEach(t=>{
  const b=reEl('button',null,t[1]);b.title='Place a '+t[0]+' light above where the camera is looking';
  b.onclick=()=>reditAddLight(t[0]);add.appendChild(b);});
 w.appendChild(add);
 const mk=reBtnRow();
 const mb=reEl('button',RE.showMk?'reOn':null,'markers');
 mb.onclick=()=>{RE.showMk=!RE.showMk;reditMarkers();reditSync();};
 mk.appendChild(mb);
 const sn=reEl('button',RE.snap?'reOn':null,'snap '+(RE.snap||'off'));
 sn.title='Grid snap for dragging and nudging';
 sn.onclick=()=>{RE.snap=RE.snap===0?1:RE.snap===1?5:RE.snap===5?10:0;reditSync();};
 mk.appendChild(sn);
 w.appendChild(mk);
 w.appendChild(reEl('h4',null,'authored  ('+list.length+')'));
 const aL=reEl('div','reList');
 list.forEach((L,i)=>{
  const it=reEl('div','reItem'+(RE.sel&&RE.sel.kind==='light'&&RE.sel.i===i?' sel':''));
  const left=reEl('span');left.style.cssText='display:flex;align-items:center;gap:6px';
  const sw=reEl('span','reSwatch');sw.style.background=reCssHex(L.color===undefined?0xffffff:L.color);
  left.appendChild(sw);
  left.appendChild(reEl('span',null,(L.type||'point')+'  '+(L.int===undefined?1:L.int)));
  it.appendChild(left);
  const d=reEl('button','reDanger','del');
  d.onclick=e=>{e.stopPropagation();list.splice(i,1);RE.sel=null;reditApplyLights();reditSync();};
  it.appendChild(d);
  it.onclick=()=>{RE.sel={kind:'light',i:i,part:'pos'};reditSync();reditHilite(RE.sel);};
  aL.appendChild(it);
 });
 if(!list.length)aL.appendChild(reEl('div','reItem reMuted','none — the room is lit by hemi/dir + the glb'));
 w.appendChild(aL);
 const baked=reditBaked();
 w.appendChild(reEl('h4',null,'baked in the glb  ('+baked.length+')'));
 if(!baked.length){w.appendChild(reEl('div','reMuted','this room model carries no punctual lights'));return;}
 const off=reditOff(),bL=reEl('div','reList');
 baked.forEach(l=>{
  const nm=l.name||'',isOff=!!l.userData.roomOff;
  const it=reEl('div','reItem'+(isOff?' off':'')+(RE.sel&&RE.sel.kind==='baked'&&RE.sel.name===nm?' sel':''));
  const left=reEl('span');left.style.cssText='display:flex;align-items:center;gap:6px';
  const sw=reEl('span','reSwatch');sw.style.background='#'+l.color.getHexString();
  left.appendChild(sw);
  left.appendChild(reEl('span',null,(nm||l.type)+'  '+(isOff?'off':l.intensity.toFixed(2))));
  it.appendChild(left);
  const bs=reEl('span');bs.style.cssText='display:flex;gap:4px';
  const t=reEl('button',null,isOff?'on':'off');
  t.title='Switch this fixture off (exports as lightsOff)';
  t.onclick=e=>{e.stopPropagation();reditBakedToggle(l);};
  bs.appendChild(t);
  const dt=reEl('button',null,'detach');
  dt.title='Copy into an authored light at the same place, and switch this one off';
  dt.onclick=e=>{e.stopPropagation();reditDetach(l);};
  bs.appendChild(dt);it.appendChild(bs);
  it.onclick=()=>{RE.sel={kind:'baked',name:nm};reditSync();reditHilite(RE.sel);};
  bL.appendChild(it);
 });
 w.appendChild(bL);
 if(off.length)w.appendChild(reEl('div','reMuted','lightsOff: '+off.join(', ')));
}
/* Every punctual light inside the live room GLB, in traverse order. */
function reditBaked(){
 const g=(typeof roomGroups!=='undefined')?roomGroups[reditRoomId()]:null;
 const out=[];if(g)g.traverse(c=>{if(c.isLight)out.push(c);});
 return out;
}
/* Switch a baked fixture off by NAME, which is what lightsOff exports. intensity 0 rather
   than visible=false on purpose: hiding a light changes the scene's light count and
   recompiles every material, and flicking a lamp on and off should not cost that. */
function reditBakedToggle(l){
 const nm=l.name||'',off=reditOff();
 if(!nm){if(typeof toast==='function')toast('ROOM EDITOR','that fixture has no name in the glb — nothing to export',2.4);return;}
 const i=off.indexOf(nm);
 if(i>=0){off.splice(i,1);l.userData.roomOff=false;
  if(l.userData.roomOffInt!==undefined)l.intensity=l.userData.roomOffInt;}
 else{off.push(nm);l.userData.roomOff=true;l.userData.roomOffInt=l.intensity;l.intensity=0;}
 reditBackup();reditMarkers();reditSync();
}
function reditDetach(l){
 const nm=l.name||'';
 if(!nm){if(typeof toast==='function')toast('ROOM EDITOR','name that fixture in the glb first — lightsOff keys on its name',2.6);return;}
 if(l.userData.roomOff){if(typeof toast==='function')toast('ROOM EDITOR','already detached',1.4);return;}
 const p=new THREE.Vector3();l.getWorldPosition(p);
 const spec={type:l.isSpotLight?'spot':l.isDirectionalLight?'dir':'point',
  pos:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)],
  color:l.color.getHex(),int:+l.intensity.toFixed(4)};
 if(!l.isDirectionalLight){spec.dist=+(l.distance||0).toFixed(1);spec.decay=l.decay===undefined?2:l.decay;}
 if(l.isSpotLight){spec.angle=+l.angle.toFixed(3);spec.penumbra=+(l.penumbra||0).toFixed(2);}
 if(l.target){const t=new THREE.Vector3();l.target.getWorldPosition(t);
  spec.look=[+t.x.toFixed(2),+t.y.toFixed(2),+t.z.toFixed(2)];}
 const list=reditLights();list.push(spec);
 reditBakedToggle(l);                          // switches the baked one off + records lightsOff
 RE.sel={kind:'light',i:list.length-1,part:'pos'};RE.tab='lights';
 reditApplyLights();reditSync();
 if(typeof toast==='function')toast('ROOM EDITOR','detached '+nm+' — it moves now',1.8);
}
function reditAddLight(type){
 const p=reditAimPoint(),list=reditLights();
 const L={type:type,pos:[+p.x.toFixed(2),80,+p.z.toFixed(2)],color:0xffffff,int:2};
 if(type!=='dir'){L.dist=260;L.decay=2;}
 if(type==='spot'){L.angle=0.6;L.penumbra=0.4;}
 if(type!=='point')L.look=[+p.x.toFixed(2),0,+p.z.toFixed(2)];
 list.push(L);RE.sel={kind:'light',i:list.length-1,part:'pos'};
 reditApplyLights();reditSync();
 if(typeof Au!=='undefined')Au.ui();
}

/* --- WORLD tab ------------------------------------------------------------
   Room-level look. Everything writes the SAME config the loader reads, so what you tune
   is what ships. `gain` is linear in delivered light (see CONFIG.render.roomLight), which
   is exactly what makes a slider worth having on it. */
function reditTabWorld(w){
 const rm=reditRoom(),id=reditRoomId();
 if(!rm.light)rm.light={};
 const relight=()=>{
  const g=(typeof roomGroups!=='undefined')?roomGroups[id]:null;
  if(g&&typeof reditRelight==='function')reditRelight(g,rm);
 };
 w.appendChild(reEl('h4',null,'baked-light transfer'));
 w.appendChild(reSlider('gain',rm.light.gain===undefined?1:rm.light.gain,0,40,0.1,v=>{rm.light.gain=v;relight();}));
 w.appendChild(reSlider('reach',rm.light.reach===undefined?
  ((CONFIG.render&&CONFIG.render.roomLight&&CONFIG.render.roomLight.reach)||3):rm.light.reach,0,12,0.1,
  v=>{rm.light.reach=v;relight();}));
 const box=reEl('div','reList');box.id='reLightRead';w.appendChild(box);
 w.appendChild(reEl('h4',null,'ambient + key'));
 if(!rm.hemi)rm.hemi={sky:0xffffff,ground:0x101010,int:0.8};
 if(!rm.dir)rm.dir={color:0xffffff,int:0.8,pos:[45,100,35]};
 w.appendChild(reSlider('hemi',rm.hemi.int,0,2,0.01,
  v=>{rm.hemi.int=v;if(typeof hemiLight!=='undefined'&&hemiLight)hemiLight.intensity=v;reditBackup();}));
 w.appendChild(reColor('sky',rm.hemi.sky,v=>{rm.hemi.sky=v;
  if(typeof hemiLight!=='undefined'&&hemiLight)hemiLight.color.set(v);reditBackup();}));
 w.appendChild(reColor('ground',rm.hemi.ground,v=>{rm.hemi.ground=v;
  if(typeof hemiLight!=='undefined'&&hemiLight)hemiLight.groundColor.set(v);reditBackup();}));
 w.appendChild(reSlider('dir',rm.dir.int,0,2,0.01,
  v=>{rm.dir.int=v;if(typeof dirLight!=='undefined'&&dirLight)dirLight.intensity=v;reditBackup();}));
 w.appendChild(reColor('dir col',rm.dir.color,v=>{rm.dir.color=v;
  if(typeof dirLight!=='undefined'&&dirLight)dirLight.color.set(v);reditBackup();}));
 const dp=rm.dir.pos||(rm.dir.pos=[45,100,35]);
 const setDir=()=>{if(typeof dirLight!=='undefined'&&dirLight)dirLight.position.set(dp[0],dp[1],dp[2]);reditBackup();};
 w.appendChild(reNum('dir x',dp[0],1,v=>{dp[0]=v;setDir();}));
 w.appendChild(reNum('dir y',dp[1],1,v=>{dp[1]=v;setDir();}));
 w.appendChild(reNum('dir z',dp[2],1,v=>{dp[2]=v;setDir();}));
 w.appendChild(reEl('h4',null,'atmosphere'));
 w.appendChild(reColor('bg',rm.bg===undefined?0x05060f:rm.bg,v=>{rm.bg=v;
  if(typeof scene!=='undefined'){scene.background=new THREE.Color(v);if(scene.fog)scene.fog.color.set(v);}reditBackup();}));
 const fg=rm.fog||(rm.fog=[200,430]);
 const setFog=()=>{if(typeof scene!=='undefined'&&scene.fog){scene.fog.near=fg[0];scene.fog.far=fg[1];}reditBackup();};
 w.appendChild(reNum('fog near',fg[0],5,v=>{fg[0]=v;setFog();}));
 w.appendChild(reNum('fog far',fg[1],5,v=>{fg[1]=v;setFog();}));
 // These still write the ROOM (so the export is right) but cannot preview with fog switched
 // off in Options — a live control that silently does nothing is worth one line of explanation.
 if(typeof cfg!=='undefined'&&cfg.fog===false)
  w.appendChild(reEl('div','reMuted','fog is OFF in Options → Display — these still export'));
 w.appendChild(reEl('h4',null,'renderer (global)'));
 w.appendChild(reSlider('exposure',(CONFIG.render&&CONFIG.render.exposure)||1,0.2,2.5,0.01,
  v=>{CONFIG.render.exposure=v;if(typeof applyToneMapping==='function')applyToneMapping(renderer,false);}));
 const tm=reEl('div','reRow');tm.appendChild(reEl('label',null,'tone'));
 const sel=document.createElement('select');
 ['aces','none','reinhard','cineon','linear'].forEach(k=>{const o=document.createElement('option');
  o.value=o.textContent=k;if((CONFIG.render&&CONFIG.render.toneMapping)===k)o.selected=true;sel.appendChild(o);});
 sel.onchange=()=>{CONFIG.render.toneMapping=sel.value;
  if(typeof applyToneMapping==='function')applyToneMapping(renderer,true);};   // true: define changed, recompile
 tm.appendChild(sel);w.appendChild(tm);
 w.appendChild(reEl('div','reMuted','exposure + tone are CONFIG.render, not this room'));
 reditLightReadout();
}
/* Re-run applyRoomLights from the GLB's ORIGINAL candela. The transfer is destructive
   (it overwrites intensity), so the authored value is stashed on first touch — without
   this, dragging the gain slider would compound: each pass would re-divide the already
   transferred value by d0^2 and the room would collapse to black in a few frames. */
function reditRelight(group,rm){
 group.traverse(c=>{if(c.isLight&&c.userData.reAuthored===undefined){
  c.userData.reAuthored=c.intensity;c.userData.reDist=c.distance;}});
 group.traverse(c=>{if(c.isLight){c.intensity=c.userData.reAuthored;c.distance=0;}});
 if(typeof applyRoomLights==='function')applyRoomLights(group,rm);
 reditLightReadout();      // readout only — rebuilding the section here would destroy the
 reditBackup();            // slider mid-drag, since these fire on every 'input' event
}
/* Refresh just the per-fixture readout, in place. */
function reditLightReadout(){
 const box=document.getElementById('reLightRead');if(!box)return;
 const g=(typeof roomGroups!=='undefined')?roomGroups[reditRoomId()]:null;
 box.innerHTML='';
 if(!g){box.appendChild(reEl('div','reItem reMuted','no room glb'));return;}
 let n=0;
 g.traverse(c=>{if(c.isLight){n++;box.appendChild(reEl('div','reItem reMuted',
  (c.name||c.type)+'   '+(c.userData.roomOff?'off':c.intensity.toFixed(3))+(c.distance?'  @'+Math.round(c.distance):'')));}});
 if(!n)box.appendChild(reEl('div','reItem reMuted','no baked lights in this glb'));
}

/* --- selection -----------------------------------------------------------
   Always on screen under the tabs, whatever tab is up: the thing you just clicked in the
   world is the thing you want a slider for, and hunting for the right tab first is the
   friction this tool exists to remove. */
function reditSyncSel(){
 const w=document.getElementById('reSel');w.innerHTML='';
 w.appendChild(reEl('h4',null,'selection'));
 if(!RE.sel){w.appendChild(reEl('div','reMuted','click something in the scene · drag to move · shift-drag for height'));return;}
 if(RE.sel.kind==='light')return reditSelLight(w);
 if(RE.sel.kind==='baked')return reditSelBaked(w);
 return reditSelProp(w);
}
function reditSelLight(w){
 const list=reditLights(),L=list[RE.sel.i];
 if(!L){RE.sel=null;w.appendChild(reEl('div','reMuted','gone'));return;}
 const t=L.type||'point',set=()=>reditApplyLights();
 w.appendChild(reEl('div','reMuted',t+' light #'+RE.sel.i+(RE.sel.part==='look'?'  (aim point)':'')));
 const p=L.pos||(L.pos=[0,80,0]);
 w.appendChild(reNum('x',p[0],1,v=>{p[0]=v;set();}));
 w.appendChild(reNum('y',p[1],1,v=>{p[1]=v;set();}));
 w.appendChild(reNum('z',p[2],1,v=>{p[2]=v;set();}));
 w.appendChild(reColor('colour',L.color===undefined?0xffffff:L.color,v=>{L.color=v;set();}));
 w.appendChild(reSlider('int',L.int===undefined?1:L.int,0,12,0.05,v=>{L.int=v;set();}));
 if(t!=='dir'){
  w.appendChild(reSlider('dist',L.dist===undefined?0:L.dist,0,900,5,v=>{L.dist=v;set();}));
  w.appendChild(reSlider('decay',L.decay===undefined?2:L.decay,0,3,0.1,v=>{L.decay=v;set();}));
 }
 if(t==='spot'){
  w.appendChild(reSlider('angle',L.angle===undefined?0.6:L.angle,0.05,1.5,0.01,v=>{L.angle=v;set();}));
  w.appendChild(reSlider('penumbra',L.penumbra===undefined?0.4:L.penumbra,0,1,0.02,v=>{L.penumbra=v;set();}));
 }
 if(t!=='point'){
  const k=L.look||(L.look=[0,0,0]);
  w.appendChild(reNum('aim x',k[0],1,v=>{k[0]=v;set();}));
  w.appendChild(reNum('aim y',k[1],1,v=>{k[1]=v;set();}));
  w.appendChild(reNum('aim z',k[2],1,v=>{k[2]=v;set();}));
 }
 const ty=reEl('div','reRow');ty.appendChild(reEl('label',null,'type'));
 const sel=document.createElement('select');
 ['point','spot','dir'].forEach(k=>{const o=document.createElement('option');
  o.value=o.textContent=k;if(t===k)o.selected=true;sel.appendChild(o);});
 sel.onchange=()=>{L.type=sel.value;
  if(L.type!=='point'&&!L.look)L.look=[0,0,0];
  if(L.type==='spot'){if(L.angle===undefined)L.angle=0.6;if(L.penumbra===undefined)L.penumbra=0.4;}
  reditApplyLights();reditSync();};
 ty.appendChild(sel);w.appendChild(ty);
 const row=reBtnRow();
 const dup=reEl('button',null,'duplicate');
 dup.onclick=()=>{const c=JSON.parse(JSON.stringify(L));c.pos=[p[0]+10,p[1],p[2]];
  list.push(c);RE.sel={kind:'light',i:list.length-1,part:'pos'};reditApplyLights();reditSync();};
 row.appendChild(dup);
 const foc=reEl('button',null,'focus');foc.onclick=()=>reditFocus();row.appendChild(foc);
 const del=reEl('button','reDanger','delete');
 del.onclick=()=>{list.splice(RE.sel.i,1);RE.sel=null;reditApplyLights();reditSync();};
 row.appendChild(del);w.appendChild(row);
}
function reditSelBaked(w){
 const l=reditBaked().filter(x=>(x.name||'')===RE.sel.name)[0];
 if(!l){RE.sel=null;w.appendChild(reEl('div','reMuted','gone'));return;}
 w.appendChild(reEl('div','reMuted','baked · '+(l.name||l.type)));
 w.appendChild(reEl('div','reMuted','position lives in the glb. Detach it to move it.'));
 const p=new THREE.Vector3();l.getWorldPosition(p);
 w.appendChild(reEl('div','reMuted','at  '+p.x.toFixed(1)+', '+p.y.toFixed(1)+', '+p.z.toFixed(1)));
 const row=reBtnRow();
 const t=reEl('button',null,l.userData.roomOff?'switch on':'switch off');
 t.onclick=()=>reditBakedToggle(l);row.appendChild(t);
 const d=reEl('button',null,'detach');d.onclick=()=>reditDetach(l);row.appendChild(d);
 const foc=reEl('button',null,'focus');foc.onclick=()=>reditFocus();row.appendChild(foc);
 w.appendChild(row);
}
function reditSelProp(w){
 const specs=reditSpecs();
 if(!specs[RE.sel.spec]){RE.sel=null;w.appendChild(reEl('div','reMuted','gone'));return;}
 const sp=specs[RE.sel.spec];
 const isAt=(RE.sel.idx!==null&&RE.sel.idx!==undefined&&sp.at&&sp.at[RE.sel.idx]);
 w.appendChild(reEl('div','reMuted',sp.prop+(isAt?'  placement #'+RE.sel.idx:'  (whole spec)')));
 if(isAt){
  const a=sp.at[RE.sel.idx];
  const set=(k,v)=>{a[k]=v;reditApply();};
  w.appendChild(reNum('x',a[0]||0,1,v=>set(0,v)));
  w.appendChild(reNum('y',a[1]||0,1,v=>set(1,v)));
  w.appendChild(reNum('z',a[2]||0,1,v=>set(2,v)));
  w.appendChild(reSlider('yaw',a[3]||0,-3.1416,3.1416,0.01,v=>set(3,v)));
  w.appendChild(reSlider('scale',a[4]===undefined?1:a[4],0.05,5,0.01,v=>set(4,v)));
  const row=reBtnRow();
  const dup=reEl('button',null,'duplicate');
  dup.onclick=()=>{sp.at.push(a.slice());RE.sel={kind:'prop',spec:RE.sel.spec,idx:sp.at.length-1};reditApply();reditSync();};
  row.appendChild(dup);
  const foc=reEl('button',null,'focus');foc.onclick=()=>reditFocus();row.appendChild(foc);
  const del=reEl('button','reDanger','delete');
  del.onclick=()=>{sp.at.splice(RE.sel.idx,1);RE.sel=null;reditApply();reditSync();};
  row.appendChild(del);w.appendChild(row);
 }
 /* scatter generator for this spec */
 const sc=sp.scatter;
 const toggle=reEl('button',null,sc?'remove scatter':'add scatter');
 toggle.onclick=()=>{
  if(sc)delete sp.scatter;
  else sp.scatter={kind:'ring',n:24,r:150,at:[0,0,0],face:'in'};
  reditApply();reditSync();};
 w.appendChild(toggle);
 if(sc){
  const kinds=['ring','grid','box','line'];
  const kr=reEl('div','reRow');kr.appendChild(reEl('label',null,'kind'));
  const sel=document.createElement('select');
  kinds.forEach(k=>{const o=document.createElement('option');o.value=o.textContent=k;if(sc.kind===k)o.selected=true;sel.appendChild(o);});
  sel.onchange=()=>{sc.kind=sel.value;reditApply();reditSync();};
  kr.appendChild(sel);w.appendChild(kr);
  const f=(k,d,st)=>w.appendChild(reNum(k,sc[k]===undefined?d:sc[k],st===undefined?1:st,v=>{sc[k]=v;reditApply();}));
  f('n',24);
  if(sc.kind==='ring'){f('r',150);f('rInner',sc.r||150);f('rows',1);f('rowRise',0);}
  if(sc.kind==='grid'){f('nx',4);f('nz',4);f('w',100);f('d',100);}
  if(sc.kind==='box'){f('w',100);f('d',100);}
  w.appendChild(reNum('seed',sp.seed===undefined?0:sp.seed,1,v=>{sp.seed=v;reditApply();}));
  w.appendChild(reNum('jitter x',(sp.jitter&&sp.jitter.x)||0,0.5,v=>{sp.jitter=sp.jitter||{};sp.jitter.x=v;reditApply();}));
  w.appendChild(reNum('jitter z',(sp.jitter&&sp.jitter.z)||0,0.5,v=>{sp.jitter=sp.jitter||{};sp.jitter.z=v;reditApply();}));
  w.appendChild(reSlider('scaleVar',sp.scaleVar||0,0,0.6,0.01,v=>{sp.scaleVar=v;reditApply();}));
 }
}

/* --- markers -------------------------------------------------------------
   A light is invisible; a light you cannot see is a light you cannot place. Every fixture
   in the room gets a bulb marker in its own colour, plus a wire cone for a spot's throw
   and a line to its aim point. AUTHORED markers are built from the SPECS (which is what
   makes them draggable — the marker and the data are the same thing); BAKED ones from the
   live glb, dimmer, because they are read-only until detached.

   They draw with depthTest off and a high renderOrder on purpose: a bulb hanging inside a
   lampshade prop is occluded from most angles, and a light you can only click by flying
   inside the fixture is a light you stop using. What you see is what you can click.

   The whole group is torn down on exit — editor chrome that outlives its editor is a bug
   you find later, in a screenshot. */
function reditGeo(){
 if(RE.geo)return RE.geo;
 RE.geo={bulb:new THREE.SphereGeometry(1,12,8),
  ring:new THREE.TorusGeometry(1,0.02,6,24),
  cone:new THREE.ConeGeometry(1,1,16,1,true)};
 return RE.geo;
}
function reditClearMarkers(){
 if(RE.mk){
  RE.mk.traverse(o=>{
   if(o.material&&o.material.dispose)o.material.dispose();
   if(o.geometry&&o.userData.reOwnGeo&&o.geometry.dispose)o.geometry.dispose();
  });
  scene.remove(RE.mk);
 }
 RE.mk=null;RE.pick=[];
}
function reditMarkers(){
 reditClearMarkers();
 RE.mkGrp=(typeof roomGroups!=='undefined')?roomGroups[reditRoomId()]:null;
 if(!RE.on||!RE.showMk)return;
 const g=reditGeo(),grp=RE.mk=new THREE.Group();
 grp.name='reditMarkers';grp.frustumCulled=false;scene.add(grp);
 const bulb=(col,op,sel,base)=>{
  const m=new THREE.Mesh(g.bulb,new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op,depthTest:false}));
  m.renderOrder=999;m.frustumCulled=false;m.userData.reMark=1;m.userData.reBase=base||1;m.userData.reSel=sel;
  grp.add(m);RE.pick.push(m);return m;
 };
 const wire=(geo,col,op)=>{
  const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:col,wireframe:true,transparent:true,opacity:op,depthTest:false}));
  m.renderOrder=998;m.frustumCulled=false;grp.add(m);return m;
 };
 const line=(a,b,col)=>{
  const m=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),
   new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.55,depthTest:false}));
  m.renderOrder=998;m.frustumCulled=false;m.userData.reOwnGeo=1;grp.add(m);return m;
 };
 reditLights().forEach((L,i)=>{
  const t=L.type||'point',col=L.color===undefined?0xffffff:L.color;
  const p=L.pos||[0,80,0],P=new THREE.Vector3(p[0]||0,p[1]||0,p[2]||0);
  bulb(col,0.95,{kind:'light',i:i,part:'pos'},1).position.copy(P);
  if(t!=='point'){
   const k=L.look||[0,0,0],K=new THREE.Vector3(k[0]||0,k[1]||0,k[2]||0);
   line(P,K,col);
   bulb(col,0.5,{kind:'light',i:i,part:'look'},0.6).position.copy(K);
   if(t==='spot'){
    const len=reditConeLen(P,K,L),rad=Math.tan(L.angle===undefined?0.6:L.angle)*len;
    const c=wire(g.cone,col,0.14);
    const end=K.clone().sub(P).normalize().multiplyScalar(len).add(P);
    c.scale.set(rad,len,rad);c.position.copy(P).lerp(end,0.5);
    c.lookAt(end);c.rotateX(Math.PI/2);          // ConeGeometry points +y; aim it down the throw
   }
  }
  // The reach ring is SELECTION-ONLY: a 260-unit wire circle around every lamp at once is
  // a room you cannot see past, and reach only matters for the one you are tuning.
  if(RE.sel&&RE.sel.kind==='light'&&RE.sel.i===i&&t!=='dir'&&L.dist>0){
   const r=wire(g.ring,0xffffff,0.28);
   r.scale.set(L.dist,L.dist,L.dist);r.position.copy(P);r.rotation.x=Math.PI/2;
  }
 });
 reditBaked().forEach(l=>{
  const P=new THREE.Vector3();l.getWorldPosition(P);
  bulb(l.color.getHex(),l.userData.roomOff?0.2:0.55,{kind:'baked',name:l.name||''},0.75).position.copy(P);
  if(l.target){const T=new THREE.Vector3();l.target.getWorldPosition(T);
   if(T.distanceTo(P)>0.5)line(P,T,l.color.getHex());}
 });
}
/* How long to draw a spot's cone, and it is NOT the distance to its aim point. A GLB pendant
   aims at a target hanging a metre under the bulb, so drawing pos->target gives a cone about
   one unit long — invisible, and useless for the one thing the cone is for, which is seeing
   where the light actually lands. So: run the beam down to the FLOOR when it points downward
   (that circle is the pool of light you are placing), else fall back to the light's own reach.
   Clamped either way, because a cone you cannot see answers no question. */
function reditConeLen(P,K,L){
 const d=K.clone().sub(P);
 if(d.lengthSq()<1e-6)return 60;
 d.normalize();
 let len=(d.y<-0.05)?(P.y/-d.y):0;              // parameter at which the beam crosses y=0
 if(!(len>0)||!isFinite(len))len=L.dist>0?L.dist:P.distanceTo(K);
 return clamp(len,8,900);
}
/* Per-frame: keep every marker a usable size whatever the camera is doing. */
function reditScaleMarkers(){
 if(!RE.mk)return;
 const c=camera.position;
 RE.mk.children.forEach(o=>{
  if(!o.userData.reMark)return;
  o.scale.setScalar(clamp(o.position.distanceTo(c)*RE_MK.scale,RE_MK.min,RE_MK.max)*o.userData.reBase);
 });
}
/* A wire box around the current selection. Cheap and unambiguous — a tint would fight
   the per-instance colours a prop scatter already uses. */
function reditHilite(sel){
 if(RE.box){scene.remove(RE.box);RE.box.geometry.dispose();RE.box.material.dispose();RE.box=null;}
 if(!sel||!RE.on)return;
 const pos=reditSelPos(sel);if(!pos)return;
 const s=(sel.kind==='prop')?12:9;
 RE.box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s,s,s)),
  new THREE.LineBasicMaterial({color:0x7fb0ff,depthTest:false}));
 RE.box.position.copy(pos);
 if(sel.kind==='prop')RE.box.position.y+=s/2;
 RE.box.renderOrder=1000;RE.box.frustumCulled=false;scene.add(RE.box);
}
/* World position of whatever is selected. The ONE place that knows how each kind is
   addressed, so the hilite, focus, nudge and drag all ask the same question and cannot
   disagree about where the thing is. */
function reditSelPos(sel){
 if(!sel)return null;
 if(sel.kind==='light'){
  const L=reditLights()[sel.i];if(!L)return null;
  const a=(sel.part==='look')?(L.look||[0,0,0]):(L.pos||[0,0,0]);
  return new THREE.Vector3(a[0]||0,a[1]||0,a[2]||0);
 }
 if(sel.kind==='baked'){
  const l=reditBaked().filter(x=>(x.name||'')===sel.name)[0];if(!l)return null;
  const p=new THREE.Vector3();l.getWorldPosition(p);return p;
 }
 const sp=reditSpecs()[sel.spec];if(!sp)return null;
 if(sel.idx!==null&&sel.idx!==undefined&&sp.at&&sp.at[sel.idx]){
  const a=sp.at[sel.idx];return new THREE.Vector3(a[0],a[1]||0,a[2]);}
 if(sp.scatter&&sp.scatter.at)return new THREE.Vector3(sp.scatter.at[0],sp.scatter.at[1]||0,sp.scatter.at[2]);
 return null;
}
/* How to WRITE a position back, per kind. A baked light has no setter — its position is
   in the glb — which is exactly why it returns null and therefore cannot be dragged or
   nudged. One function decides that, rather than a guard at each call site. */
function reditSetter(sel){
 if(sel.kind==='light'){
  const L=reditLights()[sel.i];if(!L)return null;
  if(sel.part==='look'){const k=L.look||(L.look=[0,0,0]);
   return (x,y,z)=>{k[0]=+x.toFixed(2);k[1]=+y.toFixed(2);k[2]=+z.toFixed(2);reditApplyLights();};}
  const p=L.pos||(L.pos=[0,0,0]);
  return (x,y,z)=>{p[0]=+x.toFixed(2);p[1]=+y.toFixed(2);p[2]=+z.toFixed(2);reditApplyLights();};
 }
 if(sel.kind==='prop'){
  const sp=reditSpecs()[sel.spec];
  if(!sp||sel.idx===null||sel.idx===undefined||!sp.at||!sp.at[sel.idx])return null;
  const a=sp.at[sel.idx];
  return (x,y,z)=>{a[0]=+x.toFixed(2);a[1]=+y.toFixed(2);a[2]=+z.toFixed(2);reditApply();};
 }
 return null;
}
/* Fly to the selection keeping the direction already faced — snapping to a canned angle
   instead throws away the shot you were composing to get there. */
function reditFocus(){
 const p=reditSelPos(RE.sel);if(!p)return;
 const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
 camera.position.copy(p).addScaledVector(dir,-60);
}

/* --- picking + placing ----------------------------------------------------
   Where the camera is looking, on the floor. New things land there rather than at the
   origin, so "fly somewhere, press +" puts the thing in front of you. */
function reditAimPoint(){
 if(!RE.ray)RE.ray=new THREE.Raycaster();
 const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
 const o=camera.position;
 if(Math.abs(dir.y)<1e-4)return new THREE.Vector3(o.x+dir.x*100,0,o.z+dir.z*100);
 const t=-o.y/dir.y;
 if(t<=0||t>4000)return new THREE.Vector3(o.x+dir.x*100,0,o.z+dir.z*100);   // looking up/away
 return new THREE.Vector3(o.x+dir.x*t,0,o.z+dir.z*t);
}
function reditAdd(id){
 const p=reditAimPoint(),specs=reditSpecs();
 specs.push({prop:id,at:[[+p.x.toFixed(2),0,+p.z.toFixed(2),0,1]]});
 RE.sel={kind:'prop',spec:specs.length-1,idx:0};
 reditApply();reditSync();
 if(typeof Au!=='undefined')Au.ui();
}
function reditRay(ev){
 if(!RE.ray)RE.ray=new THREE.Raycaster();
 const r=renderer.domElement.getBoundingClientRect();
 RE.ray.setFromCamera({x:((ev.clientX-r.left)/r.width)*2-1,y:-((ev.clientY-r.top)/r.height)*2+1},camera);
 return RE.ray;
}
/* MARKERS ARE TESTED FIRST, and that ordering is the feature: the light markers sit on top
   of the room visually, so they must sit on top of it for picking too, or clicking a bulb
   would select the lampshade behind it.

   Then the props. An InstancedMesh reports instanceId, and instances are built in placement
   order — explicit `at` entries first, then the scatter (see propPlacements) — so an id
   below at.length maps straight back to a placement. Above it, the instance came from the
   generator and the SPEC is what to select. */
function reditPick(ev){
 if(!RE.on)return null;
 const ray=reditRay(ev);
 if(RE.pick.length){
  const mh=ray.intersectObjects(RE.pick,false);
  if(mh.length)return mh[0].object.userData.reSel;
 }
 const g=(typeof propGroups!=='undefined')?propGroups[reditRoomId()]:null;
 if(!g||!g.children.length)return null;
 const hits=ray.intersectObjects(g.children,false);
 if(!hits.length)return null;
 const h=hits[0],si=h.object.userData.specIndex;
 if(si===undefined||si===null)return null;
 const sp=reditSpecs()[si];
 const nAt=(sp&&sp.at)?sp.at.length:0;
 const iid=(h.instanceId===undefined||h.instanceId===null)?0:h.instanceId;
 return {kind:'prop',spec:si,idx:(iid<nAt)?iid:null};
}

/* --- drag ----------------------------------------------------------------
   Grab and move. Both modes are a ray against a PLANE, and the MODE is captured at
   mousedown rather than read live: the plane has to be anchored where the grab started,
   so re-picking it mid-gesture would make the thing jump the moment you touched shift.
   Plain drag slides on the ground plane through the object; shift-drag moves it up and
   down on a plane facing the camera. */
function reditDragStart(ev,sel){
 const pos=reditSelPos(sel);if(!pos)return false;
 const setter=reditSetter(sel);if(!setter)return false;    // baked lights have none, by design
 const yMode=ev.shiftKey;
 const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
 let n;
 if(yMode){n=fwd.clone();n.y=0;if(n.lengthSq()<1e-6)n.set(0,0,1);n.normalize();}
 else{
  /* A GRAZING GROUND PLANE IS THE ONE THING THAT MAKES PLANE-DRAGGING UNUSABLE, and lights
     are exactly where you meet it: they hang high, so you fly up to eye level with one and
     then the floor is nearly edge-on. Measured: at 8 degrees above horizontal a 140px drag
     threw a light 170 units, because the ray meets the plane hundreds of units away and one
     pixel is worth metres. So when the view is that shallow, drag on the CAMERA-FACING plane
     instead — never edge-on by construction — and keep only its x/z. Above the threshold the
     ground plane is both well-conditioned and more intuitive (the thing follows the cursor
     across the floor), so it stays. Top-down, the two planes coincide anyway. */
  n=(Math.abs(fwd.y)>=RE_MK.grazeDot)?new THREE.Vector3(0,1,0):fwd.clone().normalize();
 }
 const hit=new THREE.Vector3();
 const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(n,pos);
 if(!reditRay(ev).ray.intersectPlane(plane,hit))return false;
 RE.drag={plane:plane,yMode:yMode,setter:setter,off:pos.clone().sub(hit),start:pos.clone(),moved:false};
 return true;
}
function reditDragMove(ev){
 const d=RE.drag;if(!d)return;
 const hit=new THREE.Vector3();
 if(!reditRay(ev).ray.intersectPlane(d.plane,hit))return;
 const p=hit.add(d.off);
 if(d.yMode){p.x=d.start.x;p.z=d.start.z;}else p.y=d.start.y;
 if(RE.snap>0){const q=RE.snap;p.x=Math.round(p.x/q)*q;p.y=Math.round(p.y/q)*q;p.z=Math.round(p.z/q)*q;}
 if(!d.moved&&p.distanceToSquared(d.start)<0.01)return;    // a click is not a drag
 d.moved=true;d.setter(p.x,p.y,p.z);
}
function reditDragEnd(){
 const d=RE.drag;RE.drag=null;
 if(d&&d.moved){reditSyncSel();if(typeof Au!=='undefined')Au.ui();}
}

/* --- export --------------------------------------------------------------
   Emits the WHOLE room block in config.js's own shape and key order, so pasting it over
   the entry there is the entire save step. That is also why the entries in config.js
   carry no inline comments any more: a paste would destroy them, and a format that only
   ALMOST matches its destination is a format nobody trusts twice.

   Two rules earn their keep. Numbers are ROUNDED (an editor that writes
   17.000000000000004 into a source file is a bad citizen), and colour-valued keys are
   emitted as 0x HEX — a colour written as 16750899 is one nobody can read, compare or
   nudge by hand afterwards, which is most of what you do to a colour in a config file. */
const RE_HEXKEY={color:1,sky:1,ground:1,bg:1,shell:1};
/* 3dp is right for a coordinate and wrong for a dim light. A detached fixture's intensity IS
   its delivered value, and the pub's fire lands at 0.032 with a low-gain room able to go an
   order of magnitude below that — rounded to 3dp such a light exports as 0, i.e. the paste
   silently switches it off and the room comes back darker than the one you tuned. So small
   magnitudes keep more places. It only widens the numbers that would otherwise be destroyed. */
function reFmtNum(n){
 if(typeof n!=='number'||!isFinite(n))return '0';
 let r=Math.round(n*1000)/1000;
 if(n!==0&&Math.abs(n)<0.01)r=Math.round(n*1e6)/1e6;
 return (Object.is(r,-0)?0:r).toString();
}
function reFmt(k,v){
 if(v===null||v===undefined)return 'null';
 if(typeof v==='boolean')return v?'true':'false';
 // Built without a literal backslash in the source on purpose: this string is itself an
 // escaper, and writing it with escapes makes it the one line nobody can read correctly.
 if(typeof v==='string'){const bs=String.fromCharCode(92);
  return "'"+v.split(bs).join(bs+bs).split("'").join(bs+"'")+"'";}
 if(typeof v==='number')return RE_HEXKEY[k]?reHex(v):reFmtNum(v);
 if(Array.isArray(v)){
  // env.panels and tint carry colours in positions a key name cannot describe, so they
  // are the two arrays that need naming here rather than a generic rule.
  if(k==='panels')return '['+v.map(p=>'['+reHex(p[0])+','+p.slice(1).map(reFmtNum).join(',')+']').join(',')+']';
  if(k==='tint')return '['+v.map(reHex).join(',')+']';
  return '['+v.map(x=>reFmt(k,x)).join(',')+']';
 }
 return '{'+Object.keys(v).map(kk=>kk+':'+reFmt(kk,v[kk])).join(',')+'}';
}
function reFmtKV(o,keys){
 const out=[];
 keys.forEach(k=>{if(o[k]!==undefined)out.push(k+':'+reFmt(k,o[k]));});
 return out;
}
/* One `at` placement per line past a couple of them: a wall of coordinates on one line is
   unreviewable in a diff, and a diff is where these end up. */
function reditPropsBlock(specs,ind){
 if(!specs.length)return ind+'props:[],';
 const L=[ind+'props:['];
 specs.forEach((sp,i)=>{
  const parts=['prop:'+reFmt('prop',sp.prop)];
  if(sp.at&&sp.at.length){
   const rows=sp.at.map(a=>'['+a.map(reFmtNum).join(',')+']');
   parts.push(sp.at.length<=2?'at:['+rows.join(',')+']'
    :'at:[\n'+ind+'    '+rows.join(',\n'+ind+'    ')+']');
  }
  ['scatter','jitter','scaleVar','tint','seed','fit','yaw','scale','ground'].forEach(k=>{
   if(sp[k]!==undefined)parts.push(k+':'+reFmt(k,sp[k]));});
  L.push(ind+'  {'+parts.join(', ')+'}'+(i===specs.length-1?'':','));
 });
 L.push(ind+'],');
 return L.join('\n');
}
function reditLightsBlock(list,ind){
 if(!list.length)return ind+'lights:[],';
 const order=['type','pos','look','color','int','dist','decay','angle','penumbra'];
 const L=[ind+'lights:['];
 list.forEach((x,i)=>{
  const extra=Object.keys(x).filter(k=>order.indexOf(k)<0);
  L.push(ind+'  {'+reFmtKV(x,order.concat(extra)).join(', ')+'}'+(i===list.length-1?'':','));
 });
 L.push(ind+'],');
 return L.join('\n');
}
/* The paste-ready block. Key order and indentation match CONFIG.rooms exactly — see the
   banner there, which names this file as the thing those entries are shaped for. */
function reditBlock(){
 const id=reditRoomId(),rm=reditRoom(),ind='      ',L=[];
 L.push('   '+id+':{');
 const idk=reFmtKV(rm,['name','folder','glb','backdrop','reflect']);
 if(idk.length)L.push(ind+idk.join(', ')+',');
 if(rm.light&&Object.keys(rm.light).length)L.push(ind+'light:'+reFmt('light',rm.light)+',');
 if(rm.lightsOff&&rm.lightsOff.length)L.push(ind+'lightsOff:'+reFmt('lightsOff',rm.lightsOff)+',');
 const atm=reFmtKV(rm,['bg','fog']);
 if(atm.length)L.push(ind+atm.join(', ')+',');
 if(rm.hemi)L.push(ind+'hemi:'+reFmt('hemi',rm.hemi)+',');
 if(rm.dir)L.push(ind+'dir:'+reFmt('dir',rm.dir)+',');
 if(rm.env)L.push(ind+'env:'+reFmt('env',rm.env)+',');
 L.push(reditLightsBlock(rm.lights||[],ind));
 L.push(reditPropsBlock(rm.props||[],ind));
 if(rm.led)L.push(ind+'led:'+reFmt('led',rm.led));
 else L[L.length-1]=L[L.length-1].replace(/,$/,'');   // last entry carries no trailing comma
 L.push('   },');
 return L.join('\n');
}
function reditTabOut(w){
 w.appendChild(reEl('h4',null,'export'));
 w.appendChild(reEl('div','reMuted','Paste over CONFIG.rooms.'+reditRoomId()+' in js/config.js — same shape, same key order.'));
 const ta=document.createElement('textarea');ta.readOnly=true;ta.value=reditBlock();
 w.appendChild(ta);
 const row=reBtnRow();
 const b=reEl('button',null,'copy room block');
 b.onclick=()=>{
  const t=reditBlock();ta.value=t;
  console.log('/* paste over CONFIG.rooms.'+reditRoomId()+' */\n'+t);
  if(navigator.clipboard&&navigator.clipboard.writeText)
   navigator.clipboard.writeText(t).then(()=>{if(typeof toast==='function')toast('ROOM EDITOR','room block copied',1.4);},
    ()=>{if(typeof toast==='function')toast('ROOM EDITOR','printed to console',1.4);});
  else if(typeof toast==='function')toast('ROOM EDITOR','printed to console',1.4);
 };
 row.appendChild(b);
 const rb=reEl('button',null,'restore');
 rb.title='Reload the crash-backup from the last edit. Never applied automatically.';
 rb.onclick=()=>{
  try{
   const j=JSON.parse(localStorage.getItem('fuzeball_roomedit')||'null');
   if(!j||!j[reditRoomId()]){if(typeof toast==='function')toast('ROOM EDITOR','no backup for this room',1.4);return;}
   const rm=reditRoom(),bk=j[reditRoomId()];
   if(bk.props)rm.props=bk.props;
   if(bk.lights)rm.lights=bk.lights;
   if(bk.lightsOff)rm.lightsOff=bk.lightsOff;
   if(bk.light)rm.light=bk.light;
   if(bk.hemi)rm.hemi=bk.hemi;
   if(bk.dir)rm.dir=bk.dir;
   if(bk.bg!==undefined)rm.bg=bk.bg;
   if(bk.fog)rm.fog=bk.fog;
   RE.sel=null;
   if(typeof applyRoom==='function')applyRoom();   // re-runs the baked transfer + authored lights
   reditApply();reditSync();
  }catch(e){console.warn('room backup restore failed',e);}
 };
 row.appendChild(rb);
 w.appendChild(row);
 w.appendChild(reEl('div','reMuted','Edits are in memory only — export to keep them.'));
 w.appendChild(reEl('h4',null,'controls'));
 [['LMB','select · drag to move on the ground'],
  ['shift+LMB','drag up / down'],
  ['RMB drag','look around'],
  ['WASD / Q E','fly · shift sprint'],
  ['arrows','nudge · shift x10'],
  ['PgUp/PgDn','height'],
  ['[ ]','yaw (props)'],
  ['F','focus the selection'],
  ['Del','delete the selection'],
  ['F2 / Esc','back to the room list']].forEach(k=>{
   const r=reEl('div','reRow');const a=reEl('span','reTag',k[0]);a.style.cssText='flex:0 0 76px';
   r.appendChild(a);r.appendChild(reEl('span','reMuted',k[1]));w.appendChild(r);});
}
/* Crash backup. Written on every change, restored ONLY by the button — an editor that
   silently resurrects old state over what config.js says is an editor you stop trusting. */
function reditBackup(){
 try{
  const all=JSON.parse(localStorage.getItem('fuzeball_roomedit')||'{}');
  const rm=reditRoom();
  all[reditRoomId()]={props:rm.props||[],lights:rm.lights||[],lightsOff:rm.lightsOff||[],
   light:rm.light||{},hemi:rm.hemi,dir:rm.dir,bg:rm.bg,fog:rm.fog};
  localStorage.setItem('fuzeball_roomedit',JSON.stringify(all));
 }catch(e){}
}
/* --- per-frame ------------------------------------------------------------
   Self-heals like phTick: if the room changed under the panel (venue switch), retarget
   rather than editing a room that is no longer on screen. */
function reditTick(){
 if(!RE.on)return;
 if(RE.room!==reditRoomId()){RE.room=reditRoomId();RE.sel=null;reditMarkers();reditSync();}
 /* THE ROOM GLB ARRIVES LATE. reditEnter runs the moment the venue is applied, but ensureRoom
    is async, so the first reditMarkers() sees no baked fixtures and you land in the editor with
    no light visuals at all — which reads as the markers being broken rather than as a race.
    Watching the GROUP IDENTITY is an O(1) test per frame (a traverse here would not be), and it
    covers the two ways the set can change: the backdrop finishing its download, and a room swap. */
 else if(typeof roomGroups!=='undefined'&&roomGroups[reditRoomId()]!==RE.mkGrp){reditMarkers();reditSync();}
 reditScaleMarkers();
}

/* --- bindings ------------------------------------------------------------
   Self-contained, like photo.js: this file owns its own listeners so a missing
   roomedit.js cannot break input. Capture phase on the pointer handlers so a pick
   lands before input.js's canvas mousedown (which kicks a rod). */
addEventListener('keydown',e=>{
 const t=e.target,tn=t&&t.tagName;
 if(tn==='INPUT'||tn==='SELECT'||tn==='TEXTAREA')return;   // typing in the panel is not a shortcut
 if(e.code==='F2'){e.preventDefault();if(!e.repeat)reditToggle();return;}
 if(!RE.on)return;
 if(e.code==='Escape'){e.preventDefault();e.stopPropagation();reditExit();return;}   // input.js's Esc would backScreen() past the picker
 if(e.repeat)return;
 if(e.code==='KeyF'&&RE.sel){e.preventDefault();reditFocus();return;}
 const sel=RE.sel;if(!sel)return;
 if(e.code==='Delete'){
  e.preventDefault();
  if(sel.kind==='light'){reditLights().splice(sel.i,1);RE.sel=null;reditApplyLights();reditSync();}
  else if(sel.kind==='prop'){const sp=reditSpecs()[sel.spec];
   if(sp&&sel.idx!==null&&sp.at&&sp.at[sel.idx]){sp.at.splice(sel.idx,1);RE.sel=null;reditApply();reditSync();}}
  return;
 }
 // Yaw is a PROP-only nudge (a point light has no facing), so it is handled before the
 // shared position nudge rather than inside it.
 if(e.code==='BracketLeft'||e.code==='BracketRight'){
  const sp=(sel.kind==='prop')?reditSpecs()[sel.spec]:null;
  if(sp&&sel.idx!==null&&sp.at&&sp.at[sel.idx]){
   const a=sp.at[sel.idx];a[3]=(a[3]||0)+(e.code==='BracketLeft'?-0.1:0.1);
   e.preventDefault();reditApply();reditSyncSel();}
  return;
 }
 // Position nudge; arrows are free here because free roam moves on WASD.
 const p=reditSelPos(sel),set=reditSetter(sel);
 if(!p||!set)return;
 const step=(e.shiftKey?10:1)*(RE.snap>0?RE.snap:1);
 let hit=true;
 if(e.code==='ArrowLeft')p.x-=step; else if(e.code==='ArrowRight')p.x+=step;
 else if(e.code==='ArrowUp')p.z-=step; else if(e.code==='ArrowDown')p.z+=step;
 else if(e.code==='PageUp')p.y+=step; else if(e.code==='PageDown')p.y-=step;
 else hit=false;
 if(hit){e.preventDefault();set(p.x,p.y,p.z);reditSyncSel();}
},true);
addEventListener('mousedown',e=>{
 if(!RE.on)return;
 if(RE.panel&&RE.panel.contains(e.target))return;          // clicks in the panel are the panel's
 if(e.target!==renderer.domElement)return;
 if(e.button===2){                                          // RMB: look. input.js already eats contextmenu
  RE.look=1;e.preventDefault();e.stopPropagation();return;}
 if(e.button!==0)return;
 const sel=reditPick(e);
 RE.sel=sel;reditMarkers();reditSync();reditHilite(sel);
 if(sel)reditDragStart(e,sel);
 if(sel&&typeof Au!=='undefined')Au.ui();
 e.preventDefault();e.stopPropagation();                    // beat input.js's kick handler
},true);
/* Mouse-look without pointer lock: movementX/Y is still reported by a plain drag, so the
   maths is the same as input.js's locked path — only the gate differs. */
addEventListener('mousemove',e=>{
 if(!RE.on)return;
 if(RE.look){
  const sens=((typeof CAM!=='undefined'&&CAM.freeRoamSens)||0.22)*0.004;
  S.camYaw-=e.movementX*sens;
  S.camPitch=clamp(S.camPitch-e.movementY*sens,-Math.PI/2+0.01,Math.PI/2-0.01);
  return;
 }
 if(RE.drag){reditDragMove(e);e.preventDefault();}
},true);
addEventListener('mouseup',e=>{
 if(!RE.on)return;
 if(e.button===2){RE.look=null;return;}
 if(e.button===0&&RE.drag)reditDragEnd();
},true);

/* --- the picker screen (#roomEdit) ---------------------------------------
   Reached from the home card (revealed only when CONFIG.debug.roomEditor is on) or F2.
   Its whole job is to answer "which room am I editing" BEFORE anything is applied, so
   the editor never inherits whichever venue the last match happened to leave behind. */
function reditRoomCount(id){
 const rm=CONFIG.rooms[id],n=(rm.props||[]).length;
 let inst=0;(rm.props||[]).forEach(sp=>{inst+=(sp.at?sp.at.length:0)+(sp.scatter?(sp.scatter.n|0):0);});
 return {specs:n,inst:inst,lights:(rm.lights||[]).length,off:(rm.lightsOff||[]).length};
}
function reditRoomList(){
 const box=$('roomEditList');if(!box)return;
 box.innerHTML='';
 const live=RE.prev?cfg.room:null;      // the room currently applied for editing, if any
 for(const id in CONFIG.rooms){
  const rm=CONFIG.rooms[id],c=reditRoomCount(id);
  const b=document.createElement('button');
  b.className='reRoomCard'+(id===live?' live':'');
  const bits=[];
  bits.push(rm.glb?'glb':(rm.backdrop===false?'void':'shared'));
  if(c.specs)bits.push('<i>'+c.inst+'</i> prop'+(c.inst===1?'':'s'));
  if(c.lights)bits.push('<i>'+c.lights+'</i> light'+(c.lights===1?'':'s'));
  if(c.off)bits.push('<i>'+c.off+'</i> off');
  if(rm.light&&rm.light.gain!==undefined)bits.push('gain <i>'+rm.light.gain+'</i>');
  b.innerHTML='<b>'+(rm.name||id)+'</b><span class="reMeta">'+bits.join(' &middot; ')+'</span>';
  b.onclick=()=>reditOpenRoom(id);
  box.appendChild(b);
 }
 const sel=$('roomEditTable');
 if(sel&&!sel.options.length){
  for(const t in CONFIG.tables){const o=document.createElement('option');
   o.value=t;o.textContent=CONFIG.tables[t].name||t;sel.appendChild(o);}
 }
 if(sel)sel.value=cfg.table;
}
function openRoomEdit(){
 if(!reditEnabled()){if(typeof toast==='function')toast('ROOM EDITOR','set CONFIG.debug.roomEditor = true',2.2);return;}
 reditRoomList();
 if(typeof showScreen==='function')showScreen('roomEdit');
}
/* Apply a room and drop straight into the editor. hideScreens() (not showScreen) is what
   clears the menu off the canvas — the same call startMatchNow uses — and it deliberately
   does NOT fire onHide, so scrCur stays 'roomEdit' and the venue restore stays armed. */
function reditOpenRoom(id){
 if(!CONFIG.rooms[id])return;
 if(!RE.prev)RE.prev={room:cfg.room,table:cfg.table};    // stash ONCE; picking again just re-applies
 cfg.room=id;
 if(typeof applyRoom==='function')applyRoom();
 if(typeof hideScreens==='function')hideScreens();
 reditEnter();
}
/* Put the player's own venue back. Fires only when the roomEdit SCREEN is replaced by a
   different one — leaving the editor back to the picker keeps the room applied. */
if(typeof SCREENS!=='undefined'&&SCREENS.roomEdit)SCREENS.roomEdit.onHide=function(){
 if(RE.on)reditExit();
 if(!RE.prev)return;
 const p=RE.prev;RE.prev=null;
 const roomChanged=(cfg.room!==p.room),tableChanged=(cfg.table!==p.table);
 cfg.room=p.room;cfg.table=p.table;
 if(tableChanged&&typeof applyTable==='function')applyTable();
 if(roomChanged&&typeof applyRoom==='function')applyRoom();
};

/* --- boot wiring ---------------------------------------------------------
   The ROUTE is always registered; only the way IN is gated, so a stale saved layout or a
   hand-typed showScreen('roomEdit') can never leave the user on an unreachable screen. */
(function reditInit(){
 const go=()=>{
  const on=reditEnabled();
  const row=$('homeDevRow');
  /* Say so at boot, both ways. A dev tool you cannot tell is loaded is a dev tool you end up
     debugging by guesswork — and the two failure modes look identical from the menu (flag off
     vs. a browser still serving a cached index.html). The missing-element case names itself,
     because index.html is the ONE file that cannot cache-bust itself. */
  if(!row)console.warn('room editor: #homeDevRow is not in the DOM — index.html looks stale. Hard-reload (Ctrl+F5).');
  else if(on){row.classList.remove('hidden');
   console.log('%croom editor: ON — F2, or the ROOM EDITOR card on the home screen','color:#7fb0ff');}
  else console.log('room editor: off (set CONFIG.debug.roomEditor = true)');
  const card=$('btnRoomEdit');
  if(card)card.onclick=()=>{if(typeof Au!=='undefined')Au.init&&Au.init();openRoomEdit();};
  const back=$('roomEditBack');
  if(back)back.onclick=()=>{if(typeof showScreen==='function')showScreen('home');};
  const tbl=$('roomEditTable');
  if(tbl)tbl.onchange=()=>{
   if(!RE.prev)RE.prev={room:cfg.room,table:cfg.table};   // arm the restore before changing anything
   cfg.table=tbl.value;
   if(typeof applyTable==='function')applyTable();
   if(typeof applyRoom==='function')applyRoom();          // a table swap re-parents the pitch
  };
 };
 if(document.readyState==='loading')addEventListener('DOMContentLoaded',go);else go();
})();
