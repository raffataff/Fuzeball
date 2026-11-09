import {sharp} from './pitchlib.mjs';
await sharp('assets/tables/circuit/synaptic_relic/panel_source_v2.png').extract({left:0,top:0,width:2172,height:553}).resize(2048,512).png().toFile('assets/tables/circuit/synaptic_relic/panel_art_v2.png');
