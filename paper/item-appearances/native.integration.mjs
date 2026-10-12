// Operator-controlled fixtures on a loopback staging copy, never production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installInventorySession} from '../ops/mineflayer-inventory-session.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(256\d\d)$/m)?.[1]);assert(port);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1])});
const require=createRequire(process.env.MF_REQUIRE_FROM??'E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mf=require('mineflayer'),run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
const report={at:new Date().toISOString(),scope:'isolated native Mineflayer and attached Eye, actual loot/focus factories; no autonomous LLM or device pixels',candidateSha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.33.jar')).digest('hex'),mineflayer:require('mineflayer/package.json').version,checks:[],receipts:[],lines:[],errors:[]};
const clients=[];let finishing=false;
const check=(name,ok,details)=>{report.checks.push({name,pass:!!ok,details});assert(ok,name);console.log('PASS '+name);};
async function until(fn,name,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const value=fn();if(value)return value;await sleep(30);}throw Error('Timeout: '+name);}
async function join(name){const bot=mf.createBot({host:'127.0.0.1',port,username:name,version:'1.20.6',auth:'offline',defaultChatPatterns:false,logErrors:false});installRecipePacketBypass(bot._client);
  const c={bot,name,lines:[]};clients.push(c);bot.on('messagestr',s=>{c.lines.push(s);report.lines.push({player:name,text:s});});bot.on('error',e=>{if(!finishing)report.errors.push(e.stack??String(e));});bot.on('kicked',r=>{if(!finishing)report.errors.push(JSON.stringify(r));});
  await until(()=>bot.entity&&bot.player?.uuid,'join '+name);await sleep(2200);return c;
}
const cmd=c=>c?.components?.find(x=>x.type==='custom_model_data')?.data??null;
const native=c=>c.bot.inventory.slots[36];
async function fixture(c,id,mode='new'){c.bot.setQuickBarSlot(1);await sleep(100);const raw=await rc(`itemartqa give ${c.name} ${id} ${mode}`);assert(!raw.includes('QA_ERROR'),raw);await until(()=>native(c),'actual fixture');await sleep(250);return JSON.parse(raw);}
async function inspect(c){const raw=await rc(`itemartqa inspect ${c.name}`);assert(!raw.includes('QA_ERROR'),raw);return JSON.parse(raw);}
async function query(c){const at=c.lines.length;c.bot.chat('/mycli inventory item 0');return until(()=>c.lines.slice(at).filter(s=>s.startsWith('MC_ITEM ')).map(s=>JSON.parse(s.slice(8)))[0],'private item receipt');}
try {
  check('exact candidate enabled only in staging',(await rc('version AgentFriend')).includes('0.4.33'));
  const c=await join('ag_ArtQA33');await rc('minecraft:gamemode survival '+c.name);
  if(process.env.MC_TEST_RESTART==='1') {
    const saved=JSON.parse(fs.readFileSync(root+'/native-persistence.json','utf8'));
    await until(()=>cmd(native(c))===saved.modelData,'saved native model');
    const row=await inspect(c);check('normal cold restart preserves exact complete item bytes',row.fingerprint===saved.fingerprint&&row.uuid===saved.uuid);
    check('same UUID client reconnect still receives original base ID and appearance',native(c).name==='blaze_rod'&&(await query(c)).appearance.id==='qiandengji:focus_wand');
  }else{
    await rc('minecraft:clear '+c.name);await until(()=>c.bot.inventory.items().length===0,'empty isolated QA inventory');
    const witness=await join('ag_ArtQAW33'),eye=await join(c.name+'_eye');await until(()=>eye.bot.game.gameMode==='spectator','real paired Eye');
    for(const [id,number,base] of [['frost_sword',731001,'iron_sword'],['blink_dagger',731002,'iron_sword'],['mechanical_crossbow',731003,'crossbow'],['focus_wand',731004,'blaze_rod'],['abyss_verdict',731005,'iron_sword']]){
      await fixture(c,id);await until(()=>cmd(native(c))===number,'native CMD '+id);
      const row=await inspect(c);check(id+' new factory has native base/count and matching cosmetic',row.material==='minecraft:'+base&&row.count===1&&row.modelData===number&&row.appearance===id&&row.originalGameplayEqual);
      const at=witness.lines.length,description=await query(c);check(id+' private CLI describes original base plus actual appearance',description.id==='minecraft:'+base&&description.appearance.id==='qiandengji:'+id&&description.appearance.customModelData===number);
      await sleep(250);check(id+' item query is never broadcast',!witness.lines.slice(at).some(s=>s.startsWith('MC_ITEM ')));
      await until(()=>eye.bot.inventory.slots.some(i=>i?.name===base&&cmd(i)===number),'Eye receives actual equipment '+id);
      check(id+' real attached Eye receives unchanged custom component',true);
      await fixture(c,id,'legacy');c.bot.setQuickBarSlot(0);await until(()=>cmd(native(c))===number,'lazy legacy upgrade '+id);
      const legacy=await inspect(c);check(id+' lazy upgrade preserves every gameplay component including durability and soulbound owner',legacy.originalGameplayEqual&&legacy.appearance===id&&legacy.modelData===number);
      c.bot.setQuickBarSlot(1);c.bot.setQuickBarSlot(0);await sleep(300);check(id+' repeat events are idempotent',(await inspect(c)).fingerprint===legacy.fingerprint);
      report.receipts.push({id,new:row,legacy,description});
    }
    for(const mode of ['impostor','foreign']){
      await fixture(c,'frost_sword',mode);c.bot.setQuickBarSlot(0);await sleep(300);const row=await inspect(c);
      check(mode+' item remains exactly unchanged',row.originalGameplayEqual&&row.appearance==null&&(mode==='foreign'?row.modelData===9876:row.modelData==null),row);
      check(mode+' item is not falsely reported as a server appearance',!(await query(c)).appearance);
    }
    await fixture(c,'frost_sword','legacy');
    // While a storage window is active, do not change its in-flight inventory.
    const api=installInventorySession(c.bot,{Item:require('prismarine-item')(c.bot.registry),timeoutMs:5000,quietMs:100,onReceipt:r=>report.receipts.push({inventory:r})});
    const opened=await api.open();check('ordinary player opens actual 54-slot Minepacks',opened.status==='opened'&&opened.snapshot.inventoryStart===54);
    c.bot.setQuickBarSlot(0);await sleep(200);check('cosmetic migration defers during an active storage window',(await inspect(c)).modelData==null);
    await api.close();await until(()=>cmd(native(c))===731001,'close schedules migration');check('closing storage retries the safe cosmetic upgrade',(await inspect(c)).originalGameplayEqual);
    await fixture(c,'focus_wand');const before=await inspect(c),bag=await api.open();assert.equal(bag.status,'opened');
    const source=bag.snapshot.slots.findIndex((i,n)=>n>=54&&i?.name==='blaze_rod');assert(source>=54);
    const put=await api.transfer({operationId:'art-put-'+run,direction:'deposit',slot:source,count:1});
    check('custom wand deposit waits for confirmed slots and empty cursor',put.status==='confirmed'&&put.after.cursor===null);
    await api.close();await sleep(300);const reopened=await api.open(),saved=reopened.snapshot.slots.findIndex((i,n)=>n<54&&i?.name==='blaze_rod');
    check('close and reopen confirms custom wand in its real backpack',saved>=0);
    const take=await api.transfer({operationId:'art-take-'+run,direction:'withdraw',slot:saved,count:1});check('custom wand withdraw is confirmed without duplication or held cursor',take.status==='confirmed'&&take.after.cursor===null);
    await api.close();
    // Minepacks withdraws into the first free survival inventory slot, which
    // need not be the source hotbar slot. Locate the confirmed returned item.
    const returned=await until(()=>{const slot=c.bot.inventory.slots.findIndex((i,n)=>n>=9&&n<36&&i?.name==='blaze_rod'&&cmd(i)===731004);return slot>=9?{slot}:null;},'native wand returns');
    await c.bot.moveSlotItem(returned.slot,36);await until(()=>cmd(native(c))===731004,'wand selected after confirmed return');
    const after=await inspect(c);check('backpack round trip preserves full serialized item bytes',after.fingerprint===before.fingerprint&&after.originalGameplayEqual);
    fs.writeFileSync(root+'/native-persistence.json',JSON.stringify(after,null,2)+'\n',{flag:'wx'});
    c.bot.quit();await sleep(1500);const fresh=await join(c.name);check('same UUID reconnect preserves full weapon bytes',(await inspect(fresh)).fingerprint===after.fingerprint&&fresh.bot.player.uuid===after.uuid);
  }
  check('no unexpected native protocol errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack??String(error));}
finally{finishing=true;for(const c of clients)if(!c.bot._client.ended)c.bot.quit();await sleep(800);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/native-'+run+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
