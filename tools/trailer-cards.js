'use strict';
// trailer-cards: title cards and the end card, drawn offline frame by frame on a transparent canvas
//   node tools/page-run.js --size=1920x1080 tools/trailer-cards.js "cardAll('tools/build/trailer/cards.json')"
// each card is a PNG sequence with alpha in tools/build/trailer/cards/<name>/ (frame_00001.png ...), laid over the footage by tools/trailer-edit.py
(function(){
 const log=s=>console.log('[run] '+s);
 const W=1920,H=1080;
 const GOLD=['#FFF1D2','#F6DDB0','#F0B24A','#B8621F','#6E3410'],STEEL=['#FFFFFF','#EDF0F1','#BCDCED','#6BAABC','#2A4F63'];
 const PAL=p=>p==='gold'?GOLD:p==='dark'?['#3A2208','#2A1606','#1E1004','#140A02','#000']:Array.isArray(p)?p:STEEL;
 const cl=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,u)=>a+(b-a)*u;
 const eo=u=>1-Math.pow(1-cl(u,0,1),3),ei=u=>Math.pow(cl(u,0,1),3),es=u=>{u=cl(u,0,1);return u*u*(3-2*u);};
 // back-out: overshoots a touch, the slam
 const eb=u=>{u=cl(u,0,1);const c=1.4;return 1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2);};
 function rng(s){let x=s>>>0||1;return()=>{x^=x<<13;x>>>=0;x^=x>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
 async function save(rel,blob){const r=await fetch('/__save/'+rel,{method:'POST',body:blob});if(!r.ok)throw new Error('save '+rel);}
 async function fonts(){
  const f=new FontFace('FuzeClip',"url('/fonts/fuzeClip/FuzeClip.ttf')");await f.load();document.fonts.add(f);
  const e=new FontFace('Exo2',"url('/vendor/fonts/exo2/Exo2-SemiBold.ttf')");try{await e.load();document.fonts.add(e);}catch(x){}
 }
 const imgs={};
 function img(src){if(imgs[src])return imgs[src];return imgs[src]=new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src='/'+src;});}

 // --- text with a metal fill: vertical gradient, a dark rim, a sheen band that sweeps once ---
 function metal(cx,txt,x,y,size,pal,o){
  o=o||{};
  cx.font=size+"px FuzeClip";cx.textAlign=o.align||'center';cx.textBaseline='alphabetic';
  const tr=o.track||0;
  if('letterSpacing' in cx)cx.letterSpacing=tr+'px';
  const m=cx.measureText(txt),wd=m.width,asc=size*0.74;
  const g=cx.createLinearGradient(0,y-asc,0,y+size*0.06);
  g.addColorStop(0,pal[0]);g.addColorStop(0.32,pal[1]);g.addColorStop(0.55,pal[2]);g.addColorStop(0.86,pal[3]);g.addColorStop(1,pal[4]);
  cx.save();
  // soft shadow so it reads over any footage
  cx.shadowColor='rgba(0,0,0,'+(0.55*(o.shadow!=null?o.shadow:1))+')';cx.shadowBlur=size*0.35;cx.shadowOffsetY=size*0.06;
  cx.fillStyle='rgba(0,0,0,0.6)';cx.fillText(txt,x,y);
  cx.restore();
  cx.save();
  cx.lineJoin='round';cx.lineWidth=Math.max(2,size*0.05);cx.strokeStyle=pal[4];cx.strokeText(txt,x,y+size*0.02);
  cx.fillStyle=g;cx.fillText(txt,x,y);
  if(o.sheen!=null&&o.sheen>-0.3&&o.sheen<1.3){
   // a bright diagonal band clipped to the glyphs
   const x0=o.align==='left'?x:o.align==='right'?x-wd:x-wd/2,bx=x0+mix(-0.2,1.2,o.sheen)*wd;
   cx.globalCompositeOperation='source-atop';
   const sg=cx.createLinearGradient(bx-size*0.9,0,bx+size*0.9,0);
   sg.addColorStop(0,'rgba(255,255,255,0)');sg.addColorStop(0.5,'rgba(255,252,240,0.85)');sg.addColorStop(1,'rgba(255,255,255,0)');
   cx.restore();cx.save();
   // clip by drawing the band through the text as a mask
   const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;const tx=tmp.getContext('2d');
   tx.font=cx.font;tx.textAlign=cx.textAlign;if('letterSpacing' in tx)tx.letterSpacing=tr+'px';tx.fillStyle='#fff';tx.fillText(txt,x,y);
   tx.globalCompositeOperation='source-in';tx.setTransform(1,0,-0.36,1,0,0);tx.fillStyle=sg;tx.fillRect(-W,0,W*3,H);
   cx.globalCompositeOperation='lighter';cx.drawImage(tmp,0,0);
  }
  cx.restore();
  return wd;
 }

 // --- a title card: lines slam in on their beats, hold with a slow push, cut or flick out ---
 //   {name, frames, lines:[{t,at:frame,size,y,pal,track,from}], out:frame, push}
 function drawTitle(cx,c,f){
  const push=1+(c.push||0.035)*(f/c.frames);
  cx.save();cx.translate(W/2,H/2);cx.scale(push,push);cx.translate(-W/2,-H/2);
  for(const L of c.lines){
   const k=f-(L.at||0);if(k<0)continue;
   const inN=L.inN||7,u=k/inN,outAt=(L.out!=null?L.out:c.out)||c.frames;
   const ko=f-outAt,uo=ko>=0?ko/(L.outN||5):0;if(uo>=1)continue;
   const a=cl(u*1.6,0,1)*(1-eo(uo)),s=mix(L.from||1.22,1,eb(u))*(1+0.06*eo(uo));
   const tr=mix((L.track||0)+(L.trackIn!=null?L.trackIn:14),L.track||0,eo(u*0.8));
   cx.save();cx.globalAlpha=a;
   const y=L.y!=null?L.y:H/2+((L.size||120)*0.3);
   cx.translate(W/2,y);cx.scale(s,s);cx.translate(-W/2,-y);
   // a short motion streak while it lands
   if(u<1){cx.globalAlpha=a*0.25;metal(cx,L.t,W/2,y-(1-u)*8,L.size||120,PAL(L.pal),{track:tr,shadow:0});cx.globalAlpha=a;}
   const sh=L.sheen!=null?(k-L.sheen)/(L.sheenN||26):null;
   metal(cx,L.t,W/2,y,L.size||120,PAL(L.pal),{track:tr,sheen:sh});
   if(L.rule){const wd=L.rule*eo(u*0.7);cx.globalAlpha=a*0.9;const gg=cx.createLinearGradient(W/2-wd,0,W/2+wd,0);
    gg.addColorStop(0,'rgba(240,178,74,0)');gg.addColorStop(0.5,'rgba(240,178,74,1)');gg.addColorStop(1,'rgba(240,178,74,0)');
    cx.fillStyle=gg;cx.fillRect(W/2-wd,y+(L.size||120)*0.22,wd*2,3);}
   cx.restore();
  }
  cx.restore();
 }

 // --- the end card: the logo slams in with a flash, a soft shockwave and embers, the fuse keeps sparking, then the call to action ---
 async function drawEnd(cx,c,f,st){
  const t=f/60,L=await img(c.logo);
  cx.fillStyle='#000';cx.fillRect(0,0,W,H);
  const cxp=W/2,cyp=H*0.42,s=mix(1.35,1,eb(t/0.32))*(1+0.022*t),lw=W*0.62*s,lh=L?lw*L.height/L.width:lw*0.5625;
  const fx=cxp-lw/2+0.522*lw,fy=cyp-lh/2+0.265*lh;   // the fuse tip in the render
  if(!st.emb){const r=rng(7);st.emb=[];for(let i=0;i<220;i++){const an=r()*Math.PI*2,sp=140+Math.pow(r(),2)*950;
    st.emb.push({vx:Math.cos(an)*sp,vy:Math.sin(an)*sp*0.75-80,life:0.5+r()*1.8,sz:0.8+r()*2.4,hot:r()<0.35});}
   st.dust=[];for(let i=0;i<60;i++)st.dust.push({x:r()*W,y:r()*H,vx:(r()-0.5)*8,vy:-5-r()*14,s:0.6+r()*1.6,a:0.04+r()*0.14,ph:r()*6});
   st.fz=[];for(let i=0;i<420;i++){const an=-Math.PI/2+(r()-0.5)*2.4,sp=60+r()*260;st.fz.push({b:0.25+r()*4.2,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp,life:0.25+r()*0.6,sz:0.6+r()*1.4});}}
  cx.save();cx.globalCompositeOperation='lighter';
  // a backlight in the logo's two metals, flaring with the hit and settling to a breath
  const bl=0.35+0.65*Math.exp(-t*2.2)+0.05*Math.sin(t*2.1);
  for(const [x,col] of [[cxp-lw*0.22,'255,140,60'],[cxp+lw*0.24,'90,170,255']]){const g=cx.createRadialGradient(x,cyp,0,x,cyp,lw*0.55);
   g.addColorStop(0,'rgba('+col+','+(0.22*bl)+')');g.addColorStop(1,'rgba('+col+',0)');cx.fillStyle=g;cx.fillRect(0,0,W,H);}
  for(const d of st.dust){const x=((d.x+d.vx*t)%W+W)%W,y=((d.y+d.vy*t)%H+H)%H,a=d.a*(0.6+0.4*Math.sin(t*1.7+d.ph))*cl(t/0.8,0,1);
   cx.fillStyle='rgba(255,190,110,'+a+')';cx.beginPath();cx.arc(x,y,d.s,0,7);cx.fill();}
  // one soft shockwave
  if(t<0.9){const r=60+1500*eo(t/0.9),a=0.32*Math.pow(1-t/0.9,1.5),g=cx.createRadialGradient(cxp,cyp,r*0.45,cxp,cyp,r);
   g.addColorStop(0,'rgba(255,178,80,0)');g.addColorStop(0.75,'rgba(255,190,110,'+a+')');g.addColorStop(1,'rgba(255,178,80,0)');
   cx.save();cx.translate(cxp,cyp);cx.scale(1,0.55);cx.translate(-cxp,-cyp);cx.fillStyle=g;cx.fillRect(0,cyp-r,W,2*r);cx.restore();}
  // detonation embers
  for(const e of st.emb){if(t>e.life)continue;const dr=Math.exp(-1.6*t),k=(1-dr)/1.6,x=cxp+e.vx*k,y=cyp+e.vy*k+130*t*t,u=t/e.life,a=(1-u)*(e.hot?1:0.7);
   const vx=e.vx*dr,vy=e.vy*dr+260*t;cx.strokeStyle=e.hot?'rgba(255,240,200,'+a+')':'rgba(255,150,60,'+a+')';cx.lineWidth=e.sz;cx.lineCap='round';
   cx.beginPath();cx.moveTo(x,y);cx.lineTo(x-vx*0.02,y-vy*0.02);cx.stroke();}
  // the fuse: a flickering hot point and its sparks
  const fl=0.75+0.25*Math.sin(t*37)*Math.sin(t*23+1);
  if(t>0.25){const g=cx.createRadialGradient(fx,fy,0,fx,fy,60*fl);g.addColorStop(0,'rgba(255,245,220,'+(0.9*fl)+')');g.addColorStop(0.25,'rgba(255,190,90,'+(0.45*fl)+')');g.addColorStop(1,'rgba(255,140,40,0)');
   cx.fillStyle=g;cx.beginPath();cx.arc(fx,fy,60*fl,0,7);cx.fill();}
  for(const p of st.fz){const a0=t-p.b;if(a0<0||a0>p.life)continue;const x=fx+p.vx*a0,y=fy+p.vy*a0+300*a0*a0,u=a0/p.life;
   cx.strokeStyle='rgba(255,'+Math.round(230-120*u)+','+Math.round(170-150*u)+','+(1-u)+')';cx.lineWidth=p.sz;cx.lineCap='round';
   cx.beginPath();cx.moveTo(x,y);cx.lineTo(x-p.vx*0.03,y-(p.vy+600*a0)*0.03);cx.stroke();}
  cx.restore();
  // the logo: slam (1.35 -> 1 with overshoot), then a slow push; a sheen across it once
  if(L){
   cx.save();cx.globalAlpha=cl(t/0.32*2.2,0,1);cx.globalCompositeOperation='lighter';
   cx.drawImage(L,cxp-lw/2,cyp-lh*0.5,lw,lh);
   const sv=(t-(c.sheenT||0.9))/0.7;
   if(sv>0&&sv<1){const tmp=st.tmp||(st.tmp=document.createElement('canvas'));tmp.width=W;tmp.height=H;const tx=tmp.getContext('2d');
    tx.setTransform(1,0,0,1,0,0);tx.globalCompositeOperation='source-over';tx.clearRect(0,0,W,H);tx.drawImage(L,cxp-lw/2,cyp-lh*0.5,lw,lh);tx.globalCompositeOperation='source-in';
    const bx=cxp-lw/2+mix(-0.15,1.15,es(sv))*lw,g=tx.createLinearGradient(bx-160,0,bx+160,0);
    g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(0.5,'rgba(255,250,235,0.5)');g.addColorStop(1,'rgba(255,255,255,0)');
    tx.setTransform(1,0,-0.4,1,cyp*0.4,0);tx.fillStyle=g;tx.fillRect(-W,0,W*3,H);cx.drawImage(tmp,0,0);}
   cx.restore();
  }
  const fla=Math.max(0,1-t/0.2);if(fla>0){cx.fillStyle='rgba(255,236,200,'+(fla*0.8)+')';cx.fillRect(0,0,W,H);}
  for(const L2 of c.cta||[]){const k=t-L2.t;if(k<0)continue;const u=k/0.28;
   cx.save();cx.globalAlpha=cl(u*1.5,0,1);const y=L2.y,sc=mix(1.12,1,eo(u));cx.translate(W/2,y);cx.scale(sc,sc);cx.translate(-W/2,-y);
   if(L2.plate)metalPlate(cx,W/2,y-L2.size*0.36,L2.plate,L2.size*1.25,eo(u));
   metal(cx,L2.text,W/2,y,L2.size,PAL(L2.pal),{track:L2.track||6,shadow:L2.plate?0:1,sheen:L2.sheen!=null?(k-L2.sheen)/0.5:null});
   cx.restore();}
  if(c.fadeAt!=null&&f>=c.fadeAt){cx.fillStyle='rgba(0,0,0,'+cl((f-c.fadeAt)/(c.frames-c.fadeAt),0,1)+')';cx.fillRect(0,0,W,H);}
 }
 // --- a broadcast lower third: a blue plate with a gold rim and the game's cut corners, a small label over the name ---
 //   {kind:'lower', label, text, inN (frames to wipe in; 0 = already there), outN (wipe out at the end), x, y}
 function drawLower(cx,c,f){
  const x0=c.x||96,y0=c.y||902,h=104,cut=24;
  cx.font="46px FuzeClip";if('letterSpacing' in cx)cx.letterSpacing='5px';
  const tw=cx.measureText(c.text).width,w=Math.max(520,tw+110);
  const ui=c.inN?eo(f/c.inN):1,uo=c.outN?eo((f-(c.frames-c.outN))/c.outN):0,u=cl(ui-uo,0,1);if(u<=0)return;
  const ww=w*u;
  cx.save();
  cx.beginPath();cx.moveTo(x0+cut,y0);cx.lineTo(x0+ww,y0);cx.lineTo(x0+ww,y0+h-cut);cx.lineTo(x0+ww-cut,y0+h);cx.lineTo(x0,y0+h);cx.lineTo(x0,y0+cut);cx.closePath();
  cx.shadowColor='rgba(0,0,0,0.55)';cx.shadowBlur=24;cx.shadowOffsetY=6;
  const g=cx.createLinearGradient(0,y0,0,y0+h);g.addColorStop(0,'rgba(24,74,108,0.94)');g.addColorStop(1,'rgba(7,17,28,0.94)');cx.fillStyle=g;cx.fill();
  cx.shadowColor='transparent';cx.lineWidth=2;cx.strokeStyle='rgba(240,178,74,0.9)';cx.stroke();
  cx.clip();
  const gg=cx.createLinearGradient(x0,0,x0+ww,0);gg.addColorStop(0,'rgba(246,221,176,1)');gg.addColorStop(1,'rgba(240,178,74,0.2)');cx.fillStyle=gg;cx.fillRect(x0,y0,ww,4);
  const ut=c.inN?cl((f-c.inN*0.5)/4,0,1):cl(f/3,0,1);
  cx.globalAlpha=ut;
  cx.font="24px FuzeClip";if('letterSpacing' in cx)cx.letterSpacing='9px';cx.textAlign='left';cx.fillStyle='#F0B24A';cx.fillText(c.label||'',x0+40,y0+38);
  metal(cx,c.text,x0+40+(1-ut)*14,y0+88,46,STEEL,{align:'left',track:5,shadow:0});
  cx.restore();
 }
 // a plate in the game's shape: top-left and bottom-right corners cut at 45 degrees
 function metalPlate(cx,x,y,w,h,u){
  const c=h*0.32,ww=w*u,x0=x-ww/2,y0=y-h/2;
  cx.save();cx.beginPath();cx.moveTo(x0+c,y0);cx.lineTo(x0+ww,y0);cx.lineTo(x0+ww,y0+h-c);cx.lineTo(x0+ww-c,y0+h);cx.lineTo(x0,y0+h);cx.lineTo(x0,y0+c);cx.closePath();
  const g=cx.createLinearGradient(0,y0,0,y0+h);g.addColorStop(0,'#F6DDB0');g.addColorStop(0.45,'#F0B24A');g.addColorStop(1,'#B8621F');
  cx.fillStyle=g;cx.fill();cx.lineWidth=2;cx.strokeStyle='rgba(255,240,210,0.8)';cx.stroke();cx.restore();
 }

 window.cardRender=async function(c){
  await fonts();
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const cx=cv.getContext('2d');
  const st={},dir='trailer/cards/'+c.name+'/';let fl=[];
  for(let f=0;f<c.frames;f++){
   cx.setTransform(1,0,0,1,0,0);cx.clearRect(0,0,W,H);
   if(c.kind==='end')await drawEnd(cx,c,f,st);else if(c.kind==='lower')drawLower(cx,c,f);else drawTitle(cx,c,f);
   fl.push(new Promise(r=>cv.toBlob(b=>r(save(dir+'frame_'+String(f+1).padStart(5,'0')+'.png',b)),'image/png')));
   if(fl.length>=6){await Promise.all(fl);fl=[];}
  }
  await Promise.all(fl);
  return {name:c.name,frames:c.frames};
 };
 window.cardAll=async function(path,only){
  const L=await (await fetch('/'+path,{cache:'no-store'})).json(),out=[];
  for(const c of L.cards){if(only&&!only.includes(c.name))continue;log('card '+c.name);out.push(await window.cardRender(c));}
  return out;
 };
 // one frame of a card as a preview over a grey checker, to look at
 window.cardPeek=async function(path,name,frames){
  const L=await (await fetch('/'+path,{cache:'no-store'})).json(),c=L.cards.find(x=>x.name===name);await fonts();
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const cx=cv.getContext('2d'),st={};
  const sh=document.createElement('canvas');sh.width=960*2;sh.height=Math.ceil(frames.length/2)*540;const sx=sh.getContext('2d');
  for(let i=0;i<frames.length;i++){cx.setTransform(1,0,0,1,0,0);cx.clearRect(0,0,W,H);
   if(c.kind==='end')await drawEnd(cx,c,frames[i],st);else if(c.kind==='lower')drawLower(cx,c,frames[i]);else drawTitle(cx,c,frames[i]);
   const x=(i%2)*960,y=Math.floor(i/2)*540;sx.fillStyle='#3a4450';sx.fillRect(x,y,960,540);sx.drawImage(cv,x,y,960,540);
   sx.fillStyle='#fff';sx.font='14px sans-serif';sx.fillText(name+' f'+frames[i],x+6,y+16);}
  await new Promise(r=>sh.toBlob(b=>r(save('trailer/peek_'+name+'.jpg',b)),'image/jpeg',0.9));
  return 'tools/build/trailer/peek_'+name+'.jpg';
 };
})();
