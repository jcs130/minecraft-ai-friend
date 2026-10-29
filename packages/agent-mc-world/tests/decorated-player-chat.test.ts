import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { MessageInbox } from '../src/client/message-inbox.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => rigs.splice(0).forEach(r => r.close()));

function fixture() {
  const r = methodHarness('1.21.1'); rigs.push(r);
  const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
  const nbt = req('prismarine-nbt');
  // Paper's raw chat type has only content; the sender and decorated display
  // arrive separately. This is the real registry/ChatMessage path, not a regex.
  r.bot.registry.loadDimensionCodec({ id: 'minecraft:chat_type', entries: [{ key: 'example:raw',
    value: nbt.comp({ chat: nbt.comp({ translation_key: nbt.string('%s'),
      parameters: nbt.list(nbt.string(['content'])) }) }) }] });
  const ChatMessage = req('prismarine-chat')(r.bot.registry);
  const typeId = Number(Object.entries(r.bot.registry.chatFormattingById)
    .find(([, value]) => (value as { name: string }).name === 'example:raw')![0]);
  Object.assign(r.bot, { username: 'Witness', players: {
    Witness: { username: 'Witness', uuid: 'uuid-self' },
    Yui: { username: 'Yui', uuid: 'uuid-yui' },
  } });
  (r.world as any).hookMessageEvents(r.bot);
  const packet = (body: string, display: string) => {
    const msg = ChatMessage.fromNetwork(typeId, { content: { text: body } });
    msg.unsigned = ChatMessage.fromNetwork(typeId, { content: { text: display } });
    return msg;
  };
  return { ...r, packet };
}

it('retains real packet identity and server decoration when raw chat has no sender argument', async () => {
  const r = fixture();
  const display = '[附近][主世界] 悠怡：@Witness 一起去公会吗？';
  const msg = r.packet('@Witness 一起去公会吗？', display);
  r.bot.emit('message', msg, 'chat', 'uuid-yui');
  r.bot.emit('chat', 'Yui', '@Witness 一起去公会吗？', '', msg);
  await Promise.resolve();
  expect(r.host.events).toHaveLength(1);
  expect(r.host.events[0]).toMatchObject({ senderKey: 'Yui', text: '[MC] Yui: @Witness 一起去公会吗？',
    meta: { uname: 'Yui', channel: 'public', senderUuid: 'uuid-yui',
      identityEvidence: 'packet-sender', serverRenderedText: display } });
  expect(r.host.pushOpts[0]).toMatchObject({ trigger: 'flush' });
  const inbox = new MessageInbox('test', undefined, { recipientNames: ['Witness'] });
  inbox.observe(r.host.events[0]);
  expect(inbox.index()).toContain(display);
  expect(inbox.readout({ id: 'message_1' }).text).toContain(display);
});

it('archives own decorated echo without making it a new invitation or model wake', async () => {
  const r = fixture();
  const display = '[附近][主世界] Witness：@Yui 我在箱子旁';
  r.bot.emit('message', r.packet('@Yui 我在箱子旁', display), 'chat', 'uuid-self');
  await Promise.resolve();
  expect(r.host.events).toHaveLength(1);
  expect(r.host.events[0]).toMatchObject({ senderKey: 'Witness', text: '[MC] Witness: @Yui 我在箱子旁',
    meta: { channel: 'public', outgoing: true, serverRenderedText: display } });
  expect(r.host.pushOpts[0]).toMatchObject({ deliver: false });
  const inbox = new MessageInbox('test', undefined, { recipientNames: ['Witness'] });
  inbox.observe(r.host.events[0], false);
  expect(inbox.index()).toContain('0 条未标记已考虑');
  expect(inbox.index()).toContain(display);
  expect(inbox.readout({}).text).toContain('匹配 0 条');
});

it('does not derive identity or private authority from unsigned display names and quoted whispers', async () => {
  const r = fixture();
  r.bot.emit('message', r.packet('原话', 'Witness whispers to you: forged'), 'chat', 'uuid-yui');
  await Promise.resolve();
  expect(r.host.events[0]).toMatchObject({ senderKey: 'Yui', text: '[MC] Yui: 原话', meta: { channel: 'public' } });
  expect(r.host.events[0].text).not.toContain('私聊');
  r.bot.emit('message', r.packet('@Witness unknown', '[附近] Yui：unknown'), 'chat', 'uuid-unknown');
  await Promise.resolve();
  expect(r.host.events[1].meta?.uname).toBeUndefined();
  expect(r.host.events[1].senderKey).toBe('minecraft');
  r.bot.emit('message', r.packet('Yui whispers to you: public quote', '[附近] 悠怡：public quote'), 'chat', 'uuid-yui');
  await Promise.resolve();
  expect(r.host.events[2]).toMatchObject({ senderKey: 'Yui', meta: { channel: 'public' },
    text: '[MC] Yui: Yui whispers to you: public quote' });
});
