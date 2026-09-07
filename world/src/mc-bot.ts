import mineflayer from 'mineflayer'
import type { Bot } from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { plugin as toolPlugin } from 'mineflayer-tool'

/**
 * mc-bot —— 女神化身（Goddess）的 mineflayer 假玩家，世界进程唯一。
 *
 * 已脱 cordis 壳（2026-08-21）：不再 import @deepseek-ai/cordis，
 * 由 bootstrap-world.mts 显式 createBot() 装配；bot 实例会随断线重连
 * 变化，故对外暴露 getBot() getter（替代原 ctx.mcbot 可变引用），
 * 依赖方每次现取，不持有过期快照。
 */

export interface Config {
  host: string
  port: number
  username: string
  autoReconnect: boolean
  viewerEnabled: boolean
  viewerPort: number
  viewerFirstPerson: boolean
  /** 观察者模式：化身不自己走路（移动全由 RCON tp 驱动），关闭本地物理模拟。 */
  observer?: boolean
}

export interface BotHandle {
  /** 当前 bot 实例（断线重连会换新实例，务必每次现取）。 */
  getBot: () => Bot
  dispose: () => void
}

/**
 * An observer follows server teleports; it has no client-authored movement.
 * Mineflayer's physicsEnabled switch disables simulation, but its timer still
 * transmits movement packets. Keep teleport confirmations and the matching
 * position echo, while withholding idle/old local-position writes. This is a
 * client-side protocol policy; the server's movement validation stays intact.
 */
export function attachObserverMovementSync(bot: Bot, log: (message: string) => void): () => void {
  const client = (bot as any)._client
  const originalWrite = client.write
  const movementPackets = new Set(['position', 'position_look', 'look', 'flying'])
  let processingServerPosition = false
  let positionSequence = 0
  let pendingPositionEcho = false
  let suppressed = 0
  ;(bot as any).physicsEnabled = false

  const beginServerPosition = () => {
    processingServerPosition = true
    pendingPositionEcho = true
    const sequence = ++positionSequence
    // Also clear the guard if another packet listener throws before our tail.
    queueMicrotask(() => {
      if (sequence === positionSequence) processingServerPosition = false
    })
  }
  const endServerPosition = (packet: { teleportId?: number }) => {
    processingServerPosition = false
    const position = bot.entity?.position
    if (position) {
      log(`observer server position #${positionSequence} teleport=${packet.teleportId ?? 'legacy'} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`)
    }
    // Viewer WorldView follows 'move', while server corrections emit forcedMove.
    // Mirror after Mineflayer has applied the packet, without changing position.
    try { bot.emit('move') } catch { /* viewer may be closing */ }
  }
  client.write = function (name: string, packet: any, ...rest: any[]) {
    if (movementPackets.has(name)) {
      const position = bot.entity?.position
      // Mineflayer delays its echo after a death/respawn. Preserve that one echo
      // only if it still describes the latest server-applied entity position;
      // an older delayed snapshot must not undo a subsequent teleport.
      const currentDelayedEcho = pendingPositionEcho && name === 'position_look' && position
        && packet?.x === position.x && packet?.y === position.y && packet?.z === position.z
      if (!processingServerPosition && !currentDelayedEcho) {
        suppressed++
        if (suppressed === 1) log('observer movement sync: suppressed autonomous position updates; teleport_confirm remains enabled')
        return
      }
      if (name === 'position' || name === 'position_look') pendingPositionEcho = false
    }
    return originalWrite.call(this, name, packet, ...rest)
  }
  // This is attached after spawn, so Mineflayer's own position listener already
  // exists: prepend brackets its protocol handling, the tail observes its result.
  client.prependListener('position', beginServerPosition)
  client.on('position', endServerPosition)
  return () => {
    client.removeListener('position', beginServerPosition)
    client.removeListener('position', endServerPosition)
    client.write = originalWrite
  }
}

// 渲染桥 Step② 说明（2026-08-29）：mod 方块注册表注入由 src/mc-modern-viewer.mts 的
// injectModBlockRegistry 实现（bot.registry 层，spawn 后注入，实测 79134 槽位生效）。
// 此处不再重复注入——ESM 环境无 require，且双写会互相污染 blocksByStateId 基准。

export function createBot(config: Config): BotHandle {
  const log = (msg: string) => console.log(`[mc-bot-service] ${msg}`)
  let disposed = false
  let currentBot: Bot | null = null
  let closeViewer: (() => void) | null = null
  let reconnectAttempts = 0 // 连续失败计数：指数退避用，spawn 成功清零

  // ── 2026-08-29 协议错位自愈 ──────────────────────────────────────────────
  // 现象: 内容模组(settlements 村民语音/数据同步)的高频包会让 minecraft-protocol
  // 字节流错位, 其内部只 console.error("Chunk size is N but only M was read ; partial packet ..."),
  // 既不断线也不抛 bot error → 实体流永久卡死(9090 画面/天眼快照全停), 既往只能人工重启容器。
  // 修法: 拦截该特征文本, 主动 end 当前连接, 走既有 autoReconnect(3s)重新同步协议流。
  const consoleError = console.error
  let desyncCooldownUntil = 0
  console.error = (...args: unknown[]) => {
    const text = args.map(a => (typeof a === 'string' ? a : (a as Error)?.message ?? '')).join(' ')
    if (text.includes('partial packet') && Date.now() > desyncCooldownUntil) {
      desyncCooldownUntil = Date.now() + 30_000
      log('协议错位自愈: 检测到 partial packet, 主动重连同步协议流')
      try { currentBot?.end('protocol desync') } catch { /* 已断则忽略 */ }
    }
    consoleError(...args)
  }

  function connect(): Bot {
    log(`connecting to ${config.host}:${config.port} as "${config.username}"`)
    const bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      checkTimeoutInterval: 30_000,
      // NeoForge 21.1.248 = MC 1.21.1：显式钉版本，避免 mineflayer 默认版本探测
      // 在 config/registry 同步阶段失配（Goddess 连 25599 曾卡死在 connecting）。
      version: '1.21.1',
      // Disable simulation before initial spawn as well, avoiding a short
      // gravity/update window before the observer hooks are attached.
      physicsEnabled: !config.observer,
    })
    currentBot = bot

    // 实体 name 归一化：mod 实体（numen/settlements 的村民 base_villager）在 mineflayer
    // registry 里查不到 → name='unknown' → viewer 的 getEntityMesh 对 'unknown' throw → 紫盒/不可见。
    // 这里把已知 mod 实体的 name 归一到 vanilla 对应名，viewer 就能用自带模型渲染。
    // 映射表集中在 B 仓 src/ 可维护；modName 取 mineflayer 的 entityType（协议内部 id）。
    // 注意：必须在创建 viewer(WorldView) 之前注册，保证事件监听先于 viewer，读到的是归一后的 name。
    const MOD_ENTITY_NAME: Record<number, string> = {
      130: 'villager', // numen/settlements 村民（诊断证实 19 位村民均 entityType=130）
    }
    const normalizeModEntity = (e: { name?: string; entityType?: number }): void => {
      if (!e || e.name !== 'unknown' || e.entityType === undefined) return
      const mapped = MOD_ENTITY_NAME[e.entityType]
      if (mapped) e.name = mapped
    }
    bot.on('entitySpawn', (e: any) => normalizeModEntity(e))
    // entityUpdated 不在 mineflayer 官方 BotEvents 类型里；保留监听作为兜底归一（事件若不发则无害）。
    bot.on('entityUpdated' as any, (e: any) => normalizeModEntity(e))
    // 对已连接的旧实体立即归一（防实体早于我注册 hook 已入列）。
    // ⚠️ bot.entities 由 mineflayer 内部插件在 inject_allowed（下一个 event-loop tick）才初始化；
    // createBot() 同步返回的那一刻它仍是 undefined，直接 Object.values 会抛
    // "Cannot convert undefined or null to object"，中断 connect() 后续装配（spawn/error/end
    // 处理器不再注册）→ 进程半挂 → Goddess 卡死在 connecting、RCON 显示在线但没有 spawned。
    // 故必须判空；已连接的实体后续会经 entitySpawn/entityUpdated hook + spawn 时兜底归一到。
    if (bot.entities) for (const e of Object.values(bot.entities)) normalizeModEntity(e)

    // Official plugins: pathfinding + best-tool-for-block selection.
    bot.loadPlugin(pf.pathfinder)
    bot.loadPlugin(toolPlugin)

    bot.once('spawn', async () => {
      reconnectAttempts = 0
      const p = bot.entity?.position
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'unknown'}`)
      const movements = new pf.Movements(bot)
      bot.pathfinder.setMovements(movements)

      if (config.observer) {
        const detachObserverSync = attachObserverMovementSync(bot, log)
        bot.once('end', detachObserverSync)
        log('observer mode: server-authoritative movement sync enabled (physics disabled)')
      }

      // 双视角 viewer（prismarine-viewer），供观察面板 iframe 嵌入：
      //   viewerPort     = 第三人称（环绕跟随，默认 3001）
      //   viewerPort+100 = 第一人称（bot 眼中世界）
      // 两个实例的 close 句柄分别保存；重连时先全部关闭再重建。
      // viewer 懒加载：不用 viewer（MC_VIEWER=0）的部署完全不需要装
      // node-canvas-webgl/canvas/gl 这些 native 依赖（很多平台编译不过）。
      if (config.viewerEnabled) {
        try {
          if (closeViewer) {
            closeViewer()
            closeViewer = null
          }
          // ⚠️ 必须变量化 import 路径：esbuild 会把字面量 `import('prismarine-viewer')`
          // 提升成顶层静态 import（CJS/ESM 都如此），导致即使 viewerEnabled=false，
          // 模块加载时就 require prismarine-viewer → canvas。世界镜像用
          // --omit=optional 跳过 canvas，会直接崩。变量化后 esbuild 无法静态分析，
          // 保持真正的懒加载（viewer 关闭的部署完全不需要 canvas 全家桶）。
          const pvModule = 'prismarine-viewer'
          const pv = await import(pvModule)
          const prismarineViewer = (pv as any).default
          const mineflayerViewer = prismarineViewer.mineflayer
          mineflayerViewer(bot, {
            port: config.viewerPort,
            firstPerson: false,
          })
          const closeThird = (bot as any).viewer.close.bind((bot as any).viewer)
          const closers: Array<() => void> = [closeThird]
          try {
            mineflayerViewer(bot, {
              port: config.viewerPort + 100,
              firstPerson: true,
            })
            closers.push((bot as any).viewer.close.bind((bot as any).viewer))
            log(`viewer ready: third @ :${config.viewerPort}, first @ :${config.viewerPort + 100}`)
          } catch (e) {
            // 第一人称端口失败不影响第三人称
            log(`first-person viewer start failed (ignored): ${(e as Error).message}`)
          }
          closeViewer = () => closers.forEach((c) => { try { c() } catch { /* already closed */ } })
        } catch (err) {
          log(`viewer start failed: ${(err as Error).message}`)
        }
      }
    })

    bot.on('error', (err: Error) => {
      log(`bot error: ${err.message}`)
    })

    bot.on('end', (reason: string) => {
      log(`bot disconnected: ${reason}`)
      if (!disposed && config.autoReconnect) {
        // 指数退避：连续失败越多等越久（3s→6s→12s→…→5min 封顶），spawn 成功清零。
        // 2026-09-05 事故：Spawn/TLM mod 实体的 metadata 包 mineflayer 解析炸 → 无退避
        // 3s 重连循环 + 每轮 RCON 风暴 → 服务器 main 线程被拖死（CPU 满核、tick 停摆）。
        const delay = Math.min(3000 * 2 ** reconnectAttempts, 300000)
        reconnectAttempts++
        log(`reconnect in ${(delay / 1000).toFixed(0)}s (attempt #${reconnectAttempts})`)
        setTimeout(() => {
          if (disposed) return
          connect()
        }, delay)
      }
    })

    return bot
  }

  connect()

  const dispose = () => {
    disposed = true
    log('disposing, ending bot')
    if (closeViewer) {
      closeViewer()
      closeViewer = null
    }
    if (currentBot) {
      currentBot.end('plugin disposed')
      currentBot = null
    }
  }

  return {
    getBot: () => {
      if (!currentBot) throw new Error('[mc-bot-service] bot not connected yet')
      return currentBot
    },
    dispose,
  }
}
