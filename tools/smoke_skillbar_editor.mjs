import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, open, unlink, rename, stat, readdir } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'
import { EventEmitter } from 'node:events'

// The exported extension can reuse smoke_compass.mjs's QA connection. The host
// --execute qiandengji entry supplies a dedicated existing QDGuildProbe session.
// Root owns its exact QA backup/restoration. Neither mode starts any service,
// writes a player file, teaches a skill or releases a spell.
export const QA = 'QDGuildProbe', QA_UUID = '93dcca88-6191-3436-abcb-029b8d2dd11d'
const DATA = '/app/data', exec = promisify(execCallback)
const sha = value => createHash('sha256').update(value).digest('hex')
export const REQUIRED = ['skillbar:compass-editor-eight-slots', 'skillbar:shift-cannot-edit',
  'skillbar:click-set-mirrored-and-unique', 'skillbar:click-clear-preserves-positions',
  'skillbar:click-auto-same-service', 'skillbar:editing-does-not-cast']
const textOf = item => JSON.stringify(item ? { name: item.name, displayName: item.displayName, customName: item.customName,
  lore: item.lore, nbt: item.nbt, components: item.components } : null)
const prefix = '[skillbar smoke] '
const sleep = ms => new Promise(done => setTimeout(done, ms))
const position = (bar, slot) => Array.isArray(bar) && typeof bar[slot - 1] === 'string' ? bar[slot - 1] : ''
const normalize = bar => Array.from({ length: 8 }, (_, index) => position(bar, index + 1))
const isEditor = window => window?.inventoryStart === 27 && JSON.stringify(window.title).includes('快捷栏')

/** Read bounded actual component strings, including JSON embedded in legacy NBT strings. */
export function itemLines(item) {
  const lines = [], seen = new Set(); let nodes = 0
  const walk = (value, depth = 0) => {
    if (++nodes > 1500 || depth > 14 || value == null) return
    if (typeof value === 'string') {
      if (value.length > 6000) return
      if (/^[\[{]/.test(value.trim())) {
        try { walk(JSON.parse(value), depth + 1); return } catch {}
      }
      for (const line of value.split(/\r?\n/)) { const clean = line.replace(/§[0-9a-fk-or]/gi, '').trim(); if (clean && !seen.has(clean)) { seen.add(clean); lines.push(clean) } }
    } else if (Array.isArray(value)) for (const child of value.slice(0, 100)) walk(child, depth + 1)
    else if (typeof value === 'object') for (const child of Object.values(value).slice(0, 100)) walk(child, depth + 1)
  }
  walk({ customName: item?.customName, lore: item?.lore, nbt: item?.nbt, components: item?.components })
  return lines
}
export const matchesSkill = (item, id) => itemLines(item).includes(`技能：${id}`)
export function windowDiagnostic(window) {
  return { windowId: window.id, title: JSON.stringify(window.title).slice(0, 400), inventoryStart: window.inventoryStart,
    receivedMenuItems: window.slots.slice(0, 27).filter(Boolean).length,
    entries: window.slots.slice(0, 27).map((item, slot) => ({ slot, name: item?.name ?? null,
      displayName: item?.displayName ?? null, lines: itemLines(item).slice(0, 24), raw: textOf(item).slice(0, 1800) })) }
}
/** currentWindow exists after the open packet, before window_items. Wait for Mineflayer's content-ready event. */
export function waitForWindowOpen(bot, action, alive = () => {}, timeoutMs = 12000) {
  return new Promise((resolveWindow, reject) => {
    const oldId = bot.currentWindow?.id
    const finish = (error, window) => { clearTimeout(timer); clearInterval(monitor); bot.removeListener('windowOpen', opened); bot.removeListener('end', ended); error ? reject(error) : resolveWindow(window) }
    const opened = window => { if (window?.id !== oldId) finish(null, window) }
    const ended = () => finish(new Error('QA disconnected before menu contents arrived'))
    const timer = setTimeout(() => finish(new Error('Actual menu content-ready event did not arrive')), timeoutMs)
    const monitor = setInterval(() => { try { alive() } catch (error) { finish(error) } }, 100)
    bot.on('windowOpen', opened); bot.once('end', ended)
    try { const pending = action(); if (pending?.catch) pending.catch(error => finish(error)) } catch (error) { finish(error) }
  })
}

export function editorFixture(state, catalog, atoms, actor) {
  assert(['QDCatalogProbe', 'QDGuildProbe'].includes(actor), prefix + 'only existing reserved QA profiles are allowed')
  const player = state?.players?.[actor]
  assert(player && Array.isArray(player.learned), prefix + 'existing QA magic profile is required')
  assert(Array.isArray(catalog?.featured) && Array.isArray(atoms?.atoms), prefix + 'catalog and definitions must be readable')
  const known = new Set([...player.learned, ...(typeof player.innateSkill === 'string' ? [player.innateSkill] : [])])
  const skills = [...new Set(catalog.featured)].filter(id => typeof id === 'string' && /^[a-z0-9_./-]{1,96}$/.test(id) &&
    known.has(id) && !Object.hasOwn(catalog.archived ?? {}, id) && atoms.atoms.some(atom => atom.id === id && atom.type !== 'passive'))
  assert(skills.length > 0, prefix + 'QA needs one already learned featured skill; this extension will not teach any')
  return { skills, selected: skills.find(id => id !== position(player.skillbar, 8)) ?? skills[0] }
}

export function assertFixtureMirror(source, mirror, actor) {
  const a = source?.players?.[actor], b = mirror?.players?.[actor]
  assert(a && b && Array.isArray(a.learned) && Array.isArray(b.learned), prefix + 'QA fixture requires its existing profile in both snapshots')
  assert.deepEqual([...new Set(b.learned)].sort(), [...new Set(a.learned)].sort(), prefix + 'QA fixture learned skills differ between source and MC mirror; the offline fixture owner must prepare both before gameplay')
  assert.equal(b.innateSkill ?? null, a.innateSkill ?? null, prefix + 'QA innate skill differs between source and MC mirror')
  assert.deepEqual(normalize(b.skillbar), normalize(a.skillbar), prefix + 'QA fixture slot positions differ between source and MC mirror')
  return true
}

/** Wire this into runCompassSmoke after login and before the costed cast.
 * Required callbacks are the existing smoke helpers plus bounded snapshot reads.
 * Root must back up and finally restore the exact QA magic profile/player files.
 */
export async function runSkillbarEditorChecks({ actor, bot, command, poll, changedWindow, click, cli,
  openCompass, readState, readMirror, catalog, atoms, usageSince, check, ownsLock, qaBackupReady, diagnostics = {} }) {
  assert(ownsLock === true && qaBackupReady === true, prefix + 'caller must own the shared QA lock and a restoration backup')
  assert(bot?.username === actor && bot.entity, prefix + 'caller must supply its already logged-in QA only')
  const before = await readState()
  const fixture = editorFixture(before, catalog, atoms, actor)
  const profileView = state => ({ learned: state?.players?.[actor]?.learned, innateSkill: state?.players?.[actor]?.innateSkill,
    skillbar: state?.players?.[actor]?.skillbar })
  const initialMirror = await readMirror()
  Object.assign(diagnostics, { selected: fixture.selected, expectedCandidateIds: fixture.skills, initialSource: profileView(before),
    initialMirror: profileView(initialMirror), fixtureOwner: 'offline QA orchestrator; this smoke never synchronizes snapshots', pages: [] })
  diagnostics.fixtureMirrorConsistent = assertFixtureMirror(before, initialMirror, actor)
  const startedAt = Date.now()
  const evidence = { actor, startedAt, selected: fixture.selected, castsRequested: 0,
    restoration: 'Caller restores its exact backed-up QA profile after logout; this helper never overwrites state files.' }
  const stateBar = state => state?.players?.[actor]?.skillbar
  const barReceipt = async () => {
    const reply = await cli('skillbar')
    assert(reply.ok === true && Array.isArray(reply.skillbar), prefix + 'authoritative CLI skillbar receipt unavailable')
    return reply.skillbar
  }
  const reopen = async () => {
    if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(200) }
    const opened = changedWindow(() => {
      Promise.resolve(command(`skillchest skillbar ${actor} 0`)).catch(error => { evidence.openError = String(error.message).slice(0, 160) })
    })
    const window = await opened
    assert(isEditor(window), prefix + 'named skillbar command did not open the actual editor')
    return window
  }
  // Read from the existing service first: the service alone initializes its
  // recommended bar. No duplicated Java or smoke persistence algorithm is used.
  await barReceipt()
  diagnostics.afterServiceRead = { source: profileView(await readState()), mirror: profileView(await readMirror()) }
  await openCompass()
  let window = await changedWindow(() => click(6))
  assert(isEditor(window), prefix + 'compass slot 6 did not open the eight-slot editor')
  for (let slot = 1; slot <= 8; slot++) assert(textOf(window.slots[slot + 8]).includes(`槽 ${slot}`), prefix + `slot ${slot} label missing`)
  assert(textOf(window.slots[20]).includes('恢复推荐排列'), prefix + 'recommendation action missing')
  check(REQUIRED[0], { openedBy: 'real-compass-left-click-slot-6', displaySlots: 27, editableSlots: 8 })

  const stableWindow = window.id, shiftBefore = normalize(stateBar(await readState()))
  click(16, 1) // Real SHIFT-click packet. Virtual icons and editor state must stay put.
  await sleep(450)
  assert(bot.currentWindow?.id === stableWindow, prefix + 'shift-click unexpectedly navigated or closed the editor')
  assert.deepEqual(normalize(stateBar(await readState())), shiftBefore, prefix + 'shift-click edited player bindings')
  check(REQUIRED[1], { mode: 1, containerUnchanged: true, bindingsUnchanged: true })

  window = await changedWindow(() => click(16)) // The eighth real slot, not an artificial click hook.
  assert(JSON.stringify(window.title).includes('快捷槽 8'), prefix + 'selected eighth slot context lost')
  diagnostics.pages.push(windowDiagnostic(window))
  let selectedIndex = window.slots.slice(0, 18).findIndex(item => matchesSkill(item, fixture.selected))
  // Current featured catalogue has eight entries; page explicitly for future larger catalogues.
  for (let page = 0; selectedIndex < 0 && page < Math.ceil(fixture.skills.length / 18); page++) {
    if (!textOf(window.slots[26]).includes('下一页')) {
      diagnostics.missingCandidate = { expectedId: fixture.selected, source: profileView(await readState()), mirror: profileView(await readMirror()),
        rawMatchedSlots: window.slots.slice(0, 18).flatMap((item, slot) => textOf(item).includes(`技能：${fixture.selected}`) ? [slot] : []),
        visibleCandidateLines: window.slots.slice(0, 18).flatMap(item => itemLines(item).filter(line => line.startsWith('技能：'))) }
      assert.fail(prefix + 'selected learned skill not present in content-ready choices; see editorDiagnostics for actual items and source/mirror')
    }
    window = await changedWindow(() => click(26))
    diagnostics.pages.push(windowDiagnostic(window))
    selectedIndex = window.slots.slice(0, 18).findIndex(item => matchesSkill(item, fixture.selected))
  }
  assert(selectedIndex >= 0, prefix + 'no real choice icon matched the selected canonical skill')
  click(selectedIndex)
  await poll(async () => {
    const state = stateBar(await readState()), mirror = stateBar(await readMirror())
    return position(state, 8) === fixture.selected && position(mirror, 8) === fixture.selected &&
      normalize(state).filter(id => id === fixture.selected).length === 1
  }, prefix + 'actual GUI set did not reach original skillbar field and its MC mirror', 15000)
  const set = await barReceipt()
  assert(set.filter(row => row.id === fixture.selected).length === 1 && set.some(row => row.slot === 8 && row.id === fixture.selected),
    prefix + 'CLI effective view does not agree with GUI assignment or has duplicate binding')
  check(REQUIRED[2], { slot: 8, skillId: fixture.selected, choiceIndex: selectedIndex,
    clickedRealWindow: true, originalField: 'players[actor].skillbar', mirrorMatches: true, receipt: set })

  await reopen(); window = await changedWindow(() => click(16))
  assert(textOf(window.slots[20]).includes('清空槽 8'), prefix + 'clear action references a different slot')
  const clearBefore = normalize(stateBar(await readState()))
  click(20)
  await poll(async () => {
    const state = normalize(stateBar(await readState())), mirror = normalize(stateBar(await readMirror()))
    return state[7] === '' && mirror[7] === '' && state.slice(0, 7).every((id, i) => id === clearBefore[i])
  }, prefix + 'GUI clear changed other positions or failed to clear slot 8', 15000)
  const clear = await barReceipt()
  assert(!clear.some(row => row.slot === 8), prefix + 'cleared slot still appears in authoritative CLI view')
  check(REQUIRED[3], { slot: 8, otherPositionsUnchanged: true, mirrorMatches: true, receipt: clear })

  await reopen(); click(20)
  const expected = fixture.skills.slice(0, 8)
  await poll(async () => {
    const state = normalize(stateBar(await readState())), mirror = normalize(stateBar(await readMirror()))
    return state.every((id, i) => id === (expected[i] ?? '')) && JSON.stringify(state) === JSON.stringify(mirror)
  }, prefix + 'GUI recommendation differs from existing learned-featured service order', 15000)
  const automatic = await barReceipt()
  assert.deepEqual(automatic.map(row => [row.slot, row.id]), expected.map((id, i) => [i + 1, id]), prefix + 'recommendation CLI does not match snapshot')
  check(REQUIRED[4], { slotCount: automatic.length, command: 'skillbar auto', mirrorMatches: true, receipt: automatic })
  // No clock/mana assertion: natural regeneration is legitimate. The cost/effect
  // ledger is the authoritative evidence that editing did not release a spell.
  const successes = (await usageSince(startedAt)).filter(row => row.player === actor && row.success === true)
  assert(successes.length === 0, prefix + 'editing unexpectedly generated a successful spell ledger entry')
  check(REQUIRED[5], { castsRequested: 0, successfulSkillUsageEntries: 0 })
  return { ...evidence, finishedAt: Date.now(), ok: true, checksAdded: REQUIRED.length }
}

export function allowedCommand(command) {
  assert(['list', 'numen_act list', `skillchest open ${QA} 0`, `skillchest skillbar ${QA} 0`].includes(command),
    prefix + 'RCON command outside menu-only reserved-QA scope')
  return command
}
async function boundedJson(path, max = 16 * 1024 * 1024) {
  assert((await stat(path)).size <= max, prefix + 'snapshot exceeded bounded JSON size')
  for (let attempt = 0; ; attempt++) {
    try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
    catch (error) { if (!(error instanceof SyntaxError) || attempt >= 2) throw error; await sleep(40) }
  }
}
export async function runContainer(env = process.env) {
  const report = { schema: 1, project: 'qiandengji', actor: QA, startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {},
    scope: 'Real vanilla container click packets edit only the existing QA skillbar; main compass opened by the read-only server command. No item grants, spells, teleport or hardware controller validation.' }
  let secret = '', rcon, bot, lock, ended = false, spawned = false, aborted, timer
  const owner = randomUUID(), lockPath = `${DATA}/.qiandengji-smoke.lock`
  const alive = () => { if (aborted) throw aborted }
  const stop = () => { aborted = new Error('Menu smoke interrupted') }
  const safe = error => String(error?.message || error).replaceAll(secret || '\0', '[redacted]').slice(0, 350)
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details })
  async function poll(fn, message, ms = 12000) {
    const until = Date.now() + ms
    while (Date.now() < until) { alive(); const value = await fn(); if (value) return value; await sleep(100) }
    throw new Error(message)
  }
  async function command(text) { alive(); return rcon.send(allowedCommand(text), 7000) }
  async function cli(text) {
    assert.equal(text, 'skillbar', prefix + 'queue is read-view only; all mutations must come from actual GUI clicks')
    const id = randomUUID(), slot = `${DATA}/skill-cli/requests/${id}`, submittedAt = Date.now()
    await mkdir(`${DATA}/skill-cli/requests`, { recursive: true }); await mkdir(slot)
    await writeFile(`${slot}/request.tmp`, JSON.stringify({ id, actor: QA, command: text, submittedAt, expiresAt: submittedAt + 30000 }) + '\n', { flag: 'wx' })
    await rename(`${slot}/request.tmp`, `${slot}/request.json`)
    const receipt = await poll(async () => {
      try { return await boundedJson(`${DATA}/skill-cli/results/${id}.json`, 128 * 1024) }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }, 'Correlated skillbar view receipt timed out; request was not repeated', 25000)
    assert(receipt.requestId === id && receipt.actor === QA && typeof receipt.ok === 'boolean', prefix + 'view receipt identity or immutable ID mismatch')
    return receipt
  }
  function click(slot, mode = 0) {
    alive()
    bot.clickWindow(slot, 0, mode).catch(error => {
      report.inventoryPredictionDiagnostics ??= []
      if (report.inventoryPredictionDiagnostics.length < 12) report.inventoryPredictionDiagnostics.push(safe(error))
    })
  }
  async function changedWindow(action) {
    const window = await waitForWindowOpen(bot, action, alive)
    assert.equal(window.inventoryStart, 27, prefix + 'expected real three-row menu')
    return window
  }
  async function openCompass() {
    if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(200) }
    return changedWindow(() => { command(`skillchest open ${QA} 0`).catch(error => { aborted = error }) })
  }
  async function usageSince(at) {
    let handle
    try {
      handle = await open(`${DATA}/skill-usage.jsonl`, 'r')
      const size = (await handle.stat()).size, start = Math.max(0, size - 256 * 1024), buffer = Buffer.alloc(size - start)
      await handle.read(buffer, 0, buffer.length, start)
      const lines = buffer.toString('utf8').split(/\r?\n/); if (start) lines.shift()
      return lines.filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
        .filter(row => row.player === QA && Date.parse(row.ts) >= at)
    } catch (error) { throw error }
    finally { await handle?.close() }
  }
  try {
    assert(env.SMOKE_EXECUTE === 'qiandengji' && env.SMOKE_PROJECT === 'qiandengji' && env.SMOKE_EDITOR_PREFLIGHT === 'healthy' && env.SMOKE_QA_UUID === QA_UUID,
      prefix + 'use verified host entry after root QA backup')
    assert(env.MC_HOST === 'mc' && env.MC_PORT === '25599' && env.MC_RCON_HOST === 'mc' && env.MC_RCON_PORT === '25575', prefix + 'wrong isolated target')
    assert.equal((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim(), 'qiandengji')
    const state = await boundedJson(`${DATA}/magic-state.json`), catalog = await boundedJson(`${DATA}/skill-catalog.json`), atoms = await boundedJson(`${DATA}/magic-atoms.json`)
    editorFixture(state, catalog, atoms, QA)
    lock = await open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ owner, actor: QA, test: 'skillbar-editor', at: report.startedAt }))
    timer = setTimeout(() => { aborted = new Error('Skillbar editor smoke exceeded 160 seconds') }, 160000)
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    secret = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim()
    assert(secret, prefix + 'isolated credential is missing')
    const { Rcon } = await import('/app/src/rcon.ts'); rcon = new Rcon('mc', 25575, secret); await rcon.connect()
    const online = await command('list'), registry = await command('numen_act list')
    assert(/players online/i.test(online) && /(?:^|\n)count=\d+/.test(registry) && !online.includes(QA) && !registry.includes(QA), prefix + 'cannot confirm reserved QA absence')
    bot = createRequire('/app/package.json')('mineflayer').createBot({ host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline', hideErrors: true })
    bot.on('spawn', () => { spawned = true }); bot.on('end', () => { ended = true })
    bot.on('error', () => { aborted = new Error('Existing QA connection error') }); bot.on('kicked', () => { aborted = new Error('Existing QA was kicked') })
    await poll(() => spawned && !ended, 'Reserved QA did not log in', 25000)
    assert.equal(bot.player?.uuid || bot._client?.uuid, QA_UUID, prefix + 'actual login does not match backed-up existing UUID')
    report.actorUuid = QA_UUID
    report.editorDiagnostics = {}
    report.editor = await runSkillbarEditorChecks({ actor: QA, bot, command, poll, changedWindow, click, cli, openCompass,
      readState: () => boundedJson(`${DATA}/magic-state.json`), readMirror: () => boundedJson('/mcdata/magic-state.json'),
      catalog, atoms, usageSince, check, ownsLock: true, qaBackupReady: true, diagnostics: report.editorDiagnostics })
  } catch (error) { report.error = safe(error) }
  finally {
    clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
    if (bot) {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
      bot.quit('Qiandeng skillbar editor smoke complete'); await sleep(300)
      if (!ended) bot._client?.end('QA cleanup')
      await sleep(150); report.cleanup.clientDisconnected = ended
    }
    if (bot && rcon) {
      try { for (let i = 0; i < 8; i++) {
        const online = await rcon.send('list', 4000)
        if (/players online/i.test(online) && !online.includes(QA)) { report.cleanup.actorOffline = true; break }
        await sleep(200)
      } } catch { report.cleanup.actorOffline = false }
    }
    rcon?.close()
    if (lock) { try { await lock.close(); assert.equal((await boundedJson(lockPath, 4096)).owner, owner); await unlink(lockPath); report.cleanup.lockReleased = true }
      catch { report.cleanup.lockReleased = false } }
    report.cleanup.savedPlayerFilesRestorationOwner = 'root orchestrator'
    report.cleanup.spellsRequested = 0; report.cleanup.numenBodiesCreated = 0
    report.ok = !report.error && report.checks.every(row => row.ok === true) && REQUIRED.every(name => report.checks.some(row => row.name === name && row.ok)) &&
      report.cleanup.actorOffline === true && report.cleanup.clientDisconnected === true && report.cleanup.lockReleased === true
    report.finishedAt = new Date().toISOString()
  }
  return report
}
async function runHost() {
  assert(process.argv.length === 4 && process.argv[2] === '--execute' && process.argv[3] === 'qiandengji', 'Use --execute qiandengji after root prepares the reserved QA backup')
  const self = fileURLToPath(import.meta.url), project = resolve(dirname(self), '..'), startedAt = new Date().toISOString()
  const compose = ['compose', '--project-directory', project, '-f', join(project, 'compose.yml'), '-p', 'qiandengji']
  const options = { cwd: project, windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 }
  let report, preflight, container, remote
  try {
    assert.equal(project.replaceAll('\\', '/').toLowerCase(), 'd:/projects/qiandengji', prefix + 'only the D project may be targeted')
    assert.equal((await readFile(join(project, 'server/world-data/.qiandengji-smoke'), 'utf8')).trim(), 'qiandengji')
    assert((await stat(join(project, `server/mc/shadow/playerdata/${QA_UUID}.dat`))).isFile(), prefix + 'existing QA native save is required')
    const backupRoot = join(project, 'runtime/backups')
    const backups = (await readdir(backupRoot)).filter(name => /^chanting-gameplay-\d{8}T\d{6}Z$/.test(name)).sort().reverse()
    assert(backups.length, prefix + 'root gameplay restoration backup is required')
    const backup = join(backupRoot, backups[0])
    assert((await stat(join(backup, `playerdata-${QA_UUID}.dat`))).isFile() &&
      (await boundedJson(join(backup, 'qa-magic.json'))).learned instanceof Array, prefix + 'QA native and magic backup incomplete')
    assert(Date.now() - (await stat(join(backup, 'qa-magic.json'))).mtimeMs < 30 * 60 * 1000, prefix + 'root QA backup is not from the current test window')
    const services = (await exec('docker', [...compose, 'config', '--services'], options)).stdout.trim().split(/\r?\n/)
    assert(services.includes('mc') && services.includes('world'), prefix + 'unexpected project service inventory')
    const rows = await Promise.all(services.map(async service => {
      const id = (await exec('docker', [...compose, 'ps', '--all', '-q', service], options)).stdout.trim()
      assert(/^[0-9a-f]{12,64}$/.test(id), prefix + 'missing or ambiguous project service')
      const format = '{{json .State.Status}}|{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}|{{json (index .Config.Labels "com.docker.compose.project")}}'
      const values = (await exec('docker', ['inspect', '--format', format, id], options)).stdout.trim().split('|').map(JSON.parse)
      assert(values[0] === 'running' && values[2] === 'qiandengji' && (values[1] === 'healthy' || (service === 'gate' && values[1] === null)), prefix + 'all D services must be running and healthy')
      return { service, container: id, state: values[0], health: values[1] ?? 'no-docker-healthcheck' }
    }))
    await new Promise((done, fail) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: 25701 })
      socket.setTimeout(2500, () => { socket.destroy(); fail(new Error('D gate TCP health timeout')) })
      socket.once('connect', () => { socket.destroy(); done() }); socket.once('error', () => fail(new Error('D gate TCP health failed')))
    })
    const build = await boundedJson(join(project, 'world/botgate-src/build-record.json'))
    const installedSha = sha(await readFile(join(project, 'server/mc/mods/botgate.jar')))
    assert.equal(installedSha, build.sha256, prefix + 'the current verified botgate build must be installed before testing')
    preflight = { checkedAt: new Date().toISOString(), services: rows, gateTcp25701: true, botgateSha256: installedSha,
      existingPlayerFile: true, backup: `runtime/backups/${backups[0]}` }
    container = rows.find(row => row.service === 'world').container; remote = `/tmp/skillbar-editor-smoke-${randomUUID()}.mjs`
    await exec('docker', ['cp', self, `${container}:${remote}`], options)
    let stdout
    try { ({ stdout } = await exec('docker', [...compose, 'exec', '-T', '-e', 'SMOKE_EXECUTE=qiandengji', '-e', 'SMOKE_PROJECT=qiandengji',
      '-e', 'SMOKE_EDITOR_PREFLIGHT=healthy', '-e', `SMOKE_QA_UUID=${QA_UUID}`, 'world', '/app/node_modules/.bin/tsx', remote, '--container'], options)) }
    catch (error) { stdout = error.stdout || '' }
    try { report = JSON.parse(stdout.trim()) } catch { throw new Error('Menu container returned no complete JSON report') }
  } catch (error) { report = { schema: 1, project: 'qiandengji', actor: QA, startedAt, finishedAt: new Date().toISOString(), ok: false,
    checks: [], cleanup: {}, error: error.code && error.code !== 'ERR_ASSERTION' ? 'Menu host preflight/exec failed' : String(error.message).slice(0, 350) } }
  finally { if (container && remote) await exec('docker', ['exec', container, 'node', '-e', "require('node:fs').unlinkSync(process.argv[1])", remote], { ...options, timeout: 10000 }).catch(() => {}) }
  report.preflight = preflight; report.sourceHashes = { 'tools/smoke_skillbar_editor.mjs': sha(await readFile(self)) }
  await mkdir(join(project, 'reports'), { recursive: true })
  await writeFile(join(project, 'reports/skillbar-editor-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ok: report.ok, report: 'reports/skillbar-editor-smoke.json', checks: report.checks.map(row => ({ name: row.name, ok: row.ok })) }))
  if (!report.ok) process.exitCode = 1
}

async function selfTest() {
  const data = { players: { QDGuildProbe: { learned: ['home', 'old', 'passive'], innateSkill: 'spring', skillbar: ['', '', '', '', '', '', '', 'home'] } } }
  const catalog = { featured: ['home', 'spring', 'passive', 'unlearned', 'home', 'old'], archived: { old: {} } }
  const atoms = { atoms: [{ id: 'home' }, { id: 'spring' }, { id: 'old' }, { id: 'passive', type: 'passive' }, { id: 'unlearned' }] }
  assert.deepEqual(editorFixture(data, catalog, atoms, 'QDGuildProbe'), { skills: ['home', 'spring'], selected: 'spring' })
  assert.throws(() => editorFixture(data, catalog, atoms, 'MengMeng'))
  assert.throws(() => editorFixture({ players: {} }, catalog, atoms, 'QDGuildProbe'))
  assert.throws(() => editorFixture(data, {}, atoms, 'QDGuildProbe'))
  assert.throws(() => editorFixture(data, { featured: ['unlearned'] }, atoms, 'QDGuildProbe'))
  assert.deepEqual(normalize(['home', '', 'spring']), ['home', '', 'spring', '', '', '', '', ''])
  assert.equal(REQUIRED.length, 6)
  assert.equal(allowedCommand(`skillchest skillbar ${QA} 0`), `skillchest skillbar ${QA} 0`)
  for (const invalid of ['give QDGuildProbe minecraft:compass', 'qdspell cast QDGuildProbe irons_spellbooks:firebolt',
    'skillchest skillbar MengMeng 0', 'skillchest skillbar QDGuildProbe 0\nsay bad']) assert.throws(() => allowedCommand(invalid))
  assert.equal(matchesSkill({ components: [{ type: 'lore', data: [{ text: '技能：home' }] }] }, 'home'), true)
  assert.equal(matchesSkill({ nbt: { value: { Lore: { type: 'list', value: { value: ['{"text":"技能：home"}'] } } } } }, 'home'), true)
  assert.equal(matchesSkill({ components: [{ text: '技能：home_extra' }] }, 'home'), false)
  assert.equal(assertFixtureMirror(data, structuredClone(data), 'QDGuildProbe'), true)
  const stale = structuredClone(data); stale.players.QDGuildProbe.learned = []
  assert.throws(() => assertFixtureMirror(data, stale, 'QDGuildProbe'), /learned skills differ/)
  assert.throws(() => assertFixtureMirror(data, { players: {} }, 'QDGuildProbe'), /both snapshots/)
  const shifted = structuredClone(data); shifted.players.QDGuildProbe.skillbar = ['home']
  assert.throws(() => assertFixtureMirror(data, shifted, 'QDGuildProbe'), /slot positions differ/)
  const fake = new EventEmitter(); fake.currentWindow = { id: 1 }
  const ready = await waitForWindowOpen(fake, () => { fake.currentWindow = { id: 2, slots: [] }
    setTimeout(() => { fake.currentWindow.slots = [{ name: 'compass' }]; fake.emit('windowOpen', fake.currentWindow) }, 20) }, () => {}, 1000)
  assert.equal(ready.slots[0].name, 'compass')
  assert.equal(fake.listenerCount('windowOpen'), 0)
  await assert.rejects(waitForWindowOpen(fake, () => fake.emit('end'), () => {}, 1000), /disconnected/)
  assert.equal(fake.listenerCount('end'), 0)
  console.log('skillbar editor smoke: 23 offline assertions passed; no game connection')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') await selfTest()
  else if (process.argv[2] === '--container') { console.log = (...args) => console.error(...args)
    const report = await runContainer(); process.stdout.write(JSON.stringify(report) + '\n'); if (!report.ok) process.exitCode = 1 }
  else await runHost()
}
