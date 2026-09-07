import test from 'node:test'
import assert from 'node:assert/strict'
import { createChantingStaffClient } from '../src/chanting-staff-client.ts'
import { createSpokenCommands } from '../src/application/spoken-commands.ts'

const actor = 'MengMeng', recordedAt = 1788000000000
const ok = { schema: 1, ok: true, code: 'claimed', actor,
  actorUuid: '11111111-2222-3333-8444-555555555555', gestureId: 'gesture-1', summary: '咏唱已接纳。' }
test('the custom staff gate sends the original recording time and keeps the exact server receipt', async () => {
  const calls = []; const client = createChantingStaffClient({ send: async command => { calls.push(command); return 'QD_CHANT_JSON '+JSON.stringify(ok) } })
  assert.deepEqual(await client.claim(actor,recordedAt,recordedAt+500),ok)
  assert.deepEqual(calls,[`qdchant claim ${actor} ${recordedAt} ${recordedAt+500} 0`])
})
test('gate rejects ambiguous, mismatched and missing envelopes without a retry', async () => {
  for (const raw of ['Unknown command', 'QD_CHANT_JSON invalid',
    'QD_CHANT_JSON '+JSON.stringify({...ok,actor:'DifferentPlayer'}),
    'QD_CHANT_JSON '+JSON.stringify({...ok,schema:2}),
    'QD_CHANT_JSON '+JSON.stringify(ok)+'\nQD_CHANT_JSON '+JSON.stringify(ok)]) {
    let calls=0; const client=createChantingStaffClient({send:async()=>{calls++;return raw}})
    assert.equal((await client.claim(actor,recordedAt,recordedAt+500)).ok,false); assert.equal(calls,1)
  }
})
test('invalid actor or missing original timestamp never reaches the server',async()=>{
  const client=createChantingStaffClient({send:async()=>assert.fail('Unexpected RCON')})
  for(const [who,time] of [['@a',recordedAt],[actor,undefined],[actor,NaN],[actor,1.5]])
    assert.equal((await client.claim(who,time,time)).code,'invalid_voice_context')
})
function fixture(gate) {
  const calls=[]
  return { calls, ...createSpokenCommands({
    atoms:()=>[], prepareCast:async(who,at)=>{calls.push(['claim',who,at]); return gate},
    execute:async request=>{calls.push(['execute',request]);return {ok:true,code:'casting_started'}},
    feedback:()=>{},conversation:async()=>{},
  }) }
}
test('failed or consumed staff gesture prevents cast, and does not fall back to native execution',async()=>{
  const f=fixture({ok:false,code:'gesture_consumed',summary:'这一段咏唱已使用。'})
  const r=await f.execute(actor,'女神，火焰弹',{recordedAt,recordingEndedAt:recordedAt+500})
  assert.equal(r.code,'gesture_consumed');assert.deepEqual(f.calls,[['claim',actor,recordedAt]])
})
test('claimed staff gesture or direct voice still uses the same existing player cast',async()=>{
  for(const code of ['claimed','direct_voice']) {
    const f=fixture({ok:true,code}); const r=await f.execute(actor,'女神，火焰弹',{recordedAt,recordingEndedAt:recordedAt+500})
    assert.deepEqual(f.calls,[['claim',actor,recordedAt],['execute',{actor,command:'cast "irons_spellbooks:firebolt"'}]])
    assert.equal(r.code,'casting_started')
  }
})

test('HUD sync encodes exact eight slots and correlates the recipient; it cannot execute a cast', async () => {
  const slots = Array.from({length:8},(_,i)=>({slot:i+1,id:i===7?'fireworks':'',name:i===7?'烟花术':'',icon:'minecraft:paper',chant:i===7?'咏唱烟花术':''}))
  const calls=[]
  const client=createChantingStaffClient({send:async command=>{calls.push(command);return 'QD_CHANT_JSON '+JSON.stringify({...ok,code:'bar_synced'})}})
  assert.equal((await client.syncBar(actor,slots)).code,'bar_synced')
  assert.equal(calls.length,1)
  const prefix=`qdchant bar ${actor} `
  assert.ok(calls[0].startsWith(prefix))
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].slice(prefix.length),'base64url').toString('utf8')),slots)
  assert.equal((await client.syncBar('@a',slots)).code,'invalid_bar');assert.equal(calls.length,1)
  const mismatch=createChantingStaffClient({send:async()=> 'QD_CHANT_JSON '+JSON.stringify({...ok,actor:'Other'})})
  assert.equal((await mismatch.syncBar(actor,slots)).ok,false)
})
test('opening a menu is not charged a staff casting gesture',async()=>{
  const f=fixture({ok:false,code:'gesture_consumed'});await f.execute(actor,'打开技能罗盘',{recordedAt,recordingEndedAt:recordedAt+500})
  assert.deepEqual(f.calls,[['execute',{actor,command:'menu'}]])
})

test('early ASR waits only for an explicit pending gesture, then claims once on release', async t => {
  t.mock.method(Date,'now',()=>recordedAt+1000)
  const calls=[]
  const client=createChantingStaffClient({send:async command=>{calls.push(command);return 'QD_CHANT_JSON '+JSON.stringify(calls.length===1?{...ok,ok:false,code:'gesture_pending'}:ok)}})
  assert.equal((await client.claimVoice(actor,recordedAt,recordedAt+500)).code,'claimed')
  assert.equal(calls.length,2);assert.equal(calls[0],calls[1])
  let unknown=0
  const failed=createChantingStaffClient({send:async()=>{unknown++;throw new Error('Lost reply')}})
  assert.equal((await failed.claimVoice(actor,recordedAt,recordedAt+500)).ok,false);assert.equal(unknown,1)
})
