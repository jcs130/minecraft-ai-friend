import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { open, readFile, unlink, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { validateTarget } from './smoke_ai.mjs'

const execute = promisify(execFile)
const QA = 'QDGoddessProbe'
const QUESTION = '问：这是连通测试，只回复连接成功'
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

export function isGoddessReply(text, sender) {
  return sender === 'Goddess' && typeof text === 'string' && text.includes(QA) && text.includes('连接成功') &&
    !/欢迎|礼包|天赋仪式|祈愿已上达|稍候再问|神谕此刻紊乱/.test(text)
}

export function qwenTrace(logs) {
  const lines = String(logs).split('\n').filter((line) => line.includes(QA))
  const sessionPattern = /session=(mc:(?:chat:)?QDGoddessProbe)(?=\s|$)/
  const built = lines.filter((line) => sessionPattern.test(line) && line.includes('built agent'))
  const sessions = [...new Set(built.map((line) => line.match(sessionPattern)[1]))]
  const agents = [...new Set(built.flatMap((line) => line.match(/agent=(mc-herald|mc-god)\b/)?.[1] || []))]
  return { sessions, matchedBuild: built.length > 0,
    agents, toolsZero: built.length > 0 && built.every((line) => /tools=0\b/.test(line)),
    savedSession: lines.some((line) => line.includes('Saved session state') && sessions.some((session) =>
      line.includes(`${QA}_${session}.json`) || line.includes(`${QA}_${session.replaceAll(':', '--')}.json`))) }
}

async function containerSmoke() {
  const report = { project: 'qiandengji', player: QA, ok: false,
    startedAt: new Date().toISOString(), checks: [], cleanup: {} }
  let bot, rcon, lock, password = '', oldMode, aborted, timer
  const alive = () => { if (aborted) throw aborted }
  const clean = (err) => String(err?.message || err).replaceAll(password || '\0', '[redacted]').slice(0, 250)
  const command = async (text) => { alive(); const result = await rcon.send(text, 7000); alive(); return result }
  try {
    const target = validateTarget(process.env)
    if ((await readFile('/app/data/.qiandengji-smoke', 'utf8')).trim() !== 'qiandengji') throw new Error('Missing isolated fixture marker')
    lock = await open('/app/data/.qiandengji-smoke.lock', 'wx')
    await lock.writeFile(JSON.stringify({ player: QA, pid: process.pid, at: report.startedAt }))
    timer = setTimeout(() => { aborted = new Error('Goddess smoke total timeout') }, target.timeoutMs)
    password = (await readFile('/app/data/rcon-secret.txt', 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!password) throw new Error('Missing independent RCON secret')
    const { Rcon } = await import('/app/src/rcon.ts')
    rcon = new Rcon('mc', 25575, password)
    await rcon.connect(6000)
    const online = await command('list')
    if (online.includes(QA)) throw new Error('Reserved QA name is already online')
    if (!online.includes('Goddess')) throw new Error('World Goddess client is not online')
    const mineflayer = createRequire('/app/package.json')('mineflayer')
    bot = mineflayer.createBot({ host: 'mc', port: 25599, username: QA,
      version: '1.21.1', auth: 'offline', hideErrors: true, checkTimeoutInterval: 20000 })
    bot.on('error', (error) => { aborted = error })
    bot.on('kicked', () => { aborted = new Error('QA client was kicked') })
    const messages = []
    const recordMessage = (sender, text) => {
      if (messages.length > 150) messages.shift()
      messages.push({ at: Date.now(), sender, text: String(text) })
    }
    bot.on('chat', (sender, text) => recordMessage(sender, text))
    bot.on('whisper', (sender, text) => recordMessage(sender, text))
    await new Promise((done, fail) => {
      const timeout = setTimeout(() => finish(new Error('Mineflayer spawn timeout')), 25000)
      const spawn = () => finish(), error = (err) => finish(err), end = () => finish(new Error('Disconnected before spawn'))
      function finish(err) {
        clearTimeout(timeout); bot.removeListener('spawn', spawn); bot.removeListener('error', error); bot.removeListener('end', end)
        err ? fail(err) : done()
      }
      bot.once('spawn', spawn); bot.once('error', error); bot.once('end', end)
    })
    await delay(1500)
    report.checks.push({ name: 'mineflayer-login', ok: true, clientMods: false })
    const mode = (await command(`data get entity ${QA} playerGameType`)).match(/entity data: (\d+)/)
    if (!mode) throw new Error('Cannot preserve QA game mode')
    oldMode = Number(mode[1])
    await command(`gamemode creative ${QA}`)
    report.submittedAt = new Date().toISOString()
    bot.chat(QUESTION)
    const since = Date.parse(report.submittedAt)
    let reply
    const deadline = Date.now() + 150000
    while (Date.now() < deadline) {
      alive()
      reply = messages.find((m) => m.at >= since && isGoddessReply(m.text, m.sender))
      if (reply) break
      if (messages.some((m) => m.at >= since && m.sender === 'Goddess' && m.text.includes('神谕此刻紊乱'))) {
        throw new Error('World reported a goddess API failure')
      }
      await delay(250)
    }
    if (!reply) throw new Error('No actual Goddess connection-success reply; welcome and queued messages do not count')
    report.checks.push({ name: 'game-chat-goddess-reply', ok: true,
      sender: reply.sender, expectedPhrase: '连接成功', receivedAt: new Date(reply.at).toISOString(), replyCharacters: reply.text.length })
    report.ok = true
  } catch (error) { report.error = clean(error) }
  finally {
    clearTimeout(timer)
    if (oldMode !== undefined && rcon?.isConnected()) {
      try {
        await rcon.send(`gamemode ${['survival', 'creative', 'adventure', 'spectator'][oldMode]} ${QA}`, 5000)
        report.cleanup.gameModeRestored = true
      } catch (error) { report.ok = false; report.cleanup.error = clean(error) }
    }
    if (bot) { bot.quit('Qiandengji goddess smoke complete'); await delay(200); if (!bot._client?.ended) bot._client?.end() }
    if (rcon?.isConnected()) {
      try {
        let online = true
        for (let i = 0; i < 5 && online; i++) { online = (await rcon.send('list', 3000)).includes(QA); if (online) await delay(300) }
        report.cleanup.probeDisconnected = !online
        if (online) report.ok = false
      } catch (error) { report.ok = false; report.cleanup.error = clean(error) }
    }
    rcon?.close()
    if (lock) { await lock.close(); await unlink('/app/data/.qiandengji-smoke.lock').catch(() => {}) }
    report.finishedAt = new Date().toISOString()
  }
  return report
}

async function hostSmoke() {
  if (process.argv[2] !== '--execute' || process.argv[3] !== 'qiandengji') throw new Error('Use --execute qiandengji for the independent instance')
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const compose = ['compose', '--project-directory', project, '-f', join(project, 'compose.yml'), '-p', 'qiandengji']
  const args = [...compose, 'run', '--rm', '--no-deps', '-T', '--entrypoint', '/app/node_modules/.bin/tsx',
    '-v', `${join(project, 'tools')}:/checks:ro`, '-e', 'SMOKE_EXECUTE=qiandengji', '-e', 'SMOKE_PROJECT=qiandengji',
    '-e', 'SMOKE_TIMEOUT_MS=180000', 'world', '/checks/smoke_goddess.mjs', '--container']
  let output
  try { output = await execute('docker', args, { cwd: project, timeout: 205000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }) }
  catch (error) { if (!error.stdout) throw new Error('Independent smoke subprocess failed before producing a report'); output = error }
  const report = JSON.parse(output.stdout.trim())
  if (report.submittedAt) {
    const { stdout } = await execute('docker', [...compose, 'logs', '--no-color', '--since', report.submittedAt, 'qwenpaw'],
      { cwd: project, timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    report.qwenpawTrace = qwenTrace(stdout)
    if (!report.qwenpawTrace.matchedBuild || !report.qwenpawTrace.toolsZero || !report.qwenpawTrace.savedSession) report.ok = false
  }
  await mkdir(join(project, 'reports'), { recursive: true })
  await writeFile(join(project, 'reports', 'goddess-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log = (...args) => console.error(...args)
  const report = process.argv[2] === '--container' ? await containerSmoke() : await hostSmoke()
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}
