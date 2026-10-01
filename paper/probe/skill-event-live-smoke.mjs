// Non-destructive production smoke: a temporary ordinary account casts fireworks once.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565,
  username: `EvtLive${Date.now().toString(36).slice(-6)}`,
  auth: 'offline', version: '1.20.6' });
const events = [];
const chats = [];
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:event') events.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
bot.on('messagestr', line => chats.push(line));

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('spawn timeout')), 30000);
    bot.once('spawn', () => { clearTimeout(timer); resolve(); });
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  await sleep(2500);
  bot.chat('/mycli cast fireworks');
  for (let i = 0; i < 100 && events.length < 1; i++) await sleep(100);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.kind, 'skill');
  assert.equal(event.id, 'fireworks');
  assert.ok(['x', 'y', 'z'].every(axis => Number.isFinite(event.position?.[axis])));
  assert.ok(!chats.some(line => line.includes('mcagent:event') || line.includes('"kind":"skill"')));
  console.log(JSON.stringify({ verdict: 'PASS', account: bot.username,
    id: event.id, position: event.position, chatCopies: 0 }));
} finally {
  bot.quit();
}
