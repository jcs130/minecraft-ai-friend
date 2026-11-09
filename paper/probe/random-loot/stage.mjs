/** Native, ordinary-client item/components/storage QA. Requires the loopback-only Java fixture. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const n = args.indexOf(name); if (n < 0 || !args[n + 1]) throw Error('Missing ' + name); return args[n + 1]; };
const stage = path.resolve(option('--stage')), core = path.resolve(option('--core')), output = path.resolve(option('--output'));
const queue = args.includes('--queue');
if (await fs.readFile(path.join(stage, '.loot-qa-only'), 'utf8') !== 'QD_RANDOM_LOOT_20261109') throw Error('Dedicated loot QA marker required');
const properties = await fs.readFile(path.join(stage, 'server.properties'), 'utf8');
if (!/^server-ip=127\.0\.0\.1\r?$/m.test(properties) || !/^server-port=40081\r?$/m.test(properties) || !/^rcon\.port=40085\r?$/m.test(properties)) throw Error('Dedicated loopback ports required');
await fs.access(output).then(() => { throw Error('Use a new output file; do not overwrite an earlier result'); }, e => { if (e.code !== 'ENOENT') throw e; });
await import(pathToFileURL(path.join(core, 'dist/runtime/core/dependency-patches.js')));
const { installMineflayerFixes } = await import(pathToFileURL(path.join(core, 'dist/runtime/core/mineflayer-fixes.js')));
const require = createRequire(path.join(core, 'package.json'));
const { command } = await import('file:///E:/MC/ops/rcon-client.mjs');
const connection = { properties: path.join(stage, 'server.properties'), port: 40085 };
const bot = require('mineflayer').createBot({ host: '127.0.0.1', port: 40081, username: 'LootReader', version: '1.21.1', auth: 'offline' });
const result = { qaOnly: true, productionModified: false, ordinaryClient: true, queuedByThisRun: queue, checks: [], packets: [], errors: [] };
bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(b => installMineflayerFixes(b, { info() {}, warn() {}, debug() {}, error(e) { result.errors.push(String(e)); } }));
bot.on('error', e => result.errors.push(String(e.stack ?? e)));
bot._client.on('error', e => result.errors.push(String(e.stack ?? e)));
bot.on('kicked', e => result.errors.push('Kicked: ' + JSON.stringify(e)));
let enchantmentKeys, lastRaw;
bot._client.on('registry_data', p => { if (p.id === 'minecraft:enchantment') enchantmentKeys = p.entries.map(x => x.key); });
bot._client.on('window_items', p => { lastRaw = structuredClone(p); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(read, label) { for (let n = 0; n < 150; n++) { if (result.errors.length) throw Error(result.errors.join('\n')); const value = read(); if (value) return value; await wait(100); } throw Error('Timeout: ' + label); }
function check(label, ok, data) { result.checks.push({ label, passed: !!ok, data }); if (!ok) throw Error(label); }
function enchants(slot) {
  const component = slot.components?.find(c => ['enchantments', 'stored_enchantments'].includes(c.type));
  const entries = (component?.data?.enchantments ?? []).map(e => {
    const key = enchantmentKeys?.[e.id]; if (!key) throw Error('Unknown actual registry enchantment id ' + e.id);
    return [key, e.level];
  });
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
function signature(x) { return JSON.stringify([x.type, x.amount, Object.entries(x.enchantments).sort(([a], [b]) => a.localeCompare(b))]); }
async function nativeState(label) {
  const state = JSON.parse((await command('lootrollqa state LootReader', 15000, connection)).trim());
  check(label, state.passed && state.op === false && state.items?.length === 28, { checks: state.checks, error: state.error, count: state.items?.length });
}
async function openAndCheck(label, expected) {
  lastRaw = null;
  bot.chat('/mycli arena stash');
  const w = await until(() => bot.currentWindow, label + ' actual window');
  const raw = await until(() => lastRaw?.windowId === w.id && lastRaw, label + ' original window_items');
  check(label + ' actual 54-slot chest', w.inventoryStart === 54, { type: w.type, slots: w.inventoryStart });
  check('Actual enchantment registry received', enchantmentKeys?.length > 20, enchantmentKeys?.length);
  const actual = raw.items.filter(x => x.itemCount > 0).map(x => ({
    type: bot.registry.items[x.itemId]?.name?.toUpperCase(), amount: x.itemCount,
    enchantments: enchants(x), componentTypes: x.components?.map(c => c.type) ?? []
  }));
  const remaining = actual.slice();
  for (const wanted of expected) {
    const at = remaining.findIndex(x => signature(x) === signature(wanted));
    check(label + ' raw components match', at >= 0, { type: wanted.type, enchantments: wanted.enchantments });
    if (at >= 0) remaining.splice(at, 1);
  }
  result.packets.push({ label, windowId: raw.windowId, stateId: raw.stateId, expected: expected.length, actual });
  return w;
}
try {
  await until(() => bot.entity, 'ordinary login'); await wait(2200);
  if (queue) {
    const receipt = JSON.parse((await command('lootrollqa queue LootReader', 30000, connection)).trim());
    check('Queue accepted once', receipt.passed && receipt.items === 28, receipt);
  }
  const expected = JSON.parse(await fs.readFile(path.join(stage, 'loot-qa/expected.json'), 'utf8'));
  check('Independent original reward record', expected.length === 28, expected.length);
  const w = await openAndCheck('first open', expected);
  await nativeState('Full original ItemStacks unchanged');
  bot.closeWindow(w); await wait(1300);
  const reopened = await openAndCheck('reopen', expected);
  if (queue || args.includes('--withdraw')) {
    const from = reopened.slots.slice(0, 54).findIndex(Boolean);
    const to = reopened.slots.findIndex((x, i) => i >= reopened.inventoryStart && i < reopened.inventoryEnd && !x);
    check('Ordinary withdrawal has empty target', from >= 0 && to >= 54, { from, to });
    await bot.clickWindow(from, 0, 0); await bot.clickWindow(to, 0, 0);
    await until(() => !reopened.slots[from] && reopened.slots[to], 'ordinary chest withdrawal');
    check('Standard chest click moved one real item', !!reopened.slots[to], reopened.slots[to]?.name);
    await wait(500);
  }
  bot.closeWindow(reopened); await wait(1300);
  bot.chat('/mycli arena loot'); await wait(1400);
  await nativeState('Withdrawal/read-only loot lookup did not reroll');
  const final = await openAndCheck('after read/withdrawal', expected); bot.closeWindow(final);
  check('No protocol parser errors', result.errors.length === 0, result.errors);
  result.passed = true;
} catch (e) { result.passed = false; result.error = String(e.stack ?? e); process.exitCode = 1; }
finally { result.observedAt = new Date().toISOString(); bot.quit(); await fs.writeFile(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, error: result.error, output })); }
