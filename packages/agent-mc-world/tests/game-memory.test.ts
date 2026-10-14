import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, GAME_MEMORY_TOOL, type GameMemoryContext } from '../core/game-memory.ts';
import { MinecraftWorldProxy } from '../core/proxy.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { FakeHost } from './method-host.ts';

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'mc-memory-test-')); dirs.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const ctx: GameMemoryContext = { scope: { realm: 'weak:fixture.invalid:25565', account: 'offline:alice', agent: 'fixture' }, dimension: 'minecraft:overworld' };
const note = { action: 'remember', kind: 'method', summary: '水下换气方法', content: '先读氧气；仅在实际水中使用。未验证长距离下潜。源码sha:test；失败task:1', source: { kind: 'hypothesis', reference: 'task:1' }, tags: ['下潜', '换气'] };
const entry = (result: Record<string, unknown>) => result.entry as { id: string; revision: number; source: { kind: string }; content: string };

it('recovers the observed missing-source and misrouted-capture failures without forging runtime provenance', () => {
  const dir = directory(), book = new GameMemoryBook(dir);
  const { source: _source, ...missingSource } = note;
  expect(() => book.execute(missingSource, ctx)).toThrow('source is required');
  let sampled = false;
  expect(() => book.execute({ action: 'capture', operation: 'capture_source', input: missingSource }, {
    ...ctx, capture: () => { sampled = true; throw new Error('must not sample for malformed input'); },
  })).toThrow('Use remember');
  expect(sampled).toBe(false);
  expect(book.execute({ action: 'search' }, ctx)).toMatchObject({ total: 0 });
  const help = book.execute({ action: 'help', topic: 'remember' }, ctx) as { example: Record<string, unknown>; inputSchema: { required: string[] } };
  expect(help.inputSchema.required).toEqual(['action', 'kind', 'summary', 'content', 'source']);
  const saved = entry(book.execute({ ...help.example, ...note, source: { kind: 'agent_note', speaker: 'fixture agent', reference: 'run:test/task:5' } }, ctx));
  const restarted = new GameMemoryBook(dir);
  expect(restarted.execute({ action: 'get', id: saved.id }, ctx)).toMatchObject({ entry: { evidence: 'attributed-unverified-note', currentWorldVerified: false } });
  expect(restarted.execute({ action: 'search', query: '换气', kind: 'method' }, ctx)).toMatchObject({ entries: [{ id: saved.id }] });
  expect(() => restarted.execute({ ...note, source: { kind: 'runtime_observation' } }, ctx)).toThrow('runtime observations');
});

it('offers bounded action-specific help without storage, capture or remote learning arguments', () => {
  const book = new GameMemoryBook(null);
  for (const topic of ['search', 'remember', 'capture', 'revise']) {
    const help = book.execute({ action: 'help', topic }, ctx) as { inputSchema: { properties: Record<string, unknown> }; example: Record<string, unknown> };
    expect(help.inputSchema.properties).not.toHaveProperty('input');
    expect(help.inputSchema.properties).not.toHaveProperty('operation');
    expect(help.example.action).toBe(topic);
    expect(JSON.stringify(help).length).toBeLessThan(4500);
  }
  expect(book.execute({ action: 'help' }, ctx).help).toContain('mc_script {api:"methods"}');
  expect(() => book.execute({ action: 'help', topic: 'unknown' }, ctx)).toThrow('help topic');
  expect(GAME_MEMORY_TOOL.description).toContain('source.kind=agent_note');
});

it('retrieves bounded summaries and provenance after restart, with explicit detail and old revisions', () => {
  const dir = directory(), first = new GameMemoryBook(dir);
  const saved = entry(first.execute(note, ctx));
  const book = new GameMemoryBook(dir);
  const search = book.execute({ action: 'search', query: '水下换气', limit: 1 }, ctx);
  expect(search).toMatchObject({ total: 1, nextOffset: null, currentWorldVerified: false, entries: [{ id: saved.id, historical: true, source: { kind: 'hypothesis' } }] });
  expect(JSON.stringify(search)).not.toContain('源码sha:test');
  expect(entry(book.execute({ action: 'get', id: saved.id }, ctx)).content).toContain('源码sha:test');
  book.execute({ ...note, action: 'revise', id: saved.id, expectedRevision: 1, content: 'task:2验证短潜；长距离仍未验证。', source: { kind: 'agent_note' } }, ctx);
  expect(entry(book.execute({ action: 'get', id: saved.id, revision: 1 }, ctx)).source.kind).toBe('hypothesis');
  expect(() => book.execute({ action: 'archive', id: saved.id, expectedRevision: 1 }, ctx)).toThrow('Revision conflict');
  book.execute({ action: 'archive', id: saved.id, expectedRevision: 2 }, ctx);
  expect(book.execute({ action: 'search' }, ctx)).toMatchObject({ total: 0 });
  expect(book.execute({ action: 'get', id: saved.id }, ctx)).toMatchObject({ entry: { archived: true, revision: 3 } });
});

it('isolates account, agent and server, and filters dimensions without silently assuming overworld offline', () => {
  const book = new GameMemoryBook(directory());
  const id = entry(book.execute({ ...note, kind: 'place' }, ctx)).id;
  for (const scope of [{ ...ctx.scope, realm: 'different' }, { ...ctx.scope, account: 'offline:bob' }, { ...ctx.scope, agent: 'other' }]) {
    expect(book.execute({ action: 'search', dimension: '*' }, { ...ctx, scope })).toMatchObject({ total: 0 });
    expect(() => book.execute({ action: 'get', id }, { ...ctx, scope })).toThrow('not found');
  }
  expect(book.execute({ action: 'search' }, { ...ctx, dimension: 'minecraft:the_nether' })).toMatchObject({ total: 0 });
  expect(book.execute({ action: 'search', dimension: '*' }, { ...ctx, dimension: null })).toMatchObject({ total: 1 });
  expect(() => book.execute({ ...note, kind: 'place' }, { ...ctx, dimension: null })).toThrow('dimension');
  expect(() => book.execute({ action: 'get', id, account: 'offline:bob' }, ctx)).toThrow('does not apply');
});

it('never promotes arbitrary reports to runtime facts and marks expiry without deleting counterexamples', () => {
  let time = Date.parse('2026-10-14T00:00:00Z');
  const book = new GameMemoryBook(directory(), () => time);
  expect(() => book.execute({ ...note, source: { kind: 'runtime_observation' } }, ctx)).toThrow('runtime observations');
  expect(() => book.execute({ ...note, source: { kind: 'user_report' } }, ctx)).toThrow('speaker');
  expect(() => book.execute({ action: 'capture' }, ctx)).toThrow('No connected');
  const capture = entry(book.execute({ action: 'capture', expiresAt: '2026-10-14T00:00:01Z' }, { ...ctx, capture: () => {
    time += 10;
    return { observedAt: new Date(time).toISOString(), dimension: ctx.dimension!, content: '{"inventory":null,"inventorySynced":false}', reference: 'runtime:test:connection:2' };
  } }));
  time += 5000;
  expect(book.execute({ action: 'get', id: capture.id }, ctx)).toMatchObject({ entry: { expired: true, historical: true, currentWorldVerified: false, source: { kind: 'runtime_observation' } } });
  book.execute({ ...note, action: 'revise', id: capture.id, expectedRevision: 1 }, ctx);
  expect(entry(book.execute({ action: 'get', id: capture.id }, ctx)).source.kind).toBe('hypothesis');
  expect(book.execute({ action: 'get', id: capture.id, revision: 1 }, ctx)).toMatchObject({ entry: { expired: true, content: '{"inventory":null,"inventorySynced":false}' } });
});

it('refuses corrupt storage and invalid input without replacing evidence', () => {
  const dir = directory(), book = new GameMemoryBook(dir);
  book.execute(note, ctx);
  const file = join(dir, readdirSync(dir)[0]);
  const before = readFileSync(file, 'utf8');
  expect(() => book.execute({ ...note, content: 'x'.repeat(6001) }, ctx)).toThrow('6000');
  expect(() => book.execute({ action: 'search', limit: 21 }, ctx)).toThrow('20');
  expect(readFileSync(file, 'utf8')).toBe(before);
  writeFileSync(file, '{broken');
  expect(() => book.execute(note, ctx)).toThrow('preserved');
  expect(readFileSync(file, 'utf8')).toBe('{broken');
  expect(() => new GameMemoryBook(null).execute(note, ctx)).toThrow('dataDir');
});

it('persists through the real default child IPC and rejects disconnected capture without connecting', async () => {
  const dataDir = directory(), cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), enabled: false, host: 'fixture.invalid' };
  let id = '';
  for (const create of [true, false]) {
    const proxy = new MinecraftWorldProxy({ cfg, dataDir }), host = new FakeHost();
    try {
      await proxy.start(host);
      const tool = proxy.tools().find(t => t.name === 'mc_memory')!;
      const context = { role: 'main', log: host.log };
      if (create) {
        const result = await tool.handler(note, context);
        expect(typeof result).toBe('object');
        id = JSON.parse((result as { text: string }).text.slice((result as { text: string }).text.indexOf('{'))).entry.id;
      }
      const response = await tool.handler({ action: 'get', id }, context);
      expect(JSON.stringify(response)).toContain('源码sha:test');
      expect(await tool.handler({ action: 'capture' }, context)).toMatchObject({ failed: true });
      expect(host.events.some(e => e.type.includes('connected') && !e.type.includes('disconnected'))).toBe(false);
    } finally { await proxy.stop(); }
  }
}, 15000);

it('uses the same notebook through offline SDK calls, preserving deduplication, ownership and explicit stop', async () => {
  const dataDir = directory(), cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.invalid', username: 'Alice' };
  const client = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() });
  try {
    const result = await client.call('mc_memory', note, { requestId: 'offline-memory-write' });
    const saved = JSON.parse(result.text);
    expect(await client.call('mc_memory', note, { requestId: 'offline-memory-write' })).toEqual(result);
    expect(client.status().phase).toBe('disconnected');
    expect(readdirSync(dataDir)).not.toContain('connection.lock');
    await expect(client.call('mc_bag', {})).rejects.toThrow('disconnected');
    await expect(client.call('mc_memory', { action: 'capture' })).rejects.toThrow('No connected');
    await client.disconnect();
    const restored = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() });
    try {
      const read = await restored.call('mc_memory', { action: 'get', id: saved.entry.id });
      expect(JSON.parse(read.text).entry.content).toBe(note.content);
      expect(restored.status().phase).toBe('disconnected');
    } finally { await restored.disconnect(); }
  } finally { await client.disconnect(); }
});

it('holds the offline writer lease until cancellation and releases it on journal failure', async () => {
  const dataDir = directory(), cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.invalid', username: 'Alice',
    memory: { mode: 'remote' as const, provider: 'http' as const, endpoint: 'https://memory.invalid', timeoutMs: 30000 } };
  const client = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() });
  const other = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() });
  let signalIndex!: () => void;
  const indexing = new Promise<void>(resolve => { signalIndex = resolve; });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    signalIndex();
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
  });
  try {
    const pending = client.call('mc_memory', note, { requestId: 'pending-index' });
    const cancelled = expect(pending).rejects.toThrow('cancelled');
    await indexing;
    await expect(other.call('mc_memory', { action: 'search', query: '换气' })).rejects.toThrow('live game connection owner');
    await expect(client.connect()).rejects.toThrow('offline memory');
    client.cancel('pending-index');
    await cancelled;
    expect(readdirSync(dataDir)).not.toContain('connection.lock');
    const local = JSON.parse((await other.call('mc_memory', { action: 'search' })).text);
    expect(local.entries).toHaveLength(1);
    // Simulate a ledger failure before any note can be submitted.
    const ledger = (client as unknown as { requests: { write: () => void } }).requests;
    const failure = vi.spyOn(ledger, 'write').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    await expect(client.call('mc_memory', { action: 'help' })).rejects.toThrow('disk unavailable');
    failure.mockRestore();
    expect(readdirSync(dataDir)).not.toContain('connection.lock');
    expect(JSON.parse((await other.call('mc_memory', { action: 'help' })).text)).toHaveProperty('retrievalMode');
  } finally { await client.disconnect(); await other.disconnect(); }
});
