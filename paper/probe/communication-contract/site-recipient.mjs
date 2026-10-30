// Read-only protocol checks for the dedicated loopback Paper fixture only.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire('E:/MC/integrations/qiandengji-harness-20261022/body/package.json');
const mineflayer=require('mineflayer');
const output=process.argv[2];
if(!output?.startsWith('E:/MC/ops/repairs/dungeon-recipient-review-20261030/'))throw Error('Dedicated QA output required');
const bots=[],checks=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(ok,name){if(!ok)throw Error(name);checks.push(name);}
async function ask(bot,text,prefix){
 await pause(1300);const start=bot.received.length;bot.chat(text);const until=Date.now()+7000;
 while(Date.now()<until){const found=bot.received.slice(start).find(s=>s.startsWith(prefix));if(found)return found;await pause(100);}
 throw Error('Missing response '+prefix);
}
try{
 for(const username of ['ag_TrialAlice','ag_TrialBob']){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:29395,username,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);bot.received=[];
  bot.on('messagestr',text=>bot.received.push(text));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),20000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);});
 }
 const [alice,bob]=bots;const bobStart=bob.received.length;
 for(const [text,prefix,id]of[
  ['/mycli dungeon list --json','MC_SITE_DUNGEON_LIST ',null],
  ['/mycli dungeon info undead_crypt --json','MC_SITE_DUNGEON_INFO ','undead_crypt'],
  ['/mycli dungeon status undead_crypt --json','MC_SITE_DUNGEON_STATE ','undead_crypt'],
  ['/mycli dungeon status unknown_qa_site --json','MC_SITE_DUNGEON_RESULT ',null]
 ]){
  const data=JSON.parse((await ask(alice,text,prefix)).slice(prefix.length));
  check(data.recipient===alice.username,'actual recipient '+prefix.trim());
  check(data.schemaVersion===1&&data.commandRoot==='/mycli dungeon'&&data.activityType==='site_dungeon','routing fields retained '+prefix.trim());
  if(id)check(data.id===id,'requested dungeon ID retained '+id);
 }
 check(!bob.received.slice(bobStart).some(s=>s.startsWith('MC_SITE_DUNGEON_')),'Alice queries are not sent to Bob');
 const prefix='MC_SITE_DUNGEON_STATE ';const reply=JSON.parse((await ask(bob,'/mycli dungeon status undead_crypt --json',prefix)).slice(prefix.length));
 check(reply.recipient===bob.username&&reply.recipient!==alice.username,'Bob response bound to Bob');
 await pause(1300);const start=alice.received.length;alice.chat('/mycli dungeon status undead_crypt');await pause(650);
 check(alice.received.slice(start).some(s=>s.includes('[地下城]'))&&!alice.received.slice(start).some(s=>s.startsWith('MC_SITE_DUNGEON_')),'default status stays concise text, JSON explicit');
 const result={passed:true,checks,productionConnected:false,gameplayActions:false};await fs.writeFile(output+'/network.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{for(const bot of bots)bot.quit('read-only protocol QA complete');}
