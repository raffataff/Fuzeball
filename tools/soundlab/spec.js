// What the Foosball Sound Lab renders for each game sound: its take kind (the lab's src/audio/takes.js), speed in lab units, takes and level.
// Speeds come from CONFIG (a loop part's speed line, a hit's pRef) so a retune follows: 1 u = 1 cm, game motion played TIME x faster (a fixed constant below).
// by = the venue a sound follows (sounds.<id>.by in CONFIG); ball = a ball contact that also follows the ball type (Au.play prefers <id>_<ballType> over the venue's); a venue's take file is <id>_<venueId>, the base venue's is <id>
'use strict';

// the venue a fresh save starts on: its sounds are the base files
const BASE={tables:'classic',pitches:'pub_classic',balls:'classic'};
const TIME=1.4757;   // game motion played this many times faster in the lab (sqrt(981/450), the committed grav); fixed, not tied to physics.grav
// every take at the lab's own level x this, no per-sound normalizing: the files keep the lab's balance and a quiet profile stays quiet (the lab's master trim is the same -3 dB)
const MIX_GAIN=-3;
// hits: struck at the sound's pAt (pAtHard for a hard set) x pRef in CONFIG, where the game plays a take at its lab level; v = lab m/s for a sound with no pRef; takes = how many, ball = a take per ball type too
const HITS={
 ball_kick:     {kind:'kick', takes:6, name:'Kick',            group:'Ball', ball:true},
 ball_kick_hard:{kind:'kick', takes:4, name:'Kick, hard',      group:'Ball', of:'ball_kick', hard:true, ball:true},
 ball_wall:     {kind:'wall', takes:6, name:'Wall hit',        group:'Ball', ball:true},
 ball_floor:    {kind:'floor',takes:5, name:'Floor bounce',    group:'Ball'},
 ball_post:     {kind:'post', takes:4, name:'Post',            group:'Ball', ball:true},
 ball_goal:     {kind:'goal', v:1.5, takes:3, name:'Goal and return', group:'Ball'},
 ball_drop:     {kind:'drop', v:1.0, takes:3, name:'Serve drop',      group:'Ball'},
 rod_bump:      {kind:'bump', takes:4, name:'Rod bump',        group:'Rods'}
};
// loops: one take per speed point (the next point stands in for a second take), two for the spin's single point
const LOOPS={
 ball_roll_crawl: {kind:'roll',  len:4,takes:1,name:'Roll, crawl',       group:'Ball'},
 ball_roll_slow:  {kind:'roll',  len:4,takes:1,name:'Roll, slow',        group:'Ball'},
 ball_roll_fast:  {kind:'roll',  len:4,takes:1,name:'Roll, fast',        group:'Ball'},
 ball_roll_rush:  {kind:'roll',  len:4,takes:1,name:'Roll, rush',        group:'Ball'},
 ball_scrape:     {kind:'scrape',len:3,takes:1,name:'Wall scrape, slow', group:'Ball'},
 ball_scrape_fast:{kind:'scrape',len:3,takes:1,name:'Wall scrape, fast', group:'Ball'},
 rod_slide_slow:  {kind:'slide', len:3,takes:1,name:'Slide, slow',       group:'Rods'},
 rod_slide_mid:   {kind:'slide', len:3,takes:1,name:'Slide, mid',        group:'Rods'},
 rod_slide_fast:  {kind:'slide', len:3,takes:1,name:'Slide, fast',       group:'Rods'},
 rod_spin:        {kind:'spin',  len:3,takes:2,name:'Spin',              group:'Rods'}
};
const BY={pitch:'pitches',table:'tables'};
// a room impulse keeps the lab's own level x the lab's default stem send (-14 dB, -3 dB for its centre pan), so the game plays it unnormalized and a send of 1 is the room as the lab mixes it
const IR_SEND=-17;

// every renderable sound, in panel order; C = the live CONFIG
function specs(C){
 const S=C.audioMix.sounds,L=C.audioMix.loops,out=[];
 for(const id in HITS){const H=HITS[id],D=S[H.of||id]||{},at=H.hard?D.pAtHard:D.pAt,u=at!=null&&D.pRef?at*D.pRef:null;
  out.push({id,name:H.name,group:H.group,kind:H.kind,by:BY[D.by]||null,ball:!!H.ball,
   v:u!=null?u*TIME/100:H.v,game:u!=null?Math.round(u)+' u/s':null,takes:H.takes,spread:0.15});}
 // each id at its `at` on the part's speed line, where the game plays it at rate 1 (audio.js auLpRate)
 for(const id in LOOPS){const P=L[Object.keys(L).find(k=>L[k]&&L[k].ids&&L[k].ids.includes(id))],T=LOOPS[id],g=P.vMin+(P.at[P.ids.indexOf(id)]??0)*(P.vRef-P.vMin);
  out.push({id,name:T.name,group:T.group,kind:T.kind,by:BY[(S[id]||{}).by]||null,v:g*TIME/(T.kind==='spin'?1:100),
   game:Math.round(g)+(T.kind==='spin'?' rad/s':' u/s'),len:T.len,takes:T.takes});}
 out.push({id:'ir',name:'Room reverb',group:'Room',kind:'ir',by:'rooms',takes:1});
 return out;
}

// the venues a game has, for the panel's pickers
function venues(C){const L=o=>Object.keys(o).map(id=>({id,name:o[id].name||id}));
 return {tables:L(C.tables),pitches:L(C.pitches),rooms:L(C.rooms),balls:L(C.ballTypes).map(b=>({id:b.id,name:b.name[0]+b.name.slice(1).toLowerCase()}))};}

// the take file id of a sound at a venue of a kind: the base venue plays <id>, any other <id>_<venueId>, a room's reverb ir_<roomId>
function fileId(sp,venue,kind){if(sp.kind==='ir')return venue?'ir_'+venue:null;kind=kind||sp.by;
 return !venue||!(sp.by===kind||(kind==='balls'&&sp.ball))||BASE[kind]===venue?sp.id:sp.id+'_'+venue;}

// a room's impulse at IR_SEND, rendered from the venue map (T = the lab's src/audio/takes.js, lab = {base, venues}); the lab's renderTakes sets it to the ceiling instead
function irTake(T,lab,room,seed){const ch=T.renderTake({kind:'ir'},T.venueParams(lab,'rooms',room),seed||1,0),g=Math.pow(10,IR_SEND/20);
 for(const c of ch)for(let i=0;i<c.length;i++)c[i]*=g;
 return {channels:ch,seconds:ch[0].length/T.TAKE_SR,peakDb:T.dbOf(T.peakOf(ch)),lkfs:null,limited:false,seam:null};}

module.exports={BASE,IR_SEND,MIX_GAIN,specs,venues,fileId,irTake};
