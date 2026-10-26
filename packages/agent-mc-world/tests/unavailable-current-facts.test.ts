import { expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';

it('invalidates old physical facts on disconnect while retaining goals and historical outcomes', async () => {
  const r = methodHarness('1.21.1');
  try {
    await r.world.tools().find(t => t.name === 'mc_goal')!.handler({ add: { text: 'Reach the mine',
      plan: [{ do: 'Find the entrance', judgment: 'Verified arrival' }] } }, { role: 'test', log: r.host.log });
    const internals = r.world as any;
    internals.lastFinishedTask = { kind: 'done', at: Date.now(), text: 'task#7 verified bow craft' };
    const online = r.world.requestFacts()!;
    expect(online.decision?.state).toHaveProperty('position');
    internals.bridge.connected = false;
    const snapshot = vi.spyOn(internals, 'snapshot');
    const offline = r.world.requestFacts()!;
    expect(snapshot).not.toHaveBeenCalled();
    expect(offline.snapshotTypes).toEqual(online.snapshotTypes);
    expect(JSON.parse(offline.parts!.find(p => p.key === 'availability')!.text)).toMatchObject({
      reason: 'disconnected', currentWorldVerified: false, position: null, inventory: null, bodyTask: null,
    });
    expect(offline.text).toContain('Reach the mine');
    expect(offline.text).toContain('task#7 verified bow craft');
    expect(offline.text).toContain('null 表示未知');
    for (const key of ['decision', 'decisionStability', 'experience', 'options']) expect(offline).not.toHaveProperty(key);
    expect(offline.parts?.some(p => ['body', 'place', 'gear', 'taskProgress'].includes(p.key))).toBe(false);
    internals.bridge.connected = true;
    r.bot.health = 9;
    expect(r.world.requestFacts()?.decision?.state).toHaveProperty('health', 9);
  } finally { r.close(); }
});

it('keeps snapshot coverage when a connected client temporarily cannot sample its body', () => {
  const r = methodHarness('1.21.1');
  try {
    const before = r.world.requestFacts()!;
    const snapshot = vi.spyOn(r.world as any, 'snapshot').mockReturnValue(null);
    const facts = r.world.requestFacts()!;
    expect(facts.snapshotTypes).toEqual(before.snapshotTypes);
    expect(facts.text).toContain('snapshot-unavailable');
    expect(facts.decision).toBeUndefined();
    snapshot.mockRestore();
    expect(r.world.requestFacts()?.decision).toBeDefined();
  } finally { r.close(); }
});
