// Isolated 1.20.6 stage integration test. No production connection or data writes.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const execFileAsync = promisify(execFile);
const rcon = async (cmd) => {
    try {
        return (await execFileAsync('node', [
            'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', cmd],
            { timeout: 10_000, windowsHide: true })).stdout;
    } catch (error) {
        // Several vanilla commands execute successfully but produce an empty RCON reply.
        if (error.code === 4 && error.stdout?.includes('auth ok')) return error.stdout;
        throw error;
    }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const eventNames = new Set(['action_bar', 'set_action_bar_text', 'set_title_text', 'set_subtitle_text',
    'set_titles_animation', 'clear_titles', 'boss_bar', 'boss', 'advancements',
    'system_chat', 'disguised_chat', 'entity_effect', 'remove_entity_effect']);
const received = { AfuDungeonProbe3: [], CortiCam: [] };
const bots = [];
const hasEffect = (username, packet, effectId) => received[username].some((entry) =>
    entry.name === packet && JSON.parse(entry.data).effectId === effectId);
function start(username) {
    const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, version: '1.20.6',
        username, auth: 'offline', hideErrors: false });
    bot._client.on('packet', (data, meta) => {
        const encoded = JSON.stringify(data) ?? '';
        if (!eventNames.has(meta.name) && !encoded.includes('MIRROR_WHISPER_TEST')) return;
        received[username].push({ name: meta.name, data: encoded.slice(0, 1200) });
    });
    bot.on('error', (error) => console.error(`${username} error: ${error}`));
    bot.on('kicked', (reason) => console.error(`${username} kicked: ${reason}`));
    bots.push(bot);
    return new Promise((resolve, reject) => {
        bot.once('spawn', () => resolve(bot));
        bot.once('end', (reason) => reject(new Error(`${username} ended before spawn: ${reason}`)));
    });
}
try {
    const target = await start('AfuDungeonProbe3');
    await rcon('effect clear AfuDungeonProbe3 minecraft:night_vision');
    await rcon('effect give AfuDungeonProbe3 minecraft:speed 60 0 true');
    const camera = await start('CortiCam');
    await sleep(3000); // plugin must reattach after both players join, without RCON
    if (!hasEffect('CortiCam', 'entity_effect', 15)) {
        throw new Error('Camera did not receive its own night vision');
    }
    if (!hasEffect('CortiCam', 'entity_effect', 0)) {
        throw new Error('Camera did not receive target speed effect on attach');
    }
    await rcon('effect clear AfuDungeonProbe3 minecraft:speed');
    await rcon('effect give AfuDungeonProbe3 minecraft:speed 60 0 true');
    await sleep(500);
    if (!received.CortiCam.some(entry => entry.name === 'entity_effect'
            && JSON.parse(entry.data).effectId === 0
            && JSON.parse(entry.data).entityId === camera.entity.id)) {
        throw new Error('Target speed effect was not remapped onto camera HUD');
    }
    if (hasEffect('AfuDungeonProbe3', 'entity_effect', 15)) {
        throw new Error('Target received camera-only night vision');
    }
    await rcon('advancement revoke AfuDungeonProbe3 only minecraft:story/mine_stone');
    for (const cmd of [
        'title AfuDungeonProbe3 actionbar {"text":"MIRROR_ACTIONBAR_TEST"}',
        'title AfuDungeonProbe3 title {"text":"MIRROR_TITLE_TEST"}',
        'tellraw AfuDungeonProbe3 {"text":"MIRROR_PRIVATE_TEST"}',
        'tellraw @a {"text":"MIRROR_BROADCAST_TEST"}',
        'tell AfuDungeonProbe3 MIRROR_WHISPER_TEST',
        'bossbar add cortieye:test {"text":"MIRROR_BOSS_TEST"}',
        'bossbar set cortieye:test players AfuDungeonProbe3',
        'advancement grant AfuDungeonProbe3 only minecraft:story/mine_stone'
    ]) await rcon(cmd);
    target.chat('/mycli status');
    await sleep(2200);
    const markers = ['MIRROR_ACTIONBAR_TEST', 'MIRROR_TITLE_TEST',
        'MIRROR_PRIVATE_TEST', 'MIRROR_BROADCAST_TEST', 'MIRROR_WHISPER_TEST',
        'MIRROR_BOSS_TEST', '魔力'];
    for (const name of Object.keys(received)) {
        console.log(`${name} packets:`, received[name].length);
        for (const marker of markers) console.log(`${name} ${marker}:`,
            received[name].filter((entry) => entry.data.includes(marker)).map((entry) => entry.name));
        console.log(`${name} advancement packets:`, received[name].filter((entry) => entry.name === 'advancements').length);
        console.log(`${name} actionbar packets:`, received[name].filter((entry) => entry.name === 'action_bar').length);
        console.log(`${name} effect packets:`, received[name].filter((entry) => entry.name === 'entity_effect'));
        console.log(`${name} bossbar packets:`, received[name].filter((entry) => entry.name === 'boss_bar'));
    }
    for (const marker of markers) {
        if (received.CortiCam.filter((entry) => entry.data.includes(marker)).length !== 1) {
            throw new Error(`Camera expected exactly one native packet for ${marker}`);
        }
    }
    if (received.CortiCam.filter((entry) => entry.name === 'advancements').length < 2) {
        throw new Error('Camera did not receive target advancement changes');
    }
    await rcon('effect clear AfuDungeonProbe3 minecraft:speed');
    await sleep(250);
    if (!hasEffect('CortiCam', 'remove_entity_effect', 0)) {
        throw new Error('Camera did not receive target speed-effect removal');
    }
    if (hasEffect('CortiCam', 'remove_entity_effect', 15)) {
        throw new Error('Camera night vision was removed while mirroring target effects');
    }
    await rcon('gamemode survival CortiCam');
    await sleep(300);
    await rcon('title AfuDungeonProbe3 title {"text":"MIRROR_DETACHED_TEST"}');
    await sleep(400);
    if (received.CortiCam.some((entry) => entry.data.includes('MIRROR_DETACHED_TEST'))) {
        throw new Error('Camera received target title after spectator detach');
    }
    console.log('detach gate: passed');
    await rcon('bossbar remove cortieye:test');
} finally {
    for (const bot of bots) bot.quit();
}
