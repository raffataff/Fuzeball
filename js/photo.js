'use strict';
/* ================= photo mode (F1) =================
   A promotional-still studio. F1 during a match freezes the sim, drops the HUD and every dev
   panel, and hands the camera to an explicit rig — orbit or free-look — with numbers on screen
   for every axis so a shot can be composed exactly and repeated later.

   THE CAPTURE READS THE CANVAS ONLY. Same reasoning as the clip recorder (js/capture.js): the
   panel, the letterbox mask and the guides are DOM, so none of them can land in the picture.
   That is what lets the crop preview be LIVE — you frame against a mask sitting on top of the
   render and what you get is exactly what it enclosed.

   THE FREEZE IS NOT A PAUSE. #pause is a screen; it stops the world but it also puts a menu over
   the shot. Photo mode instead holds physAcc at zero (main.js, the same lever training's freeze
   pulls) AND holds the wall-clock timers — match clock, countdown, goal hold — so a goal replay
   can't open under the panel while you're lining a shot up. Entering from #pause is handled: the
   overlay comes down, the phase is put back to what it was, and Esc/F1 re-pauses on the way out.

   Cross-module gate is S.photo (null when off, PH while live), exactly like S.trn — every other
   file tests that and nothing else, so a missing photo.js can never break the game.
   All tuning is CONFIG.photo. Saved shots persist in cfg.photoShots. */
const PHR=PHOTO.rig;
const PH={on:false,freeze:false,stepQ:0,free:false,seeded:false,fromPause:false,
 tx:PHR.target.x,ty:PHR.target.y,tz:PHR.target.z,
 dist:PHR.dist,yaw:PHR.yaw,pitch:PHR.pitch,roll:PHR.roll,fov:PHR.fov,
 freezeFx:PHOTO.freezeFx,                       // read by fx.js — keeps particles/trails still
 spin:false,spinSpeed:PHOTO.spin.speed,
 aspect:PHOTO.aspects[PHOTO.defAspect]?PHOTO.aspects[PHOTO.defAspect].a:0,
 mask:true,thirds:true,cross:false,line:true,
 clean:false,panelHid:false,                    // chrome state — see phChromeSync
 rec:false,recCv:null,recCtx:null,recSweep:0,recT:0,recSpin:false,
 seq:false,seqCancel:false,seqI:0,seqN:0,          // offline sequence render — see phSeqStart
 seqH:PHOTO.seq.defHeight,seqFps:PHOTO.seq.defFps,seqSecs:PHOTO.seq.secs,seqFmt:PHOTO.seq.fmt,
 hideBall:false,hideRods:false,hideMarks:PHOTO.hideMarks,
 scale:PHOTO.defScale,shots:null,
 drag:null,camSave:null,dbgWas:false,busy:false,msg:'',msgT:0,readT:0};
let phBuilt=false,phSyncing=false,phPanel=null,phMaxCache=0;
const _pv=new THREE.Vector3(),_pv2=new THREE.Vector3(),_pv3=new THREE.Vector3(),
      _pv4=new THREE.Vector3(),_pUp=new THREE.Vector3(0,1,0);
const D2R=Math.PI/180,R2D=180/Math.PI;

/* ===== rig ===== */
/* Wrap to (-180,180]. Used for both absolute yaw and the shortest-path delta a slider has to
   travel when the rig is in free-look (where a yaw change moves the TARGET, not the camera). */
function phWrap(a){a=(a+180)%360;if(a<0)a+=360;return a-180;}
/* Target → camera offset. yaw 0 puts the camera on +z (the near side, matching the match cams);
   +pitch lifts it, so a positive pitch is looking DOWN. */
function phOff(v){
 const cp=Math.cos(PH.pitch*D2R),sp=Math.sin(PH.pitch*D2R),
       cy=Math.cos(PH.yaw*D2R),sy=Math.sin(PH.yaw*D2R);
 return v.set(cp*sy*PH.dist,sp*PH.dist,cp*cy*PH.dist);
}
function phCamPos(v){phOff(v);return v.set(PH.tx+v.x,PH.ty+v.y,PH.tz+v.z);}
/* FREE-LOOK rotation: hold the camera where it is and swing the TARGET instead. The rig itself is
   always an orbit — this is the only thing that distinguishes the two modes, which is why there's
   one set of limits and one set of panel numbers for both. */
function phLook(dy,dp){
 phCamPos(_pv);
 PH.yaw=phWrap(PH.yaw+dy);
 PH.pitch=clamp(PH.pitch+dp,-PHR.pitchMax,PHR.pitchMax);
 phOff(_pv2);
 PH.tx=_pv.x-_pv2.x;PH.ty=_pv.y-_pv2.y;PH.tz=_pv.z-_pv2.z;
}
function phOrbit(dy,dp){
 if(PH.free){phLook(dy,dp);return;}
 PH.yaw=phWrap(PH.yaw+dy);
 PH.pitch=clamp(PH.pitch+dp,-PHR.pitchMax,PHR.pitchMax);
}
/* Translate the whole rig (target AND camera — the offset is untouched, so the camera comes along)
   along the camera's flat forward / right / world up. This is 'track' in both modes. */
function phMove(fwd,side,up){
 if(!fwd&&!side&&!up)return;
 const sy=Math.sin(PH.yaw*D2R),cy=Math.cos(PH.yaw*D2R);
 // camera looks from +offset back at the target, so its flat forward is -(sy,cy)
 PH.tx=clamp(PH.tx-sy*fwd+cy*side,-PHR.tXMax,PHR.tXMax);
 PH.tz=clamp(PH.tz-cy*fwd-sy*side,-PHR.tZMax,PHR.tZMax);
 PH.ty=clamp(PH.ty+up,PHR.tYMin,PHR.tYMax);
}
/* Pan across the film plane (right-drag). Scaled by DISTANCE so the world keeps up with the cursor
   at any dolly — a fixed gain feels glued at 300 units out and violent at 10.
   Basis, because the order is easy to get backwards: right = fwd × up, up = right × fwd. (up × fwd
   gives -right, which pans the wrong way and is only obvious once you've built it.) */
function phPan(dx,dy){
 phCamPos(_pv);
 _pv2.set(PH.tx,PH.ty,PH.tz).sub(_pv).normalize();          // view direction, camera → target
 _pv3.copy(_pv2).cross(_pUp).normalize();                   // camera right
 if(_pv3.lengthSq()<1e-6)_pv3.set(1,0,0);                   // straight up/down: any right will do
 _pv4.copy(_pv3).cross(_pv2).normalize();                   // camera up
 const k=PHOTO.speed.dragPan*Math.max(.15,PH.dist/100);
 // drag right → the world follows the cursor, so the rig steps LEFT; drag down → the rig rises
 PH.tx=clamp(PH.tx-_pv3.x*dx*k+_pv4.x*dy*k,-PHR.tXMax,PHR.tXMax);
 PH.ty=clamp(PH.ty-_pv3.y*dx*k+_pv4.y*dy*k,PHR.tYMin,PHR.tYMax);
 PH.tz=clamp(PH.tz-_pv3.z*dx*k+_pv4.z*dy*k,-PHR.tZMax,PHR.tZMax);
}
/* Aim at a world point. In ORBIT that's just a new pivot; in FREE the camera must not jump, so the
   angles + distance are re-derived from where it already stands. */
function phAim(x,y,z){
 if(!PH.free){PH.tx=x;PH.ty=y;PH.tz=z;return;}
 phCamPos(_pv);
 PH.tx=x;PH.ty=y;PH.tz=z;
 const dx=_pv.x-x,dy=_pv.y-y,dz=_pv.z-z,d=Math.sqrt(dx*dx+dy*dy+dz*dz);
 if(d<1e-3)return;
 PH.dist=clamp(d,PHR.distMin,PHR.distMax);
 PH.pitch=clamp(Math.asin(clamp(dy/d,-1,1))*R2D,-PHR.pitchMax,PHR.pitchMax);
 PH.yaw=phWrap(Math.atan2(dx,dz)*R2D);
}
/* Pose the real camera. near/far are widened over the match camera's 1..700 (CONFIG.photo.rig) so
   a long lens from outside the room still clears its own backdrop. Roll is applied AFTER lookAt —
   it's a rotation about the view axis, i.e. a dutch tilt, not part of the aim. */
function phApply(){
 phCamPos(_pv);
 camera.position.copy(_pv);
 camera.up.set(0,1,0);
 camera.lookAt(PH.tx,PH.ty,PH.tz);
 if(PH.roll)camera.rotateZ(PH.roll*D2R);
 if(camera.fov!==PH.fov||camera.near!==PHR.near||camera.far!==PHR.far){
  camera.fov=PH.fov;camera.near=PHR.near;camera.far=PHR.far;camera.updateProjectionMatrix();
 }
}
/* Seed the rig from wherever the match camera is standing, so the first F1 never cuts the picture.
   Runs ONCE per session (and from the 'Match cam' button) — re-seeding on every entry would throw
   away a composition every time you stepped out to watch a rally. */
function phSeed(){
 PH.tx=PHR.target.x;PH.ty=PHR.target.y;PH.tz=PHR.target.z;
 const dx=camera.position.x-PH.tx,dy=camera.position.y-PH.ty,dz=camera.position.z-PH.tz,
       d=Math.sqrt(dx*dx+dy*dy+dz*dz);
 if(d>1){
  PH.dist=clamp(d,PHR.distMin,PHR.distMax);
  PH.pitch=clamp(Math.asin(clamp(dy/d,-1,1))*R2D,-PHR.pitchMax,PHR.pitchMax);
  PH.yaw=phWrap(Math.atan2(dx,dz)*R2D);
 }else{PH.dist=PHR.dist;PH.pitch=PHR.pitch;PH.yaw=PHR.yaw;}
 PH.roll=0;PH.fov=clamp(camera.fov,PHR.fovMin,PHR.fovMax);PH.free=false;PH.seeded=true;
}
function phReset(){
 PH.tx=PHR.target.x;PH.ty=PHR.target.y;PH.tz=PHR.target.z;
 PH.dist=PHR.dist;PH.yaw=PHR.yaw;PH.pitch=PHR.pitch;PH.roll=PHR.roll;PH.fov=PHR.fov;PH.free=false;
}

/* ===== framing =====
   The crop is a MASK over the live view; the capture reproduces exactly what it encloses. That
   only works because of phCropFov below — see the note there. */
function phCrop(){
 const W=innerWidth,H=innerHeight,a=PH.aspect;
 if(!a||!isFinite(a))return{x:0,y:0,w:W,h:H};
 let w=W,h=W/a;
 if(h>H){h=H;w=H*a;}
 return{x:(W-w)/2,y:(H-h)/2,w:w,h:h};
}
/* THE ONE PIECE OF MATHS HERE THAT ISN'T TASTE. A three.js `fov` is VERTICAL, so rendering the
   crop's aspect with the same fov would keep the vertical extent and CHANGE the horizontal — i.e.
   reveal scenery the mask was hiding, and the still would not be the shot you framed.
   What the mask actually does is scale BOTH extents by (w/W, h/H) of the full frame, so the
   capture needs the vertical fov narrowed by exactly the crop's height fraction:
       tan(f'/2) = tan(f/2) · h/H
   with aspect w/h. Letterbox (w=W, h<H) then keeps the horizontal and trims the vertical;
   pillarbox (h=H, w<W) leaves the fov alone and trims the horizontal. One formula, both cases. */
function phCropFov(c){
 return 2*Math.atan(Math.tan(PH.fov*D2R/2)*(c.h/innerHeight))*R2D;
}
/* Output pixels for the current crop + multiplier, clamped to whatever this GL implementation will
   actually give us. Reported live on the panel, because "4×" means nothing without the number. */
function phMaxPx(){
 if(phMaxCache)return phMaxCache;                 // cached: gl.getParameter can force a driver sync
 let m=PHOTO.maxPx,probed=false;
 try{
  const gl=renderer.getContext(),vp=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  m=Math.min(m,renderer.capabilities.maxTextureSize||m,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||m,
   (vp&&vp[0])||m,(vp&&vp[1])||m);
  probed=true;
 }catch(e){}
 m=Math.max(64,m|0);
 // only latch a limit we actually READ — caching the fallback off a failed probe would pin the
 // session to CONFIG.photo.maxPx even on a card that would have allowed less (or more).
 return probed?(phMaxCache=m):m;
}
function phOutSize(){
 const c=phCrop();
 let w=Math.max(1,Math.round(c.w*PH.scale)),h=Math.max(1,Math.round(c.h*PH.scale));
 const m=phMaxPx();
 if(w>m||h>m){const k=Math.min(m/w,m/h);w=Math.max(1,Math.round(w*k));h=Math.max(1,Math.round(h*k));}
 return{w:w,h:h,c:c};
}
function phFrameSync(){
 if(!phBuilt)return;
 const c=phCrop(),el=$('phCrop');
 el.style.left=c.x+'px';el.style.top=c.y+'px';el.style.width=c.w+'px';el.style.height=c.h+'px';
 el.classList.toggle('mask',PH.mask&&!!PH.aspect);
 el.classList.toggle('thirds',PH.thirds);
 // The crop rect used to be drawn unconditionally, escapable only via a 'bare' class that required
 // NO aspect — i.e. the one state with no crop to outline. So with a real aspect picked there was
 // no way to see the framing without a line across it, which is fatal for a screen-recorded take.
 // It's a guide like the other two now, with a checkbox of its own.
 el.classList.toggle('line',PH.line&&!!PH.aspect);
 el.classList.toggle('cross',PH.cross);
 const o=phOutSize(),ob=$('phOut');
 if(ob)ob.textContent=o.w+' × '+o.h;
}
addEventListener('resize',()=>{if(PH.on)phFrameSync();});

/* ===== chrome =====
   Two hides, because they answer different questions. H drops the PANEL — you are composing against
   the guides and want the controls out of the way. C drops EVERYTHING: panel, crop line, mask,
   guides. That second state is the one a screen-recorded turntable has to be shot in, and until it
   existed there wasn't one — the crop rect was drawn unconditionally (see phFrameSync).
   Neither touches the canvas, so neither can change a still or a clip; they only change what a
   screen recorder or a photographed monitor picks up. */
function phChromeSync(){
 if(!phBuilt)return;
 phPanel.classList.toggle('hidden',!PH.on||PH.clean||PH.panelHid);
 const fr=$('phFrame');if(fr)fr.classList.toggle('hidden',!PH.on||PH.clean);
 const b=$('phClean');if(b)b.classList.toggle('on',PH.clean);
}

/* ===== clip recorder (R) =====
   Records THE CROP as a webm — a turntable comes out already framed, with no chrome in it and
   nothing to trim afterwards.
     · Each frame the framed region of the game canvas is blitted into an off-screen canvas, and
       js/capture.js records THAT. One drawImage per frame; the encode itself is off-thread.
     · THE BLIT MUST RUN IN THE SAME TASK AS renderer.render — phPostRender is called immediately
       after it in main.js's loop. The renderer has no preserveDrawingBuffer, so the drawing buffer
       is only guaranteed intact until this task ends. Exactly the constraint phSnap's toDataURL
       works under, and the reason neither can be deferred to a callback.
     · Resolution comes from the LIVE backing store, so cfg.renderScale caps it. A still escapes
       that by re-rendering at pixel ratio 1; a video cannot, without re-rendering every frame at a
       size the compositor then has to swallow. Hence the panel printing the TRUE output size —
       a nominal '1080p' over a 0.6 render scale is a lie the file tells later.
     · Framing is LOCKED while rolling: the destination canvas cannot be resized mid-recording
       without tearing the stream, so the aspect select refuses and says why. */
function phRecRect(){
 const c=phCrop(),cw=cvs.width||1,ch=cvs.height||1,
       kx=cw/(cvs.clientWidth||innerWidth),ky=ch/(cvs.clientHeight||innerHeight);
 let sx=Math.max(0,Math.round(c.x*kx)),sy=Math.max(0,Math.round(c.y*ky)),
     sw=Math.round(c.w*kx),sh=Math.round(c.h*ky);
 if(sx+sw>cw)sw=cw-sx;                       // a rounded rect can overhang the backing store by a pixel
 if(sy+sh>ch)sh=ch-sy;
 sw=Math.max(2,sw);sh=Math.max(2,sh);
 let w=sw,h=sh;const m=Math.max(2,PHOTO.record.maxPx|0);
 if(w>m||h>m){const k=Math.min(m/w,m/h);w=Math.round(w*k);h=Math.round(h*k);}
 w-=w&1;h-=h&1;                              // every codec offered here subsamples chroma; odd edges are where they get fussy
 return{sx:sx,sy:sy,sw:sw,sh:sh,w:Math.max(2,w),h:Math.max(2,h)};
}
function phRecBlit(){
 const cx=PH.recCtx,cv=PH.recCv;if(!cx||!cv)return false;
 const r=phRecRect();
 if(r.sw<2||r.sh<2)return false;
 try{cx.drawImage(cvs,r.sx,r.sy,r.sw,r.sh,0,0,cv.width,cv.height);}catch(e){return false;}
 return true;
}
function phRecStart(){
 if(PH.rec||PH.seq)return;      // the panel stays clickable during an offline render; the key doesn't
 if(!PHOTO.record.on||typeof clipStart!=='function'){phMsg('RECORDER UNAVAILABLE');return;}
 const R=PHOTO.record,r=phRecRect(),cv=PH.recCv||(PH.recCv=document.createElement('canvas'));
 cv.width=r.w;cv.height=r.h;
 PH.recCtx=null;
 try{PH.recCtx=cv.getContext('2d',{alpha:false});}catch(e){}
 if(!PH.recCtx){phMsg('RECORDER UNAVAILABLE');return;}
 phRecBlit();      // seed a frame BEFORE the stream attaches, or its first sample is a blank canvas
 // the button's own click has to happen BEFORE the recorder attaches, or with record.audio on it
 // is the first thing on the soundtrack
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
 if(!clipStart(cv,{audio:R.audio,fps:R.fps,bitrate:R.bitrate,mime:R.mime})){phMsg('RECORDER REFUSED');return;}
 PH.rec=true;PH.recSweep=0;PH.recT=0;PH.recSpin=PH.spin;
 phSyncUI();
 phMsg('REC  '+cv.width+'×'+cv.height+((PH.recSpin&&R.autoStop)?'  ONE SWEEP':''));
}
/* Always PROMOTES the take. Unlike a goal clip — recorded speculatively on every goal and discarded
   unless someone asks for it — this recording only exists because it was started by hand, so an
   exit or a fault writes out what it got rather than binning it. */
function phRecStop(why){
 if(!PH.rec)return;
 PH.rec=false;
 const cv=PH.recCv,dim=cv?(cv.width+'×'+cv.height):'',t=Math.round(PH.recT*10)/10;
 let kept=false;
 try{kept=(typeof clipKeep==='function')&&clipKeep(PHOTO.record.prefix+'_'+
  (typeof clipStamp==='function'?clipStamp():Date.now()));}catch(e){}
 try{if(typeof clipStop==='function')clipStop();}catch(e){}
 phSyncUI();
 phMsg((kept?('CLIP SAVED  '+dim+'  '+t+'s'):'NOTHING RECORDED')+(why?('  ('+why+')'):''));
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phRecToggle(){if(PH.rec)phRecStop();else phRecStart();}
/* Panel readout. Idle it prints what a take WOULD produce (true pixels, and the sweep length at the
   current spin speed); rolling it becomes the elapsed clock. The on-screen dot is separate and
   deliberately survives clean view — with the panel down there would otherwise be no way to tell. */
function phRecSync(){
 if(!phBuilt)return;
 const R=PHOTO.record,el=$('phRecOut');
 if(el){
  if(PH.rec)el.textContent='● '+(Math.round(PH.recT*10)/10)+'s'+
   ((PH.recSpin&&R.autoStop)?('   '+Math.min(100,Math.round(PH.recSweep/3.6))+'%'):'');
  else{
   const r=phRecRect(),
    // which container you'll actually get, BEFORE recording 40s of it — MP4 everywhere that
    // supports it, WebM on Firefox. Cached per list, so this is free at the panel's 10Hz.
    ct=(typeof clipContainer==='function')?clipContainer(R.mime):'';
   el.textContent=r.w+' × '+r.h+(ct?('  ·  '+ct):'')+
    ((PH.spin&&R.autoStop&&PH.spinSpeed>0)?('  ·  '+(Math.round(3600/PH.spinSpeed)/10)+'s'):'');
  }
  el.classList.toggle('rec',PH.rec);
 }
 const b=$('phRecBtn');
 if(b){b.classList.toggle('on',PH.rec);
  const t=PH.rec?'■ STOP RECORDING (R)':'● RECORD CLIP (R)';
  if(b.textContent!==t)b.textContent=t;}
 const ind=$('phRec');if(ind)ind.classList.toggle('on',PH.rec);
}
/* Panel readout for the offline render. The ESTIMATE is the whole point of putting it here: a
   2160p PNG sequence is tens of gigabytes and nobody should discover that after pressing render. */
function phSeqSync(){
 if(!phBuilt)return;
 const el=$('phSeqOut'),b=$('phSeqBtn'),pl=phSeqPlan(),Q=PHOTO.seq,
       over=(pl.n>Q.maxFrames)||(pl.bytes>Q.maxBytes);
 if(el){
  el.textContent=pl.w+' × '+pl.h+'  ·  '+pl.n+' frames  ·  ~'+phBytes(pl.bytes);
  el.classList.toggle('warn',over);
 }
 if(b){
  b.classList.toggle('on',PH.seq);
  b.disabled=!PH.seq&&over;
  const t=PH.seq?'■ CANCEL RENDER (ESC)':'▦ RENDER SEQUENCE (SHIFT+R)';
  if(b.textContent!==t)b.textContent=t;
 }
}
/* Wall-clock like the rest of the tick. A take STARTED with the turntable running stops itself
   after exactly one revolution — that IS the shot — while a free take runs to maxSec. The sweep is
   accumulated from the same term phOrbit was just handed, so changing spin speed mid-take still
   lands on 360 degrees. */
function phRecTick(rdt){
 const R=PHOTO.record;
 PH.recT+=rdt;
 if(PH.spin)PH.recSweep+=Math.abs(PH.spinSpeed*rdt);
 if(PH.recSpin&&R.autoStop&&PH.recSweep>=360){phRecStop();return;}
 if(PH.recT>=R.maxSec)phRecStop('time limit');
}
/* Called from main.js immediately after renderer.render — see the note above on why 'immediately'
   is load-bearing. No-op unless a take is rolling. */
function phPostRender(){
 if(!PH.on||!PH.rec)return;
 if(!phRecBlit())phRecStop('frame grab failed');
}

/* ===== capture =====
   Render ONE frame into the real framebuffer at the output size and pixel ratio 1, read it, put
   everything back, and re-render — all inside this one task, so the browser never composites the
   oversized frame and nothing flashes.
     · pixelRatio 1 is deliberate: a player on cfg.renderScale 0.6 still gets a full-resolution
       still. The clip recorder can't do that (it reads the live backing store), which is exactly
       why stills go through here instead of a paused video grab.
     · toDataURL, not toBlob. The renderer has no preserveDrawingBuffer, so the buffer is only
       guaranteed intact until this task ends; toDataURL reads it synchronously, toBlob's timing
       is implementation-dependent. The base64 is converted to a Blob before the download so a
       multi-megabyte data: URL never has to go through an <a href>.
     · shadowBoost re-allocates the directional shadow map at the still's scale for the shot and
       drops it again after. A 2048 map stretched over an 8K frame is the one thing that reads as
       'game screenshot' rather than 'render', and it's two allocations a shot, not a per-frame cost.
   Nothing in here may throw into the game loop: every step is wrapped and the restore is in a
   finally, so a refused buffer size leaves the live view untouched. */
function phShutter(){
 if(!PHOTO.shutter||typeof Au==='undefined'||!Au.beep)return;
 try{Au.beep(2600,.025,'square',.10);setTimeout(()=>{try{Au.beep(1500,.035,'square',.075);}catch(e){}},45);}catch(e){}
}
function phFlashFx(){
 const f=$('phFlash');if(!f)return;
 f.style.transition='none';f.style.opacity='.92';
 requestAnimationFrame(()=>{f.style.transition='opacity '+PHOTO.flash+'s ease-out';f.style.opacity='0';});
}
function phSnap(){
 if(PH.busy||!renderer)return;
 PH.busy=true;
 const o=phOutSize(),c=o.c,sc=PH.scale;
 const pr=renderer.getPixelRatio(),sz=renderer.getSize(new THREE.Vector2()),
       fov=camera.fov,asp=camera.aspect;
 const sh=(typeof dirLight!=='undefined'&&dirLight)?dirLight.shadow:null;
 const msOld=(sh&&sh.mapSize)?{x:sh.mapSize.x,y:sh.mapSize.y}:null;
 let msMoved=false,url=null;
 try{
  if(sh&&msOld&&PHOTO.shadowBoost&&renderer.shadowMap.enabled){
   const t=Math.min(PHOTO.shadowMax,msOld.x*sc);
   if(t>msOld.x){sh.mapSize.set(t,t);shadowMapDrop(sh);msMoved=true;}
  }
  renderer.setPixelRatio(1);
  renderer.setSize(o.w,o.h,false);            // false = leave the canvas CSS size alone
  camera.fov=phCropFov(c);camera.aspect=c.w/c.h;camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  url=renderer.domElement.toDataURL('image/png');
 }catch(e){url=null;}
 finally{
  try{
   if(msMoved&&sh){sh.mapSize.set(msOld.x,msOld.y);shadowMapDrop(sh);}
   renderer.setPixelRatio(pr);renderer.setSize(sz.x,sz.y,false);
   camera.fov=fov;camera.aspect=asp;camera.updateProjectionMatrix();
   phApply();                                  // phApply owns fov/near/far while the mode is live
   renderer.render(scene,camera);              // restore the on-screen frame before anything composites
  }catch(e){}
  PH.busy=false;
 }
 if(!url||url.length<64){phMsg('CAPTURE FAILED — try a smaller size');return;}
 try{
  const i=url.indexOf(','),bin=atob(url.slice(i+1)),n=bin.length,arr=new Uint8Array(n);
  for(let k=0;k<n;k++)arr[k]=bin.charCodeAt(k);
  const name=PHOTO.prefix+'_'+(typeof clipStamp==='function'?clipStamp():Date.now())+'.png',
        blob=new Blob([arr],{type:'image/png'});
  if(typeof clipDownload==='function')clipDownload(blob,name);else phDownload(blob,name);
  phMsg('SAVED  '+o.w+'×'+o.h);
  phFlashFx();phShutter();
 }catch(e){phMsg('CAPTURE FAILED — out of memory?');}
}
// Local fallback for the download, so photo mode doesn't hard-depend on capture.js being present.
function phDownload(blob,file){
 const u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download=file;a.style.display='none';
 document.body.appendChild(a);a.click();
 setTimeout(()=>{a.remove();URL.revokeObjectURL(u);},20000);
}
// The HUD is faded in photo mode, so toast()/notice() would announce to nobody — status lands on
// the panel instead, where the person taking the picture is already looking.
function phMsg(s){PH.msg=s;PH.msgT=2.6;const el=$('phMsg');if(el){el.textContent=s;el.classList.add('on');}}

/* ===== offline turntable render (SHIFT+R) =====
   THE POINT: a turntable is a FROZEN sim plus a deterministic camera orbit, so there is no reason
   to capture it in real time — and three things a real-time capture cannot fix fall out for free.
     · EXACT CFR. MediaRecorder samples the canvas on a wall clock, so a frame the game was late
       for is held or dropped and the clip carries variable frame timing, which Premiere and
       Resolve both handle badly. Here frame i IS yaw i, whatever the machine was doing.
     · FULL RESOLUTION. Each frame re-renders at pixel ratio 1, exactly as phSnap does, so
       cfg.renderScale is irrelevant. A clip can never beat the live backing store.
     · NO CODEC. An image sequence imports natively into every NLE — nothing to transcode or remux.
   The sweep is 360°/n per frame over n frames, so the LAST frame sits one step short of the start
   and the sequence loops seamlessly.

   Two constraints shape the loop:
     · The drawImage into the output canvas must be in the SAME TASK as renderer.render (no
       preserveDrawingBuffer — the same rule phSnap and phPostRender work under). Encoding is the
       slow part and it happens AFTER, off that task, via toBlob on the 2D canvas.
     · The live size is restored BEFORE each await, so the rAF frame that lands in the gap draws
       the window normally. That's why the turntable is visibly previewing while it renders. */
function phBytes(n){
 if(n<1024)return n+' B';
 const u=['KB','MB','GB'];let i=-1;
 do{n/=1024;i++;}while(n>=1024&&i<u.length-1);
 return (n<10?Math.round(n*10)/10:Math.round(n))+' '+u[i];
}
/* Output pixels: HEIGHT is chosen (that's how a delivery spec is written), width follows the CROP's
   aspect so the sequence is the shot that was framed. Even on both axes for the encoders downstream. */
function phSeqSize(){
 const c=phCrop(),a=c.w/c.h,lim=Math.min(PHOTO.seq.maxPx|0,phMaxPx());
 let h=Math.max(2,PH.seqH|0),w=Math.max(2,Math.round(h*a));
 if(w>lim||h>lim){const k=Math.min(lim/w,lim/h);w=Math.round(w*k);h=Math.round(h*k);}
 w-=w&1;h-=h&1;
 return{w:Math.max(2,w),h:Math.max(2,h)};
}
function phSeqPlan(){
 const Q=PHOTO.seq,sz=phSeqSize(),
       n=Math.max(1,Math.round(PH.seqFps*PH.seqSecs)),
       bpp=(PH.seqFmt==='png')?Q.bpp.png:Q.bpp.jpeg;
 return{w:sz.w,h:sz.h,n:n,step:360/n,bytes:Math.round(sz.w*sz.h*bpp*n)};
}
function phSeqCancel(){
 if(!PH.seq)return;
 PH.seqCancel=true;phMsg('CANCELLING…');
}
async function phSeqStart(){
 const Q=PHOTO.seq;
 if(PH.seq||PH.busy||PH.rec||!renderer)return;
 if(!Q.on){phMsg('SEQUENCE RENDER IS OFF');return;}
 const pl=phSeqPlan();
 // Both caps are refusals, not clamps: silently rendering something other than what the panel
 // promised is worse than not starting. The panel prints both numbers before you commit.
 if(pl.n>Q.maxFrames){phMsg('TOO MANY FRAMES — '+pl.n+' > '+Q.maxFrames);return;}
 if(pl.bytes>Q.maxBytes){
  phMsg('~'+phBytes(pl.bytes)+' — over the '+phBytes(Q.maxBytes)+' cap');return;}

 PH.seq=true;PH.seqCancel=false;PH.seqI=0;PH.seqN=pl.n;PH.busy=true;
 phSyncUI();
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();

 const yaw0=PH.yaw,frz0=PH.freeze;
 PH.freeze=true;                                   // a turntable of a moving sim is not a turntable
 const pr=renderer.getPixelRatio(),sz0=renderer.getSize(new THREE.Vector2()),
       fov0=camera.fov,asp0=camera.aspect;
 const sh=(typeof dirLight!=='undefined'&&dirLight)?dirLight.shadow:null,
       msOld=(sh&&sh.mapSize)?{x:sh.mapSize.x,y:sh.mapSize.y}:null;
 let msMoved=false;
 const out=document.createElement('canvas');out.width=pl.w;out.height=pl.h;
 const octx=out.getContext('2d',{alpha:false}),
       png=(PH.seqFmt==='png'),mime=png?'image/png':'image/jpeg',ext=png?'.png':'.jpg',
       stamp=(typeof clipStamp==='function')?clipStamp():String(Date.now()),
       dir=Q.prefix+'_'+stamp,
       files=[];
 let total=0,err='';
 try{
  if(!octx)throw new Error('no 2d context');
  // ONE shadow-map reallocation for the whole sequence, not two per frame. Same reasoning as a
  // still: a 2048 map stretched over a 2160p frame is what reads as 'render' rather than 'game'.
  if(sh&&msOld&&Q.shadowBoost&&renderer.shadowMap.enabled){
   const k=Math.max(1,pl.h/Math.max(1,innerHeight)),
         t=Math.min(PHOTO.shadowMax,Math.round(msOld.x*k));
   if(t>msOld.x){sh.mapSize.set(t,t);shadowMapDrop(sh);msMoved=true;}
  }
  for(let i=0;i<pl.n;i++){
   if(PH.seqCancel)break;
   PH.seqI=i;
   PH.yaw=phWrap(yaw0+i*pl.step);
   phApply();
   phSceneApply();            // fxUpdate re-shows the markers in the rAF frames between ours
   const c=phCrop();
   renderer.setPixelRatio(1);
   renderer.setSize(pl.w,pl.h,false);
   camera.fov=phCropFov(c);camera.aspect=pl.w/pl.h;camera.updateProjectionMatrix();
   renderer.render(scene,camera);
   octx.drawImage(cvs,0,0,pl.w,pl.h,0,0,pl.w,pl.h);   // SAME TASK as the render — see the note above
   // back to the live size before we yield, so the frame the browser draws in the gap is normal
   renderer.setPixelRatio(pr);renderer.setSize(sz0.x,sz0.y,false);
   camera.fov=fov0;camera.aspect=asp0;camera.updateProjectionMatrix();
   phSeqProg(i+1,pl.n,total);
   const blob=await new Promise(r=>{try{out.toBlob(r,mime,Q.quality);}catch(e){r(null);}});
   if(!blob)throw new Error('frame encode failed');
   const buf=new Uint8Array(await blob.arrayBuffer());
   // the estimate is an estimate; this is the real thing, and it stops BEFORE the heap complains
   if(total+buf.length>Q.maxBytes){err='size cap hit at frame '+(i+1);break;}
   total+=buf.length;
   files.push({name:dir+'/frame_'+String(i+1).padStart(4,'0')+ext,data:buf});
  }
 }catch(e){err=err||(e&&e.message)||'render failed';}
 finally{
  try{
   if(msMoved&&sh){sh.mapSize.set(msOld.x,msOld.y);shadowMapDrop(sh);}
   renderer.setPixelRatio(pr);renderer.setSize(sz0.x,sz0.y,false);
   camera.fov=fov0;camera.aspect=asp0;camera.updateProjectionMatrix();
   PH.yaw=yaw0;PH.freeze=frz0;
   phApply();renderer.render(scene,camera);         // put the live view back before anything composites
  }catch(e){}
  PH.seq=false;PH.busy=false;PH.seqI=0;PH.seqN=0;
  phSeqProg(0,0,0);
 }

 // A CANCEL discards — it means "stop, I don't want this", and handing over a 700MB zip nobody
 // asked for is the wrong reading. A cap or a fault keeps what it got, which is salvageable.
 if(PH.seqCancel&&!err){PH.seqCancel=false;phMsg('RENDER CANCELLED');phSyncUI();return;}
 PH.seqCancel=false;
 if(!files.length){phMsg('RENDER FAILED — '+(err||'no frames'));phSyncUI();return;}
 try{
  if(Q.readme)files.push({name:dir+'/README.txt',
   data:new TextEncoder().encode(phSeqReadme(pl,files.length,png))});
  const zip=(typeof zipStore==='function')?zipStore(files):null;
  if(!zip)throw new Error('no zip writer');
  if(typeof clipDownload==='function')clipDownload(zip,dir+'.zip');else phDownload(zip,dir+'.zip');
  phMsg((err?'PARTIAL — ':'')+files.length+' FRAMES  '+pl.w+'×'+pl.h+'  '+phBytes(total)+
        (err?('  ('+err+')'):''));
  phFlashFx();phShutter();
 }catch(e){phMsg('ZIP FAILED — '+((e&&e.message)||'out of memory?'));}
 phSyncUI();
}
/* Everything an editor needs to use these, in the zip, because a folder of PNGs three months from
   now does not remember what frame rate it was meant to be. */
function phSeqReadme(pl,n,png){
 return 'Fuzeball turntable\r\n'+
  '\r\n'+
  'frames      '+n+'\r\n'+
  'resolution  '+pl.w+' x '+pl.h+'\r\n'+
  'frame rate  '+PH.seqFps+' fps  ('+(Math.round(n/PH.seqFps*100)/100)+'s)\r\n'+
  'format      '+(png?'PNG (lossless)':'JPEG q'+PHOTO.seq.quality)+'\r\n'+
  '\r\n'+
  'The sweep is exactly one revolution and the last frame stops one step short of the\r\n'+
  'first, so the sequence LOOPS seamlessly - no duplicate frame to trim.\r\n'+
  '\r\n'+
  'Import as an image sequence at '+PH.seqFps+' fps (Premiere, Resolve, After Effects and\r\n'+
  'Final Cut all read numbered sequences natively - point them at frame_0001 and tick\r\n'+
  '"image sequence"). Or encode it first:\r\n'+
  '\r\n'+
  '  ffmpeg -framerate '+PH.seqFps+' -i frame_%04d'+(png?'.png':'.jpg')+
  ' -c:v libx264 -crf 12 -pix_fmt yuv420p turntable.mp4\r\n'+
  '\r\n'+
  '  (-crf 12 is near-lossless for grading; -crf 18 is a smaller delivery file.)\r\n';
}
/* Progress lives on its own pill rather than the panel, because a render is very often started
   from clean view — where the panel is down and nothing else could tell you it's working. */
function phSeqProg(i,n,bytes){
 const el=$('phSeq');if(!el)return;
 if(!n){el.classList.remove('on');return;}
 el.classList.add('on');
 const b=$('phSeqBar'),t=$('phSeqTxt');
 if(b)b.style.width=Math.round(i/n*100)+'%';
 if(t)t.textContent='RENDERING  '+i+' / '+n+'   '+phBytes(bytes)+'   ESC to cancel';
}

/* ===== saved shots ===== */
function phShotsLoad(){
 const n=PHOTO.slots;
 PH.shots=(Array.isArray(cfg.photoShots)&&cfg.photoShots.length===n)?cfg.photoShots:new Array(n).fill(null);
}
function phShotSave(i){
 PH.shots[i]={tx:PH.tx,ty:PH.ty,tz:PH.tz,dist:PH.dist,yaw:PH.yaw,pitch:PH.pitch,roll:PH.roll,fov:PH.fov,free:PH.free};
 cfg.photoShots=PH.shots;saveCfg();phShotChips();phMsg('SHOT '+(i+1)+' SAVED');
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phShotLoad(i){
 const s=PH.shots&&PH.shots[i];if(!s){phMsg('SLOT '+(i+1)+' EMPTY');return;}
 PH.tx=s.tx;PH.ty=s.ty;PH.tz=s.tz;PH.dist=s.dist;PH.yaw=s.yaw;PH.pitch=s.pitch;PH.roll=s.roll;PH.fov=s.fov;PH.free=!!s.free;
 phSyncUI();phMsg('SHOT '+(i+1));
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phShotChips(){
 for(let i=0;i<PHOTO.slots;i++){
  const b=$('phSlot'+i),s=PH.shots&&PH.shots[i];if(!b)continue;
  b.classList.toggle('on',!!s);
  b.title=s?('yaw '+Math.round(s.yaw)+'° · pitch '+Math.round(s.pitch)+'° · '+Math.round(s.dist)+'u · '+Math.round(s.fov)+'mm-ish'):'empty — save first';
 }
}

/* ===== scene hides =====
   Written EVERY frame from phTick, which runs after fxUpdate/sweetGuideUpdate in the loop — those
   two own the markers and would put them straight back otherwise. The same ordering is what makes
   the restore free: stop writing and their owners re-show them on the next frame. Only the two
   things nothing else writes per-frame (ball meshes, rod pivots) are restored by hand on exit. */
function phSceneApply(){
 if(PH.hideBall)for(const b of S.balls)b.m.visible=false;
 if(PH.hideRods)for(const r of rods)r.pivot.visible=false;
 if(PH.hideMarks){
  if(typeof indicators!=='undefined')for(const m of indicators)m.visible=false;
  if(typeof dropRing!=='undefined'&&dropRing)dropRing.visible=false;
  if(typeof ssBoxes!=='undefined')for(const g of ssBoxes)g.visible=false;
  if(typeof trnRing!=='undefined'&&trnRing)trnRing.visible=false;
 }
}
function phSceneRestore(){
 for(const b of S.balls)b.m.visible=true;
 for(const r of rods)r.pivot.visible=!r.trnHidden;
}

/* ===== panel ===== */
// One row spec per driven number. Ranges come off CONFIG.photo.rig so a retune moves the sliders
// with the clamps — a slider whose end stops disagree with the clamp is a control that lies.
const PH_RIG=[
 {k:'yaw',  lab:'Yaw',   min:-180,           max:180,          st:1,u:'°'},
 {k:'pitch',lab:'Pitch', min:-PHR.pitchMax,  max:PHR.pitchMax, st:1,u:'°'},
 {k:'roll', lab:'Roll',  min:-PHR.rollMax,   max:PHR.rollMax,  st:1,u:'°'},
 {k:'dist', lab:'Dolly', min:PHR.distMin,    max:PHR.distMax,  st:1,u:'u'},
 {k:'fov',  lab:'Lens',  min:PHR.fovMin,     max:PHR.fovMax,   st:1,u:'°'}
];
const PH_TGT=[
 {k:'tx',lab:'Look X',min:-PHR.tXMax,max:PHR.tXMax,st:1,u:'u'},
 {k:'ty',lab:'Look Y',min:PHR.tYMin, max:PHR.tYMax,st:1,u:'u'},
 {k:'tz',lab:'Look Z',min:-PHR.tZMax,max:PHR.tZMax,st:1,u:'u'}
];
const PH_ALL=PH_RIG.concat(PH_TGT);
function phRowHTML(f){
 return '<div class="phS"><label>'+f.lab+'</label>'+
  '<input type="range" id="phR_'+f.k+'" min="'+f.min+'" max="'+f.max+'" step="'+f.st+'">'+
  '<input type="number" id="phN_'+f.k+'" min="'+f.min+'" max="'+f.max+'" step="'+f.st+'"><i>'+f.u+'</i></div>';
}
/* Write one rig field. yaw/pitch route through phOrbit so a slider obeys the mode the same way a
   drag does — in free-look the camera must not slide sideways just because you nudged Yaw. */
function phField(k,v){
 if(!isFinite(v))return;
 switch(k){
  // ORBIT writes yaw straight so the slider can't jump: phWrap sends +180 to -180, i.e. the thumb
  // teleports to the far end the moment you touch the top stop. FREE has to go through the delta
  // path (the camera must stay put), where that wrap is both correct and unavoidable.
  case 'yaw':   {const t=clamp(v,-180,180);if(PH.free)phLook(phWrap(t-PH.yaw),0);else PH.yaw=t;}break;
  case 'pitch': phOrbit(0,clamp(v,-PHR.pitchMax,PHR.pitchMax)-PH.pitch);break;
  case 'roll':  PH.roll=clamp(v,-PHR.rollMax,PHR.rollMax);break;
  case 'dist':  PH.dist=clamp(v,PHR.distMin,PHR.distMax);break;
  case 'fov':   PH.fov=clamp(v,PHR.fovMin,PHR.fovMax);break;
  case 'tx':    PH.tx=clamp(v,-PHR.tXMax,PHR.tXMax);break;
  case 'ty':    PH.ty=clamp(v,PHR.tYMin,PHR.tYMax);break;
  case 'tz':    PH.tz=clamp(v,-PHR.tZMax,PHR.tZMax);break;
 }
}
function phBindRow(f){
 const r=$('phR_'+f.k),n=$('phN_'+f.k);
 const set=e=>{if(phSyncing)return;phField(f.k,parseFloat(e.target.value));phSyncNums();};
 r.oninput=set;n.oninput=set;
}
/* Split in two on purpose. phSyncNums runs at 10Hz off the tick (the rig moves under mouse drags,
   key nudges and the turntable, and the readouts have to follow); phSyncUI is the whole panel and
   only fires when something DISCRETE changed. Ticking the full sync would rewrite eight checkboxes,
   two selects and a button's textContent ten times a second for no reason. */
function phSyncNums(){
 if(!phBuilt)return;
 phSyncing=true;
 for(const f of PH_ALL){
  const v=PH[f.k],r=$('phR_'+f.k),n=$('phN_'+f.k);
  if(r)r.value=v;if(n)n.value=Math.round(v*10)/10;
 }
 phSyncing=false;
}
function phSyncUI(){
 if(!phBuilt)return;
 phSyncNums();
 phSyncing=true;
 $('phFreeze').classList.toggle('on',PH.freeze);
 $('phMode').classList.toggle('on',PH.free);
 const mt=PH.free?'FREE LOOK (F)':'ORBIT (F)';
 if($('phMode').textContent!==mt)$('phMode').textContent=mt;
 $('phSpin').classList.toggle('on',PH.spin);
 $('phSpinRow').classList.toggle('hidden',!PH.spin);
 $('phSpinR').value=PH.spinSpeed;$('phSpinN').value=PH.spinSpeed;
 $('phAspect').value=String(PH.aspect);
 $('phScale').value=String(PH.scale);
 $('phMask').checked=PH.mask;$('phThirds').checked=PH.thirds;$('phCross').checked=PH.cross;
 $('phLine').checked=PH.line;
 $('phSeqH').value=String(PH.seqH);$('phSeqFps').value=String(PH.seqFps);
 $('phSeqFmt').value=PH.seqFmt;
 $('phSeqSecR').value=PH.seqSecs;$('phSeqSecN').value=PH.seqSecs;
 $('phHideBall').checked=PH.hideBall;$('phHideRods').checked=PH.hideRods;$('phHideMarks').checked=PH.hideMarks;
 phSyncing=false;
 phFrameSync();phChromeSync();phRecSync();phSeqSync();
}
function phBuild(){
 if(phBuilt)return;phBuilt=true;
 phShotsLoad();
 // framing overlay — separate element from the panel so it can sit under the panel's z-index and
 // still be pointer-transparent across the whole window.
 const fr=document.createElement('div');fr.id='phFrame';fr.className='hidden';
 fr.innerHTML='<div id="phCrop">'+
  '<i class="phL v" style="left:33.333%"></i><i class="phL v" style="left:66.667%"></i>'+
  '<i class="phL h" style="top:33.333%"></i><i class="phL h" style="top:66.667%"></i>'+
  '<i class="phX"></i></div>';
 document.body.appendChild(fr);
 const fl=document.createElement('div');fl.id='phFlash';document.body.appendChild(fl);
 // Rolling indicator. DOM, so it can never land in the recording — and it deliberately survives
 // clean view, which is the only state where the panel can't tell you a take is running.
 const ri=document.createElement('div');ri.id='phRec';ri.innerHTML='<i></i>REC';document.body.appendChild(ri);
 // Sequence-render progress. Same reasoning as the REC dot: a render is usually started from clean
 // view, where the panel is down and nothing else could report it.
 const sqp=document.createElement('div');sqp.id='phSeq';
 sqp.innerHTML='<span id="phSeqTxt"></span><div class="phSeqTrk"><i id="phSeqBar"></i></div>';
 document.body.appendChild(sqp);

 let asp='';for(const a of PHOTO.aspects)asp+='<option value="'+a.a+'">'+a.lab+'</option>';
 let scl='';for(const s of PHOTO.scales)scl+='<option value="'+s+'">'+s+'×</option>';
 let hgt='';for(const h of PHOTO.seq.heights)hgt+='<option value="'+h+'">'+h+'p</option>';
 let fps='';for(const f of PHOTO.seq.fps)fps+='<option value="'+f+'">'+f+' fps</option>';
 const p=document.createElement('div');p.id='phPanel';p.className='hidden';phPanel=p;
 p.innerHTML=
  '<h3>PHOTO MODE <button class="phMin" id="phMin" title="collapse — F1 exits">—</button></h3>'+
  '<div class="phBody">'+
  '<div class="phSect">Shot</div>'+
  '<div class="phBtns"><button class="phBtn" id="phFreeze">Freeze (P)</button><button class="phBtn" id="phStep">Step (O)</button></div>'+
  '<div class="phBtns"><button class="phBtn" id="phMode">ORBIT (F)</button><button class="phBtn" id="phSpin">Turntable (T)</button></div>'+
  '<div class="phBtns"><button class="phBtn" id="phClean">Clean view (C)</button></div>'+
  '<div class="phS hidden" id="phSpinRow"><label>Spin</label><input type="range" id="phSpinR" min="'+PHOTO.spin.min+'" max="'+PHOTO.spin.max+'" step="1"><input type="number" id="phSpinN" min="'+PHOTO.spin.min+'" max="'+PHOTO.spin.max+'" step="1"><i>°/s</i></div>'+
  '<div class="phSect">Camera</div>'+
  PH_RIG.map(phRowHTML).join('')+
  '<div class="phBtns"><button class="phBtn" id="phLevel">Level roll</button><button class="phBtn" id="phFromCam">Match cam</button><button class="phBtn" id="phReset">Reset</button></div>'+
  '<div class="phSect">Look at</div>'+
  PH_TGT.map(phRowHTML).join('')+
  '<div class="phBtns">'+
   '<button class="phBtn" data-fo="ball">Ball</button>'+
   '<button class="phBtn" data-fo="mid">Centre</button>'+
   '<button class="phBtn" data-fo="rod">Held rod</button>'+
   '<button class="phBtn" data-fo="g0">Goal 1</button>'+
   '<button class="phBtn" data-fo="g1">Goal 2</button></div>'+
  '<div class="phSect">Framing</div>'+
  '<div class="phRow"><label>Aspect</label><select id="phAspect">'+asp+'</select></div>'+
  '<div class="phRow"><label>Frame line</label><input type="checkbox" id="phLine"></div>'+
  '<div class="phRow"><label>Mask outside</label><input type="checkbox" id="phMask"></div>'+
  '<div class="phRow"><label>Rule of thirds</label><input type="checkbox" id="phThirds"></div>'+
  '<div class="phRow"><label>Centre cross</label><input type="checkbox" id="phCross"></div>'+
  '<div class="phSect">Scene</div>'+
  '<div class="phRow"><label>Hide ball</label><input type="checkbox" id="phHideBall"></div>'+
  '<div class="phRow"><label>Hide rods &amp; players</label><input type="checkbox" id="phHideRods"></div>'+
  '<div class="phRow"><label>Hide markers</label><input type="checkbox" id="phHideMarks"></div>'+
  '<div class="phSect">Shots</div>'+
  '<div class="phRow"><label>Save</label><span class="phSlots" id="phSave"></span></div>'+
  '<div class="phRow"><label>Load</label><span class="phSlots" id="phLoad"></span></div>'+
  '<div class="phSect">Capture</div>'+
  '<div class="phRow"><label>Size</label><select id="phScale">'+scl+'</select><span class="phHint" id="phOut"></span></div>'+
  '<div class="phBtns"><button class="phBtn wide snap" id="phSnapBtn">◉ TAKE PHOTO (SPACE)</button></div>'+
  '<div class="phBtns"><button class="phBtn wide rec" id="phRecBtn">● RECORD CLIP (R)</button></div>'+
  '<div class="phRow"><label>Clip</label><span class="phHint" id="phRecOut"></span></div>'+
  '<div class="phSect">Turntable sequence</div>'+
  '<div class="phRow"><label>Height</label><select id="phSeqH">'+hgt+'</select>'+
   '<select id="phSeqFps">'+fps+'</select></div>'+
  '<div class="phS"><label>Length</label><input type="range" id="phSeqSecR" min="'+PHOTO.seq.secsMin+
   '" max="'+PHOTO.seq.secsMax+'" step="1"><input type="number" id="phSeqSecN" min="'+PHOTO.seq.secsMin+
   '" max="'+PHOTO.seq.secsMax+'" step="1"><i>s</i></div>'+
  '<div class="phRow"><label>Format</label><select id="phSeqFmt">'+
   '<option value="jpeg">JPEG</option><option value="png">PNG</option></select></div>'+
  '<div class="phBtns"><button class="phBtn wide seq" id="phSeqBtn">▦ RENDER SEQUENCE (SHIFT+R)</button></div>'+
  '<div class="phRow"><label>Sequence</label><span class="phHint" id="phSeqOut"></span></div>'+
  '<div class="phMsg" id="phMsg"></div>'+
  '<div class="phInfo" id="phInfo"></div>'+
  '<div class="phKeys">'+
   '<b>drag</b><span>orbit / look</span>'+
   '<b>R-drag</b><span>pan</span>'+
   '<b>wheel</b><span>dolly</span>'+
   '<b>W A S D</b><span>track</span>'+
   '<b>Q E</b><span>up / down</span>'+
   '<b>↑↓←→</b><span>orbit</span>'+
   '<b>Z X</b><span>dolly</span>'+
   '<b>SHIFT / CTRL</b><span>fast / fine</span>'+
   '<b>1 – '+PHOTO.slots+'</b><span>load shot</span>'+
   '<b>SHIFT 1 – '+PHOTO.slots+'</b><span>save shot</span>'+
   '<b>G</b><span>guides</span><b>H</b><span>hide panel</span>'+
   '<b>C</b><span>clean view</span><b>R</b><span>record clip</span>'+
   '<b>SHIFT R</b><span>render sequence</span>'+
   '<b>F1 / ESC</b><span>exit</span>'+
  '</div>'+
  '</div>';
 document.body.appendChild(p);
 // blur any clicked control so SPACE (take photo) can't re-fire the button under the cursor
 p.addEventListener('click',e=>{const b=e.target.closest('button');if(b)b.blur();});
 // the panel scrolls, and it is TALL. Stop the wheel here so scrolling it can never reach a
 // window-level handler (input.js's rod-switch wheel is already gated on S.photo — this is the
 // guard for anything added later that isn't).
 p.addEventListener('wheel',e=>{e.stopPropagation();},{passive:true});

 for(const f of PH_ALL)phBindRow(f);
 $('phMin').onclick=()=>p.classList.toggle('phCollapsed');
 $('phFreeze').onclick=()=>phToggleFreeze();
 $('phStep').onclick=()=>phStep();
 $('phMode').onclick=()=>{PH.free=!PH.free;phSyncUI();};
 $('phSpin').onclick=()=>{PH.spin=!PH.spin;phSyncUI();};
 $('phClean').onclick=()=>{PH.clean=!PH.clean;phChromeSync();};
 const ss=e=>{if(phSyncing)return;PH.spinSpeed=clamp(parseFloat(e.target.value)||0,PHOTO.spin.min,PHOTO.spin.max);phSyncUI();};
 $('phSpinR').oninput=ss;$('phSpinN').oninput=ss;
 $('phLevel').onclick=()=>{PH.roll=0;phSyncUI();};
 $('phFromCam').onclick=()=>{phSeed();phSyncUI();phMsg('RIG FROM MATCH CAM');};
 $('phReset').onclick=()=>{phReset();phSyncUI();};
 p.querySelectorAll('[data-fo]').forEach(b=>{b.onclick=()=>phFocus(b.dataset.fo);});
 // locked while rolling — the recorder's destination canvas is sized once and can't be re-shaped
 // mid-stream, so a re-frame here would either tear the clip or silently squash it.
 $('phAspect').onchange=e=>{
  if(PH.rec){e.target.value=String(PH.aspect);phMsg('STOP THE RECORDING TO RE-FRAME');return;}
  PH.aspect=parseFloat(e.target.value)||0;phSyncUI();};
 $('phScale').onchange=e=>{PH.scale=parseFloat(e.target.value)||1;phSyncUI();};
 $('phLine').onchange=e=>{PH.line=e.target.checked;phFrameSync();};
 $('phMask').onchange=e=>{PH.mask=e.target.checked;phFrameSync();};
 $('phThirds').onchange=e=>{PH.thirds=e.target.checked;phFrameSync();};
 $('phCross').onchange=e=>{PH.cross=e.target.checked;phFrameSync();};
 $('phHideBall').onchange=e=>{PH.hideBall=e.target.checked;if(!PH.hideBall)phSceneRestore();};
 $('phHideRods').onchange=e=>{PH.hideRods=e.target.checked;if(!PH.hideRods)phSceneRestore();};
 $('phHideMarks').onchange=e=>{PH.hideMarks=e.target.checked;};
 $('phSnapBtn').onclick=()=>phSnap();
 $('phRecBtn').onclick=()=>phRecToggle();
 $('phSeqBtn').onclick=()=>{if(PH.seq)phSeqCancel();else phSeqStart();};
 $('phSeqH').onchange=e=>{PH.seqH=parseInt(e.target.value,10)||PHOTO.seq.defHeight;phSyncUI();};
 $('phSeqFps').onchange=e=>{PH.seqFps=parseInt(e.target.value,10)||PHOTO.seq.defFps;phSyncUI();};
 $('phSeqFmt').onchange=e=>{PH.seqFmt=e.target.value==='png'?'png':'jpeg';phSyncUI();};
 const sq=e=>{if(phSyncing)return;
  PH.seqSecs=clamp(parseFloat(e.target.value)||PHOTO.seq.secs,PHOTO.seq.secsMin,PHOTO.seq.secsMax);
  phSyncUI();};
 $('phSeqSecR').oninput=sq;$('phSeqSecN').oninput=sq;
 const sv=$('phSave'),ld=$('phLoad');
 for(let i=0;i<PHOTO.slots;i++){
  const a=document.createElement('button');a.className='phBtn slot';a.textContent=String(i+1);a.onclick=()=>phShotSave(i);sv.appendChild(a);
  const b=document.createElement('button');b.className='phBtn slot';b.id='phSlot'+i;b.textContent=String(i+1);b.onclick=()=>phShotLoad(i);ld.appendChild(b);
 }
 phShotChips();
}
/* Focus presets. Goal x is ±L/2; the aim point sits at bar height so a goal shot frames the mouth
   rather than the floor in front of it. */
function phFocus(w){
 const gy=F.goalH*.55;
 if(w==='ball'){const b=S.balls[0];if(b){phAim(b.cur?b.cur.x:b.m.position.x,(b.cur?b.cur.y:b.m.position.y)+1,b.cur?b.cur.z:b.m.position.z);phMsg('AIMED AT BALL');return;}phMsg('NO BALL IN PLAY');return;}
 if(w==='mid'){phAim(0,PHR.target.y,0);return;}
 if(w==='g0'){phAim(-F.L/2,gy,0);return;}
 if(w==='g1'){phAim(F.L/2,gy,0);return;}
 if(w==='rod'){
  const s=S.seats[0],r=s&&typeof seatRod==='function'?seatRod(s):null;
  if(!r){phMsg('NO ROD HELD');return;}
  phAim(r.x,ROD_H*.6,r.offset);return;
 }
}

/* ===== freeze ===== */
function phToggleFreeze(){PH.freeze=!PH.freeze;PH.stepQ=0;phSyncUI();if(typeof Au!=='undefined'&&Au.ui)Au.ui();}
function phStep(){if(!PH.freeze)phToggleFreeze();PH.stepQ++;}

/* ===== enter / exit ===== */
/* In-match only. The freeze and the HUD hide are both meaningless on a menu, and #home/#league are
   DOM screens that would sit over the shot anyway. Entering from #pause takes the overlay down and
   restores the phase it interrupted, so you get the frozen world WITHOUT the menu — which is the
   whole ask. phExit re-pauses if that's where we came from. */
function photoAllowed(){
 return PHOTO.on&&(S.phase==='play'||S.phase==='count'||S.phase==='goal'||S.phase==='pause');
}
function photoToggle(){
 if(PH.on){photoExit();return;}
 if(!photoAllowed()){
  if(PHOTO.on&&typeof toast==='function')toast('PHOTO MODE','start a match first',1.3);
  return;
 }
 photoEnter();
}
function photoEnter(){
 phBuild();
 PH.on=true;S.photo=PH;
 PH.fromPause=(S.phase==='pause');
 if(PH.fromPause){S.phase=S.prePause;$('pause').classList.add('hidden');}
 PH.camSave={fov:camera.fov,near:camera.near,far:camera.far};
 if(!PH.seeded)phSeed();
 PH.freeze=!!PHOTO.freezeOnEnter;PH.stepQ=0;PH.drag=null;
 // the C-overlay's proxies are scene meshes — they WOULD be in the picture. Off for the duration,
 // back on at exit if that's how it was found.
 PH.dbgWas=(typeof dbgOn!=='undefined'&&dbgOn);
 if(PH.dbgWas&&PHOTO.hideDebug&&typeof toggleDebug==='function')toggleDebug();
 if(S.trn&&typeof trnSetPlacing==='function')trnSetPlacing(false);
 document.body.classList.add('photoOn');
 PH.clean=false;PH.panelHid=false;phChromeSync();
 cvs.style.cursor='crosshair';
 phSyncUI();phApply();
 phMsg('F1 or ESC to exit');
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function photoExit(){
 if(!PH.on)return;
 // Refused while a sequence renders: tearing the mode down mid-loop would strand the renderer at
 // the output size. Ask the render to stop; photoGuard re-fires on a later frame and exits then.
 if(PH.seq){phSeqCancel();return;}
 // a take still rolling is written out, not binned — it was started deliberately (see phRecStop)
 if(PH.rec)phRecStop('photo mode closed');
 PH.on=false;S.photo=null;PH.drag=null;
 document.body.classList.remove('photoOn');
 PH.clean=false;PH.panelHid=false;phChromeSync();
 phSceneRestore();
 if(PH.camSave){camera.fov=PH.camSave.fov;camera.near=PH.camSave.near;camera.far=PH.camSave.far;
  camera.updateProjectionMatrix();PH.camSave=null;}
 if(PH.dbgWas&&PHOTO.hideDebug&&typeof toggleDebug==='function'&&typeof dbgOn!=='undefined'&&!dbgOn)toggleDebug();
 PH.dbgWas=false;
 cvs.style.cursor='';
 if(PH.fromPause){PH.fromPause=false;if(S.phase==='play'||S.phase==='count')togglePause();}
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
// Backstop: a match that ends (or is quit) while the panel is up must not leave the camera stranded
// on the rig. gotoMenu/endMatch don't know about photo mode, so the tick self-heals instead.
// Deliberately deferred while a sequence renders: tearing the mode down mid-loop would strand the
// renderer at the output size. The render's own finally puts everything back, then this fires.
function photoGuard(){if(PH.on&&!PH.seq&&!photoAllowed())photoExit();}

/* ===== per-frame ===== */
/* Called from main.js AFTER fxUpdate / sweetGuideUpdate — see phSceneApply for why that ordering is
   load-bearing. Everything here is wall-clock (rdt), so the turntable and the key nudges keep
   working with the sim frozen, which is the point. */
function phTick(rdt){
 photoGuard();if(!PH.on)return;
 // An offline render drives the rig itself, one frame at a time. Letting the tick spin, nudge or
 // re-apply the camera in the gaps between those frames would corrupt the sweep.
 if(PH.seq)return;
 const SP=PHOTO.speed;
 let m=1;
 if(keys.ShiftLeft||keys.ShiftRight)m*=SP.fast;
 if(keys.ControlLeft||keys.ControlRight||keys.AltLeft||keys.AltRight)m*=SP.fine;
 const dt=rdt*m;
 let f=0,s=0,u=0,dy=0,dp=0,dd=0;
 if(keys.KeyW)f+=SP.keyPan*dt; if(keys.KeyS)f-=SP.keyPan*dt;
 if(keys.KeyD)s+=SP.keyPan*dt; if(keys.KeyA)s-=SP.keyPan*dt;
 if(keys.KeyQ)u+=SP.keyRise*dt;if(keys.KeyE)u-=SP.keyRise*dt;
 if(keys.ArrowLeft)dy-=SP.keyOrbit*dt; if(keys.ArrowRight)dy+=SP.keyOrbit*dt;
 if(keys.ArrowUp)dp+=SP.keyOrbit*dt;   if(keys.ArrowDown)dp-=SP.keyOrbit*dt;
 if(keys.KeyZ)dd-=SP.keyDolly*dt;      if(keys.KeyX)dd+=SP.keyDolly*dt;
 if(f||s||u)phMove(f,s,u);
 if(dy||dp)phOrbit(dy,dp);
 if(dd)PH.dist=clamp(PH.dist+dd,PHR.distMin,PHR.distMax);
 if(PH.spin)phOrbit(PH.spinSpeed*rdt,0);           // turntable: wall-clock, so it sweeps while frozen
 if(PH.rec)phRecTick(rdt);
 phApply();
 phSceneApply();
 if(f||s||u||dy||dp||dd||PH.spin)PH.readT=0;       // moving → refresh the numbers on the next tick
 PH.readT-=rdt;
 if(PH.readT<=0){PH.readT=.1;phSyncNums();phReadout();phRecSync();}
 if(PH.msgT>0){PH.msgT-=rdt;if(PH.msgT<=0){const el=$('phMsg');if(el)el.classList.remove('on');}}
}
function phReadout(){
 const el=$('phInfo');if(!el)return;
 phCamPos(_pv);
 el.innerHTML='<span>cam</span><b>'+_pv.x.toFixed(1)+'</b><b>'+_pv.y.toFixed(1)+'</b><b>'+_pv.z.toFixed(1)+'</b><br>'+
  '<span>look</span><b>'+PH.tx.toFixed(1)+'</b><b>'+PH.ty.toFixed(1)+'</b><b>'+PH.tz.toFixed(1)+'</b><br>'+
  '<span>sim</span><b class="st">'+(PH.freeze?'FROZEN':'LIVE')+'</b>'+
  '<span>fx</span><b>'+((PH.freeze&&PH.freezeFx)?'held':'running')+'</b>';
}

/* ===== input =====
   input.js and training.js both bail while S.photo is set, so these are the only handlers acting.
   Mouse move/up live on WINDOW so a drag that leaves the canvas still tracks. */
addEventListener('keydown',e=>{
 if(!PHOTO.on)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 // A sequence render owns the keyboard outright — every key that could move the rig or tear the
 // mode down has to be inert until it finishes. Esc/F1 cancel instead of doing their usual job.
 if(PH.on&&PH.seq){
  if(e.code==='Escape'||e.code===PHOTO.key){e.preventDefault();phSeqCancel();}
  return;
 }
 if(e.code===PHOTO.key){e.preventDefault();if(!e.repeat)photoToggle();return;}  // F1 is the browser's help key
 if(!PH.on)return;
 if(e.code==='AltLeft'||e.code==='AltRight')e.preventDefault();                // Alt alone focuses the browser menu bar
 if(e.repeat)return;
 if(e.code==='Escape'){photoExit();return;}
 if(e.code==='Space'){e.preventDefault();phSnap();return;}
 if(e.code==='KeyP'){phToggleFreeze();return;}
 if(e.code==='KeyO'){phStep();return;}
 if(e.code==='KeyF'){PH.free=!PH.free;phSyncUI();return;}
 if(e.code==='KeyT'){PH.spin=!PH.spin;phSyncUI();return;}
 if(e.code==='KeyH'){PH.panelHid=!PH.panelHid;phChromeSync();return;}
 if(e.code==='KeyC'){PH.clean=!PH.clean;phChromeSync();return;}
 if(e.code==='KeyR'){if(e.shiftKey)phSeqStart();else phRecToggle();return;}
 // G cycles the guides rather than toggling one, so a single key covers clean → thirds → thirds+cross.
 // The crop LINE is not in this cycle on purpose: it marks where the frame is, so it wants to stay
 // up while you compose against the thirds. C is what takes everything down at once.
 if(e.code==='KeyG'){
  if(!PH.thirds&&!PH.cross){PH.thirds=true;}
  else if(PH.thirds&&!PH.cross){PH.cross=true;}
  else{PH.thirds=false;PH.cross=false;}
  phSyncUI();return;
 }
 const d=/^Digit([1-9])$/.exec(e.code);
 if(d){const i=+d[1]-1;if(i<PHOTO.slots){if(e.shiftKey)phShotSave(i);else phShotLoad(i);}return;}
});
cvs.addEventListener('mousedown',e=>{
 if(!PH.on||PH.seq)return;
 e.preventDefault();
 // 0 = orbit/look · 2 (or shift+0) = pan · 1 = dolly. Shift is also the 'fast' modifier for keys,
 // which is deliberate: a modifier that changes what a drag DOES can't also change how fast it does it.
 const mode=(e.button===2||(e.button===0&&e.shiftKey))?'pan':e.button===1?'dolly':'orbit';
 PH.drag={mode:mode,x:e.clientX,y:e.clientY};
 cvs.style.cursor=mode==='pan'?'move':'crosshair';
});
addEventListener('mousemove',e=>{
 if(!PH.on||!PH.drag)return;
 const dx=e.clientX-PH.drag.x,dy=e.clientY-PH.drag.y;
 PH.drag.x=e.clientX;PH.drag.y=e.clientY;
 const SP=PHOTO.speed;
 if(PH.drag.mode==='pan')phPan(dx,dy);
 else if(PH.drag.mode==='dolly')PH.dist=clamp(PH.dist*(1+dy*SP.dragDolly),PHR.distMin,PHR.distMax);
 else phOrbit(-dx*SP.dragOrbit,dy*SP.dragOrbit);   // drag right → the table turns right; drag down → look from higher
 PH.readT=0;
});
addEventListener('mouseup',()=>{if(PH.on&&PH.drag){PH.drag=null;cvs.style.cursor='crosshair';}});
cvs.addEventListener('wheel',e=>{
 if(!PH.on||PH.seq)return;
 e.preventDefault();
 // proportional dolly: one notch moves a fixed FRACTION of the current distance, so the step stays
 // useful at 8 units out and at 300. A linear step is unusable at one end or the other.
 const k=1+PHOTO.speed.wheel*(e.deltaY>0?1:-1)*((keys.ShiftLeft||keys.ShiftRight)?3:1);
 PH.dist=clamp(PH.dist*k,PHR.distMin,PHR.distMax);
 PH.readT=0;
},{passive:false});
