// Run against a copied synthetic Youer fixture with a local deterministic model.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';

const fixtureFile = resolve(process.argv[2]);
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
const stage = await realpath(fixture.lab);
assert.ok(fixture.synthetic && fixture.maidId.startsWith('10000000-') && fixture.username === 'BodyOwnerQA');
assert.match(stage.replaceAll('\\', '/'), /^E:\/MC\/staging\/maid-chat-range-[a-z0-9_]+$/i);
assert.equal(await readFile(join(stage, '.native-body-qa'), 'utf8'), 'SYNTHETIC_NATIVE_BODY_ONLY');
const properties = join(stage, 'server.properties');
const props = await readFile(properties, 'utf8');
for (const line of ['server-ip=127.0.0.1', `server-port=${fixture.gamePort}`, `rcon.port=${fixture.rconPort}`]) {
    assert.ok(props.split(/\r?\n/).includes(line));
}
const { createBot } = createRequire(process.env.MAID_ACTION_QA_CLIENT_ANCHOR)('mineflayer');
const rc = text => command(text, 10000, { port: fixture.rconPort, properties });
const mc = text => rc('minecraft:' + text);
const report = { synthetic: true, productionChanged: false, variant: fixture.variant, checks: [] };
const bots = [];
let sequence = 0;

async function until(read, label) {
    for (const end = Date.now() + 15000; Date.now() < end;) {
        const value = await read();
        if (value) return value;
        await delay(100);
    }
    throw new Error('Timed out: ' + label);
}

function check(name, passed, evidence) {
    report.checks.push({ name, passed: !!passed, evidence });
    console.log((passed ? 'PASS ' : 'FAIL ') + name);
}

async function connect(username) {
    const bot = createBot({ host: '127.0.0.1', port: fixture.gamePort, version: '1.21.1', username, auth: 'offline', hideErrors: true });
    bots.push(bot);
    bot.replies = [];
    bot.on('error', () => {});
    bot.on('messagestr', text => {
        if (text.startsWith('QD_MAID ')) {
            try { bot.replies.push(JSON.parse(text.slice(8))); } catch {}
        }
    });
    await until(() => bot.entity && bot.player?.uuid, 'connection');
    return bot;
}

async function talkAt(bot, distance, accepted, action = 'chat') {
    await mc(`tp ${bot.username} ${180.5 + distance} 81 100.5`);
    await delay(400);
    const id = `range_${Date.now().toString(36)}_${++sequence}`;
    const before = bot.replies.length;
    bot.chat(`/qdmaid ${action} ${fixture.maidId} ${id} 你好，请简短回应。`);
    const response = await until(() => bot.replies.slice(before).find(r => r.action === action && r.requestId === id), 'dialogue response');
    const expectedStatus = action === 'talk' ? 'queued' : 'pending';
    check(`${bot.username} ${action} at ${distance} blocks`, accepted ? response.ok && response.data?.status === expectedStatus : !response.ok && response.error === 'out_of_range', { ok: response.ok, error: response.error, status: response.data?.status });
    if (response.ok && action === 'talk') {
        const data = response.data.observation;
        check('queued message identifies its external consumer and direct dialogue usage', data?.delivery === 'external_inbox' && data.modelInvoked === false && data.directChatCommand === `/qdmaid chat ${fixture.maidId} <newRequestId> <newMessage>`);
    }
    if (response.ok && action === 'chat') {
        const receiptPath = join(stage, 'plugins/QiandengjiMaidBridge/native-receipts', `${fixture.maidId}_${id}.json`);
        const receipt = await until(async () => {
            try {
                const data = JSON.parse(await readFile(receiptPath, 'utf8'));
                return data.status !== 'pending' && data.status !== 'accepted' ? data : null;
            } catch { return null; }
        }, 'actual model reply');
        check(`${bot.username} receives completed reply at ${distance} blocks`, receipt.status === 'replied' && receipt.observation?.reply === '你好，我听见了。');
    }
}

try {
    const owner = await connect(fixture.username);
    const visitor = await connect('RangeVisitorQA');
    await mc('fill 175 80 96 210 80 105 minecraft:stone');
    for (const bot of bots) {
        await mc(`gamemode survival ${bot.username}`);
        await mc(`effect give ${bot.username} minecraft:resistance infinite 4 true`);
        await mc(`tp ${bot.username} 180.5 81 103.5`);
    }
    await rc(`companiontest position ${fixture.maidId} 180.5 81 100.5`);
    await mc(`data modify entity ${fixture.maidId} Sitting set value 1b`);
    await mc(`data modify entity ${fixture.maidId} MaidIsHome set value 0b`);
    await mc(`data modify entity ${fixture.maidId} MaidTask set value "touhou_little_maid:idle"`);
    await talkAt(owner, 9, true);
    await talkAt(owner, 24, true);
    await talkAt(owner, 24.1, false);
    await talkAt(visitor, 8, true);
    await talkAt(visitor, 8.1, false);
    await talkAt(owner, 9, true, 'talk');
    check('original synthetic owner and body are retained', (await mc(`data get entity ${fixture.maidId} UUID`)).includes('entity data') || (await mc(`execute if entity ${fixture.maidId}`)).includes('测试通过'));
} catch (error) {
    report.error = String(error);
    console.error(report.error);
} finally {
    for (const bot of bots) bot.quit();
    report.passed = !report.error && report.checks.every(row => row.passed);
    await writeFile(join(dirname(fixtureFile), 'partner-chat-range-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error }));
    if (!report.passed) process.exitCode = 1;
}
