// What the Starport Arcade's windows show: every camera the game can use against the two bays, and which sky pieces fall in what gets through.
// Run: node tools/window-view.js          (needs tools/build/sky/arcade/layout.json: blender -b -P tools/build_arcade_sky.py -- --layout)
// The sky is a cubemap, so a camera's position does not matter, only the direction of each ray through an opening: the pieces are
// judged by where they sit seen from the origin. Cameras: CONFIG.camera.modes (end shots mirrored for the blue side), menuShots, at 16:9 and 16:10.
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const CFG=rd('js/config.js'),ROOM=rd('tools/build_arcade_room.py');
const num=(src,re,name)=>{const m=src.match(re);if(!m)throw new Error('ANCHOR LOST: '+name);return +m[1];};
const FOV=55;
const BX=num(ROOM,/^BX, RZ\s*=\s*([\d.]+)/m,'BX'),RZ=num(ROOM,/^BX, RZ\s*=\s*[\d.]+,\s*([\d.]+)/m,'RZ');
const SILL=num(ROOM,/^SILL, HEAD\s*=\s*(-?[\d.]+)/m,'SILL'),HEAD=num(ROOM,/^SILL, HEAD\s*=\s*-?[\d.]+,\s*(-?[\d.]+)/m,'HEAD');
const Z0=num(ROOM,/^X0, X1, Z0, Z1\s*=\s*-?[\d.]+,\s*-?[\d.]+,\s*(-?[\d.]+)/m,'Z0'),X1=num(ROOM,/^X0, X1, Z0, Z1\s*=\s*-?[\d.]+,\s*(-?[\d.]+)/m,'X1');
const GLASS=num(ROOM,/^GLASS_IN\s*=\s*([\d.]+)/m,'GLASS_IN');
// the openings the rays have to pass: the wall face and the glass behind it, inset by the 3-unit frame
const Y0=SILL+3,Y1=HEAD-3;
const back={axis:'z',planes:[Z0,Z0-GLASS],lo:-(BX-3),hi:BX-3};
const right={axis:'x',planes:[X1,X1+GLASS],lo:-(RZ-3),hi:RZ-3};

const arr=s=>s.split(',').map(Number);
function section(src,key){const a=src.indexOf(key);const b=src.indexOf('\n   ]',a);return src.slice(a,b);}
const modes=[...section(CFG,'modes:[').matchAll(/\[(-?[\d.]+(?:,\s*-?[\d.]+){5})\]/g)].map(m=>arr(m[1]));
const sideModes=arr(CFG.match(/sideModes:\[([\d,]+)\]/)[1].replace(/\s/g,''));
const shots=[...CFG.slice(CFG.indexOf('menuShots:{')).split('menuLerp')[0].matchAll(/(\w+):\s*\[(-?[\d.]+(?:,\s*-?[\d.]+){5})\]/g)].map(m=>({name:m[1],v:arr(m[2])}));
const views=[];
modes.forEach((m,i)=>{views.push({name:'mode '+i,v:m});if(sideModes.includes(i))views.push({name:'mode '+i+' (blue side)',v:[-m[0],m[1],m[2],-m[3],m[4],m[5]]});});
shots.forEach(s=>views.push({name:'menu '+s.name,v:s.v}));
const seen=new Set(),uniq=views.filter(v=>{const k=v.v.join();if(seen.has(k))return false;seen.add(k);return true;});

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
const CELL=0.5;
const cell=(az,el)=>Math.floor((az+180)/CELL)+720*Math.floor((el+90)/CELL);
const cover=new Map();                                   // cell -> number of views that see through a bay
const per=[];
for(const view of uniq){
 const [px,py,pz,tx,ty,tz]=view.v,P=[px,py,pz];
 const f=norm([tx-px,ty-py,tz-pz]),r=norm(cross(f,[0,1,0])),u=cross(r,f);
 const mine=new Set(),stat={back:{az:[999,-999],el:[999,-999]},right:{az:[999,-999],el:[999,-999]}};
 for(const asp of [16/9,16/10]){
  const th=Math.tan(FOV*Math.PI/360);
  for(let j=0;j<108;j++)for(let i=0;i<192;i++){
   const x=((i+0.5)/192*2-1)*th*asp,y=(1-(j+0.5)/108*2)*th;
   const d=[f[0]+r[0]*x+u[0]*y,f[1]+r[1]*x+u[1]*y,f[2]+r[2]*x+u[2]*y];
   for(const [name,bay] of [['back',back],['right',right]]){
    const A=bay.axis==='z'?2:0,B=bay.axis==='z'?0:2;     // A = the axis the wall is normal to, B = along it
    if(bay.axis==='z'&&d[2]>=0)continue;if(bay.axis==='x'&&d[0]<=0)continue;
    let ok=true;
    for(const pl of bay.planes){
     const t=(pl-P[A])/d[A];if(t<=0){ok=false;break;}
     const hb=P[B]+d[B]*t,hy=P[1]+d[1]*t;
     if(hb<bay.lo||hb>bay.hi||hy<Y0||hy>Y1){ok=false;break;}
    }
    if(!ok)continue;
    const az=Math.atan2(d[0],-d[2])*180/Math.PI,el=Math.asin(d[1]/Math.hypot(...d))*180/Math.PI;
    mine.add(cell(az,el));
    const s=stat[name];s.az[0]=Math.min(s.az[0],az);s.az[1]=Math.max(s.az[1],az);s.el[0]=Math.min(s.el[0],el);s.el[1]=Math.max(s.el[1],el);
   }
  }
 }
 for(const c of mine)cover.set(c,(cover.get(c)||0)+1);
 per.push({view,mine,stat});
}

const layout=JSON.parse(fs.readFileSync(path.join(ROOT,'tools/build/sky/arcade/layout.json'),'utf8'));
let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const PX=(1536/90)**2;                                    // face pixels per square degree at the shipped 1536 size
const rows=layout.map((p,i)=>{
 let n=0,vis=0;const hit=new Array(per.length).fill(0);
 for(let k=0;k<3000;k++){
  const x=p.lo[0]+rnd()*(p.hi[0]-p.lo[0]),y=p.lo[1]+rnd()*(p.hi[1]-p.lo[1]),z=p.lo[2]+rnd()*(p.hi[2]-p.lo[2]);
  const az=Math.atan2(x,-z)*180/Math.PI,el=Math.asin(y/Math.hypot(x,y,z))*180/Math.PI,c=cell(az,el);n++;
  if(cover.has(c))vis++;
  per.forEach((q,qi)=>{if(q.mine.has(c))hit[qi]++;});
 }
 // the angular box of the piece, for its size
 const azs=[],els=[];
 for(const x of [p.lo[0],p.hi[0]])for(const y of [p.lo[1],p.hi[1]])for(const z of [p.lo[2],p.hi[2]]){azs.push(Math.atan2(x,-z)*180/Math.PI);els.push(Math.asin(y/Math.hypot(x,y,z))*180/Math.PI);}
 const w=Math.max(...azs)-Math.min(...azs),h=Math.max(...els)-Math.min(...els);
 const views_=hit.filter(c=>c/n>0.05).length;
 return {i,kind:p.kind,at:'az '+Math.min(...azs).toFixed(0)+'..'+Math.max(...azs).toFixed(0)+' el '+Math.min(...els).toFixed(0)+'..'+Math.max(...els).toFixed(0),
  frac:vis/n,area:w*h*vis/n*PX,views:views_};
});
console.log('windows: back bay x +-'+(BX-3)+', right bay z +-'+(RZ-3)+', y '+Y0+'..'+Y1+'; '+per.length+' camera views, 16:9 and 16:10\n');
console.log('per camera view (what the bays give it):');
for(const q of per){
 const b=q.stat.back,r=q.stat.right,fmt=(s,n)=>s.az[0]>900?'-':n+' az '+s.az[0].toFixed(0)+'..'+s.az[1].toFixed(0)+' el '+s.el[0].toFixed(0)+'..'+s.el[1].toFixed(0);
 console.log('  '+q.view.name.padEnd(26)+(fmt(b,'back')+'   '+fmt(r,'right')).padEnd(70)+q.mine.size+' cells');
}
// the planet: the covered cells that fall inside its disc (build_arcade_sky.py)
const SKY=rd('tools/build_arcade_sky.py');
const pd=SKY.match(/^PLANET_DIR\s*=\s*K\.unit\(\(([^)]+)\)\)/m)[1].split(',').map(Number),prad=num(SKY,/^PLANET_DEG\s*=\s*([\d.]+)/m,'PLANET_DEG');
{const L=Math.hypot(...pd),C=pd.map(x=>x/L);let cells=0,all=0;
 for(const c of cover.keys()){const el=(Math.floor(c/720)+0.5)*CELL-90,az=((c%720)+0.5)*CELL-180,e=el*Math.PI/180,a=az*Math.PI/180;
  const d=[Math.sin(a)*Math.cos(e),Math.sin(e),-Math.cos(a)*Math.cos(e)];all++;
  if(Math.acos(Math.max(-1,Math.min(1,d[0]*C[0]+d[1]*C[1]+d[2]*C[2])))*180/Math.PI<=prad)cells++;}
 console.log('\nthe planet takes '+Math.round(100*cells/all)+'% of everything the windows show ('+cells+' of '+all+' cells)');}
console.log('\npieces, by visible size (px = face pixels of its visible box at 1536; views = camera views that see >5% of it):');
for(const r of rows.sort((a,b)=>b.area-a.area))
 console.log('  '+(r.kind+' #'+r.i).padEnd(14)+r.at.padEnd(26)+(Math.round(r.frac*100)+'% seen').padEnd(11)+('~'+Math.round(r.area/1000)+'k px').padEnd(10)+r.views+' views');
