import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeDecisionResult} from '../admin/native-decision-result.mjs';

const binding={turnId:'turn-1',taskId:'task-1',sessionId:'life-1'};
const message=text=>({type:'message',role:'assistant',status:'completed',content:[{type:'text',text}]});
const response=(output,extra={})=>({status:'finished',result:{status:'completed',session_id:'life-1',output,...extra}});
const read=(payload,options={})=>readNativeDecisionResult(binding,{baseUrl:'http://127.0.0.1:18089/api',fetchImpl:async()=>new Response(JSON.stringify(payload)),...options});
test('native result projects final answer and tool names, never reasoning, prompts or raw arguments',async()=>{
 const result=await read(response([{type:'reasoning',content:[{type:'text',text:'PRIVATE_REASONING'}]},message('intermediate'),
  {type:'plugin_call',role:'assistant',status:'completed',content:[{type:'data',data:{name:'numen_survival__look',call_id:'call-1',arguments:{secret:'PRIVATE_ARGS'}}}]},
  {type:'plugin_call_output',role:'tool',content:[{type:'text',text:'PRIVATE_TOOL_OUTPUT'}]},message('已上岸，等待夜晚。')]));
 assert.equal(result.finalText,'已上岸，等待夜晚。');assert.equal(result.status,'completed');
 assert.deepEqual(result.tools,[{callId:'call-1',name:'numen_survival__look',status:'completed'}]);
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('session mismatch, running tasks and terminal sentinels cannot become final answers',async()=>{
 assert.equal((await read(response([message('wrong')],{session_id:'other'}))).availability,'session_mismatch');
 const running=await read({status:'running',result:{status:'running',session_id:'life-1',output:[message('unfinished')]}});
 assert.equal(running.status,'running');assert.equal(running.finalText,null);
 for(const final of ['', 'Max iterations reached', 'Doom loop detected']){
  assert.equal((await read(response([message('do not fall back'),message(final)]))).finalText,null);
 }
});
test('only GET for a validated task on the fixed agent; unavailable and oversized sources degrade explicitly',async()=>{
 let called=false;
 const r=await read(response([]),{fetchImpl:async(url,options)=>{called=true;assert.equal(url,'http://127.0.0.1:18089/api/console/chat/task/task-1');assert.equal(options.method,'GET');assert.equal(options.headers['X-Agent-Id'],'qd-survivor');assert.equal(options.redirect,'error');return new Response('{}',{status:404});}});
 assert.ok(called);assert.equal(r.availability,'unavailable');
 const invalid=await readNativeDecisionResult({...binding,taskId:'../../other'},{baseUrl:'http://127.0.0.1:18089/api',fetchImpl:()=>assert.fail('must not fetch')});
 assert.equal(invalid.availability,'unbound');
 assert.equal((await read(response([message('x'.repeat(2*1024*1024))]))).availability,'unavailable');
 assert.equal((await read(response([]),{fetchImpl:async()=>{throw Error('network');}})).availability,'unavailable');
});
