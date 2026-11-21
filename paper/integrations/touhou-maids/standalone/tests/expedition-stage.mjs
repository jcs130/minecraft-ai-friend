// A real, disposable Youer world, the native body port and a normal survival connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { command } from '../../../../ops/rcon-client.mjs';

const [fixturePath, output] = process.argv.slice(2);
const { lab, ports, maid, leader, owner, synthetic } = JSON.parse(await fs.readFile(fixturePath));
assert.equal(synthetic, true);
assert.equal(await fs.readFile(path.join(lab, '.resident-hybrid-qa'), 'utf8'), 'SYNTHETIC_RESIDENT_HYBRID_ONLY');
const properties = path.join(lab, 'server.properties');
const props = await fs.readFile(properties, 'utf8');
assert(/^server-ip=127\.0\.0\.1\s*$/m.test(props) && ports[1] !== 25575);
assert(props.split(/\r?\n/).includes('rcon.port=' + ports[1]));
assert(maid.startsWith('10000000-') && owner.startsWith('20000000-'));
const rc = async text => (await command(text, 15000, { properties, port: ports[1] })).trim();
const require = createRequire(process.env.MINEFLAYER_ANCHOR ?? import.meta.url);
const mineflayer = require('mineflayer');
const token = (await fs.readFile(path.join(lab, 'private/maid.token'), 'utf8')).trim();
const envelope = { ownerId: owner, maidId: maid, controllerId: randomUUID() };
const post = async (operation, extra = {}) => {
    const response = await fetch('http://127.0.0.1:' + ports[2] + '/maid-body', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify({ ...envelope, operation, ...extra })
    });
    const reply = await response.json();
    assert.equal(response.status, 200, reply.code);
    return reply;
};
const act = async action => {
    const requestId = 'qa-' + randomUUID();
    const result = await post('call', { name: 'mc_maids', requestId, arguments: { action, requestId } });
    const reply = JSON.parse(result.result.content[0].text);
    assert(reply.ok, reply.reason); return reply;
};
const read = async (verb = 'status') => {
    const result = await rc('maidagent resident ' + maid + ' ' + verb);
    assert(result.startsWith('MC_RESIDENT '), result.slice(0,180));
    return JSON.parse(result.slice('MC_RESIDENT '.length));
};
const waitFor = async (predicate, label, timeout = 18_000) => {
    const end = Date.now() + timeout;
    let last, nextHeartbeat=Date.now()+15_000;
    while (Date.now() < end) {
        if (Date.now() >= nextHeartbeat) {
            await post('call', { name: 'mc_maids', arguments: { action: 'context' } });
            nextHeartbeat=Date.now()+15_000;
        }
        last = await read();
        if (predicate(last)) return last;
        await sleep(400);
    }
    throw Error(label + ' ' + JSON.stringify({ position: last.position, expedition: last.expedition }));
};
let bot;
async function join() {
    bot = mineflayer.createBot({ host: '127.0.0.1', port: ports[0], username: 'ExpeditionQA', auth: 'offline', version: '1.21.1' });
    await new Promise((resolve, reject) => {
        bot.once('spawn', resolve); bot.once('error', reject);
        bot.once('kicked', why => reject(Error(JSON.stringify(why)))); bot.once('end', why => reject(Error(why)));
    });
    assert((await rc('execute as ' + leader + ' if entity @s[name=ExpeditionQA] run data get entity @s UUID')).includes('[I;'));
}
const checks = [];
async function passed(label, details = {}) {
    checks.push({ label, ...details }); await fs.writeFile(output, JSON.stringify(checks, null, 2)); console.log(label);
}
const point = (world,x,y,z) => 'minecraft:execute in minecraft:' + world + ' run minecraft:tp ExpeditionQA ' + [x,y,z].join(' ');
try {
    await rc('gamerule doMobSpawning false'); await rc('gamerule doDaylightCycle false'); await rc('time set noon');
    for (const world of ['overworld','the_nether']) {
        const prefix = 'minecraft:execute in minecraft:' + world + ' run ';
        await rc(prefix + 'forceload add 288 288 336 304');
        await rc(prefix + 'fill 288 88 288 336 88 304 stone');
        await rc(prefix + 'fill 288 89 288 336 95 304 air');
    }
    await join(); await rc('minecraft:gamemode survival ExpeditionQA');
    await rc(point('overworld',300.5,89,296.5));
    await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+maid+' 301.5 89 296.5');
    await rc('execute at ' + maid + ' run companiontest position ' + maid + ' 301.5 89 296.5');
    const originalOwner = await rc('data get entity ' + maid + ' Owner');
    envelope.generation = (await post('bind')).generation;
    await act('guard');
    const snapshot = await waitFor(v => v.expedition.state === 'nearby', 'nearby');
    if (process.argv[4] === '--trial-only') await runTrial(snapshot);
    else await runTrial(await runJourney(snapshot, originalOwner));
} finally {
    if (envelope.generation) await post('release').catch(()=>{});
    if (bot) bot.quit();
}
async function runJourney(snapshot, originalOwner) {
    const originalTravel = snapshot.expedition.lastTravelRequestId;
    await passed('separate owner and live leader binding', { distance: snapshot.expedition.distanceBlocks });
    await rc(point('overworld',316.5,89,296.5));
    const walking = await waitFor(v => v.expedition.state === 'walking', 'walk');
    snapshot = await waitFor(v => v.expedition.distanceBlocks < 6, 'actual native approach',75_000);
    assert(snapshot.position.x > walking.position.x + 4 && snapshot.expedition.lastTravelRequestId === originalTravel);
    await passed('ordinary walking reduces actual distance without a spell', { from: walking.position, to: snapshot.position });

    await act('stay'); await rc(point('the_nether',315.5,89,296.5)); await sleep(6500);
    snapshot = await read(); assert.equal(snapshot.dimension,'minecraft:overworld');
    assert.equal(snapshot.expedition.state,'not_delegated');
    await passed('explicit stay survives leader changing dimension');
    await act('guard');
    snapshot = await waitFor(v => v.dimension === 'minecraft:the_nether' && v.expedition.distanceBlocks < 7, 'cross-world spell', 22_000);
    const id = snapshot.expedition.lastTravelRequestId;
    assert.notEqual(id, originalTravel);
    const receipt = await read('travel-receipt ' + id);
    assert.equal(receipt.leaderId, leader); assert.equal(receipt.completed,true); assert.equal(receipt.manaSpent,5);
    assert.equal(receipt.cooldownMs,60_000); assert.equal(receipt.maidId,maid);
    assert.equal(await rc('data get entity ' + maid + ' Owner'), originalOwner);
    await passed('durable original-spell receipt agrees with dimension, close position, mana and identity', { requestId:id, actual:snapshot.position });
    await rc(point('overworld',315.5,89,296.5)); await sleep(7500);
    snapshot=await read(); assert.equal(snapshot.dimension,'minecraft:the_nether'); assert.equal(snapshot.expedition.lastTravelRequestId,id);
    await passed('cooldown prevents another transfer');
    bot.quit(); bot=null;
    await waitFor(v => v.expedition.state === 'leader_unavailable', 'offline');
    await passed('offline leader releases follow navigation');
    await join(); await rc('minecraft:gamemode spectator ExpeditionQA');
    await waitFor(v => v.expedition.state === 'leader_unavailable', 'spectator');
    await passed('spectator leader is ineligible');
    await rc('minecraft:gamemode survival ExpeditionQA');
    // One high, isolated block has no standing destination in the spell radius.
    await rc('execute in minecraft:overworld run fill 308 168 289 322 180 303 air');
    await rc('execute in minecraft:overworld run setblock 315 170 296 stone');
    await rc(point('overworld',315.5,171,296.5));
    snapshot=await waitFor(v => v.expedition.lastTravelObstacle === 'travel_no_permitted_safe_landing'
        || v.expedition.state === 'travel_no_permitted_safe_landing','unsafe landing',100_000);
    assert.equal(snapshot.expedition.lastTravelRequestId,id); assert.equal(snapshot.dimension,'minecraft:the_nether');
    await passed('unsafe destination leaves the original body and receipt intact');
    await rc(point('overworld',315.5,89,296.5));
    snapshot=await waitFor(v=>v.dimension==='minecraft:overworld'&&v.expedition.distanceBlocks<7,'safe return',48_000);
    assert.notEqual(snapshot.expedition.lastTravelRequestId,id);
    await passed('safe landing restored and spell-based reunion resumes');
    return snapshot;
}
async function runTrial(snapshot) {
    const beforeTrial = snapshot.expedition.lastTravelRequestId;
    await act('stay');
    // The leader enters with the actual player command and regular loadout.
    for (const [slot, item] of Object.entries({head:'iron_helmet',torso:'iron_chestplate',legs:'iron_leggings',feet:'iron_boots'})) {
        await rc('minecraft:give ExpeditionQA minecraft:'+item);
        await bot.waitForTicks(3);
        const stack=bot.inventory.items().find(stack => stack.name===item);
        assert(stack,'supplied fixture armor '+item);
        await bot.equip(stack,slot);
    }
    for (const stack of ['iron_sword','bow','arrow 32']) await rc('minecraft:give ExpeditionQA minecraft:'+stack);
    await rc('minecraft:effect give ExpeditionQA resistance 140 4 true');
    // The disposable world's admitted tower has no terrain. Supply a lobby
    // foothold and a walkable first floor so the genuine game encounter can run.
    await rc('minecraft:forceload add -602 -317 -578 -293');
    await rc('minecraft:fill -593 90 -315 -588 90 -310 stone replace air');
    await rc('minecraft:fill -601 68 -316 -579 68 -294 stone replace air');
    await rc('minecraft:fill -602 76 -317 -578 76 -293 stone replace air');
    for (const x of [-591,-589]) await rc('minecraft:fill '+x+' 69 -306 '+x+' 70 -304 glass replace air');
    for (const z of [-306,-304]) await rc('minecraft:fill -590 69 '+z+' -590 70 '+z+' glass replace air');
    await rc(point('overworld',-590.5,91,-312.5));
    let guidance;
    bot.on('messagestr', message => {
        const prefix='MC_TRIAL_STATE ';
        if (message.startsWith(prefix)) guidance=JSON.parse(message.slice(prefix.length));
    });
    const admissionEnd=Date.now()+185_000;
    let heartbeat=Date.now()+15_000;
    do {
        bot.chat('/mycli arena status --json');
        await sleep(900);
        if(Date.now()>=heartbeat) {
            await post('call',{name:'mc_maids',arguments:{action:'context'}});
            heartbeat=Date.now()+15_000;
        }
        if(guidance?.canStart) break;
        if(guidance && !/cooldown|rest/i.test(guidance.reason)) break;
    } while(Date.now()<admissionEnd);
    assert(guidance?.canStart, 'trial preflight: '+JSON.stringify(guidance));
    await act('stay'); // keep the test controller's current lease after a tower cooldown
    bot.chat('/mycli arena start');
    for(let tries=0;tries<12 && !(guidance?.participant && guidance?.remainingMobs>0); tries++) {
        await sleep(850);
        bot.chat('/mycli arena status --json');
    }
    assert(guidance?.participant && guidance?.floor === 1 && guidance?.selfFloor === 1 && guidance?.remainingMobs > 0,
        'trial admission: '+JSON.stringify(guidance));
    await act('guard');
    snapshot=await waitFor(v=>v.expedition.lastTravelRequestId!==beforeTrial && v.expedition.distanceBlocks<8,'arrival in active trial',100_000);
    const arrival=await read('travel-receipt '+snapshot.expedition.lastTravelRequestId);
    assert(arrival.completed && arrival.manaSpent===5 && arrival.leaderId===leader);
    const at=snapshot.position;
    assert(Math.abs(at.x+590)<12 && Math.abs(at.z+305)<12 && at.y>=68 && at.y<=75, JSON.stringify(at));
    const beside=await rc('minecraft:execute as '+maid+' at @s if entity @a[name=ExpeditionQA,distance=..8] if entity @e[tag=afu_dungeon_mob,distance=..26] run data get entity @s Pos');
    assert(beside.includes('['),beside);
    await passed('companion reaches the enrolled leader and live trial monsters inside floor one', {floor:guidance.floor, remainingMobs:guidance.remainingMobs, actual:at, requestId:arrival.requestId});
    bot.chat('/mycli arena leave');
    await sleep(500);
}
