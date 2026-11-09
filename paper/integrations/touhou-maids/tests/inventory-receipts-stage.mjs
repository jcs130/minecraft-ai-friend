// Actual native inventory and wire replies on one marked, synthetic loopback world.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_INVENTORY_QA_STAGE,root=process.env.MAID_INVENTORY_QA_REPORT_ROOT;
assert(stage&&root&&process.env.MAID_INVENTORY_QA_ANCHOR&&process.env.MAID_INVENTORY_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_INVENTORY_QA_RCON));
const rc=text=>command(text,15000,{port:25939,properties:stage+'/server.properties'});
const mf=createRequire(process.env.MAID_INVENTORY_QA_ANCHOR)('mineflayer');
const baseline=process.argv.includes('--baseline'),restart=process.argv.includes('--restart');
const report={baseline,restart,synthetic:true,productionChanged:false,checks:[],rawReplies:[],packets:[]};
const run='mi'+Date.now().toString(36),bots=[];
const until=async(fn,label,ms=25000)=>{for(const end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(100);}throw Error('Timeout '+label);};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);};
let sequence=0,maid;
async function connect(username){
 const bot=mf.createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username,auth:'offline',hideErrors:true,respawn:false});bots.push(bot);
 bot.replies=[];bot.lines=[];bot.on('error',e=>bot.lines.push(String(e)));
 bot.on('messagestr',(text,kind)=>{bot.lines.push(text);if(kind==='system'&&text.startsWith('QD_MAID ')){try{const value=JSON.parse(text.slice(8));bot.replies.push(value);report.rawReplies.push({route:'chat',username,value});}catch{}}});
 bot._client.on('custom_payload',packet=>{if(packet.channel==='qiandengji:maids'){try{const value=JSON.parse(packet.data.toString());bot.replies.push(value);report.rawReplies.push({route:'plugin',username,value});}catch{}}});
 bot._client.on('packet',(data,meta)=>{if(['respawn','position','health'].includes(meta.name))report.packets.push({at:new Date().toISOString(),username,name:meta.name,data});});
 await until(()=>bot.entity&&bot.player?.uuid,username);return bot;
}
async function ask(bot,action,value='',id=run+'_'+(++sequence),channel=false){
 await delay(400);const start=bot.replies.length;
 if(channel)bot._client.write('custom_payload',{channel:'qiandengji:maid_request',data:Buffer.from(JSON.stringify({schema:1,protocol:'qiandengji-maids/v1',command:`/qdmaid ${action} ${maid} ${id}${value?' '+value:''}`}))});
 else bot.chat(`/qdmaid ${action} ${maid} ${id}${value?' '+value:''}`);
 return until(()=>bot.replies.slice(start).find(row=>row.requestId===id),action+' '+id);
}
async function receipt(bot,id){
 const query=run+'_'+(++sequence),start=bot.replies.length;
 bot.chat(`/qdmaid receipt ${maid} ${id} ${query}`);
 return until(()=>bot.replies.slice(start).find(row=>row.requestId===query),'receipt '+id);
}
async function qa(action){const raw=await rc('maidinvqa '+action);assert(!raw.includes('_ERROR'),raw);const text=raw.slice(raw.indexOf('MAID_INVENTORY_QA ')+18);return JSON.parse(text);}
try{
 await until(async()=>{try{return(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.14-companion':'0.1.15-inventory-receipts');}catch{return false;}},'startup',180000);
 const owner=await connect('MaidSlotQA0');await rc('minecraft:gamemode creative MaidSlotQA0');
 if(!restart){
  await rc('minecraft:fill 294 89 294 310 89 310 minecraft:stone');await rc('minecraft:fill 294 90 294 310 94 310 minecraft:air');await rc('minecraft:tp MaidSlotQA0 300.5 90 300.5');await delay(800);
  const exists=await fs.access(stage+'/inventory-receipt-qa.json').then(()=>true,()=>false);
  const setup=await qa(exists?'fill':'setup');maid=setup.maidId;report.maidId=maid;
  const before=await qa('snapshot');const inv=(await ask(owner,'inventory')).data;
  check('native backing is36 and usable capacity6',inv.slotCount===36&&inv.availableSlots===6);
  check('explicit zero-based usable slots',JSON.stringify(inv.usableSlotIndexes)==='[0,1,2,3,4,5]'&&inv.indexBase===0&&inv.availableSlotsMeaning==='usable_capacity');
  check('full native backpack has no free unlocked slots',inv.freeSlotCount===0&&inv.freeSlotIndexes?.length===0&&inv.lockedSlotIndexes?.length===30);
  const rejected=run+'_locked',bad=await ask(owner,'transfer','put 6 1 35',rejected);
  check('locked-slot reply explains current usable slots',bad.ok===false&&bad.error==='maid_slot_unavailable'&&bad.data?.observation?.message.includes('0–5'));
  const rejectedQuery=await receipt(owner,rejected);check('known no-effect rejection is durable by original ID',rejectedQuery.ok===true&&rejectedQuery.data.status==='rejected'&&rejectedQuery.data.observation.effectsApplied===false&&rejectedQuery.data.operationId===rejected);
  const duplicate=await ask(owner,'transfer','put 6 1 35',rejected);check('duplicate rejection retains same reservation',duplicate.data?.replayed===true&&duplicate.data.reservedAt===bad.data?.reservedAt&&duplicate.ok===false);
  const conflict=await ask(owner,'transfer','put 0 1 35',rejected);check('changed arguments cannot reuse rejected ID',conflict.ok===false&&conflict.error==='request_conflict');
  const equipBadId=run+'_equiplocked';const equipBad=await ask(owner,'equip','chest 6',equipBadId);const equipQuery=await receipt(owner,equipBadId);
  check('locked equipment source rejected and recoverable',equipBad.ok===false&&equipQuery.ok===true&&equipQuery.data.status==='rejected');
  const countId=run+'_count';await ask(owner,'transfer','put 0 0 35',countId);const countQuery=await receipt(owner,countId);check('invalid count has no-effect rejection',countQuery.ok===true&&countQuery.data.status==='rejected'&&countQuery.data.observation.error==='bad_slot_or_count');
  const afterRejected=await qa('snapshot');check('all native items and player components unchanged after rejection',JSON.stringify(before)===JSON.stringify(afterRejected));
  const outsider=await connect('MaidOutQA0');await rc('minecraft:tp MaidOutQA0 300.5 90 300.5');const foreign=run+'_foreign';const denied=await ask(outsider,'transfer','take 0 1 0',foreign);
  check('other actor cannot write foreign inventory',denied.ok===false&&denied.error==='not_owned');
  const foreignFile=stage+'/plugins/QiandengjiMaidBridge/native-receipts/'+maid+'_'+foreign+'.json';check('unauthorized actor cannot allocate foreign receipt',!(await fs.access(foreignFile).then(()=>true,()=>false)));
  await qa('free');const free=(await ask(owner,'inventory')).data;check('native free slot is explicitly reported',JSON.stringify(free.freeSlotIndexes)==='[0]'&&free.freeSlotCount===1);
  const source=afterRejected.player[35],put=run+'_put',equip=run+'_equip';const moved=await ask(owner,'transfer','put 0 1 35',put);check('valid original-handler transfer still applies',moved.ok===true&&moved.data.status==='applied');
  const equipped=await ask(owner,'equip','chest 0',equip);check('valid chest equipment applies',equipped.ok===true&&equipped.data.status==='applied');
  const done=await qa('snapshot');check('full original item components preserved',done.equipment.some(row=>row===source)&&!done.player.includes(source)&&!done.slots.includes(source));
  await ask(owner,'equip','chest 0',equip);check('applied replay does not swap equipment again',JSON.stringify(done)===JSON.stringify(await qa('snapshot')));
  owner._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids\0qiandengji:maid_request')});await delay(600);
  const channelId=run+'_channel',start=report.rawReplies.length;const wire=await ask(owner,'transfer','put 6 1 35',channelId);check('registered chat request keeps correlated plugin reply',wire.requestId===channelId&&report.rawReplies.slice(start).filter(row=>row.value.requestId===channelId).length===1&&report.rawReplies.at(-1).route==='plugin');
  const payloadId=run+'_payload';const payload=await ask(owner,'equip','chest 6',payloadId,true);check('plugin request uses same validation boundary',payload.ok===false&&payload.error==='maid_slot_unavailable'&&(await receipt(owner,payloadId)).data?.status==='rejected');
  await rc('minecraft:save-all flush');await fs.writeFile(root+'/restart-state.json',JSON.stringify({maidId:maid,rejected,put,equip,done,source},null,2));
 }else{
  const saved=JSON.parse(await fs.readFile(root+'/restart-state.json','utf8'));maid=saved.maidId;report.maidId=maid;
  await rc('minecraft:execute in minecraft:overworld run minecraft:forceload add 300 300');await delay(1500);
  const rejected=await receipt(owner,saved.rejected),applied=await receipt(owner,saved.equip);
  check('rejected receipt survives normal restart',rejected.ok===true&&rejected.data.status==='rejected'&&rejected.data.observation.effectsApplied===false);
  check('applied receipt survives normal restart',applied.ok===true&&applied.data.status==='applied');
  const now=await qa('snapshot');check('restart preserves items without replay',JSON.stringify(now)===JSON.stringify(saved.done));
  await ask(owner,'equip','chest 0',saved.equip);check('replay after restart is still idempotent',JSON.stringify(now)===JSON.stringify(await qa('snapshot')));
  await rc('minecraft:execute in minecraft:overworld run minecraft:forceload remove 300 300');
 }
}catch(error){report.error=String(error);report.lines=bots.map(bot=>({name:bot.username,lines:bot.lines.slice(-8)}));console.log(report.error);}
finally{
 for(const bot of bots)bot.quit();report.passed=!report.error&&report.checks.every(row=>row.ok);
 await fs.writeFile(root+`/inventory-${baseline?'baseline':restart?'restart':'candidate'}-${run}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(row=>!row.ok).map(row=>row.name),error:report.error}));if(!report.passed)process.exitCode=1;
}
