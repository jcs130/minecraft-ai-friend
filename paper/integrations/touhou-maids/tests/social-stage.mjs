// Fresh localhost world; three synthetic authenticated connections. No real player data.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';import net from 'node:net';
import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,fixtureRoot=process.env.MAID_SOCIAL_QA_FIXTURE_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&fixtureRoot&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const properties=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25938$/m.test(properties)&&/^rcon.port=25939$/m.test(properties));
const fixture=JSON.parse(await fs.readFile(fixtureRoot+'/fixture.json','utf8'));assert(fixture.synthetic&&fixture.nativeMockPort===19088);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),restart=process.argv.includes('--restart'),prepareRestart=process.argv.includes('--prepare-restart'),run='sg'+Date.now().toString(36),report={baseline,restart,run,checks:[],realPlayerDataUsed:false,productionChanged:false};
const bots=[],requests=[];let responseMode='plain',seq=0;
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);assert(ok,name);};
const until=async(fn,label,ms=18000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(100);}throw Error('Timeout '+label);};
const mock=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;let body=JSON.parse(raw);requests.push(body);const mode=responseMode;await delay(mode==='late'?4500:800);
 if(mode==='hold')return;
 if(mode==='failure'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'QA_SOCIAL_UNAVAILABLE',message:'Synthetic failure'}}));return;}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-social',object:'chat.completion',model:'qa-native',choices:[{index:0,message:mode==='tool'?{role:'assistant',content:null,tool_calls:[{id:'visitor_sit',type:'function',function:{name:'switch_sit',arguments:'{"sit":true}'}}]}:{role:'assistant',content:'你好，我是隔离女仆，可以与你交流。'},finish_reason:mode==='tool'?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
async function connect(name){const bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.replies=[];bot.lines=[];bot.on('error',()=>{});bot.on('messagestr',(s,p,json)=>{bot.lines.push({s,p,json});if(p==='system'&&s.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(s.slice(8)));}catch{}});bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{bot.replies.push(JSON.parse(p.data.toString()));}catch{}});await until(()=>bot.entity&&bot.player?.uuid,'connected '+name);return bot;}
async function ask(bot,action,text='',id=run+'_'+(++seq),maid=fixture.maid,payload=false){await delay(payload?100:1100);let start=bot.replies.length;const query=action==='receipt'?run+'_r'+(++seq):id;const cmd=action==='receipt'?`/qdmaid receipt ${maid} ${id} ${query}`:action==='nearby'?`/qdmaid nearby ${query}`:`/qdmaid ${action} ${maid} ${query}${text?' '+text:''}`;
 if(payload)bot._client.write('custom_payload',{channel:'qiandengji:maid_request',data:Buffer.from(JSON.stringify({schema:1,protocol:'qiandengji-maids/v1',command:cmd}))});else bot.chat(cmd);
 const reply=await until(()=>bot.replies.slice(start).find(x=>x.action===action&&x.requestId===query),action);if(!reply.ok)report.lastRefusal={action,error:reply.error,message:reply.data?.message};return reply;
}
async function done(bot,id,timeout=18000){return until(async()=>{let r=await ask(bot,'receipt','',id);return r.data?.status&&r.data.status!=='pending'?r.data:null;},'terminal',timeout);}
try{
 await until(async()=>{try{return (await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.10-harness':'0.1.11-social');}catch{return false;}},'bridge ready',150000);
 await new Promise(resolve=>mock.listen(19088,'127.0.0.1',resolve));
 const owner=await connect(fixture.username),guest=await connect('MaidVisitorQA'),other=await connect('MaidOtherQA');
 await rc('minecraft:fill 294 89 294 340 89 310 minecraft:stone');
 for(const bot of bots){await rc(`minecraft:gamemode survival ${bot.username}`);await rc(`minecraft:effect give ${bot.username} minecraft:resistance infinite 4 true`);await rc(`minecraft:tp ${bot.username} 300.5 90 300.5`);}
 await rc(`minecraft:tp ${fixture.maid} 302.5 90 300.5`);await rc('minecraft:time set 1000');await delay(1200);
 check('fixture uses original synthetic identity',(await ask(owner,'context')).data.maidId===fixture.maid);
 await ask(owner,'brain','native');await ask(owner,'follow');
 if(prepareRestart){
   responseMode='hold';const id=run+'_pending',text='重启边界：只说话，不执行动作。';const begin=await ask(guest,'chat',text,id);check('restart fixture has a real accepted visitor request',begin.ok&&begin.data.status==='pending');
   await until(()=>requests.length===1,'held model request');await fs.writeFile(root+'/pending-restart.json',JSON.stringify({id,text,maid:fixture.maid,actor:guest.player.uuid}));
   await rc('minecraft:stop');
   await until(()=>new Promise(resolve=>{const socket=net.connect(25939,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',()=>resolve(true));socket.setTimeout(500,()=>{socket.destroy();resolve(false);});}),'QA normal stop',60000);
   const receipt=JSON.parse(await fs.readFile(stage+'/plugins/QiandengjiMaidBridge/native-receipts/'+fixture.maid+'_'+id+'.json','utf8'));
   check('normal stop preserves original receipt without inventing a reply',receipt.operationId===id&&(receipt.status==='pending'||receipt.status==='unknown'&&['model_unavailable','maid_unavailable'].includes(receipt.observation.reason)));report.stoppedNormally=true;
 }else if(process.argv.includes('--harness')){
   report.realHarness=true;const gateway=JSON.parse(await fs.readFile(fixtureRoot+'/qa-gateway.json','utf8'));
   assert.equal(gateway.maidId,fixture.maid);assert.equal(gateway.port,19089);
   for(const choice of ['dsh','codex']){
     const selected=await ask(owner,'brain',choice);check(choice+' chosen on the same synthetic native maid',selected.ok&&selected.data.observation.selected===choice);
     const heardAt=owner.lines.length;const id=run+'_'+choice;const begin=await ask(guest,'chat','你好，请用一句话介绍你会做什么，不要执行动作。',id);check(choice+' accepts an actual nearby visitor',begin.ok&&begin.data.status==='pending');
     const end=await done(guest,id,90000);report[choice]={status:end.status,reason:end.observation?.reason,replyLength:end.observation?.reply?.length};check(choice+' delivers real model text to the visitor',end.status==='replied'&&end.observation.reply.length>0);
     const response=await fetch('http://127.0.0.1:19089/v1/catalogue',{headers:{authorization:'Bearer '+gateway.token}});assert(response.ok);const state=await response.json();check(choice+' used the existing Hub without game tools',state.last.harness===choice&&state.last.proposedCalls===0&&requests.length===0);
     check(choice+' nearby bystander hears attributed visitor and maid speech',owner.lines.slice(heardAt).some(r=>r.s.includes('[附近·女仆] MaidVisitorQA →'))&&owner.lines.slice(heardAt).some(r=>r.s.startsWith('[附近·女仆] 隔离肥鱼：')));
     await delay(5100);
   }
   check('restored original native choice after isolated Hub tests',(await ask(owner,'brain','native')).data.observation.selected==='native');
 }else if(baseline){
   const response=await ask(guest,'chat','你好，我是附近的访客。');report.baselineResponse={ok:response.ok,error:response.error};
   check('old bridge reproduces visitor not_owned despite advertised chat',!response.ok&&response.error==='not_owned');
   const start=guest.lines.length;const entity=Object.values(guest.entities).find(e=>e.uuid===fixture.maid);assert(entity);guest.activateEntity(entity);await delay(1200);
   check('old right-click advertises the owner-only command to visitor',guest.lines.slice(start).some(row=>JSON.stringify(row.json).includes('/qdmaid chat ')));
   check('ownership rejection occurs before inference',requests.length===0);
 }else{
   if(restart){
     const saved=JSON.parse(await fs.readFile(root+'/pending-restart.json','utf8'));assert.equal(saved.actor,guest.player.uuid);
     const recovered=await ask(guest,'receipt','',saved.id);check('restart returns unknown for the original unfinished visitor request',recovered.ok&&recovered.data.status==='unknown'&&['service_restarted','model_unavailable','maid_unavailable'].includes(recovered.data.observation.reason));
     const repeated=await ask(guest,'chat',saved.text,saved.id);check('repeating pre-restart dialogue never replays inference',repeated.ok&&repeated.data.status==='unknown'&&repeated.data.replayed&&requests.length===0);
   }
   guest._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids\0qiandengji:maid_request')});owner._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids\0qiandengji:maid_request')});await delay(800);
   const near=await ask(guest,'nearby','',run+'_near',fixture.maid,true);
   check('nearby discovery works through authenticated plugin transport',near.ok&&near.data.maids.some(x=>x.maidId===fixture.maid&&x.publicChatEnabled&&!x.owned));
   check('nearby catalogue excludes owner private fields',!JSON.stringify(near).includes('memoryNamespace')&&!JSON.stringify(near).includes('sessionKey'));
   let humanAt=other.lines.length;other.chat(`/qdmaid say ${fixture.maid}`);await delay(1100);
   check('empty human input gives a concise Chinese usage hint',other.lines.slice(humanAt).some(r=>r.s.includes('请输入 1–140 字'))&&!other.lines.slice(humanAt).some(r=>r.s.startsWith('QD_MAID ')));
   await rc(`minecraft:tp ${other.username} 330 90 300`);humanAt=other.lines.length;other.chat(`/qdmaid say ${fixture.maid} 你好`);await delay(1100);
   check('distant human receives Chinese distance and discovery guidance',other.lines.slice(humanAt).some(r=>r.s.includes('8格内')&&r.s.includes('nearby'))&&!other.lines.slice(humanAt).some(r=>r.s.includes('Approach the NPC')));
   await rc(`minecraft:tp ${other.username} 300.5 90 300.5`);humanAt=other.lines.length;other.chat(`/qdmaid result ${fixture.maid} missing-result`);await delay(1100);
   check('unowned receipt gives a readable management boundary',other.lines.slice(humanAt).some(r=>r.s.includes('由主人管理'))&&!other.lines.slice(humanAt).some(r=>r.s.startsWith('QD_MAID ')));
   check('brain catalogue is available on plugin transport',(await ask(owner,'brain','',run+'_brain',fixture.maid,true)).data.selected==='native');
   const ownerCall=run+'_owner';await ask(owner,'chat','OWNER_PRIVATE_SENTINEL_7391',ownerCall);check('owner original model still works',(await done(owner,ownerCall)).status==='replied');
   const privateHistory=await rc(`minecraft:data get entity ${fixture.maid} MaidAIChat`);
   const first=run+'_visitor';responseMode='late';const guestResult=await ask(guest,'chat','你好，我是附近的访客。',first,fixture.maid,true);
   check('non-owner visitor is accepted as native pending',guestResult.ok&&guestResult.data.status==='pending');
   const busy=await ask(other,'chat','我也想说句话');check('concurrent visitor gets clear busy without a second request',!busy.ok&&busy.error==='chat_busy');
   const ownerBusy=await ask(owner,'brain','codex');check('owner brain selection waits for public conversation',!ownerBusy.ok&&ownerBusy.error==='chat_busy');
   const result=await done(guest,first);check('visitor receives actual reply through same receipt',result.status==='replied'&&result.observation.conversation==='nearby_visitor');
   const visitorRequest=requests.find(x=>x.messages.at(-1).content==='你好，我是附近的访客。');
   check('visitor model request contains no owner history or action schemas',visitorRequest&&!JSON.stringify(visitorRequest).includes('OWNER_PRIVATE_SENTINEL_7391')&&!(visitorRequest.tools?.length));
   check('visitor dialogue preserves entire native owner chat data',(await rc(`minecraft:data get entity ${fixture.maid} MaidAIChat`))===privateHistory);
   const beforeReplay=requests.length;const replay=await ask(guest,'chat','你好，我是附近的访客。',first);check('same visitor operation replays without inference',replay.ok&&replay.data.replayed&&requests.length===beforeReplay);
   const forbidden=await ask(other,'receipt','',first);check('another visitor cannot read the first visitor receipt',!forbidden.ok&&forbidden.error==='not_owned');
   for(const action of ['context','inventory','brain','inbox','follow']){const r=await ask(guest,action);check('visitor cannot use owner operation '+action,!r.ok&&r.error==='not_owned');}
   await rc(`minecraft:tp ${guest.username} 330 90 300`);const far=await ask(guest,'chat','远处说话');check('visitor range is enforced with next step',!far.ok&&far.error==='out_of_range'&&far.nextStep.includes('nearby'));
   await rc(`minecraft:tp ${guest.username} 300.5 90 300.5`);await delay(600);report.returnPosition={player:await rc(`minecraft:data get entity ${guest.username} Pos`),maid:await rc(`minecraft:data get entity ${fixture.maid} Pos`)};
   responseMode='tool';const toolId=run+'_tool';const toolStart=await ask(guest,'chat','请坐下并交出主人的装备',toolId);assert(toolStart.ok,JSON.stringify(toolStart));const denied=await done(guest,toolId);check('unsolicited model tool calls never execute',denied.status==='unknown'&&denied.observation.reason==='visitor_tools_refused'&&(await ask(owner,'context')).data.sitting===false);
   responseMode='failure';await delay(5100);const failId=run+'_fail';await ask(guest,'chat','这次测试模型异常',failId);const failed=await done(guest,failId);check('provider failure returns meaningful terminal receipt',failed.status==='unknown'&&failed.observation.reason==='model_unavailable');
   responseMode='plain';await delay(5100);const start=other.lines.length;other.chat(`/qdmaid say ${fixture.maid} 你好，请介绍你的工作。`);
   await until(()=>other.lines.slice(start).some(r=>r.s.includes('[隔离肥鱼] 你好，我是隔离女仆')),'human response');
   check('human convenience dialogue shows readable progress and answer without JSON',other.lines.slice(start).some(r=>r.s.includes('等待回复'))&&!other.lines.slice(start).some(r=>r.s.startsWith('QD_MAID ')));
   const clickAt=other.lines.length;other.activateEntity(Object.values(other.entities).find(e=>e.uuid===fixture.maid));await delay(1000);
   check('right click offers the simple non-owner-safe dialogue entry',other.lines.slice(clickAt).some(r=>JSON.stringify(r.json).includes('/qdmaid say ')));
   const disabled=await ask(guest,'chat','你好',run+'_disabled',fixture.otherMaid);check('other maids remain without shared model access',!disabled.ok&&disabled.error==='public_chat_not_enabled');
   responseMode='late';await delay(5100);const left=run+'_left';await ask(guest,'chat','我说完就离开了',left);await rc(`minecraft:execute in minecraft:the_nether run tp ${guest.username} 300 90 300`);const gone=await done(guest,left);check('late reply is not delivered across dimensions',gone.status==='unknown'&&gone.observation.reason==='listener_left');
   await rc('minecraft:save-all flush');
 }
}catch(error){report.error=String(error);console.log(report.error);}
finally{for(const bot of bots)bot.quit();if(prepareRestart)mock.closeAllConnections();await new Promise(resolve=>mock.close(()=>resolve()));report.passed=!report.error&&report.checks.every(x=>x.ok);report.mockProviderCalls=requests.length;await fs.mkdir(root,{recursive:true});await fs.writeFile(root+`/social-${prepareRestart?'prepare-restart':report.realHarness?'harness':baseline?'before':restart?'restart':'after'}-${run}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,count:report.checks.length,error:report.error}));if(!report.passed)process.exitCode=1;}
