// Isolated 25566 test: entrance button opens controller-friendly difficulty picker before starting party.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const suffix = String(Date.now()).slice(-6);
const bots = [];
const connect = async prefix => {
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25566, username: `${prefix}${suffix}`,
    auth: 'offline', version: '1.20.6',
  });
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  bot.on('error', () => {});
  bots.push(bot);
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  return bot;
};
const until = async (test, label, timeout = 18000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`${label}: ${bots.map(bot => `${bot.username}: ${bot.lines.slice(-7).join(' | ')}`).join('\n')}`);
};
const nextWindow = bot => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`menu timeout for ${bot.username}`)), 5000);
  bot.once('windowOpen', window => { clearTimeout(timer); resolve(window); });
});

try {
  const a = await connect('DiffA');
  const b = await connect('DiffB');
  rcon(`minecraft:tp ${a.username} -594.5 91 -312.5`);
  rcon(`minecraft:tp ${b.username} -590.5 91 -320.5`);
  await until(() => Math.abs(a.entity.position.y - 91) < 2
    && Math.abs(b.entity.position.y - 91) < 2, 'both at entrance');
  const button = a.blockAt(new Vec3(-596, 92, -313));
  assert.equal(button?.name, 'stone_button');
  assert.equal(a.heldItem?.name, 'player_head', 'test presses button while holding the backpack head');
  a.activateBlock(button);
  await until(() => a.currentWindow?.slots[10]?.name === 'compass'
    && JSON.stringify(a.currentWindow.title).includes('试炼难度'),
    'entrance difficulty menu wins over backpack use');
  const menu = a.currentWindow;
  assert.equal(menu.slots[10]?.name, 'compass');
  assert.equal(menu.slots[11]?.name, 'wooden_sword');
  assert.equal(menu.slots[12]?.name, 'iron_sword');
  assert.equal(menu.slots[13]?.name, 'diamond_sword');
  assert.equal(menu.slots[16]?.name, 'lime_concrete');
  assert.equal(a.entity.position.y > 80, true, 'pressing entrance button must not start automatically');

  for (const [slot, expected] of [[13, '末日'], [11, '普通'], [12, '冒险']]) {
    const refreshed = nextWindow(a);
    await a.clickWindow(slot, 0, 0);
    const selectedMenu = await refreshed;
    await until(() => selectedMenu.slots[16]?.name === 'lime_concrete',
      `${expected} selection menu loaded`);
    assert.match(JSON.stringify(selectedMenu.slots[16]), new RegExp(expected));
  }
  const lineAt = a.lines.length;
  a.chat('/mycli arena difficulty list');
  await until(() => a.lines.slice(lineAt).some(line => line.includes('MC_DUNGEON_DIFFICULTY selected=adventure')),
    'selected adventure reflected in Agent status');

  await a.clickWindow(16, 0, 0);
  await until(() => Math.abs(a.entity.position.y - 69) < 2
    && Math.abs(b.entity.position.y - 69) < 2, 'starter and nearby teammate enter together');
  assert.ok(a.lines.some(line => line.includes('MC_DUNGEON_START difficulty=adventure')));
  assert.ok(b.lines.some(line => line.includes('MC_DUNGEON_START difficulty=adventure')));
  b.chat('/mycli arena status');
  await until(() => b.lines.some(line => line.startsWith('MC_DUNGEON status ')
    && line.includes('participant=true') && line.includes('globalDifficulty=adventure')),
    'teammate sees actual run difficulty');
  a.chat('/mycli arena leave');
  b.chat('/mycli arena leave');
  console.log(JSON.stringify({ result: 'PASS', menuFromEntrance: true,
    selected: 'adventure', starter: a.username, teammate: b.username }));
} finally {
  for (const bot of bots) bot.quit();
}
process.exit(0);
