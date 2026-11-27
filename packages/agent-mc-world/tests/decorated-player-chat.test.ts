import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { MessageInbox } from '../src/client/message-inbox.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => rigs.splice(0).forEach(r => r.close()));

function fixture(speakerUuid = 'uuid-yui') {
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
    Yui: { username: 'Yui', uuid: speakerUuid },
  } });
  (r.world as any).hookMessageEvents(r.bot);
  const packet = (body: string, display: string, insertion?: string) => {
    const msg = ChatMessage.fromNetwork(typeId, { content: { text: body } });
    msg.unsigned = ChatMessage.fromNetwork(typeId, { content: { text: display,
      ...(insertion ? { extra: [{ text: '', insertion }] } : {}) } });
    return msg;
  };
  return { ...r, packet };
}

it('delivers signed nearby text with the native speaker sample and exact unadorned body', async () => {
  const uuid = randomUUID();
  const r = fixture(uuid);
  const sample = { uuid, name: 'Yui', displayName: '悠怡', world: 'minecraft:town', worldUuid: randomUUID(),
    observedAt: 1795257813757, position: { x: -10.25, y: 100, z: 1.5 } };
  const body = '@Witness 我在村镇入口';
  const msg = r.packet(body, '[附近][村镇] 悠怡：'+body, 'qiandengji:nearby:'+JSON.stringify(sample));
  r.bot.emit('message', msg, 'chat', uuid);
  r.bot.emit('chat', 'Yui', body, '', msg);
  await Promise.resolve();
  expect(r.host.events).toHaveLength(1);
  expect(r.host.events[0]).toMatchObject({ senderKey: 'Yui', meta: { channel: 'nearby', chatChannel: 'nearby',
    speakerOrigin: sample, senderUuid: uuid, chatBody: body, sourceWorld: 'minecraft:town' } });
  expect(r.host.events[0].text).toContain('仅对应发言时');
  expect(r.host.events[0].text).toContain('2026-11-21T10:43:33.757Z');

  const forged = r.packet(body, '[附近] 悠怡：'+body, 'qiandengji:nearby:'+JSON.stringify({ ...sample, uuid: randomUUID() }));
  r.bot.emit('message', forged, 'chat', uuid);
  await Promise.resolve();
  expect(r.host.events[1]).toMatchObject({ senderKey: 'Yui', text: '[MC] Yui: '+body, meta: { channel: 'public' } });
  expect(r.host.events[1].meta).not.toHaveProperty('speakerOrigin');
});

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
