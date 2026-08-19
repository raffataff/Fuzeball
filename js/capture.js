'use strict';
/* ================= clip capture (canvas + audio → .webm) =================
   A MediaRecorder over the game canvas, plus a second tap off Au's master gain for the
   audio track. Generic: nothing here knows what a replay is — js/replay.js arms it on the
   first frame of a goal replay and then either PROMOTES the recording (clipKeep) or lets
   it be dropped on stop.

   RECORD-THEN-PROMOTE, not record-on-demand. A player only knows the goal was worth
   keeping AFTER watching it, and a replay is over in about five seconds — so recording
   from the keypress would only ever capture the tail you already saw. The recorder
   therefore runs from the replay's first frame and the save key promotes the whole clip;
   an unpromoted recording costs one encode and is thrown away.

   ONLY THE CANVAS IS RECORDED. The letterbox bars, REPLAY tag, save hint and HUD are all
   DOM, so a saved clip is clean gameplay footage with no chrome baked into it.

   Everything is best-effort. No MediaRecorder, no captureStream, no supported codec, or a
   recorder that throws → clipStart returns false, clipReady() stays false and the caller
   carries on with no clip. A hard failure latches CLIP.fail so the session stops retrying
   once per goal. Nothing in here may throw into the game loop. */
const CLIP={rec:null,chunks:null,vtracks:null,adest:null,mime:undefined,
 keep:false,name:'',live:false,fail:false,mimeUsed:'',
 // stop() is async — this covers the window between it and onstop, where CLIP.live is already
 // false but the recorder still owns CLIP.chunks/rec. See clipStop.
 stopping:false};

/* Is capture possible at all? Cheap enough to call per replay. `cv` defaults to the game canvas;
   photo mode passes its own off-screen crop canvas (js/photo.js), which is the same API. */
function clipSupported(cv){
 cv=cv||$('game');
 return !!(CAPTURE.on&&!CLIP.fail&&window.MediaRecorder&&cv&&cv.captureStream);
}
/* Is a recording running RIGHT NOW (i.e. is there anything for clipKeep to promote)? */
function clipReady(){return CLIP.live;}
/* First container/codec pair the browser admits from `list` (default CONFIG.capture.mime), cached
   per list. '' = let the browser pick its own default, which is still worth a try.
   MP4/H.264 leads both lists because WebM is the wrong DELIVERABLE: Premiere, Final Cut and After
   Effects do not import it at all, and Resolve only sometimes. The recorders are equally happy to
   write either, so the only thing that ever justified webm-first was Firefox — which still gets it,
   from the fallback, without costing every Chrome user a transcode. */
const CLIP_MIME={};
function clipMime(list){
 if(!window.MediaRecorder)return '';                     // also called from photo mode's panel readout
 list=(list&&list.length)?list:CAPTURE.mime;
 const k=list.join('|');
 if(CLIP_MIME[k]!==undefined)return CLIP_MIME[k];
 let m='';
 for(const c of list){try{if(MediaRecorder.isTypeSupported(c)){m=c;break;}}catch(e){}}
 return CLIP_MIME[k]=m;
}
/* The extension MUST follow the container the recorder actually produced. An MP4 payload named
   .webm is exactly the file an NLE refuses to import and a player half-plays — and the browser is
   free to ignore the mimeType we asked for, so this reads the CHUNK's own type first. */
function clipExt(m){return /mp4/i.test(m||'')?'.mp4':'.webm';}
function clipContainer(list){return clipExt(clipMime(list)).slice(1).toUpperCase();}
/* One MediaStreamDestination for the life of the page, fed from Au's master gain. Au keeps
   its normal connection to the speakers — this is a SECOND tap, not a re-route, so nothing
   about live audio changes. Built lazily because Au.ctx doesn't exist until the first user
   gesture. Null when audio capture is off or the context never came up → silent clip. */
function clipAudioTrack(){
 if(!CAPTURE.audio||!Au.ctx||!Au.mg)return null;
 if(!CLIP.adest){
  try{CLIP.adest=Au.ctx.createMediaStreamDestination();Au.mg.connect(CLIP.adest);}
  catch(e){CLIP.adest=null;return null;}
 }
 return CLIP.adest.stream.getAudioTracks()[0]||null;
}
/* Begin recording `cv` (default: the game canvas). The canvas stream is created PER RECORDING and its video track is stopped
   again in clipFlush — deliberately, not for tidiness: a live CanvasCaptureMediaStreamTrack
   makes the browser copy the framebuffer at its capture rate for as long as it exists, whether
   or not anything is consuming it. Holding one open for the session would tax every rally to
   serve the two seconds a year someone saves a clip. The AUDIO track is the opposite case —
   it hangs off a permanent destination node and costs nothing idle, so it's reused. */
function clipStart(cv,opt){
 cv=cv||$('game');opt=opt||{};
 // ...which is why a start is refused while a previous take is still flushing. Losing one
 // speculative goal-clip arming is nothing; corrupting both recordings is not.
 if(CLIP.live||CLIP.stopping||!clipSupported(cv))return false;
 try{
  const cs=cv.captureStream(opt.fps||CAPTURE.fps);
  CLIP.vtracks=cs.getVideoTracks();
  const st=new MediaStream(CLIP.vtracks);
  // audio:false is photo mode's turntable — a camera move has no soundtrack, and the crowd bed
  // under a silent orbit reads as a bug. The goal clip passes nothing and keeps the audio.
  const at=(opt.audio===false)?null:clipAudioTrack();if(at)st.addTrack(at);
  const o={videoBitsPerSecond:opt.bitrate||CAPTURE.bitrate,audioBitsPerSecond:CAPTURE.audioBitrate},
        m=clipMime(opt.mime);
  CLIP.mimeUsed=m;                                       // clipFlush runs long after opt is gone
  if(m)o.mimeType=m;
  CLIP.chunks=[];CLIP.keep=false;CLIP.name='';
  CLIP.rec=new MediaRecorder(st,o);
  CLIP.rec.ondataavailable=e=>{if(e.data&&e.data.size&&CLIP.chunks)CLIP.chunks.push(e.data);};
  CLIP.rec.onstop=clipFlush;
  CLIP.rec.onerror=()=>{CLIP.fail=true;CLIP.live=false;CLIP.stopping=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();};
  CLIP.rec.start(CAPTURE.chunkMs);
  CLIP.live=true;return true;
 }catch(e){CLIP.fail=true;CLIP.live=false;CLIP.stopping=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();return false;}
}
// Video tracks only — the shared audio track must survive for the next clip.
function clipStopTracks(){
 if(!CLIP.vtracks)return;
 for(const t of CLIP.vtracks){try{t.stop();}catch(e){}}
 CLIP.vtracks=null;
}
/* Promote the running recording — it will be written out when clipStop lands. Returns false
   when there's nothing running, which is what the caller shows as "can't save this one". */
function clipKeep(name){
 if(!CLIP.live)return false;
 CLIP.keep=true;CLIP.name=name||'clip';return true;
}
/* End the recording. onstop → clipFlush does the writing; stop() is async, so the download
   lands a beat after the caller has moved on. */
function clipStop(){
 if(!CLIP.live)return;CLIP.live=false;CLIP.stopping=true;
 try{CLIP.rec.stop();}catch(e){CLIP.stopping=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();}
}
// onstop — the recorder has flushed its last chunk, so this is the first moment it's safe to
// drop the canvas track (killing it any earlier truncates the tail of the clip).
function clipFlush(){
 CLIP.stopping=false;
 const ch=CLIP.chunks,keep=CLIP.keep,name=CLIP.name;
 CLIP.chunks=null;CLIP.rec=null;CLIP.keep=false;
 clipStopTracks();
 if(!keep||!ch||!ch.length)return;                       // never promoted → the encode is simply discarded
 // the CHUNK's own type is authoritative — a browser may quietly ignore the mimeType it was asked
 // for, and naming the file off what we REQUESTED would then mislabel the container
 const mt=(ch[0]&&ch[0].type)||CLIP.mimeUsed||'video/webm';
 try{clipDownload(new Blob(ch,{type:mt}),name+clipExt(mt));}catch(e){}
}
/* ===== zip (STORE) =====
   Minimal ZIP writer, no compression and no dependency. Photo mode's offline turntable render
   hands over one file instead of 300 downloads (which Chrome blocks anyway).
     · STORE (method 0) deliberately: the entries are PNG/JPEG, i.e. already compressed. DEFLATE
       would cost seconds of main thread to save a percent.
     · Assembled as an ARRAY of chunks handed to Blob(), never one concatenated buffer — a
       half-gigabyte contiguous ArrayBuffer is the allocation most likely to fail, and a Blob can
       be backed by disk instead of the JS heap.
     · ZIP32, so 4GB / 65535 entries — both far above CONFIG.photo.seq's own caps. */
const ZIP_CRC=(()=>{const t=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}
 return t;})();
function zipCrc(u8){
 let c=0xFFFFFFFF;
 for(let i=0;i<u8.length;i++)c=ZIP_CRC[(c^u8[i])&255]^(c>>>8);
 return (c^0xFFFFFFFF)>>>0;
}
// DOS timestamp: 2-second resolution, year relative to 1980. Every unzipper still reads it.
function zipDos(d){
 return{t:((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((d.getSeconds()>>1)&31),
        d:(((d.getFullYear()-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31)};
}
function zipStore(files){
 const enc=new TextEncoder(),parts=[],cd=[],ts=zipDos(new Date());
 let off=0;
 for(const f of files){
  const nm=enc.encode(f.name),data=f.data,crc=zipCrc(data),n=data.length;
  const lh=new DataView(new ArrayBuffer(30));
  lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0,true);
  lh.setUint16(8,0,true);lh.setUint16(10,ts.t,true);lh.setUint16(12,ts.d,true);
  lh.setUint32(14,crc,true);lh.setUint32(18,n,true);lh.setUint32(22,n,true);
  lh.setUint16(26,nm.length,true);lh.setUint16(28,0,true);
  parts.push(new Uint8Array(lh.buffer),nm,data);
  const ch=new DataView(new ArrayBuffer(46));
  ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);
  ch.setUint16(8,0,true);ch.setUint16(10,0,true);ch.setUint16(12,ts.t,true);ch.setUint16(14,ts.d,true);
  ch.setUint32(16,crc,true);ch.setUint32(20,n,true);ch.setUint32(24,n,true);
  ch.setUint16(28,nm.length,true);ch.setUint16(30,0,true);ch.setUint16(32,0,true);
  ch.setUint16(34,0,true);ch.setUint16(36,0,true);ch.setUint32(38,0,true);
  ch.setUint32(42,off,true);                       // where this entry's LOCAL header starts
  cd.push(new Uint8Array(ch.buffer),nm);
  off+=30+nm.length+n;
 }
 let cdLen=0;for(const c of cd)cdLen+=c.length;
 const eo=new DataView(new ArrayBuffer(22));
 eo.setUint32(0,0x06054b50,true);eo.setUint16(4,0,true);eo.setUint16(6,0,true);
 eo.setUint16(8,files.length,true);eo.setUint16(10,files.length,true);
 eo.setUint32(12,cdLen,true);eo.setUint32(16,off,true);eo.setUint16(20,0,true);
 return new Blob(parts.concat(cd,[new Uint8Array(eo.buffer)]),{type:'application/zip'});
}

function clipDownload(blob,file){
 const u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download=file;a.style.display='none';
 document.body.appendChild(a);a.click();
 setTimeout(()=>{a.remove();URL.revokeObjectURL(u);},CAPTURE.revokeMs);
}
/* Filename parts. clipSlug flattens a team name (which is player-typed, and in league play can
   be anything) down to something a filesystem will take. */
function clipStamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());}
function clipSlug(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24)||'team';}
