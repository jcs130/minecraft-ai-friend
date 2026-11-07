import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createMaidPort,maidCommand,MAID_CHANNEL} from '../agent/maid-port.mjs';
const maid='e3228ffc-eb42-441d-a08c-3e5948a307e8', recipient='fce37da4-0183-4f20-a160-3fe49d871878';
const envelope=(action,id,data)=>({schema:1,protocol:'qiandengji-maids/v1',recipientUuid:recipient,action,requestId:id,ok:true,sampledAt:new Date().toISOString(),data});
test('nearby discovery has no invented maid identity and accepts its authenticated catalogue',async()=>{
  assert.equal(maidCommand({action:'nearby',requestId:'near'}).command,'/qdmaid nearby near');
  assert.throws(()=>maidCommand({action:'nearby',maidId:maid}),/unexpected/);
  const bot=client(),port=createMaidPort(bot),result=port.request({action:'nearby',requestId:'near'});
  bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope('nearby','near',{maids:[{maidId:maid,owned:false,publicChatEnabled:true}]})))});
  assert.equal((await result).data.maids[0].maidId,maid);port.close();
});
test('visitor dialogue retains its own result without receiving owner context',async()=>{
  const bot=client(),events=[],port=createMaidPort(bot,{onChatResult:x=>events.push(x)});
  const result=port.request({action:'chat',maidId:maid,requestId:'visitor',text:'你好'});
  bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope('chat','visitor',{maidId:maid,status:'pending',observation:{conversation:'nearby_visitor'}})))});
  assert.equal((await result).data.status,'pending');
  bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope('chat-result','visitor',{maidId:maid,operationId:'visitor',status:'replied',observation:{conversation:'nearby_visitor',reply:'你好'}})))});
  assert.equal(events[0].data.observation.reply,'你好');port.close();
});
function client(){const bot=new EventEmitter();bot._client=new EventEmitter();bot._client.uuid=recipient;bot._client.write=()=>{};bot.chat=()=>{};return bot;}
test('brain reads choices without a write ID and selection retains its original operation ID',()=>{
  const read=maidCommand({action:'brain',maidId:maid});assert.equal(read.operationId,undefined);assert.match(read.command,/^\/qdmaid brain /);
  const selected=maidCommand({action:'brain',maidId:maid,choice:'dsh',requestId:'select-dsh'});
  assert.equal(selected.command,`/qdmaid brain ${maid} select-dsh dsh`);assert.equal(selected.operationId,'select-dsh');
  assert.throws(()=>maidCommand({action:'brain',maidId:maid,choice:'codex'}),/requestId/);
  assert.throws(()=>maidCommand({action:'brain',maidId:maid,choice:'dsh; say x',requestId:'bad'}),/exact ID/);
});
test('brain selection reply uses the same authenticated native transport',async()=>{
  const bot=client(),port=createMaidPort(bot),result=port.request({action:'brain',maidId:maid,requestId:'brain-read'});
  bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope('brain','brain-read',{maidId:maid,selected:'native',choices:[{id:'dsh'}]})))});
  assert.equal((await result).data.choices[0].id,'dsh');port.close();
});
test('host adapter supports native dialogue and six equipment slots without raw model code',()=>{
  assert.equal(maidCommand({action:'chat',maidId:maid,requestId:'native-1',text:'跟我说说你的状态'}).command,`/qdmaid chat ${maid} native-1 跟我说说你的状态`);
  for(const hand of ['main','off','head','chest','legs','feet'])assert.equal(maidCommand({action:'equip',maidId:maid,requestId:'gear-1',hand,slot:3}).command,`/qdmaid equip ${maid} gear-1 ${hand} 3`);
  assert.throws(()=>maidCommand({action:'chat',maidId:maid,text:'你好'}),/retained requestId/);
});
test('command fallback resolves only authentic server system messages',async()=>{
  const bot=client(),port=createMaidPort(bot,{timeoutMs:1000});let done=false;
  const result=port.request({action:'context',maidId:maid,requestId:'ctx'}).then(r=>{done=true;return r;});
  const line='QD_MAID '+JSON.stringify(envelope('context','ctx',{maidId:maid,lifeState:'alive'}));
  bot.emit('messagestr',line,'chat',{},recipient);await new Promise(r=>setTimeout(r,10));assert.equal(done,false);
  bot.emit('messagestr',line,'system',{},null);assert.equal((await result).data.lifeState,'alive');port.close();assert.equal(bot.listenerCount('messagestr'),0);
});
test('owner death and native chat result are independent events, not request completion',async()=>{
  const bot=client(),life=[],chat=[];const port=createMaidPort(bot,{onLifecycle:x=>life.push(x),onChatResult:x=>chat.push(x)});
  for(const [action,id,data] of [['lifecycle','death-1',{maidId:maid,lifeState:'dead'}],['chat-result','chat-1',{maidId:maid,status:'replied'}]])
    bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope(action,id,data)))});
  assert.equal(life.length,1);assert.equal(chat.length,1);port.close();
});
test('uncertain writes keep the original operation ID and never retry',async()=>{
  const bot=client();let writes=0;bot.chat=()=>writes++;const port=createMaidPort(bot,{timeoutMs:30});
  const result=await port.request({action:'chat',maidId:maid,requestId:'original-1',text:'你好'});
  assert.equal(result.status,'unknown');assert.equal(result.operationId,'original-1');assert.equal(result.retryAllowed,false);assert.equal(writes,1);port.close();
});

test('persisted recovery remains a lifecycle observation, separate from a context request',async()=>{
  const bot=client(),life=[];let writes=0;bot.chat=()=>writes++;
  const port=createMaidPort(bot,{onLifecycle:x=>life.push(x)});
  const recovery={eventId:'recovery-0123456789abcdef01234567',maidId:maid,observedAt:'2026-01-01T00:00:00Z',actualRevivalTimeKnown:false,persisted:true};
  const result=port.request({action:'context',maidId:maid,requestId:'ctx-recovery'});let done=false;result.then(()=>done=true);
  bot._client.emit('custom_payload',{channel:MAID_CHANNEL,data:Buffer.from(JSON.stringify(envelope('lifecycle',recovery.eventId,{maidId:maid,lifeState:'unloaded_or_unavailable',recovery})))});
  await new Promise(r=>setTimeout(r,10));assert.equal(done,false);assert.equal(life.length,1);
  assert.deepEqual(life[0].data.recovery,recovery);
  bot.emit('messagestr','QD_MAID '+JSON.stringify(envelope('context','ctx-recovery',{maidId:maid,lifeState:'unloaded_or_unavailable',recovery})),'system',{},null);
  assert.equal((await result).data.lifeState,'unloaded_or_unavailable');assert.equal(writes,1);port.close();
});
