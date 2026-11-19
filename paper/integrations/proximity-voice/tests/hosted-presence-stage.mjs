// Run against a disposable resident world with a real hosted Numen, SVC, media service and two test clients.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {hostedBootstrapClient} from '../../numen-hosting/src/bootstrap-client.mjs';
import {scopedMcpSessions} from '../../numen-hosting/src/mcp-session.mjs';
import {receiver} from '../../touhou-maids/tests/svc-receiver.mjs';

const [fixture, output] = process.argv.slice(2);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const {lab, ports, synthetic} = await read(fixture);
assert(synthetic && await fs.readFile(path.join(lab,'.resident-hybrid-qa'),'utf8') === 'SYNTHETIC_RESIDENT_HYBRID_ONLY');
const properties = path.join(lab,'server.properties');
const config = await fs.readFile(properties,'utf8');
assert(config.includes('server-ip=127.0.0.1') && config.includes('rcon.port='+ports[1]) && ports[1]!==25575);
const rc = cmd => command(cmd,7000,{properties,port:ports[1]});
const root = path.join(lab,'plugins/numen_hosted/server');
const boot = await read(path.join(root,'hosted-bootstrap.json'));
const admission = hostedBootstrapClient({endpoint:'http://127.0.0.1:'+boot.port+'/v1/hosted-role',controlKey:await fs.readFile(path.join(root,'hosted-model.key'))});
const role = {roleUuid:'10000000-0000-0000-0000-000000000011',numenOwnerUuid:'20000000-0000-0000-0000-000000000021',name:'QaKirito',ownerId:'qa',serverId:'qa'};
const social = path.join(lab,'world/data/tlm-companion-memory',role.roleUuid);
const mineflayer = createRequire(process.env.MINEFLAYER_ANCHOR)('mineflayer');
const steps=[], bots=[], listeners=[];
async function check(label, details={}) {
    steps.push({label,...details});await fs.writeFile(output,JSON.stringify(steps,null,2));console.log(label);
}
async function until(label, fn, ms=24000) {
    const end=Date.now()+ms;
    while(Date.now()<end){const value=await fn();if(value)return value;await sleep(180);}
    throw Error('Timed out: '+label);
}
async function join(name){
    const bot=mineflayer.createBot({host:'127.0.0.1',port:ports[0],version:'1.21.1',username:name,auth:'offline'});
    bots.push(bot);const lines=[];bot.on('messagestr',s=>lines.push(s));
    await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reason=>reject(Error(String(reason))));});
    const voice=await receiver(bot,{port:ports[3]});listeners.push(voice);return {bot,voice,lines};
}
const controllers=randomUUID();let epoch=1, mcp, pulse;
async function body(op,fields={}){
    const reply=await mcp.callTool({name:'hosted_body',arguments:{op,companion:role.roleUuid,expectedOwner:role.numenOwnerUuid,
        expectedName:role.name,serverId:role.serverId,boot:controllers,epoch,...fields}});
    assert(!reply.isError,'hosted body refused '+op+' '+(reply.content?.[0]?.text||'').slice(0,160));
    return reply.structuredContent??JSON.parse(reply.content[0].text);
}
const token=randomUUID().slice(0,8);
const location=(name,x)=>rc('minecraft:execute in minecraft:overworld run minecraft:tp '+name+' '+x+' 199 296.5');
async function socialReply(player,scope,msg,reply){
    const prior=new Set(await fs.readdir(social));
    if(scope==='private')player.bot.chat('/npcsocial QaKirito tell '+msg);
    else player.bot.chat('桐人，'+msg);
    const row=await until(scope+' scoped inbox',async()=>{
        for(const name of await fs.readdir(social)){
            if(!name.endsWith('-request.json')||prior.has(name))continue;
            const q=await read(path.join(social,name));
            if(q.speakerId===player.bot.player.uuid && q.channel===scope && q.message.includes(msg))return q;
            if(scope==='public' && q.speakerId===player.bot.player.uuid && q.channel==='nearby' && q.message.includes(msg))return q;
        }
    });
    const prepared={schemaVersion:1,id:row.id,maidId:role.roleUuid,speakerId:row.speakerId,channel:row.channel,status:'prepared',reply};
    // Only the model's answer is supplied by the fixture. Input, delivery and voice use the ordinary game paths.
    const target=path.join(social,row.id+'-answer.json');
    await fs.writeFile(target+'.qa',JSON.stringify(prepared),{flag:'wx'});await fs.rename(target+'.qa',target);
    await until(scope+' reply to original player',()=>player.lines.some(s=>s.includes(reply)));
}
try{
    await admission.admit(role);
    const scope=await admission.session(role);
    const sessionFor=await scopedMcpSessions({coreDirectory:process.env.MC_SDK_DIRECTORY,endpointFor:()=>scope.endpoint,tokenFor:()=>scope.token});
    mcp=await sessionFor(role);
    assert((await body('attach')).fenced);epoch++;
    assert.equal((await body('transition',{mode:'harness'})).mode,'harness');
    pulse=setInterval(()=>body('heartbeat').catch(()=>{}),2000);
    const status=await until('hosted voice ready',async()=>{const s=await rc('voice status QaKirito');return s.includes('VOICE_HOSTED_NPC_READY')&&s;});
    const one=await join('VoicePartnerQA'),two=await join('VoiceOtherQA');
    await rc('minecraft:execute in minecraft:overworld run minecraft:fill 298 198 294 348 198 298 minecraft:stone replace minecraft:air');
    await location('QaKirito',302.5);await location(one.bot.username,300.5);await location(two.bot.username,304.5);
    for(const p of [one,two])await rc('minecraft:gamemode survival '+p.bot.username);
    await sleep(7000);
    for(const p of [one,two]){
        const state=p.voice.state.players.get('QaKirito');
        assert(state && state.id===role.roleUuid.replaceAll('-','') && !state.disabled && !state.disconnected);
    }
    await check('two SVC clients see exact hosted body connected after a silent interval',{diagnostic:status.trim()});
    const beforeAudio=one.voice.state.audio;
    const rid='qa-'+randomUUID();
    const said=await body('call',{id:rid,tool:'say',args:{text:'我们在这里集合。'}});
    assert.equal(said.id,rid);
    assert(['partial','completed','accepted'].includes(said.state),JSON.stringify(said).slice(0,240));
    await until('Numen entity voice',()=>one.voice.state.audio-beforeAudio>12 && two.voice.state.audio>12,45000);
    await until('spoken text reaches player',()=>one.lines.some(s=>s.includes('我们在这里集合'))).catch(error=>{
        throw Error(error.message+JSON.stringify({mode:one.bot.game.gameMode,position:one.bot.entity.position,
            speakerVisible:!!one.bot.players[role.name]?.entity,nearbyMessages:one.lines.slice(-10),nativeReply:said}));
    });
    await check('native Numen speech reached two SVC clients and player text',{opusFrames:one.voice.state.audio-beforeAudio});
    const started=Date.now();
    await two.voice.speak(await read(path.join(lab,'plugins/NpcVoiceQA/microphone.json')));
    const observed=await until('real ASR delivered to this Numen or its explicitly addressed inbox',async()=>{
        const result=await body('observe');
        const rows=JSON.parse(result.text.match(/Native inbox snapshot[^\n]*?: (\[.*\])\s*$/s)?.[1]??'[]');
        const hit=rows.filter(r=>r.type==='qd_npc_dialogue').map(r=>JSON.parse(r.text)).find(e=>e.speakerId===two.bot.player.uuid && e.listenerId===role.roleUuid && e.channel==='voice' && e.occurredAt>=started);
        if(hit)return hit.text;
        for(const file of await fs.readdir(social)){
            if(!file.endsWith('-request.json'))continue;
            const q=await read(path.join(social,file));
            if(q.speakerId===two.bot.player.uuid && q.maidId===role.roleUuid && q.at>=started && q.message)return q.message;
        }
    },45000);
    await check('real microphone packets transcribed for exact listener',{transcript:observed});
    await sleep(1800);
    const initialPublic=one.voice.state.audio,initialPeer=two.voice.state.audio;
    await socialReply(one,'public','在路口等我'+token,'我在路口等你。');
    await until('scoped public reply voice',()=>one.voice.state.audio-initialPublic>10 && two.voice.state.audio-initialPeer>10,45000);
    await until('observer sees public reply',()=>two.lines.some(s=>s.includes('我在路口等你。')));
    await check('named public conversation returned text and scoped entity audio');
    await sleep(2000);
    const privateBefore=one.voice.state.privatePackets.length,otherPrivate=two.voice.state.privatePackets.length,near=two.voice.state.audio;
    await socialReply(one,'private','请悄悄回答'+token,'这是只给你的回答。');
    await until('private direct audio',()=>one.voice.state.privatePackets.length-privateBefore>10,45000);
    await sleep(2000);
    assert(!two.lines.some(s=>s.includes('这是只给你的回答。')));
    assert.equal(two.voice.state.privatePackets.length,otherPrivate);
    assert.equal(two.voice.state.audio,near);
    await check('private reply text and static SVC audio reached only the requester',{privateFrames:one.voice.state.privatePackets.length-privateBefore,bystanderPrivateFrames:0});
    await location(two.bot.username,342.5);
    await until('far listener standing forty blocks away',()=>Math.abs(two.bot.entity.position.x-342.5)<1);
    const farAudio=two.voice.state.audio,nearAudio=one.voice.state.audio;
    await body('call',{id:'qa-'+randomUUID(),tool:'say',args:{text:'请在门口集合。'}});
    await until('near listener receives the new line',()=>one.lines.some(s=>s.includes('请在门口集合'))
        && one.voice.state.audio-nearAudio>12,45000);
    await sleep(2000);
    assert.equal(two.voice.state.audio,farAudio);assert(!two.lines.some(s=>s.includes('请在门口集合')));
    await check('native speech and subtitles both respect the 24-block role range');
    assert(!one.voice.state.players.get('QaKirito').disconnected && one.voice.state.errors===0 && two.voice.state.errors===0);
    await check('both clients decode the protocol and keep the idle connected state');
    two.voice.close();
    const left=new Promise(resolve=>two.bot.once('end',resolve));
    two.bot.quit();await left;
    const again=await join('VoiceOtherQA');
    await until('rejoining listener receives the current SVC roster',()=>{
        const state=again.voice.state.players.get('QaKirito');
        return state && state.id===role.roleUuid.replaceAll('-','') && !state.disconnected && !state.disabled;
    });
    await check('listener reconnect receives Kirito connected while he is silent');
}finally{
    clearInterval(pulse);
    if(mcp){await body('release').catch(()=>{});await mcp.close();}
    for(const v of listeners)v.close();for(const bot of bots)bot.quit();
}
