// lane-look models over an llSoak dump (tools/lanelook-soak.js): node tools/lanelook-models.js <json>
'use strict';
const L=JSON.parse(JSON.parse(require('fs').readFileSync(process.argv[2],'utf8').trim()));const BR=2.6;
const rows=[];for(const k of L){if(k.clr<0)continue;for(const w of k.rows)rows.push({k,w});}
const clrAt=(w,lz,offs)=>{let d=1e9;for(const b of w.base){const lo=b+offs[0],hi=b+offs[1];d=Math.min(d,lz<lo?lo-lz:lz>hi?lz-hi:0);}return d-BR;};
const vOf=k=>k.kind.startsWith('snake')?200:105;
const M={
 still:(k,w)=>[w.off0,w.off0],
 cur:(k,w)=>{const o=w.off0+w.vz0*w.ah/vOf(k);return[o,o];},
 tgt:(k,w,T)=>{const o=w.off0+Math.max(-w.ms*T,Math.min(w.ms*T,w.tg0-w.off0));return[Math.min(o,w.off0),Math.max(o,w.off0)];},
};
for(const lat of [0,0.03,0.06,0.1])for(const kf of [0.5,0.75,1])M['reach '+lat+' x'+kf]=(k,w,T)=>{const R=w.ms*kf*Math.max(0,T-lat);return[w.off0-R,w.off0+R];};
const real=(k,w)=>[w.off,w.off];
const T=(k,w)=>w.ah/vOf(k)+0.05;   // flight + a wind-up guess
console.log('rows',rows.length,'blocked',rows.filter(x=>x.w.blk).length);
for(const name in M){
 let open=0,openBlk=0,shut=0,shutBlk=0;
 for(const {k,w} of rows){const c=clrAt(w,w.lz,M[name](k,w,T(k,w)));if(c>=0){open++;if(w.blk)openBlk++;}else{shut++;if(w.blk)shutBlk++;}}
 console.log(name.padEnd(16),'open',open,'blocked',(openBlk/Math.max(1,open)).toFixed(2),'| shut',shut,'blocked',(shutBlk/Math.max(1,shut)).toFixed(2));
}
{let o=0,ob=0;for(const {k,w} of rows){const c=clrAt(w,w.bz,real(k,w));if(c>=0){o++;if(w.blk)ob++;}}console.log('real off+real ball: open',o,'blocked',(ob/o).toFixed(2));}
{let o=0,ob=0;for(const {k,w} of rows){const c=clrAt(w,w.lz,real(k,w));if(c>=0){o++;if(w.blk)ob++;}}console.log('real off+planned line: open',o,'blocked',(ob/o).toFixed(2));}
// momentum: from slide v, accelerate a either way (speed capped at ms) for tau
const disp=(v,a,ms,tau,s)=>{const vt=s*ms;const ta=Math.min(tau,Math.abs(vt-v)/a);return v*ta+0.5*Math.sign(vt-v)*a*ta*ta+vt*(tau-ta);};
console.log('--- momentum');
for(const lat of [0.03,0.06,0.1,0.14])for(const a of [600,900]){
 let open=0,openBlk=0;
 for(const {k,w} of rows){const tau=Math.max(0,T(k,w)-lat),lo=w.off0+w.vz0*Math.min(lat,T(k,w))+disp(w.vz0,a,w.ms,tau,-1),hi=w.off0+w.vz0*Math.min(lat,T(k,w))+disp(w.vz0,a,w.ms,tau,1);
  const c=clrAt(w,w.lz,[Math.min(lo,hi),Math.max(lo,hi)]);if(c>=0){open++;if(w.blk)openBlk++;}}
 console.log(('dyn lat '+lat+' a'+a).padEnd(20),'open',open,'blocked',(openBlk/Math.max(1,open)).toFixed(2));
}
console.log('--- tgt + reach share');
for(const lat of [0.03,0.06])for(const kf of [0.15,0.25,0.35]){
 let open=0,openBlk=0;
 for(const {k,w} of rows){const TT=T(k,w),g=M.tgt(k,w,TT),R=w.ms*kf*Math.max(0,TT-lat);const c=clrAt(w,w.lz,[g[0]-R,g[1]+R]);if(c>=0){open++;if(w.blk)openBlk++;}}
 console.log(('tgt+reach '+lat+' x'+kf).padEnd(22),'open',open,'blocked',(openBlk/Math.max(1,open)).toFixed(2));
}
