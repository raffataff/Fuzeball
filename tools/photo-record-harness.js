/* ===== photo mode: clean view + clip recorder — headless harness =====
   Companion to tools/photo-harness.js, covering the 2026-08-19 work: the crop-line/clean-view
   chrome split and the turntable clip recorder.  node tools/photo-record-harness.js  (from repo root)

   Four suites, none of which needs a browser or three.js:
     1. phRecRect  — the CSS-px -> backing-store mapping. The only new arithmetic that can be
        silently wrong: invert the ratio and you get a crop of a crop, which still looks plausible.
     2. phFrameSync / phChromeSync — the class decisions. The reported bug lived exactly here (the
        crop border was painted by a class whose off-state was unreachable once an aspect was set),
        so the fix gets an assertion rather than a re-read.
     3. js/capture.js lifecycle — clipStart(cv,opt) back-compat with replay.js's bare clipStart(),
        and the stop->start handoff guard that a second caller made necessary.
     4. container choice — MP4 preferred, WebM fallback, and the FILE EXTENSION following whatever
        the recorder actually produced rather than what it was asked for.
     5. phSeqSize / phSeqPlan — the offline render's frame budget, which is what stops someone
        starting a 10GB job by accident.
     6. zipStore — parsed back out by an independent reader in here. The byte offsets in a central
        directory are the classic silent bug: a wrong one still produces a file, and some unzippers
        forgive it while the one your user has does not. (Also validated out-of-band against
        python's zipfile module and Windows' Expand-Archive, both of which accept it.) */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

let pass=0,fail=0;
const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL: '+m);}};
const near=(a,b,e,m)=>ok(Math.abs(a-b)<=(e||0),m+'  (got '+a+', want ~'+b+')');
const head=t=>console.log('\n=== '+t+' ===');
// the zip suite finishes off a promise, so the summary waits for it as well as for the recorder
// suites — a harness that prints ALL PASS before its last assertion has run is worse than no harness
let zipDone=false,zipWait=null;
const done=()=>{zipDone=true;if(zipWait)zipWait();};
const waitZip=()=>zipDone?Promise.resolve():new Promise(r=>{zipWait=r;});

/* Pull one whole function out of the source by brace matching, so the harness exercises the REAL
   text of photo.js rather than a copy that can drift away from it. */
const PHOTO_SRC=rd('js/photo.js');
function slice(name){
 const i=PHOTO_SRC.indexOf('function '+name+'(');
 if(i<0)throw new Error('not found: '+name);
 let d=0;const j=PHOTO_SRC.indexOf('{',i);
 for(let k=j;k<PHOTO_SRC.length;k++){const c=PHOTO_SRC[k];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return PHOTO_SRC.slice(i,k+1);}}
 throw new Error('unbalanced: '+name);
}

/* ---------- 1. phRecRect ------------------------------------------------ */
const RECT_BODY=slice('phCrop')+'\n'+slice('phRecRect')+
 '\nreturn{phCrop:phCrop,phRecRect:phRecRect};';

function rect(name,{W,H,aspect,dpr,scale,maxPx=2560,clientW,clientH}){
 // js/world.js: CSS size = window, pixelRatio = min(devicePixelRatio,2) * cfg.renderScale
 const pr=Math.min(dpr,2)*scale;
 const cvs={width:Math.round(W*pr),height:Math.round(H*pr),
            clientWidth:clientW||W,clientHeight:clientH||H};
 const M=new Function('PH','PHOTO','cvs','innerWidth','innerHeight',RECT_BODY)(
  {aspect},{record:{maxPx}},cvs,W,H);
 const c=M.phCrop(),r=M.phRecRect();
 console.log(' '+name);
 console.log('   backing '+cvs.width+'x'+cvs.height+'   crop '+Math.round(c.w)+'x'+Math.round(c.h)+
             ' @'+Math.round(c.x)+','+Math.round(c.y)+'   src '+r.sw+'x'+r.sh+' @'+r.sx+','+r.sy+
             '   out '+r.w+'x'+r.h);
 ok(r.sx>=0&&r.sy>=0,'source origin inside the buffer');
 ok(r.sx+r.sw<=cvs.width,'source rect does not overhang in x');
 ok(r.sy+r.sh<=cvs.height,'source rect does not overhang in y');
 ok(r.w%2===0&&r.h%2===0,'output dimensions are even (chroma subsampling)');
 ok(r.w<=maxPx&&r.h<=maxPx,'output within maxPx');
 ok(r.w>=2&&r.h>=2,'output non-degenerate');
 const want=aspect||W/H;
 near(r.w/r.h,want,0.02,'output aspect is the aspect that was FRAMED');
 near(r.sw/r.sh,want,0.02,'source aspect is the aspect that was FRAMED');
 return r;
}

head('phRecRect — crop to backing store');
let r=rect('16:9 crop, 16:9 window, dpr 1, renderScale 1',{W:1600,H:900,aspect:16/9,dpr:1,scale:1});
near(r.sw,1600,1,'takes the full width');near(r.w,1600,1,'no rescale needed');

r=rect('1:1 pillarbox, dpr 2',{W:1600,H:900,aspect:1,dpr:2,scale:1});
near(r.sx,700,2,'centred: css x 350 -> device x 700, NOT the corner');
near(r.sw,1800,2,'square off the full height');
ok(r.w===1800&&r.h===1800,'under the ceiling -> 1:1 with the backing store');

r=rect('16:9 on a 4K window at dpr 2 (over maxPx)',{W:3840,H:2160,aspect:16/9,dpr:2,scale:1});
ok(r.sw===7680,'source is the full device width');
ok(r.w===2560&&r.h===1440,'downscaled to the ceiling, aspect intact');

// THE case the panel readout exists for: a clip cannot beat the live backing store
r=rect('16:9, renderScale 0.6 (the truth-telling case)',{W:1600,H:900,aspect:16/9,dpr:1,scale:0.6});
near(r.w,960,2,'output is the REAL 0.6-scale pixels, not a nominal 1600');

rect('21:9 letterbox on an odd 1601x901 window',{W:1601,H:901,aspect:21/9,dpr:1,scale:1});
rect('9:16 tall crop on 2560x1440',{W:2560,H:1440,aspect:9/16,dpr:1,scale:1});

r=rect('aspect WINDOW (0) on 1280x1024',{W:1280,H:1024,aspect:0,dpr:1,scale:1});
near(r.sw,1280,1,'full width');near(r.sh,1024,1,'full height');

rect('dpr 1.5 with client size 1% off the window (browser zoom)',
 {W:1600,H:900,aspect:16/9,dpr:1.5,scale:1,clientW:1584,clientH:891});
rect('degenerate: 40x30 window at renderScale 0.4',{W:40,H:30,aspect:1,dpr:1,scale:0.4});

/* ---------- 2. chrome classes ------------------------------------------- */
const CHROME_BODY=slice('phFrameSync')+'\n'+slice('phChromeSync')+
 '\nreturn{phFrameSync:phFrameSync,phChromeSync:phChromeSync};';
function el(){
 const set=new Set();
 return{style:{},has:c=>set.has(c),classList:{
  toggle:(c,v)=>{if(v===undefined)v=!set.has(c);v?set.add(c):set.delete(c);},
  add:c=>set.add(c),remove:c=>set.delete(c),contains:c=>set.has(c)}};
}
function chromeBuild(PH){
 const nodes={phCrop:el(),phFrame:el(),phOut:{textContent:''},phClean:el()},phPanel=el();
 const F=new Function('PH','$','phBuilt','phPanel','phCrop','phOutSize','innerWidth','innerHeight',
  CHROME_BODY)(PH,id=>nodes[id]||null,true,phPanel,
  ()=>({x:10,y:20,w:800,h:450}),()=>({w:1600,h:900,c:{x:10,y:20,w:800,h:450}}),1600,900);
 return{F,nodes,phPanel};
}

head('crop guides — the reported bug');
const frame=o=>{
 const b=chromeBuild(Object.assign(
  {on:true,aspect:16/9,line:true,mask:false,thirds:false,cross:false},o));
 b.F.phFrameSync();return b.nodes.phCrop;
};
ok(frame({}).has('line'),'aspect + line on  -> border drawn');
ok(!frame({line:false}).has('line'),'aspect + line OFF -> border gone  <-- was impossible before');
ok(!frame({aspect:0}).has('line'),'aspect WINDOW -> no border (nothing to outline)');
let g=frame({line:false,mask:true,thirds:true,cross:true});
ok(!g.has('line')&&g.has('mask')&&g.has('thirds')&&g.has('cross'),
 'the border is independent of mask / thirds / cross');
ok(!frame({mask:true,aspect:0}).has('mask'),'mask still needs an aspect');
g=frame({line:false,mask:false,thirds:false,cross:false});
ok(!g.has('line')&&!g.has('mask')&&!g.has('thirds')&&!g.has('cross'),
 'a FULLY clean crop overlay is reachable with an aspect set');

head('clean view (C) vs panel hide (H)');
const chrome=o=>{
 const b=chromeBuild(Object.assign({on:true,clean:false,panelHid:false},o));
 b.F.phChromeSync();
 return{panel:b.phPanel.has('hidden'),frame:b.nodes.phFrame.has('hidden'),
        btn:b.nodes.phClean.has('on')};
};
let s=chrome({});          ok(!s.panel&&!s.frame,'default: panel up, guides up');
s=chrome({panelHid:true}); ok(s.panel&&!s.frame,'H: panel down, guides up (compose without controls)');
s=chrome({clean:true});    ok(s.panel&&s.frame&&s.btn,'C: everything down, button reads as on');
s=chrome({clean:true,panelHid:true}); ok(s.panel&&s.frame,'C wins over H');
s=chrome({on:false});      ok(s.panel&&s.frame,'mode off -> nothing on screen, whatever the state');

/* ---------- 3. capture.js lifecycle ------------------------------------- */
function clipBoot(opt){
 opt=opt||{};
 const made=[],flushed=[];
 const supports=opt.supports||(()=>true);
 class FakeRec{
  constructor(st,o){this.stream=st;this.opts=o;made.push(this);}
  // one chunk, synchronously — an empty take is discarded by clipFlush and the test would lie.
  // chunkType lets a browser hand back a container it was NOT asked for, which is legal.
  start(){if(this.ondataavailable)this.ondataavailable(
   {data:{size:10,type:opt.chunkType!==undefined?opt.chunkType:(this.opts&&this.opts.mimeType)}});}
  stop(){if(this.onstop)setTimeout(this.onstop,0);}       // ASYNC, like the real one
 }
 FakeRec.isTypeSupported=t=>supports(t);
 const canvas=name=>({name,captureStream:()=>({getVideoTracks:()=>[{stop(){}}]})});
 const els={game:canvas('game')};
 const ctx={console,setTimeout,clearTimeout,
  Blob:class{constructor(p,o){this.parts=p;this.type=o&&o.type;}},
  URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},
  MediaRecorder:FakeRec,
  MediaStream:class{constructor(t){this.t=t.slice();}addTrack(x){this.t.push(x);}getAudioTracks(){return[];}},
  document:{createElement:()=>({style:{},click(){flushed.push(this.download);},remove(){}}),
            body:{appendChild(){},removeChild(){}}},
  $:id=>els[id]||null, Au:{ctx:null,mg:null},
  CAPTURE:{on:true,fps:60,bitrate:1,audio:true,audioBitrate:1,chunkMs:250,revokeMs:1,
           prefix:'goal',mime:opt.capMime||['video/mp4;codecs=avc1.640033','video/webm;codecs=vp9','video/webm']},
  made,flushed,canvas};
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(rd('js/capture.js'),ctx,{filename:'capture.js'});
 return ctx;
}
const run=(c,e)=>vm.runInContext(e,c);
const tick=()=>new Promise(r=>setTimeout(r,5));

(async()=>{
 head('capture.js — replay.js back-compat');
 let c=clipBoot();
 ok(run(c,'clipSupported()')===true,'clipSupported() with no args still resolves #game');
 ok(run(c,'clipStart()')===true,'bare clipStart() still starts');
 ok(run(c,'clipReady()')===true,'clipReady true while rolling');
 ok(c.made[0].stream.t.length===1,'no Au context -> video track only');
 ok(run(c,'clipKeep("goal_x")')===true,'clipKeep promotes');
 run(c,'clipStop()');await tick();
 ok(c.flushed.length===1&&c.flushed[0]==='goal_x.mp4',
  'promoted take was written — and as .mp4 now that CONFIG.capture.mime leads with it');

 head('capture.js — photo mode passes its own canvas and options');
 c=clipBoot();
 ok(run(c,'clipStart(canvas("crop"),{audio:false,fps:30,bitrate:99})')===true,
  'starts on a foreign (off-screen crop) canvas');
 ok(c.made[0].opts.videoBitsPerSecond===99,'per-take bitrate honoured');
 ok(c.made[0].stream.t.length===1,'audio:false -> no audio track requested');
 run(c,'clipKeep("turntable_x")');run(c,'clipStop()');await tick();
 ok(c.flushed[0]==='turntable_x.mp4','turntable take written under its own name');

 head('capture.js — the stop/start handoff (stop() is async)');
 c=clipBoot();
 run(c,'clipStart(canvas("crop"),{audio:false})');
 run(c,'clipKeep("turntable_y")');
 run(c,'clipStop()');                                   // onstop has NOT fired yet
 ok(run(c,'clipReady()')===false,'clipReady false the instant a stop is asked for');
 ok(run(c,'clipStart()')===false,'a start inside the flush window is REFUSED');
 ok(c.made.length===1,'no second recorder was constructed');
 await tick();
 ok(c.flushed.length===1&&c.flushed[0]==='turntable_y.mp4','the first take wrote out intact');
 ok(run(c,'clipStart()')===true,'and the recorder is free again once the flush lands');


/* ---------- 5. offline sequence budget ---------------------------------- */
const SEQ_BODY=slice('phCrop')+'\n'+slice('phSeqSize')+'\n'+slice('phSeqPlan')+'\n'+slice('phBytes')+
 '\nreturn{phSeqSize:phSeqSize,phSeqPlan:phSeqPlan,phBytes:phBytes};';
function seq({aspect=16/9,h=1080,fps=30,secs=10,fmt='jpeg',maxPx=4096,gl=8192,W=1600,H=900}={}){
 const PH={aspect,seqH:h,seqFps:fps,seqSecs:secs,seqFmt:fmt};
 const PHOTO={seq:{maxPx,bpp:{jpeg:0.22,png:1.6}}};
 return new Function('PH','PHOTO','phMaxPx','innerWidth','innerHeight',SEQ_BODY)(
  PH,PHOTO,()=>gl,W,H);
}

head('phSeqSize / phSeqPlan — the frame budget');
let q=seq({aspect:16/9,h:1080}).phSeqSize();
ok(q.w===1920&&q.h===1080,'16:9 at 1080p -> 1920x1080');
q=seq({aspect:1,h:1080}).phSeqSize();
ok(q.w===1080&&q.h===1080,'square crop at 1080p -> 1080x1080');
q=seq({aspect:9/16,h:1080}).phSeqSize();
ok(q.w===608&&q.h===1080,'vertical crop keeps the height and narrows (even)');
q=seq({aspect:21/9,h:2160}).phSeqSize();
ok(q.w<=4096&&q.h<=4096,'21:9 at 2160p is clamped to maxPx');
ok(q.w%2===0&&q.h%2===0,'clamped result is still even');
near(q.w/q.h,21/9,0.02,'clamping preserves the framed aspect');
q=seq({aspect:16/9,h:2160,gl:2048}).phSeqSize();
ok(q.w<=2048&&q.h<=2048,'a low GL texture limit clamps it further');

let pl=seq({fps:30,secs:10}).phSeqPlan();
ok(pl.n===300,'30fps x 10s -> 300 frames');
near(pl.n*pl.step,360,1e-9,'the sweep is EXACTLY one revolution, so the sequence loops');
pl=seq({fps:60,secs:40}).phSeqPlan();
ok(pl.n===2400,'60fps x 40s -> 2400 frames (over the 1800 cap, and refused at the call site)');
// the estimate is the whole reason the panel shows a number before you commit
const jp=seq({fps:30,secs:10,fmt:'jpeg'}).phSeqPlan(),
      pn=seq({fps:30,secs:10,fmt:'png'}).phSeqPlan();
ok(jp.bytes<pn.bytes,'png estimates larger than jpeg');
ok(jp.bytes<300e6,'the DEFAULT job (1080p jpeg 10s) estimates well under 300MB — '+
  new Function('return '+JSON.stringify(jp.bytes))()+' bytes');
ok(pn.bytes>800e6,'a 1080p PNG 10s job estimates high enough to be worth warning about');
const B=seq().phBytes;
ok(B(512)==='512 B'&&B(1536)==='1.5 KB'&&B(1048576)==='1 MB','byte formatting reads sensibly');

/* ---------- 6. zipStore ------------------------------------------------- */
head('zipStore — byte layout parsed back out');
(function(){
 const cap=rd('js/capture.js');
 const a=cap.indexOf('/* ===== zip (STORE) ====='),b=cap.indexOf('function clipDownload(');
 if(a<0||b<0){ok(false,'zip section found in capture.js');return;}
 const Z=new Function(cap.slice(a,b)+'\nreturn{zipStore:zipStore,zipCrc:zipCrc};')();

 const files=[
  {name:'seq/frame_0001.jpg',data:new Uint8Array([1,2,3,4,5])},
  {name:'seq/empty.bin',data:new Uint8Array(0)},                       // zero-length entry
  {name:'seq/all_bytes.bin',data:Uint8Array.from({length:256},(_,i)=>i)},
  {name:'seq/deep/nested/long_file_name_0003.png',data:new Uint8Array(5000).fill(88)},
  {name:'seq/README.txt',data:new TextEncoder().encode('line\r\n')}
 ];
 const blob=Z.zipStore(files);
 ok(blob.type==='application/zip','blob is typed as a zip');

 blob.arrayBuffer().then(ab=>{
  const u=new Uint8Array(ab),dv=new DataView(ab);
  // --- End Of Central Directory: last 22 bytes (no comment) ---
  const eo=u.length-22;
  ok(dv.getUint32(eo,true)===0x06054b50,'EOCD signature at the end');
  const cnt=dv.getUint16(eo+10,true),cdSize=dv.getUint32(eo+12,true),cdOff=dv.getUint32(eo+16,true);
  ok(cnt===files.length,'EOCD entry count');
  ok(cdOff+cdSize===eo,'central directory size + offset land exactly on the EOCD');
  // --- walk the central directory, then follow each offset to its local header ---
  let o=cdOff,seen=0,allOk=true,namesOk=true,crcOk=true,sizeOk=true;
  for(let i=0;i<cnt;i++){
   if(dv.getUint32(o,true)!==0x02014b50){allOk=false;break;}
   const crc=dv.getUint32(o+16,true),cs=dv.getUint32(o+20,true),us=dv.getUint32(o+24,true),
         nl=dv.getUint16(o+28,true),lo=dv.getUint32(o+42,true),
         nm=new TextDecoder().decode(u.subarray(o+46,o+46+nl));
   if(nm!==files[i].name)namesOk=false;
   if(cs!==us||us!==files[i].data.length)sizeOk=false;
   // the offset must point at THIS entry's local header, with the same name after it
   if(dv.getUint32(lo,true)!==0x04034b50)allOk=false;
   const lnl=dv.getUint16(lo+26,true),lel=dv.getUint16(lo+28,true),
         lnm=new TextDecoder().decode(u.subarray(lo+30,lo+30+lnl));
   if(lnm!==nm)namesOk=false;
   if(dv.getUint32(lo+14,true)!==crc)crcOk=false;
   // and the bytes there must actually be the file, by CRC
   const data=u.subarray(lo+30+lnl+lel,lo+30+lnl+lel+us);
   if(Z.zipCrc(data)!==crc)crcOk=false;
   if(us&&data[0]!==files[i].data[0])allOk=false;
   o+=46+nl+dv.getUint16(o+30,true)+dv.getUint16(o+32,true);
   seen++;
  }
  ok(seen===cnt,'walked every central directory record');
  ok(allOk,'every local-header offset points at a real local header');
  ok(namesOk,'names agree between central directory and local headers');
  ok(sizeOk,'STORE: compressed size == uncompressed size == the real length');
  ok(crcOk,'every CRC32 matches the bytes actually stored');
  ok(o===eo,'the central directory ends exactly where the EOCD begins');
  done();
 });
})();

 head('capture.js — container choice and file extension');
 // MP4 is the deliverable that every NLE takes; webm is the Firefox path. The FILENAME has to
 // follow whatever came back, or the file is mislabelled and an editor refuses it outright.
 const MP4=['video/mp4;codecs=avc1.640033','video/mp4','video/webm;codecs=vp9','video/webm'];

 c=clipBoot();                                            // a browser that admits everything
 ok(run(c,'clipMime(["video/mp4","video/webm"])')==='video/mp4','picks the first admitted entry');
 ok(run(c,'clipExt("video/mp4;codecs=avc1.640033")')==='.mp4','mp4 codec string -> .mp4');
 ok(run(c,'clipExt("video/webm;codecs=vp9")')==='.webm','webm codec string -> .webm');
 ok(run(c,'clipExt("")')==='.webm','unknown -> .webm rather than no extension');
 ok(run(c,'clipContainer(["video/mp4"])')==='MP4','container label for the panel');
 run(c,'globalThis.__M='+JSON.stringify(MP4));
 ok(run(c,'clipStart(canvas("crop"),{audio:false,mime:__M})')===true,'starts with an mp4 list');
 ok(/mp4/.test(c.made[0].opts.mimeType),'asked the recorder for mp4');
 run(c,'clipKeep("turntable_mp4")');run(c,'clipStop()');await tick();
 ok(c.flushed[0]==='turntable_mp4.mp4','written as .mp4');

 // Firefox: no mp4 recording. Must fall back cleanly AND name the file .webm.
 c=clipBoot({supports:t=>/webm/i.test(t)});
 run(c,'globalThis.__M='+JSON.stringify(MP4));
 ok(run(c,'clipMime(__M)')==='video/webm;codecs=vp9','falls past every mp4 entry to vp9');
 ok(run(c,'clipStart(canvas("crop"),{audio:false,mime:__M})')===true,'still records');
 run(c,'clipKeep("turntable_fx")');run(c,'clipStop()');await tick();
 ok(c.flushed[0]==='turntable_fx.webm','written as .webm — no mislabelled mp4');

 // a browser that admits NOTHING still gets a take: '' means "pick your own default"
 c=clipBoot({supports:()=>false,chunkType:'video/webm'});
 ok(run(c,'clipMime(["video/mp4"])')==='','no candidate admitted -> browser default');
 ok(run(c,'clipStart(canvas("crop"),{audio:false,mime:["video/mp4"]})')===true,'records anyway');
 run(c,'clipKeep("turntable_any")');run(c,'clipStop()');await tick();
 ok(c.flushed[0]==='turntable_any.webm','named from the CHUNK type, not the request');

 // the browser is free to ignore mimeType — the chunk wins, so the name follows reality
 c=clipBoot({chunkType:'video/webm;codecs=vp8'});
 run(c,'clipStart(canvas("crop"),{audio:false,mime:["video/mp4"]})');
 run(c,'clipKeep("turntable_lie")');run(c,'clipStop()');await tick();
 ok(c.flushed[0]==='turntable_lie.webm','requested mp4, got webm -> named .webm');

 // per-list caching must not leak one list's answer into another
 c=clipBoot({supports:t=>/webm/i.test(t)});
 run(c,'clipMime(["video/webm"])');
 ok(run(c,'clipMime(["video/mp4"])')==='','a second list is resolved on its own, not from cache');
 ok(run(c,'clipMime()')==='video/webm;codecs=vp9','the default list still resolves');

 await waitZip();
 console.log('\n'+(fail?('FAILED  '+fail+' of '+(pass+fail)+' assertions')
                       :('ALL PASS  '+pass+' assertions')));
 process.exit(fail?1:0);
})();
