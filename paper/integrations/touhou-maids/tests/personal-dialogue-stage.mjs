// Isolated Youer test. Requires a synthetic owner saved in the Nether while her attacking
// maid is still in the Overworld, the SVC receiver, an ASR microphone sample and a local model relay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';

const [fixtureFile, clientAnchor, receiverModule, output] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
const {speaker, visitor, ownerId, maidId, other, lab} = fixture;
const here = path.dirname(fixtureFile);
assert.equal(fixture.synthetic, true);
assert.equal(fs.readFileSync(path.join(lab,'.personal-maid-qa'),'utf8'),'SYNTHETIC_PERSONAL_MAID_ONLY');
const properties = path.join(lab,'server.properties');
const props = fs.readFileSync(properties,'utf8');
for(const line of ['server-port=26990','rcon.port=26991','server-ip=127.0.0.1'])assert(props.split(/\r?\n/).includes(line));
const require = createRequire(pathToFileURL(clientAnchor));
const {SvcReceiver} = await import(pathToFileURL(receiverModule));
const run = text => command(text,10000,{properties,port:26991});
const inWorld = (w,text) => run('minecraft:execute in minecraft:'+w+' run minecraft:'+text);
const hasBody = async (id,w) => (await run('minecraft:execute as '+id+' at @s if dimension minecraft:'+w+' run minecraft:data get entity @s UUID')).includes('[I;');
const pos = async id => {
    const data = (await run('minecraft:data get entity '+id+' Pos')).match(/\[([^\]]+)\]/);
    return data ? data[1].split(',').map(s=>parseFloat(s.trim())) : null;
};
const clients = [], checks = [], lines = [];
let peer, poll, audioPackets = 0;
const facts = {};
const check = (label,value) => {assert(value,label);checks.push(label);console.log('PASS',label);};
async function until(label,fn,ms=15000){
    for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(140);}
    throw Error('Timed out: '+label);
}
async function login(name){
    const bot = require('mineflayer').createBot({host:'127.0.0.1',port:26990,username:name,auth:'offline',version:'1.21.1',hideErrors:true});
    clients.push(bot);
    bot.on('error',()=>{});bot.on('messagestr',s=>lines.push({name,text:s}));
    await until('synthetic login '+name,()=>!!bot.entity);
    return bot;
}
const listEvents = () => {
    const p=path.join(here,'qa-relay-events.json');
    return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[];
};
const receiptList = () => {
    const d=path.join(lab,'plugins/QiandengjiMaidBridge/native-receipts');
    return fs.existsSync(d)?fs.readdirSync(d).filter(n=>n.startsWith(maidId+'_')&&n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(d,n),'utf8'))):[];
};
const dataInts = id => '[I;'+[0,1,2,3].map(i=>Buffer.from(id.replaceAll('-',''),'hex').readInt32BE(i*4)).join(',')+']';
async function face(bot){
    const body=Object.values(bot.entities).find(e=>e.uuid===maidId);
    assert(body,'original maid tracked by the unmodified Java client');
    await bot.lookAt(body.position.offset(0,0.85,0),true);
}
function variable(n){
    const b=[];do{const x=n&127;n>>>=7;b.push(n?x|128:x);}while(n);return Buffer.from(b);
}
async function microphone(){
    const frames=JSON.parse(fs.readFileSync(path.join(here,'mic-frames.json'),'utf8')).map(s=>Buffer.from(s,'base64'));
    let seq=0n;
    for (const pcm of [...frames,Buffer.alloc(0)]) {
        const stamp=Buffer.alloc(8);stamp.writeBigInt64BE(seq++);
        peer.send(Buffer.concat([Buffer.from([1]),variable(pcm.length),pcm,stamp,Buffer.from([0])]));
        await sleep(20);
    }
}
try{
    check('candidate bridge loaded',(await run('version QiandengjiMaidBridge')).includes('0.1.56-owner-dialogue'));
    check('candidate voice relay loaded',(await run('version QiandengVoice')).includes('0.1.13'));
    if (fixture.tracePortal) await run('portalqa track '+maidId);
    check('original starts in an unloaded chunk',!(await run('minecraft:data get entity '+maidId+' UUID')).includes('[I;'));
    const actor=await login(speaker);
    check('synthetic owner UUID',actor._client.uuid===ownerId);
    check('owner in Nether before recovery',await hasBody(speaker,'the_nether'));
    await until('owner reconnect restores original attacking body',()=>hasBody(maidId,'the_nether'),12000);
    check('reconnect recovered same body',await hasBody(maidId,'the_nether'));
    check('selected attack task preserved',(await run('minecraft:data get entity '+maidId+' MaidTask')).includes('touhou_little_maid:attack'));
    check('saved voice preserved',(await run('minecraft:data get entity '+maidId+' SoundPackId')).includes('shamare_pack'));
    check('existing owner preserved',(await run('minecraft:data get entity '+maidId+' Owner')).includes(dataInts(ownerId).slice(3,-1).split(',').join(', ')));
    await inWorld('overworld','tp '+speaker+' 101.5 90 101.5');
    check('owner reached overworld',await hasBody(speaker,'overworld'));
    await until('original maid followed active teleport',()=>hasBody(maidId,'overworld'));
    const a=await pos(speaker), b=await pos(maidId);
    check('same original arrived near owner',a&&b&&Math.hypot(...a.map((v,i)=>v-b[i]))<7);
    check('no source-world copy',!await hasBody(maidId,'the_nether'));
    await inWorld('overworld','tp '+maidId+' 101.5 90 103.5');
    await run('minecraft:data modify entity '+maidId+' Sitting set value 1b');
    await inWorld('the_nether','tp '+speaker+' 101.5 90 101.5');await sleep(850);
    check('explicit sit preserved',await hasBody(maidId,'overworld'));
    await inWorld('overworld','tp '+speaker+' 101.5 90 101.5');
    await run('minecraft:data modify entity '+maidId+' Sitting set value 0b');
    const neighbor=await login(visitor);await inWorld('overworld','tp '+visitor+' 104.5 90 101.5');
    await inWorld('overworld','tp '+maidId+' 101.5 90 103.5');
    // Hold position only for the acoustic/gaze measurements, after the actual travel tests.
    await run('minecraft:data modify entity '+maidId+' Sitting set value 1b');
    peer=new SvcReceiver({bot:actor,authorized:()=>true,gameHost:'127.0.0.1',voiceLoopbackPort:26992,timeoutMs:12000});
    await peer.enable();check('real SVC UDP handshake',peer.status().available);
    poll=setInterval(()=>{if(peer?.ready)audioPackets+=peer.drain().frames.length;},80);
    const start=listEvents().length;
    neighbor.chat('沐白，看见我了吗？');await sleep(1150);
    check('visitor cannot invoke the personal model',listEvents().slice(start).every(r=>r.path!='/v1/chat/completions'));
    await inWorld('overworld','summon touhou_little_maid:maid 104.5 90 103.5 {UUID:'+dataInts(other)+',Owner:'+dataInts(ownerId)+',Sitting:1b,CustomName:\'{"text":"小杏"}\',PersistenceRequired:1b}');
    await inWorld('overworld','tp '+other+' 104.5 90 103.5');
    await until('other original maid in range',()=>hasBody(other,'overworld'));
    const priorCount=receiptList().length;
    await face(actor);actor.chat('小杏，这里下雨了吗？');await sleep(1150);
    check('speaking to another maid overrides gaze and spends no model budget',receiptList().length===priorCount&&listEvents().slice(start).every(r=>r.path!='/v1/chat/completions'));
    await face(actor);await sleep(700);
    const before=receiptList().map(r=>r.operationId);
    await microphone();
    await until('recognition of synthetic audio',()=>listEvents().slice(start).some(r=>r.path==='/v1/asr'&&r.status===200),20000);
    const asr=listEvents().slice(start).find(r=>r.path==='/v1/asr'&&r.status===200);
    check('spoken Chinese transcribed',asr.syntheticTranscript?.length>=3);
    await until('owner speech reached the model',()=>listEvents().slice(start).some(r=>r.path==='/v1/chat/completions'),85000);
    const model=listEvents().slice(start).find(r=>r.path==='/v1/chat/completions');
    check('real LLM replied without action tools',model.status===200&&model.tools===0);
    await until('original utterance has one new replied receipt',()=>receiptList().some(r=>!before.includes(r.operationId)&&r.operationId?.startsWith('voice_')&&r.status==='replied'));
    const replies=receiptList().filter(r=>!before.includes(r.operationId)&&r.operationId?.startsWith('voice_')&&r.status==='replied');
    check('one correlated reply to original speaker',replies.length===1);
    const reply=replies[0].observation.reply;
    await until('reply delivered to Java client',()=>lines.some(l=>l.name===speaker&&l.text.includes('[附近·女仆]')&&l.text.includes(reply)),8000);
    check('one nearby reply for actual speaker',lines.filter(l=>l.name===speaker&&l.text.includes('[附近·女仆]')&&l.text.includes(reply)).length===1);
    await until('personal timbre synthesized',()=>listEvents().slice(start).some(r=>r.path==='/v1/tts'&&r.status===200),100000);
    await until('listener received nonempty Opus',()=>audioPackets>=8,25000);
    check('selected pack produced audible transport',audioPackets>=8&&listEvents().slice(start).some(r=>r.path==='/v1/tts'&&r.voice===fixture.voice&&r.bytes>48000));
    const budget=listEvents().length;
    await run('minecraft:data modify entity '+maidId+' SoundPackId set value "different_pack"');
    actor.chat('/qdmaid context '+maidId);await sleep(700);
    check('changed pack keeps its own selection',(await run('minecraft:data get entity '+maidId+' SoundPackId')).includes('different_pack'));
    check('read-only context never synthesizes substitute voices',listEvents().slice(budget).every(r=>r.path!='/v1/tts'));
    const oldReplies=receiptList().filter(r=>r.status==='replied').map(r=>r.operationId);
    actor.chat('沐白，我们是在什么地方？');
    await until('owner can speak after choosing a different pack',()=>receiptList().some(r=>r.status==='replied'&&!oldReplies.includes(r.operationId)),90000);
    await sleep(1400);
    check('unmapped pack keeps the text reply without another TTS voice',listEvents().slice(budget).every(r=>r.path!='/v1/tts'));

    await inWorld('overworld','forceload add 615 511');
    await inWorld('overworld','tp '+maidId+' 615.5 90 511.5');
    await sleep(1800);
    await inWorld('overworld','forceload remove 615 511');
    await until('distant body unloaded before manual recall',async()=>!await hasBody(maidId,'overworld'),95000);
    const req='recall_'+Date.now(), originalReceipt=()=>receiptList().find(r=>r.operationId===req);
    actor.chat('/qdmaid recall '+maidId+' '+req);
    await until('original recall confirms arrival',()=>originalReceipt()?.status==='applied',12000);
    const recalled=await pos(maidId), ownerPos=await pos(speaker);
    check('manual recall from unloaded chunk confirms same body at the owner',
        originalReceipt().observation.arrived===true&&Math.hypot(...ownerPos.map((v,i)=>v-recalled[i]))<7);
    actor.chat('/qdmaid recall '+maidId+' '+req);await sleep(300);
    check('repeated recall keeps original operation and receipt',receiptList().filter(r=>r.operationId===req).length===1&&originalReceipt().status==='applied');
    Object.assign(facts,{operationId:replies[0].operationId,selectedVoice:fixture.voice,model:model.actualModel,audioPackets,asrChars:asr.syntheticTranscript.length});
}catch(error){
    if (fixture.tracePortal) facts.travel=await run('portalqa read').catch(()=>null);facts.error=String(error);facts.recentMessages=lines.slice(-10);process.exitCode=1;console.error(facts.error);
}finally{
    clearInterval(poll);peer?.close();for(const bot of clients)bot.quit('Isolated QA complete');
    fs.writeFileSync(output,JSON.stringify({passed:!facts.error,checks,facts},null,2)+'\n');
}
