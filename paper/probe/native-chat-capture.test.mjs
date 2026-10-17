import test from 'node:test';
import assert from 'node:assert/strict';
import {latestChatTypes, componentUuid, verifyNativeChatCapture} from './verify-native-chat-capture.mjs';

const uuid='ec68989c-7b3e-3b65-96e2-37a1d989e9c3';
const text=value=>({type:'string',value});
const compound=value=>({type:'compound',value});
const name=compound({text:text('ag_AuthQA'),hoverEvent:compound({contents:compound({
  id:{type:'intArray',value:[-328689508,2067676005,-1763559519,-645273149]}
})})});
const entry=(key,translation)=>({key,value:compound({chat:compound({translation_key:text(translation)})})});
const tables=[
  {id:'minecraft:chat_type',entries:[entry('minecraft:chat','chat.type.text'),
    entry('minecraft:system','chat.type.system'),entry('minecraft:game_info','chat.type.game_info')]},
  {id:'minecraft:chat_type',entries:[entry('minecraft:chat','chat.type.text'),
    entry('paper:raw','%s'),entry('minecraft:msg_command_incoming','commands.message.display.incoming'),
    entry('minecraft:msg_command_outgoing','commands.message.display.outgoing')]}
];
function fixture(version='1.20.6') {
  const holder=n=>version==='1.20.6'?n:{chatType:n};
  return {passed:true,versions:[{version,uuid,registry:structuredClone(tables),samples:[{
    alias:'minecraft:msg',marker:'private-body',packets:[
      {packet:'profileless_chat',data:{type:holder(3),message:text('private-body'),name,target:name}},
      {packet:'profileless_chat',data:{type:holder(2),message:text('private-body'),name}}
    ]
  }]}]};
}
test('final configuration replaces the login limbo registry',()=>{
  assert.equal(latestChatTypes(tables)[2].key,'minecraft:msg_command_incoming');
});
for(const version of ['1.20.6','1.21.1']) test(version+' native incoming/outgoing packets retain UUID',()=>{
  assert.equal(verifyNativeChatCapture(fixture(version))[0].checkedPackets,2);
});
test('four signed NBT integers retain the actual offline UUID',()=>{
  assert.equal(componentUuid(name),uuid);
});
test('ordinary system message containing whisper text cannot pass as native private chat',()=>{
  const f=fixture();f.versions[0].samples[0].packets[1].packet='system_chat';
  assert.throws(()=>verifyNativeChatCapture(f),/native typed chat/);
});
test('rendered private wording cannot compensate for a public chat-type ID',()=>{
  const f=fixture();f.versions[0].samples[0].packets[1].data.type=0;
  assert.throws(()=>verifyNativeChatCapture(f),/public\/system chat type/);
});
test('using only the limbo registry is detected',()=>{
  const f=fixture();f.versions[0].registry.pop();
  assert.throws(()=>verifyNativeChatCapture(f));
});
test('a forged sender UUID is rejected',()=>{
  const f=fixture();f.versions[0].uuid='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>verifyNativeChatCapture(f),/sender UUID mismatch/);
});
test('duplicate incoming delivery cannot replace outgoing confirmation',()=>{
  const f=fixture();f.versions[0].samples[0].packets[0]=structuredClone(f.versions[0].samples[0].packets[1]);
  assert.throws(()=>verifyNativeChatCapture(f),/must be distinct/);
});
