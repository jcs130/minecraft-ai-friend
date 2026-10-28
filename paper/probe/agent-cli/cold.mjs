/** Cold-start proof for the exact previous QA identity, also through ViaVersion. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');assert(/^[a-z0-9]+$/.test(label));
const prior=JSON.parse(await fs.readFile(stage+'/agent-cli-cli4a.json','utf8'));assert(prior.passed);
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');const messages=[],report={checks:[],receipts:[],productionChanged:false};let bot;
const until=async(f,label)=>{const end=Date.now()+30000;while(Date.now()<end){const v=await f();if(v)return v;await sleep(100);}throw Error(label);};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);};let last=0;
async function json(q,prefix='MC_RPG'){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=messages.length;bot.chat(q);const s=await until(()=>messages.slice(at).find(s=>s.startsWith(prefix+' ')),q);report.receipts.push({q,s});return JSON.parse(s.slice(prefix.length+1));}
try{
 bot=mf.createBot({host:'127.0.0.1',port:25928,username:prior.identity.name,auth:'offline',version:'1.21.11',hideErrors:true,checkTimeoutInterval:60000});bot.on('messagestr',s=>messages.push(s));bot.on('error',()=>{});installRecipePacketBypass(bot._client);await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'world');bot.physicsEnabled=false;await sleep(2000);
 check('same UUID after normal cold start',bot.player.uuid===prior.identity.uuid);
 const state=await json('/mycli status --json');check('saved native class retained',state.class==='knight');check('live health and inventory remain available',state.health>0&&bot.inventory.items().length>0);
 const progress=await json('/mycli tasks status qd_first_hunt --json');check('same accepted task and actual 0/2 objective retained',progress.id==='qd_first_hunt'&&progress.summary.includes('0/2'));
 const help=await json('/mycli --help --json','MC_CLI_HELP');check('same bounded help on 1.21.11',help.commands.length===7);
 const invalid=await json('/mycli skills learn --json');check('argument error carries one actionable next command',invalid.reason==='invalid_argument'&&invalid.changed===false&&invalid.nextCommand==='/mycli skills --help');
 const skills=await json('/mycli skills list --json');check('starter still available after restart',skills.available.includes('fortify'));
 const menu=await json('/mycli skills menu --json');await until(()=>bot.currentWindow,'native menu packet');check('real menu works on 1.21.11',menu.learningConfirmed===false);bot.closeWindow(bot.currentWindow);
 report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{await fs.writeFile(stage+'/agent-cli-'+label+'.json',JSON.stringify(report,null,2));bot?.quit();}
