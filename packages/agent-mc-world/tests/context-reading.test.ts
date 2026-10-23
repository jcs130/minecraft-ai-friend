import { describe, expect, it } from 'vitest';
import { contextFactReadings, contextSourcePage, previewContextText } from '../src/context.ts';

describe('host-neutral progressive context reading', () => {
  const sources = () => Array.from({ length: 7 }, (_, index) => ({ id: `event:${index}`, world: 'minecraft',
    scope: 'realm-a:account-a', at: '2026-01-01T10:00:00Z', cursor: index, sender: 'player:visitor',
    address: { channel: 'private', to: 'visitor' }, run: 'run-a', task: 'task-a',
    text: `Observed source ${index}: ` + 'exact evidence '.repeat(80), truncated: false }));

  it('pages literal, attributed source previews without changing the source or its cursor', () => {
    const original = sources(), before = structuredClone(original), first = contextSourcePage(original);
    expect(first.ok).toBe(true); if (!first.ok) return;
    expect(first.recent.map(row => row.id)).toEqual(['event:6', 'event:5', 'event:4', 'event:3']);
    const { text, ...metadata } = original[6];
    expect(first.recent[0]).toEqual({ ...metadata, preview: text.slice(0, 160),
      textChars: original[6].text.length, truncated: true });
    const second = contextSourcePage(original, { before: first.nextBefore! });
    expect(second.ok).toBe(true); if (!second.ok) return;
    expect(second.recent.map(row => row.id)).toEqual(['event:2', 'event:1', 'event:0']);
    expect(second.nextBefore).toBeNull(); expect(original).toEqual(before);
  });

  it('sorts by source time before cursor and keeps unknown/evicted continuations explicit', () => {
    const rows = sources(); rows[0].at = '2026-01-01T11:00:00Z';
    const page = contextSourcePage(rows, { limit: 1 });
    expect(page.ok && page.recent[0].id).toBe('event:0');
    expect(contextSourcePage(rows, { before: 'event:evicted' })).toEqual({ ok: false, reason: 'cursor-missing' });
    expect(contextSourcePage([], { before: 'event:0' })).toEqual({ ok: false, reason: 'cursor-missing' });
  });

  it('retains existing truncation and extra evidence fields without copying the full text', () => {
    const source = { id: 'facts:one', world: 'minecraft', readAt: '2026-01-01T09:00:00Z',
      original: 'blob:one', text: 'Known excerpt', truncated: true };
    const preview = previewContextText(source);
    expect(preview).toEqual({ id: source.id, world: source.world, readAt: source.readAt, original: source.original,
      preview: source.text, textChars: source.text.length, truncated: true });
    expect(preview).not.toHaveProperty('text');
    expect(previewContextText(source, 0).preview).toBe('');
  });

  it('rejects malformed budgets instead of guessing or silently dropping evidence', () => {
    for (const limit of [0, -1, NaN, Infinity, 1.5]) expect(() => contextSourcePage([], { limit })).toThrow(TypeError);
    expect(() => previewContextText({ text: 'body' }, -1)).toThrow(TypeError);
    expect(() => contextSourcePage([], { previewChars: NaN })).toThrow(TypeError);
  });

  it('packs facts while retaining each original body, time, unknown value and work identity', () => {
    const facts = { text: 'Fallback', parts: [
      { key: 'position', text: '{"observedAt":"2026-01-01T10:00:00Z","position":[1,64,2]}' },
      { key: 'inventory', text: '{"observedAt":"2026-01-01T09:00:00Z","source":"cached","items":["map"]}' },
      { key: 'terrain', text: '{"below":null,"coverage":"unknown"}' },
      { key: 'task', text: '{"id":"task-a","revision":3,"status":"blocked","evidence":"event:7"}' },
    ] };
    const before = structuredClone(facts), result = contextFactReadings('minecraft', facts);
    expect(result).toHaveLength(1);
    for (const part of facts.parts) expect(result[0]).toContain(JSON.stringify(part.key) + ':\n' + part.text);
    expect(result[0]).not.toContain('Fallback'); expect(facts).toEqual(before);
  });

  it('keeps append-mode parts independently reusable and changes only the observed field', () => {
    const facts = { text: '', parts: [{ key: 'inventory', text: 'Same observed inventory' }, { key: 'health', text: '10' }] };
    const first = contextFactReadings('minecraft', facts, { mode: 'append' });
    const next = contextFactReadings('minecraft', { ...facts, parts: [facts.parts[0], { key: 'health', text: '9' }] }, { mode: 'append' });
    expect(next[0]).toBe(first[0]); expect(next[1]).not.toBe(first[1]);
    expect(next[1]).not.toContain('Same observed inventory');
  });

  it('retains complete fallback and customizable missing-content semantics', () => {
    expect(contextFactReadings('minecraft', { text: 'Full original observation' })).toEqual(['[minecraft current observed facts]\nFull original observation']);
    expect(contextFactReadings('game', { text: '', parts: [{ key: 'unknown', text: '' }] },
      { label: '已观察事实', observationsNote: '；沿用各自时间', emptyText: '本项当前无内容。' }))
      .toEqual(['[game 已观察事实；沿用各自时间]\n"unknown":\n本项当前无内容。']);
    expect(() => contextFactReadings('game', { text: '' }, { mode: 'bad' as 'append' })).toThrow(TypeError);
  });
});
