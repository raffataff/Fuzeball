// trailer-spec: the 30-second trailer, shot by shot, on the music's beats (read by tools/trailer-build.js)
// k = beat index on "Electronic The Future Is Now Cut 30" (112 BPM, first kick 0.024 s): a shot fills beats [k0,k1)
// takes are scouted AI matches (tools/build/director/<take>/scout.json); a look is the venue and figurines, visual only
'use strict';
const goalFx={blast:{k:{0:{size:0.45,pow:0.5},1:{size:0.75,pow:0.8},2:{size:0.5,pow:0.45}}},light:0.45};
const cannonFx={blast:{k:{0:{size:0.3,pow:0.4},1:{size:0.7,pow:0.7},2:{size:0.3,pow:0.3}}},light:0.4};
const shatterFx={blast:{k:{0:{size:0.3,pow:0.4},1:{size:0.6,pow:0.12},2:{size:0.3,pow:0.3}}},light:0.4,ballGlow:0.3};
const climaxFx={blast:{k:{0:{size:0.35,pow:0.45},1:{size:0.7,pow:0.8},2:{size:0.4,pow:0.4}}},light:0.4};
const ball=(o)=>Object.assign({ball:1},o||{});
module.exports={
 fps:60, ss:2, len:2136,
 music:{src:'C:/Users/Owner/Documents/Fuzeball files/assets/Electronic The Future Is Now Cut 30.wav',bpm:112,first:0.024},
 blur:{n:6,shutter:0.5},
 hq:{shadows:true,shadowQuality:'high',grass:'high',reflections:true,atmos:'high',particles:true,renderScale:1,rodHoles:false},
 looks:{
  hero:  {room:'arcade',skin:'wood',pitch:'royal',modelRed:'irnman',modelBlue:'animalAzlar'},
  climax:{room:'arcade',skin:'wood',pitch:'royal',modelRed:'animalAzlar',modelBlue:'irnman'},
  arcadeB:{room:'arcade',skin:'wood',pitch:'royal',modelRed:'alienGrimlot',modelBlue:'deltaborg'},
  saucer:{room:'saucer',skin:'premierLeague',pitch:'neon',modelRed:'mechaMan',modelBlue:'alienTamirok'},
  moon:  {room:'moon',skin:'alienTech',pitch:'moon',modelRed:'alienKatum',modelBlue:'womanTalia'},
  void:  {room:'open',skin:'strike',pitch:'deck',modelRed:'rocko',modelBlue:'deltaborg'},
  voidM: {room:'open',skin:'strike',pitch:'deck',modelRed:'mechaMan',modelBlue:'deltaborg'}
 },
 fx:{goal:goalFx,cannon:cannonFx,climax:climaxFx,shatter:shatterFx},
 post:{
  base:{con:0.18,sat:1.1,vig:0.32,grain:0.022,ca:0.0012,bloom:{thr:0.72,str:0.3}},
  close:{dof:{at:'ball',s:10,max:12}},
  macro:{dof:{at:'ball',s:16,max:16}},
  tense:{exp:0.8,sat:0.92,vig:0.55,dof:{at:'ball',s:14,max:14}}
 },
 shots:[
  // ---- act 1: the cold open (the music is filtered) ----
  {id:'a1_est',k:[0,4],take:'L116',look:'hero',from:0.3,post:{dof:{at:[0,3,0],s:4,max:6}},sfx:false,
   shots:[{type:'path',keys:[{p:[-6,64,138],l:[0,40,-205],fov:40},{p:[12,54,118],l:[0,24,-110],fov:38},{p:[30,45,99],l:[0,3,0],fov:34}]}]},
  {id:'a1_line',k:[4,8],take:'L116',look:'hero',from:1.0,speed:[[1.0,0.5]],post:{dof:{at:14.8,s:14,max:14}},sfx:false,
   shots:[{type:'path',keys:[{p:[-6,9,24],l:[7.5,7,18]},{p:[-6,9,-16],l:[7.5,7,-22]}],ease:false}]},
  {id:'a1_drop',k:[8,14],take:'L116',look:'hero',from:3.80,speed:[[3.8,0.32],[4.22,0.32],[4.45,1]],post:'close',
   shots:[{type:'path',keys:[{p:[-9,2.6,5],l:[4.2,5.5,-3.9]},{p:[-7,2.4,3],l:[4.2,3.0,-3.9]}],sm:0.2}]},
  {id:'a1_pin',k:[14,16],take:'L112',look:'saucer',from:106.73,post:'tense',
   shots:[{type:'path',keys:[{p:[7,5,1.5],l:[20.5,3.6,-7.5]},{p:[9.5,4.4,-0.5],l:[20.5,3.2,-7.5]}],fov:34}]},
  // ---- act 2: the game ----
  {id:'a2_save',k:[16,18],take:'L112',look:'saucer',from:107.797,speed:[[107.797,0.3],[108.08,0.3],[108.3,1]],fx:'goal',post:'close',
   shots:[{type:'path',keys:[{p:[56,7,-23],l:[37,3,-7.5]},{p:[55.5,6.5,-22],l:[40,3,-7.5]}],fov:40,shake:0.08,cull:3}]},
  {id:'a2_rally',k:[18,20],take:'L102',look:'arcadeB',from:80.0,post:{dof:{at:[-7.5,2.5,7.5],s:10,max:12}},
   shots:[{type:'path',keys:[{p:[4.5,5,7.5],l:[-7.5,3.4,7.5]},{p:[3.8,4.6,7.3],l:[-7.5,3.2,7.5]}],fov:46,cull:4}]},
  {id:'a2_bar',k:[20,22],take:'L115',look:'moon',from:106.15,speed:[[106.15,1],[106.5,1],[106.58,0.35],[106.75,0.5]],post:{exp:1.45,lift:[0.02,0.02,0.03]},
   shots:[{type:'path',keys:[{p:[36,9,-30],l:[56,10,6]},{p:[37,10,-29],l:[55,12,6]}],fov:40,cull:4}]},
  {id:'a2_goal',k:[22,28],take:'L109',look:'saucer',from:41.033,speed:[[41.033,1],[42.12,1],[42.2,0.45],[42.6,0.32]],fx:'goal',post:'close',
   shots:[{type:'path',keys:[{p:[-56,4,-17],l:[-35,3,0]}],fov:42},
          {from:42.36,type:'orbit',at:[-58,4,-3],yaw:[160,110],pitch:[8,26],dist:[22,46],fov:[40,36],cull:4}]},
  {id:'a2_vpin',k:[28,29],take:'L106',look:'arcadeB',from:61.4,speed:[[61.4,0.6]],post:{dof:{at:[-5.5,2.5,-20.4],s:16,max:16}},
   shots:[{type:'orbit',at:{rod:3,man:0,y:3.2,dx:2.2},yaw:[8,14],pitch:8,dist:10,fov:38,cull:4}]},
  {id:'a2_vtap',k:[29,30],take:'L106',look:'arcadeB',from:200.6,post:{dof:{at:[24.5,2.5,-4.7],s:12,max:12}},
   shots:[{type:'path',keys:[{p:[36.5,5.5,-4.7],l:[24,3,-4.7]}],fov:52,cull:4}]},
  {id:'a2_vstrike',k:[30,31],take:'L106',look:'arcadeB',from:96.13,speed:[[96.13,0.7]],post:'macro',
   shots:[{type:'orbit',at:{rod:5,man:1,y:2.5,dx:-2},yaw:-35,pitch:8,dist:10,fov:40,cull:4}]},
  {id:'a2_vhit',k:[31,32],take:'L106',look:'arcadeB',from:96.425,speed:[[96.425,0.4]],post:'close',
   shots:[{type:'path',keys:[{p:[40,10,-14],l:[53,7,3]}],fov:40,shake:0.1}]},
  // ---- act 3: the same play, everywhere ----
  {id:'a3_venues',k:[32,40],take:'R223',look:'hero',from:69.78,fx:'goal',post:'base',
   shots:[{type:'orbit',at:ball({sm:0.8}),lift:5,yaw:[18,58],pitch:[19,15],dist:[96,86],fov:30,ease:false}],
   variants:[
    {look:{room:'arcade',skin:'wood',pitch:'royal',modelRed:'animalAzlar',modelBlue:'irnman'},caption:'STARPORT ARCADE'},
    {look:{room:'moon',skin:'alienTech',pitch:'moon',modelRed:'alienKatum',modelBlue:'womanTalia',redColor:'#29c46a',blueColor:'#e8e8e8'},caption:'MOON BASE'},
    {look:{room:'saucer',skin:'premierLeague',pitch:'neon',modelRed:'mechaMan',modelBlue:'womanZaneesh',redColor:'#e0359c',blueColor:'#22c7d6'},caption:'FLYING SAUCER'},
    {look:{room:'open',skin:'strike',pitch:'deck',modelRed:'rocko',modelBlue:'deltaborg',redColor:'#ff7a1a',blueColor:'#2f6bff'},caption:'THE VOID'},
    {look:{room:'arcade',skin:'sundayLeague',pitch:'cork',modelRed:'manLeo',modelBlue:'womanSandy',redColor:'#d4202a',blueColor:'#f5c518'},caption:'STARPORT ARCADE'},
    {look:{room:'moon',skin:'proLeague',pitch:'champions_purple',modelRed:'alienTamirok',modelBlue:'alienKodus',redColor:'#7b3fe4',blueColor:'#f0b24a'},caption:'MOON BASE'},
    {look:{room:'saucer',skin:'wood',pitch:'verdantia',modelRed:'alienGrimlot',modelBlue:'womanMaria',redColor:'#14a89a',blueColor:'#c2185b'},caption:'FLYING SAUCER'},
    {look:{room:'open',skin:'alienTech',pitch:'cyatron',modelRed:'alienZargon',modelBlue:'womanTanya',redColor:'#ffffff',blueColor:'#ff3b3b'},caption:'THE VOID'}
   ]},
  {id:'a3_figs',k:[40,44],take:'L102',look:'arcadeB',from:79.35,post:{dof:{at:{rod:3,man:2,y:6},s:12,max:12}},
   shots:[{type:'orbit',at:{rod:3,man:2,y:6.2,dx:0.5},yaw:[58,76],pitch:5,dist:19,fov:34,cull:6,ease:false}],
   variants:[
    {look:{modelRed:'animalAzlar',modelBlue:'irnman'}},
    {look:{modelRed:'alienGrimlot',modelBlue:'womanTalia',redColor:'#7b3fe4'}},
    {look:{modelRed:'rocko',modelBlue:'alienKatum',redColor:'#ff7a1a'}},
    {look:{modelRed:'mechaMan',modelBlue:'womanSasha',redColor:'#e0359c'}},
    {look:{modelRed:'alienTamirok',modelBlue:'deltaborg',redColor:'#14a89a'}},
    {look:{modelRed:'deltaborg',modelBlue:'alienZargon',redColor:'#f0b24a'}},
    {look:{modelRed:'alienKatum',modelBlue:'manDeano',redColor:'#29c46a'}},
    {look:{modelRed:'irnman',modelBlue:'animalAzlar',redColor:'#d4202a'}}
   ]},
  // ---- act 4: the chaos ----
  {id:'a4_fire',k:[44,45],take:'R201',look:'void',from:98.43,speed:[[98.43,0.6]],post:'base',
   shots:[{type:'follow',off:[7,15,22],lookAt:ball({dx:-6,sm:0.05}),sm:0.08,fov:38}]},
  {id:'a4_boost',k:[45,46],take:'L112',look:'void',from:66.62,speed:[[66.62,0.6]],post:'base',
   shots:[{type:'path',keys:[{p:[-12,6,-12],l:[-25,2,0]}],fov:42,cull:4}]},
  {id:'a4_frost',k:[46,47],take:'L101',look:'moon',from:219.0,post:'base',
   shots:[{type:'orbit',at:[10,3,0],yaw:[15,25],pitch:35,dist:[74,66],fov:36}]},
  {id:'a4_cannon',k:[47,48],take:'L107',look:'voidM',from:106.22,post:'close',fx:'cannon',
   shots:[{type:'orbit',at:[25.4,2,4],yaw:[26,34],pitch:16,dist:[22,19],fov:40,cull:4}]},
  // the player explosion in slow motion: the blast on the cut, then a bullet-time sweep round the man as he falls apart
  {id:'a4_shatter',k:[48,52],take:'L107',look:'voidM',from:107.255,fx:'shatter',
   speed:[[107.255,0.7],[107.29,0.7],[107.33,0.4],[107.43,0.4],[107.47,0.22],[107.74,0.22],[107.95,0.75]],
   post:{dof:{at:[22.5,5,-9],s:9,max:9}},
   shots:[{type:'orbit',at:[22.5,6,-9],yaw:[68,122],pitch:[7,4],dist:[22,18],fov:36,cull:8,cullY:30}]},
  // ---- act 5: the climax (rally, strike, bullet time while the music drops out, the slam) ----
  {id:'a5_climax',k:[52,60],take:'R216',look:'climax',from:159.12,fx:'climax',post:'close',
   speed:[[159.12,1],[159.42,1],[159.48,0.25],[159.645,0.25],[159.646,0.9],[159.75,0.9],[159.8,0.3]],
   hold:[{at:159.645,frames:64}],
   shots:[{type:'orbit',at:{rod:5,man:1,y:4},yaw:[-58,-66],pitch:10,dist:13,fov:38,cull:4},
          {fromF:26,type:'follow',off:[-5,3.5,9],lookAt:ball({sm:0.04}),sm:0.06,fov:38,cull:4},
          {fromF:64,type:'orbit',at:[53.6,4.6,2.6],yaw:[188,250],pitch:[9,13],dist:[18,15.5],fov:40,cull:4,post:{dof:{at:[53.4,1.9,2.3],s:10,max:10}}},
          {fromF:128,type:'orbit',at:[57,3,2],yaw:[248,262],pitch:[28,32],dist:[27,52],fov:[38,34],cull:4,ease:false,post:{dof:null}}]},
 ],
 cards:[
  {name:'t_table',k:4,len:120,out:112,push:0.04,lines:[{t:'TABLE FOOTBALL',at:8,size:118,pal:'steel',track:10,sheen:18}]},
  {name:'t_serious',k:14,len:65,out:999,push:0.06,lines:[{t:'TAKEN FAR TOO',at:0,size:76,y:500,pal:'steel',track:8},{t:'SERIOUSLY',at:16,size:168,y:680,pal:'gold',track:12,sheen:24,from:1.35}]},
  {name:'t_pin',k:28,len:33,out:999,push:0.08,lines:[{t:'PIN.',at:0,size:240,y:400,pal:'steel',track:16,inN:5,from:1.45}]},
  {name:'t_tap',k:29,len:32,out:999,push:0.08,lines:[{t:'TAP.',at:0,size:240,y:400,pal:'steel',track:16,inN:5,from:1.45}]},
  {name:'t_strike',k:30,len:32,out:999,push:0.08,lines:[{t:'STRIKE.',at:0,size:240,y:400,pal:'gold',track:16,inN:5,from:1.45,sheen:8,sheenN:18}]},
  {name:'end',kind:'end',k:60,len:206,logo:'assets/fuzeball_render_tc_cycles_2K.png',sheenT:0.75,fadeAt:192,
   cta:[{t:1.05,text:'EARLY ACCESS',y:872,size:56,pal:'dark',plate:540,track:8},{t:1.55,text:'WISHLIST NOW ON STEAM',y:975,size:48,pal:'steel',track:10}]}
 ],
 captions:{label:'LIVE FROM',shot:'a3_venues',inN:7},
 // the music edit: a low-pass that opens over the cold open, the drop-out under the bullet time, a reverb tail under the logo
 audio:{music_gain:0.72,ceil:0.89,fadeout:0.7,
  lp:[[0,320],[4.3,420],[6.45,900],[7.52,2600],[8.4,9000],[8.58,20000]],
  drop:[[28.952,30.024,2.4,0.55]],
  tail:[34.2,2.6],tail_gain:0.4},
 cues:[
  {t:0,k_:'drone',k:'drone',dur:8.7,g:0.22},
  {k:4,k_:'shing',kk:'shing',g:0.16,dt:0.13},
  {k:8,kk:'whoosh',dur:0.9,peak:0.75,flo:200,fhi:2500,g:0.14,end:false,dt:-0.65},
  {k:14,kk:'hit',g:0.32},
  {k:14,kk:'shing',g:0.22,dt:0.27},
  {k:16,kk:'riser',dur:2.4,g:0.32,end:true},
  {k:16,kk:'swell',dur:1.1,g:0.36,end:true},
  {k:16,kk:'impact',size:1.2,g:0.85,duck:0.3},
  {k:18,kk:'whoosh',dur:0.5,peak:0.8,g:0.12,end:true,dt:0.02},
  {k:20,kk:'whoosh',dur:0.5,peak:0.8,flo:400,fhi:5000,g:0.12,end:true,dt:0.02},
  {k:22,kk:'whoosh',dur:0.6,peak:0.8,g:0.13,end:true,dt:0.02},
  {k:24,kk:'hit',g:0.3},
  {k:28,kk:'hit',g:0.42},{k:29,kk:'hit',g:0.42},{k:30,kk:'hit',g:0.5},{k:30,kk:'shing',g:0.2,dt:0.05},
  {k:32,kk:'impact',size:0.9,g:0.6,duck:0.2},
  {k:33,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},{k:34,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},
  {k:35,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},{k:36,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},
  {k:37,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},{k:38,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},
  {k:39,kk:'whoosh',dur:0.3,peak:0.85,flo:600,fhi:6000,g:0.09,end:true,dt:0.01},
  {k:40,kk:'hit',g:0.36},
  {k:44,kk:'whoosh',dur:0.55,peak:0.3,flo:150,fhi:1800,g:0.2,dt:0},
  {k:45,kk:'shing',g:0.2},
  {k:46,kk:'shing',g:0.28},{k:46,kk:'crackle',dur:1.0,rate:90,g:0.18},
  {k:48,kk:'swell',dur:0.53,g:0.3,end:true},{k:48,kk:'boom',dur:2.6,f0:55,f1:24,tau:0.9,g:0.45},
  {at:{shot:'a4_shatter',D:107.6},kk:'debris',dur:1.1,n:64,slow:0.4,g:0.42},
  {k:52,kk:'whoosh',dur:0.6,peak:0.85,g:0.14,end:true,dt:0.02},
  {k:54,kk:'boom',dur:0.9,f0:70,f1:38,tau:0.18,g:0.55},{k:55,kk:'boom',dur:0.9,f0:70,f1:38,tau:0.18,g:0.42},
  {k:56,kk:'swell',dur:1.07,g:0.42,end:true},
  {k:56,kk:'impact',size:1.5,g:0.95,duck:0.35},
  {k:60,kk:'impact',size:1.4,g:0.9,duck:0.3},{k:60,kk:'shing',g:0.3,dt:0.05},{k:60,kk:'crackle',dur:3.2,rate:70,g:0.14,dt:0.25},
  {k:62,kk:'hit',g:0.22,dt:-0.03},{k:63,kk:'hit',g:0.2,dt:-0.04}
 ],
 flashes:[{k:16,len:5,a:0.55},{k:48,len:4,a:0.4},{k:56,len:6,a:0.6}],
 fades:[{f:0,len:30,a0:1,a1:0}]
};
