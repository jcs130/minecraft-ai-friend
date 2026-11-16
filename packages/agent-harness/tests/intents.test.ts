import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntentManager, normalizePriority } from '../src/index.ts';

describe('IntentManager', () => {
  it('orders by priority then age and enforces the state machine', () => {
    const m = new IntentManager();
    const a = m.submit({ goal: 'fish', priority: 'low' });
    const b = m.submit({ goal: 'eat', priority: 'high' });
    const c = m.submit({ goal: 'chat', priority: 'high' });
    expect(m.next()!.id).toBe(b.id);
    m.transition(b.id, 'active');
    expect(() => m.transition(c.id, 'active')).toThrow(/already active/);
    m.transition(b.id, 'done', { result: 'ok' });
    expect(m.get(b.id)!.endedAt).not.toBeNull();
    expect(() => m.transition(b.id, 'queued')).toThrow(/cannot go from done/);
    expect(m.next()!.id).toBe(c.id);
    m.transition(a.id, 'paused', { reason: 'host' });
    expect(() => m.transition(a.id, 'active')).toThrow();
    m.transition(a.id, 'queued');
    m.transition(a.id, 'cancelled');
    expect(m.list({ states: ['cancelled'] }).map(i => i.goal)).toEqual(['fish']);
  });

  it('validates input and limits updates of an active intent', () => {
    const m = new IntentManager();
    expect(() => m.submit({ goal: '  ' })).toThrow();
    expect(() => normalizePriority('extreme' as never)).toThrow();
    expect(normalizePriority(250)).toBe(100);
    const i = m.submit({ goal: 'mine iron', constraints: { steps: [{ tool: 'mc_do', args: {} }] } });
    m.transition(i.id, 'active', { plan: [{ tool: 'mc_do', args: {} }] });
    expect(() => m.update(i.id, { goal: 'mine gold' })).toThrow(/Pause/);
    expect(m.update(i.id, { priority: 'urgent' }).priority).toBe(95);
    m.transition(i.id, 'paused');
    const u = m.update(i.id, { constraints: { rules: ['stay near home'] } });
    expect(u.plan).toBeNull();
  });

  it('persists and returns an interrupted active intent to the queue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-intents-'));
    try {
      const file = join(dir, 'intents.json');
      const m = new IntentManager({ file });
      const i = m.submit({ goal: 'build house', priority: 70 });
      m.transition(i.id, 'active');
      const reloaded = new IntentManager({ file });
      expect(reloaded.get(i.id)).toMatchObject({ state: 'queued', reason: 'interrupted by restart', priority: 70 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
