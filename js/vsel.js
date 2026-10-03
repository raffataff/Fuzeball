'use strict';
// ===== value selectors: ◀ VALUE ▶ in place of a browser dropdown =====
// every <select> on a menu screen is wrapped at boot; the select stays the source of truth (the wrapper only steps selectedIndex and fires input + change)
// mouse: an arrow steps that way, a click on the value steps forward (its mousedown is eaten so the native list never opens); pad: A opens, ◀▶ cycle, A keeps, B puts back (see padnav.js)
// steps wrap and skip disabled/hidden options; only selects inside a .screen are wrapped, dev panels keep plain dropdowns
function vselStep(sel,d){
 const o=sel.options,n=o.length;if(!n)return false;let i=sel.selectedIndex;
 for(let k=0;k<n;k++){i=(i+d+n)%n;if(!o[i].disabled&&!o[i].hidden)break;}
 if(i===sel.selectedIndex||o[i].disabled||o[i].hidden)return false;
 sel.selectedIndex=i;Au.ui('value');sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
}
// Arrows dim when there is nothing to step to (one live option, or a disabled select).
function vselSync(sel){
 const w=sel.parentElement;if(!w||!w.classList.contains('vsel'))return;
 let live=0;for(const o of sel.options)if(!o.disabled&&!o.hidden)live++;
 w.classList.toggle('one',live<2||sel.disabled);
}
function vselWrap(sel){
 if(!sel.parentNode||sel.parentNode.classList.contains('vsel'))return;
 const w=document.createElement('span');w.className='vsel';
 if(!sel.closest('.row,.czRow'))w.classList.add('wide');   // a select standing alone in a panel spans it
 const arrow=d=>{const a=document.createElement('i');a.className='vsA'+(d>0?' r':'');
  a.addEventListener('mousedown',e=>{e.preventDefault();vselStep(sel,d);});
  return a;};
 sel.parentNode.insertBefore(w,sel);w.append(arrow(-1),sel,arrow(1));
 sel.addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();vselStep(sel,1);});
 new MutationObserver(()=>vselSync(sel)).observe(sel,{childList:true,subtree:true,attributes:true});
 vselSync(sel);
}
function vselInit(){for(const s of document.querySelectorAll('.screen select'))vselWrap(s);}
vselInit();
