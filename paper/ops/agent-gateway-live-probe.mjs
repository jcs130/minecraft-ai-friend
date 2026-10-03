// Read-only login gate check from the server host. These identities must be
// rejected before Paper join; abort immediately if either is admitted.
import { createRequire } from 'node:module';

const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');

async function rejected(name) {
  const bot = mineflayer.createBot({ host: '192.168.3.163', port: 25565,
    version: '1.20.6', username: name, auth: 'offline', hideErrors: true });
  bot.on('error', () => {});
  bot._client.on('error', () => {});
  const joined = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} login timeout`)), 8000);
    bot.once('spawn', () => { clearTimeout(timeout); resolve(true); });
    bot.once('end', () => { clearTimeout(timeout); resolve(false); });
  });
  if (joined) bot.quit();
  return !joined;
}

for (const name of ['UnregisteredEye', 'CortiEye'])
  if (!await rejected(name)) throw new Error(`${name} was admitted from an unauthorized source`);
console.log('PASS: unregistered Eye and protected CortiEye rejected from this host');
