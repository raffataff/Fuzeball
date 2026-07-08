'use strict';
/* ================= FUZEBALL — global helpers ================= */
const $=i=>document.getElementById(i);
const clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t, rand=(a,b)=>a+Math.random()*(b-a);
