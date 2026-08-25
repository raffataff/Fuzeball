'use strict';
/* ================= rng harness =================
   Boots core.js + config.js + rng.js in ONE vm context (rng.js is self-contained, so nothing
   has to be string-sliced out of a bigger file) and asserts the properties the whole seeding
   scheme rests on. Run: node tools/rng-harness.js

   NOTE, and it cost a run the first time this pattern was used in this repo: top-level const
   is LEXICAL, not a property of the context, so `sandbox.RNG` reads back undefined and every
   assertion silently becomes a comparison against undefined that LOOKS like it passed. The
   API is handed out through an explicit globalThis.__api line appended to the source.

   The suite has TEETH: five mutations of rng.js are booted at the end and each must break at
   least one assertion. A harness that passes against a broken generator is worse than none,
   because it is the thing you will trust later instead of re-reading the code. */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
/* NEWLINES ARE NORMALISED ON READ, and this is load-bearing rather than tidy. A multi-line
   TEMPLATE LITERAL has its line terminators normalised to LF by the ECMAScript lexer itself
   (both CRLF and a bare CR become LF in the template's VALUE) — so a needle written as a
   template literal can NEVER match a CRLF source file, however this harness is itself saved.
   js/ has mixed endings (see the CRLF trap in CLAUDE.md) and js/rng.js is CRLF, which is
   exactly how the 'rngFor does not cache' mutation went stale: both files were CRLF, so
   everything LOOKED consistent, and the replace silently matched nothing while the harness
   went on reporting 4/5. Note the avalanche mutation survived only because it is a REGEX
   whose \s* happens to match the CR.
   Normalising here immunises every mutation, present and future. Safe both ways: the source
   is only string-matched and run in a vm, and newline style is semantically irrelevant. */
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

function boot(mutate){
 let rng=rd('js/rng.js');
 if(mutate)rng=mutate(rng);
 const src=rd('js/core.js')+'\n'+rd('js/config.js')+'\n'+rng+
  '\n;globalThis.__api={rngSeed,rngAi,rngFor,rngR,rngPick,rngHash,rngMake,RNG,RNG_TAGS,CONFIG};';
 const sb={console:{log(){}},Math,Date,JSON,Object,Array,Map,Set,
  localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:()=>null},
  navigator:{},addEventListener(){}};
 sb.globalThis=sb;
 vm.runInNewContext(src,sb,{filename:'rng-boot'});
 return sb.__api;
}

/* ---- assertion plumbing: a run collects named failures so a MUTANT can be checked for
        breaking specific ones rather than just "something went wrong". ---- */
function Run(){this.pass=0;this.failed=[];}
Run.prototype.ok=function(c,name,detail){
 if(c)this.pass++;else this.failed.push(name+(detail?'  ['+detail+']':''));
};
Run.prototype.eq=function(a,b,name){this.ok(a===b,name,'got '+a+', want '+b);};
Run.prototype.near=function(a,b,t,name){this.ok(Math.abs(a-b)<=t,name,'got '+a+', want '+b+'+-'+t);};

const seq=(f,n)=>{const o=[];for(let i=0;i<n;i++)o.push(f());return o;};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function corr(xs,ys){
 const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
 let sxy=0,sxx=0,syy=0;
 for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;sxy+=dx*dy;sxx+=dx*dx;syy+=dy*dy;}
 return sxy/Math.sqrt(sxx*syy);
}

function suite(A){
 const R=new Run();
 const {rngSeed,rngAi,rngFor,rngR,rngPick,rngMake,RNG,RNG_TAGS,CONFIG}=A;

 /* ---------- A. the generator itself ---------- */
 rngSeed(12345);
 const d=seq(RNG.serve,20000);
 R.ok(d.every(v=>v>=0&&v<1),'A1 every draw in [0,1)');
 R.near(d.reduce((a,b)=>a+b,0)/d.length,.5,.01,'A2 mean ~ 0.5 over 20k');
 R.ok(new Set(d).size>19900,'A3 draws are not degenerate','distinct='+new Set(d).size);
 // a generator seeded 0 must still run — mulberry32 dies on state 0, hence the ||1 guard
 R.ok(seq(rngMake(0),4).every(v=>v>=0&&v<1),'A4 rngMake(0) still generates');

 /* ---------- B. determinism ---------- */
 rngSeed(777);const b1=seq(RNG.jit,50);
 rngSeed(777);const b2=seq(RNG.jit,50);
 R.ok(same(b1,b2),'B1 same seed -> identical sequence');
 // RE-SEEDING MID-SEQUENCE MUST RESTART, not continue: rngSeed clears the cached streams.
 // Without that, replaying a trial at the same seed gives a different run the second time.
 rngSeed(777);seq(RNG.jit,17);rngSeed(777);
 R.ok(same(seq(RNG.jit,50),b1),'B2 re-seed mid-sequence restarts the stream');
 rngSeed(778);
 R.ok(!same(seq(RNG.jit,50),b1),'B3 different seed -> different sequence');
 R.eq(rngSeed(-1),4294967295,'B4 rngSeed coerces to uint32');
 R.eq(rngSeed(9),9,'B5 rngSeed returns the seed it applied');
 // a wall-clock seed (what ordinary play uses) must survive the >>>0
 rngSeed(1755000000000);
 R.ok(seq(RNG.serve,4).every(v=>v>=0&&v<1),'B6 wall-clock-scale seed works');

 /* ---------- C. stream independence — the core design claim ---------- */
 rngSeed(4242);
 const sA=seq(RNG.serve,30),sB=seq(RNG.drop,30);
 R.ok(!same(sA,sB),'C1 two tags at one seed differ');
 // INTERLEAVING MUST NOT MATTER. On one shared stream, drawing A,B,A,B gives A a different
 // sequence than drawing A,A,...,B,B — which is precisely how a retuned power-up timer would
 // silently change every AI roll after it.
 rngSeed(4242);
 const iA=[],iB=[];
 for(let i=0;i<30;i++){iA.push(RNG.serve());iB.push(RNG.drop());}
 R.ok(same(iA,sA)&&same(iB,sB),'C2 interleaving order does not shift either stream');
 // ...and neither does one stream being drawn from far MORE than the other.
 rngSeed(4242);seq(RNG.jit,5000);
 R.ok(same(seq(RNG.serve,30),sA),'C3 heavy draws on one stream do not shift another');
 // every declared tag is its own stream
 rngSeed(31337);
 const firsts=RNG_TAGS.map(t=>RNG[t]());
 R.eq(new Set(firsts).size,RNG_TAGS.length,'C4 all '+RNG_TAGS.length+' tags are distinct streams');

 /* ---------- D. per-rod AI streams ---------- */
 rngSeed(555);const rod5=seq(rngAi(5),40);
 rngSeed(555);seq(rngAi(0),200);seq(rngAi(1),200);seq(rngAi(3),90);
 R.ok(same(seq(rngAi(5),40),rod5),'D1 rod 5 unaffected by other rods drawing');
 rngSeed(555);
 R.ok(!same(seq(rngAi(4),40),rod5),'D2 different rods get different streams');
 // this is the property that makes a trial hiding rods safe
 rngSeed(555);const all8=[];for(let i=0;i<8;i++)all8.push(rngAi(i)());
 R.eq(new Set(all8).size,8,'D3 eight rods, eight distinct streams');

 /* ---------- E. tag correlation (the avalanche in rngHash) ---------- */
 // Two tags one character apart must not track each other across seeds. Without the final
 // mix in rngHash their first draws visibly correlate, which is the exact thing per-stream
 // seeding is supposed to remove — so this is tested across seeds, not within one.
 const xs=[],ys=[],zs=[];
 for(let s=1;s<=600;s++){rngSeed(s);xs.push(RNG.pu());ys.push(RNG.nan());zs.push(rngAi(0)());}
 R.ok(Math.abs(corr(xs,ys))<.15,'E1 pu/nan uncorrelated across seeds','r='+corr(xs,ys).toFixed(4));
 R.ok(Math.abs(corr(xs,zs))<.15,'E2 pu/ai#0 uncorrelated across seeds','r='+corr(xs,zs).toFixed(4));
 // consecutive seeds must not give near-identical first draws either
 const consec=[];for(let s=100;s<160;s++){rngSeed(s);consec.push(RNG.serve());}
 let tight=0;for(let i=1;i<consec.length;i++)if(Math.abs(consec[i]-consec[i-1])<.01)tight++;
 R.ok(tight<8,'E3 consecutive seeds do not produce near-identical draws','tight='+tight);
 // E4/E5 pin rngHash's output avalanche, and it took two measurements to find the property it
 // actually provides — the obvious one is wrong twice over. It does NOT decorrelate tags (E1/E2
 // pass with it removed), and it does nothing measurable for tags of 3+ characters. What it
 // protects is SHORT tags: every tag character is one FNV round, so a 1-2 character tag never
 // gets enough mixing to launder the seed and the raw hash inherits the seed's own structure.
 // Mean |hash(s)-hash(s-1)| normalised to [0,1) is 1/3 when uncorrelated. Drop the avalanche and
 // 'pu' — a LIVE tag — falls to 0.267, and a 1-character tag to 0.170, i.e. half of uniform.
 // Tested here rather than on 'serve' (5 chars, 0.332 either way), which is what let the first
 // cut of this assertion pass against the mutant and look like the avalanche was dead code.
 const hstep=t=>{let a=0,prev=A.rngHash(t,0)/4294967296;
  for(let s=1;s<=4000;s++){const h=A.rngHash(t,s)/4294967296;a+=Math.abs(h-prev);prev=h;}
  return a/4000;};
 R.near(hstep('x'),1/3,.04,'E4 raw rngHash uniform across adjacent seeds, 1-char tag');
 R.near(hstep('pu'),1/3,.04,'E5 raw rngHash uniform across adjacent seeds, 2-char tag');

 /* ---------- F. rngFor (dynamic tags) ---------- */
 rngSeed(66);
 const f1=rngFor('trial'),f2=rngFor('trial');
 R.ok(f1===f2,'F1 rngFor caches — one tag CONTINUES its sequence');
 rngSeed(66);const fa=seq(rngFor('trial'),10);
 rngSeed(66);const fb=seq(rngFor('trial'),10);
 R.ok(same(fa,fb),'F2 rngFor is deterministic per seed');
 rngSeed(66);
 R.ok(!same(seq(rngFor('other'),10),fa),'F3 rngFor tags are independent');
 rngSeed(66);const i0=seq(rngFor('t',0),10);
 rngSeed(66);
 R.ok(!same(seq(rngFor('t',1),10),i0),'F4 rngFor idx makes a distinct stream');

 /* ---------- G. shape helpers ---------- */
 rngSeed(90);
 const rs=seq(()=>rngR(RNG.serve,-5,5),3000);
 R.ok(rs.every(v=>v>=-5&&v<5),'G1 rngR stays in range (negative low bound)');
 R.near(rs.reduce((a,b)=>a+b,0)/rs.length,0,.2,'G2 rngR is centred');
 // rngR must consume EXACTLY one draw — two would make every call site's stream position
 // depend on whether it used the helper or called the stream directly.
 rngSeed(90);const raw=seq(RNG.drop,3);
 rngSeed(90);const viaR=[rngR(RNG.drop,0,1),rngR(RNG.drop,0,1),rngR(RNG.drop,0,1)];
 R.ok(same(raw,viaR),'G3 rngR consumes exactly one draw');
 rngSeed(91);
 const arr=['a','b','c'],counts={a:0,b:0,c:0};
 for(let i=0;i<60000;i++)counts[rngPick(RNG.pu,arr)]++;
 R.ok(arr.every(k=>Math.abs(counts[k]/60000-1/3)<.01),'G4 rngPick is unbiased',JSON.stringify(counts));
 R.ok(arr.every(k=>counts[k]>0),'G5 rngPick reaches every element');
 R.eq(rngPick(RNG.pu,['only']),'only','G6 rngPick on a 1-element array');
 rngSeed(92);const p1=seq(RNG.line,3);
 rngSeed(92);const p2=[0,0,0].map(()=>rngPick(RNG.line,[0,1,2,3,4,5,6,7,8,9]));
 R.ok(p2.every((v,i)=>v===Math.floor(p1[i]*10)),'G7 rngPick consumes exactly one draw');

 /* ---------- H. the off switch ---------- */
 // CONFIG.rng.on is read when a match SEEDS, so the switch is exercised the way the game
 // uses it: flip it, then seed.
 CONFIG.rng.on=false;rngSeed(1);
 R.eq(RNG.serve,Math.random,'H1 off: named slots fall back to Math.random');
 R.eq(rngAi(2),Math.random,'H2 off: rngAi falls back');
 R.eq(rngFor('z'),Math.random,'H3 off: rngFor falls back');
 rngSeed(1);const o1=seq(RNG.serve,20);
 rngSeed(1);
 R.ok(!same(seq(RNG.serve,20),o1),'H4 off: the same seed no longer reproduces');
 CONFIG.rng.on=true;rngSeed(1);const on1=seq(RNG.serve,20);
 rngSeed(1);
 R.ok(same(seq(RNG.serve,20),on1),'H5 back on: determinism returns');

 return R;
}

/* ================= main ================= */
const R=suite(boot());
console.log('rng-harness: '+R.pass+' passed, '+R.failed.length+' failed');
R.failed.forEach(f=>console.log('  FAIL  '+f));

/* ---- mutations: each must break at least one assertion ---- */
const MUTANTS=[
 ['single shared stream (all tags the same)',
  s=>s.replace('for(const t of RNG_TAGS)RNG[t]=on?rngMake(rngHash(t,RNG.seed)):Math.random;',
               'const one=on?rngMake(RNG.seed):Math.random;for(const t of RNG_TAGS)RNG[t]=one;')],
 ['rngSeed does not clear the cached streams',
  s=>s.replace('RNG.seed=s>>>0;RNG._ai.length=0;RNG._x.clear();','RNG.seed=s>>>0;')],
 ['rngHash drops the output avalanche',
  s=>s.replace(/ h=Math\.imul\(h\^\(h>>>15\),0x85ebca6b\);h=Math\.imul\(h\^\(h>>>13\),0xc2b2ae35\);\s*\n\s*return \(h\^\(h>>>16\)\)>>>0;/,
               '\n return h>>>0;')],
 ['rngAi ignores the rod index',
  s=>s.replace(`rngMake(rngHash('ai#'+i,RNG.seed))`,`rngMake(rngHash('ai',RNG.seed))`)],
 ['rngFor does not cache (restarts its tag every call)',
  s=>s.replace(` let f=RNG._x.get(k);
 if(!f){f=RNGC.on?rngMake(rngHash(k,RNG.seed)):Math.random;RNG._x.set(k,f);}
 return f;`,
               ` return RNGC.on?rngMake(rngHash(k,RNG.seed)):Math.random;`)]
];
console.log('\nmutation checks (each must FAIL something):');
let teeth=0;
for(const [name,mut] of MUTANTS){
 const src=rd('js/rng.js');
 if(mut(src)===src){console.log('  ??  '+name+' — MUTATION DID NOT APPLY (harness is stale)');continue;}
 let m;
 try{m=suite(boot(mut));}
 catch(e){console.log('  ok  '+name+' -> threw: '+e.message);teeth++;continue;}
 if(m.failed.length){console.log('  ok  '+name+' -> breaks '+m.failed.length+': '+m.failed.map(f=>f.split(' ')[0]).join(' '));teeth++;}
 else console.log('  NO TEETH  '+name+' -> suite still passed');
}
console.log('\n'+teeth+'/'+MUTANTS.length+' mutations caught');
process.exit(R.failed.length||teeth<MUTANTS.length?1:0);
