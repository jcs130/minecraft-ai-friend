import assert from 'node:assert/strict';
import test from 'node:test';
import { giftAck, giftCommand, parseCreationDecision } from './goddess-creation.mjs';

test('Goddess can approve a bounded vanilla item request', () => {
  const decision = parseCreationDecision('{"decision":"approve","item":"minecraft:cherry_sapling","amount":2,"message":"给你两棵树苗"}');
  assert.equal(giftCommand('0123456789abcdef', '.BedrockGuest', decision),
    '/mycli admin gift 0123456789abcdef .BedrockGuest minecraft:cherry_sapling 2');
  assert.deepEqual(giftAck('QDJ-GIFT 0123456789abcdef OK', '0123456789abcdef'), { ok: true, reason: '' });
});

test('declines return text without a gift command', () => {
  const decision = parseCreationDecision('{"decision":"decline","message":"今天先去村里找找吧。"}');
  assert.equal(decision.message, '今天先去村里找找吧。');
  assert.throws(() => giftCommand('0123456789abcdef', 'Afu', decision));
});

test('approval cannot silently issue a blank enchanted book', () => {
  const decision = parseCreationDecision('{"decision":"approve","item":"minecraft:enchanted_book","amount":1,"message":"修补书已送达","enchantments":{"mending":1}}');
  assert.equal(decision.decision, 'decline');
  assert.match(decision.message, /需要先确认附魔种类/);
  assert.throws(() => giftCommand('0123456789abcdef', 'Afu', decision));
  assert.throws(() => giftCommand('0123456789abcdef', 'Afu',
    { decision: 'approve', item: 'minecraft:enchanted_book', amount: 1 }));
});

test('untrusted names, commands, quantities and prose cannot become gifts', () => {
  for (const response of [
    '{"decision":"approve","item":"minecraft:stone;op Steve","amount":1}',
    '{"decision":"approve","item":"minecraft:stone","amount":64}',
    '{"decision":"approve","item":"minecraft:stone","amount":"1"}',
    '当然可以，已经给你了',
  ]) assert.throws(() => parseCreationDecision(response));
  const approved = parseCreationDecision('{"decision":"approve","item":"minecraft:stone","amount":1}');
  assert.throws(() => giftCommand('0123456789abcdef', 'Afu /op', approved));
  assert.deepEqual(giftAck('QDJ-GIFT 0123456789abcdef FAIL inventory', '0123456789abcdef'),
    { ok: false, reason: 'inventory' });
});
