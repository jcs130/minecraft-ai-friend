/** Real player queries in the EXISTING D world container with its model endpoint disabled.
 * Does not start services, change environment, grant items, cast, teleport, or create Numen bodies.
 * Host: node tools/smoke_player_service.mjs --execute qiandengji
 * Offline: node tools/smoke_player_service.mjs --self-test
 */
import { readFile, open, unlink, mkdir, writeFile, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const QA = 'QDGuildProbe'
export const DEAD_URL = 'http://127.0.0.1:1/api/console/chat'
export const REQUIRED = ['model-endpoint-unreachable', 'legacy-myhelp-entry', 'player-status',
  'featured-skills', 'existing-compass-27-slots', 'native-spell-menu']
export const COMMANDS = ['/myhelp', '/mycli status --json', '/mycli spells legacy --json',
  '/mycli menu --json', '/mycli menu irons --json']
const DATA = '/app/data'
const LOCK = `${DATA}/.qiandengji-smoke.lock`
const assert = (ok, message) => { if (!ok) throw new Error(message) }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const execFile = promisify(execFileCallback)

export function validateEnvironment(env) {
  assert(env.SMOKE_EXECUTE === 'qiandengji' && env.SMOKE_PROJECT === 'qiandengji', 'Explicit D-project smoke authorization required')
  assert(env.MC_HOST === 'mc' && Number(env.MC_PORT) === 25599 && env.MC_RCON_HOST === 'mc' &&
    Number(env.MC_RCON_PORT) === 25575, 'Refusing a different Minecraft/RCON target')
  assert(env.QWENPAW_CONSOLE_URL === DEAD_URL, 'Actual world must use the exact disabled model endpoint')
}
export async function verifyModelUnavailable(env, fetcher = fetch) {
  validateEnvironment(env)
  let rejected = false
  try { await fetcher(DEAD_URL, { signal: AbortSignal.timeout(1500) }) } catch { rejected = true }
  assert(rejected, 'Disabled model endpoint unexpectedly returned an HTTP response')
  return { endpoint: DEAD_URL, fetchRejected: true, observedAt: new Date().toISOString() }
}
export function parseCli(message) {
  if (typeof message !== 'string' || !message.startsWith('[CLI] ') || message.length > 131072) return null
  try { const value = JSON.parse(message.slice(6)); return value && !Array.isArray(value) && typeof value.ok === 'boolean' ? value : null }
  catch { return null }
}
/** Keep the actual packet channel attached to the matched receipt; never infer it from size. */
export function matchCliReply(rows, accepts) {
  for (const row of rows) {
    const value = parseCli(row.message)
    if (value && accepts(value)) return { value, transport: row.transport, messageLength: row.message.length }
  }
  return null
}
export function statusEvidence(value, uuid) {
  const native = value?.native, progression = value?.progression
  assert(value?.ok === true && native?.ok === true && native.schema === 1 && native.engine === 'irons_spellbooks' &&
    native.action === 'status' && native.actor === QA && native.actorUuid === uuid && Number.isInteger(native.level) &&
    Number.isFinite(native.mana) && Number.isFinite(native.maxMana), 'Status lacks a correlated native actor/UUID receipt')
  assert(Number.isFinite(value.mana) && value.level === native.level, 'Legacy/native status values are invalid or inconsistent')
  assert(progression?.schema_version === 1 && progression.player === QA && progression.ok === true &&
    progression.source === 'puffish_skills_api' && Array.isArray(progression.categories) && progression.categories.length > 0,
  'Status lacks a successful native progression query')
  return { actor: native.actor, actorUuid: native.actorUuid, nativeLevel: native.level, nativeMana: native.mana,
    nativeMaxMana: native.maxMana, legacyMana: value.mana, progression: progression.categories.map(row => ({
      id: row.id, available: row.available, code: row.code, level: row.level, experience: row.experience,
      points_total: row.points_total, points_spent: row.points_spent, points_left: row.points_left })), receiptSha256: hash(value) }
}
export function featuredEvidence(value, catalog) {
  const expected = catalog?.featured
  assert(Array.isArray(expected) && expected.length > 0 && expected.length <= 12 && new Set(expected).size === expected.length,
    'Expected a bounded unique featured catalog')
  assert(value?.ok === true && value.scope === 'legacy' && value.pages === 1 && value.page === 1 &&
    value.total === expected.length && Array.isArray(value.atoms) && value.atoms.length === expected.length,
  'Featured CLI receipt count/page mismatch')
  const ids = value.atoms.map(atom => atom.id)
  assert(new Set(ids).size === expected.length && expected.every(id => ids.includes(id)) &&
    value.atoms.every(atom => atom.type !== 'passive' && atom.catalog?.status !== 'archived' && !catalog.archived?.[atom.id]),
  'Featured CLI receipt contains missing, duplicated, passive or archived skills')
  return { ids, count: ids.length, catalogSha256: hash(catalog), receiptSha256: hash(value) }
}
export function completeChecks(checks) {
  return REQUIRED.every(name => checks.filter(check => check.name === name && check.ok === true).length === 1)
}
export function allowedCommand(command) {
  assert(COMMANDS.includes(command), 'Smoke may only submit its fixed read/menu command allowlist')
  return command
}
async function jsonFile(path, limit = 2 * 1024 * 1024) {
  assert((await stat(path)).size <= limit, 'JSON prerequisite exceeds size bound')
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
}
function heartbeatEvidence(value, now = Date.now()) {
  const ageMs = now - value?.ts, commands = value?.playerCommands
  assert(Number.isFinite(ageMs) && ageMs >= -5000 && ageMs < 180000 && commands?.schema === 1 &&
    commands.ready === true && commands.queueEnabled === true && commands.modelRequired === false,
  'A fresh ready model-independent player-command heartbeat is required')
  return { ts: value.ts, ageMs, playerCommands: commands }
}

export async function runContainer(env = process.env) {
  const report = { schema: 1, project: 'qiandengji', actor: QA, startedAt: new Date().toISOString(), ok: false,
    scope: 'Live player help/status/catalog and actual menu packets during configured model failure; no casting or resource effects tested.',
    checks: [], commandsSent: [], cleanup: {}, limitations: ['No physical controller or rendered client UI checked.'] }
  const owner = randomUUID(), replies = []
  let lock, rcon, bot, password = '', timer, aborted, loggedIn = false, ended = false, failureStage = 'prerequisites'
  const safeError = error => String(error?.message || error).replaceAll(password || '\0', '[redacted]').slice(0, 350)
  const check = (name, details) => report.checks.push({ name, ok: true, ...details })
  const alive = () => { if (aborted) throw aborted }
  const interrupted = () => { aborted = new Error('Smoke interrupted') }
  async function poll(fn, failure, ms = 16000) {
    const end = Date.now() + ms
    while (Date.now() < end) { alive(); const value = await fn(); if (value) return value; await sleep(100) }
    throw new Error(failure)
  }
  async function readCommand(command) {
    assert(['list', 'numen_act list'].includes(command), 'RCON command is outside the read-only allowlist')
    alive(); const value = await rcon.send(command, 7000); alive(); return value
  }
  function event(name, ms = 20000) {
    return new Promise((done, fail) => {
      const timeout = setTimeout(() => finish(new Error(`Mineflayer ${name} timeout`)), ms)
      const monitor = setInterval(() => { if (aborted) finish(aborted) }, 100)
      const success = value => finish(null, value)
      const disconnect = () => finish(new Error(`Disconnected before ${name}`))
      function finish(error, value) {
        clearTimeout(timeout); clearInterval(monitor)
        bot.removeListener(name, success); bot.removeListener('end', disconnect)
        error ? fail(error) : done(value)
      }
      bot.once(name, success); bot.once('end', disconnect)
    })
  }
  function sendChat(command) {
    alive(); bot.chat(allowedCommand(command)); report.commandsSent.push({ command, at: new Date().toISOString() })
  }
  async function cli(command, accepts) {
    // Respect normal player input cadence and the existing bridge's throttles.
    await sleep(1500)
    const from = replies.length
    sendChat(command)
    return poll(() => matchCliReply(replies.slice(from), accepts),
      `No correlated private CLI receipt for ${command}`)
  }
  async function openMenu(command, slots, accepts) {
    if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(250) }
    const pending = event('windowOpen'); pending.catch(() => {})
    const receipt = cli(command, accepts)
    const [window, matched] = await Promise.all([pending, receipt])
    assert(window.inventoryStart === slots, `Expected ${slots} actual menu slots`)
    return { window, ...matched }
  }
  try {
    const before = await verifyModelUnavailable(env)
    assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing isolated D-project marker')
    report.prerequisites = { before, heartbeatBefore: heartbeatEvidence(await jsonFile(`${DATA}/world-heartbeat.json`)) }
    lock = await open(LOCK, 'wx')
    await lock.writeFile(JSON.stringify({ owner, pid: process.pid, actor: QA, test: 'player-service-offline', at: report.startedAt }))
    timer = setTimeout(() => { aborted = new Error('Player-service smoke total timeout') }, 100000)
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
    const catalog = await jsonFile(`${DATA}/skill-catalog.json`)
    const progress = await jsonFile(`${DATA}/magic-state.json`)
    assert(progress?.players?.[QA], 'Existing reserved QA progression is required; refusing a new fixture')
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim()
    assert(password, 'Empty isolated RCON credential')
    const { Rcon } = await import('/app/src/rcon.ts')
    rcon = new Rcon('mc', 25575, password); await rcon.connect()
    const online = await readCommand('list'), registry = await readCommand('numen_act list')
    assert(/players online/i.test(online) && /(?:^|\n)count=\d+/.test(registry), 'Authoritative QA absence check failed')
    assert(!online.includes(QA) && !registry.includes(QA), 'Reserved QA is already online/Numen; refusing takeover')
    const mineflayer = createRequire('/app/package.json')('mineflayer')
    const { incomingWhisper } = await import('/app/src/incoming-whisper.ts')
    const { incomingSystemWhisper } = await import('/app/src/cli-feedback.ts')
    bot = mineflayer.createBot({ host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline',
      hideErrors: true, checkTimeoutInterval: 20000 })
    bot.on('error', () => { aborted = new Error('Mineflayer connection error') })
    bot.on('kicked', () => { aborted = new Error('Reserved QA was kicked') })
    bot.on('end', () => { ended = true })
    // Accept only genuine private-message packets resolved to the live Goddess identity.
    bot._client.on('playerChat', packet => {
      const incoming = incomingWhisper(packet, bot.players, bot.registry.chatFormattingById)
      if (incoming?.username === 'Goddess' && replies.length < 200)
        replies.push({ at: Date.now(), message: incoming.message, transport: 'playerChat', messageLength: incoming.message.length })
    })
    bot._client.on('systemChat', packet => {
      const incoming = incomingSystemWhisper(packet, bot.players)
      if (incoming?.username === 'Goddess' && replies.length < 200)
        replies.push({ at: Date.now(), message: incoming.message, transport: 'systemChat', messageLength: incoming.message.length })
    })
    await event('spawn', 25000); loggedIn = true
    const uuid = bot.player?.uuid || bot._client?.uuid
    assert(/^[0-9a-f-]{36}$/i.test(uuid || ''), 'Reserved QA UUID is unavailable')
    assert(bot.players.Goddess, 'Existing world companion must be online')
    report.actorUuid = uuid

    failureStage = 'legacy-myhelp-entry'
    const from = replies.length
    sendChat('/myhelp')
    const help = await poll(() => {
      const lines = replies.slice(from).map(row => row.message)
      return lines.some(line => line.includes('【千灯纪 · 技能上手】')) &&
        lines.some(line => line.includes('/mycli status')) && lines.some(line => line.includes('详细用法')) ? lines : null
    }, 'Legacy /myhelp did not return the real deterministic overview')
    check(failureStage, { command: '/myhelp', sender: 'Goddess', privateMessage: true,
      header: help.find(line => line.includes('【千灯纪 · 技能上手】')), lines: help.length, receiptSha256: hash(help) })

    failureStage = 'player-status'
    const status = await cli('/mycli status --json', value => 'native' in value || value.action === 'status')
    check(failureStage, { ...statusEvidence(status.value, uuid), transport: status.transport, messageLength: status.messageLength })
    failureStage = 'featured-skills'
    const featured = await cli('/mycli spells legacy --json', value => value.scope === 'legacy')
    check(failureStage, { ...featuredEvidence(featured.value, catalog), transport: featured.transport, messageLength: featured.messageLength })
    failureStage = 'existing-compass-27-slots'
    const compass = await openMenu('/mycli menu --json', 27, value => ['menu_requested', 'menu_unavailable'].includes(value.code))
    assert(compass.value.ok === true && compass.window.slots[0]?.name === 'enchanted_book' &&
      compass.window.slots[8]?.name === 'ender_eye' && compass.window.slots[20]?.name === 'bookshelf',
    'Compass fixed native/waypoint/archive entries are missing')
    check(failureStage, { openedBy: '/mycli menu', displaySlots: 27,
      nativeSlot: 0, waypointSlot: 8, archiveSlot: 20, receiptSha256: hash(compass.value) })
    failureStage = 'native-spell-menu'
    const native = await openMenu('/mycli menu irons --json', 54, value => value.action === 'menu')
    assert(native.value.ok === true && native.value.actor === QA && native.value.actorUuid === uuid &&
      JSON.stringify(native.window.title).includes('原生法术'), 'Native menu actor or actual window title mismatch')
    check(failureStage, { openedBy: '/mycli menu irons', displaySlots: 54, actorUuid: uuid, receiptSha256: hash(native.value) })
    bot.closeWindow(native.window)
    failureStage = 'model-endpoint-unreachable'
    report.prerequisites.after = await verifyModelUnavailable(env)
    report.prerequisites.heartbeatAfter = heartbeatEvidence(await jsonFile(`${DATA}/world-heartbeat.json`))
    check(failureStage, { exactEndpointBeforeAndAfter: true, fetchRejectedBeforeAndAfter: true,
      modelRequired: false, actualExistingWorldProcess: true })
  } catch (error) {
    report.error = safeError(error)
    report.diagnostics = { privateReplyCount: replies.length,
      cliReplies: replies.filter(row => row.message.startsWith('[CLI] ')).map(row => ({
        length: row.message.length, prefix: row.message.slice(0, 240), parsed: !!parseCli(row.message) })).slice(-6) }
    report.checks.push({ name: failureStage, ok: false, error: report.error })
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    if (bot) {
      try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); bot.quit('Player service smoke complete') }
      catch { try { bot._client?.end() } catch {} }
      for (let i = 0; i < 20 && !ended; i++) await sleep(100)
      if (!ended) { try { bot._client?.end() } catch {} }
      report.cleanup.clientDisconnected = ended
    }
    if (loggedIn && rcon) {
      try {
        for (let i = 0; i < 6; i++) {
          const online = await rcon.send('list', 4000)
          if (/players online/i.test(online) && !online.includes(QA)) { report.cleanup.actorOffline = true; break }
          await sleep(300)
        }
        report.cleanup.actorOffline ??= false
      } catch { report.cleanup.actorOffline = false }
    }
    rcon?.close()
    if (lock) {
      try {
        await lock.close()
        assert((await jsonFile(LOCK, 8192)).owner === owner, 'Smoke lock ownership changed')
        await unlink(LOCK); report.cleanup.lockReleased = true
      } catch (error) { report.cleanup.lockReleased = false; report.cleanup.error = safeError(error) }
    }
    report.cleanup.castsPerformed = 0; report.cleanup.teleportsPerformed = 0
    report.cleanup.itemsGranted = 0; report.cleanup.numenBodiesCreated = 0
    report.ok = completeChecks(report.checks) && report.cleanup.clientDisconnected === true &&
      report.cleanup.actorOffline === true && report.cleanup.lockReleased === true
    report.finishedAt = new Date().toISOString()
  }
  return report
}

/** cp + exec only: never creates another world process or overrides its model environment. */
async function runHost() {
  assert(process.argv.length === 4 && process.argv[2] === '--execute' && process.argv[3] === 'qiandengji',
    'Use --execute qiandengji; deployment and model failure setup belong to the operator')
  const self = fileURLToPath(import.meta.url), project = resolve(dirname(self), '..')
  assert((await readFile(join(project, 'server/world-data/.qiandengji-smoke'), 'utf8')).trim() === 'qiandengji',
    'Missing host D-project smoke marker')
  const compose = ['compose', '--project-directory', project, '-f', join(project, 'compose.yml'), '-p', 'qiandengji']
  const options = { cwd: project, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 130000 }
  const { stdout: idText } = await execFile('docker', [...compose, 'ps', '-q', 'world'], options)
  const container = idText.trim()
  assert(/^[a-f0-9]{12,64}$/.test(container), 'Exactly one running world container is required')
  const remote = `/tmp/qiandengji-player-service-smoke-${randomUUID()}.mjs`
  let report
  try {
    await execFile('docker', ['cp', self, `${container}:${remote}`], options)
    let stdout = ''
    try {
      ({ stdout } = await execFile('docker', [...compose, 'exec', '-T', '-e', 'SMOKE_EXECUTE=qiandengji',
        '-e', 'SMOKE_PROJECT=qiandengji', 'world', '/app/node_modules/.bin/tsx', remote, '--container'], options))
    } catch (error) { stdout = error.stdout || '' }
    try { report = JSON.parse(stdout.trim()) }
    catch { report = { schema: 1, project: 'qiandengji', actor: QA, ok: false, checks: [],
      error: 'Existing world exec did not return a complete JSON report; inspect local runtime without publishing credentials.' } }
  } finally {
    // Delete only this invocation's copied /tmp script, never state or lock files.
    await execFile('docker', ['exec', container, 'node', '-e',
      "require('node:fs').unlinkSync(process.argv[1])", remote], { ...options, timeout: 10000 }).catch(() => {})
  }
  await mkdir(join(project, 'reports'), { recursive: true })
  await writeFile(join(project, 'reports/player-service-offline-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ok: report.ok, report: 'reports/player-service-offline-smoke.json',
    checks: report.checks?.map(check => ({ name: check.name, ok: check.ok })) }))
  if (!report.ok) process.exitCode = 1
}

export async function selfTest() {
  const { default: a } = await import('node:assert/strict')
  let count = 0
  const test = async fn => { await fn(); count++ }
  const env = { SMOKE_EXECUTE: 'qiandengji', SMOKE_PROJECT: 'qiandengji', MC_HOST: 'mc', MC_PORT: '25599',
    MC_RCON_HOST: 'mc', MC_RCON_PORT: '25575', QWENPAW_CONSOLE_URL: DEAD_URL }
  await test(() => a.doesNotThrow(() => validateEnvironment(env)))
  await test(() => { for (const [key, wrong] of Object.entries({ MC_HOST: 'shadow-mc', MC_PORT: '25700',
    MC_RCON_HOST: 'localhost', MC_RCON_PORT: '25577', QWENPAW_CONSOLE_URL: DEAD_URL + '/', SMOKE_PROJECT: '' }))
    a.throws(() => validateEnvironment({ ...env, [key]: wrong })) })
  await test(async () => a.equal((await verifyModelUnavailable(env, async () => { throw new Error('unreachable') })).fetchRejected, true))
  await test(() => a.rejects(() => verifyModelUnavailable(env, async () => ({ status: 503 }))))
  await test(() => { a.equal(parseCli('public [CLI] {"ok":true}'), null); a.equal(parseCli('[CLI] nope'), null)
    a.equal(parseCli('[CLI] {"ok":true}').ok, true) })
  await test(() => { const message = '[CLI] {"ok":true,"scope":"legacy"}'
    for (const transport of ['playerChat', 'systemChat']) {
      const matched = matchCliReply([{ message, transport }], value => value.scope === 'legacy')
      a.equal(matched.transport, transport); a.equal(matched.messageLength, message.length); a.equal(matched.value.ok, true)
    } })
  await test(() => { const message = `[CLI] ${JSON.stringify({ ok: true, native: { padding: 'x'.repeat(500) } })}`
    const matched = matchCliReply([{ message: '[CLI] malformed', transport: 'systemChat' },
      { message, transport: 'playerChat' }], value => 'native' in value)
    a.equal(matched.transport, 'playerChat'); a.equal(matched.messageLength, message.length)
    a.equal(matchCliReply([{ message, transport: 'systemChat' }], value => value.scope === 'legacy'), null)
  })
  const uuid = '11111111-2222-3333-8444-555555555555'
  const status = { ok: true, level: 4, mana: 10, native: { schema: 1, engine: 'irons_spellbooks', action: 'status',
    ok: true, actor: QA, actorUuid: uuid, level: 4, mana: 90, maxMana: 100 }, progression: {
    schema_version: 1, player: QA, ok: true, source: 'puffish_skills_api', categories: [{ id: 'puffish_skills:combat', level: null }] } }
  await test(() => a.equal(statusEvidence(status, uuid).nativeLevel, 4))
  await test(() => { a.throws(() => statusEvidence(status, 'wrong')); a.throws(() => statusEvidence({ ...status,
    native: { ...status.native, actor: 'Goddess' } }, uuid)) })
  const catalog = { featured: ['home', 'tp'], archived: { heal: {} } }
  const featured = { ok: true, scope: 'legacy', page: 1, pages: 1, total: 2, atoms: [{ id: 'home' }, { id: 'tp' }] }
  await test(() => a.equal(featuredEvidence(featured, catalog).count, 2))
  await test(() => { a.throws(() => featuredEvidence({ ...featured, atoms: [{ id: 'home' }, { id: 'heal' }] }, catalog))
    a.throws(() => featuredEvidence({ ...featured, atoms: [{ id: 'home' }, { id: 'home' }] }, catalog)) })
  await test(() => { a.equal(completeChecks(REQUIRED.map(name => ({ name, ok: true }))), true)
    a.equal(completeChecks(REQUIRED.slice(1).map(name => ({ name, ok: true }))), false) })
  await test(() => { COMMANDS.forEach(allowedCommand)
    for (const command of ['/mycli cast home', '/mycli goto shared:1', '/mycli bookget home', '/give @s stone'])
      a.throws(() => allowedCommand(command)) })
  await test(() => { const heartbeat = { ts: 1000, playerCommands: { schema: 1, ready: true, queueEnabled: true, modelRequired: false } }
    a.equal(heartbeatEvidence(heartbeat, 2000).ageMs, 1000); a.throws(() => heartbeatEvidence(heartbeat, 200000))
    a.throws(() => heartbeatEvidence({ ...heartbeat, playerCommands: { ...heartbeat.playerCommands, ready: false } }, 2000)) })
  return { ok: true, offlineTests: count, liveConnections: 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') console.log(JSON.stringify(await selfTest()))
  else if (process.argv[2] === '--container') {
    console.log = (...args) => console.error(...args)
    const report = await runContainer()
    process.stdout.write(JSON.stringify(report) + '\n')
    if (!report.ok) process.exitCode = 1
  } else await runHost()
}
