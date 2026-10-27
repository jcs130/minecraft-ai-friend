/** Native NPCSpeak + existing CLI dialogue, isolated Paper only. */
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));
assert.match(await fs.readFile(stage+'/server.properties','utf8'),/motd=QD_AINCRAD_CONQUEST_QA_ONLY/);
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const mf=require('mineflayer'),{Vec3}=require('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),bots=[],ownedChunks=[],report={checks:[],errors:[],receipts:[],mockRequests:[],productionModified:false};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
const rc=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25925});report.receipts.push({q,t});return t;};
const ids=['aincrad_guild','aincrad_mentor','aincrad_scout'];
const profile=async id=>yaml.load(await fs.readFile(stage+'/plugins/NPCSpeak/npcs/'+id+'.yml','utf8'));
const mock=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 let data='';for await(const b of req){data+=b;if(data.length>16000){res.writeHead(413).end();return;}}
 try{const body=JSON.parse(data);report.mockRequests.push({url:req.url,messages:body.messages});
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'【对话验收】先查 /mycli status，再按当前阶段准备冒险；聊天不会代发奖励。'}}]}));
 }catch{res.writeHead(400).end();}
});
async function bot(username){
 const b=mf.createBot({host:'127.0.0.1',port:25924,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,checkTimeoutInterval:60000});bots.push(b);b.messages=[];
 b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push(JSON.stringify(e)));installRecipePacketBypass(b._client);
 await Promise.race([new Promise(r=>b.once('spawn',r)),wait(30000).then(()=>{throw Error('spawn timeout');})]);return b;
}
try{
 await new Promise((r,j)=>mock.once('error',j).listen(25926,'127.0.0.1',r));
 const a=await bot('NpcGuideQA20'),witness=await bot('NpcWitnessQA20');await wait(600);
 if(!label.startsWith('cold')){
  // Old failed fixtures stood in a doorway. Load only their bounded chunks,
  // then native reload replaces those bodies at the surveyed clear locations.
  const moves=JSON.parse(await fs.readFile(stage+'/npc-fixture-relocation.json','utf8')),chunks=new Map();
  for(const move of moves)for(const p of [move.old,move.new])chunks.set((Math.floor(p.x/16))+','+(Math.floor(p.z/16)),[Math.floor(p.x),Math.floor(p.z)]);
  for(const [x,z] of chunks.values()){
   const status=await rc(`minecraft:execute in minecraft:aincrad run minecraft:forceload query ${x} ${z}`);
   assert(/(?:not marked|is marked)/.test(status),'Unrecognized force-load status');
   if(status.includes('not marked')){await rc(`minecraft:execute in minecraft:aincrad run minecraft:forceload add ${x} ${z}`);ownedChunks.push([x,z]);}
  }
  await wait(1000);await rc('npcspeak reload');await wait(600);
 }
 let list=await rc('npcspeak list');check('all three fixed guide IDs loaded',ids.every(id=>list.includes(id)));
 for(const id of ids){
  const cfg=await profile(id),p=cfg.location;
  check(id+' has a real entity UUID',/^[0-9a-f-]{36}$/.test(cfg['entity-uuid']||''));
  // Use MV's native console destination. A nested vanilla /execute ... /tp is
  // still a player command teleport and correctly needs learned travel/mana.
  await rc(`mv tp ${a.username} e:aincrad:${p.x+1.5},${p.y},${p.z}`);
  await rc(`mv tp ${witness.username} e:aincrad:${p.x+3},${p.y},${p.z}`);await wait(1100);
  check(id+' player really reaches the target world',(await rc('minecraft:data get entity '+a.username+' Dimension')).includes('minecraft:aincrad')&&a.entity.position.distanceTo({x:p.x+1.5,y:p.y,z:p.z})<2);
  await Promise.race([a.waitForChunksToLoad(),wait(15000).then(()=>{throw Error('target chunks not loaded');})]);
  const base=new Vec3(Math.floor(p.x),p.y,Math.floor(p.z)),blocks=[a.blockAt(base.offset(0,-1,0)),a.blockAt(base),a.blockAt(base.offset(0,1,0))];
  report.receipts.push({id,playerPosition:a.entity.position,npcSurface:blocks.map(b=>b&&{name:b.name,boundingBox:b.boundingBox,shapes:b.shapes})});
  check(id+' has a solid accessible standing surface',blocks[0]?.shapes.some(s=>s[4]===1)&&blocks[1]?.shapes.length===0&&blocks[2]?.shapes.length===0);
  let pos='';for(let n=0;n<12;n++){pos=await rc('minecraft:execute in minecraft:aincrad run minecraft:data get entity '+cfg['entity-uuid']+' Pos');if(pos.includes('entity data:'))break;await wait(500);}
  if(!pos.includes('entity data:')){
   report.receipts.push({dimension:await rc('minecraft:data get entity '+a.username+' Dimension'),localVillagers:await rc(`minecraft:execute in minecraft:aincrad positioned ${p.x} ${p.y} ${p.z} as @e[type=minecraft:villager,distance=..8] run minecraft:data get entity @s UUID`),clientEntities:Object.values(a.entities).filter(e=>e.name==='villager').map(e=>({id:e.id,uuid:e.uuid,position:e.position}))});
  }
  const numbers=pos.match(/entity data:\s*\[([^\]]+)\]/)?.[1].split(',').map(s=>Number(s.trim().replace(/d$/,'')));
  check(id+' remains on its surveyed ground',numbers?.length===3&&Math.abs(numbers[0]-p.x)<0.5&&Math.abs(numbers[1]-p.y)<0.2&&Math.abs(numbers[2]-p.z)<0.5);
  check(id+' protected from ordinary damage',(await rc('minecraft:execute in minecraft:aincrad run minecraft:data get entity '+cfg['entity-uuid']+' Invulnerable')).includes('1b'));
  check(id+' is visible in the unmodified entity stream',Object.values(a.entities).some(e=>e.uuid===cfg['entity-uuid']&&e.name==='villager'));
  const local=await rc(`minecraft:execute in minecraft:aincrad positioned ${p.x} ${p.y} ${p.z} as @e[type=minecraft:villager,distance=..1] run minecraft:data get entity @s UUID`);
  check(id+' has exactly one body',(local.match(/following entity data:/g)||[]).length===1);
  const start=a.messages.length,other=witness.messages.length,calls=report.mockRequests.length;
  a.chat('/mycli world talk '+id+' 你好，我想去冒险，下一步是什么？');
  for(let n=0;n<100&&!a.messages.slice(start).some(s=>s.includes('【对话验收】'));n++)await wait(100);
  check(id+' returns an actual AI backend reply through existing CLI',a.messages.slice(start).some(s=>s.includes('【对话验收】'))&&report.mockRequests.length===calls+1);
  check(id+' dialogue does not broadcast to another player',!witness.messages.slice(other).some(s=>s.includes('【对话验收】')));
  a.chat('/mycli world end');await wait(1300);
 }
 const directoryStart=a.messages.length;a.chat('/mycli world npcs');await wait(700);
 const directory=a.messages.slice(directoryStart).find(s=>s.startsWith('MC_WORLD ')&&s.includes('"type":"npcs"'));
 report.directory=directory?JSON.parse(directory.slice(9)):null;
 check('existing NPC directory discovers names, locations and dialogue command',report.directory?.talkRange===8&&ids.every(id=>report.directory.npcs.some(n=>n.id===id&&n.world==='aincrad'&&n.command.includes('/mycli world talk '+id))));
 const before=Object.fromEntries(await Promise.all(ids.map(async id=>[id,(await profile(id))['entity-uuid']])));
 await rc('npcspeak reload');await wait(700);
 list=await rc('npcspeak list');check('native reload preserves all stable NPC IDs',ids.every(id=>list.includes(id)));
 for(const id of ids){const cfg=await profile(id);check(id+' is live after reload',(await rc('minecraft:execute in minecraft:aincrad run minecraft:data get entity '+cfg['entity-uuid']+' Invulnerable')).includes('1b'));}
 const after=Object.fromEntries(await Promise.all(ids.map(async id=>[id,(await profile(id))['entity-uuid']])));
 report.nativeReloadRecreatesEntityUuids={before,after};
 report.dialogueMessages=a.messages;report.witnessMessages=witness.messages;
 check('canary clients stay connected',bots.every(b=>b._client.state==='play'));
}catch(e){report.errors.push(e.stack||String(e));}
finally{
 for(const [x,z] of ownedChunks)await rc(`minecraft:execute in minecraft:aincrad run minecraft:forceload remove ${x} ${z}`);
 for(const b of bots)b.quit();await new Promise(r=>mock.close(r));
 await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,backendReplies:report.mockRequests.length}));process.exit(report.errors.length?1:0);
}
