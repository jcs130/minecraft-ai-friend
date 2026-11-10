// Real synthetic chat, block breaking and encrypted SVC; no production identities or mutations.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(process.env.MAID_SOCIAL_QA_FIXTURE_ROOT+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),run='sq_'+Date.now().toString(36),report={run,baseline,checks:[],productionChanged:false,realPlayerDataUsed:false,humanHearingVerified:false};
const checks=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,name,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){let r=await fn();if(r)return r;await delay(100);}throw Error('Timeout '+name);};
const modelRequests=[],mediaRequests=[],bots=[];let peer,hold=false,releases=[];
const fullReply='可米，这块石头的纹路真有意思，我们可以沿着刚才挖开的方向继续找找看。'+ '记得检查装备并且休息一下，看看天气也看看周围，不着急，我会一直在这里陪着你。'.repeat(3);
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;modelRequests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-short',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:fullReply},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+2*i);
const media=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;mediaRequests.push(JSON.parse(raw));if(hold)await new Promise(resolve=>releases.push(resolve));res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);});
function release(){hold=false;for(const f of releases.splice(0))f();}
async function connect(name){let bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.lines=[];bot.replies=[];bot.on('error',()=>{});bot.on('messagestr',(s,p)=>{bot.lines.push(s);if(p==='system'&&s.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(s.slice(8)));}catch{}});bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{bot.replies.push(JSON.parse(p.data.toString()));}catch{}});await until(()=>bot.entity&&bot.player?.uuid,name);return bot;}
async function ask(bot,action,value='',id=run+'_'+action){let offset=bot.replies.length;bot.chat(`/qdmaid ${action} ${fixture.maid} ${id}${value?' '+value:''}`);return until(()=>bot.replies.slice(offset).find(r=>r.action===action&&r.requestId===id),action);}
const speechId=id=>'r_'+uuidFromBytes(id);
function uuidFromBytes(s){let b=createHash('md5').update(s).digest();b[6]=(b[6]&15)|48;b[8]=(b[8]&63)|128;let h=b.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
async function receipt(id){try{return JSON.parse(await fs.readFile(stage+'/plugins/QiandengjiMaidBridge/speech-receipts/'+fixture.maid+'_'+speechId(id)+'.json','utf8'));}catch{return null;}}
async function say(id,owner){checks('QA stimulus '+id,(await rc(`shortdialogueqa ${fixture.maid} ${owner.player.uuid} ${id}`)).includes('QA_ORIGINAL_SPEECH_REQUEST'));}
try{
 await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));await new Promise(resolve=>media.listen(19091,'127.0.0.1',resolve));
 checks('expected isolated bridge is loaded',(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.20-companion-dialogue':'0.1.21-short-dialogue'));
 let owner=await connect(fixture.username);const visitor=await connect('MaidVisitorQA');
 await rc('minecraft:fill 294 89 294 310 89 310 minecraft:stone');await rc('minecraft:time set 1000');await rc('minecraft:gamerule doDaylightCycle false');await rc('minecraft:weather clear');
 for(const bot of bots){await rc(`minecraft:gamemode survival ${bot.username}`);await rc(`minecraft:effect give ${bot.username} minecraft:resistance infinite 4 true`);await rc(`minecraft:tp ${bot.username} 300.5 90 300.5`);}
 await rc(`minecraft:tp ${fixture.maid} 302.5 90 300.5`);await rc('speechqa quiet '+fixture.maid);await ask(owner,'brain','native');await delay(1100);await ask(owner,'follow');await delay(1200);
 const original=run+'_long';checks('actual visitor chat accepted',(await ask(visitor,'chat','隔离肥鱼，聊聊刚才的探索吧。',original)).ok);
 const reply=await until(()=>visitor.replies.find(r=>r.action==='chat-result'&&r.requestId===original),'model reply');
 checks('original model operation delivers text',reply.data.status==='replied');const text=reply.data.observation.reply;
 checks(baseline?'BASELINE reproduces unbounded public reply':'long actual model reply is reduced to at most forty characters',baseline?[...text].length>100:[...text].length<=40&&reply.data.observation.replyShortened);
 checks('no owner tools or private history in public inference',!modelRequests[0].tools?.length&&!JSON.stringify(modelRequests[0]).includes('OWNER_PRIVATE_SENTINEL'));
 if(!baseline)checks('prompt asks for one relevant short sentence',JSON.stringify(modelRequests[0].messages).includes('一次只说一句')&&JSON.stringify(modelRequests[0].messages).includes('不要把对方的猜测'));
 const {receiver}=await import('./svc-receiver.mjs');peer=await receiver(owner);hold=true;
 const a=run+'_a',b=run+'_b',c=run+'_c';await say(a,owner);await until(()=>mediaRequests.length===1,'held media');await say(b,owner);await say(c,owner);
 const rb=await receipt(b),rcpt=await receipt(c);
 if(baseline){checks('BASELINE drops new real reply while previous speech is preparing',rb?.status==='skipped'&&rcpt?.status==='skipped'&&rcpt.observation.reason==='companion_already_speaking');release();}
 else{
  checks('newest reply waits under its original request ID',rcpt?.status==='queued'&&rcpt.operationId===speechId(c));
  checks('only one waiting reply retained',rb?.status==='skipped'&&rb.observation.reason==='newer_reply_waiting');
  checks('waiting does not start another TTS call',mediaRequests.length===1);
  release();await until(async()=> (await receipt(c))?.status==='sent','queued reply delivered');
  checks('first and fresh reply both finish once',(await receipt(a)).status==='sent'&&mediaRequests.length===2&&new Set(mediaRequests.map(x=>x.requestId)).size===2);
  checks('real encrypted SVC packets reach the listener',peer.state.positional>10&&peer.state.errors===0);
  await delay(5100);const spoken=run+'_spoken';await ask(visitor,'chat','隔离肥鱼，简短说一句吧。',spoken);
  const spokenReply=await until(()=>visitor.replies.find(r=>r.action==='chat-result'&&r.requestId===spoken),'short public spoken reply');
  await until(async()=> (await receipt(spoken))?.status==='sent','short model reply reaches voice listener');
  checks('public receipt, text and synthesis use the same short sentence',mediaRequests.at(-1).text===spokenReply.data.observation.reply&&[...mediaRequests.at(-1).text].length<=40&&owner.lines.some(s=>s.includes(spokenReply.data.observation.reply)));
  checks('generated reply keeps the explicitly configured voice',mediaRequests.at(-1).voice==='qa-companion');
  const count=mediaRequests.length;await say(c,owner);await delay(800);checks('repeating a known original ID never synthesizes again',mediaRequests.length===count);
  hold=true;const d=run+'_d',e=run+'_e';await say(d,owner);await until(()=>mediaRequests.length===count+1,'second held media');await say(e,owner);await delay(10500);
  checks('stale waiting reply expires without synthesis',(await receipt(e))?.observation.reason==='reply_wait_expired'&&mediaRequests.length===count+1);release();await until(async()=> (await receipt(d))?.status==='sent','held active completed');
  hold=true;const f=run+'_f',g=run+'_g';await say(f,owner);await until(()=>mediaRequests.length===count+2,'third held media');await say(g,owner);peer.close();owner.quit();await until(async()=>!(await rc('list')).includes(owner.username),'original listener disconnected');release();await delay(2000);
  checks('queued reply rechecks audience before starting',(await receipt(g))?.status==='cancelled'&&mediaRequests.length===count+2);
  if(!process.argv.includes('--speech-only')){
  owner=await connect(fixture.username);await rc('minecraft:tp '+owner.username+' 300.5 90 300.5');await delay(600);await rc('minecraft:setblock 300 90 302 minecraft:dirt');await delay(600);
  const block=owner.blockAt(owner.entity.position.offset(0,0,2).floored());checks('actual dig target is loaded dirt',block?.name==='dirt');await owner.dig(block);
  checks('real player action changed the block',owner.blockAt(block.position).name==='air');const before=modelRequests.length;
  await until(()=>modelRequests.length>before,'fresh nearby action creates a relevant topic after quiet period',145000);
  checks('proactive topic includes confirmed block change',JSON.stringify(modelRequests.at(-1).messages).includes('minecraft:dirt')&&JSON.stringify(modelRequests.at(-1).messages).includes('已经被挖开'));
  checks('cue is an observation and not a completed quest',JSON.stringify(modelRequests.at(-1).messages).includes('这不表示任务完成'));
  const n=modelRequests.length;await delay(6000);checks('same action does not trigger repeated model polling',modelRequests.length===n);
  }
 }
 await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);console.log(report.error);}
finally{release();peer?.close();for(const bot of bots)bot.quit();model.closeAllConnections();media.closeAllConnections();await new Promise(resolve=>model.close(resolve));await new Promise(resolve=>media.close(resolve));report.passed=!report.error;report.modelCalls=modelRequests.length;report.mediaCalls=mediaRequests.length;await fs.mkdir(root,{recursive:true});await fs.writeFile(root+'/short-'+(baseline?'baseline':'candidate')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));if(report.error)process.exitCode=1;}
