import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_QA_STAGE,anchor=process.env.MAID_QA_CLIENT_ANCHOR;
assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25928$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_QA_RCON));const rc=q=>command(q,10000,{port:25929,properties:stage+'/server.properties'});
const report={checks:[],productionChanged:false}, replies=[],lines=[],ids=[];let calls=0,bot,original;
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`)};
const until=async(f,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await delay(200)}throw Error('timeout '+label)};
const ints=id=>{const b=Buffer.from(id.replaceAll('-',''),'hex');return [...Array(4)].map((_,i)=>b.readInt32BE(i*4)).join(',')};
const mock=http.createServer(async(req,res)=>{for await(const c of req){}calls++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"synthetic model failure"}}');});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const siteFile=stage+'/config/touhou_little_maid/sites/llm.json';
function connect(){const b=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25928,username:'MaidFaultQA',auth:'offline',version:'1.21.1',hideErrors:true});b.on('messagestr',(s,p)=>{lines.push(s);if(p==='system'&&s.startsWith('QD_MAID '))try{replies.push(JSON.parse(s.slice(8)))}catch{}});b.on('error',()=>{});return b;}
async function ask(id,action,value='',op=randomUUID()){await delay(1100);const query=action==='receipt'?randomUUID():op,start=replies.length;bot.chat(action==='receipt'?`/qdmaid receipt ${id} ${op} ${query}`:`/qdmaid ${action} ${id} ${query}${value?' '+value:''}`);return until(()=>replies.slice(start).find(r=>r.action===action&&r.requestId===query),action)}
async function summon(x=2.5){const id=randomUUID();ids.push(id);await rc(`minecraft:summon touhou_little_maid:maid ${x} 90 0.5 {UUID:[I;${ints(id)}],Owner:[I;${ints(bot.player.uuid)}],CustomName:'"故障隔离"',NoAI:1b,PersistenceRequired:1b,MaidAIChat:{LLMSite:"qa_failed_maids",LLMModel:"qa",ChatLanguage:"zh_cn",TTSSiteName:"__none__",CustomSetting:"隔离验证，不执行游戏动作。"}}`);await delay(600);return id;}
try{
 bot=connect();await until(()=>bot.entity,'spawn');await rc('minecraft:tp MaidFaultQA 0.5 90 0.5');
 original=await fs.readFile(siteFile);const sites=JSON.parse(original);sites.qa_failed_maids={id:'qa_failed_maids',api_type:'openai',enabled:true,icon:sites.openai.icon,url:`http://127.0.0.1:${mock.address().port}/v1/chat/completions`,secret_key:'no-real-key',headers:{},models:['qa']};await fs.writeFile(siteFile,JSON.stringify(sites));await rc('tlm ai_chat reload');
 const id=await summon();const accepted=await ask(id,'chat','只测试错误处理','failed-chat');check('native failure starts as pending, never success',accepted.data?.status==='pending');await until(()=>calls>0,'model called');
 const busy=await ask(id,'chat','不要并发','busy-chat');check('in-flight dialogue rejects a second request',busy.error==='chat_busy');
 const endpoint=`http://127.0.0.1:${mock.address().port}`;check('reply never exposes model endpoint or key',!JSON.stringify(replies).includes(endpoint)&&!JSON.stringify(replies).includes('no-real-key'));
 // Server keeps the real entity in a distant, subsequently unloaded chunk. Missing is not death.
 await rc('minecraft:forceload add 16000 0');const far=await summon(16000.5);await rc('minecraft:forceload remove 16000 0');
 let farState;for(let n=0;n<12;n++){farState=await ask(far,'context');if(farState.data?.lifeState==='unloaded_or_unavailable')break;await delay(4500)}
 report.farState=farState.data;check('distant state agrees with actual runtime presence without inventing death',!farState.data?.death&&((farState.data?.lifeState==='alive'&&farState.data?.loaded===true)||(farState.data?.lifeState==='unloaded_or_unavailable'&&farState.data?.loaded===false)));
 const off=await summon(3.5);bot.quit();await delay(1000);await rc(`minecraft:kill ${off}`);await delay(1000);bot=connect();await until(()=>bot.entity,'reconnect');await rc('minecraft:tp MaidFaultQA 0.5 90 0.5');
 await until(()=>lines.some(s=>s.includes('[女仆·死亡]')&&s.includes(off)),'offline death catch-up',15000);check('offline owner receives death notification on return',true);
 await until(()=>replies.some(r=>r.action==='chat-result'&&r.requestId==='failed-chat'),'failure becomes queryable',130000);
 const result=await ask(id,'receipt','','failed-chat');check('failed native inference cannot become replied',result.data?.status==='unknown'&&result.data?.observation?.reason==='native_reply_not_observed');
 const replay=await ask(id,'chat','只测试错误处理','failed-chat');check('unknown original request is not executed again',replay.data?.replayed===true&&replay.data?.status==='unknown'&&calls===1);
 report.modelRequests=calls;
}catch(e){report.failure=String(e);console.log(report.failure)}finally{
 for(const id of ids)try{await rc(`minecraft:kill ${id}`)}catch{};
 try{await rc('minecraft:forceload remove 16000 0')}catch{};bot?.quit();if(original){await fs.writeFile(siteFile,original);try{await rc('tlm ai_chat reload')}catch{}}mock.close();
 report.pass=!report.failure&&report.checks.every(c=>c.ok);await fs.writeFile(process.env.MAID_QA_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
}
