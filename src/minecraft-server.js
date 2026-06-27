'use strict'

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

class MinecraftServerManager {
  constructor({ logDir, logger }) {
    this.logDir = logDir
    this.logger = logger
    this.child = null
    this.startedAt = null
    this.startCommand = null
    this.lastConfig = null
    this.lastServerDir = null
    this.rconStatusCache = null
  }

  async snapshot(config) {
    this.rememberConfig(config)
    const tcpOpen = await testTcp(config.minecraftHost, config.minecraftPort)
    const processes = await listMinecraftProcesses(config.minecraftServerDir, config.minecraftPort)
    const owned = this.ownedRunning()
    const stdinReady = owned && Boolean(this.child.stdin)
    const rcon = await this.rconSnapshot(config)
    const commandChannel = stdinReady ? 'stdin' : rcon.ready ? 'rcon' : 'none'

    return {
      tcpOpen,
      processIds: processes.map(processInfo => processInfo.pid),
      ownedPid: owned ? this.child.pid : null,
      managed: owned,
      canSendCommand: stdinReady || rcon.ready,
      commandChannel,
      rcon,
      startedAt: this.startedAt,
      startCommand: this.startCommand ? this.startCommand.label : '',
      logPath: latestLogPath(config.minecraftServerDir)
    }
  }

  async start(config) {
    this.rememberConfig(config)
    if (this.ownedRunning()) {
      this.logger.info(`Minecraft server already managed by this app pid=${this.child.pid}`)
      return { ok: true, alreadyRunning: true, managed: true }
    }

    if (await testTcp(config.minecraftHost, config.minecraftPort)) {
      this.logger.info(`Minecraft server already responds at ${config.minecraftHost}:${config.minecraftPort}`)
      return { ok: true, alreadyRunning: true, managed: false }
    }

    const start = resolveStartCommand(config.minecraftServerDir)
    const out = fs.openSync(path.join(this.logDir, 'minecraft-server.out.log'), 'a')
    const err = fs.openSync(path.join(this.logDir, 'minecraft-server.err.log'), 'a')

    this.child = spawn(start.command, start.args, {
      cwd: config.minecraftServerDir,
      stdio: ['pipe', out, err],
      detached: true,
      windowsHide: true
    })
    this.child.unref()
    this.startedAt = new Date().toISOString()
    this.startCommand = start

    const child = this.child

    child.on('error', error => {
      this.logger.error(`Minecraft server process error: ${error.message}`)
    })
    child.on('close', code => {
      this.logger.info(`Minecraft server process exited pid=${child.pid} code=${code}`)
      if (this.child === child) {
        this.child = null
        this.startedAt = null
        this.startCommand = null
      }
    })

    this.logger.info(`Started Minecraft server pid=${this.child.pid} via ${start.label}`)
    return { ok: true, pid: this.child.pid, command: start.label }
  }

  async stop() {
    if (!this.ownedRunning()) {
      throw new Error('当前 Minecraft 服务端不是由本页面启动的，不能安全发送 stop。请先在原服务器控制台执行 stop，或停掉后从本页面启动。')
    }

    const pid = this.child.pid
    this.writeConsoleLine('stop')
    this.logger.info(`Sent Minecraft stop command pid=${pid}`)

    try {
      await waitForExit(this.child, 15000)
    } catch {
      this.logger.warn(`Minecraft server pid=${pid} did not exit within 15s after stop`)
    }

    return { ok: true, pid }
  }

  async restart(config) {
    if (this.ownedRunning()) {
      await this.stop()
    } else if (await testTcp(config.minecraftHost, config.minecraftPort)) {
      throw new Error('检测到已有外部 Minecraft 服务端在线。为避免误关进程，请先在原控制台 stop，之后再用本页面启动。')
    }
    return this.start(config)
  }

  async sendCommand(command, config = null) {
    const clean = sanitizeConsoleCommand(command)
    if (!clean) throw new Error('控制台命令不能为空')
    if (config) this.rememberConfig(config)

    if (this.ownedRunning() && this.child.stdin) {
      this.writeConsoleLine(clean)
      this.logger.info(`Sent Minecraft console command via stdin: ${clean}`)
      return { ok: true, command: clean, channel: 'stdin' }
    }

    const settings = readRconSettings(config || this.lastConfig || { minecraftServerDir: this.lastServerDir })
    if (!settings.enabled) {
      throw new Error('Minecraft 服务端不是控制台托管，且 RCON 未开启，不能发送控制台命令。')
    }
    if (!settings.password) {
      throw new Error('RCON 已开启但缺少 rcon.password，不能发送控制台命令。')
    }

    const response = await sendRconCommand(settings, clean)
    this.logger.info(`Sent Minecraft console command via RCON: ${clean}`)
    return { ok: true, command: clean, channel: 'rcon', response }
  }

  async queryPlayerPosition(playerName, configOrTimeout = null, timeoutMs = 4000) {
    const player = sanitizePlayerName(playerName)
    const config = configOrTimeout && typeof configOrTimeout === 'object' ? configOrTimeout : this.lastConfig
    const waitMs = typeof configOrTimeout === 'number' ? configOrTimeout : timeoutMs
    if (config) this.rememberConfig(config)
    const filePath = latestLogPath((config && config.minecraftServerDir) || this.lastServerDir)
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('未找到服务端日志，无法读取玩家坐标。')
    }

    const startOffset = fs.statSync(filePath).size
    const commandResult = await this.sendCommand(`data get entity ${player} Pos`, config)
    const parsedResponse = parseEntityPosition(commandResult.response || '', player)
    if (parsedResponse) return parsedResponse
    const started = Date.now()

    while (Date.now() - started < waitMs) {
      await delay(250)
      const appended = readLogFromOffset(filePath, startOffset)
      const parsed = parseEntityPosition(appended, player)
      if (parsed) return parsed
    }

    throw new Error(`没有读到玩家 ${player} 的坐标。确认玩家在线，并且控制台有 stdin 或 RCON 命令通道。`)
  }

  async rconSnapshot(config) {
    const settings = readRconSettings(config || this.lastConfig || { minecraftServerDir: this.lastServerDir })
    const key = settings.enabled + ':' + settings.host + ':' + settings.port + ':' + Boolean(settings.password)
    const now = Date.now()
    if (this.rconStatusCache && this.rconStatusCache.key === key && now - this.rconStatusCache.at < 15000) {
      return { ...this.rconStatusCache.value }
    }
    let value
    if (!settings.enabled) {
      value = { enabled: false, host: settings.host, port: settings.port, tcpOpen: false, ready: false }
    } else {
      const tcpOpen = await testTcp(settings.host, settings.port)
      value = {
        enabled: true,
        host: settings.host,
        port: settings.port,
        tcpOpen,
        ready: tcpOpen && Boolean(settings.password)
      }
    }
    this.rconStatusCache = { key, at: now, value }
    return { ...value }
  }

  rememberConfig(config) {
    if (!config) return
    this.lastConfig = { ...config }
    this.lastServerDir = config.minecraftServerDir || this.lastServerDir
  }

  writeConsoleLine(line) {
    if (!this.child || !this.child.stdin) throw new Error('Minecraft server stdin is not available')
    this.child.stdin.write(`${line}\n`)
  }

  ownedRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }
}

function resolveStartCommand(serverDir) {
  const dir = String(serverDir || '').trim()
  if (!dir) throw new Error('Minecraft server directory is not configured')
  if (!fs.existsSync(dir)) throw new Error(`Minecraft server directory not found: ${dir}`)

  const jar = findServerJar(dir)
  if (!jar) throw new Error(`No server jar found in ${dir}`)

  const command = findJavaCommand(dir)
  const memoryArgs = findMemoryArgs(dir)
  const noguiArg = findNoguiArg(dir)
  const derived = hasStartScript(dir) ? '（从启动脚本推断）' : ''
  return {
    command,
    args: [...memoryArgs, '-jar', jar, noguiArg],
    label: `${path.basename(command)} ${memoryArgs.join(' ')} -jar ${jar} ${noguiArg}${derived}`
  }
}

function findServerJar(serverDir) {
  const preferred = ['server.jar', 'paper.jar', 'fabric-server-launch.jar', 'forge.jar']
  for (const fileName of preferred) {
    if (fs.existsSync(path.join(serverDir, fileName))) return fileName
  }
  const jars = fs.readdirSync(serverDir).filter(fileName => fileName.toLowerCase().endsWith('.jar'))
  return jars[0] || ''
}

function findJavaCommand(serverDir) {
  const startBat = path.join(serverDir, 'start.bat')
  if (os.platform() === 'win32' && fs.existsSync(startBat)) {
    const raw = fs.readFileSync(startBat, 'utf8')
    const match = raw.match(/^\s*set\s+JAVA=(.+)$/im)
    if (match) return match[1].trim().replace(/^"|"$/g, '')
  }
  return 'java'
}

function findMemoryArgs(serverDir) {
  const script = readStartScript(serverDir)
  if (!script) return ['-Xms1G', '-Xmx2G']
  const args = []
  const xms = script.match(/-Xms\S+/i)
  const xmx = script.match(/-Xmx\S+/i)
  if (xms) args.push(xms[0])
  if (xmx) args.push(xmx[0])
  return args.length > 0 ? args : ['-Xms1G', '-Xmx2G']
}

function findNoguiArg(serverDir) {
  const script = readStartScript(serverDir)
  return script && script.includes('--nogui') ? '--nogui' : 'nogui'
}

function readStartScript(serverDir) {
  const filePath = os.platform() === 'win32' ? path.join(serverDir, 'start.bat') : path.join(serverDir, 'start.sh')
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

function hasStartScript(serverDir) {
  return fs.existsSync(path.join(serverDir, 'start.bat')) || fs.existsSync(path.join(serverDir, 'start.sh'))
}

function sanitizeConsoleCommand(command) {
  return String(command || '')
    .trim()
    .replace(/^\//, '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240)
}

function sanitizePlayerName(playerName) {
  const clean = String(playerName || '').trim()
  if (!/^[A-Za-z0-9_]{1,32}$/.test(clean)) {
    throw new Error('玩家名只能包含英文、数字和下划线。')
  }
  return clean
}

function readLogFromOffset(filePath, startOffset) {
  const buffer = fs.readFileSync(filePath)
  const offset = Math.max(0, Math.min(Number(startOffset) || 0, buffer.length))
  return buffer.subarray(offset).toString('utf8')
}

function parseEntityPosition(logText, playerName) {
  const marker = playerName + ' has the following entity data:'
  const lines = String(logText || '').split(/\r?\n/)
  let current = null
  for (const line of lines) {
    if (!line.includes(marker)) continue
    const match = line.match(/\[\s*([-+0-9.eE]+)d?,\s*([-+0-9.eE]+)d?,\s*([-+0-9.eE]+)d?\]/)
    if (match) current = match
  }
  if (!current) return null
  return {
    player: playerName,
    position: {
      x: Number(current[1]),
      y: Number(current[2]),
      z: Number(current[3])
    },
    line: current[0]
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function latestLogPath(serverDir) {
  const dir = String(serverDir || '').trim()
  return dir ? path.join(dir, 'logs', 'latest.log') : ''
}

function readLatestLog(serverDir, lineLimit = 160) {
  const filePath = latestLogPath(serverDir)
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: filePath, exists: false, lines: [] }
  }
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const limit = Math.max(20, Math.min(500, Number(lineLimit) || 160))
  return {
    path: filePath,
    exists: true,
    lines: lines.slice(-limit)
  }
}

async function listMinecraftProcesses(serverDir, port) {
  if (os.platform() === 'win32') return listWindowsMinecraftProcesses(serverDir, port)
  return listUnixMinecraftProcesses(serverDir, port)
}

async function listWindowsMinecraftProcesses(serverDir, port) {
  const portPid = await windowsPortPid(port)
  const dir = normalizeForMatch(serverDir)
  const query = [
    'Get-CimInstance Win32_Process',
    '| Where-Object { $_.CommandLine -and ($_.Name -match "java|cmd") }',
    '| Select-Object ProcessId,Name,CommandLine',
    '| ConvertTo-Json -Compress'
  ].join(' ')
  const result = await run('powershell.exe', ['-NoProfile', '-Command', query])
  const processes = parseProcessJson(result.stdout)
  const matched = processes.filter(processInfo => {
    if (portPid && processInfo.pid === portPid) return true
    const command = normalizeForMatch(processInfo.command)
    const looksLikeServer = command.includes('server.jar') ||
      command.includes('minecraft_server') ||
      command.includes('paper') ||
      command.includes('fabric-server') ||
      command.includes('forge')
    return looksLikeServer && (!dir || command.includes(dir) || command.includes('server.jar'))
  })
  if (portPid && !matched.some(processInfo => processInfo.pid === portPid)) {
    matched.unshift({ pid: portPid, name: 'port-listener', command: '' })
  }
  return matched
}

async function windowsPortPid(port) {
  const command = [
    `Get-NetTCPConnection -LocalPort ${Number(port) || 25565} -State Listen -ErrorAction SilentlyContinue`,
    '| Select-Object -First 1 -ExpandProperty OwningProcess'
  ].join(' ')
  const result = await run('powershell.exe', ['-NoProfile', '-Command', command])
  const pid = Number(String(result.stdout || '').trim())
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

async function listUnixMinecraftProcesses(serverDir, port) {
  const result = await run('ps', ['-axo', 'pid=,command='])
  if (result.code !== 0) return []
  const dir = normalizeForMatch(serverDir)
  return result.stdout.split(/\r?\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) return null
    return { pid: Number(match[1]), name: '', command: match[2] }
  }).filter(processInfo => {
    if (!processInfo) return false
    const command = normalizeForMatch(processInfo.command)
    return command.includes('java') &&
      (command.includes('server.jar') || command.includes('minecraft_server') || command.includes('paper') || command.includes('fabric') || command.includes('forge')) &&
      (!dir || command.includes(dir) || command.includes('server.jar'))
  })
}

function parseProcessJson(stdout) {
  if (!stdout || !stdout.trim()) return []
  try {
    const parsed = JSON.parse(stdout)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map(row => ({
      pid: Number(row.ProcessId),
      name: String(row.Name || ''),
      command: String(row.CommandLine || '')
    })).filter(row => Number.isFinite(row.pid))
  } catch {
    return []
  }
}

function testTcp(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port, timeout: 1200 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!child || child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout'))
    }, timeoutMs)
    const onClose = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('close', onClose)
    }
    child.on('close', onClose)
  })
}

function run(command, args, timeoutMs = 4000) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      resolve({ code: 1, stdout: '', stderr: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, stdout, stderr })
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function readRconSettings(config = {}) {
  const serverDir = String(config.minecraftServerDir || '').trim()
  const properties = readServerPropertiesFile(serverDir)
  const host = String(config.rconHost || properties['rcon.host'] || config.minecraftHost || '127.0.0.1').trim() || '127.0.0.1'
  const port = Number(config.rconPort || properties['rcon.port'] || 25575)
  const password = String(config.rconPassword || process.env.MINECRAFT_RCON_PASSWORD || properties['rcon.password'] || '').trim()
  return {
    enabled: String(properties['enable-rcon'] || '').toLowerCase() === 'true' || Boolean(config.rconEnabled),
    host,
    port: Number.isFinite(port) && port > 0 ? port : 25575,
    password
  }
}

function readServerPropertiesFile(serverDir) {
  const filePath = serverDir ? path.join(serverDir, 'server.properties') : ''
  if (!filePath || !fs.existsSync(filePath)) return {}
  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return values
}

function sendRconCommand(settings, command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: settings.host, port: settings.port, timeout: timeoutMs })
    const authId = randomPacketId()
    const commandId = authId + 1
    let buffer = Buffer.alloc(0)
    let authed = false
    const responses = []
    const timer = setTimeout(() => finish(new Error('RCON 请求超时')), timeoutMs)

    function finish(error, value) {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }

    socket.on('connect', () => sendRconPacket(socket, authId, 3, settings.password))
    socket.on('timeout', () => finish(new Error('RCON 连接超时')))
    socket.on('error', error => finish(new Error('RCON 连接失败：' + error.message)))
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0)
        if (length < 10) return finish(new Error('RCON 响应格式异常'))
        if (buffer.length < length + 4) return
        const packet = buffer.subarray(4, 4 + length)
        buffer = buffer.subarray(4 + length)
        const id = packet.readInt32LE(0)
        const body = packet.subarray(8, Math.max(8, packet.length - 2)).toString('utf8')
        if (id === -1) return finish(new Error('RCON 认证失败，请检查 rcon.password'))
        if (id === authId && !authed) {
          authed = true
          sendRconPacket(socket, commandId, 2, command)
          continue
        }
        if (id === commandId) {
          responses.push(body)
          return finish(null, responses.join(''))
        }
      }
    })
  })
}

function sendRconPacket(socket, id, type, body) {
  const payload = Buffer.from(String(body || ''), 'utf8')
  const length = 4 + 4 + payload.length + 2
  const packet = Buffer.alloc(4 + length)
  packet.writeInt32LE(length, 0)
  packet.writeInt32LE(id, 4)
  packet.writeInt32LE(type, 8)
  payload.copy(packet, 12)
  packet.writeInt16LE(0, 12 + payload.length)
  socket.write(packet)
}

function randomPacketId() {
  return Math.floor(100000 + Math.random() * 100000000)
}

function normalizeForMatch(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

module.exports = {
  MinecraftServerManager,
  readLatestLog,
  listMinecraftProcesses
}
