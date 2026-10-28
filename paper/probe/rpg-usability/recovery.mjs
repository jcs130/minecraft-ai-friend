/** Recovery suggestions must lead to an available read or a correctly gated action. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,7}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),report={checks:[],receipts:[],passed:false,productionChanged:false};let bot,last=0;
const check=(n,v)=>{assert(v,n);report.checks.push(n);console.log('PASS '+n);};
const until=async(f,n)=>{for(let end=Date.now()+30000;Date.now()<end;){const v=await f();if(v)return v;await sleep(100);}throw Error(n);};
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function json(q){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=bot.messages.length;bot.chat(q);const text=await until(()=>bot.messages.slice(at).find(s=>s.startsWith('MC_RPG ')),q);report.receipts.push({q,text});return JSON.parse(text.slice(7));}
try{
 bot=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RUE'+label,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bot.messages=[];bot.on('messagestr',s=>bot.messages.push(s));bot.on('error',()=>{});installRecipePacketBypass(bot._client);await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'world');bot.physicsEnabled=false;await sleep(1600);
 let card=await json('/mycli skills info no_such_skill --json');check('unknown skill does not loop into the same invalid ID',card.reason==='unknown_skill'&&card.nextCommand==='/mycli profession list');
 card=await json('/mycli skills info fortify --json');check('unselected spell info points to profession directory',!card.available&&card.nextCommand==='/mycli profession list');
 card=await json('/mycli cast blink --json');check('retired magic has explicit migration guidance',card.reason==='skill_retired'&&card.changed===false&&card.nextCommand==='/mycli profession list');
 await json('/mycli profession choose knight --json');const list=await json('/mycli skills list --json'),node=list.learnable.find(s=>s.grantedSpellId);assert(node);
 card=await json('/mycli skills info '+node.id+' --json');check('unlearned high-level node points to leveling instead of a rejected learn',!card.learned&&card.playerLevel===1&&card.nextCommand==='/mycli tasks list');
 card=await json('/mycli skills info '+node.grantedSpellId+' --json');check('locked spell info does not recommend casting it',!card.available&&card.nextCommand==='/mycli tasks list');
 card=await json('/mycli cast '+node.grantedSpellId+' --json');check('locked cast has explicit readback without charging',card.reason==='skill_locked'&&card.changed===false&&card.nextCommand==='/mycli skills info '+node.grantedSpellId);
 card=await json('/mycli skills info arcane_bolt --json');check('another class spell points back to own skills',!card.available&&card.nextCommand==='/mycli skills list');
 card=await json('/mycli cast iron_body --json');check('passive node cannot be used as a cast ID',card.reason==='skill_node_not_castable'&&card.changed===false&&card.nextCommand==='/mycli skills info iron_body');
 card=await json('/mycli guild party create unexpected --json');check('unexpected party arguments rejected before mutation',card.success===false&&card.reason==='invalid_argument');check('failed create left no native party',!(await json('/mycli guild party status --json')).inParty);
 await rc('qduse xp '+bot.username+' 10000');card=await json('/mycli skills info '+node.id+' --json');check('ready node gives exact explicit learn action',!card.learned&&card.skillPoints>0&&card.nextCommand==='/mycli skills learn '+node.id);
 card=await json('/mycli skills learn '+node.id+' --json');check('recommended learning actually saves',card.success&&card.saved);
 card=await json('/mycli skills info '+node.id+' --json');check('learned active node gives granted cast ID',card.learned&&card.nextCommand==='/mycli cast '+node.grantedSpellId);
 card=await json('/mycli skills info '+node.grantedSpellId+' --json');check('available spell now recommends usable cast',card.available&&card.nextCommand==='/mycli cast '+node.grantedSpellId);
 card=await json('/mycli skills info no_such_skill --json');check('unknown ID with selected class points to actual skills',card.reason==='unknown_skill'&&card.nextCommand==='/mycli skills list');report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{bot?.quit();await fs.writeFile(stage+'/rpg-recovery-'+label+'.json',JSON.stringify(report,null,2));}
