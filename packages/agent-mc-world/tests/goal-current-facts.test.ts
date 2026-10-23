import { expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';

it('keeps the native project ledger fresh in request facts without reloading environment instructions', async () => {
  const r = methodHarness('1.21.1');
  try {
    const goal = r.world.tools().find(t => t.name === 'mc_goal')!;
    const current = () => r.world.requestFacts()!.parts!.find(p => p.key === 'goals')?.text;
    expect(current()).toContain('0');
    await goal.handler({ add: { text: 'Grow food', plan: [{ do: 'Sow wheat', judgment: 'Read actual planted crops' }] } },
      { role: 'test', log: r.host.log });
    expect(current()).toContain('Grow food');
    expect(current()).toContain('Sow wheat');
    await goal.handler({ add: { text: 'Explore river', plan: [{ do: 'Reach river', judgment: 'Original arrival receipt' }] } },
      { role: 'test', log: r.host.log });
    expect(current()).toContain('Grow food');
    expect(current()).toContain('Explore river');
    expect(r.world.requestFacts()!.parts!.filter(p => p.key === 'goals')).toHaveLength(1);
  } finally { r.close(); }
});
