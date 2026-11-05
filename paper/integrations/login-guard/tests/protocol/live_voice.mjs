// Test-only loopback harness: real Minecraft/Velocity sockets, synthetic backend speech.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {attachProximityVoice} from '../../../proximity-voice/client.mjs';

const require=createRequire(process.env.VOICE_QA_NODE_PACKAGE ?? import.meta.url);
const mineflayer=require('mineflayer');
const port=Number(process.env.VOICE_QA_PORT??25881),baseline=process.env.VOICE_QA_BASELINE==='1';
let checks=0;const clients=[];
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
async function connect(username){
 const bot=mineflayer.createBot({host:'127.0.0.1',port,username,auth:'offline',version:'1.21.1',hideErrors:true});clients.push(bot);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),15000);
  bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);bot.once('kicked',reject);});
 await sleep(250);return bot;
}
try{
 const bot=await connect('qa_voice'),heard=[],packets=[],outgoing=[];
 bot._client.on('custom_payload',packet=>{if(packet.channel==='mcagent:voice'&&packet.data[0]===1)packets.push(JSON.parse(packet.data.subarray(1)));});
 const write=bot._client.write.bind(bot._client);bot._client.write=(name,data)=>{
  if(name==='custom_payload'&&data.channel==='mcagent:voice'&&data.data[0]===1)outgoing.push(JSON.parse(data.data.subarray(1)));return write(name,data);
 };
 const voice=attachProximityVoice(bot,{timeoutMs:600,onHearing:row=>heard.push(row)});
 if(baseline){
  const result=await voice.say('sent',{requestId:randomUUID()});
  check(result.state==='unknown'&&result.reason.includes('TIMEOUT'),'baseline: legal backend completion is lost');
  check(packets.length===0,'baseline: all registered voice replies are blocked');
  console.log(JSON.stringify({baseline:true,checks,result,speechEngine:'synthetic',network:'real Velocity + Paper'}));
 }else{
  for(const terminal of ['sent','failed','cancelled','unknown']){
   const requestId=randomUUID(),result=await voice.say(terminal,{requestId});
   check(result.state===terminal,'terminal '+terminal);check(result.requestId===requestId,'original ID '+terminal);
   check(JSON.stringify(packets.filter(r=>r.requestId===requestId).map(r=>r.state))===JSON.stringify(['queued','playing',terminal]),'receipt order '+terminal);
   check(outgoing.filter(r=>r.op==='say'&&r.requestId===requestId).length===1,'one request '+terminal);
  }
  const requestId=randomUUID(),lost=await voice.say('lost',{requestId});
  check(lost.state==='unknown'&&lost.lastState==='playing','lost terminal stays unknown');
  check((await voice.status(requestId)).state==='sent','query same request recovers result');
  check(outgoing.filter(r=>r.requestId===requestId).map(r=>r.op).join(',')==='say,status','query does not replay');
  await sleep(1200);check(heard.some(row=>row.text==='一起去公会'),'nearby voice received');
  const denied=await connect('qa_denied'),deniedPackets=[];
  denied._client.on('custom_payload',packet=>{if(packet.channel==='mcagent:voice')deniedPackets.push(packet);});
  const blockedVoice=attachProximityVoice(denied,{timeoutMs:600,onHearing:()=>{throw Error('unauthorized caption');}});
  check((await blockedVoice.say('sent')).state==='unknown','unauthorized C2S blocked');
  await sleep(1200);check(deniedPackets.length===0,'unauthorized S2C blocked');blockedVoice.close();
  console.log(JSON.stringify({baseline:false,checks,receivedStates:[...new Set(packets.filter(r=>r.type==='voice_result').map(r=>r.state))],captions:heard.length,speechEngine:'synthetic',authorization:'test provider',network:'real Velocity + Paper'}));
 }
 voice.close();
}finally{for(const client of clients)client.quit();await sleep(200);}
