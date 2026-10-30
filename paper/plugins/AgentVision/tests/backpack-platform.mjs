import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
const[stage,out]=process.argv.slice(2);assert.equal(stage.replaceAll('\\','/'),'E:/MC/staging/aincrad-architecture-youer-20261030');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),rc=q=>command(q,15000,{properties:stage+'/server.properties',port:29398});
const name='ag_BP1030Fix',bots=[],report={passed:false,checks:[]},check=(label,ok)=>{assert(ok,label);report.checks.push(label);console.log('PASS '+label);};
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
async function connect(){await sleep(4200);const b=require('mineflayer').createBot({host:'127.0.0.1',port:29397,username:name,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:30000});bots.push(b);b.errors=[];b.texts=[];b.on('messagestr',t=>b.texts.push(t));b.on('error',e=>b.errors.push(e.message));b.on('kicked',e=>b.kick=JSON.stringify(e));await until(()=>b.entity,'real client spawn');await rc('minecraft:op '+name);await rc('minecraft:gamemode survival '+name);await sleep(1500);return b;}
async function clickShortcut(b){const item=b.inventory.items().find(i=>i.name==='player_head'&&/minepacks|大背包|Backpack/i.test(JSON.stringify(i)));assert(item,'Actual issued backpack shortcut head required');report.shortcut={name:item.name,slot:item.slot};await b.equip(item,'hand');b.activateItem();await sleep(500);if(!b._client.ended&&!b.currentWindow){const ground=b.blockAt(b.entity.position.offset(0,-1,0));assert(ground&&ground.name!=='air','Real in-reach block required for right click');await b.activateBlock(ground).catch(error=>{if(!b._client.ended)throw error;});}}
try{
 const config=stage+'/plugins/Minepacks/config.yml';assert.match(fs.readFileSync(config,'utf8'),/^UseDynamicTitle: true\r?$/m);
 let b=await connect();await clickShortcut(b);await until(()=>b._client.ended,'baseline disconnect');check('original right-click reproduces open_screen kick',b.kick?.includes('open_screen'));
 const original=fs.readFileSync(config,'utf8');assert.match(original,/^Database:\r?$/m);fs.writeFileSync(config,original.replace(/^UseDynamicTitle: true\r?$/m,'UseDynamicTitle: false').replace(/^Database:\r?$/m,'Database:\n  UseDynamicTitle: false'));
 report.reload=await rc('minepacks:backpack reload');check('official Minepacks config reload acknowledged',/reload|重新|加载/i.test(report.reload));
 b=await connect();await clickShortcut(b);await until(()=>b.currentWindow,'fixed right-click window');check('same existing player opens all 54 slots',b.currentWindow.inventoryStart===54);b.closeWindow(b.currentWindow);await sleep(3500);
 await rc('minecraft:give '+name+' cobblestone 7');await clickShortcut(b);await until(()=>b.currentWindow,'open for storage');
 const w=b.currentWindow,type=require('minecraft-data')('1.21.1').itemsByName.cobblestone.id;
 await b.transfer({window:w,itemType:type,metadata:null,count:7,sourceStart:w.inventoryStart,sourceEnd:w.inventoryEnd,destStart:0,destEnd:54});
 await sleep(1000);report.serverDeposit=await rc('backpackplatformstatus');check('server inventory contains deposited items',/size=54 stored=(?:[7-9]|[1-9]\d+)/.test(report.serverDeposit));
 await until(()=>w.slots.slice(0,54).filter(Boolean).reduce((n,i)=>n+(i.name==='cobblestone'?i.count:0),0)>=7,'server acknowledged stored items');check('real item deposit acknowledged',true);b.closeWindow(w);await sleep(700);b.quit();await sleep(1000);
 b=await connect();await clickShortcut(b);await until(()=>b.currentWindow,'persistent reopen');await until(()=>b.currentWindow.slots.slice(0,54).filter(Boolean).reduce((n,i)=>n+(i.name==='cobblestone'?i.count:0),0)>=7,'server sends persisted backpack contents');check('backpack items survive actual disconnect and reconnect',true);
 b.closeWindow(b.currentWindow);await sleep(3500);b.chat('/minepacks:backpack open');await until(()=>b.currentWindow,'command open');check('command and shortcut use valid registered menu',b.currentWindow.inventoryStart===54&&!b._client.ended&&b.errors.length===0);
 report.passed=true;
}catch(error){report.error=String(error.stack);throw error;}
finally{report.clients=bots.map(b=>({texts:b.texts.slice(-16),errors:b.errors,kick:b.kick,heldItem:b.heldItem?.name,window:b.currentWindow?.id}));for(const b of bots)if(!b._client.ended)b.quit();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
