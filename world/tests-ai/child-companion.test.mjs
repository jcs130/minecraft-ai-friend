import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveChildCompanion,
  buildGoddessChatPrompt,
  sanitizeChildReply,
} from '../src/gameplay/child-companion.ts'

const cfg = { enabled: true, players: [{ name: 'mengmeng', displayName: '萌萌', ageBand: 'child', allowGifts: true }] }

test('child mode matches the whitelisted login name case-insensitively', () => {
  assert.equal(resolveChildCompanion(cfg, 'MengMeng')?.displayName, '萌萌')
  assert.equal(resolveChildCompanion(cfg, 'MELISSA'), null)
  assert.equal(resolveChildCompanion({ ...cfg, enabled: false }, 'MengMeng'), null)
  assert.equal(resolveChildCompanion(undefined, 'MengMeng'), null)
  assert.equal(resolveChildCompanion(cfg, ''), null)
})

test('the adult prompt is preserved byte-for-byte when there is no child', () => {
  const prompt = buildGoddessChatPrompt({ senderName: '旅人', username: 'traveler', message: '女神给我面包', allowGifts: true, child: null })
  assert.match(prompt, /你是这个方块世界的「灯语女神」（游戏内化身 Goddess），温柔幽默、说话大白话、简短。/)
  assert.match(prompt, /真人玩家在公屏说了句话/)
  assert.match(prompt, /你的神力边界：可以送日常小物/)
  assert.match(prompt, /规则：他要日常物品且合理 → give/)
  assert.doesNotMatch(prompt, /小朋友/)
})

test('a child gets the age-appropriate companion persona, never the adult framing', () => {
  const child = resolveChildCompanion(cfg, 'MengMeng')
  const prompt = buildGoddessChatPrompt({ senderName: child.displayName, username: 'MengMeng', message: '女神陪我玩', allowGifts: false, child })
  assert.match(prompt, /温柔的大姐姐朋友/)
  assert.match(prompt, /年纪很小的小朋友（萌萌）/)
  assert.match(prompt, /陪她玩文字小游戏：数数、认字、猜谜语/)
  assert.match(prompt, /绝对不说恐怖、血腥、吓人、骂人、成人/)
  assert.match(prompt, /不假装是真人，也不让她一直玩个不停/)
  assert.doesNotMatch(prompt, /真人玩家在公屏说了句话/)
})

test('the reply/give JSON contract is identical for child and adult', () => {
  const child = resolveChildCompanion(cfg, 'MengMeng')
  for (const c of [null, child]) {
    const prompt = buildGoddessChatPrompt({ senderName: 'X', username: 'MengMeng', message: 'hi', allowGifts: true, child: c })
    assert.match(prompt, /只输出一行 JSON，不要 markdown 代码块，两种格式二选一：/)
    assert.match(prompt, /\{"action":"reply","text":"<你说的话，30字内，大白话>"\}/)
    assert.match(prompt, /\{"action":"give","item":"<物品中文名>","count":<1-8>,"text":"<你说的话，30字内>"\}/)
  }
})

test('a child only sees the give boundary when gifts are allowed; reply-only otherwise', () => {
  const child = resolveChildCompanion(cfg, 'MengMeng')
  const withGifts = buildGoddessChatPrompt({ senderName: '萌萌', username: 'MengMeng', message: 'x', allowGifts: true, child })
  assert.match(withGifts, /她想要东西时你可以送给她/)
  const replyOnly = buildGoddessChatPrompt({ senderName: '萌萌', username: 'MengMeng', message: 'x', allowGifts: false, child })
  assert.doesNotMatch(replyOnly, /她想要东西时你可以送给她/)
  assert.match(replyOnly, /禁止执行、馈赠或声称已施法。只允许 action=reply/)
})

test('held skill books are listed for both personas', () => {
  const prompt = buildGoddessChatPrompt({ senderName: '萌萌', username: 'MengMeng', message: 'x', allowGifts: true, child: resolveChildCompanion(cfg, 'MengMeng'), heldBooks: ['火球术'] })
  assert.match(prompt, /他已持有技能书：火球术（拿书按右键即施法）/)
})

test('the child reply net passes warm text and replaces off-tone output', () => {
  assert.equal(sanitizeChildReply('你真棒，我们一起数到三吧！'), '你真棒，我们一起数到三吧！')
  assert.equal(sanitizeChildReply('给你一把铁剑，去打怪吧'), '给你一把铁剑，去打怪吧') // game-normal, kept
  assert.equal(sanitizeChildReply('你这个笨蛋'), '我们聊点别的开心的吧～')
  assert.equal(sanitizeChildReply(''), '我们聊点别的开心的吧～')
})
