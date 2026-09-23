'use strict';
/* ================= HUD =================
   The in-match chrome is ONE Canvas2D layer (<canvas id="hud">) drawn over the WebGL scene once per
   frame by hudRender(), which main.js calls after renderer.render. It replaced a stack of DOM nodes
   (#sb, #matchTime, the fx rails, #chips, #notice, #banner, #toast, #count, #hint, #replayUI and the
   dev readouts), and those nodes are GONE — not hidden — so nothing can write to a copy nobody sees.

   THE CANVAS NEVER TAKES POINTER EVENTS. input.js, photo.js and roomedit.js all listen on the GAME
   canvas underneath, so a full-screen layer with pointer-events on sits between the player and every
   mouse control in the game (the first cut of this did exactly that: no mouse slide, no click-kick,
   no photo drag). The rod chips are hit-tested from a window CAPTURE listener instead, which only
   swallows a click that actually lands on a chip, and only when the click was aimed at the table.

   POLLED, NOT PUSHED. Score, clock, sudden death, power-up expiry, trial/training state and the seat
   list are read off S every frame. The only writes into here are EVENTS — banner / notice / toast, a
   count value, a hint, replay on/off, a score change to animate, dev readouts. A mirrored copy of
   state is a second copy that can disagree, and the first cut had four of them (one of which was
   the team colours, hardcoded, so no custom kit or league side ever reached the scoreboard).

   The rules that kept the DOM HUD from looking generated, still in force (CLAUDE.md 2026-07-25):
   angled slabs, not rounded glass; hard offset shadows and NEVER shadowBlur (it is also the one
   canvas op that costs real CPU per draw); motion on enter / exit / change only — no idle sine
   pulses; colour belongs to whoever the thing concerns. The face is --font-ui (SoccerLeague, a
   varsity slab that ships ONE weight): no weight in any ctx.font here, or the browser smears a
   synthetic bold exactly as it did in CSS. Numbers are set in FIXED CELLS — the face is
   proportional, and a clock whose 1s are narrower than its 0s shuffles sideways every second.

   Draw order, back to front: board (score + beads + clock) · power-up tabs · rod chips · controls
   hint · dev readouts · replay letterbox · notice · banner · countdown · toasts. */
const HUD={
 c:null,x:null,g:null,dpr:0,W:0,H:0,u:1,ls:false,fam:'sans-serif',famI:'sans-serif',
 mono:'ui-monospace,Consolas,"Cascadia Mono",monospace',
 t:0,on:false,onT:-9,chromeA:0,dirty:true,lowFx:false,bd:null,
 sc:[0,0],scFrom:[0,0],scT:[-9,-9],clk:-1,clkT:-9,nmc:[{},{}],cell:{},
 ntc:null,bnr:null,tst:[],cnt:null,cntOut:null,
 tabs:null,ord:null,
 chips:[],chipSig:NaN,chipU:0,chipY:0,chipK:0,hov:-1,hl:new Map(),cur:false,hp:null,
 hint:null,hintT:-9,
 rep:{on:false,t:-99,team:0,save:'off',tok:null},
 dev:Object.create(null)
};
/* The icons are the old FX_ICO marks verbatim — same 24-unit viewBox — just parsed by Path2D. */
const HUD_FX=[
 {k:'boost', pu:'boost', lab:'POWER HITS',fill:true, d:'M13.4 2 5 13.6h5.1L9.2 22l8.6-11.9h-5.3L13.4 2z'},
 {k:'frozen',pu:'freeze',lab:'FROZEN',    fill:false,d:'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9'},
 {k:'big',   pu:'big',   lab:'BIG GOAL',  fill:false,d:'M3 7h18v11H3zM3 11.7h18M3 15h18M8.2 7v11M15.8 7v11'}
];
const HUD_DEVK=['fps','cam','spd','vel','dead'];     // dev readout stacking order, top down
const CHIP_FULL_MAX=2;   // past this many seats each player collapses to ONE chip (4-a-side would be 40)
const INK='#0a0d16';
const hC=v=>v<0?0:v>1?1:v, hO3=t=>1-(1-t)*(1-t)*(1-t), hBk=t=>{const q=t-1;return 1+2.2*q*q*q+1.2*q*q;};

/* ===== setup ===== */
function hudInit(){
 const c=$('hud');if(!c||!c.getContext)return false;
 HUD.c=c;HUD.x=c.getContext('2d');HUD.ls='letterSpacing' in HUD.x;
 const cs=getComputedStyle(document.documentElement);
 HUD.fam=cs.getPropertyValue('--font-ui').trim()||'sans-serif';
 HUD.famI=cs.getPropertyValue('--font-italic').trim()||HUD.fam;
 // Canvas text never triggers a webfont load on its own. Without this the italic sub chips draw in a
 // fallback serif until something in the DOM happens to use the italic face.
 if(document.fonts&&document.fonts.load){
  const f=HUD.fam.split(',')[0],fi=HUD.famI.split(',')[0];
  Promise.all([document.fonts.load('20px '+f),document.fonts.load('italic 20px '+fi)])
   .then(()=>{HUD.cell={};HUD.nmc=[{},{}];HUD.chipSig=NaN;HUD.dirty=true;},()=>{});
 }
 for(const f of HUD_FX)f.p=new Path2D(f.d);
 HUD.tabs=[0,1].map(()=>HUD_FX.map(f=>({f,live:false,born:-9,die:-9,end:0,dur:1,y:-1,bump:-9})));
 HUD.ord=[HUD.tabs[0].slice(),HUD.tabs[1].slice()];
 return true;
}
// Checked every frame rather than on 'resize' — a window dragged to a monitor with another pixel
// ratio fires no resize, and three comparisons a frame is nothing.
function hudFit(){
 const d=Math.min(devicePixelRatio||1,2),W=innerWidth,H=innerHeight;
 if(d===HUD.dpr&&W===HUD.W&&H===HUD.H)return;
 HUD.dpr=d;HUD.W=W;HUD.H=H;HUD.c.width=Math.round(W*d);HUD.c.height=Math.round(H*d);
 HUD.u=clamp(Math.min(H/900,W/1440),.72,1.6)*(CONFIG.hud.scale||1);
 HUD.nmc=[{},{}];HUD.chipSig=NaN;HUD.dirty=true;
}

/* ===== colour ===== */
// Callers pass anything: '#hex', a 0xRRGGBB number (ball trails, charge bands), 'var(--gold)',
// rgb(). A throwaway 2D context normalises it; the var() read is why the cache is dropped at
// every kickoff — league.js repaints --c0/--c1 per match.
const hudColC=new Map(),hudRGBC=new Map();let hudColX=null;
function hudCol(c){
 if(c==null||c==='')return'#ffffff';
 let o=hudColC.get(c);if(o)return o;
 let s=typeof c==='number'?'#'+(c>>>0).toString(16).padStart(6,'0').slice(-6):String(c).trim();
 const m=/^var\((--[\w-]+)\)$/.exec(s);
 if(m)s=getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()||'#ffffff';
 if(!hudColX)hudColX=document.createElement('canvas').getContext('2d');
 hudColX.fillStyle='#fff';hudColX.fillStyle=s;o=hudColX.fillStyle;
 hudColC.set(c,o);return o;
}
function hudRGB(c){
 const s=hudCol(c);let o=hudRGBC.get(s);if(o)return o;
 if(s[0]==='#')o=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
 else{const n=s.match(/[\d.]+/g)||[255,255,255];o=[+n[0],+n[1],+n[2]];}
 hudRGBC.set(s,o);return o;
}
const hudA=(c,a)=>{const r=hudRGB(c);return'rgba('+r[0]+','+r[1]+','+r[2]+','+a+')';};
function hudMix(c,k){   // k>0 toward white, k<0 toward black
 const r=hudRGB(c),f=k>0?v=>v+(255-v)*k:v=>v*(1+k);
 return'rgb('+(f(r[0])|0)+','+(f(r[1])|0)+','+(f(r[2])|0)+')';
}
// ink on a colour fill. The threshold is the caller's: a name slab wants white on anything short of
// pale, a sub chip wants the dark ink the DOM banner always used unless the fill is itself dark.
function hudInk(c,th){const r=hudRGB(c);return(.2126*r[0]+.7152*r[1]+.0722*r[2])/255>th?INK:'#ffffff';}
const hudTC=[{k:null},{k:null}];
function hudTeam(t){
 const k=teamCol(t),o=hudTC[t];
 if(o.k!==k){o.k=k;o.c=hudCol(k);o.hi=hudMix(k,.2);o.lo=hudMix(k,-.3);o.ink=hudInk(k,.62);}
 return o;
}

/* ===== type ===== */
const hudF=(px,it)=>(it?'italic ':'')+(Math.round(px*2)/2)+'px '+(it?HUD.famI:HUD.fam);
function hudTrack(tr){if(HUD.ls)HUD.x.letterSpacing=(tr||0)+'px';}
// letterSpacing is appended after EVERY glyph, the last one included, so a measured width is one
// tracking too wide and centred text sits half a tracking left of true. Both are paid back here.
function hudW(s,tr){hudTrack(tr);return HUD.x.measureText(s).width-(HUD.ls&&tr?tr:0);}
function hudT(s,x,y,al,tr,stroke){   // al: -1 left · 0 centre · 1 right
 const X=HUD.x;hudTrack(tr);X.textAlign=al<0?'left':al>0?'right':'center';
 const dx=HUD.ls&&tr?(al<0?0:al>0?tr:tr/2):0;
 if(stroke)X.strokeText(s,x+dx,y);else X.fillText(s,x+dx,y);
}
function hudCell(f){   // widest digit at font f — the fixed cell every number is set in
 let w=HUD.cell[f];if(w)return w;
 const X=HUD.x;X.font=f;hudTrack(0);w=0;for(let i=0;i<10;i++)w=Math.max(w,X.measureText(String(i)).width);
 return HUD.cell[f]=w;
}
// a digit string in fixed cells; ':' takes half a cell. Returns the set width.
function hudMono(s,cx,cy,cell,stroke){
 const X=HUD.x;let w=0;for(let i=0;i<s.length;i++)w+=s[i]===':'?cell*.5:cell;
 let x=cx-w/2;X.textAlign='center';hudTrack(0);
 for(let i=0;i<s.length;i++){const cw=s[i]===':'?cell*.5:cell;
  if(stroke)X.strokeText(s[i],x+cw/2,cy);else X.fillText(s[i],x+cw/2,cy);x+=cw;}
 return w;
}
function hudName(t,f,tr,max){
 const raw=String(teamName(t)||(t?'BLUE':'RED')).toUpperCase(),c=HUD.nmc[t];
 if(c.raw===raw&&c.f===f)return c;
 HUD.x.font=f;let s=raw;
 if(hudW(s,tr)>max){while(s.length>2&&hudW(s+'…',tr)>max)s=s.slice(0,-1);s=s.trimEnd()+'…';}
 c.raw=raw;c.f=f;c.s=s;c.w=hudW(s,tr);return c;
}

/* ===== shapes ===== */
function hudPar(x,y,w,h,k){   // parallelogram, top edge pushed +k: leans like italic
 const X=HUD.x;X.beginPath();X.moveTo(x+k,y);X.lineTo(x+w+k,y);X.lineTo(x+w,y+h);X.lineTo(x,y+h);X.closePath();
}
function hudTrap(xl,y,xr,h,tn){   // wide at the top, both ends cut inward at slope tn
 const X=HUD.x,k=h*tn;X.beginPath();X.moveTo(xl,y);X.lineTo(xr,y);X.lineTo(xr-k,y+h);X.lineTo(xl+k,y+h);X.closePath();
}
function hudDot(x,y,r){const X=HUD.x;X.beginPath();X.arc(x,y,r,0,Math.PI*2);X.fill();}
// dark varsity lettering: hard drop, keyline, then a cool top-lit face. Shared by banner and count.
function hudHeavy(s,x,y,fs,tr){
 const X=HUD.x;X.lineWidth=fs*.1;
 X.fillStyle=X.strokeStyle='rgba(0,0,0,.45)';hudT(s,x,y+fs*.07,0,tr,1);hudT(s,x,y+fs*.07,0,tr);
 X.strokeStyle='#05070c';hudT(s,x,y,0,tr,1);
 const g=X.createLinearGradient(0,y-fs*.42,0,y+fs*.42);
 g.addColorStop(0,'#ffffff');g.addColorStop(.52,'#f1f4fa');g.addColorStop(1,'#aebbd4');
 X.fillStyle=g;hudT(s,x,y,0,tr);
}
function hudHatch(){
 if(HUD.hp)return HUD.hp;
 const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');
 g.strokeStyle='rgba(255,255,255,.1)';g.lineWidth=1.6;g.beginPath();
 g.moveTo(-2,10);g.lineTo(10,-2);g.moveTo(-2,2);g.lineTo(2,-2);g.moveTo(6,10);g.lineTo(10,6);g.stroke();
 return HUD.hp=HUD.x.createPattern(c,'repeat');
}

/* ===== markup: keycaps =====
   Hints are written as markup, not prose: [Q] is a keycap, [←] [→] [↑] [↓] are arrow caps (the face
   has no arrow glyphs — a fallback font drew them), [LMB] [RMB] [MOUSE] are a drawn mouse, · splits
   groups, \n breaks lines. The caps are the Options reference card's .ctl b keycap, so a key looks
   the same on the HUD as it does where you look it up. */
function hudTok(src){
 return String(src).split('\n').map(l=>l.split(/(\[[^\]]+\]|·)/).map(s=>s.trim()).filter(Boolean)
  .map(s=>s==='·'?{sep:1}:s[0]==='['?{cap:s.slice(1,-1).toUpperCase()}:{t:s.toUpperCase()}));
}
const HUD_GLYPH={'←':1,'→':1,'↑':1,'↓':1,LMB:2,RMB:2,MOUSE:2};
function hudCapW(cap,u){HUD.x.font=hudF(Math.max(9,10*u));return HUD_GLYPH[cap]?16*u:Math.max(16*u,hudW(cap,.6*u)+10*u);}
function hudCap(cap,x,cy,u){
 const X=HUD.x,w=hudCapW(cap,u),h=16*u,y=cy-h/2,g=HUD_GLYPH[cap];
 X.fillStyle='rgba(0,0,0,.55)';X.beginPath();X.roundRect(x,y+2*u,w,h,3*u);X.fill();
 X.fillStyle='#182238';X.beginPath();X.roundRect(x,y,w,h,3*u);X.fill();
 X.strokeStyle='rgba(255,255,255,.13)';X.lineWidth=1;X.stroke();
 X.fillStyle=X.strokeStyle='#c6d2ea';
 if(g===1){const cx=x+w/2,a=3.6*u;X.beginPath();
  if(cap==='←'){X.moveTo(cx-a,cy);X.lineTo(cx+a*.7,cy-a);X.lineTo(cx+a*.7,cy+a);}
  else if(cap==='→'){X.moveTo(cx+a,cy);X.lineTo(cx-a*.7,cy-a);X.lineTo(cx-a*.7,cy+a);}
  else if(cap==='↑'){X.moveTo(cx,cy-a);X.lineTo(cx-a,cy+a*.7);X.lineTo(cx+a,cy+a*.7);}
  else{X.moveTo(cx,cy+a);X.lineTo(cx-a,cy-a*.7);X.lineTo(cx+a,cy-a*.7);}
  X.closePath();X.fill();}
 else if(g===2){const mw=7.5*u,mh=11*u,mx=x+(w-mw)/2,my=cy-mh/2;X.lineWidth=Math.max(1,1.1*u);
  if(cap!=='MOUSE'){X.fillStyle='#ffcf4d';X.beginPath();
   if(cap==='LMB')X.roundRect(mx,my,mw/2,mh*.45,[mw/2,0,0,0]);else X.roundRect(mx+mw/2,my,mw/2,mh*.45,[0,mw/2,0,0]);X.fill();}
  X.beginPath();X.roundRect(mx,my,mw,mh,mw/2);X.stroke();
  X.beginPath();X.moveTo(mx+mw/2,my);X.lineTo(mx+mw/2,my+mh*.45);X.moveTo(mx,my+mh*.45);X.lineTo(mx+mw,my+mh*.45);X.stroke();}
 else{X.font=hudF(Math.max(9,10*u));hudT(cap,x+w/2,cy+.5*u,0,.6*u);}
 return w;
}
// one tokenised line: width, then draw. `col` tints the words; caps keep their own face.
function hudLineW(line,u){
 let w=0,prev=null;for(const k of line){
  w+=prev?(k.sep||prev.sep?10*u:k.cap&&prev.cap?3*u:6*u):0;
  if(k.sep)w+=3*u;else if(k.cap)w+=hudCapW(k.cap,u);else{HUD.x.font=hudF(Math.max(10.5,11.5*u));w+=hudW(k.t,.8*u);}
  prev=k;}
 return w;
}
function hudLine(line,x,cy,u,col){
 const X=HUD.x;let prev=null;
 for(const k of line){
  x+=prev?(k.sep||prev.sep?10*u:k.cap&&prev.cap?3*u:6*u):0;
  if(k.sep){X.fillStyle='#3d4a66';hudDot(x+1.5*u,cy,1.5*u);x+=3*u;}
  else if(k.cap)x+=hudCap(k.cap,x,cy,u);
  else{X.font=hudF(Math.max(10.5,11.5*u));X.fillStyle=col;hudT(k.t,x,cy+.5*u,-1,.8*u);x+=hudW(k.t,.8*u);}
  prev=k;}
}

/* ===== the board =====
   One trapezoid: team slabs top-left and top-right, the two score windows in the middle, and under
   each slab the BEAD RAIL — a real table keeps score by sliding beads along a wire, and a race to N
   is exactly what a row of N beads shows at a glance. The ends are cut at 20°, and the power-up tabs
   below lean off those same cuts, so the whole top of the screen reads as one piece. */
function hudBoard(a){
 const X=HUD.x,u=HUD.u,T=HUD.t,cx=HUD.W/2,tn=.364;                        // tan 20°
 const y0=12*u-(1-hO3(hC((T-HUD.onT)/.55)))*120*u;                      // drops in at kickoff
 const hN=40*u,hW=52*u,ww=62*u,gp=2*u,sm=3*u,kl=2*u,L=[hudTeam(0),hudTeam(1)];
 const fN=hudF(18*u),trN=1.5*u,n0=hudName(0,fN,trN,230*u),n1=hudName(1,fN,trN,230*u);
 const sw=clamp(Math.max(n0.w,n1.w)+34*u+hN*tn,150*u,300*u);
 const xi0=cx-gp-ww-sm,xo0=xi0-sw,xi1=cx+gp+ww+sm,xo1=xi1+sw;
 X.globalAlpha=a;
 X.fillStyle='rgba(0,0,0,.3)';hudTrap(xo0-kl,y0-kl+4*u,xo1+kl,hW+kl*2,tn);X.fill();   // hard drop
 X.fillStyle='#070a11';hudTrap(xo0-kl,y0-kl,xo1+kl,hW+kl*2,tn);X.fill();
 const bot=S.trn?y0+hW:hudClock(cx,y0+hW,2*(ww+gp)+10*u);   // training has no clock: checkMatchClock ignores it
 const wg=X.createLinearGradient(0,y0,0,y0+hW);wg.addColorStop(0,'#1b2334');wg.addColorStop(1,'#0a0e18');
 const ry=y0+hN+(hW-hN)/2;
 for(let t=0;t<2;t++){
  const tc=L[t],s=t?1:-1,xi=t?xi1:xi0,xo=t?xo1:xo0,nm=t?n1:n0;
  X.beginPath();X.moveTo(xo,y0);X.lineTo(xi,y0);X.lineTo(xi,y0+hN);X.lineTo(xo-s*hN*tn,y0+hN);X.closePath();
  const g=X.createLinearGradient(0,y0,0,y0+hN);g.addColorStop(0,tc.hi);g.addColorStop(.5,tc.c);g.addColorStop(1,tc.lo);
  X.fillStyle=g;X.fill();
  X.fillStyle='rgba(255,255,255,.3)';X.fillRect(Math.min(xo,xi),y0,sw,u);          // lip of light on the top edge
  X.font=fN;const mx=(xi+xo-s*hN*tn*.5)/2,my=y0+hN/2+u;
  if(tc.ink!==INK){X.fillStyle='rgba(0,0,0,.3)';hudT(nm.s,mx,my+1.6*u,0,trN);}
  X.fillStyle=tc.ink;hudT(nm.s,mx,my,0,trN);
  const wx=t?cx+gp:cx-gp-ww;
  X.fillStyle=wg;X.fillRect(wx,y0,ww,hW);
  const fl=hC(1-(T-HUD.scT[t])/.8);if(fl>0){X.fillStyle=hudA(tc.c,.75*fl*fl);X.fillRect(wx,y0,ww,hW);}
  X.fillStyle=tc.c;X.fillRect(wx,y0+hW-3*u,ww,3*u);
  hudScore(t,wx,y0,ww,hW-3*u,tc);
  // bead rail: from just off the window out to the board's cut edge at rail height
  const edge=t?xo1+kl-(ry-y0+kl)*tn:xo0-kl+(ry-y0+kl)*tn;
  hudBeads(t,xi+s*6*u,Math.abs(edge-xi)-14*u,ry,s,tc);
 }
 X.globalAlpha=1;
 HUD.bd={y0,hW,tn,kl,xo0,xo1,bot};
}
function hudScore(t,x,y,w,h,tc){
 const X=HUD.x,u=HUD.u,f=hudF(44*u),cell=hudCell(f),k=hC((HUD.t-HUD.scT[t])/.45),mid=y+h/2+2*u;
 X.save();X.beginPath();X.rect(x,y,w,h);X.clip();X.font=f;
 if(k<1){const e=hBk(k);hudNum(HUD.scFrom[t],x+w/2,mid-e*h,cell,tc);hudNum(HUD.sc[t],x+w/2,mid+(1-e)*h,cell,tc);}
 else hudNum(HUD.sc[t],x+w/2,mid,cell,tc);   // the change ROLLS: old digit up and out, new one up from below
 X.restore();
}
function hudNum(n,cx,cy,cell,tc){   // varsity number: hard drop, team-colour twill border, white face
 const X=HUD.x,s=String(n),u=HUD.u;X.lineWidth=5*u;
 X.strokeStyle='rgba(0,0,0,.55)';hudMono(s,cx,cy+3*u,cell,1);
 X.strokeStyle=tc.c;hudMono(s,cx,cy,cell,1);
 X.fillStyle='#ffffff';hudMono(s,cx,cy,cell);
}
function hudBeads(t,xa,len,y,s,tc){
 const H=CONFIG.hud,tg=goalTarget(),u=HUD.u,sp=10.4*u,r=3.4*u,X=HUD.x;
 if(!H.beads||!(tg>=1)||tg>H.beadMax||tg*sp>len)return;
 const xb=xa+s*len,sc=Math.min(HUD.sc[t],tg),fr=Math.min(HUD.scFrom[t],sc),T=HUD.t-HUD.scT[t];
 X.strokeStyle='#34405f';X.lineWidth=1.2*u;X.beginPath();X.moveTo(xa,y);X.lineTo(xb,y);X.stroke();
 for(let i=0;i<tg;i++){
  const home=xb-s*(tg-i-1+.5)*sp,won=xa+s*(i+.5)*sp;   // parked out at the far end · slid home against the score
  let bx=home,lit=i<sc;
  if(i<fr)bx=won;
  else if(lit){const p=hC((T-.12-(i-fr)*.09)/.5);bx=home+(won-home)*hO3(p);}
  if(lit){X.fillStyle=tc.c;hudDot(bx,y,r);X.fillStyle='rgba(255,255,255,.6)';hudDot(bx-r*.35,y-r*.38,r*.33);}
  else{X.fillStyle='#1d2539';hudDot(bx,y,r);X.strokeStyle='rgba(255,255,255,.17)';X.lineWidth=1;X.stroke();}
 }
}
/* The clock hangs off the centre of the board. Level time counts up; a timed match counts DOWN, and
   in the last MATCH.warnT seconds each second lands as a kick — a flash and a knock, once, on the
   tick — rather than the old pulse that throbbed continuously. A timed match also draws the time
   left as a hairline along the tab's foot. Returns the tab's bottom edge. */
function hudClock(cx,y,w){
 const X=HUD.x,u=HUD.u,T=HUD.t,h=22*u,lim=gameTimeLimit();
 if(S.suddenDeath){
  const f=hudF(12*u),tr=2.6*u;X.font=f;w=Math.max(w,hudW('SUDDEN DEATH',tr)+30*u);
  const g=X.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#ffe08a');g.addColorStop(1,'#e8ae1c');
  X.fillStyle='#070a11';hudTrap(cx-w/2-2*u,y-u,cx+w/2+2*u,h+3*u,7/22);X.fill();
  X.fillStyle=g;hudTrap(cx-w/2,y,cx+w/2,h,7/22);X.fill();
  X.fillStyle=INK;hudT('SUDDEN DEATH',cx,y+h/2+u,0,tr);
  return y+h+2*u;
 }
 const v=lim>0?Math.max(0,Math.ceil(lim-S.matchTime)):Math.floor(S.matchTime||0);
 if(v!==HUD.clk){HUD.clk=v;HUD.clkT=T;}
 const warn=lim>0&&v<=MATCH.warnT,k=warn?hC(1-(T-HUD.clkT)/.38):0;
 X.fillStyle=warn?'rgb('+(7+68*k|0)+','+(10+4*k|0)+','+(17+4*k|0)+')':'#070a11';
 hudTrap(cx-w/2-2*u,y-u,cx+w/2+2*u,h+3*u,7/22);X.fill();
 const f=hudF(14*u),str=String(v/60|0).padStart(2,'0')+':'+String(v%60).padStart(2,'0');
 X.save();X.translate(cx,y+h/2+u);const sc=1+.16*k*k;X.scale(sc,sc);X.font=f;
 X.fillStyle=warn?'#ff5b5b':lim>0?'#b8c5de':'#8391b0';hudMono(str,0,0,hudCell(f));X.restore();
 if(lim>0){const fr=hC((lim-S.matchTime)/lim),bw=(w-24*u)*fr;
  X.fillStyle=warn?'#ff5b5b':'rgba(184,197,222,.32)';X.fillRect(cx-bw/2,y+h-1.5*u,bw,1.5*u);}
 return y+h+2*u;
}

/* ===== power-up tabs =====
   Each grows out of the board's cut end on the side of the team it acts on, leaning off that same
   20° cut, and the tab IS the timer: its fill drains back toward the board. Frozen shows on the team
   actually slowed; big-goal on the team whose goal it widens — the side is S.eff's, not ours. Tabs
   are preallocated per team x effect and re-used, so nothing is built per frame. */
function hudTabs(a,rdt){
 const bd=HUD.bd,X=HUD.x,u=HUD.u,T=HUD.t,now=S.time,th=26*u,gap=5*u;
 for(let t=0;t<2;t++){
  const e=S.eff&&S.eff[t],ord=HUD.ord[t];
  for(const tb of HUD.tabs[t]){
   const end=e?e[tb.f.k]||0:0,live=end>now;
   if(live&&!tb.live){tb.live=true;tb.born=T;tb.end=end;tb.dur=Math.max(.5,end-now);tb.y=-1;ord.splice(ord.indexOf(tb),1);ord.push(tb);}
   else if(live&&end!==tb.end){if(end>tb.end){tb.dur=Math.max(.5,end-now);tb.bump=T;}tb.end=end;}   // re-collected: refill
   else if(!live&&tb.live){tb.live=false;tb.die=T;}
  }
  let row=0;
  for(const tb of ord){
   const out=tb.live?0:hC((T-tb.die)/.16);if(out>=1)continue;
   const ty=bd.y0+7*u+row*(th+gap);row++;
   tb.y=tb.y<0?ty:tb.y+(ty-tb.y)*Math.min(1,rdt*16);
   hudTab(t,tb,tb.y,th,a*(1-out),(.15+.85*hBk(hC((T-tb.born)/.2)))*(1-.85*out));
  }
 }
}
function hudTab(t,tb,y,h,a,sx){
 const bd=HUD.bd,X=HUD.x,u=HUD.u,T=HUD.t,tc=hudTeam(t),f=tb.f,s=t?1:-1,tn=bd.tn;
 const fL=hudF(12*u),trL=1.3*u,fS=hudF(13*u),sec=String(Math.max(0,Math.ceil(tb.end-S.time)));
 X.font=fL;const lw=hudW(f.lab,trL),cs=hudCell(fS),iw=17*u,pad=12*u,w=pad+iw+7*u+lw+9*u+cs*2+pad;
 // inner edge rides the board's cut, 5u off it: x = edge(y)
 const ex=yy=>t?bd.xo1+bd.kl+6*u-(yy-bd.y0+bd.kl)*tn:bd.xo0-bd.kl-6*u+(yy-bd.y0+bd.kl)*tn;
 const e0=ex(y),e1=ex(y+h),o0=e0+s*w,o1=e1+s*w,ym=y+h/2;
 X.save();X.globalAlpha=a;
 X.translate(ex(ym),ym);X.scale(sx,1);X.translate(-ex(ym),-ym);   // grows out from the board, collapses back into it
 X.beginPath();X.moveTo(e0,y);X.lineTo(o0,y);X.lineTo(o1,y+h);X.lineTo(e1,y+h);X.closePath();
 X.fillStyle='rgba(8,11,19,.94)';X.fill();
 X.save();X.clip();
 const fr=hC((tb.end-S.time)/tb.dur),bw=w*fr;
 X.fillStyle=hudA(tc.c,.24);X.beginPath();X.moveTo(e0,y);X.lineTo(e0+s*bw,y);X.lineTo(e1+s*bw,y+h);X.lineTo(e1,y+h);X.closePath();X.fill();
 const bp=hC(1-(T-tb.bump)/.45);if(bp>0){X.fillStyle=hudA(tc.c,.5*bp);X.fillRect(Math.min(e0,o1)-h,y,w+h*2,h);}
 X.fillStyle=tc.c;X.beginPath();X.moveTo(e0,y);X.lineTo(e0+s*3*u,y);X.lineTo(e1+s*3*u,y+h);X.lineTo(e1,y+h);X.closePath();X.fill();
 X.fillStyle='rgba(255,255,255,.08)';X.fillRect(Math.min(e0,o0),y,w,u);
 X.restore();
 // contents read left to right on both sides; laid out along the tab's mid-line
 const lx=Math.min(ex(ym),ex(ym)+s*w)+pad;
 const pt=(PU_TYPES.find(p=>p.key===f.pu)||{}).col;
 X.save();X.translate(lx,ym-iw/2);X.scale(iw/24,iw/24);
 if(f.fill){X.fillStyle=hudCol(pt||tc.c);X.fill(f.p);}else{X.strokeStyle=hudCol(pt||tc.c);X.lineWidth=2.2;X.lineCap='round';X.stroke(f.p);}
 X.restore();
 X.font=fL;X.fillStyle='#ffffff';hudT(f.lab,lx+iw+7*u,ym+u,-1,trL);
 X.font=fS;X.fillStyle=hudMix(tc.c,.55);hudMono(sec,lx+iw+7*u+lw+9*u+cs,ym+u,cs);
 X.restore();
}

/* ===== rod chips =====
   A segmented control, not a row of pills: the rods are one choice. The seat's colour slides between
   segments when you switch (the highlight is animated per seat, the text is not — the label you
   asked for is already correct the frame you ask), a caret points up at the table, and a rod another
   player holds is HATCHED — "you can't have this" reads faster than a dashed border ever did. */
function hudChipSig(){let h=S.seats.length+(HUD.W|0)*7;for(const s of S.seats)h=h*31+s.ctrl*7+s.rods.length|0;return h;}
function hudChipsBuild(){
 const X=HUD.x,u=HUD.u,ss=S.seats,C=HUD.chips;C.length=0;
 const multi=ss.length>1,cmp=ss.length>CHIP_FULL_MAX,g=4*u,gg=22*u,pad=12*u,fR=hudF(14*u),fN=hudF(10*u),trR=1.4*u;
 let x=0;
 for(let si=0;si<ss.length;si++){
  const s=ss[si],P='P'+(si+1);if(si)x+=gg-g;
  X.font=fR;
  if(cmp){const r=seatRod(s),lab=P+' · '+(r?r.role:'—'),w=hudW(lab,trR)+pad*2;C.push({k:2,s,lab,x,w});x+=w+g;continue;}
  if(multi){const w=hudW(P,trR)+pad*1.6;C.push({k:0,s,lab:P,x,w});x+=w+g;}
  for(let i=0;i<s.rods.length;i++){
   const lab=s.rods[i].role,num=String(i+1);X.font=fN;const nw=hudW(num,0);X.font=fR;
   const w=pad+nw+5*u+hudW(lab,trR)+pad;C.push({k:1,s,i,num,lab,nw,x,w});x+=w+g;
  }
 }
 const x0=(HUD.W-(x-g))/2;for(const c of C)c.x+=x0;
 HUD.chipSig=hudChipSig();HUD.chipU=u;
}
function hudChips(a,rdt){
 if(!S.seats||!S.seats.length){HUD.chips.length=0;return;}
 if(HUD.chipSig!==hudChipSig()||HUD.chipU!==HUD.u)hudChipsBuild();
 const X=HUD.x,u=HUD.u,T=HUD.t,C=HUD.chips,h=30*u,k=h*.158,                // tan 9°
  y=HUD.H-20*u-h+(1-hO3(hC((T-HUD.onT-.15)/.45)))*80*u;
 const fR=hudF(14*u),fN=hudF(10*u),trR=1.4*u;
 HUD.chipY=y;HUD.chipK=k;X.globalAlpha=a;
 for(let n=0;n<C.length;n++){const c=C[n];if(c.k===0)continue;
  c.tk=c.k===1&&rodTaken(c.s.rods[c.i],c.s);
  X.fillStyle='rgba(0,0,0,.35)';hudPar(c.x,y+3*u,c.w,h,k);X.fill();
  hudPar(c.x,y,c.w,h,k);X.fillStyle=c.tk?'rgba(7,9,15,.78)':n===HUD.hov?'rgba(30,39,60,.95)':'rgba(10,13,22,.9)';X.fill();
  if(c.tk){X.save();X.clip();X.fillStyle=hudHatch();X.fillRect(c.x,y,c.w+k,h);X.restore();}
  X.fillStyle='rgba(255,255,255,.07)';X.fillRect(c.x+k,y,c.w,u);
 }
 // the per-seat highlight, eased toward the held rod's segment
 for(const c of C){
  if(!(c.k===2||(c.k===1&&c.i===c.s.ctrl)))continue;
  let hl=HUD.hl.get(c.s);if(!hl){hl={x:c.x,w:c.w};HUD.hl.set(c.s,hl);}
  const q=Math.min(1,rdt*20);hl.x+=(c.x-hl.x)*q;hl.w+=(c.w-hl.w)*q;
  const col=seatCol(c.s),g=X.createLinearGradient(0,y,0,y+h);g.addColorStop(0,hudMix(col,.18));g.addColorStop(1,hudMix(col,-.15));
  hudPar(hl.x,y,hl.w,h,k);X.fillStyle=g;X.fill();
  X.fillStyle='rgba(255,255,255,.35)';X.fillRect(hl.x+k,y,hl.w,u);
  const mx=hl.x+hl.w/2+k;X.fillStyle=col;X.beginPath();X.moveTo(mx-5*u,y-3*u);X.lineTo(mx+5*u,y-3*u);X.lineTo(mx,y-8*u);X.closePath();X.fill();
 }
 for(const c of C){
  const col=seatCol(c.s),my=y+h/2+u,cx0=c.x+k/2;
  if(c.k===0){X.strokeStyle=hudA(col,.7);X.lineWidth=1.5*u;hudPar(c.x+u,y+u,c.w-2*u,h-2*u,k);X.stroke();X.font=fR;X.fillStyle=col;hudT(c.lab,cx0+c.w/2,my,0,trR);continue;}
  const on=c.k===2||c.i===c.s.ctrl,ink=on?hudInk(col,.55):null;
  X.font=fR;
  if(c.k===2){X.fillStyle=ink;hudT(c.lab,cx0+c.w/2,my,0,trR);continue;}
  const lx=cx0+12*u;
  X.font=fN;X.fillStyle=on?hudA(ink,.6):c.tk?'#3a465f':'#56688c';hudT(c.num,lx,my-3*u,-1,0);
  X.font=fR;X.fillStyle=on?ink:c.tk?'#4b5874':'#a5b5d2';hudT(c.lab,lx+c.nw+5*u,my,-1,trR);
 }
 X.globalAlpha=1;
}
function hudChipAt(px,py){
 if(!HUD.on||S.photo||HUD.chromeA<.5||document.pointerLockElement)return -1;
 const u=HUD.u,h=30*u;if(py<HUD.chipY-8*u||py>HUD.chipY+h)return -1;
 const C=HUD.chips;for(let i=0;i<C.length;i++){const c=C[i];if(c.k&&px>=c.x&&px<=c.x+c.w+HUD.chipK)return i;}
 return -1;
}
const hudGame=()=>HUD.g||(HUD.g=$('game'));
function hudCursor(on){
 const g=hudGame();if(!g)return;
 if(on){if(!g.style.cursor){g.style.cursor='pointer';HUD.cur=true;}}
 else if(HUD.cur){g.style.cursor='';HUD.cur=false;}   // never clears a cursor photo/training set
}
// CAPTURE phase, so a chip click is stolen before input.js's canvas mousedown can kick with it — and
// only when the click was aimed at the table: the pause menu sits over the chip row too.
addEventListener('mousedown',e=>{
 if(e.target!==hudGame())return;
 const i=hudChipAt(e.clientX,e.clientY);if(i<0)return;
 e.stopImmediatePropagation();e.preventDefault();
 if(e.button!==0)return;
 const c=HUD.chips[i];if(c.k===2)seatStep(c.s,1);else setSeatCtrl(c.s,c.i,1);
},true);
addEventListener('mousemove',e=>{
 const i=e.target===hudGame()?hudChipAt(e.clientX,e.clientY):-1;
 if(i!==HUD.hov){HUD.hov=i;hudCursor(i>=0);}
},{passive:true});

/* ===== controls hint =====
   Bottom right, as keycaps. It is only worth full strength while you're still learning where things
   are: after CONFIG.hud.hintHold of play it settles back to hintDim instead of sitting at full
   brightness over the corner of the table all match. */
function hudHintDraw(a){
 const X=HUD.x,u=HUD.u,H=CONFIG.hud,L=HUD.hint,age=HUD.t-HUD.hintT;
 X.globalAlpha=a*(age<H.hintHold?1:1-(1-H.hintDim)*hO3(hC((age-H.hintHold)/1.2)));
 let y=HUD.H-24*u;
 for(let i=L.length-1;i>=0;i--){hudLine(L[i],HUD.W-18*u-hudLineW(L[i],u),y,u,'#7486aa');y-=22*u;}
 X.globalAlpha=1;
}

/* ===== notice · tier 2 =====
   A live event the player already watched happen: one line under the board, colour-coded to whoever
   it concerns, wiped in from the left behind a solid chevron in that colour. No subtitle. */
function hudNotice(){
 const n=HUD.ntc,X=HUD.x,u=HUD.u,age=HUD.t-n.t,h=30*u,k=h*.158,fs=15*u,tr=2.2*u,pad=18*u,ab=7*u,gp=3*u;
 X.font=hudF(fs);const w=hudW(n.s,tr)+pad*2,tot=ab+gp+w;
 // under the board; in a trial the board is down and the trial's own DOM readout owns the top
 let y=HUD.bd&&HUD.chromeA>0?HUD.bd.bot+12*u:S.trial?178:26*u;
 const ei=hO3(hC(age/.19)),eo=hC((age-n.d+.18)/.18);y-=eo*6*u;
 const x0=(HUD.W-tot)/2;
 X.save();X.globalAlpha=1-eo;X.beginPath();X.rect(x0-2,y-2,(tot+k+4)*ei,h+4);X.clip();
 X.fillStyle='rgba(0,0,0,.35)';hudPar(x0,y+3*u,tot,h,k);X.fill();
 hudPar(x0,y,ab,h,k);X.fillStyle=n.c;X.fill();
 hudPar(x0+ab+gp,y,w,h,k);X.fillStyle='rgba(8,11,19,.94)';X.fill();
 X.fillStyle='rgba(255,255,255,.07)';X.fillRect(x0+ab+gp+k,y,w,u);
 X.fillStyle='#ffffff';hudT(n.s,x0+ab+gp+k/2+w/2,y+h/2+u,0,tr);
 X.restore();
}

/* ===== banner · tier 1 =====
   Stop-the-world only. The headline wipes in from the left while its lean settles 15° → 8°, the
   rule under it draws in a beat later in the owning colour, the sub chip a beat after that, and one
   light sweep crosses the lettering on the way in. It leaves by wiping off to the right. */
function hudBanner(){
 const b=HUD.bnr,X=HUD.x,u=HUD.u,W=HUD.W,H=HUD.H,age=HUD.t-b.t;
 let fs=clamp(Math.min(W*.058,H*.1),44,92);X.font=hudF(fs);let tr=fs*.02,mw=hudW(b.m,tr);
 if(mw>W*.84){fs*=W*.84/mw;X.font=hudF(fs);tr=fs*.02;mw=hudW(b.m,tr);}
 const fS=hudF(fs*.33,true),trS=fs*.05;X.font=fS;const sw=b.s?hudW(b.s,trS)+fs*.4:0;
 const ei=hO3(hC(age/.26)),eo=hC((age-b.d+.24)/.24),half=Math.max(mw,sw)/2+fs*.8;
 const sk=Math.tan((15-7*ei)*Math.PI/180),sx=1.05-.05*ei;
 X.save();X.translate(W/2+eo*eo*30*u,H*.34);X.transform(sx,0,-sk,1,0,0);
 const xl=-half+2*half*hO3(eo),xr=-half+2*half*ei;
 X.beginPath();X.rect(xl,-fs*1.2,xr-xl,fs*3);X.clip();
 X.font=hudF(fs);hudHeavy(b.m,0,0,fs,tr);
 if(CONFIG.hud.glint&&!HUD.lowFx&&age>.14&&age<.8){
  const p=(age-.14)/.66,e=p*p*(3-2*p),bx=-mw/2-fs+(mw+2*fs)*e;
  const gl=X.createLinearGradient(bx-fs*.3,fs*.35,bx+fs*.3,-fs*.35);
  gl.addColorStop(0,'rgba(255,255,255,0)');gl.addColorStop(.5,'rgba(255,255,255,.95)');gl.addColorStop(1,'rgba(255,255,255,0)');
  X.fillStyle=gl;hudT(b.m,0,0,0,tr);
 }
 const ry=fs*.5,rh=Math.max(3,fs*.07),re=hO3(hC((age-.08)/.26));
 X.fillStyle='rgba(0,0,0,.4)';X.fillRect(-mw/2,ry+rh*.6,mw*re,rh);X.fillStyle=b.c;X.fillRect(-mw/2,ry,mw*re,rh);
 if(b.s){
  const cy=ry+rh+fs*.2,ch=fs*.46,se=hO3(hC((age-.14)/.24));
  X.save();X.beginPath();X.rect(-sw/2,cy,sw*se,ch);X.clip();
  X.fillStyle=b.c;X.fillRect(-sw/2,cy,sw,ch);
  X.font=fS;X.fillStyle=hudInk(b.c,.3);hudT(b.s,0,cy+ch/2+fs*.02,0,trS);
  X.restore();
 }
 X.restore();
}

/* ===== countdown =====
   Each value lands — in from 1.55x, the previous one blown outward and gone — and a bar under the
   numeral closes over its second. The count sits LOWER than the banner so the two can share a
   kickoff, and READY is held back while a banner is up: it has nothing to add to one. */
function hudCountOne(c,out){
 const X=HUD.x,u=HUD.u,age=HUD.t-c.t,word=c.v.length>1,fs=clamp(HUD.H*.16,84,160)*(word?.46:1),tr=word?fs*.12:0;
 let s,al;
 if(out){const e=hC(age/.2);s=1+.3*e;al=1-e;}else{s=1.55-.55*hO3(hC(age/.22));al=hC(age/.07);}
 X.save();X.globalAlpha=al;X.translate(HUD.W/2,HUD.H*.55);X.transform(s,0,-.123*s,s,0,0);
 X.font=hudF(fs);hudHeavy(c.v,0,0,fs,tr);
 if(!out&&!word&&S.phase==='count'){
  const fr=hC(S.countT-(+c.v-1)),bw=fs*.62*fr,bh=Math.max(3,5*u);
  X.fillStyle='rgba(0,0,0,.4)';X.fillRect(-bw/2,fs*.56+bh*.6,bw,bh);X.fillStyle='#ffffff';X.fillRect(-bw/2,fs*.56,bw,bh);
 }
 X.restore();
}

/* ===== replay letterbox =====
   The bars slide in, a hairline in the SCORER's colour runs out from centre along both inner edges,
   and the bottom bar carries the save state: an offer ([S] SAVE CLIP) while the recorder is armed,
   a blinking record dot once the clip is kept. */
function hudReplayDraw(){
 const R=HUD.rep,X=HUD.x,u=HUD.u,W=HUD.W,H=HUD.H,age=HUD.t-R.t;
 const q=1-hC(age/.3),e=R.on?1-Math.pow(1-hC(age/.45),4):q*q*(3-2*q);if(e<=0)return;
 const bh=Math.max(46*u,H*.09),ty=-bh*(1-e),by=H-bh*e,tc=hudTeam(R.team);
 X.fillStyle='#04050a';X.fillRect(0,ty,W,bh);X.fillRect(0,by,W,bh);
 const rw=W*(R.on?hO3(hC((age-.15)/.55)):1);X.fillStyle=tc.c;X.fillRect((W-rw)/2,ty+bh-2*u,rw,2*u);X.fillRect((W-rw)/2,by,rw,2*u);
 const blink=(age%1.1)<.55?1:.18,ly=ty+bh-18*u,ly2=by+20*u;
 X.fillStyle=hudA('#ff3b3b',blink);hudDot(31*u,ly,4.5*u);
 X.font=hudF(15*u);X.fillStyle=hudCol('var(--gold)');hudT('REPLAY',45*u,ly+u,-1,5*u);
 if(R.save==='saving'){X.fillStyle=hudA('#ff3b3b',blink);hudDot(31*u,ly2,4*u);X.font=hudF(12*u);X.fillStyle=hudCol('var(--gold)');hudT(REPLAY.save.saving,44*u,ly2+u,-1,2.6*u);}
 else if(R.save==='armed'&&R.tok)hudLine(R.tok[0],26*u,ly2,u,'#7f93ba');
 X.font=hudF(12*u);X.fillStyle='#62759b';hudT('ANY KEY — SKIP',W-28*u,ly2+u,1,2.6*u);
}

/* ===== toast · tier 3 =====
   System and dev chatter. The quietest thing on screen, bottom left, stacked newest-lowest. A toast
   that repeats one already up (a toggle pressed twice) replaces it rather than stacking a copy. */
function hudToasts(){
 const X=HUD.x,u=HUD.u,T=HUD.t,fM=hudF(Math.max(10.5,11*u)),fS=hudF(Math.max(10,10.5*u)),trM=1.6*u,trS=.5*u;
 let y=HUD.H-64*u;
 for(let i=HUD.tst.length-1;i>=0;i--){
  const q=HUD.tst[i],age=T-q.t,ei=hO3(hC(age/.16)),eo=hC((age-q.d+.18)/.18);
  X.font=fM;const mw=hudW(q.m,trM);X.font=fS;const sw=q.s?hudW(q.s,trS):0;
  const w=Math.max(mw,sw)+26*u,h=q.s?38*u:24*u;y-=h;
  X.save();X.globalAlpha=ei*(1-eo);X.translate(-(1-ei)*10*u,0);
  X.fillStyle='rgba(8,11,19,.9)';X.fillRect(16*u,y,w,h);X.fillStyle='#4a5c80';X.fillRect(16*u,y,2*u,h);
  X.font=fM;X.fillStyle='#c6d2ea';hudT(q.m,29*u,y+(q.s?13*u:h/2+u),-1,trM);
  if(q.s){X.font=fS;X.fillStyle='#6d80a4';hudT(q.s,29*u,y+27*u,-1,trS);}
  X.restore();y-=6*u;
 }
}

/* ===== dev readouts =====
   An instrument, not chrome: system mono, square, unscaled, cyan-edged — it must not look like part
   of the game. Sections are KEYED (hudDev(key,rows)) so each debug.js updater owns its own block and
   none can overwrite another's; null removes one. Rows are lines of [label, value, hot] triples. */
function hudDevDraw(){
 const X=HUD.x,D=HUD.dev;let y=14;
 X.font='11px '+HUD.mono;hudTrack(0);X.textAlign='left';
 const keys=HUD_DEVK.filter(k=>D[k]);for(const k in D)if(HUD_DEVK.indexOf(k)<0)keys.push(k);
 for(const k of keys){
  const rows=D[k];let w=0;
  for(const r of rows){let lw=0;for(const p of r)lw+=X.measureText(p[0]).width+5+X.measureText(p[1]).width+12;w=Math.max(w,lw-12);}
  const h=rows.length*15+10;
  X.fillStyle='rgba(0,0,0,.74)';X.fillRect(16,y,w+20,h);
  X.strokeStyle='rgba(42,245,255,.28)';X.lineWidth=1;X.strokeRect(16.5,y+.5,w+19,h-1);
  let ly=y+5+7.5;
  for(const r of rows){let x=26;
   for(const p of r){X.fillStyle='#7f93ba';X.fillText(p[0],x,ly);x+=X.measureText(p[0]).width+5;
    X.fillStyle=p[2]?'#ff8c3a':'#ffffff';X.fillText(p[1],x,ly);x+=X.measureText(p[1]).width+12;}
   ly+=15;}
  y+=h+6;
 }
}

/* ===== frame ===== */
function hudRender(rdt){
 if(!HUD.x&&!hudInit())return;
 rdt=rdt>0?rdt:0;HUD.t+=rdt;hudFit();
 const X=HUD.x,T=HUD.t,R=HUD.rep;
 HUD.lowFx=document.body.classList.contains('lowFx');
 if(HUD.on)for(let t=0;t<2;t++)if(HUD.sc[t]!==S.score[t]){HUD.sc[t]=HUD.scFrom[t]=S.score[t];HUD.scT[t]=-9;}   // a change nobody announced snaps
 const ca=HUD.on&&S.phase!=='replay'&&S.phase!=='menu'?1:0;
 if(ca>HUD.chromeA)HUD.chromeA=Math.min(1,HUD.chromeA+rdt/.25);else if(ca<HUD.chromeA)HUD.chromeA=Math.max(0,HUD.chromeA-rdt/.3);
 if(HUD.ntc&&T-HUD.ntc.t>HUD.ntc.d)HUD.ntc=null;
 if(HUD.bnr&&T-HUD.bnr.t>HUD.bnr.d)HUD.bnr=null;
 for(let i=HUD.tst.length;i--;)if(T-HUD.tst[i].t>HUD.tst[i].d)HUD.tst.splice(i,1);
 if(HUD.cntOut&&T-HUD.cntOut.t>.22)HUD.cntOut=null;
 // dev readouts ride a match or free roam; the room editor's panel lives where the rail would sit
 let dev=false;if(!S.redit&&(HUD.on||S.freeRoam))for(const k in HUD.dev){dev=true;break;}
 const rep=HUD.on&&(R.on||T-R.t<.32);
 const need=!S.photo&&!!(HUD.chromeA>0||HUD.ntc||HUD.bnr||HUD.tst.length||HUD.cnt||HUD.cntOut||rep||dev);
 if(!need&&!HUD.dirty)return;
 X.setTransform(1,0,0,1,0,0);X.clearRect(0,0,HUD.c.width,HUD.c.height);
 HUD.dirty=need;if(!need)return;
 X.setTransform(HUD.dpr,0,0,HUD.dpr,0,0);X.textBaseline='middle';X.lineJoin='round';X.globalAlpha=1;
 HUD.bd=null;
 if(HUD.chromeA>0){
  const a=HUD.chromeA;
  if(!S.trial){hudBoard(a);hudTabs(a,rdt);}
  hudChips(a,rdt);
  if(HUD.hint)hudHintDraw(a);
 }
 if(dev)hudDevDraw();
 if(rep)hudReplayDraw();
 if(HUD.ntc)hudNotice();
 if(HUD.bnr)hudBanner();
 if(HUD.cntOut)hudCountOne(HUD.cntOut,true);
 const cn=HUD.cnt;
 if(cn){if(HUD.bnr&&cn.v.length>1)cn.hid=true;else{if(cn.hid){cn.hid=false;cn.t=T;}hudCountOne(cn,false);}}
 if(HUD.tst.length)hudToasts();
}

/* ===== API =====
   THREE notification weights, deliberately not interchangeable — a dev toggle and a match-deciding
   goal must not read alike. `col` is whoever the message concerns (team, ball, charge band); any
   CSS colour, var() or 0xRRGGBB number.
     banner(main,sub,dur,col)  tier 1 · stop-the-world: kickoff, goal, sudden death, full time.
     notice(main,dur,col)      tier 2 · a live event the player already SAW. One line, no subtitle.
     toast(main,sub,dur)       tier 3 · system/dev chatter. Small, bottom-left, out of the way. */
function banner(main,sub,dur,col){HUD.bnr={m:String(main).toUpperCase(),s:sub?String(sub).toUpperCase():'',c:hudCol(col||'#dbe6ff'),t:HUD.t,d:dur||1.6};}
function notice(main,dur,col){HUD.ntc={s:String(main).toUpperCase(),c:hudCol(col||'#9db2d8'),t:HUD.t,d:dur||1.3};}
function toast(main,sub,dur){
 const m=String(main).toUpperCase();for(let i=HUD.tst.length;i--;)if(HUD.tst[i].m===m)HUD.tst.splice(i,1);
 HUD.tst.push({m,s:sub?String(sub):'',t:HUD.t,d:dur||1.6});if(HUD.tst.length>3)HUD.tst.shift();
}
// the match chrome, on at kickoff and off at the menu — what #hud's .hidden class used to be
function hudShow(on){
 HUD.on=!!on;HUD.dirty=true;HUD.cnt=HUD.cntOut=null;HUD.hl.clear();HUD.chipSig=NaN;HUD.hov=-1;hudCursor(false);
 HUD.rep.on=false;HUD.rep.t=-99;clearFxRail();
 if(on){HUD.onT=HUD.t;HUD.chromeA=1;hudColC.clear();hudTC[0].k=hudTC[1].k=null;HUD.nmc=[{},{}];
  HUD.sc[0]=HUD.scFrom[0]=S.score[0];HUD.sc[1]=HUD.scFrom[1]=S.score[1];HUD.scT[0]=HUD.scT[1]=-9;HUD.clk=-1;}
 else{HUD.chromeA=0;HUD.ntc=HUD.bnr=null;}
}
function hudHint(src){HUD.hint=src?hudTok(src):null;HUD.hintT=HUD.t;}
function hudCount(v){
 v=v?String(v):'';const c=HUD.cnt;if((c?c.v:'')===v)return;
 if(c&&!c.hid)HUD.cntOut={v:c.v,t:HUD.t};HUD.cnt=v?{v,t:HUD.t,hid:false}:null;   // a READY the banner held back never shows, so it never leaves either
}
function hudReplay(on,team){const R=HUD.rep;if(R.on===!!on)return;R.on=!!on;R.t=HUD.t;if(team!=null)R.team=team;}
function hudReplaySave(st){const R=HUD.rep;R.save=st;if(st==='armed'&&!R.tok)R.tok=hudTok(REPLAY.save.hint);}
function hudDev(k,rows){if(rows)HUD.dev[k]=rows;else delete HUD.dev[k];}
// a goal: the scoring side's number ROLLS and its bead slides home. Called with no team, it just snaps.
function updateScoreUI(team){
 for(let t=0;t<2;t++){
  if(t===team&&S.score[t]>HUD.sc[t]){HUD.scFrom[t]=HUD.sc[t];HUD.scT[t]=HUD.t;}
  else if(t!==team){HUD.scFrom[t]=S.score[t];HUD.scT[t]=-9;}
  HUD.sc[t]=S.score[t];
 }
}
function updateChips(){HUD.chipSig=NaN;}
function clearFxRail(){if(HUD.tabs)for(const a of HUD.tabs)for(const tb of a){tb.live=false;tb.die=-9;tb.end=0;}}
