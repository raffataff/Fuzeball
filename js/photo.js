'use strict';
// ================= photo mode (F1) =================
// a promotional-still studio: freezes the sim, drops the HUD and dev panels, hands the camera to an orbit or free-look rig
// the capture reads the canvas only (panel, mask and guides are DOM); the freeze isn't a pause: physAcc and the wall-clock timers are held
// gate is S.photo; tuning in CONFIG.photo; saved shots in cfg.photoShots
const PHR=PHOTO.rig;
// Fallback so an older config.js can only cost the path feature, not the whole mode.
const PHP=PHOTO.path||{on:false,secs:8,secsMin:1,secsMax:60,maxPts:12,smooth:true,ease:true,
 loop:false,live:false,recAutoPlay:true,recAutoStop:true,recTail:.4,prefix:'fuzeball_path'};
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
 // camera path, see the block above phPathPts; `path` is slot indices, resolved at play time
 path:null,pathDur:PHP.secs,pathSmooth:PHP.smooth,pathEase:PHP.ease,pathLoop:PHP.loop,
 pathLive:PHP.live,play:false,playT:0,playHold:-1,playPose:null,pathPts:null,recPath:false,
 open:null,                                     // which panel sections are expanded — see phGrp
 drag:null,camSave:null,dbgWas:false,busy:false,msg:'',msgT:0,readT:0};
let phBuilt=false,phSyncing=false,phPanel=null,phMaxCache=0;
const _pv=new THREE.Vector3(),_pv2=new THREE.Vector3(),_pv3=new THREE.Vector3(),
      _pv4=new THREE.Vector3(),_pUp=new THREE.Vector3(0,1,0);
const D2R=Math.PI/180,R2D=180/Math.PI;

// ===== rig =====
// wrap to (-180,180], for absolute yaw and shortest-path slider deltas
function phWrap(a){a=(a+180)%360;if(a<0)a+=360;return a-180;}
// target to camera offset; yaw 0 puts the camera on +z, positive pitch looks down
function phOff(v){
 const cp=Math.cos(PH.pitch*D2R),sp=Math.sin(PH.pitch*D2R),
       cy=Math.cos(PH.yaw*D2R),sy=Math.sin(PH.yaw*D2R);
 return v.set(cp*sy*PH.dist,sp*PH.dist,cp*cy*PH.dist);
}
function phCamPos(v){phOff(v);return v.set(PH.tx+v.x,PH.ty+v.y,PH.tz+v.z);}
// free-look: hold the camera and swing the target; the rig is always an orbit
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
// translate the whole rig along the camera's flat forward / right / world up ('track' in both modes)
function phMove(fwd,side,up){
 if(!fwd&&!side&&!up)return;
 const sy=Math.sin(PH.yaw*D2R),cy=Math.cos(PH.yaw*D2R);
 // camera looks from +offset back at the target, so its flat forward is -(sy,cy)
 PH.tx=clamp(PH.tx-sy*fwd+cy*side,-PHR.tXMax,PHR.tXMax);
 PH.tz=clamp(PH.tz-cy*fwd-sy*side,-PHR.tZMax,PHR.tZMax);
 PH.ty=clamp(PH.ty+up,PHR.tYMin,PHR.tYMax);
}
// pan across the film plane (right-drag), scaled by distance so it keeps up with the cursor
// basis: right = fwd x up, up = right x fwd
function phPan(dx,dy){
 phCamPos(_pv);
 _pv2.set(PH.tx,PH.ty,PH.tz).sub(_pv).normalize();          // view direction, camera → target
 _pv3.copy(_pv2).cross(_pUp).normalize();                   // camera right
 if(_pv3.lengthSq()<1e-6)_pv3.set(1,0,0);                   // straight up/down: any right will do
 _pv4.copy(_pv3).cross(_pv2).normalize();                   // camera up
 const k=PHOTO.speed.dragPan*Math.max(.15,PH.dist/100);
 // drag right: the rig steps left; drag down: it rises
 PH.tx=clamp(PH.tx-_pv3.x*dx*k+_pv4.x*dy*k,-PHR.tXMax,PHR.tXMax);
 PH.ty=clamp(PH.ty-_pv3.y*dx*k+_pv4.y*dy*k,PHR.tYMin,PHR.tYMax);
 PH.tz=clamp(PH.tz-_pv3.z*dx*k+_pv4.z*dy*k,-PHR.tZMax,PHR.tZMax);
}
// aim at a world point: orbit gets a new pivot, free re-derives angles and distance so the camera doesn't jump
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
// pose the real camera; near/far widened over the match camera's; roll is applied after lookAt
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
// seed the rig from the match camera, once per session and from the 'Match cam' button
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

// ===== framing =====
// the crop is a mask over the live view and the capture reproduces what it encloses (see phCropFov)
function phCrop(){
 const W=innerWidth,H=innerHeight,a=PH.aspect;
 if(!a||!isFinite(a))return{x:0,y:0,w:W,h:H};
 let w=W,h=W/a;
 if(h>H){h=H;w=H*a;}
 return{x:(W-w)/2,y:(H-h)/2,w:w,h:h};
}
// a three.js fov is vertical, so the capture narrows it by the crop's height fraction: tan(f'/2) = tan(f/2) * h/H, aspect w/h
function phCropFov(c){
 return 2*Math.atan(Math.tan(PH.fov*D2R/2)*(c.h/innerHeight))*R2D;
}
// output pixels for the crop and multiplier, clamped to what this GL gives; shown live on the panel
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
 // only latch a limit we actually read, not the fallback of a failed probe
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
 // the crop line is a guide with its own checkbox, so a screen-recorded take can hide it
 el.classList.toggle('line',PH.line&&!!PH.aspect);
 el.classList.toggle('cross',PH.cross);
 const o=phOutSize(),ob=$('phOut');
 if(ob)ob.textContent=o.w+' × '+o.h;
}
addEventListener('resize',()=>{if(PH.on)phFrameSync();});

// ===== chrome =====
// H drops the panel; C drops everything (panel, crop line, mask, guides); neither touches the canvas
function phChromeSync(){
 if(!phBuilt)return;
 phPanel.classList.toggle('hidden',!PH.on||PH.clean||PH.panelHid);
 const fr=$('phFrame');if(fr)fr.classList.toggle('hidden',!PH.on||PH.clean);
 const b=$('phClean');if(b)b.classList.toggle('on',PH.clean);
}

// ===== clip recorder (R) =====
// records the crop: each frame the framed region is blitted to an off-screen canvas that js/capture.js records; the blit must run in the same task as renderer.render (phPostRender)
// resolution follows the live backing store (cfg.renderScale caps it); framing is locked while rolling
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
 // an armed path means the take is the move: start it from the top, before the seed blit
 if(PHP.on&&PHP.recAutoPlay&&phPathArmed()&&!PH.play&&phPathStart()){
  try{phApply();renderer.render(scene,camera);}catch(e){}
 }
 phRecBlit();      // seed a frame BEFORE the stream attaches, or its first sample is a blank canvas
 // click sound before the recorder attaches, or it ends up on the soundtrack (record.audio)
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
 if(!clipStart(cv,{audio:R.audio,fps:R.fps,bitrate:R.bitrate,mime:R.mime})){phMsg('RECORDER REFUSED');return;}
 PH.rec=true;PH.recSweep=0;PH.recT=0;PH.recSpin=PH.spin;PH.recPath=PH.play;
 phSyncUI();
 phMsg('REC  '+cv.width+'×'+cv.height+
  ((PH.recPath&&PHP.recAutoStop)?('  PATH  '+PH.pathDur+'s'):
   ((PH.recSpin&&R.autoStop)?'  ONE SWEEP':'')));
}
// always promotes the take: it was started by hand, so an exit or fault writes out what it got
function phRecStop(why){
 if(!PH.rec)return;
 const wasPath=PH.recPath;
 PH.rec=false;PH.recPath=false;
 const cv=PH.recCv,dim=cv?(cv.width+'×'+cv.height):'',t=Math.round(PH.recT*10)/10;
 let kept=false;
 try{kept=(typeof clipKeep==='function')&&clipKeep((wasPath?PHP.prefix:PHOTO.record.prefix)+'_'+
  (typeof clipStamp==='function'?clipStamp():Date.now()));}catch(e){}
 try{if(typeof clipStop==='function')clipStop();}catch(e){}
 phSyncUI();
 phMsg((kept?('CLIP SAVED  '+dim+'  '+t+'s'):'NOTHING RECORDED')+(why?('  ('+why+')'):''));
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phRecToggle(){if(PH.rec)phRecStop();else phRecStart();}
// panel readout: idle shows what a take would produce, rolling shows elapsed; the on-screen dot survives clean view
function phRecSync(){
 if(!phBuilt)return;
 const R=PHOTO.record,el=$('phRecOut');
 if(el){
  if(PH.rec)el.textContent='● '+(Math.round(PH.recT*10)/10)+'s'+
   ((PH.recSpin&&R.autoStop)?('   '+Math.min(100,Math.round(PH.recSweep/3.6))+'%'):'');
  else{
   const r=phRecRect(),
    // which container you'll get (MP4, WebM on Firefox); cached per list
    ct=(typeof clipContainer==='function')?clipContainer(R.mime):'';
   // whichever move a take would make: an armed path takes over from the turntable
   const mv=(PHP.on&&phPathArmed()&&PHP.recAutoStop)?('  ·  path '+PH.pathDur+'s'):
    ((PH.spin&&R.autoStop&&PH.spinSpeed>0)?('  ·  '+(Math.round(3600/PH.spinSpeed)/10)+'s'):'');
   el.textContent=r.w+' × '+r.h+(ct?('  ·  '+ct):'')+mv;
  }
  el.classList.toggle('rec',PH.rec);
 }
 const b=$('phRecBtn');
 if(b){b.classList.toggle('on',PH.rec);
  const t=PH.rec?'■ STOP RECORDING (R)':'● RECORD CLIP (R)';
  if(b.textContent!==t)b.textContent=t;}
 const ind=$('phRec');if(ind)ind.classList.toggle('on',PH.rec);
}
// panel readout for the offline render, with a size estimate (a 2160p PNG sequence is tens of GB)
function phSeqSync(){
 if(!phBuilt)return;
 const el=$('phSeqOut'),b=$('phSeqBtn'),pl=phSeqPlan(),Q=PHOTO.seq,
       over=(pl.n>Q.maxFrames)||(pl.bytes>Q.maxBytes);
 if(el){
  el.textContent=(pl.path?'path':'turntable')+'  ·  '+pl.w+' × '+pl.h+'  ·  '+pl.n+
   ' frames  ·  ~'+phBytes(pl.bytes);
  el.classList.toggle('warn',over);
 }
 // the turntable's Length is dead while a path is armed, so it's greyed
 const sr=$('phSeqSecR'),sn=$('phSeqSecN'),sw=$('phSeqSecRow');
 if(sr)sr.disabled=pl.path;if(sn)sn.disabled=pl.path;
 if(sw)sw.classList.toggle('off',pl.path);
 if(b){
  b.classList.toggle('on',PH.seq);
  b.disabled=!PH.seq&&(over||(pl.path&&PH.pathLive));
  const t=PH.seq?'■ CANCEL RENDER (ESC)':
   ((pl.path&&PH.pathLive)?'▦ LIVE SWEEP — RECORD WITH R':'▦ RENDER SEQUENCE (SHIFT+R)');
  if(b.textContent!==t)b.textContent=t;
 }
}
// wall-clock like the rest of the tick; a take started with the turntable stops after one revolution, a free take at maxSec
function phRecTick(rdt){
 const R=PHOTO.record;
 PH.recT+=rdt;
 if(PH.spin)PH.recSweep+=Math.abs(PH.spinSpeed*rdt);
 if(PH.recSpin&&R.autoStop&&PH.recSweep>=360){phRecStop();return;}
 // the path was the take: stopping it by hand ends the recording
 if(PH.recPath&&!PH.play&&PHP.recAutoStop){phRecStop();return;}
 if(PH.recT>=R.maxSec)phRecStop('time limit');
}
// called from main.js immediately after renderer.render (see above); no-op unless a take is rolling
function phPostRender(){
 if(!PH.on||!PH.rec)return;
 if(!phRecBlit())phRecStop('frame grab failed');
}

// ===== capture =====
// render one frame into the real framebuffer at the output size and pixel ratio 1, read it, restore, re-render, all in one task
// toDataURL, not toBlob (no preserveDrawingBuffer), converted to a Blob for the download; shadowBoost reallocates the shadow map at the still's scale
// nothing may throw into the game loop: every step is wrapped, the restore is in a finally
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
// local download fallback so photo mode doesn't depend on capture.js
function phDownload(blob,file){
 const u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download=file;a.style.display='none';
 document.body.appendChild(a);a.click();
 setTimeout(()=>{a.remove();URL.revokeObjectURL(u);},20000);
}
// the HUD is faded in photo mode, so status goes on the panel
function phMsg(s){PH.msg=s;PH.msgT=2.6;const el=$('phMsg');if(el){el.textContent=s;el.classList.add('on');}}

// ===== offline turntable render (SHIFT+R) =====
// a frozen sim plus a deterministic orbit, so render it offline: exact CFR, full resolution (pixel ratio 1), no codec (PNG sequence); 360/n per frame, so the sequence loops
// the drawImage must be in the same task as renderer.render, encoding happens after via toBlob; the live size is restored before each await
function phBytes(n){
 if(n<1024)return n+' B';
 const u=['KB','MB','GB'];let i=-1;
 do{n/=1024;i++;}while(n>=1024&&i<u.length-1);
 return (n<10?Math.round(n*10)/10:Math.round(n))+' '+u[i];
}
// output pixels: height is chosen, width follows the crop's aspect; even on both axes
function phSeqSize(){
 const c=phCrop(),a=c.w/c.h,lim=Math.min(PHOTO.seq.maxPx|0,phMaxPx());
 let h=Math.max(2,PH.seqH|0),w=Math.max(2,Math.round(h*a));
 if(w>lim||h>lim){const k=Math.min(lim/w,lim/h);w=Math.round(w*k);h=Math.round(h*k);}
 w-=w&1;h-=h&1;
 return{w:Math.max(2,w),h:Math.max(2,h)};
}
// an armed path owns this button, and its duration replaces the turntable's Length
function phSeqPlan(){
 const Q=PHOTO.seq,sz=phSeqSize(),path=PHP.on&&phPathArmed(),
       secs=path?PH.pathDur:PH.seqSecs,
       n=Math.max(1,Math.round(PH.seqFps*secs)),
       bpp=(PH.seqFmt==='png')?Q.bpp.png:Q.bpp.jpeg;
 return{w:sz.w,h:sz.h,n:n,secs:secs,path:path,step:360/n,bytes:Math.round(sz.w*sz.h*bpp*n)};
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
 // a live sweep can't render offline (the sim runs at wall-clock under a slow encode): refused
 if(pl.path&&PH.pathLive){phMsg('LIVE SWEEP CANNOT RENDER OFFLINE — USE R');return;}
 const pathPts=pl.path?phPathPts():null;
 if(pl.path&&!pathPts){phMsg('PATH POINTS AT EMPTY SLOTS');return;}
 // both caps are refusals, not clamps; the panel prints both numbers first
 if(pl.n>Q.maxFrames){phMsg('TOO MANY FRAMES — '+pl.n+' > '+Q.maxFrames);return;}
 if(pl.bytes>Q.maxBytes){
  phMsg('~'+phBytes(pl.bytes)+' — over the '+phBytes(Q.maxBytes)+' cap');return;}

 PH.seq=true;PH.seqCancel=false;PH.seqI=0;PH.seqN=pl.n;PH.busy=true;
 phSyncUI();
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();

 // a path moves all eight fields, so restore the whole pose
 const pose0={tx:PH.tx,ty:PH.ty,tz:PH.tz,dist:PH.dist,yaw:PH.yaw,pitch:PH.pitch,roll:PH.roll,fov:PH.fov},
       frz0=PH.freeze;
 if(PH.play)phPathStop();                            // the live preview and the render cannot both drive the rig
 if(pathPts)PH.pathPts=phPathCtrl(pathPts,PH.pathLoop);
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
       dir=(pl.path?PHP.prefix:Q.prefix)+'_'+stamp,
       files=[];
 let total=0,err='';
 try{
  if(!octx)throw new Error('no 2d context');
  // one shadow-map reallocation for the whole sequence
  if(sh&&msOld&&Q.shadowBoost&&renderer.shadowMap.enabled){
   const k=Math.max(1,pl.h/Math.max(1,innerHeight)),
         t=Math.min(PHOTO.shadowMax,Math.round(msOld.x*k));
   if(t>msOld.x){sh.mapSize.set(t,t);shadowMapDrop(sh);msMoved=true;}
  }
  for(let i=0;i<pl.n;i++){
   if(PH.seqCancel)break;
   PH.seqI=i;
   // a loop stops one step short of the seam; a one-shot move runs to u=1 inclusive
   if(pathPts)phPathApply(PH.pathLoop?(i/pl.n):(pl.n>1?i/(pl.n-1):0));
   else PH.yaw=phWrap(pose0.yaw+i*pl.step);
   phApply();
   phSceneApply();            // fxUpdate re-shows the markers in the rAF frames between ours
   const c=phCrop();
   renderer.setPixelRatio(1);
   renderer.setSize(pl.w,pl.h,false);
   camera.fov=phCropFov(c);camera.aspect=pl.w/pl.h;camera.updateProjectionMatrix();
   renderer.render(scene,camera);
   octx.drawImage(cvs,0,0,pl.w,pl.h,0,0,pl.w,pl.h);   // SAME TASK as the render — see the note above
   // back to the live size before we yield
   renderer.setPixelRatio(pr);renderer.setSize(sz0.x,sz0.y,false);
   camera.fov=fov0;camera.aspect=asp0;camera.updateProjectionMatrix();
   phSeqProg(i+1,pl.n,total);
   const blob=await new Promise(r=>{try{out.toBlob(r,mime,Q.quality);}catch(e){r(null);}});
   if(!blob)throw new Error('frame encode failed');
   const buf=new Uint8Array(await blob.arrayBuffer());
   // the estimate is an estimate; this is the real cap, and it stops before the heap complains
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
   PH.pathPts=null;
   PH.tx=pose0.tx;PH.ty=pose0.ty;PH.tz=pose0.tz;PH.dist=pose0.dist;PH.yaw=pose0.yaw;
   PH.pitch=pose0.pitch;PH.roll=pose0.roll;PH.fov=pose0.fov;PH.freeze=frz0;
   phApply();renderer.render(scene,camera);         // put the live view back before anything composites
  }catch(e){}
  PH.seq=false;PH.busy=false;PH.seqI=0;PH.seqN=0;
  phSeqProg(0,0,0);
 }

 // a cancel discards; a cap or a fault keeps what it got
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
// everything an editor needs, in the zip (frame rate etc.)
function phSeqReadme(pl,n,png){
 return 'Fuzeball '+(pl.path?'camera path':'turntable')+'\r\n'+
  '\r\n'+
  'frames      '+n+'\r\n'+
  'resolution  '+pl.w+' x '+pl.h+'\r\n'+
  'frame rate  '+PH.seqFps+' fps  ('+(Math.round(n/PH.seqFps*100)/100)+'s)\r\n'+
  'format      '+(png?'PNG (lossless)':'JPEG q'+PHOTO.seq.quality)+'\r\n'+
  '\r\n'+
  ((!pl.path)?
   'The sweep is exactly one revolution and the last frame stops one step short of the\r\n'+
   'first, so the sequence LOOPS seamlessly - no duplicate frame to trim.\r\n':
   (PH.pathLoop?
    'The move is a closed loop and the last frame stops one step short of the first, so\r\n'+
    'the sequence LOOPS seamlessly - no duplicate frame to trim.\r\n':
    'The move runs start to end: frame 1 is the first waypoint and the last frame is the\r\n'+
    'final one, so nothing is missing off either end.\r\n'))+
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
// progress has its own pill since a render usually starts from clean view
function phSeqProg(i,n,bytes){
 const el=$('phSeq');if(!el)return;
 if(!n){el.classList.remove('on');return;}
 el.classList.add('on');
 const b=$('phSeqBar'),t=$('phSeqTxt');
 if(b)b.style.width=Math.round(i/n*100)+'%';
 if(t)t.textContent='RENDERING  '+i+' / '+n+'   '+phBytes(bytes)+'   ESC to cancel';
}

// ===== saved shots =====
function phShotsLoad(){
 const n=PHOTO.slots;
 PH.shots=(Array.isArray(cfg.photoShots)&&cfg.photoShots.length===n)?cfg.photoShots:new Array(n).fill(null);
}
function phShotSave(i){
 PH.shots[i]={tx:PH.tx,ty:PH.ty,tz:PH.tz,dist:PH.dist,yaw:PH.yaw,pitch:PH.pitch,roll:PH.roll,fov:PH.fov,free:PH.free};
 cfg.photoShots=PH.shots;saveCfg();phShotChips();phPathOrder();phMsg('SHOT '+(i+1)+' SAVED');
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phShotLoad(i){
 if(PH.play){phMsg('STOP THE PATH FIRST (V)');return;}
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

// ===== panel groups =====
// every section collapses to its header (open ones persist in cfg.photoGroups) and carries a one-line summary; the body is a one-row grid animating 0fr to 1fr
const PH_GRPS=['shot','cam','look','frame','scene','shots','path','cap','seq','keys'];
function phGrp(id,title,body){
 return '<div class="phGrp" id="phG_'+id+'">'+
  '<button class="phSect" data-grp="'+id+'" title="'+title+
   ' — click to open, shift-click for this section only">'+
   '<i class="phChev"></i><span>'+title+'</span><em id="phSum_'+id+'"></em></button>'+
  '<div class="phGrpBody"><div class="phGrpIn">'+body+'</div></div></div>';
}
function phGrpOpen(id){return !!PH.open&&PH.open.indexOf(id)>=0;}
function phGrpLoad(){
 const s=cfg.photoGroups;
 PH.open=(Array.isArray(s)?s:(PHOTO.defOpen||[])).filter(k=>PH_GRPS.indexOf(k)>=0);
}
function phGrpSave(){cfg.photoGroups=PH.open.slice();saveCfg();}
// shift-click solos a section
function phGrpClick(id,e){
 if(e&&e.shiftKey)PH.open=(phGrpOpen(id)&&PH.open.length===1)?[]:[id];
 else{const i=PH.open.indexOf(id);if(i>=0)PH.open.splice(i,1);else PH.open.push(id);}
 phGrpSave();phGrpSync();
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
// what a header says while shut: the setting, not the title
function phGrpSummary(id){
 switch(id){
  case 'shot':{const a=[];
   if(PH.freeze)a.push('frozen');if(PH.free)a.push('free look');
   if(PH.spin)a.push('turntable');if(PH.clean)a.push('clean');
   return a.join(' · ');}
  case 'cam':  return Math.round(PH.fov)+'° · '+Math.round(PH.dist)+'u';
  case 'look': return Math.round(PH.tx)+', '+Math.round(PH.ty)+', '+Math.round(PH.tz);
  case 'frame':{for(const a of PHOTO.aspects)if(a.a===PH.aspect)return a.lab;return '';}
  case 'scene':{let n=0;if(PH.hideBall)n++;if(PH.hideRods)n++;if(PH.hideMarks)n++;
   return n?(n+' hidden'):'';}
  case 'shots':{let n=0;for(let i=0;i<PHOTO.slots;i++)if(PH.shots&&PH.shots[i])n++;
   return n?(n+' saved'):'empty';}
  case 'path': {if(!PHP.on)return '';
   if(PH.play)return 'playing';
   const n=PH.path?PH.path.length:0;
   return n?(n+' pts · '+PH.pathDur+'s'+(PH.pathLoop?' · loop':'')):'none';}
  case 'cap':  {if(PH.rec)return 'recording';const o=phOutSize();return o.w+' × '+o.h;}
  case 'seq':  {if(PH.seq)return 'rendering';const q=phSeqPlan();return q.n+'f · '+phBytes(q.bytes);}
 }
 return '';
}
// split so the live 'cam' and 'look' summaries get the 10Hz slot; open sections need no summary
function phGrpSums(){
 if(!phBuilt||!PH.open)return;
 for(const id of PH_GRPS){
  const e=$('phSum_'+id);if(!e)continue;
  const t=phGrpOpen(id)?'':phGrpSummary(id);
  if(e.textContent!==t)e.textContent=t;
 }
}
function phGrpSync(){
 if(!phBuilt||!PH.open)return;
 for(const id of PH_GRPS){
  const g=$('phG_'+id);if(g)g.classList.toggle('open',phGrpOpen(id));
 }
 phGrpSums();
}

// ===== camera path (V) =====
// an order of saved slots plus a duration; yaw is unwrapped first so every leg takes the short way; Catmull-Rom (through every waypoint, duplicate end phantoms); channels clamped to the rig limits; playback restores the rig
function phPathArmed(){return !!(PHP.on&&PH.path&&PH.path.length>=2);}
// slots to poses, empties dropped, yaw re-based onto one continuous angle; null if fewer than two survive
function phPathPts(){
 if(!PH.path||!PH.shots)return null;
 const pts=[];
 for(const i of PH.path){
  const s=PH.shots[i];
  if(s)pts.push({tx:s.tx,ty:s.ty,tz:s.tz,dist:s.dist,yaw:s.yaw,pitch:s.pitch,roll:s.roll,fov:s.fov});
 }
 if(pts.length<2)return null;
 let y=pts[0].yaw;
 for(let i=1;i<pts.length;i++){y+=phWrap(pts[i].yaw-y);pts[i].yaw=y;}
 return pts;
}
// control points with the phantom ends Catmull-Rom needs; a loop closes onto the first pose one full circuit further
function phPathCtrl(pts,loop){
 const n=pts.length,A=[],
  cl=(q,dy)=>({tx:q.tx,ty:q.ty,tz:q.tz,dist:q.dist,yaw:q.yaw+dy,pitch:q.pitch,roll:q.roll,fov:q.fov});
 if(loop){
  const close=pts[n-1].yaw+phWrap(pts[0].yaw-pts[n-1].yaw),   // carry on round to the start pose
        Y=close-pts[0].yaw;                                   // total yaw travelled in one circuit
  A.push(cl(pts[n-1],-Y));
  for(const q of pts)A.push(cl(q,0));
  A.push(cl(pts[0],Y));A.push(cl(pts[1],Y));
  return{A:A,seg:n};
 }
 A.push(cl(pts[0],0));
 for(const q of pts)A.push(cl(q,0));
 A.push(cl(pts[n-1],0));
 return{A:A,seg:n-1};
}
// uniform Catmull-Rom, tension 1/2, between p1 and p2
function phCR(p0,p1,p2,p3,t){
 const t2=t*t,t3=t2*t;
 return .5*(2*p1+(p2-p0)*t+(2*p0-5*p1+4*p2-p3)*t2+(3*p1-3*p2+p3-p0)*t3);
}
// smootherstep, not intro.js's smoothstep (its acceleration jump shows on a long move)
function phEase(t){return t*t*t*(t*(t*6-15)+10);}
const PH_CH=['tx','ty','tz','dist','yaw','pitch','roll','fov'];
const _phPose={};
function phPathPose(u){
 const C=PH.pathPts;if(!C)return null;
 let x=clamp(u,0,1);
 if(PH.pathEase&&!PH.pathLoop)x=phEase(x);
 const s=x*C.seg,i=clamp(Math.floor(s),0,C.seg-1),t=s-i,A=C.A,
       p0=A[i],p1=A[i+1],p2=A[i+2],p3=A[i+3];
 for(const k of PH_CH)_phPose[k]=PH.pathSmooth?phCR(p0[k],p1[k],p2[k],p3[k],t):(p1[k]+(p2[k]-p1[k])*t);
 return _phPose;
}
// write an interpolated pose onto the rig; yaw is wrapped only here
function phPathApply(u){
 const q=phPathPose(u);if(!q)return;
 PH.tx=clamp(q.tx,-PHR.tXMax,PHR.tXMax);
 PH.ty=clamp(q.ty,PHR.tYMin,PHR.tYMax);
 PH.tz=clamp(q.tz,-PHR.tZMax,PHR.tZMax);
 PH.dist=clamp(q.dist,PHR.distMin,PHR.distMax);
 PH.pitch=clamp(q.pitch,-PHR.pitchMax,PHR.pitchMax);
 PH.roll=clamp(q.roll,-PHR.rollMax,PHR.rollMax);
 PH.fov=clamp(q.fov,PHR.fovMin,PHR.fovMax);
 PH.yaw=phWrap(q.yaw);
}
function phPathStart(){
 if(PH.play||PH.seq)return false;
 if(!PHP.on){phMsg('CAMERA PATHS ARE OFF');return false;}
 const pts=phPathPts();
 if(!pts){phMsg(phPathArmed()?'PATH POINTS AT EMPTY SLOTS':'ADD AT LEAST TWO WAYPOINTS');return false;}
 const drop=PH.path.length-pts.length;
 PH.pathPts=phPathCtrl(pts,PH.pathLoop);
 PH.playPose={tx:PH.tx,ty:PH.ty,tz:PH.tz,dist:PH.dist,yaw:PH.yaw,pitch:PH.pitch,roll:PH.roll,
              fov:PH.fov,free:PH.free,freeze:PH.freeze};
 PH.play=true;PH.playT=0;PH.playHold=-1;
 PH.spin=false;                 // a turntable under a path is two camera moves fighting each other
 PH.freeze=!PH.pathLive;
 phPathApply(0);phApply();
 phSyncUI();
 phMsg('PATH  '+pts.length+' POINTS  '+PH.pathDur+'s'+(PH.pathLoop?'  LOOP':'')+
       (drop?('  ('+drop+' EMPTY SKIPPED)'):''));
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
 return true;
}
function phPathStop(){
 if(!PH.play)return;
 PH.play=false;PH.playHold=-1;PH.pathPts=null;
 const s=PH.playPose;
 if(s){PH.tx=s.tx;PH.ty=s.ty;PH.tz=s.tz;PH.dist=s.dist;PH.yaw=s.yaw;PH.pitch=s.pitch;
       PH.roll=s.roll;PH.fov=s.fov;PH.free=s.free;PH.freeze=s.freeze;}
 PH.playPose=null;
 phApply();phSyncUI();
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phPathToggle(){if(PH.play)phPathStop();else phPathStart();}
// wall-clock, so the move plays at real speed with the sim frozen
// the tail holds the end pose: the last frame's blit happens after the next render (phPostRender)
function phPathTick(rdt){
 if(PH.playHold>=0){
  PH.playHold+=rdt;
  if(PH.playHold>=PHP.recTail){
   if(PH.rec&&PH.recPath&&PHP.recAutoStop)phRecStop();
   phPathStop();
  }
  return;
 }
 PH.playT+=rdt;
 const dur=Math.max(.05,PH.pathDur);
 if(PH.pathLoop){
  // a looping take stops after one circuit, one frame short of the seam
  if(PH.rec&&PH.recPath&&PHP.recAutoStop&&PH.playT>=dur){phRecStop();phPathStop();return;}
  let u=(PH.playT/dur)%1;if(u<0)u+=1;
  phPathApply(u);return;
 }
 if(PH.playT>=dur){PH.playT=dur;PH.playHold=0;phPathApply(1);return;}
 phPathApply(PH.playT/dur);
}
// editing: every write goes to cfg, a path is authored content
function phPathLoad(){
 const s=cfg.photoPath;
 PH.path=[];
 if(!s||typeof s!=='object')return;
 if(Array.isArray(s.pts))
  PH.path=s.pts.filter(i=>Number.isFinite(i)&&i>=0&&i<PHOTO.slots).slice(0,PHP.maxPts);
 if(isFinite(s.secs))PH.pathDur=clamp(s.secs,PHP.secsMin,PHP.secsMax);
 if(typeof s.smooth==='boolean')PH.pathSmooth=s.smooth;
 if(typeof s.ease==='boolean')PH.pathEase=s.ease;
 if(typeof s.loop==='boolean')PH.pathLoop=s.loop;
 if(typeof s.live==='boolean')PH.pathLive=s.live;
}
function phPathSave(){
 cfg.photoPath={pts:(PH.path||[]).slice(),secs:PH.pathDur,smooth:PH.pathSmooth,
                ease:PH.pathEase,loop:PH.pathLoop,live:PH.pathLive};
 saveCfg();
}
function phPathAdd(i){
 if(!PH.path)PH.path=[];
 if(PH.path.length>=PHP.maxPts){phMsg('PATH IS FULL — '+PHP.maxPts+' WAYPOINTS');return;}
 PH.path.push(i);phPathSave();phSyncUI();
 phMsg((PH.shots&&PH.shots[i])?('WAYPOINT '+(i+1)+' ADDED'):('WAYPOINT '+(i+1)+' ADDED — SLOT IS EMPTY'));
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phPathAll(){
 PH.path=[];
 for(let i=0;i<PHOTO.slots;i++)if(PH.shots&&PH.shots[i])PH.path.push(i);
 PH.path=PH.path.slice(0,PHP.maxPts);
 phPathSave();phSyncUI();
 phMsg(PH.path.length>=2?('PATH  '+PH.path.length+' POINTS'):'SAVE AT LEAST TWO SHOTS FIRST');
 if(typeof Au!=='undefined'&&Au.ui)Au.ui();
}
function phPathUndo(){
 if(!PH.path||!PH.path.length){phMsg('PATH IS EMPTY');return;}
 PH.path.pop();phPathSave();phSyncUI();
}
function phPathClear(){
 if(PH.play)phPathStop();
 PH.path=[];phPathSave();phSyncUI();phMsg('PATH CLEARED');
}
// the order strip: the run as it will play, with emptied slots struck through
function phPathOrder(){
 const el=$('phPathOrder');if(!el)return;
 if(!PH.path||!PH.path.length){el.textContent='no waypoints — add two or more';el.className='phOrder';return;}
 let bad=0,s='';
 for(let j=0;j<PH.path.length;j++){
  const i=PH.path[j],has=!!(PH.shots&&PH.shots[i]);
  if(!has)bad++;
  s+=(j?' → ':'')+(has?String(i+1):'<s>'+(i+1)+'</s>');
 }
 if(PH.pathLoop&&PH.path.length>1)s+=' ↻';
 el.innerHTML=s+(bad?('   '+bad+' empty'):'');
 el.className='phOrder'+((PH.path.length>=2&&!bad)?' ok':'');
}

// ===== scene hides =====
// written every frame from phTick, after fxUpdate/sweetGuideUpdate (they own the markers); only ball meshes and rod pivots are restored by hand on exit
function phSceneApply(){
 if(PH.hideBall)for(const b of S.balls)b.m.visible=false;
 if(PH.hideRods)for(const r of rods)r.pivot.visible=false;
 if(PH.hideMarks){
  if(typeof indicators!=='undefined')for(const m of indicators)m.visible=false;
  if(typeof pinRings!=='undefined')for(const m of pinRings)m.visible=false;
  if(typeof dropRing!=='undefined'&&dropRing)dropRing.visible=false;
  if(typeof ssBoxes!=='undefined')for(const g of ssBoxes)g.visible=false;
  if(typeof trnRing!=='undefined'&&trnRing)trnRing.visible=false;
 }
}
function phSceneRestore(){
 for(const b of S.balls)b.m.visible=true;
 for(const r of rods)r.pivot.visible=!r.trnHidden;
}

// ===== panel =====
// one row spec per driven number; ranges come off CONFIG.photo.rig so sliders match the clamps
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
// write one rig field; yaw/pitch route through phOrbit so a slider obeys the mode like a drag
function phField(k,v){
 if(!isFinite(v))return;
 switch(k){
  // orbit writes yaw straight (phWrap would teleport the thumb at +180); free goes through the delta path
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
 const set=e=>{if(phSyncing||PH.play)return;phField(f.k,parseFloat(e.target.value));phSyncNums();};
 r.oninput=set;n.oninput=set;
}
// split on purpose: phSyncNums runs at 10Hz for the readouts, phSyncUI only on a discrete change
function phSyncNums(){
 if(!phBuilt)return;
 phSyncing=true;
 for(const f of PH_ALL){
  const v=PH[f.k],r=$('phR_'+f.k),n=$('phN_'+f.k);
  if(r)r.value=v;if(n)n.value=Math.round(v*10)/10;
 }
 phSyncing=false;
 phGrpSums();          // 'cam' and 'look' read out a live drag, so they ride the 10Hz slot
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
 if(PHP.on){
  $('phPathR').value=PH.pathDur;$('phPathN').value=PH.pathDur;
  $('phPathSmooth').classList.toggle('on',PH.pathSmooth);
  $('phPathEase').classList.toggle('on',PH.pathEase&&!PH.pathLoop);
  $('phPathEase').disabled=PH.pathLoop;          // an ease at a loop seam is a stutter once a lap
  $('phPathLoop').classList.toggle('on',PH.pathLoop);
  $('phPathLive').classList.toggle('on',PH.pathLive);
  const pb=$('phPathBtn');
  pb.classList.toggle('on',PH.play);
  pb.disabled=!PH.play&&!phPathArmed();
  const pt=PH.play?'■ STOP PATH (V)':'▶ PLAY PATH (V)';
  if(pb.textContent!==pt)pb.textContent=pt;
  for(let i=0;i<PHOTO.slots;i++){
   const c=$('phPathChip'+i);if(c)c.classList.toggle('on',(PH.path||[]).indexOf(i)>=0);
  }
  phPathOrder();
 }
 phSyncing=false;
 phFrameSync();phChromeSync();phRecSync();phSeqSync();phGrpSync();
}
function phBuild(){
 if(phBuilt)return;phBuilt=true;
 phShotsLoad();phPathLoad();phGrpLoad();
 // framing overlay is separate from the panel so it sits under the panel's z-index and stays pointer-transparent
 const fr=document.createElement('div');fr.id='phFrame';fr.className='hidden';
 fr.innerHTML='<div id="phCrop">'+
  '<i class="phL v" style="left:33.333%"></i><i class="phL v" style="left:66.667%"></i>'+
  '<i class="phL h" style="top:33.333%"></i><i class="phL h" style="top:66.667%"></i>'+
  '<i class="phX"></i></div>';
 document.body.appendChild(fr);
 const fl=document.createElement('div');fl.id='phFlash';document.body.appendChild(fl);
 // rolling indicator: DOM so it can't land in the recording, and it survives clean view
 const ri=document.createElement('div');ri.id='phRec';ri.innerHTML='<i></i>REC';document.body.appendChild(ri);
 // sequence-render progress, same reasoning as the REC dot
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
  phGrp('shot','View',
  '<div class="phBtns"><button class="phBtn" id="phFreeze">Freeze (P)</button><button class="phBtn" id="phStep">Step (O)</button></div>'+
  '<div class="phBtns"><button class="phBtn" id="phMode">ORBIT (F)</button><button class="phBtn" id="phSpin">Turntable (T)</button></div>'+
  '<div class="phBtns"><button class="phBtn" id="phClean">Clean view (C)</button></div>'+
  '<div class="phS hidden" id="phSpinRow"><label>Spin</label><input type="range" id="phSpinR" min="'+PHOTO.spin.min+'" max="'+PHOTO.spin.max+'" step="1"><input type="number" id="phSpinN" min="'+PHOTO.spin.min+'" max="'+PHOTO.spin.max+'" step="1"><i>°/s</i></div>')+
  phGrp('cam','Camera',
  PH_RIG.map(phRowHTML).join('')+
  '<div class="phBtns"><button class="phBtn" id="phLevel">Level roll</button><button class="phBtn" id="phFromCam">Match cam</button><button class="phBtn" id="phReset">Reset</button></div>')+
  phGrp('look','Look at',
  PH_TGT.map(phRowHTML).join('')+
  '<div class="phBtns">'+
   '<button class="phBtn" data-fo="ball">Ball</button>'+
   '<button class="phBtn" data-fo="mid">Centre</button>'+
   '<button class="phBtn" data-fo="rod">Held rod</button>'+
   '<button class="phBtn" data-fo="g0">Goal 1</button>'+
   '<button class="phBtn" data-fo="g1">Goal 2</button></div>')+
  phGrp('frame','Framing',
  '<div class="phRow"><label>Aspect</label><select id="phAspect">'+asp+'</select></div>'+
  '<div class="phRow"><label>Frame line</label><input type="checkbox" id="phLine"></div>'+
  '<div class="phRow"><label>Mask outside</label><input type="checkbox" id="phMask"></div>'+
  '<div class="phRow"><label>Rule of thirds</label><input type="checkbox" id="phThirds"></div>'+
  '<div class="phRow"><label>Centre cross</label><input type="checkbox" id="phCross"></div>')+
  phGrp('scene','Scene',
  '<div class="phRow"><label>Hide ball</label><input type="checkbox" id="phHideBall"></div>'+
  '<div class="phRow"><label>Hide rods &amp; players</label><input type="checkbox" id="phHideRods"></div>'+
  '<div class="phRow"><label>Hide markers</label><input type="checkbox" id="phHideMarks"></div>')+
  phGrp('shots','Shots',
  '<div class="phRow"><label>Save</label><span class="phSlots" id="phSave"></span></div>'+
  '<div class="phRow"><label>Load</label><span class="phSlots" id="phLoad"></span></div>')+
  (PHP.on?phGrp('path','Camera path',
   '<div class="phRow"><label>Add</label><span class="phSlots" id="phPathAdd"></span></div>'+
   '<div class="phOrder" id="phPathOrder"></div>'+
   '<div class="phBtns"><button class="phBtn" id="phPathAll">Use all</button>'+
    '<button class="phBtn" id="phPathUndo">Undo</button>'+
    '<button class="phBtn" id="phPathClear">Clear</button></div>'+
   '<div class="phS"><label>Length</label><input type="range" id="phPathR" min="'+PHP.secsMin+
    '" max="'+PHP.secsMax+'" step="1"><input type="number" id="phPathN" min="'+PHP.secsMin+
    '" max="'+PHP.secsMax+'" step="1"><i>s</i></div>'+
   '<div class="phBtns"><button class="phBtn" id="phPathSmooth">Smooth</button>'+
    '<button class="phBtn" id="phPathEase">Ease</button>'+
    '<button class="phBtn" id="phPathLoop">Loop</button>'+
    '<button class="phBtn" id="phPathLive">Live sim</button></div>'+
   '<div class="phBtns"><button class="phBtn wide play" id="phPathBtn">▶ PLAY PATH (V)</button></div>')
   :'')+
  phGrp('cap','Capture',
  '<div class="phRow"><label>Size</label><select id="phScale">'+scl+'</select><span class="phHint" id="phOut"></span></div>'+
  '<div class="phBtns"><button class="phBtn wide snap" id="phSnapBtn">◉ TAKE PHOTO (SPACE)</button></div>'+
  '<div class="phBtns"><button class="phBtn wide rec" id="phRecBtn">● RECORD CLIP (R)</button></div>'+
  '<div class="phRow"><label>Clip</label><span class="phHint" id="phRecOut"></span></div>')+
  phGrp('seq','Sequence',
  '<div class="phRow"><label>Height</label><select id="phSeqH">'+hgt+'</select>'+
   '<select id="phSeqFps">'+fps+'</select></div>'+
  '<div class="phS" id="phSeqSecRow"><label>Length</label><input type="range" id="phSeqSecR" min="'+PHOTO.seq.secsMin+
   '" max="'+PHOTO.seq.secsMax+'" step="1"><input type="number" id="phSeqSecN" min="'+PHOTO.seq.secsMin+
   '" max="'+PHOTO.seq.secsMax+'" step="1"><i>s</i></div>'+
  '<div class="phRow"><label>Format</label><select id="phSeqFmt">'+
   '<option value="jpeg">JPEG</option><option value="png">PNG</option></select></div>'+
  '<div class="phBtns"><button class="phBtn wide seq" id="phSeqBtn">▦ RENDER SEQUENCE (SHIFT+R)</button></div>'+
  '<div class="phRow"><label>Sequence</label><span class="phHint" id="phSeqOut"></span></div>')+
  phGrp('keys','Controls',
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
   (PHP.on?'<b>V</b><span>play path</span>':'')+
   '<b>G</b><span>guides</span><b>H</b><span>hide panel</span>'+
   '<b>C</b><span>clean view</span><b>R</b><span>record clip</span>'+
   '<b>SHIFT R</b><span>render sequence</span>'+
   '<b>F1 / ESC</b><span>exit</span>'+
  '</div>')+
  // pinned under every section: the message and live readout are checked without opening anything
  '<div class="phMsg" id="phMsg"></div>'+
  '<div class="phInfo" id="phInfo"></div>'+
  '</div>';
 document.body.appendChild(p);
 // blur any clicked control so SPACE (take photo) can't re-fire it
 p.addEventListener('click',e=>{const b=e.target.closest('button');if(b)b.blur();});
 // stop the wheel here so the tall panel's scrolling never reaches a window-level handler
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
 p.querySelectorAll('[data-grp]').forEach(b=>{b.onclick=e=>phGrpClick(b.dataset.grp,e);});
 // locked while rolling: the recorder's canvas is sized once
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
 if(PHP.on){
  const pa=$('phPathAdd');
  for(let i=0;i<PHOTO.slots;i++){
   const c=document.createElement('button');c.className='phBtn slot';c.id='phPathChip'+i;
   c.textContent=String(i+1);c.title='append slot '+(i+1)+' to the path';
   c.onclick=()=>phPathAdd(i);pa.appendChild(c);
  }
  $('phPathAll').onclick=()=>phPathAll();
  $('phPathUndo').onclick=()=>phPathUndo();
  $('phPathClear').onclick=()=>phPathClear();
  $('phPathBtn').onclick=()=>phPathToggle();
  const pd=e=>{if(phSyncing)return;
   PH.pathDur=clamp(parseFloat(e.target.value)||PHP.secs,PHP.secsMin,PHP.secsMax);
   phPathSave();phSyncUI();};
  $('phPathR').oninput=pd;$('phPathN').oninput=pd;
  $('phPathSmooth').onclick=()=>{PH.pathSmooth=!PH.pathSmooth;phPathSave();phSyncUI();};
  $('phPathEase').onclick=()=>{PH.pathEase=!PH.pathEase;phPathSave();phSyncUI();};
  // changing the shape mid-play would need the control points rebuilt, so restart
  $('phPathLoop').onclick=()=>{const w=PH.play;if(w)phPathStop();
   PH.pathLoop=!PH.pathLoop;phPathSave();phSyncUI();if(w)phPathStart();};
  $('phPathLive').onclick=()=>{const w=PH.play;if(w)phPathStop();
   PH.pathLive=!PH.pathLive;phPathSave();phSyncUI();if(w)phPathStart();};
 }
 phShotChips();phGrpSync();
}
// focus presets: goal x is ±L/2, the aim sits at bar height so a goal shot frames the mouth
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

// ===== freeze =====
function phToggleFreeze(){PH.freeze=!PH.freeze;PH.stepQ=0;phSyncUI();if(typeof Au!=='undefined'&&Au.ui)Au.ui();}
function phStep(){if(!PH.freeze)phToggleFreeze();PH.stepQ++;}

// ===== enter / exit =====
// in-match only; entering from #pause takes the overlay down and restores the phase, phExit re-pauses
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
 // the C overlay's proxies would be in the picture: off for the duration, restored at exit
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
 // refused while a sequence renders: ask it to stop, photoGuard exits later
 if(PH.seq){phSeqCancel();return;}
 // a take still rolling is written out, not binned
 if(PH.rec)phRecStop('photo mode closed');
 if(PH.play)phPathStop();          // ...and after it, so the take keeps the frames the move made
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
// backstop: a match that ends under the panel mustn't strand the camera on the rig; deferred while a sequence renders
function photoGuard(){if(PH.on&&!PH.seq&&!photoAllowed())photoExit();}

// ===== per-frame =====
// called from main.js after fxUpdate / sweetGuideUpdate (see phSceneApply); wall-clock, so turntable and nudges work with the sim frozen
function phTick(rdt){
 photoGuard();if(!PH.on)return;
 // an offline render drives the rig itself; the tick must not touch it
 if(PH.seq)return;
 let moved=false;
 // a playing path owns the rig: nudges, turntable and drags stand down
 if(PH.play){phPathTick(rdt);moved=true;}
 else{
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
  if(PH.spin)phOrbit(PH.spinSpeed*rdt,0);          // turntable: wall-clock, so it sweeps while frozen
  if(f||s||u||dy||dp||dd||PH.spin)moved=true;
 }
 if(PH.rec)phRecTick(rdt);
 phApply();
 phSceneApply();
 if(moved)PH.readT=0;                              // moving → refresh the numbers on the next tick
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

// ===== input =====
// input.js and training.js bail while S.photo is set; mouse move/up are on window so a drag leaving the canvas still tracks
addEventListener('keydown',e=>{
 if(!PHOTO.on)return;
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 // a sequence render owns the keyboard: Esc/F1 cancel, everything else is inert
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
 if(e.code==='KeyP'){if(PH.play){phMsg('STOP THE PATH FIRST (V)');return;}phToggleFreeze();return;}
 if(e.code==='KeyO'){if(PH.play)return;phStep();return;}
 if(e.code==='KeyF'){if(PH.play)return;PH.free=!PH.free;phSyncUI();return;}
 if(e.code==='KeyT'){if(PH.play)phPathStop();PH.spin=!PH.spin;phSyncUI();return;}
 if(e.code==='KeyV'){phPathToggle();return;}
 if(e.code==='KeyH'){PH.panelHid=!PH.panelHid;phChromeSync();return;}
 if(e.code==='KeyC'){PH.clean=!PH.clean;phChromeSync();return;}
 if(e.code==='KeyR'){if(e.shiftKey)phSeqStart();else phRecToggle();return;}
 // G cycles the guides (clean, thirds, thirds+cross); the crop line stays up, C takes everything down
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
 if(!PH.on||PH.seq||PH.play)return;
 e.preventDefault();
 // 0 = orbit/look, 2 (or shift+0) = pan, 1 = dolly; shift is also the key-nudge 'fast' modifier
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
 if(!PH.on||PH.seq||PH.play)return;
 e.preventDefault();
 // proportional dolly: one notch is a fixed fraction of the current distance
 const k=1+PHOTO.speed.wheel*(e.deltaY>0?1:-1)*((keys.ShiftLeft||keys.ShiftRight)?3:1);
 PH.dist=clamp(PH.dist*k,PHR.distMin,PHR.distMax);
 PH.readT=0;
},{passive:false});
