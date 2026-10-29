// rod-zones harness. node tools/zones-harness.js
// slices the real zone lookup (seats.js), the auto-switch (input.js userControlUpdate), focusBall / autoHoldRod (ai.js) and the painter's pure helpers (debug.js) and runs them on live CONFIG
// question: does the auto-switch hand a seat the rod its zone names (defending / attacking map by possession, blue turned round, the held rod's margin, '.' and a rod it cannot have falling back to the nearest), do the shipped maps reproduce the old nearest-rod rule, does the keeper's hand-over follow the zones; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;if(to&&b<0)throw new Error('slice miss: '+to);return src.slice(a,b);};
const SE=rd('js/seats.js'),IN=rd('js/input.js'),AI=rd('js/ai.js'),DB=rd('js/debug.js');
const parts={
 zones:slice(SE,'const ZONE_CH=','const _seatCol='),
 seat:slice(SE,'function seatRod(s){','function seatForDev(tok){'),
 sw:slice(IN,"  if((cfg.auto||(S.tut&&S.tut.auto))&&S.phase==='play'&&S.time-S.lastSwitch>CTRL.autoDelay",' S.seats.forEach(s=>{const r=seatRod(s);if(r&&r.raiseKeep'),
 focus:slice(AI,'function focusBall(t){','function pickActiveRods('),
 hold:slice(AI,'function autoHoldRod(s,r,b){','const CVB=new Float64Array(6)'),
 dbg:slice(DB,'const DBG_ZCOL=','function buildZonePanel(){')
};
const stubs="var S={seats:[],balls:[],time:10,phase:'play',lastSwitch:-99,lastTouch:-1}; var rods=[]; var CH={clear:0,chips:0};"+
 "function clearRodAI(r){CH.clear++;} function rodInputRelease(r){} function updateChips(){CH.chips++;}";

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,Number,String,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.zones,g.seat,g.focus,g.hold,g.dbg,
  'function autoSwitch(){'+NL+g.sw+NL+'}',
  ';globalThis.X={S:S,cfg:cfg,CONFIG:CONFIG,CTRL:CTRL,F:F,CH:CH,autoSwitch:autoSwitch,zonePick:zonePick,zoneAt:zoneAt,zoneDef:zoneDef,autoHoldRod:autoHoldRod,'+
  'dbgZoneDab:dbgZoneDab,dbgZoneNearest:dbgZoneNearest,dbgZoneText:dbgZoneText,dbgZonePush:dbgZonePush,dbgZoneUndo:dbgZoneUndo,'+
  'setRods:function(a){rods=a;},setZ:function(v){dbgZone=v;}};'].join(NL),ctx);
 return ctx.X;
}

// every rod of the table from CONFIG.rods.defs: men centred on z 0 at the shipped spacing
function table(X){
 const R=X.CONFIG.rods,out=[];
 for(const d of R.defs){
  const n=d.men,sp=n===2?R.spacing.two:n===3?R.spacing.three:R.spacing.other,bz=[];
  for(let k=0;k<n;k++)bz.push((k-(n-1)/2)*sp);
  out.push({x:d.x,team:d.team,role:d.role,kickDir:d.team===0?1:-1,men:bz.map(()=>({})),baseZ:bz,offset:0,removedUntil:[],
   maxOff:d.role==='GK'?8:d.role==='DEF'?10:d.role==='MID'?5:9});
 }
 return out;
}
function seat(X,team,ctrlRole){
 const rr=X.T.filter(r=>r.team===team).sort((a,b)=>a.x-b.x);
 const s={team,rods:rr,ctrl:Math.max(0,rr.findIndex(r=>r.role===ctrlRole)),holdRod:null,holdT:0,padAngleArm:true,slideArm:0};
 return s;
}
function ball(X,x,z,vx,pinR){const b={scored:false,m:{position:{x,y:1.9,z}},v:{x:vx||0,y:0,z:0},pinR:pinR||null};X.S.balls=[b];return b;}
// one switch step for one seat; returns the role it holds after
function step(X,s){X.S.seats=X.S.seats.indexOf(s)<0?[s]:X.S.seats;X.autoSwitch();return s.rods[s.ctrl].role;}
// the old rule: the nearest rod along the table
function nearest(X,s,x){let bi=0,bd=1e9;s.rods.forEach((r,i)=>{const d=Math.abs(x-r.x);if(d<bd){bd=d;bi=i;}});return s.rods[bi].role;}
// paint (red's frame) every cell whose centre passes f(x,z) with letter c
function paint(X,lay,f,c){
 const m=X.CTRL.zones[lay],nz=m.length;
 for(let j=0;j<nz;j++){const nx=m[j].length;let s='';for(let i=0;i<nx;i++){const x=((i+.5)/nx-.5)*X.F.L,z=((j+.5)/nz-.5)*X.F.W;s+=f(x,z)?c:m[j][i];}m[j]=s;}
}
function fresh(X){
 const Z=X.CTRL.zones;
 X.T=table(X);X.setRods(X.T);
 X.S.seats=[];X.S.time=10;X.S.lastSwitch=-99;X.S.lastTouch=-1;X.cfg.auto=true;
 Z.on=true;Z.hyst=0;Z.closing=30;
 X.CTRL.handover.on=true;
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const Z=X.CTRL.zones,D0=Z.def.slice(),A0=Z.att.slice();
 const restore=()=>{Z.def.length=0;D0.forEach(r=>Z.def.push(r));Z.att.length=0;A0.forEach(r=>Z.att.push(r));};
 const reset=()=>{restore();fresh(X);};
 reset();
 // ---- the shipped maps ------------------------------------------------------------------------------
 {const m=D0.slice();X.dbgZoneNearest(m);ok('the shipped defending map is the old nearest-rod lines',m.every((r,j)=>r===D0[j]));
  const a=A0.slice();X.dbgZoneNearest(a);ok('…and so is the attacking map',a.every((r,j)=>r===A0[j]));
  ok('both maps are 48 x 28',D0.length===28&&A0.length===28&&D0.concat(A0).every(r=>r.length===48));}
 {let diff=0,n=0;
  for(const team of [0,1])for(const own of [0,1])for(let k=0;k<238;k++)for(const z of [-30,-9,0,14,31]){
   const x=-59.25+k*.5;fresh(X);X.S.lastTouch=own?team:1-team;
   const s=seat(X,team,'ATT');ball(X,x,z,0);const got=step(X,s);n++;if(got!==nearest(X,s,x))diff++;}
  ok('on the shipped maps the switch picks what the nearest-rod rule picks, both teams, both maps ('+n+' spots)',diff===0,diff+' differ');}
 // ---- possession picks the map ----------------------------------------------------------------------
 // the defending map gives the DEF everything up to 5 behind the opposing ATT (-22.5): their back-pinned ball at -19 is ours to defend
 reset();paint(X,'def',x=>x>=-45&&x<-17.5,'D');
 {const s=seat(X,0,'MID');X.S.lastTouch=1;ball(X,-19,0,0);ok('DEFENDING: a ball the other team touched last 3.5 behind their ATT goes to the DEF',step(X,s)==='DEF');}
 {const s=seat(X,0,'DEF');X.S.lastTouch=0;ball(X,-19,0,0);ok('ATTACKING: the same spot after our own touch goes to the MID (the attacking map is untouched)',step(X,s)==='MID');}
 {const s=seat(X,0,'MID');X.S.lastTouch=0;ball(X,-19,0,0,{team:1});ok('a ball pinned under their foot is theirs whoever touched it last',step(X,s)==='DEF');}
 {const s=seat(X,0,'MID');X.S.lastTouch=1;ball(X,-19,0,0,{team:0});ok('…and a ball under our own foot is ours',step(X,s)==='MID');}
 {const s=seat(X,0,'MID');X.S.lastTouch=0;ball(X,-19,0,-45);ok('our own ball running at our goal faster than closing reads the defending map',step(X,s)==='DEF');}
 {const s=seat(X,0,'MID');X.S.lastTouch=0;ball(X,-19,0,-20);ok('…slower than closing it stays on the attacking map',step(X,s)==='MID');}
 {const s=seat(X,0,'MID');X.S.lastTouch=0;ball(X,-19,0,45);ok('…and one running away from our goal is ours',step(X,s)==='MID');}
 {const s=seat(X,0,'MID');X.S.lastTouch=-1;ball(X,-19,0,0);ok('nobody has touched it yet: the defending map',step(X,s)==='DEF');}
 {X.S.lastTouch=1;const s=seat(X,0,'MID');Z.on=false;ball(X,-19,0,0);ok('zones off: the nearest rod, whatever is painted',step(X,s)==='MID');Z.on=true;}
 // ---- the keeper's wide corners, and blue turned round ----------------------------------------------
 reset();X.S.lastTouch=1;
 paint(X,'def',(x,z)=>x<-45&&z<-12,'D');   // the top corner only, so blue's turn is checked in z too
 {const s=seat(X,0,'GK');ball(X,-50,-25,0);ok('a wide ball by our goal in a DEF cell goes to the DEF, not the keeper',step(X,s)==='DEF');}
 {const s=seat(X,0,'DEF');ball(X,-50,3,0);ok('…a central one stays the keeper\'s',step(X,s)==='GK');}
 {const s=seat(X,0,'DEF');ball(X,-50,25,0);ok('…and the unpainted bottom corner is still the keeper\'s',step(X,s)==='GK');}
 X.S.lastTouch=0;
 {const s=seat(X,1,'GK');ball(X,50,25,0);ok('BLUE reads the map turned round: the same corner seen from its end (x +50, z +25) is its DEF\'s',step(X,s)==='DEF');}
 {const s=seat(X,1,'DEF');ball(X,50,-25,0);ok('BLUE: the other corner (z -25) is its keeper\'s',step(X,s)==='GK');}
 {const s=seat(X,1,'DEF');ball(X,-50,-25,0);ok('BLUE: red\'s painted corner is at blue\'s far end, its ATT\'s',step(X,s)==='ATT');}
 {const s=seat(X,0,'DEF');X.S.lastTouch=1;ball(X,-62,0,0);ok('a ball in the goal mouth (past the last column) reads the edge cell',step(X,s)==='GK');}
 // ---- a cell that names nothing, a rod the seat cannot take -----------------------------------------
 reset();X.S.lastTouch=1;paint(X,'def',x=>x>=-45&&x<-17.5,'D');paint(X,'def',x=>x>=-20&&x<-17.5,'.');
 {const s=seat(X,0,'GK');ball(X,-19,0,0);ok("a '.' cell falls back to the nearest rod (the MID at -19, inside a DEF band)",step(X,s)==='MID');}
 reset();X.S.lastTouch=1;paint(X,'def',x=>x>=-45&&x<-17.5,'D');
 {const a=seat(X,0,'GK'),b=seat(X,0,'DEF');X.S.seats=[a,b];ball(X,-19,0,0);X.autoSwitch();
  ok('co-op: the zone rod a teammate holds is skipped (the nearest of the rest)',a.rods[a.ctrl].role==='MID',a.rods[a.ctrl].role);
  ok('…and the teammate keeps it',b.rods[b.ctrl].role==='DEF');}
 {const s=seat(X,0,'MID');s.rods=s.rods.filter(r=>r.role!=='DEF');s.ctrl=s.rods.findIndex(r=>r.role==='GK');ball(X,-19,0,0);
  ok('a seat without the zone\'s rod takes the nearest of its own',step(X,s)==='MID');}
 // ---- the hold margin -------------------------------------------------------------------------------
 reset();X.S.lastTouch=1;Z.hyst=2;
 {const s=seat(X,0,'DEF');ball(X,-21.5,0,0);ok('margin 2: a ball 1 into the MID\'s zone stays with the DEF you hold',step(X,s)==='DEF');}
 paint(X,'def',()=>true,'M');paint(X,'def',(x,z)=>x<-30&&z<-10,'D');   // a DEF corner only a diagonal sample of the margin reaches
 {const s=seat(X,0,'DEF');ball(X,-28.7,-8.4,0);ok('…across a corner too (the margin is a ring, not a cross)',step(X,s)==='DEF');}
 {const s=seat(X,0,'DEF');Z.hyst=0;ball(X,-28.7,-8.4,0);ok('…which is the MID\'s with no margin',step(X,s)==='MID');Z.hyst=2;}
 restore();
 {const s=seat(X,0,'DEF');ball(X,-19.5,0,0);ok('…3 in, it goes to the MID',step(X,s)==='MID');}
 {const s=seat(X,0,'ATT');ball(X,-21.5,0,0);ok('the margin is only the held rod\'s: from the ATT the same ball goes to the MID',step(X,s)==='MID');}
 Z.hyst=0;
 {const s=seat(X,0,'DEF');ball(X,-21.5,0,0);ok('margin 0: 1 in is the MID\'s',step(X,s)==='MID');}
 {const s=seat(X,0,'DEF');X.S.lastSwitch=X.S.time-.5;ball(X,-10,0,0);ok('no auto switch inside autoDelay of a manual one',step(X,s)==='DEF');}
 // ---- the keeper's hand-over follows the zones ------------------------------------------------------
 reset();X.S.lastTouch=1;paint(X,'def',(x,z)=>x<-45&&Math.abs(z)>=6,'D');
 {const s=seat(X,0,'DEF');X.S.seats=[s];ball(X,-50,7,-120);
  X.autoSwitch();ok('a shot at a cell the zones give the DEF never withholds the keeper',s.holdRod===null&&s.rods[s.ctrl].role==='DEF',String(s.holdRod&&s.holdRod.role));}
 reset();X.S.lastTouch=1;paint(X,'def',x=>x>=-45&&x<-42.5,'G');
 {const s=seat(X,0,'MID');X.S.seats=[s];ball(X,-44,0,-120);X.autoSwitch();
  ok('a shot into a GK cell the nearest rule gives the DEF withholds the keeper (you get the DEF meanwhile)',s.holdRod&&s.holdRod.role==='GK'&&s.rods[s.ctrl].role==='DEF',(s.holdRod&&s.holdRod.role)+' / '+s.rods[s.ctrl].role);
  X.S.time+=X.CTRL.handover.maxHold+.1;X.autoSwitch();ok('…until maxHold, then the keeper is yours',s.rods[s.ctrl].role==='GK');}
 // ---- the painter's helpers -------------------------------------------------------------------------
 reset();
 {Z.hyst=2.25;Z.closing=40;paint(X,'att',x=>x>30,'.');
  const o=vm.runInNewContext('({'+X.dbgZoneText()+'})').zones;
  ok('COPY is the zones block config.js reads back exactly',o.on===Z.on&&o.hyst===2.25&&o.closing===40&&JSON.stringify(o.def)===JSON.stringify(Z.def)&&JSON.stringify(o.att)===JSON.stringify(Z.att));
  ok('…laid out like config.js',X.dbgZoneText().split(NL)[0]==='  zones:{'&&/^   hyst:2\.25, +\/\/ /.test(X.dbgZoneText().split(NL)[2]));}
 reset();
 {const st={lay:'def',brush:'M',size:3,mirror:true,undo:[],dirty:false};X.setZ(st);
  X.dbgZoneDab(10,2);const m=Z.def,nz=m.length;
  ok('a size-3 dab paints a 3 x 3 block',[1,2,3].every(j=>m[j].slice(9,12)==='MMM')&&m[0][10]!=='M'&&m[2][12]!=='M');
  ok('…and its mirror across the width',[nz-2,nz-3,nz-4].every(j=>m[j].slice(9,12)==='MMM')&&m[nz-1][10]!=='M');
  X.dbgZoneDab(0,0);ok('a dab at the edge is clipped, no row grows',m.every(r=>r.length===48)&&m.length===28&&m[0][0]==='M');
  restore();st.lay='att';X.dbgZonePush();X.dbgZoneNearest(Z.def);paint(X,'att',()=>true,'A');paint(X,'def',()=>true,'G');X.dbgZoneUndo();
  ok('undo puts both maps back',Z.def.every((r,j)=>r===D0[j])&&Z.att.every((r,j)=>r===A0[j]));}
 reset();
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUT=[
 {name:'blue does not turn the map round in z',part:'zones',from:'if(t===1){x=-x;z=-z;}',to:'if(t===1){x=-x;}'},
 {name:'blue does not turn the map round in x',part:'zones',from:'if(t===1){x=-x;z=-z;}',to:'if(t===1){z=-z;}'},
 {name:'a ball under a foot is judged by the last touch only',part:'zones',from:'b.pinR?b.pinR.team:S.lastTouch',to:'S.lastTouch'},
 {name:'a fast ball at our goal does not read the defending map',part:'zones',from:'||-b.v.x*(s.team===0?1:-1)>CTRL.zones.closing',to:''},
 {name:'closing reads the ball running away from our goal',part:'zones',from:'-b.v.x*(s.team===0?1:-1)',to:'b.v.x*(s.team===0?1:-1)'},
 {name:'the maps are swapped',part:'zones',from:'zoneDef(s,b)?Z.def:Z.att',to:'zoneDef(s,b)?Z.att:Z.def'},
 {name:'zones.on is ignored',part:'zones',from:'if(!Z||!Z.on||!s||!b)return -1;',to:'if(!Z||!s||!b)return -1;'},
 {name:'no hold margin',part:'zones',from:'if(cc&&zoneNear(',to:'if(false&&zoneNear('},
 {name:'the margin is only the ball\'s own cell',part:'zones',from:'if(!(h>0))return false;',to:'return false;'},
 {name:'the margin samples only along the table',part:'zones',from:"[1,0],[-1,0],[0,1],[0,-1],[.71,.71],[-.71,.71],[.71,-.71],[-.71,-.71]",to:"[1,0],[-1,0]"},
 {name:'the zone pick is never used',part:'sw',from:'if(zok)bi=zi;',to:''},
 {name:'the zone rod is taken even when a teammate holds it',part:'sw',from:'     if(autoHoldRod(s,rr,fb)||rodTaken(rr,s))return;'+NL+'     if(i===zi)zok=true;',to:'     if(i===zi)zok=true;'+NL+'     if(autoHoldRod(s,rr,fb)||rodTaken(rr,s))return;'},
 {name:'autoDelay is ignored',part:'sw',from:'&&S.time-S.lastSwitch>CTRL.autoDelay',to:''},
 {name:'the keeper hand-over ignores the zones',part:'hold',from:'const zi=zonePick(s,b);',to:'const zi=-1;'},
 {name:'the painter\'s nearest rule reads blue\'s rods',part:'dbg',from:'rods.filter(r=>r.team===0)',to:'rods.filter(r=>r.team===1)'},
 {name:'the dab does not mirror',part:'dbg',from:'if(Z.mirror)dbgZoneSet(m,i+a,m.length-1-jj,Z.brush);',to:''},
 {name:'COPY prints the wrong closing',part:'dbg',from:"'closing:'+Math.round(Z.closing)",to:"'closing:'+Math.round(Z.hyst)"},
 {name:'undo restores only the defending map',part:'dbg',from:'dbgZonePut(CTRL.zones.att,u.att);',to:''}
];
let missed=0;
for(const m of MUT){
 const res=suite(boot(m)),failed=res.filter(t=>!t.ok);
 if(failed.length){console.log('  caught  ('+failed.length+' assertions)  '+m.name);}
 else{missed++;console.log('  MISSED  '+m.name);}
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
