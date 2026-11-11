// Marked loopback world, synthetic bodies and both real Eye routes. No production identities.
import fs from 'node:fs/promises';import http from 'node:http';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&anchor&&process.env.MAID_SOCIAL_QA_RCON);assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(process.env.MAID_SOCIAL_QA_FIXTURE_ROOT+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),run='do'+Date.now().toString(36),bots=[],requests=[],report={run,baseline,checks:[],productionChanged:false,realPlayerDataUsed:false};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,label,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){const r=await fn();if(r)return r;await delay(100);}throw Error('Timeout '+label);};
let mode='ok';const text='可米，这次只有一句回声。';
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;requests.push(JSON.parse(raw));if(mode==='fail'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"Synthetic unavailable"}}');return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-once',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
async function connect(name){const bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.lines=[];bot.replies=[];bot.cameras=[];bot.on('error',()=>{});bot.on('messagestr',s=>{bot.lines.push(s);if(s.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(s.slice(8)));}catch{}});bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{bot.replies.push(JSON.parse(p.data.toString()));}catch{}});bot._client.on('camera',p=>bot.cameras.push(p.cameraId));await until(()=>bot.entity&&bot.player?.uuid,name);return bot;}
function subscribe(bot,enabled=true){bot._client.write('custom_payload',{channel:enabled?'minecraft:register':'minecraft:unregister',data:Buffer.from('qiandengji:maids\0qiandengji:maid_request')});}
function offsets(){return bots.map(b=>b.lines.length);}
function counts(at){return Object.fromEntries(bots.map((b,i)=>[b.username,b.lines.slice(at[i]).filter(s=>s.includes(text)&&!s.startsWith('QD_MAID ')).length]));}
async function publicTurn(actor){const at=offsets(),start=actor.replies.length;actor.chat('隔离肥鱼，测试一次消息显示。');await until(()=>actor.replies.slice(start).some(r=>r.action==='chat-result'&&r.data?.status==='replied'),'public receipt');await delay(1500);return {at,count:counts(at),receipt:actor.replies.slice(start).find(r=>r.action==='chat-result'&&r.data?.status==='replied')};}
try{
 await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));
 check('expected candidate is loaded',(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.21-short-dialogue':process.env.MAID_SOCIAL_QA_VERSION||'0.1.22-dialogue-once'));
 const owner=await connect(fixture.username),guest=await connect('MaidVisitorQA'),eye=await connect('MaidEyeQA'),extra=await connect('MaidGuestEyeQA');subscribe(owner);subscribe(guest);
 await rc('minecraft:fill 294 89 294 310 89 310 minecraft:stone');await rc('minecraft:time set 1000');
 for(const b of [owner,guest]){await rc('minecraft:gamemode survival '+b.username);await rc('execute in minecraft:overworld run minecraft:tp '+b.username+' 300.5 90 300.5');await rc('minecraft:effect give '+b.username+' minecraft:resistance infinite 4 true');}
 for(const b of [eye,extra])await rc('execute in minecraft:overworld run minecraft:tp '+b.username+' 300.5 90 300.5');
 await rc('execute in minecraft:overworld run minecraft:tp '+fixture.maid+' 302.5 90 300.5');await rc('speechqa quiet '+fixture.maid);owner.chat(`/qdmaid follow ${fixture.maid} ${run}_follow`);await delay(1600);
 for(const b of [owner,guest,eye,extra])assert((await rc('minecraft:data get entity '+b.username+' Dimension')).includes('minecraft:overworld'),'test connection must be in overworld: '+b.username);
 await until(()=>eye.cameras.includes(owner.entity.id)&&extra.cameras.includes(guest.entity.id),'both actual Eye routes attached');
 check('real primary and additional Eye are attached',eye.cameras.includes(owner.entity.id)&&extra.cameras.includes(guest.entity.id));
 const first=await publicTurn(owner);report.ownerPublic=first.count;
 check('public actor sees one line',first.count[owner.username]===1);check('ordinary nearby guest sees one line',first.count[guest.username]===1);
 check(baseline?'BASELINE primary Eye receives two differently formatted copies':'primary Eye sees one canonical public line',first.count[eye.username]===(baseline?2:1));
 check('additional Eye sees bystander copy only once',first.count[extra.username]===1);
 check('owner still receives the original structured terminal result',first.receipt.recipientUuid===owner.player.uuid&&first.receipt.data.operationId===first.receipt.requestId);
 await delay(5200);const second=await publicTurn(guest);report.guestPublic=second.count;
 check('identical text in a new request is still displayed',second.count[guest.username]===1&&second.count[owner.username]===1);
 check(baseline?'BASELINE additional Eye receives two differently formatted copies':'additional Eye sees one canonical public line',second.count[extra.username]===(baseline?2:1));
 check('primary Eye sees bystander copy only once',second.count[eye.username]===1);
 const before=requests.length;const nativeAt=offsets(),nativeReplyAt=owner.replies.length;owner.chat(`/qdmaid say ${fixture.maid} 私下说一句测试回复。`);
 const native=await until(()=>owner.replies.slice(nativeReplyAt).find(r=>r.action==='chat-result'&&r.data?.status==='replied'),'native owner reply');await delay(1500);report.nativeOwner=counts(nativeAt);
 check(baseline?'BASELINE native owner gets original TLM plus bridge echo':'native owner sees only original TLM text',report.nativeOwner[owner.username]===(baseline?2:1));
 check('native owner still receives one structured result',native.recipientUuid===owner.player.uuid&&requests.length===before+1);
 check('native owner text remains private',report.nativeOwner[guest.username]===0&&report.nativeOwner[extra.username]===0);
 check(baseline?'BASELINE primary Eye mirrors both native copies':'primary Eye mirrors native text once',report.nativeOwner[eye.username]===(baseline?2:1));
 const queryAt=offsets();owner.chat(`/qdmaid result ${fixture.maid} ${native.requestId}`);await delay(1300);check('explicit result query still displays the original answer',counts(queryAt)[owner.username]===1&&requests.length===before+1);
 if(!baseline){
  await delay(5200);mode='fail';const start=guest.replies.length;guest.chat('隔离肥鱼，这次是模拟故障。');const failed=await until(()=>guest.replies.slice(start).find(r=>r.action==='chat-result'&&r.data?.status==='unknown'),'failure result');check('real failure stays meaningful and visible',failed.data.observation.reason==='model_unavailable'&&guest.lines.some(s=>s.includes('未收到有效回复')));mode='ok';
  await delay(5200);subscribe(guest,false);await delay(400);const plainAt=offsets();guest.chat('隔离肥鱼，普通客户端再问一次。');await until(()=>counts(plainAt)[guest.username]>0,'vanilla reply');await delay(1200);check('vanilla-only actor gets one readable answer without JSON',counts(plainAt)[guest.username]===1&&!guest.lines.slice(plainAt[1]).some(s=>s.startsWith('QD_MAID ')));
 }
 await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);console.log(report.error);report.counts=bots.map(b=>({name:b.username,cameras:b.cameras,lines:b.lines.slice(-8)}));}
finally{for(const b of bots)b.quit();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));report.passed=!report.error;report.modelCalls=requests.length;await fs.mkdir(root,{recursive:true});await fs.writeFile(root+'/dialogue-once-'+(baseline?'baseline':'candidate')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,count:report.checks.length,error:report.error}));if(report.error)process.exitCode=1;}
