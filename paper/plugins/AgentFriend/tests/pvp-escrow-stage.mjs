import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const [mode, rootArg, java, clientManifest, scope] = process.argv.slice(2);
const gameplayOnly = scope === '--gameplay-only';
if (!['baseline', 'candidate'].includes(mode) || !rootArg || !java || !clientManifest || (scope && (!gameplayOnly || mode !== 'candidate')))
  throw Error('Usage: node pvp-escrow-stage.mjs baseline|candidate <disposable stage> <java> <mineflayer package.json> [--gameplay-only]');
const root = await fs.realpath(rootArg);
const properties = path.join(root, 'server.properties');
const cfg = await fs.readFile(properties, 'utf8');
if ((await fs.readFile(path.join(root, '.pvp-escrow-qa'), 'utf8')).trim() !== 'disposable local PvP test only'
    || !/^server-ip=127\.0\.0\.1\r?$/m.test(cfg) || !/^server-port=25966\r?$/m.test(cfg)
    || !/^rcon\.port=25967\r?$/m.test(cfg) || !/^level-name=world\r?$/m.test(cfg))
  throw Error('Dedicated loopback-only fixture required');
const require = createRequire(path.resolve(clientManifest));
const mineflayer = require('mineflayer'), nbt = require('prismarine-nbt');
const escrow = path.join(root, 'plugins', 'AgentFriend', 'pvp-escrow.yml');
const commandLocal = (text, ms = 3500) => command(text, ms, { properties, port: 25967 });
const alpha = 'PvpQaAlpha', beta = 'PvpQaBeta';
let server, exited;
const checks = [], bots = new Set();
const open = port => new Promise(resolve => {
  const conn = net.createConnection({ host: '127.0.0.1', port });
  conn.once('connect', () => { conn.destroy(); resolve(true); });
  conn.once('error', () => resolve(false));
});
async function waitFor(probe, label, ms = 20000) {
  const until = Date.now() + ms;
  do {
    const result = await probe();
    if (result) return result;
    await delay(200);
  } while (Date.now() < until);
  throw Error('Timed out: ' + label);
}
async function boot() {
  assert.equal(await open(25966), false); assert.equal(await open(25967), false);
  const log = openSync(path.join(root, mode + '-operator.log'), 'a');
  server = spawn(java, ['-Xms512m','-Xmx2g','-XX:ActiveProcessorCount=2','-Dterminal.jline=false',
    '-Dterminal.ansi=false','-jar','server.jar','nogui'], { cwd: root, stdio: ['pipe', log, log], windowsHide: true });
  closeSync(log);
  exited = once(server, 'exit');
  await waitFor(async () => {
    if (server.exitCode !== null) throw Error('Isolated server exited before ready: ' + server.exitCode);
    try { return /PvpEscrowFixture/.test(await commandLocal('plugins')); } catch { return false; }
  }, 'server startup', 120000);
}
async function stop() {
  for (const bot of bots) bot.quit();
  bots.clear();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.stdin.write('stop\n');
    await Promise.race([exited, delay(25000, null, { ref: false })]);
    if (server.exitCode === null && server.signalCode === null) throw Error('Isolated server did not stop');
  }
}
async function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25966, username, auth: 'offline',
    version: '1.21.1', hideErrors: true });
  installRecipePacketBypass(bot);
  bots.add(bot);
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  bot.on('error', () => {});
  await Promise.race([once(bot, 'spawn'), once(bot, 'kicked').then(([why]) => { throw Error('fixture kicked: ' + why); }),
    delay(20000, null, { ref: false }).then(() => { throw Error('spawn timeout'); })]);
  return bot;
}
async function disconnect(bot) {
  bot.quit(); bots.delete(bot);
  await waitFor(async () => !(await commandLocal('list')).includes(bot.username), 'disconnect');
}
async function qa(action, who = alpha, other = '') {
  const raw = (await commandLocal('pvpqa ' + action + ' ' + who + (other ? ' ' + other : ''))).trim();
  assert.doesNotMatch(raw, /FIXTURE_ERROR|Unknown command/);
  assert.match(raw, /diamonds=\d+/);
  return Object.fromEntries([...raw.matchAll(/(\w+)=([\w-]+)/g)].map(m => [m[1], m[2]]));
}
function original(s) {
  assert.equal(s.diamonds, '5'); assert.equal(s.swords, '0');
  assert.equal(s.boots, '1'); assert.equal(s.offhand, 'TORCH');
}
async function diskItems(uuid) {
  const { parsed } = await nbt.parse(await fs.readFile(path.join(root, 'world', 'playerdata', uuid + '.dat')));
  return new Set((nbt.simplify(parsed).Inventory ?? []).map(x => x.id));
}
async function check(label, fn) {
  try { await fn(); checks.push({ label, passed: true }); }
  catch (error) { checks.push({ label, passed: false, error: error.message }); }
  console.log(JSON.stringify(checks.at(-1)));
}
async function crashCase(action, expectSaved, expectPending, expectCode) {
  const bot = await connect(alpha), uuid = bot.player.uuid;
  await qa('prime');
  assert.ok((await diskItems(uuid)).has('minecraft:iron_sword'));
  const sent = commandLocal('pvpqa ' + action + ' ' + alpha, 2500).catch(() => {});
  const exit = await Promise.race([exited, delay(18000, null, { ref: false }).then(() => { throw Error('No fault exit'); })]);
  await sent;
  bots.delete(bot);
  const data = await fs.readFile(escrow, 'utf8');
  const items = await diskItems(uuid);
  assert.equal(data.includes(uuid + ':'), expectPending, 'crash must retain escrow until the real player image is saved');
  assert.equal(items.has('minecraft:diamond'), expectSaved, 'crash checkpoint player file');
  assert.equal(exit[0], expectCode);
  await boot();
  const rejoined = await connect(alpha);
  const restored = await waitFor(async () => {
    const state = await qa('state');
    return state.pending === 'false' && state.locked === 'false' && state;
  }, 'recovered after crash');
  original(restored);
  assert.ok((await diskItems(uuid)).has('minecraft:diamond'));
  await disconnect(rejoined);
}
try {
  await boot();
  let a = await connect(alpha);
  await check('final escrow write failure blocks transfer and retries without duplicating', async () => {
    await qa('prime');
    const failed = await qa('write-fault');
    const attempted = await qa('transfer');
    const restored = await qa('recover');
    original(restored);
    assert.equal(restored.pending, 'false');
    assert.equal(failed.pending, 'true');
    assert.equal(attempted.transfer, 'false', 'a player must not transfer restored items while escrow remains');
    assert.equal(failed.locked, 'true');
    assert.equal((await qa('recover')).diamonds, '5');
    assert.equal((await qa('transfer')).transfer, 'true', 'normal interaction resumes after commit');
    assert.equal((await qa('recover')).diamonds, '0', 'recovery cannot recreate items after commit');
  });
  if (mode === 'candidate') {
    for (const fault of ['silent-save', 'throw-save']) await check(fault + ' preserves escrow and locks transfer', async () => {
      await qa('prime');
      const failed = await qa(fault);
      assert.equal(failed.phase, 'restoring');
      assert.equal(failed.locked, 'true');
      assert.ok((await diskItems(a.player.uuid)).has('minecraft:iron_sword'));
      assert.equal((await qa('transfer')).transfer, 'false');
      original(await qa('recover'));
    });
    await check('snapshot write failure issues neither kit', async () => {
      const b = await connect(beta);
      try {
        const state = await qa('pair-write-fault', alpha, beta);
        original(state); assert.equal(state.pending, 'false');
        const other = await qa('state', beta);
        original(other); assert.equal(other.pending, 'false');
      } finally { await disconnect(b); }
    });
    await check('an empty original inventory restores without granting items', async () => {
      await qa('prime-empty');
      const restored = await qa('recover');
      assert.equal(restored.pending, 'false'); assert.equal(restored.locked, 'false');
      assert.equal(restored.diamonds, '0'); assert.equal(restored.swords, '0');
      assert.equal(restored.boots, '0'); assert.equal(restored.offhand, 'AIR');
    });
    await check('normal duel restores full slots, removes escrow and retains result', async () => {
      const b = await connect(beta);
      assert.equal((await qa('pair', alpha, beta)).swords, '1');
      const active = await waitFor(async () => { const s = await qa('state'); return s.live === 'true' && s; }, 'normal match started');
      assert.equal((await qa('delayed-resume')).swords, '1', 'an old callback cannot restore a newer duel');
      b.chat('/mycli pvp leave');
      await waitFor(() => a.lines.some(line => line.includes('MC_PVP_RESULT outcome=win reason=forfeit')), 'normal match result');
      const restored = await qa('state');
      original(restored);
      original(await qa('state', beta));
      assert.equal(restored.pending, 'false');
      assert.ok(Number(restored.rating) > Number(active.rating), 'existing victory rating is applied');
      await disconnect(b);
    });
    await check('disconnected fighter recovers once on reconnect', async () => {
      let b = await connect(beta);
      assert.equal((await qa('pair', alpha, beta)).swords, '1');
      await disconnect(b);
      await waitFor(async () => (await qa('state')).diamonds === '5', 'other fighter restored');
      b = await connect(beta);
      original(await waitFor(async () => { const s = await qa('state', beta); return s.pending === 'false' && s; }, 'rejoin'));
      await disconnect(b);
    });
    await check('death does not drop the kit and restores after respawn', async () => {
      const b = await connect(beta);
      assert.equal((await qa('pair', alpha, beta)).swords, '1');
      const dead = await qa('death');
      assert.equal(dead.deathDrops, '0');
      assert.equal(dead.deathKeep, 'true');
      original(await waitFor(async () => { const s = await qa('state'); return s.pending === 'false' && s; }, 'respawn recovery'));
      original(await qa('state', beta));
      await disconnect(b);
    });
    await check('legacy and malformed YAML fail closed without overwriting the record', async () => {
      await qa('prime');
      const valid = await fs.readFile(escrow);
      await qa('missing-slot');
      const incomplete = await fs.readFile(escrow);
      assert.equal((await qa('recover')).swords, '1');
      assert.deepEqual(await fs.readFile(escrow), incomplete);
      await fs.writeFile(escrow, valid);
      await qa('legacy');
      const legacy = await fs.readFile(escrow);
      const refused = await qa('recover');
      assert.equal(refused.swords, '1'); assert.equal(refused.locked, 'true');
      assert.deepEqual(await fs.readFile(escrow), legacy);
      const malformed = Buffer.from('players: [\n');
      await fs.writeFile(escrow, malformed);
      assert.equal((await qa('recover')).locked, 'true');
      assert.deepEqual(await fs.readFile(escrow), malformed);
      await fs.writeFile(escrow, valid); // Only the fixture's known, verified original.
      original(await qa('recover'));
    });
  }
  await disconnect(a);
  if (!gameplayOnly) await check('abrupt exit before player save retains original inventory escrow', () =>
    crashCase('crash-before-save', false, true, 83));
  if (mode === 'candidate' && !gameplayOnly) {
    await check('abrupt exit after player save and before cleanup is idempotent', () =>
      crashCase('crash-after-save', true, true, 84));
    await check('abrupt exit after cleanup keeps restored player inventory', () =>
      crashCase('crash-after-commit', true, false, 85));
  }
} finally {
  await stop();
  await fs.writeFile(path.join(root, mode + (gameplayOnly ? '-gameplay' : '') + '-escrow-report.json'), JSON.stringify({ mode, checks }, null, 2) + '\n');
}
if (checks.some(row => !row.passed)) process.exitCode = 1;
