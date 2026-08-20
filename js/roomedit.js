'use strict';
/* ===== room editor (dev tool, F2) =========================================
   Gated on CONFIG.debug.roomEditor. Off by default and self-contained: the cross-
   module gate is S.redit (null when off), tested by input.js and nothing else, so a
   missing roomedit.js cannot break the game. Same discipline as S.photo / S.trn.

   WHAT IT EDITS. The room's PROP SPECS (CONFIG.rooms[id].props) and its LIGHTING —
   in memory, live. There is deliberately no hidden save: edits do not persist to
   localStorage and are NOT reloaded behind your back, because a shadow layer that
   silently overrides config.js is the thing that makes a level editor untrustworthy.
   EXPORT prints the block to paste into config.js and copies it to the clipboard.
   (A crash-backup is written each change and is only ever restored by clicking
   Restore — never automatically.)

   WHY IT EDITS SPECS AND REBUILDS, rather than nudging instance matrices in place:
   the authored thing IS the spec list. Editing matrices would leave the spec and the
   scene disagreeing the moment a scatter is involved, and the export would be a lie.
   Rebuilding is a handful of milliseconds at these counts and this is not a hot path.

   SELECTION RULE, which falls out of the same reasoning: clicking an instance that
   came from an explicit `at` entry selects THAT placement and you move it. Clicking
   one that came from a `scatter` selects the SPEC — individual scatter instances are
   generated, so there is nothing meaningful to drag; you edit the generator instead.
   The camera is free roam (already in fx.js), so this file owns no camera rig.
   ========================================================================= */
const RE={on:false,room:null,sel:null,panel:null,css:false,ray:null,aim:null};

function reditEnabled(){return !!(typeof CONFIG!=='undefined'&&CONFIG.debug&&CONFIG.debug.roomEditor);}
function reditRoomId(){return (typeof cfg!=='undefined'&&CONFIG.rooms[cfg.room])?cfg.room:'open';}
function reditRoom(){return CONFIG.rooms[reditRoomId()];}
/* The live spec list. Created on the room object the first time it is edited, so a
   room that declares no props is still editable. */
function reditSpecs(){const rm=reditRoom();if(!rm.props)rm.props=[];return rm.props;}

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
 RE.on=true;S.redit=RE;RE.room=reditRoomId();RE.sel=null;
 if(!S.freeRoam&&typeof toggleFreeRoam==='function')toggleFreeRoam();   // reuse the existing rig
 reditCSS();buildREPanel();RE.panel.style.display='block';
 reditSync();
 if(typeof toast==='function')toast('ROOM EDITOR','click a prop to select · F2 exits',2.0);
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
 RE.on=false;S.redit=null;RE.sel=null;
 if(RE.panel)RE.panel.style.display='none';
 if(S.freeRoam&&typeof toggleFreeRoam==='function')toggleFreeRoam();
 reditHilite(null);
 if(typeof showScreen==='function')showScreen('roomEdit');
 if(typeof Au!=='undefined')Au.ui();
}
/* Rebuild the room's instanced props from the current specs. Everything that mutates
   a spec funnels through here, so the scene can never drift from the data. */
function reditApply(){
 const id=reditRoomId();
 if(typeof buildRoomProps==='function')buildRoomProps(id,CONFIG.rooms[id],()=>{
  if(typeof propGroups!=='undefined'&&propGroups[id])propGroups[id].visible=true;
  reditHilite(RE.sel);
 });
 reditBackup();
}

/* --- panel ---------------------------------------------------------------
   Built with createElement + one injected <style>, like buildAIPanel — so the tool
   needs no markup in index.html and no rule in styles.css to maintain. */
function reditCSS(){
 if(RE.css)return;RE.css=true;
 const s=document.createElement('style');
 s.textContent=[
 '#reditPanel{position:fixed;top:12px;left:12px;width:310px;max-height:calc(100vh - 24px);overflow-y:auto;',
 ' background:rgba(10,12,18,.93);border:1px solid #4d7fff55;border-radius:8px;padding:10px 11px;z-index:60;',
 ' font:11px/1.45 Rajdhani,system-ui,sans-serif;color:#cfe0ff;letter-spacing:.02em;display:none}',
 '#reditPanel h4{margin:9px 0 5px;font:12px/1 "Russo One",sans-serif;color:#7fb0ff;letter-spacing:.09em;',
 ' text-transform:uppercase;border-top:1px solid #4d7fff33;padding-top:8px}',
 '#reditPanel h4:first-child{border-top:0;margin-top:0;padding-top:0}',
 '#reditPanel .reRow{display:flex;align-items:center;gap:5px;margin:3px 0}',
 '#reditPanel .reRow label{flex:0 0 60px;color:#8fa4c8}',
 '#reditPanel input[type=number],#reditPanel select,#reditPanel input[type=text]{flex:1;min-width:0;',
 ' background:#0c1220;border:1px solid #35507f;color:#dce9ff;border-radius:4px;padding:2px 5px;font:11px Rajdhani,sans-serif}',
 '#reditPanel input[type=range]{flex:1;min-width:0}',
 '#reditPanel button{background:#16233c;border:1px solid #3d67b5;color:#cfe0ff;border-radius:4px;',
 ' padding:3px 7px;cursor:pointer;font:11px Rajdhani,sans-serif}',
 '#reditPanel button:hover{background:#20335a}',
 '#reditPanel button.reDanger{border-color:#b5433d;color:#ffd0cc}',
 '#reditPanel .reList{max-height:150px;overflow-y:auto;border:1px solid #4d7fff33;border-radius:4px;margin:3px 0}',
 '#reditPanel .reItem{padding:3px 6px;cursor:pointer;display:flex;justify-content:space-between;gap:6px}',
 '#reditPanel .reItem:hover{background:#1a2a44}',
 '#reditPanel .reItem.sel{background:#24406e;color:#fff}',
 '#reditPanel .reMuted{color:#7d90b0}',
 '#reditPanel .reHead{display:flex;justify-content:space-between;align-items:center;gap:6px}',
 '#reditPanel .reVal{color:#9fc4ff;min-width:44px;text-align:right}'].join('');
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
function buildREPanel(){
 if(RE.panel)return;
 const p=RE.panel=reEl('div');p.id='reditPanel';
 const head=reEl('div','reHead');
 head.appendChild(reEl('b',null,'ROOM EDITOR'));
 const x=reEl('button',null,'◀ rooms');x.title='Back to the room list (Esc)';x.onclick=reditExit;head.appendChild(x);
 p.appendChild(head);
 p.appendChild(reEl('div','reMuted','room: '+reditRoomId()));
 for(const k of ['Lib','Placed','Sel','Light','Out'])
  {const s=reEl('div');s.id='re'+k;p.appendChild(s);}
 document.body.appendChild(p);
}

/* --- panel contents (rebuilt on every change; it is a dev tool, not a hot path) -- */
function reditSync(){
 if(!RE.panel)return;
 const specs=reditSpecs();
 /* library */
 const lib=document.getElementById('reLib');lib.innerHTML='';
 lib.appendChild(reEl('h4',null,'library'));
 const ids=(typeof propIds==='function')?propIds():[];
 if(!ids.length){
  const m=reEl('div','reMuted','no props. Drop .glb files in assets/props/ then run:');
  lib.appendChild(m);
  const c=reEl('div','reMuted','node tools/build_props_manifest.js');
  c.style.color='#9fc4ff';lib.appendChild(c);
 }else{
  const list=reEl('div','reList');
  ids.forEach(id=>{const it=reEl('div','reItem');
   it.appendChild(reEl('span',null,id));
   const b=reEl('button',null,'+');b.onclick=e=>{e.stopPropagation();reditAdd(id);};
   it.appendChild(b);list.appendChild(it);});
  lib.appendChild(list);
 }
 /* placed specs */
 const pl=document.getElementById('rePlaced');pl.innerHTML='';
 pl.appendChild(reEl('h4',null,'placed  ('+specs.length+')'));
 const pList=reEl('div','reList');
 specs.forEach((sp,i)=>{
  const it=reEl('div','reItem'+(RE.sel&&RE.sel.spec===i?' sel':''));
  const n=(sp.at?sp.at.length:0)+(sp.scatter?(sp.scatter.n|0)||0:0);
  it.appendChild(reEl('span',null,sp.prop+(sp.scatter?' ['+sp.scatter.kind+']':'')+'  x'+n));
  const d=reEl('button','reDanger','del');
  d.onclick=e=>{e.stopPropagation();specs.splice(i,1);RE.sel=null;reditApply();reditSync();};
  it.appendChild(d);
  it.onclick=()=>{RE.sel={spec:i,idx:null};reditSync();reditHilite(RE.sel);};
  pList.appendChild(it);
 });
 pl.appendChild(pList);
 reditSyncSel();reditSyncLight();reditSyncOut();
}
/* selected spec / placement */
function reditSyncSel(){
 const w=document.getElementById('reSel');w.innerHTML='';
 w.appendChild(reEl('h4',null,'selection'));
 const specs=reditSpecs();
 if(!RE.sel||!specs[RE.sel.spec]){w.appendChild(reEl('div','reMuted','click a prop in the scene, or a row above'));return;}
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
  const dup=reEl('button',null,'duplicate');
  dup.onclick=()=>{sp.at.push(a.slice());RE.sel={spec:RE.sel.spec,idx:sp.at.length-1};reditApply();reditSync();};
  const del=reEl('button','reDanger','delete');
  del.onclick=()=>{sp.at.splice(RE.sel.idx,1);RE.sel=null;reditApply();reditSync();};
  const row=reEl('div','reRow');row.appendChild(dup);row.appendChild(del);w.appendChild(row);
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

/* --- lighting (the tuner the transfer fix earned) -------------------------
   Everything here writes the SAME config the loader reads, so what you tune is what
   ships. `gain` is linear in delivered light (see js/props.js' sibling note and the
   CONFIG.render.roomLight block), which is exactly what makes a slider worth having. */
function reditSyncLight(){
 const w=document.getElementById('reLight');w.innerHTML='';
 w.appendChild(reEl('h4',null,'lighting'));
 const rm=reditRoom(),id=reditRoomId();
 if(!rm.light)rm.light={};
 const relight=()=>{
  // re-run the transfer on the LIVE room glb from its authored candela
  const g=(typeof roomGroups!=='undefined')?roomGroups[id]:null;
  if(g&&typeof reditRelight==='function')reditRelight(g,rm);
 };
 w.appendChild(reSlider('gain',rm.light.gain===undefined?1:rm.light.gain,0,40,0.1,
  v=>{rm.light.gain=v;relight();}));
 w.appendChild(reSlider('reach',rm.light.reach===undefined?
  ((CONFIG.render&&CONFIG.render.roomLight&&CONFIG.render.roomLight.reach)||3):rm.light.reach,0,12,0.1,
  v=>{rm.light.reach=v;relight();}));
 w.appendChild(reSlider('hemi',rm.hemi?rm.hemi.int:0.8,0,2,0.01,
  v=>{if(rm.hemi)rm.hemi.int=v;if(typeof hemiLight!=='undefined'&&hemiLight)hemiLight.intensity=v;}));
 w.appendChild(reSlider('dir',rm.dir?rm.dir.int:0.8,0,2,0.01,
  v=>{if(rm.dir)rm.dir.int=v;if(typeof dirLight!=='undefined'&&dirLight)dirLight.intensity=v;}));
 w.appendChild(reSlider('exposure',(CONFIG.render&&CONFIG.render.exposure)||1,0.2,2.5,0.01,
  v=>{CONFIG.render.exposure=v;if(typeof applyToneMapping==='function')applyToneMapping(renderer,false);}));
 const tm=reEl('div','reRow');tm.appendChild(reEl('label',null,'tone'));
 const sel=document.createElement('select');
 ['aces','none','reinhard','cineon','linear'].forEach(k=>{const o=document.createElement('option');
  o.value=o.textContent=k;if((CONFIG.render&&CONFIG.render.toneMapping)===k)o.selected=true;sel.appendChild(o);});
 sel.onchange=()=>{CONFIG.render.toneMapping=sel.value;
  if(typeof applyToneMapping==='function')applyToneMapping(renderer,true);};   // true: define changed, recompile
 tm.appendChild(sel);w.appendChild(tm);
 /* per-fixture readout: what each baked light is actually delivering */
 const g=(typeof roomGroups!=='undefined')?roomGroups[id]:null;
 if(g){
  const ls=[];g.traverse(c=>{if(c.isLight)ls.push(c);});
  if(ls.length){
   const box=reEl('div','reList');box.id='reLightRead';
   w.appendChild(box);reditLightReadout();
  }
 }
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
}                          // slider mid-drag, since these fire on every 'input' event
/* Refresh just the per-fixture readout, in place. */
function reditLightReadout(){
 const box=document.getElementById('reLightRead');if(!box)return;
 const g=(typeof roomGroups!=='undefined')?roomGroups[reditRoomId()]:null;
 box.innerHTML='';
 if(!g)return;
 g.traverse(c=>{if(c.isLight)box.appendChild(reEl('div','reItem reMuted',
  (c.name||c.type)+'   '+c.intensity.toFixed(3)+(c.distance?'  @'+Math.round(c.distance):'')));});
}

/* --- picking + placing ---------------------------------------------------- */
/* Where the camera is looking, on the floor. New props land here rather than at the
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
 RE.sel={spec:specs.length-1,idx:0};
 reditApply();reditSync();
 if(typeof Au!=='undefined')Au.ui();
}
/* Click-select. An InstancedMesh reports instanceId, and instances are built in
   placement order — explicit `at` entries first, then the scatter (see
   propPlacements) — so an id below at.length maps straight back to a placement.
   Above it, the instance came from the generator and the SPEC is what to select. */
function reditPick(ev){
 if(!RE.on)return false;
 const id=reditRoomId(),g=(typeof propGroups!=='undefined')?propGroups[id]:null;
 if(!g||!g.children.length)return false;
 if(!RE.ray)RE.ray=new THREE.Raycaster();
 const r=renderer.domElement.getBoundingClientRect();
 const nx=((ev.clientX-r.left)/r.width)*2-1, ny=-((ev.clientY-r.top)/r.height)*2+1;
 RE.ray.setFromCamera({x:nx,y:ny},camera);
 const hits=RE.ray.intersectObjects(g.children,false);
 if(!hits.length){RE.sel=null;reditSync();reditHilite(null);return true;}
 const h=hits[0];
 const si=h.object.userData.specIndex;
 if(si===undefined||si===null){RE.sel=null;reditSync();return true;}
 const sp=reditSpecs()[si];
 const nAt=(sp&&sp.at)?sp.at.length:0;
 const iid=(h.instanceId===undefined||h.instanceId===null)?0:h.instanceId;
 RE.sel={spec:si,idx:(iid<nAt)?iid:null};
 reditSync();reditHilite(RE.sel);
 if(typeof Au!=='undefined')Au.ui();
 return true;
}
/* A wire box around the current selection. Cheap and unambiguous — a tint would fight
   the per-instance colours a crowd already uses. */
function reditHilite(sel){
 if(RE.box){scene.remove(RE.box);RE.box=null;}
 if(!sel||!RE.on)return;
 const id=reditRoomId(),g=(typeof propGroups!=='undefined')?propGroups[id]:null;
 if(!g)return;
 const specs=reditSpecs(),sp=specs[sel.spec];if(!sp)return;
 let pos=null;
 if(sel.idx!==null&&sp.at&&sp.at[sel.idx]){const a=sp.at[sel.idx];pos=new THREE.Vector3(a[0],a[1]||0,a[2]);}
 else if(sp.scatter&&sp.scatter.at)pos=new THREE.Vector3(sp.scatter.at[0],sp.scatter.at[1]||0,sp.scatter.at[2]);
 if(!pos)return;
 const s=12;
 RE.box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s,s,s)),
  new THREE.LineBasicMaterial({color:0x7fb0ff}));
 RE.box.position.copy(pos);RE.box.position.y+=s/2;
 RE.box.frustumCulled=false;scene.add(RE.box);
}

/* --- export / backup ------------------------------------------------------ */
/* Emits a paste-ready block for config.js. Numbers are rounded on the way out: an
   editor that writes 17.000000000000004 into a source file is a bad citizen. */
function reditJSON(){
 const rm=reditRoom();
 const r=n=>(typeof n==='number'&&isFinite(n))?+n.toFixed(3):n;
 const walk=v=>Array.isArray(v)?v.map(walk):
   (v&&typeof v==='object')?Object.keys(v).reduce((o,k)=>(o[k]=walk(v[k]),o),{}):r(v);
 const out={};
 if(rm.light&&Object.keys(rm.light).length)out.light=walk(rm.light);
 if(rm.hemi)out.hemi=walk(rm.hemi);
 if(rm.dir)out.dir=walk(rm.dir);
 if(rm.props&&rm.props.length)out.props=walk(rm.props);
 return JSON.stringify(out,null,1);
}
function reditSyncOut(){
 const w=document.getElementById('reOut');w.innerHTML='';
 w.appendChild(reEl('h4',null,'export'));
 const row=reEl('div','reRow');
 const b=reEl('button',null,'copy config block');
 b.onclick=()=>{
  const t=reditJSON();
  console.log('/* paste into CONFIG.rooms.'+reditRoomId()+' */\n'+t);
  if(navigator.clipboard&&navigator.clipboard.writeText)
   navigator.clipboard.writeText(t).then(()=>{if(typeof toast==='function')toast('ROOM EDITOR','config copied to clipboard',1.4);},
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
   if(bk.props)rm.props=bk.props;if(bk.light)rm.light=bk.light;
   RE.sel=null;reditApply();reditSync();
  }catch(e){console.warn('room backup restore failed',e);}
 };
 row.appendChild(rb);
 w.appendChild(row);
 w.appendChild(reEl('div','reMuted','Edits are in memory only — export to keep them.'));
}
/* Crash backup. Written on every change, restored ONLY by the button — an editor that
   silently resurrects old state over what config.js says is an editor you stop trusting. */
function reditBackup(){
 try{
  const all=JSON.parse(localStorage.getItem('fuzeball_roomedit')||'{}');
  const rm=reditRoom();
  all[reditRoomId()]={props:rm.props||[],light:rm.light||{}};
  localStorage.setItem('fuzeball_roomedit',JSON.stringify(all));
 }catch(e){}
}
/* --- per-frame ------------------------------------------------------------
   Self-heals like phTick: if the room changed under the panel (venue switch), retarget
   rather than editing a room that is no longer on screen. */
function reditTick(){
 if(!RE.on)return;
 if(RE.room!==reditRoomId()){RE.room=reditRoomId();RE.sel=null;
  if(RE.panel){RE.panel.querySelector('.reMuted').textContent='room: '+RE.room;}
  reditSync();}
}

/* --- bindings ------------------------------------------------------------
   Self-contained, like photo.js: this file owns its own listeners so a missing
   roomedit.js cannot break input. Capture phase on the pointer handler so a pick
   lands before input.js's canvas mousedown (which kicks a rod). */
addEventListener('keydown',e=>{
 const t=e.target,tn=t&&t.tagName;
 if(tn==='INPUT'||tn==='SELECT'||tn==='TEXTAREA')return;   // typing in the panel is not a shortcut
 if(e.code==='F2'){e.preventDefault();if(!e.repeat)reditToggle();return;}
 if(!RE.on)return;
 if(e.code==='Escape'){e.preventDefault();e.stopPropagation();reditExit();return;}   // input.js's Esc would backScreen() past the picker
 if(e.repeat)return;
 // nudge the selected placement; arrows are free here because free roam uses WASD
 const specs=reditSpecs(),sp=RE.sel&&specs[RE.sel.spec];
 if(!sp||RE.sel.idx===null||!sp.at||!sp.at[RE.sel.idx])return;
 const a=sp.at[RE.sel.idx],step=e.shiftKey?10:1;
 let hit=true;
 if(e.code==='ArrowLeft')a[0]-=step; else if(e.code==='ArrowRight')a[0]+=step;
 else if(e.code==='ArrowUp')a[2]-=step; else if(e.code==='ArrowDown')a[2]+=step;
 else if(e.code==='PageUp')a[1]=(a[1]||0)+step; else if(e.code==='PageDown')a[1]=(a[1]||0)-step;
 else if(e.code==='BracketLeft')a[3]=(a[3]||0)-0.1; else if(e.code==='BracketRight')a[3]=(a[3]||0)+0.1;
 else if(e.code==='Delete'){sp.at.splice(RE.sel.idx,1);RE.sel=null;reditApply();reditSync();return;}
 else hit=false;
 if(hit){e.preventDefault();reditApply();reditSyncSel();}
},true);
addEventListener('mousedown',e=>{
 if(!RE.on||e.button!==0)return;
 if(RE.panel&&RE.panel.contains(e.target))return;          // clicks in the panel are the panel's
 if(e.target!==renderer.domElement)return;
 if(reditPick(e)){e.preventDefault();e.stopPropagation();} // beat input.js's kick handler
},true);

/* --- the picker screen (#roomEdit) ---------------------------------------
   Reached from the home card (revealed only when CONFIG.debug.roomEditor is on) or F2.
   Its whole job is to answer "which room am I editing" BEFORE anything is applied, so
   the editor never inherits whichever venue the last match happened to leave behind. */
function reditRoomCount(id){
 const rm=CONFIG.rooms[id],n=(rm.props||[]).length;
 let inst=0;(rm.props||[]).forEach(sp=>{inst+=(sp.at?sp.at.length:0)+(sp.scatter?(sp.scatter.n|0):0);});
 return {specs:n,inst};
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
