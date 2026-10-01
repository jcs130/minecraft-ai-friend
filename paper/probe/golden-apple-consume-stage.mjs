// Isolated Paper 1.20.6 check: one use of a 16-stack must leave 15 on server
// and send that count on the player's own container-0 connection.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = promisify(execFile);
const rcon = async command => (await run('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' })).stdout;
const name = `AppleQA${String(Date.now()).slice(-5)}`;
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
const events = [];
const count = item => item?.itemCount ?? item?.count ?? 0;
bot._client.on('packet', (packet, meta) => {
  if (meta.name !== 'set_slot' && meta.name !== 'window_items') return;
  const container = packet.windowId ?? packet.containerId ?? packet.window_id;
  if (container !== 0) return;
  if (meta.name === 'set_slot') {
    events.push({ type: meta.name, container, slot: packet.slot,
      itemId: packet.item?.itemId ?? null, count: count(packet.item) });
  } else {
    const items = packet.items ?? [];
    const apples = items.flatMap((item, slot) =>
      item?.itemId === bot.registry.itemsByName.golden_apple.id
        ? [{ slot, count: count(item) }] : []);
    events.push({ type: meta.name, container, apples });
  }
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('spawn timeout')), 30000);
    bot.once('spawn', () => { clearTimeout(timer); resolve(); });
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  // Fresh AuraSkills and Minepacks profiles can briefly hold the server thread.
  await sleep(2500);
  await rcon(`minecraft:give ${name} minecraft:golden_apple 16`);
  for (let i = 0; i < 30 && !bot.inventory.items().some(item =>
    item.name === 'golden_apple' && item.count === 16); i++) await sleep(100);
  const apple = bot.inventory.items().find(item => item.name === 'golden_apple');
  assert.equal(apple?.count, 16, 'client starts with 16 golden apples');
  await bot.equip(apple, 'hand');
  await sleep(200);
  const before = await rcon(`minecraft:data get entity ${name} Inventory[{id:"minecraft:golden_apple"}]`);
  assert.match(before, /count: 16\b/, 'server starts with 16 golden apples');
  events.length = 0;
  await bot.consume();
  await sleep(300);
  const after = await rcon(`minecraft:data get entity ${name} Inventory[{id:"minecraft:golden_apple"}]`);
  const held = bot.heldItem;
  assert.equal(held?.count, 15, 'client should show 15 after one use');
  assert.match(after, /count: 15\b/, 'server must retain 15');
  assert.ok(events.some(event => event.type === 'set_slot'
    && event.itemId === bot.registry.itemsByName.golden_apple.id && event.count === 15)
    || events.some(event => event.type === 'window_items'
      && event.apples.some(item => item.count === 15)),
  'server must send count 15 in container-0 slot/content packet');
  console.log(JSON.stringify({ name, before, after, events }));
} finally {
  bot.quit();
}
