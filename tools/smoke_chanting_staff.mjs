/** Real client use/release packets against the independent chanting-items mod.
 * Operator installs the mod, waits for healthy services, backs up the existing
 * QDGuildProbe playerdata/advancements/stats, and restores them after logout.
 * No service startup, model call, Iron spell, damage, or new Numen body.
 * Run: node tools/smoke_chanting_staff.mjs --execute qiandengji
 */
import { readFile, writeFile, readdir, mkdir, open, unlink } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'

export const QA = 'QDGuildProbe'
export const ITEMS = ['qiandeng_chanting:whispering_staff', 'qiandeng_chanting:resonance_staff']
export const REQUIRED = ['staff:registered-items-and-recipes', 'staff:direct-voice-without-staff',
  'staff:holding-needs-gesture', 'staff:whispering-gesture-single-claim', 'staff:resonance-gesture-single-claim',
  'staff:release-grace-claim', 'staff:expired-release-rejected', 'staff:hand-swap-rejected', 'staff:same-item-replacement-rejected',
  'staff:mode-payload-and-late-voice', 'staff:audio-boundary-handshake']
const DATA = '/app/data', PREFIX = 'QD_CHANT_JSON '
const assert = (value, message) => { if (!value) throw new Error(message) }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const sha = value => createHash('sha256').update(value).digest('hex')
const exec = promisify(execCallback)

export function receipt(raw, actorUuid = null, health = false) {
  assert(typeof raw === 'string' && raw.length <= 65536, 'Invalid chanting receipt size/type')
  const lines = raw.split(/\r?\n/).filter(line => line.startsWith(PREFIX))
  assert(lines.length === 1, 'Missing or ambiguous QD_CHANT_JSON envelope')
  let value
  try { value = JSON.parse(lines[0].slice(PREFIX.length)) } catch { throw new Error('Invalid chanting JSON') }
  assert(value?.schema === 1 && typeof value.ok === 'boolean' && typeof value.code === 'string', 'Chanting envelope schema mismatch')
  if (health) {
    assert(value.ok === true && value.code === 'ready' && Array.isArray(value.items) && ITEMS.every(id => value.items.includes(id)),
      'The newly installed independent chanting mod is not ready')
  } else assert(value.actor === QA && value.actorUuid === actorUuid && typeof value.holding === 'boolean' &&
    typeof value.using === 'boolean', 'Chanting receipt actor/UUID/state mismatch')
  return value
}
export function expectCode(value, ok, code) {
  assert(value.ok === ok && value.code === code, `Expected ${code}, received ${String(value.code)}`)
  return value
}
export function gestureEvidence(value, itemId) {
  const gesture = value?.gesture
  assert(value.ok === true && value.holding === true && value.using === true &&
    typeof value.gestureId === 'string' && value.gestureId.length > 0 && gesture?.itemId === itemId &&
    gesture.hand === 'mainhand' && gesture.active === true && gesture.claimed === false && gesture.slot === 0 &&
    Number.isSafeInteger(gesture.startedAt) && gesture.startedAt > 0 && gesture.releasedAt === null,
  'Server did not confirm an active, fresh main-hand staff gesture')
  return { gestureId: value.gestureId, startedAt: gesture.startedAt, itemId, hand: gesture.hand }
}
export function allowedCommand(command) {
  const fixed = ['list', 'numen_act list', 'qdchant health', `qdchant status ${QA}`,
    `data get entity ${QA} SelectedItem.id`]
  const replacements = [...ITEMS, 'minecraft:air'].map(id => `item replace entity ${QA} weapon.mainhand with ${id} 1`)
  assert(fixed.includes(command) || replacements.includes(command) ||
    new RegExp(`^qdchant claim ${QA} [1-9][0-9]{0,15} [1-9][0-9]{0,15} [0-8]$`).test(command), 'Staff smoke command is outside the reserved-QA allowlist')
  return command
}
export function modePayload(slot) {
  assert(Number.isInteger(slot) && slot >= 0 && slot <= 8, 'Invalid staff mode slot')
  // StaffModePayload.CODEC is one VarInt. Its complete valid range fits one byte.
  return { channel: 'qiandeng_chanting:mode', data: Buffer.from([slot]) }
}
/** Standalone wire fixture; its floor is synthetic, never evidence of SVC capture. */
export const AUDIO_BOUNDARY = 'qiandeng_chanting:audio_boundary_v1'
export const AUDIO_STATE = 'qiandeng_chanting:audio_state_v1'
export function audioRegisterPayload() {
  // NeoForge 21.1.248 NetworkRegistry.onMinecraftRegister adds these ad-hoc
  // channels; hasChannel checks that same set. Dinnerbone codec uses NUL bytes.
  return { channel: 'minecraft:register', data: Buffer.from(AUDIO_STATE + '\0' + AUDIO_BOUNDARY + '\0', 'ascii') }
}
function signedVar(value, bits) {
  let number = BigInt(value)
  const min = -(1n << BigInt(bits - 1)), max = (1n << BigInt(bits - 1)) - 1n
  assert(number >= min && number <= max, 'Audio integer outside signed wire range')
  number = BigInt.asUintN(bits, number)
  const bytes = []
  do { let byte = Number(number & 127n); number >>= 7n; if (number) byte |= 128; bytes.push(byte) } while (number)
  return Buffer.from(bytes)
}
function wireFields(gestureId, revision, floor) {
  assert(typeof gestureId === 'string' && gestureId.length > 0 && gestureId.length <= 96 &&
    Buffer.byteLength(gestureId, 'utf8') <= 384, 'Invalid audio gesture nonce')
  assert(Number.isInteger(revision) && revision >= 0 && revision <= 2147483647, 'Invalid audio revision')
  if (typeof floor === 'number') assert(Number.isSafeInteger(floor), 'Unsafe numeric audio floor')
  const sequence = BigInt(floor)
  assert(sequence >= -1n && sequence < 9223372036854775807n, 'Invalid audio boundary floor')
  const text = Buffer.from(gestureId, 'utf8')
  return Buffer.concat([signedVar(text.length, 32), text, signedVar(revision, 32), signedVar(sequence, 64)])
}
export function audioBoundaryPayload(gestureId, revision, floor = -1n) {
  return { channel: AUDIO_BOUNDARY, data: wireFields(gestureId, revision, floor) }
}
export function decodeAudioState(packet) {
  assert(packet?.channel === AUDIO_STATE && Buffer.isBuffer(packet.data) && packet.data.length <= 512, 'Invalid audio state packet')
  const buffer = packet.data; let offset = 0
  function readVar(bits) {
    let value = 0n
    for (let index = 0; index < Math.ceil(bits / 7); index++) {
      assert(offset < buffer.length, 'Truncated audio VarInt')
      const byte = buffer[offset++]
      value |= BigInt(byte & 127) << BigInt(index * 7)
      if (!(byte & 128)) {
        assert(value < (1n << BigInt(bits)), 'Overflowing audio VarInt')
        return BigInt.asIntN(bits, value)
      }
    }
    throw new Error('Overlong audio VarInt')
  }
  const kind = Number(readVar(32)), length = Number(readVar(32))
  assert((kind === 0 || kind === 1) && length > 0 && length <= 384 && offset + length <= buffer.length, 'Invalid audio state kind/nonce size')
  const encoded = buffer.subarray(offset, offset + length), gestureId = encoded.toString('utf8'); offset += length
  assert(gestureId.length <= 96 && Buffer.from(gestureId, 'utf8').equals(encoded), 'Invalid audio nonce UTF-8')
  const revision = Number(readVar(32)), floor = readVar(64)
  assert(revision >= 0 && floor >= -1n && floor < 9223372036854775807n && offset + 1 === buffer.length, 'Invalid audio state fields/trailing data')
  const accepted = buffer[offset]
  assert(accepted === 0 || accepted === 1, 'Invalid audio ACK boolean')
  return { kind, gestureId, revision, floor: floor.toString(), accepted: accepted === 1 }
}
function audioFixture(client, alive = () => {}) {
  const states = []; let failure
  const receive = packet => {
    if (packet.channel !== AUDIO_STATE) return
    try { const state = decodeAudioState(packet); states.push({ ...state, receivedAt: Date.now() }); assert(states.length <= 200, 'Too many audio state packets') }
    catch (error) { failure = error }
  }
  client.on('custom_payload', receive)
  async function wait(predicate, label, timeout = 2500) {
    const until = Date.now() + timeout
    while (Date.now() < until) { alive(); if (failure) throw failure; const value = states.find(predicate); if (value) return value; await sleep(25) }
    throw new Error(label)
  }
  return { states, close: () => client.removeListener('custom_payload', receive),
    start: (gestureId, revision = null) => wait(row => row.kind === 0 && row.gestureId === gestureId &&
      (revision === null || row.revision === revision), 'Server did not send current audio start nonce/revision'),
    async boundary(start, floor = -1n) {
      const index = states.length
      client.write('custom_payload', audioBoundaryPayload(start.gestureId, start.revision, floor))
      return wait((row, i) => i >= index && row.kind === 1 && row.gestureId === start.gestureId &&
        row.revision === start.revision && row.floor === BigInt(floor).toString(), 'Server did not acknowledge the synthetic audio boundary')
    } }
}
async function json(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }

export async function runContainer(env = process.env) {
  const report = { schema: 1, project: 'qiandengji', actor: QA, startedAt: new Date().toISOString(), ok: false,
    checks: [], cleanup: {}, packetCounts: { use_item: 0, release_use_item: 0, swap_hands: 0, mode_payload: 0 },
    scope: 'Real Mineflayer staff gestures and authoritative claim receipts; no spell execution or hardware PTT validation.',
    restoration: 'Root must restore the exact reserved QA playerdata/advancements/stats after logout. This tool does not overwrite saved player files.' }
  let rcon, bot, audioProtocol, lock, secret = '', uuid, ended = false, spawned = false, loggedIn = false, swapped = false, aborted, timer
  let stage = 'staff:registered-items-and-recipes'
  const lockPath = `${DATA}/.qiandengji-smoke.lock`, owner = randomUUID()
  const alive = () => { if (aborted) throw aborted }
  const interrupted = () => { aborted = new Error('Staff smoke interrupted') }
  const safeError = error => String(error?.message || error).replaceAll(secret || '\0', '[redacted]').slice(0, 350)
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details })
  async function poll(fn, error, ms = 7000) {
    const end = Date.now() + ms
    while (Date.now() < end) { alive(); const value = await fn(); if (value) return value; await sleep(100) }
    throw new Error(error)
  }
  async function command(text) { alive(); return rcon.send(allowedCommand(text), 7000) }
  async function status() { return receipt(await command(`qdchant status ${QA}`), uuid) }
  async function claim(recordedAt, recordingEndedAt = recordedAt, slot = 0) {
    assert(Number.isSafeInteger(recordedAt) && recordedAt > 0 && Number.isSafeInteger(recordingEndedAt) && recordingEndedAt >= recordedAt &&
      Number.isInteger(slot) && slot >= 0 && slot <= 8, 'Invalid recording interval/slot test input')
    return receipt(await command(`qdchant claim ${QA} ${recordedAt} ${recordingEndedAt} ${slot}`), uuid)
  }
  function use() { alive(); bot.activateItem(false); report.packetCounts.use_item++ }
  function release() { bot.deactivateItem(); report.packetCounts.release_use_item++ }
  function swapHands() {
    // The vanilla SWAP_ITEM_WITH_OFFHAND action, with the same sequence/position
    // shape used by Mineflayer's release-use packet in protocol 1.21.1.
    bot._client.write('block_dig', { status: 6, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: 0 })
    report.packetCounts.swap_hands++; swapped = !swapped
  }
  async function replaceMainhand(itemId) {
    if (bot.usingHeldItem) release()
    const output = await command(`item replace entity ${QA} weapon.mainhand with ${itemId} 1`)
    assert(!/Unknown|Incorrect|error|not found|No entity|No player/i.test(output), 'Reserved QA item replacement failed')
    await sleep(200)
    if (itemId !== 'minecraft:air') {
      const id = await command(`data get entity ${QA} SelectedItem.id`)
      assert(id.includes(`"${itemId}"`), 'Server main-hand item is not the newly registered staff')
    }
  }
  let previousGesture
  async function begin(itemId, acknowledge = true) {
    // Keep independent cases outside a previous gesture's conservative 2s tail.
    // Overlaps themselves are checked by the pure interval regression suite.
    const previous = await status()
    if (Number.isSafeInteger(previous.gesture?.releasedAt)) {
      const elapsed = previous.serverTime - previous.gesture.releasedAt
      assert(Number.isFinite(elapsed), 'Server clock missing from gesture status')
      if (elapsed < 2100) await sleep(2100 - elapsed)
    }
    use()
    const value = await poll(async () => {
      const current = await status()
      return current.using && current.gestureId && current.gestureId !== previousGesture ? current : null
    }, 'Real use_item packet did not open a new staff gesture')
    const evidence = gestureEvidence(value, itemId)
    previousGesture = evidence.gestureId
    const audioStart = await audioProtocol.start(evidence.gestureId)
    assert(audioStart.revision === 0, 'Fresh gesture audio revision is not zero')
    if (acknowledge) {
      const ack = await audioProtocol.boundary(audioStart, -1n)
      assert(ack.accepted, 'Actual recorder rejected QA boundary; root must prepare its temporary recording allowlist and ready decoder')
      const ready = await status()
      assert(ready.audioBoundaryReady === true && ready.audioRevision === audioStart.revision, 'ACK did not mark the current server audio boundary ready')
    }
    // Use the server's own gesture timestamp as the synthetic recording's time.
    // It is a claim-protocol fixture, not evidence of an actual audio recording.
    return { ...evidence, recordedAt: evidence.startedAt, audioStart,
      syntheticSequence: true, physicalSvcPacketsObserved: false }
  }
  async function released(gesture) {
    release()
    return poll(async () => {
      const value = await status()
      return !value.using && value.gestureId === gesture.gestureId && Number.isSafeInteger(value.gesture?.releasedAt) ? value : null
    }, 'Real release packet did not close the current staff gesture')
  }
  try {
    assert(env.SMOKE_EXECUTE === 'qiandengji' && env.SMOKE_PROJECT === 'qiandengji' && env.SMOKE_STAFF_PREFLIGHT === 'healthy',
      'Run the host wrapper after deployment; it verifies the actual services and installed JAR first')
    assert(env.MC_HOST === 'mc' && env.MC_PORT === '25599' && env.MC_RCON_HOST === 'mc' && env.MC_RCON_PORT === '25575', 'Wrong project target')
    assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing D project marker')
    assert((await json(`${DATA}/magic-state.json`)).players?.[QA], 'Existing QA profile required; no new fixture will be created')
    lock = await open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ owner, actor: QA, test: 'chanting-staff', at: report.startedAt }))
    timer = setTimeout(() => { aborted = new Error('Staff smoke exceeded 100 seconds') }, 100000)
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
    secret = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).trim()
    const { Rcon } = await import('/app/src/rcon.ts'); rcon = new Rcon('mc', 25575, secret); await rcon.connect()
    const health = receipt(await command('qdchant health'), null, true)
    assert(health.audioBoundaryProtocol === 1, 'The deployed mod does not expose audio boundary protocol 1')
    const online = await command('list'), registry = await command('numen_act list')
    assert(/players online/i.test(online) && /(?:^|\n)count=\d+/.test(registry) && !online.includes(QA) && !registry.includes(QA),
      'Reserved QA is already online/Numen, or absence cannot be established')
    bot = createRequire('/app/package.json')('mineflayer').createBot({ host: 'mc', port: 25599, username: QA,
      version: '1.21.1', auth: 'offline', hideErrors: true })
    audioProtocol = audioFixture(bot._client, alive)
    bot.on('spawn', () => { spawned = true }); bot.on('end', () => { ended = true })
    bot.on('error', () => { aborted = new Error('QA connection error') }); bot.on('kicked', () => { aborted = new Error('QA was kicked') })
    await poll(() => spawned && !ended, 'Existing QA did not log in', 25000); loggedIn = true
    bot._client.write('custom_payload', audioRegisterPayload())
    uuid = bot.player?.uuid || bot._client?.uuid
    assert(/^[0-9a-f-]{36}$/i.test(uuid || ''), 'Actual QA UUID unavailable'); report.actorUuid = uuid
    check(stage, { registeredItemIds: health.items, serverApi: 'qdchant health', recipeValidation: 'Installed JAR packaging checked by host; actual crafting not tested.' })

    stage = 'staff:direct-voice-without-staff'
    await replaceMainhand('minecraft:air')
    const bare = await status()
    assert(bare.holding === false && bare.using === false, 'Initial QA must have no staff in either hand')
    const direct = expectCode(await claim(Date.now()), true, 'direct_voice')
    check(stage, { code: direct.code, holding: direct.holding, using: direct.using })

    stage = 'staff:holding-needs-gesture'
    await replaceMainhand(ITEMS[0])
    const holding = await status()
    assert(holding.holding && !holding.using, 'A held but unused staff was not represented correctly')
    const required = expectCode(await claim(Date.now()), false, 'gesture_required')
    check(stage, { itemId: ITEMS[0], code: required.code, holding: holding.holding, using: holding.using })

    for (let index = 0; index < ITEMS.length; index++) {
      stage = index === 0 ? 'staff:whispering-gesture-single-claim' : 'staff:resonance-gesture-single-claim'
      await replaceMainhand(ITEMS[index])
      const gesture = await begin(ITEMS[index])
      const pending = expectCode(await claim(gesture.recordedAt), false, 'gesture_pending')
      await sleep(150)
      expectCode(await claim(gesture.recordedAt), false, 'gesture_pending')
      const stillHeld = await status()
      assert(stillHeld.using && !stillHeld.gesture?.claimed && pending.gestureId === gesture.gestureId,
        'Holding or repeated pending claim consumed the gesture before release')
      const releaseReceipt = await released(gesture)
      const first = expectCode(await claim(gesture.recordedAt), true, 'claimed')
      assert(!first.using && first.gestureId === gesture.gestureId && first.gesture?.claimed === true, 'Successful released claim did not consume this gesture')
      const repeated = expectCode(await claim(gesture.recordedAt), false, 'gesture_consumed')
      assert(repeated.gestureId === gesture.gestureId, 'Repeated claim was evaluated against a different gesture')
      const after = await status()
      assert(after.gestureId === gesture.gestureId && after.gesture?.claimed === true, 'Read-only status reset gesture consumption')
      check(stage, { ...gesture, recordingEndedAt: gesture.recordedAt, holding: first.holding, using: first.using,
        heldCode: pending.code, heldDidNotConsume: true, releasedAt: releaseReceipt.gesture.releasedAt, firstCode: first.code, repeatCode: repeated.code })
    }

    stage = 'staff:release-grace-claim'
    const grace = await begin(ITEMS[1]), releasedGrace = await released(grace)
    const afterRelease = expectCode(await claim(grace.recordedAt), true, 'claimed')
    assert(!afterRelease.using && afterRelease.gestureId === grace.gestureId, 'Release grace claim did not match the released gesture')
    expectCode(await claim(grace.recordedAt), false, 'gesture_consumed')
    check(stage, { ...grace, releasedAt: releasedGrace.gesture.releasedAt, code: afterRelease.code, using: afterRelease.using })

    stage = 'staff:expired-release-rejected'
    const expired = await begin(ITEMS[1]), releasedExpired = await released(expired)
    await sleep(8500)
    const timeout = expectCode(await claim(expired.recordedAt), false, 'gesture_expired')
    check(stage, { ...expired, releasedAt: releasedExpired.gesture.releasedAt, waitedAfterReleaseMs: 8500, code: timeout.code })

    stage = 'staff:mode-payload-and-late-voice'
    const mode = await begin(ITEMS[1])
    bot._client.write('custom_payload', modePayload(2)); report.packetCounts.mode_payload++
    const selected = await poll(async () => { const value = await status(); return value.gestureId === mode.gestureId && value.gesture?.slot === 2 ? value : null },
      'Actual C2S StaffModePayload did not select slot 2 through the network gate')
    expectCode(await claim(mode.recordedAt, mode.recordedAt, 0), false, 'shortcut_selected')
    expectCode(await claim(mode.recordedAt, mode.recordedAt, 1), false, 'slot_changed')
    expectCode(await claim(mode.recordedAt, mode.recordedAt, 2), false, 'gesture_pending')
    await released(mode)
    const shortcut = expectCode(await claim(mode.recordedAt, mode.recordedAt, 2), true, 'claimed')
    const lateVoice = expectCode(await claim(mode.recordedAt, mode.recordedAt, 0), false, 'gesture_consumed')
    assert(shortcut.gestureId === mode.gestureId && lateVoice.gestureId === mode.gestureId, 'Voice/shortcut used separate tickets')
    check(stage, { gestureId: mode.gestureId, packet: 'qiandeng_chanting:mode', slot: selected.gesture.slot,
      selectedByRealPayload: true, shortcutCode: shortcut.code, lateVoiceCode: lateVoice.code, spellsExecuted: 0 })

    stage = 'staff:hand-swap-rejected'
    const changed = await begin(ITEMS[1])
    swapHands(); await sleep(250)
    const moved = expectCode(await claim(changed.recordedAt), false, 'staff_changed')
    assert(moved.gestureId === changed.gestureId, 'Swap rejection did not correlate to the original gesture')
    check(stage, { ...changed, code: moved.code, packet: 'block_dig:SWAP_ITEM_WITH_OFFHAND' })
    swapHands(); await sleep(250)
    if (bot.usingHeldItem) release()

    stage = 'staff:same-item-replacement-rejected'
    await replaceMainhand(ITEMS[0])
    const replaced = await begin(ITEMS[0])
    // Same registry ID, different ItemStack instance: the old gesture must not
    // authorize the replacement staff. This is still restricted to the QA hand.
    await command(`item replace entity ${QA} weapon.mainhand with ${ITEMS[0]} 1`)
    await sleep(200)
    const rejected = expectCode(await claim(replaced.recordedAt), false, 'staff_changed')
    check(stage, { ...replaced, code: rejected.code, sameRegistryId: true })

    stage = 'staff:audio-boundary-handshake'
    const staleNonce = previousGesture
    await replaceMainhand(ITEMS[0])
    const fenced = await begin(ITEMS[0], false), initial = fenced.audioStart
    const denied = async (request, floor = -1n) => {
      const ack = await audioProtocol.boundary(request, floor)
      assert(!ack.accepted, 'Stale or regressing audio boundary was accepted')
      return ack
    }
    const confirmed = async (request, floor = -1n) => {
      const ack = await audioProtocol.boundary(request, floor)
      assert(ack.accepted, 'Current valid synthetic audio fence was rejected')
      const current = await status()
      assert(current.gestureId === fenced.gestureId && current.audioRevision === request.revision && current.audioBoundaryReady === true,
        'Accepted ACK did not belong to this current server revision')
      return current
    }
    const select = async (slot, revision) => {
      bot._client.write('custom_payload', modePayload(slot)); report.packetCounts.mode_payload++
      return poll(async () => { const current = await status(); return current.gestureId === fenced.gestureId && current.gesture?.slot === slot &&
        current.audioRevision === revision && current.audioBoundaryReady === false ? current : null }, 'Mode change did not invalidate the old audio boundary')
    }
    expectCode(await claim(fenced.recordedAt), false, 'audio_boundary_pending')
    await denied({ ...initial, gestureId: staleNonce })
    await denied({ ...initial, revision: 1 })
    await confirmed(initial)
    await denied(initial) // A single revision is acknowledged only once.
    await select(2, 1)
    expectCode(await claim(fenced.recordedAt, fenced.recordedAt, 2), false, 'gesture_pending')
    await select(0, 2)
    expectCode(await claim(fenced.recordedAt), false, 'audio_boundary_pending')
    await denied(initial)
    await denied({ ...initial, gestureId: staleNonce, revision: 2 })
    await confirmed({ ...initial, revision: 2 }, 0n)
    await select(2, 3)
    await select(0, 4)
    const regressed = await denied({ ...initial, revision: 4 }, -1n)
    expectCode(await claim(fenced.recordedAt), false, 'audio_boundary_pending')
    const finalReady = await confirmed({ ...initial, revision: 4 }, 0n)
    expectCode(await claim(fenced.recordedAt), false, 'gesture_mode_changed')
    const newRecordingAt = finalReady.serverTime
    expectCode(await claim(newRecordingAt), false, 'gesture_pending')
    await released(fenced)
    const finalClaim = expectCode(await claim(newRecordingAt), true, 'claimed')
    expectCode(await claim(newRecordingAt), false, 'gesture_consumed')
    check(stage, { gestureId: fenced.gestureId, actualRegisterPacket: true, serverStartPacket: true,
      actualBoundaryPackets: true, currentRevision: 4, initialFloor: '-1', latestFloor: '0',
      staleNonceRejected: true, staleRevisionRejected: true, duplicateAckRejected: true,
      sequenceFloorRegressionRejected: !regressed.accepted, oldRecordingAfterModeSwitchRejected: true,
      shortcutDoesNotWaitForAudio: true, currentBoundaryAccepted: true, finalCode: finalClaim.code,
      syntheticSequence: true, physicalSvcPacketsObserved: false,
      scope: 'Actual nonce/revision ACK and recorder fence -1→0→-1 regression checks; no UDP packet ordering or microphone capture claim.' })
  } catch (error) { report.error = safeError(error); report.checks.push({ name: stage, ok: false, error: report.error }) }
  finally {
    clearTimeout(timer); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    audioProtocol?.close()
    if (bot) {
      try { if (!ended) { if (swapped) swapHands(); release(); if (bot.currentWindow) bot.closeWindow(bot.currentWindow); bot.quit('Staff smoke complete') } }
      catch { bot._client?.end() }
      for (let i = 0; i < 20 && !ended; i++) await sleep(100)
      if (!ended) bot._client?.end()
      report.cleanup.clientDisconnected = ended
    }
    if (loggedIn && rcon) {
      try { for (let i = 0; i < 6; i++) {
        const online = await rcon.send('list', 4000)
        if (/players online/i.test(online) && !online.includes(QA)) { report.cleanup.actorOffline = true; break }
        await sleep(200)
      } report.cleanup.actorOffline ??= false } catch { report.cleanup.actorOffline = false }
    }
    rcon?.close()
    if (lock) { try { await lock.close(); assert((await json(lockPath)).owner === owner, 'Lock ownership changed'); await unlink(lockPath)
      report.cleanup.lockReleased = true } catch { report.cleanup.lockReleased = false } }
    report.cleanup.savedPlayerFilesRestorationOwner = 'root orchestrator'
    report.cleanup.spellsExecuted = 0; report.cleanup.numenBodiesCreated = 0
    report.ok = !report.error && report.checks.every(row => row.ok === true) &&
      REQUIRED.every(name => report.checks.some(row => row.name === name && row.ok)) &&
      report.cleanup.actorOffline === true && report.cleanup.lockReleased === true && report.cleanup.clientDisconnected === true
    report.finishedAt = new Date().toISOString()
  }
  return report
}

async function gateReachable() {
  await new Promise((done, fail) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 25701 })
    socket.setTimeout(2500, () => { socket.destroy(); fail(new Error('D gate TCP health timeout')) })
    socket.once('connect', () => { socket.destroy(); done() }); socket.once('error', () => fail(new Error('D gate TCP health failed')))
  })
}
async function preflight(project, compose, options) {
  const services = (await exec('docker', [...compose, 'config', '--services'], options)).stdout.trim().split(/\r?\n/)
  assert(services.includes('mc') && services.includes('world') && services.includes('asr'), 'Unexpected project service inventory')
  const rows = await Promise.all(services.map(async service => {
    const id = (await exec('docker', [...compose, 'ps', '--all', '-q', service], options)).stdout.trim()
    assert(/^[0-9a-f]{12,64}$/.test(id), `Service ${service} is missing or has multiple containers`)
    const format = '{{json .State.Status}}|{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}|{{json (index .Config.Labels "com.docker.compose.project")}}'
    const values = (await exec('docker', ['inspect', '--format', format, id], options)).stdout.trim().split('|').map(value => JSON.parse(value))
    assert(values[0] === 'running' && values[2] === 'qiandengji' && (values[1] === 'healthy' || (service === 'gate' && values[1] === null)),
      `Service ${service} must be running and healthy before staff testing`)
    return { service, container: id, state: values[0], health: values[1] ?? 'no-docker-healthcheck' }
  }))
  await gateReachable()
  const jars = (await readdir(join(project, 'server/mc/mods'))).filter(name => /chanting.*\.jar$/i.test(name))
  assert(jars.length === 1, 'Install exactly one independent chanting-items JAR before testing')
  const jarPath = join(project, 'server/mc/mods', jars[0])
  const code = `import json,sys,zipfile,hashlib\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z:\n rows=[]\n for item in ['whispering_staff','resonance_staff']:\n  name='data/qiandeng_chanting/recipe/'+item+'.json'\n  data=json.loads(z.read(name))\n  result=data.get('result',{})\n  assert result.get('id')=='qiandeng_chanting:'+item\n  rows.append({'id':'qiandeng_chanting:'+item,'entry':name,'type':data.get('type'),'resultId':result.get('id')})\n print(json.dumps({'recipes':rows}))\n`
  const recipe = JSON.parse((await exec('python', ['-c', code, jarPath], options)).stdout)
  return { services: rows, gateTcp25701: true, checkedAt: new Date().toISOString(),
    mod: { filename: jars[0], sha256: sha(await readFile(jarPath)), ...recipe } }
}
async function runHost() {
  assert(process.argv.length === 4 && process.argv[2] === '--execute' && process.argv[3] === 'qiandengji',
    'Use --execute qiandengji after root deployment, healthy services and QA backups')
  const self = fileURLToPath(import.meta.url), project = resolve(dirname(self), '..'), began = new Date().toISOString()
  const compose = ['compose', '--project-directory', project, '-f', join(project, 'compose.yml'), '-p', 'qiandengji']
  const options = { cwd: project, windowsHide: true, timeout: 125000, maxBuffer: 2*1024*1024 }
  let report, environment, container, remote
  try {
    assert((await readFile(join(project, 'server/world-data/.qiandengji-smoke'), 'utf8')).trim() === 'qiandengji', 'Missing D project marker')
    environment = await preflight(project, compose, options)
    container = environment.services.find(row => row.service === 'world').container
    remote = `/tmp/staff-smoke-${randomUUID()}.mjs`
    await exec('docker', ['cp', self, `${container}:${remote}`], options)
    let stdout
    try { ({ stdout } = await exec('docker', [...compose, 'exec', '-T', '-e', 'SMOKE_EXECUTE=qiandengji', '-e', 'SMOKE_PROJECT=qiandengji',
      '-e', 'SMOKE_STAFF_PREFLIGHT=healthy', 'world', '/app/node_modules/.bin/tsx', remote, '--container'], options)) }
    catch (error) { stdout = error.stdout || '' }
    try { report = JSON.parse(stdout.trim()) } catch { throw new Error('Staff container diagnostic returned no complete JSON report') }
  } catch (error) { report = { schema: 1, project: 'qiandengji', actor: QA, startedAt: began, finishedAt: new Date().toISOString(),
    ok: false, checks: [], cleanup: {}, error: error.code ? 'Staff host preflight/exec failed' : String(error.message).slice(0, 300) } }
  finally { if (container && remote) await exec('docker', ['exec', container, 'node', '-e', "require('node:fs').unlinkSync(process.argv[1])", remote],
    { ...options, timeout: 10000 }).catch(() => {}) }
  report.preflight = environment
  report.sourceHashes = { 'tools/smoke_chanting_staff.mjs': sha(await readFile(self)) }
  await mkdir(join(project, 'reports'), { recursive: true })
  await writeFile(join(project, 'reports/chanting-staff-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ok: report.ok, report: 'reports/chanting-staff-smoke.json', checks: report.checks.map(row => ({ name: row.name, ok: row.ok })) }))
  if (!report.ok) process.exitCode = 1
}

function testAudioWire(a) {
  const fields = wireFields('qa-gesture', 2, -1n)
  const packet = (kind, body = fields, accepted = 1) => ({ channel: AUDIO_STATE, data: Buffer.concat([signedVar(kind, 32), body, Buffer.from([accepted])]) })
  a.equal(audioBoundaryPayload('qa-gesture', 2).data.subarray(-10).toString('hex'), 'ffffffffffffffffff01')
  a.deepEqual(decodeAudioState(packet(0)), { kind: 0, gestureId: 'qa-gesture', revision: 2, floor: '-1', accepted: true })
  a.equal(decodeAudioState(packet(1, fields, 0)).accepted, false)
  a.equal(decodeAudioState(packet(1, wireFields('qa-gesture', 3, 9223372036854775806n))).floor, '9223372036854775806')
  for (const args of [['x'.repeat(97), 0, -1n], ['x', -1, -1n], ['x', 0, -2n],
    ['x', 0, 9223372036854775807n], ['x', 0, Number.MAX_SAFE_INTEGER + 1]]) a.throws(() => audioBoundaryPayload(...args))
  const valid = packet(1)
  for (const bad of [
    { ...valid, data: valid.data.subarray(0, -1) },
    { ...valid, data: Buffer.concat([valid.data, Buffer.from([0])]) },
    packet(1, fields, 2), { ...valid, channel: 'unrelated:state' },
    { ...valid, data: Buffer.from([0, 1, 255, 0, 0, 1]) },
    { ...valid, data: Buffer.alloc(513) },
  ]) a.throws(() => decodeAudioState(bad))
  a.throws(() => decodeAudioState(packet(1, Buffer.concat([signedVar(1, 32), Buffer.from('x'), signedVar(0, 32), Buffer.from('ffffffffffffffffff03', 'hex')]))))
  return 16
}
async function testAudioFixture(a) {
  const { EventEmitter } = await import('node:events')
  const client = new EventEmitter(), fixture = audioFixture(client)
  const send = (kind, id = 'qa-current', revision = 0, floor = -1n, accepted = 1) =>
    client.emit('custom_payload', { channel: AUDIO_STATE, data: Buffer.concat([signedVar(kind, 32), wireFields(id, revision, floor), Buffer.from([accepted])]) })
  a.deepEqual(audioRegisterPayload(), { channel: 'minecraft:register', data: Buffer.from(AUDIO_STATE + '\0' + AUDIO_BOUNDARY + '\0', 'ascii') })
  send(0); const start = await fixture.start('qa-current')
  a.equal(start.revision, 0)
  send(1) // Previously delivered ACK cannot satisfy a new request.
  client.write = () => {
    send(1, 'qa-old'); send(1, 'qa-current', 1); send(1, 'qa-current', 0, 0n)
    setTimeout(() => send(1), 15)
  }
  const ack = await fixture.boundary(start)
  a.equal(ack.accepted, true)
  a.equal(fixture.states.length, 6)
  fixture.close(); a.equal(client.listenerCount('custom_payload'), 0)
  return 5
}
export async function selfTest() {
  const { default: a } = await import('node:assert/strict'), uuid = '11111111-2222-3333-8444-555555555555'
  const health = { schema: 1, ok: true, code: 'ready', items: ITEMS }
  a.equal(receipt(PREFIX + JSON.stringify(health), null, true).code, 'ready')
  const state = { schema: 1, ok: true, code: 'ready', actor: QA, actorUuid: uuid, holding: true, using: true,
    gestureId: 'gesture-1', gesture: { startedAt: 1000, releasedAt: null, claimed: false, itemId: ITEMS[0], hand: 'mainhand', active: true, slot: 0 } }
  a.equal(receipt(PREFIX + JSON.stringify(state), uuid).actor, QA)
  a.throws(() => receipt(PREFIX + JSON.stringify(state), 'wrong-uuid'))
  a.throws(() => receipt(PREFIX + JSON.stringify({ ...state, actor: 'MengMeng' }), uuid))
  a.throws(() => receipt(PREFIX + JSON.stringify(state) + '\n' + PREFIX + JSON.stringify(state), uuid))
  a.throws(() => receipt('public ' + PREFIX + JSON.stringify(state), uuid))
  a.equal(gestureEvidence(state, ITEMS[0]).gestureId, 'gesture-1')
  a.throws(() => gestureEvidence({ ...state, using: false }, ITEMS[0]))
  a.throws(() => gestureEvidence({ ...state, gesture: { ...state.gesture, claimed: true } }, ITEMS[0]))
  a.throws(() => gestureEvidence(state, ITEMS[1]))
  a.equal(expectCode({ ok: false, code: 'gesture_consumed' }, false, 'gesture_consumed').ok, false)
  a.throws(() => expectCode({ ok: true, code: 'direct_voice' }, false, 'gesture_consumed'))
  for (const command of ['list', `qdchant claim ${QA} 1788760000000 1788760000010 0`, `item replace entity ${QA} weapon.mainhand with ${ITEMS[1]} 1`])
    a.equal(allowedCommand(command), command)
  for (const command of ['qdspell cast QDGuildProbe irons_spellbooks:firebolt', 'numen_act spawn NewBody',
    'item replace entity MengMeng weapon.mainhand with minecraft:air 1', `qdchant claim ${QA} 1\nsay bad`]) a.throws(() => allowedCommand(command))
  a.equal(new Set(REQUIRED).size, 11)
  a.throws(() => allowedCommand(`qdchant claim ${QA} 1788760000000`))
  a.throws(() => gestureEvidence({ ...state, gesture: { ...state.gesture, slot: 2 } }, ITEMS[0]))
  a.deepEqual(modePayload(8), { channel: 'qiandeng_chanting:mode', data: Buffer.from([8]) })
  for (const invalid of [-1, 9, 0.5]) a.throws(() => modePayload(invalid))
  return { ok: true, offlineAssertions: 26 + testAudioWire(a) + await testAudioFixture(a), liveConnections: 0 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') console.log(JSON.stringify(await selfTest()))
  else if (process.argv[2] === '--container') { console.log = (...args) => console.error(...args)
    const report = await runContainer(); process.stdout.write(JSON.stringify(report) + '\n'); if (!report.ok) process.exitCode = 1 }
  else await runHost()
}
