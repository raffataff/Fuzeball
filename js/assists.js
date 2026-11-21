'use strict';
// ================= the assist ledger (dev: CONFIG.debug.assistLog; F9, or the C overlay's AI DEBUG panel) =================
// every player-side assist calls aslHit when it acts on a held rod: an episode count (an act after `gap` s quiet), its time, a value (degrees, ms) and a tag over the rod
// gate S.asl (null = off); the hooks are one line each; COPY puts every kept match on the clipboard as JSON (tools/control-sheet.js reads it)

const ASLC=CONFIG.debug&&CONFIG.debug.assistLog;
const ASL_COL={aim:'#ffcf4d',pin:'#3ec6ff',pad:'#ff7ad1',sw:'#7dff8a',kick:'#d8dde6'};
const ASL_GRP={aim:'AIM',pin:'PIN AND POSE',pad:'PAD',sw:'ROD SWITCH',kick:'WHAT A KICK PRESS BECAME'};
// id, tag over the rod, group, the value's unit
const ASL_DEFS=[
 ['aim','AIM','aim','°'],['pass','PASS AIM','aim','°'],['wall','WALL','aim','°'],
 ['backAim','PIN OVER','pin'],['fwdAim','FWD OVER','pin'],['settle','SETTLE','pin'],['stick','STICK PIN','pin'],['roll','ROLL','pin'],['under','TOE LIFT','pin'],['hop','HOP','pin'],
 ['recvPose','RECV','pin'],['recvDraw','RECV DRAW','pin'],['rcvKeep','RECV HELD','pin'],['fwdTake','FWD TAKE','pin'],['liftOff','LIFT OFF','pin'],['fwdRaise','MEN UP','pin'],
 ['square','SQUARE','pin'],['lead','LEAD','pin'],['guard','GUARD','pin'],['heldOut','HELD OUT','pin'],['mates','MATES READY','pin'],
 ['stickCarry','STICK CARRY','pad'],['ltLatch','LT LATCH','pad'],['chord','A WAITS','pad','ms'],
 ['autoSwitch','AUTO','sw'],['gkHold','GK HELD','sw'],['slideFreeze','SLIDE FROZEN','sw'],['raiseKeep','KEPT RAISE','sw'],
 ['kSwing','SWING','kick'],['kShot','SHOT','kick'],['kCharge','CHARGED','kick'],['kGrace','LATE RELEASE','kick'],['kFlinch','FLINCH','kick'],['kPass','PASS','kick'],
 ['kPinPass','PIN PASS','kick','ms'],['kPinShot','PIN SHOT','kick'],['kFwdPin','FWD PIN','kick'],['kStroke','STROKE','kick'],['kSnake','SNAKE','kick']
].map(a=>({id:a[0],tag:a[1],g:a[2],u:a[3]||''}));
const ASL_BY={};for(const d of ASL_DEFS)ASL_BY[d.id]=d;
const ASL_STORE='fuzeball_asl';

// --- the record ---
function aslRec(){return {at:Date.now(),seed:S.seed>>>0,mode:null,dev:null,secs:0,score:null,done:false,ids:{}};}
function aslMode(){return S.trial?'trial':S.tut?'tutorial':S.trn?'training':S.lg?(S.lg.cup?'cup':'league'):(S.mode||'?');}
function aslLoad(){try{const o=JSON.parse(localStorage.getItem(ASL_STORE)||'null');return o&&typeof o==='object'?o:null;}catch(e){return null;}}
function aslHist(){const L=S.asl;if(!L)return [];const h=L.hist.slice();if(L.m&&(L.m.secs>1||Object.keys(L.m.ids).length))h.push(L.m);return h.slice(-ASLC.keep);}
function aslSave(on){
 const L=S.asl,o=aslLoad()||{};
 try{localStorage.setItem(ASL_STORE,JSON.stringify({on:on!=null?on:!!L,tags:L?L.tags:o.tags!==false,hist:L?aslHist():(o.hist||[])}));}catch(e){}
}
function aslClose(m){m.mode=aslMode();m.dev=typeof inputKind==='function'?inputKind():null;m.score=S.score?S.score.slice():null;m.secs=Math.round(m.secs);}
// a match starts (flow.js startMatchNow): an unfinished one is kept as it stands
function aslStart(){const L=S.asl;if(!L)return;if(L.m&&(L.m.secs>1||Object.keys(L.m.ids).length)){aslClose(L.m);L.hist.push(L.m);}L.m=aslRec();L.live.clear();aslSave();}
// ...and ends (flow.js endMatch)
function aslEnd(){const L=S.asl;if(!L||!L.m)return;aslClose(L.m);L.m.done=true;L.hist.push(L.m);L.hist=L.hist.slice(-ASLC.keep);L.m=null;aslSave();}

// --- one act of one assist on a held rod ---
function aslHit(r,id,v,txt){
 const L=S.asl,d=ASL_BY[id];if(!L||!d||!r)return;
 const m=L.m||(L.m=aslRec()),e=m.ids[id]||(m.ids[id]={n:0,t:0,vn:0,v:0,vx:0});
 const T=r.aslT||(r.aslT={}),q=S.time-(T[id]==null?-1e9:T[id]);
 if(d.g==='kick'||q<0||q>ASLC.gap)e.n++;else e.t+=q;   // S.time restarts with a match: a stamp ahead of it is a new episode
 T[id]=S.time;
 if(v!=null&&isFinite(v)){e.vn++;e.v+=v;if(Math.abs(v)>Math.abs(e.vx))e.vx=v;}
 if(!L.tags)return;
 const g=L.live.get(r)||new Map();L.live.set(r,g);
 g.delete(id);g.set(id,{w:performance.now(),s:d.tag+(txt?' '+txt:'')+(v!=null&&d.u?' '+Math.round(v)+d.u:''),c:ASL_COL[d.g]});   // re-set: the newest act draws nearest the rod
}

// --- the tags over the rods ---
const _aslV=new THREE.Vector3();
function aslCanvas(L){
 if(L.cv)return L.cv;
 const c=document.createElement('canvas');
 c.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:21;pointer-events:none';
 document.body.appendChild(c);L.cv=c;L.cx=c.getContext('2d');
 return c;
}
function aslDraw(rdt){
 const L=S.asl;if(!L)return;
 if(L.m&&S.phase==='play')L.m.secs+=rdt;
 const now=performance.now();
 if(now-L.st>ASLC.saveEvery*1000){L.st=now;aslSave();}
 aslPanelTick(now);
 const c=aslCanvas(L),cx=L.cx,dpr=Math.min(2,devicePixelRatio||1),W=Math.round(innerWidth*dpr),H=Math.round(innerHeight*dpr);
 if(c.width!==W||c.height!==H){c.width=W;c.height=H;L.dirty=true;}
 if(L.dirty){cx.clearRect(0,0,W,H);L.dirty=false;}
 if(!L.tags||!L.live.size||S.photo||S.phase==='menu')return;
 const life=ASLC.tagT*1000,fs=Math.round(ASLC.font*dpr),lh=fs+Math.round(6*dpr),b=S.balls[0];
 cx.font='600 '+fs+'px "Exo 2",sans-serif';cx.textAlign='center';cx.textBaseline='middle';
 for(const [r,g] of L.live){
  for(const [id,t] of g)if(now-t.w>life)g.delete(id);
  if(!g.size){L.live.delete(r);continue;}
  let mi=(r.baseZ.length-1)>>1;
  if(b){let bd=1e9;for(let i=0;i<r.baseZ.length;i++){const d=Math.abs(b.m.position.z-(r.baseZ[i]+r.pivot.position.z));if(d<bd){bd=d;mi=i;}}}
  _aslV.set(r.x,ROD_H+ASLC.lift,r.baseZ[mi]+r.pivot.position.z).project(camera);
  if(_aslV.z>1)continue;
  const x=(_aslV.x+1)/2*W;let y=(1-_aslV.y)/2*H;
  const list=[...g.values()].reverse();
  for(const t of list){
   const a=clamp(1-(now-t.w-life*.6)/(life*.4),0,1),w=cx.measureText(t.s).width+12*dpr;
   cx.globalAlpha=a;cx.fillStyle='rgba(0,0,0,.72)';cx.fillRect(x-w/2,y-lh/2,w,lh-2*dpr);
   cx.fillStyle=t.c;cx.fillText(t.s,x,y);y-=lh;
  }
 }
 cx.globalAlpha=1;L.dirty=true;
}

// --- the panel (pause, the win board, or with the C overlay up) ---
function aslPanelEl(L){
 if(L.pn)return L.pn;
 const p=document.createElement('div');
 p.style.cssText='position:fixed;left:16px;top:14px;z-index:70;background:rgba(0,0,0,.84);border:1px solid rgba(62,198,255,.3);border-radius:2px;padding:10px 12px;font:600 12px "Exo 2",sans-serif;color:#d8dde6;max-height:calc(100vh - 28px);overflow:auto;pointer-events:auto;display:none;min-width:330px';
 const h=document.createElement('div');h.style.cssText='font-family:var(--font-ui);letter-spacing:.18em;color:#3ec6ff;margin-bottom:6px';h.textContent='ASSIST LEDGER  ·  F9';p.appendChild(h);
 const body=document.createElement('div');p.appendChild(body);
 const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;margin-top:8px';
 const btn=(t,f)=>{const e=document.createElement('button');e.textContent=t;e.style.cssText='font:600 11px "Exo 2",sans-serif;padding:3px 9px;background:#16202c;color:#d8dde6;border:1px solid rgba(62,198,255,.35);cursor:pointer';e.addEventListener('click',f);row.appendChild(e);return e;};
 btn('COPY',aslCopy);
 const tg=btn('',()=>{L.tags=!L.tags;tg.textContent=L.tags?'TAGS ON':'TAGS OFF';L.live.clear();aslSave();});tg.textContent=L.tags?'TAGS ON':'TAGS OFF';
 btn('CLEAR',()=>{L.hist=[];L.m=aslRec();aslSave();L.pt=0;});
 btn('OFF',()=>aslToggle(false));
 p.appendChild(row);document.body.appendChild(p);
 L.pn=p;L.body=body;
 return p;
}
function aslPanelWant(){return (typeof dbgOn!=='undefined'&&dbgOn)||S.phase==='pause'||S.phase==='win'||ASLC.panel==='always';}
function aslPanelTick(now){
 const L=S.asl,on=aslPanelWant();
 if(!on){if(L.pn)L.pn.style.display='none';return;}
 const p=aslPanelEl(L);p.style.display='block';
 if(now-L.pt<250)return;L.pt=now;
 const h=aslHist(),cur=L.m&&(L.m.secs>1||Object.keys(L.m.ids).length)?L.m:h[h.length-1],n=h.length;
 const min=cur&&cur.secs>=30?cur.secs/60:0,f=x=>x>=10?Math.round(x):x.toFixed(1);   // no rate off the first half minute
 let s='<div style="color:#8a96a8;margin-bottom:4px">'+(cur?'this match '+Math.floor(cur.secs/60)+':'+String(Math.round(cur.secs%60)).padStart(2,'0'):'no match yet')+'  ·  '+n+' kept</div>';
 s+='<table style="border-collapse:collapse"><tr style="color:#8a96a8"><td></td><td style="padding:0 8px">n</td><td style="padding:0 8px">/min</td><td style="padding:0 8px">avg</td><td style="padding:0 8px">/match</td></tr>';
 let g0=null;
 for(const d of ASL_DEFS){
  const e=cur&&cur.ids[d.id];let all=0;for(const mm of h)all+=(mm.ids[d.id]&&mm.ids[d.id].n)||0;
  if(!e&&!all)continue;
  if(d.g!==g0){g0=d.g;s+='<tr><td colspan=5 style="padding-top:5px;color:'+ASL_COL[d.g]+';letter-spacing:.12em;font-size:10px">'+ASL_GRP[d.g]+'</td></tr>';}
  s+='<tr><td style="color:'+ASL_COL[d.g]+'">'+d.tag+'</td><td style="padding:0 8px;text-align:right">'+(e?e.n:0)+'</td><td style="padding:0 8px;text-align:right">'+(e&&min?f(e.n/min):'')+'</td><td style="padding:0 8px;text-align:right">'+(e&&e.vn?Math.round(e.v/e.vn)+d.u:'')+'</td><td style="padding:0 8px;text-align:right">'+(n?f(all/n):'')+'</td></tr>';
 }
 L.body.innerHTML=s+'</table>';
}
function aslCopy(){
 const s=JSON.stringify({v:1,at:new Date().toISOString(),gap:ASLC.gap,matches:aslHist()});
 console.log(s);
 const fb=()=>{const t=document.createElement('textarea');t.value=s;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch(e){}t.remove();};
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(s).catch(fb);else fb();
 toast('ASSIST LEDGER','copied · '+aslHist().length+' matches',1.2);
}

// --- on / off (F9, the AI DEBUG checkbox, or remembered from the last session) ---
function aslToggle(on,quiet){
 if(!ASLC||!ASLC.on)return;
 const want=on==null?!S.asl:!!on;
 if(want!==!!S.asl){
  if(want){const o=aslLoad();S.asl={hist:o&&Array.isArray(o.hist)?o.hist:[],m:null,tags:!(o&&o.tags===false),live:new Map(),cv:null,cx:null,pn:null,body:null,pt:0,st:0,dirty:false};}
  else{const L=S.asl;aslSave(false);if(L.cv)L.cv.remove();if(L.pn)L.pn.remove();S.asl=null;}
  if(want)aslSave(true);
 }
 document.querySelectorAll('.aslCb').forEach(c=>{c.checked=want;});
 if(!quiet&&typeof toast==='function')toast('ASSIST LEDGER',want?'on · tags over your rod · F9 off':'off',1.3);
}
{const o=aslLoad();if(o&&o.on)aslToggle(true,true);}
