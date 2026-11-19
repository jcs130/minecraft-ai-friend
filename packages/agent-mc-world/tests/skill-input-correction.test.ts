import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNoteText, parseScoutSteps, parseSteps, SKILL_SIGNATURE_DOC, SKILL_STEP_SCHEMA } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';
import { skillProbe } from '../core/skills-gather.ts';
import type { SkillContext } from '../core/skill-context.ts';
import type { Bot } from 'mineflayer';
import { readSkillHelp } from '../core/skills.ts';
import { getResourceActionContract } from '../src/collect-contract.ts';

it('points an angular look request to the supported rotation without dispatching later steps', () => {
  const turn = { yawDeg: -135, pitchDeg: 15, orientation: 'relative' };
  const rejected = parseSteps([{ skill: 'look', ...turn }, { skill: 'chat', text: 'after turning' }]);
  expect(rejected).toMatchObject({ error: expect.stringContaining('control') });
  expect(rejected).not.toHaveProperty('steps');
  for (const orientation of ['relative', 'absolute']) {
    const step = { skill: 'control', keys: [], durationMs: 50, ...turn, orientation };
    expect(parseSteps([step])).toMatchObject({ steps: [step] });
  }
  expect(parseSteps([{ skill: 'look', at: [1, 75, -8] }])).toMatchObject({ steps: [{ skill: 'look', at: [1, 75, -8] }] });
});

it('returns the dropped-item alternative without rewriting an ambiguous resource operation', () => {
  const request = [{ skill: 'collect', radius: 12, timeoutMs: 5000 }];
  const result = parseSteps(request);
  expect(result).toHaveProperty('error');
  expect('error' in result && result.error).toContain(getResourceActionContract('block').hint);
  expect(parseSteps([{ skill: 'pickup', item: 'spruce_log' }])).toMatchObject({ steps: [{ skill: 'pickup', item: 'spruce_log' }] });
  expect(parseSteps([{ skill: 'collect', block: 'spruce_log' }])).toMatchObject({ steps: [{ skill: 'collect', block: 'spruce_log' }] });
});

it.each([
  { skill: 'use', item: '大背包', open: true },
  { skill: 'take', from: 'open', all: true },
])('returns the failed action contract even to a worker scoped only to mc_do: %j', async step => {
  const r = methodHarness();
  try {
  const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps: [step] }, {} as never);
  expect(result).toMatchObject({ failed: true, data: { executed: false } });
  const text = typeof result === 'string' ? result : result.text;
  const help = readSkillHelp({ skill: step.skill });
  expect(text).toContain('actionContract');
  expect(text).toContain(JSON.stringify('text' in help ? help.text : 'unexpected'));
  expect(text).not.toContain('技能目录');
  expect(r.said).toEqual([]);
  } finally { r.close(); }
});

afterEach(() => vi.restoreAllMocks());
const plan = [{ skill: 'goto', at: [4, 64, 0] }, { skill: 'look', at: [5, 64, 0], needs: [1] }];

describe('provider serialization compatibility keeps the complete batch', () => {
  it('decodes one complete JSON array and reports it without changing order or dependencies', () => {
    const result = parseSteps(JSON.stringify(plan));
    expect(result).not.toHaveProperty('error');
    if ('error' in result) throw Error(result.error);
    expect(result.steps).toEqual((parseSteps(plan) as { steps: unknown[] }).steps);
    expect(result.notes?.filter(n => n.kind === 'decoded')).toHaveLength(1);
    expect(result.notes?.map(parseNoteText).join('\n')).toContain('JSON');
    expect(result.notes?.map(parseNoteText).join('\n')).not.toContain('第 undefined');
  });

  it.each([JSON.stringify(plan) + '}]', JSON.stringify({ steps: plan }), JSON.stringify(JSON.stringify(plan))])(
    'rejects malformed, wrapped or recursively encoded values instead of executing a valid prefix: %s', raw => {
      expect(parseSteps(raw)).toHaveProperty('error');
      expect(parseSteps(raw)).not.toHaveProperty('steps');
    });

  it('still validates every decoded step and preserves scout read-only restrictions', () => {
    expect(parseSteps(JSON.stringify([...plan, { skill: 'invented' }]))).toHaveProperty('error');
    expect(parseScoutSteps(JSON.stringify([{ skill: 'chat', text: 'not an observation' }]))).toHaveProperty('error');
  });
});

describe('single block placement has one unambiguous target', () => {
  it('normalizes material+at into the existing one-anchor action with an explicit note', () => {
    const result = parseSteps([{ skill: 'build', material: 'torch', at: [4, 64, 0], dryRun: true }]);
    expect(result).toMatchObject({ steps: [{ skill: 'build', material: 'torch', anchors: [[4, 64, 0]], dryRun: true }] });
    if ('error' in result) throw Error(result.error);
    expect(result.notes?.map(parseNoteText).join('\n')).toContain('anchors');
  });

  it.each([{ anchors: [[9, 64, 0]] }, { on: [{ at: [9, 63, 0], face: 'up' }] },
    { shape: 'box', anchors: [[9, 64, 0], [10, 64, 0]] }])('rejects competing placement targets: %j', extra => {
      expect(parseSteps([{ skill: 'build', material: 'torch', at: [4, 64, 0], ...extra }])).toHaveProperty('error');
    });

  it('keeps blueprint origin semantics and does not convert an invalid material placement', () => {
    expect(parseSteps([{ skill: 'build', blueprint: 'test-hut', at: [4, 64, 0] }]))
      .toMatchObject({ steps: [{ skill: 'build', blueprint: 'test-hut', at: [4, 64, 0] }] });
    expect(parseSteps([{ skill: 'build', material: 'torch', at: [null, 64, 0] }])).toHaveProperty('error');
  });
});

describe('probe filter bounds follow the query, not the until stop-list', () => {
  const where = ['chest', 'air', 'cobblestone', 'stone_brick_wall', 'cobblestone_wall', 'spruce_door',
    'oak_door', 'iron_door', 'stone_brick_stairs', 'stone_bricks', 'mossy_stone_bricks',
    'cracked_stone_bricks', 'cobblestone_stairs'];
  it('keeps all thirteen requested filters and deduplicates repeated names', () => {
    const call = { skill: 'probe', shape: 'box', anchors: [[0, 64, 0], [2, 66, 2]], where: [...where, 'chest'] };
    const parsed = parseSteps([call]);
    expect(parsed).toMatchObject({ steps: [{ ...call, where }], notes: [expect.objectContaining({ field: 'where', kind: 'rewritten' })] });
    const fields = SKILL_STEP_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(fields.where).not.toHaveProperty('maxItems');
    expect(fields.until).toHaveProperty('maxItems', 12);
  });
  it('does not quietly discard where or slice when the caller requests incompatible observations', () => {
    expect(parseSteps([{ skill: 'probe', shape: 'box', anchors: [[0, 64, 0], [2, 66, 2]], where, slice: 'y' }]))
      .toHaveProperty('error');
    expect(SKILL_SIGNATURE_DOC).toContain('JSON');
    expect(SKILL_SIGNATURE_DOC).toContain('slice');
    expect(SKILL_SIGNATURE_DOC).toContain('where');
  });
  it.each(['1.21.1', '1.20.6'])('does not rescan the world for each additional filter on %s', async version => {
    const r = methodHarness(version);
    try {
      const read = vi.spyOn(r.bot, 'blockAt');
      const ctx = { aborted: () => false } as SkillContext;
      const base = { skill: 'probe' as const, shape: 'box' as const, anchors: [[1, 64, 0], [2, 65, 1]] as [number, number, number][] };
      await skillProbe(r.bot as unknown as Bot, { ...base, where: ['stone'] }, ctx);
      const originalReads = read.mock.calls.length; read.mockClear();
      const result = parseSteps([{ ...base, where }]);
      if ('error' in result) throw Error(result.error);
      await skillProbe(r.bot as unknown as Bot, result.steps[0] as Extract<typeof result.steps[number], { skill: 'probe' }>, ctx);
      expect(read.mock.calls.length).toBe(originalReads);
      expect(originalReads).toBeGreaterThan(0);
    } finally { r.close(); }
  });
});

describe('failed input supplies usable correction before touching current work', () => {
  it.each(['slot', 'windowSlot'])('rejects an unsupported toss %s before dispatching a mixed batch', async key => {
    const r = methodHarness('1.21.1');
    try {
      r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
      const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submitDetailed');
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
        queue: 'replace', steps: [{ skill: 'chat', text: 'valid' }, { skill: 'toss', item: 'iron_sword', [key]: 14 }],
      }, { role: 'test', log: r.host.log });
      expect(result).toMatchObject({ failed: true, data: { executed: false, completed: 0,
        errors: [{ path: '/steps/1/' + key, actual: 14 }] }, meta: { admission: { dispatched: false } } });
      expect(submit).not.toHaveBeenCalled();
      expect(r.said).toEqual([]);
      expect(r.exec.status().running?.id).toBe(before.running?.id);
      expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
      expect(parseSteps([{ skill: 'toss', item: 'iron_sword', pick: 'Worn', [key]: null }]))
        .toMatchObject({ steps: [{ skill: 'toss', item: 'iron_sword', pick: 'Worn' }] });
    } finally { r.close(); }
  });
  it('returns independent corrections in one text and structured receipt without replacing current work', async () => {
    const r = methodHarness('1.21.1');
    try {
      r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
      const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submitDetailed');
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
        queue: 'replace', steps: JSON.stringify([
          { skill: 'chat', command: '/example' }, { skill: 'eat' },
          { skill: 'chat', text: 'valid', needs: [1, 2] }, { skill: 'goto', to: [1, 2, 3] },
        ]),
      }, { role: 'test', log: r.host.log });
      expect(result).toMatchObject({ failed: true, data: { executed: false, completed: 0, errors: [
        { path: '/steps/0/text', actual: null }, { path: '/steps/1/item', actual: null }, { path: '/steps/3/to' },
      ] }, meta: { admission: { accepted: false, dispatched: false, fieldPath: '/steps/0/text' } } });
      for (const path of ['/steps/0/text', '/steps/1/item', '/steps/3/to']) {
        expect((result as { text: string }).text).toContain(path);
      }
      expect(submit).not.toHaveBeenCalled();
      expect(r.said).toEqual([]);
      expect(r.exec.status().running?.id).toBe(before.running?.id);
      expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    } finally { r.close(); }
  });

  it('bounds secondary diagnostics and lookahead, while fully parsing valid arrays', () => {
    const bad = { skill: 'eat' }, good = { skill: 'chat', text: 'test' };
    const manyErrors = parseSteps(Array(40).fill(bad));
    expect(manyErrors).toMatchObject({ uncheckedSteps: 32 });
    expect('error' in manyErrors && manyErrors.additionalErrors).toHaveLength(7);
    expect(parseSteps([bad, ...Array(39).fill(good)])).toMatchObject({ uncheckedSteps: 7 });
    const valid = parseSteps(Array(40).fill(good));
    expect('steps' in valid && valid.steps).toHaveLength(40);
  });

  it('names the failing skill in readable text and machine recovery, with no queue replacement or navigation', async () => {
    const r = methodHarness('1.21.1');
    try {
      r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
      const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submit');
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'now', steps: [
        plan[0], { skill: 'probe', shape: 'box', anchors: [[0, 64, 0], [2, 66, 2]], where: ['chest'], slice: 'x' },
      ] }, { role: 'test', log: r.host.log });
      expect(result).toMatchObject({ failed: true, meta: { admission: {
        accepted: false, dispatched: false, kind: 'correction',
        recovery: [{ tool: 'mc_help', arguments: { skill: 'probe' } }],
      } } });
      expect((result as { text: string }).text).toContain('mc_help {"skill":"probe"}');
      expect((result as { text: string }).text).toContain('整批未提交');
      expect(submit).not.toHaveBeenCalled();
      expect(r.exec.status().running?.id).toBe(before.running?.id);
      expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    } finally { r.close(); }
  });

  it('does not echo a long broken JSON request or dispatch its valid prefix', async () => {
    const r = methodHarness('1.21.1');
    try {
      r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
      const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submit');
      const raw = JSON.stringify([...plan, { skill: 'chat', text: 'diagnostic-only-'.repeat(400) }]) + '}]';
      const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'replace', steps: raw }, { role: 'test', log: r.host.log });
      expect(result).toMatchObject({ failed: true, meta: { admission: { accepted: false, dispatched: false } } });
      const text = (result as { text: string }).text;
      expect(text).toContain('JSON');
      expect(text.length).toBeLessThan(1200);
      expect(text).not.toContain(raw);
      expect(submit).not.toHaveBeenCalled();
      expect(r.said).toEqual([]);
      expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    } finally { r.close(); }
  });
});
