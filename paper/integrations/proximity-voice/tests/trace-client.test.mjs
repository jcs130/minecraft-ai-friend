import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';
import {traceVoiceConnection} from '../trace-client.mjs';
function fixture(){const bot=new EventEmitter(),sent=[];bot._client=new EventEmitter();bot._client.state='play';bot._client.uuid=randomUUID();bot._client.write=function(...args){assert.equal(this,bot._client);sent.push(args);return 17;};return{bot,sent};}
test('passive trace retains byte identity, original request and call result, without secrets or text',()=>{
 const {bot,sent}=fixture(),records=[],original=bot._client.write,trace=traceVoiceConnection(bot,{runId:'original-run',connectionId:'original-connection',onRecord:r=>records.push(r)});
 assert.equal(sent.length,0);const requestId=randomUUID(),data=Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({op:'begin',requestId,bytes:400,sha256:'a'.repeat(64),text:'private words',token:'secret'}))]);
 assert.equal(bot._client.write('custom_payload',{channel:'mcagent:voice',data}),17);assert.equal(sent[0][1].data,data);
 const row=records.find(r=>r.op==='begin');assert.equal(row.requestId,requestId);assert.equal(row.expectedBytes,400);assert.equal(row.frameSha256.length,64);assert(!JSON.stringify(records).includes('private words'));assert(!JSON.stringify(records).includes('secret'));
 trace.close();assert.equal(bot._client.write,original);assert.equal(bot._client.listenerCount('custom_payload'),0);
});
test('records binary first sequence and failed reply; caps collection, detaches on end',()=>{
 const {bot,sent}=fixture(),records=[],trace=traceVoiceConnection(bot,{runId:'r',connectionId:'c',maxEvents:4,onRecord:r=>records.push(r)}),id=randomUUID();
 const data=Buffer.alloc(22);data[0]=2;Buffer.from(id.replaceAll('-',''),'hex').copy(data,1);data.writeInt32BE(0,17);
 bot._client.write('custom_payload',{channel:'mcagent:voice',data});bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({requestId:id,state:'failed',reason:'UPLOAD_CHUNK_INVALID'}))])});
 for(let n=0;n<20;n++)bot._client.write('custom_payload',{channel:'mcagent:voice',data});
 assert.equal(records.length,4);assert.equal(records[1].sequence,0);assert.equal(records[1].chunkBytes,1);assert.equal(records[2].state,'failed');assert.equal(sent.length,21);bot.emit('end');trace.close();assert.equal(bot._client.listenerCount('custom_payload'),0);
});
test('invalid envelope and callback failure never alter the original transport exception',()=>{
 const {bot}=fixture();bot._client.write=()=>{throw Error('ORIGINAL_WRITE_FAILURE');};const trace=traceVoiceConnection(bot,{runId:'r',connectionId:'c',onRecord:()=>{throw Error('diagnostic failure');}});
 assert.throws(()=>bot._client.write('custom_payload',{channel:'mcagent:voice',data:Buffer.from([1,255])}),/ORIGINAL_WRITE_FAILURE/);trace.close();
 assert.throws(()=>traceVoiceConnection(bot,{}),/ORIGINAL_HOST/);
});
