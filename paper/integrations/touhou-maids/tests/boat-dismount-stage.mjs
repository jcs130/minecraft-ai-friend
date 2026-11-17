import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';

const fixtureFile = resolve(process.argv[2]);
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
const stage = await realpath(fixture.lab);
assert.ok(fixture.synthetic && fixture.maidId.startsWith('10000000-') && fixture.username === 'BodyOwnerQA');
assert.match(stage.replaceAll('\\', '/'), /^E:\/MC\/staging\/maid-dismount-[a-z0-9_]+$/i);
assert.equal(await readFile(join(stage, '.native-body-qa'), 'utf8'), 'SYNTHETIC_NATIVE_BODY_ONLY');
const properties = join(stage, 'server.properties');
const props = await readFile(properties, 'utf8');
for (const line of ['server-ip=127.0.0.1', `server-port=${fixture.gamePort}`, `rcon.port=${fixture.rconPort}`]) {
    assert.ok(props.split(/\r?\n/).includes(line));
}
const output = dirname(fixtureFile);
const maid = fixture.maidId;
const owner = fixture.username;
const baseline = fixture.variant === 'baseline';
const journal = join(stage, 'plugins/QiandengjiMaidBridge/native-receipts');
const { createBot } = createRequire(process.env.MAID_ACTION_QA_CLIENT_ANCHOR)('mineflayer');
const rc = text => command(text, 10000, { port: fixture.rconPort, properties });
const mc = text => rc('minecraft:' + text);
const testPassed = text => /Test passed|测试通过/.test(text);
const riding = id => mc(`execute as ${id} on vehicle if entity @s[type=minecraft:boat]`).then(testPassed);
const checks = [];
const report = { variant: fixture.variant, synthetic: true, checks };
let bot;

function check(name, passed, evidence) {
    checks.push({ name, passed: !!passed, evidence });
    console.log((passed ? 'PASS ' : 'FAIL ') + name);
    assert.ok(passed, name);
}

async function until(read, predicate, label, timeout = 12000) {
    for (const end = Date.now() + timeout; Date.now() < end;) {
        const value = await read();
        if (predicate(value)) return value;
        await delay(250);
    }
    throw new Error('Timed out: ' + label);
}

async function pos(id) {
    const value = await mc('data get entity ' + id + ' Pos');
    return value.match(/\[([-+\d.e,d ]+)\]/i)?.[1].split(',').map(part => Number(part.trim().replace(/d$/i, '')));
}

async function distance() {
    const [a, b] = await Promise.all([pos(maid), pos(owner)]);
    return a && b ? Math.hypot(...a.map((value, index) => value - b[index])) : Infinity;
}

async function decisions() {
    const files = (await readdir(journal)).filter(name => name.startsWith(maid + '_autonomy_') && name.endsWith('.json'));
    const rows = await Promise.all(files.map(name => readFile(join(journal, name), 'utf8').then(JSON.parse)));
    return rows.filter(row => row.observation?.decisionMode === 'dismount_boat');
}

async function placeBoat({ center = 181.25, ownerX = 190.5, shared = false } = {}) {
    await mc(`gamemode spectator ${owner}`);
    await mc(`ride ${maid} dismount`);
    await mc('kill @e[tag=DismountBoatQa]');
    await rc(`companiontest position ${maid} ${center} 81 100.5`);
    await mc(`data modify entity ${maid} Sitting set value 0b`);
    await mc(`data modify entity ${maid} MaidIsHome set value 0b`);
    await mc(`data modify entity ${maid} MaidTask set value "touhou_little_maid:idle"`);
    await mc(`summon minecraft:boat ${center} 80.625 100.5 {Type:"oak",Tags:["DismountBoatQa","DismountVesselQa"]}`);
    await mc(`ride ${maid} mount @e[type=minecraft:boat,tag=DismountVesselQa,limit=1]`);
    if (shared) {
        await mc('summon minecraft:pig 190.5 81 103.5 {NoAI:1b,Tags:["DismountBoatQa","DismountPassengerQa"]}');
        await mc('ride @e[tag=DismountPassengerQa,limit=1] mount @e[type=minecraft:boat,tag=DismountVesselQa,limit=1]');
        assert.equal(await riding('@e[tag=DismountPassengerQa,limit=1]'), true);
    }
    await mc(`tp ${owner} ${ownerX} 81 100.5`);
    await mc(`gamemode survival ${owner}`);
    await until(() => mc(`data get entity ${owner} OnGround`), value => /1b\b/.test(value), 'owner on dry ground');
    assert.equal(await riding(maid), true);
    assert.match(await mc(`data get entity ${maid} Sitting`), /0b\b/);
}

try {
    bot = createBot({
        host: '127.0.0.1', port: fixture.gamePort, username: owner, version: '1.21.1', auth: 'offline', hideErrors: true,
    });
    bot.on('error', error => console.error(error.message));
    await until(() => bot.player?.uuid, value => value === fixture.ownerId, 'synthetic owner login');
    for (const text of [
        `gamemode spectator ${owner}`, 'gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'time set noon',
        'forceload add 170 94 206 109', 'fill 170 79 94 206 80 109 stone',
        'fill 170 81 94 206 84 109 air', 'fill 174 80 97 181 80 104 water',
        `data modify entity ${maid} NeoForgeData.qiandengji_follow set value {schemaVersion:1,walkDistance:6,returnDistance:12,stopDistance:3}`,
    ]) await mc(text);
    const prior = new Set((await decisions()).map(row => row.operationId));
    const recent = async () => (await decisions()).filter(row => !prior.has(row.operationId));

    if (baseline) {
        await placeBoat();
        report.beforeDistance = await distance();
        check('fixture exceeds the current follow distance', report.beforeDistance > 6 && report.beforeDistance < 12);
        await delay(6500);
        check('released bridge leaves the original idle maid on the docked boat', await riding(maid) && (await recent()).length === 0);
    } else {
        for (const [name, options] of [
            ['owner still near the boat', { ownerX: 185.5 }],
            ['another passenger is still in the boat', { shared: true }],
            ['no dry shore close to the boat', { center: 177.5 }],
        ]) {
            await placeBoat(options);
            await delay(6500);
            check('holds position when ' + name, await riding(maid) && (await recent()).length === 0);
        }

        // The accessible bank lies on the opposite side from the owner.
        await placeBoat({ ownerX: 172.5 });
        report.beforeDistance = await distance();
        check('positive fixture is docked and beyond follow distance', report.beforeDistance > 6 && report.beforeDistance < 12 && await riding(maid));
        const decision = await until(recent,
            rows => rows.some(row => ['closed', 'unknown', 'replied'].includes(row.status)),
            'autonomous DSH decision receipt', 90000);
        const outcome = decision.at(-1);
        const action = outcome.observation?.actions?.[0];
        report.decision = { id: outcome.operationId, status: outcome.status, observation: outcome.observation };
        check('DSH chose the offered tool once without a player instruction',
            decision.length === 1 && outcome.observation.initiatedBy === 'maid' && action?.action === 'dismount_boat', report.decision);
        check('original entity dismounted and reached the checked dry shore',
            action.status === 'applied' && action.observation.dismounted === true
            && action.observation.landedOnShore === true && !(await riding(maid)), action.observation);
        check('boat survives with no passengers', testPassed(await mc('execute if entity @e[tag=DismountVesselQa]'))
            && !/entity data:|实体数据：/.test(await mc('data get entity @e[tag=DismountVesselQa,limit=1] Passengers')));
        const after = await until(distance, value => value <= 6, 'original follow after landing', 20000);
        check('she walks back within follow distance', after <= 6 && after < report.beforeDistance, { distance: after });
        await delay(1000);
        check('no second autonomous dismount after leaving the boat', (await recent()).length === 1 && !(await riding(maid)));
    }
    report.passed = true;
} catch (error) {
    report.passed = false;
    report.error = String(error);
    console.error(error.stack);
    process.exitCode = 1;
} finally {
    bot?.quit();
    await writeFile(join(output, 'boat-dismount-verification.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
}
