import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateTarget, readReplyTail } from './smoke_ai.mjs'

export const QA = 'QDCatalogProbe'
export const FEATURED = ['home', 'tp', 'give', 'blood_mana', 'spring', 'sky_walk', 'feather_boots', 'fireworks']
const ICONS = ['compass', 'ender_pearl', 'crafting_table', 'redstone', 'water_bucket', 'elytra', 'leather_boots', 'firework_rocket']
const DATA = '/app/data'
const DESTINATION = { dim: 'minecraft:overworld', x: -544, y: 65, z: 864 }
const assert = (value, text) => { if (!value) throw new Error(text) }
const sleep = ms => new Promise(done => setTimeout(done, ms))

export function itemText(item) {
  return JSON.stringify(item ? { name: item.name, displayName: item.displayName, customName: item.customName,
    nbt: item.nbt, components: item.components } : null)
}
export function locationReply(text, uuid) {
  const rows = String(text).split(/\r?\n/).filter(row => row.startsWith('QD_WARP_JSON '))
  assert(rows.length === 1, 'Missing or duplicate authoritative location envelope')
  const value = JSON.parse(rows[0].slice('QD_WARP_JSON '.length))
  assert(value.schema === 1 && value.action === 'location' && value.ok === true && value.actor === QA &&
    value.actorUuid === uuid && typeof value.dimension === 'string' && [value.x, value.y, value.z].every(Number.isFinite),
    'Wrong actor or invalid authoritative location')
  return value
}
export function nativeStatusReply(text, uuid) {
  const rows = String(text).split(/\r?\n/).filter(row => row.startsWith('QD_SPELL_JSON '))
  assert(rows.length === 1, 'Missing or duplicate native status envelope')
  const value = JSON.parse(rows[0].slice('QD_SPELL_JSON '.length))
  assert(value.schema === 1 && value.engine === 'irons_spellbooks' && value.action === 'status' && value.ok === true &&
    value.actor === QA && value.actorUuid === uuid && Number.isInteger(value.level), 'Wrong actor or invalid native XP status')
  return value
}
export function assertFixture(state, waypoints) {
  const me = state?.players?.[QA]
  assert(me && Array.isArray(me.learned) && FEATURED.every(id => me.learned.includes(id)) && me.learned.includes('heal'),
    'Fixture must retain all 8 featured skills plus archived heal on the reserved QA only')
  assert(Array.isArray(me.passives) && me.passives.length === 0, 'QA passives must be empty for isolated consumption evidence')
  assert(Number.isFinite(me.mana) && me.mana >= 20, 'QA legacy mana must be finite and at least 20; natural regeneration is allowed')
  const mine = waypoints?.players?.[QA]
  assert(waypoints?.shared?.length === 3 && Array.isArray(mine) && mine.length === 10, 'Fixture must have 3 existing shared + 10 QA personal points')
  assert(mine.every((w, i) => w.id === i + 1 && w.dim === DESTINATION.dim && w.x === DESTINATION.x && w.y === DESTINATION.y && w.z === DESTINATION.z),
    'Every QA personal point must have id 1..10 and the reviewed safe new-village destination')
  assert(new Set(mine.map(w => w.name)).size === 10, 'QA personal point names must be unique for receipt correlation')
  return { ninth: mine[5], privatePoints: mine }
}
async function boundedJson(path, limit = 2 * 1024 * 1024) {
  assert((await stat(path)).size <= limit, 'Input exceeds bounded JSON size')
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
}

/** Run only inside the isolated D-project world container, after root prepares backed-up QA fixtures. */
export async function runCompassSmoke(env = process.env) {
  const report = { project: 'qiandengji', actor: QA, startedAt: new Date().toISOString(), ok: false,
    checks: [], cleanup: {}, fixtureRestoration: 'Root must restore the backed-up QA progress/player files after this run.' }
  let rcon, bot, lock, timer, password = '', aborted, ownedProbe = false, loggedIn = false, uuid
  const privateReplies = []
  const rocketSpawns = []
  const safeError = error => String(error?.message || error).replaceAll(password || '\0', '[redacted]').slice(0, 400)
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details })
  const alive = () => { if (aborted) throw aborted }
  const interrupted = () => { aborted = new Error('Compass smoke interrupted') }
  async function command(text) { alive(); const result = await rcon.send(text, 7000); alive(); return result }
  async function poll(fn, message, ms = 12000) {
    const until = Date.now() + ms
    while (Date.now() < until) { alive(); const value = await fn(); if (value) return value; await sleep(100) }
    throw new Error(message)
  }
  function event(name, ms = 16000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => finish(new Error(`Mineflayer ${name} timeout`)), ms)
      const monitor = setInterval(() => { if (aborted) finish(aborted) }, 100)
      const success = value => finish(null, value)
      const end = () => finish(new Error(`Disconnected before ${name}`))
      function finish(error, value) {
        clearTimeout(timer); clearInterval(monitor)
        bot.removeListener(name, success); bot.removeListener('end', end)
        error ? fail(error) : done(value)
      }
      bot.once(name, success); bot.once('end', end)
    })
  }
  async function cli(text, id = randomUUID()) {
    assert(/^[0-9a-f-]{36}$/.test(id), 'Invalid immutable CLI request id')
    const slot = `${DATA}/skill-cli/requests/${id}`
    const resultPath = `${DATA}/skill-cli/results/${id}.json`
    // A completed claim lives under processing, not requests. Reusing a receipt
    // must not create a second action directory just because requests was moved.
    try {
      const cached = await boundedJson(resultPath, 128 * 1024)
      const prior = await boundedJson(`${DATA}/skill-cli/processing/${id}/request.json`, 16384)
      assert(prior.id === id && prior.actor === QA && prior.command === text, 'Refusing completed request-id collision')
      assert(cached.requestId === id && cached.actor === QA && typeof cached.ok === 'boolean', 'Cached CLI receipt actor/id mismatch')
      return cached
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    let existing = false
    try { await stat(slot); existing = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!existing) {
      await mkdir(`${DATA}/skill-cli/requests`, { recursive: true }); await mkdir(slot)
      const submittedAt = Date.now()
      await writeFile(`${slot}/request.tmp`, JSON.stringify({ id, actor: QA, command: text,
        submittedAt, expiresAt: submittedAt + 30000 }) + '\n', { encoding: 'utf8', flag: 'wx' })
      await rename(`${slot}/request.tmp`, `${slot}/request.json`)
    } else {
      const prior = await boundedJson(`${slot}/request.json`, 16384)
      assert(prior.id === id && prior.actor === QA && prior.command === text, 'Refusing immutable request-id collision')
    }
    const result = await poll(async () => {
      try { return await boundedJson(resultPath, 128 * 1024) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }, 'Correlated CLI receipt timed out; command was not resubmitted', 25000)
    assert(result.requestId === id && result.actor === QA && typeof result.ok === 'boolean', 'CLI receipt actor/id mismatch')
    return result
  }
  async function location() { return locationReply(await command(`qdlocation "${uuid}"`), uuid) }
  function click(slot, mode = 0) {
    // Custom menus may reject Mineflayer's predicted inventory transaction while
    // their authoritative container stays open. Postconditions below decide outcome.
    const pending = bot.clickWindow(slot, 0, mode)
    pending.catch(error => { report.inventoryPredictionDiagnostics ??= []; report.inventoryPredictionDiagnostics.push(safeError(error)) })
  }
  async function changedWindow(action, rows = 27) {
    const pending = event('windowOpen'); pending.catch(() => {})
    action()
    const window = await pending
    assert(window.inventoryStart === rows, `Expected ${rows} real display slots`)
    return window
  }
  async function openCompass() {
    if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(250) }
    const compass = await poll(() => bot.inventory.items().find(item => item.name === 'compass'),
      'Normal login/fixture did not provide a skillbox compass; no test-hook replacement used', 18000)
    await bot.equip(compass, 'hand')
    const tag = await command(`data get entity ${QA} SelectedItem.components."minecraft:custom_data"`)
    assert(/skillbox:\s*(?:1b|true)/.test(tag), 'Held compass lacks the real custom_data.skillbox flag')
    return changedWindow(() => bot.activateItem())
  }
  async function noRocketItem() {
    const out = await command(`data get entity ${QA} Inventory[{id:"minecraft:firework_rocket"}]`)
    assert(/Found no elements|No elements|Nothing found/i.test(out), 'A virtual firework icon may have escaped into the QA inventory')
  }
  async function usageSince(ms) {
    return (await readReplyTail(`${DATA}/skill-usage.jsonl`)).filter(r => r.player === QA && Date.parse(r.ts) >= ms)
  }
  try {
    const target = validateTarget(env)
    assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing isolated D-project marker')
    lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx')
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: report.startedAt, test: 'skill-compass', actor: QA }))
    timer = setTimeout(() => { aborted = new Error('Compass smoke total timeout') }, target.timeoutMs)
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
    const prepared = assertFixture(await boundedJson(`${DATA}/magic-state.json`), await boundedJson(`${DATA}/waypoints.json`))
    report.fixture = { learnedFeatured: 8, learnedArchived: 'heal', personalWaypoints: 10, targetRef: 'personal:6', globalIndex: 9 }
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim()
    assert(password, 'Empty isolated credential')
    const { Rcon } = await import('/app/src/rcon.ts')
    rcon = new Rcon('mc', 25575, password); await rcon.connect()
    const online = await command('list'); const registry = await command('numen_act list')
    assert(/players online/i.test(online) && /(?:^|\n)count=\d+/.test(registry), 'Cannot establish an authoritative QA absence check')
    assert(!online.includes(QA) && !registry.includes(QA), 'Reserved QA already online or registered as Numen; refusing takeover')
    const mineflayer = createRequire('/app/package.json')('mineflayer')
    bot = mineflayer.createBot({ host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline', hideErrors: true })
    ownedProbe = true
    bot.on('error', error => { aborted = error })
    bot.on('kicked', () => { aborted = new Error('Reserved compass QA was kicked') })
    bot.on('entitySpawn', entity => {
      if (entity.name === 'firework_rocket' && entity.position && bot.entity?.position && entity.position.distanceTo(bot.entity.position) <= 12)
        rocketSpawns.push({ at: Date.now(), entityId: entity.id })
    })
    await event('spawn', 25000); loggedIn = true
    uuid = bot.player?.uuid || bot._client?.uuid
    assert(/^[0-9a-f-]{36}$/i.test(uuid || ''), 'QA UUID unavailable')
    const { incomingWhisper } = await import('/app/src/incoming-whisper.ts')
    bot._client.on('playerChat', packet => {
      const incoming = incomingWhisper(packet, bot.players, bot.registry.chatFormattingById)
      if (incoming?.username === 'Goddess') privateReplies.push({ at: Date.now(), message: incoming.message })
    })
    await command(`gamemode survival ${QA}`)
    // Root backs up this reserved QA's player/progression data before the run.
    // The JSON legacy level alone does not set Minecraft XP. Synchronize actual
    // XP before comparing mana, because the first cast recalculates its cap.
    await command(`experience set ${QA} 50 levels`)
    await command(`effect give ${QA} minecraft:resistance 180 4 true`)
    await command(`effect give ${QA} minecraft:slow_falling 180 0 true`)
    await poll(() => bot.game.gameMode === 'survival', 'QA survival game mode did not synchronize')
    const actualXp = await poll(async () => {
      const value = nativeStatusReply(await command(`qdspell status "${uuid}"`), uuid)
      return value.level === 50 ? value : null
    }, 'Reserved QA actual Minecraft XP did not reach the prepared level 50')
    report.fixture.actualXpLevelConfirmed = actualXp.level
    assert(bot.players.Goddess, 'World companion must be online')
    check('compass:reserved-survival-login', { uuid, clientMods: false, actualXpLevel: actualXp.level })

    const status = await cli('status')
    assert(status.ok && Number.isFinite(status.mana) && status.mana >= 20, 'World in-memory QA mana must be finite and at least 20')
    assert(status.native?.level === 50, 'Unified status does not confirm actual QA XP level 50')
    const legacy = await cli('spells legacy')
    assert(legacy.ok && legacy.scope === 'legacy' && legacy.total === 8 && legacy.pages === 1 &&
      legacy.atoms?.length === 8 && FEATURED.every(id => legacy.atoms.some(a => a.id === id)), 'CLI did not expose exactly the 8 featured skills')
    const archivedIds = []
    for (let page = 1; page <= 6; page++) {
      const archive = await cli(`spells archive ${page}`)
      assert(archive.ok && archive.scope === 'archive' && archive.total === 64 && archive.pages === 6 && archive.page === page &&
        archive.atoms.every(a => a.catalog?.status === 'archived' && typeof a.catalog.reason === 'string'), 'CLI archive page shape/count mismatch')
      archivedIds.push(...archive.atoms.map(a => a.id))
    }
    assert(new Set(archivedIds).size === 64 && !archivedIds.some(id => FEATURED.includes(id)), 'CLI archive duplicates or mixes featured skills')
    check('catalog:featured-eight-archive-sixty-four', { featured: FEATURED, archiveCount: archivedIds.length, archivePages: 6 })

    let window = await openCompass()
    assert(window.slots[0]?.name === 'enchanted_book' && window.slots[8]?.name === 'ender_eye' && window.slots[20]?.name === 'bookshelf',
      'Compass permanent native/warp/archive entries are missing')
    const actualIcons = window.slots.slice(9, 17).map(item => item?.name)
    assert(JSON.stringify(actualIcons) === JSON.stringify(ICONS) && new Set(actualIcons).size === 8, 'Featured icons are not distinct or catalog-ordered')
    assert(FEATURED.every((id, i) => itemText(window.slots[9 + i]).includes(`技能：${id}`)), 'Displayed skill lore does not identify the expected 8 skills')
    check('compass:real-item-27-slots-and-distinct-icons', { openedBy: 'activateItem', displaySlots: window.inventoryStart, nativeSlot: 0, warpSlot: 8, icons: actualIcons })

    await noRocketItem()
    const menuId = window.id, beforeQuick = await cli('status'), quickAt = Date.now()
    click(16, 1) // Shift/QUICK_MOVE on fireworks must neither cast nor hand out the icon.
    await sleep(1100)
    assert(bot.currentWindow?.id === menuId, 'Shift click unexpectedly activated/closed the menu')
    await noRocketItem()
    const afterQuick = await cli('status')
    assert(afterQuick.mana >= beforeQuick.mana && rocketSpawns.every(r => r.at < quickAt), 'Shift click spent mana or spawned fireworks')
    check('compass:quick-move-cannot-take-or-cast', { authoritativeInventoryChecked: true })

    window = await changedWindow(() => click(20))
    assert(itemText(window.slots[9]).includes('heal') && itemText(window.slots[9]).includes('已归档'), 'Prepared archived heal is not visible')
    const archiveId = window.id, archiveAt = Date.now(), archiveBefore = await cli('status')
    click(9); await sleep(900); click(9, 1); await sleep(900)
    assert(bot.currentWindow?.id === archiveId, 'Archive entry behaved as an actionable spell')
    const denied = await cli('cast heal'), archiveAfter = await cli('status')
    assert(!denied.ok && denied.code === 'skill_archived', 'CLI accepted an archived skill')
    assert(archiveAfter.mana >= archiveBefore.mana && !(await usageSince(archiveAt)).some(r => r.atom === 'heal' && r.success),
      'Archive interaction consumed mana or produced a successful cast')
    check('catalog:archive-readonly-and-cast-rejected', { manaBefore: archiveBefore.mana, manaAfter: archiveAfter.mana, code: denied.code })

    window = await changedWindow(() => click(22))
    window = await changedWindow(() => click(0), 54)
    assert(JSON.stringify(window.title).includes('原生法术'), 'A different six-row container opened instead of the native spell menu')
    check('compass:native-entry-opens-54-slots', { openedBy: 'left-click-slot-0', displaySlots: window.inventoryStart, castsPerformed: 0 })
    bot.closeWindow(window); await sleep(300)
    window = await openCompass()
    window = await changedWindow(() => click(8))
    for (let i = 0; i < 10; i++) assert(itemText(window.slots[i + 3]).includes(prepared.privatePoints[i].name), `QA waypoint ${i + 1} missing from full 13-point panel`)
    assert(window.slots[8]?.name === 'red_bed' && itemText(window.slots[8]).includes(prepared.ninth.name), 'Ninth global point is not personal:6')
    check('compass:waypoint-thirteen-visible', { shared: 3, private: 10, ninthName: prepared.ninth.name })
    const warpAt = Date.now()
    click(8) // Global index 9, personal:6 only. Never click any original public location.
    const arrivalMessage = await poll(() => privateReplies.find(r => r.at >= warpAt && r.message.includes(`已抵达「${prepared.ninth.name}」`)),
      'Ninth waypoint menu click did not return its correlated arrival message', 16000)
    const arrived = await location()
    assert(arrived.dimension === DESTINATION.dim && Math.abs(arrived.x - DESTINATION.x) <= 3 &&
      Math.abs(arrived.y - DESTINATION.y) <= 5 && Math.abs(arrived.z - DESTINATION.z) <= 3, 'Authoritative QA waypoint destination mismatch')
    check('compass:ninth-point-click-arrival', { globalIndex: 9, expectedReference: 'personal:6',
      selectedNameConfirmed: true, receiptAt: arrivalMessage.at, actual: { dimension: arrived.dimension, x: arrived.x, y: arrived.y, z: arrived.z },
      originalSharedPointsClicked: false })

    const firstSlot = await cli('skillbar set 1 fireworks')
    const eighth = await cli('skillbar set 8 fireworks')
    assert(firstSlot.ok && eighth.ok && eighth.skillbar.filter(s => s.id === 'fireworks').length === 1 &&
      eighth.skillbar.some(s => s.id === 'fireworks' && s.slot === 8), 'Slot 8 move did not remove duplicate fireworks binding')
    check('catalog:slot-eight-move-and-deduplication')
    const beforeCast = await cli('status'), castAt = Date.now(), requestId = randomUUID()
    assert(beforeCast.native?.level === 50, 'QA actual XP level changed before the costed cast')
    const cast = await cli('cast 8', requestId)
    // Preserve the actual receipt even when a postcondition fails. Never retry a
    // successful or uncertain action merely because a diagnostic assertion fails.
    report.fireworksAttempt = { requestId, before: { mana: beforeCast.mana, maxMana: beforeCast.maxMana,
      level: beforeCast.level, nativeLevel: beforeCast.native?.level }, receipt: cast,
      rocketPacketsSeenAtReceipt: rocketSpawns.filter(r => r.at >= castAt).length }
    assert(cast.ok && cast.code === 'ok' && cast.skillId === 'fireworks' && cast.slot === 8 &&
      Number.isFinite(cast.manaLeft) && beforeCast.mana - cast.manaLeft >= 2 && beforeCast.mana - cast.manaLeft <= 5.1,
      'Featured slot-8 fireworks did not return a real costed success')
    await poll(() => new Set(rocketSpawns.filter(r => r.at >= castAt).map(r => r.entityId)).size >= 3,
      'Actual firework entity spawn packets were not observed near the QA', 6000)
    const repeated = await cli('cast fireworks')
    assert(!repeated.ok && repeated.code === 'cooldown', 'Fresh duplicate fireworks cast was not rejected by cooldown')
    const cached = await cli('cast 8', requestId)
    assert(JSON.stringify(cached) === JSON.stringify(cast), 'Same immutable request ID did not return its original receipt')
    const successes = (await usageSince(castAt)).filter(r => r.atom === 'fireworks' && r.success)
    assert(successes.length === 1, 'Fireworks were successfully executed more or less than once')
    check('catalog:featured-fireworks-effect-cost-and-no-replay', { requestId, manaBefore: beforeCast.mana, manaAfter: cast.manaLeft,
      observedRockets: new Set(rocketSpawns.filter(r => r.at >= castAt).map(r => r.entityId)).size, successfulLedgerEntries: successes.length, duplicateCode: repeated.code })
    report.ok = true
  } catch (error) { report.error = safeError(error) }
  finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    if (loggedIn && rcon) {
      try {
        if (!rcon.isConnected()) await rcon.connect(3000)
        if (bot?.currentWindow) bot.closeWindow(bot.currentWindow)
        await rcon.send(`qdspell cancel ${QA}`, 4000)
        await rcon.send(`effect clear ${QA} minecraft:resistance`, 4000)
        await rcon.send(`effect clear ${QA} minecraft:slow_falling`, 4000)
        report.cleanup.temporaryProtectionRemoved = true
      } catch (error) { report.cleanup.error = safeError(error); report.ok = false }
    }
    if (ownedProbe && bot) {
      bot.quit('Qiandeng compass smoke complete'); await sleep(250)
      if (!bot._client?.ended) bot._client?.end('QA cleanup')
      try {
        assert(rcon?.isConnected(), 'Cannot verify reserved QA logout')
        let present = true
        for (let i = 0; i < 10 && present; i++) {
          const text = await rcon.send('list', 3000)
          assert(/players online/i.test(text), 'Invalid authoritative logout response')
          present = text.includes(QA)
          if (present) await sleep(200)
        }
        assert(!present, 'Reserved QA did not log out')
        report.cleanup.probeDisconnected = true
      } catch (error) { report.cleanup.error = safeError(error); report.ok = false }
    }
    rcon?.close()
    if (lock) {
      try { await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`); report.cleanup.lockReleased = true }
      catch (error) { report.cleanup.lockError = safeError(error); report.ok = false }
    }
    report.finishedAt = new Date().toISOString()
  }
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log = (...args) => console.error(...args)
  const report = await runCompassSmoke()
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}
