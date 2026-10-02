import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const username = `LifeRead${Date.now().toString(36).slice(-6)}`;
const bot = mineflayer.createBot({
  host: '192.168.3.163', port: 25565, username, auth: 'offline', version: '1.20.6',
});
const chat = [];
const receipts = [];
bot.on('messagestr', message => chat.push(message));
bot._client.on('custom_payload', packet => {
  if (packet.channel !== 'mcagent:life') return;
  const data = Buffer.from(packet.data);
  assert.ok(data.length <= 16_384);
  receipts.push(JSON.parse(data.toString('utf8')));
});

const timeout = setTimeout(() => bot.end('read-only smoke timeout'), 15_000);
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
  });
  bot._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from('mcagent:life'),
  });
  bot.chat('/mycli life status');
  while (!receipts.some(receipt => receipt.kind === 'status')) {
    if (!bot._client.state || bot._client.state === 'disconnected') throw new Error('disconnected');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  bot.chat('/mycli life board');
  while (!chat.some(message => message.includes('tinkerer_light'))) {
    if (!bot._client.state || bot._client.state === 'disconnected') throw new Error('disconnected');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const receipt = receipts.find(item => item.kind === 'status');
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.activeId, '');
  console.log(`PASS production life guild read-only: ${username}, six-board=true, private-status=true`);
} finally {
  clearTimeout(timeout);
  bot.end('read-only smoke complete');
}
