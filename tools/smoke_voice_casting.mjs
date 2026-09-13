/** Operator prepares/restores only QDGuildProbe's saved files and temporarily
 * sets world+ASR allowlists to that QA. This tool never changes service config.
 * Run: node tools/smoke_voice_casting.mjs --execute qiandengji [--staff]
 * Offline: node tools/smoke_voice_casting.mjs --self-test
 */
import { readFile, writeFile, mkdir, open, unlink, rename, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile as execCallback } from 'node:child_process'
import { promisify } from 'node:util'

export const QA = 'QDGuildProbe'
export const REQUIRED = ['voice:model-endpoint-unreachable', 'voice:reserved-qa-fixture', 'voice:tts-wav-generated',
  'voice:asr-recording-time-preserved', 'voice:command-receipt', 'voice:three-firework-entities', 'voice:replay-no-second-cast']
export const STAFF_REQUIRED = [...REQUIRED, 'voice:custom-staff-armed', 'voice:audio-boundary-ack']
const STAFF = 'qiandeng_chanting:whispering_staff'
const DEAD_URL = 'http://127.0.0.1:1/api/console/chat', DATA = '/app/data', MIC = '/godvoice/mic'
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const sha = data => createHash('sha256').update(data).digest('hex')
const exec = promisify(execCallback)
const ID = /^voiceqa-[0-9a-f-]{36}$/
const SOURCES = ['tools/smoke_voice_casting.mjs', 'world/sidecar/mic_asr_watcher.py',
  'world/src/voice-command-inbox.ts', 'world/src/application/spoken-commands.ts', 'world/src/gameplay/commands/spoken-intent.ts']

export function validReceipt(row, id) {
  return row?.id === id && row.actor === QA && row.kind === 'command' && row.verb === 'cast' &&
    row.ok === true && row.skillId === 'fireworks' && Number.isFinite(row.at) && Number.isFinite(row.manaLeft)
}
export function ownSampleDiagnostic(value, id) {
  if (!ID.test(id) || value?.schema !== 2 || value.id !== id || value.player !== QA || value.wav !== `${id}.wav` ||
    typeof value.text !== 'string' || value.text.length > 8192) return null
  return { id, actor: QA, syntheticAudio: true, originalOutputCaptured: true,
    transcript: value.text.slice(0,256), transcriptLength: value.text.length,
    transcriptSha256: sha(value.text), truncated: value.text.length > 256 }
}
export function ownReceiptDiagnostic(value, id) {
  if (!ID.test(id) || value?.id !== id || value.actor !== QA) return null
  const result = {}
  for (const key of ['id','actor','kind','verb','code','ok','at','skillId','manaLeft']) {
    const item = value[key]
    if (typeof item === 'string') result[key] = item.slice(0,128)
    else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) result[key] = item
  }
  return result
}
export function validateFixture(profile) {
  assert(profile && profile.level >= 1 && profile.learned?.includes('fireworks') && profile.mana >= 20,
    'Operator must prepare the existing QA fireworks profile before starting this tool')
}
export function validateRecordingInterval(metadata, audio, completedAt, sampled = null) {
  assert(metadata?.schema === 2 && audio?.schema === 2 && metadata.player === QA &&
    metadata.ts === audio.recordedAt && metadata.recordingEndedAt === audio.recordingEndedAt && metadata.emittedAt === audio.emittedAt &&
    [metadata.ts, metadata.recordingEndedAt, metadata.emittedAt, completedAt].every(value => Number.isSafeInteger(value) && value > 0) &&
    metadata.ts <= metadata.recordingEndedAt && metadata.recordingEndedAt <= metadata.emittedAt && metadata.emittedAt <= completedAt &&
    completedAt - metadata.ts <= 120000, 'ASR schema-2 recording interval/completion chronology mismatch')
  if (sampled) assert(sampled.schema === 2 && sampled.recordedAt === metadata.ts && sampled.recordingEndedAt === metadata.recordingEndedAt &&
    sampled.emittedAt === metadata.emittedAt && sampled.ts === completedAt && sampled.id === audio.id && sampled.player === QA,
    'Captured ASR output did not preserve the complete original recording interval')
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
async function readJson(path, limit = 2 * 1024 * 1024) {
  assert((await stat(path)).size <= limit, 'JSON exceeds diagnostic size bound')
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
}
async function tail(path) {
  let file
  try {
    file = await open(path, 'r'); const size = (await file.stat()).size, start = Math.max(0, size - 131072)
    const buffer = Buffer.alloc(Math.min(size, 131072)), { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n'); if (start) lines.shift(); lines.pop()
    return lines.flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  } catch (error) { if (error.code === 'ENOENT') return []; throw error } finally { await file?.close() }
}
async function atomic(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value)); await rename(path + '.tmp', path)
}

export async function runContainer(id, env = process.env) {
  const customStaff = env.SMOKE_STAFF === '1'
  const report = { schema: 1, project: 'qiandengji', actor: QA, id, customStaff, startedAt: new Date().toISOString(), ok: false,
    checks: [], cleanup: {}, scope: 'Synthetic TTS audio through real ASR and the live voice command consumer; not microphone hardware.',
    restoration: 'Operator must restore the exact reserved QA playerdata/advancements/stats and only its magic profile after logout and world stop.' }
  const check = (name, details) => report.checks.push({ name, ok: true, ...details })
  const stateDir = `${DATA}/voice-smoke`, lockPath = `${DATA}/.qiandengji-smoke.lock`, owner = randomUUID()
  let lock, rcon, bot, audioProtocol, secret = '', ended = false, spawned = false, stopped, timer, sampling, sampled, loggedIn = false
  let stage = 'voice:model-endpoint-unreachable', submittedAt = 0, staffArmedAt = 0, staffGesture
  const rockets = [], alive = () => { if (stopped) throw stopped }
  const safeError = error => String(error?.message || error).replaceAll(secret || '\0', '[redacted]').slice(0, 350)
  const interrupt = () => { stopped = new Error('Voice smoke interrupted') }
  async function poll(fn, message, ms = 15000) {
    const until = Date.now() + ms
    while (Date.now() < until) { alive(); const result = await fn(); if (result) return result; await sleep(50) }
    throw new Error(message)
  }
  async function command(text) {
    assert(['list', 'numen_act list', `experience set ${QA} 1 levels`, `experience set ${QA} 0 points`,
      `qdspell status ${QA}`, ...(customStaff ? [`item replace entity ${QA} weapon.mainhand with ${STAFF} 1`, `qdchant status ${QA}`] : [])].includes(text), 'Unexpected smoke RCON command')
    alive(); return rcon.send(text, 7000)
  }
  async function staffStatus() {
    const lines = (await command(`qdchant status ${QA}`)).split(/\r?\n/).filter(line => line.startsWith('QD_CHANT_JSON '))
    assert(lines.length === 1, 'Missing or ambiguous self-owned staff status envelope')
    const value = JSON.parse(lines[0].slice('QD_CHANT_JSON '.length))
    assert(value.schema === 1 && value.ok === true && value.actor === QA && value.actorUuid === report.actorUuid,
      'Self-owned staff status actor/UUID mismatch')
    return value
  }
  try {
    assert(ID.test(id), 'Invalid owned voice test job ID')
    assert(env.SMOKE_EXECUTE === 'qiandengji' && env.SMOKE_PROJECT === 'qiandengji' &&
      env.MC_HOST === 'mc' && env.MC_PORT === '25599' && env.MC_RCON_HOST === 'mc' && env.MC_RCON_PORT === '25575', 'Wrong project/target')
    assert(env.VOICE_ALLOWED_PLAYERS === QA && env.QWENPAW_CONSOLE_URL === DEAD_URL && env.GODVOICE_DIR === '/godvoice',
      'Root must prepare exact temporary QA allowlist, dead model and isolated voice mount')
    let rejected = false
    try { await fetch(DEAD_URL, { signal: AbortSignal.timeout(1500) }) } catch { rejected = true }
    assert(rejected, 'The disabled model endpoint returned an HTTP response')
    assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing D project marker')
    const heartbeat = await readJson(`${DATA}/world-heartbeat.json`)
    assert(Date.now() - heartbeat.ts < 180000 && heartbeat.voiceCommands?.schema === 1 && heartbeat.voiceCommands.ready === true &&
      heartbeat.voiceCommands.modelRequired === false, 'Voice command consumer must be fresh and ready without a model')
    lock = await open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ owner, actor: QA, id, at: report.startedAt, test: 'voice-casting' }))
    timer = setTimeout(() => { stopped = new Error('Voice smoke exceeded 150 seconds') }, 150000)
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
    check(stage, { endpoint: DEAD_URL, fetchRejected: true, voiceCommands: heartbeat.voiceCommands })
    stage = 'voice:reserved-qa-fixture'
    const profile = (await readJson(`${DATA}/magic-state.json`)).players?.[QA]; validateFixture(profile)
    secret = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).trim()
    const { Rcon } = await import('/app/src/rcon.ts'); rcon = new Rcon('mc', 25575, secret); await rcon.connect()
    const online = await command('list'), registry = await command('numen_act list')
    assert(/players online/i.test(online) && /(?:^|\n)count=\d+/.test(registry) && !online.includes(QA) && !registry.includes(QA),
      'QA must be offline and not a Numen body before the test')
    bot = createRequire('/app/package.json')('mineflayer').createBot({ host: 'mc', port: 25599, username: QA,
      version: '1.21.1', auth: 'offline', hideErrors: true })
    if (customStaff) audioProtocol = audioFixture(bot._client, alive)
    bot.on('spawn', () => { spawned = true }); bot.on('end', () => { ended = true })
    bot.on('error', () => { stopped = new Error('QA connection error') }); bot.on('kicked', () => { stopped = new Error('QA kicked') })
    bot.on('entitySpawn', entity => {
      if (entity.name === 'firework_rocket' && entity.position && bot.entity?.position && entity.position.distanceTo(bot.entity.position) < 12)
        rockets.push({ id: entity.id, at: Date.now() })
    })
    await poll(() => spawned && !ended, 'Existing QA login failed', 25000); loggedIn = true
    if (customStaff) bot._client.write('custom_payload', audioRegisterPayload())
    report.actorUuid = bot.player?.uuid || bot._client.uuid
    await command(`experience set ${QA} 1 levels`); await command(`experience set ${QA} 0 points`)
    const nativeRaw = await command(`qdspell status ${QA}`)
    const nativeLine = nativeRaw.split(/\r?\n/).filter(row => row.startsWith('QD_SPELL_JSON '))
    assert(nativeLine.length === 1, 'Native QA status envelope missing or ambiguous')
    const native = JSON.parse(nativeLine[0].slice(14))
    assert(native.ok === true && native.actor === QA && native.actorUuid === report.actorUuid && native.level === 1,
      'Actual native QA level did not become 1')
    assert(bot.players.Goddess, 'World companion is offline')
    check(stage, { nativeLevel: native.level, actorUuid: report.actorUuid, fireworksLearned: true, preparedMana: profile.mana,
      operatorRestoresReservedFiles: true })
    if (customStaff) {
      stage = 'voice:custom-staff-armed'
      await command(`item replace entity ${QA} weapon.mainhand with ${STAFF} 1`)
      await sleep(200)
      staffArmedAt = Date.now()
      bot.activateItem(false)
      const state = await poll(async () => { const value = await staffStatus(); return value.holding && value.using ? value : null },
        'Actual use_item did not arm the custom staff')
      assert(typeof state.gestureId === 'string' && state.gesture?.itemId === STAFF && state.gesture.hand === 'mainhand' &&
        state.gesture.active === true && state.gesture.claimed === false && state.gesture.slot === 0 && Number.isSafeInteger(state.gesture.startedAt),
        'Custom staff did not expose a fresh unique main-hand gesture')
      staffGesture = { id: state.gestureId, startedAt: state.gesture.startedAt }
      stage = 'voice:audio-boundary-ack'
      const start = await audioProtocol.start(state.gestureId)
      assert(start.revision === 0, 'Fresh staff gesture did not start with revision zero')
      const ack = await audioProtocol.boundary(start, -1n)
      assert(ack.accepted, 'Actual recorder rejected the QA audio boundary; root must prepare its temporary recording allowlist and ready decoder')
      check(stage, { gestureId: ack.gestureId, revision: ack.revision, floor: ack.floor,
        serverStartPacket: true, actualBoundaryPacket: true, serverAccepted: true,
        syntheticSequence: true, physicalSvcPacketsObserved: false,
        scope: 'The live handshake accepts an explicit no-UDP-history floor; this does not certify SVC capture or physical PTT.' })
    }
    await mkdir(stateDir, { recursive: true })
    const output = `${MIC}/outbox/${id}.json`
    // Capture an original ASR output if visible between its atomic publication and
    // the live consumer's removal. No synthetic text substitutes for this evidence.
    let reading = false
    sampling = setInterval(async () => {
      if (sampled || reading) return
      reading = true
      try {
        const value = await readJson(output, 16384), diagnostic = ownSampleDiagnostic(value,id)
        if (diagnostic) { sampled = value; report.qaDiagnostic ??= {}; report.qaDiagnostic.asr = diagnostic }
      }
      catch {} finally { reading = false }
    }, 10)
    submittedAt = Date.now()
    await atomic(`${stateDir}/${id}.ready.json`, { id, actor: QA, at: submittedAt })
    stage = 'voice:tts-wav-generated'
    const audio = await poll(async () => { try { return await readJson(`${MIC}/.smoke/${id}.audio.json`) } catch (error) { if (error.code === 'ENOENT') return null; throw error } },
      'Host did not publish a synthesized WAV manifest', 95000)
    assert(audio.schema === 2 && audio.id === id && audio.player === QA && audio.sampleRate === 16000 && audio.channels === 1 && audio.sampleWidth === 2 &&
      audio.duration >= 0.45 && audio.duration <= 30 && /^[0-9a-f]{64}$/.test(audio.sha256), 'Unexpected actual TTS/WAV manifest')
    check(stage, { audioSha256: audio.sha256, duration: audio.duration, sampleRate: audio.sampleRate, syntheticAudio: true,
      actualRecorderConfigUnchanged: true })
    if (customStaff) {
      stage = 'voice:custom-staff-armed'
      const premature = (await tail(`${DATA}/skill-usage.jsonl`)).filter(row => row.player === QA && row.atom === 'fireworks' &&
        row.success && Date.parse(row.ts) >= staffArmedAt && Date.parse(row.ts) < audio.recordedAt)
      assert(premature.length === 0 && audio.recordedAt >= staffGesture.startedAt,
        'Holding/using the custom staff executed fireworks before any synthesized recording existed')
      report.staffBeforeAudio = { prematureSuccessfulUsageEntries: premature.length, audioReadyAt: audio.recordedAt }
    }
    stage = 'voice:asr-recording-time-preserved'
    const completedAt = await poll(async () => { try { return (await readJson(`${MIC}/.asr-seen.json`))[id] } catch (error) { if (error.code === 'ENOENT') return null; throw error } },
      'Actual ASR watcher did not complete the unique audio job', 30000)
    const metadata = await poll(async () => { try { return await readJson(`${MIC}/processed/${id}.txt`, 16384) } catch (error) { if (error.code === 'ENOENT') return null; throw error } },
      'ASR did not archive the actual source metadata')
    validateRecordingInterval(metadata, audio, completedAt, sampled)
    check(stage, { schema: 2, recordedAt: metadata.ts, recordingEndedAt: metadata.recordingEndedAt, emittedAt: metadata.emittedAt,
      completedAt, asrLatencyMs: completedAt - metadata.ts,
      originalOutputCaptured: !!sampled, ...(sampled ? { transcriptSha256: sha(sampled.text), transcriptLength: sampled.text.length } : {}),
      evidence: 'Actual ASR terminal index + archived recorder metadata + same-ID live consumer receipt' })
    const receiptsPath = `${DATA}/voice-command-receipts.jsonl`
    if (customStaff) {
      stage = 'voice:custom-staff-armed'
      // ASR has really finished while the use key is still held. Give the live
      // consumer time to observe pending; it must not release effects early.
      await sleep(350)
      const pending = await staffStatus()
      const premature = (await tail(`${DATA}/skill-usage.jsonl`)).filter(row => row.player === QA && row.atom === 'fireworks' &&
        row.success && Date.parse(row.ts) >= staffArmedAt)
      const earlyReceipts = (await tail(receiptsPath)).filter(row => validReceipt(row, id))
      const earlyRockets = rockets.filter(row => row.at >= staffArmedAt)
      assert(pending.holding && pending.using && pending.gestureId === staffGesture.id && pending.gesture?.active === true &&
        pending.gesture.claimed === false && pending.gesture.slot === 0 && premature.length === 0 && earlyReceipts.length === 0 && earlyRockets.length === 0,
        'ASR completion while holding the staff consumed a gesture or released a spell before use-key release')
      const releaseRequestedAt = Date.now()
      bot.deactivateItem()
      const released = await poll(async () => { const value = await staffStatus(); return !value.using && value.gestureId === staffGesture.id &&
        value.gesture?.active === false && Number.isSafeInteger(value.gesture.releasedAt) ? value : null }, 'Real release packet did not end the voice gesture')
      assert(metadata.recordingEndedAt <= released.gesture.releasedAt, 'Synthetic recording ended outside the released staff gesture')
      check(stage, { itemId: STAFF, gestureId: staffGesture.id, startedAt: staffGesture.startedAt, slot: 0,
        usingConfirmedByServer: true, actualUseItemPacket: true, noCastBeforeAudio: true, noCastBeforeRelease: true,
        asrFinishedWhileHeld: true, preAudioSuccessfulUsageEntries: report.staffBeforeAudio.prematureSuccessfulUsageEntries,
        preReleaseSuccessfulUsageEntries: premature.length, preReleaseEntityPackets: earlyRockets.length, preReleaseSuccessfulReceipts: earlyReceipts.length,
        audioReadyAt: audio.recordedAt, releaseRequestedAt, releasedAt: released.gesture.releasedAt, actualReleasePacket: true })
    }
    stage = 'voice:command-receipt'
    const receipt = await poll(async () => (await tail(receiptsPath)).find(row => row.id === id && row.actor === QA && row.kind !== 'claimed'),
      'No final voice command receipt for the real ASR job')
    report.qaDiagnostic ??= {}; report.qaDiagnostic.receipt = ownReceiptDiagnostic(receipt,id)
    assert(validReceipt(receipt, id), 'Real ASR voice input did not produce a successful fireworks command receipt')
    check(stage, { receipt, modelRequired: false })
    stage = 'voice:three-firework-entities'
    await poll(() => new Set(rockets.filter(row => row.at >= submittedAt).map(row => row.id)).size >= 3,
      'Three actual firework entities were not observed near the QA', 6000)
    const rocketCount = new Set(rockets.filter(row => row.at >= submittedAt).map(row => row.id)).size
    assert(rocketCount === 3, 'Unexpected extra firework entities near the reserved QA')
    const usage = () => tail(`${DATA}/skill-usage.jsonl`).then(rows => rows.filter(row => row.player === QA && row.atom === 'fireworks' && row.success && Date.parse(row.ts) >= submittedAt))
    const successes = await poll(async () => { const rows = await usage(); return rows.length ? rows : null }, 'Actual skill usage ledger did not record fireworks')
    assert(successes.length === 1 && successes[0].mana === 5, 'Expected exactly one real five-mana fireworks skill usage')
    check(stage, { actualEntityPackets: rocketCount, successfulUsageEntries: 1, consumedMana: successes[0].mana,
      manaLeft: successes[0].manaLeft })
    stage = 'voice:replay-no-second-cast'
    // Prefer the captured original transcript. If its consumer removed it before
    // sampling, this explicitly synthetic same-ID redelivery tests only the replay
    // guard; it is never accepted as evidence for the initial ASR recognition.
    const replay = sampled ?? { schema: 2, id, player: QA, text: '咏唱烟花术', ts: completedAt, recordedAt: metadata.ts,
      recordingEndedAt: metadata.recordingEndedAt, emittedAt: metadata.emittedAt, wav: `${id}.wav` }
    await atomic(output, replay)
    await poll(async () => { try { await stat(output); return false } catch (error) { if (error.code === 'ENOENT') return true; throw error } },
      'Voice inbox did not remove the already committed ID')
    await sleep(3000)
    const finalRows = (await tail(receiptsPath)).filter(row => row.id === id)
    assert(finalRows.filter(row => row.kind === 'claimed').length === 1 && finalRows.filter(row => validReceipt(row, id)).length === 1 &&
      (await usage()).length === 1 && new Set(rockets.filter(row => row.at >= submittedAt).map(row => row.id)).size === 3,
      'Repeated voice job ID caused a second claim, cast or visual effect')
    check(stage, { successfulReceipts: 1, claims: 1, successfulUsageEntries: 1, actualEntityPackets: 3,
      replayedOriginalTranscript: !!sampled, syntheticDuplicateFallback: !sampled })
    if (customStaff) {
      const finalStaff = await staffStatus()
      assert(finalStaff.holding === true && finalStaff.using === false && finalStaff.gestureId === staffGesture.id &&
        finalStaff.gesture?.claimed === true && finalStaff.gesture.active === false && finalStaff.gesture.slot === 0,
        'Voice cast did not consume exactly the released voice-mode custom staff gesture')
      report.staffAfterVoice = { itemId: STAFF, gestureId: finalStaff.gestureId, holding: finalStaff.holding,
        using: finalStaff.using, claimed: finalStaff.gesture.claimed }
    }
  } catch (error) { report.error = safeError(error); report.checks.push({ name: stage, ok: false, error: report.error }) }
  finally {
    clearTimeout(timer); clearInterval(sampling); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    audioProtocol?.close()
    if (bot) { try { if (customStaff && !ended) { bot.deactivateItem(); report.cleanup.staffReleased = true }
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow); bot.quit('Voice smoke complete') } catch { bot._client?.end() }
      for (let i = 0; i < 20 && !ended; i++) await sleep(100)
      if (!ended) bot._client?.end()
      report.cleanup.clientDisconnected = ended }
    if (loggedIn && rcon) { try { const online = await rcon.send('list', 5000); report.cleanup.actorOffline = /players online/i.test(online) && !online.includes(QA) }
      catch { report.cleanup.actorOffline = false } }
    rcon?.close()
    // Owned synthetic input only; no production recording or another player's data.
    if (ID.test(id)) for (const path of [`${stateDir}/${id}.ready.json`, `${MIC}/inbox/${id}.wav`, `${MIC}/inbox/${id}.txt`,
      `${MIC}/outbox/${id}.json`, `${MIC}/.smoke/${id}.audio.json`]) await unlink(path).catch(() => {})
    if (lock) { try { await lock.close(); assert((await readJson(lockPath)).owner === owner, 'Shared smoke lock owner changed')
      await unlink(lockPath); report.cleanup.lockReleased = true } catch { report.cleanup.lockReleased = false } }
    report.cleanup.reservedFilesRestorationOwner = 'root orchestrator, after world stop'
    report.ok = !report.error && report.checks.every(row => row.ok === true) &&
      (customStaff ? STAFF_REQUIRED : REQUIRED).every(name => report.checks.some(row => row.name === name && row.ok)) &&
      (!customStaff || report.cleanup.staffReleased === true) &&
      report.cleanup.clientDisconnected === true && report.cleanup.actorOffline === true && report.cleanup.lockReleased === true
    report.finishedAt = new Date().toISOString()
  }
  return report
}

// Runs only inside the existing ASR container. It does not load another model:
// the existing watcher transcribes the WAV after publication into its own queue.
export const SYNTHESIZE = String.raw`
import io, json, os, re, sys, time, wave, hashlib, urllib.parse, urllib.request
from pathlib import Path
import numpy as np
job = sys.argv[1]
assert re.fullmatch(r'voiceqa-[0-9a-f-]{36}', job)
assert os.environ.get('VOICE_ALLOWED_PLAYERS') == 'QDGuildProbe'
assert os.environ.get('MIC_BASE') == '/godvoice/mic'
base = Path('/godvoice/mic'); stage = base/'.smoke'; stage.mkdir(exist_ok=True)
query = urllib.parse.urlencode({'text':'咏唱烟花术', 'voice':'goddess', 'format':'wav'})
with urllib.request.urlopen('http://host.docker.internal:8100/tts?'+query, timeout=80) as response:
    audio = response.read(8*1024*1024+1)
assert 0 < len(audio) <= 8*1024*1024
with wave.open(io.BytesIO(audio), 'rb') as source:
    channels, width, rate, frames = source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getnframes()
    assert width == 2 and channels in (1,2) and 0.45 <= frames/rate <= 30
    samples = np.frombuffer(source.readframes(frames), dtype='<i2').astype(np.float64).reshape(-1,channels).mean(axis=1)
if rate != 16000:
    count = int(round(len(samples)*16000/rate))
    samples = np.interp(np.arange(count)*rate/16000, np.arange(len(samples)), samples)
pcm = np.clip(np.rint(samples), -32768, 32767).astype('<i2').tobytes()
inbox = base/'inbox'; target = inbox/(job+'.wav'); temporary = inbox/(job+'.wav.tmp')
assert not target.exists() and not temporary.exists()
# Emulate a finite sequence of 20ms PCM chunks at real elapsed speed. These are
# synthetic producer timestamps, explicitly NOT an actual microphone capture.
with wave.open(str(temporary), 'wb') as output:
    output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
    recorded = None
    for offset in range(0,len(pcm),640):
        packet_at = int(time.time()*1000)
        if recorded is None: recorded = packet_at
        recording_ended = packet_at
        output.writeframesraw(pcm[offset:offset+640])
        if offset+640 < len(pcm): time.sleep(0.02)
emitted = int(time.time()*1000)
meta = {'schema':2, 'player':'QDGuildProbe', 'ts':recorded, 'recordingEndedAt':recording_ended, 'emittedAt':emitted, 'samples':len(pcm)//2}
manifest = {'schema':2, 'id':job, 'player':'QDGuildProbe', 'recordedAt':recorded, 'recordingEndedAt':recording_ended,
    'emittedAt':emitted, 'sampleRate':16000, 'channels':1,
    'sampleWidth':2, 'duration':len(pcm)/32000, 'sha256':hashlib.sha256(temporary.read_bytes()).hexdigest()}
meta_path = inbox/(job+'.txt'); meta_tmp = inbox/(job+'.txt.tmp')
meta_tmp.write_text(json.dumps(meta),encoding='utf-8'); meta_tmp.replace(meta_path)
temporary.replace(target)
output = stage/(job+'.audio.json'); tmp = stage/(job+'.audio.json.tmp')
tmp.write_text(json.dumps(manifest),encoding='utf-8'); tmp.replace(output)
print(json.dumps(manifest))
`

async function runHost() {
  const customStaff = process.argv[4] === '--staff'
  assert((process.argv.length === 4 || (process.argv.length === 5 && customStaff)) && process.argv[2] === '--execute' && process.argv[3] === 'qiandengji', 'Use --execute qiandengji [--staff] after the operator prepares the temporary fixtures')
  const self = fileURLToPath(import.meta.url), project = resolve(dirname(self), '..'), id = `voiceqa-${randomUUID()}`
  const sourceHashes = Object.fromEntries(await Promise.all(SOURCES.map(async path => [path, sha(await readFile(join(project, path)))])))
  const compose = ['compose', '--project-directory', project, '-f', join(project, 'compose.yml'), '-p', 'qiandengji']
  const options = { cwd: project, windowsHide: true, timeout: 175000, maxBuffer: 2*1024*1024 }
  assert((await readFile(join(project, 'server/world-data/.qiandengji-smoke'), 'utf8')).trim() === 'qiandengji', 'Missing D project marker')
  const container = (await exec('docker', [...compose, 'ps', '-q', 'world'], options)).stdout.trim()
  assert(/^[a-f0-9]{12,64}$/.test(container), 'Exactly one running world container required')
  const remote = `/tmp/${id}.mjs`; let completed = false, report, stdout = '', hostError
  await exec('docker', ['cp', self, `${container}:${remote}`], options)
  const running = exec('docker', [...compose, 'exec', '-T', '-e', 'SMOKE_EXECUTE=qiandengji', '-e', 'SMOKE_PROJECT=qiandengji',
    ...(customStaff ? ['-e', 'SMOKE_STAFF=1'] : []),
    'world', '/app/node_modules/.bin/tsx', remote, '--container', id], options)
    .then(result => { stdout = result.stdout; completed = true }, error => { stdout = error.stdout || ''; completed = true })
  try {
    const until = Date.now()+35000, ready = join(project, `server/world-data/voice-smoke/${id}.ready.json`)
    let value
    while (Date.now()<until && !completed) {
      try { value = await readJson(ready); break } catch (error) { if (error.code !== 'ENOENT') throw error }
      await sleep(100)
    }
    assert(value?.id === id && value.actor === QA, 'Voice QA did not become ready; no audio was submitted')
    await exec('docker', [...compose, 'exec', '-T', 'asr', 'python', '-c', SYNTHESIZE, id], { ...options, timeout: 95000 })
  } catch (error) { hostError = error?.code ? 'Host audio orchestration failed' : String(error.message).slice(0, 200) }
  finally { await running; await exec('docker', ['exec', container, 'node', '-e', "require('node:fs').unlinkSync(process.argv[1])", remote],
    { ...options, timeout:10000 }).catch(() => {}) }
  try { report = JSON.parse(stdout.trim()) } catch { report = { schema:1, project:'qiandengji', actor:QA, id, customStaff,
    startedAt:new Date().toISOString(), finishedAt:new Date().toISOString(), ok:false, checks:[], error:'Voice smoke returned no complete report' } }
  if (hostError) { report.hostError = hostError; report.ok = false }
  report.sourceHashes = sourceHashes
  await mkdir(join(project,'reports'), {recursive:true})
  await writeFile(join(project,'reports/voice-casting-smoke.json'), JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({ok:report.ok, report:'reports/voice-casting-smoke.json', checks:report.checks?.map(row=>({name:row.name,ok:row.ok}))}))
  if (!report.ok) process.exitCode=1
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
  const {default:a}=await import('node:assert/strict'), id='voiceqa-11111111-2222-3333-8444-555555555555'
  a.equal(ID.test(id),true)
  const good={id,actor:QA,kind:'command',verb:'cast',ok:true,skillId:'fireworks',at:1,manaLeft:95}
  a.equal(validReceipt(good,id),true)
  const sample={schema:2,id,player:QA,wav:`${id}.wav`,text:'用唱烟花束'}
  a.equal(ownSampleDiagnostic(sample,id).transcript,sample.text)
  a.equal(ownReceiptDiagnostic({...good,code:'unknown_chant',ok:false},id).code,'unknown_chant')
  a.equal(ownSampleDiagnostic({...sample,player:'MengMeng'},id),null)
  a.equal(ownSampleDiagnostic({...sample,id:'other'},id),null)
  a.equal(ownSampleDiagnostic({...sample,wav:'other.wav'},id),null)
  a.equal(ownSampleDiagnostic({...sample,text:'语'.repeat(300)},id).transcript.length,256)
  a.equal(ownReceiptDiagnostic({...good,actor:'MengMeng'},id),null)
  a.equal(ownSampleDiagnostic(sample,'unowned'),null)
  for (const changed of [{actor:'MengMeng'},{id:'different'},{kind:'claimed'},{ok:false},{verb:'status'},{skillId:'home'}])
    a.equal(validReceipt({...good,...changed},id),false)
  a.doesNotThrow(()=>validateFixture({level:1,learned:['fireworks'],mana:100}))
  a.throws(()=>validateFixture({level:0,learned:['fireworks'],mana:100}))
  a.throws(()=>validateFixture({level:1,learned:[],mana:100}))
  a.equal(new Set(REQUIRED).size,7)
  a.equal(new Set(STAFF_REQUIRED).size,9)
  a.equal(STAFF_REQUIRED.includes('voice:custom-staff-armed'),true)
  a.equal(SYNTHESIZE.includes("'player':'QDGuildProbe'"),true)
  const meta = {schema:2,player:QA,ts:1000,recordingEndedAt:2000,emittedAt:2100}
  const audio = {schema:2,id,recordedAt:1000,recordingEndedAt:2000,emittedAt:2100}
  const sampled = {schema:2,id,player:QA,recordedAt:1000,recordingEndedAt:2000,emittedAt:2100,ts:2200}
  a.doesNotThrow(()=>validateRecordingInterval(meta,audio,2200,sampled))
  for(const changed of [{schema:1},{recordingEndedAt:undefined},{recordingEndedAt:999},{emittedAt:1999}])
    a.throws(()=>validateRecordingInterval({...meta,...changed},audio,2200,sampled))
  a.throws(()=>validateRecordingInterval(meta,audio,121001,sampled))
  a.throws(()=>validateRecordingInterval(meta,audio,2200,{...sampled,recordingEndedAt:2001}))
  a.throws(()=>validateRecordingInterval(meta,audio,2200,{...sampled,schema:1}))
  return {ok:true,offlineAssertions:31 + testAudioWire(a) + await testAudioFixture(a),liveConnections:0}
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2]==='--self-test') console.log(JSON.stringify(await selfTest()))
  else if (process.argv[2]==='--container') { console.log=(...args)=>console.error(...args)
    const report=await runContainer(process.argv[3]); process.stdout.write(JSON.stringify(report)+'\n'); if(!report.ok)process.exitCode=1 }
  else await runHost()
}
