'use strict';
const {sweepGoal,band,smooth,length}=require('./arena_goal_sweep.js');

// [V, depth toward the pitch, distance outward from the opening]. The front
// lens channel lies between two raised chamfers. The rear has a broad spine.
const section = [
 [0,.46,0],[.048,.46,.14],[.064,.48,.17],[.080,.62,.215],[.095,.65,.27],
 [.107,.62,.39],[.136,.48,.52],[.173,.28,.58],[.225,.02,.60],[.255,-.22,.56],
 [.294,-.42,.46],[.34,-.49,.30],[.40,-.51,.19],[.50,-.51,0],[.60,-.51,-.19],
 [.66,-.49,-.30],[.706,-.42,-.46],[.745,-.22,-.53],[.775,.02,-.56],
 [.827,.28,-.54],[.864,.48,-.50],[.893,.62,-.39],[.905,.65,-.27],
 [.920,.62,-.215],[.936,.48,-.17],[.952,.46,-.14]
];

function goalGeometry(side){
 return sweepGoal(side,section,(end,v,depth,radius)=>{
  const foot=(1-smooth(.043,.056,end))*(.73+.27*band(end,0,.052,.013));
  const cuff=band(end,.060,.088,.008);
  const mount=band(end,.208,.251,.013);
  const lamp=Math.max(band(end,.111,.183,.009),band(end,.326,.459,.01));
  const front=Math.min(v,1-v);
  const lens=.075*lamp*(1-smooth(.05,.08,front));
  const block=.23*foot+.12*cuff+.09*mount;
  const r=radius*(1+block*2.05)+.11*foot;
  return [depth*(1+block)-lens,r];
 });
}

module.exports={goalGeometry,band,smooth,length};
