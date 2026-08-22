/* Behavioural harness for the two things the room-editor lighting work added that a
   browser is NOT needed to check, and that would fail SILENTLY if they broke.

     1. THE EXPORT. It claims to emit a paste-ready CONFIG.rooms block. The only honest
        test of that claim is to PARSE the emitted text back and compare it to the room it
        came from — a format that is merely close enough to look right is the failure mode
        here, and it costs you a room's worth of work when you paste it.
     2. THE AUTHORED-LIGHT POOL (js/world.js). Its whole reason to exist is that the
        scene's light COUNT never changes, so the assertions are about counts and about
        re-driving being idempotent, not about pixels.

   Run: node tools/roomlights-harness.js                                                */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const RED=fs.readFileSync(path.join(ROOT,'js/roomedit.js'),'utf8');
const WLD=fs.readFileSync(path.join(ROOT,'js/world.js'),'utf8');

function sliceFrom(SRC,name){
 const s=SRC.indexOf('function '+name+'(');
 if(s<0)throw new Error('not found: '+name);
 let d=0;
 for(let j=SRC.indexOf('{',s);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return SRC.slice(s,j+1);}}
 throw new Error('unbalanced: '+name);
}
function sliceConst(SRC,name){
 const k='const '+name+'=';
 const s=SRC.indexOf(k);
 if(s<0)throw new Error('const not found: '+name);
 const e=SRC.indexOf(';',s);
 return SRC.slice(s,e+1);
}
let pass=0,fail=0;const fails=[];
function ok(c,m,x){if(c)pass++;else{fail++;fails.push(m+(x!==undefined?'  ['+x+']':''));}}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}

/* === the export ========================================================== */
const EXPORT_SRC=[sliceConst(RED,'RE_HEXKEY'),sliceFrom(RED,'reHex'),sliceFrom(RED,'reFmtNum'),
 sliceFrom(RED,'reFmt'),sliceFrom(RED,'reFmtKV'),sliceFrom(RED,'reditPropsBlock'),
 sliceFrom(RED,'reditLightsBlock'),sliceFrom(RED,'reditBlock')].join('\n');
function exporter(rooms,id){
 const CONFIG={rooms:rooms};
 const cfg={room:id};
 const f=new Function('CONFIG','cfg',
  'function reditRoomId(){return CONFIG.rooms[cfg.room]?cfg.room:"open";}\n'+
  'function reditRoom(){return CONFIG.rooms[reditRoomId()];}\n'+
  EXPORT_SRC+'\nreturn {reditBlock,reFmt,reFmtNum,reHex};');
 return f(CONFIG,cfg);
}
/* Every shape a real room actually uses, plus the awkward ones on purpose. */
const PUB={
 name:'British Pub', folder:'assets/rooms/pub/', glb:'fuzeball_room_pub.glb', reflect:true,
 light:{gain:3},
 lightsOff:['room_light_fire'],
 bg:0x120c07, fog:[190,410],
 hemi:{sky:0xffd9a3,ground:0x140a04,int:1.17},
 dir:{color:0xffcf95,int:0.81,pos:[40,90,30]},
 env:{shell:0x1a1108,panels:[[0xffa94d,-240,40,-100,260,140],[0xffe6c0,0,150,0,160,160]]},
 lights:[{type:'spot',pos:[0,97,0],look:[0,0,0],color:0xffd9a3,int:1.845,dist:291,decay:2,angle:0.55,penumbra:0.4},
         {type:'point',pos:[-120.5,60,88.25],color:0xffb454,int:0.118,dist:806,decay:2}],
 props:[{prop:'stool',at:[[12,0,30,0,1],[-12,0,30,0,1],[40,0,-22,1.2,0.9]]},
        {prop:'chair',at:[[3,0,3,0,1]],scatter:{kind:'ring',n:40,r:150,face:'in'},
         jitter:{x:2,z:2},scaleVar:0.12,tint:[0x884422,0x226644],seed:7}],
 led:{idle:'rainbow',color:0xffb454}
};
const MIN={name:'Void', backdrop:false, bg:0x05060f, fog:[210,440], lights:[], props:[]};
{
 const X=exporter({pub:PUB,open:MIN},'pub');
 const txt=X.reditBlock();
 ok(/^   pub:\{/.test(txt),'EXPORT: opens with the room id, at config.js indent',txt.split('\n')[0]);
 ok(/\n   \},$/.test(txt),'EXPORT: closes with a trailing comma, ready to sit in the rooms map');
 ok(txt.indexOf('0x120c07')>=0,'EXPORT: bg is 0x hex, not a decimal nobody can read');
 ok(txt.indexOf('0xffd9a3')>=0,'EXPORT: nested colour keys (hemi.sky) are hex too');
 ok(txt.indexOf('0xffa94d')>=0,'EXPORT: env.panels keeps its leading colour as hex');
 ok(txt.indexOf('0x884422')>=0,'EXPORT: a tint palette is hex');
 ok(!/"/.test(txt),'EXPORT: single quotes only — config.js does not use double quotes');
 ok(!/\bnull\b/.test(txt),'EXPORT: no stray nulls');
 // THE REAL TEST: does it parse back to the same room?
 let back=null,err=null;
 try{back=(new Function('return {'+txt.replace(/,\s*$/,'')+'};'))();}catch(e){err=e.message;}
 ok(back&&back.pub,'EXPORT: the emitted block is valid JS and parses back',err);
 if(back&&back.pub){
  const r=back.pub;
  ok(r.name===PUB.name&&r.folder===PUB.folder&&r.glb===PUB.glb,'ROUND TRIP: identity keys survive');
  ok(r.reflect===true,'ROUND TRIP: booleans survive');
  ok(r.bg===PUB.bg,'ROUND TRIP: bg is the SAME NUMBER after the hex round trip',r.bg);
  ok(eq(r.fog,PUB.fog),'ROUND TRIP: fog array');
  ok(eq(r.hemi,PUB.hemi),'ROUND TRIP: hemi object',JSON.stringify(r.hemi));
  ok(eq(r.dir,PUB.dir),'ROUND TRIP: dir object incl. pos');
  ok(eq(r.env,PUB.env),'ROUND TRIP: env incl. the nested panel arrays',JSON.stringify(r.env));
  ok(eq(r.lights,PUB.lights),'ROUND TRIP: authored lights, every field',JSON.stringify(r.lights));
  ok(eq(r.lightsOff,PUB.lightsOff),'ROUND TRIP: lightsOff names');
  ok(eq(r.props,PUB.props),'ROUND TRIP: props incl. scatter, jitter, tint, seed',JSON.stringify(r.props));
  ok(eq(r.led,PUB.led),'ROUND TRIP: led block');
  ok(eq(Object.keys(r).filter(k=>PUB[k]===undefined),[]),'ROUND TRIP: no key invented that was not there');
  ok(eq(Object.keys(PUB).filter(k=>r[k]===undefined),[]),'ROUND TRIP: no key dropped',
     Object.keys(PUB).filter(k=>r[k]===undefined).join(','));
 }
}

/* Key ORDER matters as much as key presence: the whole point is that a pasted block reads
   like the ones around it, so a diff shows what changed rather than a reshuffle. */
{
 const X=exporter({pub:PUB},'pub');
 const txt=X.reditBlock();
 const at=k=>txt.indexOf('\n      '+k+':')>=0?txt.indexOf('\n      '+k+':'):txt.indexOf(k+':');
 const seq=['name','light','lightsOff','bg','hemi','dir','env','lights','props','led'].map(at);
 let sorted=true;for(let i=1;i<seq.length;i++)if(seq[i]<seq[i-1])sorted=false;
 ok(sorted,'ORDER: keys are emitted in CONFIG.rooms order',seq.join(','));
 ok(txt.split('\n').filter(l=>/^      /.test(l)||/^       /.test(l)||/^        /.test(l)).length>0,
   'ORDER: body lines sit at the 6-space indent config.js uses');
}
/* A room with nothing in it must still emit a legal, complete block. */
{
 const X=exporter({open:MIN},'open');
 const txt=X.reditBlock();
 ok(txt.indexOf('lights:[],')>=0,'EMPTY: an empty lights list is emitted, not omitted');
 // props is the LAST key in this room (it has no led), so it correctly carries no comma.
 ok(txt.indexOf('props:[]')>=0,'EMPTY: an empty props list is emitted, not omitted',txt.slice(-40));
 ok(txt.indexOf('backdrop:false')>=0,'EMPTY: backdrop:false survives (it is not a missing key)');
 let back=null;try{back=(new Function('return {'+txt.replace(/,\s*$/,'')+'};'))();}catch(e){}
 ok(back&&back.open&&back.open.backdrop===false,'EMPTY: parses back');
 // led is the LAST key, so the room with no led must not leave a dangling comma
 ok(!/,\s*\n   \},$/.test(txt),'EMPTY: no dangling comma before the closing brace');
}
/* Numbers. An editor writing float noise into a source file is a bad citizen, and a
   -0 in a config is a diff nobody can explain. */
{
 const X=exporter({open:MIN},'open');
 ok(X.reFmtNum(17.000000000000004)==='17','NUM: float noise is rounded away',X.reFmtNum(17.000000000000004));
 ok(X.reFmtNum(-0)==='0','NUM: negative zero is normalised',X.reFmtNum(-0));
 ok(X.reFmtNum(1.23456)==='1.235','NUM: 3dp',X.reFmtNum(1.23456));
 ok(X.reFmtNum(NaN)==='0'&&X.reFmtNum(Infinity)==='0','NUM: non-finite cannot reach the file');
 // A dim light rounded to 3dp exports as 0 — the paste then switches it OFF, and the room
 // comes back darker than the one that was tuned. Small magnitudes must keep their places.
 ok(X.reFmtNum(0.0004)!=='0','NUM: a dim intensity does not round to zero',X.reFmtNum(0.0004));
 ok(parseFloat(X.reFmtNum(0.0004))===0.0004,'NUM: ...and keeps its value',X.reFmtNum(0.0004));
 ok(X.reFmtNum(0)==='0','NUM: a real zero is still zero');
 ok(X.reFmtNum(1.2345678)==='1.235','NUM: ordinary magnitudes stay at 3dp',X.reFmtNum(1.2345678));
 ok(X.reHex(0x00ff00)==='0x00ff00','HEX: zero-padded to 6',X.reHex(0x00ff00));
 ok(X.reHex(0)==='0x000000','HEX: black is not 0x0',X.reHex(0));
 ok(X.reFmt('name',"O'Brien's Bar").indexOf("\'")>=0,'STR: an apostrophe in a room name is escaped',
    X.reFmt('name',"O'Brien's Bar"));
 let v=null;try{v=(new Function('return '+X.reFmt('name',"O'Brien's Bar")))();}catch(e){}
 ok(v==="O'Brien's Bar",'STR: ...and survives the round trip',v);
}

/* === the authored-light pool (js/world.js) ================================ */
const POOL_SRC=[sliceConst(WLD,'roomLightPool'),sliceFrom(WLD,'rlpNeed'),sliceFrom(WLD,'rlpType'),
 sliceFrom(WLD,'buildRoomLightPool'),sliceFrom(WLD,'rlpAdd'),sliceFrom(WLD,'rlpGet'),
 sliceFrom(WLD,'rlpFreeAll'),sliceFrom(WLD,'applyAuthoredLights')].join('\n');
function pool(rooms,editorOn,padOverride){
 const added=[];
 const mkTarget=()=>({position:{x:0,y:0,z:0,set(a,b,c){this.x=a;this.y=b;this.z=c;}},updateMatrixWorld(){}});
 const light=t=>({_t:t,visible:false,intensity:-1,castShadow:true,decay:0,distance:0,angle:0,penumbra:0,
  color:{_v:null,set(v){this._v=v;}},
  position:{x:0,y:0,z:0,set(a,b,c){this.x=a;this.y=b;this.z=c;}},
  target:(t==='point')?null:mkTarget()});
 const THREE={PointLight:function(){return light('point');},
  SpotLight:function(){return light('spot');},
  DirectionalLight:function(){return light('dir');}};
 const CONFIG={rooms:rooms,debug:{roomEditor:editorOn},
  render:{roomLightPool:padOverride===undefined?{pad:{point:4,spot:3,dir:1},max:12}:padOverride}};
 const scene={add(o){added.push(o);}};
 const warn=[];
 const f=new Function('CONFIG','THREE','scene','console',
  POOL_SRC+'\nreturn {roomLightPool,rlpNeed,buildRoomLightPool,applyAuthoredLights,rlpType};');
 const api=f(CONFIG,new Proxy(THREE,{get:(t,k)=>t[k]||function(){return light('point');}}),scene,
  {log(){},warn(m){warn.push(m);}});
 return Object.assign(api,{added:added,warn:warn,CONFIG:CONFIG});
}
const R_LIGHTS={
 pub:{lights:[{type:'spot'},{type:'point'},{type:'point'},{type:'point'},{type:'point'}]},
 // saucer deliberately carries POINT lights too, so the per-room MAX (4, from pub) differs
 // from the SUM (6) — without that the sum-vs-max mutation below has nothing to catch.
 saucer:{lights:[{type:'spot'},{type:'spot'},{type:'dir'},{type:'point'},{type:'point'}]},
 open:{lights:[]},
 arcade:{}
};
{
 /* SIZED FROM THE CONFIG: the per-type MAX across rooms, not the sum. A pool sized by the
    sum would allocate 9 point lights to serve a room that never shows more than 4. */
 const p=pool(R_LIGHTS,false);
 const n=p.rlpNeed();
 ok(n.point===4,'POOL: point slots = the heaviest single room (4), not the sum (6)',n.point);
 ok(n.spot===2,'POOL: spot slots = the heaviest single room (2)',n.spot);
 ok(n.dir===1,'POOL: dir slots',n.dir);
}
{
 /* Editor headroom is paid for ONLY by a build with the editor on — a shipping player
    must not carry six spare lights per type for a dev tool they cannot open. */
 const off=pool(R_LIGHTS,false).rlpNeed(), on=pool(R_LIGHTS,true).rlpNeed();
 ok(on.point===off.point+4&&on.spot===off.spot+3&&on.dir===off.dir+1,
   'POOL: the editor adds pad slots, PER TYPE',JSON.stringify(on));
 // A scalar pad must still work — it is the obvious thing to type into the config.
 const flat=pool(R_LIGHTS,true,{pad:2,max:12}).rlpNeed();
 ok(flat.point===off.point+2&&flat.spot===off.spot+2&&flat.dir===off.dir+2,
   'POOL: a scalar pad applies to every type',JSON.stringify(flat));
 ok(off.point===4,'POOL: ...and with the editor OFF there is no pad at all',off.point);
}
{
 /* A game whose rooms author no lights must allocate NOTHING. That is the property that
    makes the pool free to ship. */
 const p=pool({a:{},b:{lights:[]}},false);
 const n=p.rlpNeed();
 ok(n.point===0&&n.spot===0&&n.dir===0,'POOL: no authored lights anywhere = no pool',JSON.stringify(n));
 p.buildRoomLightPool();
 ok(p.added.length===0,'POOL: ...and nothing is added to the scene');
}
{
 const p=pool(R_LIGHTS,false,{pad:{point:4,spot:3,dir:1},max:3});
 const n=p.rlpNeed();
 ok(n.point===3,'POOL: max is a hard ceiling per type',n.point);
}
{
 /* THE INVARIANT THE WHOLE POOL EXISTS FOR: driving a room, then another, then the same
    one again, never changes how many lights are in the scene. If this ever fails, every
    material in the game recompiles on a venue change and the editor stutters per click. */
 const p=pool(R_LIGHTS,true);
 p.buildRoomLightPool();
 const total=p.added.filter(o=>o.intensity!==undefined).length;
 ok(total>0,'DRIVE: the pool built something',total);
 const count=()=>p.added.filter(o=>o.intensity!==undefined).length;
 const before=count();
 p.applyAuthoredLights(R_LIGHTS.pub);
 ok(count()===before,'DRIVE: applying a room adds NO light to the scene',count()+' vs '+before);
 p.applyAuthoredLights(R_LIGHTS.saucer);
 ok(count()===before,'DRIVE: ...nor does switching to a different room');
 p.applyAuthoredLights({lights:[]});
 ok(count()===before,'DRIVE: ...nor does a room with none');
 ok(p.warn.length===0,'DRIVE: nothing overflowed',p.warn[0]);
}
{
 /* Values land where they are meant to, and a re-drive is IDEMPOTENT — the editor calls
    this on every slider tick, so a drive that accumulated would drift as you dragged. */
 const p=pool({r:{lights:[{type:'point',pos:[10,20,30],color:0xff0000,int:2.5,dist:260,decay:2}]}},true);
 p.buildRoomLightPool();
 const rm={lights:[{type:'point',pos:[10,20,30],color:0xff0000,int:2.5,dist:260,decay:2}]};
 p.applyAuthoredLights(rm);
 const lit=p.added.filter(o=>o.intensity>0);
 ok(lit.length===1,'DRIVE: exactly one light is lit',lit.length);
 const l=lit[0];
 ok(l.position.x===10&&l.position.y===20&&l.position.z===30,'DRIVE: position');
 ok(l.color._v===0xff0000,'DRIVE: colour');
 ok(l.intensity===2.5,'DRIVE: intensity is the AUTHORED number, not a transferred one',l.intensity);
 ok(l.distance===260&&l.decay===2,'DRIVE: distance + decay');
 p.applyAuthoredLights(rm);p.applyAuthoredLights(rm);
 ok(p.added.filter(o=>o.intensity>0).length===1,'DRIVE: re-driving is idempotent — still one lit');
 ok(p.added.filter(o=>o.intensity>0)[0].intensity===2.5,'DRIVE: ...and the value has not drifted');
}
{
 /* A released light must go to intensity 0, not stay lit — otherwise the previous room's
    lamps hang in the air over the new one. */
 const p=pool({r:{lights:[{type:'point',int:3},{type:'point',int:3}]}},false);
 p.buildRoomLightPool();
 p.applyAuthoredLights({lights:[{type:'point',int:3},{type:'point',int:3}]});
 ok(p.added.filter(o=>o.intensity>0).length===2,'RELEASE: two lit');
 p.applyAuthoredLights({lights:[{type:'point',int:3}]});
 ok(p.added.filter(o=>o.intensity>0).length===1,'RELEASE: dropping one puts it out',
    p.added.filter(o=>o.intensity>0).length);
}
{
 /* A spot with no target IN THE SCENE never aims — the classic silent three.js failure
    where the cone points doggedly at the origin whatever `look` says. */
 const p=pool({r:{lights:[{type:'spot',pos:[0,90,0],look:[30,0,-10],angle:0.5,penumbra:0.3}]}},false);
 p.buildRoomLightPool();
 const targets=p.added.filter(o=>o.intensity===undefined);
 ok(targets.length>=1,'SPOT: the target object is added to the scene, not left orphaned',targets.length);
 p.applyAuthoredLights({lights:[{type:'spot',pos:[0,90,0],look:[30,0,-10],angle:0.5,penumbra:0.3}]});
 const s=p.added.filter(o=>o.intensity>0)[0];
 ok(s.target&&s.target.position.x===30&&s.target.position.z===-10,'SPOT: look drives the target position');
 ok(s.angle===0.5&&s.penumbra===0.3,'SPOT: angle + penumbra');
}
{
 /* Overflow is a WARNING and the extra lights are dropped — never a silent partial room
    and never an unbounded allocation. */
 const p=pool({r:{lights:[{type:'point'}]}},false);
 p.buildRoomLightPool();
 p.applyAuthoredLights({lights:[{type:'point',int:1},{type:'point',int:1},{type:'point',int:1}]});
 ok(p.warn.length===1,'OVERFLOW: says so once',p.warn.length);
 ok(p.added.filter(o=>o.intensity>0).length===1,'OVERFLOW: only what the pool holds is lit');
}
{
 const p=pool({},false);
 ok(p.rlpType({type:'directional'})==='dir','TYPE: "directional" is accepted as dir');
 ok(p.rlpType({})==='point','TYPE: a spec with no type is a point light');
 ok(p.rlpType({type:'nonsense'})==='point','TYPE: an unknown type falls back to point, not undefined');
}

/* === the config's own data ===============================================
   The export is only paste-ready if the DESTINATION still has the shape it emits. A room
   entry that grew an inline comment, or lost its lights/props keys, breaks the workflow
   without breaking anything a syntax check would catch. */
{
 const cfgSrc=fs.readFileSync(path.join(ROOT,'js/config.js'),'utf8');
 const s=cfgSrc.indexOf('\n  rooms:{');
 const e=cfgSrc.indexOf('\n  },',s);
 ok(s>0&&e>s,'CONFIG: the rooms block is findable');
 const block=cfgSrc.slice(s,e);
 ok(block.indexOf('//')<0,'CONFIG: no inline comment inside a room entry — a paste would delete it',
   (block.split('\n').filter(l=>l.indexOf('//')>=0)[0]||'').trim());
 const ids=(block.match(/^   [a-z_]+:\{/gm)||[]).map(x=>x.trim().replace(':{',''));
 ok(ids.length>=4,'CONFIG: room entries found',ids.join(','));
 // EVERY room must sit at the SAME indent the exporter emits, or a pasted block lands crooked
 // beside its siblings — and a stray entry silently drops out of any scan that walks this block
 // by indent, including the id scan above. (This caught exactly that: arcade left at 5 spaces.)
 // the slice opens on the 'rooms:{' header line itself, which is not a room
 const heads=(block.match(/^ *[a-z_]+:\{$/gm)||[]).filter(h=>h.trim()!=='rooms:{');
 const badIndent=heads.filter(h=>!/^   [a-z_]+:\{$/.test(h));
 ok(badIndent.length===0,'CONFIG: every room entry sits at the 3-space indent the export emits',
    badIndent.join(' | '));
 ids.forEach(id=>{
  const bs=block.indexOf('\n   '+id+':{'),be=block.indexOf('\n   },',bs);
  const body=block.slice(bs,be);
  ok(body.indexOf('lights:')>=0,'CONFIG: '+id+' declares lights (the paste target must exist)');
  ok(body.indexOf('props:')>=0,'CONFIG: '+id+' declares props');
 });
 ok(cfgSrc.indexOf('roomLightPool')>=0,'CONFIG: render.roomLightPool exists');
}
/* The crowd cylinder is gone; nothing may still reach for it. */
{
 const files=fs.readdirSync(path.join(ROOT,'js')).filter(f=>/\.js$/.test(f));
 const hits=[];
 files.forEach(f=>{const t=fs.readFileSync(path.join(ROOT,'js',f),'utf8');
  if(/\bcrowdMesh\b|\bbuildCrowd\b/.test(t))hits.push(f);});
 ok(hits.length===0,'CROWD: no live reference to crowdMesh/buildCrowd survives',hits.join(','));
 const w=fs.readFileSync(path.join(ROOT,'js/world.js'),'utf8');
 ok(/function buildGround\(/.test(w),'CROWD: the ground plane it shared a builder with is still there');
 ok(/buildGround\(\)/.test(w),'CROWD: ...and is still called from initThree');
}

/* === TEETH ===============================================================
   Each mutation is a plausible way to write this wrong. If one of them does NOT break an
   assertion, that assertion is decoration — the lesson from the 2026-08-20 stat-trial
   mutation that had no teeth until the test was made to actually reach the target. */
function mutate(label,mutSrc,run){
 // A mutation whose anchor has DRIFTED applies nothing and then quietly 'passes'. That is
 // exactly how a mutation suite rots into decoration — and it is not hypothetical: the
 // 'numbers not rounded' anchor drifted the moment reFmtNum grew a second branch. Comparing
 // against the two un-mutated sources catches it with no per-call-site bookkeeping to forget.
 if(mutSrc===EXPORT_SRC||mutSrc===POOL_SRC){
  fail++;fails.push('TEETH: '+label+' — MUTATION DID NOT APPLY (its anchor has drifted)');return;}
 let broke=false,note='';
 try{broke=run(mutSrc);}catch(e){broke=true;note=' (threw: '+e.message.slice(0,44)+')';}
 ok(broke,'TEETH: '+label+' must fail an assertion'+note);
}
function exportWith(src,rooms,id){
 const CONFIG={rooms:rooms},cfg={room:id};
 return new Function('CONFIG','cfg',
  'function reditRoomId(){return CONFIG.rooms[cfg.room]?cfg.room:"open";}\n'+
  'function reditRoom(){return CONFIG.rooms[reditRoomId()];}\n'+
  src+'\nreturn {reditBlock};')(CONFIG,cfg);
}
// Colours emitted as decimals still PARSE — so only a reader notices, which is exactly why
// it is asserted rather than assumed.
mutate('colours emitted as decimals',
 EXPORT_SRC.replace('return RE_HEXKEY[k]?reHex(v):reFmtNum(v);','return reFmtNum(v);'),
 src=>exportWith(src,{pub:PUB},'pub').reditBlock().indexOf('0x120c07')<0);
// A JSON-style emitter: valid JS, wrong house style, stops matching the file it lands in.
mutate('double-quoted strings (JSON.stringify)',
 EXPORT_SRC.replace("if(typeof v==='string'){const bs=String.fromCharCode(92);",
                    "if(typeof v==='string'){return JSON.stringify(v);"),
 src=>/"/.test(exportWith(src,{pub:PUB},'pub').reditBlock()));
// Dropping env.panels' special case turns its leading colour into a decimal.
mutate('env.panels loses its colour rule',
 EXPORT_SRC.replace("if(k==='panels')return '['+v.map(p=>'['+reHex(p[0])+','+p.slice(1).map(reFmtNum).join(',')+']').join(',')+']';",''),
 src=>exportWith(src,{pub:PUB},'pub').reditBlock().indexOf('0xffa94d')<0);
// No rounding: float noise reaches the source file.
mutate('numbers not rounded',
 EXPORT_SRC.replace('let r=Math.round(n*1000)/1000;','let r=n;'),
 src=>exportWith(src,{n:{name:'x',bg:1,lights:[{type:'point',int:0.1+0.2}],props:[]}},'n')
       .reditBlock().indexOf('0.30000000000000004')>=0);
// Rounding a dim light to 3dp exports it as 0 — a silent blackout on paste.
mutate('small numbers rounded to 3dp like everything else',
 EXPORT_SRC.replace("if(n!==0&&Math.abs(n)<0.01)r=Math.round(n*1e6)/1e6;",''),
 src=>exportWith(src,{n:{name:'x',lights:[{type:'point',int:0.0004}],props:[]}},'n')
       .reditBlock().indexOf('int:0')>=0);
// An omitted empty list leaves no paste target for the next person to fill in.
mutate('empty lights omitted instead of emitted',
 EXPORT_SRC.replace("if(!list.length)return ind+'lights:[],';","if(!list.length)return '';"),
 src=>exportWith(src,{open:MIN},'open').reditBlock().indexOf('lights:[],')<0);
function poolWith(src,rooms,editorOn){
 const light=t=>({_t:t,visible:false,intensity:-1,castShadow:true,decay:0,distance:0,angle:0,penumbra:0,
  color:{set(){}},position:{set(){}},
  target:(t==='point')?null:{position:{set(){}},updateMatrixWorld(){}}});
 const added=[];
 const THREE={PointLight:function(){return light('point');},SpotLight:function(){return light('spot');},
  DirectionalLight:function(){return light('dir');}};
 const CONFIG={rooms:rooms,debug:{roomEditor:editorOn},render:{roomLightPool:{pad:{point:4,spot:3,dir:1},max:12}}};
 const api=new Function('CONFIG','THREE','scene','console',
  src+'\nreturn {roomLightPool,rlpNeed,buildRoomLightPool,applyAuthoredLights};')(
  CONFIG,THREE,{add(o){added.push(o);}},{log(){},warn(){}});
 return Object.assign(api,{added:added});
}
// Sizing by the SUM allocates lights nothing will ever use — and every resident light costs
// every material a little, forever.
mutate('pool sized by the sum instead of the per-room max',
 POOL_SRC.replace('for(const t in n)if(c[t]>n[t])n[t]=c[t];','for(const t in n)n[t]+=c[t];'),
 src=>poolWith(src,R_LIGHTS,false).rlpNeed().point!==4);
// Pad regardless of the editor flag: a shipping player pays for a dev tool they cannot open.
mutate('editor pad allocated even with the editor off',
 POOL_SRC.replace('const on=!!(CONFIG.debug&&CONFIG.debug.roomEditor);','const on=true;'),
 src=>poolWith(src,R_LIGHTS,false).rlpNeed().point!==4);
// No release: the previous room's lamps stay lit over the new one.
mutate('applyAuthoredLights does not release the pool first',
 POOL_SRC.replace(' rlpFreeAll();',' '),
 src=>{const p=poolWith(src,{r:{lights:[{type:'point'},{type:'point'}]}},false);
  p.buildRoomLightPool();
  p.applyAuthoredLights({lights:[{type:'point',int:3},{type:'point',int:3}]});
  p.applyAuthoredLights({lights:[{type:'point',int:3}]});
  return p.added.filter(o=>o.intensity>0).length!==1;});
// scene.add-ing a fresh light per spec is the exact bug the pool exists to prevent: the
// light count changes and every material in the game recompiles.
mutate('lights added to the scene per room instead of borrowed',
 POOL_SRC.replace('const t=rlpType(L),l=rlpGet(t);',
                  'const t=rlpType(L),l=(scene.add(new THREE.PointLight()),roomLightPool[t][0]);'),
 src=>{const p=poolWith(src,{r:{lights:[{type:'point'}]}},false);
  p.buildRoomLightPool();
  const n0=p.added.length;
  p.applyAuthoredLights({lights:[{type:'point',int:1}]});
  return p.added.length!==n0;});
// A spot target left out of the scene: its matrix never updates and the cone never aims.
mutate('spot target not added to the scene',
 POOL_SRC.replace(' if(l.target){l.target.position.set(0,0,0);scene.add(l.target);}',' '),
 src=>{const p=poolWith(src,{r:{lights:[{type:'spot'}]}},false);
  p.buildRoomLightPool();
  return p.added.filter(o=>o.intensity===undefined).length===0;});


/* === the REAL rooms ======================================================
   The strongest form of the claim: take CONFIG.rooms as it actually ships, export every
   entry, parse each block back, and require it to be the same object. Anything the four
   real rooms contain that the emitter mishandles fails HERE rather than the first time
   somebody pastes a night's work over a room and reloads. */
{
 const vm=require('vm');
 const ctx=vm.createContext({console:{log(){},warn(){}},Math,JSON,isFinite,parseFloat,parseInt,Date,
  localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{style:{setProperty(){}}}},
  navigator:{userAgent:'node'}});
 let CONF=null,err=null;
 try{
  const src=fs.readFileSync(path.join(ROOT,'js/core.js'),'utf8')+'\n'+
            fs.readFileSync(path.join(ROOT,'js/config.js'),'utf8')+
            '\n;globalThis.__rooms=CONFIG.rooms;globalThis.__pool=CONFIG.render.roomLightPool;';
  new vm.Script(src,{filename:'config'}).runInContext(ctx);
  CONF=ctx.__rooms;
 }catch(e){err=e.message;}
 ok(!!CONF,'REAL: js/core.js + js/config.js run and hand back CONFIG.rooms',err);
 const pd=ctx.__pool&&ctx.__pool.pad;
 ok(pd!==undefined&&(typeof pd==='number'||typeof pd==='object'),
   'REAL: render.roomLightPool.pad is a number or a per-type object',JSON.stringify(ctx.__pool));
 if(CONF){
  const ids=Object.keys(CONF);
  ok(ids.length>=4,'REAL: rooms present',ids.join(','));
  ids.forEach(id=>{
   const X=exporter(CONF,id);
   const txt=X.reditBlock();
   let back=null,e2=null;
   try{back=(new Function('return {'+txt.replace(/,\s*$/,'')+'};'))();}catch(e){e2=e.message;}
   ok(back&&back[id],'REAL['+id+']: exports to valid JS',e2);
   if(back&&back[id]){
    // Compare on the keys the emitter is responsible for. A key it does not emit would be
    // LOST by a paste, so that list is itself the assertion.
    const owned=['name','folder','glb','backdrop','reflect','light','lightsOff','bg','fog',
                 'hemi','dir','env','lights','props','led'];
    const missed=Object.keys(CONF[id]).filter(k=>owned.indexOf(k)<0);
    ok(missed.length===0,'REAL['+id+']: every key it has is one the export knows about',missed.join(','));
    owned.forEach(k=>{
     if(CONF[id][k]===undefined)return;
     ok(eq(back[id][k],CONF[id][k]),'REAL['+id+']: '+k+' round-trips',
        JSON.stringify(back[id][k])+' vs '+JSON.stringify(CONF[id][k]));
    });
   }
  });
 }
}

console.log('\nroomlights harness: '+pass+' passed, '+fail+' failed');
if(fail){console.log('\nFAILURES:');fails.forEach(f=>console.log('  x '+f));process.exit(1);}
console.log('all assertions passed (incl. 10 mutation checks)');
