// Verify the LAN gateway reaches Paper without occupying an Agent identity.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const username = 'AfuGateProbe';
const whitelist = JSON.parse(readFileSync('E:/MC/server/whitelist.json', 'utf8'));
const whitelistEnabled = /^white-list=true\s*$/m.test(
  readFileSync('E:/MC/server/server.properties', 'utf8'));
if (whitelist.some(entry => entry.name?.toLowerCase() === username.toLowerCase())) {
  throw new Error(`${username} must not be whitelisted for this probe`);
}

const bot = mineflayer.createBot({
  host: '192.168.3.163', port: 25565, username,
  auth: 'offline', version: '1.20.6',
});
let done = false;
const finish = (code, message) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  console.log(message);
  try { bot.quit(); } catch {}
  setTimeout(() => process.exit(code), 300);
};
const timer = setTimeout(() => finish(1, 'FAIL gateway/Paper response timeout'), 15000);
bot.once('kicked', reason => {
  const detail = typeof reason === 'string' ? reason : JSON.stringify(reason);
  finish(whitelistEnabled && /whitelist/i.test(detail) ? 0 : 1,
    whitelistEnabled && /whitelist/i.test(detail)
      ? 'OK LAN gateway reached Paper; unlisted identity was rejected by whitelist'
      : `FAIL unexpected Paper rejection: ${detail}`);
});
bot.once('spawn', () => finish(whitelistEnabled ? 1 : 0, whitelistEnabled
  ? 'FAIL probe identity unexpectedly entered while whitelist is enabled'
  : 'OK LAN gateway reached Paper; unlisted probe joined while whitelist is disabled'));
bot.once('error', error => finish(1, `FAIL ${error.message}`));
