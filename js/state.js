'use strict';
/* ================= game state ================= */
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 suddenDeath:false,clockBeep:0, // suddenDeath: match ran level to time-up, next goal wins · clockBeep: last integer second warned (final-seconds tick, hud/flow)
 pendingWin:null,  // winning team parked while its goal celebration + instant replay play out; the win screen opens when that finishes (flow.js finishPendingWin)
 // seats: every human at the table (js/seats.js) — team + claimed devices + the rod they hold.
 // Empty = nobody playing (AI showdown). userTeam is the PRIMARY seat's team and drives the
 // camera/HUD tint + the "is a human involved" guards; it is NOT a stand-in for per-seat state.
 // roster: the Kick Off lobby's seat SPECS ({team,devs,lockRole}) — survives the match so a
 // rematch keeps the same line-up. seats: the live seat objects built from it at kickoff.
 roster:[],seats:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,prePause:'play',
 // serveAt: world-x the rally ENDED at, parked for the next serve so a restart after the ball went
 // out of play (or was blown up) comes back in that same third — same anti-exploit as the dead-ball
 // re-drop. null = a plain kickoff, which always drops centre. serve() consumes and clears it.
 serveAt:null,
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 stats:null,pu:{obj:null,timer:10,type:null,spin:0},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
  fromScreen:'home', // screen the live match was launched from — gotoMenu returns THERE (Kick Off for a quick match, home for training)
  rodLockRole:null,teamStats:null,lg:null,trn:null,photo:null,redit:null,frac:[],swirl:[]}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js) · trn: live training-mode bridge (training.js; null = off) · photo: live photo-mode bridge (photo.js, F1; null = off — every other file gates on this and nothing else) · redit: live room-editor bridge (roomedit.js, F2; null = off, dev tool gated on CONFIG.debug.roomEditor) · frac: live cannonball-fracture instances (fracture.js) · swirl: live respawn-swirl instances (fracture.js)
// THE MATCH LEDGER. Written by js/matchstats.js (and, for saves/woodwork, by the moment
// detectors in js/moments.js — the same event, detected once). Read by the post-match sheet.
// Every array is [team0,team1]; `terr` is by pitch third in WORLD-X order (left..right), so
// terr[0] is the third team 0 defends. `rods` is keyed 'team|role' and built lazily by msRod.
function freshStats(){return{
 kicks:[0,0],poss:[0,0],topSpeed:0,saves:[0,0],woodwork:[0,0],
 shots:[0,0],onTarget:[0,0],passes:[0,0],hardest:[0,0],dist:[0,0],
 terr:new Array(MSTAT.thirds).fill(0),
 rally:0,longRally:0,
 scorers:[],   // {team,role,own,t} in the order they went in — the scorers strip, and later a league top-scorer table
 rods:{}       // 'team|role' -> {team,role,goals,og,shots,onTarget,kicks,saves,passes,dist}
};}
// Commentary, not narration — each line is something a pundit would actually shout. 'THE CROWD
// ERUPTS' described the scene rather than the shot, which is the tell to avoid when adding more.
// This is now the DEFAULT pool: a goal the classifier can't characterise reads exactly as every
// goal used to. The keyed pools live in CONFIG.moments.lines.
const HYPE=['WHAT A STRIKE','TOP BINS','SCREAMER','CLINICAL','NO CHANCE','BURIED IT'];
