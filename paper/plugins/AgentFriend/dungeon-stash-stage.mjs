// Run against the isolated 25566 Paper server. A second invocation with the
// printed player name checks persistence after an isolated server restart.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rcon = (command) => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const name = process.argv[2] ?? `StashA${String(Date.now()).slice(-7)}`;
const verifyOnly = process.argv.length > 2;
const other = `StashB${String(Date.now()).slice(-7)}`;
const connect = async (username) => {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username, auth: 'offline', version: '1.20.6' });
  const lines = [];
  bot.on('messagestr', (line) => lines.push(line));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  return { bot, lines };
};
const ask = async (client, command, ms = 400) => {
  client.lines.length = 0;
  client.bot.chat(command);
  await sleep(ms);
  return client.lines.join('\n');
};
const until = async (test, label, ms = 15000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
};

let a = await connect(name);
let b;
try {
  if (verifyOnly) {
    assert.match(await ask(a, '/mycli arena stash list'), /MC_STASH slot=1 id=minecraft:diamond count=1/);
    const existingStash = await ask(a, '/mycli arena stash list');
    const storedCrossbow = existingStash.match(/MC_STASH slot=(\d+) id=minecraft:crossbow count=1/);
    if (storedCrossbow)
      assert.match(await ask(a, `/mycli arena stash take ${storedCrossbow[1]} 1`), /MC_STASH_TAKE .*id=minecraft:crossbow moved=1/);
    if (existingStash.includes('MC_STASH slot=2 ') && storedCrossbow?.[1] !== '2')
      assert.match(await ask(a, '/mycli arena stash take 2'), /MC_STASH_TAKE slot=2 .* moved=[1-9]/);
    rcon(`minecraft:give ${name} minecraft:cobblestone 4`);
    await until(() => a.bot.inventory.items().some((item) => item.name === 'cobblestone'), 'given cobblestone');
    const opened = new Promise((resolve) => a.bot.once('windowOpen', resolve));
    a.bot.chat('/mycli arena stash');
    const chest = await opened;
    const source = chest.slots.findIndex((item, slot) => slot >= 27 && item?.name === 'cobblestone');
    assert.ok(source >= 27, 'cobblestone is visible in the player half of the chest');
    const stackSize = chest.slots[source].count;
    await a.bot.clickWindow(source, 0, 0);
    await a.bot.clickWindow(1, 0, 0);
    assert.equal(chest.slots[1]?.name, 'cobblestone');
    a.bot.closeWindow(chest);
    assert.match(await ask(a, '/mycli arena stash list'), new RegExp(`MC_STASH slot=2 id=minecraft:cobblestone count=${stackSize}`));
    const reopened = new Promise((resolve) => a.bot.once('windowOpen', resolve));
    a.bot.chat('/mycli arena stash');
    const chestAgain = await reopened;
    await a.bot.clickWindow(1, 0, 1);
    a.bot.closeWindow(chestAgain);
    assert.doesNotMatch(await ask(a, '/mycli arena stash list'), /MC_STASH slot=2 /);
    const rewards = await ask(a, '/mycli arena rewards list');
    const bonusId = rewards.match(/MC_REWARD slot=9 id=minecraft:([a-z_]+) count=\d+/)?.[1];
    if (bonusId) {
      assert.match(await ask(a, '/mycli arena rewards take 9'), /领取了随机战利品 \d+ 件/);
      await until(() => a.bot.inventory.items().some((item) => item.name === bonusId), 'bonus in inventory');
      await a.bot.equip(a.bot.inventory.items().find((item) => item.name === bonusId), 'hand');
      assert.equal(a.bot.heldItem?.name, bonusId, 'reward item can be equipped by the agent');
    }
    const inventory = await ask(a, '/mycli arena stash inventory');
    const crossbow = inventory.match(/MC_INVENTORY slot=(\d+) id=minecraft:crossbow count=1 name=([^ ]+) enchants=([^ \n]+)/);
    if (crossbow) {
      const slot = Number(crossbow[1]);
      assert.match(await ask(a, `/mycli arena stash putslot ${slot} 1`), /MC_STASH_PUT .*id=minecraft:crossbow moved=1/);
      const stash = await ask(a, '/mycli arena stash list');
      const stored = stash.match(/MC_STASH slot=(\d+) id=minecraft:crossbow count=1 name=([^ ]+) enchants=([^ \n]+)/);
      const stashSlot = Number(stored?.[1]);
      assert.ok(stashSlot >= 1, stash);
      assert.equal(stored[2], crossbow[2], 'custom name survives storage');
      assert.equal(stored[3], crossbow[3], 'enchantments survive storage');
      assert.match(await ask(a, `/mycli arena stash take ${stashSlot} 1`), /MC_STASH_TAKE .*id=minecraft:crossbow moved=1/);
    }
    await ask(a, '/mycli arena rewards take all');
    assert.match(await ask(a, '/mycli arena rewards list'), /MC_REWARD_SUMMARY visible=0 queuedBonus=0/);
    console.log(JSON.stringify({ verdict: 'PASS', phase: 'after-restart', player: name }));
  } else {
    b = await connect(other);
    rcon(`minecraft:give ${name} minecraft:diamond 3`);
    await until(() => a.bot.inventory.items().some((item) => item.name === 'diamond'), 'given diamonds');
    assert.match(await ask(a, '/mycli arena stash put minecraft:diamond 2'), /MC_STASH_PUT id=minecraft:diamond moved=2 requested=2/);
    assert.match(await ask(a, '/mycli arena stash list'), /MC_STASH slot=1 id=minecraft:diamond count=2/);
    assert.match(await ask(b, '/mycli arena stash list'), /MC_STASH_SUMMARY occupied=0\/27/);
    assert.match(await ask(a, '/mycli arena stash take 1 1'), /MC_STASH_TAKE slot=1 id=minecraft:diamond moved=1/);
    assert.match(await ask(a, '/mycli arena stash list'), /MC_STASH slot=1 id=minecraft:diamond count=1/);

    const rewardOpen = new Promise((resolve) => a.bot.once('windowOpen', resolve));
    a.bot.chat('/mycli arena rewards');
    const rewardWindow = await rewardOpen;
    assert.equal(rewardWindow.slots[22]?.name, 'chest');
    const stashOpen = new Promise((resolve) => a.bot.once('windowOpen', resolve));
    await a.bot.clickWindow(22, 0, 0);
    const stashWindow = await stashOpen;
    assert.equal(stashWindow.slots[0]?.name, 'diamond');
    assert.equal(stashWindow.slots[0]?.count, 1);
    a.bot.closeWindow(stashWindow);

    assert.match(await ask(a, '/mycli guild accept first_step'), /已接公会委托/);
    rcon(`minecraft:tp ${name} -589.5 91 -304.5`);
    await until(() => Math.abs(a.bot.entity.position.x + 589.5) < 2, 'lobby arrival');
    assert.match(await ask(a, '/mycli arena start'), /试炼|进入第/);
    await until(() => a.bot.entity.position.y < 80, 'first floor');
    rcon(`minecraft:effect give ${name} minecraft:resistance 180 4 true`);
    await sleep(3800);
    rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    await until(() => a.lines.some((line) => line.includes('第 1/10 层已通关')), 'floor clear');
    assert.match(await ask(a, '/mycli guild claim'), /委托交付成功/);
    const rewards = await ask(a, '/mycli arena rewards list');
    const emeralds = Number(rewards.match(/MC_REWARD slot=0 id=minecraft:emerald count=(\d+)/)?.[1]);
    assert.ok(emeralds > 0, rewards);
    assert.match(rewards, /MC_REWARD slot=1 id=minecraft:iron_ingot count=1/);
    assert.match(await ask(a, '/mycli arena rewards take 0'), new RegExp(`从奖励箱领取了 ${emeralds} × 绿宝石`));
    assert.doesNotMatch(await ask(a, '/mycli arena rewards list'), /MC_REWARD slot=0 /);
    assert.doesNotMatch(await ask(b, '/mycli arena rewards list'), /MC_REWARD slot=0 /);
    a.bot.quit();
    await sleep(500);
    a = await connect(name);
    assert.match(await ask(a, '/mycli arena stash list'), /MC_STASH slot=1 id=minecraft:diamond count=1/);
    console.log(JSON.stringify({ verdict: 'PASS', phase: 'session', player: name, other }));
  }
} finally {
  a.bot.quit();
  b?.bot.quit();
}
