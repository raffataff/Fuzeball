/* Behavioural harness for the room editor's NON-DOM logic (js/roomedit.js).
   The panel and the picking are interactive and can only be checked in a browser; what
   IS testable here is the part with a real correctness risk — the venue stash/restore.
   Getting that wrong means opening a room in the editor silently becomes the player's
   permanent Kick Off setting, which is the exact trap league.js documents for divisions.
   Run: node tools/roomedit-harness.js                                                 */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/roomedit.js'),'utf8');

function sliceFn(name){
 const s=SRC.indexOf('function '+name+'(');
 if(s<0)throw new Error('not found: '+name);
 let d=0;
 for(let j=SRC.indexOf('{',s);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return SRC.slice(s,j+1);}}
 throw new Error('unbalanced: '+name);
}
function sliceOnHide(){
 const k='SCREENS.roomEdit.onHide=function(){';
 const s=SRC.indexOf(k);
 if(s<0)throw new Error('onHide assignment not found');
 let d=0;
 for(let j=SRC.indexOf('{',s+k.length-1);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return 'function onHide()'+SRC.slice(SRC.indexOf('{',s+k.length-1),j+1);}}
 throw new Error('unbalanced onHide');
}
const S_COUNT=sliceFn('reditRoomCount'), S_OPEN=sliceFn('reditOpenRoom'), S_HIDE=sliceOnHide();

let pass=0,fail=0;const fails=[];
function ok(c,m,x){if(c)pass++;else{fail++;fails.push(m+(x!==undefined?'  ['+x+']':''));}}

/* Rebuild the three against a recording world. RE/cfg/CONFIG are real objects so the
   stash/restore is exercised for real; applyRoom/applyTable/hideScreens just record. */
function world(rooms,startRoom,startTable){
 const log=[];
 const CONFIG={rooms,tables:{classic:{name:'Classic'},arena:{name:'Arena'}},debug:{roomEditor:true}};
 const cfg={room:startRoom,table:startTable};
 const RE={on:false,prev:null,panel:null,sel:null};
 const ctx={CONFIG,cfg,RE,S:{phase:'menu',freeRoam:false,redit:null},
  applyRoom:()=>log.push('applyRoom:'+cfg.room),
  applyTable:()=>log.push('applyTable:'+cfg.table),
  hideScreens:()=>log.push('hideScreens'),
  showScreen:id=>log.push('showScreen:'+id),
  reditEnter:()=>{RE.on=true;log.push('enter');},
  reditExit:()=>{RE.on=false;log.push('exit');},
  log};
 const f=new Function('CONFIG','cfg','RE','S','applyRoom','applyTable','hideScreens','showScreen',
  'reditEnter','reditExit',
  S_COUNT+'\n'+S_OPEN+'\n'+S_HIDE+'\nreturn {reditRoomCount,reditOpenRoom,onHide};');
 ctx.fn=f(CONFIG,cfg,RE,ctx.S,ctx.applyRoom,ctx.applyTable,ctx.hideScreens,ctx.showScreen,
  ctx.reditEnter,ctx.reditExit);
 return ctx;
}
const ROOMS={
 open:{name:'Void',backdrop:false},
 pub:{name:'British Pub',glb:'p.glb',light:{gain:3},
  props:[{prop:'stool',at:[[1,0,1],[2,0,2]]},{prop:'crowd',scatter:{kind:'ring',n:40}}]},
 saucer:{name:'Flying Saucer',glb:'s.glb',light:{gain:0.8}}
};

/* === 1. prop counting for the picker cards ================================ */
{
 const w=world(ROOMS,'open','classic');
 const c=w.fn.reditRoomCount('pub');
 ok(c.specs===2,'COUNT: spec count',c.specs);
 ok(c.inst===42,'COUNT: explicit placements + scatter n (2 + 40)',c.inst);
 const z=w.fn.reditRoomCount('open');
 ok(z.specs===0&&z.inst===0,'COUNT: a room with no props counts zero, no throw');
}

/* === 2. THE INVARIANT: opening a room must not change the player's settings = */
{
 const w=world(ROOMS,'arcade','classic');
 w.fn.reditOpenRoom('pub');
 ok(w.cfg.room==='pub','OPEN: the chosen room is applied');
 ok(w.RE.prev&&w.RE.prev.room==='arcade','OPEN: the player\'s room is stashed',JSON.stringify(w.RE.prev));
 ok(w.log.indexOf('hideScreens')>=0,'OPEN: menu screens are cleared off the canvas');
 ok(w.log.indexOf('enter')>=0,'OPEN: the editor is entered');
 ok(w.log.indexOf('applyRoom:pub')>=0,'OPEN: applyRoom ran for the chosen room');
 w.fn.onHide();
 ok(w.cfg.room==='arcade','RESTORE: leaving the editor area puts the player\'s room BACK',w.cfg.room);
 ok(w.cfg.table==='classic','RESTORE: table restored too');
 ok(w.RE.prev===null,'RESTORE: the stash is cleared so a second visit re-arms it');
}

/* === 3. picking several rooms must not lose the ORIGINAL ================== */
{
 const w=world(ROOMS,'open','classic');
 w.fn.reditOpenRoom('pub');
 w.fn.reditOpenRoom('saucer');
 w.fn.reditOpenRoom('pub');
 ok(w.RE.prev.room==='open','MULTI: the stash still holds the ORIGINAL room, not the last one',w.RE.prev.room);
 w.fn.onHide();
 ok(w.cfg.room==='open','MULTI: restore returns the original after several picks',w.cfg.room);
}

/* === 4. restore is conditional — no pointless rebuilds ==================== */
{
 const w=world(ROOMS,'pub','classic');
 w.fn.reditOpenRoom('pub');            // same room the player already had
 w.log.length=0;
 w.fn.onHide();
 ok(w.log.indexOf('applyRoom:pub')<0,'RESTORE: unchanged room does not re-apply');
 ok(w.log.indexOf('applyTable:classic')<0,'RESTORE: unchanged table does not re-apply');
}
{
 const w=world(ROOMS,'open','classic');
 w.fn.reditOpenRoom('saucer');
 w.cfg.table='arena';                  // as if the picker's table select was used
 w.log.length=0;
 w.fn.onHide();
 ok(w.log.indexOf('applyTable:classic')>=0,'RESTORE: a changed table IS re-applied');
 ok(w.log.indexOf('applyRoom:open')>=0,'RESTORE: a changed room IS re-applied');
 ok(w.log.indexOf('applyTable:classic')<w.log.indexOf('applyRoom:open'),
    'RESTORE: table before room — applyRoom re-parents the pitch into the live table group');
}

/* === 5. leaving while the editor is still open tears it down ============== */
{
 const w=world(ROOMS,'open','classic');
 w.fn.reditOpenRoom('pub');
 ok(w.RE.on===true,'TEARDOWN: editor is open');
 w.fn.onHide();
 ok(w.log.indexOf('exit')>=0,'TEARDOWN: navigating away exits the editor first');
 ok(w.cfg.room==='open','TEARDOWN: ...and still restores');
}
{
 const w=world(ROOMS,'open','classic');
 w.fn.onHide();                         // never opened anything
 ok(w.cfg.room==='open','TEARDOWN: onHide with nothing stashed is a no-op');
 ok(w.log.length===0,'TEARDOWN: ...and touches nothing');
}
{
 const w=world(ROOMS,'open','classic');
 w.fn.reditOpenRoom('nosuchroom');
 ok(w.cfg.room==='open','GUARD: an unknown room id is refused');
 ok(w.RE.prev===null,'GUARD: ...and does not arm the restore');
}

/* === 6. TEETH ============================================================= */
function mutate(label,open,hide,probe){
 let broke=false,note='';
 try{
  const log=[];
  const CONFIG={rooms:ROOMS,tables:{classic:{},arena:{}},debug:{roomEditor:true}};
  const cfg={room:'open',table:'classic'};
  const RE={on:false,prev:null};
  const S={phase:'menu',freeRoam:false,redit:null};
  const fn=new Function('CONFIG','cfg','RE','S','applyRoom','applyTable','hideScreens','showScreen',
   'reditEnter','reditExit',
   S_COUNT+'\n'+open+'\n'+hide+'\nreturn {reditOpenRoom,onHide};')(
   CONFIG,cfg,RE,S,()=>log.push('applyRoom:'+cfg.room),()=>log.push('applyTable:'+cfg.table),
   ()=>log.push('hideScreens'),id=>log.push('showScreen:'+id),
   ()=>{RE.on=true;},()=>{RE.on=false;});
  broke=probe(fn,cfg,RE,log);
 }catch(e){broke=true;note=' (threw: '+e.message.slice(0,40)+')';}
 ok(broke,'TEETH: '+label+' must fail an assertion'+note);
}
// stashing on EVERY pick loses the original — the classic version of this bug
mutate('re-stashing on every pick',
 S_OPEN.replace('if(!RE.prev)RE.prev={room:cfg.room,table:cfg.table};','RE.prev={room:cfg.room,table:cfg.table};'),
 S_HIDE,
 (fn,cfg)=>{fn.reditOpenRoom('pub');fn.reditOpenRoom('saucer');fn.onHide();return cfg.room!=='open';});
// no restore at all — the room the editor opened becomes the player's setting
mutate('dropping the restore entirely',
 S_OPEN, S_HIDE.replace('cfg.room=p.room;cfg.table=p.table;',''),
 (fn,cfg)=>{fn.reditOpenRoom('pub');fn.onHide();return cfg.room!=='open';});
// not clearing the stash: a second visit restores stale state
mutate('not clearing the stash after restoring',
 S_OPEN, S_HIDE.replace('const p=RE.prev;RE.prev=null;','const p=RE.prev;'),
 (fn,cfg,RE)=>{fn.reditOpenRoom('pub');fn.onHide();return RE.prev!==null;});

console.log('\nroomedit harness: '+pass+' passed, '+fail+' failed');
if(fail){console.log('\nFAILURES:');fails.forEach(f=>console.log('  x '+f));process.exit(1);}
console.log('all assertions passed (incl. 3 mutation checks)');
