import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';

const stage = resolve(process.env.DUNGEON_READINESS_STAGE);
const baseline = process.argv.includes('--baseline');
assert.equal(await readFile(resolve(stage, '.readiness-qa'), 'utf8'), 'SYNTHETIC_DUNGEON_READINESS_ONLY');
const properties = resolve(stage, 'server.properties');
const settings = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const value of ['server-ip=127.0.0.1','server-port=25928','rcon.port=25929']) assert(settings.includes(value));
const fixture = JSON.parse(await readFile(resolve(stage, 'fixture.json'), 'utf8'));
assert(fixture.synthetic && fixture.username === 'MaidBrainQA');
const {createBot} = createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const bots = [];
const report = {baseline, synthetic: true, checks: []};
const rc = async text => {
    const result = await command(text, 12000, {port:25929, properties});
    assert(!result.includes('fixture_error=') && !result.includes('An internal error occurred'), result);
    return result.trim();
};
const mc = text => rc('minecraft:' + text);
const check = (name, value) => {
    report.checks.push({name, passed:Boolean(value)});
    console.log((value ? 'PASS ' : 'FAIL ') + name);
    assert(value, name);
};
async function until(read, reason, timeout = 23000) {
    for (const end = Date.now() + timeout; Date.now() < end;) {
        const value = await read();
        if (value) return value;
        await delay(150);
    }
    throw Error('Timed out: ' + reason);
}
async function connect(username) {
    const bot = createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',hideErrors:true,physicsEnabled:false});
    bots.push(bot);
    bot.lines = [];
    bot.on('messagestr', line => bot.lines.push(line));
    bot.on('error', error => { bot.failure = error.message; });
    installRecipePacketBypass(bot._client);
    await until(() => bot.entity && bot.player?.uuid, 'client ' + username, 45000);
    return bot;
}
async function say(bot, text, matching) {
    await delay(Math.max(0, 1150 - (Date.now() - (bot.sent ?? 0))));
    const mark=bot.lines.length;
    bot.sent=Date.now();
    bot.chat(text);
    return until(() => bot.lines.slice(mark).find(line=>matching.test(line)), text);
}
async function gear(bot, weapon = 'iron_sword') {
    await mc('clear '+bot.username);
    for (const [slot,item] of [['head','helmet'],['chest','chestplate'],['legs','leggings'],['feet','boots']])
        await mc(`item replace entity ${bot.username} armor.${slot} with minecraft:iron_${item}`);
    await mc(`give ${bot.username} minecraft:${weapon}`);
}
async function y(entity) {
    const result=await mc('data get entity '+entity+' Pos');
    return Number(result.match(/\[\s*-?[\d.]+d?,\s*(-?[\d.]+)d?,/)?.[1]);
}
function ints(id) {
    const compact=id.replaceAll('-','');
    return [0,8,16,24].map(index=>parseInt(compact.slice(index,index+8),16)|0).join(',');
}
function recovered(receipt) {
    const fields=Object.fromEntries(receipt.split(' ').map(pair=>pair.split('=')));
    return ['health','mana'].every(key=>{
        const [current,maximum]=fields[key].split('/').map(Number);
        return current===maximum&&maximum>0;
    }) && fields.fire==='0' && fields.poison==='false' && fields.speed==='true' && fields.bleed==='false' && fields.ward==='true';
}
const visibleMob = async (name, tag) => Number((await mc(
    `execute at ${name} run data get entity @e[tag=${tag},distance=..24,limit=1] Health`
)).match(/([\d.]+)f\s*$/)?.[1])>0;
async function playTower(owner) {
    const name=owner.username;
    const maid=fixture.maid;
    await mc('gamerule doMobSpawning false');
    await mc('gamerule keepInventory true');
    await mc(`tp ${name} -595.5 92 -312.5`);
    await mc('effect give '+name+' minecraft:resistance infinite 4 true');
    // The source fixture keeps both consecutive rooms physically separate.
    for (const floorY of [56,68]) {
        await mc(`fill -601 ${floorY} -316 -579 ${floorY} -294 minecraft:stone`);
        await mc(`fill -599 ${floorY+1} -314 -581 ${floorY+3} -296 minecraft:air`);
    }
    await gear(owner);
    if (!baseline) {
        check('sword alone refused at the real tower entrance',
            (await say(owner,'/mycli arena start',/无法入场/)).includes('远程'));
        await mc('give '+name+' minecraft:bow');
        check('unloaded bow cannot satisfy the ranged slot',
            (await say(owner,'/mycli arena start',/无法入场/)).includes('弹药'));
        await mc('give '+name+' minecraft:arrow 16');
    }
    await mc(`summon touhou_little_maid:maid -593.5 92 -312.5 {UUID:[I;${ints(maid)}],Owner:[I;${ints(fixture.owner)}],CustomName:'"SyntheticTrialMaid"',PersistenceRequired:1b,Invulnerable:1b}`);
    await mc(`data modify entity ${maid} NeoForgeData.qiandengji_follow set value {schemaVersion:1,walkDistance:20,stopDistance:16,returnDistance:64}`);
    const start=await say(owner,'/mycli arena start',/^MC_DUNGEON_START /);
    check(baseline?'old tower admits a sword-only player':'melee and loaded ranged kit opens the trial',start.includes('floor=1'));
    await until(async()=>Math.abs(await y(maid)-69)<3,'companion entered floor one');
    check('original companion alive at the entrance floor', Number((await mc(`data get entity ${maid} Health`)).match(/([\d.]+)f\s*$/)?.[1])>0);
    const tag='afu_dungeon_mob';
    await until(()=>visibleMob(name,tag),'tower enemies');
    if (!baseline) {
        await rc(`dailyqa clear-state ${name} arm`);
        const armed=await until(async()=>{
            const result=await rc('dailyqa clear-state '+name);
            return result.includes('bleed=true')&&result.includes('ward=true')&&result;
        },'tower negative and positive states installed');
        check('combat leaves real HP, mana and status to recover',/health=([\d.]+)\//.test(armed)&&armed.includes('poison=true'));
    }
    const mark=owner.lines.length;
    // The source of the encounter clear is actual mob death in the loaded room.
    await mc(`execute at ${name} run kill @e[tag=${tag},distance=..24]`);
    if (!baseline) {
        const receipt=await until(()=>owner.lines.slice(mark).find(line=>line.startsWith('MC_DUNGEON_RECOVERY encounter=trial_tower stage=1')),'tower clear recovery',6500);
        report.towerRecovery={receipt,state:await rc('dailyqa clear-state '+name)};
        check('clear restores real health and mana, removes harmful effects and preserves buffs while still on floor one',
            recovered(report.towerRecovery.state) && Math.abs(await y(name)-69)<3);
    }
    await until(async()=>Math.abs(await y(name)-57)<3,'official 12-block next-floor transfer');
    if (baseline) {
        check('old companion remains on floor one after the 12-block transfer',Math.abs(await y(maid)-69)<3);
    } else {
        check('same companion arrives with the owner on floor two',
            await until(async()=>Math.abs(await y(maid)-57)<3,'companion floor two',3500));
    }
    report.towerPositions={ownerY:await y(name),companionY:await y(maid)};
    await say(owner,'/mycli arena leave',/已返回地面/);
}

async function playSite() {
    const bot=await connect('ag_RUReadyA');
    await mc('forceload add 2994 2394 3020 2406');
    await until(async()=>!(await mc('execute positioned 3000 81 2400 run setblock ~ ~-1 ~ minecraft:stone')).includes('not loaded'),'site fixture chunk');
    await mc('fill 2994 80 2394 3020 80 2406 minecraft:stone');
    await mc('fill 2994 81 2394 3020 85 2406 minecraft:air');
    await mc('tp '+bot.username+' 3000.5 81 2400.5');
    await mc('effect give '+bot.username+' minecraft:resistance infinite 4 true');
    await gear(bot);
    const site='qa_readiness';
    const start=async()=>JSON.parse((await say(bot,'/mycli dungeon start '+site+' --json',/^MC_SITE_DUNGEON_RESULT /)).split('MC_SITE_DUNGEON_RESULT ')[1]);
    check('site dungeon gives a precise ranged-gear rejection',(await start()).reason==='equipment_required');
    await say(bot,'/mycli profession choose mage --json',/^MC_RPG /);
    await delay(500);
    const preview=await say(bot,'/mycli dungeon status '+site+' --json',/^MC_SITE_DUNGEON_STATE /);
    check('real mage starter staff meets the ranged requirement',JSON.parse(preview.slice(preview.indexOf(' {')+1)).guidance?.missingEquipment?.length===0);
    check('mage with melee backup can open the site run',(await start()).success);
    const tag='afu_site_'+site;
    await until(()=>visibleMob(bot.username,tag),'site enemies');
    await rc('dailyqa clear-state '+bot.username+' arm');
    await until(async()=> (await rc('dailyqa clear-state '+bot.username)).includes('ward=true'),'site statuses present');
    const mark=bot.lines.length;
    await rc(`minecraft:execute at ${bot.username} as @e[tag=${tag},distance=..24] run damage @s 1000 minecraft:player_attack by ${bot.username}`);
    const receipt=await until(()=>bot.lines.slice(mark).find(line=>line.startsWith('MC_DUNGEON_RECOVERY encounter='+site+' stage=1')),'site clear recovery',11000);
    report.siteRecovery={receipt,state:await rc('dailyqa clear-state '+bot.username)};
    check('clearing the site room recovers before moving rooms',recovered(report.siteRecovery.state)&&Math.abs(await y(bot.username)-81)<1);
}

try {
    const owner=await connect(fixture.username);
    check('actual client uses synthetic original owner UUID',owner.player.uuid===fixture.owner);
    await playTower(owner);
    if (!baseline) await playSite();
    check('ordinary Java connections remain healthy',bots.every(bot=>!bot.failure));
} catch(error) {
    report.error=String(error);
    report.lastMessages=bots.map(bot=>({name:bot.username,lines:bot.lines.slice(-20)}));
    process.exitCode=1;
    console.error(error);
} finally {
    for (const bot of bots) bot.quit();
    await writeFile(resolve(stage,'dungeon-readiness.proof.json'),JSON.stringify(report,null,2)+'\n');
}
