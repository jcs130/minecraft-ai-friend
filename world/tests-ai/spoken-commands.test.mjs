import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpokenCommands, spokenFeedback } from '../src/application/spoken-commands.ts'
import { parseCli } from '../src/gameplay/commands/player-cli.ts'

function fixture(result = { ok: true, code: 'ok', summary: '烟花绽放。', skillId: 'fireworks' }) {
  const calls = [], replies = [], chats = []
  const service = createSpokenCommands({
    atoms: () => [{ id: 'fireworks', name: '烟花术', words: ['烟花术'], type: 'active', catalog: { status: 'featured' } }],
    execute: async request => { calls.push(request); if (result instanceof Error) throw result; return result },
    feedback: (actor, text) => replies.push({ actor, text }),
    conversation: async (actor, text) => chats.push({ actor, text }),
  })
  return { ...service, calls, replies, chats }
}
test('speech executes the same player request with actor identity, without conversation/model', async () => {
  const f = fixture(); const result = await f.execute('MengMeng', '女神，咏唱烟花术！')
  assert.deepEqual(f.calls, [{ actor: 'MengMeng', command: 'cast "fireworks"' }])
  assert.equal(result.skillId, 'fireworks'); assert.equal(result.verb, 'cast'); assert.equal(result.ok, true)
  assert.equal(f.chats.length, 0); assert.deepEqual(f.replies, [{ actor: 'MengMeng', text: '烟花绽放。' }])
})
test('native speech preserves an actual failure instead of falling back or retrying', async () => {
  const f = fixture({ ok: false, code: 'spell_not_equipped', summary: '还没装备这道法术。' })
  const result = await f.execute('MengMeng', '女神，火焰弹')
  assert.equal(f.calls[0].command, 'cast "irons_spellbooks:firebolt"')
  assert.equal(result.code, 'spell_not_equipped'); assert.equal(f.calls.length, 1); assert.equal(f.chats.length, 0)
})
test('uncertain execution is never retried or reported as completed', async () => {
  const f = fixture(new Error('connection lost')); const r = await f.execute('MengMeng', '烟花术')
  assert.equal(r.code, 'outcome_unknown'); assert.equal(r.ok, false); assert.equal(f.calls.length, 1)
  assert.match(f.replies[0].text, /查看游戏里的效果/)
  assert.equal(spokenFeedback('cast', { ok: true, code: 'casting_started', summary: '成功命中' }), '开始咏唱。')
})
test('questions, negation and quoted commands go only to reply-only conversation', async () => {
  const f = fixture()
  for (const text of ['女神，不要施法烟花术', '女神，火焰弹是什么', '他说“咏唱烟花术”']) await f.execute('MengMeng', text)
  assert.equal(f.calls.length, 0); assert.equal(f.chats.length, 3); assert.equal(f.replies.length, 0)
})
test('unknown explicit chant receives feedback without a model or guessed action', async () => {
  const f = fixture(); const result = await f.execute('MengMeng', '乾坤借法，未知法术')
  assert.equal(result.code, 'unknown_chant'); assert.equal(f.calls.length, 0); assert.equal(f.chats.length, 0)
  assert.equal(f.replies.length, 1)
})
test('observed ASR homophone is corrected only inside an explicit chant', async () => {
  const f = fixture(); await f.execute('MengMeng', '咏唱烟花树')
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, 'cast "fireworks"')
  await f.execute('MengMeng', '永唱烟花树')
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].command, 'cast "fireworks"')
  await f.execute('MengMeng', '烟花树'); await f.execute('MengMeng', '女神，不要咏唱烟花树')
  await f.execute('MengMeng', '女神，不要永唱烟花树')
  assert.equal(f.calls.length, 2); assert.equal(f.chats.length, 3)
})
test('the captured 用唱烟花束 sample reaches one authorized request and never a model fallback', async () => {
  const f=fixture({ok:false,code:'skill_not_learned',summary:'尚未学会。'})
  const result=await f.execute('QDGuildProbe','用唱烟花束')
  assert.deepEqual(f.calls,[{actor:'QDGuildProbe',command:'cast "fireworks"'}])
  assert.equal(result.ok,false);assert.equal(result.code,'skill_not_learned');assert.equal(f.chats.length,0)
  for(const text of ['不要用唱烟花束','用唱烟花束是什么意思','烟花束']) await f.execute('QDGuildProbe',text)
  assert.equal(f.calls.length,1);assert.equal(f.chats.length,3)
})
test('spoken waypoint names survive CLI quoting as one full argument', async () => {
  const f = fixture(); await f.execute('MengMeng', '传送到 Home Base')
  const parsed = parseCli(`/mycli ${f.calls[0].command}`)
  assert.equal(parsed.verb, 'goto'); assert.deepEqual(parsed.args, ['Home Base'])
})
test('a player can assign a known quick skill by speech through the existing skillbar validation', async () => {
  const f=fixture({ok:true,skillbar:[{slot:1,name:'烟花术'}]})
  await f.execute('MengMeng','快捷技能设为烟花术')
  assert.equal(f.calls[0].command,'skillbar "set" "1" "fireworks"')
  assert.match(f.replies[0].text,/快捷槽一是烟花术/)
})
test('status feedback reads actual native level/mana and never reads the machine JSON', () => {
  assert.equal(spokenFeedback('status', { ok: true, native: { ok: true, level: 4, mana: 20, maxMana: 100 } }), '你现在4级，铁魔法法力20，上限100。')
})
