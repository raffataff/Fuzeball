'use strict';
/* ================= rng — seeded, per-consumer random streams =================
   The sim was already frame-rate independent (fixed timestep, js/main.js); what stopped a run
   being REPRODUCIBLE was a handful of random draws on the sim path — the AI's wander error and
   aim roll above all, plus the serve drop, the foot jitter, the knuckle flutter and the
   dead-ball re-drop. Those are what a Skill Trial (FEATURE-IDEAS 3.2) and the fixed-seed daily
   (3.3) need pinned: a challenge you cannot reproduce is a coin toss, not a challenge.

   THREE DECISIONS SHAPE THIS FILE, AND EACH IS THE REASON IT ISN'T JUST ONE SEEDED FUNCTION.

   · PER-CONSUMER STREAMS, NOT ONE SHARED STREAM. On a single stream every draw is POSITIONAL:
     change how often ANY consumer draws — retune a power-up timer, add one flutter — and every
     later consumer's numbers shift, silently invalidating every stored best in the game. Each
     subsystem gets its own stream seeded hash(tag,seed), so they cannot move each other. The AI
     goes further and takes one stream PER ROD (r.idx), because a trial that hides two rods must
     not shift the keeper's rolls.

   · COSMETIC RANDOMNESS IS DELIBERATELY LEFT ON Math.random — fx.js particles, audio.js detune,
     replay.js's camera pick. Seeding them buys nothing (they change no
     outcome) and costs the one thing that matters: a stream anybody can shift by editing a
     particle count. RNG_TAGS is therefore a REGISTRY of what is seeded rather than a
     convenience — a new consumer is a deliberate line in it.

   · NAMED SLOTS, NOT A STRING LOOKUP. RNG.jit is read inside collideRod, per man per substep,
     on exactly the slow frames that already bank up to 7 sim steps x 7 substeps. A key build
     plus a Map get there is the cost FEATURE-IDEAS warns about; a named property is as cheap as
     Math.random. rngFor() is the escape hatch for anything that needs a genuinely dynamic tag.

   Seeded once per match by flow.js startMatchNow: S.seedNext when something set one (a trial,
   tomorrow's daily), else the wall clock — so ordinary play stays exactly as varied as it has
   always been. CONFIG.rng.on:false hands every slot back to Math.random and restores the old
   behaviour byte-for-byte; it is read when a match SEEDS, so flip it and start a match.

   This is CORE, not an optional module: it loads immediately after config.js and physics/ai/
   balls/powerups hard-depend on it. It is deliberately NOT guarded like S.trn / S.photo — a
   missing rng.js is a missing sim, and a typeof guard would only hide that one line later. */
const RNGC=CONFIG.rng;
/* Every seeded consumer, one tag per subsystem. The split is not tidiness: 'jit' draws on every
   foot contact while 'knuck' draws a few times a rally, so sharing one stream would make a
   knuckleball's flutter depend on how many boots the ball had clipped on the way. */
const RNG_TAGS=['serve','type','jit','knuck','nan','pu','drop','line','shot'];
const RNG={seed:0,_ai:[],_x:new Map()};
/* FNV-1a over the tag, folded with the seed, avalanched on the way out.
   WHAT THE AVALANCHE IS FOR — measured, because the obvious answer is wrong twice over and the
   first cut of both this comment and its test asserted the wrong thing.
   · It does NOT decorrelate the TAGS. The FNV loop plus the rotate already does that: two tags
     one character apart ('pu'/'nan') come out at r = -0.02 across 4000 seeds with the avalanche
     REMOVED, indistinguishable from keeping it.
   · It does nothing measurable for a tag of 3+ characters either — 'serve' sits at 0.332 both
     ways, which is exactly how a test written against 'serve' passed a mutant with the avalanche
     stripped out and made it look like dead code.
   · WHAT IT ACTUALLY PROTECTS IS SHORT TAGS, and the mechanism is that every tag character is
     one FNV round: a 1-2 character tag never gets enough rounds to launder the seed, so the raw
     hash inherits the seed's own structure. Mean |hash(s)-hash(s-1)| normalised to [0,1) is 1/3
     when uncorrelated; drop the avalanche and 'pu' — a live tag — falls to 0.267 and a one-
     character tag to 0.170, half of uniform.
   mulberry32 launders all of that for anything seeded THROUGH it, so no stream in the game can
   tell the difference today. It is kept because rngHash is a general helper and the daily will
   hash consecutive DATE strings, where a raw 'hash % n' inherits the structure with no PRNG in
   the way. Pinned by E4/E5 in tools/rng-harness.js — and pinned on a SHORT tag, deliberately. */
function rngHash(tag,seed){
 let h=Math.imul((seed>>>0)^0x9e3779b9,0x85ebca6b);
 for(let i=0;i<tag.length;i++){h=Math.imul(h^tag.charCodeAt(i),0x01000193);h=(h<<13)|(h>>>19);}
 h=Math.imul(h^(h>>>15),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);
 return (h^(h>>>16))>>>0;
}
/* mulberry32 — the same generator props.js scatters with, deliberately: one PRNG in the codebase
   means one thing to reason about when a layout and a run have to agree. */
function rngMake(s){let a=(s|0)||1;return function(){
 a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
 return((t^t>>>14)>>>0)/4294967296;};}
/* Re-seed EVERY stream. Clearing _ai/_x is what makes this a true reset — a cached stream is
   mid-sequence, so leaving one behind would make the same seed produce a different run the
   second time it was used, which is the one failure this whole file exists to prevent. */
function rngSeed(s){
 RNG.seed=s>>>0;RNG._ai.length=0;RNG._x.clear();
 const on=!!RNGC.on;
 for(const t of RNG_TAGS)RNG[t]=on?rngMake(rngHash(t,RNG.seed)):Math.random;
 if(RNGC.log)console.log('[rng] seed '+RNG.seed+(on?'':' — OFF, using Math.random'));
 return RNG.seed;
}
/* One stream per ROD, keyed on r.idx (declared in buildRods, stable for the session). Built
   lazily into a plain array so a roll costs an index read and a rod that never rolls never
   allocates. */
function rngAi(i){const f=RNG._ai[i];return f||(RNG._ai[i]=RNGC.on?rngMake(rngHash('ai#'+i,RNG.seed)):Math.random);}
/* Dynamic tags, for a consumer that isn't a fixed subsystem (a trial's own rolls). Cached, so
   one tag always CONTINUES its sequence rather than restarting it on every call. */
function rngFor(tag,idx){
 const k=idx===undefined?tag:tag+'#'+idx;
 let f=RNG._x.get(k);
 if(!f){f=RNGC.on?rngMake(rngHash(k,RNG.seed)):Math.random;RNG._x.set(k,f);}
 return f;
}
/* Shape helpers taking the STREAM rather than a tag, so a site drawing twice does it off one
   lookup. rngR is rand()'s shape; rngPick is the array pick the sim path already used. */
function rngR(f,a,b){return a+f()*(b-a);}
function rngPick(f,a){return a[(f()*a.length)|0];}
rngSeed(Date.now());   // every slot is a live function from load, whatever order the first consumer runs in
