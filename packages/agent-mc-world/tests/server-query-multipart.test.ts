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
