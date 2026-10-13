// Real loopback Paper test. Native /msg delivery, not simulated text matching.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {inspect} from 'node:util';
import {randomUUID} from 'node:crypto';
const stage=process.env.MC_STAGE_PAPER, output=process.env.MC_TEST_REPORT_DIR;
assert(stage&&output&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(props.match(/^server-port=(256\d\d)\r?$/m)?.[1]);assert(port);
const rconPort=Number(props.match(/^rcon.port=(256\d\d)\r?$/m)?.[1]);assert(rconPort&&rconPort!==port);
const {command}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/rcon-client.mjs'));
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:rconPort});
const require=createRequire(process.env.MC_TEST_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const {installRecipePacketBypass}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/mineflayer-client-compat.mjs'));
const mf=require('mineflayer'),bots=[],report={at:new Date().toISOString(),checks:[],errors:[]};let finishing=false,bedrock;
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);};
async function until(fn,label){for(let n=0;n<150;n++){if(fn())return;await sleep(100);}throw Error('Timeout: '+label);}
async function join(username){
 const bot=mf.createBot({host:'127.0.0.1',port,username,auth:'offline',version:'1.20.6',checkTimeoutInterval:60000});bots.push(bot);
 installRecipePacketBypass(bot._client);bot.lines=[];bot.private=[];bot.cameras=[];bot.teamPackets=[];bot.chatPackets=[];
 bot.on('messagestr',s=>bot.lines.push(s));bot.on('whisper',(username,message)=>bot.private.push({username,message}));
 bot._client.on('camera',p=>bot.cameras.push(p.cameraId));
 bot._client.on('packet',(data,meta)=>{if(/team/.test(meta.name))bot.teamPackets.push(data);if(/chat/.test(meta.name))bot.chatPackets.push({name:meta.name,data:inspect(data,{depth:10})});});
 bot.on('error',e=>report.errors.push(bot.username+': '+e.message));
 bot.on('kicked',e=>{if(!finishing)report.errors.push(bot.username+': '+JSON.stringify(e));});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout '+username)),20000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);});return bot;
}
try{
 check('candidate version',(await rc('version AgentFriend')).includes('0.4.34'));
 const sender=await join('ag_ChatFrom'),recipient=await join('ag_ChatTo'),other=await join('ChatBystander'),eye=await join('ag_ChatTo_eye');
 await until(()=>eye.cameras.at(-1)===recipient.entity.id,'Eye attached');
 check('Eye attached in spectator',eye.game.gameMode==='spectator');
 await rc('minecraft:team add whisper_qa');
 await rc('minecraft:team modify whisper_qa prefix '+JSON.stringify({text:'◆黑铁 [Agent] '}));
 const ops=fs.readFileSync(stage+'/ops.json','utf8');
 check('test participants are ordinary players',!JSON.parse(ops).some(p=>bots.some(b=>b.username===p.name)));
 for(const alias of ['msg','minecraft:msg','w','tell','whisper','minecraft:w','minecraft:tell']){
   await rc('minecraft:team join whisper_qa '+sender.username);
   await rc('minecraft:team join whisper_qa '+recipient.username);
   const text='私聊核验-'+alias,at=recipient.lines.length,whispers=recipient.private.length,echo=sender.lines.length,mirror=eye.lines.length;
   sender.chat('/'+alias+' '+recipient.username+' '+text);
   await until(()=>recipient.lines.slice(at).some(s=>s.includes(text)),alias);
   await until(()=>eye.lines.slice(mirror).some(s=>s.includes(text)),'Eye '+alias);
   await sleep(150);
   const incoming=recipient.lines.slice(at).filter(s=>s.includes(text));
   report.lastIncoming={alias,incoming,packets:recipient.chatPackets.slice(-2)};
   check(alias+': clean sender and one delivery',incoming.length===1&&incoming[0]===sender.username+' whispers to you: '+text);
   check(alias+': default Mineflayer sender is real username',recipient.private.length===whispers+1&&recipient.private.at(-1).username===sender.username);
   check(alias+': clean outgoing name',sender.lines.slice(echo).filter(s=>s.includes(text)).every(s=>!s.includes('[Agent]')&&!s.includes('◆')));
   check(alias+': clean Eye copy',eye.lines.slice(mirror).filter(s=>s.includes(text)).every(s=>s===incoming[0]));
   check(alias+': no bystander delivery',!other.lines.some(s=>s.includes(text)));
 }
 check('scoreboard nametags retained',recipient.teamPackets.some(t=>JSON.stringify(t).includes('◆黑铁 [Agent]')));
 const publicText='public-chat-kept';sender.chat(publicText);await until(()=>other.lines.some(s=>s.includes(publicText)),'public chat');
 check('public chat still delivered',other.lines.some(s=>s.includes(publicText)));
 const preserved='正文包含[Agent]和◆，仍应原样送达';sender.chat('/msg '+recipient.username+' '+preserved);
 await until(()=>recipient.lines.some(s=>s===sender.username+' whispers to you: '+preserved),'body preservation');
 check('message body is never stripped',true);
 const geyser=fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8').split(/^remote:/m)[0];
 assert.match(geyser,/^ {2}address: 127\.0\.0\.1\r?$/m);
 const bePort=Number(geyser.match(/^ {2}port: (\d+)\r?$/m)?.[1]);assert(bePort&&bePort!==19132);
 const beRequire=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM??'E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');
 bedrock=beRequire('bedrock-protocol').createClient({host:'127.0.0.1',port:bePort,version:'1.26.51',offline:true,username:'ChatBE34',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 let spawned=false;const beTexts=[];
 bedrock.on('session',p=>{p.xuid='9000000987434';});bedrock.on('spawn',()=>{spawned=true;});
 bedrock.on('text',p=>beTexts.push(JSON.stringify(p).replace(/§[0-9a-fk-or]/gi,'')));
 bedrock.on('error',e=>report.errors.push('Bedrock: '+e.message));
 bedrock.on('disconnect',p=>{if(!finishing)report.errors.push('Bedrock: '+JSON.stringify(p));});
 await until(()=>spawned,'Bedrock connects');check('real Bedrock protocol connected via isolated Geyser',true);
 await rc('minecraft:team join whisper_qa .ChatBE34');
 bedrock.write('command_request',{command:'/msg '+recipient.username+' 来自基岩',origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
 await until(()=>recipient.lines.some(s=>s==='.ChatBE34 whispers to you: 来自基岩'),'Bedrock sender');
 check('Bedrock dot-prefixed identity normalized for Java',true);
 sender.chat('/msg .ChatBE34 发往基岩');await until(()=>beTexts.some(s=>s.includes('发往基岩')),'Bedrock incoming');
 const incomingBE=beTexts.filter(s=>s.includes('发往基岩'));
 check('Bedrock receives exactly one clean native private message',incomingBE.length===1&&incomingBE[0].includes(sender.username)&&!incomingBE[0].includes('◆')&&!incomingBE[0].includes('[Agent]'));
 check('cross-platform private messages stay off public chat',!other.lines.some(s=>s.includes('来自基岩')||s.includes('发往基岩')));
 check('no OP changes',fs.readFileSync(stage+'/ops.json','utf8')===ops);
 check('no client errors',report.errors.length===0);
 report.success=true;
}catch(error){report.success=false;report.errors.push(error.stack??String(error));}
finally{
 finishing=true;bedrock?.close();for(const bot of bots)bot.quit('private chat names test complete');await sleep(300);
 fs.writeFileSync(path.join(output,'private-chat-names-'+Date.now()+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors,lastIncoming:report.success?undefined:report.lastIncoming}));process.exit(report.success?0:1);
}
