// Real Numen + Java client on the existing, marked resident fixture.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const [fixture,report]=process.argv.slice(2);
const {lab,ports,synthetic}=JSON.parse(await readFile(fixture,'utf8'));
const properties=lab+'/server.properties';
assert(synthetic && (await readFile(lab+'/.resident-hybrid-qa','utf8')).trim()==='SYNTHETIC_RESIDENT_HYBRID_ONLY');
const config=(await readFile(properties,'utf8')).split(/\r?\n/);
assert(config.includes('server-ip=127.0.0.1') && config.includes('rcon.port='+ports[1]) && ports[1]!==25575);
const rc=cmd=>command(cmd,7000,{properties,port:ports[1]});
const nativeId='10000000-0000-0000-0000-000000000011',host='TrialPartyHostQA';
assert((await rc('voice status QaKirito')).includes('VOICE_HOSTED_NPC_READY'),'real native body must be ready');
assert((await rc('mycli admin dungeonaudit')).includes('towerActive=false'),'synthetic tower must be idle');
const mineflayer=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const bot=mineflayer.createBot({host:'127.0.0.1',port:ports[0],username:host,version:'1.21.1',auth:'offline'});
installRecipePacketBypass(bot._client);
const lines=[];
bot.on('messagestr',s=>lines.push(s));
async function readAfter(cmd,prefix){
    const begin=lines.length;bot.chat(cmd);
    for(let end=Date.now()+12000;Date.now()<end;){
        const line=lines.slice(begin).find(s=>s.startsWith(prefix+' '));
        if(line)return JSON.parse(line.slice(prefix.length+1));
        await wait(100);
    }
    throw Error('Missing '+prefix+' for '+cmd);
}
try{
    await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);});
    // Both bodies and the missing helmet belong exclusively to this disposable fixture.
    await rc('minecraft:execute in minecraft:overworld run minecraft:fill -585 90 -315 -582 90 -312 minecraft:stone replace minecraft:air');
    for(const [name,x] of [[host,-583.5],['QaKirito',-584.5]]){
        await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+name+' '+x+' 91 -313.5');
        await rc('minecraft:gamemode survival '+name);
    }
    await rc('minecraft:item replace entity QaKirito armor.head with minecraft:air');
    await wait(500);
    const before=await readAfter('/mycli arena start','MC_TRIAL_ASSEMBLY');
    const warning=before.members.find(m=>m.uuid===nativeId);
    assert.equal(before.phase,'confirmation_required');assert.equal(before.enteredCount,0);
    assert(warning?.canEnterOnConfirmation && warning.missingEquipment.includes('头盔'));
    const after=await readAfter(before.nextCommand,'MC_TRIAL_ASSEMBLY');
    assert(after.runStarted && after.enteredCount===2);
    for(const uuid of [bot.player.uuid,nativeId])assert.equal(after.members.find(m=>m.uuid===uuid)?.status,'entered');
    const pos=await rc('minecraft:data get entity QaKirito Pos');
    assert.match(pos,/\[\s*-?\d+(?:\.\d+)?d?,\s*69(?:\.0+)?d?,/);
    const state=await readAfter('/mycli arena status --json','MC_TRIAL_STATE');
    assert(state.participant && state.run);
    await writeFile(report,JSON.stringify({warning,after,position:pos.trim(),run:state.run},null,2));
    console.log('Verified the original Numen and a Java player reached floor one together after confirmation');
}finally{
    if(bot.player)bot.chat('/mycli arena leave');
    await rc('minecraft:execute as QaKirito run mycli arena leave').catch(()=>{});
    await wait(250);
    bot.quit();
}
