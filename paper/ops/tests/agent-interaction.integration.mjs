// Real ordinary players, own Minepacks and native slots in an isolated clone.
// Fixtures are operator-controlled actions, not an autonomous LLM evaluation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {command} from '../rcon-client.mjs';
import {fix1206PotionProtocol} from '../minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../mineflayer-client-compat.mjs';
import {installInventorySession} from '../mineflayer-inventory-session.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(\d+)/m)?.[1]);assert(port>=25600&&port<25700);
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])});
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(require);const mf=require('mineflayer'),nbt=require('prismarine-nbt');
const label=process.argv[2]??'a';assert.match(label,/^[a-z0-9]{1,8}$/);
const report={at:new Date().toISOString(),scope:'isolated real protocol, ordinary QA; no LLM/device acceptance',mineflayer:require('mineflayer/package.json').version,checks:[],receipts:[],errors:[]};
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.27.jar')).digest('hex');
const clients=[];let closing=false;
const hash=p=>fs.existsSync(p)?createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const check=(name,ok,detail)=>{report.checks.push({name,pass:!!ok,detail});assert(ok,name);console.log('PASS '+name);};
async function until(fn,name,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const value=fn();if(value)return value;await sleep(25);}throw new Error('Timeout '+name);}
async function join(name){const bot=mf.createBot({host:'127.0.0.1',port,username:name,version:'1.20.6',auth:'offline',defaultChatPatterns:false,logErrors:false});installRecipePacketBypass(bot._client);
  const c={name,bot,lines:[],packets:[]};clients.push(c);bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{if(!closing)report.errors.push(e.message);});
  bot._client.on('packet',(p,m)=>{if(['window_items','set_slot','open_window','close_window'].includes(m.name))c.packets.push({name:m.name,packet:p,at:Date.now()});});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('spawn '+name)),30000);bot.once('spawn',()=>{clearTimeout(t);bot.physicsEnabled=false;resolve();});bot.once('error',reject);bot.once('kicked',p=>reject(Error(JSON.stringify(p))));});
  await sleep(1800);return c;
}
async function ask(c,q,prefix,predicate=()=>true){await sleep(1050);const at=c.lines.length;c.bot.chat(q);await until(()=>c.lines.slice(at).some(s=>s.startsWith(prefix+' ')&&predicate(JSON.parse(s.slice(prefix.length+1)))),q);
  await sleep(130);return c.lines.slice(at).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).filter(predicate);}
const totals=s=>{const out={};for(const item of [...s.slots,s.cursor])if(item)out[item.key]=(out[item.key]??0)+item.count;return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));};
const adapter=c=>installInventorySession(c.bot,{Item:require('prismarine-item')(c.bot.registry),timeoutMs:5000,quietMs:100,onReceipt:r=>report.receipts.push({player:c.name,...r})});
try {
  check('candidate version is active only in the isolated server',(await rcon('version AgentFriend')).includes('0.4.27'));
  if(process.env.MC_RESTART_QA){
    assert.match(process.env.MC_RESTART_QA,/^ag_Entry[A-Z0-9]+$/);const returning=await join(process.env.MC_RESTART_QA);
    const p=await ask(returning,'/mycli progress','MC_PROGRESS'),main=p.find(r=>r.progress.section==='main').progress,bag=p.find(r=>r.progress.id==='backpack').progress;
    check('normal restart retains actual completed backpack specialty',bag.done===true&&bag.missingConditions.length===0);
    check('normal restart retains independent incomplete mainline and cancelled enrollment',main.stage==='guide_start'&&!main.graduated&&!bag.enrolled);
    check('normal restart retains eight paper in real player inventory',returning.bot.inventory.items().filter(i=>i.name==='paper').reduce((n,i)=>n+i.count,0)===8);
    returning.bot.quit();await sleep(1200);
  }
  const c=await join('ag_Entry'+label.toUpperCase());await rcon('minecraft:gamemode survival '+c.name);
  await sleep(3500);
  check('fresh ordinary login gets the compact entry automatically',c.lines.some(s=>s.startsWith('MC_INTRO ')));
  const intro=(await ask(c,'/mycli intro','MC_INTRO'))[0];
  check('Chinese entrance alias resolves to the same read-only entry',(await ask(c,'/mycli 入门状态','MC_INTRO'))[0].readOnly===true);
  check('entry provides rules, abilities, state, progress and next step',intro.rulesCommand==='/mycli rules'&&intro.capabilitiesCommand==='/mycli capabilities'&&intro.progressCommand==='/mycli progress'&&intro.nextCommand==='/mycli guild join'&&intro.self.name===c.name);
  check('default help and rules nodes are available without OP',intro.normalHelpAllowed&&intro.normalRulesAllowed);
  const helpAt=c.lines.length;c.bot.chat('/help');await sleep(1100);check('ordinary /help runs without permission rejection',c.lines.slice(helpAt).length>0&&!c.lines.slice(helpAt).some(s=>/没有权限|无权|permission/i.test(s)));
  const rules=(await ask(c,'/mycli rules','MC_RULES'))[0];check('ordinary player reads actual server rules',rules.rules.length===4&&rules.pages===2&&rules.readOnly);
  const pdcBefore=await rcon('minecraft:data get entity '+c.name+' BukkitValues');
  const ledgerNames=['config.yml','profession-ledger.json','world-life-ledger.yml','skill-points.yml'];const ledgerBefore=Object.fromEntries(ledgerNames.map(n=>[n,hash(stage+'/plugins/AgentFriend/'+n)]));assert(Object.values(ledgerBefore).every(Boolean));
  const lessons=(await ask(c,'/mycli coach lessons','MC_COACH',r=>r.type==='lessons'))[0];check('viewing lessons does not enroll',lessons.enrolled===false);
  const detail=(await ask(c,'/mycli capabilities info coach.enroll','MC_CLI_DETAIL'))[0];
  check('capability describes parameters, permission, effects, cost and result query',detail.discoveryReadOnly&&detail.semantics.operation==='enroll'&&Array.isArray(detail.semantics.parameters)&&detail.semantics.permission&&detail.semantics.sideEffects.length&&detail.semantics.consumption&&detail.semantics.resultQuery);
  const readDetail=(await ask(c,'/mycli capabilities info coach.lessons','MC_CLI_DETAIL'))[0];check('read-only and enrollment have distinct semantics',readDetail.semantics.readOnly===true&&readDetail.semantics.operation==='query');
  for(const [id,op,readOnly] of [['guild.verify','execute',false],['arena.start','execute',false],['world.guide.start','enroll',false],['trade.locate','execute',false]]){
    const value=(await ask(c,'/mycli capabilities info '+id,'MC_CLI_DETAIL'))[0];check(id+' declares its actual operation',value.semantics.operation===op&&value.semantics.readOnly===readOnly);
  }
  const admin=(await ask(c,'/mycli capabilities info admin.land.member','MC_CLI_DETAIL'))[0];check('privileged capability explicitly requires console/RCON',admin.semantics.permission.includes('控制台/RCON'));
  await ask(c,'/mycli world guide status','MC_WORLD');await ask(c,'/mycli world practice status','MC_WORLD');
  const progress=await ask(c,'/mycli progress','MC_PROGRESS');
  check('progress groups mainline, individual lessons and guild records',new Set(progress.map(r=>r.progress.section)).size===3&&progress.length===progress[0].pages&&progress.every(r=>r.snapshotId===progress[0].snapshotId&&r.readOnly));
  check('progress explicitly preserves ungraduated mainline',progress.find(r=>r.progress.section==='main').progress.graduated===false);
  check('queries retain learner PDC and task/skill ledgers',pdcBefore===await rcon('minecraft:data get entity '+c.name+' BukkitValues')&&ledgerNames.every(n=>ledgerBefore[n]===hash(stage+'/plugins/AgentFriend/'+n)));
  // Inspect every discovery page without earning the legacy reading proofs.
  const first=(await ask(c,'/mycli capabilities list all 1','MC_CLI_LIST'))[0];let ids=[];
  for(let page=1;page<=first.pages;page++) {
    const at=c.lines.length;await ask(c,'/mycli capabilities list all '+page,'MC_CLI_LIST');
    ids.push(...c.lines.slice(at).filter(s=>s.startsWith('MC_CLI_ITEM ')).map(s=>JSON.parse(s.slice(12)).id));
  }
  check('complete command directory paginates without missing or duplicate ids',ids.length===first.total&&new Set(ids).size===ids.length);
  const eye=await join(c.name+'_eye');await until(()=>eye.bot.game.gameMode==='spectator','paired spectator mode');
  const eyeAt=eye.lines.length;await ask(c,'/mycli intro','MC_INTRO');await until(()=>eye.lines.slice(eyeAt).some(s=>s.startsWith('MC_INTRO ')),'attached Eye private intro');
  check('actual attached Eye receives its body entry',true);
  const stranger=await join('ag_Other'+label.toUpperCase());const strangerAt=stranger.lines.length;
  await ask(c,'/mycli progress main','MC_PROGRESS');await sleep(250);
  check('private progress is not broadcast to unrelated players',!stranger.lines.slice(strangerAt).some(s=>s.startsWith('MC_PROGRESS ')));
  c.bot.chat('/mycli guild join');
  await ask(c,'/mycli progress main','MC_PROGRESS',r=>r.progress.stage==='guide_start');
  const enrollment=await ask(c,'/mycli coach enroll','MC_COACH',r=>r.type==='feature_enrollment');check('explicit enrollment has a definitive server receipt',enrollment[0].status==='success'&&enrollment[0].enrolled===true);
  const enrolledPdc=await rcon('minecraft:data get entity '+c.name+' BukkitValues');await ask(c,'/mycli capabilities info skills','MC_CLI_DETAIL');await ask(c,'/mycli progress training','MC_PROGRESS');
  check('pure discovery does not award reading proofs even after enrollment',enrolledPdc===await rcon('minecraft:data get entity '+c.name+' BukkitValues'));
  c.bot.chat('/mycli compass');await until(()=>c.bot.inventory.items().some(i=>i.name==='compass'),'real skill compass');
  await rcon('minecraft:give '+c.name+' paper 8');await sleep(350);
  const inventory=adapter(c);let opened=await inventory.open();check('ordinary agent opens its actual 54-slot Minepacks',opened.status==='opened'&&opened.snapshot.inventoryStart===54);
  const before=opened.snapshot,source=before.slots.findIndex((i,n)=>n>=54&&i?.name==='compass');assert(source>=54);
  const put=await inventory.transfer({operationId:'compass-put-'+label,direction:'deposit',slot:source,count:1});
  check('compass deposit waits for actual server slot and cursor confirmation',put.status==='confirmed'&&put.after.cursor===null&&totals(put.before)[before.slots[source].key]===totals(put.after)[before.slots[source].key],put.status==='confirmed'?undefined:put);
  const writes=c.packets.length;assert.equal((await inventory.close()).status,'close_requested');await sleep(200);opened=await inventory.open();
  const saved=opened.snapshot.slots.findIndex((i,n)=>n<54&&i?.key===before.slots[source].key);
  check('close/reopen proves the deposited compass persisted',opened.status==='opened'&&saved>=0&&c.packets.length>writes);
  const get=await inventory.transfer({operationId:'compass-take-'+label,direction:'withdraw',slot:saved,count:1});
  check('compass retrieval preserves complete item identity and quantities',get.status==='confirmed'&&get.after.cursor===null&&JSON.stringify(totals(before))===JSON.stringify(totals(get.after)),get.status==='confirmed'?undefined:get);
  let paper=get.after.slots.findIndex((i,n)=>n>=54&&i?.name==='paper');assert(paper>=54);
  const split=await inventory.transfer({operationId:'paper-put-'+label,direction:'deposit',slot:paper,count:3});check('partial stack deposit confirms each primitive click',split.status==='confirmed'&&split.after.cursor===null);
  const at=split.after.slots.findIndex((i,n)=>n<54&&i?.name==='paper');
  const back=await inventory.transfer({operationId:'paper-take-'+label,direction:'withdraw',slot:at,count:3});check('partial stack roundtrip conserves every item fingerprint',back.status==='confirmed'&&JSON.stringify(totals(before))===JSON.stringify(totals(back.after))&&back.after.cursor===null);
  const again=await inventory.transfer({operationId:'paper-put-'+label,direction:'deposit',slot:paper,count:3});check('a repeated operation id returns the existing receipt',again.operationId===split.operationId&&again.after.revision===split.after.revision);
  await inventory.close();await sleep(350);
  const after=await ask(c,'/mycli progress','MC_PROGRESS');const main=after.find(r=>r.progress.section==='main').progress,bag=after.find(r=>r.progress.id==='backpack').progress;
  check('real backpack specialty is complete while mainline remains guide_start',bag.done===true&&bag.missingConditions.length===0&&main.stage==='guide_start'&&main.graduated===false);
  report.finalInventoryNative=await rcon('minecraft:data get entity '+c.name+' Inventory');await rcon('minecraft:save-all flush');
  const uuid=c.bot.player.uuid;const savedPlayer=nbt.simplify((await nbt.parse(fs.readFileSync(stage+'/world/playerdata/'+uuid+'.dat'))).parsed);
  check('native player save independently retains compass and eight paper',savedPlayer.Inventory.filter(i=>i.id==='minecraft:compass').reduce((n,i)=>n+i.count,0)===1&&savedPlayer.Inventory.filter(i=>i.id==='minecraft:paper').reduce((n,i)=>n+i.count,0)===8);
  await ask(c,'/mycli coach cancel','MC_COACH',r=>r.type==='feature_enrollment');const retained=(await ask(c,'/mycli progress training','MC_PROGRESS')).find(r=>r.progress.id==='backpack').progress;
  check('cancel stops enrollment without erasing earned specialty proofs',retained.enrolled===false&&retained.done===true);
  check('all structured rows stay below messagestr truncation',c.lines.filter(s=>/^MC_(INTRO|PROGRESS|RULES|CLI_)/.test(s)).every(s=>s.length<4000));
  check('no native client errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{
  closing=true;for(const c of clients){c.bot.quit();report[c.name]={uuid:c.bot.player?.uuid,lines:c.lines,packets:c.packets};}
  await sleep(500);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/native-'+label+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));if(!report.passed)process.exitCode=1;
}
