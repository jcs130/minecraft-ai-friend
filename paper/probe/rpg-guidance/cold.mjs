import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');const previous=JSON.parse(await fs.readFile(stage+'/rpg-guidance-guide2.json','utf8'));assert(previous.passed);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25929});const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const bot=mf.createBot({host:'127.0.0.1',port:25928,version:'1.21.11',username:previous.identity.name,auth:'offline',hideErrors:true,checkTimeoutInterval:60000});installRecipePacketBypass(bot._client);const report={checks:[],passed:false,productionChanged:false},messages=[];bot.on('messagestr',s=>messages.push(s));bot.on('error',()=>{});let ready=false;bot.once('spawn',()=>ready=true);
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};const until=async(f,name)=>{const end=Date.now()+30000;while(Date.now()<end){const v=await f();if(v)return v;await sleep(100);}throw Error('Timeout '+name);};
try{
 await until(()=>ready&&bot.world.getColumnAt(bot.entity.position),'cold spawn');await rc(`minecraft:tp ${bot.username} 1802.5 81 1802.5`);await rc(`minecraft:gamemode survival ${bot.username}`);await sleep(4000);
 check('1.21.11 reconnect retains original UUID',bot._client.uuid===previous.identity.uuid);
 check('normal cold start does not repeat delivered announcement',!messages.some(s=>s.includes('[更新 0.4.47.22')));
 const inspect=await rc(`gqa ${bot.username} inspect`);check('delivery revision and enchanted tool persisted',inspect.includes('revision=2')&&inspect.includes('enchantCount=1')&&Number(inspect.match(/damage=(\d+)/)?.[1])<100);
 const at=messages.length;bot.chat('/mycli status --json');const line=await until(()=>messages.slice(at).find(s=>s.startsWith('MC_RPG ')),'native cold profile');check('native class retained across normal stop/start',JSON.parse(line.slice(7)).class==='knight');
 const infoAt=messages.length;await sleep(1100);bot.chat('/mycli skills info fortify');const info=await until(()=>messages.slice(infoAt).find(s=>s.includes('[RPG]')),'native skill help');check('skill help explains actual target and effect',info.includes('目标：自己')&&info.includes('奥术护盾'));
 for(let i=0;i<20;i++){bot.setControlState('forward',i%2===0);bot.setControlState('back',i%2!==0);await rc(`gqa ${bot.username} gear ${i%2?'plain':'pickench'}`);await sleep(150);}bot.clearControlStates();
 check('movement and rapid equipment changes keep real connection alive',!bot._client.ended);
 report.passed=true;
}finally{bot.quit();await fs.writeFile(stage+'/rpg-guidance-cold-'+label+'.json',JSON.stringify(report,null,2));}
