import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CommandRepetitionGuard } from '../src/client/command-repetition.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

const directories: string[] = [];
const directory = () => { const d = mkdtempSync(join(tmpdir(), 'mc-command-guard-')); directories.push(d); return d; };
afterEach(() => { for (const d of directories.splice(0)) {
  if (!resolve(d).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected fixture directory');
  rmSync(d, { recursive: true, force: true });
} });
const command = (text = '/opaque travel') => ({ steps: [{ skill: 'chat', text }] });

describe('opaque command repetition', () => {
  it('retains original request decisions and requires inspection after three consecutive submissions', () => {
    const book = new CommandRepetitionGuard();
    for (let n = 1; n <= 3; n++) expect(book.admit('mymc_do', command(), 'r' + n, n)?.admitted).toBe(true);
    const denied = book.admit('mymc_do', command(), 'r4', 99)!;
    expect(denied).toMatchObject({ admitted: false, submissions: 3, firstRequestId: 'r1', latestRequestId: 'r3', after: 1, serverEffect: 'unverified' });
    expect(book.admit('mymc_do', command(), 'r1', 100)?.submissions).toBe(1);
    expect(() => book.admit('mymc_do', command('/different'), 'r1', 0)).toThrow(/reused/);
    expect(JSON.stringify(book.snapshot())).not.toContain('/opaque');
    book.inspected();expect(book.admit('mymc_do', command(), 'r5', 101)).toMatchObject({ admitted: true, submissions: 1, serverEffect: 'unverified' });
  });
  it('keeps new command choices available and excludes public conversation, private messages and authentication', () => {
    const book = new CommandRepetitionGuard(1);
    expect(book.admit('mc_do', command(), 'one', 1)?.admitted).toBe(true);
    expect(book.admit('mc_do', command('/different'), 'two', 2)?.admitted).toBe(true);
    for (const text of ['hello', '/login private-fixture', '/authme:login private-fixture', '/minecraft:tell Alice hello'])
      for (let n = 0; n < 5; n++) expect(book.admit('mc_do', command(text), text + n, 3)).toBeNull();
    expect(book.admit('mc_observe', {}, 'observe', 4)).toBeNull();
    expect(JSON.stringify(book.snapshot())).not.toContain('private-fixture');
    expect(new CommandRepetitionGuard(0).admit('mc_do', command(), 'off', 0)).toBeNull();
    for (const limit of [-1, 1.5, 101, Infinity]) expect(() => new CommandRepetitionGuard(limit)).toThrow();
  });
  it('does not interpret invalid or mixed action plans as opaque command submissions', () => {
    const book = new CommandRepetitionGuard();
    for (const args of [{}, { steps: [] }, { steps: [null] }, { steps: [{ skill: 'chat', text: 1 }] },
      { steps: [{ skill: 'chat', text: '/test' }, { skill: 'look' }] }]) expect(book.admit('mc_do', args, 'invalid', 0)).toBeNull();
  });
  it('bounds a long repeated-command trace without issuing reads, cancellations or alternative actions', () => {
    const book = new CommandRepetitionGuard();
    const receipts = Array.from({ length: 93 }, (_, n) => book.admit('mymc_do', command(), 'trace-' + n, n));
    expect(receipts.filter(r => r?.admitted)).toHaveLength(3);
    expect(receipts.filter(r => r?.admitted === false)).toHaveLength(90);
    expect(new Set(receipts.map(r => r?.commandHash)).size).toBe(1);
    expect(receipts.every(r => r?.serverEffect === 'unverified')).toBe(true);
  });
  for (const prefix of ['mc', 'mymc'] as const) it(`guards ${prefix} SDK/MCP dispatch while retaining pending work and idempotent receipts`, async () => {
    let dispatched = 0;
    const epoch = '11111111-1111-4111-8111-111111111111';
    const runtime = new MinecraftAgentClient({ cfg: { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.invalid', username: 'GuardQA' }, dataDir: directory(), log: nullLogger() }, {
      id: 'fixture', start: async () => {}, stop: async () => {}, envPromptVars: () => ({}),
      tools: () => [{ name: `${prefix}_do`, tags: ['act', 'speak'], description: 'inert command dispatch', parameters: { type: 'object' }, handler: async () => {
        dispatched++;return { text: 'Chat submission accepted; server effect unknown', execution: { kind: 'task', id: `${epoch}:${dispatched}`, phase: 'accepted', terminal: false, goalCompleted: false } };
      } }],
    }, { profile: 'fixture', toolPrefix: prefix });
    const server = createMinecraftMcpServer(runtime, 'fixture'), client = new Client({ name: 'guard-fixture', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    try {
      await runtime.connect();await server.connect(left);await client.connect(right);
      for (let n = 1; n <= 3; n++) await runtime.call(`${prefix}_do`, command(), { requestId: 'same-' + n });
      const before = runtime.executionState();
      const blocked = await runtime.call(`${prefix}_do`, command(), { requestId: 'fourth' });
      expect(blocked.failed).toBe(true);expect(blocked.meta?.admission).toEqual({ accepted: false, dispatched: false, kind: 'repeat', rule: 'command_feedback_inspection' });
      expect(blocked.data?.reason).toBe('command_repetition_requires_inspection');expect(dispatched).toBe(3);
      expect(runtime.executionState()).toEqual(before);
      const replay = await runtime.call(`${prefix}_do`, command(), { requestId: 'same-1' });
      expect(replay.execution?.id).toBe(`${epoch}:1`);expect(dispatched).toBe(3);
      runtime.journal.pushEvent({ type: `${prefix}.chat`, ts: new Date().toISOString(), text: 'Synthetic server refusal', meta: { channel: 'system' } });
      await runtime.events({}); // An automatic host poll cannot unlock the command.
      expect((await runtime.call(`${prefix}_do`, command(), { requestId: 'still-blocked' })).failed).toBe(true);
      const next = blocked.data?.next_safe_read as { tool: string; arguments: Record<string, unknown> };
      const inspected = await client.callTool({ name: next.tool, arguments: next.arguments });
      expect(inspected.isError).not.toBe(true);
      const admitted = await runtime.call(`${prefix}_do`, command(), { requestId: 'after-inspection' });
      expect(admitted.failed).not.toBe(true);expect(admitted.meta?.commandRepetition).toMatchObject({ submissions: 1, serverEffect: 'unverified' });
      expect(dispatched).toBe(4);
    } finally { await client.close();await server.close();await runtime.disconnect(); }
  });
});
