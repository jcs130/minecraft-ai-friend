// Export the actual 1.21.1 Prismarine collision data. No unknown-state fallback.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const [dependencies,input,output]=process.argv.slice(2);
if(!dependencies||!input||!output)throw Error('usage: node export-collisions.mjs <dependency-package.json> <states.json> <output.json>');
const require=createRequire(path.resolve(dependencies));
const Block=require('prismarine-block')('1.21.1');
const states=JSON.parse(await fs.readFile(input,'utf8')),shapes={},unknown=[];
for(const state of states){
  const key=state.name+'['+Object.entries(state.properties??{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join(',')+']';
  try{
    const block=Block.fromProperties(state.name.replace('minecraft:',''),state.properties??{},0);
    if(!block||'minecraft:'+block.name!==state.name)throw Error('unknown block');
    shapes[key]=block.shapes;
  }catch(error){unknown.push({key,error:String(error.message)});}
}
await fs.writeFile(output,JSON.stringify({schemaVersion:1,minecraftVersion:'1.21.1',shapes,unknown}));
console.log(JSON.stringify({states:Object.keys(shapes).length,unknown}));
if(unknown.length)process.exitCode=1;
