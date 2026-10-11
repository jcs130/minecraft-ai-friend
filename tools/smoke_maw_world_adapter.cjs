'use strict'
// Finite non-OP real gameplay acceptance; caller supplies a dedicated QA body.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process'), readline = require('node:readline'), crypto = require('node:crypto')
const { connect } = require('../world/src/world-adapter/index.cjs')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function stdio (configFile) {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../world/src/world-adapter/stdio.cjs'), configFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const lines = readline.createInterface({ input: child.stdout }), pending = new Map()
  let readyResolve, readyReject, seq = 0, stderr = ''
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.stderr.on('data', chunk => { stderr += chunk })
  child.once('exit', code => { readyReject(Error('stdio_exit_' + code + ':' + stderr.trim())); for (const p of pending.values()) p.reject(Error('stdio_exited')); pending.clear() })
  lines.on('line', text => {
    const m = JSON.parse(text)
    if (m.event === 'world_adapter_ready') readyResolve(m)
    if (pending.has(m.request_id)) { const p = pending.get(m.request_id); pending.delete(m.request_id); m.ok ? p.resolve(m.result) : p.reject(Error(m.error.code)) }
  })
  const rpc = (method, fields = {}) => new Promise((resolve, reject) => {
    const id = 'probe-' + ++seq
    pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ request_id: id, method, ...fields }) + '\n')
  })
  let timer
  try {
    await Promise.race([ready, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('stdio_ready_timeout')), 40000) })]); clearTimeout(timer)
    const state = await rpc('snapshot'); assert.equal(state.ok, true)
    const viewer = await rpc('viewer'); assert.equal(viewer.readOnly, true)
    await rpc('close') // Keep parent's stdin open: child must still release it.
    await Promise.race([exited, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('stdio_close_timeout')), 10000) })]); clearTimeout(timer)
    assert.equal(child.exitCode, 0); assert.equal(stderr, '')
    return { private_stdio_actual_snapshot: state.ok, private_stdio_close_with_open_parent_pipe: true }
  } finally { clearTimeout(timer); child.stdin.end(); lines.close(); if (child.exitCode === null) child.kill('SIGTERM') }
}
async function run (configFile, output, reconcile = false) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')), checks = {}, report = { provider: config.provider, checks, modelRequests: 0, op: false, ok: false }
  let adapter
  const savedFile = output + '.actions.json'
  const reportFile = reconcile ? output.replace(/\.json$/, '-reconnect.json') : output
  try {
    adapter = await connect(config)
    const identity = await adapter.identity(), state = await adapter.snapshot()
    const expected = config.bodyId || config.expectedUuid
    assert.equal(identity.bodyId, expected); assert.equal(state.bodyId, expected); assert.equal(state.ok, true)
    assert.equal(state.inventory.slotNamespace, 'player_menu_46'); assert.equal(state.inventory.available, true)
    checks.same_body_actual_snapshot = true
    const catalog = adapter.operations()
    assert.ok((await adapter.operations('curios.open')).parameters); assert.equal((await adapter.operations('body.move')).common, true)
    checks.actual_operation_schemas = true
    checks.actual_inventory_components = state.inventory.items.every(item => typeof item.snbt === 'string' && item.snbt.length > 0)
    let actions
    if (!reconcile) {
      const claimed = await adapter.claimControl(); assert.equal(claimed.ok, true)
      checks.explicit_control = true
      const target = { x: Math.floor(state.position.x) + 1, y: Math.floor(state.position.y), z: Math.floor(state.position.z) }
      actions = [{ action_id: 'unified-walk-' + crypto.randomUUID(), operation: 'body.move', args: { position: target } }]
      const accepted = await adapter.submit(actions[0]); assert.equal(accepted.ok, true, JSON.stringify(accepted))
      const done = await adapter.wait(actions[0].action_id, { timeoutMs: 45000 }); assert.equal(done.status, 'succeeded', JSON.stringify(done))
      const terminalPosition = done.actualPosition || done.result?.actualPosition
      assert.equal(Math.floor(terminalPosition.x), target.x); assert.equal(Math.floor(terminalPosition.y), target.y); assert.equal(Math.floor(terminalPosition.z), target.z)
      const after = await adapter.snapshot()
      // Physics/entity collisions may move the player after the task finishes.
      // Keep both timestamps/positions rather than replacing the terminal proof.
      report.movement={target,terminalPosition,nextObservation:after.position,observedAt:after.capturedAt}
      assert.ok(Math.hypot(after.position.x-terminalPosition.x,after.position.y-terminalPosition.y,after.position.z-terminalPosition.z)<1.5)
      checks.absolute_walk_actual_endpoint = true
      checks.actual_terminal_position = !!done.actualPosition || !!done.result?.actualPosition
      // Actual client physics and native fake-player inputs must both move the
      // owned body, and release their keys without a second control channel.
      const perform = async (operation,args) => {
        const action = { action_id: 'control-' + crypto.randomUUID(), operation, args }
        assert.equal((await adapter.submit(action)).accepted,true)
        const end = await adapter.wait(action.action_id,{ timeoutMs: 30000 })
        assert.equal(end.status,'succeeded',JSON.stringify(end));actions.push(action);return end
      }
      const look = await perform('body.look',{yaw:90,pitch:0})
      const aim = await adapter.read('body.controls',{})
      assert.ok(Math.abs(aim.yaw-90)<1&&Math.abs(aim.pitch)<1,JSON.stringify(aim));checks.native_degree_aim=true
      const inputBefore=(await adapter.snapshot()).position
      const moved=await perform('body.input',{keys:['forward'],durationMs:500})
      const movedPos=moved.actualPosition||moved.result?.actualPosition
      assert.ok(Math.hypot(movedPos.x-inputBefore.x,movedPos.z-inputBefore.z)>.3,JSON.stringify({inputBefore,movedPos,moved}));checks.raw_input_actual_movement=true
      await new Promise(resolve=>setTimeout(resolve,400));const settled=(await adapter.snapshot()).position
      await new Promise(resolve=>setTimeout(resolve,400));const still=(await adapter.snapshot()).position
      assert.ok(Math.hypot(still.x-settled.x,still.z-settled.z)<.25,JSON.stringify({settled,still}));checks.raw_input_automatically_released=true
      const cancel={action_id:'control-cancel-'+crypto.randomUUID(),operation:'body.input',args:{keys:['back'],durationMs:10000}}
      assert.equal((await adapter.submit(cancel)).accepted,true);await new Promise(resolve=>setTimeout(resolve,350))
      await adapter.cancel(cancel.action_id);const cancelled=await adapter.wait(cancel.action_id,{timeoutMs:10000})
      assert.equal(cancelled.status,'cancelled',JSON.stringify(cancelled));assert.equal(cancelled.outcomeKnown,true);checks.raw_input_cancel_known_partial_result=true
      const cancelledReplay=await adapter.submit(cancel);assert.equal(cancelledReplay.replayed,true);assert.equal(cancelledReplay.dispatched,false);checks.raw_input_cancel_never_replays=true
      await new Promise(resolve=>setTimeout(resolve,350));const ground=(await adapter.snapshot()).position
      const jumped=await perform('body.input',{keys:['jump'],durationMs:200})
      assert.ok((jumped.actualPosition||jumped.result.actualPosition).y>ground.y+.1,JSON.stringify({ground,jumped}));checks.native_jump_actual_height=true
      await new Promise(resolve=>setTimeout(resolve,900))
      const emptyMenu=(await adapter.snapshot()).menu
      const emptyHotbar=Array.from({length:9},(_,i)=>i).find(i=>!emptyMenu.slots[36+i])
      assert.notEqual(emptyHotbar,undefined)
      await perform('inventory.selectHotbar',{hotbarSlot:emptyHotbar,expectedSnbt:''});checks.native_hotbar_selection=true
      await perform('body.look',{yaw:90,pitch:85})
      const targetBlock=await adapter.read('body.target',{});assert.equal(targetBlock.type,'block',JSON.stringify(targetBlock))
      const mined=await perform('body.mouse',{button:'left',hand:'main',expectedHotbarSlot:emptyHotbar,expectedHeldSnbt:'',expectedTargetToken:targetBlock.targetToken,durationMs:5000})
      assert.equal(mined.result.actualBlockId,'minecraft:air',JSON.stringify(mined));checks.native_mouse_mining_actual_block=true
      report.mouseMining={target:targetBlock,result:mined.result}
      await new Promise(resolve=>setTimeout(resolve,900))
      if(config.qaInventoryFixtureFile)fs.writeFileSync(config.qaInventoryFixtureFile,'ready')
      let dirtMenu
      for(let n=0;n<30;n++){
        dirtMenu=(await adapter.snapshot()).menu
        if(dirtMenu.slots.some(item=>item?.id==='minecraft:dirt'))break
        await new Promise(resolve=>setTimeout(resolve,150))
      }
      const dirtSlot=dirtMenu.slots.findIndex((item,i)=>i>=9&&i<=44&&item?.id==='minecraft:dirt')
      assert.ok(dirtSlot>=9,'mined dirt must really be in inventory')
      const shift=await perform('menu.nativeClick',{windowId:0,expectedStateId:dirtMenu.stateId,expectedControlHash:dirtMenu.controlHash,slot:dirtSlot,button:0,clickType:'QUICK_MOVE'})
      const shifted=(await adapter.snapshot()).menu
      assert.equal(shifted.slots[dirtSlot],null);assert.ok(shift.result.inventoryDelta.available);checks.native_shift_click_real_inventory=true
      const newDirt=shifted.slots.findIndex((item,i)=>i>=9&&i<=44&&item?.id==='minecraft:dirt')
      const swap=await perform('menu.nativeClick',{windowId:0,expectedStateId:shifted.stateId,expectedControlHash:shifted.controlHash,slot:newDirt,button:7,clickType:'SWAP'})
      const swapped=(await adapter.snapshot()).menu;assert.equal(swapped.slots[43].id,'minecraft:dirt');checks.native_number_key_swap_real_inventory=true
      await perform('inventory.selectHotbar',{hotbarSlot:7,expectedSnbt:swapped.slots[43].snbt})
      const beforeHands=(await adapter.snapshot()).menu
      await perform('inventory.swapHands',{expectedHotbarSlot:7,expectedMainSnbt:beforeHands.slots[43]?.snbt||'',expectedOffSnbt:beforeHands.slots[45]?.snbt||''})
      const hands=(await adapter.snapshot()).menu;assert.equal(hands.slots[45].id,'minecraft:dirt');checks.native_main_offhand_swap=true
      await perform('inventory.swapHands',{expectedHotbarSlot:7,expectedMainSnbt:hands.slots[43]?.snbt||'',expectedOffSnbt:hands.slots[45]?.snbt||''})
      if(config.qaInventoryFixtureFile){
        const bowMenu=(await adapter.snapshot()).menu,bowSlot=bowMenu.slots.findIndex(item=>item?.id==='minecraft:bow')
        assert.ok(bowSlot>=9)
        await perform('menu.nativeClick',{windowId:0,expectedStateId:bowMenu.stateId,expectedControlHash:bowMenu.controlHash,slot:bowSlot,button:6,clickType:'SWAP'})
        const equipped=(await adapter.snapshot()).menu
        await perform('inventory.selectHotbar',{hotbarSlot:6,expectedSnbt:equipped.slots[42].snbt})
        await perform('body.look',{yaw:0,pitch:-45})
        const readyBow=(await adapter.snapshot()).menu
        const arrowsBefore=readyBow.slots.reduce((n,item)=>n+(item?.id==='minecraft:arrow'?item.count:0),0)
        const shot=await perform('inventory.useHeld',{hand:'main',expectedHotbarSlot:6,expectedHeldSnbt:readyBow.slots[42].snbt,durationMs:1200})
        const afterShot=(await adapter.snapshot()).menu
        assert.equal(afterShot.slots.reduce((n,item)=>n+(item?.id==='minecraft:arrow'?item.count:0),0),arrowsBefore-1,JSON.stringify(shot));checks.native_long_use_consumes_exactly_one_arrow=true
        report.bowUse={before:arrowsBefore,result:shot.result}
      }
      const stateMenu=(await adapter.snapshot()).menu
      assert.match(stateMenu.controlHash,/^[a-f0-9]{64}$/);checks.complete_menu_component_cas_available=true
      const invalid={action_id:'control-stale-'+crypto.randomUUID(),operation:'menu.nativeClick',args:{windowId:0,expectedStateId:stateMenu.stateId,expectedControlHash:'0'.repeat(64),slot:9,button:0,clickType:'PICKUP'}}
      assert.equal((await adapter.submit(invalid)).accepted,true);const denied=await adapter.wait(invalid.action_id,{timeoutMs:10000})
      assert.equal(denied.status,'failed',JSON.stringify(denied));assert.equal(denied.outcomeKnown,true);checks.stale_full_menu_cas_rejected=true
      const open = { action_id: 'unified-curios-' + crypto.randomUUID(), operation: 'curios.open', args: {} }
      actions.push(open); assert.equal((await adapter.submit(open)).ok, true)
      const opened = await adapter.wait(open.action_id, { timeoutMs: 30000 }); assert.equal(opened.status, 'succeeded', JSON.stringify(opened))
      const openedState = await adapter.snapshot(); assert.equal(openedState.ok, true, JSON.stringify(openedState))
      const menu = openedState.menu; assert.ok(menu, JSON.stringify(openedState)); assert.notEqual(menu.windowId, 0)
      checks.native_mod_menu_real_open = true
      const close = { action_id: 'unified-close-' + crypto.randomUUID(), operation: 'menu.close', args: config.provider === 'numen' ? { windowId: menu.windowId, expectedStateId: menu.stateId } : {} }
      actions.push(close); assert.equal((await adapter.submit(close)).ok, true)
      assert.equal((await adapter.wait(close.action_id, { timeoutMs: 30000 })).status, 'succeeded')
      assert.equal((await adapter.snapshot()).menu.windowId, 0); checks.native_menu_real_close = true
      fs.writeFileSync(savedFile, JSON.stringify({ bodyId: expected, actions }))
    } else {
      const prior = JSON.parse(fs.readFileSync(savedFile, 'utf8')); assert.equal(prior.bodyId, expected); actions = prior.actions
      checks.reconnected_original_uuid = true
    }
    const ledgerFile = path.join(config.ledgerDir, ...(config.provider === 'numen' ? ['numen'] : []), identity.account.toLowerCase(), 'native-actions.jsonl')
    const beforeHash = hash(ledgerFile)
    for (const action of actions) {
      const result = await adapter.actionStatus(action.action_id); assert.equal(result.status, 'succeeded', JSON.stringify(result))
      const replay = await adapter.submit(action); assert.equal(replay.replayed, true); assert.equal(replay.dispatched, false)
    }
    checks.original_ids_reconciled_without_redispatch = hash(ledgerFile) === beforeHash
    if (config.provider === 'numen' && !reconcile) assert.equal((await adapter.releaseControl()).ok, true)
    assert.equal((await adapter.close()).ok, true); adapter = null
    checks.clean_connection_close = true
    Object.assign(checks, await stdio(configFile))
    report.ok = Object.values(checks).every(Boolean)
  } catch (error) { report.error = error.message; throw error }
  finally { if (adapter) await adapter.close(); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)) }
  return report
}
if (require.main === module) run(process.argv[2], process.argv[3], process.argv[4] === '--reconcile').then(report => {
  process.stdout.write(JSON.stringify({ ok: report.ok, provider: report.provider, checks: Object.keys(report.checks).length }) + '\n')
}).catch(() => { process.stderr.write('World adapter smoke failed; inspect private report.\n'); process.exitCode = 1 })
module.exports = { run }
