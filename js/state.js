'use strict';
/* ================= game state ================= */
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 suddenDeath:false,clockBeep:0, // suddenDeath: match ran level to time-up, next goal wins · clockBeep: last integer second warned (final-seconds tick, hud/flow)
 ctrl:0,ctrlRods:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,prePause:'play',
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 tcMult:1, // live slide-speed multiplier written each frame by gamepadUpdate (1 unless 'Total Control' pad mode)
 stats:null,pu:{obj:null,timer:10,type:null},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
  rodLockRole:null,teamStats:null,lg:null,trn:null,frac:[],swirl:[]}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js) · trn: live training-mode bridge (training.js; null = off) · frac: live cannonball-fracture instances (fracture.js) · swirl: live respawn-swirl instances (fracture.js)
function freshStats(){return{kicks:[0,0],poss:[0,0],topSpeed:0};}
const HYPE=['WHAT A STRIKE','UNSTOPPABLE','TOP BINS','SCREAMER','CLINICAL FINISH','THE CROWD ERUPTS'];
