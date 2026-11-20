// Disposable hybrid stage with a registered original maid, Simple Voice Chat and two real protocol clients.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {receiver} from '../../touhou-maids/tests/svc-receiver.mjs';

const [config, report, micFrames] = process.argv.slice(2);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const {lab, ports, body, name} = await read(config);
assert.equal((await fs.readFile(path.join(lab, '.resident-hybrid-qa'), 'utf8')).trim(), 'SYNTHETIC_RESIDENT_HYBRID_ONLY');
const properties = path.join(lab, 'server.properties');
const settings = await fs.readFile(properties, 'utf8');
assert(settings.includes('server-ip=127.0.0.1') && settings.includes('rcon.port='+ports[1]) && ports[1]!==25575);
const rc = text => command(text, 7000, {properties,port:ports[1]});
const getBody = () => rc('minecraft:data get entity '+body+' Pos');
const until = async (fn, label, ms=25000) => {
    for (const end=Date.now()+ms; Date.now()<end;) {
        const result=await fn(); if(result)return result; await sleep(200);
    }
    throw Error('Timed out: '+label);
};
const mc=createRequire(process.env.MINEFLAYER_ANCHOR)('mineflayer');
const bots=[];
const folder=path.join(lab,'world/data/tlm-companion-memory',body);
const reportData={actor:body, displayName:name, results:[]};
async function join(username){
    const bot=mc.createBot({host:'127.0.0.1',port:ports[0],username,version:'1.21.1',auth:'offline'});
    const lines=[];const client={bot,lines};bots.push(client);
    bot.on('messagestr',line=>lines.push(line));
    await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reason=>reject(Error(String(reason))));});
    client.voice=await receiver(bot,{port:ports[3]});
    return client;
}
async function turn(scope, mode){
    const [one,two]=bots; const marker='QA'+randomUUID().slice(0,6);
    const text='你好，我们在这里集合。';
    const before=bots.map(c=>({audio:c.voice.state.packets.length,lines:c.lines.length}));
    one.bot.chat('/npcsocial '+name+' '+(scope==='private'?'tell':'public')+' '+marker);
    const req=await until(async()=>{
        for(const f of await fs.readdir(folder)){
            if(!f.endsWith('-request.json'))continue;
            const q=await read(path.join(folder,f));
            if(q.message===marker)return q;
        }
    },'social request '+scope+' '+mode+' (last game message '+one.lines.at(-1)+')');
    assert.equal(req.maidId,body);assert.equal(req.speakerId,one.bot.player.uuid);assert.equal(req.medium,'text');
    assert(req.replyModes.includes(mode), 'not advertised: '+JSON.stringify(req.replyModes)+' for '+mode);
    const answer={id:req.id,maidId:body,speakerId:req.speakerId,channel:req.channel,status:'prepared',
                  schemaVersion:1,reply:text,replyMode:mode};
    const replyPath=path.join(folder,req.id+'-answer.json');
    await fs.writeFile(replyPath+'.qa',JSON.stringify(answer));await fs.rename(replyPath+'.qa',replyPath);
    const resultFile=path.join(folder,req.id+'-result.json');
    const observed=await until(async()=>{
        const row=await read(resultFile).catch(()=>null);
        if(!row)return;
        if(row.status!=='answered')throw Error('delivery failed '+JSON.stringify(row));
        return mode==='text'||row.voice?.state==='sent'?row:null;
    },'terminal original receipt for '+mode,55000);
    await sleep(800);
    const captions=bots.map((c,i)=>c.lines.slice(before[i].lines).filter(s=>s.includes(name+'：'+text)).length);
    const packets=bots.map((c,i)=>c.voice.state.packets.slice(before[i].audio));
    const data={scope,mode,requestId:req.id,speakerId:req.speakerId,bodyId:req.maidId,captionCount:captions,
                receivedOpus:packets.map(a=>a.length),speech:observed.voice,hearingVerified:observed.hearingVerified};
    reportData.results.push(data); await fs.writeFile(report,JSON.stringify(reportData,null,2));
    if(mode!=='text')await fs.writeFile(report+'.'+req.id+'.opus-frames.json',JSON.stringify(packets[0]));
    console.log(JSON.stringify(data));
    if(mode==='speech'){assert.deepEqual(captions,[0,0]);assert(packets[0].length>12);assert.equal(packets[1].length,0);}
    else if(mode==='text'){assert.deepEqual(captions,[1,1]);assert.deepEqual(data.receivedOpus,[0,0]);}
    else{assert.equal(captions[0],1);assert.equal(captions[1],0);assert(packets[0].length>12);assert.equal(packets[1].length,0);}
}
try{
    const [x,,z]=await read(path.join(path.dirname(config),'pos.json'));
    await rc('minecraft:execute in minecraft:the_nether run forceload add '+Math.floor(x)+' '+Math.floor(z));
    await until(async()=>/(\[|List)/.test(await getBody()), 'loaded registered maid');
    const one=await join('MediaProbeOne'), two=await join('MediaProbeTwo');
    for(const c of bots)await rc('minecraft:gamemode survival '+c.bot.username);
    await rc('minecraft:execute in minecraft:overworld run minecraft:fill 295 190 290 350 190 305 minecraft:stone');
    await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+body+' 301.5 191 300.5');
    await rc('minecraft:data merge entity '+body+' {NoAI:1b,Silent:0b}');
    const move=async(client,x)=>rc('minecraft:execute in minecraft:overworld run minecraft:tp '+client.bot.username+' '+x+' 191 300.5');
    await move(one,303.5);await move(two,304.5);
    await sleep(2500);
    if(micFrames){
        const inbox=path.join(lab,'plugins/QiandengjiMaidBridge/native-dialogue',body+'.json');
        const pending=async()=>Object.values((await read(inbox).catch(()=>({}))).pending??{});
        const previous=new Set((await pending()).map(row=>row.eventId));
        const frames=await read(micFrames);
        await one.voice.speak(frames);
        const stamp=await until(async()=>{
            const rows=await pending();
            return rows.find(row=>!previous.has(row.eventId)&&row.eventId.startsWith('qdvoice:'+one.bot.player.uuid+':voice_'));
        },'transcribed microphone event in original body inbox',35000);
        assert.equal(stamp.senderUuid,one.bot.player.uuid);assert(stamp.text.includes('集合'));
        reportData.microphone={speakerId:stamp.senderUuid,listenerId:body,eventId:stamp.eventId,text:stamp.text,opusFrames:frames.length};
        await fs.writeFile(report,JSON.stringify(reportData,null,2));
        console.log(JSON.stringify(reportData.microphone));
    }
    await turn('public','text');await turn('private','speech');
    await move(two,347.5);await sleep(1200);
    await turn('public','native');
}catch(error){
    console.error('Last synthetic player messages',bots.map(c=>c.lines.slice(-6)));
    throw error;
}finally{for(const c of bots){c.voice?.close();c.bot.end();}}
