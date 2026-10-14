import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GameMemoryBook, type GameMemoryContext } from '../core/game-memory.ts';
import { MinecraftWorldProxy } from '../core/proxy.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/index.ts';
import { FakeHost } from './method-host.ts';

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'mc-memory-test-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const ctx: GameMemoryContext = { scope: { realm: 'weak:fixture.invalid:25565', account: 'offline:alice', agent: 'fixture' }, dimension: 'minecraft:overworld' };
const note = { action: 'remember', kind: 'method', summary: '水下换气方法', content: '先读氧气；仅在实际水中使用。未验证长距离下潜。源码sha:test；失败task:1', source: { kind: 'hypothesis', reference: 'task:1' }, tags: ['下潜', '换气'] };
const entry = (result: Record<string, unknown>) => result.entry as { id: string; revision: number; source: { kind: string }; content: string };

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
