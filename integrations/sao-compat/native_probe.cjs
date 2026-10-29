'use strict'
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { createSAOBot } = require('./sao_bot.cjs')
const root = path.resolve(process.argv[2])
const bot = createSAOBot({ root })
const evidence = []
let intentionalExit = false, observedFailure = false
let serial = Promise.resolve()
function record (kind, result) {
  const row = { kind, observedAt: new Date().toISOString(), result }
  evidence.push(row)
  fs.writeFileSync(path.join(root, 'native-probe.json'), JSON.stringify(evidence, null, 2))
  const summary = result && typeof result === 'object'
    ? Object.fromEntries(Object.entries(result).filter(([key]) => ['ok','code','status','self','position','uuid','epoch','operations','name','stateId','properties','message','changed','outcomeKnown','nativeTypeId','id'].includes(key))) : result
  console.log(JSON.stringify({kind,observedAt:row.observedAt,result:summary}))
}
bot.on('error', error => { observedFailure=true;record('error', { name: error.name, message: error.message, stack: error.stack?.slice(0,1600) }) })
bot.on('nativeWindowOpen', info => record('native_window_open', info))
bot.on('forgeState', info => { if(info.kind==='numen_client_absent')record('numen_client_absent',{clientModInstalled:false}) })
bot.on('end', reason => { record('end', reason); process.exit(intentionalExit&&!observedFailure?0:1) })
bot.nativeReady.then(async capabilities => {
  record('ready', { uuid: bot._client.uuid, epoch: capabilities.serverEpoch,
    operations: capabilities.nativeOperations, registry: bot.nativeRegistry, position: bot.entity.position })
  record('snapshot', await bot.native.snapshot())
}).catch(error => {observedFailure=true;record('not_ready', { message: error.message })})
const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
  serial = serial.then(async () => {
    const input = JSON.parse(line)
    await bot.nativeReady
    if (input.op === 'snapshot') return record('snapshot', await bot.native.snapshot())
    if (input.op === 'action_status') return record('action_status', await bot.native.actionStatus(input.requestId,input.originServerEpoch))
    if (input.op === 'block') {
      const { Vec3 } = require('vec3'); const block = bot.blockAt(new Vec3(input.x,input.y,input.z))
      return record('block', block ? { name: block.name, stateId: block.stateId, type: block.type,
        properties: block.getProperties(), shapes: block.shapes, position: block.position } : { status:'unknown_unloaded' })
    }
    if (input.op === 'walk') {
      const before = await bot.native.snapshot()
      await bot.look(input.yaw ?? -Math.PI/2, 0, true)
      bot.setControlState('forward', true)
      try { await bot.waitForTicks(input.ticks ?? 12) } finally { bot.clearControlStates() }
      await bot.waitForTicks(5)
      return record('walk', { before: before.self, after: (await bot.native.snapshot()).self })
    }
    if (input.op === 'open') {
      const { Vec3 } = require('vec3'); const block=bot.blockAt(new Vec3(input.x,input.y,input.z))
      if (!block) return record('open', { status: 'unknown_unloaded' })
      await bot.activateBlock(block)
      await bot.waitForTicks(5)
      return record('open', await bot.native.snapshot())
    }
    if (input.op === 'click') return record('click', await bot.native.click(input))
    if (input.op === 'close') {
      const snapshot=await bot.native.snapshot();const menu=snapshot.menu
      if (!snapshot.ok || !menu) return record('close',snapshot)
      return record('close', await bot.native.call('menu.close', {windowId:menu.windowId,
        expectedStateId:menu.stateId,expectedServerEpoch:menu.serverEpoch}, { requestId: input.requestId }))
    }
    if (input.op === 'quit') { intentionalExit=true;return bot.quit('isolated native acceptance complete') }
    record('rejected', { reason: 'unknown_probe_operation' })
  }).catch(error => record('probe_error', { message: error.message }))
})
