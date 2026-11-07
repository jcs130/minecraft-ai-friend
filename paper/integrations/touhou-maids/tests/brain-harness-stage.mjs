// Original native entity, a fresh loopback QA world, and the already installed Hub.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_BRAIN_QA_STAGE,anchor=process.env.MAID_BRAIN_QA_CLIENT_ANCHOR,root=process.env.MAID_BRAIN_QA_REPORT_ROOT;
assert(stage&&anchor&&root&&process.env.MAID_BRAIN_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const properties=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25938$/m.test(properties)&&/^rcon.port=25939$/m.test(properties));
const fixture=JSON.parse(await fs.readFile(root+'/fixture.json','utf8'));assert(fixture.synthetic&&fixture.gatewayPort===19089&&fixture.nativeMockPort===19088);
const gateway=JSON.parse(await fs.readFile(root+'/qa-gateway.json','utf8'));assert.equal(gateway.maidId,fixture.maid);
const {command}=await import(pathToFileURL(process.env.MAID_BRAIN_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const mode=process.argv.includes('--restart')?'restart':'initial',runId='bh'+Date.now().toString(36),report={mode,runId,checks:[],productionChanged:false,realHubUsed:mode==='initial',realPlayerDataUsed:false};
let bot,seq=0,responseMode='plain';const replies=[],requests=[];
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);assert(ok,name);};
const until=async(fn,label,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(150);}throw Error('Timeout '+label);};
const ints=s=>s.replaceAll('-','').match(/.{8}/g).map(x=>parseInt(x,16)|0).join(',');
const mock=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;let body=JSON.parse(raw);requests.push(body);const how=responseMode==='late'&&body.messages?.at(-1)?.role==='tool'?'plain':responseMode;await delay(how==='late'?4000:1500);
 if(how==='failure'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'QA_MODEL_UNAVAILABLE_QUERY_RECEIPT',message:'Synthetic transport failure'}}));return;}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-native',object:'chat.completion',model:'qa-native',choices:[{index:0,message:how==='late'?{role:'assistant',content:null,tool_calls:[{id:'late_sit',type:'function',function:{name:'switch_sit',arguments:'{"sit":true}'}}]}:{role:'assistant',content:'原生隔离回复，保留当前记忆。'},finish_reason:how==='late'?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
async function ask(action,value='',id='brainqa_'+Date.now()+'_'+(++seq),maid=fixture.maid){
 id=runId+'_'+id;
 await delay(1100);const start=replies.length;const query=action==='receipt'?'query_'+Date.now()+'_'+(++seq):id;
 bot.chat(action==='receipt'?`/qdmaid receipt ${maid} ${id} ${query}`:`/qdmaid ${action} ${maid} ${query}${value?' '+value:''}`);
 return until(()=>replies.slice(start).find(x=>x.action===action&&x.requestId===query),action);
}
async function completed(id,ms=105000){return until(async()=>{const result=await ask('receipt','',id);assert(result.ok,JSON.stringify(result));if(result.data.status==='unknown')throw Error('Native result unknown; retain '+runId+'_'+id+'; '+result.data.observation?.reason);return result.data.status==='replied'?result.data:null;},'original native dialogue '+id,ms);}
async function catalogue(){const response=await fetch(`http://127.0.0.1:${fixture.gatewayPort}/v1/catalogue`,{headers:{authorization:'Bearer '+gateway.token}});assert(response.ok);return response.json();}
async function failures(){
 responseMode='failure';const failureAt=Date.now(),failed=await ask('chat','这次只测试模型不可用，不要执行动作。','failed_native');
 check('unavailable native model starts with the same original pending receipt',failed.ok&&failed.data.status==='pending');
 const terminal=await until(async()=>{const read=await ask('receipt','','failed_native');return read.data?.status==='unknown'?read.data:null;},'explicit terminal model failure',12000);
 check('model failure returns its meaningful original receipt without waiting two minutes',terminal.observation.reason==='QA_MODEL_UNAVAILABLE_QUERY_RECEIPT'&&Date.now()-failureAt<12000&&terminal.observation.retryAllowed===false);
 const callsBeforeReplay=requests.length,replay=await ask('chat','这次只测试模型不可用，不要执行动作。','failed_native');
 check('repeating failed request reads the same receipt and does not resubmit inference',replay.ok&&replay.data.status==='unknown'&&requests.length===callsBeforeReplay);
 responseMode='plain';const recovered=await ask('chat','这是一条新的独立对话，请简短回复。','after_failure');
 check('an explicit new dialogue can proceed after the terminal failure',recovered.ok&&recovered.data.status==='pending');await completed('after_failure');
}
try{
 await until(async()=>{try{return (await rc('version QiandengjiMaidBridge')).includes('0.1.10-harness');}catch{return false;}},'candidate bridge ready',150000);
 await new Promise(resolve=>mock.listen(fixture.nativeMockPort,'127.0.0.1',resolve));
 bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:fixture.username,auth:'offline',hideErrors:true});
 bot.on('error',()=>{});bot.on('messagestr',(s,p)=>{if(p==='system'&&s.startsWith('QD_MAID '))try{replies.push(JSON.parse(s.slice(8)));}catch{}});
 await until(()=>bot.entity&&bot.player?.uuid,'synthetic owner connected');assert.equal(bot.player.uuid,fixture.owner);await rc(`minecraft:gamemode creative ${fixture.username}`);await rc('minecraft:time set 1000');
 if(mode==='restart'){
  const context=await ask('context');check('restart keeps the selected original native model',context.data.brain.selected==='native');
  check('restart keeps same original entity, owner and damage protection',context.data.maidId===fixture.maid&&context.data.health>0&&(await rc(`minecraft:data get entity ${fixture.maid} Invulnerable`)).includes('1b'));
  const selected=await ask('brain');check('restart restores native and both Hub choices',selected.data.choices.filter(x=>x.configured).length===3);
  const wire=JSON.parse(await fs.readFile(stage+'/brain-wire-proof.json','utf8'));check('restart preserves ordinary native-client wire compatibility',wire.passed);
  check('native-client site packets contain no server keys or headers',wire.checks.every(x=>x.serverCredentialsAbsentFromClientWire));
  const follow=await ask('follow','','qa_follow_baseline');check('synthetic boundary fixture starts in actual native following mode',follow.ok&&(await ask('context')).data.sitting===false);
  await failures();
  responseMode='late';const late=await ask('chat','隔离测试：稍后坐下。','late_callback');check('late response fixture entered the original native request',late.ok&&late.data.status==='pending');
  assert((await rc('brainqaflip')).includes('without reloading entity history'));
  const stale=await until(async()=>{const read=await ask('receipt','','late_callback');return read.data?.status==='unknown'?read.data:null;},'stale model response refused',10000);
  const afterStale=await ask('context');report.stale={reason:stale.observation.reason,sitting:afterStale.data.sitting};
  check('a response from the previous selection does not execute its delayed sit tool',stale.observation.reason==='MAID_BRAIN_CHANGED_QUERY_RECEIPT'&&afterStale.data.sitting===false);
  responseMode='plain';const restored=await ask('brain','native','restore_after_stale');check('terminal stale response permits an explicit brain selection',restored.ok&&restored.data.observation.selected==='native');
  await rc('minecraft:save-all flush');
 }else{
  await rc('minecraft:forceload add 300 300');await rc('minecraft:fill 294 89 294 310 89 310 minecraft:stone');await rc('minecraft:fill 294 90 294 310 94 310 minecraft:air');await rc(`minecraft:tp ${fixture.username} 300.5 90 300.5`);
  if(!(await rc(`minecraft:data get entity ${fixture.maid} Health`)).includes('has the following entity data'))await rc(`minecraft:summon touhou_little_maid:maid 302.5 90 300.5 {UUID:[I;${ints(fixture.maid)}],Owner:[I;${ints(fixture.owner)}],CustomName:'"隔离肥鱼"',PersistenceRequired:1b,Invulnerable:1b,MaidAIChat:{LLMSite:"qa_brain_native",LLMModel:"qa-native",ChatLanguage:"zh_cn",TTSSiteName:"__none__",CustomSetting:"你是隔离游戏女仆，按用户要求调用真实工具切换行为。需要驻守时调用 switch_follow_state，需要跟随时也调用该工具。完成工具后简短说明模式已经设置，不能声称游戏目标完成。"}}`);
  await until(()=>Object.values(bot.entities).find(e=>e.uuid===fixture.maid),'original synthetic entity');await delay(1200);
  const choices=await ask('brain');check('native menu catalogue is bound to the original maid',choices.ok&&choices.data.maidId===fixture.maid&&choices.data.selected==='native');
  check('choice catalogue has native, DSH and Codex without private URLs or keys',choices.data.choices.filter(x=>x.configured).length===3&&!JSON.stringify(choices).includes(gateway.token)&&!JSON.stringify(choices).includes('127.0.0.1'));
  check('ordinary native clients decode the guarded OpenAI site wire unchanged',JSON.parse(await fs.readFile(stage+'/brain-wire-proof.json','utf8')).passed);
  bot.chat(`/qdmaid brain-menu ${fixture.maid}`);await until(()=>bot.currentWindow,'native-compatible selection menu');
  check('human selection menu uses an ordinary 27-slot native inventory',bot.currentWindow.inventoryStart===27);
  await bot.clickWindow(12,0,0);await until(()=>!bot.currentWindow,'menu selection completes');
  check('human menu and Agent CLI share the same DSH selection',(await ask('brain')).data.selected==='dsh');
  await ask('brain','native','gui_restore_native');
  const original=await ask('chat','你好','native_before');check('existing native conversation still enters its original receipt',original.ok&&original.data.status==='pending');await completed('native_before');
  check('native mode reached the isolated original provider once',requests.length===1);
  const missing=await ask('brain','unavailable','missing_choice');check('unavailable choice explains refusal and keeps the original selection',!missing.ok&&missing.error==='brain_unavailable'&&(await ask('brain')).data.selected==='native');
  const invalid=await ask('brain','invented','invented_choice');check('unknown choice returns a discoverable usage error',!invalid.ok&&invalid.error==='brain_choice_unknown');
  const selected=await ask('brain','dsh','select_dsh');check('DSH selection is applied without replacing the original maid',selected.ok&&selected.data.observation.selected==='dsh'&&selected.data.observation.historyPreserved===true);
  const duplicate=await ask('brain','dsh','select_dsh');check('repeated selection replays the original receipt',duplicate.ok&&duplicate.data.replayed===true);
  const dsh=await ask('chat','请现在改成驻守状态，不要继续跟随。必须调用 switch_follow_state 工具。','dsh_stay');check('DSH dialogue uses original native pending semantics',dsh.ok&&dsh.data.status==='pending');
  const during=await ask('brain','codex','busy_switch');check('changing brains during a dialogue is refused instead of mixing controllers',!during.ok&&['chat_busy','chat_unresolved'].includes(during.error));
  const result=await completed('dsh_stay');report.dshReplyLength=result.observation?.reply?.length;
  let context=await ask('context');check('real DSH planning changes original native follow state',context.data.homeMode===true&&context.data.brain.selected==='dsh');
  check('DSH completion is a real Hub result rather than a mock',(await catalogue()).last?.harness==='dsh');
  const codex=await ask('brain','codex','select_codex');check('Codex selection uses the separate configured model alias',codex.ok&&codex.data.observation.selected==='codex');
  const chat=await ask('chat','现在离开驻守状态，继续跟随主人。必须调用 switch_follow_state 工具。','codex_follow');check('Codex dialogue accepted by original TLM',chat.ok&&chat.data.status==='pending');await completed('codex_follow');
  context=await ask('context');check('real Codex planning resumes original native following',context.data.homeMode===false&&context.data.sitting===false&&context.data.brain.selected==='codex');
  check('Codex completion is a real Hub result rather than a mock',(await catalogue()).last?.harness==='codex');
  const entity=()=>Object.values(bot.entities).find(e=>e.uuid===fixture.maid),beforeWalk=entity().position.clone();
  await bot.look(-Math.PI/2,0,true);bot.setControlState('forward',true);
  try{await until(()=>bot.entity.position.x>307,'synthetic owner walks',6000);}finally{bot.setControlState('forward',false);}
  await until(()=>entity()?.position.distanceTo(beforeWalk)>2&&entity().position.distanceTo(bot.entity.position)<4,'original maid physically follows',20000);
  check('original native AI physically follows the walking owner after Codex choice',entity().position.distanceTo(beforeWalk)>2);
  const native=await ask('brain','native','restore_native');check('returning to native mode preserves original history and identity',native.ok&&native.data.observation.selected==='native'&&native.data.observation.historyPreserved);
  await failures();
  await rc('tlm ai_chat reload');await rc('brainqawire');await delay(300);check('dedicated config reload keeps server guards and original client serialization',JSON.parse(await fs.readFile(stage+'/brain-wire-proof.json','utf8')).passed);
  if(!(await rc(`minecraft:data get entity ${fixture.otherMaid} Health`)).includes('has the following entity data'))await rc(`minecraft:summon touhou_little_maid:maid 304.5 90 300.5 {UUID:[I;${ints(fixture.otherMaid)}],Owner:[I;${ints(fixture.owner)}],CustomName:'"其他隔离女仆"',Invulnerable:1b,MaidAIChat:{LLMSite:"qa_brain_native",LLMModel:"qa-native",TTSSiteName:"__none__",CustomSetting:"只回复一句话。"}}`);await delay(1200);
  const other=await ask('brain','','other_brain',fixture.otherMaid);check('other maids cannot select shared Harness backends',other.ok&&other.data.sharedModelEnabled===false&&other.data.choices.length===0);
  const count=requests.length;await ask('chat','你好','other_shared',fixture.otherMaid);await delay(2200);check('even a native shared-site selection on another maid makes no provider call',requests.length===count);
  await rc('minecraft:save-all flush');report.selectedAfter='native';
 }
}catch(error){report.error=String(error);console.log(report.error);}
finally{
 bot?.quit();await new Promise(resolve=>mock.close(()=>resolve()));report.passed=!report.error&&report.checks.every(x=>x.ok);report.nativeMockCalls=requests.length;report.nativeToolNames=requests.flatMap(x=>(x.tools??[]).map(t=>t.function?.name)).filter((v,i,a)=>a.indexOf(v)===i);
 await fs.writeFile(root+`/native-harness-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,nativeMockCalls:requests.length}));if(!report.passed)process.exitCode=1;
}
