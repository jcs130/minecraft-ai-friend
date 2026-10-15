// Check the canonical engine-only build. No patched source/profile is produced here.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2]);
await import('./deny-network.mjs');
await import(pathToFileURL(join(root, 'scripts/verify-build.mjs')));
const receipt = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8'));
assert.equal(receipt.schema, 'agent-mc-build/v1');
assert.equal(receipt.viewer.included, false);
const sdk = await import(pathToFileURL(join(root, 'dist/runtime/src/index.js')));
assert.equal(sdk.MINECRAFT_CLIENT_DEFAULTS.enabled, false);
assert.equal(sdk.MINECRAFT_CLIENT_DEFAULTS.host, '');
const config = { ...structuredClone(sdk.MINECRAFT_CLIENT_DEFAULTS), version: '1.21.1' };
const dataDir = await mkdtemp(join(tmpdir(), 'agent-mc-build-check-'));
try {
  const client = new sdk.MinecraftAgentClient({ cfg: config, dataDir, log: sdk.nullLogger() });
  try {
    const names = new Set(client.tools().map(t => t.name));
    assert(names.has('mc_memory'));
    assert(names.has('mc_combat_tactic'));
    assert(names.has('mc_knowledge'));
    const food = JSON.parse((await client.call('mc_knowledge', { action: 'get', id: 'food/beef' })).text);
    assert.equal(food.version, '1.21.1');
    assert.deepEqual(food.entry.nutrition, { foodPoints: 3, saturation: 1.8 });
    assert.deepEqual(food.entry.cooking.nutrition, { foodPoints: 8, saturation: 12.8 });
    assert.equal(food.currentWorldVerified, false);
    assert(!names.has('mc_cast'));
    assert.equal(client.status().phase, 'disconnected');
  } finally { await client.disconnect(); }
} finally { await rm(dataDir, { recursive: true, force: true }); }
console.log(JSON.stringify({ canonicalBuild: true, independent: true, sharedMemory: true, sharedTactics: true, sharedKnowledge: true,
  bundledViewer: false, connection: 'disconnected', network: 'denied' }));
