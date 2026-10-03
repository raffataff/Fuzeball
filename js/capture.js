'use strict';
// ================= clip capture (canvas + audio > .webm) =================
// a MediaRecorder over the game canvas plus a tap off Au's master gain; js/replay.js arms it on a goal replay's first frame and either promotes the recording (clipKeep) or drops it
// record-then-promote: a player only knows a goal was worth keeping after watching it; only the canvas is recorded (letterbox, tag, hint, HUD are DOM)
// best-effort: no MediaRecorder, captureStream or codec makes clipStart return false; a hard failure latches CLIP.fail; nothing may throw into the game loop
const CLIP={rec:null,chunks:null,vtracks:null,adest:null,mime:undefined,
 keep:false,name:'',live:false,fail:false,mimeUsed:'',
 // stop() is async: this covers the window between it and onstop (see clipStop)
 stopping:false};

// is capture possible at all? `cv` defaults to the game canvas, photo mode passes its own crop canvas
function clipSupported(cv){
 cv=cv||$('game');
 return !!(CAPTURE.on&&!CLIP.fail&&window.MediaRecorder&&cv&&cv.captureStream);
}
/* Is a recording running RIGHT NOW (i.e. is there anything for clipKeep to promote)? */
function clipReady(){return CLIP.live;}
// first container/codec pair the browser admits from `list` (default CONFIG.capture.mime), cached; '' = browser default
// MP4/H.264 leads (Premiere, Final Cut and After Effects don't import WebM); Firefox gets WebM from the fallback
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
// the extension must follow the container the recorder produced (a browser may ignore the mimeType asked for), so read the chunk's own type
function clipExt(m){return /mp4/i.test(m||'')?'.mp4':'.webm';}
function clipContainer(list){return clipExt(clipMime(list)).slice(1).toUpperCase();}
// one MediaStreamDestination for the page's life, fed from Au.sum (a second tap, not a re-route); built lazily (Au.ctx needs a gesture); null = a silent clip
function clipAudioTrack(){
 if(!CAPTURE.audio||!Au.ctx||!Au.sum)return null;
 if(!CLIP.adest){
  try{CLIP.adest=Au.ctx.createMediaStreamDestination();Au.sum.connect(CLIP.adest);}
  catch(e){CLIP.adest=null;return null;}
 }
 return CLIP.adest.stream.getAudioTracks()[0]||null;
}
// begin recording `cv` (default: the game canvas); the canvas stream is per recording and its track is stopped in clipFlush (a live track copies the framebuffer for as long as it exists); the audio track hangs off a permanent node and is reused
function clipStart(cv,opt){
 cv=cv||$('game');opt=opt||{};
 // ...so a start is refused while a previous take is still flushing
 if(CLIP.live||CLIP.stopping||!clipSupported(cv))return false;
 try{
  const cs=cv.captureStream(opt.fps||CAPTURE.fps);
  CLIP.vtracks=cs.getVideoTracks();
  const st=new MediaStream(CLIP.vtracks);
  // audio:false is photo mode's turntable (a camera move has no soundtrack); the goal clip keeps the audio
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
// promote the running recording (written out when clipStop lands); false when nothing is running
function clipKeep(name){
 if(!CLIP.live)return false;
 CLIP.keep=true;CLIP.name=name||'clip';return true;
}
// end the recording; onstop > clipFlush writes it (stop() is async)
function clipStop(){
 if(!CLIP.live)return;CLIP.live=false;CLIP.stopping=true;
 try{CLIP.rec.stop();}catch(e){CLIP.stopping=false;CLIP.chunks=null;CLIP.rec=null;clipStopTracks();}
}
// onstop: the last chunk is flushed, so it's now safe to drop the canvas track (earlier truncates the tail)
function clipFlush(){
 CLIP.stopping=false;
 const ch=CLIP.chunks,keep=CLIP.keep,name=CLIP.name;
 CLIP.chunks=null;CLIP.rec=null;CLIP.keep=false;
 clipStopTracks();
 if(!keep||!ch||!ch.length)return;                       // never promoted: the encode is discarded
 // the chunk's own type is authoritative (a browser may ignore the requested mimeType)
 const mt=(ch[0]&&ch[0].type)||CLIP.mimeUsed||'video/webm';
 try{clipDownload(new Blob(ch,{type:mt}),name+clipExt(mt));}catch(e){}
}
// ===== zip (STORE) =====
// minimal ZIP writer, no compression, no dependency (photo mode's offline render hands over one file instead of 300 downloads)
// STORE (method 0) since the entries are already compressed; assembled as an array of chunks handed to Blob(); ZIP32 limits sit above CONFIG.photo.seq's caps
const ZIP_CRC=(()=>{const t=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}
 return t;})();
function zipCrc(u8){
 let c=0xFFFFFFFF;
 for(let i=0;i<u8.length;i++)c=ZIP_CRC[(c^u8[i])&255]^(c>>>8);
 return (c^0xFFFFFFFF)>>>0;
}
// DOS timestamp: 2-second resolution, year relative to 1980
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
// filename parts; clipSlug flattens a player-typed team name to something a filesystem takes
function clipStamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());}
function clipSlug(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24)||'team';}
