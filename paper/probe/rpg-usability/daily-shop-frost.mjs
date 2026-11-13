import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';

const stage = resolve(process.env.SHOP_QA_STAGE);
const mode = process.argv[2];
assert(['baseline', 'daily', 'cold', 'frost', 'support', 'trial-fire-baseline', 'trial-fire'].includes(mode));
assert.equal(await readFile(resolve(stage, '.daily-shop-qa'), 'utf8'), 'ISOLATED_DAILY_SHOP_FROST_ONLY');
const properties = resolve(stage, 'server.properties');
const values = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const field of ['server-ip=127.0.0.1', 'server-port=25928', 'rcon.port=25929']) assert(values.includes(field));
const {createBot} = createRequire(process.env.MINEFLAYER_PACKAGE || 'E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const report = {mode, synthetic: true, productionChanged: false, checks: []};
const clients = [];
const rc = async text => {
    const result = await command(text, 15000, {port: 25929, properties});
    assert(!result.includes('fixture_error=') && !result.includes('An internal error occurred'), result);
    return result;
};
function check(name, value) {
    report.checks.push({name, passed: Boolean(value)});
    console.log((value ? 'PASS ' : 'FAIL ') + name);
    assert(value, name);
}
async function until(read, reason, timeout = 13000) {
    for (const end = Date.now() + timeout; Date.now() < end;) {
        const value = await read();
        if (value) return value;
        await delay(125);
    }
    throw new Error('Timed out: ' + reason);
}
async function connect(id) {
    const bot = createBot({host: '127.0.0.1', port: 25928, username: 'ag_RU' + id + 'Q2', auth: 'offline',
        version: '1.21.1', hideErrors: true, checkTimeoutInterval: 60000, physicsEnabled: false});
    const state = {bot, lines: [], events: [], errors: [], last: 0};
    clients.push(state);
    installRecipePacketBypass(bot._client);
    bot.on('messagestr', line => state.lines.push(line));
    bot.on('error', error => state.errors.push(error.message));
    bot.on('kicked', reason => state.errors.push(JSON.stringify(reason)));
    bot._client.on('custom_payload', packet => {
        if (packet.channel === 'mcagent:event') state.events.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
    });
    await until(() => bot.entity && bot.world.getColumnAt(bot.entity.position), 'ready ' + id, 40000);
    await rc('minecraft:gamemode survival ' + bot.username);
    return state;
}
const name = client => client.bot.username;
const position = (client, x = 180.5, y = 90, z = 180.5) => rc('minecraft:tp ' + name(client) + ' ' + x + ' ' + y + ' ' + z);
async function say(client, text) {
    await delay(Math.max(0, 1150 - (Date.now() - client.last)));
    client.last = Date.now();
    const offset = client.lines.length;
    client.bot.chat(text);
    return offset;
}
async function packets(client, text, prefix, done) {
    const offset = await say(client, text);
    return until(() => {
        const rows = client.lines.slice(offset).filter(line => line.startsWith(prefix + ' '))
            .map(line => JSON.parse(line.slice(prefix.length + 1)));
        return rows.some(done) && rows;
    }, text);
}
const economy = async (client, text) => (await packets(client, text + ' --json', 'MC_ARENA_ECONOMY', row => row.action === 'buy'))[0];
async function list(client, section = 'daily') {
    const rows = await packets(client, '/mycli trade shop list ' + section + ' --json', 'MC_ARENA_ECONOMY', row => row.action === 'shop_list_end');
    return {items: rows.filter(row => row.action === 'shop_list'), summary: rows.at(-1)};
}
const query = async (client, text) => (await packets(client, text + ' --json', 'MC_RPG', () => true)).at(-1);
const gold = async client => Number((await query(client, '/mycli trade wallet')).balance);
const funds = (client, amount) => rc('qduse coins ' + name(client) + ' ' + amount);
const mana = client => rc('qduse mana ' + name(client) + ' 20');
const health = async (client, value = '') => Number((await rc('dailyqa health ' + name(client) + ' ' + value)).match(/health=([\d.]+)/)?.[1]);
const fire = async (client, value = '') => Number((await rc('dailyqa fire ' + name(client) + ' ' + value)).match(/fire=(-?\d+)/)?.[1]);
const block = async (x, y, z, material = '') => (await rc(['dailyqa block', x, y, z, material].join(' '))).trim();
const buy = (client, id, count = 1) => economy(client, '/mycli trade shop buy ' + id + ' ' + count);
const clock = date => rc('dailyqa clock ' + date);
const stockDay = process.env.SHOP_QA_DAY || '2026-11-27';
const today = stockDay + 'T15:59:50Z';
const tomorrow = stockDay + 'T16:00:00Z';
const nextDay = new Date(Date.parse(stockDay) + 86_400_000).toISOString().slice(0, 10);
const dailySnapshot = resolve(stage, 'daily-qa-snapshot.json');

async function open(client, text, title) {
    if (client.bot.currentWindow) client.bot.closeWindow(client.bot.currentWindow);
    await say(client, text);
    return until(() => client.bot.currentWindow && title.test(JSON.stringify(client.bot.currentWindow.title))
        && client.bot.currentWindow, text);
}
async function click(client, slot, title) {
    const old = client.bot.currentWindow.id;
    await client.bot.clickWindow(slot, 0, 0);
    return until(() => client.bot.currentWindow?.id !== old && client.bot.currentWindow
        && title.test(JSON.stringify(client.bot.currentWindow.title)) && client.bot.currentWindow, 'menu click ' + slot);
}
async function chatResult(client, text, pattern) {
    const offset = await say(client, text);
    return until(() => client.lines.slice(offset).find(line => pattern.test(line)), text);
}

async function daily(first, second) {
    await clock(today);
    const dailyList = await list(first);
    const {items, summary} = dailyList;
    report.initial = {items: items.map(row => ({id: row.offerId, price: row.unitPrice, enchantments: row.item.enchantments})), summary};
    check('six distinct enchanted items on the same dated, server-wide shelf', items.length === 6
        && new Set(items.map(row => row.offerId)).size === 6 && items.every(row => row.daily && row.stock === 1
            && row.currency === '金币' && row.item.enchantments.length && row.buyCommand.endsWith(row.offerId)));
    check('next refresh is the Shanghai calendar midnight', summary.refreshTimezone === 'Asia/Shanghai'
        && summary.refreshAt === Date.parse(tomorrow) && summary.stockDate === stockDay);
    const secondView = await list(second);
    check('separate players see identical stock, items and prices', JSON.stringify(items.map(row => [row.offerId, row.item.componentHash, row.unitPrice]))
        === JSON.stringify(secondView.items.map(row => [row.offerId, row.item.componentHash, row.unitPrice])));
    const supplies = (await list(first, 'supplies')).items;
    check('bow, arrows and a full stack remain available as supplies', supplies.some(row => row.offerId === 'bow')
        && supplies.some(row => row.offerId === 'arrows' && row.item.quantity === 16)
        && supplies.some(row => row.offerId === 'arrows_stack' && row.item.quantity === 64) && supplies.every(row => !row.daily));
    const [wanted, failed, stale, menuItem] = items;
    const poorPlayer = await connect('P' + stockDay.slice(-2));
    const poor = await buy(poorPlayer, wanted.offerId);
    check('insufficient funds neither charges nor reserves the item', poor.reason === 'insufficient_balance'
        && (await list(first)).items.some(row => row.offerId === wanted.offerId));
    await funds(first, 900);
    await funds(second, 900);
    const starting = [await gold(first), await gold(second)];
    check('synthetic balances are available from the native wallet', starting.every(value => value >= 900));
    const invalid = await buy(first, wanted.offerId, 2);
    check('daily gear cannot be purchased in a larger quantity', !invalid.success && invalid.reason === 'invalid_offer_or_quantity');
    const old = await open(second, '/mycli trade shop menu', /金币商城/);
    check('native chest menu shows six featured gear slots and a refresh button', old.slots.slice(28, 34).every(Boolean)
        && old.slots[35]?.name === 'clock');
    const confirmation = await click(second, 28, /确认购买/);
    check('daily preview uses the exact item and one-piece confirmation', confirmation.slots[4]?.name === wanted.item.id.slice(10)
        && !confirmation.slots[12] && !confirmation.slots[14]);
    const won = await buy(first, wanted.offerId);
    check('one purchase debits the quoted amount and queues the exact enchanted item', won.success && won.spent === wanted.unitPrice
        && won.item.componentHash === wanted.item.componentHash && won.stock === 0 && won.currency === '金币'
        && starting[0] - await gold(first) === wanted.unitPrice);
    const updated = await click(second, 16, /金币商城/);
    check('stale native confirmation cannot buy a different item or spend money', await gold(second) === starting[1]
        && second.lines.some(line => line.includes('[shop_sold_out]')));
    const duplicate = await buy(second, wanted.offerId);
    check('duplicate purchase reports sold out with a corrective query', duplicate.reason === 'shop_sold_out'
        && duplicate.spent === 0 && duplicate.nextCommand === '/mycli trade shop list daily');
    check('sold items are removed from all listings', (await list(first)).items.length === 5);
    const liveSlot = 28 + items.indexOf(menuItem) - 1;
    check('another player can see the next offer in the still-open shop', updated.slots[liveSlot]?.name === menuItem.item.id.slice(10));
    const otherPurchase = await buy(first, menuItem.offerId);
    check('an open native shelf removes a sold item immediately', otherPurchase.success
        && await until(() => !second.bot.currentWindow?.slots[liveSlot], 'live menu stock decrement'));
    await mana(first);
    const chest = await open(first, '/mycli arena stash page 1', /个人|奖励|试炼/);
    check('exact purchased equipment appears in the personal chest', chest.slots.slice(0, 45)
        .some(stack => stack?.name === wanted.item.id.slice(10) && (stack.nbt?.value?.Enchantments
            || stack.components?.some(component => component.type === 'enchantments'))));
    first.bot.closeWindow(chest);
    await funds(poorPlayer, 900);
    await rc('qduse withdrawfail ' + name(poorPlayer) + ' on');
    const failure = await buy(poorPlayer, failed.offerId);
    await rc('qduse withdrawfail ' + name(poorPlayer) + ' off');
    check('unknown bank withdrawal preserves original transaction and hides reserved stock', failure.reason === 'money_unverified'
        && failure.pending && failure.transactionId && !failure.success && !failure.spent);
    const reserved = await buy(first, failed.offerId);
    check('second buyer cannot take a reserved item after an uncertain withdrawal', reserved.reason === 'shop_stock_pending'
        && reserved.spent === 0 && !(await list(first)).items.some(row => row.offerId === failed.offerId));
    await writeFile(dailySnapshot, JSON.stringify({wanted, failed, stale, wonBalance: await gold(first)}, null, 2));
}

async function cold(first, second) {
    const saved = JSON.parse(await readFile(dailySnapshot, 'utf8'));
    await clock(today);
    const stocked = await list(first);
    check('normal restart retains sold and pending stock', stocked.items.length === 3
        && !stocked.items.some(row => [saved.wanted.offerId, saved.failed.offerId].includes(row.offerId)));
    check('normal restart retains the confirmed gold debit', await gold(first) === saved.wonBalance);
    check('reserved offer still cannot be bought after restart', (await buy(first, saved.failed.offerId)).reason === 'shop_stock_pending');
    const purchase = await buy(first, 'arrows_stack');
    check('normal supplies still settle for gold after restart', purchase.success && purchase.spent === 12 && purchase.item.quantity === 64);
    await clock(tomorrow);
    const next = await list(first);
    check('midnight refresh publishes a new shelf of six', next.summary.stockDate === nextDay && next.items.length === 6
        && next.items.every(row => row.offerId.startsWith('daily_' + nextDay.replaceAll('-', '') + '_')));
    check('yesterday’s IDs are rejected after midnight', (await buy(first, saved.stale.offerId)).reason === 'shop_offer_expired');
    await clock(today);
    check('clock rollback does not reopen yesterday’s stock', (await list(second)).summary.stockDate === nextDay);
}

async function frost(first, second) {
    for (const text of ['gamerule doMobSpawning false', 'gamerule doFireTick false', 'gamerule naturalRegeneration false',
        'gamerule doDaylightCycle false', 'time set 18000', 'fill 170 89 170 193 89 193 minecraft:stone',
        'fill 170 90 170 193 95 193 minecraft:air']) await rc('minecraft:' + text);
    await position(first);
    await position(second, 180.5, 90, 182.5);
    await mana(first);
    if (mode === 'baseline') {
        await fire(first, 150);
        await block(182, 90, 180, 'FIRE');
        const response = await chatResult(first, '/mycli cast frostnova', /未耗魔|熄灭/);
        check('old frost cannot extinguish on a fire-only cast', response.includes('未耗魔')
            && await fire(first) > 0 && await block(182, 90, 180) === 'block=FIRE');
        return;
    }
    await block(182, 90, 180, 'FIRE');
    await block(182, 89, 181, 'SOUL_SOIL');
    await block(182, 90, 181, 'SOUL_FIRE');
    await block(179, 90, 180, 'FIRE');
    await block(178, 90, 180, 'CAMPFIRE');
    await block(184, 90, 182, 'LAVA');
    await block(189, 90, 180, 'FIRE');
    await rc('minecraft:fill 180 90 178 182 93 178 minecraft:stone');
    await block(180, 90, 176, 'FIRE');
    await fire(first, 160);
    await fire(second, 160);
    const cast = await chatResult(first, '/mycli cast frostnova', /霜环.*熄灭/);
    check('fire-only cast puts out the caster and nearby visible player', cast.includes('2 名玩家')
        && await fire(first) <= 0 && await fire(second) <= 0);
    check('unmodified client receives the private cast receipt without channel registration',
        first.events.some(event => event.id === 'frostnova' && event.body.includes('熄灭'))
        && !second.events.some(event => event.id === 'frostnova'));
    check('fire and soul fire are extinguished; protected and obscured blocks stay', await block(182, 90, 180) === 'block=AIR'
        && await block(182, 90, 181) === 'block=AIR' && await block(179, 90, 180) === 'block=FIRE'
        && await block(180, 90, 176) === 'block=FIRE' && await block(189, 90, 180) === 'block=FIRE');
    check('campfire and lava are unchanged', await block(178, 90, 180) === 'block=CAMPFIRE' && await block(184, 90, 182) === 'block=LAVA');
    check('frost fire-only cast still enforces its original cooldown',
        (await chatResult(first, '/mycli cast frostnova', /还需.*秒/)).includes('还需'));
    const info = await chatResult(second, '/mycli skills info frostnova', /缓慢 III|缓慢III/);
    check('normal skill help describes the new control effect', info.includes('虚弱') || second.lines.slice(-12).some(line => line.includes('虚弱')));
    await rc('minecraft:summon zombie 181.5 90 184.5 {Tags:["QDFrost"],NoAI:1b,PersistenceRequired:1b}');
    await mana(second);
    await chatResult(second, '/mycli cast frostnova', /霜环.*命中/);
    const data = await rc('dailyqa effects @e[tag=QDFrost,limit=1]');
    report.hostileEffects = data;
    check('real hostile receives Slowness III and Weakness I', data.includes('slow=2 weak=0'));
    await rc('minecraft:kill @e[tag=QDFrost]');
}

async function trialFire(first, second) {
    const baseline = mode === 'trial-fire-baseline';
    const shotBlock = [-589, 33, -305];
    const spellFire = [-589, 33, -303];
    const soulFire = [-588, 33, -303];
    const campfire = [-593, 33, -305];
    const inaccessibleFire = [-590, 33, -311];
    const hiddenFire = [-590, 33, -309];
    const mc = text => rc('minecraft:' + text);
    await mc('gamerule doFireTick false');
    await mc('gamerule mobGriefing true');
    await mc('gamerule doMobSpawning false');
    await position(first, -590.5, 33, -304.5);
    await position(second, -590.5, 33, -304.5);
    await mc('fill -601 33 -316 -579 38 -294 minecraft:air');
    await mc('fill -601 32 -316 -579 32 -294 minecraft:nether_bricks');
    await mc('fill -591 33 -308 -589 35 -308 minecraft:nether_bricks');
    await block(...spellFire, 'FIRE');
    await block(soulFire[0], 32, soulFire[2], 'SOUL_SOIL');
    await block(...soulFire, 'SOUL_FIRE');
    await block(...campfire, 'CAMPFIRE');
    await block(...inaccessibleFire, 'FIRE');
    await block(...hiddenFire, 'FIRE');
    await rc('dailyqa trial-fourth ' + name(first) + ' ' + name(first));
    try {
        await mana(second);
        check('a visitor outside the trial roster cannot use frost to edit the protected floor',
            (await chatResult(second, '/mycli cast frostnova', /未耗魔/)).includes('未耗魔')
            && await block(...spellFire) === 'block=FIRE');
        await mana(first);
        const cast = await chatResult(first, '/mycli cast frostnova', /未耗魔|熄灭/);
        const [normal, soul] = [await block(...spellFire), await block(...soulFire)];
        if (baseline) {
            check('installed build reproduces the fourth-floor protection bug',
                cast.includes('未耗魔') && normal === 'block=FIRE' && soul === 'block=SOUL_FIRE');
        } else {
            check('a participant can extinguish both kinds of visible fire with no enemy nearby',
                cast.includes('2 处明火') && normal === 'block=AIR' && soul === 'block=AIR');
        }
        check('campfire, fire behind a wall and out-of-reach fire remain in place',
            await block(...campfire) === 'block=CAMPFIRE' && await block(...hiddenFire) === 'block=FIRE'
            && await block(...inaccessibleFire) === 'block=FIRE');

        async function shoot(kind) {
            const result = await rc('dailyqa trial-shot ' + name(first) + ' ' + kind);
            const id = result.match(/shot=([0-9a-f-]{36})/)?.[1];
            assert(id, result);
            await until(async () => (await rc('dailyqa trial-shot ' + id + ' alive')).includes('shotAlive=false'),
                kind + ' fireball impact');
            await delay(250);
            return result;
        }
        const shot = await shoot('ground');
        const landing = await block(...shotBlock);
        check(baseline ? 'installed build reproduces fireball ground ignition'
            : 'trial fireball block impact leaves no persistent fire',
        baseline ? shot.includes('incendiary=true') && landing === 'block=FIRE'
            : shot.includes('incendiary=false') && landing === 'block=AIR');
        if (baseline) return;

        await position(second, -586.5, 33, -301.5);
        await block(...shotBlock, 'AIR');
        await shoot('ordinary');
        check('ground cleanup does not affect an ordinary non-trial shooter',
            await block(...shotBlock) === 'block=FIRE');
        await block(...shotBlock, 'AIR');
        await rc('dailyqa fire ' + name(first) + ' 0');
        const before = await health(first);
        await shoot('player');
        check('trial fireball still damages and ignites a player it hits',
            await health(first) < before && await fire(first) > 0);
    } finally {
        await rc('dailyqa trial-fourth ' + name(first));
        await mc('kill @e[tag=qd_frost_qa_shooter]');
    }
}

async function support(first, second, bystander) {
    for (const rule of ['gamerule naturalRegeneration false', 'gamerule doMobSpawning false',
        'fill 174 89 174 192 89 192 minecraft:stone', 'fill 174 90 174 192 94 192 minecraft:air'])
        await rc('minecraft:' + rule);
    await position(first);
    await position(second, 183.5, 90, 180.5);
    await position(bystander, 181.5, 90, 183.5);
    await chatResult(first, '/mycli profession choose cleric', /选择|职业|牧师/);
    assert((await rc('dailyqa level ' + name(first) + ' 4')).includes('level=4'));
    await delay(900);
    const facts = await query(first, '/mycli skills info wardens_bloom');
    report.cleric = facts;
    check('configured cleric group healing is available at its actual level', facts.available && facts.definition.minLevel === 4);
    await rc('dailyqa party ' + [first, second].map(name).join(' '));
    await health(first, 7);
    await health(second, 7);
    await health(bystander, 7);
    await mana(first);
    await chatResult(first, '/mycli cast wardens_bloom', /技能已执行|从掌心向外涌动/);
    check('existing cleric spell really heals self and party member, without healing nearby stranger',
        await health(first) > 7 && await health(second) > 7 && await health(bystander) === 7);
    await chatResult(bystander, '/mycli profession choose knight', /选择|职业|骑士/);
    await rc('dailyqa party ' + [bystander].map(name).join(' '));
    await rc('qduse mana ' + name(bystander) + ' 20');
    await chatResult(bystander, '/mycli cast fortify', /技能已执行|钢铁意志/);
    const noOther = await rc('dailyqa effects ' + name(second));
    check('knight on a separate party does not buff bystanders', noOther.includes('guard=-1'));
    const mageStranger = await connect('Solo');
    await position(mageStranger, 181.5, 90, 183.5);
    const knight = await connect('Knight');
    await position(knight, 182.5, 90, 181.5);
    await chatResult(knight, '/mycli profession choose knight', /选择|职业|骑士/);
    await rc('dailyqa party ' + [first, knight].map(name).join(' '));
    await mana(knight);
    const knightInfo = await query(knight, '/mycli skills info fortify');
    check('knight skill details expose both self and team effects', knightInfo.serverEffects?.some(effect => effect.target === 'visible_allies'
        && effect.range === 7 && effect.durationTicks === 100));
    await chatResult(knight, '/mycli cast fortify', /技能已执行|钢铁意志/);
    await delay(250);
    const guarded = await rc('dailyqa effects ' + name(second));
    check('nearby party member receives the actual resistance buff', guarded.includes('guard=0'));
    const mage = await connect('Mage');
    await position(mage, 182.5, 90, 181.5);
    await chatResult(mage, '/mycli profession choose mage', /选择|职业|法师/);
    assert((await rc('dailyqa level ' + name(mage) + ' 1')).includes('level=1'));
    const locked = await query(mage, '/mycli skills info astral_convergence');
    check('mage group spell is gated by its configured level', locked.available === false && locked.definition.minLevel === 8);
    assert((await rc('dailyqa level ' + name(mage) + ' 8')).includes('level=8'));
    await delay(700);
    const astral = await query(mage, '/mycli skills info astral_convergence');
    check('mage group spell shows the configured heal and damage', astral.available && astral.definition.mechanics
        .some(mechanic => mechanic.type === 'heal') && astral.definition.mechanics.some(mechanic => mechanic.type === 'damage'));
    await rc('dailyqa party ' + [first, mage].map(name).join(' '));
    await health(second, 7);
    await health(mageStranger, 7);
    await rc('minecraft:kill @e[tag=QDAstral]');
    await rc('minecraft:time set 18000');
    await rc('minecraft:summon zombie 184.5 90 184.5 {Tags:["QDAstral"],NoAI:1b,PersistenceRequired:1b,ArmorItems:[{},{},{},{id:"minecraft:iron_helmet",count:1}]}');
    const monsterHealth = async () => Number((await rc('dailyqa entity-health @e[tag=QDAstral,limit=1]')).match(/health=([\d.]+)/)?.[1]);
    const beforeMonster = await monsterHealth();
    await mana(mage);
    await chatResult(mage, '/mycli cast astral_convergence', /技能已执行|援护与攻击/);
    await delay(300);
    const after = {ally: await health(second), stranger: await health(mageStranger), monster: await monsterHealth()};
    report.astral = {beforeMonster, after};
    check('mage group spell heals its teammate and damages a monster in one cast',
        after.ally > 7 && after.stranger === 7 && beforeMonster > 0 && after.monster < beforeMonster);
    await rc('minecraft:kill @e[tag=QDAstral]');
    await rc('dailyqa trial-team ' + [first, second].map(name).join(' '));
    try {
        check('automatic trial roster permits support without a manual party', (await rc('dailyqa assist ' + [first, second].map(name).join(' '))).includes('assist=true'));
        check('automatic trial roster excludes a nonparticipant', (await rc('dailyqa assist ' + [first, bystander].map(name).join(' '))).includes('assist=false'));
    } finally {
        await rc('dailyqa trial-team ' + name(first));
    }
}

try {
    const plugins = await rc('plugins');
    check('native Vortex, AgentFriend, bridge and isolated fixture are enabled', ['AgentFriend', 'VortexRPG', 'QiandengjiRpg', 'DailyGameplayQa']
        .every(plugin => plugins.includes('§a' + plugin)));
    const first = await connect(mode === 'baseline' ? 'OldA' : 'First');
    const second = await connect(mode === 'baseline' ? 'OldB' : 'Second');
    if (mode === 'baseline') {
        const text = await chatResult(first, '/mycli trade shop list daily', /未购买|每日精选|商品ID/);
        check('old native shop has no daily section', !text.includes('每日精选'));
        await frost(first, second);
    }
    if (mode === 'daily') await daily(first, second);
    if (mode === 'cold') await cold(first, second);
    if (mode === 'frost') await frost(first, second);
    if (mode === 'trial-fire-baseline' || mode === 'trial-fire') await trialFire(first, second);
    if (mode === 'support') await support(first, second, await connect('Guest'));
    check('all original-protocol sessions stay connected', clients.every(client => client.errors.length === 0));
} catch (error) {
    report.error = String(error.stack ?? error);
    report.tail = clients.map(client => ({name: name(client), lines: client.lines.slice(-12), errors: client.errors}));
    throw error;
} finally {
    for (const client of clients) client.bot.quit('isolated daily gameplay check complete');
    await writeFile(resolve(stage, 'daily-' + mode + '.proof.json'), JSON.stringify(report, null, 2));
}
