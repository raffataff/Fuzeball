/* Behavioural harness for the GLB light + emissive transfer (js/models.js).
   No three.js, no browser: the two functions are string-sliced out of models.js and
   rebuilt with new Function, then run against the REAL numbers read out of the room
   GLBs' JSON chunks. Every fixture below is measured, not invented.
   Run: node tools/roomlight-harness.js                                          */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/models.js'),'utf8');

function slice(name){
 const start=SRC.indexOf('function '+name+'(');
 if(start<0)throw new Error('not found: '+name);
 let d=0;
 for(let j=SRC.indexOf('{',start);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return SRC.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
const SRC_LIGHTS=slice('applyRoomLights'), SRC_EMIS=slice('applyEmissiveStrength');

function V3(){this.x=0;this.y=0;this.z=0;}
V3.prototype.length=function(){return Math.hypot(this.x,this.y,this.z);};
const THREE={Vector3:V3};

function mkLight(o){
 return {name:o.name,isLight:true,
  isPointLight:o.type==='point',isSpotLight:o.type==='spot',isDirectionalLight:o.type==='dir',
  intensity:o.intensity,distance:0,decay:1,castShadow:true,_p:o.pos,
  getWorldPosition(v){v.x=o.pos[0];v.y=o.pos[1];v.z=o.pos[2];return v;}};
}
function mkRoom(lights){
 return {updateMatrixWorld(){},traverse(f){f(this);lights.forEach(f);}};
}
function build(CONFIG){
 const f=new Function('CONFIG','THREE','console',
  SRC_LIGHTS+'\n'+SRC_EMIS+'\nreturn {applyRoomLights,applyEmissiveStrength};');
 return f(CONFIG,THREE,{log(){}});
}
const CFG=(over)=>({render:{roomLight:Object.assign({gain:1,reach:3,decay:2,minDist:20,max:0},over||{})}});

/* legacy (physicallyCorrectLights=false) falloff, verbatim from r128's
   punctualLightIntensityToIrradianceFactor — this is what the GPU actually does. */
function falloff(d,distance,decay){
 if(distance>0&&decay>0)return Math.pow(Math.max(0,Math.min(1,-d/distance+1)),decay);
 return 1;
}
const dist=p=>Math.hypot(p[0],p[1],p[2]);
const deliver=l=>l.intensity*falloff(dist(l._p),l.distance,l.decay);

const SAUCER=()=>[
 mkLight({name:'Saucer_Ambient_Fill',type:'point',intensity:8152.711959882338,pos:[0,114.0250015258789,-27.21666145324707]}),
 mkLight({name:'Table_Spotlight',type:'spot',intensity:46198.70110599992,pos:[0,207.62501525878906,-27.21666145324707]})];
const PUB=()=>[
 mkLight({name:'room_light_fire',type:'point',intensity:1739.2452181082324,pos:[-388.45355224609375,-26.899202346801758,105.18301391601562]}),
 mkLight({name:'room_light_pendant',type:'spot',intensity:1087.0282613176453,pos:[-0.2584349513053894,97.08324432373047,1.8643112182617188]}),
 mkLight({name:'room_light_sconce_1',type:'point',intensity:1195.7310874494096,pos:[-252.76934814453125,73.46753692626953,-53.632591247558594]})];

let pass=0,fail=0;const fails=[];
function ok(c,msg,extra){if(c)pass++;else{fail++;fails.push(msg+(extra?'  ['+extra+']':''));}}
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?1e-6:t);

/* === 1. THE BUG: the old per-light clamp flattened the authored ratio ====== */
{
 const L=SAUCER(),ls=0.0005;
 L.forEach(l=>{l.intensity=Math.min(l.intensity*ls,4);
  if(l.isPointLight||l.isSpotLight){if(!l.distance)l.distance=l.isSpotLight?260:180;l.decay=2;}});
 const fill=L[0],spot=L[1];
 ok(near(fill.intensity,4,1e-9),'OLD: fill clamps to 4',fill.intensity);
 ok(near(spot.intensity,4,1e-9),'OLD: key clamps to 4 as well',spot.intensity);
 ok(near(spot.intensity/fill.intensity,1,1e-9),'OLD: authored 5.67:1 ratio arrives as 1:1');
 const dS=deliver(spot),dF=deliver(fill);
 ok(dS<0.2,'OLD: key delivers <0.2 at the table (~4% of a value already clamped)',dS.toFixed(4));
 ok(dF>dS*2,'OLD: the FILL outshines the KEY - design inverted',dF.toFixed(3)+' vs '+dS.toFixed(3));
}

/* === 2. pub: fire + sconces delivered exactly zero ======================== */
{
 const L=PUB(),ls=0.0003;
 L.forEach(l=>{l.intensity=Math.min(l.intensity*ls,4);
  if(l.isPointLight||l.isSpotLight){if(!l.distance)l.distance=l.isSpotLight?260:180;l.decay=2;}});
 ok(L.every(l=>l.intensity<4),'OLD: no pub light reaches the clamp (clamp bug is saucer-only)');
 ok(deliver(L[0])===0,'OLD: pub fireplace delivers exactly 0 (d0 403 > cutoff 180)');
 ok(deliver(L[2])===0,'OLD: pub sconce delivers exactly 0 (d0 269 > cutoff 180)');
 ok(deliver(L[1])>0,'OLD: only the pendant lit anything');
}

/* === 3. NEW: the inverse-square relationship survives to the table ======== */
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:3.2}});
 const fill=L[0],spot=L[1];
 const dS=deliver(spot),dF=deliver(fill);
 const want=(46198.70110599992/Math.pow(dist(spot._p),2))/(8152.711959882338/Math.pow(dist(fill._p),2));
 ok(near(want,1.7752,1e-3),'NEW: authored irradiance ratio at the table is ~1.78:1',want.toFixed(4));
 ok(near(dS/dF,want,1e-6),'NEW: delivered ratio == authored inverse-square ratio',(dS/dF).toFixed(4));
 ok(dS>dF,'NEW: the KEY now outshines the fill (was inverted)');
 ok(dS>1.0,'NEW: key delivers real light at the table',dS.toFixed(3));
 ok(!near(dS/dF,1,0.05),'NEW: ratio is NOT flattened to 1:1');
}

/* === 4. scale invariance + a linear, readable knob ======================== */
{
 const one=h=>{const A=build(CFG());const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,h,0]});
  A.applyRoomLights(mkRoom([l]),{});return l;};
 const lo=one(90),hi=one(210);
 ok(near(falloff(90,lo.distance,lo.decay),falloff(210,hi.distance,hi.decay),1e-9),
    'NEW: a 90-unit and a 210-unit fixture land on the SAME falloff at the table');
 const k=Math.pow(1-1/3,2);
 ok(near(falloff(90,lo.distance,lo.decay),k,1e-9),'NEW: that constant is (1-1/reach)^decay',k.toFixed(4));
 const atGain=g=>{const A=build(CFG());const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,120,0]});
  A.applyRoomLights(mkRoom([l]),{light:{gain:g}});return deliver(l);};
 ok(near(atGain(4)/atGain(1),4,1e-9),'NEW: delivered light is LINEAR in gain (the knob works)');
 // the old knob was NOT linear once the clamp bit - that is why it felt dead
 const oldAt=ls=>{const l=mkLight({name:'x',type:'spot',intensity:46198.70110599992,pos:[0,207.6,0]});
  l.intensity=Math.min(l.intensity*ls,4);l.distance=260;l.decay=2;return deliver(l);};
 ok(near(oldAt(0.0005),oldAt(0.005),1e-12),'OLD: a 10x lightScale change did NOTHING (clamp ate it)');
}

/* === 5. ratio-preserving ceiling (vs the per-light clamp it replaces) ===== */
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:4}});
 ok(near(Math.max(L[0].intensity,L[1].intensity),4,1e-9),'CEILING: brightest light pulled to max');
 const want=(46198.70110599992/Math.pow(dist(L[1]._p),2))/(8152.711959882338/Math.pow(dist(L[0]._p),2));
 ok(near(L[1].intensity/L[0].intensity,want,1e-6),
    'CEILING: ratio SURVIVES normalisation (a per-light clamp flattens it to 1:1)');
 ok(!near(L[1].intensity/L[0].intensity,1,0.05),'CEILING: and is not 1:1');
}
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:0}});
 ok(Math.max(L[0].intensity,L[1].intensity)>4,'CEILING: max:0 disables it entirely');
}

/* === 6. guards =========================================================== */
{
 const A=build(CFG());
 const l=mkLight({name:'origin',type:'point',intensity:1000,pos:[0,0,0]});
 A.applyRoomLights(mkRoom([l]),{});
 ok(isFinite(l.intensity)&&l.intensity>0,'GUARD: a fixture AT the origin cannot divide by ~0',l.intensity);
 ok(near(l.intensity,1000/400,1e-9),'GUARD: minDist floors d0 at 20');
}
{
 const A=build(CFG());
 const l=mkLight({name:'flat',type:'point',intensity:1000,pos:[0,120,0]});
 A.applyRoomLights(mkRoom([l]),{light:{reach:0}});
 ok(l.distance===0,'GUARD: reach:0 -> no cutoff');
 ok(near(falloff(120,l.distance,l.decay),1,1e-9),'GUARD: reach:0 means flat (falloff 1.0)');
}
{
 const A=build(CFG());
 const L=SAUCER();A.applyRoomLights(mkRoom(L),{});
 ok(L.every(l=>l.castShadow===false),'GUARD: no room light casts shadows');
}
{
 const A=build(CFG());
 const d=mkLight({name:'sun',type:'dir',intensity:2,pos:[0,300,0]});
 A.applyRoomLights(mkRoom([d]),{light:{gain:3}});
 ok(near(d.intensity,6,1e-9),'GUARD: directional in a room glb takes gain, not the 1/d^2 term',d.intensity);
}
{
 const A=build(CFG());
 ok(A.applyRoomLights(mkRoom([]),{}).length===0,'GUARD: a room with no lights returns empty, no throw');
}

/* === 7. emissive strength ================================================ */
{
 const A=build(CFG());
 const m=(s,ei)=>({emissive:{r:1},emissiveIntensity:ei,needsUpdate:false,
   userData:s===undefined?{}:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:s}}}});
 const a=m(4,1),b=m(1,1),c=m(undefined,1),d=m(2,0.5),shared=m(3,1);
 A.applyEmissiveStrength({traverse(f){[{material:a},{material:b},{material:c},{material:d},
   {material:shared},{material:shared},{material:[a]}].forEach(f);}});
 ok(near(a.emissiveIntensity,4),'EMIS: strength 4 -> emissiveIntensity 4',a.emissiveIntensity);
 ok(a.needsUpdate===true,'EMIS: material flagged for recompile');
 ok(near(b.emissiveIntensity,1),'EMIS: strength 1 is a no-op');
 ok(b.needsUpdate===false,'EMIS: strength 1 does not touch needsUpdate');
 ok(near(c.emissiveIntensity,1),'EMIS: no extension -> untouched');
 ok(near(d.emissiveIntensity,1.0),'EMIS: multiplies an authored emissiveIntensity (0.5*2)',d.emissiveIntensity);
 ok(near(shared.emissiveIntensity,3),'EMIS: a SHARED material is applied ONCE, not per-mesh',shared.emissiveIntensity);
}
{
 const A=build(CFG());
 const glow={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:4}}}};
 const bulb={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:6}}}};
 A.applyEmissiveStrength({traverse(f){[{material:glow},{material:bulb}].forEach(f);}});
 ok(near(glow.emissiveIntensity,4),'EMIS: saucer Alien_Glow arrives at its authored 4');
 ok(near(bulb.emissiveIntensity,6),'EMIS: pub pendant bulb arrives at its authored 6');
}
{
 const A=build({render:{emissiveStrength:false,roomLight:{}}});
 const m={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:4}}}};
 A.applyEmissiveStrength({traverse(f){f({material:m});}});
 ok(near(m.emissiveIntensity,1),'EMIS: render.emissiveStrength:false is a true off switch');
 const A2=build(CFG());
 [NaN,-1,'4',null,undefined].forEach(v=>{
  const x={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:v}}}};
  A2.applyEmissiveStrength({traverse(f){f({material:x});}});
  ok(near(x.emissiveIntensity,1),'EMIS: junk strength ignored ('+String(v)+')');});
 const noEmis={emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:4}}}};
 A2.applyEmissiveStrength({traverse(f){f({material:noEmis});}});
 ok(near(noEmis.emissiveIntensity,1),'EMIS: material with no emissive channel is skipped');
 A2.applyEmissiveStrength(null);ok(true,'EMIS: null root does not throw');
 A2.applyEmissiveStrength({traverse(f){f({});}});ok(true,'EMIS: object with no material does not throw');
}

/* === 8. the pub, end to end ============================================== */
{
 const A=build(CFG());
 const L=PUB();A.applyRoomLights(mkRoom(L),{light:{gain:16}});
 const fire=deliver(L[0]),pend=deliver(L[1]),sc=deliver(L[2]);
 ok(fire>0&&sc>0,'PUB: fireplace and sconces now deliver light (were exactly 0)',
    'fire '+fire.toFixed(3)+' sconce '+sc.toFixed(3));
 ok(pend>fire&&pend>sc,'PUB: the pendant over the table is still the key','pend '+pend.toFixed(3));
 ok(pend/sc>4,'PUB: pendant dominates the sconces as authored',(pend/sc).toFixed(2));
}

/* === 9. delivered-value report (eyeball these against a real match) ======= */
function report(name,lights,light){
 const A=build(CFG());A.applyRoomLights(mkRoom(lights),{light});
 console.log('\n'+name+'  (gain '+light.gain+')');
 lights.forEach(l=>console.log('   '+String(l.name).padEnd(22)+
  ' d0='+String(Math.round(dist(l._p))).padStart(4)+
  '  intensity='+l.intensity.toFixed(3).padStart(8)+
  '  cutoff='+String(Math.round(l.distance)).padStart(5)+
  '  -> at table '+deliver(l).toFixed(3)));
}

console.log('\n=== delivered at the table (three.js intensity units) ===');
report('saucer',SAUCER(),{gain:3.2});
report('pub',PUB(),{gain:16});


/* === 10. TEETH: each mutation below must BREAK something ==================
   A harness that passes against a broken implementation is decoration. Each entry
   reverts one specific decision and names the assertion that must then fail.     */
function buildFrom(srcL,srcE,CONFIG){
 return new Function('CONFIG','THREE','console',
  srcL+'\n'+srcE+'\nreturn {applyRoomLights,applyEmissiveStrength};')(CONFIG,THREE,{log(){}});
}
function mutate(label,srcL,srcE,probe){
 let broke=false,note='';
 try{broke=probe(buildFrom(srcL,srcE,CFG()));}
 catch(e){broke=true;note=' (threw: '+e.message.slice(0,40)+')';}
 ok(broke,'TEETH: '+label+' must fail an assertion'+note);
 return broke;
}
const CLAMP_LINE='   l.intensity=l.intensity/(d0*d0)*C.gain;';

// M1 - per-light clamp instead of ratio-preserving group normalisation
mutate('per-light clamp (the original bug)',
 SRC_LIGHTS.replace(CLAMP_LINE,CLAMP_LINE+'l.intensity=Math.min(l.intensity,4);'),SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400}});
     return Math.abs(L[1].intensity/L[0].intensity-1)<0.05;});      // ratio collapses to 1:1

// M2 - drop the inverse-square term (raw candela * gain)
mutate('dropping the 1/d0^2 term',
 SRC_LIGHTS.replace(CLAMP_LINE,'   l.intensity=l.intensity*C.gain;'),SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:1}});
     const r=deliver(L[1])/deliver(L[0]);
     return Math.abs(r-1.7752)>0.01;});                             // becomes the 5.67 wattage ratio

// M3 - fixed cutoff instead of one derived from the fixture's own distance
mutate('a FIXED cutoff instead of d0*reach',
 SRC_LIGHTS.replace('   l.distance=C.reach>0?d0*C.reach:0;','   l.distance=l.isSpotLight?260:180;'),SRC_EMIS,
 A=>{const mk=h=>{const l=mkLight({name:'x',type:'point',intensity:1000,pos:[0,h,0]});
      A.applyRoomLights(mkRoom([l]),{});return falloff(h,l.distance,l.decay);};
     return Math.abs(mk(90)-mk(210))>1e-6;});                       // scale invariance gone

// M4 - no minDist floor
mutate('dropping the minDist floor',
 SRC_LIGHTS.replace('  const d0=Math.max(p.length(),C.minDist);','  const d0=p.length();'),SRC_EMIS,
 A=>{const l=mkLight({name:'o',type:'point',intensity:1000,pos:[0,0,0]});
     A.applyRoomLights(mkRoom([l]),{});
     return !isFinite(l.intensity);});                              // divide by zero

// M5 - drop the seen-Set, so a shared material is scaled once per mesh
mutate('dropping the shared-material guard',
 SRC_LIGHTS,SRC_EMIS.replace('if(!m||seen.has(m))return;seen.add(m);','if(!m)return;'),
 A=>{const sh={emissive:{},emissiveIntensity:1,userData:{gltfExtensions:{KHR_materials_emissive_strength:{emissiveStrength:3}}}};
     A.applyEmissiveStrength({traverse(f){[{material:sh},{material:sh}].forEach(f);}});
     return Math.abs(sh.emissiveIntensity-3)>1e-9;});               // 9, not 3

// M6 - normalise each light to max independently (subtly wrong, same symptom as M1)
mutate('normalising each light to max independently',
 SRC_LIGHTS.replace('if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity*=k);',
                    'if(mx>C.max){const k=C.max/mx;lights.forEach(l=>l.intensity=Math.min(l.intensity,C.max));'),
 SRC_EMIS,
 A=>{const L=SAUCER();A.applyRoomLights(mkRoom(L),{light:{gain:400,max:4}});
     return Math.abs(L[1].intensity/L[0].intensity-1)<0.05;});

console.log('\nroomlight harness: '+pass+' passed, '+fail+' failed');
if(fail){console.log('\nFAILURES:');fails.forEach(f=>console.log('  x '+f));process.exit(1);}
console.log('all assertions passed (incl. 6 mutation checks)');
