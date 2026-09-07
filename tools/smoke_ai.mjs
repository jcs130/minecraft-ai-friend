import { appendFile, open, readFile, stat, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const QA_PROBE = 'QDSmokeProbe'
export const QA_BODY = 'QDSmokeBody'
const DATA = '/app/data'

export function validateTarget(env) {
  if (env.SMOKE_EXECUTE !== 'qiandengji' || env.SMOKE_PROJECT !== 'qiandengji') {
    throw new Error('Set SMOKE_EXECUTE=qiandengji and SMOKE_PROJECT=qiandengji for this isolated test')
  }
  if ((env.MC_HOST || 'mc') !== 'mc' || Number(env.MC_PORT || 25599) !== 25599 ||
      (env.MC_RCON_HOST || 'mc') !== 'mc' || Number(env.MC_RCON_PORT || 25575) !== 25575) {
    throw new Error('Only the qiandengji Compose service mc:25599 / mc:25575 is allowed')
  }
  if ((env.MC_DATA_DIR || DATA) !== DATA) throw new Error('Only the isolated /app/data mount is allowed')
  const timeoutMs = Number(env.SMOKE_TIMEOUT_MS || 90000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30000 || timeoutMs > 180000) {
    throw new Error('SMOKE_TIMEOUT_MS must be an integer between 30000 and 180000')
  }
  return { host: 'mc', port: 25599, rconPort: 25575, timeoutMs }
}

export function commandPresent(reply, command) {
  return typeof reply === 'string' && !/Unknown|Incorrect|No command|not found/i.test(reply) &&
    new RegExp(`\\b${command}\\b`).test(reply)
}

export function wheelTitle(title) {
  // 1.21 uses an NBT chat component where older protocols supplied JSON text.
  return typeof title === 'string' ? title : JSON.stringify(title ?? '')
}

export function featherReceipt(records, submittedAt) {
  return records.find((r) => r && r.speaker === QA_BODY && r.kind === 'chant' &&
    Number.isFinite(r.ts) && r.ts >= submittedAt && typeof r.reply === 'string' &&
    r.reply.includes('消耗魔力 8') && !/失败|未能|不足|此咒不成/.test(r.reply)) || null
}

// Bound both memory use and parsing; partial trailing writes are retried next poll.
export async function readReplyTail(path, maxBytes = 128 * 1024) {
  let file
  try {
    file = await open(path, 'r')
    const size = (await file.stat()).size
    const start = Math.max(0, size - maxBytes)
    const buffer = Buffer.alloc(Math.min(size, maxBytes))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const lines = text.split('\n')
    if (start > 0) lines.shift()
    lines.pop() // Writer's final incomplete line must not be treated as a receipt.
    return lines.flatMap((line) => {
      try { const r = JSON.parse(line); return r && typeof r === 'object' ? [r] : [] }
      catch { return [] }
    })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  } finally { await file?.close() }
}

export async function runSmoke(env = process.env) {
  const report = { project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {} }
  let rcon, bot, password = '', bodyCreationAttempted = false, lock, timer
  let aborted = null
  const abort = (reason) => { aborted = reason }
  const onSignal = () => abort(new Error('Smoke test interrupted'))
  const cleanError = (err) => String(err?.message || err).replaceAll(password || '\0', '[redacted]').slice(0, 400)
  const alive = () => { if (aborted) throw aborted }
  const delay = (ms) => new Promise((done) => setTimeout(done, ms))
  const check = (name, details = {}) => report.checks.push({ name, ok: true, ...details })
  async function boundedJson(path, maxBytes = 16 * 1024 * 1024) {
    if ((await stat(path)).size > maxBytes) throw new Error('Fixture metadata exceeds bounded read limit')
    return JSON.parse(await readFile(path, 'utf8'))
  }
  async function command(text) {
    alive()
    const result = await rcon.send(text, 7000)
    alive()
    return result
  }
  function waitBot(event, ms = 15000) {
    return new Promise((done, fail) => {
      const timeout = setTimeout(() => finish(new Error(`Mineflayer ${event} timeout`)), ms)
      const abortPoll = setInterval(() => { if (aborted) finish(aborted) }, 100)
      const onEvent = (value) => finish(null, value)
      const onError = (err) => finish(err)
      const onEnd = () => finish(new Error(`Mineflayer disconnected before ${event}`))
      function finish(err, value) {
        clearTimeout(timeout)
        clearInterval(abortPoll)
        bot.removeListener(event, onEvent)
        bot.removeListener('error', onError)
        bot.removeListener('end', onEnd)
        err ? fail(err) : done(value)
      }
      bot.once(event, onEvent)
      bot.once('error', onError)
      bot.once('end', onEnd)
    })
  }
  try {
    const target = validateTarget(env)
    if ((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() !== 'qiandengji') {
      throw new Error('Isolated world-data marker is missing or invalid')
    }
    // No concurrent smoke runs may take ownership of the reserved QA names.
    lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx')
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: report.startedAt }))
    timer = setTimeout(() => abort(new Error('Smoke test total timeout')), target.timeoutMs)
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    const state = await boundedJson(`${DATA}/magic-state.json`)
    const fixture = state.players?.[QA_BODY]
    if (!fixture?.learned?.includes('feather_fall') || fixture.mana < 10) {
      throw new Error('Prepare only the reserved QA fixture before starting world; never rewrite live player state')
    }
    const catalogue = await boundedJson(`${DATA}/magic-atoms.json`)
    const feather = (Array.isArray(catalogue) ? catalogue : catalogue.atoms).find((a) => a.id === 'feather_fall')
    if (feather?.type === 'passive' || feather?.cost?.mana !== 8 || !feather?.words?.[0] ||
        JSON.stringify(feather.commands) !== JSON.stringify(['effect give {target} minecraft:slow_falling 30 0 true'])) {
      throw new Error('Current feather_fall definition differs from the reviewed harmless QA effect')
    }
    password = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!password) throw new Error('Isolated RCON credential file is empty')
    const { Rcon } = await import('/app/src/rcon.ts')
    rcon = new Rcon(target.host, target.rconPort, password)
    await rcon.connect(6000)
    for (const name of ['numen_act', 'skillchest', 'fly']) {
      if (!commandPresent(await command(`help ${name}`), name)) throw new Error(`${name} command is unavailable`)
      check(`command:${name}`)
    }
    const list = await command('numen_act list')
    if (!/count=\d+/.test(list)) throw new Error('numen_act list did not return its expected protocol')
    if (list.includes(QA_BODY) || (await command('list')).includes(QA_PROBE)) {
      throw new Error('A reserved QA name is already online; refusing to replace or dismiss it')
    }

    const require = createRequire('/app/package.json')
    const mineflayer = require('mineflayer')
    bot = mineflayer.createBot({ host: target.host, port: target.port, username: QA_PROBE,
      version: '1.21.1', auth: 'offline', hideErrors: true, checkTimeoutInterval: 20000 })
    bot.on('error', (err) => abort(err))
    bot.on('kicked', () => abort(new Error('Mineflayer probe was kicked by the isolated server')))
    await waitBot('spawn', 25000)
    alive()
    const ownerUuid = bot.player?.uuid || bot._client?.uuid
    if (!/^[0-9a-f-]{36}$/i.test(ownerUuid || '')) throw new Error('Mineflayer login has no UUID')
    check('mineflayer:login', { username: QA_PROBE, clientMods: false, version: bot.version })
    const mode = await command(`gamemode creative ${QA_PROBE}`)
    if (/Unknown|Incorrect|No player|not found/i.test(mode)) throw new Error('Cannot set the QA probe game mode')
    // A real client opens a menu after completing its initial inventory/chunk sync.
    // Creative keeps this temporary client invulnerable while allowing interaction.
    await delay(1200)
    alive()

    const menuPackets = { opened: 0, contents: 0, closed: 0 }
    const onOpenPacket = () => { menuPackets.opened++ }
    const onItemsPacket = (packet) => { if (packet.windowId !== 0) menuPackets.contents++ }
    const onClosePacket = () => { menuPackets.closed++ }
    bot._client.on('open_window', onOpenPacket)
    bot._client.on('window_items', onItemsPacket)
    bot._client.on('close_window', onClosePacket)
    const windowPromise = waitBot('windowOpen')
    windowPromise.catch(() => {})
    let window
    try {
      const reply = await command(`skillchest wheel ${QA_PROBE}`)
      if (/Unknown|Incorrect|not found|不在线|只能|失败/.test(reply)) {
        throw new Error(`Skill wheel command rejected: ${reply.slice(0, 200)}`)
      }
      window = await windowPromise
    } catch (err) {
      report.menuDiagnostics = menuPackets
      throw err
    } finally {
      bot._client.removeListener('open_window', onOpenPacket)
      bot._client.removeListener('window_items', onItemsPacket)
      bot._client.removeListener('close_window', onClosePacket)
    }
    if (!window || !wheelTitle(window.title).includes('轮盘')) throw new Error('The skill wheel GUI did not open')
    check('skillchest:wheel', { slots: window.slots?.length || 0 })
    bot.closeWindow(window)

    bodyCreationAttempted = true
    const summoned = await command(`numen_act summon ${ownerUuid} ${QA_BODY}`)
    if (!summoned.includes(`summoned=${QA_BODY}|uuid=`)) throw new Error('QA Numen body was not confirmed created')
    await command(`gamemode spectator ${QA_BODY}`)
    await command(`experience set ${QA_BODY} 1 levels`)
    const self = JSON.parse(await command(`numen_act invoke ${QA_BODY} get_self_status {}`))
    if (self.name !== QA_BODY || !Number.isFinite(self.hp) || !Number.isFinite(self.position?.x)) {
      throw new Error('Numen get_self_status returned an invalid QA body result')
    }
    check('numen:get_self_status', { username: QA_BODY, hp: self.hp, gameMode: self.game_mode })
    if ((await command(`data get entity ${QA_BODY} active_effects`)).includes('minecraft:slow_falling')) {
      throw new Error('New QA body already has slow_falling; refusing to count an earlier effect')
    }

    const submittedAt = Date.now()
    await appendFile(`${DATA}/chant-requests.jsonl`, JSON.stringify({
      speaker: QA_BODY, text: feather.words[0], ts: submittedAt,
    }) + '\n', 'utf8')
    let receipt
    const receiptDeadline = Math.min(Date.now() + 35000, new Date(report.startedAt).getTime() + target.timeoutMs)
    while (Date.now() < receiptDeadline) {
      alive()
      const replies = await readReplyTail(`${DATA}/chant-reply.jsonl`)
      receipt = featherReceipt(replies, submittedAt)
      if (receipt) break
      const rejected = replies.find((r) => r.speaker === QA_BODY && r.kind === 'chant' && r.ts >= submittedAt)
      if (rejected) throw new Error(`QA chant was not successful: ${String(rejected.reply).slice(0, 180)}`)
      await delay(500)
    }
    if (!receipt) throw new Error('No successful QA feather_fall receipt within the timeout; request acceptance is not execution')
    check('magic:feather_fall', { speaker: QA_BODY, receivedAt: receipt.ts, manaCost: 8 })
    const effects = await command(`data get entity ${QA_BODY} active_effects`)
    if (!effects.includes('minecraft:slow_falling')) throw new Error('Successful receipt lacked a real slow_falling effect on the QA body')
    check('magic:slow_falling', { effect: 'minecraft:slow_falling', target: QA_BODY })
    const usage = (await readReplyTail(`${DATA}/skill-usage.jsonl`)).find((r) =>
      r.player === QA_BODY && r.atom === 'feather_fall' && Date.parse(r.ts) >= submittedAt && r.success === true && r.mana === 8)
    if (!usage) throw new Error('Successful QA effect lacked its normal mana-consumption ledger entry')
    check('magic:mana_usage', { mana: usage.mana, success: usage.success })
    report.ok = true
  } catch (err) {
    report.error = cleanError(err)
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    if (bodyCreationAttempted && rcon) {
      try {
        if (!rcon.isConnected()) await rcon.connect(3000)
        const result = await rcon.send(`numen_act dismiss ${QA_BODY}`, 5000)
        report.cleanup.bodyDismissed = result.includes(`dismissed=${QA_BODY}`) || result.includes(`no companion: ${QA_BODY}`)
        if (!report.cleanup.bodyDismissed) throw new Error('QA body dismissal was not confirmed')
      } catch (err) { report.cleanup.error = cleanError(err); report.ok = false }
    }
    if (bot) {
      try {
        bot.quit('Qiandengji smoke complete')
        await delay(150)
        if (!bot._client?.ended) bot._client?.end('Qiandengji smoke cleanup')
        if (!rcon?.isConnected()) throw new Error('Cannot verify probe logout without isolated RCON')
        let online = true
        for (let i = 0; i < 4 && online; i++) {
          online = (await rcon.send('list', 3000)).includes(QA_PROBE)
          if (online) await delay(250)
        }
        report.cleanup.probeDisconnected = !online
        if (online) throw new Error('QA probe logout was not confirmed')
      } catch (err) { report.cleanup.probeDisconnected = false; report.ok = false; report.cleanup.error = cleanError(err) }
    }
    rcon?.close()
    if (lock) { await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`).catch(() => {}) }
    report.finishedAt = new Date().toISOString()
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Keep dependency diagnostics separate from the machine-readable stdout report.
  console.log = (...args) => console.error(...args)
  const report = await runSmoke()
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}
