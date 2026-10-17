import { describe, expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';

describe.each(['1.21.1', '1.20.6'])('live discovery port %s', version => {
  it('exports fresh options through the actual tool and request-tail parts without starting work or chat', async () => {
    const r = methodHarness(version);
    try {
      const tool = r.world.tools().find(t => t.name === 'mc_options')!;
      expect(tool.tags).toContain('read');
      const before = r.exec.status();
      const result = await tool.handler({ intent: 'travel' }, { role: 'test', log: r.host.log });
      const output = JSON.parse(typeof result === 'string' ? result : result.text);
      expect(output.schema).toBe('minecraft-options/v1');
      expect(output.options.find((o: { id: string }) => o.id === 'core.horse-travel').support).toBe('unsupported');
      expect(r.exec.status()).toEqual(before);
      expect(r.said).toEqual([]);
      r.bot.food = 7;
      const facts = r.world.requestFacts()!;
      expect(facts.options?.context.food).toBe(7);
      expect(facts.parts?.find(p => p.key === 'options')?.text).toContain('food');
      expect(facts.parts!.findIndex(p => p.key === 'options')).toBeLessThan(5);
      expect(facts.text).toContain('mc_options');
      Object.assign((r.world as unknown as { bridge: object }).bridge, { connected: false });
      const disconnected = await tool.handler({ intent: 'food' }, { role: 'test', log: r.host.log });
      expect(JSON.parse(typeof disconnected === 'string' ? disconnected : disconnected.text)).toMatchObject({ status: 'unverified', options: [] });
    } finally { r.close(); }
  });
});
