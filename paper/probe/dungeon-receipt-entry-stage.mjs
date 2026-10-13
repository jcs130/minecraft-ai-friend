// Real clients, original receipt/claim handlers, fictitious old receipts in a copied world only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/dungeon-receipt-entry-20261013/paper';
const output=process.env.MC_TEST_REPORT_DIR??'E:/MC/ops/repairs/dungeon-receipt-entry-20261013';
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25664\r?$/m);
assert.match(props,/^rcon.port=25665\r?$/m);assert.match(props,/^motd=Dungeon receipt isolated check\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={at:new Date().toISOString(),mode:process.argv[2]??'initial',checks:[],errors:[],fixtures:[],samples:{},sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.36.jar')).digest('hex')};
const bots=[];let be,closing=false;
const save=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const rc=async q=>{const answer=await command(q,15000,{port:25665,properties:stage+'/server.properties'});report.fixtures.push({q,answer});return answer;};
const qa=async q=>assert.match(await rc('receiptqa '+q),/RECEIPT_QA_OK/);
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
async function join(username){
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25664,username,auth:'offline',version:'1.20.6',checkTimeoutInterval:60000});
 bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.chats=[];b.cameras=[];
 b.on('messagestr',s=>b.lines.push(s));b._client.on('system_chat',p=>b.chats.push(p));b._client.on('camera',p=>b.cameras.push(p.cameraId));
 b.on('error',e=>{if(!closing)report.errors.push(username+': '+e.message);});b.on('kicked',e=>{if(!closing)report.errors.push(username+': '+JSON.stringify(e));});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' world',45000);return b;
}
async function chat(b,q){await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();b.chat(q);}
async function cli(b,q,prefix='MC_SITE_DUNGEON_RESULT'){
 const at=b.lines.length;await chat(b,'/mycli dungeon '+q);
 const value=await until(()=>b.lines.slice(at).find(l=>l.startsWith(prefix+' ')),q);await sleep(150);return JSON.parse(value.slice(prefix.length+1));
}
const state=(b,id='')=>cli(b,'status '+id,'MC_SITE_DUNGEON_STATE');
const receipt=(b,id='undead_crypt')=>save()['site-dungeons']?.receipts?.[b.player.uuid]?.[id];
const reward=b=>save()['dungeon-rewards']?.[b.player.uuid]??{};
async function firstRoom(b){await rc('minecraft:gamemode survival '+b.username);await rc('minecraft:tp '+b.username+' -424.5 4 677.5');await sleep(500);}
async function menu(b){await chat(b,'/mycli dungeon menu');await until(()=>b.currentWindow,'menu');await b.clickWindow(10,0,0);await until(()=>b.currentWindow&&JSON.stringify(b.currentWindow.title).includes('亡灵'),'detail menu');await sleep(200);return b.currentWindow;}
try{
 check('final candidate enabled',(await rc('version AgentFriend')).includes('0.4.36'));
 const a=await join('ag_Receipt36'),human=await join('Receipt36');
 if(report.mode==='resume'){
   const before=JSON.stringify(reward(a)),s=await state(a);
   check('two old receipts survive normal restart',s.pendingRewards.includes('bunker')&&s.pendingRewards.includes('creeping_crypt')&&s.pendingRewardDetails.length===2);
   check('claimed receipt stays consumed after restart',!receipt(a)&&save()['site-dungeons']['claimed-runs'][a.player.uuid].undead_crypt);
   check('duplicate after restart rejected',(await cli(a,'claim undead_crypt')).reason==='no_pending_reward'&&JSON.stringify(reward(a))===before);
   check('surviving old receipt remains claimable',(await cli(a,'claim bunker')).success);
   check('restart claim grants exact original reward',reward(a).emerald===8+8&&reward(a).iron_ingot===4+4);
   await qa('cooldown');await firstRoom(a);check('restart has no stale entry block',(await cli(a,'start undead_crypt')).success);await cli(a,'leave');
 }else{
   const other=await join('OtherReceipt36'),eye=await join('ag_Receipt36_eye');
   await until(()=>eye.game.gameMode==='spectator'&&eye.cameras.at(-1)===a.entity.id,'attached Eye');check('real Eye attached',true);
   await qa('reset');await qa('seed '+a.username);await qa('seed '+human.username);await qa('rewards '+a.username+' zero');await qa('rewards '+human.username+' zero');
   const original=JSON.stringify(receipt(a)),observerAt=other.lines.length,eyeAt=eye.lines.length;
   const s=await state(a);report.samples.legacyState=s;
   check('legacy receipt without outcome is visible',s.active===false&&!s.outcomeKnown&&s.pendingRewards.includes('undead_crypt'));
   check('legacy reward details have exact values and command',s.pendingRewardDetails[0].emeralds===8&&s.pendingRewardDetails[0].count===4&&s.pendingRewardDetails[0].claimCommand==='/mycli dungeon claim undead_crypt');
   check('human wording no longer denies existing proof',a.lines.some(l=>l.includes('已保存的待领奖凭据'))&&!a.lines.some(l=>l.includes('旧版未保存结束原因')));
   check('status does not consume or rewrite receipt',JSON.stringify(receipt(a))===original);
   check('private receipt does not reach other players',!other.lines.slice(observerAt).some(l=>l.includes('MC_SITE_DUNGEON_STATE')||l.includes('地下城待领奖')));
   check('Eye sees readable instruction without machine JSON',eye.lines.slice(eyeAt).some(l=>l.includes('地下城待领奖'))&&!eye.lines.slice(eyeAt).some(l=>l.startsWith('MC_SITE_DUNGEON_STATE ')));
   check('native clickable command exists',a.chats.some(p=>JSON.stringify(p).includes('run_command')&&JSON.stringify(p).includes('/mycli dungeon claim undead_crypt')));
   await firstRoom(a);const denied=await cli(a,'start undead_crypt');
   check('entry protects old receipt with exact next action',denied.reason==='claim_previous_reward_first'&&denied.nextCommands[0]==='/mycli dungeon claim undead_crypt'&&denied.pendingReward.run===receipt(a).run);
   check('entry rejection creates no run and preserves receipt',!save()['site-dungeons'].runs?.undead_crypt&&JSON.stringify(receipt(a))===original);
   check('empty claim has distinct reason',(await cli(other,'claim')).reason==='no_pending_reward');
   const w=await menu(human);report.samples.menu=w.slots.slice(0,54);
   check('menu highlights required claim',w.slots[12]?.name==='gray_dye'&&w.slots[30]?.name==='ender_chest');
   const humanAt=human.lines.length;await human.clickWindow(12,0,0);await sleep(400);
   check('menu blocker keeps UI and uses short private text',!!human.currentWindow&&human.lines.slice(humanAt).some(l=>l.includes('地下城待领奖'))&&!human.lines.slice(humanAt).some(l=>l.startsWith('MC_SITE_DUNGEON_RESULT')));
   check('menu inspection never claims',!!receipt(human)&&(reward(human).emerald??0)===0);
   const claimAt=human.lines.length;await human.clickWindow(30,0,0);await until(()=>human.lines.slice(claimAt).some(l=>l.startsWith('MC_SITE_DUNGEON_RESULT ')),'GUI claim');
   check('native menu claim consumes proof once',!receipt(human)&&reward(human).emerald===8&&reward(human).iron_ingot===4);
   await menu(human);check('menu unlocks challenges after claim',human.currentWindow.slots[12]?.name==='iron_sword');human.closeWindow(human.currentWindow);
   await qa('rewards '+a.username+' full');check('full queue refuses safely',(await cli(a,'claim undead_crypt')).reason==='personal_reward_queue_full');
   check('full queue preserves receipt exactly',JSON.stringify(receipt(a))===original);await qa('rewards '+a.username+' zero');
   const lock=stage+'/plugins/AgentFriend/config.yml.site-dungeon.tmp';assert(!fs.existsSync(lock));fs.mkdirSync(lock);
   try{check('write failure is not reported as success',(await cli(a,'claim undead_crypt')).reason==='data_unavailable');}finally{fs.rmdirSync(lock);}
   check('failed commit keeps proof and reward counts',JSON.stringify(receipt(a))===original&&(reward(a).emerald??0)===0);
   await menu(a);check('old receipt claims without replay',(await cli(a,'claim')).success);
   check('claim yields exact reward and consumes original proof',!receipt(a)&&reward(a).emerald===8&&reward(a).iron_ingot===4);
   await a.clickWindow(12,0,0);await sleep(400);
   check('stale blocked menu refreshes without starting',a.currentWindow?.slots[12]?.name==='iron_sword'&&!save()['site-dungeons'].runs?.undead_crypt);
   a.closeWindow(a.currentWindow);
   check('duplicate claim rejected without extra items',(await cli(a,'claim undead_crypt')).reason==='no_pending_reward'&&reward(a).emerald===8&&reward(a).iron_ingot===4);
   await qa('cooldown');check('new challenge can actually start',(await cli(a,'start undead_crypt')).success);await qa('muster');
   await qa('seed '+other.username);await firstRoom(other);
   check('join also gives precise old reward instruction',(await cli(other,'join undead_crypt')).reason==='claim_previous_reward_first');
   const guestState=await state(other,'undead_crypt');check('another active party cannot hide own pending proof',guestState.active&&!guestState.participant&&guestState.pendingRewardDetails[0].id==='undead_crypt');
   await cli(other,'claim undead_crypt');check('joining works after explicit claim',(await cli(other,'join undead_crypt')).success);await cli(other,'leave');await cli(a,'leave');
   await qa('seed '+a.username+' creeping_crypt');await qa('seed '+a.username+' bunker');
   check('multiple receipts require explicit choice',(await cli(a,'claim')).reason==='specify_dungeon_id');
   check('multiple receipt query is complete',(await state(a)).pendingRewardDetails.length===2);
   const beReq=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');let spawned=false;const texts=[];
   be=beReq('bedrock-protocol').createClient({host:'127.0.0.1',port:19174,version:'1.26.51',offline:true,username:'ReceiptBE36',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
   be.on('session',p=>{p.xuid='9000000987436';});be.on('spawn',()=>spawned=true);be.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
   be.on('error',e=>{if(!closing)report.errors.push('Bedrock '+e.message);});await until(()=>spawned,'Bedrock connection',45000);check('real Bedrock connected',true);
   const send=q=>be.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
   await qa('seed .ReceiptBE36');let at=texts.length;send('/mycli dungeon status');await until(()=>texts.slice(at).some(l=>l.startsWith('MC_SITE_DUNGEON_STATE ')),'Bedrock state');await sleep(400);
   check('Bedrock receives pending proof and direct claim text',texts.slice(at).some(l=>l.includes('地下城待领奖'))&&texts.slice(at).some(l=>l.includes('/mycli dungeon claim undead_crypt')));
   at=texts.length;await sleep(1100);send('/mycli dungeon claim undead_crypt');await until(()=>texts.slice(at).some(l=>l.startsWith('MC_SITE_DUNGEON_RESULT ')),'Bedrock claim');
   check('Bedrock can claim by standard command',JSON.parse(texts.slice(at).find(l=>l.startsWith('MC_SITE_DUNGEON_RESULT ')).slice('MC_SITE_DUNGEON_RESULT '.length)).success);
   report.samples.bedrock=texts;
 }
 check('no protocol errors',report.errors.length===0);report.passed=true;
}catch(e){report.failure=String(e.stack);process.exitCode=1;}
finally{
 closing=true;be?.close();for(const b of bots)b.quit('isolated receipt QA complete');await sleep(400);
 report.samples.clients=bots.map(b=>({name:b.username,lines:b.lines,chats:b.chats.slice(-20)}));
 const file=output+'/receipt-'+report.mode+'-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
 console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,errors:report.errors,failure:report.failure,file}));process.exit(process.exitCode??0);
}
