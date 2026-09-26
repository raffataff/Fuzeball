/* Behavioural harness for ROOM SKIES (js/models.js ensureSky / disposeSky / pruneSkies) and the
   parts of js/world.js applyRoom that wait on them. No three.js, no browser: the functions are
   string-sliced out of the real sources and rebuilt with new Function against stubs, so what is
   tested is the code that ships.

   What must hold:
     - six faces, one CubeTexture, built only once all six are in; its format/encoding come from
       the faces (a compressed cube with the wrong format uploads as garbage or not at all)
     - two callers during one load share it: 6 fetches, not 12
     - a missing face latches the room to the flat colour and is never re-fetched
     - the LRU never frees the sky on screen, and keeps cacheSkies-1 others
     - applyRoom's onReady fires ONCE, after BOTH the backdrop and the sky, in either order
     - a sky or backdrop landing after the player left must not touch the screen
     - two overlapping props builds of one room (boot does this) leave one group, not an orphan
     - the Moon's sun in the sky (build_moon_sky.py SUN_DIR) points where its shadows come from
       (CONFIG.rooms.moon.dir.pos): a sun that disagrees with the shadows is the mistake everyone sees

   Run: node tools/sky-harness.js                                                               */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const WORLD=rd('js/world.js'), MODELS=rd('js/models.js'), PROPS=rd('js/props.js'),
      CONFIGSRC=rd('js/config.js'), MOONSKY=rd('tools/build_moon_sky.py');

function fnAt(src,name){
 const start=src.indexOf('function '+name+'(');
 if(start<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
function lineAt(src,needle){
 const i=src.indexOf(needle);
 if(i<0)throw new Error('ANCHOR LOST: '+needle);
 const a=src.lastIndexOf('\n',i)+1,b=src.indexOf('\n',i);
 return src.slice(a,b<0?src.length:b);
}

/* ---- THREE stubs --------------------------------------------------------- */
function mkTHREE(st){
 class CubeTexture{constructor(img){this.image=img;this.isCubeTexture=true;st.cubes++;}
  dispose(){st.freed.push(this.__id);}}
 class Color{constructor(c){this.c=c;this.isColor=true;}}
 class CubeTextureLoader{load(urls,ok,_p,err){st.jpgLoads+=urls.length;const t=new CubeTexture(urls);
  st.pend.push(()=>ok(t));}}
 return{CubeTexture,Color,CubeTextureLoader,sRGBEncoding:3001,LinearFilter:1006};
}

/* ---- models.js skies, rebuilt from source -------------------------------- */
function buildSky(src,over){
 const body=[
  lineAt(src,'const skyCache={},skyOrder=[]'),
  lineAt(src,"const SKY_FACES=['px'"),
  fnAt(src,'roomHasSky'),fnAt(src,'touchSky'),fnAt(src,'ensureSky'),
  fnAt(src,'disposeSky'),fnAt(src,'pruneSkies')
 ].join('\n');
 const st={cubes:0,freed:[],loads:[],jpgLoads:0,pend:[],missing:new Set()};
 const THREE=mkTHREE(st);
 const rooms={};for(const id of ['a','b','c','d'])rooms[id]={sky:{src:'sky/'+id}};
 rooms.jpg={sky:{src:'sky/jpg',ext:'jpg'}};rooms.none={};
 const CONFIG={rooms,tableAssets:Object.assign({cacheSkies:2},(over&&over.tableAssets)||{})};
 const scene={background:null};
 // A KTX2 face as r137's loader hands it over: a CompressedTexture with its own format/encoding.
 const k2={load(u,ok,_p,err){st.loads.push(u);
  st.pend.push(()=>{if(st.missing.has(u))err(new Error('404 '+u));
   else ok({isCompressedTexture:true,format:36492,type:1009,encoding:3001,minFilter:1008,mipmaps:[1,2,3],url:u});});}};
 const f=new Function('CONFIG','THREE','scene','ktx2Loader','console',
  body+'\nreturn{ensureSky,disposeSky,pruneSkies,roomHasSky,cache:skyCache,order:skyOrder,failed:skyFailed};');
 const api=f(CONFIG,THREE,scene,()=>k2,{log(){},warn(){}});
 return{api,st,scene,CONFIG,
  flush(){while(st.pend.length)st.pend.shift()();},
  load(id){let got;api.ensureSky(id,t=>{got=t;});this.flush();if(got)got.__id=id;return got;}};
}

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

function skySuite(src){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};

 /* 1. six faces -> one cube, built once all six land, format from the faces */
 {
  const w=buildSky(src);let calls=0,tex=null;
  w.api.ensureSky('a',x=>{calls++;tex=x;});
  t(w.st.loads.length===6,'requests all six faces',w.st.loads.length);
  t(w.st.loads.join()==='sky/a_px.ktx2,sky/a_nx.ktx2,sky/a_py.ktx2,sky/a_ny.ktx2,sky/a_pz.ktx2,sky/a_nz.ktx2',
    'faces in three.js order px,nx,py,ny,pz,nz',w.st.loads.join());
  for(let i=0;i<5;i++)w.st.pend.shift()();
  t(calls===0&&w.st.cubes===0,'nothing built or reported until the SIXTH face',calls+'/'+w.st.cubes);
  w.flush();
  t(calls===1&&tex&&tex.isCubeTexture,'one callback with a CubeTexture',calls);
  t(tex&&tex.format===36492&&tex.encoding===3001,'cube carries the faces\' compressed format and sRGB encoding',tex&&tex.format);
  t(tex&&tex.generateMipmaps===false,'no runtime mip generation on a compressed cube',tex&&tex.generateMipmaps);
  t(tex&&tex.image.length===6&&tex.image.every(f=>f.isCompressedTexture),'images are the six CompressedTextures');
  let again=null;w.api.ensureSky('a',x=>{again=x;});
  t(again===tex&&w.st.loads.length===6,'resident: served from cache, no refetch',w.st.loads.length);
 }
 /* 2. two callers during one load share it */
 {
  const w=buildSky(src);let n=0;
  w.api.ensureSky('b',()=>n++);w.api.ensureSky('b',()=>n++);
  t(w.st.loads.length===6,'concurrent callers share one load (6 fetches, not 12)',w.st.loads.length);
  w.flush();t(n===2&&w.st.cubes===1,'both callers answered, one cube',n+'/'+w.st.cubes);
 }
 /* 3. a missing face latches the flat colour */
 {
  const w=buildSky(src);w.st.missing.add('sky/c_py.ktx2');let got='unset',n=0;
  w.api.ensureSky('c',x=>{got=x;n++;});w.flush();
  t(got===null&&n===1,'missing face: callback once with null',n);
  t(w.st.cubes===0,'missing face: no half-built cube',w.st.cubes);
  t(!w.api.roomHasSky('c'),'missing face: room latched to no-sky');
  const before=w.st.loads.length;w.api.ensureSky('c',()=>{});w.flush();
  t(w.st.loads.length===before,'latched: never re-fetched',w.st.loads.length-before);
 }
 /* 4. no sky / jpg authoring path */
 {
  const w=buildSky(src);let got='unset';
  w.api.ensureSky('none',x=>{got=x;});
  t(got===null&&w.st.loads.length===0,'a room without a sky answers null at once');
  const j=w.load('jpg');
  t(j&&w.st.jpgLoads===6&&j.encoding===3001,'ext:jpg uses CubeTextureLoader, sRGB');
 }
 /* 5. LRU: keeps cacheSkies-1 others, never frees the one on screen */
 {
  const w=buildSky(src);
  const a=w.load('a');w.load('b');w.scene.background=a;
  w.load('c');w.api.pruneSkies('c');
  t(!w.st.freed.includes('a'),'never frees the sky on screen, whatever the LRU says',w.st.freed.join());
  t(w.st.freed.includes('b'),'frees the LRU sky that is NOT on screen',w.st.freed.join());
  w.scene.background={isColor:true};w.load('d');w.api.pruneSkies('d');
  t(w.st.freed.includes('a')&&w.api.order.length===2,'cacheSkies:2 = the active one + one warm',w.api.order.join());
  t(w.api.cache.d&&w.api.order.includes('d'),'active sky kept');
  const w1=buildSky(src,{tableAssets:{cacheSkies:1}});w1.load('a');w1.load('b');w1.api.pruneSkies('b');
  t(!w1.api.cache.a&&w1.api.cache.b,'cacheSkies:1 = only the active one');
 }
 return r;
}

/* ---- world.js applyRoom, rebuilt from source ----------------------------- */
function buildRoom(src){
 const st={bgSet:[],shows:0,envs:[],prunedRooms:[],prunedSkies:[],ready:0,skyCb:{},roomCb:{},dirty:0};
 const THREE=mkTHREE({cubes:0,freed:[]});
 const rooms={
  sky:{bg:1,sky:{src:'s'},glb:'x.glb'},       // both
  flat:{bg:2,glb:'y.glb'},                    // backdrop only
  bare:{bg:3,sky:{src:'t'}}                   // sky only, no glb
 };
 const env={CONFIG:{rooms,leds:{}},cfg:{room:'sky'},scene:{background:null},activeRoom:null,
  skyCache:{},roomGroups:{},propGroups:{},groundMesh:{visible:false}};
 const f=new Function('THREE','E','st',
  'let activeRoom=null,curLeds=null;const ledMat=null,hemiLight=null,dirLight=null;\n'+
  'const CONFIG=E.CONFIG,cfg=E.cfg,scene=E.scene,skyCache=E.skyCache,roomGroups=E.roomGroups,propGroups=E.propGroups,groundMesh=E.groundMesh;\n'+
  'function applyFog(){} function applyRoomKeyLights(){} function applyAuthoredLights(){} function shadowDirty(){}\n'+
  'function renderDirty(){st.dirty++;}\n'+
  'function setRoomEnv(id){st.envs.push(id);}\n'+
  'function buildRoomProps(id,rm,cb){st.propsCb=st.propsCb||{};st.propsCb[id]=cb;}\n'+
  'function roomHasGlb(id){return !!CONFIG.rooms[id].glb;}\n'+
  'function roomHasSky(id){return !!CONFIG.rooms[id].sky;}\n'+
  'function ensureSky(id,cb){if(skyCache[id]){cb(skyCache[id]);return;}st.skyCb[id]=cb;}\n'+
  'function ensureRoom(id,cb){st.roomCb[id]=cb;}\n'+
  'function pruneSkies(k){st.prunedSkies.push(k);} function pruneRooms(k){st.prunedRooms.push(k);}\n'+
  fnAt(src,'applyRoom')+'\nreturn{applyRoom,active:()=>activeRoom};');
 const api=f(THREE,env,st);
 // show() counts through the props callback's visibility writes
 return{api,st,env,
  go(id){env.cfg.room=id;st.readyNow=0;api.applyRoom(()=>{st.ready++;st.readyNow++;});},
  sky(id){const c=st.skyCb[id];delete st.skyCb[id];const t={isCubeTexture:true,id};env.skyCache[id]=t;c&&c(t);return t;},
  room(id){const c=st.roomCb[id];delete st.roomCb[id];env.roomGroups[id]={children:[1],visible:false};c&&c();}};
}
function roomSuite(src){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};

 /* 6. onReady waits for BOTH, in either order, and fires once */
 {
  const w=buildRoom(src);w.go('sky');
  t(w.env.scene.background&&w.env.scene.background.isColor,'flat colour holds while the sky downloads');
  w.sky('sky');t(w.st.ready===0,'sky alone is not ready (backdrop still loading)',w.st.ready);
  t(w.env.scene.background.isCubeTexture,'sky goes on as soon as it lands');
  w.room('sky');t(w.st.ready===1,'ready once both are in',w.st.ready);
  const w2=buildRoom(src);w2.go('sky');w2.room('sky');
  t(w2.st.ready===0,'backdrop alone is not ready (sky still loading)',w2.st.ready);
  w2.sky('sky');t(w2.st.ready===1,'...ready when the sky lands second',w2.st.ready);
 }
 /* 7. absent halves count as resident; a cached sky is on screen at once */
 {
  const w=buildRoom(src);w.go('flat');w.room('flat');
  t(w.st.ready===1&&w.env.scene.background.isColor,'no sky: ready on the backdrop alone, flat colour',w.st.ready);
  w.go('bare');t(w.st.readyNow===0,'no glb: still waits for its sky');
  w.sky('bare');t(w.st.readyNow===1,'no glb: ready when the sky lands');
  w.go('flat');w.room('flat');w.go('bare');
  t(w.env.scene.background.isCubeTexture&&w.st.readyNow===1,'cached sky: on screen and ready synchronously');
 }
 /* 8. stale arrivals do not touch the screen */
 {
  const w=buildRoom(src);w.go('sky');w.go('flat');        // left before either half landed
  const bg=w.env.scene.background,envs=w.st.envs.length;
  w.sky('sky');
  t(w.env.scene.background===bg,'a sky landing after we left does NOT go on screen');
  w.room('sky');
  t(w.st.envs.length===envs,'a stale backdrop does NOT install its reflections',w.st.envs.slice(envs).join());
  t(w.st.prunedRooms[w.st.prunedRooms.length-1]==='flat','a stale backdrop is pruned against the ACTIVE room',w.st.prunedRooms.join());
  w.env.propGroups.sky={visible:false};w.st.propsCb.sky();
  t(w.env.propGroups.sky.visible===false,'a stale props build does NOT re-show the old room\'s props');
 }
 return r;
}

/* ---- props.js buildRoomProps: two builds of one room in flight ----------- */
function propsSuite(src){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const kids=[],pend=[];
 const scene={add(g){kids.push(g);},remove(g){const i=kids.indexOf(g);if(i>=0)kids.splice(i,1);}};
 class Group{constructor(){this.children=[];this.visible=true;}clear(){this.children.length=0;}}
 const f=new Function('CONFIG','THREE','scene','console','ensureProp','propBuildSpec','propTemplates',
  'const propGroups={};\n'+fnAt(src,'buildRoomProps')+'\n'+fnAt(src,'disposeRoomProps')+'\nreturn{buildRoomProps,propGroups};');
 const api=f({props:{}},{Group},scene,{log(){}},(id,cb)=>pend.push(cb),()=>1,{});
 const rm={props:[{prop:'stool',at:[[0,0,0]]}]};
 api.buildRoomProps('arcade',rm);api.buildRoomProps('arcade',rm);   // boot applies the room twice
 while(pend.length)pend.shift()();
 const n=kids.filter(g=>g.name==='props:arcade').length;
 t(n===1,'two overlapping builds leave ONE props group in the scene, not an orphan',n);
 t(kids.includes(api.propGroups.arcade),'the group in the scene is the registered one');
 return r;
}
/* ---- the Moon's sun: sky script vs config ------------------------------- */
function sunSuite(cfgSrc,skySrc){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const sm=skySrc.match(/^SUN_DIR\s*=\s*K\.unit\(\(([^)]+)\)\)/m);
 const moon=cfgSrc.slice(cfgSrc.indexOf('   moon:{'));
 const cm=moon.match(/dir:\{[^}]*pos:\[([^\]]+)\][^}]*\}/);
 t(!!sm&&!!cm,'found SUN_DIR in build_moon_sky.py and rooms.moon.dir.pos in config.js');
 if(sm&&cm){
  const a=sm[1].split(',').map(Number),b=cm[1].split(',').map(Number);
  const n=v=>Math.hypot(...v),dot=(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(n(a)*n(b));
  const deg=Math.acos(Math.min(1,dot))*180/Math.PI;
  t(deg<0.5,'moon: the sun in the sky and the shadow-casting light agree (within 0.5 deg)',deg.toFixed(2)+' deg apart');
  t(/on:true/.test(cm[0])&&/shadow:true/.test(cm[0]),'moon: the sun is on and casts shadows');
 }
 return r;
}
const base=skySuite(MODELS),rbase=roomSuite(WORLD),pbase=propsSuite(PROPS),sbase=sunSuite(CONFIGSRC,MOONSKY);
pass=base.pass+rbase.pass+pbase.pass+sbase.pass;fail=base.fail+rbase.fail+pbase.fail+sbase.fail;fails.push(...base.fails,...rbase.fails,...pbase.fails,...sbase.fails);

/* ---- mutations: each must break the suite -------------------------------- */
function mutate(src,from,to){if(!src.includes(from))throw new Error('MUTATION ANCHOR LOST: '+from);
 const out=src.replace(from,to);if(out===src)throw new Error('no-op mutation: '+from);return out;}
const MUT=[
 ['builds the cube before all six faces','models',"if(++n<6||skyFailed[id])return;","if(++n<1||skyFailed[id])return;"],
 ['cube without the faces\' format','models',"t.format=faces[0].format;",""],
 ['concurrent callers each load','models',"if(skyLoading[id]){if(cb)skyLoading[id].push(cb);touchSky(id);return;}",""],
 ['no failure latch','models',"if(skyFailed[id])return;skyFailed[id]=true;","if(skyFailed[id])return;"],
 ['frees the sky on screen','models',"if(typeof scene!=='undefined'&&scene&&scene.background===t)return;",""],
 ['LRU keeps one too many','models',"const extra=Math.max(0,((CONFIG.tableAssets||{}).cacheSkies||1)-1);","const extra=Math.max(0,((CONFIG.tableAssets||{}).cacheSkies||1));"],
 ['ready on the first half','world',"let wait=2;","let wait=1;"],
 ['stale sky goes on screen','world',"if(t&&live()){scene.background=t;renderDirty();}","if(t){scene.background=t;renderDirty();}"],
 ['stale backdrop installs its env','world',"if(live()){show();setRoomEnv(id,rm);","if(true){show();setRoomEnv(id,rm);"],
 ['stale show() runs','world',"  if(!live())return;\n",""],
 ['sky sun moved without the light','moonsky',"SUN_DIR    = K.unit((-0.8, 0.72, 0.35))","SUN_DIR    = K.unit((-0.8, 0.45, 0.35))"],
 ['props build orphans the earlier group','props',"  disposeRoomProps(id);\n  const g=propGroups[id]=new THREE.Group();","  const g=propGroups[id]=new THREE.Group();"]
];
let caught=0,missed=[];
for(const [name,which,from,to] of MUT){
 let broke=false;
 try{
  const r=which==='models'?skySuite(mutate(MODELS,from,to)):which==='props'?propsSuite(mutate(PROPS,from,to)):which==='moonsky'?sunSuite(CONFIGSRC,mutate(MOONSKY,from,to)):roomSuite(mutate(WORLD,from,to));
  broke=r.fail>0;
 }catch(e){if(/ANCHOR LOST|no-op/.test(e.message))throw e;broke=true;}
 if(broke)caught++;else missed.push(name);
}

console.log(fails.length?fails.map(x=>'FAIL '+x).join('\n'):'');
console.log('sky harness: '+pass+' passed, '+fail+' failed');
console.log('mutation guard: '+caught+' caught, '+missed.length+' MISSED'+(missed.length?'  -> '+missed.join('; '):''));
process.exit(fail||missed.length?1:0);
