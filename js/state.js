'use strict';
/* ================= game state ================= */
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 suddenDeath:false,clockBeep:0, // suddenDeath: match ran level to time-up, next goal wins · clockBeep: last integer second warned (final-seconds tick, hud/flow)
 // seats: every human at the table (js/seats.js) — team + claimed devices + the rod they hold.
 // Empty = nobody playing (AI showdown). userTeam is the PRIMARY seat's team and drives the
 // camera/HUD tint + the "is a human involved" guards; it is NOT a stand-in for per-seat state.
 // roster: the Kick Off lobby's seat SPECS ({team,devs,lockRole}) — survives the match so a
 // rematch keeps the same line-up. seats: the live seat objects built from it at kickoff.
 roster:[],seats:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,prePause:'play',
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 stats:null,pu:{obj:null,timer:10,type:null,spin:0},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
  fromScreen:'home', // screen the live match was launched from — gotoMenu returns THERE (Kick Off for a quick match, home for training)
  rodLockRole:null,teamStats:null,lg:null,trn:null,frac:[],swirl:[]}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js) · trn: live training-mode bridge (training.js; null = off) · frac: live cannonball-fracture instances (fracture.js) · swirl: live respawn-swirl instances (fracture.js)
function freshStats(){return{kicks:[0,0],poss:[0,0],topSpeed:0};}
// Commentary, not narration — each line is something a pundit would actually shout. 'THE CROWD
// ERUPTS' described the scene rather than the shot, which is the tell to avoid when adding more.
const HYPE=['WHAT A STRIKE','TOP BINS','SCREAMER','CLINICAL','NO CHANCE','BURIED IT'];
