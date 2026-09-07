import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateTarget } from './smoke_ai.mjs'

export const QA = 'QDIronsProbe'
export const BODY = 'QDIronsBody'
const SPELL = 'irons_spellbooks:invisibility'
const EFFECT = 'irons_spellbooks:true_invisibility'
const DATA = '/app/data'

export function nativeReply(text, action, actor = QA) {
  const rows = String(text).split(/\r?\n/).filter(line => line.startsWith('QD_SPELL_JSON '))
  if (rows.length !== 1) throw new Error('Missing/duplicate native bridge envelope')
  const value = JSON.parse(rows[0].slice('QD_SPELL_JSON '.length))
  if (value.schema !== 1 || value.engine !== 'irons_spellbooks' || value.action !== action || value.actor !== actor || typeof value.ok !== 'boolean') {
    throw new Error('Native bridge actor/action/schema mismatch')
  }
  return value
}

// Reviewed against SpellContainer.CODEC in installed Iron's 1.21.1-3.16.3.
// These are QA fixtures, equipped through existing vanilla/Curios commands.
export function spellItem(item, wheel, mustEquip) {
  if (!['irons_spellbooks:gold_spell_book', 'irons_spellbooks:scroll'].includes(item)) throw new Error('Unreviewed fixture item')
  return `${item}[irons_spellbooks:spell_container={maxSpells:${item.endsWith(':gold_spell_book') ? 8 : 1},spellWheel:${wheel ? '1b' : '0b'},mustEquip:${mustEquip ? '1b' : '0b'},data:[{id:"${SPELL}",index:0,level:1}]}]`
}

export async function runNativeSmoke(env = process.env) {
  const report = { project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {} }
  let rcon, bot, lock, timer, password = '', aborted, bodyAttempted = false, loggedIn = false, ownedProbe = false
  const sleep = ms => new Promise(done => setTimeout(done, ms))
  const assert = (value, text) => { if (!value) throw new Error(text) }
  const alive = () => { if (aborted) throw aborted }
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details })
  const safeError = error => String(error?.message || error).replaceAll(password || '\0', '[redacted]').slice(0, 500)
  const interrupted = () => { aborted = new Error('Native smoke interrupted') }
  async function command(text) {
    alive()
    const response = await rcon.send(text, 7000)
    alive()
    return response
  }
  async function fixture(text) {
    const response = await command(text)
    // Login event commands can append their output to the shared server RCON sink.
    // Never retry a fixture just because unrelated text contains "Invalid". Every
    // fixture that matters below has a separate native state/effect postcondition.
    if (/Invalid chat component/i.test(response)) {
      report.commandOutputDiagnostics ??= { mixedLoginErrors: 0 }
      report.commandOutputDiagnostics.mixedLoginErrors++
    }
    return response
  }
  async function bridge(action, spell, actor = QA, target = actor) {
    return nativeReply(await command(`qdspell ${action} ${target}${spell ? ` ${spell}` : ''}`), action, actor)
  }
  async function poll(fn, message, ms = 14000) {
    const until = Date.now() + ms
    while (Date.now() < until) {
      alive()
      const value = await fn()
      if (value) return value
      await sleep(150)
    }
    throw new Error(message)
  }
  function waitEvent(event, ms = 18000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => finish(new Error(`Mineflayer ${event} timeout`)), ms)
      const abortPoll = setInterval(() => { if (aborted) finish(aborted) }, 100)
      const onEvent = value => finish(null, value)
      const onEnd = () => finish(new Error(`Disconnected before ${event}`))
      const onError = error => finish(error)
      function finish(error, value) {
        clearTimeout(timer); clearInterval(abortPoll)
        bot.removeListener(event, onEvent); bot.removeListener('end', onEnd); bot.removeListener('error', onError)
        error ? fail(error) : done(value)
      }
      bot.once(event, onEvent); bot.once('end', onEnd); bot.once('error', onError)
    })
  }
  try {
    const target = validateTarget(env)
    assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing isolated world marker')
    lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx')
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: report.startedAt, test: 'native-irons' }))
    timer = setTimeout(() => { aborted = new Error('Native smoke total timeout') }, target.timeoutMs)
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim()
    assert(password, 'Isolated RCON credential is empty')
    const { Rcon } = await import('/app/src/rcon.ts')
    rcon = new Rcon('mc', 25575, password)
    await rcon.connect()
    const online = await command('list')
    const numens = await command('numen_act list')
    assert(!online.includes(QA) && !numens.includes(BODY), 'Reserved QA already exists online; refusing takeover')
    const mineflayer = createRequire('/app/package.json')('mineflayer')
    bot = mineflayer.createBot({ host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline', hideErrors: true })
    ownedProbe = true
    bot.on('error', error => { aborted = error })
    bot.on('kicked', () => { aborted = new Error('Reserved native QA was kicked') })
    await waitEvent('spawn', 25000)
    loggedIn = true
    await fixture(`gamemode survival ${QA}`)
    await fixture(`effect give ${QA} minecraft:resistance 180 4 true`)
    await fixture(`effect give ${QA} minecraft:slow_falling 180 0 true`)
    await sleep(1000)
    assert(bot.game.gameMode === 'survival', 'QA must actually be in survival for resource evidence')
    check('native:survival-login', { actor: QA, clientMods: false })

    // Confirm the private player entry before spending resources. This observes a
    // genuine reply from the online Goddess profile, not an echoed outgoing command.
    const { incomingWhisper } = await import('/app/src/incoming-whisper.ts')
    let privateStatus = false
    const onPrivate = packet => {
      const incoming = incomingWhisper(packet, bot.players, bot.registry.chatFormattingById)
      if (incoming?.username === 'Goddess' && /^\[铁魔法\] Lv\./.test(incoming.message)) privateStatus = true
    }
    bot._client.on('playerChat', onPrivate)
    try {
      bot.whisper('Goddess', 'cli status')
      await poll(() => privateStatus, 'Read-only private CLI status did not return from Goddess', 8000)
    } finally { bot._client.removeListener('playerChat', onPrivate) }
    check('native:private-status-entry', { route: 'whisper:Goddess', verifiedSender: true })

    // Only this reserved QA's repeatable fixtures may be replaced. Real players are never touched.
    await fixture(`clear ${QA}`)
    await fixture(`curios replace spellbook 0 ${QA} with minecraft:air`)
    await bridge('cancel')
    await command(`effect clear ${QA} ${EFFECT}`)
    const empty = await bridge('list')
    assert(empty.ok && empty.spells.length === 0, 'QA native equipment was not empty')
    const denied = await bridge('cast', SPELL)
    assert(!denied.ok && denied.code === 'not_equipped', 'Unequipped native spell was not rejected')
    check('native:not-equipped-rejected')

    const book = spellItem('irons_spellbooks:gold_spell_book', true, true)
    await fixture(`curios replace spellbook 0 ${QA} with ${book}`)
    const list = await bridge('list')
    const equipped = list.spells.find(row => row.id === SPELL && row.source === 'spellbook')
    assert(equipped && equipped.mana > 0 && equipped.castTimeTicks >= 20, 'Real equipped book did not expose reviewed timed native spell')
    check('native:equipped-book-list', { spell: SPELL, mana: equipped.mana, castTimeTicks: equipped.castTimeTicks })
    await poll(async () => {
      const status = await bridge('status')
      const list = await bridge('list')
      return status.mana >= equipped.mana && list.spells.find(row => row.id === SPELL)?.cooldownMs === 0
    }, 'Native mana/cooldown did not recover naturally', 50000)
    const begun = await bridge('cast', SPELL)
    assert(begun.ok && begun.accepted && begun.casting.active, 'Native timed cast did not start')
    const duplicate = await bridge('cast', SPELL)
    assert(!duplicate.ok && duplicate.code === 'busy' && duplicate.casting.active, 'Duplicate cast cancelled/replayed the in-progress cast')
    const cancelled = await bridge('cancel')
    assert(cancelled.ok && cancelled.code === 'cancelled' && !cancelled.casting.active, 'Explicit native cancellation failed')
    assert(!(await command(`data get entity ${QA} active_effects`)).includes(EFFECT), 'Cancelled QA cast unexpectedly produced its effect')
    check('native:busy-and-cancel', { repeatedRequestDidNotCancel: true })

    const before = await bridge('status')
    const windowWait = waitEvent('windowOpen')
    windowWait.catch(() => {})
    const menu = await bridge('menu')
    assert(menu.ok && menu.code === 'menu_opened', 'Native menu command was rejected')
    const window = await windowWait
    assert(window.inventoryStart === 54 && window.slots[0]?.name === 'enchanted_book', 'Native six-row menu contents unavailable')
    check('native:menu-opened', { displaySlots: window.inventoryStart })
    // Actual vanilla click path, not a replacement RCON cast. Closing on selection can
    // finish before Mineflayer's predicted-inventory promise; observed server state wins.
    const click = bot.clickWindow(0, 0, 0)
    click.catch(() => {})
    const completed = await poll(async () => {
      const state = await bridge('status')
      const effects = await command(`data get entity ${QA} active_effects`)
      return !state.casting.active && effects.includes(EFFECT) ? state : null
    }, 'Menu selection did not produce real native invisibility')
    assert(completed.mana < before.mana - equipped.mana / 2, 'Native survival mana debit was not observed')
    const afterList = await bridge('list')
    const afterSpell = afterList.spells.find(row => row.id === SPELL)
    assert(afterSpell.cooldownMs > 0, 'Completed native book spell has no native cooldown')
    const cooldown = await bridge('cast', SPELL)
    assert(!cooldown.ok && cooldown.code === 'cooldown', 'Native cooldown did not prevent repeat cast')
    check('native:menu-cast-effect-mana-cooldown', { effect: EFFECT, manaBefore: before.mana, manaAfter: completed.mana,
      manaListed: equipped.mana, cooldownMs: afterSpell.cooldownMs })

    // Remove the book so ID selection genuinely resolves to the held native scroll.
    await fixture(`curios replace spellbook 0 ${QA} with minecraft:air`)
    await command(`effect clear ${QA} ${EFFECT}`)
    await fixture(`item replace entity ${QA} weapon.mainhand with ${spellItem('irons_spellbooks:scroll', false, false)} 1`)
    const scrollList = await bridge('list')
    const scroll = scrollList.spells.find(row => row.id === SPELL && row.source === 'scroll')
    assert(scroll && scroll.mana === 0 && scroll.cooldownMs === 0, 'Scroll should follow its native no-mana/no-book-cooldown rules')
    // The gold book grants max mana. Curios applies/removes attributes on tick;
    // removing it may legitimately clamp existing mana before any scroll is used.
    // Wait for that native cap transition, never add mana or change attributes.
    await sleep(250)
    const scrollBefore = await poll(async () => {
      const state = await bridge('status')
      return state.maxMana === empty.maxMana && state.mana <= state.maxMana ? state : null
    }, 'Native mana cap did not settle after removing the spellbook', 6000)
    assert(bot.players?.Goddess, 'World companion is not online for the actual player chant route')
    bot.whisper('Goddess', '咏唱：铁魔法：隐身术')
    const scrollDone = await poll(async () => {
      const state = await bridge('status')
      const effects = await command(`data get entity ${QA} active_effects`)
      const list = await bridge('list')
      return !state.casting.active && effects.includes(EFFECT) && list.spells.length === 0 ? state : null
    }, 'Scroll effect or actual scroll consumption not observed')
    assert(scrollDone.mana >= scrollBefore.mana - 0.01, 'Native scroll incorrectly consumed mana')
    check('native:player-chinese-chant', { route: 'whisper:Goddess', chant: '咏唱：铁魔法：隐身术', effectAndConsumption: true })
    check('native:scroll-effect-and-consumption', { effect: EFFECT, manaBefore: scrollBefore.mana, manaAfter: scrollDone.mana,
      maxManaAfterBookRemoval: scrollBefore.maxMana })

    const ownerUuid = bot.player?.uuid || bot._client?.uuid
    assert(/^[0-9a-f-]{36}$/i.test(ownerUuid || ''), 'Missing QA owner UUID')
    bodyAttempted = true
    const summon = await fixture(`numen_act summon ${ownerUuid} ${BODY}`)
    const bodyUuid = summon.match(new RegExp(`summoned=${BODY}\\|uuid=([0-9a-f-]{36})`, 'i'))?.[1]
    assert(bodyUuid, 'Reserved Numen creation was not confirmed')
    await fixture(`gamemode survival ${BODY}`)
    await fixture(`effect give ${bodyUuid} minecraft:resistance 120 4 true`)
    await fixture(`effect give ${bodyUuid} minecraft:slow_falling 120 0 true`)
    await fixture(`item replace entity ${bodyUuid} weapon.mainhand with ${spellItem('irons_spellbooks:scroll', false, false)} 1`)
    const bodyStatus = await bridge('status', null, BODY, bodyUuid)
    assert(bodyStatus.ok && bodyStatus.actorUuid === bodyUuid && bodyStatus.maxMana > 0, 'Numen native attributes unavailable')
    // Exercise the shipped world dispatcher, using the same immutable request
    // protocol as the external Python CLI/MCP. Never recreate a timed-out request.
    const requestId = randomUUID()
    const slot = `${DATA}/skill-cli/requests/${requestId}`
    await mkdir(`${DATA}/skill-cli/requests`, { recursive: true })
    await mkdir(slot)
    const submittedAt = Date.now()
    const payload = { id: requestId, actor: bodyUuid, command: `cast ${SPELL}`, submittedAt, expiresAt: submittedAt + 30000 }
    await writeFile(`${slot}/request.tmp`, JSON.stringify(payload) + '\n', { encoding: 'utf8', flag: 'wx' })
    await rename(`${slot}/request.tmp`, `${slot}/request.json`)
    const bodyStart = await poll(async () => {
      const path = `${DATA}/skill-cli/results/${requestId}.json`
      try {
        assert((await stat(path)).size <= 128 * 1024, 'CLI receipt exceeds bounded size')
        return JSON.parse(await readFile(path, 'utf8'))
      } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }, 'Agent CLI result remains pending; request was not repeated', 25000)
    assert(bodyStart.requestId === requestId && bodyStart.actorUuid === bodyUuid && bodyStart.actor === BODY &&
      bodyStart.ok && bodyStart.code === 'casting_started' && bodyStart.accepted,
      'Agent CLI did not return a correlated native acceptance receipt')
    check('native:agent-cli-receipt', { requestId, code: bodyStart.code, actorUuidMatched: true })
    await poll(async () => {
      const state = await bridge('status', null, BODY, bodyUuid)
      const effects = await command(`data get entity ${bodyUuid} active_effects`)
      const list = await bridge('list', null, BODY, bodyUuid)
      return !state.casting.active && effects.includes(EFFECT) && list.spells.length === 0
    }, 'Numen native ticking did not complete/consume the real scroll')
    check('native:numen-scroll-cast', { effect: EFFECT, uuidResolution: true })
    const progression = await bridge('progression')
    assert(progression.ok && Array.isArray(progression.categories), 'Native progression query unavailable')
    check('native:progression-read', { categoryCount: progression.categories.length })
    report.ok = true
  } catch (error) {
    report.error = safeError(error)
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    if (rcon) {
      try {
        if (!rcon.isConnected()) await rcon.connect(3000)
        if (bodyAttempted) {
          await rcon.send(`qdspell cancel ${BODY}`, 4000)
          const reply = await rcon.send(`numen_act dismiss ${BODY}`, 4000)
          report.cleanup.bodyDismissed = reply.includes(`dismissed=${BODY}`) || reply.includes(`no companion: ${BODY}`)
          assert(report.cleanup.bodyDismissed, 'Numen QA cleanup was not confirmed')
        }
        if (loggedIn) {
          await rcon.send(`qdspell cancel ${QA}`, 4000)
          await rcon.send(`curios replace spellbook 0 ${QA} with minecraft:air`, 4000)
          await rcon.send(`clear ${QA}`, 4000)
          await rcon.send(`effect clear ${QA}`, 4000)
          report.cleanup.qaFixtureCleared = true
        }
      } catch (error) { report.cleanup.error = safeError(error); report.ok = false }
    }
    if (ownedProbe && bot) {
      bot.quit('Qiandeng native spell smoke complete')
      await sleep(200)
      if (!bot._client?.ended) bot._client?.end('QA cleanup')
      try {
        if (!rcon?.isConnected()) throw new Error('Cannot verify QA logout')
        let online = true
        for (let i = 0; i < 8 && online; i++) {
          online = (await rcon.send('list', 3000)).includes(QA)
          if (online) await sleep(200)
        }
        report.cleanup.probeDisconnected = !online
        assert(!online, 'Reserved QA logout not confirmed')
      } catch (error) { report.cleanup.error = safeError(error); report.ok = false }
    }
    rcon?.close()
    if (lock) { await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`).catch(() => {}) }
    report.finishedAt = new Date().toISOString()
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log = (...args) => console.error(...args)
  const report = await runNativeSmoke()
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}
