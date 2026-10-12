// Isolated real Proxy/Worker/Paper/Geyser integration. A protocol fixture cannot
// establish phone/Xbox GPU behavior. It downloads every offered byte before ACK.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from '../../ops/minecraft-1206-potion.mjs';
const stage=process.env.MC_YSM_STAGE,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
const be=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM)('bedrock-protocol');
const require=createRequire(process.env.MC_TEST_MINEFLAYER_REQUIRE_FROM);
fix1206PotionProtocol(require);
const mf=require('mineflayer'),nbt=require('prismarine-nbt');
const hash=b=>createHash('sha256').update(b).digest('hex');
const props=await fs.readFile(stage+'/paper/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const geyser=await fs.readFile(stage+'/paper/plugins/Geyser-Spigot/config.yml','utf8');assert.match(geyser,/^ {2}address: 127\.0\.0\.1\r?$/m);
const rc=q=>command(q,15000,{properties:stage+'/paper/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)[1])});
const report={scope:'isolated real resource download/player properties/native movement/equipment, no device pixels',checks:[],errors:[],packDownloads:[],definitions:[],events:[]};
const check=(why,v)=>{assert(v,why);report.checks.push(why);console.log('PASS '+why);};
async function until(fn,why,ms=45000){let end=Date.now()+ms;while(Date.now()<end){if(await fn())return;if(report.errors.length)throw Error(report.errors.at(-1));await sleep(80);}throw Error('Timeout: '+why);}
async function admin(q){await fs.writeFile(root+'/commands.json',JSON.stringify([{service:'velocity',command:q}]),{flag:'wx'});await until(async()=>{try{await fs.access(root+'/commands.json');return false;}catch{return true;}},'console receipt');}
const state=async()=>JSON.parse(await fs.readFile(stage+'/paper/plugins/Geyser-Spigot/extensions/ysmbedrock/status.json','utf8'));
function offeredUuid(value){let b=Buffer.from(value.replaceAll('-',''),'hex');b.subarray(0,8).reverse();b.subarray(8,16).reverse();let s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
let bot,client,closing=false,attempt=0,entityId,uuid,spawned=false,downloaded=false,revision,packInfo,properties=[],restoreGeometry;
const safe=fn=>(...a)=>{try{fn(...a);}catch(e){report.errors.push(e.stack??String(e));}};
async function connectBedrock(){
    spawned=false;downloaded=false;properties=[];entityId=undefined;const label=++attempt;
    client=be.createClient({host:'127.0.0.1',port:Number(geyser.match(/^ {2}port: (\d+)/m)[1]),version:'1.26.51',offline:true,username:'BedrockQA10',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
    client.on('session',p=>{p.xuid='9000000000010';});client.on('spawn',()=>spawned=true);
    client.on('error',e=>report.errors.push('BE '+e.message));client.on('disconnect',p=>{if(!closing)report.errors.push('BE disconnect '+JSON.stringify(p));});
    const wire=client.write.bind(client),downloads=new Map();let offer;
    client.write=(name,p)=>name==='resource_pack_client_response'?undefined:wire(name,p);
    const response=(status,ids=[])=>wire('resource_pack_client_response',{response_status:status,response_status_name:{completed:'resourcepackstackfinished',send_packs:'downloading',have_all_packs:'downloadingfinished'}[status],resourcepackids:ids});
    client.on('resource_packs_info',safe(p=>{offer=p;assert(p.must_accept);response('send_packs',p.texture_packs.map(x=>offeredUuid(x.uuid)+'_'+x.version));}));
    client.on('resource_pack_data_info',safe(p=>{assert(Number(p.size)<32*1024*1024);downloads.set(p.pack_id,{info:p,chunks:new Map()});for(let i=0;i<p.chunk_count;i++)wire('resource_pack_chunk_request',{pack_id:p.pack_id,chunk_index:i});}));
    client.on('resource_pack_chunk_data',safe(p=>{let row=downloads.get(p.pack_id);assert(row);const b=Buffer.from(p.payload);if(row.chunks.has(p.chunk_index)){assert(row.chunks.get(p.chunk_index).equals(b));return;}row.chunks.set(p.chunk_index,b);
        if(row.chunks.size===row.info.chunk_count){row.bytes=Buffer.concat(Array.from({length:row.info.chunk_count},(_,i)=>row.chunks.get(i)));assert.equal(row.bytes.length,Number(row.info.size));assert.equal(hash(row.bytes),Buffer.from(row.info.hash).toString('hex'));report.packDownloads.push({attempt:label,id:p.pack_id,sha:hash(row.bytes),bytes:row.bytes.length});fs.writeFile(root+`/download-${label}-${report.packDownloads.length}.mcpack`,row.bytes).catch(e=>report.errors.push(String(e)));}
        if(!downloaded&&downloads.size===offer.texture_packs.length&&[...downloads.values()].every(x=>x.bytes)){downloaded=true;response('have_all_packs');}}));
    client.on('resource_pack_stack',safe(()=>{assert(downloaded);response('completed');}));
    client.on('sync_entity_property',p=>report.definitions.push(nbt.simplify(p.nbt)));
    client.on('add_player',p=>{if(p.username==='YsmAgent10')entityId=String(p.runtime_id??p.runtime_entity_id);});
    // Ignore unrelated mobs: their movement metadata must not fill the receipt
    // buffer before the later expiry/reconnect assertions run.
    client.on('set_entity_data',p=>{if(String(p.runtime_entity_id)===entityId&&properties.length<4000)properties.push(p);});
    for(const n of ['move_player','animate','mob_equipment'])client.on(n,p=>{if(String(p.runtime_entity_id??p.runtime_id)===entityId&&report.events.length<1000)report.events.push({attempt:label,type:n,entity:String(p.runtime_entity_id??p.runtime_id),action:p.action_id??p.action,item:p.item,position:p.position});});
    await until(()=>spawned&&downloaded,'real Bedrock spawn');
    // Keep QA outside the village's invincibility / protected gameplay regions.
    await rc('minecraft:fill 996 79 996 1004 79 1004 minecraft:stone');
    await rc('minecraft:tp .BedrockQA10 1000.5 80 1004.5');await rc('minecraft:tp YsmAgent10 1000.5 80 1000.5');
    await until(()=>entityId&&entityId!=='undefined','actual Agent entity');
}
function latestSlot(){return properties.filter(p=>String(p.runtime_entity_id)===entityId&&p.properties?.ints?.some(i=>i.index===0)).at(-1)?.properties.ints.find(p=>p.index===0)?.value;}
try {
    await until(async()=>{const s=await state();return s.delivery==='resource_pack'&&s.variants>0;},'pack compiler ready',90000);
    check('resource-pack adapter enabled',(await state()).enabled);
    bot=mf.createBot({host:'127.0.0.1',port:25642,username:'YsmAgent10',auth:'offline',version:'1.20.6'});installRecipePacketBypass(bot._client);
    bot.on('error',e=>report.errors.push('Java '+e.message));bot.on('kicked',e=>{if(!closing)report.errors.push('Java kick '+JSON.stringify(e));});
    await new Promise((res,rej)=>{bot.once('spawn',res);bot.once('error',rej);setTimeout(()=>rej(Error('Java spawn timeout')),35000).unref();});uuid=bot.player.uuid;
    await admin('appearance admin set YsmAgent10 cormy-winefox-cream cormy-cream');
    await until(async()=>{const s=JSON.parse(await fs.readFile(stage+'/appearance-state.json','utf8'));return s.players.some(p=>p.playerUuid===uuid&&p.available&&p.modelId==='cormy-winefox-cream');},'Worker-confirmed assignment');
    await connectBedrock();revision=(await state()).packRevision;
    const expected=hash(await fs.readFile(stage+'/paper/plugins/Geyser-Spigot/extensions/ysmbedrock/generated-packs/'+revision+'.mcpack'));
    check('full generated pack downloaded through existing UDP',report.packDownloads.some(p=>p.attempt===1&&p.sha===expected));
    await until(()=>latestSlot()>0,'per-player model property');
    check('real player has selected model property',latestSlot()>0);
    check('same original Java UUID retained',uuid==='61f4c0fe-b186-3fb9-bb66-a9529a411783');
    const definitions=report.definitions;check('native player properties registered',JSON.stringify(definitions).includes('qdysm:model'));
    const slot=latestSlot();
    await rc('minecraft:give YsmAgent10 minecraft:torch 1');await until(()=>bot.inventory.items().some(i=>i.name==='torch'),'torch slot update');await bot.equip(bot.inventory.items().find(i=>i.name==='torch'),'hand');await sleep(350);
    const before=report.events.length;bot.swingArm('right');await sleep(600);bot.setControlState('forward',true);await sleep(650);bot.clearControlStates();await rc('minecraft:give YsmAgent10 minecraft:iron_sword 1');await until(()=>bot.inventory.items().some(i=>i.name==='iron_sword'),'sword slot update');await bot.equip(bot.inventory.items().find(i=>i.name==='iron_sword'),'hand');
    await until(()=>report.events.slice(before).some(e=>e.type==='animate'&&e.entity===entityId),'native attack event');
    await until(()=>report.events.slice(before).some(e=>e.type==='move_player'&&e.entity===entityId),'native movement event');
    await until(()=>report.events.slice(before).some(e=>e.type==='mob_equipment'&&e.entity===entityId),'native equipment event');
    check('native attack, movement and equipment packets remain on real player',true);
    const messages=[];const onMessage=m=>messages.push(m);bot.on('messagestr',onMessage);bot.chat('/mycli help');await until(()=>messages.some(m=>m.includes('mycli')||m.includes('命令')),'ordinary Agent CLI reply');bot.off('messagestr',onMessage);
    check('normal Agent CLI stays responsive',bot.entity.isValid&&bot.player.uuid===uuid);
    report.foodSetup=[await rc('minecraft:gamemode survival YsmAgent10'),await rc('minecraft:effect give YsmAgent10 minecraft:hunger 30 200 true'),await rc('minecraft:give YsmAgent10 minecraft:bread 1')];
    await until(()=>bot.food<20&&bot.inventory.items().some(i=>i.name==='bread'),'real food slot and hunger update');await rc('minecraft:effect clear YsmAgent10 minecraft:hunger');await bot.equip(bot.inventory.items().find(i=>i.name==='bread'),'hand');
    const useStart=properties.length;bot.activateItem();
    await until(()=>properties.slice(useStart).some(p=>String(p.runtime_entity_id)===entityId&&p.metadata?.some(m=>m.key==='flags'&&m.value?.action)),'native item use metadata');bot.deactivateItem();
    check('real eating sends native item-use metadata to Bedrock',true);
    // A stale authoritative source must restore the vanilla branch, never freeze a fake model.
    const cfg=stage+'/velocity/plugins/agentappearance/models.json',saved=await fs.readFile(cfg,'utf8'),options=JSON.parse(saved);
    try {
        options.bedrockStateFile=stage+'/paused-state.json';await fs.writeFile(cfg,JSON.stringify(options));
        await until(()=>latestSlot()===0,'expired state restoration',35000);check('expired Worker state restores vanilla geometry property',true);
    } finally {await fs.writeFile(cfg,saved);}
    await until(()=>latestSlot()===slot,'fresh native state resume');check('fresh state resumes model without client reconnect',true);
    closing=true;client.close();await sleep(1600);closing=false;await connectBedrock();await until(()=>latestSlot()===slot,'reconnect binding');check('Bedrock reconnect pins downloaded pack and rebinds same player',true);
    const geometryFile=stage+'/worker/config/yes_steve_model/custom/cormy-winefox-cream/models/main.json';
    restoreGeometry=await fs.readFile(geometryFile);
    const changed=JSON.parse(restoreGeometry.toString());changed['minecraft:geometry'][0].description.visible_bounds_width+=0.001;
    await fs.writeFile(geometryFile,JSON.stringify(changed));
    await until(async()=>(await state()).packRevision!==revision,'upload automatically rebuilds pack',60000);
    check('replacing a model automatically builds a new immutable resource pack',(await state()).packRevision!==revision);
    await until(()=>latestSlot()===0,'old connection cannot use updated source slot');check('old connection restores vanilla until new pack is downloaded',true);
    closing=true;client.close();await sleep(1600);closing=false;await connectBedrock();await until(()=>latestSlot()>0,'updated pack selected');
    const newRevision=(await state()).packRevision,newHash=hash(await fs.readFile(stage+'/paper/plugins/Geyser-Spigot/extensions/ysmbedrock/generated-packs/'+newRevision+'.mcpack'));
    check('reconnect downloads exact updated pack and applies new model',report.packDownloads.some(p=>p.attempt===3&&p.sha===newHash));
    // Exercise real player death/respawn and cache replacement, not a manually
    // fabricated entity instance. The same account must remain selected.
    let respawns=0,deaths=0;bot.on('spawn',()=>respawns++);bot.on('death',()=>deaths++);
    await rc('minecraft:fill 996 79 996 1004 79 1004 minecraft:stone');await rc('minecraft:tp YsmAgent10 1000.5 80 1000.5');await sleep(350);
    report.killReply=await rc('minecraft:kill YsmAgent10');await until(()=>deaths>0&&respawns>0&&bot.health>0,'real death and respawn events',30000);
    await rc('minecraft:tp YsmAgent10 1000.5 80 1000.5');await until(()=>latestSlot()>0,'respawn property binding');
    check('real death/respawn preserves original identity and model binding',bot.entity.isValid&&bot.player.uuid===uuid&&deaths>0&&respawns>0);
    report.finalStatus=await state();report.properties=properties;report.uuid=uuid;
} catch(e){report.errors.push(e.stack??String(e));}
finally {
    report.properties=properties;report.entityId=entityId;report.lastSlot=latestSlot();report.botHealth=bot?.health;try{report.finalStatus=await state();}catch{}
    closing=true;client?.close();bot?.quit('isolated Bedrock pack check complete');await sleep(700);
    if(restoreGeometry)await fs.writeFile(stage+'/worker/config/yes_steve_model/custom/cormy-winefox-cream/models/main.json',restoreGeometry);
    report.passed=report.errors.length===0;await fs.writeFile(root+'/integration-'+run+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2),{flag:'wx'});
    console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);
}
