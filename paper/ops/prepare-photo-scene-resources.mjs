import fs from 'node:fs/promises';import path from 'node:path';import {saveSceneResource} from './native-photo-scene-resources.mjs';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];const game=arg('--game-dir'),assets=arg('--assets-dir'),manifest=arg('--manifest');
if(!['--game-dir','--assets-dir','--manifest'].every(x=>args.includes(x))||![game,assets,manifest].every(path.isAbsolute))throw Error('Use absolute --game-dir, --assets-dir and --manifest paths');
const root=await fs.realpath(path.join(game,'mods')),resources=[];
for(const entry of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(!entry.isFile()||!entry.name.endsWith('.jar'))continue;const file=await fs.realpath(path.join(root,entry.name));if(path.dirname(file)!==root)throw Error('Native mod resource path');const stat=await fs.stat(file);if(stat.size>128*1024*1024||resources.length>=40)throw Error('Native resource budget');resources.push(await saveSceneResource(assets,await fs.readFile(file),entry.name));
}
if(!resources.length)throw Error('No actual native mods');
const options=Object.fromEntries((await fs.readFile(path.join(game,'options.txt'),'utf8')).split(/\r?\n/).flatMap(line=>{const i=line.indexOf(':');return i>0&&['fov','gamma','renderDistance','simulationDistance','entityDistanceScaling','bobView','fovEffectScale'].includes(line.slice(0,i))?[[line.slice(0,i),line.slice(i+1)]]:[];}));
const info=Buffer.from(JSON.stringify({schema:'mc-native-camera-runtime/v1',minecraftVersion:'1.21.1',options,resources}));resources.push(await saveSceneResource(assets,info,'native-camera-runtime.json'));
await fs.mkdir(path.dirname(manifest),{recursive:true});await fs.writeFile(manifest,JSON.stringify({schema:'mc-camera-resources/v1',resources}),{flag:'wx',mode:0o600});
console.log(JSON.stringify({saved:true,resources:resources.length,bytes:resources.reduce((n,r)=>n+r.bytes,0),privateAssetsOnly:true}));
