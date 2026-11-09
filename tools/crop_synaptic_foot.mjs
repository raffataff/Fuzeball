import {sharp} from './pitchlib.mjs';
await sharp('assets/tables/circuit/synaptic_relic/panel_art_v2.png').extract({left:768,top:0,width:512,height:512}).resize(1024,1024).png().toFile('assets/tables/circuit/synaptic_relic/foot_art_v3.png');
