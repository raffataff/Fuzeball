// Companion pitch for the Obsidian Volt Circuit skin.
import { L, WD, W, H, PPU, clamp, sstep, hash, lineDist, spot, writePitch } from './pitchlib.mjs';

const a=Buffer.alloc(W*H*3), n=Buffer.alloc(W*H*3), m=Buffer.alloc(W*H*3);
for(let j=0;j<H;j++) for(let i=0;i<W;i++){
 const x=-L/2+(i+.5)/PPU, z=-WD/2+(j+.5)/PPU, k=(j*W+i)*3;
 const grain=hash(i*.71,j*.67), noise=hash(Math.floor(i/23),Math.floor(j/23));
 const line=Math.max(1-sstep(.08,.19,lineDist(x,z)),1-sstep(0,.13,spot(x,z)));
 const wash=.9+.1*noise+.035*grain;
 const base=[7,21,34], paint=[49,124,138];
 for(let c=0;c<3;c++)a[k+c]=clamp(Math.round(base[c]*wash*(1-line)+paint[c]*line),0,255);
 n[k]=128;n[k+1]=128;n[k+2]=255;
 m[k]=255;m[k+1]=Math.round(108+grain*9);m[k+2]=25;
}
await writePitch('obsidian_volt',a,n,m,.08);
