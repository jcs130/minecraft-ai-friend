import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const stage = await fs.realpath(process.env.WEAPON_SKILL_STAGE);
assert.equal((await fs.readFile(path.join(stage, '.weapon-skill-qa'), 'utf8')).trim(), 'SYNTHETIC_WEAPON_SKILL_ONLY');
const properties = path.join(stage, 'server.properties');
const bindings = (await fs.readFile(properties, 'utf8')).split(/\r?\n/);
for (const binding of ['server-ip=127.0.0.1', 'server-port=26515', 'rcon.port=26516', 'online-mode=false'])
    assert(bindings.includes(binding), 'fixture binding ' + binding);
const mineflayer = createRequire(path.resolve(process.env.MINEFLAYER_PACKAGE))('mineflayer');
const tag = process.env.WEAPON_QA_TAG ?? '';
assert(/^[a-z0-9]{0,3}$/.test(tag), 'use a short synthetic test tag');
const username = 'WheelSwordQA' + tag;
const checks = [];
const bots = [];
const rc = (text) => command(text, 10000, { port: 26516, properties });

function check(name, condition) {
    assert(condition, name);
    checks.push(name);
    console.log('PASS ' + name);
}
async function until(fn, label, timeout = 6000) {
    for (const end = Date.now() + timeout; Date.now() < end;) {
        const result = fn();
        if (result) return result;
        await sleep(40);
    }
    throw new Error('Timed out waiting for ' + label);
}
async function connect(name) {
    const bot = mineflayer.createBot({ host: '127.0.0.1', port: 26515, username: name,
        version: '1.21.1', auth: 'offline', hideErrors: true, checkTimeoutInterval: 45000 });
    bots.push(bot);
    bot.lines = [];
    bot.on('messagestr', line => bot.lines.push(line));
    bot.on('error', error => console.error(name, String(error)));
    installRecipePacketBypass(bot._client);
    await until(() => bot.entity && bot.world.getColumnAt(bot.entity.position), 'spawn', 45000);
    await sleep(1200);
    return bot;
}
async function chat(bot, text) {
    await sleep(Math.max(0, 280 - (Date.now() - (bot.lastCommand || 0))));
    const mark = bot.lines.length;
    bot.lastCommand = Date.now();
    bot.chat(text);
    return mark;
}
function line(bot, mark, contains) {
    return until(() => bot.lines.slice(mark).find(text => text.includes(contains)), contains);
}
async function open(bot, text) {
    await chat(bot, text);
    const window = await until(() => bot.currentWindow, text);
    return window;
}
async function switchPage(bot, slot) {
    const before = bot.currentWindow;
    await bot.clickWindow(slot, 0, 0);
    return until(() => bot.currentWindow && bot.currentWindow !== before && bot.currentWindow, 'wheel page');
}
function title(window, name) {
    return JSON.stringify(window.title).includes(name);
}
async function equip(bot, name, destination = 'hand') {
    const stack = await until(() => bot.inventory.items().find(item => item.name === name), name);
    await bot.equip(stack, destination);
}
const selected = (bot, key) => rc('minecraft:data get entity ' + bot.username + ' SelectedItem.components.' + key);
const engraving = bot => selected(bot, '"minecraft:custom_data".PublicBukkitValues."agentfriend:weapon_spell_preset"');
const binding = bot => selected(bot, '"minecraft:custom_data".PublicBukkitValues."agentfriend:weapon_spell_combo_v1"');
const enchantments = bot => selected(bot, '"minecraft:enchantments"');
const target = bot => Object.values(bot.entities).find(entity => entity.name === 'husk');
const health = () => rc('minecraft:data get entity @e[tag=weapon_target,limit=1] Health')
    .then(text => Number(text.match(/: (\d+(?:\.\d+)?)f?\s*$/)?.[1]));
async function airUse(bot, sneaking = false, pitch = 0.65) {
    bot.setControlState('sneak', sneaking);
    await bot.look(0, pitch, true);
    await sleep(90);
    const mark = bot.lines.length;
    bot.activateItem(false);
    await sleep(80);
    bot.setControlState('sneak', false);
    return mark;
}

let error = null;
let randomWeapon = null;
try {
    const bot = await connect(username);
    if (process.argv.includes('--restart')) {
        const saved = JSON.parse(await fs.readFile(path.join(stage, 'weapon-gestures.json'), 'utf8'));
        await equip(bot, 'iron_axe');
        const restoredBinding = await binding(bot);
        check('the exact random engraving survives a normal server restart', restoredBinding === saved.randomWeapon);
        await equip(bot, 'iron_sword');
        check('normal restart preserves the selected engraving and vanilla enchantment',
            (await engraving(bot)).includes('skirmish') && (await enchantments(bot)).includes('minecraft:unbreaking'));
        const before = bot.entity.position.clone();
        await airUse(bot, true, 0);
        check('the saved skirmish engraving triggers a real blink from the same gesture',
            !!(await until(() => bot.entity.position.distanceTo(before) > 3, 'enchanted sword blink')));
        check('the wheel is available after restart', title(await open(bot, '/mycli skills wheel'), '施法轮盘'));
    } else {
        await rc('minecraft:gamerule naturalRegeneration false');
        await rc('minecraft:kill @e[tag=weapon_target]');
        await rc('minecraft:clear ' + username);
        await rc('minecraft:fill -8 -53 -8 8 -53 8 minecraft:stone');
        await rc('minecraft:tp ' + username + ' 0.5 -52 0.5');
        await until(() => Math.abs(bot.entity.position.y + 52) < 0.2, 'test platform');
        await rc('minecraft:setblock 0 -52 2 minecraft:enchanting_table');
        await rc('minecraft:setblock -1 -52 2 minecraft:chest');
        await rc('minecraft:xp set ' + username + ' 21 levels');
        await rc('minecraft:give ' + username + ' minecraft:iron_sword[enchantments={levels:{"minecraft:unbreaking":2}}]');
        await rc('minecraft:give ' + username + ' minecraft:lapis_lazuli 7');
        await equip(bot, 'iron_sword');
        const menu = await open(bot, '/mycli imprint weapon');
        check('enchanting menu offers two visible weapon presets', title(menu, '法术刻印')
            && menu.slots[30]?.name === 'shield' && menu.slots[32]?.name === 'ender_pearl');
        const costMark = bot.lines.length;
        await bot.clickWindow(30, 0, 0);
        await line(bot, costMark, '已镌刻守卫');
        const guard = await engraving(bot);
        check('engraving keeps Unbreaking and records the selected preset and three gestures',
            (await enchantments(bot)).includes('minecraft:unbreaking') && guard.includes('guard')
            && (await selected(bot, '"minecraft:lore"[1]')).includes('命中敌怪')
            && (await selected(bot, '"minecraft:lore"[2]')).includes('右键 · 星芒箭')
            && (await selected(bot, '"minecraft:lore"[3]')).includes('潜行右键'));
        const lapis = () => bot.inventory.items().filter(item => item.name === 'lapis_lazuli').reduce((sum, item) => sum + item.count, 0);
        await until(() => bot.experience.level === 12 && lapis() === 4, 'single recipe cost');
        await line(bot, await chat(bot, '/mycli imprint weapon guard'), '本次免费');
        check('repeating the same engraving does not consume more XP or lapis', bot.experience.level === 12 && lapis() === 4);
        await line(bot, await chat(bot, '/mycli imprint frostnova'), '已有武器刻印');
        check('legacy command cannot silently replace the three-trigger engraving', await engraving(bot) === guard);
        if (!bot.inventory.items().some(item => item.name === 'compass')) await chat(bot, '/mycli compass');
        await equip(bot, 'compass');
        await airUse(bot);
        const lobby = await until(() => bot.currentWindow, 'physical skill compass');
        check('right-clicking the skill compass offers the wheel in the lobby',
            title(lobby, '冒险大厅') && title(await switchPage(bot, 32), '施法轮盘'));
        bot.closeWindow(bot.currentWindow);
        await airUse(bot, true);
        const shortcut = await until(() => bot.currentWindow, 'physical spell wheel shortcut');
        check('sneak-right-clicking the compass opens the wheel without a command', title(shortcut, '施法轮盘'));
        bot.closeWindow(bot.currentWindow);
        await equip(bot, 'iron_sword');

        await rc('minecraft:summon minecraft:husk 2.6 -52 0.5 {NoAI:1b,Silent:1b,Tags:["weapon_target"]}');
        const mob = await until(() => target(bot), 'training husk');
        await rc('minecraft:effect give ' + username + ' minecraft:instant_health 1 5 true');
        await until(() => bot.health >= 20, 'full health before fixture damage');
        await rc('minecraft:damage ' + username + ' 10 minecraft:generic');
        const initialHp = await until(() => bot.health <= 10 && bot.health, 'injured player');
        const initialMobHealth = await health();
        await bot.lookAt(mob.position.offset(0, 1, 0), true);
        bot.attack(mob);
        await until(() => bot.health > initialHp, 'heal after actual hit');
        check('landed melee hit deals base damage and heals the wounded attacker',
            await health() < initialMobHealth && bot.health === initialHp + 8);
        const healed = bot.health;
        await sleep(1550);
        bot.attack(mob);
        await sleep(320);
        check('a second hit during the original heal cooldown does not heal again', bot.health === healed);

        const useMark = await airUse(bot);
        await line(bot, useMark, '星芒箭命中');
        const sharedMark = bot.lines.length;
        const wheel = await open(bot, '/mycli skills wheel');
        check('ordinary right-click selects Starbolt, and the wheel exposes the same spell', title(wheel, '施法轮盘')
            && wheel.slots[14]?.name === 'amethyst_shard');
        await bot.clickWindow(14, 0, 0);
        await line(bot, sharedMark, '此法术还需');
        check('weapon and wheel share original spell cooldown', !bot.lines.slice(sharedMark).some(text => text.includes('星芒箭命中')));
        await sleep(350);
        await line(bot, await airUse(bot, true), '霜环：');
        check('sneaking right-click casts Frost Ring', true);

        const wheelMenu = await open(bot, '/mycli menu wheel');
        const common2 = await switchPage(bot, 30);
        check('both common pages expose eight selectable spells in their fixed wheel cells',
            wheelMenu !== common2 && common2.slots[16]?.name === 'firework_rocket' && common2.slots[19]?.name === 'glowstone_dust');
        await switchPage(bot, 28);
        const classPage = await switchPage(bot, 33);
        check('unselected class offers its skill book without a cast button', classPage.slots[13]?.name === 'book');
        await switchPage(bot, 33);
        await bot.clickWindow(19, 0, 0);
        check('waypoint wheel button opens destination selection', !!(await until(() => bot.currentWindow, 'waypoints')));
        bot.closeWindow(bot.currentWindow);

        await rc('minecraft:give ' + username + ' minecraft:shield');
        await equip(bot, 'shield', 'off-hand');
        const offhandMark = await airUse(bot);
        bot.activateItem(true);
        await sleep(280);
        bot.deactivateItem();
        check('an occupied offhand keeps item use free of weapon casts',
            !bot.lines.slice(offhandMark).some(text => /星芒箭命中|此法术还需/.test(text)));
        await rc('minecraft:clear ' + username + ' minecraft:shield');
        const chest = bot.blockAt(bot.entity.position.floored().offset(-1, 0, 2));
        await bot.activateBlock(chest);
        const chestWindow = await until(() => bot.currentWindow, 'ordinary chest');
        check('the sword still opens a real vanilla chest', chestWindow.slots.length >= 27 && !title(chestWindow, '施法轮盘'));
        bot.closeWindow(chestWindow);

        const mage = await connect('WheelMageQA' + tag);
        await rc('minecraft:tp ' + mage.username + ' 0.5 -52 4.5');
        await line(mage, await chat(mage, '/mycli profession choose mage --json'), '"saved":true');
        await open(mage, '/mycli menu wheel');
        const abilities = await switchPage(mage, 33);
        check('an actual learned class skill appears as a clickable native ability', abilities.slots[10]?.name === 'enchanted_book');
        const classMark = mage.lines.length;
        await mage.lookAt(mob.position.offset(0, 1, 0), true);
        await mage.clickWindow(10, 0, 0);
        await until(() => !mage.currentWindow, 'class spell dispatch closes the wheel');
        check('clicking a learned class spell reaches the original RPG caster', !!(await line(mage, classMark, '技能已执行')));
        await equip(mage, 'blaze_rod');
        await line(mage, await chat(mage, '/mycli imprint weapon guard'), '请主手持普通剑或战斧');
        const knight = await connect('WheelKnightQA' + tag);
        await line(knight, await chat(knight, '/mycli profession choose knight --json'), '"saved":true');
        await equip(knight, 'iron_sword');
        await rc('minecraft:tp ' + knight.username + ' 1.5 -52 0.5');
        await line(knight, await chat(knight, '/mycli imprint weapon skirmish'), '请主手持普通剑或战斧');
        check('native Vortex equipment keeps its original binding channel', (await selected(knight, '"minecraft:custom_data"'))
            .includes('knight_iron_resolve') && !(await engraving(knight)).includes('skirmish'));
        await line(bot, await chat(bot, '/mycli imprint weapon skirmish'), '已镌刻疾行');
        await until(() => bot.experience.level === 3 && lapis() === 1, 'second recipe cost');
        check('changing preset keeps vanilla enchantments and updates the three gesture hints',
            (await engraving(bot)).includes('skirmish') && (await enchantments(bot)).includes('minecraft:unbreaking')
            && (await selected(bot, '"minecraft:lore"[3]')).includes('闪现'));

        await rc('minecraft:xp set ' + username + ' 21 levels');
        await rc('minecraft:give ' + username + ' minecraft:iron_axe[enchantments={levels:{"minecraft:unbreaking":2}}]');
        await rc('minecraft:give ' + username + ' minecraft:lapis_lazuli 6');
        await equip(bot, 'iron_axe');
        const table = bot.blockAt(bot.entity.position.floored().offset(0, 0, 2));
        assert.equal(table?.name, 'enchanting_table');
        bot.setControlState('sneak', true);
        await sleep(120);
        await bot.activateBlock(table);
        const stack = await until(() => bot.currentWindow, 'sneaking at the enchanting table');
        bot.setControlState('sneak', false);
        check('enchanted axes can use the random recipe offered in the enchanting UI', stack.slots[31]?.name === 'enchanted_book');
        const rollMark = bot.lines.length;
        await bot.clickWindow(31, 0, 0);
        await line(bot, rollMark, '已镌刻随机');
        const firstRoll = await binding(bot);
        check('random weapon has three distinct individually persisted spell IDs',
            /"(?:selfheal|food|night):[a-z0-9_]{1,48}:[a-z0-9_]{1,48}"/.test(firstRoll)
            && new Set(firstRoll.split('"')[1].split(':')).size === 3);
        const second = await open(bot, '/mycli imprint weapon');
        assert.equal(second.slots[31]?.name, 'enchanted_book', 'reroll option displayed before the click');
        const rerollMark = bot.lines.length;
        await bot.clickWindow(31, 0, 0);
        await line(bot, rerollMark, '已镌刻随机');
        randomWeapon = await binding(bot);
        check('paid reroll changes the combination and retains vanilla enchantment',
            randomWeapon !== firstRoll && (await enchantments(bot)).includes('minecraft:unbreaking'));
        await until(() => bot.experience.level === 3 && lapis() === 1, 'two random recipe payments');
        await equip(bot, 'iron_sword');
        if (process.env.WEAPON_QA_FORMS === '1') {
            const reply = await rc('playeruiqa forms ' + mage.username);
            check('the real Floodgate Cumulus codec and callbacks accept both wheel pages',
                /PLAYER_UI_FORMS passed=true checks=15/.test(reply));
            const reward = await rc('playeruiqa reward ' + mage.username);
            check('native trial reward generation preserves enchantments and stores portable skill bindings',
                /WEAPON_REWARD_QA passed=true checks=8/.test(reward));
        }
    }
} catch (failure) {
    error = String(failure);
    for (const bot of bots) console.error(bot.username, bot.lines.slice(-15));
    throw failure;
} finally {
    for (const bot of bots) bot.quit();
    const report = process.argv.includes('--restart') ? 'weapon-restart.json' : 'weapon-gestures.json';
    await fs.writeFile(path.join(stage, report), JSON.stringify({ checks, error, randomWeapon }, null, 2) + '\n');
}
