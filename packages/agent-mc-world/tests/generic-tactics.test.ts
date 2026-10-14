import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MinecraftWorldProxy } from '../core/proxy.ts';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { COMBAT_TACTIC_TOOL } from '../core/combat-tool.ts';
import { FakeHost } from './method-host.ts';

it('exposes the same tactic capability to generic SDK, IPC and direct engines without a server pack', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mc-generic-tactics-'));
  const cfg = structuredClone(MINECRAFT_CLIENT_DEFAULTS);
  const client = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() });
  const world = new TacticalMinecraftWorld({ cfg, dataDir });
  const proxy = new MinecraftWorldProxy({ cfg, dataDir,
    extension: { module: 'file:///unused-until-start.js', tools: [COMBAT_TACTIC_TOOL] } });
  try {
    for (const owner of [client, world, proxy]) {
      const names = owner.tools().map(t => t.name);
      expect(names.filter(n => n === 'mc_combat_tactic')).toHaveLength(1);
      expect(names).not.toContain('mc_cast');
    }
  } finally { await client.disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
});

it('executes and restores an authored tactic through the default child factory without Qiandengji', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mc-generic-tactics-ipc-'));
  const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), enabled: false };
  const program = { name: 'portable-test', code: 'return {candidates:[],instructions:"No observed target"};' };
  const proxies: MinecraftWorldProxy[] = [];
  try {
    for (const install of [true, false]) {
      const proxy = new MinecraftWorldProxy({ cfg, dataDir }), host = new FakeHost();
      proxies.push(proxy);
      await proxy.start(host);
      const tool = proxy.tools().find(t => t.name === 'mc_combat_tactic')!;
      const ctx = { role: 'main', log: host.log };
      if (install) expect(await tool.handler({ program }, ctx)).toContain('已编译');
      expect(await tool.handler({}, ctx)).toContain('portable-test');
      const frame = await tool.handler({ battlefield: true }, ctx);
      expect(frame).toMatchObject({ meta: { protocol: 'agent-mc-tactics/v1', frame: null } });
      expect(host.events.some(e => /\/mycli|goddess/.test(e.text))).toBe(false);
      await proxy.stop();
    }
  } finally {
    await Promise.all(proxies.map(p => p.stop()));
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 15000);
