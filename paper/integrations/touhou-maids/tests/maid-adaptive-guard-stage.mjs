import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createMaidPort} from '../agent/maid-port.mjs';
import {receiver} from './svc-receiver.mjs';

const [label, scenario] = process.argv.slice(2);
assert.match(label, /^[a-z0-9-]+$/);
assert(['baseline', 'combat', 'voice', 'restart'].includes(scenario));
assert.equal(await readFile('.maid-adaptive-guard-qa', 'utf8'), 'SYNTHETIC_MAID_GUARD_ONLY');
const properties = resolve('server.properties');
const settings = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const setting of ['server-ip=127.0.0.1', 'server-port=26304', 'rcon.port=26305']) assert(settings.includes(setting));
const fixture = JSON.parse(await readFile('fixture.json', 'utf8'));
assert(fixture.synthetic && fixture.username === 'MaidBrainQA');
const {command} = await import(process.env.MAID_VORTEX_RCON);
const {createBot} = createRequire(process.env.MAID_VORTEX_JAVA)('mineflayer');
const {maid, username} = fixture;
const rc = async line => (await command(line, 9000, {port:26305, properties})).trim();
const mc = line => rc('minecraft:' + line);
const data = (id, path) => mc(`data get entity ${id} ${path}`);
const control = (action, arg = username) => rc(`maidvortexqa ${action} ${maid} ${arg}`);
const report = {synthetic:true, scenario, checks:[], requests:[]};
const servers = [];
let bot, port, peer, seq = 0, modelMode = 'magic';
const check = (name, value) => {
    report.checks.push({name, passed:!!value});
    console.log(`${value ? 'PASS' : 'FAIL'} ${name}`);
    assert(value, name);
};
async function until(probe, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await probe();
        if (result) return result;
        await delay(100);
    }
    return null;
}
const ask = (action, extra = {}) => port.request({action, maidId:maid, requestId:`guard-${label}-${++seq}`, ...extra});
const context = async () => (await ask('context')).data;
const companion = async () => (await context()).companion;
const health = async () => Number((await data('@e[tag=MaidMagicTargetQA,limit=1]', 'Health')).match(/([0-9.]+)f$/)?.[1]);
const hand = async () => (await data(maid, 'HandItems[0].id')).match(/"([^"]+)"/)?.[1];
const task = async () => (await data(maid, 'MaidTask')).match(/"([^"]+)"/)?.[1];
const inventory = async () => (await ask('inventory')).data?.slots ?? [];
const original = async () => (await inventory()).filter(item => item.id === 'minecraft:fishing_rod').length;
const staffPacked = async () => (await inventory()).some(item => item.id === 'minecraft:blaze_rod');
const clear = () => mc('kill @e[tag=MaidMagicTargetQA]');
async function target(x, extra = 'fixture_enemy', y = 90) {
    await clear();
    await mc(`summon minecraft:zombie ${x} ${y} 301.5 {Tags:["MaidMagicTargetQA","${extra}"],PersistenceRequired:1b,Silent:1b,CanPickUpLoot:0b}`);
    await control('target');
    return health();
}
async function listen(port, handler) {
    const server = createServer(handler);
    await new Promise((accept, reject) => server.once('error', reject).listen(port, '127.0.0.1', accept));
    servers.push(server);
}
async function jsonBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks));
}

try {
    if (scenario === 'combat') await listen(26308, async (request, response) => {
        const input = await jsonBody(request);
        const keys = Object.keys(input.questions.mode.criteria).sort();
        const row = {keys, mode:modelMode, distance:input.state.distance, currentMode:input.state.currentMode,
            keysOfState:Object.keys(input.state).sort()};
        report.requests.push(row);
        let output;
        if (modelMode === 'timeout') {
            await delay(1400);
            output = {choice:'melee', confidence:.99, probabilities:{magic:.01, melee:.99}};
        } else if (modelMode === 'real') {
            const start = performance.now();
            const upstream = await fetch('http://127.0.0.1:8090/v1/systemone', {
                method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(input),
                redirect:'error', signal:AbortSignal.timeout(900),
            });
            const answer = await upstream.json();
            row.upstream = {status:upstream.status, model:answer.model, elapsedMs:Math.round(performance.now()-start)};
            output = answer.answers?.mode;
        } else {
            const top = .92;
            const probabilities = Object.fromEntries(keys.map(key => [key, key === modelMode ? top : (1-top)/(keys.length-1)]));
            output = {type:'choice', choice:modelMode, confidence:top, probabilities};
        }
        if (response.destroyed) return;
        response.writeHead(output ? 200 : 503, {'content-type':'application/json'});
        response.end(JSON.stringify({answers:{mode:output}}));
    });
    if (scenario === 'voice') {
        const wav = await readFile(process.env.MAID_QA_WAV);
        await listen(19088, async (request, response) => {
            await jsonBody(request);
            response.writeHead(200, {'content-type':'application/json'});
            response.end(JSON.stringify({id:'qa-voice',object:'chat.completion',model:'qa-native',
                choices:[{message:{role:'assistant',content:'可米，前面的路很安全。'},finish_reason:'stop'}]}));
        });
        await listen(26309, async (request, response) => {
            assert.equal(request.url, '/v1/tts');
            await jsonBody(request);
            response.writeHead(200, {'content-type':'audio/wav'});
            response.end(wav);
        });
    }
    bot = createBot({host:'127.0.0.1', port:26304, version:'1.21.1', username, auth:'offline', physicsEnabled:false, hideErrors:true});
    const errors = [];
    bot.on('error', error => errors.push(error.message));
    bot.on('kicked', reason => errors.push(String(reason)));
    assert(await until(() => bot.entity && bot.player?.uuid, 24000), 'Java client spawn');
    port = createMaidPort(bot, {timeoutMs:5000});
    check('original synthetic owner uses unmodified Java protocol', bot.player.uuid === fixture.owner);
    const version = await rc('version QiandengjiMaidBridge');
    if (scenario === 'baseline') check('existing production build reproduced', version.includes('0.1.31-vortex-spells'));
    else if (scenario !== 'voice') check('new bridge actually loaded', version.includes('0.1.32-adaptive-guard'));

    if (scenario === 'restart') {
        await mc(`tp ${username} 299.5 90 303.5`);
        check('cold restart reloads original owner and restores the saved hand',
            await until(async () => await hand() === 'minecraft:fishing_rod' && (await context()).ownerId === fixture.owner, 18000));
        check('restart neither drops nor duplicates packed equipment',
            await staffPacked() && await original() === 0);
    } else {
        for (const line of ['gamerule doMobSpawning false','gamerule doDaylightCycle false','gamerule randomTickSpeed 0',
            'time set 2000','weather clear','difficulty normal','fill 285 89 285 333 89 315 minecraft:stone',
            'fill 285 90 285 333 94 315 minecraft:air', 'fill 285 95 285 333 95 315 minecraft:stone',
            `tp ${username} 299.5 90 303.5`, `tp ${maid} 300.5 90 301.5`]) await mc(line);
        await control('freeze-maid');
        await control('owner');
        await mc(`effect give ${username} minecraft:resistance infinite 4 true`);
        check('original maid resumes ordinary follow', (await ask('follow')).data?.status === 'applied');
        if (scenario !== 'voice') {
            await mc(`item replace entity ${maid} weapon.mainhand with minecraft:fishing_rod`);
            await mc(`data modify entity ${maid} MaidInventory.Items set value []`);
            check('staff is the genuine Vortex item in an unlocked bag slot', (await control('pack-staff',0)).includes('packed=mage_apprentice_staff'));
        }
    }

    if (scenario === 'voice') {
        peer = await receiver(bot, {port:26307});
        const spoken = await ask('chat', {text:'可米在这里，请说一句话。'});
        check('owner conversation accepted', spoken.ok);
        check('encrypted SVC positional audio arrived', await until(() => peer.state.positional > 20, 22000));
        await delay(9000);
        report.opus = peer.state.packets;
        report.voice = (await context()).speech;
        check('packets decode cleanly at a nearby client', peer.state.errors === 0);
    }
    if (scenario === 'baseline') {
        const before = await target(306.5);
        await delay(2300);
        check('old bridge never uses a staff in the backpack',
            await hand() === 'minecraft:fishing_rod' && await task() === 'touhou_little_maid:idle' && await health() === before);
    }
    if (scenario === 'combat') {
        await mc(`item replace entity ${maid} weapon.offhand with minecraft:air`);
        check('peaceful following leaves the fishing rod equipped', await hand() === 'minecraft:fishing_rod');
        await mc('fill 303 90 300 303 94 303 minecraft:stone');
        let before = await target(306.5);
        await delay(1400);
        check('wall prevents a swap and damage', await hand() === 'minecraft:fishing_rod' && await health() === before);
        await mc('fill 303 90 300 303 94 303 minecraft:air');
        check('visible hostile triggers bag-to-hand swap and real Vortex damage',
            await until(async () => await hand() === 'minecraft:blaze_rod' && await health() < before));
        check('fishing rod still exists exactly once in the original bag', await original() === 1);
        const magic = await companion();
        report.firstSpell = magic.rpg;
        check('actual magic hit exposes a target and time', magic.rpg?.lastHitSpellId === 'arcane_bolt' && !!magic.rpg.lastHitTargetId);
        check('only one ready mode requires zero System One requests', report.requests.length === 0);
        await clear();
        check('quiet restores the rod and returns the actual staff to the bag',
            await until(async () => await hand() === 'minecraft:fishing_rod', 8500)
                && await staffPacked());

        await mc(`data modify entity ${maid} MaidInventory.Items append value {Slot:1,id:"minecraft:iron_sword",count:1}`);
        await mc(`data modify entity ${maid} MaidInventory.Items append value {Slot:2,id:"minecraft:bow",count:1}`);
        modelMode = 'magic';
        before = await target(302.2);
        check('local close-range fallback begins melee', await until(async () => (await companion()).guardMode === 'melee'));
        check('an unloaded bow is excluded from System One choices', await until(() => report.requests[0]) && !report.requests[0].keys.includes('ranged'));
        check('validated System One choice takes effect and switches to the real staff',
            await until(async () => {const c=await companion(); return c.systemOneStatus==='selected' && c.guardMode==='magic' && await hand()==='minecraft:blaze_rod';}));
        const n = report.requests.length;
        await delay(2200);
        check('stable threat does not cause inference every tick', report.requests.length <= n + 1);
        await clear();
        assert(await until(async () => await hand() === 'minecraft:fishing_rod', 8500), 'return from magic');

        await mc(`data modify entity ${maid} MaidInventory.Items append value {Slot:3,id:"minecraft:arrow",count:16}`);
        modelMode = 'ranged';
        before = await target(307.5);
        check('System One chooses armed native ranged task from all three modes',
            await until(async () => await hand()==='minecraft:bow' && (await companion()).guardMode==='ranged'));
        check('all three modes were offered together', report.requests.some(r => r.mode==='ranged' && r.keys.length===3));
        check('native ranged task deals real damage after switching', await until(async () => await health() < before, 15000));
        await clear();
        assert(await until(async () => await hand() === 'minecraft:fishing_rod', 8500), 'return from ranged');

        modelMode = 'timeout';
        before = await target(302.2);
        check('fast model timeout keeps local melee and does not block ticks',
            await until(async () => (await companion()).systemOneStatus==='unavailable' && await task()==='touhou_little_maid:attack'
                && await health()<before, 10000));
        await clear();
        assert(await until(async () => await hand() === 'minecraft:fishing_rod', 8500), 'return from timeout');

        modelMode = 'real';
        await target(306.5);
        check('installed System One answered the real native combat request',
            await until(() => report.requests.find(r => r.mode==='real' && r.upstream?.status===200)));
        check('system-one payload is bounded to tactical facts',
            report.requests.every(r => r.keysOfState.join(',')==='airborne,currentMode,distance,healthPercent,hostileType,ready,targetingCompanions'));
        check('owner stay cancels automatic combat and restores the rod', (await ask('stay')).data?.status==='applied'
            && await until(async () => await hand()==='minecraft:fishing_rod') && (await context()).sitting);
        await clear();
        await ask('follow');
        before = await target(306.5,'afu_site_dungeon');
        await delay(2300);
        check('reserved encounter remains untouched by all automatic choices', await hand()==='minecraft:fishing_rod' && await health()===before);

        await target(306.5);
        check('a real guarded equipment swap is saved for restart', await until(async () => await hand()!=='minecraft:fishing_rod' && await original()===1));
        await clear();
        await mc('save-all flush');
        report.restartReady = true;
    }
    check('original Java connection remains healthy', errors.length===0 && !!bot.entity);
} catch (error) {
    report.error = String(error.stack || error);
    if (port) report.lastContext = await companion().catch(() => null);
    if (port && scenario !== 'voice') report.lastInventory = (await ask('inventory').catch(() => null))?.data;
    console.error(report.error);
    process.exitCode = 1;
} finally {
    peer?.close();
    port?.close();
    bot?.quit();
    for (const server of servers) server.close();
    await writeFile(resolve('..',`${label}.${scenario}.proof.json`), JSON.stringify(report,null,2));
}
