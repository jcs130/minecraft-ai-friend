import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, type GameMemoryContext } from '../core/game-memory.ts';
import { PlayerMemoryRecall } from '../core/game-memory-player.ts';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { FakeHost } from './method-host.ts';

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'mc-player-recall-')); dirs.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const ctx: GameMemoryContext = { scope: { realm: 'server-A', account: 'offline:bot', agent: 'fixture' }, dimension: null };
const uuid = '9c1cde51-cf76-34a7-8574-19f37b63f50f';
const other = 'bc1cde51-cf76-34a7-8574-19f37b63f50f';
function save(book: GameMemoryBook, summary: string, tags = ['player:Alex'], observedAt = '2026-10-13T00:00:00Z', extra = {}) {
  return book.execute({ action: 'remember', kind: 'relationship', summary, content: 'full detail remains on demand', tags,
    source: { kind: 'user_report', speaker: 'Alex', reference: 'chat:event:1', observedAt }, ...extra }, ctx).entry as { id: string };
}
it('matches exact identities only, supports UUID rename, and rejects conflicting or unknown UUID bindings', () => {
  const book = new GameMemoryBook(directory()), recall = new PlayerMemoryRecall(book);
  save(book, 'exact name'); save(book, 'wrong partial', ['player:Alex2']);
  save(book, 'renamed account', ['player:FormerName', `player-uuid:${uuid}`]);
  save(book, 'wrong UUID', ['player:Alex', `player-uuid:${other}`]);
  const text = recall.recall({ name: 'alex', uuid, direct: true }, ctx)!.text;
  expect(text).toContain('exact name'); expect(text).toContain('renamed account');
  expect(text).not.toContain('wrong partial'); expect(text).not.toContain('wrong UUID');
  const unknown = recall.recall({ name: 'Alex', direct: true }, ctx)!.text;
  expect(unknown).toContain('exact name'); expect(unknown).not.toContain('renamed account'); expect(unknown).not.toContain('wrong UUID');
  expect(() => book.execute({ action: 'search', tags: [] }, ctx)).toThrow('1..12');
});
it('keeps three recent, attributed summaries, excludes archived/expired notes, and never writes or calls a service', () => {
  const dir = directory(), now = Date.parse('2026-10-14T00:00:00Z');
  const book = new GameMemoryBook(dir, () => now), recall = new PlayerMemoryRecall(book, () => now);
  for (let n = 1; n <= 5; n++) save(book, `NOTE_${n}`, ['player:Alex'], `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`);
  const id = save(book, 'ARCHIVED', ['player:Alex']).id;
  book.execute({ action: 'archive', id, expectedRevision: 1 }, ctx);
  save(book, 'EXPIRED', ['player:Alex'], undefined, { expiresAt: '2026-10-13T00:00:00Z' });
  const bytes = readFileSync(join(dir, readdirSync(dir)[0]));
  const network = vi.fn(() => { throw new Error('no implicit network'); }); vi.stubGlobal('fetch', network);
  try {
    const result = recall.recall({ name: 'Alex', direct: true }, ctx)!;
    expect(result.meta).toMatchObject({ historical: true, currentWorldVerified: false, localOnly: true });
    expect(result.meta.entries).toHaveLength(3);
    for (const n of [3, 4, 5]) expect(result.text).toContain(`NOTE_${n}`);
    for (const text of ['NOTE_1', 'NOTE_2', 'ARCHIVED', 'EXPIRED', 'full detail']) expect(result.text).not.toContain(text);
    expect(result.text).toContain('"speaker":"Alex"'); expect(result.text).toContain('chat:event:1');
    expect(network).not.toHaveBeenCalled(); expect(readFileSync(join(dir, readdirSync(dir)[0]))).toEqual(bytes);
  } finally { vi.unstubAllGlobals(); }
});
it('isolates scopes, suppresses repeated proximity but refreshes chat, and restores notes after reconstruction', () => {
  const dir = directory(); let now = Date.parse('2026-10-14T00:00:00Z');
  const book = new GameMemoryBook(dir); save(book, 'KNOWN');
  const recall = new PlayerMemoryRecall(book, () => now);
  expect(recall.recall({ name: 'Alex', direct: false }, ctx)!.text).toContain('KNOWN');
  expect(recall.recall({ name: 'Alex', direct: false }, ctx)).toBeNull();
  expect(recall.recall({ name: 'Alex', direct: true }, ctx)!.text).toContain('KNOWN');
  now += 30000; expect(recall.recall({ name: 'Alex', direct: false }, ctx)).not.toBeNull();
  for (const scope of [{ ...ctx.scope, realm: 'server-B' }, { ...ctx.scope, account: 'other' }, { ...ctx.scope, agent: 'other' }]) {
    const text = recall.recall({ name: 'Alex', direct: true }, { ...ctx, scope })!.text;
    expect(text).not.toContain('KNOWN'); expect(text).toContain('不证明初次见面');
  }
  expect(new PlayerMemoryRecall(new GameMemoryBook(dir)).recall({ name: 'Alex', direct: true }, ctx)!.text).toContain('KNOWN');
  expect(new PlayerMemoryRecall(new GameMemoryBook(null)).recall({ name: 'Alex', direct: true }, ctx)).toBeNull();
});

class EncounterWorld extends MinecraftWorld {
  attachFixture(host: FakeHost) { this.host = host; }
  override reportWorldDelta() {} // Fixture has no connected bot; do not manufacture a snapshot.
  deliver(type: string, text: string, deliver = true) {
    this.emit(type, text, true, { deliver, meta: { uname: 'Alex', senderUuid: uuid,
      ...(type === 'minecraft.event' ? { minecraftPlayerObservation: { kind: 'gesture' } } : {}) } }, 'Alex');
  }
}
it('delivers recall before an encounter while preserving original player text, sender and archival behavior', () => {
  const world = new EncounterWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: directory() }), host = new FakeHost();
  world.attachFixture(host);
  const original = '[Minecraft] Alex: 我带了面包';
  world.deliver('minecraft.chat', original);
  expect(host.events.map(e => e.type)).toEqual(['minecraft.memory', 'minecraft.chat']);
  expect(host.events[0].senderKey).toBe('minecraft.memory');
  expect(host.pushOpts[0]?.trigger).toBe('piggyback');
  expect(host.events[1]).toMatchObject({ text: original, senderKey: 'Alex', meta: { gamePlayerMemory: { playerName: 'Alex' } } });
  world.deliver('minecraft.chat', 'archived only', false);
  expect(host.events.at(-1)?.text).toBe('archived only'); expect(host.events).toHaveLength(3);
  const fresh = new EncounterWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS), dataDir: directory() }), nearby = new FakeHost();
  fresh.attachFixture(nearby); fresh.deliver('minecraft.event', 'Alex 挥手');
  expect(nearby.events.map(e => e.type)).toEqual(['minecraft.memory', 'minecraft.event']);
  expect(nearby.events[1].text).toBe('Alex 挥手');
});
