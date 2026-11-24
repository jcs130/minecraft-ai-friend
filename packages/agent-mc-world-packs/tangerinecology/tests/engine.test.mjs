// Integration with the built core. Skipped when agent-mc-world is not installed/linked
// (e.g. `npm i --no-save ../../agent-mc-world` after building the core).
import { test } from 'node:test';
import assert from 'node:assert/strict';

let core = null, engineModule = null;
try {
  core = await import('agent-mc-world/extension');
  engineModule = await import('../src/engine.mjs');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const skip = !core && 'agent-mc-world not resolvable';

test('engine is inert for other hosts and keeps their config untouched', { skip }, () => {
  const cfg = structuredClone(core.MINECRAFT_DEFAULTS);
  cfg.host = 'play.example.invalid';
  const before = JSON.stringify(cfg);
  const engine = engineModule.createEngine({ cfg });
  assert.equal(JSON.stringify(cfg), before);
  assert.equal(engine.tangerine.active, false);
  const state = JSON.parse(engine.tools().find((t) => t.name === 'mc_tangerine').handler({ action: 'state' }).text);
  assert.equal(state.active, false);
  assert.equal(engine.simpleVoiceChatGate({}), true, 'default core gate');
});

test('engine for 橘乡 applies the overlay in place, exposes mc_tangerine, and holds SVC before /main', { skip }, () => {
  const cfg = structuredClone(core.MINECRAFT_DEFAULTS);
  cfg.host = 'mc.tangerinecology.top';
  const engine = engineModule.createEngine({ cfg });
  assert.equal(engine.tangerine.active, true);
  assert.equal(cfg.version, '26.2');
  assert.equal(cfg.movementPace.enabled, true);
  assert.equal(cfg.miningLimits.enabled, true);
  assert.equal(cfg.simpleVoiceChat.enabled, false);
  const tool = engine.tools().find((t) => t.name === 'mc_tangerine');
  assert.ok(tool, 'mc_tangerine registered');
  assert.equal(JSON.parse(tool.handler({ action: 'state' }).text).available, false);
  assert.match(tool.handler({ action: 'guide' }).text, /\/main/);
  assert.ok(JSON.parse(tool.handler({ action: 'plugins' }).text).plugins.some((p) => /Vulcan/.test(p.name)));
  assert.equal(engine.simpleVoiceChatGate({}), false, 'no route yet → SVC held');
  assert.ok(engine.tools().some((t) => t.name === 'mc_svc'), 'core mc_svc stays available');
});
