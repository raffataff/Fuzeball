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
 keep:false,name:'',live:false,fail:false};

/* Is capture possible at all? Cheap enough to call per replay. */
function clipSupported(){
 return !!(CAPTURE.on&&!CLIP.fail&&window.MediaRecorder&&$('game')&&$('game').captureStream);
}
/* Is a recording running RIGHT NOW (i.e. is there anything for clipKeep to promote)? */
function clipReady(){return CLIP.live;}
/* First container/codec pair the browser admits, resolved once per session. '' = let the
   browser pick its own default, which is still worth a try. */
function clipMime(){
 if(CLIP.mime!==undefined)return CLIP.mime;
 CLIP.mime='';
 for(const m of CAPTURE.mime)if(MediaRecorder.isTypeSupported(m)){CLIP.mime=m;break;}
 return CLIP.mime;
}
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
/* Begin recording. The canvas stream is created PER RECORDING and its video track is stopped
   again in clipFlush — deliberately, not for tidiness: a live CanvasCaptureMediaStreamTrack
   makes the browser copy the framebuffer at its capture rate for as long as it exists, whether
   or not anything is consuming it. Holding one open for the session would tax every rally to
   serve the two seconds a year someone saves a clip. The AUDIO track is the opposite case —
   it hangs off a permanent destination node and costs nothing idle, so it's reused. */
function clipStart(){
 if(CLIP.live||!clipSupported())return false;
 try{
  const cs=$('game').captureStream(CAPTURE.fps);
  CLIP.vtracks=cs.getVideoTracks();
  const st=new MediaStream(CLIP.vtracks);
  const at=clipAudioTrack();if(at)st.addTrack(at);
  const o={videoBitsPerSecond:CAPTURE.bitrate,audioBitsPerSecond:CAPTURE.audioBitrate},m=clipMime();
  if(m)o.mimeType=m;
  CLIP.chunks=[];CLIP.keep=false;CLIP.name='';
  CLIP.rec=new MediaRecorder(st,o);
  CLIP.rec.ondataavailable=e=>{if(e.data&&e.data.size&&CLIP.chunks)CLIP.chunks.push(e.data);};
  CLIP.rec.onstop=clipFlush;
  CLIP.rec.onerror=()=>{CLIP.fail=true;CLIP.live=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();};
  CLIP.rec.start(CAPTURE.chunkMs);
  CLIP.live=true;return true;
 }catch(e){CLIP.fail=true;CLIP.live=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();return false;}
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
 if(!CLIP.live)return;CLIP.live=false;
 try{CLIP.rec.stop();}catch(e){CLIP.chunks=null;CLIP.rec=null;clipStopTracks();}
}
// onstop — the recorder has flushed its last chunk, so this is the first moment it's safe to
// drop the canvas track (killing it any earlier truncates the tail of the clip).
function clipFlush(){
 const ch=CLIP.chunks,keep=CLIP.keep,name=CLIP.name;
 CLIP.chunks=null;CLIP.rec=null;CLIP.keep=false;
 clipStopTracks();
 if(!keep||!ch||!ch.length)return;                       // never promoted → the encode is simply discarded
 try{clipDownload(new Blob(ch,{type:clipMime()||'video/webm'}),name+'.webm');}catch(e){}
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
