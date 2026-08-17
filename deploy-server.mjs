#!/usr/bin/env node
// minecraft-ai-friend 服务器端一键部署。
//
// 部署层级（自底向上）：
//   1. Minecraft 原版服（java 21+，piston-meta 官方源下载 server.jar）
//   2. deepseek-harness 检出（世界进程的运行底座，@deepseek-ai/* 不在 npm 上）
//   3. 本仓库（世界进程 = 女神化身 + 唯一 RCON 持有者 + 魔法引擎 + 仪式）
//   4. 可选 --with-qwenpaw：QwenPaw + mc-god 天神 agent（慢路径神谕裁决）
//   5. 可选：讲述者 NPC sidecar（纯 stdlib python，零依赖）
//
// 用法（本仓库须位于 deepseek-harness 检出内，见 README）：
//   node deploy-server.mjs                       # 默认全量
//   node deploy-server.mjs --skip-mc             # 已有 MC 服务器，跳过下载
//   node deploy-server.mjs --with-qwenpaw        # 连天神 agent 一起装
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--yes' || a === '--skip-mc' || a === '--skip-install' || a === '--with-qwenpaw') opt[a.slice(2)] = true
  else if (a.startsWith('--')) opt[a.slice(2)] = args[++i]
}
const cfg = {
  mcVersion: opt['mc-version'] ?? '1.21.11',
  mcDir: path.resolve(here, opt['mc-dir'] ?? './mc-server'),
  mcPort: Number(opt['mc-port'] ?? 25565),
  rconPort: Number(opt['rcon-port'] ?? 25575),
  godName: opt['god-name'] ?? 'Goddess',
  serverJar: opt['server-jar'] ? path.resolve(opt['server-jar']) : null, // 本地 jar 免下载
}

const log = (s) => console.log(s)
const ok = (s) => console.log(`  ✓ ${s}`)
const die = (s) => { console.error(`✗ ${s}`); process.exit(1) }
const run = (cmd, cmdArgs, cwd, label, optional = false) => {
  log(`▶ ${label} ...`)
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    if (optional) { console.log(`  ⚠ ${label} 失败——继续，稍后可手动补`); return false }
    die(`${label} 失败（exit ${r.status}）`)
  }
  ok(label); return true
}

log('╔══════════════════════════════════════════════════╗')
log('║   minecraft-ai-friend 世界服务器部署              ║')
log('╚══════════════════════════════════════════════════╝')

// ---------- 1. 基础环境 ----------
const [maj] = process.versions.node.split('.').map(Number)
if (maj < 20) die(`需要 Node.js >= 20（当前 ${process.versions.node}）`)
ok(`Node ${process.versions.node}`)

// ---------- 2. 定位 harness（世界进程也跑在 dsh 上） ----------
// 注：Node 会把模块路径 realpath 化（junction/symlink 部署会解析回真实路径），
// 所以同时探测 cwd 链——只要用户 cd 进的是 harness 内的目录就能识别。
const isHarness = (p) => existsSync(path.join(p, 'vendor', 'cordis', 'package.json'))
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
let harness = null
const candidates = opt.harness ? [path.resolve(opt.harness)] : [path.resolve(process.cwd(), '..'), path.resolve(scriptDir, '..')]
for (const c of candidates) { if (isHarness(c)) { harness = c; break } }
if (!harness) {
  console.error('✗ 没找到 deepseek-harness。标准姿势：')
  console.error('    git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git')
  console.error('    cd deepseek-harness')
  console.error('    git clone https://github.com/jcs130/minecraft-ai-friend.git')
  console.error('    cd minecraft-ai-friend && node deploy-server.mjs')
  process.exit(1)
}
const base = path.dirname(process.cwd()) === harness || path.dirname(scriptDir) === harness
  ? process.cwd() : scriptDir
if (!existsSync(path.join(base, 'bootstrap-world.mts'))) die('本仓库必须直接位于 harness 目录内。')
ok(`harness: ${harness}`)

// ---------- 3. 依赖 ----------
if (!existsSync(path.join(here, 'node_modules')) && !opt['skip-install']) {
  if (!existsSync(path.join(harness, 'node_modules', '.bin'))) {
    run('npm', ['install', '--legacy-peer-deps'], harness, 'harness 依赖安装')
  } else ok('harness 依赖已就绪')
  run('npm', ['install', '--legacy-peer-deps'], here, '世界侧依赖安装')
} else if (existsSync(path.join(here, 'node_modules'))) {
  ok('世界侧依赖已就绪')
} else {
  console.log('  ⚠ --skip-install 且无 node_modules ——跳过依赖与 vendor 链接（自行负责）')
}
if (existsSync(path.join(here, 'node_modules'))) {
  run('node', ['setup-vendor-links.mjs'], here, '@deepseek-ai vendor 链接')
}

// ---------- 4. MC 服务器 ----------
let rconPassword = null
if (!opt['skip-mc']) {
  // java 检查（软性：没有 java 也能装好文件，只是起不了服）
  const jr = spawnSync('java', ['-version'], { shell: process.platform === 'win32', captureOutput: true })
  if (jr.status !== 0) console.log('  ⚠ 没检测到 java ——文件会装好，但开服需要 Java 21+')
  else ok('java 可用')

  mkdirSync(cfg.mcDir, { recursive: true })
  const jarPath = path.join(cfg.mcDir, 'server.jar')
  if (cfg.serverJar && existsSync(cfg.serverJar)) {
    spawnSync(process.platform === 'win32' ? 'copy' : 'cp',
      process.platform === 'win32' ? [cfg.serverJar + ',', jarPath] : [cfg.serverJar, jarPath], { shell: true })
    ok(`使用本地 server.jar：${cfg.serverJar}`)
  } else if (existsSync(jarPath)) {
    ok('server.jar 已存在，跳过下载')
  } else {
    log(`▶ 下载 Minecraft ${cfg.mcVersion} server.jar（Mojang 官方源，国内可能较慢）...`)
    try {
      const mf = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
        { signal: AbortSignal.timeout(20000) })).json()
      const v = mf.versions.find((x) => x.id === cfg.mcVersion)
      if (!v) die(`版本 ${cfg.mcVersion} 不在官方清单（可去 launchermeta 查可用版本号）`)
      const vj = await (await fetch(v.url, { signal: AbortSignal.timeout(20000) })).json()
      const dl = vj.downloads?.server
      if (!dl) die(`版本 ${cfg.mcVersion} 没有服务端下载（可能是客户端-only 版本）`)
      const buf = Buffer.from(await (await fetch(dl.url, { signal: AbortSignal.timeout(600000) })).arrayBuffer())
      const sha1 = createHash('sha1').update(buf).digest('hex')
      if (sha1 !== dl.sha1) die(`server.jar 校验失败（sha1 不符，请重试）`)
      writeFileSync(jarPath, buf)
      ok(`server.jar ${(dl.size / 1048576).toFixed(1)}MB（sha1 校验通过）`)
    } catch (e) {
      die(`下载失败：${e.message}\n  可用 --server-jar <本地jar路径> 指定已下载的文件后重跑`)
    }
  }
  // eula
  writeFileSync(path.join(cfg.mcDir, 'eula.txt'), 'eula=true\n', 'utf8')
  ok('eula.txt（已同意 EULA）')

  // rcon 密码
  rconPassword = randomBytes(16).toString('hex')
  const spPath = path.join(cfg.mcDir, 'server.properties')
  const props = {
    'server-port': String(cfg.mcPort),
    'online-mode': 'false',          // AI bot 用离线账号进服（正版服改 true 并给 bot 配账号）
    'enable-rcon': 'true',
    'rcon.port': String(cfg.rconPort),
    'rcon.password': rconPassword,
    'enable-command-block': 'true',  // 魔法引擎的命令方块演出需要
    'spawn-protection': '0',
    'view-distance': '10',
    'motd': '初始之地 · AI 穿越者与世界',
  }
  let lines = []
  if (existsSync(spPath)) {
    const old = readFileSync(spPath, 'utf8').split(/\r?\n/)
    const seen = new Set(Object.keys(props))
    for (const l of old) {
      const k = l.split('=')[0]
      if (props[k] !== undefined) { lines.push(`${k}=${props[k]}`); seen.delete(k) }
      else lines.push(l)
    }
    for (const k of seen) lines.push(`${k}=${props[k]}`)
  } else lines = Object.entries(props).map(([k, v]) => `${k}=${v}`)
  writeFileSync(spPath, lines.join('\n') + '\n', 'utf8')
  ok(`server.properties（rcon:${cfg.rconPort}，offline 模式，命令方块开）`)
} else {
  log('▶ --skip-mc：跳过 MC 服务器安装')
  const secretPath = path.join(here, 'data', 'rcon-secret.txt')
  if (existsSync(secretPath)) { rconPassword = '(沿用 data/rcon-secret.txt)'; ok('沿用现有 RCON 密码') }
}

// RCON 密码落 data/rcon-secret.txt（世界进程唯一读取处）
if (rconPassword && rconPassword !== '(沿用 data/rcon-secret.txt)') {
  mkdirSync(path.join(here, 'data'), { recursive: true })
  writeFileSync(path.join(here, 'data', 'rcon-secret.txt'), rconPassword + '\n', 'utf8')
  ok('data/rcon-secret.txt（世界进程读这里）')
}

// ---------- 5. 可选：QwenPaw + mc-god 天神 ----------
if (opt['with-qwenpaw']) {
  log('▶ QwenPaw 安装（天神慢路径裁决用）...')
  const py = process.platform === 'win32' ? 'python' : 'python3'
  const pr = spawnSync(py, ['--version'], { shell: true, captureOutput: true })
  if (pr.status !== 0) {
    console.log('  ⚠ 没有 python ——QwenPaw 装不了。手动方案见 https://qwenpaw.agentscope.io')
  } else {
    run(py, ['-m', 'pip', 'install', '--user', 'qwenpaw'], here, 'pip install qwenpaw', true)
    run('copaw', ['agents', 'create', '--name', 'MC Goddess', '--agent-id', 'mc-god'], here,
      '创建 mc-god agent（QwenPaw）', true)
    console.log('  ⚠ 别忘了给 mc-god 配模型和 API key（copaw 交互配置或控制台）——')
    console.log('    天神需要一个大模型端点（本地 vLLM / Ollama / 云端 API 均可）')
  }
}

// ---------- 6. 生成启动脚本（env 烤入） ----------
const relMc = path.relative(here, cfg.mcDir).replace(/\\/g, '/')
const envBat = [
  `set "MC_GOD_NAME=${cfg.godName}"`,
  `set "MC_LOG_PATH=${relMc}/logs/latest.log"`,
  `set "MC_ADVANCEMENTS_DIR=${relMc}/advancements"`,
  `set "MC_RCON_HOST=127.0.0.1"`,
  `set "MC_RCON_PORT=${cfg.rconPort}"`,
]
mkdirSync(path.join(here, 'data'), { recursive: true })
writeFileSync(path.join(here, 'start-world.bat'), [
  '@echo off',
  `rem 由 deploy-server.mjs 生成于 ${new Date().toISOString()}`,
  'rem 世界进程（女神化身，唯一 RCON 持有者）。必须跑在 MC 服务器同机。',
  'cd /d %~dp0',
  'setlocal',
  ...envBat,
  'echo ===== world boot %date% %time% ===== >> data\\world-process.log',
  '..\\node_modules\\.bin\\tsx.CMD bootstrap-world.mts >> data\\world-process.log 2>> data\\world-process.err.log',
  'endlocal',
].join('\r\n'), 'utf8')
writeFileSync(path.join(here, 'start-world.sh'), [
  '#!/bin/sh',
  `# 由 deploy-server.mjs 生成于 ${new Date().toISOString()}`,
  'cd "$(dirname "$0")"',
  `MC_GOD_NAME=${cfg.godName}; export MC_GOD_NAME`,
  `MC_LOG_PATH=${relMc}/logs/latest.log; export MC_LOG_PATH`,
  `MC_ADVANCEMENTS_DIR=${relMc}/advancements; export MC_ADVANCEMENTS_DIR`,
  `MC_RCON_HOST=127.0.0.1; export MC_RCON_HOST`,
  `MC_RCON_PORT=${cfg.rconPort}; export MC_RCON_PORT`,
  'mkdir -p data',
  'echo "===== world boot $(date) =====" >> data/world-process.log',
  '../node_modules/.bin/tsx bootstrap-world.mts >> data/world-process.log 2>> data/world-process.err.log',
].join('\n'), { mode: 0o755 })
writeFileSync(path.join(here, 'start-npc.bat'), [
  '@echo off',
  `rem 讲述者 NPC sidecar（纯 python 标准库）。由 deploy-server.mjs 生成。`,
  'cd /d %~dp0',
  `set "NPC_DATA_DIR=${path.relative(here, path.join(here, 'data')).replace(/\\/g, '/')}"`,
  `set "NPC_LOG_PATH=${relMc}/logs/latest.log"`,
  `set "MC_RCON_HOST=127.0.0.1"`,
  `set "MC_RCON_PORT=${cfg.rconPort}"`,
  `python sidecar\\mc_npc.py >> data\\mc-npc.log 2>> data\\mc-npc.err.log`,
].join('\r\n'), 'utf8')
ok('生成 start-world.bat/.sh + start-npc.bat')

// ---------- 7. runbook ----------
log('')
log('部署完成 🎉 开服顺序（顺序重要）：')
log(`  1. 首次开服：cd ${relMc} && java -Xmx4G -jar server.jar nogui`)
log('     （首次会生成世界然后自动退出一次属正常；再启一次即常驻）')
log('  2. 启动世界进程（女神）：.\\start-world.bat    # *nix: ./start-world.sh')
if (opt['with-qwenpaw']) log('  3. 确认 QwenPaw 在跑（copaw 服务 + mc-god 模型已配）')
log(`  4. （可选）讲述者 NPC：.\\start-npc.bat`)
log('  5. （可选）观察面板：.\\start-panel.bat → http://localhost:9090')
log('  6. 拉穿越者进场：在另一台机器（或本机）部署 jcs130/dsh-minecraft-agent')
log(`     node deploy.mjs --mc-host <本机IP> --mc-port ${cfg.mcPort} ...`)
log('')
log('⚠ 安全提醒：online-mode=false + rcon 仅限内网/白名单使用，不要暴露公网。')
