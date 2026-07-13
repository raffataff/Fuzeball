'use strict';
/* ================= game state ================= */
const S={phase:'menu',mode:'red',userTeam:0,score:[0,0],balls:[],time:0,matchTime:0,
 ctrl:0,ctrlRods:[],active:[[],[]],pairCd:[0,0],goalT:0,countT:0,lastCount:-1,timeScale:1,prePause:'play',
 eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],lastTouch:-1,lastSwitch:0,
 stats:null,pu:{obj:null,timer:10,type:null},shake:0,camMode:0,camLookX:0,freeRoam:false,camYaw:0,camPitch:0,
  rodLockRole:null,teamStats:null,lg:null,frac:[]}; // teamStats: per-team rod stat builds (stats.js) · lg: live league-match bridge (league.js) · frac: live cannonball-fracture instances (fracture.js)
function freshStats(){return{kicks:[0,0],poss:[0,0],topSpeed:0};}
const HYPE=['WHAT A STRIKE','UNSTOPPABLE','TOP BINS','SCREAMER','CLINICAL FINISH','THE CROWD ERUPTS'];
