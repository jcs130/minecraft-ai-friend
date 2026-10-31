import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_QUERY_TOOL, serverQueryTool, ServerQueryLane, type ServerQueryContext, type ServerQueryDefinition } from '../core/server-query.ts';
import type { ToolOutcome } from '../core/support/host-contract.ts';
import Ajv from 'ajv';
import { compactToolSchema } from '../src/client/context-budget.ts';

const definitions: ServerQueryDefinition[] = [{ id: 'status', description: 'Read my server status',
  command: args => args.length === 0 ? '/mycli status' : null,
  matchReply: (text, _args, username) => text === `Status ${username}: ready` ? { ok: true, data: { ready: true } } : null,
}, { id: 'inventory', description: 'Read a named inventory', command: args => args.length === 1 ? `/inventory ${args[0]}` : null,
  matchReply: text => text === 'inventory denied' ? { ok: false } : null }];

const setup = (overrides: Partial<ServerQueryContext> = {}) => {
  const terminal = vi.fn<(outcome: ToolOutcome) => void>();
  const lane = new ServerQueryLane({ onTerminal: terminal });
  const send = vi.fn();
  const context: ServerQueryContext = { generation: 'connection-1', username: 'alice', send, ...overrides };
  return { lane, terminal, send, context };
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('read-only server query lane', () => {
  it('binds query-specific argument requirements and exclusive call forms in full and compact schemas', () => {
    const noArguments = { type: 'array' as const, minItems: 0, maxItems: 0, items: { type: 'string' as const } };
    const subject = { type: 'array' as const, minItems: 1, maxItems: 1,
      items: { type: 'string' as const, pattern: '^[a-z][a-z0-9_-]{0,63}$', maxLength: 64 } };
    const registered = [
      { ...definitions[0], argumentsSchema: noArguments },
      { ...definitions[0], id: 'skills.status', argumentsSchema: noArguments },
      { ...definitions[1], id: 'dungeon.status', argumentsSchema: subject },
      { ...definitions[1], id: 'dungeon.info', argumentsSchema: subject },
    ];
    const tool = serverQueryTool(registered);
    for (const schema of [tool.parameters, compactToolSchema(tool, tool.parameters).schema]) {
      expect((schema as any).properties).toHaveProperty('query');
      expect((schema as any).properties).toHaveProperty('arguments');
      expect((schema as any).properties).toHaveProperty('requestId');
      const validate = new Ajv({ strict: false }).compile(schema as object);
      for (const input of [{}, { requestId: 'query-returned' }, { query: 'status' },
        { query: 'skills.status', arguments: [] }, { query: 'dungeon.status', arguments: ['observed_site'] },
        { query: 'dungeon.info', arguments: ['observed_site'] }]) expect(validate(input), JSON.stringify(input)).toBe(true);
      for (const input of [{ query: 'dungeon.status' }, { query: 'dungeon.status', arguments: [] },
        { query: 'dungeon.info', arguments: ['Invented;command'] }, { query: 'status', arguments: ['unexpected'] },
        { query: 'status', requestId: 'query-returned' }, { requestId: 'query-returned', arguments: [] },
        { arguments: [] }, { query: 'unregistered' }, { query: 'dungeon.status', arguments: ['one', 'two'] }]) {
        expect(validate(input), JSON.stringify(input)).toBe(false);
      }
      // Identical argument shapes share a branch rather than repeating the
      // protocol catalogue in every model request.
      expect((schema as any).anyOf).toHaveLength(4);
    }
    expect(tool.description!.slice(0, 300)).toContain('Required subject IDs');
    expect(serverQueryTool([])).toBe(SERVER_QUERY_TOOL);
  });

  it('publishes selected argument contracts and rejects missing arguments without guessing a subject or dispatching', () => {
    const { lane, send, context } = setup();
    const query: ServerQueryDefinition = { ...definitions[1], argumentsSchema: {
      type: 'array', minItems: 1, maxItems: 1, items: { type: 'string', pattern: '^[a-z]+$' },
    } };
    expect(lane.call({}, [query], null).data?.queries).toEqual([{
      id: query.id, description: query.description, argumentsSchema: query.argumentsSchema,
    }]);
    expect(lane.call({ query: 'inventory' }, [query], context)).toMatchObject({ failed: true,
      data: { goal_completed: false, queryDefinition: { id: 'inventory', argumentsSchema: query.argumentsSchema } } });
    expect(send).not.toHaveBeenCalled();
    expect(serverQueryTool([query]).parameters.properties.query).toMatchObject({ enum: ['inventory'] });
    expect(serverQueryTool([])).toBe(SERVER_QUERY_TOOL);
    expect(SERVER_QUERY_TOOL.parameters.properties.query).not.toHaveProperty('enum');
  });
  it.each([{ query: 'missing' }, { query: 'status', requestId: 'invented' }, { command: '/status' }])(
    'returns configured repair information with rejected %j without dispatching', args => {
      const { lane, send, context } = setup();
      const result = lane.call(args, definitions, context);
      expect(result).toMatchObject({ failed: true, data: { goal_completed: false, recovery: {
        supportedQueryIds: ['status', 'inventory'], moreQueries: 0, index: {},
      } } });
      expect(result.data?.next_safe_read).toEqual({ tool: 'mc_help', arguments: { skill: 'chat' } });
      expect(result.text).toContain('"next_safe_read":{"tool":"mc_help","arguments":{"skill":"chat"}}');
      expect(result.text).toContain('never invent it or combine it with query');
      expect(result.text).toContain('"supportedQueryIds":["status","inventory"]');
      expect(result.text).not.toContain('dungeon');
      expect(send).not.toHaveBeenCalled();
    });

  it('bounds error recovery instead of expanding every configured protocol description', () => {
    const { lane, send, context } = setup();
    const many = Array.from({ length: 100 }, (_, i) => ({ ...definitions[0], id: `query${i}`, description: 'large'.repeat(2000) }));
    const result = lane.call({ query: 'missing' }, many, context);
    expect(result.data?.recovery).toMatchObject({ supportedQueryIds: expect.any(Array), moreQueries: 68 });
    expect((result.data?.recovery as any).supportedQueryIds).toHaveLength(32);
    expect(result.text.length).toBeLessThan(2000);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not reinterpret an invented requestId as a new query or auto-retry', () => {
    const { lane, send, context } = setup();
    const result = lane.call({ requestId: 'query-invented' }, definitions, context);
    expect(result.data).toMatchObject({ found: false, outcomeUnknown: true, goal_completed: false });
    expect(result.data?.recovery).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns only the rejected query contract so a missing subject can be repaired without guessing or retrying', () => {
    const {lane,send,context}=setup();
    const selected={...definitions[1],description:'Read one inventory. arguments:["observed_inventory_id"].'};
    const result=lane.call({query:'inventory'},[definitions[0],selected],context);
    expect(result.data?.queryDefinition).toEqual({id:selected.id,description:selected.description});
    expect(result.text).toContain('observed_inventory_id');
    expect(send).not.toHaveBeenCalled();
    const repaired=lane.call({query:'inventory',arguments:['personal']},[definitions[0],selected],context);
    expect(repaired.data).toMatchObject({phase:'sent'});
    expect(send).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledWith('/inventory personal');
    lane.reset('Fixture finished');
  });

  it('lists configured protocols offline and does not become a body/barrier tool', () => {
    const { lane } = setup();
    expect(lane.call({}, definitions, null).data?.queries).toEqual(definitions.map(({ id, description }) => ({ id, description })));
    expect(SERVER_QUERY_TOOL).toMatchObject({ name: 'mc_query', tags: ['read'] });
    expect(SERVER_QUERY_TOOL.barrierAfter).not.toBe(true);
    expect(SERVER_QUERY_TOOL.endsTurn).not.toBe(true);
  });

  it('returns sent immediately, leaves body-free observation pending, then correlates only matching server feedback', () => {
    const { lane, terminal, send, context } = setup();
    const sent = lane.call({ query: 'status' }, definitions, context);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('/mycli status');
    expect(sent.data).toMatchObject({ phase: 'sent', outcomeUnknown: true, requestNonce: false, goal_completed: false,
      sentAt: '2026-10-26T09:00:00.000Z', sentAtMs: Date.now() });
    expect(sent.text).toContain('待回复');
    expect(terminal).not.toHaveBeenCalled();
    expect(lane.receive('Status alice: ready', 'other-connection', 'alice')).toBe(false);
    expect(lane.receive('Status alice: ready', 'connection-1', 'bob')).toBe(false);
    expect(lane.receive('unrelated message', 'connection-1', 'alice')).toBe(false);
    expect(lane.receive('Status alice: ready', 'connection-1', 'alice')).toBe(true);
    const read = lane.call({ requestId: sent.data?.requestId }, definitions, context);
    expect(read.data).toMatchObject({ phase: 'replied', goal_completed: false, requestNonce: false, outcomeUnknown: false,
      reply: { text: 'Status alice: ready', data: { ready: true }, ok: true } });
    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal.mock.calls[0][0]).toEqual(read);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses a pending identical request and rejects a different one without sending it', () => {
    const { lane, send, context } = setup();
    const sent = lane.call({ query: 'status' }, definitions, context);
    expect(lane.call({ query: 'status', arguments: [] }, definitions, context).data).toMatchObject({ requestId: sent.data?.requestId, reused: true });
    expect(lane.call({ query: 'inventory', arguments: ['bag'] }, definitions, context).data).toMatchObject({ busy: true, requestId: sent.data?.requestId });
    expect(send).toHaveBeenCalledOnce();
  });

  it('reuses a completed receipt for five seconds then permits an explicit new request', () => {
    const { lane, send, context } = setup();
    const first = lane.call({ query: 'status' }, definitions, context);
    lane.receive('Status alice: ready', context.generation, context.username);
    vi.advanceTimersByTime(4999);
    expect(lane.call({ query: 'status' }, definitions, context).data).toMatchObject({ requestId: first.data?.requestId, reused: true });
    vi.advanceTimersByTime(1);
    expect(lane.call({ query: 'status' }, definitions, context).data?.requestId).not.toBe(first.data?.requestId);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('times out from send, reports unknown without failure or retry, and retains the inspectable receipt', () => {
    const { lane, terminal, send, context } = setup();
    const sent = lane.call({ query: 'status' }, definitions, context);
    vi.advanceTimersByTime(4999);
    expect(terminal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const read = lane.call({ requestId: sent.data?.requestId }, definitions, context);
    expect(read.data).toMatchObject({ phase: 'timeout', outcomeUnknown: true, goal_completed: false });
    expect(read.failed).toBeUndefined();
    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal).toHaveBeenCalledWith(read);
    expect(lane.receive('Status alice: ready', context.generation, context.username)).toBe(false);
    expect(lane.call({ query: 'status' }, definitions, context).data).toMatchObject({ phase: 'timeout', reused: true });
    vi.advanceTimersByTime(60000);
    expect(send).toHaveBeenCalledOnce();
  });

  it('checks the real deadline before matching even when the event-loop timeout has not run', () => {
    let now = 10000;
    const lane = new ServerQueryLane({ now: () => now });
    const context = { generation: 'g', username: 'alice', send: vi.fn() };
    const sent = lane.call({ query: 'status' }, definitions, context);
    now += 5001;
    expect(lane.receive('Status alice: ready', 'g', 'alice')).toBe(false);
    expect(lane.call({ requestId: sent.data?.requestId }, definitions, context).data?.phase).toBe('timeout');
  });

  it('registers before send and emits exactly one synchronous reply after a successful send', () => {
    const { lane, terminal, context } = setup();
    context.send = () => {
      expect(lane.receive('Status alice: ready', context.generation, context.username)).toBe(true);
      expect(terminal).not.toHaveBeenCalled();
    };
    expect(lane.call({ query: 'status' }, definitions, context).data?.phase).toBe('replied');
    expect(terminal).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a send throw as send_failed even if a synchronous reply was captured, without false terminal success', () => {
    const { lane, terminal, context } = setup();
    context.send = () => {
      lane.receive('Status alice: ready', context.generation, context.username);
      throw new Error('transport stopped');
    };
    const result = lane.call({ query: 'status' }, definitions, context);
    expect(result).toMatchObject({ failed: true, data: { phase: 'send_failed', outcomeUnknown: true } });
    expect(result.data?.reply).toBeUndefined();
    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal).toHaveBeenCalledWith(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels on reset, cleans timers and preserves bounded history without accepting later replies', () => {
    const { lane, terminal, context } = setup();
    const sent = lane.call({ query: 'status' }, definitions, context);
    lane.reset('Disconnected');
    expect(lane.call({ requestId: sent.data?.requestId }, definitions, null).data).toMatchObject({ phase: 'cancelled', reason: 'Disconnected', outcomeUnknown: true });
    expect(lane.receive('Status alice: ready', context.generation, context.username)).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(terminal).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('scope changes cancel pending and cannot reuse old-session terminal receipts', () => {
    const { lane, terminal, send, context } = setup();
    const first = lane.call({ query: 'status' }, definitions, context);
    const nextContext = { ...context, generation: 'connection-2' };
    const second = lane.call({ query: 'status' }, definitions, nextContext);
    expect(second.data?.requestId).not.toBe(first.data?.requestId);
    expect(lane.call({ requestId: first.data?.requestId }, definitions, nextContext).data?.phase).toBe('cancelled');
    expect(send).toHaveBeenCalledTimes(2);
    expect(terminal).toHaveBeenCalledOnce();
    expect(lane.receive('Status alice: ready', context.generation, context.username)).toBe(false);
    expect(lane.receive('Status alice: ready', nextContext.generation, nextContext.username)).toBe(true);
  });

  it.each(['sent', 'replied'] as const)('reset prevents reusing an old %s receipt even when generation and username are unchanged', phase => {
    const { lane, send, context } = setup({ afterSequence: 10 });
    const first = lane.call({ query: 'status' }, definitions, context);
    if (phase === 'replied') lane.receive('Status alice: ready', context.generation, context.username, 11);
    lane.reset('Player respawned in the same dimension');
    const second = lane.call({ query: 'status' }, definitions, { ...context, afterSequence: 12 });
    expect(second.data).toMatchObject({ phase: 'sent', afterSequence: 12 });
    expect(second.data?.requestId).not.toBe(first.data?.requestId);
    expect(second.data?.reused).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(lane.call({ requestId: first.data?.requestId }, definitions, context).data?.phase).toBe(phase === 'sent' ? 'cancelled' : 'replied');
    expect(lane.receive('Status alice: ready', context.generation, context.username, 11)).toBe(false);
    expect(lane.receive('Status alice: ready', context.generation, context.username, 13)).toBe(true);
  });

  it('does not erase a new query scope when a consumer synchronously starts it from a cancellation callback', () => {
    const context = { generation: 'g', username: 'alice', send: vi.fn() };
    let next: ToolOutcome | undefined;
    const lane = new ServerQueryLane({ onTerminal: outcome => {
      if (outcome.data?.phase === 'cancelled') next = lane.call({ query: 'status' }, definitions, context);
    } });
    const first = lane.call({ query: 'status' }, definitions, context);
    lane.reset('Observation lifecycle changed');
    expect(next?.data?.requestId).not.toBe(first.data?.requestId);
    expect(next?.data?.phase).toBe('sent');
    expect(context.send).toHaveBeenCalledTimes(2);
    expect(lane.receive('Status alice: ready', 'g', 'alice')).toBe(true);
    expect(lane.call({ requestId: next!.data?.requestId }, definitions, context).data?.phase).toBe('replied');
  });

  it('does not confuse an explicit server rejection with unknown timeout', () => {
    const { lane, context } = setup();
    const sent = lane.call({ query: 'inventory', arguments: ['bag'] }, definitions, context);
    lane.receive('inventory denied', context.generation, context.username);
    expect(lane.call({ requestId: sent.data?.requestId }, definitions, context)).toMatchObject({ failed: true,
      data: { phase: 'replied', outcomeUnknown: false, reply: { ok: false }, goal_completed: false } });
  });

  it('rejects already-arrived replies deferred to a microtask and requires a newer arrival sequence', () => {
    const { lane, context } = setup({ afterSequence: 41 });
    const sent = lane.call({ query: 'status' }, definitions, context);
    expect(sent.data?.afterSequence).toBe(41);
    expect(lane.receive('Status alice: ready', context.generation, context.username)).toBe(false);
    expect(lane.receive('Status alice: ready', context.generation, context.username, 40)).toBe(false);
    expect(lane.receive('Status alice: ready', context.generation, context.username, 41)).toBe(false);
    expect(lane.receive('Status alice: ready', context.generation, context.username, Number.NaN)).toBe(false);
    expect(lane.receive('Status alice: ready', context.generation, context.username, 42)).toBe(true);
  });

  it.each([{ command: '/op alice' }, { query: 'missing' }, { query: 'status', requestId: 'x' },
    { query: 'inventory', arguments: ['x\n/op alice'] }, { query: 'inventory', arguments: [2] },
    { query: 'status', arguments: 'x' }, { query: 'status', arguments: ['unexpected'] }])('rejects invalid query %j before sending', args => {
    const { lane, send, context } = setup();
    expect(lane.call(args, definitions, context).failed).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('handles unavailable connection, ambiguous definitions and broken command builders without side effects', () => {
    const { lane, send, context } = setup();
    expect(lane.call({ query: 'status' }, definitions, null).failed).toBe(true);
    expect(lane.call({ query: 'status' }, [...definitions, definitions[0]], context).failed).toBe(true);
    for (const command of [() => { throw new Error('invalid'); }, () => '/first\n/second']) {
      expect(lane.call({ query: 'status' }, [{ ...definitions[0], command }], context).failed).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed direct-call arguments and invalid arrival watermarks without sending', () => {
    const { lane, send, context } = setup();
    for (const args of [null, [], 'status']) {
      expect(lane.call(args as unknown as Record<string, unknown>, definitions, context).failed).toBe(true);
    }
    for (const afterSequence of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
      expect(lane.call({ query: 'status' }, definitions, { ...context, afterSequence }).failed).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('starts its timeout at dispatch after command construction, not before argument validation', () => {
    let now = 0;
    const lane = new ServerQueryLane({ now: () => now });
    const context = { generation: 'g', username: 'alice', send: vi.fn() };
    const result = lane.call({ query: 'status' }, [{ ...definitions[0], command: () => {
      now += 1000;
      return '/mycli status';
    } }], context);
    expect(result.data?.sentAtMs).toBe(1000);
    now = 5999;
    expect(lane.call({ requestId: result.data?.requestId }, definitions, context).data?.phase).toBe('sent');
    now = 6000;
    expect(lane.call({ requestId: result.data?.requestId }, definitions, context).data?.phase).toBe('timeout');
  });

  it('bounds retained replies/data, tolerates parser and event-consumer exceptions, and snapshots outcomes', () => {
    const context = { generation: 'g', username: 'alice', send: vi.fn() };
    const lane = new ServerQueryLane({ onTerminal: () => { throw new Error('sink unavailable'); } });
    const huge = 'x'.repeat(10000);
    const queries: ServerQueryDefinition[] = [{ ...definitions[0], matchReply: text => {
      if (text === 'throw') throw new Error('parser');
      return { data: { huge } };
    } }];
    const sent = lane.call({ query: 'status' }, queries, context);
    expect(lane.receive('throw', 'g', 'alice')).toBe(false);
    expect(lane.receive(huge, 'g', 'alice')).toBe(true);
    const read = lane.call({ requestId: sent.data?.requestId }, queries, context);
    expect(read.data?.reply).toMatchObject({ textTruncated: true, dataTruncated: true });
    expect(JSON.stringify(read.data).length).toBeLessThan(5000);
    (read.data as Record<string, unknown>).phase = 'tampered';
    expect(lane.call({ requestId: sent.data?.requestId }, queries, context).data?.phase).toBe('replied');
  });

  it('retains at most 32 receipts and reports evicted IDs as unknown rather than server failure', () => {
    const { lane, context, send } = setup();
    const ids: unknown[] = [];
    for (let index = 0; index < 34; index++) {
      const scoped = { ...context, generation: `g-${index}` };
      ids.push(lane.call({ query: 'status' }, definitions, scoped).data?.requestId);
      lane.receive('Status alice: ready', scoped.generation, scoped.username);
    }
    const expired = lane.call({ requestId: ids[0] }, definitions, null);
    expect(expired.data).toMatchObject({ found: false, outcomeUnknown: true, goal_completed: false });
    expect(expired.failed).toBeUndefined();
    expect(lane.call({ requestId: ids[1] }, definitions, null).data?.found).toBe(false);
    expect(lane.call({ requestId: ids[2] }, definitions, null).data?.phase).toBe('replied');
    expect(send).toHaveBeenCalledTimes(34);
  });
});
