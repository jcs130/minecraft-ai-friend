import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
const require=createRequire('E:/MC/integrations/qiandengji-harness-20261022/body/package.json');
const mineflayer=require('mineflayer');
const stage='E:/MC/staging/communication-contract-20261030';
const output=process.argv[2],mode=process.argv[3]??'vortex';
if(!output?.startsWith('E:/MC/ops/repairs/communication-contract-review-20261030/'))throw Error('Dedicated QA output required');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bots=[],checks=[],chat=[];
const sentAt=new WeakMap();
const send=async(bot,text)=>{await pause(Math.max(0,1250-(Date.now()-(sentAt.get(bot)??0))));bot.chat(text);sentAt.set(bot,Date.now());};
const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);console.log('PASS '+name);};
const rcon=async(text)=>{const result=await command(text,18000,{properties:stage+'/server.properties',port:29396});if(result.includes('COMM_QA_ERROR'))throw Error(result);return result;};
const wait=async(predicate,name,timeout=12000)=>{for(let t=0;t<timeout;t+=100){const result=predicate();if(result)return result;await pause(100);}throw Error(name+' timed out');};
const read=(bot,token)=>bot.received.filter(line=>line.includes(token));
const json=(line)=>JSON.parse(line.slice(line.indexOf('{')));
const ask=async(bot,text,prefix)=>{const start=bot.received.length;await send(bot,text);return wait(()=>bot.received.slice(start).find(line=>line.includes(prefix)),text);};
const state=async()=>json(await rcon('qd_comm_fixture state ag_CommAlice'));
const worldEffect=async(test,name)=>{for(let i=0;i<30;i++){const current=await state();if(test(current))return current;await pause(150);}throw Error(name+' not observed in server state');};
try{
 for(const username of ['ag_CommAlice','ag_CommBob','ag_CommFar']){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:29395,username,version:'1.21.1',auth:'offline'});bot.received=[];
  bot.on('messagestr',text=>{bot.received.push(text);chat.push({username,text});});bots.push(bot);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),45000);bot.once('spawn',()=>{clearTimeout(timer);bot.physicsEnabled=false;resolve();});bot.once('error',reject);});
 }
 const [alice,bob,far]=bots;check((await rcon('qd_comm_fixture setup ag_CommAlice')).includes('COMM_READY'),'ordinary non-op QA players initialized');
 const data=json(await rcon('qd_comm_fixture policy ag_CommAlice'));
 check(data.provider==='EssentialsXChat'&&data.defaultChannel==='nearby','actual enabled Essentials API reports nearby policy');
 check(data.nearby.radius===48&&data.shout.prefix==='!'&&!data.deliveryAcknowledged&&!data.mentionsExpandScope,'actual radius/prefix and no delivery guarantee');
 check(data.worldUuid&&data.worldKey==='minecraft:overworld','actual world UUID/key included');
 await rcon('qd_comm_fixture guide ag_CommAlice');const guide=await wait(()=>alice.received.find(line=>line.startsWith('MC_GUIDE ')),'private guide');
 check(json(guide).communication?.schema==='agent-mc/chat-policy/v1','MC_GUIDE has current communication contract');
 const status=await ask(alice,'/mycli status --json',mode==='legacy'?'MC_STATUS ':'MC_COMMUNICATION ');
 check(json(status).communication?.nearby?.radius===48,mode+' status path reports current chat policy');
 if(mode==='legacy'){
  check(!bob.received.some(line=>line.includes('MC_COMMUNICATION ')),'legacy query not sent to a bystander');
 }else if(mode==='language'){
  await rcon('qd_comm_fixture world ag_CommBob aincrad');await rcon('qd_comm_fixture world ag_CommFar aincrad');
  const begin=alice.received.length;await send(alice,'@ag_CommBob qa_no_local_'+Date.now());
  const notice=await wait(()=>alice.received.slice(begin).find(line=>line.includes('@名字不会扩大范围')),'localized native no-listener message');
  check(notice.includes('/mycli status')&&!notice.includes('48格'),'native message catalog has the current dynamic-scope guidance');
 }else if(mode==='cold'){
  const saved=json(await ask(alice,'/mycli tasks status qd_first_hunt --json','MC_RPG '));check(saved.summary?.includes('已退出'),'native abandoned quest record survives normal cold restart');
  const tasks=json(await ask(alice,'/mycli tasks status --json','MC_RPG '));check(tasks.activeCount===0,'cold restart does not reactivate an abandoned quest');
 }else{
  for(const text of ['/mycli status full --json','/mycli intro --json']){
   const policy=json(await ask(alice,text,'MC_COMMUNICATION '));check(policy.communication?.nearby?.radius===48,text+' fast path includes chat policy');
  }
  const localToken='qa_local_'+Date.now();await send(alice,localToken);await wait(()=>read(bob,localToken).length,'nearby delivery');await pause(500);
  check(read(far,localToken).length===0&&read(bob,localToken).length===1,'ordinary nearby excludes distant player and does not duplicate');
  const mentionToken='qa_mention_'+Date.now();await send(alice,'@ag_CommFar '+mentionToken);await pause(800);
  check(read(far,mentionToken).length===0,'mention does not expand nearby scope');
  const shoutToken='qa_shout_'+Date.now();await send(alice,'!'+shoutToken);await wait(()=>read(far,shoutToken).length,'single global shout');
  check(read(far,shoutToken).length===1,'explicit shout reaches distant recipient once');
  const nextToken='qa_nextlocal_'+Date.now();await send(alice,nextToken);await wait(()=>read(bob,nextToken).length,'next nearby message');await pause(400);
  check(read(far,nextToken).length===0,'single shout does not change next default channel');
  await rcon('qd_comm_fixture world ag_CommFar aincrad');
  const crossToken='qa_cross_'+Date.now();await send(alice,crossToken);await pause(800);
  check(read(far,crossToken).length===0,'same XYZ in different real world is not nearby');
  const allToken='qa_allworlds_'+Date.now();await send(alice,'!'+allToken);await wait(()=>read(far,allToken).length,'cross-world global shout');
  check(read(far,allToken).length===1,'global shout explicitly crosses world boundary');
  const privateToken='qa_whisper_'+Date.now();await send(alice,'/minecraft:msg ag_CommBob '+privateToken);await wait(()=>read(bob,privateToken).length,'vanilla private message');await pause(400);
  check(read(far,privateToken).length===0,'vanilla whisper is not public or global');
  await rcon('qd_comm_fixture mute ag_CommAlice true');const mutedToken='qa_muted_'+Date.now();await send(alice,'!'+mutedToken);await pause(800);
  check(read(bob,mutedToken).length===0&&read(far,mutedToken).length===0,'native mute still blocks chat/shout');await rcon('qd_comm_fixture mute ag_CommAlice false');
  await rcon('qd_comm_fixture ignore ag_CommBob ag_CommAlice true');const ignoredToken='qa_ignored_'+Date.now();await send(alice,ignoredToken);await pause(800);
  check(read(bob,ignoredToken).length===0,'native ignore still blocks nearby delivery');await rcon('qd_comm_fixture ignore ag_CommBob ag_CommAlice false');
  const permission=json(await rcon('qd_comm_fixture permissions ag_CommAlice false'));const noShout='qa_no_shout_'+Date.now();await send(alice,'!'+noShout);await pause(800);
  await fs.writeFile(output+'/native-permission-observation.json',JSON.stringify({...permission,distantRecipients:read(far,noShout).length},null,2)+'\n');
  check(read(far,noShout).length===(permission.native?1:0),'shout follows native provider permission rather than assuming Bukkit observation is delivery');
  check(json(await rcon('qd_comm_fixture policy ag_CommAlice')).permissionNodes['essentials.chat.shout']===false,'policy observes permission without granting it');await rcon('qd_comm_fixture permissions ag_CommAlice true');
  check((await rcon('qd_comm_fixture worldfacts ag_CommAlice')).includes('COMM_WORLD_IDENTITY_OK'),'same key fixture retains distinct actual world UUIDs');
  await rcon('qd_comm_fixture settings ag_CommAlice 96 false true');check(json(await rcon('qd_comm_fixture policy ag_CommAlice')).defaultChannel==='unknown','persisted shout state is unknown rather than invented');
  await rcon('qd_comm_fixture settings ag_CommAlice 0 false false');check(json(await rcon('qd_comm_fixture policy ag_CommAlice')).defaultChannel==='server','disabled radius reports global default');
  await rcon('qd_comm_fixture settings ag_CommAlice 48 true false');check(json(await rcon('qd_comm_fixture policy ag_CommAlice')).defaultChannel==='server','shout-default reports global default');
  await rcon('qd_comm_fixture settings ag_CommAlice 48 false false');
  check((await rcon('qd_comm_fixture nochat ag_CommAlice')).includes('COMM_UNKNOWN_OK'),'disabled chat plugin returns unknown');
  const info=json(await ask(alice,'/mycli skills info travel --json','MC_RPG '));check(info.invocation?.kind==='command'&&info.invocation.command==='/mycli waypoint menu','travel info exposes actual command route');
  const start=alice.received.length;await send(alice,'/mycli skills list --json');const index=json(await wait(()=>alice.received.slice(start).find(line=>line.includes('"kind":"skill_invocations"')),'invocation list'));
  check(index.entries.find(row=>row.id==='travel')?.invocation.kind==='command'&&index.entries.find(row=>row.id==='food')?.invocation.kind==='cast','skill list distinguishes cast and command capabilities');
  check(typeof index.revision==='string'&&index.revision.length===16,'invocation index has stable cache revision');
  const plainStart=alice.received.length;await send(alice,'/mycli skills list');await pause(800);
  check(!alice.received.slice(plainStart).some(line=>line.includes('"kind":"skill_invocations"')),'plain help does not append the JSON invocation catalog');
  const plainStatus=alice.received.length;await send(alice,'/mycli status');await pause(800);
  check(alice.received.slice(plainStatus).some(line=>line.includes('[聊天]'))&&!alice.received.slice(plainStatus).some(line=>line.startsWith('MC_COMMUNICATION ')),'plain status gets a short chat rule instead of JSON');
  const before=await state();
  for(const parameter of ['undead_crypt','personal:墓穴入口']){
   const result=json(await ask(alice,'/mycli cast travel '+parameter+' --json','MC_RPG '));
   check(result.reason==='command_route_mismatch'&&result.changed===false&&result.nextCommand==='/mycli waypoint menu','wrong travel route denied without forwarding '+parameter);
  }
  const plainMismatch=alice.received.length;await send(alice,'/mycli cast travel undead_crypt');await pause(800);
  check(alice.received.slice(plainMismatch).some(line=>line.includes('[command_route_mismatch]')&&line.includes('/mycli waypoint menu'))&&!alice.received.slice(plainMismatch).some(line=>line.startsWith('MC_RPG ')),'plain route errors give the next command without JSON');
  const after=await state();check(before.world===after.world&&before.x===after.x&&before.z===after.z&&before.mana===after.mana&&before.logs===after.logs,'route mismatches do not move, charge mana or alter items');
  for(const text of ['/mycli dungeon abandon undead_crypt --json','/mycli dungeon leave undead_crypt --json']){
   const error=json(await ask(alice,text,'MC_SITE_DUNGEON_RESULT '));check(error.changed===false&&error.nextCommand==='/mycli dungeon leave',text+' gives exact non-executing correction');
  }
  const missing=json(await ask(alice,'/mycli tasks abandon --json','MC_RPG '));check(missing.success===false&&missing.reason==='invalid_argument','task abandon requires an explicit ID');
  check((await ask(alice,'/mycli tasks --help','/mycli tasks abandon')).includes('abandon'),'existing task help discovers abandonment without a new command group');
  const taskBefore=await state();
  const notActive=json(await ask(alice,'/mycli tasks abandon qd_first_hunt --json','MC_RPG '));check(notActive.reason==='quest_not_active'&&notActive.outcome==='not_executed','abandoning an unaccepted quest is a definite no-op');
  const accepted=json(await ask(alice,'/mycli tasks accept qd_first_hunt --json','MC_RPG '));check(accepted.success===true,'test quest accepted through native service');
  const stopped=json(await ask(alice,'/mycli tasks abandon qd_first_hunt --json','MC_RPG '));check(stopped.success===true&&stopped.saved===true&&stopped.changed===true&&stopped.id==='qd_first_hunt'&&stopped.state==='abandoned','active quest abandoned and persisted through native service');
  const taskStatus=json(await ask(alice,'/mycli tasks status --json','MC_RPG '));check(taskStatus.activeCount===0,'abandoned quest is absent from active tasks');
  const taskAfter=await state();check(taskBefore.wallet===taskAfter.wallet&&JSON.stringify(taskBefore.items)===JSON.stringify(taskAfter.items),'abandonment does not remove inventory or change wallet');
  const again=json(await ask(alice,'/mycli tasks abandon qd_first_hunt --json','MC_RPG '));check(again.reason==='quest_not_active'&&again.outcome==='not_executed','repeated task abandon does not produce a second mutation');
  await rcon('qd_comm_fixture effects ag_CommAlice');await pause(700);const effectsBefore=await state();
  await send(alice,'/mycli cast food');await worldEffect(s=>s.food>effectsBefore.food,'food');
  check((await state()).food>effectsBefore.food,'real food still changes hunger');
  const giveStart=alice.received.length;await send(alice,'/mycli cast give oak_log');await pause(1200);
  check((await state()).logs>=effectsBefore.logs+8,'real give still creates the configured item amount');
  const starBefore=await state();check(starBefore.zombieHealth>0,'live hostile target protected from incidental sunlight damage');
  await send(alice,'/mycli cast starbolt');await worldEffect(s=>s.zombieHealth<starBefore.zombieHealth,'starbolt');check((await state()).zombieHealth<starBefore.zombieHealth,'real starbolt still damages the aimed hostile entity');
 }
 check(!chat.some(row=>row.username!=='ag_CommAlice'&&row.text.includes('command_route_mismatch')),'tool feedback is private to the invoking player');
 const result={passed:true,mode,checks,productionConnected:false,modelCalled:false};await fs.writeFile(output+'/client-'+mode+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{for(const bot of bots)bot.quit('isolated communication review completed');await fs.writeFile(output+'/messages-'+mode+'.json',JSON.stringify(chat,null,2)+'\n');}
