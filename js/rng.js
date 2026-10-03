'use strict';
// ================= rng: seeded, per-consumer random streams =================
// what stopped a run being reproducible was a few random draws on the sim path (AI wander and aim, serve drop, foot jitter, knuckle flutter, dead-ball re-drop); Skill Trials and the daily need them pinned
// per-consumer streams, not one shared: on one stream every draw is positional, so any consumer's draw count shifts all later ones; each subsystem seeds hash(tag,seed), the AI one per rod (r.idx)
// cosmetic randomness (fx.js particles, audio.js detune, replay.js camera pick) stays on Math.random; RNG_TAGS registers what is seeded
// named slots, not a string lookup (RNG.jit is read per man per substep in collideRod); rngFor() handles a dynamic tag
// seeded per match by flow.js startMatchNow (S.seedNext, else the wall clock); CONFIG.rng.on:false hands every slot back to Math.random
// core, not optional: physics/ai/balls/powerups depend on it, not typeof-guarded
const RNGC=CONFIG.rng;
// every seeded consumer, one tag per subsystem ('jit' draws on every foot contact, 'knuck' a few times a rally, so sharing would tie them together)
const RNG_TAGS=['serve','type','jit','knuck','nan','pu','drop','line','shot'];
const RNG={seed:0,_ai:[],_x:new Map()};
// FNV-1a over the tag, folded with the seed, avalanched on the way out
// the avalanche only matters for short tags (too few FNV rounds to launder the seed; 'pu' drops to 0.267 against 1/3 uncorrelated without it); mulberry32 hides it for seeded streams, but the daily hashes consecutive date strings directly
// pinned by E4/E5 in tools/rng-harness.js, on a short tag
function rngHash(tag,seed){
 let h=Math.imul((seed>>>0)^0x9e3779b9,0x85ebca6b);
 for(let i=0;i<tag.length;i++){h=Math.imul(h^tag.charCodeAt(i),0x01000193);h=(h<<13)|(h>>>19);}
 h=Math.imul(h^(h>>>15),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);
 return (h^(h>>>16))>>>0;
}
// mulberry32, the same generator props.js scatters with: one PRNG in the codebase
function rngMake(s){let a=(s|0)||1;return function(){
 a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
 return((t^t>>>14)>>>0)/4294967296;};}
// re-seed every stream; clearing _ai/_x makes it a true reset (a cached stream is mid-sequence)
function rngSeed(s){
 RNG.seed=s>>>0;RNG._ai.length=0;RNG._x.clear();
 const on=!!RNGC.on;
 for(const t of RNG_TAGS)RNG[t]=on?rngMake(rngHash(t,RNG.seed)):Math.random;
 if(RNGC.log)console.log('[rng] seed '+RNG.seed+(on?'':' — OFF, using Math.random'));
 return RNG.seed;
}
// one stream per rod, keyed on r.idx (from buildRods); built lazily into a plain array
function rngAi(i){const f=RNG._ai[i];return f||(RNG._ai[i]=RNGC.on?rngMake(rngHash('ai#'+i,RNG.seed)):Math.random);}
// dynamic tags (a trial's own rolls); cached, so a tag continues its sequence
function rngFor(tag,idx){
 const k=idx===undefined?tag:tag+'#'+idx;
 let f=RNG._x.get(k);
 if(!f){f=RNGC.on?rngMake(rngHash(k,RNG.seed)):Math.random;RNG._x.set(k,f);}
 return f;
}
// shape helpers taking the stream rather than a tag: rngR is rand()'s shape, rngPick the array pick
function rngR(f,a,b){return a+f()*(b-a);}
function rngPick(f,a){return a[(f()*a.length)|0];}
rngSeed(Date.now());   // every slot is a live function from load, whatever order the first consumer runs in
