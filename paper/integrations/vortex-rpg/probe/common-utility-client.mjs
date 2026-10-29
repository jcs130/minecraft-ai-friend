/** Native mana plus the existing remote personal chest, real vanilla windows. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const label=process.argv[2]??'common';assert(/^[a-z0-9]+$/.test(label));
const report={checks:[],errors:[],messages:[],snapshots:[],productionChanged:false};let bot,last=0;
const check=(name,value)=>{assert(value,name);report.checks.push(name);};
async function until(f,label){for(let n=0;n<150;n++){if(await f())return;await wait(100);}throw Error(label+' timeout');}
async function ask(q,pattern=/RPG|MC_RPG/){await wait(Math.max(0,1100-(Date.now()-last)));last=Date.now();const n=report.messages.length;bot.chat(q);await until(()=>report.messages.slice(n).some(s=>pattern.test(s)),q);return report.messages.slice(n).join('\n');}
async function open(){await wait(Math.max(0,1100-(Date.now()-last)));last=Date.now();bot.chat('/mycli arena stash');await until(()=>bot.currentWindow,'real personal chest window');await wait(300);return bot.currentWindow;}
const count=()=>{const w=bot.currentWindow;return (w?w.slots.slice(w.inventoryStart):bot.inventory.items()).filter(v=>v?.name==='cobblestone').reduce((n,v)=>n+v.count,0);};
async function serverCount(){const result=await command('minecraft:clear '+bot.username+' minecraft:cobblestone 0',10000,{port:25929,properties:stage+'/server.properties'});const value=result.match(/Found (\d+) matching/);assert(value,'actual read-only inventory count: '+result);report.snapshots.push({activeWindowCount:count(),inventory0Count:bot.inventory.items().filter(v=>v.name==='cobblestone').reduce((n,v)=>n+v.count,0),serverCount:Number(value[1]),cursor:(bot.currentWindow??bot.inventory).selectedItem?.name??null});return Number(value[1]);}
try{
 bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:'ag_VU'+label,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});
 bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));installRecipePacketBypass(bot._client);
 await until(()=>bot.entity,'spawn');await bot.waitForChunksToLoad();await wait(1500);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
 check('class not required for common travel',(await ask('/mycli status --json',/MC_RPG/)).includes('"none"'));
 const info=await ask('/mycli skills info travel --json',/MC_RPG/);check('common skill is explicitly learned',info.includes('"learned":true'));
 check('old learn command is harmless for a common skill',(await ask('/mycli skills learn travel')).includes('无需重复学习'));
 await command('minecraft:give '+bot.username+' minecraft:cobblestone 7',10000,{port:25929,properties:stage+'/server.properties'});await wait(350);
 const before=count(),type=bot.registry.itemsByName.cobblestone.id;let window=await open();
 check('real remote personal box opened',window.slots.length>54);await window.deposit(type,null,3);await until(()=>count()===before-3,'confirmed deposit');check('deposit changed active-window player inventory',count()===before-3);check('deposit confirmed by actual server inventory',await serverCount()===before-3);check('cursor empty after deposit',!window.selectedItem);
 bot.closeWindow(window);await wait(300);window=await open();check('stored item survived closing and reopening',window.slots.slice(0,54).some(v=>v?.name==='cobblestone'&&v.count>=3));
 await window.withdraw(type,null,3);await until(()=>count()===before,'confirmed withdrawal');check('withdrawal returned exact amount',count()===before);check('withdrawal confirmed by actual server inventory',await serverCount()===before);check('cursor empty after withdrawal',!window.selectedItem);bot.closeWindow(window);
 check('same native mana authority remains',(await ask('/mycli status --json',/MC_RPG/)).includes('VortexRPG'));
}catch(e){report.errors.push(e.stack);}finally{bot?.quit();await wait(500);await fs.writeFile(stage+'/common-utility-receipt-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,snapshots:report.snapshots,errors:report.errors}));}process.exit(report.errors.length?1:0);
