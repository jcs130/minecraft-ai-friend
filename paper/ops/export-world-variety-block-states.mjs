// Run from a checkout with minecraft-data + prismarine-block installed.
// Export exactly the target protocol's vanilla block states for CTOV rules.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const [moduleRoot, output] = process.argv.slice(2);
if(!moduleRoot || !output)throw Error('Usage: node export-world-variety-block-states.mjs <package.json> <new-output.json>');
const require=createRequire(moduleRoot),data=require('minecraft-data')('1.21.1'),Block=require('prismarine-block')('1.21.1');
const states={};
for(const block of data.blocksArray) {
  states['minecraft:'+block.name]=[];
  for(let id=block.minStateId;id<=block.maxStateId;id++)states['minecraft:'+block.name].push(Block.fromStateId(id,0).getProperties());
}
fs.writeFileSync(output,JSON.stringify(states),{flag:'wx'});
console.log(JSON.stringify({version:data.version.minecraftVersion,blocks:Object.keys(states).length}));
