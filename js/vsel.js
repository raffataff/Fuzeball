'use strict';
/* ===== value selectors — ◀ VALUE ▶ in place of a browser dropdown =====
   Every <select> on a menu screen is wrapped at boot: an arrow either side, the select itself in
   the middle showing its value. The SELECT STAYS THE SOURCE OF TRUTH — everything that reads
   .value, sets it, listens for change or rebuilds its options (setSkin, setRoom…) is untouched,
   and the wrapper only ever steps selectedIndex and fires input + change like a user would.
   Mouse: an arrow steps that way, a click on the value steps forward (its mousedown is eaten, so
   the browser's own list never opens). Keyboard focus keeps the native arrow keys.
   Pad (js/padnav.js): the cursor lands on the select; A opens it, ◀▶ cycle, A keeps, B puts back.
   ◀▶ on a CLOSED selector still move to the next panel, the same rule as a slider.
   Steps WRAP (last → first): a selector is a carousel, not a range. Disabled/hidden options are
   skipped. Only selects inside a .screen are wrapped; dev panels keep plain dropdowns. */
function vselStep(sel,d){
 const o=sel.options,n=o.length;if(!n)return false;let i=sel.selectedIndex;
 for(let k=0;k<n;k++){i=(i+d+n)%n;if(!o[i].disabled&&!o[i].hidden)break;}
 if(i===sel.selectedIndex||o[i].disabled||o[i].hidden)return false;
 sel.selectedIndex=i;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));
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
