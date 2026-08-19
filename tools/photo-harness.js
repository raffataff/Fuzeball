/* Headless harness for js/photo.js.
   Boots config.js + core.js + state.js + photo.js in one vm context against a stubbed DOM and a
   minimal THREE.Vector3, then exercises the rig maths — the parts that are pure geometry and
   therefore actually testable without a GPU: yaw/pitch derivation, the free-look invariant (the
   camera must NOT move), the aim round-trip, the crop rect, the crop-fov formula that makes the
   letterbox preview agree with the capture, and the output-size clamp.
   Run: node tools/photo-harness.js */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

/* ---- stubs ---- */
class V3{
 constructor(x,y,z){this.x=x||0;this.y=y||0;this.z=z||0;}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
 copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
 clone(){return new V3(this.x,this.y,this.z);}
 sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
 cross(v){const x=this.x,y=this.y,z=this.z;
  this.x=y*v.z-z*v.y;this.y=z*v.x-x*v.z;this.z=x*v.y-y*v.x;return this;}
 lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
 length(){return Math.sqrt(this.lengthSq());}
 normalize(){const l=this.length()||1;this.x/=l;this.y/=l;this.z/=l;return this;}
}
/* Id-keyed element registry. getElementById has to hand back the SAME object every call or the
   lifecycle checks below are meaningless — a fresh blank stub per lookup would swallow every
   classList change photoEnter/photoExit make. Setting innerHTML pre-registers any id="…" inside it,
   which is how the panel's markup string becomes addressable without a real parser. */
const REG=new Map();
function mkEl(id){
 const cls=new Set();
 const e={
  _cls:cls,dataset:{},value:'',textContent:'',checked:false,title:'',
  style:{setProperty(){},cursor:''},
  classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c),
   toggle:(c,v)=>{const on=v===undefined?!cls.has(c):!!v;if(on)cls.add(c);else cls.delete(c);return on;}},
  get innerHTML(){return e._html||'';},
  set innerHTML(h){e._html=h;const re=/id="([^"]+)"/g;let m;while((m=re.exec(h)))REG.get(m[1])||REG.set(m[1],mkEl(m[1]));},
  get firstChild(){return e._fc||(e._fc=mkEl(id+':first'));},
  get lastChild(){return e._lc||(e._lc=mkEl(id+':last'));},
  appendChild(c){if(c&&c.id)REG.set(c.id,c);return c;},insertBefore(){},remove(){},
  addEventListener(){},querySelectorAll(){return[];},closest(){return null;},blur(){},
  onclick:null,onchange:null,oninput:null
 };
 Object.defineProperty(e,'id',{get(){return e._id||id||'';},set(v){e._id=v;REG.set(v,e);}});
 return e;
}
const el=id=>{if(!REG.has(id))REG.set(id,mkEl(id));return REG.get(id);};
const sandbox={
 console,Math,Date,JSON,parseFloat,parseInt,isFinite,Array,Object,String,Number,Boolean,Blob:function(){},
 setTimeout,atob:s=>Buffer.from(s,'base64').toString('binary'),
 innerWidth:1920,innerHeight:1080,devicePixelRatio:1,
 requestAnimationFrame(){},addEventListener(){},localStorage:{getItem(){return null;},setItem(){}},
 document:{getElementById:el,createElement:()=>mkEl(''),
  body:{appendChild(c){if(c&&c.id)REG.set(c.id,c);},_cls:new Set(),
   classList:{add(c){sandbox.document.body._cls.add(c);},remove(c){sandbox.document.body._cls.delete(c);},
    contains(c){return sandbox.document.body._cls.has(c);}}},
  querySelector:el,addEventListener(){}},
 matchMedia(){return{matches:false};},
 THREE:{Vector3:V3,Vector2:function(){this.x=0;this.y=0;}},
 navigator:{getGamepads(){return[];}}
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);
// core.js/config.js reference these at load; photo.js only touches them from live handlers.
// Matches initThree's camera: 55° vertical, near 1 / far 700, parked at the default match shot.
sandbox.__camPos=new V3(0,92,86);
vm.runInContext('var camera={position:__camPos,fov:55,near:1,far:700,up:{set(){}},'+
 'lookAt(){},rotateZ(){},updateProjectionMatrix(){}};var renderer=null,scene=null,rods=[];',sandbox);
vm.runInContext('var cvs={style:{},addEventListener(){}};',sandbox);
// Collaborators photo.js reaches for defensively. Each is the real thing's contract, no more.
vm.runInContext(`
 var Au={ui(){},beep(){}};
 var dbgOn=false, dbgToggles=0;
 function toggleDebug(){dbgOn=!dbgOn;dbgToggles++;}
 var toasts=[]; function toast(a,b){toasts.push(a+'|'+b);}
 var pauseToggles=0; function togglePause(){pauseToggles++;
  if(S.phase==='play'||S.phase==='count'){S.prePause=S.phase;S.phase='pause';}
  else if(S.phase==='pause')S.phase=S.prePause;}
 function seatRod(){return null;}
 var indicators=[],dropRing=null,ssBoxes=[],trnRing=null,dirLight=null;
 function clipStamp(){return '2026-08-17_120000';}
`,sandbox);

for(const f of ['js/core.js','js/config.js','js/state.js','js/photo.js'])
 vm.runInContext(read(f),sandbox,{filename:f});

/* ---- assertions ---- */
let pass=0,fail=0;
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);
function ok(name,cond,extra){
 if(cond){pass++;console.log('  ok   '+name);}
 else{fail++;console.log('  FAIL '+name+(extra?'   '+extra:''));}
}
const run=s=>vm.runInContext(s,sandbox);

console.log('\nphoto.js rig harness\n');

/* phWrap lands every angle in [-180,180) and is idempotent. */
console.log('phWrap');
for(const [inp,exp] of [[0,0],[180,-180],[-180,-180],[190,-170],[-190,170],[540,-180],[359,-1]])
 ok('phWrap('+inp+') = '+exp,near(run('phWrap('+inp+')'),exp,1e-9),'got '+run('phWrap('+inp+')'));

/* Offset → angles must round-trip, or every 'Focus' button and the seed aim somewhere else. */
console.log('\nphOff / angle round-trip');
for(const [yaw,pitch,dist] of [[0,0,100],[37,26,120],[-140,-55,40],[179,88,300]]){
 run('PH.yaw='+yaw+';PH.pitch='+pitch+';PH.dist='+dist+';PH.tx=0;PH.ty=0;PH.tz=0;');
 const o=run('phOff(new THREE.Vector3())');
 const d=Math.sqrt(o.x*o.x+o.y*o.y+o.z*o.z);
 const backYaw=run('phWrap(Math.atan2('+o.x+','+o.z+')*R2D)'),
       backPitch=Math.asin(o.y/d)*180/Math.PI;
 ok('yaw '+yaw+' pitch '+pitch+' dist '+dist,
  near(d,dist,1e-9)&&near(backYaw,yaw,1e-9)&&near(backPitch,pitch,1e-9),
  'd='+d+' yaw='+backYaw+' pitch='+backPitch);
}
/* yaw 0 must put the camera on +z (the near side) with +pitch above — the convention every camera
   preset and the panel's sign both assume. */
run('PH.yaw=0;PH.pitch=30;PH.dist=100;PH.tx=0;PH.ty=0;PH.tz=0;');
let c=run('phCamPos(new THREE.Vector3())');
ok('yaw 0 → camera on +z',c.z>0&&near(c.x,0,1e-9),'x='+c.x+' z='+c.z);
ok('+pitch → camera above target',c.y>0,'y='+c.y);

/* THE free-look invariant: rotating must not translate the camera. If this drifts, composing a
   shot becomes a fight — every look nudges the framing you just set. */
console.log('\nfree-look holds the camera still');
run('PH.free=true;PH.yaw=25;PH.pitch=15;PH.dist=90;PH.tx=4;PH.ty=9;PH.tz=-3;');
const before=run('phCamPos(new THREE.Vector3())');
run('phLook(-73,22);');
let after=run('phCamPos(new THREE.Vector3())');
ok('camera fixed through phLook',
 near(before.x,after.x,1e-9)&&near(before.y,after.y,1e-9)&&near(before.z,after.z,1e-9),
 JSON.stringify(before)+' vs '+JSON.stringify(after));
run('PH.free=false;PH.yaw=25;PH.pitch=15;PH.dist=90;PH.tx=4;PH.ty=9;PH.tz=-3;');
const oT={x:run('PH.tx'),y:run('PH.ty'),z:run('PH.tz')};
run('phOrbit(-73,22);');
ok('orbit holds the TARGET still',
 near(oT.x,run('PH.tx'),1e-9)&&near(oT.y,run('PH.ty'),1e-9)&&near(oT.z,run('PH.tz'),1e-9));
const om=run('phCamPos(new THREE.Vector3())');
ok('orbit MOVES the camera',Math.abs(om.x-before.x)+Math.abs(om.z-before.z)>1);

/* phAim in free mode: camera pinned, and it must genuinely end up pointing at the new target. */
console.log('\nphAim (free) re-derives without moving the camera');
run('PH.free=true;PH.yaw=-110;PH.pitch=40;PH.dist=150;PH.tx=0;PH.ty=7;PH.tz=0;');
const aBefore=run('phCamPos(new THREE.Vector3())');
run('phAim(-42,5,18);');
const aAfter=run('phCamPos(new THREE.Vector3())');
ok('camera unmoved',near(aBefore.x,aAfter.x,1e-6)&&near(aBefore.y,aAfter.y,1e-6)&&near(aBefore.z,aAfter.z,1e-6),
 JSON.stringify(aBefore)+' vs '+JSON.stringify(aAfter));
ok('target adopted',near(run('PH.tx'),-42)&&near(run('PH.ty'),5)&&near(run('PH.tz'),18));
ok('dist matches the real gap',
 near(run('PH.dist'),Math.hypot(aAfter.x+42,aAfter.y-5,aAfter.z-18),1e-6),'dist='+run('PH.dist'));

/* Crop rect: letterbox on a wider-than-target window, pillarbox on a narrower one. */
console.log('\nphCrop');
const crop=(w,h,a)=>{sandbox.innerWidth=w;sandbox.innerHeight=h;run('PH.aspect='+a+';');return run('phCrop()');};
let r=crop(1920,1080,16/9);
ok('16:9 on 16:9 → full frame',near(r.w,1920,1e-6)&&near(r.h,1080,1e-6)&&near(r.x,0,1e-6));
r=crop(1920,1200,16/9);
ok('16:9 on 16:10 → letterbox',near(r.w,1920,1e-6)&&near(r.h,1080,1e-6)&&near(r.y,60,1e-6),JSON.stringify(r));
r=crop(1920,1080,9/16);
ok('9:16 on 16:9 → pillarbox',near(r.h,1080,1e-6)&&near(r.w,607.5,1e-6),JSON.stringify(r));
r=crop(1920,1080,0);
ok('aspect 0 → whole window',near(r.w,1920)&&near(r.h,1080));

/* phCropFov is the piece that makes preview and capture agree. Verify it directly against what the
   mask shows: the captured half-extents must equal the on-screen full extents × (w/W, h/H). */
console.log('\nphCropFov — captured extents match the mask');
function extents(W,H,a,fov){
 sandbox.innerWidth=W;sandbox.innerHeight=H;
 run('PH.aspect='+a+';PH.fov='+fov+';');
 const cr=run('phCrop()'),f2=run('phCropFov('+JSON.stringify(cr)+')');
 const t=Math.tan(fov*Math.PI/360);                       // screen half-extents at unit depth
 const full={v:t,h:t*(W/H)};
 const t2=Math.tan(f2*Math.PI/360);
 const shot={v:t2,h:t2*(cr.w/cr.h)};
 return{want:{v:full.v*(cr.h/H),h:full.h*(cr.w/W)},got:shot,cr:cr,f2:f2};
}
for(const [W,H,a,fov,lab] of [
 [1920,1080,16/9,42,'16:9 on 16:9'],
 [1920,1200,16/9,42,'16:9 on 16:10 (letterbox)'],
 [1920,1080,9/16,42,'9:16 on 16:9 (pillarbox)'],
 [1280,1024,21/9,70,'21:9 on 5:4 (letterbox, wide lens)'],
 [1000,1000,4/5, 24,'4:5 on 1:1 (pillarbox, long lens)']]){
 const e=extents(W,H,a,fov);
 ok(lab,near(e.want.v,e.got.v,1e-9)&&near(e.want.h,e.got.h,1e-9),
  'want '+JSON.stringify(e.want)+' got '+JSON.stringify(e.got)+' fov\''+e.f2.toFixed(3));
}

/* Output size: exact multiple of the crop, and clamped to the GL ceiling with the aspect intact. */
console.log('\nphOutSize');
sandbox.innerWidth=1920;sandbox.innerHeight=1080;
run('PH.aspect='+(16/9)+';PH.scale=2;phMaxCache=8192;');
let o=run('phOutSize()');
ok('2× of 1920×1080 → 3840×2160',o.w===3840&&o.h===2160,o.w+'×'+o.h);
run('PH.scale=4;');
o=run('phOutSize()');
ok('4× clamps to the 8192 ceiling',o.w<=8192&&o.h<=8192,o.w+'×'+o.h);
ok('4× keeps 16:9 through the clamp',near(o.w/o.h,16/9,2e-3),(o.w/o.h).toFixed(5));
run('phMaxCache=4096;PH.scale=4;');
o=run('phOutSize()');
ok('tighter GL ceiling still respected',o.w<=4096&&o.h<=4096,o.w+'×'+o.h);
ok('...and still 16:9',near(o.w/o.h,16/9,2e-3),(o.w/o.h).toFixed(5));

/* phMove translates the rig along the camera's flat forward — the camera must come WITH the target
   (that's what makes 'track' work in both modes) and stay level. */
console.log('\nphMove tracks the rig, camera included');
run('phMaxCache=0;PH.free=false;PH.yaw=0;PH.pitch=20;PH.dist=100;PH.tx=0;PH.ty=8;PH.tz=0;');
const mBefore=run('phCamPos(new THREE.Vector3())');
run('phMove(10,0,0);');
const mAfter=run('phCamPos(new THREE.Vector3())');
ok('W at yaw 0 moves the target -z',near(run('PH.tz'),-10,1e-9),'tz='+run('PH.tz'));
ok('camera translated by the same vector',
 near(mAfter.z-mBefore.z,-10,1e-9)&&near(mAfter.x-mBefore.x,0,1e-9)&&near(mAfter.y-mBefore.y,0,1e-9));
run('PH.yaw=90;PH.tx=0;PH.tz=0;');
run('phMove(0,10,0);');
ok('strafe at yaw 90 is perpendicular to the yaw-0 case',near(run('PH.tz'),-10,1e-9),'tz='+run('PH.tz'));

/* Clamps: nothing the panel or a drag can do may push the rig outside CONFIG.photo.rig. */
console.log('\nclamps');
run('PH.free=false;phField("pitch",999);');
ok('pitch clamped to ±pitchMax',run('PH.pitch')===run('PHR.pitchMax'),String(run('PH.pitch')));
run('phField("dist",-999);');
ok('dist clamped to distMin',run('PH.dist')===run('PHR.distMin'),String(run('PH.dist')));
run('phField("fov",1e6);');
ok('fov clamped to fovMax',run('PH.fov')===run('PHR.fovMax'),String(run('PH.fov')));
run('phField("ty",-1e6);');
ok('target Y clamped to tYMin',run('PH.ty')===run('PHR.tYMin'),String(run('PH.ty')));
run('PH.yaw=170;phField("yaw",180);');
ok('orbit yaw slider does NOT wrap at the stop',run('PH.yaw')===180,String(run('PH.yaw')));
run('phField("pitch",NaN);');
ok('NaN from an emptied number box is ignored',run('PH.pitch')===run('PHR.pitchMax'));

/* Config sanity — the panel builds its sliders from these, so a bad range ships a lying control. */
console.log('\nCONFIG.photo');
ok('aspects all finite and ≥0',run('PHOTO.aspects.every(a=>isFinite(a.a)&&a.a>=0&&a.lab)'));
ok('defAspect indexes a real entry',run('!!PHOTO.aspects[PHOTO.defAspect]'));
ok('defScale is an offered scale',run('PHOTO.scales.indexOf(PHOTO.defScale)>=0'));
ok('rig defaults sit inside their own clamps',
 run('PHR.dist>=PHR.distMin&&PHR.dist<=PHR.distMax&&PHR.fov>=PHR.fovMin&&PHR.fov<=PHR.fovMax'+
     '&&Math.abs(PHR.pitch)<=PHR.pitchMax&&Math.abs(PHR.roll)<=PHR.rollMax'+
     '&&PHR.target.y>=PHR.tYMin&&PHR.target.y<=PHR.tYMax'));
ok('near < far and near > 0',run('PHR.near>0&&PHR.near<PHR.far'));
ok('S.photo starts null (the cross-module gate)',run('S.photo')===null);
ok('PH.freezeFx mirrors the config flag fx.js reads',run('PH.freezeFx===PHOTO.freezeFx'));

/* Lifecycle. This is where the cross-module contract lives: S.photo is the ONE thing main.js,
   fx.js, input.js and training.js gate on, so it has to be exactly null-or-PH, and entering from
   the pause screen has to leave the world frozen with no menu over it. */
console.log('\nenter / exit lifecycle');
const body=sandbox.document.body;
run('S.phase="menu";');
run('photoToggle();');
ok('F1 on the menu is refused',run('S.photo')===null&&run('PH.on')===false);
ok('...and says why',run('toasts.length')===1,run('toasts').join());

run('S.phase="play";S.balls=[];dbgOn=true;dbgToggles=0;');
run('photoToggle();');
ok('F1 in play enters',run('PH.on')===true);
ok('S.photo is the gate every other file reads',run('S.photo===PH'));
ok('freeze is on at the door',run('PH.freeze')===true);
ok('body gets .photoOn (the HUD blackout hook)',body.classList.contains('photoOn'));
ok('panel shown',!REG.get('phPanel')._cls.has('hidden'));
ok('framing overlay shown',!REG.get('phFrame')._cls.has('hidden'));
ok('debug overlay switched off (its proxies are scene meshes)',run('dbgOn')===false&&run('dbgToggles')===1);
ok('camera near/far widened for long lenses',run('camera.far')===run('PHR.far'));
ok('rig seeded from the match camera, not reset',run('PH.seeded')===true&&run('PH.dist')>1);

const seedYaw=run('PH.yaw');
run('PH.yaw=88;PH.roll=12;');
run('photoToggle();');
ok('F1 again exits',run('PH.on')===false&&run('S.photo')===null);
ok('.photoOn removed',!body.classList.contains('photoOn'));
ok('panel + overlay hidden',REG.get('phPanel')._cls.has('hidden')&&REG.get('phFrame')._cls.has('hidden'));
ok('camera near/far handed back',run('camera.far')===700&&run('camera.near')===1&&run('camera.fov')===55);
ok('debug overlay restored to how it was found',run('dbgOn')===true&&run('dbgToggles')===2);
run('photoToggle();');
ok('re-entry KEEPS the composition (no re-seed)',run('PH.yaw')===88&&run('PH.roll')===12,
 'yaw='+run('PH.yaw')+' seedYaw was '+seedYaw);
run('photoExit();');

console.log('\nentering from the pause screen');
run('S.phase="play";togglePause();pauseToggles=0;');
ok('precondition: paused',run('S.phase')==='pause');
run('photoToggle();');
ok('phase restored to what pause interrupted',run('S.phase')==='play');
ok('pause overlay hidden',REG.get('pause')._cls.has('hidden'));
ok('the world is still held — by the photo freeze, not by #pause',run('PH.freeze')===true);
run('photoExit();');
ok('exit re-pauses',run('S.phase')==='pause'&&run('pauseToggles')===1);
run('S.phase="play";');

console.log('\nself-heal when the match goes away underneath it');
run('photoEnter();S.phase="win";phTick(0.016);');
ok('phTick drops the mode once the phase is unshootable',run('PH.on')===false&&run('S.photo')===null);
ok('camera handed back on the way out',run('camera.fov')===55);

console.log('\nfreeze / step');
run('S.phase="play";photoEnter();');
run('PH.freeze=true;PH.stepQ=0;phStep();');
ok('Step queues exactly one sim slice',run('PH.stepQ')===1);
run('phToggleFreeze();');
ok('unfreezing clears the queue',run('PH.freeze')===false&&run('PH.stepQ')===0);
run('phToggleFreeze();phStep();phStep();');
ok('two steps queue two slices',run('PH.stepQ')===2);

console.log('\nscene hides restore cleanly');
run('S.balls=[{m:{visible:true},cur:{x:1,y:2,z:3}},{m:{visible:true},cur:{x:0,y:0,z:0}}];'+
    'rods=[{pivot:{visible:true},trnHidden:false},{pivot:{visible:true},trnHidden:true}];');
run('PH.hideBall=true;PH.hideRods=true;phSceneApply();');
ok('balls hidden',run('S.balls.every(b=>!b.m.visible)'));
ok('rods hidden',run('rods.every(r=>!r.pivot.visible)'));
run('photoExit();');
ok('balls back',run('S.balls.every(b=>b.m.visible)'));
ok('a rod TRAINING hid stays hidden — photo mode must not clobber another mode\'s state',
 run('rods[0].pivot.visible===true&&rods[1].pivot.visible===false'));

/* phTick is what main.js calls every frame — it must survive a real key map and a turntable sweep
   without touching anything that isn't there, and it must not creep the rig when nothing is held. */
console.log('\nphTick');
run('var keys={};S.phase="play";S.balls=[];rods=[];photoEnter();PH.spin=false;');
run('PH.yaw=10;PH.pitch=20;PH.dist=100;PH.tx=0;PH.ty=8;PH.tz=0;');
run('for(let i=0;i<30;i++)phTick(1/60);');
ok('idle frames do not drift the rig',run('PH.yaw')===10&&run('PH.pitch')===20&&run('PH.dist')===100&&run('PH.tz')===0);
run('PH.yaw=0;PH.tz=0;keys.KeyW=true;phTick(1);keys.KeyW=false;');   // yaw 0 → flat forward is -z
ok('held W tracks forward one keyPan per second',near(run('PH.tz'),-run('PHOTO.speed.keyPan'),1e-6),'tz='+run('PH.tz'));
// half a second, because a full second of sprint (70×3.4) overshoots tZMax and the clamp — correctly
// — eats the difference, which would make this assert the clamp rather than the multiplier.
run('PH.tz=0;keys.KeyW=true;keys.ShiftLeft=true;phTick(0.5);keys.KeyW=false;keys.ShiftLeft=false;');
ok('Shift multiplies by speed.fast',near(run('PH.tz'),-run('PHOTO.speed.keyPan*PHOTO.speed.fast*0.5'),1e-6),'tz='+run('PH.tz'));
run('PH.tz=0;keys.KeyW=true;keys.ShiftLeft=true;phTick(5);keys.KeyW=false;keys.ShiftLeft=false;');
ok('...and a long sprint still stops at tZMax',run('PH.tz')===-run('PHR.tZMax'),'tz='+run('PH.tz'));
run('PH.tz=0;keys.KeyW=true;keys.ControlLeft=true;phTick(1);keys.KeyW=false;keys.ControlLeft=false;');
ok('Ctrl multiplies by speed.fine',near(run('PH.tz'),-run('PHOTO.speed.keyPan*PHOTO.speed.fine'),1e-6));
run('PH.yaw=0;PH.spin=true;PH.spinSpeed=9;phTick(2);');
ok('turntable sweeps on WALL clock, so it works while frozen',near(run('PH.yaw'),18,1e-6),'yaw='+run('PH.yaw'));
run('PH.spin=false;');
run('PH.dist=100;keys.KeyZ=true;phTick(0.5);keys.KeyZ=false;');
ok('Z dollies in',run('PH.dist')<100);
run('PH.dist=PHR.distMin;keys.KeyZ=true;phTick(5);keys.KeyZ=false;');
ok('key dolly respects distMin',run('PH.dist')===run('PHR.distMin'));
run('photoExit();');

console.log('\nsaved shots round-trip through cfg');
run('S.phase="play";photoEnter();PH.hideBall=false;PH.hideRods=false;');
run('PH.yaw=-63;PH.pitch=41;PH.dist=175;PH.roll=-8;PH.fov=28;PH.tx=12;PH.ty=5;PH.tz=-9;PH.free=true;');
run('phShotSave(2);');
ok('slot written to cfg.photoShots',run('!!cfg.photoShots[2]'));
run('PH.yaw=0;PH.pitch=0;PH.dist=50;PH.roll=0;PH.fov=90;PH.tx=0;PH.ty=0;PH.tz=0;PH.free=false;');
run('phShotLoad(2);');
ok('every axis comes back',
 run('PH.yaw===-63&&PH.pitch===41&&PH.dist===175&&PH.roll===-8&&PH.fov===28&&PH.tx===12&&PH.ty===5&&PH.tz===-9&&PH.free===true'));
run('phShotLoad(5);');
ok('an empty slot says so instead of jumping the camera',run('PH.yaw')===-63&&/EMPTY/.test(run('PH.msg')));
ok('slot count matches CONFIG.photo.slots',run('PH.shots.length===PHOTO.slots'));
run('photoExit();');

console.log('\n'+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
