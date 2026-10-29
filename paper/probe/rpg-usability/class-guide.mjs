/** Actual non-OP class information, query purity and escrow delivery on marked QA only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',out=process.argv[2],tag=process.argv[3]??'d1';assert(out?.startsWith('E:/MC/ops/repairs/rpg-checkpoint-20261029-'));assert(/^[a-z0-9]{1,3}$/.test(tag));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={checks:[],receipts:[],productionChanged:false};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(fn,label,ms=30000)=>{for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(150);}throw Error('timeout '+label);};
const rc=async q=>{const s=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,text:s});return s;};
async function connect(name){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,version:'1.21.1',auth:'offline',respawn:true,hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn');b.physicsEnabled=false;return b;}
async function chat(b,q){await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();const mark=b.messages.length;b.chat(q);return mark;}
async function ask(b,q,prefix='MC_RPG '){const mark=await chat(b,q),line=await until(()=>b.messages.slice(mark).find(s=>s.startsWith(prefix)),q);report.maxStructuredLength=Math.max(report.maxStructuredLength??0,line.length);const v=JSON.parse(line.slice(prefix.length));report.receipts.push({name:b.username,q,data:v});return v;}
const inventory=b=>JSON.stringify(b.inventory.items().map(i=>[i.slot,i.name,i.count]));
try{
 const [a,b]=await Promise.all(['ag_RUInfoA','ag_RUInfoB'].map(n=>connect(n+tag)));await sleep(5000);for(const p of [a,b]){await rc('qduse hunger '+p.username+' 20');await rc('qduse heal '+p.username);}
 const baseline=await ask(a,'/mycli status --json'),bag=inventory(a);const roles=['knight','mage','ranger','cleric','beastmaster','engineer'],definitions=[];
 for(const id of roles){const d=await ask(a,'/mycli profession info '+id+' --json');definitions.push(d);check(id+' returns loaded stats, kit, effects and growth',d.id===id&&d.authority==='VortexRPG.loaded'&&Object.keys(d.baseAttributes).length>0&&d.starterEquipment.length>0&&d.skills.length>0&&d.growth.length>0&&d.ascensions.length>0&&d.queryOnly&&d.canChoose&&d.selectionReason==='ready');}
 check('a catalog revision accompanies every role',definitions.every(d=>typeof d.catalogVersion==='string')&&new Set(definitions.map(d=>d.catalogVersion)).size===1);
 check('profession notes do not invent persistent pets or turrets',definitions.find(d=>d.id==='beastmaster').notes.join('').includes('不代表拥有常驻宠物')&&definitions.find(d=>d.id==='engineer').notes.join('').includes('不代表已部署常驻炮塔'));
 const plainMark=await chat(a,'/mycli profession info knight');await until(()=>a.messages.slice(plainMark).some(s=>s.includes('版本 ')&&s.includes('下一步')),'plain profession information');
 const plainText=a.messages.slice(plainMark).join('\n');check('default profession information is readable and points back to the server',plainText.includes('初始装备')&&plainText.includes('学习点')&&plainText.includes('被动常驻')&&plainText.includes('力量')&&plainText.includes('vanguard')&&!a.messages.slice(plainMark).some(s=>s.startsWith('MC_RPG ')));
 const after=await ask(a,'/mycli status --json');check('six profession previews never select, grant kits, spend points or change gold',after.class===baseline.class&&after.xp===baseline.xp&&after.economy.balance===baseline.economy.balance&&bag===inventory(a));
 const original=definitions[0];await rc('qduse kitpreview '+a.username+' 3');const changed=await ask(a,'/mycli profession info knight --json');check('profession equipment is read from actual loaded configuration',changed.starterEquipment[0].amount===3&&changed.catalogVersion!==original.catalogVersion);await rc('qduse kitpreview '+a.username+' 1');
 check('restoring configuration restores the same version',(await ask(a,'/mycli profession info knight --json')).catalogVersion===original.catalogVersion);
 await ask(a,'/mycli profession choose knight --json');const own=await ask(a,'/mycli profession info knight --json'),other=await ask(a,'/mycli profession info mage --json');check('actual selection state explains unavailable choices',!own.canChoose&&own.selectionReason==='already_selected'&&!other.canChoose&&other.selectionReason==='class_already_chosen');
 const guide=await ask(a,'/mycli intro --json','MC_INTRO ');check('intro explains accept, practice entry, escrow and remote storage',guide.activityGuide.some(s=>s.includes('accept')&&s.includes('start'))&&guide.activityGuide.some(s=>s.includes('按钮12格')&&s.includes('各有8魔力'))&&guide.activityGuide.some(s=>s.includes('publish delivery'))&&guide.activityGuide.some(s=>s.includes('putslot')));
 const mark=await chat(a,'/mycli help dungeon.start');await until(()=>a.messages.slice(mark).some(s=>s.includes('第三次战败')),'default checkpoint help');check('default help exposes three chances and Boss exclusion',a.messages.slice(mark).some(s=>s.includes('Boss房间')));
 const status=await ask(b,'/mycli guild party status --json');check('party status does not falsely treat unknown invitation state as no invitation',status.inviteStateKnown===false&&status.options.some(o=>o.command.endsWith('accept')));
 await rc('qduse coins '+b.username+' 100');await rc('minecraft:give '+a.username+' minecraft:bread 2');await sleep(300);
 const beforeA=(await ask(a,'/mycli trade wallet --json')).balance,beforeB=(await ask(b,'/mycli trade wallet --json')).balance;
 const published=await ask(b,'/mycli commission publish delivery minecraft:bread 2 10 QA收购','MC_COMMISSION_RESULT ');const id=published.id??published.commissionId;assert(id,JSON.stringify(published));
 const accepted=await ask(a,'/mycli commission accept '+id,'MC_COMMISSION_RESULT ');assert(accepted.success,JSON.stringify(accepted));
 const paid=await ask(a,'/mycli commission claim '+id,'MC_COMMISSION_RESULT ');assert(paid.success,JSON.stringify(paid));
 await until(()=>!a.inventory.items().some(i=>i.name==='bread'),'actual goods removed from seller');
 const rewardMark=await chat(b,'/mycli arena rewards list');await until(()=>b.messages.slice(rewardMark).some(s=>s.startsWith('MC_REWARD_SUMMARY ')),'buyer delivery queue');
 check('escrow transfers the actual goods to the buyer pending chest',b.messages.slice(rewardMark).some(s=>s.startsWith('MC_REWARD ')&&s.includes('minecraft:bread')&&s.includes('count=2')));
 const afterA=(await ask(a,'/mycli trade wallet --json')).balance,afterB=(await ask(b,'/mycli trade wallet --json')).balance;
 check('two real clients trade through escrow with actual gold settlement',afterA===beforeA+10&&afterB===beforeB-10);
 const repeated=await ask(a,'/mycli commission claim '+id,'MC_COMMISSION_RESULT ');check('repeating completed delivery cannot pay twice',!repeated.success&&(await ask(a,'/mycli trade wallet --json')).balance===afterA);
 check('class query payloads remain within the standard chat parser limit',report.maxStructuredLength<4096);
 report.complete=true;
}catch(error){report.failed=String(error);throw error;}
finally{report.actorMessages=bots.map(b=>({name:b.username,messages:b.messages.slice(-25)}));for(const b of bots)b.quit();await fs.writeFile(out+'/class-guide-audit.json',JSON.stringify(report,null,2)+'\n');}
