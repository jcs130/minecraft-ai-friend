// Real nearby chat and original structured receipts in the marked synthetic world.
import fs from 'node:fs/promises';import http from 'node:http';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(process.env.MAID_SOCIAL_QA_FIXTURE_ROOT+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),run='ff'+Date.now().toString(36),bots=[],requests=[],report={run,baseline,checks:[],productionChanged:false,realPlayerDataUsed:false};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const r=await fn();if(r)return r;await delay(50);}throw Error('Timeout '+label);};
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;requests.push(JSON.parse(raw));await delay(800);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-fast',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:'一起看看前面的路吧。'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
async function connect(name){const bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.replies=[];bot.lines=[];bot.on('error',()=>{});bot.on('messagestr',s=>{bot.lines.push(s);if(s.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(s.slice(8)));}catch{}});bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{bot.replies.push(JSON.parse(p.data.toString()));}catch{}});await until(()=>bot.entity&&bot.player?.uuid,name);bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids')});return bot;}
async function reconnect(owner){owner.quit();await until(async()=>!(await rc('list')).includes(fixture.username),'original connection closed');const next=await connect(fixture.username);await rc('minecraft:tp '+next.username+' 300.5 90 300.5');await delay(600);return next;}
try{
 await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));
 check('exact test bridge loaded',(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.22-dialogue-once':'0.1.24-fast-followup'));
 let owner=await connect(fixture.username);
 await rc('minecraft:fill 294 89 294 310 89 310 minecraft:stone');await rc('minecraft:time set 1000');await rc('minecraft:weather clear');
 await rc('minecraft:gamemode survival '+owner.username);await rc('execute in minecraft:overworld run minecraft:tp '+owner.username+' 300.5 90 300.5');await rc('minecraft:effect give '+owner.username+' minecraft:resistance infinite 4 true');
 await rc('execute in minecraft:overworld run minecraft:tp '+fixture.maid+' 302.5 90 300.5');await rc('speechqa quiet '+fixture.maid);owner.chat(`/qdmaid follow ${fixture.maid} ${run}_follow`);
 const initiative=await until(()=>owner.replies.find(r=>r.action==='chat-result'&&r.data?.observation?.initiatedBy==='maid'&&r.data.status==='replied'),'natural settled companion initiative',80000);
 check('actual proactive reply delivered once',owner.replies.filter(r=>r.requestId===initiative.requestId&&r.action==='chat-result').length===1);
 const start=owner.replies.length,called=requests.length,at=Date.now();owner.chat('好呀，咱们一起看看。');
 const turn=await until(()=>owner.replies.slice(start).find(r=>r.error||r.action==='chat-result'),'immediate natural answer');
 report.fastAnswer={millisecondsAfterModelReply:Date.now()-at,error:turn.error??null,status:turn.data?.status??null,originalProactiveRequest:initiative.requestId};
 check(baseline?'BASELINE rejects an immediate answer to its own invitation':'immediate answer to invitation reaches the selected model',baseline?turn.error==='chat_cooldown'&&requests.length===called:turn.data?.status==='replied'&&requests.length===called+1);
 if(!baseline){
  check('reply text stays short and single',owner.lines.filter(s=>s==='[附近·女仆] 隔离肥鱼：一起看看前面的路吧。').length===2);
  for(let n=2;n<=6;n++){
   const offset=owner.replies.length,calls=requests.length;owner.chat('好呀，我们接着聊第'+n+'句。');
   const next=await until(()=>owner.replies.slice(offset).find(r=>r.error||r.action==='chat-result'),'rapid follow-up '+n);
   check('completed natural turn '+n+' can continue without five-second spacing',next.data?.status==='replied'&&requests.length===calls+1);
  }
  const before=owner.replies.length,count=requests.length;owner.chat('隔离肥鱼，再说一次。');const refused=await until(()=>owner.replies.slice(before).find(r=>r.error),'real player spam throttle');
  check('seventh rapid request is clearly refused without inference',refused.error==='chat_cooldown'&&requests.length===count&&owner.lines.some(s=>s.includes('近30秒')&&s.includes('这句未送入模型')));
 }else{
  await delay(5200);let offset=owner.replies.length;owner.chat('隔离肥鱼，你好。');await until(()=>owner.replies.slice(offset).find(r=>r.action==='chat-result'),'baseline regular answer');
  offset=owner.replies.length;const count=requests.length;owner.chat('好呀，我们接着聊。');const refused=await until(()=>owner.replies.slice(offset).find(r=>r.error),'baseline fast player follow-up');
  check('BASELINE also rejects the next turn after a completed regular answer',refused.error==='chat_cooldown'&&requests.length===count);
 }
 await delay(baseline?5200:31000);owner=await reconnect(owner);const count=requests.length;
 owner.chat('好呀，继续走吧。');await delay(700);check('new connection does not inherit an old follow-up window',requests.length===count);
 owner.chat('拜托啦隔离肥鱼～路上跟紧我。');await delay(1600);
 check(baseline?'BASELINE misses a natural partner vocative without an old window':'natural bound-partner vocative starts a new turn',requests.length===count+(baseline?0:1));
 if(!baseline)check('vocative context reaches original public model without tools',requests.at(-1).messages.at(-1).content==='拜托啦隔离肥鱼～路上跟紧我。'&&!requests.at(-1).tools?.length);
 await delay(5200);owner=await reconnect(owner);const before=requests.length;
 for(const line of ['我和隔离肥鱼聊天','她说谢谢隔离肥鱼！','!隔离肥鱼，你好']){owner.chat(line);await delay(400);}
 check('third-person mentions and global shouts do not wake the model',requests.length===before);
 const guest=await connect('MaidVisitorQA');await rc('execute in minecraft:overworld run minecraft:tp '+guest.username+' 300.5 90 300.5');guest.chat('拜托啦隔离肥鱼～跟我走。');await delay(800);
 check('visitor cannot use the partner-only relaxed addressing',requests.length===before);
 owner.chat('隔离肥鱼，你好。');const replied=await until(()=>owner.replies.find(r=>r.action==='chat-result'&&r.data?.status==='replied'),'explicit valid address after reconnect');
 check('ordinary explicit address remains usable',requests.length===before+1&&replied.data.maidId===fixture.maid);
 const done=requests.length;await delay(5500);check('no automatic retry or reciprocal model loop',requests.length===done);
 await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);console.log(report.error);report.last=bots.map(b=>({name:b.username,lines:b.lines.slice(-5)}));}
finally{for(const b of bots)b.quit();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));report.passed=!report.error;report.modelCalls=requests.length;await fs.mkdir(root,{recursive:true});await fs.writeFile(root+'/fast-followup-'+(baseline?'baseline':'candidate')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,count:report.checks.length,error:report.error}));if(report.error)process.exitCode=1;}
