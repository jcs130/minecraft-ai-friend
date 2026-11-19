// Loopback Youer fixture only. The fixture owns its players, original maids and SVC endpoints.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
const [dir,anchor,receiver] = process.argv.slice(2);
const f=JSON.parse(fs.readFileSync(path.join(dir,'fixture.json')));
const lab=f.lab, properties=path.join(lab,'server.properties');
assert.equal(fs.readFileSync(path.join(lab,'.test-only'),'utf8'),'PACK_SPEECH_TEST_ONLY');
assert.match(fs.readFileSync(properties,'utf8'),/^server-ip=127\.0\.0\.1\s*$/m);
const rc=s=>command(s,10000,{properties,port:27041});
const require=createRequire(pathToFileURL(anchor)),{SvcReceiver}=await import(pathToFileURL(receiver));
const tests=[], clients=[], peers=[], lines=[];
let packets=0,poll;
function check(title,value){assert.ok(value,title);tests.push(title);console.log('PASS',title);}
async function until(title,fn,timeout=30000){
 for(const end=Date.now()+timeout;Date.now()<end;){const ok=await fn();if(ok)return ok;await sleep(150);}
 throw Error('Timed out: '+title);
}
const events=()=>{const p=path.join(dir,'events.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):[];};
const marks=()=>events().length;
const tts=(index,id,voice)=>events().slice(index).filter(e=>e.path==='/v1/tts'&&e.status===200&&e.actor===id&&e.voice===voice);
const ints=id=>'[I;'+[0,1,2,3].map(i=>Buffer.from(id.replaceAll('-',''),'hex').readInt32BE(i*4)).join(',')+']';
async function login(name){
 const bot=require('mineflayer').createBot({host:'127.0.0.1',port:27040,username:name,auth:'offline',version:'1.21.1',hideErrors:true});
 clients.push(bot);bot.on('error',()=>{});bot.on('messagestr',text=>lines.push({name,text}));await until('login '+name,()=>bot.entity);return bot;
}
async function spawn(id,owner,name,initialPack,x){
 const fields=['UUID:'+ints(id),'NoAI:1b','PersistenceRequired:1b','Sitting:1b','SoundPackId:"'+initialPack+'"','CustomName:\'{"text":"'+name+'"}\''];
 if(owner)fields.push('Owner:'+ints(owner));
 if(!(await rc('minecraft:data get entity '+id+' UUID')).includes('[I;'))
     await rc('minecraft:summon touhou_little_maid:maid '+x+' 90 103.5 {'+fields.join(',')+'}');
 assert((await rc('minecraft:data get entity '+id+' UUID')).includes('[I;'),'synthetic spawn');
 await rc('minecraft:data modify entity '+id+' NoAI set value 1b');
 await rc('minecraft:data modify entity '+id+' Sitting set value 1b');
 await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+id+' '+x+' 90 103.5');
 await pack(id,initialPack);
}
async function pack(id,value){await rc('minecraft:data modify entity '+id+' SoundPackId set value "'+value+'"');}
async function voicePeer(bot){
 const p=new SvcReceiver({bot,authorized:()=>true,gameHost:'127.0.0.1',voiceLoopbackPort:27042,timeoutMs:12000});
 peers.push(p);await p.enable();return p;
}
const receipt=(id,operation)=>{
 const file=path.join(lab,'plugins/QiandengjiMaidBridge/native-receipts',id+'_'+operation+'.json');
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
};
async function ask(bot,id,text){
 const operation='qa_'+randomUUID();
 bot.chat('/qdmaid chat '+id+' '+operation+' '+text);
 await until('owner reply for original operation',()=>receipt(id,operation)?.status==='replied',90000);
 return operation;
}
const state=async(id,key)=>rc('minecraft:data get entity '+id+' '+key);
const shamare='mubai-tlm-shamare-20261120',nahida='feiyu-tlm-nahida-cn-20261111',hutao='feiyu-tlm-hutao-cn-20261110';
try{
 check('shared runtime loaded',(await rc('version QiandengjiMaidBridge')).includes('0.1.57-sound-pack-dialogue'));
 const owner=await login(f.owner),second=await login(f.second),visitor=await login(f.visitor);
 check('two independent synthetic owners',owner._client.uuid===f.ownerId&&second._client.uuid===f.secondOwner&&f.ownerId!==f.secondOwner);
 await rc('minecraft:forceload add 100 100');await rc('minecraft:fill 97 89 97 115 89 108 minecraft:stone');
 for(const [bot,x] of [[owner,101],[second,109],[visitor,105]])await rc('minecraft:tp '+bot.username+' '+x+'.5 90 101.5');
 await spawn(f.maidId,f.ownerId,'沐白','shamare_pack',101.5);
 await spawn(f.secondId,f.secondOwner,'云铃','nahida',109.5);
 await spawn(f.wildId,null,'野外测试','nahida',113.5);
 await until('bind new maid',async()=>(await state(f.maidId,'MaidAIChat.LLMSite')).includes('qa_brain_native'));
 check('newly tamed maids inherit the server LLM', (await state(f.secondId,'MaidAIChat.LLMSite')).includes('qa_brain_native'));
 check('native UI inherits selected-pack TTS', (await state(f.maidId,'MaidAIChat.TTSSiteName')).includes('qiandengji_sound_pack'));
 check('untamed maid has no shared site', !(await state(f.wildId,'MaidAIChat')).includes('qiandengji_sound_pack'));
 const stream=await voicePeer(owner),secondStream=await voicePeer(second);
 check('both Java SVC listeners connected',stream.status().available&&secondStream.status().available);
 poll=setInterval(()=>{if(stream.ready)packets+=stream.drain().frames.length;if(secondStream.ready)secondStream.drain();},40);
 let n=marks();const op='deny_'+randomUUID();visitor.chat('/qdmaid chat '+f.maidId+' '+op+' 你好');await sleep(1300);
 check('visitor cannot use another private maid',!receipt(f.maidId,op)&&events().slice(n).every(e=>e.path!='/v1/chat/completions'));
 const frames=JSON.parse(fs.readFileSync(path.join(dir,'mic-frames.json'))).map(s=>Buffer.from(s,'base64'));
 const enc=n=>{let v=n;const a=[];do{const b=v&127;v>>>=7;a.push(b|(v?128:0));}while(v);return Buffer.from(a);};
 await until('body tracked',()=>Object.values(owner.entities).some(e=>e.uuid===f.maidId));
 await owner.lookAt(Object.values(owner.entities).find(e=>e.uuid===f.maidId).position.offset(0,0.85,0),true);await sleep(800);
 for(let seq=0;seq<=frames.length;seq++){const audio=frames[seq]??Buffer.alloc(0),stamp=Buffer.alloc(8);stamp.writeBigInt64BE(BigInt(seq));stream.send(Buffer.concat([Buffer.from([1]),enc(audio.length),audio,stamp,Buffer.from([0])]));await sleep(20);}
 await until('first owner selected voice',()=>tts(n,f.maidId,shamare).length,100000);
 await until('nonempty Opus',()=>packets>=8);
 check('spoken address used ASR, one LLM reply and the selected voice',events().slice(n).some(e=>e.path==='/v1/asr'&&e.status===200)&&events().slice(n).filter(e=>e.path==='/v1/chat/completions').length===1&&tts(n,f.maidId,shamare).length===1);
 check('nearby client received Opus',packets>=8);
 n=marks();await ask(second,f.secondId,'看看这里有什么。');await until('second owner sound',()=>tts(n,f.secondId,nahida).length,100000);
 check('second owner uses own sound pack',tts(n,f.secondId,nahida).length===1);
 await rc('packqa select '+f.maidId+' '+visitor.username+' hu_tao_sound_pack');
 check('visitor selection leaves the native sound pack alone',(await state(f.maidId,'SoundPackId')).includes('shamare_pack'));
 await rc('packqa select '+f.maidId+' '+owner.username+' hu_tao_sound_pack');
 await until('owner selects through native menu handler',async()=>(await state(f.maidId,'SoundPackId')).includes('hu_tao_sound_pack'));
 n=marks();await ask(owner,f.maidId,'你现在看到的天气如何？');await until('switched TTS',()=>tts(n,f.maidId,hutao).length,100000);
 check('same entity switches voice on the next reply',tts(n,f.maidId,hutao).length===1&&!tts(n,f.maidId,shamare).length);
 n=marks();await rc('packqa speak '+f.maidId);const native=await until('1.5.3 native MP3 decoder',async()=>{const s=await rc('packqa read');return s.includes('native-mp3')&&s;},100000);
 check('native TTS API returns audio its own decoder accepts',native.includes('24000')&&tts(n,f.maidId,hutao).length===1);
 n=marks();await rc('packqa speak '+f.maidId);await pack(f.maidId,'nahida');await until('stale native reply discarded',async()=>(await rc('packqa read')).includes('skipped 409'),100000);
 check('native callback discards old audio after pack change',true);
 n=marks();await pack(f.maidId,'unknown_private_pack');await ask(owner,f.maidId,'这里是什么地方？');await sleep(1500);
 check('unavailable pack keeps text and never substitutes a voice',events().slice(n).every(e=>e.path!='/v1/tts'));
 await rc('packqa speak '+f.maidId);check('native UI reports missing voice',(await rc('packqa read')).includes('skipped 404'));
 await pack(f.maidId,'shamare_pack');
 if((await rc('packqa setting '+f.maidId)).includes('setting-empty')){
   await rc('packqa chat '+f.maidId);
   await until('original native manager initializes the model persona',async()=>(await rc('packqa setting '+f.maidId)).includes('setting-ready'),120000);
 }
 n=marks();await rc('packqa chat '+f.maidId);
 await until('native chat uses selected LLM and TTS',()=>tts(n,f.maidId,shamare).length,120000);
 check('native chat manager reaches both server providers',events().slice(n).some(e=>e.path==='/v1/chat/completions'&&e.status===200)&&tts(n,f.maidId,shamare).length===1);
 const worldHas=async(who,dim)=>(await rc('minecraft:execute as '+who+' at @s if dimension minecraft:'+dim+' run minecraft:data get entity @s UUID')).includes('[I;');
 await rc('minecraft:execute in minecraft:the_nether run minecraft:forceload add 100 100');
 await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 96 89 96 106 89 106 minecraft:stone');
 await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 96 90 96 106 92 106 minecraft:air');
 await rc('minecraft:execute in minecraft:the_nether run minecraft:tp '+owner.username+' 101.5 90 101.5');
 await sleep(800);
 check('a sitting maid stays behind when her owner reaches the Nether',await worldHas(f.ownerId,'the_nether')&&await worldHas(f.maidId,'overworld'));
 owner.quit('Synthetic reconnect');await until('old owner left',async()=>!(await rc('minecraft:list')).includes(owner.username));
 await rc('minecraft:data modify entity '+f.maidId+' NoAI set value 0b');
 await rc('minecraft:data modify entity '+f.maidId+' Sitting set value 0b');
 const returned=await login(f.owner);
 await until('original following maid catches up after a cross-world reconnect',()=>worldHas(f.maidId,'the_nether'),18000);
 check('reconnect keeps the original owner and chosen pack',(await state(f.maidId,'SoundPackId')).includes('shamare_pack')&&returned._client.uuid===f.ownerId);
 await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+returned.username+' 101.5 90 101.5');
 await until('original body follows back',()=>worldHas(f.maidId,'overworld'),18000);
 check('other owner and maid remained in their world',await worldHas(f.secondId,'overworld'));
 const log=fs.readFileSync(path.join(lab,'logs/latest.log'),'utf8');
 check('full catalog initialized',log.includes('player-owned bodies, sound packs=28'));
 check('all three player joins ran without bridge errors',!log.includes('Could not pass event PlayerJoinEvent to QiandengjiMaidBridge'));
} catch(e){console.error(String(e));process.exitCode=1;}
finally{clearInterval(poll);for(const p of peers)p.close();for(const bot of clients)bot.quit('Synthetic fixture finished');fs.writeFileSync(path.join(dir,'game-result.json'),JSON.stringify({passed:!process.exitCode,tests,packets},null,2));}
