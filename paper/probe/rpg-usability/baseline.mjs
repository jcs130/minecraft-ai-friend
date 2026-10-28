/** Exploratory receipts and actual state; this is not a passing acceptance suite. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,8}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={exploratory:true,receipts:[],states:[],productionChanged:false};let bot,last=0;
const until=async(f,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await sleep(100);}throw Error('timeout '+label);};
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function connect(suffix,x){const b=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RU'+suffix+label,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});b.messages=[];bots.push(b);b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.receipts.push({clientError:String(e)}));installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn');b.physicsEnabled=false;await rc(`minecraft:gamemode survival ${b.username}`);await rc(`minecraft:tp ${b.username} ${x}.5 81 1802.5`);await sleep(1200);return b;}
async function ask(q,expected=/MC_RPG |\[RPG\]|\[技能\]/){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=bot.messages.length;bot.chat(q);try{await until(()=>bot.messages.slice(at).some(s=>expected.test(s)),q,5000);}catch{}await sleep(180);const text=bot.messages.slice(at).join('\n');report.receipts.push({player:bot.username,q,text});return text;}
async function json(q){return JSON.parse((await ask(q)).split('\n').find(s=>s.startsWith('MC_RPG ')).slice(7));}
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:time set midnight');
 bot=await connect('k',1802);await ask('/mycli cast fortify --json');await ask('/mycli profession choose knight --json');await ask('/mycli profession choose mage --json');
 const skills=await json('/mycli skills list --json');report.states.push({skills});
 if(skills.learnable?.length){const node=skills.learnable.at(-1).id;await ask('/mycli skills info '+node+' --json');await ask('/mycli skills learn '+node+' --json');}
 await ask('/mycli cast fortify --json');await ask('/mycli cast fortify --json');
 await ask('/mycli guild party status --json',/.+/);await ask('/mycli guild party create --json',/.+/);await ask('/mycli guild party list',/.+/);await ask('/mycli guild party disband',/.+/);
 const knight=bot;bot=await connect('m',1862);await ask('/mycli profession choose mage --json');const before=await json('/mycli status --json');await ask('/mycli cast arcane_bolt --json');const after=await json('/mycli status --json');report.states.push({emptyTargetMana:{before:before.mana,after:after.mana}});
 await ask('/mycli skills tree --json');await ask('/mycli skills learn arcane_wisdom --json');
 bot=knight;await ask('/mycli dungeon start undead_crypt normal --json',/MC_SITE_DUNGEON|MC_DUNGEON/);
 report.completed=true;
}catch(e){report.error=e.stack;throw e;}finally{await fs.writeFile(stage+'/rpg-baseline-'+label+'.json',JSON.stringify(report,null,2));for(const b of bots)b.quit();}
