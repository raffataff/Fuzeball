/* Behavioural harness for BLADE GRASS (js/grass.js).

   Boots grass.js against the vendored three.js and a real box, like the pitch GLBs (24 verts, the
   top face at +y, the node squashed in y). What must hold: only grass pitches grow blades, quality
   picks how many, 'off' means NONE (not an empty draw), blades root on the TOP face only and at
   its height, the lawn is the same every time, a lower quality is an even thinning (not one
   corner), a quality change rebuilds rather than stacks, and the setting is a machine one.

   Run: node tools/grass-harness.js                                                             */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const GRASS=rd('js/grass.js'),MODELS=rd('js/models.js'),OPTIONS=rd('js/options.js'),CONFIGSRC=rd('js/config.js');
const THREESRC=rd('vendor/three.min.js');

let pass=0,fail=0;const fails=[];
const ok=(c,m,x)=>{if(c)pass++;else{fail++;fails.push(m+(x===undefined?'':'  ['+x+']'));}};

function world(src){
 const ctx={console,performance,Math,Object,Array,Float32Array,Uint16Array,Uint32Array,Int32Array,Uint8Array,Float64Array,Int8Array,Int16Array,Uint8ClampedArray,Symbol,Map,Set,WeakMap,JSON,Number,String,Boolean,Error,TypeError,Date,parseInt,parseFloat,isFinite,isNaN,Promise};
 ctx.self=ctx.window=ctx.globalThis=ctx;vm.createContext(ctx);
 vm.runInContext(THREESRC,ctx);
 vm.runInContext(`
  const clamp=(v,a,b)=>v<a?a:v>b?b:v, BALL_R=1.9; let dirty=0; function renderDirty(){dirty++;}
  const CONFIG={pitches:{g:{grass:true},o:{grass:{height:1,density:9}},f:{}},
   grass:{on:true,amount:{low:0.5,high:1},blade:{height:0.45,density:2,width:0.1,slant:0.4,lean:0.25,minH:0.45,ao:0.55,tip:1.12,sway:0.05,press:0.85,pressR:2.6,seed:7}}};
  const cfg={grass:'high'}; const S={balls:[]}; const pitchGroups={};
  `+src+`
  globalThis.__g={CONFIG,cfg,S,pitchGroups,grassAmount,grassOpts,grassRoots,grassAttach,grassApply,grassPre,dirty:()=>dirty};`,ctx);
 return ctx;
}
function pitch(T){   // a pitch like the GLBs: one box mesh, squashed and dropped, inside a group
 const g=new T.Group(),m=new T.Mesh(new T.BoxGeometry(120,1,68),new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture()}));
 m.scale.set(1,0.2,1);m.position.y=-0.1;g.add(m);return{g,m};
}
const blades=g=>{const a=[];g.traverse(c=>{if(c.userData.grass)a.push(c);});return a;};

function suite(src){
 const r={};
 const ctx=world(src),T=ctx.THREE,G=ctx.__g;
 r.amHigh=G.grassAmount();G.cfg.grass='low';r.amLow=G.grassAmount();G.cfg.grass='off';r.amOff=G.grassAmount();G.cfg.grass='high';
 G.CONFIG.grass.on=false;r.amDisabled=G.grassAmount();G.CONFIG.grass.on=true;
 r.optNone=G.grassOpts('f');r.optDef=G.grassOpts('g');r.optOver=G.grassOpts('o');
 const a=pitch(T);G.pitchGroups.g=a.g;
 const roots=G.grassRoots(a.m,G.grassOpts('g'));r.roots=roots.length;
 r.onTop=roots.every(q=>Math.abs(q[6]-0)<1e-6);                   // top of a 0.2-tall box at -0.1 is y=0
 r.inside=roots.every(q=>Math.abs(q[0])<=60&&Math.abs(q[1])<=34);
 r.uvOk=roots.every(q=>q[4]>=-1e-6&&q[4]<=1+1e-6&&q[5]>=-1e-6&&q[5]<=1+1e-6);
 r.hOk=roots.every(q=>q[3]>=0.45-1e-9&&q[3]<=1);
 r.same=JSON.stringify(G.grassRoots(a.m,G.grassOpts('g')).slice(0,50))===JSON.stringify(roots.slice(0,50));
 // a quarter of the lawn must still cover the whole pitch. The grid is laid in rows along x,
 // so an unshuffled prefix shows up as a narrow band in z.
 const qt=roots.slice(0,roots.length>>2);r.qSpan=qt.length?Math.max(...qt.map(q=>q[1]))-Math.min(...qt.map(q=>q[1])):0;
 G.grassAttach('g',a.g);
 const s=blades(a.g);r.count=s.length;
 if(s[0]){r.inst=s[0].geometry.instanceCount;r.parent=s[0].parent===a.g;r.cast=s[0].castShadow;r.recv=s[0].receiveShadow;
  r.sharesMat=s[0].material===a.m.material;r.sharesMap=s[0].material.map===a.m.material.map;r.noNormal=s[0].material.normalMap===null;
  G.S.balls.push({m:{position:new T.Vector3(3,1.9,-4)}},{m:{position:new T.Vector3(0,30,0)}});G.grassPre.call(s[0]);
  const B=s[0].material.userData.gu.uB.value;r.b0=[B[0].x,B[0].y,B[0].z];r.b1z=B[1].z;r.b2z=B[2].z;}
 G.grassAttach('g',a.g);r.reattach=blades(a.g).length;
 G.cfg.grass='low';G.grassApply();const sl=blades(a.g);r.lowInst=sl[0]?sl[0].geometry.instanceCount:0;r.dirty=G.dirty();
 G.cfg.grass='off';G.grassApply();r.offCount=blades(a.g).length;
 G.cfg.grass='high';const f=pitch(T);G.grassAttach('f',f.g);r.flat=blades(f.g).length;
 return r;
}
function check(r){
 ok(r.amHigh===1&&r.amLow===0.5,'quality picks CONFIG.grass.amount',r.amHigh+'/'+r.amLow);
 ok(r.amOff===0,'off = none',r.amOff);
 ok(r.amDisabled===0,'CONFIG.grass.on:false = none',r.amDisabled);
 ok(r.optNone===null,'a pitch without grass: gets nothing');
 ok(r.optDef&&r.optDef.height===0.45&&r.optDef.density===2,'grass:true takes the blade defaults');
 ok(r.optOver&&r.optOver.height===1&&r.optOver.density===9&&r.optOver.width===0.1,'grass:{} overrides per key, keeps the rest');
 ok(Math.abs(r.roots-120*68*4)<120*68*4*0.02,'density 2 over 120x68 = ~32.6k roots',r.roots);
 ok(r.onTop,'every root sits on the top face, through the node\'s scale and offset');
 ok(r.inside,'every root inside the pitch');
 ok(r.uvOk,'every root carries the pitch uv under it');
 ok(r.hOk,'blade heights between minH and 1');
 ok(r.same,'the same seed grows the same lawn');
 ok(r.qSpan>64,'a thinned lawn is an even thinning, not one end of the pitch',r.qSpan);
 ok(r.count===1,'one blade mesh per pitch mesh',r.count);
 ok(r.inst===r.roots,'high draws every blade',r.inst+'/'+r.roots);
 ok(r.parent,'blades are a child of the pitch group (ride, hide and dispose with it)');
 ok(r.cast===false&&r.recv===true,'blades receive shadows, never cast');
 ok(r.sharesMat===false&&r.sharesMap===true,'own material, the pitch\'s own texture');
 ok(r.noNormal,'no pitch normal map on a blade');
 ok(r.b0&&r.b0[0]===3&&r.b0[1]===-4&&r.b0[2]===1,'a ball on the floor presses at its xz',JSON.stringify(r.b0));
 ok(r.b1z===0&&r.b2z===0,'a ball in the air, or no ball, presses nothing',r.b1z+'/'+r.b2z);
 ok(r.reattach===1,'re-attaching replaces, never stacks',r.reattach);
 ok(Math.abs(r.lowInst-r.roots/2)<=1,'grassApply(low) rebuilds at half',r.lowInst);
 ok(r.dirty>0,'grassApply asks for a render');
 ok(r.offCount===0,'grassApply(off) removes the blades',r.offCount);
 ok(r.flat===0,'a non-grass pitch grows nothing',r.flat);
}

/* ---- behaviour ---- */
check(suite(GRASS));

/* ---- wiring (static) ---- */
ok(/grassAttach\(id,g\)/.test(MODELS),'ensurePitch dresses a pitch on load');
ok(/CFG_MACHINE=new Set\(\[[^\]]*'grass'/.test(CONFIGSRC),'cfg.grass is a MACHINE setting (never syncs)');
{const m=OPTIONS.match(/const GFX_PRESETS=\{([\s\S]*?)\n\};/);
 ok(m&&/low:\{[^}]*grass:'off'/.test(m[1])&&/medium:\{[^}]*grass:'low'/.test(m[1])&&/high:\{[^}]*grass:'high'/.test(m[1]),'presets: low off, medium low, high high');}
ok(/cfg\.grass=p\.grass/.test(OPTIONS),'applyGfxPreset copies grass');

/* ---- mutations: each must break the suite ---- */
function mutate(src,from,to){if(!src.includes(from))throw new Error('MUTATION ANCHOR LOST: '+from);
 const out=src.replace(from,to);if(out===src)throw new Error('no-op mutation: '+from);return out;}
const MUT=[
 ['off still builds','return G&&G.on?+((G.amount&&G.amount[cfg.grass])||0):0;','return G&&G.on?+((G.amount&&G.amount[cfg.grass])||1):0;'],
 ['every face grows','if(!(nor.getY(t[0])>.5&&nor.getY(t[1])>.5&&nor.getY(t[2])>.5))continue;',''],
 ['roots ignore the node transform','t.forEach((v,k)=>V[k].fromBufferAttribute(pos,v).applyMatrix4(M));','t.forEach((v,k)=>V[k].fromBufferAttribute(pos,v));'],
 ['no shuffle','for(let i=out.length-1;i>0;i--){const j=(rnd()*(i+1))|0,s=out[i];out[i]=out[j];out[j]=s;}',''],
 ['unseeded lawn','let sd=(o.seed|0)||7;','let sd=(Math.random()*1e9)|0;'],
 ['re-attach stacks','if(!g)return;grassDrop(g);','if(!g)return;'],
 ['blades cast','s.castShadow=false;','s.castShadow=true;'],
 ['keeps the pitch normal map','m.side=THREE.DoubleSide;m.normalMap=null;','m.side=THREE.DoubleSide;'],
 ['airborne ball presses','v.set(p.x,p.z,1-clamp((p.y-BALL_R)/(BALL_R*1.5),0,1),0);','v.set(p.x,p.z,1,0);'],
 ['override drops defaults','return Object.assign({},CONFIG.grass.blade,P.grass===true?{}:P.grass);','return P.grass===true?Object.assign({},CONFIG.grass.blade):P.grass;'],
];
let caught=0,missed=[];
for(const [name,from,to] of MUT){
 const p0=pass,f0=fail,fl=fails.length;
 check(suite(mutate(GRASS,from,to)));
 const broke=fail>f0;pass=p0;fail=f0;fails.length=fl;
 if(broke)caught++;else missed.push(name);
}

if(fails.length)console.log(fails.map(f=>'FAIL '+f).join('\n'));
console.log('grass harness: '+pass+' passed, '+fail+' failed');
console.log('mutation guard: '+caught+' caught, '+missed.length+' MISSED'+(missed.length?'  ('+missed.join('; ')+')':''));
process.exitCode=fail||missed.length?1:0;
