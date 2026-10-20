// director-mine: scout many seeded takes (a fresh page each) and list the moments worth shooting
//   node tools/director-mine.js --seeds=1-20 --secs=240 --set="{\"room\":\"arcade\",\"diffRed\":\"legend\",\"diffBlue\":\"legend\"}" [--tag=arc] [--size=1920x1080]
// takes are named <tag><seed>; tools/build/director/mine_<tag>.json collects every goal and big moment, best first
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const flags={};for(const a of process.argv.slice(2)){const m=a.match(/^--([^=]+)=?(.*)$/);if(m)flags[m[1]]=m[2]===''?true:m[2];}
const [s0,s1]=String(flags.seeds||'1-10').split('-').map(Number),secs=+(flags.secs||240),tag=flags.tag||'s',size=flags.size||'1920x1080';
const set=flags.set?JSON.parse(flags.set):{};
// rough worth of a goal by how it went in; the editor still decides
const KIND={curler:9,screamer:8,topBins:8,longRange:7,woodwork:7,deflected:4,default:3,scrappy:2,ownGoal:1,'':3};
const out=[];
for(let s=s0;s<=(s1||s0);s++){
 const take=tag+s,expr='dirScout('+JSON.stringify({take,seed:s,secs,set})+')';
 const r=spawnSync(process.execPath,[path.join(__dirname,'page-run.js'),'--size='+size,path.join(__dirname,'director.js'),expr],{encoding:'utf8',maxBuffer:64<<20});
 if(r.status!==0){console.error(take+' failed: '+(r.stderr||'').split('\n').slice(-3).join(' '));continue;}
 const res=JSON.parse(r.stdout.trim().split('\n').pop());
 const sc=JSON.parse(fs.readFileSync(path.join(__dirname,'build','director',take,'scout.json'),'utf8'));
 const ev=sc.ev;
 for(const g of ev.filter(e=>e.type==='goal')){
  const near=ev.filter(e=>e.t>g.t-4&&e.t<=g.t);
  const tt=near.some(e=>e.type==='ai'&&e.what==='ttShot'),ph=near.some(e=>e.type==='powerHit'),pin=near.some(e=>e.type==='ai'&&e.what==='shot');
  out.push({take,t:g.t,team:g.team,kind:g.kind||'',v:g.v,tt,ph,pin,score:(KIND[g.kind]||3)+(g.v>90?2:0)+(tt?3:0)+(ph?2:0)+(pin?1:0)});
 }
 for(const e of ev.filter(e=>e.type==='cannon'||e.type==='frost'||(e.type==='notice'&&/SAVE|LINE|POST|BAR/.test(e.text))))
  out.push({take,t:e.t,type:e.type==='notice'?e.text:e.type,score:e.type==='notice'?4:3});
 console.log(take+'  '+res.secs+'s  '+res.score.join('-')+'  goals '+res.goals.map(g=>g.kind+'@'+g.t.toFixed(1)).join(', ')+'  ('+res.wall+'s)');
}
out.sort((a,b)=>b.score-a.score);
fs.writeFileSync(path.join(__dirname,'build','director','mine_'+tag+'.json'),JSON.stringify({set,secs,moments:out},null,1));
console.log('\nbest:');for(const m of out.slice(0,25))console.log(' '+m.score+'  '+m.take+' @'+m.t.toFixed(2)+'  '+(m.kind!=null?('goal '+m.kind+' '+m.v+' u/s'+(m.tt?' tic-tac':'')+(m.ph?' power':'')+(m.pin?' pin':'')):m.type));
