/** Native protocol already carries world names; prove it without a new server identity protocol. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const root='E:/MC/ops/repairs/proximity-chat-20261029',qa=root+'/qa';assert.equal(await fs.readFile(qa+'/.qa-only','utf8'),'QIANDENGJI_CHAT_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const rc=q=>command(q,12000,{port:29087,properties:qa+'/server.properties'});
const until=async f=>{for(let n=0;n<250;n++){if(await f())return;await sleep(100);}throw Error('QA timed out');};
const report={passed:false,productionChanged:false,packets:[],checks:[],mineflayerDimensions:[]};let bot;
try{
 bot=mf.createBot({host:'127.0.0.1',port:29086,username:'ChatQAA',auth:'offline',version:'1.21.1',hideErrors:true});bot.on('error',()=>{});installRecipePacketBypass(bot._client);
 for(const type of ['login','respawn'])bot._client.on(type,p=>report.packets.push({packet:type,worldState:p.worldState?{name:p.worldState.name,dimension:p.worldState.dimension}:null,worldName:p.worldName??null}));
 await until(()=>bot.entity);bot.physicsEnabled=false;const write=bot._client.write.bind(bot._client);bot._client.write=(n,d)=>['position','position_look','look','flying'].includes(n)?undefined:write(n,d);
 assert(report.packets.some(p=>p.packet==='login'&&typeof p.worldState?.name==='string'));report.checks.push('login carries independent native world name');
 for(const world of ['world','aincrad','world']){
  const index=report.packets.length;await rc('chatqa at ChatQAA '+world+' 0 70 0');
  if(world==='aincrad'||index>1)await until(()=>report.packets.length>index);
  await sleep(300);report.mineflayerDimensions.push({serverWorld:world,mineflayerDimension:bot.game.dimension,latestNativeWorldName:report.packets.at(-1)?.worldState?.name});
 }
 const names=report.packets.map(p=>p.worldState?.name);
 assert(names.includes('minecraft:overworld')&&names.includes('minecraft:aincrad'));report.checks.push('two NORMAL worlds have distinct native worldState.name');
 const aincrad=report.packets.find(p=>p.worldState?.name==='minecraft:aincrad'),overworld=report.packets.find(p=>p.worldState?.name==='minecraft:overworld');
 assert.equal(aincrad.worldState.dimension,overworld.worldState.dimension);report.checks.push('dimension type can remain equal while actual world name differs');
 assert.equal(report.packets.at(-1).worldState.name,'minecraft:overworld');report.checks.push('world switch back restores the original native name');
 report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{bot?.quit('Native protocol identity QA complete');await fs.writeFile(root+'/native-world.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
