import {sharp,P} from './pitchlib.mjs';
const dir='assets/tables/circuit/synaptic_relic/';
const rail=await sharp(P(dir,'rail_source_v3.png')).resize(1536,512).png().toBuffer();
const mirror=await sharp(rail).flop().png().toBuffer();
await sharp({create:{width:3072,height:512,channels:3,background:'#000'}}).composite([{input:rail,left:0,top:0},{input:mirror,left:1536,top:0}]).png().toFile(P(dir,'rail_art_v3.png'));
await sharp(P(dir,'inside_source_v3.png')).extract({left:0,top:95,width:2172,height:255}).resize(2048,240).png().toFile(P(dir,'inside_art_v3.png'));
await sharp(P(dir,'goal_source_v3.png')).extract({left:0,top:35,width:2172,height:510}).resize(2048,481).png().toFile(P(dir,'goal_art_v3.png'));
