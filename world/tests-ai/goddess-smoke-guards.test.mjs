import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isGoddessReply, qwenTrace } from '../../tools/smoke_goddess.mjs'

test('welcome, queue, error and the QA own message do not count as a goddess answer', () => {
  assert.ok(isGoddessReply('[女神] QDGoddessProbe，连接成功。', 'Goddess'))
  assert.ok(isGoddessReply('QDGoddessProbe，连接成功', 'Goddess'))
  assert.equal(isGoddessReply('QDGoddessProbe，连接成功', 'AnotherPlayer'), false)
  assert.equal(isGoddessReply('AnotherPlayer，连接成功', 'Goddess'), false)
  assert.equal(isGoddessReply('问：只回复连接成功', 'QDGoddessProbe'), false)
  for (const text of ['[女神] QDGoddessProbe 欢迎，连接成功',
    '[女神] 祈愿已上达连接成功', '[女神] 神谕此刻紊乱，连接成功']) assert.equal(isGoddessReply(text, 'Goddess'), false)
})

test('trace requires this QA session and records the real selected model agent', () => {
  const unrelated = 'builder: built agent for session=mc:AnotherPlayer agent=mc-herald model=x tools=0'
  assert.equal(qwenTrace(unrelated).matchedBuild, false)
  const trace = qwenTrace(unrelated + '\nbuilder: built agent for session=mc:QDGoddessProbe agent=mc-herald model=x tools=0\nSaved session state to /sessions/QDGoddessProbe_mc:QDGoddessProbe.json successfully.')
  assert.equal(trace.matchedBuild, true)
  assert.equal(trace.toolsZero, true)
  assert.equal(trace.savedSession, true)
  assert.deepEqual(trace.agents, ['mc-herald'])
  const publicTrace = qwenTrace('built agent for session=mc:chat:QDGoddessProbe agent=mc-herald model=x tools=0\nSaved session state to /sessions/QDGoddessProbe_mc--chat--QDGoddessProbe.json successfully.')
  assert.deepEqual(publicTrace.sessions, ['mc:chat:QDGoddessProbe'])
  assert.equal(publicTrace.savedSession, true)
  assert.equal(qwenTrace('built agent for session=mc:QDGoddessProbeOther agent=mc-herald tools=0').matchedBuild, false)
})
