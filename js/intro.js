'use strict';
/* ================= intro cinematic =================
   Lit-fuse boot splash: a spark snakes across the dark on a bezier, detonates
   into a shockwave + ember burst, the logo slams in with chromatic ghosts, a
   specular shine sweeps it, then the logo morphs up into its menu spot while
   the menu staggers in. Doubles as the loading screen — holds on the settled
   logo until boot() fires. Pure canvas/CSS, no assets beyond the logo PNG.
   All knobs in CONFIG.intro. Any key/click skips. */
let introReady=false;                 // flipped by main.js boot() via introGameReady()
function introGameReady(){introReady=true;}
(function(){
 const IN=CONFIG.intro,ov=$('intro');if(!ov)return;
 ov.dataset.live='1';                 // tells the loader failsafe we're in charge
 const menu=$('menu');
 const off=()=>{ov.remove();menu.classList.remove('introHide');};
 if(!IN.on||matchMedia('(prefers-reduced-motion: reduce)').matches){off();return;}
 const stage=$('introStage'),cv=$('introFx'),ctx=cv.getContext('2d');
 const lw=$('introLogoWrap'),logo=$('introLogo'),gR=$('introGR'),gB=$('introGB'),
       shine=$('introShine'),tag=$('introTag'),flash=$('introFlash'),loadEl=$('introLoad'),skipEl=$('introSkip');
 if(CONFIG.logo.src){logo.src=gR.src=gB.src=CONFIG.logo.src;shine.style.webkitMaskImage=shine.style.maskImage='url("'+CONFIG.logo.src+'")';}
 /* tagline → per-letter spans (staggered rise) */
 const txt=tag.textContent;tag.textContent='';
 for(let i=0;i<txt.length;i++){const s=document.createElement('span');s.textContent=txt[i]===' '?' ':txt[i];s.style.transitionDelay=(i*.028)+'s';tag.appendChild(s);}
 let W=0,H=0;
 function fit(){const dpr=Math.min(2,window.devicePixelRatio||1);W=innerWidth;H=innerHeight;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';ctx.setTransform(dpr,0,0,dpr,0,0);}
 fit();addEventListener('resize',fit);
 /* fuse path: corner → sweep up → dive → the bomb (logo centre, 41% down) */
 const bez=t=>{const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
  return[a*(-.06*W)+b*(.30*W)+c*(.68*W)+d*(.50*W), a*(.88*H)+b*(.04*H)+c*(1.04*H)+d*(.41*H)];};
 const ease=t=>t*t*(3-2*t);
 const dust=[],trail=[],sparks=[],rings=[],smoke=[];
 for(let i=0;i<42;i++)dust.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*7,vy:(Math.random()-.5)*7,r:.6+Math.random()*1.6,a:.04+Math.random()*.1});
 const dT=IN.igniteT+IN.fuseT;        // detonation time
 let t0=performance.now(),last=t0,shakeA=0,detonated=false,slammed=false,shone=false,tagged=false,revealing=false,done=false,holdOn=false;
 function spark(x,y,vx,vy,life,r,g,hot){sparks.push({x,y,vx,vy,life,tot:life,r,g,hot:!!hot});}
 function detonate(){
  detonated=true;const p=bez(1),x=p[0],y=p[1];
  flash.classList.add('on');shakeA=IN.shake;
  for(const v of[1350,920,610])rings.push({x,y,r:6,v,a:.95});
  for(let i=0;i<IN.burstN;i++){const an=Math.random()*Math.PI*2,sp=90+Math.pow(Math.random(),2)*760;
   spark(x,y,Math.cos(an)*sp,Math.sin(an)*sp*.82,.45+Math.random()*1.25,.7+Math.random()*2.4,IN.emberGrav*(.3+Math.random()*.9),i<70);}
  for(let i=0;i<16;i++){const an=Math.random()*Math.PI*2,sp=25+Math.random()*90;
   smoke.push({x,y,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp-24,r:16+Math.random()*26,a:.16+Math.random()*.1});}
  trail.length=0;
 }
 function reveal(){
  if(revealing)return;revealing=true;
  loadEl.classList.remove('on');skipEl.classList.add('off');tag.classList.add('off');shine.classList.add('off');
  /* morph the intro logo onto the menu logo's spot (measure BEFORE un-hiding) */
  const tEl=menu.querySelector('.logo'),tr=tEl?tEl.getBoundingClientRect():null,lr=logo.getBoundingClientRect();
  if(tr&&tr.width>0&&lr.width>0){
   const s=tr.width/lr.width,dx=(tr.left+tr.width/2)-(lr.left+lr.width/2),dy=(tr.top+tr.height/2)-(lr.top+lr.height/2);
   lw.style.transform='translate(calc(-50% + '+dx.toFixed(1)+'px),calc(-50% + '+dy.toFixed(1)+'px)) scale('+s.toFixed(4)+')';
  }
  ov.classList.add('out');
  menu.classList.remove('introHide');menu.classList.add('introIn');
  setTimeout(()=>{done=true;if(ov.parentNode)ov.remove();},900);
  setTimeout(()=>menu.classList.remove('introIn'),2100); // stop entrance anims re-firing when the menu is re-shown later
  removeEventListener('keydown',skip);
 }
 function skip(){
  if((performance.now()-t0)/1000<.3||revealing)return;
  ov.classList.add('fast');
  if(!detonated)detonate();
  if(!slammed){slammed=true;lw.classList.add('slam');}
  shone=tagged=true;shine.classList.add('sweep');tag.classList.add('in');
  reveal();
 }
 if(IN.skip){addEventListener('keydown',skip);ov.addEventListener('pointerdown',skip);setTimeout(()=>{if(!revealing)skipEl.classList.add('on');},1200);}
 function step(e,dt){
  if(!detonated){
   if(e>=dT)detonate();
   else if(e>=IN.igniteT){
    const ft=ease(clamp((e-IN.igniteT)/IN.fuseT,0,1)),hp=bez(ft),hx=hp[0],hy=hp[1];
    trail.push({x:hx,y:hy,a:1});
    const pp=bez(Math.max(0,ft-.01)),dxn=hx-pp[0],dyn=hy-pp[1];
    for(let i=0;i<IN.sparkRate;i++){const sp=40+Math.random()*190,an=Math.atan2(-dyn,-dxn)+(Math.random()-.5)*1.5;
     spark(hx,hy,Math.cos(an)*sp,Math.sin(an)*sp,.22+Math.random()*.6,.5+Math.random()*1.7,420,Math.random()<.2);}
   }
  }else{
   if(!slammed&&e>=dT+IN.slamDelay){slammed=true;lw.classList.add('slam');shakeA=Math.max(shakeA,9);}
   if(slammed&&!shone&&e>=dT+IN.slamDelay+IN.shineDelay){shone=true;shine.classList.add('sweep');}
   if(slammed&&!tagged&&e>=dT+IN.slamDelay+IN.tagDelay){tagged=true;tag.classList.add('in');}
   if(slammed&&!revealing&&Math.random()<.5){        // rising embers off the settled logo
    const lr=logo.getBoundingClientRect();
    spark(lr.left+Math.random()*lr.width,lr.bottom-6,(Math.random()-.5)*18,-(18+Math.random()*55),1.4+Math.random()*1.4,.5+Math.random()*1.2,-14,false);
   }
   if(!revealing&&e>=IN.revealT){
    if(introReady||e>=IN.revealT+IN.holdMax)reveal();
    else if(!holdOn){holdOn=true;loadEl.classList.add('on');}
   }
  }
  for(const d of dust){d.x+=d.vx*dt;d.y+=d.vy*dt;if(d.x<0)d.x+=W;if(d.x>W)d.x-=W;if(d.y<0)d.y+=H;if(d.y>H)d.y-=H;}
  for(let i=trail.length-1;i>=0;i--){trail[i].a-=dt*1.15;if(trail[i].a<=0)trail.splice(i,1);}
  for(let i=sparks.length-1;i>=0;i--){const p=sparks[i];p.life-=dt;if(p.life<=0){sparks.splice(i,1);continue;}
   p.vy+=p.g*dt;p.vx*=Math.exp(-1.6*dt);p.vy*=Math.exp(-.4*dt);p.x+=p.vx*dt;p.y+=p.vy*dt;}
  for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.r+=r.v*dt;r.a-=dt*1.5;if(r.a<=0)rings.splice(i,1);}
  for(let i=smoke.length-1;i>=0;i--){const s=smoke[i];s.a-=dt*.12;if(s.a<=0){smoke.splice(i,1);continue;}
   s.x+=s.vx*dt;s.y+=s.vy*dt;s.r+=26*dt;s.vx*=Math.exp(-.8*dt);s.vy*=Math.exp(-.8*dt);}
  if(shakeA>.4){stage.style.transform='translate('+((Math.random()*2-1)*shakeA).toFixed(1)+'px,'+((Math.random()*2-1)*shakeA*.6).toFixed(1)+'px)';shakeA*=Math.exp(-6.5*dt);}
  else if(shakeA){shakeA=0;stage.style.transform='';}
 }
 function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.globalCompositeOperation='source-over';
  for(const s of smoke){ctx.globalAlpha=s.a;ctx.fillStyle='#1a1d26';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill();}
  ctx.globalCompositeOperation='lighter';
  for(const d of dust){ctx.globalAlpha=d.a;ctx.fillStyle='#7d9cc9';ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,7);ctx.fill();}
  if(trail.length>1){
   ctx.lineCap='round';
   for(let i=1;i<trail.length;i++){const a=trail[i].a;
    ctx.globalAlpha=a*.55;ctx.strokeStyle=IN.fuseGlow;ctx.lineWidth=3.4;
    ctx.beginPath();ctx.moveTo(trail[i-1].x,trail[i-1].y);ctx.lineTo(trail[i].x,trail[i].y);ctx.stroke();
    ctx.globalAlpha=a*.9;ctx.strokeStyle='#fff3dd';ctx.lineWidth=1.1;
    ctx.beginPath();ctx.moveTo(trail[i-1].x,trail[i-1].y);ctx.lineTo(trail[i].x,trail[i].y);ctx.stroke();}
   const h=trail[trail.length-1],fr=20+Math.random()*14,
         g=ctx.createRadialGradient(h.x,h.y,0,h.x,h.y,fr);
   g.addColorStop(0,'rgba(255,255,240,.95)');g.addColorStop(.35,'rgba(255,190,90,.6)');g.addColorStop(1,'rgba(255,120,30,0)');
   ctx.globalAlpha=1;ctx.fillStyle=g;ctx.beginPath();ctx.arc(h.x,h.y,fr,0,7);ctx.fill();
  }
  for(const p of sparks){const k=p.life/p.tot;
   ctx.globalAlpha=Math.min(1,k*1.4)*(p.hot?1:.85);
   ctx.fillStyle=p.hot?'#fff6e8':(k>.5?'#ffc264':'#ff6a2a');
   ctx.beginPath();ctx.arc(p.x,p.y,p.r*(p.hot?1.4:1),0,7);ctx.fill();}
  for(const r of rings){ctx.globalAlpha=Math.max(0,r.a);ctx.strokeStyle='rgba('+IN.ringCol+',1)';ctx.lineWidth=Math.max(1,4-r.r/260);
   ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,7);ctx.stroke();}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 }
 function frame(now){
  if(done)return;requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000);last=now;
  step((now-t0)/1000,dt);draw();
 }
 requestAnimationFrame(frame);
})();
