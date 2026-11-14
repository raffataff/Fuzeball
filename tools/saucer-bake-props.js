// Resolve SaucerBar furniture using the same placements as the game.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const config=read('js/config.js').replace(/\r\n/g,'\n');
const configEnd=config.indexOf('\n};');
if(configEnd<0)throw new Error('Could not find the end of CONFIG');
const manifest=JSON.parse(read('assets/props/manifest.json'));
const props=vm.runInNewContext(config.slice(0,configEnd+3)+'\n'+read('js/props.js')+`
 propManifest=manifest;
 CONFIG.rooms.saucer.props.map((spec,i)=>{
  const def=propDef(spec.prop);
  if(!def)throw new Error('Unknown SaucerBar prop '+spec.prop);
  const src=(def.folder??CONFIG.props.folder??'')+def.src;
  const places=propPlacements(spec,(CONFIG.props.seed||1)+i*7919);
  return {src,def,places:places.slice(0,CONFIG.props.maxInstances||2048)};
 });
`,{manifest});
process.stdout.write(JSON.stringify(props));
