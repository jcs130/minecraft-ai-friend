/** Real talent learning and native combat certification; marked loopback only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const label=process.argv[2];assert(/^(?:extra|coldextra)[a-z0-9]{1,6}$/.test(label));
const suffix=label.replace(/^(?:extra|coldextra)/,''),name='ag_VTseed'+suffix;
const report={checks:[],errors:[],messages:[],productionChanged:false},wait=ms=>new Promise(r=>setTimeout(r,ms));let bot,last=0;
const check=(name,value)=>{assert(value,name);report.checks.push(name);};
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function until(fn,label,ms=15000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(100);}throw Error(label+' timeout');}
async function ask(q,pattern=/MC_RPG|\[RPG\]/){await wait(Math.max(0,1100-(Date.now()-last)));last=Date.now();const n=report.messages.length;bot.chat(q);await until(()=>report.messages.slice(n).some(s=>pattern.test(s)),q);return report.messages.slice(n).join('\n');}
async function json(q,prefix='MC_RPG '){const s=await ask(q,new RegExp(prefix));return JSON.parse(s.split('\n').find(t=>t.startsWith(prefix)).slice(prefix.length));}
async function health(){const s=await rc('minecraft:attribute '+name+' minecraft:generic.max_health get');const n=Number(s.match(/(-?\d+(?:\.\d+)?)$/)?.[1]);assert(Number.isFinite(n),s);return n;}
try{
 const beforeLedger=await fs.readFile(stage+'/plugins/AgentFriend/profession-ledger.json');
 const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});
 bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',s=>report.errors.push(JSON.stringify(s)));installRecipePacketBypass(bot._client);
 await until(()=>bot.entity,'spawn',30000);await bot.waitForChunksToLoad();await wait(1600);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
 const native=await json('/mycli status --json');check('same existing native role',native.class==='knight');
 const tree=await json('/mycli skills tree --json');check('Chinese talent tree is readable',tree.nodes.iron_skin.displayName==='铁肤');
 if(label.startsWith('cold')){
  check('talent persists after normal restart',tree.allocated.knight.includes('iron_skin'));
  const book=JSON.parse(await fs.readFile(stage+'/plugins/AgentFriend/adventure-certificates.json','utf8'));
  check('native exam certificate persists after restart',!!book.players[bot._client.uuid].academy.certificates.combat_basic);
 }else{
  check('actual level-up granted native talent point',tree.talentPoints>=1);
  const before=await health();await ask('/mycli skills learn iron_skin',/天赋已学习并保存|失败|足/);await wait(250);
  const after=await health();report.health={before,after};check('talent changes actual max health',after>before);
  const learned=await json('/mycli skills tree --json');check('talent point really spent',learned.talentPoints===tree.talentPoints-1&&learned.allocated.knight.includes('iron_skin'));
  await ask('/mycli skills learn iron_skin',/已经|已解锁|Already|RPG/);const repeat=await json('/mycli skills tree --json');check('duplicate talent does not spend again',repeat.talentPoints===learned.talentPoints);
  const common=await ask('/mycli skills list common');check('old common list grammar retained',common.includes('无需重复学习')&&common.includes('prospect'));
  bot.chat('/mycli guild join');await wait(1400);
  const eligibility=await json('/mycli guild exam info combat_basic --json','MC_GUILD_EXAM ');check('native combat exam actually available',eligibility.eligibility==='ready');
  const started=await json('/mycli guild exam start combat_basic','MC_GUILD_EXAM ');check('new exam starts in independent ledger',started.state==='active');
  await ask('/mycli cast fortify',/技能已执行|RPG/);
  const incomplete=await json('/mycli guild exam status --json','MC_GUILD_EXAM ');check('a cast alone cannot pass the combat exam',incomplete.state==='active');
  await bot.equip(bot.inventory.items().find(i=>i.name==='diamond_sword'),'hand');const p=bot.entity.position.floored();
  await rc(`execute at ${name} run summon zombie ${p.x+2} ${p.y} ${p.z} {Tags:["qd_native_exam"],NoAI:1b,Health:1.0f}`);await wait(500);
  const mob=Object.values(bot.entities).find(e=>e.name==='zombie'&&e.position.distanceTo(bot.entity.position)<4);assert(mob,'real nearby hostile');bot.attack(mob);await wait(800);
  const ready=await json('/mycli guild exam status --json','MC_GUILD_EXAM ');check('actual cast plus real kill make exam ready',ready.state==='ready');
  await ask('/mycli guild exam submit',/通过|交卷|MC_GUILD_EXAM/);
  const book=JSON.parse(await fs.readFile(stage+'/plugins/AgentFriend/adventure-certificates.json','utf8'));check('certificate really saved',!!book.players[bot._client.uuid].academy.certificates.combat_basic);
  const progress=await ask('/mycli progress',/冒险|RPG/);check('progress links rank exam and exploration',progress.includes('冒险')&&progress.includes('考试')&&progress.includes('探索'));
 }
 check('old profession file stays byte exact',beforeLedger.equals(await fs.readFile(stage+'/plugins/AgentFriend/profession-ledger.json')));
}catch(e){report.errors.push(e.stack);}finally{bot?.quit();await wait(400);await fs.writeFile(stage+'/progression-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));}
process.exit(report.errors.length?1:0);
