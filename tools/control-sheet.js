// The control sheet: one row per verb or assist, built from live CONFIG and the assist ledger's ids (js/assists.js), with the bot's fire counts. Run:
//      node tools/page-run.js tools/assist-soak.js "asSoakAll({seeds:8,secs:180})" > tools/build/assist-ledger/bot.json
//      node tools/control-sheet.js                      // -> tools/build/control-sheet/control-sheet.html (the template is tools/control-sheet.html)
// every number in a row's text is read from CONFIG here ({path} below), so the sheet follows a tuning change on the next run
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const ctx={console,Math,JSON,Object,Array,Number,String,Map,Set,localStorage:{getItem:()=>null,setItem:()=>{}},THREE:{Vector3:function(){}},S:{},document:{querySelectorAll:()=>[]}};
ctx.globalThis=ctx;
vm.runInNewContext(rd('js/core.js')+'\n'+rd('js/config.js')+'\n'+rd('js/assists.js')+';globalThis.OUT={CONFIG,cfg,ASL_DEFS,ASL_GRP,ASL_COL};',ctx);
const {CONFIG,cfg,ASL_DEFS,ASL_GRP}=ctx.OUT;
const get=p=>p.startsWith('cfg.')?cfg[p.slice(4)]:p.split('.').reduce((o,k)=>o==null?o:o[k],CONFIG);
const deg=r=>(r*57.2958).toFixed(1)+'°';
// {path} = the value, {path|deg} = radians shown in degrees, {path|ms} = seconds in ms, {path|abs} = without its sign
const fill=s=>s.replace(/\{([a-zA-Z0-9_.]+)(?:\|(deg|ms|abs))?\}/g,(m,p,f)=>{const v=get(p);if(v==null)throw new Error('no CONFIG value: '+p);return f==='deg'?deg(v):f==='ms'?Math.round(v*1000)+' ms':f==='abs'?String(Math.abs(v)):String(v);});

// --- the rows: id = the ledger's (none = not logged), the four plain-words columns, the switches ---
const ROWS={
 kShot:{input:'Power + Kick (pad RT + A)',when:'No ball pinned; power held as Kick goes down (pad RT past {shots.mod.powAt})',moves:'The shot swing; impulse x{swings.shoot.pow}, control (aim help and spray) {swings.shoot.ctl}',see:'Nothing marks it',sw:['swings.shoot.pow','swings.shoot.ctl']},
 kCharge:{input:'Power + raise (pad RT + X, or RT + right stick back) winds up; Kick fires',when:'Wound past {shots.charge.minFire}',moves:'The leg pulls back; {shots.charge.sweetFrom} to {shots.charge.sweetTo} of the wind-up pays full power and control',see:'The charge tone and band colours; the words show in Training and Trials only',sw:['shots.charge.on','shots.charge.text.inMatch']},
 kGrace:{input:'Kick just after letting a wind-up go',when:'Within {shots.charge.grace|ms} of letting go',moves:'Fires the wind-up anyway',see:'Nothing',sw:['shots.charge.grace']},
 kFlinch:{input:'A wind-up let go early',when:'Under {shots.charge.minFire} of charge',moves:'Fires the shot with no wind-up instead of a weak charged one',see:'TOO EARLY, in Training and Trials',sw:['shots.charge.minFire']},
 kPass:{input:'Kick (Space / left mouse; pad A)',when:'No ball pinned, power not held',moves:'The pass swing (impulse x{swings.pass.pow}), aimed at the clearest mate the assist can reach, else at nobody',see:'Nothing marks it',sw:['shots.pass.on','swings.pass.pow']},
 kPinPass:{input:'Kick on a back-pinned ball, power not held (pad: X / square, or A)',when:'GK, DEF and MID',moves:'Passes at once down the slide\'s line to the next rod ahead, whose AI gets ready',see:'The plate: KICK PASS',sw:['shots.pin.press.on','shots.pin.press.shoot','cfg.padPinBtns']},
 kPinShot:{input:'Power + Kick on a back-pinned ball (pad: B / circle, or RT + A); Kick alone on the ATT',when:'Power held as Kick goes down (pad RT past {shots.mod.powAt})',moves:'The pin shot swing, power x{swings.pinShot.pow}, control {swings.pinShot.ctl}',see:'The plate while a ball is pinned: POWER + KICK SHOT',sw:['shots.pin.press.on','shots.pin.hint.on']},
 kFwdPin:{input:'Finesse + Kick (pad LT + A)',when:'Any time the leg is free',moves:'The forward pin pose instead of a swing',see:'The men tilt forward',sw:['shots.pin.fwd.on']},
 kStroke:{input:'Finesse + Kick tapped (let go inside {shots.pin.assist.hop.tap|ms})',when:'The forward leg is held below a ball it would sweep',moves:'The leg strokes through the ball (a pass); finesse alone keeps the receive on for {shots.pin.assist.recv.strokeT} s',see:'Nothing marks it',sw:['shots.pin.assist.hop.tap','shots.pin.assist.recv.strokeT']},
 kSnake:{input:'Power + Kick with a ball under the forward leg (pad: B / circle, or RT + A)',when:'Power held as Kick goes down',moves:'The man spins over the rod and strikes from behind',see:'The spin',sw:['shots.snake.on']},
 aim:{input:'Any of your strikes',when:'In the power window, on a sweet-spot hit, or an armed shot; ball leaving within {stats.assistCone|deg} of goal centre faster than {stats.assistMinVX} u/s',moves:'The ball\'s heading, toward goal centre: at most {stats.assistBase|deg} at accuracy 5 ({stats.assistMax|deg} at 10), scaled by shot control (pin shot {swings.pinShot.ctl})',see:'Nothing',sw:['stats.assistBase','stats.assistMax','kick.sweetSpot.forceAssist'],suspect:'aim assist pulling shots toward the middle',note:'The plan guessed 6 to 8 degrees. A stock rod is capped at {stats.assistBase|deg}; the bot measured about 2. The 9 degree bend is the pass assist below.'},
 pass:{input:'A pass, off the pin or not',when:'Ball leaving within {ai.dribble.pass.assistCone|deg} of the receiver',moves:'The heading toward the receiver, up to {ai.dribble.pass.assist|deg}, scaled by control',see:'Nothing',sw:['ai.dribble.pass.assist'],note:'Shared with the AI\'s passes. The pin pass aims where your slide sends it, so it bends little.'},
 wall:{input:'A strike on a ball against the side wall',when:'Off for players (on for the AI)',moves:'Would send it {ai.wallPlay.minAng|deg} to {ai.wallPlay.maxAng|deg} infield',see:'Nothing',sw:['ai.wallPlay.human']},
 backAim:{input:'Back pin (finesse + raise)',when:'A ball slower than {shots.pin.assist.v} u/s, {shots.pin.assist.near|abs} to {shots.pin.back|abs} behind the rod',moves:'The leg goes up beside it and down onto its top once the man is over it and sliding slower than {shots.pin.assist.slideV} u/s',see:'The leg moves by itself',sw:['shots.pin.assist.on']},
 fwdAim:{input:'Forward pin (finesse + kick)',when:'A slow ball {ai.catch.fetch.near} to {shots.pin.fwdFront} ahead',moves:'The leg goes up and clear beside it, down onto its top once over it',see:'The leg moves by itself',sw:['shots.pin.fwd.assist','shots.pin.assist.on']},
 settle:{input:'Back or forward pose held, slide left alone',when:'Leg up beside or over a ball within {shots.pin.assist.settle.z} of a man; slide still for {shots.pin.assist.settle.still|ms}',moves:'Slides your man onto the ball at {shots.pin.assist.settle.v} u/s',see:'The rod slides with no input',sw:['shots.pin.assist.settle.on'],suspect:'slide settle moving your man for you'},
 stick:{input:'Pad right stick with finesse held',when:'The stick brings a raised leg near a ball\'s top, or a ball is pinned',moves:'Snaps the leg onto the ball (within {shots.pin.assist.stick.win} rad); holds a pinned ball through stick wobble',see:'The leg does not follow the stick',sw:['shots.pin.assist.stick.on']},
 roll:{input:'Back or forward pose',when:'A ball rolling along the row toward a man',moves:'Poses the foot onto the ball\'s top at its depth and drops it fast',see:'The leg moves by itself',sw:['shots.pin.assist.roll.on'],note:'roll.capV ({shots.pin.assist.roll.capV}) equals pin.capV ({shots.pin.capV}): the faster catch it was meant to give players does nothing today.'},
 under:{input:'Forward pin',when:'A ball rolling at the man from up to {shots.pin.assist.under.far} ahead',moves:'Holds the leg up so the ball rolls under the toe, then drops it on top; off his line, slides him to where it arrives',see:'The leg stays up',sw:['shots.pin.assist.under.on']},
 hop:{input:'Forward pin held (kick down past {shots.pin.assist.hop.tap|ms})',when:'The man is lined up on a slow ball that raising the leg would sweep',moves:'Steps the man off its line at {shots.pin.assist.hop.v} u/s, then up, over and down onto it',see:'The rod slides by itself',sw:['shots.pin.assist.hop.on'],suspect:'the hop step-off'},
 recvPose:{input:'Finesse + kick held, or the pad stick pushed past half',when:'A ball coming from behind, up to {shots.pin.assist.recv.far} back, at least {shots.pin.assist.recv.minV} u/s',moves:'The forward leg goes to the AI\'s receive angle ({ai.catch.recv.angle}) instead of the pose angle',see:'The leg tilts',sw:['shots.pin.assist.recv.on']},
 recvDraw:{input:'The same receive, slide left alone',when:'Every frame you leave the slide still, no wait',moves:'Pulls your man onto the ball\'s line at up to {shots.pin.assist.recv.v} u/s',see:'The rod slides by itself',sw:['shots.pin.assist.recv.on'],suspect:'the receive draw moving your man for you',note:'No switch of its own: it goes with recv.on.'},
 rcvKeep:{input:'Finesse alone, after a stroke or a pin pass',when:'For {shots.pin.assist.recv.strokeT} s, until the ball is pinned or the other team touches it',moves:'Keeps the receive pose on without kick',see:'Nothing marks it',sw:['shots.pin.assist.recv.strokeT','shots.pin.press.recv']},
 fwdTake:{input:'Kick held, then finesse; or finesse + kick held on a rod you just switched to',when:'A swing frozen forward over a ball, or no pose yet',moves:'The forward pin takes the leg over with no fresh press',see:'The pose appears',sw:['shots.pin.assist.recv.take']},
 liftOff:{input:'Letting the forward pin go',when:'A ball {shots.pin.fwd.holdNear} to {shots.pin.fwd.holdFar} ahead, slower than {shots.pin.fwd.holdV} u/s',moves:'The leg goes up and forward off it and drops once clear',see:'The leg lifts',sw:['shots.pin.fwd.holdNear'],note:'No on/off switch.'},
 fwdRaise:{input:'Finesse let go from a forward pin, kick still held',when:'Any time',moves:'The men tilt up forward and stay up while kick is held',see:'The men stay up',sw:['shots.pin.fwd.raise']},
 square:{input:'Finesse held, leg down',when:'A low ball beside a man (within {shots.square.zMax} of him, from {shots.square.back|abs} behind to {shots.square.front} ahead)',moves:'Turns the foot\'s face onto the ball for a side tap',see:'The foot turns',sw:['shots.square.on']},
 lead:{input:'Any slide while carrying (pinned, or the finesse grip)',when:'Your hand runs ahead of the man',moves:'Cuts the slide target to {shots.hold.lead} s ahead of him, so he stops when your hand does',see:'Nothing',sw:['shots.hold.lead']},
 guard:{input:'Any pose or return that would sweep a ball',when:'Back-pin pose, the forward leg rising or dropping, coming back from the forward pin, the square, a carried stick angle',moves:'Stops the leg short of the ball',see:'The leg stops partway',sw:['ai.sweep.on','ai.backGuard.on','shots.pin.assist.hop.on']},
 heldOut:{input:'Your kick, finished',when:'A ball within {ai.heldFwd.xBack} behind or {ai.heldFwd.xFront} ahead of the men',moves:'Keeps the swing out at full stretch after you let kick go',see:'The leg stays forward',sw:['ai.heldFwd.on'],note:'Shared with the AI.'},
 mates:{input:'Finesse + kick held (any forward pose, receive or stroke\'s receive)',when:'Any time',moves:'Your team\'s AI rods ahead stand posed to receive',see:'Their legs tilt',sw:['shots.pin.assist.recv.mates']},
 stickCarry:{input:'A rod switch with the right stick pushed',when:'Every switch, manual or auto',moves:'Carries the stick\'s angle onto the new rod, turned at most {control.handover.stickW} rad/s',see:'The new rod eases to the stick',sw:['control.handover.stick']},
 ltLatch:{input:'LT squeezed past the pass depth, then relaxed',when:'Until LT drops below {shots.hold.from}',moves:'Reads LT as full',see:'Nothing',sw:['shots.pass.keep']},
 chord:{input:'A pressed while LT is still moving down',when:'LT short of the pass depth and rising',moves:'Holds the press up to {shots.pass.chord|ms} for LT to get there',see:'Nothing',sw:['shots.pass.chord']},
 autoSwitch:{input:'None (Options: Auto switch, on by default)',when:'{control.autoDelay} s after the last switch',moves:'Which rod you hold: the painted zone for the ball\'s spot, else the nearest rod',see:'The rod chips change, no sound',sw:['cfg.auto','control.zones.on'],suspect:'the auto zones'},
 gkHold:{input:'None (auto switch)',when:'A shot coming at your goal faster than {control.handover.closing} u/s',moves:'Leaves the keeper with the AI for the save, up to {control.handover.maxHold} s',see:'You keep your rod',sw:['control.handover.on']},
 slideFreeze:{input:'Any slide right after an auto switch',when:'For {control.handover.settle|ms}',moves:'Ignores your slide',see:'Nothing',sw:['control.handover.settle']},
 raiseKeep:{input:'None (a rod handed to you)',when:'The AI had it raised',moves:'Keeps it raised by the benched-rod rule until you press raise or kick or move the stick',see:'The men stay up',sw:[],note:'No switch.'},
 grip:{input:'Finesse held',when:'Any time (not logged: it is the verb itself)',moves:'Makes the boot sticky (bounce {shots.hold.rest}, grip {shots.hold.grip}) and slows the carried slide to x{shots.hold.carry}',see:'Nothing marks it',sw:['shots.hold.on'],group:'pin',tag:'FINESSE GRIP'}
};
const fmtV=v=>typeof v==='number'?String(+v.toFixed(4)):JSON.stringify(v);
// --- the bot's counts ---
let bot=null;
try{bot=JSON.parse(rd('tools/build/assist-ledger/bot.json'));}catch(e){console.warn('no bot.json yet: the bot columns stay empty');}
const botCell=(arm,id)=>{const a=bot&&bot[arm],e=a&&a.ids[id];return e?{n:e.perMatch,avg:e.avg}:null;};
const groups=[];
for(const d of ASL_DEFS){
 let g=groups.find(x=>x.id===d.g);if(!g){g={id:d.g,name:ASL_GRP[d.g],rows:[]};groups.push(g);}
 const R=ROWS[d.id];if(!R)throw new Error('no row text for '+d.id);
 g.rows.push(row(d.id,d.tag,d.u,R));
}
for(const id in ROWS)if(!ASL_DEFS.some(d=>d.id===id)){const R=ROWS[id];groups.find(g=>g.id===R.group).rows.push(row(id,R.tag,'',R,true));}
function row(id,tag,u,R,unlogged){
 return {id,tag,u,unlogged:!!unlogged,input:fill(R.input),when:fill(R.when),moves:fill(R.moves),see:fill(R.see),note:R.note?fill(R.note):'',suspect:R.suspect||'',
  sw:R.sw.map(p=>({p:p.replace(/^cfg\./,'Options: '),v:fmtV(get(p))})),kbm:botCell('kbm',id),pad:botCell('pad',id)};
}
const meta={built:new Date().toISOString().slice(0,10),bot:bot?{matches:bot.kbm.matches,mins:+(bot.kbm.mins/bot.kbm.matches).toFixed(1),diff:'pro'}:null,rows:groups.reduce((a,g)=>a+g.rows.length,0)};
const out=path.join(ROOT,'tools/build/control-sheet');fs.mkdirSync(out,{recursive:true});
const html=rd('tools/control-sheet.html').replace('/*SHEET*/null',JSON.stringify({meta,groups}));
fs.writeFileSync(path.join(out,'control-sheet.html'),html);
console.log(meta.rows,'rows ->',path.relative(ROOT,path.join(out,'control-sheet.html')));
