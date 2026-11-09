'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/arena.js','utf8');let a=src.indexOf('function selectSkin('),p=src.indexOf('{',a),d=1,i=p+1;while(d){if(src[i]==='{')d++;if(src[i]==='}')d--;i++;}
let pending={},pitchUI={value:''},calls=0;
const c={cfg:{skins:{},pitch:'royal'},CONFIG:{tables:{arena:{skins:{heliosRunners:{pitch:'helios_runners'},standard:{}}}},pitches:{helios_runners:{}}},document:{getElementById:()=>pitchUI},drawField:cb=>pending.pitch=cb,loadSkin:(id,skin,cb)=>pending.skin=cb,ensureTableRods:(id,cb)=>pending.rods=cb,applySkin(){},pruneSkins(){},reskinRods(){},saveCfg(){}};c.activeTable=c.CONFIG.tables.arena;
vm.createContext(c);vm.runInContext(src.slice(a,i),c);c.selectSkin('arena','heliosRunners',()=>calls++);
assert.equal(c.cfg.pitch,'helios_runners');assert.equal(pitchUI.value,'helios_runners');pending.skin();pending.rods();assert.equal(calls,0);pending.pitch();assert.equal(calls,1);
console.log('Helios selection applies the matching pitch and waits for skin, rods and pitch.');
