// Synthetic, loopback-only Youer integration. Requires the explicitly marked QA world.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_QA_STAGE, anchor=process.env.MAID_QA_CLIENT_ANCHOR, rcon=process.env.MAID_QA_RCON;
assert(stage&&anchor&&rcon,'Supply explicit QA paths');
assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25928$/m.test(props));
const {command}=await import(pathToFileURL(rcon));
const rc=q=>command(q,10000,{port:25929,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'), restart=process.argv.includes('--restart');
const report={baseline,restart,checks:[],responses:[],productionChanged:false};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
const until=async(f,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await delay(100)}throw Error('timeout '+label);};
const ints=id=>{const b=Buffer.from(id.replaceAll('-',''),'hex');return [...Array(4)].map((_,i)=>b.readInt32BE(i*4)).join(',');};
const fixture=stage+'/maid-agent-qa-fixture.json';
const maid=restart?JSON.parse(await fs.readFile(fixture,'utf8')).maid:randomUUID(), username='MaidAgentQA1';
if(!restart)await fs.writeFile(fixture,JSON.stringify({maid,synthetic:true}));
report.maid=maid;
let bot,other,original;const replies=[],lines=[],requests=[];let responseMode='success';
const mock=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));await delay(1500);
  if(responseMode==='failure'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"isolated failure"}}');return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa',object:'chat.completion',model:'qa-native',choices:[{index:0,message:{role:'assistant',content:'我收到你的话了，测试完成。'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const siteFile=stage+'/config/touhou_little_maid/sites/llm.json';
let counter=0;
async function ask(action,value='',operation=`qa${Date.now()}_${++counter}`,client=bot){
  await delay(1100);
  const start=replies.length;
  const query=action==='receipt'?`q${Date.now()}_${++counter}`:operation;
  client.chat(action==='list'?`/qdmaid list ${query}`:action==='receipt'?`/qdmaid receipt ${maid} ${operation} ${query}`:`/qdmaid ${action} ${maid} ${query}${value?' '+value:''}`);
  return until(()=>replies.slice(start).find(v=>v.recipientUuid===client.player.uuid&&v.action===action&&v.requestId===query),action);
}
function connect(name){const client=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25928,version:'1.21.1',username:name,auth:'offline',hideErrors:true});
  client.on('messagestr',(text,position)=>{lines.push(text);if(text.startsWith('QD_MAID ')){try{replies.push(JSON.parse(text.slice(8)));}catch{}}});client.on('error',e=>lines.push('client-error:'+e.message));return client;}
try{
 await until(async()=>{try{return (await rc('version')).includes('Youer')}catch{return false}},'ready',120000);
 bot=connect(username);await until(()=>bot.entity,'spawn');await rc(`minecraft:tp ${username} 0.5 90 0.5`);
 if(restart){
   const life=await ask('context');check('death survives a normal restart',life.data?.lifeState==='dead');
   const seen=await ask('receipt','', 'chat-accepted');check('original chat receipt survives restart',seen.data?.status==='replied');
 }else{
 original=await fs.readFile(siteFile);const sites=JSON.parse(original);sites.qa_agent_maids={id:'qa_agent_maids',api_type:'openai',enabled:true,icon:sites.openai.icon,url:`http://127.0.0.1:${mock.address().port}/v1/chat/completions`,secret_key:'isolated-no-real-key',headers:{},models:['qa-native']};await fs.writeFile(siteFile,JSON.stringify(sites));await rc('tlm ai_chat reload');
 await rc('minecraft:fill -4 89 -4 5 89 5 minecraft:stone');
 await rc(`minecraft:summon touhou_little_maid:maid 2.5 90 0.5 {UUID:[I;${ints(maid)}],Owner:[I;${ints(bot.player.uuid)}],CustomName:'"女仆隔离"',PersistenceRequired:1b,MaidAIChat:{LLMSite:"qa_agent_maids",LLMModel:"qa-native",ChatLanguage:"zh_cn",TTSSiteName:"__none__",CustomSetting:"隔离测试，只回复文字，不调用工具。"}}`);
 await until(()=>Object.values(bot.entities).some(e=>e.uuid===maid),'maid');await delay(1000);
 const context=await ask('context');check('context explicitly reports alive',context.data?.lifeState==='alive');
 const inventory=await ask('inventory');check('inventory exposes all six equipment slots',Object.keys(inventory.data?.equipment??{}).length===6);
 const chat=await ask('chat','你好','chat-accepted');check('owner command accepts original model dialogue',chat.data?.status==='pending');
 if(!baseline){
  await until(()=>requests.length>0,'native inference');
  const duplicate=await ask('chat','你好','chat-accepted');check('same chat request is replayed',duplicate.data?.replayed===true);
  const conflict=await ask('chat','另一句话','chat-accepted');check('changed payload cannot reuse request ID',conflict.error==='request_conflict');
  await until(()=>replies.some(v=>v.action==='chat-result'&&v.data?.status==='replied'),'native reply');
  const receipt=await ask('receipt','','chat-accepted');check('receipt contains actual native reply',receipt.data?.status==='replied'&&receipt.data.observation.reply.includes('收到你的话'));
  check('only one native model call',requests.length===1);
  await rc(`minecraft:item replace entity ${username} hotbar.0 with minecraft:iron_helmet`);
  const put=await ask('transfer','put 0 1 0','helmet-put');check('actual helmet transferred once',put.data?.status==='applied');
  const equip=await ask('equip','head 0','helmet-equip');check('armor equipped in original native slot',equip.data?.observation?.equipment?.head?.id==='minecraft:iron_helmet');
  const again=await ask('equip','head 0','helmet-equip');check('equipment replay does not swap back',again.data?.replayed===true);
  const now=await ask('inventory');check('helmet retained and source is empty',now.data?.equipment?.head?.id==='minecraft:iron_helmet'&&!now.data.slots.some(s=>s.slot===0));
  await rc(`minecraft:item replace entity ${username} hotbar.0 with minecraft:stone`);await ask('transfer','put 1 1 0','stone-put');
  const wrong=await ask('equip','chest 1','wrong-armor');check('wrong armor rejected with actionable detail',wrong.error==='wrong_armor'&&wrong.data?.message&&wrong.nextStep);
  const afterWrong=await ask('inventory');check('invalid armor preserves original backpack',afterWrong.data?.slots?.some(s=>s.slot===1&&s.id==='minecraft:stone'));
  const unequip=await ask('equip','head 2','helmet-unequip');check('empty native slot can remove armor',unequip.data?.observation?.equipment?.head?.count===0);
  other=connect('MaidOtherQA');await until(()=>other.entity,'other');await rc('minecraft:tp MaidOtherQA 1.5 90 0.5');
  const foreign=await ask('chat','你好','foreign-chat',other);check('another owner cannot invoke native model',foreign.error==='not_owned');
  const unknownId=await ask('receipt','','missing-original');check('unknown receipt never implies success',unknownId.error==='receipt_missing');
  bot.chat('/qdmaid help');await until(()=>lines.some(s=>s.includes('head|chest|legs|feet')),'help');check('help gives concrete equipment and chat usage',lines.some(s=>s.includes('/qdmaid chat')));
 }
 await rc(`minecraft:kill ${maid}`);await delay(6200);
 const dead=await ask('context');check('death remains queryable after entity disappears',dead.data?.lifeState==='dead'&&dead.data?.death?.tombstoneRegistered===true);
 check('death is proactively delivered with dimension and recovery',lines.some(s=>s.includes('[女仆·死亡]')&&s.includes('minecraft:overworld')));
 if(!baseline){const block=await ask('follow','','dead-follow');check('dead maid operation returns recovery guidance',block.error==='maid_dead'&&block.data?.message?.includes('胶片'));}
 report.responses=replies;report.requestCount=requests.length;
 }
}catch(e){report.failure=String(e);console.log(report.failure);}finally{
 if(report.failure&&!restart)try{await rc(`minecraft:kill ${maid}`)}catch{}
 bot?.quit();other?.quit();if(original){await fs.writeFile(siteFile,original);try{await rc('tlm ai_chat reload')}catch{}}mock.close();
 report.pass=!report.failure&&report.checks.every(c=>c.ok);if(process.env.MAID_QA_REPORT)await fs.writeFile(process.env.MAID_QA_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks, failure:report.failure}));
 if(!baseline&&!report.pass)process.exitCode=1;
}
