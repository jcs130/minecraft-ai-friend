'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {attachProtection}=require('../protection-client.cjs')
function fixture(){const bot=new EventEmitter();bot._client=new EventEmitter();bot._client.write=(packet,body)=>bot.emit('wire',{packet,...body});const notices=[];return {bot,notices,port:attachProtection(bot,row=>notices.push(row))}}
function deliver(bot,row){bot._client.emit('custom_payload',{channel:'mcagent:protection',data:Buffer.from(JSON.stringify(row))})}
test('request and reply use plugin payloads with absolute coordinates, without chat',async()=>{
 const {bot,port}=fixture();let sent;bot.once('wire',p=>{sent=p;const q=JSON.parse(p.data);deliver(bot,{...q,status:'deny',reason:'protected_building'})})
 const out=await port.check('break','overworld',{x:6,y:100,z:0},true)
 assert.equal(sent.packet,'custom_payload');assert.equal(sent.channel,'mcagent:protection_query');assert.equal(out.status,'deny');assert.equal(out.x,6);assert.equal(port.verdict('break','minecraft:overworld',out),'deny')
})
test('matching ID with a different coordinate cannot complete another query',async()=>{
 const {bot,port,notices}=fixture();let q;bot.once('wire',p=>{q=JSON.parse(p.data);deliver(bot,{...q,x:8,status:'deny'})})
 let settled=false;const result=port.check('place','overworld',{x:7,y:100,z:0},true).then(v=>{settled=true;return v})
 await Promise.resolve();assert.equal(settled,false);deliver(bot,{...q,status:'allow_likely',reason:'outside_protected_building'});assert.equal((await result).status,'allow_likely');assert.equal(notices.length,2)
})
test('unknown remains unknown and never becomes permission',async()=>{
 const {bot,port}=fixture();bot.once('wire',p=>deliver(bot,{...JSON.parse(p.data),status:'unknown',reason:'structure_metadata_unloaded'}));assert.equal((await port.check('break','overworld',{x:1,y:64,z:1})).status,'unknown');assert.equal(port.verdict('break','overworld',{x:1,y:64,z:1}),'unknown')
})
test('connection loss resolves pending reads as unknown and discards old cache',async()=>{
 const {bot,port}=fixture();const read=port.check('break','overworld',{x:1,y:64,z:1});bot.emit('end');assert.equal((await read).status,'unknown');assert.equal(port.verdict('break','overworld',{x:1,y:64,z:1}),null)
})
test('ambiguous or incomplete coordinates do not send a request',async()=>{
 const {bot,port}=fixture();let count=0;bot.on('wire',()=>count++);await assert.rejects(port.check('break','overworld',{x:1,y:64}));await assert.rejects(port.check('to','overworld',{x:1,y:64,z:1}));assert.equal(count,0)
})
