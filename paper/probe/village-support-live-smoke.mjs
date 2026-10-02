import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({
  host: '192.168.3.163', port: 25565,
  username: `AfuVillage${Date.now().toString(36).slice(-5)}`,
  auth: 'offline', version: '1.20.6',
});
const village = [];
const life = [];
const messages = [];
bot.on('messagestr', text => messages.push(text));
bot._client.on('custom_payload', packet => {
  if (packet.channel !== 'mcagent:village' && packet.channel !== 'mcagent:life') return;
  const parsed = JSON.parse(Buffer.from(packet.data).toString('utf8'));
  (packet.channel === 'mcagent:village' ? village : life).push(parsed);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label) {
  for (let i = 0; i < 100; i++) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  bot.chat('/mycli village threat');
  await until(() => village.some(item => item.kind === 'status'), 'village status');
  const status = village.find(item => item.kind === 'status');
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.active, false);
  assert.equal(status.priority, 'none');
  bot.chat('/mycli village villagers');
  await until(() => village.some(item => item.kind === 'villagers'), 'village professions');
  assert.equal(village.find(item => item.kind === 'villagers').loadedOnly, true);
  bot.chat('/mycli life board');
  await until(() => messages.some(text => text.includes('trader_supply') || text.includes('村庄收购单')),
    'merchant guild on board');
  assert.ok(life.some(item => item.kind === 'status'));
  console.log('PASS live village: private state, profession query, merchant guild board');
} finally {
  bot.quit();
}
