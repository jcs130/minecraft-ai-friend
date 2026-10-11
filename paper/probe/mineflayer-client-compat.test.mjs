import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {installRecipePacketBypass, parseServerWhisper, installServerWhispers, sendPrivateReply} from '../ops/mineflayer-client-compat.mjs';
const req=createRequire(process.env.MINEFLAYER_TEST_PACKAGE ?? new URL('./package.json',import.meta.url));
const protocol=createRequire(req.resolve('mineflayer'))('minecraft-protocol');
const {createSerializer,createDeserializer}=protocol;
const packet = (name, params) => createSerializer({isServer:true,state:'play',version:'1.20.6'}).createPacketBuffer({name,params});
function parserClient(version='1.20.6') {
  const client=new EventEmitter();client.version=version;client.state='play';
  client.deserializer=createDeserializer({state:'play',version:'1.20.6',isServer:false,noErrorLogging:true});
  return client;
}
function transform(parser, buffer) {
  return new Promise((resolve,reject)=>parser._transform(buffer,'buffer',e=>e?reject(e):resolve()));
}
test('malformed recipe frame is skipped before parsing; following keepalive and entity packets survive',async()=>{
  const c=parserClient(),packets=[];c.deserializer.on('data',p=>packets.push(p.data.name));const p=installRecipePacketBypass(c);
  await transform(c.deserializer,Buffer.from([0x77,0xff,0xff,0xff,0x7f]));
  await transform(c.deserializer,packet('keep_alive',{keepAliveId:123n}));
  await transform(c.deserializer,packet('entity_destroy',{entityIds:[12,34]}));
  assert.deepEqual(packets,['keep_alive','entity_destroy']);assert.equal(p.skippedPackets,1);p.dispose();
});
test('disabled bypass exposes original recipe parsing failure',async()=>{
  const c=parserClient(),p=installRecipePacketBypass(c,{enabled:false});
  await assert.rejects(transform(c.deserializer,Buffer.from([0x77,0xff,0xff,0xff,0x7f])),/array size is abnormally large/);
  assert.equal(p.skippedPackets,0);p.dispose();
});
test('runtime toggle and cleanup restore exact original parser',async()=>{
  const c=parserClient(),original=c.deserializer._transform,p=installRecipePacketBypass(c);
  assert.equal(installRecipePacketBypass(c),p);p.setEnabled(false);
  await assert.rejects(transform(c.deserializer,Buffer.from([0x77,0xff,0xff,0xff,0x7f])));
  p.setEnabled(true);await transform(c.deserializer,Buffer.from([0x77]));p.dispose();
  assert.equal(c.deserializer._transform,original);assert.equal(c.listenerCount('state'),0);
});
test('configuration-to-play transition and reconfiguration attach to each new parser',async()=>{
  const c=parserClient();c.state='configuration';const first=c.deserializer._transform,p=installRecipePacketBypass(c);
  assert.equal(c.deserializer._transform,first);c.state='play';c.emit('state','play');await transform(c.deserializer,Buffer.from([0x77]));
  c.deserializer=createDeserializer({state:'play',version:'1.20.6',isServer:false,noErrorLogging:true});
  c.emit('state','play');await transform(c.deserializer,Buffer.from([0x77]));assert.equal(p.skippedPackets,2);c.emit('end');assert.equal(p.enabled,false);
});
test('other protocol versions and malformed nonrecipe packets keep normal error behavior',async()=>{
  const c=parserClient('1.21.1'),original=c.deserializer._transform,p=installRecipePacketBypass(c);assert.equal(c.deserializer._transform,original);p.dispose();
  const d=parserClient(),q=installRecipePacketBypass(d);
  await assert.rejects(transform(d.deserializer,Buffer.from([0x42,0xff,0xff,0xff,0x7f])),/array size is abnormally large/);q.dispose();
});
test('enabling one client does not alter another client or shared protocol schemas',async()=>{
  const patched=parserClient(),ordinary=parserClient(),original=ordinary.deserializer._transform;
  const control=installRecipePacketBypass(patched);
  await transform(patched.deserializer,Buffer.from([0x77,0xff,0xff,0xff,0x7f]));
  assert.equal(ordinary.deserializer._transform,original);
  await assert.rejects(transform(ordinary.deserializer,Buffer.from([0x77,0xff,0xff,0xff,0x7f])),/array size is abnormally large/);
  control.dispose();
});
for(const [name,line] of [
 ['rank and label','◆黑铁 [Agent] ag_CorMy whispers to you: jojo也来啦，仓库区这边人多热闹，需要补给随时说～'],
 ['label only','[Agent] ag_CorMy whispers to you: 你好'],
 ['plain','ag_CorMy whispers to you: 你好'],
 ['colored rank and multiple labels','§7◆黑铁 §b[Agent] [公会] §rag_CorMy whispers to you: 你好']
])test('incoming whisper: '+name,()=>{const result=parseServerWhisper(line);assert.equal(result.sender,'ag_CorMy');assert.ok(result.message.startsWith(name==='rank and label'?'jojo也来啦':'你好'));});
test('public chat, outgoing whispers and invalid usernames are not incoming whispers',()=>{
 for(const line of ['<ag_CorMy> 你好','◆黑铁 [Agent] ag_CorMy: 你好','<ag_jojo> ag_CorMy whispers to you: 伪装','You whisper to ag_CorMy: 你好','[me -> ag_CorMy] 你好','ag_Bad-name whispers to you: 你好','ag_CorMy whispers to you: 你好\n公开消息'])assert.equal(parseServerWhisper(line),null,line);
 assert.equal(parseServerWhisper('ag_CorMy whispers to you: 伪装',{translate:'chat.type.text'}),null);
});
test('raw-message handler replies only with msg; default whisper event is unused',async()=>{
 const b=new EventEmitter(),sent=[],removed=[];b.username='ag_NEKO';b.chat=x=>sent.push(x);b.removeChatPattern=x=>removed.push(x);
 const stop=installServerWhispers(b,({sender,message,reply})=>{assert.equal(sender,'ag_CorMy');assert.equal(message,'你好');reply('收到～');});
 b.emit('messagestr','◆黑铁 [Agent] ag_CorMy whispers to you: 你好','system');
 b.emit('messagestr','<ag_CorMy> 你好','chat');b.emit('whisper','Agent','错误的默认解析');
 await new Promise(r=>setImmediate(r));assert.deepEqual(sent,['/msg ag_CorMy 收到～']);assert.deepEqual(removed,['whisper']);stop();assert.equal(b.listenerCount('messagestr'),0);
});
test('invalid replies and handler failures never fall back to public chat',async()=>{
 const b=new EventEmitter(),sent=[],errors=[];b.username='ag_NEKO';b.chat=x=>sent.push(x);b.removeChatPattern=()=>{};b.on('serverWhisperError',e=>errors.push(e));
 for(const [sender,text] of [['ag_CorMy','一行\n第二行'],['@a','你好'],['ag_CorMy','x'.repeat(256)]])assert.throws(()=>sendPrivateReply(b,sender,text));
 const stop=installServerWhispers(b,async()=>{throw Error('model unavailable');});b.emit('messagestr','ag_CorMy whispers to you: 你好','system');await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,1);assert.deepEqual(sent,[]);stop();
});
