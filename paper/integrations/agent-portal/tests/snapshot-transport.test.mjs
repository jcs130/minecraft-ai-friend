import test from 'node:test';
import assert from 'node:assert/strict';
import {sendSnapshot} from '../scripts/snapshot-transport.mjs';

test('snapshot timeout retries exactly the same immutable sequence once with fresh connections',async()=>{
 const calls=[],body=JSON.stringify({sequence:12,roster:[]});
 const fetcher=async(url,options)=>{calls.push({url,options});if(calls.length===1)throw new DOMException('timeout','TimeoutError');return Response.json({accepted:true})};
 const result=await sendSnapshot('https://example.invalid/api/v1/internal/snapshot',{body,token:'isolated-test-token',fetcher});
 assert.equal(result.response.status,200);assert.deepEqual(result.result,{accepted:true});assert.equal(calls.length,2);
 assert.equal(calls[0].options.body,body);assert.equal(calls[1].options.body,body);assert.equal(calls[0].options.headers.Connection,'close');
 assert.deepEqual(calls[0].options.headers,calls[1].options.headers);
});
test('repeated timeout is bounded and cannot loop indefinitely',async()=>{
 let calls=0;await assert.rejects(sendSnapshot('https://example.invalid',{token:'test',body:'{}',fetcher:async()=>{calls++;throw new DOMException('timeout','TimeoutError')}}),{name:'TimeoutError'});assert.equal(calls,2);
});
test('HTTP rejection, rate limits and credential failures never cause retry',async()=>{
 for(const status of [400,401,403,409,429,503]){let calls=0;const {response}=await sendSnapshot('https://example.invalid',{token:'test',body:'{}',fetcher:async()=>{calls++;return Response.json({error:{reason:'rejected'}},{status})}});assert.equal(response.status,status);assert.equal(calls,1)}
});
test('an invalid response or explicit cancellation is not a replay signal',async()=>{
 for(const error of [new SyntaxError('invalid JSON'),new DOMException('stopped','AbortError')]){let calls=0;await assert.rejects(sendSnapshot('https://example.invalid',{token:'test',body:'{}',fetcher:async()=>{calls++;throw error}}));assert.equal(calls,1)}
});
test('a reset connection can retry the same read-only snapshot',async()=>{
 let calls=0;const {result}=await sendSnapshot('https://example.invalid',{token:'test',body:'{}',fetcher:async()=>{if(++calls===1)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});return Response.json({sequence:1})}});assert.equal(calls,2);assert.equal(result.sequence,1);
});
