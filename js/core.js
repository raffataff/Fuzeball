'use strict';
/* ================= FUZEBALL — global helpers ================= */
const $=i=>document.getElementById(i);
const clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t, rand=(a,b)=>a+Math.random()*(b-a);
// ---- inline icon set ----
// shared SVG marks for the menus (replacing OS colour emoji); they draw on `currentColor` and are sized by CSS (`.ico svg{width:...}`)
const ICO={
 // a foosball rod: bar, three hangers, three men. The play cards' mark.
 rod:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 5.5h21" stroke-linecap="round"/><path d="M6 5.5v3M12 5.5v3M18 5.5v3"/><rect x="4" y="8.5" width="4" height="9" rx="1"/><rect x="10" y="8.5" width="4" height="9" rx="1"/><rect x="16" y="8.5" width="4" height="9" rx="1"/></svg>',
 // a pitch with a man either side of the halfway line — spectate / AI vs AI.
 duel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M12 3.5v17" stroke-dasharray="2 2.2"/><circle cx="7.2" cy="12" r="2.2"/><circle cx="16.8" cy="12" r="2.2"/></svg>',
 trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 3.5h10V9a5 5 0 0 1-10 0V3.5z"/><path d="M7 5.2H4.4v1.6a3 3 0 0 0 3 3M17 5.2h2.6v1.6a3 3 0 0 1-3 3"/><path d="M12 14v3.2M8.8 20.5h6.4l-.7-3.3H9.5z" stroke-linecap="round"/></svg>',
 target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
 cog:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.7M12 18.7v2.7M21.4 12h-2.7M5.3 12H2.6M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3 5.4 5.4" stroke-linecap="round"/></svg>',
 figure:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="5" r="2.6"/><path d="M12 7.8v7M12 14.8 8.6 21M12 14.8 15.4 21M6.6 10.4 12 9l5.4 1.4"/></svg>',
 lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>'
};
const ico=(k,cls)=>'<span class="ico'+(cls?' '+cls:'')+'">'+(ICO[k]||'')+'</span>';
// ---- figurine portrait ----
// attaches a model's mugshot (CONFIG.playerModel.models[].mug) to `host` over the fallback mark; with no `mug` or a 404 the <img> is dropped, once it decodes `onCls` goes on the host; returns the <img> (or null)
function mugImg(m,host,cls,onCls){
 if(!m||!m.mug||!host)return null;
 const im=document.createElement('img');
 im.className=cls||'mugImg';
 im.alt=m.name||'';
 im.loading='lazy';                       // 16 portraits, only visible once the panel opens
 im.onload=()=>{if(onCls)host.classList.add(onCls);};
 im.onerror=()=>{im.remove();};           // not rendered yet — fallback mark stays put
 im.src=m.mug;
 host.insertBefore(im,host.firstChild);
 return im;
}
