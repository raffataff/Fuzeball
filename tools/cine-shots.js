'use strict';
// cine-shots: plays a real AI showdown on the cinematic camera (js/cine.js) and returns contact sheets + how the camera moved.
//   node tools/page-run.js --size=1280x720 tools/cine-shots.js "cineShots({secs:120})" > out.json   then node tools/fx-shots-save.js out.json <dir> cine
// secs = match seconds stepped; every = seconds between frames; cols x rows frames a sheet, each tw x th; seed = the match seed; shot = force one shot id (held)
(function(){
 if(typeof Au!=='undefined'){Au.init=function(){};if(Au.ctx){try{Au.ctx.suspend();}catch(e){}}}
 window.cineShots=async function(o){
  o=Object.assign({secs:120,every:1.5,w:1280,h:720,tw:400,th:225,cols:4,rows:4,seed:11,shot:null},o||{});
  S.seedNext=o.seed;startMatchNow('ai');
  await new Promise(r=>setTimeout(r,3000));   // figurines, table, room
  window.requestAnimationFrame=()=>0;         // the steps below are the only clock
  renderer.setPixelRatio(1);renderer.setSize(o.w,o.h,false);camera.aspect=o.w/o.h;camera.updateProjectionMatrix();
  const sheets=[],info=[],use={};let sh=null,g=null,k=0,next=0,t=performance.now();
  const N=o.cols*o.rows;
  const flush=()=>{if(sh){sheets.push(sh.toDataURL('image/png'));sh=null;}};
  // pan speed between cuts on the real match (deg/s, deg/s^2)
  let pd=null,pw=null,pid=null,pst=0,wMax=0,aMax=0,cuts=0,wAt='';const off={},edge={},inPlay={},offLog=[],v=new THREE.Vector3();
  for(let f=0;f<o.secs*60;f++){
   t+=1000/60;loop(t);
   if(o.shot&&CINE.on&&CINE.id!==o.shot&&S.phase==='play'){cineGo(o.shot,true);CINE.hold=1e9;}
   if(S.phase==='replay'){pd=null;while(next<=f/60)next+=o.every;continue;}
   const T=f/60,ld=camera.getWorldDirection(new THREE.Vector3());
   const cut=CINE.id!==pid||CINE.t<pst;
   if(cut){cuts++;pd=pw=null;}
   else if(pd){const w=pd.angleTo(ld)*180/Math.PI*60;if(w>wMax){wMax=w;wAt=CINE.id+' @'+T.toFixed(1);}if(pw!=null)aMax=Math.max(aMax,Math.abs(w-pw)*60);pw=w;}
   pd=ld;pid=CINE.id;pst=CINE.t;
   if(CINE.id)use[CINE.id]=(use[CINE.id]||0)+1/60;
   // the ball on screen: off = outside the frame, edge = in its outer 15%
   if(S.phase==='play'&&S.balls[0]&&CINE.id){camera.updateMatrixWorld();v.copy(S.balls[0].m.position).project(camera);const m=Math.max(Math.abs(v.x),Math.abs(v.y)),id=CINE.id;
    inPlay[id]=(inPlay[id]||0)+1;if(m>1||v.z>1){off[id]=(off[id]||0)+1;const p=S.balls[0].m.position;if(offLog.length<40)offLog.push(T.toFixed(2)+' '+id+' t'+CINE.t.toFixed(1)+' ball '+p.x.toFixed(0)+','+p.y.toFixed(0)+','+p.z.toFixed(0)+' v '+S.balls[0].v.x.toFixed(0)+' subj '+CINE.f[0].toFixed(0)+','+CINE.f[2].toFixed(0)+' d'+CINE.d+'/'+CINE.sd+' ndc '+v.x.toFixed(2)+','+v.y.toFixed(2));}else if(m>.85)edge[id]=(edge[id]||0)+1;}
   if(T>=next){next+=o.every;
    renderer.render(scene,camera);
    if(!sh){sh=document.createElement('canvas');sh.width=o.cols*o.tw;sh.height=o.rows*o.th;g=sh.getContext('2d');g.font='bold 16px sans-serif';k=0;}
    const x=(k%o.cols)*o.tw,y=Math.floor(k/o.cols)*o.th;
    g.drawImage(renderer.domElement,x,y,o.tw,o.th);
    const lab=T.toFixed(1)+'s '+S.phase+' '+(CINE.id||'-')+' '+CINE.t.toFixed(1);
    g.fillStyle='rgba(0,0,0,.6)';g.fillRect(x,y,g.measureText(lab).width+10,22);g.fillStyle='#fff';g.fillText(lab,x+5,y+16);
    info.push(lab+' ball '+(S.balls[0]?S.balls[0].m.position.x.toFixed(0)+','+S.balls[0].m.position.z.toFixed(0):'-'));
    if(++k>=N)flush();
   }
  }
  flush();
  for(const id in use)use[id]=+use[id].toFixed(1);
  const pct={};for(const id in inPlay)pct[id]='off '+(100*(off[id]||0)/inPlay[id]).toFixed(1)+'% edge '+(100*(edge[id]||0)/inPlay[id]).toFixed(1)+'%';
  return{shots:sheets,info:{score:S.score.slice(),cuts,meanShot:+(o.secs/Math.max(1,cuts)).toFixed(1),panMax:+wMax.toFixed(1),panAt:wAt,panAccMax:+aMax.toFixed(0),use,ball:pct,offLog,frames:info}};
 };
})();
