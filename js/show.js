'use strict';
/* ================= the show: table boards, pitch line glow, the walkout ================= */
// optional (CONFIG.show): S.show is this file's gate and every hook elsewhere is one line behind it; without the file a match runs as before
// showSee turns the match into signals (a goal, a kickoff, a hard shot) that the boards and the pitch read; the walkout lives inside the opening count
const SHC=CONFIG.show||{on:false};
const SHW={on:false,t:0,T:0,k:'full',kb:null,keys:null,end:null,cap:null,p:[0,0,0,0,0,0],l:[0,0,0,0,0,0]};
const SH={t:0,sc:[0,0],ph:'',goal:null,kick:-99,shot:null,sp:new WeakMap(),bd:null,bt:null,
 ln:{pid:undefined,U:null,tex:null,black:null},
 get walk(){return SHW.on&&S.phase==='count'&&S.countT>MATCH.countIn?SHW:null;}};   // input and the count read this: only the long front of the opening count, null the moment it ends, however it ends
if(SHC.on)S.show=SH;

// --- signals ---
// a goal = a score going up (team, when); a kickoff = the count giving way to play; a shot = a ball that just gained most of its speed, fast enough to post
function showSee(rdt){
 SH.t+=rdt;
 for(let t=0;t<2;t++){if(S.score[t]>SH.sc[t])SH.goal={team:t,t:SH.t};SH.sc[t]=S.score[t];}
 if(S.phase!==SH.ph){
  if(SH.ph==='count'&&S.phase==='play')SH.kick=SH.t;
  if(S.phase==='menu')SH.goal=SH.shot=null;
  SH.ph=S.phase;
 }
 if(S.phase!=='play')return;
 const K=SHC.shot,km=MSTAT.kmh;
 for(const b of S.balls){
  const v=b.v.length(),o=SH.sp.get(b)||0;SH.sp.set(b,v);
  if(v*km>=K.min&&v-o>v*K.jump)SH.shot={kmh:Math.round(v*km),t:SH.t};
  else if(SH.shot&&SH.t-SH.shot.t<0.15&&v*km>SH.shot.kmh)SH.shot.kmh=Math.round(v*km);   // the rest of the swing lands a frame later
 }
}

// --- the boards: dot-matrix panels on the far wall, one canvas texel per dot, redrawn only when what they show changes ---
// 5x7 glyphs, one row per number, bit 4 the left column; digits and letters are 5 wide, the rest are trimmed to their ink
const SHF={'0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],'3':[31,2,4,2,1,17,14],'4':[2,6,10,18,31,2,2],
 '5':[31,16,30,1,1,17,14],'6':[6,8,16,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,17,17,14,17,17,14],'9':[14,17,17,15,1,2,12],
 A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],D:[28,18,17,17,17,18,28],E:[31,16,16,30,16,16,31],
 F:[31,16,16,30,16,16,16],G:[14,17,16,23,17,17,15],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],J:[7,2,2,2,2,18,12],
 K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],M:[17,27,21,21,17,17,17],N:[17,17,25,21,19,17,17],O:[14,17,17,17,17,17,14],
 P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],
 U:[17,17,17,17,17,17,14],V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,21,10],X:[17,17,10,4,10,17,17],Y:[17,17,10,4,4,4,4],
 Z:[31,1,2,4,8,16,31],'-':[0,0,0,14,0,0,0],':':[0,4,4,0,4,4,0],'.':[0,0,0,0,0,0,4],'!':[4,4,4,4,4,0,4],'?':[14,17,1,2,4,0,4],
 '/':[1,1,2,4,8,16,16],"'":[4,4,8,0,0,0,0],'&':[12,18,20,8,21,18,13],'+':[0,4,4,31,4,4,0],'#':[10,10,31,10,31,10,10],' ':[0,0,0,0,0,0,0]};
const SHFW={};   // glyph -> [first column, width]
for(const c in SHF){
 if(c===' '){SHFW[c]=[0,2];continue;}
 if(/[0-9A-Z]/.test(c)){SHFW[c]=[0,5];continue;}
 let m=0;for(const r of SHF[c])m|=r;let lo=0,hi=4;while(lo<4&&!(m&(16>>lo)))lo++;while(hi>lo&&!(m&(16>>hi)))hi--;SHFW[c]=[lo,hi-lo+1];
}
function shClean(s){return String(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^0-9A-Z\-:.!?/'&+# ]/g,'?');}
function shTW(segs){let w=-1;for(const g of segs)for(const c of g[0])w+=SHFW[c][1]+1;return Math.max(0,w);}
// one segment list ([text, css colour]...) at dot x, y
function shText(cx,segs,x,y){
 for(const g of segs){cx.fillStyle=g[1];
  for(const c of g[0]){const G=SHF[c],F2=SHFW[c];
   for(let r=0;r<7;r++){const b=G[r];if(!b)continue;for(let k=0;k<F2[1];k++)if(b&(16>>(F2[0]+k)))cx.fillRect(x+k,y+r,1,1);}
   x+=F2[1]+1;}}
}
// a kit colour as it reads on an LED: dark kits lifted, so a navy team still lights its digits
const shLed=new Map();
function shLedCol(c){
 let o=shLed.get(c);if(o)return o;
 const C=new THREE.Color(typeof c==='number'?c:String(c)),h={};C.getHSL(h);C.setHSL(h.h,Math.min(1,h.s*1.1),clamp(h.l,.52,.7));
 o='#'+C.getHexString();shLed.set(c,o);return o;
}
function shCss(c){return typeof c==='number'?'#'+c.toString(16).padStart(6,'0'):c;}
function shBoardPatch(m,U){
 m.onBeforeCompile=sh=>{
  for(const k in U)sh.uniforms[k]=U[k];
  const f=shRep(sh.fragmentShader,'#include <common>','#include <common>\nuniform vec2 shGrid,shEdge;uniform float shDot,shGain;uniform vec3 shOff,shBack,shRim;','board common');
  sh.fragmentShader=shRep(f,'#include <map_fragment>',`
 vec2 shI=(vMapUv-shEdge)/(1.-2.*shEdge);
 vec2 shG=clamp(shI,0.,1.)*shGrid;
 vec4 shT=texture2D(map,(min(floor(shG),shGrid-1.)+.5)/shGrid);
 vec3 shL=mix(shOff,shT.rgb*shGain,shT.a);
 float shD=length(fract(shG)-.5),shA=max(fwidth(shG.x),1e-4);
 float shM=1.-smoothstep(shDot-shA*.7,shDot+shA*.7,shD);
 float shF=clamp(shA*2.-.6,0.,1.);
 diffuseColor.rgb=mix(mix(shBack,shL,shM),mix(shBack,shL,3.1416*shDot*shDot),shF);
 vec2 shO=min(shI,1.-shI);
 if(min(shO.x,shO.y)<0.)diffuseColor.rgb=shRim*(.75+.5*vMapUv.y);`,'board map_fragment');   // shF: dots under a pixel or two blend to their average instead of shimmering; outside the dots, the bezel (lit from above)
 };
 m.customProgramCacheKey=()=>'showBoard';
}
function shBoardsBuild(){
 const B=SHC.board;
 if(!B||!B.on||typeof scene==='undefined'||!scene||typeof document==='undefined')return null;
 const U={shGrid:{value:new THREE.Vector2(B.cols,B.rows)},shEdge:{value:new THREE.Vector2(B.rim/B.w,B.rim/B.h)},shDot:{value:B.dot},shGain:{value:B.gain},
  shOff:{value:new THREE.Color(B.off)},shBack:{value:new THREE.Color(B.back)},shRim:{value:new THREE.Color(B.rimCol)}};
 const geo=new THREE.PlaneGeometry(B.w,B.h),g=new THREE.Group(),out=[];
 g.name='Show boards';
 for(let i=0;i<B.at.length;i++){
  const cv=document.createElement('canvas');cv.width=B.cols;cv.height=B.rows;
  const tex=new THREE.CanvasTexture(cv);
  tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=tex.minFilter=THREE.NearestFilter;tex.generateMipmaps=false;
  const m=new THREE.MeshBasicMaterial({map:tex,fog:false});
  shBoardPatch(m,U);
  const me=new THREE.Mesh(geo,m);me.name='Show board '+i;
  g.add(me);out.push({cv,cx:cv.getContext('2d'),tex,me,key:null,txt:null,t0:0});
 }
 scene.add(g);
 if(typeof warmPush==='function')warmPush(g);
 return out;
}
function shBoardsPlace(){
 const B=SHC.board,at=(B.tables&&B.tables[cfg.table])||B.at;
 SH.bd.forEach((d,i)=>{const p=at[i];d.me.visible=!!p;if(p)d.me.position.set(p[0],p[1],p[2]);});
 SH.bt=cfg.table;
}
function shClock(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
// what each board shows now: [segments, scroll] per board, left then right
function shPages(){
 const B=SHC.board,A=shCss(B.amber),tc=t=>shLedCol(teamCol(t)),W=SH.walk;
 const one=(s,c,mq)=>[[[shClean(s),c]],!!mq];
 if(S.phase==='menu'||S.trn||S.trial||S.tut)return [one('FUZE',A),one('BALL',A)];
 if(W)return [one(teamName(0),tc(0)),one(teamName(1),tc(1))];
 const g=SH.goal;
 if(g&&SH.t-g.t<B.goalT){const m=one('GOAL! '+teamName(g.team)+' ',tc(g.team),true);return [m,m];}
 if(SH.shot&&SH.t-SH.shot.t<B.speedT)return [one(SH.shot.kmh,A),one('KM/H',A)];
 const sc=[[[String(S.score[0]),tc(0)],['-',A],[String(S.score[1]),tc(1)]],false];
 if(S.phase==='win')return [sc,one('FT',A)];
 const lim=typeof gameTimeLimit==='function'?gameTimeLimit():0;
 if(S.suddenDeath)return [sc,one('GOLDEN GOAL ',A,true)];
 return [sc,one(shClock(lim>0?lim-S.matchTime:S.matchTime),A)];
}
function shBoardsTick(){
 const B=SHC.board;if(!B||!B.on)return;
 if(!SH.bd){SH.bd=shBoardsBuild();if(!SH.bd)return;}
 if(SH.bt!==cfg.table)shBoardsPlace();
 const P=shPages(),cols=B.cols,y=(B.rows-7)>>1;
 for(let i=0;i<SH.bd.length;i++){
  const d=SH.bd[i],p=P[i]||P[0],w=shTW(p[0]),run=p[1]||w>cols;
  let txt='';for(const g of p[0])txt+=g[0]+g[1];
  if(txt!==d.txt){d.txt=txt;d.t0=SH.t;}
  const P2=w+cols+2,x=run?cols-(Math.floor((SH.t-d.t0)*B.scroll)+cols-1)%P2:(cols-w)>>1;   // a scroll starts one dot in from the left, so its first word is up at once
  const key=x+'|'+txt;
  if(key===d.key)continue;
  d.key=key;d.cx.clearRect(0,0,cols,B.rows);shText(d.cx,p[0],x,y);
  d.tex.needsUpdate=true;
  if(typeof renderDirty==='function')renderDirty();
 }
}

// --- pitch line glow: one patch on every pitch material, a mask of its painted lines in a uniform (a pitch change swaps a texture, never a program) ---
function shLineMode(id){const P=CONFIG.pitches[id],L=P&&P.lines;return SHC.lines&&SHC.lines.on?((L&&L.mode)||SHC.lines.mode):'off';}
function shLineU(){
 const L=SH.ln;if(L.U)return L.U;
 L.black=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);L.black.needsUpdate=true;
 L.U={shLine:{value:L.black},shIdle:{value:0},shFlood:{value:new THREE.Vector4(0,-99,1,1)},shFloodC:{value:new THREE.Color(0,0,0)},
  shPulse:{value:new THREE.Vector4(-99,1,0,0)},shPulseC:{value:new THREE.Color(0,0,0)}};
 return L.U;
}
// models.js ensurePitch, for each pitch mesh's material once
function showPitchPatch(m){
 if(!m||!S.show||!SHC.lines||!SHC.lines.on||m.userData.shLines)return;
 m.userData.shLines=true;
 const U=shLineU();
 m.onBeforeCompile=sh=>{
  for(const k in U)sh.uniforms[k]=U[k];
  const v=shRep(sh.vertexShader,'#include <common>','#include <common>\nvarying vec3 shWp;varying vec2 shUv;','lines common');
  sh.vertexShader=shRep(v,'#include <begin_vertex>','#include <begin_vertex>\nshWp=(modelMatrix*vec4(transformed,1.)).xyz;shUv=uv;','lines begin_vertex');
  const f=shRep(sh.fragmentShader,'#include <common>','#include <common>\nuniform sampler2D shLine;uniform vec4 shFlood,shPulse;uniform vec3 shFloodC,shPulseC;uniform float shIdle;varying vec3 shWp;varying vec2 shUv;','lines common');
  sh.fragmentShader=shRep(f,'#include <emissivemap_fragment>',`#include <emissivemap_fragment>
 float shL=texture2D(shLine,shUv).r;
 if(shL>0.004){
  float shS=abs(shWp.x-shFlood.x),shK=clamp((shFlood.y-shS)/shFlood.z,0.,1.)*exp(-max(shFlood.y-shS-shFlood.z,0.)/shFlood.w);
  float shR=length(shWp.xz)-shPulse.x;
  totalEmissiveRadiance+=shL*(diffuseColor.rgb*shIdle+shFloodC*shK+shPulseC*exp(-shR*shR/(shPulse.y*shPulse.y)));
 }`,'lines emissive');
 };
 m.customProgramCacheKey=()=>'shLines';
 m.needsUpdate=true;
}
function shLinesTick(){
 const LC=SHC.lines;if(!LC||!LC.on)return;
 const L=SH.ln,id=cfg.pitch,U=shLineU(),md=shLineMode(id);
 if(L.pid!==id){
  L.pid=id;U.shLine.value=L.black;
  if(L.tex){L.tex.dispose();L.tex=null;}
  if(md!=='off')new THREE.TextureLoader().load(LC.dir+id+'.png',t=>{
   if(L.pid!==id){t.dispose();return;}   // switched again while it loaded
   t.flipY=false;t.colorSpace=THREE.NoColorSpace;t.needsUpdate=true;L.tex=t;U.shLine.value=t;
   if(typeof renderer!=='undefined'&&renderer&&renderer.initTexture)renderer.initTexture(t);
   if(typeof renderDirty==='function')renderDirty();
  },undefined,()=>console.warn('pitch lines: no mask for '+id+' ('+LC.dir+id+'.png)'));
 }
 U.shIdle.value=md==='glow'?LC.glow:0;
 const FL=LC.flood,PL=LC.pulse,g=SH.goal,ga=g?SH.t-g.t:99,ka=SH.t-SH.kick;
 if(md!=='off'&&ga<FL.T){const e=1-ga/FL.T;
  U.shFlood.value.set((g.team===0?1:-1)*F.L/2,ga*FL.speed,FL.width,FL.tail);
  U.shFloodC.value.copy(kitLin(teamCol(g.team))).multiplyScalar(FL.gain*e*e);
 }else U.shFloodC.value.setRGB(0,0,0);
 if(md!=='off'&&ka<PL.T){U.shPulse.value.set(10+ka*PL.speed,PL.width,0,0);U.shPulseC.value.set(PL.col).multiplyScalar(PL.gain*(1-ka/PL.T));}
 else U.shPulseC.value.setRGB(0,0,0);
}

// --- the walkout: the opening count runs long while the camera walks both teams out; any button skips; input is frozen while it plays (S.show.walk) ---
function walkLen(){
 const C=SHC.walk;
 if(!SHC.on||!C||!C.on||S.trn||S.trial||S.tut||S.photo)return 0;
 const k=cfg.walkout||'full';
 return k==='off'?0:(C.T[k]||0);
}
// where the play camera will sit when the count ends (fx.js cameraUpdate with no ball yet); the cinematic camera takes over from its own row
function walkEndPose(){
 const m=CAM.modes[S.camMode]||CAM.modes[0];
 const mir=(typeof camTeamSide==='function'&&camTeamSide()===1&&CAM.sideModes.indexOf(S.camMode)>=0)?-1:1;
 const rr=typeof camRod==='function'?camRod(S.camMode):null,rd=rr?(rr.team?-1:1):0;
 return [rr?rr.x+m[0]*rd:m[0]*mir,m[1],m[2],rr?rr.x+m[3]*rd:m[3]*mir,m[4],m[5]];
}
// path time: a soft start and a landing with no speed left, slope 1 in between
function walkU(x){
 x=clamp(x,0,1);
 if(x<.1){const s=x/.1;return .1*s*s*(2-s);}
 if(x>.8){const s=(x-.8)/.2;return .8+.2*(s+s*s-s*s*s);}
 return x;
}
// Catmull-Rom through the keys, by path u
function walkAt(u,o){
 const K=SHW.keys;let i=0;while(i<K.length-2&&u>K[i+1][0])i++;
 const a=K[Math.max(0,i-1)],b=K[i],c=K[i+1],d=K[Math.min(K.length-1,i+2)],s=clamp((u-b[0])/Math.max(1e-6,c[0]-b[0]),0,1),s2=s*s,s3=s2*s;
 for(let k=1;k<7;k++)o[k-1]=.5*(2*b[k]+(c[k]-a[k])*s+(2*a[k]-5*b[k]+4*c[k]-d[k])*s2+(3*b[k]-a[k]-3*c[k]+d[k])*s3);
 return o;
}
// each team's rods turn over as the camera's x passes them on that team's pass
function walkSpins(){
 const C=SHC.walk,W=SHW,ps=C.pass[W.k],m=new Map(),o=[0,0,0,0,0,0],N=400;
 for(const r of rods){
  const P=ps[r.team];if(!P)continue;
  let dl=null,prev=null;
  for(let j=0;j<=N;j++){const x=j/N,u=walkU(x);if(u<P[0]||u>P[1])continue;
   const d=walkAt(u,o)[0]-r.x;if(prev!=null&&d*prev<=0){dl=x*W.T;break;}prev=d;}
  if(dl==null){let x=1;for(let j=N;j>=0;j--)if(walkU(j/N)<=P[1]){x=j/N;break;}dl=x*W.T;}
  m.set(r,{n:C.spin.turns*r.kickDir,dl});
 }
 return m;
}
// flow.js startMatchNow: returns the extra count (s), 0 = no walkout; kb puts up the kickoff banner, held until the walkout ends
function walkStart(kb){
 const T=walkLen();if(!(T>0))return 0;
 const W=SHW,C=SHC.walk;
 W.on=true;W.t=0;W.T=T;W.k=cfg.walkout==='short'?'short':'full';W.kb=kb;
 W.end=walkEndPose();W.keys=C.path[W.k].concat([[1].concat(W.end)]);
 const k0=W.keys[0];for(let i=0;i<3;i++){W.p[i*2]=k0[1+i];W.l[i*2]=k0[4+i];W.p[i*2+1]=W.l[i*2+1]=0;}
 const tb=CONFIG.tables[cfg.table],sk=tb&&tb.skins&&typeof curSkin==='function'?tb.skins[curSkin(cfg.table)]:null,rm=CONFIG.rooms[cfg.room];
 W.cap={room:String(rm?rm.name:'').toUpperCase(),table:((tb?tb.name:'')+(sk&&sk.name&&sk.name!==tb.name?' · '+sk.name:'')).toUpperCase(),
  sub:(S.lg?(S.lg.cup?S.lg.banner:'LEAGUE · ROUND '+(LG.round+1)):(S.userTeam<0?'AI SHOWDOWN':'KICK OFF')).toUpperCase()};
 W.side=[0,1].map(t=>{const n=S.seats.filter(s=>s.team===t).length;return n?(n>1?n+' PLAYERS':'PLAYER'):String(teamDiff(t)||'').toUpperCase()+' AI';});
 if(typeof feelSpin==='function')feelSpin(walkSpins(),C.spin.T,'count');
 if(typeof HUD!=='undefined')HUD.chromeA=0;   // the scoreboard comes in when the walkout ends
 if(typeof cineOff==='function')cineOff();
 if(Au.ctx){if(!Au.play('sting_anthem'))Au.sting('anthem');Au.react('applause',.5);}
 return T;
}
// done: the walkout ran out or was skipped (the camera lands on the play pose, the normal count and its banner follow); else the count ended under it
function walkStop(done){
 const W=SHW;if(!W.on)return;
 W.on=false;
 if(!done){if(typeof feelSpin==='function')feelSpin(null);return;}
 if(W.t<W.T&&typeof feelSpin==='function')feelSpin(null);
 if(S.phase==='count')S.countT=Math.min(S.countT,MATCH.countIn);
 const E=W.end;
 camera.position.set(E[0],E[1],E[2]);camera.lookAt(E[3],E[4],E[5]);S.camLookX=E[3];
 if(CAM.cine&&S.camMode===CAM.cine.mode&&typeof cineFrom==='function')cineFrom(E);
 if(W.kb)W.kb();
 if(Au.ctx)Au.react('cheer');
}
function walkSkip(){if(SH.walk)walkStop(true);}
// input.js gamepadUpdate: a pad's fresh presses while the walkout plays (any of them skips it)
function walkPad(just){for(const k in just)if(just[k]){walkSkip();return;}}
function walkTick(rdt){
 const W=SHW;if(!W.on)return;
 if(S.phase!=='count'&&!(S.phase==='pause'&&S.prePause==='count')){walkStop(false);return;}   // a soak serving straight away, a quit
 if(S.phase==='pause'||S.photo)return;
 W.t+=rdt;
 if(W.t>=W.T)walkStop(true);
}
// fx.js cameraUpdate: true while the walkout has the camera
const _wkO=[0,0,0,0,0,0];
function walkCam(rdt){
 const W=SHW;
 if(!W.on||(S.phase!=='count'&&!(S.phase==='pause'&&S.prePause==='count')))return false;
 if(S.phase==='pause'||!(rdt>0))return true;
 const C=SHC.walk,x=clamp(W.t/W.T,0,1),P=walkAt(walkU(x),_wkO),spr=typeof cineSpr==='function';
 for(let k=0;k<3;k++){
  if(spr){cineSpr(W.p,k*2,P[k],C.posW,rdt);cineSpr(W.l,k*2,P[3+k],C.lookW,rdt);}
  else{W.p[k*2]=P[k];W.l[k*2]=P[3+k];}
 }
 const b=clamp((x-.85)/.15,0,1),e=b*b*(3-2*b),q=k=>lerp(W.p[k*2],P[k],e),r=k=>lerp(W.l[k*2],P[3+k],e);   // the springs hand over to the path itself as it lands
 camera.position.set(q(0),q(1),q(2));camera.lookAt(r(0),r(1),r(2));S.camLookX=r(0);
 return true;
}

// --- the walkout on the HUD (hud.js hudRender): venue line, a name card per team as the camera passes it, the skip prompt ---
function walkPlate(x,y,w,h,c){const X=HUD.x;X.beginPath();X.moveTo(x+c,y);X.lineTo(x+w,y);X.lineTo(x+w,y+h-c);X.lineTo(x+w-c,y+h);X.lineTo(x,y+h);X.lineTo(x,y+c);X.closePath();}
// 0..1 in, 1 held, 1..0 out across a window [a,b] of the walkout
function walkIn(a,b){const W=SHW,s=W.t/W.T;if(s<a||s>b)return 0;return Math.min(1,(s-a)*W.T/.35,(b-s)*W.T/.25);}
function walkCard(t,a){
 const W=SHW,X=HUD.x,u=HUD.u,e=hO3(a),fs=34*u,fS=13*u,pad=18*u,bar=8*u,h=fs*1.9+fS;
 X.font=hudF(fs);const nm=hudName(t,hudF(fs),fs*.04,HUD.W*.36),nw=nm.w;X.font=hudF(fS);const sw=hudW(W.side[t],fS*.18);
 const w=Math.max(nw,sw)+pad*2+bar,y=HUD.H*.7,c=10*u,L=t===0,x=L?40*u-(1-e)*60*u:HUD.W-40*u-w+(1-e)*60*u,col=hudTeam(t);
 X.save();X.globalAlpha=Math.min(1,a*1.4);
 X.fillStyle='rgba(0,0,0,.35)';walkPlate(x+3*u,y+4*u,w,h,c);X.fill();
 X.fillStyle='rgba(7,17,28,.93)';walkPlate(x,y,w,h,c);X.fill();
 X.fillStyle=col.c;X.fillRect(L?x:x+w-bar,L?y+c:y,bar,h-c);
 const tx=L?x+bar+pad:x+w-bar-pad;
 X.fillStyle='#edf0f1';X.font=hudF(fs);hudT(nm.s,tx,y+pad*.55+fs*.55,L?-1:1,fs*.04);
 X.fillStyle='#6baabc';X.font=hudF(fS);hudT(W.side[t],tx,y+h-pad*.55-fS*.5,L?-1:1,fS*.18);
 X.restore();
}
function walkHud(){
 const W=SH.walk;if(!W||!HUD.x)return;
 const X=HUD.x,u=HUD.u,C=SHC.walk.cards,k=W.k;
 const av=walkIn(C.venue[0],k==='short'?C.short[0][1]:C.venue[1]);
 if(av>0){
  const fs=22*u,fS=12*u,pad=14*u,c=9*u,x=40*u,y=36*u;
  X.font=hudF(fs);const rw=hudW(W.cap.room,fs*.06);X.font=hudF(fS);const tw=Math.max(hudW(W.cap.table,fS*.2),hudW(W.cap.sub,fS*.2));
  const w=Math.max(rw,tw)+pad*2,h=fs+fS*2.6+pad*1.6;
  X.save();X.globalAlpha=av;
  X.fillStyle='rgba(7,17,28,.9)';walkPlate(x-(1-hO3(av))*40*u,y,w,h,c);X.fill();
  X.fillStyle='#edf0f1';X.font=hudF(fs);hudT(W.cap.room,x+pad,y+pad+fs*.45,-1,fs*.06);
  X.fillStyle='#6baabc';X.font=hudF(fS);hudT(W.cap.table,x+pad,y+pad+fs+fS*.75,-1,fS*.2);hudT(W.cap.sub,x+pad,y+pad+fs+fS*2,-1,fS*.2);
  X.restore();
 }
 for(let t=0;t<2;t++){const a=walkIn(C[k][t][0],C[k][t][1]);if(a>0)walkCard(t,a);}
 const sa=clamp((W.t-.6)/.4,0,1)*clamp((W.T-W.t)/.3,0,1);
 if(sa>0){X.save();X.globalAlpha=sa*.75;X.fillStyle='#bcdced';X.font=hudF(12*u);hudT('PRESS ANY BUTTON TO SKIP',HUD.W/2,HUD.H-30*u,0,12*u*.22);X.restore();}
}

// --- per frame (fx.js fxUpdate) ---
function showTick(rdt){
 showSee(rdt);
 walkTick(rdt);
 shBoardsTick();
 shLinesTick();
}
