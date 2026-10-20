// harness for the rooms' air (js/haze.js, CONFIG.atmos, applyFog in js/world.js, the cfg.fog -> cfg.atmos migration, the Atmosphere option). Run: node tools/haze-harness.js
// the real three.min.js is loaded (the chunk patch and uniform cloning are three's own); haze.js, applyFog and the migration run against stubs for the game
// must hold: every fogged ShaderLib program reads the SAME typed arrays after three clones its uniforms; the fog chunk still does the room's linear fog after the haze;
// off = no fog, no haze, no lamps, no shafts, no motes; low = haze + glow + shafts, no lamps, no motes; high = everything; CONFIG.atmos.on false = no haze at any level;
// the room is read off activeRoom (a parked league venue), not cfg.room; a window splits into its panes; every room has an entry; an old Fog-off save stays off
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const SRC={haze:rd('js/haze.js'),config:rd('js/config.js'),world:rd('js/world.js'),options:rd('js/options.js'),index:rd('index.html')};
const THREE_SRC=fs.readFileSync(path.join(ROOT,'vendor/three.min.js'),'utf8');

function fnAt(src,name){
 const start=src.indexOf('function '+name+'(');
 if(start<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
function objAt(src,key){   // `key:{ ... }` balanced
 const start=src.indexOf(key);
 if(start<0)throw new Error('ANCHOR LOST: '+key);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(src.indexOf('{',start),j+1);}}
 throw new Error('unbalanced: '+key);
}
function lineAt(src,needle){
 const i=src.indexOf(needle);
 if(i<0)throw new Error('ANCHOR LOST: '+needle);
 const a=src.lastIndexOf('\n',i)+1,b=src.indexOf('\n',i);
 return src.slice(a,b<0?src.length:b);
}

/* ---- a world: real THREE, haze.js, applyFog, the real CONFIG.atmos and rooms ---- */
function world(S){
 const ctx={console:{log(){},warn(){},error(){}},Math,Float32Array,Array,Object,JSON,String,Number,Set,Map,Uint8Array,Uint16Array,Uint32Array,Int32Array,Float64Array,Int8Array,Int16Array,Uint8ClampedArray,ArrayBuffer,DataView,Symbol,WeakMap,Promise,Error,TypeError,RangeError,Date,isFinite,parseFloat,parseInt};
 ctx.self=ctx;ctx.window=ctx;ctx.globalThis=ctx;
 vm.createContext(ctx);
 vm.runInContext(THREE_SRC,ctx);
 const atmos=vm.runInContext('('+objAt(S.config,'  atmos:{')+')',ctx);
 const rooms=vm.runInContext('('+objAt(S.config,'  rooms:{\n   open:{')+')',ctx);
 ctx.CONFIG={atmos,rooms};
 ctx.cfg={atmos:'high',room:'arcade'};
 ctx.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 ctx.renderDirty=()=>{};
 vm.runInContext(S.haze+'\nglobalThis.__h={HZ,hazeApply,hazeBuild,hazeLevel,hazeRoomId,HZ_SN};',ctx);
 const fog=fnAt(S.world,'applyFog'),dl=lineAt(S.world,'let _dispFog=');
 vm.runInContext('var scene=new THREE.Scene(),activeRoom=CONFIG.rooms.arcade,renderer={getContext:()=>({drawingBufferHeight:1080})},camera={fov:50};\n'+dl+'\n'+fog+'\nglobalThis.__f={applyFog};',ctx);
 ctx.__h.hazeBuild();
 return ctx;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
function run(S,quiet){
 const before=fail,fl=fails.length;
 let W;
 try{W=world(S);}catch(e){ok(false,'world builds: '+e.message);return fail-before;}
 const T=W.THREE,H=W.__h,HZ=H.HZ,go=(lvl,id)=>{W.cfg.atmos=lvl;if(id)W.activeRoom=W.CONFIG.rooms[id];vm.runInContext('applyFog()',W);};

 // 1. the uniforms are shared by reference through three's own clone
 const L=T.ShaderLib;let fogged=0,shared=0;
 for(const k in L){const u=L[k].uniforms;if(!u||!u.fogColor)continue;fogged++;
  const c=T.UniformsUtils.clone(u);if(c.hzA&&c.hzA.value===HZ.A&&c.hzP.value===HZ.P&&c.hzQ.value===HZ.Q&&c.hzD.value===HZ.D)shared++;}
 ok(fogged>=8&&shared===fogged,'every fogged program shares the haze arrays ('+shared+'/'+fogged+')');
 ok(T.UniformsUtils.clone(L.standard.uniforms).hzC.value===HZ.C,'a material clone reads the same haze colour');

 // 2. the chunks
 const C=T.ShaderChunk;
 ok(/fogDepth\s*=\s*-\s*mvPosition\.z/.test(C.fog_vertex),'fogDepth is still the view depth');
 ok(/vHzW\s*=/.test(C.fog_vertex)&&/varying vec3 vHzW/.test(C.fog_pars_vertex)&&/varying vec3 vHzW/.test(C.fog_pars_fragment),'the world position reaches the fragment');
 ok(/smoothstep\(\s*fogNear\s*,\s*fogFar\s*,\s*fogDepth\s*\)/.test(C.fog_fragment)&&/FOG_EXP2/.test(C.fog_fragment),'the linear and exp2 fogs are kept');
 ok(/mix\(\s*hzMix\(\s*gl_FragColor\.rgb\s*\)\s*,\s*fogColor\s*,\s*fogFactor\s*\)/.test(C.fog_fragment),'the haze goes in before the room fog');
 ok(/uniform vec4 hzP\[3\]/.test(C.fog_pars_fragment)&&/uniform vec4 hzQ\[3\]/.test(C.fog_pars_fragment)&&HZ.P.length===12&&HZ.Q.length===12,'three lamps, arrays sized to match');
 ok(/#ifdef USE_FOG/.test(C.fog_pars_fragment)&&/#ifdef USE_FOG/.test(C.fog_fragment),'nothing compiles without fog');

 // 3. levels
 const R=W.CONFIG.atmos.rooms.arcade;
 go('off','arcade');
 ok(W.scene.fog===null,'off: no fog');
 ok(HZ.A[0]===0&&HZ.A[3]===0&&HZ.D[3]===0,'off: no haze, no glow');
 ok([0,1,2].every(i=>HZ.P[i*4+3]===0),'off: no lamps');
 ok(!HZ.sh.visible&&!HZ.pts.visible,'off: no shafts, no motes');
 go('low');
 ok(W.scene.fog&&W.scene.fog.near===W.CONFIG.rooms.arcade.fog[0]&&W.scene.fog.far===W.CONFIG.rooms.arcade.fog[1],'low: the room fog is on');
 ok(Math.abs(HZ.A[0]-R.haze[0])<1e-6&&Math.abs(HZ.A[3]-R.haze[3])<1e-6&&Math.abs(HZ.B[3]-R.start)<1e-6,'low: the room haze');
 ok(Math.abs(HZ.D[3]-R.glow.str)<1e-6,'low: the glow');
 ok([0,1,2].every(i=>HZ.P[i*4+3]===0),'low: no lamps');
 ok(HZ.sh.visible&&!HZ.pts.visible,'low: shafts, no motes');
 go('high');
 ok(R.lamps.every((l,i)=>Math.abs(HZ.P[i*4+3]-l[3])<1e-6&&HZ.Q[i*4+3]===l[5]),'high: the lamps and their radius');
 ok(HZ.sh.visible&&HZ.pts.visible,'high: shafts and motes');
 ok(HZ.pts.geometry.drawRange.count===Math.round(W.CONFIG.atmos.motes.n*(R.motes.n===undefined?1:R.motes.n)),'high: the room\'s share of motes');
 const g=HZ.sh.geometry,nq=R.shafts.reduce((a,s)=>a+(s.n||1),0);
 ok(g.attributes.aA.count===nq*4&&g.index.count===nq*6,'a window is drawn as its panes ('+nq+' quads)');
 const aR=g.attributes.aR.array;let sides=true;for(let i=0;i<nq*4;i++){const s=aR[i*4+2],t=aR[i*4+3];if(Math.abs(s)!==1||(t!==0&&t!==1))sides=false;}
 ok(sides,'every card corner is a side and an end');
 const s0=R.shafts[0],u0=g.attributes.aU.array,w=Math.hypot(u0[0],u0[1],u0[2]),want=Math.hypot(...s0.u)*(s0.fill||1)/(s0.n||1);
 ok(Math.abs(w-want)<1e-4,'a pane is fill of its slot');
 ok(Math.abs(HZ.S[3]-s0.str)<1e-6&&Math.abs(HZ.S[12]-s0.d[0])<1e-6&&Math.abs(HZ.S[13]-s0.d[1])<1e-6,'the motes see the first window');

 // 4. the room is the one on screen
 W.cfg.room='saucer';go('high','moon');
 ok(H.hazeRoomId()==='moon'&&Math.abs(HZ.A[0]-W.CONFIG.atmos.rooms.moon.haze[0])<1e-6,'a parked venue: the room on screen, not cfg.room');
 go('high','pub');
 ok(HZ.A[3]===0&&!HZ.sh.visible&&!HZ.pts.visible,'the pub has no air yet');

 // 5. the master switch
 W.CONFIG.atmos.on=false;go('high','arcade');
 ok(W.scene.fog!==null&&HZ.A[3]===0&&HZ.D[3]===0&&HZ.P[3]===0&&!HZ.sh.visible&&!HZ.pts.visible,'atmos.on false: the room fog alone');
 W.CONFIG.atmos.on=true;

 // 6. config: every room has air, no more lamps than the shader holds
 for(const id in W.CONFIG.rooms){const a=W.CONFIG.atmos.rooms[id];
  ok(!!a,'room '+id+' has an atmos entry');
  if(a)ok((a.lamps||[]).length<=3&&(!a.haze||a.haze.length===4),'room '+id+': at most 3 lamps, haze has 4 numbers');}

 // 7. the old Fog tick
 const mig=lineAt(S.config,"if('fog' in cfg)")+'\n'+lineAt(S.config,"if(!['off','low','high'].includes(cfg.atmos))");
 const migrate=o=>{const c=Object.assign({atmos:'high'},o);new Function('cfg',mig)(c);return c;};
 ok(migrate({fog:false}).atmos==='off','an old Fog-off save stays off');
 ok(migrate({fog:true,gfxPreset:'low'}).atmos==='low','an old Low-preset save gets Low');
 ok(migrate({fog:true,gfxPreset:'high'}).atmos==='high','an old fog-on save gets High');
 ok(!('fog' in migrate({fog:true})),'the old key is dropped');
 ok(migrate({atmos:'bogus'}).atmos==='high'&&migrate({atmos:'low'}).atmos==='low','a bad value reads as High, a good one stays');
 ok(/'atmos'/.test(lineAt(S.config,"'particles','marks','rodHoles'")),'atmos is a machine setting');

 // 8. options and boot
 const pre=new Function(lineAt(S.options,'const GFX_PRESETS=').replace('const GFX_PRESETS=','return ')+lineAt(S.options,' low:{renderScale')+lineAt(S.options,' medium:{renderScale')+lineAt(S.options,' high:{renderScale')+'};')();
 ok(pre.low.atmos==='low'&&pre.medium.atmos==='high'&&pre.high.atmos==='high','presets carry the atmosphere');
 ok(/cfg\.atmos=p\.atmos/.test(fnAt(S.options,'applyGfxPreset')),'a preset sets it');
 ok(/id="optAtmos"/.test(S.index)&&!/id="optFog"/.test(S.index),'the Atmosphere selector replaced the Fog tick');
 ok(/'js\/boost\.js','js\/haze\.js'/.test(S.index),'haze.js loads before anything compiles');
 if(!quiet&&fails.length>fl)for(const f of fails.slice(fl))console.log('  FAIL '+f);
 return fail-before;
}

const base=run(SRC,false);
console.log((base?'FAIL':'ok')+'  '+pass+' assertions, '+base+' failed');

/* ---- mutations: each must break it ---- */
function mutate(file,a,b){const s=Object.assign({},SRC);if(!s[file].includes(a))throw new Error('MUTATION ANCHOR LOST: '+a);s[file]=s[file].replace(a,b);if(s[file]===SRC[file])throw new Error('no-op: '+a);return s;}
const M=[
 ['shared by value',()=>mutate('haze','u[n]={value:U[n]}','u[n]={value:U[n].slice()}')],
 ['lamps on low',()=>mutate('haze','(hi||A.lampsLow)','(on||A.lampsLow)')],
 ['motes on low',()=>mutate('haze','hazeMotes(hi?R.motes:null)','hazeMotes(on?R.motes:null)')],
 ['haze while off',()=>mutate('haze','HZ.A.set(on&&R.haze?R.haze','HZ.A.set(R.haze?R.haze')],
 ['glow while off',()=>mutate('haze','HZ.D.set([dv.x,dv.y,dv.z,on?g.str||0:0])','HZ.D.set([dv.x,dv.y,dv.z,g.str||0])')],
 ['shafts while off',()=>mutate('haze','const sh=on&&R.shafts||[]','const sh=R.shafts||[]')],
 ['room from cfg',()=>mutate('haze',' if(rm)for(const k in CONFIG.rooms)',' if(0)for(const k in CONFIG.rooms)')],
 ['haze after fog',()=>mutate('haze',"gl_FragColor.rgb=mix(hzMix(gl_FragColor.rgb),fogColor,fogFactor);","gl_FragColor.rgb=hzMix(mix(gl_FragColor.rgb,fogColor,fogFactor));")],
 ['panes ignored',()=>mutate('haze','const n=s.n||1,f=s.fill||1','const n=1,f=s.fill||1')],
 ['fill ignored',()=>mutate('haze','uu=s.u.map(x=>x*f/n)','uu=s.u.map(x=>x/n)')],
 ['lamp radius lost',()=>mutate('haze','.concat([l[5]||40])','.concat([40])')],
 ['fog on when off',()=>mutate('world',"hazeLevel():cfg.atmos)!=='off'","hazeLevel():cfg.atmos)!=='none'")],
 ['no haze from applyFog',()=>mutate('world',"if(typeof hazeApply==='function')hazeApply();",'')],
 ['old off lost',()=>mutate('config',"cfg.atmos=cfg.fog===false?'off'","cfg.atmos=cfg.fog===true?'off'")],
 ['old key kept',()=>mutate('config',"delete cfg.fog;}",'}')],
 ['preset ignores it',()=>mutate('options','cfg.reducedFx=p.reducedFx;cfg.atmos=p.atmos;','cfg.reducedFx=p.reducedFx;')],
 ['low preset high',()=>mutate('options',"reducedFx:true,atmos:'low'}","reducedFx:true,atmos:'high'}")],
 ['late load',()=>mutate('index',"'js/boost.js','js/haze.js',","'js/boost.js',")],
];
let caught=0;
for(const [name,mk] of M){let s;try{s=mk();}catch(e){console.log('  '+e.message);continue;}
 const p0=pass,f0=fail,fl=fails.length;const n=run(s,true);pass=p0;fail=f0;fails.length=fl;
 if(n>base)caught++;else console.log('  MUTANT SURVIVED: '+name);}
console.log((caught===M.length?'ok':'FAIL')+'  mutations '+caught+'/'+M.length+' caught');
process.exit(base||caught!==M.length?1:0);
