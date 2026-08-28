'use strict';
/* ============================================================================================
   savesplit-harness.js — assert cfg persists as PLAYER + MACHINE and never blends the two.

     node tools/savesplit-harness.js        (from the project root or from tools/)

   WHY THIS EXISTS. cfg is one live object but two saved blobs (see the PLAYER/MACHINE block in
   js/config.js). The failure this guards against is silent and remote: a MACHINE key leaking
   into the PLAYER blob, which Steam Cloud then carries to another machine — a desktop's
   renderScale:1 / shadows:true landing on a Steam Deck. Nothing in the game would report that;
   the player just finds their settings "reset themselves" and the handheld running at 20fps.

   It boots js/core.js + js/config.js for real, in a fresh V8 context per scenario, against a
   fake localStorage. No DOM, no three.js, no deps.

   Exit 0 = pass, 1 = fail.
   ========================================================================================== */
const fs=require('fs'),path=require('path'),vm=require('vm');

const ROOT=fs.existsSync(path.join(process.cwd(),'index.html'))
 ?process.cwd():path.resolve(process.cwd(),'..');
const SRC=['js/core.js','js/config.js']
 .map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n;\n')
 // Top-level let/const are script-scoped, so publish the handful of names the tests drive.
 +'\n;globalThis.__T={get cfg(){return cfg},saveCfg,cfgSplit,cfgSyncKeys,CFG_KEY,CFG_MACHINE,CFG_PLAYER};';

let pass=0;const fails=[];
function ok(cond,msg){if(cond)pass++;else fails.push(msg);}
function eq(a,b,msg){ok(a===b,msg+'  (got '+JSON.stringify(a)+', want '+JSON.stringify(b)+')');}
function section(t){console.log('\n── '+t);}

/* A fresh boot against a given starting localStorage. Returns {T,store,warns}. */
function boot(seed){
 const store=Object.assign({},seed||{}),warns=[];
 const ls={getItem:k=>(k in store?store[k]:null),
           setItem:(k,v)=>{store[k]=String(v);},
           removeItem:k=>{delete store[k];},
           key:i=>Object.keys(store)[i],
           get length(){return Object.keys(store).length;}};
 const ctx={localStorage:ls,JSON,Math,Date,Object,Array,Set,Map,String,Number,Boolean,
            parseInt,parseFloat,isNaN,isFinite,RegExp,Error,
            console:Object.assign({},console,{warn:m=>warns.push(String(m))})};
 ctx.globalThis=ctx;ctx.window=ctx;ctx.self=ctx;
 ctx.document={getElementById:()=>null,querySelector:()=>null,
  createElement:()=>({style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}}}),
  body:{appendChild(){}},documentElement:{style:{setProperty(){}}}};
 vm.createContext(ctx);
 vm.runInContext(SRC,ctx,{filename:'fuzeball-cfg'});
 return {T:ctx.__T,ctx,store,warns,
         player:()=>JSON.parse(store['fuzeball_player']||'null'),
         machine:()=>JSON.parse(store['fuzeball_machine']||'null')};
}

/* ---- 1. fresh install ------------------------------------------------------------------ */
section('1 · fresh install writes two blobs and no legacy key');
{
 const b=boot({});
 b.T.saveCfg();
 ok(!!b.player(),'no fuzeball_player written on a fresh save');
 ok(!!b.machine(),'no fuzeball_machine written on a fresh save');
 ok(!('fuzeball' in b.store),'saveCfg still writes the legacy "fuzeball" key');
 eq(b.warns.length,0,'a fresh cfg produced orphan-key warnings: '+b.warns.join(' | '));
 console.log('   player '+Object.keys(b.player()).length+' keys · machine '+Object.keys(b.machine()).length+' keys');
}

/* ---- 2. every key is in exactly one blob ----------------------------------------------- */
section('2 · every cfg key lands in exactly one blob');
{
 const b=boot({});b.T.saveCfg();
 const p=b.player(),m=b.machine(),cfg=b.T.cfg;
 const both=Object.keys(p).filter(k=>k in m);
 ok(both.length===0,'keys written to BOTH blobs: '+both.join(', '));
 const missing=Object.keys(cfg).filter(k=>!(k in p)&&!(k in m));
 ok(missing.length===0,'cfg keys written to NEITHER blob: '+missing.join(', '));
 console.log('   '+Object.keys(cfg).length+' cfg keys, 0 duplicated, 0 dropped');
}

/* ---- 3. THE STEAM DECK BUG — no machine key may ride in the player blob ----------------- */
section('3 · no machine setting can reach another computer');
{
 const b=boot({});b.T.saveCfg();
 const p=b.player();
 const leaked=[...b.T.CFG_MACHINE].filter(k=>k in p);
 ok(leaked.length===0,
   'MACHINE keys found in the SYNCED player blob: '+leaked.join(', ')+
   ' — these would be carried to the player\'s other machines by Steam Cloud');
 const m=b.machine();
 const stranded=[...b.T.CFG_MACHINE].filter(k=>(k in b.T.cfg)&&!(k in m));
 ok(stranded.length===0,'MACHINE keys missing from the machine blob: '+stranded.join(', '));
 console.log('   '+[...b.T.CFG_MACHINE].length+' machine keys, 0 leaked into the synced blob');
 console.log('   held local: '+Object.keys(m).sort().join(', '));
}

/* ---- 4. legacy migration ---------------------------------------------------------------- */
section('4 · a pre-split save migrates without losing anything');
{
 const legacy={redName:'JONN FC',blueName:'RIVALS',diffRed:'legend',goals:7,
               renderScale:0.6,shadows:false,fpsCap:60,gfxPreset:'low',
               layouts:{menu:{p:{}}},trials:{snap:{best:3.21,medal:'gold'}}};
 const b=boot({fuzeball:JSON.stringify(legacy)});
 eq(b.T.cfg.redName,'JONN FC','legacy team name lost on migration');
 eq(b.T.cfg.renderScale,0.6,'legacy renderScale lost on migration');
 eq(b.T.cfg.trials.snap.medal,'gold','legacy trial record lost on migration');
 b.T.saveCfg();
 const p=b.player(),m=b.machine();
 eq(p.redName,'JONN FC','team name did not land in the player blob');
 eq(p.trials.snap.best,3.21,'trial record did not land in the player blob');
 eq(m.renderScale,0.6,'renderScale did not land in the machine blob');
 eq(m.gfxPreset,'low','gfxPreset did not land in the machine blob');
 ok(!('renderScale' in p),'renderScale leaked into the player blob during migration');
 ok(!('layouts' in p),'layouts leaked into the player blob during migration');
 ok('fuzeball' in b.store,'the legacy key was deleted — it is meant to survive as a backup');
 console.log('   migrated, legacy key preserved as a backup');
}

/* ---- 5. this computer's value wins on load ---------------------------------------------- */
section('5 · machine blob overrides a stale copy in the player blob');
{
 const b=boot({fuzeball_player:JSON.stringify({redName:'A',renderScale:0.4,shadows:false}),
               fuzeball_machine:JSON.stringify({renderScale:1,shadows:true})});
 eq(b.T.cfg.renderScale,1,'a stale renderScale in the player blob beat the machine blob');
 eq(b.T.cfg.shadows,true,'a stale shadows in the player blob beat the machine blob');
 eq(b.T.cfg.redName,'A','player value lost when the machine blob loaded over it');
 b.T.saveCfg();
 ok(!('renderScale' in b.player()),'the stale machine key was not cleaned out of the player blob on re-save');
 console.log('   machine wins, and the stale copy is dropped on the next save');
}

/* ---- 6. round trip ---------------------------------------------------------------------- */
section('6 · settings survive a reboot');
{
 const b=boot({});
 b.T.cfg.redName='ROUNDTRIP';b.T.cfg.renderScale=0.75;b.T.cfg.goals=9;
 b.T.saveCfg();
 const b2=boot(b.store);
 eq(b2.T.cfg.redName,'ROUNDTRIP','player value did not survive a reboot');
 eq(b2.T.cfg.renderScale,0.75,'machine value did not survive a reboot');
 eq(b2.T.cfg.goals,9,'match rule did not survive a reboot');
 console.log('   player + machine values both restored');
}

/* ---- 7. the Cloud manifest --------------------------------------------------------------- */
section('7 · cfgSyncKeys() lists what follows the player, and nothing else');
{
 const b=boot({fuzeball_league_0:'{}',fuzeball_league_2:'{}',fuzeball_league_slot:'2'});
 b.T.saveCfg();
 const keys=b.T.cfgSyncKeys();
 ok(keys.includes('fuzeball_player'),'the player blob is not in the Cloud manifest');
 ok(!keys.includes('fuzeball_machine'),'THE MACHINE BLOB IS IN THE CLOUD MANIFEST — that is the whole bug this split exists to prevent');
 ok(!keys.includes('fuzeball'),'the legacy backup blob is in the Cloud manifest');
 ok(keys.includes('fuzeball_league_0')&&keys.includes('fuzeball_league_2'),'league slots missing from the Cloud manifest');
 ok(keys.includes('fuzeball_league_slot'),'the last-played league slot is missing from the Cloud manifest');
 console.log('   syncs: '+keys.join(', '));
}

/* ---- 8. venue parking still works ------------------------------------------------------- */
section('8 · a parked league/trial venue is still substituted before the split');
{
 const b=boot({});
 b.ctx.lgVenueHeld=()=>({table:'arena',room:'neon',pitch:'cyatron',skins:{arena:'x'}});
 b.T.cfg.table='classic';
 b.T.saveCfg();
 eq(b.player().table,'arena','the parked venue table was not written');
 eq(b.T.cfg.table,'classic','saveCfg mutated the live cfg instead of substituting a copy');
 ok(!('table' in b.machine()),'table is a PLAYER key but landed in the machine blob');
 console.log('   parked venue written, live cfg untouched');
}

/* ---- 9. an unclassified key is reported ------------------------------------------------- */
section('9 · a key in neither set is defaulted to PLAYER and reported once');
{
 const b=boot({});
 b.T.cfg.someNewKnob=1;
 b.T.saveCfg();
 ok('someNewKnob' in b.player(),'an unclassified key was not defaulted to the player blob');
 ok(b.warns.length===1&&/someNewKnob/.test(b.warns[0]),'an unclassified key was not reported to the console');
 b.T.saveCfg();b.T.saveCfg();
 eq(b.warns.length,1,'the unclassified-key warning repeats on every save (should fire once per key)');
 console.log('   reported once: '+(b.warns[0]||'').slice(0,96)+'…');
}

/* ---- summary ----------------------------------------------------------------------------- */
console.log('\n'+'─'.repeat(78));
if(fails.length){
 console.log('FAIL — '+pass+' assertions passed, '+fails.length+' failed:\n');
 fails.forEach((f,i)=>console.log('  '+(i+1)+'. '+f));
 console.log('');process.exit(1);
}
console.log('PASS — '+pass+' assertions. cfg splits cleanly; no machine setting can sync.\n');
