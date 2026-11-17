import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, type MinecraftEventObserver, type MinecraftBodyGate } from '../src/client/index.ts';
import type { ToolDef, WorldHost } from '../src/client/contracts.ts';

const directories: string[] = [];
afterEach(() => { for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });
function rig(extra: { eventObservers?: MinecraftEventObserver[]; extraTools?: ToolDef[]; bodyGate?: MinecraftBodyGate } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mc-observers-')); directories.push(dataDir);
  let host!: WorldHost;
  const requestFacts = vi.fn(() => ({ text: '', snapshotTypes: [], world: { schema: 'agent-mc-world-identity/v1' as const, key: 'minecraft:overworld',
    uuid: null, instanceId: null, dimensionType: 'minecraft:overworld', source: 'vanilla-login' as const, revision: 1, observedAt: null } }));
  const core: ToolDef = { name: 'mc_look', description: 'core', parameters: { type: 'object' }, tags: ['read'], handler: async () => ({ text: 'core' }) };
  const world = { id: 'minecraft', tools: () => [core], envPromptVars: () => ({}), start: async (h: WorldHost) => { host = h; },
    stop: async () => {}, requestFacts };
  const runtime = new MinecraftAgentClient({ dataDir, log: nullLogger(), autoAcknowledgeBarriers: true, ...extra,
    cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username: 'Test' } }, world);
  return { runtime, host: () => host, requestFacts };
}

describe('optional event observers and extra tools', () => {
  it('without options keeps the existing tool list and never reads facts for observers', async () => {
    const r = rig();
    await r.runtime.connect();
    const before = r.requestFacts.mock.calls.length;
    await r.host().pushEvent({ type: 'minecraft.enter', ts: new Date().toISOString(), source: 'minecraft', text: 'Steve joined', meta: { uname: 'Steve' } });
    expect(r.requestFacts.mock.calls.length).toBe(before);
    expect(r.runtime.tools().some(t => t.name.startsWith('memory_'))).toBe(false);
    await r.runtime.disconnect();
  });

  it('observers see stored events with lazy facts; failures are isolated', async () => {
    const seen: Array<{ type: string; cursor: number; world: string | null | undefined }> = [];
    const r = rig({ eventObservers: [() => { throw new Error('observer bug'); },
      (event, facts) => seen.push({ type: event.type, cursor: event.cursor, world: facts()?.world?.key })] });
    await r.runtime.connect();
    const stored = await r.host().pushEvent({ type: 'minecraft.enter', ts: new Date().toISOString(), source: 'minecraft', text: 'Steve joined', meta: { uname: 'Steve' } });
    expect(stored.cursor).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ type: 'minecraft.enter', cursor: stored.cursor, world: 'minecraft:overworld' });
    await r.runtime.disconnect();
  });

  it('extra tools are appended and cannot shadow core tools', async () => {
    const shadow: ToolDef = { name: 'mc_look', description: 'shadow', parameters: { type: 'object' }, tags: ['read'], handler: async () => ({ text: 'shadow' }) };
    const memory: ToolDef = { name: 'memory_query', description: 'mem', parameters: { type: 'object' }, tags: ['read'], bodyControl: 'independent',
      handler: async () => ({ text: 'remembered' }) };
    const r = rig({ extraTools: [shadow, memory] });
    await r.runtime.connect();
    const tools = r.runtime.tools();
    expect(tools.filter(t => t.name === 'mc_look').map(t => t.description)).toEqual(['core']);
    expect(tools.some(t => t.name === 'memory_query')).toBe(true);
    expect((await r.runtime.call('memory_query', {})).text).toContain('remembered');
    await r.runtime.disconnect();
  });

  it('bodyGate hides body tools from hosts; only the key holder may call them', async () => {
    const key = {};
    const harness: ToolDef = { name: 'harness_get_summary', description: 'h', parameters: { type: 'object' }, tags: ['read'], bodyControl: 'independent',
      handler: async () => ({ text: 'summary' }) };
    const r = rig({ extraTools: [harness], bodyGate: { key, expose: name => name.startsWith('harness_') } });
    await r.runtime.connect();
    expect(r.runtime.tools().map(t => t.name)).toEqual(['harness_get_summary']);
    await expect(r.runtime.call('mc_look', {})).rejects.toThrow(/reserved for the body owner/);
    await expect(r.runtime.call('mc_look', {}, { bodyKey: {} })).rejects.toThrow(/reserved/);
    expect((await r.runtime.call('mc_look', {}, { bodyKey: key })).text).toContain('core');
    expect((await r.runtime.call('harness_get_summary', {})).text).toContain('summary');
    await r.runtime.disconnect();
  });
});
