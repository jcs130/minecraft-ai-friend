/** Non-OP, isolated compass and native reset audit. Never targets a real character. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { command } from '../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../ops/mineflayer-client-compat.mjs';

const stage='E:/MC/staging/vortex-takeover-20261027', label=process.argv[2];
assert(/^[a-z0-9]{1,6}$/.test(label));
assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const report={checks:[],receipts:[],productionChanged:false};
const bot=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RUA'+label,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});
installRecipePacketBypass(bot._client);
const messages=[];let last=0;
bot.on('messagestr',s=>messages.push(s));
bot.on('error',e=>report.receipts.push({error:String(e)}));
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,name)=>{for(let end=Date.now()+25000;Date.now()<end;){const v=await f();if(v)return v;await sleep(80);}throw Error('timeout '+name);};
const rc=async q=>{const result=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,result});return result;};
async function ask(q,pattern=/MC_RPG |\[RPG\]/){await sleep(Math.max(0,1200-(Date.now()-last)));last=Date.now();const from=messages.length;bot.chat(q);await until(()=>messages.slice(from).some(s=>pattern.test(s)),q);await sleep(200);const text=messages.slice(from).join('\n');report.receipts.push({q,text});return text;}
async function json(q){const text=await ask(q,/MC_RPG /);return JSON.parse(text.split('\n').find(s=>s.startsWith('MC_RPG ')).slice(7));}

try {
    await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn and chunks');
    bot.physicsEnabled=false;
    await rc('minecraft:tp '+bot.username+' 2202.5 81 2202.5');await sleep(1200);
    await rc('minecraft:fill 2198 80 2198 2206 80 2206 stone');
    await rc('minecraft:fill 2198 81 2198 2206 85 2206 air');
    await rc('minecraft:gamemode survival '+bot.username);
    for(let n=0;n<3;n++){
        bot.chat('/mycli menu');await until(()=>bot.currentWindow,'compass menu');
        const slots=bot.currentWindow.slots.slice(36,45);
        check('all nine compass positions render, iteration '+n,slots.length===9&&slots.every(Boolean));
        check('five actual quick spells retain their original four placeholders, iteration '+n,slots.slice(0,5).every(s=>s.name!=='gray_stained_glass_pane')&&slots.slice(5).every(s=>s.name==='gray_stained_glass_pane'));
        bot.closeWindow(bot.currentWindow);await sleep(1200);
    }
    check('ordinary player can choose a native class',(await json('/mycli profession choose knight --json')).saved);
    await rc('qduse xp '+bot.username+' 2000');await sleep(1200);
    const start=await json('/mycli skills info iron_skin --json');
    check('new native talent is not silently learned',start.learned===false&&start.talentPoints>=1);
    await json('/mycli skills learn iron_skin --json');
    const learned=await json('/mycli skills info iron_skin --json');
    check('explicit learning consumes exactly one talent point',learned.learned===true&&learned.talentPoints===start.talentPoints-1);
    await rc('qduse coins '+bot.username+' 1000');
    const before=await json('/mycli trade wallet --json');
    await ask('/talent reset',/reset|重置|天赋|permission|权限/i);
    const reset=await json('/mycli skills info iron_skin --json'),after=await json('/mycli trade wallet --json');
    report.nativeReset={before,after,reset};
    check('native talent reset really clears allocation and refunds its point',reset.learned===false&&reset.talentPoints===start.talentPoints);
    check('native talent reset actually charges the configured 500 gold',before.balance-after.balance===500);
    const config=await fs.readFile(stage+'/plugins/VortexRPG/config.yml','utf8');
    check('native class swapping is explicitly disabled by current configuration',/allow-player-swap:\s*false/.test(config));
    check('choosing another class does not bypass the swap policy',(await json('/mycli profession choose mage --json')).success===false);
    check('denied swap retains native class',(await json('/mycli profession status --json')).class==='knight');
    const help=await ask('/mycli skills reset',/invalid_argument|未知|仅|用法/);
    check('audit records missing mycli reset action without pretending it exists',/invalid_argument|未知动作/.test(help));
} catch(error){report.failed=String(error);throw error;}
finally {bot.quit();await fs.writeFile(stage+'/compass-reset-audit-'+label+'.json',JSON.stringify(report,null,2)+'\n');}
