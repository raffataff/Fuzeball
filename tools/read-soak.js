// Holder-read / strike-reaction soak: whole AI matches per cell, goals per team, the read's own tallies (RDS) summed over matches.
//      node tools/page-run.js tools/read-soak.js "rdCells({seeds:48,diff:'pro'})"
//      rdCells({seeds,secs,diff,diffB,cells:{name:{'ai.read.on':[true,false]}}})   // each cell runs pkSoak (plainkick-soak.js) with that CONFIG set, same seeds
//      a duel cell gives red one arm and blue the other; run it swapped too (side bias), e.g. cells 'readR' and 'readB'
'use strict';
(function(){
 const s=document.createElement('script');s.src='tools/plainkick-soak.js';document.head.appendChild(s);
 const SUM={};
 if(!window.__rd_rr0)window.__rd_rr0=readReset;
 window.readReset=function(){for(const k in RDS)SUM[k]=(SUM[k]||0)+RDS[k];return __rd_rr0.apply(this,arguments);};
 const CELLS={
  off:{'ai.jolt.on':false,'ai.read.on':false},     // as before this work
  jolt:{'ai.jolt.on':true,'ai.read.on':false},     // human reaction, no read
  on:{'ai.jolt.on':true,'ai.read.on':true},        // shipped
  readR:{'ai.jolt.on':true,'ai.read.on':[true,false]},
  readB:{'ai.jolt.on':true,'ai.read.on':[false,true]},
  joR:{'ai.read.jostle.on':[true,false]},           // jostle duel (read on both sides)
  joB:{'ai.read.jostle.on':[false,true]},
  rvR:{'ai.rodView.on':[true,false]},               // red sees blue's rods a reaction late
  rvB:{'ai.rodView.on':[false,true]}
 };
 window.rdCells=async function(o){
  o=Object.assign({seeds:48,secs:120,seed0:1,diff:'pro',diffB:null,cells:null},o||{});
  while(typeof pkSoak!=='function')await new Promise(r=>setTimeout(r,20));
  const cells=o.cells||CELLS,out={};
  const keep=[cfg.diffRed,cfg.diffBlue];
  for(const name in cells){
   __rd_rr0();for(const k in SUM)delete SUM[k];
   cfg.diffRed=o.diff;cfg.diffBlue=o.diffB||o.diff;
   const r=pkSoak({seeds:o.seeds,secs:o.secs,seed0:o.seed0,diff:o.diffB?null:o.diff,set:cells[name]});
   for(const k in RDS)SUM[k]=(SUM[k]||0)+RDS[k];
   const pm={};for(const k in SUM)pm[k]=+(SUM[k]/r.matches).toFixed(2);
   out[name]={goalsTeam:r.goalsTeam,goals:r.goals,dead:r.dead,read:pm};
  }
  cfg.diffRed=keep[0];cfg.diffBlue=keep[1];
  return out;
 };
})();
