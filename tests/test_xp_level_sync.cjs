// Exercise the actual syncLevel implementation with stubbed I/O; no server or save writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('../world/node_modules/esbuild');

const source = fs.readFileSync(path.join(__dirname, '../world/src/mc-god.ts'), 'utf8');
const start = source.indexOf('  const lastSeenLevel = new Map<string, number>()');
const end = source.indexOf('  // ── 女神守护施援扫描', start);
assert(start >= 0 && end > start, 'Cannot locate the production syncLevel block');
const result = transformSync(`function factory(rcon, magic, worlddb, log, courier) {\n${source.slice(start, end)}\nreturn syncLevel;\n}\nmodule.exports = factory;`, { loader: 'ts', target: 'node22', format: 'cjs' });
const context = { module: { exports: {} }, Date };
vm.runInNewContext(result.code, context);

async function main() {
  const native = { XpLevel: 24, XpTotal: 1395 };
  const writes = [], cached = [], events = [], logs = [];
  const sync = context.module.exports(
    { getEntityNumber: async (_, field) => native[field], send: async command => { writes.push(command); return ''; } },
    { setLevel: (_, level) => cached.push(level), getState: () => ({ maxMana: 412 }), listAtoms: () => [] },
    { chronicleRecord: (kind, _, detail) => events.push({ kind, detail }) },
    message => logs.push(message), () => {});

  await sync('OfflineFixture'); // A legitimate anvil operation has spent six levels from level 30.
  assert.equal(cached.at(-1), 24);
  assert.equal(writes.length, 0);
  assert.equal(logs.filter(x => x.startsWith('XP DIAGNOSTIC')).length, 1);
  await sync('OfflineFixture');
  assert.equal(logs.filter(x => x.startsWith('XP DIAGNOSTIC')).length, 1, 'Diagnostic is rate limited');

  native.XpLevel = 48; native.XpTotal = 10; // Commands can also raise level without total XP.
  await sync('OtherFixture');
  assert.equal(cached.at(-1), 48);
  assert.equal(writes.length, 0);
  assert.equal(events.length, 0);

  native.XpLevel = null;
  const before = cached.length;
  await sync('OfflineFixture');
  assert.equal(cached.length, before, 'Offline/no level does not overwrite cache');

  native.XpLevel = 26; native.XpTotal = null;
  await sync('OfflineFixture');
  assert.equal(cached.at(-1), 26, 'Unavailable total does not block a valid native level');
  native.XpLevel = 27;
  await sync('OfflineFixture');
  assert.equal(cached.at(-1), 27);
  assert(events.some(x => x.kind === 'levelup' && x.detail.from === 26 && x.detail.to === 27), 'Upgrade presentation is retained');
  assert(!writes.some(x => /^(?:xp|experience)\b/i.test(x)), 'No native XP mutation, including after level decrease and increase');
  console.log('PASS: XP spending, command levels, diagnostics, offline state and upgrade presentation; no XP write commands');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
