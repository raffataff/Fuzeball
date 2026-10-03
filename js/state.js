'use strict';
/* ================= game state ================= */
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 suddenDeath:false,clockBeep:0, // suddenDeath: ran level to time-up, next goal wins; clockBeep: last second warned
 pendingWin:null,  // winning team parked while its goal celebration and replay play out (flow.js finishPendingWin)
 // seats: live seat objects built at kickoff (js/seats.js), empty = nobody playing; userTeam is the primary seat's team, not a stand-in for per-seat state
 // roster: the Kick Off lobby's seat specs ({team,devs,lockRole}), kept so a rematch keeps the line-up
 roster:[],seats:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,prePause:'play',
 // serveAt: world-x the rally ended at, so a restart after the ball left play comes back in that third; null = plain kickoff (centre); serve() consumes it
 serveAt:null,
 // seeded sim rng (js/rng.js): seed = this match's seed (quote it to reproduce a run); seedNext = a seed for the next match (a trial, the daily), consumed by startMatchNow; null = wall clock
 seed:0,seedNext:null,
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 stats:null,pu:{obj:null,timer:10,type:null,spin:0},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
  fromScreen:'home', // screen the live match was launched from: gotoMenu returns there
  rodLockRole:null,teamStats:null,lg:null,trn:null,trial:null,photo:null,redit:null,frac:[],swirl:[]}; // teamStats: per-team stat builds (stats.js) · lg: league bridge · trn: training bridge · photo: photo mode (F1) · redit: room editor (F2) · frac / swirl: live fracture and respawn-swirl instances; null = off, and other files gate on these only
// the match ledger: written by js/matchstats.js (saves and woodwork by js/moments.js), read by the post-match sheet; arrays are [team0,team1]; `terr` is by pitch third in world-x order; `rods` is keyed 'team|role' (built by msRod)
function freshStats(){return{
 kicks:[0,0],poss:[0,0],topSpeed:0,saves:[0,0],woodwork:[0,0],
 shots:[0,0],onTarget:[0,0],passes:[0,0],hardest:[0,0],dist:[0,0],
 terr:new Array(MSTAT.thirds).fill(0),
 rally:0,longRally:0,
 scorers:[],   // {team,role,own,t} in the order they went in (the scorers strip, later a top-scorer table)
 rods:{}       // 'team|role' -> {team,role,goals,og,shots,onTarget,kicks,saves,passes,dist}
};}
// commentary, not narration: lines a pundit would shout ('THE CROWD ERUPTS' describes the scene, not the shot); the default pool, keyed pools in CONFIG.moments.lines
const HYPE=['WHAT A STRIKE','TOP BINS','SCREAMER','CLINICAL','NO CHANCE','BURIED IT'];
