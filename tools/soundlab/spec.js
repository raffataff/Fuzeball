// What the Foosball Sound Lab renders for each game sound: its take kind (the lab's src/audio/takes.js), speed in lab units, takes and level.
// Speeds come from CONFIG (a loop part's speed line, a hit's pRef) so a retune follows: 1 u = 1 cm, game motion played TIME x faster (sqrt(981 / physics.grav)).
// by = the venue a sound follows (sounds.<id>.by in CONFIG; balls = the ball-type variant every id already has); a venue's take file is <id>_<venueId>, the base venue's is <id>
'use strict';

// the venue a fresh save starts on: its sounds are the base files
const BASE={tables:'classic',pitches:'pub_classic',balls:'classic'};
// LKFS (ungated) per loop id, matched to the takes the CONFIG vols were set against
const LOUD={ball_roll_slow:-24.8,ball_roll_fast:-23.7,ball_scrape:-22.8,rod_slide_slow:-23.0,rod_slide_fast:-20.9,rod_spin:-24.2};
const HIT_PEAK=-3;   // dBFS of the loudest base take (re-rolls and louder venues keep 2 dB before the ceiling)
// hits: at = share of the sound's pRef the takes are struck at (v = lab m/s for a sound with no pRef), takes = how many
const HITS={
 ball_kick:     {kind:'kick', at:0.45,takes:6, name:'Kick',            group:'Ball'},
 ball_kick_hard:{kind:'kick', at:0.9, takes:4, name:'Kick, hard',      group:'Ball', of:'ball_kick'},
 ball_wall:     {kind:'wall', at:0.6, takes:6, name:'Wall hit',        group:'Ball'},
 ball_floor:    {kind:'floor',at:0.6, takes:5, name:'Floor bounce',    group:'Ball'},
 ball_post:     {kind:'post', at:0.7, takes:4, name:'Post',            group:'Ball'},
 ball_goal:     {kind:'goal', v:1.5,  takes:3, name:'Goal and return', group:'Ball'},
 ball_drop:     {kind:'drop', v:1.0,  takes:3, name:'Serve drop',      group:'Ball'},
 rod_bump:      {kind:'bump', at:1,   takes:4, name:'Rod bump',        group:'Rods'}
};
const LOOPS={
 ball_roll_slow:{kind:'roll',  len:4,name:'Roll, slow',  group:'Ball'},
 ball_roll_fast:{kind:'roll',  len:4,name:'Roll, fast',  group:'Ball'},
 ball_scrape:   {kind:'scrape',len:3,name:'Wall scrape', group:'Ball'},
 rod_slide_slow:{kind:'slide', len:3,name:'Slide, slow', group:'Rods'},
 rod_slide_fast:{kind:'slide', len:3,name:'Slide, fast', group:'Rods'},
 rod_spin:      {kind:'spin',  len:3,name:'Spin',        group:'Rods'}
};
const BY={pitch:'pitches',table:'tables'};

// every renderable sound, in panel order; C = the live CONFIG
function specs(C){
 const S=C.audioMix.sounds,L=C.audioMix.loops,TIME=Math.sqrt(981/C.physics.grav),out=[];
 for(const id in HITS){const H=HITS[id],D=S[H.of||id]||{},u=H.at!=null&&D.pRef?H.at*D.pRef:null;
  out.push({id,name:H.name,group:H.group,kind:H.kind,by:id==='ball_kick'?'balls':BY[D.by]||null,
   v:u!=null?u*TIME/100:H.v,game:u!=null?Math.round(u)+' u/s':null,takes:H.takes,peak:HIT_PEAK,spread:0.15});}
 for(const id in LOOPS){const P=L[Object.keys(L).find(k=>L[k]&&L[k].ids&&L[k].ids.includes(id))],T=LOOPS[id],i=P.ids.indexOf(id),r=P.rate;
  // a two-id part renders each at its `at`, divided by the playback rate it gets there; a one-id part where its rate is 1
  const u=P.ids.length>1?P.at[i]:Math.min(1,Math.max(0,(1-r[0])/(r[1]-r[0]))),rt=r[0]+(r[1]-r[0])*u,g=P.vMin+u*(P.vRef-P.vMin);
  out.push({id,name:T.name,group:T.group,kind:T.kind,by:BY[(S[id]||{}).by]||null,v:g*TIME/rt/(T.kind==='spin'?1:100),
   game:Math.round(g)+(T.kind==='spin'?' rad/s':' u/s'),len:T.len,takes:2,loud:LOUD[id]});}
 out.push({id:'ir',name:'Room reverb',group:'Room',kind:'ir',by:'rooms',takes:1});
 return out;
}

// the venues a game has, for the panel's pickers
function venues(C){const L=o=>Object.keys(o).map(id=>({id,name:o[id].name||id}));
 return {tables:L(C.tables),pitches:L(C.pitches),rooms:L(C.rooms),balls:L(C.ballTypes).map(b=>({id:b.id,name:b.name[0]+b.name.slice(1).toLowerCase()}))};}

// the take file id of a sound at a venue: the base venue plays <id>, any other <id>_<venueId>, a room's reverb ir_<roomId>
function fileId(sp,venue){if(sp.kind==='ir')return venue?'ir_'+venue:null;return !venue||!sp.by||BASE[sp.by]===venue?sp.id:sp.id+'_'+venue;}

module.exports={BASE,specs,venues,fileId};
