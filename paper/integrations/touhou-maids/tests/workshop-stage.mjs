// Run only against the marked loopback fixture with the stock Mineflayer package.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const stage = process.env.MAID_WORKSHOP_STAGE;
const fixture = JSON.parse(await fs.readFile(process.env.MAID_WORKSHOP_FIXTURE, 'utf8'));
const resume = process.argv.includes('--resume');
assert(fixture.synthetic && fixture.username === 'MaidBrainQA');
assert.equal(await fs.readFile(stage + '/.maid-workshop-qa', 'utf8'), 'SYNTHETIC_WORKSHOP_ONLY');
const settings = await fs.readFile(stage + '/server.properties', 'utf8');
assert(/^server-ip=127\.0\.0\.1\r?$/m.test(settings) && /^server-port=25938\r?$/m.test(settings) && /^rcon.port=25939\r?$/m.test(settings));
const { command } = await import(pathToFileURL(process.env.MAID_WORKSHOP_RCON));
const rc = cmd => command(cmd, 15000, {port:25939, properties:stage + '/server.properties'});
const require = createRequire(process.env.MAID_WORKSHOP_CLIENT_ANCHOR);
const report = {synthetic:true, resume, checks:[]};
const run = 'ws' + Date.now().toString(36);
const bots = [];
const box = '305 90 303';
const table = '312 90 303';
const maid = fixture.maid;
let seq = 0;
let forcedOrder = 'home minecraft:torch 1 chest';
let latestModelRequest;
const model = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    const tools = parsed.tools?.map(t => t.function?.name) ?? [];
    const useTool = tools.includes('make_at_workshop');
    if (useTool) latestModelRequest = {tools, workshopContext:parsed.messages.some(m => m.content?.includes('minecraft:torch'))};
    const message = useTool
        ? {role:'assistant', content:null, tool_calls:[{id:'workshop_qa', type:'function',
            function:{name:'make_at_workshop', arguments:JSON.stringify({order:forcedOrder})}}]}
        : {role:'assistant', content:'我接下了，做完告诉你。'};
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({id:'workshop-qa', object:'chat.completion', model:'qa-native',
        choices:[{index:0, message, finish_reason:useTool?'tool_calls':'stop'}], usage:{prompt_tokens:1, completion_tokens:1,total_tokens:2}}));
});

function check(name, passed) {
    report.checks.push({name,passed:!!passed});
    console.log((passed ? 'PASS ' : 'FAIL ') + name);
    assert(passed, name);
}
async function until(sample, label, ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const result = await sample();
        if (result) return result;
        await delay(150);
    }
    throw new Error('Timeout: ' + label);
}
async function connect(name) {
    const bot = require('mineflayer').createBot({host:'127.0.0.1', port:25938, version:'1.21.1', username:name, auth:'offline', hideErrors:true});
    bots.push(bot);
    bot.lines = [];
    bot.replies = [];
    bot.on('messagestr', text => {
        bot.lines.push(text);
        if (text.startsWith('QD_MAID ')) bot.replies.push(JSON.parse(text.slice(8)));
    });
    const ready = new Promise((resolve, reject) => {
        bot.once('spawn', resolve);
        bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
        bot.once('error', reject);
    });
    await Promise.race([ready, delay(18000, null, {ref:false}).then(() => { throw new Error('Login timeout: ' + name); })]);
    return bot;
}
async function ask(bot, action, args = '', id = run + '_' + (++seq)) {
    const before = bot.replies.length;
    await delay(320);
    bot.chat(action === 'receipt' ? `/qdmaid receipt ${maid} ${args} ${id}` : `/qdmaid ${action} ${maid} ${id}${args ? ' ' + args : ''}`);
    return until(() => bot.replies.slice(before).find(reply => reply.requestId === id), action + ' ' + args);
}
async function terminal(bot, id) {
    return until(async () => {
        const reply = await ask(bot, 'receipt', id);
        const status = reply.data?.status;
        if (status && status !== 'pending') return reply;
    }, 'terminal ' + id, 36000);
}
const hasStack = (snbt, id, count) => snbt.split('}').some(slot =>
    slot.includes('id: "minecraft:' + id + '"') && new RegExp('count: ' + count + '(?![0-9])').test(slot));
const snapshot = async () => {
    // Vanilla truncates an entire NBT list in a command response. Sample each short entry separately.
    const rows = [];
    for (let slot = 0; slot < 9; slot++) {
        const output = await rc('minecraft:data get block ' + box + ' Items[' + slot + ']');
        const value = output.match(/\{[^}]+\}/)?.[0];
        if (!value) break;
        rows.push(value);
    }
    return rows.join(',');
};
const prepChest = () => rc('minecraft:data merge block ' + box + ' {Items:[{Slot:0b,id:"minecraft:coal",count:2},{Slot:1b,id:"minecraft:stick",count:2},{Slot:8b,id:"minecraft:gold_ingot",count:3}]}');
const reportPath = process.env.MAID_WORKSHOP_REPORT;
try {
    await new Promise(resolve => model.listen(19088, '127.0.0.1', resolve));
    check('exact workshop bridge is loaded', (await rc('version QiandengjiMaidBridge')).includes('0.1.27-workshop'));
    const owner = await connect(fixture.username);
    check('unmodified Mineflayer Java 1.21.1 reaches play state', owner.entity && owner.player?.uuid);
    if (resume) {
        const previous = JSON.parse(await fs.readFile(process.env.MAID_WORKSHOP_PREVIOUS, 'utf8'));
        const complete = await ask(owner, 'receipt', previous.complete);
        const stopped = await ask(owner, 'receipt', previous.stopped);
        check('completed receipt survives restart', complete.data?.status === 'completed' && complete.data?.goalCompleted);
        check('pending order is cancelled without replay', stopped.data?.status === 'cancelled' && stopped.data?.observation?.effectsApplied === false);
        check('restart retains exact original chest contents', (await snapshot()) === previous.inventoryBeforeStop);
        check('completed operation replay still preserves inventory', (await ask(owner, 'make', forcedOrder, previous.complete)).data?.replayed
            && (await snapshot()) === previous.inventoryBeforeStop);
    } else {
        const visitor = await connect('MaidVisitorQA');
        await rc('minecraft:fill 292 89 289 320 89 313 minecraft:stone');
        await rc('minecraft:fill 292 90 289 320 94 313 minecraft:air');
        await rc('minecraft:gamerule doMobSpawning false');
        await rc('minecraft:gamerule doDaylightCycle false');
        await rc('minecraft:time set 2000');
        await rc('minecraft:weather clear');
        for (const bot of bots) {
            await rc('minecraft:gamemode survival ' + bot.username);
            await rc('minecraft:tp ' + bot.username + ' 299.5 90 303.5');
        }
        await rc(`minecraft:tp ${maid} 300.5 90 303.5`);
        await rc('minecraft:setblock ' + box + ' minecraft:chest');
        await rc('minecraft:setblock ' + table + ' minecraft:crafting_table');
        await rc('minecraft:setblock 304 90 305 minecraft:chest{Items:[{Slot:0b,id:"minecraft:coal",count:9}]}');
        await ask(owner, 'follow');
        await ask(owner, 'brain', 'native');
        check('registered worksite and real recipe IDs are readable via plain chat', (await ask(owner, 'workshop')).data?.workshops?.[0]?.recipes.includes('minecraft:torch'));
        check('visitor cannot query another player’s worksite', (await ask(visitor, 'workshop')).error === 'not_owned');
        check('visitor cannot request item movement', (await ask(visitor, 'make', forcedOrder)).error === 'not_owned');
        check('missing material is a rejected receipt', (await ask(owner, 'make', forcedOrder)).error === 'materials_missing');
        await prepChest();
        const before = await snapshot();
        check('unregistered recipe cannot touch real slots', (await ask(owner, 'make', 'home minecraft:diamond_block')).error === 'workshop_not_allowed'
            && (await snapshot()) === before);
        await rc('minecraft:data merge block ' + box + ' {Lock:"workshop-test-key"}');
        check('vanilla locked chest is fenced', (await ask(owner, 'make', forcedOrder)).error === 'workshop_chest_unavailable');
        await rc('minecraft:data remove block ' + box + ' Lock');
        if (process.env.MAID_WORKSHOP_WORLDGUARD === '1') {
            check('WorldGuard loaded in the fixture', (await rc('version WorldGuard')).includes('7.0.12'));
            await rc('region flag -w qa_world workshop_guard chest-access deny');
            await delay(1100);
            check('WorldGuard denial prevents access to the registered box',
                (await ask(owner, 'make', forcedOrder)).error === 'workshop_access_denied' && (await snapshot()) === before);
            await rc('region flag -w qa_world workshop_guard chest-access');
            await delay(1100);
        }

        report.complete = run + '_complete';
        const order = await ask(owner, 'make', forcedOrder, report.complete);
        report.firstOrder = order;
        check('plain protocol queues real work', order.data?.status === 'pending' && order.data?.goalCompleted === false);
        check('start does not consume materials', (await snapshot()) === before);
        check('another work request reports the running job', (await ask(owner, 'make', forcedOrder)).error === 'workshop_busy');
        const done = await terminal(owner, report.complete);
        report.completedReceipt = done;
        check('real work completed with a verified product receipt', done.data?.status === 'completed'
            && done.data?.goalCompleted === true && done.data?.observation?.count === 4 && done.data?.observation?.itemId === 'minecraft:torch');
        const after = await snapshot();
        report.chestAfter = after;
        check('real chest has four torches, one coal, one stick and the original gold',
            hasStack(after, 'torch', 4) && hasStack(after, 'coal', 1) && hasStack(after, 'stick', 1) && hasStack(after, 'gold_ingot', 3));
        check('the native body reached both the chest and the real table', done.data.observation.visits
            .map(visit => visit.phase).join(',') === 'supplies,table,delivery'
            && done.data.observation.visits.every(visit => visit.distance < 2.6));
        check('other nearby chest remains untouched', (await rc('minecraft:data get block 304 90 305 Items')).includes('count: 9'));
        check('duplicate request returns original result without applying twice',
            (await ask(owner, 'make', forcedOrder, report.complete)).data?.replayed && (await snapshot()) === after);
        check('reusing ID with different parameters is rejected', (await ask(owner, 'make', 'home minecraft:torch 2 chest', report.complete)).error === 'request_conflict');

        await rc(`minecraft:tp ${maid} 300.5 90 303.5`);
        const stale = run + '_stale';
        check('second order begins with observed real stock', (await ask(owner, 'make', forcedOrder, stale)).data?.status === 'pending');
        await rc('minecraft:item replace block ' + box + ' container.9 with minecraft:iron_ingot 2');
        const edited = await snapshot();
        const cancelled = await terminal(owner, stale);
        check('external edit aborts the operation without rolling back the other player',
            cancelled.data?.status === 'cancelled' && cancelled.data.observation.error === 'workshop_stock_changed' && (await snapshot()) === edited);

        // Place the items in a true big-backpack slot; use the ordinary menu and command transport.
        await rc(`minecraft:data modify entity ${maid} MaidBackpackType set value "touhou_little_maid:big_backpack"`);
        const inventory = await ask(owner, 'inventory');
        check('the large backpack has actual usable slots through raw Mineflayer', inventory.data?.layout?.availableSlots === 36
            || inventory.data?.availableSlots === 36);
        const window = new Promise(resolve => owner.once('windowOpen', resolve));
        owner.chat(`/qdmaid menu ${maid}`);
        const opened = await Promise.race([window, delay(9000).then(() => { throw new Error('Menu did not open'); })]);
        check('common backpack menu is a vanilla inventory window', Number.isInteger(opened.id) && opened.inventoryStart >= 36);
        owner.closeWindow(opened);
        await rc('minecraft:item replace entity ' + owner.username + ' hotbar.0 with minecraft:coal 1');
        await rc('minecraft:item replace entity ' + owner.username + ' hotbar.1 with minecraft:stick 1');
        check('real resources transferred to backpack slots above six', (await ask(owner, 'transfer', 'put 32 1 0')).data?.status === 'applied'
            && (await ask(owner, 'transfer', 'put 33 1 1')).data?.status === 'applied');
        const backpackOrder = run + '_backpack';
        check('backpack-funded craft is queued', (await ask(owner, 'make', 'home minecraft:torch 1 backpack', backpackOrder)).data?.status === 'pending');
        const bagDone = await terminal(owner, backpackOrder);
        check('backpack craft completes in its actual usable slots', bagDone.data?.status === 'completed' && bagDone.data?.observation?.inventory === 'backpack'
            && bagDone.data.observation.count === 4 && (await snapshot()) === edited);
        report.backpack = await ask(owner, 'inventory');

        await rc(`minecraft:tp ${maid} 300.5 90 303.5`);
        const from = owner.lines.length;
        owner.chat('隔离肥鱼，能在工位做四支火把放回补给箱吗？');
        const line = await until(() => owner.lines.slice(from).find(text => text.includes('做好了') && text.includes('补给箱')),
            'natural chat completion text', 28000);
        const operation = line.match(/工单 (ca_[A-Za-z0-9_-]+)/)?.[1];
        check('addressed plain chat exposed authorized tools and returned an original request ID',
            latestModelRequest?.workshopContext && operation);
        const modelDone = await terminal(owner, operation);
        report.dialogue = {line, operation, toolContext:latestModelRequest, receipt:modelDone};
        check('model tool submission produces actual delivery', modelDone.data?.goalCompleted === true
            && hasStack(await snapshot(), 'torch', 8));
        await prepChest();
        await rc(`minecraft:tp ${maid} 296.5 90 303.5`);
        report.stopped = run + '_restart';
        report.inventoryBeforeStop = await snapshot();
        check('fixture is stopping with an actual pending order', (await ask(owner, 'make', forcedOrder, report.stopped)).data?.status === 'pending');
    }
} catch (error) {
    report.error = String(error);
    console.error(error);
    process.exitCode = 1;
} finally {
    for (const bot of bots) bot.quit();
    model.closeAllConnections();
    model.close();
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
