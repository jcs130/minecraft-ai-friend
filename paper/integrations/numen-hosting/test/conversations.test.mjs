import test from 'node:test';
import assert from 'node:assert/strict';
import {HostingStore} from '../src/store.mjs';
import {HostedConversations} from '../src/conversations.mjs';
const role={serverId:'test',roleUuid:'00000000-0000-0000-0000-000000000001',numenOwnerUuid:'00000000-0000-0000-0000-000000000002',ownerId:'owner-one',name:'HostedOne'},actor={id:'viewer-one',name:'观众'};
function fixture(t){const store=new HostingStore(':memory:');t.after(()=>store.close());let mode='harness',calls=[];
  const body={async message(r,args){calls.push(args);return{id:args.id,state:'completed',delivered:true};}};
  const chat=new HostedConversations({store,hosting:{owned:()=>({}),status:()=>({state:'ready',mode})},body});return{chat,body,calls,setMode:m=>mode=m};}
test('spectator messages stay attributed, dedupe by actor and role, never invoke a body action',async t=>{
  const f=fixture(t),data={id:'message-00001',text:'你好'};
  assert.equal((await f.chat.send(role,actor,data)).state,'delivered');await f.chat.send(role,actor,data);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].speaker,'观众');assert.match(f.calls[0].senderId,/^[a-f0-9]{64}$/);assert.equal(f.calls[0].tool,undefined);
  await assert.rejects(f.chat.send(role,actor,{...data,text:'不同正文'}),{code:'MESSAGE_ID_CONFLICT'});
  assert.equal(f.chat.list(role,{id:'other',name:'另一人'}).length,0);
});
test('paused and manual modes do not start a model from a spectator message',async t=>{
  const f=fixture(t);for(const mode of ['paused','manual']){f.setMode(mode);await assert.rejects(f.chat.send(role,actor,{id:'message-00001',text:'你好'}),{code:'AGENT_NOT_LISTENING'});}assert.equal(f.calls.length,0);
});

test('native multi-line speech is readable and credentials are still excluded before caching',async t=>{
  const f=fixture(t);f.body.replies=async()=>[{id:'speech-fixture-one',body:'已经准备好。\n下一步出发探索。',createdAt:Date.now()},
    {id:'speech-fixture-two',body:'API\nKey synthetic-secret',createdAt:Date.now()}];
  const replies=await f.chat.replies(role);assert.equal(replies.length,1);assert.equal(replies[0].body,'已经准备好。 下一步出发探索。');
});
test('unknown delivery queries the original receipt without redispatch',async t=>{
  const f=fixture(t);f.body.message=async()=>{throw Error('private engine error');};
  const data={id:'message-00001',text:'你好'};assert.equal((await f.chat.send(role,actor,data)).state,'unknown');
  f.body.message=async()=>{throw Error('MUST NOT RESEND');};assert.equal((await f.chat.send(role,actor,data)).state,'unknown');
  f.body.messageResult=async(r,id)=>({id,state:'completed',delivered:true});
  assert.equal((await f.chat.reconcile(role,actor,data.id)).state,'delivered');
});
test('credentials and slash commands are rejected before delivery; per-user flood is bounded',async t=>{
  const f=fixture(t);for(const text of ['/login synthetic','API Key synthetic','密码是示例'])await assert.rejects(f.chat.send(role,actor,{id:'message-00001',text}),{code:'CHAT_TEXT_INVALID'});
  for(let i=0;i<12;i++)await f.chat.send(role,actor,{id:'message-'+i.toString().padStart(5,'0'),text:'你好'});
  await assert.rejects(f.chat.send(role,actor,{id:'message-99999',text:'你好'}),{code:'CHAT_RATE_LIMIT'});
});
