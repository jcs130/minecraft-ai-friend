'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {attachSaoGameplay,prepareCommand,contract}=require('../sao-client.cjs')
function fixture(timeoutMs=30){
 const bot=new EventEmitter();bot._client=new EventEmitter();bot._client.uuid='8e7b99e0-595d-3402-935c-7139ac6814e3'
 const wire=[];bot._client.write=(name,p)=>{wire.push({name,...p});bot.emit('wire',p)}
 const port=attachSaoGameplay(bot,{timeoutMs})
 const deliver=row=>bot._client.emit('custom_payload',{channel:'maw_agent:sao_state',data:Buffer.from(JSON.stringify({schemaVersion:1,bodyId:bot._client.uuid,...row}))})
 return {bot,port,wire,deliver}
}
test('every advertised operation has one schema and a valid example',()=>{
 assert.equal(new Set(contract.operations.map(o=>o.id)).size,contract.operations.length)
 const {parameterProblem}=require('../../tau-ceti/native-bridge/native-client.cjs')
 for(const op of contract.operations)assert.equal(parameterProblem(op.example,op.parameters),null,op.id)
})
test('reads exactly one requested page through a private connection and does not fetch the rest',async()=>{
 const f=fixture();f.bot.on('wire',p=>{const q=JSON.parse(p.data);f.deliver({...q,readOnly:true,ok:true,status:'ok',data:{quests:[{id:'abc'}],nextOffset:8,complete:false}})})
 const r=await f.port.read('sao.quests.list',{offset:0,limit:8});assert.equal(f.wire.length,1);assert.equal(f.wire[0].channel,'maw_agent:sao_query');assert.equal(r.data.complete,false);assert.equal(r.data.nextOffset,8)
})
test('wrong account and mismatched operation do not satisfy a query',async()=>{
 const f=fixture();f.bot.on('wire',p=>{const q=JSON.parse(p.data);f.deliver({...q,bodyId:'another-body',readOnly:true,ok:true});f.deliver({...q,operation:'sao.talents',readOnly:true,ok:true})})
 const r=await f.port.read('sao.status');assert.equal(r.status,'unknown');assert.equal(r.outcomeKnown,false)
})
test('invalid values are diagnosed without a packet or target guessing',async()=>{
 const f=fixture();const r=await f.port.read('sao.quest.show',{});assert.equal(r.reason,'invalid_arguments');assert.equal(f.wire.length,0)
 assert.throws(()=>prepareCommand('sao.loadout.bind',{kind:'sword',slot:0},'a'),/invalid_arguments/)
 assert.throws(()=>prepareCommand('sao.status',{},'a'),/declared_mutation_required/)
})
test('preparation cannot dispatch mutations and conserves request identity',async()=>{
 const f=fixture();f.bot.on('wire',p=>{const q=JSON.parse(p.data);f.deliver({...q,readOnly:true,ok:true,data:{operations:contract.operations.map(o=>({id:o.id,readOnly:o.readOnly}))}})})
 const id=f.port.requestId('model-call-1'),p=await f.port.prepare('sao.profession.choose',{profession_id:1},id)
 assert.equal(id,f.port.requestId('model-call-1'));assert.equal(f.wire.length,1);assert.match(p.command,/^\/saoagent do /);assert.ok(p.command.length<=240)
 assert.deepEqual(JSON.parse(Buffer.from(p.command.split(' ').at(-1),'base64url')), {profession_id:1})
 assert.throws(()=>prepareCommand('sao.profession.choose',{profession_id:1},'../x'),/request_id_required/)
 for(const invalid of [null,undefined,1])assert.throws(()=>prepareCommand('sao.profession.choose',{profession_id:1},invalid),/request_id_required/)
})
test('disconnect produces unknown and never resends an action',async()=>{
 const f=fixture();const pending=f.port.read('sao.status');f.bot.emit('end');assert.equal((await pending).status,'unknown');assert.equal(f.wire.length,1);assert.equal((await f.port.read('sao.status')).status,'offline')
})
test('an early private native action receipt is retained until its existing core queue is observed',async()=>{
 const f=fixture();f.bot.on('wire',p=>{const q=JSON.parse(p.data);f.deliver({...q,readOnly:true,ok:true,data:{operations:contract.operations}})})
 const p=await f.port.prepare('sao.reward.claim',{reward_id:'6204F8971646E9F8'},'claim-1')
 f.deliver({requestId:'claim-1',operation:'sao.reward.claim',readOnly:false,status:'completed',ok:true,inventoryChanges:[{slot:36}]})
 const r=await p.wait();assert.equal(r.status,'completed');assert.equal(r.inventoryChanges[0].slot,36);assert.equal(f.wire.length,1)
})
test('an old local success cannot hide a fresh same-ID parameter conflict',async()=>{
 const f=fixture();f.bot.on('wire',p=>{const q=JSON.parse(p.data);f.deliver({...q,readOnly:true,ok:true,data:{operations:contract.operations}})})
 f.deliver({requestId:'claim-1',operation:'sao.reward.claim',readOnly:false,status:'completed',ok:true})
 const p=await f.port.prepare('sao.reward.claim',{reward_id:'428CA4A4788BBD26'},'claim-1');assert.equal(f.port.cachedReceipt('claim-1'),null)
 const response=p.wait();f.deliver({requestId:'claim-1',operation:'sao.reward.claim',readOnly:false,status:'blocked',reason:'request_id_conflict',ok:false})
 assert.equal((await response).reason,'request_id_conflict')
})
