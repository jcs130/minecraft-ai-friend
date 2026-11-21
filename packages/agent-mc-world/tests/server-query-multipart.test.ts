import { afterEach, expect, it, vi } from 'vitest';
import { ServerQueryLane, type ServerQueryDefinition } from '../core/server-query.ts';

const definition: ServerQueryDefinition = {
  id: 'pages', description: 'Fixture paged inventory', command: () => '/fixture list', maxReplyParts: 54,
  matchReply: (text, _args, _user, parts = []) => text.startsWith('ROW ')
    ? { partial: true, data: { item: text.slice(4) } }
    : text === `END ${parts.length}` ? { ok: true, data: { items: parts, complete: true } } : null,
};
const setup = (send = vi.fn()) => {
  const terminal = vi.fn(), lane = new ServerQueryLane({ onTerminal: terminal });
  const context = { username: 'alice', generation: 'one', afterSequence: 10, send };
  return { lane, terminal, context };
};
afterEach(() => vi.useRealTimers());

it('bounds multipart Unicode rows and final envelopes by UTF-8 bytes', () => {
  const row = '字'.repeat(12000);
  const r = setup();
  r.lane.call({ query: 'pages' }, [definition], r.context);
  r.lane.receive(`ROW ${row}`, 'one', 'alice', 11);
  r.lane.receive(`ROW ${row}`, 'one', 'alice', 12);
  expect(r.terminal).toHaveBeenCalledTimes(1);
  expect(r.terminal.mock.calls[0][0].data).toMatchObject({ phase: 'cancelled',
    partialReply: { complete: false, parts: [{ item: row }] } });
  expect(r.context.send).toHaveBeenCalledTimes(1);
  const final = setup();
  final.lane.call({ query: 'pages' }, [{ ...definition,
    matchReply: () => ({ ok: true, data: { item: '字'.repeat(24000) } }) }], final.context);
  final.lane.receive('END', 'one', 'alice', 11);
  expect(final.terminal.mock.calls[0][0].data).toMatchObject({ phase: 'cancelled', outcomeUnknown: true });
});

it('collects rows without settling, rejects duplicate/old delivery, then emits a single complete receipt', () => {
  const { lane, terminal, context } = setup();
  const sent = lane.call({ query: 'pages' }, [definition], context);
  expect(lane.receive('ROW sword', 'one', 'alice', 11)).toBe(true);
  expect(lane.receive('ROW duplicate', 'one', 'alice', 11)).toBe(false);
  expect(lane.receive('ROW stale', 'old', 'alice', 12)).toBe(false);
  expect(terminal).not.toHaveBeenCalled();
  expect(lane.call({ requestId: sent.data!.requestId }, [definition], context).data?.phase).toBe('sent');
  expect(lane.receive('END 2', 'one', 'alice', 12)).toBe(false);
  expect(lane.receive('ROW shield', 'one', 'alice', 13)).toBe(true);
  expect(lane.receive('END 2', 'one', 'alice', 14)).toBe(true);
  expect(terminal).toHaveBeenCalledTimes(1);
  expect(terminal.mock.calls[0][0].data).toMatchObject({ phase: 'replied', outcomeUnknown: false,
    reply: { data: { complete: true, items: [{ item: 'sword' }, { item: 'shield' }] } } });
  lane.reset('end');
});

it('reads an oversized merchant-shaped receipt in whole rows without losing the archived data', () => {
  const { lane, terminal, context } = setup();
  const rows = Array.from({ length: 34 }, (_, index) => ({ offerId: `item-${index}`,
    price: index + 2, item: { name: `物品 ${index}`, detail: ('fresh values \\ "' + '甲').repeat(34), unknown: null } }));
  context.send.mockImplementation(() => {
    rows.forEach((row, index) => lane.receive('ROW ' + JSON.stringify(row), 'one', 'alice', 11 + index));
    lane.receive('END 34', 'one', 'alice', 11 + rows.length);
  });
  const parsedDefinition = { ...definition, matchReply: (text: string, _args: readonly string[], _user: string, parts: readonly unknown[] = []) =>
    text.startsWith('ROW ') ? { partial: true, data: JSON.parse(text.slice(4)) } :
      text === `END ${parts.length}` ? { ok: true, data: { balance: 2488, complete: true, items: parts } } : null };
  const first = lane.call({ query: 'pages' }, [parsedDefinition], context);
  const stored = terminal.mock.calls[0][0];
  const receiptId = first.data?.requestId;
  expect(stored.text.length).toBeGreaterThan(23_000);
  expect(first.data).toEqual(stored.data);
  expect(first.data?.reply).toMatchObject({ data: { complete: true, items: rows } });
  const received = [];
  let toolOutput = first;
  let previousOffset = 0;
  for (;;) {
    expect(toolOutput.text.length).toBeLessThanOrEqual(7_000);
    const view = JSON.parse(toolOutput.text.split('\n')[1]);
    expect(view).toMatchObject({ requestId: receiptId, phase: 'replied', goal_completed: false,
      receiptView: { unit: 'items', offset: previousOffset, total: rows.length },
      reply: { data: { balance: 2488, complete: true } } });
    expect(view.receiptView.returned).toBeGreaterThan(0);
    received.push(...view.reply.data.items);
    if (!view.receiptView.hasMore) {
      expect(view).not.toHaveProperty('next_safe_read');
      break;
    }
    expect(view.next_safe_read).toEqual({tool: 'mc_query_receipt', arguments: { requestId: receiptId,
      offset: previousOffset + view.receiptView.returned }});
    previousOffset = view.next_safe_read.arguments.offset;
    toolOutput = lane.readReceipt(view.next_safe_read.arguments);
    expect(toolOutput.data).toEqual(stored.data);
  }
  expect(received).toEqual(rows);
  expect(lane.readReceipt({requestId: receiptId, offset: rows.length})).toMatchObject({ failed: true });
  expect(lane.readReceipt({requestId: receiptId, offset: '2'})).toMatchObject({ failed: true });
  expect(lane.call({requestId: receiptId, offset: 2, query: 'pages'}, [parsedDefinition], context)).toMatchObject({ failed: true });
  expect(context.send).toHaveBeenCalledTimes(1);
});

it('keeps exact JSON available for oversized non-list outcomes and leaves failures honest', () => {
  const { lane, terminal, context } = setup();
  const payload = { details: ('雪🌱' + '\\"').repeat(5_000), stable: null };
  const sent = lane.call({ query: 'pages' }, [{ ...definition, matchReply: () => ({ ok: true, data: payload }) }], context);
  expect(lane.readReceipt({ requestId: sent.data?.requestId, offset: 1 })).toMatchObject({ failed: true });
  expect(lane.receive('END', 'one', 'alice', 11)).toBe(true);
  const stored = terminal.mock.calls[0][0];
  let args: Record<string, unknown> | undefined = { requestId: sent.data?.requestId };
  let received = '';
  while (args) {
    const result = lane.call(args, [definition], context);
    expect(result.text.length).toBeLessThanOrEqual(7_000);
    const view = JSON.parse(result.text.split('\n')[1]);
    expect(view.receiptView).toMatchObject({ unit: 'utf16', offset: received.length });
    expect(view.jsonChunk.length).toBeGreaterThan(0);
    received += view.jsonChunk;
    args = view.next_safe_read?.arguments;
  }
  expect(received).toBe(JSON.stringify(stored.data));
  expect(context.send).toHaveBeenCalledTimes(1);
});

it.each(['timeout', 'cancelled'] as const)('keeps partial evidence explicitly incomplete on %s without retry', phase => {
  vi.useFakeTimers();
  const { lane, terminal, context } = setup();
  lane.call({ query: 'pages' }, [definition], context);
  lane.receive('ROW sword', 'one', 'alice', 11);
  if (phase === 'timeout') vi.advanceTimersByTime(5001); else lane.reset('connection changed');
  expect(terminal.mock.calls[0][0].data).toMatchObject({ phase, outcomeUnknown: true,
    partialReply: { complete: false, parts: [{ item: 'sword' }] } });
  expect(context.send).toHaveBeenCalledTimes(1);
});

it('handles synchronous rows and terminal without accepting later rows or masking a send exception', () => {
  let lane: ServerQueryLane;
  const r = setup(vi.fn(() => { lane.receive('ROW one', 'one', 'alice', 11); lane.receive('END 1', 'one', 'alice', 12);
    expect(lane.receive('ROW late', 'one', 'alice', 13)).toBe(false); }));
  lane = r.lane;
  expect(lane.call({ query: 'pages' }, [definition], r.context).data).toMatchObject({ phase: 'replied', reply: { data: { items: [{ item: 'one' }] } } });
  lane.reset('again');
  r.context.send.mockImplementation(() => { lane.receive('ROW partial', 'one', 'alice', 11); throw Error('transport'); });
  expect(lane.call({ query: 'pages' }, [definition], r.context).data).toMatchObject({ phase: 'send_failed', outcomeUnknown: true });
});

it('bounds both row count and aggregate size and never accepts partial rows without opt-in', () => {
  for (const [maxReplyParts, row] of [[1, 'small'], [54, 'x'.repeat(40000)]] as const) {
    const { lane, terminal, context } = setup();
    lane.call({ query: 'pages' }, [{ ...definition, maxReplyParts }], context);
    lane.receive(`ROW ${row}`, 'one', 'alice', 11); lane.receive(`ROW ${row}`, 'one', 'alice', 12);
    expect(terminal.mock.calls[0][0].data).toMatchObject({ phase: 'cancelled', outcomeUnknown: true, partialReply: { complete: false } });
  }
  const { lane, terminal, context } = setup();
  lane.call({ query: 'pages' }, [{ ...definition, maxReplyParts: undefined }], context);
  expect(lane.receive('ROW ignored', 'one', 'alice', 11)).toBe(false);
  expect(terminal).not.toHaveBeenCalled(); lane.reset('end');
});
