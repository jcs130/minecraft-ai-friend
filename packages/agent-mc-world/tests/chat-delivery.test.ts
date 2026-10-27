import { expect, it } from 'vitest';
import { chatDeliveryMessage } from '../core/chat-delivery.ts';
import { methodHarness } from './method-harness.ts';
import { Executor, type ChatDispatchContext } from '../core/executor.ts';
import type { Bot } from 'mineflayer';

it('separates public/vanilla private messages from commands and authentication', () => {
  expect(chatDeliveryMessage(' hello ')).toEqual({ channel: 'public', text: 'hello' });
  expect(chatDeliveryMessage('/tell Alex hello')).toEqual({ channel: 'private', to: 'Alex', text: 'hello' });
  for (const command of ['/login private-fixture', '/register private-fixture', '/mycli status', '/help', ''])
    expect(chatDeliveryMessage(command)).toBeNull();
});

it('returns and emits one logical-send receipt only after the chat transport call succeeds', async () => {
  const r = methodHarness('1.21.1');
  try {
    const text = '一句较长的逻辑回复。'.repeat(20);
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps: [{ skill: 'chat', text }] },
      { role: 'test', callId: 'reply-call', log: r.host.log });
    expect(result).toMatchObject({ meta: { chatDelivery: { protocol: 'agent-mc/chat-delivery/v1',
      status: 'sent', channel: 'public', text, callId: 'reply-call', boundary: 'client-transport', recipientRead: 'unknown' } } });
    const events = r.host.events.filter(e => e.type === 'minecraft.chat.sent');
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ outgoing: true, direction: 'outgoing', chatDelivery: { text } });
    expect(r.host.pushOpts[r.host.events.indexOf(events[0])]).toMatchObject({ trigger: 'piggyback' });
    expect(r.said).toEqual([text]);
  } finally { r.close(); }
});

it('does not emit a successful receipt when the actual transport throws', async () => {
  const r = methodHarness('1.21.1');
  try {
    r.bot.chat = () => { throw Error('socket closed'); };
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps: [{ skill: 'chat', text: 'hello' }] },
      { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true });
    expect(r.host.events.filter(e => e.type === 'minecraft.chat.sent')).toHaveLength(0);
  } finally { r.close(); }
});

it('keeps private recipient/body separate and does not describe the send as recipient acknowledgment', async () => {
  const r = methodHarness('1.21.1');
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps: [{ skill: 'chat', text: '/tell Alex hello' }] },
      { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ meta: { chatDelivery: { channel: 'private', to: 'Alex', text: 'hello', recipientRead: 'unknown' } } });
  } finally { r.close(); }
});

it('emits queued chat delivery at the actual step, with the same public task execution identity', async () => {
  const r = methodHarness('1.21.1');
  const world = r.world as unknown as { dispatchServerChat(text: string, send: () => void, context?: ChatDispatchContext): unknown;
    onTaskReport: ConstructorParameters<typeof Executor>[0]['report'] };
  const exec = new Executor({ getBot: () => r.bot as unknown as Bot, nextId: () => 42, log: r.host.log,
    report: report => world.onTaskReport(report), chatDispatch: (text, send, context) => { world.dispatchServerChat(text, send, context); } });
  r.exec.shutdown(); Object.assign(r.world, { executor: exec });
  try {
    const hold = exec.pauseForExternal('test owner');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'append', steps: [
      { skill: 'chat', text: '第一句' }, { skill: 'chat', text: '第二句' }] }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ execution: { terminal: false, id: expect.stringMatching(/:42$/) } });
    expect(r.said).toEqual([]); expect(r.host.events.filter(e => e.type === 'minecraft.chat.sent')).toHaveLength(0);
    exec.resumeAfterExternal(hold);
    const until = Date.now() + 1500;
    while (r.said.length < 2 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    expect(r.said).toEqual(['第一句', '第二句']);
    const events = r.host.events.filter(e => e.type === 'minecraft.chat.sent');
    expect(events.map(e => (e.meta?.chatDelivery as { stepIndex: number }).stepIndex)).toEqual([0, 1]);
    for (const event of events) expect(event.meta).toMatchObject({ chatDelivery: {
      taskExecutionId: (result as { execution: { id: string } }).execution.id, status: 'sent' } });
  } finally { exec.shutdown(); r.close(); }
});
