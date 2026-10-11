// Actual vanilla/Mineflayer private-chat regression check. Loopback stage only.
// Install qd_private_chat.dsc in the isolated server before running this probe.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stage = resolve(process.env.MC_STAGE ?? 'E:/MC/staging/cormy-command-permissions-20261011');
const properties = readFileSync(`${stage}/server.properties`, 'utf8');
assert.match(properties, /^server-ip=127\.0\.0\.1\r?$/m);
assert.match(properties, /^server-port=25567\r?$/m);
const require = createRequire(process.env.MC_PROBE_PACKAGE ?? 'E:/MC/probe/package.json');
const { createBot } = require('mineflayer');
const names = ['ChatQAFrom', 'ChatQATo', 'ChatQAOther'];
const ops = JSON.parse(readFileSync(`${stage}/ops.json`, 'utf8'));
assert.ok(!ops.some(row => names.some(name => name.toLowerCase() === row.name.toLowerCase())));
const bots = [], report = { at: new Date().toISOString(), checks: [], messages: {}, whispers: {}, errors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail });
  assert.ok(pass, name);
}
async function until(condition, label) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await sleep(100); }
  throw new Error(`timeout: ${label}`);
}
async function send(alias, body, expectedBody = body) {
  const before = report.whispers[names[1]].length;
  bots[0].chat(`/${alias} ${names[1]} ${body}`);
  await until(() => report.whispers[names[1]].length > before, alias);
  await sleep(150);
  const delivered = report.whispers[names[1]].slice(before);
  check(`${alias}: one native whisper, actual sender, matching text`, delivered.length === 1
    && delivered[0].username === names[0] && delivered[0].message === expectedBody, delivered);
  check(`${alias}: no bystander delivery`, !report.messages[names[2]].some(line => line.includes(expectedBody)));
}
try {
  for (const username of names) {
    report.messages[username] = []; report.whispers[username] = [];
    const bot = createBot({ host: '127.0.0.1', port: 25567, username, auth: 'offline', version: '1.20.6' });
    bots.push(bot);
    bot.on('messagestr', line => report.messages[username].push(line));
    bot.on('whisper', (username, message) => report.whispers[bot.username].push({ username, message }));
    bot.on('error', error => report.errors.push(`${username}: ${error.message}`));
    bot.on('kicked', reason => report.errors.push(`${username}: ${JSON.stringify(reason)}`));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('login timeout')), 15000);
      bot.once('spawn', () => { clearTimeout(timer); resolve(); });
      bot.once('error', error => { clearTimeout(timer); reject(error); });
      bot.once('kicked', reason => { clearTimeout(timer); reject(new Error(JSON.stringify(reason))); });
    });
  }
  for (const alias of ['w', 'tell', 'whisper', 'msg', 'minecraft:msg']) await send(alias, `中文私聊-${alias}`);
  const literal = '<player.name> "literal quote" | /op ChatQAFrom &a  two  spaces';
  const before = report.whispers[names[1]].length;
  bots[0].chat(`/msg ${names[1]} ${literal}`);
  await until(() => report.whispers[names[1]].length > before, 'vanilla literal reference');
  // Mineflayer's component text conversion also changes quotes/spacing for
  // vanilla /msg. Compare aliases to that reference, not a handcrafted string.
  const reference = report.whispers[names[1]].at(-1).message;
  check('literal tags remain text', reference.includes('<player.name>'));
  for (const alias of ['w', 'tell', 'whisper']) await send(alias, literal, reference);
  const beforeErrors = report.messages[names[0]].length;
  bots[0].chat('/w'); await sleep(300);
  bots[0].chat('/tell ChatQAMissing no-offline-delivery'); await sleep(300);
  check('bad arguments and offline recipient give feedback', report.messages[names[0]].length >= beforeErrors + 2);
  check('OP list unchanged', JSON.stringify(JSON.parse(readFileSync(`${stage}/ops.json`, 'utf8'))) === JSON.stringify(ops));
  check('no client errors', report.errors.length === 0, report.errors);
  report.pass = true;
} catch (error) { report.pass = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  for (const bot of bots) bot.quit('private chat regression complete');
  if (process.env.MC_PROBE_REPORT) writeFileSync(process.env.MC_PROBE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, failure: report.failure }));
}
