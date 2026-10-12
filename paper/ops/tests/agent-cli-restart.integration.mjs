// Run after a normal stop/start of the isolated fixture used by observations test A.
// Reads the saved player, real inventory and native Minepacks without moving items.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../rcon-client.mjs';
import {fix1206PotionProtocol} from '../minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../mineflayer-client-compat.mjs';
import {installInventorySession} from '../mineflayer-inventory-session.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
assert.equal(Number(props.match(/^server-port=(\d+)/m)?.[1]),25660);
const before=JSON.parse(fs.readFileSync(root+'/observations-a.json','utf8'));
assert(before.passed,'test A must have passed before the restart');
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(require);
const mf=require('mineflayer');
const report={at:new Date().toISOString(),scope:'isolated normal restart persistence, native MF; no production data',checks:[],lines:[],errors:[]};
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.29.jar')).digest('hex');
let bot,closing=false;
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert(value,name);console.log('PASS '+name);};
async function until(fn,name){const end=Date.now()+15000;while(Date.now()<end){const v=fn();if(v)return v;await sleep(40);}throw Error('Timeout '+name);}
async function ask(q,prefix){await sleep(1100);const at=report.lines.length;bot.chat(q);
  return until(()=>report.lines.slice(at).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).find(Boolean),q);}
try{
  check('final candidate active',(await command('version AgentFriend',15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])})).includes('0.4.29'));
  bot=mf.createBot({host:'127.0.0.1',port:25660,username:'ag_Cli29A',version:'1.20.6',auth:'offline',defaultChatPatterns:false,logErrors:false});
  installRecipePacketBypass(bot._client);bot.on('messagestr',s=>report.lines.push(s));bot.on('error',e=>{if(!closing)report.errors.push(e.stack);});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn')),30000);bot.once('spawn',()=>{clearTimeout(timer);bot.physicsEnabled=false;resolve();});bot.once('error',reject);});await sleep(3800);
  const state=await ask('/mycli status','MC_STATUS');
  check('saved UUID retained and observation session renewed',state.playerUuid===before.ag_Cli29A.uuid&&state.sessionId!==before.sessionId);
  check('old authentication cannot claim success after restart',state.authentication.authorized===null);
  const skill=await ask('/mycli skills status fireworks','MC_PAGE');
  check('learned skill survives normal restart',skill.items[0].learned&&skill.items[0].level===1);
  let page=await ask('/mycli progress training 1','MC_PAGE'),backpack;
  while(true){backpack??=page.items.find(x=>x.id==='backpack');if(!page.nextCommand)break;page=await ask(page.nextCommand,'MC_PAGE');}
  check('saved voluntary enrollment and completed backpack proof retained',backpack?.enrolled&&backpack.done);
  check('specialized completion does not graduate mainline',state.mainlineGraduated===false);
  check('returned eight paper persist in real inventory',bot.inventory.items().filter(i=>i.name==='paper').reduce((n,i)=>n+i.count,0)===8);
  const inv=installInventorySession(bot,{Item:require('prismarine-item')(bot.registry),timeoutMs:5000,quietMs:100});
  const open=await inv.open();
  check('own native backpack persists without duplicated deposits',open.status==='opened'&&open.snapshot.inventoryStart===54&&open.snapshot.slots.slice(0,54).every(item=>!item)&&open.snapshot.cursor===null);
  await inv.close();check('no native protocol errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{closing=true;bot?.quit();await sleep(500);report.passed=report.errors.length===0&&report.checks.every(r=>r.pass);fs.writeFileSync(root+'/observations-restart.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
